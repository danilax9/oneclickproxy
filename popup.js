// --- Элементы ---
const screens = document.querySelectorAll(".screen");
const powerBtn = document.getElementById("powerBtn");
const homeTitle = document.getElementById("homeTitle");
const conflictBanner = document.getElementById("conflictBanner");
const dismissConflictBtn = document.getElementById("dismissConflictBtn");
const errorScreenText = document.getElementById("errorScreenText");
const retryInitBtn = document.getElementById("retryInitBtn");

const openSettingsBtn = document.getElementById("openSettingsBtn");
const backFromSettingsBtn = document.getElementById("backFromSettingsBtn");
const openAddBtn = document.getElementById("openAddBtn");
const openAddFromSettingsBtn = document.getElementById("openAddFromSettingsBtn");
const backFromAddBtn = document.getElementById("backFromAddBtn");
const openRulesBtn = document.getElementById("openRulesBtn");
const backFromRulesBtn = document.getElementById("backFromRulesBtn");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");

const modeBypassBtn = document.getElementById("modeBypassBtn");
const modeWhitelistBtn = document.getElementById("modeWhitelistBtn");
const rulesInputEl = document.getElementById("rulesInput");
const saveRulesBtn = document.getElementById("saveRulesBtn");
const rulesErrorEl = document.getElementById("rulesError");

const listEl = document.getElementById("list");
const itemTemplate = document.getElementById("proxyItemTemplate");

const addScreenTitle = document.getElementById("addScreenTitle");
const inputEl = document.getElementById("proxyInput");
const addBtn = document.getElementById("addBtn");
const btnLabel = addBtn.querySelector(".btn__label");
const spinnerEl = document.getElementById("spinner");
const errorEl = document.getElementById("inputError");

const modal = document.getElementById("modal");
const modalText = document.getElementById("modalText");
const modalCancel = document.getElementById("modalCancel");
const modalConfirm = document.getElementById("modalConfirm");

let state = {
  proxies: [],
  activeId: null,
  primaryId: null,
  rules: { mode: "bypass", domains: "" },
  proxyConflict: false,
};
let rulesMode = "bypass";
let editingId = null;
let addReturnScreen = "home";

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function switchScreen(name) {
  screens.forEach((s) => s.classList.toggle("active", s.dataset.screen === name));
}

function showConfirm(text, confirmLabel = "Delete", variant = "danger") {
  return new Promise((resolve) => {
    modalText.textContent = text;
    modalConfirm.textContent = confirmLabel;
    modalConfirm.className = variant === "accent" ? "btn btn--accent-block" : "btn btn--danger-block";
    modal.classList.remove("hidden");

    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);

    function cleanup(result) {
      modal.classList.add("hidden");
      modalConfirm.removeEventListener("click", onConfirm);
      modalCancel.removeEventListener("click", onCancel);
      resolve(result);
    }

    modalConfirm.addEventListener("click", onConfirm);
    modalCancel.addEventListener("click", onCancel);
  });
}

function proxyToUrl(proxy) {
  const auth =
    proxy.username || proxy.password
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : "";
  return `${proxy.scheme}://${auth}${proxy.host}:${proxy.port}`;
}

function parseProxyString(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Could not parse string. Format: scheme://user:pass@host:port");
  }

  const scheme = url.protocol.replace(":", "");
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("Only http and https schemes are supported");
  }
  if (!url.hostname) {
    throw new Error("Host is required");
  }
  const port = url.port ? parseInt(url.port, 10) : scheme === "https" ? 443 : 80;

  return {
    id: crypto.randomUUID(),
    scheme,
    host: url.hostname,
    port,
    username: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
    name: url.hostname,
  };
}

function renderConflictBanner() {
  conflictBanner.classList.toggle("hidden", !state.proxyConflict);
}

function renderHome() {
  const on = Boolean(state.activeId);
  powerBtn.classList.toggle("on", on);
  homeTitle.textContent = on ? "Connected" : "Off";
  renderConflictBanner();
}

async function handlePowerClick() {
  if (state.activeId) {
    powerBtn.disabled = true;
    try {
      const res = await sendMessage({ type: "togglePower", on: false });
      state.activeId = res.activeId;
      renderHome();
    } finally {
      powerBtn.disabled = false;
    }
    return;
  }

  if (state.proxies.length === 0) {
    openAddScreen("home");
    return;
  }
  if (!state.primaryId) {
    switchScreen("settings");
    renderList();
    return;
  }

  powerBtn.disabled = true;
  try {
    const res = await sendMessage({ type: "togglePower", on: true });
    if (res.error === "no-primary") {
      switchScreen("settings");
      renderList();
      return;
    }
    if (res.error === "empty-whitelist") {
      const ok = await showConfirm(
        "Proxy only mode requires domains. Open rules?",
        "Open",
        "accent"
      );
      if (ok) {
        renderRulesForm();
        switchScreen("rules");
      }
      return;
    }
    state.activeId = res.activeId;
    state.proxyConflict = false;
    renderHome();
  } finally {
    powerBtn.disabled = false;
  }
}

