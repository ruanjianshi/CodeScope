#!/usr/bin/env node
/* ⚠️ 这个探针打的是**本机正在运行的那个 CodeScope 实例** ✗ —— 需要 127.0.0.1:4877 起着 ✓，
   没有服务时**直接跳过** ✓（不算失败 ✓）。跑法：先起服务，再 node tests/context-menu.js ✓。

   ── 它在测什么（2026-10-19，用户报「文件夹无法重命名等」）─────────────────────
   ⚠️ 根因 ✗：项目树的右键菜单 `showFolderContextMenu()` 是**顶层函数** ✓，
      而「新建文件 / 新建文件夹 / 重命名」三个实现都在**另一个闭包**里 ✓ →
      菜单里直接写函数名 → `ReferenceError: xxx is not defined` ✗
      → 表现是「点了一下，什么都不发生」✓，只有控制台有一行红字 ✗（用户看不到 ✗）。
      「删除文件夹」没坏 ✓，只是因为它当初多写了一行 `window.__deleteFolder = …` ✓。

   ⇒ 这个探针逐个点菜单项，断言「**点下去必须有反应**」：
      · 新建文件 / 新建文件夹 / 重命名 → 弹窗要出来（标题对得上）
      · 删除文件夹 → 确认弹窗要出来（**点取消**，不真删 ✗）
      · 全程**不许有 pageerror**（ReferenceError 就是从这里露出来的 ✓）

   ⚠️ 数据安全：只对**自己建的临时文件夹** `__ctxmenu_probe__` 动手 ✓，
      跑完（哪怕崩了）在 finally 里删掉 ✓。绝不碰用户真实文件夹 ✗。
   ────────────────────────────────────────────────────────────────────────── */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./probe-guard.js').arm();
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = [];
const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const SCRATCH = '__ctxmenu_probe__';
const SCRATCH2 = '__ctxmenu_probe_renamed__';

(async () => {
  try {
    const r = await fetch(BASE + '/api/snippets', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.log('跳过：127.0.0.1:4877 没有服务（' + e.message + '）');
    process.exit(0);
  }
  if (!exe) { console.log('跳过：找不到 Chrome'); process.exit(0); }

  /* 项目树的根 = vault 下的 code/ ✓（从接口拿，别写死路径 ✗） */
  let codeRoot = '';
  try {
    const d = await (await fetch(BASE + '/api/snippets')).json();
    if (d && d.vault) codeRoot = path.join(d.vault, 'code');
  } catch (_) { }
  if (!codeRoot || !fs.existsSync(codeRoot)) {
    console.log('跳过：拿不到项目根目录（' + codeRoot + '）');
    process.exit(0);
  }

  const dirA = path.join(codeRoot, SCRATCH);
  const dirB = path.join(codeRoot, SCRATCH2);
  const cleanup = () => {
    for (const d of [dirA, dirB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { } }
  };
  cleanup();
  fs.mkdirSync(dirA, { recursive: true });

  const b = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2600);

    const openMenu = async (name) => {
      const row = p.locator('#side .fnode', { hasText: name }).first();
      if (!(await row.count())) return false;
      await row.click({ button: 'right' });
      await p.waitForTimeout(280);
      return true;
    };
    const clickItem = async (label) => {
      const it = p.locator('#ctx-menu .ctx-item', { hasText: label }).first();
      if (!(await it.count())) return false;
      await it.click();
      await p.waitForTimeout(600);
      return true;
    };
    const dialogOf = () => p.evaluate(() => {
      const cd = document.getElementById('confirm-dialog');
      const nd = document.getElementById('new-dialog');
      return {
        confirm: !!cd && cd.classList.contains('open'),
        confirmTitle: (document.getElementById('cd-title') || {}).textContent || '',
        confirmValue: (document.getElementById('cd-input') || {}).value || '',
        newDlg: !!nd && nd.classList.contains('open'),
        newTitle: (document.getElementById('nd-title') || {}).textContent || '',
      };
    });
    const closeAll = async () => {
      await p.evaluate(() => {
        const cd = document.getElementById('confirm-dialog'); if (cd) cd.classList.remove('open');
        const nd = document.getElementById('new-dialog'); if (nd) nd.classList.remove('open');
      });
      await p.waitForTimeout(150);
    };

    /* ① 菜单本身在 */
    ck('项目树里有临时文件夹行', await openMenu(SCRATCH));
    const items = await p.evaluate(() => [...document.querySelectorAll('#ctx-menu .ctx-item')].map((x) => x.textContent.trim()));
    ck('右键菜单四个入口都在', items.length === 4 && items.some((t) => /重命名/.test(t)), JSON.stringify(items));

    /* ② 新建文件 */
    await clickItem('新建文件');
    let d = await dialogOf();
    ck('★★ 点「新建文件」有反应（弹窗出来）', d.newDlg && /新建文件/.test(d.newTitle), JSON.stringify(d));
    await closeAll();

    /* ③ 新建文件夹 */
    await openMenu(SCRATCH);
    await clickItem('新建文件夹');
    d = await dialogOf();
    ck('★★ 点「新建文件夹」有反应', d.newDlg && /新建文件夹/.test(d.newTitle), JSON.stringify(d));
    await closeAll();

    /* ④ 重命名：弹窗里要**预填当前名字** ✓，然后真的改一次名 ✓ */
    await openMenu(SCRATCH);
    await clickItem('重命名');
    d = await dialogOf();
    ck('★★ 点「重命名」有反应，且预填了当前文件夹名',
      d.confirm && /重命名/.test(d.confirmTitle) && d.confirmValue === SCRATCH, JSON.stringify(d));
    await p.fill('#cd-input', SCRATCH2);
    await p.click('#cd-ok');
    await p.waitForTimeout(1600);
    const st = await p.evaluate(() => (document.getElementById('status') || {}).textContent || '');
    ck('★★ 改完之后磁盘上真的改了名', !fs.existsSync(dirA) && fs.existsSync(dirB),
      '旧夹' + (fs.existsSync(dirA) ? '还在 ✗' : '已消失 ✓') + ' / 新夹' + (fs.existsSync(dirB) ? '存在 ✓' : '缺失 ✗'));
    ck('★ 状态栏说了「已重命名」', /已重命名/.test(st), st);

    /* ⑤ 删除：确认弹窗要出来，但**点取消**（不真删 ✓） */
    await openMenu(SCRATCH2);
    await clickItem('删除文件夹');
    d = await dialogOf();
    ck('★★ 点「删除文件夹」有反应（确认弹窗）', d.confirm && /删除/.test(d.confirmTitle), JSON.stringify(d));
    await closeAll();
    ck('★ 取消之后文件夹还在（没误删）', fs.existsSync(dirB));

    ck('★★ 全程没有 ReferenceError / 任何页面异常', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    await b.close();
    cleanup();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
