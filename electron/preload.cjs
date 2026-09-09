const { contextBridge, ipcRenderer } = require('electron');
const methods = ['state', 'news', 'news-post', 'news-link', 'versions', 'loaders', 'offline-add', 'microsoft-add', 'account-select', 'account-remove', 'instance-create', 'instance-update', 'instance-delete', 'folder', 'content-list', 'content-toggle', 'content-remove', 'search', 'project', 'project-versions', 'pack-install', 'content-install', 'launch', 'stop', 'logs', 'settings-save', 'java-pick', 'skin-import', 'skin-data', 'skin-equip', 'skin-export', 'skin-delete', 'external', 'window'];
const api = Object.fromEntries(methods.map(method => [method, async (...args) => {
  const result = await ipcRenderer.invoke('launcher:' + method, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}]));
for (const [name, channel] of [['onProgress', 'launcher:event'], ['onLog', 'launcher:log'], ['onRefresh', 'launcher:refresh']]) {
  api[name] = callback => { const listener = (_event, value) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
}
contextBridge.exposeInMainWorld('launcher', api);
