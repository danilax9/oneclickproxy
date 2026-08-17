// OneClick Proxy — background service worker

const STORAGE_KEY_PROXIES = "proxies";
const STORAGE_KEY_ACTIVE = "activeProxyId"; // какой прокси реально применён сейчас (null = direct/выключено)
const STORAGE_KEY_PRIMARY = "primaryProxyId"; // какой прокси используется при включении тумблера
const STORAGE_KEY_RULES = "proxyRules";
const STORAGE_KEY_CONFLICT = "proxyConflict";

const DEFAULT_RULES = { mode: "bypass", domains: "" };

const TEST_URL = "https://www.gstatic.com/generate_204";
const TEST_HOST = "www.gstatic.com";
const PING_TIMEOUT_MS = 8000;
const GEO_URL = "https://ipwho.is/";
const GEO_HOST = "ipwho.is";
const TEST_TIMEOUT_MS = 7000;

// Учётные данные, которые нужно выдать ТОЛЬКО во время тестового запроса
// (кандидат ещё не сохранён и не активен, поэтому обычный activeId-флоу их не знает)
let pendingTest = null; // { host, port, username, password }

let proxyLock = Promise.resolve();

function withProxyLock(task) {
  const run = proxyLock.then(task, task);
  proxyLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function isSafePacToken(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 253 &&
    !/["\\\n\r]/.test(value)
  );
}

function escapePacString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeCountryCode(value) {
  const code = String(value || "").toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function isPublicLookupHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  if (h === "127.0.0.1" || h === "::1") return false;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}

function normalizeProxyInput(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid proxy");
  }
  const scheme = raw.scheme === "https" ? "https" : raw.scheme === "http" ? "http" : "";
  if (!scheme) {
    throw new Error("Only http and https schemes are supported");
  }
  const host = String(raw.host || "").trim();
  const port = Number(raw.port);
  if (!host || !isSafePacToken(host) || /[\s/]/.test(host)) {
    throw new Error("Invalid host");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid port");
  }
  return {
    id: raw.id ? String(raw.id) : crypto.randomUUID(),
    scheme,
    host,
    port,
    username: String(raw.username || ""),
    password: String(raw.password || ""),
    name: String(raw.name || host),
    countryCode: normalizeCountryCode(raw.countryCode),
  };
}

async function refreshConflictState() {
  try {
    const details = await chrome.proxy.settings.get({});
    const conflict = details.levelOfControl !== "controlled_by_this_extension";
    await chrome.storage.local.set({ [STORAGE_KEY_CONFLICT]: conflict });
    return conflict;
  } catch (err) {
    console.warn("[OneClick Proxy] refreshConflictState failed:", err);
    return false;
  }
}

async function getProxies() {
  const { [STORAGE_KEY_PROXIES]: proxies = [] } = await chrome.storage.local.get(STORAGE_KEY_PROXIES);
  return proxies;
}

async function getActiveId() {
  const { [STORAGE_KEY_ACTIVE]: activeId = null } = await chrome.storage.local.get(STORAGE_KEY_ACTIVE);
  return activeId;
}

async function setActiveId(id) {
  await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: id });
}

async function saveProxies(proxies) {
  await chrome.storage.local.set({ [STORAGE_KEY_PROXIES]: proxies });
}

async function getPrimaryId() {
  const { [STORAGE_KEY_PRIMARY]: primaryId = null } = await chrome.storage.local.get(STORAGE_KEY_PRIMARY);
  return primaryId;
}

async function setPrimaryId(id) {
  await chrome.storage.local.set({ [STORAGE_KEY_PRIMARY]: id });
}

async function getRules() {
  const { [STORAGE_KEY_RULES]: rules = DEFAULT_RULES } = await chrome.storage.local.get(STORAGE_KEY_RULES);
  return { ...DEFAULT_RULES, ...rules };
}

async function persistRules(rules) {
  await chrome.storage.local.set({ [STORAGE_KEY_RULES]: rules });
}

async function reapplyActiveProxy() {
  const activeId = await getActiveId();
  if (!activeId) return;
  const proxies = await getProxies();
  const proxy = proxies.find((p) => p.id === activeId) || null;
  await applyProxy(proxy);
  await syncActionIcon();
}

function isDuplicateProxy(proxies, proxy, excludeId = null) {
  return proxies.some(
    (p) => p.id !== excludeId && p.host === proxy.host && p.port === proxy.port
  );
}

