const { useEffect, useMemo, useRef, useState } = React;

const WORKFLOW_NODE_RULES = [
  {
    workflowNameIncludes: "tratativa",
    nodeNames: ["Webhook1"],
    description: "Node mantido exatamente como destino",
  },
  {
    workflowNameIncludes: "follow",
    nodeNames: ["Nome do cliente"],
    description: "Node mantido exatamente como destino",
  },
  {
    workflowNameIncludes: "chamada de retorno",
    nodeNames: ["Nome do cliente"],
    description: "Node mantido exatamente como destino",
  },
];

const BASE_SINTESE_TEMPLATE_RULES = [
  { key: "tratativa", contains: "tratativa de mensagem" },
  { key: "buffer", contains: "buffer de mensagem" },
  { key: "decisorio", contains: "fluxo decisorio" },
  { key: "recepcao", contains: "fluxo recepcao" },
  { key: "gerador", contains: "gerador de resposta comercial" },
  { key: "tools", contains: "tools" },
  { key: "envio", contains: "envio de mensagem" },
  { key: "follow", contains: "follow up" },
  { key: "retorno", contains: "chamada de retorno" },
];

const QUICK_LINK_KEYWORDS = [
  { key: "tratativa", sourceTerms: ["tratativa", "trativa"], targetTerms: ["tratativa", "trativa"] },
  { key: "buffer", sourceTerms: ["buffer"], targetTerms: ["buffer"] },
  { key: "decisorio", sourceTerms: ["decisorio"], targetTerms: ["decisorio"] },
  { key: "recepcao", sourceTerms: ["recepcao"], targetTerms: ["recepcao"] },
  { key: "gerador", sourceTerms: ["gerador"], targetTerms: ["gerador"] },
  { key: "tools", sourceTerms: ["tools"], targetTerms: ["tools"] },
  { key: "envio", sourceTerms: ["envio"], targetTerms: ["envio"] },
  { key: "follow", sourceTerms: ["follow"], targetTerms: ["follow"] },
  { key: "chamada", sourceTerms: ["chamada"], targetTerms: ["chamada"] },
];

