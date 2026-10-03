# Security

## Reporting a problem

Please don't open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository instead, and include steps to reproduce.

## How the app is hardened

- **Current Electron.** Built on a supported Electron release, so Chromium and Node security fixes keep arriving.
- **Sandboxed UI.** The interface runs with context isolation and the Chromium sandbox on. It has no Node access and only talks to the app through a small, typed bridge.
- **Locked-down IPC.** Every request is checked to come from the app's own page, and most are refused while the app is locked.
- **No navigation, no pop-ups.** The window can't be pointed at another site, `window.open` is denied, and web permissions like the camera, microphone and location are refused.
- **Electron fuses.** The packaged exe can't be run as a Node runtime, ignores `NODE_OPTIONS` and debugger flags, only loads its own `app.asar`, and checks that archive's integrity at startup.
- **Validated settings.** Unknown keys and wrong types are dropped. Chromium launch flags that can start other programs (`--renderer-cmd-prefix`, `--gpu-launcher`, remote debugging and similar) are stripped. Paths must be absolute.
- **Contained file access.** The media protocol only serves files inside your download folder and the app's own data folder, and "open folder" actions are held to the same rule.
- **Cookies stay with X.** Requests that carry your X session only go to X hosts and refuse redirects. If a media host redirects, the retry is sent without cookies.
- **Encrypted at rest.** Settings, session, history, notifications and the media database are sealed with Windows data protection and AES-256-GCM. The PIN is stored as a salted scrypt hash.

## Known advisories

`npm audit` still reports two issues that have no fixed version yet. Neither affects how Xaver uses the package.

| Package | Where it's used | Why it's acceptable for now |
|---|---|---|
| `adm-zip` | Inside `@proxyshard/shardx`, to unpack its browser build | It only unpacks the ShardX archive, downloaded over HTTPS from ShardX's own servers. It never handles files from X or from users. |
| `http-cache-semantics` | Build tooling only (`electron-builder` → `@electron/get`) | Used once at build time to download Electron. It never ships in the app. |

Dependabot checks dependencies weekly, so these get picked up as soon as fixes land.
