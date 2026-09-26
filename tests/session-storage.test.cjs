const test = require('node:test');
const assert = require('node:assert/strict');
const { configurePasswordStore, encryptionAvailable, saveSession, readSession } = require('../electron/session-storage.cjs');
function backend(available = true, name = 'gnome_libsecret') {
  return { isEncryptionAvailable: () => available, getSelectedStorageBackend: () => name, encryptString: text => Buffer.from('encrypted:' + text), decryptString: bytes => bytes.toString().slice(10) };
}
test('Flatpak uses Secret Service before startup and respects explicit overrides', () => {
  for (const [platform, env, flatpakInfo, override, expected] of [
    ['linux', { FLATPAK_ID: 'com.r1ft.client' }, false, false, true],
    ['linux', {}, true, false, true], ['linux', {}, false, false, false],
    ['linux', { FLATPAK_ID: 'com.r1ft.client' }, true, true, false],
    ['win32', {}, true, false, false], ['darwin', {}, true, false, false]
  ]) {
    const calls = []; const app = { commandLine: { hasSwitch: () => override, appendSwitch: (...args) => calls.push(args) } };
    configurePasswordStore(app, { platform, env, flatpakInfo });
    assert.deepEqual(calls, expected ? [['password-store', 'gnome-libsecret']] : []);
  }
});
test('saved session can be read after the in-memory session map is discarded', () => {
  const account = { id: 'test' }; saveSession(account, 'test-token', new Map(), backend(), 'linux');
  assert.equal(readSession(JSON.parse(JSON.stringify(account)), new Map(), backend(), 'linux'), 'test-token');
});
test('unavailable wallet preserves ciphertext and keeps new tokens only in memory', () => {
  const account = { id: 'test', refresh: 'previous-ciphertext' }; const sessions = new Map();
  saveSession(account, 'new-token', sessions, backend(false), 'linux');
  assert.equal(account.refresh, 'previous-ciphertext');
  assert.equal(readSession(account, sessions, backend(false), 'linux'), 'new-token');
  assert.throws(() => readSession(account, new Map(), backend(false), 'linux'), /Unlock your system keyring/);
});
test('basic_text is never used to persist a Microsoft session', () => {
  const account = { id: 'test' }; const storage = backend(true, 'basic_text');
  assert.equal(encryptionAvailable(storage, 'linux'), false);
  saveSession(account, 'test-token', new Map(), storage, 'linux'); assert.equal(account.refresh, undefined);
});
test('decryption failure gives recovery instructions without exposing ciphertext', () => {
  assert.throws(() => readSession({ refresh: 'secret' }, new Map(), { ...backend(), decryptString() { throw Error('secret'); } }, 'linux'), /Could not unlock the saved Microsoft session/);
});
