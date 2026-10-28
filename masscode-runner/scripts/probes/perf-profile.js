#!/usr/bin/env node
'use strict';
/* 用 CDP 采一次 JS 性能剖析 ✓，找出「点单词」到底耗在哪 ✓。
 * 用法：node perf-profile.js
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
  await p.evaluate(() => document.querySelector('[data-epwflt="book:cet6"]').click());
  await p.waitForTimeout(1500);

  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');

  await p.evaluate(async () => {
    const rows = [...document.querySelectorAll('.lw-rd-list [data-epword]')];
    const el = rows.find((r) => r.getBoundingClientRect().top > 200) || rows[10];
    el.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await p.waitForTimeout(300);

  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map();
  (profile.nodes || []).forEach((n) => byId.set(n.id, n));
  const self = new Map();
  (profile.samples || []).forEach((id) => {
    const n = byId.get(id);
    if (!n) return;
    const f = n.callFrame;
    const key = (f.functionName || '(anonymous)') + '  ' +
      String(f.url || '').split('/').pop() + ':' + (f.lineNumber + 1);
    self.set(key, (self.get(key) || 0) + 1);
  });
  const total = profile.samples.length;
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  console.log('采样 ' + total + ' 个（每个 ' + (profile.samples.length ? 0.2 : 0) + 'ms）\n');
  console.log('占比较高的函数：');
  top.forEach(([k, v]) => {
    console.log('  ' + String(Math.round(1000 * v / total) / 10 + '%').padStart(6) + '  ' + k);
  });
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
