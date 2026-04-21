/**
 * Parser para planilhas com fornecedores em blocos de 3 colunas (qtd | unitário | total)
 * após uma coluna de descrição do item.
 */

const { mapHeaderToCanonical } = require("../columnMapping");
const { ROW_LABEL_SYNONYMS } = require("../config/aliases");
const { readBestSheetWithMerges, getCellDisplayValue } = require("../io/readWorkbook");
const { parsePrecoUnitario } = require("../normalize/money");
const { parseQuantidade } = require("../normalize/quantities");
const { matchesLabel } = require("../validate/rules");
const { extractQuotationIdFromSheet } = require("../extractQuotationId");

const MIN_HEADER_CONF = 0.32;
const MIN_BLOCKS = 1;

/**
 * @param {number} r
 * @param {number} c
 * @param {string[][]} rows
 * @param {object[]} merges
 */
function cellHeader(r, c, rows, merges) {
  return getCellDisplayValue(r, c, rows, merges);
}

/**
 * @param {string[][]} rows
 */
function gridMaxCol(rows) {
  let m = 0;
  for (const row of rows) {
    m = Math.max(m, row ? row.length : 0);
  }
  return m;
}

/**
 * Encontra linha de cabeçalho com coluna descrição + blocos (qtd, unit, total).
 * @returns {{ headerRow: number, descCol: number, blocks: { startCol: number, qtdCol: number, unitCol: number, totalCol: number }[], score: number } | null}
 */
function findHeaderLayout(rows, merges) {
  const maxRow = Math.min(50, rows.length);
  const maxCol = Math.max(20, gridMaxCol(rows));

  let best = null;

  for (let r = 0; r < maxRow; r++) {
    for (let descCol = 0; descCol < maxCol; descCol++) {
      const hDesc = mapHeaderToCanonical(cellHeader(r, descCol, rows, merges));
      if (hDesc.field !== "descricao" || hDesc.confidence < MIN_HEADER_CONF) {
        continue;
      }

      const blocks = [];
      let c = descCol + 1;
      while (c + 2 < maxCol) {
        const m0 = mapHeaderToCanonical(cellHeader(r, c, rows, merges));
        const m1 = mapHeaderToCanonical(cellHeader(r, c + 1, rows, merges));
        const m2 = mapHeaderToCanonical(cellHeader(r, c + 2, rows, merges));

        const ok =
          m0.field === "quantidade" &&
          m1.field === "preco_unitario" &&
          m2.field === "total" &&
          m0.confidence >= MIN_HEADER_CONF &&
          m1.confidence >= MIN_HEADER_CONF &&
          m2.confidence >= MIN_HEADER_CONF;

        if (ok) {
          blocks.push({
            startCol: c,
            qtdCol: c,
            unitCol: c + 1,
            totalCol: c + 2,
          });
          c += 3;
        } else {
          c += 1;
        }
      }

      if (blocks.length < MIN_BLOCKS) {
        continue;
      }

      let score =
        blocks.length * 10 +
        hDesc.confidence +
        blocks.reduce((acc, b) => {
          const a = mapHeaderToCanonical(cellHeader(r, b.qtdCol, rows, merges));
          const u = mapHeaderToCanonical(cellHeader(r, b.unitCol, rows, merges));
          const t = mapHeaderToCanonical(cellHeader(r, b.totalCol, rows, merges));
          return acc + a.confidence + u.confidence + t.confidence;
        }, 0);

      if (!best || score > best.score) {
        best = { headerRow: r, descCol, blocks, score };
      }
    }
  }

  return best;
}

/**
 * Evita confundir nome de fornecedor com rótulo de coluna.
 */
function looksLikeColumnHeader(text) {
  const m = mapHeaderToCanonical(text);
  if (!m.field) return false;
  return m.confidence >= 0.55 && ["descricao", "quantidade", "preco_unitario", "total"].includes(m.field);
}

/**
 * Nome do fornecedor acima do bloco (linha headerRow-1 ou headerRow-2).
 * Variação comum: nome na coluna A (descCol) quando o 1º bloco começa em B.
 */
