require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const hasPrimarySupabase =
  !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY;
const hasDatabaseSupabase =
  !!(process.env.DATABASE_URL || process.env.SUPABASE_URL) &&
  !!(process.env.DATABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY);

const supabase = hasPrimarySupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const supabaseDatabase = hasDatabaseSupabase
  ? createClient(
      process.env.DATABASE_URL || process.env.SUPABASE_URL,
      process.env.DATABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY
    )
  : null;

const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3456;
const REPORT_FILE = path.join(__dirname, 'report.json');
const HTML_FILE = path.join(__dirname, 'index.html');
const DUPLICACAO_WEBHOOK_URL = 'https://webhooksintese.gruposintesedigital.com/webhook/dados-duplicacao';
const WORKFLOW_UPDATE_DIR = path.join(__dirname, 'workflow-update');
const WORKFLOW_UPDATE_INTERNAL_PORT = Number(process.env.WORKFLOW_UPDATE_INTERNAL_PORT || 4399);
const WORKFLOW_UPDATE_PUBLIC_PATH = '/workflow-update/';

let refreshing = false;
let syncing = false;
let workflowUpdateProcess = null;
const scriptUpdateSaveLocks = new Map();

function ensureConfigured(res, client, missingKeys) {
  if (client) return true;
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: `Configuração ausente no ambiente: ${missingKeys.join(', ')}`,
  }));
  return false;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload muito grande'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 20_000_000) {
        reject(new Error('Payload muito grande'));
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function normalizeN8nBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withProto);
    return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function normalizeTextLoose(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseScriptUpdatePath(pathname) {
  const listMatch = pathname.match(/^\/api\/script-update\/clients\/([^/]+)\/workflows$/);
  if (listMatch) return { type: 'workflows', clientId: decodeURIComponent(listMatch[1]) };

  const typesMatch = pathname.match(/^\/api\/script-update\/clients\/([^/]+)\/workflows\/([^/]+)\/script-types$/);
  if (typesMatch) {
    return {
      type: 'script-types',
      clientId: decodeURIComponent(typesMatch[1]),
      workflowId: decodeURIComponent(typesMatch[2]),
    };
  }

  const scriptsMatch = pathname.match(/^\/api\/script-update\/clients\/([^/]+)\/workflows\/([^/]+)\/scripts$/);
  if (scriptsMatch) {
    return {
      type: 'scripts',
      clientId: decodeURIComponent(scriptsMatch[1]),
      workflowId: decodeURIComponent(scriptsMatch[2]),
    };
  }

  const reviewMatch = pathname.match(/^\/api\/script-update\/clients\/([^/]+)\/workflows\/([^/]+)\/review$/);
  if (reviewMatch) {
    return {
      type: 'review',
      clientId: decodeURIComponent(reviewMatch[1]),
      workflowId: decodeURIComponent(reviewMatch[2]),
    };
  }

  const saveMatch = pathname.match(/^\/api\/script-update\/clients\/([^/]+)\/workflows\/([^/]+)\/save$/);
  if (saveMatch) {
    return {
      type: 'save',
      clientId: decodeURIComponent(saveMatch[1]),
      workflowId: decodeURIComponent(saveMatch[2]),
    };
  }

  return null;
}

function buildScriptUpdateHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': apiKey,
  };
}

