const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const network = require('./network.cjs');
const { segment, safePath } = require('./security.cjs');
const API = 'https://api.modrinth.com/v2';
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge'];

function packManifest(zip) {
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry || entry.header.size > 10 * 1024 * 1024) throw new Error('Invalid Modrinth pack manifest');
  const index = JSON.parse(entry.getData().toString('utf8'));
  if (index.formatVersion !== 1 || index.game !== 'minecraft' || !Array.isArray(index.files) || index.files.length > 10000) throw new Error('Unsupported Modrinth pack format');
  const dependencies = index.dependencies || {};
  const unknown = Object.keys(dependencies).filter(k => !['minecraft', 'fabric-loader', 'quilt-loader', 'forge'].includes(k));
  if (unknown.length) throw new Error(`This pack requires ${unknown.join(', ')}. Supported loaders: Fabric, Quilt, and Forge.`);
  const minecraft = segment(dependencies.minecraft);
  const loaders = [['fabric-loader', 'fabric'], ['quilt-loader', 'quilt'], ['forge', 'forge']].filter(([key]) => dependencies[key]);
  if (loaders.length > 1) throw new Error('Pack specifies conflicting loaders');
  const [key, loader] = loaders[0] || [null, 'vanilla'];
  return { index, minecraft, loader, loaderVersion: key ? segment(dependencies[key]) : '' };
}
async function extractOverrides(zip, root) {
  let total = 0;
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const entry of zip.getEntries()) {
      if (!entry.entryName.startsWith(prefix) || entry.isDirectory) continue;
      if (((entry.attr >>> 16) & 0xf000) === 0xa000) throw new Error('Symlinks are not allowed in modpacks');
      total += entry.header.size;
      if (total > 1024 * 1024 * 1024 || entry.header.size > 256 * 1024 * 1024) throw new Error('Modpack overrides exceed the extraction limit');
      const destination = safePath(root, entry.entryName.slice(prefix.length));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, entry.getData());
    }
  }
}
class Modrinth {
  constructor(store, event, net = network) { this.store = store; this.event = event; this.net = net; }
  async search({ query = '', type = 'modpack', loader = '', version = '', category = '', sort = 'relevance', offset = 0 } = {}) {
    if (!['modpack', 'mod', 'resourcepack', 'shader'].includes(type)) throw new Error('Invalid project type');
    const facets = [[`project_type:${type}`]];
    if (loader) facets.push([`categories:${segment(loader)}`]);
    if (version) facets.push([`versions:${segment(version)}`]);
    if (category) facets.push([`categories:${segment(category)}`]);
    const params = new URLSearchParams({ query: String(query).slice(0, 200), facets: JSON.stringify(facets), index: ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance', limit: '20', offset: String(Math.max(0, Math.min(10000, Number(offset) || 0))) });
    return this.net.json(`${API}/search?${params}`);
  }
  async project(id) { return this.net.json(`${API}/project/${segment(id)}`); }
  async versions(id, { minecraft, loader } = {}) {
    const params = new URLSearchParams();
    if (minecraft) params.set('game_versions', JSON.stringify([minecraft]));
    if (loader && loader !== 'vanilla') {
      const project = await this.project(id);
      if (['mod', 'modpack'].includes(project.project_type)) params.set('loaders', JSON.stringify([loader]));
    }
    return this.net.json(`${API}/project/${segment(id)}/version?${params}`);
  }
  async installPack(versionId) {
    const version = await this.net.json(`${API}/version/${segment(versionId)}`);
    const project = await this.project(version.project_id);
    if (project.project_type !== 'modpack') throw new Error('Select a Modrinth modpack');
    const file = version.files.find(f => f.primary && f.filename.endsWith('.mrpack')) || version.files.find(f => f.filename.endsWith('.mrpack'));
    if (!file) throw new Error('This release has no .mrpack file');
    const id = crypto.randomUUID();
    const staging = path.join(this.store.root, 'staging', id);
    const gameRoot = path.join(staging, 'game');
    await fs.mkdir(gameRoot, { recursive: true });
    try {
      this.event({ phase: 'installing', message: `Downloading ${project.title}`, percent: 0 });
      const archive = path.join(staging, 'pack.mrpack');
      await this.net.download(file.url, archive, file.hashes);
      const zip = new AdmZip(archive);
      const { index, minecraft, loader, loaderVersion } = packManifest(zip);
      const files = index.files.filter(f => f.env?.client !== 'unsupported' && f.env?.client !== 'optional');
      const seen = new Set();
      for (let n = 0; n < files.length; n++) {
        const item = files[n]; const target = safePath(gameRoot, item.path);
        if (seen.has(target.toLowerCase())) throw new Error('Duplicate file path in modpack');
        seen.add(target.toLowerCase());
        if (!Array.isArray(item.downloads) || !item.downloads.length) throw new Error(`No download for ${item.path}`);
        this.event({ phase: 'installing', message: `${project.title} · ${item.path}`, percent: Math.round(n / Math.max(1, files.length) * 95) });
        let error;
        for (const url of item.downloads) {
          try { await this.net.download(url, target, item.hashes); error = null; break; } catch (e) { error = e; }
        }
        if (error) throw error;
      }
      await extractOverrides(zip, gameRoot);
      const instance = { id, name: `${project.title} ${version.version_number}`, minecraft, loader, loaderVersion, icon: project.icon_url, createdAt: Date.now(), playtime: 0, lastPlayed: null, modrinth: { projectId: project.id, versionId: version.id }, installed: [] };
      await fs.mkdir(path.join(this.store.root, 'instances'), { recursive: true });
      await fs.rename(gameRoot, path.join(this.store.root, 'instances', id));
      this.store.data.instances.push(instance);
      try { this.store.save(); }
      catch (error) {
        this.store.data.instances = this.store.data.instances.filter(i => i.id !== id);
        await fs.rm(path.join(this.store.root, 'instances', id), { recursive: true, force: true });
        throw error;
      }
      this.event({ phase: 'complete', message: `${project.title} is ready to play`, percent: 100 });
      return instance;
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  async indexContent(instance) {
    // Identify pack-provided or manually added files, so updating a mod cannot leave two versions.
    const records = [...(instance.installed || [])];
    if (!this.net.request) return records;
    const root = this.store.instancePath(instance.id);
    const unknown = [];
    for (const [folder, type] of [['mods', 'mod'], ['resourcepacks', 'resourcepack'], ['shaderpacks', 'shader']]) {
      const files = await fs.readdir(path.join(root, folder), { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
      for (const file of files) {
        if (!file.isFile() || !/\.(jar|zip)(\.disabled)?$/.test(file.name)) continue;
        const relative = `${folder}/${file.name}`;
        if (records.some(r => r.path === relative.replace(/\.disabled$/, ''))) continue;
        const data = await fs.readFile(safePath(root, relative));
        unknown.push({ hash: crypto.createHash('sha1').update(data).digest('hex'), path: relative.replace(/\.disabled$/, ''), type });
      }
    }
    for (let offset = 0; offset < unknown.length; offset += 100) {
      const batch = unknown.slice(offset, offset + 100);
      const response = await this.net.request(`${API}/version_files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: batch.map(f => f.hash), algorithm: 'sha1' }) });
      const versions = await response.json();
      for (const file of batch) {
        const version = versions[file.hash];
        if (version) records.push({ projectId: version.project_id, versionId: version.id, name: version.name, type: file.type, path: file.path });
      }
    }
    return records;
  }
  async installContent(instanceId, versionId) {
    const instance = this.store.instance(instanceId);
    const root = this.store.instancePath(instanceId);
    const resolved = new Map();
    const visiting = new Set();
    const collect = async (id) => {
      segment(id);
      if (visiting.has(id)) return;
      visiting.add(id);
      if (visiting.size > 200) throw new Error('Dependency graph is too large');
      const version = await this.net.json(`${API}/version/${id}`);
      const project = await this.project(version.project_id);
      const type = project.project_type;
      if (!['mod', 'resourcepack', 'shader'].includes(type)) throw new Error('Unsupported content type');
      if (!version.game_versions.includes(instance.minecraft)) throw new Error(`${project.title} does not support Minecraft ${instance.minecraft}`);
      if (type === 'mod' && !version.loaders.includes(instance.loader)) throw new Error(`${project.title} requires a compatible mod loader. Create a Fabric, Quilt, or Forge instance.`);
      if (resolved.has(project.id) && resolved.get(project.id).version.id !== version.id) throw new Error(`Conflicting dependency versions for ${project.title}`);
      resolved.set(project.id, { project, version, type });
      for (const dependency of version.dependencies || []) {
        if (dependency.dependency_type !== 'required') continue;
        let dependencyId = dependency.version_id;
        if (!dependencyId && dependency.project_id) {
          const available = await this.versions(dependency.project_id, instance);
          dependencyId = available[0]?.id;
        }
        if (!dependencyId) throw new Error(`A required dependency of ${project.title} cannot be resolved automatically`);
        await collect(dependencyId);
      }
    };
    await collect(versionId);
    const indexed = await this.indexContent(instance);
    const staging = path.join(this.store.root, 'staging', crypto.randomUUID());
    await fs.mkdir(staging, { recursive: true });
    const changes = []; const committed = []; const backup = [];
    try {
      let n = 0;
      for (const { project, version, type } of resolved.values()) {
        const file = version.files.find(f => f.primary) || version.files[0];
        if (!file) throw new Error(`No download for ${project.title}`);
        const folder = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }[type];
        if ((type === 'mod' && !file.filename.endsWith('.jar')) || file.filename.includes('/')) throw new Error('Unsupported content filename');
        const relative = `${folder}/${file.filename}`;
        const target = safePath(root, relative);
        if (changes.some(c => c.target === target)) throw new Error('Two projects use the same filename');
        this.event({ phase: 'installing', message: `Installing ${project.title}`, percent: Math.round(n++ / resolved.size * 90) });
        const source = path.join(staging, `${n}.download`);
        await this.net.download(file.url, source, file.hashes);
        changes.push({ source, target, record: { projectId: project.id, versionId: version.id, name: project.title, icon: project.icon_url, type, path: relative } });
      }
      // Download and validate the entire graph before changing the live instance.
      for (const change of changes) {
        const old = indexed.filter(i => i.projectId === change.record.projectId);
        const targets = new Set([change.target, ...old.flatMap(i => [safePath(root, i.path), safePath(root, i.path + '.disabled')])]);
        for (const target of targets) {
          if (await fs.stat(target).catch(() => null)) {
            const saved = path.join(staging, `backup-${backup.length}`);
            await fs.rename(target, saved); backup.push({ target, saved });
          }
        }
        await fs.mkdir(path.dirname(change.target), { recursive: true });
        await fs.rename(change.source, change.target); committed.push(change.target);
      }
      const previous = instance.installed || [];
      instance.installed = [...indexed.filter(i => !resolved.has(i.projectId)), ...changes.map(c => c.record)];
      try { this.store.save(); } catch (e) { instance.installed = previous; throw e; }
      this.event({ phase: 'complete', message: `Installed ${changes.length} project${changes.length === 1 ? '' : 's'}`, percent: 100 });
      return instance;
    } catch (error) {
      for (const target of committed) await fs.rm(target, { force: true });
      for (const { target, saved } of backup.reverse()) await fs.rename(saved, target);
      throw error;
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
}
module.exports = { Modrinth, packManifest, extractOverrides, LOADERS };
