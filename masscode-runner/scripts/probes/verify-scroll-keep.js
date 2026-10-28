#!/usr/bin/env node
'use strict';
/* 验证：点击单词 / 点击词群时，**侧栏和词表的滚动位置不再跳回顶部** ✓
 *
 * 复现用户反馈（2026-10-15）：
 *   「滚轮滚动单词到其他，点击单词，莫名会回到初始位置」
 *   「点击第 27 个词群，结果页面刷新，词群滚回去了，回到第 1 个」
 *
 * ⚠️ 直接连**正在跑的服务**（127.0.0.1:4877 ✓）—— 不另起临时服务 ✓，
 *    免得踩到「测试临时服务把用户 DSH 杀掉」那个坑 ✓。
 *
 * 用法：node verify-scroll-keep.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = 'http://127.0.0.1:4877';
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
function ck(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '   ' + detail : ''));
}

(async () => {
  if (!fs.existsSync(EXE)) { console.error('找不到 Chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  /* ★ 面板是从**顶部标签栏**的「个人管理面板」按钮挂上去的 ✓（id=btn-lifework ✓），
     不是页面里本来就有的 ✗ —— 直接等 [data-tab] 会超时 ✓（实测踩过 ✗）。 */
  await page.waitForSelector('#btn-lifework', { timeout: 20000 });
  await page.click('#btn-lifework');
  await page.waitForSelector('#lifework-view', { timeout: 15000 });
  await page.waitForSelector('[data-tab="reading"]', { timeout: 15000 });
  await page.click('[data-tab="reading"]');
  /* ★ 先切到「生词本」模式 ✓ —— 阅读页上次停在哪个子模式是**存库**的 ✗，
     不切的话（比如上次停在「外刊精读」）这里会等不到 .lw-rd-grps 而超时 ✗。 */
  await page.waitForSelector('[data-rdmode]', { timeout: 15000 });
  await page.evaluate(() => { const e = document.querySelector('[data-rdmode="word"]'); if (e) e.click(); });
  await page.waitForTimeout(700);
  await page.waitForSelector('.lw-rd-grps', { timeout: 15000 });
  await page.waitForTimeout(500);

  /* ── 1. 词群那一栏：滚动后点一个靠下的词群 ✓ ── */
  const g = await page.evaluate(() => {
    const el = document.querySelector('.lw-rd-grps');
    el.scrollTop = 260;
    const rows = el.querySelectorAll('[data-epwflt]');
    return { top: el.scrollTop, n: rows.length, max: el.scrollHeight - el.clientHeight };
  });
  ck('词群栏可滚动', g.max > 50, `scrollTop=${g.top} 可滚 ${g.max}px，共 ${g.n} 行`);

  const clicked = await page.evaluate(() => {
    const el = document.querySelector('.lw-rd-grps');
    const rows = [...el.querySelectorAll('[data-epwflt]')];
    const mid = rows.find((r) => r.getBoundingClientRect().top > 120);
    const label = mid ? mid.textContent.trim().slice(0, 24) : '';
    if (mid) mid.click();
    return label;
  });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const el = document.querySelector('.lw-rd-grps');
    return { top: el.scrollTop, on: (el.querySelector('.on') || {}).textContent };
  });
  ck('点词群后**侧栏滚动位置保持**', after.top > 50,
    `点了「${clicked}」→ scrollTop=${after.top}（点前 ${g.top}）`);

  /* ── 2. 词表：先切到词多的筛选 ✓（点完词群只剩十几个词，列表根本滚不动 ✗）── */
  await page.evaluate(() => {
    const el = document.querySelector('[data-epwflt="book:cet6"]');
    if (el) el.click();
  });
  await page.waitForTimeout(500);
  const l = await page.evaluate(() => {
    const el = document.querySelector('.lw-rd-list');
    if (!el) return null;
    el.scrollTop = 300;
    const rows = el.querySelectorAll('[data-epword]');
    return { top: el.scrollTop, n: rows.length, max: el.scrollHeight - el.clientHeight };
  });
  if (!l || l.n < 3) {
    ck('词表可滚动', false, '词表行数不足，跳过');
  } else {
    ck('词表可滚动', l.max > 50, `scrollTop=${l.top} 可滚 ${l.max}px，共 ${l.n} 行`);
    const w = await page.evaluate(() => {
      const el = document.querySelector('.lw-rd-list');
      const rows = [...el.querySelectorAll('[data-epword]')];
      const mid = rows.find((r) => r.getBoundingClientRect().top > 160);
      const label = mid ? mid.textContent.trim().slice(0, 20) : '';
      if (mid) mid.click();
      return label;
    });
    await page.waitForTimeout(500);
    const a2 = await page.evaluate(() => {
      const el = document.querySelector('.lw-rd-list');
      return { top: el.scrollTop, sel: (el.querySelector('.on') || {}).textContent };
    });
    ck('点单词后**词表滚动位置保持**', a2.top > 50,
      `点了「${w}」→ scrollTop=${a2.top}（点前 ${l.top}）`);
  }

  /* ── 3. 反向：换筛选时词表**应该**回到顶部 ✓（那是新内容 ✓） ── */
  const a3 = await page.evaluate(() => {
    const side = document.querySelector('.lw-rd-grps');
    const rows = [...side.querySelectorAll('[data-epwflt]')];
    if (rows[0]) rows[0].click();
    return true;
  });
  await page.waitForTimeout(400);
  const a3b = await page.evaluate(() => {
    const el = document.querySelector('.lw-rd-list');
    return el ? el.scrollTop : -1;
  });
  ck('换词群后词表回到顶部（符合预期 ✓）', a3b <= 5, `scrollTop=${a3b}`);

  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log('\n' + (bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
