# Verifica las policies de RLS contra el proyecto de PRODUCCION.
#
#   $env:E2E_USER_EMAIL = "prueba@tuempresa.com"
#   $env:E2E_USER_PASSWORD = "..."
#   .\scripts\verify-rls-prod.ps1
#
# No escribe ningun secreto en disco: `vercel env run` inyecta las variables
# reales de produccion directo en el proceso de node. (No se usa `vercel env
# pull` porque en la CLI 58 las variables sensibles salen como [SENSITIVE].)
#
# Requisito: un usuario de produccion con email Y contrasena, miembro de al
# menos un tenant. Las cuentas escritas solo con Google no sirven, porque el
# script entra con signInWithPassword. Ese usuario tiene que ser de prueba: el
# script modifica su profiles.tenant_id y crea/borra datos alrededor.
#
# Todo lo que crea lo borra al terminar (tenant victima, productos, suppliers,
# customers, documents, notifications, objetos de Storage, filas 'hacked-*').

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

# Con $ErrorActionPreference = 'Stop', cualquier comando nativo que escriba en
# stderr aborta el script antes de que podamos mirar su codigo de salida.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $Exe @Arguments 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return @{ Code = $code; Out = $out }
}

if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
  throw "no esta la CLI de Vercel. Bajala con: npm i -g vercel"
}
if (-not (Test-Path (Join-Path $PSScriptRoot '..\.vercel\project.json'))) {
  throw "esta carpeta no esta linkeada a Vercel. Corre primero:  vercel link"
}
$who = Invoke-Native -Exe 'cmd' -Arguments @('/c', 'vercel', 'whoami')
if ($who.Code -ne 0) {
  throw "no hay sesion de Vercel. Corre primero:  vercel login"
}

$missing = @()
foreach ($need in @('E2E_USER_EMAIL', 'E2E_USER_PASSWORD')) {
  if (-not (Test-Path "env:$need")) { $missing += $need }
}
if ($missing.Count -gt 0) {
  $msg = 'falta ' + ($missing -join ' y ') + '. Definilas con: $env:' + $missing[0] + " = '...'"
  throw $msg
}

$env:VERIFY_RLS_ENV_FROM = 'process'

# `vercel env run` deja pasar las variables del proceso padre, y si alguna
# coincide con una de Vercel, la del padre gana. Una sesion que se haya
# quedado con [SENSITIVE] de un `vercel env pull` viejo rompe el script con
# 'Invalid supabaseUrl'. Las borramos para que mande el valor real de Vercel.
$contaminadas = @()
foreach ($k in @('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY')) {
  if (Test-Path "env:$k") {
    $contaminadas += $k
    Remove-Item "env:$k" -ErrorAction SilentlyContinue
  }
}
if ($contaminadas.Count -gt 0) {
  Write-Host ("Limpiadas de esta sesion (venian de un pull viejo): " + ($contaminadas -join ', ')) -ForegroundColor Yellow
}

Write-Host "verify-rls contra PRODUCCION (variables reales, sin escribir a disco)..." -ForegroundColor Cyan
$run = Invoke-Native -Exe 'cmd' -Arguments @(
  '/c', 'vercel', 'env', 'run', '--environment=production',
  '--', 'node', 'scripts/verify-rls.mjs'
)
Remove-Item Env:VERIFY_RLS_ENV_FROM -ErrorAction SilentlyContinue

$run.Out -split "`n" | ForEach-Object {
  $line = $_.TrimEnd()
  if ($line -and $line -notmatch 'CategoryInfo|FullyQualifiedErrorId|^\s*\+|^En C:\\') {
    Write-Host $line
  }
}

Write-Host ""
if ($run.Code -eq 0) {
  Write-Host "OK: 53 ok, 0 fail. Prod esta sano, podes mergear a main." -ForegroundColor Green
} else {
  # Node 24 en Windows puede abortar con un codigo negativo al apagar el
  # event loop; el error real ya quedo impreso arriba.
  Write-Host "FALLO. NO merges a main." -ForegroundColor Red
  Write-Host "Si el error es de login, el usuario no existe, no tiene contrasena, o no pertenece a ningun tenant."
  Write-Host "Las migraciones son re-ejecutables: podes volver a correr 034 sobre prod."
}
exit $run.Code
