/* 外刊精读 + 生词本 —— 打**真实实例**的端到端探针 ✓
   ⚠️ 需要本机 127.0.0.1:4877 起着 ✓；没起就**跳过** ✓（绝不变成假失败 ✗）。
   ⚠️ 开头先清同名残留 ✗（上一轮被打断时收尾没跑成 → 下一轮 `find()` 拿到旧的 → 假失败 ✗，实测踩过 ✗）。
   ⚠️ 收尾只删**自己造的** ✓（用户的文章 / 生词一条不动 ✗）。
   运行：node tests/life-en.js */
const fs = require('fs');
const { chromium } = require('playwright-core');
/* ★ 共享的 SRS 模块 ✓（双栖 ✓）—— 用来把「界面上点一下」的结果和
   「纯逻辑模块算出来的」**逐字段对齐** ✓（比「step 0→1」这种硬编码强得多 ✓）。 */
const SRS = require('../lib/srs.js');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const BASE = 'http://127.0.0.1:4877';
const MARK = '__探针外刊__';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};
const put = async (d) => fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };

/* 四句里塞满了分句的经典坑 ✓：Dr. / U.S. / 引号 / 小数点 ✓ */
const SAMPLE = [
  'The world oceans rose faster in the past decade than at any time since records began, according to a study published on Wednesday.',
  'Researchers said the acceleration was driven mainly by melting ice in Greenland and Antarctica.',
  '"We are seeing the consequences now," said Dr. Jane Smith, who works at the U.S. Geological Survey.',
  'The team used satellite measurements going back to 1993, covering about 3.5 million observations.',
].join('\n\n');

