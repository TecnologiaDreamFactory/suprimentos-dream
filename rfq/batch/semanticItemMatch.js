/**
 * Equivalência semântica opcional de itens no batch (complemento ao matching determinístico).
 * Não altera ranking/totais diretamente — apenas reconcilia item_key quando seguro, depois reconsolida.
 *
 * -------------------------------------------------------------------------------------------------
 * QUANDO A OPENAI É INVOCADA (uma chamada `resolveSemanticItemEquivalence` por cenário elegível)
 * -------------------------------------------------------------------------------------------------
 * Todas as condições abaixo precisam ser verdadeiras; caso contrário não há HTTP para o modelo:
 *
 * 1. `OPENAI_ENABLE_SEMANTIC_ITEM_MATCH=true` e `OPENAI_API_KEY` válida (via `getOpenAIConfig` /
 *    `isOpenAIConfigured`).
 * 2. O batch não passou `skipOpenAI` (ex.: modo só determinístico).
 * 3. Após a 1ª consolidação, existe pelo menos uma célula `missing` na matriz: o item de referência
 *    (linha) não aparece na proposta de um fornecedor, mas esse fornecedor tem outras linhas.
 * 4. Para essa proposta, há 1..N candidatos com similaridade textual (Jaccard de tokens na descrição)
 *    na faixa **[OPENAI_SEMANTIC_ITEM_MATCH_LOW_CONFIDENCE, 0.97]** — exclui muito baixo (já distinto)
 *    e muito alto (provável match trivial já coberto pelo fluxo determinístico / evita ruído).
 * 5. Candidatos com conflito forte de quantidade ou unidade (heurística local) são descartados antes
 *    da IA; não se envia planilha inteira — só referência + até `OPENAI_SEMANTIC_ITEM_MATCH_MAX_CANDIDATES`
 *    candidatos truncados.
 * 6. No máximo `OPENAI_SEMANTIC_ITEM_MATCH_MAX_CALLS` chamadas por lote (cap global anti-loop).
 *
 * Entre dois cenários consecutivos, reexecutamos `consolidateQuotes`; se a célula deixou de estar
 * `missing` (ex.: merge anterior), **não** chamamos a OpenAI para aquele cenário (evita chamadas
 * redundantes após reconciliação).
 *
 * Timeout da requisição: `OPENAI_SEMANTIC_ITEM_MATCH_TIMEOUT_MS` ou, se omitido, `OPENAI_TIMEOUT_MS`.
 */

/** Tamanho máximo de texto enviado por campo ao modelo (payload barato). */
const SEMANTIC_DESC_MAX = 400;
const SEMANTIC_REF_MAX = 120;

const { consolidateQuotes } = require("./consolidateQuotes");
const { getOpenAIConfig, isOpenAIConfigured } = require("../../ai/openaiConfig");
const { resolveSemanticItemEquivalence } = require("../../ai/openaiClient");
const { normalizeItemKeyDescription, pickItemReference } = require("./itemKey");
const {
  estimatePromptTokens,
  finalizeSemanticMatchStats,
  emptySemanticMatchStats,
  summarizeSemanticDetails,
  buildTopSemanticReviewCases,
} = require("./semanticTelemetry");

/** @type {null | ((o: object) => Promise<object|null>)} */
let _semanticResolverOverride = null;

function __setSemanticResolverForTests(fn) {
  _semanticResolverOverride = fn;
}

function logSemanticEvent(event, fields) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      service: "batch",
      event,
      ...fields,
    })
  );
}

/**
 * Similaridade 0..1 por interseção Jaccard de tokens.
 */
