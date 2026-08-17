// --- Элементы ---
const screens = document.querySelectorAll(".screen");
const powerBtn = document.getElementById("powerBtn");
const homeOff = document.getElementById("homeOff");
const homeOn = document.getElementById("homeOn");
const homeFallback = document.getElementById("homeFallback");
const homeFlag = document.getElementById("homeFlag");
const homeFlagWrap = document.getElementById("homeFlagWrap");
const homeCountry = document.getElementById("homeCountry");
const conflictBanner = document.getElementById("conflictBanner");
const dismissConflictBtn = document.getElementById("dismissConflictBtn");
const errorScreenText = document.getElementById("errorScreenText");
const retryInitBtn = document.getElementById("retryInitBtn");

const openSettingsBtn = document.getElementById("openSettingsBtn");
const backFromSettingsBtn = document.getElementById("backFromSettingsBtn");
const openAddBtn = document.getElementById("openAddBtn");
const openAddFromSettingsBtn = document.getElementById("openAddFromSettingsBtn");
const backFromAddBtn = document.getElementById("backFromAddBtn");
const copyProxyBtn = document.getElementById("copyProxyBtn");
const pasteProxyBtn = document.getElementById("pasteProxyBtn");
const clipActionsEl = document.getElementById("clipActions");
const clipSuccessIcon = document.getElementById("clipSuccessIcon");
const openRulesBtn = document.getElementById("openRulesBtn");
const refreshPingBtn = document.getElementById("refreshPingBtn");
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
const btnSuccessEl = document.getElementById("addBtnSuccess");
const spinnerEl = document.getElementById("spinner");
const inputHint = document.getElementById("inputHint");
const DEFAULT_INPUT_HINT = "Tests the proxy before saving";

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
let clipSuccessTimer = null;
let clipSuccessBtn = null;
let resolvingCountries = false;
let countriesResolveAttempted = false;
let pinging = false;
const pingResults = new Map();

function getFlagUrl(countryCode) {
  const code = String(countryCode || "").toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return "";
  return `https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/1x1/${code}.svg`;
}

