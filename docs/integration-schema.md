# Schema de Integração RFQ Parser - OpenAI API

> Localização: `docs/integration-schema.md`. Índice geral: [README.md](./README.md).

## Endpoints Oficiais

### Público (Worker → Backend)
- **GET** `https://calm-dust-6a0e.godreamdevops.workers.dev/ping`
- **POST** `https://calm-dust-6a0e.godreamdevops.workers.dev/rfq/parse`

### Interno (Worker → Tunnel → Backend Local)
- **GET** `https://existing-passport-improvement-marc.trycloudflare.com/ping`
- **POST** `https://existing-passport-improvement-marc.trycloudflare.com/rfq/parse`

---

## GET /ping

### Request
```
GET /ping?trace_id=openai-test-123
```

### Response (200)
```json
{
  "status": "ok",
  "service": "rfq-parser",
  "timestamp": "2026-02-06T01:29:44.254Z",
  "trace_id": "openai-test-123"
}
```

---

## POST /rfq/parse

### Request Body
```json
{
  "file_url": "https://exemplo.com/cotacao.xlsx",
  "rfq_id": "DF-2026-0042",
  "source": "Fornecedor X",
  "trace_id": "openai-test-456"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `file_url` | string | Sim | URL pública do arquivo Excel (.xlsx) |
| `rfq_id` | string | Sim | Identificador da cotação (ex.: número do RFQ) |
| `source` | string | Não | Nome do fornecedor/origem (se vazio, backend retorna "unknown") |
| `trace_id` | string | Não | ID para rastreamento (retornado na resposta) |

### Response Schema (200 - Success)

```json
{
  "status": "success",
  "service": "rfq-parser",
  "rfq_id": "DF-2026-0042",
  "source": "Fornecedor X",
  "trace_id": "openai-test-456",
  
  "sheet": {
    "name": "Plan1",
    "header_row": 7,
    "total_rows": 120
  },
  
  "mapping": {
    "descricao": { "original": "Produto", "confidence": 0.9 },
    "quantidade": { "original": "Qtd", "confidence": 1.0 },
    "unidade": { "original": "UM", "confidence": 0.8 },
    "preco_unitario": { "original": "Valor Unit", "confidence": 0.85 },
    "total": { "original": "Total", "confidence": 1.0 },
    "prazo_entrega": { "original": null, "confidence": 0.0 },
    "impostos_inclusos": { "original": "Impostos?", "confidence": 0.6 },
    "frete_incluso": { "original": null, "confidence": 0.0 },
    "fornecedor": { "original": "Fornecedor", "confidence": 0.9 }
  },
  
  "items": [
    {
      "row": 8,
      "descricao": "Roteador WiFi Dual Band",
      "quantidade": 5,
      "unidade": "UN",
      "preco_unitario": 250.00,
      "total": 1250.00,
      "prazo_entrega": null,
      "impostos_inclusos": true,
      "frete_incluso": null,
      "warnings": []
    },
    {
      "row": 9,
      "descricao": "Cabo HDMI 3m",
      "quantidade": 10,
      "unidade": "UN",
      "preco_unitario": 35.50,
      "total": 355.00,
      "prazo_entrega": 7,
      "impostos_inclusos": true,
      "frete_incluso": false,
      "warnings": ["Unidade normalizada de 'unidade' para 'UN'"]
    }
  ],
  
  "summary": {
    "items_total": 12,
    "items_parsed": 10,
    "items_with_warnings": 2,
    "items_invalid": 0,
    "needs_review": true,
    "review_reasons": [
      "2 colunas não mapeadas (prazo_entrega, frete_incluso)",
      "Confiança baixa (<0.7) em: impostos_inclusos"
    ]
  },
  
  "warnings": [
    "Coluna 'Observações' ignorada (não mapeada)",
    "2 linhas vazias ignoradas (linhas 15, 23)"
  ],
  
  "errors": []
}
```

### Response Schema (400/404/408/500 - Error)

```json
{
  "status": "error",
  "service": "rfq-parser",
  "rfq_id": "DF-2026-0042",
  "trace_id": "openai-test-456",
  "error": "Arquivo não encontrado na URL informada.",
  "code": "FILE_NOT_FOUND",
  "details": null
}
```

**Códigos de erro:**
- `MISSING_FILE_URL` - `file_url` ausente ou inválido
- `MISSING_RFQ_ID` - `rfq_id` ausente
- `FILE_NOT_FOUND` - Arquivo não encontrado na URL (404)
- `TIMEOUT` - Timeout ao baixar arquivo (408)
- `HTTP_ERROR` - Erro HTTP ao acessar URL (4xx/5xx)
- `INTERNAL_ERROR` - Erro interno do parser (500)

---

## Campos do Schema

### `sheet`
Informações sobre a planilha processada.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | string | Nome da aba processada |
| `header_row` | number | Número da linha do cabeçalho (1-based) |
| `total_rows` | number | Total de linhas na planilha |

### `mapping`
Mapeamento de colunas canônicas para colunas originais do Excel.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `original` | string \| null | Nome original da coluna no Excel |
| `confidence` | number | Confiança do mapeamento (0.0 a 1.0) |

**Campos canônicos esperados:**
- `descricao` - Descrição do produto/item
- `quantidade` - Quantidade solicitada
- `unidade` - Unidade de medida (UN, CX, KG, DIÁRIA, etc.)
- `preco_unitario` - Preço unitário
- `total` - Total (calculado se ausente)
- `prazo_entrega` - Prazo de entrega em dias (opcional)
- `impostos_inclusos` - Boolean indicando se impostos estão inclusos (opcional)
- `frete_incluso` - Boolean indicando se frete está incluso (opcional)
- `fornecedor` - Nome do fornecedor (opcional)

### `items[]`
Array de itens mapeados da planilha.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `row` | number | Número da linha no Excel (1-based) |
| `descricao` | string | Descrição do item |
| `quantidade` | number | Quantidade |
| `unidade` | string | Unidade padronizada |
| `preco_unitario` | number | Preço unitário |
| `total` | number | Total (quantidade × preço ou valor da coluna) |
| `prazo_entrega` | number \| null | Prazo em dias (se mapeado) |
| `impostos_inclusos` | boolean \| null | Se impostos estão inclusos (se mapeado) |
| `frete_incluso` | boolean \| null | Se frete está incluso (se mapeado) |
| `warnings` | string[] | Avisos específicos deste item |

### `summary`
Resumo do processamento.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `items_total` | number | Total de linhas consideradas como item (exclui cabeçalho, exclui TOTAL GERAL, etc.) |
| `items_parsed` | number | Quantos itens foram parseados e incluídos no array `items` |
| `items_with_warnings` | number | Quantos itens têm warnings (mas são válidos) |
| `items_invalid` | number | Quantos itens foram rejeitados (descrição vazia, qtd inválida, preço inválido) |
| `needs_review` | boolean | Se precisa revisão manual |
| `review_reasons` | string[] \| null | Motivos para revisão |

### `warnings`
Array de avisos gerais (colunas ignoradas, linhas vazias, etc.). **Sempre array** (vazio `[]` se não houver avisos).

### `errors`
Array de erros críticos. **Sempre array** (vazio `[]` em sucesso, ou `[{code, message, details}]` em erro).

---

## Logs do Backend

O backend loga todas as requisições com o formato:

```
[OPENAI TRACE] 2026-02-06T01:29:44.254Z | GET /ping | trace_id=openai-test-123
[OPENAI TRACE] headers: {"host":"...", "content-type":"..."}
```

Para POST:
```
[OPENAI TRACE] 2026-02-06T01:29:44.254Z | POST /rfq/parse | trace_id=openai-test-456
[OPENAI TRACE] headers: {...}
[OPENAI TRACE] body: {"file_url":"...", "rfq_id":"...", "trace_id":"openai-test-456"}
```

---

## Exemplo de Uso

### cURL
```bash
curl -X POST "https://calm-dust-6a0e.godreamdevops.workers.dev/rfq/parse" \
  -H "Content-Type: application/json" \
  -d '{
    "file_url": "https://exemplo.com/cotacao.xlsx",
    "rfq_id": "DF-2026-0042",
    "source": "Fornecedor X",
    "trace_id": "test-123"
  }'
