const path = require('node:path');
const crypto = require('node:crypto');

function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.includes(':') || relative.startsWith('/') || relative.split('/').some(p => p === '..' || p === '.' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(p))) throw new Error('Unsafe file path');
  const result = path.resolve(root, relative);
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new Error('File path escapes instance');
  return result;
}
function segment(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.+-]{1,150}$/.test(value) || value === '.' || value === '..') throw new Error('Invalid identifier');
  return value;
}
function offlineAuth(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Use 3–16 letters, numbers, or underscores for the username.');
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return { name, uuid: bytes.toString('hex'), access_token: '0', client_token: bytes.toString('hex'), user_properties: '{}', meta: { type: 'mojang' } };
}
function publicAccount(account) {
  const { id, name, type, skinId } = account;
  return { id, name, type, skinId };
}
function verifyHash(buffer, hashes) {
  const algorithm = hashes?.sha512 ? 'sha512' : hashes?.sha256 ? 'sha256' : hashes?.sha1 ? 'sha1' : null;
  if (!algorithm) throw new Error('Download is missing an integrity checksum');
  if (crypto.createHash(algorithm).update(buffer).digest('hex') !== hashes[algorithm].toLowerCase()) throw new Error('Download checksum does not match. Please retry.');
}
function downloadUrl(url, extraHosts = []) {
  const parsed = new URL(url);
  const allowed = ['cdn.modrinth.com', 'raw.githubusercontent.com', 'gitlab.com', 'piston-data.mojang.com', 'launcher.mojang.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'maven.minecraftforge.net', 'meta.fabricmc.net', 'meta.quiltmc.org', ...extraHosts];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || !allowed.includes(parsed.hostname)) throw new Error(`Download host is not allowed: ${parsed.hostname}`);
  return parsed.href;
}
function scrubLog(line, secrets = []) {
  let value = String(line);
  for (const secret of secrets) if (secret && secret.length > 3) value = value.split(secret).join('[redacted]');
  return value.replace(/(--accessToken\s+|Bearer\s+|"?(?:access_token|refresh_token|client_token)"?\s*[:=]\s*"?)[^\s",]+/gi, '$1[redacted]');
}
module.exports = { safePath, segment, offlineAuth, publicAccount, verifyHash, downloadUrl, scrubLog };
