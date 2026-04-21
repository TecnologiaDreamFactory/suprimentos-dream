/**
 * Monta o JSON canônico v2 a partir do resultado legado + metadados do pipeline.
 */

/**
 * @param {object} legacy - resultado parseExcelToCanonical (success)
 * @param {number} parsingConfidence 0..1
 * @param {string[]} parsingAlerts
 * @returns {object}
 */
function buildCanonicalV2FromLegacy(legacy, parsingConfidence = 1, parsingAlerts = []) {
  const items = legacy.items || [];
  const source = legacy.source || "unknown";

  const suppliersMap = new Map();
  for (const it of items) {
    const sup = it.fornecedor || source;
    if (!suppliersMap.has(sup)) {
      suppliersMap.set(sup, {
        id: slug(sup),
        name: sup,
        columns: { quantity: null, unit_price: null, line_total: null },
      });
    }
  }
  if (suppliersMap.size === 0) {
    suppliersMap.set(source, {
      id: slug(source),
      name: source,
      columns: { quantity: null, unit_price: null, line_total: null },
    });
  }

  const canonicalItems = items.map((it, idx) => {
    const sup = it.fornecedor || source;
    const sid = slug(sup);
    return {
      row: it.row,
      description: it.descricao,
      by_supplier: {
        [sid]: {
          quantity: it.quantidade,
          unit_price: it.preco_unitario,
          line_total: it.total,
        },
      },
    };
  });

  return {
    template_type: "legacy_row_per_item",
    quotation_id: legacy.rfq_id || null,
    suppliers: Array.from(suppliersMap.values()),
    items: canonicalItems,
    freight: {},
    totals: legacy.summary?.supplier_totals
      ? Object.fromEntries(
          Object.entries(legacy.summary.supplier_totals).map(([k, v]) => [slug(k), v.total])
        )
      : {},
    installments: null,
    payment_terms: null,
    parsing_confidence: parsingConfidence,
    parsing_alerts: parsingAlerts,
  };
}

function slug(name) {
  return String(name || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 64);
}

/**
 * Canônico v2 para template grouped_suppliers (frete, parcelamento, totais declarados).
 * @param {object} legacy
 * @param {{ parsing_confidence?: number, parsing_alerts?: string[] }} groupedResult
 */
function buildCanonicalV2FromGrouped(legacy, groupedResult) {
  const parsingAlerts = [...(groupedResult.parsing_alerts || [])];
  const conf = groupedResult.parsing_confidence ?? 0.8;
  const base = buildCanonicalV2FromLegacy(legacy, conf, parsingAlerts);
  const sum = legacy.summary || {};

  const freight = sum.freight_by_supplier
    ? Object.fromEntries(Object.entries(sum.freight_by_supplier).map(([k, v]) => [slug(k), v]))
    : {};

  let totals = base.totals;
  if (sum.declared_totals_row && Object.keys(sum.declared_totals_row).length) {
    totals = Object.fromEntries(
      Object.entries(sum.declared_totals_row).map(([k, v]) => [slug(k), v])
    );
  }

  return {
    ...base,
    template_type: "grouped_suppliers",
    freight,
    totals,
    installments: sum.installments_raw ? { raw: sum.installments_raw } : null,
    payment_terms: sum.payment_terms_raw ? { raw: sum.payment_terms_raw } : null,
    parsing_confidence: conf,
    parsing_alerts: parsingAlerts,
  };
}

module.exports = {
  buildCanonicalV2FromLegacy,
  buildCanonicalV2FromGrouped,
};
