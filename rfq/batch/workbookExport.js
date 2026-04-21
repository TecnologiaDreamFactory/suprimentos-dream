/**
 * Exporta planilha XLSX (exceljs) — schema em xlsxSchema.js
 * Abas: Itens por fornecedor, Comparação (matriz + destaques).
 */

const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const {
  SHEETS,
  POR_FORNECEDOR_COLUMNS,
  COMPARACAO_FIXED_COLUMNS,
  COMPARACAO_PROPOSAL_SUFFIXES,
  COMPARACAO_PROPOSAL_COLUMN_WIDTHS,
  NUMFMT_BRL,
  FILL_HEADER,
  FILL_MIN_PRICE,
} = require("./xlsxSchema");
const { parseExecutionSeconds } = require("./batchMetrics");
const { computeRowWins, buildProposalColorMap } = require("./supplierWinColors");

function excelColName(colIndex1Based) {
  let n = colIndex1Based;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function supplierHeaderForProposal(pk, allQuotes) {
  const q = allQuotes.find((x) => x.proposal_key === pk);
  if (!q) return pk;
  return String(q.supplier_name || q.proposal_label || pk).trim() || pk;
}

function applySupplierFill(cell, argb) {
  if (!cell || !argb) return;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** Linhas extraídas do PDF que não são tabela de itens (rótulo/valor). */
function appendUncategorizedRowsSection(ws, q, numCols) {
  const rows = Array.isArray(q.uncategorized_rows) ? q.uncategorized_rows : [];
  if (!rows.length) return;

  ws.addRow([]);
  const titleRow = ws.addRow(["Item em coluna ou linha não categorizado", "", "", "", "", "", ""]);
  ws.mergeCells(titleRow.number, 1, titleRow.number, numCols);
  const tc = titleRow.getCell(1);
  tc.font = { bold: true, italic: true };
  tc.alignment = { vertical: "middle", horizontal: "left" };

  for (const u of rows) {
    const lab = String(u.label ?? "").trim();
    const val = String(u.value ?? "").trim();
    if (!lab && !val) continue;
    const dr = ws.addRow([lab || "—", val, "", "", "", "", ""]);
    ws.mergeCells(dr.number, 2, dr.number, numCols);
    dr.getCell(1).alignment = { wrapText: true, vertical: "top" };
    const vCell = dr.getCell(2);
    vCell.alignment = { wrapText: true, vertical: "top" };
    applySupplierFill(vCell, FILL_MIN_PRICE);
  }
}

const PAYMENT_TERMS_DISPLAY_MAX = 500;
const PARSE_ERROR_DISPLAY_MAX = 2000;

/**
 * @param {unknown} terms — payment_terms da cotação (string, objeto, array…)
 * @returns {string}
 */
function formatPaymentTermsDisplay(terms) {
  if (terms == null || terms === "") return "";
  if (typeof terms === "string") {
    const s = terms.trim();
    return s.length > PAYMENT_TERMS_DISPLAY_MAX ? s.slice(0, PAYMENT_TERMS_DISPLAY_MAX) + "…" : s;
  }
  try {
    const raw = JSON.stringify(terms);
    if (!raw || raw === "{}") return "";
    return raw.length > PAYMENT_TERMS_DISPLAY_MAX ? raw.slice(0, PAYMENT_TERMS_DISPLAY_MAX) + "…" : raw;
  } catch {
    return "";
  }
}

/**
 * @param {import('exceljs').Workbook} wb
 * @param {{ allQuotes: object[], proposalKeysOrdered: string[], colorMap: Record<string, string>, consolidated?: object, parsedFiles?: object[] }} ctx
 */
function addPorFornecedorWorksheet(wb, ctx) {
  const { allQuotes, proposalKeysOrdered, colorMap, consolidated, parsedFiles } = ctx;
  const cols = POR_FORNECEDOR_COLUMNS;
  const numCols = cols.length;
  if (!numCols) return;

  const ws = wb.addWorksheet(SHEETS.POR_FORNECEDOR, {});
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  if (parsedFiles && parsedFiles.length > 0) {
    const titleRow = ws.addRow(["Arquivos enviados neste lote"]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, numCols);
    titleRow.getCell(1).font = { bold: true, size: 12 };

    const invHdr = ws.addRow(["Arquivo", "Situação", "Observação / detalhe", "", "", "", ""]);
    invHdr.eachCell((cell, col) => {
      if (col <= 2) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
        cell.font = { bold: true };
      }
    });
    const invH = invHdr.number;
    ws.mergeCells(invH, 3, invH, numCols);
    invHdr.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
    invHdr.getCell(3).font = { bold: true };

    for (const pf of parsedFiles) {
      const fn = String(pf.source_filename != null ? pf.source_filename : `file_${pf.file_index ?? "?"}`).trim();
      const ok = pf.parse_ok === true;
      const situacao = ok ? "Processado" : "Não processado";
      let obs = "";
      if (!ok) {
        obs = String(pf.parse_error || pf.pipeline_result?.error || "").trim();
      } else {
        const nq = Array.isArray(pf.supplier_quotes) ? pf.supplier_quotes.length : 0;
        obs = nq > 0 ? `${nq} proposta(s) extraída(s).` : "Nenhuma proposta extraída.";
      }
      if (obs.length > PARSE_ERROR_DISPLAY_MAX) {
        obs = obs.slice(0, PARSE_ERROR_DISPLAY_MAX) + "…";
      }
      const dataRow = ws.addRow([fn, situacao, obs, "", "", "", ""]);
      ws.mergeCells(dataRow.number, 3, dataRow.number, numCols);
      dataRow.getCell(3).alignment = { wrapText: true, vertical: "top" };
      if (!ok) {
        dataRow.getCell(1).font = { color: { argb: "FFB71C1C" } };
        dataRow.getCell(2).font = { color: { argb: "FFB71C1C" } };
      }
    }
    ws.addRow([]);
  }

  const quoteByKey = new Map((allQuotes || []).map((q) => [q.proposal_key, q]));
  let blockIndex = 0;

  for (const pk of proposalKeysOrdered || []) {
    const q = quoteByKey.get(pk);
    if (!q) continue;

    if (blockIndex > 0) ws.addRow([]);
    blockIndex += 1;

    const supplierLabel = String(q.supplier_name || q.proposal_label || pk).trim() || pk;
    const titleRow = ws.addRow([`Fornecedor: ${supplierLabel}`]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, numCols);
    const tCell = titleRow.getCell(1);
    tCell.font = { bold: true };
    tCell.alignment = { vertical: "middle", horizontal: "left" };
    applySupplierFill(tCell, colorMap[pk]);

    const fileRow = ws.addRow([`Arquivo: ${q.source_filename || "—"}`]);
    ws.mergeCells(fileRow.number, 1, fileRow.number, numCols);
    fileRow.getCell(1).font = { italic: true, size: 11 };

    const hdr = ws.addRow(cols.map((c) => c.header));
    hdr.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
      cell.font = { bold: true };
    });

    const payDisplay = formatPaymentTermsDisplay(q.payment_terms);
    const srcFile = q.source_filename || "—";
    const items = Array.isArray(q.items) ? q.items : [];

    if (items.length) {
      for (const it of items) {
        const desc = String(it.descricao || "").trim();
        const qty = it.quantidade != null && it.quantidade !== "" ? it.quantidade : "";
        const unit = it.preco_unitario != null && it.preco_unitario !== "" ? it.preco_unitario : "";
        const tot = it.total != null && it.total !== "" ? it.total : "";
        const prazo =
          it.prazo_dias != null && typeof it.prazo_dias === "number" && it.prazo_dias > 0
            ? it.prazo_dias
            : String(it.prazo_entrega_raw || "").trim();
        const payLine = String(it.condicao_pagamento ?? "").trim() || payDisplay;

        const dRow = ws.addRow([srcFile, desc, qty, unit, tot, prazo, payLine]);
        dRow.getCell(4).numFmt = NUMFMT_BRL;
        dRow.getCell(5).numFmt = NUMFMT_BRL;
      }
    } else if (consolidated?.rows?.length) {
      for (const crow of consolidated.rows) {
        const c = crow.by_proposal[pk];
        if (!c || c.missing) continue;
        const desc = String(crow.reference_description || crow.item_key || "").trim();
        const qty = c.quantity != null && c.quantity !== "" ? c.quantity : "";
        const unit = c.unit_price != null && c.unit_price !== "" ? c.unit_price : "";
        const tot = c.line_total != null && c.line_total !== "" ? c.line_total : "";
        const prazo =
          c.prazo_dias != null && typeof c.prazo_dias === "number" && c.prazo_dias > 0 ? c.prazo_dias : "";
        const dRow = ws.addRow([srcFile, desc, qty, unit, tot, prazo, payDisplay]);
        dRow.getCell(4).numFmt = NUMFMT_BRL;
        dRow.getCell(5).numFmt = NUMFMT_BRL;
      }
    } else {
      ws.addRow([srcFile, "(nenhum item nesta proposta)", "", "", "", "", payDisplay]);
    }

    appendUncategorizedRowsSection(ws, q, numCols);
  }
}

