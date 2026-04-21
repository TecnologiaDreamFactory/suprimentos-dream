/**
 * Endurecimento workflow batch: export único, snapshot, histórico atômico, decisão → XLSX, regeneração.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ExcelJS = require("exceljs");

const { runCompareBatch } = require("../rfq/batch/compareBatch");
const { writeJsonAtomic, readJsonSafe } = require("../rfq/batch/jsonFileUtils");
const batchHistoryStore = require("../rfq/batch/batchHistoryStore");
const batchSnapshotStore = require("../rfq/batch/batchSnapshotStore");
const batchArtifactService = require("../rfq/batch/batchArtifactService");
const { DECISION_STATUS } = require("../rfq/batch/batchDecision");
const { SHEETS } = require("../rfq/batch/xlsxSchema");
const XLSX = require("xlsx");

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-wf-"));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
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

function resumoValor(ws, campo) {
  let v;
  ws.eachRow((row) => {
    if (row.getCell(1).value === campo) v = row.getCell(2).value;
  });
  return v;
}

describe("compareBatch: export único", () => {
  it("apenas uma chamada await exportBatchWorkbook no pipeline", () => {
    const src = fs.readFileSync(path.join(__dirname, "../rfq/batch/compareBatch.js"), "utf8");
    const n = (src.match(/await exportBatchWorkbook\(/g) || []).length;
    assert.strictEqual(n, 1);
  });
});

describe("jsonFileUtils", () => {
  it("escrita atômica e leitura segura", () => {
    const fp = path.join(tmpRoot, "atomic.json");
    writeJsonAtomic(fp, { x: 42 });
    const r = readJsonSafe(fp);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.x, 42);
  });

  it("arquivo inexistente ou JSON inválido", () => {
    assert.strictEqual(readJsonSafe(path.join(tmpRoot, "nope.json")).error, "missing_file");
    const bad = path.join(tmpRoot, "bad.json");
    fs.writeFileSync(bad, "{not json", "utf8");
    const r = readJsonSafe(bad);
    assert.strictEqual(r.ok, false);
    assert.ok(String(r.error).includes("invalid_json"));
  });
});

describe("decisão manual → histórico + XLSX", () => {
  it("approved atualiza JSON e XLSX", async () => {
    const exportDir = path.join(tmpRoot, "exp-a");
    const histDir = path.join(tmpRoot, "hist-a");
    const snapDir = path.join(tmpRoot, "snap-a");
    fs.mkdirSync(exportDir, { recursive: true });
    batchHistoryStore.setHistoryDirForTests(histDir);
    batchSnapshotStore.setSnapshotDirForTests(snapDir);

    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const out = await runCompareBatch({
      files: [
        { buffer: xlsxBuffer([header, ["A", 1, "UN", "10,00", "10,00"]]), originalname: "a.xlsx" },
        { buffer: xlsxBuffer([header, ["A", 1, "UN", "11,00", "11,00"]]), originalname: "b.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: exportDir },
    });
    assert.strictEqual(out.status, "success");
    const xlsxPath = path.join(exportDir, out.export_filename);
    assert.ok(fs.existsSync(xlsxPath));

    const snap = batchSnapshotStore.buildSnapshotFromCompareResult(out);
    batchSnapshotStore.saveSnapshot(out.batch_id, snap, snapDir);
    batchHistoryStore.saveBatchRecord(
      {
        batch_id: out.batch_id,
        created_at: out.created_at,
        request_summary: { files_received: 2, file_names: ["a.xlsx", "b.xlsx"] },
        review_summary: out.review_summary,
        comparison_result_summary: out.comparison_result_summary,
        export_filename: out.export_filename,
        export_path: out.export_filename,
        export_generated_at: out.export_generated_at,
        export_last_updated_at: out.export_last_updated_at,
        snapshot_relative_path: `${out.batch_id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`,
        decision_status: out.decision_status,
        metrics_summary: out.metrics_summary,
        audit_log: [],
      },
      histDir
    );

    const d = batchHistoryStore.applyDecision(
      out.batch_id,
      { status: "approved", reason: "Conferido", decided_by: "buyer@corp.com" },
      histDir
    );
    assert.strictEqual(d.ok, true);
    const art = await batchArtifactService.applyDecisionToExport(exportDir, d.record, d.audit, {
      historyDir: histDir,
    });
    assert.strictEqual(art.ok, true);

    const loaded = batchHistoryStore.loadBatchRecord(out.batch_id, histDir);
    assert.strictEqual(loaded.decision_status, DECISION_STATUS.APPROVED);
    assert.ok(loaded.export_last_updated_at);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    const ws = wb.getWorksheet(SHEETS.POR_FORNECEDOR);
    assert.strictEqual(String(resumoValor(ws, "decision_status")), DECISION_STATUS.APPROVED);
    assert.strictEqual(resumoValor(ws, "decided_by"), "buyer@corp.com");
    assert.strictEqual(resumoValor(ws, "decision_reason"), "Conferido");
    assert.ok(resumoValor(ws, "decided_at"));

    batchHistoryStore.setHistoryDirForTests(null);
    batchSnapshotStore.setSnapshotDirForTests(null);
  });

  it("rejected atualiza JSON e XLSX", async () => {
    const exportDir = path.join(tmpRoot, "exp-r");
    const histDir = path.join(tmpRoot, "hist-r");
    const snapDir = path.join(tmpRoot, "snap-r");
    fs.mkdirSync(exportDir, { recursive: true });
    batchHistoryStore.setHistoryDirForTests(histDir);
    batchSnapshotStore.setSnapshotDirForTests(snapDir);

    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const out = await runCompareBatch({
      files: [
        { buffer: xlsxBuffer([header, ["A", 1, "UN", "10,00", "10,00"]]), originalname: "a.xlsx" },
        { buffer: xlsxBuffer([header, ["A", 1, "UN", "12,00", "12,00"]]), originalname: "b.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: exportDir },
    });
    const snap = batchSnapshotStore.buildSnapshotFromCompareResult(out);
    batchSnapshotStore.saveSnapshot(out.batch_id, snap, snapDir);
    batchHistoryStore.saveBatchRecord(
      {
        batch_id: out.batch_id,
        created_at: out.created_at,
        request_summary: {},
        review_summary: out.review_summary,
        comparison_result_summary: out.comparison_result_summary,
        export_filename: out.export_filename,
        export_generated_at: out.export_generated_at,
        export_last_updated_at: out.export_last_updated_at,
        decision_status: out.decision_status,
        metrics_summary: out.metrics_summary,
        audit_log: [],
      },
      histDir
    );

    const d = batchHistoryStore.applyDecision(
      out.batch_id,
      { status: "rejected", reason: "Preços altos", decided_by: "cfo@corp.com" },
      histDir
    );
    await batchArtifactService.applyDecisionToExport(exportDir, d.record, d.audit, { historyDir: histDir });

    const xlsxPath = path.join(exportDir, out.export_filename);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    const ws = wb.getWorksheet(SHEETS.POR_FORNECEDOR);
    assert.strictEqual(String(resumoValor(ws, "decision_status")), DECISION_STATUS.REJECTED);
    assert.strictEqual(resumoValor(ws, "decision_reason"), "Preços altos");

    batchHistoryStore.setHistoryDirForTests(null);
    batchSnapshotStore.setSnapshotDirForTests(null);
  });

  it("XLSX ausente: decisão persiste e registra aviso", async () => {
    const exportDir = path.join(tmpRoot, "exp-miss");
    const histDir = path.join(tmpRoot, "hist-miss");
    fs.mkdirSync(exportDir, { recursive: true });
    batchHistoryStore.setHistoryDirForTests(histDir);

    const batch_id = "B-missing-aaaaaaaa";
    batchHistoryStore.saveBatchRecord(
      {
        batch_id,
        created_at: new Date().toISOString(),
        request_summary: {},
        review_summary: {},
        comparison_result_summary: {},
        export_filename: "batch-B-missing-aaaaaaaa.xlsx",
        decision_status: DECISION_STATUS.PROCESSED,
        metrics_summary: {},
        audit_log: [],
      },
      histDir
    );

    const d = batchHistoryStore.applyDecision(
      batch_id,
      { status: "approved", reason: "x", decided_by: "y" },
      histDir
    );
    const art = await batchArtifactService.applyDecisionToExport(exportDir, d.record, d.audit, {
      historyDir: histDir,
    });
    assert.strictEqual(art.ok, false);
    assert.strictEqual(art.reason, "missing_file");

    const rec = batchHistoryStore.loadBatchRecord(batch_id, histDir);
    assert.ok(Array.isArray(rec.artifact_warnings));
    assert.ok(rec.artifact_warnings.some((w) => w.type === "export_missing_on_decision"));

    batchHistoryStore.setHistoryDirForTests(null);
  });
});

describe("regenerateExport", () => {
  it("regera XLSX a partir do snapshot", async () => {
    const exportDir = path.join(tmpRoot, "exp-reg");
    const histDir = path.join(tmpRoot, "hist-reg");
    const snapDir = path.join(tmpRoot, "snap-reg");
    fs.mkdirSync(exportDir, { recursive: true });
    batchHistoryStore.setHistoryDirForTests(histDir);
    batchSnapshotStore.setSnapshotDirForTests(snapDir);

    const header = ["Produto", "Qtd", "UN", "Preço Unit", "Total"];
    const out = await runCompareBatch({
      files: [
        { buffer: xlsxBuffer([header, ["A", 1, "UN", "10,00", "10,00"]]), originalname: "a.xlsx" },
        { buffer: xlsxBuffer([header, ["A", 1, "UN", "11,00", "11,00"]]), originalname: "b.xlsx" },
      ],
      options: { skipOpenAI: true, tempDir: exportDir },
    });
    const snap = batchSnapshotStore.buildSnapshotFromCompareResult(out);
    batchSnapshotStore.saveSnapshot(out.batch_id, snap, snapDir);
    batchHistoryStore.saveBatchRecord(
      {
        batch_id: out.batch_id,
        created_at: out.created_at,
        request_summary: {},
        review_summary: out.review_summary,
        comparison_result_summary: out.comparison_result_summary,
        export_filename: out.export_filename,
        export_generated_at: out.export_generated_at,
        export_last_updated_at: out.export_last_updated_at,
        decision_status: out.decision_status,
        metrics_summary: out.metrics_summary,
        audit_log: [],
      },
      histDir
    );

    const outReg = await batchArtifactService.regenerateExport(exportDir, out.batch_id, histDir, snapDir);
    assert.strictEqual(outReg.ok, true);
    const fp = path.join(exportDir, out.export_filename);
    assert.ok(fs.existsSync(fp));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fp);
    assert.ok(wb.getWorksheet(SHEETS.POR_FORNECEDOR));
    assert.ok(wb.getWorksheet(SHEETS.COMPARACAO));

    batchHistoryStore.setHistoryDirForTests(null);
    batchSnapshotStore.setSnapshotDirForTests(null);
  });
});
