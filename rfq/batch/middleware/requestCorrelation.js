/**
 * Correlation ID por requisição (header X-Request-Id ou UUID).
 */

const crypto = require("crypto");

function correlationMiddleware(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const id =
    incoming && String(incoming).trim().length > 0 && String(incoming).length <= 128
      ? String(incoming).trim()
      : crypto.randomUUID();
  req.correlationId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

module.exports = {
  correlationMiddleware,
};
