'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the appointment schedule window and the rest of the app.
contextBridge.exposeInMainWorld('appt', {
  getState: () => ipcRenderer.invoke('appt-state'),
  day: (day) => ipcRenderer.invoke('appt-day', day),
  add: (details) => ipcRenderer.invoke('appt-add', details),
  change: (details) => ipcRenderer.invoke('appt-change', details),
  remove: (target) => ipcRenderer.invoke('appt-remove', target),
  restore: (target) => ipcRenderer.invoke('appt-restore', target),
  set: (values) => ipcRenderer.invoke('appt-set', values),
  onChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('appointments-changed', handler);
    return () => ipcRenderer.off('appointments-changed', handler);
  },
});
