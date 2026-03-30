# Arquitetura

## Visão geral

O sistema roda em um único serviço Node (`server.js`) e possui dois blocos principais:

1. Dashboard principal (HTML + JS em `index.html`)
2. Módulo interno de atualização de workflows (`workflow-update/`)

Ambos são servidos no mesmo domínio de produção.

## Componentes

- `server.js`
  - Servidor HTTP principal
  - Rotas de dados do dashboard
  - Spawn e proxy do módulo `workflow-update`
- `index.html`
  - Interface principal
  - Lógica client-side para todas as abas
- `workflow-update/src/server/*`
  - API e regras de atualização de workflows n8n
- `workflow-update/public/*`
  - Frontend do módulo de atualização

## Roteamento

Rotas principais do dashboard:
- `GET /` -> HTML do dashboard
- `GET /api/report`
- `POST /api/refresh`
- `GET /api/status`
- `POST /api/sync`
- `GET /api/sync-result`
- `GET /api/clients`
- `PATCH /api/clients/:id`
- `GET /api/owner-users`
- `POST /api/duplicacao`
- `GET /api/workflow-update-url` -> retorna `"/workflow-update/"`

Proxy interno do módulo de atualização:
- `GET/POST/... /workflow-update/*` -> proxy para módulo interno
- `GET/POST/... /api/workflow-update/*` -> proxy para `/api/*` do módulo interno

## Dados e integrações

Supabase principal (clientes):
- Tabela `mcp_clientes`
- Usada por dashboard, manutenção e duplicação

Supabase database (owners):
- Tabela `users`
- Usada para busca de owners (`role = owner`)

Webhook externo:
- `POST https://webhooksintese.gruposintesedigital.com/webhook/dados-duplicacao`
- Acionado por `POST /api/duplicacao`

## Fluxo da aba "Atualização de workflows"

1. Front principal chama `GET /api/workflow-update-url`
2. Recebe `"/workflow-update/"`
3. Aba renderiza iframe para rota interna
4. Iframe consome `/api/workflow-update/*` no mesmo domínio (via proxy)

## Processo interno do módulo

No startup do `server.js`:
- Sobe processo filho com `node src/server/index.js` em `workflow-update/`
- Porta interna padrão: `4399` (`WORKFLOW_UPDATE_INTERNAL_PORT`)
- O cliente nunca acessa essa porta diretamente

## Decisões de design

- Domínio único: evita dependência de serviço externo para atualização
- Namespacing de API: evita conflito entre APIs do dashboard e do módulo
- Processo separado interno: mantém organização do código do módulo sem acoplamento excessivo no `server.js`
