/* 量各候选字形在 174 行列表里的布局代价 ✓ —— 决定用什么替换 🗂 */
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:4877';

const CAND = ['🗂', '🗑', '⭐', '✓', '✗', '⚠', '★', '→', '✎', '▶', '☆', '☑', '▦', '✏', '⚙', '📁', '🧩', '🪄', '📖', '▤', '▣', '群', '#', '▪'];

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: false });
  const p = await b.newPage({ viewport: { width: 1440, height: 820 } });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#btn-lifework');
  await p.click('#btn-lifework');
  await p.locator('.lw-nav [data-tab="reading"]').click();
  await p.waitForSelector('.lw-rd-grps');
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('[data-epwflt="book:cet6"]').click());
  await p.waitForTimeout(1500);

  const r = await p.evaluate(async (cands) => {
    const host = document.getElementById('lifework-view');
    const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const rows = (g) => '<div class="lw-rd-grps">' + Array.from({ length: 174 }, (_, i) =>
      '<div class="lw-rd-row"><span class="em">' + g + '</span>' + (i + 1) + '. 文章精读<span class="n">11</span></div>').join('') + '</div>';
    const out = {};
    for (const g of cands) {
      const html = '<div class="lw-main"><div class="lw-rd"><div class="lw-rd-side" style="width:206px;overflow:auto">' + rows(g) + '</div></div></div>';
      const t0 = performance.now();
      host.innerHTML = html;
      const s = Math.round(performance.now() - t0);
      await frame();
      out[g] = { t: Math.round(performance.now() - t0 - s), s };
    }
    return out;
  }, CAND);

  const list = Object.entries(r).sort((a, b) => b[1].t - a[1].t);
  for (const [g, v] of list) {
    const flag = v.t > 100 ? '  ← 慢 ✗' : (v.t > 60 ? '  ← 偏慢' : '');
    console.log(`  ${g}  U+${g.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}  ${String(v.t).padStart(5)}ms${flag}`);
  }
  await b.close();
})();