function getCountryName(countryCode) {
  const code = String(countryCode || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

function getPingTier(ms) {
  if (ms <= 150) return "good";
  if (ms <= 300) return "fair";
  return "slow";
}

function updateItemMeta(itemOrId) {
  const item =
    typeof itemOrId === "string"
      ? listEl.querySelector(`.item[data-id="${itemOrId}"]`)
      : itemOrId;
  if (!item) return;

  const meta = item.querySelector(".item__meta");
  const ping = item.querySelector(".item__ping");
  const badge = item.querySelector(".badge--https");
  if (!meta) return;

  const showMeta =
    (ping && !ping.classList.contains("hidden")) ||
    (badge && !badge.classList.contains("hidden"));
  meta.classList.toggle("hidden", !showMeta);
}

function setItemPingEl(pingEl, result) {
  pingEl.classList.remove("item__ping--good", "item__ping--fair", "item__ping--slow", "item__ping--loading", "item__ping--fail");

  if (!result) {
    pingEl.classList.add("hidden");
    pingEl.textContent = "";
    return;
  }

  pingEl.classList.remove("hidden");

  if (result?.loading) {
    pingEl.textContent = "…";
    pingEl.classList.add("item__ping--loading");
    return;
  }

  if (!result?.ok || result.latencyMs == null) {
    pingEl.textContent = "—";
    pingEl.classList.add("item__ping--fail");
    return;
  }

  const tier = getPingTier(result.latencyMs);
  pingEl.textContent = `${result.latencyMs} ms`;
  pingEl.classList.add(`item__ping--${tier}`);
}

function updateItemPing(id, result) {
  if (result) {
    pingResults.set(id, result);
  } else {
    pingResults.delete(id);
  }

  const item = listEl.querySelector(`.item[data-id="${id}"]`);
  if (!item) return;
  const pingEl = item.querySelector(".item__ping");
  if (pingEl) setItemPingEl(pingEl, result);
  updateItemMeta(item);
}

function markAllPingsLoading() {
  for (const proxy of state.proxies) {
    updateItemPing(proxy.id, { loading: true });
  }
}

async function pingProxyById(id) {
  updateItemPing(id, { loading: true });
  try {
    const res = await sendMessage({ type: "pingProxy", id });
    updateItemPing(id, res);
  } catch {
    updateItemPing(id, { ok: false });
  }
}

async function pingAllProxies() {
  if (pinging || state.proxies.length === 0) return;

  pinging = true;
  refreshPingBtn.disabled = true;
  refreshPingBtn.classList.add("is-spinning");
  markAllPingsLoading();

  try {
    const res = await sendMessage({ type: "pingAllProxies" });
    if (res?.results) {
      for (const result of res.results) {
        updateItemPing(result.id, result);
      }
    }
  } finally {
    pinging = false;
    refreshPingBtn.disabled = false;
    refreshPingBtn.classList.remove("is-spinning");
  }
}

function applyStoredPing(id, pingEl) {
  const stored = pingResults.get(id);
  if (stored) {
    setItemPingEl(pingEl, stored);
  } else {
    pingEl.classList.add("hidden");
  }
}

function getActiveProxy() {
  return state.proxies.find((proxy) => proxy.id === state.activeId) || null;
}

function setItemFlag(node, countryCode) {
  const wrapEl = node.querySelector(".item__flag-wrap");
  const flagEl = node.querySelector(".item__flag");
  const code = String(countryCode || "").toUpperCase();
  const flagUrl = getFlagUrl(code);
  if (flagUrl) {
    flagEl.src = flagUrl;
    flagEl.alt = code;
    wrapEl.classList.remove("hidden");
  } else {
    flagEl.removeAttribute("src");
    flagEl.alt = "";
    wrapEl.classList.add("hidden");
  }
}

async function resolveCountriesIfNeeded() {
  if (countriesResolveAttempted || resolvingCountries) return;
  if (!state.proxies.some((proxy) => !proxy.countryCode)) return;

  countriesResolveAttempted = true;
  resolvingCountries = true;
  try {
    const res = await sendMessage({ type: "resolveCountries" });
    if (res?.ok && res.proxies) {
      state.proxies = res.proxies;
      renderList();
    }
  } finally {
    resolvingCountries = false;
  }
}

function clearClipSuccess() {
  if (clipSuccessTimer) {
    clearTimeout(clipSuccessTimer);
    clipSuccessTimer = null;
  }
  if (clipSuccessBtn) {
    clipSuccessBtn.classList.remove("is-faded");
    clipSuccessBtn = null;
  }
  clipSuccessIcon.classList.remove("is-visible");
}

function showIconSuccess(btn, ms = 3000) {
  clearClipSuccess();

  const btnLeft = btn.offsetLeft;
  clipSuccessIcon.style.left = `${btnLeft}px`;
  clipSuccessBtn = btn;

  btn.classList.add("is-faded");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      clipSuccessIcon.classList.add("is-visible");
    });
  });

  clipSuccessTimer = setTimeout(() => {
    clipSuccessIcon.classList.remove("is-visible");
    btn.classList.remove("is-faded");
    clipSuccessTimer = null;
    clipSuccessBtn = null;
  }, ms);
}

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
  const host = proxy.host.includes(":") ? `[${proxy.host}]` : proxy.host;
  return `${proxy.scheme}://${auth}${host}:${proxy.port}`;
}

function decodeCredential(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHostPort(hostPort) {
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close === -1 || hostPort[close + 1] !== ":") {
      throw new Error("Could not parse IPv6 host. Format: scheme://user:pass@[host]:port");
    }
    return {
      host: hostPort.slice(1, close),
      port: parseInt(hostPort.slice(close + 2), 10),
    };
  }

  const colon = hostPort.lastIndexOf(":");
  if (colon <= 0) {
    throw new Error("Could not parse string. Format: scheme://user:pass@host:port");
  }
  return {
    host: hostPort.slice(0, colon),
    port: parseInt(hostPort.slice(colon + 1), 10),
  };
}

