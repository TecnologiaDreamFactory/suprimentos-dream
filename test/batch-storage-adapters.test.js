/**
 * Adapters batch: storage (histórico/snapshot/export), rate limit, factory e fallback de provider.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const batchHistoryStore = require("../rfq/batch/batchHistoryStore");
const batchSnapshotStore = require("../rfq/batch/batchSnapshotStore");
const {
  resetBatchStorageFactoriesForTests,
  setLocalHistoryDirForTests,
  setLocalSnapshotDirForTests,
  setLocalExportDirForTests,
  getBatchExportStore,
  resolveExportLocalDir,
} = require("../rfq/batch/storage/batchStorageFactory");
const { getBatchStorageProvider } = require("../rfq/batch/config/batchInfraConfig");
const { LocalBatchHistoryAdapter } = require("../rfq/batch/storage/localBatchHistoryAdapter");
const { LocalBatchExportAdapter } = require("../rfq/batch/storage/localBatchExportAdapter");
const { ObjectBatchExportAdapter } = require("../rfq/batch/storage/objectBatchExportAdapter");
const { MemoryRateLimitStore } = require("../rfq/batch/middleware/memoryRateLimitStore");
const { createRateLimiter } = require("../rfq/batch/middleware/rateLimit");

describe("batch storage factory — local history + snapshot", () => {
  let hist;
  let snap;

  beforeEach(() => {
    hist = fs.mkdtempSync(path.join(os.tmpdir(), "batch-hist-"));
    snap = fs.mkdtempSync(path.join(os.tmpdir(), "batch-snap-"));
    setLocalHistoryDirForTests(hist);
    setLocalSnapshotDirForTests(snap);
  });

  afterEach(() => {
    setLocalHistoryDirForTests(null);
    setLocalSnapshotDirForTests(null);
    resetBatchStorageFactoriesForTests();
    try {
      fs.rmSync(hist, { recursive: true, force: true });
      fs.rmSync(snap, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("saveBatchRecord e loadBatchRecord via facade", () => {
    const id = "B-adapt-01-abc";
    batchHistoryStore.saveBatchRecord({
      batch_id: id,
      created_at: new Date().toISOString(),
      decision_status: "processed",
      request_summary: {},
      review_summary: {},
      comparison_result_summary: {},
      export_filename: "batch-f.xlsx",
      export_path: "batch-f.xlsx",
      metrics_summary: {},
      audit_log: [],
    });
    const rec = batchHistoryStore.loadBatchRecord(id);
    assert.strictEqual(rec.batch_id, id);
    assert.strictEqual(rec.export_provider, "local");
  });

  it("snapshot save/load via facade", () => {
    const id = "B-adapt-02-def";
    const snapObj = batchSnapshotStore.buildSnapshotFromCompareResult({
      batch_id: id,
      batch_api_version: 1,
      created_at: new Date().toISOString(),
      decision_status: "processed",
      metrics_summary: {},
      parsed_files: [],
      consolidated: {},
      comparison_result: {},
      inconsistencies: [],
      analytic_summary: {},
      allQuotes: [],
      review_summary: {},
      warnings: [],
    });
    batchSnapshotStore.saveSnapshot(id, snapObj);
    const loaded = batchSnapshotStore.loadSnapshot(id);
    assert.strictEqual(loaded.batch_id, id);
  });
});

describe("batch export adapter — metadata", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "batch-exp-"));
    setLocalExportDirForTests(dir);
    resetBatchStorageFactoriesForTests();
  });

  afterEach(() => {
    setLocalExportDirForTests(null);
    resetBatchStorageFactoriesForTests();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("LocalBatchExportAdapter retorna export_provider local e tamanho", () => {
    const name = "batch-testfile.xlsx";
    fs.writeFileSync(path.join(dir, name), "xlsx-bytes", "utf8");
    const a = new LocalBatchExportAdapter({ getLocalDirectory: () => dir });
    const m = a.getMetadataForFile(name);
    assert.strictEqual(m.export_provider, "local");
    assert.strictEqual(m.export_size_bytes, Buffer.byteLength("xlsx-bytes", "utf8"));
    assert.strictEqual(m.export_uri, null);
  });

  it("ObjectBatchExportAdapter expõe URI lógica e provider object", () => {
    process.env.BATCH_OBJECT_BUCKET = "my-bucket";
    process.env.BATCH_OBJECT_PREFIX = "exports/";
    const name = "batch-obj.xlsx";
    fs.writeFileSync(path.join(dir, name), "ok", "utf8");
    const a = new ObjectBatchExportAdapter({ getLocalDirectory: () => dir });
    const m = a.getMetadataForFile(name);
    assert.strictEqual(m.export_provider, "object");
    assert.ok(m.export_uri.startsWith("s3://my-bucket/"));
    assert.ok(m.export_uri.includes("batch-obj.xlsx"));
    delete process.env.BATCH_OBJECT_BUCKET;
    delete process.env.BATCH_OBJECT_PREFIX;
  });

  it("getBatchExportStore usa object quando BATCH_STORAGE_PROVIDER=object", () => {
    const prev = process.env.BATCH_STORAGE_PROVIDER;
    process.env.BATCH_STORAGE_PROVIDER = "object";
    process.env.BATCH_OBJECT_BUCKET = "b";
    resetBatchStorageFactoriesForTests();
    const name = "batch-p.xlsx";
    fs.writeFileSync(path.join(dir, name), "d", "utf8");
    const m = getBatchExportStore().getMetadataForFile(name);
    assert.strictEqual(m.export_provider, "object");
    assert.ok(String(m.export_uri).startsWith("s3://"));
    process.env.BATCH_STORAGE_PROVIDER = prev;
    delete process.env.BATCH_OBJECT_BUCKET;
    resetBatchStorageFactoriesForTests();
  });
});

describe("batchInfraConfig — fallback de provider", () => {
  const orig = process.env.BATCH_STORAGE_PROVIDER;

  afterEach(() => {
    if (orig === undefined) delete process.env.BATCH_STORAGE_PROVIDER;
    else process.env.BATCH_STORAGE_PROVIDER = orig;
  });

  it("valor inválido volta para local", () => {
    process.env.BATCH_STORAGE_PROVIDER = "unknown-backend";
    assert.strictEqual(getBatchStorageProvider(), "local");
  });
});

describe("rate limit store", () => {
  it("MemoryRateLimitStore aplica limite", () => {
    const s = new MemoryRateLimitStore();
    const w = 60000;
    const max = 2;
    assert.strictEqual(s.consume("k1", w, max).allowed, true);
    assert.strictEqual(s.consume("k1", w, max).allowed, true);
    assert.strictEqual(s.consume("k1", w, max).allowed, false);
  });

  it("createRateLimiter usa namespace para isolar chaves", () => {
    const lim = createRateLimiter({ namespace: "a", windowMs: 60000, max: 1 });
    const lim2 = createRateLimiter({ namespace: "b", windowMs: 60000, max: 1 });
    const calls = [];
    const req = { headers: {}, socket: { remoteAddress: "1.1.1.1" }, correlationId: "x" };
    const res = {
      setHeader() {},
      status() {
        return this;
      },
      json() {},
    };
    lim(req, res, () => calls.push("a1"));
    lim2(req, res, () => calls.push("b1"));
    assert.deepStrictEqual(calls, ["a1", "b1"]);
  });
});

describe("LocalBatchHistoryAdapter — contrato mínimo", () => {
  it("instância com getBaseDir grava JSON", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "batch-lh-"));
    try {
      const a = new LocalBatchHistoryAdapter({
        getBaseDir: () => d,
      });
      const id = "B-contract-99";
      a.saveBatchRecord({
        batch_id: id,
        created_at: new Date().toISOString(),
        decision_status: "processed",
        request_summary: {},
        review_summary: {},
        comparison_result_summary: {},
        export_filename: "f.xlsx",
        metrics_summary: {},
        audit_log: [],
      });
      const r = a.loadBatchRecord(id);
      assert.strictEqual(r.export_uri, null);
      assert.strictEqual(r.export_provider, "local");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("resolveExportLocalDir", () => {
  it("aponta para tmpdir padrão", () => {
    const r = resolveExportLocalDir();
    assert.ok(r.includes("compras-dream-batch-exports"));
  });
});
