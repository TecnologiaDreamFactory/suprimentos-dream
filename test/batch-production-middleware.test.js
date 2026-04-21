/**
 * Prontidão produção batch: auth, rate limit, correlação, logs, readiness, retenção.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const { requireBatchApiKey, getExpectedKey } = require("../rfq/batch/middleware/apiKeyAuth");
const { createRateLimiter } = require("../rfq/batch/middleware/rateLimit");
const { correlationMiddleware } = require("../rfq/batch/middleware/requestCorrelation");
const { logBatchEvent } = require("../rfq/batch/batchStructuredLog");
const { getReadiness } = require("../rfq/batch/batchReadiness");
const { cleanupOldSnapshots } = require("../rfq/batch/batchRetentionCleanup");
const batchHistoryStore = require("../rfq/batch/batchHistoryStore");

let tmpDir;
let prevApiKey;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "batch-prod-"));
  prevApiKey = process.env.BATCH_API_KEY;
});

after(() => {
  process.env.BATCH_API_KEY = prevApiKey;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function mockRes() {
  const r = {
    statusCode: 200,
    headers: {},
    body: null,
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
  return r;
}

describe("apiKeyAuth", () => {
  it("sem BATCH_API_KEY: libera (dev local)", () => {
    delete process.env.BATCH_API_KEY;
    assert.strictEqual(getExpectedKey(), null);
    const req = { headers: {} };
    const res = mockRes();
    let n = false;
    requireBatchApiKey(req, res, () => {
      n = true;
    });
    assert.strictEqual(n, true);
  });

  it("com BATCH_API_KEY: bloqueia sem credencial", () => {
    process.env.BATCH_API_KEY = "secret-prod-key";
    const req = { headers: {}, correlationId: "rid-1" };
    const res = mockRes();
    let n = false;
    requireBatchApiKey(req, res, () => {
      n = true;
    });
    assert.strictEqual(n, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, "UNAUTHORIZED");
    assert.strictEqual(res.body.request_id, "rid-1");
  });

  it("com BATCH_API_KEY: aceita X-API-Key válido", () => {
    process.env.BATCH_API_KEY = "secret-prod-key";
    const req = { headers: { "x-api-key": "secret-prod-key" }, correlationId: "r2" };
    const res = mockRes();
    let n = false;
    requireBatchApiKey(req, res, () => {
      n = true;
    });
    assert.strictEqual(n, true);
  });
});

describe("rateLimit", () => {
  it("retorna 429 após exceder max", () => {
    const lim = createRateLimiter({ windowMs: 60000, max: 2, keyGenerator: () => "same" });
    const req = { correlationId: "rl-1", socket: { remoteAddress: "1.1.1.1" } };
    const r1 = mockRes();
    let n1 = false;
    lim(req, r1, () => {
      n1 = true;
    });
    assert.strictEqual(n1, true);
    const r2 = mockRes();
    let n2 = false;
    lim(req, r2, () => {
      n2 = true;
    });
    assert.strictEqual(n2, true);
    const r3 = mockRes();
    let n3 = false;
    lim(req, r3, () => {
      n3 = true;
    });
    assert.strictEqual(n3, false);
    assert.strictEqual(r3.statusCode, 429);
    assert.strictEqual(r3.body.code, "RATE_LIMIT_EXCEEDED");
  });
});

describe("correlationMiddleware", () => {
  it("define request_id e header", () => {
    const req = { headers: {} };
    const res = mockRes();
    correlationMiddleware(req, res, () => {});
    assert.ok(req.correlationId && req.correlationId.length > 8);
    assert.strictEqual(res.headers["X-Request-Id"], req.correlationId);
  });

  it("respeita X-Request-Id recebido", () => {
    const req = { headers: { "x-request-id": "client-trace-99" } };
    const res = mockRes();
    correlationMiddleware(req, res, () => {});
    assert.strictEqual(req.correlationId, "client-trace-99");
  });
});

describe("batchStructuredLog", () => {
  it("emite JSON em uma linha com campos esperados", () => {
    const lines = [];
    const orig = console.log;
    console.log = (s) => lines.push(s);
    try {
      logBatchEvent({
        event: "test_event",
        route: "/x",
        batch_id: "B-1-abc",
        status: "ok",
        request_id: "rid",
        execution_ms: 5,
        artifact: { ok: true, path: "/secret/path" },
      });
    } finally {
      console.log = orig;
    }
    assert.strictEqual(lines.length, 1);
    const o = JSON.parse(lines[0]);
    assert.strictEqual(o.event, "test_event");
    assert.strictEqual(o.service, "batch");
    assert.strictEqual(o.batch_id, "B-1-abc");
    assert.strictEqual(o.artifact.ok, true);
    assert.strictEqual(o.artifact.path, undefined);
  });
});

describe("getReadiness", () => {
  it("diretórios graváveis retornam ok", () => {
    const a = path.join(tmpDir, "exp");
    const b = path.join(tmpDir, "hist");
    const c = path.join(tmpDir, "snap");
    const r = getReadiness({ exportDir: a, historyDir: b, snapshotDir: c });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.checks.batch_export_dir, true);
  });
});

describe("cleanupOldSnapshots", () => {
  it("remove snapshot antigo e atualiza histórico se existir", () => {
    const snapDir = path.join(tmpDir, "snap-clean");
    const histDir = path.join(tmpDir, "hist-clean");
    fs.mkdirSync(snapDir, { recursive: true });
    fs.mkdirSync(histDir, { recursive: true });
    const bid = "B-9999999999999-abcdef12";
    const fp = path.join(snapDir, "test.json");
    fs.writeFileSync(
      fp,
      JSON.stringify({ batch_id: bid, x: 1 }),
      "utf8"
    );
    const past = Date.now() - 86400000 * 10;
    fs.utimesSync(fp, new Date(past), new Date(past));

    batchHistoryStore.saveBatchRecord(
      {
        batch_id: bid,
        created_at: new Date().toISOString(),
        request_summary: {},
        review_summary: {},
        comparison_result_summary: {},
        export_filename: "f.xlsx",
        decision_status: "processed",
        metrics_summary: {},
        audit_log: [],
      },
      histDir
    );

    const r = cleanupOldSnapshots(snapDir, 86400000, histDir);
    assert.ok(r.removed >= 1);
    assert.ok(!fs.existsSync(fp));
    const rec = batchHistoryStore.loadBatchRecord(bid, histDir);
    assert.ok(rec.snapshot_deleted_at);
    assert.ok(String(rec.retention_policy_applied || "").includes("snapshot_ttl"));
  });
});

describe("servidor: rotas protegidas e request_id", () => {
  it("GET /ready sem auth; GET histórico 401 sem key quando BATCH_API_KEY ativo", async () => {
    process.env.BATCH_API_KEY = "integration-key";
    process.env.BATCH_RATE_LIMIT_COMPARE_MAX = "9999";
    process.env.BATCH_RATE_LIMIT_MUTATE_MAX = "9999";
    delete require.cache[require.resolve("../server.js")];
    const { app } = require("../server.js");

    await new Promise((resolve, reject) => {
      const srv = app.listen(0, () => {
        const port = srv.address().port;
        http.get({ hostname: "127.0.0.1", port, path: "/ready" }, (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => {
            try {
              assert.strictEqual(res.statusCode, 200);
              const j = JSON.parse(d);
              assert.strictEqual(j.ok, true);
              assert.ok(j.request_id);
              srv.close(resolve);
            } catch (e) {
              srv.close(() => reject(e));
            }
          });
        }).on("error", (e) => {
          srv.close(() => reject(e));
        });
      });
    });

    await new Promise((resolve, reject) => {
      const srv = app.listen(0, () => {
        const port = srv.address().port;
        http.get(
          { hostname: "127.0.0.1", port, path: "/api/compare-batch/B-1730000000000-abcdef12" },
          (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => {
              try {
                assert.strictEqual(res.statusCode, 401);
                const j = JSON.parse(d);
                assert.strictEqual(j.code, "UNAUTHORIZED");
                assert.ok(j.request_id);
                srv.close(resolve);
              } catch (e) {
                srv.close(() => reject(e));
              }
            });
          }
        ).on("error", (e) => srv.close(() => reject(e)));
      });
    });

    await new Promise((resolve, reject) => {
      const srv = app.listen(0, () => {
        const port = srv.address().port;
        http.get(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/compare-batch/B-1730000000000-abcdef12",
            headers: { "X-API-Key": "integration-key" },
          },
          (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => {
              try {
                assert.strictEqual(res.statusCode, 404);
                const j = JSON.parse(d);
                assert.strictEqual(j.status, "error");
                assert.ok(j.request_id);
                srv.close(resolve);
              } catch (e) {
                srv.close(() => reject(e));
              }
            });
          }
        ).on("error", (e) => srv.close(() => reject(e)));
      });
    });

    delete process.env.BATCH_API_KEY;
    delete require.cache[require.resolve("../server.js")];
  });
});