/**
 * @param {import('exceljs').Workbook} wb
 * @param {object} ctx
 */
function addComparacaoWorksheet(wb, ctx) {
  const { consolidated, allQuotes, colorMap, rowWinners } = ctx;
  if (!consolidated?.rows?.length || !consolidated.proposal_keys?.length) return;

  const ws = wb.addWorksheet(SHEETS.COMPARACAO, {
    views: [{ state: "frozen", ySplit: 2 }],
  });
  const fixed = COMPARACAO_FIXED_COLUMNS;
  const suffixes = COMPARACAO_PROPOSAL_SUFFIXES;
  const perProp = suffixes.length;
  const fixedCount = fixed.length;
  const proposalKeys = consolidated.proposal_keys;

  const row1 = new Array(fixedCount).fill("");
  for (let j = 0; j < proposalKeys.length; j++) {
    const pk = proposalKeys[j];
    const label = supplierHeaderForProposal(pk, allQuotes);
    row1.push(label);
    for (let k = 1; k < perProp; k++) row1.push(null);
  }
  ws.addRow(row1);

  const row2 = [];
  for (const col of fixed) row2.push(col.header);
  for (let j = 0; j < proposalKeys.length; j++) {
    for (const s of suffixes) row2.push(s);
  }
  const h2 = ws.addRow(row2);
  h2.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
    cell.font = { bold: true };
  });

  for (let j = 0; j < proposalKeys.length; j++) {
    const startCol = fixedCount + j * perProp + 1;
    const endCol = fixedCount + (j + 1) * perProp;
    ws.mergeCells(`${excelColName(startCol)}1:${excelColName(endCol)}1`);
    const pk = proposalKeys[j];
    const tl = ws.getRow(1).getCell(startCol);
    tl.alignment = { vertical: "middle", horizontal: "center" };
    tl.font = { bold: true };
    applySupplierFill(tl, colorMap[pk]);
  }

  fixed.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
  let cidx = fixedCount;
  for (let j = 0; j < proposalKeys.length; j++) {
    for (let k = 0; k < perProp; k++) {
      cidx += 1;
      const w = COMPARACAO_PROPOSAL_COLUMN_WIDTHS[k] ?? 14;
      ws.getColumn(cidx).width = w;
    }
  }

  for (let ri = 0; ri < consolidated.rows.length; ri++) {
    const crow = consolidated.rows[ri];
    const cells = [crow.item_key, crow.reference_description, crow.reference_quantity];
    for (const pk of proposalKeys) {
      const c = crow.by_proposal[pk];
      if (!c || c.missing) {
        for (let k = 0; k < perProp; k++) cells.push("");
      } else {
        const obs = c.quantity_divergent ? "qtd divergente" : "";
        cells.push(
          c.unit_price != null && c.unit_price > 0 ? c.unit_price : "",
          c.line_total != null && c.line_total > 0 ? c.line_total : "",
          c.prazo_dias != null && c.prazo_dias > 0 ? c.prazo_dias : "",
          obs
        );
      }
    }
    const dRow = ws.addRow(cells);
    for (let j = 0; j < proposalKeys.length; j++) {
      const base = fixedCount + j * perProp + 1;
      dRow.getCell(base).numFmt = NUMFMT_BRL;
      dRow.getCell(base + 1).numFmt = NUMFMT_BRL;
    }
    const rw = rowWinners[ri] || { priceKeys: [], prazoKeys: [] };
    for (const pk of rw.priceKeys) {
      const j = proposalKeys.indexOf(pk);
      if (j < 0) continue;
      const col = fixedCount + j * perProp + 1;
      applySupplierFill(dRow.getCell(col), colorMap[pk]);
    }
    for (const pk of rw.prazoKeys) {
      const j = proposalKeys.indexOf(pk);
      if (j < 0) continue;
      const col = fixedCount + j * perProp + 3;
      applySupplierFill(dRow.getCell(col), colorMap[pk]);
    }
  }

  const totalCols = fixedCount + proposalKeys.length * perProp;
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: totalCols },
  };
}

