#!/usr/bin/env node
'use strict';
/**
 * 快捷键「假承诺」检查（2026-10-09）
 *
 * ⚠️ 为什么要写这个 ✗✗：
 *   本会话里发现按钮 title 写着「撤销（⌘Z）」，但**根本没实现 ⌘Z** ——
 *   这类问题**代码 review 很难发现**，因为它「看起来是对的」✓。
 *   同类还有：「自动同步」开关打开但没真的跑 ✓、「Esc = 取消」实际没绑 ✓。
 *
 * ⚠️ 为什么**不做纯静态检查** ✗✗：
 *   本会话我的静态检查累计**误报 4 次** ✓（正则扫压缩 JS 不可靠 ✓）。
 *   → 这里只把静态扫描当**输入**（找出「谁声明了快捷键」）✓，
 *     真正的判定靠**运行时**：在浏览器里**真的按一下** ✓，
 *     看 DOM 有没有变化 ✓。
 *
 * 判据：按下之后 600ms 内 **DOM 一次都没变** → 判定为「死快捷键」✗。
 * ⚠️ 少数快捷键**本来就不改 DOM**（复制 / 粘贴改的是剪贴板 ✓）→ 白名单 ✓。
 *
 * 运行：node tests/shortcut-titles.js
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-shortcut-'));
const vault = path.join(tempRoot, 'vault');
let server, browser;

/* 这些快捷键**本来就不改 DOM** ✓（改的是剪贴板 / 系统状态 ✓），不该报死 ✓ */
const NO_DOM_EFFECT = new Set(['⌘C', '⌘V', '⌘/Ctrl+C', '⌘/Ctrl+V']);

function browserExecutable() {
  if (process.env.CODESCOPE_BROWSER && fs.existsSync(process.env.CODESCOPE_BROWSER)) return process.env.CODESCOPE_BROWSER;
  const fixed = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : [];
  for (const c of fixed) if (fs.existsSync(c)) return c;
  return '';
}
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close((e) => (e ? reject(e) : resolve(p))); });
  });
}
async function waitForServer(url) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url + '/api/version')).ok) return; } catch (_) {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('测试服务启动超时');
}

/* ① 静态扫描：谁在 title 里声明了快捷键 ✓（只当输入用 ✓） */
function declaredShortcuts() {
  const out = new Map();
  for (const f of ['index.html', 'assets/app.js', 'assets/life-workbench.js', 'assets/system-panel.js']) {
    let s = '';
    try { s = fs.readFileSync(path.join(projectRoot, f), 'utf8'); } catch (_) { continue; }
    for (const m of s.matchAll(/title\s*=\s*["']([^"']*?(?:⌘|Ctrl\+|Cmd\+)[^"']*?)["']/g)) {
      const keys = [...m[1].matchAll(/[（(]\s*((?:⌘|Ctrl\+|Cmd\+)[^）)]*)[）)]/g)].map((x) => x[1].trim());
      for (const k of keys) if (!out.has(k)) out.set(k, { key: k, file: f, title: m[1].slice(0, 46) });
    }
  }
  return [...out.values()];
}

/* 把声明里的快捷键转成 Playwright 能按的组合 ✓ */
function toPlaywright(key) {
  const k = String(key).split('/').pop().trim();   /* 「⌘/Ctrl+-」→「Ctrl+-」✓ */
  const parts = k.split('+').map((x) => x.trim()).filter(Boolean);
  const mods = [];
  let main = '';
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === 'ctrl' || low === 'cmd' || low === '⌘') mods.push('Control');
    else if (low === 'shift' || low === '⇧') mods.push('Shift');
    else if (low === 'alt' || low === '⌥') mods.push('Alt');
    else main = p;
  }
  /* ⚠️ '⌘/Ctrl++' 这种「尾巴本身是 +」的写法 ✗ ——
     split('+') 会把它拆成空串 ✓，所以要在**守卫之前**兜住 ✓
     （上次插在守卫后面 → 永远走不到 ✓）。 */
  if (main === '' && /\+$/.test(k)) main = '+';
  if (!main) return '';
  const named = { '⇧': 'Shift', '⌘': 'Meta', '-': 'Minus', '+': 'Equal', '=': 'Equal' };
  /* ⚠️ '⌘/Ctrl++' 这种「尾巴本身是 +」的写法 ✗ ——
     split('+') 会把它拆成空串 ✓，这里单独兜住 ✓。 */
  if (main === '' && /\+$/.test(k)) main = '+';
  const keyName = named[main] || (main.length === 1 ? main.toUpperCase() : main);
  return [...mods, keyName].join('+');
}

