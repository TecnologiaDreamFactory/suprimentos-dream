/**
 * Tipos e constantes do fluxo de comparação em lote (documentação JSDoc).
 */

/** @typedef {{ code: string, message: string, severity?: string, file?: string, supplier?: string }} BatchInconsistency */

/**
 * @typedef {object} ParsedQuotationFile
 * @property {number} file_index
 * @property {string} source_filename
 * @property {string} [quotation_id]
 * @property {boolean} parse_ok
 * @property {string} [parse_error]
 * @property {string[]} [parse_errors]
 * @property {import('./extractSupplierQuotes').SupplierQuote[]} supplier_quotes
 * @property {object} [pipeline_result] snapshot mínimo ou completo
 */

/**
 * @typedef {object} SupplierQuote
 * @property {string} proposal_key
 * @property {string} proposal_label
 * @property {string} supplier_name
 * @property {string} source_filename
 * @property {string} quotation_id
 * @property {number} file_index
 * @property {import('./extractSupplierQuotes').QuoteLineItem[]} items
 * @property {number} freight_total
 * @property {number|null} declared_total
 * @property {number} recalculated_total
 * @property {unknown} [installments]
 * @property {unknown} [payment_terms]
 * @property {{ label: string, value: string }[]} [uncategorized_rows]
 * @property {string[]} warnings
 */

/**
 * @typedef {object} ComparisonBatch
 * @property {string} batch_id
 * @property {string} created_at
 * @property {ParsedQuotationFile[]} files
 * @property {SupplierQuote[]} valid_quotes
 * @property {import('./consolidateQuotes').ConsolidatedMatrix} consolidated
 */

/**
 * @typedef {object} BatchComparisonResult
 * @property {{ supplier_key: string, rank: number, score: number, total: number }[]} ranking
 * @property {{ supplier_key: string, name: string }} winner_suggested
 * @property {string[]} alerts
 * @property {{ supplier_key: string, bullets: string[] }[]} justifications
 */

const MIN_BATCH_FILES = 2;
const MAX_BATCH_FILES = 10;
const MIN_VALID_QUOTES = 2;

const BATCH_ERROR_CODES = {
  FILE_COUNT: "BATCH_FILE_COUNT_INVALID",
  MIN_QUOTES: "BATCH_MIN_QUOTES_NOT_MET",
};

module.exports = {
  MIN_BATCH_FILES,
  MAX_BATCH_FILES,
  MIN_VALID_QUOTES,
  BATCH_ERROR_CODES,
};
