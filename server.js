require("dotenv").config({ quiet: true });

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

/** Raiz do projeto: server na raiz ou em src/ (Render com Root Directory = src). */
const REPO_ROOT = (() => {
  if (fs.existsSync(path.join(__dirname, "rfq"))) return __dirname;
  const up = path.join(__dirname, "..");
  if (fs.existsSync(path.join(up, "rfq"))) return up;
  return __dirname;
})();

const { parseRfqFromUrl, parseExcelToCanonical } = require(path.join(REPO_ROOT, "rfq", "parser"));
const { parseWithPipeline } = require(path.join(REPO_ROOT, "rfq", "pipeline"));
const { runCompareBatch } = require(path.join(REPO_ROOT, "rfq", "batch", "compareBatch"));
const { BATCH_ERROR_CODES } = require(path.join(REPO_ROOT, "rfq", "batch", "batchTypes"));
const { shapeCompareBatchResponse } = require(path.join(REPO_ROOT, "rfq", "batch", "batchResponse"));
const { scheduleBatchExportCleanup } = require(path.join(REPO_ROOT, "rfq", "batch", "batchExportCleanup"));
const {
  validateDownloadToken,
  consumeDownloadToken,
  shouldConsumeTokenAfterDownload,
} = require(path.join(REPO_ROOT, "rfq", "batch", "batchDownloadStore"));
const batchHistoryStore = require(path.join(REPO_ROOT, "rfq", "batch", "batchHistoryStore"));
const batchSnapshotStore = require(path.join(REPO_ROOT, "rfq", "batch", "batchSnapshotStore"));
const batchArtifactService = require(path.join(REPO_ROOT, "rfq", "batch", "batchArtifactService"));
const { correlationMiddleware } = require(path.join(
  REPO_ROOT,
  "rfq",
  "batch",
  "middleware",
  "requestCorrelation"
));
const { requireBatchApiKey } = require(path.join(REPO_ROOT, "rfq", "batch", "middleware", "apiKeyAuth"));
const { createRateLimiter, getClientIp } = require(path.join(
  REPO_ROOT,
  "rfq",
  "batch",
  "middleware",
  "rateLimit"
));
const { logBatchEvent } = require(path.join(REPO_ROOT, "rfq", "batch", "batchStructuredLog"));
const { getReadiness } = require(path.join(REPO_ROOT, "rfq", "batch", "batchReadiness"));
const { scheduleRetentionCleanup } = require(path.join(REPO_ROOT, "rfq", "batch", "batchRetentionCleanup"));
const {
  resolveExportLocalDir,
  getBatchExportStore,
} = require(path.join(REPO_ROOT, "rfq", "batch", "storage", "batchStorageFactory"));
const { getBatchExportPublicBaseUrl } = require(path.join(
  REPO_ROOT,
  "rfq",
  "batch",
  "config",
  "batchInfraConfig"
));

const BATCH_EXPORT_DIR = resolveExportLocalDir();
try {
  if (!fs.existsSync(BATCH_EXPORT_DIR)) {
    fs.mkdirSync(BATCH_EXPORT_DIR, { recursive: true });
  }
} catch (e) {
  console.error("⚠️  Diretório de export batch:", e.message);
}

scheduleBatchExportCleanup(BATCH_EXPORT_DIR, { onStartup: true });
scheduleRetentionCleanup(
  {
    exportDir: BATCH_EXPORT_DIR,
    historyDir: batchHistoryStore.getHistoryDir(),
    snapshotDir: batchSnapshotStore.getSnapshotDir(),
  },
  { onStartup: true }
);

try {
  fs.mkdirSync(batchHistoryStore.getHistoryDir(), { recursive: true });
} catch (e) {
  console.error("⚠️  Diretório batch-history:", e.message);
}
try {
  fs.mkdirSync(batchSnapshotStore.getSnapshotDir(), { recursive: true });
} catch (e) {
  console.error("⚠️  Diretório batch-snapshots:", e.message);
}

const BATCH_ID_PATH_RE = /^B-\d+-[a-f0-9]+$/;