powerBtn.addEventListener("click", handlePowerClick);

dismissConflictBtn.addEventListener("click", async () => {
  await sendMessage({ type: "clearConflict" });
  state.proxyConflict = false;
  renderConflictBanner();
});

function renderList() {
  listEl.innerHTML = "";

  if (state.proxies.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No proxies";
    listEl.appendChild(empty);
    return;
  }

  for (const proxy of state.proxies) {
    listEl.appendChild(
      buildItem({
        id: proxy.id,
        name: proxy.host,
        https: proxy.scheme === "https",
        full: proxyToUrl(proxy),
        proxy,
      })
    );
  }
}

function updateListSelection() {
  listEl.querySelectorAll(".item").forEach((item) => {
    item.classList.toggle("active", item.dataset.id === state.primaryId);
  });
}

function buildItem({ id, name, https, full, proxy }) {
  const node = itemTemplate.content.cloneNode(true);
  const item = node.querySelector(".item");
  item.dataset.id = id;
  item.classList.toggle("active", state.primaryId === id);

  const selectBtn = node.querySelector(".item__select");
  selectBtn.title = full;
  node.querySelector(".item__name").textContent = name;

  if (https) {
    node.querySelector(".badge--https").classList.remove("hidden");
  }

  selectBtn.addEventListener("click", async () => {
    if (state.primaryId === id) return;
    const res = await sendMessage({ type: "setPrimary", id });
    state.primaryId = res.primaryId;
    state.activeId = res.activeId;
    updateListSelection();
    renderHome();
  });

  node.querySelector(".item__edit").addEventListener("click", (e) => {
    e.stopPropagation();
    openEditScreen(proxy);
  });

  node.querySelector(".item__delete").addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await showConfirm(`Delete proxy ${name}?`);
    if (!ok) return;

    const el = listEl.querySelector(`.item[data-id="${id}"]`);
    try {
      const res = await sendMessage({ type: "deleteProxy", id });
      if (!res?.ok) {
        throw new Error(res?.error || "Failed to delete proxy");
      }
      state.proxies = res.proxies;
      state.activeId = res.activeId;
      state.primaryId = res.primaryId;
      await animateRemove(el);
      renderList();
      renderHome();
    } catch (err) {
      await showConfirm(err.message || "Failed to delete proxy", "OK", "accent");
    }
  });

  return node;
}

function animateRemove(el) {
  return new Promise((resolve) => {
    if (!el) return resolve();
    el.style.maxHeight = el.offsetHeight + "px";
    void el.offsetHeight;
    requestAnimationFrame(() => el.classList.add("removing"));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    el.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 350);
  });
}

function setLoading(loading) {
  addBtn.disabled = loading;
  inputEl.disabled = loading;
  btnLabel.classList.toggle("hidden", loading);
  spinnerEl.classList.toggle("hidden", !loading);
}

function showInputError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
  errorEl.classList.remove("shake");
  void errorEl.offsetWidth;
  errorEl.classList.add("shake");
}

function resetAddForm() {
  inputEl.value = "";
  errorEl.classList.add("hidden");
  editingId = null;
  addScreenTitle.textContent = "New proxy";
  btnLabel.textContent = "Test & add";
}

function openAddScreen(returnScreen = "home") {
  resetAddForm();
  addReturnScreen = returnScreen;
  switchScreen("add");
}

function openEditScreen(proxy) {
  editingId = proxy.id;
  addReturnScreen = "settings";
  addScreenTitle.textContent = "Edit proxy";
  btnLabel.textContent = "Test & save";
  inputEl.value = proxyToUrl(proxy);
  errorEl.classList.add("hidden");
  switchScreen("add");
}

