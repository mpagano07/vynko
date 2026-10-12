#Requires -Version 5.1
# =============================================================================
# backup-db.ps1
# Backup con verificacion de la base de PROD via la CLI de Supabase.
#
#   - Tres dumps (metodo oficial de Supabase para restore completo):
#       roles.sql   -> --role-only (roles custom; no incluye passwords)
#       schema.sql  -> DDL del schema public
#       data.sql    -> --data-only --use-copy (incluye auth.users; excluye las
#                      tablas vector de storage)
#   - Manifiesto JSON al lado: SHA256 + tamano de cada archivo y conteo de
#     filas por tabla (public.* + auth.users).
#   - Verificacion estructural: los dumps no estan vacios y traen lo esperado.
#   - Verificacion de restore (opt-in): aplica los 3 dumps a una base de scratch
#     con `psql --single-transaction` y compara los conteos con el manifiesto.
#     Eso prueba que el backup SIRVE para recuperar, no solo que se escribio.
#
# Uso:
#   1) Crear ".env.db" en la raiz del repo (ver scripts/.env.db.example) con
#      PROD_DB_URL y, para verificar restore, DEV_DB_URL (o pasar -RestoreUrl).
#   2) .\scripts\backup-db.ps1 [-RestoreUrl <db-url>]
#
# Requisitos: CLI de Supabase (npm i -g supabase) para los dumps y, para el
# restore test, el cliente `psql` (solo con -RestoreUrl/DEV_DB_URL). No
# necesita Docker ni login.
# =============================================================================

