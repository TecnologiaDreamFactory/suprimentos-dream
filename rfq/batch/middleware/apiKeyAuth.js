/**
 * API key opcional via env BATCH_API_KEY.
 * Se não configurada (vazia), o middleware não exige credencial (desenvolvimento local).
 * Headers aceitos: X-API-Key, Authorization: Bearer <key>
 */

function getExpectedKey() {
  const v = process.env.BATCH_API_KEY;
  if (v == null || String(v).trim() === "") return null;
  return String(v).trim();
}

function extractProvidedKey(req) {
  const x = req.headers["x-api-key"];
  if (x && String(x).trim()) return String(x).trim();
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  return null;
}

/**
 * Exige API key somente quando BATCH_API_KEY está definida.
 */
function requireBatchApiKey(req, res, next) {
  const expected = getExpectedKey();
  if (!expected) return next();

  const provided = extractProvidedKey(req);
  if (provided !== expected) {
    return res.status(401).json({
      status: "error",
      code: "UNAUTHORIZED",
      message: "Autenticação necessária. Envie o header X-API-Key ou Authorization: Bearer.",
      request_id: req.correlationId,
    });
  }
  next();
}

function isBatchApiKeyConfigured() {
  return getExpectedKey() != null;
}

module.exports = {
  requireBatchApiKey,
  getExpectedKey,
  extractProvidedKey,
  isBatchApiKeyConfigured,
};
