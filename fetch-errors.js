require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Extrai o nome do cliente do nome do workflow: "Workflow ( CLIENTE )" → "CLIENTE"
function extrairClienteDoWorkflow(nome) {
  const match = nome?.match(/\(\s*(.+?)\s*\)$/);
  return match ? match[1].trim() : null;
}

// ── ClickUp ───────────────────────────────────────────────────────────────────
async function postarRelatorioClickUp(report) {
  const token  = process.env.CLICKUP_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;
  if (!token || !listId) { console.warn('ClickUp não configurado — pulando.'); return null; }

  const data = new Date(report.gerado_em).toLocaleDateString('pt-BR');

  // Agrupa por servidor (hostname da n8n_url), deduplicando workflows pelo workflow_id
  const porServidor = {};
  for (const c of report.clientes) {
    if (!c.n8n_url) continue;
    let host;
    try { host = new URL(c.n8n_url).hostname; } catch { host = c.n8n_url; }
    if (!porServidor[host]) porServidor[host] = { totalErros: 0, workflows: {} };

    for (const r of (c.resumo || [])) {
      porServidor[host].totalErros += r.ocorrencias;
      // Mantém apenas 1 entrada por workflow_id (evita duplicatas de clientes no mesmo servidor)
      if (!porServidor[host].workflows[r.workflow_id]) {
        porServidor[host].workflows[r.workflow_id] = r;
      }
    }
  }

  // Ordena servidores por volume de erros
  const servidoresOrdenados = Object.entries(porServidor)
    .filter(([, s]) => s.totalErros > 0)
    .sort((a, b) => b[1].totalErros - a[1].totalErros);

  let descricao = `📊 Relatório automático — ${data}\n`;
  descricao += `Total: ${report.total_erros_geral} erros · ${report.clientes_com_erro} de ${report.total_clientes} clientes afetados\n`;
  descricao += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const [host, servidor] of servidoresOrdenados) {
    descricao += `🔴 Servidor: ${host} — ${servidor.totalErros} erro(s)\n\n`;

    // Subgrupa workflows pelo cliente extraído do nome do workflow
    const porCliente = {};
    for (const r of Object.values(servidor.workflows)) {
      const clienteNome = extrairClienteDoWorkflow(r.workflow_nome) || '(sem cliente identificado)';
      if (!porCliente[clienteNome]) porCliente[clienteNome] = [];
      porCliente[clienteNome].push(r);
    }

    // Ordena clientes por volume de erros
    const clientesOrdenados = Object.entries(porCliente)
      .sort((a, b) => {
        const tA = a[1].reduce((s, r) => s + r.ocorrencias, 0);
        const tB = b[1].reduce((s, r) => s + r.ocorrencias, 0);
        return tB - tA;
      });

    for (const [clienteNome, wfs] of clientesOrdenados) {
      descricao += `*${clienteNome}*\n\n`;

      for (const r of wfs.sort((a, b) => b.ocorrencias - a.ocorrencias)) {
        const wf   = r.workflow_nome || r.workflow_id;
        const node = r.node_falhou ? ` › ${r.node_falhou}` : '';
        const msg  = r.erro ? r.erro.slice(0, 100) : '(sem mensagem)';
        const link = r.exemplos?.[0] || null;

        descricao += `  • [${r.ocorrencias}x] ${wf}${node}\n`;
        descricao += `    Erro: ${msg}\n`;
        if (link) descricao += `    Link: ${link}\n`;
      }

      descricao += '\n--------\n\n';
    }
  }

  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: 'POST',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `🔴 Relatório de Erros n8n — ${data}`,
      description: descricao,
      status: 'BACKLOG',
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.err || JSON.stringify(json));
  console.log(`[ClickUp] Tarefa criada: ${json.url}`);
  return json.url;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function n8nRequest(baseUrl, apiKey, endpoint) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1${endpoint}`;
  const res = await fetch(url, {
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function analisarErrosCliente(cliente) {
  const baseUrl = cliente.n8n_url.replace(/\/$/, '');
  const limite24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Fase 1: busca metadados de execuções com erro
  const metadados = [];
  let cursor = null;

  while (true) {
    const params = new URLSearchParams({ status: 'error', limit: '100' });
    if (cursor) params.set('cursor', cursor);

    const res = await n8nRequest(cliente.n8n_url, cliente.api_key, `/executions?${params}`);
    const lote = res.data || res;
    if (!Array.isArray(lote) || !lote.length) break;

    let saiu = false;
    for (const e of lote) {
      if (new Date(e.startedAt) < limite24h) { saiu = true; break; }
      metadados.push({
        id: e.id,
        workflowId: e.workflowId,
        startedAt: e.startedAt,
        workflowName: e.workflowData?.name || null,
      });
    }
    if (saiu) break;

    cursor = res.nextCursor || null;
    if (!cursor || lote.length < 100) break;
  }

  if (!metadados.length) {
    return { cliente: cliente.nome, total_erros: 0, workflows_afetados: 0, resumo: [] };
  }

  // Agrupa por workflow — API retorna do mais recente para o mais antigo
  const porWorkflow = {};
  for (const e of metadados) {
    if (!porWorkflow[e.workflowId]) {
      porWorkflow[e.workflowId] = {
        ocorrencias: 0, ids: [], exemplo_id: e.id, nome: e.workflowName,
        ultimo_startedAt: e.startedAt,   // primeiro visto = mais recente
        primeiro_startedAt: e.startedAt, // vai sendo sobrescrito = mais antigo
      };
    }
    porWorkflow[e.workflowId].ocorrencias++;
    porWorkflow[e.workflowId].ids.push(e.id);
    porWorkflow[e.workflowId].primeiro_startedAt = e.startedAt; // sempre o mais antigo
  }

  // Fase 2: busca detalhes de 1 execução por workflow
  const resumo = [];
  for (const [wfId, grupo] of Object.entries(porWorkflow)) {
    try {
      const exec = await n8nRequest(cliente.n8n_url, cliente.api_key, `/executions/${grupo.exemplo_id}?includeData=true`);
      const runData = exec?.data?.resultData?.runData || {};
      const lastNode = exec?.data?.resultData?.lastNodeExecuted || null;

      let mensagemErro = null;
      if (lastNode && runData[lastNode]) {
        const entry = (runData[lastNode] || []).at(-1);
        mensagemErro = entry?.error?.message || entry?.error?.description || null;
      }

      let wfName = grupo.nome;
      if (!wfName) {
        try {
          const wf = await n8nRequest(cliente.n8n_url, cliente.api_key, `/workflows/${wfId}`);
          wfName = wf.name || wfId;
        } catch { wfName = wfId; }
      }

      resumo.push({
        workflow_id: wfId,
        workflow_nome: wfName,
        node_falhou: lastNode,
        erro: mensagemErro,
        ocorrencias: grupo.ocorrencias,
        primeiro_startedAt: grupo.primeiro_startedAt,
        ultimo_startedAt: grupo.ultimo_startedAt,
        exemplos: grupo.ids.slice(0, 3).map(id => `${baseUrl}/workflow/${wfId}/executions/${id}`),
      });
    } catch (e) {
      resumo.push({
        workflow_id: wfId,
        workflow_nome: grupo.nome || wfId,
        node_falhou: null,
        erro: `Erro ao inspecionar: ${e.message}`,
        ocorrencias: grupo.ocorrencias,
        primeiro_startedAt: grupo.primeiro_startedAt,
        ultimo_startedAt: grupo.ultimo_startedAt,
        exemplos: [],
      });
    }
  }

  resumo.sort((a, b) => b.ocorrencias - a.ocorrencias);

  return {
    cliente: cliente.nome,
    n8n_url: cliente.n8n_url,
    total_erros: metadados.length,
    workflows_afetados: resumo.length,
    resumo,
  };
}

// Executa N clientes em paralelo com limite de concorrência
async function pool(items, fn, concurrency = 5) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i])
        .then(v => ({ status: 'fulfilled', value: v }))
        .catch(e => ({ status: 'rejected', reason: e.message }));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Iniciando coleta de erros...`);

  const { data: clientes, error } = await supabase
    .from('mcp_clientes')
    .select('*')
    .or('churn.is.null,churn.eq.false');

  if (error) throw new Error(`Supabase: ${error.message}`);

  // Remove duplicatas por nome
  const seen = new Set();
  const clientesUnicos = clientes.filter(c => {
    if (seen.has(c.nome)) return false;
    seen.add(c.nome);
    return true;
  });

  console.log(`Analisando ${clientesUnicos.length} clientes...`);

  const resultados = await pool(clientesUnicos, analisarErrosCliente, 5);

  const clientesData = resultados.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      cliente: clientesUnicos[i].nome,
      n8n_url: clientesUnicos[i].n8n_url,
      erro_coleta: r.reason,
      total_erros: 0,
      workflows_afetados: 0,
      resumo: [],
    };
  });

  const report = {
    gerado_em: new Date().toISOString(),
    periodo: 'últimas 24h',
    total_clientes: clientesUnicos.length,
    clientes_com_erro: clientesData.filter(c => c.total_erros > 0).length,
    total_erros_geral: clientesData.reduce((acc, c) => acc + (c.total_erros || 0), 0),
    clientes: clientesData,
  };

  const outputPath = path.join(__dirname, 'report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`[${new Date().toISOString()}] Relatório salvo: ${report.total_erros_geral} erros em ${report.clientes_com_erro} clientes.`);

  // Posta no ClickUp automaticamente
  try {
    const url = await postarRelatorioClickUp(report);
    if (url) report.clickup_url = url;
    // Atualiza o report.json com a URL do ClickUp
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`[ClickUp] Falha ao postar: ${e.message}`);
  }
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
