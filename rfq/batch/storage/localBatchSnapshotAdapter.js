/**
 * Adapter: snapshot JSON em filesystem local.
 */

const path = require("path");
const fs = require("fs");
const { writeJsonAtomic, readJsonSafe } = require("../jsonFileUtils");

class LocalBatchSnapshotAdapter {
  constructor(opts) {
    this._getBaseDir = opts.getBaseDir;
    this._setBaseDirForTests = opts.setBaseDirForTests || (() => {});
  }

  getSnapshotDir(overrideDir) {
    if (overrideDir) return overrideDir;
    return this._getBaseDir();
  }

  safeBatchFileName(batchId) {
    return String(batchId).replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  snapshotPath(batchId, dirOverride) {
    return path.join(this.getSnapshotDir(dirOverride), `${this.safeBatchFileName(batchId)}.json`);
  }

  stripParsedFilesForSnapshot(parsedFiles) {
    if (!Array.isArray(parsedFiles)) return [];
    return parsedFiles.map((p) => {
      const { pipeline_result, ...rest } = p;
      return rest;
    });
  }

  buildSnapshotFromCompareResult(result) {
    return {
      batch_api_version: result.batch_api_version,
      batch_id: result.batch_id,
      created_at: result.created_at,
      decision_status: result.decision_status,
      metrics_summary: result.metrics_summary,
      parsed_files: this.stripParsedFilesForSnapshot(result.parsed_files),
      consolidated: result.consolidated,
      comparison_result: result.comparison_result,
      inconsistencies: result.inconsistencies,
      analytic_summary: result.analytic_summary,
      allQuotes: result.allQuotes || [],
      review_summary: result.review_summary,
      ai_comparison_feedback: result.ai_comparison_feedback,
      semantic_match_notes: result.semantic_match_notes || {},
      warnings_sample: Array.isArray(result.warnings) ? result.warnings.slice(0, 40) : [],
    };
  }

  saveSnapshot(batchId, snapshot, dirOverride) {
    const fp = this.snapshotPath(batchId, dirOverride);
    writeJsonAtomic(fp, snapshot);
    return { path: fp, relative: `${this.safeBatchFileName(batchId)}.json` };
  }

  loadSnapshot(batchId, dirOverride) {
    const fp = this.snapshotPath(batchId, dirOverride);
    const r = readJsonSafe(fp);
    if (!r.ok) return null;
    return r.data;
  }

  snapshotExists(batchId, dirOverride) {
    return fs.existsSync(this.snapshotPath(batchId, dirOverride));
  }

  setSnapshotDirForTests(dir) {
    this._setBaseDirForTests(dir);
  }
}

module.exports = {
  LocalBatchSnapshotAdapter,
};