async function n8nFetchJson(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = json?.message ? `: ${json.message}` : '';
      throw new Error(`Falha n8n (HTTP ${response.status})${details}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function isDadosNodeName(name) {
  return /^dados\d*$/i.test(String(name || '').trim());
}

function isScriptAssignmentName(name) {
  return /script/i.test(String(name || ''));
}

function getSetAssignments(node) {
  const assignments = node?.parameters?.assignments?.assignments;
  if (Array.isArray(assignments)) {
    return assignments
      .map((a, index) => ({
        mode: 'assignments',
        index,
        name: a?.name,
        type: a?.type,
        value: a?.value,
      }))
      .filter(a => a.type === 'string' && typeof a.name === 'string');
  }

  const stringValues = node?.parameters?.values?.string;
  if (Array.isArray(stringValues)) {
    return stringValues
      .map((a, index) => ({
        mode: 'values.string',
        index,
        name: a?.name,
        type: 'string',
        value: a?.value,
      }))
      .filter(a => typeof a.name === 'string');
  }
  return [];
}

function isEligibleScriptNode(node) {
  return String(node?.type || '') === 'n8n-nodes-base.set'
    && isDadosNodeName(node?.name)
    && getSetAssignments(node).some(a => isScriptAssignmentName(a.name));
}

function discoverWorkflowScriptTypes(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const counter = new Map();
  for (const node of nodes) {
    if (!isEligibleScriptNode(node)) continue;
    for (const assignment of getSetAssignments(node)) {
      if (!isScriptAssignmentName(assignment.name)) continue;
      counter.set(assignment.name, (counter.get(assignment.name) || 0) + 1);
    }
  }
  return [...counter.entries()]
    .map(([name, occurrences]) => ({ name, occurrences }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

function collectWorkflowScriptItems(workflow, selectedScriptName) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const items = [];
  for (const node of nodes) {
    if (!isEligibleScriptNode(node)) continue;
    for (const assignment of getSetAssignments(node)) {
      if (String(assignment.name) !== String(selectedScriptName)) continue;
      items.push({
        itemId: `${node.id}::${assignment.name}::${assignment.mode}::${assignment.index}`,
        nodeId: node.id,
        nodeName: node.name,
        assignmentName: assignment.name,
        originalValue: String(assignment.value ?? ''),
        locator: { mode: assignment.mode, index: assignment.index },
      });
    }
  }

  return items.sort((a, b) => String(a.nodeName).localeCompare(String(b.nodeName), 'pt-BR'));
}

function applyScriptEditsToWorkflow(workflow, selectedScriptName, edits) {
  const editableItems = collectWorkflowScriptItems(workflow, selectedScriptName);
  const byItemId = new Map(editableItems.map(item => [item.itemId, item]));
  const workflowPatched = structuredClone(workflow);
  const nodes = Array.isArray(workflowPatched?.nodes) ? workflowPatched.nodes : [];
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const changedItems = [];

  for (const edit of Array.isArray(edits) ? edits : []) {
    const source = byItemId.get(edit?.itemId);
    if (!source) continue;
    const nextValue = String(edit?.editedValue ?? '');
    if (nextValue === String(source.originalValue ?? '')) continue;
    const node = nodeById.get(source.nodeId);
    if (!node) continue;

    let target = null;
    if (source.locator.mode === 'assignments') {
      target = node?.parameters?.assignments?.assignments?.[source.locator.index];
    } else if (source.locator.mode === 'values.string') {
      target = node?.parameters?.values?.string?.[source.locator.index];
    }
    if (!target) continue;
    target.value = nextValue;
    changedItems.push({
      itemId: source.itemId,
      nodeId: source.nodeId,
      nodeName: source.nodeName,
      assignmentName: source.assignmentName,
      before: source.originalValue,
      after: nextValue,
    });
  }

  return { workflowPatched, changedItems };
}

function cleanWorkflowForN8nUpdate(workflow) {
  const clean = {
    name: workflow?.name,
    nodes: workflow?.nodes,
    connections: workflow?.connections,
    settings: workflow?.settings ?? {},
  };
  if (workflow?.staticData !== undefined) clean.staticData = workflow.staticData;
  return clean;
}

function filterWorkflowsByClientTag(workflows, clientName) {
  const normalizedClient = normalizeTextLoose(clientName);
  return workflows.filter(workflow => {
    const name = String(workflow?.name || '');
    const match = name.match(/\(\s*([^)]+?)\s*\)/);
    if (!match) return false;
    if (!normalizedClient) return true;
    return normalizeTextLoose(match[1]).includes(normalizedClient);
  });
}

function safeBackupName(value) {
  return String(value || 'sem-nome')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function saveScriptUpdateBackup({ client, workflow, selectedScriptName, changedItems, workflowOriginal, workflowPatched, status, errorMessage = '' }) {
  const baseDir = path.join(__dirname, 'backups', 'script-update');
  const folder = path.join(baseDir, `${nowStamp()}_${safeBackupName(client.nome)}_${safeBackupName(workflow.name)}`);
  await fs.promises.mkdir(folder, { recursive: true });

  const originalRaw = JSON.stringify(workflowOriginal, null, 2);
  const patchedRaw = JSON.stringify(workflowPatched, null, 2);
  const metadata = {
    createdAt: new Date().toISOString(),
    status,
    errorMessage,
    selectedScriptName,
    client: { id: client.id, nome: client.nome, n8nUrl: client.n8nUrl },
    workflow: { id: workflow.id, name: workflow.name },
    changedItems: (changedItems || []).map(item => ({
      itemId: item.itemId,
      nodeName: item.nodeName,
      assignmentName: item.assignmentName,
      beforeHash: crypto.createHash('sha256').update(String(item.before ?? '')).digest('hex'),
      afterHash: crypto.createHash('sha256').update(String(item.after ?? '')).digest('hex'),
    })),
  };

  await fs.promises.writeFile(path.join(folder, 'workflow-original.json'), originalRaw, 'utf8');
  await fs.promises.writeFile(path.join(folder, 'workflow-patched.json'), patchedRaw, 'utf8');
  await fs.promises.writeFile(path.join(folder, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  return { folder };
}

function startWorkflowUpdateModule() {
  if (workflowUpdateProcess) return;

  const childEnv = {
    ...process.env,
    PORT: String(WORKFLOW_UPDATE_INTERNAL_PORT),
    SUPABASE_KEY: process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
  };

  workflowUpdateProcess = spawn('node', ['src/server/index.js'], {
    cwd: WORKFLOW_UPDATE_DIR,
    env: childEnv,
    stdio: 'inherit',
  });

  workflowUpdateProcess.on('close', code => {
    console.log(`[${new Date().toISOString()}] workflow-update encerrado (código ${code})`);
    workflowUpdateProcess = null;
  });
}

async function proxyWorkflowUpdate(req, res, url) {
  startWorkflowUpdateModule();

  const isApi = url.pathname.startsWith('/api/workflow-update');
  const rewrittenPath = isApi
    ? `/api${url.pathname.slice('/api/workflow-update'.length)}${url.search}`
    : `${url.pathname.slice('/workflow-update'.length) || '/'}${url.search}`;

  const targetUrl = `http://127.0.0.1:${WORKFLOW_UPDATE_INTERNAL_PORT}${rewrittenPath}`;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];

  const body =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : await readRawBody(req);

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  });

  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return;
    responseHeaders[key] = value;
  });

  res.writeHead(upstream.status, responseHeaders);
  res.end(upstreamBody);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // URL local do módulo interno de atualização de workflows
  if (req.method === 'GET' && url.pathname === '/api/workflow-update-url') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ url: WORKFLOW_UPDATE_PUBLIC_PATH }));
  }

  // Proxy interno do módulo de atualização de workflows (mesmo projeto/mesmo domínio)
  if (url.pathname.startsWith('/workflow-update') || url.pathname.startsWith('/api/workflow-update')) {
    proxyWorkflowUpdate(req, res, url)
      .catch(err => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Falha no módulo de atualização: ${err.message}` }));
      });
    return;
  }

  // Serve o dashboard
  if (req.method === 'GET' && url.pathname === '/') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html não encontrado'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Retorna o relatório JSON
  if (req.method === 'GET' && url.pathname === '/api/report') {
    if (!fs.existsSync(REPORT_FILE)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'Relatório ainda não gerado. Clique em "Atualizar agora" para gerar o primeiro.'
      }));
    }
    const data = fs.readFileSync(REPORT_FILE);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(data);
  }

  // Dispara atualização manual
  if (req.method === 'POST' && url.pathname === '/api/refresh') {
    if (refreshing) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'running', message: 'Atualização já em andamento...' }));
    }

    refreshing = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started' }));

    const child = spawn('node', [path.join(__dirname, 'fetch-errors.js')], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', code => {
      refreshing = false;
      console.log(`[${new Date().toISOString()}] fetch-errors.js finalizado (código ${code})`);
    });
    return;
  }

  // Status da atualização
  if (req.method === 'GET' && url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ refreshing, syncing }));
  }

  // Sincronizar clientes
  if (req.method === 'POST' && url.pathname === '/api/sync') {
    if (syncing) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'running', message: 'Sincronização já em andamento...' }));
    }

    syncing = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started' }));

    const child = spawn('node', [path.join(__dirname, 'run-sync.js')], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', code => {
      syncing = false;
      console.log(`[${new Date().toISOString()}] run-sync.js finalizado (código ${code})`);
    });
    return;
  }

  // Resultado da última sincronização
  if (req.method === 'GET' && url.pathname === '/api/sync-result') {
    const syncFile = path.join(__dirname, 'sync-result.json');
    if (!fs.existsSync(syncFile)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Nenhuma sincronização executada ainda.' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(fs.readFileSync(syncFile));
  }

  // Lista todos os clientes do banco
  if (req.method === 'GET' && url.pathname === '/api/clients') {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    supabase
      .from('mcp_clientes')
      .select('id, nome, n8n_url, api_key, AutoSintese, servidor_proprio, churn, created_at')
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: error.message }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
      });
    return;
  }

  // ── Atualização de scripts (módulo nativo) ────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/script-update/clients') {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    supabase
      .from('mcp_clientes')
      .select('id, nome, n8n_url, api_key, churn')
      .or('churn.is.null,churn.eq.false')
      .order('nome', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: error.message }));
        }
        const clients = (data || [])
          .map(row => ({
            id: row.id,
            nome: String(row.nome || '').trim(),
            n8n_url: row.n8n_url || '',
            hasApiKey: !!row.api_key,
          }))
          .filter(row => row.id && row.nome && row.n8n_url && row.hasApiKey);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ clients }));
      });
    return;
  }

  const scriptPath = parseScriptUpdatePath(url.pathname);
  if (scriptPath && req.method === 'GET' && scriptPath.type === 'workflows') {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    (async () => {
      const { data: row, error } = await supabase
        .from('mcp_clientes')
        .select('id, nome, n8n_url, api_key')
        .eq('id', scriptPath.clientId)
        .single();
      if (error || !row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Cliente não encontrado.' }));
      }

      const baseUrl = normalizeN8nBaseUrl(row.n8n_url);
      const apiKey = String(row.api_key || '').trim();
      if (!baseUrl || !apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Cliente sem n8n_url/api_key válido.' }));
      }

      const normalizedClientName = normalizeTextLoose(row.nome);
      if (normalizedClientName === 'base sintese') {
        const pinnedWorkflow = {
          id: 'gJk9yqd6sdMP7HiC',
          name: 'Gerador de resposta comercial // CRM NOVO // Garagem',
          active: true,
          updatedAt: null,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          client: { id: row.id, nome: row.nome },
          workflows: [pinnedWorkflow],
          allWorkflowsCount: 1,
        }));
      }

      const json = await n8nFetchJson(`${baseUrl}/api/v1/workflows?limit=250`, {
        method: 'GET',
        headers: buildScriptUpdateHeaders(apiKey),
      });
      const all = Array.isArray(json?.data) ? json.data : [];
      const mapped = all.map(w => ({
        id: String(w?.id || ''),
        name: String(w?.name || '').trim(),
        active: !!w?.active,
        updatedAt: w?.updatedAt || null,
      })).filter(w => w.id && w.name);
      const compatible = filterWorkflowsByClientTag(mapped, row.nome);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        client: { id: row.id, nome: row.nome },
        workflows: compatible,
        allWorkflowsCount: mapped.length,
      }));
    })().catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (scriptPath && req.method === 'GET' && scriptPath.type === 'script-types') {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    (async () => {
      const { data: row, error } = await supabase
        .from('mcp_clientes')
        .select('id, nome, n8n_url, api_key')
        .eq('id', scriptPath.clientId)
        .single();
      if (error || !row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Cliente não encontrado.' }));
      }

      const baseUrl = normalizeN8nBaseUrl(row.n8n_url);
      const apiKey = String(row.api_key || '').trim();
      const workflow = await n8nFetchJson(
        `${baseUrl}/api/v1/workflows/${encodeURIComponent(scriptPath.workflowId)}`,
        { method: 'GET', headers: buildScriptUpdateHeaders(apiKey) }
      );
      const workflowData = workflow?.data || workflow;
      const scriptTypes = discoverWorkflowScriptTypes(workflowData);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        client: { id: row.id, nome: row.nome },
        workflow: { id: workflowData?.id, name: workflowData?.name },
        scriptTypes,
      }));
    })().catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (scriptPath && req.method === 'GET' && scriptPath.type === 'scripts') {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    (async () => {
      const scriptName = String(url.searchParams.get('scriptName') || '').trim();
      if (!scriptName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'scriptName é obrigatório.' }));
      }

      const { data: row, error } = await supabase
        .from('mcp_clientes')
        .select('id, nome, n8n_url, api_key')
        .eq('id', scriptPath.clientId)
        .single();
      if (error || !row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Cliente não encontrado.' }));
      }

      const baseUrl = normalizeN8nBaseUrl(row.n8n_url);
      const apiKey = String(row.api_key || '').trim();
      const workflow = await n8nFetchJson(
        `${baseUrl}/api/v1/workflows/${encodeURIComponent(scriptPath.workflowId)}`,
        { method: 'GET', headers: buildScriptUpdateHeaders(apiKey) }
      );
      const workflowData = workflow?.data || workflow;
      const items = collectWorkflowScriptItems(workflowData, scriptName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        client: { id: row.id, nome: row.nome },
        workflow: { id: workflowData?.id, name: workflowData?.name },
        selectedScriptName: scriptName,
        items,
      }));
    })().catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (scriptPath && req.method === 'POST' && scriptPath.type === 'review') {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    readJsonBody(req).then(async body => {
      const selectedScriptName = String(body?.selectedScriptName || '').trim();
      const edits = Array.isArray(body?.edits) ? body.edits : [];
      if (!selectedScriptName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'selectedScriptName é obrigatório.' }));
      }

      const { data: row, error } = await supabase
        .from('mcp_clientes')
        .select('id, nome, n8n_url, api_key')
        .eq('id', scriptPath.clientId)
        .single();
      if (error || !row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Cliente não encontrado.' }));
      }

      const baseUrl = normalizeN8nBaseUrl(row.n8n_url);
      const apiKey = String(row.api_key || '').trim();
      const workflow = await n8nFetchJson(
        `${baseUrl}/api/v1/workflows/${encodeURIComponent(scriptPath.workflowId)}`,
        { method: 'GET', headers: buildScriptUpdateHeaders(apiKey) }
      );
      const workflowData = workflow?.data || workflow;
      const { changedItems } = applyScriptEditsToWorkflow(workflowData, selectedScriptName, edits);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        changedCount: changedItems.length,
        changes: changedItems.map(item => ({
          itemId: item.itemId,
          nodeName: item.nodeName,
          assignmentName: item.assignmentName,
          before: item.before,
          after: item.after,
        })),
      }));
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (scriptPath && req.method === 'POST' && scriptPath.type === 'save') {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    const lockKey = `${scriptPath.clientId}:${scriptPath.workflowId}`;
    if (scriptUpdateSaveLocks.has(lockKey)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Já existe um save em andamento para este cliente/workflow.' }));
    }

    scriptUpdateSaveLocks.set(lockKey, true);
    readJsonBody(req).then(async body => {
      const selectedScriptName = String(body?.selectedScriptName || '').trim();
      const edits = Array.isArray(body?.edits) ? body.edits : [];
      if (!selectedScriptName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'selectedScriptName é obrigatório.' }));
      }

      const { data: row, error } = await supabase
        .from('mcp_clientes')
        .select('id, nome, n8n_url, api_key')
        .eq('id', scriptPath.clientId)
        .single();
      if (error || !row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Cliente não encontrado.' }));
      }

      const client = {
        id: row.id,
        nome: row.nome,
        n8nUrl: row.n8n_url,
        apiKey: String(row.api_key || '').trim(),
      };
      const baseUrl = normalizeN8nBaseUrl(client.n8nUrl);
      const workflow = await n8nFetchJson(
        `${baseUrl}/api/v1/workflows/${encodeURIComponent(scriptPath.workflowId)}`,
        { method: 'GET', headers: buildScriptUpdateHeaders(client.apiKey) }
      );
      const workflowData = workflow?.data || workflow;
      const { workflowPatched, changedItems } = applyScriptEditsToWorkflow(workflowData, selectedScriptName, edits);
      if (!changedItems.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Nenhuma alteração para salvar.' }));
      }

      const backup = await saveScriptUpdateBackup({
        client,
        workflow: { id: workflowData.id, name: workflowData.name },
        selectedScriptName,
        changedItems,
        workflowOriginal: workflowData,
        workflowPatched,
        status: 'pending',
      });

      try {
        await n8nFetchJson(
          `${baseUrl}/api/v1/workflows/${encodeURIComponent(scriptPath.workflowId)}`,
          {
            method: 'PUT',
            headers: buildScriptUpdateHeaders(client.apiKey),
            body: JSON.stringify(cleanWorkflowForN8nUpdate(workflowPatched)),
          }
        );

        await saveScriptUpdateBackup({
          client,
          workflow: { id: workflowData.id, name: workflowData.name },
          selectedScriptName,
          changedItems,
          workflowOriginal: workflowData,
          workflowPatched,
          status: 'success',
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          changedCount: changedItems.length,
          backupFolder: backup.folder,
          changes: changedItems,
        }));
      } catch (errorSave) {
        await saveScriptUpdateBackup({
          client,
          workflow: { id: workflowData.id, name: workflowData.name },
          selectedScriptName,
          changedItems,
          workflowOriginal: workflowData,
          workflowPatched,
          status: 'error',
          errorMessage: errorSave.message,
        });
        throw errorSave;
      }
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }).finally(() => {
      scriptUpdateSaveLocks.delete(lockKey);
    });
    return;
  }

  // Lista owners do projeto Database (users.role = owner)
  if (req.method === 'GET' && url.pathname === '/api/owner-users') {
    if (!ensureConfigured(res, supabaseDatabase, ['DATABASE_URL', 'DATABASE_SERVICE_KEY'])) return;
    const search = (url.searchParams.get('q') || '').trim().toLowerCase();
    (async () => {
      const { data, error } = await supabaseDatabase
        .from('users')
        .select('id, username, niche')
        .eq('role', 'owner')
        .not('username', 'is', null)
        .order('username', { ascending: true });

      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: error.message }));
      }

      let owners = (data || [])
        .map(row => ({
          id: row?.id ?? null,
          username: String(row?.username || '').trim(),
          niche: row?.niche ?? null,
        }))
        .filter(row => row.username);

      if (search) {
        owners = owners.filter(row => row.username.toLowerCase().includes(search));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(owners));
    })().catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Lista workflows de um servidor específico (URL + API key)
  if (req.method === 'POST' && url.pathname === '/api/server-workflows/list') {
    readJsonBody(req)
      .then(async body => {
        const baseUrl = normalizeN8nBaseUrl(body?.n8nUrl);
        const apiKey = String(body?.n8nApiKey || '').trim();
        if (!baseUrl || !apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Campos obrigatórios: n8nUrl, n8nApiKey.' }));
        }

        const upstream = await fetch(`${baseUrl}/api/v1/workflows?limit=250`, {
          headers: { 'X-N8N-API-KEY': apiKey },
        });
        const payload = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `Falha ao listar workflows (HTTP ${upstream.status}).` }));
        }

        const workflows = Array.isArray(payload?.data) ? payload.data : [];
        const normalized = workflows
          .map(w => ({
            id: String(w?.id || ''),
            name: String(w?.name || '').trim() || `(sem nome ${String(w?.id || '')})`,
            active: !!w?.active,
            updatedAt: w?.updatedAt || null,
          }))
          .filter(w => w.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ workflows: normalized }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // Exclui workflows de um servidor específico (URL + API key)
  if (req.method === 'POST' && url.pathname === '/api/server-workflows/delete') {
    readJsonBody(req)
      .then(async body => {
        const baseUrl = normalizeN8nBaseUrl(body?.n8nUrl);
        const apiKey = String(body?.n8nApiKey || '').trim();
        const workflowIds = Array.isArray(body?.workflowIds) ? body.workflowIds.map(v => String(v || '').trim()).filter(Boolean) : [];
        if (!baseUrl || !apiKey || !workflowIds.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Campos obrigatórios: n8nUrl, n8nApiKey, workflowIds[]' }));
        }

        const deleted = [];
        const failed = [];

        for (const workflowId of workflowIds) {
          try {
            const upstream = await fetch(`${baseUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
              method: 'DELETE',
              headers: { 'X-N8N-API-KEY': apiKey },
            });
            if (!upstream.ok) {
              const text = await upstream.text().catch(() => '');
              failed.push({ id: workflowId, error: `HTTP ${upstream.status}${text ? `: ${text}` : ''}` });
              continue;
            }
            deleted.push(workflowId);
          } catch (e) {
            failed.push({ id: workflowId, error: e.message });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deleted, failed }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // Envia payload de duplicação para o webhook n8n
  if (req.method === 'POST' && url.pathname === '/api/duplicacao') {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    readJsonBody(req)
      .then(async body => {
        const payload = {
          username: body?.username ?? null,
          user_id: body?.user_id ?? null,
          niche: body?.niche ?? null,
          n8nUrl: body?.n8nUrl ?? null,
          n8nApiKey: body?.n8nApiKey ?? null,
          n8nSuffix: body?.n8nSuffix ?? null,
          openaiApiKey: body?.openaiApiKey ?? null,
          duplicate: !!body?.duplicate,
          credential_user_id: body?.credential_user_id ?? null,
          credential_username: body?.credential_username ?? null,
        };

        if (!payload.username || !payload.n8nApiKey || !payload.n8nSuffix || !payload.openaiApiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Campos obrigatórios: username, n8nApiKey, n8nSuffix, openaiApiKey.' }));
        }

        const webhookRes = await fetch(DUPLICACAO_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const responseText = await webhookRes.text();
        if (!webhookRes.ok) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: `Falha no webhook (${webhookRes.status})`,
            details: responseText,
          }));
        }

        // Persiste no mcp_clientes após sucesso no webhook
        let dbAction = 'none';
        if (payload.username && payload.n8nUrl && payload.n8nApiKey) {
          const { data: existing, error: findError } = await supabase
            .from('mcp_clientes')
            .select('id')
            .eq('nome', payload.username)
            .limit(1);

          if (findError) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `Falha ao consultar mcp_clientes: ${findError.message}` }));
          }

          if (Array.isArray(existing) && existing.length > 0) {
            const { error: updateError } = await supabase
              .from('mcp_clientes')
              .update({
                n8n_url: payload.n8nUrl,
                api_key: payload.n8nApiKey,
              })
              .eq('id', existing[0].id);

            if (updateError) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: `Falha ao atualizar mcp_clientes: ${updateError.message}` }));
            }
            dbAction = 'updated';
          } else {
            const { error: insertError } = await supabase
              .from('mcp_clientes')
              .insert({
                nome: payload.username,
                n8n_url: payload.n8nUrl,
                api_key: payload.n8nApiKey,
                AutoSintese: true,
                churn: false,
                servidor_proprio: false,
              });

            if (insertError) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: `Falha ao inserir em mcp_clientes: ${insertError.message}` }));
            }
            dbAction = 'inserted';
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'sent',
          webhookStatus: webhookRes.status,
          dbAction,
          payload,
          webhookResponse: responseText,
        }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // Atualiza flags de manutenção do cliente
  if (req.method === 'PATCH' && /^\/api\/clients\/[^/]+$/.test(url.pathname)) {
    if (!ensureConfigured(res, supabase, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])) return;
    const clientId = decodeURIComponent(url.pathname.split('/').pop());
    readJsonBody(req)
      .then(async body => {
        const updates = {};
        if (Object.prototype.hasOwnProperty.call(body, 'AutoSintese')) updates.AutoSintese = !!body.AutoSintese;
        if (Object.prototype.hasOwnProperty.call(body, 'servidor_proprio')) updates.servidor_proprio = !!body.servidor_proprio;
        if (Object.prototype.hasOwnProperty.call(body, 'churn')) updates.churn = !!body.churn;

        if (!Object.keys(updates).length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Nenhum campo válido para atualizar.' }));
        }

        const { data, error } = await supabase
          .from('mcp_clientes')
          .update(updates)
          .eq('id', clientId)
          .select('id, nome, n8n_url, api_key, AutoSintese, servidor_proprio, churn, created_at')
          .single();

        if (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: error.message }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Infraestrutura - Grupo Sintese rodando em http://localhost:${PORT}`);
  startWorkflowUpdateModule();
});

process.on('SIGTERM', () => {
  if (workflowUpdateProcess) workflowUpdateProcess.kill('SIGTERM');
  process.exit(0);
});
