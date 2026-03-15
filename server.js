require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sincronizarClientes } = require('./sync-clients');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3456;
const REPORT_FILE = path.join(__dirname, 'report.json');
const HTML_FILE = path.join(__dirname, 'index.html');

let refreshing = false;
let syncing = false;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);

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
    supabase
      .from('mcp_clientes')
      .select('id, nome, n8n_url, AutoSintese, ativo, servidor_proprio, churn, created_at')
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

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`n8n Error Dashboard rodando em http://localhost:${PORT}`);
});
