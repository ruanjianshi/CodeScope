#!/usr/bin/env node
/* ⚠️ 打的是**本机正在运行的那个 CodeScope 实例** ✗ —— 需要 127.0.0.1:4877 起着 ✓，
   所以**故意不进 npm test** ✗（没有服务时自动跳过 ✓）。
   跑法：先起服务，再 node tests/life-quote.js ✓。
   ★ 它只读页面 ✓，不改任何数据 ✓（最后把面板关掉而已 ✓）。

   ── 用户在要什么 ──────────────────────────────────────────────────────────
   「下面那一行谚语往中间放吧，中间还有位置，不需要加一个换一句按钮，
     让他隔固定时间，自动切换」。
   ──────────────────────────────────────────────────────────────────────── */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const quote = () => p.locator('#lw-quote .tx').innerText().then((t) => t.trim()).catch(() => '');

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.waitForTimeout(2500);

    console.log('── ① 格言往中间放 ──');
    const geo = await p.evaluate(() => {
      const strip = document.querySelector('.lw-strip').getBoundingClientRect();
      const q = document.querySelector('#lw-quote').getBoundingClientRect();
      const st = document.querySelector('.lw-strip .st');
      return {
        stripMid: Math.round(strip.left + strip.width / 2),
        quoteMid: Math.round(q.left + q.width / 2),
        stripW: Math.round(strip.width),
        hasStatus: !!st,
      };
    });
    const off = Math.abs(geo.quoteMid - geo.stripMid);
    console.log('    整行中线 x=' + geo.stripMid + '，格言中线 x=' + geo.quoteMid + '（差 ' + off + 'px，整行宽 ' + geo.stripW + '）');
    ck('★ 格言块居中（在整行中线 ±60px 内）', off <= 60, '偏了 ' + off + 'px');

    console.log('\n── ② 「换一句」按钮已经拿掉 ──');
    ck('★ 没有 #lw-quote-next', await p.locator('#lw-quote-next').count() === 0);
    ck('整行里没有按钮了', await p.locator('.lw-strip button').count() === 0, String(await p.locator('.lw-strip button').count()));
    ck('右边的状态三项还在', await p.locator('.lw-strip .st span').count() === 3, String(await p.locator('.lw-strip .st span').count()));

    console.log('\n── ③ ★ 隔固定时间自动切换 ──');
    const q0 = await quote();
    console.log('    现在: ' + JSON.stringify(q0.slice(0, 26)));
    /* 数「切换了几次」用 animationstart ✓ —— 每次 paintQuote 都会重播淡入动画 ✓，
       比盯文字更准（池子里可能撞上同一句 ✓）。 */
    await p.evaluate(() => {
      window.__swap = 0;
      const el = document.getElementById('lw-quote');
      /* ⚠️ 必须用**捕获** ✗ —— 动画加在子元素 `.tx` 上 ✓，
         而 `animationstart` **不冒泡** ✗，监听父元素默认收不到 ✗（实测：计数 0 ✗）。 */
      el.addEventListener('animationstart', () => { window.__swap++; }, true);
    });
    await p.waitForTimeout(25000);
    const swaps = await p.evaluate(() => window.__swap || 0);
    const q1 = await quote();
    console.log('    25 秒后: ' + JSON.stringify(q1.slice(0, 26)) + '（切换 ' + swaps + ' 次）');
    ck('★ 25 秒内自动切了一次（间隔 20 秒）', swaps === 1, '切了 ' + swaps + ' 次');
    ck('文字确实换了', q0 !== q1, '还是同一句');

    console.log('\n── ④ ★ 定时器不能叠加（切页签会重跑 bindHead）──');
    for (let i = 0; i < 6; i++) {
      await p.locator('.lw-nav [data-tab="' + (i % 2 ? 'memo' : 'today') + '"]').dispatchEvent('click');
      await p.waitForTimeout(200);
    }
    await p.locator('.lw-nav [data-tab="today"]').dispatchEvent('click');
    await p.waitForTimeout(800);
    await p.evaluate(() => {
      window.__swap = 0;
      const el = document.getElementById('lw-quote');
      /* ⚠️ 必须用**捕获** ✗ —— 动画加在子元素 `.tx` 上 ✓，
         而 `animationstart` **不冒泡** ✗，监听父元素默认收不到 ✗（实测：计数 0 ✗）。 */
      el.addEventListener('animationstart', () => { window.__swap++; }, true);
    });
    await p.waitForTimeout(25000);
    const swaps2 = await p.evaluate(() => window.__swap || 0);
    console.log('    切了 6 次页签之后，25 秒内切换 ' + swaps2 + ' 次');
    ck('★ 还是只切 1 次（定时器是单例，没越挂越多）', swaps2 === 1, '切了 ' + swaps2 + ' 次 —— 定时器叠加了？');

    console.log('\n── ⑤ 自动切换只动格言那一个元素，不整屏重绘 ──');
    const same = await p.evaluate(() => new Promise((res) => {
      const nav = document.querySelector('.lw-nav');
      nav.__mark = 'x';
      const q = document.querySelector('#lw-quote');
      let changed = 0;
      const ob = new MutationObserver(() => { changed++; });
      ob.observe(q, { childList: true, subtree: true });
      setTimeout(() => {
        ob.disconnect();
        res({ navKept: nav.__mark === 'x', changed });
      }, 25000);
    }));
    ck('★ 格言元素自己变了', same.changed > 0, String(same.changed));
    ck('★ 面板其它部分**没被重建**（左栏还是同一个节点）', same.navKept, '左栏被换掉了 —— 说明整屏重绘了');

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
