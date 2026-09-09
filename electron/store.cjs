const fs = require('node:fs');
const path = require('node:path');
const { publicAccount } = require('./security.cjs');
class Store {
  constructor(root) {
    this.root = root; this.file = path.join(root, 'launcher.json');
    fs.mkdirSync(root, { recursive: true });
    this.data = { accounts: [], selectedAccount: null, instances: [], skins: [], settings: { memory: 4096, javaPath: '', autoJava: true, snapshots: false, closeOnLaunch: false } };
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...saved, settings: { ...this.data.settings, ...saved.settings } };
    }
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  public() { return { ...this.data, accounts: this.data.accounts.map(publicAccount), dataPath: this.root }; }
  instance(id) { const value = this.data.instances.find(i => i.id === id); if (!value) throw new Error('Instance not found'); return value; }
  instancePath(id) { this.instance(id); return path.join(this.root, 'instances', id); }
}
module.exports = { Store };
