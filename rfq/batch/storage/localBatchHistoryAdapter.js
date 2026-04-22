/**
 * Adapter: histórico batch em filesystem local (JSON por arquivo).
 */

const fs = require("fs");
const path = require("path");
const { writeJsonAtomic, readJsonSafe } = require("../jsonFileUtils");
const { DECISION_STATUS, canTransitionToManualDecision } = require("../batchDecision");

/**
 * Estados do processamento assíncrono do lote.
 * Independente de `decision_status` (que é sobre decisão humana).
 */
const JOB_STATUS = Object.freeze({
  PROCESSING: "processing",
  READY: "ready",
  ERROR: "error",
});

class LocalBatchHistoryAdapter {
  /**
   * @param {{ getBaseDir: () => string, setBaseDirForTests?: (d: string|null) => void }} opts
   */
  constructor(opts) {
    this._getBaseDir = opts.getBaseDir;
    this._setBaseDirForTests = opts.setBaseDirForTests || (() => {});
  }

  getHistoryDir(overrideDir) {
    if (overrideDir) return overrideDir;
    return this._getBaseDir();
  }

  historyFilePath(batchId, dirOverride) {
    const safe = String(batchId).replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.getHistoryDir(dirOverride), `${safe}.json`);
  }

  saveBatchRecord(payload, dirOverride) {
    const filePath = this.historyFilePath(payload.batch_id, dirOverride);
    const now = new Date().toISOString();
    const record = {
      batch_id: payload.batch_id,
      created_at: payload.created_at,
      updated_at: now,
      job_status: payload.job_status || JOB_STATUS.READY,
      job_started_at: payload.job_started_at != null ? payload.job_started_at : payload.created_at,
      job_finished_at: payload.job_finished_at != null ? payload.job_finished_at : now,
      job_error: payload.job_error != null ? payload.job_error : null,
      decision_status: payload.decision_status,
      request_summary: payload.request_summary,
      review_summary: payload.review_summary,
      ai_comparison_feedback: payload.ai_comparison_feedback,
      comparison_result_summary: payload.comparison_result_summary,
      export_filename: payload.export_filename,
      export_path: payload.export_path != null ? payload.export_path : payload.export_filename,
      export_uri: payload.export_uri != null ? payload.export_uri : null,
      export_provider: payload.export_provider != null ? payload.export_provider : "local",
      export_etag: payload.export_etag != null ? payload.export_etag : null,
      export_size_bytes:
        payload.export_size_bytes != null && payload.export_size_bytes !== ""
          ? Number(payload.export_size_bytes)
          : null,
      export_generated_at: payload.export_generated_at,
      export_last_updated_at: payload.export_last_updated_at != null ? payload.export_last_updated_at : now,
      snapshot_relative_path: payload.snapshot_relative_path,
      snapshot_created_at: payload.snapshot_created_at != null ? payload.snapshot_created_at : null,
      snapshot_last_checked_at: payload.snapshot_last_checked_at != null ? payload.snapshot_last_checked_at : null,
      snapshot_deleted_at: payload.snapshot_deleted_at != null ? payload.snapshot_deleted_at : null,
      retention_policy_applied: payload.retention_policy_applied != null ? payload.retention_policy_applied : null,
      artifact_deleted_at: payload.artifact_deleted_at != null ? payload.artifact_deleted_at : null,
      metrics_summary: payload.metrics_summary,
      audit_log: Array.isArray(payload.audit_log) ? payload.audit_log : [],
      artifact_warnings: Array.isArray(payload.artifact_warnings) ? payload.artifact_warnings : [],
    };
    writeJsonAtomic(filePath, record);
    return record;
  }

  /**
   * Grava o registro inicial de um lote em processamento assíncrono.
   * O record mínimo permite que o GET /status responda imediatamente
   * enquanto o runCompareBatch executa em background.
   */
  createPendingBatch(payload, dirOverride) {
    const now = new Date().toISOString();
    const filePath = this.historyFilePath(payload.batch_id, dirOverride);
    const record = {
      batch_id: payload.batch_id,
      created_at: payload.created_at || now,
      updated_at: now,
      job_status: JOB_STATUS.PROCESSING,
      job_started_at: payload.job_started_at || now,
      job_finished_at: null,
      job_error: null,
      decision_status: null,
      request_summary: payload.request_summary || null,
      review_summary: null,
      ai_comparison_feedback: null,
      comparison_result_summary: null,
      export_filename: null,
      export_path: null,
      export_uri: null,
      export_provider: "local",
      export_etag: null,
      export_size_bytes: null,
      export_generated_at: null,
      export_last_updated_at: null,
      snapshot_relative_path: null,
      snapshot_created_at: null,
      snapshot_last_checked_at: null,
      snapshot_deleted_at: null,
      retention_policy_applied: null,
      artifact_deleted_at: null,
      metrics_summary: null,
      audit_log: [],
      artifact_warnings: [],
    };
    writeJsonAtomic(filePath, record);
    return record;
  }

  /**
   * Atualiza `job_status` e campos correlatos (`job_finished_at`, `job_error`).
   * Usado quando o processamento background conclui ou falha.
   */
  updateJobStatus(batchId, fields, dirOverride) {
    const rec = this.loadBatchRecord(batchId, dirOverride);
    if (!rec) return { ok: false, code: "NOT_FOUND" };
    const now = new Date().toISOString();
    if (fields.job_status) rec.job_status = fields.job_status;
    if (fields.job_status === JOB_STATUS.READY || fields.job_status === JOB_STATUS.ERROR) {
      rec.job_finished_at = fields.job_finished_at || now;
    }
    if (fields.job_error !== undefined) rec.job_error = fields.job_error;
    rec.updated_at = now;
    writeJsonAtomic(this.historyFilePath(batchId, dirOverride), rec);
    return { ok: true, record: rec };
  }

  /**
   * Lista lotes com `job_status === "processing"`. Útil no startup
   * para varrer e marcar como error registros órfãos após restart.
   */
  listPendingBatches(dirOverride) {
    const dir = this.getHistoryDir(dirOverride);
    try {
      if (!fs.existsSync(dir)) return [];
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      const out = [];
      for (const f of files) {
        const full = path.join(dir, f);
        const r = readJsonSafe(full);
        if (!r.ok) continue;
        if (r.data && r.data.job_status === JOB_STATUS.PROCESSING) {
          out.push(r.data);
        }
      }
      return out;
    } catch (e) {
      console.warn("[batch-history] listPendingBatches falhou:", e && e.message);
      return [];
    }
  }

  updateRetentionFields(batchId, fields, dirOverride) {
    const rec = this.loadBatchRecord(batchId, dirOverride);
    if (!rec) return { ok: false, code: "NOT_FOUND" };
    const now = new Date().toISOString();
    Object.assign(rec, fields, { updated_at: now });
    writeJsonAtomic(this.historyFilePath(batchId, dirOverride), rec);
    return { ok: true, record: rec };
  }

  updateExportArtifactMeta(batchId, fields, dirOverride) {
    const rec = this.loadBatchRecord(batchId, dirOverride);
    if (!rec) return { ok: false, code: "NOT_FOUND" };
    const now = new Date().toISOString();
    Object.assign(rec, fields, { updated_at: now });
    writeJsonAtomic(this.historyFilePath(batchId, dirOverride), rec);
    return { ok: true, record: rec };
  }

  appendArtifactWarning(batchId, warning, dirOverride) {
    const rec = this.loadBatchRecord(batchId, dirOverride);
    if (!rec) return { ok: false };
    const list = Array.isArray(rec.artifact_warnings) ? rec.artifact_warnings.slice() : [];
    list.push(warning);
    rec.artifact_warnings = list;
    rec.updated_at = new Date().toISOString();
    writeJsonAtomic(this.historyFilePath(batchId, dirOverride), rec);
    return { ok: true, record: rec };
  }

  loadBatchRecord(batchId, dirOverride) {
    const fp = this.historyFilePath(batchId, dirOverride);
    const r = readJsonSafe(fp);
    if (!r.ok) {
      if (r.error !== "missing_file") {
        console.warn("[batch-history] leitura falhou:", fp, r.error);
      }
      return null;
    }
    return r.data;
  }

  applyDecision(batchId, body, dirOverride) {
    const rec = this.loadBatchRecord(batchId, dirOverride);
    if (!rec) {
      return { ok: false, code: "NOT_FOUND", message: "Lote não encontrado no histórico." };
    }
    const next =
      body.status === "approved" ? DECISION_STATUS.APPROVED : DECISION_STATUS.REJECTED;
    const check = canTransitionToManualDecision(rec.decision_status, body.status);
    if (!check.ok) {
      return { ok: false, code: "INVALID_TRANSITION", message: check.message || "Transição inválida" };
    }
    if (!body.reason || !String(body.reason).trim()) {
      return { ok: false, code: "VALIDATION", message: "Campo reason é obrigatório." };
    }
    if (!body.decided_by || !String(body.decided_by).trim()) {
      return { ok: false, code: "VALIDATION", message: "Campo decided_by é obrigatório." };
    }

    const decided_at = new Date().toISOString();
    const audit = {
      batch_id: batchId,
      previous_status: rec.decision_status,
      new_status: next,
      reason: String(body.reason).trim(),
      decided_by: String(body.decided_by).trim(),
      decided_at,
      notes: body.notes != null ? String(body.notes) : undefined,
    };

    if (!Array.isArray(rec.artifact_warnings)) rec.artifact_warnings = [];

    rec.decision_status = next;
    rec.updated_at = decided_at;
    rec.audit_log = [...(rec.audit_log || []), audit];
    if (body.notes != null && String(body.notes).trim() !== "") {
      rec.last_decision_notes = String(body.notes).trim();
    }

    writeJsonAtomic(this.historyFilePath(batchId, dirOverride), rec);
    return { ok: true, record: rec, audit };
  }

  setHistoryDirForTests(dir) {
    this._setBaseDirForTests(dir);
  }
}

module.exports = {
  LocalBatchHistoryAdapter,
  JOB_STATUS,
};
