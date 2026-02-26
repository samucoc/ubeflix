<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/FFmpeg-HLS_Transcoding-007808?logo=ffmpeg&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

# 🎬 ubeFlix

> Media server personal auto-hospedado, inspirado en Jellyfin/Plex. Gestiona, organiza y reproduce tu colección completa de películas y series directamente desde el navegador — con transcoding HLS en tiempo real, subtítulos automáticos y un reproductor estilo Netflix.

---

## ✨ Características

### 🎥 Reproducción y streaming
- **Streaming HTTP con seek** — Soporte de rango (Range headers) para navegación instantánea
- **Transcoding HLS en tiempo real** — FFmpeg genera segmentos `.ts` al vuelo para formatos incompatibles (MKV, codecs no nativos)
- **Detección inteligente de codecs** — ffprobe identifica video/audio codec, solo transcodifica lo necesario (copia streams compatibles)
- **Caché de codecs** — Probing una sola vez, almacena `video_codec`, `audio_codec` y `needs_transcoding` en la DB
- **Reproductor Netflix-style** — Barra de seek personalizada con indicador de buffer, controles de volumen, skip ±10s, fullscreen, auto-hide tras 3s de inactividad
- **HLS.js** — Buffer configurable, reintentos automáticos, recuperación de errores de red/media, fallback nativo para Safari
- **Progreso de reproducción** — Auto-guarda cada 10s + al salir de la página; marca completado a 30s del final; reanuda donde lo dejaste
- **Atajos de teclado** — `Espacio`/`K` (play/pause), `←`/`→` (±10s), `↑`/`↓` (volumen), `F` (fullscreen), `M` (mute), `Esc` (cerrar menús)

### 🔤 Sistema de subtítulos
- **Extracción de subtítulos embebidos** — ffprobe detecta streams de subtítulos, ffmpeg extrae codecs texto (`subrip`, `ass`, `ssa`, `webvtt`, `mov_text`), conversión automática a VTT, 4 extracciones concurrentes
- **Detección de subtítulos externos** — Encuentra archivos `.srt`/`.vtt`/`.ass`/`.ssa`/`.sub` junto a los videos, detecta idioma por nombre de archivo
- **OpenSubtitles.com** — Búsqueda y descarga automática vía API REST; sesiones con token (24h), hasta 20 descargas/día autenticado; filtra subtítulos AI-traducidos; prefiere uploaders de confianza
- **SubDivX.com** — Scraper de subtítulos en español con integración FlareSolverr para bypass de Cloudflare; sesiones persistentes entre requests
- **Cron automático** — Ejecución diaria a las 3:00 AM + 30s post-arranque; descarga hasta 20 subs/día; prioriza películas, luego episodios (serie → temporada → episodio)
- **Gestión desde el reproductor** — Seleccionar, habilitar/deshabilitar pistas; admin: buscar en OpenSubtitles, descargar, subir y eliminar subtítulos sin salir del player
- **Subida manual** — Soporte para `.srt`/`.vtt`/`.ass`/`.ssa`/`.sub` (máx 5MB), conversión automática SRT→VTT
- **Extracción masiva por biblioteca** — Extrae embebidos + externos de todos los videos con progreso SSE en tiempo real

### 🖼️ Thumbnails y posters
- **Generación automática de thumbnails** — ffmpeg captura frame al 10% de duración, escala a 480px
- **Thumbnails de series** — Usa primer episodio (al 15% de duración)
- **Generación masiva por biblioteca** — Procesamiento en background con progreso SSE
- **Detección automática de imágenes** — `poster.jpg`, `poster.png`, `cover.jpg`, `cover.png`, `folder.jpg`, `banner.jpg`, `banner.png`, `backdrop.jpg`
- **Caché HTTP** — Thumbnails servidos con cache de 24h y cadena de fallback multinivel

