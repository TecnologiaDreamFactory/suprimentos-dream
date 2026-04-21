/**
 * Adapter: arquivos XLSX de export em diretório local (gravados pelo pipeline).
 */

const fs = require("fs");
const path = require("path");

class LocalBatchExportAdapter {
  /**
   * @param {{ getLocalDirectory: () => string, setLocalDirectoryForTests?: (d: string|null) => void }} opts
   */
  constructor(opts) {
    this._getLocalDirectory = opts.getLocalDirectory;
    this._setLocalDirectoryForTests = opts.setLocalDirectoryForTests || (() => {});
  }

  /** Diretório absoluto onde batch-*.xlsx são escritos e lidos. */
  getLocalDirectory() {
    return this._getLocalDirectory();
  }

  /**
   * Metadados para persistir no histórico após o arquivo existir em disco.
   * @param {string} fileName — ex.: batch-B-xxx.xlsx
   */
  getMetadataForFile(fileName) {
    const base = path.basename(fileName);
    const full = path.join(this.getLocalDirectory(), base);
    if (!fs.existsSync(full)) {
      return {
        export_provider: "local",
        export_uri: null,
        export_size_bytes: null,
        export_etag: null,
      };
    }
    const st = fs.statSync(full);
    return {
      export_provider: "local",
      export_uri: null,
      export_size_bytes: st.size,
      export_etag: null,
    };
  }

  setLocalDirectoryForTests(dir) {
    this._setLocalDirectoryForTests(dir);
  }
}

module.exports = {
  LocalBatchExportAdapter,
};
