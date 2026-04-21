/**
 * Schema estável do XLSX de exportação em lote (abas, ordem de colunas, headers).
 * Abas: Itens por fornecedor, Comparação (matriz por item).
 */

const SHEETS = {
  RESUMO: "Resumo",
  POR_FORNECEDOR: "Itens por fornecedor",
  COMPARACAO: "Comparação",
};

/** Ordem das abas no export atual */
const SHEET_ORDER = [SHEETS.POR_FORNECEDOR, SHEETS.COMPARACAO];

const RESUMO_COLUMNS = [
  { key: "campo", header: "Campo", width: 28 },
  { key: "valor", header: "Valor", width: 80 },
];

/** Base da aba Comparação (legado / testes antigos) */
const COMPARACAO_FIXED_COLUMNS = [
  { key: "item_key", header: "item_key", width: 36 },
  { key: "descricao_ref", header: "descrição referência", width: 42 },
  { key: "qtd_ref", header: "qtd referência", width: 14 },
];

const COMPARACAO_PROPOSAL_SUFFIXES = ["preço unit.", "total linha", "prazo de entrega", "obs"];

/** Igual ao número de sufixos por proposta */
const COMPARACAO_COLS_PER_PROPOSAL = COMPARACAO_PROPOSAL_SUFFIXES.length;

/** Larguras opcionais por sufixo (mesma ordem que COMPARACAO_PROPOSAL_SUFFIXES) */
const COMPARACAO_PROPOSAL_COLUMN_WIDTHS = [16, 14, 18, 20];

/** Aba empilhada: um bloco por proposta (leitura humana) */
const POR_FORNECEDOR_COLUMNS = [
  { key: "arquivo_origem", header: "Arquivo de origem", width: 34 },
  { key: "descricao", header: "Descrição do item", width: 44 },
  { key: "quantidade", header: "Qtd", width: 10 },
  { key: "preco_unitario", header: "Preço unit.", width: 16 },
  { key: "total_linha", header: "Total linha", width: 14 },
  { key: "prazo_dias", header: "Prazo de entrega", width: 22 },
  { key: "condicao_pagamento", header: "Condição de pagamento", width: 38 },
];

/** Moeda BRL (exceljs numFmt) */
const NUMFMT_BRL = "R$ #,##0.00";

const NUMFMT_PCT = "0.00%";

/** Cores ARGB (tema leve) */
const FILL_MIN_PRICE = "FFE8F5E9";
const FILL_HEADER = "FFF5F5F5";

module.exports = {
  SHEETS,
  SHEET_ORDER,
  RESUMO_COLUMNS,
  COMPARACAO_FIXED_COLUMNS,
  COMPARACAO_PROPOSAL_SUFFIXES,
  COMPARACAO_COLS_PER_PROPOSAL,
  COMPARACAO_PROPOSAL_COLUMN_WIDTHS,
  POR_FORNECEDOR_COLUMNS,
  NUMFMT_BRL,
  NUMFMT_PCT,
  FILL_MIN_PRICE,
  FILL_HEADER,
};
