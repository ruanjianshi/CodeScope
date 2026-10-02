'use strict';


/* 平台差异统一问 lib/platform.js。 */
const { HOST } = require('./platform');
/* ── code-server（浏览器版 VS Code）托管服务 ──
   与 opencode / DSH 同一套模式：CodeScope 负责把它拉起来、探活、暴露状态。

   为什么 code-server 不写进 package.json：
   ① 它连 VS Code 本体一起 695MB，塞进项目（而这个项目在 iCloud Drive 里）既臃肿，
      iCloud 还可能把不常用文件"优化"成占位符，运行时直接报错；
   ② 项目里有 @electron/node-gyp，它提供的 node_modules/.bin/node-gyp 会**遮蔽**真正的 node-gyp，
      code-server 的 postinstall 会拿 Electron 版去 rebuild VS Code 的原生模块，必然失败。
   所以它和 opencode 一样是「外部可选工具」：按约定目录 + PATH 去找，找不到就如实报未安装。 */

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const DEFAULT_PORT = 4899;
const LOOPBACK = '127.0.0.1';

/* 预置的默认设置：只在用户还没有 User/settings.json 时写入，不覆盖已有配置。
   目的是治「卡」：
   - watcherExclude/search.exclude：对 iCloud Drive 里的项目尤其重要——node_modules
     这类目录一进 watcher，iCloud 的按需下载 + 同步扫描会把编辑器拖到不可用；
   - 关自动更新/自动检查：扩展与本体更新都在后台抢网络和 CPU；
   - 关启动欢迎页：iframe 里少一次无谓的渲染。 */
function defaultSettings() {
  return {
    'workbench.startupEditor': 'none',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'files.exclude': { '**/.DS_Store': true },
    'files.watcherExclude': {
      '**/node_modules/**': true,
      '**/.git/objects/**': true,
      '**/.git/subtree-cache/**': true,
      '**/dist/**': true,
      '**/build/**': true,
      '**/coverage/**': true,
    },
    'search.exclude': {
      '**/node_modules': true,
      '**/dist': true,
      '**/build': true,
      '**/coverage': true,
    },
  };
}

/* code-server 的界面语言来自 --locale 参数，而它**不读 argv.json**（那是桌面版 VS Code 的约定）。
   这里替它读一次：想换语言时仍然只需改 argv.json 里的 locale，不必翻面板设置。 */
function readLocaleArg(userDataDir) {
  try {
    const file = path.join(userDataDir, 'argv.json');
    if (!fs.existsSync(file)) return [];
    /* argv.json 是 JSONC：允许注释与尾随逗号，先清掉再解析，解析失败就当没配。 */
    const raw = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    const locale = String((JSON.parse(raw) || {}).locale || '').trim();
    return /^[A-Za-z]{2}(-[A-Za-z0-9]+)*$/.test(locale) ? ['--locale', locale] : [];
  } catch (_) { return []; }
}

/* 确保用户数据目录里有这份基础设置；已有文件则原样保留（那是用户自己的选择）。 */
function ensureDefaultSettings(userDataDir) {
  try {
    const userDir = path.join(userDataDir, 'User');
    const file = path.join(userDir, 'settings.json');
    if (fs.existsSync(file)) return;
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(defaultSettings(), null, 2) + '\n', 'utf8');
  } catch (_) { /* 写不进去不影响启动 */ }
}

/* ── 可用性用「实测」判定，不要写死 Node 主版本 ──
   code-server 4.117.0 的 package.json 声明 engines.node = "22"，但实测它在 Node 26 上完全可用
   （服务能起、/healthz 200、浏览器里 workbench 正常渲染）。反过来，这台机器上 brew 装的
   node@22 因为 libsimdjson 动态库版本错位已经跑不起来（dyld: Library not loaded）。
   所以：
   ① 不再拿 Node 主版本吓人；
   ② 真跑一次 `code-server --version` 来判断能不能用，并把版本号报出来（以前 version 恒为空）；
   ③ 指定的运行时跑不动时，自动改用实测能跑的那个，失败才如实报错。 */
const PROBE_TIMEOUT = 12000;
const probeState = { promise: null, result: null };

function isExecutableFile(target) {
  try { return !!target && fs.statSync(target).isFile(); } catch (_) { return false; }
}

/* 在 PATH（含各平台惯例目录）上找可执行文件。
   Windows 没有 which（要用 where），否则 code-server / node 永远探测不到、界面一直说「未安装」。 */
function onPath(name) {
  try {
    const found = HOST.which(name);
    return found && isExecutableFile(found) ? found : '';
  } catch (_) { return ''; }
}

/* 找一个「真正能跑的 code-server」，顺序固定：
   环境变量 → ~/.codescope 的 bin shim → 项目内 bin shim → entry.js（配一个真正的 node）→ PATH。
   返回 null 表示这台机器上没装；调用方据此给出安装提示，而不是猜版本号。 */
