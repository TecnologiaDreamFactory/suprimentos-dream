/**
 * Validações de negócio do lote (arquivos, propostas, consistência).
 */

const { BATCH_ERROR_CODES, MIN_BATCH_FILES, MAX_BATCH_FILES, MIN_VALID_QUOTES } = require("./batchTypes");

/**
 * @param {number} n
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
function validateFileCount(n) {
  if (typeof n !== "number" || n < MIN_BATCH_FILES || n > MAX_BATCH_FILES) {
    return {
      ok: false,
      code: BATCH_ERROR_CODES.FILE_COUNT,
      message: `Envie entre ${MIN_BATCH_FILES} e ${MAX_BATCH_FILES} arquivos (recebido: ${n}).`,
    };
  }
  return { ok: true };
}

/**
 * @param {import('./extractSupplierQuotes').SupplierQuote[]} quotes
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
function validateMinQuotes(quotes) {
  if (!quotes || quotes.length < MIN_VALID_QUOTES) {
    return {
      ok: false,
      code: BATCH_ERROR_CODES.MIN_QUOTES,
      message: `São necessárias pelo menos ${MIN_VALID_QUOTES} propostas válidas (fornecedores parseados).`,
    };
  }
  return { ok: true };
}

/**
 * @param {import('./batchTypes').ParsedQuotationFile[]} parsedFiles
 * @param {import('./consolidateQuotes').ConsolidatedMatrix} matrix
 * @returns {{ inconsistencies: import('./batchTypes').BatchInconsistency[], warnings: string[] }}
 */
function collectBatchInconsistencies(parsedFiles, matrix) {
  /** @type {import('./batchTypes').BatchInconsistency[]} */
  const inconsistencies = [];
  const warnings = [];

  const ids = new Set();
  for (const pf of parsedFiles) {
    if (pf.parse_ok && pf.quotation_id) ids.add(pf.quotation_id);
  }
  if (ids.size > 1) {
    const msg = `quotation_id distintos entre arquivos: ${[...ids].join(", ")}`;
    warnings.push(msg);
    inconsistencies.push({
      code: "QUOTATION_ID_DIVERGENT",
      message: msg,
      severity: "blocking",
      type: "quotation_id",
      detail: msg,
    });
  }

  for (const row of matrix.rows) {
    for (const pk of matrix.proposal_keys) {
      const cell = row.by_proposal[pk];
      if (cell?.missing) {
        const label = matrix.proposal_labels[pk] || pk;
        inconsistencies.push({
          code: "ITEM_MISSING",
          message: `Item ausente para ${label}`,
          severity: "error",
          type: "item_missing",
          supplier: label,
          detail: row.reference_description || row.item_key,
          file: label.split("(").pop()?.replace(")", "").trim(),
        });
      }
      if (cell?.quantity_divergent) {
        inconsistencies.push({
          code: "QTY_DIVERGENT",
          message: `Quantidade divergente no item "${row.item_key}"`,
          severity: "info",
          type: "quantity_divergent",
          detail: row.item_key,
        });
      }
    }
  }

  return { inconsistencies, warnings };
}

module.exports = {
  validateFileCount,
  validateMinQuotes,
  collectBatchInconsistencies,
  MIN_BATCH_FILES,
  MAX_BATCH_FILES,
  MIN_VALID_QUOTES,
};
