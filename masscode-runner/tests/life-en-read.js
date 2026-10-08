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
    words: d0.words, wordSel: d0.wordSel, epWordFilter: d0.epWordFilter,
  };
  const wordsBefore = new Set((d0.words || []).map((w) => w && w.id));
  const madeWords = [];
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
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    /* ⚠️ ③e 那一节会**故意掐断**接口 ✗（验「Failed to fetch 要说人话」✓）——
       浏览器必然往控制台吐一条 `net::ERR_FAILED` ✓，那是**探针自己造的** ✗，
       不是产品异常 ✓（不滤掉的话「无页面异常」永远假失败 ✗）。 */
    if (/net::ERR_FAILED|Failed to load resource/.test(t)) return;
    errs.push('console: ' + t);
  });
  /* ★ 假 AI ✓ —— 要能答**两种**请求 ✗（不然「加词自动补全」那条验不了 ✓）：
       · 翻译（用户消息是 `[1] 英文…` ✓）→ 变成 `[1] 【译】…` ✓
       · 查词补全（用户消息是 `单词：xxx` ✓）→ 返回一张 JSON 词卡 ✓
     ⚠️ 第一版只答翻译 ✓，结果「词卡自动显示音标释义」那条**永远是「还没释义」** ✗
        —— 看起来像功能没做 ✗，其实是假 AI 不会答 ✓（这个坑在别的探针上踩过 ✓）。 */
  let aiCalls = 0;
  const mockAi = async (route) => {
    aiCalls++;
    let user = '';
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      const m = (body.messages || []).filter((x) => x.role === 'user').pop();
      user = String((m && m.content) || '');
    } catch (_) {}
    /* ★ 🧩 句子拆解 ✓（用户原话：「对句子进行拆解和分析，
       类似用英语语法的方式进行分析句子」✓）——
       ⚠️ 必须**排在「单词」那条前面** ✗：拆解的问句是「句子：…」✓，
          而句子里可能正好含「单词：」这种字样 ✓（今天没有，但别赌 ✓）。
       ⚠️ 故意包一层 ```json 围栏 ✗ —— 和词卡那条一样，验的就是「能不能剥干净」✓。 */
    const mSent = /^句子：([\s\S]+)$/.exec(user.trim());
    if (mSent) {
      const an = {
        skel: 'These two rural communities may appear to have little in common.',
        parts: [
          { en: 'These two rural communities', role: '主语', zh: '这两个乡村社区' },
          { en: 'separated by an ocean', role: '过去分词短语作后置定语，修饰 communities', zh: '被大洋隔开' },
          { en: 'may appear', role: '谓语（情态动词 + 动词原形，表推测）', zh: '可能显得' },
          { en: 'to have little in common', role: '不定式短语作表语', zh: '没什么共同之处' },
        ],
        tense: '一般现在时；may appear 表推测；to have 是不定式，表状态。',
        why: '主干很朴素，信息全塞在分隔结构里 —— 英文新闻的典型写法：先给结论，再插补充条件。',
        pattern: 'X, <分词短语>, may appear to Y.',
        sample: 'These two nearby villages, separated by a river, may appear to have nothing in common.',
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content: '好的，这是拆解：\n```json\n' + JSON.stringify(an) + '\n```\n' }) });
    }
    const mWord = /单词：\s*([A-Za-z][A-Za-z'\-]*)/.exec(user);
    if (mWord) {
      const card = {
        ph: '/ˈmaɪ.kroʊ.baɪ.oʊm/', pos: 'n.', def: '探针释义：微生物组',
        eg: 'The human ' + mWord[1] + ' is still poorly understood.',
        egZh: '人类的' + mWord[1] + '至今仍未被充分了解。',
        mnem: 'micro（小）+ bio（生命）+ ome（全体）→ 全部微小生命 = 微生物组。',
        scene: '显微镜下一片密密麻麻的小点，每一颗都标着不同的名字。',
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content: JSON.stringify(card) }) });
    }
    const out = user.split('\n').filter(Boolean).map((l) => {
      const mm = /^\s*\[(\d+)\]\s*(.*)$/.exec(l);
      return mm ? ('[' + mm[1] + '] 【译】' + mm[2].slice(0, 18)) : l;
    }).join('\n');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content: out }) });
  };
  await p.route('**/api/ai/chat', mockAi);
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
    /* ⚠️⚠️ 这条前置**是偶发的** ✗✗ —— 实测：跟其它探针连排时挂 ✓、单独跑就过 ✓
       （同一个循环里跑 6 个探针时红了一次 ✓，重跑单独一次全绿 ✓）。
       原因是「滚下去」这件事**取决于正文当时有没有撑出溢出** ✓：
       布局还没稳（或上一次拖拽落盘的高度偏大 ✓）时 `scrollTop = 300` 会被**夹回 0** ✗，
       于是后面那条「点句子后滚动位置没变」变成 **0 → 0 恒真** ✗
       —— 看着像通过 ✓，其实什么都没验 ✗（最坑的那种 ✓）。
       → 改成**自愈式**：反复设 + 读，直到真的滚下去 ✓；还是不行就把几何数据打出来 ✓。 */
    let before = 0;
    for (let i = 0; i < 10 && before <= 100; i++) {
      await body.evaluate((el) => { el.scrollTop = 300; });
      await p.waitForTimeout(300);
      before = await body.evaluate((el) => el.scrollTop);
    }
    if (before <= 100) {
      const g = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }));
      console.log('    滚不动：' + JSON.stringify(g));
    }
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
    const delta = after - before;
    console.log('    滚动位置 ' + before + ' → ' + after + '（Δ ' + delta + '）');
    /* ⚠️⚠️ 判据**不能要求「一字不差」** ✗✗ —— 第一版是 `Math.abs(after - before) <= 2` ✓，
       连排跑时红过一次 ✓、单独跑就绿 ✓（典型偶发 ✓）。
       根因：`locator.click()` 会在元素**没完全露出来**时**自己微调一下** ✗
       （视口中间那句也可能被裁掉半行 ✓）→ 位置差几十像素 ✓，
       那不是产品的问题 ✗，是**探针自己滚的** ✗（同一页上面那段注释就在讲这件事 ✓）。
       → 守**真正要守的东西** ✓：用户原话是「点击原文**会自动跳到开头**去」✗，
         所以判据是「**没往回跳到顶**」✓（外加「本来就不在顶上」✓），
         而不是「一像素都没动」✗。Δ 照旧打出来 ✓，真有大幅偏移一眼看得到 ✓。 */
    ck('★★ 点句子后**没跳回开头**（用户原话「点击原文会自动跳到开头去」）',
      after > 60 && delta > -40, before + ' → ' + after + '（Δ ' + delta + '）');
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

    await diagArt('③b 开始'); console.log('\n── ③b ★★ 划过的词：原文标记 / 词卡 / 定位回原句（2026-10-08 新需求）──');
    /* 用户原话三句：
         「这种划词的单词，需要在原文中标记，同时要有记忆，方便后期我记单词，
           可以定位到原文位置等」
         「还有下面这种音标和词义，不应该需要我来填写，去掉。应该和查词一样，显示给我」
         「划词不单单只有原文可以划词，选中的句子显示在下面的，也应该支持划词」 */
    const st0 = await store();
    const have0 = new Set((st0.words || []).map((w) => w && w.w));
    const WP = ['microbiome', 'forage', 'striking', 'antibiotics'].find((x) => !have0.has(x));
    ck('  挑到一个还没加过的测试词（避免撞用户已有的词）', !!WP, String(WP));
    const sIdx = SENT.findIndex((x) => x.indexOf(WP) >= 0);
    ck('  而且它就在正文里（第 ' + (sIdx + 1) + ' 句）', sIdx >= 0, String(sIdx));
    const baseMark = await p.locator('.lw-ep-s .lw-ep-w').count();
    console.log('    加词前，正文里的高亮数: ' + baseMark);
    await p.locator('[data-epsent="' + sIdx + '"]').click(); await p.waitForTimeout(500);
    await p.locator('#lw-ep-new').fill(WP);
    await p.locator('#lw-ep-addbtn').click();
    await p.waitForTimeout(2800);                       /* 等自动补全跑完 ✓ */
    const stW = await store();
    const newW = (stW.words || []).filter((w) => w && !wordsBefore.has(w.id));
    newW.forEach((w) => madeWords.push(w.id));
    ck('★ 词加进生词本了', newW.length === 1 && newW[0].w === WP, JSON.stringify(newW.map((x) => x.w)));

    /* ★★ ① 原文里**标出来** ✓ */
    const marks = await p.locator('.lw-ep-s .lw-ep-w').allInnerTexts();
    console.log('    加词后，正文里高亮的词: ' + JSON.stringify(marks.slice(0, 8)));
    ck('★★ 加过的词在**正文里被标出来了**', marks.some((t) => t.toLowerCase() === WP), JSON.stringify(marks.slice(0, 8)));
    ck('★ 高亮数量比之前多', await p.locator('.lw-ep-s .lw-ep-w').count() > baseMark, baseMark + ' → ' + await p.locator('.lw-ep-s .lw-ep-w').count());
    ck('★ 高亮的正好是**它出现的那一句**', await p.evaluate(([w, i]) => {
      const el = document.querySelector('[data-epsent="' + i + '"]');
      return !!el && Array.from(el.querySelectorAll('.lw-ep-w')).some((b) => String(b.textContent).toLowerCase() === w);
    }, [WP, sIdx]));
    ck('  而且记下了「来自哪句」（能定位回原文的前提）',
      !!(newW[0] && Number(newW[0].sentIdx) === sIdx && newW[0].artId === artId),
      newW[0] ? JSON.stringify({ sentIdx: newW[0].sentIdx, artId: newW[0].artId }) : '');
    ck('  还记下了那句原文（下标对不上时的兜底）', !!(newW[0] && String(newW[0].sent).indexOf(WP) >= 0), newW[0] && String(newW[0].sent).slice(0, 40));

    /* ★★ ③ 词卡：音标 / 释义**自动显示**，不再让人填 ✓ */
    ck('★★ 底部出现了**词卡**', await p.locator('.lw-ep-peek').count() === 1);
    const peek = await txt('.lw-ep-peek');
    console.log('    词卡: ' + JSON.stringify(peek.slice(0, 100)));
    ck('★★ 词卡里有**音标**（自动查的）', /\/[^/\s]{3,}\//.test(peek), peek.slice(0, 70));
    ck('★★ 词卡里有**释义**（自动查的）', /探针释义/.test(peek), peek.slice(0, 100));
    ck('★ 词卡里有例句 / 巧记（和「查词」一个待遇）', /micro|microbiome/i.test(peek) && /巧记|→|＝|=/.test(peek), peek.slice(0, 140));
    ck('★★ 那两个**手填输入框已经删掉**了（音标 / 释义）',
      await p.locator('#lw-ep-ph').count() === 0 && await p.locator('#lw-ep-def').count() === 0,
      'ph=' + await p.locator('#lw-ep-ph').count() + ' def=' + await p.locator('#lw-ep-def').count());

    /* ★ 点正文里高亮的词 → 词卡换成它 ✓ */
    await p.locator('.lw-ep-s .lw-ep-w').first().click(); await p.waitForTimeout(700);
    ck('★ 点原文里高亮的词 → 下面显示它的词卡',
      (await txt('.lw-ep-peek')).toLowerCase().indexOf((marks[0] || '').toLowerCase()) >= 0,
      JSON.stringify((await txt('.lw-ep-peek')).slice(0, 60)));

    /* ★★ ④ 底部那句「选中的句子」**也能划词** ✓ */
    await p.locator('[data-epsent="' + sIdx + '"]').click(); await p.waitForTimeout(500);
    const grab = await p.evaluate(() => {
      const el = document.querySelector('#lw-ep-sent');
      if (!el) return null;
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node = null;
      while (walk.nextNode()) {
        const t = walk.currentNode;
        if (String(t.textContent || '').trim().length > 8) { node = t; break; }
      }
      if (!node) return null;
      const r = document.createRange();
      r.setStart(node, 0);
      r.setEnd(node, Math.min(8, String(node.textContent).length));
      const b = r.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    });
    ck('  量到底部那句里第一个词的真实位置', !!grab && grab.w > 4, JSON.stringify(grab));
    await p.locator('#lw-ep-new').fill('');            /* 清空，好看出是不是**这句**划出来的 ✓ */
    await p.mouse.move(grab.x + 1, grab.y + grab.h / 2);
    await p.mouse.down();
    await p.mouse.move(grab.x + Math.max(2, grab.w - 2), grab.y + grab.h / 2, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(800);
    const picked2 = await p.locator('#lw-ep-new').inputValue().catch(() => '');
    console.log('    从底部那句划到的词: ' + JSON.stringify(picked2));
    ck('★★ 底部那句也能划词（划中的词进了输入框）', !!picked2 && /[a-z]/i.test(picked2), JSON.stringify(picked2));
    ck('★ 而且底部那句里的已加生词也标出来了', await p.evaluate((w) => {
      const el = document.querySelector('#lw-ep-sent');
      return !!el && Array.from(el.querySelectorAll('.lw-ep-w')).some((b) => String(b.textContent).toLowerCase() === w);
    }, WP), '');

    await diagArt('③c 开始'); console.log('\n── ③c ★ 选中一句就能**单独译它**（用户原话「我选中的句子进行翻译」）──');
    ck('★ 句子面板上有「⇄ 译这句」', await p.locator('#lw-ep-trone').count() === 1, await txt('#lw-ep-trone'));
    {
      /* 先把译文清掉 ✓（不然按钮是「重译」，而且下面会直接显示旧译文 ✓）*/
      const d = await store();
      const a = (d.articles || []).find((x) => x && x.id === artId);
      if (a) delete a.tr;
      await put(d);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#btn-lifework', { timeout: 20000 });
      await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
      await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
      await p.waitForSelector('.lw-ep-body', { timeout: 20000 }); await p.waitForTimeout(900);
    }
    ck('  前置：现在没有译文', await p.locator('.lw-ep-senttr').count() === 0);
    await p.locator('[data-epsent="1"]').click(); await p.waitForTimeout(500);
    const c0 = aiCalls;
    await p.locator('#lw-ep-trone').click();
    await p.waitForFunction(() => !!document.querySelector('.lw-ep-senttr'), null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(600);
    console.log('    模型调用 ' + c0 + ' → ' + aiCalls);
    ck('★★ 「译这句」只打**一次**模型（不是把整篇 24 句都发出去）', aiCalls === c0 + 1, c0 + ' → ' + aiCalls);
    const oneTr = await txt('.lw-ep-senttr');
    console.log('    单句译文: ' + JSON.stringify(oneTr.slice(0, 60)));
    ck('★★ 译文出现在**下面那句的下面**', oneTr.length > 0, JSON.stringify(oneTr.slice(0, 60)));
    ck('★ 而且是**只有这一句**有译文（正文里其他句还没译）', await p.locator('[data-eptr]').count() === 0,
      String(await p.locator('[data-eptr]').count()));

    await diagArt('③d 开始'); console.log('\n── ③d ★ 从生词本「📍 回到原文」定位回那一句 ──');
    await p.locator('[data-rdmode="word"]').click(); await p.waitForTimeout(1000);
    await p.locator('.lw-wd-row').filter({ hasText: WP }).first().click(); await p.waitForTimeout(800);
    ck('★ 生词详情里有「📍 回到原文」', await p.locator('#lw-wd-src').count() === 1, await txt('.lw-rd-rhd').catch(() => ''));
    await p.locator('#lw-wd-src').click(); await p.waitForTimeout(1400);
    ck('★★ 点完回到「外刊精读」模式', await p.locator('.lw-ep-body').count() === 1);
    ck('★★ 而且**正好选中它出现的那一句**（第 ' + (sIdx + 1) + ' 句）', await p.evaluate((i) => {
      const el = document.querySelector('[data-epsent="' + i + '"]');
      return !!el && el.classList.contains('on');
    }, sIdx));
    ck('★ 顺便把那句滚进了视口（不用自己找）', await p.evaluate((i) => {
      const el = document.querySelector('[data-epsent="' + i + '"]');
      const box = document.getElementById('lw-ep-body');
      if (!el || !box) return false;
      const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
      return r.bottom > b.top && r.top < b.bottom;
    }, sIdx));

    await diagArt('③e 开始'); console.log('\n── ③e ★ 「Failed to fetch」要说**人话**（用户截图里那句）──');
    /* ⚠️ 真的把接口**掐断** ✗（`route.abort()` ✓）—— 这样浏览器抛的就是
       `TypeError: Failed to fetch` ✓，和用户截图里一模一样 ✓。
       然后断言界面上**不是**这句英文原文 ✗，而是能照着做的中文 ✓。 */
    await p.route('**/api/ai/chat', (r) => r.abort());
    await p.locator('#lw-ep-trone').click();
    await p.waitForFunction(() => /连不上|失败|超时|检查/.test(document.getElementById('lw-ep-panel') ? document.getElementById('lw-ep-panel').innerText : ''), null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(800);
    const panelTxt = await txt('#lw-ep-panel');
    const shown = (panelTxt.match(/✗[^✗]{0,120}/) || [''])[0];
    console.log('    界面上的报错: ' + JSON.stringify(shown));
    ck('★★ 报错**不是**「Failed to fetch」原文', !/Failed to fetch/.test(panelTxt), shown);
    ck('★★ 而是**能照着做**的中文（提到服务重启 / 再点一次）', /连不上|重启|再点/.test(panelTxt), shown);
    ck('★ 而且说了「等一下再点一次」（不让人一脸懵）', /再点|等一下|缓/.test(panelTxt), shown);
    /* ⚠️⚠️ 必须把假 AI **装回去** ✗✗ —— `unroute(pattern)` 会把**这个 pattern 上的所有** handler
       一起删掉 ✗（包括上面那个 mock ✓）→ 后面的请求会打到**真接口** ✗ →
       「整篇翻译」全失败 ✓ → 看起来像功能坏了 ✗（实测就是这么挂的 ✓）。 */
    await p.unroute('**/api/ai/chat');
    await p.route('**/api/ai/chat', mockAi);

    await diagArt('③f 开始'); console.log('\n── ③f ★★ 左原文 / 右查词 + 🧩 句子拆解 + **不再自动翻译**（2026-10-08 新需求）──');
    /* 用户原话：
       ①「单词查询和记忆的、该原文加入加单词本的，给我放到右边，类似，
          左边原文，右边所查询和加入单词本的单词」
       ②「对句子进行拆解和分析，类似用英语语法的方式进行分析句子」
       ③「默认情况下，无需自动翻译，我点击翻译，才翻译」 */
    await p.locator('[data-epsent="0"]').click();
    await p.waitForTimeout(1200);
    ck('★★ 下半部分分成**左右两栏**',
      await p.locator('.lw-ep-col-a').count() === 1 && await p.locator('.lw-ep-col-b').count() === 1);
    ck('★★ 左边是**原文**（句子 + 操作 + 笔记）',
      await p.locator('.lw-ep-col-a #lw-ep-sent').count() === 1
      && await p.locator('.lw-ep-col-a #lw-ep-say').count() === 1
      && await p.locator('.lw-ep-col-a #lw-ep-note').count() === 1);
    ck('★★ 右边是**查词 / 加单词本**（输入框 + 词卡）',
      await p.locator('.lw-ep-col-b #lw-ep-new').count() === 1
      && await p.locator('.lw-ep-col-b #lw-ep-peek').count() === 1);
    /* ⚠️ 两栏**各自滚** ✗ —— 左栏长的时候右栏的词卡还得在视野里 ✓。
       判据只能是量：两栏的 overflowY 都必须是 auto/scroll ✓。 */
    const colOv = await p.evaluate(() => ['.lw-ep-col-a', '.lw-ep-col-b'].map((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).overflowY : '(没有)';
    }));
    ck('★★ 两栏**各自能滚**（左栏长的时候右栏词卡不被顶走）',
      colOv.every((v) => /auto|scroll/.test(v)), JSON.stringify(colOv));
    /* ⚠️⚠️ 「不自动翻译」**必须数请求** ✗✗ —— 只看界面上有没有译文是不够的 ✗：
       自动翻译失败 / 没配 AI 时界面上也没有译文 ✓ → 那这条就变成**恒真** ✗。
       （这正是本项目最忌讳的「看着通过、其实什么都没验」✗。） */
    const cAn0 = aiCalls;
    /* ⚠️ 判据**不能是「界面上有没有译文」** ✗✗ —— 上面 ③c 已经把那句译过了 ✓，
       所以切过去本来就会显示**存下来的旧译文** ✓，那不是「自动翻译跑了」✗。
       真正要守的是「**没有多存下一条译文**」✓（自动翻译一定会落盘 ✓）。 */
    const trPairs = async () => {
      const d = await store();
      const a = (d.articles || []).find((x) => x.id === artId);
      return (((a && a.tr && a.tr.pairs) || []).filter((x) => x && x.dst)).length;
    };
    const trN0 = await trPairs();
    await p.locator('[data-epsent="1"]').click();
    await p.waitForTimeout(2200);
    ck('★★ 选句子**一个模型请求都不发**（用户原话「默认情况下，无需自动翻译」）',
      aiCalls === cAn0, cAn0 + ' → ' + aiCalls);
    ck('★ 也没偷偷多存下一条译文（旧译文照常显示 ✓，但没新翻）',
      await trPairs() === trN0, trN0 + ' → ' + await trPairs());
    ck('  而且第 1 句的按钮不会误显示「翻译中…」（哨兵 0 撞下标 0 的坑）',
      !/翻译中/.test(await txt('#lw-ep-trone')), await txt('#lw-ep-trone'));
    /* 🧩 拆解：必须**手动点**才跑 ✓ */
    ck('★ 有「🧩 拆解这句」按钮', await p.locator('#lw-ep-anbtn').count() === 1, await txt('#lw-ep-anbtn'));
    ck('  拆之前没有拆解块', await p.locator('.lw-ep-an').count() === 0);
    await p.click('#lw-ep-anbtn');
    await p.waitForFunction(() => document.querySelector('.lw-ep-an'), null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(900);
    ck('★★ 点一下才打模型（就一次）', aiCalls === cAn0 + 1, cAn0 + ' → ' + aiCalls);
    ck('★★ 拆解块出来了，而且**按成分逐条列开**',
      await p.locator('.lw-ep-an .p').count() >= 3, String(await p.locator('.lw-ep-an .p').count()));
    const anTxt = await txt('.lw-ep-an');
    ck('★ 有「骨架句」', /骨架/.test(anTxt), anTxt.slice(0, 60));
    ck('★ 时态 / 为什么 / 仿写 都在', /时态/.test(anTxt) && /为什么/.test(anTxt) && /仿写/.test(anTxt));
    ck('★ 标明了「AI 生成」（不冒充语法书）', /AI 生成/.test(anTxt), anTxt.slice(0, 90));
    ck('★ 模型包了 ```json 围栏 + 废话，也剥干净了（没把围栏写进字段）',
      !/```|好的，这是/.test(anTxt), anTxt.slice(0, 90));
    /* ★ 拆解**落在文章上** ✓（和译文一个道理）→ 刷新后还在、且不再问一次模型 ✓ */
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-ep-body', { timeout: 20000 }); await p.waitForTimeout(900);
    await p.locator('[data-epsent="1"]').click(); await p.waitForTimeout(1200);
    const cAn1 = aiCalls;
    await p.waitForTimeout(1200);
    ck('★★ 刷新后拆解**还在**（存在文章上，不是内存态）', await p.locator('.lw-ep-an').count() === 1);
    ck('★ 而且**没有再问一次模型**', aiCalls === cAn1, cAn1 + ' → ' + aiCalls);
    /* ★ 换一句要**各管各的** ✓ —— 第 1 句不该显示第 2 句的拆解 ✗ */
    await p.locator('[data-epsent="0"]').click(); await p.waitForTimeout(1000);
    ck('★ 换一句不会串台（拆解是按句存的）', await p.locator('.lw-ep-an').count() === 0);

    await diagArt('④ 开始'); console.log('\n── ④ 双语对照翻译（用户原话「怎么没有双语对应翻译」）──');
    /* ⚠️ 先刷新一次 ✗ —— `EP_UI.trOn` 是**内存态** ✓，
       上面 ③c 为了「译这句」把它打开了 ✓ → 不重置的话这一节一开始就有译文行 ✗，
       「一开始没有译文行」和「点按钮展开」两条都会假失败 ✗（实测踩过 ✓）。 */
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-ep-body', { timeout: 20000 }); await p.waitForTimeout(900);
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
      /* ★ 探针自己加的生词也要按 id 删掉 ✓（不然污染用户的生词本 ✓）*/
      d.words = (d.words || []).filter((w) => w && madeWords.indexOf(w.id) < 0);
      /* 原样还原 ✓（只动自己造的那篇 ✓） */
      if (keep.epArt !== undefined) d.epArt = keep.epArt; else delete d.epArt;
      if (keep.readMode !== undefined) d.readMode = keep.readMode; else delete d.readMode;
      if (keep.epPanelH !== undefined) d.epPanelH = keep.epPanelH; else delete d.epPanelH;
      if (keep.wordSel !== undefined) d.wordSel = keep.wordSel; else delete d.wordSel;
      if (keep.epWordFilter !== undefined) d.epWordFilter = keep.epWordFilter; else delete d.epWordFilter;
      await put(d);
      const a = await store();
      console.log('\n收尾：文章 ' + before + '→' + (a.articles || []).length
        + ' · 残留探针文章 ' + (a.articles || []).filter((x) => x && (x.id === artId || String(x.title).indexOf(MARK) >= 0)).length
        + ' · 残留探针生词 ' + (a.words || []).filter((w) => w && madeWords.indexOf(w.id) >= 0).length);
    } catch (e) { console.log('\n收尾失败: ' + e.message); fails.push('收尾失败'); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
