const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

const { authenticateToken } = require('./middleware/auth');
const httpLogger = require('./middleware/httpLogger');

const authRoutes = require('./routes/auth');
const videosRoutes = require('./routes/videos');
const librariesRoutes = require('./routes/libraries');
const favoritesRoutes = require('./routes/favorites');
const usersRoutes = require('./routes/users');
const subtitlesRoutes = require('./routes/subtitles');
const musicRoutes = require('./routes/music');
const comicsRoutes = require('./routes/comics');
const torrentsRoutes = require('./routes/torrents');
const imagesRoutes = require('./routes/images');
const searchRoutes = require('./routes/search');
const dashboardRoutes = require('./routes/dashboard');
const livetvRoutes = require('./routes/livetv');

const { runMigrations } = require('./migrations/runner');
const { startSubtitleCron } = require('./services/subtitleCron');
const { resetStuckDownloads, initSpotdlConfig } = require('./services/spotifySync');
const { resumeOnStartup: resumeTorrents } = require('./services/torrents');
const { bootstrapAdmin } = require('./services/bootstrapAdmin');

const app = express();
const PORT = process.env.PORT || 5566;

// El backend vive detrás de nginx (y opcionalmente de un túnel cloudflare), así
// que sin esto `req.ip` es siempre la IP de nginx y el rate limit del login se
// vuelve global: un solo atacante bloquearía el acceso de todos los usuarios.
// Confiamos únicamente en proxies de red privada (la red Docker / la LAN); un
// cliente que llegue directo desde internet no puede falsificar X-Forwarded-For.
app.set('trust proxy', process.env.TRUST_PROXY || 'uniquelocal');

// ─── Process-level safety net ────────────────────────────────────────────
// The embedded BitTorrent client (WebTorrent) emits stray errors from
// tracker/DHT/UDP sockets that would otherwise take down the media server, so
// those are logged and swallowed. Anything else is a real bug: swallowing it
// leaves the process in an unknown state, so we exit and let Docker's
// `restart: unless-stopped` bring back a clean one.
const TOLERATED_ERROR_SOURCES = [
  /webtorrent/i,
  /bittorrent/i,
  /torrent-discovery/i,
  /\bdht\b/i,
  /\butp\b/i,
  /bep\d+/i,
  /ut_metadata/i,
  /simple-peer/i,
];

function isTolerableBackgroundError(err) {
  const description = (err && err.stack) || String(err);
  return TOLERATED_ERROR_SOURCES.some((pattern) => pattern.test(description));
}

process.on('uncaughtException', (err) => {
  if (isTolerableBackgroundError(err)) {
    console.error('⚠️  [uncaughtException] error del cliente torrent, se continúa:', err && err.stack ? err.stack : err);
    return;
  }
  console.error('💀 [uncaughtException] error no recuperable, cerrando:', err && err.stack ? err.stack : err);
  // Give the log a tick to flush before exiting.
  setTimeout(() => process.exit(1), 100).unref();
});

// Rejections don't corrupt process state the way an uncaught throw does, and
// route handlers now funnel theirs to the error middleware via asyncHandler.
// What reaches here is background work — log it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  [unhandledRejection] keeping process alive:', reason && reason.stack ? reason.stack : reason);
});

// ─── Middleware ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow localhost and any trycloudflare tunnel
    const allowed = [
      'http://localhost:3344',
      'http://localhost:5173',
    ];
    let hostname;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return callback(new Error('Not allowed by CORS'));
    }
    if (allowed.includes(origin) || /\.trycloudflare\.com$/.test(hostname)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(httpLogger);

// ─── Health check ────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'ubeFlix API', timestamp: new Date().toISOString() });
});

// ─── Public routes ───────────────────────────────────────────────────────
app.use('/api/auth', (req, res, next) => {
  // /login and /register are public, /me requires auth
  if (req.path === '/me' || req.path === '/media-token') {
    return authenticateToken(req, res, next);
  }
  next();
}, authRoutes);

// ─── Protected routes ────────────────────────────────────────────────────
app.use('/api/videos', authenticateToken, videosRoutes);
app.use('/api/libraries', authenticateToken, librariesRoutes);
app.use('/api/favorites', authenticateToken, favoritesRoutes);
app.use('/api/users', authenticateToken, usersRoutes);
app.use('/api/subtitles', authenticateToken, subtitlesRoutes);
app.use('/api/music', authenticateToken, musicRoutes);
app.use('/api/comics', authenticateToken, comicsRoutes);
app.use('/api/torrents', authenticateToken, torrentsRoutes);
app.use('/api/images', authenticateToken, imagesRoutes);
app.use('/api/search', authenticateToken, searchRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/livetv', authenticateToken, livetvRoutes);

// ─── Error handling ──────────────────────────────────────────────────────
// Anything a route passes to next(err) — including rejected promises via
// asyncHandler — lands here.
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err && err.stack ? err.stack : err);
  // The response may already be streaming (video, images); nothing to do but
  // let it end, or Express will throw ERR_HTTP_HEADERS_SENT.
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── Startup ─────────────────────────────────────────────────────────────
// Migrations run before the first request so routes can assume the schema
// exists, instead of each one running DDL on every call.
async function start() {
  try {
    await runMigrations();
  } catch (err) {
    // Keep serving: /api/health stays up and the logs say what went wrong,
    // which beats a container in a crash loop.
    console.error('❌ No se pudieron aplicar las migraciones:', err.message);
  }

  await bootstrapAdmin();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎬 ubeFlix API running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`   Videos path: ${process.env.VIDEOS_PATH || './videos'}\n`);

    // Reset any tracks stuck in 'downloading' from previous runs
    initSpotdlConfig();
    resetStuckDownloads();
    // Resume any unfinished torrent downloads and start the stats poller
    resumeTorrents();
    // Start subtitle download cron job
    if (process.env.OPENSUBTITLES_API_KEY) {
      startSubtitleCron();
    } else {
      console.log('⚠️  OPENSUBTITLES_API_KEY not set — subtitle cron disabled');
    }
  });
}

start();
