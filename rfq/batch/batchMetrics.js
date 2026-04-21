/**
 * Métricas e telemetria operacional do compare-batch.
 */

/**
 * @param {object} params
 * @param {string} params.batch_id
 * @param {number} params.files_received
 * @param {number} params.files_parsed
 * @param {number} params.quotes_extracted
 * @param {string} params.executionTime - ex.: "1.23s"
 * @param {import('./batchMetrics').StageTimingsMs} params.stage_timings_ms
 * @param {boolean} params.manual_review_required
 * @param {object} [params.review_summary]
 * @param {string} params.analysis_source
 * @param {number} params.item_key_collision_count
 * @param {object} [params.semantic_match_stats]
 * @returns {object}
 */
function buildMetricsSummary(params) {
  const rs = params.review_summary || {};
  const execSec = parseExecutionSeconds(params.executionTime);
  const sm = params.semantic_match_stats || {};

  return {
    batch_id: params.batch_id,
    files_received: params.files_received,
    files_parsed: params.files_parsed,
    quotes_extracted: params.quotes_extracted,
    executionTime: params.executionTime,
    execution_seconds: execSec,
    stage_timings_ms: params.stage_timings_ms,
    manual_review_required: params.manual_review_required,
    blocking_issue_count: rs.blocking_issue_count ?? 0,
    error_issue_count: rs.error_issue_count ?? 0,
    warning_issue_count: rs.warning_issue_count ?? 0,
    info_issue_count: rs.info_issue_count ?? 0,
    item_key_collision_count: params.item_key_collision_count,
    analysis_source: params.analysis_source,
    semantic_match_attempted_count: sm.semantic_match_attempted_count ?? 0,
    semantic_match_applied_count: sm.semantic_match_applied_count ?? 0,
    semantic_match_manual_review_count: sm.semantic_match_manual_review_count ?? 0,
    semantic_match_rejected_count: sm.semantic_match_rejected_count ?? 0,
    semantic_match_skipped_count: sm.semantic_match_skipped_count ?? 0,
    semantic_match_openai_error_count: sm.semantic_match_openai_error_count ?? 0,
    semantic_match_openai_calls: sm.semantic_match_openai_calls ?? 0,
    semantic_match_confidence_avg: sm.semantic_match_confidence_avg ?? null,
    semantic_match_confidence_min: sm.semantic_match_confidence_min ?? null,
    semantic_match_confidence_max: sm.semantic_match_confidence_max ?? null,
    semantic_match_estimated_prompt_tokens_total: sm.semantic_match_estimated_prompt_tokens_total ?? 0,
    semantic_match_estimated_cost_usd_approx: sm.semantic_match_estimated_cost_usd_approx ?? null,
  };
}

/**
 * @typedef {object} StageTimingsMs
 * @property {number} parse
 * @property {number} consolidate
 * @property {number} rank
 * @property {number} openai
 * @property {number} review_build
 * @property {number} export
 */

/**
 * @param {string} [executionTime]
 * @returns {number|null}
 */
function parseExecutionSeconds(executionTime) {
  if (!executionTime || typeof executionTime !== "string") return null;
  const m = executionTime.replace(/s$/i, "").trim();
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} comparison_result
 * @returns {object}
 */
function summarizeComparisonResult(comparison_result) {
  if (!comparison_result || typeof comparison_result !== "object") {
    return { winner_suggested: null, ranking: [] };
  }
  const ranking = Array.isArray(comparison_result.ranking)
    ? comparison_result.ranking.slice(0, 12).map((r) => ({
        supplier_key: r.supplier_key,
        rank: r.rank,
        total: r.total,
        score: r.score,
      }))
    : [];
  return {
    winner_suggested: comparison_result.winner_suggested || null,
    ranking,
    alerts_sample: Array.isArray(comparison_result.alerts)
      ? comparison_result.alerts.slice(0, 24)
      : [],
  };
}

module.exports = {
  buildMetricsSummary,
  parseExecutionSeconds,
  summarizeComparisonResult,
};
