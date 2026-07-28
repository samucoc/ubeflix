// Shared by the video, series and comic listings: none of them had a default
// limit, so a request without ?limit returned the whole table.

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function parseBoundedInt(value, { fallback, min, max }) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function getPagination(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  return {
    limit: parseBoundedInt(query.limit, { fallback: defaultLimit, min: 1, max: maxLimit }),
    offset: parseBoundedInt(query.offset, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER }),
  };
}

// The body stays a plain array so existing callers keep working; the totals
// travel in headers (exposed explicitly for cross-origin reads).
function setPaginationHeaders(res, { total, offset, count }) {
  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Has-More', String(offset + count < total));
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Has-More');
}

module.exports = { getPagination, setPaginationHeaders, parseBoundedInt, DEFAULT_LIMIT, MAX_LIMIT };
