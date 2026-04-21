/**
 * Limpeza de arquivos XLSX antigos no diretório de export batch (TTL configurável).
 */

const fs = require("fs");
const path = require("path");

function getBatchExportTtlMs() {
  const v = process.env.BATCH_EXPORT_TTL_MS;
  if (v === undefined || v === "") return 86400000; // 24h
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 60000 ? n : 86400000;
}

function getCleanupIntervalMs() {
  const v = process.env.BATCH_EXPORT_CLEANUP_INTERVAL_MS;
  if (v === undefined || v === "") return 3600000; // 1h
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 60000 ? n : 3600000;
}

/**
 * Remove apenas arquivos batch-*.xlsx com idade > ttlMs (mtime).
 * @param {string} dir
 * @param {number} ttlMs
 * @returns {number} quantidade removida
 */
function cleanupBatchExports(dir, ttlMs) {
  if (!dir || !fs.existsSync(dir)) return 0;
  const now = Date.now();
  let removed = 0;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }

  for (const name of names) {
    if (!/^batch-[a-zA-Z0-9._-]+\.xlsx$/i.test(name)) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (now - stat.mtimeMs > ttlMs) {
      try {
        fs.unlinkSync(full);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  }

  if (removed > 0) {
    console.log(`[batch-cleanup] removed ${removed} export file(s) (ttl_ms=${ttlMs})`);
  }
  return removed;
}

/**
 * @param {string} dir
 * @param {{ onStartup?: boolean }} [opts]
 */
function scheduleBatchExportCleanup(dir, opts = {}) {
  const ttl = getBatchExportTtlMs();
  const interval = getCleanupIntervalMs();

  if (opts.onStartup !== false) {
    cleanupBatchExports(dir, ttl);
  }

  const id = setInterval(() => {
    cleanupBatchExports(dir, ttl);
  }, interval);

  if (typeof id.unref === "function") id.unref();

  return { intervalId: id, ttlMs: ttl, intervalMs: interval };
}

module.exports = {
  cleanupBatchExports,
  scheduleBatchExportCleanup,
  getBatchExportTtlMs,
  getCleanupIntervalMs,
};
