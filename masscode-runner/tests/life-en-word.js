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
/* ⚠️ 这个词必须**不在**用户的生词本里** ✗ —— 重复加会直接返回「已经在生词本里了」✗，
   于是整条探针一路假失败 ✗（实测：第一版用了 individuals，而用户**正好**加过它 ✗）。
   下面 ⓪ 有一条前置断言守着 ✓。 */
const WORD = 'ubiquitous';

/* 假 AI 的回答 ✓ —— 故意**带 ```json 围栏 + 前言** ✓，验的就是「能不能剥干净」✓ */
const FAKE_JSON = {
  ph: '/ˌɪn.dɪˈvɪdʒ.u.əlz/',
  pos: 'n.',
  def: '个人；个体',
  eg: 'These two rural communities may appear to have little in common.',
  egZh: '这两个乡村社群看上去似乎没有什么共同之处。',
  mnem: 'in（不）+ divid（分）+ ual → 不可再分的 → 个体。',
  scene: '一群人站在广场上，镜头逐个框出每个人的脸，标上编号。',
};

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const snap = await store();
  const keep = { words: snap.words, wordSel: snap.wordSel, epArt: snap.epArt, readMode: snap.readMode, epWordFilter: snap.epWordFilter };
  const idsBefore = new Set((snap.words || []).map((w) => w && w.id));
  const madeIds = [];

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  /* ⚠️ 「＋ 加词」走的是 `prompt()` ✗（两次：单词 + 释义 ✓）——
     探针得**按顺序应答** ✓，不然会卡在对话框上超时 ✗。 */
  const dialogs = [WORD, ''];
  p.on('dialog', async (d) => { await d.accept(dialogs.length ? dialogs.shift() : ''); });
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

    console.log('\n── ⓪ 前置：这个词必须**不在**生词本里 ──');
    {
      const w0 = (await store()).words || [];
      const dup = w0.filter((x) => x && String(x.w).toLowerCase() === WORD);
      ck('★ 测试词 ' + WORD + ' 不在现有生词本里（不然重复加会直接返回、整条假失败）', dup.length === 0,
        '已存在 ' + dup.length + ' 个');
    }

    console.log('\n── ① 加一个词：应该**自动**去补全 ──');
    ck('  有「＋ 加词」按钮', await p.locator('#lw-wd-add').count() === 1);
    await p.click('#lw-wd-add');
    await p.waitForTimeout(2500);
    const st1 = await store();
    const w1 = (st1.words || []).filter((w) => w && !idsBefore.has(w.id));
    w1.forEach((w) => madeIds.push(w.id));
    console.log('    新增词卡 ' + w1.length + ' 个' + (w1[0] ? ('：' + JSON.stringify({ w: w1[0].w, ph: w1[0].ph, pos: w1[0].pos, def: w1[0].def })) : ''));
    ck('★ 词卡建出来了', w1.length === 1, JSON.stringify(w1.map((x) => x.w)));
    ck('★★ 音标**自动填上了**', !!(w1[0] && /ɪn|dɪ/.test(String(w1[0].ph))), w1[0] && w1[0].ph);
    ck('★★ 词性自动填上了', !!(w1[0] && w1[0].pos), w1[0] && w1[0].pos);
    ck('★★ 释义自动填上了', !!(w1[0] && /个人|个体/.test(String(w1[0].def))), w1[0] && w1[0].def);
    ck('★★ 例句自动填上了', !!(w1[0] && String(w1[0].eg).length > 15), w1[0] && w1[0].eg);
    ck('★★ 例句中文自动填上了', !!(w1[0] && String(w1[0].egZh).length > 8), w1[0] && w1[0].egZh);
    ck('★★ 巧记自动填上了', !!(w1[0] && /词根|联想|谐音|in（不）|拆/.test(String(w1[0].mnem))), w1[0] && w1[0].mnem);
    ck('★★ 场景自动填上了', !!(w1[0] && String(w1[0].scene).length > 10), w1[0] && w1[0].scene);
    ck('★★ 模型包了 ```json 围栏 + 废话，也剥干净了（没把围栏写进字段）',
      !!(w1[0] && !/```|好的，这是/.test(JSON.stringify(w1[0]))), w1[0] && String(w1[0].def));
    ck('  真的问了 AI（不是本地编的）', aiCalls >= 1, 'AI 调用 ' + aiCalls);

    console.log('\n── ② 配图：补完顺手配一张 ──');
    ck('★★ 自动配了图', !!(w1[0] && String(w1[0].img || '').length > 10), w1[0] && String(w1[0].img).slice(0, 40));
    ck('★ 存了一批候选（好「换一张」）', !!(w1[0] && Array.isArray(w1[0].imgs) && w1[0].imgs.length >= 3),
      w1[0] && JSON.stringify((w1[0].imgs || []).length));
    ck('  真的调了搜图接口', imgCalls >= 1, '搜图 ' + imgCalls + ' 次');

    console.log('\n── ③ 面板上看得见（不是只存了数据）──');
    await p.evaluate((id) => {
      const el = document.querySelector('[data-epword="' + id + '"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, w1[0].id);
    await p.waitForTimeout(1000);
    const panel = await txt('.lw-rd-read');
    console.log('    面板片段: ' + JSON.stringify(panel.slice(0, 110)));
    ck('★ 面板里有音标', (await val('#lw-wd-ph')).indexOf('ɪn') >= 0, await val('#lw-wd-ph'));
    ck('★ 面板里有词性', (await val('#lw-wd-pos')).length > 0, await val('#lw-wd-pos'));
    ck('★ 面板里有释义', (await val('#lw-wd-def')).length > 0, await val('#lw-wd-def'));
    ck('★ 面板里有例句', (await val('#lw-wd-eg')).length > 10, await val('#lw-wd-eg'));
    ck('★ 面板里有巧记', (await val('#lw-wd-mnem')).length > 10, await val('#lw-wd-mnem'));
    ck('★ 面板里有场景', (await val('#lw-wd-scene')).length > 10, await val('#lw-wd-scene'));
    ck('★ 配图显示出来了（img 元素在）', await p.locator('.lw-wd-img').count() === 1);
    ck('★ 配图说明写清了来源', /百度图片/.test(await txt('.lw-wd-imgwrap')), await txt('.lw-wd-imgwrap'));
    ck('★ 列表行里有小缩略图', await p.locator('.lw-wd-thumb').count() >= 1);
    ck('★ 有「🪄」和「🖼」两个按钮', await p.locator('#lw-wd-enrich').count() === 1 && await p.locator('#lw-wd-img').count() === 1);

    console.log('\n── ④ 「换一张」只换下标、不重新搜 ──');
    const before = (await store()).words.find((x) => x.id === w1[0].id).img;
    const imgCalls0 = imgCalls;
    await p.click('#lw-wd-img'); await p.waitForTimeout(900);
    const after = (await store()).words.find((x) => x.id === w1[0].id).img;
    console.log('    图 ' + String(before).slice(-12) + ' → ' + String(after).slice(-12));
    ck('★★ 换了一张（不是同一张）', before !== after, before + ' → ' + after);
    ck('★ 换图**没有**再打一次搜图接口（用已有候选 ✓）', imgCalls === imgCalls0, imgCalls0 + ' → ' + imgCalls);

    console.log('\n── ⑤ 手改也能存（新字段一起存）──');
    await p.locator('#lw-wd-mnem').fill('我自己写的巧记');
    await p.locator('#lw-wd-scene').fill('我自己写的场景');
    await p.locator('#lw-wd-def').click();       /* 失焦触发保存 ✓ */
    await p.waitForTimeout(900);
    const st5 = (await store()).words.find((x) => x.id === w1[0].id);
    ck('★ 巧记改完存上了', st5 && st5.mnem === '我自己写的巧记', st5 && st5.mnem);
    ck('★ 场景改完存上了', st5 && st5.scene === '我自己写的场景', st5 && st5.scene);

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
