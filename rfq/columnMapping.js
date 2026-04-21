/**
 * Mapeamento canônico de colunas RFQ (OpenAI API).
 * Fuzzy matching: "Qtd", "Quantidade", "Qtde" → quantidade
 */

const { SYNONYMS } = require("./config/aliases");

/**
 * Similaridade mínima (0..1) para considerar uma célula como parte do cabeçalho.
 * Valores menores aumentam cobertura e o risco de mapear coluna errada.
 */
const MIN_HEADER_CELL_CONFIDENCE = 0.3;

const CANONICAL_FIELDS = [
  "descricao",
  "quantidade",
  "unidade",
  "preco_unitario",
  "fornecedor",
];

/** Unidades aceitas e padronizadas (saída canônica) */
const UNIDADES_PADRAO = {
  un: "UN",
  unid: "UN",
  unidade: "UN",
  und: "UN",
  "u.m.": "UN",
  "u.m": "UN",
  unit: "UN",
  cx: "CX",
  caixa: "CX",
  caixas: "CX",
  kg: "KG",
  kilograma: "KG",
  kilogramas: "KG",
  kilo: "KG",
  g: "KG", // tratado como KG para simplificar; pode ser aviso
  diária: "DIÁRIA",
  diaria: "DIÁRIA",
  dia: "DIÁRIA",
  "dias": "DIÁRIA",
  mensal: "DIÁRIA", // opcional: mapear para outro código se quiser
  m2: "M²",
  metro: "M²",
  metros: "M²",
  l: "L",
  lt: "L",
  litro: "L",
  litros: "L",
  pç: "PC",
  pc: "PC",
  peça: "PC",
  pecas: "PC",
  pct: "PCT",
  pacote: "PCT",
  pacotes: "PCT",
};

/**
 * Remove acentos e normaliza para comparação.
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  if (typeof str !== "string") return "";
  return str
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Calcula similaridade simples (quanto do nome do header "bate" com algum sinônimo).
 * Retorna 0 a 1: 1 = match exato ou substring forte.
 * Prioriza matches que começam com a palavra-chave (mais específicos).
 */
function similarity(headerNorm, synonyms) {
  if (!headerNorm) return 0;
  let bestScore = 0;
  
  for (const syn of synonyms) {
    const s = normalize(syn);
    
    // Match exato
    if (headerNorm === s) return 1;
    
    // Match quando header começa com sinônimo (mais específico - prioridade alta)
    if (headerNorm.startsWith(s)) {
      const score = s.length / headerNorm.length;
      if (score > bestScore) bestScore = score;
      continue;
    }
    
    // Match quando sinônimo começa com header (também específico)
    if (s.startsWith(headerNorm)) {
      const score = headerNorm.length / s.length;
      if (score > bestScore) bestScore = score;
      continue;
    }
    
    // Match por substring (menos específico - prioridade baixa)
    if (headerNorm.includes(s) || s.includes(headerNorm)) {
      const len = Math.min(headerNorm.length, s.length);
      const maxLen = Math.max(headerNorm.length, s.length);
      const score = len / maxLen;
      // Penalizar matches por substring se não começar com a palavra-chave
      const penalizedScore = score * 0.7;
      if (penalizedScore > bestScore) bestScore = penalizedScore;
    }
  }
  
  return bestScore;
}

/**
 * Mapeia um nome de coluna do Excel para o campo canônico e retorna confiança.
 * @param {string} headerCell - Valor da célula de cabeçalho
 * @returns {{ field: string | null, confidence: number }}
 */
function mapHeaderToCanonical(headerCell) {
  const norm = normalize(String(headerCell || "").trim());
  if (!norm) return { field: null, confidence: 0 };

  let best = { field: null, confidence: 0 };
  for (const [field, synonyms] of Object.entries(SYNONYMS)) {
    const conf = similarity(norm, synonyms);
    if (conf > best.confidence) {
      best = { field, confidence: conf };
    }
  }
  return best;
}

/** Rótulos que não devem ser usados como descrição do item por inferência (pagamento, etc.). */
function isDeniedFallbackDescricaoHeader(norm) {
  if (!norm || norm.length < 2) return true;
  if (/^pix$/i.test(norm)) return true;
  if (/^pgto/.test(norm) || /^pag(amento)?$/i.test(norm)) return true;
  if (/^parcela/i.test(norm)) return true;
  if (/^cond(icao|i[cç])/i.test(norm)) return true;
  if (/^obs/.test(norm)) return true;
  if (/^total$/i.test(norm) || /^subtotal$/i.test(norm)) return true;
  if (/^email$/i.test(norm) || /^tel/i.test(norm) || /^cnpj$/i.test(norm)) return true;
  if (/^nota/i.test(norm)) return true;
  return false;
}

