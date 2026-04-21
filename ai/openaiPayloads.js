/**
 * Monta payloads para OpenAI a partir do contexto do pipeline (sem dados sensíveis completos).
 */

const { readBestSheetWithMerges } = require("../rfq/io/readWorkbook");
const { COLUMN_SYNONYMS, ROW_LABEL_SYNONYMS } = require("../rfq/config/aliases");

const MAX_ROWS_SNIPPET = 22;
const MAX_COLS_SNIPPET = 14;
const CELL_MAX = 120;

/**
 * Matriz textual truncada para contexto de ambiguidade.
 * @param {Buffer} buffer
 * @returns {string[][]}
 */
function buildMatrixSnippet(buffer) {
  try {
    const { rows } = readBestSheetWithMerges(buffer);
    return rows.slice(0, MAX_ROWS_SNIPPET).map((row) =>
      (row || []).slice(0, MAX_COLS_SNIPPET).map((c) => {
        const s = String(c ?? "").trim();
        return s.length > CELL_MAX ? s.slice(0, CELL_MAX) + "…" : s;
      })
    );
  } catch {
    return [];
  }
}

/**
 * @param {object} ctx
 */
function buildAmbiguityPayload(ctx) {
  const {
    template_type,
    template_detection,
    parsing_confidence,
    parsing_alerts,
    legacy,
    groupedResult,
    buffer,
    doubts,
  } = ctx;

  const snippet = buffer ? buildMatrixSnippet(buffer) : [];

  return {
    template_type: template_type || "unknown",
    template_detection,
    parsing_confidence,
    parsing_alerts: (parsing_alerts || []).slice(0, 40),
    candidate_supplier_blocks: groupedResult?.blocks || [],
    sheet_summary: legacy?.sheet
      ? {
          name: legacy.sheet.name,
          header_row: legacy.sheet.header_row,
          total_rows: legacy.sheet.total_rows,
        }
      : null,
    mapping_snapshot: legacy?.mapping
      ? Object.fromEntries(
          Object.entries(legacy.mapping).map(([k, v]) => [
            k,
            { original: v?.original, confidence: v?.confidence },
          ])
        )
      : {},
    items_sample: (legacy?.items || []).slice(0, 15).map((it) => ({
      row: it.row,
      descricao: String(it.descricao || "").slice(0, 80),
      fornecedor: it.fornecedor,
      quantidade: it.quantidade,
      preco_unitario: it.preco_unitario,
      total: it.total,
    })),
    known_aliases: {
      column_fields: Object.keys(COLUMN_SYNONYMS),
      row_labels: Object.keys(ROW_LABEL_SYNONYMS),
    },
    doubts: doubts || [],
  };
}

/**
 * @param {object} ctx
 */
function buildAnalyticSummaryPayload(ctx) {
  const { canonical_quotation, validation_result, comparison_result, legacy_summary } = ctx;
  return {
    canonical_quotation,
    validation_result: {
      ok: validation_result?.ok,
      errors: validation_result?.errors || [],
      warnings: validation_result?.warnings || [],
    },
    comparison_result,
    legacy_summary_hint: legacy_summary || null,
  };
}

module.exports = {
  buildMatrixSnippet,
  buildAmbiguityPayload,
  buildAnalyticSummaryPayload,
};
