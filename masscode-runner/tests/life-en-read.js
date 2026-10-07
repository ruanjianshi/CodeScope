#!/usr/bin/env node
/* 外刊精读「读文章」的端到端探针 ✓ —— 打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。
   四个用户原话（2026-10）：
     ① 「划词怎么没有用」
     ② 「怎么没有双语对应翻译」
     ③ 「上下窗口无法自由拖动」
     ④ 「点击原文，会自动跳到开头去」
   ⚠️ ①②③④ 里 **①和④是同一个根因** ✓（点句子整屏 render ✗）——
      所以这个探针要**分别验** ✗，不能只验一个就以为另一个也好 ✓。
   ⚠️ AI 配置存在**浏览器 localStorage** 里 ✗（探针用全新 profile ✗，读不到 ✓）——
      所以用 `page.route` **拦一个假 AI** ✓：
      这样整条链路（按钮 → 请求 → 按编号对齐 → 渲染 → 缓存）都能离线验 ✓。
   ⚠️ 探针会往 STORE 里加一篇**自己的文章** ✗ —— finally 里按 id 删掉 ✓。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const MARK = '__探针精读__';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};
const put = async (d) => fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });

/* 固定的正文 ✓ —— 句子边界清楚 ✓，方便断言「第几句」✓。
   ⚠️ 要**够长** ✗（24 句 ✓）—— 太短的话正文容器**根本滚不动** ✗，
      而「点句子会不会跳回开头」这条断言**必须先滚下去**才有意义 ✗
      （实测：6 句时 scrollTop 只能到 52 ✗ → 前置条件不成立 ✗ → 假失败 ✗）。 */
