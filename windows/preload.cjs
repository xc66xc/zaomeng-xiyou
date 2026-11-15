'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('helper', Object.freeze({
  call: (action, payload) => ipcRenderer.invoke('helper:call', action, payload),
  onState: callback => ipcRenderer.on('helper:state', (_event, value) => callback(value))
}));
