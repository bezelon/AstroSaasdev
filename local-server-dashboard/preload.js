const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getServers: () => ipcRenderer.invoke('get-servers'),
  addServer: (server) => ipcRenderer.invoke('add-server', server),
  deleteServer: (id) => ipcRenderer.invoke('delete-server', id),
  startServer: (id) => ipcRenderer.invoke('start-server', id),
  stopServer: (id) => ipcRenderer.invoke('stop-server', id),
  editServer: (id, server) => ipcRenderer.invoke('edit-server', id, server),
  freePort: (port) => ipcRenderer.invoke('free-port', port),
  syncAndDiscover: () => ipcRenderer.invoke('sync-and-discover'),
  
  onStatusChange: (callback) => {
    // Wrap to prevent leaks
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('status-change', subscription);
    return () => ipcRenderer.removeListener('status-change', subscription);
  },
  
  onServerLog: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('server-log', subscription);
    return () => ipcRenderer.removeListener('server-log', subscription);
  },

  onServersUpdated: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('servers-updated', subscription);
    return () => ipcRenderer.removeListener('servers-updated', subscription);
  }
});
