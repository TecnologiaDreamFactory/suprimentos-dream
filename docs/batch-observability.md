# Batch — observabilidade e decisão manual

> Localização: `docs/batch-observability.md`. Índice geral: [README.md](./README.md).

## Arquivos

| Arquivo | Função |
|---------|--------|
| `rfq/batch/batchMetrics.js` | Monta `metrics_summary` (tempos por etapa, contagens, `analysis_source`). |
| `rfq/batch/batchDecision.js` | Constantes de status e regra inicial `processed` / `review_required`. |
| `rfq/batch/batchHistoryStore.js` | Persistência JSON por lote (`saveBatchRecord`, `loadBatchRecord`, `applyDecision`). |
| `rfq/batch/compareBatch.js` | Instrumentação de tempo + campos `created_at`, `decision_status`, `metrics_summary`, `comparison_result_summary`. |
| `rfq/batch/batchResponse.js` | Resposta “slim” inclui `created_at`, `decision_status`, `metrics_summary`. |
| `rfq/batch/workbookExport.js` | Aba **Resumo** com `batch_id`, `created_at`, `decision_status` e métricas. |
| `data/batch-history/` | Diretório padrão de armazenamento (um `.json` por `batch_id`). |

Variável de ambiente opcional: **`BATCH_HISTORY_DIR`** — sobrescreve o diretório de histórico (caminho absoluto recomendado).

## Estrutura do storage

Arquivo: `data/batch-history/<batch_id_sanitizado>.json`

Campos principais:

- `batch_id`, `created_at`, `updated_at`
- `decision_status`: `processed` | `review_required` | `approved` | `rejected`
- `request_summary`: `{ files_received, file_names[] }`
- `review_summary` (snapshot)
- `comparison_result_summary` (vencedor + ranking resumido)
- `export_filename`
- `metrics_summary`
- `audit_log[]`: entradas com `previous_status`, `new_status`, `reason`, `decided_by`, `decided_at`, `notes?`

## Contrato `POST /api/compare-batch` (compatível)

Novos campos adicionados **sem remover** os existentes:

- `created_at` (ISO 8601)
- `decision_status`
- `metrics_summary` (inclui `stage_timings_ms`: `parse`, `consolidate`, `rank`, `openai`, `review_build`, `export`)
- `comparison_result_summary` (no payload completo; no modo slim continua omitido se não estiver no `shapeCompareBatchResponse` — hoje **não** entra no slim; só no debug ou resposta completa do motor)

Verificação: `shapeCompareBatchResponse` **não** inclui `comparison_result_summary` no slim (mantém contrato enxuto). O histórico em disco guarda `comparison_result_summary` após o processamento.

## Novos endpoints

### `GET /api/compare-batch/:batchId`

`batchId` deve corresponder ao padrão `B-<timestamp>-<hex>` (mesmo formato gerado pelo motor).

**200**

```json
{
  "status": "ok",
  "batch_id": "B-1730000000000-a1b2c3d4",
  "created_at": "2026-03-24T12:00:00.000Z",
  "updated_at": "2026-03-24T12:00:01.000Z",
  "decision_status": "review_required",
  "request_summary": { "files_received": 2, "file_names": ["a.xlsx", "b.xlsx"] },
  "review_summary": { },
  "comparison_result_summary": { },
  "export_filename": "batch-B-1730000000000-a1b2c3d4.xlsx",
  "metrics_summary": { },
  "audit_log": []
}
```

**404** — lote nunca persistido (ex.: erro antes do save ou ID inexistente).

### `POST /api/compare-batch/:batchId/decision`

Corpo:

```json
{
  "status": "approved",
  "reason": "Conferência de preços OK",
  "decided_by": "compras@empresa.com.br",
  "notes": "Opcional"
}
```

`status` obrigatório: `approved` | `rejected`. `reason` e `decided_by` obrigatórios.

**200**

```json
{
  "status": "ok",
  "record": { },
  "audit": {
    "batch_id": "B-...",
    "previous_status": "review_required",
    "new_status": "approved",
    "reason": "...",
    "decided_by": "...",
    "decided_at": "2026-03-24T12:05:00.000Z",
    "notes": "Opcional"
  }
}
```

## Fluxo

1. Cliente envia `POST /api/compare-batch` com `files[]`.
2. Servidor executa o pipeline, gera XLSX (duas gravações sequenciais: primeira mede tempo de export; segunda reescreve o arquivo com métricas e tempos finais).
3. Resposta JSON inclui `decision_status` inicial e `metrics_summary`.
4. Registro é salvo em `data/batch-history/<id>.json` (falha de disco não falha a API — apenas log).
5. Se `manual_review_required`, status inicial `review_required`; caso contrário `processed`.
6. Humano chama `POST .../decision` para `approved` ou `rejected`; auditoria é anexada ao JSON.

## Riscos e limitações

- **Armazenamento local**: sem concorrência robusta entre múltiplas instâncias; sem backup automático.
- **Histórico só em sucesso**: lotes com erro de validação (`status: error`) não são persistidos nesta versão.
- **GET** depende do arquivo existir no mesmo servidor/diretório onde foi gerado.
- **XLSX após decisão manual**: o arquivo exportado no passo 1 não é regerado com o status `approved/rejected`; o status atualizado está no JSON e pode ser consultado via GET.
- **Regex de `batchId` na rota**: IDs fora do padrão `B-<digits>-<hex>` retornam 400.
