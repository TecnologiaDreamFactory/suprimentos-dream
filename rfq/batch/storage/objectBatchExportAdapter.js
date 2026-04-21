/**
 * Adapter de export "object storage" (fase 1): gravação continua no disco local
 * (compatível com exceljs / download atual); metadados expõem URI lógica tipo s3://
 * para integração futura com S3 / GCS / Azure Blob.
 *
 * Não envia bytes à nuvem — apenas contrato e campos de histórico alinhados ao provider.
 */

const path = require("path");
const { LocalBatchExportAdapter } = require("./localBatchExportAdapter");
const { buildObjectExportUri } = require("../config/batchInfraConfig");

class ObjectBatchExportAdapter extends LocalBatchExportAdapter {
  constructor(opts) {
    super(opts);
  }

  getMetadataForFile(fileName) {
    const base = super.getMetadataForFile(fileName);
    const baseName = path.basename(fileName);
    return {
      ...base,
      export_provider: "object",
      export_uri: buildObjectExportUri(baseName),
      export_etag: base.export_etag,
      export_size_bytes: base.export_size_bytes,
    };
  }
}

module.exports = {
  ObjectBatchExportAdapter,
};
