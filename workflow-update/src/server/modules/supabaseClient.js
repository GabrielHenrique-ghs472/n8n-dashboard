import { createClient } from "@supabase/supabase-js";

export function createSupabaseClient(config) {
  return createClient(config.supabaseUrl, config.supabaseKey);
}

export async function getClients(supabase, config) {
  const columns = [
    config.idColumn,
    config.nameColumn,
    config.urlColumn,
    config.tokenColumn,
    config.activeColumn,
    config.scriptsVarColumn,
    config.eligibilityColumn,
  ]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(",");

  let query = supabase.from(config.table).select(columns);

  if (config.activeColumn) {
    query = query.eq(config.activeColumn, config.activeValue);
  }
  if (config.eligibilityColumn) {
    query = query.eq(config.eligibilityColumn, config.eligibilityValue);
  }

  const { data, error } = await query.order(config.nameColumn, { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row[config.idColumn],
    nome: row[config.nameColumn],
    n8n_url: row[config.urlColumn],
    hasApiKey: Boolean(row[config.tokenColumn]),
  }));
}

export async function getClientById(supabase, config, clientId) {
  const columns = [
    config.idColumn,
    config.nameColumn,
    config.urlColumn,
    config.tokenColumn,
    config.activeColumn,
    config.scriptsVarColumn,
    config.eligibilityColumn,
  ]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(",");

  const { data, error } = await supabase
    .from(config.table)
    .select(columns)
    .eq(config.idColumn, clientId)
    .single();

  if (error) throw error;
  if (!data) throw new Error("Cliente nao encontrado.");

  if (config.activeColumn && data[config.activeColumn] !== config.activeValue) {
    throw new Error("Cliente nao elegivel pela regra de ativo/churn.");
  }

  if (config.eligibilityColumn && data[config.eligibilityColumn] !== config.eligibilityValue) {
    throw new Error(`Cliente nao elegivel pela regra ${config.eligibilityColumn}.`);
  }

  return {
    id: data[config.idColumn],
    nome: data[config.nameColumn],
    n8nUrl: data[config.urlColumn],
    apiKey: data[config.tokenColumn],
  };
}
