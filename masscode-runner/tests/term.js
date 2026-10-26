#!/usr/bin/env node
'use strict';
/**
 * 底部终端专项测试（/api/term/*）
 *
 * ── 为什么要有这个（2026-10-19）───────────────────────────────────────────────
 * 用户截图：终端面板一片红字「连接断开」，内容只有一句「终端启动失败」✓。
 * 挖出来是**两个**独立的 bug，而且都没有任何测试守着 ✗：
 *
 *  ① `lib/routes/term.js` 里判的是 `const { TERM } = ctx` ✓ ——
 *     那是**调用那一刻拷进 ctx 的旧值** ✗，而 `termSpawn()` 改的是 server.js 的
 *     模块级变量 ✓ → spawn 成功之后这里**仍然是 null** ✗ →
 *     永远 `res.end('终端启动失败')` ✓，而且**每来一次请求就多开一个 shell** ✓（泄漏）。
 *  ② 那条分支写的是裸 `return;`（undefined）✗ —— 流还开着、`res.writableEnded` 是 false ✓
 *     → 调用方当成「没处理」→ 继续往下走 → 撞 404 兜底 → 对已 writeHead 的响应再写头 →
 *     `ERR_HTTP_HEADERS_SENT` → 外层 catch 里 `res.destroy()` → **连接直接断开** ✓。
 *     （和 2026-10-11 system-panel SSE 那次是同一个坑 ✓）
 *
 * ── 这个测试守什么 ──────────────────────────────────────────────────────────
 *  A 流能开：200 + `X-CodeScope-Terminal-Replay` 头 + 正文**不是**「终端启动失败」
 *  B 流不会立刻被掐断（②的回归）
 *  C 能往同一个会话里写命令、并真的收到回显（①的回归：证明拿到的 session 是真的）
 *  D resize / stop 接口契约
 *  E stop 之后能重新拉起（不会卡在「终端尚未连接」）
 *
 * 跑法：node tests/term.js
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-term-test-'));
const vault = path.join(tempRoot, 'vault');
fs.mkdirSync(path.join(vault, 'code'), { recursive: true });

let child = null;
let base = '';
let pass = 0;
let fail = 0;
const ck = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
};

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((e) => (e ? reject(e) : resolve(port)));
    });
  });
}

async function startServer() {
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  const out = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODESCOPE_HOST: '127.0.0.1',
      CODESCOPE_PORT: String(port),
      CODESCOPE_VAULT: vault,
      CODESCOPE_DATA_HOME: path.join(tempRoot, 'data'),
      CODESCOPE_DSH_AUTOSTART: '0',
      CODESCOPE_DSH_PORT: '3099',
      /* ⚠️ 测试机可能没有 NO_PROXY ✓ → 显式清掉代理变量，
         否则 fetch 会绕去 http_proxy 上，测出来的是代理的行为 ✗ */
      http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => out.push(String(c)));
  child.stderr.on('data', (c) => out.push(String(c)));
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch(base + '/api/version'); if (r.ok) return out; } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务启动超时：\n' + out.join(''));
}

async function post(pathname, body) {
  const r = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
}

/** 读流，最多等 ms 毫秒，返回 { text, status, replay, open } */
async function readStream(ms, stopWhen) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let text = '', status = 0, replay = null, open = false;
  try {
    const resp = await fetch(base + '/api/term/stream', { signal: ctrl.signal });
    status = resp.status;
    replay = resp.headers.get('X-CodeScope-Terminal-Replay');
    /* 头都拿到了 → 这条流就是**开着**的 ✓（后面读到超时被 abort 属于正常 ✓，
       不能因此判成「断了」✗ —— 那正是这个流该有的样子 ✓） */
    open = true;
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { open = false; break; }   // 真被服务端结束了
      text += dec.decode(value, { stream: true });
      if (stopWhen && stopWhen(text)) break;
    }
  } catch (e) {
    if (!status) open = false;             // fetch 本身失败（连不上 / 空响应）
  } finally {
    clearTimeout(timer);
  }
  return { text, status, replay, open };
}

(async () => {
  console.log('底部终端测试（/api/term/*）');
  try {
    await startServer();

    console.log('\nA 流能开');
    /* ⚠️ 给足时间：交互式 shell 要跑完 rc（starship / conda hook …）才吐提示符 ✓，
       实测本机首次要 1~3 秒 ✓ —— 等太短会误判成「没内容」✗ */
    const s1 = await readStream(6000, (t) => t.length > 0);
    ck('GET /api/term/stream 返回 200（不是 404 / 不是空响应）', s1.status === 200, 'status=' + s1.status);
    ck('带 X-CodeScope-Terminal-Replay 头', s1.replay === '1', 'replay=' + s1.replay);
    ck('正文不是「终端启动失败」', !/终端启动失败/.test(s1.text), JSON.stringify(s1.text.slice(0, 120)));
    ck('能读到内容（shell 首屏 / 提示符）', s1.text.length > 0, 'len=' + s1.text.length);

    console.log('\nB 流不会立刻被掐断');
    ck('读到内容之后连接仍然开着（没有 Empty reply）', s1.open === true);

    console.log('\nC 能写命令并收到回显');
    const w = await post('/api/term/input', { data: 'echo TERM_PROBE_$((6*7))\n' });
    ck('POST /api/term/input 返回 ok（不是「终端尚未连接」）', w.status === 200 && w.data.ok === true, JSON.stringify(w.data));
    const s2 = await readStream(9000, (t) => /TERM_PROBE_42/.test(t));
    ck('同一会话里能收到 TERM_PROBE_42', /TERM_PROBE_42/.test(s2.text), JSON.stringify(s2.text.slice(-200)));

    console.log('\nD resize / stop 契约');
    const rz = await post('/api/term/resize', { cols: 100, rows: 30 });
    ck('POST /api/term/resize 返回 ok', rz.status === 200 && rz.data.ok === true, JSON.stringify(rz.data));
    const st = await post('/api/term/stop');
    ck('POST /api/term/stop 返回 ok', st.status === 200 && st.data.ok === true, JSON.stringify(st.data));

    console.log('\nE stop 之后能重新拉起');
    const s3 = await readStream(1500);
    ck('再次 GET 流仍是 200', s3.status === 200, 'status=' + s3.status);
    ck('新会话不是「终端启动失败」', !/终端启动失败/.test(s3.text), JSON.stringify(s3.text.slice(0, 120)));
    ck('新会话的流也是开着的（不会一开就断）', s3.open === true);
  } catch (e) {
    fail++;
    console.log('  ❌ 测试异常：' + (e && e.message));
  } finally {
    if (child) { try { child.kill('SIGKILL'); } catch (_) {} }
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
  }
  console.log('\n' + (fail ? '失败 ' + fail + ' 项' : '全部通过 ✅') + '（通过 ' + pass + ' · 失败 ' + fail + '）');
  process.exit(fail ? 1 : 0);
})();
