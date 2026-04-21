/**
 * Consolida itens de várias propostas numa matriz comparável por item_key.
 */

const { parsePrecoUnitario } = require("../normalize/money");

/**
 * @typedef {object} ConsolidatedRow
 * @property {string} item_key
 * @property {string} reference_description
 * @property {number} reference_quantity
 * @property {Record<string, {
 *   unit_price: number|null,
 *   line_total: number|null,
 *   quantity: number|null,
 *   prazo_dias: number|null,
 *   missing: boolean,
 *   quantity_divergent?: boolean
 * }>} by_proposal
 */

/**
 * @typedef {object} ConsolidatedMatrix
 * @property {string[]} item_keys_sorted
 * @property {ConsolidatedRow[]} rows
 * @property {string[]} proposal_keys
 * @property {Record<string, string>} proposal_labels
 */

/**
 * @param {import('./extractSupplierQuotes').SupplierQuote[]} quotes
 * @returns {ConsolidatedMatrix}
 */
function consolidateQuotes(quotes) {
  const proposalKeys = quotes.map((q) => q.proposal_key);
  const proposalLabels = Object.fromEntries(quotes.map((q) => [q.proposal_key, q.proposal_label]));

  /** @type {Map<string, { desc: string, qtys: number[] }>} */
  const keyMeta = new Map();

  for (const q of quotes) {
    for (const it of q.items) {
      const k = it.item_key;
      if (!keyMeta.has(k)) {
        keyMeta.set(k, { desc: it.descricao || k, qtys: [] });
      }
      const meta = keyMeta.get(k);
      if (it.descricao && it.descricao.length > meta.desc.length) meta.desc = it.descricao;
      if (it.quantidade > 0) meta.qtys.push(it.quantidade);
    }
  }

  const itemKeysSorted = Array.from(keyMeta.keys()).sort((a, b) => a.localeCompare(b));

  /** @type {ConsolidatedRow[]} */
  const rows = [];

  for (const itemKey of itemKeysSorted) {
    const meta = keyMeta.get(itemKey);
    const referenceQty =
      meta.qtys.length > 0 ? meta.qtys.sort((a, b) => a - b)[Math.floor(meta.qtys.length / 2)] : 0;

    /** @type {ConsolidatedRow} */
    const row = {
      item_key: itemKey,
      reference_description: meta.desc,
      reference_quantity: referenceQty,
      by_proposal: {},
    };

    for (const q of quotes) {
      const found = q.items.find((x) => x.item_key === itemKey);
      if (!found) {
        row.by_proposal[q.proposal_key] = {
          unit_price: null,
          line_total: null,
          quantity: null,
          prazo_dias: null,
          missing: true,
        };
      } else {
        const up = parsePrecoUnitario(found.preco_unitario);
        const lt = parsePrecoUnitario(found.total);
        const qty = found.quantidade;
        const pz =
          found.prazo_dias != null && typeof found.prazo_dias === "number" && found.prazo_dias > 0
            ? found.prazo_dias
            : null;
        let divergent = false;
        if (referenceQty > 0 && qty > 0 && Math.abs(qty - referenceQty) > 0.001) {
          divergent = true;
        }
        row.by_proposal[q.proposal_key] = {
          unit_price: up,
          line_total: lt,
          quantity: qty,
          prazo_dias: pz,
          missing: false,
          quantity_divergent: divergent,
        };
      }
    }

    rows.push(row);
  }

  return {
    item_keys_sorted: itemKeysSorted,
    rows,
    proposal_keys: proposalKeys,
    proposal_labels: proposalLabels,
  };
}

module.exports = {
  consolidateQuotes,
};