function resolveSupplierName(headerRow, block, descCol, blockIndex, rows, merges) {
  const tryRows = [headerRow - 1, headerRow - 2, headerRow - 3].filter((x) => x >= 0);

  for (const sr of tryRows) {
    const mergedFirst = getCellDisplayValue(sr, block.startCol, rows, merges);
    if (mergedFirst && !looksLikeColumnHeader(mergedFirst)) {
      return mergedFirst;
    }
    const parts = [];
    for (let dc = 0; dc < 3; dc++) {
      const v = getCellDisplayValue(sr, block.startCol + dc, rows, merges);
      if (v) parts.push(v);
    }
    const joined = parts.join(" ").trim();
    if (joined) {
      return joined;
    }
    if (blockIndex === 0 && block.startCol === descCol + 1) {
      const left = getCellDisplayValue(sr, descCol, rows, merges);
      if (left && !looksLikeColumnHeader(left)) {
        return left;
      }
    }
  }

  return null;
}

/**
 * @param {number} r
 * @param {number} descCol
 * @param {{ startCol: number }[]} blocks
 */
function rowIsBlankItem(r, descCol, blocks, rows, merges) {
  const d = getCellDisplayValue(r, descCol, rows, merges);
  if (String(d).trim()) {
    return false;
  }
  for (const b of blocks) {
    const q = getCellDisplayValue(r, b.qtdCol, rows, merges);
    const u = getCellDisplayValue(r, b.unitCol, rows, merges);
    const t = getCellDisplayValue(r, b.totalCol, rows, merges);
    if (String(q).trim() || String(u).trim() || String(t).trim()) {
      return false;
    }
  }
  return true;
}

/**
 * @param {string} desc
 * @param {string} key
 */
function labelMatchesRow(desc, key) {
  const list = ROW_LABEL_SYNONYMS[key];
  if (!list) return false;
  if (key === "payment_terms") {
    const broad = matchesLabel(desc, list);
    if (!broad) return false;
    const t = String(desc).toLowerCase();
    if (t.length > 80) {
      return false;
    }
    return (
      /cond|prazo|forma|pgto|pagamento/.test(t) || t.length < 35
    );
  }
  return matchesLabel(desc, list);
}

/**
 * Parse principal.
 * @param {Buffer} buffer
 * @param {string} rfqId
 * @param {string} source
 * @returns {{ ok: boolean, reason?: string, legacy?: object, parsing_confidence?: number, parsing_alerts?: string[], blocks?: object[] }}
 */
