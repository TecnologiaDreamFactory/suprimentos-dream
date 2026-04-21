/**
 * Endurecimento batch: item_key, cleanup, download token, debug, schema XLSX.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

const {
  buildItemKey,
  normalizeItemKeyDescription,
  detectItemKeyCollisions,
} = require("../rfq/batch/itemKey");
const { cleanupBatchExports } = require("../rfq/batch/batchExportCleanup");
const {
  validateDownloadToken,
  registerDownloadToken,
  consumeDownloadToken,
} = require("../rfq/batch/batchDownloadStore");
const { shapeCompareBatchResponse } = require("../rfq/batch/batchResponse");
const { runCompareBatch } = require("../rfq/batch/compareBatch");
const { SHEETS, SHEET_ORDER, POR_FORNECEDOR_COLUMNS } = require("../rfq/batch/xlsxSchema");

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "batch-harden-"));
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function xlsxBuffer(rows, sheetName = "ITENS_COTACAO") {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("item_key", () => {
  it("sem qtd/unidade/ref reduz à descrição (compatível com legado)", () => {
    const k = buildItemKey({ descricao: "Parafuso 10mm", quantidade: 0, unidade: "" });
    assert.strictEqual(k, normalizeItemKeyDescription("Parafuso 10mm"));
  });

  it("inclui qtd e unidade quando existem", () => {
    const k = buildItemKey({ descricao: "Item", quantidade: 2, unidade: "UN" });
    assert.ok(k.includes("q:2"));
    assert.ok(k.includes("u:un"));
  });

  it("detecta colisão quando mesma chave com fingerprints distintos", () => {
    const quotes = [
      {
        proposal_key: "a",
        proposal_label: "a",
        items: [
          {
            item_key: "dup",
            descricao: "Alpha",
            quantidade: 1,
            unidade: "UN",
            preco_unitario: 1,
            total: 1,
          },
        ],
      },
      {
        proposal_key: "b",
        proposal_label: "b",
        items: [
          {
            item_key: "dup",
            descricao: "Beta",
            quantidade: 1,
            unidade: "UN",
            preco_unitario: 1,
            total: 1,
          },
        ],
      },
    ];
    const { warnings, collision_details } = detectItemKeyCollisions(quotes);
    assert.ok(warnings.length >= 1);
    assert.ok(collision_details.length >= 1);
  });
});

describe("cleanupBatchExports", () => {
  it("remove arquivos com idade acima do TTL", () => {
    const oldName = "batch-test-oldfile.xlsx";
    const fp = path.join(tmpDir, oldName);
    fs.writeFileSync(fp, "x");
    const past = Date.now() - 86400000 * 3;
    fs.utimesSync(fp, new Date(past), new Date(past));
    const n = cleanupBatchExports(tmpDir, 86400000);
    assert.ok(n >= 1);
    assert.ok(!fs.existsSync(fp));
  });
});

describe("batchDownloadStore", () => {
  it("token inválido para arquivo não confere", () => {
    const t = registerDownloadToken("batch-a.xlsx");
    const v = validateDownloadToken("batch-b.xlsx", t);
    assert.strictEqual(v.ok, false);
  });

  it("mesmo token pode validar várias vezes até consume explícito", () => {
    const t = registerDownloadToken("batch-reuse.xlsx");
    assert.strictEqual(validateDownloadToken("batch-reuse.xlsx", t).ok, true);
    assert.strictEqual(validateDownloadToken("batch-reuse.xlsx", t).ok, true);
    consumeDownloadToken(t);
    assert.strictEqual(validateDownloadToken("batch-reuse.xlsx", t).ok, false);
  });
});

describe("shapeCompareBatchResponse", () => {
  it("debug off remove parsed_files e consolidated", () => {
    const full = {
      status: "success",
      backend: "pipeline-batch",
      batch_api_version: "2.4.0",
      batch_id: "x",
      files_received: 2,
      files_parsed: 2,
      quotes_extracted: 2,
      analysis_source: "deterministic",
      manual_review_required: false,
      review_summary: {
        manual_review_required: false,
        blocking_issue_count: 0,
        error_issue_count: 0,
        warning_issue_count: 1,
        info_issue_count: 0,
        top_review_reasons: [],
        affected_suppliers: [],
        affected_files: [],
        priority_queue: [],
        recommended_actions: [],
      },
      comparison_result: { ranking: [] },
      ai_comparison_feedback: {
        requested: true,
        status: "ok",
        user_message: "ok",
        analytic_summary_ok: true,
        semantic_match_note: null,
      },
      warnings: [],
      inconsistencies: [{ code: "X", severity: "warning" }],
      parsed_files: [{ foo: 1 }],
      consolidated: { rows: [] },
      downloadUrl: "http://x/u",
      export_filename: "f.xlsx",
      download_token: "tok",
      executionTime: "1s",
      collision_details: [],
    };
    const slim = shapeCompareBatchResponse(full, false);
    assert.strictEqual(slim.parsed_files, undefined);
    assert.strictEqual(slim.consolidated, undefined);
    assert.strictEqual(slim.inconsistency_count, 1);
    assert.ok("inconsistency_codes_sample" in slim);
    assert.deepStrictEqual(slim.ai_comparison_feedback, full.ai_comparison_feedback);
  });

  it("debug on mantém payload completo", () => {
    const full = {
      status: "success",
      parsed_files: [1],
      consolidated: {},
    };
    const out = shapeCompareBatchResponse(full, true);
    assert.deepStrictEqual(out, full);
  });
});

describe("runCompareBatch + XLSX schema", () => {
  it("abas e headers conforme xlsxSchema (ordem SHEET_ORDER)", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const b1 = xlsxBuffer([header, ["Alpha", 1, "UN", "10,00", "10,00"]]);
    const b2 = xlsxBuffer([header, ["Alpha", 1, "UN", "12,00", "12,00"]]);
    const out = await runCompareBatch({
      files: [
        { buffer: b1, originalname: "s1.xlsx" },
        { buffer: b2, originalname: "s2.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir },
    });
    assert.strictEqual(out.status, "success");
    const fp = path.join(tmpDir, out.export_filename);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fp);
    assert.strictEqual(wb.worksheets.length, SHEET_ORDER.length);
    for (let i = 0; i < SHEET_ORDER.length; i++) {
      assert.strictEqual(wb.worksheets[i].name, SHEET_ORDER[i]);
    }

    assert.strictEqual(wb.worksheets[0].name, SHEETS.POR_FORNECEDOR);

    const wsPor = wb.getWorksheet(SHEETS.POR_FORNECEDOR);
    assert.ok(wsPor, "aba Itens por fornecedor");
    let foundSupplierTitle = false;
    wsPor.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === "string" && v.startsWith("Fornecedor:")) foundSupplierTitle = true;
    });
    assert.ok(foundSupplierTitle, "bloco com título Fornecedor:");
    let foundArquivoHeader = false;
    let foundDescHeader = false;
    wsPor.eachRow((row) => {
      if (row.getCell(1).value === POR_FORNECEDOR_COLUMNS[0].header) foundArquivoHeader = true;
      if (row.getCell(2).value === POR_FORNECEDOR_COLUMNS[1].header) foundDescHeader = true;
    });
    assert.ok(foundArquivoHeader, "cabeçalho Arquivo de origem");
    assert.ok(foundDescHeader, "cabeçalho Descrição do item");
    let dataRows = 0;
    wsPor.eachRow((row, rowNumber) => {
      if (rowNumber < 4) return;
      const a = row.getCell(1).value;
      const b = row.getCell(2).value;
      if (a === POR_FORNECEDOR_COLUMNS[0].header) return;
      if (typeof a === "string" && (a.startsWith("Fornecedor:") || a.startsWith("Arquivo:"))) return;
      if (b != null && String(b).trim() !== "") dataRows += 1;
    });
    assert.ok(dataRows >= 1, "pelo menos uma linha de item na aba Itens por fornecedor");
  });

  it("formatação: preço unit. com numFmt BRL na aba Itens por fornecedor", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const b1 = xlsxBuffer([header, ["Z", 1, "UN", "5,00", "5,00"]]);
    const b2 = xlsxBuffer([header, ["Z", 1, "UN", "5,50", "5,50"]]);
    const out = await runCompareBatch({
      files: [
        { buffer: b1, originalname: "a.xlsx" },
        { buffer: b2, originalname: "b.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir },
    });
    const fp = path.join(tmpDir, out.export_filename);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fp);
    const ws = wb.getWorksheet(SHEETS.POR_FORNECEDOR);
    let foundBrl = false;
    ws.eachRow((row) => {
      const c4 = row.getCell(4);
      if (c4.numFmt && String(c4.numFmt).includes("R$")) foundBrl = true;
    });
    assert.ok(foundBrl);
  });
});
