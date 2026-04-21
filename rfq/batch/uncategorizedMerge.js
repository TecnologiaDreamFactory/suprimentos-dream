/**
 * Junta pares rótulo/valor para a seção "Item em coluna ou linha não categorizado" no export.
 */

/**
 * @param {{ label?: string, value?: string, rotulo?: string, valor?: string }[]} rows
 * @returns {{ label: string, value: string }[]}
 */
function normalizePairs(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const x of rows) {
    if (!x || typeof x !== "object") continue;
    const label = String(x.label ?? x.rotulo ?? "").trim();
    const value = String(x.value ?? x.valor ?? "").trim();
    if (!label || !value) continue;
    out.push({ label, value });
  }
  return out;
}

/**
 * @param {{ label: string, value: string }[]} base
 * @param {{ label: string, value: string }[]} extra
 * @returns {{ label: string, value: string }[]}
 */
function mergePairsDedupe(base, extra) {
  const seen = new Set();
  const out = [];
  for (const arr of [base, extra]) {
    for (const x of arr) {
      if (!x || !String(x.label || "").trim() || !String(x.value || "").trim()) continue;
      const label = String(x.label).trim();
      const value = String(x.value).trim();
      const key = `${label}\t${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label, value });
    }
  }
  return out;
}

/**
 * Colunas não mapeadas na planilha: várias linhas de item → um valor por rótulo (valores distintos com " | ").
 * @param {object[]} groupItems — itens legado do mesmo fornecedor
 * @returns {{ label: string, value: string }[]}
 */
function uncategorizedFromUnmappedColumns(groupItems) {
  /** @type {Map<string, Set<string>>} */
  const byLabel = new Map();
  for (const it of groupItems) {
    const frags = it.uncategorized_fragments;
    if (!Array.isArray(frags)) continue;
    for (const f of frags) {
      const lab = String(f.label ?? "").trim();
      const val = String(f.value ?? "").trim();
      if (!lab || !val) continue;
      if (!byLabel.has(lab)) byLabel.set(lab, new Set());
      byLabel.get(lab).add(val);
    }
  }
  const out = [];
  for (const [label, set] of byLabel) {
    out.push({ label, value: [...set].join(" | ") });
  }
  return out;
}

/**
 * @param {object} summary — legacy.summary
 * @param {object[]} groupItems
 * @returns {{ label: string, value: string }[]}
 */
function buildUncategorizedRowsForQuote(summary, groupItems) {
  const fromSummary = normalizePairs(summary.uncategorized_rows_for_export);
  const fromUnmapped = uncategorizedFromUnmappedColumns(groupItems);
  return mergePairsDedupe(fromSummary, fromUnmapped);
}

module.exports = {
  normalizePairs,
  mergePairsDedupe,
  uncategorizedFromUnmappedColumns,
  buildUncategorizedRowsForQuote,
};
