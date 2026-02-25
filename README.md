<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

# 🎬 ubeFlix

> Media server personal, auto-hospedado e inspirado en Jellyfin/Plex. Gestiona, organiza y reproduce tu colección completa de películas y series directamente desde el navegador.

---

## ✨ Características

### Reproducción y contenido
- 🎥 **Streaming HTTP con seek** — Soporte de rango (Range headers) para saltar en el video
- 📺 **Detección inteligente de series** — Parsea `S01E01`, `1x01`, `Episode 01`, carpetas de temporada
- 🎬 **Gestión de películas** — Extrae título, año y limpia nombres de archivo
- 🖼️ **Posters y banners** — Detecta automáticamente `poster.jpg`, `cover.jpg`, `banner.jpg`
- 💾 **Progreso de reproducción** — Guarda cada 10 segundos, continúa donde lo dejaste
- 📊 **Barra de progreso** visual en las tarjetas de "Continuar viendo"

### Organización
- 📁 **Bibliotecas múltiples** — Apunta a tantas carpetas como quieras
- 🔍 **Escaneo recursivo** — Detecta contenido dentro de subcarpetas automáticamente
- ❤️ **Favoritos** — Marca películas y series como favoritas
- 🔎 **Búsqueda unificada** — Busca películas y series simultáneamente con resultados en tiempo real

### Administración
- 👥 **Gestión de usuarios** — Panel admin para crear, editar y eliminar usuarios
- 🔐 **Autenticación JWT** — Login/registro con tokens de 7 días
- 🛡️ **Roles** — Control de permisos admin/usuario
- ⚙️ **Página de configuración** — Información del servidor y cuenta

### Interfaz
- 🎨 **Tema oscuro** estilo Jellyfin con gradientes accent
- 📱 **Responsive** — Menú hamburguesa en móvil con sidebar deslizante
- 🃏 **Media cards** con hover, overlay de reproducción y botón de favorito
- 🏠 **Dashboard** — Stats, "Continuar viendo" y "Agregados recientemente"

### Infraestructura
- 🐳 **Docker Compose** — Tres servicios listos para producción
- 🔄 **Nginx** — Reverse proxy con gzip y buffering optimizado para video
- 🗄️ **PostgreSQL 16** — Base de datos con esquema migrado automáticamente

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

### 2. Preparar carpetas de video
```bash
mkdir -p videos/peliculas videos/series
```

