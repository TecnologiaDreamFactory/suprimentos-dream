/**
 * Tokens opcionais de download (curta duração) para GET /downloads.
 */

const crypto = require("crypto");

/** @type {Map<string, { fileBase: string, expires: number }>} */
const store = new Map();

function getTokenTtlMs() {
  const v = process.env.BATCH_DOWNLOAD_TOKEN_TTL_MS;
  if (v === undefined || v === "") return 900000; // 15 min
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 60000 ? n : 900000;
}

function isDownloadTokenRequired() {
  return /^1|true|yes|on$/i.test(String(process.env.BATCH_DOWNLOAD_REQUIRE_TOKEN || "").trim());
}

/** Se true, o token é removido após o primeiro download bem-sucedido (link de uso único). Padrão: false — permite vários downloads até expirar o TTL. */
function shouldConsumeTokenAfterDownload() {
  return /^1|true|yes|on$/i.test(String(process.env.BATCH_DOWNLOAD_CONSUME_TOKEN_ON_SUCCESS || "").trim());
}

/**
 * @param {string} fileBase — ex.: batch-B-123.xlsx
 * @returns {string} token
 */
function registerDownloadToken(fileBase) {
  const token = crypto.randomBytes(24).toString("hex");
  const expires = Date.now() + getTokenTtlMs();
  store.set(token, { fileBase, expires });
  pruneExpired();
  return token;
}

function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expires < now) store.delete(k);
  }
}

/**
 * @param {string} fileBase
 * @param {string} [token]
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateDownloadToken(fileBase, token) {
  pruneExpired();
  if (!isDownloadTokenRequired()) {
    if (!token) return { ok: true };
  } else {
    if (!token || typeof token !== "string") {
      return { ok: false, reason: "token_required" };
    }
  }

  if (!token) return { ok: true };

  const rec = store.get(token);
  if (!rec || rec.expires < Date.now()) {
    return { ok: false, reason: "token_invalid_or_expired" };
  }
  if (rec.fileBase !== fileBase) {
    return { ok: false, reason: "token_mismatch" };
  }
  return { ok: true };
}

/**
 * Invalida token após download bem-sucedido (opcional — reduz reuso).
 * @param {string} token
 */
function consumeDownloadToken(token) {
  if (token) store.delete(token);
}

module.exports = {
  registerDownloadToken,
  validateDownloadToken,
  consumeDownloadToken,
  isDownloadTokenRequired,
  shouldConsumeTokenAfterDownload,
  getTokenTtlMs,
};
