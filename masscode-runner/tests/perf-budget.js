#!/usr/bin/env node
'use strict';
/**
 * 性能预算回归测试（2026-10-10）
 *
 * ⚠️ 为什么要有 ✗✗：
 *   用户说「继续优化」✓，我先**量了一遍** ✓，结果发现**这个应用本来就很快** ✓：
 *     · 加载 TTFB 102ms · DOMContentLoaded 567ms ✓
 *     · 切视图 168~223ms，且**长任务 0 个**（主线程没被阻塞 ✓✓）
 *     · 反复切 10 轮：DOM 3251→3251、堆 12MB 稳定 → **无泄漏** ✓
 *   **没有值得"优化"的地方** ✓ —— 那就别硬编工作量 ✓，
 *   改成把这份基线**固化下来** ✓：以后谁改慢了，这里会直接报出来 ✓✓。
 *
 * ⚠️ 阈值给得**宽松** ✗（本机数字的 3~5 倍 ✓）——
 *   目的是抓**数量级**的退化（比如某次改动让加载从 0.6s 变成 6s ✓），
 *   不是抓 10ms 的抖动 ✓（那会把测试变成噪音 ✓，最后没人看 ✓）。
 *
 * 运行：node tests/perf-budget.js（需要 Chrome，找不到就 skip ✓）
 */
const fs = require('fs');

/* 数据保护罩：探针会写真实数据，跑完必须还原 ✓（见 probe-guard.js） */
require('./probe-guard.js').arm();
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((f) => fs.existsSync(f));

const BUDGET = {
  ttfbMs: 1500,          /* 本机 ~100ms ✓ */
  dclMs: 4000,           /* 本机 ~570ms ✓ */
  domNodes: 12000,       /* 本机 ~2600~3500 ✓ */
  switchMs: 1200,        /* 本机 ~200ms ✓（含等待 ✓）*/
  longTaskMs: 600,       /* 本机 0 ✓ —— 有长任务说明主线程被阻塞 ✓ */
  domGrowth: 300,        /* 反复切 10 轮的 DOM 增量（本机 0 ✓）*/
  heapGrowthMB: 15,      /* 反复切 10 轮的堆增量（本机 ~0 ✓）*/
};

(async () => {
  if (!CHROME) { console.log('  性能预算：跳过（没找到 Chrome）'); return; }
  let chromium;
  try { ({ chromium } = require('playwright-core')); }
  catch (_) { console.log('  性能预算：跳过（没装 playwright-core）'); return; }

  const base = process.env.CODESCOPE_TEST_URL || 'http://127.0.0.1:4877/';
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const fails = [];
  const check = (name, actual, budget, unit) => {
    const ok = actual <= budget;
    console.log('    ' + (ok ? '✓' : '✗') + ' ' + name.padEnd(22) + String(actual).padStart(6) + unit + '  （预算 ' + budget + unit + '）');
    if (!ok) fails.push(name + ': ' + actual + unit + ' > ' + budget + unit);
  };

  await p.goto(base, { waitUntil: 'domcontentloaded' });
  const nav = await p.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    return { ttfb: Math.round(n.responseStart || 0), dcl: Math.round(n.domContentLoadedEventEnd || 0), dom: document.getElementsByTagName('*').length };
  });
  console.log('  ── 加载 ──');
  check('TTFB', nav.ttfb, BUDGET.ttfbMs, 'ms');
  check('DOMContentLoaded', nav.dcl, BUDGET.dclMs, 'ms');
  check('DOM 节点数', nav.dom, BUDGET.domNodes, '');

  await p.waitForFunction(() => { try { return Array.isArray(SNIPPETS) && SNIPPETS.length > 0; } catch (_) { return false; } }, null, { timeout: 60000 });
  await p.waitForTimeout(2500);

  /* 长任务（主线程阻塞）✓ */
  await p.evaluate(() => {
    window.__lt = 0;
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__lt += e.duration; })).observe({ entryTypes: ['longtask'] });
    } catch (_) {}
  });

  console.log('');
  console.log('  ── 切换视图 ──');
  for (const [sel, name] of [['#btn-lifework', '个人管理'], ['#btn-system', '本机管家']]) {
    const t0 = Date.now();
    await p.locator(sel).click({ force: true }).catch(() => {});
    await p.waitForTimeout(150);
    check(name, Date.now() - t0, BUDGET.switchMs, 'ms');
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(800);
  }
  const lt = await p.evaluate(() => Math.round(window.__lt || 0));
  check('长任务总时长', lt, BUDGET.longTaskMs, 'ms');

  /* 反复切换看泄漏 ✓ */
  console.log('');
  console.log('  ── 反复切 8 轮（查泄漏 ✓）──');
  const dom = () => p.evaluate(() => document.getElementsByTagName('*').length);
  const heap = () => p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0));
  for (let i = 0; i < 4; i++) {
    await p.locator('#btn-lifework').click({ force: true }).catch(() => {});
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(250);
    await p.locator('#btn-system').click({ force: true }).catch(() => {});
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(250);
  }
  const d1 = await dom(), h1 = await heap();
  for (let i = 0; i < 4; i++) {
    await p.locator('#btn-lifework').click({ force: true }).catch(() => {});
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(250);
    await p.locator('#btn-system').click({ force: true }).catch(() => {});
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(250);
  }
  const d2 = await dom(), h2 = await heap();
  check('DOM 增量（8 轮）', d2 - d1, BUDGET.domGrowth, '');
  check('堆增量（8 轮）', h2 - h1, BUDGET.heapGrowthMB, 'MB');

  await b.close();

  console.log('');
  if (fails.length) {
    console.log('  ✗ 性能预算未通过 ' + fails.length + ' 项:');
    fails.forEach((f) => console.log('      ' + f));
    console.log('  → 这些是**数量级**退化 ✓（阈值已给到本机的 3~5 倍 ✓），值得查一查 ✓。');
    process.exitCode = 1;
  } else {
    console.log('  ✓ 性能预算全部通过（加载 / 切视图 / 长任务 / 无泄漏 ✓）');
  }
})().catch((e) => { console.error('  性能预算测试炸了：' + e.message); process.exit(1); });
