# OneClick Proxy

Chrome extension for fast HTTP/HTTPS proxy switching with authentication.

## Features

- Turn proxy on or off with one click
- Multiple proxies, pick a default
- Routing rules: bypass listed domains or proxy only whitelisted domains
- Basic connectivity check when adding a proxy
- Edit and delete with confirmation
- Export and import settings as JSON
- Hotkey: `Alt+Shift+P`

## Install

1. Download the latest release ZIP from [Releases](https://github.com/danilax9/oneclickproxy/releases)
2. Extract the archive
3. Open `chrome://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked**
6. Select the extracted folder

> Chrome will show a warning that the extension is not from the Chrome Web Store. This is expected for manual installs.

## Proxy format

```
https://user:pass@proxy.example.com:3128
http://proxy.example.com:8080
```

Supported schemes: `http` and `https`.

## Routing rules

**Bypass** — listed domains go direct, everything else uses the proxy.

```
*.example.com
localhost
```

**Proxy only** — only listed domains use the proxy.

```
chatgpt.com
*.google.com
```

## Export / import

Settings → Export / Import saves or loads a JSON file with your proxy list and rules. All data stays in the browser.

## Limitations

- HTTP/HTTPS proxies only
- Add-time connectivity check is basic and does not guarantee every site will work
- Passwords are stored locally in `chrome.storage.local` without encryption
- If another proxy extension overrides settings, disable it or use only one proxy extension

## Development

After changes, reload the extension on `chrome://extensions`.

## License

MIT
