#!/usr/bin/env node
/**
 * 码境 CodeScope —— 工程代码工作台
 * 兼容读取 massCode Markdown Vault，为代码与文档提供阅读、编辑、运行和远程开发能力。
 * Node 本地服务；代码运行/格式化调用系统工具，VNC 使用 noVNC + ws。
 */
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');
const { Transform } = require('stream');
const { spawn, exec, execFile, execFileSync } = require('child_process');
const { pipeline } = require('stream/promises');
const { WebSocketServer } = require('ws');
const { Client: SshClient } = require('ssh2');
const { SaxesParser } = require('saxes');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const htmlToDocx = require('@turbodocx/html-to-docx');
const { createLspService } = require('./lib/lsp-service');
const APP_VERSION = require('./package.json').version;
const APP_MODE = process.env.CODESCOPE_APP_MODE === 'desktop' ? 'desktop' : 'web';

const PORT_VALUE = Number(process.env.CODESCOPE_PORT || process.env.MASSCODE_RUNNER_PORT || 4877);
const PORT = Number.isInteger(PORT_VALUE) && PORT_VALUE > 0 && PORT_VALUE <= 65535 ? PORT_VALUE : 4877;
// 默认仅监听本机，避免终端、文件编辑与代码执行接口意外暴露到局域网。
// 确实需要跨设备访问时，可显式设置 CODESCOPE_HOST=0.0.0.0，并配合受信网络使用。
const HOST = process.env.CODESCOPE_HOST || process.env.MASSCODE_RUNNER_HOST || '127.0.0.1';

/* ---------------------------------- 路径发现 ---------------------------------- */

function defaultVaultPath() {
  // 0) 最通用：工具目录上一级的 markdown-vault（整个 massCode 文件夹一起放在云盘/本地时一定成立，跨系统通用）
  const relVault = path.join(__dirname, '..', 'markdown-vault');
  if (fs.existsSync(relVault)) return relVault;
  // 1) 从 massCode 偏好设置读取（各系统路径不同）
  const prefCands = [];
  if (process.platform === 'darwin') {
    prefCands.push(
      path.join(os.homedir(), 'Library/Application Support/massCode/v2/preferences.json'),
      path.join(os.homedir(), 'Library/Application Support/masscode/v2/preferences.json'));
  } else if (process.platform === 'win32') {
    const ap = process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming');
    prefCands.push(
      path.join(ap, 'massCode/v2/preferences.json'),
      path.join(ap, 'masscode/v2/preferences.json'));
  } else { // linux 等
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    prefCands.push(
      path.join(xdg, 'massCode/v2/preferences.json'),
      path.join(xdg, 'masscode/v2/preferences.json'));
  }
  for (const p of prefCands) {
    try {
      const pref = JSON.parse(fs.readFileSync(p, 'utf8'));
      const root = pref && pref.storage && pref.storage.rootPath;
      if (root) return path.join(root, 'markdown-vault');
    } catch (_) { /* ignore */ }
  }
  // 2) 常见默认位置兜底
  const defaults = [
    path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault'),
    path.join(os.homedir(), 'massCode/markdown-vault'),
    path.join(os.homedir(), 'Documents/massCode/markdown-vault'),
  ];
  for (const p of defaults) if (fs.existsSync(p)) return p;
  return defaults[0];
}

function vaultPath() {
  const v = process.env.CODESCOPE_VAULT || process.env.MASSCODE_VAULT;
  if (v) {
    if (!fs.existsSync(v)) throw new Error('CODESCOPE_VAULT 指向的目录不存在: ' + v);
    return v;
  }
  return defaultVaultPath();
}

/* -------------------------------- 实时系统状态 -------------------------------- */

function cpuTimes() {
  let idle = 0, total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}
let CPU_LAST = cpuTimes(), CPU_USAGE = 0;
const CPU_SAMPLE_TIMER = setInterval(() => {
  const next = cpuTimes(), total = next.total - CPU_LAST.total, idle = next.idle - CPU_LAST.idle;
  if (total > 0) CPU_USAGE = Math.max(0, Math.min(100, (1 - idle / total) * 100));
  CPU_LAST = next;
}, 1000);
CPU_SAMPLE_TIMER.unref();

let DISK_CACHE = { at: 0, value: null };
let MEMORY_CACHE = { at: 0, value: null };
function execFileText(command, args, timeout) {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: 'utf8', timeout: timeout || 5000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message))) : resolve(String(stdout || ''))));
}
async function memoryStatus() {
  if (MEMORY_CACHE.value && Date.now() - MEMORY_CACHE.at < 1800) return MEMORY_CACHE.value;
  const total = os.totalmem(); let free = os.freemem();
  try {
    if (process.platform === 'linux') {
      const info = fs.readFileSync('/proc/meminfo', 'utf8');
      const available = /^MemAvailable:\s+(\d+)\s+kB/im.exec(info);
      if (available) free = Number(available[1]) * 1024;
    } else if (process.platform === 'darwin') {
      const stat = await execFileText('vm_stat', [], 3000);
      const pageMatch = /page size of\s+(\d+) bytes/i.exec(stat);
      const pageSize = pageMatch ? Number(pageMatch[1]) : 4096;
      const pages = (label) => { const m = new RegExp('^' + label + ':\\s+(\\d+)', 'mi').exec(stat); return m ? Number(m[1]) : 0; };
      // inactive/speculative 是可快速回收的文件缓存；比 os.freemem 更符合活动监视器的“可用内存”。
      free = (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * pageSize;
    }
  } catch (_) { /* 回退到 os.freemem */ }
  free = Math.max(0, Math.min(total, free));
  const used = Math.max(0, total - free);
  const value = { total, used, free, usage: total ? used / total * 100 : 0 };
  MEMORY_CACHE = { at: Date.now(), value };
  return value;
}
async function diskStatus() {
  if (DISK_CACHE.value && Date.now() - DISK_CACHE.at < 5000) return DISK_CACHE.value;
  let value;
  try {
    if (process.platform === 'win32') {
      const drive = path.parse(vaultPath()).root.replace(/[\\/]+$/, '') || 'C:';
      const script = "$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='" + drive.replace(/'/g, "''") + "'\"; $d | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress";
      const parsed = JSON.parse(await execFileText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 6000));
      const total = Number(parsed.Size || 0), free = Number(parsed.FreeSpace || 0);
      value = { total, free, used: Math.max(0, total - free), usage: total ? (total - free) / total * 100 : 0, mount: parsed.DeviceID || drive };
    } else {
      const lines = (await execFileText('df', ['-Pk', vaultPath()], 5000)).trim().split(/\r?\n/);
      const fields = (lines[lines.length - 1] || '').trim().split(/\s+/);
      if (fields.length < 6) throw new Error('无法解析 df 输出');
      const total = Number(fields[1]) * 1024, free = Number(fields[3]) * 1024, used = Math.max(0, total - free);
      value = { total, used, free, usage: total ? used / total * 100 : 0, mount: fields.slice(5).join(' ') };
    }
  } catch (e) {
    value = { total: 0, used: 0, free: 0, usage: 0, mount: '', error: e.message };
  }
  DISK_CACHE = { at: Date.now(), value };
  return value;
}

async function systemStatus() {
  const cpus = os.cpus(), memory = await memoryStatus();
  return {
    ok: true,
    timestamp: Date.now(),
    cpu: {
      usage: CPU_USAGE,
      cores: cpus.length,
      model: cpus[0] ? cpus[0].model.trim() : 'Unknown CPU',
      speedMHz: cpus.length ? Math.round(cpus.reduce((sum, cpu) => sum + Number(cpu.speed || 0), 0) / cpus.length) : 0,
      load: process.platform === 'win32' ? [] : os.loadavg(),
    },
    memory,
    disk: await diskStatus(),
    system: { hostname: os.hostname(), platform: platformInfo().label, arch: os.arch(), uptime: os.uptime() },
  };
}

/* --------------------------------- 环境检测 ---------------------------------- */

// Windows 上通常没有 python3，只有 python / py；跨平台解析可用的 Python 命令
let _pyCmd = null;
function pythonCmd() {
  if (_pyCmd) return _pyCmd;
  const cands = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const c of cands) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 }); return _pyCmd = c; } catch (_) {}
  }
  return _pyCmd = cands[0];
}

// LaTeX 优先使用 XeLaTeX（Unicode/中文文档体验更好），不可用时回退到 pdfLaTeX。
let _latexCmd = null;
function latexCmd() {
  if (_latexCmd) return _latexCmd;
  for (const c of ['xelatex', 'pdflatex']) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 }); return _latexCmd = c; } catch (_) {}
  }
  return _latexCmd = 'xelatex';
}
function latexStarter() {
  let hasCtex = false;
  try { hasCtex = !!execFileSync('kpsewhich', ['ctexart.cls'], { encoding: 'utf8', timeout: 5000 }).trim(); } catch (_) {}
  return hasCtex
    ? '\\documentclass[UTF8,11pt]{ctexart}\n\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{amsmath}\n\n\\title{LaTeX 文档}\n\\author{}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{开始}\n在这里编写内容。\n\n\\end{document}'
    : '\\documentclass[11pt]{article}\n\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{amsmath}\n\n\\title{LaTeX Document}\n\\author{}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nStart writing here.\n\n\\end{document}';
}
function latexProjectStarter() {
  return '\\documentclass[UTF8,11pt]{ctexart}\n' +
    '\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\usepackage{fontspec}\n' +
    '\\graphicspath{{figures/}}\n\n' +
    '% 字体文件放入 fonts/ 后可启用，例如：\n% \\setmainfont[Path=fonts/]{YourFont.ttf}\n\n' +
    '\\newif\\ifhasreferences\n\\IfFileExists{data/references.bib}{%\n  \\hasreferencestrue\n  \\usepackage[backend=biber]{biblatex}\n  \\addbibresource{data/references.bib}\n}{}\n\n' +
    '\\title{LaTeX 工程}\n\\author{}\n\\date{\\today}\n\n' +
    '\\begin{document}\n\\maketitle\n\n\\section{开始}\n在左侧编辑源码，右侧会实时生成 PDF。\n\n' +
    '\\section{图片}\n% 图片放入 figures/ 后取消下面一行注释：\n% \\includegraphics[width=0.7\\linewidth]{example.png}\n\n' +
    '\\ifhasreferences\n\\nocite{*}\n\\printbibliography\n\\fi\n\n\\end{document}';
}

const TOOLS = [
  { key: 'node',       probe: ['node', '--version'],            label: 'Node.js',              for: 'Runner / JS / TS', group: '基础环境', minMajor: 18 },
  { key: 'python3',    probe: () => [pythonCmd(), '--version'], label: 'Python 3',             for: 'Python 运行/检查与交互终端', group: '运行环境', minMajor: 3 },
  { key: 'bash',       probe: ['bash', '--version'],            label: 'Bash',                 for: 'Shell 运行/部署脚本', group: '运行环境' },
  { key: 'gcc',        probe: ['gcc', '--version'],             label: 'GCC（C 编译）',         for: 'C 运行/检查', group: '编译工具链' },
  { key: 'gpp',        probe: ['g++', '--version'],             label: 'G++（C++ 编译）',       for: 'C++ 运行/检查', group: '编译工具链' },
  { key: 'java',       probe: ['javac', '--version'],           label: 'Java JDK',             for: 'Java 运行/检查', group: '运行环境', minMajor: 11 },
  { key: 'ruby',       probe: ['ruby', '--version'],            label: 'Ruby',                 for: 'Ruby 运行/检查', group: '运行环境' },
  { key: 'swift',      probe: ['swift', '--version'],           label: 'Swift',                for: 'Swift 运行/检查', group: '运行环境' },
  { key: 'go',         probe: ['go', 'version'],                label: 'Go',                   for: 'Go 运行/检查', group: '运行环境' },
  { key: 'clangformat', probe: ['clang-format', '--version'],   label: 'clang-format',         for: 'C/C++ 格式化', group: '格式化工具' },
  { key: 'gofmt',      probe: ['gofmt', '-h'],                  label: 'gofmt',                for: 'Go 格式化', group: '格式化工具' },
  { key: 'black',      probe: () => [pythonCmd(), '-m', 'black', '--version'], label: 'black', for: 'Python 格式化', group: '格式化工具' },
  { key: 'npx',        probe: ['npx', '--version'],             label: 'npx（Prettier）',       for: '前端/文档格式化', group: '格式化工具' },
  { key: 'latex',      probe: () => [latexCmd(), '--version'],  label: 'LaTeX 引擎',            for: 'LaTeX 实时 PDF 编译', group: '文档工具' },
  { key: 'biber',      probe: ['biber', '--version'],           label: 'Biber',                for: 'LaTeX 参考文献', group: '文档工具' },
  { key: 'ctex',       probe: ['kpsewhich', 'ctexart.cls'],     label: 'CTeX 中文宏包',          for: 'LaTeX 中文文档', group: '文档工具' },
  { key: 'clangd',     probe: ['clangd', '--version'],          label: 'clangd',               for: 'C/C++ 精确跳转、悬停与诊断（可选）', group: '语言服务器', installable: false },
  { key: 'pyrightlsp', probe: ['pyright-langserver', '--version'], label: 'Pyright LSP',         for: 'Python 精确跳转、悬停与诊断（可选）', group: '语言服务器', installable: false },
  { key: 'tslsp',      probe: ['typescript-language-server', '--version'], label: 'TypeScript LSP', for: 'JS/TS 精确跳转、悬停与诊断（可选）', group: '语言服务器', installable: false },
  { key: 'gopls',      probe: ['gopls', 'version'],             label: 'gopls',                for: 'Go 精确跳转、悬停与诊断（可选）', group: '语言服务器', installable: false },
  { key: 'ssh',        probe: ['ssh', '-V'],                    label: 'OpenSSH 客户端',          for: 'SSH 远程开发', group: '远程开发' },
  { key: 'drawio',     probeUrl: 'https://embed.diagrams.net/?embed=1&proto=json', label: 'Draw.io 在线编辑器', for: 'Draw.io 编辑与 AI XML 绘图', group: '绘图工具', installable: false },
];

const TOOLS_BY_LANGUAGE = {
  javascript: ['node', 'npx'], typescript: ['node', 'npx'],
  python: ['python3', 'black'], bash: ['bash', 'npx'], shell: ['bash', 'npx'],
  c: ['gcc', 'clangformat'], c_cpp: ['gcc', 'gpp', 'clangformat'],
  java: ['java'], ruby: ['ruby'], swift: ['swift'], go: ['go', 'gofmt'],
  json: ['npx'], json5: ['npx'], html: ['npx'], css: ['npx'], scss: ['npx'],
  less: ['npx'], yaml: ['npx'], markdown: ['npx'],
  latex: ['latex', 'biber', 'ctex'],
};

function projectToolKeys() {
  const keys = new Set(['node']);
  const languages = new Set();
  try {
    for (const s of walkSnippets()) for (const f of (s.fragments || [])) {
      const lang = String(f.language || '').toLowerCase();
      if (!lang || lang === 'plain_text') continue;
      languages.add(lang);
      for (const key of (TOOLS_BY_LANGUAGE[lang] || [])) keys.add(key);
    }
  } catch (_) { /* vault 尚未就绪时至少检测 Node */ }
  try {
    const pending = [path.join(vaultPath(), 'drawings')];
    while (pending.length) {
      const dir = pending.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) pending.push(path.join(dir, entry.name));
        else if (/\.drawio$/i.test(entry.name)) { keys.add('drawio'); pending.length = 0; break; }
      }
    }
  } catch (_) { /* 绘图目录可能尚未创建 */ }
  return { keys, languages: [...languages].sort() };
}

function executablePath(cmd) {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(finder, [cmd], { encoding: 'utf8', timeout: 3000 }).split(/\r?\n/)[0].trim();
  } catch (_) { return ''; }
}

function readLinuxRelease() {
  if (process.platform !== 'linux') return {};
  try {
    const text = fs.readFileSync('/etc/os-release', 'utf8');
    const data = {};
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m) data[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return data;
  } catch (_) { return {}; }
}

function platformInfo() {
  const rel = readLinuxRelease();
  const packageManager = ['apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk'].find(executablePath) || '';
  let variant = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : (rel.PRETTY_NAME || rel.NAME || 'Linux');
  let isWsl = false;
  if (process.platform === 'linux') {
    try { isWsl = /microsoft/i.test(os.release() + ' ' + fs.readFileSync('/proc/version', 'utf8')); } catch (_) {}
    if (isWsl) variant += '（WSL）';
  }
  return {
    id: process.platform, arch: process.arch, label: variant,
    release: os.release(), distro: rel.ID || '', distroLike: rel.ID_LIKE || '',
    packageManager, isWsl,
  };
}

function runtimeCheck(key, label, target, options = {}) {
  const required = options.required !== false;
  let available = false, issue = '', version = options.version || '', resolved = target || '';
  try {
    if (options.kind === 'dependency') {
      resolved = require.resolve(target);
      available = true;
    } else if (options.kind === 'node') {
      const major = Number(process.versions.node.split('.')[0]);
      available = Number.isInteger(major) && major >= 18;
      version = process.version;
      resolved = process.execPath;
      if (!available) issue = '需要 Node.js 18 或更高版本';
    } else {
      fs.mkdirSync(target, { recursive:true });
      fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK);
      available = fs.statSync(target).isDirectory();
      if (!available) issue = '路径不是目录';
    }
  } catch (error) {
    issue = String(error && error.message || error).slice(0, 180);
  }
  return {
    key, label, for:options.for || '', group:'运行基础', available, installed:available,
    required, version:version || (available ? '可用' : ''), path:resolved, issue,
    hint:options.hint || '', installable:false,
  };
}

function runtimeReadiness() {
  let vault = '';
  try { vault = vaultPath(); } catch (error) {
    return {
      vault:{ key:'vault', label:'Vault 数据目录', for:'代码、文档、论文和绘图数据', group:'运行基础', available:false, installed:false, required:true, version:'', path:'', issue:String(error.message || error), hint:'设置 CODESCOPE_VAULT 指向可读写的 markdown-vault 目录', installable:false },
    };
  }
  const dataRoot = path.dirname(timelineRoot());
  const dependencies = Object.keys(require('./package.json').dependencies || {});
  const unresolved = dependencies.filter((name) => !fs.existsSync(path.join(__dirname, 'node_modules', ...name.split('/'), 'package.json')));
  const dependency = {
    key:'dependencies', label:'前端与服务依赖', for:'编辑器、PDF、XMind、Office、SSH 与实时通信', group:'运行基础',
    available:unresolved.length === 0, installed:unresolved.length === 0, required:true,
    version:unresolved.length ? '' : dependencies.length + ' 个依赖完整', path:path.join(__dirname, 'node_modules'),
    issue:unresolved.length ? '缺少：' + unresolved.join('、') : '', hint:'在 masscode-runner 目录运行 npm ci', installable:false,
  };
  return {
    node:runtimeCheck('runtimeNode', 'Node.js 运行时', process.execPath, { kind:'node', for:'CodeScope 本地服务', hint:'安装 Node.js 18 或更高版本' }),
    vault:runtimeCheck('vault', 'Vault 数据目录', vault, { for:'代码、文档、论文和绘图数据', hint:'确认目录存在且当前用户有读写权限' }),
    appData:runtimeCheck('appData', '应用数据目录', dataRoot, { for:'时间线、恢复点和本地状态', hint:'确认系统应用数据目录可读写' }),
    temp:runtimeCheck('temp', '系统临时目录', os.tmpdir(), { for:'LaTeX 编译、导入和安全转换', hint:'确认系统临时目录可读写' }),
    dependencies:dependency,
  };
}

function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }

function deploymentInfo(env, requiredKeys) {
  const missing = [...requiredKeys].filter((key) => {
    const tool = TOOLS.find((item) => item.key === key);
    return env[key] && !env[key].available && (!tool || tool.installable !== false);
  });
  const script = process.platform === 'win32' ? path.join(__dirname, 'deploy-env.ps1') : path.join(__dirname, 'deploy-env.sh');
  const supported = fs.existsSync(script) && (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32');
  let command = '';
  if (supported && missing.length) {
    command = process.platform === 'win32'
      ? '& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + script.replace(/"/g, '""') + '" ' + missing.join(' ') + '; Write-Output ("__MASSCODE_DEPLOY_DONE__:" + $LASTEXITCODE)'
      : 'bash ' + shellQuote(script) + ' ' + missing.map(shellQuote).join(' ') + '; masscode_deploy_status=$?; printf "\\n__MASSCODE_DEPLOY_DONE__:%s\\n" "$masscode_deploy_status"';
  }
  return { supported, command, missing, script, needsTerminal: true };
}

let envCache = null;
const NET_PROBE_FAIL = {};   // 网络型工具（Draw.io 等）探测失败时间戳，短缓存避免反复等待超时
async function detectEnv({ skipNet } = {}) {
  const project = projectToolKeys();
  const results = await Promise.all(TOOLS.map(async (t) => {
    const started = Date.now();
    if (t.probeUrl) {
      if (skipNet) {
        // 本地模式下不访问网络：在线编辑器状态按需在刷新时探测
        return { key:t.key, label:t.label, for:t.for, group:t.group, available:true, installed:true,
          required:project.keys.has(t.key), version:'在线编辑（按需检测）', minVersion:'',
          issue:'', path:t.probeUrl, elapsedMs:0, installable:false };
      }
      if (NET_PROBE_FAIL[t.key] && Date.now() - NET_PROBE_FAIL[t.key] < 120000) {
        return { key:t.key, label:t.label, for:t.for, group:t.group, available:false, installed:false,
          required:project.keys.has(t.key), version:'', minVersion:'',
          issue:'无法连接 embed.diagrams.net（' + (t.probeUrl||'').replace(/^https?:\/\//, '') + '，2 分钟内不再重试）',
          path:t.probeUrl, elapsedMs:0, installable:false };
      }
      try {
        const response = await fetch(t.probeUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(3000) });
        try { if (response.body) await response.body.cancel(); } catch (_) {}
        const available = response.ok;
        return {
          key:t.key, label:t.label, for:t.for, group:t.group, available, installed:available,
          required:project.keys.has(t.key), version:available ? '在线 · HTTP ' + response.status : 'HTTP ' + response.status,
          minVersion:'', issue:available ? '' : '在线服务返回 HTTP ' + response.status,
          path:t.probeUrl, elapsedMs:Date.now()-started, installable:false,
        };
      } catch (error) {
        NET_PROBE_FAIL[t.key] = Date.now();
        return {
          key:t.key, label:t.label, for:t.for, group:t.group, available:false, installed:false,
          required:project.keys.has(t.key), version:'', minVersion:'',
          issue:'无法连接 embed.diagrams.net：' + String((error && error.message) || error).slice(0, 100),
          path:t.probeUrl, elapsedMs:Date.now()-started, installable:false,
        };
      }
    }
    return new Promise((resolve) => {
    const cmd = typeof t.probe === 'function' ? t.probe() : t.probe;
    execFile(cmd[0], cmd.slice(1), { timeout: 15000 }, (err, stdout, stderr) => {
      const rawVersion = !err ? String(stdout || stderr || '').split(/\r?\n/)[0].trim().slice(0, 80) : '';
      const majorMatch = rawVersion.match(/\d+/);
      const major = majorMatch ? Number(majorMatch[0]) : null;
      const versionOk = !t.minMajor || (major != null && major >= t.minMajor);
      resolve({
        key: t.key, label: t.label, for: t.for, group: t.group,
        available: !err && versionOk,
        installed: !err,
        required: project.keys.has(t.key),
        version: rawVersion,
        minVersion: t.minMajor ? String(t.minMajor) + '+' : '',
        issue: !err && !versionOk ? '版本过低，需要 ' + t.minMajor + '+' : (!err ? '' : '未安装或不在 PATH'),
        path: !err ? executablePath(cmd[0]) : '',
        elapsedMs: Date.now() - started,
      });
    });
    });
  }));
  const map = {};
  for (const r of results) map[r.key] = r;
  return { tools: map, project };
}
async function getEnv(force) {
  // 默认只做本地工具探测（无网络请求）：运行/编译各入口调用频繁，绝不能被 drawio 等
  // 在线探测的网络超时拖慢。网络型工具仅在 force（环境检测界面点刷新）时探测。
  if (force || !envCache) envCache = await detectEnv({ skipNet: !force });
  return envCache;
}

// 给某工具缺失时的安装提示（按平台给不同命令）
function linuxInstallHint(key) {
  if (key === 'ctex') key = 'latex';
  const pm = platformInfo().packageManager || 'apt-get';
  const packages = {
    'apt-get': { node:'nodejs npm', python3:'python3 python3-pip', bash:'bash', gcc:'build-essential', gpp:'build-essential', java:'default-jdk', ruby:'ruby', go:'golang-go', clangformat:'clang-format', gofmt:'golang-go', npx:'npm', latex:'texlive-xetex texlive-latex-extra texlive-fonts-recommended texlive-lang-chinese', biber:'biber', ssh:'openssh-client' },
    dnf: { node:'nodejs npm', python3:'python3 python3-pip', bash:'bash', gcc:'gcc make', gpp:'gcc-c++ make', java:'java-21-openjdk-devel', ruby:'ruby', go:'golang', clangformat:'clang-tools-extra', gofmt:'golang', npx:'npm', latex:'texlive-xetex texlive-collection-latexextra texlive-ctex', biber:'biber', ssh:'openssh-clients' },
    yum: { node:'nodejs npm', python3:'python3 python3-pip', bash:'bash', gcc:'gcc make', gpp:'gcc-c++ make', java:'java-17-openjdk-devel', ruby:'ruby', go:'golang', clangformat:'clang', gofmt:'golang', npx:'npm', latex:'texlive-xetex texlive-collection-latexextra texlive-ctex', biber:'biber', ssh:'openssh-clients' },
    pacman: { node:'nodejs npm', python3:'python python-pip', bash:'bash', gcc:'base-devel', gpp:'base-devel', java:'jdk-openjdk', ruby:'ruby', go:'go', clangformat:'clang', gofmt:'go', npx:'npm', latex:'texlive-bin texlive-latexextra texlive-fontsrecommended texlive-langchinese', biber:'biber', ssh:'openssh' },
    zypper: { node:'nodejs npm', python3:'python3 python3-pip', bash:'bash', gcc:'gcc make', gpp:'gcc-c++ make', java:'java-17-openjdk-devel', ruby:'ruby', go:'go', clangformat:'clang-tools', gofmt:'go', npx:'npm', latex:'texlive-xetex texlive-latexextra texlive-ctex', biber:'biber', ssh:'openssh-clients' },
    apk: { node:'nodejs npm', python3:'python3 py3-pip', bash:'bash', gcc:'build-base', gpp:'build-base', java:'openjdk17', ruby:'ruby', go:'go', clangformat:'clang-extra-tools', gofmt:'go', npx:'npm', latex:'texlive-xetex texmf-dist-latexextra texmf-dist-langchinese', biber:'biber', ssh:'openssh-client-default' },
  };
  if (key === 'swift') return '从 swift.org 安装对应 Linux 工具链';
  if (key === 'black') return 'python3 -m pip install --user black';
  const pkg = (packages[pm] || packages['apt-get'])[key];
  if (!pkg) return '请使用系统包管理器安装 ' + key;
  if (pm === 'pacman') return 'sudo pacman -S --needed ' + pkg;
  if (pm === 'apk') return 'sudo apk add ' + pkg;
  return 'sudo ' + pm + ' install -y ' + pkg;
}

function installHint(key) {
  const win = process.platform === 'win32';
  const lin = process.platform === 'linux';
  const mac = !win && !lin;
  const H = {
    node: mac ? 'brew install node' : win ? 'winget install OpenJS.NodeJS.LTS（或 nodejs.org 下载）' : linuxInstallHint(key),
    python3: mac ? 'brew install python' : win ? 'winget install Python.Python.3.12（自带 python 命令）' : linuxInstallHint(key),
    bash: mac ? '系统自带' : win ? '安装 Git Bash 或启用 WSL（Windows 默认无 bash）' : linuxInstallHint(key),
    gcc: mac ? 'xcode-select --install' : win ? '安装 MinGW-w64 或 Visual Studio 的 C/C++ 工具' : linuxInstallHint(key),
    gpp: mac ? 'xcode-select --install' : win ? '安装 MinGW-w64 或 Visual Studio 的 C/C++ 工具' : linuxInstallHint(key),
    java: mac ? 'brew install --cask temurin' : win ? 'winget install EclipseAdoptium.Temurin.21.JDK' : linuxInstallHint(key),
    ruby: mac ? 'brew install ruby' : win ? '安装 RubyInstaller（rubyinstaller.org）' : linuxInstallHint(key),
    swift: mac ? 'xcode-select --install' : win ? 'Swift 官方 Windows 工具链（实验性）' : 'swift.org 工具链',
    go: mac ? 'brew install go' : win ? 'winget install GoLang.Go' : linuxInstallHint(key),
    clangformat: mac ? 'xcode-select --install 或 brew install clang-format' : win ? '安装 LLVM（releases.llvm.org）' : linuxInstallHint(key),
    gofmt: mac ? 'brew install go（自带 gofmt）' : win ? '安装 Go（自带 gofmt）' : linuxInstallHint(key),
    black: mac ? 'pip3 install --user black' : win ? (pythonCmd() === 'py' ? 'py -m pip install black' : 'python -m pip install black') : linuxInstallHint(key),
    npx: mac ? 'brew install node（自带 npx）' : win ? '安装 Node.js（自带 npx）' : linuxInstallHint(key),
    latex: mac ? 'brew install --cask mactex-no-gui' : win ? 'winget install MiKTeX.MiKTeX' : linuxInstallHint(key),
    clangd: mac ? 'xcode-select --install 或 brew install llvm' : win ? 'winget install LLVM.LLVM' : '使用系统包管理器安装 clangd',
    pyrightlsp: 'npm install -g pyright',
    tslsp: 'npm install -g typescript typescript-language-server',
    gopls: 'go install golang.org/x/tools/gopls@latest',
    ssh: mac ? 'macOS 系统自带；缺失时安装 Xcode Command Line Tools' : win ? '设置 → 可选功能 → OpenSSH 客户端' : linuxInstallHint(key),
    drawio: '无需安装；请检查网络、代理或防火墙能否访问 embed.diagrams.net',
  };
  if (key === 'biber' || key === 'ctex') return H.latex;
  return H[key] || '请安装对应工具';
}

function missingReason(key, detected) {
  const t = TOOLS.find((x) => x.key === key);
  const issue = detected && detected.issue ? detected.issue : '未安装或不在 PATH';
  return (t ? t.label : key) + '不可用：' + issue + '（用于 ' + (t ? t.for : '') + '）。安装/升级: ' + installHint(key);
}

/* --------------------------------- frontmatter 解析 -------------------------------- */

function parseFrontmatter(text) {
  // 解析 massCode 片段 .md 的 frontmatter（YAML 子集），返回 { meta, body }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const yaml = m[1];
  const body = text.slice(m[0].length);
  const meta = {};
  const contents = [];
  let cur = null;      // 当前 contents 列表项
  let listKey = null;  // 正在收集的列表：'contents' | 'tags'
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const listItem = /^(\s*)-\s+(.+)$/.exec(line);
    if (listItem && listItem[1].length === 2) {
      if (listKey === 'tags') {
        const n = parseInt(listItem[2], 10);
        if (Number.isFinite(n)) meta.tags.push(n);
        continue;
      }
      cur = {};
      contents.push(cur);
      const kv = splitKV(listItem[2]);
      if (kv) cur[kv[0]] = kv[1];
      continue;
    }
    const itemField = /^\s{4,}(.+)$/.exec(line);
    if (itemField && cur) {
      const kv = splitKV(itemField[1]);
      if (kv) cur[kv[0]] = kv[1];
      continue;
    }
    const kv = splitKV(line);
    if (kv) {
      if (kv[0] === 'contents') { listKey = 'contents'; continue; }
      if (kv[0] === 'tags') { listKey = 'tags'; meta.tags = meta.tags || []; continue; }
      listKey = null;
      meta[kv[0]] = kv[1];
    }
  }
  if (contents.length) meta.contents = contents;
  if (!meta.tags) meta.tags = [];
  return { meta, body };
}