const app = express();
// Atrás de proxies (Railway/Cloudflare): respeita X-Forwarded-Proto para que
// req.protocol devolva "https" e as URLs de download sejam absolutas corretas.
// Sem isso, Chrome/Edge bloqueiam downloads como Mixed Content (http dentro de https).
app.set("trust proxy", 1);
const upload = multer({ storage: multer.memoryStorage() });

const rateLimitCompare = createRateLimiter({
  namespace: "compare_batch",
  windowMs: Math.max(1000, parseInt(process.env.BATCH_RATE_LIMIT_COMPARE_WINDOW_MS || "60000", 10) || 60000),
  max: Math.max(1, parseInt(process.env.BATCH_RATE_LIMIT_COMPARE_MAX || "30", 10) || 30),
});
const rateLimitMutate = createRateLimiter({
  namespace: "mutate_batch",
  windowMs: Math.max(1000, parseInt(process.env.BATCH_RATE_LIMIT_MUTATE_WINDOW_MS || "60000", 10) || 60000),
  max: Math.max(1, parseInt(process.env.BATCH_RATE_LIMIT_MUTATE_MAX || "20", 10) || 20),
  keyGenerator: (req) => getClientIp(req),
});

// ========= API OpenAI (env: OPENAI_API_KEY; legado: TESS_API_KEY) — nunca commitar chaves =========
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.TESS_API_KEY || "";
const TESS_API_BASE = "Link;https://embed.tess.im/pt-BR/agents/comparador-suprimentos-pmPIui/public-api";
const TESS_AGENT_SLUG = "comparador-suprimentos-pmPIui";

if (!OPENAI_API_KEY) {
  console.warn(
    "⚠️  OPENAI_API_KEY não definida: rotas legadas Tess e chamadas OpenAI ficam indisponíveis; pipeline RFQ segue em modo determinístico."
  );
}

app.use(cors());
app.use(correlationMiddleware);
app.use(express.json());

/** Interface web (public/) — cedo para GET / e assets; /downloads continua na rota API abaixo. */
app.use(
  express.static(path.join(REPO_ROOT, "public"), {
    /** Evita que o navegador sirva index.html/JS antigo após deploy local (Ctrl+F5 ainda recomendado). */
    maxAge: 0,
    etag: true,
  })
);

/** Download de XLSX gerado em lote (sobrepõe se existir arquivo estático homônimo). */
app.get("/downloads/:fileName", requireBatchApiKey, (req, res) => {
  const raw = req.params.fileName || "";
  if (raw.includes("..") || raw.includes("/") || raw.includes("\\")) {
    return res.status(400).json({ error: "Requisição inválida." });
  }
  const base = path.basename(raw);
  if (!base.toLowerCase().endsWith(".xlsx")) {
    return res.status(400).json({ error: "Requisição inválida." });
  }
  if (!/^batch-[a-zA-Z0-9._-]+\.xlsx$/i.test(base)) {
    return res.status(400).json({ error: "Requisição inválida." });
  }
  const full = path.join(BATCH_EXPORT_DIR, base);
  const resolved = path.resolve(full);
  const resolvedDir = path.resolve(BATCH_EXPORT_DIR);
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    return res.status(400).json({ error: "Requisição inválida." });
  }

  const token = req.query && req.query.token ? String(req.query.token) : "";
  const v = validateDownloadToken(base, token);
  if (!v.ok) {
    return res.status(403).json({ error: "Acesso negado." });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: "Recurso não encontrado." });
  }

  res.download(resolved, base, (err) => {
    if (!err && token && shouldConsumeTokenAfterDownload()) consumeDownloadToken(token);
  });
});

/**
 * Histórico / observabilidade de um lote (persistência JSON local).
 */
