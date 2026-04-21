/**
 * Detecta o template mais provável (legado linha a linha vs blocos agrupados).
 */

const { readBufferToGrid } = require("../io/readWorkbook");

/**
 * Heurística: procura padrão de múltiplos grupos de 3 colunas (qtd / unit / total) na mesma linha.
 * @param {string[][]} rows
 * @returns {boolean}
 */
function looksLikeGroupedSupplierGrid(rows) {
  const maxScan = Math.min(25, rows.length);
  let hits = 0;
  for (let r = 0; r < maxScan; r++) {
    const row = rows[r] || [];
    const joined = row.map((c) => String(c || "").toLowerCase()).join(" | ");
    const qtd = /\bqtd\b|\bquantidade\b|\bqtde\b/.test(joined);
    const unit = /\bvl\s*unit|valor\s*unit|pre[cç]o\s*unit|unit[aá]rio/.test(joined);
    const tot = /\bvl\s*total|valor\s*total|total\b/.test(joined);
    if (qtd && unit && tot) hits++;
  }
  return hits >= 1;
}

/**
 * @param {Buffer} buffer
 * @returns {{ template_type: string, confidence: number, alerts: string[] }}
 */
function detectTemplate(buffer) {
  const alerts = [];
  try {
    const { rows } = readBufferToGrid(buffer);
    if (looksLikeGroupedSupplierGrid(rows)) {
      return {
        template_type: "grouped_suppliers",
        confidence: 0.72,
        alerts: [],
      };
    }
  } catch (e) {
    alerts.push(`Leitura para detecção de template: ${e.message}`);
  }

  return {
    template_type: "legacy_row_per_item",
    confidence: 0.85,
    alerts,
  };
}

module.exports = {
  detectTemplate,
  looksLikeGroupedSupplierGrid,
};