function parseGroupedBlocks(buffer, rfqId, source = "") {
  const parsingAlerts = [];
  let { sheetName, rows, merges } = readBestSheetWithMerges(buffer);

  if (!rows || rows.length === 0) {
    return { ok: false, reason: "EMPTY_SHEET" };
  }

  const layout = findHeaderLayout(rows, merges);
  if (!layout) {
    return { ok: false, reason: "NO_GROUPED_HEADER" };
  }

  const { headerRow, descCol, blocks } = layout;

  const supplierNames = blocks.map((b, i) => {
    const n = resolveSupplierName(headerRow, b, descCol, i, rows, merges);
    if (!n) {
      parsingAlerts.push(`Fornecedor ${i + 1}: nome não encontrado acima das colunas — usando rótulo genérico.`);
      return `Fornecedor_${i + 1}`;
    }
    return n;
  });

  const qidResult = extractQuotationIdFromSheet(rows, merges, headerRow);
  if (qidResult.alerts.length) {
    parsingAlerts.push(...qidResult.alerts);
  }
  const quotationId = qidResult.value || rfqId;

  const freightBySupplier = {};
  const declaredTotalsRow = {};
  let installmentsRaw = null;
  let paymentTermsRaw = null;

  const items = [];
  const supplierLineSums = {};
  for (const name of supplierNames) {
    supplierLineSums[name] = 0;
  }

  for (let r = headerRow + 1; r < rows.length; r++) {
    if (rowIsBlankItem(r, descCol, blocks, rows, merges)) {
      continue;
    }

    const descRaw = getCellDisplayValue(r, descCol, rows, merges);
    const desc = String(descRaw).trim();

    /** @type {'item'|'freight'|'total_row'|'installments'|'payment'|'skip'} */
    let rowKind = "item";

    if (!desc) {
      rowKind = "skip";
    } else if (labelMatchesRow(desc, "freight")) {
      rowKind = "freight";
    } else if (labelMatchesRow(desc, "total")) {
      rowKind = "total_row";
    } else if (labelMatchesRow(desc, "installments")) {
      rowKind = "installments";
    } else if (labelMatchesRow(desc, "payment_terms")) {
      rowKind = "payment";
    }

    if (rowKind === "skip") {
      continue;
    }

    if (rowKind === "freight") {
      blocks.forEach((b, idx) => {
        const name = supplierNames[idx];
        const v =
          parsePrecoUnitario(getCellDisplayValue(r, b.totalCol, rows, merges)) ||
          parsePrecoUnitario(getCellDisplayValue(r, b.unitCol, rows, merges)) ||
          parsePrecoUnitario(getCellDisplayValue(r, b.qtdCol, rows, merges));
        if (v > 0) {
          freightBySupplier[name] = (freightBySupplier[name] || 0) + v;
        }
      });
      continue;
    }

    if (rowKind === "total_row") {
      blocks.forEach((b, idx) => {
        const name = supplierNames[idx];
        const v = parsePrecoUnitario(getCellDisplayValue(r, b.totalCol, rows, merges));
        if (v > 0) {
          declaredTotalsRow[name] = v;
        }
      });
      continue;
    }

    if (rowKind === "installments") {
      const rest = [];
      const maxC = gridMaxCol(rows);
      for (let c = descCol + 1; c < maxC; c++) {
        const t = getCellDisplayValue(r, c, rows, merges);
        if (t) rest.push(t);
      }
      installmentsRaw = rest.join(" | ").trim() || desc;
      continue;
    }

    if (rowKind === "payment") {
      const rest = [];
      const maxC = gridMaxCol(rows);
      for (let c = descCol + 1; c < maxC; c++) {
        const t = getCellDisplayValue(r, c, rows, merges);
        if (t) rest.push(t);
      }
      paymentTermsRaw = rest.join(" | ").trim() || desc;
      continue;
    }

    // item
    blocks.forEach((b, idx) => {
      const supplier = supplierNames[idx];
      const qRaw = getCellDisplayValue(r, b.qtdCol, rows, merges);
      const uRaw = getCellDisplayValue(r, b.unitCol, rows, merges);
      const tRaw = getCellDisplayValue(r, b.totalCol, rows, merges);

      const quantidade = parseQuantidade(qRaw);
      const preco_unitario = parsePrecoUnitario(uRaw);
      let total = parsePrecoUnitario(tRaw);
      if (!total && quantidade && preco_unitario) {
        total = quantidade * preco_unitario;
      }

      const allEmpty = !String(qRaw).trim() && !String(uRaw).trim() && !String(tRaw).trim();
      if (allEmpty) {
        return;
      }

      if (quantidade <= 0 && preco_unitario <= 0 && total <= 0) {
        parsingAlerts.push(`Linha ${r + 1} (${supplier}): valores ausentes ou zero — revisar.`);
      }

      const itemWarnings = [];
      if (quantidade <= 0 && (preco_unitario > 0 || total > 0)) {
        itemWarnings.push("Quantidade ausente ou inválida");
      }
      if (preco_unitario <= 0 && total > 0 && quantidade > 0) {
        itemWarnings.push("Preço unitário ausente; total preenchido");
      }

      items.push({
        row: r + 1,
        descricao: desc,
        quantidade,
        unidade: "UN",
        preco_unitario,
        total,
        prazo_entrega: null,
        impostos_inclusos: null,
        frete_incluso: null,
        fornecedor: supplier,
        warnings: itemWarnings,
      });

      if (total > 0) {
        supplierLineSums[supplier] = (supplierLineSums[supplier] || 0) + total;
      }
    });
  }

  const supplierTotals = {};
  let bestSupplier = null;
  let bestTotal = Infinity;

  for (const name of supplierNames) {
    const lines = items.filter((it) => it.fornecedor === name);
    const sum = lines.reduce((acc, it) => acc + (parsePrecoUnitario(it.total) || 0), 0);
    const fr = freightBySupplier[name] || 0;
    const agg = sum + fr;
    const withTotal = lines.filter((it) => (parsePrecoUnitario(it.total) || 0) > 0).length;
    supplierTotals[name] = {
      total: agg,
      items: withTotal,
      avgPrice: lines.length ? sum / lines.length : 0,
    };

    if (agg > 0 && agg < bestTotal) {
      bestTotal = agg;
      bestSupplier = name;
    }
  }

  if (!bestSupplier && supplierNames.length) {
    bestSupplier = supplierNames[0];
  }

  for (const name of supplierNames) {
    const declared = declaredTotalsRow[name];
    if (declared == null) {
      continue;
    }
    const sum = supplierLineSums[name] || 0;
    const fr = freightBySupplier[name] || 0;
    const computed = sum + fr;
    if (Math.abs(computed - declared) > 0.05) {
      parsingAlerts.push(
        `Total declarado (${declared.toFixed(2)}) inconsistente com soma itens+frete (${computed.toFixed(2)}) para ${name}.`
      );
    }
  }

  const mapping = {
    descricao: { original: cellHeader(headerRow, descCol, rows, merges), confidence: 1 },
    quantidade: { original: "bloco_qtd", confidence: 1 },
    preco_unitario: { original: "bloco_unit", confidence: 1 },
    total: { original: "bloco_total", confidence: 1 },
  };

  let parsingConfidence = Math.min(
    1,
    0.55 + layout.score * 0.02 + (supplierNames.every((n) => !n.startsWith("Fornecedor_")) ? 0.15 : 0)
  );
  if (parsingAlerts.some((a) => a.includes("inconsistente"))) {
    parsingConfidence = Math.max(0.35, parsingConfidence - 0.2);
  }
  if (items.length === 0) {
    parsingConfidence = Math.min(parsingConfidence, 0.45);
    parsingAlerts.push("Nenhum item de linha parseado — revisão manual necessária.");
  }

  /** Linhas de rótulo (parcelamento / pagamento) também no bloco "não categorizado" do export. */
  const uncategorized_rows_for_export = [];
  if (installmentsRaw && String(installmentsRaw).trim()) {
    uncategorized_rows_for_export.push({
      label: "Parcelamento",
      value: String(installmentsRaw).trim(),
    });
  }
  if (paymentTermsRaw && String(paymentTermsRaw).trim()) {
    uncategorized_rows_for_export.push({
      label: "Pagamento",
      value: String(paymentTermsRaw).trim(),
    });
  }

  const legacy = {
    status: "success",
    service: "rfq-parser",
    rfq_id: quotationId,
    source: (source && String(source).trim()) || "unknown",
    sheet: {
      name: sheetName,
      header_row: headerRow + 1,
      total_rows: rows.length,
    },
    mapping,
    items,
    summary: {
      _template: "grouped_suppliers",
      items_total: items.length,
      items_parsed: items.length,
      items_with_warnings: items.filter((i) => i.warnings?.length).length,
      items_invalid: items.filter((i) => i.quantidade <= 0 || i.preco_unitario <= 0).length,
      needs_review: parsingAlerts.length > 0 || items.length === 0,
      review_reasons: parsingAlerts.length ? parsingAlerts.slice() : null,
      best_supplier: bestSupplier,
      supplier_totals: supplierNames.length > 1 ? supplierTotals : null,
      freight_by_supplier: Object.keys(freightBySupplier).length ? freightBySupplier : null,
      declared_totals_row: Object.keys(declaredTotalsRow).length ? declaredTotalsRow : null,
      installments_raw: installmentsRaw,
      payment_terms_raw: paymentTermsRaw,
      uncategorized_rows_for_export,
    },
    warnings: [],
    errors: [],
  };

  return {
    ok: true,
    legacy,
    parsing_confidence: parsingConfidence,
    parsing_alerts: parsingAlerts,
    blocks: blocks.map((b, i) => ({
      ...b,
      supplier: supplierNames[i],
    })),
  };
}

module.exports = {
  parseGroupedBlocks,
  findHeaderLayout,
};
