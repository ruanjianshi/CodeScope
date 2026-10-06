#!/usr/bin/env node
/* 邮箱接口的「失败快速返回」与 force 逃生口 —— 隔离实例，不碰真实数据 ✓
   ★ 为什么要测：本机到 imap.gmail.com 是不通的，而用户又确实配了它。
     没有负缓存的话，每次点它都要等一次 TCP 超时（5~15 秒）✗，
     把整个未读数 / 列表都拖慢 ✗。
   ★ 同时必须保证「用户能恢复」：点「重新收信」要能**绕过**负缓存真的去试 ✓，
     否则修好了网络也永远看不到好转 ✗。
   运行：node tests/mail-failfast.js */
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-mailff-'));
const dataHome = path.join(tempRoot, 'data');
fs.mkdirSync(dataHome, { recursive: true });
fs.mkdirSync(path.join(tempRoot, 'vault', 'code'), { recursive: true });

/* 一个**必定连不上但会立刻拒绝**的地址 ✓（127.0.0.1:1 没有监听 → ECONNREFUSED，不挂 10 秒）*/
fs.writeFileSync(path.join(dataHome, 'life-mail.json'), JSON.stringify({
  bad: { user: 'bad@example.com', pass: 'x', host: 'smtp.example.com', port: '465', imapHost: '127.0.0.1', imapPort: '1' },
}, null, 2));

const fails = [];
function ck(name, ok, extra) {
  if (ok) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); fails.push(name); }
}

function freePort() {
  return new Promise((res, rej) => { const p = net.createServer(); p.once('error', rej); p.listen(0, '127.0.0.1', () => { const port = p.address().port; p.close((e) => e ? rej(e) : res(port)); }); });
}
async function waitForServer(url) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url + '/api/version')).ok) return; } catch (_) { } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('服务启动超时');
}

(async () => {
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, CODESCOPE_HOST: '127.0.0.1', CODESCOPE_PORT: String(port), CODESCOPE_VAULT: path.join(tempRoot, 'vault'), CODESCOPE_DATA_HOME: dataHome, CODESCOPE_ONLYOFFICE_URL: 'http://127.0.0.1:1', CODESCOPE_DSH_AUTOSTART: '0', CODESCOPE_AUTO_OFFICE: '0' },
    stdio: 'ignore',
  });
  const get = async (u) => { const r = await fetch(base + u, { cache: 'no-store' }); return r.json(); };
  try {
    await waitForServer(base);

    console.log('── 第一次：真的去连（会失败）──');
    const a = await get('/api/life/mail/boxes?key=bad');
    ck('连不上时返回 ok:false', a.ok === false, JSON.stringify(a).slice(0, 90));
    ck('第一次不算「快速返回」（真的试过了）', !a.cached, 'cached=' + a.cached);

    console.log('\n── 第二次：应当**快速返回**上次的错误 ──');
    const b = await get('/api/life/mail/boxes?key=bad');
    ck('第二次标记 cached', b.cached === true, 'cached=' + b.cached);
    ck('错误信息和第一次一致', b.error === a.error, JSON.stringify(b.error).slice(0, 60));

    console.log('\n── 列表接口也一样快速失败 ──');
    const c = await get('/api/life/mail/list?key=bad&limit=5');
    ck('list 也快速返回', c.ok === false && c.cached === true, JSON.stringify(c).slice(0, 90));

    console.log('\n── ★ force=1 必须**绕过**负缓存（用户唯一的重试手段）──');
    const d = await get('/api/life/mail/boxes?key=bad&force=1');
    ck('force=1 不算 cached（真的去试了）', d.cached !== true, 'cached=' + d.cached);

    console.log('\n── 失败之后又被重新记下 ──');
    const e = await get('/api/life/mail/boxes?key=bad');
    ck('后续请求仍然快速失败', e.cached === true, 'cached=' + e.cached);

    console.log('\n── 参数与账号校验 ──');
    const f = await get('/api/life/mail/list?key=nope&limit=5');
    ck('不存在的账号给明确提示', f.ok === false && /没有这个邮箱账号/.test(f.error || ''), String(f.error).slice(0, 60));
    const g = await get('/api/life/mail/boxes?key=bad&force=1');
    ck('force 不会绕过账号校验', g.ok === false);
    const h = await get('/api/life/mail/status?force=1');
    ck('status 也能正常返回（坏账号不影响整体）', h.ok === true && Array.isArray(h.accounts), JSON.stringify(h).slice(0, 90));
    ck('坏账号在 status 里被标成 ok:false 而不是让整体失败', (h.accounts || []).every((x) => x.ok === false));
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 }); } catch (_) { }
  }
  console.log(fails.length ? '\n邮箱失败快速返回：' + fails.length + ' 项失败：' + fails.join(' / ') : '\n邮箱失败快速返回：全部通过 ✓');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.log('✗ 异常：' + e.message); process.exit(1); });