async function main() {
  const exe = browserExecutable();
  if (!exe) { console.log('shortcut-titles: skipped（未找到 Chrome/Chromium）'); return; }

  const declared = declaredShortcuts();
  console.log('  声明了快捷键的按钮: ' + declared.length + ' 个');
  declared.forEach((d) => console.log('    ' + d.key.padEnd(14) + d.file));

  fs.mkdirSync(path.join(vault, 'code'), { recursive: true });
  const port = await freePort();
  const baseUrl = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, CODESCOPE_HOST: '127.0.0.1', CODESCOPE_PORT: String(port), CODESCOPE_VAULT: vault, CODESCOPE_DATA_HOME: path.join(tempRoot, 'data'), CODESCOPE_ONLYOFFICE_URL: 'http://127.0.0.1:1', CODESCOPE_DSH_AUTOSTART: '0', CODESCOPE_AUTO_OFFICE: '0' },
    stdio: 'ignore',
  });
  await waitForServer(baseUrl);

  browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
  /* ⚠️ 这个测试跑的是**自己的空 vault** ✗ —— 不能等 SNIPPETS.length > 0 ✓
       （永远是空的 ✓），只要等变量**存在**就行 ✓。 */
  await page.waitForFunction(() => { try { return Array.isArray(SNIPPETS); } catch (_) { return false; } }, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  /* ⚠️⚠️ 必须**先铺好场景**再按键 ✗✗ ——
     这些快捷键大多是**上下文相关**的 ✓：
       · ⌘N 只在「备忘录页签」下生效（代码里判的是 TAB === "memo"）✓
       · ⌘Z / ⌘⇧Z 只在该编辑器**聚焦时**生效 ✓
     第一版在主页面直接按 → 全被判成「死快捷键」✗，**两个都是误报** ✓。
     → 先打开个人管理面板 + 切到备忘录 + 点进编辑器，再按 ✓。 */
  await page.locator("#btn-lifework").click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.locator('.lw-nav [data-tab="memo"]').dispatchEvent("click").catch(() => {});
  await page.waitForTimeout(2500);
  await page.locator("[data-memo]").first().click().catch(() => {});
  await page.waitForTimeout(2000);

  /* ② 运行时：真的按一下，数 DOM 变化 ✓ */
  console.log('');
  console.log('  ── 逐个真按（判据：600ms 内 DOM 有没有变化）──');
  const dead = [];
  for (const d of declared) {
    const combo = toPlaywright(d.key);
    if (!combo) { console.log('    ? ' + d.key.padEnd(14) + '（无法解析成按键）'); continue; }
    await page.evaluate(() => {
      window.__mut = 0;
      if (window.__mo) window.__mo.disconnect();
      window.__mo = new MutationObserver(() => { window.__mut++; });
      window.__mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.__mut = 0; });
    await page.keyboard.press(combo).catch(() => {});
    await page.waitForTimeout(600);
    const mut = await page.evaluate(() => window.__mut || 0);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
    const ok = mut > 0 || NO_DOM_EFFECT.has(d.key);
    console.log('    ' + (ok ? '✓' : '✗') + ' ' + d.key.padEnd(14) + 'DOM 变化 ' + String(mut).padStart(4) + (NO_DOM_EFFECT.has(d.key) ? '（白名单：本来就不改 DOM）' : ''));
    if (!ok) dead.push(d);
  }

  console.log('');
  if (dead.length) {
    console.log('  ✗ 有 ' + dead.length + ' 个「死快捷键」（title 写了、按了没反应）:');
    dead.forEach((d) => console.log('      ' + d.key + '  ← ' + d.file + '   title=' + JSON.stringify(d.title)));
    console.log('  → 要么把功能接上，要么把 title 里的快捷键去掉（别写假承诺）。');
  } else {
    console.log('  ✓ 所有声明的快捷键都真的有效');
  }
  if (errs.length) console.log('  ⚠️ 页面报错: ' + errs.slice(0, 3).join(' | '));
  if (dead.length) process.exitCode = 1;
}

main()
  .catch((e) => { console.error('shortcut-titles 失败: ' + (e && e.message)); process.exitCode = 1; })
  .finally(() => {
    try { if (browser) browser.close(); } catch (_) {}
    try { if (server) server.kill(); } catch (_) {}
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
  });
