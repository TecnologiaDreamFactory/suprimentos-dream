/**
 * Junção de pares para seção "não categorizado" no XLSX.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  mergePairsDedupe,
  uncategorizedFromUnmappedColumns,
  buildUncategorizedRowsForQuote,
} = require("../rfq/batch/uncategorizedMerge");

describe("uncategorizedMerge", () => {
  it("mergePairsDedupe evita duplicata idêntica", () => {
    const m = mergePairsDedupe(
      [{ label: "A", value: "1" }],
      [{ label: "A", value: "1" }, { label: "B", value: "2" }]
    );
    assert.strictEqual(m.length, 2);
  });

  it("uncategorizedFromUnmappedColumns agrega valores distintos por rótulo", () => {
    const rows = uncategorizedFromUnmappedColumns([
      {
        uncategorized_fragments: [
          { label: "Obs", value: "x" },
          { label: "Obs", value: "y" },
        ],
      },
      { uncategorized_fragments: [{ label: "Campo extra", value: "z" }] },
    ]);
    assert.ok(rows.some((r) => r.label === "Obs" && r.value === "x | y"));
    assert.ok(rows.some((r) => r.label === "Campo extra" && r.value === "z"));
  });

  it("buildUncategorizedRowsForQuote une summary e colunas não mapeadas", () => {
    const out = buildUncategorizedRowsForQuote(
      {
        uncategorized_rows_for_export: [{ label: "PDF", value: "dado" }],
      },
      [
        {
          uncategorized_fragments: [{ label: "Col extra", value: "v" }],
        },
      ]
    );
    assert.strictEqual(out.length, 2);
    assert.ok(out.some((r) => r.label === "PDF"));
    assert.ok(out.some((r) => r.label === "Col extra"));
  });
});
