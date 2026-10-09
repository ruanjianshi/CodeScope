'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const LOOPBACK = '127.0.0.1';

function flag(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function validPort(value, fallback = 3080) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function tcpOpen(host, port, timeout = 450) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function resolveDshCli(projectRoot) {
  const packageRoot = path.join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh');
  const bundled = path.join(packageRoot, 'lib', 'bin.js');
  if (fs.existsSync(bundled)) {
    let version = '';
    try { version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version || ''; } catch (_) {}
    return { command:process.execPath, prefix:[bundled], bundled:true, version, path:bundled };
  }
  const names = process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh'] : ['dsh'];
  for (const name of names) {
    try {
      const command = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding:'utf8', timeout:1200 }).split(/\r?\n/)[0].trim();
      if (!command) continue;
      let version = '';
      try { version = execFileSync(command, ['--version'], { encoding:'utf8', timeout:2500 }).trim(); } catch (_) {}
      return { command, prefix:[], bundled:false, version, path:command };
    } catch (_) {}
  }
  return null;
}

function discoverPublicUrl() {
  const explicit = String(process.env.CODESCOPE_DSH_PUBLIC_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const patchFile = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  try {
    const match = fs.readFileSync(patchFile, 'utf8').match(/^\s*publicBaseUrl:\s*["']?([^\s"']+)/m);
    return match ? match[1].replace(/\/+$/, '') : '';
  } catch (_) { return ''; }
}

function cleanChildEnv() {
  const env = { ...process.env };
  for (const key of ['ALL_PROXY', 'all_proxy']) if (/^socks/i.test(String(env[key] || ''))) delete env[key];
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

function createDshService(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
  const dataRoot = options.dataRoot || path.join(os.tmpdir(), 'codescope');
  const port = validPort(process.env.CODESCOPE_DSH_PORT, 3080);
  const autoStart = flag('CODESCOPE_DSH_AUTOSTART', true);
  const cli = resolveDshCli(projectRoot);
  const logDir = path.join(dataRoot, 'dsh');
  const logPath = path.join(logDir, 'dsh.log');
  const publicUrl = discoverPublicUrl();
  let child = null;
  let owned = false;
  /* ★ 端口上那个「不是我们这次 spawn 的」DSH 的 PID ✓（孤儿 ✓）。
     ⚠️ 为什么要记它 ✗✗：实测（2026-10-09）用户报「本机 DSH 关不了了」✓ ——
        原因是**应用反复重启时，它 spawn 的 DSH 变成孤儿活了下来** ✓
        （父进程没了 ✓，但 DSH 还在 3080 上听 ✓）→
        新起来的应用一看「端口上有东西、又不是我 spawn 的」✗ → 判成 external ✓
        → `owned=false` ✗ → 面板上「关闭」变灰 ✗，还显示
        「现有 DSH 服务不由 CodeScope 管理，未将其关闭」✓ —— 用户完全没法关 ✓。
     → 认领它 ✓：端口是**我们自己的**（`CODESCOPE_DSH_PORT` 默认 3080 ✓），
        再看它的 **cwd 是不是本项目** ✓（是 → 基本可以确定是我们自己的孤儿 ✓）。 */
  let externalPid = 0;

  /* 端口上监听的进程 PID ✓（macOS / Linux 都有 lsof ✓）。
     ⚠️ 拿不到就返回 0 ✓ —— 拿不到只是「不能关」✗，不该影响启动 ✓。 */
  function pidOnPort(p) {
    try {
      const out = execFileSync('lsof', ['-ti:' + p, '-sTCP:LISTEN'], { encoding:'utf8', timeout:4000 });
      const pid = Number(String(out).trim().split('\n')[0]);
      return Number.isFinite(pid) ? pid : 0;
    } catch (_) { return 0; }
  }

  /* 这个 PID 的工作目录是不是本项目 ✓（判断「是不是我们自己的孤儿」的关键依据 ✓） */
  function cwdOfPid(pid) {
    if (!pid) return '';
    try {
      const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding:'utf8', timeout:4000 });
      const line = String(out).split('\n').find((l) => l.startsWith('n'));
      return line ? line.slice(1) : '';
    } catch (_) { return ''; }
  }

  let state = autoStart ? 'stopped' : 'disabled';
  let message = autoStart ? '等待 CodeScope 启动 DSH' : '已通过 CODESCOPE_DSH_AUTOSTART 禁用自动启动';
  let tokenUrl = '';
  let lastExit = null;
  let startPromise = null;

  function status() {
    const running = state === 'running' || state === 'external';
    return {
      key:'dsh', label:'DeepSeek Harness', group:'AI 智能体运行服务',
      for:'DSH 智能体、工具调用、工作流与浏览器控制台',
      available:running, installed:!!cli, required:false, relevant:true, bundled:!!(cli && cli.bundled), managed:owned, scope:'应用内置',
      state, version:cli && cli.version || '', path:cli && cli.path || '', port,
      url:tokenUrl || `http://${LOOPBACK}:${port}/`, publicUrl, pid:child && child.pid || null,
      message, issue:running ? '' : message,
      hint:cli ? '由 CodeScope 自动管理；可在环境面板启动或重启' : '重新安装 CodeScope 依赖以补充 @deepseek-ai/dsh',
      logPath, lastExit,
    };
  }

  function appendLog(text) {
    try {
      fs.mkdirSync(logDir, { recursive:true });
      fs.appendFileSync(logPath, text);
    } catch (_) {}
  }

  async function start(force = false) {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (!cli) {
        state = 'unavailable'; message = 'CodeScope 安装包中缺少 DSH 运行时';
        return status();
      }
      if (child && child.exitCode == null && !force) return status();
      if (await tcpOpen(LOOPBACK, port)) {
        /* ★ 先看是不是**我们自己的孤儿** ✓（详见上面 externalPid 的注释 ✓）——
           端口上那个进程的工作目录 == 本项目 → 认领它 ✓，这样「关闭」才点得动 ✓。 */
        const pid = pidOnPort(port);
        const cwd = cwdOfPid(pid);
        if (pid && cwd && path.resolve(cwd) === path.resolve(projectRoot)) {
          externalPid = pid; owned = true;
          state = 'running';
          message = `已接管此前遗留的 DSH（PID ${pid}）`;
          return status();
        }
        externalPid = pid; owned = false;
        state = 'external';
        message = `已连接端口 ${port} 上现有的 DSH 服务`;
        return status();
      }
      fs.mkdirSync(logDir, { recursive:true });
      appendLog(`\n[${new Date().toISOString()}] CodeScope starting DSH ${cli.version || ''}\n`);
      state = 'starting'; message = '正在启动 DSH…'; tokenUrl = ''; lastExit = null;
      const args = [...cli.prefix, 'web', '--no-open', '--host', LOOPBACK, '--port', String(port)];
      child = spawn(cli.command, args, { cwd:projectRoot, env:cleanChildEnv(), stdio:['ignore', 'pipe', 'pipe'], windowsHide:true });
      owned = true;
      const consume = (chunk) => {
        const text = String(chunk || '');
        appendLog(text);
        const match = text.match(/https?:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+/);
        if (match) tokenUrl = match[0];
      };
      child.stdout.on('data', consume); child.stderr.on('data', consume);
      child.once('error', (error) => { state = 'error'; message = 'DSH 启动失败：' + error.message; appendLog(message + '\n'); });
      child.once('exit', (code, signal) => {
        lastExit = { code, signal, at:new Date().toISOString() };
        child = null; owned = false;
        if (state !== 'stopped') { state = 'error'; message = `DSH 已退出（${signal || code}）`; }
      });
      for (let attempt = 0; attempt < 60; attempt++) {
        if (await tcpOpen(LOOPBACK, port, 250)) {
          state = 'running'; message = 'DSH 已由 CodeScope 托管运行';
          return status();
        }
        if (!child || child.exitCode != null || state === 'error') break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (state !== 'error') { state = 'error'; message = 'DSH 启动超时，请查看运行日志'; }
      return status();
    })();
    try { return await startPromise; } finally { startPromise = null; }
  }

  async function stop() {
    if (child && owned && child.exitCode == null) {
      state = 'stopped'; message = 'DSH 已停止';
      try { child.kill('SIGTERM'); } catch (_) {}
      const active = child;
      await Promise.race([
        new Promise((resolve) => active.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1800)),
      ]);
      if (active.exitCode == null) try { active.kill('SIGKILL'); } catch (_) {}
    } else if (externalPid) {
      /* ★ 端口上那个**不是这次 spawn 的**（孤儿 / 外部启动的）✓ ——
         ⚠️ 老逻辑在这儿**直接拒绝** ✗（「不由 CodeScope 管理，未将其关闭」✓），
            用户就**永远关不掉** ✓（实测用户就是这么报的 ✓）。
         但那个端口是**我们自己的**（`CODESCOPE_DSH_PORT` ✓），
         而且用户是**明确点了「关闭」** ✓ → 该关就关 ✓，把 PID 报出来让用户心里有数 ✓。 */
      try { process.kill(externalPid, 'SIGTERM'); } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (await tcpOpen(LOOPBACK, port, 300)) {
        try { process.kill(externalPid, 'SIGKILL'); } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      const still = await tcpOpen(LOOPBACK, port, 300);
      state = 'stopped';
      message = still
        ? `已尝试关闭端口 ${port} 上的 DSH（PID ${externalPid}），但它还在监听`
        : `已关闭端口 ${port} 上的 DSH（PID ${externalPid}）`;
    } else {
      state = 'stopped'; message = owned ? 'DSH 已停止' : 'DSH 本来就没在运行';
    }
    child = null; owned = false; externalPid = 0; tokenUrl = '';
    return status();
  }

  async function restart() {
    if (owned) await stop();
    else if (await tcpOpen(LOOPBACK, port)) {
      state = 'external'; message = '端口上的 DSH 不由 CodeScope 管理，无法强制重启';
      return status();
    }
    return start(true);
  }

  return { status, start, stop, restart };
}

module.exports = { createDshService };
