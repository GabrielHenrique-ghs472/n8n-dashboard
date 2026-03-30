function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const ORIGIN_NODE_OVERRIDE_RULES = [
  {
    workflowNameIncludes: "trativa de mensagem",
    nodeNames: ["Webhook1"],
  },
  {
    workflowNameIncludes: "follow",
    nodeNames: ["Nome do cliente"],
  },
  {
    workflowNameIncludes: "chamada de retorno",
    nodeNames: ["Nome do cliente"],
  },
];

function getNormalized(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRuleToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function buildTargetCredentialCatalog(targetNodes) {
  const byType = new Map();
  const byTypeAndName = new Map();

  for (const node of targetNodes) {
    const credentials = node?.credentials;
    if (!isObject(credentials)) {
      continue;
    }

    for (const [credType, credValue] of Object.entries(credentials)) {
      if (!isObject(credValue)) {
        continue;
      }

      const normalizedType = getNormalized(credType);
      if (!normalizedType) {
        continue;
      }

      const list = byType.get(normalizedType) || [];
      list.push(deepClone(credValue));
      byType.set(normalizedType, list);

      const credName = getNormalized(credValue?.name);
      if (credName) {
        byTypeAndName.set(`${normalizedType}::${credName}`, deepClone(credValue));
      }
    }
  }

  return { byType, byTypeAndName };
}

function pickCredentialFromCatalog(credType, sourceCredValue, localCatalog, globalCatalog) {
  const typeKey = getNormalized(credType);
  if (!typeKey) {
    return null;
  }

  const sourceName = getNormalized(sourceCredValue?.name);
  if (sourceName) {
    const byNameLocal = localCatalog?.byTypeAndName?.get(`${typeKey}::${sourceName}`);
    if (byNameLocal) {
      return deepClone(byNameLocal);
    }
  }

  const byTypeLocal = localCatalog?.byType?.get(typeKey) || [];
  if (byTypeLocal.length > 0) {
    return deepClone(byTypeLocal[0]);
  }

  if (sourceName) {
    const byNameGlobal = globalCatalog?.byTypeAndName?.get(`${typeKey}::${sourceName}`);
    if (byNameGlobal) {
      return deepClone(byNameGlobal);
    }
  }

  const byTypeGlobal = globalCatalog?.byType?.get(typeKey) || [];
  if (byTypeGlobal.length > 0) {
    return deepClone(byTypeGlobal[0]);
  }

  return null;
}

function remapSourceCredentialsFromCatalog(
  sourceNode,
  localCatalog,
  globalCatalog,
  { allowSourceFallback = false } = {}
) {
  if (!isObject(sourceNode?.credentials)) {
    return {
      changed: false,
      removedCount: 0,
      inheritedCount: 0,
      sourceFallbackCount: 0,
    };
  }

  const remapped = {};
  let inheritedCount = 0;
  let sourceFallbackCount = 0;

  for (const [credType, sourceCredValue] of Object.entries(sourceNode.credentials)) {
    const replacement = pickCredentialFromCatalog(
      credType,
      sourceCredValue,
      localCatalog,
      globalCatalog
    );
    if (replacement) {
      remapped[credType] = replacement;
      inheritedCount += 1;
      continue;
    }

    if (allowSourceFallback && isObject(sourceCredValue)) {
      remapped[credType] = deepClone(sourceCredValue);
      sourceFallbackCount += 1;
    }
  }

  const originalCount = Object.keys(sourceNode.credentials).length;
  if (Object.keys(remapped).length > 0) {
    sourceNode.credentials = remapped;
  } else {
    delete sourceNode.credentials;
  }

  const removedCount = Math.max(originalCount - inheritedCount - sourceFallbackCount, 0);
  return {
    changed: true,
    removedCount,
    inheritedCount,
    sourceFallbackCount,
  };
}

function shouldKeepNodeExactlyFromSource(targetWorkflowName, sourceNodeName) {
  const workflowNorm = normalizeRuleToken(targetWorkflowName);
  const nodeNorm = normalizeRuleToken(sourceNodeName);
  if (!workflowNorm || !nodeNorm) {
    return false;
  }

  return ORIGIN_NODE_OVERRIDE_RULES.some((rule) => {
    const workflowMatch = workflowNorm.includes(normalizeRuleToken(rule.workflowNameIncludes));
    if (!workflowMatch) {
      return false;
    }

    return rule.nodeNames.some((nodeName) => {
      const ruleNodeNorm = normalizeRuleToken(nodeName);
      if (!ruleNodeNorm) return false;
      return nodeNorm.includes(ruleNodeNorm) || ruleNodeNorm.includes(nodeNorm);
    });
  });
}

function buildNodeLookup(nodes) {
  const byId = new Map();
  const byName = new Map();

  nodes.forEach((node, index) => {
    const id = node?.id;
    const name = String(node?.name || "");

    if (id !== undefined && id !== null && id !== "") {
      const key = String(id);
      const list = byId.get(key) || [];
      list.push(index);
      byId.set(key, list);
    }

    if (name) {
      const list = byName.get(name) || [];
      list.push(index);
      byName.set(name, list);
    }
  });

  return { byId, byName };
}

function takeFirstUnused(indexes, usedIndexes) {
  if (!Array.isArray(indexes)) {
    return null;
  }

  for (const index of indexes) {
    if (!usedIndexes.has(index)) {
      return index;
    }
  }

  return null;
}

function matchSourceNodeToTargetIndex(sourceNode, targetLookup, usedTargetIndexes) {
  if (sourceNode?.id !== undefined && sourceNode?.id !== null && sourceNode?.id !== "") {
    const byIdIndex = takeFirstUnused(targetLookup.byId.get(String(sourceNode.id)), usedTargetIndexes);
    if (byIdIndex !== null) {
      return { index: byIdIndex, matchType: "id" };
    }
  }

  if (sourceNode?.name) {
    const byNameIndex = takeFirstUnused(targetLookup.byName.get(String(sourceNode.name)), usedTargetIndexes);
    if (byNameIndex !== null) {
      return { index: byNameIndex, matchType: "name" };
    }
  }

  return { index: null, matchType: "new" };
}

export function prepareWorkflowForTarget(sourceWorkflow, targetWorkflow, options = {}) {
  const prepared = deepClone(sourceWorkflow || {});
  prepared.name = String(targetWorkflow?.name || prepared?.name || "");
  prepared.active = Boolean(targetWorkflow?.active);
  const targetWorkflowName = String(targetWorkflow?.name || "");
  const sourceNodes = Array.isArray(prepared?.nodes) ? prepared.nodes : [];
  const targetNodes = Array.isArray(targetWorkflow?.nodes) ? targetWorkflow.nodes : [];
  const targetLookup = buildNodeLookup(targetNodes);
  const targetCredentialCatalog = buildTargetCredentialCatalog(targetNodes);
  const globalCredentialCatalog = options?.clientCredentialCatalog || {
    byType: new Map(),
    byTypeAndName: new Map(),
  };
  const usedTargetIndexes = new Set();
  let credentialsPreserved = 0;
  let credentialsInheritedByType = 0;
  let sourceCredentialsFallbackUsed = 0;
  let positionPreserved = 0;
  let sourceCredentialsRemoved = 0;
  let matchedNodes = 0;
  let unmatchedNodes = 0;
  let originOverrideNodes = 0;

  for (const sourceNode of sourceNodes) {
    const keepFromSource = shouldKeepNodeExactlyFromSource(targetWorkflowName, sourceNode?.name);
    const match = matchSourceNodeToTargetIndex(sourceNode, targetLookup, usedTargetIndexes);
    if (match.index === null) {
      unmatchedNodes += 1;
      if (!keepFromSource && sourceNode?.credentials !== undefined) {
        const remap = remapSourceCredentialsFromCatalog(
          sourceNode,
          targetCredentialCatalog,
          globalCredentialCatalog,
          { allowSourceFallback: true }
        );
        sourceCredentialsRemoved += remap.removedCount;
        credentialsInheritedByType += remap.inheritedCount;
        sourceCredentialsFallbackUsed += remap.sourceFallbackCount;
      }
      if (keepFromSource) {
        originOverrideNodes += 1;
      }
      continue;
    }

    matchedNodes += 1;
    usedTargetIndexes.add(match.index);

    if (keepFromSource) {
      originOverrideNodes += 1;
      continue;
    }

    const targetNode = targetNodes[match.index];

    if (isObject(targetNode?.credentials)) {
      sourceNode.credentials = deepClone(targetNode.credentials);
      credentialsPreserved += 1;
    } else if (sourceNode?.credentials !== undefined) {
      const remap = remapSourceCredentialsFromCatalog(
        sourceNode,
        targetCredentialCatalog,
        globalCredentialCatalog,
        { allowSourceFallback: true }
      );
      sourceCredentialsRemoved += remap.removedCount;
      credentialsInheritedByType += remap.inheritedCount;
      sourceCredentialsFallbackUsed += remap.sourceFallbackCount;
    }

    if (Array.isArray(targetNode?.position)) {
      sourceNode.position = [...targetNode.position];
      positionPreserved += 1;
    }
  }

  return {
    workflow: prepared,
    preserveStats: {
      credentialsPreserved,
      credentialsInheritedByType,
      sourceCredentialsFallbackUsed,
      positionPreserved,
      sourceCredentialsRemoved,
      matchedNodes,
      unmatchedNodes,
      originOverrideNodes,
    },
  };
}
