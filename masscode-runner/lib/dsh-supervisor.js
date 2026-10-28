'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   DSH 守护进程（supervisor）

   为什么需要它 ✗✗：
   · 用户要求「CodeScope 重启/关闭不影响 DSH」✓ → DSH 必须脱离父进程 ✓
   · 但 DSH **不能用 detached + 忽略 stdio** ✗✗ ——
     它内部的 broker 子进程靠 **stdio 管道**通信 ✓，
     一旦 stdout/stderr 被重定向到普通文件 ✗ → broker 写 EPIPE ✗ →
     `workspace` 插件崩 ✗ → `workspaceRegistry` 起不来 ✗ →
     工作区/会话列表全空 ✓（2026-10-28 实测 ✓）

   ⇒ 折中：**中间加一层常驻守护** ✓
     · CodeScope 只 spawn 这个守护 ✓（detached + stdio ignore ✓，它不需要管道 ✓）
     · 守护去 spawn DSH ✓，**自己持有管道并持续 drain** ✓ → broker 永远有可写的管道 ✓
     · 守护把输出写进日志 ✓，并把 PID / token 写进 state.json ✓
     · CodeScope 退出 ✗ 守护照常活着 ✓ → DSH 不受影响 ✓
     · CodeScope 要「关闭 DSH」→ 杀守护 ✓（守护收到信号后先杀 DSH ✓）

   用法（由 lib/dsh-service.js 调起）：
     node lib/dsh-supervisor.js --command <node> --bin <bin.js> --cwd <dir> \
        --log <path> --state <path> --port <n> -- [dsh args...]
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : '';
}

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const own = sep >= 0 ? argv.slice(0, sep) : argv;
const childArgs = sep >= 0 ? argv.slice(sep + 1) : [];

const command = argValue(own, '--command') || process.execPath;
const bin = argValue(own, '--bin');
const cwd = argValue(own, '--cwd') || process.cwd();
const logPath = argValue(own, '--log');
const statePath = argValue(own, '--state');
const port = argValue(own, '--port') || '3080';

if (!bin) {
  console.error('dsh-supervisor: 缺少 --bin');
  process.exit(2);
}

function appendLog(text) {
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, text);
  } catch (_) {}
}

let tokenUrl = '';
let child = null;
let exiting = false;

function writeState(extra) {
  if (!statePath) return;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      supervisorPid: process.pid,
      childPid: child && child.pid || 0,
      port: Number(port),
      tokenUrl,
      startedAt: new Date().toISOString(),
      ...extra,
    }, null, 2));
  } catch (_) {}
}

function drain(chunk) {
  const text = String(chunk || '');
  appendLog(text);
  const match = text.match(/https?:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+/);
  if (match) { tokenUrl = match[0]; writeState(); }
}

appendLog(`\n[${new Date().toISOString()}] supervisor ${process.pid} 启动 DSH\n`);

child = spawn(command, [bin, ...childArgs], {
  cwd,
  env: process.env,
  /* ⚠️ stdin 必须给**真管道** ✗ 不能 ignore ✓ ——
     workspace 插件的 broker 走 stdio 双向通信 ✓，stdin 是 ignore 时它写就 EPIPE ✓ */
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

child.stdout.on('data', drain);
child.stderr.on('data', drain);
writeState();

child.once('exit', (code, signal) => {
  appendLog(`[${new Date().toISOString()}] DSH 退出（${signal || code}）\n`);
  writeState({ exitedAt: new Date().toISOString(), exitCode: code, exitSignal: signal });
  if (!exiting) process.exit(code == null ? 0 : code);
});

function shutdown(signal) {
  if (exiting) return;
  exiting = true;
  appendLog(`[${new Date().toISOString()}] supervisor 收到 ${signal}，正在关闭 DSH\n`);
  try { if (child && child.exitCode == null) child.kill('SIGTERM'); } catch (_) {}
  setTimeout(() => {
    try { if (child && child.exitCode == null) child.kill('SIGKILL'); } catch (_) {}
    try { if (statePath) fs.unlinkSync(statePath); } catch (_) {}
    process.exit(0);
  }, 2500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => {});   /* 父进程退出发来的 SIGHUP 不能带走我们 ✓ */
