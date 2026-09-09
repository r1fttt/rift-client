const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { safePath, offlineAuth, publicAccount, verifyHash, downloadUrl, scrubLog } = require('../electron/security.cjs');
const { Store } = require('../electron/store.cjs');
const { Modrinth, packManifest, extractOverrides } = require('../electron/modrinth.cjs');
const checksum = data => ({ sha512: crypto.createHash('sha512').update(data).digest('hex') });
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r1ft-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return new Store(root); }
function pack(dependencies = { minecraft: '1.21.1', 'fabric-loader': '0.16.10' }, files = []) { const zip = new AdmZip(); zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ game: 'minecraft', formatVersion: 1, dependencies, files }))); return zip; }
test('offline UUID matches Minecraft OfflinePlayer UUID and names are validated', () => {
  assert.equal(offlineAuth('Notch').uuid, 'b50ad385829d3141a2167e7d7539ba7f');
  assert.equal(offlineAuth('Viper').uuid, offlineAuth('Viper').uuid);
  assert.notEqual(offlineAuth('Viper').uuid, offlineAuth('viper').uuid);
  for (const name of ['', 'ab', 'a'.repeat(17), 'player name', '../bad', '<script>']) assert.throws(() => offlineAuth(name));
});
test('download paths reject traversal, Windows escape syntax, and reserved filenames', () => {
  for (const bad of ['../secrets', 'a/../../secrets', '/tmp/evil', 'C:/evil', 'a\\..\\evil', 'mods/CON.jar', 'a./b', 'mods/../a', '.', 'a\0b']) assert.throws(() => safePath('/tmp/game', bad), bad);
  assert.equal(safePath('/tmp/game', 'mods/good.jar'), path.resolve('/tmp/game', 'mods', 'good.jar'));
});
test('checksums are required and mismatches fail', () => { const data = Buffer.from('verified content'); verifyHash(data, checksum(data)); assert.throws(() => verifyHash(Buffer.from('tampered'), checksum(data))); assert.throws(() => verifyHash(data, {})); });
test('downloads permit only trusted HTTPS hosts and do not accept userinfo or ports', () => {
  assert.equal(downloadUrl('https://cdn.modrinth.com/data/a.jar'), 'https://cdn.modrinth.com/data/a.jar');
  for (const url of ['http://cdn.modrinth.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://cdn.modrinth.com.evil.com/a', 'https://user@cdn.modrinth.com/a', 'https://cdn.modrinth.com:123/a']) assert.throws(() => downloadUrl(url));
});
test('public account projection and log redaction do not expose credentials', () => {
  assert.deepEqual(publicAccount({ id: 'id', name: 'Steve', type: 'microsoft', refresh: 'secret', access_token: 'token' }), { id: 'id', name: 'Steve', type: 'microsoft', skinId: undefined });
  assert.equal(scrubLog('hello opaque-secret --accessToken token Bearer another', ['opaque-secret']), 'hello [redacted] --accessToken [redacted] Bearer [redacted]');
});
test('state persists accounts and settings without leaking tokens through public reads', async t => {
  const store = await fixture(t); store.data.accounts.push({ id: 'a', name: 'Player', type: 'microsoft', refresh: 'encrypted' }); store.data.settings.memory = 3072; store.save();
  const reopened = new Store(store.root); assert.equal(reopened.data.settings.memory, 3072); assert.equal(reopened.public().accounts[0].refresh, undefined);
});
test('packs reject unsupported loaders and conflicting loader declarations', () => {
  assert.equal(packManifest(pack()).loader, 'fabric'); assert.equal(packManifest(pack({ minecraft: '1.21.1' })).loader, 'vanilla');
  assert.throws(() => packManifest(pack({ minecraft: '1.21.1', neoforge: '21.1.0' })), /requires neoforge/);
  assert.throws(() => packManifest(pack({ minecraft: '1.21.1', forge: '52.0.0', 'fabric-loader': '0.16.10' })), /conflicting/);
});
test('client overrides win over common overrides; server overrides are excluded', async t => {
  const store = await fixture(t); const zip = pack();
  zip.addFile('overrides/config/test.txt', Buffer.from('common')); zip.addFile('client-overrides/config/test.txt', Buffer.from('client')); zip.addFile('server-overrides/server.properties', Buffer.from('server'));
  await extractOverrides(zip, store.root);
  assert.equal(await fs.readFile(path.join(store.root, 'config/test.txt'), 'utf8'), 'client');
  await assert.rejects(fs.stat(path.join(store.root, 'server.properties')));
});
function mockPackNetwork(zip, fail = false) {
  return {
    json: async url => url.includes('/version/') ? { id: 'v1', project_id: 'p1', version_number: '1.0', files: [{ primary: true, filename: 'pack.mrpack', url: 'https://cdn.modrinth.com/pack', hashes: checksum(zip.toBuffer()) }] } : { id: 'p1', title: 'Test Pack', project_type: 'modpack' },
    download: async (url, target) => { if (fail && url.endsWith('/mod')) throw new Error('Network interrupted'); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, url.endsWith('/pack') ? zip.toBuffer() : 'mod bytes'); }
  };
}
test('pack install skips optional/server files, commits isolated instance and cleans staging', async t => {
  const store = await fixture(t); const zip = pack(undefined, [{ path: 'mods/required.jar', downloads: ['https://cdn.modrinth.com/mod'] }, { path: 'mods/server.jar', env: { client: 'unsupported' } }, { path: 'mods/optional.jar', env: { client: 'optional' } }]);
  const api = new Modrinth(store, () => {}, mockPackNetwork(zip)); const instance = await api.installPack('v1');
  assert.equal(instance.loaderVersion, '0.16.10'); assert.equal(store.data.instances.length, 1);
  assert.deepEqual(await fs.readdir(path.join(store.instancePath(instance.id), 'mods')), ['required.jar']);
  assert.deepEqual(await fs.readdir(path.join(store.root, 'staging')), []);
});
test('failed pack download does not create a partial instance', async t => {
  const store = await fixture(t); const zip = pack(undefined, [{ path: 'mods/required.jar', downloads: ['https://cdn.modrinth.com/mod'] }]);
  const api = new Modrinth(store, () => {}, mockPackNetwork(zip, true)); await assert.rejects(api.installPack('v1'), /interrupted/);
  assert.equal(store.data.instances.length, 0); assert.deepEqual(await fs.readdir(path.join(store.root, 'staging')), []);
});
function mockContentNetwork({ incompatible = false, failDependency = false } = {}) {
  const projects = { main: { id: 'main', title: 'Main Mod', project_type: 'mod' }, dep: { id: 'dep', title: 'Required API', project_type: 'mod' } };
  const versions = { mainV: { id: 'mainV', project_id: 'main', game_versions: [incompatible ? '1.20.1' : '1.21.1'], loaders: ['fabric'], files: [{ filename: 'main.jar', url: 'https://cdn.modrinth.com/main', hashes: {} }], dependencies: [{ dependency_type: 'required', version_id: 'depV' }] }, depV: { id: 'depV', project_id: 'dep', game_versions: ['1.21.1'], loaders: ['fabric'], files: [{ filename: 'dep.jar', url: 'https://cdn.modrinth.com/dep', hashes: {} }], dependencies: [] } };
  return { json: async url => { const id = url.split('/').at(-1); return url.includes('/version/') ? versions[id] : projects[id]; }, download: async (url, target) => { if (failDependency && url.endsWith('/dep')) throw new Error('Dependency download failed'); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, url.endsWith('/dep') ? 'dependency' : 'new main'); } };
}
async function instanceFixture(t) { const store = await fixture(t); store.data.instances.push({ id: 'test', minecraft: '1.21.1', loader: 'fabric', installed: [{ projectId: 'main', versionId: 'oldV', path: 'mods/old.jar' }] }); await fs.mkdir(path.join(store.instancePath('test'), 'mods'), { recursive: true }); await fs.writeFile(path.join(store.instancePath('test'), 'mods/old.jar'), 'old main'); return store; }
test('mod installation resolves required dependencies and removes the previous project version', async t => {
  const store = await instanceFixture(t); const api = new Modrinth(store, () => {}, mockContentNetwork());
  await api.installContent('test', 'mainV'); assert.deepEqual((await fs.readdir(path.join(store.instancePath('test'), 'mods'))).sort(), ['dep.jar', 'main.jar']); assert.equal(store.instance('test').installed.length, 2);
});
test('incompatible mods fail before touching the game folder', async t => {
  const store = await instanceFixture(t); const api = new Modrinth(store, () => {}, mockContentNetwork({ incompatible: true }));
  await assert.rejects(api.installContent('test', 'mainV'), /does not support/); assert.deepEqual(await fs.readdir(path.join(store.instancePath('test'), 'mods')), ['old.jar']);
});
test('failed dependency download preserves the installed version', async t => {
  const store = await instanceFixture(t); const api = new Modrinth(store, () => {}, mockContentNetwork({ failDependency: true }));
  await assert.rejects(api.installContent('test', 'mainV'), /Dependency download failed/); assert.equal(await fs.readFile(path.join(store.instancePath('test'), 'mods/old.jar'), 'utf8'), 'old main'); assert.deepEqual(await fs.readdir(path.join(store.instancePath('test'), 'mods')), ['old.jar']);
});
test('failed state commit rolls back live files and in-memory install records', async t => {
  const store = await instanceFixture(t); store.save = () => { throw new Error('Disk full'); }; const api = new Modrinth(store, () => {}, mockContentNetwork());
  await assert.rejects(api.installContent('test', 'mainV'), /Disk full/); assert.deepEqual(await fs.readdir(path.join(store.instancePath('test'), 'mods')), ['old.jar']); assert.equal(store.instance('test').installed[0].versionId, 'oldV');
});
test('pack state failure removes both the new instance directory and its record', async t => {
  const store = await fixture(t); store.save = () => { throw new Error('Disk full'); };
  const api = new Modrinth(store, () => {}, mockPackNetwork(pack()));
  await assert.rejects(api.installPack('v1'), /Disk full/);
  assert.equal(store.data.instances.length, 0);
  assert.deepEqual(await fs.readdir(path.join(store.root, 'instances')), []);
});
test('updating a pack-provided mod identifies its old filename by Modrinth hash', async t => {
  const store = await instanceFixture(t); store.instance('test').installed = [];
  const net = mockContentNetwork();
  net.request = async (_url, options) => { const { hashes } = JSON.parse(options.body); return { json: async () => ({ [hashes[0]]: { project_id: 'main', id: 'oldV', name: 'Old Main Mod' } }) }; };
  await new Modrinth(store, () => {}, net).installContent('test', 'mainV');
  assert.deepEqual((await fs.readdir(path.join(store.instancePath('test'), 'mods'))).sort(), ['dep.jar', 'main.jar']);
});
test('resource packs and shaders use game-version compatibility without a Fabric loader filter', async t => {
  const store = await fixture(t); const requests = [];
  for (const type of ['resourcepack', 'shader', 'mod']) {
    const service = new Modrinth(store, () => {}, { json: async url => { requests.push(url); return url.includes('/version?') ? [] : { project_type: type }; } });
    await service.versions('example', { minecraft: '1.21.1', loader: 'fabric' });
    const url = new URL(requests.at(-1));
    assert.equal(url.searchParams.has('loaders'), type === 'mod');
    assert.equal(url.searchParams.get('game_versions'), '["1.21.1"]');
  }
});
