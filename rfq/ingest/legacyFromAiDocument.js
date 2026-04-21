/**
 * Monta resultado legado (schema parseExcelToCanonical) a partir da extração IA.
 */

const path = require("path");
const { parsePrecoUnitario } = require("../normalize/money");
const { parseQuantidade } = require("../normalize/quantities");

/**
 * @param {unknown} raw
 * @returns {{ label: string, value: string }[]}
 */
function normalizeUncategorizedRows(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {{ label: string, value: string }[]} */
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const label = String(
      /** @type {any} */ (x).label ?? /** @type {any} */ (x).rotulo ?? ""
    ).trim();
    const value = String(
      /** @type {any} */ (x).value ?? /** @type {any} */ (x).valor ?? ""
    ).trim();
    if (!label && !value) continue;
    out.push({ label, value });
  }
  return out;
}

/**
 * Bloco "não categorizado" no Excel: usa linhas extras da IA e, se vierem vazias,
 * replica parcelamento / condição de pagamento (o modelo costuma omitir uncategorized_rows).
 * @param {object} extracted
 * @returns {{ label: string, value: string }[]}
 */
function buildUncategorizedRowsForExport(extracted) {
  const base = normalizeUncategorizedRows(extracted.uncategorized_rows);

  function valueAlreadyListed(val, rows) {
    if (!val) return false;
    return rows.some((r) => r.value === val);
  }

  const out = [...base];
  const parcel =
    extracted.parcelamento != null && extracted.parcelamento !== ""
      ? String(extracted.parcelamento).trim()
      : "";
  const cond =
    extracted.condicao_pagamento != null && extracted.condicao_pagamento !== ""
      ? String(extracted.condicao_pagamento).trim()
      : "";

  if (parcel && !valueAlreadyListed(parcel, out)) {
    const looksParcelado =
      /\d+\s*(?:vez|vezes)\b/i.test(parcel) || /\b\d+\s*x\b/i.test(parcel);
    out.push({ label: looksParcelado ? "Parcelado" : "Parcelamento", value: parcel });
  }
  if (cond && !valueAlreadyListed(cond, out)) {
    out.push({ label: "Pagamento", value: cond });
  }

  return out;
}

function fieldMappingStub() {
  const mk = (label) => ({ original: label, confidence: 1 });
  return {
    descricao: mk("document_ai"),
    quantidade: mk("document_ai"),
    unidade: mk("document_ai"),
    preco_unitario: mk("document_ai"),
    total: mk("document_ai"),
    fornecedor: mk("document_ai"),
    prazo_entrega: mk("document_ai"),
  };
}

/**
 * @param {object} extracted — saída validada de extractQuotationFromDocument
 * @param {{ rfqId: string, source: string, filename?: string, ingestWarnings?: string[] }} ctx
 * @returns {object|null} legacy status success ou null se sem itens
 */
function buildLegacyFromAiDocument(extracted, ctx) {
  const { rfqId, source } = ctx;
  const normalizedSource = String(source || "document").trim() || "document";
  const supplierHint = extracted.supplier_name_hint
    ? String(extracted.supplier_name_hint).trim()
    : "";

  const items = [];
  let rowNum = 2;
  for (const raw of extracted.items || []) {
    const desc = String(raw.descricao || "").trim();
    if (!desc) continue;

    const qty = parseQuantidade(raw.quantidade);
    const unitPrice = parsePrecoUnitario(raw.preco_unitario);
    let total = parsePrecoUnitario(raw.total);
    if (!total && qty > 0 && unitPrice > 0) {
      total = qty * unitPrice;
    }

    const fornecedor = String(raw.fornecedor || supplierHint || normalizedSource).trim() || normalizedSource;

    items.push({
      row: rowNum,
      descricao: desc,
      quantidade: qty,
      unidade: raw.unidade != null && String(raw.unidade).trim() ? String(raw.unidade).trim() : "UN",
      preco_unitario: unitPrice,
      total,
      prazo_entrega: raw.prazo_entrega != null && raw.prazo_entrega !== "" ? String(raw.prazo_entrega) : null,
      impostos_inclusos: null,
      frete_incluso: null,
      fornecedor,
      warnings: [],
    });
    rowNum += 1;
  }

  if (items.length === 0) {
    return null;
  }

  const supplierTotals = {};
  let bestSupplier = null;
  let bestTotal = Infinity;
  for (const item of items) {
    const supplier = item.fornecedor || normalizedSource;
    if (!supplierTotals[supplier]) {
      supplierTotals[supplier] = { total: 0, items: 0, avgPrice: 0 };
    }
    if (item.total > 0) {
      supplierTotals[supplier].total += item.total;
      supplierTotals[supplier].items += 1;
    }
  }
  for (const [supplier, stats] of Object.entries(supplierTotals)) {
    if (stats.items > 0) {
      stats.avgPrice = stats.total / stats.items;
    }
    if (stats.total > 0 && stats.total < bestTotal) {
      bestTotal = stats.total;
      bestSupplier = supplier;
    }
  }
  if (!bestSupplier) {
    bestSupplier = items[0].fornecedor || normalizedSource;
  }

  const reviewReasons = [
    "Conteúdo extraído de PDF/DOC/TXT via IA — revisão manual obrigatória.",
    ...(extracted.notes ? [String(extracted.notes)] : []),
  ];
  const warnings = [
    ...(ctx.ingestWarnings || []),
    ...(extracted.warnings || []).map((w) => String(w)),
  ];

  return {
    status: "success",
    service: "rfq-parser",
    rfq_id: rfqId,
    source: normalizedSource,
    sheet: {
      name: path.basename(ctx.filename || "") || "document",
      header_row: null,
      total_rows: items.length,
    },
    mapping: fieldMappingStub(),
    items,
    summary: {
      _template: "document_ai",
      document_extract_confidence:
        typeof extracted.confidence === "number" ? extracted.confidence : 0.7,
      items_total: items.length,
      items_parsed: items.length,
      items_with_warnings: 0,
      items_invalid: 0,
      needs_review: true,
      review_reasons: reviewReasons,
      best_supplier: bestSupplier,
      supplier_totals: Object.keys(supplierTotals).length > 1 ? supplierTotals : null,
      payment_terms_raw: (() => {
        const a = extracted.condicao_pagamento != null ? String(extracted.condicao_pagamento).trim() : "";
        const b = extracted.parcelamento != null ? String(extracted.parcelamento).trim() : "";
        const parts = [a, b].filter(Boolean);
        return parts.length ? parts.join(" | ") : null;
      })(),
      installments_raw: extracted.parcelamento != null ? String(extracted.parcelamento).trim() : null,
      uncategorized_rows_for_export: buildUncategorizedRowsForExport(extracted),
    },
    warnings: warnings.length ? warnings : [],
    errors: [],
  };
}

module.exports = {
  buildLegacyFromAiDocument,
  normalizeUncategorizedRows,
  buildUncategorizedRowsForExport,
};