function proxyKey(proxy) {
  return `${proxy.scheme}://${proxy.host}:${proxy.port}`;
}

function parseDomainLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && isSafePacToken(line));
}

function patternToPacCondition(pattern) {
  const escaped = escapePacString(pattern);
  if (pattern.includes("*")) {
    return `shExpMatch(host, "${escaped}")`;
  }
  if (/^[\d.a-fA-F:]+$/.test(pattern)) {
    return `host === "${escaped}"`;
  }
  return `(host === "${escaped}" || dnsDomainIs(host, ".${escaped}"))`;
}

function shExpMatch(str, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(str);
}

function dnsDomainIs(host, domain) {
  const base = domain.startsWith(".") ? domain.slice(1) : domain;
  return host === base || host.endsWith(`.${base}`);
}

function hostMatchesBypassPattern(host, pattern) {
  if (!host || !pattern) return false;
  const normalizedHost = host.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  if (normalizedPattern.startsWith(".")) {
    return dnsDomainIs(normalizedHost, normalizedPattern);
  }
  if (normalizedPattern.includes("*")) {
    return shExpMatch(normalizedHost, normalizedPattern);
  }
  if (/^[\d.a-fA-F:]+$/.test(normalizedPattern)) {
    return normalizedHost === normalizedPattern;
  }
  return (
    normalizedHost === normalizedPattern ||
    dnsDomainIs(normalizedHost, `.${normalizedPattern}`)
  );
}

function hostMatchesPattern(host, pattern) {
  if (!host || !pattern) return false;
  const normalizedHost = host.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  if (normalizedPattern.includes("*")) {
    return shExpMatch(normalizedHost, normalizedPattern);
  }
  if (/^[\d.a-fA-F:]+$/.test(normalizedPattern)) {
    return normalizedHost === normalizedPattern;
  }
  return (
    normalizedHost === normalizedPattern ||
    dnsDomainIs(normalizedHost, `.${normalizedPattern}`)
  );
}

function wouldUseProxyForHost(host, rules, patterns) {
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || !host.includes(".")) {
    return false;
  }

  const matchesPattern =
    rules.mode === "bypass"
      ? (pattern) => hostMatchesBypassPattern(host, pattern)
      : (pattern) => hostMatchesPattern(host, pattern);

  if (rules.mode === "whitelist") {
    if (!patterns.length) return false;
    return patterns.some(matchesPattern);
  }

  return !patterns.some(matchesPattern);
}

async function getTabHost(tab) {
  if (!tab?.url) return null;
  if (/^(chrome|chrome-extension|edge|about|devtools):/i.test(tab.url)) return null;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return null;
  }
}

async function getActiveTabHost(tabId = null) {
  try {
    if (tabId != null) {
      return getTabHost(await chrome.tabs.get(tabId));
    }
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return getTabHost(tabs[0]);
  } catch (err) {
    console.warn("[OneClick Proxy] getActiveTabHost failed:", err);
    return null;
  }
}
function proxyPacTarget(proxy) {
  const host =
    proxy.host.includes(":") && !proxy.host.startsWith("[") ? `[${proxy.host}]` : proxy.host;
  const directive = proxy.scheme === "https" ? "HTTPS" : "PROXY";
  return `${directive} ${escapePacString(host)}:${Number(proxy.port)}`;
}

function buildPacScript(proxy, rules, patterns) {
  if (!isSafePacToken(proxy.host)) {
    throw new Error("Invalid proxy host");
  }
  const proxyStr = proxyPacTarget(proxy);
  const conditions = patterns.map(patternToPacCondition).filter(Boolean);
  const matchExpr = conditions.length ? conditions.join(" || ") : "false";
  const localDirect = `host === "localhost" || host === "127.0.0.1" || host === "[::1]" || isPlainHostName(host)`;

  if (rules.mode === "whitelist") {
    return `function FindProxyForURL(url, host) {
  if (${localDirect}) return "DIRECT";
  if (${matchExpr}) return "${proxyStr}";
  return "DIRECT";
}`;
  }

  return `function FindProxyForURL(url, host) {
  if (${localDirect}) return "DIRECT";
  if (${matchExpr}) return "DIRECT";
  return "${proxyStr}";
}`;
}

