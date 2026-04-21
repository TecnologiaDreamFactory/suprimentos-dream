/**
 * Factory singletons para adapters de storage batch.
 * BATCH_STORAGE_PROVIDER=local → export local; object → metadados object + disco local.
 * Histórico e snapshot permanecem filesystem local (volume compartilhado em cluster).
 */

const path = require("path");
const os = require("os");
const { getBatchStorageProvider } = require("../config/batchInfraConfig");
const { LocalBatchHistoryAdapter } = require("./localBatchHistoryAdapter");
const { LocalBatchSnapshotAdapter } = require("./localBatchSnapshotAdapter");
const { LocalBatchExportAdapter } = require("./localBatchExportAdapter");
const { ObjectBatchExportAdapter } = require("./objectBatchExportAdapter");

/** @type {string|undefined|null} */
let _historyDirTestOverride = null;
/** @type {string|undefined|null} */
let _snapshotDirTestOverride = null;
/** @type {string|undefined|null} */
let _exportDirTestOverride = null;

let _cachedHistoryDirEnv;
function resolveHistoryDir() {
  if (_historyDirTestOverride !== null) return _historyDirTestOverride;
  if (_cachedHistoryDirEnv !== undefined) return _cachedHistoryDirEnv;
  const env = process.env.BATCH_HISTORY_DIR;
  if (env && String(env).trim()) {
    _cachedHistoryDirEnv = path.resolve(String(env).trim());
    return _cachedHistoryDirEnv;
  }
  _cachedHistoryDirEnv = path.join(__dirname, "..", "..", "data", "batch-history");
  return _cachedHistoryDirEnv;
}

let _cachedSnapshotDirEnv;
function resolveSnapshotDir() {
  if (_snapshotDirTestOverride !== null) return _snapshotDirTestOverride;
  if (_cachedSnapshotDirEnv !== undefined) return _cachedSnapshotDirEnv;
  const env = process.env.BATCH_SNAPSHOT_DIR;
  if (env && String(env).trim()) {
    _cachedSnapshotDirEnv = path.resolve(String(env).trim());
    return _cachedSnapshotDirEnv;
  }
  _cachedSnapshotDirEnv = path.join(__dirname, "..", "..", "data", "batch-snapshots");
  return _cachedSnapshotDirEnv;
}

function resolveExportLocalDir() {
  if (_exportDirTestOverride !== null) return _exportDirTestOverride;
  return path.join(os.tmpdir(), "compras-dream-batch-exports");
}

/** @type {import('./localBatchHistoryAdapter').LocalBatchHistoryAdapter|null} */
let _historyAdapter = null;
/** @type {import('./localBatchSnapshotAdapter').LocalBatchSnapshotAdapter|null} */
let _snapshotAdapter = null;
/** @type {import('./localBatchExportAdapter').LocalBatchExportAdapter|null} */
let _exportAdapter = null;

function getBatchHistoryStore() {
  if (!_historyAdapter) {
    _historyAdapter = new LocalBatchHistoryAdapter({
      getBaseDir: () => resolveHistoryDir(),
      setBaseDirForTests: (d) => {
        _historyDirTestOverride = d;
      },
    });
  }
  return _historyAdapter;
}

function getBatchSnapshotStore() {
  if (!_snapshotAdapter) {
    _snapshotAdapter = new LocalBatchSnapshotAdapter({
      getBaseDir: () => resolveSnapshotDir(),
      setBaseDirForTests: (d) => {
        _snapshotDirTestOverride = d;
      },
    });
  }
  return _snapshotAdapter;
}

function getBatchExportStore() {
  if (!_exportAdapter) {
    const provider = getBatchStorageProvider();
    const opts = {
      getLocalDirectory: () => resolveExportLocalDir(),
      setLocalDirectoryForTests: (d) => {
        _exportDirTestOverride = d;
      },
    };
    _exportAdapter =
      provider === "object" ? new ObjectBatchExportAdapter(opts) : new LocalBatchExportAdapter(opts);
  }
  return _exportAdapter;
}

/**
 * Testes: ajusta diretórios e recria adapters.
 */
function setLocalHistoryDirForTests(dir) {
  _historyDirTestOverride = dir == null ? null : dir;
  _historyAdapter = null;
  if (dir == null) _cachedHistoryDirEnv = undefined;
}

function setLocalSnapshotDirForTests(dir) {
  _snapshotDirTestOverride = dir == null ? null : dir;
  _snapshotAdapter = null;
  if (dir == null) _cachedSnapshotDirEnv = undefined;
}

function setLocalExportDirForTests(dir) {
  _exportDirTestOverride = dir == null ? null : dir;
  _exportAdapter = null;
}

function resetBatchStorageFactoriesForTests() {
  _historyDirTestOverride = null;
  _snapshotDirTestOverride = null;
  _exportDirTestOverride = null;
  _cachedHistoryDirEnv = undefined;
  _cachedSnapshotDirEnv = undefined;
  _historyAdapter = null;
  _snapshotAdapter = null;
  _exportAdapter = null;
}

/** Compat: mesmo nome usado antes */
function getHistoryDir(override) {
  if (override) return override;
  return resolveHistoryDir();
}

module.exports = {
  getBatchHistoryStore,
  getBatchSnapshotStore,
  getBatchExportStore,
  setLocalHistoryDirForTests,
  setLocalSnapshotDirForTests,
  setLocalExportDirForTests,
  resetBatchStorageFactoriesForTests,
  getHistoryDir,
  resolveExportLocalDir,
};
