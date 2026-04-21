/**
 * Camada de revisão manual assistida: taxonomia, priorização e ações sugeridas.
 */

/** Versão da API de resposta do batch (incrementar em mudanças de contrato review/schema). */
const BATCH_API_VERSION = "2.4.0";

/**
 * @typedef {'info'|'warning'|'error'|'blocking'} ReviewSeverity
 */
const REVIEW_SEVERITY = {
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  BLOCKING: "blocking",
};

/**
 * @typedef {'quotation_id'|'item_matching'|'item_missing'|'total_divergence'|'payment_terms'|'installments'|'parser_confidence'|'item_key_collision'|'supplier_data_missing'|'item_semantic_match'|'item_semantic_review'|'other'} ReviewCategory
 */
const REVIEW_CATEGORY = {
  QUOTATION_ID: "quotation_id",
  ITEM_MATCHING: "item_matching",
  ITEM_MISSING: "item_missing",
  TOTAL_DIVERGENCE: "total_divergence",
  PAYMENT_TERMS: "payment_terms",
  INSTALLMENTS: "installments",
  PARSER_CONFIDENCE: "parser_confidence",
  ITEM_KEY_COLLISION: "item_key_collision",
  SUPPLIER_DATA_MISSING: "supplier_data_missing",
  ITEM_SEMANTIC_MATCH: "item_semantic_match",
  ITEM_SEMANTIC_REVIEW: "item_semantic_review",
  OTHER: "other",
};

const SEVERITY_ORDER = {
  blocking: 0,
  error: 1,
  warning: 2,
  info: 3,
};

/**
 * @param {object} inc
 * @returns {{ severity: ReviewSeverity, category: string, code: string, summary: string, supplier?: string, file?: string, detail?: string }}
 */
function classifyInconsistency(inc) {
  const code = String(inc.code || "");
  const type = String(inc.type || "");
  const rawSev = String(inc.severity || "warning").toLowerCase();

  if (code === "QUOTATION_ID_DIVERGENT" || type === "quotation_id") {
    return {
      severity: REVIEW_SEVERITY.BLOCKING,
      category: REVIEW_CATEGORY.QUOTATION_ID,
      code,
      summary: inc.message || inc.detail || "quotation_id divergentes entre arquivos",
      file: inc.file,
      detail: inc.detail,
    };
  }
  if (code === "ITEM_MISSING" || type === "item_missing") {
    return {
      severity: REVIEW_SEVERITY.ERROR,
      category: REVIEW_CATEGORY.ITEM_MISSING,
      code,
      summary: inc.message || `Item ausente`,
      supplier: inc.supplier,
      file: inc.file,
      detail: inc.detail,
    };
  }
  if (code === "QTY_DIVERGENT" || type === "quantity_divergent") {
    return {
      severity: REVIEW_SEVERITY.INFO,
      category: REVIEW_CATEGORY.ITEM_MATCHING,
      code,
      summary: inc.message || "Quantidade divergente da referência",
      detail: inc.detail,
    };
  }
  if (
    code === "ITEM_KEY_COLLISION_CANDIDATE" ||
    type === "item_key" ||
    /colis[aã]o.*chave/i.test(String(inc.message || ""))
  ) {
    return {
      severity: REVIEW_SEVERITY.ERROR,
      category: REVIEW_CATEGORY.ITEM_KEY_COLLISION,
      code,
      summary: inc.message || "Possível colisão de item_key",
      detail: inc.detail,
    };
  }

  const sev =
    rawSev === "error"
      ? REVIEW_SEVERITY.ERROR
      : rawSev === "info"
        ? REVIEW_SEVERITY.INFO
        : REVIEW_SEVERITY.WARNING;

  return {
    severity: sev,
    category: REVIEW_CATEGORY.OTHER,
    code: code || "UNKNOWN",
    summary: inc.message || inc.detail || JSON.stringify(inc),
    supplier: inc.supplier,
    file: inc.file,
    detail: inc.detail,
  };
}

/**
 * @param {string} w
 */
