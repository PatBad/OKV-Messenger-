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
| Move the open board | Drag it by its top bar; the logo moves with it to the nearest corner |
| Resize the open board | Drag any edge or corner. It remembers the size you choose (smallest allowed is 340 × 440) |
| Minimise back to the logo | Click **—** or press **Esc** |
| Send | Type and press **Enter** (**Shift+Enter** for a new line) |
| Send a GIF | Paste one (Ctrl+V, or pick one in the Windows emoji panel with Win + ;) or drop a GIF file onto the board, add a caption if you like and press Send. GIFs can be up to 15 MB. Every PC keeps its own copy, so they work without internet |
| Attach files and images | Click the paperclip beside the message box, paste (Ctrl+V; screenshots and files copied in Explorer work), or drop files onto the board. Up to 5 files of up to 15 MB each per message. Images show in the chat and open larger when clicked; other files show with **Open** and **Save a copy**. Programs, scripts, web pages (.exe, .bat, .ps1, .lnk, .html …), SVGs and macro-enabled Office files can't be sent |
| Find a shared file again | The **Media** tab lists the images, files and GIFs shared in chat (filter by All / Images / Files, or search by name or sender). Click a picture to enlarge it; **Show in chat** jumps to the message. Files are kept for 7 days, then archived automatically |
| Reply to a message | Point at it and click the reply arrow. A "Replying to…" strip appears above the message box, and the reply goes to the department that sent the original (change **To** if you want). The reply shows a quote of the original; click the quote to jump to it. **Esc** cancels the reply |
| Send a quick message | Click one of the buttons above the message box (such as "Client has arrived"). It sends straight away, with a few seconds to **Undo**. Change the buttons in **Settings → Quick messages** (wording, who it goes to, urgent or not) |
| Fix a typo | Point at your own message, click **⋯** then **Edit message**. You can edit for 15 minutes after sending, and it shows "edited". Only the department that sent a message can edit it |
| See who has read a message | Under messages your department sent: "✓ Seen by Clinical Team · 10:32". For a message to everyone it lists the departments that have seen it; hover it to see who is still to see it. A message counts as seen once it has been on screen for a second |
| Pin a notice for everyone | Click the pin in the toolbar and type the notice, or use **⋯ → Pin as a notice** on a message. It stays at the top of every board until someone clicks its ✕. A new notice replaces the old one |
| Quiet mode | Click the bell at the top of the board for 30 minutes or an hour of no sound. The badge still counts new messages, and **urgent** messages still make a sound |
| Send to one department | Choose it in the **To** box (default is Everyone) |
| Flag something urgent | Click **Urgent** before sending; it plays a louder alert and shows in red |
| Filter | **All**, **For us** (sent directly to your department), **From us**, **Urgent** |
| React to a message | Point at it and click 👌 👍 😂 😅 or the custom “Dead inside” face. Reactions show under the message on every computer, e.g. "👍 You, Reception". Click your reaction again to take it back |
| Delete a message | Point at it and click the bin. **For me** hides it on this computer only. **For everyone** removes it from every computer, and is only offered for messages your department sent. **Undo** appears for a few seconds afterwards |
| Tidy up earlier days | Earlier days are folded into one banner each (showing how many messages, urgent and new ones it holds). Click a banner to open or fold that day. An open day's banner stays pinned at the top while you scroll through it |
| Delete a whole day | Point at a day's banner and click its bin. **For me** hides all of that day's messages on this computer; **Ours for everyone** removes the ones your department sent from every computer. It only deletes what's shown under the banner, so in the **Urgent** tab it only deletes that day's urgent messages. **Undo** appears afterwards |
| Search | Magnifying glass, or **Ctrl+F** |
| Set a reminder for someone | Switch to **Reminders**, pick their department, type their name (names used before are suggested), write the reminder and optionally tick **Due** to set a time. It stays until it’s dealt with |
| Deal with a reminder | Reminders for your department appear under **For us** (the tab shows how many are open, red if any are overdue). When one falls due, that department’s computers chime and the logo pulses. Click **✓ Done** when it’s handled; the department that sent it can **Cancel** it instead. Closed reminders move to **Done**, which you can clear on your own computer |
| Log a repeat script request | A client phones in for chronic medication: switch to **Medications**, type the patient's name and surname, then the medication and the number of caps / tabs / mls / tubs. **Tab** moves along the boxes; press **+** (it's the next stop after the number) for a second medication, and **Enter** in the number box adds the request. The vets' computers chime and show it under **To dispense**, longest-waiting first |
| Tick a request off | Click the circle beside it when the medication is ready. The request moves to **Done** (with **Undo** for a few seconds), and every computer in the department that logged it gets a **blue ✓ badge** on the logo (and a blue number on the Medications tab) plus a rising chime. Opening **Medications** clears it. The department that logged a request can **Cancel** it instead; **Reopen** puts a finished one back. Done requests stay listed for 14 days, and **Clear done** tidies the list on your own computer |
| Settings / Quit | Gear icon in the board, or right-click the OKV icon in the Windows system tray. Settings also shows which computers are on the network (with their versions, and when offline ones were last seen), and lets you save messages as a spreadsheet or back everything up |

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

