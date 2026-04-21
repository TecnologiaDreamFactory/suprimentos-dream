/**
 * Equivalência semântica opcional no batch (determinístico + OpenAI complementar).
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const openaiClient = require("../ai/openaiClient");
const {
  tokenJaccard,
  mergeItemKeyInQuote,
  enrichConsolidationWithSemanticMatches,
  shouldAttemptSemanticItemMatch,
  __setSemanticResolverForTests,
} = require("../rfq/batch/semanticItemMatch");
const { consolidateQuotes } = require("../rfq/batch/consolidateQuotes");

const ENV_SEM = [
  "OPENAI_ENABLE_SEMANTIC_ITEM_MATCH",
  "OPENAI_SEMANTIC_ITEM_MATCH_THRESHOLD",
  "OPENAI_SEMANTIC_ITEM_MATCH_LOW_CONFIDENCE",
  "OPENAI_SEMANTIC_ITEM_MATCH_MAX_CANDIDATES",
  "OPENAI_SEMANTIC_ITEM_MATCH_MAX_CALLS",
  "OPENAI_API_KEY",
];

function snapEnv() {
  const s = {};
  for (const k of ENV_SEM) s[k] = process.env[k];
  return s;
}

function restoreEnv(s) {
  for (const k of ENV_SEM) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

describe("tokenJaccard", () => {
  it("alto para descrições parecidas", () => {
    const j = tokenJaccard("Notebook Dell 15 pol", "Notebook Dell 15\"");
    assert.ok(j > 0.4);
  });

  it("baixo para itens diferentes", () => {
    const j = tokenJaccard("Servidor rack", "Mouse USB");
    assert.ok(j < 0.3);
  });
});

describe("mergeItemKeyInQuote", () => {
  it("renomeia item_key quando não há colisão", () => {
    const q = {
      proposal_key: "a",
      items: [
        { item_key: "k_old", descricao: "x", quantidade: 1 },
        { item_key: "k_other", descricao: "y", quantidade: 2 },
      ],
    };
    const r = mergeItemKeyInQuote(q, "k_old", "k_ref");
    assert.strictEqual(r.ok, true);
    assert.strictEqual(q.items[0].item_key, "k_ref");
  });

  it("recusa quando destino já existe", () => {
    const q = {
      proposal_key: "a",
      items: [
        { item_key: "k_old", descricao: "x", quantidade: 1 },
        { item_key: "k_ref", descricao: "y", quantidade: 2 },
      ],
    };
    const r = mergeItemKeyInQuote(q, "k_old", "k_ref");
    assert.strictEqual(r.ok, false);
  });
});

describe("enrichConsolidationWithSemanticMatches", () => {
  let env;

  beforeEach(() => {
    env = snapEnv();
    __setSemanticResolverForTests(null);
    openaiClient.__setOpenAITransportForTests(null);
  });

  afterEach(() => {
    restoreEnv(env);
    __setSemanticResolverForTests(null);
    openaiClient.__setOpenAITransportForTests(null);
  });

  it("OpenAI desabilitada: não altera consolidação", async () => {
    process.env.OPENAI_ENABLE_SEMANTIC_ITEM_MATCH = "false";
    delete process.env.OPENAI_API_KEY;

    const quotes = [
      {
        proposal_key: "p1",
        proposal_label: "A (f.xlsx) [0]",
        items: [{ item_key: "a", descricao: "Item A", quantidade: 1, preco_unitario: 10, total: 10 }],
      },
      {
        proposal_key: "p2",
        proposal_label: "B (g.xlsx) [1]",
        items: [{ item_key: "b", descricao: "Item B", quantidade: 1, preco_unitario: 11, total: 11 }],
      },
    ];
    const c0 = consolidateQuotes(quotes);
    const out = await enrichConsolidationWithSemanticMatches({
      allQuotes: quotes,
      consolidated: c0,
      batchId: "B-test",
      skipOpenAI: false,
    });
    assert.strictEqual(out.stats.semantic_match_attempted_count, 0);
    assert.strictEqual(out.consolidated.rows.length, c0.rows.length);
  });

  it("sem API key: tentativas zero", async () => {
    process.env.OPENAI_ENABLE_SEMANTIC_ITEM_MATCH = "true";
    delete process.env.OPENAI_API_KEY;

    const quotes = [
      {
        proposal_key: "p1",
        proposal_label: "A",
        items: [{ item_key: "a", descricao: "Item A", quantidade: 1, preco_unitario: 10, total: 10 }],
      },
      {
        proposal_key: "p2",
        proposal_label: "B",
        items: [{ item_key: "b", descricao: "Item B", quantidade: 1, preco_unitario: 11, total: 11 }],
      },
    ];
    const c0 = consolidateQuotes(quotes);
    const out = await enrichConsolidationWithSemanticMatches({
      allQuotes: quotes,
      consolidated: c0,
      batchId: "B-x",
      skipOpenAI: false,
    });
    assert.strictEqual(out.stats.semantic_match_attempted_count, 0);
  });

  it("resposta inválida: incrementa rejeitados", async () => {
    process.env.OPENAI_ENABLE_SEMANTIC_ITEM_MATCH = "true";
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_LOW_CONFIDENCE = "0.5";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_THRESHOLD = "0.85";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_MAX_CANDIDATES = "5";

    __setSemanticResolverForTests(async () => null);

    const quotes = [
      {
        proposal_key: "p1",
        proposal_label: "A",
        items: [
          { item_key: "ref|1|un|", descricao: "Notebook Dell", quantidade: 1, preco_unitario: 10, total: 10 },
        ],
      },
      {
        proposal_key: "p2",
        proposal_label: "B",
        items: [
          {
            item_key: "x|1|un|",
            descricao: "Notebook Dell 15",
            quantidade: 1,
            preco_unitario: 11,
            total: 11,
          },
        ],
      },
    ];
    const c0 = consolidateQuotes(quotes);
    const out = await enrichConsolidationWithSemanticMatches({
      allQuotes: quotes,
      consolidated: c0,
      batchId: "B-inv",
      skipOpenAI: false,
    });
    assert.ok(out.stats.semantic_match_rejected_count >= 1 || out.stats.semantic_match_attempted_count === 0);
  });

  it("alta confiança + equivalent: aplica merge (mock)", async () => {
    process.env.OPENAI_ENABLE_SEMANTIC_ITEM_MATCH = "true";
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_LOW_CONFIDENCE = "0.5";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_THRESHOLD = "0.8";

    __setSemanticResolverForTests(async () => ({
      equivalent: true,
      confidence: 0.95,
      manual_review_required: false,
      reason: "same product",
      matched_attributes: ["desc"],
      differences: [],
      risk_flags: [],
      matched_candidate_item_key: "x|1|un|",
    }));

    const refKey = "ref|1|un|";
    const candKey = "x|1|un|";
    const quotes = [
      {
        proposal_key: "p1",
        proposal_label: "A",
        items: [{ item_key: refKey, descricao: "Notebook Dell Latitude", quantidade: 1, preco_unitario: 10, total: 10 }],
      },
      {
        proposal_key: "p2",
        proposal_label: "B",
        items: [
          {
            item_key: candKey,
            descricao: "Notebook Dell Latitude 15",
            quantidade: 1,
            preco_unitario: 11,
            total: 11,
          },
        ],
      },
    ];
    const c0 = consolidateQuotes(quotes);
    assert.ok(c0.rows.some((r) => r.by_proposal.p2?.missing));

    const out = await enrichConsolidationWithSemanticMatches({
      allQuotes: quotes,
      consolidated: c0,
      batchId: "B-ok",
      skipOpenAI: false,
    });

    assert.strictEqual(out.stats.semantic_match_applied_count >= 1, true);
    assert.ok(typeof out.stats.semantic_match_estimated_prompt_tokens_total === "number");
    assert.ok(out.stats.semantic_match_openai_calls >= 1);
    assert.ok(out.debug.semantic_match_stats);
    assert.ok(Array.isArray(out.debug.top_semantic_review_cases));
    const c1 = out.consolidated;
    const row = c1.rows.find((r) => r.item_key === refKey);
    assert.ok(row);
    assert.strictEqual(row.by_proposal.p2?.missing, false);
  });

  it("confiança intermediária: manual review, sem merge automático", async () => {
    process.env.OPENAI_ENABLE_SEMANTIC_ITEM_MATCH = "true";
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_LOW_CONFIDENCE = "0.5";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_THRESHOLD = "0.95";

    __setSemanticResolverForTests(async () => ({
      equivalent: true,
      confidence: 0.82,
      manual_review_required: true,
      reason: "close",
      matched_attributes: [],
      differences: ["wording"],
      risk_flags: ["POSSIBLE_DISTINCT_PRODUCT"],
      matched_candidate_item_key: "x|1|un|",
    }));

    const refKey = "ref|1|un|";
    const candKey = "x|1|un|";
    const quotes = [
      {
        proposal_key: "p1",
        proposal_label: "A",
        items: [{ item_key: refKey, descricao: "Cadeira ergonômica", quantidade: 2, preco_unitario: 10, total: 20 }],
      },
      {
        proposal_key: "p2",
        proposal_label: "B",
        items: [
          {
            item_key: candKey,
            descricao: "Cadeira escritório ergonômica",
            quantidade: 2,
            preco_unitario: 12,
            total: 24,
          },
        ],
      },
    ];
    const c0 = consolidateQuotes(quotes);
    const out = await enrichConsolidationWithSemanticMatches({
      allQuotes: quotes,
      consolidated: c0,
      batchId: "B-mid",
      skipOpenAI: false,
    });

    assert.strictEqual(out.stats.semantic_match_applied_count, 0);
    assert.ok(out.stats.semantic_match_manual_review_count >= 1);
    assert.ok(out.reviewHints.some((h) => h.category === "item_semantic_review"));
    assert.strictEqual(typeof out.stats.semantic_match_confidence_avg, "number");
  });

  it("erro OpenAI (resolver throw): incrementa openai_error_count", async () => {
    process.env.OPENAI_ENABLE_SEMANTIC_ITEM_MATCH = "true";
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_LOW_CONFIDENCE = "0.5";
    process.env.OPENAI_SEMANTIC_ITEM_MATCH_THRESHOLD = "0.85";

    __setSemanticResolverForTests(async () => {
      throw new Error("simulated transport failure");
    });

    const quotes = [
      {
        proposal_key: "p1",
        proposal_label: "A",
        items: [
          { item_key: "ref|1|un|", descricao: "Notebook Dell", quantidade: 1, preco_unitario: 10, total: 10 },
        ],
      },
      {
        proposal_key: "p2",
        proposal_label: "B",
        items: [
          {
            item_key: "x|1|un|",
            descricao: "Notebook Dell 15",
            quantidade: 1,
            preco_unitario: 11,
            total: 11,
          },
        ],
      },
    ];
    const c0 = consolidateQuotes(quotes);
    const out = await enrichConsolidationWithSemanticMatches({
      allQuotes: quotes,
      consolidated: c0,
      batchId: "B-err",
      skipOpenAI: false,
    });
    assert.strictEqual(out.stats.semantic_match_openai_error_count >= 1, true);
    assert.strictEqual(out.stats.semantic_match_rejected_count >= 1, true);
  });
});

describe("shouldAttemptSemanticItemMatch", () => {
  it("false quando skipOpenAI", () => {
    assert.strictEqual(
      shouldAttemptSemanticItemMatch({ skipOpenAI: true, matrix: { rows: [{}] } }),
      false
    );
  });
});