### 📺 Detección inteligente de contenido
- **Parseo de series** — Reconoce `S01E01`, `s01e01`, `1x01`, `Episode 01`, `Episodio 01`, `E01`
- **Carpetas de temporada** — Soporta `Season X`, `Temporada X` (español), y subcarpetas arbitrarias como temporadas autonumeradas
- **Parseo de películas** — Extrae título, año, limpia nombres de archivo
- **13 formatos de video** — `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.webm`, `.m4v`, `.mpg`, `.mpeg`, `.ts`, `.vob`, `.ogv`, `.3gp`
- **Filtrado inteligente** — Ignora carpetas `extras`, `featurettes`, `behind the scenes`, `trailers`, `subs`; ignora archivos `sample`
- **Limpieza automática** — Elimina entradas de la DB cuando los archivos ya no existen; limpia temporadas/series vacías en cascada
- **Estadísticas de escaneo** — Retorna conteos de añadidos/actualizados/eliminados/omitidos/errores

### 📁 Organización
- **Bibliotecas múltiples** — Apunta a tantas carpetas como quieras
- **Escaneo recursivo** — Detecta contenido dentro de subcarpetas automáticamente
- **Favoritos** — Marca películas y series como favoritas
- **Búsqueda unificada** — Busca películas y series simultáneamente con resultados en tiempo real

### 👥 Administración
- **Gestión de usuarios** — Panel admin para crear, editar y eliminar usuarios
- **Autenticación JWT** — Login/registro con tokens de 7 días
- **Roles** — Control de permisos admin/usuario
- **Página de configuración** — Información del servidor y cuenta

### 🎨 Interfaz
- **Tema oscuro** estilo Jellyfin con gradientes accent
- **Responsive** — Menú hamburguesa en móvil con sidebar deslizante
- **Media cards** con hover, overlay de reproducción y botón de favorito
- **Dashboard** — Stats, "Continuar viendo" y "Agregados recientemente"
- **Progress Toast** — Barras de progreso animadas con SSE para operaciones largas (thumbnails, subtítulos), auto-dismiss al completar

### 📝 Logging
- **Dual output** — Consola ANSI con colores + archivos en `/tmp/ubeflix-logs/`
- **Rotación** de archivos a 1GB
- **HTTP logging** — Método, URL, status, duración, IP; coloreado por status y método
- **Duración destacada** — Verde <1s, amarillo <3s, rojo >3s
- **Seguridad** — Passwords y tokens redactados automáticamente; endpoints binarios/streaming excluidos

### 🐳 Infraestructura
- **Docker Compose** — Tres servicios listos para producción
- **Multi-stage build** — Node 20 compila Vite, Nginx Alpine sirve assets
- **Nginx optimizado** — Gzip nivel 6, WebSocket upgrade, `proxy_buffering off` para video, timeouts de 1h para streams, caché inmutable 1 año para assets estáticos, SPA fallback
- **PostgreSQL 16** — Esquema migrado automáticamente al arranque
- **FFmpeg + 7zip** en Alpine — Transcoding, extracción de subtítulos, thumbnails, descompresión RAR
- **Volúmenes persistentes** — Thumbnails, subtítulos y logs sobreviven a recreaciones de contenedores

---

## 📸 Estructura de la UI

```
┌─────────────────────────────────────────────────────┐
│ ┌──────────┐  ┌──────────────────────────────────┐  │
│ │          │  │  🔍 Buscar películas, series...   │  │
│ │  ubeFlix │  ├──────────────────────────────────┤  │
│ │          │  │                                   │  │
│ │  Inicio  │  │  📊 Stats: Películas · Series ·  │  │
│ │  Películas│  │       Episodios · Bibliotecas    │  │
│ │  Series  │  │                                   │  │
│ │  ❤️ Favs  │  │  ▶️ Continuar viendo             │  │
│ │          │  │  [Card] [Card] [Card] →           │  │
│ │ ─Admin── │  │                                   │  │
│ │  Biblio. │  │  🆕 Agregados recientemente       │  │
│ │  Usuarios│  │  [Card] [Card] [Card] [Card] →    │  │
│ │  Config. │  │                                   │  │
│ │          │  └──────────────────────────────────┘  │
│ │  👤 user │                                        │
│ └──────────┘                                        │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Inicio rápido

### Requisitos
- **Docker** y **Docker Compose** instalados

### 1. Clonar el proyecto
```bash
git clone <tu-repo-url> ubeFlix
cd ubeFlix
```

### 2. Configurar variables de entorno
Crea un archivo `.env` en la raíz (o edita `docker-compose.yml`):
```env
POSTGRES_DB=ubeflix
POSTGRES_USER=ubeflix_user
POSTGRES_PASSWORD=cambia_esto_en_produccion
JWT_SECRET=cambia_esto_tambien
NODE_ENV=production
PORT=5566
REACT_APP_API_URL=http://localhost:5566

