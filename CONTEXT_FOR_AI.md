# Contexto para Continuidade por Outra IA

## Objetivo do produto

Centralizar operação de infraestrutura n8n em um único painel:
- visão de clientes/servidores
- manutenção de flags
- monitoramento de erros
- atualização de workflows
- atualização de scripts
- fluxo de duplicação de credenciais

## Estado atual (importante)

- Projeto principal: `n8n-dashboard`
- Módulo de atualização integrado internamente em `workflow-update/`
- Módulo de atualização de scripts integrado nativamente no projeto principal
- Não depende de URL externa para a aba de atualização
- A aba usa iframe para rota interna `/workflow-update/`
- A aba de scripts NÃO usa iframe e NÃO usa serviço separado

## Contratos de API importantes

Dashboard:
- `GET /api/clients`
- `PATCH /api/clients/:id`
- `GET /api/owner-users`
- `POST /api/duplicacao`
- `POST /api/sync`
- `POST /api/refresh`
- `GET /api/report`
- `GET /api/status`
- `GET /api/workflow-update-url`
- `GET /api/script-update/clients`
- `GET /api/script-update/clients/:id/workflows`
- `GET /api/script-update/clients/:id/workflows/:workflowId/script-types`
- `GET /api/script-update/clients/:id/workflows/:workflowId/scripts?scriptName=...`
- `POST /api/script-update/clients/:id/workflows/:workflowId/review`
- `POST /api/script-update/clients/:id/workflows/:workflowId/save`

Módulo de atualização (proxy interno):
- `/api/workflow-update/*`
- `/workflow-update/*`

Módulo de scripts (nativo no servidor principal):
- `/api/script-update/*`

## Decisões de negócio implementadas

- Owner list vem de `Database.users` com `role = owner`
- Duplicação envia webhook e depois persiste/atualiza `mcp_clientes`
- Uma API key por servidor nas tabelas de infra
- Redirecionamento pós envio abre nova aba

## Pontos sensíveis

- Evitar reintroduzir fallback para `localhost` na aba de atualização
- Cuidar para não conflitar rotas `/api/*` entre dashboard e módulo
- Em Render free, serviço pode dormir sem tráfego
- Na aba de scripts, manter escopo isolado em funções `scriptUpdate*`
- Save de scripts usa lock por cliente/workflow e gera backup local

## Convenções práticas

- Backend principal em CommonJS (`server.js`)
- Módulo interno usa ESM em pasta própria (`workflow-update/`)
- Evitar alteração destrutiva em massa sem commit incremental
- Sempre validar rotas críticas após merge
- Scripts update está no `index.html` + `server.js` (sem pasta de módulo separada no runtime)

## Checklist antes de mexer

1. Ler `ARCHITECTURE.md`
2. Ler `RUNBOOK.md`
3. Validar ambiente do Render
4. Testar `/api/workflow-update-url` e `/api/workflow-update/health`
5. Testar `/api/script-update/clients`
6. Só então alterar UI das abas de atualização
