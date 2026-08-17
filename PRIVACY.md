# Privacy Policy for OneClick Proxy

Last updated: 17 August 2026

OneClick Proxy (“the extension”) is a Chrome extension that switches HTTP/HTTPS proxies in the browser. This policy describes what data the extension stores, what it sends over the network, and what it does not collect.

## Who we are

The extension is open source: [github.com/danilax9/oneclickproxy](https://github.com/danilax9/oneclickproxy).

## Data stored on your device

The extension stores the following in `chrome.storage.local` on your computer only:

- Proxy host, port, scheme, optional username and password
- Display name and optional country code
- Routing rules (bypass / proxy-only domain lists)
- Which proxy is selected and whether the proxy is currently on
- A flag if another extension has taken over Chrome proxy settings

Proxy passwords are stored locally so the extension can authenticate to your proxy. They are not encrypted at rest by the extension. Anyone with access to your Chrome profile can read them.

This data never leaves your device except as described below.

## Data sent over the network

The extension does **not** operate an account, analytics, advertising, or crash-reporting backend.

When you test, ping, or look up a proxy, the extension may contact:

| Destination | Why |
| --- | --- |
| Your proxy server | To apply the proxy you configured and to authenticate if you saved credentials |
| `https://www.gstatic.com/generate_204` | Connectivity and latency check through the proxy |
| `https://ipwho.is/` | Optional country lookup for the proxy host or the proxy exit IP, used only to show a country flag/name in the UI |
| `https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/` | Static square flag images for the country badge in the popup |

These requests send the proxy hostname or IP, not your browsing history, page contents, or Chrome identity.

Clipboard copy/paste happens only after you click Copy or Paste in the popup. The extension does not read the clipboard in the background.

## Permissions

- **proxy** — turn the selected proxy on or off and apply routing rules
- **storage** — save your proxy list and rules on this device
- **webRequest** and **webRequestAuthProvider** — supply proxy username/password when the proxy asks for authentication
- **Host access (`<all_urls>`)** — required so proxy authentication and PAC routing can apply to any site you visit through the proxy. The extension does not read page content and does not inject scripts into websites.

## What we do not collect

- Browsing history
- Page content or form fields
- Cookies
- Google account data
- Precise location of the user (country is inferred only for the proxy server/exit IP)

## Sharing and selling data

We do not sell user data. We do not share proxy credentials with anyone. Third-party services listed above receive only the technical data needed for that feature (proxy host/IP for geo, or a connectivity probe).

## Children

The extension is not directed at children and does not knowingly collect personal information from children.

## Changes

If this policy changes, we will update this page and the “Last updated” date.

## Contact

Open an issue at [github.com/danilax9/oneclickproxy](https://github.com/danilax9/oneclickproxy/issues).