# Opcional: subtítulos automáticos
OPENSUBTITLES_API_KEY=tu_api_key
OPENSUBTITLES_USER=tu_usuario
OPENSUBTITLES_PASS=tu_password
```

### 3. Preparar carpetas de video
```bash
mkdir -p videos/peliculas videos/series
```

Copia tus archivos de video siguiendo la [estructura recomendada](#-estructura-de-carpetas).

### 4. Levantar los servicios
```bash
docker-compose up -d --build
```

### 5. Acceder
Abre **http://localhost:3344** en tu navegador.

### Credenciales por defecto

| Campo | Valor |
|-------|-------|
| **Usuario** | `admin` |
| **Contraseña** | `admin123` |

> ⚠️ Cambia la contraseña del administrador después del primer inicio de sesión.

### 6. Agregar contenido
1. Ve a **Bibliotecas** en el menú lateral
2. Haz clic en **Agregar biblioteca**
3. Indica la ruta interna del contenedor:
   - Películas → `/videos/peliculas`
   - Series → `/videos/series`
4. Haz clic en **Escanear**
5. ¡Tu contenido aparecerá en el dashboard!

---

## 📂 Estructura de carpetas

### Películas
```
videos/peliculas/
├── Inception (2010).mp4
├── The Matrix.mkv
├── Interstellar (2014)/
│   ├── Interstellar (2014).mp4
│   └── poster.jpg                  ← detectado automáticamente
└── Dune Part Two (2024).mp4
```

### Series
```
videos/series/
├── Breaking Bad/
│   ├── poster.jpg                  ← poster de la serie
│   ├── Season 1/
│   │   ├── S01E01 - Pilot.mkv
│   │   └── S01E02 - Cat's in the Bag.mkv
│   └── Season 2/
│       ├── S02E01.mkv
│       └── S02E02.mkv
└── Game of Thrones/
    ├── cover.jpg
    ├── Temporada 1/                ← español soportado
    │   ├── 1x01 - Winter Is Coming.mp4
    │   └── 1x02 - The Kingsroad.mp4
    └── Temporada 2/
        └── 2x01.mp4
