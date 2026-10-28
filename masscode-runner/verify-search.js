#!/usr/bin/env node
'use strict';
/* 搜索框回归验证 ✓ —— 防「只能输一个字母」那个坑再犯 ✗
 *
 * 背景：两个搜索框都踩过同一个坑 ✗
 *   · 词表 `#lw-wd-q`：oninput 里调 render() ✗ → 整块重建 → 输入框被换掉 → **焦点丢** ✗
 *   · 文章 `#lw-ep-q`：oninput 里**只赋值、不重绘** ✗ → 搜了跟没搜一样 ✗
 *
 * 用法：node verify-search.js
 * 说明：直接连正在跑的服务 ✓（不另起临时服务 ✓）
 */
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:4877';

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '   ' + extra : ''}`);
  ok ? pass++ : fail++;
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: false });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 100)); });

  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#btn-lifework');
  await p.click('#btn-lifework');
  await p.locator('.lw-nav [data-tab="reading"]').click();
  await p.waitForSelector('[data-rdmode]');
  await p.waitForTimeout(700);

  /* ── ① 词表搜索 ✓ ── */
  await p.evaluate(() => { const e = document.querySelector('[data-rdmode="word"]'); if (e) e.click(); });
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('[data-epwflt="book:cet6"]').click());
  await p.waitForTimeout(1300);

  const allRows = await p.evaluate(() => document.querySelectorAll('.lw-wd-rows [data-epword]').length);
  ck('词表先渲染出全部词', allRows > 1000, `共 ${allRows} 行`);

  await p.click('#lw-wd-q');
  await p.keyboard.type('abandon', { delay: 55 });
  await p.waitForTimeout(450);
  const a = await p.evaluate(() => ({
    val: document.querySelector('#lw-wd-q').value,
    focus: (document.activeElement || {}).id,
    rows: document.querySelectorAll('.lw-wd-rows [data-epword]').length,
  }));
  ck('词表搜索**能输入完整单词**', a.val === 'abandon', `框里="${a.val}"`);
  ck('输入后**焦点还在框里**', a.focus === 'lw-wd-q', `focus=${a.focus}`);
  ck('列表跟着筛了', a.rows > 0 && a.rows < allRows, `${allRows} → ${a.rows} 行`);

  await p.keyboard.type('ment', { delay: 55 });
  await p.waitForTimeout(450);
  const a2 = await p.evaluate(() => document.querySelector('#lw-wd-q').value);
  ck('**继续输入**不被吞掉', a2 === 'abandonment', `框里="${a2}"`);

  for (let i = 0; i < 4; i++) await p.keyboard.press('Backspace');
  await p.waitForTimeout(450);
  const a3 = await p.evaluate(() => document.querySelector('#lw-wd-q').value);
  ck('退格正常', a3 === 'abandon', `框里="${a3}"`);

  await p.evaluate(() => {
    const i = document.querySelector('#lw-wd-q');
    i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(450);
  const a4 = await p.evaluate(() => document.querySelectorAll('.lw-wd-rows [data-epword]').length);
  ck('清空后恢复全部', a4 === allRows, `${a4} 行`);

  /* ── ② 文章搜索 ✓ ── */
  await p.evaluate(() => { const e = document.querySelector('[data-rdmode="ex"]'); if (e) e.click(); });
  await p.waitForTimeout(900);
  const n0 = await p.evaluate(() => document.querySelectorAll('.lw-ep-art').length);
  ck('文章列表已渲染', n0 > 0, `共 ${n0} 篇`);

  await p.click('#lw-ep-q');
  await p.keyboard.type('zzzz', { delay: 55 });
  await p.waitForTimeout(500);
  const c = await p.evaluate(() => ({
    val: document.querySelector('#lw-ep-q').value,
    focus: (document.activeElement || {}).id,
    rows: document.querySelectorAll('.lw-ep-art').length,
  }));
  ck('文章搜索能输完整词', c.val === 'zzzz', `框里="${c.val}"`);
  ck('文章搜索**真的过滤了**', c.rows === 0, `${n0} → ${c.rows} 篇`);
  ck('文章搜索焦点还在框里', c.focus === 'lw-ep-q', `focus=${c.focus}`);

  for (let i = 0; i < 4; i++) await p.keyboard.press('Backspace');
  await p.waitForTimeout(500);
  const c2 = await p.evaluate(() => document.querySelectorAll('.lw-ep-art').length);
  ck('文章搜索清空后恢复', c2 === n0, `${c2} 篇`);

  /* ★★ 收尾：把阅读页切回「生词本」✓✓ ——
     ⚠️⚠️ `readMode` 是**存库**的 ✗：本脚本为了测文章搜索切到了「外刊精读」✓，
        不切回来的话，**下一次打开面板会停在文章精读** ✗，
        而 `perf-paths.js` / `verify-scroll-keep.js` 那些脚本要等 `.lw-rd-grps` ✗
        → 直接超时 ✗（实测踩过 ✓）。
     ⇒ **凡是会切页签 / 切子模式的测试，收尾必须把状态放回去** ✓。 */
  await p.evaluate(() => { const e = document.querySelector('[data-rdmode="word"]'); if (e) e.click(); });
  await p.waitForTimeout(600);
  const mode = await p.evaluate(async () => {
    const r = await fetch('/api/life/store', { cache: 'no-store' });
    return ((await r.json()).data || {}).readMode;
  });
  ck('收尾把阅读模式恢复成 word', mode === 'word', `readMode=${mode}`);

  console.log();
  console.log(`  ${errs.length ? '✗ 页面错误: ' + errs.slice(0, 3).join(' | ') : '✓ 无页面错误'}`);
  if (errs.length) fail++;
  console.log(`\n${fail ? '✗ 有 ' + fail + ' 项失败' : '✓ 全部通过'}（${pass} 项）`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
