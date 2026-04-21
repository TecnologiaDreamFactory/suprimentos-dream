/**
 * Validações determinísticas sobre o resultado do parse (legado ou v2).
 */

const { parsePrecoUnitario } = require("../normalize/money");
const { parseQuantidade } = require("../normalize/quantities");
const { ROW_LABEL_SYNONYMS } = require("../config/aliases");

function matchesLabel(text, synonymsList) {
  const t = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
  if (!t) return false;
  return synonymsList.some((s) => {
    const n = s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
    if (t === n || t.includes(n)) {
      return true;
    }
    // Evita falso positivo: "Z" não deve casar com "prazo pagamento" (n.includes("z"))
    if (t.length < 3) {
      return false;
    }
    return n.includes(t);
  });
}

/**
 * Valida objeto no formato legado de sucesso (parseExcelToCanonical).
 * @param {object} legacy - resultado com status, items, summary, mapping
 * @returns {{ ok: boolean, errors: object[], warnings: object[] }}
 */
function validateLegacyResult(legacy) {
  const errors = [];
  const warnings = [];

  if (!legacy || legacy.status !== "success") {
    return { ok: false, errors: [{ code: "NOT_SUCCESS", message: "Parse não concluído com sucesso" }], warnings: [] };
  }

  const items = legacy.items || [];
  const mapping = legacy.mapping || {};
  const isGrouped = legacy.summary?._template === "grouped_suppliers";
  if (!isGrouped) {
    const requiredZeroConf = ["descricao", "quantidade", "preco_unitario"].filter(
      (f) => !mapping[f] || mapping[f].confidence === 0
    );
    if (requiredZeroConf.length) {
      warnings.push({
        code: "LOW_MAPPING_FIELDS",
        message: `Campos com confiança zero ou ausentes: ${requiredZeroConf.join(", ")}`,
      });
    }
  }

  const supplierTotals = {};
  for (const item of items) {
    const supplier = item.fornecedor || legacy.source || "unknown";
    const key = supplier;
    if (!supplierTotals[key]) supplierTotals[key] = { sum: 0, count: 0 };
    const line =
      parsePrecoUnitario(item.total) ||
      parseQuantidade(item.quantidade) * parsePrecoUnitario(item.preco_unitario);
    if (line > 0) {
      supplierTotals[key].sum += line;
      supplierTotals[key].count += 1;
    }
  }

  // Quantidades divergentes (mesmo índice de linha não aplica em legado single-column; checar se há itens com qtd 0)
  const emptyDesc = items.filter((i) => !String(i.descricao || "").trim());
  if (emptyDesc.length) {
    warnings.push({ code: "EMPTY_DESCRIPTION_ROWS", message: `${emptyDesc.length} linha(s) com descrição vazia` });
  }

  const invalidQty = items.filter((i) => parseQuantidade(i.quantidade) <= 0);
  if (invalidQty.length) {
    warnings.push({ code: "INVALID_QUANTITY", message: `${invalidQty.length} item(ns) com quantidade inválida` });
  }

  // Comparar soma com total declarado no summary se summary.supplier_totals existir
  if (legacy.summary?.supplier_totals) {
    for (const [sup, s] of Object.entries(legacy.summary.supplier_totals)) {
      const computed = supplierTotals[sup];
      if (computed && Math.abs(computed.sum - s.total) > 0.02) {
        warnings.push({
          code: "TOTAL_MISMATCH",
          message: `Soma dos itens (${computed.sum.toFixed(2)}) difere do agregado em supplier_totals (${s.total}) para ${sup}`,
          supplier: sup,
        });
      }
    }
  }

  if (isGrouped && legacy.summary?.declared_totals_row) {
    for (const [sup, declared] of Object.entries(legacy.summary.declared_totals_row)) {
      const computed = supplierTotals[sup];
      const fr = legacy.summary.freight_by_supplier?.[sup] || 0;
      if (computed && declared != null) {
        const expected = computed.sum + fr;
        if (Math.abs(expected - declared) > 0.05) {
          warnings.push({
            code: "DECLARED_TOTAL_MISMATCH",
            message: `Total declarado na linha (${declared}) vs soma itens+frete (${expected.toFixed(2)}) para ${sup}`,
            supplier: sup,
          });
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detecta linhas especiais em grid (frete, total) pela primeira coluna — heurística leve.
 * @param {string[][]} rows
 * @returns {{ freight_rows: number[], total_rows: number[] }}
 */
function scanSpecialRows(rows) {
  const freight_rows = [];
  const total_rows = [];
  for (let r = 0; r < rows.length; r++) {
    const first = String(rows[r]?.[0] ?? "").trim();
    if (matchesLabel(first, ROW_LABEL_SYNONYMS.freight)) freight_rows.push(r);
    if (matchesLabel(first, ROW_LABEL_SYNONYMS.total)) total_rows.push(r);
  }
  return { freight_rows, total_rows };
}

module.exports = {
  validateLegacyResult,
  scanSpecialRows,
  matchesLabel,
};