function parseProxyString(raw) {
  const trimmed = raw.trim();
  const schemeMatch = trimmed.match(/^(https?):\/\//i);
  if (!schemeMatch) {
    throw new Error("Could not parse string. Format: scheme://user:pass@host:port");
  }

  const scheme = schemeMatch[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("Only http and https schemes are supported");
  }

  const rest = trimmed.slice(schemeMatch[0].length);
  const at = rest.lastIndexOf("@");
  const userinfo = at === -1 ? "" : rest.slice(0, at);
  const hostPort = at === -1 ? rest : rest.slice(at + 1);
  const { host, port } = parseHostPort(hostPort);

  if (!host || /[\s/]/.test(host)) {
    throw new Error("Host is required");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535");
  }

  let username = "";
  let password = "";
  const colonIndex = userinfo.indexOf(":");
  if (colonIndex === -1) {
    username = decodeCredential(userinfo);
  } else {
    username = decodeCredential(userinfo.slice(0, colonIndex));
    password = decodeCredential(userinfo.slice(colonIndex + 1));
  }

  return {
    id: crypto.randomUUID(),
    scheme,
    host,
    port,
    username,
    password,
    name: host,
  };
}

function renderConflictBanner() {
  conflictBanner.classList.toggle("hidden", !state.proxyConflict);
}

function renderHome() {
  const on = Boolean(state.activeId);
  powerBtn.classList.toggle("on", on);
  renderConflictBanner();

  if (!on) {
    homeOff.classList.remove("hidden");
    homeOn.classList.add("hidden");
    homeFallback.classList.add("hidden");
    return;
  }

  homeOff.classList.add("hidden");
  const proxy = getActiveProxy();
  const code = String(proxy?.countryCode || "").toUpperCase();
  const flagUrl = getFlagUrl(code);
  const countryName = getCountryName(code);

  if (flagUrl && countryName) {
    homeFlag.src = flagUrl;
    homeFlag.alt = code;
    homeFlagWrap.classList.remove("hidden");
    homeCountry.textContent = countryName;
    homeOn.classList.remove("hidden");
    homeFallback.classList.add("hidden");
    return;
  }

  homeFlag.removeAttribute("src");
  homeFlag.alt = "";
  homeFlagWrap.classList.add("hidden");

  homeOn.classList.add("hidden");
  homeFallback.classList.remove("hidden");
  ensureActiveProxyCountry();
}

async function ensureActiveProxyCountry() {
  const proxy = getActiveProxy();
  if (!proxy || proxy.countryCode || !state.activeId) return;
  try {
    const res = await sendMessage({ type: "resolveCountries" });
    if (res?.ok && res.proxies) {
      state.proxies = res.proxies;
      renderHome();
    }
  } catch {
    // keep fallback label
  }
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
    openSettingsScreen();
    return;
  }

  powerBtn.disabled = true;
  try {
    const res = await sendMessage({ type: "togglePower", on: true });
    if (res.error === "no-primary") {
      openSettingsScreen();
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
        countryCode: proxy.countryCode,
        proxy,
      })
    );
  }

  resolveCountriesIfNeeded();
}

function updateListSelection() {
  listEl.querySelectorAll(".item").forEach((item) => {
    item.classList.toggle("active", item.dataset.id === state.primaryId);
  });
}

