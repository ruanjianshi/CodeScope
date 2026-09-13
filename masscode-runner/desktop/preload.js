'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codescopeDesktop', Object.freeze({
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  chooseVault: () => ipcRenderer.invoke('desktop:choose-vault'),
  showVault: () => ipcRenderer.invoke('desktop:show-vault'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
}));
