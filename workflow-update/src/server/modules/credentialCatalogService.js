import { getWorkflow, listWorkflows } from "./n8nClient.js";

const catalogCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyCatalog() {
  return {
    byType: new Map(),
    byTypeAndName: new Map(),
  };
}

function addCredential(catalog, credType, credValue) {
  const typeKey = normalize(credType);
  if (!typeKey || !isObject(credValue)) {
    return;
  }

  const list = catalog.byType.get(typeKey) || [];
  const candidateId = String(credValue?.id || "");
  const duplicated = candidateId
    ? list.some((item) => String(item?.id || "") === candidateId)
    : false;
  if (!duplicated) {
    list.push(deepClone(credValue));
    catalog.byType.set(typeKey, list);
  }

  const nameKey = normalize(credValue?.name);
  if (nameKey && !catalog.byTypeAndName.has(`${typeKey}::${nameKey}`)) {
    catalog.byTypeAndName.set(`${typeKey}::${nameKey}`, deepClone(credValue));
  }
}

function addWorkflowToCatalog(catalog, workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    const credentials = node?.credentials;
    if (!isObject(credentials)) continue;

    for (const [credType, credValue] of Object.entries(credentials)) {
      addCredential(catalog, credType, credValue);
    }
  }
}

async function buildCatalogForClient(client, { timeoutMs = 20000 } = {}) {
  const catalog = emptyCatalog();
  const workflows = await listWorkflows(client, { timeoutMs });

  const batchSize = 6;
  for (let i = 0; i < workflows.length; i += batchSize) {
    const slice = workflows.slice(i, i + batchSize);
    const fullItems = await Promise.all(
      slice.map(async (item) => {
        try {
          return await getWorkflow(client, item.id, { timeoutMs });
        } catch {
          return null;
        }
      })
    );

    for (const fullWorkflow of fullItems) {
      if (fullWorkflow) {
        addWorkflowToCatalog(catalog, fullWorkflow);
      }
    }
  }

  return {
    catalog,
    stats: {
      workflowsListed: workflows.length,
      credentialTypes: catalog.byType.size,
    },
  };
}

export async function getClientCredentialCatalog(client, { timeoutMs = 20000 } = {}) {
  const cacheKey = String(client?.id || "");
  const now = Date.now();
  const cached = catalogCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await buildCatalogForClient(client, { timeoutMs });
  catalogCache.set(cacheKey, {
    value,
    expiresAt: now + CACHE_TTL_MS,
  });

  return value;
}

