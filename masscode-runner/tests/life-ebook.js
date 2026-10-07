#!/usr/bin/env node
/* 本地电子书**阅读器**的端到端探针 ✓ —— 打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。
   用户原话：「我需要的是可以实现阅读，目前这样的设计，我无法进行相关书籍的阅读」✓。
   ★ 这个探针**真的导一本书进去、真的读** ✓ ——
     ⚠️ 会往用户的 STORE 加一本书 ✗ → finally 里**按 id 删掉** ✓，
        并且把服务器上那本书的目录也删掉 ✓（不然磁盘上会堆垃圾 ✓）。
   ⚠️ 样本是**现造的** ✗（这台机器上一个 epub 都没有 ✓，见 tests/ebook.js 顶部 ✓）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { zipSync, strToU8 } = require('fflate');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const MARK = '__探针电子书__';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};
const put = async (d) => fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });

/* 造一本 5 章的 EPUB ✓（中文 ✓，用来验「首行缩进」那条 ✓） */
function makeEpub(title, author, n) {
  const f = {};
  f['mimetype'] = strToU8('application/epub+zip');
  f['META-INF/container.xml'] = strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  let man = '', spine = '';
  for (let i = 1; i <= n; i++) {
    man += '<item id="c' + i + '" href="Text/ch' + i + '.xhtml" media-type="application/xhtml+xml"/>';
    spine += '<itemref idref="c' + i + '"/>';
  }
  f['OEBPS/content.opf'] = strToU8('<package><metadata><dc:title>' + title + '</dc:title><dc:creator>' + author + '</dc:creator></metadata><manifest>' + man + '</manifest><spine>' + spine + '</spine></package>');
  for (let i = 1; i <= n; i++) {
    f['OEBPS/Text/ch' + i + '.xhtml'] = strToU8('<html><body><h1>第' + i + '章 探针标题' + i + '</h1>'
      + '<p>这是第' + i + '章的正文开头。' + '他站在门口，看着远处连绵的山。'.repeat(20) + '</p>'
      + '<p>第二段，用来验段落分隔。</p>'
      /* ⚠️ 第 1 章塞一个英文词 ✓ —— 用来验「**中文书里划到英文术语**也能加生词」✓
         （真实场景：读中文书遇到英文名词 ✓，这跟读外刊遇到生词是同一件事 ✓）。
         ⚠️ 词要跟英文那本**不一样** ✗ —— 生词本是**去重**的 ✓（`epWordAdd` 撞到已存在的词会只弹个提示 ✓），
            同一个词加两次，第二次就不会新增 ✗ → 断言「新增了 1 个」会假失败 ✓。 */
      + (i === 1 ? '<p>他在笔记里写下 serendipity 这个词。</p>' : '')
      + '</body></html>');
  }
  return Buffer.from(zipSync(f));
}
const EPUB = '/tmp/' + MARK + 'book.epub';
fs.writeFileSync(EPUB, makeEpub(MARK + '书', '探针作者', 5));

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const snap = await store();
  const keep = { books: snap.books, bookSel: snap.bookSel, readMode: snap.readMode, words: snap.words, wordSel: snap.wordSel };
  const booksBefore = new Set((snap.books || []).map((b) => b && b.id));
  const wordsBefore = new Set((snap.words || []).map((w) => w && w.id));
  const madeBooks = []; const madeWords = []; const madeEbookIds = [];

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const natives = [];
  p.on('dialog', async (d) => { natives.push(d.type()); await d.dismiss().catch(() => {}); });
  /* ⚠️ AI 配置存在**浏览器 localStorage** 里 ✗（`mc-ai-cfg` ✓）——
     探针是**全新 profile** ✓ → 读不到 ✓ → `mailAiCfg()` 返回 null ✓ →
     `epWordEnrich()` **在门口就 return 了** ✗（实测：AI 请求 0 次 ✓，
     「补全没填上释义」那条**假失败** ✓，查了半天才发现是探针自己没配 ✓）。
     → 用 `addInitScript` 塞一份假的 ✓，配合下面拦掉的 `/api/ai/chat` ✓
       → 整条链路（划词 → 加词 → 请求 → 剥 JSON → 填字段 → 落盘）**离线**验 ✓。 */
  await p.addInitScript(() => {
    try { localStorage.setItem('mc-ai-cfg', JSON.stringify({ url: 'https://example.invalid/v1/chat/completions', key: 'k', model: 'm' })); } catch (_) {}
  });
  /* ⚠️ 计数器 ✗ —— 「补全没填上释义」有**两种**可能 ✓：
     ① 请求压根没发出去 ✓ ② 发出去了但解析 / 落盘失败 ✓。
     没有计数器就分不清 ✗（第一版就是这么卡住的 ✓）。 */
  let aiCalls = 0; let imgCalls = 0;
  await p.route('**/api/ai/chat', (r) => { aiCalls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content: '{"ph":"/x/","def":"探针释义"}' }) }); });
  await p.route('**/api/life/en/wordimg*', (r) => { imgCalls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, list: ['data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==#a'] }) }); });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  const has = async (s) => (await p.locator(s).count()) > 0;

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 }); await p.waitForTimeout(1000);
    /* ⚠️⚠️ 阅读模块的**模式是落盘的** ✗✗（`STORE.readMode` ✓）——
       上一轮停在「外刊精读 / 生词本」的话 ✓，工具栏**根本不是书架那套** ✗ →
       「📚 导入电子书」这个按钮**压根不存在** ✗（实测就是这么挂的 ✓）。
       → 先切回**书架** ✓。这个坑这个项目踩过好几次了 ✓。 */
    await p.evaluate(() => {
      const el = document.querySelector('[data-rdmode="shelf"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await p.waitForTimeout(1200);

    console.log('\n── ① 导入一本 EPUB（走界面，不是直接调接口）──');
    ck('★ 工具栏有「📚 导入电子书」', await has('#lw-rd-ebook'));
    const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), p.click('#lw-rd-ebook')]);
    await fc.setFiles(EPUB);
    await p.waitForFunction(() => /导入好了|导入失败/.test((document.getElementById('lw-sub') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const sub = await txt('#lw-sub');
    console.log('    状态栏: ' + JSON.stringify(sub.slice(0, 80)));
    ck('★★ 导入成功（状态栏说了）', /导入好了/.test(sub), sub.slice(0, 80));
    const st1 = await store();
    const nb = (st1.books || []).filter((x) => x && !booksBefore.has(x.id));
    nb.forEach((x) => madeBooks.push(x.id));
    console.log('    新书: ' + JSON.stringify(nb.map((x) => ({ title: x.title, src: x.src, ebookId: x.ebookId }))));
    ck('★★ 书进了书架', nb.length === 1, JSON.stringify(nb.map((x) => x.title)));
    ck('★ 来源标成「本地电子书」', !!(nb[0] && nb[0].src === 'ebook'), nb[0] && nb[0].src);
    ck('★ 挂上了 ebookId（正文靠它取）', !!(nb[0] && /^eb[a-z0-9]+$/.test(String(nb[0].ebookId || ''))), nb[0] && nb[0].ebookId);
    ck('★ 书名 / 作者从 EPUB 元数据读出来了', !!(nb[0] && nb[0].title === MARK + '书' && nb[0].author === '探针作者'),
      nb[0] ? (nb[0].title + ' / ' + nb[0].author) : '');
    if (nb[0] && nb[0].ebookId) madeEbookIds.push(nb[0].ebookId);

    console.log('\n── ② 选这本书 → 直接给**阅读器**（不是那套笔记面板）──');
    await p.waitForSelector('.lw-eb-body', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(800);
    ck('★★ 出现阅读器（.lw-eb-body）', await has('.lw-eb-body'));
    ck('★ 正文真的渲染出来了', (await txt('.lw-eb-body')).length > 200, String((await txt('.lw-eb-body')).length) + ' 字');
    const bodyTxt = await txt('.lw-eb-body');
    ck('★★ 是第一段的正文（不是空白 / 不是报错）', /这是第1章的正文开头/.test(bodyTxt), bodyTxt.slice(0, 60));
    ck('★ 章节标题显示出来了', /探针标题1/.test(bodyTxt), bodyTxt.slice(0, 40));
    ck('★ 目录下拉里有 5 章', (await p.locator('#lw-eb-jump option').count()) === 5, String(await p.locator('#lw-eb-jump option').count()));
    ck('★ 进度写着「第 1 / 5 章」', /第 1 \/ 5 章/.test(await txt('.lw-eb-bar')), await txt('.lw-eb-bar'));
    ck('★ 段落分开了（不是一大坨）', (await p.locator('.lw-eb-body > p').count()) >= 2, String(await p.locator('.lw-eb-body > p').count()));
    ck('★ 中文书首行缩进（.cjk）', await p.evaluate(() => !!document.querySelector('.lw-eb-body.cjk')));

    console.log('\n── ③ 翻章 ──');
    await p.click('#lw-eb-next'); await p.waitForTimeout(1500);
    const t2 = await txt('.lw-eb-body');
    ck('★★ 下一章：正文换了', /这是第2章的正文开头/.test(t2), t2.slice(0, 50));
    ck('★ 进度跟着变', /第 2 \/ 5 章/.test(await txt('.lw-eb-bar')), await txt('.lw-eb-bar'));
    await p.selectOption('#lw-eb-jump', '4'); await p.waitForTimeout(1500);
    const t4 = await txt('.lw-eb-body');
    ck('★ 下拉跳章也管用（跳到第 5 章）', /这是第5章的正文开头/.test(t4), t4.slice(0, 50));
    ck('★ 最后一章时「下一章」禁用', await p.evaluate(() => !!document.getElementById('lw-eb-next').disabled));
    await p.click('#lw-eb-prev'); await p.waitForTimeout(1500);
    ck('★ 上一章也管用', /这是第4章的正文开头/.test(await txt('.lw-eb-body')), (await txt('.lw-eb-body')).slice(0, 50));

    console.log('\n── ④ 字号 / 宽度 ──');
    /* ⚠️ 这里**踩过坑** ✗：字号按钮原来起的 id 是 `lw-eb-font+` ✓ ——
       而 `+` 在 CSS 里是**相邻兄弟选择器** ✗ → `querySelector('#lw-eb-font+')` **直接抛错** ✗ →
       `bindReading()` 从那一行**后面全都不绑** ✗（表现是「一大片点了没反应」✓）。
       已改名 `lw-eb-fminus` / `lw-eb-fplus` ✓。下面顺手断言**旧 id 不存在** ✓，防止有人改回去 ✗。 */
    ck('★ 字号按钮的 id 里**没有 `+`**（那会抛错并带崩整个绑定）',
      await p.evaluate(() => !document.getElementById('lw-eb-font+') && !!document.getElementById('lw-eb-fplus') && !!document.getElementById('lw-eb-fminus')));
    const fs0 = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('lw-eb-body')).fontSize));
    await p.click('#lw-eb-fplus'); await p.waitForTimeout(400);
    await p.click('#lw-eb-fplus'); await p.waitForTimeout(600);
    const fs1 = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('lw-eb-body')).fontSize));
    console.log('    字号 ' + fs0 + ' → ' + fs1);
    ck('★ 「A+」真的把字放大了', fs1 > fs0, fs0 + ' → ' + fs1);
    await p.click('#lw-eb-fminus'); await p.waitForTimeout(600);
    const fs2 = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('lw-eb-body')).fontSize));
    ck('★ 「A−」也管用（能缩回去）', fs2 < fs1, fs1 + ' → ' + fs2);
    ck('★ 改字号**不丢正文**（重绘了但还在这一章）', /这是第4章的正文开头/.test(await txt('.lw-eb-body')), (await txt('.lw-eb-body')).slice(0, 40));
    const w0 = await p.evaluate(() => getComputedStyle(document.querySelector('.lw-eb-body > p')).maxWidth);
    await p.click('#lw-eb-wide'); await p.waitForTimeout(600);
    const w1 = await p.evaluate(() => getComputedStyle(document.querySelector('.lw-eb-body > p')).maxWidth);
    console.log('    正文最大宽 ' + w0 + ' → ' + w1);
    ck('★ 「↔」真的把正文放宽了', w0 !== w1, w0 + ' → ' + w1);

    console.log('\n── ⑤ 划词：中文书 ──');
    /* ⚠️ 拖选要落在**真实文字**上 ✗ —— inline 元素的 `boundingBox` 是**折行并集** ✓，
       中间有「点不中的空洞」✓（见 skill 里那条 ✓）→ 用 `Range.setStart/setEnd` 量**真实字符**位置 ✓。 */
    const pickRange = async (parIdx, from, len) => {
      const bx = await p.evaluate(([i, a, n]) => {
        const el = document.querySelectorAll('.lw-eb-body > p')[i];
        if (!el || !el.firstChild || el.firstChild.nodeType !== 3) return null;
        const t = String(el.firstChild.textContent || '');
        const end = Math.min(t.length, a + n);
        if (a < 0 || a >= end) return null;
        const r = document.createRange();
        r.setStart(el.firstChild, a); r.setEnd(el.firstChild, end);
        const b = r.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
      }, [parIdx, from, len]);
      if (!bx || !(bx.w > 0) || !(bx.h > 4)) return false;
      await p.mouse.move(bx.x + 1, bx.y + bx.h / 2);
      await p.mouse.down();
      await p.mouse.move(bx.x + Math.max(1, bx.w - 1), bx.y + bx.h / 2, { steps: 6 });
      await p.mouse.up();
      await p.waitForTimeout(700);
      return true;
    };
    const pickShown = () => p.evaluate(() => {
      const el = document.getElementById('lw-eb-pick');
      return !!el && el.style.display !== 'none';
    });
    ck('  量到了正文第一个字的位置（能拖选）', await pickRange(0, 0, 2));
    /* ★ 中文划词**不该**弹浮层 ✓ —— 这是**正确**行为 ✓，不是 bug ✓：
       生词本整条链路（音标 / 释义 / 例句 / 巧记 / 配图 / 遗忘曲线 ✓）都是给**英文**做的 ✓，
       把「这是」这种中文词加进去只会**污染词表** ✗。 */
    ck('★★ 划中文**不弹**英文生词浮层（正确行为，不是 bug）', !(await pickShown()), await txt('#lw-eb-pick'));
    /* ★ 但**中文书里划到英文术语**要能加 ✓ —— 真实场景：读中文书遇到英文名词 ✓。
       这跟读外刊遇到生词是同一件事 ✓，走的是**同一个生词本** ✓。
       ⚠️ 那个英文词在**第 1 章** ✓，而我们现在在第 4 章 ✓（③ 翻过来的 ✓）→ 先跳回去 ✓。 */
    await p.selectOption('#lw-eb-jump', '0'); await p.waitForTimeout(1500);
    ck('  跳回第 1 章（英文词在这一章）', /这是第1章的正文开头/.test(await txt('.lw-eb-body')), (await txt('.lw-eb-body')).slice(0, 40));
    const enIdx = await p.evaluate(() => Array.from(document.querySelectorAll('.lw-eb-body > p'))
      .findIndex((el) => /serendipity/.test(el.textContent || '')));
    ck('  中文书里找到了那个英文词所在的段落', enIdx >= 0, '第 ' + enIdx + ' 段');
    const enOff = await p.evaluate((i) => {
      const el = document.querySelectorAll('.lw-eb-body > p')[i];
      return el ? String(el.firstChild.textContent || '').indexOf('serendipity') : -1;
    }, enIdx);
    ck('  定位到英文词的字符位置', enOff >= 0, String(enOff));
    ck('  能拖选到它', await pickRange(enIdx, enOff, 'serendipity'.length));
    const pk1 = await txt('#lw-eb-pick');
    console.log('    浮层文案: ' + JSON.stringify(pk1));
    ck('★★ 中文书里划到英文词 → 浮出「＋ 加生词」', (await pickShown()) && /serendipity/i.test(pk1), pk1);
    await p.locator('#lw-eb-pick').dispatchEvent('mousedown');
    await p.waitForTimeout(3000);
    const st5 = await store();
    const nw = (st5.words || []).filter((w) => w && !wordsBefore.has(w.id));
    nw.forEach((w) => madeWords.push(w.id));
    console.log('    新增生词: ' + JSON.stringify(nw.map((x) => x.w)) + ' · AI 请求 ' + aiCalls + ' 次');
    ck('★★ 而且真的进了生词本', nw.length >= 1 && nw.some((x) => x.w === 'serendipity'), JSON.stringify(nw.map((x) => x.w)));
    ck('★ 自动补全照常跑（释义被填上）', !!(nw[0] && nw[0].def), JSON.stringify(nw[0] && { ph: nw[0].ph, def: nw[0].def }));
    /* ⚠️ 跳回第 4 章 ✓ —— ⑦ 断言「`rdCh` 落盘成 3」✓，不留个已知状态那条就会假失败 ✗。 */
    await p.selectOption('#lw-eb-jump', '3'); await p.waitForTimeout(1500);
    ck('  跳回第 4 章（给 ⑦ 留一个已知状态）', /这是第4章的正文开头/.test(await txt('.lw-eb-body')), (await txt('.lw-eb-body')).slice(0, 40));

    console.log('\n── ⑥ 英文书 + 划词加生词 ──');
    /* 英文那本单独造 ✓（一本一章 ✓，就一句带生词的句子 ✓） */
    const enFiles = {};
    enFiles['META-INF/container.xml'] = strToU8('<container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>');
    enFiles['a.opf'] = strToU8('<package><metadata><dc:title>English Probe</dc:title><dc:creator>A</dc:creator></metadata>'
      + '<manifest><item id="x" href="x.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="x"/></spine></package>');
    enFiles['x.xhtml'] = strToU8('<html><body><h1>Chapter One</h1><p>Ubiquitous computing is everywhere. '
      + 'The quick brown fox jumps over the lazy dog again and again and again. '.repeat(6) + '</p><p>Second paragraph.</p></body></html>');
    fs.writeFileSync('/tmp/' + MARK + 'en2.epub', Buffer.from(zipSync(enFiles)));
    const [fc2] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), p.click('#lw-rd-ebook')]);
    await fc2.setFiles('/tmp/' + MARK + 'en2.epub');
    await p.waitForFunction(() => /导入好了|导入失败/.test((document.getElementById('lw-sub') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2000);
    const st6 = await store();
    const nb2 = (st6.books || []).filter((x) => x && !booksBefore.has(x.id) && madeBooks.indexOf(x.id) < 0);
    nb2.forEach((x) => madeBooks.push(x.id));
    if (nb2[0] && nb2[0].ebookId) madeEbookIds.push(nb2[0].ebookId);
    ck('★ 英文书也导进来了', nb2.length === 1, JSON.stringify(nb2.map((x) => x.title)));
    ck('★ 英文书**不缩进**（.cjk 没加上）', await p.evaluate(() => !document.querySelector('.lw-eb-body.cjk')));
    ck('★ 标题只出现一次（不是 `<h3>` 一个 + 正文第一段又一个）',
      await p.evaluate(() => {
        const t = document.querySelector('.lw-eb-body').innerText || '';
        return (t.match(/Chapter One/g) || []).length === 1;
      }));
    ck('  能拖选到句首那个词', await pickRange(0, 0, 'Ubiquitous'.length));
    const pk = await txt('#lw-eb-pick');
    console.log('    浮层文案: ' + JSON.stringify(pk));
    ck('★★ 英文书划词也浮出来了', (await pickShown()) && /Ubiquitous|ubiquitous/.test(pk), pk);
    await p.locator('#lw-eb-pick').dispatchEvent('mousedown');
    await p.waitForTimeout(3000);
    const st7 = await store();
    const nw2 = (st7.words || []).filter((w) => w && !wordsBefore.has(w.id) && madeWords.indexOf(w.id) < 0);
    nw2.forEach((w) => madeWords.push(w.id));
    console.log('    新增生词: ' + JSON.stringify(nw2.map((x) => x.w)) + ' · AI 请求 ' + aiCalls + ' 次 · 搜图 ' + imgCalls + ' 次');
    ck('★★ 英文书划的词进了生词本', nw2.length >= 1, JSON.stringify(nw2.map((x) => x.w)));
    ck('  而且存的是**洗过的**小写词（不是带标点的原串）', nw2.some((x) => x.w === 'ubiquitous'), JSON.stringify(nw2.map((x) => x.w)));
    ck('★ 划词加生词 → **真的调了 AI 补全**（不是悄悄跳过）', aiCalls >= 1, 'AI 请求 ' + aiCalls + ' 次');
    ck('★ 而且补全也跑了（释义被填上）', !!(nw2[0] && nw2[0].def), JSON.stringify(nw2[0] && { ph: nw2[0].ph, def: nw2[0].def }));

    console.log('\n── ⑦ 进度记住（切走再回来还在那一章）──');
    const st8 = await store();
    const cur = (st8.books || []).find((x) => x && x.id === nb[0].id);
    console.log('    书上的 rdCh=' + (cur && cur.rdCh) + '  prog=' + (cur && cur.prog));
    ck('★★ 「读到第几章」落盘了', !!(cur && Number(cur.rdCh) === 3), cur ? String(cur.rdCh) : '');
    ck('★ 进度百分比也跟着算', !!(cur && Number(cur.prog) > 0), cur ? String(cur.prog) + '%' : '');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForTimeout(1200);
    await p.evaluate((id) => { const el = document.querySelector('[data-rdbk="' + id + '"]'); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, nb[0].id);
    await p.waitForSelector('.lw-eb-body', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1500);
    ck('★★ 刷新后点这本书，**接着上次那章**（不是从第 1 章重来）', /这是第4章的正文开头/.test(await txt('.lw-eb-body')), (await txt('.lw-eb-body')).slice(0, 50));

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
    ck('★ 全程没有原生弹窗', natives.length === 0, JSON.stringify(natives));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    try {
      /* ① 删服务器上的书 ✓（不然磁盘上会堆垃圾 ✓） */
      for (const id of madeEbookIds) { try { await fetch(BASE + '/api/life/ebook?id=' + id, { method: 'DELETE' }); } catch (_) {} }
      /* ② 还原 STORE ✓（只删自己造的 ✓） */
      const d = await store();
      d.books = (d.books || []).filter((x) => x && madeBooks.indexOf(x.id) < 0);
      d.words = (d.words || []).filter((w) => w && madeWords.indexOf(w.id) < 0);
      ['books', 'bookSel', 'readMode', 'words', 'wordSel'].forEach((k) => { if (keep[k] === undefined) delete d[k]; else d[k] = keep[k]; });
      await put(d);
      const a = await store();
      console.log('\n收尾：书 ' + (a.books || []).length + ' 本（残留探针书 '
        + (a.books || []).filter((x) => x && madeBooks.indexOf(x.id) >= 0).length + '）'
        + ' · 生词残留 ' + (a.words || []).filter((x) => x && madeWords.indexOf(x.id) >= 0).length
        + ' · 磁盘上残留书目录 ' + madeEbookIds.filter((id) => fs.existsSync(path.join(os.homedir(), 'Library/Application Support/CodeScope/life-books', id))).length);
    } catch (e) { console.log('\n收尾失败: ' + e.message); fails.push('收尾失败'); }
    try { fs.unlinkSync(EPUB); } catch (_) {}
    try { fs.unlinkSync('/tmp/' + MARK + 'en2.epub'); } catch (_) {}
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
