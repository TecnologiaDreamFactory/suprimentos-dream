/**
 * Telemetria operacional da equivalência semântica (agregação e estimativas).
 * Não altera decisões — apenas métricas, logs e resumos para debug/produção.
 */

/** Preço aproximado USD / 1M tokens entrada (gpt-4o-mini — ajuste se mudar modelo). */
const APPROX_INPUT_USD_PER_MILLION = 0.15;
/** Estimativa conservadora de tokens de saída por chamada (JSON curto). */
const APPROX_OUTPUT_TOKENS_PER_CALL = 160;
/** Preço aproximado USD / 1M tokens saída. */
const APPROX_OUTPUT_USD_PER_MILLION = 0.6;

/**
 * Estimativa grosseira de tokens a partir do payload serializado (~4 chars/token PT/EN).
 * @param {object} payload
 */
function estimatePromptTokens(payload) {
  try {
    const s = JSON.stringify(payload);
    return Math.max(1, Math.ceil(s.length / 4));
  } catch {
    return 0;
  }
}

/**
 * @param {number} promptTokensSum
 * @param {number} openaiCalls
 */
function estimateCostUsdApprox(promptTokensSum, openaiCalls) {
  const outTok = Math.max(0, openaiCalls) * APPROX_OUTPUT_TOKENS_PER_CALL;
  const inM = promptTokensSum / 1e6;
  const outM = outTok / 1e6;
  const usd = inM * APPROX_INPUT_USD_PER_MILLION + outM * APPROX_OUTPUT_USD_PER_MILLION;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * @param {number[]} confidences — valores 0..1 de tentativas com resposta parseada
 */
function confidenceAggregate(confidences) {
  const arr = (confidences || []).filter((c) => typeof c === "number" && Number.isFinite(c));
  if (arr.length === 0) {
    return { avg: null, min: null, max: null };
  }
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round((sum / arr.length) * 1000) / 1000,
    min: Math.round(Math.min(...arr) * 1000) / 1000,
    max: Math.round(Math.max(...arr) * 1000) / 1000,
  };
}

/**
 * Resumo enxuto para debug (sem objeto `ai` completo).
 * @param {object[]} details
 * @param {number} [limit=24]
 */
function summarizeSemanticDetails(details, limit = 24) {
  if (!Array.isArray(details)) return [];
  return details.slice(0, limit).map((d) => ({
    reference_item_key: d.reference_item_key,
    missing_proposal: d.missing_proposal,
    outcome: d.outcome,
    reason: d.reason || d.outcome,
    confidence: typeof d.confidence === "number" ? d.confidence : undefined,
    merged_from: d.merged_from,
  }));
}

/**
 * Casos de revisão semântica priorizados (confiança intermediária).
 * @param {object[]} reviewHints
 * @param {number} [limit=8]
 */
function buildTopSemanticReviewCases(reviewHints, limit = 8) {
  if (!Array.isArray(reviewHints)) return [];
  const rows = reviewHints
    .filter((h) => h && h.category === "item_semantic_review")
    .map((h) => ({
      reference_item_key: h.reference_item_key,
      candidate_item_key: h.candidate_item_key,
      confidence: typeof h.confidence === "number" ? h.confidence : null,
      summary: (h.summary || "").slice(0, 280),
    }))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = `${r.reference_item_key}|${r.candidate_item_key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Stats iniciais (zeros) para um lote sem passagem semântica ou antes do loop.
 */
function emptySemanticMatchStats() {
  return {
    semantic_match_attempted_count: 0,
    semantic_match_applied_count: 0,
    semantic_match_manual_review_count: 0,
    semantic_match_rejected_count: 0,
    semantic_match_skipped_count: 0,
    semantic_match_openai_error_count: 0,
    semantic_match_openai_calls: 0,
    semantic_match_confidence_avg: null,
    semantic_match_confidence_min: null,
    semantic_match_confidence_max: null,
    semantic_match_estimated_prompt_tokens_total: 0,
    semantic_match_estimated_cost_usd_approx: null,
  };
}

/**
 * @param {object} base — contadores preenchidos no loop
 * @param {number[]} confidences
 * @param {number[]} promptTokenEstimates — um por chamada OpenAI
 */
function finalizeSemanticMatchStats(base, confidences, promptTokenEstimates) {
  const agg = confidenceAggregate(confidences);
  const promptSum = (promptTokenEstimates || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const calls = base.semantic_match_openai_calls ?? base.semantic_match_attempted_count ?? 0;
  const cost = estimateCostUsdApprox(promptSum, calls);
  return {
    ...emptySemanticMatchStats(),
    ...base,
    semantic_match_confidence_avg: agg.avg,
    semantic_match_confidence_min: agg.min,
    semantic_match_confidence_max: agg.max,
    semantic_match_estimated_prompt_tokens_total: promptSum,
    semantic_match_estimated_cost_usd_approx: calls > 0 ? cost : null,
  };
}

module.exports = {
  estimatePromptTokens,
  estimateCostUsdApprox,
  confidenceAggregate,
  summarizeSemanticDetails,
  buildTopSemanticReviewCases,
  emptySemanticMatchStats,
  finalizeSemanticMatchStats,
  APPROX_INPUT_USD_PER_MILLION,
  APPROX_OUTPUT_TOKENS_PER_CALL,
};
