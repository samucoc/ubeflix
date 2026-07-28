# Arranca ubeflix y deja las unidades del PC montadas dentro del backend.
#
# Reemplaza a `docker compose up`: levanta los contenedores y después re-monta
# las unidades que hayan quedado en "No such device" dentro de WSL2 (las que ya
# están sanas no se tocan). Si hubo algún re-montaje, reinicia el backend para
# que tome los montajes nuevos.
#
# Uso:   .\up.ps1
#        .\up.ps1 --build
#        .\up.ps1 --build --force-recreate
#
# Los argumentos extra se pasan tal cual a `docker compose up`.

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ComposeArgs = @()
)

$ErrorActionPreference = 'Stop'
$compose = Join-Path $PSScriptRoot 'docker-compose.yml'

# `up.ps1` necesita que el arranque devuelva el control para poder re-montar
# después, así que siempre corre en segundo plano.
if ($ComposeArgs -notcontains '-d' -and $ComposeArgs -notcontains '--detach') {
    $ComposeArgs += '-d'
}

# --- 1. Esperar a que el motor de Docker responda -------------------------
Write-Host "→ Esperando al motor de Docker..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(120)
while ($true) {
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    if ((Get-Date) -gt $deadline) {
        Write-Host "❌ Docker no respondió en 120s. ¿Está Docker Desktop iniciado?" -ForegroundColor Red
        exit 1
    }
    Start-Sleep -Seconds 3
}
Write-Host "  ✔ Motor de Docker listo" -ForegroundColor DarkGray

# --- 2. Levantar los contenedores ----------------------------------------
Write-Host "→ docker compose up $($ComposeArgs -join ' ')" -ForegroundColor Cyan
docker compose -f $compose up @ComposeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Falló 'docker compose up' (código $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

# --- 3. Re-montar las unidades que hagan falta ----------------------------
& (Join-Path $PSScriptRoot 'remount-host-drive.ps1') -All

# --- 4. Comprobación final desde dentro del contenedor -------------------
Write-Host "→ Verificando los montajes desde ubeflix-backend..." -ForegroundColor Cyan
docker exec ubeflix-backend node -e @'
const fs = require('fs');
for (const d of fs.readdirSync('/host').sort()) {
  try { fs.readdirSync('/host/' + d); console.log('  OK    /host/' + d); }
  catch (e) { console.log('  FALLA /host/' + d + ' -> ' + e.code); }
}
'@
