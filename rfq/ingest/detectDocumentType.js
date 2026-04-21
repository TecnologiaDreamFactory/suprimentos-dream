/**
 * Detecção de tipo de arquivo por assinatura e extensão (PDF, DOCX, Excel, TXT).
 */

const path = require("path");

/**
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {{ type: string, reason?: string }}
 */
function detectDocumentType(buffer, filename = "") {
  const ext = path.extname(filename || "").toLowerCase();

  if (!buffer || buffer.length < 4) {
    return { type: "unknown", reason: "buffer_vazio" };
  }

  // ZIP (XLSX/DOCX) antes de procurar %PDF no buffer: xlsx é PK e bytes internos podem conter "%PDF" por acaso.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const sniffLen = Math.min(buffer.length, 65536);
    const sniff = buffer.slice(0, sniffLen).toString("latin1");
    if (sniff.includes("xl/workbook.xml") || sniff.includes("xl\\workbook.xml")) {
      return { type: "excel_xlsx" };
    }
    if (sniff.includes("word/document.xml") || sniff.includes("word\\document.xml")) {
      return { type: "docx" };
    }
    if (ext === ".xlsx" || ext === ".xlsm") return { type: "excel_xlsx" };
    if (ext === ".docx") return { type: "docx" };
    return { type: "zip_unknown" };
  }

  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    if (ext === ".xls") return { type: "excel_xls" };
    return { type: "ole" };
  }

  const sniffMax = Math.min(buffer.length, 4096);
  for (let i = 0; i <= sniffMax - 4; i++) {
    if (buffer[i] === 0x25 && buffer[i + 1] === 0x50 && buffer[i + 2] === 0x44 && buffer[i + 3] === 0x46) {
      return { type: "pdf" };
    }
  }

  if (ext === ".txt") return { type: "txt" };
  if (ext === ".pdf") return { type: "pdf" };
  if (ext === ".docx") return { type: "docx" };

  return { type: "unknown" };
}

/**
 * Tipos que seguem o pipeline Excel (tentativa XLSX/read grid).
 * @param {{ type: string }} docType
 * @returns {boolean}
 */
function isExcelFamilyType(docType) {
  const t = docType?.type || "";
  return t === "excel_xlsx" || t === "excel_xls" || t === "zip_unknown" || t === "unknown";
}

/**
 * Tipos tratados como texto + ingestão por IA.
 * @param {{ type: string }} docType
 * @returns {boolean}
 */
function isDocumentAiType(docType) {
  const t = docType?.type || "";
  return t === "pdf" || t === "docx" || t === "txt";
}

module.exports = {
  detectDocumentType,
  isExcelFamilyType,
  isDocumentAiType,
};
