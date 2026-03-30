import "dotenv/config";

function getEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function parseFilterValue(value) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (normalized === "null") return null;
  if (normalized !== "" && !Number.isNaN(Number(normalized))) return Number(normalized);
  return value;
}

export const config = {
  port: Number(getEnv("PORT", "3030")),
  supabaseUrl: getEnv("SUPABASE_URL"),
  supabaseKey: getEnv("SUPABASE_KEY"),
  table: getEnv("SUPABASE_TABLE", "mcp_clientes"),
  idColumn: getEnv("CLIENT_ID_COLUMN", "id"),
  nameColumn: getEnv("CLIENT_NAME_COLUMN", "nome"),
  urlColumn: getEnv("N8N_URL_COLUMN", "n8n_url"),
  tokenColumn: getEnv("N8N_TOKEN_COLUMN", "api_key"),
  activeColumn: getEnv("CLIENT_ACTIVE_COLUMN", ""),
  activeValue: parseFilterValue(getEnv("CLIENT_ACTIVE_VALUE", "true")),
  scriptsVarColumn: getEnv("CLIENT_SCRIPTS_VARIADOS_COLUMN", "scrips_variados"),
  scriptsVarValue: parseFilterValue(getEnv("CLIENT_SCRIPTS_VARIADOS_VALUE", "true")),
  eligibilityColumn: getEnv(
    "CLIENT_ELIGIBILITY_COLUMN",
    getEnv("CLIENT_SCRIPTS_VARIADOS_COLUMN", "scrips_variados")
  ),
  eligibilityValue: parseFilterValue(
    getEnv("CLIENT_ELIGIBILITY_VALUE", getEnv("CLIENT_SCRIPTS_VARIADOS_VALUE", "true"))
  ),
  requestTimeoutMs: Number(getEnv("REQUEST_TIMEOUT_MS", "20000")),
};

const required = ["supabaseUrl", "supabaseKey"];
for (const key of required) {
  if (!config[key]) {
    throw new Error(`Variavel obrigatoria ausente: ${key}`);
  }
}
