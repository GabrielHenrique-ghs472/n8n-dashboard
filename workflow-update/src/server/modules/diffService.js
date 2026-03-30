import { diffLines } from "diff";

function linesFromChunk(value) {
  const raw = String(value || "").split("\n");
  return raw[raw.length - 1] === "" ? raw.slice(0, -1) : raw;
}

export function buildLineDiff(before, after) {
  const chunks = diffLines(String(before ?? ""), String(after ?? ""));
  const lines = [];

  for (const chunk of chunks) {
    const type = chunk.added ? "add" : chunk.removed ? "remove" : "context";
    for (const line of linesFromChunk(chunk.value)) {
      lines.push({ type, value: line });
    }
  }

  return lines;
}

export function buildSideBySide(before, after) {
  const chunks = diffLines(String(before ?? ""), String(after ?? ""));
  const rows = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];

    if (chunk.removed) {
      const removed = linesFromChunk(chunk.value);
      const next = chunks[i + 1];
      if (next?.added) {
        const added = linesFromChunk(next.value);
        const max = Math.max(removed.length, added.length);
        for (let j = 0; j < max; j += 1) {
          rows.push({
            oldLine: removed[j] ?? "",
            newLine: added[j] ?? "",
            oldChanged: j < removed.length,
            newChanged: j < added.length,
          });
        }
        i += 1;
      } else {
        for (const line of removed) {
          rows.push({
            oldLine: line,
            newLine: "",
            oldChanged: true,
            newChanged: false,
          });
        }
      }
      continue;
    }

    if (chunk.added) {
      const added = linesFromChunk(chunk.value);
      for (const line of added) {
        rows.push({
          oldLine: "",
          newLine: line,
          oldChanged: false,
          newChanged: true,
        });
      }
      continue;
    }

    for (const line of linesFromChunk(chunk.value)) {
      rows.push({
        oldLine: line,
        newLine: line,
        oldChanged: false,
        newChanged: false,
      });
    }
  }

  return rows;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushFieldChange(changes, path, before, after) {
  const beforeMissing = typeof before === "undefined";
  const afterMissing = typeof after === "undefined";
  const changeType = beforeMissing ? "added" : afterMissing ? "removed" : "updated";

  changes.push({
    path: path || "(root)",
    before,
    after,
    changeType,
  });
}

function shouldIgnoreFieldPath(path) {
  return path === "position" || path.startsWith("position[");
}

function collectValueChanges(before, after, path, changes, limits) {
  if (changes.length >= limits.maxFields) {
    limits.truncated = true;
    return;
  }

  if (before === after) {
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let index = 0; index < max; index += 1) {
      const nextPath = `${path}[${index}]`;
      collectValueChanges(before[index], after[index], nextPath, changes, limits);
      if (changes.length >= limits.maxFields) {
        limits.truncated = true;
        return;
      }
    }
    return;
  }

  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      collectValueChanges(before[key], after[key], nextPath, changes, limits);
      if (changes.length >= limits.maxFields) {
        limits.truncated = true;
        return;
      }
    }
    return;
  }

  if (shouldIgnoreFieldPath(path)) {
    return;
  }

  pushFieldChange(changes, path, before, after);
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

function buildNodeLookup(nodes) {
  const byId = new Map();
  const byName = new Map();

  nodes.forEach((node, index) => {
    if (node?.id !== undefined && node?.id !== null && node?.id !== "") {
      const idKey = String(node.id);
      const existing = byId.get(idKey) || [];
      existing.push(index);
      byId.set(idKey, existing);
    }

    const nameKey = String(node?.name || "");
    if (nameKey) {
      const existing = byName.get(nameKey) || [];
      existing.push(index);
      byName.set(nameKey, existing);
    }
  });

  return { byId, byName };
}

