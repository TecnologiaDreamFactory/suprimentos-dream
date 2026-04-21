/**
 * Leitura/escrita JSON com escrita atômica e tratamento de erros previsível.
 */

const fs = require("fs");
const path = require("path");

/**
 * @param {string} filePath
 * @param {object} data
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * @param {string} filePath
 * @returns {{ ok: true, data: object } | { ok: false, error: string, data?: null }}
 */
function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: "missing_file" };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return { ok: false, error: `read:${e.message}` };
  }
  if (!raw.trim()) {
    return { ok: false, error: "empty_file" };
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: `invalid_json:${e.message}` };
  }
}

module.exports = {
  writeJsonAtomic,
  readJsonSafe,
};
