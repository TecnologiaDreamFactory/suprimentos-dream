const { describe, it } = require("node:test");
const assert = require("node:assert");
const { buildAiComparisonFeedback } = require("../rfq/batch/aiComparisonFeedback");

describe("buildAiComparisonFeedback", () => {
  it("skipped_by_client quando skipOpenAI", () => {
    const r = buildAiComparisonFeedback({
      skipOpenAI: true,
      apiConfigured: true,
      enableAnalyticSummary: true,
      enableSemanticItemMatch: false,
      analyticSummaryOk: false,
      openaiAnalyticThrew: false,
    });
    assert.strictEqual(r.requested, false);
    assert.strictEqual(r.status, "skipped_by_client");
    assert.strictEqual(r.analytic_summary_ok, false);
  });

  it("api_not_configured quando sem chave", () => {
    const r = buildAiComparisonFeedback({
      skipOpenAI: false,
      apiConfigured: false,
      enableAnalyticSummary: true,
      enableSemanticItemMatch: true,
      analyticSummaryOk: false,
      openaiAnalyticThrew: false,
    });
    assert.strictEqual(r.status, "api_not_configured");
    assert.ok(r.user_message.includes("OPENAI_API_KEY"));
    assert.ok(r.semantic_match_note);
  });

  it("analytic_summary_disabled", () => {
    const r = buildAiComparisonFeedback({
      skipOpenAI: false,
      apiConfigured: true,
      enableAnalyticSummary: false,
      enableSemanticItemMatch: false,
      analyticSummaryOk: false,
      openaiAnalyticThrew: false,
    });
    assert.strictEqual(r.status, "analytic_summary_disabled");
  });

  it("analytic_call_failed quando resumo vazio", () => {
    const r = buildAiComparisonFeedback({
      skipOpenAI: false,
      apiConfigured: true,
      enableAnalyticSummary: true,
      enableSemanticItemMatch: false,
      analyticSummaryOk: false,
      openaiAnalyticThrew: false,
    });
    assert.strictEqual(r.status, "analytic_call_failed");
  });

  it("analytic_call_error quando exceção", () => {
    const r = buildAiComparisonFeedback({
      skipOpenAI: false,
      apiConfigured: true,
      enableAnalyticSummary: true,
      enableSemanticItemMatch: false,
      analyticSummaryOk: false,
      openaiAnalyticThrew: true,
    });
    assert.strictEqual(r.status, "analytic_call_error");
  });

  it("ok quando resumo válido", () => {
    const r = buildAiComparisonFeedback({
      skipOpenAI: false,
      apiConfigured: true,
      enableAnalyticSummary: true,
      enableSemanticItemMatch: true,
      analyticSummaryOk: true,
      openaiAnalyticThrew: false,
      semanticMatchAttemptedCount: 2,
    });
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.analytic_summary_ok, true);
    assert.ok(r.user_message.includes("sucesso"));
  });
});
