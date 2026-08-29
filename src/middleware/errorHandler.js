"use strict";

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function notFound(req, res) {
  res.status(404).json({ error: { message: "Not found", path: req.originalUrl } });
}

// Express recognizes error middleware by its 4-argument signature.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const isServerError = status >= 500;

  if (isServerError) {
    // Full detail server-side only; never leak stack traces to clients.
    console.error(`[error] ${req.method} ${req.originalUrl} ->`, err);
  }

  res.status(status).json({
    error: {
      message: isServerError ? "Something went wrong. Please try again." : err.message,
      ...(err.details ? { details: err.details } : {})
    }
  });
}

module.exports = { ApiError, notFound, errorHandler };