/* 找一个「真正的 node」：桌面版里 process.execPath 是 Electron，不能拿来跑 code-server。
   顺序：CODESCOPE_NODE_BIN → PATH 上的 node → process.execPath（且必须不是 Electron）。 */
function resolveNodeRuntime() {
  const explicit = String(process.env.CODESCOPE_NODE_BIN || '').trim();
  if (explicit && isExecutableFile(explicit)) return explicit;
  const fromPath = onPath('node');
  if (!process.versions.electron && isExecutableFile(process.execPath)) return process.execPath;
  return fromPath || '';
}

/* 找一个「真正能跑的 code-server」，顺序固定：
   环境变量 → ~/.codescope 的 bin shim → 项目内 bin shim → entry.js（配一个真正的 node）→ PATH。
   返回 null 表示这台机器上没装；调用方据此给安装提示，而不是猜版本号。 */
function resolveCodeServer() {
  const explicit = String(process.env.CODESCOPE_CODE_SERVER_BIN || '').trim();
  if (explicit && isExecutableFile(explicit)) return { command: explicit, args: [], via: 'CODESCOPE_CODE_SERVER_BIN' };
  const home = os.homedir();
  for (const shim of [
    path.join(home, '.codescope', 'node_modules', '.bin', 'code-server'),
    path.join(__dirname, '..', 'node_modules', '.bin', 'code-server'),
  ]) {
    if (isExecutableFile(shim)) return { command: shim, args: [], via: shim };
  }
  const runtime = resolveNodeRuntime();
  for (const entry of [
    path.join(home, '.codescope', 'node_modules', 'code-server', 'out', 'node', 'entry.js'),
    path.join(__dirname, '..', 'node_modules', 'code-server', 'out', 'node', 'entry.js'),
  ]) {
    if (!isExecutableFile(entry)) continue;
    if (runtime) return { command: runtime, args: [entry], via: runtime + ' ' + entry };
  }
  const fromPath = onPath('code-server');
  if (fromPath) return { command: fromPath, args: [], via: 'PATH 上的 code-server' };
  return null;
}

/* 按「先用谁跑 code-server」的顺序列出候选，探测时逐个真跑 --version。 */
function runtimeCandidates() {
  const list = [];
  const push = (command, args, via) => { if (command && isExecutableFile(command)) list.push({ command, args, via }); };
  push(String(process.env.CODESCOPE_CODE_SERVER_BIN || '').trim(), [], 'CODESCOPE_CODE_SERVER_BIN');
  const home = os.homedir();
  for (const shim of [
    path.join(home, '.codescope', 'node_modules', '.bin', 'code-server'),
    path.join(__dirname, '..', 'node_modules', '.bin', 'code-server'),
  ]) push(shim, [], shim);
  const entries = [
    path.join(home, '.codescope', 'node_modules', 'code-server', 'out', 'node', 'entry.js'),
    path.join(__dirname, '..', 'node_modules', 'code-server', 'out', 'node', 'entry.js'),
  ];
  const runtimes = [];
  const explicit = String(process.env.CODESCOPE_NODE_BIN || '').trim();
  if (explicit && isExecutableFile(explicit)) runtimes.push(explicit);
  const fromPath = onPath('node');
  if (fromPath && fromPath !== explicit) runtimes.push(fromPath);
  if (!process.versions.electron && isExecutableFile(process.execPath) && !runtimes.includes(process.execPath)) runtimes.push(process.execPath);
  for (const entry of entries) {
    if (!isExecutableFile(entry)) continue;
    for (const runtime of runtimes) push(runtime, [entry], runtime + ' ' + entry);
  }
  const onPathCodeServer = onPath('code-server');
  if (onPathCodeServer) push(onPathCodeServer, [], 'PATH 上的 code-server');
  return list;
}

function probeCandidate(candidate) {
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let out = '';
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    try { child = spawn(candidate.command, [...candidate.args, '--version'], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { return done({ ok: false, error: String((error && error.message) || error) }); }
    const keep = (chunk) => { out = (out + String(chunk)).slice(-1200); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.once('error', (error) => done({ ok: false, error: String((error && error.message) || error) }));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} done({ ok: false, error: '探测超时' }); }, PROBE_TIMEOUT);
    child.once('exit', (code) => {
      clearTimeout(timer);
      const lines = out.split('\n').map((line) => line.trim()).filter(Boolean);
      const matched = out.match(/(\d+\.\d+\.\d+)[^\n]*with Code/i) || out.match(/\b(\d+\.\d+\.\d+)\b/);
      if (code === 0 && matched) done({ ok: true, version: matched[1] });
      else done({ ok: false, error: String(lines[lines.length - 1] || ('退出码 ' + code)).slice(0, 220) });
    });
  });
}

