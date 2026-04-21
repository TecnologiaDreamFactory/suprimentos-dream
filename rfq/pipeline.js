/**
 * Orquestra parse legado + validação + comparação + canônico v2 + OpenAI opcional.
 * Suporta PDF/DOCX/TXT via texto + IA quando há OPENAI_API_KEY (ingestão ligada por padrão; desligue com OPENAI_ENABLE_DOCUMENT_INGEST=0).
 */

const path = require("path");
const { parseExcelToCanonical } = require("./parser");
const { validateLegacyResult } = require("./validate/rules");
const { compareSuppliersFromLegacy } = require("./compare/rank");
const {
  buildCanonicalV2FromLegacy,
  buildCanonicalV2FromGrouped,
} = require("./normalize/canonical");
const { detectTemplate } = require("./templates/router");
const { parseGroupedBlocks } = require("./templates/groupedBlocksParser");
const { detectDocumentType, isDocumentAiType } = require("./ingest/detectDocumentType");
const { extractPlainText } = require("./ingest/extractPlainText");
const { buildLegacyFromAiDocument } = require("./ingest/legacyFromAiDocument");
const { extractQuotationFromDocument } = require("../ai/openaiDocumentExtract");
const { getOpenAIConfig, isOpenAIConfigured } = require("../ai/openaiConfig");
const {
  resolveAmbiguousMapping,
  generateAnalyticSummary,
  shouldAttemptAmbiguityResolution,
  buildDoubts,
} = require("../ai/openaiClient");
const { buildAmbiguityPayload, buildAnalyticSummaryPayload } = require("../ai/openaiPayloads");

function earlyFailureReturn(legacy, templateInfo, baseExtra = {}) {
  const base = {
    parser_version: 2,
    template_detection: templateInfo,
    ...baseExtra,
  };
  return {
    ...legacy,
    ...base,
    canonical_quotation: null,
    validation_result: null,
    comparison_result: null,
    analysis_source: "deterministic",
    manual_review_required: true,
    analytic_summary: null,
    openai_ambiguity_advisory: null,
    openai_confidence: null,
    warnings: [],
  };
}

/**
 * Confiança heurística 0..1 a partir do mapping legado.
 * @param {object} legacy
 * @returns {number}
 */
function computeParsingConfidence(legacy) {
  if (!legacy || legacy.status !== "success") return 0;
  const m = legacy.mapping || {};
  const fields = ["descricao", "quantidade", "preco_unitario"];
  let sum = 0;
  let n = 0;
  for (const f of fields) {
    const c = m[f]?.confidence;
    if (typeof c === "number") {
      sum += c;
      n += 1;
    }
  }
  return n ? Math.min(1, sum / n) : 0;
}

