const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const net = require('net');

let mainWindow;
const activeProcesses = new Map();
const configPath = path.join(__dirname, 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Error reading config.json:', err);
  }
  return [];
}

function writeConfig(data) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing config.json:', err);
  }
}

let syncInterval;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#07080b',
    title: 'Local Server Dashboard (APEX Matrix)',
    icon: path.join(__dirname, 'icon.png'), // Will fallback silently if missing
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Remove default menu for a premium sleek look
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile('index.html');

  mainWindow.webContents.once('did-finish-load', () => {
    // Run self-healing cleanup for any duplicate ports in config on startup
    const servers = readConfig();
    if (cleanupDuplicatePorts(servers)) {
      writeConfig(servers);
    }

    // Run initial sync and auto-discovery on startup
    syncWithPortsLog();
    autoDiscoverProjects();
  });

  // Sync and auto-discover every 8 seconds in the background
  syncInterval = setInterval(() => {
    syncWithPortsLog();
    autoDiscoverProjects();
  }, 8000);

  // Open links in external default browser rather than inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    clearInterval(syncInterval);
    // Kill all servers when the app is closed
    cleanupAllServers();
  });
}

function cleanupAllServers() {
  for (const [id, proc] of activeProcesses.entries()) {
    console.log(`Cleaning up process for server ${id} (PID: ${proc.pid})`);
    try {
      exec(`taskkill /F /T /PID ${proc.pid}`);
    } catch (e) {
      proc.kill();
    }
  }
  activeProcesses.clear();
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(250);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true); // port is open on IPv4
    });
    const fallback = () => {
      socket.destroy();
      checkPortIPv6(port).then(resolve);
    };
    socket.once('timeout', fallback);
    socket.once('error', fallback);
    socket.connect(port, '127.0.0.1');
  });
}

function checkPortIPv6(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(250);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true); // port is open on IPv6
    });
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('timeout', fail);
    socket.once('error', fail);
    socket.connect(port, '::1');
  });
}

// IPC Handlers
ipcMain.handle('get-servers', () => {
  return readConfig();
});

ipcMain.handle('add-server', (event, newServer) => {
  const servers = readConfig();
  newServer.id = Date.now().toString();
  servers.push(newServer);
  writeConfig(servers);
  return servers;
});

ipcMain.handle('delete-server', (event, id) => {
  stopServer(id);
  const servers = readConfig();
  const filtered = servers.filter(s => s.id !== id);
  writeConfig(filtered);
  return filtered;
});

ipcMain.handle('start-server', async (event, id) => {
  await startServer(id);
});

ipcMain.handle('stop-server', (event, id) => {
  stopServer(id);
});

ipcMain.handle('edit-server', (event, id, updatedData) => {
  const servers = readConfig();
  const index = servers.findIndex(s => s.id === id);
  if (index !== -1) {
    servers[index] = { ...servers[index], ...updatedData };
    servers[index].cmd = getDevCommandForPath(servers[index].path, servers[index].port);
    writeConfig(servers);
  }
  return servers;
});

ipcMain.handle('free-port', async (event, port) => {
  const killed = await killProcessOnPort(port);
  return killed;
});

ipcMain.handle('sync-and-discover', async () => {
  syncWithPortsLog();
  autoDiscoverProjects();
});

