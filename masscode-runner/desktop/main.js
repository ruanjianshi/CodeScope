'use strict';

const { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, shell, utilityProcess } = require('electron');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const APP_ID = 'com.codescope.desktop';
const DEFAULT_PORT = 4877;
const REPOSITORY_URL = 'https://github.com/ruanjianshi/massCode';

let mainWindow = null;
let serviceProcess = null;
let servicePort = DEFAULT_PORT;
let activeVault = '';
let isQuitting = false;

function desktopConfigPath() {
  return path.join(app.getPath('userData'), 'desktop.json');
}

function readDesktopConfig() {
  try { return JSON.parse(fs.readFileSync(desktopConfigPath(), 'utf8')); }
  catch (_) { return {}; }
}

function writeDesktopConfig(next) {
  const target = desktopConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = readDesktopConfig();
  fs.writeFileSync(target, JSON.stringify({ ...current, ...next }, null, 2) + '\n', 'utf8');
}

function existingDirectory(candidate) {
  try { return candidate && fs.statSync(candidate).isDirectory() ? candidate : ''; }
  catch (_) { return ''; }
}

function resolveVault() {
  const configured = process.env.CODESCOPE_VAULT || process.env.MASSCODE_VAULT || readDesktopConfig().vault;
  if (configured) {
    fs.mkdirSync(configured, { recursive: true });
    return path.resolve(configured);
  }
  const documents = app.getPath('documents');
  const candidates = process.platform === 'darwin'
    ? [
        path.join(app.getPath('home'), 'Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault'),
        path.join(documents, 'massCode/markdown-vault'),
      ]
    : [path.join(documents, 'massCode/markdown-vault')];
  for (const candidate of candidates) {
    const found = existingDirectory(candidate);
    if (found) return found;
  }
  const created = path.join(documents, 'CodeScope', 'markdown-vault');
  fs.mkdirSync(created, { recursive: true });
  return created;
}

function resolveVaultSelection(selected) {
  const absolute = path.resolve(selected);
  if (path.basename(absolute).toLowerCase() === 'markdown-vault') return absolute;
  const child = path.join(absolute, 'markdown-vault');
  return existingDirectory(child) || absolute;
}

function freePort(preferred = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error.code !== 'EADDRINUSE') return reject(error);
      const fallback = net.createServer();
      fallback.unref();
      fallback.once('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const address = fallback.address();
        fallback.close(() => resolve(address.port));
      });
    });
    probe.listen(preferred, '127.0.0.1', () => probe.close(() => resolve(preferred)));
  });
}

function requestVersion(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/version', timeout: 1000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!response.statusCode || response.statusCode >= 400 || !body.ok) throw new Error('服务尚未就绪');
          resolve(body);
        } catch (error) { reject(error); }
      });
    });
    request.once('timeout', () => request.destroy(new Error('服务响应超时')));
    request.once('error', reject);
  });
}

async function waitForService(port) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { return await requestVersion(port); }
    catch (error) { lastError = error; }
    if (!serviceProcess) throw new Error('本地服务未启动');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('等待本地服务启动超时');
}

async function startService() {
  activeVault = resolveVault();
  servicePort = await freePort(Number(process.env.CODESCOPE_PORT) || DEFAULT_PORT);
  const serverEntry = path.join(app.getAppPath(), 'server.js');
  serviceProcess = utilityProcess.fork(serverEntry, [], {
    serviceName: 'CodeScope Local Service',
    stdio: 'pipe',
    env: {
      ...process.env,
      CODESCOPE_APP_MODE: 'desktop',
      CODESCOPE_HOST: '127.0.0.1',
      CODESCOPE_PORT: String(servicePort),
      CODESCOPE_VAULT: activeVault,
      CODESCOPE_DATA_HOME: app.getPath('userData'),
    },
  });
  if (serviceProcess.stdout) serviceProcess.stdout.on('data', (chunk) => console.log('[service]', String(chunk).trimEnd()));
  if (serviceProcess.stderr) serviceProcess.stderr.on('data', (chunk) => console.error('[service]', String(chunk).trimEnd()));
  serviceProcess.once('exit', (code) => {
    serviceProcess = null;
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('CodeScope 服务已停止', '本地服务意外退出（代码 ' + String(code) + '），请重新启动 CodeScope。');
    }
  });
  await waitForService(servicePort);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: '码境 CodeScope',
    width: 1520,
    height: 960,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0b111b',
    icon: path.join(__dirname, 'icons', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  const baseUrl = 'http://127.0.0.1:' + servicePort;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl + '/')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(baseUrl + '/?mode=desktop');
}