```

### JavaScript (fetch)
```javascript
const response = await fetch('https://calm-dust-6a0e.godreamdevops.workers.dev/rfq/parse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    file_url: 'https://exemplo.com/cotacao.xlsx',
    rfq_id: 'DF-2026-0042',
    source: 'Fornecedor X',
    trace_id: 'test-123'
  })
});
const data = await response.json();
```

---

## Notas de Implementação

- **Content-Type**: Sempre `application/json` (inclusive em erros)
- **Trace ID**: Sempre ecoado na resposta quando enviado na requisição
- **Source**: Sempre retornado na resposta (nunca `null`). Se não fornecido, retorna `"unknown"`
- **Errors**: Sempre array (não `null`). Em sucesso: `[]`. Em erro: `[{code, message, details?}]`
- **Warnings**: Sempre array (não `null`). Vazio `[]` se não houver avisos
- **Confiança**: Valores entre 0.0 e 1.0; < 0.7 indica possível necessidade de revisão
- **Unidades**: Padronizadas para UN, CX, KG, DIÁRIA, M², L, PC, PCT (outras mantidas em maiúsculo)
- **Validação**: Itens com quantidade ≤ 0 ou preço ≤ 0 geram warnings e podem marcar `needs_review`
- **Linhas vazias**: Ignoradas automaticamente (linhas sem descrição)
- **Linhas TOTAL GERAL**: Ignoradas automaticamente (linhas com descrição contendo "TOTAL GERAL" ou "TOTAL")
