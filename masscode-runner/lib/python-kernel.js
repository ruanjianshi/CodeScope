'use strict';
/**
 * Jupyter 式持久 Python 内核（2026-10-10）
 *
 * ⚠️ 为什么要有 ✗✗：
 *   用户原话：「还有 python 语言支持吗，不支持运行，记得给我开发，可以支持运行，
 *             我需要可以实现 jupyter 那种方式运行」✓。
 *   其实 Python **本来就支持运行** ✓（server.js 的 runnerFor 里有 case 'python' ✓），
 *   但那是**每次跑一个新进程** ✗ —— 变量跑完就没了 ✓，
 *   而 Jupyter 的核心价值恰恰是「**变量跨单元格保留**」✓✓
 *   （先在上一格读数据、这一格慢慢分析，不用每次从头跑 ✓）。
 *
 * ✅ 做法：起**一个长期存活的 python 进程** ✓，代码一行行喂进去，
 *    用**哨兵行**判断这一格跑完了 ✓。
 *
 * ⚠️⚠️ 两个关键细节（不处理就会很难用 ✗）：
 *   ① **提示符会混进输出** ✗ —— 交互式 python 会往 stdout 打 `>>> ` / `... ` ✓。
 *      解法：启动时把 `sys.ps1` / `sys.ps2` 设成空串 ✓
 *      （用 `-i -c "import sys; sys.ps1=''; sys.ps2=''"` ✓ ——
 *       `-c` 先执行、然后进入交互 ✓）。
 *   ② **stdout 和 stderr 是两条流** ✗ —— 分开收集 ✓，
 *      按到达顺序各自排队 ✓；`traceback` 走 stderr ✓，
 *      所以要把它一起回给前端 ✓，否则报错看不到 ✓。
 *
 * ⚠️ 串行化 ✗：内核一次只能跑一格 ✓（共享同一份变量 ✓）——
 *    用一条 Promise 队列把并发请求排队 ✓，别让两段代码交错执行 ✓。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

/* 哨兵：每格一个唯一标记，出现在 stdout 就说明这格跑完了 ✓ */
const SENT_PREFIX = '__CODESCOPE_CELL_DONE__';

function createPythonKernel(options = {}) {
  const { pythonCmd, spawn, execFileSync } = options;
  if (typeof pythonCmd !== 'function') throw new Error('createPythonKernel 需要 pythonCmd');
  if (typeof spawn !== 'function') throw new Error('createPythonKernel 需要 spawn');

  let proc = null;
  let cwd = '';
  let stdoutBuf = '';
  let stderrBuf = '';
  let seq = 0;
  let waiting = null;      /* 当前在等哨兵的那一格 ✓ */
  let queue = Promise.resolve();
  let startedAt = 0;
  let cellCount = 0;

  function alive() { return !!(proc && proc.exitCode === null && !proc.killed); }

  function kill() {
    if (!proc) return false;
    try { proc.kill('SIGKILL'); } catch (_) {}
    proc = null;
    waiting = null;
    stdoutBuf = ''; stderrBuf = '';
    return true;
  }

  function start(workdir) {
    if (alive()) return { ok: true, reused: true, pid: proc.pid, cwd };
    const py = pythonCmd();
    if (!py) return { ok: false, error: '没有可用的 python' };
    cwd = workdir || process.cwd();
    /* ⚠️ -u 关缓冲 ✓（否则输出会卡在管道里 ✓）；
       -i 保持交互 ✓；-c 先把提示符清空再进交互 ✓。 */
    proc = spawn(py, ['-u', '-i', '-c', "import sys; sys.ps1=''; sys.ps2=''"], {
      cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;
      if (waiting) tryFinish(waiting);
    });
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk;
      if (waiting) tryFinish(waiting);
    });
    proc.on('exit', () => { if (waiting) { waiting.reject(new Error('内核已退出')); waiting = null; } proc = null; });
    proc.on('error', (e) => { if (waiting) { waiting.reject(e); waiting = null; } });
    startedAt = Date.now();
    cellCount = 0;
    return { ok: true, reused: false, pid: proc.pid, cwd, python: py };
  }

  /* 每来一块数据都看看哨兵到了没 ✓ —— 到了就把这一格的输出交出去 ✓ */
  function tryFinish(task) {
    const idx = stdoutBuf.indexOf(task.sentinel);
    if (idx < 0) return;
    const out = stdoutBuf.slice(0, idx);
    const rest = stdoutBuf.slice(idx + task.sentinel.length).replace(/^\r?\n/, '');
    const err = stderrBuf;
    stdoutBuf = rest;
    stderrBuf = '';
    waiting = null;
    cellCount += 1;
    /* 临时 cell 文件用完就删 ✓（别在 /tmp 里堆 ✓）*/
    if (task.cellFile) { try { fs.unlinkSync(task.cellFile); } catch (_) {} }
    task.resolve({ ok: true, stdout: out, stderr: err, index: task.index, ms: Date.now() - task.t0 });
  }

  /* 执行一格 ✓ —— 串行排队，避免两段代码交错 ✓ */
  function exec(code, opts = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (!alive()) { const s = start(opts.cwd); if (!s.ok) return reject(new Error(s.error)); }
      const src = String(code == null ? '' : code);
      if (!src.trim()) return resolve({ ok: true, stdout: '', stderr: '', index: cellCount, ms: 0, empty: true });
      /* ⚠️⚠️ 整格**写成临时文件再 exec** ✗✗（不要直接往 stdin 里灌代码 ✓）——
         原因：交互式 python 靠「空行」判断 `def` / `for` / `if` 这些块结束 ✓，
         直接灌多行代码时块边界很容易判错 ✓
         （实测踩过：`def f(n):\n    return n*n\nprint(...)` 直接报
           `SyntaxError: invalid syntax`，REPL 把 print 当成了函数体 ✓）。
         → 改用 `exec(compile(open(文件).read(), '<cell>', 'exec'))` ✓：
           ① 只有**一条**语句，REPL 不用猜块边界 ✓；
           ② 报错信息里显示 `<cell>`，比 `<stdin>` 清楚 ✓；
           ③ exec 在**交互命名空间**里执行 ✓，所以变量照样跨格保留 ✓✓。 */
      const cellFile = path.join(os.tmpdir(), 'codescope-cell-' + process.pid + '-' + (++seq) + '.py');
      try { fs.writeFileSync(cellFile, src, 'utf8'); }
      catch (e) { waiting = null; return reject(e); }
      const sentinel = SENT_PREFIX + seq + '__';
      const task = { sentinel, resolve, reject, t0: Date.now(), index: cellCount, cellFile };
      waiting = task;
      const payload = 'exec(compile(open(' + JSON.stringify(cellFile) + ", encoding='utf-8').read(), '<cell>', 'exec'))\n"
        + 'print(' + JSON.stringify(sentinel) + ')\n';
      try { proc.stdin.write(payload); }
      catch (e) { waiting = null; return reject(e); }
    });
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  function status() {
    return {
      running: alive(),
      pid: alive() ? proc.pid : 0,
      cwd,
      cells: cellCount,
      uptimeMs: alive() ? Date.now() - startedAt : 0,
    };
  }

  return { start, exec, kill, status, alive };
}

module.exports = { createPythonKernel, SENT_PREFIX };