async function chooseVaultAndRestart() {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = await dialog.showOpenDialog(owner, {
    title: '选择 CodeScope Vault',
    defaultPath: activeVault || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    message: '选择 markdown-vault 本身，或选择包含 markdown-vault 的目录',
  });
  if (result.canceled || !result.filePaths[0]) return;
  const vault = resolveVaultSelection(result.filePaths[0]);
  fs.mkdirSync(vault, { recursive: true });
  writeDesktopConfig({ vault });
  app.relaunch();
  app.exit(0);
}

function installMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '切换 Vault…', accelerator: 'CmdOrCtrl+Shift+O', click: chooseVaultAndRestart },
        { label: '在文件管理器中显示 Vault', click: () => shell.openPath(activeVault) },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: '视图',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: () => checkForUpdates(true) },
        { label: 'CodeScope GitHub', click: () => shell.openExternal(REPOSITORY_URL) },
        { type: 'separator' },
        { label: '关于 CodeScope', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'CodeScope', message: '码境 CodeScope ' + app.getVersion(), detail: 'Web 与桌面双模式的代码、文档、论文和绘图工作台。' }) },
      ],
    },
  ];
  if (process.platform === 'darwin') template.unshift({ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function updaterUrl() {
  return 'https://update.electronjs.org/ruanjianshi/massCode/' + process.platform + '-' + process.arch + '/' + app.getVersion();
}

async function checkForUpdates(interactive) {
  if (!app.isPackaged || process.platform === 'linux') {
    if (interactive) await dialog.showMessageBox(mainWindow, { type: 'info', message: app.isPackaged ? 'Linux 版本通过软件包管理器或 GitHub Release 更新。' : '开发模式不检查在线更新。' });
    return;
  }
  try {
    autoUpdater.setFeedURL({ url: updaterUrl() });
    autoUpdater.checkForUpdates();
    if (interactive) await dialog.showMessageBox(mainWindow, { type: 'info', message: '正在检查 CodeScope 更新', detail: '如有新版本，将在后台下载并提示重启。' });
  } catch (error) {
    if (interactive) dialog.showErrorBox('检查更新失败', String(error.message || error));
  }
}

function configureUpdater() {
  autoUpdater.on('error', (error) => console.error('[updater]', error.message));
  autoUpdater.on('update-downloaded', async (_event, _notes, name) => {
    const result = await dialog.showMessageBox(mainWindow, { type: 'info', buttons: ['稍后', '立即重启'], defaultId: 1, cancelId: 0, message: 'CodeScope ' + String(name || '新版本') + ' 已下载', detail: '重启后自动完成更新，Vault 数据不会被覆盖。' });
    if (result.response === 1) autoUpdater.quitAndInstall();
  });
  setTimeout(() => checkForUpdates(false), 15000).unref();
}

function registerIpc() {
  ipcMain.handle('desktop:get-info', () => ({ desktop: true, version: app.getVersion(), platform: process.platform, arch: process.arch, vault: activeVault, port: servicePort }));
  ipcMain.handle('desktop:choose-vault', async () => { await chooseVaultAndRestart(); return { restarting: true }; });
  ipcMain.handle('desktop:show-vault', () => shell.openPath(activeVault));
  ipcMain.handle('desktop:check-updates', async () => { await checkForUpdates(true); return { ok: true }; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID);
    registerIpc();
    try {
      await startService();
      createWindow();
      installMenu();
      configureUpdater();
    } catch (error) {
      dialog.showErrorBox('CodeScope 无法启动', String(error.stack || error.message || error));
      app.quit();
    }
    app.on('activate', () => { if (!mainWindow) createWindow(); });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (serviceProcess) {
    serviceProcess.kill();
    serviceProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