// Применяет прокси с учётом правил маршрутизации
async function applyProxy(proxy) {
  if (!proxy) {
    await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" });
    return;
  }

  const rules = await getRules();
  const patterns = parseDomainLines(rules.domains);

  if (rules.mode === "whitelist" || patterns.length > 0) {
    const pac = buildPacScript(proxy, rules, patterns);
    await chrome.proxy.settings.set({
      value: { mode: "pac_script", pacScript: { data: pac } },
      scope: "regular",
    });
    return;
  }

  await chrome.proxy.settings.set({
    value: {
      mode: "fixed_servers",
      rules: {
        singleProxy: { scheme: proxy.scheme, host: proxy.host, port: proxy.port },
        bypassList: ["<local>", "localhost", "127.0.0.1", "[::1]"],
      },
    },
    scope: "regular",
  });
}

// Восстанавливает реальное состояние (сохранённый активный прокси или direct)
async function restoreRealProxyState() {
  const activeId = await getActiveId();
  if (!activeId) {
    await applyProxy(null);
    return;
  }
  const proxies = await getProxies();
  const proxy = proxies.find((p) => p.id === activeId) || null;
  await applyProxy(proxy);
}

// Через PAC-скрипт заворачивает в прокси ТОЛЬКО тестовый хост,
// весь остальной трафик пользователя в это время идёт напрямую — не мешаем работе.
async function applyPacForTest(proxy, targetHosts = [TEST_HOST]) {
  if (!isSafePacToken(proxy.host)) {
    throw new Error("Invalid proxy host");
  }
  const proxyStr = proxyPacTarget(proxy);
  const hosts = targetHosts.filter(isSafePacToken);
  const matchExpr = hosts
    .map((host) => {
      const escaped = escapePacString(host);
      return `host === "${escaped}" || dnsDomainIs(host, ".${escaped}")`;
    })
    .join(" || ");
  const pac = `
    function FindProxyForURL(url, host) {
      if (${matchExpr || "false"}) {
        return "${proxyStr}";
      }
      return "DIRECT";
    }
  `;
  await chrome.proxy.settings.set({
    value: { mode: "pac_script", pacScript: { data: pac } },
    scope: "regular",
  });
}

