/**
 * Testes do pipeline de parse + validação + comparação.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const XLSX = require("xlsx");

const { parseWithPipeline } = require("../rfq/pipeline");
const { parseExcelToCanonical } = require("../rfq/parser");
const { parsePrecoUnitario } = require("../rfq/normalize/money");
const { validateLegacyResult } = require("../rfq/validate/rules");
const { compareSuppliersFromLegacy } = require("../rfq/compare/rank");

describe("normalize/money", () => {
  it("parsePrecoUnitario BR", () => {
    assert.strictEqual(parsePrecoUnitario("R$ 2.800,00"), 2800);
    assert.strictEqual(parsePrecoUnitario(100), 100);
  });
});

describe("validateLegacyResult", () => {
  it("aceita resultado success mínimo", () => {
    const legacy = {
      status: "success",
      source: "A",
      items: [
        {
          descricao: "X",
          quantidade: 1,
          preco_unitario: 10,
          total: 10,
          fornecedor: "A",
        },
      ],
      summary: { supplier_totals: null },
      mapping: { descricao: { confidence: 1 }, quantidade: { confidence: 1 }, preco_unitario: { confidence: 1 } },
      warnings: [],
    };
    const v = validateLegacyResult(legacy);
    assert.strictEqual(v.ok, true);
  });
});

describe("compareSuppliersFromLegacy", () => {
  it("ranking com dois fornecedores", () => {
    const legacy = {
      status: "success",
      source: "unknown",
      items: [],
      summary: {
        supplier_totals: {
          FornecedorBarato: { total: 100, items: 2, avgPrice: 50 },
          FornecedorCaro: { total: 200, items: 2, avgPrice: 100 },
        },
        best_supplier: "FornecedorBarato",
      },
    };
    const c = compareSuppliersFromLegacy(legacy, { warnings: [] });
    assert.strictEqual(c.ranking[0].supplier_key, c.winner_suggested.supplier_key);
    assert.strictEqual(c.winner_suggested.name, "FornecedorBarato");
  });
});

describe("parseWithPipeline integração mínima", () => {
  it("monta xlsx em memória e retorna parser_version 2", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Produto", "Qtd", "UN", "Preço Unit", "Total"],
      ["Item teste", 2, "UN", "10,00", "20,00"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ITENS_COTACAO");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const out = await parseWithPipeline(buf, "RFQ-TEST", "FornecedorX", { skipOpenAI: true });
    assert.strictEqual(out.parser_version, 2);
    assert.strictEqual(out.status, "success");
    assert.ok(out.canonical_quotation);
    assert.ok(out.validation_result);
    assert.ok(out.comparison_result);
    assert.strictEqual(out.analysis_source, "deterministic");
  });

  it("colunas em ordem invertida / mista ainda produz itens", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Total", "Preço Unit", "UN", "Qtd", "Produto"],
      ["20,00", "10,00", "UN", 2, "Item invertido"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ITENS_COTACAO");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const legacy = parseExcelToCanonical(buf, "RFQ-SHUFFLE", "shuffle.xlsx");
    assert.strictEqual(legacy.status, "success");
    assert.ok(legacy.items.length >= 1);
    assert.ok(String(legacy.items[0].descricao || "").includes("invertido"));
  });

  it("reconhece coluna Equipamento como descrição e ignora cabeçalhos repetidos em blocos", () => {
    const rows = [
      ["Fornecedor", "Equipamento", "Quantidade", "Valor", "Pix", "Entrega", "Pagamento"],
      ["Kabum", "Apple Mac Mini", 1, "R$ 6.299,00", "-", "15 dias + R$ 18,00", "12x"],
      [],
      ["Fornecedor", "Equipamento", "Quantidade", "Valor", "Pix", "Entrega", "Pagamento"],
      ["Kabum", "Dell Monitor", 1, "R$ 819,00", "-", "10 dias", "6x"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Proposta");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const legacy = parseExcelToCanonical(buf, "RFQ-PIT", "pitagoras.xlsx");
    assert.strictEqual(legacy.status, "success");
    assert.strictEqual(legacy.items.length, 2);
    assert.ok(legacy.items.some((i) => String(i.descricao).includes("Mac Mini")));
    assert.ok(legacy.items.some((i) => String(i.descricao).includes("Dell")));
  });

  it("escolhe aba onde há tabela de itens (2ª aba com cabeçalho)", async () => {
    const capa = XLSX.utils.aoa_to_sheet([
      ["Proposta Comercial", "", ""],
      ["Cliente XYZ", "", ""],
    ]);
    const itens = XLSX.utils.aoa_to_sheet([
      ["Produto", "Qtd", "UN", "Preço Unit", "Total"],
      ["Serviço A", 1, "UN", "100,00", "100,00"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, capa, "Capa");
    XLSX.utils.book_append_sheet(wb, itens, "Itens");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const legacy = parseExcelToCanonical(buf, "RFQ-MULTI", "multi.xlsx");
    assert.strictEqual(legacy.status, "success");
    assert.strictEqual(legacy.sheet?.name, "Itens");
    assert.ok(legacy.items.length >= 1);
  });

  it("NO_HEADER retorna mensagem alinhada (ordem livre, não colunas fixas)", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["A", "B", "C"],
      ["1", "2", "3"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const legacy = parseExcelToCanonical(buf, "RFQ-NOHEAD", "bad.xlsx");
    assert.strictEqual(legacy.status, "error");
    const msg = legacy.errors?.[0]?.message || "";
    assert.ok(msg.includes("ordem das colunas é livre"), msg);
    assert.ok(!msg.includes("colunas esperadas"), msg);
  });
});