function buildItem({ id, name, https, countryCode, proxy }) {
  const node = itemTemplate.content.cloneNode(true);
  const item = node.querySelector(".item");
  item.dataset.id = id;
  item.classList.toggle("active", state.primaryId === id);

  const selectBtn = node.querySelector(".item__select");
  node.querySelector(".item__name").textContent = name;
  setItemFlag(node, countryCode);

  if (https) {
    node.querySelector(".badge--https").classList.remove("hidden");
  }

  applyStoredPing(id, node.querySelector(".item__ping"));
  updateItemMeta(item);

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
      pingResults.delete(id);
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

function clearAddSuccess() {
  addBtn.classList.remove("is-success");
  btnSuccessEl.classList.add("hidden");
  btnLabel.classList.remove("hidden");
  addBtn.disabled = false;
}

function showAddSuccess(ms = 3000) {
  return new Promise((resolve) => {
    spinnerEl.classList.add("hidden");
    btnLabel.classList.add("hidden");
    btnSuccessEl.classList.remove("hidden");
    addBtn.disabled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => addBtn.classList.add("is-success"));
    });
    setTimeout(() => {
      clearAddSuccess();
      resolve();
    }, ms);
  });
}
function setLoading(loading) {
  addBtn.disabled = loading;
  inputEl.disabled = loading;
  copyProxyBtn.disabled = loading;
  pasteProxyBtn.disabled = loading;
  btnLabel.classList.toggle("hidden", loading);
  spinnerEl.classList.toggle("hidden", !loading);
}

function clearInputHint() {
  inputHint.textContent = DEFAULT_INPUT_HINT;
  inputHint.classList.remove("form-hint--error", "shake");
}

function showInputError(msg) {
  inputHint.textContent = msg;
  inputHint.classList.add("form-hint--error");
  inputHint.classList.remove("shake");
  void inputHint.offsetWidth;
  inputHint.classList.add("shake");
}

function resetAddForm() {
  inputEl.value = "";
  clearInputHint();
  editingId = null;
  addScreenTitle.textContent = "New proxy";
  btnLabel.textContent = "Test & add";
  clearClipSuccess();
  clearAddSuccess();
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
  clearInputHint();
  switchScreen("add");
}

async function handleSaveProxy() {
  clearInputHint();
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
      setLoading(false);
      btnLabel.textContent = isEditing ? "Test & save" : "Test & add";
      return;
    }

    const savedId = editingId || proxy.id;
    const goSettings = Boolean(editingId);
    if (goSettings) {
      state.proxies = res.proxies;
      state.activeId = res.activeId;
      state.primaryId = res.primaryId;
    } else {
      state = await sendMessage({ type: "getState" });
    }

    inputEl.disabled = false;
    copyProxyBtn.disabled = false;
    pasteProxyBtn.disabled = false;
    await showAddSuccess();

    resetAddForm();
    renderList();
    renderHome();
    switchScreen(goSettings ? "settings" : "home");
    if (savedId && !pinging) {
      pingProxyById(savedId);
    }
  } catch {
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

copyProxyBtn.addEventListener("click", async () => {
  const text = inputEl.value.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    clearInputHint();
    showIconSuccess(copyProxyBtn);
  } catch {
    showInputError("Could not copy to clipboard");
  }
});

pasteProxyBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    inputEl.value = text.trim();
    clearInputHint();
    inputEl.focus();
    showIconSuccess(pasteProxyBtn);
  } catch {
    showInputError("Could not paste from clipboard");
  }
});

exportBtn.addEventListener("click", async () => {
  try {
    const res = await sendMessage({ type: "exportData" });
    if (!res?.ok) throw new Error(res?.error || "Export failed");
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "oneclick-proxy-backup.json";
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
    renderHome();
    openSettingsScreen();
  } catch (err) {
    await showConfirm(err.message || "Failed to import file", "OK", "accent");
  }
});

async function openSettingsScreen() {
  switchScreen("settings");
  renderList();
  pingResults.clear();
  pingAllProxies();
}

openSettingsBtn.addEventListener("click", () => openSettingsScreen());
refreshPingBtn.addEventListener("click", () => {
  pingResults.clear();
  pingAllProxies();
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
