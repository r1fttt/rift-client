// Opt-in end-to-end .mrpack test against the pack shown in the supplied reference images.
const { Modrinth } = require('../electron/modrinth.cjs');
const { Store } = require('../electron/store.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const store = new Store(path.join(__dirname, '../.test-output/pack-data'));
  let last = 0;
  const service = new Modrinth(store, e => { if (Date.now() - last > 2000 || e.phase === 'complete') { console.log(e.percent + '%', e.message); last = Date.now(); } });
  const versions = await service.versions('fabulously-optimized', { minecraft: '1.21.1', loader: 'fabric' });
  const version = versions.find(v => v.version_number === '6.5.0') || versions[0];
  assert.ok(version);
  const instance = await service.installPack(version.id);
  const root = store.instancePath(instance.id);
  const mods = await fs.readdir(path.join(root, 'mods'));
  assert.ok(mods.length > 20, 'Expected a complete modpack');
  assert.equal(instance.minecraft, '1.21.1'); assert.equal(instance.loader, 'fabric');
  assert.ok((await fs.readdir(root)).includes('config'), 'Pack overrides must be extracted');
  assert.deepEqual(await fs.readdir(path.join(store.root, 'staging')), []);
  console.log(`PASS: Installed ${instance.name}, ${mods.length} mods, loader ${instance.loaderVersion}, and client overrides.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
