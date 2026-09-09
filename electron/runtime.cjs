const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const AdmZip = require('adm-zip');
const tar = require('tar');
const { json, download, request } = require('./network.cjs');
const { safePath, segment, verifyHash } = require('./security.cjs');
const exec = promisify(execFile);
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
async function versions(store) {
  const cache = path.join(store.root, 'version-manifest.json');
  try { const data = await json(MANIFEST); await fs.writeFile(cache, JSON.stringify(data)); return data; }
  catch (error) { try { return JSON.parse(await fs.readFile(cache, 'utf8')); } catch { throw error; } }
}
async function metadata(store, version) {
  segment(version);
  const cache = path.join(store.root, `metadata-${version}.json`);
  try { return JSON.parse(await fs.readFile(cache, 'utf8')); } catch {}
  const manifest = await versions(store);
  const entry = manifest.versions.find(v => v.id === version);
  if (!entry) throw new Error('Minecraft version was not found');
  const data = await json(entry.url);
  await fs.writeFile(cache, JSON.stringify(data)); return data;
}
async function javaVersion(binary) {
  try {
    const result = await exec(binary, ['-version'], { timeout: 15000, windowsHide: true });
    const match = (result.stderr + result.stdout).match(/version "(?:1\.)?(\d+)/);
    return Number(match?.[1]) || 0;
  } catch { return 0; }
}
async function findJava(root) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isFile() && ['java', 'java.exe'].includes(entry.name) && path.basename(root) === 'bin') return file;
    if (entry.isDirectory()) { const found = await findJava(file); if (found) return found; }
  }
}
async function ensureJava(store, major, event) {
  const settings = store.data.settings;
  if (!settings.autoJava) {
    const binary = settings.javaPath || 'java';
    const found = await javaVersion(binary);
    if (!found) throw new Error('Java was not found. Enable automatic Java in Settings or choose a Java executable.');
    if (found !== major) throw new Error(`This game needs Java ${major}; the selected executable is Java ${found}. Enable automatic Java or select Java ${major}.`);
    return binary;
  }
  const runtimeRoot = path.join(store.root, 'runtimes', String(major));
  const cached = await findJava(runtimeRoot).catch(() => null);
  if (cached && await javaVersion(cached) === major) return cached;
  if (await javaVersion('java') === major) return 'java';
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64', ia32: 'x86' }[process.arch];
  if (!os || !arch) throw new Error('Automatic Java is unavailable on this platform. Select Java in Settings.');
  event({ phase: 'launching', message: `Finding Java ${major}`, percent: 0 });
  const releases = await json(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`);
  const pkg = releases[0]?.binary?.package;
  if (!pkg) throw new Error(`No Java ${major} runtime is available. Set a Java path in Settings.`);
  const staging = runtimeRoot + '.staging';
  await fs.rm(staging, { recursive: true, force: true }); await fs.mkdir(staging, { recursive: true });
  const archive = staging + (os === 'windows' ? '.zip' : '.tar.gz');
  try {
    await download(pkg.link, archive, { sha256: pkg.checksum }, (received, total) => event({ phase: 'launching', message: `Downloading Java ${major}`, percent: total ? Math.round(received / total * 100) : 0 }));
    if (os === 'windows') {
      const zip = new AdmZip(archive);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const dest = safePath(staging, entry.entryName);
        await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, entry.getData());
      }
    } else {
      await tar.x({ file: archive, cwd: staging, strict: true, preservePaths: false });
    }
    const binary = await findJava(staging);
    if (!binary || await javaVersion(binary) !== major) throw new Error('Downloaded Java runtime could not be verified');
    await fs.rm(runtimeRoot, { recursive: true, force: true });
    await fs.rename(staging, runtimeRoot);
    return path.join(runtimeRoot, path.relative(staging, binary));
  } finally { await fs.rm(archive, { force: true }); await fs.rm(staging, { recursive: true, force: true }); }
}
async function loaderVersions(minecraft, loader) {
  segment(minecraft);
  if (loader === 'vanilla') return [];
  if (loader === 'fabric' || loader === 'quilt') {
    const host = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
    return (await json(`${host}/versions/loader/${minecraft}`)).map(v => ({ version: v.loader.version, stable: v.loader.stable !== false }));
  }
  if (loader === 'forge') {
    const data = await json('https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json');
    return (data[minecraft] || []).map(v => ({ version: v.startsWith(minecraft + '-') ? v.slice(minecraft.length + 1) : v, stable: true })).reverse();
  }
  throw new Error('Unsupported loader');
}
async function installForge(store, instance, installer, java, event, log) {
  const cache = path.join(store.root, 'cache');
  const coordinate = `${instance.minecraft}-${instance.loaderVersion}`;
  const marker = path.join(cache, 'forge-installs', coordinate + '.json');
  const zip = new AdmZip(installer);
  const profileText = zip.readAsText('version.json');
  if (!profileText) throw new Error('This legacy Forge installer is not supported. Choose a newer Forge release.');
  const profile = JSON.parse(profileText);
  const generated = profile.libraries.filter(lib => lib.downloads?.artifact?.url === '').map(lib => lib.downloads.artifact);
  const verifyGenerated = async () => {
    for (const artifact of generated) {
      const target = safePath(path.join(cache, 'libraries'), artifact.path);
      try { verifyHash(await fs.readFile(target), { sha1: artifact.sha1 }); }
      catch { return false; }
    }
    return true;
  };
  if (await fs.stat(marker).catch(() => null) && await verifyGenerated()) return;
  event({ phase: 'launching', message: `Installing Forge ${instance.loaderVersion} — preparing patched game`, percent: 0 });
  const meta = await metadata(store, instance.minecraft);
  const base = path.join(cache, 'versions', instance.minecraft);
  await fs.mkdir(base, { recursive: true });
  await fs.writeFile(path.join(base, instance.minecraft + '.json'), JSON.stringify(meta));
  const client = path.join(base, instance.minecraft + '.jar');
  if (!await fs.stat(client).catch(() => null)) await download(meta.downloads.client.url, client, { sha1: meta.downloads.client.sha1 });
  const launcherProfiles = path.join(cache, 'launcher_profiles.json');
  if (!await fs.stat(launcherProfiles).catch(() => null)) await fs.writeFile(launcherProfiles, JSON.stringify({ profiles: {}, settings: {} }));
  await new Promise((resolve, reject) => {
    const child = spawn(java, ['-Djava.awt.headless=true', '-jar', installer, '--installClient', cache], { cwd: cache, windowsHide: true });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Forge installation timed out. Please retry.')); }, 10 * 60 * 1000);
    child.stdout.on('data', data => log(data.toString())); child.stderr.on('data', data => log(data.toString()));
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Forge installer exited with code ${code}. Check the game log.`)); });
  });
  if (!await verifyGenerated()) throw new Error('Forge generated files failed verification. Please retry.');
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, JSON.stringify({ installed: Date.now() }));
}
async function prepareLoader(store, instance, event, java, log = () => {}) {
  if (instance.loader === 'vanilla') return {};
  const root = store.instancePath(instance.id);
  const mc = segment(instance.minecraft), loader = segment(instance.loaderVersion);
  event({ phase: 'launching', message: `Preparing ${instance.loader} ${loader}`, percent: 0 });
  if (instance.loader === 'forge') {
    const coordinate = `${mc}-${loader}`;
    const file = path.join(root, 'loader', `forge-${coordinate}-installer.jar`);
    if (!await fs.stat(file).catch(() => null)) {
      const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${coordinate}/forge-${coordinate}-installer.jar`;
      const sha1 = (await (await request(url + '.sha1')).text()).trim().split(/\s/)[0];
      await download(url, file, { sha1 });
    }
    await installForge(store, instance, file, java, event, log);
    return { forge: file };
  }
  if (!['fabric', 'quilt'].includes(instance.loader)) throw new Error('Unsupported loader');
  const id = `${instance.loader}-loader-${loader}-${mc}`;
  const file = path.join(root, 'versions', id, `${id}.json`);
  if (!await fs.stat(file).catch(() => null)) {
    const host = instance.loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
    const profile = await json(`${host}/versions/loader/${mc}/${loader}/profile/json`);
    profile.id = id;
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(profile));
  }
  return { custom: id };
}
module.exports = { versions, metadata, javaVersion, ensureJava, loaderVersions, prepareLoader, installForge };
