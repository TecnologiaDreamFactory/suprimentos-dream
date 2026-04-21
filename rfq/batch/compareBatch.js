/**
 * Orquestra comparação em lote: parse por arquivo, consolidação, ranking, export XLSX.
 *
 * Export: uma única chamada a `exportBatchWorkbook` após métricas de estágio (parse…revisão); o retorno
 * incorpora tempos finais (incl. duração do export) em `metrics_summary` — evita IO duplicado.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseWithPipeline } = require("../pipeline");
const { compareSuppliersFromLegacy } = require("../compare/rank");
const { extractSupplierQuotes } = require("./extractSupplierQuotes");
const { consolidateQuotes } = require("./consolidateQuotes");
const {
  validateFileCount,
  validateMinQuotes,
  collectBatchInconsistencies,
} = require("./validateBatch");
const { BATCH_ERROR_CODES } = require("./batchTypes");
const { exportBatchWorkbook } = require("./workbookExport");
const { generateAnalyticSummary } = require("../../ai/openaiClient");
const { getOpenAIConfig, isOpenAIConfigured } = require("../../ai/openaiConfig");
const {
  detectItemKeyCollisions,
  detectIntraQuoteDuplicateKeys,
} = require("./itemKey");
const { registerDownloadToken } = require("./batchDownloadStore");
const { buildReviewSummary, BATCH_API_VERSION } = require("./reviewSummary");
const { deriveInitialDecisionStatus } = require("./batchDecision");
const {
  buildMetricsSummary,
  summarizeComparisonResult,
} = require("./batchMetrics");
const { enrichConsolidationWithSemanticMatches } = require("./semanticItemMatch");
const { buildAiComparisonFeedback } = require("./aiComparisonFeedback");

/**
 * @param {import('./extractSupplierQuotes').SupplierQuote[]} quotes
 * @param {string[]} extraAlerts
 */
function buildBatchComparisonResult(quotes, extraAlerts = []) {
  const supplier_totals = {};
  for (const q of quotes) {
    const total = q.declared_total != null ? q.declared_total : q.recalculated_total;
    supplier_totals[q.proposal_label] = {
      total,
      items: q.items.length,
      avgPrice: total / Math.max(1, q.items.length),
    };
  }

  const items = [];
  for (const q of quotes) {
    for (const it of q.items) {
      items.push({
        descricao: it.descricao,
        quantidade: it.quantidade,
        preco_unitario: it.preco_unitario,
        total: it.total,
        fornecedor: q.proposal_label,
      });
    }
  }

  const legacy = {
    status: "success",
    items,
    summary: {
      supplier_totals,
      best_supplier: null,
    },
    source: "batch",
  };

  const validation = { ok: true, warnings: extraAlerts.map((m) => ({ message: m })) };
  return compareSuppliersFromLegacy(legacy, validation);
}

/**
 * @param {object} params
 * @param {{ buffer: Buffer, originalname: string }[]} params.files
 * @param {{ skipOpenAI?: boolean, tempDir: string, publicDownloadPath?: string, sharedQuotationId?: string|null }} params.options
 */