function splitKV(s) {
  const idx = s.indexOf(':');
  if (idx < 0) return null;
  const key = s.slice(0, idx).trim();
  let val = s.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return [key, val];
}

/* --------------------------------- 片段解析 ---------------------------------- */

// 每个片段推一个"文件名"：标签长得像文件名（如 main.cpp / calc.hpp）就直接用，
// 否则按语言给默认名（单文件 main.xxx，多文件 fileN.xxx）。
const EXT_FOR_LANG = {
  javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', shell: 'sh',
  c_cpp: 'cpp', c: 'c', java: 'java', ruby: 'rb', swift: 'swift', go: 'go',
  json: 'json', html: 'html', css: 'css', markdown: 'md', plain_text: 'txt',
  latex: 'tex',
  draw: 'draw', drawing: 'draw',
};
const KNOWN_EXT = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|py|js|mjs|cjs|ts|sh|go|java|rb|swift|json|html|css|yml|yaml|md|tex|txt|draw)$/i;
function computeFilename(label, language, index, total) {
  const lbl = (label || '').trim();
  // 仅当 label 本身就是一个「纯文件名」时才直接使用：含路径分隔符、上跳或隐藏前缀的一律回落到默认名，
  // 否则片段名可以控制写入路径（例如 ../../x.py 写出临时目录）。
  if (lbl && !/[/\\]/.test(lbl) && !lbl.startsWith('.') && KNOWN_EXT.test(lbl)) return lbl;
  const ext = EXT_FOR_LANG[(language || '').toLowerCase()] || 'txt';
  return total === 1 ? 'main.' + ext : 'file' + (index + 1) + '.' + ext;
}

function extractFragments(meta, body) {
  // 按 "## Fragment: xxx" 标题 + 后面的围栏代码块切分
  const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
  const fragments = [];
  const heads = [];
  let m;
  while ((m = headingRe.exec(body))) heads.push({ label: m[1].trim(), index: m.index });
  if (!heads.length) {
    // 没有 Fragment 标题：整段按 frontmatter 的 contents[0] 处理
    const first = (meta.contents || [])[0];
    const code = extractFirstFence(body);
    if (first || code) {
      const label = first && first.label ? first.label : '片段';
      const language = first && first.language ? first.language : 'plain_text';
      fragments.push({
        id: first ? String(first.id) : '0',
        label,
        language,
        filename: computeFilename(label, language, 0, 1),
        code: code || '',
      });
    }
    return fragments;
  }
  const total = heads.length;
  for (let i = 0; i < heads.length; i++) {
    const segStart = heads[i].index + body.slice(heads[i].index).indexOf('\n') + 1;
    const segEnd = i + 1 < heads.length ? heads[i + 1].index : body.length;
    const seg = body.slice(segStart, segEnd);
    const info = (meta.contents && meta.contents[i]) || {};
    const label = heads[i].label || (info.label || '片段 ' + (i + 1));
    const language = info.language || guessLanguage(heads[i].label) || 'plain_text';
    fragments.push({
      index: i,
      id: String(info.id != null ? info.id : i),
      label,
      language,
      filename: computeFilename(label, language, i, total),
      code: extractFirstFence(seg) || '',
    });
  }
  return fragments;
}

function extractFirstFence(seg) {
  // 片段 = 段内【第一个】``` 围栏（开）到【最后一个】``` 围栏（关）；
  // 必须取首↔末，不能用非贪婪匹配——markdown 片段内容自带围栏代码块时，非贪婪会在内层 ``` 处错误截断
  const lines = String(seg).split('\n');
  let first = -1, last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) { if (first < 0) first = i; last = i; }
  }
  if (first < 0 || last <= first) return '';
  return lines.slice(first + 1, last).join('\n').replace(/\n$/, '');
}

function guessLanguage(label) {
  const map = {
    'js': 'javascript', 'javascript': 'javascript', 'ts': 'typescript',
    'python': 'python', 'py': 'python', 'bash': 'bash', 'sh': 'bash',
    'c': 'c_cpp', 'cpp': 'c_cpp', 'c++': 'c_cpp', 'json': 'json',
    'html': 'html', 'css': 'css',
  };
  const k = label.toLowerCase();
  return map[k] || null;
}

/* 读取 massCode 标签注册表（id -> name），片段 frontmatter 里 tags 存的是 id */
function readTagRegistry() {
  try {
    const p = path.join(vaultPath(), 'code/.masscode/state.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const list = Array.isArray(d.tags) ? d.tags.map((t) => ({ id: t.id, name: t.name })) : [];
    const map = {};
    for (const t of list) map[String(t.id)] = t.name;
    return { map, list };
  } catch (_) { return { map: {}, list: [] }; }
}

/* 把 parseFrontmatter 的 {meta, body} 序列化回 massCode 格式 frontmatter + body */
function stringifyFrontmatter(fm) {
  const m = fm.meta || {};
  const lines = ['---'];
  if (Array.isArray(m.contents) && m.contents.length) {
    lines.push('contents:');
    for (const c of m.contents) {
      lines.push('  - id: ' + (c.id !== undefined ? c.id : ''));
      if (c.label !== undefined) lines.push('    label: ' + c.label);
      if (c.language !== undefined) lines.push('    language: ' + c.language);
    }
  }
  for (const k of ['createdAt', 'description', 'folderId', 'id', 'isDeleted', 'isFavorites', 'name', 'updatedAt']) {
    if (m[k] === undefined) continue;
    if (k === 'description') lines.push('description: ' + (m[k] ? JSON.stringify(m[k]) : '""'));
    else lines.push(k + ': ' + m[k]);
  }
  lines.push('tags:');
  for (const t of (Array.isArray(m.tags) ? m.tags : [])) lines.push('  - ' + t);
  return lines.join('\n') + '\n---\n' + (fm.body || '');
}

function walkSnippets() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const out = [];
  if (!fs.existsSync(codeRoot)) return out;
  const tagReg = readTagRegistry();
  const walk = (dir, folder) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.masscode') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, path.join(folder, e.name));
      else if (e.name.endsWith('.md')) {
        try {
          const text = fs.readFileSync(full, 'utf8');
          const { meta, body } = parseFrontmatter(text);
          if (meta.isDeleted === '1') continue;
          const tagIds = Array.isArray(meta.tags) ? meta.tags.map(Number).filter(Number.isFinite) : [];
          out.push({
            file: full,
            name: meta.name || path.basename(e.name, '.md'),
            description: (meta.description && meta.description !== 'null') ? meta.description : '',
            isFavorites: meta.isFavorites === '1',
            folder: folder.replace(/^\/+/, ''),
            updatedAt: Number(meta.updatedAt) || 0,
            tagIds,
            tags: tagIds.map((id) => tagReg.map[String(id)]).filter(Boolean),
            fragments: extractFragments(meta, body),
          });
        } catch (_) { /* skip unreadable */ }
      }
    }
  };
  walk(codeRoot, '');
  out.sort((a, b) => a.folder.localeCompare(b.folder) || b.updatedAt - a.updatedAt);
  return out;
}

// 完整文件夹结构（含空文件夹），用于前端目录树按真实结构渲染
function walkFolders() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const out = [];
  if (!fs.existsSync(codeRoot)) return out;
  const readMeta = (full) => {
    let name = path.basename(full), id = null, orderIndex = null;
    try {
      const m = fs.readFileSync(path.join(full, '.meta.yaml'), 'utf8');
      let mm = /^name:\s*(.+)$/m.exec(m); if (mm && mm[1].trim() !== '') name = mm[1].trim();
      mm = /^id:\s*(.+)$/m.exec(m); if (mm) id = String(mm[1]).trim();
      mm = /^orderIndex:\s*(.+)$/m.exec(m); if (mm) orderIndex = Number(mm[1]) || 0;
    } catch (_) {}
    return { name, id, orderIndex };
  };
  const walk = (dir, parentPath) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue; // 跳过 .masscode 等隐藏元数据目录
      const full = path.join(dir, e.name);
      const rel = parentPath ? parentPath + '/' + e.name : e.name;
      const meta = readMeta(full);
      out.push({ path: rel, name: meta.name, id: meta.id, orderIndex: meta.orderIndex, parent: parentPath || '' });
      walk(full, rel);
    }
  };
  walk(codeRoot, '');
  out.sort((a, b) => (a.parent === b.parent ? (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || a.name.localeCompare(b.name, 'zh') : a.parent.localeCompare(b.parent)));
  return out;
}

const LATEX_RESOURCE_DIRS = new Set(['data', 'figures', 'fonts']);
const LATEX_TEXT_EXTS = new Set(['.bib', '.tex', '.sty', '.cls', '.csv', '.json', '.yaml', '.yml', '.txt']);
const LATEX_RESOURCE_EXTS = new Set([...LATEX_TEXT_EXTS, '.bst', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.eps', '.otf', '.ttf', '.ttc', '.woff', '.woff2']);

function latexResourceKind(rel) {
  const parts = String(rel || '').split('/');
  return parts.find((part) => LATEX_RESOURCE_DIRS.has(part)) || '';
}
function resolveLatexResource(rel, allowMissing) {
  rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('资源路径不合法');
  const kind = latexResourceKind(rel), ext = path.extname(rel).toLowerCase();
  if (!kind || !LATEX_RESOURCE_EXTS.has(ext)) throw new Error('只允许访问 LaTeX 的 data / figures / fonts 资源');
  const root = path.resolve(path.join(vaultPath(), 'code'));
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error('资源路径越界');
  if (!allowMissing && !fs.existsSync(full)) throw new Error('资源不存在');
  return { rel, full, root, kind, ext };
}
function walkLatexResources() {
  const root = path.join(vaultPath(), 'code'), out = [];
  const walk = (dir, rel) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, childRel); continue; }
      const kind = latexResourceKind(childRel), ext = path.extname(entry.name).toLowerCase();
      if (!kind || !LATEX_RESOURCE_EXTS.has(ext)) continue;
      let size = 0, updatedAt = 0; try { const st = fs.statSync(full); size = st.size; updatedAt = st.mtimeMs; } catch (_) {}
      out.push({ path: childRel, folder: path.posix.dirname(childRel) === '.' ? '' : path.posix.dirname(childRel), name: entry.name, kind, ext, size, updatedAt, text: LATEX_TEXT_EXTS.has(ext) });
    }
  };
  walk(root, '');
  return out.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
}

/* massCode 元数据库 .masscode/state.json：新建/移动片段与文件夹时需要登记，保证 massCode 识别 */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(vaultPath(), 'code', '.masscode', 'state.json'), 'utf8'));
  } catch (_) {
    return { version: 3, counters: { contentId: 1, folderId: 1, snippetId: 1, tagId: 1 }, folderIdByPath: {}, folderUi: {}, snippets: [], tags: [] };
  }
}
function writeState(st) {
  const p = path.join(vaultPath(), 'code', '.masscode', 'state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(st, null, 2), 'utf8');
}

/* 按标签名解析为 id，不存在的自动新建（massCode 标签注册表） */
function syncTags(st, names) {
  const ids = [];
  const byName = new Map();
  for (const t of st.tags) byName.set(t.name, t.id);
  for (const raw of names || []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    let id = byName.get(name);
    if (id === undefined) {
      id = ++st.counters.tagId;
      const now = Date.now();
      st.tags.push({ createdAt: now, id, name, updatedAt: now });
      byName.set(name, id);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/* 版本指纹：所有片段文件的 路径+mtime+大小 的哈希，用于前端实时同步检测。
   也纳入 state.json（标签/计数）与 .meta.yaml（文件夹元数据），保证新增/改名标签也能触发同步 */
function computeRev() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const parts = [];
  const addFile = (p) => {
    try {
      const st = fs.statSync(p);
      parts.push(p + ':' + st.mtimeMs + ':' + st.size);
    } catch (_) {}
  };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.masscode') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else addFile(full);
    }
  };
  walk(codeRoot);
  addFile(path.join(codeRoot, '.masscode/state.json'));
  const s = parts.sort().join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* --------------------------------- 执行引擎 ---------------------------------- */

const RUN_OUTPUT_LIMIT = 2 * 1024 * 1024;   // 单流输出上限 2 MB（超出截断并标记）
// 运行/检查产生的临时目录保留时长：到期自动回收（可用环境变量覆盖，便于测试）
const TMP_TTL_MS = Math.max(1000, Number(process.env.CODESCOPE_TMP_TTL_MS) || 30 * 60 * 1000);

// 到期回收临时目录（unref，不阻塞进程退出）；服务每次运行都会新建目录，必须回收
function scheduleTempCleanup(dir) {
  const timer = setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }, TMP_TTL_MS);
  if (timer.unref) timer.unref();
}

// 启动时清扫历史残留（例如服务被强杀时留下的目录）
function sweepTempDirs() {
  try {
    const root = os.tmpdir();
    const now = Date.now();
    let removed = 0;
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith('mscr-')) continue;
      const full = path.join(root, name);
      try {
        if (now - fs.statSync(full).mtimeMs > TMP_TTL_MS) { fs.rmSync(full, { recursive: true, force: true }); removed++; }
      } catch (_) {}
    }
    return removed;
  } catch (_) { return 0; }
}

function run(interp, args, opts = {}) {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs || 10000;
    const cwd = opts.cwd;
    const child = spawn(interp, args, {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', truncated = false;
    // 输出上限：单流最多保留 OUTPUT_LIMIT，避免用户打印海量内容时把服务内存吃满
    const collect = (chunk, isErr) => {
      const text = String(chunk);
      const current = isErr ? stderr : stdout;
      if (current.length >= RUN_OUTPUT_LIMIT) { truncated = true; return; }
      const room = RUN_OUTPUT_LIMIT - current.length;
      const next = text.length > room ? text.slice(0, room) : text;
      if (text.length > room) truncated = true;
      if (isErr) stderr = current + next; else stdout = current + next;
    };
    const tail = () => truncated ? '\n…（输出超过 ' + Math.round(RUN_OUTPUT_LIMIT / 1048576) + ' MB 已截断）' : '';
    const timer = setTimeout(() => {
      // 超时终止：POSIX 用进程组(负 pid)，Windows 无进程组概念，退回 child.kill()
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, timedOut: true, stdout: stdout + tail(), stderr, code: null, truncated });
    }, timeoutMs);
    child.stdout.on('data', (d) => collect(d, false));
    child.stderr.on('data', (d) => collect(d, true));
    // 写入 stdin（无输入时也立即关闭，避免 `while(cin>>x)` 挂起）
    try {
      if (opts.input) child.stdin.write(opts.input);
    } catch (_) {}
    try { child.stdin.end(); } catch (_) {}
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err.message || err), stdout: stdout + tail(), stderr, code: null, truncated });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, signal, stdout: stdout + tail(), stderr, truncated });
    });
  });
}

function writeTemp(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mscr-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content);
  scheduleTempCleanup(dir);
  return { dir, file: f };
}

// 库文件/驱动模块没有 main() 时，编译器会在链接阶段输出平台相关的晦涩错误。
// 统一识别 macOS/Linux/Windows 的“缺少程序入口”，交给前端显示为仅编译结果。
function normalizeMissingEntry(result) {
  if (!result || result.ok) return result;
  const message = String(result.stderr || result.error || '');
  const missingMain = /(?:undefined symbols?[\s\S]*["'`]_main["'`]|undefined reference to\s*["'`](?:main|WinMain)["'`]|unresolved external symbol\s+(?:_?main|WinMain)|entry point[^\n]*(?:main|WinMain))/i.test(message);
  if (!missingMain) return result;
  return {
    ...result,
    noEntry: true,
    stderr: '',
    reason: '当前代码没有 main() 入口函数，已完成编译检查，但不会生成或运行可执行程序。若这是驱动、库或接口模块，可直接使用“语法检查”；需要运行时请新增 main.c / main.cpp 并定义 int main(void)。',
  };
}

// CJK OpenType 字体常见为 10–25 MB；原来的单文件 10 MB 限制会把字体静默跳过，
// 最终只留下难以理解的 fontspec Error。允许常见字体通过，同时保留总量上限。
const LATEX_RESOURCE_FILE_LIMIT = 32 * 1024 * 1024;
const LATEX_RESOURCE_TOTAL_LIMIT = 96 * 1024 * 1024;