/**
 * Se já há quantidade ou preço mapeados mas nenhuma descrição, usa a primeira coluna não mapeada
 * com rótulo livre (ex.: "Milheiro", "Tijolo", "Insumo X") como descrição do item.
 * Evita depender de uma lista fechada de sinônimos para cada domínio.
 * @param {string[]} row - Linha de cabeçalho
 * @param {Record<number, { field: string, confidence: number }>} mapping
 * @returns {Record<number, { field: string, confidence: number }>}
 */
function applyDescricaoFallbackFromUnmappedColumns(row, mapping) {
  const hasDesc = Object.values(mapping).some((m) => m.field === "descricao");
  if (hasDesc) return mapping;

  const hasQtyOrPrice =
    Object.values(mapping).some((m) => m.field === "quantidade") ||
    Object.values(mapping).some((m) => m.field === "preco_unitario") ||
    Object.values(mapping).some((m) => m.field === "total");
  if (!hasQtyOrPrice) return mapping;

  const mappedIdx = new Set(Object.keys(mapping).map((k) => parseInt(k, 10)));
  for (let c = 0; c < row.length; c++) {
    if (mappedIdx.has(c)) continue;
    const raw = String(row[c] ?? "").trim();
    if (!raw) continue;
    const norm = normalize(raw);
    if (isDeniedFallbackDescricaoHeader(norm)) continue;
    const { field, confidence } = mapHeaderToCanonical(raw);
    if (field && field !== "descricao" && confidence > MIN_HEADER_CELL_CONFIDENCE) continue;

    return {
      ...mapping,
      [c]: { field: "descricao", confidence: 0.42 },
    };
  }
  return mapping;
}

/**
 * Dado um array de valores de uma linha de cabeçalho, retorna o mapeamento
 * colIndex -> { field, confidence } e a linha que foi usada (0-based).
 * A ordem das colunas na planilha não importa; o match é pelo texto do título.
 * @param {string[][]} rows - Primeiras N linhas da planilha (array de arrays)
 * @param {number} maxRowsToTry - Quantas linhas tentar como cabeçalho (ex.: 10)
 * @returns {{ mapping: Record<number, { field: string, confidence: number }>, headerRowIndex: number, score: number }}
 */
function detectHeaderAndMapping(rows, maxRowsToTry = 10) {
  let best = { mapping: {}, headerRowIndex: 0, score: 0 };

  for (let r = 0; r < Math.min(rows.length, maxRowsToTry); r++) {
    const row = rows[r] || [];
    /** @type {Record<number, { field: string, confidence: number }>} */
    let mapping = {};

    for (let c = 0; c < row.length; c++) {
      const { field, confidence } = mapHeaderToCanonical(row[c]);
      if (field && confidence > MIN_HEADER_CELL_CONFIDENCE) {
        mapping[c] = { field, confidence };
      }
    }

    mapping = applyDescricaoFallbackFromUnmappedColumns(row, mapping);
    const matched = Object.keys(mapping).length;
    const totalConf = Object.values(mapping).reduce((s, m) => s + m.confidence, 0);

    // Exigir pelo menos descricao e (quantidade ou preco) para considerar como cabeçalho
    const hasDesc = Object.values(mapping).some((m) => m.field === "descricao");
    const hasQtyOrPrice =
      Object.values(mapping).some((m) => m.field === "quantidade") ||
      Object.values(mapping).some((m) => m.field === "preco_unitario");
    const score = hasDesc && hasQtyOrPrice ? matched * 2 + totalConf : 0;

    if (score > best.score) {
      best = { mapping, headerRowIndex: r, score };
    }
  }

  return best;
}

/**
 * Padroniza unidade para o modelo canônico (UN/CX/KG/DIÁRIA ou mantém se conhecida).
 * @param {string} value
 * @returns {{ normalized: string, known: boolean }}
 */
function normalizeUnidade(value) {
  const v = normalize(String(value || "").trim());
  if (!v) return { normalized: "UN", known: false };
  if (UNIDADES_PADRAO[v] !== undefined) {
    return { normalized: UNIDADES_PADRAO[v], known: true };
  }
  // Manter valor original mas marcar como não padronizado
  const upper = String(value).trim().toUpperCase();
  return { normalized: upper || "UN", known: false };
}

module.exports = {
  CANONICAL_FIELDS,
  SYNONYMS,
  UNIDADES_PADRAO,
  MIN_HEADER_CELL_CONFIDENCE,
  normalize,
  mapHeaderToCanonical,
  applyDescricaoFallbackFromUnmappedColumns,
  detectHeaderAndMapping,
  normalizeUnidade,
};