/* 探测结果全局缓存一次：status() 每 1.5 秒被轮询，不能每次都 fork 一个进程。 */
function probeRuntime() {
  if (probeState.result) return Promise.resolve(probeState.result);
  if (probeState.promise) return probeState.promise;
  probeState.promise = (async () => {
    const candidates = runtimeCandidates();
    const failures = [];
    for (const candidate of candidates) {
      const outcome = await probeCandidate(candidate);
      if (outcome.ok) {
        probeState.result = { ok: true, command: candidate.command, args: candidate.args, via: candidate.via, version: outcome.version, failures };
        return probeState.result;
      }
      failures.push({ via: candidate.via, error: outcome.error });
    }
    probeState.result = { ok: false, count: candidates.length, failures };
    return probeState.result;
  })();
  probeState.promise.then(() => { probeState.promise = null; }, () => { probeState.promise = null; });
  return probeState.promise;
}

/* 环境更新装完 code-server 之后必须让它重新实测：探测结果全局只算一次，
   不清掉的话「未安装」会一直挂到进程重启，用户会以为装了没用。 */
function resetProbe() { probeState.result = null; probeState.fallbackNote = ''; }

/* 给 status() 用的同步摘要：还没探完就先不说吓人的话。 */
function runtimeSummary() {
  const result = probeState.result;
  if (!result) return { version: '', hint: '' };
  if (!result.ok) {
    const first = result.failures[0] || {};
    return {
      version: '',
      hint: result.count === 0
        ? '没找到可执行的 code-server（试试：mkdir -p ~/.codescope && cd ~/.codescope && npm install code-server）'
        : 'code-server 在这台机器上跑不起来：' + (first.error || '未知原因')
          + (result.failures.length > 1 ? '（已试 ' + result.failures.length + ' 种运行方式）' : ''),
    };
  }
  const note = probeState.fallbackNote ? probeState.fallbackNote + ' · ' : '';
  return { version: result.version, hint: note + '实测可用：code-server ' + result.version + ' · 当前 Node v' + process.versions.node };
}

