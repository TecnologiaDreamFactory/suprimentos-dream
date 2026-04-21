/**
 * Verificações para GET /ready (diretórios e escrita).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

function checkDirWritable(dir) {
  if (!dir) return { ok: false, reason: "missing_dir" };
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    const test = path.join(dir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(test, "ok", "utf8");
    fs.unlinkSync(test);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.code || "eacces" };
  }
}

/**
 * @param {{ exportDir: string, historyDir: string, snapshotDir: string }} dirs
 */
function getReadiness(dirs) {
  const exportCheck = checkDirWritable(dirs.exportDir);
  const historyCheck = checkDirWritable(dirs.historyDir);
  const snapshotCheck = checkDirWritable(dirs.snapshotDir);

  const ok = exportCheck.ok && historyCheck.ok && snapshotCheck.ok;
  return {
    ok,
    checks: {
      batch_export_dir: exportCheck.ok,
      batch_history_dir: historyCheck.ok,
      batch_snapshot_dir: snapshotCheck.ok,
    },
    tmpdir_writable: checkDirWritable(os.tmpdir()).ok,
  };
}

module.exports = {
  getReadiness,
  checkDirWritable,
};
