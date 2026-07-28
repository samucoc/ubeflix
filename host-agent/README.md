# Agente de remontaje (host)

Pequeño servicio que corre en **Windows (el host)** para reconectar unidades
desde la app con un botón, en vez de correr `remount-host-drive.ps1` a mano.

## Por qué existe

El backend corre dentro de Docker y está aislado: no puede ejecutar `wsl` ni
`mount` del host. Cuando una unidad (p. ej. `H:`) se desconecta/reconecta en
Windows, su montaje en la VM WSL2 `docker-desktop` queda obsoleto (`ENODEV`) y
el explorador de bibliotecas falla. Este agente hace el remontaje en el host y
reinicia el backend para que lo vea.

## Cómo funciona

1. Escucha sólo en `127.0.0.1:9797` (loopback: nada de la LAN puede llamarlo).
2. La app (desde el navegador **en la máquina host**) hace
   `POST http://localhost:9797/remount` con el header `X-Remount-Token`.
3. El agente remonta la unidad vía `wsl -d docker-desktop`, reinicia
   `ubeflix-backend`, espera a que `/api/health` vuelva y recién ahí responde.

El token lo comparte el `.env` del proyecto (`REMOUNT_AGENT_TOKEN`). El backend
sólo se lo entrega a usuarios autenticados, así que un sitio malicioso abierto
en el navegador no puede dispararlo.

## Requisitos (ya presentes en este equipo)

- Node.js en el host
- Docker Desktop (`docker` en el PATH)
- WSL (`wsl` en el PATH)

## Arrancarlo

```powershell
node host-agent\remount-agent.js
```

o doble clic en `host-agent\start-agent.cmd`.

## Que arranque solo con Windows (recomendado)

Creá un acceso directo a `start-agent.cmd` dentro de la carpeta de inicio:

```powershell
# Abre la carpeta de inicio
explorer shell:startup
# Copiá ahí un acceso directo a host-agent\start-agent.cmd
```

O como Tarea programada al iniciar sesión:

```powershell
$action  = New-ScheduledTaskAction -Execute "node.exe" `
  -Argument "host-agent\remount-agent.js" -WorkingDirectory "D:\laragon\www\propios\ubeflix"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "ubeflix-remount-agent" -Action $action -Trigger $trigger
```

## Notas

- El botón de la app funciona cuando usás la app **desde la máquina host**
  (llama a `localhost:9797`). Desde un cliente remoto (teléfono/TV) ese
  `localhost` es el del cliente, no el host: en ese caso reconectá desde el host
  o corré `remount-host-drive.ps1 H`.
- Config por variables de entorno opcionales: `REMOUNT_AGENT_PORT`,
  `REMOUNT_BACKEND_CONTAINER`, `REMOUNT_WSL_DISTRO`, `REMOUNT_BACKEND_HEALTH`.