/**
 * @param {import('exceljs').Worksheet} ws
 * @param {string} campoLabel — coluna A
 * @param {string|number} valor — coluna B
 */
function setMetadataValorByCampo(ws, campoLabel, valor) {
  ws.eachRow((row) => {
    const a = row.getCell(1).value;
    if (a === campoLabel) {
      row.getCell(2).value = valor;
    }
  });
}

/** Alias legado (Resumo) — mesma semântica na aba de metadados (Itens por fornecedor) */
function setResumoValorByCampo(ws, campoLabel, valor) {
  return setMetadataValorByCampo(ws, campoLabel, valor);
}

/**
 * @param {import('exceljs').Worksheet} ws
 */
function upsertResumoRow(ws, campoLabel, valor) {
  let found = false;
  ws.eachRow((row) => {
    const a = row.getCell(1).value;
    if (a === campoLabel) {
      row.getCell(2).value = valor;
      found = true;
    }
  });
  if (!found) {
    ws.addRow([campoLabel, valor]);
  }
}

function buildMetricsStagesLine(st) {
  if (!st) return "—";
  const sem = st.semantic != null ? `${st.semantic}` : "—";
  return `parse=${st.parse ?? "—"}ms; consolidação=${st.consolidate ?? "—"}ms; semântico=${sem}ms; ranking=${st.rank ?? "—"}ms; openai=${st.openai ?? "—"}ms; revisão=${st.review_build ?? "—"}ms; export=${st.export ?? "—"}ms`;
}

