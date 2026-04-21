/**
 * Testes do parser grouped_suppliers (blocos de 3 colunas por fornecedor).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const XLSX = require("xlsx");

const {
  parseGroupedBlocks,
  findHeaderLayout,
} = require("../rfq/templates/groupedBlocksParser");
const { parseWithPipeline } = require("../rfq/pipeline");

function toBuffer(aoa, sheetName = "ITENS_COTACAO", merges) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges && merges.length) {
    ws["!merges"] = merges;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("findHeaderLayout", () => {
  it("encontra descrição + dois blocos qtd/unit/total", () => {
    const rows = [
      ["", "Forn A", "", "", "Forn B", "", ""],
      [
        "Produto",
        "Qtd",
        "Valor Unitário",
        "Valor Total",
        "Qtd",
        "Vl Unit",
        "Vl Total",
      ],
      ["Item 1", 1, 10, 10, 2, 9, 18],
    ];
    const layout = findHeaderLayout(rows, []);
    assert.ok(layout);
    assert.strictEqual(layout.headerRow, 1);
    assert.strictEqual(layout.descCol, 0);
    assert.strictEqual(layout.blocks.length, 2);
  });
});

describe("parseGroupedBlocks — template padrão", () => {
  it("dois fornecedores, itens e totais", () => {
    const aoa = [
      ["", "Alpha Ltda", "", "", "Beta SA", "", ""],
      [
        "Descrição",
        "Quantidade",
        "Preço Unitário",
        "Total",
        "Quantidade",
        "Preço Unitário",
        "Total",
      ],
      ["Caneta", 10, 2, 20, 10, 2.5, 25],
      ["Papel", 5, 100, 500, 5, 90, 450],
    ];
    const buf = toBuffer(aoa);
    const out = parseGroupedBlocks(buf, "COT-001", "web");
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.legacy.status, "success");
    assert.strictEqual(out.legacy.summary._template, "grouped_suppliers");
    assert.strictEqual(out.legacy.items.length, 4);
    const alpha = out.legacy.items.filter((i) => i.fornecedor === "Alpha Ltda");
    assert.strictEqual(alpha.length, 2);
    assert.strictEqual(out.legacy.summary.best_supplier, "Beta SA");
  });
});

describe("parseGroupedBlocks — variações de cabeçalho", () => {
  it("abreviações Vl Unit / Qtde", () => {
    const aoa = [
      ["", "X", "", "", "Y", "", ""],
      ["Item", "Qtde", "Vl Unit", "Vl Total", "Qtd.", "Valor unitario", "Total"],
      ["Z", 1, 5, 5, 1, 6, 6],
    ];
    const buf = toBuffer(aoa);
    const out = parseGroupedBlocks(buf, "R1", "s");
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.legacy.items.length, 2);
  });
});

describe("parseGroupedBlocks — merge no nome do fornecedor", () => {
  it("usa canto superior esquerdo da região mesclada", () => {
    const aoa = [
      ["", "Nome Longo Fornecedor Unico", "", "", "B", "", ""],
      [
        "Produto",
        "Qtd",
        "Preço Unitário",
        "Total",
        "Qtd",
        "Preço Unitário",
        "Total",
      ],
      ["A", 1, 1, 1, 1, 1, 1],
    ];
    const merges = [{ s: { r: 0, c: 1 }, e: { r: 0, c: 3 } }];
    const buf = toBuffer(aoa, "ITENS_COTACAO", merges);
    const out = parseGroupedBlocks(buf, "M1", "s");
    assert.strictEqual(out.ok, true);
    const names = [...new Set(out.legacy.items.map((i) => i.fornecedor))];
    assert.ok(names.some((n) => n.includes("Nome Longo")));
  });
});

describe("parseGroupedBlocks — frete renomeado", () => {
  it("detecta linha Transporte", () => {
    const aoa = [
      ["", "A", "", "", "B", "", ""],
      [
        "Descrição",
        "Quantidade",
        "Preço Unitário",
        "Total",
        "Quantidade",
        "Preço Unitário",
        "Total",
      ],
      ["X", 1, 10, 10, 1, 10, 10],
      ["Transporte", 0, 0, 15, 0, 0, 20],
    ];
    const buf = toBuffer(aoa);
    const out = parseGroupedBlocks(buf, "F1", "s");
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.legacy.summary.freight_by_supplier["A"], 15);
    assert.strictEqual(out.legacy.summary.freight_by_supplier["B"], 20);
  });
});

describe("parseGroupedBlocks — total inconsistente", () => {
  it("emite alerta quando declarado difere da soma", () => {
    const aoa = [
      ["", "A", "", "", "B", "", ""],
      [
        "Descrição",
        "Quantidade",
        "Preço Unitário",
        "Total",
        "Quantidade",
        "Preço Unitário",
        "Total",
      ],
      ["Item", 1, 100, 100, 1, 100, 100],
      ["Total", "", "", 999, "", "", 200],
    ];
    const buf = toBuffer(aoa);
    const out = parseGroupedBlocks(buf, "T1", "s");
    assert.strictEqual(out.ok, true);
    assert.ok(
      out.parsing_alerts.some((a) => a.includes("inconsistente") || a.includes("999")),
      "deve alertar inconsistência"
    );
  });
});

describe("parseGroupedBlocks — campo ausente em um fornecedor", () => {
  it("continua com um bloco válido e alerta na linha problemática", () => {
    const aoa = [
      ["", "A", "", "", "B", "", ""],
      [
        "Descrição",
        "Quantidade",
        "Preço Unitário",
        "Total",
        "Quantidade",
        "Preço Unitário",
        "Total",
      ],
      ["Item", 1, 10, 10, "", "", ""],
    ];
    const buf = toBuffer(aoa);
    const out = parseGroupedBlocks(buf, "E1", "s");
    assert.strictEqual(out.ok, true);
    const bItems = out.legacy.items.filter((i) => i.fornecedor === "B");
    assert.ok(
      bItems.every((i) => i.quantidade <= 0 && i.total <= 0) || out.parsing_alerts.length > 0
    );
  });
});

describe("parseWithPipeline integração grouped", () => {
  it("usa grouped quando router detecta layout", async () => {
    const aoa = [
      ["", "F1", "", "", "F2", "", ""],
      [
        "Produto",
        "Qtd",
        "Valor Unitário",
        "Valor Total",
        "Qtd",
        "Valor Unitário",
        "Valor Total",
      ],
      ["P", 2, 5, 10, 2, 6, 12],
    ];
    const buf = toBuffer(aoa);
    const res = await parseWithPipeline(buf, "INT-1", "src", { skipOpenAI: true });
    assert.strictEqual(res.parser_version, 2);
    assert.strictEqual(res.template_detection.template_type, "grouped_suppliers");
    assert.strictEqual(res.summary._template, "grouped_suppliers");
    assert.ok(res.canonical_quotation);
    assert.strictEqual(res.canonical_quotation.template_type, "grouped_suppliers");
  });
});
