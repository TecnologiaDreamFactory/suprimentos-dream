const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  estimatePromptTokens,
  confidenceAggregate,
  summarizeSemanticDetails,
  buildTopSemanticReviewCases,
  finalizeSemanticMatchStats,
  emptySemanticMatchStats,
} = require("../rfq/batch/semanticTelemetry");

describe("semanticTelemetry", () => {
  it("estimatePromptTokens", () => {
    const n = estimatePromptTokens({ a: "x".repeat(400) });
    assert.ok(n >= 100);
  });

  it("confidenceAggregate", () => {
    assert.deepStrictEqual(confidenceAggregate([]), { avg: null, min: null, max: null });
    const a = confidenceAggregate([0.5, 0.9]);
    assert.strictEqual(a.avg, 0.7);
    assert.strictEqual(a.min, 0.5);
    assert.strictEqual(a.max, 0.9);
  });

  it("finalizeSemanticMatchStats agrega custo e tokens", () => {
    const base = {
      ...emptySemanticMatchStats(),
      semantic_match_attempted_count: 2,
      semantic_match_openai_calls: 2,
      semantic_match_applied_count: 1,
      semantic_match_manual_review_count: 0,
      semantic_match_rejected_count: 1,
      semantic_match_skipped_count: 0,
      semantic_match_openai_error_count: 0,
    };
    const fin = finalizeSemanticMatchStats(base, [0.9, 0.5], [100, 100]);
    assert.strictEqual(fin.semantic_match_estimated_prompt_tokens_total, 200);
    assert.ok(fin.semantic_match_estimated_cost_usd_approx > 0);
    assert.strictEqual(fin.semantic_match_confidence_avg, 0.7);
  });

  it("summarizeSemanticDetails limita tamanho", () => {
    const d = summarizeSemanticDetails(
      Array.from({ length: 40 }, (_, i) => ({
        reference_item_key: `k${i}`,
        outcome: "rejected",
        reason: "x",
      })),
      5
    );
    assert.strictEqual(d.length, 5);
  });

  it("buildTopSemanticReviewCases ordena por confiança", () => {
    const top = buildTopSemanticReviewCases(
      [
        {
          category: "item_semantic_review",
          reference_item_key: "a",
          candidate_item_key: "b",
          confidence: 0.7,
          summary: "s1",
        },
        {
          category: "item_semantic_review",
          reference_item_key: "c",
          candidate_item_key: "d",
          confidence: 0.9,
          summary: "s2",
        },
      ],
      5
    );
    assert.strictEqual(top[0].confidence, 0.9);
  });
});
