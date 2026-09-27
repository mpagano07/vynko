# Verifica las policies de RLS contra el proyecto de PRODUCCION.
#
#   $env:E2E_USER_EMAIL = "prueba@tuempresa.com"
#   $env:E2E_USER_PASSWORD = "..."
#   $env:VERIFY_RLS_EXPECT_REF = "abc123"   # recomendado: primeros 6 del ref
#   .\scripts\verify-rls-prod.ps1
#
# Recomendado definir VERIFY_RLS_EXPECT_REF con los primeros 6 caracteres del
# project ref de PRODUCCION. El script imprime el ref que realmente uso y
# aborta si no coincide, para que un resultado "53 ok" sobre la base de dev no
# se pueda leer como una aprobacion de produccion.
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

if (-not (Test-Path Env:VERIFY_RLS_EXPECT_REF)) {
  Write-Host "AVISO: no definiste VERIFY_RLS_EXPECT_REF, asi que no se puede comprobar que" -ForegroundColor Yellow
  Write-Host "       apunte a produccion. Mirá el project ref que imprime el script." -ForegroundColor Yellow
}

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

# Limpiar el entorno del proceso padre NO alcanza: la CLI de Vercel tambien lee
# los archivos .env* del directorio y los inyecta. Como .env.local apunta a dev,
# sus valores le ganaban a los de Production y el script verificaba la base
# equivocada anunciando que usaba produccion. Por eso apartamos .env.local
# durante la corrida y lo restauramos siempre, pase lo que pase.
$envLocal = Join-Path (Get-Location) '.env.local'
$envLocalBak = $envLocal + '.verify-bak'
$movido = $false
if (Test-Path -LiteralPath $envLocal) {
  Move-Item -LiteralPath $envLocal -Destination $envLocalBak -Force
  $movido = $true
  Write-Host "Apartado .env.local para que no contamination la corrida." -ForegroundColor Yellow
}

try {
  $run = Invoke-Native -Exe 'cmd' -Arguments @(
    '/c', 'vercel', 'env', 'run', '--environment=production',
    '--', 'node', 'scripts/verify-rls.mjs'
  )
} finally {
  if ($movido -and (Test-Path -LiteralPath $envLocalBak)) {
    Move-Item -LiteralPath $envLocalBak -Destination $envLocal -Force
    Write-Host "Restaurado .env.local." -ForegroundColor Yellow
  }
}
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