async function runCompareBatch(params) {
  const { files, options = {} } = params;
  const skipOpenAI = Boolean(options.skipOpenAI);
  const tempDir = options.tempDir;
  const sharedQuotationId = options.sharedQuotationId ? String(options.sharedQuotationId).trim() : null;
  const start = Date.now();
  const created_at = new Date().toISOString();

  const batchId = `B-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const fc = validateFileCount(files.length);
  if (!fc.ok) {
    return {
      status: "error",
      backend: "pipeline-batch",
      batch_api_version: BATCH_API_VERSION,
      batch_id: batchId,
      code: fc.code,
      error: fc.message,
      files_received: files.length,
      files_parsed: 0,
      quotes_extracted: 0,
      executionTime: `${((Date.now() - start) / 1000).toFixed(2)}s`,
    };
  }

  /** @type {import('./batchTypes').ParsedQuotationFile[]} */
  const parsedFiles = [];
  /** @type {import('./extractSupplierQuotes').SupplierQuote[]} */
  const allQuotes = [];

  let parseMs = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const quotationId = sharedQuotationId || `BATCH-${batchId}-F${i}`;
    let pipelineResult;
    const tParse0 = Date.now();
    try {
      pipelineResult = await parseWithPipeline(f.buffer, quotationId, f.originalname || "", {
        skipOpenAI: true,
      });
    } catch (e) {
      parseMs += Date.now() - tParse0;
      parsedFiles.push({
        file_index: i,
        source_filename: f.originalname || `file_${i}`,
        parse_ok: false,
        parse_error: e.message || String(e),
        supplier_quotes: [],
        quotation_id: quotationId,
      });
      continue;
    }
    parseMs += Date.now() - tParse0;

    const extracted = extractSupplierQuotes(pipelineResult, {
      source_filename: f.originalname || `file_${i}`,
      file_index: i,
    });

    if (!extracted.ok) {
      parsedFiles.push({
        file_index: i,
        source_filename: f.originalname || `file_${i}`,
        quotation_id: quotationId,
        parse_ok: false,
        parse_error: extracted.error,
        supplier_quotes: [],
        pipeline_result: { status: pipelineResult.status },
      });
      continue;
    }

    const qts = extracted.quotes.map((q) => ({
      ...q,
      quotation_id: pipelineResult.rfq_id || quotationId,
    }));

    parsedFiles.push({
      file_index: i,
      source_filename: f.originalname || `file_${i}`,
      quotation_id: pipelineResult.rfq_id || quotationId,
      parse_ok: true,
      supplier_quotes: qts,
      pipeline_result: pipelineResult,
    });

    for (const q of qts) {
      allQuotes.push(q);
    }
  }

  const filesParsed = parsedFiles.filter((p) => p.parse_ok).length;
  const mq = validateMinQuotes(allQuotes);
  if (!mq.ok) {
    return {
      status: "error",
      backend: "pipeline-batch",
      batch_api_version: BATCH_API_VERSION,
      batch_id: batchId,
      code: mq.code,
      error: mq.message,
      files_received: files.length,
      files_parsed: filesParsed,
      quotes_extracted: allQuotes.length,
      parsed_files: parsedFiles,
      executionTime: `${((Date.now() - start) / 1000).toFixed(2)}s`,
    };
  }

  const tCons0 = Date.now();
  let consolidated = consolidateQuotes(allQuotes);
  const consolidateMs = Date.now() - tCons0;

  const tSem0 = Date.now();
  const semanticBundle = await enrichConsolidationWithSemanticMatches({
    allQuotes,
    consolidated,
    batchId,
    skipOpenAI,
    correlationId: null,
  });
  consolidated = semanticBundle.consolidated;
  const semantic_ms = semanticBundle.semantic_ms;
  const semantic_match_stats = semanticBundle.stats;
  const semantic_review_hints = semanticBundle.reviewHints;
  const semantic_match_notes = semanticBundle.semantic_match_notes;
  const semantic_match_debug = semanticBundle.debug;

  const tRank0 = Date.now();
  const { inconsistencies, warnings: consistencyWarnings } = collectBatchInconsistencies(
    parsedFiles,
    consolidated
  );

  const { warnings: collisionWarnings, collision_details } = detectItemKeyCollisions(allQuotes);
  const intraWarnings = detectIntraQuoteDuplicateKeys(allQuotes);

  for (const d of collision_details) {
    inconsistencies.push({
      code: d.code,
      type: "item_key",
      detail: d.item_key,
      message: `Possível colisão de chave: ${d.item_key} (${d.distinct_fingerprints} variantes)`,
      severity: d.severity || "warning",
    });
  }

  const batchWarnings = [];
  for (const q of allQuotes) {
    batchWarnings.push(...q.warnings);
  }
  batchWarnings.push(...consistencyWarnings);
  batchWarnings.push(...collisionWarnings);
  batchWarnings.push(...intraWarnings);

  const comparison_result = buildBatchComparisonResult(allQuotes, batchWarnings);
  const rankMs = Date.now() - tRank0;

  let analysis_source = "deterministic";
  let analytic_summary = null;
  let openai_confidence = null;
  let openaiAnalyticThrew = false;

  const oaiCfg = getOpenAIConfig();
  const tOpenAI0 = Date.now();
  if (!skipOpenAI && isOpenAIConfigured()) {
    try {
      const sum = await generateAnalyticSummary({
        canonical_quotation: {
          template_type: "batch_aggregate",
          batch_id: batchId,
          proposals_count: allQuotes.length,
        },
        validation_result: {
          ok: true,
          warnings: batchWarnings.map((m) => ({ message: m })),
        },
        comparison_result,
        legacy_summary: {
          batch: true,
          files_received: files.length,
          inconsistency_count: inconsistencies.length,
        },
      });
      if (sum) {
        analytic_summary = sum;
        analysis_source = "openai";
        if (typeof sum.confidence === "number") openai_confidence = sum.confidence;
      }
    } catch {
      openaiAnalyticThrew = true;
    }
  }
  const openaiMs = Date.now() - tOpenAI0;

  const ai_comparison_feedback = buildAiComparisonFeedback({
    skipOpenAI,
    apiConfigured: isOpenAIConfigured(),
    enableAnalyticSummary: oaiCfg.enableSummary,
    enableSemanticItemMatch: oaiCfg.enableSemanticItemMatch,
    analyticSummaryOk: analytic_summary != null,
    openaiAnalyticThrew,
    semanticMatchAttemptedCount: semantic_match_stats.semantic_match_attempted_count,
  });

  const tRev0 = Date.now();
  const review_summary = buildReviewSummary({
    inconsistencies,
    warnings: batchWarnings,
    allQuotes,
    parsedFiles,
    analytic_manual_review: Boolean(analytic_summary?.manual_review_required),
    semantic_review_hints,
    semantic_stats: semantic_match_stats,
  });
  const reviewBuildMs = Date.now() - tRev0;

  const manual_review_required = review_summary.manual_review_required;
  const decision_status = deriveInitialDecisionStatus(manual_review_required);

  /** Métricas pré-export; tempo total e etapa export são preenchidos após um único exportBatchWorkbook */
  let metrics_summary = buildMetricsSummary({
    batch_id: batchId,
    files_received: files.length,
    files_parsed: filesParsed,
    quotes_extracted: allQuotes.length,
    executionTime: "0.00s",
    stage_timings_ms: {
      parse: parseMs,
      consolidate: consolidateMs,
      semantic: semantic_ms,
      rank: rankMs,
      openai: openaiMs,
      review_build: reviewBuildMs,
      export: 0,
    },
    manual_review_required,
    review_summary,
    analysis_source,
    item_key_collision_count: collision_details.length,
    semantic_match_stats,
  });

  const safeName = `batch-${batchId.replace(/[^a-zA-Z0-9_-]/g, "")}.xlsx`;
  const outPath = path.join(tempDir, safeName);

  /**
   * Um único export: o workbook grava tempos finais (incl. export) nos metadados antes do writeFile.
   * Ver comentário em workbookExport.js (batchStartMs + merge de metrics_summary).
   */
  const exportResult = await exportBatchWorkbook({
    batchId,
    createdAt: created_at,
    decision_status,
    metrics_summary,
    parsedFiles,
    consolidated,
    comparison_result,
    inconsistencies,
    analytic_summary,
    allQuotes,
    review_summary,
    filePath: outPath,
    batchStartMs: start,
    artifactMeta: {},
    semantic_match_notes,
  });
  metrics_summary = exportResult.metrics_summary;
  const executionTime = metrics_summary.executionTime;
  const export_generated_at = exportResult.export_generated_at;
  const export_last_updated_at = exportResult.export_last_updated_at;

  const downloadUrl = `${options.publicDownloadPath || "/downloads"}/${safeName}`;
  let download_token = null;
  try {
    download_token = registerDownloadToken(safeName);
  } catch {
    /* opcional */
  }

  return {
    status: "success",
    backend: "pipeline-batch",
    batch_api_version: BATCH_API_VERSION,
    batch_id: batchId,
    created_at,
    decision_status,
    metrics_summary,
    files_received: files.length,
    files_parsed: filesParsed,
    quotes_extracted: allQuotes.length,
    analysis_source,
    manual_review_required,
    review_summary,
    comparison_result,
    comparison_result_summary: summarizeComparisonResult(comparison_result),
    analytic_summary,
    openai_confidence,
    ai_comparison_feedback,
    warnings: [...new Set([...batchWarnings, ...comparison_result.alerts])],
    inconsistencies,
    collision_details,
    parsed_files: parsedFiles,
    consolidated,
    allQuotes,
    downloadUrl,
    export_filename: safeName,
    export_generated_at,
    export_last_updated_at,
    download_token,
    executionTime,
    semantic_match: semantic_match_stats,
    semantic_match_debug,
    semantic_match_notes,
  };
}

module.exports = {
  runCompareBatch,
  buildBatchComparisonResult,
};
