/**
 * Cabeçalho e sinônimos: ordem de colunas livre, limiar de confiança e anti-falso-positivo.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  mapHeaderToCanonical,
  detectHeaderAndMapping,
  applyDescricaoFallbackFromUnmappedColumns,
  MIN_HEADER_CELL_CONFIDENCE,
} = require("../rfq/columnMapping");

describe("columnMapping / mapHeaderToCanonical", () => {
  it("equipamento mapeia para descricao (planilhas tipo catálogo)", () => {
    const m = mapHeaderToCanonical("Equipamento");
    assert.strictEqual(m.field, "descricao");
    assert.ok(m.confidence > MIN_HEADER_CELL_CONFIDENCE);
  });

  it("pagamento (coluna) mapeia para condicao_pagamento", () => {
    const m = mapHeaderToCanonical("pagamento");
    assert.strictEqual(m.field, "condicao_pagamento");
    assert.ok(m.confidence > MIN_HEADER_CELL_CONFIDENCE);
  });

  it("sinônimos estendidos: discriminacao, custo unitario, referencia", () => {
    const d = mapHeaderToCanonical("Discriminação");
    assert.strictEqual(d.field, "descricao");
    assert.ok(d.confidence > MIN_HEADER_CELL_CONFIDENCE);

    const p = mapHeaderToCanonical("Custo unitário");
    assert.strictEqual(p.field, "preco_unitario");
    assert.ok(p.confidence > MIN_HEADER_CELL_CONFIDENCE);

    const r = mapHeaderToCanonical("Referência");
    assert.strictEqual(r.field, "descricao");
    assert.ok(r.confidence > MIN_HEADER_CELL_CONFIDENCE);
  });

  it("colunas em ordem arbitrária: mesma linha de cabeçalho mapeia todos os campos", () => {
    const row = ["Total linha", "UN", "Qtd", "Detalhamento"];
    const m = {};
    for (let c = 0; c < row.length; c++) {
      const { field, confidence } = mapHeaderToCanonical(row[c]);
      if (field && confidence > MIN_HEADER_CELL_CONFIDENCE) {
        m[c] = { field, confidence };
      }
    }
    const fields = new Set(Object.values(m).map((x) => x.field));
    assert.ok(fields.has("descricao"));
    assert.ok(fields.has("quantidade"));
    assert.ok(fields.has("preco_unitario") || fields.has("total"));
  });
});

describe("columnMapping / descrição por inferência", () => {
  it("rótulo de domínio não listado (ex. Milheiro) vira coluna descrição se houver qtd e valor", () => {
    const row = ["Fornecedor", "Milheiro", "Qtd", "Valor"];
    const m = {};
    for (let c = 0; c < row.length; c++) {
      const { field, confidence } = mapHeaderToCanonical(row[c]);
      if (field && confidence > MIN_HEADER_CELL_CONFIDENCE) {
        m[c] = { field, confidence };
      }
    }
    const out = applyDescricaoFallbackFromUnmappedColumns(row, m);
    const descCols = Object.entries(out).filter(([, v]) => v.field === "descricao");
    assert.strictEqual(descCols.length, 1);
    assert.strictEqual(Number(descCols[0][0]), 1);
  });
});

describe("columnMapping / detectHeaderAndMapping", () => {
  it("prefere linha com descrição + (qtd ou preço), não só título na primeira linha", () => {
    const rows = [
      ["Proposta comercial — Fornecedor X", "", "", ""],
      ["Produto", "Qtd", "UN", "Preço Unit", "Total"],
      ["Parafuso", 10, "UN", "1,50", "15,00"],
    ];
    const { mapping, headerRowIndex, score } = detectHeaderAndMapping(rows, 10);
    assert.ok(score > 0);
    assert.strictEqual(headerRowIndex, 1);
    assert.ok(Object.values(mapping).some((x) => x.field === "descricao"));
  });

  it("não escolhe linha só com totais genéricos sem descrição+qtd/preço de coluna", () => {
    const rows = [
      ["Subtotal", "100", "200"],
      ["", "", ""],
    ];
    const { score } = detectHeaderAndMapping(rows, 5);
    assert.strictEqual(score, 0);
  });

  it("cabeçalho após linhas de metadados (linha 5)", () => {
    const pad = Array.from({ length: 4 }, () => ["", ""]);
    const header = ["Denominação", "Necesidade", "Custo unitário", "Total"];
    const rows = [...pad, header, ["Item Z", 2, "5,00", "10,00"]];
    const { headerRowIndex, score } = detectHeaderAndMapping(rows, 30);
    assert.ok(score > 0);
    assert.strictEqual(headerRowIndex, 4);
  });
});
