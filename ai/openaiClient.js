/**
 * Cliente OpenAI opcional: ambiguidade estrutural + resumo analítico.
 * Usa Responses API (SDK oficial). Sem OPENAI_API_KEY, retorna null; falhas não quebram o pipeline.
 */

const OpenAI = require("openai");
const { getOpenAIConfig, isOpenAIConfigured } = require("./openaiConfig");
const {
  validateAmbiguityResponse,
  validateAnalyticSummaryResponse,
  validateSemanticEquivalenceResponse,
} = require("./openaiSchemas");

/** @type {null | ((opts: object) => Promise<object>)} */
let _transport = null;

/**
 * Apenas testes: simula resposta da API.
 * @param {null | ((opts: object) => Promise<object>)} fn
 */
function __setOpenAITransportForTests(fn) {
  _transport = fn;
}

/**
 * Log mínimo sem conteúdo de células.
 */
function logOpenAI(phase, info) {
  console.log(
    `[OpenAI] ${phase} model=${info.model || "?"} duration_ms=${info.duration_ms ?? "?"} ok=${info.ok}`
  );
}

/**
 * @param {object} params
 * @param {string} params.system
 * @param {string} params.user
 * @param {number} params.timeoutMs
 * @param {string} [params.model]
 * @returns {Promise<{ content: string }>}
 */
async function responsesJson(params) {
  const cfg = getOpenAIConfig();
  const { system, user, timeoutMs, model } = params;
  const apiKey = cfg.apiKey;

  if (_transport) {
    const out = await _transport({
      body: {
        model: model || cfg.model,
        instructions: system,
        input: user,
        temperature: cfg.temperature,
        text: { format: { type: "json_object" } },
      },
      timeoutMs,
      apiKey,
    });
    if (!out || typeof out.content !== "string") {
      throw new Error("OpenAI transport returned invalid shape");
    }
    return out;
  }

  const client = new OpenAI({
    apiKey,
    timeout: timeoutMs,
    maxRetries: cfg.maxRetries,
  });

  const response = await client.responses.create({
    model: model || cfg.model,
    instructions: system,
    input: user,
    temperature: cfg.temperature,
    text: {
      format: { type: "json_object" },
    },
  });

  if (response.error) {
    const err = new Error(response.error.message || "OpenAI response error");
    err.code = response.error.code;
    throw err;
  }

  const text = response.output_text;
  if (!text || typeof text !== "string") {
    throw new Error("OpenAI empty output_text");
  }

  return { content: text };
}

const SYSTEM_AMBIGUITY = `You are a spreadsheet structure assistant for RFQ/quotation Excel files.
You MUST respond with a single JSON object only, no markdown.
You must NOT invent numeric values or totals. You only suggest structural interpretation (which columns might be supplier blocks, which rows might be freight/total/payment).
If uncertain, set resolved to false and lower confidence.
Fields: resolved (boolean), confidence (0-1), suggested_mapping: { supplier_blocks: array of { label, start_col_hint, notes } }, special_rows: { freight?: number[], total?: number[], installments?: number[], payment?: number[] } (0-based row indices in the SNIPPET matrix), notes: string[], warnings: string[], rationale: string.`;

const SYSTEM_SUMMARY = `You are an analyst for procurement quotation comparison results.
You MUST respond with a single JSON object only, no markdown.
You must NOT recalculate totals or change rankings — only summarize and explain the deterministic data provided.
Fields: winner_summary (string), ranking_summary (array of short strings), key_alerts (array of strings), manual_review_required (boolean), concise_reasoning (string), confidence (0-1).`;

/**
 * @param {object} payload — ver buildAmbiguityPayload
 * @returns {Promise<object|null>}
 */
async function resolveAmbiguousMapping(payload) {
  if (!isOpenAIConfigured()) return null;
  const cfg = getOpenAIConfig();
  if (!cfg.enableAmbiguity) return null;

  const t0 = Date.now();
  try {
    const user = JSON.stringify({
      instruction:
        "Analyze ambiguity only. Do not output monetary recalculations. JSON per schema.",
      payload,
    });

    const raw = await responsesJson({
      system: SYSTEM_AMBIGUITY,
      user,
      timeoutMs: cfg.timeoutMs,
      model: cfg.model,
    });

    const parsed = JSON.parse(raw.content);
    const v = validateAmbiguityResponse(parsed);
    if (!v.ok) {
      logOpenAI("ambiguity_invalid_json", {
        model: cfg.model,
        duration_ms: Date.now() - t0,
        ok: false,
      });
      return null;
    }
    logOpenAI("ambiguity", { model: cfg.model, duration_ms: Date.now() - t0, ok: true });
    return v.value;
  } catch (e) {
    logOpenAI("ambiguity_error", {
      model: cfg.model,
      duration_ms: Date.now() - t0,
      ok: false,
    });
    return null;
  }
}

/**
 * @param {object} payload — ver buildAnalyticSummaryPayload
 * @returns {Promise<object|null>}
 */
