const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const { News } = require('./news.cjs');
const { Store } = require('./store.cjs');
const { Modrinth, LOADERS } = require('./modrinth.cjs');
const runtime = require('./runtime.cjs');
const { offlineAuth, publicAccount, safePath, scrubLog } = require('./security.cjs');

app.setName('R1FT Client');
// Keep existing installations and encrypted account records available after the rename.
const legacyData = path.join(app.getPath('appData'), 'XViper Launcher');
if (!process.env.R1FT_TEST_DATA && require('node:fs').existsSync(path.join(legacyData, 'launcher.json')) && !require('node:fs').existsSync(path.join(app.getPath('userData'), 'launcher.json'))) app.setPath('userData', legacyData);
if (process.env.R1FT_TEST_DATA) app.setPath('userData', process.env.R1FT_TEST_DATA);
let window, store, modrinth, news, busy = false, authenticating = false, running = null;
let status = { phase: 'idle', message: 'Ready to play', percent: 0 };
let logs = [], secrets = []; const sessions = new Map();
function event(value) {
  status = { ...status, ...value };
  if (window && !window.isDestroyed()) window.webContents.send('launcher:event', status);
}
function log(value) {
  const line = scrubLog(value, secrets).slice(0, 12000);
  logs.push(line); if (logs.length > 1200) logs.shift();
  if (window && !window.isDestroyed()) window.webContents.send('launcher:log', line);
}
function state() { return { ...store.public(), status, running: running?.id || null, totalMemory: Math.floor(os.totalmem() / 1024 / 1024), secureStorage: secure() }; }
function secure() { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'); }
function saveSession(account, xbox) {
  const token = xbox.save(); sessions.set(account.id, token);
  if (secure()) account.refresh = safeStorage.encryptString(token).toString('base64');
  else delete account.refresh;
}
async function authorize(account) {
  if (account.type === 'offline') return offlineAuth(account.name);
  const token = sessions.get(account.id) || (account.refresh && secure() ? safeStorage.decryptString(Buffer.from(account.refresh, 'base64')) : null);
  if (!token) throw new Error('Sign in to this Microsoft account again from Accounts.');
  let xbox;
  try { xbox = await new Auth('select_account').refresh(token); }
  catch { throw new Error('Your Microsoft session expired. Sign in again from Accounts.'); }
  const minecraft = await xbox.getMinecraft();
  if (minecraft.isDemo() || !minecraft.profile?.id) throw new Error('This Microsoft account does not own Minecraft Java Edition.');
  if (minecraft.profile.id !== account.id) throw new Error('Account identity changed; sign in again.');
  account.name = minecraft.profile.name; saveSession(account, xbox); store.save();
  return minecraft.mclc();
}
async function exclusive(action) {
  if (busy || running) throw new Error('Wait for the current operation or stop Minecraft first.');
  busy = true;
  try { return await action(); }
  catch (error) { event({ phase: 'error', message: scrubLog(error.message || String(error), secrets), percent: 0 }); throw error; }
  finally { busy = false; }
}
function handle(name, action) {
  ipcMain.handle('launcher:' + name, async (e, ...args) => {
    const allowed = process.env.R1FT_DEV === '1' ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
    if (e.sender !== window?.webContents || e.senderFrame !== window.webContents.mainFrame || e.senderFrame.url !== allowed) throw new Error('Untrusted IPC caller');
    try { return { ok: true, value: await action(...args) }; }
    catch (error) { return { ok: false, error: scrubLog(error.message || String(error), secrets) }; }
  });
}
function register() {
  handle('state', state);
  handle('news', force => news.list(force === true));
  handle('news-post', id => news.post(id));
  handle('news-link', async value => { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Link not allowed'); await shell.openExternal(url.href); });
  handle('versions', () => runtime.versions(store));
  handle('loaders', ({ minecraft, loader }) => runtime.loaderVersions(minecraft, loader));
  handle('offline-add', (name) => {
    const auth = offlineAuth(name);
    let account = store.data.accounts.find(a => a.id === auth.uuid);
    if (!account) { account = { id: auth.uuid, name, type: 'offline' }; store.data.accounts.push(account); }
    store.data.selectedAccount = account.id; store.save(); return state();
  });
  handle('microsoft-add', async () => {
    if (authenticating) throw new Error('A Microsoft sign-in window is already open.');
    authenticating = true;
    try {
      const manager = new Auth('select_account');
      const xbox = await manager.launch('electron', { parent: window, width: 520, height: 720, autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      const minecraft = await xbox.getMinecraft();
      if (minecraft.isDemo() || !minecraft.profile?.id) throw new Error('This Microsoft account does not own Minecraft Java Edition.');
      let account = store.data.accounts.find(a => a.id === minecraft.profile.id);
      if (!account) { account = { id: minecraft.profile.id, name: minecraft.profile.name, type: 'microsoft' }; store.data.accounts.push(account); }
      account.name = minecraft.profile.name; saveSession(account, xbox);
      store.data.selectedAccount = account.id; store.save(); return state();
    } finally { authenticating = false; }
  });
  handle('account-select', (id) => { if (!store.data.accounts.some(a => a.id === id)) throw new Error('Account not found'); store.data.selectedAccount = id; store.save(); return state(); });
  handle('account-remove', (id) => {
    store.data.accounts = store.data.accounts.filter(a => a.id !== id); sessions.delete(id);
    if (store.data.selectedAccount === id) store.data.selectedAccount = store.data.accounts[0]?.id || null;
    store.save(); return state();
  });
  handle('instance-create', (input) => exclusive(async () => {
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw new Error('Give your instance a name');
    if (!LOADERS.includes(input.loader)) throw new Error('Unsupported loader');
    const manifest = await runtime.versions(store);
    const found = manifest.versions.find(v => v.id === input.minecraft);
    if (!found) throw new Error('Select an available Minecraft version');
    let loaderVersion = '';
    if (input.loader !== 'vanilla') {
      const available = await runtime.loaderVersions(input.minecraft, input.loader);
      loaderVersion = input.loaderVersion || available[0]?.version;
      if (!available.some(v => v.version === loaderVersion)) throw new Error('No compatible loader is available for this Minecraft version');
    }
    const instance = { id: crypto.randomUUID(), name, minecraft: found.id, versionType: found.type, loader: input.loader, loaderVersion, createdAt: Date.now(), lastPlayed: null, playtime: 0, installed: [] };
    await fs.mkdir(path.join(store.root, 'instances', instance.id), { recursive: true });
    store.data.instances.push(instance); store.save(); return instance;
  }));
  handle('instance-update', ({ id, name, memory }) => exclusive(async () => {
    const instance = store.instance(id);
    if (typeof name === 'string' && name.trim()) instance.name = name.trim().slice(0, 80);
    if (memory !== undefined) { if (!Number.isInteger(memory) || memory < 512 || memory > os.totalmem() / 1024 / 1024) throw new Error('Memory must be between 512 MB and your system memory'); instance.memory = memory; }
    store.save(); return instance;
  }));
  handle('instance-delete', (id) => exclusive(async () => {
    const instance = store.instance(id);
    const answer = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Keep instance', 'Delete instance'], defaultId: 0, cancelId: 0, title: 'Delete instance?', message: `Delete “${instance.name}”?`, detail: 'This removes the instance and its saves, mods, and settings.' });
    if (answer.response !== 1) return false;
    // The instance directory is moved to the OS trash so saves can be recovered.
    await shell.trashItem(store.instancePath(id));
    store.data.instances = store.data.instances.filter(i => i.id !== id); store.save(); return true;
  }));
  handle('folder', async ({ id, folder = '' } = {}) => {
    if (!['', 'mods', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots', 'logs'].includes(folder)) throw new Error('Invalid folder');
    const root = id ? store.instancePath(id) : store.root;
    const target = folder ? path.join(root, folder) : root;
    await fs.mkdir(target, { recursive: true }); const error = await shell.openPath(target); if (error) throw new Error(error);
  });
  handle('content-list', async (id) => {
    const root = store.instancePath(id); const result = {};
    for (const folder of ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots']) {
      result[folder] = (await fs.readdir(path.join(root, folder), { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; }))
        .filter(f => !f.isSymbolicLink()).map(f => ({ name: f.name, directory: f.isDirectory(), enabled: !f.name.endsWith('.disabled') }));
    }
    return result;
  });
  handle('content-toggle', ({ id, folder, name }) => exclusive(async () => {
    if (!['mods', 'resourcepacks', 'shaderpacks'].includes(folder) || name.includes('/')) throw new Error('Invalid content');
    const root = store.instancePath(id); const source = safePath(root, `${folder}/${name}`);
    const target = name.endsWith('.disabled') ? source.slice(0, -9) : source + '.disabled';
    if (await fs.stat(target).catch(() => null)) throw new Error('A file with the destination name already exists');
    await fs.rename(source, target); return true;
  }));
  handle('content-remove', ({ id, folder, name }) => exclusive(async () => {
    if (!['mods', 'resourcepacks', 'shaderpacks'].includes(folder) || name.includes('/')) throw new Error('Invalid content');
    await shell.trashItem(safePath(store.instancePath(id), `${folder}/${name}`));
    const instance = store.instance(id);
    instance.installed = (instance.installed || []).filter(i => i.path !== `${folder}/${name.replace(/\.disabled$/, '')}`);
    store.save(); return true;
  }));
  handle('search', input => modrinth.search(input));
  handle('project', id => modrinth.project(id));
  handle('project-versions', ({ id, instanceId, minecraft, loader }) => modrinth.versions(id, instanceId ? store.instance(instanceId) : { minecraft, loader }));
  handle('pack-install', id => exclusive(() => modrinth.installPack(id)));
  handle('content-install', ({ instanceId, versionId }) => exclusive(() => modrinth.installContent(instanceId, versionId)));
  handle('launch', id => exclusive(async () => {
    const instance = store.instance(id);
    const account = store.data.accounts.find(a => a.id === store.data.selectedAccount);
    if (!account) throw new Error('Add or select an account before launching.');
    event({ phase: 'launching', message: 'Preparing your game', percent: 0 }); logs = [];
    const authorization = await authorize(account);
    secrets = [authorization.access_token, authorization.client_token];
    const meta = await runtime.metadata(store, instance.minecraft);
    const java = await runtime.ensureJava(store, meta.javaVersion?.majorVersion || 8, event);
    const loader = await runtime.prepareLoader(store, instance, event, java, log);
    const client = new Client();
    client.on('data', log);
    // Never forward the command line or the arguments event. Keep diagnostics useful.
    client.on('debug', value => { if (!String(value).includes('Launching with arguments')) log(value); });
    client.on('progress', p => event({ phase: 'launching', message: `Downloading ${p.type || 'game files'}`, percent: p.total ? Math.min(100, Math.round(p.task / p.total * 100)) : 0 }));
    client.on('download-status', p => p.type !== 'assets' && event({ phase: 'launching', message: `Downloading ${p.name || 'Minecraft'}`, percent: p.total ? Math.min(100, Math.round(p.current / p.total * 100)) : 0 }));
    let mclcError = null;
    client.on('error', e => { mclcError = e; log(e.message || e); });
    const root = store.instancePath(id);
    const versionJson = path.join(store.root, `metadata-${instance.minecraft}.json`);
    const child = await client.launch({ authorization, root, javaPath: java, version: { number: instance.minecraft, type: instance.versionType || meta.type || 'release', ...(loader.custom ? { custom: loader.custom } : {}) }, ...(loader.forge ? { forge: loader.forge } : {}), memory: { min: '512M', max: `${instance.memory || store.data.settings.memory}M` }, window: { width: 1280, height: 720 }, overrides: { detached: false, versionJson, assetRoot: path.join(store.root, 'cache', 'assets'), libraryRoot: path.join(store.root, 'cache', 'libraries') }, timeout: 90000 });
    if (!child || !child.pid) throw new Error(mclcError?.message || 'Minecraft could not start. Check Java in Settings and the game log.');
    const start = Date.now(); running = { id, child }; instance.lastPlayed = start; store.save();
    event({ phase: 'running', message: `${instance.name} is running`, percent: 100, instanceId: id });
    let ended = false;
    const finish = code => {
      const stopped = running?.stopping;
      if (ended) return; ended = true;
      instance.playtime = (instance.playtime || 0) + Date.now() - start; store.save(); running = null; secrets = [];
      event({ phase: code === 0 || stopped ? 'idle' : 'error', message: code === 0 || stopped ? 'Game closed. Ready to play.' : `Minecraft exited (${code ?? 'stopped'}). Open the game log for details.`, percent: 0, instanceId: null });
      if (window && !window.isDestroyed()) { window.show(); window.webContents.send('launcher:refresh'); }
    };
    child.once('close', finish); child.once('error', e => { log(e.message); finish(-1); });
    if (child.exitCode !== null) finish(child.exitCode);
    else if (store.data.settings.closeOnLaunch) window.hide();
    return true;
  }));
  handle('stop', async () => { if (running) { running.stopping = true; running.child.kill(); event({ message: 'Stopping Minecraft…' }); } });
  handle('logs', () => logs);
  handle('settings-save', settings => {
    if (!Number.isInteger(settings.memory) || settings.memory < 512 || settings.memory > os.totalmem() / 1024 / 1024) throw new Error('Choose a valid memory allocation');
    store.data.settings = { memory: settings.memory, javaPath: String(settings.javaPath || '').slice(0, 1000), autoJava: Boolean(settings.autoJava), snapshots: Boolean(settings.snapshots), closeOnLaunch: Boolean(settings.closeOnLaunch) };
    store.save(); return state();
  });
  handle('java-pick', async () => { const result = await dialog.showOpenDialog(window, { title: 'Select the Java executable (java or java.exe)', properties: ['openFile'] }); return result.canceled ? null : result.filePaths[0]; });
  handle('skin-import', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Import a Minecraft skin', filters: [{ name: 'Minecraft skin', extensions: ['png'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('Skin must be smaller than 1 MB');
    const image = nativeImage.createFromPath(file); const size = image.getSize();
    if (size.width !== 64 || ![32, 64].includes(size.height)) throw new Error('Choose a 64×64 or 64×32 Minecraft skin PNG');
    const skin = { id: crypto.randomUUID(), name: path.basename(file, '.png').slice(0, 80), model: 'default' };
    const root = path.join(store.root, 'skins'); await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, skin.id + '.png'), image.toPNG());
    store.data.skins.push(skin); store.save(); return skin;
  });
  handle('skin-data', async id => { if (!store.data.skins.some(s => s.id === id)) throw new Error('Skin not found'); return 'data:image/png;base64,' + (await fs.readFile(path.join(store.root, 'skins', id + '.png'))).toString('base64'); });
  handle('skin-equip', ({ id, model }) => {
    const skin = store.data.skins.find(s => s.id === id); const account = store.data.accounts.find(a => a.id === store.data.selectedAccount);
    if (!skin || !account) throw new Error('Select a skin and an account first');
    skin.model = model === 'slim' ? 'slim' : 'default'; account.skinId = id; store.save(); return state();
  });
  handle('skin-export', async id => {
    const skin = store.data.skins.find(s => s.id === id); if (!skin) throw new Error('Skin not found');
    const result = await dialog.showSaveDialog(window, { defaultPath: skin.name + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!result.canceled) await fs.copyFile(path.join(store.root, 'skins', id + '.png'), result.filePath);
  });
  handle('skin-delete', async id => {
    const skin = store.data.skins.find(s => s.id === id); if (!skin) throw new Error('Skin not found');
    await fs.rm(path.join(store.root, 'skins', id + '.png'), { force: true });
    store.data.skins = store.data.skins.filter(s => s.id !== id);
    for (const a of store.data.accounts) if (a.skinId === id) delete a.skinId;
    store.save(); return state();
  });
  handle('external', async url => { const u = new URL(url); if (u.protocol !== 'https:' || !['modrinth.com', 'www.minecraft.net', 'minecraft.net', 'support.modrinth.com'].includes(u.hostname) || u.username || u.password) throw new Error('External link not allowed'); await shell.openExternal(u.href); });
  handle('window', action => { if (action === 'minimize') window.minimize(); if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize(); if (action === 'close') window.close(); });
}
function createWindow() {
  window = new BrowserWindow({ width: 1420, height: 900, minWidth: 1000, minHeight: 680, frame: false, icon: path.join(__dirname, 'icon.png'), backgroundColor: '#101011', title: 'R1FT Client', show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.once('ready-to-show', () => window.show());
  window.on('close', e => {
    if (busy || running) { e.preventDefault(); window.show(); dialog.showMessageBox(window, { type: 'info', message: running ? 'Stop Minecraft before closing the launcher.' : 'Wait for the current installation or launch to finish.', buttons: ['OK'] }); }
  });
  if (process.env.R1FT_DEV === '1') window.loadURL('http://127.0.0.1:5173/');
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData')); modrinth = new Modrinth(store, event); news = new News(store.root); register(); createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { dialog.showErrorBox('R1FT Client could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
