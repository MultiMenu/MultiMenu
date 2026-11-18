MultiMenu is a free, open-source Roblox account manager and multi-instance launcher for Windows 10/11.

## Download
- **MultiMenu-Setup.exe**: installer (recommended, updates itself)
- **MultiMenu-Portable.zip**: no install, unzip and run `MultiMenu.exe`

Check the files against `SHA256SUMS.txt`. The app isn't code-signed yet, so Windows SmartScreen may warn on first run: choose **More info → Run anyway**.

## What's in it
- **Accounts**: logins encrypted with Windows DPAPI; Main, Important and Filler tiers; tags and saved filters; groups, colours, notes, inbox badges; a recycle bin; open roblox.com as any account; a security check, Robux totals and limited item values
- **OpenMulti**: run many Roblox clients side by side, launch batches into one server, tile windows (as tiny as you like), presets and schedules, rotation, auto-scaling and per-game profiles
- **24/7 Watcher**: auto-rejoin after crashes, kicks, freezes and stuck loading screens; pauses while your internet or Roblox is down
- **Performance**: Alt performance presets, lighter rendering, eco mode, RAM trimmer, background limiter, PC monitor and capacity test
- **Automation**: "when this happens, do that" automations, auto clicker, macro recorder, anti-AFK
- **Alerts and remote control**: Discord webhooks and bot, Telegram, ntfy, Pushover, email, voice alerts, phone dashboard, Stream Deck, command line and local API
- **Extras**: Alt Wall, overlay labels, share codes, theme studio and gallery, light mode, Doctor, Wrapped, achievements, Ctrl+K search, encrypted backups, auto-updates
- **Languages**: English, Español, Deutsch, Français, Português (Brasil), Norsk, Italiano, Polski, Türkçe, Русский, Bahasa Indonesia, Tiếng Việt, Filipino

## New in 3.1.1
Community suggestions from the Discord.
- **Hold Roblox updates** (Sessions & Tiling → Roblox updates): Roblox's installer closes every open client when it updates, which kicked alts that had been farming for hours. Hold updates while a client is open, or always until you press **Update Roblox now**. While updates are held, MultiMenu starts the Roblox you already have and stops the installer if anything else starts it.
- **Discord status your way**: turn it off, hide the alt count or the game, or write your own two lines ("Idling", say) with {count} and {game} if you want them.
- **Join another server when a server link fails**: if an account can't get into the server you picked (full, closing, or "already in"), it joins a different server of the same game instead of sitting on an error screen.
- **Launch in batches** (Settings → Launching): start a few accounts, wait until they're all in game and the PC has calmed down, then start the next few.
- **Hide Roblox title bars** (Sessions & Tiling): windows show only the game.
- **Hotkeys you press instead of type**: click a hotkey box and press the keys. The tile hotkey (Ctrl+Alt+T by default; F5 works too) is now set right on the Tiling page.
- **A DM with a Rejoin button when an alt closes** (Discord → Remote control): your bot messages you, you tap Rejoin, it's back. Works from anywhere.
- **Wallpaper Engine backgrounds** (Theme studio → Video → From Wallpaper Engine): use a video wallpaper you already have in Wallpaper Engine as MultiMenu's background.
- **Potato preset** (Performance → Alt performance): for AFK farming. Everything Roblox allows to be turned down at once: 5 FPS, lowest graphics, lowest textures, no anti-aliasing, grey sky, no grass, lighting paused, lowest-detail models, tiny and minimised windows, muted, eco mode and the RAM Trimmer. Main accounts keep full quality.
- **Reduce motion** for alts: turns on Roblox's own Reduce motion setting (fewer camera and interface animations).
- **Use less CPU and RAM** (Settings → Performance): a **Use the least CPU and RAM** button, plus the settings it turns on:
  - **Background checks**: normal, relaxed (half as often) or slow (a quarter as often) for MultiMenu's frequent checks on your clients.
  - **Pause page updates while hidden**: minimised or in the tray, MultiMenu stops redrawing live numbers (on by default).
  - **Free MultiMenu's memory when hidden**: a minute after you hide it, Windows moves its unused memory out of RAM (on by default), and a **Free now** button.
  - **Pause effects when MultiMenu isn't in front**: particles and a video background stop while you're in Roblox (on by default). Particles also draw at 30 frames a second now.
  - **End Roblox's crash reporters**: every client starts a RobloxCrashHandler.exe that just waits for a crash; ending them frees some RAM per client (off by default).

## Fixed in 3.1.1
Bug fixes from community reports.
- **MultiMenu closing with many clients open**: renaming, minimising, pinning and moving Roblox windows no longer waits on a client that is busy loading. That wait could freeze MultiMenu until Windows closed it. Window pictures (Alt Wall, switcher, hatch alerts, watcher screenshots) are now taken one set at a time, and finding new clients' Roblox logs is much lighter.
- **Accounts closing by themselves**: "Move clients to fresh servers after a game update" is now off unless you turn it on. Roblox marks a game updated whenever its page is edited too, so it closed every client in that game for nothing.
- **Clients getting stuck or lagging while hatching**: eco mode now gives background alts below-normal priority instead of the lowest (idle) priority, which starved them of CPU when many clients were busy at once. Before the 24/7 Watcher calls a client frozen, it now gives it full speed for a moment, so a slow client isn't restarted.
- **Minimised clients opening again**: auto-tile (after a launch, when a client reaches a game, or when monitors change) leaves windows you minimised alone. The Tile button still arranges every window.
- **Tiling**: layouts only count windows that have opened, so there are no gaps for clients still loading. Clients that open late are tiled once they reach a game, and a tile asked for while one is running isn't lost. Tiny alts stay tiny when auto-tile moves them.
- **Tiny windows**: a window Roblox keeps growing back is left at Roblox's size after 3 tries, instead of being resized over and over (every resize made the game stutter).
- **Overlay labels floating around**: name labels hide while a window is moving, never show where another window covers them, and refresh their text less often.
- **RAM Trimmer**: it comes back on when MultiMenu starts if it was running before, and it asks Windows for only the access trimming needs, which Roblox clients were refusing. The Roblox window you're using is no longer trimmed by the timer, so it doesn't stutter.
- **Background limiter**: it stays on after you restart MultiMenu.
- If MultiMenu ever closes by itself, it now says so the next time it opens and keeps a crash file in its logs folder, so a bug report can show what happened.