async function generateAnalyticSummary(payload) {
  if (!isOpenAIConfigured()) return null;
  const cfg = getOpenAIConfig();
  if (!cfg.enableSummary) return null;

  const t0 = Date.now();
  try {
    const user = JSON.stringify({
      instruction:
        "Summarize the deterministic comparison. Do not change numbers. JSON per schema.",
      payload,
    });

    const raw = await responsesJson({
      system: SYSTEM_SUMMARY,
      user,
      timeoutMs: cfg.timeoutMs,
      model: cfg.model,
    });

    const parsed = JSON.parse(raw.content);
    const v = validateAnalyticSummaryResponse(parsed);
    if (!v.ok) {
      logOpenAI("summary_invalid_json", {
        model: cfg.model,
        duration_ms: Date.now() - t0,
        ok: false,
      });
      return null;
    }
    logOpenAI("summary", { model: cfg.model, duration_ms: Date.now() - t0, ok: true });
    return v.value;
  } catch (e) {
    logOpenAI("summary_error", {
      model: cfg.model,
      duration_ms: Date.now() - t0,
      ok: false,
    });
    return null;
  }
}

/**
 * Decide se tenta ambiguidade (heurística local + flags).
 */
function shouldAttemptAmbiguityResolution(parsingConfidence, parsingAlerts, validationWarnings) {
  const cfg = getOpenAIConfig();
  if (!cfg.enableAmbiguity || !isOpenAIConfigured()) return false;

  const alerts = [
    ...(parsingAlerts || []),
    ...(validationWarnings || []).map((w) =>
      typeof w === "string" ? w : w.message || w.code || ""
    ),
  ].map((a) => String(a));

  const relevant = alerts.some((a) =>
    /inconsistente|revis[aã]o|manual|declarado|mismatch|inv[aá]lid|ausente|amb[ií]gu|aten[cç][aã]o/i.test(
      a
    )
  );

  if (parsingConfidence < cfg.parsingConfidenceThreshold) {
    return true;
  }
  return relevant;
}

/**
 * Lista de “dúvidas” textuais para o payload.
 */
function buildDoubts(parsingConfidence, threshold, alerts) {
  const doubts = [];
  if (parsingConfidence < threshold) {
    doubts.push(`parsing_confidence (${parsingConfidence.toFixed(2)}) below threshold (${threshold})`);
  }
  if ((alerts || []).length) {
    doubts.push(`parser_alerts_count: ${alerts.length}`);
  }
  return doubts;
}

const SYSTEM_SEMANTIC_ITEM = `You are a procurement assistant comparing RFQ line items across suppliers.
You MUST respond with a single JSON object only, no markdown.
You must NOT recalculate prices or totals. Do not invent codes.
Given one reference item and a small list of candidate lines from the same supplier, decide if ANY candidate describes the SAME product/service as the reference for comparison purposes.
If multiple candidates exist, set matched_candidate_item_key to the item_key of the best match when equivalent is true; otherwise null.
If uncertain, set equivalent to false, confidence low, manual_review_required true, and risk_flags including POSSIBLE_DISTINCT_PRODUCT.
Use risk_flags: UNIT_MISMATCH, QTY_MISMATCH, POSSIBLE_DISTINCT_PRODUCT, REF_MISMATCH, or [] when none.
Fields: equivalent (boolean), confidence (0-1), manual_review_required (boolean), reason (string), matched_attributes (array of strings), differences (array of strings), risk_flags (array of strings), matched_candidate_item_key (string or null).`;

/**
 * Equivalência semântica de itens (batch) via Responses API (`json_object`) + validação em `openaiSchemas`.
 * Fallback: retorna `null` (timeout, rede, JSON inválido, schema inválido, feature off ou sem chave).
 *
 * Invocação só ocorre quando o batch chama `enrichConsolidationWithSemanticMatches` com cenários
 * pré-filtrados (ver `semanticItemMatch.js` — célula ausente + faixa de similaridade + limites).
 *
 * @param {object} payload — payload enxuto (referência + poucos candidatos)
 * @returns {Promise<object|null>}
 */
async function resolveSemanticItemEquivalence(payload) {
  if (!isOpenAIConfigured()) return null;
  const cfg = getOpenAIConfig();
  if (!cfg.enableSemanticItemMatch) return null;

  const t0 = Date.now();
  try {
    const user = JSON.stringify({
      instruction:
        "Compare reference vs candidate items for semantic equivalence only. JSON per schema.",
      payload,
    });

    const raw = await responsesJson({
      system: SYSTEM_SEMANTIC_ITEM,
      user,
      timeoutMs: cfg.semanticItemMatchTimeoutMs,
      model: cfg.model,
    });

    const parsed = JSON.parse(raw.content);
    const v = validateSemanticEquivalenceResponse(parsed);
    if (!v.ok) {
      logOpenAI("semantic_item_invalid_json", {
        model: cfg.model,
        duration_ms: Date.now() - t0,
        ok: false,
      });
      return null;
    }
    logOpenAI("semantic_item", { model: cfg.model, duration_ms: Date.now() - t0, ok: true });
    return v.value;
  } catch (e) {
    logOpenAI("semantic_item_error", {
      model: cfg.model,
      duration_ms: Date.now() - t0,
      ok: false,
    });
    return null;
  }
}

module.exports = {
  isOpenAIConfigured,
  responsesJson,
  resolveAmbiguousMapping,
  generateAnalyticSummary,
  resolveSemanticItemEquivalence,
  shouldAttemptAmbiguityResolution,
  buildDoubts,
  __setOpenAITransportForTests,
  validateAmbiguityResponse,
  validateAnalyticSummaryResponse,
  validateSemanticEquivalenceResponse,
};
