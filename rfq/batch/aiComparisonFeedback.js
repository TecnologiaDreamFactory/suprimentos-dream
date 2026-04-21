/**
 * Mensagem clara para o front quando o usuário espera IA na comparação em lote,
 * mas a chamada não ocorreu ou não teve sucesso (resumo analítico).
 * Não altera ranking nem totais — só comunicação.
 */

/**
 * @param {object} o
 * @param {boolean} o.skipOpenAI
 * @param {boolean} o.apiConfigured — OPENAI_API_KEY presente e válida
 * @param {boolean} o.enableAnalyticSummary — OPENAI_ENABLE_ANALYTIC_SUMMARY
 * @param {boolean} o.enableSemanticItemMatch — OPENAI_ENABLE_SEMANTIC_ITEM_MATCH
 * @param {boolean} o.analyticSummaryOk — objeto retornado por generateAnalyticSummary
 * @param {boolean} o.openaiAnalyticThrew — exceção fora do client (raro)
 * @param {number} [o.semanticMatchAttemptedCount]
 * @returns {{
 *   requested: boolean,
 *   status: string,
 *   user_message: string,
 *   analytic_summary_ok: boolean,
 *   semantic_match_note: string|null
 * }}
 */
function buildAiComparisonFeedback(o) {
  const {
    skipOpenAI,
    apiConfigured,
    enableAnalyticSummary,
    enableSemanticItemMatch,
    analyticSummaryOk,
    openaiAnalyticThrew,
    semanticMatchAttemptedCount = 0,
  } = o;

  const requested = !skipOpenAI;

  /** @type {string|null} */
  let semantic_note = null;
  if (requested && enableSemanticItemMatch && !apiConfigured) {
    semantic_note =
      "Equivalência semântica de itens não foi executada: API OpenAI não configurada no servidor.";
  }

  if (!requested) {
    return {
      requested: false,
      status: "skipped_by_client",
      user_message:
        "Você optou por processar este lote sem IA extra. O resultado usa apenas regras determinísticas.",
      analytic_summary_ok: false,
      semantic_match_note: null,
    };
  }

  if (!apiConfigured) {
    const base =
      "A comparação assistida por IA não está disponível: a chave OpenAI (OPENAI_API_KEY) não está configurada no servidor. Ranking e totais foram calculados de forma determinística.";
    return {
      requested: true,
      status: "api_not_configured",
      user_message: semantic_note ? `${base} ${semantic_note}` : base,
      analytic_summary_ok: false,
      semantic_match_note: semantic_note,
    };
  }

  if (!enableAnalyticSummary) {
    return {
      requested: true,
      status: "analytic_summary_disabled",
      user_message:
        "O resumo analítico em texto (IA) está desativado (OPENAI_ENABLE_ANALYTIC_SUMMARY). Os números e o ranking seguem o motor determinístico.",
      analytic_summary_ok: false,
      semantic_match_note: null,
    };
  }

  if (openaiAnalyticThrew) {
    return {
      requested: true,
      status: "analytic_call_error",
      user_message:
        "Ocorreu um erro inesperado ao processar a resposta da IA. O resultado deste lote é apenas determinístico.",
      analytic_summary_ok: false,
      semantic_match_note: null,
    };
  }

  if (!analyticSummaryOk) {
    return {
      requested: true,
      status: "analytic_call_failed",
      user_message:
        "A API de IA não retornou um resumo analítico utilizável (rede, timeout ou resposta inválida). A comparação numérica foi concluída normalmente sem o texto assistido.",
      analytic_summary_ok: false,
      semantic_match_note: null,
    };
  }

  let okMsg = "Resumo analítico gerado com sucesso pela IA.";
  if (enableSemanticItemMatch && semanticMatchAttemptedCount > 0) {
    okMsg += " Foi avaliada também equivalência semântica opcional de itens onde aplicável.";
  }
  return {
    requested: true,
    status: "ok",
    user_message: okMsg,
    analytic_summary_ok: true,
    semantic_match_note: null,
  };
}

module.exports = {
  buildAiComparisonFeedback,
};
