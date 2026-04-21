/**
 * Configuração OpenAI (env) — opcional; sem chave o pipeline segue só determinístico.
 */

function boolEnv(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return /^1|true|yes|on$/i.test(String(v).trim());
}

function numEnv(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : defaultValue;
}

function intEnv(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function strEnv(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const s = String(v).trim();
  return s.length ? s : defaultValue;
}

/**
 * Timeout da chamada de equivalência semântica de itens (batch).
 * Se OPENAI_SEMANTIC_ITEM_MATCH_TIMEOUT_MS estiver vazio ou inválido, usa OPENAI_TIMEOUT_MS.
 */
function getSemanticItemMatchTimeoutMs(fallbackMs) {
  const v = process.env.OPENAI_SEMANTIC_ITEM_MATCH_TIMEOUT_MS;
  if (v === undefined || v === "") return fallbackMs;
  const n = parseFloat(String(v).trim());
  if (!Number.isFinite(n) || n < 1000) return fallbackMs;
  return Math.min(120000, n);
}

function getOpenAIConfig() {
  const timeoutMs = Math.max(1000, numEnv("OPENAI_TIMEOUT_MS", 30000));
  const maxRetries = Math.max(0, intEnv("OPENAI_MAX_RETRIES", 1));
  let temperature = numEnv("OPENAI_TEMPERATURE", 0.2);
  if (!Number.isFinite(temperature)) temperature = 0.2;
  temperature = Math.min(2, Math.max(0, temperature));

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  /** Com chave válida, PDF/DOCX/TXT entram no fluxo de ingestão sem exigir flag extra. Use OPENAI_ENABLE_DOCUMENT_INGEST=0 para desligar. */
  const documentIngestDefault = apiKey.length > 8;

  return {
    apiKey,
    model: strEnv("OPENAI_MODEL", "gpt-4o-mini"),
    enableAmbiguity: boolEnv("OPENAI_ENABLE_AMBIGUITY_RESOLUTION", true),
    enableSummary: boolEnv("OPENAI_ENABLE_ANALYTIC_SUMMARY", true),
    parsingConfidenceThreshold: numEnv("OPENAI_PARSING_CONFIDENCE_THRESHOLD", 0.75),
    enableSemanticItemMatch: boolEnv("OPENAI_ENABLE_SEMANTIC_ITEM_MATCH", false),
    semanticItemMatchThreshold: Math.min(1, Math.max(0, numEnv("OPENAI_SEMANTIC_ITEM_MATCH_THRESHOLD", 0.8))),
    semanticItemMatchLowConfidence: Math.min(1, Math.max(0, numEnv("OPENAI_SEMANTIC_ITEM_MATCH_LOW_CONFIDENCE", 0.6))),
    semanticItemMatchMaxCandidates: Math.max(1, Math.min(12, intEnv("OPENAI_SEMANTIC_ITEM_MATCH_MAX_CANDIDATES", 5))),
    semanticItemMatchMaxCalls: Math.max(1, Math.min(40, intEnv("OPENAI_SEMANTIC_ITEM_MATCH_MAX_CALLS", 15))),
    /** @type {number} — client.responses.create + SDK; equiv. semântica pode ter cap menor */
    semanticItemMatchTimeoutMs: getSemanticItemMatchTimeoutMs(timeoutMs),
    /** Ingestão PDF/DOCX/TXT → texto → JSON de itens (requer API key; ligado por padrão se a chave existir). */
    enableDocumentIngest: boolEnv("OPENAI_ENABLE_DOCUMENT_INGEST", documentIngestDefault),
    documentIngestMaxChars: Math.max(8000, Math.min(500000, intEnv("OPENAI_DOCUMENT_INGEST_MAX_CHARS", 120000))),
    documentIngestTimeoutMs: Math.max(
      timeoutMs,
      Math.min(300000, intEnv("OPENAI_DOCUMENT_INGEST_TIMEOUT_MS", Math.min(120000, timeoutMs * 2)))
    ),
    timeoutMs,
    maxRetries,
    temperature,
  };
}

function isOpenAIConfigured() {
  const k = getOpenAIConfig().apiKey;
  return Boolean(k && k.length > 8);
}

module.exports = {
  getOpenAIConfig,
  isOpenAIConfigured,
  boolEnv,
  numEnv,
  intEnv,
  strEnv,
};
