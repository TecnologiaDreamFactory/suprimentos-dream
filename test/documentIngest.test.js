/**
 * Ingestão PDF/DOCX/TXT: detecção de tipo, legado a partir de JSON IA, schema.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { detectDocumentType } = require("../rfq/ingest/detectDocumentType");
const {
  buildLegacyFromAiDocument,
  buildUncategorizedRowsForExport,
} = require("../rfq/ingest/legacyFromAiDocument");
const { validateDocumentExtractionResponse } = require("../ai/openaiSchemas");

describe("detectDocumentType", () => {
  it("PDF por assinatura %PDF", () => {
    const buf = Buffer.from("%PDF-1.4\n1 0 obj");
    assert.strictEqual(detectDocumentType(buf, "x.xlsx").type, "pdf");
  });

  it("PDF com bytes iniciais antes de %PDF (ex.: BOM)", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("%PDF-1.7")]);
    assert.strictEqual(detectDocumentType(buf, "proposta.pdf").type, "pdf");
  });

  it("DOCX por ZIP + word/document.xml", () => {
    const buf = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from("paddingword/document.xmlpadding", "utf8"),
    ]);
    assert.strictEqual(detectDocumentType(buf, "q.docx").type, "docx");
  });

  it("XLSX por xl/workbook.xml", () => {
    const buf = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from("paddingxl/workbook.xmlpadding", "utf8"),
    ]);
    assert.strictEqual(detectDocumentType(buf, "q.xlsx").type, "excel_xlsx");
  });

  it("XLSX continua Excel mesmo se bytes iniciais contiverem %PDF (falso positivo)", () => {
    const buf = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from("%PDF", "utf8"),
      Buffer.from("noise", "utf8"),
      Buffer.from("xl/workbook.xml", "utf8"),
    ]);
    assert.strictEqual(detectDocumentType(buf, "cotacao.xlsx").type, "excel_xlsx");
  });

  it("extensão .txt sem assinatura conhecida", () => {
    const buf = Buffer.from("hello");
    assert.strictEqual(detectDocumentType(buf, "n.txt").type, "txt");
  });
});

describe("validateDocumentExtractionResponse", () => {
  it("aceita payload mínimo válido", () => {
    const v = validateDocumentExtractionResponse({
      items: [{ descricao: "Parafuso", quantidade: 10, preco_unitario: 1, total: 10 }],
      warnings: [],
      confidence: 0.8,
    });
    assert.strictEqual(v.ok, true);
  });

  it("rejeita item sem descrição", () => {
    const v = validateDocumentExtractionResponse({
      items: [{ descricao: "  ", quantidade: 1, preco_unitario: 1, total: 1 }],
      warnings: [],
      confidence: 0.8,
    });
    assert.strictEqual(v.ok, false);
  });
});

describe("buildLegacyFromAiDocument", () => {
  it("monta legacy success com itens", () => {
    const legacy = buildLegacyFromAiDocument(
      {
        items: [
          {
            descricao: "Item A",
            quantidade: 2,
            preco_unitario: 5.5,
            total: 11,
            fornecedor: "ACME",
          },
        ],
        warnings: [],
        confidence: 0.75,
        notes: "teste",
      },
      { rfqId: "R1", source: "doc.pdf", filename: "doc.pdf", ingestWarnings: [] }
    );
    assert.ok(legacy);
    assert.strictEqual(legacy.status, "success");
    assert.strictEqual(legacy.items.length, 1);
    assert.strictEqual(legacy.items[0].descricao, "Item A");
    assert.strictEqual(legacy.summary._template, "document_ai");
    assert.strictEqual(legacy.summary.document_extract_confidence, 0.75);
    assert.strictEqual(legacy.summary.needs_review, true);
  });

  it("retorna null sem itens válidos", () => {
    const legacy = buildLegacyFromAiDocument(
      { items: [{ descricao: "", quantidade: 1, preco_unitario: 1, total: 1 }], warnings: [], confidence: 0.5 },
      { rfqId: "R1", source: "x", ingestWarnings: [] }
    );
    assert.strictEqual(legacy, null);
  });

  it("uncategorized_rows_for_export inclui parcelamento e pagamento quando a IA omite uncategorized_rows", () => {
    const legacy = buildLegacyFromAiDocument(
      {
        items: [
          { descricao: "Item A", quantidade: 1, preco_unitario: 10, total: 10, fornecedor: "ACME" },
        ],
        warnings: [],
        confidence: 0.8,
        parcelamento: "12 VEZES",
        condicao_pagamento: "30 DIAS",
      },
      { rfqId: "R1", source: "doc.pdf", filename: "doc.pdf", ingestWarnings: [] }
    );
    assert.ok(legacy);
    const rows = legacy.summary.uncategorized_rows_for_export;
    assert.ok(Array.isArray(rows));
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], { label: "Parcelado", value: "12 VEZES" });
    assert.deepStrictEqual(rows[1], { label: "Pagamento", value: "30 DIAS" });
  });

  it("não duplica valor já presente em uncategorized_rows", () => {
    const rows = buildUncategorizedRowsForExport({
      uncategorized_rows: [{ rotulo: "PARCELADO", valor: "12 VEZES" }],
      parcelamento: "12 VEZES",
      condicao_pagamento: "30 DIAS",
    });
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], { label: "PARCELADO", value: "12 VEZES" });
    assert.deepStrictEqual(rows[1], { label: "Pagamento", value: "30 DIAS" });
  });
});
