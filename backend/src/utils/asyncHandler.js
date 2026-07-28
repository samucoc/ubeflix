// Wraps an async route handler so a rejected promise reaches Express' error
// middleware instead of hanging the request. Without it every handler needs the
// same try/catch + 500 response, repeated ~40 times across the routes.
//
//   router.get('/x', asyncHandler(async (req, res) => { ... }));
//
// Only use it where the catch block was the generic "log it and return 500".
// Handlers that map specific errors (409 on duplicate key, 404 fallbacks, …)
// should keep their own try/catch.
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
