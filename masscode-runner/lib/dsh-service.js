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

/* ★★ 启动前清掉**残留的凭据锁** ✗✗ —— 2026-10-11 用户报「CodeScope 无法管理 DSH 的开关」✓。
 *
 * 根因（从日志里挖出来的 ✓）：
 *   `~/.dsh/.credentials.yaml.lock` 是**上一次进程留下的死锁** ✓（文件里写着那个 PID ✓，
 *   进程早没了 ✓）→ DSH 的 `connection` 插件（**必需** ✓）等锁超时 ✓ →
 *   `dsh: startup failed: 1 required plugin did not activate` ✓ → 退出码 1 ✓ →
 *   面板上永远显示「DSH 已退出（1）」✗ —— **点多少次「启动」都没用** ✓，
 *   手动删掉锁文件才好 ✓。**但那不该是解法** ✗。
 *
 * ⚠️⚠️ 判据必须是「**锁里写的那个 PID 还活着吗**」✗，不能看文件年龄 ✓ ——
 *     DSH 冷启动本身就可能几分钟 ✓，按年龄判会**删掉活锁** ✓（那是真事故 ✓）。
 *     拿不到 / 不是数字 / 没权限 → **一律不动** ✓（宁可不修，也不能删活锁 ✗）。
 *
 * 返回一句说明（清掉了才非空 ✓），给面板的 message 用 ✓。
 */
function clearStaleCredentialLock(home) {
  const lock = path.join(home || os.homedir(), '.dsh', '.credentials.yaml.lock');
  let raw;
  try { raw = fs.readFileSync(lock, 'utf8').trim(); } catch (_) { return ''; }
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) return '';
  try {
    process.kill(pid, 0);                       /* 还活着 → 别动 ✓ */
    return '';
  } catch (error) {
    if (error && error.code === 'EPERM') return '';   /* 活着但没权限 → 也别动 ✓ */
  }
  try { fs.unlinkSync(lock); return '（已清掉上一次残留的凭据锁）'; } catch (_) { return ''; }
}

/* ★ 清理 profile 目录里的**残留写锁** ✓（2026-10-21）
   用户报：在 DSH 设置里保存模型配置，弹
   `atomic-write: timed out waiting for the writer lock at ~/.dsh/profiles/web/package.json.lock` ✓。
   实测那个锁是 **10-06 17:29** 留下的 ✓，里面写的 PID（98615）早就不在了 ✓ ——
   某次更新被硬杀（SIGKILL）留下的僵尸锁 ✓，DSH 一直没接管它 ✓。
   插件市场自己的说明也写着：「确认没有安装或更新正在进行后，删掉这个文件再重试」✓，
   但它**故意不替用户删** ✗（怕撞上进行中的操作 ✓）—— 那就在**启动前**替用户清掉 ✓。

   ⚠️ 判据只有一条：**锁里的 PID 死了才删** ✓✓ ——
      活着（或 EPERM 说明活着但没权限）一律不动 ✓，否则会两个进程同时写 package.json ✓。
   只在 spawn 之前调用 ✓ —— 那时端口没人监听 ✓，不存在进行中的写操作 ✓。 */
function clearStaleProfileLocks(home) {
  const root = path.join(home || os.homedir(), '.dsh', 'profiles');
  let profiles = [];
  try { profiles = fs.readdirSync(root); } catch (_) { return ''; }
  const cleared = [];
  for (const name of profiles) {
    const dir = path.join(root, name);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.lock')); } catch (_) { continue; }
    for (const file of files) {
      const full = path.join(dir, file);
      let pid = 0;
      try { pid = Number(fs.readFileSync(full, 'utf8').trim()); } catch (_) { continue; }
      if (!Number.isFinite(pid) || pid <= 0) continue;      /* 内容不是 PID → 不是我们的锁，别动 ✓ */
      let alive = false;
      try { process.kill(pid, 0); alive = true; }
      catch (error) { if (error && error.code === 'EPERM') alive = true; }
      if (alive) continue;                                   /* 活锁 → 绝不删 ✓✓ */
      try { fs.unlinkSync(full); cleared.push(name + '/' + file); } catch (_) {}
    }
  }
  return cleared.length ? `（已清掉 ${cleared.length} 个残留写锁：${cleared.join('、')}）` : '';
}

