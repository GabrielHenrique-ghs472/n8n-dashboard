function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isScriptName(name) {
  return /script/i.test(String(name || ""));
}

function isDadosNodeName(name) {
  return /^dados\d*$/i.test(String(name || "").trim());
}

function getSetAssignments(node) {
  const assignments = node?.parameters?.assignments?.assignments;
  if (Array.isArray(assignments)) {
    return assignments
      .map((a, index) => ({
        mode: "assignments",
        index,
        name: a?.name,
        type: a?.type,
        value: a?.value,
      }))
      .filter((a) => a.type === "string" && typeof a.name === "string");
  }

  const stringValues = node?.parameters?.values?.string;
  if (Array.isArray(stringValues)) {
    return stringValues
      .map((a, index) => ({
        mode: "values.string",
        index,
        name: a?.name,
        type: "string",
        value: a?.value,
      }))
      .filter((a) => typeof a.name === "string");
  }

  return [];
}

function isEligibleNode(node) {
  const type = String(node?.type || "");
  if (type !== "n8n-nodes-base.set") return false;
  if (!isDadosNodeName(node?.name)) return false;
  const assignments = getSetAssignments(node);
  return assignments.some((a) => isScriptName(a.name));
}

export function discoverScriptTypes(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const scriptCounter = new Map();

  for (const node of nodes) {
    if (!isEligibleNode(node)) continue;

    for (const assignment of getSetAssignments(node)) {
      if (!isScriptName(assignment.name)) continue;
      const current = scriptCounter.get(assignment.name) || 0;
      scriptCounter.set(assignment.name, current + 1);
    }
  }

  return [...scriptCounter.entries()]
    .map(([name, occurrences]) => ({ name, occurrences }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function makeItemId(nodeId, assignmentName, mode, index) {
  return `${nodeId}::${assignmentName}::${mode}::${index}`;
}

const orderedNodeNames = ["Dados", "Dados2", "Dados4", "Dados9", "Dados8", "Dados5", "Dados7"];
const orderedNodeRank = new Map(orderedNodeNames.map((name, idx) => [name.toLowerCase(), idx]));

function getNodeOrderRank(nodeName) {
  const rank = orderedNodeRank.get(String(nodeName || "").toLowerCase());
  if (rank === undefined) return 9999;
  return rank;
}

export function collectScriptItems(workflow, selectedScriptName) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const items = [];

  for (const node of nodes) {
    if (!isEligibleNode(node)) continue;

    const assignments = getSetAssignments(node);
    for (const assignment of assignments) {
      if (assignment.name !== selectedScriptName) continue;
      items.push({
        itemId: makeItemId(node.id, assignment.name, assignment.mode, assignment.index),
        workflowId: workflow.id,
        workflowName: workflow.name,
        nodeId: node.id,
        nodeName: node.name,
        assignmentName: assignment.name,
        originalValue: String(assignment.value ?? ""),
        locator: {
          mode: assignment.mode,
          index: assignment.index,
        },
      });
    }
  }

  return items.sort((a, b) => {
    const rankA = getNodeOrderRank(a.nodeName);
    const rankB = getNodeOrderRank(b.nodeName);
    if (rankA !== rankB) return rankA - rankB;
    return String(a.nodeName).localeCompare(String(b.nodeName), "pt-BR");
  });
}

export function findCompatibleWorkflows(workflows, prefix = "") {
  if (!prefix) return workflows;
  const normalizedPrefix = normalizeText(prefix);
  return workflows.filter((w) => normalizeText(w?.name || "").startsWith(normalizedPrefix));
}

export function filterWorkflowsByUsernameTag(workflows, username = "") {
  const normalizedUsername = normalizeText(username);
  return workflows.filter((workflow) => {
    const name = String(workflow?.name || "");
    const match = name.match(/\(\s*([^)]+?)\s*\)/);
    if (!match) return false;
    if (!normalizedUsername) return true;
    return normalizeText(match[1]).includes(normalizedUsername);
  });
}