function tokenJaccard(a, b) {
  const ta = new Set(
    normalizeItemKeyDescription(a)
      .split(/[^a-z0-9]+/i)
      .filter((x) => x.length > 1)
  );
  const tb = new Set(
    normalizeItemKeyDescription(b)
      .split(/[^a-z0-9]+/i)
      .filter((x) => x.length > 1)
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) {
    if (tb.has(x)) inter++;
  }
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

function normalizeUnit(u) {
  const s = String(u || "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  if (/^(un|und|und\.|pc|pç|peca|peça)$/i.test(s)) return "un";
  if (/^(cx|caixa)$/i.test(s)) return "cx";
  if (/^(kg|kilo)$/i.test(s)) return "kg";
  return s.slice(0, 12);
}

/**
 * Conflito forte de quantidade (referência vs candidato).
 */
function hasHardQuantityConflict(refQty, candQty) {
  if (refQty == null || candQty == null) return false;
  if (refQty <= 0 || candQty <= 0) return false;
  const d = Math.abs(refQty - candQty);
  const rel = d / Math.max(refQty, candQty);
  return d > 0.02 && rel > 0.15;
}

/**
 * Conflito forte de unidade.
 */
function hasHardUnitConflict(refUnit, candUnit) {
  const a = normalizeUnit(refUnit);
  const b = normalizeUnit(candUnit);
  if (!a || !b) return false;
  return a !== b;
}

function hasCriticalRiskFlags(flags) {
  const f = (flags || []).map((x) => String(x).toUpperCase());
  return f.some((x) =>
    /UNIT_MISMATCH|QTY_MISMATCH|POSSIBLE_DISTINCT|REF_MISMATCH|CRITICAL/i.test(x)
  );
}

/**
 * @param {import('./consolidateQuotes').ConsolidatedMatrix} matrix
 * @param {import('./extractSupplierQuotes').SupplierQuote[]} quotes
 * @param {number} lowSim
 * @param {number} highSim
 * @param {number} maxCand
 */
function findReferenceUnitForRow(row, quotes) {
  for (const q of quotes) {
    const it = q.items?.find((x) => x.item_key === row.item_key);
    if (it?.unidade) return String(it.unidade);
  }
  return "";
}

function findReferenceRefForRow(row, quotes) {
  for (const q of quotes) {
    const it = q.items?.find((x) => x.item_key === row.item_key);
    if (it) {
      const r = pickItemReference(it);
      if (r) return String(r);
    }
  }
  return "";
}

function findMissingCellScenarios(matrix, quotes, lowSim, highSim, maxCand) {
  /** @type {object[]} */
  const out = [];
  const quoteByKey = new Map(quotes.map((q) => [q.proposal_key, q]));

  for (const row of matrix.rows) {
    const refUnit = findReferenceUnitForRow(row, quotes);
    const refRef = findReferenceRefForRow(row, quotes);
    for (const pk of matrix.proposal_keys) {
      const cell = row.by_proposal[pk];
      if (!cell?.missing) continue;

      const q = quoteByKey.get(pk);
      if (!q || !q.items?.length) continue;

      const refDesc = row.reference_description || row.item_key;
      const refQty = row.reference_quantity;

      const candidates = [];
      for (const it of q.items) {
        if (it.item_key === row.item_key) continue;
        const sim = tokenJaccard(refDesc, it.descricao || "");
        if (sim < lowSim || sim > highSim) continue;
        if (hasHardQuantityConflict(refQty, it.quantidade)) continue;
        if (hasHardUnitConflict(refUnit, it.unidade)) continue;
        candidates.push({
          item_key: it.item_key,
          descricao: it.descricao,
          quantidade: it.quantidade,
          unidade: it.unidade,
          referencia: pickItemReference(it),
          similarity: Math.round(sim * 1000) / 1000,
        });
      }

      candidates.sort((a, b) => b.similarity - a.similarity);
      const top = candidates.slice(0, maxCand);
      if (top.length === 0) continue;

      out.push({
        kind: "missing_cell",
        reference_item_key: row.item_key,
        reference_description: refDesc,
        reference_quantity: refQty,
        reference_unidade: refUnit,
        reference_referencia: refRef,
        missing_proposal_key: pk,
        missing_proposal_label: matrix.proposal_labels[pk] || pk,
        candidates: top,
      });
    }
  }

  return out;
}

/**
 * Renomeia item_key dentro de uma proposta (merge semântico).
 */
function mergeItemKeyInQuote(quote, sourceKey, targetKey) {
  const hasTarget = quote.items.some((i) => i.item_key === targetKey);
  const sourceItems = quote.items.filter((i) => i.item_key === sourceKey);
  if (sourceItems.length === 0) return { ok: false, code: "NO_SOURCE" };
  if (hasTarget) return { ok: false, code: "TARGET_EXISTS" };
  for (const it of quote.items) {
    if (it.item_key === sourceKey) it.item_key = targetKey;
  }
  return { ok: true };
}

function buildSemanticPayload(scenario, batchId) {
  const ref = {
    item_key: scenario.reference_item_key,
    descricao: String(scenario.reference_description || "").slice(0, SEMANTIC_DESC_MAX),
    quantidade: scenario.reference_quantity,
    unidade: String(scenario.reference_unidade || "").slice(0, 32),
    referencia: String(scenario.reference_referencia || "").slice(0, SEMANTIC_REF_MAX),
  };
  return {
    batch_id: String(batchId || "").slice(0, 64),
    scenario: scenario.kind,
    reference: ref,
    candidates: scenario.candidates.map((c) => ({
      item_key: c.item_key,
      descricao: String(c.descricao || "").slice(0, SEMANTIC_DESC_MAX),
      quantidade: c.quantidade,
      unidade: String(c.unidade || "").slice(0, 32),
      referencia: String(c.referencia || "").slice(0, SEMANTIC_REF_MAX),
      text_similarity: c.similarity,
    })),
  };
}

/**
 * Pré-checagem barata (sem HTTP): só indica se o passo semântico pode rodar.
 * Cenários concretos (células missing + candidatos) vêm de `findMissingCellScenarios` — ver cabeçalho do arquivo.
 */
function shouldAttemptSemanticItemMatch(opts) {
  const { skipOpenAI, matrix } = opts;
  if (skipOpenAI) return false;
  const cfg = getOpenAIConfig();
  if (!cfg.enableSemanticItemMatch) return false;
  if (!isOpenAIConfigured()) return false;
  if (!matrix?.rows?.length) return false;
  return true;
}

/**
 * @param {object} ctx
 * @returns {Promise<{
 *   quotes: import('./extractSupplierQuotes').SupplierQuote[],
 *   consolidated: import('./consolidateQuotes').ConsolidatedMatrix,
 *   stats: object,
 *   details: object[],
 *   debug: object,
 *   reviewHints: object[],
 *   semantic_match_notes: Record<string, string>,
 *   semantic_ms: number
 * }>}
 */
async function enrichConsolidationWithSemanticMatches(ctx) {
  const t0 = Date.now();
  const {
    allQuotes,
    consolidated: matrixIn,
    batchId,
    skipOpenAI,
    correlationId,
  } = ctx;

  const empty = {
    quotes: allQuotes,
    consolidated: matrixIn,
    stats: emptySemanticMatchStats(),
    details: [],
    debug: {
      semantic_match_details: [],
      semantic_match_details_summary: [],
      semantic_match_stats: emptySemanticMatchStats(),
      top_semantic_review_cases: [],
      candidates_considered: [],
      chosen_match: [],
    },
    reviewHints: [],
    semantic_match_notes: {},
    semantic_ms: 0,
  };

  if (!shouldAttemptSemanticItemMatch({ skipOpenAI, matrix: matrixIn })) {
    empty.semantic_ms = Date.now() - t0;
    return empty;
  }

  const cfg = getOpenAIConfig();
  const low = cfg.semanticItemMatchLowConfidence;
  const thr = cfg.semanticItemMatchThreshold;
  const maxCand = cfg.semanticItemMatchMaxCandidates;
  const maxCalls = cfg.semanticItemMatchMaxCalls;

  const scenarios = findMissingCellScenarios(matrixIn, allQuotes, low, 0.97, maxCand).slice(
    0,
    maxCalls
  );

  if (scenarios.length === 0) {
    const quick = {
      ...empty,
      consolidated: matrixIn,
      semantic_ms: Date.now() - t0,
    };
    quick.debug.semantic_match_stats = { ...emptySemanticMatchStats() };
    return quick;
  }

  const quotes = allQuotes;
  const stats = {
    semantic_match_attempted_count: 0,
    semantic_match_applied_count: 0,
    semantic_match_manual_review_count: 0,
    semantic_match_rejected_count: 0,
    semantic_match_skipped_count: 0,
    semantic_match_openai_error_count: 0,
    semantic_match_openai_calls: 0,
  };
  /** @type {number[]} */
  const confidencesForAgg = [];
  /** @type {number[]} */
  const promptTokenEstimates = [];
  /** @type {object[]} */
  const details = [];
  /** @type {object[]} */
  const candidatesLog = [];
  /** @type {object[]} */
  const chosenLog = [];
  /** @type {object[]} */
  const reviewHints = [];
  /** @type {Record<string, string>} */
  const semantic_match_notes = {};

  const resolver = _semanticResolverOverride || resolveSemanticItemEquivalence;

  for (const scenario of scenarios) {
    if (scenario.candidates.length === 0) continue;

    const consolidatedLive = consolidateQuotes(quotes);
    const rowNow = consolidatedLive.rows.find((r) => r.item_key === scenario.reference_item_key);
    const stillMissing =
      rowNow && rowNow.by_proposal[scenario.missing_proposal_key]?.missing === true;
    if (!stillMissing) {
      stats.semantic_match_skipped_count += 1;
      logSemanticEvent("semantic_item_match_skipped", {
        batch_id: batchId,
        request_id: correlationId,
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        reason: "cell_no_longer_missing",
      });
      continue;
    }

    stats.semantic_match_attempted_count += 1;
    stats.semantic_match_openai_calls += 1;
    const payload = buildSemanticPayload(scenario, batchId);
    const estPromptTok = estimatePromptTokens(payload) + 48;
    promptTokenEstimates.push(estPromptTok);

    candidatesLog.push({
      reference_item_key: scenario.reference_item_key,
      missing_proposal: scenario.missing_proposal_key,
      candidates: scenario.candidates.map((c) => c.item_key),
      estimated_prompt_tokens: estPromptTok,
    });

    logSemanticEvent("semantic_item_match_attempt", {
      batch_id: batchId,
      request_id: correlationId,
      reference_item_key: scenario.reference_item_key,
      missing_proposal: scenario.missing_proposal_key,
      candidate_count: scenario.candidates.length,
      estimated_prompt_tokens: estPromptTok,
    });

    let ai = null;
    let openaiThrew = false;
    try {
      ai = await resolver(payload);
    } catch (e) {
      openaiThrew = true;
      ai = null;
      stats.semantic_match_openai_error_count += 1;
      logSemanticEvent("semantic_item_match_error", {
        batch_id: batchId,
        request_id: correlationId,
        reference_item_key: scenario.reference_item_key,
        message: e && e.message ? String(e.message).slice(0, 200) : "resolver_throw",
      });
    }

    if (!ai) {
      stats.semantic_match_rejected_count += 1;
      const reasonCode = openaiThrew ? "openai_transport_error" : "openai_null_or_invalid";
      logSemanticEvent("semantic_item_match_rejected", {
        batch_id: batchId,
        request_id: correlationId,
        reason: reasonCode,
        reference_item_key: scenario.reference_item_key,
      });
      logSemanticEvent("semantic_item_match_result", {
        batch_id: batchId,
        request_id: correlationId,
        outcome: openaiThrew ? "error" : "rejected",
        reason_code: reasonCode,
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        confidence: null,
        estimated_prompt_tokens: estPromptTok,
      });
      details.push({
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        outcome: "rejected",
        reason: reasonCode,
      });
      continue;
    }

    const conf = typeof ai.confidence === "number" ? ai.confidence : 0;
    confidencesForAgg.push(conf);

    const keyPick =
      typeof ai.matched_candidate_item_key === "string" && ai.matched_candidate_item_key.trim()
        ? ai.matched_candidate_item_key.trim()
        : scenario.candidates[0].item_key;
    const chosen =
      scenario.candidates.find((c) => c.item_key === keyPick) || scenario.candidates[0];

    const hardQty = scenario.reference_quantity
      ? hasHardQuantityConflict(scenario.reference_quantity, chosen.quantidade)
      : false;
    const hardUnit = hasHardUnitConflict(
      scenario.reference_unidade || "",
      chosen.unidade
    );
    const critical = hasCriticalRiskFlags(ai.risk_flags) || hardQty || hardUnit;

    if (conf < low) {
      stats.semantic_match_rejected_count += 1;
      logSemanticEvent("semantic_item_match_rejected", {
        batch_id: batchId,
        request_id: correlationId,
        reference_item_key: scenario.reference_item_key,
        confidence: conf,
      });
      logSemanticEvent("semantic_item_match_result", {
        batch_id: batchId,
        request_id: correlationId,
        outcome: "rejected",
        reason_code: "confidence_below_low",
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        candidate_item_key: chosen.item_key,
        confidence: conf,
        estimated_prompt_tokens: estPromptTok,
      });
      details.push({
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        outcome: "rejected",
        reason: "confidence_below_low",
        confidence: conf,
      });
      continue;
    }

    if (!ai.equivalent) {
      stats.semantic_match_rejected_count += 1;
      logSemanticEvent("semantic_item_match_rejected", {
        batch_id: batchId,
        request_id: correlationId,
        reference_item_key: scenario.reference_item_key,
        equivalent: false,
      });
      logSemanticEvent("semantic_item_match_result", {
        batch_id: batchId,
        request_id: correlationId,
        outcome: "rejected",
        reason_code: "not_equivalent",
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        candidate_item_key: chosen.item_key,
        confidence: conf,
        estimated_prompt_tokens: estPromptTok,
      });
      details.push({
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        outcome: "rejected",
        reason: "not_equivalent",
        confidence: conf,
      });
      continue;
    }

    const nk = `${scenario.reference_item_key}::${scenario.missing_proposal_key}`;
    const canAuto =
      conf >= thr && !critical && !ai.manual_review_required && ai.equivalent === true;

    if (canAuto) {
      const q = quotes.find((x) => x.proposal_key === scenario.missing_proposal_key);
      if (!q) {
        stats.semantic_match_rejected_count += 1;
        logSemanticEvent("semantic_item_match_result", {
          batch_id: batchId,
          request_id: correlationId,
          outcome: "rejected",
          reason_code: "quote_not_found",
          reference_item_key: scenario.reference_item_key,
          confidence: conf,
          estimated_prompt_tokens: estPromptTok,
        });
        details.push({
          reference_item_key: scenario.reference_item_key,
          missing_proposal: scenario.missing_proposal_key,
          outcome: "rejected",
          reason: "quote_not_found",
          confidence: conf,
        });
        continue;
      }
      const merge = mergeItemKeyInQuote(q, chosen.item_key, scenario.reference_item_key);
      if (!merge.ok) {
        stats.semantic_match_rejected_count += 1;
        logSemanticEvent("semantic_item_match_rejected", {
          batch_id: batchId,
          merge_code: merge.code,
          reference_item_key: scenario.reference_item_key,
        });
        logSemanticEvent("semantic_item_match_result", {
          batch_id: batchId,
          request_id: correlationId,
          outcome: "rejected",
          reason_code: merge.code || "merge_failed",
          reference_item_key: scenario.reference_item_key,
          candidate_item_key: chosen.item_key,
          confidence: conf,
          estimated_prompt_tokens: estPromptTok,
        });
        details.push({
          reference_item_key: scenario.reference_item_key,
          missing_proposal: scenario.missing_proposal_key,
          outcome: "rejected",
          reason: merge.code,
          confidence: conf,
        });
        continue;
      }
      stats.semantic_match_applied_count += 1;
      semantic_match_notes[nk] = "equivalência semântica aplicada";
      logSemanticEvent("semantic_item_match_applied", {
        batch_id: batchId,
        request_id: correlationId,
        reference_item_key: scenario.reference_item_key,
        merged_from: chosen.item_key,
        confidence: conf,
      });
      logSemanticEvent("semantic_item_match_result", {
        batch_id: batchId,
        request_id: correlationId,
        outcome: "applied",
        reason_code: "merged",
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        candidate_item_key: chosen.item_key,
        confidence: conf,
        estimated_prompt_tokens: estPromptTok,
      });
      chosenLog.push({
        reference_item_key: scenario.reference_item_key,
        merged_from: chosen.item_key,
        mode: "applied",
        confidence: conf,
      });
      details.push({
        reference_item_key: scenario.reference_item_key,
        missing_proposal: scenario.missing_proposal_key,
        outcome: "applied",
        merged_from: chosen.item_key,
        confidence: conf,
        ai,
      });
      reviewHints.push({
        category: "item_semantic_match",
        severity: "info",
        summary: `Equivalência semântica aplicada: "${chosen.item_key}" → "${scenario.reference_item_key}" (${scenario.missing_proposal_label}).`,
        detail: ai.reason || "",
        reference_item_key: scenario.reference_item_key,
        candidate_item_key: chosen.item_key,
        confidence: conf,
      });
      continue;
    }

    stats.semantic_match_manual_review_count += 1;
    reviewHints.push({
      category: "item_semantic_review",
      severity: "warning",
      summary: `Possível equivalência semântica entre "${scenario.reference_item_key}" e "${chosen.item_key}" (${scenario.missing_proposal_label}) — revisão humana.`,
      detail: ai.reason || "",
      reference_item_key: scenario.reference_item_key,
      candidate_item_key: chosen.item_key,
      confidence: conf,
    });
    semantic_match_notes[nk] = "equivalência semântica sugerida, revisão necessária";
    logSemanticEvent("semantic_item_match_manual_review", {
      batch_id: batchId,
      request_id: correlationId,
      reference_item_key: scenario.reference_item_key,
      candidate_item_key: chosen.item_key,
      confidence: conf,
    });
    logSemanticEvent("semantic_item_match_result", {
      batch_id: batchId,
      request_id: correlationId,
      outcome: "manual_review",
      reason_code: "intermediate_confidence_or_flags",
      reference_item_key: scenario.reference_item_key,
      missing_proposal: scenario.missing_proposal_key,
      candidate_item_key: chosen.item_key,
      confidence: conf,
      critical,
      estimated_prompt_tokens: estPromptTok,
    });
    chosenLog.push({
      reference_item_key: scenario.reference_item_key,
      chosen: chosen.item_key,
      mode: "manual_review",
      confidence: conf,
    });
    details.push({
      reference_item_key: scenario.reference_item_key,
      missing_proposal: scenario.missing_proposal_key,
      outcome: "manual_review",
      confidence: conf,
      ai,
    });
  }

  const consolidatedFinal = consolidateQuotes(quotes);
  const statsFinal = finalizeSemanticMatchStats(stats, confidencesForAgg, promptTokenEstimates);
  const topCases = buildTopSemanticReviewCases(reviewHints, 8);
  const detailsSummary = summarizeSemanticDetails(details, 28);

  return {
    quotes: allQuotes,
    consolidated: consolidatedFinal,
    stats: statsFinal,
    details,
    debug: {
      semantic_match_stats: statsFinal,
      semantic_match_details: details,
      semantic_match_details_summary: detailsSummary,
      top_semantic_review_cases: topCases,
      candidates_considered: candidatesLog,
      chosen_match: chosenLog,
    },
    reviewHints,
    semantic_match_notes,
    semantic_ms: Date.now() - t0,
  };
}

module.exports = {
  shouldAttemptSemanticItemMatch,
  enrichConsolidationWithSemanticMatches,
  tokenJaccard,
  findMissingCellScenarios,
  mergeItemKeyInQuote,
  __setSemanticResolverForTests,
};