const SENT = [
  'Gut microbes followed migrating humans across continents, new study suggests.',
  'The Hadza people are hunter-gatherers who have roamed northern Tanzania for thousands of years.',
  'The indigenous Tsimane people forage, fish and hunt in the Bolivian Amazon, some 7,000 miles away.',
  'These two rural communities, separated by an ocean, may appear to have little in common.',
  'But a new study shows that they share remarkable similarities when it comes to the bacteria in their guts.',
  'Experts say the new paper in the journal Nature suggests this microbial kinship may have taken shape long ago.',
  'Researchers collected stool samples from dozens of volunteers in both communities.',
  'They then compared the results with samples taken from people living in cities.',
  'The differences were striking, according to the authors of the study.',
  'Urban dwellers tended to carry fewer kinds of bacteria overall.',
  'Some of the species that were missing have been linked to chronic inflammation.',
  'That does not prove that city life causes disease, the researchers cautioned.',
  'Many other factors, including diet and antibiotics, could play a role.',
  'Still, the findings add to a growing body of work on the human microbiome.',
  'Other scientists said the sample size was small but the methods were sound.',
  'They called for longer studies that follow the same people over time.',
  'The question of what a healthy gut actually looks like remains open.',
  'There is no single answer that applies to everyone, experts said.',
  'What works for one person may not work for another.',
  'The team plans to expand its work to other parts of the world.',
  'They hope to include communities in South America and Southeast Asia.',
  'Funding for the next phase has not yet been secured.',
  'The full paper is available on the journal website.',
  'A summary for general readers is also published online.',
];
const TEXT = SENT.join(' ');

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  /* 造一篇自己的文章 ✓（记 id ✓，收尾按 id 删 ✓） */
  const d0 = await store();
  const artId = 'aprobe' + Date.now();
  const keep = {
    epArt: d0.epArt, readMode: d0.readMode, epPanelH: d0.epPanelH,
    articles: (d0.articles || []).map((a) => a && a.id),
  };
  d0.articles = (d0.articles || []).concat([{
    id: artId, title: MARK + '肠道菌群', site: 'probe', url: '',
    text: TEXT, level: 'B2', words: 120, minutes: 1, done: {},
    at: Date.now(), edit: Date.now(),
  }]);
  d0.epArt = artId; d0.readMode = 'ex';
  delete d0.epPanelH;
  await put(d0);

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  /* ★ 假 AI ✓ —— 把 `[n] 英文` 变成 `[n] 【译】…` ✓，模拟模型守编号的情况 ✓ */
  let aiCalls = 0;
  await p.route('**/api/ai/chat', async (route) => {
    aiCalls++;
    let user = '';
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      const m = (body.messages || []).filter((x) => x.role === 'user').pop();
      user = String((m && m.content) || '');
    } catch (_) {}
    const out = user.split('\n').filter(Boolean).map((l) => {
      const mm = /^\s*\[(\d+)\]\s*(.*)$/.exec(l);
      return mm ? ('[' + mm[1] + '] 【译】' + mm[2].slice(0, 18)) : l;
    }).join('\n');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content: out }) });
  });
  /* 把 AI 配置塞进 localStorage ✓（不然按钮只会提示「还没配置 AI」✗） */
  await p.addInitScript(() => {
    try { localStorage.setItem('mc-ai-cfg', JSON.stringify({ url: 'https://example.invalid/v1/chat/completions', key: 'k', model: 'm' })); } catch (_) {}
  });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  /* ⚠️ 诊断用 ✗ —— 定位「我这篇什么时候不见的」✓ */
  const diagArt = async (tag) => {
    const d = await store();
    const n = (d.articles || []).length;
    const mine = !!(d.articles || []).find((x) => x && x.id === artId);
    console.log('    [诊断] ' + tag + '：文章 ' + n + ' 篇 · 我这篇' + (mine ? '在 ✓' : '**不在了** ✗'));
    return mine;
  };

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-ep-body', { timeout: 20000 }); await p.waitForTimeout(1000);

    await diagArt('① 开始'); console.log('\n── ① 划词（用户原话「划词怎么没有用」）──');
    ck('正文渲染出来了', await p.locator('[data-epsent]').count() >= 5, String(await p.locator('[data-epsent]').count()));
    /* ★ 真鼠标拖选 ✓（不是手动造选区 ✗）—— 因为那个 bug 就出在真鼠标路径上 ✗：
       拖选 → mouseup → 紧跟着 click 整屏 render → 选区没了 ✗。
       ⚠️⚠️ 拖的**起点必须落在真实文字上** ✗✗ —— 不能用 span 的 boundingBox ✗：
          inline span 一折行，boundingBox 就是**两行的并集** ✗，
          中间那一大块是**没有文字的** ✗ → 在那儿拖，事件**根本到不了 span** ✗
          （实测：mouseup / click 日志一条都没有 ✗ → 探针自己假失败 ✗）。
       → 用 `Range` 量出**前三个字符**的真实矩形 ✓，从那儿开始拖 ✓。 */
    const w0 = await p.evaluate(() => {
      const el = document.querySelector('[data-epsent]');
      if (!el || !el.firstChild) return null;
      const r = document.createRange();
      r.setStart(el.firstChild, 0);
      r.setEnd(el.firstChild, Math.min(3, String(el.firstChild.textContent || '').length));
      const b = r.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    });
    ck('  量到了第一个词的位置', !!w0 && w0.w > 4, JSON.stringify(w0));
    await p.mouse.move(w0.x + 1, w0.y + w0.h / 2);
    await p.mouse.down();
    await p.mouse.move(w0.x + w0.w - 2, w0.y + w0.h / 2, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(600);
    const picked = await p.locator('#lw-ep-new').inputValue().catch(() => '');
    console.log('    划到的词: ' + JSON.stringify(picked));
    ck('★★ 划词真的填进「加生词」输入框了', !!picked && /[a-z]/i.test(picked), JSON.stringify(picked));
    ck('★ 提示也变了（说清划中的是哪个词）', /划中的是/.test(await txt('#lw-ep-newtip')), await txt('#lw-ep-newtip'));
    /* ⚠️ 反面：划词**不该**顺手把句子选中 —— 但那其实是**预期**行为 ✓
       （用户划词时也想看那句的详情 ✓），所以这里不禁止 ✓，只确认句子也选上了 ✓。 */
    ck('★ 划词时那一句也被选中（顺带看到句子详情）', await p.locator('.lw-ep-s.on').count() === 1);

    await diagArt('② 开始'); console.log('\n── ② 点句子**不跳回开头**（用户原话「点击原文会自动跳到开头去」）──');
    const body = p.locator('#lw-ep-body');
    await body.evaluate((el) => { el.scrollTop = 300; });
    await p.waitForTimeout(400);
    const before = await body.evaluate((el) => el.scrollTop);
    ck('  先把正文滚下去（前置条件成立）', before > 100, String(before));
    /* ⚠️⚠️ 点的那一句必须**本来就在视口里** ✗✗ ——
       `locator.click()` 会**先自动把元素滚进视口** ✗，
       点一个屏幕外的句子 → 它自己滚过去 ✗ → 看起来像「点一下就跳了」✗，
       其实是**探针自己滚的** ✗（实测：260 → 605 ✗，我差点当成真 bug ✗）。
       → 挑一个**正落在视口中间**的句子 ✓，这样 Playwright 不需要滚 ✓。 */
    const midIdx = await p.evaluate(() => {
      const box = document.getElementById('lw-ep-body');
      const b = box.getBoundingClientRect();
      const mid = b.top + b.height / 2;
      let best = -1, bestD = 1e9;
      box.querySelectorAll('[data-epsent]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height <= 0) return;
        const d = Math.abs((r.top + r.height / 2) - mid);
        if (d < bestD) { bestD = d; best = Number(el.dataset.epsent); }
      });
      return best;
    });
    console.log('    滚到 ' + before + ' 后，点视口中间那句（第 ' + (midIdx + 1) + ' 句）');
    ck('  找到了一个在视口里的句子', midIdx >= 0, String(midIdx));
    await p.locator('[data-epsent="' + midIdx + '"]').click();
    await p.waitForTimeout(600);
    const after = await p.locator('#lw-ep-body').evaluate((el) => el.scrollTop);
    console.log('    滚动位置 ' + before + ' → ' + after);
    ck('★★ 点句子后**滚动位置没变**（没跳回开头）', Math.abs(after - before) <= 2, before + ' → ' + after);
    ck('★ 而且下半部分确实换成了新那句',
      new RegExp('第 ' + (midIdx + 1) + ' 句').test(await txt('.lw-ep-panel')),
      (await txt('.lw-ep-panel')).slice(0, 40));

    await diagArt('③ 开始'); console.log('\n── ③ 上下拖动（用户原话「上下窗口无法自由拖动」）──');
    ck('★ 有上下拖拽条', await p.locator('[data-epgrip]').count() === 1);
    const h0 = (await p.locator('#lw-ep-panel').boundingBox()).height;
    const g = await p.locator('[data-epgrip]').boundingBox();
    await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await p.mouse.down();
    await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - 140, { steps: 10 });  /* 往上拖 = 面板变高 ✓ */
    await p.mouse.up();
    await p.waitForTimeout(500);
    const h1 = (await p.locator('#lw-ep-panel').boundingBox()).height;
    console.log('    面板高 ' + Math.round(h0) + ' → ' + Math.round(h1));
    ck('★★ 往上拖，面板真的变高了', h1 > h0 + 80, Math.round(h0) + ' → ' + Math.round(h1));
    const saved = Number((await store()).epPanelH || 0);
    ck('★ 拖完的高度**落盘了**（刷新还在）', saved > 0 && Math.abs(saved - h1) <= 3, '存了 ' + saved + '，实际 ' + Math.round(h1));
    await p.locator('[data-epgrip]').dblclick(); await p.waitForTimeout(500);
    const h2 = (await p.locator('#lw-ep-panel').boundingBox()).height;
    ck('★ 双击恢复默认', Math.abs(h2 - h0) <= 6, Math.round(h0) + ' → ' + Math.round(h2));

    await diagArt('④ 开始'); console.log('\n── ④ 双语对照翻译（用户原话「怎么没有双语对应翻译」）──');
    ck('★ 工具栏有「⇄ 对照翻译」按钮', await p.locator('#lw-ep-tr').count() === 1, await txt('#lw-ep-tr'));
    ck('  一开始没有译文行', await p.locator('[data-eptr]').count() === 0);
    await p.click('#lw-ep-tr');
    await p.waitForFunction(() => document.querySelectorAll('[data-eptr]').length > 0, null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const nTr = await p.locator('[data-eptr]').count();
    console.log('    译文行数 ' + nTr + '（正文 24 句）');
    ck('★★ 每句下面都出现译文行', nTr === 24, String(nTr));
    const trTexts = await p.locator('[data-eptr]').allInnerTexts();
    console.log('    第一句译文: ' + JSON.stringify(String(trTexts[0] || '').slice(0, 50)));
    ck('★★ 译文**真的有内容**（不是空壳）', trTexts.every((t) => /【译】/.test(t)), JSON.stringify(trTexts.slice(0, 2)));
    ck('★ 译文和原文**一句对一句**（第一句对上）', /【译】Gut microbes/.test(String(trTexts[0] || '')), String(trTexts[0] || '').slice(0, 60));
    ck('★ 按钮变成「收起译文」', /收起译文/.test(await txt('#lw-ep-tr')), await txt('#lw-ep-tr'));
    ck('★ 译文行挂在句子**下面**（不是单独一列）', await p.evaluate(() => {
      const s = document.querySelector('[data-epsent]');
      const t = document.querySelector('[data-eptr]');
      if (!s || !t) return false;
      const a = s.getBoundingClientRect(), c = t.getBoundingClientRect();
      return c.top >= a.top - 2 && c.left <= a.right;   /* 在它下面 ✓ */
    }));
    /* 收起 → 再展开：**不该重新问模型** ✓（译文挂在文章上 ✓） */
    await p.click('#lw-ep-tr'); await p.waitForTimeout(700);
    ck('★ 点一下能收起（译文行没了）', await p.locator('[data-eptr]').count() === 0);
    const callsBefore = aiCalls;
    await p.click('#lw-ep-tr'); await p.waitForTimeout(900);
    ck('★★ 再展开是**秒开**（没重新打模型）', aiCalls === callsBefore && await p.locator('[data-eptr]').count() === 24,
      'AI 调用 ' + callsBefore + ' → ' + aiCalls);
    /* 刷新后译文还在 ✓（挂在文章上 ✓） */
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForTimeout(1500);
    /* ⚠️ 刷新后先诊断一下 ✗ —— 别直接 waitForSelector 然后超时 ✗，
       那样只知道「没出来」✗，不知道是模式不对还是文章没了 ✗。 */
    const diag = await p.evaluate(() => ({
      body: document.querySelectorAll('.lw-ep-body').length,
      rdwrap: document.querySelectorAll('.lw-rd-wrap').length,
      modeOn: (document.querySelector('[data-rdmode].on') || {}).textContent || '(无)',
    }));
    const stMode = (await store()).readMode;
    console.log('    刷新后：' + JSON.stringify(diag) + ' · STORE.readMode=' + stMode);
    ck('★ 刷新后仍在「外刊精读」模式（模式是落盘的 ✓）', diag.body >= 1, JSON.stringify(diag) + ' readMode=' + stMode);
    if (diag.body < 1) {
      /* 兜底：切到 ex 模式再继续验译文 ✓（免得因为模式问题把「译文持久化」这条也带崩 ✗） */
      await p.evaluate(() => {
        const el = document.querySelector('[data-rdmode="ex"]');
        if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await p.waitForSelector('.lw-ep-body', { timeout: 15000 });
    }
    await p.waitForTimeout(600);
    const st = await store();
    const art = (st.articles || []).find((x) => x && x.id === artId);
    ck('★★ 译文**落盘**了（刷新后不用重译）', !!(art && art.tr && art.tr.pairs && art.tr.pairs.filter((x) => x.dst).length >= 24),
      art && art.tr ? String(art.tr.pairs.filter((x) => x.dst).length) + ' 句有译文' : '没有 tr');

    await diagArt('⑤ 开始'); console.log('\n── ⑤ 「还没配置 AI」也要说人话（不崩）──');
    /* ⚠️ 先把这篇的译文**清掉** ✗ —— 不清的话点按钮只会把已有译文展开 ✓，
       根本走不到「没配 AI」那条分支 ✗（实测：探针拿到的是一整屏正文 ✗，假失败 ✗）。 */
    {
      const d = await store();
      const a = (d.articles || []).find((x) => x && x.id === artId);
      if (a) delete a.tr;
      await put(d);
    }
    const b2 = await chromium.launch({ executablePath: exe, headless: true });
    const p2 = await b2.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await p2.route('**/api/ai/chat', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"不该走到这里"}' }));
      /* ⚠️ 这一次**故意不注入** AI 配置 ✗ → 应该看到「还没配置 AI」✓ */
      await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await p2.waitForSelector('#btn-lifework', { timeout: 20000 });
      await p2.click('#btn-lifework'); await p2.waitForSelector('#lifework-view', { timeout: 20000 });
      await p2.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
      await p2.waitForSelector('.lw-ep-body', { timeout: 20000 }); await p2.waitForTimeout(900);
      const trBtn2 = p2.locator('#lw-ep-tr');
      if (await trBtn2.count()) {
        await trBtn2.click(); await p2.waitForTimeout(1200);
        const t2 = (await p2.locator('.lw-ep-body').innerText()).replace(/\n/g, ' ');
        console.log('    提示: ' + JSON.stringify(t2.slice(0, 90)));
        ck('★ 没配 AI 时给的是**指路**的话（不是崩 / 不是空白）', /还没配置 AI/.test(t2) && /本机管家/.test(t2), t2.slice(0, 90));
      } else { ck('★ 没配 AI 时按钮还在（能点）', false, '(没有按钮)'); }
    } finally { await b2.close(); }

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      const before = (d.articles || []).length;
      d.articles = (d.articles || []).filter((a) => a && a.id !== artId && String(a.title).indexOf(MARK) < 0);
      /* 原样还原 ✓（只动自己造的那篇 ✓） */
      if (keep.epArt !== undefined) d.epArt = keep.epArt; else delete d.epArt;
      if (keep.readMode !== undefined) d.readMode = keep.readMode; else delete d.readMode;
      if (keep.epPanelH !== undefined) d.epPanelH = keep.epPanelH; else delete d.epPanelH;
      await put(d);
      const a = await store();
      console.log('\n收尾：文章 ' + before + '→' + (a.articles || []).length
        + ' · 残留探针文章 ' + (a.articles || []).filter((x) => x && (x.id === artId || String(x.title).indexOf(MARK) >= 0)).length);
    } catch (e) { console.log('\n收尾失败: ' + e.message); fails.push('收尾失败'); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
