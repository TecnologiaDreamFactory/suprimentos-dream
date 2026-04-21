/**
 * Normalização de valores monetários (formato BR e US).
 */

/**
 * @param {any} value
 * @returns {number}
 */
function parsePrecoUnitario(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && !Number.isNaN(value)) return value;

  let str = String(value).trim();
  str = str.replace(/^[A-Z$€£¥₹\s]+/i, "");
  str = str.replace(/\s/g, "");

  const isBrazilian = /\d+\.\d{3}(,\d+)?$/.test(str) || /^\d+(,\d+)?$/.test(str);

  if (isBrazilian) {
    str = str.replace(/\./g, "");
    str = str.replace(",", ".");
  } else {
    str = str.replace(/,/g, "");
  }

  const num = parseFloat(str);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * @deprecated Preferir parsePrecoUnitario ou parseQuantidade em quantities.js
 * @param {any} val
 * @returns {number}
 */
function toNumber(val) {
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  const s = String(val || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

module.exports = {
  parsePrecoUnitario,
  toNumber,
};
