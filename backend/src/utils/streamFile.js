const fs = require('fs');

// Byte-range streaming shared by video and audio playback. Both routes had their
// own copy, and the copies had drifted: neither validated the Range header, so a
// malformed or out-of-bounds one produced NaN in Content-Length or a 206 that
// never ended.
//
// Returns true if the response was started, false if the caller should answer
// (the file is unreadable).
async function streamFileWithRange(req, res, filePath, { contentType, cacheControl } = {}) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return false;
  }

  const fileSize = stat.size;
  const range = parseRangeHeader(req.headers.range, fileSize);

  const headers = { 'Accept-Ranges': 'bytes' };
  if (contentType) headers['Content-Type'] = contentType;
  if (cacheControl) headers['Cache-Control'] = cacheControl;

  // A syntactically valid range that falls outside the file must be refused
  // explicitly, otherwise players retry the same bad range forever.
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return true;
  }

  if (range) {
    const chunkSize = range.end - range.start + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`,
      'Content-Length': chunkSize,
    });
    pipeWithCleanup(fs.createReadStream(filePath, { start: range.start, end: range.end }), res);
    return true;
  }

  res.writeHead(200, { ...headers, 'Content-Length': fileSize });
  pipeWithCleanup(fs.createReadStream(filePath), res);
  return true;
}

// Only single-range requests are supported, which is what browsers send for
// media playback. Returns null (serve whole file), a {start,end} pair, or
// 'unsatisfiable'.
function parseRangeHeader(header, fileSize) {
  if (!header || fileSize === 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;

  if (rawStart === '') {
    // Suffix form: "bytes=-500" means the last 500 bytes.
    const suffixLength = parseInt(rawEnd, 10);
    if (suffixLength === 0) return 'unsatisfiable';
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? fileSize - 1 : parseInt(rawEnd, 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= fileSize || start < 0) return 'unsatisfiable';
  if (end >= fileSize) end = fileSize - 1;
  if (end < start) return 'unsatisfiable';

  return { start, end };
}

// If the client disconnects mid-download the read stream must be destroyed, or
// the file handle lingers until GC.
function pipeWithCleanup(stream, res) {
  stream.on('error', () => { if (!res.writableEnded) res.end(); });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

module.exports = { streamFileWithRange, parseRangeHeader };
