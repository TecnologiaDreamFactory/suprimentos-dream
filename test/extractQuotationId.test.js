/**
 * Extração de quotation_id no topo da planilha (grouped / batch).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { extractQuotationIdFromSheet, looksLikeSupplierOrNameFragment } = require("../rfq/extractQuotationId");

function padHeader(rows, headerRow) {
  while (rows.length <= headerRow) {
    rows.push([]);
  }
}

describe("looksLikeSupplierOrNameFragment", () => {
  it("rejeita palavras só com letras curtas", () => {
    assert.strictEqual(looksLikeSupplierOrNameFragment("Nebula"), true);
    assert.strictEqual(looksLikeSupplierOrNameFragment("ebula"), true);
  });

  it("aceita códigos com dígitos", () => {
    assert.strictEqual(looksLikeSupplierOrNameFragment("DF-2026-445963"), false);
    assert.strictEqual(looksLikeSupplierOrNameFragment("AB/26"), false);
  });
});

describe("extractQuotationIdFromSheet", () => {
  const headerRow = 6;

  it("RFQ claro em A1 (padrão DF-YYYY-…)", () => {
    const rows = [[ "DF-2026-445963" ]];
    padHeader(rows, headerRow);
    const r = extractQuotationIdFromSheet(rows, [], headerRow);
    assert.strictEqual(r.value, "DF-2026-445963");
    assert.ok(r.confidence >= 0.9);
  });

  it("RFQ com prefixo TP:", () => {
    const rows = [[ "TP: AB/26" ]];
    padHeader(rows, headerRow);
    const r = extractQuotationIdFromSheet(rows, [], headerRow);
    assert.strictEqual(r.value, "AB/26");
  });

  it("RFQ com prefixo RFQ:", () => {
    const rows = [[ "RFQ: 998877-PROC" ]];
    padHeader(rows, headerRow);
    const r = extractQuotationIdFromSheet(rows, [], headerRow);
    assert.strictEqual(r.value, "998877-PROC");
  });

  it("nome de fornecedor no topo não deve virar quotation_id", () => {
    const rows = [[ "Fornecedor Nebula Ltda" ]];
    padHeader(rows, headerRow);
    const r = extractQuotationIdFromSheet(rows, [], headerRow);
    assert.strictEqual(r.value, null);
    assert.ok(r.alerts.some((a) => /quotation_id/i.test(a)));
  });

  it("célula só com Nebula não deve produzir fragmento tipo ebula", () => {
    const rows = [[ "Nebula" ]];
    padHeader(rows, headerRow);
    const r = extractQuotationIdFromSheet(rows, [], headerRow);
    assert.strictEqual(r.value, null);
    assert.ok(!r.alerts.join(" ").includes("ebula"));
  });

  it("ausência real de quotation_id → null + alerta", () => {
    const rows = [[ "Observações" ], [ "Prazo: 30 dias" ]];
    padHeader(rows, headerRow);
    const r = extractQuotationIdFromSheet(rows, [], headerRow);
    assert.strictEqual(r.value, null);
    assert.ok(r.alerts.length >= 1);
  });

  it("Cotação: com nome de fornecedor não captura (rejeita só-letras)", () => {
    const rows = [[ "Cotação: Nebula" ]];
    padHeader(rows, headerRow);
    const r = extractQuotationIdFromSheet(rows, [], headerRow);
    assert.strictEqual(r.value, null);
  });

  it("Cotação: com código estruturado captura", () => {
    const rows = [[ "Cotação: DF-2026-445963" ]];
    padHeader(rows, headerRow);
    const r = extractQuotationIdFromSheet(rows, [], headerRow);
    assert.strictEqual(r.value, "DF-2026-445963");
  });
});