## New in 3.1
### Accounts
- **Items & security** (Accounts → Items & security), a new page that only reads, never changes anything:
  - **Security check**: which accounts have 2-step verification, a verified email, a phone number and an account PIN, with a rating and what to fix. Email addresses and phone numbers are never shown or kept.
  - **Robux**: every account's Robux and pending Robux, totalled, and which ones have Premium.
  - **Limited items**: how many limiteds each account has and what they're worth (Rolimons value, or RAP if you switch Rolimons off), with the best items shown.
  - **Game passes & badges**: enter a game and see which of your accounts own each of its passes and badges.

### Servers
- **Your private servers** (Servers & Games): every private server your accounts own, when it ends and whether it renews. Launch alts straight into one, or save it to your games. MultiMenu warns you a few days before one that won't renew runs out.
- **Smart join**: put alts in the server with the lowest ping or the fewest players, or **spread them out** a few per server.

### Hatch alerts and a hatch counter
- **Hatch alerts** (Alerts → Hatch alerts): get pinged on Discord, by bot DM, on your phone or out loud the moment one of your accounts hatches a rare pet, with a screenshot, and see how many each account has hatched. Works with any game: add its place ID, the words it shows for a rare hatch and the pet names. MultiMenu watches what the game prints, Roblox badges and the text on each Roblox window (Windows' own text recognition); it never touches the game.
- `/mm hatches` in the Discord bot shows recent hatches and totals.

### Saved games remember accounts
- Pick accounts, then press the new 👥 button on a saved game or private server: from then on its ▶ launches those accounts with nothing picked. Picking accounts still overrides it for one launch.

### Running lots of alts
- **Roblox update guard** (Sessions & Tiling): when Roblox has an update, the first alt installs it and the rest of the launch queue waits until it's done, instead of every alt downloading it at once. On by default.
- **All monitors**: choose "All monitors (spread out)" as the tiling monitor and windows are shared between your screens by size, each tiled with your layout.
- **Volume mixer** (Sessions & Tiling → Volume): a volume for each alt, remembered per account and set again every time it starts.
- **Network** (Performance → PC monitor): download and upload speed, data used today and this month, about how much each alt uses, and a **data cap** that warns at 80 % and can close Filler alts when you reach it.
- **Fresh restarts** (24/7 Watcher): every few hours each alt is restarted back into the same server, one at a time with a gap, so long sessions stay smooth and they never all drop together. Main accounts and the window you're using are left alone. Off until you turn it on.

### Finding out what happened
- **Logs** (24/7 Watcher → Logs): every Roblox log on your PC with the alt it belongs to, a search across all of them, filters for disconnects, errors, joins and teleports, and a "Why alts disconnected" list with each error code explained.

### Getting started
- A **Getting started** checklist on the dashboard ticks itself off as you add an account, launch, tile, pick a performance preset, turn on the watcher, set up alerts and save a preset. Hide it with ✕ (it comes back in Settings).

### Fixes
- The 24/7 Watcher no longer says an alt is "stuck loading" while it's hatching eggs or doing anything else in game. It used to treat any teleport line in the Roblox log as leaving the server; now an alt only counts as loading again once it has really left its server for a teleport.

### Also
- New alerts you can send to Discord and your phone: rare hatch, private server running out, fresh restart, data cap and Roblox updating.
- Everything new is translated into all 13 languages.

## New in 3.0

- **Discord status**: while alts are running, your Discord profile shows "Playing MultiMenu" with how many are running and the game (never account names), plus a "Get MultiMenu" button. Needs the Discord app open on the same PC.
- **Launch queue**: a "Launching 3 of 12" chip in the title bar opens the queue: the order with an ETA for each, drag to reorder, launch one next, remove one, "Next now" to skip the wait, or clear the rest.
- **Draw your own layout** (Sessions & Tiling): draw zones on a picture of your monitor, then tile into them. Works in presets, game profiles and share codes.
- **Pinned windows stay pinned**: pins are remembered per account (so they come back after a rejoin), there's a pin button on the Alt Wall, and a "Pin the window in front" hotkey.
- **Find a game** (Servers & Games): search Roblox games by name, see players and likes, then launch your chosen accounts, open its servers, or save it.
- **Export account list** (Accounts → More): usernames, groups, notes and more to a spreadsheet (CSV) or a text list. Never passwords or logins.
- **Sign in all**: after a bulk add (Accounts → Bulk add, one `username:password` per line), press **Sign in all** and each Roblox sign-in opens by itself as soon as the last one finishes, with the username filled in and the password on your clipboard. Close the Roblox window to stop.

Some features were inspired by RoALT (© inspectsoftware, MIT License) and re-implemented here. See NOTICE.md for all credits.

MultiMenu never stores your Roblox password in plain text and has no telemetry. It only talks to Roblox, GitHub (updates and the theme gallery list), rolimons.com (item values on Items & security, which you can switch off), the Discord app on your own PC (for your Discord status) and the alert services you set up yourself (Discord, Telegram, ntfy, Pushover, email). Logins, cookies and passwords are never sent to any of them.
