import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

function ts() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

function safeName(value) {
  return String(value || "sem-nome")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function saveWorkflowBackup({
  baseDir,
  client,
  workflow,
  workflowOriginal,
  workflowPatched,
  diffStats,
  status,
  errorMessage = "",
}) {
  const folderName = `${ts()}_${safeName(client.nome)}_${safeName(workflow.name)}`;
  const folder = path.join(baseDir, folderName);
  await mkdir(folder, { recursive: true });

  const originalRaw = JSON.stringify(workflowOriginal, null, 2);
  const patchedRaw = JSON.stringify(workflowPatched, null, 2);

  const metadata = {
    createdAt: new Date().toISOString(),
    status,
    errorMessage,
    client: {
      id: client.id,
      nome: client.nome,
      n8nUrl: client.n8nUrl,
    },
    workflow: {
      id: workflow.id,
      name: workflow.name,
    },
    diffStats: diffStats || {
      addedLines: 0,
      removedLines: 0,
      changed: false,
    },
    snapshotHash: {
      before: sha256(originalRaw),
      after: sha256(patchedRaw),
    },
  };

  await writeFile(path.join(folder, "workflow-original.json"), originalRaw, "utf8");
  await writeFile(path.join(folder, "workflow-patched.json"), patchedRaw, "utf8");
  await writeFile(path.join(folder, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  await mkdir(baseDir, { recursive: true });
  const auditPath = path.join(baseDir, "audit-log.jsonl");
  await appendFile(auditPath, `${JSON.stringify(metadata)}\n`, "utf8");

  return {
    folder,
    auditPath,
    metadata,
  };
}

export async function saveBackup({
  baseDir,
  client,
  workflow,
  selectedScriptName,
  changedItems,
  workflowOriginal,
  workflowPatched,
  status,
  errorMessage = "",
}) {
  const diffStats = {
    changed: (changedItems || []).length > 0,
    changedItems: (changedItems || []).length,
  };

  const result = await saveWorkflowBackup({
    baseDir,
    client,
    workflow,
    workflowOriginal,
    workflowPatched,
    diffStats,
    status,
    errorMessage,
  });

  const metadata = {
    ...result.metadata,
    selectedScriptName,
    changedItems: (changedItems || []).map((item) => ({
      itemId: item.itemId,
      nodeId: item.nodeId,
      nodeName: item.nodeName,
      assignmentName: item.assignmentName,
      beforeHash: sha256(String(item.before ?? "")),
      afterHash: sha256(String(item.after ?? "")),
    })),
  };

  await writeFile(path.join(result.folder, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  return {
    ...result,
    metadata,
  };
}