```

### Formatos de nombre de episodio soportados

| Formato | Ejemplo |
|---------|---------|
| `S01E01` | `S01E01 - Pilot.mkv` |
| `s01e01` | `s01e01.mkv` |
| `1x01` | `1x01 - Winter Is Coming.mp4` |
| `Episode 01` | `Episode 01.mkv` |
| `Episodio 01` | `Episodio 01.mp4` |
| `E01` | `E01.mkv` |

### Formatos de video soportados
`.mp4` `.mkv` `.avi` `.mov` `.wmv` `.flv` `.webm` `.m4v` `.mpg` `.mpeg` `.ts` `.vob` `.ogv` `.3gp`

> Los formatos no reproducibles nativamente en el navegador se transcodifican automáticamente a HLS.

### Imágenes detectadas automáticamente
`poster.jpg` `poster.png` `cover.jpg` `cover.png` `folder.jpg` `banner.jpg` `banner.png` `backdrop.jpg`

---

## 🔌 API Endpoints

### Públicos
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Iniciar sesión |
| `POST` | `/api/auth/register` | Registrar usuario |

### Autenticados
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/auth/me` | Perfil del usuario actual |
| `GET` | `/api/dashboard` | Stats + recientes + continuar viendo |
| `GET` | `/api/search?q=` | Búsqueda unificada (películas + series) |
| `GET` | `/api/videos` | Listar videos (`?type`, `?search`, `?library_id`, `?limit`, `?offset`) |
| `GET` | `/api/videos/recent` | Últimos 20 videos agregados |
| `GET` | `/api/videos/:id` | Detalle de video (incluye info de codecs) |
| `GET` | `/api/videos/:id/stream` | Stream directo de video (HTTP Range) |
| `GET` | `/api/videos/:id/hls/index.m3u8` | Playlist HLS (inicia transcoding) |
| `GET` | `/api/videos/:id/hls/:filename` | Segmentos HLS `.ts` |
| `GET` | `/api/videos/series/list` | Listar todas las series |
| `GET` | `/api/videos/series/:id` | Detalle de serie con temporadas y episodios |
| `POST` | `/api/videos/:id/progress` | Guardar progreso de reproducción |
| `GET` | `/api/videos/:id/progress` | Obtener progreso de reproducción |
| `GET` | `/api/favorites` | Listar favoritos del usuario |
| `POST` | `/api/favorites` | Agregar/quitar favorito (toggle) |
| `GET` | `/api/favorites/check` | Verificar si un item es favorito |
| `GET` | `/api/images/*` | Servir imágenes (posters, banners) |

### Subtítulos
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/subtitles/:videoId` | Listar subtítulos de un video |
| `GET` | `/api/subtitles/:videoId/file/:subId` | Servir archivo VTT |
| `POST` | `/api/subtitles/:videoId/extract` | Extraer subtítulos embebidos |
| `POST` | `/api/subtitles/:videoId/search` | Buscar en OpenSubtitles |
| `POST` | `/api/subtitles/:videoId/download` | Descargar de OpenSubtitles |
| `POST` | `/api/subtitles/:videoId/upload` | Subir archivo de subtítulo |
| `DELETE` | `/api/subtitles/:videoId/:subId` | Eliminar subtítulo |
| `POST` | `/api/subtitles/batch-check` | Verificar subs para múltiples videos (máx 200) |
| `GET` | `/api/subtitles/progress/stream/:taskId` | Stream SSE de progreso |
| `GET` | `/api/subtitles/progress/active` | Tareas activas |

### Thumbnails
| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/subtitles/thumbnails/generate/:videoId` | Generar thumbnail de un video |
| `POST` | `/api/subtitles/thumbnails/library/:libraryId` | Generar thumbnails de toda la biblioteca |
| `GET` | `/api/subtitles/thumbnails/file/:videoId` | Servir thumbnail de video |
| `GET` | `/api/subtitles/thumbnails/series/:seriesId` | Servir thumbnail de serie |

### Solo administradores
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/libraries` | Listar bibliotecas |
| `POST` | `/api/libraries` | Crear biblioteca |
| `POST` | `/api/libraries/:id/scan` | Escanear biblioteca |
| `DELETE` | `/api/libraries/:id` | Eliminar biblioteca |
| `GET` | `/api/users` | Listar usuarios |
| `PUT` | `/api/users/:id` | Editar usuario |
| `DELETE` | `/api/users/:id` | Eliminar usuario |
| `POST` | `/api/subtitles/library/:libraryId/extract-all` | Extraer subs de toda la biblioteca |
| `POST` | `/api/subtitles/library/:libraryId/auto-opensubtitles` | Descarga masiva de OpenSubtitles |
| `POST` | `/api/subtitles/cron/run` | Ejecutar cron de subtítulos manualmente |

---

## 🗄️ Base de datos

### Esquema (PostgreSQL)

```
users ──────────── watch_progress ──────────── videos ──── subtitles
  │                                              │
  └──── favorites ─────────────────── series ────┘
                                        │
                                     seasons
                                        │
                                   libraries
