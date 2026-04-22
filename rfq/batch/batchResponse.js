/**
 * Enxuga resposta JSON do compare-batch quando debug=0.
 */

/**
 * @param {object} result — retorno runCompareBatch (success)
 * @param {boolean} debug
 * @returns {object}
 */
function shapeCompareBatchResponse(result, debug) {
  if (debug || result.status !== "success") {
    return result;
  }

  const inconsistencies = result.inconsistencies || [];
  const codes = [...new Set(inconsistencies.map((i) => i.code || i.type).filter(Boolean))].slice(0, 12);

  const severities = inconsistencies.map((i) => i.severity).filter(Boolean);
  const hasError = severities.includes("error");

  return {
    status: result.status,
    backend: result.backend,
    batch_api_version: result.batch_api_version,
    batch_id: result.batch_id,
    created_at: result.created_at,
    decision_status: result.decision_status,
    metrics_summary: result.metrics_summary,
    comparison_result_summary: result.comparison_result_summary,
    files_received: result.files_received,
    files_parsed: result.files_parsed,
    quotes_extracted: result.quotes_extracted,
    analysis_source: result.analysis_source,
    manual_review_required: result.manual_review_required,
    review_summary: result.review_summary,
    comparison_result: result.comparison_result,
    analytic_summary: result.analytic_summary,
    openai_confidence: result.openai_confidence,
    ai_comparison_feedback: result.ai_comparison_feedback,
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 80) : result.warnings,
    downloadUrl: result.downloadUrl,
    export_filename: result.export_filename,
    download_token: result.download_token,
    executionTime: result.executionTime,
    inconsistency_count: inconsistencies.length,
    inconsistency_codes_sample: codes,
    inconsistency_has_error_severity: hasError,
    item_key_collision_count: Array.isArray(result.collision_details)
      ? result.collision_details.length
      : 0,
  };
}

module.exports = {
  shapeCompareBatchResponse,
};