app.get("/api/compare-batch/:batchId", requireBatchApiKey, (req, res) => {
  const id = req.params.batchId || "";
  const t0 = Date.now();
  if (!BATCH_ID_PATH_RE.test(id)) {
    logBatchEvent({
      event: "batch_get_history",
      route: "GET /api/compare-batch/:batchId",
      batch_id: id,
      request_id: req.correlationId,
      status: "validation_error",
      http_status: 400,
      execution_ms: Date.now() - t0,
    });
    return res.status(400).json({
      status: "error",
      error: "batch_id inválido.",
      request_id: req.correlationId,
    });
  }
  const rec = batchHistoryStore.loadBatchRecord(id);
  if (!rec) {
    logBatchEvent({
      event: "batch_get_history",
      route: "GET /api/compare-batch/:batchId",
      batch_id: id,
      request_id: req.correlationId,
      status: "not_found",
      http_status: 404,
      execution_ms: Date.now() - t0,
    });
    return res.status(404).json({
      status: "error",
      error: "Lote não encontrado no histórico.",
      request_id: req.correlationId,
    });
  }
  logBatchEvent({
    event: "batch_get_history",
    route: "GET /api/compare-batch/:batchId",
    batch_id: id,
    request_id: req.correlationId,
    status: "ok",
    http_status: 200,
    execution_ms: Date.now() - t0,
  });
  return res.json({ status: "ok", request_id: req.correlationId, ...rec });
});

/**
 * Decisão humana: approved | rejected (auditoria em arquivo).
 */
app.post(
  "/api/compare-batch/:batchId/decision",
  rateLimitMutate,
  requireBatchApiKey,
  async (req, res) => {
    const id = req.params.batchId || "";
    const t0 = Date.now();
    if (!BATCH_ID_PATH_RE.test(id)) {
      return res.status(400).json({
        status: "error",
        error: "batch_id inválido.",
        request_id: req.correlationId,
      });
    }
    const body = req.body || {};
    if (body.status !== "approved" && body.status !== "rejected") {
      return res.status(400).json({
        status: "error",
        error: "Campo status deve ser approved ou rejected.",
        request_id: req.correlationId,
      });
    }
    const r = batchHistoryStore.applyDecision(id, body);
    if (!r.ok) {
      const http = r.code === "NOT_FOUND" ? 404 : 400;
      logBatchEvent({
        event: "batch_decision",
        route: "POST /api/compare-batch/:batchId/decision",
        batch_id: id,
        request_id: req.correlationId,
        status: "error",
        decision: { ok: false, code: r.code },
        http_status: http,
        execution_ms: Date.now() - t0,
      });
      return res.status(http).json({
        status: "error",
        code: r.code,
        message: r.message,
        request_id: req.correlationId,
      });
    }
    let artifact = { ok: true };
    try {
      artifact = await batchArtifactService.applyDecisionToExport(BATCH_EXPORT_DIR, r.record, r.audit);
    } catch (e) {
      logBatchEvent({
        event: "batch_decision_artifact_error",
        batch_id: id,
        request_id: req.correlationId,
        status: "error",
      });
      artifact = { ok: false, code: "ARTIFACT_UPDATE_FAILED" };
    }
    logBatchEvent({
      event: "batch_decision",
      route: "POST /api/compare-batch/:batchId/decision",
      batch_id: id,
      request_id: req.correlationId,
      status: "ok",
      decision: { ok: true, new_status: r.audit.new_status },
      artifact,
      http_status: 200,
      execution_ms: Date.now() - t0,
    });
    return res.json({
      status: "ok",
      request_id: req.correlationId,
      record: r.record,
      audit: r.audit,
      artifact,
    });
  }
);

/**
 * Regenera o XLSX a partir do snapshot persistido (mesmo nome de arquivo).
 */
app.post(
  "/api/compare-batch/:batchId/regenerate-export",
  rateLimitMutate,
  requireBatchApiKey,
  async (req, res) => {
    const id = req.params.batchId || "";
    const t0 = Date.now();
    if (!BATCH_ID_PATH_RE.test(id)) {
      return res.status(400).json({
        status: "error",
        error: "batch_id inválido.",
        request_id: req.correlationId,
      });
    }
    try {
      const out = await batchArtifactService.regenerateExport(BATCH_EXPORT_DIR, id);
      if (!out.ok) {
        const http = out.code === "NOT_FOUND" ? 404 : 422;
        logBatchEvent({
          event: "batch_regenerate_export",
          batch_id: id,
          request_id: req.correlationId,
          status: "error",
          http_status: http,
          execution_ms: Date.now() - t0,
        });
        return res.status(http).json({
          status: "error",
          code: out.code,
          message: out.message,
          request_id: req.correlationId,
        });
      }
      logBatchEvent({
        event: "batch_regenerate_export",
        batch_id: id,
        request_id: req.correlationId,
        status: "ok",
        artifact: { ok: true },
        http_status: 200,
        execution_ms: Date.now() - t0,
      });
      return res.json({ status: "ok", request_id: req.correlationId, ...out });
    } catch (e) {
      logBatchEvent({
        event: "batch_regenerate_export",
        batch_id: id,
        request_id: req.correlationId,
        status: "error",
        http_status: 500,
        execution_ms: Date.now() - t0,
      });
      return res.status(500).json({
        status: "error",
        code: "INTERNAL_ERROR",
        message: "Falha ao regenerar export.",
        request_id: req.correlationId,
      });
    }
  }
);

