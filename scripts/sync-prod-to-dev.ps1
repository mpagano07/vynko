#Requires -Version 5.1
# =============================================================================
# sync-prod-to-dev.ps1
# Primera migracion / clonado unico: PROD (origen) -> DEV-TEST (destino).
# Copia el esquema public (via los migrations del repo con `db push`) y los
# datos de prod a dev. Despues cada base queda independiente.
#
# No requiere Docker ni login: usa `supabase db push` y `supabase db query`
# con las URLs de conexion (--db-url).
#
# Uso:
#   1) Crear ".env.db" en la raiz del repo (ver .env.db.example) con
#      PROD_DB_URL y DEV_DB_URL (URIs "Session pooler").
#   2) .\scripts\sync-prod-to-dev.ps1 [-SkipAuth] [-SkipSchema] [-SkipData]
#
# Flags:
#   -SkipAuth    No copiar auth.users / auth.identities a DEV.
#   -SkipSchema  No aplicar el esquema (migrations).
#   -SkipData    No copiar los datos.
#
# Requisitos:
#   - CLI de Supabase: npm i -g supabase  (o scoop install supabase)
# =============================================================================

param(
    [switch]$SkipAuth,
    [switch]$SkipSchema,
    [switch]$SkipData
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Err([string]$msg) { Write-Host "    $msg" -ForegroundColor Red }
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
# Evita problemas si la password contiene caracteres especiales (@, /, *, etc.).
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

# Construye un literal SQL seguro a partir de un string (escapa comillas y
# control chars con concatenacion de chr()).
function ConvertTo-SqlLiteral {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) { return 'NULL' }
    $inner = ''
    foreach ($ch in $Value.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq "'") { $inner += "''" }
        elseif ($code -eq 10) { $inner += "' || chr(10) || '" }
        elseif ($code -eq 13) { $inner += "' || chr(13) || '" }
        elseif ($code -eq 9) { $inner += "' || chr(9) || '" }
        else { $inner += [string]$ch }
    }
    return "'" + $inner + "'"
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
$devUrl  = ConvertTo-EncodedDbUrl $envVars['DEV_DB_URL']
if ([string]::IsNullOrWhiteSpace($prodUrl) -or [string]::IsNullOrWhiteSpace($devUrl)) {
    Write-Host 'Faltan PROD_DB_URL o DEV_DB_URL en .env.db' -ForegroundColor Red
    exit 1
}

Write-Host '==> Preflight OK' -ForegroundColor Green
Write-Host '    PROD / DEV conectados via Session pooler (encoded).'