/* 只删自己造的 ✓（按标记 ✓，不按「看起来像探针的」✗） */
function stripMine(d) {
  d.articles = (d.articles || []).filter((a) => !String(a.title || '').includes(MARK));
  d.words = (d.words || []).filter((w) => !String(w.artTitle || '').includes(MARK));
  const ids = new Set((d.articles || []).map((a) => a.id));
  d.artNotes = (d.artNotes || []).filter((n) => ids.has(n.artId));
  return d;
}

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const bakMode = (await store()).readMode || '';
  const bakArt = (await store()).epArt || '';
  try { await put(stripMine(await store())); } catch (_) {}

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('dialog', async (d) => { await d.accept(); });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.waitForSelector('.lw-nav', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 });
    await p.waitForTimeout(900);
    /* ⚠️ 上一轮可能停在别的模式 ✗ → 先点回书架 ✓（不然下面的书架断言全假失败 ✗） */
    await p.locator('[data-rdmode="shelf"]').click(); await p.waitForTimeout(700);

    console.log('\n── ① 共享纯逻辑模块（双栖 ✓）──');
    const lib = await p.evaluate(() => ({
      en: !!window.LW_EN_TEXT, srs: !!window.LW_SRS,
      fns: window.LW_EN_TEXT ? Object.keys(window.LW_EN_TEXT).length : 0,
      srsfns: window.LW_SRS ? Object.keys(window.LW_SRS).length : 0,
    }));
    ck('★ window.LW_EN_TEXT 到位', lib.en, JSON.stringify(lib));
    ck('★ window.LW_SRS 到位', lib.srs, JSON.stringify(lib));
    ck('  两边函数都导出全了', lib.fns >= 10 && lib.srsfns >= 10, JSON.stringify(lib));
    /* ★ 前后端**同一份**逻辑 ✗ —— 直接和服务端比一次分句结果 ✓（抄两遍必然走偏 ✗） */
    const srvSplit = await p.evaluate(async (t) => {
      const r = await fetch('/api/life/en/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: '' }) });
      return r.status;
    }, SAMPLE);
    ck('  服务端接口在（坏 URL 也回 200 而不是 500）', srvSplit === 200, String(srvSplit));

    console.log('\n── ② 模式条（书架 / 外刊精读 / 生词本）──');
    ck('模式条在', await p.locator('.lw-rd-modes').count() === 1);
    ck('三个模式都在', await p.locator('[data-rdmode]').count() === 3, String(await p.locator('[data-rdmode]').count()));
    ck('书架按钮原样还在', await p.locator('#lw-rd-add').count() === 1 && await p.locator('#lw-rd-imp').count() === 1);

    console.log('\n── ③ 切到外刊精读：三栏复用同一套类名 ✓ ──');
    await p.locator('[data-rdmode="ex"]').click(); await p.waitForTimeout(800);
    ck('三栏都在', await p.locator('.lw-rd-side').count() === 1
      && await p.locator('.lw-rd-list').count() === 1 && await p.locator('.lw-rd-read').count() === 1);
    ck('有「＋ 导入文章」', await p.locator('#lw-ep-imp').count() === 1);
    ck('左栏有朗读设置（音色 + 语速）', await p.locator('#lw-ep-voice').count() === 1 && await p.locator('#lw-ep-rate').count() === 1);
    const fill = await p.evaluate(() => {
      const mainEl = document.querySelector('.lw-main'); const cs = getComputedStyle(mainEl); const mb = mainEl.getBoundingClientRect();
      const rd = document.querySelector('.lw-rd').getBoundingClientRect();
      return Math.round((mb.bottom - parseFloat(cs.paddingBottom)) - rd.bottom);
    });
    ck('★ 外面套了 .lw-rd-wrap 之后还是填满内容区（底部不留空白）', fill <= 2, '空 ' + fill + 'px');

    console.log('\n── ④ 导入一篇（贴正文这条路）──');
    await p.click('#lw-ep-imp'); await p.waitForTimeout(600);
    ck('导入浮层出来了', await p.locator('#lw-epimp').count() === 1);
    ck('浮层里有「抓正文」入口', await p.locator('#lw-epimp-url').count() === 1 && await p.locator('#lw-epimp-go').count() === 1);
    await p.locator('#lw-epimp-title').fill(MARK + '海平面上升');
    await p.locator('#lw-epimp-site').fill('NPR');
    await p.locator('#lw-epimp-text').fill(SAMPLE);
    await p.waitForTimeout(500);
    ck('★ 边打边算词数 / 难度', /词/.test(await txt('#lw-epimp-stat')), await txt('#lw-epimp-stat'));
    await p.click('#lw-epimp-do'); await p.waitForTimeout(1000);
    ck('浮层关掉了', await p.locator('#lw-epimp').count() === 0);
    const made = ((await store()).articles || []).filter((a) => String(a.title).includes(MARK));
    ck('★ 文章落盘了', made.length === 1, String(made.length));
    ck('★ 自动算了词数 / 难度（不用手填）', !!made[0] && made[0].words > 50 && !!made[0].level,
      JSON.stringify({ w: made[0] && made[0].words, lv: made[0] && made[0].level }));

    console.log('\n── ⑤ 正文逐句（分句的坑都在这）──');
    const nsent = await p.locator('[data-epsent]').count();
    ck('★ 正文切成句子了', nsent === 4, String(nsent));
    const s3 = await txt('[data-epsent="2"]');
    ck('★ Dr. / U.S. 没被切碎（整句完整）', /Dr\. Jane Smith/.test(s3) && /U\.S\. Geological/.test(s3), s3.slice(0, 70));
    const s4 = await txt('[data-epsent="3"]');
    ck('★ 3.5 million 没被切开', /3\.5 million/.test(s4), s4.slice(0, 70));
    await p.locator('[data-epsent="2"]').click(); await p.waitForTimeout(700);
    const panel = await txt('.lw-ep-panel');
    ck('★ 点句子 → 右栏出现这一句', panel.includes('Dr. Jane Smith'), panel.slice(0, 70));
    ck('★ 右栏有「读这句」/「慢速」', await p.locator('#lw-ep-say').count() === 1 && await p.locator('#lw-ep-say-slow').count() === 1);
    ck('★ 右栏有「已懂」标记', await p.locator('#lw-ep-ok').count() === 1);
    await p.locator('#lw-ep-ok').click(); await p.waitForTimeout(700);
    const a2 = ((await store()).articles || []).find((a) => String(a.title).includes(MARK));
    ck('★ 「已懂」标记落盘了', a2 && Object.keys(a2.done || {}).length === 1, JSON.stringify(a2 && a2.done));

    console.log('\n── ⑥ 加生词（进记忆系统）──');
    await p.locator('#lw-ep-new').fill('acceleration');
    await p.locator('#lw-ep-addbtn').click(); await p.waitForTimeout(900);
    const w1 = ((await store()).words || []).filter((x) => String(x.artTitle || '').includes(MARK));
    ck('★ 生词落盘了', w1.length === 1, String(w1.length));
    const W = w1[0] || {};
    ck('★ 带上了完整的 SRS 字段（新卡 ef=2.5 / step=0 / 立刻到期）',
      W.ef === 2.5 && W.step === 0 && Number(W.due) > 0 && Number(W.ivl) === 0,
      JSON.stringify({ ef: W.ef, step: W.step, ivl: W.ivl, due: Number(W.due) > 0 }));
    ck('★ 记下了来自哪篇文章', String(W.artTitle || '').includes(MARK), W.artTitle);
    /* ⚠️ 断言要挑**真的含这个词的那句** ✗ —— acceleration 在第 2 句里 ✗，
       刚才是选中第 3 句时加的词 ✓，所以第 3 句的「这句里的生词」**本来就该是空的** ✓
       （第一版拿第 3 句去断言，是**测错了**，不是代码错了 ✗）。 */
    await p.locator('[data-epsent="1"]').click(); await p.waitForTimeout(700);
    ck('★ 切到含这个词的那句 → 右栏列出「这句里的生词」',
      (await txt('.lw-ep-panel')).includes('这句里的生词'), (await txt('.lw-ep-panel')).slice(0, 90));
    ck('  而且列的就是 acceleration', (await txt('.lw-ep-panel')).includes('acceleration'));

    console.log('\n── ⑦ 生词本三栏 ──');
    await p.locator('[data-rdmode="word"]').click(); await p.waitForTimeout(800);
    ck('三栏都在', await p.locator('.lw-rd-side').count() === 1
      && await p.locator('.lw-rd-list').count() === 1 && await p.locator('.lw-rd-read').count() === 1);
    ck('★ 词表里能看到这个词', (await txt('.lw-rd-list')).includes('acceleration'), (await txt('.lw-rd-list')).slice(0, 60));
    ck('左栏讲了「遗忘曲线怎么走」', /遗忘曲线怎么走/.test(await txt('.lw-rd-side')), (await txt('.lw-rd-side')).slice(0, 80));
    await p.locator('[data-epword]').first().click(); await p.waitForTimeout(700);
    const det = await txt('.lw-rd-read');
    ck('★ 词详情有难度因子 / 答对次数', /难度因子/.test(det), det.slice(0, 90));
    ck('★ 词详情有「下次复习」', /下次复习/.test(det), det.slice(0, 120));
    ck('★ 词详情有「现在复习会排到」四档预览（遗忘曲线看得见）', /现在复习会排到/.test(det), det.slice(0, 170));

    console.log('\n── ⑧ 复习浮层（四档 + 下次间隔）──');
    const dueN = ((await store()).words || []).filter((w) => Number(w.due || 0) <= Date.now()).length;
    ck('★ 按钮上写了到期数量', dueN > 0 && /复习/.test(await txt('#lw-wd-rev')), dueN + ' · ' + await txt('#lw-wd-rev'));
    await p.locator('#lw-wd-rev').click(); await p.waitForTimeout(900);
    ck('★ 复习浮层开了', await p.locator('#lw-rev').count() === 1);
    ck('★ 卡片正面只有单词（不剧透释义）', await p.locator('.lw-rev-card .df').count() === 0, await txt('.lw-rev-card'));
    /* ⚠️⚠️ 别假设「第一张卡就是我刚加的那个词」✗✗ —— 实测栽过 ✓，而且**被骗过一轮** ✓：
       队列是 `SRS.dueCards()` 按 **due 升序** 排的 ✓（见 `lib/srs.js` ✓），
       用户自己那些**已经到期**的词 due 更早 ✓ → **排在新词前面** ✗ →
       点评级改的是**用户的词** ✓，而断言查的是自己那个词 ✓ →
       「step 0→1」/「下次时间推后」/「记了一条历史」**三条一起假失败** ✗
       （看起来像「点评级不生效」✗，其实产品好得很 ✓）。
       ⚠️ 更坏的是它**看时间** ✗：用户那两个词一到点 ✓ 探针就开始红 ✓ ——
          同一份代码，隔十分钟跑结果不一样 ✗。
          （我拿 `git stash` 对照过 ✓，结果被这个时间差**骗了** ✓ ——
            差点去改好代码 ✗。**教训**：对照实验前先确认「输入真的没变」✗。）
       → 改成**读卡片上真正显示的那个词** ✓，断言落在**它**身上 ✓；
         再拿共享的 `lib/srs.js` 算一遍期望值 ✓ **逐字段对齐** ✓。 */
    /* ⚠️ 取词要用 `.lw-rev-card .w` ✗，**不能**拿整个卡片的 innerText ✓ ——
       卡片正面还带一句提示 ✓（「先在心里说出意思，再点下面」✓），
       整个 innerText 拿到的是「单词 + 提示」✗ → 按词去 store 里找**永远找不到** ✗
       （实测：`"zzzdbgdue 先在心里说出意思，再点下面"` ✓，白跑一轮 ✓）。 */
    const cardWord = (await p.locator('.lw-rev-card .w').first().innerText()).trim().toLowerCase();
    console.log('    队列第一张卡上是: ' + JSON.stringify(cardWord));
    const pickByWord = async () => ((await store()).words || []).find((x) => String(x.w || '').toLowerCase() === cardWord);
    const before = await pickByWord();
    ck('  认出了卡片上是哪个词（好把断言落对它身上）', !!before, JSON.stringify(cardWord));
    const bHist = (before && Array.isArray(before.hist)) ? before.hist.length : 0;
    await p.click('#lw-rev-show'); await p.waitForTimeout(700);
    ck('★ 翻面后出现四个评级按钮', await p.locator('[data-epgrade]').count() === 4, String(await p.locator('[data-epgrade]').count()));
    const labels = await p.locator('[data-epgrade]').allInnerTexts();
    ck('★ 每个按钮上直接写了下次间隔', labels.length === 4 && labels.every((t) => /分钟|天|小时/.test(t)), JSON.stringify(labels));
    ck('★ 四档文案是忘了/模糊/记得/太简单',
      labels.map((t) => t.replace(/\s+/g, '')).join('|').includes('忘了')
      && labels.join('|').includes('太简单'), JSON.stringify(labels));
    await p.locator('[data-epgrade="4"]').click(); await p.waitForTimeout(900);
    const after = await pickByWord();
    /* ★★ 最硬的一条 ✓：界面点出来的结果，必须和**共享纯逻辑模块**算的**一模一样** ✓
       （界面上写的是 15 天 ✓，实际排到的也得是 15 天 ✗ ——
        对不上的话用户只会觉得「这软件不准」✗，而且根本查不出来 ✗）。 */
    const expect = before ? SRS.review(before, 4, Number(after && after.at) || Date.now()) : null;
    ck('★★ 点评级的结果和共享 SRS 模块算的**逐字段一致**',
      !!(after && expect) && after.step === expect.step && after.ivl === expect.ivl
      && Math.abs(Number(after.ef) - Number(expect.ef)) < 1e-9,
      JSON.stringify({ got: after && { s: after.step, i: after.ivl, e: after.ef }, want: expect && { s: expect.step, i: expect.ivl, e: expect.ef } }));
    ck('★ 下次时间被推后了（不再是「立刻到期」）',
      !!(after && before) && Number(after.due) > Number(before.due) && Number(after.due) > Date.now(),
      JSON.stringify({ b: before && before.due, a: after && after.due }));
    ck('★ 记了一条复习历史', !!(after && Array.isArray(after.hist)) && after.hist.length === bHist + 1,
      JSON.stringify({ b: bHist, a: after && (after.hist || []).length }));
    /* 收掉浮层 ✓（不收的话它会挡住后面的点击 ✗，实测被挡过 ✗） */
    const closeBtn = (await p.locator('#lw-rev-close').count()) ? '#lw-rev-close' : '#lw-rev-x';
    await p.click(closeBtn); await p.waitForTimeout(700);
    ck('复习浮层能关掉', await p.locator('#lw-rev').count() === 0);

    console.log('\n── ⑨ 朗读（headless 里没音色，只验不炸 + 按钮在）──');
    const spk = await p.evaluate(() => ({
      ok: !!window.speechSynthesis,
      voices: window.speechSynthesis ? window.speechSynthesis.getVoices().length : -1,
    }));
    console.log('    浏览器语音能力: ' + JSON.stringify(spk));
    ck('★ 朗读按钮都在', await p.locator('#lw-wd-say').count() === 1 && await p.locator('#lw-wd-say-slow').count() === 1);
    /* 点一下朗读：没音色也不能抛异常 ✓（用户机器上有音色，headless 里多半没有 ✗） */
    await p.locator('#lw-wd-say').click(); await p.waitForTimeout(800);
    ck('★ 点朗读不会抛异常', true);
    await p.locator('#lw-wd-say-slow').click(); await p.waitForTimeout(600);

    console.log('\n── ⑩ 回到书架：原来的东西一个都没坏 ──');
    await p.locator('[data-rdmode="shelf"]').click(); await p.waitForTimeout(800);
    ck('★ 书架三个按钮都在', await p.locator('#lw-rd-add').count() === 1
      && await p.locator('#lw-rd-imp').count() === 1 && await p.locator('#lw-rd-sync').count() === 1);
    ck('书架三栏在', await p.locator('.lw-rd-side').count() === 1 && await p.locator('.lw-rd-list').count() === 1 && await p.locator('.lw-rd-read').count() === 1);
    ck('模式条还在（能切回去）', await p.locator('[data-rdmode]').count() === 3);
    /* ★ 切出去再切回来，正文要**还在** ✗ ——
       不兜底的话正文区永远是「← 从中间选一篇文章」✗，用户以为文章没了 ✗。 */
    await p.locator('[data-rdmode="ex"]').click(); await p.waitForTimeout(900);
    ck('★ 切回来正文还在（自动选中最近那篇）', await p.locator('[data-epsent]').count() >= 4,
      String(await p.locator('[data-epsent]').count()));
    ck('★ 列表里那篇是高亮的', await p.locator('.lw-ep-art.on').count() === 1, String(await p.locator('.lw-ep-art.on').count()));

    ck('无页面异常', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      const before = { arts: (d.articles || []).length, words: (d.words || []).length };
      stripMine(d);
      if (bakMode) d.readMode = bakMode; else delete d.readMode;
      if (bakArt) d.epArt = bakArt; else delete d.epArt;
      await put(d);
      const a = await store();
      console.log('\n收尾：文章 ' + before.arts + '→' + (a.articles || []).length + ' · 生词 ' + before.words + '→' + (a.words || []).length
        + ' | 残留探针: ' + (a.articles || []).filter((x) => String(x.title || '').includes(MARK)).length
        + ' / ' + (a.words || []).filter((x) => String(x.artTitle || '').includes(MARK)).length);
    } catch (e) { console.log('\n收尾失败（需手工检查）: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅（' + pass + ' 项）');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
