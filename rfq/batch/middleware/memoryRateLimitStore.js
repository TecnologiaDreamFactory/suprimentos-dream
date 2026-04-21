/**
 * Rate limit em memória (por instância do limiter).
 * Contrato: consume(key, windowMs, max) → headers + allowed.
 */

class MemoryRateLimitStore {
  constructor() {
    /** @type {Map<string, { count: number, windowStart: number }>} */
    this.buckets = new Map();
  }

  /**
   * @param {string} key
   * @param {number} windowMs
   * @param {number} max
   * @returns {{ allowed: boolean, count: number, limit: number, remaining: number, resetSec: number }}
   */
  consume(key, windowMs, max) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || now - b.windowStart >= windowMs) {
      b = { count: 0, windowStart: now };
      this.buckets.set(key, b);
    }
    b.count += 1;
    const remaining = Math.max(0, max - b.count);
    return {
      allowed: b.count <= max,
      count: b.count,
      limit: max,
      remaining,
      resetSec: Math.ceil((b.windowStart + windowMs) / 1000),
    };
  }
}

module.exports = { MemoryRateLimitStore };
