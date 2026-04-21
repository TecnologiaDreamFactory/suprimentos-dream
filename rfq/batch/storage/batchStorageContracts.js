/**
 * Contratos lógicos dos stores batch (histórico, snapshot, export).
 * Implementações: localBatch*Adapter, objectBatchExportAdapter (fase object).
 *
 * @typedef {object} BatchHistoryStore
 * @property {(overrideDir?: string) => string} getHistoryDir
 * @property {(batchId: string, dirOverride?: string) => string} historyFilePath
 * @property {(payload: object, dirOverride?: string) => object} saveBatchRecord
 * @property {(batchId: string, dirOverride?: string) => object|null} loadBatchRecord
 * @property {(batchId: string, body: object, dirOverride?: string) => object} applyDecision
 * @property {(batchId: string, fields: object, dirOverride?: string) => object} updateExportArtifactMeta
 * @property {(batchId: string, warning: object, dirOverride?: string) => object} appendArtifactWarning
 * @property {(batchId: string, fields: object, dirOverride?: string) => object} updateRetentionFields
 */

/**
 * @typedef {object} BatchSnapshotStore
 * @property {(overrideDir?: string) => string} getSnapshotDir
 * @property {(batchId: string, dirOverride?: string) => string} snapshotPath
 * @property {(result: object) => object} buildSnapshotFromCompareResult
 * @property {(batchId: string, snapshot: object, dirOverride?: string) => { path: string, relative: string }} saveSnapshot
 * @property {(batchId: string, dirOverride?: string) => object|null} loadSnapshot
 * @property {(batchId: string, dirOverride?: string) => boolean} snapshotExists
 * @property {(parsedFiles: object[]) => object[]} stripParsedFilesForSnapshot
 */

/**
 * @typedef {object} BatchExportStore
 * @property {() => string} getLocalDirectory
 * @property {(fileName: string) => { export_provider: string, export_uri: string|null, export_size_bytes: number|null, export_etag: string|null }} getMetadataForFile
 */

/**
 * @typedef {object} RateLimitStore
 * @property {(key: string, windowMs: number, max: number) => { allowed: boolean, count: number, limit: number, remaining: number, resetSec: number }} consume
 */

module.exports = {};
