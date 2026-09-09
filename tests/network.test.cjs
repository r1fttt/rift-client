const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { download } = require('../electron/network.cjs');
async function setup(t, responder) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r1ft-download-'));
  const original = global.fetch; global.fetch = responder;
  t.after(async () => { global.fetch = original; await fs.rm(root, { recursive: true, force: true }); });
  return path.join(root, 'download.jar');
}
const hashes = data => ({ sha256: crypto.createHash('sha256').update(data).digest('hex') });
test('streamed downloads verify bytes before replacing a destination', async t => {
  const data = Buffer.from('complete payload'); const dest = await setup(t, async () => new Response(data));
  await fs.writeFile(dest, 'old file'); await download('https://cdn.modrinth.com/test', dest, hashes(data));
  assert.equal(await fs.readFile(dest, 'utf8'), 'complete payload'); await assert.rejects(fs.stat(dest + '.part'));
});
test('a checksum failure preserves the destination and removes partial data', async t => {
  const dest = await setup(t, async () => new Response('corrupted')); await fs.writeFile(dest, 'old file');
  await assert.rejects(download('https://cdn.modrinth.com/test', dest, hashes('expected')), /checksum/);
  assert.equal(await fs.readFile(dest, 'utf8'), 'old file'); await assert.rejects(fs.stat(dest + '.part'));
});
test('redirects to a private or untrusted host are rejected before following', async t => {
  let calls = 0; const dest = await setup(t, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }); });
  await assert.rejects(download('https://cdn.modrinth.com/test', dest, hashes('a')), /not allowed/); assert.equal(calls, 1);
});
test('oversized streams are cut off and partial data is removed', async t => {
  const dest = await setup(t, async () => new Response('too many bytes'));
  await assert.rejects(download('https://cdn.modrinth.com/test', dest, hashes('too many bytes'), null, 4), /too large/);
  await assert.rejects(fs.stat(dest)); await assert.rejects(fs.stat(dest + '.part'));
});
