const state = {
  clients: [],
  workflows: [],
  scriptTypes: [],
  items: [],
  drafts: {},
  itemsByScriptName: {},
  reviewByScriptName: {},
  currentIndex: 0,
  scriptQueue: [],
  scriptQueueIndex: 0,
  selectedClient: null,
  selectedWorkflow: null,
  globalSearchQuery: "",
};

const nodeAgentMap = {
  Dados: "Agent descoberta",
  Dados2: "Agent solucao",
  Dados4: "Agent fechamento",
  Dados9: "Agent duvida",
  Dados8: "Agent duvida1",
  Dados5: "Agent objecoes",
  Dados7: "Agent objecoes1",
};

const el = {
  screenSelect: document.querySelector("#screen-select"),
  screenEditor: document.querySelector("#screen-editor"),
  screenReview: document.querySelector("#screen-review"),
  status: document.querySelector("#status"),
  currentClientName: document.querySelector("#current-client-name"),
  updatedAt: document.querySelector("#updated-at"),
  syncBtn: document.querySelector("#sync-btn"),
  refreshBtn: document.querySelector("#refresh-btn"),
  kpiClients: document.querySelector("#kpi-clients"),
  kpiWorkflows: document.querySelector("#kpi-workflows"),
  kpiScriptTypes: document.querySelector("#kpi-script-types"),
  kpiSelectedTypes: document.querySelector("#kpi-selected-types"),

  clientSelect: document.querySelector("#client-select"),
  workflowSelect: document.querySelector("#workflow-select"),
  scriptTypeList: document.querySelector("#script-type-list"),

  startEditor: document.querySelector("#start-editor"),

  editorMeta: document.querySelector("#editor-meta"),
  scriptEditor: document.querySelector("#script-editor"),
  scriptEditorHighlight: document.querySelector("#script-editor-highlight"),
  shortcutSearchInput: document.querySelector("#shortcut-search-input"),
  shortcutSearchBtn: document.querySelector("#shortcut-search-btn"),
  headingShortcuts: document.querySelector("#heading-shortcuts"),
  prevItem: document.querySelector("#prev-item"),
  nextItem: document.querySelector("#next-item"),
  backToSelect: document.querySelector("#back-to-select"),
  goReview: document.querySelector("#go-review"),

  reviewSummary: document.querySelector("#review-summary"),
  reviewList: document.querySelector("#review-list"),
  backToEditor: document.querySelector("#back-to-editor"),
  nextScript: document.querySelector("#next-script"),
  saveChanges: document.querySelector("#save-changes"),
};

function setStatus(message, kind = "") {
  el.status.textContent = message;
  el.status.className = `status ${kind}`.trim();
}

function updateTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  if (el.updatedAt) el.updatedAt.textContent = `Atualizado: ${date}, ${time}`;
}

function renderKpis() {
  if (el.kpiClients) el.kpiClients.textContent = String(state.clients.length);
  if (el.kpiWorkflows) el.kpiWorkflows.textContent = String(state.workflows.length);
  if (el.kpiScriptTypes) el.kpiScriptTypes.textContent = String(state.scriptTypes.length);
  if (el.kpiSelectedTypes) el.kpiSelectedTypes.textContent = String(getSelectedScriptNames().length);
}

function renderGlobalContext() {
  el.currentClientName.textContent = state.selectedClient?.nome || "-";
}

