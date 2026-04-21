# Documentação do Suprimentos Dream

Índice dos arquivos em `docs/`. O panorama geral do sistema está no **[README.md](../README.md)** na raiz do projeto.

| Documento | Conteúdo |
|-----------|----------|
| [integration-schema.md](./integration-schema.md) | Contrato JSON do parse RFQ (`/rfq/parse`, `/api/parse`): campos, erros, exemplos. |
| [batch-observability.md](./batch-observability.md) | Lotes (`/api/compare-batch`): histórico, métricas, decisão manual, endpoints GET/decision. |
| [batch-xlsx-export.md](./batch-xlsx-export.md) | Layout do Excel gerado pelo compare-batch: abas Resumo, Comparação, Condições, Inconsistências. |
| [document-ingest.md](./document-ingest.md) | PDF/DOCX/TXT com IA: envs, limites, códigos de erro. |

## Pastas relacionadas (código)

| Área | Caminho | Função resumida |
|------|---------|-------------------|
| Servidor HTTP | `server.js` | Express, rotas, upload, static `public/`. |
| Parser legado / roteamento | `rfq/` | Pipeline (`parseWithPipeline`), templates grouped, normalização. |
| IA | `ai/` | `openaiConfig.js`, `openaiClient.js` (Responses API), schemas JSON. |
| Batch | `rfq/batch/` | `compareBatch.js`, consolidação, ranking, export XLSX, equivalência semântica, telemetria. |
| Testes | `test/` | `npm test` — suíte Node.js integrada. |

## Variáveis de ambiente

Resumo no README principal; lista completa em **`../.env.example`**.