$workDir = Join-Path $env:TEMP ("supabase-sync-" + [guid]::NewGuid().ToString('N'))
$migDir = Join-Path $workDir 'supabase\migrations'
try {
    New-Item -ItemType Directory -Path $migDir -Force | Out-Null
    Get-ChildItem (Join-Path $PSScriptRoot '..\migrations') -Filter '*.sql' | Copy-Item -Destination $migDir -Force
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & supabase init --workdir $workDir 2>$null | Out-Null } finally { $ErrorActionPreference = $prevEap }

    # -------------------------------------------------------------------------
    # 1) Esquema: aplicar migrations pendientes a DEV
    # -------------------------------------------------------------------------
    if (-not $SkipSchema) {
        Write-Step '1/4 Aplicando esquema (migrations) en DEV'
        try {
            Invoke-Supabase @('db', 'push', '--yes', '--workdir', $workDir, '--db-url', $devUrl)
            Write-Host '    Esquema aplicado.' -ForegroundColor Green
        } catch {
            Write-Err 'Fallo aplicando migrations. Si es un deadlock, reintenta el script.'
            throw
        }
    } else {
        Write-Step '1/4 Saltando esquema (-SkipSchema)'
    }

    # -------------------------------------------------------------------------
    # 1b) Alineacion de esquema: replicar en DEV el drift ad-hoc de PROD
    #     (columnas / constraints / indices que PROD tiene y DEV no).
    #     Sin esto, la copia de datos falla ("column X does not exist").
    # -------------------------------------------------------------------------
    Write-Step '1b/4 Alineando esquema de DEV con PROD (drift ad-hoc)'
    $colDefSql = "SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS def FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped;"
    $prodCols = @(Invoke-DbQueryJson -Url $prodUrl -Sql $colDefSql)
    $devCols  = @(Invoke-DbQueryJson -Url $devUrl  -Sql $colDefSql)
    $prodColMap = @{}
    foreach ($r in $prodCols) { $prodColMap[[string]$r.tbl + '|' + $r.col] = $r }
    $devColMap = @{}
    foreach ($r in $devCols) { $devColMap[[string]$r.tbl + '|' + $r.col] = $r }

    $alters = @()
    foreach ($k in $prodColMap.Keys) {
        if (-not $devColMap.ContainsKey($k)) {
            $c = $prodColMap[$k]
            $def = if ($c.def) { ' DEFAULT ' + $c.def } else { '' }
            $nn = if ($c.attnotnull -eq 't') { ' NOT NULL' } else { '' }
            $alters += 'ALTER TABLE public."' + $c.tbl + '" ADD COLUMN IF NOT EXISTS "' + $c.col + '" ' + $c.type + $def + $nn + ';'
        }
    }
    if ($alters.Count -gt 0) {
        $block = 'DO $do$ BEGIN' + "`n" + ($alters -join "`n") + "`n" + 'END $do$;'
        Invoke-DbQueryJson -Url $devUrl -Sql $block | Out-Null
        Write-Host "    Columnas agregadas a DEV: $($alters.Count)" -ForegroundColor Green
    } else {
        Write-Host '    Columnas: sin drift.' -ForegroundColor DarkGray
    }

    # Columnas que SOLO existen en DEV (migrations viejas) y son NOT NULL:
    # la copia no las llena (PROD no las tiene) y bloquearian los INSERTs.
    $devOnlyDrops = @()
    foreach ($k in $devColMap.Keys) {
        if (-not $prodColMap.ContainsKey($k) -and $devColMap[$k].attnotnull -eq 't') {
            $c = $devColMap[$k]
            $devOnlyDrops += 'ALTER TABLE public."' + $c.tbl + '" ALTER COLUMN "' + $c.col + '" DROP NOT NULL;'
        }
    }
    if ($devOnlyDrops.Count -gt 0) {
        $block = 'DO $do$ BEGIN' + "`n" + ($devOnlyDrops -join "`n") + "`n" + 'END $do$;'
        Invoke-DbQueryJson -Url $devUrl -Sql $block | Out-Null
        Write-Host "    Columnas DEV-solo pasadas a NULL: $($devOnlyDrops.Count)" -ForegroundColor Green
    }

    $conSql = "SELECT c.conname, c.conrelid::regclass::text AS tbl, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.connamespace='public'::regnamespace AND c.contype IN ('p','u','f','c') ORDER BY c.conname;"
    $prodCons = @(Invoke-DbQueryJson -Url $prodUrl -Sql $conSql)
    $devCons  = @(Invoke-DbQueryJson -Url $devUrl  -Sql $conSql)
    $prodConMap = @{}
    foreach ($r in $prodCons) { $prodConMap[[string]$r.tbl + '|' + $r.conname] = $r }
    $devConMap = @{}
    foreach ($r in $devCons) { $devConMap[[string]$r.tbl + '|' + $r.conname] = $r }

    $conAdds = @()
    foreach ($k in $prodConMap.Keys) {
        if (-not $devConMap.ContainsKey($k)) {
            $con = $prodConMap[$k]
            $tbl = ([string]$con.tbl -replace '^public\.', '')
            $conAdds += "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='$($con.conname)' AND conrelid='public.$tbl'::regclass) THEN ALTER TABLE public.`"$tbl`" ADD CONSTRAINT `"$($con.conname)`" $($con.def); END IF;"
        }
    }
    if ($conAdds.Count -gt 0) {
        $block = 'DO $do$ BEGIN ' + ($conAdds -join ' ') + ' END $do$;'
        Invoke-DbQueryJson -Url $devUrl -Sql $block | Out-Null
        Write-Host "    Constraints agregados a DEV: $($conAdds.Count)" -ForegroundColor Green
    } else {
        Write-Host '    Constraints: sin drift.' -ForegroundColor DarkGray
    }

    $idxSql = "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname NOT LIKE '%_pkey' ORDER BY indexname;"
    $prodIdx = @(Invoke-DbQueryJson -Url $prodUrl -Sql $idxSql)
    $devIdx  = @(Invoke-DbQueryJson -Url $devUrl  -Sql $idxSql)
    $prodIdxMap = @{}
    foreach ($r in $prodIdx) { $prodIdxMap[[string]$r.indexname] = $r }
    $devIdxMap = @{}
    foreach ($r in $devIdx) { $devIdxMap[[string]$r.indexname] = $r }

    $idxCount = 0
    foreach ($k in $prodIdxMap.Keys | Sort-Object) {
        if (-not $devIdxMap.ContainsKey($k)) {
            $idxDef = [string]$prodIdxMap[$k].indexdef
            if ($idxDef -match '^CREATE (UNIQUE )?INDEX') {
                $idxDef = $idxDef -replace '^CREATE (UNIQUE )?INDEX', 'CREATE $1INDEX IF NOT EXISTS'
            }
            Invoke-DbQueryJson -Url $devUrl -Sql $idxDef | Out-Null
            $idxCount++
        }
    }
    if ($idxCount -gt 0) {
        Write-Host "    Indices agregados a DEV: $idxCount" -ForegroundColor Green
    } else {
        Write-Host '    Indices: sin drift.' -ForegroundColor DarkGray
    }


    # -------------------------------------------------------------------------
    # 2) Datos: copiar tablas de PROD a DEV via INSERTs generados
    # -------------------------------------------------------------------------
    if (-not $SkipData) {
        Write-Step '2/4 Copiando datos de PROD a DEV'

        function Copy-Table {
            param([string]$Schema, [string]$Table)
            $colQuery = "SELECT column_name, data_type, is_generated FROM information_schema.columns WHERE table_schema = '$Schema' AND table_name = '$Table' ORDER BY ordinal_position;"
            $cols = @(Invoke-DbQueryJson -Url $prodUrl -Sql $colQuery)
            if ($cols.Count -eq 0) { return }
            foreach ($c in $cols) {
                if ([string]::IsNullOrWhiteSpace([string]$c.column_name)) {
                    throw "consulta de columnas de $Schema.$Table devolvio datos invalidos: $($cols | ConvertTo-Json -Compress)"
                }
            }

            $typeMap = @{}
            $selectCols = @()
            foreach ($c in $cols) {
                $name = [string]$c.column_name
                if ([string]$c.is_generated -eq 'ALWAYS') { continue }
                $typeMap[$name] = [string]$c.data_type
                $selectCols += '"' + $name + '"::text AS "' + $name + '"'
            }
            $selSql = 'SELECT ' + ($selectCols -join ', ') + " FROM $Schema.`"$Table`";"
            $rows = @(Invoke-DbQueryJson -Url $prodUrl -Sql $selSql)
            if ($rows.Count -eq 0) { return }

            $colNames = @($typeMap.Keys)
            $values = @()
            foreach ($r in $rows) {
                $tuple = @()
                foreach ($name in $colNames) {
                    $v = $r.PSObject.Properties[$name].Value
                    $lit = if ($null -eq $v) { 'NULL' } else { ConvertTo-SqlLiteral ([string]$v) }
                    $t = $typeMap[$name]
                    if ($t -eq 'jsonb' -or $t -eq 'json') { $lit += '::jsonb' }
                    elseif ($t -eq 'bytea') { $lit += '::bytea' }
                    elseif ($t -eq 'ARRAY') { $lit += '::text[]' }
                    $tuple += $lit
                }
                $values += '(' + ($tuple -join ', ') + ')'
            }
            $colsList = ($colNames | ForEach-Object { '"' + $_ + '"' }) -join ', '
            $insertSql = "INSERT INTO $Schema.`"$Table`" ($colsList) VALUES`n" + ($values -join ",`n") + ' ON CONFLICT DO NOTHING;'

            $tblRef = "$Schema.`"$Table`""
            Invoke-DbQueryJson -Url $devUrl -Sql $insertSql | Out-Null
            Write-Host "    ${Table}: $($rows.Count) filas" -ForegroundColor Gray
        }

        # auth (opcional, para que los usuarios existentes puedan loguearse)
        if (-not $SkipAuth) {
            foreach ($authTable in @('users', 'identities')) {
                try {
                    Copy-Table -Schema 'auth' -Table $authTable
                } catch {
                    Write-Warn "No se pudo copiar auth.${authTable}: $($_.Exception.Message)"
                }
            }
        } else {
            Write-Warn 'SkipAuth: no se copiaron auth.users/identities.'
        }

        # tablas public en orden topologico (padres antes que hijos, porque las
        # FK siguen activas; no hay triggers de usuario que deshabilitar)
        $tblQuery = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY table_name;"
        $pubTables = @(Invoke-DbQueryJson -Url $prodUrl -Sql $tblQuery | ForEach-Object { [string]$_.table_name })

        $fkQuery = "SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace;"
        $edges = @(Invoke-DbQueryJson -Url $prodUrl -Sql $fkQuery | ForEach-Object {
            [pscustomobject]@{ child = ([string]$_.child -replace '^public\.', ''); parent = ([string]$_.parent -replace '^public\.', '') }
        })

        $order = @()
        $remaining = @{}
        foreach ($t in $pubTables) { $remaining[$t] = $true }
        while ($remaining.Count -gt 0) {
            $progress = $false
            foreach ($t in @($remaining.Keys)) {
                $blocked = $false
                foreach ($e in $edges) {
                    if ($e.child -eq $t -and $remaining.ContainsKey($e.parent)) { $blocked = $true; break }
                }
                if (-not $blocked) {
                    $order += $t
                    $remaining.Remove($t)
                    $progress = $true
                }
            }
            if (-not $progress) { foreach ($t in @($remaining.Keys)) { $order += $t; $remaining.Remove($t) }; break }
        }
        Write-Host "    Orden de insercion: $($order -join ', ')" -ForegroundColor DarkGray

        $failed = @()
        foreach ($name in $order) {
            try {
                Copy-Table -Schema 'public' -Table $name
            } catch {
                $failed += $name
                Write-Err "Fallo copiando public.$name : $($_.Exception.Message)"
            }
        }
        if ($failed.Count -gt 0) {
            Write-Err "Tablas con fallos: $($failed -join ', ')"
        }
    } else {
        Write-Step '2/4 Saltando datos (-SkipData)'
    }

    # -------------------------------------------------------------------------
    # 3) Verificacion: tablas y conteo de filas PROD vs DEV
    # -------------------------------------------------------------------------
    Write-Step '3/4 Verificando tablas y conteos (PROD vs DEV)'
    $tblQuery = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY table_name;"
    $prodTables = @(Invoke-DbQueryJson -Url $prodUrl -Sql $tblQuery | ForEach-Object { [string]$_.table_name })
    $devTables  = @(Invoke-DbQueryJson -Url $devUrl  -Sql $tblQuery | ForEach-Object { [string]$_.table_name })

    $missingOnDev = $prodTables | Where-Object { $_ -notin $devTables }
    if ($missingOnDev.Count -gt 0) {
        Write-Err "Tablas que faltan en DEV: $($missingOnDev -join ', ')"
    }

    $countSql = ($prodTables | ForEach-Object { "SELECT '$_' AS tbl, count(*)::bigint AS rows FROM public.`"$_`"" }) -join "`nUNION ALL`n"
    $countSql += ';'
    $prodCounts = @{}
    foreach ($r in @(Invoke-DbQueryJson -Url $prodUrl -Sql $countSql)) { $prodCounts[[string]$r.tbl] = [int64]$r.rows }
    $devCounts = @{}
    foreach ($r in @(Invoke-DbQueryJson -Url $devUrl -Sql $countSql)) { $devCounts[[string]$r.tbl] = [int64]$r.rows }

    $mismatch = $false
    Write-Host ('{0,-32} {1,10} {2,10} {3,8}' -f 'TABLA', 'PROD', 'DEV', 'ESTADO')
    foreach ($t in $prodTables) {
        $p = $prodCounts[$t]; $d = $devCounts[$t]
        $ok = $p -eq $d
        if (-not $ok) { $mismatch = $true }
        Write-Host ('{0,-32} {1,10} {2,10} {3,8}' -f $t, $p, $d, $(if ($ok) { 'OK' } else { 'DIFERENTE' }))
    }
    if ($mismatch) {
        Write-Warn 'Hay tablas con conteos diferentes.'
    } else {
        Write-Host 'Conteos alineados.' -ForegroundColor Green
    }

    Write-Step '4/4 Fin'
    Write-Host 'A partir de ahora PROD y DEV son independientes. Gestiona cambios con /migrations.' -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}