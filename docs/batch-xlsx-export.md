# Schema do XLSX de exportação em lote (`/api/compare-batch`)

> Localização: `docs/batch-xlsx-export.md`. Índice geral: [README.md](./README.md).

Constantes definidas em `rfq/batch/xlsxSchema.js`. Inclui condições por proposta, leitura **Itens por fornecedor** (blocos empilhados), matriz **Comparação** por item, inconsistências e metadados técnicos (sem “vencedor sugerido” nem score numérico na planilha).

## Abas (ordem)

| Ordem | Nome da aba |
|------:|---------------|
| 1 | Condições Gerais |
| 2 | Itens por fornecedor |
| 3 | Comparação |
| 4 | Inconsistências |

## Aba **Condições Gerais**

1. **Tabela principal** — colunas (ordem):

   - Fornecedor / proposta  
   - Arquivo origem  
   - Frete  
   - Total declarado  
   - Total recalculado  
   - Parcelamento  
   - Condição pagamento  
   - Quantidade de avisos (número; não induz decisão)

**Cores (condições gerais)** — cada proposta recebe um tom de uma paleta **quente → fria** conforme a **pontuação de vitórias** na matriz de comparação (melhor preço unitário por linha + menor prazo em dias por linha, com empates contando para todos empatados). A célula **Fornecedor / proposta** usa esse tom. Células com **menor total recalculado** e **menor frete** (entre valores &gt; 0) recebem o tom da proposta que atinge esse valor (empates: todas destacadas).

## Aba **Itens por fornecedor**

Visão empilhada para leitura humana: para cada proposta (na mesma ordem da consolidação), um bloco com:

1. Linha mesclada **Fornecedor: …** (negrito, cor da proposta, como em Condições Gerais).
2. Linha mesclada **Arquivo: …** (arquivo de origem).
3. Tabela: **Arquivo de origem** (nome do `.xlsx`/arquivo enviado, repetido em cada linha) | **Descrição do item** | **Qtd** | **Preço unit.** | **Total linha** | **Prazo (dias)** | **Condição de pagamento** (esta última repetida por linha, a partir de `payment_terms` da proposta; texto ou JSON resumido). Se a lista `items` da proposta estiver vazia mas a matriz consolidada tiver células preenchidas para essa proposta, as linhas são montadas a partir da consolidação.
4. Linha em branco antes do próximo fornecedor.

Sem autofiltro nesta aba (layout em blocos). Valores monetários com formato BRL.

## Aba **Comparação**

Matriz consolidada por `item_key`: colunas fixas (item, descrição referência, qtd referência) e, para cada proposta, **preço unit.**, **total linha**, **prazo (dias)**, **obs** (ex.: quantidade divergente).

- Cabeçalho em duas linhas: nome do fornecedor (mesclado por proposta) e subcabeçalhos.
- **Melhor preço** na linha (mínimo entre preços unitários válidos): célula de preço pintada com a cor da proposta vencedora (empate no mínimo: todas as empatadas).
- **Melhor prazo** na linha (mínimo entre prazos em dias &gt; 0, quando existir dado parseado): idem na coluna de prazo. Planilhas no formato agrupado sem prazo por item podem não ter destaque de prazo até o parser preencher o campo.

O prazo por linha depende da coluna canônica `prazo_entrega` no parse (não exportado como texto em **obs**).

Não há bloco “Metadados do lote” na planilha. Decisões manuais gravadas no histórico podem ainda ser refletidas no XLSX via `patchBatchWorkbookMetadata` (linhas Campo/Valor ao final da aba, apenas se existir fluxo de decisão).

Primeira linha da tabela principal: cabeçalho (congelada, autofiltro).

## Aba **Inconsistências**

Headers (ordem): Arquivo | Fornecedor | Tipo | Detalhe | Severidade

- `severidade` = `blocking` → fundo vermelho claro (bloqueante).
- `severidade` = `error` → fundo rosado.

## Variáveis de ambiente relacionadas

| Variável | Efeito |
|----------|--------|
| `BATCH_EXPORT_TTL_MS` | Idade máxima do arquivo antes da limpeza (padrão 24h). |
| `BATCH_EXPORT_CLEANUP_INTERVAL_MS` | Intervalo da limpeza periódica (padrão 1h). |
| `BATCH_DOWNLOAD_REQUIRE_TOKEN` | Se `true`, GET `/downloads/...` exige `?token=`. |
| `BATCH_DOWNLOAD_TOKEN_TTL_MS` | Validade do token (padrão 15 min). |
