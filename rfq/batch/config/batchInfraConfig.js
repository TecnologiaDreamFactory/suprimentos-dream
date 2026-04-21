/**
 * Configuração de infraestrutura batch (storage, rate limit, URLs públicas).
 * Defaults preservam comportamento de instância única com disco local.
 */

/**
 * @returns {"local"|"object"}
 */
function getBatchStorageProvider() {
  const v = (process.env.BATCH_STORAGE_PROVIDER || "local").toLowerCase();
  if (v === "object" || v === "s3" || v === "gcs" || v === "azure") return "object";
  return "local";
}

/**
 * @returns {"memory"|"redis"}
 */
function getBatchRateLimitProvider() {
  const v = (process.env.BATCH_RATE_LIMIT_PROVIDER || "memory").toLowerCase();
  return v === "redis" ? "redis" : "memory";
}

/**
 * Provider lógico do artefato exportado (para logs).
 * @returns {"local"|"object"}
 */
function getArtifactProvider() {
  return getBatchStorageProvider() === "object" ? "object" : "local";
}

/**
 * Base pública para montar downloadUrl quando não se usa host da requisição.
 * Ex.: https://cdn.exemplo.com/batch ou bucket website endpoint.
 */
function getBatchExportPublicBaseUrl() {
  const u = process.env.BATCH_EXPORT_PUBLIC_BASE_URL;
  return u && String(u).trim() ? String(u).replace(/\/$/, "") : null;
}

function getBatchObjectBucket() {
  return process.env.BATCH_OBJECT_BUCKET ? String(process.env.BATCH_OBJECT_BUCKET).trim() : "";
}

function getBatchObjectPrefix() {
  const p = process.env.BATCH_OBJECT_PREFIX || "batch-exports/";
  return p.endsWith("/") ? p : `${p}/`;
}

/**
 * URI lógica estilo s3:// para metadados (sem credenciais).
 * @param {string} fileName
 */
function buildObjectExportUri(fileName) {
  const bucket = getBatchObjectBucket() || "default-bucket";
  return `s3://${bucket}/${getBatchObjectPrefix()}${fileName}`;
}

/**
 * Contexto para logs estruturados.
 */
function getBatchInfraLogContext() {
  return {
    storage_provider: getBatchStorageProvider(),
    rate_limit_provider: getBatchRateLimitProvider(),
    artifact_provider: getArtifactProvider(),
  };
}

module.exports = {
  getBatchStorageProvider,
  getBatchRateLimitProvider,
  getArtifactProvider,
  getBatchExportPublicBaseUrl,
  getBatchObjectBucket,
  getBatchObjectPrefix,
  buildObjectExportUri,
  getBatchInfraLogContext,
};
