/**
 * Paleta quente → fria e vitórias por linha (melhor preço unitário, menor prazo em dias).
 */

/**
 * @param {number} h 0..1 (matiz em volta do círculo)
 * @param {number} s 0..1
 * @param {number} l 0..1
 * @returns {{ r: number, g: number, b: number }}
 */
function hslToRgb(h, s, l) {
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} ARGB para exceljs (FFRRGGBB)
 */
function rgbToArgb(r, g, b) {
  const hex = [r, g, b]
    .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `FF${hex}`;
}

/**
 * @param {number} n quantidade de fornecedores
 * @returns {string[]} cores ARGB, índice 0 = mais quente
 */
function buildWarmToCoolPalette(n) {
  if (n <= 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const hueDeg = t * 240;
    const { r, g, b } = hslToRgb(hueDeg / 360, 0.42, 0.9);
    out.push(rgbToArgb(r, g, b));
  }
  return out;
}

/**
 * @param {import('./consolidateQuotes').ConsolidatedMatrix} consolidated
 * @returns {{
 *   scores: Record<string, number>,
 *   rowWinners: { priceKeys: string[], prazoKeys: string[] }[]
 * }}
 */
function computeRowWins(consolidated) {
  const proposalKeys = consolidated.proposal_keys || [];
  /** @type {Record<string, number>} */
  const scores = Object.fromEntries(proposalKeys.map((k) => [k, 0]));
  /** @type { { priceKeys: string[], prazoKeys: string[] }[] } */
  const rowWinners = [];

  for (const row of consolidated.rows || []) {
    const priceCandidates = [];
    const prazoCandidates = [];
    for (const pk of proposalKeys) {
      const cell = row.by_proposal[pk];
      if (!cell || cell.missing) continue;
      if (cell.unit_price != null && cell.unit_price > 0) {
        priceCandidates.push({ pk, v: cell.unit_price });
      }
      if (cell.prazo_dias != null && cell.prazo_dias > 0) {
        prazoCandidates.push({ pk, v: cell.prazo_dias });
      }
    }

    /** @type {string[]} */
    let priceKeys = [];
    if (priceCandidates.length) {
      const minP = Math.min(...priceCandidates.map((x) => x.v));
      priceKeys = priceCandidates.filter((x) => x.v === minP).map((x) => x.pk);
      for (const pk of priceKeys) scores[pk] = (scores[pk] || 0) + 1;
    }

    /** @type {string[]} */
    let prazoKeys = [];
    if (prazoCandidates.length) {
      const minZ = Math.min(...prazoCandidates.map((x) => x.v));
      prazoKeys = prazoCandidates.filter((x) => x.v === minZ).map((x) => x.pk);
      for (const pk of prazoKeys) scores[pk] = (scores[pk] || 0) + 1;
    }

    rowWinners.push({ priceKeys, prazoKeys });
  }

  return { scores, rowWinners };
}

/**
 * Maior pontuação → cor mais quente; empate na pontuação → `proposal_key` ascendente.
 *
 * @param {string[]} proposalKeys
 * @param {Record<string, number>} scores
 * @returns {Record<string, string>} proposal_key → ARGB
 */
function buildProposalColorMap(proposalKeys, scores) {
  const keys = [...new Set(proposalKeys)].filter(Boolean);
  const palette = buildWarmToCoolPalette(keys.length);
  const sorted = [...keys].sort((a, b) => {
    const da = scores[a] ?? 0;
    const db = scores[b] ?? 0;
    if (db !== da) return db - da;
    return a.localeCompare(b);
  });
  /** @type {Record<string, string>} */
  const map = {};
  sorted.forEach((pk, i) => {
    map[pk] = palette[i];
  });
  return map;
}

module.exports = {
  buildWarmToCoolPalette,
  computeRowWins,
  buildProposalColorMap,
};
