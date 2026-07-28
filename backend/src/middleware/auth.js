const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '7d';
// Long enough to watch a film without interruption, short enough that a token
// leaked through a proxy log or browser history is worth little.
const MEDIA_TOKEN_TTL = process.env.MEDIA_TOKEN_TTL || '6h';

// `<video src>`, `<img src>` and hls.js segment requests can't set an
// Authorization header, so those URLs carry the token as a query parameter —
// where it ends up in nginx access logs, browser history and Referer headers.
// Media tokens exist so what leaks there is short-lived and can only read media,
// never reach an admin endpoint.
const MEDIA_PATH_PATTERNS = [
  /^\/api\/images\//,
  /^\/api\/videos\/\d+\/stream\b/,
  /^\/api\/videos\/\d+\/hls\//,
  /^\/api\/subtitles\/\d+\/file\/\d+/,
  /^\/api\/subtitles\/thumbnails\/(file|series)\/\d+/,
  /^\/api\/music\/tracks\/\d+\/stream\b/,
  /^\/api\/comics\/\d+\/(page\/\d+|cover|file)\b/,
  /^\/api\/livetv\/(proxy|stream)\b/,
];

function isMediaRequest(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  // originalUrl includes the mount prefix stripped from req.path by the router.
  const pathname = (req.originalUrl || req.url).split('?')[0];
  return MEDIA_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Also accept token from query string (needed for <video> src attribute)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }

  if (decoded.type === 'media' && !isMediaRequest(req)) {
    return res.status(403).json({ error: 'Este token solo permite reproducir contenido' });
  }

  req.user = decoded;
  req.tokenType = decoded.type === 'media' ? 'media' : 'access';
  next();
}

function requireAdmin(req, res, next) {
  // A media token never carries admin rights, whatever the account can do.
  if (req.tokenType === 'media' || !req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Se requieren permisos de administrador' });
  }
  next();
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      type: 'access',
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

// Deliberately minimal: an id and the media scope, no email or admin flag.
function generateMediaToken(user) {
  return jwt.sign(
    { id: user.id, type: 'media' },
    JWT_SECRET,
    { expiresIn: MEDIA_TOKEN_TTL }
  );
}

module.exports = {
  authenticateToken,
  requireAdmin,
  generateToken,
  generateMediaToken,
  isMediaRequest,
  MEDIA_TOKEN_TTL,
};
