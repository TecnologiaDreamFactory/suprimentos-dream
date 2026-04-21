/**
 * Construção de item_key para consolidação em lote (menos colisões, compatível com legado).
 */

const { parseQuantidade } = require("../normalize/quantities");

/**
 * Normaliza texto para comparação (legado: só descrição).
 * @param {string} desc
 * @returns {string}
 */
function normalizeItemKeyDescription(desc) {
  const s = String(desc || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return s || "item_sem_descricao";
}

/**
 * @param {string} t
 */
function normalizeToken(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * @param {number} q
 */
function formatQtyKey(q) {
  if (q == null || Number.isNaN(q)) return "";
  if (Number.isInteger(q)) return String(q);
  return String(Number(q.toFixed(6)));
}

/**
 * Extrai código/referência se existir no item (campos opcionais do parser futuro).
 * @param {object} it
 * @returns {string}
 */
function pickItemReference(it) {
  const raw =
    it.codigo ??
    it.codigo_interno ??
    it.referencia ??
    it.ref ??
    it.sku ??
    it.cod ??
    it.part_number ??
    "";
  const s = String(raw).trim();
  return s || "";
}

/**
 * Monta chave composta: descrição + qtd + unidade + referência quando disponíveis.
 * Sem qtd/unidade/ref, equivale ao comportamento legado (só descrição normalizada).
 *
 * @param {object} it — linha de item (descricao, quantidade, unidade, …)
 * @returns {string}
 */
function buildItemKey(it) {
  const desc = normalizeItemKeyDescription(it.descricao);
  const qty = parseQuantidade(it.quantidade);
  const unitRaw = (it.unidade != null && String(it.unidade).trim()) ? String(it.unidade).trim() : "";
  const ref = pickItemReference(it);

  const hasQty = qty > 0;
  const hasUnit = unitRaw.length > 0;
  const hasRef = ref.length > 0;

  if (!hasQty && !hasUnit && !hasRef) {
    return desc;
  }

  const parts = [desc];
  if (hasQty) parts.push(`q:${formatQtyKey(qty)}`);
  if (hasUnit) parts.push(`u:${normalizeToken(unitRaw)}`);
  if (hasRef) parts.push(`r:${normalizeToken(ref)}`);
  return parts.join("|");
}

/**
 * Assinatura de conteúdo para detectar colisões (mesmo item_key, “fingerprint” diferente).
 * @param {object} it
 */
function itemFingerprint(it) {
  const desc = normalizeItemKeyDescription(it.descricao);
  const qty = parseQuantidade(it.quantidade);
  const unit = String(it.unidade || "").trim();
  const ref = pickItemReference(it);
  return [desc, formatQtyKey(qty), normalizeToken(unit), normalizeToken(ref)].join("##");
}

/**
 * Detecta possíveis colisões: mesmo item_key com fingerprints distintos no lote.
 * @param {import('./extractSupplierQuotes').SupplierQuote[]} quotes
 * @returns {{ warnings: string[], collision_details: object[] }}
 */
function detectItemKeyCollisions(quotes) {
  /** @type {Map<string, Set<string>>} */
  const keyToFingerprints = new Map();

  for (const q of quotes) {
    for (const it of q.items) {
      const k = it.item_key;
      const fp = itemFingerprint(it);
      if (!keyToFingerprints.has(k)) keyToFingerprints.set(k, new Set());
      keyToFingerprints.get(k).add(fp);
    }
  }

  const warnings = [];
  /** @type {object[]} */
  const collision_details = [];

  for (const [itemKey, set] of keyToFingerprints) {
    if (set.size > 1) {
      const msg = `ITEM_KEY_COLLISION_CANDIDATE: a chave "${itemKey}" agrupa linhas com descrição/qtd/unidade/ref distintos; revisar manualmente.`;
      warnings.push(msg);
      collision_details.push({
        code: "ITEM_KEY_COLLISION_CANDIDATE",
        item_key: itemKey,
        distinct_fingerprints: set.size,
        severity: "warning",
      });
    }
  }

  return { warnings, collision_details };
}

/**
 * Dentro de uma proposta, duas linhas com mesmo item_key (fingerprint diferente) — raro mas crítico.
 * @param {import('./extractSupplierQuotes').SupplierQuote[]} quotes
 */
function detectIntraQuoteDuplicateKeys(quotes) {
  const warnings = [];
  for (const q of quotes) {
    /** @type {Map<string, string[]>} */
    const keyToFps = new Map();
    for (const it of q.items) {
      const k = it.item_key;
      const fp = itemFingerprint(it);
      if (!keyToFps.has(k)) keyToFps.set(k, []);
      keyToFps.get(k).push(fp);
    }
    for (const [k, fps] of keyToFps) {
      const uniq = new Set(fps);
      if (uniq.size > 1) {
        warnings.push(
          `ITEM_KEY_INTRA_QUOTE_DUP: proposta "${q.proposal_label}" — chave "${k}" com linhas inconsistentes.`
        );
      }
    }
  }
  return warnings;
}

module.exports = {
  normalizeItemKeyDescription,
  buildItemKey,
  pickItemReference,
  detectItemKeyCollisions,
  detectIntraQuoteDuplicateKeys,
  itemFingerprint,
};
