#Requires -Version 5.1
# =============================================================================
# backup-db.ps1
# Backup con verificacion de la base de PROD (public) via la CLI de Supabase.
#
#   - Dump completo (schema + datos) a scripts/dumps/vynko-backup-<ts>.sql
#   - Manifiesto JSON al lado: conteo de filas por tabla + SHA256 del dump.
#   - Verificacion estructural: el dump no esta vacio y trae CREATE TABLE.
#   - Verificacion de restore (opt-in): aplica el dump a una base de scratch y
#     compara los conteos con el manifiesto. Eso prueba que el backup SIRVE
#     para recuperar, no solo que se escribio.
#
# Uso:
#   1) Crear ".env.db" en la raiz del repo (ver scripts/.env.db.example) con
#      PROD_DB_URL y, para verificar restore, DEV_DB_URL (o pasar -RestoreUrl).
#   2) .\scripts\backup-db.ps1 [-RestoreUrl <db-url>]
#
# Requisitos: CLI de Supabase (npm i -g supabase) - aunque solo para dumps
# remotos; no necesita Docker ni login.
# =============================================================================

param(
    # Destino opcional del test de restore + conteos.
    [string]$RestoreUrl = ''
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Err([string]$msg) { Write-Host "    $msg" -ForegroundColor Red }
function Write-Ok([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }

function Invoke-Supabase {
    param([string[]]$CliArgs)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & supabase @CliArgs 2>$null
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($LASTEXITCODE -ne 0) {
        throw "supabase fallo con codigo $LASTEXITCODE`nComando: supabase $($CliArgs -join ' ')"
    }
}

function Invoke-DbQueryJson {
    param([string]$Url, [string]$Sql)
    $tmp = Join-Path $env:TEMP ("supa-q-" + [guid]::NewGuid().ToString('N') + '.sql')
    [System.IO.File]::WriteAllText($tmp, $Sql, (New-Object System.Text.UTF8Encoding($false)))
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $attempt = 0
        while ($true) {
            $attempt++
            $out = & supabase db query --db-url $Url -f $tmp --output-format json 2>&1
            if ($LASTEXITCODE -eq 0) { break }
            if ($attempt -ge 4) {
                $detail = ($out | Out-String).Trim()
                $maskedUrl = if ($Url.Length -gt 40) { $Url.Substring(0, 25) + '...' + $Url.Substring($Url.Length - 20) } else { $Url }
                $sqlPreview = $Sql.Substring(0, [Math]::Min(200, $Sql.Length)) -replace "`r|`n", ' '
                throw "db query fallo (exit $LASTEXITCODE)`nURL: $maskedUrl`nSQL: $sqlPreview`nARCHIVO: $tmp`nOUT: $detail"
            }
            Start-Sleep -Milliseconds 2000
        }
        $stdout = $out | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }
        if ([string]::IsNullOrWhiteSpace($stdout)) { return @() }
        try {
            $parsed = $stdout | Out-String | ConvertFrom-Json
            if ($null -eq $parsed) { return @() }
            if ($parsed -is [System.Array]) {
                foreach ($item in $parsed) { $item }
            } else {
                $parsed
            }
        } catch {
            return @()
        }
    } finally {
        $ErrorActionPreference = $prevEap
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

# Convierte una conexion postgresql://... a una URL con la password percent-encoded.
function ConvertTo-EncodedDbUrl {
    param([string]$Url)
    $idx = $Url.IndexOf('://')
    if ($idx -lt 0) { return $Url }
    $scheme = $Url.Substring(0, $idx + 3)
    $rest = $Url.Substring($idx + 3)
    $at = $rest.LastIndexOf('@')
    if ($at -lt 0) { return $Url }
    $userinfo = $rest.Substring(0, $at)
    $hostAndTail = $rest.Substring($at + 1)
    $slash = $hostAndTail.IndexOf('/')
    if ($slash -lt 0) { $slash = $hostAndTail.Length }
    $hostPart = $hostAndTail.Substring(0, $slash)
    $tail = $hostAndTail.Substring($slash)
    $colon = $userinfo.IndexOf(':')
    if ($colon -lt 0) {
        return $scheme + [Uri]::EscapeDataString($userinfo) + '@' + $hostPart + $tail
    }
    $user = $userinfo.Substring(0, $colon)
    $pass = $userinfo.Substring($colon + 1)
    try { $pass = [Uri]::UnescapeDataString($pass) } catch { }
    return $scheme + [Uri]::EscapeDataString($user) + ':' + [Uri]::EscapeDataString($pass) + '@' + $hostPart + $tail
}

function Get-RowCounts {
    param([string]$Url)
    $tables = @(Invoke-DbQueryJson -Url $Url -Sql "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY table_name;" | ForEach-Object { [string]$_.table_name })
    if ($tables.Count -eq 0) { return @{} }
    $countSql = ($tables | ForEach-Object { "SELECT '$_' AS tbl, count(*)::bigint AS rows FROM public.`"$_`"" }) -join "`nUNION ALL`n"
    $countSql += ';'
    $counts = @{}
    foreach ($r in @(Invoke-DbQueryJson -Url $Url -Sql $countSql)) { $counts[[string]$r.tbl] = [int64]$r.rows }
    return $counts
}

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
if (!(Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host 'supabase CLI no esta instalado.' -ForegroundColor Red
    Write-Host '  Instalalo con: npm i -g supabase   (o: scoop install supabase / choco install supabase)' -ForegroundColor Yellow
    exit 1
}

$envFile = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) '.env.db'
if (!(Test-Path $envFile)) {
    Write-Host "No existe $envFile. Crealo a partir de scripts/.env.db.example" -ForegroundColor Red
    exit 1
}

$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$') {
        $envVars[$matches[1]] = $matches[2].Trim()
    }
}

$prodUrl = ConvertTo-EncodedDbUrl $envVars['PROD_DB_URL']
if ([string]::IsNullOrWhiteSpace($prodUrl)) {
    Write-Host 'Falta PROD_DB_URL en .env.db' -ForegroundColor Red
    exit 1
}
$restoreTarget = ''
if ($RestoreUrl) { $restoreTarget = ConvertTo-EncodedDbUrl $RestoreUrl }
elseif ($envVars['DEV_DB_URL']) { $restoreTarget = ConvertTo-EncodedDbUrl $envVars['DEV_DB_URL'] }

Write-Host '==> Preflight OK' -ForegroundColor Green

# -----------------------------------------------------------------------------
# 1) Dump
# -----------------------------------------------------------------------------
Write-Step '1/4 Dumping public (schema + datos)'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$dumpDir = Join-Path $PSScriptRoot 'dumps'
New-Item -ItemType Directory -Path $dumpDir -Force | Out-Null
$dumpFile = Join-Path $dumpDir "vynko-backup-$ts.sql"
$manifestFile = Join-Path $dumpDir "vynko-backup-$ts.manifest.json"

Invoke-Supabase @('db', 'dump', '--db-url', $prodUrl, '--schema', 'public', '-f', $dumpFile)
$dumpText = Get-Content -LiteralPath $dumpFile -Raw
if ([string]::IsNullOrWhiteSpace($dumpText)) {
    Write-Err 'El dump quedo vacio. Abortando.'
    exit 1
}
$sizeKb = [Math]::Round((Get-Item -LiteralPath $dumpFile).Length / 1KB, 1)
Write-Ok "Dump escrito: $dumpFile ($sizeKb KB)"

# -----------------------------------------------------------------------------
# 2) Manifiesto: conteos por tabla + SHA256
# -----------------------------------------------------------------------------
Write-Step '2/4 Generando manifiesto (conteos + checksum)'
$counts = Get-RowCounts -Url $prodUrl
$sha = (Get-FileHash -LiteralPath $dumpFile -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    created_at    = (Get-Date).ToUniversalTime().ToString('o')
    source_url    = $prodUrl.Split('@')[0] + '@...'    # sin credenciales
    sha256        = $sha
    rows_by_table = $counts
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestFile -Encoding UTF8
$totalRows = ($counts.Values | Measure-Object -Sum).Sum
Write-Ok "Manifiesto: $manifestFile ($($counts.Count) tablas, $totalRows filas, sha256 $($sha.Substring(0,12))...)"

# -----------------------------------------------------------------------------
# 3) Verificacion estructural
# -----------------------------------------------------------------------------
Write-Step '3/4 Verificacion estructural del dump'
$createTables = ([regex]::Matches($dumpText, '(?im)^\s*CREATE TABLE')).Count
$inserts = ([regex]::Matches($dumpText, '(?im)^\s*INSERT INTO')).Count
if ($createTables -eq 0 -or $inserts -eq 0) {
    Write-Err "El dump no parece completo: $createTables CREATE TABLE, $inserts INSERT INTO."
    Write-Err 'Revisar supabase db dump. Abortando.'
    exit 1
}
Write-Ok "CREATE TABLE x$createTables / INSERT INTO x$inserts en el dump."

# -----------------------------------------------------------------------------
# 4) Restore test (opt-in): aplicar el dump a otra base y comparar conteos
# -----------------------------------------------------------------------------
if ($restoreTarget) {
    Write-Step '4/4 Verificando restore en destino scratch'
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & supabase db query --db-url $restoreTarget -f $dumpFile 2>&1 | Out-Null
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'El restore fallo: el backup NO se puede recuperar en el destino.'
        exit 1
    }
    $restored = Get-RowCounts -Url $restoreTarget
    $mismatch = $false
    $missing = 0
    foreach ($t in $counts.Keys) {
        $src = $counts[$t]; $dst = $restored[$t]
        if ($null -eq $dst) { $missing++ }
        elseif ($dst -ne $src -and $src -ne 0) { $mismatch = $true; Write-Err "  ${t}: origen $src vs destino $dst" }
    }
    if ($mismatch -or $missing -gt 0) {
        Write-Err "Conteos no cuadran en $($mismatch + $missing) tablas. Revisar el destino (debe estar vacio)."
        exit 1
    }
    Write-Ok 'Restore verificado: conteos origen == destino.'
} else {
    Write-Step '4/4 Restore test'
    Write-Host '    Sin destino scratch (DEV_DB_URL o -RestoreUrl): se omitio el restore test.' -ForegroundColor DarkGray
    Write-Host '    Para verificar la RECUPERACION completa, volver a correr con -RestoreUrl <db-vacia>.' -ForegroundColor Yellow
}

Write-Host '`nBackup OK.' -ForegroundColor Green