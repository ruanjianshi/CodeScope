/* 量面板「首次加载」耗时 + 截图 ✓ */
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:4877';

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: false });
  const p = await b.newPage({ viewport: { width: 1440, height: 820 } });

  let t0 = Date.now();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  console.log(`页面 DOMContentLoaded      ${Date.now() - t0}ms`);

  await p.waitForSelector('#btn-lifework');
  t0 = Date.now();
  await p.click('#btn-lifework');
  await p.waitForSelector('.lw-nav [data-tab="reading"]', { timeout: 20000 });
  console.log(`点「个人管理面板」→ 导航出现   ${Date.now() - t0}ms`);

  t0 = Date.now();
  await p.locator('.lw-nav [data-tab="reading"]').click();
  await p.waitForSelector('.lw-rd-grps', { timeout: 20000 });
  await p.waitForTimeout(200);
  console.log(`点「阅读」→ 词书页就绪         ${Date.now() - t0}ms`);

  t0 = Date.now();
  await p.evaluate(() => document.querySelector('[data-epwflt="book:cet6"]').click());
  await p.waitForTimeout(200);
  console.log(`点「六级核心词」→ 1979 行就绪    ${Date.now() - t0}ms`);

  await p.waitForTimeout(400);
  await p.screenshot({ path: '/tmp/wordbook-side.png', clip: { x: 0, y: 0, width: 620, height: 700 } });
  await p.screenshot({ path: '/tmp/wordbook-full.png' });
  console.log('截图完成');
  await b.close();
})();
