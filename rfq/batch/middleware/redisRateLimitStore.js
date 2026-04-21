/**
 * Placeholder para rate limit distribuído (Redis).
 * Hoje delega a MemoryRateLimitStore com o mesmo contrato — sem dependência de cliente Redis.
 * Substitua por INCR + EXPIRE / sliding window quando integrar.
 */

const { MemoryRateLimitStore } = require("./memoryRateLimitStore");

let _warned;

class RedisRateLimitStore {
  constructor() {
    if (!_warned) {
      _warned = true;
      console.warn(
        "[batch-rate-limit] BATCH_RATE_LIMIT_PROVIDER=redis: usando fallback em memória até integração Redis."
      );
    }
    this._delegate = new MemoryRateLimitStore();
  }

  consume(key, windowMs, max) {
    return this._delegate.consume(key, windowMs, max);
  }
}

module.exports = { RedisRateLimitStore };
