/* 量「非点单词」的几条交互路径还剩多少卡顿 ✓
   用法：node perf-paths.js
   说明：直接连正在跑的服务 ✓（不另起临时服务 ✓） */
const { chromium } = require('playwright-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:4877';

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 820 } });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#btn-lifework');
  await p.click('#btn-lifework');
  await p.locator('.lw-nav [data-tab="reading"]').click();
  /* ★ 先切到「生词本」✓ —— `readMode` 是存库的 ✗，别的测试可能把它留在别的子模式 ✗ */
  await p.waitForSelector('[data-rdmode]', { timeout: 15000 });
  await p.evaluate(() => { const e = document.querySelector('[data-rdmode="word"]'); if (e) e.click(); });
  await p.waitForTimeout(700);
  await p.waitForSelector('.lw-rd-grps');
  await p.waitForTimeout(900);

  /* 计时工具：跑一个动作，量到「下一次绘制真正完成」为止 */
  const timeIt = async (label, fn) => {
    const r = await p.evaluate(async (src) => {
      const fn = new Function('return (' + src + ')')();
      const t0 = performance.now();
      await fn();
      const t1 = performance.now();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const t2 = performance.now();
      const host = document.getElementById('lifework-view');
      return {
        sync: Math.round(t1 - t0),
        paint: Math.round(t2 - t1),
        nodes: host.querySelectorAll('*').length,
        rows: document.querySelectorAll('.lw-rd-list [data-epword]').length,
      };
    }, fn.toString());
    console.log(
      `  ${label.padEnd(26, ' ')} 同步 ${String(r.sync).padStart(5)}ms   到下一帧 ${String(r.paint).padStart(5)}ms   DOM ${r.nodes} 节点 / ${r.rows} 行`
    );
    return r;
  };

  console.log('=== 词书页各交互路径（1979 词的六级核心词）===');
  await timeIt('切到 book:cet6（1979 词）', () =>
    document.querySelector('[data-epwflt="book:cet6"]').click()
  );
  await p.waitForTimeout(1200);

  await timeIt('点一个词群（词群栏）', () => {
    const el = document.querySelector('.lw-rd-grps');
    const rows = [...el.querySelectorAll('[data-epwflt]')];
    const mid = rows.find((r) => r.getBoundingClientRect().top > 180) || rows[1];
    mid.click();
  });
  await p.waitForTimeout(1200);

  await timeIt('切回 book:cet6', () =>
    document.querySelector('[data-epwflt="book:cet6"]').click()
  );
  await p.waitForTimeout(1500);

  await timeIt('点一个单词（上轮已修）', () => {
    const rows = [...document.querySelectorAll('.lw-rd-list [data-epword]')];
    const el = rows.find((r) => r.getBoundingClientRect().top > 200) || rows[10];
    el.click();
  });
  await p.waitForTimeout(600);

  await timeIt('点 ✏️ 编辑（上轮已修）', () => {
    const b = document.querySelector('#lw-wd-edit');
    if (b) b.click();
  });
  await p.waitForTimeout(600);

  await timeIt('切到「文章精读」模式', () => {
    const el = document.querySelector('[data-rdmode="read"]') || document.querySelector('[data-rdmode]');
    if (el) el.click();
  });
  await p.waitForTimeout(900);

  await timeIt('切回「词书」模式', () => {
    const el = document.querySelector('[data-rdmode="word"]');
    if (el) el.click();
  });
  await p.waitForTimeout(900);

  await b.close();
})();
