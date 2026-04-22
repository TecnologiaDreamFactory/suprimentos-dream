/**
 * Facade do histórico batch — delega ao adapter configurado (local por padrão).
 * @see ./storage/batchStorageFactory.js
 */

const { getBatchHistoryStore, setLocalHistoryDirForTests } = require("./storage/batchStorageFactory");
const { JOB_STATUS } = require("./storage/localBatchHistoryAdapter");

function store() {
  return getBatchHistoryStore();
}

module.exports = {
  JOB_STATUS,
  getHistoryDir: (o) => store().getHistoryDir(o),
  setHistoryDirForTests: (d) => setLocalHistoryDirForTests(d),
  historyFilePath: (id, o) => store().historyFilePath(id, o),
  saveBatchRecord: (p, o) => store().saveBatchRecord(p, o),
  loadBatchRecord: (id, o) => store().loadBatchRecord(id, o),
  applyDecision: (id, b, o) => store().applyDecision(id, b, o),
  updateExportArtifactMeta: (id, f, o) => store().updateExportArtifactMeta(id, f, o),
  appendArtifactWarning: (id, w, o) => store().appendArtifactWarning(id, w, o),
  updateRetentionFields: (id, f, o) => store().updateRetentionFields(id, f, o),
  createPendingBatch: (p, o) => store().createPendingBatch(p, o),
  updateJobStatus: (id, f, o) => store().updateJobStatus(id, f, o),
  listPendingBatches: (o) => store().listPendingBatches(o),
};
