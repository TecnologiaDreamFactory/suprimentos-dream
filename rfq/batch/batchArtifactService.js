/**
 * Atualização do XLSX após decisão e regeneração a partir de snapshot.
 */

const fs = require("fs");
const path = require("path");
const { patchBatchWorkbookMetadata, exportBatchWorkbookFromSnapshot } = require("./workbookExport");
const batchHistoryStore = require("./batchHistoryStore");
const batchSnapshotStore = require("./batchSnapshotStore");

/**
 * @param {string} exportDir — diretório absoluto dos exports (ex.: BATCH_EXPORT_DIR)
 * @param {object} record — registro do histórico
 * @param {object} audit — última entrada de auditoria (applyDecision)
 */
async function applyDecisionToExport(exportDir, record, audit, opts = {}) {
  const historyDir = opts.historyDir;
  const name = record.export_filename || record.export_path;
  if (!name || typeof name !== "string") {
    return { ok: false, reason: "no_export_filename" };
  }
  const base = path.basename(name);
  if (base.includes("..") || base !== name) {
    return { ok: false, reason: "invalid_filename" };
  }
  const full = path.join(exportDir, base);
  const resolved = path.resolve(full);
  const resolvedDir = path.resolve(exportDir);
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    return { ok: false, reason: "path_traversal" };
  }

  const now = new Date().toISOString();
  if (!fs.existsSync(resolved)) {
    const warn = {
      type: "export_missing_on_decision",
      at: now,
      expected_path: resolved,
      batch_id: record.batch_id,
    };
    batchHistoryStore.appendArtifactWarning(record.batch_id, warn, historyDir);
    console.warn("[batch-artifact] XLSX ausente na decisão:", resolved);
    return { ok: false, reason: "missing_file", path: resolved, warning: warn };
  }

  await patchBatchWorkbookMetadata(resolved, {
    decision_status: record.decision_status,
    decided_by: audit.decided_by,
    decided_at: audit.decided_at,
    decision_reason: audit.reason,
    export_last_updated_at: now,
  });

  batchHistoryStore.updateExportArtifactMeta(
    record.batch_id,
    {
      export_last_updated_at: now,
    },
    historyDir
  );

  return { ok: true, path: resolved, export_last_updated_at: now };
}

/**
 * @param {string} exportDir
 * @param {string} batchId
 * @param {string} [historyDir]
 * @param {string} [snapshotDir]
 */
async function regenerateExport(exportDir, batchId, historyDir, snapshotDir) {
  const rec = batchHistoryStore.loadBatchRecord(batchId, historyDir);
  if (!rec) {
    return { ok: false, code: "NOT_FOUND", message: "Lote não encontrado no histórico." };
  }
  const snap = batchSnapshotStore.loadSnapshot(batchId, snapshotDir);
  if (!snap || !snap.batch_id) {
    return { ok: false, code: "SNAPSHOT_MISSING", message: "Snapshot insuficiente para regenerar o export." };
  }

  const name = rec.export_filename || rec.export_path;
  if (!name) {
    return { ok: false, code: "NO_EXPORT_NAME", message: "Histórico sem export_filename." };
  }
  const base = path.basename(name);
  const full = path.join(exportDir, base);
  const resolvedDir = path.resolve(exportDir);
  if (!path.resolve(full).startsWith(resolvedDir + path.sep)) {
    return { ok: false, code: "INVALID_PATH", message: "Caminho de export inválido." };
  }

  const now = new Date().toISOString();
  const lastDecision = (rec.audit_log || []).filter((a) => a.new_status === "approved" || a.new_status === "rejected").pop();

  const mergedSnap = { ...snap, decision_status: rec.decision_status };

  await exportBatchWorkbookFromSnapshot(mergedSnap, full, {
    batchStartMs: Date.now(),
    artifactMeta: {
      decided_by: lastDecision?.decided_by,
      decided_at: lastDecision?.decided_at,
      decision_reason: lastDecision?.reason,
      export_generated_at: rec.export_generated_at || snap.created_at,
      export_last_updated_at: now,
    },
  });

  batchHistoryStore.updateExportArtifactMeta(
    batchId,
    {
      export_last_updated_at: now,
    },
    historyDir
  );

  return { ok: true, export_filename: base, export_last_updated_at: now };
}

module.exports = {
  applyDecisionToExport,
  regenerateExport,
};