function probe(url, timeout = 800) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => { res.destroy(); resolve(res.statusCode >= 200 && res.statusCode < 500); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/* 端口上只要有东西在听就算被占——哪怕它对 /healthz 回 502。
   只看 HTTP 探活会漏掉那种「占着端口、上游已死、每秒重试」的反代：
   code-server 一启动就 EADDRINUSE 退出，用户视角就是编辑工作台永远打不开。 */
function portOccupied(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    const done = (value) => { try { socket.destroy(); } catch (_) {} resolve(value); };
    socket.setTimeout(600, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function createCodeServerService(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  let port = Number(options.port) || DEFAULT_PORT;
  const hostname = options.hostname || LOOPBACK;
  const proxyPort = Number(options.proxyPort) || 0;
  const dataRoot = options.dataRoot || path.join(os.tmpdir(), 'codescope');
  const onPortChange = typeof options.onPortChange === 'function' ? options.onPortChange : null;
  const userDataDir = path.join(dataRoot, 'code-server');
  const extensionsDir = path.join(userDataDir, 'extensions');
  const configFile = path.join(userDataDir, 'config.yaml');
  let url = `http://${hostname}:${port}`;
  let child = null;
  let state = 'stopped';
  let message = '';
  let startPromise = null;

  const missingHint = '未安装 code-server。在项目外装一次即可：mkdir -p ~/.codescope && cd ~/.codescope && npm install code-server';

  function installed() {
    const resolved = resolveCodeServer();
    return !!(resolved && resolved.command);
  }

  function status() {
    const resolved = resolveCodeServer();
    const ready = state === 'running' || state === 'external';
    /* 顺手触发一次后台实测（不阻塞这次响应），下次轮询就能给出真实结论。 */
    if (!probeState.result) probeRuntime().catch(() => {});
    const summary = runtimeSummary();
    return {
      key: 'code-server',
      label: 'VS Code',
      group: '代码编辑器',
      for: '浏览器版 VS Code（iframe 内嵌），可打开本机任意文件夹',
      available: ready,
      installed: !!(resolved && resolved.command),
      managed: !!child,
      state,
      version: summary.version,
      url,
      port,
      proxyPort,
      extensionsDir,
      message: message || (resolved && resolved.command ? '等待启动 VS Code 服务' : (resolved && resolved.broken) || missingHint),
      hint: summary.hint || (resolved && resolved.command
        ? '由 CodeScope 托管运行；扩展市场是 Open VSX（非微软市场）'
        : missingHint),
    };
  }

  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      let resolved = resolveCodeServer();
      if (!resolved || !resolved.command) {
        state = 'unavailable';
        message = (resolved && resolved.broken) || missingHint;
        return status();
      }
      /* 实测能跑的运行方式优先：比如 CODESCOPE_NODE_BIN 指向的 Node 其实起不来时，
         自动改用真正能跑的那个，而不是把失败原样丢给用户。 */
      const probed = await probeRuntime().catch(() => null);
      if (probed && probed.ok && probed.command && (probed.command !== resolved.command || String(probed.args[0] || '') !== String(resolved.args[0] || ''))) {
        resolved = { command: probed.command, args: probed.args, via: probed.via };
        probeState.fallbackNote = '已自动改用实测可运行的运行方式';
        message = probeState.fallbackNote + '（' + probed.via + '）';
      }
      if (child && child.exitCode == null) { state = 'running'; return status(); }
      ensureDefaultSettings(userDataDir);
      /* 已经有别人跑在同一个端口上就直接复用，不重复拉起。 */
      if (await probe(url + '/healthz')) {
        state = 'external';
        message = `已连接 ${url} 上现有的 code-server`;
        return status();
      }
      /* 默认端口被别的程序占着就自动往上换：有一种占法特别隐蔽——一个上游已死的反代
         占着端口对 /healthz 回 502，HTTP 探活认不出它，code-server 一启动就 EADDRINUSE，
         用户视角就是「编辑工作台永远打不开」。所以用 TCP 探测、逐个跳过。 */
      const preferredPort = Number(options.port) || DEFAULT_PORT;
      for (let attempt = 0; attempt < 12 && await portOccupied(hostname, port); attempt++) port += 1;
      if (port !== preferredPort) {
        url = `http://${hostname}:${port}`;
        if (onPortChange) onPortChange(port);
      }
      fs.mkdirSync(extensionsDir, { recursive: true });
      state = 'starting';
      message = '正在启动 VS Code 服务…';
      const args = [...resolved.args,
        '--bind-addr', `${hostname}:${port}`,
        '--auth', 'none',
        '--disable-telemetry',
        /* 不禁用工作区信任的话，打开新文件夹会弹「是否信任此作者」对话框——
           它在 iframe（尤其 Safari）里经常弹不出来或无法交互，用户视角就是
           「点打开文件夹没反应、整个界面卡死」。托管场景里直接关掉。 */
        '--disable-workspace-trust',
        '--disable-update-check',
        ...readLocaleArg(userDataDir),
        '--config', configFile,
        '--user-data-dir', userDataDir,
        '--extensions-dir', extensionsDir,
      ];
      /* 把实际启动参数写进服务日志：界面语言这类「传了但没生效」的问题，
         没有参数记录就只能靠猜（踩过）。放在 spawn 之前，失败时也留得下。 */
      log('[code-server] 启动参数：' + [resolved.command].concat(args).join(' '));
      child = spawn(resolved.command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, VSCODE_LOGS: path.join(userDataDir, 'logs') },
        /* 自成进程组：code-server 会再派生 extension host 等子进程，
           停止时只有整组回收才不会留下孤儿（实测会留下 bootstrap-fork）。 */
        detached: true,
      });
      let tail = '';
      const keep = (chunk) => { tail = (tail + String(chunk)).slice(-600); };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      child.once('error', (error) => { state = 'error'; message = 'VS Code 服务启动失败：' + (error.message || error); });
      child.once('exit', () => {
        child = null;
        if (state === 'running' || state === 'starting') { state = 'stopped'; message = 'VS Code 服务已退出' + (tail ? '：' + tail.trim().split('\n').pop() : ''); }
      });
      for (let attempt = 0; attempt < 150; attempt++) {
        if (await probe(url + '/healthz', 500)) {
          state = 'running';
          message = 'VS Code 已由 CodeScope 托管运行';
          return status();
        }
        if (!child || child.exitCode != null || state === 'error') break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (state !== 'error') {
        state = 'error';
        message = 'VS Code 服务启动超时' + (tail ? '：' + tail.trim().split('\n').slice(-1)[0] : '');
      }
      return status();
    })();
    try { return await startPromise; } finally { startPromise = null; }
  }

  /* 收掉整组进程：只 kill 直接子进程会留下 extension host 孤儿（实测残留约 150MB/个）。 */
  function killTree(target) {
    if (!target || target.exitCode != null) return;
    try { process.kill(-target.pid, 'SIGTERM'); }
    catch (_) { try { target.kill('SIGTERM'); } catch (_) {} }
    setTimeout(() => { try { process.kill(-target.pid, 'SIGKILL'); } catch (_) {} }, 3000).unref();
  }

  async function stop() {
    if (child && child.exitCode == null) killTree(child);
    child = null;
    state = 'stopped';
    message = 'VS Code 服务已停止';
    return status();
  }

  return { status, start, stop, port, proxyPort, hostname };
}

module.exports = { createCodeServerService, resolveCodeServer, resetProbe };
