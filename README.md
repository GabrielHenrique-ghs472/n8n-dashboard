# n8n Error Dashboard

Deploy recomendado: Render (plano Free).

## Rodar local

```bash
npm ci
npm start
```

Acesse: `http://localhost:3456`

## Deploy no Render

1. Suba este projeto para um repositório no GitHub.
2. No Render, clique em **New +** > **Blueprint** e conecte o repositório.
3. O Render vai ler o `render.yaml` automaticamente.
4. Configure as variáveis de ambiente:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `DATABASE_URL`
   - `DATABASE_SERVICE_KEY`
   - `CLICKUP_TOKEN`
   - `CLICKUP_LIST_ID`
5. Faça o deploy e use a URL pública gerada.

## Observações

- O plano Free pode entrar em sleep após inatividade.
- `report.json` e `sync-result.json` são dados de runtime e não devem ir para o Git.

## Agendamento automático (sem abrir o site)

Este projeto usa GitHub Actions para disparar automaticamente:
- `POST /api/refresh`
- `POST /api/sync`

Horários configurados:
- 07:00 (America/Sao_Paulo), segunda a sexta
- 16:00 (America/Sao_Paulo), segunda a sexta

No cron UTC do GitHub isso equivale a:
- `0 10 * * 1-5`
- `0 19 * * 1-5`

Arquivo: `.github/workflows/scheduled-actions.yml`
