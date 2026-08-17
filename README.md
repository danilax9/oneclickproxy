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

## Set up your own proxy server

You can deploy a private HTTP/HTTPS proxy on a Linux VPS with [3proxy-install](https://github.com/a0s/3proxy-install). OneClick Proxy works with the HTTP proxy it creates.

**Requirements:** Debian, Ubuntu, Fedora, CentOS, AlmaLinux, Rocky, Oracle Linux, or Arch; root access; outbound internet from the server.

1. SSH into your VPS as root (or use `sudo -i`).

2. Run the installer:

```bash
bash <(curl -s https://raw.githubusercontent.com/a0s/3proxy-install/master/3proxy-install.sh)
```

3. Follow the prompts:
   - Confirm the server public IP
   - Choose HTTP port (default `3128`) and SOCKS port (default `1080`; not used by OneClick Proxy)
   - Pick DNS resolvers

4. At the end, the script creates a proxy user and prints credentials in this format:

```
http://username:password@YOUR_SERVER_IP:3128
```

5. Copy that URL into OneClick Proxy (Add proxy screen) or paste it from the clipboard.

To add more users later, run the same command again on the server — the script opens a management menu.

> Open the HTTP port you chose (e.g. `3128/tcp`) in your VPS firewall and cloud security group, or the proxy will not be reachable from your browser.

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
