/**
 * Testes do fluxo de comparação em lote (batch).
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const { runCompareBatch } = require("../rfq/batch/compareBatch");
const { validateFileCount, validateMinQuotes } = require("../rfq/batch/validateBatch");
const { BATCH_ERROR_CODES } = require("../rfq/batch/batchTypes");
const { extractSupplierQuotes } = require("../rfq/batch/extractSupplierQuotes");
const { consolidateQuotes } = require("../rfq/batch/consolidateQuotes");
const { parseWithPipeline } = require("../rfq/pipeline");

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "batch-test-"));
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

describe("validateBatch", () => {
  it("rejeita menos de 2 arquivos", () => {
    const v = validateFileCount(1);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, BATCH_ERROR_CODES.FILE_COUNT);
  });

  it("rejeita mais de 10 arquivos", () => {
    const v = validateFileCount(11);
    assert.strictEqual(v.ok, false);
  });

  it("aceita 2 a 10", () => {
    assert.strictEqual(validateFileCount(2).ok, true);
    assert.strictEqual(validateFileCount(10).ok, true);
  });

  it("exige pelo menos 2 propostas", () => {
    const v = validateMinQuotes([]);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, BATCH_ERROR_CODES.MIN_QUOTES);
  });
});

describe("runCompareBatch", () => {
  it("2 arquivos válidos: sucesso, XLSX e downloadUrl", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const b1 = xlsxBuffer([
      header,
      ["Alpha", 1, "UN", "10,00", "10,00"],
    ]);
    const b2 = xlsxBuffer([
      header,
      ["Alpha", 1, "UN", "12,00", "12,00"],
    ]);

    const out = await runCompareBatch({
      files: [
        { buffer: b1, originalname: "a.xlsx" },
        { buffer: b2, originalname: "b.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir, publicDownloadPath: "/downloads" },
    });

    assert.strictEqual(out.status, "success");
    assert.strictEqual(out.backend, "pipeline-batch");
    assert.ok(out.batch_id);
    assert.ok(out.batch_api_version);
    assert.ok(out.review_summary);
    assert.ok(Array.isArray(out.review_summary.priority_queue));
    assert.strictEqual(out.files_received, 2);
    assert.strictEqual(out.files_parsed, 2);
    assert.ok(out.quotes_extracted >= 2);
    assert.ok(out.comparison_result?.ranking?.length >= 2);
    assert.ok(out.downloadUrl?.includes("/downloads/"));
    assert.ok(out.export_filename?.endsWith(".xlsx"));
    const fp = path.join(tmpDir, out.export_filename);
    assert.ok(fs.existsSync(fp), "arquivo exportado deve existir");
  });

  it("10 arquivos válidos", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const files = [];
    for (let i = 0; i < 10; i++) {
      files.push({
        buffer: xlsxBuffer([
          header,
          ["Item", 1, "UN", `${10 + i},00`, `${10 + i},00`],
        ]),
        originalname: `f${i}.xlsx`,
      });
    }
    const out = await runCompareBatch({
      files,
      options: { skipOpenAI: true, tempDir: tmpDir },
    });
    assert.strictEqual(out.status, "success");
    assert.strictEqual(out.files_received, 10);
  });

  it("1 arquivo: erro de negócio (contagem)", async () => {
    const out = await runCompareBatch({
      files: [{ buffer: xlsxBuffer([["A"], [1]]), originalname: "x.xlsx" }],
      options: { skipOpenAI: true, tempDir: tmpDir },
    });
    assert.strictEqual(out.status, "error");
    assert.strictEqual(out.code, BATCH_ERROR_CODES.FILE_COUNT);
  });

  it("11 arquivos: erro direto no runCompareBatch", async () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      buffer: xlsxBuffer([
        ["Produto", "Qtd", "UN", "Preço Unit", "Total"],
        ["I", 1, "UN", "1,00", "1,00"],
      ]),
      originalname: `n${i}.xlsx`,
    }));
    const out = await runCompareBatch({ files, options: { skipOpenAI: true, tempDir: tmpDir } });
    assert.strictEqual(out.status, "error");
    assert.strictEqual(out.code, BATCH_ERROR_CODES.FILE_COUNT);
  });

  it("arquivo com parse inválido: aparece em parsed_files e falha min quotes", async () => {
    const good = xlsxBuffer([
      ["Produto", "Qtd", "UN", "Preço Unit", "Total"],
      ["X", 1, "UN", "5,00", "5,00"],
    ]);
    const bad = Buffer.from("not a real xlsx");
    const out = await runCompareBatch({
      files: [
        { buffer: good, originalname: "ok.xlsx" },
        { buffer: bad, originalname: "bad.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir },
    });
    assert.ok(out.parsed_files?.some((p) => p.parse_ok === false));
    assert.strictEqual(out.status, "error");
    assert.strictEqual(out.code, BATCH_ERROR_CODES.MIN_QUOTES);
  });

  it("quotation_id distintos sem rfq compartilhado gera aviso de divergência", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const out = await runCompareBatch({
      files: [
        { buffer: xlsxBuffer([header, ["I", 1, "UN", "1,00", "1,00"]]), originalname: "p1.xlsx" },
        { buffer: xlsxBuffer([header, ["I", 1, "UN", "2,00", "2,00"]]), originalname: "p2.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir, sharedQuotationId: null },
    });
    assert.strictEqual(out.status, "success");
    const div = (out.inconsistencies || []).filter((i) => i.code === "QUOTATION_ID_DIVERGENT");
    assert.ok(div.length >= 1 || (out.warnings || []).some((w) => String(w).includes("quotation_id")));
  });

  it("item faltando em um fornecedor gera inconsistência", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const out = await runCompareBatch({
      files: [
        { buffer: xlsxBuffer([header, ["A", 1, "UN", "1,00", "1,00"]]), originalname: "onlyA.xlsx" },
        { buffer: xlsxBuffer([header, ["B", 1, "UN", "2,00", "2,00"]]), originalname: "onlyB.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir },
    });
    assert.strictEqual(out.status, "success");
    const miss = (out.inconsistencies || []).filter((i) => i.code === "ITEM_MISSING");
    assert.ok(miss.length >= 1);
  });

  it("fallback sem OpenAI (analysis_source deterministic)", async () => {
    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const out = await runCompareBatch({
      files: [
        { buffer: xlsxBuffer([header, ["I", 1, "UN", "1,00", "1,00"]]), originalname: "x.xlsx" },
        { buffer: xlsxBuffer([header, ["I", 1, "UN", "2,00", "2,00"]]), originalname: "y.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: tmpDir },
    });
    assert.strictEqual(out.status, "success");
    assert.strictEqual(out.analysis_source, "deterministic");
    assert.strictEqual(out.analytic_summary, null);
  });
});

describe("extract + consolidate", () => {
  it("duas propostas no mesmo arquivo (grouped) — extract gera 2 quotes", async () => {
    const aoa = [
      ["", "F1", "", "", "F2", "", ""],
      [
        "Produto",
        "Qtd",
        "Valor Unitário",
        "Valor Total",
        "Qtd",
        "Valor Unitário",
        "Valor Total",
      ],
      ["P", 2, 5, 10, 2, 6, 12],
    ];
    const buf = xlsxBuffer(aoa, "ITENS_COTACAO");
    const pr = await parseWithPipeline(buf, "G-1", "src", { skipOpenAI: true });
    const ex = extractSupplierQuotes(pr, { source_filename: "g.xlsx", file_index: 0 });
    assert.strictEqual(ex.ok, true);
    assert.ok(ex.quotes.length >= 2);
    const cons = consolidateQuotes(ex.quotes);
    assert.ok(cons.rows.length >= 1);
  });
});
