/**
 * Ranking e scoring determinísticos (sem IA).
 */

const { parsePrecoUnitario } = require("../normalize/money");

/**
 * @param {object} legacy - resultado success do parse legado
 * @param {{ warnings?: object[] }} validation
 * @returns {{
 *   ranking: { supplier_key: string, rank: number, score: number, total: number }[],
 *   winner_suggested: { supplier_key: string, name: string },
 *   alerts: string[],
 *   justifications: { supplier_key: string, bullets: string[] }[]
 * }}
 */
function compareSuppliersFromLegacy(legacy, validation) {
  const alerts = [];
  if (validation?.warnings?.length) {
    for (const w of validation.warnings) {
      alerts.push(typeof w === "string" ? w : w.message || JSON.stringify(w));
    }
  }

  const summary = legacy.summary || {};
  const supplierTotals = summary.supplier_totals;
  const bestFromSummary = summary.best_supplier;

  if (!supplierTotals || Object.keys(supplierTotals).length === 0) {
    const total = (legacy.items || []).reduce((acc, it) => acc + (parsePrecoUnitario(it.total) || 0), 0);
    const key = legacy.source || "default";
    const ranking = [
      {
        supplier_key: key,
        rank: 1,
        score: 100,
        total,
      },
    ];
    return {
      ranking,
      winner_suggested: { supplier_key: key, name: String(legacy.source || "Fornecedor") },
      alerts,
      justifications: [
        {
          supplier_key: key,
          bullets: [
            total > 0
              ? `Total calculado dos itens: R$ ${total.toFixed(2)}`
              : "Total não disponível; revisar itens",
          ],
        },
      ],
    };
  }

  const entries = Object.entries(supplierTotals).map(([name, s]) => ({
    supplier_key: slugKey(name),
    name,
    total: s.total ?? 0,
    avgPrice: s.avgPrice ?? 0,
    items: s.items ?? 0,
  }));

  entries.sort((a, b) => a.total - b.total);

  const minTotal = entries[0]?.total ?? 0;
  const ranking = entries.map((e, i) => ({
    supplier_key: e.supplier_key,
    rank: i + 1,
    score: minTotal > 0 ? Math.max(0, 100 - ((e.total - minTotal) / minTotal) * 50) : 100 - i * 5,
    total: e.total,
  }));

  const winnerName = bestFromSummary || entries[0]?.name || "—";
  const winnerKey = entries.find((e) => e.name === winnerName)?.supplier_key || entries[0]?.supplier_key;

  const justifications = entries.map((e, i) => ({
    supplier_key: e.supplier_key,
    bullets: [
      `Total agregado: R$ ${e.total.toFixed(2)} (${e.items} linha(s) com total > 0)`,
      i === 0
        ? "Menor total entre fornecedores comparados"
        : `Diferença para o menor: R$ ${(e.total - minTotal).toFixed(2)}`,
    ],
  }));

  return {
    ranking,
    winner_suggested: { supplier_key: winnerKey || slugKey(winnerName), name: winnerName },
    alerts,
    justifications,
  };
}

function slugKey(name) {
  return String(name || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 64) || "supplier";
}

module.exports = {
  compareSuppliersFromLegacy,
  slugKey,
};