/**
 * @param {object} opts
 * @returns {Promise<{ exportMs: number, metrics_summary: object, export_generated_at: string, export_last_updated_at: string }>}
 */
async function exportBatchWorkbook(opts) {
  const tExportStart = Date.now();
  const {
    batchId: _batchId,
    createdAt: _createdAt,
    decision_status: _decision_status,
    metrics_summary,
    parsedFiles,
    consolidated,
    comparison_result: _comparison_result,
    inconsistencies: _inconsistencies,
    analytic_summary: _analytic_summary,
    allQuotes,
    review_summary: _review_summary,
    filePath,
    batchStartMs,
    artifactMeta = {},
    semantic_match_notes: _semantic_match_notes,
  } = opts;

  const proposalKeysOrdered =
    consolidated && Array.isArray(consolidated.proposal_keys) && consolidated.proposal_keys.length
      ? consolidated.proposal_keys
      : [...new Set((allQuotes || []).map((q) => q.proposal_key))];

  let scores = {};
  let rowWinners = [];
  if (consolidated?.rows?.length && proposalKeysOrdered.length) {
    const cw = computeRowWins(consolidated);
    scores = cw.scores;
    rowWinners = cw.rowWinners;
  } else {
    for (const k of proposalKeysOrdered) scores[k] = 0;
  }
  const colorMap = buildProposalColorMap(proposalKeysOrdered, scores);

  const wb = new ExcelJS.Workbook();
  wb.creator = "compras-dream-export-v2";
  wb.created = new Date();

  addPorFornecedorWorksheet(wb, {
    allQuotes,
    proposalKeysOrdered,
    colorMap,
    consolidated,
    parsedFiles,
  });

  addComparacaoWorksheet(wb, {
    consolidated,
    allQuotes,
    colorMap,
    rowWinners,
  });

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const exportMs = Date.now() - tExportStart;
  const batchStart = batchStartMs != null ? batchStartMs : tExportStart;
  const executionTime = `${((Date.now() - batchStart) / 1000).toFixed(2)}s`;
  const mergedMetrics = {
    ...metrics_summary,
    executionTime,
    execution_seconds: parseExecutionSeconds(executionTime),
    stage_timings_ms: {
      ...(metrics_summary && metrics_summary.stage_timings_ms ? metrics_summary.stage_timings_ms : {}),
      export: exportMs,
    },
  };
  const nowIso = new Date().toISOString();
  const genAt = artifactMeta.export_generated_at != null ? String(artifactMeta.export_generated_at) : nowIso;
  const updAt = artifactMeta.export_last_updated_at != null ? String(artifactMeta.export_last_updated_at) : nowIso;

  await wb.xlsx.writeFile(filePath);

  return {
    exportMs,
    metrics_summary: mergedMetrics,
    export_generated_at: genAt,
    export_last_updated_at: updAt,
  };
}

