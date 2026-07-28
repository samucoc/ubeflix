# Re-monta unidades de Windows en el backend WSL2 de Docker Desktop y reinicia
# el contenedor del backend para que las vea. Útil cuando una unidad externa/USB
# (p.ej. H:) queda como "No such device" dentro del contenedor tras desconectarla
# y reconectarla.
#
# Uso:   .\remount-host-drive.ps1 H
#        .\remount-host-drive.ps1 H D E      (varias)
#        .\remount-host-drive.ps1 -All       (todas las unidades fijas del PC)
#        .\remount-host-drive.ps1 -All -NoRestart
#
# Es idempotente: las unidades que ya están montadas y se pueden leer se dejan
# como están, y el backend sólo se reinicia si realmente hubo algún re-montaje.

[CmdletBinding(DefaultParameterSetName = 'Drives')]
param(
    [Parameter(ParameterSetName = 'Drives', Mandatory = $true, Position = 0)]
    [string[]]$Drives,

    # Detecta automáticamente todas las unidades fijas de Windows (omite CD/DVD
    # y unidades virtuales de sólo lectura).
    [Parameter(ParameterSetName = 'All', Mandatory = $true)]
    [switch]$All,

    # No reiniciar el contenedor del backend al terminar.
    [switch]$NoRestart,

    # Re-montar aunque la unidad ya se lea bien dentro de WSL.
    [switch]$Force
)

if ($All) {
    # DriveType 3 = disco fijo local. Excluye 5 (CD-ROM) y unidades sin letra.
    $Drives = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3' |
              Select-Object -ExpandProperty DeviceID |
              ForEach-Object { $_.TrimEnd(':') } |
              Sort-Object
    Write-Host "→ Unidades detectadas: $($Drives -join ', ')" -ForegroundColor Cyan
}

$remounted = @()
$failed    = @()

# Test de salud de un montaje. Comprueba dos cosas, porque cada una sola da
# falsos positivos:
#   1. Que la unidad figure en la tabla de montajes. Tras un `umount` el
#      directorio sigue existiendo pero vacío, y un `ls` a secas lo daría por
#      bueno.
#   2. Que el `ls` no falle sobre el directorio en sí ("ls: /mnt/host/e: No such
#      device"), que es el síntoma del montaje muerto. No sirve el código de
#      salida de `ls`: en C: falla por pagefile.sys/swapfile.sys ("Permission
#      denied") aunque el directorio se lea perfectamente.
function Test-HostMount {
    param([string]$Letter)
    $probe = "if ! mount | grep -q ' /mnt/host/$Letter '; then echo FAIL; " +
             "elif ls /mnt/host/$Letter 2>&1 >/dev/null | grep -q '^ls: /mnt/host/${Letter}:'; then echo FAIL; " +
             "else echo OK; fi"
    $out = wsl -d docker-desktop -e sh -c $probe
    return ($out -match 'OK')
}

foreach ($d in $Drives) {
    $letter   = $d.TrimEnd(':').ToLower()
    $winDrive = "$($letter.ToUpper()):"

    # ¿Ya está montada y legible? Entonces no la tocamos.
    if (-not $Force -and (Test-HostMount $letter)) {
        Write-Host "  ✔ $winDrive ya está montada, se omite" -ForegroundColor DarkGray
        continue
    }

    Write-Host "→ Re-montando $winDrive en /mnt/host/$letter (docker-desktop)..." -ForegroundColor Cyan

    # Desmontar el montaje obsoleto (lazy), recrear el punto de montaje —el
    # directorio desaparece al desmontar— y re-montar vía drvfs.
    $script = "umount -l /mnt/host/$letter 2>/dev/null; " +
              "mkdir -p /mnt/host/$letter; " +
              "mount -t drvfs '$winDrive' /mnt/host/$letter 2>&1"

    $mountOut = wsl -d docker-desktop -e sh -c $script
    if (Test-HostMount $letter) {
        Write-Host "  ✅ $winDrive montada correctamente" -ForegroundColor Green
        $remounted += $winDrive
    } else {
        Write-Host "  ❌ No se pudo montar $winDrive ($mountOut). ¿Está la unidad conectada en Windows?" -ForegroundColor Red
        $failed += $winDrive
    }
}

if ($remounted.Count -eq 0) {
    Write-Host "✅ Nada que re-montar, todas las unidades ya estaban disponibles." -ForegroundColor Green
} elseif (-not $NoRestart) {
    Write-Host "→ Reiniciando el contenedor del backend para que tome los montajes..." -ForegroundColor Cyan
    docker compose -f "$PSScriptRoot\docker-compose.yml" restart backend | Out-Null
    Start-Sleep -Seconds 4
    Write-Host "✅ Listo ($($remounted -join ', ')). Verificá en la app que las descargas a esas unidades funcionen." -ForegroundColor Green
} else {
    Write-Host "✅ Re-montadas: $($remounted -join ', ') (sin reiniciar el backend)." -ForegroundColor Green
}

if ($failed.Count -gt 0) {
    Write-Host "⚠  Fallaron: $($failed -join ', ')" -ForegroundColor Yellow
}
