function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "X-N8N-API-KEY": apiKey,
  };
}

async function withTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function isTransientNetworkError(error) {
  const code = error?.cause?.code || error?.code || "";
  return [
    "UND_ERR_CONNECT_TIMEOUT",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "AbortError",
  ].includes(code);
}

async function withRetry(requestFn, { retries = 3, initialDelayMs = 350 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await requestFn();
      if (response?.ok || !isTransientStatus(response?.status) || attempt >= retries) {
        return response;
      }
      await wait(initialDelayMs * attempt);
      continue;
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= retries) {
        throw error;
      }
      await wait(initialDelayMs * attempt);
    }
  }
  throw lastError;
}

function getBaseUrl(client) {
  const baseUrl = String(client.n8nUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Cliente sem n8n_url configurada.");
  if (!client.apiKey) throw new Error("Cliente sem api_key configurada.");
  return baseUrl;
}

export async function listWorkflows(client, { timeoutMs = 20000 } = {}) {
  const baseUrl = getBaseUrl(client);
  const res = await withRetry(
    () =>
      withTimeout(
        `${baseUrl}/api/v1/workflows?limit=250`,
        { method: "GET", headers: buildHeaders(client.apiKey) },
        timeoutMs
      ),
    { retries: 3, initialDelayMs: 500 }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Erro ao listar workflows (HTTP ${res.status})`);
  }

  const data = Array.isArray(json?.data) ? json.data : [];
  return data.map((w) => ({
    id: w.id,
    name: w.name,
    active: Boolean(w.active),
    updatedAt: w.updatedAt || null,
  }));
}

export async function getWorkflow(client, workflowId, { timeoutMs = 20000 } = {}) {
  const baseUrl = getBaseUrl(client);
  const res = await withRetry(
    () =>
      withTimeout(
        `${baseUrl}/api/v1/workflows/${workflowId}`,
        { method: "GET", headers: buildHeaders(client.apiKey) },
        timeoutMs
      ),
    { retries: 3, initialDelayMs: 500 }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message ? `: ${json.message}` : "";
    throw new Error(`Erro ao carregar workflow (HTTP ${res.status})${msg}`);
  }

  return json?.data || json;
}

export function cleanWorkflowForUpdate(workflow) {
  const clean = {
    name: workflow?.name,
    nodes: workflow?.nodes,
    connections: workflow?.connections,
    settings: workflow?.settings ?? {},
  };

  if (workflow?.staticData !== undefined) {
    clean.staticData = workflow.staticData;
  }

  return clean;
}

export async function updateWorkflow(client, workflowId, workflowBody, { timeoutMs = 20000 } = {}) {
  const baseUrl = getBaseUrl(client);
  const cleanBody = cleanWorkflowForUpdate(workflowBody);

  const res = await withRetry(
    () =>
      withTimeout(
        `${baseUrl}/api/v1/workflows/${workflowId}`,
        {
          method: "PUT",
          headers: buildHeaders(client.apiKey),
          body: JSON.stringify(cleanBody),
        },
        timeoutMs
      ),
    { retries: 3, initialDelayMs: 600 }
  );

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 405) {
      throw new Error(
        `Erro ao salvar workflow (HTTP 405): metodo nao permitido na instancia n8n. Resposta: ${text}`
      );
    }
    throw new Error(`Erro ao salvar workflow (HTTP ${res.status}): ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: true };
  }
}
