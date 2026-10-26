#!/usr/bin/env node
/* 生词「自动补全 + 配图 + 遗忘曲线提醒」的端到端探针 ✓ ——
   打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。
   用户原话：「加入的单词，得自动解析好音标，词义和例句，以及巧记手段，等，
             最好还有对应图片场景理解，记忆的单词还需要有遗忘曲线，去制定记忆和提醒」。
   ⚠️ AI 配置存在**浏览器 localStorage** 里 ✗（探针是全新 profile ✓，读不到 ✓）→
      用 `page.route` **拦一个假 AI** ✓，整条链路（加词 → 请求 → 剥 JSON → 填字段 → 落盘）
      都能**离线**验 ✓。
   ⚠️ 配图那条也拦 ✓（**不**为了绕开真实接口 ✗，而是为了**确定性** ✗）——
      真实接口本身另外单独验一条 ✓（见 ⑤ ✓），不然百度一抽风整个探针就红 ✗。
   ⚠️ 探针会往 STORE 里加词 ✗ —— finally 里**按 id** 删掉自己加的那些 ✓。 */
'use strict';
const fs = require('fs');
/* 数据保护罩：探针会写真实数据，跑完必须还原 ✓（见 probe-guard.js） */
require('./probe-guard.js').arm();
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};
const put = async (d) => fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
/* ⚠️⚠️ 测试词**必须每次都不一样** ✗✗ —— 踩过两次，代价很大 ✓：
   第一版用固定词 ubiquitous ✓ + ⓪ 一条「它不在生词本里」的前置断言守着 ✓。
   问题出在**前置不成立时探针自己恢复不了** ✗：
   上一轮跑崩（比如被并发的探针污染了 store ✓）→ `finally` 里 `madeIds` 是空的 ✗
   → 这个词**永久留在用户生词本里** ✗ → 之后每次跑都红 ✗，而且**要人去手工清** ✗。
   （今天实测卡了两轮 ✓。）
   → 改成**带运行唯一后缀** ✓：词本身是假的没关系 ✓
     （AI 是拦下来的假 AI ✓，词串只是个标识 ✓），
     但**例句里必须真的出现它** ✓ —— 否则「例句里高亮本词」那条没法验 ✗。
   ⚠️ 后缀**只能用字母** ✗ —— `EN.cleanWord()` 会剥掉词尾的非字母字符 ✓，
      后缀带数字的话会被吃掉一部分 ✓（撞车概率变高 ✗）。 */
const TAG = Array.from({ length: 5 }, () => 'abcdefghijkmnpqrstuvwxyz'[Math.floor(Math.random() * 24)]).join('');
const WORD = 'ubiquitous' + TAG;

/* ★★ 启动清扫 ✓ —— 只认**探针自己的签名** ✗（后缀形态 + 假 AI 给的音标 ✓），
   绝不按名字乱删 ✗（万一用户真的收过 ubiquitous ✓，那是他的数据 ✓）。
   这样即使某一轮崩了 ✓，下一轮也能自己收拾干净 ✓，不会再卡住 ✓。 */
const RESIDUE_RE = /^ubiquitous[a-z]{5}$/;
const RESIDUE_PH = '/juːˈbɪk.wɪ.təs/';

/* 假 AI 的回答 ✓ —— 故意**带 ```json 围栏 + 前言** ✓，验的就是「能不能剥干净」✓。
   ⚠️ 内容必须和 WORD **自洽** ✗ —— 第一版拿的是 `individuals` 的卡 ✓ 而词是别的 ✓，
      于是「例句里把本词标出来」这条**根本没法验** ✗（句子里压根没这个词 ✗）。 */