"Delete for everyone", reactions, reminders, medication requests, edits, "seen" receipts and pinned notices travel between computers the same way messages do, so a computer that was off catches up when it starts.

A GIF is stored once on each PC in `history\gifs\`, named by a fingerprint of its contents; the message only carries that fingerprint, and each PC fetches any GIF it is missing directly from another PC on the clinic network. (On PCs still on an older version, a GIF message shows as "[GIF]".)

### Automatic tidy-up and backups

Attached files and images are archived sooner: after **7 days** (`ATTACHMENT_RETENTION_DAYS` in `src/main/constants.js`) their files move to `history\archive\files\` and leave the Media tab, while the messages themselves stay on the board for the full 14 days (showing "archived" where the file was). Files on a message that was deleted for everyone are removed straight away. Each file is stored once per computer, named by a fingerprint of its contents, and computers fetch files they're missing directly from each other; `history\files` holds them.

Every computer keeps the last **14 days** of messages "live". Anything older is archived automatically when the app starts and every few hours afterwards: messages move to `history\archive\messages-YYYY-MM.jsonl` and their GIFs to `history\archive\gifs\`. Archived messages no longer show on the board, but they aren't lost: **Settings → History → Save as spreadsheet → Everything, including the archive** includes them. Messages that were deleted are not archived, and their GIFs are removed. The same rule runs on every computer, so they stay in step; the number of days is `RETENTION_DAYS` in `src/main/constants.js` (changing it needs a new release).

**Settings → History** can also save a day or week of messages as a CSV spreadsheet, and **Back up everything** copies the whole `history` folder and the settings into a dated folder you choose (a USB drive or a network folder, say). To restore a backup, close OKV Messenger, copy the backup's `history` folder over `%APPDATA%\OKV Messenger\history`, and start it again.

Each computer stores its history in `%APPDATA%\OKV Messenger\history\messages.jsonl`. Deleting never removes a message from that file: deletions are recorded separately (`deletions.jsonl` for everyone, `hidden.jsonl` for this computer only) and the message is just hidden from the board. Settings > "Open message history folder" opens it. Back up that file to keep a permanent copy.

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

The development-only variable `OKV_TEST_PICK` (a folder path) makes the export, backup and "Save a copy" buttons save into that folder instead of opening file dialogs, and stops "Open" launching programs, so they can be tested automatically.

### Project layout

```
src/main/main.js       Window (expand/collapse, drag, always on top), tray, IPC
src/main/store.js      History on disk (messages, deletions, reactions, reminders, medication requests) + validation + sync fingerprints
src/main/network.js    Peer discovery (UDP) and sync (HTTP) between computers
src/main/gifs.js      GIF files kept on this PC: checking, storing by fingerprint
src/main/geometry.js   Window-resizing maths
src/main/exporter.js   Saving messages as CSV, reading the archive, backups
src/main/files.js      Attached files: safety checks (blocked types, programs by content), storage by fingerprint
src/main/media.js      What the Media tab lists
src/main/updater.js    Auto-update from GitHub Releases
src/main/config.js     Per-computer settings (department, icon position, board size, …)
src/preload.js         The safe bridge between the window and the main process
src/renderer/          The interface (HTML/CSS/JS, no framework)
build/installer.nsh    Adds the Windows Firewall rules during first install
assets/reactions/      Custom reaction pictures (e.g. "Dead inside")
test/                  node:test suites
```

## Troubleshooting

- **"No other computers found"**: check both computers are on the same network and running OKV Messenger. Check the firewall rules exist by running `netsh advfirewall firewall show rule name="OKV Messenger"`. To add them by hand, run the installer again as an administrator.
- **Logs**: `%APPDATA%\OKV Messenger\logs\okv.log`
- **Logo disappeared off-screen** (e.g. after unplugging a monitor): right-click the tray icon → **Move icon back to the corner**.