async function handleSaveProxy() {
  errorEl.classList.add("hidden");
  const raw = inputEl.value;
  if (!raw.trim()) return;

  let proxy;
  try {
    proxy = parseProxyString(raw);
  } catch (err) {
    showInputError(err.message);
    return;
  }

  if (editingId) {
    proxy.id = editingId;
  }

  const isEditing = Boolean(editingId);
  setLoading(true);
  btnLabel.textContent = "Testing…";

  try {
    const res = editingId
      ? await sendMessage({ type: "updateProxy", id: editingId, proxy })
      : await sendMessage({ type: "testAndAddProxy", proxy });

    if (!res.ok) {
      showInputError(res.error || "Proxy unavailable");
      return;
    }

    if (editingId) {
      state.proxies = res.proxies;
      state.activeId = res.activeId;
      state.primaryId = res.primaryId;
      resetAddForm();
      renderList();
      renderHome();
      switchScreen("settings");
      return;
    }

    const fresh = await sendMessage({ type: "getState" });
    state = fresh;
    resetAddForm();
    renderList();
    renderHome();
    switchScreen("home");
  } finally {
    setLoading(false);
    btnLabel.textContent = isEditing ? "Test & save" : "Test & add";
  }
}

addBtn.addEventListener("click", handleSaveProxy);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSaveProxy();
});

backFromAddBtn.addEventListener("click", () => {
  resetAddForm();
  switchScreen(addReturnScreen);
});

exportBtn.addEventListener("click", async () => {
  try {
    const res = await sendMessage({ type: "exportData" });
    if (!res?.ok) throw new Error(res?.error || "Export failed");
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "proxy-manager-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    await showConfirm(err.message, "OK", "accent");
  }
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;

  const ok = await showConfirm("Import will replace your current proxy list. Continue?", "Import", "accent");
  if (!ok) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const res = await sendMessage({ type: "importData", data });
    if (!res?.ok) throw new Error(res?.error || "Import failed");
    state.proxies = res.proxies;
    state.activeId = res.activeId;
    state.primaryId = res.primaryId;
    state.rules = res.rules;
    renderList();
    renderHome();
    switchScreen("settings");
  } catch (err) {
    await showConfirm(err.message || "Failed to import file", "OK", "accent");
  }
});

openSettingsBtn.addEventListener("click", () => {
  switchScreen("settings");
  renderList();
});
backFromSettingsBtn.addEventListener("click", () => switchScreen("home"));

openAddBtn.addEventListener("click", () => openAddScreen("home"));
openAddFromSettingsBtn.addEventListener("click", () => openAddScreen("settings"));

function renderRulesForm() {
  rulesMode = state.rules?.mode === "whitelist" ? "whitelist" : "bypass";
  rulesInputEl.value = state.rules?.domains || "";
  modeBypassBtn.classList.toggle("active", rulesMode === "bypass");
  modeWhitelistBtn.classList.toggle("active", rulesMode === "whitelist");
  rulesErrorEl.classList.add("hidden");
}

function setRulesMode(mode) {
  rulesMode = mode;
  modeBypassBtn.classList.toggle("active", mode === "bypass");
  modeWhitelistBtn.classList.toggle("active", mode === "whitelist");
}

modeBypassBtn.addEventListener("click", () => setRulesMode("bypass"));
modeWhitelistBtn.addEventListener("click", () => setRulesMode("whitelist"));

async function handleSaveRules() {
  rulesErrorEl.classList.add("hidden");

  const rules = {
    mode: rulesMode,
    domains: rulesInputEl.value,
  };

  saveRulesBtn.disabled = true;
  try {
    const res = await sendMessage({ type: "saveRules", rules });
    if (!res?.ok) {
      throw new Error(res?.error || "Failed to save rules");
    }

    state.rules = res.rules;
    switchScreen("settings");

    if (res.applyError) {
      rulesErrorEl.textContent = `Saved, but not applied: ${res.applyError}`;
      rulesErrorEl.classList.remove("hidden");
    }
  } catch (err) {
    rulesErrorEl.textContent = err.message || "Failed to save rules";
    rulesErrorEl.classList.remove("hidden");
  } finally {
    saveRulesBtn.disabled = false;
  }
}

saveRulesBtn.addEventListener("click", handleSaveRules);

openRulesBtn.addEventListener("click", () => {
  renderRulesForm();
  switchScreen("rules");
});
backFromRulesBtn.addEventListener("click", () => switchScreen("settings"));

async function init() {
  try {
    const res = await sendMessage({ type: "getState" });
    if (!res?.proxies) {
      throw new Error("No response from extension");
    }
    state = res;
    renderHome();
    switchScreen("home");
  } catch (err) {
    errorScreenText.textContent = err.message || "Failed to load extension";
    switchScreen("error");
  }
}

retryInitBtn.addEventListener("click", init);
init();
