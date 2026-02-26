/**
 * Logger service with file rotation (1GB max per file).
 * Outputs colored logs to console and writes to /tmp/ubeflix-logs/
 */
const fs = require('fs');
const path = require('path');

const LOGS_DIR = '/tmp/ubeflix-logs';
const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB

// ANSI color codes
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  // Foreground
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
  // Background
  bgRed:    '\x1b[41m',
  bgGreen:  '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue:   '\x1b[44m',
};

// Status code color
function statusColor(code) {
  if (code >= 500) return C.red;
  if (code >= 400) return C.yellow;
  if (code >= 300) return C.cyan;
  if (code >= 200) return C.green;
  return C.white;
}

// Method color
function methodColor(method) {
  switch (method) {
    case 'GET':    return C.green;
    case 'POST':   return C.blue;
    case 'PUT':    return C.yellow;
    case 'PATCH':  return C.yellow;
    case 'DELETE': return C.red;
    default:       return C.white;
  }
}

// Ensure logs dir exists
try {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch {}

let currentLogFile = null;
let currentLogStream = null;
let currentFileSize = 0;

/**
 * Get or create the current log file stream.
 * Rotates when file exceeds MAX_FILE_SIZE.
 */
function getLogStream() {
  // Check if we need a new file
  if (currentLogStream && currentFileSize < MAX_FILE_SIZE) {
    return currentLogStream;
  }

  // Close existing stream
  if (currentLogStream) {
    try { currentLogStream.end(); } catch {}
  }

  // Create new log file with timestamp
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
  currentLogFile = path.join(LOGS_DIR, `ubeflix_${ts}.log`);
  currentLogStream = fs.createWriteStream(currentLogFile, { flags: 'a' });
  currentFileSize = 0;

  console.log(`${C.cyan}📝 [Logger] New log file: ${currentLogFile}${C.reset}`);
  return currentLogStream;
}

/**
 * Strip ANSI color codes for file output
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Truncate large bodies for logging (max 2KB)
 */
function truncateBody(body, maxLen = 2048) {
  if (!body) return null;
  let str;
  if (typeof body === 'string') {
    str = body;
  } else if (Buffer.isBuffer(body)) {
    str = `<Buffer ${body.length} bytes>`;
  } else {
    try {
      str = JSON.stringify(body);
    } catch {
      str = String(body);
    }
  }
  if (str.length > maxLen) {
    return str.substring(0, maxLen) + `... (${str.length} chars total)`;
  }
  return str;
}

/**
 * Write a log entry to both console and file
 */
function writeLog(coloredMsg, plainMsg) {
  // Console with colors
  process.stdout.write(coloredMsg + '\n');

  // File without colors
  const stream = getLogStream();
  const line = (plainMsg || stripAnsi(coloredMsg)) + '\n';
  stream.write(line);
  currentFileSize += Buffer.byteLength(line);
}

/**
 * Format a timestamp
 */
function ts() {
  return new Date().toISOString();
}

/**
 * Log an HTTP request/response
 */
function logHttp({ method, url, statusCode, duration, reqBody, resBody, ip, contentType }) {
  const timestamp = ts();
  const mc = methodColor(method);
  const sc = statusColor(statusCode);
  const durationStr = duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(2)}s`;
  const durationColor = duration > 3000 ? C.red : duration > 1000 ? C.yellow : C.green;

  // Main line
  const line1 = `${C.gray}${timestamp}${C.reset} ${mc}${C.bold}${method.padEnd(7)}${C.reset} ${C.white}${url}${C.reset} ${sc}${C.bold}${statusCode}${C.reset} ${durationColor}${durationStr}${C.reset} ${C.dim}${ip || ''}${C.reset}`;

  writeLog(line1);

  // Request body (only for POST/PUT/PATCH and non-empty)
  if (['POST', 'PUT', 'PATCH'].includes(method) && reqBody && Object.keys(reqBody).length > 0) {
    // Mask sensitive fields
    const sanitized = { ...reqBody };
    if (sanitized.password) sanitized.password = '***';
    if (sanitized.password_hash) sanitized.password_hash = '***';
    if (sanitized.token) sanitized.token = sanitized.token.substring(0, 10) + '...';

    const bodyStr = truncateBody(sanitized);
    const line2 = `  ${C.cyan}➡ REQ${C.reset} ${C.dim}${bodyStr}${C.reset}`;
    writeLog(line2);
  }

  // Response body (only for JSON responses, skip large ones and binary)
  if (resBody && contentType && contentType.includes('json')) {
    const bodyStr = truncateBody(resBody);
    const color = statusCode >= 400 ? C.red : C.dim;
    const line3 = `  ${C.magenta}⬅ RES${C.reset} ${color}${bodyStr}${C.reset}`;
    writeLog(line3);
  }
}

/**
 * Log a general message
 */
function logInfo(msg) {
  writeLog(`${C.gray}${ts()}${C.reset} ${C.blue}ℹ${C.reset} ${msg}`);
}

function logWarn(msg) {
  writeLog(`${C.gray}${ts()}${C.reset} ${C.yellow}⚠${C.reset} ${C.yellow}${msg}${C.reset}`);
}

function logError(msg) {
  writeLog(`${C.gray}${ts()}${C.reset} ${C.red}✖${C.reset} ${C.red}${msg}${C.reset}`);
}

module.exports = {
  logHttp,
  logInfo,
  logWarn,
  logError,
  writeLog,
  C,
};