async function startServer(id) {
  if (activeProcesses.has(id)) return;

  const servers = readConfig();
  const server = servers.find(s => s.id === id);
  if (!server) return;

  // Let UI know we are checking/starting
  if (mainWindow) {
    mainWindow.webContents.send('status-change', { id, status: 'starting' });
  }

  // VERIFY: Check if port is already in use BEFORE starting
  const isPortBusy = await checkPort(server.port);
  if (isPortBusy) {
    if (mainWindow) {
      mainWindow.webContents.send('status-change', { id, status: 'occupied' });
      mainWindow.webContents.send('server-log', { id, text: `[System Error] Cannot start server "${server.name}".\n` });
      mainWindow.webContents.send('server-log', { id, text: `[System Error] Port ${server.port} is already occupied by another process!\n` });
      mainWindow.webContents.send('server-log', { id, text: `[System Error] Please close the occupying app or change the port for this project.\n\n` });
    }
    return;
  }

  if (mainWindow) {
    mainWindow.webContents.send('server-log', { id, text: `[System] Spawning dev server for "${server.name}"...\n` });
    mainWindow.webContents.send('server-log', { id, text: `[System] CMD: ${server.cmd}\n` });
    mainWindow.webContents.send('server-log', { id, text: `[System] DIR: ${server.path}\n\n` });
  }

  // Spawn powershell or CMD based execution
  const proc = spawn(server.cmd, [], {
    cwd: server.path,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  activeProcesses.set(id, proc);

  proc.stdout.on('data', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('server-log', { id, text: data.toString() });
    }
  });

  proc.stderr.on('data', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('server-log', { id, text: data.toString() });
    }
  });

  proc.on('close', (code) => {
    activeProcesses.delete(id);
    if (mainWindow) {
      mainWindow.webContents.send('status-change', { id, status: 'offline' });
      mainWindow.webContents.send('server-log', { id, text: `\n[System] Process exited with code ${code}\n` });
    }
  });
}

function stopServer(id) {
  const proc = activeProcesses.get(id);
  if (!proc) return;

  if (mainWindow) {
    mainWindow.webContents.send('server-log', { id, text: `\n[System] Killing server process tree...\n` });
  }

  exec(`taskkill /F /T /PID ${proc.pid}`, (err) => {
    if (err) {
      console.log(`taskkill failed, falling back to process kill:`, err);
      proc.kill();
    }
    activeProcesses.delete(id);
    if (mainWindow) {
      mainWindow.webContents.send('status-change', { id, status: 'offline' });
      mainWindow.webContents.send('server-log', { id, text: `[System] Server stopped successfully.\n` });
    }
  });
}

// Port status loop
setInterval(async () => {
  if (!mainWindow) return;
  const servers = readConfig();
  for (const s of servers) {
    const isOnline = await checkPort(s.port);
    const hasProcess = activeProcesses.has(s.id);

    let status = 'offline';
    if (hasProcess) {
      status = isOnline ? 'online' : 'starting';
    } else if (isOnline) {
      status = 'occupied';
    }

    mainWindow.webContents.send('status-change', { id: s.id, status });
  }
}, 1500);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  cleanupAllServers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

function killProcessOnPort(port) {
  return new Promise((resolve) => {
    // Find process occupying port on Windows using netstat
    exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
      if (err || !stdout) {
        resolve(false);
        return;
      }

      const lines = stdout.split('\n');
      const pids = new Set();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        // Col 1: Proto, Col 2: Local Addr, Col 3: Foreign Addr, Col 4: State, Col 5: PID
        // Filter only LISTENING sockets to avoid killing outgoing connections
        if (parts.length >= 5 && parts[3] === 'LISTENING') {
          const pid = parseInt(parts[4]);
          if (pid && pid > 0) pids.add(pid);
        }
      }

      if (pids.size === 0) {
        resolve(false);
        return;
      }

      // Kill each PID tree
      const killPromises = Array.from(pids).map(pid => {
        return new Promise(res => {
          exec(`taskkill /F /T /PID ${pid}`, () => res());
        });
      });

      Promise.all(killPromises).then(() => {
        resolve(true); // Killed successfully
      });
    });
  });
}

function getDevCommandForPath(absolutePath, port) {
  try {
    const pkgPath = path.join(absolutePath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const devScript = pkg.scripts && pkg.scripts.dev;
      if (devScript && devScript.includes('--port')) {
        return 'npm run dev';
      }
    }
  } catch (e) {
    console.error('Error checking package.json for dev command:', e);
  }
  return `npm run dev -- --port ${port}`;
}

