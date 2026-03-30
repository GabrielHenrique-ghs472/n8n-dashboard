function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

export function validateWorkflowPayload(workflow) {
  const errors = [];
  const nodes = asArray(workflow?.nodes);
  const connections = workflow?.connections;

  if (!workflow || !isObject(workflow)) {
    errors.push("Workflow proposto invalido: corpo ausente ou malformado.");
    return errors;
  }

  if (!String(workflow.name || "").trim()) {
    errors.push("Campo obrigatorio ausente: name.");
  }

  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    errors.push("Campo obrigatorio ausente ou vazio: nodes.");
  }

  if (!isObject(connections)) {
    errors.push("Campo obrigatorio ausente: connections.");
  }

  const nodeNames = new Set();
  const nodeIds = new Set();
  for (const node of nodes) {
    if (!isObject(node)) continue;
    if (node.name) nodeNames.add(String(node.name));
    if (node.id) nodeIds.add(String(node.id));
  }

  if (nodeNames.size === 0) {
    errors.push("Nao foi possivel identificar nodes validos (name/id).");
  }

  if (isObject(connections)) {
    for (const sourceName of Object.keys(connections)) {
      if (!nodeNames.has(sourceName)) {
        errors.push(`Conexao invalida: node de origem '${sourceName}' nao existe em nodes.`);
        continue;
      }

      const sourceOutputs = connections[sourceName];
      if (!isObject(sourceOutputs)) continue;

      for (const outputKey of Object.keys(sourceOutputs)) {
        const outputGroups = asArray(sourceOutputs[outputKey]);
        for (const group of outputGroups) {
          for (const edge of asArray(group)) {
            const targetName = String(edge?.node || "");
            if (targetName && !nodeNames.has(targetName)) {
              errors.push(
                `Conexao invalida: destino '${targetName}' referenciado em '${sourceName}' nao existe.`
              );
            }
          }
        }
      }
    }
  }

  if (nodeIds.size === 0) {
    errors.push("Nenhum node possui 'id'; isso pode quebrar referencias internas.");
  }

  return errors;
}