/**
 * Atualiza campos de decisão/export (colunas A/B) na aba Itens por fornecedor — insere linhas se ainda não existirem.
 */
async function patchBatchWorkbookMetadata(filePath, patch) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(SHEETS.POR_FORNECEDOR);
  if (!ws) {
    throw new Error("aba Itens por fornecedor não encontrada");
  }
  const p = patch || {};
  if (p.decision_status != null) upsertResumoRow(ws, "decision_status", String(p.decision_status));
  if (p.decided_by != null) upsertResumoRow(ws, "decided_by", String(p.decided_by));
  if (p.decided_at != null) upsertResumoRow(ws, "decided_at", String(p.decided_at));
  if (p.decision_reason != null) upsertResumoRow(ws, "decision_reason", String(p.decision_reason));
  if (p.export_last_updated_at != null) {
    upsertResumoRow(ws, "export_last_updated_at", String(p.export_last_updated_at));
  }
  await wb.xlsx.writeFile(filePath);
}

async function exportBatchWorkbookFromSnapshot(snapshot, filePath, extra = {}) {
  if (!snapshot || !snapshot.batch_id) {
    throw new Error("snapshot inválido");
  }
  const metrics = snapshot.metrics_summary || {};
  return exportBatchWorkbook({
    batchId: snapshot.batch_id,
    createdAt: snapshot.created_at,
    decision_status: snapshot.decision_status,
    metrics_summary: metrics,
    parsedFiles: snapshot.parsed_files || [],
    consolidated: snapshot.consolidated,
    comparison_result: snapshot.comparison_result,
    inconsistencies: snapshot.inconsistencies || [],
    analytic_summary: snapshot.analytic_summary,
    allQuotes: snapshot.allQuotes || [],
    review_summary: snapshot.review_summary,
    semantic_match_notes: snapshot.semantic_match_notes || {},
    filePath,
    batchStartMs: extra.batchStartMs != null ? extra.batchStartMs : Date.now(),
    artifactMeta: {
      decided_by: extra.artifactMeta?.decided_by,
      decided_at: extra.artifactMeta?.decided_at,
      decision_reason: extra.artifactMeta?.decision_reason,
      export_generated_at: extra.artifactMeta?.export_generated_at,
      export_last_updated_at: extra.artifactMeta?.export_last_updated_at ?? new Date().toISOString(),
    },
  });
}

module.exports = {
  exportBatchWorkbook,
  patchBatchWorkbookMetadata,
  exportBatchWorkbookFromSnapshot,
  setResumoValorByCampo,
  setMetadataValorByCampo,
  upsertResumoRow,
  buildMetricsStagesLine,
};
