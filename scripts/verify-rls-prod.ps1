# Verifica las policies de RLS contra el proyecto de PRODUCCION.
#
#   .\scripts\verify-rls-prod.ps1
#
# Hace tres cosas: baja las variables de produccion desde Vercel a un archivo
# gitignored, las carga en esta sesion, y corre verify-rls apuntando ahi.
# No imprime ningun valor secreto, solo nombres de variables.
#
# Requisito: un usuario real de prod que pertenezca a al menos un tenant.
# Si no lo tenes:
#   $env:E2E_USER_EMAIL = "prueba@tuempresa.com"
#   $env:E2E_USER_PASSWORD = "..."
#
# El script borra al terminar todo lo que creo (tenant victima, productos,
# suppliers, customers, documents, notifications, objetos de Storage y filas
# 'hacked-*'). Modifica el profiles.tenant_id del usuario de prueba, asi que
# usa un usuario descartable.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

# Con $ErrorActionPreference = 'Stop', cualquier comando nativo que escriba en
# stderr (como la CLI de Vercel) aborta el script antes de que podamos mirar su
# codigo de salida. Este wrapper aisla eso.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $Exe @Arguments 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return @{ Code = $code; Out = $out }
}

$envFile = '.env.production.local'

if (-not (Test-Path $envFile)) {
  if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    throw "no esta la CLI de Vercel. Bajala con: npm i -g vercel"
  }
  $who = Invoke-Native -Exe 'vercel' -Arguments @('whoami')
  if ($who.Code -ne 0) {
    throw "no hay sesion de Vercel. Corre primero:  vercel login"
  }
  Write-Host "Bajando variables de produccion desde Vercel..." -ForegroundColor Cyan
  $pull = Invoke-Native -Exe 'vercel' -Arguments @('env', 'pull', $envFile, '--environment=production')
  $pull.Out -split "`n" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and $line -notmatch 'Node\.js|CategoryInfo|FullyQualifiedErrorId|^\+') { Write-Host "  $line" }
  }
  if ($pull.Code -ne 0 -or -not (Test-Path $envFile)) {
    throw "vercel env pull fallo. Verifica la sesion con:  vercel whoami"
  }
} else {
  Write-Host "Usando $envFile ya existente (borrado si queres que se vuelva a bajar)" -ForegroundColor DarkGray
}

$cargadas = @()
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') {
    $v = $Matches[2].Trim().Trim('"').Trim("'")
    if ($v) {
      [Environment]::SetEnvironmentVariable($Matches[1], $v, 'Process')
      $cargadas += $Matches[1]
    }
  }
}
Write-Host ("Cargadas: " + ($cargadas -join ', ')) -ForegroundColor DarkGray

foreach ($need in @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY')) {
  if (-not (Test-Path "env:$need")) { throw "falta $need en $envFile" }
}
if (-not (Test-Path 'env:E2E_USER_EMAIL')) {
  throw "falta E2E_USER_EMAIL. Definilo con: `$env:E2E_USER_EMAIL = 'correo@dominio.com'"
}
if (-not (Test-Path 'env:E2E_USER_PASSWORD')) {
  throw "falta E2E_USER_PASSWORD. Definilo con: `$env:E2E_USER_PASSWORD = '...'"
}

$env:VERIFY_RLS_ENV_FROM = 'process'
Write-Host "Corriendo verify-rls contra PRODUCCION..." -ForegroundColor Cyan
node scripts/verify-rls.mjs
$code = $LASTEXITCODE

Remove-Item Env:VERIFY_RLS_ENV_FROM -ErrorAction SilentlyContinue

Write-Host ""
if ($code -eq 0) {
  Write-Host "OK: 53 ok, 0 fail. Prod esta sano, podes mergear a main." -ForegroundColor Green
} else {
  Write-Host "FALLO (codigo $code). NO merges a main. Pasame la linea que marco fail." -ForegroundColor Red
  Write-Host "Las migraciones son re-ejecutables: podes volver a correr 034 sobre prod."
}
exit $code
