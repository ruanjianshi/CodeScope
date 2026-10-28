#!/usr/bin/env node
'use strict';
/* 用 CDP Tracing 看「点词群」这一帧在浏览器内部各阶段的耗时 ✓
 * 用法：node perf-trace.js
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
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...(d.value || [])));
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,blink.user_timing,loading',
    transferMode: 'ReportEvents',
  });

  const t = await p.evaluate(async () => {
    const el = document.querySelector('.lw-rd-grps');
    const rows = [...el.querySelectorAll('[data-epwflt]')];
    const mid = rows.find((r) => r.getBoundingClientRect().top > 180) || rows[1];
    const a = performance.now();
    mid.click();
    const c = performance.now();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { sync: Math.round(c - a), paint: Math.round(performance.now() - c) };
  });
  console.log(`点词群：同步 ${t.sync}ms，到下一帧 ${t.paint}ms\n`);
  await p.waitForTimeout(400);
  await cdp.send('Tracing.end');
  await new Promise((res) => { cdp.once('Tracing.tracingComplete', res); setTimeout(res, 5000); });

  /* 按 name 聚合 dur */
  const agg = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const k = e.name;
    const cur = agg.get(k) || { n: 0, dur: 0 };
    cur.n++; cur.dur += e.dur;
    agg.set(k, cur);
  }
  const rowsOut = [...agg.entries()]
    .filter(([k]) => /ParseHTML|Layout|UpdateLayoutTree|Paint|Style|Recalc|Composite|Commit|FunctionCall|EvaluateScript|HitTest|PrePaint|RasterTask|ImageDecode/i.test(k))
    .sort((a, b) => b[1].dur - a[1].dur)
    .slice(0, 20);
  console.log('阶段耗时（累计，微秒→毫秒）：');
  for (const [k, v] of rowsOut) {
    console.log(`  ${String(Math.round(v.dur / 100) / 10).padStart(9)}ms  x${String(v.n).padStart(5)}  ${k}`);
  }
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
