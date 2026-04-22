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

/**
 * Shape enxuto para GET /api/compare-batch/:batchId/status.
 * - processing: devolve só metadados do lote.
 * - error: devolve job_error.
 * - ready: devolve o resultado completo cacheado em memória (idêntico à
 *   resposta síncrona antiga). Quando o cache estiver vazio (ex.: restart
 *   entre o término do job e o polling), retorna um fallback enxuto a
 *   partir do record histórico para o cliente ainda conseguir baixar.
 *
 * @param {object} rec Record do histórico persistido
 * @param {object|null} cached Resultado completo em cache (shapeCompareBatchResponse)
 */
function shapeBatchStatusResponse(rec, cached) {
  const base = {
    batch_id: rec.batch_id,
    job_status: rec.job_status || "ready",
    created_at: rec.created_at,
    job_started_at: rec.job_started_at || rec.created_at,
    job_finished_at: rec.job_finished_at || null,
  };
  if (rec.job_status === "processing") {
    return base;
  }
  if (rec.job_status === "error") {
    return {
      ...base,
      job_error: rec.job_error || { code: "UNKNOWN", message: "Erro desconhecido" },
    };
  }
  if (cached) {
    return {
      ...base,
      result: cached,
    };
  }
  return {
    ...base,
    result: {
      status: "success",
      backend: "pipeline-batch",
      batch_id: rec.batch_id,
      created_at: rec.created_at,
      decision_status: rec.decision_status,
      metrics_summary: rec.metrics_summary,
      comparison_result_summary: rec.comparison_result_summary,
      review_summary: rec.review_summary,
      ai_comparison_feedback: rec.ai_comparison_feedback,
      export_filename: rec.export_filename,
      downloadUrl: null,
      _cache_miss: true,
    },
  };
}

module.exports = {
  shapeCompareBatchResponse,
  shapeBatchStatusResponse,
};