/**
 * Comparação em lote: 2–10 arquivos, XLSX consolidado em disco.
 * multipart field: files[]
 */
app.post(
  "/api/compare-batch",
  rateLimitCompare,
  requireBatchApiKey,
  upload.array("files", 10),
  async (req, res) => {
  const startTime = Date.now();
  try {
    const files = req.files || [];
    const skipOpenAI =
      req.body?.skip_openai === "1" ||
      req.query?.skip_openai === "1" ||
      process.env.OPENAI_DISABLE_BATCH === "1";
    const sharedQuotationId =
      (req.body?.rfq_id && String(req.body.rfq_id).trim()) ||
      (req.body?.quotation_id && String(req.body.quotation_id).trim()) ||
      null;

    const debug =
      req.query?.debug === "1" ||
      req.body?.debug === "1" ||
      req.body?.debug === 1;

    const result = await runCompareBatch({
      files: files.map((f) => ({
        buffer: f.buffer,
        originalname: f.originalname || "unknown.xlsx",
      })),
      options: {
        skipOpenAI,
        tempDir: BATCH_EXPORT_DIR,
        publicDownloadPath: "/downloads",
        sharedQuotationId,
      },
    });

    if (result.status === "error") {
      const code = result.code;
      const http =
        code === BATCH_ERROR_CODES.FILE_COUNT ? 400 : code === BATCH_ERROR_CODES.MIN_QUOTES ? 422 : 400;
      logBatchEvent({
        event: "batch_compare",
        route: "POST /api/compare-batch",
        request_id: req.correlationId,
        status: "pipeline_error",
        http_status: http,
        execution_ms: Date.now() - startTime,
      });
      return res.status(http).json({ ...result, request_id: req.correlationId });
    }

    const rel = result.downloadUrl || `/downloads/${result.export_filename}`;
    const publicBase = getBatchExportPublicBaseUrl();
    if (publicBase) {
      const fn = encodeURIComponent(result.export_filename || "").replace(/%2F/g, "/");
      result.downloadUrl = `${publicBase}/downloads/${fn}`;
    } else {
      const host = req.get("host") || `localhost:${process.env.PORT || 3000}`;
      const fwdProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
      const proto = fwdProto || req.protocol || "http";
      result.downloadUrl = `${proto}://${host}${rel.startsWith("/") ? rel : `/${rel}`}`;
    }

    if (result.status === "success") {
      try {
        const snap = batchSnapshotStore.buildSnapshotFromCompareResult(result);
        const snapInfo = batchSnapshotStore.saveSnapshot(result.batch_id, snap);
        const exportMeta = getBatchExportStore().getMetadataForFile(result.export_filename);
        batchHistoryStore.saveBatchRecord({
          batch_id: result.batch_id,
          created_at: result.created_at,
          request_summary: {
            files_received: result.files_received,
            file_names: (req.files || []).map((f) => f.originalname || "unknown"),
          },
          review_summary: result.review_summary,
          ai_comparison_feedback: result.ai_comparison_feedback,
          comparison_result_summary: result.comparison_result_summary,
          export_filename: result.export_filename,
          export_path: result.export_filename,
          ...exportMeta,
          export_generated_at: result.export_generated_at,
          export_last_updated_at: result.export_last_updated_at,
          snapshot_relative_path: snapInfo.relative,
          snapshot_created_at: new Date().toISOString(),
          decision_status: result.decision_status,
          metrics_summary: result.metrics_summary,
          audit_log: [],
        });
      } catch (persistErr) {
        console.error("[batch-history] persist:", persistErr.message);
      }
    }

    const out = shapeCompareBatchResponse(result, debug);
    logBatchEvent({
      event: "batch_compare",
      route: "POST /api/compare-batch",
      batch_id: result.batch_id,
      request_id: req.correlationId,
      status: "ok",
      http_status: 200,
      execution_ms: Date.now() - startTime,
    });
    return res.json({ ...out, request_id: req.correlationId });
  } catch (err) {
    logBatchEvent({
      event: "batch_compare",
      route: "POST /api/compare-batch",
      request_id: req.correlationId,
      status: "exception",
      http_status: 500,
      execution_ms: Date.now() - startTime,
    });
    return res.status(500).json({
      status: "error",
      backend: "pipeline-batch",
      code: "INTERNAL_ERROR",
      message: "Erro interno ao processar lote.",
      executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      request_id: req.correlationId,
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "compras-dream-backend",
    openai_api_configured: !!OPENAI_API_KEY,
    tess_configured: !!OPENAI_API_KEY,
    request_id: req.correlationId,
  });
});

app.get("/ready", (req, res) => {
  const r = getReadiness({
    exportDir: BATCH_EXPORT_DIR,
    historyDir: batchHistoryStore.getHistoryDir(),
    snapshotDir: batchSnapshotStore.getSnapshotDir(),
  });
  res.status(r.ok ? 200 : 503).json({ ...r, request_id: req.correlationId });
});

// ====== RFQ PARSE (OpenAI API — modelo canônico) ======

/** Log de requisição para trace OpenAI: headers + body (se houver) */
function logRequestTrace(route, req, traceId) {
  const ts = new Date().toISOString();
  const headers = { ...req.headers };
  delete headers["authorization"];
  delete headers["x-api-key"];
  delete headers["cookie"];
  delete headers["proxy-authorization"];
  console.log(`[OPENAI TRACE] ${ts} | ${route} | trace_id=${traceId || "(nenhum)"}`);
  console.log(`[OPENAI TRACE] headers: ${JSON.stringify(headers)}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[OPENAI TRACE] body: ${JSON.stringify(req.body)}`);
  }
}