// 在独立临时目录编译 LaTeX，并禁用 shell escape。额外拦截显式绝对路径/上级目录引用。
async function copyLatexResources(sourceFile, targetDir) {
  const result = { copied: 0, bytes: 0, skipped: [] };
  if (!sourceFile) return result;
  const codeRoot = path.resolve(path.join(vaultPath(), 'code'));
  const resolved = path.resolve(String(sourceFile));
  if (!resolved.startsWith(codeRoot + path.sep) || path.extname(resolved).toLowerCase() !== '.md') return result;
  const sourceDir = path.dirname(resolved);
  const allowed = new Set(['.tex', '.sty', '.cls', '.bib', '.bst', '.csv', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.otf', '.ttf', '.ttc']);
  let total = 0;
  // 全程异步 fs：云盘（iCloud 等）目录枚举/stat 也可能同步挂起主线程从而卡死整个服务，
  // 一律交给 libuv 线程池执行，任何文件系统卡顿只影响当前请求（由外层超时兜底）。
  const copyDir = async (from, to, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = await fs.promises.readdir(from, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const src = path.join(from, entry.name), dst = path.join(to, entry.name);
      if (entry.isDirectory()) { try { await fs.promises.mkdir(dst, { recursive: true }); } catch (_) {} await copyDir(src, dst, depth + 1); continue; }
      if (!entry.isFile() || !allowed.has(path.extname(entry.name).toLowerCase())) continue;
      let size = 0; try { size = (await fs.promises.stat(src)).size; } catch (_) { continue; }
      const relative = path.relative(sourceDir, src).split(path.sep).join('/');
      if (size > LATEX_RESOURCE_FILE_LIMIT) { result.skipped.push(relative + '（单文件超过 32 MB）'); continue; }
      if (total + size > LATEX_RESOURCE_TOTAL_LIMIT) { result.skipped.push(relative + '（工程资源总量超过 96 MB）'); continue; }
      // 异步复制：云盘文件若未下载到本地，pread 会挂起——挂在 libuv 线程池线程上，
      // 而不是主线程，服务其余请求不受影响。同时给单文件复制加 10 秒硬超时：
      // 云盘资源长期拉不下来就直接跳过该资源继续编译，编译请求必须会结束，
      // 绝不会无限等待（前端请求因此不会再被拖到超时）。
      try {
        await Promise.race([
          fs.promises.copyFile(src, dst),
          new Promise((_, reject) => setTimeout(() => reject(new Error('copy timeout')), 10000)),
        ]);
        total += size; result.copied++;
      }
      catch (_) { result.skipped.push(relative + '（复制超时或失败）'); }
    }
  };
  await copyDir(sourceDir, targetDir, 0);
  result.bytes = total;
  return result;
}

const LATEX_BIB_CACHE = new Map();
async function latexBibliographyKey(dir, sourceFile, code) {
  const parts = [String(sourceFile || '')];
  const commands = String(code || '').match(/\\(?:addbibresource|bibliography|bibliographystyle|nocite|[A-Za-z]*cite[A-Za-z]*)\*?(?:\[[^\]]*\])?\{[^}]*\}/g) || [];
  parts.push(commands.join('|'));
  const walk = async (folder) => {
    let entries = [];
    try { entries = await fs.promises.readdir(folder, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.bib') {
        // 资源每次都会复制进新的临时目录，mtime 会随复制而变化；按内容计算才能稳定命中缓存。
        try { parts.push(path.relative(dir, full) + ':' + await fs.promises.readFile(full, 'utf8')); } catch (_) {}
      }
    }
  };
  await walk(dir);
  let hash = 5381, joined = parts.sort().join('|');
  for (let i = 0; i < joined.length; i++) hash = ((hash * 33) ^ joined.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

async function compileLatex(code, sourceFile) {
  const { tools: env } = await getEnv();
  if (!env.latex || !env.latex.available) {
    return { ok: false, unsupported: true, reason: missingReason('latex', env.latex) };
  }
  const unsafeFileRef = /\\(?:input|include|includegraphics|bibliography|addbibresource|lstinputlisting|verbatiminput|inputminted|openin)\b[^\r\n{=]*(?:\{|=)\s*(?:\/|[A-Za-z]:[\\/]|\.\.[\\/])/i;
  if (unsafeFileRef.test(code)) {
    return { ok: false, error: '为安全起见，实时预览不允许读取绝对路径或上级目录中的文件', log: '当前实时预览仅编译片段内的自包含 LaTeX 文档。' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mscr-latex-'));
  const source = path.join(dir, 'main.tex');
  const pdf = path.join(dir, 'main.pdf');
  const cmd = latexCmd();
  const copiedResources = await copyLatexResources(sourceFile, dir);
  const bibKey = await latexBibliographyKey(dir, sourceFile, code), cachedBbl = LATEX_BIB_CACHE.get(bibKey);
  if (cachedBbl) fs.writeFileSync(path.join(dir, 'main.bbl'), cachedBbl);
  fs.writeFileSync(source, code, 'utf8');
  const started = Date.now();
  try {
    const runFile = (program, args, timeout = 30000) => new Promise((resolve) => {
      execFile(program, args, {
        cwd: dir, timeout, maxBuffer: 6 * 1024 * 1024,
        env: { ...process.env, openin_any: 'p', openout_any: 'p', TEXMFOUTPUT: dir },
      }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
    });
    const texArgs = [
        '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error',
        '-cnf-line=openin_any=p', '-cnf-line=openout_any=p',
        '-file-line-error', '-synctex=0', '-output-directory=.', 'main.tex',
    ];
    let result = await runFile(cmd, texArgs), pipeline = cmd, texPasses = 1;
    const clean = (s) => String(s || '').split(dir).join('[临时目录]');
    const resourceWarning = copiedResources.skipped.length
      ? '[CodeScope] 以下 LaTeX 资源因大小限制未复制：\n- ' + copiedResources.skipped.join('\n- ') + '\n'
      : '';
    let log = resourceWarning + clean(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
    if (!result.err && fs.existsSync(path.join(dir, 'main.bcf')) && cachedBbl) {
      pipeline += ' + biber缓存';
    } else if (!result.err && fs.existsSync(path.join(dir, 'main.bcf')) && executablePath('biber')) {
      const bib = await runFile('biber', ['--input-directory', dir, '--output-directory', dir, 'main'], 30000);
      log += '\n' + clean(bib.stdout + (bib.stderr ? '\n' + bib.stderr : ''));
      if (bib.err) result = bib;
      else {
        pipeline += ' + biber';
        for (let pass = 0; pass < 2; pass++) {
          const again = await runFile(cmd, texArgs);
          texPasses++;
          log += '\n' + clean(again.stdout + (again.stderr ? '\n' + again.stderr : ''));
          if (again.err) { result = again; break; }
        }
        if (!result.err && fs.existsSync(path.join(dir, 'main.bbl'))) {
          LATEX_BIB_CACHE.set(bibKey, fs.readFileSync(path.join(dir, 'main.bbl')));
          if (LATEX_BIB_CACHE.size > 20) LATEX_BIB_CACHE.delete(LATEX_BIB_CACHE.keys().next().value);
        }
      }
    } else if (!result.err && fs.existsSync(path.join(dir, 'main.aux')) && /\\bibdata\{/.test(fs.readFileSync(path.join(dir, 'main.aux'), 'utf8')) && executablePath('bibtex')) {
      const bib = await runFile('bibtex', ['main'], 30000);
      log += '\n' + clean(bib.stdout + (bib.stderr ? '\n' + bib.stderr : ''));
      if (bib.err) result = bib;
      else {
        pipeline += ' + bibtex';
        for (let pass = 0; pass < 2; pass++) { const again = await runFile(cmd, texArgs); texPasses++; log += '\n' + clean(again.stdout + (again.stderr ? '\n' + again.stderr : '')); if (again.err) { result = again; break; } }
      }
    }
    // 交叉引用、目录以及 TikZ remember picture 的页面坐标至少需要两遍编译。
    // 本地编辑器通常会自动重跑；实时预览也保持相同行为，避免首遍页眉/页脚错位。
    if (!result.err && texPasses < 2) {
      const again = await runFile(cmd, texArgs);
      texPasses++;
      log += '\n' + clean(again.stdout + (again.stderr ? '\n' + again.stderr : ''));
      result = again;
    }
    if (texPasses > 1) pipeline += ' × ' + texPasses + ' 遍';
    if (result.err || !fs.existsSync(pdf)) {
      const timedOut = result.err && (result.err.killed || result.err.code === 'ETIMEDOUT');
      return {
        ok: false,
        timedOut: !!timedOut,
        engine: cmd,
        elapsedMs: Date.now() - started,
        error: timedOut ? 'LaTeX 编译超过 30 秒，已停止' : 'LaTeX 编译失败',
        log: log.slice(-12000),
      };
    }
    const pageMatch = log.match(/Output written on .*?\((\d+) pages?/i);
    return {
      ok: true,
      engine: pipeline,
      elapsedMs: Date.now() - started,
      pages: pageMatch ? Number(pageMatch[1]) : null,
      pdf: fs.readFileSync(pdf).toString('base64'),
      log: log.slice(-4000),
    };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

// 把多个片段（含文件名）写入同一个临时目录，支持跨文件引用 / 一起编译
function writeFragments(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mscr-'));
  for (const f of files || []) {
    if (!f.filename) continue;
    // 兜底：文件名只取 basename，任何情况下都不得写出临时目录之外
    const safeName = path.basename(String(f.filename));
    if (!safeName || safeName === '.' || safeName === '..') continue;
    fs.writeFileSync(path.join(dir, safeName), f.code || '');
  }
  scheduleTempCleanup(dir);
  return dir;
}

/* 语言 -> 运行器 */
const LANGUAGE_MAP = {
  javascript: { ext: '.js', label: 'JavaScript' },
  typescript: { ext: '.ts', label: 'TypeScript' },
  python:     { ext: '.py', label: 'Python' },
  bash:       { ext: '.sh', label: 'Bash' },
  shell:      { ext: '.sh', label: 'Bash' },
  c_cpp:      { ext: '.cpp', label: 'C/C++' },
  c:          { ext: '.c', label: 'C' },
  java:       { ext: '.java', label: 'Java' },
  ruby:       { ext: '.rb', label: 'Ruby' },
  swift:      { ext: '.swift', label: 'Swift' },
  go:         { ext: '.go', label: 'Go' },
  json:       { ext: '.json', label: 'JSON' },
  html:       { ext: '.html', label: 'HTML' },
  markdown:   { ext: '.md', label: 'Markdown' },
  latex:      { ext: '.tex', label: 'LaTeX' },
};

// 环境守卫：缺工具时返回明确提示，而不是晦涩的 spawn 报错
async function guard(key, fn) {
  const { tools: env } = await getEnv();
  if (!env[key] || !env[key].available) return { ok: false, unsupported: true, reason: missingReason(key, env[key]) };
  return fn();
}

function runnerFor(language) {
  const key = (language || '').toLowerCase();
  switch (key) {
    case 'javascript':
      return {
        supported: true,
        check: (code) => guard('node', () => run('node', ['--check', writeTemp('check.js', code).file])),
        run: (code, opts) => guard('node', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.mjs', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('node', [entry], { cwd: dir, timeoutMs: 10000, input: opts.input });
        }),
      };
    case 'typescript':
      return {
        supported: true,
        check: (code) => guard('node', () => run('node', ['--check', writeTemp('check.ts', code).file])),
        run: (code, opts) => guard('node', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.ts', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('node', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'python':
      return {
        supported: true,
        check: (code) => guard('python3', () => run(pythonCmd(), ['-m', 'py_compile', writeTemp('check.py', code).file])),
        run: (code, opts) => guard('python3', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.py', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run(pythonCmd(), [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'bash':
    case 'shell':
      return {
        supported: true,
        check: (code) => guard('bash', () => run('bash', ['-n', writeTemp('check.sh', code).file])),
        run: (code, opts) => guard('bash', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.sh', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('bash', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'c_cpp':
      return {
        supported: true,
        // 按文件扩展名决定 C/C++：.c → gcc(C17)，其余 → g++(C++17)，避免 clang++ 的 "treating 'c' input as 'c++'" 告警
        check: (code, opts) => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'check.cpp', code }];
          const dir = writeFragments(files);
          const sel = files[(opts.selIndex || 0)] || files[0];
          const entry = path.join(dir, sel.filename);
          const isC = /\.c$/i.test(sel.filename);
          return guard(isC ? 'gcc' : 'gpp', () => run(isC ? 'gcc' : 'g++', [isC ? '-std=c17' : '-std=c++17', '-I', dir, '-fsyntax-only', entry], { timeoutMs: 30000 }));
        },
        run: (code, opts) => guard('gpp', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.cpp', code }];
          const dir = writeFragments(files);
          const srcs = files.filter((f) => /\.(c|cc|cpp|cxx)$/i.test(f.filename)).map((f) => f.filename);
          if (!srcs.length) return { ok: false, code: 1, stdout: '', stderr: '没有可编译的 C/C++ 源文件' };
          const bin = path.join(dir, 'a.out');
          // 逐个 .c 用 gcc(C)、.cpp 用 g++(C++) 编译成 .o，再统一链接
          const steps = srcs.map((fn) => {
            const isC = /\.c$/i.test(fn);
            const tool = isC ? 'gcc' : 'g++';
            const std = isC ? '-std=c17' : '-std=c++17';
            return guard(isC ? 'gcc' : 'gpp', () => run(tool, [std, '-I', dir, '-c', path.join(dir, fn), '-o', path.join(dir, fn + '.o')], { timeoutMs: 40000 }));
          });
          return Promise.all(steps).then((results) => {
            const bad = results.find((r) => !r.ok);
            if (bad) return bad;
            const objs = srcs.map((fn) => path.join(dir, fn + '.o'));
            return run('g++', ['-I', dir, ...objs, '-o', bin], { timeoutMs: 40000 })
              .then((r) => r.ok ? run(bin, [], { cwd: dir, timeoutMs: 15000, input: opts.input }) : normalizeMissingEntry(r));
          });
        }),
      };
    case 'c':
      return {
        supported: true,
        check: (code, opts) => guard('gcc', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'check.c', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('gcc', ['-std=c17', '-I', dir, '-fsyntax-only', entry], { timeoutMs: 30000 });
        }),
        run: (code, opts) => guard('gcc', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.c', code }];
          const dir = writeFragments(files);
          const srcs = files.filter((f) => /\.c$/i.test(f.filename)).map((f) => path.join(dir, f.filename));
          const bin = path.join(dir, 'a.out');
          const gargs = ['-std=c17', '-I', dir, ...srcs, '-o', bin];
          return run('gcc', gargs, { timeoutMs: 40000 })
            .then((r) => r.ok ? run(bin, [], { cwd: dir, timeoutMs: 15000, input: opts.input }) : normalizeMissingEntry(r));
        }),
      };
    case 'java': {
      const javaFile = (code, name) => {
        const m = /(?:public\s+)?(?:final\s+)?class\s+(\w+)/.exec(code);
        return writeTemp((m ? m[1] : name) + '.java', code);
      };
      return {
        supported: true,
        check: (code) => guard('java', () => {
          const { dir, file } = javaFile(code, 'Check');
          return run('javac', ['-d', dir, file], { timeoutMs: 30000 });
        }),
        run: (code, opts) => guard('java', () => {
          const { dir, file } = javaFile(code, 'Main');
          // 注意：第二参数是 { input, selIndex, files }，之前误把整个对象当 input 写入 stdin
          return run('java', [file], { cwd: dir, timeoutMs: 20000, input: opts && opts.input }); // Java 11+ 单文件源码运行
        }),
      };
    }
    case 'ruby':
      return {
        supported: true,
        check: (code) => guard('ruby', () => run('ruby', ['-c', writeTemp('check.rb', code).file])),
        run: (code, opts) => guard('ruby', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.rb', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('ruby', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'swift':
      return {
        supported: true,
        check: (code) => guard('swift', () => run('swiftc', ['-typecheck', writeTemp('check.swift', code).file], { timeoutMs: 40000 })),
        run: (code, opts) => guard('swift', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.swift', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('swift', [entry], { cwd: dir, timeoutMs: 30000, input: opts.input });
        }),
      };
    case 'go':
      return {
        supported: true,
        check: (code) => guard('go', () => {
          const { dir, file } = writeTemp('main.go', code);
          return run('go', ['vet', file], { timeoutMs: 30000 }).then((r) => ({ ...r, ok: r.code === 0 }));
        }),
        run: (code, opts) => guard('go', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.go', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('go', ['run', entry], { cwd: dir, timeoutMs: 30000, input: opts.input });
        }),
      };
    case 'json': {
      return {
        supported: true,
        check: (code) => {
          try { JSON.parse(code); return Promise.resolve({ ok: true, stdout: 'JSON 有效', stderr: '', code: 0 }); }
          catch (e) { return Promise.resolve({ ok: false, stdout: '', stderr: 'JSON 解析错误: ' + e.message, code: 1 }); }
        },
        run: (code) => Promise.resolve({ ok: true, stdout: 'JSON 无需运行（可用右侧“格式化/校验”查看结构）', stderr: '', code: 0 }),
      };
    }
    case 'html': {
      return {
        supported: true,
        check: (code) => Promise.resolve({ ok: true, stdout: 'HTML 使用“预览”在浏览器中渲染', stderr: '', code: 0 }),
        run: (code) => Promise.resolve({ ok: true, stdout: 'HTML 已生成预览，请点击下方“预览”按钮。', stderr: '', code: 0 }),
      };
    }
    default:
      return { supported: false, reason: '暂不支持运行 "' + (language || '未知') + '"（可运行: JavaScript / TypeScript / Python / Bash / C / C++ / Java / Ruby / Swift / Go / JSON / HTML）' };
  }
}

/* --------------------------------- 格式化 ---------------------------------- */

/* 各语言对应的格式化工具：
   - Prettier：通过 npx 按需下载（JS/TS/JSON/HTML/CSS/YAML/Markdown/Bash）
   - clang-format：C/C++（本机自带，无需下载）
   - gofmt：Go（本机自带） */
const FORMATTERS = {
  javascript:  { name: 'Prettier', key: 'npx', prettier: 'babel' },
  typescript:  { name: 'Prettier', key: 'npx', prettier: 'typescript' },
  json:        { name: 'Prettier', key: 'npx', prettier: 'json' },
  json5:       { name: 'Prettier', key: 'npx', prettier: 'json5' },
  html:        { name: 'Prettier', key: 'npx', prettier: 'html' },
  css:         { name: 'Prettier', key: 'npx', prettier: 'css' },
  scss:        { name: 'Prettier', key: 'npx', prettier: 'scss' },
  less:        { name: 'Prettier', key: 'npx', prettier: 'less' },
  yaml:        { name: 'Prettier', key: 'npx', prettier: 'yaml' },
  markdown:    { name: 'Prettier', key: 'npx', prettier: 'markdown' },
  bash:        { name: 'Prettier', key: 'npx', prettier: 'bash' },
  shell:       { name: 'Prettier', key: 'npx', prettier: 'bash' },
  c_cpp:       { name: 'clang-format', key: 'clangformat', format: formatWithClangFormat },
  c:           { name: 'clang-format', key: 'clangformat', format: formatWithClangFormat },
  go:          { name: 'gofmt', key: 'gofmt', format: formatWithGofmt },
  python:      { name: 'black', key: 'black', format: formatWithBlack },
};

function formatWithClangFormat(code) {
  // 空样式 + 缩进 2，避免依赖用户机器上可能不存在的 .clang-format
  const { dir, file } = writeTemp('format.cpp', code);
  return new Promise((resolve) => {
    const args = ['-style={BasedOnStyle: LLVM, IndentWidth: 2, TabWidth: 2, UseTab: Never, ColumnLimit: 100}', file];
    execFile('clang-format', args, { timeout: 20000 }, (err, stdout, stderr) => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      if (err) resolve({ ok: false, reason: 'clang-format 失败: ' + (stderr || err.message).slice(0, 500) });
      else resolve({ ok: true, formatted: stdout });
    });
  });
}

function formatWithGofmt(code) {
  const { dir, file } = writeTemp('format.go', code);
  return new Promise((resolve) => {
    execFile('gofmt', [file], { timeout: 20000 }, (err, stdout, stderr) => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      if (err) resolve({ ok: false, reason: 'gofmt 失败: ' + (stderr || err.message).slice(0, 500) });
      else resolve({ ok: true, formatted: stdout });
    });
  });
}

function formatWithBlack(code) {
  // black 就地改写文件；--line-length 100 减少意外换行
  const { dir, file } = writeTemp('format.py', code);
  return new Promise((resolve) => {
    execFile(pythonCmd(), ['-m', 'black', '--quiet', '--line-length', '100', file], { timeout: 30000 }, (err, stdout, stderr) => {
      let formatted;
      if (!err) { try { formatted = fs.readFileSync(file, 'utf8'); } catch (_) { formatted = null; } }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      if (err || formatted == null) resolve({ ok: false, reason: 'black 失败: ' + (stderr || err.message).slice(0, 500) });
      else resolve({ ok: true, formatted });
    });
  });
}

function prettierArgs(parser, tmpFile) {
  // 与 massCode 编辑器偏好保持一致
  let tabWidth = 2, semi = false, singleQuote = false, trailing = 'all';
  try {
    const pref = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/massCode/v2/preferences.json'), 'utf8'));
    const e = pref.editor && pref.editor.code;
    if (e) { tabWidth = e.tabSize ?? 2; semi = e.semi ?? false; singleQuote = e.singleQuote ?? false; trailing = e.trailingComma ?? 'all'; }
  } catch (_) {}
  return ['--write', '--parser', parser, '--tab-width', String(tabWidth),
    semi ? '--semi' : '--no-semi', singleQuote ? '--single-quote' : '--no-single-quote',
    '--trailing-comma', trailing, tmpFile];
}

function formatWithPrettier(parser, code) {
  const ext = { babel: '.js', typescript: '.ts', json: '.json', json5: '.json5', html: '.html', css: '.css', scss: '.scss', less: '.less', yaml: '.yaml', markdown: '.md', bash: '.sh' }[parser] || '.txt';
  const { dir, file } = writeTemp('format' + ext, code);
  return new Promise((resolve) => {
    execFile('npx', ['-y', 'prettier@3', ...prettierArgs(parser, file)], { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, reason: 'Prettier 执行失败（需要网络首次下载）: ' + (stderr || err.message).slice(0, 500) });
        return;
      }
      try { resolve({ ok: true, formatted: fs.readFileSync(file, 'utf8') }); }
      catch (e) { resolve({ ok: false, reason: String(e.message) }); }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    });
  });
}

/* 把格式化结果写回 vault 文件中对应片段 */
function writeBackFragment(file, fragment, newCode) {
  const text = fs.readFileSync(file, 'utf8');
  const { body } = parseFrontmatter(text);
  const bodyOffset = text.length - body.length; // body 在 text 中的绝对起点
  // 定位该片段对应的 fence
  const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
  const heads = [];
  let m;
  while ((m = headingRe.exec(body))) heads.push({ label: m[1].trim(), start: m.index });
  const target = heads[fragment.index];
  if (!target) return false;
  const segStart = target.start + body.slice(target.start).indexOf('\n') + 1;
  const segEnd = heads[fragment.index + 1] ? heads[fragment.index + 1].start : body.length;
  const seg = body.slice(segStart, segEnd);
  // 定位片段自己的围栏：段内【第一个】```（开）到【最后一个】```（关）。
  // 不能用非贪婪匹配：markdown 片段内容自带围栏代码块时会在内层 ``` 处截断，把片段后半截全删掉
  const segLines = seg.split('\n');
  let firstIdx = -1, lastIdx = -1;
  for (let i = 0; i < segLines.length; i++) {
    if (/^```/.test(segLines[i])) { if (firstIdx < 0) firstIdx = i; lastIdx = i; }
  }
  if (firstIdx < 0 || lastIdx <= firstIdx) return false;
  let pos = 0;
  const lineOffsets = [];
  for (const ln of segLines) { lineOffsets.push(pos); pos += ln.length + 1; } // +1 换行
  const openLine = segLines[firstIdx];
  const absStart = bodyOffset + segStart + lineOffsets[firstIdx];
  const absEnd = bodyOffset + segStart + lineOffsets[lastIdx] + segLines[lastIdx].length;
  const replacement = openLine + '\n' + newCode + '\n' + segLines[lastIdx];
  fs.writeFileSync(file, text.slice(0, absStart) + replacement + text.slice(absEnd), 'utf8');
  return true;
}

/* 重排片段顺序：同时重排 frontmatter 的 contents 列表与 body 的 ## Fragment 段。
   order = 新顺序（原索引的排列，如 [2,0,1] 表示原第 2/0/1 段依次放到最前）。
   按原始文本切片重排，不改任何片段内容与格式。 */
function reorderFragments(file, order) {
  const text = fs.readFileSync(file, 'utf8');
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = fmRe.exec(text);
  if (!m) return { ok: false, error: '文件缺少 frontmatter' };
  const yamlRaw = m[1];
  const body = text.slice(m[0].length);
  const nl = yamlRaw.includes('\r\n') ? '\r\n' : '\n';
  const yamlLines = yamlRaw.split(/\r?\n/);

  // 1) 定位 contents 列表项的原始行块（2空格 "- " 项 + 4空格字段）
  const ci = yamlLines.findIndex((l) => /^contents:\s*$/.test(l));
  if (ci < 0) return { ok: false, error: 'frontmatter 缺少 contents' };
  const items = [];
  let cur = null;
  for (let i = ci + 1; i < yamlLines.length; i++) {
    const l = yamlLines[i];
    if (/^ {2}- /.test(l)) {
      if (cur) cur.end = i - 1;
      cur = { start: i, end: i };
      items.push(cur);
    } else if (/^ {4}/.test(l) && cur) {
      cur.end = i;
    } else if (cur && /^\s*$/.test(l)) {
      continue;
    } else if (cur && !/^\s/.test(l)) {
      break;
    } else if (cur) {
      cur.end = i;
    }
  }
  if (items.length === 0) return { ok: false, error: 'contents 为空，无法重排' };

  // 2) 定位 body 的 Fragment 段
  const heads = [];
  const hre = /^##\s*Fragment:\s*(.*)$/gm;
  let mm;
  while ((mm = hre.exec(body))) heads.push({ label: mm[1].trim(), start: mm.index });
  if (heads.length !== items.length) return { ok: false, error: 'contents 与 ## Fragment 段数量不一致，已取消重排' };

  // 3) 校验 order 是 0..n-1 的排列
  const n = items.length;
  if (!Array.isArray(order) || order.length !== n) return { ok: false, error: 'order 长度不符' };
  const seen = new Set();
  for (const o of order) {
    if (!Number.isInteger(o) || o < 0 || o >= n || seen.has(o)) return { ok: false, error: 'order 非法' };
    seen.add(o);
  }
  if (n === 1) return { ok: true };

  // 4) 重排 body 段（原始切片，完整保留）
  const segs = heads.map((h, i) => {
    const segStart = h.start + body.slice(h.start).indexOf('\n') + 1;
    const segEnd = i + 1 < heads.length ? heads[i + 1].start : body.length;
    return body.slice(segStart, segEnd);
  });
  const bodyHead = body.slice(0, heads[0].start);
  const newBody = bodyHead + order.map((oi) => '## Fragment: ' + heads[oi].label + '\n' + segs[oi]).join('');

  // 5) 重排 contents 原始行块
  const itemBlocks = items.map((it) => yamlLines.slice(it.start, it.end + 1));
  const before = yamlLines.slice(0, items[0].start);
  const after = yamlLines.slice(items[items.length - 1].end + 1);
  const newYaml = [].concat(before, order.map((oi) => itemBlocks[oi]).flat(), after).join(nl);

  // 6) 组装写回
  const out = '---' + nl + newYaml + nl + '---' + nl + newBody;
  fs.writeFileSync(file, out, 'utf8');
  return { ok: true };
}

/* --------------------------------- Git 面板 ---------------------------------- */

/* ------------------------------- 底部终端（PTY）------------------------------- */

let TERM = null;   // 当前终端会话 { child, clients:Set<Response>, buffer:Buffer, mode, label }
function stopTerm() {
  const session = TERM;
  TERM = null;
  if (!session) return;
  for (const client of (session.clients || [])) { try { client.end(); } catch (_) {} }
  if (session.clients) session.clients.clear();
  if (session.child) { try { session.child.kill(); } catch (_) {} }
}
function writeTermChunk(session, data) {
  if (TERM !== session) return;
  const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
  session.buffer = Buffer.concat([session.buffer, chunk]);
  if (session.buffer.length > 256 * 1024) session.buffer = session.buffer.subarray(session.buffer.length - 256 * 1024);
  for (const client of session.clients) {
    try { client.write(chunk); } catch (_) { session.clients.delete(client); }
  }
}
function termSpawn(spec = {}) {
  try {
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const py = process.platform === 'win32' ? '' : executablePath(pythonCmd());
    // Unix 优先用 ptybridge 获得真实交互终端（sudo 可输入密码）；缺 Python 时回退普通交互 shell。
    // Windows 使用 PowerShell 管道模式，至少保证环境部署命令和常规命令可执行。
    const bridge = path.join(__dirname, 'ptybridge.py');
    const targetCommand = spec.command || shell;
    const targetArgs = Array.isArray(spec.args) ? spec.args : (process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-i']);
    const command = py ? py : targetCommand;
    const args = py ? ['-u', bridge, '--', targetCommand, ...targetArgs] : targetArgs;
    const child = spawn(command, args, { cwd: __dirname, env: { ...process.env, SHELL: shell }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    const session = {
      child, clients: new Set(), buffer: Buffer.alloc(0),
      mode: spec.mode || 'local', label: spec.label || '本地 shell',
      host: spec.host || '', port: spec.port || 0,
    };
    TERM = session;
    child.stdout.on('data', (d) => writeTermChunk(session, d));
    child.stderr.on('data', (d) => writeTermChunk(session, d));
    child.on('error', () => { if (TERM === session) TERM = null; });
    child.on('exit', () => {
      if (TERM !== session) return;
      TERM = null;
      for (const client of session.clients) { try { client.end(); } catch (_) {} }
      session.clients.clear();
    });
    return true;
  } catch (e) {
    TERM = null;
    return false;
  }
}

function remoteHost(value) {
  const host = String(value || '').trim();
  if (!host || host.length > 253 || host.startsWith('-') || !/^[A-Za-z0-9._:\[\]-]+$/.test(host)) return '';
  return host;
}
function remotePort(value, fallback) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}
function measureNetworkLatency(host, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const target = host.replace(/^\[|\]$/g, '');
    const ipv6 = target.includes(':');
    let command = executablePath('ping');
    let args;
    if (process.platform === 'win32') {
      args = [...(ipv6 ? ['-6'] : []), '-n', '1', '-w', '2000', target];
    } else {
      if (ipv6) command = executablePath('ping6') || command;
      args = process.platform === 'darwin'
        ? ['-n', '-c', '1', '-W', '2000', target]
        : ['-n', '-c', '1', '-W', '2', target];
    }
    if (!command) { resolve({ ok: false, error: '系统未安装 ping' }); return; }
    execFile(command, args, { encoding: 'utf8', timeout: timeoutMs }, (error, stdout, stderr) => {
      const output = String(stdout || '') + '\n' + String(stderr || '');
      const match = /time\s*[=<]\s*([0-9.]+)\s*ms/i.exec(output);
      if (!error && match) {
        resolve({ ok: true, latencyMs: Math.max(1, Math.round(Number(match[1]))) });
        return;
      }
      resolve({ ok: false, error: error && error.killed ? '检测超时' : '远端未响应 ping' });
    });
  });
}
function sshSessionSpec(body) {
  const ssh = executablePath('ssh');
  if (!ssh) return { error: '未检测到 OpenSSH 客户端，请先在“环境检测”中安装。' };
  const host = remoteHost(body && body.host);
  const port = remotePort(body && body.port, 22);
  const user = String((body && body.user) || '').trim();
  if (!host) return { error: 'SSH 主机地址不合法' };
  if (!port) return { error: 'SSH 端口必须在 1–65535 之间' };
  if (user && !/^[A-Za-z0-9._-]+$/.test(user)) return { error: 'SSH 用户名仅支持字母、数字、点、下划线和连字符' };
  const args = ['-tt', '-p', String(port), '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3'];
  const keyInput = String((body && body.identityFile) || '').trim();
  if (keyInput) {
    const keyFile = path.resolve(keyInput.startsWith('~/') ? path.join(os.homedir(), keyInput.slice(2)) : keyInput);
    try { if (!fs.statSync(keyFile).isFile()) throw new Error('not file'); }
    catch (_) { return { error: 'SSH 私钥文件不存在或不可读取' }; }
    args.push('-i', keyFile);
  }
  const target = (user ? user + '@' : '') + host;
  args.push(target);
  return { command: ssh, args, mode: 'ssh', label: 'SSH · ' + target + ':' + port, host, port, user };
}

function sshFileConfig(body) {
  const host = remoteHost(body && body.host);
  const port = remotePort(body && body.port, 22);
  const username = String((body && body.user) || '').trim();
  if (!host) throw new Error('SSH 主机地址不合法');
  if (!port) throw new Error('SSH 端口必须在 1–65535 之间');
  if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new Error('请填写有效的 SSH 用户名');
  const config = { host: host.replace(/^\[|\]$/g, ''), port, username, readyTimeout: 12000, keepaliveInterval: 8000, keepaliveCountMax: 2 };
  if (process.env.SSH_AUTH_SOCK) config.agent = process.env.SSH_AUTH_SOCK;
  const password = String((body && body.password) || '');
  if (password) {
    config.password = password.slice(0, 4096);
    // 部分 Linux SSH 服务关闭 password 方法，只通过 keyboard-interactive 询问密码。
    // 系统 ssh 会自动处理该流程；ssh2 需要显式开启并在连接事件中作答。
    config.tryKeyboard = true;
  }
  const keyInput = String((body && body.identityFile) || '').trim();
  if (keyInput) {
    const keyFile = path.resolve(keyInput.startsWith('~/') ? path.join(os.homedir(), keyInput.slice(2)) : keyInput);
    try { config.privateKey = fs.readFileSync(keyFile); }
    catch (_) { throw new Error('SSH 私钥文件不存在或不可读取'); }
  }
  if (!config.password && !config.privateKey) {
    const candidates = ['id_ed25519', 'id_rsa', 'id_ecdsa'].map((name) => path.join(os.homedir(), '.ssh', name));
    const found = candidates.find((file) => fs.existsSync(file));
    if (found) config.privateKey = fs.readFileSync(found);
  }
  return config;
}

function remoteFilePath(value, fallback = '.') {
  const raw = String(value == null ? fallback : value).trim() || fallback;
  if (raw.includes('\0') || raw.length > 4096) throw new Error('远程路径不合法');
  return path.posix.normalize(raw.replace(/\\/g, '/'));
}

function withSftp(body, work) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = new SshClient();
    const keyboardPassword = String((body && body.password) || '').slice(0, 4096);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch (_) {}
      error ? reject(error) : resolve(value);
    };
    client.once('ready', () => client.sftp((error, sftp) => {
      if (error) return finish(error);
      Promise.resolve().then(() => work(sftp)).then((value) => finish(null, value), finish);
    }));
    client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
      if (!keyboardPassword) return finish([]);
      finish((prompts || []).map(() => keyboardPassword));
    });
    client.once('error', (error) => finish(new Error('SSH 连接失败: ' + String(error.message || error))));
    try { client.connect(sshFileConfig(body)); } catch (error) { finish(error); }
  });
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => sftp[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}

async function remoteList(body) {
  const target = remoteFilePath(body && body.path);
  return withSftp(body, async (sftp) => {
    const rows = await sftpCall(sftp, 'readdir', target);
    const entries = rows.map((row) => {
      const attrs = row.attrs || {};
      const name = String(row.filename || '');
      const fullPath = path.posix.join(target === '.' ? '' : target, name) || '.';
      return { name, path: fullPath, directory: !!(attrs.isDirectory && attrs.isDirectory()), symlink: !!(attrs.isSymbolicLink && attrs.isSymbolicLink()), size: Number(attrs.size || 0), mtime: Number(attrs.mtime || 0) };
    }).filter((row) => row.name !== '.' && row.name !== '..')
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN'));
    return { ok: true, path: target, parent: target === '/' ? '/' : (path.posix.dirname(target) || '.'), entries };
  });
}

async function remoteRead(body) {
  const target = remoteFilePath(body && body.path, '');
  if (!target || target === '.') throw new Error('请选择远程文件');
  return withSftp(body, async (sftp) => {
    const attrs = await sftpCall(sftp, 'stat', target);
    if (attrs.isDirectory && attrs.isDirectory()) throw new Error('目标是文件夹');
    if (Number(attrs.size || 0) > 2 * 1024 * 1024) throw new Error('远程文件超过 2 MB，暂不在编辑器中打开');
    const data = await sftpCall(sftp, 'readFile', target);
    if (data.includes(0)) throw new Error('二进制文件不支持文本编辑');
    return { ok: true, path: target, content: data.toString('utf8'), size: data.length, mtime: Number(attrs.mtime || 0) };
  });
}

async function remoteWrite(body) {
  const target = remoteFilePath(body && body.path, '');
  const content = String((body && body.content) == null ? '' : body.content);
  if (!target || target === '.') throw new Error('请选择远程文件');
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('远程文件超过 2 MB，无法保存');
  return withSftp(body, async (sftp) => {
    await sftpCall(sftp, 'writeFile', target, Buffer.from(content, 'utf8'));
    return { ok: true, path: target, bytes: Buffer.byteLength(content), savedAt: Date.now() };
  });
}

function remoteTransferMeta(req) {
  const encoded = String(req.headers['x-codescope-remote'] || '');
  if (!encoded || encoded.length > 32768) throw new Error('缺少远程传输参数');
  try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
  catch (_) { throw new Error('远程传输参数不正确'); }
}

function safeRemoteRelative(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const normalized = path.posix.normalize(raw);
  if (!raw || raw.includes('\0') || raw.length > 4096 || raw.startsWith('/') || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('上传相对路径不合法');
  }
  return normalized;
}

function connectSshClient(body) {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;
    const password = String((body && body.password) || '').slice(0, 4096);
    client.once('ready', () => { if (!settled) { settled = true; resolve(client); } });
    client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
      finish(password ? (prompts || []).map(() => password) : []);
    });
    client.once('error', (error) => {
      if (!settled) { settled = true; reject(new Error('SSH 连接失败: ' + String(error.message || error))); }
    });
    try { client.connect(sshFileConfig(body)); }
    catch (error) { settled = true; reject(error); }
  });
}

function clientSftp(client) {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
}

async function sftpMkdirp(sftp, target) {
  const normalized = path.posix.normalize(target || '.');
  if (normalized === '.' || normalized === '/') return;
  const absolute = normalized.startsWith('/');
  let current = absolute ? '/' : '';
  for (const part of normalized.split('/').filter(Boolean)) {
    current = current === '/' ? '/' + part : (current ? current + '/' + part : part);
    try { await sftpCall(sftp, 'mkdir', current); }
    catch (_) {
      const attrs = await sftpCall(sftp, 'stat', current);
      if (!(attrs.isDirectory && attrs.isDirectory())) throw new Error('远端路径中存在同名文件: ' + current);
    }
  }
}

async function streamRemoteUpload(req, res) {
  let body;
  try { body = remoteTransferMeta(req); }
  catch (error) { req.resume(); send(res, 400, { ok:false, error:String(error.message || error) }); return; }
  let client;
  try {
    const dir = remoteFilePath(body.path);
    const relativePath = safeRemoteRelative(body.relativePath || body.name);
    const target = path.posix.join(dir === '.' ? '' : dir, relativePath) || relativePath;
    client = await connectSshClient(body);
    const sftp = await clientSftp(client);
    await sftpMkdirp(sftp, path.posix.dirname(target));
    let exists = false;
    try {
      const attrs = await sftpCall(sftp, 'stat', target);
      if (attrs.isDirectory && attrs.isDirectory()) throw new Error('远端已存在同名目录');
      exists = true;
    } catch (error) {
      if (/同名目录/.test(String(error.message || error))) throw error;
    }
    if (exists && !body.overwrite) {
      req.resume();
      send(res, 409, { ok:false, exists:true, path:target, error:'远端已存在同名文件' });
      return;
    }
    let bytes = 0;
    req.on('data', (chunk) => { bytes += chunk.length; });
    await pipeline(req, sftp.createWriteStream(target, { flags:'w' }));
    send(res, 200, { ok:true, path:target, name:path.posix.basename(target), bytes, overwritten:exists, savedAt:Date.now() });
  } catch (error) {
    req.resume();
    if (!res.headersSent) send(res, 200, { ok:false, error:String(error.message || error) });
    else res.destroy(error);
  } finally {
    if (client) { try { client.end(); } catch (_) {} }
  }
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}

function downloadHeaders(res, name, contentType, size) {
  const safeName = String(name || 'download').replace(/[\r\n]/g, '_');
  const headers = {
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    'X-CodeScope-Filename': encodeURIComponent(safeName),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (Number.isFinite(size) && size >= 0) headers['Content-Length'] = String(size);
  res.writeHead(200, headers);
}

async function streamRemoteDownload(res, body) {
  const target = remoteFilePath(body && body.path, '');
  if (!target) throw new Error('请选择远程文件或文件夹');
  let client;
  try {
    client = await connectSshClient(body);
    const sftp = await clientSftp(client);
    const attrs = await sftpCall(sftp, 'stat', target);
    if (!(attrs.isDirectory && attrs.isDirectory())) {
      const name = path.posix.basename(target) || 'download';
      downloadHeaders(res, name, 'application/octet-stream', Number(attrs.size || 0));
      await pipeline(sftp.createReadStream(target), res);
      return;
    }
    const normalized = target === '.' ? '.' : target.replace(/\/$/, '');
    const parent = normalized === '/' ? '/' : path.posix.dirname(normalized);
    const base = normalized === '/' || normalized === '.' ? '.' : path.posix.basename(normalized);
    const archiveName = (normalized === '/' ? 'root' : normalized === '.' ? 'remote-folder' : path.posix.basename(normalized)) + '.tar.gz';
    const command = `tar -czf - -C ${shellQuote(parent)} -- ${shellQuote(base)}`;
    const stream = await new Promise((resolve, reject) => client.exec(command, (error, channel) => error ? reject(error) : resolve(channel)));
    downloadHeaders(res, archiveName, 'application/gzip');
    await pipeline(stream, res);
  } finally {
    if (client) { try { client.end(); } catch (_) {} }
  }
}

/* --------------------------------- Git 面板 ---------------------------------- */

let GIT_ROOT = null;   // 缓存仓库根（vault 所在 git 仓库，通常在其上级目录）
function gitRoot() {
  if (GIT_ROOT) return GIT_ROOT;
  // 纯文件系统探测：向上查找 .git（目录或 worktree 指针文件），不执行任何 git 命令，
  // 避免同步命令在云盘大仓库上卡住拖死整个服务。
  let dir = vaultPath();
  for (let i = 0; i < 8; i++) {
    try { if (fs.existsSync(path.join(dir, '.git'))) return (GIT_ROOT = dir); } catch (_) {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function gitRun(args, timeout) {
  const root = gitRoot();
  if (!root) return Promise.resolve({ ok: false, error: '未找到 Git 仓库（vault 上级无 .git）' });
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, timeout: timeout || 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(stderr || err.message).trim().slice(0, 600) : '' });
    });
  });
}
// git 命令执行器：spawn 异步执行 + 硬超时。子进程即使卡死（例如云盘文件 IO 不可中断），
// 超时一到也立即 resolve 返回，绝不阻塞 Node 事件循环（同步 execFileSync 无法做到这一点）。
function runGit(args, opts = {}) {
  const { cwd, timeout = 15000 } = opts;
  return new Promise((resolve) => {
    let cp;
    try { cp = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ err: e, stdout: '', stderr: '' }); }
    let stdout = '', stderr = '', done = false;
    const finish = (err) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { cp.kill('SIGKILL'); } catch (_) {}
      resolve({ err, stdout, stderr });
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('git 命令超时（' + timeout + 'ms）'), { code: 'ETIMEDOUT', killed: true })), timeout);
    cp.stdout.on('data', (d) => { stdout += String(d); });
    cp.stderr.on('data', (d) => { stderr += String(d); });
    cp.on('error', (e) => finish(e));
    cp.on('close', (code, signal) => {
      if (done) return;
      finish(code === 0 ? null : Object.assign(new Error('git 退出码 ' + code + (signal ? '（信号 ' + signal + '）' : '')), { code }));
    });
  });
}
async function gitStatus() {
  const root = gitRoot();
  if (!root) return { ok: false, error: '未找到 Git 仓库（vault 上级无 .git）' };
  try {
    // -z + core.quotepath=false：路径按 UTF-8 原样输出、NUL 分隔，避免中文被转义
    const g = await runGit(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b', '-z'], { cwd: root, timeout: 15000 });
    if (g.err) throw g.err;
    const out = g.stdout;
    const recs = out.split('\0').filter(Boolean);
    const changes = [];
    let branch = '', ahead = 0, behind = 0, upstream = '', remote = '', hasRemote = false;
    for (const r of recs) {
      if (r.startsWith('## ')) {
        const m = /^##\s+([^\s]+)(?:\s+\[(.*)\])?/.exec(r);
        branch = m ? m[1].split('...')[0] : '';
        const br = (m && m[2]) || '';
        const am = /ahead (\d+)/.exec(br); if (am) ahead = +am[1];
        const bm = /behind (\d+)/.exec(br); if (bm) behind = +bm[1];
        continue;
      }
      if (r.length < 3) continue;
      const xy = r.slice(0, 2);
      const path = r.slice(3);
      let kind = 'modified';
      if (xy === '??') kind = 'untracked';
      else if (xy[0] === 'A') kind = 'added';
      else if (xy[1] === 'D' || xy[0] === 'D') kind = 'deleted';
      else if (xy[0] === 'R') kind = 'renamed';
      changes.push({ status: xy.trim() || '?', idx: xy[0], wt: xy[1], path, kind });
    }
    { const r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: 10000 }); if (!r.err) branch = r.stdout.trim() || branch; }
    { const r = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: root, timeout: 10000 }); if (!r.err) upstream = r.stdout.trim(); }
    { const r = await runGit(['remote'], { cwd: root, timeout: 10000 }); if (!r.err) { const remotes = r.stdout.trim().split(/\s+/).filter(Boolean); hasRemote = remotes.length > 0; remote = upstream.includes('/') ? upstream.split('/')[0] : (remotes[0] || ''); } }
    if (upstream) { const r = await runGit(['rev-list', '--left-right', '--count', 'HEAD...' + upstream], { cwd: root, timeout: 10000 }); if (!r.err) { const counts = r.stdout.trim().split(/\s+/); ahead = Number(counts[0]) || 0; behind = Number(counts[1]) || 0; } }
    let lastCommit = null;
    let commits = [];
    { const r = await runGit(['log', '-1', '--format=%h%x09%s'], { cwd: root, timeout: 10000 }); if (!r.err) { const lg = r.stdout.trim(); const sp = lg.indexOf('\t'); lastCommit = sp >= 0 ? { hash: lg.slice(0, sp), subject: lg.slice(sp + 1) } : { hash: lg }; } }
    {
      // 最近 10 条提交记录：短hash|主题|时间戳
      let unpushed = new Set();
      if (upstream) { const u = await runGit(['rev-list', '--left-only', 'HEAD...' + upstream], { cwd: root, timeout: 15000 }); if (!u.err) unpushed = new Set(u.stdout.trim().split('\n').filter(Boolean)); }
      const l = await runGit(['log', '--pretty=format:%H%x09%h%x09%s%x09%at', '-n', '10'], { cwd: root, timeout: 10000 });
      if (!l.err && l.stdout.trim()) { const lout = l.stdout.trim(); commits = lout.split('\n').map(line => { const p = line.split('\t'); return { hash:p[0]||'', short:p[1]||'', subject:p[2]||'', ts:+(p[3]||0), pushed:upstream?!unpushed.has(p[0]):null }; }); }
    }
    return { ok: true, root, branch, upstream, remote, hasRemote, ahead, behind, changes, lastCommit, commits };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function safeGitPath(input) {
  const root = gitRoot();
  if (!root) throw new Error('未找到 Git 仓库');
  const value = String(input || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!value || value.includes('\0') || path.isAbsolute(value)) throw new Error('文件路径不合法');
  const full = path.resolve(root, value);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('文件路径越界');
  return { root, full, relative: path.relative(root, full).split(path.sep).join('/') };
}

function fallbackTextDiff(before, after, beforeLabel, afterLabel) {
  const oldText = String(before || '');
  const newText = String(after || '');
  if (oldText === newText) return '';
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  return [
    '--- ' + (beforeLabel || '旧版本'),
    '+++ ' + (afterLabel || '当前版本'),
    '@@ -1,' + oldLines.length + ' +1,' + newLines.length + ' @@',
    ...oldLines.map((line) => '-' + line),
    ...newLines.map((line) => '+' + line),
  ].join('\n').slice(0, 2 * 1024 * 1024);
}

async function unifiedTextDiff(before, after, beforeLabel, afterLabel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-diff-'));
  const left = path.join(dir, 'before.txt'), right = path.join(dir, 'after.txt');
  try {
    fs.writeFileSync(left, String(before || ''), 'utf8');
    fs.writeFileSync(right, String(after || ''), 'utf8');
    const raw = await new Promise((resolve) => {
      let out = '';
      const cp = spawn('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--unified=3', '--', left, right], { stdio: ['ignore', 'pipe', 'pipe'] });
      const t = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (_) {} }, 15000);
      cp.stdout.on('data', (d) => { out += String(d); });
      cp.stderr.on('data', () => {});
      cp.on('error', (e) => { clearTimeout(t); resolve({ out, code: null, err: e }); });
      cp.on('close', (code) => { clearTimeout(t); resolve({ out, code, err: null }); });
    });
    // git diff 用退出码 1 表示“存在差异”，并非执行失败。
    const rendered = (raw.out || '')
      .split(left).join(beforeLabel || '旧版本')
      .split(right).join(afterLabel || '当前版本')
      .slice(0, 2 * 1024 * 1024);
    if ((raw.err && raw.code !== 1) || (!rendered && String(before || '') !== String(after || ''))) {
      return fallbackTextDiff(before, after, beforeLabel, afterLabel);
    }
    return rendered;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function gitFileDiff(input) {
  const item = safeGitPath(input);
  let tracked = false;
  {
    const code = await new Promise((resolve) => {
      const cp = spawn('git', ['ls-files', '--error-unmatch', '--', item.relative], { cwd: item.root, stdio: ['ignore', 'ignore', 'ignore'] });
      const t = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (_) {} }, 10000);
      cp.on('error', () => { clearTimeout(t); resolve(null); });
      cp.on('close', (c) => { clearTimeout(t); resolve(c); });
    });
    tracked = code === 0;
  }
  let diff = '', binary = false;
  if (tracked) {
    const r = await new Promise((resolve) => {
      let out = '';
      const cp = spawn('git', ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', item.relative], { cwd: item.root, stdio: ['ignore', 'pipe', 'pipe'] });
      const t = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (_) {} }, 20000);
      cp.stdout.on('data', (d) => { out += String(d); });
      cp.stderr.on('data', (d) => { out += String(d); });
      cp.on('error', (e) => { clearTimeout(t); resolve({ out, code: null, err: e }); });
      cp.on('close', (c) => { clearTimeout(t); resolve({ out, code: c, err: null }); });
    });
    if (r.err && r.code !== 1) throw new Error(String((r.err && r.err.message) || 'git diff 失败').slice(0, 600));
    diff = r.out || '';
    binary = /^(?:Binary files .* differ|GIT binary patch)$/m.test(diff);
  } else if (fs.existsSync(item.full) && fs.statSync(item.full).isFile()) {
    let data = Buffer.alloc(0);
    try { data = await fs.promises.readFile(item.full); } catch (_) { data = Buffer.alloc(0); }
    binary = data.includes(0);
    if (!binary && data.length <= 2 * 1024 * 1024) diff = await unifiedTextDiff('', data.toString('utf8'), '/dev/null', 'b/' + item.relative);
  }
  const lines = diff.split('\n');
  const additions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const deletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
  return { ok: true, path: item.relative, tracked, binary, additions, deletions, diff };
}

function shortHash(text) {
  let h = 2166136261;
  const value = String(text || '');
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function timelineRoot() {
  let base;
  if (process.env.CODESCOPE_DATA_HOME) base = path.resolve(process.env.CODESCOPE_DATA_HOME);
  else if (process.platform === 'darwin') base = path.join(os.homedir(), 'Library/Application Support');
  else if (process.platform === 'win32') base = process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming');
  else base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
  return path.join(base, 'CodeScope', 'timeline', shortHash(path.resolve(vaultPath())));
}

function timelineTarget(file, fragment) {
  const codeRoot = path.resolve(path.join(vaultPath(), 'code'));
  const full = path.resolve(String(file || ''));
  if (!full.startsWith(codeRoot + path.sep) || path.extname(full).toLowerCase() !== '.md') throw new Error('时间线文件不合法');
  const index = Number(fragment);
  if (!Number.isInteger(index) || index < 0 || index > 10000) throw new Error('片段索引不合法');
  const relative = path.relative(codeRoot, full).split(path.sep).join('/');
  const dir = path.join(timelineRoot(), shortHash(relative + '#' + index));
  return { full, relative, fragment: index, dir };
}

const TIMELINE_SESSION_GAP_MS = 2 * 60 * 1000;

function rawTimelineEntries(target) {
  let names = [];
  try { names = fs.readdirSync(target.dir).filter((name) => /^\d+-[a-z0-9]+\.json$/i.test(name)).sort().reverse(); } catch (_) { return []; }
  return names.slice(0, 120).flatMap((name) => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(target.dir, name), 'utf8'));
      return [{ id: name.slice(0, -5), timestamp: Number(value.timestamp || 0), size: Number(value.size || Buffer.byteLength(String(value.code || ''))), reason: String(value.reason || '自动保存'), preview: String(value.preview || '').slice(0, 120) }];
    } catch (_) { return []; }
  });
}

function timelineEntries(target) {
  const entries = rawTimelineEntries(target);
  // 连续自动保存属于同一次编辑会话：只展示会话开始前的那个可恢复版本。
  // 从旧到新合并，保留组内最旧快照，避免“只改一行却出现很多条时间线”。
  const compact = []; let previousEntry = null;
  for (const entry of entries.slice().reverse()) {
    const sameSession = previousEntry && previousEntry.reason === '自动保存' && entry.reason === '自动保存' && entry.timestamp - previousEntry.timestamp < TIMELINE_SESSION_GAP_MS;
    if (!sameSession) compact.push(entry);
    previousEntry = entry;
  }
  return compact.reverse().slice(0, 60);
}

function recordTimeline(file, fragment, code, reason, force) {
  try {
    const target = timelineTarget(file, fragment);
    const value = String(code == null ? '' : code);
    if (Buffer.byteLength(value, 'utf8') > 1024 * 1024) return;
    fs.mkdirSync(target.dir, { recursive: true });
    const entries = rawTimelineEntries(target);
    if (entries.length) {
      try {
        const latest = JSON.parse(fs.readFileSync(path.join(target.dir, entries[0].id + '.json'), 'utf8'));
        if (String(latest.code || '') === value) return;
      } catch (_) {}
    }
    const now = Date.now();
    // 两分钟内的连续自动保存视为同一次编辑会话；第一条已经保存了会话开始前的内容。
    // 后续保存不再产生中间快照，恢复时可以直接回到真正开始修改之前。
    if (!force && entries.length && entries[0].reason === '自动保存' && now - entries[0].timestamp < TIMELINE_SESSION_GAP_MS) return;
    const bucket = now;
    const id = bucket + '-' + shortHash(target.relative + '#' + target.fragment);
    const firstLine = value.split(/\r?\n/).find((line) => line.trim()) || '空内容';
    fs.writeFileSync(path.join(target.dir, id + '.json'), JSON.stringify({
      timestamp: now, file: target.relative, fragment: target.fragment, reason: reason || '自动保存',
      size: Buffer.byteLength(value, 'utf8'), preview: firstLine.trim().slice(0, 120), code: value,
    }), 'utf8');
    const stale = fs.readdirSync(target.dir).filter((name) => /^\d+-[a-z0-9]+\.json$/i.test(name)).sort().reverse().slice(60);
    for (const name of stale) { try { fs.unlinkSync(path.join(target.dir, name)); } catch (_) {} }
  } catch (_) { /* 时间线失败不能阻断正常保存 */ }
}

async function timelineItem(file, fragment, id, currentCode) {
  const target = timelineTarget(file, fragment);
  if (!/^\d+-[a-z0-9]+$/i.test(String(id || ''))) throw new Error('时间线版本标识不合法');
  const value = JSON.parse(fs.readFileSync(path.join(target.dir, id + '.json'), 'utf8'));
  const code = String(value.code || '');
  return {
    ok: true, id, timestamp: Number(value.timestamp || 0), reason: String(value.reason || '自动保存'),
    size: Buffer.byteLength(code, 'utf8'), code,
    diff: await unifiedTextDiff(code, String(currentCode || ''), '历史版本', '当前版本'),
  };
}

/* -------------------------- 通用工程：任务 / 编译数据库 / 健康 -------------------------- */

function projectRoot() { return gitRoot() || path.resolve(vaultPath(), '..'); }
const LSP = createLspService();
process.once('exit', () => LSP.close());
function safeProjectDir(value) {
  const root = projectRoot();
  const full = path.resolve(root, String(value || '.'));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('工作目录超出当前工程');
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw new Error('工作目录不存在');
  return full;
}
function walkProject(limit = 6000) {
  const root = projectRoot(), out = [], ignored = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', 'out', 'coverage', '__pycache__', '.idea', '.vscode']);
  const visit = (dir, depth) => {
    if (out.length >= limit || depth > 12) return;
    let rows = []; try { rows = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const row of rows) {
      if (out.length >= limit || ignored.has(row.name)) continue;
      const full = path.join(dir, row.name);
      if (row.isDirectory()) visit(full, depth + 1);
      else if (row.isFile()) out.push({ full, relative: path.relative(root, full).split(path.sep).join('/'), ext: path.extname(row.name).toLowerCase(), name: row.name });
    }
  };
  visit(root, 0);
  return out;
}
function taskCatalog(projectFiles) {
  const root = projectRoot(), tasks = [];
  const add = (id, name, command, cwd = '.') => tasks.push({ id:id + '@' + cwd, name, command, cwd, detected:true });
  const markers = (projectFiles || walkProject(4000)).filter((f) => ['CMakeLists.txt','Makefile','makefile','build.ninja','package.json','pyproject.toml','requirements.txt'].includes(f.name)).slice(0,100);
  for (const file of markers) {
    const cwd = path.posix.dirname(file.relative) === '.' ? '.' : path.posix.dirname(file.relative), suffix = cwd === '.' ? '' : ` · ${cwd}`;
    if (file.name === 'CMakeLists.txt') { add('cmake-configure','CMake 配置'+suffix,'cmake -S . -B build',cwd); add('cmake-build','CMake 构建'+suffix,'cmake --build build',cwd); }
    else if (file.name === 'Makefile' || file.name === 'makefile') add('make','Make 构建'+suffix,'make',cwd);
    else if (file.name === 'build.ninja') add('ninja','Ninja 构建'+suffix,'ninja',cwd);
    else if (file.name === 'package.json') {
      try { const pkg=JSON.parse(fs.readFileSync(file.full,'utf8')); for(const name of Object.keys(pkg.scripts||{})) add('npm:'+name,'npm · '+name+suffix,'npm run '+name,cwd); } catch (_) {}
    } else if (file.name === 'pyproject.toml') add('python-build','Python 构建'+suffix,'python -m build',cwd);
    else if (file.name === 'requirements.txt') add('python-install','Python 安装依赖'+suffix,'python -m pip install -r requirements.txt',cwd);
  }
  return { ok: true, root, tasks };
}
function testCatalog() {
  const catalog = taskCatalog(), tests = catalog.tasks.filter((task) => /(?:^|\b)(test|pytest|ctest|jest|vitest|mocha)(?:\b|:)/i.test(task.name + ' ' + task.command));
  const root = projectRoot(), files = walkProject(4000), seen = new Set(tests.map((item) => item.command + '@' + item.cwd));
  const add = (id, name, command, cwd='.') => { const key=command+'@'+cwd;if(!seen.has(key)){seen.add(key);tests.push({id,name,command,cwd,detected:true});} };
  if (files.some((file) => /^(?:pytest\.ini|tox\.ini)$/.test(file.name) || file.name === 'conftest.py')) add('pytest','Python · pytest','python -m pytest');
  if (files.some((file) => file.name === 'CTestTestfile.cmake' || file.name === 'CTestConfig.cmake')) add('ctest','CMake · CTest','ctest --test-dir build --output-on-failure');
  if (files.some((file) => file.name === 'go.mod')) add('go-test','Go · 全部测试','go test ./...');
  if (files.some((file) => file.name === 'Cargo.toml')) add('cargo-test','Rust · cargo test','cargo test');
  return {ok:true,root,tests};
}
function debugCatalog() {
  const commands=[['node','Node.js','node inspect'],['python','Python','python -m pdb'],['lldb','LLDB','lldb'],['gdb','GDB','gdb']].map(([id,name,command])=>({id,name,command,available:!!executablePath(command.split(' ')[0])}));
  return {ok:true,root:projectRoot(),adapters:commands};
}
function runProjectCommand(command, cwd) {
  const value = String(command || '').trim();
  if (!value || value.length > 4000 || /[\0\r\n]/.test(value)) return Promise.resolve({ ok: false, error: '命令不合法' });
  let dir; try { dir = safeProjectDir(cwd); } catch (error) { return Promise.resolve({ ok:false, error:String(error.message || error) }); }
  const shell = process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
  const started = Date.now();
  return new Promise((resolve) => exec(value, { cwd: dir, shell, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({
    ok: !error, command: value, cwd: path.relative(projectRoot(), dir) || '.', durationMs: Date.now() - started,
    exitCode: error && Number.isInteger(error.code) ? error.code : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: error ? String(error.killed ? '任务超时（120 秒）' : error.message || error).slice(0, 500) : '',
  })));
}
function findCompileDatabase(projectFiles) {
  const root = projectRoot();
  const direct = [path.join(root, 'compile_commands.json'), path.join(root, 'build', 'compile_commands.json')].find((file) => fs.existsSync(file));
  if (direct) return direct;
  return ((projectFiles || walkProject(3000)).find((item) => item.name === 'compile_commands.json') || {}).full || '';
}
function shellWords(command) {
  return String(command || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((v) => v.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2')) || [];
}
function compileDatabaseInfo(projectFiles) {
  const file = findCompileDatabase(projectFiles);
  if (!file) return { ok: true, found: false, entries: 0, path: '', includePaths: [], defines: [], languages: {} };
  const st = fs.statSync(file); if (st.size > 20 * 1024 * 1024) throw new Error('compile_commands.json 超过 20 MB');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('compile_commands.json 格式不正确');
  const includes = new Set(), defines = new Set(), languages = {};
  for (const row of rows.slice(0, 20000)) {
    const args = Array.isArray(row.arguments) ? row.arguments.map(String) : shellWords(row.command);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-I' || arg === '-isystem') { if (args[i + 1]) includes.add(path.resolve(row.directory || projectRoot(), args[++i])); }
      else if (arg.startsWith('-I') && arg.length > 2) includes.add(path.resolve(row.directory || projectRoot(), arg.slice(2)));
      else if (arg === '-D') { if (args[i + 1]) defines.add(args[++i]); }
      else if (arg.startsWith('-D') && arg.length > 2) defines.add(arg.slice(2));
    }
    const ext = path.extname(String(row.file || '')).toLowerCase() || 'unknown'; languages[ext] = (languages[ext] || 0) + 1;
  }
  return { ok: true, found: true, entries: rows.length, path: path.relative(projectRoot(), file).split(path.sep).join('/'), includePaths: [...includes].slice(0, 300), defines: [...defines].slice(0, 1000), languages };
}
const LANGUAGE_BY_EXT = { '.js':'JavaScript','.mjs':'JavaScript','.cjs':'JavaScript','.ts':'TypeScript','.tsx':'TypeScript','.jsx':'JavaScript','.py':'Python','.c':'C','.h':'C/C++','.cc':'C++','.cpp':'C++','.cxx':'C++','.hpp':'C++','.java':'Java','.go':'Go','.rs':'Rust','.rb':'Ruby','.php':'PHP','.swift':'Swift','.kt':'Kotlin','.sh':'Shell','.md':'Markdown','.tex':'LaTeX','.html':'HTML','.css':'CSS','.json':'JSON','.yaml':'YAML','.yml':'YAML' };
async function projectHealth() {
  const scannedFiles = walkProject();
  const generatedPath = /(?:^|\/)(?:vendor|assets\/pdfjs|mscdex-ssh2-[^/]+)(?:\/|$)|^markdown-vault\/(?:readings|libraries|drawings|office|\.timeline)(?:\/|$)/;
  const files = scannedFiles.filter((file) => !generatedPath.test(file.relative));
  const languages = {}, issues = [], includeGraph = new Map();
  let lines = 0, bytes = 0, todos = 0;
  const byBase = new Map(files.map((f) => [f.name, f.relative]));
  for (const file of files) {
    let st; try { st = fs.statSync(file.full); } catch (_) { continue; }
    const lang = LANGUAGE_BY_EXT[file.ext] || 'Other'; languages[lang] = (languages[lang] || 0) + 1;
    if (st.size > 1024 * 1024 || (!LANGUAGE_BY_EXT[file.ext] && !['.txt','.cmake'].includes(file.ext))) continue;
    bytes += st.size;
    let text = ''; try { text = fs.readFileSync(file.full, 'utf8'); } catch (_) { continue; }
    lines += text.split(/\r?\n/).length;
    todos += (text.match(/\b(?:TODO|FIXME|XXX)\b/g) || []).length;
    const unfinished = text.split(/\r?\n/).some((line) => /^\s*(?:throw\s+new\s+Error\s*\(\s*['"]not implemented|raise\s+NotImplementedError\b|TODO\s*\(\s*\)\s*[;{])/i.test(line));
    if (unfinished) issues.push({ level:'warn', file:file.relative, message:'发现可能未实现的代码' });
    if (['.c','.h','.cc','.cpp','.cxx','.hpp'].includes(file.ext)) {
      const deps = [...text.matchAll(/^\s*#\s*include\s*["<]([^">]+)[">]/gm)].map((m) => byBase.get(path.basename(m[1]))).filter(Boolean);
      includeGraph.set(file.relative, [...new Set(deps)]);
    }
  }
  const cycles = [], visiting = new Set(), visited = new Set();
  const dfs = (node, stack) => {
    if (visiting.has(node)) { const at = stack.indexOf(node); cycles.push(stack.slice(at).concat(node)); return; }
    if (visited.has(node) || cycles.length >= 20) return;
    visiting.add(node); stack.push(node); for (const dep of includeGraph.get(node) || []) dfs(dep, stack); stack.pop(); visiting.delete(node); visited.add(node);
  };
  for (const node of includeGraph.keys()) dfs(node, []);
  let compileDb; try { compileDb = compileDatabaseInfo(scannedFiles); } catch (error) { compileDb = { ok:false, found:true, error:String(error.message || error) }; }
  const tasks = taskCatalog(scannedFiles);
  if (!tasks.tasks.length) issues.push({ level:'info', message:'未检测到常见构建入口，可使用自定义命令' });
  if (cycles.length) issues.push({ level:'warn', message:`检测到 ${cycles.length} 条 C/C++ 头文件循环依赖` });
  return { ok:true, root:projectRoot(), generatedAt:Date.now(), summary:{ files:files.length, ignoredFiles:scannedFiles.length-files.length, lines, bytes, todos, cycles:cycles.length }, languages, issues:issues.slice(0,100), cycles, compileDb, tasks:tasks.tasks.length };
}

/* --------------------------------- HTTP 服务 ---------------------------------- */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.xmind': 'application/vnd.xmind.workbook', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt': 'application/vnd.ms-powerpoint', '.otf': 'font/otf', '.ttf': 'font/ttf', '.ttc': 'font/collection', '.woff': 'font/woff', '.woff2': 'font/woff2', '.bib': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8' };

let INDEX_CACHE = null;
function indexAsset() {
  const file = path.join(__dirname, 'index.html');
  const stat = fs.statSync(file);
  if (!INDEX_CACHE || INDEX_CACHE.mtimeMs !== stat.mtimeMs || INDEX_CACHE.size !== stat.size) {
    const raw = fs.readFileSync(file);
    INDEX_CACHE = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      raw,
      gzip: zlib.gzipSync(raw, { level: zlib.constants.Z_BEST_SPEED }),
      etag: `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`,
    };
  }
  return INDEX_CACHE;
}
function sendIndex(req, res) {
  const asset = indexAsset();
  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304, { ETag: asset.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' });
    return res.end();
  }
  const gzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(req.headers['accept-encoding'] || ''));
  const body = gzip ? asset.gzip : asset.raw;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    ETag: asset.etag,
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  res.end(body);
}
function streamStatic(req, res, root, relative, options = {}) {
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, { ok:false, error:'forbidden' });
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return send(res, 404, { ok:false, error:options.notFound || 'not found' });
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag:etag, 'Cache-Control':options.cacheControl || 'no-cache' });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': options.cacheControl || 'no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    const input = fs.createReadStream(file);
    input.on('error', () => { if (!res.headersSent) send(res, 500, { ok:false, error:'读取静态资源失败' }); else res.destroy(); });
    input.pipe(res);
  });
}
function trustedHttpOrigin(req) {
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true; // 保留本机 CLI、测试脚本和桌面壳调用。
  try { return new URL(origin).host === String(req.headers.host || ''); }
  catch (_) { return false; }
}

/* ------------------------------- PDF 阅读文库 ------------------------------- */

function readingsDir() { return path.join(vaultPath(), 'readings'); }
const READING_TEXT_EXTS = new Set(['.md','.markdown','.txt','.c','.h','.cpp','.hpp','.cc','.py','.js','.ts','.json','.yaml','.yml','.tex']);
const READING_PROJECT_META = '.codescope-project.json';
const READING_FOLDER_META = '.codescope-folder.json';
function readingPath(value, allowFolder) {
  if (typeof value !== 'string') return null;
  const rel = value.replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean).join('/');
  if (!rel || /(^|\/)\.{1,2}(\/|$)|^\/|\/\//.test(rel) || /^[A-Za-z]:/.test(rel)) return null;
  if (!/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&/]+$/.test(rel)) return null;
  if (!allowFolder && !/\.pdf$/i.test(rel)) return null;
  return rel;
}
function readingAssetPath(value) {
  const rel = readingPath(value, true);
  if (!rel) return null;
  const ext = path.extname(rel).toLowerCase();
  return ext === '.pdf' || READING_TEXT_EXTS.has(ext) ? rel : null;
}
function readingFragmentInfo(rel, stat, project) {
  const ext = path.extname(rel).toLowerCase(), base = path.basename(rel);
  const kind = ext === '.pdf' ? 'pdf' : (['.md','.markdown'].includes(ext) ? 'markdown' : 'code');
  let role = kind;
  if (kind === 'pdf') {
    if (/双语|bilingual|parallel/i.test(base)) role = 'bilingual';
    else if (/中文|汉化|chinese|[_-](?:zh|cn)(?:[_.-]|$)/i.test(base)) role = 'translation';
    else role = 'original';
  }
  return { type:'fragment', kind, role, name:base, path:rel, project:project||'', size:stat.size, updated:stat.mtimeMs };
}
function readingProjectMetaFile(rel){return path.join(readingsDir(),rel,READING_PROJECT_META);}
function loadReadingProjectMeta(rel){try{const value=JSON.parse(fs.readFileSync(readingProjectMetaFile(rel),'utf8'));return{description:String(value.description||'').slice(0,1000),tags:Array.isArray(value.tags)?value.tags.map(String).filter(Boolean).slice(0,30):[]};}catch(_){return{description:'',tags:[]};}}
function saveReadingProjectMeta(rel,value){const clean={version:1,description:String(value&&value.description||'').trim().slice(0,1000),tags:[...new Set((Array.isArray(value&&value.tags)?value.tags:String(value&&value.tags||'').split(/[,，]/)).map((tag)=>String(tag).trim()).filter(Boolean))].slice(0,30),updatedAt:Date.now()};fs.mkdirSync(path.join(readingsDir(),rel),{recursive:true});fs.writeFileSync(readingProjectMetaFile(rel),JSON.stringify(clean,null,2),'utf8');return clean;}
function readingMetaFile(rel) {
  const id = crypto.createHash('sha256').update(rel).digest('hex');
  return path.join(readingsDir(), '.codescope', id + '.json');
}
function defaultReadingMeta(rel) {
  return { version:1, path:rel, page:1, view:'original', translations:{}, fragments:[], updatedAt:0 };
}
function loadReadingMeta(rel) {
  try {
    const parsed = JSON.parse(fs.readFileSync(readingMetaFile(rel), 'utf8'));
    return { ...defaultReadingMeta(rel), ...parsed, path:rel,
      translations:parsed && typeof parsed.translations === 'object' ? parsed.translations : {},
      fragments:Array.isArray(parsed && parsed.fragments) ? parsed.fragments : [] };
  } catch (_) { return defaultReadingMeta(rel); }
}
function saveReadingMeta(rel, value) {
  const clean = defaultReadingMeta(rel);
  clean.page = Math.max(1, Number(value && value.page) || 1);
  clean.view = ['original', 'source', 'translation', 'bilingual'].includes(value && value.view) ? value.view : 'original';
  clean.translations = value && typeof value.translations === 'object' ? value.translations : {};
  clean.fragments = Array.isArray(value && value.fragments) ? value.fragments.slice(0, 2000).map((item) => ({
    id:String(item.id || crypto.randomUUID()), page:Math.max(1, Number(item.page) || 1),
    source:String(item.source || '').slice(0, 30000), translation:String(item.translation || '').slice(0, 30000),
    note:String(item.note || '').slice(0, 10000), createdAt:Number(item.createdAt) || Date.now(),
    rects:Array.isArray(item && item.rects) ? item.rects.slice(0, 200).map((r) => ({ x:Number(r && r.x) || 0, y:Number(r && r.y) || 0, width:Number(r && r.width) || 0, height:Number(r && r.height) || 0 })) : [],
    scale:Number(item && item.scale) || 1,
  })) : [];
  clean.updatedAt = Date.now();
  const target = readingMetaFile(rel);
  fs.mkdirSync(path.dirname(target), { recursive:true });
  fs.writeFileSync(target, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
/* ---- 阅读标注（高亮/标记/摘要），存项目内 .codescope-annotations/<pdf名>.json ---- */
function readingAnnotationsFile(rel) {
  const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
  const stem = path.basename(rel, path.extname(rel));
  return path.join(readingsDir(), dir, '.codescope-annotations', stem + '.json');
}
function cleanAnnotation(item) {
  return {
    id: String(item && item.id || crypto.randomUUID()),
    page: Math.max(1, Number(item && item.page) || 1),
    type: (item && item.type === 'mark') ? 'mark' : 'highlight',
    color: String(item && item.color || '#ffd54a'),
    text: String(item && item.text || '').slice(0, 20000),
    rects: Array.isArray(item && item.rects) ? item.rects.slice(0, 500).map((r) => ({
      x: Number(r && r.x) || 0, y: Number(r && r.y) || 0, width: Number(r && r.width) || 0, height: Number(r && r.height) || 0,
    })) : [],
    note: String(item && item.note || '').slice(0, 20000),
    scale: Number(item && item.scale) || 1,
    createdAt: Number(item && item.createdAt) || Date.now(),
  };
}
function loadReadingAnnotations(rel) {
  try {
    const parsed = JSON.parse(fs.readFileSync(readingAnnotationsFile(rel), 'utf8'));
    return {
      annotations: Array.isArray(parsed && parsed.annotations) ? parsed.annotations.map(cleanAnnotation) : [],
      summary: parsed && parsed.summary && typeof parsed.summary === 'object' ? {
        status: ['done', 'pending', 'error'].includes(parsed.summary.status) ? parsed.summary.status : 'done',
        content: String(parsed.summary.content || ''),
        model: String(parsed.summary.model || ''),
        updatedAt: Number(parsed.summary.updatedAt) || 0,
      } : null,
    };
  } catch (_) { return { annotations: [], summary: null }; }
}
function saveReadingAnnotations(rel, value) {
  const current = loadReadingAnnotations(rel);
  const annotations = Array.isArray(value.annotations) ? value.annotations.slice(0, 5000).map(cleanAnnotation) : current.annotations;
  let summary = current.summary;
  if (value.summary && typeof value.summary === 'object' && ('content' in value.summary || 'status' in value.summary)) {
    summary = {
      status: ['done', 'pending', 'error'].includes(value.summary.status) ? value.summary.status : 'done',
      content: String(value.summary.content || ''),
      model: String(value.summary.model || (current.summary && current.summary.model) || ''),
      updatedAt: Date.now(),
    };
  }
  const data = { version: 1, updatedAt: Date.now(), annotations, summary };
  const target = readingAnnotationsFile(rel);
  fs.mkdirSync(path.dirname(target), { recursive:true });
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  return { annotations, summary };
}
function moveReadingMeta(from, to) {
  const oldFile = readingMetaFile(from), nextFile = readingMetaFile(to);
  if (!fs.existsSync(oldFile)) return;
  try {
    const meta = loadReadingMeta(from); meta.path = to;
    fs.mkdirSync(path.dirname(nextFile), { recursive:true });
    fs.writeFileSync(nextFile, JSON.stringify(meta, null, 2), 'utf8');
    fs.unlinkSync(oldFile);
  } catch (_) {}
}
function readingTree() {
  const rootDir = readingsDir();
  const root = { type:'folder', name:'', path:'', children:[], count:0 };
  const walkProject = (node, dir, prefix, projectPath) => {
    let rows = [];
    try { rows = fs.readdirSync(dir, { withFileTypes:true }).filter((entry) => ![READING_PROJECT_META,READING_FOLDER_META,'.codescope'].includes(entry.name)); } catch (_) {}
    rows.sort((a, b) => a.name.localeCompare(b.name));
    let count = 0;
    for (const entry of rows) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        count += walkProject(node, path.join(dir, entry.name), rel, projectPath);
      } else if (readingAssetPath(rel)) {
        let stat = { size:0, mtimeMs:0 }; try { stat = fs.statSync(path.join(dir, entry.name)); } catch (_) {}
        const fragment = readingFragmentInfo(rel, stat, projectPath);
        if (fragment.kind === 'pdf') {
          const meta = loadReadingMeta(rel);
          fragment.progress = { page:meta.page, translated:Object.keys(meta.translations || {}).length, fragments:meta.fragments.length };
        }
        node.children.push(fragment);
        count += 1;
      }
    }
    return count;
  };
  const directoryHasDirectAssets=(dir)=>{try{return fs.readdirSync(dir,{withFileTypes:true}).some((entry)=>entry.isFile()&&![READING_PROJECT_META,READING_FOLDER_META].includes(entry.name)&&readingAssetPath(entry.name));}catch(_){return false;}};
  const walkFolders=(dir,prefix,depth)=>{let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true}).filter((entry)=>entry.name!=='.codescope'&&![READING_PROJECT_META,READING_FOLDER_META].includes(entry.name));}catch(_){}entries.sort((a,b)=>a.name.localeCompare(b.name));const children=[];
    for(const entry of entries){if(!entry.isDirectory())continue;const rel=prefix?prefix+'/'+entry.name:entry.name,full=path.join(dir,entry.name);const explicitFolder=fs.existsSync(path.join(full,READING_FOLDER_META)),explicitProject=fs.existsSync(path.join(full,READING_PROJECT_META));
      if(explicitFolder){const folder={type:'folder',name:entry.name,path:rel,children:walkFolders(full,rel,depth+1)};folder.count=folder.children.reduce((sum,item)=>sum+(item.type==='project'?1:item.count||0),0);children.push(folder);continue;}
      if(explicitProject||directoryHasDirectAssets(full)||depth===0){const meta=loadReadingProjectMeta(rel),project={type:'project',name:entry.name,path:rel,description:meta.description,tags:meta.tags,children:[],count:0};project.count=walkProject(project,full,rel,rel);children.push(project);root.count+=project.count;continue;}
      const folder={type:'folder',name:entry.name,path:rel,children:walkFolders(full,rel,depth+1)};folder.count=folder.children.reduce((sum,item)=>sum+(item.type==='project'?1:item.count||0),0);children.push(folder);
    }return children;};
  root.children=walkFolders(rootDir,'',0);
  return root;
}
let PDFJS_PROMISE = null;
const PDF_TEXT_CACHE = new Map();
const PDF_TEXT_CACHE_LIMIT = 10;
async function extractPdfPages(file) {
  const stat = fs.statSync(file), cacheKey = stat.mtimeMs + ':' + stat.size;
  const cached = PDF_TEXT_CACHE.get(file);
  if (cached && cached.key === cacheKey) {
    PDF_TEXT_CACHE.delete(file); PDF_TEXT_CACHE.set(file, cached);
    return cached.pages;
  }
  if (!PDFJS_PROMISE) PDFJS_PROMISE = import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await PDFJS_PROMISE;
  const bytes = new Uint8Array(fs.readFileSync(file));
  const task = pdfjs.getDocument({ data:bytes, disableWorker:true, useSystemFonts:true });
  const doc = await task.promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    let text = '', lastY = null;
    for (const item of content.items || []) {
      const y = item.transform && item.transform[5];
      if (lastY != null && y != null && Math.abs(y - lastY) > 4) text += '\n';
      else if (text && !text.endsWith('\n')) text += ' ';
      text += String(item.str || ''); lastY = y;
    }
    pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  await doc.destroy();
  PDF_TEXT_CACHE.delete(file); PDF_TEXT_CACHE.set(file, { key:cacheKey, pages });
  while (PDF_TEXT_CACHE.size > PDF_TEXT_CACHE_LIMIT) PDF_TEXT_CACHE.delete(PDF_TEXT_CACHE.keys().next().value);
  return pages;
}

function searchReadingLibrary(query, sensitive) {
  const needle = sensitive ? String(query || '') : String(query || '').toLocaleLowerCase();
  if (!needle || needle.length > 240) return [];
  const root = readingsDir(), hits = [];
  const addLines = (rel, content, extra) => {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    for (let index = 0; index < lines.length && hits.length < 200; index += 1) {
      const line = lines[index], haystack = sensitive ? line : line.toLocaleLowerCase(), start = haystack.indexOf(needle);
      if (start >= 0) hits.push({ path:rel, line:index + 1, text:line.trim().slice(0, 600), start, length:String(query).length, ...(extra || {}) });
    }
  };
  const walk = (dir, prefix) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch (_) { return; }
    for (const entry of entries) {
      if (hits.length >= 200 || entry.name === '.codescope' || entry.name.startsWith('.')) continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name, full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, rel); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (READING_TEXT_EXTS.has(ext)) {
        try { const stat = fs.statSync(full); if (stat.size <= 2 * 1024 * 1024) addLines(rel, fs.readFileSync(full, 'utf8'), { kind:'text' }); } catch (_) {}
      } else if (ext === '.pdf') {
        const meta = loadReadingMeta(rel);
        for (const fragment of meta.fragments || []) {
          const value = [fragment.source, fragment.translation, fragment.note].filter(Boolean).join(' · '), haystack = sensitive ? value : value.toLocaleLowerCase(), start = haystack.indexOf(needle);
          if (start >= 0) hits.push({ path:rel, page:Number(fragment.page) || 1, line:0, text:value.slice(0, 600), start, length:String(query).length, kind:'pdf' });
          if (hits.length >= 200) break;
        }
      }
    }
  };
  walk(root, '');
  return hits;
}

function decodeWorkspaceRef(value) {
  try { return decodeURIComponent(String(value || '')); } catch (_) { return String(value || ''); }
}
function workspaceBacklinks(kind, targetPath, targetFragment) {
  const hits = [], wanted = String(targetPath || ''), wantedFragment = Number(targetFragment);
  const addMatches = (content, source) => {
    const text = String(content || ''), lines = text.replace(/\r\n/g, '\n').split('\n');
    const patterns = kind === 'code'
      ? [/\[\[code-ref:([^#|\]]+)#fragment=(\d+)(?:&amp;|&)line=(\d+)(?:(?:&amp;|&)end=(\d+))?\|([^\]]+)\]\]/g]
      : kind === 'pdf'
        ? [/\[\[pdf-ref:([^#|\]]+)#page=(\d+)(?:&amp;|&)fragment=([^|\]]*)\|([^\]]+)\]\]/g]
        : [/\[\[note-ref:([^|\]]+)\|([^\]]+)\]\]/g];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) && hits.length < 300) {
        const refPath = decodeWorkspaceRef(match[1]);
        const fragment = kind === 'code' ? Number(match[2]) : null;
        if (refPath !== wanted || (kind === 'code' && Number.isFinite(wantedFragment) && fragment !== wantedFragment)) continue;
        const line = text.slice(0, match.index).split('\n').length;
        hits.push({ ...source, line, label:match[match.length - 1], preview:(lines[line - 1] || '').trim().slice(0, 600) });
      }
    }
  };
  for (const snippet of walkSnippets()) {
    (snippet.fragments || []).forEach((fragment, index) => {
      if (fragment.language === 'markdown') addMatches(fragment.code, { sourceKind:'code-note', file:snippet.file, fragment:index, name:(fragment.label || snippet.name), project:snippet.name });
    });
  }
  const root = readingsDir();
  const walk = (dir, prefix) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || hits.length >= 300) continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name, full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, rel); continue; }
      if (!['.md','.markdown'].includes(path.extname(entry.name).toLowerCase())) continue;
      try { const stat = fs.statSync(full); if (stat.size <= 8 * 1024 * 1024) addMatches(fs.readFileSync(full, 'utf8'), { sourceKind:'reading-note', path:rel, name:path.basename(rel), project:path.posix.dirname(rel) }); } catch (_) {}
    }
  };
  walk(root, '');
  return hits;
}

/* ------------------------------- Office 文档库 ------------------------------- */

function officeDir() { return path.join(vaultPath(), 'office'); }
const OFFICE_EXTS = new Set(['.docx', '.xlsx', '.xls', '.csv', '.pptx']);
const ONLYOFFICE_PUBLIC_URL = String(process.env.CODESCOPE_ONLYOFFICE_URL || 'http://127.0.0.1:8088').replace(/\/$/, '');
const ONLYOFFICE_CONTAINER_HOST = String(process.env.CODESCOPE_ONLYOFFICE_CONTAINER_HOST || 'host.docker.internal').trim();
const ONLYOFFICE_ACCESS_SECRET = crypto.randomBytes(32);
function onlyOfficeToken(rel, purpose) {
  return crypto.createHmac('sha256', ONLYOFFICE_ACCESS_SECRET).update(String(purpose || '') + '\0' + String(rel || '')).digest('hex');
}
function onlyOfficeTokenValid(rel, purpose, token) {
  const expected = Buffer.from(onlyOfficeToken(rel, purpose)), actual = Buffer.from(String(token || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function onlyOfficeContainerBase() {
  const explicit = String(process.env.CODESCOPE_ONLYOFFICE_CALLBACK_BASE || '').replace(/\/$/, '');
  if (explicit) return explicit;
  return 'http://' + ONLYOFFICE_CONTAINER_HOST + ':' + PORT;
}
async function onlyOfficeHealth() {
  try {
    const response = await fetch(ONLYOFFICE_PUBLIC_URL + '/healthcheck', { signal:AbortSignal.timeout(1800), cache:'no-store' });
    const text = (await response.text()).trim().toLowerCase();
    return { ok:response.ok && (text === 'true' || text === 'true.' || text.includes('true')), url:ONLYOFFICE_PUBLIC_URL };
  } catch (error) {
    return { ok:false, url:ONLYOFFICE_PUBLIC_URL, error:String(error.message || error) };
  }
}
function onlyOfficeDocumentType(kind) {
  return kind === 'word' ? 'word' : kind === 'sheet' ? 'cell' : kind === 'slides' ? 'slide' : '';
}
function onlyOfficeConfig(rel, file) {
  const stat = fs.statSync(file), ext = path.extname(rel).slice(1).toLowerCase(), kind = officeKind(rel);
  const internal = onlyOfficeContainerBase(), documentToken = onlyOfficeToken(rel, 'document'), callbackToken = onlyOfficeToken(rel, 'callback');
  const key = crypto.createHash('sha256').update('codescope\0' + rel + '\0' + stat.size + '\0' + stat.mtimeMs).digest('hex').slice(0, 48);
  return {
    type:'desktop', width:'100%', height:'100%', documentType:onlyOfficeDocumentType(kind),
    document:{
      fileType:ext, key, title:path.basename(rel),
      url:internal + '/api/office/onlyoffice-file?path=' + encodeURIComponent(rel) + '&token=' + documentToken,
      info:{ owner:'CodeScope', folder:path.posix.dirname(rel) === '.' ? 'Office 根目录' : path.posix.dirname(rel), uploaded:new Date(stat.mtimeMs).toISOString() },
      permissions:{ edit:true, download:true, print:true, copy:true, comment:true, review:true, fillForms:true, modifyFilter:true, protect:true },
    },
    editorConfig:{
      callbackUrl:internal + '/api/office/onlyoffice-callback?path=' + encodeURIComponent(rel) + '&token=' + callbackToken,
      lang:'zh-CN', region:'zh-CN', mode:'edit',
      user:{ id:'codescope-local', name:'CodeScope 本地用户' },
      coEditing:{ mode:'fast', change:true },
      customization:{ autosave:true, forcesave:true, compactHeader:false, compactToolbar:false, hideRightMenu:false, toolbarHideFileName:true, about:false, feedback:false },
    },
  };
}
function backupOfficeFile(file, rel) {
  const ext = path.extname(rel), relDir = path.dirname(rel), stem = path.basename(rel, ext);
  const backupDir = path.join(officeDir(), '.codescope-backups', relDir === '.' ? '' : relDir);
  fs.mkdirSync(backupDir, { recursive:true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(backupDir, stem + '.' + stamp + ext));
  const backups = fs.readdirSync(backupDir).filter((name) => name.startsWith(stem + '.') && name.endsWith(ext)).sort().reverse();
  for (const old of backups.slice(5)) { try { fs.unlinkSync(path.join(backupDir, old)); } catch (_) {} }
}
async function saveOnlyOfficeResult(rel, sourceUrl) {
  const file = path.join(officeDir(), rel), ext = path.extname(rel).toLowerCase();
  if (!fs.existsSync(file)) throw requestError('要保存的 Office 文档不存在', 404);
  let source;
  try { source = new URL(String(sourceUrl || '')); } catch (_) { throw requestError('ONLYOFFICE 返回了无效的保存地址', 400); }
  const allowed = new URL(ONLYOFFICE_PUBLIC_URL);
  if (!['http:', 'https:'].includes(source.protocol)) throw requestError('ONLYOFFICE 保存地址协议不受支持', 400);
  const localNames = new Set(['127.0.0.1', 'localhost', '::1', 'codescope-onlyoffice', allowed.hostname]);
  if (!localNames.has(source.hostname)) throw requestError('已拒绝非本机 ONLYOFFICE 保存地址', 403);
  if (source.origin !== allowed.origin) {
    source = new URL(source.pathname + source.search, ONLYOFFICE_PUBLIC_URL + '/');
  }
  let response;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetch(source, { signal:AbortSignal.timeout(60000), redirect:'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw requestError('ONLYOFFICE 保存重定向缺少地址', 502);
    let next; try { next = new URL(location, source); } catch (_) { throw requestError('ONLYOFFICE 保存重定向地址无效', 502); }
    if (!['http:', 'https:'].includes(next.protocol) || !localNames.has(next.hostname)) throw requestError('已拒绝非本机 ONLYOFFICE 保存重定向', 403);
    if (next.origin !== allowed.origin) next = new URL(next.pathname + next.search, ONLYOFFICE_PUBLIC_URL + '/');
    source = next;
  }
  if (!response) throw requestError('ONLYOFFICE 文件下载失败', 502);
  if (!response.ok) throw requestError('ONLYOFFICE 文件下载失败（HTTP ' + response.status + '）', 502);
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > 200 * 1024 * 1024) throw requestError('ONLYOFFICE 返回的文件超过 200 MB', 413);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 200 * 1024 * 1024) throw requestError('ONLYOFFICE 返回的文件超过 200 MB', 413);
  const temp = path.join(path.dirname(file), '.' + crypto.randomUUID() + ext + '.onlyoffice-saving');
  try {
    fs.writeFileSync(temp, buffer); validateOfficeFile(temp, ext); backupOfficeFile(file, rel); fs.renameSync(temp, file);
  } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} throw error; }
  return fs.statSync(file);
}
function officePath(value, allowFolder = false) {
  if (typeof value !== 'string') return null;
  const rel = value.replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean).join('/');
  if (!rel || /(^|\/)\.{1,2}(\/|$)|^\/|\/\//.test(rel) || /^[A-Za-z]:/.test(rel)) return null;
  if (!/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&/]+$/.test(rel)) return null;
  if (!allowFolder && !OFFICE_EXTS.has(path.extname(rel).toLowerCase())) return null;
  return rel;
}
function officeKind(value) {
  const ext = path.extname(String(value || '')).toLowerCase();
  if (ext === '.docx') return 'word';
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'sheet';
  if (ext === '.pptx') return 'slides';
  return 'unknown';
}
function officeTree() {
  const root = { type:'folder', name:'', path:'', children:[], count:0 };
  const walk = (node, absolute) => {
    let entries = [];
    try { entries = fs.readdirSync(absolute, { withFileTypes:true }); } catch (_) {}
    entries = entries.filter((entry) => !entry.name.startsWith('.')).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN', { numeric:true });
    });
    let count = 0;
    for (const entry of entries) {
      const rel = node.path ? node.path + '/' + entry.name : entry.name;
      const full = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        const child = { type:'folder', name:entry.name, path:rel, children:[], count:0 };
        node.children.push(child); child.count = walk(child, full); count += child.count;
      } else if (OFFICE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        let stat; try { stat = fs.statSync(full); } catch (_) { continue; }
        node.children.push({ type:'document', name:entry.name, path:rel, kind:officeKind(entry.name), ext:path.extname(entry.name).toLowerCase(), size:stat.size, updated:stat.mtimeMs });
        count += 1;
      }
    }
    node.count = count; return count;
  };
  fs.mkdirSync(officeDir(), { recursive:true }); walk(root, officeDir()); return root;
}
function uniqueOfficeTarget(folder, base) {
  const ext = path.extname(base), stem = path.basename(base, ext), dir = path.join(officeDir(), folder || '.');
  fs.mkdirSync(dir, { recursive:true });
  let name = base, index = 2;
  while (fs.existsSync(path.join(dir, name))) { name = stem + '-' + index + ext; index += 1; }
  return { name, file:path.join(dir, name), path:folder ? folder + '/' + name : name };
}
function officeSafeFolder(value) {
  if (value == null || value === '') return '';
  const rel = officePath(String(value), true);
  return rel && !OFFICE_EXTS.has(path.extname(rel).toLowerCase()) ? rel : null;
}
function officeStreamToFile(req, target, maxBytes = 200 * 1024 * 1024) {
  let bytes = 0;
  const limiter = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(requestError('Office 文件超过 200 MB', 413));
    callback(null, chunk);
  }});
  return pipeline(req, limiter, fs.createWriteStream(target, { flags:'wx' })).then(() => bytes);
}
function validateOfficeFile(file, ext) {
  const fd = fs.openSync(file, 'r'), head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
  if (['.docx', '.xlsx', '.pptx'].includes(ext) && head.slice(0, 2).toString('ascii') !== 'PK') throw new Error('文件内容不是有效的 Office Open XML 文档');
  if (ext === '.xls' && !head.equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) throw new Error('文件内容不是有效的 Excel 工作簿');
}
async function createOfficeDocument(kind, file, title) {
  if (kind === 'word') {
    const doc = new Document({ sections:[{ children:[new Paragraph({ text:title || '新建文档', heading:HeadingLevel.TITLE }), new Paragraph('开始编写内容…')] }] });
    fs.writeFileSync(file, await Packer.toBuffer(doc)); return;
  }
  if (kind === 'sheet') {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['项目', '内容'], ['标题', title || '新建表格']]);
    sheet['!cols'] = [{ wch:18 }, { wch:36 }]; XLSX.utils.book_append_sheet(workbook, sheet, '工作表1'); XLSX.writeFile(workbook, file); return;
  }
  if (kind === 'slides') {
    const escape = (value) => String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const deckTitle = escape(title || '新建演示文稿'), entries = {};
    entries['[Content_Types].xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
    entries['_rels/.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
    entries['docProps/core.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>'+deckTitle+'</dc:title><dc:creator>CodeScope</dc:creator><cp:lastModifiedBy>CodeScope</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">'+new Date().toISOString()+'</dcterms:created></cp:coreProperties>');
    entries['docProps/app.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CodeScope</Application><PresentationFormat>宽屏</PresentationFormat><Slides>1</Slides><Notes>0</Notes></Properties>');
    entries['ppt/presentation.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>');
    entries['ppt/_rels/presentation.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
    entries['ppt/slides/slide1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F7F9FC"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="2286000"/><a:ext cx="10363200" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="3000" b="1"><a:solidFill><a:srgbClr val="243247"/></a:solidFill></a:rPr><a:t>'+deckTitle+'</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
    entries['ppt/slides/_rels/slide1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
    entries['ppt/slideLayouts/slideLayout1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="空白"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
    entries['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
    entries['ppt/slideMasters/slideMaster1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="4472C4" accent2="ED7D31" accent3="A5A5A5" accent4="FFC000" accent5="5B9BD5" accent6="70AD47" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>');
    entries['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>');
    entries['ppt/theme/theme1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="CodeScope"><a:themeElements><a:clrScheme name="CodeScope"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="243247"/></a:dk2><a:lt2><a:srgbClr val="F7F9FC"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="CodeScope"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="等线"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="等线"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="CodeScope"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:solidFill><a:schemeClr val="lt2"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>');
    fs.writeFileSync(file, Buffer.from(zipSync(entries, { level:6 }))); return;
  }
  throw new Error('不支持的 Office 文档类型');
}

function sanitizeOfficeWordHtml(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|meta|link)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|meta|link)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '');
}

async function officeWordToHtml(file) {
  const result = await mammoth.convertToHtml({ buffer:fs.readFileSync(file) }, {
    styleMap:[
      "p[style-name='Title'] => h1.office-document-title:fresh",
      "p[style-name='Subtitle'] => p.office-document-subtitle:fresh",
      "p[style-name='Quote'] => blockquote:fresh",
    ],
    includeDefaultStyleMap:true,
  });
  return { html:sanitizeOfficeWordHtml(result.value), messages:(result.messages || []).slice(0, 30).map((item) => ({ type:item.type, message:item.message })) };
}

async function saveOfficeWordHtml(file, value) {
  const html = sanitizeOfficeWordHtml(value);
  if (!html.trim()) throw requestError('Word 文档内容不能为空', 400);
  if (Buffer.byteLength(html, 'utf8') > 20 * 1024 * 1024) throw requestError('Word 编辑内容超过 20 MB', 413);
  const page = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,"Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.6;color:#111}h1{font-size:24pt}h2{font-size:18pt}h3{font-size:14pt}blockquote{border-left:3px solid #888;padding-left:12px;color:#555}table{border-collapse:collapse}td,th{border:1px solid #888;padding:5px 8px}' +
    '</style></head><body>' + html + '</body></html>';
  const output = await htmlToDocx(page, null, { table:{ row:{ cantSplit:true } }, footer:false, pageNumber:false });
  const temp = path.join(path.dirname(file), '.' + crypto.randomUUID() + '.docx-saving');
  try {
    fs.writeFileSync(temp, Buffer.from(output));
    validateOfficeFile(temp, '.docx');
    const rel = path.relative(officeDir(), file), relDir = path.dirname(rel), stem = path.basename(rel, '.docx');
    const backupDir = path.join(officeDir(), '.codescope-backups', relDir === '.' ? '' : relDir);
    fs.mkdirSync(backupDir, { recursive:true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(backupDir, stem + '.' + stamp + '.docx'));
    const backups = fs.readdirSync(backupDir).filter((name) => name.startsWith(stem + '.') && name.endsWith('.docx')).sort().reverse();
    for (const old of backups.slice(5)) { try { fs.unlinkSync(path.join(backupDir, old)); } catch (_) {} }
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
  return fs.statSync(file);
}

function send(res, code, obj) {
  if (res.writableEnded || res.destroyed) return false;
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
  return true;
}

function requestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode || 400;
  return error;
}

function readBody(req, maxBytes = 45e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    let tooLarge = false;
    const decoder = new StringDecoder('utf8');
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { tooLarge = true; data = ''; return; }
      if (!tooLarge) data += decoder.write(chunk);
    });
    req.once('end', () => {
      if (tooLarge) return reject(requestError('请求内容超过 ' + Math.round(maxBytes / 1e6) + ' MB', 413));
      data += decoder.end();
      if (!data.trim()) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (_) { reject(requestError('请求 JSON 格式错误', 400)); }
    });
    req.once('aborted', () => reject(requestError('请求在传输完成前已中止', 400)));
    req.once('error', reject);
  });
}

function searchPlainText(value, maxLength) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, maxLength || 1200);
}
function normalizeWebResults(items) {
  const out = [], seen = new Set();
  for (const item of items || []) {
    const rawUrl = String(item.url || '').trim();
    let parsed;
    try { parsed = new URL(rawUrl); } catch (_) { continue; }
    if (!['http:', 'https:'].includes(parsed.protocol) || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    out.push({
      title:searchPlainText(item.title || parsed.hostname, 240),url:parsed.href,
      snippet:searchPlainText(item.snippet || item.content || item.description, 1800),
      publishedAt:searchPlainText(item.publishedAt || item.published_date || item.age || '', 80),
    });
    if (out.length >= 6) break;
  }
  return out;
}
async function liveWebSearch(provider, key, query) {
  const searchedAt = new Date().toISOString();
  if (provider === 'tavily') {
    const response = await fetch('https://api.tavily.com/search', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify({query,topic:'general',search_depth:'advanced',max_results:6,include_answer:false,include_raw_content:false}),
      signal:AbortSignal.timeout(25000),
    });
    const text=await response.text();
    if(!response.ok) throw new Error('Tavily API '+response.status+': '+text.slice(0,300));
    let data;try{data=JSON.parse(text);}catch(_){throw new Error('Tavily 返回了无法解析的内容');}
    return {ok:true,provider,searchedAt,results:normalizeWebResults(data.results)};
  }
  if (provider === 'brave') {
    const url=new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q',query);url.searchParams.set('count','6');url.searchParams.set('safesearch','moderate');url.searchParams.set('text_decorations','false');url.searchParams.set('extra_snippets','true');
    const response=await fetch(url,{headers:{'Accept':'application/json','Accept-Encoding':'gzip','X-Subscription-Token':key},signal:AbortSignal.timeout(25000)});
    const text=await response.text();
    if(!response.ok) throw new Error('Brave Search API '+response.status+': '+text.slice(0,300));
    let data;try{data=JSON.parse(text);}catch(_){throw new Error('Brave Search 返回了无法解析的内容');}
    const rows=((data.web&&data.web.results)||[]).map((item)=>({title:item.title,url:item.url,description:[item.description].concat(item.extra_snippets||[]).filter(Boolean).join(' '),age:item.age||item.page_age||''}));
    return {ok:true,provider,searchedAt,results:normalizeWebResults(rows)};
  }
  throw new Error('不支持的联网搜索服务');
}

const server = http.createServer(async (req, res) => {
  // 请求级熔断：任何请求最长 90 秒（覆盖云盘 git 卡死等极端场景），超时即断开该连接，
  // 页面永远不会无限“转圈”，也不拖累其他请求。
  const _reqGuard = setTimeout(() => { try { res.destroy(); } catch (_) {} }, 90000);
  res.on('finish', () => clearTimeout(_reqGuard));
  res.on('close', () => clearTimeout(_reqGuard));
  const u = new URL(req.url, 'http://' + HOST + ':' + PORT);
  try {
    if (req.method !== 'GET' && u.pathname.startsWith('/api/') && !trustedHttpOrigin(req)) {
      return send(res, 403, { ok:false, error:'已拒绝跨站写入请求' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/') {
      return sendIndex(req, res);
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/assets/')) {
      const assetsRoot = path.join(__dirname, 'assets');
      const rel = u.pathname.slice('/assets/'.length);
      return streamStatic(req, res, assetsRoot, rel, { cacheControl:'no-cache' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/vendor/')) {
      const assetsRoot = path.join(__dirname, 'vendor');
      const rel = u.pathname.slice('/vendor/'.length);
      return streamStatic(req, res, assetsRoot, rel, { cacheControl:'public, max-age=86400' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/novnc/')) {
      const novncRoot = path.join(__dirname, 'node_modules', '@novnc', 'novnc');
      const rel = u.pathname.slice('/novnc/'.length);
      return streamStatic(req, res, novncRoot, rel, { cacheControl:'public, max-age=86400', notFound:'noVNC asset not found；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/monaco/')) {
      const monacoRoot = path.join(__dirname, 'node_modules', 'monaco-editor', 'min');
      const rel = u.pathname.slice('/monaco/'.length);
      return streamStatic(req, res, monacoRoot, rel, { cacheControl:'public, max-age=86400', notFound:'Monaco asset not found；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/xmind-viewer/')) {
      const viewerRoot = path.join(__dirname, 'node_modules', 'xmind-embed-viewer', 'dist', 'umd');
      const rel = u.pathname.slice('/xmind-viewer/'.length);
      return streamStatic(req, res, viewerRoot, rel, { cacheControl:'public, max-age=86400', notFound:'XMind 官方查看器资源不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/mind-elixir/')) {
      const editorRoot = path.join(__dirname, 'node_modules', 'mind-elixir', 'dist');
      const rel = u.pathname.slice('/mind-elixir/'.length);
      return streamStatic(req, res, editorRoot, rel, { cacheControl:'public, max-age=86400', notFound:'Mind Elixir 编辑器资源不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/simple-mind-map/')) {
      const editorRoot = path.join(__dirname, 'node_modules', 'simple-mind-map', 'dist');
      const rel = u.pathname.slice('/simple-mind-map/'.length);
      return streamStatic(req, res, editorRoot, rel, { cacheControl:'public, max-age=86400', notFound:'SimpleMindMap 编辑器资源不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/office-docx/')) {
      const root = path.join(__dirname, 'node_modules', 'docx-preview', 'dist');
      return streamStatic(req, res, root, u.pathname.slice('/office-docx/'.length), { cacheControl:'public, max-age=86400', notFound:'Word 预览组件不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/office-jszip/')) {
      const root = path.join(__dirname, 'node_modules', 'jszip', 'dist');
      return streamStatic(req, res, root, u.pathname.slice('/office-jszip/'.length), { cacheControl:'public, max-age=86400', notFound:'Office ZIP 组件不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/office-xlsx/')) {
      const root = path.join(__dirname, 'node_modules', 'xlsx');
      return streamStatic(req, res, root, u.pathname.slice('/office-xlsx/'.length), { cacheControl:'public, max-age=86400', notFound:'表格组件不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/office-pptx/')) {
      const root = path.join(__dirname, 'node_modules', 'pptx-preview', 'dist');
      return streamStatic(req, res, root, u.pathname.slice('/office-pptx/'.length), { cacheControl:'public, max-age=86400', notFound:'演示文稿预览组件不存在；请先运行 npm install' });
    }
    if (req.method === 'GET' && u.pathname === '/api/system/status') {
      return send(res, 200, await systemStatus());
    }
    if (req.method === 'GET' && u.pathname === '/api/snippets') {
      send(res, 200, { vault: vaultPath(), rev: computeRev(), tags: readTagRegistry().list, folders: walkFolders(), resources: walkLatexResources(), snippets: walkSnippets() });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/rev') {
      send(res, 200, { rev: computeRev(), version: APP_VERSION });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/version') {
      return send(res, 200, { ok: true, name: '码境 CodeScope', version: APP_VERSION, apiRevision: 4, releaseChannel:'stable', mode:APP_MODE,
        capabilities:{ web:true, desktop:APP_MODE === 'desktop', nativeBridge:APP_MODE === 'desktop' },
        features: ['dual-mode-runtime', 'desktop-shell', 'unified-workbench-ui', 'environment-readiness', 'browser-capabilities', 'cross-platform-preflight', 'git-diff', 'timeline', 'remote-files', 'remote-folder-transfer', 'stream-transfer', 'project-tasks', 'project-tests', 'project-debug', 'compile-database', 'project-health', 'markdown-code-links', 'workspace-backlinks', 'markdown-note-links', 'xmind-markdown-export', 'xmind-native', 'xmind-official-viewer', 'xmind-mind-elixir', 'xmind-simple-mind-map', 'xmind-advanced-layouts', 'xmind-node-reparent', 'opml-export', 'workspace-snapshots', 'live-web-search', 'search-history', 'editor-groups', 'monaco-editor', 'multi-cursor', 'editor-folding', 'editor-command-palette', 'editor-line-actions', 'editor-word-wrap', 'editor-wheel-zoom', 'editor-position', 'lsp-completion', 'lsp-signature-help', 'lsp-code-actions', 'lsp-rename', 'lsp-problems', 'drawio', 'drawio-xml', 'ai-drawio', 'full-text-search', 'quick-open', 'workspace-quick-open', 'workspace-recent', 'reading-full-text-search', 'pdf-text-cache', 'navigation-history', 'definition-peek', 'header-source-switch', 'lsp', 'pdf-library', 'pdf-translation', 'pdf-full-text-search', 'pdf-thumbnail-navigation', 'pdf-focus-mode', 'reading-fragments', 'reading-split-view', 'reading-projects', 'reading-code-notes', 'reading-folders', 'reading-project-metadata', 'office-library', 'office-folders', 'onlyoffice-docs', 'onlyoffice-save-callback', 'docx-preview', 'word-editing', 'word-autosave', 'spreadsheet-editing', 'pptx-preview'] });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/tree') {
      const root = officeTree(); return send(res, 200, { ok:true, dir:officeDir(), root, total:root.count });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/office/file') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'Office 文件路径不合法' });
      if (u.searchParams.get('download') === '1') res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(rel)));
      return streamStatic(req, res, officeDir(), rel, { cacheControl:'private, no-cache', notFound:'Office 文件不存在' });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/onlyoffice/status') {
      const health = await onlyOfficeHealth();
      return send(res, health.ok ? 200 : 503, { ...health, engine:'ONLYOFFICE Docs', editable:['docx','xlsx','xls','csv','pptx'] });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/onlyoffice/config') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'Office 文件路径不合法' });
      const file = path.join(officeDir(), rel), kind = officeKind(rel);
      if (!fs.existsSync(file) || !onlyOfficeDocumentType(kind)) return send(res, 404, { ok:false, error:'Office 文件不存在或类型不受支持' });
      const health = await onlyOfficeHealth();
      if (!health.ok) return send(res, 503, { ok:false, error:'ONLYOFFICE Docs 尚未启动', documentServerUrl:ONLYOFFICE_PUBLIC_URL, fallback:true });
      return send(res, 200, { ok:true, engine:'ONLYOFFICE Docs', documentServerUrl:ONLYOFFICE_PUBLIC_URL, config:onlyOfficeConfig(rel, file) });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/office/onlyoffice-file') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel || !onlyOfficeTokenValid(rel, 'document', u.searchParams.get('token'))) return send(res, 403, { ok:false, error:'Office 文件访问令牌无效' });
      return streamStatic(req, res, officeDir(), rel, { cacheControl:'private, no-store', notFound:'Office 文件不存在' });
    }
    if (req.method === 'POST' && u.pathname === '/api/office/onlyoffice-callback') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel || !onlyOfficeTokenValid(rel, 'callback', u.searchParams.get('token'))) return send(res, 403, { error:1 });
      const body = await readBody(req, 4 * 1024 * 1024), status = Number(body && body.status);
      if ((status === 2 || status === 6) && body.url) {
        try { await saveOnlyOfficeResult(rel, body.url); }
        catch (error) { console.error('ONLYOFFICE 保存失败:', rel, error); return send(res, 500, { error:1 }); }
      }
      if (status === 3 || status === 7) console.error('ONLYOFFICE 编辑服务报告保存错误:', rel, body && body.error);
      return send(res, 200, { error:0 });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/word-html') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel || path.extname(rel).toLowerCase() !== '.docx') return send(res, 400, { ok:false, error:'Word 文件路径不合法' });
      const file = path.join(officeDir(), rel);
      if (!fs.existsSync(file)) return send(res, 404, { ok:false, error:'Word 文件不存在' });
      try { const result = await officeWordToHtml(file); return send(res, 200, { ok:true, path:rel, ...result }); }
      catch (error) { return send(res, 400, { ok:false, error:'Word 内容解析失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/word-save') {
      const b = await readBody(req, 24 * 1024 * 1024), rel = officePath(b && b.path);
      if (!rel || path.extname(rel).toLowerCase() !== '.docx') return send(res, 400, { ok:false, error:'Word 文件路径不合法' });
      const file = path.join(officeDir(), rel);
      if (!fs.existsSync(file)) return send(res, 404, { ok:false, error:'要保存的 Word 文档不存在' });
      try { const stat = await saveOfficeWordHtml(file, b && b.html); return send(res, 200, { ok:true, path:rel, size:stat.size, updated:stat.mtimeMs }); }
      catch (error) { return send(res, error.statusCode || 400, { ok:false, error:'Word 保存失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/folder') {
      const b = await readBody(req), parent = officeSafeFolder(b && b.parent), name = officeSafeFolder(b && b.name);
      if (parent === null || !name || name.includes('/')) return send(res, 400, { ok:false, error:'文件夹名称或位置不合法' });
      const rel = parent ? parent + '/' + name : name, target = path.join(officeDir(), rel);
      if (fs.existsSync(target)) return send(res, 409, { ok:false, error:'同名文件夹已存在' });
      fs.mkdirSync(target, { recursive:true }); return send(res, 200, { ok:true, path:rel });
    }
    if (req.method === 'POST' && u.pathname === '/api/office/new') {
      const b = await readBody(req), folder = officeSafeFolder(b && b.folder), kind = String(b && b.kind || '');
      if (folder === null || !['word', 'sheet', 'slides'].includes(kind)) return send(res, 400, { ok:false, error:'新建文档参数不合法' });
      const raw = String(b && b.name || '').trim().replace(/\.(?:docx|xlsx|pptx)$/i, '');
      if (!raw || !/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&]+$/.test(raw) || ['.', '..'].includes(raw)) return send(res, 400, { ok:false, error:'文档名称不合法' });
      const ext = kind === 'word' ? '.docx' : (kind === 'sheet' ? '.xlsx' : '.pptx'), target = uniqueOfficeTarget(folder, raw + ext);
      try { await createOfficeDocument(kind, target.file, raw); return send(res, 200, { ok:true, path:target.path, name:target.name, kind, size:fs.statSync(target.file).size }); }
      catch (error) { try { fs.unlinkSync(target.file); } catch (_) {} return send(res, 500, { ok:false, error:'创建 Office 文档失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/upload-stream') {
      let info;
      try { info = JSON.parse(Buffer.from(String(req.headers['x-codescope-office'] || ''), 'base64').toString('utf8')); }
      catch (_) { return send(res, 400, { ok:false, error:'上传信息格式错误' }); }
      const folder = officeSafeFolder(info && info.folder), base = path.basename(String(info && info.name || '')).trim(), ext = path.extname(base).toLowerCase();
      if (folder === null || !officePath(base) || !OFFICE_EXTS.has(ext)) return send(res, 400, { ok:false, error:'仅支持 DOCX、XLSX、XLS、CSV 和 PPTX 文件' });
      const target = uniqueOfficeTarget(folder, base), temp = path.join(path.dirname(target.file), '.' + crypto.randomUUID() + '.upload');
      try {
        const bytes = await officeStreamToFile(req, temp); validateOfficeFile(temp, ext); fs.renameSync(temp, target.file);
        return send(res, 200, { ok:true, path:target.path, name:target.name, kind:officeKind(target.name), size:bytes });
      } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} return send(res, error.statusCode || 400, { ok:false, error:'导入失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/save-stream') {
      let info;
      try { info = JSON.parse(Buffer.from(String(req.headers['x-codescope-office'] || ''), 'base64').toString('utf8')); }
      catch (_) { return send(res, 400, { ok:false, error:'保存信息格式错误' }); }
      const rel = officePath(info && info.path), ext = path.extname(String(rel || '')).toLowerCase();
      if (!rel || !['.xlsx', '.xls', '.csv'].includes(ext)) return send(res, 400, { ok:false, error:'当前只允许在 CodeScope 内保存表格文件' });
      const target = path.join(officeDir(), rel), temp = path.join(path.dirname(target), '.' + crypto.randomUUID() + '.saving');
      if (!fs.existsSync(target)) return send(res, 404, { ok:false, error:'要保存的表格不存在' });
      try {
        const bytes = await officeStreamToFile(req, temp); validateOfficeFile(temp, ext); fs.renameSync(temp, target);
        return send(res, 200, { ok:true, path:rel, size:bytes, updated:fs.statSync(target).mtimeMs });
      } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} return send(res, error.statusCode || 400, { ok:false, error:'保存失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/rename') {
      const b = await readBody(req), rel = officePath(b && b.path, true), rawName = String(b && b.name || '').trim();
      if (!rel || !rawName || /[\\/]/.test(rawName) || !/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&]+$/.test(rawName) || ['.', '..'].includes(rawName)) return send(res, 400, { ok:false, error:'名称不合法' });
      const source = path.join(officeDir(), rel); let stat; try { stat = fs.statSync(source); } catch (_) { return send(res, 404, { ok:false, error:'文件或文件夹不存在' }); }
      const parent = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
      let name = rawName;
      if (stat.isFile()) { const ext = path.extname(rel).toLowerCase(); name = rawName.replace(/\.(?:docx|xlsx|xls|csv|pptx)$/i, '') + ext; }
      const targetRel = parent ? parent + '/' + name : name, target = path.join(officeDir(), targetRel);
      if (targetRel === rel) return send(res, 200, { ok:true, path:rel, unchanged:true });
      if (fs.existsSync(target)) return send(res, 409, { ok:false, error:'同名文件或文件夹已存在' });
      try { fs.renameSync(source, target); return send(res, 200, { ok:true, path:targetRel }); }
      catch (error) { return send(res, 500, { ok:false, error:'重命名失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/move') {
      const b = await readBody(req), rel = officePath(b && b.path, true), toFolder = officeSafeFolder(b && b.toFolder);
      if (!rel || toFolder === null || toFolder === rel || toFolder.startsWith(rel + '/')) return send(res, 400, { ok:false, error:'移动路径不合法' });
      const source = path.join(officeDir(), rel), name = path.basename(rel); let stat; try { stat = fs.statSync(source); } catch (_) { return send(res, 404, { ok:false, error:'文件或文件夹不存在' }); }
      const dir = path.join(officeDir(), toFolder || '.'); fs.mkdirSync(dir, { recursive:true });
      let targetName = name, index = 2, ext = stat.isFile() ? path.extname(name) : '', stem = ext ? path.basename(name, ext) : name;
      while (fs.existsSync(path.join(dir, targetName))) { targetName = stem + '-' + index + ext; index += 1; }
      const targetRel = toFolder ? toFolder + '/' + targetName : targetName;
      if (targetRel === rel) return send(res, 200, { ok:true, path:rel, unchanged:true });
      try { fs.renameSync(source, path.join(dir, targetName)); return send(res, 200, { ok:true, path:targetRel }); }
      catch (error) { return send(res, 500, { ok:false, error:'移动失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/delete') {
      const b = await readBody(req), rel = officePath(b && b.path, true);
      if (!rel) return send(res, 400, { ok:false, error:'删除路径不合法' });
      const target = path.join(officeDir(), rel);
      try { const stat = fs.statSync(target); stat.isDirectory() ? fs.rmSync(target, { recursive:true }) : fs.unlinkSync(target); return send(res, 200, { ok:true, path:rel }); }
      catch (error) { return send(res, 404, { ok:false, error:'删除失败：文件不存在或已被占用' }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/tree') {
      fs.mkdirSync(readingsDir(), { recursive:true });
      const root = readingTree();
      return send(res, 200, { ok:true, dir:readingsDir(), root, total:root.count });
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/search') {
      const query = String(u.searchParams.get('q') || '').trim();
      if (!query) return send(res, 200, { ok:true, hits:[] });
      if (query.length > 240) return send(res, 400, { ok:false, error:'搜索内容不能超过 240 个字符' });
      return send(res, 200, { ok:true, hits:searchReadingLibrary(query, u.searchParams.get('case') === '1') });
    }
    if (req.method === 'GET' && u.pathname === '/api/workspace/backlinks') {
      const kind = String(u.searchParams.get('kind') || ''), targetPath = String(u.searchParams.get('path') || '');
      if (!['code','pdf','note'].includes(kind) || !targetPath || targetPath.length > 4096) return send(res, 400, { ok:false, error:'反向链接目标不合法' });
      const fragmentRaw = u.searchParams.get('fragment'), fragment = fragmentRaw == null ? NaN : Number(fragmentRaw);
      return send(res, 200, { ok:true, kind, path:targetPath, fragment:Number.isFinite(fragment) ? fragment : null, hits:workspaceBacklinks(kind, targetPath, fragment) });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/folder') {
      const b = await readBody(req);
      const parent = b.parent ? readingPath(String(b.parent), true) : '';
      const name = readingPath(String(b.name || ''), true);
      if ((b.parent && !parent) || !name || name.includes('/')) return send(res, 400, { ok:false, error:'文件夹名称或位置不合法' });
      const rel = parent ? parent + '/' + name : name;
      fs.mkdirSync(path.join(readingsDir(), rel), { recursive:true });
      fs.writeFileSync(path.join(readingsDir(),rel,READING_FOLDER_META),JSON.stringify({version:1,updatedAt:Date.now()},null,2),'utf8');
      return send(res, 200, { ok:true, path:rel });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/project/new') {
      const b=await readBody(req),parent=b.parent?readingPath(String(b.parent),true):'',name=readingPath(String(b.name||''),true);
      if((b.parent&&!parent)||!name||name.includes('/'))return send(res,400,{ok:false,error:'阅读项目名称或位置不合法'});const rel=parent?parent+'/'+name:name,target=path.join(readingsDir(),rel);if(fs.existsSync(target))return send(res,409,{ok:false,error:'同名阅读项目已存在'});
      fs.mkdirSync(target,{recursive:true});const meta=saveReadingProjectMeta(rel,{description:b.description,tags:b.tags});return send(res,200,{ok:true,path:rel,meta});
    }
    if (u.pathname === '/api/readings/project/meta') {
      if(req.method==='GET'){const project=readingPath(u.searchParams.get('project'),true);if(!project)return send(res,400,{ok:false,error:'阅读项目路径不合法'});return send(res,200,{ok:true,project,meta:loadReadingProjectMeta(project)});}
      if(req.method==='POST'){const b=await readBody(req),project=readingPath(String(b.project||''),true);if(!project)return send(res,400,{ok:false,error:'阅读项目路径不合法'});return send(res,200,{ok:true,project,meta:saveReadingProjectMeta(project,b)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/folder/rename') {
      const b=await readBody(req),from=readingPath(String(b.folder||''),true),name=readingPath(String(b.name||''),true);if(!from||!name||name.includes('/'))return send(res,400,{ok:false,error:'阅读文件夹名称不合法'});const parent=path.posix.dirname(from)==='.'?'':path.posix.dirname(from),to=parent?parent+'/'+name:name,source=path.join(readingsDir(),from),target=path.join(readingsDir(),to);if(fs.existsSync(target))return send(res,409,{ok:false,error:'同名文件夹已存在'});
      const pdfs=[];const scan=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(dir,e.name),rel);else if(/\.pdf$/i.test(e.name))pdfs.push(rel);}};try{scan(source,from);fs.renameSync(source,target);for(const oldRel of pdfs)moveReadingMeta(oldRel,to+oldRel.slice(from.length));return send(res,200,{ok:true,path:to});}catch(error){return send(res,500,{ok:false,error:'阅读文件夹重命名失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/folder/delete') {
      const b=await readBody(req),folder=readingPath(String(b.folder||''),true);if(!folder)return send(res,400,{ok:false,error:'阅读文件夹路径不合法'});const dir=path.join(readingsDir(),folder),pdfs=[];const scan=(current,prefix)=>{for(const e of fs.readdirSync(current,{withFileTypes:true})){const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(current,e.name),rel);else if(/\.pdf$/i.test(e.name))pdfs.push(rel);}};try{scan(dir,folder);fs.rmSync(dir,{recursive:true,force:false});for(const rel of pdfs)try{fs.unlinkSync(readingMetaFile(rel));}catch(_){}return send(res,200,{ok:true});}catch(error){return send(res,500,{ok:false,error:'删除阅读文件夹失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/node/move') {
      const b=await readBody(req),type=String(b.type||''),from=readingPath(String(b.path||''),true),toFolder=b.toFolder?readingPath(String(b.toFolder),true):'';
      if(!['folder','project'].includes(type)||!from||(b.toFolder&&!toFolder))return send(res,400,{ok:false,error:'阅读节点或目标文件夹路径不合法'});if(type==='folder'&&toFolder&&(toFolder===from||toFolder.startsWith(from+'/')))return send(res,400,{ok:false,error:'不能把文件夹移动到自身或子文件夹中'});
      const source=path.join(readingsDir(),from);if(!fs.existsSync(source)||!fs.statSync(source).isDirectory())return send(res,404,{ok:false,error:'待移动的阅读项目或文件夹不存在'});if(toFolder){const parent=path.join(readingsDir(),toFolder);if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())return send(res,404,{ok:false,error:'目标阅读文件夹不存在'});}
      const base=path.posix.basename(from),to=toFolder?toFolder+'/'+base:base;if(to===from)return send(res,200,{ok:true,path:from,unchanged:true});const target=path.join(readingsDir(),to);if(fs.existsSync(target))return send(res,409,{ok:false,error:'目标位置已有同名项目或文件夹'});
      const pdfs=[];const scan=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(dir,e.name),rel);else if(/\.pdf$/i.test(e.name))pdfs.push(rel);}};try{scan(source,from);fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(source,target);for(const oldRel of pdfs)moveReadingMeta(oldRel,to+oldRel.slice(from.length));return send(res,200,{ok:true,path:to});}catch(error){return send(res,500,{ok:false,error:'移动失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/text/new') {
      const b=await readBody(req), project=readingPath(String(b.project||''),true), name=path.basename(String(b.name||'')).trim();
      if(!project||!name||!READING_TEXT_EXTS.has(path.extname(name).toLowerCase())||!readingAssetPath(project+'/'+name))return send(res,400,{ok:false,error:'阅读项目或片段文件名不合法'});
      const dir=path.join(readingsDir(),project);fs.mkdirSync(dir,{recursive:true});let target=path.join(dir,name);
      if(fs.existsSync(target))return send(res,409,{ok:false,error:'同名片段已存在'});
      const ext=path.extname(name).toLowerCase();const content=['.md','.markdown'].includes(ext)?'# '+name.replace(/\.[^.]+$/,'')+'\n\n':'// '+name+'\n';
      fs.writeFileSync(target,content,'utf8');return send(res,200,{ok:true,path:project+'/'+name,kind:['.md','.markdown'].includes(ext)?'markdown':'code',content});
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/project/rename') {
      const b=await readBody(req),from=readingPath(String(b.project||''),true),name=readingPath(String(b.name||''),true);const parent=from&&(path.posix.dirname(from)==='.'?'':path.posix.dirname(from)),to=parent?parent+'/'+name:name;
      if(!from||!name||name.includes('/'))return send(res,400,{ok:false,error:'阅读项目名称不合法'});
      const source=path.join(readingsDir(),from),target=path.join(readingsDir(),to);if(fs.existsSync(target))return send(res,409,{ok:false,error:'同名阅读项目已存在'});
      const pdfs=[];const scan=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='.codescope')continue;const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(dir,e.name),rel);else if(/\.pdf$/i.test(e.name))pdfs.push(rel);}};
      try{scan(source,from);fs.renameSync(source,target);for(const oldRel of pdfs)moveReadingMeta(oldRel,to+oldRel.slice(from.length));return send(res,200,{ok:true,project:to});}catch(error){return send(res,500,{ok:false,error:'阅读项目重命名失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/project/delete') {
      const b=await readBody(req),project=readingPath(String(b.project||''),true);if(!project)return send(res,400,{ok:false,error:'阅读项目名称不合法'});
      const dir=path.join(readingsDir(),project),pdfs=[];const scan=(folder,prefix)=>{for(const e of fs.readdirSync(folder,{withFileTypes:true})){const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(folder,e.name),rel);else if(/\.pdf$/i.test(e.name))pdfs.push(rel);}};
      try{scan(dir,project);fs.rmSync(dir,{recursive:true,force:false});for(const rel of pdfs)try{fs.unlinkSync(readingMetaFile(rel));}catch(_){}return send(res,200,{ok:true});}catch(error){return send(res,500,{ok:false,error:'删除阅读项目失败：'+String(error.message||error)});}
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/text-fragment') {
      const rel=readingAssetPath(u.searchParams.get('path'));
      if(!rel||!READING_TEXT_EXTS.has(path.extname(rel).toLowerCase()))return send(res,400,{ok:false,error:'文本片段路径不合法'});
      try{const stat=fs.statSync(path.join(readingsDir(),rel));if(stat.size>8*1024*1024)return send(res,413,{ok:false,error:'文本片段超过 8 MB'});return send(res,200,{ok:true,path:rel,content:fs.readFileSync(path.join(readingsDir(),rel),'utf8')});}
      catch(_){return send(res,404,{ok:false,error:'文本片段不存在'});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/text-fragment') {
      const b=await readBody(req,12e6),rel=readingAssetPath(b.path);
      if(!rel||!READING_TEXT_EXTS.has(path.extname(rel).toLowerCase()))return send(res,400,{ok:false,error:'文本片段路径不合法'});
      const content=String(b.content==null?'':b.content);if(Buffer.byteLength(content)>8*1024*1024)return send(res,413,{ok:false,error:'文本片段超过 8 MB'});
      try{fs.writeFileSync(path.join(readingsDir(),rel),content,'utf8');return send(res,200,{ok:true,size:Buffer.byteLength(content)});}catch(error){return send(res,500,{ok:false,error:'保存失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/upload-stream') {
      let info;
      try { info = JSON.parse(Buffer.from(String(req.headers['x-codescope-reading'] || ''), 'base64').toString('utf8')); }
      catch (_) { return send(res, 400, { ok:false, error:'上传信息格式错误' }); }
      const folder = info.folder ? readingPath(String(info.folder), true) : '';
      let base = path.basename(String(info.name || '')).trim();
      if ((info.folder && !folder) || !/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&]+\.pdf$/i.test(base)) return send(res, 400, { ok:false, error:'仅支持合法的 PDF 文件名和文库目录' });
      const dir = path.join(readingsDir(), folder || '.'); fs.mkdirSync(dir, { recursive:true });
      const stem = base.replace(/\.pdf$/i, ''); let target = path.join(dir, base), index = 2;
      while (fs.existsSync(target)) { base = stem + '-' + index + '.pdf'; target = path.join(dir, base); index += 1; }
      const temp = path.join(dir, '.' + crypto.randomUUID() + '.upload');
      try {
        await pipeline(req, fs.createWriteStream(temp, { flags:'wx' }));
        const head = Buffer.alloc(5); const fd = fs.openSync(temp, 'r'); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd);
        if (head.toString('ascii') !== '%PDF-') throw new Error('文件不是有效的 PDF');
        fs.renameSync(temp, target);
        const rel = (folder ? folder + '/' : '') + base;
        return send(res, 200, { ok:true, path:rel, size:fs.statSync(target).size });
      } catch (error) {
        try { fs.unlinkSync(temp); } catch (_) {}
        return send(res, 400, { ok:false, error:'导入失败：' + String(error.message || error) });
      }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/file') {
      const rel = readingPath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      const file = path.join(readingsDir(), rel);
      let stat; try { stat = fs.statSync(file); } catch (_) { return send(res, 404, { ok:false, error:'PDF 不存在' }); }
      const range = req.headers.range;
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'private, no-cache');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) { res.writeHead(416, { 'Content-Range':'bytes */' + stat.size }); return res.end(); }
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range':'bytes */' + stat.size }); return res.end(); }
        res.writeHead(206, { 'Content-Range':`bytes ${start}-${end}/${stat.size}`, 'Content-Length':end-start+1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Length':stat.size }); return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/text') {
      const rel = readingPath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      try {
        const pages = await extractPdfPages(path.join(readingsDir(), rel));
        return send(res, 200, { ok:true, path:rel, pages, pageCount:pages.length });
      } catch (error) { return send(res, 500, { ok:false, error:'PDF 文本解析失败：' + String(error.message || error).slice(0, 300) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/annotations') {
      const rel = readingAssetPath(u.searchParams.get('path'));
      if (!rel || !/\.pdf$/i.test(rel)) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      return send(res, 200, { ok:true, ...loadReadingAnnotations(rel) });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/annotations') {
      const b = await readBody(req, 25e6); const rel = readingAssetPath(b && b.path);
      if (!rel || !/\.pdf$/i.test(rel)) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      try { return send(res, 200, { ok:true, ...saveReadingAnnotations(rel, b) }); }
      catch (error) { return send(res, 500, { ok:false, error:'标注保存失败：' + String(error.message || error).slice(0, 300) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/meta') {
      const rel = readingPath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      return send(res, 200, { ok:true, meta:loadReadingMeta(rel) });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/meta') {
      const b = await readBody(req, 25e6); const rel = readingPath(b.path);
      if (!rel) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      try { return send(res, 200, { ok:true, meta:saveReadingMeta(rel, b.meta) }); }
      catch (error) { return send(res, 500, { ok:false, error:'阅读记录保存失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/rename') {
      const b = await readBody(req); const rel = readingAssetPath(b.path);
      const nextBase = path.basename(String(b.name || '')).trim();
      if (!rel || !readingAssetPath((path.dirname(rel)==='.'?'':path.dirname(rel)+'/')+nextBase)) return send(res, 400, { ok:false, error:'文件名或类型不合法' });
      const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel).split(path.sep).join('/');
      const next = dir ? dir + '/' + nextBase : nextBase;
      if (next !== rel && fs.existsSync(path.join(readingsDir(), next))) return send(res, 409, { ok:false, error:'目标文件已存在' });
      try { fs.renameSync(path.join(readingsDir(), rel), path.join(readingsDir(), next)); if(/\.pdf$/i.test(rel))moveReadingMeta(rel, next); return send(res, 200, { ok:true, path:next }); }
      catch (error) { return send(res, 500, { ok:false, error:'重命名失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/delete') {
      const b = await readBody(req); const rel = readingAssetPath(b.path);
      if (!rel) return send(res, 400, { ok:false, error:'片段路径不合法' });
      try { fs.unlinkSync(path.join(readingsDir(), rel)); if(/\.pdf$/i.test(rel))try { fs.unlinkSync(readingMetaFile(rel)); } catch (_) {} return send(res, 200, { ok:true }); }
      catch (error) { return send(res, 500, { ok:false, error:'删除失败：' + String(error.message || error) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/env') {
      const force = u.searchParams.get('refresh') === '1';
      const detected = await getEnv(force);
      const env = detected.tools;
      const runtime = runtimeReadiness();
      const onlyOffice = force ? await onlyOfficeHealth() : null;
      runtime.onlyoffice = {
        key:'onlyoffice', label:'ONLYOFFICE Docs', for:'DOCX、XLSX 与 PPTX 完整编辑', group:'Office 集成',
        available:!!(onlyOffice && onlyOffice.ok), installed:!!(onlyOffice && onlyOffice.ok), required:false,
        version:onlyOffice && onlyOffice.ok ? '在线' : '', path:ONLYOFFICE_PUBLIC_URL,
        issue:onlyOffice ? (onlyOffice.ok ? '' : '服务未启动，Office 将使用本地兼容模式') : '点击“重新检测”验证服务',
        hint:'可选：启动 ONLYOFFICE Document Server，并通过 CODESCOPE_ONLYOFFICE_URL 指定地址', installable:false,
      };
      const all = [...Object.values(runtime), ...Object.values(env)];
      const required = all.filter((e) => e.required);
      const missing = all.filter((e) => !e.available).length;
      const requiredMissing = required.filter((e) => !e.available).length;
      const total = all.length;
      for (const e of all) e.hint = installHint(e.key); // 按当前平台给安装提示
      const system = platformInfo();
      send(res, 200, {
        env, runtime, version:APP_VERSION, mode:APP_MODE, node:process.version,
        summary: {
          total, missing, ready: total - missing, ok: requiredMissing === 0,
          required: required.length, requiredMissing, requiredReady: required.length - requiredMissing,
          optionalMissing: missing - requiredMissing,
        },
        project: { languages: detected.project.languages, tools: [...detected.project.keys] },
        deployment: deploymentInfo(env, detected.project.keys),
        vault: (() => { try { return vaultPath(); } catch (e) { return String(e.message); } })(),
        platform: system.label + ' · ' + system.arch,
        system,
      });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/latex/resource/raw') {
      let resource;
      try { resource = resolveLatexResource(u.searchParams.get('path')); }
      catch (e) { return send(res, 404, { ok: false, error: e.message }); }
      const data = fs.readFileSync(resource.full);
      const displayName = path.basename(resource.full).replace(/["\r\n]/g, '');
      const asciiName = ('resource' + resource.ext).replace(/[^\x20-\x7e]/g, '');
      const encodedName = encodeURIComponent(displayName).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      res.writeHead(200, { 'Content-Type': MIME[resource.ext] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodedName });
      res.end(data); return;
    }
    if (req.method === 'GET' && u.pathname === '/api/latex/resource') {
      let resource;
      try { resource = resolveLatexResource(u.searchParams.get('path')); }
      catch (e) { return send(res, 404, { ok: false, error: e.message }); }
      const stat = fs.statSync(resource.full);
      if (!LATEX_TEXT_EXTS.has(resource.ext)) return send(res, 200, { ok: true, path: resource.rel, kind: resource.kind, ext: resource.ext, size: stat.size, text: false });
      if (stat.size > 2 * 1024 * 1024) return send(res, 413, { ok: false, error: '文本资源超过 2 MB，无法在线编辑' });
      return send(res, 200, { ok: true, path: resource.rel, kind: resource.kind, ext: resource.ext, size: stat.size, text: true, content: fs.readFileSync(resource.full, 'utf8') });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/save') {
      const b = await readBody(req); let resource;
      try { resource = resolveLatexResource(b.path, true); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      if (!LATEX_TEXT_EXTS.has(resource.ext)) return send(res, 400, { ok: false, error: '该资源不是可编辑文本' });
      const content = String(b.content == null ? '' : b.content);
      if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) return send(res, 413, { ok: false, error: '文本资源超过 2 MB' });
      fs.mkdirSync(path.dirname(resource.full), { recursive: true });
      fs.writeFileSync(resource.full, content, 'utf8');
      return send(res, 200, { ok: true, path: resource.rel, size: Buffer.byteLength(content, 'utf8') });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/upload') {
      const b = await readBody(req);
      const folder = String(b.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const name = path.basename(String(b.name || '')).replace(/[\x00-\x1f]/g, '');
      if (!folder || !name || name === '.' || name === '..') return send(res, 400, { ok: false, error: '上传路径不合法' });
      let resource;
      try { resource = resolveLatexResource(folder + '/' + name, true); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      const encoded = String(b.data || '').replace(/^data:[^,]*,/, '');
      let data; try { data = Buffer.from(encoded, 'base64'); } catch (_) { return send(res, 400, { ok: false, error: '文件数据无效' }); }
      if (!data.length || data.length > 30 * 1024 * 1024) return send(res, 413, { ok: false, error: '资源文件必须在 30 MB 以内' });
      fs.mkdirSync(path.dirname(resource.full), { recursive: true });
      fs.writeFileSync(resource.full, data);
      return send(res, 200, { ok: true, path: resource.rel, size: data.length, replaced: !!b.replace });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/rename') {
      const b = await readBody(req); let source;
      try { source = resolveLatexResource(b.path); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      let name = path.basename(String(b.name || '').trim()).replace(/[\x00-\x1f]/g, '');
      if (!name || name === '.' || name === '..' || name !== String(b.name || '').trim()) return send(res, 400, { ok: false, error: '文件名不合法' });
      // 只输入主文件名时保留原扩展名，避免图片重命名后意外失去格式。
      if (!path.extname(name)) name += source.ext;
      if (path.extname(name).toLowerCase() !== source.ext) return send(res, 400, { ok: false, error: '重命名不能改变文件格式，请保留 ' + source.ext + ' 扩展名' });
      let target;
      try { target = resolveLatexResource(path.posix.dirname(source.rel) + '/' + name, true); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      if (path.resolve(source.full) === path.resolve(target.full)) return send(res, 200, { ok: true, path: source.rel, name: path.basename(source.rel) });
      if (fs.existsSync(target.full)) return send(res, 409, { ok: false, error: '同一目录已存在同名资源' });
      try { fs.renameSync(source.full, target.full); }
      catch (e) { return send(res, 500, { ok: false, error: '重命名失败: ' + e.message }); }
      return send(res, 200, { ok: true, path: target.rel, name });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/move') {
      const b = await readBody(req); let source;
      try { source = resolveLatexResource(b.path); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      const toFolder = String(b.toFolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      let target;
      try { target = resolveLatexResource(toFolder + '/' + path.basename(source.rel), true); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      if (target.kind !== source.kind) return send(res, 400, { ok: false, error: '资源只能移动到同类型目录（' + source.kind + '）' });
      if (path.resolve(source.full) === path.resolve(target.full)) return send(res, 200, { ok: true, path: source.rel });
      if (fs.existsSync(target.full)) return send(res, 409, { ok: false, error: '目标目录已存在同名资源' });
      fs.mkdirSync(path.dirname(target.full), { recursive: true });
      try { fs.renameSync(source.full, target.full); }
      catch (e) { return send(res, 500, { ok: false, error: '移动失败: ' + e.message }); }
      return send(res, 200, { ok: true, path: target.rel });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/compile') {
      const b = await readBody(req);
      if (typeof b.code !== 'string') return send(res, 400, { ok: false, error: '缺少 LaTeX 源码' });
      if (Buffer.byteLength(b.code, 'utf8') > 1024 * 1024) return send(res, 413, { ok: false, error: 'LaTeX 文档超过 1 MB，无法实时编译' });
      return send(res, 200, await compileLatex(b.code, b.file));
    }
    if (req.method === 'POST' && u.pathname === '/api/run') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      const runner = runnerFor(frag.language);
      if (!runner.supported) return send(res, 200, { ok: false, unsupported: true, reason: runner.reason });
      // 编辑模式：用前端传来的 code 覆盖磁盘内容（无需先保存）
      const code = b.code != null ? b.code : frag.code;
      const files = snip.fragments.map((f, i) => ({ filename: f.filename, code: (i === b.fragment && b.code != null) ? b.code : f.code }));
      const r = await runner.run(code, {
        input: b.input || '',
        selIndex: b.fragment,
        files,
      });
      return send(res, 200, { ok: true, ...r });
    }
    if (req.method === 'POST' && u.pathname === '/api/check') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      const runner = runnerFor(frag.language);
      if (!runner.supported) return send(res, 200, { ok: false, unsupported: true, reason: runner.reason });
      const code = b.code != null ? b.code : frag.code;
      const files = snip.fragments.map((f, i) => ({ filename: f.filename, code: (i === b.fragment && b.code != null) ? b.code : f.code }));
      const r = await runner.check(code, {
        selIndex: b.fragment,
        files,
      });
      return send(res, 200, { ok: true, ...r });
    }
    if (req.method === 'POST' && u.pathname === '/api/format') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      const fspec = FORMATTERS[(frag.language || '').toLowerCase()];
      if (!fspec) {
        const supported = Object.keys(FORMATTERS).join(' / ');
        return send(res, 200, { ok: false, reason: '该语言暂不支持格式化：' + frag.language + '（支持: ' + supported + '）' });
      }
      const { tools: env } = await getEnv();
      if (!env[fspec.key] || !env[fspec.key].available) {
        return send(res, 200, { ok: false, formatter: fspec.name, reason: missingReason(fspec.key, env[fspec.key]) });
      }
      const code = b.code != null ? b.code : frag.code;
      const fr = fspec.format ? await fspec.format(code) : await formatWithPrettier(fspec.prettier, code);
      if (!fr.ok) return send(res, 200, { ok: false, formatter: fspec.name, reason: fr.reason });
      // 编辑模式（writeBack:false）：只返回格式化结果，由前端更新编辑框，不写盘
      if (b.writeBack === false) {
        return send(res, 200, { ok: true, formatter: fspec.name, formatted: fr.formatted, written: false, message: '已格式化（编辑模式，自动保存会立即写回 vault）' });
      }
      const written = writeBackFragment(b.file, frag, fr.formatted.replace(/\n+$/, ''));
      return send(res, 200, {
        ok: true, formatter: fspec.name, formatted: fr.formatted, written,
        message: written
          ? '已用 ' + fspec.name + ' 格式化并写回 vault（massCode 会实时同步）'
          : fspec.name + ' 格式化完成（未能自动写回，请手动复制）',
      });
    }
    if (req.method === 'POST' && u.pathname === '/api/save') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      if (typeof b.code !== 'string') return send(res, 400, { ok: false, error: '缺少 code' });
      const nextCode = b.code.replace(/\n+$/, '');
      if (nextCode === String(frag.code || '').replace(/\n+$/, '')) {
        return send(res, 200, { ok: true, written: false, unchanged: true, message: '内容未变化' });
      }
      const written = writeBackFragment(b.file, frag, nextCode);
      // 保存成功后记录“覆盖前”的内容，保证时间线第一项就能真正撤回本次编辑。
      if (written) recordTimeline(b.file, b.fragment, frag.code, '自动保存');
      return send(res, 200, { ok: written, written, message: written ? '已保存到 vault（massCode 会实时同步）' : '保存失败：未能定位片段代码块' });
    }
    if (req.method === 'POST' && u.pathname === '/api/reorder') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const r = reorderFragments(b.file, b.order);
      return send(res, 200, { ok: r.ok, error: r.error, message: r.ok ? '片段顺序已调整（massCode 会实时同步）' : undefined });
    }
    /* ------------------------------ 文件系统：新建/移动 ------------------------------ */
    if (req.method === 'POST' && u.pathname === '/api/fs/mkdir') {
      const b = await readBody(req);
      const rel = String(b.path || '').replace(/^\/+|\/+$/g, '');
      if (!rel || rel.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return send(res, 200, { ok: false, error: '文件夹路径不合法' });
      const defaultLanguage = String(b.defaultLanguage || 'plain_text').trim() || 'plain_text';
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = path.join(codeRoot, rel);
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      if (fs.existsSync(dir)) return send(res, 200, { ok: false, error: '文件夹已存在' });
      fs.mkdirSync(dir, { recursive: true });
      const st = readState();
      const now = Date.now();
      // 每层新建目录都写 .meta.yaml 并注册（父层级联创建时也必须有元数据，否则 id 为 null）
      const segs = rel.split('/');
      for (let i = 0; i < segs.length; i++) {
        const subRel = segs.slice(0, i + 1).join('/');
        const metaPath = path.join(codeRoot, subRel, '.meta.yaml');
        if (fs.existsSync(metaPath)) continue;   // 已有元数据的层跳过（保留原 orderIndex 等）
        let fid = st.folderIdByPath[subRel];
        if (!fid) {
          fid = ++st.counters.folderId;
          st.folderIdByPath[subRel] = fid;
          st.folderUi[fid] = { isOpen: 1 };
        }
        fs.writeFileSync(metaPath,
          `id: ${fid}\ncreatedAt: ${now}\ndefaultLanguage: ${i === segs.length - 1 ? defaultLanguage : 'plain_text'}\nicon: null\nname: ${segs[i]}\norderIndex: 0\nupdatedAt: ${now}\n`, 'utf8');
      }
      writeState(st);
      return send(res, 200, { ok: true, folder: rel, id: st.folderIdByPath[rel] });
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/newfile') {
      const b = await readBody(req);
      const folder = String(b.folder || '').replace(/^\/+|\/+$/g, '');
      const name = String(b.name || '').trim().replace(/\.md$/i, '').replace(/[:]/g, '：');   // 冒号会破坏 frontmatter
      if (!name || name.includes('/') || name.includes('\\')) return send(res, 200, { ok: false, error: '文件名不合法' });
      const language = String(b.language || 'plain_text').trim() || 'plain_text';
      const description = (b.description === undefined || b.description === null) ? '' : String(b.description).trim();
      const tagNames = Array.isArray(b.tags) ? b.tags.map(String) : [];
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = folder ? path.join(codeRoot, folder) : codeRoot;
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      fs.mkdirSync(dir, { recursive: true });
      const full = path.join(dir, name + '.md');
      if (fs.existsSync(full)) return send(res, 200, { ok: false, error: '文件已存在' });
      const st = readState();
      let fid = st.folderIdByPath[folder] || 0;
      if (folder && !fid) {
        fid = ++st.counters.folderId;
        st.folderIdByPath[folder] = fid;
        st.folderUi[fid] = { isOpen: 1 };
      }
      const tagIds = syncTags(st, tagNames);
      const sid = ++st.counters.snippetId;
      const cid = ++st.counters.contentId;
      const now = Date.now();
      const filePath = folder ? folder + '/' + name + '.md' : name + '.md';
      const contentLabel = language === 'latex' ? name + '.tex' : name;
      const initialCode = language === 'latex' ? (b.latexProject ? latexProjectStarter() : latexStarter()) : '';
      const md = '---\n' +
        'contents:\n' +
        '  - id: ' + cid + '\n' +
        '    label: ' + contentLabel + '\n' +
        '    language: ' + language + '\n' +
        'createdAt: ' + now + '\n' +
        'description: ' + (description ? JSON.stringify(description) : '""') + '\n' +
        'folderId: ' + (fid || 0) + '\n' +
        'id: ' + sid + '\n' +
        'isDeleted: 0\n' +
        'isFavorites: 0\n' +
        'name: ' + name + '\n' +
        (tagIds.length ? 'tags:\n' + tagIds.map((t) => '  - ' + t).join('\n') + '\n' : 'tags:\n') +
        'updatedAt: ' + now + '\n' +
        '---\n' +
        '\n## Fragment: ' + contentLabel + '\n' +
        '```' + language + '\n' +
        initialCode + '\n```\n';
      fs.writeFileSync(full, md, 'utf8');
      st.snippets.push({
        filePath, id: sid,
        meta: {
          contents: [{ id: cid, label: contentLabel, language }],
          createdAt: now, description: description || null, folderId: fid || 0, isDeleted: 0, isFavorites: 0,
          mtimeMs: now, name, size: Buffer.byteLength(md), tags: tagIds, updatedAt: now,
        },
      });
      writeState(st);
      return send(res, 200, { ok: true, file: full, snippetId: sid, folder, tags: tagIds, language });
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/move') {
      const b = await readBody(req);
      const file = String(b.file || '');
      const toFolder = String(b.toFolder || '').replace(/^\/+|\/+$/g, '');
      if (!file || toFolder.split('/').some((seg) => seg === '.' || seg === '..')) return send(res, 200, { ok: false, error: '参数不合法' });
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === path.resolve(file));
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      const destDir = toFolder ? path.join(codeRoot, toFolder) : codeRoot;
      if (destDir !== codeRoot && !destDir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      const fname = path.basename(snip.filePath);
      const destFull = path.join(destDir, fname);
      if (path.resolve(file) === path.resolve(destFull)) return send(res, 200, { ok: true, file, folder: toFolder }); // 没动
      if (fs.existsSync(destFull)) return send(res, 200, { ok: false, error: '目标位置已存在同名文件' });
      fs.mkdirSync(destDir, { recursive: true });
      try { fs.renameSync(file, destFull); } catch (e) { return send(res, 200, { ok: false, error: '移动失败: ' + e.message }); }
      let fid = st.folderIdByPath[toFolder] || 0;
      if (toFolder && !fid) {
        fid = ++st.counters.folderId;
        st.folderIdByPath[toFolder] = fid;
        st.folderUi[fid] = { isOpen: 1 };
      }
      snip.filePath = toFolder ? toFolder + '/' + fname : fname;
      snip.meta.folderId = fid || 0;
      writeState(st);
      // 同步 .md frontmatter 的 folderId
      try {
        const text = fs.readFileSync(destFull, 'utf8');
        const updated = text.replace(/^folderId:\s*.*$/m, 'folderId: ' + (fid || 0));
        if (updated !== text) fs.writeFileSync(destFull, updated, 'utf8');
      } catch (_) {}
      return send(res, 200, { ok: true, file: destFull, folder: toFolder });
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/move-folder') {
      const b = await readBody(req);
      const folder = String(b.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const toFolder = String(b.toFolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const invalid = (value, allowEmpty) => !value ? !allowEmpty : value.split('/').some((seg) => !seg || seg === '.' || seg === '..');
      if (invalid(folder, false) || invalid(toFolder, true)) return send(res, 400, { ok: false, error: '文件夹路径不合法' });
      if (toFolder === folder || toFolder.startsWith(folder + '/')) return send(res, 400, { ok: false, error: '不能把文件夹移动到自身内部' });
      const codeRoot = path.resolve(path.join(vaultPath(), 'code'));
      const source = path.resolve(codeRoot, folder);
      const destParent = toFolder ? path.resolve(codeRoot, toFolder) : codeRoot;
      const targetRel = (toFolder ? toFolder + '/' : '') + path.posix.basename(folder);
      const target = path.resolve(codeRoot, targetRel);
      if (!source.startsWith(codeRoot + path.sep) || (destParent !== codeRoot && !destParent.startsWith(codeRoot + path.sep)) || !target.startsWith(codeRoot + path.sep)) return send(res, 400, { ok: false, error: '路径越界' });
      if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return send(res, 404, { ok: false, error: '文件夹不存在' });
      if (!fs.existsSync(destParent) || !fs.statSync(destParent).isDirectory()) return send(res, 404, { ok: false, error: '目标文件夹不存在' });
      if (source === target) return send(res, 200, { ok: true, folder: targetRel });
      if (fs.existsSync(target)) return send(res, 409, { ok: false, error: '目标位置已存在同名文件夹' });
      try { fs.renameSync(source, target); }
      catch (e) { return send(res, 500, { ok: false, error: '移动文件夹失败: ' + e.message }); }
      const st = readState(), prefix = folder + '/';
      for (const snip of (st.snippets || [])) {
        if (snip.filePath && snip.filePath.startsWith(prefix)) snip.filePath = targetRel + '/' + snip.filePath.slice(prefix.length);
      }
      const mapped = {};
      for (const [key, id] of Object.entries(st.folderIdByPath || {})) {
        const next = key === folder ? targetRel : key.startsWith(prefix) ? targetRel + '/' + key.slice(prefix.length) : key;
        mapped[next] = id;
      }
      st.folderIdByPath = mapped;
      writeState(st);
      return send(res, 200, { ok: true, folder: targetRel, from: folder });
    }
    // 编辑片段信息：名称/类型(语言)/标签/说明（fragmentId 指定要改语言的分片，默认第一个）
    if (req.method === 'POST' && u.pathname === '/api/fs/update') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === path.resolve(String(b.file || '')));
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      let full = path.resolve(codeRoot, snip.filePath);
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      let text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.meta || !Array.isArray(fm.meta.contents) || !fm.meta.contents.length) return send(res, 200, { ok: false, error: 'frontmatter 解析失败' });
      const fragId = Number(b.fragmentId);
      const tgt = (fm.meta.contents.find((c) => String(c.id) === String(fragId)) || fm.meta.contents[0]);
      const folderPath = path.dirname(snip.filePath) === '.' ? '' : path.dirname(snip.filePath).split(path.sep).join('/');
      const now = Date.now();
      // 名称（重命名）
      if (b.name !== undefined) {
        const newName = String(b.name).trim().replace(/\.md$/i, '').replace(/[:]/g, '：');
        if (!newName) return send(res, 200, { ok: false, error: '文件名不能为空' });
        const oldName = fm.meta.name || path.basename(full, '.md');
        if (newName !== oldName) {
          if (newName.includes('/') || newName.includes('\\')) return send(res, 200, { ok: false, error: '文件名不合法' });
          const newFull = path.join(path.dirname(full), newName + '.md');
          if (newFull !== full && fs.existsSync(newFull)) return send(res, 200, { ok: false, error: '目标文件已存在' });
          if (newFull !== full) {
            try { fs.renameSync(full, newFull); } catch (e) { return send(res, 200, { ok: false, error: '重命名失败: ' + e.message }); }
          }
          full = newFull;
          snip.filePath = (folderPath ? folderPath + '/' : '') + newName + '.md';
          fm.meta.name = newName;
          tgt.label = newName;
        }
      }
      // 片段名（label）：只重命名【目标片段】，不改文件名、不影响其它片段
      if (b.label !== undefined) {
        const newLabel = String(b.label).trim();
        if (!newLabel) return send(res, 200, { ok: false, error: '片段名不能为空' });
        tgt.label = newLabel;
      }
      // 类型（语言）
      if (b.language !== undefined) {
        const lang = String(b.language).trim() || 'plain_text';
        tgt.language = lang;
      }
      // 说明
      if (b.description !== undefined) fm.meta.description = b.description === null ? '' : String(b.description).trim();
      // 标签（按名称，自动建新）
      if (Array.isArray(b.tags)) fm.meta.tags = syncTags(st, b.tags.map(String));
      // 同步正文：目标片段标题 label 与围栏语言（massCode 片段结构一致性）
      const tgtIdx = fm.meta.contents.indexOf(tgt);
      if (tgtIdx >= 0) {
        const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
        const headsPos = [];
        let hm;
        while ((hm = headingRe.exec(fm.body))) headsPos.push({ label: hm[1].trim(), start: hm.index, len: hm[0].length });
        if (headsPos[tgtIdx]) {
          const h = headsPos[tgtIdx];
          const changedHead = (b.name !== undefined || b.label !== undefined) && tgt.label !== h.label;
          let delta = 0;
          if (changedHead) {
            const newHead = '## Fragment: ' + tgt.label;
            fm.body = fm.body.slice(0, h.start) + newHead + fm.body.slice(h.start + h.len);
            delta = newHead.length - h.len;
          }
          if (b.language !== undefined) {
            const segStart0 = h.start + h.len + fm.body.slice(h.start + h.len).indexOf('\n') + 1;
            const segStart = segStart0 + delta;
            const segEnd = headsPos[tgtIdx + 1] ? headsPos[tgtIdx + 1].start + delta : fm.body.length;
            const seg = fm.body.slice(segStart, segEnd);
            const fence = /^```[^\n]*/m.exec(seg);
            if (fence) {
              const abs = segStart + fence.index;
              fm.body = fm.body.slice(0, abs) + '```' + tgt.language + fm.body.slice(abs + fence[0].length);
            }
          }
        }
      }
      // 写回 .md
      const newMd = stringifyFrontmatter(fm);
      fs.writeFileSync(full, newMd, 'utf8');
      // 同步 state.json
      const sm = snip.meta;
      if (b.name !== undefined && fm.meta.name) sm.name = fm.meta.name;
      if (b.language !== undefined) { sm.language = tgt.language; }
      const sic = sm.contents.find((c) => String(c.id) === String(fragId)) || sm.contents[0];
      if (b.language !== undefined) sic.language = tgt.language;
      if (b.name !== undefined && tgt.label) sic.label = tgt.label;
      if (b.label !== undefined && tgt.label) sic.label = tgt.label;
      if (b.description !== undefined) sm.description = fm.meta.description ? fm.meta.description : null;
      if (Array.isArray(b.tags)) sm.tags = fm.meta.tags;
      sm.mtimeMs = now; sm.updatedAt = now; sm.size = Buffer.byteLength(newMd);
      writeState(st);
      return send(res, 200, { ok: true, file: full, name: fm.meta.name, label: tgt.label, language: tgt.language, tags: fm.meta.tags, description: fm.meta.description });
    }
    // 新增片段：在当前文件末尾追加一个 Fragment（正文 + frontmatter contents + state.json 同步）
    if (req.method === 'POST' && u.pathname === '/api/fs/addfragment') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === path.resolve(String(b.file || '')));
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      const full = path.resolve(codeRoot, snip.filePath);
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      const language = String(b.language || 'plain_text').trim() || 'plain_text';
      const label = String(b.label || '').trim() || ('片段 ' + ((snip.meta.contents || []).length + 1));
      const text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.meta || !Array.isArray(fm.meta.contents)) return send(res, 200, { ok: false, error: 'frontmatter 解析失败' });
      const cid = ++st.counters.contentId;
      const now = Date.now();
      const newItem = { id: cid, label, language };
      fm.meta.contents.push(newItem);
      const bodyEnd = fm.body.replace(/\s+$/, '');
      fm.body = bodyEnd + '\n\n## Fragment: ' + label + '\n```' + language + '\n\n```\n';
      const newMd = stringifyFrontmatter(fm);
      fs.writeFileSync(full, newMd, 'utf8');
      snip.meta.contents.push(newItem);
      snip.meta.mtimeMs = now; snip.meta.updatedAt = now; snip.meta.size = Buffer.byteLength(newMd);
      writeState(st);
      return send(res, 200, { ok: true, file: full, fragment: newItem, index: fm.meta.contents.length - 1 });
    }
    // 删除片段：从正文移除对应 "## Fragment: xxx" 段 + frontmatter contents 移除 + state.json 同步
    if (req.method === 'POST' && u.pathname === '/api/fs/delfragment') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === path.resolve(String(b.file || '')));
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      const full = path.resolve(codeRoot, snip.filePath);
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      const fragId = Number(b.fragmentId);
      const text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.meta || !Array.isArray(fm.meta.contents) || !fm.meta.contents.length) return send(res, 200, { ok: false, error: 'frontmatter 解析失败' });
      const idx = fm.meta.contents.findIndex((c) => String(c.id) === String(fragId));
      if (idx < 0) return send(res, 200, { ok: false, error: '片段不存在' });
      if (fm.meta.contents.length <= 1) return send(res, 200, { ok: false, error: '文件至少保留一个片段（可删除整个文件）' });
      const removed = fm.meta.contents[idx];
      fm.meta.contents.splice(idx, 1);
      // 删除正文对应段：从 "## Fragment:" 标题行首 到 下一个标题行首（内容随标题一并移除）
      const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
      const headsPos = [];
      let hm;
      while ((hm = headingRe.exec(fm.body))) headsPos.push({ start: hm.index });
      if (headsPos[idx]) {
        const h = headsPos[idx];
        const segEnd = headsPos[idx + 1] ? headsPos[idx + 1].start : fm.body.length;
        fm.body = fm.body.slice(0, h.start) + fm.body.slice(segEnd);
        fm.body = fm.body.replace(/\n{3,}/g, '\n\n');
      }
      const newMd = stringifyFrontmatter(fm);
      fs.writeFileSync(full, newMd, 'utf8');
      const now = Date.now();
      snip.meta.contents = snip.meta.contents.filter((c) => String(c.id) !== String(fragId));
      snip.meta.mtimeMs = now; snip.meta.updatedAt = now; snip.meta.size = Buffer.byteLength(newMd);
      writeState(st);
      return send(res, 200, { ok: true, file: full, removed: removed, remaining: fm.meta.contents.length });
    }
    if (req.method === 'GET' && u.pathname === '/api/git') {
      return send(res, 200, await gitStatus());
    }
    if (req.method === 'GET' && u.pathname === '/api/git/diff') {
      try { return send(res, 200, await gitFileDiff(u.searchParams.get('path'))); }
      catch (e) { return send(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/timeline') {
      try {
        const file = u.searchParams.get('file'), fragment = Number(u.searchParams.get('fragment'));
        const snip = walkSnippets().find((item) => item.file === file);
        if (!snip || !snip.fragments[fragment]) return send(res, 404, { ok: false, error: '片段不存在' });
        const target = timelineTarget(file, fragment);
        return send(res, 200, { ok: true, file: target.relative, fragment, entries: timelineEntries(target) });
      } catch (e) { return send(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/timeline/item') {
      try {
        const file = u.searchParams.get('file'), fragment = Number(u.searchParams.get('fragment'));
        const snip = walkSnippets().find((item) => item.file === file);
        if (!snip || !snip.fragments[fragment]) return send(res, 404, { ok: false, error: '片段不存在' });
        return send(res, 200, await timelineItem(file, fragment, u.searchParams.get('id'), snip.fragments[fragment].code));
      } catch (e) { return send(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/timeline/restore') {
      const b = await readBody(req);
      try {
        const fragment = Number(b.fragment), snip = walkSnippets().find((item) => item.file === b.file);
        if (!snip || !snip.fragments[fragment]) return send(res, 404, { ok: false, error: '片段不存在' });
        const saved = await timelineItem(b.file, fragment, b.id, snip.fragments[fragment].code);
        recordTimeline(b.file, fragment, snip.fragments[fragment].code, '恢复前版本', true);
        const written = writeBackFragment(b.file, snip.fragments[fragment], saved.code.replace(/\n+$/, ''));
        if (!written) return send(res, 500, { ok: false, error: '恢复失败：未能定位片段代码块' });
        return send(res, 200, { ok: true, message: '已恢复历史版本', code: saved.code });
      } catch (e) { return send(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/delete') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const full = path.resolve(codeRoot, String(b.file || ''));
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === full);
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      // 从状态库移除
      st.snippets = st.snippets.filter((s) => s !== snip);
      // 清理不再被引用的标签
      const used = new Set();
      st.snippets.forEach((s) => (s.meta.tags || []).forEach((t) => used.add(t)));
      if (Array.isArray(st.tags)) st.tags = st.tags.filter((t) => used.has(t.id));
      writeState(st);
      // 删除磁盘上的 .md
      try { fs.unlinkSync(full); } catch (_) {}
      // 若所在叶子目录已空，清理该目录的 .meta.yaml 与空目录（保留根与上层）
      const dir = path.dirname(full);
      if (dir !== codeRoot && fs.existsSync(dir)) {
        const rest = fs.readdirSync(dir).filter((n) => n !== '.meta.yaml');
        if (rest.length === 0) {
          try { fs.unlinkSync(path.join(dir, '.meta.yaml')); } catch (_) {}
          try { fs.rmdirSync(dir); } catch (_) {}
          const st2 = readState();
          const rel = path.relative(codeRoot, dir).split(path.sep).join('/');
          const fid = st2.folderIdByPath[rel];
          if (fid !== undefined) {
            delete st2.folderIdByPath[rel];
            delete st2.folderUi[fid];
          }
          writeState(st2);
        }
      }
      return send(res, 200, { ok: true, file: full });
    }
    // 删除文件夹（含其下所有片段与子文件夹，双清：状态库 + 磁盘）
    if (req.method === 'POST' && u.pathname === '/api/fs/delete-folder') {
      const b = await readBody(req);
      const rel = String(b.folder || '').replace(/^\/+|\/+$/g, '');
      const segs = rel.split('/');
      if (!rel || segs.some((s) => !s || s === '.' || s === '..')) return send(res, 200, { ok: false, error: '文件夹路径不合法' });
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = path.join(codeRoot, rel);
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      if (!fs.existsSync(dir)) return send(res, 200, { ok: false, error: '文件夹不存在' });
      const prefix = rel + '/';
      const st = readState();
      const removed = st.snippets.filter((s) => s.filePath === rel || s.filePath.startsWith(prefix));
      st.snippets = st.snippets.filter((s) => !(s.filePath === rel || s.filePath.startsWith(prefix)));
      const delKeys = Object.keys(st.folderIdByPath || {}).filter((k) => k === rel || k.startsWith(prefix));
      for (const k of delKeys) {
        const fid = st.folderIdByPath[k];
        delete st.folderIdByPath[k];
        if (fid !== undefined && st.folderUi) delete st.folderUi[fid];
      }
      const used = new Set();
      st.snippets.forEach((s) => (s.meta.tags || []).forEach((t) => used.add(t)));
      if (Array.isArray(st.tags)) st.tags = st.tags.filter((t) => used.has(t.id));
      writeState(st);
      let disk = false;
      try { fs.rmSync(dir, { recursive: true, force: true }); disk = true; } catch (_) {}
      return send(res, 200, { ok: true, folder: rel, deletedSnippets: removed.length, removedFolders: delKeys.length, disk });
    }
    /* ------------------------------ 绘图（Excalidraw / Draw.io / XMind） ------------------------------ */
    function drawingsDir() { return path.join(vaultPath(), 'drawings'); }
    function drawingName(n) {
      if (typeof n !== 'string') return null;
      const base = n.split(/[\\/]/).map((s) => s.trim()).filter(Boolean).join('/');
      if (!base) return null;
      if (base.indexOf('\\') >= 0) return null;
      if (/(^|\/)\.{1,2}(\/|$)|^\/|\/\/|^[A-Za-z]:/.test(base)) return null;   // 防穿越：拒绝 ..、前导 /、//、盘符
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff /]+$/.test(base)) return null;          // 每段仅合法字符（保留中文/空格，分隔符允许 /）
      if (!/\.(?:excalidraw|drawio|xmind)$/i.test(base)) return null;
      return base;
    }
    function drawingKind(name) {
      const value = String(name || '');
      return /\.drawio$/i.test(value) ? 'drawio' : (/\.xmind$/i.test(value) ? 'xmind' : 'excalidraw');
    }
    function xmindId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 26); }
    function newXmindWorkbook(title) {
      return [{ id:xmindId(), class:'sheet', title:'画布 1', rootTopic:{ id:xmindId(), class:'topic', title:String(title || '中心主题'), structureClass:'org.xmind.ui.logic.right', children:{ attached:[] } } }];
    }
    function inspectXmindWorkbook(workbook) {
      if (!Array.isArray(workbook) || !workbook.length || workbook.length > 100) return { ok:false, error:'XMind 必须包含 1–100 个画布' };
      let nodes = 0;
      const walk = (topic, depth) => {
        if (!topic || typeof topic !== 'object' || Array.isArray(topic)) throw new Error('主题结构无效');
        if (depth > 128) throw new Error('主题层级超过 128 层');
        nodes += 1; if (nodes > 20000) throw new Error('主题数量超过 20000');
        if (topic.title != null && (typeof topic.title !== 'string' || topic.title.length > 20000)) throw new Error('主题标题无效');
        const children = topic.children && typeof topic.children === 'object' ? topic.children : {};
        for (const group of ['attached', 'detached', 'summary']) {
          const list = children[group];
          if (list != null && !Array.isArray(list)) throw new Error(group + ' 主题结构无效');
          for (const child of list || []) walk(child, depth + 1);
        }
      };
      try {
        for (const sheet of workbook) {
          if (!sheet || typeof sheet !== 'object' || !sheet.rootTopic) throw new Error('画布缺少根主题');
          walk(sheet.rootTopic, 1);
        }
      } catch (error) { return { ok:false, error:'XMind 结构错误：' + String(error.message || error) }; }
      return { ok:true, sheets:workbook.length, nodes };
    }
    function readXmindFile(file) {
      const entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
      if (!entries['content.json']) throw new Error('缺少 content.json，可能是旧版或加密 XMind 文件');
      const workbook = JSON.parse(strFromU8(entries['content.json']));
      const checked = inspectXmindWorkbook(workbook);
      if (!checked.ok) throw new Error(checked.error);
      const thumbnailBytes = entries['Thumbnails/thumbnail.png'];
      const thumbnail = thumbnailBytes && thumbnailBytes.length <= 15 * 1024 * 1024
        ? 'data:image/png;base64,' + Buffer.from(thumbnailBytes).toString('base64')
        : '';
      return { workbook, thumbnail, hasThumbnail:!!thumbnailBytes, ...checked };
    }
    function writeXmindFile(file, workbook) {
      const checked = inspectXmindWorkbook(workbook);
      if (!checked.ok) throw new Error(checked.error);
      let entries = {};
      try { if (fs.existsSync(file)) entries = unzipSync(new Uint8Array(fs.readFileSync(file))); } catch (_) { entries = {}; }
      entries['content.json'] = strToU8(JSON.stringify(workbook));
      if (!entries['metadata.json']) entries['metadata.json'] = strToU8(JSON.stringify({ creator:{ name:'CodeScope', version:APP_VERSION }, dataStructureVersion:'3' }));
      if (!entries['manifest.json']) entries['manifest.json'] = strToU8(JSON.stringify({ 'file-entries':{ 'content.json':{}, 'metadata.json':{} } }));
      const zipped = Buffer.from(zipSync(entries, { level:6 }));
      const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
      fs.writeFileSync(tmp, zipped);
      fs.renameSync(tmp, file);
      return { bytes:zipped.length, ...checked };
    }
    function inspectDrawioXml(value) {
      const xml = String(value || '').trim();
      if (!xml || xml.length > 40e6) return { ok:false, error:'Draw.io XML 为空或超过 40 MB' };
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { ok:false, error:'Draw.io XML 不允许包含 DOCTYPE 或外部实体' };
      if (xml[0] !== '<') return { ok:false, error:'不是 XML 文档' };
      let rootName = '', pages = 0;
      const ids = [], idSet = new Set(), refs = [];
      const parser = new SaxesParser({ xmlns:false });
      parser.on('opentag', (node) => {
        if (!rootName) rootName = node.name;
        if (node.name === 'diagram') pages += 1;
        if (node.name !== 'mxCell') return;
        const id = String(node.attributes.id || '');
        if (!id) throw new Error('存在缺少 id 的 mxCell');
        if (idSet.has(id)) throw new Error('存在重复的 mxCell id：' + id);
        idSet.add(id); ids.push(id);
        for (const name of ['parent', 'source', 'target']) {
          const ref = node.attributes[name];
          if (ref != null && String(ref)) refs.push({ id, name, value:String(ref) });
        }
      });
      try { parser.write(xml).close(); }
      catch (error) { return { ok:false, error:'Draw.io XML 语法错误：' + String(error.message || error).replace(/^\d+:\d+:\s*/, '').slice(0, 220) }; }
      if (!['mxfile', 'mxGraphModel'].includes(rootName)) return { ok:false, error:'根节点必须是 mxfile 或 mxGraphModel' };
      if (ids.length) {
        if (!idSet.has('0') || !idSet.has('1')) return { ok:false, error:'未找到 Draw.io 必需的根单元 id=0 和默认层 id=1' };
        for (const ref of refs) if (!idSet.has(ref.value)) return { ok:false, error:'mxCell ' + ref.id + ' 的 ' + ref.name + ' 引用了不存在的 id：' + ref.value };
      }
      return { ok:true, format:ids.length ? 'uncompressed' : 'compressed', cells:ids.length, pages:rootName === 'mxGraphModel' ? 1 : pages, bytes:Buffer.byteLength(xml, 'utf8') };
    }
    function drawingDir2(n) {   // 目录路径校验：允许 ''（根）或 'a/b'（防穿越）
      if (typeof n !== 'string') return '';
      const base = n.split(/[\\/]/).map((s) => s.trim()).filter(Boolean).join('/');
      if (!base) return '';
      if (base.indexOf('\\') >= 0) return null;
      if (/(^|\/)\.{1,2}(\/|$)|^\/|\/\/|^[A-Za-z]:/.test(base)) return null;
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff /]+$/.test(base)) return null;
      return base;
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/list') {
      const dir = drawingsDir();
      let out = [];
      try {
        if (fs.existsSync(dir)) {
          out = fs.readdirSync(dir)
            .filter((n) => drawingName(n))
            .map((n) => {
              try {
                const st = fs.statSync(path.join(dir, n));
                return { name: n, size: st.size, updated: st.mtimeMs };
              } catch (_) { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.updated - a.updated);
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, drawings: out });
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/tree') {
      const dir = drawingsDir();
      const root = { type: 'folder', name: '', path: '', children: [], count: 0 };
      const walk = (node, abs) => {
        let entries = [];
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) {}
        entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        let n = 0;
        for (const ent of entries) {
          if (ent.isDirectory()) {
            const rel = node.path ? node.path + '/' + ent.name : ent.name;
            const fnode = { type: 'folder', name: ent.name, path: rel, children: [], count: 0 };
            node.children.push(fnode);
            fnode.count = walk(fnode, path.join(abs, ent.name));
            n += fnode.count;
          } else if (drawingName(ent.name)) {
            const rel = node.path ? node.path + '/' + ent.name : ent.name;
            let size = 0, updated = 0;
            try { const st = fs.statSync(path.join(abs, ent.name)); size = st.size; updated = st.mtimeMs; } catch (_) {}
            node.children.push({ type: 'drawing', name: ent.name, path: rel, size, updated });
            n += 1;
          }
        }
        node.count = n;
        return n;
      };
      walk(root, dir);
      return send(res, 200, { ok: true, dir, root, total: root.count });
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/get') {
      const name = drawingName(u.searchParams.get('name'));
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        const target = path.join(drawingsDir(), name);
        if (drawingKind(name) === 'xmind') return send(res, 200, { ok:true, name, kind:'xmind', ...readXmindFile(target) });
        const raw = fs.readFileSync(target, 'utf8');
        if (drawingKind(name) === 'drawio') return send(res, 200, { ok: true, name, kind: 'drawio', xml: raw });
        const scene = JSON.parse(raw);
        return send(res, 200, { ok: true, name, kind: 'excalidraw', ...scene });
      } catch (error) { return send(res, 200, { ok: false, error: '读取失败（文件不存在或绘图格式无效）：' + String(error && error.message || error).slice(0, 220) }); }
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/drawings/file') {
      const name = drawingName(u.searchParams.get('name'));
      if (!name || drawingKind(name) !== 'xmind') return send(res, 400, { ok:false, error:'仅支持读取 XMind 原文件' });
      return streamStatic(req, res, drawingsDir(), name, { cacheControl:'no-cache', notFound:'XMind 文件不存在' });
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/save') {
      const b = await readBody(req);
      const name = drawingName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const data = b.data;
      const dir = drawingsDir();
      const target = path.join(dir, name);          // name 可含 '/' 子路径，防穿越已校验
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch (_) {}
      let body, result;
      if (drawingKind(name) === 'xmind') {
        try { result = writeXmindFile(target, data && data.workbook); }
        catch (error) { return send(res, 200, { ok:false, error:'XMind 写入失败：' + String(error.message || error) }); }
        return send(res, 200, { ok:true, name, ...result });
      } else if (drawingKind(name) === 'drawio') {
        body = data && typeof data.xml === 'string' ? data.xml : '';
        const inspection = inspectDrawioXml(body);
        if (!inspection.ok) return send(res, 200, inspection);
      } else {
        if (!data || typeof data !== 'object' || !Array.isArray(data.elements)) return send(res, 200, { ok: false, error: '缺少 Excalidraw 场景数据' });
        body = JSON.stringify({ type: 'excalidraw', version: 2, source: 'file://', elements: data.elements, appState: data.appState || {}, files: data.files || {} });
      }
      try { fs.writeFileSync(target, body); return send(res, 200, { ok: true, name, bytes: body.length }); }
      catch (e) { return send(res, 200, { ok: false, error: '写入失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/validate') {
      const b = await readBody(req);
      return send(res, 200, inspectDrawioXml(b && b.xml));
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/new') {
      const b = await readBody(req);
      const sub = drawingDir2(b && b.dir);          // 目标目录（'' = 根）
      if (sub === null) return send(res, 200, { ok: false, error: '目录不合法' });
      const kind = b && ['drawio', 'xmind'].includes(b.kind) ? b.kind : 'excalidraw';
      const ext = kind === 'drawio' ? '.drawio' : (kind === 'xmind' ? '.xmind' : '.excalidraw');
      const baseRaw = String((b && b.name) || '').replace(/\.(?:excalidraw|drawio|xmind)$/i, '').trim();
      const base = baseRaw || 'Untitled';
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+$/.test(base) || base === '.' || base === '..') return send(res, 200, { ok: false, error: '名称不合法' });
      const dirAbs = path.join(drawingsDir(), sub || '.');
      try { fs.mkdirSync(dirAbs, { recursive: true }); } catch (_) {}
      let name = base + ext, i = 2;
      while (true) {
        if (!fs.existsSync(path.join(dirAbs, name))) break;
        name = base + '-' + i + ext; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      const full = sub ? sub + '/' + name : name;
      const scene = kind === 'drawio'
        ? '<mxfile host="CodeScope"><diagram id="page-1" name="Page-1"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
        : (kind === 'xmind' ? newXmindWorkbook(base) : { type: 'excalidraw', version: 2, source: 'file://', elements: [], appState: {}, files: {} });
      try {
        if (kind === 'xmind') {
          const info = writeXmindFile(path.join(dirAbs, name), scene);
          return send(res, 200, { ok:true, name:full, dir:sub, kind, workbook:scene, ...info });
        }
        fs.writeFileSync(path.join(dirAbs, name), kind === 'drawio' ? scene : JSON.stringify(scene));
        return send(res, 200, kind === 'drawio' ? { ok: true, name: full, dir: sub, kind, xml: scene } : { ok: true, name: full, dir: sub, kind, ...scene });
      } catch (e) { return send(res, 200, { ok: false, error: '创建失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/new-folder') {
      const b = await readBody(req);
      const parent = drawingDir2(b && b.dir);       // 父目录（'' = 根）
      if (parent === null) return send(res, 200, { ok: false, error: '目录不合法' });
      const sub = drawingDir2(b && b.name);         // 新建目录名（可含 / 嵌套）
      if (!sub || sub === '.') return send(res, 200, { ok: false, error: '文件夹名称不合法' });
      const full = parent ? parent + '/' + sub : sub;
      try {
        fs.mkdirSync(path.join(drawingsDir(), full), { recursive: true });
        return send(res, 200, { ok: true, path: full });
      } catch (e) { return send(res, 200, { ok: false, error: '创建失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/delete') {
      const b = await readBody(req);
      const name = drawingName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        fs.unlinkSync(path.join(drawingsDir(), name));
        return send(res, 200, { ok: true, name });
      } catch (_) { return send(res, 200, { ok: false, error: '删除失败（文件不存在或已被占用）' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/rename') {
      const b = await readBody(req);
      const name = drawingName(b && b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const kind = drawingKind(name);
      const ext = kind === 'drawio' ? '.drawio' : (kind === 'xmind' ? '.xmind' : '.excalidraw');
      const baseRaw = String((b && b.newName) || '').replace(/\.(?:excalidraw|drawio|xmind)$/i, '').trim();
      if (!baseRaw) return send(res, 200, { ok: false, error: '名称不合法' });
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+$/.test(baseRaw) || baseRaw === '.' || baseRaw === '..' || /[\\/]/.test(baseRaw)) return send(res, 200, { ok: false, error: '名称不合法（仅当前文件夹内命名）' });
      const parts = name.split('/');
      const dir = parts.slice(0, -1).join('/');
      const dirAbs = dir ? path.join(drawingsDir(), dir) : drawingsDir();
      const oldFile = parts[parts.length - 1];
      const oldAbs = path.join(dirAbs, oldFile);
      let target = baseRaw + ext, i = 2;
      while (fs.existsSync(path.join(dirAbs, target)) && path.basename(target).toLowerCase() !== oldFile.toLowerCase()) {
        target = baseRaw + '-' + i + ext; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      try {
        if (target === oldFile) return send(res, 200, { ok: true, name, unchanged: true });
        const newAbs = path.join(dirAbs, target);
        if (target.toLowerCase() === oldFile.toLowerCase()) {
          // 仅大小写不同（macOS 不区分大小写）：先经临时名绕行，再改回目标大小写
          const tmp = path.join(dirAbs, '.' + Date.now() + '.tmp' + ext);
          fs.renameSync(oldAbs, tmp);
          fs.renameSync(tmp, newAbs);
        } else {
          fs.renameSync(oldAbs, newAbs);
        }
        const full = dir ? dir + '/' + target : target;
        return send(res, 200, { ok: true, name: full });
      } catch (_) { return send(res, 200, { ok: false, error: '重命名失败（文件不存在或已被占用）' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/move') {
      const b = await readBody(req);
      const name = drawingName(b && b.name);
      const toDir = drawingDir2(b && b.toDir);
      if (!name || toDir === null) return send(res, 200, { ok: false, error: '路径不合法' });
      const fromFile = name.split('/').pop();
      const full = toDir ? toDir + '/' + fromFile : fromFile;
      if (full === name) return send(res, 200, { ok: true, name, unchanged: true });
      const dirAbs = path.join(drawingsDir(), toDir || '.');
      try { fs.mkdirSync(dirAbs, { recursive: true }); } catch (_) {}
      // 目标文件夹已有同名文件 → 自动 -2、-3 避冲突（移动不改文件名）
      let target = fromFile, i = 2;
      while (fs.existsSync(path.join(dirAbs, target)) && (toDir ? toDir + '/' + target : target) !== name) {
        const kind = drawingKind(fromFile);
        const ext = kind === 'drawio' ? '.drawio' : (kind === 'xmind' ? '.xmind' : '.excalidraw');
        target = fromFile.replace(/\.(?:excalidraw|drawio|xmind)$/i, '') + '-' + i + ext; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      try {
        fs.renameSync(path.join(drawingsDir(), name), path.join(dirAbs, target));
        return send(res, 200, { ok: true, name: (toDir ? toDir + '/' : '') + target });
      } catch (_) { return send(res, 200, { ok: false, error: '移动失败（文件不存在或已被占用）' }); }
    }
    // ---- Libraries（Excalidraw 库：vault/libraries/*.excalidrawLibrary，文件夹管理 + 自动加载） ----
    function libsDir() { return path.join(vaultPath(), 'libraries'); }
    function libName(n) {
      if (typeof n !== 'string') return null;
      const base = n.split(/[\\/]/).pop();
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+\.excalidraw(library|lib)$/i.test(base)) return null;
      return base;
    }
    function readLibItems(file) {
      try {
        const p = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (p && Array.isArray(p.libraryItems)) return p.libraryItems;
      } catch (_) {}
      return null;
    }
    function mergeLibItems(lists) {
      const out = [], seen = new Set();
      for (const items of lists) {
        if (!Array.isArray(items)) continue;
        for (const it of items) {
          if (it && typeof it === 'object' && it.id && !seen.has(it.id) && Array.isArray(it.elements)) { seen.add(it.id); out.push(it); }
        }
      }
      return out;
    }
    if (req.method === 'GET' && u.pathname === '/api/libraries/list') {
      const dir = libsDir();
      let out = [];
      try {
        if (fs.existsSync(dir)) {
          out = fs.readdirSync(dir)
            .filter((n) => libName(n))
            .map((n) => {
              try { const st = fs.statSync(path.join(dir, n)); return { name: n, size: st.size, updated: st.mtimeMs }; }
              catch (_) { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.updated - a.updated);
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, libraries: out });
    }
    if (req.method === 'GET' && u.pathname === '/api/libraries/all') {
      const dir = libsDir();
      const lists = [], files = [];
      try {
        if (fs.existsSync(dir)) {
          for (const n of fs.readdirSync(dir).filter((fn) => libName(fn))) {
            const items = readLibItems(path.join(dir, n));
            if (items !== null) { lists.push(items); files.push(n); }
          }
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, files, items: mergeLibItems(lists) });
    }
    if (req.method === 'POST' && u.pathname === '/api/libraries/save') {
      const b = await readBody(req);
      const name = libName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const data = b.data;
      if (!data || typeof data !== 'object' || !Array.isArray(data.libraryItems)) return send(res, 200, { ok: false, error: '缺少库数据（libraryItems 数组）' });
      const dir = libsDir();
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      const body = JSON.stringify({ type: 'excalidrawLibrary', version: 2, source: 'file://', libraryItems: data.libraryItems });
      try { fs.writeFileSync(path.join(dir, name), body); return send(res, 200, { ok: true, name, bytes: body.length }); }
      catch (e) { return send(res, 200, { ok: false, error: '写入失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/libraries/delete') {
      const b = await readBody(req);
      const name = libName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        fs.unlinkSync(path.join(libsDir(), name));
        return send(res, 200, { ok: true, name });
      } catch (_) { return send(res, 200, { ok: false, error: '删除失败（文件不存在或已被占用）' }); }
    }
    // ---- 实时联网搜索（仅访问固定的 Tavily / Brave 官方 API；密钥不落盘） ----
    if (req.method === 'POST' && u.pathname === '/api/ai/web-search') {
      const b=await readBody(req);
      const provider=String((b&&b.provider)||'').trim().toLowerCase();
      const key=String((b&&b.key)||'').trim();
      const query=String((b&&b.query)||'').trim();
      if(!['tavily','brave'].includes(provider)) return send(res,400,{ok:false,error:'请选择 Tavily 或 Brave Search'});
      if(!key||key.length>500) return send(res,400,{ok:false,error:'联网搜索 API Key 缺失或不合法'});
      if(!query||query.length>800) return send(res,400,{ok:false,error:'搜索问题不能为空且不能超过 800 字'});
      try {
        const result=await liveWebSearch(provider,key,query);
        if(!result.results.length) return send(res,200,{ok:false,error:'搜索服务没有返回可用网页',provider,searchedAt:result.searchedAt,results:[]});
        return send(res,200,result);
      } catch (error) {
        return send(res,200,{ok:false,error:'联网搜索失败: '+String((error&&error.message)||error).slice(0,400),provider,searchedAt:new Date().toISOString(),results:[]});
      }
    }
    // ---- AI 助手（OpenAI 兼容代理：URL/Key/模型由前端配置，服务器只做转发） ----
    if (req.method === 'POST' && u.pathname === '/api/ai/chat') {
      const b = await readBody(req);
      const url = String((b && b.url) || '').trim();
      const key = String((b && b.key) || '').trim();
      const model = String((b && b.model) || '').trim();
      const rawMessages = b && Array.isArray(b.messages) ? b.messages : null;
      const requestedTimeoutMs = Number(b && b.timeoutMs);
      const timeoutMs = Number.isFinite(requestedTimeoutMs)
        ? Math.max(30000, Math.min(600000, Math.round(requestedTimeoutMs)))
        : 120000;
      let endpoint;
      try { endpoint = new URL(url); } catch (_) { return send(res, 400, { ok:false, error:'API URL 不合法（需 http/https 开头）' }); }
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || url.length > 2048) return send(res, 400, { ok:false, error:'API URL 不合法（仅支持不含账号密码的 http/https 地址）' });
      if (!model || model.length > 200) return send(res, 400, { ok:false, error:'请填写有效的模型名称' });
      if (key.length > 10000) return send(res, 400, { ok:false, error:'API Key 长度不合法' });
      if (!rawMessages || !rawMessages.length || rawMessages.length > 100) return send(res, 400, { ok:false, error:'消息数量必须在 1–100 条之间' });
      const messages = [];
      let messageBytes = 0;
      for (const item of rawMessages) {
        const role = String(item && item.role || '');
        const content = item && typeof item.content === 'string' ? item.content : '';
        if (!['system', 'user', 'assistant'].includes(role) || !content) return send(res, 400, { ok:false, error:'消息格式不正确' });
        messageBytes += Buffer.byteLength(content, 'utf8');
        messages.push({ role, content });
      }
      if (messageBytes > 600000) return send(res, 413, { ok:false, error:'AI 上下文超过 600 KB，请缩小项目或当前图上下文' });
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
          body: JSON.stringify({ model, messages, stream: false, temperature: 0.3 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const responseBytes = Number(resp.headers.get('content-length') || 0);
        if (Number.isFinite(responseBytes) && responseBytes > 12 * 1024 * 1024) {
          try { if (resp.body) await resp.body.cancel(); } catch (_) {}
          return send(res, 200, { ok:false, error:'AI 返回内容超过 12 MB，已停止读取' });
        }
        const text = await resp.text();
        if (Buffer.byteLength(text, 'utf8') > 12 * 1024 * 1024) return send(res, 200, { ok:false, error:'AI 返回内容超过 12 MB' });
        if (!resp.ok) return send(res, 200, { ok: false, error: 'API 错误 ' + resp.status + ': ' + text.slice(0, 400) });
        let data;
        try { data = JSON.parse(text); } catch (_) { return send(res, 200, { ok: false, error: 'API 返回非 JSON 内容' }); }
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (typeof content !== 'string') return send(res, 200, { ok: false, error: '无法解析响应（缺少 choices[0].message.content）' });
        return send(res, 200, { ok: true, content, model, usage: (data && data.usage) || null });
      } catch (e) {
        const detail = String((e && e.message) || e);
        const timedOut = (e && e.name === 'TimeoutError') || /aborted due to timeout|timed?\s*out/i.test(detail);
        return send(res, 200, { ok: false, timeout: timedOut, error: timedOut
          ? `请求超时：AI 服务在 ${Math.round(timeoutMs / 1000)} 秒内未完成响应。请重试，或改用响应更快的模型。`
          : '请求失败: ' + detail.slice(0, 300) });
      }
    }
    if (req.method === 'POST' && u.pathname === '/api/git/commit') {
      const b = await readBody(req);
      const msg = String(b.message || '').trim();
      if (!msg) return send(res, 200, { ok: false, error: '提交信息不能为空' });
      const add = await gitRun(['add', '-A']);
      if (!add.ok) return send(res, 200, { ok: false, error: 'git add 失败: ' + add.error });
      const cm = await gitRun(['commit', '-m', msg]);
      if (!cm.ok) return send(res, 200, { ok: false, error: 'git commit 失败: ' + cm.error, output: (cm.stdout + cm.stderr).trim() });
      return send(res, 200, { ok: true, message: '已提交', output: (cm.stdout + cm.stderr).trim(), status: await gitStatus() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/push') {
      const r = await gitRun(['push'], 120000);
      return send(res, 200, r.ok
        ? { ok: true, message: '推送成功', output: (r.stdout + r.stderr).trim(), status: await gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/pull') {
      const r = await gitRun(['pull'], 120000);
      return send(res, 200, r.ok
        ? { ok: true, message: '拉取成功', output: (r.stdout + r.stderr).trim(), status: await gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/reset') {
      const b = await readBody(req);
      const hash = String(b.hash || '').trim();
      if (!/^[0-9a-f]{4,40}$/i.test(hash)) return send(res, 200, { ok: false, error: '提交标识不合法' });
      const r = await gitRun(['reset', '--hard', hash], 60000);
      return send(res, 200, r.ok
        ? { ok: true, message: '已回退到 ' + hash, output: (r.stdout + r.stderr).trim(), status: await gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    // ===== 通用工程能力 =====
    if (req.method === 'GET' && u.pathname === '/api/project/tasks') return send(res, 200, taskCatalog());
    if (req.method === 'GET' && u.pathname === '/api/project/tests') return send(res, 200, testCatalog());
    if (req.method === 'POST' && u.pathname === '/api/project/tests/run') {
      const b=await readBody(req),catalog=testCatalog(),test=catalog.tests.find((item)=>item.id===String(b.id||''));
      if(!test)return send(res,400,{ok:false,error:'测试任务不存在，请刷新后重试'});
      return send(res,200,await runProjectCommand(test.command,test.cwd));
    }
    if (req.method === 'GET' && u.pathname === '/api/project/debug') return send(res, 200, debugCatalog());
    if (req.method === 'POST' && u.pathname === '/api/project/tasks/run') {
      const b = await readBody(req), catalog = taskCatalog();
      let command = String(b.command || '').trim(), cwd = String(b.cwd || '.');
      if (b.id) {
        const task = catalog.tasks.find((item) => item.id === String(b.id));
        if (!task) return send(res, 400, { ok:false, error:'构建任务不存在，请刷新后重试' });
        command = task.command; cwd = task.cwd;
      }
      return send(res, 200, await runProjectCommand(command, cwd));
    }
    if (req.method === 'GET' && u.pathname === '/api/project/compile-db') {
      try { return send(res, 200, compileDatabaseInfo()); }
      catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/project/health') return send(res, 200, await projectHealth());
    if (req.method === 'GET' && u.pathname === '/api/lsp/status') return send(res, 200, LSP.status());
    if (req.method === 'POST' && u.pathname === '/api/lsp/query') {
      const b = await readBody(req), snippets = walkSnippets();
      const snippet = snippets.find((item) => item.file === String(b.file || ''));
      if (!snippet) return send(res, 404, { ok:false, error:'片段不存在（vault 可能已变动）' });
      const fragment = Number(b.fragment);
      if (!Number.isInteger(fragment) || fragment < 0 || fragment >= snippet.fragments.length) return send(res, 400, { ok:false, error:'片段索引无效' });
      const source = snippet.fragments[fragment];
      const action = String(b.action || 'hover');
      if (!['hover', 'definition', 'references', 'diagnostics', 'completion', 'signature', 'highlights', 'rename', 'codeAction'].includes(action)) return send(res, 400, { ok:false, error:'不支持的 LSP 操作' });
      const code = typeof b.code === 'string' ? b.code : source.code;
      if (Buffer.byteLength(code, 'utf8') > 2 * 1024 * 1024) return send(res, 413, { ok:false, error:'LSP 文件内容超过 2 MB' });
      return send(res, 200, await LSP.query({ snippet, fragment, language:source.language, code, action, line:b.line, column:b.column, newName:b.newName, triggerKind:b.triggerKind, triggerCharacter:b.triggerCharacter, range:b.range, only:b.only }));
    }
    // ===== 远程开发：SSH 复用底部 PTY 终端；SFTP 浏览文件；VNC 由 WebSocket 代理 =====
    if (req.method === 'GET' && u.pathname === '/api/remote/status') {
      return send(res, 200, {
        ok: true,
        ssh: { available: !!executablePath('ssh'), path: executablePath('ssh'), files: true },
        vnc: { available: fs.existsSync(path.join(__dirname, 'node_modules', '@novnc', 'novnc', 'core', 'rfb.js')) },
        terminal: TERM ? { active: true, mode: TERM.mode, label: TERM.label, host: TERM.host || '', port: TERM.port || 0 } : { active: false, mode: '', label: '', host: '', port: 0 },
      });
    }
    if (req.method === 'GET' && u.pathname === '/api/remote/latency') {
      const host = remoteHost(u.searchParams.get('host'));
      const port = remotePort(u.searchParams.get('port'), 0);
      if (!host || !port) return send(res, 400, { ok: false, error: '主机或端口不合法' });
      const result = await measureNetworkLatency(host);
      return send(res, result.ok ? 200 : 504, result);
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/ssh/connect') {
      const b = await readBody(req);
      const spec = sshSessionSpec(b);
      if (spec.error) return send(res, 400, { ok: false, error: spec.error });
      stopTerm();
      if (!termSpawn(spec)) return send(res, 500, { ok: false, error: 'SSH 终端启动失败' });
      return send(res, 200, { ok: true, mode: 'ssh', label: spec.label, host: spec.host, port: spec.port, user: spec.user });
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/ssh/disconnect') {
      stopTerm();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/list') {
      try { return send(res, 200, await remoteList(await readBody(req))); }
      catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/read') {
      try { return send(res, 200, await remoteRead(await readBody(req))); }
      catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/write') {
      try { return send(res, 200, await remoteWrite(await readBody(req))); }
      catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/upload-stream') {
      await streamRemoteUpload(req, res);
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/download-stream') {
      try { await streamRemoteDownload(res, await readBody(req)); }
      catch (error) {
        if (!res.headersSent) send(res, 200, { ok:false, error:String(error.message || error) });
        else res.destroy(error);
      }
      return;
    }
    // ===== 底部终端（PTY shell，script 命令分配伪终端）=====
    if (req.method === 'GET' && u.pathname === '/api/term/stream') {
      if (!TERM || !TERM.child) termSpawn();
      if (!TERM) { res.end('终端启动失败'); return; }
      const session = TERM;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-CodeScope-Terminal-Replay': '1' });
      session.clients.add(res);
      if (session.buffer.length) { try { res.write(session.buffer); } catch (_) {} }
      req.on('close', () => {
        // 页面刷新/多标签切换只移除自己的订阅，不再杀掉共享 SSH 会话。
        session.clients.delete(res);
      });
      return;   // 保持连接，输出由 termSpawn 的 stdout/stderr 回调实时推送
    }
    if (req.method === 'POST' && u.pathname === '/api/term/input') {
      const b = await readBody(req);
      const data = String((b && b.data) || '');
      if (!TERM || !TERM.child) return send(res, 409, { ok: false, error: '终端尚未连接' });
      try { TERM.child.stdin.write(data); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/term/resize') {
      const b = await readBody(req);
      const cols = Math.max(20, Math.min(1000, Math.floor(Number(b.cols) || 0)));
      const rows = Math.max(5, Math.min(500, Math.floor(Number(b.rows) || 0)));
      if (!TERM || !TERM.child) return send(res, 409, { ok: false, error: '终端尚未连接' });
      const control = TERM.child.stdio && TERM.child.stdio[3];
      if (!control || !control.writable) return send(res, 200, { ok: true, forwarded: false });
      try { control.write(JSON.stringify({ cols, rows }) + '\n'); return send(res, 200, { ok: true, forwarded: true }); }
      catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/term/stop') {
      stopTerm();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { ok: false, error: 'Not Found: ' + u.pathname });
  } catch (e) {
    const statusCode = Number(e && e.statusCode);
    const code = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
    if (!res.headersSent) send(res, code, { ok: false, error: String((e && e.message) || e) });
    else if (!res.writableEnded && !res.destroyed) res.destroy(e);
  }
});

const VNC_WSS = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  let u;
  try { u = new URL(req.url, 'http://' + (req.headers.host || HOST + ':' + PORT)); }
  catch (_) { socket.destroy(); return; }
  if (u.pathname !== '/api/vnc/ws') { socket.destroy(); return; }
  const origin = String(req.headers.origin || '');
  if (origin) {
    try {
      if (new URL(origin).host !== String(req.headers.host || '')) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
    } catch (_) { socket.destroy(); return; }
  }
  const host = remoteHost(u.searchParams.get('host'));
  const port = remotePort(u.searchParams.get('port'), 5900);
  if (!host || !port) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  VNC_WSS.handleUpgrade(req, socket, head, (ws) => VNC_WSS.emit('connection', ws, req, { host, port }));
});
VNC_WSS.on('connection', (ws, _req, target) => {
  const tcp = net.createConnection({ host: target.host.replace(/^\[|\]$/g, ''), port: target.port });
  tcp.setNoDelay(true);
  tcp.setTimeout(10000, () => tcp.destroy());
  tcp.once('connect', () => tcp.setTimeout(0));
  ws.on('message', (data) => { if (!tcp.destroyed && tcp.writable) tcp.write(data); });
  tcp.on('data', (data) => { if (ws.readyState === 1) ws.send(data, { binary: true }); });
  const closeWs = () => { if (ws.readyState === 0 || ws.readyState === 1) ws.close(); };
  tcp.on('error', closeWs);
  tcp.on('close', closeWs);
  ws.on('error', () => { try { tcp.destroy(); } catch (_) {} });
  ws.on('close', () => { try { tcp.destroy(); } catch (_) {} });
});

server.listen(PORT, HOST, () => {
  console.log('码境 CodeScope 已启动 [' + APP_MODE + ']: http://' + HOST + ':' + PORT);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    const addresses = [];
    for (const rows of Object.values(os.networkInterfaces())) for (const row of (rows || [])) {
      if (row.family === 'IPv4' && !row.internal) addresses.push('http://' + row.address + ':' + PORT);
    }
    if (addresses.length) console.log('局域网访问: ' + addresses.join('  '));
    console.log('⚠ 当前为局域网模式：终端、代码运行和文件修改接口可被同网段设备访问。');
  }
  try { console.log('Vault: ' + vaultPath()); } catch (e) { console.log('Vault: ' + e.message); }
  // 清扫上次服务留下的运行临时目录（正常退出会由 TTL 回收，强杀则依赖这里）
  try { const swept = sweepTempDirs(); if (swept) console.log('已清理运行临时目录: ' + swept + ' 个'); } catch (_) {}
  console.log('正在检测本机环境…');
  getEnv(false).then(({ tools: env, project }) => {
    const all = Object.values(env);
    const missing = all.filter((e) => e.required && !e.available);
    const needed = all.filter((e) => e.required);
    console.log('环境检测完成：当前项目需要 ' + (needed.length - missing.length) + '/' + needed.length + ' 项就绪');
    if (project.languages.length) console.log('检测到语言：' + project.languages.join(', '));
    if (missing.length) {
      console.log('缺失项：');
      for (const m of missing) console.log('  - ' + m.label + '（' + m.for + '）→ ' + installHint(m.key));
    } else {
      console.log('全部就绪 ✅');
    }
  });
  console.log('按 Ctrl+C 停止');
});
