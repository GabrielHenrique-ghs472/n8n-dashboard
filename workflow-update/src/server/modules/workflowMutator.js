import { collectScriptItems } from "./workflowInspector.js";

function deepClone(data) {
  return structuredClone(data);
}

function setValueByLocator(node, locator, newValue) {
  if (locator.mode === "assignments") {
    const target = node?.parameters?.assignments?.assignments?.[locator.index];
    if (!target) return false;
    target.value = newValue;
    return true;
  }

  if (locator.mode === "values.string") {
    const target = node?.parameters?.values?.string?.[locator.index];
    if (!target) return false;
    target.value = newValue;
    return true;
  }

  return false;
}

export function applyScriptEdits(workflow, selectedScriptName, edits) {
  const editableItems = collectScriptItems(workflow, selectedScriptName);
  const byItemId = new Map(editableItems.map((item) => [item.itemId, item]));

  const toApply = edits.filter((edit) => {
    const found = byItemId.get(edit.itemId);
    if (!found) return false;
    return String(found.originalValue ?? "") !== String(edit.editedValue ?? "");
  });

  if (toApply.length === 0) {
    return {
      workflowPatched: deepClone(workflow),
      changedItems: [],
    };
  }

  const workflowPatched = deepClone(workflow);
  const nodes = Array.isArray(workflowPatched.nodes) ? workflowPatched.nodes : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const changedItems = [];
  for (const edit of toApply) {
    const source = byItemId.get(edit.itemId);
    const node = nodeById.get(source.nodeId);
    if (!node) continue;

    const ok = setValueByLocator(node, source.locator, String(edit.editedValue ?? ""));
    if (!ok) continue;

    changedItems.push({
      itemId: source.itemId,
      nodeId: source.nodeId,
      nodeName: source.nodeName,
      assignmentName: source.assignmentName,
      before: source.originalValue,
      after: String(edit.editedValue ?? ""),
    });
  }

  return {
    workflowPatched,
    changedItems,
  };
}
