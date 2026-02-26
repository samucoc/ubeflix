/**
 * HTTP Request/Response logging middleware.
 * Captures request body and response body, logs with timing.
 */
const { logHttp } = require('../services/logger');

// Skip logging for these paths (binary/streaming)
const SKIP_PATHS = [
  '/api/videos/stream',
  '/api/videos/hls',
  '/api/images',
  '/api/subtitles/',  // file downloads
];

function shouldSkip(url) {
  // Skip streaming/binary endpoints
  if (SKIP_PATHS.some(p => url.startsWith(p))) {
    // But allow subtitle search/download JSON endpoints
    if (url.includes('/search') || url.includes('/download') || url.includes('/extract') || url.includes('/cron')) {
      return false;
    }
    // Skip file serving
    if (url.match(/\/file\//)) return true;
    // Skip image serving
    if (url.startsWith('/api/images')) return true;
    // Skip HLS/stream
    if (url.startsWith('/api/videos/stream') || url.startsWith('/api/videos/hls')) return true;
  }
  return false;
}

function httpLogger(req, res, next) {
  const url = req.originalUrl || req.url;

  // Skip binary/streaming endpoints entirely
  if (shouldSkip(url)) {
    return next();
  }

  const startTime = Date.now();
  const reqBody = req.body;
  const ip = req.ip || req.connection?.remoteAddress || '';

  // Intercept response to capture body
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let resBody = null;
  let contentType = '';

  res.json = function (body) {
    resBody = body;
    contentType = 'application/json';
    return originalJson(body);
  };

  res.send = function (body) {
    if (!resBody) {
      contentType = res.get('Content-Type') || '';
      if (contentType.includes('json')) {
        try {
          resBody = typeof body === 'string' ? JSON.parse(body) : body;
        } catch {
          resBody = body;
        }
      }
    }
    return originalSend(body);
  };

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    contentType = contentType || res.get('Content-Type') || '';

    logHttp({
      method: req.method,
      url,
      statusCode: res.statusCode,
      duration,
      reqBody,
      resBody,
      ip,
      contentType,
    });
  });

  next();
}

module.exports = httpLogger;
