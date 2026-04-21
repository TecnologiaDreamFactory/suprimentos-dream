# Ingestão de PDF, DOCX e TXT (conteúdo livre + IA)

Habilita o processamento de propostas que **não** são planilhas Excel, convertendo o texto do arquivo em itens de cotação via modelo OpenAI.

## Requisitos

- `OPENAI_API_KEY` definida.
- `OPENAI_ENABLE_DOCUMENT_INGEST=1` (padrão: desligado).

## Variáveis de ambiente

| Variável | Descrição | Padrão |
|----------|-----------|---------|
| `OPENAI_ENABLE_DOCUMENT_INGEST` | Liga o fluxo documento → texto → JSON de itens | `false` |
| `OPENAI_DOCUMENT_INGEST_MAX_CHARS` | Máximo de caracteres de texto enviados ao modelo | `120000` |
| `OPENAI_DOCUMENT_INGEST_TIMEOUT_MS` | Timeout da chamada de extração | `min(120000, 2× OPENAI_TIMEOUT_MS)` |

## Formatos

- **PDF**: camada de texto selecionável. PDF escaneado sem OCR costuma falhar com `DOCUMENT_TEXT_EXTRACT` / mensagem de documento sem texto.
- **DOCX**: Word moderno (não `.doc` binário).
- **TXT**: UTF-8 ou Latin-1.

Excel (`.xlsx` / `.xls`) continua usando o **parser determinístico** primeiro; este módulo não substitui planilhas válidas.

## Erros comuns

| Código | Significado |
|--------|-------------|
| `DOCUMENT_INGEST_DISABLED` | Feature ou API key ausente |
| `DOCUMENT_TEXT_EXTRACT` | Falha ao ler texto (PDF vazio, arquivo corrompido) |
| `DOCUMENT_AI_FAILED` | Resposta inválida ou erro na API |
| `DOCUMENT_NO_ITEMS` | Modelo não retornou linhas com descrição válida |

## Revisão manual

Todo resultado `document_ai` vem com `summary.needs_review: true`. Valide valores antes de decisões de compra.