function syncWithPortsLog() {
  const logPath = 'c:/Users/Lukasz/Documents/Antigravity/Sandbox/PORTS_LOG.md';
  if (!fs.existsSync(logPath)) return;

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    let configUpdated = false;
    const servers = readConfig();

    // Regex to parse PORTS_LOG.md markdown table row
    // Format: | **4321** | `/Astro` | Soap Shop & Blog | ...
    const regex = /\|\s*\*\*(\d+)\*\*\s*\|\s*`([^`]+)`\s*\|\s*([^|]+)\s*\|/;

    for (const line of lines) {
      const match = regex.exec(line);
      if (match) {
        const port = parseInt(match[1]);
        const relativePath = match[2].trim();
        const name = match[3].trim();

        // Resolve absolute path
        const absolutePath = path.normalize(path.join('c:/Users/Lukasz/Documents/Antigravity/Sandbox', relativePath)).replace(/\\/g, '/');

        // Check if project exists in config
        const existingIndex = servers.findIndex(s => s.path.toLowerCase() === absolutePath.toLowerCase());

        if (existingIndex !== -1) {
          const s = servers[existingIndex];
          if (s.port !== port || s.name !== name) {
            s.port = port;
            s.name = name;
            // Re-calculate the command to avoid port conflicts
            s.cmd = getDevCommandForPath(absolutePath, port);
            configUpdated = true;
          }
        } else {
          // Add new server detected from logs
          const cmd = getDevCommandForPath(absolutePath, port);
          const newServer = {
            id: Date.now().toString() + Math.random().toString().substring(2, 6),
            name,
            path: absolutePath,
            cmd,
            port
          };
          servers.push(newServer);
          configUpdated = true;
        }
      }
    }

    if (configUpdated) {
      writeConfig(servers);
      if (mainWindow) {
        mainWindow.webContents.send('servers-updated');
      }
    }
  } catch (err) {
    console.error('Error syncing with PORTS_LOG.md:', err);
  }
}

function getNextAvailablePort(servers) {
  const ports = servers.map(s => s.port).filter(p => !isNaN(p));
  const maxPort = ports.length > 0 ? Math.max(...ports) : 4325;
  return Math.max(maxPort + 1, 4326);
}

function cleanupDuplicatePorts(servers) {
  const portsInUse = new Set();
  let maxPort = 4325;
  let updated = false;

  // Find current maximum port
  for (const s of servers) {
    if (!isNaN(s.port) && s.port > maxPort) {
      maxPort = s.port;
    }
  }

  // Find duplicates and assign them new sequential ports
  for (const s of servers) {
    if (portsInUse.has(s.port)) {
      maxPort++;
      console.log(`Self-healing config: Reassigning duplicate port ${s.port} to ${maxPort} for project ${s.name}`);
      s.port = maxPort;
      s.cmd = getDevCommandForPath(s.path, s.port);
      updated = true;
    } else {
      portsInUse.add(s.port);
    }
  }

  return updated;
}

function autoDiscoverProjects() {
  const sandboxPath = 'c:/Users/Lukasz/Documents/Antigravity/Sandbox';
  if (!fs.existsSync(sandboxPath)) return;

  try {
    const files = fs.readdirSync(sandboxPath);
    const servers = readConfig();
    let configUpdated = false;

    for (const file of files) {
      const fullPath = path.join(sandboxPath, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const pkgPath = path.join(fullPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
          const normalizedPath = fullPath.replace(/\\/g, '/');
          const exists = servers.some(s => s.path.toLowerCase() === normalizedPath.toLowerCase());
          
          if (!exists) {
            // Read package.json to discover name and port
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const rawName = pkg.name || file;
            const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
            let port = null;
            
            // Try to extract port from scripts.dev
            const devScript = pkg.scripts && pkg.scripts.dev;
            if (devScript) {
              const portMatch = /--port\s+(\d+)/.exec(devScript);
              if (portMatch) {
                port = parseInt(portMatch[1]);
              }
            }

            if (!port) {
              // Assign next sequential port to avoid collision
              port = getNextAvailablePort(servers);
            }

            const cmd = getDevCommandForPath(normalizedPath, port);
            
            const newServer = {
              id: Date.now().toString() + Math.random().toString().substring(2, 6),
              name: `${name} (Discovered)`,
              path: normalizedPath,
              cmd,
              port
            };
            servers.push(newServer);
            configUpdated = true;
          }
        }
      }
    }

    if (configUpdated) {
      writeConfig(servers);
      if (mainWindow) {
        mainWindow.webContents.send('servers-updated');
      }
    }
  } catch (err) {
    console.error('Error in auto-discovery:', err);
  }
}
