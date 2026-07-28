// Route params that are database ids used to go straight into a query, so
// `/api/videos/abc` reached Postgres and came back as a 500. These validate at
// the router level instead of repeating the check in every handler.

// Registers validation for one or more numeric params on a router.
// Any request whose param isn't a positive integer gets a 400.
function requireNumericParams(router, ...names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => {
      const parsed = parseNumericId(value);
      if (parsed === null) {
        return res.status(400).json({ error: `Parámetro "${name}" inválido` });
      }
      req.params[name] = String(parsed);
      next();
    });
  }
}

// Positive integer within Postgres' int4 range (the id columns are SERIAL).
function parseNumericId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return null;
  const n = Number(str);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) return null;
  return n;
}

module.exports = { requireNumericParams, parseNumericId };
