#!/usr/bin/env node
/* 词根词缀（思维导图）的端到端探针 ✓ —— 打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。
   用户原话：「帮我新增词根词缀，方便我查询和记忆相关，大致做成思维导图的样式，
             参考现有的阅读模块的我的英语里面的词根词缀设计，进行合理化设计，
             强化可视化和巧记，图形化等等」✓。

   ⚠️ 会改用户的 STORE（`roots` 标记 + `readMode` + 可能加一个生词 ✓）→
      `finally` 里**逐项还原** ✓（不是「删掉自己造的」就完事 ✗ ——
      收藏 / 已掌握是**改**用户的字段 ✓，得按快照还 ✓）。
   ⚠️ 阅读模块的**模式是落盘的** ✗（`STORE.readMode` ✓）→ 探针开头先切到词根页 ✓、
      结尾切回**进来时那个模式** ✓（不然用户下次打开会莫名跳到别的页 ✓）。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};
const put = async (d) => fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const snap = await store();
  const keep = { roots: snap.roots, readMode: snap.readMode, words: snap.words, wordSel: snap.wordSel, epWordFilter: snap.epWordFilter };
  const wordsBefore = new Set((snap.words || []).map((w) => w && w.id));
  const madeWords = [];

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const natives = [];
  p.on('dialog', async (d) => { natives.push(d.type()); await d.dismiss().catch(() => {}); });
  /* AI 拆词那条**拦掉** ✓ —— 探针是全新 profile，读不到用户 localStorage 里的 AI 配置 ✗，
     不拦的话「让 AI 拆一下」会一直转 ✓（这个坑在电子书那轮踩过 ✓）。 */
  let aiCalls = 0;
  await p.addInitScript(() => {
    try { localStorage.setItem('mc-ai-cfg', JSON.stringify({ url: 'https://example.invalid/v1/chat/completions', key: 'k', model: 'm' })); } catch (_) {}
  });
  await p.route('**/api/ai/chat', (r) => {
    aiCalls++;
    return r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, content: '好的：\n```json\n{"split":"flocc-（絮状）+ in-（向内）+ auc-（听）+ ini-（小的）+ hil-（细）+ ipil-（毛）","note":"这个词是玩笑词，没有真实词根"}\n```' }),
    });
  });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  const has = async (s) => (await p.locator(s).count()) > 0;

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 }); await p.waitForTimeout(900);

    console.log('\n── ① 共享库 + 模式条 ──');
    const lib = await p.evaluate(() => ({
      ok: !!window.LW_ROOTS,
      st: window.LW_ROOTS ? window.LW_ROOTS.stats() : null,
      fns: window.LW_ROOTS ? Object.keys(window.LW_ROOTS).length : 0,
    }));
    ck('★★ window.LW_ROOTS 到位（双栖模块加载上了）', lib.ok, JSON.stringify(lib));
    ck('  词库够大（≥200 条，且三类都有）', !!lib.st && lib.st.total >= 200 && lib.st.pre > 30 && lib.st.root > 100,
      JSON.stringify(lib.st));
    ck('  导出的函数够全（≥12 个）', lib.fns >= 12, String(lib.fns));
    ck('★ 模式条多了一个「词根词缀」', await has('[data-rdmode="root"]'), (await txt('.lw-rd-modes')).slice(0, 120));

    console.log('\n── ② 切进去：**一进来就有导图**（右栏空着最劝退）──');
    await p.locator('[data-rdmode="root"]').dispatchEvent('click');
    await p.waitForTimeout(1400);
    ck('★★ 三栏都在（复用同一套类名）', await has('.lw-rd-side') && await has('.lw-rd-list') && await has('.lw-rd-read'));
    ck('★★ 自动选中了一条（不是空态）', !(await txt('.lw-rd-read')).includes('从中间挑一个'));
    ck('  而且挑的是**能当门面**的那条（spect，不是 a-）',
      (await txt('.lw-rm-n.k-root')).indexOf('spec') >= 0, await txt('.lw-rm-n.k-root'));
    ck('★ 左栏有类型筛选（全部 / 词根 / 前缀 / 后缀）', await p.locator('[data-rmtype]').count() === 4,
      String(await p.locator('[data-rmtype]').count()));
    ck('★ 左栏有「我的」（收藏 / 还没记 / 已掌握）', await p.locator('[data-rmonly]').count() === 4,
      String(await p.locator('[data-rmonly]').count()));

    console.log('\n── ③ ★★ 思维导图本身 ──');
    ck('★★ 画布 + 图层都在', await has('#lw-rm-stage') && await has('#lw-rm-plane'));
    const dims = await p.locator('.lw-rm-n.k-dim').count();
    ck('★★ 六个维度分支（含义 / 例词 / 搭配 / 同义 / 巧记 / 词源）', dims === 6, String(dims));
    const dimNames = (await p.locator('.lw-rm-n.k-dim .t').allInnerTexts()).join('|');
    ck('  分支名对得上', /含义/.test(dimNames) && /例词/.test(dimNames) && /搭配/.test(dimNames)
      && /同义/.test(dimNames) && /巧记/.test(dimNames) && /词源/.test(dimNames), dimNames);
    ck('★ 中心节点是那个词根（大字 + 含义）', (await txt('.lw-rm-n.k-root')).indexOf('看') >= 0, await txt('.lw-rm-n.k-root'));
    const nodes = await p.locator('.lw-rm-n').count();
    const edges = await p.locator('.lw-rm-svg path').count();
    ck('★ 节点够多（中心 + 6 支 + 一堆条目）', nodes >= 14, String(nodes));
    ck('★★ 连线数 = 节点数 − 1（一棵完整的树，没有漏连 / 多连）', edges === nodes - 1, edges + ' 条线 / ' + nodes + ' 个节点');
    ck('★ 连线是**彩色**的（每一支一个颜色，一眼分得清）', await p.evaluate(() => {
      const cs = Array.from(document.querySelectorAll('.lw-rm-svg path')).map((x) => x.getAttribute('stroke'));
      return new Set(cs).size >= 5;
    }));
    /* ⚠️ 节点**不能重叠** ✗ —— 第一版行高统一 ✓，那个 46px 的长句节点会压到邻居身上 ✓ */
    const overlap = await p.evaluate(() => {
      const rs = Array.from(document.querySelectorAll('.lw-rm-n')).map((x) => x.getBoundingClientRect());
      let bad = 0;
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i], c = rs[j];
          if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) bad++;
        }
      }
      return bad;
    });
    ck('★★ 节点之间**不重叠**（长句节点不能压到邻居）', overlap === 0, overlap + ' 对重叠');
    const fit = await p.evaluate(() => document.getElementById('lw-rm-plane').style.transform);
    ck('★ 「适应屏幕」把图缩放到装得下（不是 1:1 铺出去）', /scale\(0?\.\d|scale\(1\.[0-3]/.test(fit), fit);

    console.log('\n── ④ 折叠 / 展开 ──');
    const before = await p.locator('.lw-rm-n').count();
    await p.locator('[data-rmfold="eg"]').click(); await p.waitForTimeout(700);
    const after = await p.locator('.lw-rm-n').count();
    ck('★ 点分支能折叠（例词那一支收起来，节点变少）', after < before, before + ' → ' + after);
    ck('  折叠后那支标着「N 项」（知道藏了多少）', /\d+ 项/.test(await txt('[data-rmfold="eg"]')), await txt('[data-rmfold="eg"]'));
    await p.locator('#lw-rm-unfold').click(); await p.waitForTimeout(700);
    ck('★ 「展开全部」能还原', (await p.locator('.lw-rm-n').count()) === before, String(await p.locator('.lw-rm-n').count()));
    await p.locator('#lw-rm-fold').click(); await p.waitForTimeout(700);
    ck('★ 「折叠」把六支全收起来', (await p.locator('.lw-rm-n').count()) <= 8, String(await p.locator('.lw-rm-n').count()));
    await p.locator('#lw-rm-unfold').click(); await p.waitForTimeout(700);

    console.log('\n── ⑤ 拖动平移 / 滚轮缩放 ──');
    const t0 = await p.evaluate(() => document.getElementById('lw-rm-plane').style.transform);
    await p.evaluate(() => {
      const st = document.getElementById('lw-rm-stage');
      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, buttons,
        pointerId: 9, pointerType: 'mouse', isPrimary: true, button: type === 'pointerdown' ? 0 : -1,
      });
      const r = st.getBoundingClientRect();
      st.dispatchEvent(mk('pointerdown', r.left + 40, r.top + 40, 1));
      document.dispatchEvent(mk('pointermove', r.left + 140, r.top + 120, 1));
      document.dispatchEvent(mk('pointerup', r.left + 140, r.top + 120, 0));
    });
    await p.waitForTimeout(400);
    const t1 = await p.evaluate(() => document.getElementById('lw-rm-plane').style.transform);
    ck('★★ 按住空白处能拖动平移', t0 !== t1, t0 + ' → ' + t1);
    await p.locator('#lw-rm-stage').hover();
    await p.mouse.wheel(0, -240);
    await p.waitForTimeout(400);
    const t2 = await p.evaluate(() => document.getElementById('lw-rm-plane').style.transform);
    ck('★★ 滚轮能缩放', t1 !== t2, t1 + ' → ' + t2);
    await p.locator('#lw-rm-fit').click(); await p.waitForTimeout(500);
    const t3 = await p.evaluate(() => document.getElementById('lw-rm-plane').style.transform);
    ck('★ 「适应屏幕」能把跑偏的图拉回来', t3 !== t2, t2 + ' → ' + t3);

    console.log('\n── ⑥ 搜索：形 / 中文 / **一个整词** ──');
    await p.locator('#lw-rm-q').fill('spect'); await p.waitForTimeout(600);
    ck('★ 搜词根 → 列表只剩相关的', (await p.locator('.lw-rm-row').count()) <= 6 && (await p.locator('.lw-rm-row').count()) >= 1,
      String(await p.locator('.lw-rm-row').count()));
    ck('  第一条就是它', (await txt('.lw-rm-row .fm')) === 'spec', await txt('.lw-rm-row .fm'));
    await p.locator('#lw-rm-q').fill('看'); await p.waitForTimeout(600);
    ck('★★ 搜**中文**也能搜到（按含义）', (await p.locator('.lw-rm-row').count()) >= 2, String(await p.locator('.lw-rm-row').count()));
    /* ⚠️ 搜索框**不能整屏重绘** ✗ —— 会失焦 ✓，用户打不了第二个字 ✓ */
    const focus = await p.evaluate(() => document.activeElement && document.activeElement.id);
    ck('★★ 边打字**不失焦**（没整屏重绘）', focus === 'lw-rm-q', String(focus));

    console.log('\n── ⑦ ★★ 整词拆解（「方便我查询」那条路）──');
    await p.locator('#lw-rm-q').fill('transport'); await p.waitForTimeout(700);
    ck('★★ 贴一个整词 → 出现「怎么拆」那张卡', await has('.lw-rm-card'), await txt('.lw-rm-card').catch(() => ''));
    const card = await txt('.lw-rm-card');
    console.log('    拆解: ' + JSON.stringify(card.slice(0, 90)));
    ck('★★ 拆得对（trans- 穿过 + port 携带）', /trans-/.test(card) && /port/.test(card) && /穿过/.test(card) && /携带/.test(card), card.slice(0, 90));
    ck('★ 每个部件都能点（点了跳到那个词根）', await p.locator('.lw-rm-chip.go').count() >= 2, String(await p.locator('.lw-rm-chip.go').count()));
    await p.locator('.lw-rm-chip.go').first().click(); await p.waitForTimeout(900);
    ck('★★ 点部件 → 导图换成那个词根', (await txt('.lw-rm-n.k-root')).indexOf('trans') >= 0, await txt('.lw-rm-n.k-root'));
    /* ⚠️ 库里没有词根的词 → **不许编** ✗，要老实说 ✓。
       分两种情形 ✗（我第一版只想到一种 ✓）：
         · 只拆得出词缀 → 说「中间那块是词干」✓ 并给 AI 入口 ✓；
         · 一个词缀都对不上 → 说「拆不出来」✓ 并给 AI 入口 ✓。 */
    await p.locator('#lw-rm-q').fill('floccinaucinihilipilification'); await p.waitForTimeout(700);
    const stemCard = await txt('.lw-rm-card');
    console.log('    只拆出词缀: ' + JSON.stringify(stemCard.slice(0, 100)));
    ck('★★ 只拆出词缀时**明说「中间是词干」**（不假装有词根）', /词干/.test(stemCard) && /只拆出了词缀/.test(stemCard), stemCard.slice(0, 90));
    ck('★ 这种情况也给 AI 入口（结果弱，想更细）', await has('#lw-rm-ai'));
    await p.locator('#lw-rm-ai').click(); await p.waitForTimeout(1600);
    const aiCard = await txt('.lw-rm-card');
    console.log('    AI 拆的: ' + JSON.stringify(aiCard.slice(0, 90)));
    ck('★★ AI 拆的结果**明确标了「AI 拆的、没核对过」**（不能假装是标准答案）',
      aiCalls >= 1 && /AI 拆的/.test(aiCard), 'aiCalls=' + aiCalls + ' · ' + aiCard.slice(0, 70));
    await p.locator('#lw-rm-splitx').click(); await p.waitForTimeout(700);
    ck('  拆解卡能关掉', !(await has('.lw-rm-card')));
    /* 一个词缀都对不上的串 → 直接说拆不出来 ✓ */
    await p.locator('#lw-rm-q').fill('xqjzz'); await p.waitForTimeout(700);
    ck('★★ 完全拆不出来的词：老实说拆不出来（不硬凑）', (await txt('.lw-rm-card')).indexOf('没有能拆') >= 0, await txt('.lw-rm-card'));
    await p.locator('#lw-rm-splitx').click(); await p.waitForTimeout(600);

    console.log('\n── ⑧ ★ 随机自测（「方便我记忆」那条路）──');
    await p.locator('#lw-rm-quiz').click(); await p.waitForTimeout(900);
    ck('★★ 自测模式开了（题目 + 遮住答案）', await has('.lw-rm-quiz'), await txt('.lw-rm-quiz'));
    ck('  答案**先藏着**（不然等于没考）', !(await has('#lw-rm-qok')), await txt('.lw-rm-quiz'));
    await p.locator('#lw-rm-qshow').click(); await p.waitForTimeout(700);
    ck('★ 点「显示答案」才露出来', await has('#lw-rm-qok') && await has('#lw-rm-qno'));
    const qkey = await p.evaluate(() => (document.querySelector('.lw-rm-n.k-root') || {}).dataset ? null : null);
    void qkey;
    const quizRoot = (await txt('.lw-rm-quiz')).match(/[a-z]{3,}/);
    await p.locator('#lw-rm-qok').click(); await p.waitForTimeout(1000);
    const st1 = await store();
    const marked = Object.keys(st1.roots || {}).filter((k) => st1.roots[k].done);
    ck('★★ 答「记住了」→ 顺手标成**已掌握**并落盘', marked.length >= 1, JSON.stringify(marked.slice(0, 3)) + ' · 题面 ' + quizRoot);
    ck('  而且自动跳到下一题（这一轮继续）', await has('.lw-rm-quiz'), await txt('.lw-rm-quiz').catch(() => ''));
    await p.locator('#lw-rm-quiz2').click().catch(() => {});
    await p.waitForTimeout(600);

    console.log('\n── ⑨ ⭐ 收藏 / ✓ 已掌握（落盘，刷新还在）──');
    await p.locator('[data-rmtype="root"]').click(); await p.waitForTimeout(700);
    await p.locator('[data-rmpick="spec"]').click(); await p.waitForTimeout(900);
    await p.locator('#lw-rm-star').click(); await p.waitForTimeout(700);
    const st2 = await store();
    ck('★★ 「⭐ 收藏」落盘了', !!(st2.roots && st2.roots.spec && st2.roots.spec.star), JSON.stringify(st2.roots && st2.roots.spec));
    ck('★ 左栏「收藏」的数量跟着涨', (await txt('[data-rmonly="star"]')).indexOf('1') >= 0, await txt('[data-rmonly="star"]'));
    await p.locator('[data-rmonly="star"]').click(); await p.waitForTimeout(700);
    ck('★★ 点「收藏」能筛出来（只剩收藏过的）',
      (await p.locator('.lw-rm-row').count()) === 1 && (await txt('.lw-rm-row .fm')) === 'spec',
      String(await p.locator('.lw-rm-row').count()));
    await p.locator('[data-rmonly="all"]').click(); await p.waitForTimeout(700);

    console.log('\n── ⑩ 点例词 → 一键加进**生词本**（复用外刊精读那套）──');
    await p.locator('[data-rmtype="all"]').click(); await p.waitForTimeout(600);
    await p.locator('[data-rmpick="spec"]').click(); await p.waitForTimeout(900);
    ck('★ 导图里的例词节点能点', await p.locator('[data-rmword]').count() >= 3, String(await p.locator('[data-rmword]').count()));
    const pickWord = await p.locator('[data-rmword]').nth(2).getAttribute('data-rmword');
    await p.locator('[data-rmword]').nth(2).click(); await p.waitForTimeout(2600);
    const st3 = await store();
    const nw = (st3.words || []).filter((w) => w && !wordsBefore.has(w.id));
    nw.forEach((w) => madeWords.push(w.id));
    console.log('    点了例词: ' + JSON.stringify(pickWord) + ' · 新增生词: ' + JSON.stringify(nw.map((x) => x.w)));
    ck('★★ 例词真的进了生词本', nw.length === 1 && nw[0].w === pickWord, JSON.stringify(nw.map((x) => x.w)));

    console.log('\n── ⑪ 刷新之后还在（模式 + 标记）──');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForTimeout(1400);
    ck('★★ 刷新后**还停在词根词缀**（模式落盘了）', await has('.lw-rm-n'), await txt('.lw-rd-modes').then((s) => s.slice(0, 60)));
    ck('★ 收藏 / 已掌握还在', await p.evaluate(() => {
      const el = document.querySelector('[data-rmonly="star"]');
      return !!el && /\d/.test(el.innerText) && el.innerText.replace(/\D/g, '') !== '0';
    }), await txt('[data-rmonly="star"]'));

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
    ck('★ 全程没有原生弹窗', natives.length === 0, JSON.stringify(natives));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      d.words = (d.words || []).filter((w) => w && madeWords.indexOf(w.id) < 0);
      ['roots', 'readMode', 'words', 'wordSel', 'epWordFilter'].forEach((k) => { if (keep[k] === undefined) delete d[k]; else d[k] = keep[k]; });
      await put(d);
      const a = await store();
      console.log('\n收尾：roots 标记 ' + Object.keys(a.roots || {}).length + ' 个（进来时 '
        + Object.keys(keep.roots || {}).length + ' 个）· 生词残留 '
        + (a.words || []).filter((w) => w && madeWords.indexOf(w.id) >= 0).length
        + ' · readMode 已还原 ✓');
    } catch (e) { console.log('\n收尾失败: ' + e.message); fails.push('收尾失败'); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
