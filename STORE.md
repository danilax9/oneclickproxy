# Chrome Web Store listing

Use this when submitting OneClick Proxy to the Chrome Web Store.

## Listing

- **Name:** OneClick Proxy
- **Short description (≤132 chars):** Switch HTTP/HTTPS proxies in one click. Auth, routing rules, ping, and credentials stored only on this device.
- **Category:** Productivity
- **Language:** English

### Full description

OneClick Proxy is a fast switcher for HTTP and HTTPS proxies you already have. Turn a proxy on or off from the toolbar, keep several servers, and apply routing rules without leaving Chrome.

**What it does**
- One-click power button for the selected proxy
- Multiple proxies with a default for the toggle
- HTTP proxy authentication (username/password)
- Bypass listed domains, or proxy only a whitelist
- Connectivity test before a proxy is saved
- Latency ping and country label for each server
- Export/import settings as JSON on this device
- Keyboard shortcut: Alt+Shift+P

**What it does not do**
- It does not sell VPN subscriptions
- It does not tunnel traffic through our servers
- It does not read the pages you visit
- Credentials stay in local Chrome storage

**Your own server**
If you need a private HTTP proxy, you can install 3proxy on a Linux VPS and paste the URL the installer prints. See the project README.

Privacy policy: https://github.com/danilax9/oneclickproxy/blob/main/PRIVACY.md
Source: https://github.com/danilax9/oneclickproxy

## Permission justifications (Developer Dashboard)

Copy these into the permission justification fields.

**proxy**
Used to apply or clear Chrome proxy settings for the HTTP/HTTPS proxy the user selected. This is the core function of the extension.

**storage**
Used to store the user’s proxy list, credentials, routing rules, and which proxy is active. Data stays on the device.

**webRequest**
Used only with onAuthRequired so the extension can detect when a proxy server asks for a username and password.

**webRequestAuthProvider**
Used to supply the credentials the user saved for that proxy. Without this, Chrome would show a native auth dialog on every request.

**Host permission `<all_urls>`**
Required because proxy authentication and PAC routing apply to whichever sites the user visits while the proxy is on. The extension does not inject scripts, scrape pages, or collect browsing history. Narrower host patterns cannot cover arbitrary destinations the user opens through the proxy.

## Privacy certifications

Declare in the dashboard:

- The extension stores proxy credentials locally
- The extension communicates with remote servers: the user’s proxy, gstatic.com (connectivity test), and ipwho.is (optional country lookup for the proxy host/exit IP)
- No personally identifiable information is sold
- No remote code is used

Privacy policy URL:
`https://github.com/danilax9/oneclickproxy/blob/main/PRIVACY.md`

## Screenshots (required)

Capture from a 1280×800 or 640×400 window. At least one screenshot is required; five is better.

1. Home screen, proxy off
2. Home screen, proxy on with country label
3. Proxy list with ping values
4. Add-proxy screen with a sample URL
5. Routing rules (Bypass / Proxy only)

Store icon: `icons/icon128.png` (128×128). Optional 440×280 small promo tile.

## Review notes

- Single purpose: HTTP/HTTPS proxy switching in Chrome
- No remote hosted code; country flags are static SVG images loaded as `<img>` from jsDelivr, not executed as scripts
- Clipboard is used only on explicit Copy/Paste clicks (no `clipboardRead` permission)
- `tabs` permission is not requested; tab URL is read only to tint the toolbar icon using existing host access
