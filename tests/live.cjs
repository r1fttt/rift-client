// Opt-in network test: downloads a real mod and launches Minecraft in a disposable instance.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const loader = process.env.LIVE_LOADER || 'fabric';
  const minecraft = process.env.LIVE_MC || '1.21.1';
  const name = `Live ${loader} ${minecraft} ${process.env.LIVE_LOADER_VERSION || ''} Test`;
  const data = path.join(__dirname, '../.test-output/live-data');
  await fs.mkdir(data, { recursive: true });
  let app, page;
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, R1FT_TEST_DATA: data }, timeout: 30000 });
    page = await app.firstWindow();
    await page.waitForFunction(() => window.launcher);
    const call = (method, args) => page.evaluate(({ method, args }) => window.launcher[method](args), { method, args });
    await call('offline-add', 'ViperLiveTest');
    let state = await call('state');
    let instance = state.instances.find(i => i.name === name);
    if (!instance) instance = await call('instance-create', { name, minecraft, loader, loaderVersion: process.env.LIVE_LOADER_VERSION });
    console.log('Created instance:', minecraft, loader, instance.loaderVersion);
    if (loader === 'fabric') {
      const versions = await call('project-versions', { id: 'sodium', instanceId: instance.id });
      assert.ok(versions.length);
      await call('content-install', { instanceId: instance.id, versionId: versions[0].id });
      console.log('Installed Sodium from Modrinth.');
    }
    let latest = '';
    const timer = setInterval(async () => { try { const s = await call('state'); if (s.status.message !== latest) { latest = s.status.message; console.log(s.status.phase, s.status.percent + '%', latest); } } catch {} }, 5000);
    try {
      await call('launch', instance.id);
      console.log('Game process started; waiting for renderer initialization.');
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const lines = await call('logs'); const current = await call('state');
        if (lines.some(l => /OpenAL initialized|Sound engine started|Created: .*textures\/atlas/.test(l)) || current.status.phase === 'error') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const logs = await call('logs');
      await fs.writeFile(path.join(__dirname, `../.test-output/live-${loader}-${minecraft}.log`), logs.join('\n'));
      state = await call('state');
      assert.equal(state.status.phase, 'running', state.status.message + '\n' + logs.slice(-20).join('\n'));
      assert.ok(logs.some(l => /OpenAL initialized|Sound engine started|Created: .*textures\/atlas/.test(l)), 'Minecraft should initialize its renderer');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log(`PASS: Automatic Java, MCLC ${loader} ${minecraft} launch, and Minecraft renderer initialization.`);
      await call('stop');
      for (let n = 0; n < 30 && (await call('state')).running; n++) await new Promise(resolve => setTimeout(resolve, 1000));
    } finally { clearInterval(timer); }
  } finally {
    if (page) await page.evaluate(() => window.launcher.stop()).catch(() => {});
    await app?.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