function showScreen(name) {
  const all = [el.screenSelect, el.screenEditor, el.screenReview];
  all.forEach((node) => node.classList.remove("active"));
  if (name === "select") el.screenSelect.classList.add("active");
  if (name === "editor") el.screenEditor.classList.add("active");
  if (name === "review") el.screenReview.classList.add("active");
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Falha na API ${path}`);
  }
  return json;
}

function renderSelectOptions(select, items, labelKey = "name", valueKey = "id", placeholder = "") {
  select.innerHTML = "";

  if (placeholder) {
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    select.appendChild(ph);
  }

  if (!items.length) {
    if (!placeholder) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhum item";
      select.appendChild(opt);
    }
    return;
  }

  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item[valueKey];
    opt.textContent = item[labelKey];
    select.appendChild(opt);
  });
}

function getSelectedScriptNames() {
  return [...el.scriptTypeList.querySelectorAll('input[type=\"checkbox\"]:checked')]
    .map((input) => input.value)
    .filter(Boolean);
}

function renderScriptTypeChecks(items = []) {
  el.scriptTypeList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "script-type-empty";
    empty.textContent = "Nenhum tipo disponível.";
    el.scriptTypeList.appendChild(empty);
    renderKpis();
    return;
  }

  for (const item of items) {
    const label = document.createElement("label");
    label.className = "script-type-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = item.id;

    const span = document.createElement("span");
    span.textContent = item.name;

    label.appendChild(input);
    label.appendChild(span);
    el.scriptTypeList.appendChild(label);
  }
  renderKpis();
}

function formatScriptTypeLabel(rawName, occurrences) {
  let label = String(rawName || "");
  label = label.replace(/^=\s*/g, "");
  label = label.replace(/\{\{\s*\d+\s*\}\}/g, "").trim();
  label = label.replace(/\s{2,}/g, " ");
  return `${label} (${occurrences})`;
}

function formatScriptName(rawName) {
  let label = String(rawName || "");
  label = label.replace(/^=\s*/g, "");
  label = label.replace(/\{\{\s*\d+\s*\}\}/g, "").trim();
  label = label.replace(/\s{2,}/g, " ");
  return label;
}

function getCurrentScriptName() {
  return state.scriptQueue[state.scriptQueueIndex] || "";
}

function hasNextScript() {
  return state.scriptQueueIndex < state.scriptQueue.length - 1;
}

function clearSelectionState() {
  state.workflows = [];
  state.scriptTypes = [];
  state.items = [];
  state.drafts = {};
  state.itemsByScriptName = {};
  state.reviewByScriptName = {};
  state.currentIndex = 0;
  state.scriptQueue = [];
  state.scriptQueueIndex = 0;
  state.selectedWorkflow = null;

  renderSelectOptions(el.workflowSelect, [], "name", "id", "Selecione um cliente primeiro");
  renderScriptTypeChecks([]);
  renderKpis();
}

function getCurrentItem() {
  return state.items[state.currentIndex] || null;
}

function getDraftValue(item) {
  if (!item) return "";
  return state.drafts[item.itemId] ?? item.originalValue;
}

function saveCurrentDraft() {
  const item = getCurrentItem();
  if (!item) return;
  state.drafts[item.itemId] = el.scriptEditor.value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightExpressionsToHtml(text) {
  const source = String(text ?? "");
  let i = 0;
  let out = "";

  while (i < source.length) {
    const openAt = source.indexOf("{{", i);
    if (openAt === -1) {
      out += escapeHtml(source.slice(i));
      break;
    }

    out += escapeHtml(source.slice(i, openAt));

    const closeAt = source.indexOf("}}", openAt + 2);
    const nextOpenAt = source.indexOf("{{", openAt + 2);
    const hasValidClose = closeAt !== -1 && (nextOpenAt === -1 || closeAt < nextOpenAt);

    if (!hasValidClose) {
      out += escapeHtml(source.slice(openAt, openAt + 2));
      i = openAt + 2;
      continue;
    }

    const expression = source.slice(openAt, closeAt + 2);
    out += `<span class="expr-highlight">${escapeHtml(expression)}</span>`;
    i = closeAt + 2;
  }

  return out;
}

function createLineExpressionHighlighter() {
  const localState = { inExpression: false };

  return function highlightLine(lineText) {
    const source = String(lineText ?? "");
    let i = 0;
    let out = "";

    while (i < source.length) {
      if (localState.inExpression) {
        const closeAt = source.indexOf("}}", i);
        if (closeAt === -1) {
          out += `<span class="expr-highlight">${escapeHtml(source.slice(i))}</span>`;
          i = source.length;
          continue;
        }
        out += `<span class="expr-highlight">${escapeHtml(source.slice(i, closeAt + 2))}</span>`;
        localState.inExpression = false;
        i = closeAt + 2;
        continue;
      }

      const openAt = source.indexOf("{{", i);
      if (openAt === -1) {
        out += escapeHtml(source.slice(i));
        break;
      }

      out += escapeHtml(source.slice(i, openAt));

      const closeAt = source.indexOf("}}", openAt + 2);
      const nextOpenAt = source.indexOf("{{", openAt + 2);
      const hasValidClose = closeAt !== -1 && (nextOpenAt === -1 || closeAt < nextOpenAt);

      if (hasValidClose) {
        out += `<span class="expr-highlight">${escapeHtml(source.slice(openAt, closeAt + 2))}</span>`;
        i = closeAt + 2;
        continue;
      }

      if (closeAt === -1 && nextOpenAt === -1) {
        out += `<span class="expr-highlight">${escapeHtml(source.slice(openAt))}</span>`;
        localState.inExpression = true;
        i = source.length;
        continue;
      }

      out += escapeHtml(source.slice(openAt, openAt + 2));
      i = openAt + 2;
    }

    return out || " ";
  };
}

function renderScriptPreview(text) {
  el.scriptEditorHighlight.innerHTML = highlightExpressionsToHtml(text);
}

function extractHeadings(scriptText) {
  const lines = String(scriptText ?? "").split("\n");
  const headings = [];
  let cursor = 0;

  for (const line of lines) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) {
      headings.push({
        level: 1,
        text: match[1],
        charIndex: cursor,
      });
    }
    cursor += line.length + 1;
  }

  return headings;
}

function jumpToCharIndex(index) {
  const pos = Math.max(0, Number(index || 0));
  el.scriptEditor.focus();
  el.scriptEditor.setSelectionRange(pos, pos);
}

function runGlobalSearchInCurrentScript() {
  const query = String(state.globalSearchQuery || "").trim();
  if (!query) {
    setStatus("Digite um termo para pesquisar no script.", "error");
    return;
  }

  const content = el.scriptEditor.value || "";
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const foundAt = lowerContent.indexOf(lowerQuery);

  if (foundAt === -1) {
    setStatus(`Trecho não encontrado neste script: "${query}"`, "error");
    return;
  }

  el.scriptEditor.focus();
  el.scriptEditor.setSelectionRange(foundAt, foundAt + query.length);
  setStatus(`Trecho encontrado: "${query}"`, "ok");
}

function renderHeadingShortcuts(text) {
  if (!el.headingShortcuts) return;
  const headings = extractHeadings(text);
  el.headingShortcuts.innerHTML = "";

  if (!headings.length) {
    const empty = document.createElement("div");
    empty.className = "heading-empty";
    empty.textContent = "Sem títulos com # neste script.";
    el.headingShortcuts.appendChild(empty);
    return;
  }

  for (const heading of headings) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `heading-shortcut level-${heading.level}`;
    btn.textContent = heading.text;
    btn.addEventListener("click", () => jumpToCharIndex(heading.charIndex));
    el.headingShortcuts.appendChild(btn);
  }
}

function syncEditorScroll() {
  el.scriptEditorHighlight.scrollTop = el.scriptEditor.scrollTop;
  el.scriptEditorHighlight.scrollLeft = el.scriptEditor.scrollLeft;
}

function renderEditorPage() {
  const item = getCurrentItem();
  if (!item) {
    setStatus("Nenhum item carregado para editar.", "error");
    return;
  }

  const total = state.items.length;
  const index = state.currentIndex + 1;
  const agentName = nodeAgentMap[item.nodeName] || "-";
  const currentScriptName = getCurrentScriptName();
  const formattedCurrentScript = formatScriptName(currentScriptName);
  const formattedField = formatScriptName(item.assignmentName);

  el.editorMeta.innerHTML = `
    <strong>Cliente:</strong> ${state.selectedClient?.nome || "-"}<br>
    <strong>Workflow:</strong> ${state.selectedWorkflow?.name || "-"}<br>
    <strong>Tipo de script:</strong> ${formattedCurrentScript} (${state.scriptQueueIndex + 1} de ${state.scriptQueue.length})<br>
    <strong>Node:</strong> ${item.nodeName}<br>
    <strong>Agente:</strong> ${agentName}<br>
    <strong>Campo:</strong> ${formattedField}<br>
    <strong>Posição:</strong> ${index} de ${total}
  `;

  el.scriptEditor.value = getDraftValue(item);
  if (el.shortcutSearchInput) {
    el.shortcutSearchInput.value = state.globalSearchQuery;
  }
  renderScriptPreview(el.scriptEditor.value);
  renderHeadingShortcuts(el.scriptEditor.value);
  syncEditorScroll();
  el.prevItem.disabled = state.currentIndex === 0;
  el.nextItem.disabled = state.currentIndex >= total - 1;
}

function buildEditsForItems(items) {
  return items
    .map((item) => {
      const editedValue = state.drafts[item.itemId];
      if (editedValue === undefined) return null;
      if (editedValue === item.originalValue) return null;
      return {
        itemId: item.itemId,
        editedValue,
      };
    })
    .filter(Boolean);
}

function updateReviewButtons() {
  const next = hasNextScript();
  el.nextScript.style.display = next ? "inline-flex" : "none";
  el.saveChanges.style.display = next ? "none" : "inline-flex";
  el.saveChanges.disabled = false;
  el.saveChanges.textContent = "Confirmar e salvar tudo";
}

function renderReview(changes, scriptName) {
  el.reviewList.innerHTML = "";
  const currentPos = state.scriptQueueIndex + 1;
  const formattedScriptName = formatScriptName(scriptName);
  el.reviewSummary.textContent = `Revisando script ${currentPos} de ${state.scriptQueue.length}: ${formattedScriptName}. Alterados: ${changes.length}.`;

  if (!changes.length) {
    const empty = document.createElement("article");
    empty.className = "review-card";
    empty.innerHTML = `<div class="review-head">Sem alterações neste tipo de script</div>`;
    el.reviewList.appendChild(empty);
    updateReviewButtons();
    return;
  }

  for (const change of changes) {
    const card = document.createElement("article");
    card.className = "review-card";

    const head = document.createElement("div");
    head.className = "review-head";
    head.innerHTML = highlightExpressionsToHtml(`${change.nodeName} | ${formatScriptName(change.assignmentName)}`);

    const diffGrid = document.createElement("div");
    diffGrid.className = "side-by-side";

    const oldCol = document.createElement("div");
    oldCol.className = "side-col";
    oldCol.innerHTML = `<div class="side-title">Script antigo</div>`;

    const newCol = document.createElement("div");
    newCol.className = "side-col";
    newCol.innerHTML = `<div class="side-title">Script novo</div>`;

    const rows = Array.isArray(change.sideBySide) ? change.sideBySide : [];
    const highlightOldLine = createLineExpressionHighlighter();
    const highlightNewLine = createLineExpressionHighlighter();

    for (const rowData of rows) {
      const oldRow = document.createElement("div");
      oldRow.className = `side-line ${rowData.oldChanged ? "old-changed" : ""}`.trim();
      oldRow.innerHTML = highlightOldLine(rowData.oldLine || "");

      const newRow = document.createElement("div");
      newRow.className = `side-line ${rowData.newChanged ? "new-changed" : ""}`.trim();
      newRow.innerHTML = highlightNewLine(rowData.newLine || "");

      oldCol.appendChild(oldRow);
      newCol.appendChild(newRow);
    }

    diffGrid.appendChild(oldCol);
    diffGrid.appendChild(newCol);

    card.appendChild(head);
    card.appendChild(diffGrid);
    el.reviewList.appendChild(card);
  }

  updateReviewButtons();
}

async function loadClients() {
  setStatus("Carregando clientes...");
  const data = await api("/clients");
  state.clients = data.clients || [];
  renderSelectOptions(el.clientSelect, state.clients, "nome", "id", "Selecione um cliente");
  clearSelectionState();
  state.selectedClient = null;
  renderGlobalContext();
  setStatus(`${state.clients.length} clientes elegíveis carregados.`, "ok");
  renderKpis();
  updateTimestamp();
}

async function onLoadWorkflows() {
  const clientId = el.clientSelect.value;
  if (!clientId) {
    state.selectedClient = null;
    renderGlobalContext();
    clearSelectionState();
    setStatus("Selecione um cliente.", "error");
    return;
  }

  setStatus("Buscando workflows...");

  const data = await api(`/clients/${clientId}/workflows`);
  state.selectedClient = {
    id: clientId,
    nome: state.clients.find((c) => c.id === clientId)?.nome || data.client.nome,
  };
  renderGlobalContext();

  state.workflows = data.workflows || [];
  renderSelectOptions(el.workflowSelect, state.workflows, "name", "id", "Selecione um workflow");
  renderScriptTypeChecks([]);
  state.scriptTypes = [];
  state.selectedWorkflow = null;
  renderKpis();

  if (!state.workflows.length) {
    setStatus("Nenhum workflow compatível encontrado para esse cliente.", "error");
    return;
  }

  if (state.workflows.length === 1) {
    el.workflowSelect.value = state.workflows[0].id;
  }

  await onLoadScriptTypes();
}

async function onLoadScriptTypes() {
  const clientId = el.clientSelect.value;
  const workflowId = el.workflowSelect.value;

  if (!clientId || !workflowId) {
    renderScriptTypeChecks([]);
    setStatus("Selecione cliente e workflow.", "error");
    return;
  }

  setStatus("Descobrindo tipos de script dinâmicos...");
  const data = await api(`/clients/${clientId}/workflows/${workflowId}/script-types`);

  state.selectedWorkflow = data.workflow;
  state.scriptTypes = data.scriptTypes || [];

  renderScriptTypeChecks(
    state.scriptTypes.map((s) => ({
      id: s.name,
      name: formatScriptTypeLabel(s.name, s.occurrences),
    }))
  );

  setStatus(`${state.scriptTypes.length} tipos de script encontrados. Selecione um ou mais.`, "ok");
  renderKpis();
}

async function loadCurrentScriptItems() {
  const scriptName = getCurrentScriptName();
  if (!scriptName) throw new Error("Nenhum tipo de script selecionado.");

  const clientId = state.selectedClient?.id;
  const workflowId = state.selectedWorkflow?.id;
  if (!clientId || !workflowId) throw new Error("Cliente/workflow não selecionados.");

  setStatus(`Carregando itens de ${scriptName}...`);
  const data = await api(
    `/clients/${clientId}/workflows/${workflowId}/scripts?scriptName=${encodeURIComponent(scriptName)}`
  );

  state.items = data.items || [];
  state.itemsByScriptName[scriptName] = state.items;
  state.currentIndex = 0;

  if (!state.items.length) {
    throw new Error(`Nenhum item encontrado para ${scriptName}.`);
  }
}

async function onStartEditor() {
  const selectedScriptNames = getSelectedScriptNames();
  if (!state.selectedClient?.id || !state.selectedWorkflow?.id || !selectedScriptNames.length) {
    setStatus("Selecione cliente, workflow e pelo menos um tipo de script.", "error");
    return;
  }

  state.scriptQueue = selectedScriptNames;
  state.scriptQueueIndex = 0;
  state.drafts = {};
  state.itemsByScriptName = {};
  state.reviewByScriptName = {};

  await loadCurrentScriptItems();
  showScreen("editor");
  renderEditorPage();
  setStatus(
    `${state.items.length} itens carregados para ${getCurrentScriptName()} (${state.scriptQueueIndex + 1} de ${state.scriptQueue.length}).`,
    "ok"
  );
}

function goNext() {
  saveCurrentDraft();
  if (state.currentIndex < state.items.length - 1) {
    state.currentIndex += 1;
  }
  renderEditorPage();
}

function goPrev() {
  saveCurrentDraft();
  if (state.currentIndex > 0) {
    state.currentIndex -= 1;
  }
  renderEditorPage();
}

async function onReview() {
  saveCurrentDraft();

  const scriptName = getCurrentScriptName();
  const edits = buildEditsForItems(state.items);

  if (!edits.length) {
    state.reviewByScriptName[scriptName] = [];
    renderReview([], scriptName);
    showScreen("review");
    setStatus(`Sem alterações para ${scriptName}.`, "ok");
    return;
  }

  setStatus(`Gerando revisão de ${scriptName}...`);

  const data = await api(
    `/clients/${state.selectedClient.id}/workflows/${state.selectedWorkflow.id}/review`,
    {
      method: "POST",
      body: JSON.stringify({
        selectedScriptName: scriptName,
        edits,
      }),
    }
  );

  const changes = data.changes || [];
  state.reviewByScriptName[scriptName] = changes;
  renderReview(changes, scriptName);
  showScreen("review");
  setStatus(`Revisão pronta para ${scriptName}.`, "ok");
}

async function onNextScript() {
  if (!hasNextScript()) return;
  state.scriptQueueIndex += 1;
  await loadCurrentScriptItems();
  showScreen("editor");
  renderEditorPage();
  setStatus(
    `Agora editando ${getCurrentScriptName()} (${state.scriptQueueIndex + 1} de ${state.scriptQueue.length}).`,
    "ok"
  );
}

async function onSave() {
  if (hasNextScript()) {
    setStatus("Finalize todos os scripts selecionados antes de salvar.", "error");
    return;
  }

  const clientId = state.selectedClient?.id;
  const workflowId = state.selectedWorkflow?.id;
  if (!clientId || !workflowId) {
    setStatus("Cliente/workflow não selecionados.", "error");
    return;
  }

  setStatus("Salvando todos os scripts selecionados...");

  let totalChanged = 0;
  const backupFolders = [];

  for (const scriptName of state.scriptQueue) {
    const items = state.itemsByScriptName[scriptName] || [];
    const edits = buildEditsForItems(items);
    if (!edits.length) continue;

    const data = await api(`/clients/${clientId}/workflows/${workflowId}/save`, {
      method: "POST",
      body: JSON.stringify({
        selectedScriptName: scriptName,
        edits,
      }),
    });

    totalChanged += Number(data.changedCount || 0);
    if (data.backupFolder) backupFolders.push(data.backupFolder);
  }

  if (totalChanged === 0) {
    setStatus("Nenhuma alteração encontrada para salvar nos scripts selecionados.", "error");
    return;
  }

  const backupMsg = backupFolders.length ? ` Backups: ${backupFolders.join(" | ")}` : "";
  setStatus(`Salvo com sucesso. ${totalChanged} scripts alterados.${backupMsg}`, "ok");
  updateTimestamp();
  showScreen("select");
}

function wire() {
  el.startEditor.addEventListener("click", () => onStartEditor().catch((e) => setStatus(e.message, "error")));

  el.prevItem.addEventListener("click", goPrev);
  el.nextItem.addEventListener("click", goNext);
  el.backToSelect.addEventListener("click", () => showScreen("select"));
  el.goReview.addEventListener("click", () => onReview().catch((e) => setStatus(e.message, "error")));

  el.backToEditor.addEventListener("click", () => showScreen("editor"));
  el.nextScript.addEventListener("click", () => onNextScript().catch((e) => setStatus(e.message, "error")));
  el.saveChanges.addEventListener("click", () => onSave().catch((e) => setStatus(e.message, "error")));

  el.scriptEditor.addEventListener("input", () => {
    renderScriptPreview(el.scriptEditor.value);
    renderHeadingShortcuts(el.scriptEditor.value);
  });
  el.scriptEditor.addEventListener("scroll", () => {
    syncEditorScroll();
  });

  el.clientSelect.addEventListener("change", () => {
    onLoadWorkflows().catch((e) => setStatus(e.message, "error"));
  });
  el.workflowSelect.addEventListener("change", () => {
    onLoadScriptTypes().catch((e) => setStatus(e.message, "error"));
  });

  el.scriptTypeList.addEventListener("change", () => {
    renderKpis();
  });

  el.shortcutSearchInput?.addEventListener("input", () => {
    state.globalSearchQuery = el.shortcutSearchInput.value;
  });

  el.shortcutSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runGlobalSearchInCurrentScript();
    }
  });

  el.shortcutSearchBtn?.addEventListener("click", () => {
    state.globalSearchQuery = el.shortcutSearchInput.value;
    runGlobalSearchInCurrentScript();
  });

  el.syncBtn?.addEventListener("click", () => {
    loadClients()
      .then(() => {
        setStatus("Clientes sincronizados.", "ok");
        updateTimestamp();
      })
      .catch((e) => setStatus(e.message, "error"));
  });

  el.refreshBtn?.addEventListener("click", () => {
    const action = state.selectedClient?.id ? onLoadWorkflows() : loadClients();
    action
      .then(() => {
        setStatus("Dados atualizados.", "ok");
        updateTimestamp();
      })
      .catch((e) => setStatus(e.message, "error"));
  });
}

wire();
renderGlobalContext();
clearSelectionState();
updateTimestamp();
loadClients().catch((error) => setStatus(error.message, "error"));