/** GET /ping - health check para integração OpenAI. Query: ?trace_id=xxx (opcional) */
app.get("/ping", (req, res) => {
  const traceId = (req.query && req.query.trace_id) || null;
  logRequestTrace("GET /ping", req, traceId);

  res.set("Content-Type", "application/json");
  const payload = {
    status: "ok",
    service: "rfq-parser",
    timestamp: new Date().toISOString(),
  };
  if (traceId) payload.trace_id = traceId;
  res.status(200).json(payload);
});

/** POST /rfq/parse - recebe file_url, rfq_id, source, trace_id (opcional); retorna JSON canônico */
app.post("/rfq/parse", async (req, res) => {
  const traceId = (req.body && req.body.trace_id) || null;
  logRequestTrace("POST /rfq/parse", req, traceId);

  const addTrace = (obj) => {
    const result = { ...obj };
    if (traceId) result.trace_id = traceId;
    return result;
  };

  try {
    const { file_url, rfq_id, source } = req.body || {};

    if (!file_url || typeof file_url !== "string" || !file_url.trim()) {
      return res.status(400).set("Content-Type", "application/json").json(addTrace({
        status: "error",
        service: "rfq-parser",
        rfq_id: (req.body && req.body.rfq_id) || null,
        source: (req.body && req.body.source && String(req.body.source).trim()) || "unknown",
        error: "file_url é obrigatório e deve ser uma URL válida.",
        code: "MISSING_FILE_URL",
      }));
    }
    if (!rfq_id || typeof rfq_id !== "string" || !rfq_id.trim()) {
      return res.status(400).set("Content-Type", "application/json").json(addTrace({
        status: "error",
        service: "rfq-parser",
        rfq_id: null,
        source: (req.body && req.body.source && String(req.body.source).trim()) || "unknown",
        error: "rfq_id é obrigatório.",
        code: "MISSING_RFQ_ID",
      }));
    }

    const result = await parseRfqFromUrl(
      file_url.trim(),
      rfq_id.trim(),
      (source && String(source).trim()) || "unknown"
    );

    return res.set("Content-Type", "application/json").json(addTrace(result));
  } catch (err) {
    const status = err.response?.status;
    const code = err.code;
    const rfqId = (req.body && req.body.rfq_id) || null;
    const source = (req.body && req.body.source) || null;

    if (status === 404) {
      return res.status(404).set("Content-Type", "application/json").json(addTrace({
        status: "error",
        service: "rfq-parser",
        rfq_id: rfqId,
        source: source,
        error: "Arquivo não encontrado na URL informada.",
        code: "FILE_NOT_FOUND",
        details: err.response?.data ?? null,
      }));
    }
    if (code === "ECONNABORTED" || code === "ETIMEDOUT" || status === 408) {
      return res.status(408).set("Content-Type", "application/json").json(addTrace({
        status: "error",
        service: "rfq-parser",
        rfq_id: rfqId,
        source: source,
        error: "Timeout ao baixar o arquivo. Tente novamente.",
        code: "TIMEOUT",
      }));
    }
    if (status && status >= 400 && status < 500) {
      return res.status(status).set("Content-Type", "application/json").json(addTrace({
        status: "error",
        service: "rfq-parser",
        rfq_id: rfqId,
        source: source,
        error: err.message || "Erro ao acessar a URL do arquivo.",
        code: "HTTP_ERROR",
        details: err.response?.data ?? null,
      }));
    }

    console.error("[/rfq/parse]", err.message);
    return res.status(500).set("Content-Type", "application/json").json(addTrace({
      status: "error",
      service: "rfq-parser",
      rfq_id: rfqId,
      source: source,
      error: err.message || "Erro interno ao processar a planilha.",
      code: "INTERNAL_ERROR",
    }));
  }
});

