# Runbook Operacional

## Deploy (Render)

1. Push no branch `main`
2. Render -> serviço `infraestrutura-grupo-sintese`
3. `Manual Deploy` -> `Deploy latest commit`
4. Validar URL: `https://n8n-error-dashboard.onrender.com`

## Variáveis obrigatórias

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `DATABASE_URL`
- `DATABASE_SERVICE_KEY`
- `CLICKUP_TOKEN`
- `CLICKUP_LIST_ID`

Sem essas variáveis, rotas de banco retornam erro de configuração.

## Smoke tests pós deploy

Endpoints:
- `GET /api/status` -> 200
- `GET /api/clients` -> 200
- `GET /api/owner-users` -> 200
- `GET /api/workflow-update-url` -> `{ "url": "/workflow-update/" }`
- `GET /api/workflow-update/health` -> 200
- `GET /api/script-update/clients` -> 200

UI:
- Aba `Estrutura de clientes` carrega
- Aba `Infra de servidores` carrega
- Aba `Atualização de workflows` abre iframe interno sem localhost
- Aba `Atualização scripts` carrega clientes e workflows normalmente

## Rollback

Opção rápida (Render):
- `Events` -> escolher deploy anterior -> `Rollback`

Opção definitiva (Git):
- `git revert` dos commits problemáticos
- push no `main`
- novo deploy

## Troubleshooting

### Erro: `supabaseUrl is required`

Causa:
- variáveis `SUPABASE_*` ausentes no serviço ativo

Ação:
- revisar `Environment` no Render
- salvar e redeployar

### Iframe mostra localhost recusado

Causa:
- fallback/localhost em configuração antiga

Ação:
- confirmar commit atual
- validar `GET /api/workflow-update-url` retornando `"/workflow-update/"`

### 502 no módulo de atualização

Causa:
- processo `workflow-update` não iniciou corretamente

Ação:
- checar logs do serviço principal
- verificar se `node src/server/index.js` sobe em `workflow-update/`
- confirmar dependências instaladas (`npm ci`)

### Erro na aba "Atualização scripts"

Causas comuns:
- cliente sem `n8n_url` ou `api_key`
- workflow sem nodes elegíveis (`Dados*` tipo `set` com campo contendo `script`)
- timeout/falha de rede na API do n8n

Ação:
- validar `GET /api/script-update/clients`
- validar se cliente escolhido tem `n8n_url` e `api_key`
- testar listagem de workflows: `GET /api/script-update/clients/:id/workflows`
- conferir logs do serviço para mensagens de `Falha n8n (HTTP ...)`

## Agendamentos

GitHub Actions (`.github/workflows/scheduled-actions.yml`):
- Dispara `/api/sync` e `/api/refresh`
- Segunda a sexta, 07:00 e 16:00 America/Sao_Paulo