function classifyWarningString(w) {
  const s = String(w);
  if (/ITEM_KEY_INTRA_QUOTE_DUP/i.test(s)) {
    return {
      severity: REVIEW_SEVERITY.ERROR,
      category: REVIEW_CATEGORY.ITEM_KEY_COLLISION,
      code: "ITEM_KEY_INTRA_QUOTE_DUP",
      summary: s.slice(0, 500),
    };
  }
  if (/ITEM_KEY_COLLISION/i.test(s) && /CANDIDATE/i.test(s)) {
    return {
      severity: REVIEW_SEVERITY.ERROR,
      category: REVIEW_CATEGORY.ITEM_KEY_COLLISION,
      code: "ITEM_KEY_COLLISION_TEXT",
      summary: s.slice(0, 500),
    };
  }
  if (/Total declarado/i.test(s) && /difer[eê]/i.test(s)) {
    return {
      severity: REVIEW_SEVERITY.WARNING,
      category: REVIEW_CATEGORY.TOTAL_DIVERGENCE,
      code: "DECLARED_VS_RECALC",
      summary: s.slice(0, 500),
    };
  }
  if (/parcela/i.test(s) || /installments/i.test(s)) {
    return {
      severity: REVIEW_SEVERITY.WARNING,
      category: REVIEW_CATEGORY.INSTALLMENTS,
      code: "INSTALLMENTS_MENTION",
      summary: s.slice(0, 300),
    };
  }
  if (/pagamento|payment|condi[cç][aã]o/i.test(s)) {
    return {
      severity: REVIEW_SEVERITY.WARNING,
      category: REVIEW_CATEGORY.PAYMENT_TERMS,
      code: "PAYMENT_MENTION",
      summary: s.slice(0, 300),
    };
  }
  if (/fornecedor|supplier|dados.*ausente/i.test(s) && /ausente|missing|faltando/i.test(s)) {
    return {
      severity: REVIEW_SEVERITY.WARNING,
      category: REVIEW_CATEGORY.SUPPLIER_DATA_MISSING,
      code: "SUPPLIER_DATA",
      summary: s.slice(0, 300),
    };
  }
  return {
    severity: REVIEW_SEVERITY.WARNING,
    category: REVIEW_CATEGORY.OTHER,
    code: "BATCH_WARNING",
    summary: s.slice(0, 400),
  };
}

/**
 * @param {object} ctx
 * @param {object[]} ctx.inconsistencies — já inclui colisões de item_key quando aplicável
 * @param {string[]} ctx.warnings — alertas de proposta/parser (sem duplicar comparison_result.alerts)
 * @param {import('./extractSupplierQuotes').SupplierQuote[]} ctx.allQuotes
 * @param {object[]} ctx.parsedFiles
 * @param {boolean} [ctx.analytic_manual_review]
 * @param {object[]} [ctx.semantic_review_hints] — de enrichConsolidationWithSemanticMatches
 * @param {object} [ctx.semantic_stats] — telemetria `semantic_match_*` do lote
 */