/** POST /api/parse - recebe arquivo via upload e processa diretamente (para frontend) */
app.post("/api/parse", upload.single("file"), async (req, res) => {
  const traceId = `web-${Date.now()}`;
  logRequestTrace("POST /api/parse", req, traceId);

  const addTrace = (obj) => {
    const result = { ...obj };
    if (traceId) result.trace_id = traceId;
    return result;
  };

  try {
    if (!req.file) {
      return res.status(400).set("Content-Type", "application/json").json(addTrace({
        status: "error",
        service: "rfq-parser",
        rfq_id: null,
        source: "unknown",
        error: 'Nenhum arquivo enviado. O campo deve se chamar "file".',
        code: "MISSING_FILE",
      }));
    }

    const rfqId = req.body?.rfq_id || `DF-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const source = (req.body?.source && String(req.body.source).trim()) || "unknown";

    const legacyOnly = req.query?.legacy === "1" || req.body?.legacy === "1";
    const result = legacyOnly
      ? parseExcelToCanonical(req.file.buffer, rfqId, source)
      : await parseWithPipeline(req.file.buffer, rfqId, source);

    return res.set("Content-Type", "application/json").json(addTrace(result));
  } catch (err) {
    console.error("[/api/parse]", err.message);
    return res.status(500).set("Content-Type", "application/json").json(addTrace({
      status: "error",
      service: "rfq-parser",
      rfq_id: (req.body && req.body.rfq_id) || null,
      source: (req.body && req.body.source) || "unknown",
      error: err.message || "Erro interno ao processar a planilha.",
      code: "INTERNAL_ERROR",
    }));
  }
});

// ====== HELPERS DO AGENTE (endpoint embed / OpenAI API) ======

async function getAgentId() {
  try {
    console.log("🔍 Buscando agente (OpenAI API)...");
    const resp = await axios.get(`${TESS_API_BASE}/agents`, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      params: { q: TESS_AGENT_SLUG, per_page: 20 }
    });

    const agents = resp.data?.data || [];
    console.log(`📋 ${agents.length} agente(s) encontrado(s):`);
    agents.forEach(a => console.log(`   - ID ${a.id}: "${a.title}" (slug: ${a.slug})`));

    const agent = agents.find(a => 
      a.slug === TESS_AGENT_SLUG || 
      a.title?.toLowerCase().includes("comparador")
    );

    if (!agent) {
      throw new Error(
        `Agente "${TESS_AGENT_SLUG}" não encontrado. Verifique o slug ou o título na configuração da API OpenAI.`
      );
    }

    console.log(`✅ Usando agente: ID=${agent.id} | Título="${agent.title}"`);
    return agent.id;
  } catch (err) {
    console.error("❌ Erro ao buscar agente:");
    console.error("   Status:", err.response?.status);
    console.error("   URL:", err.config?.url);
    console.error("   Resposta:", err.response?.data || err.message);
    throw new Error("Falha ao buscar agente na API OpenAI: " + (err.response?.data?.message || err.message));
  }
}

async function uploadFileToTess(file) {
  try {
    const form = new FormData();
    form.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype
    });

    const url = `${TESS_API_BASE}/files/upload`;
    console.log(`📤 Fazendo upload para: ${url}`);

    const resp = await axios.post(url, form, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...form.getHeaders()
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log(`✅ Upload concluído: ID=${resp.data.id} | Nome=${resp.data.name}`);
    return resp.data;
  } catch (err) {
    console.error("❌ Erro no upload:");
    console.error("   Status:", err.response?.status);
    console.error("   URL:", err.config?.url);
    console.error("   Resposta:", err.response?.data || err.message);
    throw new Error("Falha no upload: " + (err.response?.data?.message || err.message));
  }
}

async function executeAgent(agentId, fileId, fileName) {
  try {
    const body = {
      agent_id: agentId,
      answers: {
        temperature: "1",
        model: "auto",
        tools: "tools"
      },
      messages: [
        {
          role: "user",
          content: `Analise o arquivo de cotações "${fileName}" anexado. 

Compare todos os fornecedores identificando:
- Melhor opção (menor preço + melhores condições)
- Pior opção
- Diferença percentual entre eles
- Gere uma planilha Excel comparativa e retorne o link público para download

Formato esperado da resposta:
- Resumo executivo com insights
- Identificação clara do melhor fornecedor
- Link direto da planilha .xlsx`
        }
      ],
      wait_execution: true,
      file_ids: [fileId]
    };

    const url = `${TESS_API_BASE}/agents/execute`;
    console.log(`🚀 Executando agente em: ${url}`);
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   File ID: ${fileId}`);

    const resp = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 120000 // 120 segundos
    });

    console.log("✅ Execução concluída!");
    console.log("   Resposta:", JSON.stringify(resp.data, null, 2));
    return resp.data;
  } catch (err) {
    console.error("❌ Erro na execução do agente:");
    console.error("   Status:", err.response?.status);
    console.error("   URL:", err.config?.url);
    console.error("   Resposta:", err.response?.data || err.message);
    throw new Error("Falha ao executar agente: " + (err.response?.data?.message || err.message));
  }
}

