// Flatpak exposes Secret Service; KDE's private wallet bus is not allowed.
function configurePasswordStore(app, { platform = process.platform, env = process.env, flatpakInfo = require('node:fs').existsSync('/.flatpak-info') } = {}) {
  if (platform === 'linux' && (env.FLATPAK_ID || flatpakInfo) && !app.commandLine.hasSwitch('password-store')) {
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
  }
}
function encryptionAvailable(safeStorage, platform = process.platform) {
  return safeStorage.isEncryptionAvailable() && (platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));
}
function saveSession(account, token, sessions, safeStorage, platform = process.platform) {
  sessions.set(account.id, token);
  // Preserve an existing encrypted record if the wallet is temporarily locked.
  if (encryptionAvailable(safeStorage, platform)) account.refresh = safeStorage.encryptString(token).toString('base64');
}
function readSession(account, sessions, safeStorage, platform = process.platform) {
  if (sessions.has(account.id)) return sessions.get(account.id);
  if (!account.refresh) throw new Error('Sign in to this Microsoft account again from Accounts.');
  if (!encryptionAvailable(safeStorage, platform)) throw new Error('Unlock your system keyring or wallet, then restart R1FT Client to use your saved Microsoft account.');
  try { return safeStorage.decryptString(Buffer.from(account.refresh, 'base64')); }
  catch { throw new Error('Could not unlock the saved Microsoft session. Unlock your system keyring and restart R1FT Client, or sign in again from Accounts.'); }
}
module.exports = { configurePasswordStore, encryptionAvailable, saveSession, readSession };
