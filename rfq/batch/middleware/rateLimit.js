/**
 * Rate limit por IP ou chave customizada — store injetável (memória ou stub Redis).
 */

const { createRateLimitStoreInstance } = require("./rateLimitStoreFactory");

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf && typeof xf === "string") {
    const first = xf.split(",")[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || req.ip || "unknown";
}

/**
 * @param {{ windowMs: number, max: number, keyGenerator?: (req: object) => string, namespace?: string }} opts
 */
function createRateLimiter(opts) {
  const windowMs = Math.max(1000, opts.windowMs || 60000);
  const max = Math.max(1, opts.max || 60);
  const keyGenerator = opts.keyGenerator || ((req) => getClientIp(req));
  const ns = opts.namespace ? String(opts.namespace) : "default";
  const store = createRateLimitStoreInstance();

  return function rateLimitMiddleware(req, res, next) {
    const baseKey = keyGenerator(req);
    const key = `${ns}:${baseKey}`;
    const r = store.consume(key, windowMs, max);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(r.remaining));
    res.setHeader("X-RateLimit-Reset", String(r.resetSec));
    if (!r.allowed) {
      return res.status(429).json({
        status: "error",
        code: "RATE_LIMIT_EXCEEDED",
        message: "Muitas requisições. Tente novamente em instantes.",
        request_id: req.correlationId,
      });
    }
    next();
  };
}

module.exports = {
  createRateLimiter,
  getClientIp,
};