/**
 * @param {Buffer} buffer
 * @param {string} rfqId
 * @param {string} [source]
 * @param {{ skipOpenAI?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function parseWithPipeline(buffer, rfqId, source = "", options = {}) {
  const filename = source || "";
  const docType = detectDocumentType(buffer, filename);
  const cfg = getOpenAIConfig();

  let legacy;
  let groupedResult = null;
  /** @type {object} */
  let templateInfo;

  if (isDocumentAiType(docType)) {
    templateInfo = {
      template_type: "document_ai",
      confidence: 0.85,
      alerts: [],
      ingest_route: "document_ai",
      document_type: docType.type,
    };

    if (!cfg.enableDocumentIngest || !isOpenAIConfigured()) {
      legacy = {
        status: "error",
        service: "rfq-parser",
        rfq_id: rfqId,
        source: filename || "unknown",
        sheet: { name: "document", header_row: null, total_rows: 0 },
        mapping: {},
        items: [],
        summary: {
          items_total: 0,
          items_parsed: 0,
          items_with_warnings: 0,
          items_invalid: 0,
          needs_review: true,
          review_reasons: [
            "Arquivo PDF/DOCX/TXT requer OPENAI_API_KEY e ingestão de documentos habilitada (ligada por padrão quando há chave).",
          ],
        },
        warnings: [],
        errors: [
          {
            code: "DOCUMENT_INGEST_DISABLED",
            message:
              "Configure OPENAI_API_KEY para processar PDF, DOCX ou TXT. Se a ingestão estiver desligada, defina OPENAI_ENABLE_DOCUMENT_INGEST=1.",
          },
        ],
      };
      return earlyFailureReturn(legacy, templateInfo);
    }

    const textRes = await extractPlainText(buffer, docType.type, cfg);
    if (!textRes.ok) {
      legacy = {
        status: "error",
        service: "rfq-parser",
        rfq_id: rfqId,
        source: filename || "unknown",
        sheet: { name: "document", header_row: null, total_rows: 0 },
        mapping: {},
        items: [],
        summary: {
          items_total: 0,
          items_parsed: 0,
          items_with_warnings: 0,
          items_invalid: 0,
          needs_review: true,
          review_reasons: [textRes.error || "Falha ao extrair texto do documento."],
        },
        warnings: [],
        errors: [
          {
            code: "DOCUMENT_TEXT_EXTRACT",
            message:
              textRes.error === "documento_sem_texto"
                ? "PDF sem camada de texto (possivelmente escaneado). Envie Excel ou PDF com texto selecionável."
                : String(textRes.error || "extração de texto falhou"),
          },
        ],
      };
      return earlyFailureReturn(legacy, templateInfo);
    }

    const extracted = await extractQuotationFromDocument({
      text: textRes.text,
      filename,
      rfqId,
      truncated: textRes.truncated,
    });

    if (!extracted) {
      legacy = {
        status: "error",
        service: "rfq-parser",
        rfq_id: rfqId,
        source: filename || "unknown",
        sheet: { name: "document", header_row: null, total_rows: 0 },
        mapping: {},
        items: [],
        summary: {
          items_total: 0,
          items_parsed: 0,
          items_with_warnings: 0,
          items_invalid: 0,
          needs_review: true,
          review_reasons: ["Falha ao extrair itens do documento via IA."],
        },
        warnings: [],
        errors: [{ code: "DOCUMENT_AI_FAILED", message: "Falha ao extrair itens do documento via IA." }],
      };
      return earlyFailureReturn(legacy, templateInfo);
    }

    const ingestWarnings = [];
    if (textRes.truncated) {
      ingestWarnings.push("Texto do documento truncado antes do envio ao modelo.");
    }

    legacy = buildLegacyFromAiDocument(extracted, {
      rfqId,
      source: path.basename(filename) || "document",
      filename,
      ingestWarnings,
    });

    if (!legacy) {
      legacy = {
        status: "error",
        service: "rfq-parser",
        rfq_id: rfqId,
        source: filename || "unknown",
        sheet: { name: "document", header_row: null, total_rows: 0 },
        mapping: {},
        items: [],
        summary: {
          items_total: 0,
          items_parsed: 0,
          items_with_warnings: 0,
          items_invalid: 0,
          needs_review: true,
          review_reasons: ["Nenhum item válido extraído do documento."],
        },
        warnings: [],
        errors: [{ code: "DOCUMENT_NO_ITEMS", message: "Nenhum item válido extraído do documento." }],
      };
      return earlyFailureReturn(legacy, templateInfo);
    }
  } else {
    templateInfo = detectTemplate(buffer);
    const tryGroupedFirst = templateInfo.template_type === "grouped_suppliers";
    if (tryGroupedFirst) {
      const g = parseGroupedBlocks(buffer, rfqId, source);
      if (g.ok && g.legacy && g.legacy.status === "success") {
        legacy = g.legacy;
        groupedResult = g;
      }
    }

    if (!legacy || legacy.status !== "success") {
      legacy = parseExcelToCanonical(buffer, rfqId, source);
    }

    if (legacy.status !== "success" && legacy.errors?.some((e) => e.code === "NO_HEADER")) {
      const g = parseGroupedBlocks(buffer, rfqId, source);
      if (g.ok && g.legacy && g.legacy.status === "success") {
        legacy = g.legacy;
        groupedResult = g;
        templateInfo.template_type = "grouped_suppliers";
        templateInfo.alerts = [
          ...(templateInfo.alerts || []),
          "Layout agrupado detectado após falha do parser linha a linha.",
        ];
      }
    }

    templateInfo.ingest_route = "excel";

    if (tryGroupedFirst && !groupedResult && legacy.status === "success") {
      templateInfo.alerts = [
        ...(templateInfo.alerts || []),
        "Parser agrupado não aplicado; resultado do modo linha a linha.",
      ];
    }
  }

  const base = {
    parser_version: 2,
    template_detection: templateInfo,
  };

  if (legacy.status !== "success") {
    return earlyFailureReturn(legacy, templateInfo);
  }

  let parsingConfidence;
  let parsingAlerts;

  if (groupedResult) {
    parsingConfidence = groupedResult.parsing_confidence ?? 0.8;
    parsingAlerts = [...(groupedResult.parsing_alerts || []), ...(legacy.warnings || [])];
  } else if (legacy.summary?._template === "document_ai" && legacy.summary?.document_extract_confidence != null) {
    parsingConfidence = legacy.summary.document_extract_confidence;
    parsingAlerts = [...(legacy.warnings || [])];
  } else {
    parsingConfidence = computeParsingConfidence(legacy);
    parsingAlerts = [...(legacy.warnings || [])];
  }

  const validation = validateLegacyResult(legacy);
  parsingAlerts = [
    ...parsingAlerts,
    ...validation.warnings.map((w) =>
      typeof w === "string" ? w : w.message || w.code || JSON.stringify(w)
    ),
  ];

  const comparison = compareSuppliersFromLegacy(legacy, validation);

  let canonical_quotation = groupedResult
    ? buildCanonicalV2FromGrouped(legacy, groupedResult)
    : buildCanonicalV2FromLegacy(legacy, parsingConfidence, parsingAlerts);

  const ocfg = getOpenAIConfig();
  const threshold = ocfg.parsingConfidenceThreshold;

  let analysis_source = "deterministic";
  let openai_ambiguity_advisory = null;
  let analytic_summary = null;
  let openai_confidence = null;
  const openaiWarnings = [];

  const skipOpenAI = Boolean(options.skipOpenAI);

  let ambiguitySucceeded = false;
  let summarySucceeded = false;

  if (!skipOpenAI) {
    const valWarnings = validation.warnings || [];
    const documentAiIngest = templateInfo.template_type === "document_ai";
    const attemptAmbiguity =
      !documentAiIngest &&
      shouldAttemptAmbiguityResolution(parsingConfidence, parsingAlerts, valWarnings);

    if (attemptAmbiguity) {
      const doubts = buildDoubts(parsingConfidence, threshold, parsingAlerts);
      const ambPayload = buildAmbiguityPayload({
        template_type: templateInfo.template_type,
        template_detection: templateInfo,
        parsing_confidence: parsingConfidence,
        parsing_alerts: parsingAlerts,
        legacy,
        groupedResult,
        buffer,
        doubts,
      });

      try {
        const amb = await resolveAmbiguousMapping(ambPayload);
        if (amb) {
          openai_ambiguity_advisory = amb;
          ambiguitySucceeded = true;
          if (typeof amb.confidence === "number") {
            openai_confidence = amb.confidence;
          }
        } else if (getOpenAIConfig().enableAmbiguity && isOpenAIConfigured()) {
          openaiWarnings.push("openai_ambiguity_resolution_failed_or_skipped");
        }
      } catch {
        openaiWarnings.push("openai_ambiguity_resolution_exception");
      }
    }

    const summaryPayload = buildAnalyticSummaryPayload({
      canonical_quotation,
      validation_result: validation,
      comparison_result: comparison,
      legacy_summary: legacy.summary,
    });

    try {
      const sum = await generateAnalyticSummary(summaryPayload);
      if (sum) {
        analytic_summary = sum;
        summarySucceeded = true;
        if (typeof sum.confidence === "number") {
          openai_confidence =
            openai_confidence != null
              ? Math.min(1, (openai_confidence + sum.confidence) / 2)
              : sum.confidence;
        }
      } else if (getOpenAIConfig().enableSummary && isOpenAIConfigured()) {
        openaiWarnings.push("openai_analytic_summary_failed_or_skipped");
      }
    } catch {
      openaiWarnings.push("openai_analytic_summary_exception");
    }

    if (ambiguitySucceeded && summarySucceeded) {
      analysis_source = "hybrid";
    } else if (ambiguitySucceeded) {
      analysis_source = "hybrid";
    } else if (summarySucceeded) {
      analysis_source = "openai";
    }
  }

  const manual_review_required =
    Boolean(legacy.summary?.needs_review) ||
    !validation.ok ||
    Boolean(analytic_summary?.manual_review_required) ||
    (openai_ambiguity_advisory &&
      openai_ambiguity_advisory.resolved === false &&
      (openai_ambiguity_advisory.confidence ?? 1) < 0.5);

  const warnings = [...parsingAlerts, ...openaiWarnings];

  return {
    ...legacy,
    ...base,
    canonical_quotation,
    validation_result: validation,
    comparison_result: comparison,
    parsing_confidence_snapshot: parsingConfidence,
    analysis_source,
    manual_review_required,
    analytic_summary,
    openai_ambiguity_advisory,
    openai_confidence,
    warnings,
  };
}

module.exports = {
  parseWithPipeline,
  computeParsingConfidence,
};