function normalizeLoose(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeRuleToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeServerUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function getActiveRulesForWorkflowName(workflowName) {
  const normalizedName = normalizeRuleToken(workflowName);
  if (!normalizedName) return [];

  return WORKFLOW_NODE_RULES.filter((rule) =>
    normalizedName.includes(normalizeRuleToken(rule.workflowNameIncludes))
  );
}

async function api(path, options = {}) {
  const response = await fetch(`/api/workflow-update${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const extra = Array.isArray(json.validationErrors) ? ` ${json.validationErrors.join(" | ")}` : "";
    throw new Error((json.error || `Erro na API (${response.status})`) + extra);
  }

  return json;
}

function SearchableSelect({ label, placeholder, options, value, onChange, disabled = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const selectedOption = useMemo(
    () => options.find((option) => String(option.value) === String(value)) || null,
    [options, value]
  );

  useEffect(() => {
    setQuery(selectedOption?.label || "");
  }, [selectedOption]);

  useEffect(() => {
    function onDocumentClick(event) {
      if (!wrapperRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options.slice(0, 80);
    return options.filter((option) => option.label.toLowerCase().includes(normalized)).slice(0, 80);
  }, [options, query]);

  function handlePick(option) {
    onChange(String(option.value));
    setQuery(option.label);
    setOpen(false);
  }

  return (
    <label>
      {label}
      <div className={`autocomplete ${disabled ? "disabled" : ""}`} ref={wrapperRef}>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const exact =
                filteredOptions.find(
                  (option) => option.label.trim().toLowerCase() === query.trim().toLowerCase()
                ) || filteredOptions[0];
              if (exact) handlePick(exact);
            }
          }}
          placeholder={placeholder || "Pesquisar..."}
          disabled={disabled}
        />

        {open && !disabled ? (
          <div className="autocomplete-menu">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`autocomplete-option ${
                    String(option.value) === String(value) ? "selected" : ""
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handlePick(option)}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <div className="autocomplete-empty">Nenhum resultado encontrado.</div>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function App() {
  const [clients, setClients] = useState([]);
  const [sourceWorkflows, setSourceWorkflows] = useState([]);
  const [targetWorkflows, setTargetWorkflows] = useState([]);

  const [selectedSourceClientId, setSelectedSourceClientId] = useState("");
  const [selectedTargetClientId, setSelectedTargetClientId] = useState("");

  const [sourceWorkflowPickerId, setSourceWorkflowPickerId] = useState("");
  const [targetWorkflowPickerId, setTargetWorkflowPickerId] = useState("");

  const [selectedSourceWorkflowIds, setSelectedSourceWorkflowIds] = useState([]);
  const [selectedTargetWorkflowIds, setSelectedTargetWorkflowIds] = useState([]);
  const [sourceTemplateEnabled, setSourceTemplateEnabled] = useState(false);
  const [sourceClientNameFilterEnabled, setSourceClientNameFilterEnabled] = useState(false);
  const [targetClientNameFilterEnabled, setTargetClientNameFilterEnabled] = useState(false);

  const [linkSourceWorkflowId, setLinkSourceWorkflowId] = useState("");
  const [linkTargetWorkflowId, setLinkTargetWorkflowId] = useState("");
  const [workflowLinks, setWorkflowLinks] = useState([]);

  const [batchResults, setBatchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  useEffect(() => {
    loadClients();
  }, []);

  async function loadClients() {
    setLoading(true);
    try {
      const data = await api("/clients");
      setClients(data.clients || []);
      setStatus({ type: "success", message: `Clientes carregados: ${(data.clients || []).length}` });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function loadWorkflowsByClient(clientId, setter) {
    if (!clientId) {
      setter([]);
      return;
    }

    const data = await api(`/clients/${clientId}/workflows`);
    setter(data.workflows || []);
  }

  async function onSelectSourceClient(clientId) {
    setSelectedSourceClientId(clientId);
    setSourceWorkflowPickerId("");
    setSelectedSourceWorkflowIds([]);
    setSourceTemplateEnabled(false);
    setSourceClientNameFilterEnabled(false);
    setLinkSourceWorkflowId("");
    setWorkflowLinks([]);
    setBatchResults([]);

    setLoading(true);
    try {
      await loadWorkflowsByClient(clientId, setSourceWorkflows);
      setStatus({ type: "success", message: "Workflows do cliente origem carregados." });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
      setSourceWorkflows([]);
    } finally {
      setLoading(false);
    }
  }

  async function onSelectTargetClient(clientId) {
    setSelectedTargetClientId(clientId);
    setTargetWorkflowPickerId("");
    setSelectedTargetWorkflowIds([]);
    setTargetClientNameFilterEnabled(false);
    setLinkTargetWorkflowId("");
    setWorkflowLinks([]);
    setBatchResults([]);

    setLoading(true);
    try {
      await loadWorkflowsByClient(clientId, setTargetWorkflows);
      setStatus({ type: "success", message: "Workflows do cliente destino carregados." });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
      setTargetWorkflows([]);
    } finally {
      setLoading(false);
    }
  }

  function addUniqueWorkflow(setter, workflowId) {
    if (!workflowId) return;
    setter((current) => (current.includes(workflowId) ? current : [...current, workflowId]));
  }

  function selectAllFilteredWorkflows(setter, filteredWorkflows) {
    const ids = filteredWorkflows.map((workflow) => String(workflow.id));
    setter(ids);
  }

  function removeSourceWorkflow(workflowId) {
    setSelectedSourceWorkflowIds((current) => current.filter((id) => id !== workflowId));
    setWorkflowLinks((current) =>
      current.filter((item) => String(item.sourceWorkflowId) !== String(workflowId))
    );
  }

  function removeTargetWorkflow(workflowId) {
    setSelectedTargetWorkflowIds((current) => current.filter((id) => id !== workflowId));
    setWorkflowLinks((current) =>
      current.filter((item) => String(item.targetWorkflowId) !== String(workflowId))
    );
  }

  function addWorkflowLink() {
    if (!linkSourceWorkflowId || !linkTargetWorkflowId) {
      setStatus({ type: "error", message: "Selecione origem e destino para criar o vínculo." });
      return;
    }

    if (!selectedSourceWorkflowIds.includes(linkSourceWorkflowId)) {
      setStatus({ type: "error", message: "Workflow origem do vínculo não está na lista selecionada." });
      return;
    }

    if (!selectedTargetWorkflowIds.includes(linkTargetWorkflowId)) {
      setStatus({ type: "error", message: "Workflow destino do vínculo não está na lista selecionada." });
      return;
    }

    const duplicatePair = workflowLinks.some(
      (item) =>
        String(item.sourceWorkflowId) === String(linkSourceWorkflowId) &&
        String(item.targetWorkflowId) === String(linkTargetWorkflowId)
    );

    if (duplicatePair) {
      setStatus({ type: "error", message: "Esse vínculo já foi adicionado." });
      return;
    }

    const targetAlreadyLinked = workflowLinks.some(
      (item) => String(item.targetWorkflowId) === String(linkTargetWorkflowId)
    );

    if (targetAlreadyLinked) {
      setStatus({
        type: "error",
        message: "Esse workflow de destino já está vinculado. Remova o vínculo atual para trocar.",
      });
      return;
    }

    setWorkflowLinks((current) => [
      ...current,
      { sourceWorkflowId: linkSourceWorkflowId, targetWorkflowId: linkTargetWorkflowId },
    ]);
    setStatus({ type: "success", message: "Vínculo adicionado." });
  }

  function applyQuickWorkflowLinks() {
    if (selectedSourceWorkflowIds.length === 0 || selectedTargetWorkflowIds.length === 0) {
      setStatus({
        type: "error",
        message: "Selecione workflows de origem e destino antes da vinculação rápida.",
      });
      return;
    }

    const sourceCandidates = selectedSourceWorkflowIds.map((id) => ({
      id: String(id),
      name: sourceWorkflowMap.get(String(id)) || String(id),
      normalized: normalizeLoose(sourceWorkflowMap.get(String(id)) || String(id)),
    }));
    const targetCandidates = selectedTargetWorkflowIds.map((id) => ({
      id: String(id),
      name: targetWorkflowMap.get(String(id)) || String(id),
      normalized: normalizeLoose(targetWorkflowMap.get(String(id)) || String(id)),
    }));

    const usedSource = new Set();
    const usedTarget = new Set();
    const links = [];
    const missing = [];

    for (const rule of QUICK_LINK_KEYWORDS) {
      const source = sourceCandidates.find((item) => {
        if (usedSource.has(item.id)) return false;
        return rule.sourceTerms.some((term) => item.normalized.includes(normalizeLoose(term)));
      });
      const target = targetCandidates.find((item) => {
        if (usedTarget.has(item.id)) return false;
        return rule.targetTerms.some((term) => item.normalized.includes(normalizeLoose(term)));
      });

      if (!source || !target) {
        missing.push(rule.key);
        continue;
      }

      usedSource.add(source.id);
      usedTarget.add(target.id);
      links.push({
        sourceWorkflowId: source.id,
        targetWorkflowId: target.id,
      });
    }

    setWorkflowLinks(links);
    setLinkSourceWorkflowId("");
    setLinkTargetWorkflowId("");

    if (links.length === 0) {
      setStatus({
        type: "error",
        message: "Nenhum vínculo automático foi encontrado pelos padrões de nome.",
      });
      return;
    }

    if (missing.length > 0) {
      setStatus({
        type: "error",
        message: `Vinculação rápida parcial: ${links.length}/${QUICK_LINK_KEYWORDS.length}. Não encontrados: ${missing.join(", ")}.`,
      });
      return;
    }

    setStatus({
      type: "success",
      message: `Vinculação rápida concluída com sucesso: ${links.length} vínculo(s).`,
    });
  }

  async function saveFullWorkflowBatch() {
    if (!selectedSourceClientId || !selectedTargetClientId) {
      setStatus({ type: "error", message: "Selecione cliente origem e cliente destino." });
      return;
    }

    if (workflowLinks.length === 0) {
      setStatus({ type: "error", message: "Adicione pelo menos um vínculo origem -> destino." });
      return;
    }

    const targetServerUrl = normalizeServerUrl(selectedTargetClient?.n8n_url);
    let targetTab = null;
    if (targetServerUrl) {
      targetTab = window.open("", "_blank", "noopener,noreferrer");
    }

    setLoading(true);
    setBatchResults([]);
    setStatus({
      type: "info",
      message: `Atualização em andamento... 0/${workflowLinks.length} workflow(s) processados.`,
    });
    try {
      const sourceMap = new Map(sourceWorkflows.map((item) => [String(item.id), item.name]));
      const targetMap = new Map(targetWorkflows.map((item) => [String(item.id), item.name]));
      const sourcePayloadCache = new Map();
      const results = [];

      for (const link of workflowLinks) {
        if (!sourcePayloadCache.has(link.sourceWorkflowId)) {
          const sourceData = await api(
            `/clients/${selectedSourceClientId}/workflows/${link.sourceWorkflowId}`
          );
          sourcePayloadCache.set(link.sourceWorkflowId, sourceData.workflow?.data);
        }

        const proposedWorkflow = sourcePayloadCache.get(link.sourceWorkflowId);
        const saveData = await api(
          `/clients/${selectedTargetClientId}/workflows/${link.targetWorkflowId}/save-full`,
          {
            method: "POST",
            body: JSON.stringify({ proposedWorkflow }),
          }
        );

        results.push({
          sourceName: sourceMap.get(String(link.sourceWorkflowId)) || link.sourceWorkflowId,
          targetName: targetMap.get(String(link.targetWorkflowId)) || link.targetWorkflowId,
          credentialsPreserved: saveData.preserveStats?.credentialsPreserved || 0,
          credentialsInheritedByType: saveData.preserveStats?.credentialsInheritedByType || 0,
          backupFolder: saveData.backupFolder,
        });

        setStatus({
          type: "info",
          message: `Atualização em andamento... ${results.length}/${workflowLinks.length} workflow(s) processados.`,
        });
      }

      setBatchResults(results);
      let openedTargetServer = false;
      if (targetServerUrl && targetTab && !targetTab.closed) {
        targetTab.location.href = targetServerUrl;
        openedTargetServer = true;
      } else if (targetServerUrl) {
        const opened = window.open(targetServerUrl, "_blank", "noopener,noreferrer");
        openedTargetServer = Boolean(opened);
      }
      setStatus({
        type: "success",
        message: openedTargetServer
          ? `Lote concluído com sucesso. Atualizados: ${results.length} workflow(s). Servidor aberto em nova guia.`
          : targetServerUrl
          ? `Lote concluído com sucesso. Atualizados: ${results.length} workflow(s). O navegador bloqueou a nova guia.`
          : `Lote concluído com sucesso. Atualizados: ${results.length} workflow(s).`,
      });
    } catch (error) {
      if (targetTab && !targetTab.closed) {
        targetTab.close();
      }
      setStatus({ type: "error", message: error.message });
    } finally {
      setLoading(false);
    }
  }

  const selectedSourceClient = useMemo(
    () => clients.find((item) => String(item.id) === String(selectedSourceClientId)) || null,
    [clients, selectedSourceClientId]
  );

  const isBaseSinteseSource = useMemo(
    () => String(selectedSourceClient?.nome || "").trim().toLowerCase() === "base sintese",
    [selectedSourceClient]
  );

  const selectedTargetClient = useMemo(
    () => clients.find((item) => String(item.id) === String(selectedTargetClientId)) || null,
    [clients, selectedTargetClientId]
  );

  const clientOptions = useMemo(
    () => clients.map((client) => ({ value: client.id, label: client.nome })),
    [clients]
  );

  const sourceFilteredWorkflows = useMemo(() => {
    if (!sourceClientNameFilterEnabled || !selectedSourceClient?.nome) {
      return sourceWorkflows;
    }

    const needle = normalizeLoose(selectedSourceClient.nome);
    return sourceWorkflows.filter((workflow) =>
      normalizeLoose(workflow?.name).includes(needle)
    );
  }, [sourceClientNameFilterEnabled, selectedSourceClient, sourceWorkflows]);

  const targetFilteredWorkflows = useMemo(() => {
    if (!targetClientNameFilterEnabled || !selectedTargetClient?.nome) {
      return targetWorkflows;
    }

    const needle = normalizeLoose(selectedTargetClient.nome);
    return targetWorkflows.filter((workflow) =>
      normalizeLoose(workflow?.name).includes(needle)
    );
  }, [targetClientNameFilterEnabled, selectedTargetClient, targetWorkflows]);

  const sourceWorkflowOptions = useMemo(
    () => sourceFilteredWorkflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
    [sourceFilteredWorkflows]
  );

  const targetWorkflowOptions = useMemo(
    () => targetFilteredWorkflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
    [targetFilteredWorkflows]
  );

  const sourceWorkflowMap = useMemo(
    () => new Map(sourceWorkflows.map((item) => [String(item.id), item.name])),
    [sourceWorkflows]
  );

  const targetWorkflowMap = useMemo(
    () => new Map(targetWorkflows.map((item) => [String(item.id), item.name])),
    [targetWorkflows]
  );

  const linkSourceOptions = useMemo(
    () =>
      selectedSourceWorkflowIds.map((id) => ({
        value: id,
        label: sourceWorkflowMap.get(String(id)) || String(id),
      })),
    [selectedSourceWorkflowIds, sourceWorkflowMap]
  );

  const linkTargetOptions = useMemo(
    () =>
      selectedTargetWorkflowIds.map((id) => ({
        value: id,
        label: targetWorkflowMap.get(String(id)) || String(id),
      })),
    [selectedTargetWorkflowIds, targetWorkflowMap]
  );

  const activeRulesByLinkedTarget = useMemo(() => {
    if (workflowLinks.length === 0) return [];

    const seen = new Set();
    const targets = [];

    for (const link of workflowLinks) {
      const targetId = String(link.targetWorkflowId || "");
      if (!targetId || seen.has(targetId)) continue;
      seen.add(targetId);
      targets.push(targetId);
    }

    return targets
      .map((targetId) => {
        const targetName = targetWorkflowMap.get(targetId) || targetId;
        const rules = getActiveRulesForWorkflowName(targetName);
        return { targetId, targetName, rules };
      })
      .filter((item) => item.rules.length > 0);
  }, [workflowLinks, targetWorkflowMap]);

  function selectAllTargetByClientName() {
    if (!selectedTargetClient?.nome) {
      setStatus({ type: "error", message: "Selecione um cliente destino primeiro." });
      return;
    }

    const needle = normalizeLoose(selectedTargetClient.nome);
    const matches = targetWorkflows.filter((workflow) =>
      normalizeLoose(workflow?.name).includes(needle)
    );

    const ids = matches.map((workflow) => String(workflow.id));
    setTargetClientNameFilterEnabled(true);
    setSelectedTargetWorkflowIds(ids);
    setWorkflowLinks((current) =>
      current.filter((item) => ids.includes(String(item.targetWorkflowId)))
    );

    if (ids.length === 0) {
      setStatus({
        type: "error",
        message: `Nenhum workflow de destino encontrado contendo o nome do cliente "${selectedTargetClient.nome}".`,
      });
      return;
    }

    setStatus({
      type: "success",
      message: `Selecionados ${ids.length} workflow(s) de destino pelo nome do cliente.`,
    });
  }

  function applyBaseTemplateSelection() {
    const selectedByRule = new Map();
    const missingRules = [];

    for (const rule of BASE_SINTESE_TEMPLATE_RULES) {
      const matches = sourceWorkflows.filter((workflow) => {
        const normalizedName = normalizeLoose(workflow.name);
        return (
          normalizedName.includes(normalizeLoose(rule.contains)) &&
          normalizedName.includes("crm novo") &&
          normalizedName.includes("garagem")
        );
      });

      if (matches.length === 0) {
        missingRules.push(rule.contains);
        continue;
      }

      const chosen = matches.reduce((best, candidate) => {
        const bestTs = best?.updatedAt ? Date.parse(best.updatedAt) : 0;
        const candidateTs = candidate?.updatedAt ? Date.parse(candidate.updatedAt) : 0;
        return candidateTs >= bestTs ? candidate : best;
      }, matches[0]);

      selectedByRule.set(rule.key, chosen);
    }

    const ids = [...selectedByRule.values()].map((workflow) => String(workflow.id));

    setSelectedSourceWorkflowIds(ids);
    setWorkflowLinks([]);
    setLinkSourceWorkflowId("");

    if (missingRules.length > 0) {
      setStatus({
        type: "error",
        message: `Template Base Sintese ativado parcialmente (${ids.length}/9). Não encontrados: ${missingRules.join(", ")}.`,
      });
      return;
    }

    setStatus({
      type: "success",
      message: `Template Base Sintese ativado. Fluxos origem selecionados: ${ids.length}/9.`,
    });
  }

  function toggleSourceTemplate() {
    if (!isBaseSinteseSource) {
      return;
    }

    if (!sourceTemplateEnabled) {
      applyBaseTemplateSelection();
      setSourceTemplateEnabled(true);
      return;
    }

    setSourceTemplateEnabled(false);
    setSelectedSourceWorkflowIds([]);
    setWorkflowLinks([]);
    setLinkSourceWorkflowId("");
    setStatus({ type: "success", message: "Template Base Sintese desativado." });
  }

  useEffect(() => {
    if (!sourceTemplateEnabled || !isBaseSinteseSource) {
      return;
    }

    applyBaseTemplateSelection();
  }, [sourceTemplateEnabled, isBaseSinteseSource, sourceWorkflows]);

  return (
    <main className="container">
      <h1>Atualização Completa de Workflow n8n</h1>
      <p className="subtitle">Atualização em lote com vínculo manual origem -&gt; destino.</p>

      <section className="card">
        <div className="grid">
          <SearchableSelect
            label="Cliente origem (fonte do novo fluxo)"
            placeholder="Pesquisar cliente origem..."
            options={clientOptions}
            value={selectedSourceClientId}
            onChange={onSelectSourceClient}
          />

          <div>
            <SearchableSelect
              label="Workflow origem (adicione vários)"
              placeholder="Pesquisar e selecionar workflow origem..."
              options={sourceWorkflowOptions}
              value={sourceWorkflowPickerId}
              onChange={setSourceWorkflowPickerId}
              disabled={!selectedSourceClientId}
            />
            <div className="row" style={{ marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => addUniqueWorkflow(setSelectedSourceWorkflowIds, sourceWorkflowPickerId)}
                disabled={!sourceWorkflowPickerId}
              >
                Adicionar origem
              </button>
              <button
                type="button"
                onClick={() =>
                  selectAllFilteredWorkflows(setSelectedSourceWorkflowIds, sourceFilteredWorkflows)
                }
                disabled={sourceFilteredWorkflows.length === 0}
              >
                Selecionar filtrados
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedSourceWorkflowIds([]);
                  setWorkflowLinks([]);
                }}
                disabled={selectedSourceWorkflowIds.length === 0}
              >
                Limpar
              </button>
              {isBaseSinteseSource ? (
                <button type="button" className={sourceTemplateEnabled ? "primary" : ""} onClick={toggleSourceTemplate}>
                  {sourceTemplateEnabled ? "Desativar template" : "Ativar template"}
                </button>
              ) : null}
              {selectedSourceClient ? (
                <button
                  type="button"
                  className={sourceClientNameFilterEnabled ? "primary" : ""}
                  onClick={() =>
                    setSourceClientNameFilterEnabled((current) => !current)
                  }
                >
                  {sourceClientNameFilterEnabled ? "Mostrar todos" : "Filtrar por cliente"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="kpis" style={{ marginTop: "12px" }}>
          <span className="kpi">Workflows origem disponíveis: {sourceWorkflows.length}</span>
          <span className="kpi">Filtrados origem: {sourceFilteredWorkflows.length}</span>
          <span className="kpi">Selecionados origem: {selectedSourceWorkflowIds.length}</span>
          <span className="kpi">Cliente origem: {selectedSourceClient ? selectedSourceClient.nome : "-"}</span>
        </div>

        {selectedSourceWorkflowIds.length > 0 ? (
          <div className="selected-list" style={{ marginTop: "10px" }}>
            {selectedSourceWorkflowIds.map((workflowId) => (
              <span key={workflowId} className="selected-chip">
                {sourceWorkflowMap.get(String(workflowId)) || workflowId}
                <button type="button" onClick={() => removeSourceWorkflow(workflowId)}>
                  x
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="grid">
          <SearchableSelect
            label="Cliente destino (vai receber update)"
            placeholder="Pesquisar cliente destino..."
            options={clientOptions}
            value={selectedTargetClientId}
            onChange={onSelectTargetClient}
          />

          <div>
            <SearchableSelect
              label="Workflow destino (adicione vários)"
              placeholder="Pesquisar e selecionar workflow destino..."
              options={targetWorkflowOptions}
              value={targetWorkflowPickerId}
              onChange={setTargetWorkflowPickerId}
              disabled={!selectedTargetClientId}
            />
            <div className="row" style={{ marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => addUniqueWorkflow(setSelectedTargetWorkflowIds, targetWorkflowPickerId)}
                disabled={!targetWorkflowPickerId}
              >
                Adicionar destino
              </button>
              <button
                type="button"
                onClick={() =>
                  selectAllFilteredWorkflows(setSelectedTargetWorkflowIds, targetFilteredWorkflows)
                }
                disabled={targetFilteredWorkflows.length === 0}
              >
                Selecionar filtrados
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedTargetWorkflowIds([]);
                  setWorkflowLinks([]);
                }}
                disabled={selectedTargetWorkflowIds.length === 0}
              >
                Limpar
              </button>
              {selectedTargetClient ? (
                <button
                  type="button"
                  className={targetClientNameFilterEnabled ? "primary" : ""}
                  onClick={() =>
                    setTargetClientNameFilterEnabled((current) => !current)
                  }
                >
                  {targetClientNameFilterEnabled ? "Mostrar todos" : "Filtrar por cliente"}
                </button>
              ) : null}
              {selectedTargetClient ? (
                <button
                  type="button"
                  className="primary"
                  onClick={selectAllTargetByClientName}
                >
                  Selecionar por cliente
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="kpis" style={{ marginTop: "12px" }}>
          <span className="kpi">Workflows destino disponíveis: {targetWorkflows.length}</span>
          <span className="kpi">Filtrados destino: {targetFilteredWorkflows.length}</span>
          <span className="kpi">Selecionados destino: {selectedTargetWorkflowIds.length}</span>
          <span className="kpi">Cliente destino: {selectedTargetClient ? selectedTargetClient.nome : "-"}</span>
        </div>

        {selectedTargetWorkflowIds.length > 0 ? (
          <div className="selected-list" style={{ marginTop: "10px" }}>
            {selectedTargetWorkflowIds.map((workflowId) => (
              <span key={workflowId} className="selected-chip">
                {targetWorkflowMap.get(String(workflowId)) || workflowId}
                <button type="button" onClick={() => removeTargetWorkflow(workflowId)}>
                  x
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="grid">
          <SearchableSelect
            label="Vincular origem"
            placeholder="Escolha workflow origem da lista..."
            options={linkSourceOptions}
            value={linkSourceWorkflowId}
            onChange={setLinkSourceWorkflowId}
            disabled={selectedSourceWorkflowIds.length === 0}
          />

          <SearchableSelect
            label="Vincular destino"
            placeholder="Escolha workflow destino da lista..."
            options={linkTargetOptions}
            value={linkTargetWorkflowId}
            onChange={setLinkTargetWorkflowId}
            disabled={selectedTargetWorkflowIds.length === 0}
          />
        </div>

        <div className="row" style={{ marginTop: "10px" }}>
          <button type="button" className="primary" onClick={addWorkflowLink} disabled={!linkSourceWorkflowId || !linkTargetWorkflowId}>
            Adicionar vínculo
          </button>
          <button
            type="button"
            onClick={applyQuickWorkflowLinks}
            disabled={selectedSourceWorkflowIds.length === 0 || selectedTargetWorkflowIds.length === 0}
          >
            Vinculação rápida
          </button>
          <button type="button" onClick={() => setWorkflowLinks([])} disabled={workflowLinks.length === 0}>
            Limpar vínculos
          </button>
        </div>

        <div className="kpis" style={{ marginTop: "12px" }}>
          <span className="kpi">Vínculos criados: {workflowLinks.length}</span>
        </div>

        {workflowLinks.length > 0 ? (
          <div className="pair-list">
            {workflowLinks.map((item, index) => (
              <div key={`${item.sourceWorkflowId}-${item.targetWorkflowId}-${index}`} className="pair-item">
                <div className="pair-field">
                  {sourceWorkflowMap.get(String(item.sourceWorkflowId)) || item.sourceWorkflowId}
                </div>
                <div className="pair-arrow">-&gt;</div>
                <div className="pair-field">
                  {targetWorkflowMap.get(String(item.targetWorkflowId)) || item.targetWorkflowId}
                </div>
                <button
                  type="button"
                  className="pair-remove"
                  onClick={() =>
                    setWorkflowLinks((current) => current.filter((_, idx) => idx !== index))
                  }
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="hint" style={{ marginTop: "10px" }}>
            Crie os vínculos para controlar exatamente qual origem vai para qual destino.
          </div>
        )}

        {workflowLinks.length > 0 ? (
          <div className="rule-box">
            <strong>Regras ativas nos vínculos atuais</strong>
            {activeRulesByLinkedTarget.length > 0 ? (
              <div className="rule-list">
                {activeRulesByLinkedTarget.map((targetRuleGroup) => (
                  <div key={targetRuleGroup.targetId}>
                    <div className="rule-subtitle">{targetRuleGroup.targetName}</div>
                    {targetRuleGroup.rules.map((rule, index) => (
                      <div key={`${targetRuleGroup.targetId}-${rule.workflowNameIncludes}-${index}`} className="rule-item">
                        <span className="rule-when">
                          Se o nome contiver "{rule.workflowNameIncludes}"
                        </span>
                        <span className="rule-then">
                          {rule.nodeNames.join(", ")} - {rule.description}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="hint" style={{ marginTop: "8px" }}>
                Nenhuma regra especial ativa nos workflows de destino vinculados.
              </div>
            )}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Ação direta em lote</strong>
          <button
            onClick={saveFullWorkflowBatch}
            className="danger"
            disabled={loading || workflowLinks.length === 0}
          >
            {loading ? "Atualizando..." : "Atualizar fluxos vinculados"}
          </button>
        </div>

        {loading ? (
          <div className="loading-inline" aria-live="polite">
            <span className="loading-spinner" />
            Executando atualização dos fluxos. Aguarde...
          </div>
        ) : null}

        <p className="hint" style={{ marginTop: "10px" }}>
          Regras de preservação continuam ativas: nome/status do destino, credenciais do destino e exceções por nome de workflow/node.
        </p>

        {batchResults.length > 0 ? (
          <div className="result-list">
            {batchResults.map((item, index) => (
              <div key={`${item.targetName}-${index}`} className="result-item">
                {item.sourceName} -&gt; {item.targetName} | credenciais preservadas: {item.credentialsPreserved} | herança por tipo: {item.credentialsInheritedByType}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <p className={`status ${status.type}`}>{status.message}</p>
    </main>
  );
}

const root = ReactDOM.createRoot(document.getElementById("app"));
root.render(<App />);