function extractBestSupplier(text) {
  if (!text) return "—";
  
  const patterns = [
    /(?:Melhor|MELHOR).*?Fornecedor:\s*([^\n]+)/i,
    /Fornecedor:\s*([^\n]+)/i,
    /(?:Spedd Tech|Amazon|Kabum|Ponto Frio|Casas Bahia|Magazine Luiza)/i
  ];
  
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return m[1]?.trim() || m[0]?.trim();
  }
  return "—";
}

function extractXlsxUrl(text) {
  if (!text) return null;
  const m = text.match(/(https:\/\/[^\s\)]+\.xlsx)/i);
  return m ? m[1] : null;
}

// ====== COMPARAÇÃO: pipeline determinístico (padrão) ou agente remoto (COMPARE_BACKEND=tess) ======

const COMPARE_BACKEND = (process.env.COMPARE_BACKEND || "pipeline").toLowerCase();

app.post("/api/compare", upload.single("file"), async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Nenhum arquivo enviado. O campo deve se chamar "file".',
      });
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`📥 /api/compare — ${new Date().toISOString()} — backend=${COMPARE_BACKEND}`);
    console.log(`${"=".repeat(70)}`);
    console.log(`Arquivo: ${req.file.originalname}`);
    console.log(`Tamanho: ${(req.file.size / 1024).toFixed(2)} KB`);
    console.log(`${"=".repeat(70)}\n`);

    if (COMPARE_BACKEND === "tess") {
      const agentId = await getAgentId();
      const fileInfo = await uploadFileToTess(req.file);
      const execResult = await executeAgent(agentId, fileInfo.id, req.file.originalname);

      const responses = execResult.responses || [];
      if (!responses.length) {
        throw new Error(
          "A execução não retornou respostas. Verifique a configuração do agente na API OpenAI."
        );
      }

      const output = responses[0].output || JSON.stringify(responses[0], null, 2);
      const bestSupplier = extractBestSupplier(output);
      const downloadUrl = extractXlsxUrl(output);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      return res.json({
        backend: "tess",
        analysisText: output,
        bestSupplier,
        downloadUrl,
        executionTime: duration + "s",
      });
    }

    const rfqId =
      req.body?.rfq_id || `DF-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const source =
      (req.body?.source && String(req.body.source).trim()) || "Comparação Web";

    const pipelineResult = await parseWithPipeline(req.file.buffer, rfqId, source);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    const winner = pipelineResult.comparison_result?.winner_suggested?.name || "—";
    const analysisText =
      pipelineResult.status === "success" && pipelineResult.comparison_result
        ? JSON.stringify(
            {
              ranking: pipelineResult.comparison_result.ranking,
              winner: pipelineResult.comparison_result.winner_suggested,
              alerts: pipelineResult.comparison_result.alerts,
              justifications: pipelineResult.comparison_result.justifications,
            },
            null,
            2
          )
        : JSON.stringify(pipelineResult, null, 2);

    return res.json({
      backend: "pipeline",
      parser_version: pipelineResult.parser_version,
      template_detection: pipelineResult.template_detection,
      canonical_quotation: pipelineResult.canonical_quotation,
      validation_result: pipelineResult.validation_result,
      comparison_result: pipelineResult.comparison_result,
      analysis_source: pipelineResult.analysis_source,
      manual_review_required: pipelineResult.manual_review_required,
      analytic_summary: pipelineResult.analytic_summary,
      openai_confidence: pipelineResult.openai_confidence,
      openai_ambiguity_advisory: pipelineResult.openai_ambiguity_advisory,
      warnings: pipelineResult.warnings,
      pipeline: pipelineResult,
      analysisText,
      bestSupplier: winner,
      downloadUrl: null,
      executionTime: duration + "s",
    });
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.error(`\n${"=".repeat(70)}`);
    console.error(`❌ /api/compare ERRO APÓS ${duration}s`);
    console.error(`${"=".repeat(70)}`);
    console.error(err.message);
    console.error(`${"=".repeat(70)}\n`);

    return res.status(500).json({
      error: err.message || "Erro interno ao processar análise.",
      details: err.response?.data || null,
    });
  }
});

// ====== START ======

module.exports = { app, BATCH_EXPORT_DIR };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || "0.0.0.0";
  app.listen(PORT, HOST, () => {
    console.log("\n" + "=".repeat(70));
    console.log("🚀 SUPRIMENTOS DREAM — comparador de cotações");
    console.log("=".repeat(70));
    console.log(`📡 Backend:     http://localhost:${PORT}`);
    console.log(`📄 Interface:   http://localhost:${PORT}`);
    console.log(`🔑 API OpenAI:  ${OPENAI_API_KEY ? "✅ Configurada" : "❌ NÃO configurada"}`);
    console.log(`🤖 Agente:      ${TESS_AGENT_SLUG}`);
    console.log(`🌐 Base URL:    ${TESS_API_BASE}`);
    console.log(`⚖️  /api/compare: COMPARE_BACKEND=${COMPARE_BACKEND} (pipeline|tess)`);
    console.log(`📦 /api/compare-batch | GET /downloads/:file | batch dir=${BATCH_EXPORT_DIR}`);
    console.log("📊 Export XLSX lote: v2 (2 abas: Itens por fornecedor + Comparação). Reinicie o servidor após alterar código.");
    console.log("=".repeat(70) + "\n");
    console.log("Aguardando requisições...\n");
  });
}
