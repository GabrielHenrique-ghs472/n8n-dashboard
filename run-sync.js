require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sincronizarClientes } = require('./sync-clients');

async function postarSyncClickUp(resultado) {
  const token  = process.env.CLICKUP_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;
  if (!token || !listId) { console.warn('ClickUp não configurado — pulando.'); return null; }

  const data = new Date().toLocaleDateString('pt-BR');
  let descricao = `🔄 Sincronização automática de clientes — ${data}\n\n`;

  if (resultado.mensagem) {
    descricao += `✅ ${resultado.mensagem}\n`;
  } else {
    if (resultado.adicionados?.length) {
      descricao += `✅ ${resultado.adicionados.length} cliente(s) adicionado(s):\n`;
      for (const a of resultado.adicionados) {
        descricao += `  • ${a.username} — ${a.n8n_url}\n`;
      }
      descricao += '\n';
    }
    if (resultado.precisam_api_key?.length) {
      descricao += `⚠️ ${resultado.precisam_api_key.length} cliente(s) em servidor novo (precisam de api_key manual):\n`;
      for (const p of resultado.precisam_api_key) {
        descricao += `  • ${p.username} — ${p.n8n_url}`;
        if (p.erro) descricao += ` (${p.erro})`;
        descricao += '\n';
      }
    }
  }

  const temNovos = resultado.adicionados?.length > 0;
  const temPendentes = resultado.precisam_api_key?.length > 0;
  const taskName = temNovos || temPendentes
    ? `🆕 Sync n8n — ${resultado.adicionados?.length || 0} novo(s) · ${resultado.precisam_api_key?.length || 0} pendente(s) — ${data}`
    : `✅ Sync n8n — Tudo sincronizado — ${data}`;

  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: 'POST',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: taskName, description: descricao, status: 'BACKLOG' }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.err || JSON.stringify(json));
  console.log(`[ClickUp] Tarefa criada: ${json.url}`);
  return json.url;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Iniciando sync agendado...`);
  const resultado = await sincronizarClientes();

  // Salva resultado para o dashboard consultar
  fs.writeFileSync(
    path.join(__dirname, 'sync-result.json'),
    JSON.stringify({ ...resultado, gerado_em: new Date().toISOString() }, null, 2)
  );

  try {
    await postarSyncClickUp(resultado);
  } catch (e) {
    console.error(`[ClickUp] Falha ao postar: ${e.message}`);
  }
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
