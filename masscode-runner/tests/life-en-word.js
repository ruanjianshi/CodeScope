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
    ck('★ 复习区块在（遗忘曲线看得见）', /下次复习/.test(panel), panel.slice(0, 60));
    /* ⚠️ 新词阶段**三档会重合** ✗（学习步是「10 分钟 → 1 天」✓）——
       四个数字里三个一样 ✓，光看图只会觉得「这几个按钮有啥区别」✗ →
       必须补一句解释 ✓（本项目的老毛病 ✓，见 skill「两个控件结果相同」那条 ✓）。 */
    ck('★★ 新词阶段说明了「四档为什么会重合」（不是甩四个数字就完）',
      /学习步/.test(await txt('.lw-wd-pvnote')), await txt('.lw-wd-pvnote'));
    ck('★ 配图显示出来了（img 元素在）', await p.locator('.lw-wd-img').count() === 1);
    ck('★ 配图说明写清了来源', /百度图片/.test(await txt('.lw-wd-imgwrap')), await txt('.lw-wd-imgwrap'));
    ck('★ 列表行里有小缩略图', await p.locator('.lw-wd-thumb').count() >= 1);
    ck('★ 有「🪄」和「🖼」两个按钮', await p.locator('#lw-wd-enrich').count() === 1 && await p.locator('#lw-wd-img').count() === 1);
    /* ⚠️⚠️ 词卡里的**水平基准线只能有一条**（16px）✗✗ ——
       踩过 ✗：`.lw-wd-sec` 自己已经有 16px 内边距 ✓，
       而 `.lw-wd-next` / `.lw-wd-hist` / `.lw-wd-ef` 是**旧版词卡**留下的 ✓
       （那时它们不在 sec 里 ✓），各自又带了 14px ✗
       → 复习区块里的文字被**双重缩进成 30px** ✗，
       比同一张卡上的释义 / 例句明显右移一截 ✗（截图一眼看出来 ✓）。
       ⚠️ 这类「差 2~14px」的错**肉眼在小图里看不准** ✗，必须**量** ✓。 */
    const gut = await p.evaluate(() => {
      const root = document.querySelector('.lw-wd-detail');
      if (!root) return null;
      const base = root.getBoundingClientRect().left;
      /* ⚠️ 不含 .lw-wd-top ✗ —— 它是**通栏块** ✓（自带 16px 内边距 + 底边通栏 ✓），
         量它的左边缘恒等于 0 ✓，放进来自检会自己挂 ✗。 */
      const sels = ['.lw-wd-defs', '.lw-wd-next', '.lw-wd-pv', '.lw-wd-pvnote', '.lw-wd-ef',
        '.lw-wd-imgwrap', '.lw-wd-sent', '.lw-wd-foot'];
      const out = {};
      sels.forEach((s) => {
        const el = root.querySelector(s);
        if (el) out[s] = Math.round(el.getBoundingClientRect().left - base);
      });
      return out;
    });
    const gutVals = Object.keys(gut || {}).map((k) => gut[k]);
    console.log('    水平基准线: ' + JSON.stringify(gut));
    ck('★★ 卡里所有区块**左边对齐同一条线**（不能有的 16 有的 30 —— 复习区块被双重缩进过）',
      !!gut && gutVals.length >= 5 && new Set(gutVals).size === 1 && gutVals[0] === 16, JSON.stringify(gut));
    /* ⚠️⚠️ 底部动作条**必须真的常驻** ✗✗ —— 注释里一直写着「常驻、不跟内容一起滚走」✓，
       实现却是**普通流** ✗ → 词卡一变高它就跟着滚出视野 ✗（本次实测才发现 ✓）。
       ⚠️ 这条**不能只验「存在」** ✗ —— 存在 ✓、能点到 ✓（Playwright 会自己滚 ✓），
          但用户得先往下翻才看得见 ✗ → 只能**量位置** ✓。 */
    const footVis = await p.evaluate(() => {
      const box = document.querySelector('.lw-wd-detail');
      const foot = document.querySelector('.lw-wd-foot');
      if (!box || !foot) return null;
      const bb = box.getBoundingClientRect(); const fb = foot.getBoundingClientRect();
      return { over: box.scrollHeight - box.clientHeight, scrollTop: box.scrollTop,
        inside: fb.top >= bb.top - 1 && fb.bottom <= bb.bottom + 1 };
    });
    ck('★★ 内容超出时底部动作条**仍然在视野里**（不用先往下翻 —— 以前注释写「常驻」其实是假的）',
      !!footVis && footVis.over > 1 && footVis.inside, JSON.stringify(footVis));
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
    ck('★★ 点开后出现 7 个输入框（音标/词性/释义/例句/例句中文/巧记/场景）', nIn2 === 7, '输入框 ' + nIn2 + ' 个');
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
    await p.locator('#lw-wd-mnem').fill('我自己写的巧记');
    await p.locator('#lw-wd-scene').fill('我自己写的场景');
    await p.locator('#lw-wd-def').click();       /* 失焦触发保存 ✓ */
    await p.waitForTimeout(900);
    const st5 = (await store()).words.find((x) => x.id === w1[0].id);
    ck('★ 巧记改完存上了', st5 && st5.mnem === '我自己写的巧记', st5 && st5.mnem);
    ck('★ 场景改完存上了', st5 && st5.scene === '我自己写的场景', st5 && st5.scene);

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
