#!/usr/bin/env node
'use strict';
/* 生词本性能测量 ✓（点击单词的耗时 / DOM 规模 ✓）
 * 用法：node perf-wordbook.js
 * ⚠️ 直接连正在跑的服务（127.0.0.1:4877 ✓），不另起临时服务 ✓。
 */
const { chromium } = require('playwright-core');
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 820 } });
  await p.goto('http://127.0.0.1:4877/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#btn-lifework', { timeout: 20000 });
  await p.click('#btn-lifework');
  await p.locator('.lw-nav [data-tab="reading"]').click();
  await p.waitForSelector('.lw-rd-grps', { timeout: 15000 });
  await p.waitForTimeout(800);

  const t0 = Date.now();
  await p.evaluate(() => document.querySelector('[data-epwflt="book:cet6"]').click());
  await p.waitForTimeout(1200);
  console.log('切到「六级核心词」：' + (Date.now() - t0 - 1200) + ' ms（已扣掉固定等待）');

  const info = await p.evaluate(() => {
    const host = document.getElementById('lifework-view');
    return {
      nodes: host.querySelectorAll('*').length,
      rows: document.querySelectorAll('.lw-rd-list [data-epword]').length,
      htmlKB: Math.round(host.innerHTML.length / 1024),
    };
  });
  console.log('DOM 节点 ' + info.nodes + ' · 词行 ' + info.rows + ' · innerHTML ' + info.htmlKB + 'KB');

  const clickAt = async (minTop) => p.evaluate(async (mt) => {
    const rows = [...document.querySelectorAll('.lw-rd-list [data-epword]')];
    const el = rows.find((r) => r.getBoundingClientRect().top > mt) || rows[10];
    const a = performance.now();
    el.click();
    const c = performance.now();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { click: Math.round(c - a), frame: Math.round(performance.now() - c) };
  }, minTop);

  for (const [i, mt] of [[1, 200], [2, 300], [3, 400]]) {
    const t = await clickAt(mt);
    console.log('点第 ' + i + ' 个词：同步 ' + t.click + ' ms · 到下一帧 ' + t.frame + ' ms');
  }
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
