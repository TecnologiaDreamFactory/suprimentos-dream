/**
 * Extrai texto plano de PDF, DOCX ou TXT com limite de caracteres.
 */

const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");

/**
 * @param {Buffer} buffer
 * @param {string} docType — pdf | docx | txt
 * @param {{ documentIngestMaxChars: number }} cfg
 * @returns {Promise<{ ok: boolean, text?: string, truncated?: boolean, error?: string }>}
 */
async function extractPlainText(buffer, docType, cfg) {
  const maxChars = Math.max(4000, Math.min(cfg.documentIngestMaxChars || 120000, 500000));
  let raw = "";

  try {
    if (docType === "pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        const data = await parser.getText();
        raw = String(data.text || "");
      } finally {
        try {
          await parser.destroy();
        } catch {
          /* ignore */
        }
      }
    } else if (docType === "docx") {
      const { value } = await mammoth.extractRawText({ buffer });
      raw = String(value || "");
    } else if (docType === "txt") {
      raw = buffer.toString("utf8");
      if (!raw || raw.includes("\uFFFD")) {
        raw = buffer.toString("latin1");
      }
    } else {
      return { ok: false, error: `tipo_nao_suportado:${docType}` };
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }

  const trimmed = raw.replace(/\r\n/g, "\n").trim();
  if (!trimmed) {
    return { ok: false, error: "documento_sem_texto" };
  }

  let truncated = false;
  let text = trimmed;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }

  return { ok: true, text, truncated };
}

module.exports = {
  extractPlainText,
};
