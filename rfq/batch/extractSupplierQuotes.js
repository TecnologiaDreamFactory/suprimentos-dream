/**
 * Extrai propostas (fornecedor) a partir do resultado do pipeline por arquivo.
 */

const { parsePrecoUnitario } = require("../normalize/money");
const { parseQuantidade } = require("../normalize/quantities");
const { slugKey } = require("../compare/rank");
const { buildItemKey, normalizeItemKeyDescription } = require("./itemKey");
const { buildUncategorizedRowsForQuote } = require("./uncategorizedMerge");

/**
 * @typedef {object} QuoteLineItem
 * @property {string} item_key
 * @property {string} descricao
 * @property {number} quantidade
 * @property {string} [unidade]
 * @property {number} preco_unitario
 * @property {number} total
 * @property {number|null} [prazo_dias]
 * @property {string} [condicao_pagamento] — por linha (planilha com coluna pagamento / condição)
 * @property {number} [row]
 */

/**
 * Prazo em dias quando possível; aceita texto de PDF (ex.: "15 dias", "10 dias úteis", "15 dias + frete").
 * @param {unknown} raw
 * @returns {number|null}
 */
function parsePrazoDias(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && !Number.isNaN(raw) && raw > 0) return Math.round(raw);
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseQuantidade(s);
  if (n > 0) return Math.round(n);
  const dias = s.match(/(\d+)\s*(?:dia|dias|day|days)\b/i);
  if (dias) return parseInt(dias[1], 10);
  const shortD = s.match(/^(\d{1,3})\s*d(?:ia)?\b/i);
  if (shortD) return parseInt(shortD[1], 10);
  return null;
}

/** @deprecated Use normalizeItemKeyDescription — mantido para compat. */
function normalizeItemKey(desc) {
  return normalizeItemKeyDescription(desc);
}

/**
 * @param {object} pipelineResult - retorno parseWithPipeline
 * @param {{ source_filename: string, file_index: number }} meta
 * @returns {{ ok: boolean, error?: string, quotes: import('./batchTypes').SupplierQuote[] }}
 */
function extractSupplierQuotes(pipelineResult, meta) {
  const { source_filename, file_index } = meta;
  const quotes = [];

  if (!pipelineResult || pipelineResult.status !== "success") {
    const fromErrors = (pipelineResult?.errors || [])
      .map((e) => e.message || e.code)
      .filter(Boolean)
      .join("; ");
    const fromReview = Array.isArray(pipelineResult?.summary?.review_reasons)
      ? pipelineResult.summary.review_reasons.filter(Boolean)[0]
      : "";
    const err =
      fromErrors ||
      fromReview ||
      pipelineResult?.error ||
      "Falha ao processar o arquivo (sem detalhe).";
    return { ok: false, error: String(err), quotes: [] };
  }

  const legacy = pipelineResult;
  const items = legacy.items || [];
  const summary = legacy.summary || {};
  const isGrouped = summary._template === "grouped_suppliers";
  const isDocumentAi = summary._template === "document_ai";

  const freightBy = summary.freight_by_supplier || {};
  const declaredRow = summary.declared_totals_row || {};
  const supplierTotals = summary.supplier_totals || {};
  const installments = summary.installments_raw ?? null;
  const paymentTerms = summary.payment_terms_raw ?? null;

  /** @type {Map<string, typeof items>} */
  const bySupplier = new Map();

  for (const it of items) {
    const sup = String(it.fornecedor || legacy.source || "unknown").trim() || "unknown";
    if (!bySupplier.has(sup)) bySupplier.set(sup, []);
    bySupplier.get(sup).push(it);
  }

  if (bySupplier.size === 0) {
    return { ok: false, error: "nenhum_item_parseado", quotes: [] };
  }

  for (const [supplierName, groupItems] of bySupplier.entries()) {
    /** Inclui file_index para unicidade quando o mesmo nome de arquivo aparece mais de uma vez. */
    const proposalLabel = `${supplierName} (${source_filename}) [${file_index}]`;
    /** Alinha com compareSuppliersFromLegacy (slug do nome exibido). */
    const proposalKey = slugKey(proposalLabel);

    /** @type {QuoteLineItem[]} */
    const lineItems = [];
    for (const it of groupItems) {
      const desc = String(it.descricao || "").trim();
      const unidade = it.unidade != null ? String(it.unidade).trim() : "";
      const itemKey = buildItemKey(it);
      const prazoRaw =
        it.prazo_entrega != null && String(it.prazo_entrega).trim() !== ""
          ? String(it.prazo_entrega).trim()
          : "";
      const condPag = String(it.condicao_pagamento ?? "").trim();
      lineItems.push({
        item_key: itemKey,
        descricao: desc,
        quantidade: parseQuantidade(it.quantidade),
        unidade: unidade || undefined,
        preco_unitario: parsePrecoUnitario(it.preco_unitario),
        total: parsePrecoUnitario(it.total),
        prazo_dias: parsePrazoDias(it.prazo_entrega),
        prazo_entrega_raw: prazoRaw || undefined,
        condicao_pagamento: condPag || undefined,
        row: it.row,
      });
    }

    const paymentFromExcelLines = [...new Set(lineItems.map((x) => String(x.condicao_pagamento ?? "").trim()).filter(Boolean))].join(
      " | "
    );

    const freightTotal = parsePrecoUnitario(freightBy[supplierName]);
    let declared = declaredRow[supplierName];
    if (declared == null && supplierTotals[supplierName]) {
      declared = supplierTotals[supplierName].total;
    }
    if (declared != null) declared = parsePrecoUnitario(declared);

    const sumLines = lineItems.reduce((a, x) => a + (parsePrecoUnitario(x.total) || 0), 0);
    const recalculated = sumLines + freightTotal;

    const quoteWarnings = [];
    if (declared != null && Math.abs(declared - recalculated) > 0.05) {
      quoteWarnings.push(
        `Total declarado (${declared.toFixed(2)}) difere do recalculado (${recalculated.toFixed(2)})`
      );
    }

    const q = {
      proposal_key: proposalKey,
      proposal_label: proposalLabel,
      supplier_name: supplierName,
      source_filename,
      quotation_id: String(legacy.rfq_id || ""),
      file_index,
      items: lineItems,
      freight_total: freightTotal,
      declared_total: declared != null ? declared : null,
      recalculated_total: recalculated,
      installments: isGrouped || isDocumentAi ? installments : null,
      payment_terms:
        isGrouped || isDocumentAi
          ? paymentTerms != null && String(paymentTerms).trim() !== ""
            ? paymentTerms
            : installments
          : paymentFromExcelLines || null,
      uncategorized_rows: buildUncategorizedRowsForQuote(summary, groupItems),
      warnings: quoteWarnings,
    };
    quotes.push(q);
  }

  return { ok: true, quotes };
}

module.exports = {
  extractSupplierQuotes,
  normalizeItemKey,
};
