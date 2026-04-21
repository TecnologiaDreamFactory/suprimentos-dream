/**
 * Retenção: snapshots antigos, histórico opcional, artefatos órfãos.
 */

const fs = require("fs");
const path = require("path");
const { logBatchEvent } = require("./batchStructuredLog");
const { readJsonSafe } = require("./jsonFileUtils");
const batchHistoryStore = require("./batchHistoryStore");

function parseMsEnv(name, defaultMs) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultMs;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 60000 ? n : defaultMs;
}

function getSnapshotTtlMs() {
  return parseMsEnv("BATCH_SNAPSHOT_TTL_MS", 7 * 86400000);
}

function getHistoryTtlMs() {
  const v = process.env.BATCH_HISTORY_TTL_MS;
  if (v === undefined || v === "") return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 86400000 ? n : 0;
}

function isHistoryDeleteEnabled() {
  return process.env.BATCH_HISTORY_DELETE_OLD === "1" || process.env.BATCH_HISTORY_DELETE_OLD === "true";
}

function isOrphanExportDeleteEnabled() {
  return process.env.BATCH_ORPHAN_EXPORT_DELETE === "1" || process.env.BATCH_ORPHAN_EXPORT_DELETE === "true";
}

/**
 * Remove snapshots JSON com mtime > ttl.
 * @returns {{ removed: number, batch_ids: string[] }}
 */
function cleanupOldSnapshots(snapshotDir, ttlMs, historyDirOverride) {
  if (!snapshotDir || !fs.existsSync(snapshotDir)) return { removed: 0, batch_ids: [] };
  const now = Date.now();
  const batchIds = [];
  let removed = 0;
  let names;
  try {
    names = fs.readdirSync(snapshotDir);
  } catch {
    return { removed: 0, batch_ids: [] };
  }
  const policyTag = `snapshot_ttl_${ttlMs}ms`;
  const checkedAt = new Date().toISOString();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(snapshotDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (now - stat.mtimeMs <= ttlMs) continue;
    let batchId = null;
    const parsed = readJsonSafe(full);
    if (parsed.ok && parsed.data && parsed.data.batch_id) {
      batchId = String(parsed.data.batch_id);
    }
    try {
      fs.unlinkSync(full);
      removed += 1;
      if (batchId) {
        batchIds.push(batchId);
        batchHistoryStore.updateRetentionFields(
          batchId,
          {
            snapshot_deleted_at: checkedAt,
            snapshot_last_checked_at: checkedAt,
            retention_policy_applied: policyTag,
          },
          historyDirOverride
        );
      }
    } catch {
      /* ignore */
    }
  }
  return { removed, batch_ids: batchIds };
}

/**
 * Export órfão: arquivo batch-*.xlsx sem JSON de histórico correspondente.
 */
function exportBaseToHistoryFileName(exportBase) {
  if (!exportBase.startsWith("batch-")) return null;
  const idPart = exportBase.slice("batch-".length);
  return `${idPart}.json`;
}

function cleanupOrphanExports(exportDir, historyDir, ttlMsOrphanMs) {
  if (!exportDir || !fs.existsSync(exportDir) || !historyDir) {
    return { removed: 0, checked: 0 };
  }
  let names;
  try {
    names = fs.readdirSync(exportDir);
  } catch {
    return { removed: 0, checked: 0 };
  }
  const now = Date.now();
  let removed = 0;
  let checked = 0;
  for (const name of names) {
    if (!/^batch-[a-zA-Z0-9._-]+\.xlsx$/i.test(name)) continue;
    checked += 1;
    const base = name.replace(/\.xlsx$/i, "");
    const histName = exportBaseToHistoryFileName(base);
    if (!histName) continue;
    const histPath = path.join(historyDir, histName);
    if (fs.existsSync(histPath)) continue;
    const full = path.join(exportDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs <= ttlMsOrphanMs) continue;
    if (!isOrphanExportDeleteEnabled()) continue;
    try {
      fs.unlinkSync(full);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return { removed, checked };
}

/**
 * Histórico JSON antigo (opcional, destrutivo).
 */
function cleanupOldHistory(historyDir, ttlMs) {
  if (!ttlMs || !historyDir || !fs.existsSync(historyDir) || !isHistoryDeleteEnabled()) {
    return { removed: 0 };
  }
  const now = Date.now();
  let removed = 0;
  let names;
  try {
    names = fs.readdirSync(historyDir);
  } catch {
    return { removed: 0 };
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(historyDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (now - stat.mtimeMs <= ttlMs) continue;
    try {
      fs.unlinkSync(full);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return { removed };
}

/**
 * Executa uma passagem de retenção e emite log estruturado.
 * @param {{ exportDir: string, historyDir: string, snapshotDir: string }} dirs
 */
function runRetentionPass(dirs) {
  const policy = {
    snapshot_ttl_ms: getSnapshotTtlMs(),
    history_ttl_ms: getHistoryTtlMs(),
    history_delete: isHistoryDeleteEnabled(),
    orphan_export_delete: isOrphanExportDeleteEnabled(),
  };

  const snap = cleanupOldSnapshots(dirs.snapshotDir, policy.snapshot_ttl_ms, dirs.historyDir);
  const orphanMs = parseMsEnv("BATCH_ORPHAN_MIN_AGE_MS", 86400000);
  const orphans = cleanupOrphanExports(dirs.exportDir, dirs.historyDir, orphanMs);
  const hist = cleanupOldHistory(dirs.historyDir, policy.history_ttl_ms);

  logBatchEvent({
    event: "retention_pass",
    status: "ok",
    removed_snapshots: snap.removed,
    removed_history: hist.removed,
    orphan_exports_removed: orphans.removed,
    orphan_exports_checked: orphans.checked,
    policy,
  });

  return {
    removed_snapshots: snap.removed,
    removed_history: hist.removed,
    orphan_exports_removed: orphans.removed,
    policy,
  };
}

function scheduleRetentionCleanup(dirs, opts = {}) {
  const intervalMs = parseMsEnv("BATCH_RETENTION_INTERVAL_MS", 3600000);
  if (opts.onStartup !== false) {
    try {
      runRetentionPass(dirs);
    } catch (e) {
      logBatchEvent({ event: "retention_pass", status: "error", message: String(e.message).slice(0, 200) });
    }
  }
  const id = setInterval(() => {
    try {
      runRetentionPass(dirs);
    } catch (e) {
      logBatchEvent({ event: "retention_pass", status: "error", message: String(e.message).slice(0, 200) });
    }
  }, intervalMs);
  if (typeof id.unref === "function") id.unref();
  return { intervalId: id, intervalMs };
}

module.exports = {
  runRetentionPass,
  scheduleRetentionCleanup,
  getSnapshotTtlMs,
  getHistoryTtlMs,
  cleanupOldSnapshots,
  cleanupOrphanExports,
  cleanupOldHistory,
};
