/**
 * @param {any} val
 * @returns {boolean}
 */
function toBoolean(val) {
  if (typeof val === "boolean") return val;
  const s = String(val || "").toLowerCase().trim();
  return s === "sim" || s === "yes" || s === "true" || s === "1" || s === "s";
}

module.exports = { toBoolean };
