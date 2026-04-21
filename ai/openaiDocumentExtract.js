/**
 * Extração estruturada de itens de cotação a partir de texto (PDF/DOCX/TXT) via OpenAI.
 */

const { getOpenAIConfig, isOpenAIConfigured } = require("./openaiConfig");
const { responsesJson } = require("./openaiClient");
const { validateDocumentExtractionResponse } = require("./openaiSchemas");

const SYSTEM_DOCUMENT_EXTRACT = `You extract structured line items from procurement quotation text (from PDF, Word, or plain text).
You MUST respond with a single JSON object only, no markdown.

Rules:
- Do NOT invent products or prices. Only include rows clearly supported by the text.
- If unsure about a row, omit it or list the doubt in "warnings".
- "descricao" must be non-empty for every item.
- Use numbers for quantidade, preco_unitario, total. Use 0 only when the field is truly absent but the line is still clearly one priced item.
- Brazilian number format may appear (comma as decimal separator) — normalize to numbers in JSON.
- Currency: assume BRL when not stated.
- "fornecedor" per item only if clearly different lines belong to different suppliers; otherwise use supplier_name_hint once.
- Map delivery / lead time (Portuguese: Prazo, Entrega, prazo de entrega) to each item's "prazo_entrega" as free text or number of days when explicit.
- Map payment / installments (Portuguese: Condição de pagamento, Parcelamento, parcelado em, Nx) to top-level "condicao_pagamento" and/or "parcelamento" when stated once for the quote.
- Use "uncategorized_rows" for label/value blocks that are NOT product lines (e.g. side tables: PARCELADO → 12 VEZES, pagamento → 30 DIAS, freight notes, validity). Each row has "rotulo" (label) and "valor" (value) as in the document.

JSON shape:
{
  "items": [
    {
      "descricao": "string",
      "quantidade": number,
      "preco_unitario": number,
      "total": number,
      "fornecedor": "string optional",
      "unidade": "string optional",
      "prazo_entrega": "string or number optional"
    }
  ],
  "supplier_name_hint": "string optional",
  "condicao_pagamento": "string optional",
  "parcelamento": "string optional",
  "uncategorized_rows": [
    { "rotulo": "string", "valor": "string" }
  ],
  "warnings": ["string"],
  "confidence": 0-1,
  "notes": "string optional"
}`;

function logDocExtract(phase, info) {
  console.log(
    `[OpenAI document] ${phase} model=${info.model || "?"} duration_ms=${info.duration_ms ?? "?"} ok=${info.ok}`
  );
}

/**
 * @param {{ text: string, filename: string, rfqId: string, truncated?: boolean }} params
 * @returns {Promise<object|null>}
 */
async function extractQuotationFromDocument(params) {
  if (!isOpenAIConfigured()) return null;
  const cfg = getOpenAIConfig();
  if (!cfg.enableDocumentIngest) return null;

  const { text, filename, rfqId, truncated } = params;
  const t0 = Date.now();
  try {
    const user = JSON.stringify({
      instruction: "Extract quotation line items from the following document text. JSON only per schema.",
      rfq_id: String(rfqId || "").slice(0, 80),
      filename: String(filename || "").slice(0, 200),
      text_truncated: Boolean(truncated),
      document_text: String(text || "").slice(0, cfg.documentIngestMaxChars + 1),
    });

    const raw = await responsesJson({
      system: SYSTEM_DOCUMENT_EXTRACT,
      user,
      timeoutMs: cfg.documentIngestTimeoutMs,
      model: cfg.model,
    });

    const parsed = JSON.parse(raw.content);
    const v = validateDocumentExtractionResponse(parsed);
    if (!v.ok) {
      logDocExtract("document_extract_invalid_json", {
        model: cfg.model,
        duration_ms: Date.now() - t0,
        ok: false,
      });
      return null;
    }
    logDocExtract("document_extract", { model: cfg.model, duration_ms: Date.now() - t0, ok: true });
    return v.value;
  } catch (e) {
    logDocExtract("document_extract_error", {
      model: cfg.model,
      duration_ms: Date.now() - t0,
      ok: false,
    });
    return null;
  }
}

module.exports = {
  extractQuotationFromDocument,
  SYSTEM_DOCUMENT_EXTRACT,
};
