# Parser `grouped_suppliers` — notas técnicas

## Heurística de blocos

1. **Varredura de cabeçalho** (até ~50 linhas × colunas da grade): para cada célula candidata a **descrição do item** (`mapHeaderToCanonical` → campo `descricao` com confiança ≥ 0,32), percorre as colunas à direita com uma janela deslizante de 3 colunas.
2. **Bloco válido**: sequência **quantidade | preço unitário | total** (campos canônicos `quantidade`, `preco_unitario`, `total` nos aliases), cada um com confiança ≥ 0,32.
3. **Múltiplos blocos**: após cada bloco reconhecido, avança 3 colunas; caso contrário avança 1 coluna até cobrir a linha.
4. **Melhor layout**: escolhe a combinação (linha + coluna de descrição) com maior **score** = `10 × nº de blocos + soma das confianças dos cabeçalhos`.

## Nome do fornecedor

- Linhas imediatamente acima do cabeçalho (`headerRow - 1` … `-3`): texto na primeira coluna do bloco (respeitando **merges** via `!merges` e `getCellDisplayValue`).
- **Variação**: se o 1º bloco começa logo após a coluna de descrição (`startCol === descCol + 1`), usa o texto na **mesma linha** na coluna de descrição (nome “na coluna A” acima dos itens).
- **Merge**: células vazias dentro da área mesclada usam o valor do canto superior esquerdo.
- Se não houver nome: `Fornecedor_N` + alerta.

## Linhas especiais

- **Frete / total / parcelamento / condição de pagamento**: `matchesLabel` nos aliases de `ROW_LABEL_SYNONYMS` (com regra extra para `payment_terms` e texto muito curto &lt; 3 caracteres em `matchesLabel` para evitar falsos positivos, ex.: item “Z” vs “prazo”).
- **Frete**: valores nas colunas **total** (ou unit/qtd) de cada bloco.
- **Total declarado**: mesma leitura por bloco; comparado com soma dos itens + frete (tolerância 0,05) → alerta se divergir.

## Confiança e alertas

- Base ~0,55 + contribuição do score do layout; penalidade se houver alerta de total inconsistente ou zero itens.
- Não inventa valores: células vazias → 0 ou linha ignorada; alertas para revisão manual.

## Limitações atuais

- Uma única coluna de descrição; não há suporte a múltiplas colunas de item (SKU + nome).
- Blocos devem ser **exatamente 3 colunas** consecutivas na ordem qtd → unit → total.
- Cabeçalhos muito ruidosos ou planilhas com duas linhas de cabeçalho misturadas podem exigir ajuste de sinônimos em `config/aliases.js`.
- `payment_terms` com a palavra genérica “pagamento” em linhas longas de item pode, em casos extremos, precisar revisão manual.
- Unidade fixa **UN** nos itens (não lê coluna UM por fornecedor).

## Integração

- `parseWithPipeline` chama `parseGroupedBlocks` quando `detectTemplate` indica `grouped_suppliers` ou quando o parser legado falha com `NO_HEADER`.
- Saída compatível com `validateLegacyResult`, `compareSuppliersFromLegacy` e `buildCanonicalV2FromGrouped`.
