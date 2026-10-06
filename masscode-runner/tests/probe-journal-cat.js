#!/usr/bin/env node
/* 隔离探针：日记「改分类丢内容」
   —— 只在临时 vault / data 上跑 ✓，**绝不碰真实用户数据** ✓（见 CODESCOPE_VAULT / CODESCOPE_DATA_HOME）
   验证 3 件事：
     ① 改分类后，编辑框里的正文还在 ✓
     ② 改分类后，落盘的 text 字段**一个字节都没变** ✓（只动了 cat）
     ③ 打字后**立刻**改分类（600ms 防抖还没触发）→ 刚敲的字也保住 ✓
     ④ 筛选某个分类时，编辑别的分类的日记 → 编辑器仍显示那天的**真内容**（不是模板）✓ */
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-jcat-'));
const vault = path.join(tempRoot, 'vault');
let server, browser;

function browserExecutable() {
  if (process.env.CODESCOPE_BROWSER && fs.existsSync(process.env.CODESCOPE_BROWSER)) return process.env.CODESCOPE_BROWSER;
  const fixed = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : [];
  for (const c of fixed) if (fs.existsSync(c)) return c;
  if (process.platform !== 'win32') for (const c of ['google-chrome', 'chromium']) {
    try { return execFileSync('which', [c], { encoding: 'utf8', timeout: 1500 }).trim(); } catch (_) { }
  }
  return '';
}

function freePort() {
  return new Promise((res, rej) => { const p = net.createServer(); p.once('error', rej); p.listen(0, '127.0.0.1', () => { const port = p.address().port; p.close((e) => e ? rej(e) : res(port)); }); });
}

async function waitForServer(url) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url + '/api/version')).ok) return; } catch (_) { } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('服务启动超时');
}

const fails = [];
function check(name, ok, extra) {
  if (ok) console.log('  ✅ ' + name);
  else { console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); fails.push(name); }
}

