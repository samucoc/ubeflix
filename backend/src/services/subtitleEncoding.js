const fs = require('fs');
const iconv = require('iconv-lite');

function isValidUtf8(buffer) {
  const decoded = buffer.toString('utf8');
  const reencoded = Buffer.from(decoded, 'utf8');
  return reencoded.equals(buffer);
}

function decodeSubtitleBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return '';

  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.slice(3).toString('utf8');
  }

  // UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return iconv.decode(buffer.slice(2), 'utf16-le');
  }

  // UTF-16 BE BOM
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return iconv.decode(buffer.slice(2), 'utf16-be');
  }

  // Prefer UTF-8 if bytes are valid, fallback to Windows-1252 for legacy subtitles.
  if (isValidUtf8(buffer)) return buffer.toString('utf8');
  return iconv.decode(buffer, 'win1252');
}

function normalizeLineEndings(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toVttTextFromDecoded(decodedText, sourceFormat = 'srt') {
  const text = normalizeLineEndings(decodedText);

  if (sourceFormat === 'vtt') {
    const clean = text.replace(/^\uFEFF/, '').trimStart();
    return clean.startsWith('WEBVTT') ? `${clean}\n` : `WEBVTT\n\n${clean}\n`;
  }

  const body = text
    .replace(/^\uFEFF/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return `WEBVTT\n\n${body}\n`;
}

function normalizeSubtitleBufferToUtf8(buffer, format) {
  const decoded = decodeSubtitleBuffer(buffer);
  const text = normalizeLineEndings(decoded).replace(/^\uFEFF/, '');

  if (format === 'srt' || format === 'vtt') {
    return Buffer.from(toVttTextFromDecoded(text, format), 'utf8');
  }

  return Buffer.from(text, 'utf8');
}

function normalizeSubtitleFileInPlace(filePath, format) {
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath);
  const normalized = normalizeSubtitleBufferToUtf8(raw, format);
  fs.writeFileSync(filePath, normalized);
  return true;
}

module.exports = {
  decodeSubtitleBuffer,
  toVttTextFromDecoded,
  normalizeSubtitleBufferToUtf8,
  normalizeSubtitleFileInPlace,
};
