import path from "node:path";
import express from "express";
import { getClientById, getClients } from "./modules/supabaseClient.js";
import { getWorkflow, listWorkflows, updateWorkflow } from "./modules/n8nClient.js";
import { buildWorkflowDiff } from "./modules/diffService.js";
import { saveWorkflowBackup } from "./modules/backupService.js";
import { validateWorkflowPayload } from "./modules/workflowValidator.js";
import { prepareWorkflowForTarget } from "./modules/workflowMergeService.js";
import { getClientCredentialCatalog } from "./modules/credentialCatalogService.js";

const saveLocks = new Map();

function getLockKey(clientId, workflowId) {
  return `${clientId}:${workflowId}`;
}

export function createRoutes({ config, supabase }) {
  const router = express.Router();
  const backupsBaseDir = path.resolve(process.cwd(), "backups");

  router.get("/health", (_req, res) => {
    res.json({ ok: true, now: new Date().toISOString() });
  });

  router.get("/clients", async (_req, res) => {
    try {
      const clients = await getClients(supabase, config);
      res.json({ clients });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/clients/:clientId/workflows", async (req, res) => {
    try {
      const client = await getClientById(supabase, config, req.params.clientId);
      const workflows = await listWorkflows(client, {
        timeoutMs: config.requestTimeoutMs,
      });

      res.json({
        client: { id: client.id, nome: client.nome },
        workflows,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/clients/:clientId/workflows/:workflowId", async (req, res) => {
    try {
      const client = await getClientById(supabase, config, req.params.clientId);
      const workflow = await getWorkflow(client, req.params.workflowId, {
        timeoutMs: config.requestTimeoutMs,
      });

      res.json({
        client: { id: client.id, nome: client.nome },
        workflow: {
          id: workflow.id,
          name: workflow.name,
          data: workflow,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/clients/:clientId/workflows/:workflowId/review-full", async (req, res) => {
    try {
      const proposedWorkflow = req.body?.proposedWorkflow;
      const validationErrors = validateWorkflowPayload(proposedWorkflow);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: "Workflow proposto inválido.",
          validationErrors,
        });
      }

      const client = await getClientById(supabase, config, req.params.clientId);
      const workflowCurrent = await getWorkflow(client, req.params.workflowId, {
        timeoutMs: config.requestTimeoutMs,
      });
      const credentialCatalogInfo = await getClientCredentialCatalog(client, {
        timeoutMs: config.requestTimeoutMs,
      });
      const prepared = prepareWorkflowForTarget(proposedWorkflow, workflowCurrent, {
        clientCredentialCatalog: credentialCatalogInfo.catalog,
      });

      const diff = buildWorkflowDiff(workflowCurrent, prepared.workflow);

      return res.json({
        target: {
          client: { id: client.id, nome: client.nome },
          workflow: { id: workflowCurrent.id, name: workflowCurrent.name },
        },
        diff,
        preserveStats: prepared.preserveStats,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post("/clients/:clientId/workflows/:workflowId/save-full", async (req, res) => {
    const lockKey = getLockKey(req.params.clientId, req.params.workflowId);

    if (saveLocks.has(lockKey)) {
      return res.status(409).json({
        error: "Já existe um save em andamento para este cliente/workflow. Aguarde finalizar.",
      });
    }

    saveLocks.set(lockKey, true);

    try {
      const proposedWorkflow = req.body?.proposedWorkflow;
      const validationErrors = validateWorkflowPayload(proposedWorkflow);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: "Workflow proposto inválido.",
          validationErrors,
        });
      }

      const client = await getClientById(supabase, config, req.params.clientId);
      const workflowCurrent = await getWorkflow(client, req.params.workflowId, {
        timeoutMs: config.requestTimeoutMs,
      });
      const credentialCatalogInfo = await getClientCredentialCatalog(client, {
        timeoutMs: config.requestTimeoutMs,
      });
      const prepared = prepareWorkflowForTarget(proposedWorkflow, workflowCurrent, {
        clientCredentialCatalog: credentialCatalogInfo.catalog,
      });

      const diff = buildWorkflowDiff(workflowCurrent, prepared.workflow);
      if (!diff.stats.changed) {
        return res.status(400).json({ error: "Não há mudanças para salvar." });
      }

      const backup = await saveWorkflowBackup({
        baseDir: backupsBaseDir,
        client,
        workflow: { id: workflowCurrent.id, name: workflowCurrent.name },
        workflowOriginal: workflowCurrent,
        workflowPatched: prepared.workflow,
        diffStats: diff.stats,
        status: "pending",
      });

      try {
        await updateWorkflow(client, req.params.workflowId, prepared.workflow, {
          timeoutMs: config.requestTimeoutMs,
        });

        await saveWorkflowBackup({
          baseDir: backupsBaseDir,
          client,
          workflow: { id: workflowCurrent.id, name: workflowCurrent.name },
          workflowOriginal: workflowCurrent,
          workflowPatched: prepared.workflow,
          diffStats: diff.stats,
          status: "success",
        });

        return res.json({
          ok: true,
          changed: true,
          stats: diff.stats,
          preserveStats: prepared.preserveStats,
          backupFolder: backup.folder,
        });
      } catch (error) {
        await saveWorkflowBackup({
          baseDir: backupsBaseDir,
          client,
          workflow: { id: workflowCurrent.id, name: workflowCurrent.name },
          workflowOriginal: workflowCurrent,
          workflowPatched: prepared.workflow,
          diffStats: diff.stats,
          status: "error",
          errorMessage: error.message,
        });
        throw error;
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    } finally {
      saveLocks.delete(lockKey);
    }
  });

  return router;
}
