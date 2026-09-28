'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

// The only bridge between the page and the rest of the app.
contextBridge.exposeInMainWorld('okv', {
  getState: () => ipcRenderer.invoke('get-state'),
  query: (options) => ipcRenderer.invoke('query', options),
  sendMessage: (message) => ipcRenderer.invoke('send-message', message),
  setDepartment: (department) => ipcRenderer.invoke('set-department', department),
  setSettings: (values) => ipcRenderer.invoke('set-settings', values),
  setExpanded: (expanded) => ipcRenderer.invoke('set-expanded', expanded),
  markRead: () => ipcRenderer.invoke('mark-read'),
  dragMove: (x, y) => ipcRenderer.send('drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  updateAction: (action) => ipcRenderer.invoke('update-action', action),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),

  onView: on('view'),
  onMessages: on('messages-added'),
  onUnread: on('unread'),
  onPeers: on('peers'),
  onUpdate: on('update-status'),
  onSettings: on('settings'),
  onOpen: on('open'),
});
