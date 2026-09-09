# R1FT Client

An Electron launcher for Minecraft Java Edition, using **minecraft-launcher-core (MCLC)** and **MSMC**. The interface follows the dark charcoal, red accents, navigation rail, account preview, and instance panels in the original `assets/` screenshots.

## Run

Requires Node.js **22.12+** and npm.

```bash
npm install
npm start
```

For development with Vite reload:

```bash
npm run dev
```

`npm start` clears `ELECTRON_RUN_AS_NODE` for the Electron child process, so it also works from development environments that set that variable. If npm blocks installation scripts, run `node node_modules/electron/install.js` to download Electron.

## Features

- Rotating Minecraft news and Java patch notes from Mojang’s [news feed](https://launchercontent.mojang.com/news.json) and [Java patch-note feed](https://launchercontent.mojang.com/javaPatchNotes.json). Cards alternate between sources every eight seconds, with previous/next, direct selection, pause, and refresh controls. Rotation pauses while hovering, using keyboard focus, reading a post, or hiding the window.
- Click a news card to read the full Minecraft.net article in the launcher; patch notes retain their complete headings, lists, and links. Remote HTML is sanitized and links open in the system browser. Cached feeds and previously opened posts remain available offline. The feeds refresh every 15 minutes and retain the dates supplied by Mojang (the configured feeds currently serve archived entries).

- Microsoft sign-in through MSMC, Minecraft ownership checks, account switching, and refresh on launch.
- Local offline accounts with Minecraft-compatible deterministic UUIDs. Offline accounts work in singleplayer and on offline-mode servers; online-mode servers require Microsoft authentication.
- Separate game directories for every instance, with names, RAM overrides, playtime, last-played timestamps, and recoverable deletion through the OS trash.
- Vanilla, Fabric, Quilt, and Forge instances. Minecraft releases and optional snapshots come from Mojang’s version manifest; loader versions come from their metadata services.
- Automatic Eclipse Temurin Java selection and download using the game’s declared Java version. A custom Java executable can be selected in Settings.
- Live Modrinth search, pagination, sorting, Minecraft-version, loader, and category filters; project details and version selection.
- `.mrpack` installation with exact Minecraft/loader dependencies, required client files, common overrides, then client overrides. Optional client files and server-only files are skipped.
- Mods, resource packs, and shaders from Modrinth. Required dependencies are resolved and checked for Minecraft/loader compatibility. Existing pack files are identified by hash when updating content, avoiding duplicate mod versions.
- Enable/disable and remove installed content, open instance/save/log folders, launch/stop controls, download progress, and a redacted game console.
- Local skin closet: import valid Minecraft skin PNGs, rotate a 3D preview, choose classic/slim, select per account, export, and remove.
- Keyboard shortcuts: **Ctrl/Cmd+K** for quick actions, **/** to focus search, **Escape** to close dialogs.

## First launch

1. Open **Accounts** and add a Microsoft or offline account.
2. Choose **Create game**, pick a Minecraft version and loader, and name the instance. Alternatively, install a modpack from Discover.
3. Press **Launch**. Minecraft, libraries, assets, the loader, and Java are downloaded as needed.
4. Use an instance’s **Install** controls to find compatible mods or resource packs.

Initial installation needs an internet connection. Previously downloaded instances can be launched with an offline account without Microsoft authentication. Failed installs show an error in the status bar and can be retried.

## Build a desktop package

```bash
npm run pack    # Unpacked application under release/
npm run dist    # Installer / distributable for the current OS
```

Build targets are Windows NSIS, Linux AppImage, and macOS DMG. Build on the target OS for its installer and configure signing before distributing signed releases. The Linux executable is `release/linux-unpacked/r1ft-client`.

## Verification

```bash
npm test        # Filesystem, integrity, account, and transactional installation tests
npm run test:ui # Electron UI checks with live metadata and Modrinth access
npm run test:live # Opt-in real Fabric/Sodium install and Minecraft launch
node tests/pack-live.cjs # Opt-in real Modrinth pack installation
node tests/news-ui.cjs # Live news carousel and full-post UI checks
```

The UI test uses a temporary user-data directory. The live launch test keeps its downloaded Minecraft files in `.test-output/live-data` so retries do not redownload everything. It opens a real game window and stops it after renderer initialization. Tests require a graphical desktop for Electron and Minecraft; Linux CI can provide one with Xvfb.

Verified on Linux: Electron UI workflow, Vanilla 26.2, Fabric 1.21.1 with Sodium, Forge 1.21.1 first launch, Quilt 1.21.1, and Fabulously Optimized 6.5.0 pack installation.

## Data and credentials

Data lives in Electron’s OS-specific user-data folder, shown in Settings. R1FT Client reuses an existing XViper Launcher data folder when present so accounts, instances, and settings remain available after the rename. Instance directories contain each game’s saves, mods, and configuration; assets and libraries are shared in `cache/`; `launcher.json` contains settings and instance/account metadata. Java is cached in `runtimes/`; skin PNGs are in `skins/`.

Microsoft refresh tokens are encrypted through Electron `safeStorage`. When OS-backed encryption is unavailable (including Linux’s `basic_text` fallback), tokens remain in memory only and sign-in is required again after restart. Renderer IPC never returns tokens. Launch command lines are excluded from the log; known credentials are redacted from diagnostics.

The renderer uses a sandboxed preload, context isolation, a restricted IPC API, a Content Security Policy, and no Node integration. Modrinth downloads require HTTPS, approved hosts, and verified checksums. Pack files are path-checked and extracted into fresh staging directories. Content downloads finish before the live instance is updated, and failed commits restore its previous files.

## Current limits

- **NeoForge is not supported.** Packs requiring it fail with an explicit message before committing an instance.
- The skin closet is local storage and preview. It does **not** inject offline skins into Minecraft or upload a Microsoft skin. In-game custom offline skins require an appropriate skin mod.
- Shader packs need a compatible shader renderer (for example, Iris). Resource packs must be enabled in Minecraft’s own resource-pack menu.
- Microsoft authentication depends on Microsoft/Xbox/Minecraft services and account ownership. Interactive login cannot be verified without a user signing in.
- MCLC is a legacy upstream library. The dependency lock uses a maintained Request-compatible replacement and updated UUID/ZIP dependencies. `npm audit` still reports the upstream ZIP destination-symlink advisory. R1FT Client’s own pack extraction uses validated paths in fresh staging directories; MCLC also uses ZIP extraction for game natives. Do not install into manually symlinked game directories.
- This build was exercised on Linux; Windows/macOS installers require testing on those operating systems.

## Code map

- `electron/news.cjs`: cached Mojang feeds, article extraction, and HTML sanitization.
- `electron/main.cjs`: windows, IPC, account lifecycle, skins, instance controls, launch orchestration.
- `electron/runtime.cjs`: Minecraft metadata, Java installation, loader setup, including a Forge pre-install step so generated classes exist before Java starts.
- `electron/modrinth.cjs`: search, pack extraction, dependency resolution, transactional content installation.
- `electron/network.cjs`, `security.cjs`, `store.cjs`: streamed downloads, validation, and persistent state.
- `src/app.js`, `src/style.css`: application screens and interactions.
- `assets/`: original visual references, unchanged.

API references: [MCLC](https://github.com/Pierce01/MinecraftLauncher-core), [MSMC](https://github.com/Hanro50/MSMC), [Modrinth API](https://docs.modrinth.com/api/), [Modrinth pack format](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack), [Fabric metadata](https://meta.fabricmc.net/), [Quilt metadata](https://meta.quiltmc.org/), [Adoptium API](https://api.adoptium.net/q/swagger-ui/).

Original XViper project identity and reference designs: **MahfuzViper**. The original README is preserved in `docs/README-original.md`.