```

| Tabla | Descripción |
|-------|-------------|
| `users` | Usuarios con roles (admin/usuario) |
| `libraries` | Carpetas de contenido (películas/series) |
| `series` | Metadatos de series (poster, banner, thumbnail, año) |
| `seasons` | Temporadas de series |
| `videos` | Películas y episodios (codec info, tamaño, resolución) |
| `subtitles` | Subtítulos por video (idioma, formato, fuente, path) |
| `watch_progress` | Progreso por usuario y video |
| `favorites` | Favoritos (videos o series) por usuario |

---

## ⚙️ Configuración

### Puertos

| Servicio | Puerto externo | Puerto interno |
|----------|---------------|----------------|
| Frontend (Nginx) | `3344` | `80` |
| Backend (Express) | `5566` | `5566` |
| PostgreSQL | `5433` | `5432` |

### Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `POSTGRES_DB` | Nombre de la base de datos |
| `POSTGRES_USER` | Usuario de PostgreSQL |
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL |
| `JWT_SECRET` | Secreto para firmar tokens JWT |
| `NODE_ENV` | Entorno (`production` / `development`) |
| `PORT` | Puerto del servidor backend (default: `5566`) |
| `VIDEOS_PATH` | Ruta de montaje de videos en el contenedor |
| `REACT_APP_API_URL` | URL del backend para el frontend |
| `OPENSUBTITLES_API_KEY` | API key de OpenSubtitles.com |
| `OPENSUBTITLES_USER` | Usuario de OpenSubtitles (sube el límite a 20/día) |
| `OPENSUBTITLES_PASS` | Contraseña de OpenSubtitles |
| `FLARESOLVERR_URL` | Endpoint de FlareSolverr para SubDivX |

> 🔒 **Producción:** Cambia `JWT_SECRET` y `POSTGRES_PASSWORD` por valores seguros propios.

---

## 🛠️ Tech Stack

| Capa | Tecnología |
|------|------------|
| **Frontend** | React 18, Vite 5, React Router 6, HLS.js, Axios, Lucide Icons, SweetAlert2 |
| **Backend** | Node.js, Express 4, JWT, bcryptjs, Cheerio, Compression, Helmet |
| **Media** | FFmpeg (transcoding HLS, thumbnails, subtítulos), ffprobe (detección de codecs), 7zip (RAR) |
| **Subtítulos** | OpenSubtitles.com API, SubDivX.com (scraper), FlareSolverr |
| **Base de datos** | PostgreSQL 16 (Alpine) |
| **Proxy** | Nginx (producción, gzip, streaming optimizado), Vite dev proxy (desarrollo) |
| **Contenedores** | Docker, Docker Compose, multi-stage builds |

---

## 💻 Desarrollo local

### Backend
```bash
cd backend
npm install
npm run dev       # nodemon con hot-reload en http://localhost:5566
```

### Frontend
```bash
cd frontend
npm install
npm run dev       # Vite dev server en http://localhost:5173
```

> El servidor de desarrollo de Vite hace proxy automático de `/api` a `http://localhost:5566`.

### Base de datos
```bash
# Solo levantar PostgreSQL
docker-compose up -d db

# Ver logs
docker-compose logs -f db
```

### Scripts útiles
```bash
# Generar hash bcrypt para passwords
node backend/scripts/generate-hash.js

# Diagnóstico de subtítulos (videos con/sin subs)
node backend/scripts/check-subs.js
```

---

## 📁 Estructura del proyecto

