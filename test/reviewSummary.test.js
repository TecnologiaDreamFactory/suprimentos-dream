/**
 * Camada de revisão manual (review_summary).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  buildReviewSummary,
  classifyInconsistency,
  REVIEW_CATEGORY,
  REVIEW_SEVERITY,
} = require("../rfq/batch/reviewSummary");

describe("buildReviewSummary", () => {
  it("lote sem inconsistências relevantes: contagens zero e revisão opcional", () => {
    const rs = buildReviewSummary({
      inconsistencies: [],
      warnings: [],
      allQuotes: [
        {
          proposal_label: "A (f.xlsx) [0]",
          supplier_name: "A",
          warnings: [],
          items: [{ item_key: "x", descricao: "I", quantidade: 1, preco_unitario: 1, total: 1 }],
        },
      ],
      parsedFiles: [
        {
          parse_ok: true,
          source_filename: "f.xlsx",
          pipeline_result: { parsing_confidence_snapshot: 0.95, template_detection: { alerts: [] } },
        },
      ],
      analytic_manual_review: false,
    });
    assert.strictEqual(rs.blocking_issue_count, 0);
    assert.strictEqual(rs.error_issue_count, 0);
    assert.strictEqual(rs.warning_issue_count, 0);
    assert.strictEqual(rs.manual_review_required, false);
    assert.ok(rs.recommended_actions.some((a) => /opcional/i.test(a)));
  });

  it("apenas warning (ex.: divergência de total)", () => {
    const rs = buildReviewSummary({
      inconsistencies: [],
      warnings: ["Total declarado (100.00) difere do recalculado (99.00)"],
      allQuotes: [],
      parsedFiles: [],
      analytic_manual_review: false,
    });
    assert.strictEqual(rs.warning_issue_count >= 1, true);
    assert.strictEqual(rs.manual_review_required, true);
    assert.ok(rs.priority_queue.length >= 1);
  });

  it("error: item ausente", () => {
    const rs = buildReviewSummary({
      inconsistencies: [
        {
          code: "ITEM_MISSING",
          type: "item_missing",
          severity: "error",
          message: "Item ausente",
          supplier: "Forn (a.xlsx) [0]",
          detail: "Parafuso",
          file: "a.xlsx",
        },
      ],
      warnings: [],
      allQuotes: [],
      parsedFiles: [],
      analytic_manual_review: false,
    });
    assert.strictEqual(rs.error_issue_count >= 1, true);
    assert.strictEqual(rs.manual_review_required, true);
    assert.ok(rs.recommended_actions.some((a) => /planilha|fornecedor|item/i.test(a)));
  });

  it("blocking: quotation_id divergente", () => {
    const rs = buildReviewSummary({
      inconsistencies: [
        {
          code: "QUOTATION_ID_DIVERGENT",
          type: "quotation_id",
          severity: "blocking",
          message: "ids diferentes",
          detail: "x",
        },
      ],
      warnings: [],
      allQuotes: [],
      parsedFiles: [],
      analytic_manual_review: false,
    });
    assert.strictEqual(rs.blocking_issue_count, 1);
    assert.strictEqual(rs.manual_review_required, true);
    assert.ok(rs.priority_queue.some((p) => /RFQ|mesmo RFQ|cota/i.test(p)));
  });

  it("colisão item_key", () => {
    const rs = buildReviewSummary({
      inconsistencies: [
        {
          code: "ITEM_KEY_COLLISION_CANDIDATE",
          type: "item_key",
          severity: "warning",
          message: "Possível colisão",
          detail: "k1",
        },
      ],
      warnings: [],
      allQuotes: [],
      parsedFiles: [],
      analytic_manual_review: false,
    });
    assert.strictEqual(rs.error_issue_count >= 1, true);
    assert.ok(rs.top_review_reasons.some((t) => /item_key|colis/i.test(t)));
  });

  it("quotation_id divergente gera fila e ações", () => {
    const rs = buildReviewSummary({
      inconsistencies: [
        {
          code: "QUOTATION_ID_DIVERGENT",
          type: "quotation_id",
          severity: "blocking",
          message: "m",
          detail: "d",
        },
      ],
      warnings: [],
      allQuotes: [],
      parsedFiles: [],
      analytic_manual_review: false,
    });
    assert.ok(rs.recommended_actions.some((a) => /RFQ|cotação|arquivo/i.test(a)));
  });

  it("item ausente em fornecedor na fila", () => {
    const rs = buildReviewSummary({
      inconsistencies: [
        {
          code: "ITEM_MISSING",
          type: "item_missing",
          severity: "error",
          message: "Item ausente para X",
          supplier: "FornecedorX (f.xlsx) [1]",
          detail: "ItemZ",
          file: "f.xlsx",
        },
      ],
      warnings: [],
      allQuotes: [],
      parsedFiles: [],
      analytic_manual_review: false,
    });
    assert.ok(rs.priority_queue.some((p) => /ausente|Fornecedor|falta/i.test(p)));
  });

  it("analytic_manual_review força manual_review_required", () => {
    const rs = buildReviewSummary({
      inconsistencies: [],
      warnings: [],
      allQuotes: [],
      parsedFiles: [],
      analytic_manual_review: true,
    });
    assert.strictEqual(rs.manual_review_required, true);
  });

  it("semantic_stats: destaca ruído e ação em confiança intermediária recorrente", () => {
    const rs = buildReviewSummary({
      inconsistencies: [],
      warnings: [],
      allQuotes: [],
      parsedFiles: [],
      analytic_manual_review: false,
      semantic_stats: {
        semantic_match_attempted_count: 4,
        semantic_match_applied_count: 0,
        semantic_match_manual_review_count: 3,
        semantic_match_rejected_count: 1,
      },
    });
    assert.ok(rs.top_review_reasons.some((r) => /item_semantic_telemetry/i.test(String(r))));
    assert.ok(rs.recommended_actions.some((a) => /confiança intermediária/i.test(String(a))));
  });
});

describe("classifyInconsistency", () => {
  it("mapeia quotation_id para blocking", () => {
    const c = classifyInconsistency({
      code: "QUOTATION_ID_DIVERGENT",
      type: "quotation_id",
      message: "x",
    });
    assert.strictEqual(c.severity, REVIEW_SEVERITY.BLOCKING);
    assert.strictEqual(c.category, REVIEW_CATEGORY.QUOTATION_ID);
  });
});
