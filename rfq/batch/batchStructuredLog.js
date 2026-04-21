/**
 * Logs estruturados (uma linha JSON por evento) — sem conteúdo de arquivos.
 */

const { getBatchInfraLogContext } = require("./config/batchInfraConfig");

/**
 * @param {object} fields
 * @param {string} fields.event
 * @param {string} [fields.route]
 * @param {string} [fields.batch_id]
 * @param {string} [fields.request_id]
 * @param {string} [fields.status]
 * @param {number} [fields.execution_ms]
 * @param {object} [fields.artifact]
 * @param {object} [fields.decision]
 * @param {string} [fields.http_status]
 */
function logBatchEvent(fields) {
  const payload = {
    ts: new Date().toISOString(),
    service: "batch",
    ...getBatchInfraLogContext(),
    ...fields,
  };
  if (payload.artifact && typeof payload.artifact === "object") {
    payload.artifact = sanitizeArtifactForLog(payload.artifact);
  }
  if (payload.decision && typeof payload.decision === "object") {
    payload.decision = {
      ok: payload.decision.ok,
      code: payload.decision.code,
      new_status: payload.decision.new_status,
    };
  }
  console.log(JSON.stringify(payload));
}

function sanitizeArtifactForLog(artifact) {
  if (!artifact || typeof artifact !== "object") return artifact;
  const out = { ok: artifact.ok };
  if (artifact.reason != null) out.reason = String(artifact.reason);
  if (artifact.code != null) out.code = String(artifact.code);
  return out;
}

module.exports = {
  logBatchEvent,
  sanitizeArtifactForLog,
};
