#!/usr/bin/env node
/* ⚠️ 打的是**本机正在运行的那个 CodeScope 实例** ✗ —— 需要 127.0.0.1:4877 起着 ✓，
   所以**故意不进 npm test** ✗（没有服务时自动跳过 ✓）。
   跑法：先起服务，再 node tests/life-away.js ✓。
   ★ 它只改 `body` 上的 class 和面板的开关 ✓，finally 里会把加的 class 摘干净 ✓。

   ── 它在测什么 ────────────────────────────────────────────────────────────
   用户原话：「打开个人管理面板，我点击其他例如 harness，打开 DSH，
   会被个人管理面板覆盖，切换不过去」。

   根因：本面板是**独立全屏浮层**（z-index 8800 ✗），
   而应用里其它工作区靠 `body` 上的 `xxx-mode` class 互相让位 ✓ —— 本面板没参加 ✗。
   → 修法：盯住 `body` 的 class ✓，冒出**新的** `*-mode` 就自己让位 ✓。
   ──────────────────────────────────────────────────────────────────────── */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const panel = (p) => p.locator('#lifework-view').count();

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const open = async () => { await p.locator('#btn-lifework').click(); await p.waitForTimeout(900); };
  const clean = async () => { await p.evaluate(() => { ['dsh-mode','opencode-mode','vscode-mode','knowledge-mode','study-mode'].forEach((c) => document.body.classList.remove(c)); }); };

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await clean();

    console.log('── ① 基本：能打开 ──');
    await open();
    ck('面板打开了', await panel(p) === 1, String(await panel(p)));

    console.log('\n── ② ★ 别的「工作区」一开就让位（DSH 用的就是这招）──');
    await p.evaluate(() => document.body.classList.add('dsh-mode'));
    await p.waitForTimeout(900);
    ck('★ 冒出 dsh-mode 后面板自动关掉', await panel(p) === 0, '还在（' + await panel(p) + '）');
    /* ⚠️ 别用 `/on/` 去测 class ✗ —— "header-acti**on**" 里就有 "on" ✗（实测误报过 ✗），
       要按**独立的 class** 判 ✓。 */
    ck('按钮也回到未激活', !(await p.locator('#btn-lifework').evaluate((e) => e.classList.contains('on'))),
      await p.locator('#btn-lifework').getAttribute('class'));
    await clean();

    console.log('\n── ③ 其它工作区（opencode / vscode / 知识库）同样让位 ──');
    for (const m of ['opencode-mode', 'vscode-mode', 'knowledge-mode']) {
      await open();
      await p.evaluate((c) => document.body.classList.add(c), m);
      await p.waitForTimeout(800);
      ck('★ ' + m + ' → 面板让位', await panel(p) === 0, '还在');
      await clean();
    }

    console.log('\n── ④ ★ 反过来：**已经在**工作区里打开面板，不能被自己关掉 ──');
    await p.evaluate(() => document.body.classList.add('dsh-mode'));
    await p.waitForTimeout(400);
    await open();
    ck('★ 先开 DSH 再开面板 → 面板要**留住**', await panel(p) === 1, '被自己关掉了');
    await p.waitForTimeout(800);
    ck('★ 等一下也不会自己消失（旧 class 不算「新开」）', await panel(p) === 1, '还是被关了');
    await clean();

    console.log('\n── ⑤ 点顶栏别的按钮也让位（有些入口不加 mode class）──');
    await open();
    const before = await panel(p);
    await p.locator('#knowledge-launch').click().catch(() => {});
    await p.waitForTimeout(900);
    ck('★ 点「知识库」入口 → 面板让位', await panel(p) === 0, before + ' → ' + await panel(p));
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(600);
    await p.evaluate(() => { const k = document.getElementById('knowledge-center'); if (k) k.classList.remove('open'); });
    await clean();

    console.log('\n── ⑥ 面板自己的开关 / 面板内部点击，不能被误伤 ──');
    /* ⚠️ ⑤ 把知识库弹窗打开了 ✗，它会挡住后面的点击 ✗ → 先**重新加载**拿个干净页面 ✓。 */
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await clean();
    await open();
    ck('重新打开', await panel(p) === 1);
    await p.locator('.lw-nav [data-tab="today"]').click().catch(() => {});
    await p.waitForTimeout(800);
    ck('★ 点面板**内部** → 不该被关掉', await panel(p) === 1, '被误关了');
    await p.locator('#btn-lifework').click();
    await p.waitForTimeout(800);
    ck('★ 点面板自己的按钮 → 正常关闭（开关没坏）', await panel(p) === 0, '还在');
    await open();
    ck('★ 再点一次 → 还能打开（没被观察者搞坏）', await panel(p) === 1, '打不开了');
    await p.locator('#btn-lifework').click();
    await p.waitForTimeout(600);

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    try {
      await clean();
      await p.evaluate(() => { const v = document.getElementById('lifework-view'); if (v) v.remove(); });
      console.log('\n收尾：body class 已还原 ✓');
    } catch (e) { console.log('\n收尾失败: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
