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
  deleteMessage: (target) => ipcRenderer.invoke('delete-message', target),
  undoDelete: (target) => ipcRenderer.invoke('undo-delete', target),
  deleteDay: (day) => ipcRenderer.invoke('delete-day', day),
  undoDeleteMany: (batch) => ipcRenderer.invoke('undo-delete-many', batch),
  react: (reaction) => ipcRenderer.invoke('react', reaction),
  listReminders: (options) => ipcRenderer.invoke('reminders-list', options),
  addReminder: (reminder) => ipcRenderer.invoke('reminder-add', reminder),
  setReminderStatus: (change) => ipcRenderer.invoke('reminder-status', change),
  clearDoneReminders: () => ipcRenderer.invoke('reminders-clear-done'),
  reminderNames: (department) => ipcRenderer.invoke('reminder-names', department),
  markRemindersSeen: () => ipcRenderer.invoke('reminders-seen'),
  setDepartment: (department) => ipcRenderer.invoke('set-department', department),
  setSettings: (values) => ipcRenderer.invoke('set-settings', values),
  setExpanded: (expanded) => ipcRenderer.invoke('set-expanded', expanded),
  markRead: () => ipcRenderer.invoke('mark-read'),
  dragMove: (x, y) => ipcRenderer.send('drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  setClickThrough: (on) => ipcRenderer.send('click-through', on),
  updateAction: (action) => ipcRenderer.invoke('update-action', action),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),

  onView: on('view'),
  onMessages: on('messages-added'),
  onMessagesChanged: on('messages-changed'),
  onRemindersChanged: on('reminders-changed'),
  onUnread: on('unread'),
  onPeers: on('peers'),
  onUpdate: on('update-status'),
  onSettings: on('settings'),
  onOpen: on('open'),
});
