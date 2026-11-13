const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  ready: () => ipcRenderer.send('app:ready'),
  readiness: () => ipcRenderer.invoke('system:readiness'),
  openSetup: target => ipcRenderer.invoke('system:setup', target),
  startPhone: () => ipcRenderer.invoke('phone:start'),
  stopPhone: () => ipcRenderer.invoke('phone:stop'),
  printers: () => ipcRenderer.invoke('printers:list'),
  print: data => ipcRenderer.invoke('labels:print', data),
  updateState: () => ipcRenderer.invoke('updates:get'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  setAutoUpdates: value => ipcRenderer.invoke('updates:automatic', value),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdate: callback => ipcRenderer.on('updates:state', (_event, state) => callback(state)),
  onPhoto: callback => ipcRenderer.on('phone:photo', (_event, data) => callback(data)),
  onPhoneClosed: callback => ipcRenderer.on('phone:closed', () => callback())
});
