/**
 * Validação estrutural mínima das respostas JSON da OpenAI.
 */

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * @param {unknown} data
 * @returns {{ ok: boolean, value?: object }}
 */
function validateAmbiguityResponse(data) {
  if (!isPlainObject(data)) return { ok: false };
  if (typeof data.resolved !== "boolean") return { ok: false };
  if (typeof data.confidence !== "number" || data.confidence < 0 || data.confidence > 1) {
    return { ok: false };
  }
  if (!isPlainObject(data.suggested_mapping)) return { ok: false };
  if (!Array.isArray(data.suggested_mapping.supplier_blocks)) return { ok: false };
  if (!isPlainObject(data.suggested_mapping.special_rows)) return { ok: false };
  if (!Array.isArray(data.suggested_mapping.notes)) return { ok: false };
  if (!Array.isArray(data.warnings)) return { ok: false };
  if (typeof data.rationale !== "string") return { ok: false };
  return { ok: true, value: data };
}

/**
 * @param {unknown} data
 * @returns {{ ok: boolean, value?: object }}
 */
function validateAnalyticSummaryResponse(data) {
  if (!isPlainObject(data)) return { ok: false };
  if (typeof data.winner_summary !== "string") return { ok: false };
  if (!Array.isArray(data.ranking_summary)) return { ok: false };
  if (!Array.isArray(data.key_alerts)) return { ok: false };
  if (typeof data.manual_review_required !== "boolean") return { ok: false };
  if (typeof data.concise_reasoning !== "string") return { ok: false };
  if (typeof data.confidence !== "number" || data.confidence < 0 || data.confidence > 1) {
    return { ok: false };
  }
  return { ok: true, value: data };
}

/**
 * Equivalência semântica de itens (batch).
 * @param {unknown} data
 * @returns {{ ok: boolean, value?: object }}
 */
function validateSemanticEquivalenceResponse(data) {
  if (!isPlainObject(data)) return { ok: false };
  if (typeof data.equivalent !== "boolean") return { ok: false };
  if (typeof data.confidence !== "number" || data.confidence < 0 || data.confidence > 1) {
    return { ok: false };
  }
  if (typeof data.manual_review_required !== "boolean") return { ok: false };
  if (typeof data.reason !== "string") return { ok: false };
  if (!Array.isArray(data.matched_attributes)) return { ok: false };
  if (!Array.isArray(data.differences)) return { ok: false };
  if (!Array.isArray(data.risk_flags)) return { ok: false };
  if (data.matched_candidate_item_key != null && typeof data.matched_candidate_item_key !== "string") {
    return { ok: false };
  }
  return { ok: true, value: data };
}

/**
 * Resposta da extração de documento (PDF/DOCX/TXT).
 * @param {unknown} data
 * @returns {{ ok: boolean, value?: object }}
 */
function validateDocumentExtractionResponse(data) {
  if (!isPlainObject(data)) return { ok: false };
  if (typeof data.confidence !== "number" || data.confidence < 0 || data.confidence > 1) {
    return { ok: false };
  }
  if (!Array.isArray(data.warnings)) return { ok: false };
  if (!Array.isArray(data.items)) return { ok: false };
  for (const it of data.items) {
    if (!isPlainObject(it)) return { ok: false };
    if (typeof it.descricao !== "string" || !String(it.descricao).trim()) return { ok: false };
  }
  if (data.supplier_name_hint != null && typeof data.supplier_name_hint !== "string") return { ok: false };
  if (data.notes != null && typeof data.notes !== "string") return { ok: false };
  if (data.condicao_pagamento != null && typeof data.condicao_pagamento !== "string") return { ok: false };
  if (data.parcelamento != null && typeof data.parcelamento !== "string") return { ok: false };
  if (data.uncategorized_rows != null) {
    if (!Array.isArray(data.uncategorized_rows)) return { ok: false };
    for (const u of data.uncategorized_rows) {
      if (!isPlainObject(u)) return { ok: false };
      if (u.rotulo != null && typeof u.rotulo !== "string") return { ok: false };
      if (u.valor != null && typeof u.valor !== "string") return { ok: false };
      if (u.label != null && typeof u.label !== "string") return { ok: false };
      if (u.value != null && typeof u.value !== "string") return { ok: false };
    }
  }
  return { ok: true, value: data };
}

module.exports = {
  validateAmbiguityResponse,
  validateAnalyticSummaryResponse,
  validateSemanticEquivalenceResponse,
  validateDocumentExtractionResponse,
};