param(
    # Destino opcional del test de restore + conteos.
    [string]$RestoreUrl = ''
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Err([string]$msg) { Write-Host "    $msg" -ForegroundColor Red }
function Write-Ok([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "    $msg" -ForegroundColor Yellow }

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

# Devuelve un [ordered] con "<clave>" -> conteo, a partir de un mapa
# "<clave>" -> "<identificador SQL calificado>".
function Get-TableCounts {
    param([string]$Url, [System.Collections.Specialized.OrderedDictionary]$Targets)
    if ($Targets.Count -eq 0) { return [ordered]@{} }
    $countSql = ($Targets.GetEnumerator() | ForEach-Object { "SELECT '$($_.Key)' AS tbl, count(*)::bigint AS rows FROM $($_.Value)" }) -join "`nUNION ALL`n"
    $countSql += ';'
    $counts = [ordered]@{}
    foreach ($r in @(Invoke-DbQueryJson -Url $Url -Sql $countSql)) { $counts[[string]$r.tbl] = [int64]$r.rows }
    return $counts
}

# Tablas a contar para el manifiesto: public.* (sin schema_migrations) + auth.users.
function Get-CountTargets {
    param([string]$Url)
    $targets = [ordered]@{}
    $pubTables = @(Invoke-DbQueryJson -Url $Url -Sql "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY table_name;" | ForEach-Object { [string]$_.table_name })
    foreach ($t in $pubTables) { $targets["public.$t"] = "public.`"$t`"" }
    # auth.users puede no existir / no ser accesible segun el rol: se conta aparte.
    try {
        $probe = @(Invoke-DbQueryJson -Url $Url -Sql "SELECT count(*)::bigint AS rows FROM auth.users;")
        if ($probe.Count -gt 0) { $targets['auth.users'] = 'auth."users"' }
    } catch {
        Write-Warn 'No se pudo contar auth.users (sin permiso o tabla ausente); queda fuera del manifiesto.'
    }
    return $targets
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

if ($restoreTarget -and !(Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Host 'El restore test necesita el cliente psql.' -ForegroundColor Red
    Write-Host '  Instalalo (PostgreSQL client tools) o corre de nuevo sin -RestoreUrl/DEV_DB_URL.' -ForegroundColor Yellow
    exit 1
}

Write-Host '==> Preflight OK' -ForegroundColor Green

# -----------------------------------------------------------------------------
# 1) Dumps (roles + schema + data)
# -----------------------------------------------------------------------------
Write-Step '1/5 Dumping roles, schema y data'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$dumpDir = Join-Path $PSScriptRoot 'dumps'
New-Item -ItemType Directory -Path $dumpDir -Force | Out-Null
$prefix = "vynko-backup-$ts"
$rolesFile = Join-Path $dumpDir "$prefix.roles.sql"
$schemaFile = Join-Path $dumpDir "$prefix.schema.sql"
$dataFile = Join-Path $dumpDir "$prefix.data.sql"
$manifestFile = Join-Path $dumpDir "$prefix.manifest.json"

# roles: solo roles custom; no incluye passwords (hay que resetearlas luego).
Invoke-Supabase @('db', 'dump', '--db-url', $prodUrl, '--role-only', '-f', $rolesFile)
# schema: DDL del schema public (excluye schemas gestionados).
Invoke-Supabase @('db', 'dump', '--db-url', $prodUrl, '--schema', 'public', '-f', $schemaFile)
# data: datos de todas las tablas (incluye auth.users) salvo las vector de storage.
Invoke-Supabase @('db', 'dump', '--db-url', $prodUrl, '--data-only', '--use-copy', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes', '-f', $dataFile)

$files = [ordered]@{ roles = $rolesFile; schema = $schemaFile; data = $dataFile }
foreach ($k in $files.Keys) {
    $p = $files[$k]
    $len = if (Test-Path -LiteralPath $p) { (Get-Item -LiteralPath $p).Length } else { 0 }
    if ($len -eq 0) {
        Write-Err "El dump '$k' quedo vacio ($p). Abortando."
        exit 1
    }
    Write-Ok "$k -> $([System.IO.Path]::GetFileName($p)) ($([Math]::Round($len / 1KB, 1)) KB)"
}

# -----------------------------------------------------------------------------
# 2) Manifiesto: SHA256 + tamano por archivo, conteos por tabla
# -----------------------------------------------------------------------------
Write-Step '2/5 Generando manifiesto (checksums + conteos)'
$fileMeta = [ordered]@{}
foreach ($k in $files.Keys) {
    $p = $files[$k]
    $fileMeta[$k] = [ordered]@{
        file   = [System.IO.Path]::GetFileName($p)
        bytes  = (Get-Item -LiteralPath $p).Length
        sha256 = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$targets = Get-CountTargets -Url $prodUrl
$counts = Get-TableCounts -Url $prodUrl -Targets $targets
$totalRows = ($counts.Values | Measure-Object -Sum).Sum

$manifest = [ordered]@{
    created_at    = (Get-Date).ToUniversalTime().ToString('o')
    source_url    = $prodUrl.Split('@')[0] + '@...'    # sin credenciales
    files         = $fileMeta
    rows_by_table = $counts
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestFile -Encoding UTF8
Write-Ok "Manifiesto: $([System.IO.Path]::GetFileName($manifestFile)) ($($counts.Count) tablas, $totalRows filas)"
Write-Ok "SHA256 data: $($fileMeta['data'].sha256.Substring(0, 12))..."

# -----------------------------------------------------------------------------
# 3) Verificacion estructural
# -----------------------------------------------------------------------------
Write-Step '3/5 Verificacion estructural de los dumps'
$schemaText = Get-Content -LiteralPath $schemaFile -Raw
$dataText = Get-Content -LiteralPath $dataFile -Raw
$rolesText = Get-Content -LiteralPath $rolesFile -Raw

$createTables = ([regex]::Matches($schemaText, '(?im)^\s*CREATE TABLE')).Count
if ($createTables -eq 0) {
    Write-Err 'schema.sql no trae CREATE TABLE. Revisar supabase db dump. Abortando.'
    exit 1
}
$dataCopies = ([regex]::Matches($dataText, '(?im)^\s*COPY ')).Count
$dataInserts = ([regex]::Matches($dataText, '(?im)^\s*INSERT INTO')).Count
if (($dataCopies + $dataInserts) -eq 0) {
    Write-Err 'data.sql no trae COPY ni INSERT INTO. Revisar supabase db dump. Abortando.'
    exit 1
}
if ($rolesText -notmatch '(?im)CREATE ROLE|ALTER ROLE') {
    Write-Warn 'roles.sql no menciona CREATE ROLE/ALTER ROLE (puede ser un proyecto sin roles custom).'
}
$hasAuthUsers = $dataText -match '(?im)(COPY|INSERT INTO)\s+auth\.users|INTO\s+auth\."?users"?'
if ($hasAuthUsers) { Write-Ok 'data.sql incluye auth.users.' }
else { Write-Warn 'No se detecto auth.users en data.sql; revisar el alcance del dump.' }

Write-Ok "schema: CREATE TABLE x$createTables; data: COPY x$dataCopies / INSERT x$dataInserts."

# -----------------------------------------------------------------------------
# 4) Restore test (opt-in): aplicar los 3 dumps a una base scratch y comparar
# -----------------------------------------------------------------------------
if ($restoreTarget) {
    Write-Step '4/5 Verificando restore en destino scratch'
    $psqlArgs = @(
        '--single-transaction',
        '--variable', 'ON_ERROR_STOP=1',
        '--file', $rolesFile,
        '--file', $schemaFile,
        '--command', 'SET session_replication_role = replica',
        '--file', $dataFile,
        '--dbname', $restoreTarget
    )
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & psql @psqlArgs 2>&1 | Out-Null
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'El restore fallo: el backup NO se puede recuperar en el destino.'
        exit 1
    }
    $restored = Get-TableCounts -Url $restoreTarget -Targets $targets
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
    Write-Step '4/5 Restore test'
    Write-Host '    Sin destino scratch (DEV_DB_URL o -RestoreUrl): se omitio el restore test.' -ForegroundColor DarkGray
    Write-Host '    Para verificar la RECUPERACION completa, volver a correr con -RestoreUrl <db-vacia>.' -ForegroundColor Yellow
}

Write-Step '5/5 Listo'
Write-Host "`nBackup OK." -ForegroundColor Green
