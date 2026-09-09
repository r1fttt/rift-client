const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r1ft-packaged-'));
  let app;
  try {
    app = await electron.launch({ executablePath: path.join(__dirname, '../release/linux-unpacked/r1ft-client'), args: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, R1FT_TEST_DATA: root }, timeout: 30000 });
    const page = await app.firstWindow(); await page.getByRole('heading', { name: 'Let’s play.' }).waitFor();
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    const result = await page.evaluate(async () => { await window.launcher['offline-add']('PackageTest'); return window.launcher.state(); });
    assert.equal(result.accounts[0].name, 'PackageTest');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    console.log('PASS: Packaged application boots, loads bundled MCLC/MSMC dependencies, and uses sandboxed IPC.');
  } finally { await app?.close(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
