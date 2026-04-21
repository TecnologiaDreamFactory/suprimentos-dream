/**
 * Facade de snapshots batch — delega ao adapter local.
 * @see ./storage/batchStorageFactory.js
 */

const { getBatchSnapshotStore, setLocalSnapshotDirForTests } = require("./storage/batchStorageFactory");

function store() {
  return getBatchSnapshotStore();
}

module.exports = {
  getSnapshotDir: (o) => store().getSnapshotDir(o),
  setSnapshotDirForTests: (d) => setLocalSnapshotDirForTests(d),
  snapshotPath: (id, o) => store().snapshotPath(id, o),
  buildSnapshotFromCompareResult: (r) => store().buildSnapshotFromCompareResult(r),
  saveSnapshot: (id, s, o) => store().saveSnapshot(id, s, o),
  loadSnapshot: (id, o) => store().loadSnapshot(id, o),
  snapshotExists: (id, o) => store().snapshotExists(id, o),
  stripParsedFilesForSnapshot: (p) => store().stripParsedFilesForSnapshot(p),
};
