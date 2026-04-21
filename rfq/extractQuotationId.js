/**
 * Extração de quotation_id / RFQ no topo da planilha — separada da lógica de fornecedores.
 * Prioriza padrões típicos de cotação e reduz falsos positivos (ex.: fragmentos de nomes).
 */

const { getCellDisplayValue } = require("./io/readWorkbook");
const { mapHeaderToCanonical } = require("./columnMapping");

/** Pontuação mínima para aceitar um candidato (0–100). */
const MIN_SCORE_ACCEPT = 58;

/**
 * Padrões adicionais (nome, regex global, grupo de captura, score base).
 */
const CONFIGURABLE_PATTERNS = [
  {
    name: "df_year_serial",
    re: /\b([A-Z]{2,4}-\d{4}-\d{3,})\b/gi,
    group: 1,
    score: 100,
  },
  {
    name: "rfq_prefix",
    re: /\bRFQ(?:\s*[:#]\s*|[-\s]+)([A-Za-z0-9][A-Za-z0-9\-_/]{1,40})\b/gi,
    group: 1,
    score: 93,
  },
  {
    name: "rfq_hyphen_token",
    re: /\b(RFQ-[A-Za-z0-9][A-Za-z0-9\-_/]{1,40})\b/gi,
    group: 1,
    score: 94,
  },
  {
    name: "tp_prefix",
    re: /\bTP\s*[:#]\s*([A-Za-z0-9][A-Za-z0-9\-_/]{0,24}(?:\/\d{2,4})?)\b/gi,
    group: 1,
    score: 91,
  },
  {
    name: "cotacao_label",
    re: /\bCota[cç][aã]o\s*[:#]\s*([A-Z0-9][A-Za-z0-9\-_/]{2,45})\b/gi,
    group: 1,
    score: 86,
  },
  {
    name: "pedido_oc",
    re: /\b(?:Pedido|OC|O\.C\.|Ordem\s+de\s+compra)\s*[:#]?\s*([A-Z0-9][A-Za-z0-9\-_/]{2,35})\b/gi,
    group: 1,
    score: 82,
  },
  {
    name: "ref_id",
    re: /\b(?:Ref\.?|REF|Referência)\s*[:#]\s*([A-Z0-9][A-Za-z0-9\-_/]{2,35})\b/gi,
    group: 1,
    score: 78,
  },
];

/**
 * Nº documento: exige dígito no ID (evita "Nebula" → "ebula" via padrão N[º] genérico).
 */
const N_DOC_PATTERN = {
  name: "n_doc_number",
  re: /\bN[º°]?\s*[:\s]+\s*([0-9A-Z][0-9A-Z\-_/]{2,30}\d)\b/gi,
  group: 1,
  score: 84,
};

function gridMaxCol(rows) {
  let m = 0;
  for (const row of rows) {
    m = Math.max(m, row ? row.length : 0);
  }
  return Math.max(m, 8);
}

/**
 * Texto que parece rótulo de coluna (não usar como RFQ).
 */
function looksLikeColumnHeaderText(text) {
  const m = mapHeaderToCanonical(String(text || ""));
  if (!m.field) return false;
  return m.confidence >= 0.55 && ["descricao", "quantidade", "preco_unitario", "total"].includes(m.field);
}

/**
 * Nome próprio / fornecedor sem estrutura de código (sem dígitos, só letras curtas).
 */
function looksLikeSupplierOrNameFragment(id) {
  const t = String(id || "").trim();
  if (t.length < 3) return true;
  const compact = t.replace(/\s+/g, "");
  if (compact.length <= 25 && /^[A-Za-zÀ-ÿ]+$/u.test(compact)) {
    if (!/\d/.test(compact) && compact.length <= 18) return true;
  }
  return false;
}

function normalizeCandidate(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/[.,;]+$/g, "");
  return s;
}

function adjustScore(base, patternKey, normalizedId) {
  let s = base;
  if (/\d{4,}/.test(normalizedId)) s += 4;
  if (/^[A-Z]{2,4}-\d{4}-/i.test(normalizedId)) s += 8;
  if (patternKey === "cotacao_label" && looksLikeSupplierOrNameFragment(normalizedId)) s -= 50;
  return Math.min(100, Math.max(0, s));
}

/**
 * @param {string[][]} rows
 * @param {object[]} merges
 * @param {number} headerRow
 * @returns {{ value: string|null, confidence: number, alerts: string[] }}
 */
function extractQuotationIdFromSheet(rows, merges, headerRow) {
  const alerts = [];
  /** @type {{ id: string, score: number, row: number, col: number, pattern: string }[]} */
  const rawCandidates = [];

  const scanRows = Math.min(Math.max(headerRow + 2, 10), rows.length, 14);
  const scanCols = Math.min(10, gridMaxCol(rows));

  const patternList = [...CONFIGURABLE_PATTERNS, N_DOC_PATTERN];

  for (let r = 0; r < scanRows; r++) {
    for (let c = 0; c < scanCols; c++) {
      const text = getCellDisplayValue(r, c, rows, merges);
      if (!text || !String(text).trim()) continue;
      if (looksLikeColumnHeaderText(text)) continue;

      const t = String(text);

      for (const def of patternList) {
        def.re.lastIndex = 0;
        let m;
        while ((m = def.re.exec(t)) !== null) {
          const cap = m[def.group];
          if (!cap) continue;
          const id = normalizeCandidate(cap);
          if (!id) continue;

          if (def.name === "cotacao_label" || def.name === "pedido_oc" || def.name === "ref_id") {
            if (looksLikeSupplierOrNameFragment(id)) continue;
          }

          let score = adjustScore(def.score, def.name, id);
          const positionBonus = Math.min(12, (8 - r) * 1.2 + (6 - c) * 0.35);
          score = Math.min(100, score + positionBonus);

          rawCandidates.push({
            id,
            score,
            row: r,
            col: c,
            pattern: def.name,
          });
        }
      }
    }
  }

  /** @type {Map<string, { id: string, score: number, row: number, col: number, pattern: string }>} */
  const byId = new Map();
  for (const cand of rawCandidates) {
    const prev = byId.get(cand.id);
    if (!prev || cand.score > prev.score || (cand.score === prev.score && (cand.row < prev.row || (cand.row === prev.row && cand.col < prev.col)))) {
      byId.set(cand.id, cand);
    }
  }

  const candidates = [...byId.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  if (candidates.length === 0) {
    alerts.push(
      "quotation_id: nenhum padrão confiável de RFQ/cotação encontrado no topo da planilha — usando identificador do lote quando aplicável."
    );
    return { value: null, confidence: 0, alerts };
  }

  const best = candidates[0];
  if (best.score < MIN_SCORE_ACCEPT) {
    alerts.push(
      "quotation_id: candidatos no topo da planilha com confiança insuficiente — usando identificador do lote quando aplicável."
    );
    return { value: null, confidence: best.score / 100, alerts };
  }

  const second = candidates[1];
  if (second && second.id !== best.id && second.score >= MIN_SCORE_ACCEPT && second.row <= 3 && best.row <= 3) {
    alerts.push(
      `quotation_id: múltiplos códigos plausíveis no topo (${best.id} vs ${second.id}) — selecionado o de maior pontuação (${best.pattern}).`
    );
  }

  return {
    value: best.id,
    confidence: Math.min(1, best.score / 100),
    alerts,
  };
}

module.exports = {
  extractQuotationIdFromSheet,
  looksLikeSupplierOrNameFragment,
  MIN_SCORE_ACCEPT,
  CONFIGURABLE_PATTERNS,
};