Copia tus archivos de video siguiendo la [estructura recomendada](#-estructura-de-carpetas).

### 3. Levantar los servicios
```bash
docker-compose up -d --build
```

### 4. Acceder
Abre **http://localhost:3000** en tu navegador.

### Credenciales por defecto

| Campo | Valor |
|-------|-------|
| **Usuario** | `admin` |
| **Contraseña** | `admin123` |

> ⚠️ Cambia la contraseña del administrador después del primer inicio de sesión.

### 5. Agregar contenido
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
    ├── 1x01 - Winter Is Coming.mp4
    ├── 1x02 - The Kingsroad.mp4
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

### Imágenes detectadas automáticamente
`poster.jpg`, `poster.png`, `cover.jpg`, `cover.png`, `folder.jpg`, `banner.jpg`, `banner.png`, `backdrop.jpg`

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
| `GET` | `/api/videos` | Listar videos (soporta `?type`, `?search`, `?library_id`, `?limit`, `?offset`) |
| `GET` | `/api/videos/recent` | Últimos 20 videos agregados |
| `GET` | `/api/videos/:id` | Detalle de video |
| `GET` | `/api/videos/:id/stream` | Stream de video (HTTP Range) |
| `GET` | `/api/videos/series/list` | Listar todas las series |
| `GET` | `/api/videos/series/:id` | Detalle de serie con temporadas y episodios |
| `POST` | `/api/videos/:id/progress` | Guardar progreso de reproducción |
| `GET` | `/api/videos/:id/progress` | Obtener progreso de reproducción |
| `GET` | `/api/favorites` | Listar favoritos del usuario |
| `POST` | `/api/favorites` | Agregar/quitar favorito (toggle) |
| `GET` | `/api/favorites/check` | Verificar si un item es favorito |
| `GET` | `/api/images/*` | Servir imágenes (posters, banners) |

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

---

## 🗄️ Base de datos

### Esquema (PostgreSQL)

```
users ──────────── watch_progress ──────────── videos
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
| `series` | Metadatos de series |
| `seasons` | Temporadas de series |
| `videos` | Películas y episodios |
| `watch_progress` | Progreso por usuario y video |
| `favorites` | Favoritos (videos o series) por usuario |

---

## ⚙️ Configuración

### Puertos

| Servicio | Puerto externo | Puerto interno |
|----------|---------------|----------------|
| Frontend (Nginx) | `3000` | `80` |
| Backend (Express) | `3001` | `3001` |
| PostgreSQL | `5433` | `5432` |

### Variables de entorno

Configura en `docker-compose.yml`:

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `DB_HOST` | `db` | Host de PostgreSQL |
| `DB_PORT` | `5432` | Puerto interno de PostgreSQL |
| `DB_NAME` | `ubeflix` | Nombre de la base de datos |
| `DB_USER` | `ubeflix_user` | Usuario de PostgreSQL |
| `DB_PASSWORD` | `ubeflix_secret_2024` | Contraseña de PostgreSQL |
| `JWT_SECRET` | `ubeflix_jwt_super_secret_key_2024` | Secreto para firmar tokens JWT |
| `VIDEOS_PATH` | `/videos` | Ruta de montaje de videos en el contenedor |
| `PORT` | `3001` | Puerto del servidor backend |

> 🔒 **Producción:** Cambia `JWT_SECRET` y `DB_PASSWORD` por valores seguros propios.

---

## 🛠️ Tech Stack

| Capa | Tecnología |
|------|------------|
| **Frontend** | React 18, Vite, React Router 6, Axios, Lucide Icons |
| **Backend** | Node.js, Express 4, JWT, bcryptjs |
| **Base de datos** | PostgreSQL 16 (Alpine) |
| **Proxy** | Nginx (producción), Vite dev proxy (desarrollo) |
| **Contenedores** | Docker, Docker Compose |

---

## 💻 Desarrollo local

### Backend
```bash
cd backend
npm install
npm run dev       # nodemon con hot-reload en http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev       # Vite dev server en http://localhost:5173
```

> El servidor de desarrollo de Vite hace proxy automático de `/api` a `http://localhost:3001`.

### Base de datos
```bash
# Solo levantar PostgreSQL
docker-compose up -d db

# Ver logs
docker-compose logs -f db
```

---

## 📁 Estructura del proyecto

```
ubeFlix/
├── docker-compose.yml
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── scripts/
│   │   └── generate-hash.js        # Utilidad para generar hashes bcrypt
│   └── src/
│       ├── index.js                 # Entry point, rutas principales
│       ├── config/
│       │   └── db.js                # Pool de conexión PostgreSQL
│       ├── middleware/
│       │   └── auth.js              # JWT auth + requireAdmin
│       ├── migrations/
│       │   └── init.sql             # Esquema completo de la DB
│       ├── routes/
│       │   ├── auth.js              # Login, registro, perfil
│       │   ├── favorites.js         # CRUD de favoritos
│       │   ├── libraries.js         # Gestión de bibliotecas
│       │   ├── users.js             # Gestión de usuarios (admin)
│       │   └── videos.js            # Streaming, series, progreso
│       └── services/
│           └── scanner.js           # Escaneo recursivo de archivos
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
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
│       │   └── MediaCard.jsx        # Tarjeta de contenido reutilizable
│       ├── context/
│       │   └── AuthContext.jsx      # Estado global de autenticación
│       └── pages/
│           ├── DashboardPage.jsx    # Inicio con stats y secciones
│           ├── FavoritesPage.jsx    # Grid de favoritos
│           ├── LibrariesPage.jsx    # CRUD de bibliotecas (admin)
│           ├── LoginPage.jsx        # Login + registro
│           ├── MoviesPage.jsx       # Grid de películas
│           ├── PlayerPage.jsx       # Reproductor de video
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

- [ ] Soporte de subtítulos (`.srt`, `.vtt`)
- [ ] Transcoding con FFmpeg (HLS/DASH para MKV)
- [ ] Extracción de metadatos con `ffprobe` (duración, resolución)
- [ ] Metadatos externos (TMDB/OMDB — sinopsis, ratings, géneros)
- [ ] Filtrado por género/categoría
- [ ] Paginación en grids de contenido
- [ ] Soporte de múltiples pistas de audio
- [ ] Atajos de teclado en el reproductor
- [ ] Personalización de tema/branding
- [ ] Historial de escaneo (archivos agregados/omitidos)

---

## 📄 Licencia

MIT