const FAKE_JSON = {
  ph: RESIDUE_PH,
  pos: 'adj.',
  def: '无处不在的；普遍存在的',
  eg: 'Mobile phones are now ' + WORD + ' in daily life.',
  egZh: '手机如今在日常生活中无处不在。',
  mnem: 'ubique（到处）+ -ous（…的）→ 到处都在的 → 无处不在的。',
  scene: '地铁车厢里几乎每个人都低头看着手机，一眼望去全是亮着的屏幕。',
  /* ★ 词根词缀拆解 ✓ —— 用户要「全部词都要有拆解」✗ → **新加的词也得有** ✓。
     ⚠️ 这里**故意把前缀写成原形**（`ad-` 那一类 ✓）来验归一 ✓：
       模型十有八九这么答 ✓，而单词里是**同化形** ✓ —— 前端必须自己把它掰成
       词里实际出现的字母 ✓，否则「一排胶囊连起来就是这个单词」就断了 ✗。 */
  rd: {
    parts: [['词根', 'ubiquit', '到处'], ['后缀', '-ous', '…的']],
    gloss: '到处都在的 → 无处不在的',
    note: '同族：ubiquity 无处不在',
  },
};

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const snap = await store();
  const keep = { words: snap.words, wordSel: snap.wordSel, epArt: snap.epArt, readMode: snap.readMode, epWordFilter: snap.epWordFilter };
  const idsBefore = new Set((snap.words || []).map((w) => w && w.id));
  const madeIds = [];

  /* ★ 启动清扫：把**以前崩掉那一轮**留下的探针词收掉 ✓（只认签名 ✗，不按名字乱删 ✓） */
  {
    const left = (snap.words || []).filter((w) => w && RESIDUE_RE.test(String(w.w)) && String(w.ph || '') === RESIDUE_PH);
    if (left.length) {
      const d0 = await store();
      d0.words = (d0.words || []).filter((w) => !(w && RESIDUE_RE.test(String(w.w)) && String(w.ph || '') === RESIDUE_PH));
      await put(d0);
      left.forEach((w) => idsBefore.delete(w.id));
      console.log('清扫：收掉 ' + left.length + ' 个上一轮崩掉留下的探针词 ✓（' + left.map((x) => x.w).join(', ') + '）');
    }
  }

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  /* ⚠️ 「＋ 加词」**不再是原生 prompt** ✗ —— 换成页内浮层了 ✓
     （用户原话：「不要用这种网页的弹出输入去输入内容」✓）。
     它问**两次**：单词 ✓ 然后释义（可留空）✓ → 所以是「点一次 + 连填两次」✓。 */
  const dialogs = [];
  p.on('dialog', async (d) => { await d.accept(dialogs.length ? dialogs.shift() : ''); });
  const lwAskType = async (val) => {
    await p.waitForSelector('#lw-dlg-in', { timeout: 10000 });
    await p.locator('#lw-dlg-in').fill(val);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(700);
  };
  let aiCalls = 0;
  await p.route('**/api/ai/chat', async (route) => {
    aiCalls++;
    /* ⚠️ 故意包一层「废话 + 围栏」✗ —— 模型十有八九这么答 ✓，
       探针要验的正是「前端能不能把它剥成纯 JSON」✓。 */
    const content = '好的，这是你要的卡片：\n```json\n' + JSON.stringify(FAKE_JSON) + '\n```\n希望有用！';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content }) });
  });
  let imgCalls = 0;
  await p.route('**/api/life/en/wordimg*', async (route) => {
    imgCalls++;
    /* ⚠️ 用 **data: URL** 当假图 ✗ —— 第一版用了 `https://example.invalid/a.jpg` ✓，
       浏览器会真去连 ✗ → 控制台报 `ERR_CONNECTION_CLOSED` ✗ →
       「无页面异常」那条**假失败** ✗（那是探针自己的假数据造成的 ✗，不是产品问题 ✗）。 */
    const px = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const list = [px + '#a', px + '#b', px + '#c'];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, q: WORD, list }) });
  });
  await p.addInitScript(() => {
    try { localStorage.setItem('mc-ai-cfg', JSON.stringify({ url: 'https://example.invalid/v1/chat/completions', key: 'k', model: 'm' })); } catch (_) {}
  });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  const val = async (s) => { const l = p.locator(s); return (await l.count()) ? await l.first().inputValue() : '(没有)'; };
  const openWordbook = async () => {
    await p.evaluate(() => {
      const el = document.querySelector('[data-rdmode="word"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await p.waitForSelector('.lw-wd', { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(900);
  };

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 }); await p.waitForTimeout(900);
    await openWordbook();

    console.log('\n── ⓪ 前置：测试词**本次运行独有**（不会再被历史残留卡住）──');
    {
      const w0 = (await store()).words || [];
      const dup = w0.filter((x) => x && String(x.w).toLowerCase() === WORD);
      ck('★ 测试词 ' + WORD + ' 自带运行唯一后缀（不会撞上历史残留 / 用户自己的词）', dup.length === 0,
        '已存在 ' + dup.length + ' 个');
    }

    console.log('\n── ① 加一个词：应该**自动**去补全 ──');
    ck('  有「＋ 加词」按钮', await p.locator('#lw-wd-add').count() === 1);
    await p.click('#lw-wd-add');
    await lwAskType(WORD);      /* 第一步：单词 ✓ */
    await lwAskType('');        /* 第二步：释义（可留空）✓ 直接回车 ✓ */
    await p.waitForTimeout(2500);
    const st1 = await store();
    const w1 = (st1.words || []).filter((w) => w && !idsBefore.has(w.id));
    w1.forEach((w) => madeIds.push(w.id));
    console.log('    新增词卡 ' + w1.length + ' 个' + (w1[0] ? ('：' + JSON.stringify({ w: w1[0].w, ph: w1[0].ph, pos: w1[0].pos, def: w1[0].def })) : ''));
    ck('★ 词卡建出来了', w1.length === 1, JSON.stringify(w1.map((x) => x.w)));
    ck('★★ 音标**自动填上了**', !!(w1[0] && /juː|bɪk/.test(String(w1[0].ph))), w1[0] && w1[0].ph);
    ck('★★ 词性自动填上了', !!(w1[0] && w1[0].pos), w1[0] && w1[0].pos);
    ck('★★ 释义自动填上了', !!(w1[0] && /无处不在|普遍/.test(String(w1[0].def))), w1[0] && w1[0].def);
    ck('★★ 例句自动填上了', !!(w1[0] && String(w1[0].eg).length > 15), w1[0] && w1[0].eg);
    ck('★★ 例句中文自动填上了', !!(w1[0] && String(w1[0].egZh).length > 8), w1[0] && w1[0].egZh);
    ck('★★ 巧记自动填上了', !!(w1[0] && /词根|联想|谐音|ubique|拆/.test(String(w1[0].mnem))), w1[0] && w1[0].mnem);
    ck('★★ 场景自动填上了', !!(w1[0] && String(w1[0].scene).length > 10), w1[0] && w1[0].scene);
    ck('★★ 模型包了 ```json 围栏 + 废话，也剥干净了（没把围栏写进字段）',
      !!(w1[0] && !/```|好的，这是/.test(JSON.stringify(w1[0]))), w1[0] && String(w1[0].def));
    ck('  真的问了 AI（不是本地编的）', aiCalls >= 1, 'AI 调用 ' + aiCalls);

    console.log('\n── ② 配图：补完顺手配一张 ──');
    ck('★★ 自动配了图', !!(w1[0] && String(w1[0].img || '').length > 10), w1[0] && String(w1[0].img).slice(0, 40));
    ck('★ 存了一批候选（好「换一张」）', !!(w1[0] && Array.isArray(w1[0].imgs) && w1[0].imgs.length >= 3),
      w1[0] && JSON.stringify((w1[0].imgs || []).length));
    ck('  真的调了搜图接口', imgCalls >= 1, '搜图 ' + imgCalls + ' 次');

    console.log('\n── ③ 面板上看得见（★ 词典式排版，不是一张表单）──');
    await p.evaluate((id) => {
      const el = document.querySelector('[data-epword="' + id + '"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, w1[0].id);
    await p.waitForTimeout(1000);
    const panel = await txt('.lw-rd-read');
    console.log('    面板片段: ' + JSON.stringify(panel.slice(0, 130)));
    /* ⚠️⚠️ 这一节**整节重写过** ✗ —— 第一版是 `await val('#lw-wd-ph')` ✓ 挨个读输入框的值 ✓，
       而用户明确说了「这个词的详情，一般不需要我去修改，所以不用是这种输入框，
       大概设计和字典那样就行」✓ → 默认态**一个输入框都没有** ✗ →
       老断言会全红 ✗（而且是**真失败** ✓ 不是假失败 ✓：产品确实变了 ✓）。
       → 判据跟着换 ✓：**词典态看「显示出来的东西」** ✓，**编辑态才看输入框** ✓。 */
    const nIn = await p.locator('.lw-wd-detail input, .lw-wd-detail textarea').count();
    ck('★★ 默认态**没有输入框**（是词典，不是让你填的表单）', nIn === 0, '输入框 ' + nIn + ' 个');
    ck('★★ 音标显示出来了（不是输入框）', /juː|bɪk/.test(await txt('.lw-wd-sub .ph')), await txt('.lw-wd-sub .ph'));
    ck('★ 词性显示出来了', (await txt('.lw-wd-sub .pos')).length > 0, await txt('.lw-wd-sub .pos'));
    ck('★★ 释义**分条**显示（多个义项自动编号）', await p.locator('.lw-wd-defs li').count() === 2, await txt('.lw-wd-defs'));
    ck('★★ 例句显示出来了', /ubiquitous/i.test(await txt('.lw-wd-eg-en')), await txt('.lw-wd-eg-en'));
    /* ★ 学一个词最需要的就是「看它在真句子里长什么样」✓ */
    ck('★★ 例句里**把本词标出来了**（一眼看到它怎么用）', await p.locator('.lw-wd-hit').count() >= 1, await txt('.lw-wd-eg-en'));
    ck('★ 例句中文对照在', (await txt('.lw-wd-eg-zh')).length > 6, await txt('.lw-wd-eg-zh'));
    ck('★ 巧记是**高亮框**（不是输入框）', /ubique/.test(await txt('.lw-wd-tipbox.mnem')), await txt('.lw-wd-tipbox.mnem'));
    ck('★ 场景是**高亮框**', (await txt('.lw-wd-tipbox.scene')).length > 8, await txt('.lw-wd-tipbox.scene'));

    /* ══ ③a 词根词缀 ✓ ═══════════════════════════════════════════════════════
       ★ 用户原话：「帮我给单词，补充词根词缀的说明，那种，全部词都要，
         新增词根词缀说明拆解等，合理布局」✓。

       ⚠️⚠️ 这一节最核心的判据**不是「区块在不在」** ✗ —— 而是
          「**胶囊上的字母连起来就是这个单词**」✓。那正是「拆解」的全部意义 ✓：
          用户要一眼看出「哪块是前缀、哪块是词根、哪块是后缀」✓。
          只验「有 .lw-wd-rd 这个类」是**假通过** ✗ —— 类在 ✓、
          但字母拼不回原词照样能画出来 ✓（模型给的前缀原形 `ad-` vs 词里 `ac-` ✓，
           第一版就是这么错的 ✓）。 */
    console.log('\n── ③a 词根词缀：拆解胶囊连起来必须是这个词 ──');
    const rdInfo = await p.evaluate(() => {
      const sec = [...document.querySelectorAll('.lw-wd-sec')].find((x) => x.textContent.indexOf('词根词缀') >= 0);
      if (!sec) return null;
      const chips = [...sec.querySelectorAll('.lw-wd-rd .pc')];
      return {
        n: chips.length,
        parts: chips.map((c) => ({
          k: (c.querySelector('.k') || {}).textContent || '',
          s: (c.querySelector('.s') || {}).textContent || '',
          m: (c.querySelector('.m') || {}).textContent || '',
        })),
        gloss: (sec.querySelector('.lw-wd-rd .gloss') || {}).textContent || '',
        note: (sec.querySelector('.lw-wd-rd .note') || {}).textContent || '',
        base: (sec.querySelector('.lw-wd-rd .base') || {}).textContent || '',
        /* 部件的配色是不是真的按类型分了 ✓（全一个颜色 = 白做 ✓）*/
        colors: chips.map((c) => getComputedStyle(c).color),
      };
    });
    console.log('    拆解: ' + JSON.stringify(rdInfo && rdInfo.parts));
    ck('★★ 卡片上有「词根词缀」区块', !!rdInfo);
    ck('★★ 画出了部件胶囊（不是一行字符串）', !!rdInfo && rdInfo.n >= 2, rdInfo && ('胶囊 ' + rdInfo.n));
    ck('★★★ 胶囊上的字母**连起来就是这个单词**（这才是「拆解」的意义）',
      !!rdInfo && rdInfo.parts.map((x) => x.s.replace(/-/g, '')).join('') === WORD,
      rdInfo && (rdInfo.parts.map((x) => x.s.replace(/-/g, '')).join('') + ' vs ' + WORD));
    ck('★ 每个胶囊都标了类型（前缀 / 词根 / 后缀 / 词干 / 词尾）',
      !!rdInfo && rdInfo.parts.every((x) => /^(前缀|词根|后缀|词干|词尾)$/.test(x.k)),
      rdInfo && JSON.stringify(rdInfo.parts.map((x) => x.k)));
    ck('★ 连字符用法对：前缀带**尾**横、后缀/词尾带**首**横、词根/词干不带',
      !!rdInfo && rdInfo.parts.every((x) => (x.k === '前缀' ? /-$/.test(x.s)
        : (x.k === '后缀' || x.k === '词尾') ? /^-/.test(x.s)
          : !/^-|-$/.test(x.s))),
      rdInfo && JSON.stringify(rdInfo.parts.map((x) => x.k + x.s)));
    ck('★ 部件颜色按类型分开了（不是一片同色）',
      !!rdInfo && new Set(rdInfo.colors).size >= 2, rdInfo && JSON.stringify(rdInfo.colors));
    ck('★ 拼出来的意思在（「→ …」那一行）', !!rdInfo && rdInfo.gloss.length > 4, rdInfo && rdInfo.gloss);
    ck('★ 说明在（同族 / 易混 / 词源）', !!rdInfo && rdInfo.note.length > 3, rdInfo && rdInfo.note);

    /* ⚠️ 全库覆盖 ✓ —— 用户要的是「**全部词都要**」✗，
       所以加词那条路（AI 补全 ✓）也必须带上拆解 ✓，不能只有老词书那批有 ✗。 */
    {
      const all = (await store()).words || [];
      const withRd = all.filter((x) => x && x.rd && ((x.rd.parts || []).length || String(x.rd.note || '').length));
      const bad = all.filter((x) => {
        const p = (x && x.rd && x.rd.parts) || [];
        if (!p.length) return false;
        return p.map((q) => String(q[1] || '').replace(/-/g, '')).join('') !== String(x.w || '').toLowerCase();
      });
      const rate = all.length ? (withRd.length / all.length) : 0;
      console.log('    全库: ' + withRd.length + '/' + all.length + ' 有拆解（'
        + Math.round(rate * 100) + '%），其中部件拼不回原词的 ' + bad.length + ' 条');
      ck('★★ 全库**绝大多数词都有拆解**（新加的词也得有 —— 加词那条路要带上）',
        rate >= 0.95, Math.round(rate * 100) + '%');
      ck('★★ 全库**没有一条**「胶囊拼不回原词」（拼不回去就是在骗人）',
        bad.length === 0, bad.slice(0, 5).map((x) => x.w).join(', '));
    }

    /* ══ ③a2 排布 ✓ ═══════════════════════════════════════════════════════════
       ★ 用户原话：「重新合理排布，目前排布不合理」✓。

       ⚠️⚠️ 这条守的是**真实的那个 bug** ✗：上一版按「哪块放哪栏」**手写分组** ✓，
          而每个词的区块数量和长度都不一样 ✓ → 实测**左栏比右栏高 335~568px** ✗
          （右下角一大片空白 ✓，截图一眼就看出来 ✓）。
         手写分组**不可能对所有词都平衡** ✗ —— 所以改成了 CSS 多栏（自动平衡 ✓）。
       ⚠️ 判据必须是**量出来的高度差** ✗ —— 「有 .lw-wd-cols 这个类」是假通过 ✓
          （类在 ✓，两栏照样能差 500px ✓）。 */
    console.log('\n── ③a2 排布：词根词缀填进「配图左边那块空白」+ 栏数跟着卡片宽度 + 两栏不许差太多 ──');
    /* ★ 用户原话：「图片左边，有一大块空白，这是可以把词根词缀放这空白处，合理放置」✓。
       ⚠️ 那块空白是「短内容撑不满宽列」造成的 ✓ —— 例句 48 字只用 225px、
          列宽 719px ✗（实测 1920 视口）。所以判据是**几何**：词根词缀要
          **在文本列右边、配图左边、而且和文本列在同一行**（竖直有重叠 ✓）。
       ⚠️ 只验「有 .lw-wd-hero-rd 这个类」是**假通过** ✗（类在 ✓，照样可能掉到下一行 ✓）。 */
    /* ⚠️ 先量**窄卡片**下的栏数 ✓（探针默认视口 1500 → 卡片 625 ✓），
       再把视口拉宽到 1920 ✓ 量「填空白」和「两栏平衡」✓（这两条在 625 下会走另一套布局 ✓）。
       量完还原视口 ✓。 */
    const cn = await p.evaluate(() => {
      const card = document.querySelector('.lw-wd-detail');
      const cols = document.querySelector('.lw-wd-cols');
      if (!card || !cols) return null;
      return { cardW: Math.round(card.getBoundingClientRect().width), n: getComputedStyle(cols).columnCount };
    });
    console.log('    窄卡片栏数: ' + JSON.stringify(cn));
    /* ⚠️ 判断依据必须是**卡片宽度** ✗ 不是视口 ✗ —— 词表侧栏固定 419px ✓，
       1200px 的窗口卡片只有 325px ✓，硬分两栏就是每栏 150px ✓（字全挤成一列一个 ✓）。 */
    ck('★★ 栏数跟着**卡片宽度**走（窄卡片退回单栏，不硬挤成两栏）',
      !!cn && ((cn.cardW < 700 && cn.n === '1') || (cn.cardW >= 700 && cn.n === '2')), JSON.stringify(cn));

    const cn2 = await p.evaluate(() => {
      const card = document.querySelector('.lw-wd-detail');
      return card ? Math.round(card.getBoundingClientRect().width) : 0;
    });
    if (cn2 && cn2 < 700) {
      await p.setViewportSize({ width: 1920, height: 1000 });
      await p.waitForTimeout(700);
    }
    const band = await p.evaluate(() => {
      const card = document.querySelector('.lw-wd-detail');
      if (!card) return null;
      const sec = [...card.querySelectorAll('.lw-wd-sec')].find((x) => x.textContent.indexOf('词根词缀') >= 0);
      if (!sec) return null;
      const hero = card.querySelector('.lw-wd-hero');
      const a = card.querySelector('.lw-wd-hero-a');
      const im = card.querySelector('.lw-wd-hero-b');
      const cols = card.querySelector('.lw-wd-cols');
      const cb = card.getBoundingClientRect();
      const sb = sec.getBoundingClientRect();
      const ab = a ? a.getBoundingClientRect() : null;
      const ib = im ? im.getBoundingClientRect() : null;
      return {
        inHero: !!(hero && hero.contains(sec)),
        inCols: !!(cols && cols.contains(sec)),
        left: Math.round(sb.left - cb.left), right: Math.round(sb.right - cb.left),
        w: Math.round(sb.width),
        aRight: ab ? Math.round(ab.right - cb.left) : 0,
        imgLeft: ib ? Math.round(ib.left - cb.left) : 0,
        vOverlapText: ab ? Math.round(Math.min(sb.bottom, ab.bottom) - Math.max(sb.top, ab.top)) : 0,
      };
    });
    console.log('    词根词缀位置: ' + JSON.stringify(band));
    ck('★★ 词根词缀在 **hero 里**（不是挤在下面两栏里）', !!band && band.inHero && !band.inCols, JSON.stringify(band));
    ck('★★ 它夹在「释义/例句」和「配图」之间（正是那块空白的位置）',
      !!band && band.left >= band.aRight - 3 && band.right <= band.imgLeft + 3, JSON.stringify(band));
    ck('★★ 而且和释义/例句**在同一行**（竖直重叠 > 40px —— 这才叫「填进那块空白」）',
      !!band && band.vOverlapText > 40, band && ('重叠 ' + band.vOverlapText + 'px'));

    /* ⚠️ 视口已经在上面拉宽到 1920 了 ✓（卡片 ≈1045 → 真的两栏 ✓），这里直接量 ✓。 */
    const bal = await p.evaluate(() => {
      const card = document.querySelector('.lw-wd-detail');
      const cols = document.querySelector('.lw-wd-cols');
      if (!card || !cols) return null;
      if (getComputedStyle(cols).columnCount === '1') return { single: true, gap: 0 };
      const cb = card.getBoundingClientRect(); const mid = cb.width / 2;
      const secs = [...cols.querySelectorAll('.lw-wd-sec')].map((s) => {
        const r = s.getBoundingClientRect();
        return { left: r.left - cb.left, bottom: r.bottom - cb.top };
      });
      const L = secs.filter((s) => s.left < mid); const R = secs.filter((s) => s.left >= mid);
      const h = (a) => (a.length ? Math.max.apply(null, a.map((s) => s.bottom)) : 0);
      return { single: false, gap: Math.round(Math.abs(h(L) - h(R))), nL: L.length, nR: R.length };
    });
    console.log('    两栏: ' + JSON.stringify(bal));
    ck('★★ 两栏高度差 ≤ 300px（旧版手写分组是 335~568px —— 右下一大片空白）',
      !!bal && (bal.single || bal.gap <= 300), JSON.stringify(bal));
    /* 量完还原视口 ✓ —— 后面几条（配图并排等）是按 1500 的宽度定的 ✓。 */
    if (cn2 && cn2 < 700) { await p.setViewportSize({ width: 1500, height: 1000 }); await p.waitForTimeout(500); }
    ck('★ 复习区块在（遗忘曲线看得见）', /下次复习/.test(panel), panel.slice(0, 60));
    /* ⚠️ 新词阶段**三档会重合** ✗（学习步是「10 分钟 → 1 天」✓）——
       四个数字里三个一样 ✓，光看图只会觉得「这几个按钮有啥区别」✗ →
       必须补一句解释 ✓（本项目的老毛病 ✓，见 skill「两个控件结果相同」那条 ✓）。 */
    ck('★★ 新词阶段说明了「四档为什么会重合」（不是甩四个数字就完）',
      /学习步/.test(await txt('.lw-wd-pvnote')), await txt('.lw-wd-pvnote'));
    ck('★ 配图显示出来了（img 元素在）', await p.locator('.lw-wd-img').count() === 1);
    /* ⚠️ 别写死「百度图片」✗（2026-10-09）—— 图源已经不止百度了 ✓：
       云端走 Bing ✓（百度挡机房 IP ✓），本机走百度 ✓。
       断言改成「说明了来源」，来源具体是哪家由后端 src 决定 ✓。 */
    ck('★ 配图说明写清了来源', /配图 · (百度图片|Bing 图片|360 图片|网络图片)/.test(await txt('.lw-wd-imgwrap')), await txt('.lw-wd-imgwrap'));
    ck('★ 列表行里有小缩略图', await p.locator('.lw-wd-thumb').count() >= 1);
    ck('★ 有「🪄」和「🖼」两个按钮', await p.locator('#lw-wd-enrich').count() === 1 && await p.locator('#lw-wd-img').count() === 1);
    /* ⚠️⚠️ 词卡里的**水平基准线只能有一条**（16px）✗✗ ——
       踩过 ✗：`.lw-wd-sec` 自己已经有 16px 内边距 ✓，
       而 `.lw-wd-next` / `.lw-wd-hist` / `.lw-wd-ef` 是**旧版词卡**留下的 ✓
       （那时它们不在 sec 里 ✓），各自又带了 14px ✗
       → 复习区块里的文字被**双重缩进成 30px** ✗，
       比同一张卡上的释义 / 例句明显右移一截 ✗（截图一眼看出来 ✓）。
       ⚠️ 这类「差 2~14px」的错**肉眼在小图里看不准** ✗，必须**量** ✓。 */
    const gutWrap = await p.evaluate(() => {
      const root = document.querySelector('.lw-wd-detail');
      if (!root) return null;
      const base = root.getBoundingClientRect().left;
      /* ⚠️ 这里**不含 .lw-wd-imgwrap** ✗✗ —— 它现在跟释义**并排** ✓，
         落在右列 ✓（left 天然大于 16 ✓），量它等于自检自己挂 ✗。
         它的落位由下面 ③b 单独验 ✓（必须真的在**同一行**的右侧 ✓）。 */
      const sels = ['.lw-wd-defs', '.lw-wd-next', '.lw-wd-pv', '.lw-wd-pvnote', '.lw-wd-ef',
        '.lw-wd-sent', '.lw-wd-foot'];
      const out = {};
      sels.forEach((s) => {
        const el = root.querySelector(s);
        if (el) out[s] = Math.round(el.getBoundingClientRect().left - base);
      });
      /* ★ 顺带把**右栏起点**也量出来 ✓（两栏排版里，右栏那几块的 left 本来就 > 16 ✓） */
      const cols = document.querySelector('.lw-wd-cols');
      let rightCol = null;
      if (cols) {
        const kids = [...cols.children].filter((x) => x.getBoundingClientRect().width > 0);
        if (kids.length > 1) {
          rightCol = Math.round(kids[1].getBoundingClientRect().left - base);
        }
      }
      return { out, rightCol };
    });
    const gut = gutWrap && gutWrap.out;
    const rightCol = gutWrap ? gutWrap.rightCol : null;
    const gutVals = Object.keys(gut || {}).map((k) => gut[k]);
    console.log('    水平基准线: ' + JSON.stringify(gut));
    /* ⚠️⚠️ 这条原来是「**所有**区块都等于 16」✗ —— 但词卡现在是**两栏词典排版** ✓
       （`.lw-wd-cols` ✓）：左栏 释义/例句/巧记/场景 ✓，右栏 真题例句/同义反义/**复习** ✓。
       → 右栏那几块的 left **本来就**大于 16 ✓（那是列偏移，不是「双重缩进」✗）。
       判据改成：**每块要么贴左基准线(16)，要么正好落在右栏起点** ✓，
       而且**同一栏里的块必须互相对齐** ✓（这才是「双重缩进」要防的 ✓）。 */
    const lefts = Object.keys(gut || {}).filter((k) => gut[k] === 16).length;
    const colVals = new Set(gutVals.filter((v) => v !== 16));
    ck('★★ 卡里所有区块**要么贴左基准线、要么彼此对齐在同一栏**（不能有第三种缩进 —— 那才是「双重缩进」）',
      !!gut && gutVals.length >= 5 && lefts >= 2 && colVals.size <= 1,
      JSON.stringify(gut) + '（右栏栏框起点 ' + rightCol + '，栏内还有自己的 16px 内边距 ✓）');
    /* ★★ ③b 释义 + 配图**并排** ✓（用户原话：「中间这个图片，百度图片，
       放置的位置不合理，左右存在大量空白，图片两边，合理重新排布一下位置设计」✓）——
       ⚠️ 原来是**上下堆** ✗：图占一整宽 ✓，而配图**常常是竖图** ✓ →
          图只占中间一小条 ✓ → 左右各空一大片 ✗。
       ⚠️⚠️ 这条**只能量几何** ✗ —— 光验「有 .lw-wd-hero 这个类」是**假通过** ✗
          （类在 ✓ 但两个子元素照样可能上下堆 ✓，CSS 一改就悄悄回退 ✗，
          而这正是用户抱怨的那个 bug ✓）。
       → 判据三条，缺一不可 ✓：
         · 图在释义**右边** ✓（left 明显更大 ✓）
         · 两者**竖直区间真的重叠** ✓（= 同一行 ✓，不是「上下的」✗）
         · 图右边缘**贴到卡片右边** ✓（±20px 内 ✓ = 没有「左右大量空白」✗）*/
    const hero = await p.evaluate(() => {
      const root = document.querySelector('.lw-wd-detail');
      const h = root && root.querySelector('.lw-wd-hero');
      const defs = root && root.querySelector('.lw-wd-defs');
      const img = root && root.querySelector('.lw-wd-imgwrap');
      if (!root || !h || !defs || !img) return { ok: false, why: { h: !!h, defs: !!defs, img: !!img } };
      const rb = root.getBoundingClientRect();
      const hb = h.getBoundingClientRect(); const db = defs.getBoundingClientRect(); const ib = img.getBoundingClientRect();
      return {
        ok: true,
        /* ⚠️ heroLeft **恒为 0** ✗ —— .lw-wd-hero 是**通栏块** ✓（跟 .lw-wd-top 一样 ✓，
           16px 是它的内边距 ✓，不进 border-box 的 left ✓）。所以**不能拿它当基准** ✗，
           只留作排查线索 ✓；要量的是**里面释义的落点** ✓（defLeft ✓）。 */
        heroLeft: Math.round(hb.left - rb.left),
        defLeft: Math.round(db.left - rb.left),
        imgLeft: Math.round(ib.left - rb.left),
        /* 图右边缘离卡片右边缘还差多少（越小越好 ✓）*/
        imgRightGap: Math.round(rb.right - ib.right),
        /* 竖直重叠量（> 0 就是同一行 ✓）*/
        vOverlap: Math.round(Math.min(db.bottom, ib.bottom) - Math.max(db.top, ib.top)),
        imgW: Math.round(ib.width), imgH: Math.round(ib.height),
      };
    });
    console.log('    并排几何: ' + JSON.stringify(hero));
    ck('★★ 释义和配图**并排**（图在释义右边，同一行 —— 不是上下堆）',
      !!hero.ok && hero.imgLeft > hero.defLeft + 40 && hero.vOverlap > 20, JSON.stringify(hero));
    ck('★★ 图右边缘**贴住卡片右边**（不再「左右大量空白」）',
      !!hero.ok && hero.imgRightGap <= 22, hero.ok ? ('右留白 ' + hero.imgRightGap + 'px') : '没并排');
    ck('★ 图片列**有上限**（横图不会撑到半屏、把释义挤成一条）',
      !!hero.ok && hero.imgW <= 300, hero.ok ? ('图宽 ' + hero.imgW) : '没并排');
    ck('★ 并排时释义仍从 16px 基准线起（没被并排吃掉缩进）',
      !!hero.ok && hero.defLeft === 16, JSON.stringify(hero));
    /* ⚠️⚠️ 底部动作条**必须真的常驻** ✗✗ —— 注释里一直写着「常驻、不跟内容一起滚走」✓，
       实现却是**普通流** ✗ → 词卡一变高它就跟着滚出视野 ✗（本次实测才发现 ✓）。
       ⚠️ 这条**不能只验「存在」** ✗ —— 存在 ✓、能点到 ✓（Playwright 会自己滚 ✓），
          但用户得先往下翻才看得见 ✗ → 只能**量位置** ✓。 */
    /* ★★ 底部动作条必须**真的常驻** ✓（用户不用先往下翻 ✓）——
       ⚠️⚠️ 原来这条要求 `over > 1`（内容必须超高）当**前置条件** ✗ ——
          但**内容不超高时它必然在视野里** ✓，拿这个当前置条件会**误报** ✗
          （实测：`ubiquitous` 的卡片正好装得下 → over=0 → 明明没问题却报红 ✗）。
       → 改成**与内容长短无关**的判据 ✓：滚到顶 / 中 / 底，三个位置都得在可视框里 ✓。 */
    const footVis = await p.evaluate(() => {
      const box = document.querySelector('.lw-wd-detail');
      const foot = document.querySelector('.lw-wd-foot');
      if (!box || !foot) return null;
      const over = box.scrollHeight - box.clientHeight;
      const at = (st) => {
        box.scrollTop = st;
        const bb = box.getBoundingClientRect(); const fb = foot.getBoundingClientRect();
        return fb.top >= bb.top - 1 && fb.bottom <= bb.bottom + 1;
      };
      const top = at(0);
      const mid = at(Math.round(over / 2));
      const end = at(over);
      box.scrollTop = 0;
      return { over, top, mid, end };
    });
    ck('★★ 底部动作条**常驻视野**（滚到顶 / 中 / 底都在 —— 不用先往下翻）',
      !!footVis && footVis.top && footVis.mid && footVis.end, JSON.stringify(footVis));
    /* ⚠️⚠️ 词卡**自己得会滚** ✗✗ —— 父级 `.lw-rd-read` 是 `overflow:hidden` ✓，
       词卡改成词典式之后**明显变高** ✓ → 内容比可视区高时，
       底部的「🪄 补全 / 🗑 删除」**鼠标滚轮滚不到** ✗。
       ⚠️⚠️ 这条**探针自己是查不出来的** ✗✗ —— Playwright 的 click 会先
          `scrollIntoView` ✓，`overflow:hidden` 的容器**照样能被脚本滚** ✓，
          所以「探针全绿、用户够不着」✗ 完全可能 ✓（本次就是实测量出来的 ✓）。
       → 判据只能是**量**：内容超高时，最内层溢出容器的 overflowY 必须是 auto/scroll ✓。 */
    const sc = await p.evaluate(() => {
      let el = document.querySelector('#lw-wd-del');
      const chain = [];
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        chain.push({ cls: String(el.className || el.tagName).slice(0, 24), oy: cs.overflowY, over: el.scrollHeight - el.clientHeight });
        el = el.parentElement;
      }
      return { chain, over: chain.find((x) => x.over > 1) || null };
    });
    console.log('    滚动链: ' + JSON.stringify(sc.chain.slice(0, 3)));
    ck('★★ 内容超高时**最内层能滚的是词卡自己**（不是被 overflow:hidden 夹住、鼠标滚不到底）',
      !sc.over || /auto|scroll/.test(sc.over.oy), JSON.stringify(sc.over));

    console.log('\n── ③b 「✏️ 编辑」才切成输入框（★ 能力没砍，只是不挡路）──');
    ck('★ 有「✏️ 编辑」按钮', await p.locator('#lw-wd-edit').count() === 1, await txt('#lw-wd-edit'));
    ck('  默认按钮写的是「编辑」（不是「收起」）', /编辑/.test(await txt('#lw-wd-edit')), await txt('#lw-wd-edit'));
    await p.click('#lw-wd-edit'); await p.waitForTimeout(800);
    const nIn2 = await p.locator('.lw-wd-detail input, .lw-wd-detail textarea').count();
    /* ⚠️⚠️ 原来是「正好 7 个」✗ —— 但编辑态后来**扩到全部字段**了 ✓
       （音标/词性/释义/例句/例句中文/巧记/场景 + 考频/词形/短语/用法/真题例句/近义/反义/拓展/词根 ✓，
        实测 16 个 ✓）。写死 7 会**一扩字段就报红** ✗。
       → 判据改成：**至少 7 个**，且那 7 个核心 id **一个都不少** ✓（这才是这条要守的东西 ✓）。 */
    const coreIds = ['lw-wd-ph', 'lw-wd-pos', 'lw-wd-def', 'lw-wd-eg', 'lw-wd-egzh', 'lw-wd-mnem', 'lw-wd-scene'];
    const missIds = await p.evaluate((ids) => ids.filter((id) => !document.querySelector('#' + id)), coreIds);
    ck('★★ 点开后出现**编辑输入框**，7 个核心字段一个不少（音标/词性/释义/例句/例句中文/巧记/场景）',
      nIn2 >= 7 && missIds.length === 0, '输入框 ' + nIn2 + ' 个' + (missIds.length ? ' 缺 ' + missIds.join(',') : ''));
    /* ⚠️⚠️ 点「✏️ 编辑」表单必须**立刻看得见** ✗✗ ——
       第一版是把表单**插在最底下** ✓（在「复习 / 来自」下面 ✓）→
       点了**页面纹丝不动** ✗ → 用户只会觉得「按钮坏了」✗（实测截图确认 ✓）。
       → 判据：第一个输入框要落在右栏可视区**里面** ✓（不靠滚 ✓）。 */
    const ev = await p.evaluate(() => {
      const f = document.querySelector('#lw-wd-ph');
      const box = document.querySelector('.lw-rd-read');
      if (!f || !box) return null;
      const r = f.getBoundingClientRect(); const bb = box.getBoundingClientRect();
      return { top: Math.round(r.top), boxTop: Math.round(bb.top), boxBot: Math.round(bb.bottom) };
    });
    ck('★★ 点开后表单**立刻在可视区内**（不用往下滚 —— 第一版插在最底下，点了没反应）',
      !!ev && ev.top >= ev.boxTop - 2 && ev.top <= ev.boxBot, JSON.stringify(ev));
    /* ⚠️⚠️ id **一个都不能改** ✗✗ —— `epWordSave()` 和失焦绑定都是按 id 找的 ✗，
       换 id 就等于把「改完自动存」悄悄弄哑 ✗（最坑的那种：看着改了、其实没存 ✗）。 */
    ck('★★ id 一个都没改（`lw-wd-ph` 那一套还在 —— 不然自动存会哑）',
      await p.locator('#lw-wd-ph').count() === 1 && await p.locator('#lw-wd-pos').count() === 1
      && await p.locator('#lw-wd-def').count() === 1 && await p.locator('#lw-wd-eg').count() === 1
      && await p.locator('#lw-wd-egzh').count() === 1 && await p.locator('#lw-wd-mnem').count() === 1
      && await p.locator('#lw-wd-scene').count() === 1);
    ck('★ 编辑框里**预填了已有值**（不是空白让你重填）', (await val('#lw-wd-ph')).indexOf('juː') >= 0, await val('#lw-wd-ph'));
    ck('★ 按钮变成「✓ 收起」', /收起/.test(await txt('#lw-wd-edit')), await txt('#lw-wd-edit'));
    await p.click('#lw-wd-edit'); await p.waitForTimeout(800);
    ck('★ 再点一下又收回去（开关双向都好使）',
      await p.locator('.lw-wd-detail input, .lw-wd-detail textarea').count() === 0);

    console.log('\n── ④ 「换一张」只换下标、不重新搜 ──');
    const before = (await store()).words.find((x) => x.id === w1[0].id).img;
    const imgCalls0 = imgCalls;
    await p.click('#lw-wd-img'); await p.waitForTimeout(900);
    const after = (await store()).words.find((x) => x.id === w1[0].id).img;
    console.log('    图 ' + String(before).slice(-12) + ' → ' + String(after).slice(-12));
    ck('★★ 换了一张（不是同一张）', before !== after, before + ' → ' + after);
    ck('★ 换图**没有**再打一次搜图接口（用已有候选 ✓）', imgCalls === imgCalls0, imgCalls0 + ' → ' + imgCalls);

    console.log('\n── ⑤ 手改也能存（新字段一起存）──');
    /* ⚠️ 输入框**默认藏着** ✗ —— 得先点「✏️ 编辑」才摸得到 ✓（④ 换图重绘过，编辑态是关的 ✓）。 */
    if (await p.locator('#lw-wd-mnem').count() === 0) { await p.click('#lw-wd-edit'); await p.waitForTimeout(800); }
    ck('  编辑态就位（输入框摸得到了）', await p.locator('#lw-wd-mnem').count() === 1);
    /* ⚠️⚠️ **不能**连续 fill 两个框 ✗✗ —— `fill()` 会先 focus ✓，
       填第二个框时第一个框**失焦** ✓ → `epWordSave()` → `epSave()` → `render()` ✓
       → DOM 被整块换掉 ✓ → 第二个 fill 写到了**已被替换的节点**上 ✓
       → 值没了 ✓ → 假失败（2026-10-17 卡片变高之后必现 ✓）。
       → 两个框**先在 DOM 里赋值** ✓，最后统一失焦一次 ✓。
         验的还是「失焦时把**所有**字段一起存」✓，只是不跟重绘抢时序 ✓。 */
    await p.evaluate(() => {
      const a = document.querySelector('#lw-wd-mnem'); if (a) a.value = '我自己写的巧记';
      const b = document.querySelector('#lw-wd-scene'); if (b) b.value = '我自己写的场景';
    });
    /* ⚠️ 用**显式 blur** 触发保存 ✗ 不用「点另一个输入框」✓ ——
       卡片现在很高（底部还有词群导图 ✓），点另一个框会**先滚动** ✓，
       偶尔滚动和重绘撞上 ✓ → 值被冲掉 ✓ → **假失败**（2026-10-17 实测偶发 ✓）。
       `blur()` 走的是**同一个 onblur 绑定** ✓，验的还是「失焦自动存」那条路 ✓。 */
    const blurSave = async (sel) => {
      /* ⚠️⚠️ 必须 **先 focus 再 blur** ✗✗ —— `blur()` 只在**元素有焦点时**才派发
         blur 事件 ✓；直接调 `blur()` 是**空操作** ✓（不报错、也不保存 ✓）。
         第一版就漏了 focus ✓ → 存了个寂寞 ✓ → 「改完存上了」两条全红 ✓（2026-10-17 实测 ✓）。 */
      await p.evaluate((s) => {
        const el = document.querySelector(s);
        if (el) { el.focus(); el.blur(); }
      }, sel);
    };
    await blurSave('#lw-wd-mnem');
    /* ⚠️ 900 → 2200ms ✗ —— `epSave()` 是**整份 store 回写** ✓（现在 13MB ✓），
       慢的时候 900ms 还没落盘 ✓ → 读到的还是旧值 ✓ → 假失败（实测偶发 ✓）。 */
    await p.waitForTimeout(2200);
    const st5 = (await store()).words.find((x) => x.id === w1[0].id);
    ck('★ 巧记改完存上了', st5 && st5.mnem === '我自己写的巧记', st5 && st5.mnem);
    ck('★ 场景改完存上了', st5 && st5.scene === '我自己写的场景', st5 && st5.scene);
    /* ★ 词根词缀那三个框 ✓ —— 它**不走 `epWordSave()` 里那张普通字符串 map** ✗
       （是结构化的 parts + gloss + note ✓，单独解析回结构 ✓）。
       ⚠️ 所以它**必须单独验** ✗ —— 只验巧记/场景的话，这条路坏掉了也发现不了 ✓。 */
    if (await p.locator('#lw-wd-rdn').count() === 1) {
      await p.locator('#lw-wd-rdn').fill('同族：ubiquity（探针改的）');
      await blurSave('#lw-wd-rdn');
      await p.waitForTimeout(2200);
      const st5b = (await store()).words.find((x) => x.id === w1[0].id);
      ck('★★ 词根词缀的**说明**改完也存上了（它走的是单独那条解析路）',
        st5b && st5b.rd && /探针改的/.test(String(st5b.rd.note)), st5b && JSON.stringify(st5b.rd));
      ck('★★ 只改说明，**部件没被清掉**（结构没被写坏）',
        st5b && st5b.rd && (st5b.rd.parts || []).length >= 2, st5b && JSON.stringify((st5b.rd || {}).parts));
    } else {
      ck('  编辑态里有词根词缀那三个输入框', false, '找不到 #lw-wd-rdn');
    }

    /* ★ 给探针词补上 `group` / `freq` ✓ —— 它们是**词书字段** ✓，AI 补全那条路不写 ✓
       （所以探针词本来没有 ✓）。这里手动塞进去 ✓，好验「词群 / 六级考频 并进释义」那条 ✓。
       ⚠️ `group` 用**书里真实存在的组名** ✓（「偏见」✓）—— 顺带把「词群导图」那条也验了 ✓；
          用假组名的话 `STORE.wordMaps` 里没有 ✓ → 导图区块根本不渲染 ✓ → 断言空转 ✗。 */
    {
      const d0 = await store();
      const c0 = d0.words.find((x) => x.id === w1[0].id);
      if (c0) {
        c0.group = '词以群记「偏见」相关';
        c0.freq = '高频 · 六级阅读常考';
        await put(d0);
      }
    }

    console.log('\n── ⑤b 改完**刷新还在**（不是只改在内存里）──');
    /* ⚠️ 这条守着「失焦绑定那张表和 `epWordSave()` 里那张表漂移」✗✗ ——
       两张表分居两处 ✓，漏一个就是「输入框里改了、看着像存了、其实没存」✗。 */
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 }); await p.waitForTimeout(900);
    await openWordbook();
    await p.evaluate((id) => {
      const el = document.querySelector('[data-epword="' + id + '"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, w1[0].id);
    await p.waitForTimeout(1000);
    ck('★★ 刷新后巧记还在（真的落盘了）', /我自己写的巧记/.test(await txt('.lw-wd-tipbox.mnem')), await txt('.lw-wd-tipbox.mnem'));
    ck('★★ 刷新后场景还在', /我自己写的场景/.test(await txt('.lw-wd-tipbox.scene')), await txt('.lw-wd-tipbox.scene'));
    ck('  刷新后仍然是**词典态**（编辑态不跟着落盘 —— 开关是临时的）',
      await p.locator('.lw-wd-detail input, .lw-wd-detail textarea').count() === 0);
    ck('★★ 刷新后词根词缀的说明也还在（结构真的落盘了，不是只改在内存里）',
      /探针改的/.test(await txt('.lw-wd-rd .note')), await txt('.lw-wd-rd .note'));
    ck('★★ 刷新后拆解胶囊照样拼得回这个词',
      await p.evaluate((word) => {
        const chips = [...document.querySelectorAll('.lw-wd-rd .pc .s')];
        return chips.map((c) => c.textContent.replace(/-/g, '')).join('') === word;
      }, WORD));

    /* ★★ 词群 / 六级考频 **并进释义右边** ✓（用户：「直接标注在释义那边右侧空白不就行，
       本身就是简短说明，没必要放下面占用空间」✓）。
       ⚠️ 判据两条，缺一不可 ✗：
         ① 卡片里**没有**独立的「词群」「六级考频」区块 —— 不然等于没搬 ✓；
         ② 释义区里**真的有** `.lw-wd-meta`、内容对得上、而且**贴着释义区右边** ✓
            （只验「有 meta 这个类」是假通过 ✗ —— 它可能被塞在左边 ✓）。 */
    const metaInfo = await p.evaluate(() => {
      const card = document.querySelector('.lw-wd-detail');
      if (!card) return null;
      const heads = [...card.querySelectorAll('.lw-wd-sec .hd')].map((h) => h.textContent.trim());
      const sec = [...card.querySelectorAll('.lw-wd-sec')].find((s) => {
        const hd = s.querySelector('.hd');
        return hd && hd.textContent.indexOf('释义') >= 0;
      });
      const m = card.querySelector('.lw-wd-meta');
      if (!sec || !m) return { heads, hasMeta: false };
      const sb = sec.getBoundingClientRect(); const mb = m.getBoundingClientRect();
      return {
        heads, hasMeta: true, txt: m.textContent.replace(/\s+/g, ' ').trim(),
        rightGap: Math.round(sb.right - mb.right), w: Math.round(mb.width),
      };
    });
    console.log('    释义区小标签: ' + JSON.stringify(metaInfo));
    ck('★★ 卡片里**没有**独立的「词群」「六级考频」区块（搬走了，不再占下面两栏）',
      /* ⚠️ 必须排除「词群导图」✗ —— 它的标题里**也含「词群」两字** ✓，
         不排除的话这条会**假失败** ✓（2026-10-17 实测：加了导图区块之后当场红 ✓）。 */
      !!metaInfo && !metaInfo.heads.some((h) => h.indexOf('词群导图') < 0
        && (h.indexOf('词群') >= 0 || h.indexOf('考频') >= 0)),
      metaInfo && JSON.stringify(metaInfo.heads));
    ck('★★ 词群 / 考频 变成了**释义区里的小标签**（内容对得上）',
      !!metaInfo && metaInfo.hasMeta && /偏见/.test(metaInfo.txt) && /高频/.test(metaInfo.txt),
      metaInfo && metaInfo.txt);
    ck('★★ 而且**贴着释义区右边**（不是塞在左边）',
      !!metaInfo && metaInfo.hasMeta && Math.abs(metaInfo.rightGap) <= 2,
      metaInfo && ('右留白 ' + metaInfo.rightGap + 'px'));

    /* ══ ⑤c 词群导图 ✓ ═══════════════════════════════════════════════════════
       ★ 用户原话：「每个词群开头，不是都有一副思维导图吗，我需要你给我加上，
         对于每个属于该词群的单词，的最下方，需要放上该词群的导图」✓。

       ⚠️⚠️ 判据四条，缺一不可 ✗：
         ① 区块存在，而且是**最后一个**（「最下方」✓）；
         ② 图**真的加载出来了**（`naturalWidth > 0` ✓）—— 只验 `<img>` 存在是假通过 ✗
            （404 的时候 img 元素照样在 ✓，只是空白 ✓）；
         ③ 点图能**放大**（覆盖层 `.on` ✓ + z-index 够高 ✓）；
         ④ 再点一下能关 ✓。
       ⚠️ 图是 `/api/life/wordmap/<文件>` 发的 ✓ —— 文件名由 `STORE.wordMaps[组名]` 查 ✓。 */
    console.log('\n── ⑤c 词群导图：在最下方、真加载了、点得开放得大 ──');
    const mapInfo = await p.evaluate(() => {
      const card = document.querySelector('.lw-wd-detail');
      if (!card) return null;
      const secs = [...card.querySelectorAll('.lw-wd-sec')];
      const sec = secs.find((s) => {
        const hd = s.querySelector('.hd');
        return hd && hd.textContent.indexOf('词群导图') >= 0;
      });
      const img = document.querySelector('#lw-wd-mapimg');
      if (!sec || !img) return { hasSec: !!sec, hasImg: !!img, isLast: false };
      return {
        hasSec: true, hasImg: true, isLast: secs[secs.length - 1] === sec,
        natural: img.naturalWidth, natH: img.naturalHeight,
        complete: img.complete,
        src: String(img.getAttribute('src') || ''),
        w: Math.round(img.getBoundingClientRect().width),
      };
    });
    console.log('    导图: ' + JSON.stringify(mapInfo));
    ck('★★ 词卡里有「词群导图」区块，而且排在**最后**（用户要的「最下方」）',
      !!mapInfo && mapInfo.hasSec && mapInfo.isLast, JSON.stringify(mapInfo));
    ck('★★★ 图**真的加载出来了**（只验 img 存在是假通过 —— 404 时元素也在）',
      !!mapInfo && mapInfo.hasImg && mapInfo.natural > 200 && mapInfo.complete,
      mapInfo && (mapInfo.natural + '×' + mapInfo.natH));
    /* ⚠️ 允许带 `?v=N` ✗ —— 导图重出之后文件名不变 ✓，靠版本号让浏览器别用旧缓存 ✓。 */
    ck('★ 走的是导图路由（`/api/life/wordmap/`，可带 ?v=N）',
      !!mapInfo && /^\/api\/life\/wordmap\/g[0-9a-f]{12}\.jpg(\?v=\d+)?$/.test(mapInfo.src),
      mapInfo && mapInfo.src);
    ck('★ 图按卡片宽度铺开（不是缩成一小块）', !!mapInfo && mapInfo.w > 400, mapInfo && ('显示宽 ' + mapInfo.w));
    await p.click('#lw-wd-mapimg');
    await p.waitForTimeout(500);
    const zOn = await p.evaluate(() => {
      const o = document.getElementById('lw-map-zoom');
      if (!o) return null;
      return { on: o.classList.contains('on'), hasImg: !!o.querySelector('img'),
        z: Number(getComputedStyle(o).zIndex) };
    });
    ck('★★ 点图能**放大**（覆盖层打开，而且 z-index 盖过面板 8800）',
      !!zOn && zOn.on && zOn.hasImg && zOn.z > 8800, JSON.stringify(zOn));
    await p.click('#lw-map-zoom');
    await p.waitForTimeout(350);
    const zOff = await p.evaluate(() => {
      const o = document.getElementById('lw-map-zoom');
      return o ? o.classList.contains('on') : null;
    });
    ck('★ 再点一下关得掉（不是只能刷新页面）', zOff === false, String(zOff));

    /* ══ ⑤d 标记：四种，各自切换 ✓ ═════════════════════════════════════════
       ★ 用户原话：「左侧我的标记，多增加几个」✓。
       ⚠️ 原来只有**一个按钮三态循环** ✓（未标 → 不熟悉 → 完全不记得 ✓）——
          加到四种就变成五态循环 ✗，点一下要转半圈才知道到哪 ✓
          ⇒ 改成**四个独立按钮、各自切换** ✓。
       ⚠️ 判据必须是「**点一下变它、再点一下取消**」✗ ——
          只验「按钮在」是假通过 ✓（四个都在、点了没反应照样过 ✓）。 */
    console.log('\n── ⑤d 标记：四种，各自切换（不是循环）──');
    const markKeys = await p.evaluate(() => [...document.querySelectorAll('#lw-wd-marks button[data-mark]')]
      .map((b) => b.getAttribute('data-mark')));
    ck('★★ 卡片上有**四种**标记按钮', JSON.stringify(markKeys) === JSON.stringify(['fuzzy', 'blank', 'confuse', 'trap']),
      JSON.stringify(markKeys));
    const leftMarkN = await p.evaluate(() => [...document.querySelectorAll('.lw-rd-row')]
      .filter((x) => /不熟悉|完全不记得|易混淆|高频易错/.test(x.textContent)).length);
    ck('★★ 左侧「我的标记」也列出**四条**', leftMarkN === 4, '条数 ' + leftMarkN);
    for (const k of ['confuse', 'trap', 'fuzzy', 'blank']) {
      await p.click('#lw-wd-marks button[data-mark="' + k + '"]');
      await p.waitForTimeout(1500);
      const on = (await store()).words.find((x) => x.id === w1[0].id);
      ck('  ★ 点「' + k + '」→ 存成 ' + k, !!on && on.mark === k, on && on.mark);
      await p.click('#lw-wd-marks button[data-mark="' + k + '"]');
      await p.waitForTimeout(1500);
      const off = (await store()).words.find((x) => x.id === w1[0].id);
      ck('  ★ 再点同一个 → **取消**（不是循环到下一个）', !!off && !off.mark, off && off.mark);
    }

    console.log('\n── ⑥ 遗忘曲线提醒 ──');
    /* 造一个**已到期**的词 ✓（due 设成过去 ✓） */
    const d6 = await store();
    const card = d6.words.find((x) => x.id === w1[0].id);
    card.due = Date.now() - 3600 * 1000; card.ivl = 1;
    await put(d6);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    /* ⚠️⚠️ 提醒只在**进阅读页**时弹 ✗✗ —— 探针第一版忘了点这一下 ✓，
       于是「角标」查到了（角标在任何页签都在 ✓）、
       但「提醒」没弹 ✗ → 假失败 ✗（实测踩过 ✓）。
       而且紧接着切页签那一步它反而弹了 ✓，两条断言正好反着挂 ✓，很误导 ✗。 */
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForTimeout(1800);
    const badge = await p.evaluate(() => {
      const b = document.querySelector('.lw-nav button[data-tab="reading"] .badge');
      return b ? { txt: b.textContent.trim(), hot: b.classList.contains('hot') } : null;
    });
    console.log('    「阅读」角标: ' + JSON.stringify(badge));
    ck('★★ 左栏「阅读」角标显示**该复习的数量**（不是那个没用的 R-01）', !!badge && /^\d+$/.test(badge.txt), JSON.stringify(badge));
    ck('★★ 而且角标是**高亮**的（一眼看出有事要做）', !!badge && badge.hot === true, JSON.stringify(badge));
    const toast = await txt('#lw-sub');
    console.log('    状态栏: ' + JSON.stringify(toast.slice(0, 80)));
    ck('★★ 进页面**主动提醒**了一句', /该复习了/.test(toast), toast.slice(0, 80));
    /* ⚠️ 冷却要这么验 ✗✗：先**等提示自己过期**（`rdToast` = 5 秒 ✓），
       再切走切回来 ✓，然后看它有没有**重新冒出来** ✓。
       第一版是「切回来立刻看」✗ —— 那时上一条还没过期 ✓，
       于是**看到的是同一条**✗ → 假失败 ✗（实测踩过 ✓）。
       ⚠️ 关键区别：「还显示着」≠「又弹了一次」✗ —— 要验的是后者 ✓。 */
    console.log('    等提示自己过期（5 秒）…');
    await p.waitForTimeout(5600);
    const gone = !/该复习了/.test(await txt('#lw-sub'));
    ck('  提示 5 秒后自己消失了（前置条件成立）', gone, (await txt('#lw-sub')).slice(0, 60));
    await p.locator('.lw-nav [data-tab="memo"]').dispatchEvent('click'); await p.waitForTimeout(700);
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click'); await p.waitForTimeout(1200);
    ck('★ 再进阅读页**不重复弹**（30 分钟冷却 ✓）', !/该复习了/.test(await txt('#lw-sub')), (await txt('#lw-sub')).slice(0, 60));

    console.log('\n── ⑦ 真实搜图接口（这一条打**真网** ✓，单独验一次）──');
    try {
      const r = await fetch(BASE + '/api/life/en/wordimg?q=' + encodeURIComponent('apple') + '&n=4', { signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      ck('★ 真实搜图接口通（apple）', !!(d && d.ok && d.list && d.list.length), JSON.stringify(d).slice(0, 120));
    } catch (e) { ck('★ 真实搜图接口通（apple）', false, e.message); }

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      const before = (d.words || []).length;
      /* 只留「不是我造的」✓（按 id 删 ✗ —— 不能按名字 ✗：用户可能自己也有同一个词 ✗） */
      d.words = (d.words || []).filter((w) => w && madeIds.indexOf(w.id) < 0);
      ['wordSel', 'epArt', 'readMode', 'epWordFilter'].forEach((k) => { if (keep[k] === undefined) delete d[k]; else d[k] = keep[k]; });
      await put(d);
      const a = await store();
      console.log('\n收尾：生词 ' + before + '→' + (a.words || []).length
        + ' · 残留探针词 ' + (a.words || []).filter((x) => x && madeIds.indexOf(x.id) >= 0).length);
    } catch (e) { console.log('\n收尾失败: ' + e.message); fails.push('收尾失败'); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
