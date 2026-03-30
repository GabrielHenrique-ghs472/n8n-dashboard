# Infraestrutura - Grupo Sintese

Dashboard operacional para:
- Monitoramento de erros n8n
- Estrutura/infra de clientes
- Manutenção de flags de cliente
- Fluxo de duplicação de credenciais
- Módulo interno de atualização de workflows

## Estrutura do projeto

- Front principal: `index.html`
- Backend principal: `server.js`
- Módulo interno de atualização: `workflow-update/`
- Jobs agendados: `.github/workflows/scheduled-actions.yml`

Documentação de contexto:
- Arquitetura: `ARCHITECTURE.md`
- Operação/deploy/troubleshooting: `RUNBOOK.md`
- Handoff para outras IAs: `CONTEXT_FOR_AI.md`

## Rodar localmente

```bash
npm ci
npm start
```

Acesse: `http://localhost:3456`

## Variáveis de ambiente

Obrigatórias:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `DATABASE_URL`
- `DATABASE_SERVICE_KEY`
- `CLICKUP_TOKEN`
- `CLICKUP_LIST_ID`

O backend principal valida essas variáveis em runtime para rotas que dependem de banco.

## Deploy no Render

1. Conecte o repositório.
2. Faça deploy do Blueprint (`render.yaml`).
3. Preencha as variáveis de ambiente obrigatórias.
4. Faça deploy.

URL de produção atual:
- `https://n8n-error-dashboard.onrender.com`

## Agendamento automático

Workflow GitHub:
- `.github/workflows/scheduled-actions.yml`

Ele dispara:
- `POST /api/sync`
- `POST /api/refresh`

Horários:
- 07:00 (America/Sao_Paulo), segunda a sexta
- 16:00 (America/Sao_Paulo), segunda a sexta
