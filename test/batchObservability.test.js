/**
 * Observabilidade, histórico e decisão de lote (batch).
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const { DECISION_STATUS, deriveInitialDecisionStatus, canTransitionToManualDecision } = require("../rfq/batch/batchDecision");
const { buildMetricsSummary, summarizeComparisonResult } = require("../rfq/batch/batchMetrics");
const batchHistoryStore = require("../rfq/batch/batchHistoryStore");
const { runCompareBatch } = require("../rfq/batch/compareBatch");

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "batch-obs-"));
  batchHistoryStore.setHistoryDirForTests(tmpDir);
});

after(() => {
  batchHistoryStore.setHistoryDirForTests(null);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function xlsxBuffer(rows, sheetName = "ITENS_COTACAO") {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("batchDecision", () => {
  it("processed quando não exige revisão", () => {
    assert.strictEqual(deriveInitialDecisionStatus(false), DECISION_STATUS.PROCESSED);
  });
  it("review_required quando exige revisão", () => {
    assert.strictEqual(deriveInitialDecisionStatus(true), DECISION_STATUS.REVIEW_REQUIRED);
  });
  it("transição aprovado/rejeitado a partir de processed", () => {
    assert.strictEqual(canTransitionToManualDecision(DECISION_STATUS.PROCESSED, "approved").ok, true);
    assert.strictEqual(canTransitionToManualDecision(DECISION_STATUS.REVIEW_REQUIRED, "rejected").ok, true);
  });
  it("bloqueia segunda decisão", () => {
    assert.strictEqual(canTransitionToManualDecision(DECISION_STATUS.APPROVED, "rejected").ok, false);
  });
});

describe("batchMetrics", () => {
  it("buildMetricsSummary agrega contagens", () => {
    const m = buildMetricsSummary({
      batch_id: "B-1-abc",
      files_received: 2,
      files_parsed: 2,
      quotes_extracted: 2,
      executionTime: "1.00s",
      stage_timings_ms: {
        parse: 10,
        consolidate: 2,
        semantic: 0,
        rank: 5,
        openai: 0,
        review_build: 1,
        export: 3,
      },
      manual_review_required: false,
      review_summary: {
        blocking_issue_count: 0,
        error_issue_count: 1,
        warning_issue_count: 2,
        info_issue_count: 0,
      },
      analysis_source: "deterministic",
      item_key_collision_count: 0,
      semantic_match_stats: {
        semantic_match_attempted_count: 2,
        semantic_match_applied_count: 1,
        semantic_match_manual_review_count: 0,
        semantic_match_rejected_count: 1,
        semantic_match_skipped_count: 1,
        semantic_match_openai_error_count: 0,
        semantic_match_openai_calls: 2,
        semantic_match_confidence_avg: 0.88,
        semantic_match_confidence_min: 0.8,
        semantic_match_confidence_max: 0.95,
        semantic_match_estimated_prompt_tokens_total: 400,
        semantic_match_estimated_cost_usd_approx: 0.0001,
      },
    });
    assert.strictEqual(m.blocking_issue_count, 0);
    assert.strictEqual(m.error_issue_count, 1);
    assert.strictEqual(m.warning_issue_count, 2);
    assert.strictEqual(m.item_key_collision_count, 0);
    assert.strictEqual(m.stage_timings_ms.parse, 10);
    assert.strictEqual(m.semantic_match_skipped_count, 1);
    assert.strictEqual(m.semantic_match_confidence_avg, 0.88);
  });

  it("summarizeComparisonResult", () => {
    const s = summarizeComparisonResult({
      winner_suggested: { name: "A" },
      ranking: [{ supplier_key: "a", rank: 1, total: 10, score: 100 }],
      alerts: ["x"],
    });
    assert.strictEqual(s.winner_suggested.name, "A");
    assert.strictEqual(s.ranking.length, 1);
  });
});

describe("batchHistoryStore", () => {
  it("persistência e consulta por batch_id", () => {
    const batch_id = "B-999-testabcdef";
    const rec = batchHistoryStore.saveBatchRecord(
      {
        batch_id,
        created_at: new Date().toISOString(),
        request_summary: { files_received: 2, file_names: ["a.xlsx", "b.xlsx"] },
        review_summary: { manual_review_required: false },
        comparison_result_summary: { winner_suggested: { name: "X" } },
        export_filename: "batch-B-999-testabcdef.xlsx",
        decision_status: DECISION_STATUS.PROCESSED,
        metrics_summary: { batch_id, executionTime: "0.5s" },
        audit_log: [],
      },
      tmpDir
    );
    assert.strictEqual(rec.batch_id, batch_id);

    const loaded = batchHistoryStore.loadBatchRecord(batch_id, tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded.decision_status, DECISION_STATUS.PROCESSED);
  });

  it("auditoria de decisão approved", () => {
    const batch_id = "B-888-aabbccdd";
    batchHistoryStore.saveBatchRecord(
      {
        batch_id,
        created_at: new Date().toISOString(),
        request_summary: { files_received: 2, file_names: ["a.xlsx", "b.xlsx"] },
        review_summary: { manual_review_required: true },
        comparison_result_summary: {},
        export_filename: "f.xlsx",
        decision_status: DECISION_STATUS.REVIEW_REQUIRED,
        metrics_summary: {},
        audit_log: [],
      },
      tmpDir
    );
    const r = batchHistoryStore.applyDecision(
      batch_id,
      { status: "approved", reason: "OK", decided_by: "user@corp.com", notes: "ok" },
      tmpDir
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.record.decision_status, DECISION_STATUS.APPROVED);
    assert.strictEqual(r.audit.previous_status, DECISION_STATUS.REVIEW_REQUIRED);
    assert.strictEqual(r.audit.new_status, DECISION_STATUS.APPROVED);
    assert.ok(r.audit.decided_at);
  });

  it("rejeição manual", () => {
    const batch_id = "B-777-eeff0011";
    batchHistoryStore.saveBatchRecord(
      {
        batch_id,
        created_at: new Date().toISOString(),
        request_summary: {},
        review_summary: {},
        comparison_result_summary: {},
        export_filename: "f.xlsx",
        decision_status: DECISION_STATUS.PROCESSED,
        metrics_summary: {},
        audit_log: [],
      },
      tmpDir
    );
    const r = batchHistoryStore.applyDecision(
      batch_id,
      { status: "rejected", reason: "Dados inconsistentes", decided_by: "rev@corp.com" },
      tmpDir
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.record.decision_status, DECISION_STATUS.REJECTED);
  });

  it("rejeita decisão duplicada", () => {
    const batch_id = "B-666-11223344";
    batchHistoryStore.saveBatchRecord(
      {
        batch_id,
        created_at: new Date().toISOString(),
        request_summary: {},
        review_summary: {},
        comparison_result_summary: {},
        export_filename: "f.xlsx",
        decision_status: DECISION_STATUS.APPROVED,
        metrics_summary: {},
        audit_log: [],
      },
      tmpDir
    );
    const r = batchHistoryStore.applyDecision(
      batch_id,
      { status: "rejected", reason: "x", decided_by: "y" },
      tmpDir
    );
    assert.strictEqual(r.ok, false);
  });
});

describe("runCompareBatch observabilidade", () => {
  it("lote com review_required quando aplicável", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const out = await runCompareBatch({
      files: [
        { buffer: xlsxBuffer([header, ["A", 1, "UN", "1,00", "1,00"]]), originalname: "onlyA.xlsx" },
        { buffer: xlsxBuffer([header, ["B", 1, "UN", "2,00", "2,00"]]), originalname: "onlyB.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir },
    });
    assert.strictEqual(out.status, "success");
    assert.ok(out.created_at);
    assert.ok(out.metrics_summary);
    assert.ok(out.metrics_summary.stage_timings_ms);
    assert.strictEqual(typeof out.decision_status, "string");
    assert.ok(out.comparison_result_summary);
  });

  it("decision_status alinha a manual_review_required", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const out = await runCompareBatch({
      files: [
        { buffer: xlsxBuffer([header, ["I", 1, "UN", "1,00", "1,00"]]), originalname: "x.xlsx" },
        { buffer: xlsxBuffer([header, ["I", 1, "UN", "2,00", "2,00"]]), originalname: "y.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir, sharedQuotationId: "RFQ-UNICO" },
    });
    assert.strictEqual(out.status, "success");
    const expectStatus = out.manual_review_required
      ? DECISION_STATUS.REVIEW_REQUIRED
      : DECISION_STATUS.PROCESSED;
    assert.strictEqual(out.decision_status, expectStatus);
  });
});