async function lookupCountryByHost(host) {
  if (!isPublicLookupHost(host)) return null;
  try {
    const res = await fetch(`${GEO_URL}${encodeURIComponent(host)}`, {
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json();
    if (data.success && data.country_code) {
      return normalizeCountryCode(data.country_code);
    }
  } catch (err) {
    console.warn("[OneClick Proxy] country lookup failed for", host, err);
  }
  return null;
}

async function resolveMissingCountries() {
  const proxies = await getProxies();
  let changed = false;

  for (const proxy of proxies) {
    if (proxy.countryCode) continue;
    const countryCode = await lookupCountryByHost(proxy.host);
    if (countryCode) {
      proxy.countryCode = countryCode;
      changed = true;
    }
  }

  if (changed) {
    await saveProxies(proxies);
  }
  return proxies;
}

async function fetchGstaticProxyLatency(proxy) {
  pendingTest = {
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
  };

  await applyPacForTest(proxy, [TEST_HOST]);
  const start = performance.now();

  try {
    await fetch(TEST_URL, {
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return { ok: false, error: "timeout" };
    }
    if (elapsed < PING_TIMEOUT_MS) {
      return { ok: true, latencyMs: elapsed };
    }
    return { ok: false, error: "failed" };
  }
}

async function measureProxyLatency(proxy) {
  try {
    return await fetchGstaticProxyLatency(proxy);
  } finally {
    pendingTest = null;
    await restoreRealProxyState();
  }
}

async function pingAllProxiesDirect() {
  const proxies = await getProxies();
  if (!proxies.length) return [];

  const results = [];
  try {
    for (const proxy of proxies) {
      results.push({ id: proxy.id, ...(await fetchGstaticProxyLatency(proxy)) });
    }
    return results;
  } finally {
    pendingTest = null;
    await restoreRealProxyState();
  }
}

async function testProxyConnectivity(proxy) {
  pendingTest = {
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
  };

  try {
    await applyPacForTest(proxy, [TEST_HOST, GEO_HOST]);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      await fetch(TEST_URL, {
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });

      let countryCode = null;
      try {
        const geoRes = await fetch(GEO_URL, {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        const geo = await geoRes.json();
        if (geo.success && geo.country_code) {
          countryCode = normalizeCountryCode(geo.country_code);
        }
      } catch (err) {
        console.warn("[OneClick Proxy] geo lookup through proxy failed:", err);
      }

      if (!countryCode) {
        countryCode = await lookupCountryByHost(proxy.host);
      }

      return { ok: true, countryCode };
    } catch (err) {
      console.warn("[OneClick Proxy] proxy test failed:", proxy.scheme, proxy.host, proxy.port, err);
      if (err.name === "AbortError") {
        return { ok: false, error: "Proxy timed out" };
      }
      return { ok: false, error: "Could not connect through this proxy" };
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    pendingTest = null;
    await restoreRealProxyState();
  }
}

async function activateProxy(id) {
  const proxies = await getProxies();
  const proxy = proxies.find((p) => p.id === id) || null;
  await applyProxy(proxy);
  await setActiveId(proxy ? proxy.id : null);
  await syncActionIcon();
  if (proxy) {
    await chrome.storage.local.set({ [STORAGE_KEY_CONFLICT]: false });
  }
  return proxy;
}

async function deactivate() {
  await applyProxy(null);
  await setActiveId(null);
  await syncActionIcon();
  return null;
}

async function addProxy(proxy) {
  const proxies = await getProxies();
  if (isDuplicateProxy(proxies, proxy)) {
    throw new Error("This proxy is already added");
  }
  proxies.push(proxy);
  await saveProxies(proxies);

  await setPrimaryId(proxy.id);
  return proxies;
}

async function updateProxy(id, proxy) {
  let proxies = await getProxies();
  const index = proxies.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new Error("Proxy not found");
  }
  if (isDuplicateProxy(proxies, proxy, id)) {
    throw new Error("This proxy is already added");
  }

  proxy.id = id;
  proxies[index] = proxy;
  await saveProxies(proxies);

  const activeId = await getActiveId();
  if (activeId === id) {
    await activateProxy(id);
  }
  return proxies;
}

async function deleteProxy(id) {
  let proxies = await getProxies();
  proxies = proxies.filter((p) => p.id !== id);
  await saveProxies(proxies);

  const activeId = await getActiveId();
  if (activeId === id) {
    await deactivate();
  }

  const primaryId = await getPrimaryId();
  if (primaryId === id) {
    await setPrimaryId(proxies.length > 0 ? proxies[0].id : null);
  }
  return proxies;
}

// Меняет основной прокси. Если сейчас включено — сразу переключает активное соединение.
async function setPrimary(id) {
  await setPrimaryId(id);
  const activeId = await getActiveId();
  if (activeId) {
    await activateProxy(id);
  }
  return { primaryId: id, activeId: await getActiveId() };
}

// Тумблер на главном экране: включить = поднять основной прокси, выключить = direct
async function togglePower(turnOn) {
  if (!turnOn) {
    await deactivate();
    return { activeId: null };
  }

  const rules = await getRules();
  if (rules.mode === "whitelist" && parseDomainLines(rules.domains).length === 0) {
    return { error: "empty-whitelist" };
  }

  const primaryId = await getPrimaryId();
  if (!primaryId) {
    return { error: "no-primary" };
  }
  const proxy = await activateProxy(primaryId);
  await chrome.storage.local.set({ [STORAGE_KEY_CONFLICT]: false });
  return { activeId: proxy ? proxy.id : null };
}

// --- Extension toolbar icon ---
const ICON_COLORS = {
  inactive: "#B8C4D0",
  active: "#7890FF",
  bypassed: "#C8D4FA",
};

function drawActionIcon(ctx, size, state) {
  const cx = size / 2;
  const cy = size / 2;
  const margin = Math.max(1, size * 0.06);
  const radius = size / 2 - margin;

  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = ICON_COLORS[state] || ICON_COLORS.inactive;
  ctx.fill();
}

async function updateActionIcon(state) {
  const sizes = [16, 48, 128];
  const imageData = {};

  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    drawActionIcon(ctx, size, state);
    imageData[size] = ctx.getImageData(0, 0, size, size);
  }

  await chrome.action.setIcon({ imageData });
}

async function syncActionIcon(tabId = null) {
  const activeId = await getActiveId();
  if (!activeId) {
    await updateActionIcon("inactive");
    return;
  }

  const rules = await getRules();
  const patterns = parseDomainLines(rules.domains);
  const host = await getActiveTabHost(tabId);

  if (!host) {
    await updateActionIcon("active");
    return;
  }

  const usesProxy = wouldUseProxyForHost(host, rules, patterns);
  await updateActionIcon(usesProxy ? "active" : "bypassed");
}

async function restoreSession() {
  const proxies = await getProxies();
  let activeId = await getActiveId();
  let primaryId = await getPrimaryId();

  if (activeId && !proxies.some((p) => p.id === activeId)) {
    activeId = null;
    await setActiveId(null);
  }
  if (primaryId && !proxies.some((p) => p.id === primaryId)) {
    primaryId = proxies.length > 0 ? proxies[0].id : null;
    await setPrimaryId(primaryId);
  }

  if (activeId) {
    const proxy = proxies.find((p) => p.id === activeId) || null;
    await applyProxy(proxy);
    await syncActionIcon();
  } else {
    await applyProxy(null);
    await updateActionIcon("inactive");
  }
  await refreshConflictState();
}

async function syncIconFromStorage() {
  await syncActionIcon();
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  syncActionIcon(activeInfo.tabId).catch((err) => {
    console.warn("[OneClick Proxy] syncActionIcon onActivated failed:", err);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab?.active) return;
  if (changeInfo.url || changeInfo.status === "complete") {
    syncActionIcon(tabId).catch((err) => {
      console.warn("[OneClick Proxy] syncActionIcon onUpdated failed:", err);
    });
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    syncActionIcon().catch((err) => {
      console.warn("[OneClick Proxy] syncActionIcon onFocusChanged failed:", err);
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  withProxyLock(restoreSession).catch((err) => {
    console.warn("[OneClick Proxy] restoreSession onStartup failed:", err);
  });
});
chrome.runtime.onInstalled.addListener(() => {
  withProxyLock(restoreSession).catch((err) => {
    console.warn("[OneClick Proxy] restoreSession onInstalled failed:", err);
  });
});

chrome.proxy.settings.onChange.addListener((details) => {
  const conflict = details.levelOfControl !== "controlled_by_this_extension";
  chrome.storage.local.set({ [STORAGE_KEY_CONFLICT]: conflict });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-proxy") return;
  withProxyLock(async () => {
    const activeId = await getActiveId();
    if (activeId) {
      await deactivate();
      return;
    }
    await togglePower(true);
  }).catch((err) => {
    console.warn("[OneClick Proxy] toggle-proxy command failed:", err);
  });
});

// --- Авторизация на прокси ---
chrome.webRequest.onAuthRequired.addListener(
  async (details, callback) => {
    if (!details.isProxy) {
      callback();
      return;
    }

    // Приоритет — креды тестового запроса, если тест сейчас идёт
    if (pendingTest) {
      callback({
        authCredentials: {
          username: pendingTest.username || "",
          password: pendingTest.password || "",
        },
      });
      return;
    }

    const activeId = await getActiveId();
    if (!activeId) {
      callback();
      return;
    }
    const proxies = await getProxies();
    const proxy = proxies.find((p) => p.id === activeId);
    if (proxy && proxy.username) {
      callback({
        authCredentials: { username: proxy.username, password: proxy.password || "" },
      });
    } else {
      callback();
    }
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

// --- Сообщения от popup.js ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "forbidden" });
    return false;
  }

  const PROXY_LOCK_TYPES = new Set([
    "setPrimary",
    "togglePower",
    "testAndAddProxy",
    "updateProxy",
    "deleteProxy",
    "activateProxy",
    "deactivate",
    "saveRules",
    "pingProxy",
    "pingAllProxies",
    "importData",
  ]);

  const handle = async () => {
    try {
      switch (message.type) {
      case "getState": {
        const proxies = await getProxies();
        const activeId = await getActiveId();
        const primaryId = await getPrimaryId();
        const rules = await getRules();
        const { [STORAGE_KEY_CONFLICT]: proxyConflict = false } = await chrome.storage.local.get(
          STORAGE_KEY_CONFLICT
        );
        syncActionIcon().catch((err) => {
          console.warn("[OneClick Proxy] syncActionIcon on getState failed:", err);
        });
        sendResponse({ proxies, activeId, primaryId, rules, proxyConflict });
        break;
      }
      case "setPrimary": {
        const res = await setPrimary(message.id);
        sendResponse(res);
        break;
      }
      case "togglePower": {
        const res = await togglePower(message.on);
        sendResponse(res);
        break;
      }
      case "testAndAddProxy": {
        const proxy = normalizeProxyInput(message.proxy);
        const result = await testProxyConnectivity(proxy);
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error });
          break;
        }
        if (result.countryCode) {
          proxy.countryCode = result.countryCode;
        }
        const proxies = await addProxy(proxy);
        sendResponse({ ok: true, proxies });
        break;
      }
      case "updateProxy": {
        const proxy = normalizeProxyInput({ ...message.proxy, id: message.id });
        const result = await testProxyConnectivity(proxy);
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error });
          break;
        }
        if (result.countryCode) {
          proxy.countryCode = result.countryCode;
        }
        const proxies = await updateProxy(message.id, proxy);
        sendResponse({
          ok: true,
          proxies,
          activeId: await getActiveId(),
          primaryId: await getPrimaryId(),
        });
        break;
      }
      case "deleteProxy": {
        const proxies = await deleteProxy(message.id);
        sendResponse({
          ok: true,
          proxies,
          activeId: await getActiveId(),
          primaryId: await getPrimaryId(),
        });
        break;
      }
      case "activateProxy": {
        const proxy = await activateProxy(message.id);
        sendResponse({ activeId: proxy ? proxy.id : null });
        break;
      }
      case "deactivate": {
        await deactivate();
        sendResponse({ activeId: null });
        break;
      }
      case "saveRules": {
        if (!message.rules) {
          sendResponse({ ok: false, error: "No data to save" });
          break;
        }
        const rules = {
          mode: message.rules.mode === "whitelist" ? "whitelist" : "bypass",
          domains: String(message.rules.domains || ""),
        };
        if (rules.mode === "whitelist" && parseDomainLines(rules.domains).length === 0) {
          sendResponse({ ok: false, error: "Add domains for Proxy only mode" });
          break;
        }
        await persistRules(rules);

        let applyError = null;
        try {
          await reapplyActiveProxy();
        } catch (err) {
          console.warn("[OneClick Proxy] failed to reapply proxy after rules save:", err);
          applyError = err.message || "Failed to apply rules";
        }

        sendResponse({ ok: true, rules, applyError });
        break;
      }
      case "resolveCountries": {
        const proxies = await resolveMissingCountries();
        sendResponse({ ok: true, proxies });
        break;
      }
      case "pingProxy": {
        const proxies = await getProxies();
        const proxy = proxies.find((p) => p.id === message.id) || null;
        if (!proxy) {
          sendResponse({ ok: false, error: "Proxy not found" });
          break;
        }
        await restoreRealProxyState();
        sendResponse(await measureProxyLatency(proxy));
        break;
      }
      case "pingAllProxies": {
        sendResponse({ ok: true, results: await pingAllProxiesDirect() });
        break;
      }
      case "exportData": {
        const proxies = await getProxies();
        const rules = await getRules();
        const primaryId = await getPrimaryId();
        sendResponse({
          ok: true,
          data: { version: 1, exportedAt: new Date().toISOString(), proxies, rules, primaryId },
        });
        break;
      }
      case "importData": {
        const payload = message.data;
        if (!payload || !Array.isArray(payload.proxies)) {
          sendResponse({ ok: false, error: "Invalid file" });
          break;
        }
        const seen = new Set();
        const unique = [];
        for (const raw of payload.proxies) {
          try {
            const proxy = normalizeProxyInput(raw);
            const key = proxyKey(proxy);
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(proxy);
          } catch {
            continue;
          }
        }

        await saveProxies(unique);
        const rules = payload.rules
          ? {
              mode: payload.rules.mode === "whitelist" ? "whitelist" : "bypass",
              domains: String(payload.rules.domains || ""),
            }
          : DEFAULT_RULES;
        await persistRules(rules);

        let primaryId = payload.primaryId;
        if (!primaryId || !unique.some((p) => p.id === primaryId)) {
          primaryId = unique.length > 0 ? unique[0].id : null;
        }
        await setPrimaryId(primaryId);
        await deactivate();

        sendResponse({
          ok: true,
          proxies: unique,
          activeId: null,
          primaryId,
          rules,
        });
        break;
      }
      case "clearConflict": {
        await chrome.storage.local.set({ [STORAGE_KEY_CONFLICT]: false });
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ error: "unknown message type" });
      }
    } catch (err) {
      console.error("[OneClick Proxy] message handler error:", message?.type, err);
      sendResponse({ ok: false, error: err.message || "Internal error" });
    }
  };

  const run = PROXY_LOCK_TYPES.has(message?.type) ? withProxyLock(handle) : handle();
  run.catch((err) => {
    console.error("[OneClick Proxy] message handler failed:", message?.type, err);
    try {
      sendResponse({ ok: false, error: err.message || "Internal error" });
    } catch {
      // popup already closed
    }
  });
  return true; // ответ асинхронный
});
