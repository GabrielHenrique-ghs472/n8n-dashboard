require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const supabaseDatabase = createClient(
  process.env.DATABASE_URL,
  process.env.DATABASE_SERVICE_KEY
);

// Converte webhook URL → URL base do n8n
// Ex: https://webhook.n8nvps16sintese.com/... → https://n8n.n8nvps16sintese.com
function converterUrl(webhookUrl) {
  const url = new URL(webhookUrl);
  url.hostname = url.hostname.replace('webhook', 'n8n');
  return `${url.protocol}//${url.hostname}`;
}

async function sincronizarClientes() {
  console.log(`[${new Date().toISOString()}] Iniciando sincronização de clientes...`);

  // Busca todos os users do Banco 2 com n8n_webhook_url preenchida
  const { data: users, error: errUsers } = await supabaseDatabase
    .from('users')
    .select('username, n8n_webhook_url')
    .not('n8n_webhook_url', 'is', null);

  if (errUsers) throw new Error(`Banco 2: ${errUsers.message}`);

  // Busca clientes já existentes no mcp_clientes
  const { data: existentes, error: errExist } = await supabase
    .from('mcp_clientes')
    .select('nome, n8n_url, api_key');

  if (errExist) throw new Error(`mcp_clientes: ${errExist.message}`);

  const nomesExistentes = new Set(existentes.map(c => c.nome.toLowerCase()));

  // Mapeia servidor → api_key já conhecida
  const apiKeyPorServidor = {};
  for (const c of existentes) apiKeyPorServidor[c.n8n_url] = c.api_key;

  // Identifica clientes novos
  const novos = users.filter(u => !nomesExistentes.has(u.username.toLowerCase()));

  if (!novos.length) {
    const resultado = { mensagem: 'Nenhum cliente novo encontrado. Tudo sincronizado.', adicionados: 0, precisam_api_key: [] };
    console.log(resultado.mensagem);
    return resultado;
  }

  const adicionados = [];
  const precisamApiKey = [];

  for (const u of novos) {
    const n8nUrl = converterUrl(u.n8n_webhook_url);
    const apiKeyConhecida = apiKeyPorServidor[n8nUrl];

    if (apiKeyConhecida) {
      // Servidor já existe — insere automaticamente
      const { error } = await supabase.from('mcp_clientes').insert({
        nome: u.username,
        n8n_url: n8nUrl,
        api_key: apiKeyConhecida,
        AutoSintese: true,
        churn: false,
      });
      if (error) {
        precisamApiKey.push({ username: u.username, n8n_url: n8nUrl, erro: error.message });
      } else {
        adicionados.push({ username: u.username, n8n_url: n8nUrl });
      }
    } else {
      // Servidor novo — api_key desconhecida
      precisamApiKey.push({ username: u.username, n8n_url: n8nUrl });
    }
  }

  const resultado = {
    adicionados,
    adicionados_total: adicionados.length,
    precisam_api_key: precisamApiKey,
  };

  console.log(`[${new Date().toISOString()}] Sync concluído: ${adicionados.length} adicionados, ${precisamApiKey.length} precisam de api_key manual.`);
  return resultado;
}

// Execução direta
if (require.main === module) {
  sincronizarClientes()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error('Erro fatal:', err); process.exit(1); });
}

module.exports = { sincronizarClientes };
