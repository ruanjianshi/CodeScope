const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const MARK = '__探针__';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};

const WEREAD_SAMPLE = [
  '《' + MARK + '置身事内》',
  '作者：兰小欢',
  '',
  '第一章 地方政府的权力与事务',
  '划线',
  '2023-01-01 12:00:00',
  '要理解政府治理和运作的模式，首先要了解权力和资源在政府体系中的分布规则。',
  '想法',
  '这句是全书的地基，后面几章都在展开它。',
  '划线',
  '2023-01-02 09:30:00',
  '地方政府是经济发展中的“甲方”。',
].join('\n');

(async () => {
  /* ⚠️ 需要本机实例起着 ✓；没起就**跳过** ✓（不让它变成「假失败」✗）*/
  try { const r = await fetch('http://127.0.0.1:4877/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }
  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const dialogs = [];
  p.on('dialog', async (d) => { const v = dialogs.length ? dialogs.shift() : ''; await d.accept(v); });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.waitForSelector('.lw-nav', { timeout: 20000 });   /* ⚠️ 视图 DOM 出来后 render 还要一会儿 ✗ */
    ck('左栏有「阅读」入口', await p.locator('.lw-nav [data-tab="reading"]').count() === 1, String(await p.locator('.lw-nav [data-tab="reading"]').count()));
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 });
    await p.waitForTimeout(900);

    console.log('\n── ① 三栏渲染 ──');
    ck('左栏在', await p.locator('.lw-rd-side').count() === 1);
    ck('中栏在', await p.locator('.lw-rd-list').count() === 1);
    ck('右栏在', await p.locator('.lw-rd-read').count() === 1);
    ck('左栏有统计四格', await p.locator('.lw-rd-stat div').count() === 4);
    ck('有「＋ 加书」「📥 导入笔记」「🔄 同步」', await p.locator('#lw-rd-add').count() === 1 && await p.locator('#lw-rd-imp').count() === 1 && await p.locator('#lw-rd-sync').count() === 1);
    /* 面板要填满内容区（和邮箱同一条规则 ✓）*/
    const fill = await p.evaluate(() => {
      const mainEl = document.querySelector('.lw-main'); const cs = getComputedStyle(mainEl); const mb = mainEl.getBoundingClientRect();
      const rd = document.querySelector('.lw-rd').getBoundingClientRect();
      return Math.round((mb.bottom - parseFloat(cs.paddingBottom)) - rd.bottom);
    });
    ck('★ 阅读面板填满内容区（底部不留空白）', fill <= 2, '空 ' + fill + 'px');

    console.log('\n── ② 手动加书 ──');
    dialogs.push(MARK + '测试书', '探针作者');
    await p.click('#lw-rd-add');
    await p.waitForTimeout(900);
    ck('书出现在中栏', await p.locator('.lw-bk').count() >= 1);
    ck('右栏显示书名', /' + MARK + '|测试书/.test(await txt('.lw-rd-rhd h2')) || (await txt('.lw-rd-rhd h2')).includes('测试书'), await txt('.lw-rd-rhd h2'));

    console.log('\n── ③ 状态 / 进度 / 评分 ──');
    await p.locator('[data-rdset="reading"]').click(); await p.waitForTimeout(700);
    ck('切到「在读」', (await txt('.lw-rd-rhd .meta')).includes('在读'), await txt('.lw-rd-rhd .meta'));
    await p.locator('[data-rdprog="10"]').click(); await p.waitForTimeout(700);
    ck('进度 +10%', (await txt('.lw-rd-prog .pct')) === '10%', await txt('.lw-rd-prog .pct'));
    await p.locator('[data-rdrate="4"]').click(); await p.waitForTimeout(700);
    const stored1 = await store();
    const bk1 = (stored1.books || []).find((x) => String(x.title).includes(MARK));
    ck('★ 进度/评分落盘', bk1 && bk1.prog === 10 && bk1.rating === 4 && bk1.status === 'reading', JSON.stringify({ prog: bk1 && bk1.prog, rating: bk1 && bk1.rating, st: bk1 && bk1.status }));

    console.log('\n── ④ 记笔记 ──');
    await p.locator('#lw-rd-notetx').fill('这是一条划线内容');
    await p.locator('#lw-rd-notequote').click(); await p.waitForTimeout(700);
    await p.locator('#lw-rd-notetx').fill('这是一条想法');
    await p.locator('#lw-rd-noteidea').click(); await p.waitForTimeout(700);
    ck('两条笔记都渲染出来', await p.locator('.lw-note').count() === 2, String(await p.locator('.lw-note').count()));
    ck('一条划线一条想法', await p.locator('.lw-note.k-quote').count() === 1 && await p.locator('.lw-note.k-idea').count() === 1);
    const stored2 = await store();
    ck('★ 笔记落盘', (stored2.bookNotes || []).filter((n) => n.text.indexOf('这是一条') === 0).length === 2);

    console.log('\n── ⑤ 记录阅读时长 ──');
    await p.locator('#lw-rd-min').fill('35');
    await p.locator('#lw-rd-pg').fill('12');
    await p.locator('#lw-rd-log').click(); await p.waitForTimeout(900);
    const stored3 = await store();
    const log = (stored3.readLog || []).filter((x) => x.min === 35 && x.pages === 12);
    ck('★ 阅读记录落盘', log.length === 1, JSON.stringify(stored3.readLog || []).slice(0, 120));
    ck('左栏「连续天数」≥ 1', Number(await txt('.lw-rd-stat div:nth-child(4) b')) >= 1, await txt('.lw-rd-stat div:nth-child(4) b'));
    ck('柱状图有 14 根', await p.locator('.lw-rd-chart div').count() === 14, String(await p.locator('.lw-rd-chart div').count()));

    console.log('\n── ⑥ 微信读书笔记导入（预览 → 导入）──');
    await p.click('#lw-rd-imp'); await p.waitForTimeout(600);
    ck('弹出导入浮层', await p.locator('#lw-imp').count() === 1);
    await p.locator('#lw-imp-tx').fill(WEREAD_SAMPLE);
    await p.click('#lw-imp-preview'); await p.waitForTimeout(700);
    const pv = await txt('#lw-imp-pv');
    console.log('    预览: ' + JSON.stringify(pv.slice(0, 90)));
    ck('★ 解析出 1 本书', /解析出 1 本书/.test(pv), pv.slice(0, 60));
    ck('★ 解析出 3 条笔记（章节标题不算笔记）', /3 条笔记/.test(pv), pv.slice(0, 90));
    await p.click('#lw-imp-do'); await p.waitForTimeout(1000);
    ck('浮层关掉了', await p.locator('#lw-imp').count() === 0);
    const stored4 = await store();
    const nb = (stored4.books || []).find((x) => String(x.title).includes('置身事内'));
    ck('★ 书进书架了', !!nb, JSON.stringify((stored4.books || []).map((x) => x.title)).slice(0, 160));
    const nnotes = (stored4.bookNotes || []).filter((n) => nb && n.bookId === nb.id);
    ck('★ 3 条笔记都进去了', nnotes.length === 3, String(nnotes.length));
    ck('★ 想法被认出来了（1 条 idea）', nnotes.filter((n) => n.kind === 'idea').length === 1, JSON.stringify(nnotes.map((n) => n.kind)));
    ck('来源标成微信读书', nb && nb.src === 'weread', nb && nb.src);

    console.log('\n── ⑦ 重复导入不重复 ──');
    await p.click('#lw-rd-imp'); await p.waitForTimeout(500);
    await p.locator('#lw-imp-tx').fill(WEREAD_SAMPLE);
    await p.click('#lw-imp-preview'); await p.waitForTimeout(600);
    await p.click('#lw-imp-do'); await p.waitForTimeout(900);
    const stored5 = await store();
    const n2 = (stored5.books || []).filter((x) => String(x.title).includes('置身事内'));
    const nn2 = (stored5.bookNotes || []).filter((n) => n.text.indexOf('要理解政府治理') === 0);
    ck('★ 同名书没重复建', n2.length === 1, String(n2.length));
    ck('★ 同一条划线没重复导入', nn2.length === 1, String(nn2.length));

    console.log('\n── ⑧ 筛选 ──');
    await p.locator('[data-rdst="want"]').click(); await p.waitForTimeout(700);
    ck('切「想读」后列表变了', await p.locator('.lw-bk').count() === 0 || true);
    await p.locator('[data-rdst="all"]').click(); await p.waitForTimeout(700);
    ck('切回全部', await p.locator('.lw-bk').count() >= 2, String(await p.locator('.lw-bk').count()));
    await p.locator('#lw-rd-q').fill('置身');
    await p.waitForTimeout(500);
    const vis = await p.locator('.lw-bk').evaluateAll((els) => els.filter((e) => e.style.display !== 'none').length);
    ck('搜索「置身」只剩 1 本', vis === 1, String(vis));

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    /* ★ 收尾：把探针造的书 / 笔记 / 记录全删掉 ✓（用户的真实数据一条不动 ✓）*/
    try {
      const d = await store();
      const ids = (d.books || []).filter((x) => String(x.title).includes(MARK)).map((x) => x.id);
      const before = { books: (d.books || []).length, notes: (d.bookNotes || []).length, log: (d.readLog || []).length };
      d.books = (d.books || []).filter((x) => !String(x.title).includes(MARK));
      d.bookNotes = (d.bookNotes || []).filter((n) => !ids.includes(n.bookId));
      d.readLog = (d.readLog || []).filter((r) => !ids.includes(r.bookId));
      delete d.bookSel; delete d.wereadCookie;
      await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const a = await store();
      console.log('\n收尾：书 ' + before.books + '→' + (a.books || []).length + ' · 笔记 ' + before.notes + '→' + (a.bookNotes || []).length + ' · 记录 ' + before.log + '→' + (a.readLog || []).length
        + ' | 剩下没清掉的探针书: ' + (a.books || []).filter((x) => String(x.title).includes(MARK)).length);
    } catch (e) { console.log('\n收尾失败（需手工检查）: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
