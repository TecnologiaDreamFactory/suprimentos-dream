/**
 * UI do resultado de compare-batch (payload normal/enxuto).
 * Funções reutilizáveis — sem dependências externas.
 */
(function (global) {
  "use strict";

  /** Classe do host (scroll / borda); não remover ao trocar estado */
  var RESULT_HOST_CLASS = "batch-result-host";

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Badge: backend usa analysis_source deterministic | openai */
  function getAnalysisSourcePresentationFixed(data) {
    const src = (data && data.analysis_source) || "";
    const hasAnalytic = data && data.analytic_summary != null;
    if (src === "openai") {
      return { key: "ia", label: "Com IA", badgeClass: "batch-badge batch-badge--ia" };
    }
    if (src === "deterministic" && hasAnalytic) {
      return { key: "hybrid", label: "Híbrido", badgeClass: "batch-badge batch-badge--hybrid" };
    }
    if (src === "deterministic" || !src) {
      return { key: "det", label: "Determinístico", badgeClass: "batch-badge batch-badge--det" };
    }
    return { key: "other", label: String(src), badgeClass: "batch-badge" };
  }

  function buildDownloadHref(data) {
    if (!data || !data.downloadUrl) return null;
    let u = data.downloadUrl;
    if (data.download_token) {
      u += (u.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(data.download_token);
    }
    return u;
  }

  function renderBatchSummaryCard(data) {
    const asp = getAnalysisSourcePresentationFixed(data);
    const rs = data.review_summary || {};
    const block = rs.blocking_issue_count || 0;
    const err = rs.error_issue_count || 0;
    const warn = rs.warning_issue_count || 0;
    const info = rs.info_issue_count || 0;
    const files = data.files_received ?? "—";
    const quotes = data.quotes_extracted ?? "—";
    const compact =
      files !== "—"
        ? `${files} arquivo${Number(files) !== 1 ? "s" : ""} analisado${Number(files) !== 1 ? "s" : ""}`
        : "—";
    const issuesLine = [block && `${block} bloqueio${block !== 1 ? "s" : ""}`, err && `${err} erro${err !== 1 ? "s" : ""}`, warn && `${warn} aviso${warn !== 1 ? "s" : ""}`]
      .filter(Boolean)
      .join(" · ");
    const reviewHint = data.manual_review_required ? "Revisão manual necessária" : "Sem revisão obrigatória";

    return (
      '<section class="batch-card batch-card--summary" aria-labelledby="batch-summary-title">' +
      '<h3 id="batch-summary-title" class="batch-card__title">Resumo do lote</h3>' +
      '<p class="batch-compact-line" role="status">' +
      '<strong>' +
      escapeHtml(compact) +
      "</strong>" +
      (issuesLine ? " · " + escapeHtml(issuesLine) : "") +
      " · " +
      '<span class="' +
      (data.manual_review_required ? "batch-text-warn" : "batch-text-ok") +
      '">' +
      escapeHtml(reviewHint) +
      "</span>" +
      "</p>" +
      '<dl class="batch-dl">' +
      '<div><dt>Status geral</dt><dd>' +
      escapeHtml(data.manual_review_required ? "Requer atenção / revisão" : "Processado") +
      "</dd></div>" +
      '<div><dt>batch_id</dt><dd><code class="batch-code">' +
      escapeHtml(data.batch_id || "—") +
      "</code></dd></div>" +
      '<div><dt>batch_api_version</dt><dd>' +
      escapeHtml(data.batch_api_version || "—") +
      "</dd></div>" +
      '<div><dt>Arquivos recebidos</dt><dd>' +
      escapeHtml(String(data.files_received ?? "—")) +
      "</dd></div>" +
      '<div><dt>Arquivos parseados</dt><dd>' +
      escapeHtml(String(data.files_parsed ?? "—")) +
      "</dd></div>" +
      '<div><dt>Propostas extraídas</dt><dd>' +
      escapeHtml(String(data.quotes_extracted ?? "—")) +
      "</dd></div>" +
      '<div><dt>Tempo de execução</dt><dd>' +
      escapeHtml(data.executionTime || "—") +
      "</dd></div>" +
      '<div><dt>Fonte da análise</dt><dd><span class="' +
      asp.badgeClass +
      '">' +
      escapeHtml(asp.label) +
      "</span> " +
      '<span class="batch-muted">(' +
      escapeHtml(data.analysis_source || "—") +
      ")</span></dd></div>" +
      "</dl>" +
      "</section>"
    );
  }

  /**
   * Quando o usuário esperava IA na comparação mas a chamada não ocorreu ou falhou.
   * Campo `ai_comparison_feedback` vem do backend (compare-batch).
   */
  function renderAiComparisonFeedbackBanner(data) {
    const fb = data && data.ai_comparison_feedback;
    if (!fb || typeof fb !== "object") return "";
    if (fb.status === "ok") return "";
    if (!fb.user_message) return "";
    if (!fb.requested) {
      return (
        '<div class="batch-alert batch-alert--info" role="status">' +
        "<strong>Comparação sem IA extra</strong>" +
        "<p>" +
        escapeHtml(fb.user_message) +
        "</p>" +
        "</div>"
      );
    }
    return (
      '<div class="batch-alert batch-alert--warn" role="alert">' +
      "<strong>IA assistida indisponível ou incompleta</strong>" +
      "<p>" +
      escapeHtml(fb.user_message) +
      "</p>" +
      "</div>"
    );
  }

  function renderPriorityAlert(data) {
    if (data.manual_review_required) {
      return (
        '<div class="batch-alert batch-alert--blocking" role="alert">' +
        '<strong>Revisão manual necessária</strong>' +
        "<p>Existem inconsistências ou pontos que exigem conferência humana antes de decidir pelo lote.</p>" +
        "</div>"
      );
    }
    return (
      '<div class="batch-alert batch-alert--ok" role="status">' +
      "<strong>Lote processado sem exigência de revisão obrigatória</strong>" +
      "<p>Revise os valores e o ranking abaixo antes da decisão final.</p>" +
      "</div>"
    );
  }

  function renderReviewSummaryPanel(rs) {
    if (!rs || typeof rs !== "object") {
      return (
        '<section class="batch-card" aria-labelledby="batch-review-title">' +
        '<h3 id="batch-review-title" class="batch-card__title">Revisão assistida</h3>' +
        '<p class="batch-muted">Sem dados de revisão neste lote.</p>' +
        "</section>"
      );
    }
    const counts =
      '<ul class="batch-sev-counts">' +
      '<li class="batch-sev-counts__item batch-sev-counts__item--blocking"><span class="batch-sev-label">Bloqueantes</span> <strong>' +
      escapeHtml(String(rs.blocking_issue_count ?? 0)) +
      "</strong></li>" +
      '<li class="batch-sev-counts__item batch-sev-counts__item--error"><span class="batch-sev-label">Erros</span> <strong>' +
      escapeHtml(String(rs.error_issue_count ?? 0)) +
      "</strong></li>" +
      '<li class="batch-sev-counts__item batch-sev-counts__item--warning"><span class="batch-sev-label">Avisos</span> <strong>' +
      escapeHtml(String(rs.warning_issue_count ?? 0)) +
      "</strong></li>" +
      '<li class="batch-sev-counts__item batch-sev-counts__item--info"><span class="batch-sev-label">Info</span> <strong>' +
      escapeHtml(String(rs.info_issue_count ?? 0)) +
      "</strong></li>" +
      "</ul>";

    function listBlock(title, arr, className) {
      const a = Array.isArray(arr) ? arr : [];
      if (!a.length) return "";
      const items = a
        .map(function (x) {
          return "<li>" + escapeHtml(typeof x === "string" ? x : JSON.stringify(x)) + "</li>";
        })
        .join("");
      return (
        '<div class="batch-subblock ' +
        (className || "") +
        '"><h4 class="batch-subblock__title">' +
        escapeHtml(title) +
        "</h4><ol class=\"batch-ol\">" +
        items +
        "</ol></div>"
      );
    }

    return (
      '<section class="batch-card" aria-labelledby="batch-review-title">' +
      '<h3 id="batch-review-title" class="batch-card__title">Revisão assistida</h3>' +
      counts +
      listBlock("Principais motivos", rs.top_review_reasons, "batch-subblock--blocking") +
      listBlock("Fila de prioridade", rs.priority_queue, "batch-subblock--error") +
      listBlock("Ações sugeridas", rs.recommended_actions, "batch-subblock--warning") +
      "</section>"
    );
  }

  function renderWinnerPanel(cr) {
    if (!cr || !cr.winner_suggested) {
      return (
        '<section class="batch-card" aria-labelledby="batch-winner-title">' +
        '<h3 id="batch-winner-title" class="batch-card__title">Vencedor sugerido</h3>' +
        '<p class="batch-muted">Não foi possível determinar um vencedor automaticamente.</p>' +
        "</section>"
      );
    }
    const w = cr.winner_suggested;
    const name = w.name || w.supplier_key || "—";
    const rk = Array.isArray(cr.ranking) ? cr.ranking.find(function (r) {
      return r.supplier_key === w.supplier_key || String(r.supplier_key) === String(w.supplier_key);
    }) : null;
    const score = rk && typeof rk.score === "number" ? rk.score.toFixed(1) : "—";
    const just = Array.isArray(cr.justifications)
      ? cr.justifications.find(function (j) {
          return j.supplier_key === w.supplier_key;
        })
      : null;
    const bullets = just && Array.isArray(just.bullets) ? just.bullets : [];
    const allAlerts = Array.isArray(cr.alerts) ? cr.alerts : [];
    const wKey = w.supplier_key != null ? String(w.supplier_key) : "";
    const wName = w.name != null ? String(w.name) : "";
    const winnerAlerts = allAlerts.filter(function (a) {
      const s = typeof a === "string" ? a : JSON.stringify(a);
      const sl = s.toLowerCase();
      return (wKey && sl.includes(wKey.toLowerCase())) || (wName && s.includes(wName));
    });
    const alertsToShow = winnerAlerts.length ? winnerAlerts : allAlerts.slice(0, 8);

    let bulletsHtml = "";
    if (bullets.length) {
      bulletsHtml =
        '<ul class="batch-ul">' +
        bullets.map(function (b) {
          return "<li>" + escapeHtml(b) + "</li>";
        }).join("") +
        "</ul>";
    } else {
      bulletsHtml = '<p class="batch-muted">Sem justificativas detalhadas.</p>';
    }

    let alertsHtml = "";
    if (alertsToShow.length) {
      alertsHtml =
        '<div class="batch-subblock batch-subblock--warning"><h4 class="batch-subblock__title">' +
        (winnerAlerts.length ? "Alertas associados ao vencedor" : "Alertas do lote (gerais)") +
        "</h4><ul class=\"batch-ul\">" +
        alertsToShow
          .slice(0, 12)
          .map(function (a) {
            return "<li>" + escapeHtml(typeof a === "string" ? a : JSON.stringify(a)) + "</li>";
          })
          .join("") +
        "</ul></div>";
    }

    return (
      '<section class="batch-card batch-card--winner" aria-labelledby="batch-winner-title">' +
      '<h3 id="batch-winner-title" class="batch-card__title">Vencedor sugerido</h3>' +
      '<p class="batch-winner-name">' +
      escapeHtml(name) +
      "</p>" +
      '<p class="batch-winner-meta">Score: <strong>' +
      escapeHtml(String(score)) +
      "</strong></p>" +
      '<div class="batch-subblock"><h4 class="batch-subblock__title">Justificativas</h4>' +
      bulletsHtml +
      "</div>" +
      alertsHtml +
      "</section>"
    );
  }

  function rankRowStatus(r) {
    const pos = r.rank;
    if (pos === 1) return "Melhor posição";
    if (typeof r.score === "number" && r.score >= 70) return "Competitivo";
    return "Revisar";
  }

  function rankRowAlertsSnippet(alerts, r) {
    const list = Array.isArray(alerts) ? alerts : [];
    if (!list.length) return "—";
    const key = r.supplier_key != null ? String(r.supplier_key) : "";
    const nm = r.name != null ? String(r.name) : "";
    const matched = list.filter(function (a) {
      const s = typeof a === "string" ? a : JSON.stringify(a);
      const sl = s.toLowerCase();
      return (key && sl.includes(key.toLowerCase())) || (nm && s.includes(nm));
    });
    const use = matched.slice(0, 2);
    if (!use.length) return "—";
    const text = use
      .map(function (a) {
        return typeof a === "string" ? a : JSON.stringify(a);
      })
      .join(" · ");
    if (!text) return "—";
    return text.length > 120 ? text.slice(0, 117) + "…" : text;
  }

  function renderRankingTable(cr) {
    const rows = cr && Array.isArray(cr.ranking) ? cr.ranking : [];
    const globalAlerts = cr && Array.isArray(cr.alerts) ? cr.alerts : [];
    if (!rows.length) {
      return (
        '<section class="batch-card" aria-labelledby="batch-rank-title">' +
        '<h3 id="batch-rank-title" class="batch-card__title">Ranking</h3>' +
        '<p class="batch-muted">Ranking não disponível.</p>' +
        "</section>"
      );
    }
    const thead =
      "<thead><tr><th>#</th><th>Fornecedor</th><th>Score</th><th>Total R$</th><th>Status</th><th>Alertas</th></tr></thead>";
    const body = rows
      .map(function (r) {
        const pos = r.rank != null ? r.rank : "";
        const name = r.name || r.supplier_key || "—";
        const score = typeof r.score === "number" ? r.score.toFixed(1) : "—";
        const tot = typeof r.total === "number" ? r.total.toFixed(2) : String(r.total ?? "—");
        const status = rankRowStatus(r);
        const alertSnip = rankRowAlertsSnippet(globalAlerts, r);
        return (
          "<tr><td>" +
          escapeHtml(String(pos)) +
          "</td><td>" +
          escapeHtml(String(name)) +
          "</td><td>" +
          escapeHtml(String(score)) +
          "</td><td>" +
          escapeHtml(String(tot)) +
          "</td><td>" +
          escapeHtml(status) +
          "</td><td class=\"batch-table__alerts\">" +
          escapeHtml(alertSnip) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<section class="batch-card" aria-labelledby="batch-rank-title">' +
      '<h3 id="batch-rank-title" class="batch-card__title">Ranking</h3>' +
      '<div class="batch-table-wrap" tabindex="0" role="region" aria-label="Tabela de ranking">' +
      '<table class="batch-table">' +
      thead +
      "<tbody>" +
      body +
      "</tbody></table></div></section>"
    );
  }

  function renderAnalyticSummaryPanel(data) {
    const s = data.analytic_summary;
    const src = data.analysis_source || "";
    if (s == null) {
      return (
        '<section class="batch-card" aria-labelledby="batch-analytic-title">' +
        '<h3 id="batch-analytic-title" class="batch-card__title">Resumo analítico</h3>' +
        '<p class="batch-muted">' +
        (src === "deterministic"
          ? "Resumo gerado apenas de forma determinística (sem texto analítico adicional da IA)."
          : "Nenhum resumo analítico disponível para este lote.") +
        "</p>" +
        "</section>"
      );
    }
    const parts = [];
    if (typeof s === "string") {
      parts.push("<p>" + escapeHtml(s) + "</p>");
    } else {
      if (s.winner_summary) parts.push("<p><strong>Resumo do vencedor:</strong> " + escapeHtml(s.winner_summary) + "</p>");
      if (s.concise_reasoning) parts.push("<p><strong>Raciocínio:</strong> " + escapeHtml(s.concise_reasoning) + "</p>");
      if (typeof s.confidence === "number") {
        parts.push("<p><strong>Confiança (IA):</strong> " + escapeHtml(String(s.confidence)) + "</p>");
      }
      const rest = Object.keys(s).filter(function (k) {
        return ["winner_summary", "concise_reasoning", "confidence", "manual_review_required"].indexOf(k) === -1;
      });
      if (rest.length) {
        parts.push("<pre class=\"batch-pre\">" + escapeHtml(JSON.stringify(s, null, 2)) + "</pre>");
      }
    }
    return (
      '<section class="batch-card" aria-labelledby="batch-analytic-title">' +
      '<h3 id="batch-analytic-title" class="batch-card__title">Resumo analítico</h3>' +
      '<div class="batch-analytic-body">' +
      parts.join("") +
      "</div></section>"
    );
  }

  function renderDownloadFab(data) {
    const href = buildDownloadHref(data);
    const fname = data.export_filename || "";
    if (!href) {
      return '<p class="batch-muted" style="pointer-events:auto;text-align:center;max-width:280px;margin:0;">Link de download não disponível.</p>';
    }
    return (
      '<a class="batch-download-pill" href="' +
      escapeHtml(href) +
      '" target="_blank" rel="noopener noreferrer" download ' +
      'title="' +
      escapeHtml(fname || "Download Excel") +
      '" aria-label="Download Excel — planilha comparativa XLSX">' +
      '<span class="batch-download-pill__icon" aria-hidden="true">⬇</span>' +
      "Download Excel" +
      "</a>"
    );
  }

  function renderDownloadPanel(data) {
    const href = buildDownloadHref(data);
    const fname = data.export_filename || "";
    if (!href) {
      return (
        '<section class="batch-card batch-card--download" aria-labelledby="batch-dl-title">' +
        '<h3 id="batch-dl-title" class="batch-card__title">Download</h3>' +
        '<p class="batch-muted">Link de download não disponível para este resultado.</p>' +
        "</section>"
      );
    }
    return (
      '<section class="batch-card batch-card--download" aria-labelledby="batch-dl-title">' +
      '<h3 id="batch-dl-title" class="batch-card__title">Planilha consolidada</h3>' +
      (fname ? '<p class="batch-filename">Arquivo: <code class="batch-code">' + escapeHtml(fname) + "</code></p>" : "") +
      '<a class="batch-download-btn" href="' +
      escapeHtml(href) +
      '" target="_blank" rel="noopener noreferrer" download>Baixar XLSX comparativo</a>' +
      "</section>"
    );
  }

  var WARN_PREVIEW = 6;

  function renderWarningsPanel(warnings) {
    const list = Array.isArray(warnings) ? warnings : [];
    if (!list.length) {
      return { html: "", toggleId: null, moreId: null };
    }
    const id = "batch-warn-" + String(Math.random()).slice(2);
    const preview = list.slice(0, WARN_PREVIEW);
    const rest = list.length - preview.length;
    const items = preview
      .map(function (w) {
        return "<li>" + escapeHtml(typeof w === "string" ? w : JSON.stringify(w)) + "</li>";
      })
      .join("");
    var html =
      '<section class="batch-card batch-card--warnings" aria-labelledby="' +
      id +
      '-title">' +
      '<h3 id="' +
      id +
      '-title" class="batch-card__title">Avisos gerais</h3>' +
      '<ul class="batch-ul batch-warn-list" id="' +
      id +
      '-list">' +
      items +
      "</ul>";
    if (rest > 0) {
      const hidden = list
        .slice(WARN_PREVIEW)
        .map(function (w) {
          return "<li>" + escapeHtml(typeof w === "string" ? w : JSON.stringify(w)) + "</li>";
        })
        .join("");
      html +=
        '<ul class="batch-ul batch-warn-list batch-warn-list--hidden" id="' +
        id +
        '-more" hidden>' +
        hidden +
        "</ul>" +
        '<button type="button" class="batch-btn-text" id="' +
        id +
        '-toggle" aria-expanded="false">Mostrar mais (' +
        rest +
        ")</button>";
    }
    html += "</section>";
    return { html: html, toggleId: rest > 0 ? id + "-toggle" : null, moreId: rest > 0 ? id + "-more" : null };
  }

  function wireWarningsToggle(toggleId, moreId) {
    if (!toggleId || !moreId) return;
    var btn = document.getElementById(toggleId);
    var more = document.getElementById(moreId);
    if (!btn || !more) return;
    var extraCount = more.querySelectorAll("li").length;
    btn.addEventListener("click", function () {
      more.hidden = !more.hidden;
      var collapsed = more.hidden;
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.textContent = collapsed
        ? "Mostrar mais (" + extraCount + ")"
        : "Recolher avisos extras";
    });
  }

  function renderSuccess(container, data) {
    container.innerHTML = "";
    container.className = RESULT_HOST_CLASS + " batch-result-root batch-result-root--success";

    const cr = data.comparison_result || {};

    var html = "";
    html += renderPriorityAlert(data);
    html += renderAiComparisonFeedbackBanner(data);
    html += renderBatchSummaryCard(data);
    html += renderReviewSummaryPanel(data.review_summary);
    html += renderWinnerPanel(cr);
    html += renderRankingTable(cr);
    html += renderAnalyticSummaryPanel(data);
    html += renderDownloadPanel(data);

    var w = renderWarningsPanel(data.warnings);
    html += w.html;

    container.innerHTML = html;

    if (w.toggleId) {
      wireWarningsToggle(w.toggleId, w.moreId);
    }
  }

  /** Só o bloco de download (XLSX) — usado quando o dashboard completo está oculto. opts.variant "fab" = pill central sobre a área da animação (após blur). */
  function renderDownloadOnly(container, data, opts) {
    if (!container) return;
    if (opts && opts.variant === "fab") {
      container.innerHTML = renderDownloadFab(data);
    } else {
      container.innerHTML = renderDownloadPanel(data);
    }
  }

  /** Erro compacto para área de resultado sem host de dashboard. opts.overlay envolve o alerta para centralizar na coluna de análise. */
  function renderOutcomeError(container, err, httpStatus, bodyData, opts) {
    if (!container) return;
    const msg =
      mapBatchErrorMessage(bodyData, httpStatus) ||
      (err && err.message) ||
      "Erro desconhecido.";
    const inner =
      '<div class="batch-alert batch-alert--blocking" role="alert">' +
      "<strong>Falha na comparação</strong>" +
      "<p>" +
      escapeHtml(msg) +
      "</p>" +
      "</div>";
    if (opts && opts.overlay) {
      container.innerHTML = '<div class="ai-outcome--errorBox">' + inner + "</div>";
    } else {
      container.innerHTML = inner;
    }
  }

  function mapBatchErrorMessage(data, httpStatus) {
    if (data && data.code === "BATCH_FILE_COUNT_INVALID") {
      return "Envie entre 2 e 10 planilhas Excel (.xlsx ou .xls). Verifique a quantidade de arquivos selecionados.";
    }
    if (data && data.code === "BATCH_MIN_QUOTES_NOT_MET") {
      return "Não foi possível extrair propostas válidas o suficiente a partir dos arquivos. Confira se as planilhas têm o formato esperado e se há pelo menos duas propostas comparáveis.";
    }
    if (data && data.message) return String(data.message);
    if (data && data.error) return String(data.error);
    if (httpStatus === 413) return "Arquivos muito grandes ou requisição recusada pelo servidor.";
    if (httpStatus >= 500) return "Erro no servidor ao processar o lote. Tente novamente ou contate o suporte.";
    if (!httpStatus || httpStatus === 0) {
      return "Não foi possível contactar o servidor. Verifique a rede ou tente novamente.";
    }
    return "Não foi possível concluir a comparação. Verifique os arquivos e tente de novo.";
  }

  function renderError(container, err, httpStatus, bodyData) {
    container.className = RESULT_HOST_CLASS + " batch-result-root batch-result-root--error";
    const msg = mapBatchErrorMessage(bodyData, httpStatus) || (err && err.message) || "Erro desconhecido.";
    container.innerHTML =
      '<div class="batch-alert batch-alert--blocking" role="alert">' +
      "<strong>Falha na comparação</strong>" +
      "<p>" +
      escapeHtml(msg) +
      "</p>" +
      "</div>";
  }

  function renderLoading(container, opts) {
    container.className = RESULT_HOST_CLASS + " batch-result-root batch-result-root--loading";
    container.innerHTML =
      '<div class="batch-loading" role="status" aria-live="polite">' +
      '<div class="batch-loading__spinner" aria-hidden="true"></div>' +
      "<p><strong>Analisando o lote…</strong></p>" +
      "<p class=\"batch-muted\">" +
      escapeHtml(
        opts && opts.skipOpenAI
          ? "Parse, consolidação e ranking em andamento (modo sem IA extra)."
          : "Processamento em andamento; pode incluir resumo analítico via OpenAI se configurado."
      ) +
      "</p></div>";
  }

  function renderIdle(container) {
    container.className = RESULT_HOST_CLASS + " batch-result-root batch-result-root--idle";
    container.innerHTML =
      '<p class="batch-idle-msg">Nenhum lote analisado ainda. Envie 2 a 10 planilhas e escolha o tipo de comparação.</p>';
  }

  global.BatchResultUi = {
    escapeHtml: escapeHtml,
    renderSuccess: renderSuccess,
    renderError: renderError,
    renderLoading: renderLoading,
    renderIdle: renderIdle,
    renderDownloadOnly: renderDownloadOnly,
    renderOutcomeError: renderOutcomeError,
    buildDownloadHref: buildDownloadHref,
    mapBatchErrorMessage: mapBatchErrorMessage,
  };
})(typeof window !== "undefined" ? window : globalThis);