function buildReviewSummary(ctx) {
  const {
    inconsistencies = [],
    warnings = [],
    allQuotes = [],
    parsedFiles = [],
    analytic_manual_review = false,
    semantic_review_hints = [],
    semantic_stats = null,
  } = ctx;

  /** @type {ReturnType<classifyInconsistency>[]} */
  const issues = [];

  const seen = new Set();
  function pushIssue(issue) {
    const key = `${issue.severity}|${issue.category}|${issue.code}|${issue.summary?.slice(0, 120)}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  }

  for (const h of semantic_review_hints) {
    const cat =
      h.category === "item_semantic_match"
        ? REVIEW_CATEGORY.ITEM_SEMANTIC_MATCH
        : REVIEW_CATEGORY.ITEM_SEMANTIC_REVIEW;
    const sev =
      h.severity === "error"
        ? REVIEW_SEVERITY.ERROR
        : h.severity === "info"
          ? REVIEW_SEVERITY.INFO
          : REVIEW_SEVERITY.WARNING;
    pushIssue({
      severity: sev,
      category: cat,
      code: "SEMANTIC_ITEM",
      summary: h.summary || "",
      detail: h.detail,
    });
  }

  for (const inc of inconsistencies) {
    pushIssue(classifyInconsistency(inc));
  }

  for (const w of warnings) {
    if (!String(w).trim()) continue;
    pushIssue(classifyWarningString(w));
  }

  for (const pf of parsedFiles) {
    if (!pf.parse_ok || !pf.pipeline_result) continue;
    const conf = pf.pipeline_result.parsing_confidence_snapshot;
    const th = 0.75;
    if (typeof conf === "number" && conf < th) {
      pushIssue({
        severity: REVIEW_SEVERITY.WARNING,
        category: REVIEW_CATEGORY.PARSER_CONFIDENCE,
        code: "LOW_PARSING_CONFIDENCE",
        summary: `Confiança de parse baixa (${conf.toFixed(2)}) no arquivo ${pf.source_filename}`,
        file: pf.source_filename,
        detail: String(conf),
      });
    }
    const al = (pf.pipeline_result.template_detection?.alerts || []).slice(0, 3);
    for (const a of al) {
      pushIssue({
        severity: REVIEW_SEVERITY.INFO,
        category: REVIEW_CATEGORY.PARSER_CONFIDENCE,
        code: "TEMPLATE_ALERT",
        summary: `Layout/template: ${a}`,
        file: pf.source_filename,
      });
    }
  }

  const blocking_issue_count = issues.filter((i) => i.severity === REVIEW_SEVERITY.BLOCKING).length;
  const error_issue_count = issues.filter((i) => i.severity === REVIEW_SEVERITY.ERROR).length;
  const warning_issue_count = issues.filter((i) => i.severity === REVIEW_SEVERITY.WARNING).length;
  const info_issue_count = issues.filter((i) => i.severity === REVIEW_SEVERITY.INFO).length;

  const affected_suppliers = [
    ...new Set([
      ...issues.map((i) => i.supplier).filter(Boolean),
      ...allQuotes.filter((q) => (q.warnings || []).length).map((q) => q.supplier_name || q.proposal_label),
    ]),
  ].slice(0, 40);

  const affected_files = [
    ...new Set([...issues.map((i) => i.file).filter(Boolean), ...parsedFiles.map((p) => p.source_filename)]),
  ].slice(0, 40);

  let top_review_reasons = issues
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, 12)
    .map((i) => `[${i.severity}/${i.category}] ${i.summary}`);

  let priority_queue = buildPriorityQueue(issues, allQuotes, parsedFiles);
  let recommended_actions = buildRecommendedActions(issues, allQuotes, parsedFiles);

  if (semantic_stats && typeof semantic_stats === "object") {
    const att = Number(semantic_stats.semantic_match_attempted_count) || 0;
    const app = Number(semantic_stats.semantic_match_applied_count) || 0;
    const man = Number(semantic_stats.semantic_match_manual_review_count) || 0;
    const rej = Number(semantic_stats.semantic_match_rejected_count) || 0;
    if (att >= 3 && app === 0 && (man >= 2 || rej >= 2)) {
      const hint =
        `[info/item_semantic_telemetry] Várias tentativas de equivalência semântica (${att}) sem merge automático ` +
        `(${man} sugestão(ões) para revisão, ${rej} rejeição(ões)); pode indicar ruído de descrições ou limiares inadequados.`;
      if (!top_review_reasons.some((r) => String(r).includes("item_semantic_telemetry"))) {
        top_review_reasons = [hint, ...top_review_reasons].slice(0, 14);
      }
    }
    if (man >= 3) {
      const act =
        "Várias sugestões de equivalência semântica ficaram em confiança intermediária: revisar manualmente cada par de itens e alinhar descrições/códigos entre fornecedores antes de homologar.";
      if (!recommended_actions.some((a) => /confiança intermediária/i.test(String(a)))) {
        recommended_actions = [act, ...recommended_actions].slice(0, 22);
      }
    }
  }

  const manual_review_required =
    analytic_manual_review ||
    blocking_issue_count > 0 ||
    error_issue_count > 0 ||
    warning_issue_count > 0;

  return {
    manual_review_required,
    blocking_issue_count,
    error_issue_count,
    warning_issue_count,
    info_issue_count,
    top_review_reasons,
    affected_suppliers,
    affected_files,
    priority_queue,
    recommended_actions,
  };
}

/**
 * @param {ReturnType<classifyInconsistency>[]} issues
 */
function buildPriorityQueue(issues, allQuotes, parsedFiles) {
  const sorted = [...issues].sort((a, b) => {
    const o = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (o !== 0) return o;
    return String(a.category).localeCompare(String(b.category));
  });

  const lines = [];
  const add = (s) => {
    if (s && !lines.includes(s)) lines.push(s);
  };

  for (const i of sorted) {
    if (i.category === REVIEW_CATEGORY.QUOTATION_ID && i.severity === REVIEW_SEVERITY.BLOCKING) {
      add("Verificar se todos os arquivos pertencem ao mesmo RFQ/cotação (quotation_id divergentes).");
    }
    if (i.category === REVIEW_CATEGORY.ITEM_MISSING) {
      const sup = i.supplier || "fornecedor";
      const det = i.detail || "?";
      add(`Fornecedor ${sup}: falta linha de item correspondente (${det}).`);
    }
    if (i.category === REVIEW_CATEGORY.ITEM_KEY_COLLISION) {
      const det = i.detail || "item_key";
      add(`Possível colisão de chave de item — revisar equivalência (${det}).`);
    }
    if (i.category === REVIEW_CATEGORY.ITEM_SEMANTIC_REVIEW) {
      add(`Revisar possível equivalência semântica de itens (descrições divergentes): ${i.summary || ""}`);
    }
    if (i.category === REVIEW_CATEGORY.ITEM_SEMANTIC_MATCH) {
      add(`Registro: ${i.summary || ""}`);
    }
    if (i.category === REVIEW_CATEGORY.TOTAL_DIVERGENCE) {
      add("Há divergência entre total declarado e soma das linhas em pelo menos uma proposta.");
    }
    if (i.category === REVIEW_CATEGORY.PARSER_CONFIDENCE && i.code === "LOW_PARSING_CONFIDENCE") {
      add(`Arquivo ${i.file || "?"}: confiança de leitura da planilha abaixo do esperado.`);
    }
    if (i.category === REVIEW_CATEGORY.ITEM_MATCHING && i.code === "QTY_DIVERGENT") {
      add(`Item com quantidade diferente da referência — conferir unidade e escala (${i.detail || ""}).`);
    }
  }

  if (lines.length < 5 && sorted.length) {
    for (const i of sorted) {
      add(`[${i.severity}] ${i.summary}`);
      if (lines.length >= 15) break;
    }
  }

  return lines.slice(0, 25);
}

/**
 * @param {ReturnType<classifyInconsistency>[]} issues
 */
function buildRecommendedActions(issues, allQuotes, parsedFiles) {
  const actions = [];
  const add = (s) => {
    if (s && !actions.includes(s)) actions.push(s);
  };

  const has = (cat) => issues.some((i) => i.category === cat);

  if (has(REVIEW_CATEGORY.QUOTATION_ID)) {
    add("Confirmar com o solicitante qual RFQ/cotação é a correta para cada arquivo enviado.");
  }
  if (has(REVIEW_CATEGORY.ITEM_MISSING)) {
    add("Abrir a planilha de cada fornecedor e validar se o item faltante não foi renomeado ou agrupado.");
  }
  if (has(REVIEW_CATEGORY.ITEM_KEY_COLLISION)) {
    add("Revisar descrições e quantidades para garantir que itens distintos não compartilham a mesma chave lógica.");
  }
  if (has(REVIEW_CATEGORY.ITEM_SEMANTIC_REVIEW)) {
    add("Validar manualmente pares de itens com descrições próximas mas não idênticas antes de homologar.");
  }
  if (has(REVIEW_CATEGORY.TOTAL_DIVERGENCE)) {
    add("Conferir totais declarados na proposta versus soma das linhas e frete, antes de aceitar o vencedor.");
  }
  if (has(REVIEW_CATEGORY.PARSER_CONFIDENCE)) {
    add("Validar manualmente o layout da planilha (cabeçalhos, colunas) nos arquivos com baixa confiança de parse.");
  }
  if (has(REVIEW_CATEGORY.PAYMENT_TERMS)) {
    add("Confirmar condição de pagamento com o fornecedor quando houver alerta neste tema.");
  }
  if (has(REVIEW_CATEGORY.INSTALLMENTS)) {
    add("Validar parcelamento e prazos informados na proposta.");
  }

  const lowConfFile = parsedFiles.find(
    (p) =>
      p.parse_ok &&
      p.pipeline_result &&
      typeof p.pipeline_result.parsing_confidence_snapshot === "number" &&
      p.pipeline_result.parsing_confidence_snapshot < 0.75
  );
  if (lowConfFile) {
    add(`Revisar o arquivo "${lowConfFile.source_filename}" linha a linha antes de homologar.`);
  }

  if (actions.length === 0 && issues.length === 0) {
    add("Nenhuma ação obrigatória: revisão opcional antes de homologar o vencedor sugerido.");
  }

  return actions.slice(0, 20);
}

module.exports = {
  BATCH_API_VERSION,
  REVIEW_SEVERITY,
  REVIEW_CATEGORY,
  buildReviewSummary,
  classifyInconsistency,
  classifyWarningString,
};
