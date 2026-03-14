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
