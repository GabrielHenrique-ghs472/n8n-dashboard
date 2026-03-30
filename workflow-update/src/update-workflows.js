import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_KEY", "WORKFLOW_FILE"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Variavel obrigatoria ausente: ${key}`);
  }
}

const cfg = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  table: process.env.SUPABASE_TABLE || "mcp_clientes",
  idColumn: process.env.CLIENT_ID_COLUMN || "id",
  urlColumn: process.env.N8N_URL_COLUMN || "n8n_url",
  workflowIdColumn: process.env.N8N_WORKFLOW_ID_COLUMN || "workflow_id",
  workflowIdDefault: process.env.N8N_WORKFLOW_ID_DEFAULT || "",
  workflowName: process.env.N8N_WORKFLOW_NAME || "",
  workflowNamePrefix: process.env.N8N_WORKFLOW_NAME_PREFIX || "",
  clientNameColumn: process.env.CLIENT_NAME_COLUMN || "nome",
  tokenColumn: process.env.N8N_TOKEN_COLUMN || "apikey",
  activeColumn: process.env.CLIENT_ACTIVE_COLUMN || "",
  activeValue: process.env.CLIENT_ACTIVE_VALUE || "true",
  scriptsVarColumn: process.env.CLIENT_SCRIPTS_VARIADOS_COLUMN || "scripts_variados",
  scriptsVarValue: process.env.CLIENT_SCRIPTS_VARIADOS_VALUE || "true",
  selectColumns: process.env.SUPABASE_SELECT_COLUMNS || "*",
  workflowFile: process.env.WORKFLOW_FILE,
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
  dryRun: String(process.env.DRY_RUN || "false").toLowerCase() === "true",
};

const supabase = createClient(cfg.supabaseUrl, cfg.supabaseKey);

async function loadWorkflowTemplate(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function get(row, columnName) {
  return row?.[columnName];
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function getClientes() {
  let query = supabase.from(cfg.table).select(cfg.selectColumns);

  if (cfg.activeColumn) {
    const value = parseFilterValue(cfg.activeValue);
    query = query.eq(cfg.activeColumn, value);
  }

  if (cfg.scriptsVarColumn) {
    const value = parseFilterValue(cfg.scriptsVarValue);
    query = query.eq(cfg.scriptsVarColumn, value);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

function parseFilterValue(value) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (normalized === "null") return null;
  if (!Number.isNaN(Number(normalized)) && normalized !== "") return Number(normalized);
  return value;
}

async function atualizarWorkflowCliente(cliente, workflowTemplate) {
  const clientId = get(cliente, cfg.idColumn);
  const n8nUrl = get(cliente, cfg.urlColumn);
  const workflowIdFromRow = get(cliente, cfg.workflowIdColumn);
  const apiKey = get(cliente, cfg.tokenColumn);
  const clientName = get(cliente, cfg.clientNameColumn);

  if (!n8nUrl || !apiKey) {
    throw new Error(
      `Cliente ${clientId ?? "(sem id)"} sem campos obrigatorios (${cfg.urlColumn}, ${cfg.tokenColumn})`
    );
  }

  const baseUrl = String(n8nUrl).replace(/\/+$/, "");
  const workflowId =
    workflowIdFromRow ||
    cfg.workflowIdDefault ||
    (await findWorkflowIdByName({
      baseUrl,
      apiKey,
      clientId,
      clientName,
      fallbackName: cfg.workflowName || workflowTemplate?.name,
      namePrefix: cfg.workflowNamePrefix,
    }));

  if (!workflowId) {
    throw new Error(
      `Cliente ${clientId ?? "(sem id)"} sem workflow alvo. Preencha ${cfg.workflowIdColumn}, N8N_WORKFLOW_ID_DEFAULT, N8N_WORKFLOW_NAME ou N8N_WORKFLOW_NAME_PREFIX.`
    );
  }

  const endpoint = `${baseUrl}/api/v1/workflows/${workflowId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);

  try {
    if (cfg.dryRun) {
      return {
        clientId,
        status: "dry-run",
        endpoint,
      };
    }

    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-API-KEY": apiKey,
      },
      body: JSON.stringify(workflowTemplate),
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Falha HTTP ${response.status} para cliente ${clientId ?? "(sem id)"}: ${responseText}`
      );
    }

    return {
      clientId,
      status: "ok",
      endpoint,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function findWorkflowIdByName({
  baseUrl,
  apiKey,
  clientId,
  clientName,
  fallbackName,
  namePrefix,
}) {
  const response = await fetch(`${baseUrl}/api/v1/workflows?limit=250`, {
    headers: {
      "X-N8N-API-KEY": apiKey,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Falha ao listar workflows do cliente ${clientId ?? "(sem id)"} (HTTP ${response.status})`
    );
  }

  const workflows = Array.isArray(payload?.data) ? payload.data : [];
  if (!workflows.length) return "";

  const exactName = String(fallbackName || "").trim();
  if (exactName) {
    const exact = workflows.find((w) => String(w?.name || "").trim() === exactName);
    if (exact?.id) return exact.id;
  }

  const prefix = String(namePrefix || "").trim().toLowerCase();
  if (prefix) {
    const prefixed = workflows.filter((w) =>
      String(w?.name || "").toLowerCase().startsWith(prefix)
    );
    if (!prefixed.length) return "";

    const normalizedClientName = normalizeText(clientName);
    if (normalizedClientName) {
      const byClientName = prefixed.find((w) =>
        normalizeText(w?.name).includes(normalizedClientName)
      );
      if (byClientName?.id) return byClientName.id;
    }

    if (prefixed[0]?.id) return prefixed[0].id;
  }

  return "";
}

async function main() {
  const workflowTemplate = await loadWorkflowTemplate(cfg.workflowFile);
  const clientes = await getClientes();

  if (!clientes.length) {
    console.log("Nenhum cliente encontrado para atualizacao.");
    return;
  }

  console.log(`Clientes encontrados: ${clientes.length}`);
  console.log(`Modo dry-run: ${cfg.dryRun ? "ativo" : "desativado"}`);

  const results = [];
  for (const cliente of clientes) {
    try {
      const result = await atualizarWorkflowCliente(cliente, workflowTemplate);
      results.push(result);
      console.log(`[OK] Cliente ${result.clientId ?? "(sem id)"} atualizado.`);
    } catch (error) {
      const clientId = get(cliente, cfg.idColumn);
      results.push({
        clientId,
        status: "erro",
        error: error.message,
      });
      console.error(`[ERRO] Cliente ${clientId ?? "(sem id)"}: ${error.message}`);
    }
  }

  const success = results.filter((r) => r.status === "ok" || r.status === "dry-run").length;
  const failed = results.filter((r) => r.status === "erro").length;

  console.log("Resumo:");
  console.log(`- Sucesso: ${success}`);
  console.log(`- Falha: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
