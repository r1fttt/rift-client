const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadUrl } = require('./security.cjs');
const UA = 'R1FTClient/0.68.1 (Minecraft desktop launcher)';
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'User-Agent': UA, ...options.headers }, signal: options.signal || AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(response.status === 429 ? 'Too many requests. Wait a moment and try again.' : `Request failed (${response.status}) from ${new URL(url).hostname}`);
  return response;
}
async function json(url) { return (await request(url)).json(); }
async function download(url, destination, hashes, progress, maxBytes = 1024 * 1024 * 1024) {
  let current = downloadUrl(url);
  let response;
  for (let i = 0; i < 8; i++) {
    response = await fetch(current, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(300000) });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); current = downloadUrl(new URL(response.headers.get('location'), current).href); continue; }
    break;
  }
  if (!response?.ok) throw new Error(`Download failed (${response?.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > maxBytes) { await response.body?.cancel(); throw new Error('Download is too large'); }
  const algorithm = hashes?.sha512 ? 'sha512' : hashes?.sha256 ? 'sha256' : hashes?.sha1 ? 'sha1' : null;
  if (!algorithm) { await response.body?.cancel(); throw new Error('Download is missing an integrity checksum'); }
  const hash = crypto.createHash(algorithm);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const partial = destination + '.part';
  const handle = await fs.open(partial, 'w');
  let received = 0, lastUpdate = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > maxBytes) throw new Error('Download is too large');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) { const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset); offset += bytesWritten; }
      if (Date.now() - lastUpdate > 150) { progress?.(received, total); lastUpdate = Date.now(); }
    }
    if (hash.digest('hex') !== hashes[algorithm].toLowerCase()) throw new Error('Download checksum does not match. Please retry.');
    await handle.close();
    await fs.rename(partial, destination);
    progress?.(received, total);
  } finally { await handle.close().catch(() => {}); await fs.rm(partial, { force: true }); }
}
module.exports = { request, json, download, UA };