function buildNodeReplacementSummary(originalWorkflow, proposedWorkflow) {
  const targetNodes = Array.isArray(originalWorkflow?.nodes) ? originalWorkflow.nodes : [];
  const sourceNodes = Array.isArray(proposedWorkflow?.nodes) ? proposedWorkflow.nodes : [];

  const sourceLookup = buildNodeLookup(sourceNodes);
  const usedSourceIndexes = new Set();
  const matchedPairs = [];

  targetNodes.forEach((targetNode, targetIndex) => {
    let sourceIndex = null;
    let matchType = "id";

    if (targetNode?.id !== undefined && targetNode?.id !== null && targetNode?.id !== "") {
      sourceIndex = takeFirstUnused(sourceLookup.byId.get(String(targetNode.id)), usedSourceIndexes);
      if (sourceIndex !== null) {
        matchType = "id";
      }
    }

    if (sourceIndex === null && targetNode?.name) {
      sourceIndex = takeFirstUnused(sourceLookup.byName.get(String(targetNode.name)), usedSourceIndexes);
      if (sourceIndex !== null) {
        matchType = "name";
      }
    }

    if (sourceIndex === null) {
      matchedPairs.push({
        targetIndex,
        sourceIndex: null,
        matchType: "removed",
      });
      return;
    }

    usedSourceIndexes.add(sourceIndex);
    matchedPairs.push({
      targetIndex,
      sourceIndex,
      matchType,
    });
  });

  const nodeChanges = [];
  let nodesAdded = 0;
  let nodesRemoved = 0;
  let nodesChanged = 0;
  let fieldChangesTotal = 0;
  let truncatedFields = false;

  for (const pair of matchedPairs) {
    const targetNode = targetNodes[pair.targetIndex];
    const sourceNode = pair.sourceIndex === null ? null : sourceNodes[pair.sourceIndex];

    if (!sourceNode) {
      nodesRemoved += 1;
      nodeChanges.push({
        changeType: "removed",
        matchType: pair.matchType,
        targetNode: {
          id: targetNode?.id ?? null,
          name: targetNode?.name ?? `(node ${pair.targetIndex + 1})`,
          type: targetNode?.type ?? null,
        },
        sourceNode: null,
        changedFields: [],
      });
      continue;
    }

    const changedFields = [];
    const limits = { maxFields: 500, truncated: false };
    collectValueChanges(targetNode, sourceNode, "", changedFields, limits);

    if (changedFields.length > 0) {
      nodesChanged += 1;
      fieldChangesTotal += changedFields.length;
      if (limits.truncated) {
        truncatedFields = true;
      }

      nodeChanges.push({
        changeType: "modified",
        matchType: pair.matchType,
        targetNode: {
          id: targetNode?.id ?? null,
          name: targetNode?.name ?? `(node ${pair.targetIndex + 1})`,
          type: targetNode?.type ?? null,
        },
        sourceNode: {
          id: sourceNode?.id ?? null,
          name: sourceNode?.name ?? `(node ${pair.sourceIndex + 1})`,
          type: sourceNode?.type ?? null,
        },
        changedFields,
      });
    }
  }

  sourceNodes.forEach((sourceNode, sourceIndex) => {
    if (!usedSourceIndexes.has(sourceIndex)) {
      nodesAdded += 1;
      nodeChanges.push({
        changeType: "added",
        matchType: "new",
        targetNode: null,
        sourceNode: {
          id: sourceNode?.id ?? null,
          name: sourceNode?.name ?? `(node ${sourceIndex + 1})`,
          type: sourceNode?.type ?? null,
        },
        changedFields: [],
      });
    }
  });

  return {
    nodeChanges,
    nodeStats: {
      targetNodes: targetNodes.length,
      sourceNodes: sourceNodes.length,
      nodesChanged,
      nodesAdded,
      nodesRemoved,
      fieldChangesTotal,
      truncatedFields,
    },
  };
}

export function buildWorkflowDiff(originalWorkflow, proposedWorkflow) {
  const before = JSON.stringify(originalWorkflow, null, 2);
  const after = JSON.stringify(proposedWorkflow, null, 2);
  const unified = buildLineDiff(before, after);
  const sideBySide = buildSideBySide(before, after);
  const replacementSummary = buildNodeReplacementSummary(originalWorkflow, proposedWorkflow);

  const addedLines = unified.filter((line) => line.type === "add").length;
  const removedLines = unified.filter((line) => line.type === "remove").length;

  return {
    before,
    after,
    unified,
    sideBySide,
    nodeChanges: replacementSummary.nodeChanges,
    stats: {
      addedLines,
      removedLines,
      changed: addedLines + removedLines > 0,
    },
    nodeStats: replacementSummary.nodeStats,
  };
}

export function summarizeChanges(changedItems) {
  return (changedItems || []).map((item) => ({
    itemId: item.itemId,
    nodeId: item.nodeId,
    nodeName: item.nodeName,
    assignmentName: item.assignmentName,
    before: item.before,
    after: item.after,
    diff: buildLineDiff(item.before, item.after),
    sideBySide: buildSideBySide(item.before, item.after),
  }));
}