function createDshService(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
  const dataRoot = options.dataRoot || path.join(os.tmpdir(), 'codescope');
  const port = validPort(process.env.CODESCOPE_DSH_PORT, 3080);
  const autoStart = flag('CODESCOPE_DSH_AUTOSTART', true);
  const cli = resolveDshCli(projectRoot);
  const logDir = path.join(dataRoot, 'dsh');
  const logPath = path.join(logDir, 'dsh.log');
  /* supervisor：让 DSH 脱离 CodeScope 但**保住 stdio 管道** ✓（见 lib/dsh-supervisor.js） */
  const supervisorPath = path.join(__dirname, 'dsh-supervisor.js');
  const statePath = path.join(logDir, 'supervisor.json');
  const readState = () => {
    try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return null; }
  };
  const pidAlive = (pid) => {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return !!(error && error.code === 'EPERM'); }
  };
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
  let lastOutputLine = '';
  let startPromise = null;
  let readyTimer = null;

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
        const st0 = readState();
        if (st0 && pidAlive(st0.supervisorPid)) {
          externalPid = st0.supervisorPid; owned = true;
          tokenUrl = st0.tokenUrl || tokenUrl;
          state = 'running';
          message = `已接管此前遗留的 DSH（supervisor PID ${st0.supervisorPid}）`;
          return status();
        }
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
      /* ⚠️ **先清死锁再 spawn** ✗ —— 否则 DSH 必然启动失败（见 clearStaleCredentialLock ✓）。 */
      const lockNote = clearStaleCredentialLock(options.home) + clearStaleProfileLocks(options.home);
      appendLog(`\n[${new Date().toISOString()}] CodeScope starting DSH ${cli.version || ''}${lockNote}\n`);
      state = 'starting'; message = '正在启动 DSH…' + lockNote; tokenUrl = ''; lastExit = null;
      const args = [...cli.prefix, 'web', '--no-open', '--host', LOOPBACK, '--port', String(port)];
      /* ★★ 生命周期独立（2026-10-28 用户要求）★★
         「CodeScope 重启/关闭不影响 DSH，但要能管理它的开启和关闭」✓
         ⇒ `detached:true` 让它自成一个进程组 ✓ + `unref()` ✓
         ⇒ 输出**直接写日志文件**（不再走管道 ✗）——
           父进程一退管道就断 ✓，子进程写 stdout 会 EPIPE ✗ 甚至被带走 ✓
         ⇒ 令牌地址改从**日志尾巴**里解析 ✓（原来读 stdout ✗） */
      /* ⚠️⚠️ 必须是 **pipe** ✗ 不能把 stdio 重定向到日志文件 ✓
         DSH 内部的 broker 子进程靠 **stdio 管道**通信 ✓
         一旦 stdio 变成普通文件 → broker 写 EPIPE ✗ →
         `workspace` 插件崩溃 ✗ → `workspaceRegistry` 起不来 ✗ →
         工作区列表全空（用户实测「东西呢」）✓
         ⇒ 保持 pipe ✓；脱离父进程的事交给 **supervisor** ✓ */
      /* ⚠️ 不直接 spawn DSH ✗ —— 交给 supervisor ✓
         · supervisor 自己 detach（stdio ignore）→ CodeScope 退出它照活 ✓
         · supervisor 持有 DSH 的 stdio 管道并持续 drain ✓ → broker 不会 EPIPE ✓ */
      const bin = cli.bundled ? cli.path : '';
      child = spawn(process.execPath, [
        supervisorPath,
        '--command', cli.command,
        '--bin', bin || cli.path,
        '--cwd', projectRoot,
        '--log', logPath,
        '--state', statePath,
        '--port', String(port),
        '--',
        ...(cli.bundled ? [] : []),
        'web', '--no-open', '--host', LOOPBACK, '--port', String(port),
      ], {
        cwd: projectRoot,
        env: cleanChildEnv(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      if (child && child.unref) child.unref();
      owned = true;
      const consume = (chunk) => {
        const text = String(chunk || '');
        appendLog(text);
        const match = text.match(/https?:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+/);
        if (match) tokenUrl = match[0];
        const tail = text.split('\n').map((l) => l.trim()).filter(Boolean).pop();
        if (tail) lastOutputLine = tail.slice(0, 160);
      };
      /* 从日志尾巴里找 token 行 ✓（子进程已经和我们解绑，读不到它的 stdout ✗） */
      const tailLog = () => {
        const st = readState();
        if (st && st.tokenUrl) tokenUrl = st.tokenUrl;
        try {
          const buf = fs.readFileSync(logPath, 'utf8');
          const slice = buf.slice(-8000);
          if (!tokenUrl) {
            const match = slice.match(/https?:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+/);
            if (match) tokenUrl = match[0];
          }
          const tail = slice.split('\n').map((l) => l.trim()).filter(Boolean).pop();
          if (tail) lastOutputLine = tail.slice(0, 160);
        } catch (_) {}
      };
      tailLog();
      child.once('error', (error) => { state = 'error'; message = 'DSH 启动失败：' + error.message; appendLog(message + '\n'); });
      child.once('exit', (code, signal) => {
        lastExit = { code, signal, at:new Date().toISOString() };
        child = null; owned = false;
        /* 进程没了，后台的「等就绪」也没意义了 ✓ */
        if (readyTimer) { clearInterval(readyTimer); readyTimer = null; }
        /* ⚠️ 报错要**指路** ✗ —— 原来只说「DSH 已退出（1）」✓，用户不知道去哪看 ✓（这次就卡在这 ✓）。 */
        if (state !== 'stopped') { state = 'error'; message = `DSH 已退出（${signal || code}）—— 详情见运行日志`; }
      });
      /* ★★ 就绪判定重做 ✓✓（2026-10-21，用户：「DSH 启动不了了」）★★
         ⚠️ 原来只等 `60 × 150ms ≈ 9 秒` ✗ —— 而**实测冷启动要 19.8 秒**才监听端口 ✓
            （15 个插件 bundle 要逐个挂载 ✓），于是**每次都被判超时** ✓；
            更糟的是：超时后状态钉死在 `error` ✓，等它 20 秒后真的起来了也没人再管 ✗
            → 界面永远显示「未运行」，可 `lsof` 明明看到 3080 在监听 ✓（这次就是这样 ✓）。
         现在三件事一起改：
         ① 总窗口 45s，并且**认 token 行**（`dsh web: http://…?token=…` 才是真就绪 ✓）；
         ② 请求里最多阻塞 12s（不让 HTTP 请求挂太久），剩下的交给后台盯 ✓；
         ③ 后台每 1s 复查端口，起来了就翻成 running ✓ —— 不再「一次判死」✓。 */
      const READY_DEADLINE_MS = 45000;
      const BLOCK_BUDGET_MS = 12000;
      let waited = 0;
      while (waited < READY_DEADLINE_MS) {
        tailLog();
        if (tokenUrl || await tcpOpen(LOOPBACK, port, 250)) {
          state = 'running'; message = 'DSH 已由 CodeScope 托管运行';
          return status();
        }
        if (!child || child.exitCode != null || state === 'error') break;
        if (waited >= BLOCK_BUDGET_MS) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
        waited += 200;
      }
      if (state !== 'error' && child && child.exitCode == null) {
        state = 'starting';
        message = 'DSH 正在启动（插件较多，首次约 20 秒）…';
        watchUntilReady();
      } else if (state !== 'error') {
        state = 'error';
        message = 'DSH 启动超时，请查看运行日志' + (lastOutputLine ? '：' + lastOutputLine : '');
      }
      return status();
    })();
    try { return await startPromise; } finally { startPromise = null; }
  }

  /* 后台等 DSH 真正监听端口 ✓ —— 启动慢不该被判成失败 ✓（见上面 start() 的注释 ✓） */
  function watchUntilReady() {
    if (readyTimer) { clearInterval(readyTimer); readyTimer = null; }
    const startedAt = Date.now();
    readyTimer = setInterval(async () => {
      if (state !== 'starting') { clearInterval(readyTimer); readyTimer = null; return; }
      if (!child || child.exitCode != null) { clearInterval(readyTimer); readyTimer = null; return; }
      tailLog();
      if (await tcpOpen(LOOPBACK, port, 300)) {
        clearInterval(readyTimer); readyTimer = null;
        state = 'running';
        message = 'DSH 已由 CodeScope 托管运行';
        appendLog(`[${new Date().toISOString()}] DSH 端口 ${port} 已就绪（后台等了 ${Math.round((Date.now() - startedAt) / 1000)}s）\n`);
        return;
      }
      if (Date.now() - startedAt > 120000) {
        clearInterval(readyTimer); readyTimer = null;
        state = 'error';
        message = 'DSH 启动超时（2 分钟仍未监听端口）' + (lastOutputLine ? '：' + lastOutputLine : '');
      }
    }, 1000);
    if (readyTimer.unref) readyTimer.unref();
  }

  async function stop() {
    if (child && owned && child.exitCode == null) {
      state = 'stopped'; message = 'DSH 已停止';
      const active = child;
      const killTree = (signal) => {
        /* detached → 它自成一个进程组 ✓ 杀组才能连它拉起的子进程一起收掉 ✓ */
        try { process.kill(-active.pid, signal); return; } catch (_) {}
        try { active.kill(signal); } catch (_) {}
      };
      killTree('SIGTERM');
      await Promise.race([
        new Promise((resolve) => active.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1800)),
      ]);
      if (active.exitCode == null) killTree('SIGKILL');
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
    if (readyTimer) { clearInterval(readyTimer); readyTimer = null; }
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

module.exports = { createDshService, clearStaleCredentialLock, clearStaleProfileLocks };