```
ubeFlix/
├── docker-compose.yml
├── README.md
├── backend/
│   ├── Dockerfile                   # Alpine + FFmpeg + 7zip
│   ├── package.json
│   ├── scripts/
│   │   ├── generate-hash.js        # Utilidad para generar hashes bcrypt
│   │   └── check-subs.js           # Diagnóstico de subtítulos en la DB
│   └── src/
│       ├── index.js                 # Entry point, rutas principales, búsqueda
│       ├── config/
│       │   └── db.js                # Pool de conexión PostgreSQL
│       ├── middleware/
│       │   ├── auth.js              # JWT auth + requireAdmin
│       │   └── httpLogger.js        # Logger HTTP con colores y rotación
│       ├── migrations/
│       │   └── init.sql             # Esquema completo de la DB
│       ├── routes/
│       │   ├── auth.js              # Login, registro, perfil
│       │   ├── favorites.js         # CRUD de favoritos
│       │   ├── libraries.js         # Gestión de bibliotecas
│       │   ├── subtitles.js         # Subtítulos, thumbnails, SSE, cron
│       │   ├── users.js             # Gestión de usuarios (admin)
│       │   └── videos.js            # Streaming, HLS, series, codecs
│       └── services/
│           ├── logger.js            # Logger dual (consola + archivo)
│           ├── opensubtitles.js     # Cliente REST OpenSubtitles.com
│           ├── progress.js          # Task tracker + SSE streaming
│           ├── scanner.js           # Escaneo recursivo + limpieza
│           ├── subdivx.js           # Scraper SubDivX + FlareSolverr
│           ├── subtitleCron.js      # Cron diario de descarga de subs
│           └── subtitles.js         # Extracción, conversión, thumbnails
├── frontend/
│   ├── Dockerfile                   # Multi-stage: Node build → Nginx
│   ├── nginx.conf                   # Reverse proxy optimizado para video
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── api.js                   # Cliente HTTP (Axios)
│       ├── App.jsx                  # Router principal
│       ├── index.css                # Estilos globales (tema oscuro)
│       ├── main.jsx                 # Entry point React
│       ├── components/
│       │   ├── Layout.jsx           # Sidebar + header + búsqueda
│       │   ├── MediaCard.jsx        # Tarjeta de contenido reutilizable
│       │   └── ProgressToast.jsx    # Barras de progreso SSE
│       ├── context/
│       │   └── AuthContext.jsx      # Estado global de autenticación
│       └── pages/
│           ├── DashboardPage.jsx    # Inicio con stats y secciones
│           ├── FavoritesPage.jsx    # Grid de favoritos
│           ├── LibrariesPage.jsx    # CRUD de bibliotecas (admin)
│           ├── LoginPage.jsx        # Login + registro
│           ├── MoviesPage.jsx       # Grid de películas
│           ├── PlayerPage.jsx       # Reproductor Netflix-style + subs
│           ├── SeriesDetailPage.jsx # Detalle de serie + episodios
│           ├── SeriesPage.jsx       # Grid de series
│           ├── SettingsPage.jsx     # Info del servidor y cuenta
│           ├── UsersPage.jsx        # Gestión de usuarios (admin)
│           └── VideoDetailPage.jsx  # Detalle de película
└── videos/
    ├── peliculas/                   # Tus películas aquí
    └── series/                      # Tus series aquí
```

---

## 🐳 Comandos Docker útiles

```bash
# Levantar todo
docker-compose up -d --build

# Ver logs en tiempo real
docker-compose logs -f

# Ver logs de un servicio específico
docker-compose logs -f backend

# Reiniciar un servicio
docker-compose restart backend

# Detener todo
docker-compose down

# Detener y eliminar volúmenes (⚠️ borra la DB)
docker-compose down -v

# Rebuild forzado sin cache
docker-compose build --no-cache
```

---

## 📋 Roadmap

- [x] ~~Soporte de subtítulos (`.srt`, `.vtt`)~~ — Sistema completo multi-fuente
- [x] ~~Transcoding con FFmpeg (HLS)~~ — Transcoding en tiempo real con detección de codecs
- [x] ~~Extracción de metadatos con ffprobe~~ — Codecs + caché en DB
- [x] ~~Atajos de teclado en el reproductor~~ — Space, flechas, F, M, Esc
- [x] ~~Historial de escaneo~~ — Stats de archivos añadidos/actualizados/eliminados
- [ ] Metadatos externos (TMDB/OMDB — sinopsis, ratings, géneros)
- [ ] Filtrado por género/categoría
- [ ] Soporte de múltiples pistas de audio
- [ ] Personalización de tema/branding
- [ ] Aplicación móvil nativa
- [ ] Chromecast / DLNA
- [ ] Watch parties (reproducción sincronizada)

---

## 📄 Licencia

MIT
