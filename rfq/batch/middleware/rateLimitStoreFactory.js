const { getBatchRateLimitProvider } = require("../config/batchInfraConfig");
const { MemoryRateLimitStore } = require("./memoryRateLimitStore");
const { RedisRateLimitStore } = require("./redisRateLimitStore");

/**
 * Nova instância por limiter HTTP (buckets isolados entre compare vs mutate).
 */
function createRateLimitStoreInstance() {
  const p = getBatchRateLimitProvider();
  if (p === "redis") return new RedisRateLimitStore();
  return new MemoryRateLimitStore();
}

module.exports = {
  createRateLimitStoreInstance,
};
