/**
 * OpenAI opcional: cliente, heurísticas e integração mínima com o pipeline.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const XLSX = require("xlsx");

const openaiClient = require("../ai/openaiClient");
const { parseWithPipeline } = require("../rfq/pipeline");

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_ENABLE_AMBIGUITY_RESOLUTION",
  "OPENAI_ENABLE_ANALYTIC_SUMMARY",
  "OPENAI_PARSING_CONFIDENCE_THRESHOLD",
  "OPENAI_TIMEOUT_MS",
  "OPENAI_MAX_RETRIES",
  "OPENAI_TEMPERATURE",
];

function snapshotEnv() {
  const s = {};
  for (const k of ENV_KEYS) {
    s[k] = process.env[k];
  }
  return s;
}

function restoreEnv(snapshot) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

function validAmbiguityJson() {
  return {
    resolved: true,
    confidence: 0.82,
    suggested_mapping: {
      supplier_blocks: [{ label: "A", start_col_hint: 1, notes: "test" }],
      special_rows: { freight: [], total: [], installments: [], payment: [] },
      notes: [],
    },
    warnings: [],
    rationale: "unit test",
  };
}

function validSummaryJson() {
  return {
    winner_summary: "Fornecedor A",
    ranking_summary: ["A", "B"],
    key_alerts: [],
    manual_review_required: false,
    concise_reasoning: "Menor total.",
    confidence: 0.91,
  };
}

function minimalXlsxBuffer() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Produto", "Qtd", "UN", "Preço Unit", "Total"],
    ["Item teste", 2, "UN", "10,00", "20,00"],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "ITENS_COTACAO");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("openaiClient", () => {
  let envSnap;

  beforeEach(() => {
    envSnap = snapshotEnv();
    openaiClient.__setOpenAITransportForTests(null);
  });

  afterEach(() => {
    restoreEnv(envSnap);
    openaiClient.__setOpenAITransportForTests(null);
  });

  it("resolveAmbiguousMapping retorna null sem OPENAI_API_KEY", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "true";
    const out = await openaiClient.resolveAmbiguousMapping({ template_type: "x" });
    assert.strictEqual(out, null);
  });

  it("parser confiante: shouldAttemptAmbiguityResolution é false", () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "true";
    process.env.OPENAI_PARSING_CONFIDENCE_THRESHOLD = "0.75";
    const r = openaiClient.shouldAttemptAmbiguityResolution(0.95, [], []);
    assert.strictEqual(r, false);
  });

  it("baixa confiança: shouldAttemptAmbiguityResolution é true com chave e flag", () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "true";
    process.env.OPENAI_PARSING_CONFIDENCE_THRESHOLD = "0.75";
    const r = openaiClient.shouldAttemptAmbiguityResolution(0.5, [], []);
    assert.strictEqual(r, true);
  });

  it("falha HTTP/transport: resolveAmbiguousMapping retorna null", async () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "true";
    openaiClient.__setOpenAITransportForTests(async () => {
      throw new Error("network");
    });
    const out = await openaiClient.resolveAmbiguousMapping({ a: 1 });
    assert.strictEqual(out, null);
  });

  it("JSON inválido da API: resolveAmbiguousMapping retorna null", async () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "true";
    openaiClient.__setOpenAITransportForTests(async () => ({
      content: "{ not-json",
    }));
    const out = await openaiClient.resolveAmbiguousMapping({ a: 1 });
    assert.strictEqual(out, null);
  });

  it("JSON estruturalmente inválido (schema): resolveAmbiguousMapping retorna null", async () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "true";
    openaiClient.__setOpenAITransportForTests(async () => ({
      content: JSON.stringify({ resolved: "não booleano", confidence: 2 }),
    }));
    const out = await openaiClient.resolveAmbiguousMapping({ a: 1 });
    assert.strictEqual(out, null);
  });

  it("ambiguidade com JSON válido: retorna objeto validado", async () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "true";
    const amb = validAmbiguityJson();
    openaiClient.__setOpenAITransportForTests(async () => ({
      content: JSON.stringify(amb),
    }));
    const out = await openaiClient.resolveAmbiguousMapping({ template_type: "grouped_suppliers" });
    assert.ok(out);
    assert.strictEqual(out.resolved, true);
    assert.strictEqual(out.confidence, 0.82);
  });

  it("generateAnalyticSummary com JSON válido", async () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_ANALYTIC_SUMMARY = "true";
    const sum = validSummaryJson();
    openaiClient.__setOpenAITransportForTests(async () => ({
      content: JSON.stringify(sum),
    }));
    const out = await openaiClient.generateAnalyticSummary({
      canonical_quotation: {},
      validation_result: { ok: true },
      comparison_result: {},
    });
    assert.ok(out);
    assert.strictEqual(out.winner_summary, "Fornecedor A");
  });
});

describe("parseWithPipeline + OpenAI (mock transport)", () => {
  let envSnap;

  beforeEach(() => {
    envSnap = snapshotEnv();
    openaiClient.__setOpenAITransportForTests(null);
  });

  afterEach(() => {
    restoreEnv(envSnap);
    openaiClient.__setOpenAITransportForTests(null);
  });

  it("analysis_source openai quando só o resumo analítico é gerado", async () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "false";
    process.env.OPENAI_ENABLE_ANALYTIC_SUMMARY = "true";

    openaiClient.__setOpenAITransportForTests(async () => ({
      content: JSON.stringify(validSummaryJson()),
    }));

    const buf = minimalXlsxBuffer();
    const out = await parseWithPipeline(buf, "RFQ-OAI", "src", { skipOpenAI: false });

    assert.strictEqual(out.status, "success");
    assert.strictEqual(out.analysis_source, "openai");
    assert.ok(out.analytic_summary);
    assert.strictEqual(out.analytic_summary.winner_summary, "Fornecedor A");
    assert.ok(typeof out.openai_confidence === "number");
  });

  it("analysis_source hybrid quando ambiguidade e resumo são bem-sucedidos", async () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "true";
    process.env.OPENAI_ENABLE_ANALYTIC_SUMMARY = "true";
    /** Força parsing_confidence < threshold para disparar ambiguidade */
    process.env.OPENAI_PARSING_CONFIDENCE_THRESHOLD = "1.01";

    let n = 0;
    openaiClient.__setOpenAITransportForTests(async () => {
      n += 1;
      if (n === 1) {
        return { content: JSON.stringify(validAmbiguityJson()) };
      }
      return { content: JSON.stringify(validSummaryJson()) };
    });

    const buf = minimalXlsxBuffer();
    const out = await parseWithPipeline(buf, "RFQ-HYB", "src", { skipOpenAI: false });

    assert.strictEqual(out.status, "success");
    assert.strictEqual(out.analysis_source, "hybrid");
    assert.ok(out.openai_ambiguity_advisory);
    assert.ok(out.analytic_summary);
    assert.strictEqual(n, 2);
  });

  it("falha no resumo: permanece determinístico e inclui warning técnico", async () => {
    process.env.OPENAI_API_KEY = "MOCK_OPENAI_KEY_UNIT_TESTS_ONLY";
    process.env.OPENAI_ENABLE_AMBIGUITY_RESOLUTION = "false";
    process.env.OPENAI_ENABLE_ANALYTIC_SUMMARY = "true";

    openaiClient.__setOpenAITransportForTests(async () => {
      throw new Error("timeout");
    });

    const buf = minimalXlsxBuffer();
    const out = await parseWithPipeline(buf, "RFQ-FAIL", "src", { skipOpenAI: false });

    assert.strictEqual(out.status, "success");
    assert.strictEqual(out.analysis_source, "deterministic");
    assert.strictEqual(out.analytic_summary, null);
    assert.ok(
      (out.warnings || []).some((w) => String(w).includes("openai_analytic_summary")),
      "deve registrar falha do resumo sem quebrar o pipeline"
    );
  });
});
