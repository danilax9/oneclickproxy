// OneClick Proxy — background service worker

const STORAGE_KEY_PROXIES = "proxies";
const STORAGE_KEY_ACTIVE = "activeProxyId"; // какой прокси реально применён сейчас (null = direct/выключено)
const STORAGE_KEY_PRIMARY = "primaryProxyId"; // какой прокси используется при включении тумблера
const STORAGE_KEY_RULES = "proxyRules";
const STORAGE_KEY_CONFLICT = "proxyConflict";

const DEFAULT_RULES = { mode: "bypass", domains: "" };

const TEST_URL = "https://www.gstatic.com/generate_204";
const TEST_HOST = "www.gstatic.com";
const TEST_TIMEOUT_MS = 7000;

// Учётные данные, которые нужно выдать ТОЛЬКО во время тестового запроса
// (кандидат ещё не сохранён и не активен, поэтому обычный activeId-флоу их не знает)
let pendingTest = null; // { host, port, username, password }

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
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function patternToPacCondition(pattern) {
  const escaped = pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (pattern.includes("*")) {
    return `shExpMatch(host, "${escaped}")`;
  }
  if (/^[\d.a-fA-F:]+$/.test(pattern)) {
    return `host === "${escaped}"`;
  }
  return `(host === "${escaped}" || dnsDomainIs(host, ".${escaped}"))`;
}

function buildPacScript(proxy, rules, patterns) {
  const directive = proxy.scheme === "https" ? "HTTPS" : "PROXY";
  const proxyStr = `${directive} ${proxy.host}:${proxy.port}`;
  const conditions = patterns.map(patternToPacCondition).filter(Boolean);
  const matchExpr = conditions.length ? conditions.join(" || ") : "false";

  if (rules.mode === "whitelist") {
    return `function FindProxyForURL(url, host) {
  if (host === "localhost" || host === "127.0.0.1") return "DIRECT";
  if (${matchExpr}) return "${proxyStr}";
  return "DIRECT";
}`;
  }

  const bypassExpr = conditions.length ? conditions.join(" || ") : "false";
  return `function FindProxyForURL(url, host) {
  if (host === "localhost" || host === "127.0.0.1") return "DIRECT";
  if (${bypassExpr}) return "DIRECT";
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

  if (rules.mode === "bypass" && patterns.length > 0) {
    await chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: { scheme: proxy.scheme, host: proxy.host, port: proxy.port },
          bypassList: ["localhost", "127.0.0.1", ...patterns],
        },
      },
      scope: "regular",
    });
    return;
  }

  if (rules.mode === "whitelist") {
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
        bypassList: ["localhost", "127.0.0.1"],
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
async function applyPacForTest(proxy) {
  // Для http-прокси Chrome ожидает директиву "PROXY host:port".
  // Для https-прокси (TLS-соединение до самого прокси-сервера) — отдельную
  // директиву "HTTPS host:port". Перепутать их — частая причина ложного
  // провала теста для валидных https-прокси.
  const directive = proxy.scheme === "https" ? "HTTPS" : "PROXY";
  const pac = `
    function FindProxyForURL(url, host) {
      if (host === "${TEST_HOST}") {
        return "${directive} ${proxy.host}:${proxy.port}";
      }
      return "DIRECT";
    }
  `;
  await chrome.proxy.settings.set({
    value: { mode: "pac_script", pacScript: { data: pac } },
    scope: "regular",
  });
}

async function testProxyConnectivity(proxy) {
  pendingTest = {
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
  };

  try {
    await applyPacForTest(proxy);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      await fetch(TEST_URL, {
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });
      return { ok: true };
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
  await updateActionIcon(Boolean(proxy));
  if (proxy) {
    await chrome.storage.local.set({ [STORAGE_KEY_CONFLICT]: false });
  }
  return proxy;
}

async function deactivate() {
  await applyProxy(null);
  await setActiveId(null);
  await updateActionIcon(false);
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
  active: "#22C55E",
};

function drawActionIcon(ctx, size, active) {
  const cx = size / 2;
  const cy = size / 2;
  const margin = Math.max(1, size * 0.06);
  const radius = size / 2 - margin;

  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = active ? ICON_COLORS.active : ICON_COLORS.inactive;
  ctx.fill();
}

async function updateActionIcon(active) {
  const sizes = [16, 48, 128];
  const imageData = {};

  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    drawActionIcon(ctx, size, active);
    imageData[size] = ctx.getImageData(0, 0, size, size);
  }

  await chrome.action.setIcon({ imageData });
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
    await updateActionIcon(Boolean(proxy));
  } else {
    await applyProxy(null);
    await updateActionIcon(false);
  }
}

async function syncIconFromStorage() {
  const activeId = await getActiveId();
  await updateActionIcon(Boolean(activeId));
}

chrome.runtime.onStartup.addListener(restoreSession);
chrome.runtime.onInstalled.addListener(restoreSession);

chrome.proxy.settings.onChange.addListener((details) => {
  const conflict = details.levelOfControl !== "controlled_by_this_extension";
  chrome.storage.local.set({ [STORAGE_KEY_CONFLICT]: conflict });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-proxy") return;
  const activeId = await getActiveId();
  if (activeId) {
    await deactivate();
    return;
  }
  await togglePower(true);
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
  (async () => {
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
        const result = await testProxyConnectivity(message.proxy);
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error });
          break;
        }
        try {
          const proxies = await addProxy(message.proxy);
          sendResponse({ ok: true, proxies });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }
      case "updateProxy": {
        const result = await testProxyConnectivity(message.proxy);
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error });
          break;
        }
        try {
          const proxies = await updateProxy(message.id, message.proxy);
          sendResponse({
            ok: true,
            proxies,
            activeId: await getActiveId(),
            primaryId: await getPrimaryId(),
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
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
        const proxies = payload.proxies.map((p) => ({
          id: p.id || crypto.randomUUID(),
          scheme: p.scheme === "https" ? "https" : "http",
          host: String(p.host || ""),
          port: Number(p.port) || 80,
          username: String(p.username || ""),
          password: String(p.password || ""),
          name: String(p.name || p.host || ""),
        })).filter((p) => p.host);

        const seen = new Set();
        const unique = [];
        for (const p of proxies) {
          const key = proxyKey(p);
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(p);
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
  })();
  return true; // ответ асинхронный
});
