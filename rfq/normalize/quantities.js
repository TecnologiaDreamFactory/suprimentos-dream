/**
 * Normalização de quantidades e prazos numéricos.
 */

/**
 * @param {any} value
 * @returns {number}
 */
function parseQuantidade(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && !Number.isNaN(value)) return value;

  let str = String(value).trim().replace(/\s/g, "");

  if (str.includes(",") && !str.match(/^\d+,\d+$/)) {
    if (str.includes(".")) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      if (/^\d+,\d{2}$/.test(str)) {
        str = str.replace(",", ".");
      } else {
        str = str.replace(",", "");
      }
    }
  } else if (str.includes(",")) {
    str = str.replace(",", ".");
  } else {
    str = str.replace(/,/g, "");
  }

  const num = parseFloat(str);
  return Number.isNaN(num) ? 0 : num;
}

module.exports = {
  parseQuantidade,
};