async function main() {
  const exe = browserExecutable();
  if (!exe) { console.log('跳过：未找到 Chrome'); return; }
  fs.mkdirSync(path.join(vault, 'code'), { recursive: true });
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, CODESCOPE_HOST: '127.0.0.1', CODESCOPE_PORT: String(port), CODESCOPE_VAULT: vault, CODESCOPE_DATA_HOME: path.join(tempRoot, 'data'), CODESCOPE_ONLYOFFICE_URL: 'http://127.0.0.1:1', CODESCOPE_DSH_AUTOSTART: '0', CODESCOPE_AUTO_OFFICE: '0' },
    stdio: 'ignore',
  });
  await waitForServer(base);

  /* 预置一篇日记：今天，分类「工作」，正文有明确标记 */
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayK = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const BODY = '# 探针正文\n\n- [ ] 这一行必须活下来\n\n绝对不能被模板覆盖 ABCDEFG';
  const store = {
    version: 1,
    journalCats: ['学习', '工作', '生活', '科研'],
    journal: [{ date: todayK, text: BODY, cat: '工作', at: Date.now() }],
    journalSel: todayK,
    journalMonth: todayK.slice(0, 7),
  };
  await fetch(base + '/api/life/store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(store) });

  browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => { console.log('  ⚠️ 页面异常：' + e.message); });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-lifework', { timeout: 15000 });
  await page.click('#btn-lifework');
  await page.waitForSelector('#lifework-view', { timeout: 15000 });
  await page.click('.lw-nav button[data-tab="journal"]');
  await page.waitForSelector('#lw-j-ce', { timeout: 15000 });
  await page.waitForTimeout(400);

  const readCe = () => page.evaluate(() => Array.from(document.querySelectorAll('#lw-j-ce > .ln'))
    .map((el) => el.classList.contains('cur') ? String(el.textContent || '') : String(el.dataset.src || '')).join('\n'));

  const readStore = async () => { const r = await (await fetch(base + '/api/life/store')).json(); return (r && r.data) || {}; };

  /* ── ① 初始：编辑器显示真内容（不是模板）── */
  const t0 = await readCe();
  check('① 打开时编辑器显示的是真正文', t0.includes('绝对不能被模板覆盖 ABCDEFG'), JSON.stringify(t0.slice(0, 60)));

  /* ── ② 改分类 → 正文必须还在 ── */
  await page.selectOption('#lw-j-catsel', '生活');
  await page.waitForTimeout(400);
  const t1 = await readCe();
  check('② 改分类后编辑器正文仍在', t1.includes('绝对不能被模板覆盖 ABCDEFG'), JSON.stringify(t1.slice(0, 60)));
  const s1 = await readStore();
  const e1 = (s1.journal || []).find((x) => x.date === todayK) || {};
  check('② 改分类后落盘 text 未变', String(e1.text || '') === BODY, JSON.stringify(String(e1.text || '').slice(0, 60)));
  check('② 改分类真的生效（cat=生活）', e1.cat === '生活', 'cat=' + e1.cat);

  /* ── ③ 打字后**立刻**改分类（防抖 600ms 内）→ 刚敲的字也要在 ──
     ⚠️ 必须在**同一个同步任务**里完成「输入 + 改分类」✗ ——
        用 page.keyboard.type + page.selectOption 的话，Playwright 的可操作性检查
        本身就耗时 >600ms ✗，防抖早跑完了 → 这条用例会**假通过** ✗（实测踩过）。 */
  await page.evaluate(() => {
    const cur = document.querySelector('#lw-j-ce > .ln.cur');
    cur.focus();
    const r = document.createRange(); r.selectNodeContents(cur); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    cur.textContent = String(cur.textContent || '') + ' 刚敲的字ZZZ';
    cur.dispatchEvent(new Event('input', { bubbles: true }));   /* 只启动 600ms 防抖，不落盘 */
    const sel = document.querySelector('#lw-j-catsel');         /* 立刻改分类（0ms，防抖必然没跑）*/
    sel.value = '科研';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const t2 = await readCe();
  check('③ 防抖未触发时改分类，刚敲的字没丢', t2.includes('刚敲的字ZZZ'), JSON.stringify(t2.slice(-40)));
  const s2 = await readStore();
  const e2 = (s2.journal || []).find((x) => x.date === todayK) || {};
  check('③ 落盘里也有刚敲的字', String(e2.text || '').includes('刚敲的字ZZZ'), JSON.stringify(String(e2.text || '').slice(-40)));
  check('③ 落盘里正文没被模板覆盖', String(e2.text || '').includes('绝对不能被模板覆盖 ABCDEFG'));

  /* ── ④ 筛选「学习」时，编辑这篇「科研」的 → 仍显示真内容 ── */
  await page.click('.lw-cats .row[data-jcat="学习"]');
  await page.waitForTimeout(400);
  const t3 = await readCe();
  check('④ 筛选别的分类时编辑器仍显示这天真内容', t3.includes('绝对不能被模板覆盖 ABCDEFG'), JSON.stringify(t3.slice(0, 60)));
  const hd = await page.textContent('#lw-jr-edit h3');
  check('④ 标题提示「不在筛选内」', /不在/.test(hd || ''), hd);

  /* ── ⑤ 切日期再切回来 → 内容完好 ── */
  await page.click('.lw-cats .row[data-jcat=""]');
  await page.waitForTimeout(300);
  const t4 = await readCe();
  check('⑤ 取消筛选后正文仍完好', t4.includes('绝对不能被模板覆盖 ABCDEFG'), JSON.stringify(t4.slice(0, 60)));
  const s4 = await readStore();
  const e4 = (s4.journal || []).find((x) => x.date === todayK) || {};
  check('⑤ 最终落盘只有一条今天的日记', (s4.journal || []).filter((x) => x.date === todayK).length === 1);
  check('⑤ 最终落盘分类仍是科研', e4.cat === '科研', 'cat=' + e4.cat);

  await browser.close(); browser = null;
  server.kill('SIGTERM'); server = null;
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 }); } catch (_) { }
  console.log(fails.length ? '\n探针失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error('探针异常：', e && e.message);
  try { if (browser) browser.close(); } catch (_) { }
  try { if (server) server.kill('SIGKILL'); } catch (_) { }
  process.exit(1);
});
