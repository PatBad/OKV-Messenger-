# OKV Messenger

A small message board that sits on top of every window on the clinic's computers, so Practice Principal, Clinical Team, Reception and everyone else can pass messages to each other.

- **Collapsed**, it's just the OKV logo floating at the edge of the screen. A red badge shows how many new messages there are for you, and a pulsing ring means one is urgent.
- **Expanded**, it's the message board: every message from every department, newest at the bottom.

There is no server and no internet requirement. Every computer keeps its own complete copy of the message history and shares it directly with the other computers on the clinic network.

## Using it

| To… | Do this |
| --- | --- |
| Open the board | Click the logo |
| Move the logo | Drag it anywhere on screen (it remembers where) |
| Minimise back to the logo | Click **—** or press **Esc** |
| Send | Type and press **Enter** (**Shift+Enter** for a new line) |
| Send to one department | Choose it in the **To** box (default is Everyone) |
| Flag something urgent | Click **Urgent** before sending; it plays a louder alert and shows in red |
| Filter | **All**, **For us** (sent to your department or everyone), **From us**, **Urgent** |
| Search | Magnifying glass, or **Ctrl+F** |
| Settings / Quit | Gear icon in the board, or right-click the OKV icon in the Windows system tray |

The first time it runs, the app asks which department the computer belongs to. You can change this later in Settings.

## Installing on a clinic computer

1. Download `OKV-Messenger-Setup-x.y.z.exe` from the [Releases page](https://github.com/PatBad/OKV-Messenger-/releases/latest).
2. Run it. The installer isn't code-signed, so Windows may show "Windows protected your PC". Click **More info → Run anyway**.
3. Windows asks once for administrator permission. That adds the firewall rules the computers need to talk to each other. If you decline, the app still works, but messages can take a few seconds longer to arrive on that computer.
4. Pick the department. That's it: the app starts with Windows from now on.

The installer puts the app in the current Windows user's profile, so future updates install silently without any admin prompt.

## How messages get between computers

- Every running copy announces itself on the local network every few seconds (UDP port **41234**).
- When two computers notice their histories differ, they compare them and copy across whatever the other is missing (TCP ports **41235–41239**). New messages are also sent directly to every computer the moment you press Send.
- A computer that was switched off catches up automatically the next time it starts, as long as any other computer that has the messages is on.
- Messages are only accepted from private network addresses (192.168.x.x, 10.x.x.x, 172.16–31.x.x).

Each computer stores its history in `%APPDATA%\OKV Messenger\history\messages.jsonl`. Settings > "Open message history folder" opens it. Back up that file to keep a permanent copy.

**Computers on different network segments:** discovery only reaches computers on the same subnet. If some clinic computers are on another subnet, add their IP addresses to `staticPeers` in `%APPDATA%\OKV Messenger\config.json`, e.g. `"staticPeers": ["192.168.2.15"]`, then restart the app.

## Updates

Installed copies check this repository's GitHub Releases 30 seconds after starting and every 4 hours after that. A new version downloads in the background. It installs, and the app restarts itself a few seconds later, the next time the board is minimised, so it never interrupts someone typing. Staff can also click **Restart now** in the banner or in Settings.

> **The repository needs to be public** for the update check to work, because installed copies download releases without logging in to GitHub. The code contains no passwords or clinic data (messages never leave the clinic network), so making it public is safe. If it must stay private, updates have to be installed by hand from the Releases page.

### Releasing an update

1. Make and test your changes (`npm start`, `npm test`).
2. Bump the version. This commits and creates a tag such as `v1.0.1`:
   ```bash
   npm version patch
   ```
3. Push the commit and the tag:
   ```bash
   git push --follow-tags
   ```
4. GitHub Actions (`.github/workflows/release.yml`) runs the tests, builds the installer and publishes it as a release. Every clinic computer picks it up within 4 hours, or straight away on restart.

To publish from your own PC instead, set a `GH_TOKEN` environment variable (a GitHub token with `repo` access) and run `npm run release`.

## Development

Requires Node.js 22 or newer.

```bash
npm install
```

```bash
npm start
```

| Command | What it does |
| --- | --- |
| `npm start` | Run the app from source |
| `npm test` | Run the storage and network-sync tests |
| `npm run dist` | Build the installer into `dist/` without publishing |
| `npm run icons` | Regenerate the icon files from `assets/logo.svg` |

### Changing the logo

Replace `assets/logo.svg` with the clinic's logo (square artwork looks best, since it's shown in a circle), then run `npm run icons` to regenerate the `.ico`/`.png` files used by the installer, tray icon and window.

### Running two copies for testing

These environment variables let several copies run on one PC without clashing, and keep traffic on localhost so no firewall prompt appears:

```powershell
$env:OKV_DATA_DIR = "$PWD\.dev-data\a"; $env:OKV_BIND = "127.0.0.1"; $env:OKV_UDP_PORT = "42234"; $env:OKV_TCP_PORT = "42235"; $env:OKV_PEERS = "127.0.0.1:42334"; npm start
```

```powershell
$env:OKV_DATA_DIR = "$PWD\.dev-data\b"; $env:OKV_BIND = "127.0.0.1"; $env:OKV_UDP_PORT = "42334"; $env:OKV_TCP_PORT = "42335"; $env:OKV_PEERS = "127.0.0.1:42234"; npm start
```

### Project layout

```
src/main/main.js       Window (expand/collapse, drag, always on top), tray, IPC
src/main/store.js      Message history on disk + validation + fingerprints for sync
src/main/network.js    Peer discovery (UDP) and sync (HTTP) between computers
src/main/updater.js    Auto-update from GitHub Releases
src/main/config.js     Per-computer settings (department, icon position, …)
src/preload.js         The safe bridge between the window and the main process
src/renderer/          The interface (HTML/CSS/JS, no framework)
build/installer.nsh    Adds the Windows Firewall rules during first install
test/                  node:test suites
```

## Troubleshooting

- **"No other computers found"**: check both computers are on the same network and running OKV Messenger. Check the firewall rules exist by running `netsh advfirewall firewall show rule name="OKV Messenger"`. To add them by hand, run the installer again as an administrator.
- **Logs**: `%APPDATA%\OKV Messenger\logs\okv.log`
- **Logo disappeared off-screen** (e.g. after unplugging a monitor): right-click the tray icon → **Move icon back to the corner**.
