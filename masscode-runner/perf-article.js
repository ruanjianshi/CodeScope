/* 量「外刊精读」里点文章 / 点正文里的词 的耗时 ✓ */
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:4877';

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: false });
  const p = await b.newPage({ viewport: { width: 1440, height: 820 } });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#btn-lifework');
  await p.click('#btn-lifework');
  await p.locator('.lw-nav [data-tab="reading"]').click();
  await p.waitForSelector('[data-rdmode]', { timeout: 20000 });
  await p.waitForTimeout(900);

  const timeIt = async (label, fn) => {
    const r = await p.evaluate(async (src) => {
      const f = new Function('return (' + src + ')')();
      const t0 = performance.now();
      f();
      const s = Math.round(performance.now() - t0);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const host = document.getElementById('lifework-view');
      return { s, f: Math.round(performance.now() - t0 - s), nodes: host.querySelectorAll('*').length };
    }, fn.toString());
    console.log(`  ${label.padEnd(30, ' ')} 同步 ${String(r.s).padStart(5)}ms / 到帧 ${String(r.f).padStart(5)}ms   DOM ${r.nodes}`);
  };

  await timeIt('切到「外刊精读」', () => document.querySelector('[data-rdmode="ex"]').click());
  await p.waitForTimeout(900);
  const arts = await p.evaluate(() => [...document.querySelectorAll('[data-epart]')].length);
  console.log(`  （外刊精读里有 ${arts} 篇文章）`);
  await timeIt('点第一篇文章', () => { const e = document.querySelector('[data-epart]'); if (e) e.click(); });
  await p.waitForTimeout(1200);
  const marks = await p.evaluate(() => document.querySelectorAll('.lw-ep-w').length);
  console.log(`  （正文里标了 ${marks} 个词）`);
  await timeIt('点正文里的一个词', () => { const e = document.querySelector('.lw-ep-w'); if (e) e.click(); });
  await p.waitForTimeout(800);
  await timeIt('切回「生词本」', () => document.querySelector('[data-rdmode="word"]').click());
  await p.waitForTimeout(800);
  await b.close();
})();
