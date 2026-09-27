'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APP_ROOT = path.join(__dirname, '..');

function uniq(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = process.platform === 'win32' ? String(value).toLowerCase() : String(value);
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* macOS：读取 /etc/paths.d/*（系统与安装器注册的 PATH 片段，例如 TeX 的 /Library/TeX/texbin）。
   图形界面或 launchd 启动的应用继承不到登录 shell 的 PATH，这里补齐，避免把已装工具误判为缺失。 */
function systemPathDirs() {
  if (process.platform !== 'darwin') return [];
  const dirs = [];
  let names = [];
  try { names = fs.readdirSync('/etc/paths.d'); } catch (_) { return dirs; }
  for (const name of names) {
    try {
      for (const line of fs.readFileSync(path.join('/etc/paths.d', name), 'utf8').split(/\r?\n/)) {
        const value = line.trim();
        if (value && !value.startsWith('#')) dirs.push(value);
      }
    } catch (_) {}
  }
  return dirs;
}

/* TeX Live / MacTeX 的可执行目录：latex、xelatex、biber、kpsewhich 都在这里 */
function texLiveDirs() {
  const dirs = ['/Library/TeX/texbin'];
  if (process.platform !== 'darwin' && process.platform !== 'linux') return dirs;
  let years = [];
  try { years = fs.readdirSync('/usr/local/texlive'); } catch (_) { return dirs; }
  for (const year of years) {
    const binRoot = path.join('/usr/local/texlive', year, 'bin');
    let flavours = [];
    try { flavours = fs.readdirSync(binRoot); } catch (_) { continue; }
    for (const flavour of flavours) dirs.push(path.join(binRoot, flavour));
  }
  return dirs;
}

function portableToolPaths(current = process.env.PATH || '') {
  const home = os.homedir();
  const dirs = current.split(path.delimiter).filter(Boolean);
  dirs.unshift(path.join(APP_ROOT, 'node_modules', '.bin'));
  if (process.platform === 'darwin') {
    dirs.unshift('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.unshift(path.join(appData, 'npm'), path.join(local, 'Programs', 'Python', 'Scripts'));
  } else {
    dirs.unshift('/usr/local/bin', '/snap/bin', '/home/linuxbrew/.linuxbrew/bin');
  }
  dirs.unshift(
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    path.join(home, 'go', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.npm-global', 'bin'),
  );
  dirs.push(...texLiveDirs(), ...systemPathDirs());
  return uniq(dirs).join(path.delimiter);
}

function applyPortableToolPath() {
  process.env.PATH = portableToolPaths();
  return process.env.PATH;
}

function executablePath(command) {
  if (!command) return '';
  if (path.isAbsolute(command)) {
    try { fs.accessSync(command, fs.constants.X_OK); return command; } catch (_) { return ''; }
  }
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(finder, [command], { encoding: 'utf8', timeout: 2500, env: process.env }).split(/\r?\n/)[0].trim();
  } catch (_) { return ''; }
}

function packageVersion(packageName) {
  try { return require(packageName + '/package.json').version || ''; } catch (_) { return ''; }
}

function nodeTool(modulePath, args = []) {
  try {
    const entry = require.resolve(modulePath);
    return {
      command: process.execPath,
      args: [entry, ...args],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      path: entry,
      bundled: true,
    };
  } catch (_) { return null; }
}

function bundledGopls(args = []) {
  const filename = process.platform === 'win32' ? 'gopls.exe' : 'gopls';
  const candidates = uniq([
    process.env.CODESCOPE_BUNDLED_GOPLS,
    process.resourcesPath && path.join(process.resourcesPath, filename),
    path.join(APP_ROOT, '.bundled-tools', filename),
  ]);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return { command: candidate, args, env: process.env, path: candidate, bundled: true };
    } catch (_) {}
  }
  const external = executablePath('gopls');
  return external ? { command: external, args, env: process.env, path: external, bundled: false } : null;
}

function languageServer(language) {
  if (language === 'python') {
    const runtime = nodeTool('pyright/langserver.index.js', ['--stdio']);
    return runtime && { ...runtime, id: 'pyright-langserver', version: packageVersion('pyright') };
  }
  if (language === 'javascript' || language === 'typescript') {
    const runtime = nodeTool('typescript-language-server/lib/cli.mjs', ['--stdio']);
    let tsserverPath = '';
    try { tsserverPath = require.resolve('typescript/lib/tsserver.js'); } catch (_) {}
    return runtime && {
      ...runtime,
      id: 'typescript-language-server',
      version: packageVersion('typescript-language-server'),
      initializationOptions: tsserverPath ? { tsserver: { path:tsserverPath, fallbackPath:tsserverPath } } : {},
    };
  }
  if (language === 'go') {
    const runtime = bundledGopls(['serve']);
    return runtime && { ...runtime, id: 'gopls', version: '' };
  }
  if (language === 'c' || language === 'c_cpp') {
    const command = executablePath('clangd');
    return command ? {
      id: 'clangd', command,
      args: ['--background-index=false', '--clang-tidy=false', '--header-insertion=never', '--log=error'],
      env: process.env, path: command, bundled: false, version: '',
    } : null;
  }
  return null;
}

module.exports = {
  applyPortableToolPath,
  bundledGopls,
  executablePath,
  languageServer,
  nodeTool,
  packageVersion,
  portableToolPaths,
};
