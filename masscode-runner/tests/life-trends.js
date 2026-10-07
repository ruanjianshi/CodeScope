#!/usr/bin/env node
/* ⚠️ 这个探针打的是**本机正在运行的那个 CodeScope 实例** ✗ —— 需要 127.0.0.1:4877 起着 ✓，
   所以**故意不进 npm test** ✗（没有服务时会自动跳过 ✓，不会误报失败 ✓）。
   跑法：先起服务，再 node tests/life-trends.js ✓。
   ★ 它会在**真实数据**上建东西 ✗ —— 但 finally 里**全部删掉** ✓（只删自己建的 ✓）。
   ⚠️ 这个探针**真的会联网**（拉 11 个热点源 ✗）—— 所以比别的探针慢一点 ✓，属正常 ✓。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    /* ⚠️ 预览 iframe 是**故意**沙箱化（不带 allow-scripts ✗）的 ✓ ——
       Chrome 会为此打一条「Blocked script execution … sandboxed」✗，
       那是**安全特性在生效** ✓，不是缺陷 ✗（别把它算成页面异常 ✗）。 */
    if (/sandboxed|Blocked script execution/i.test(t)) return;
    errs.push('console: ' + t);
  });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  /* ★ AI 配置存在**浏览器 localStorage** 里 ✗（探针是全新 profile ✓，读不到 ✓）——
     ⑧b 要验「日报渲染成卡片」✓，得先**有配置**才走得到请求那一步 ✓
     （不然 `trAiDaily()` 在门口就提示「还没配大模型」✗ → 假 AI 根本不会被调用 ✗）。
     ⚠️ 用 `example.invalid` 当地址 ✓ —— ⑧ 会真去打一次 ✓ 必然失败 ✓，
        而那正是 ⑧ 想验的「失败也要给明确提示」✓，正好 ✓。 */
  await p.addInitScript(() => {
    try { localStorage.setItem('mc-ai-cfg', JSON.stringify({ url: 'https://example.invalid/v1/chat/completions', key: 'k', model: 'm' })); } catch (_) {}
  });

  /* ⚠️ 拖拽宽度要**备份** ✗ —— ⑧b 会真的拖一下（验「能拖」✓），
     于是 `trendAiW` 被写进 STORE ✓ → 不还的话用户下次打开宽度就变了 ✗
     （这是**改**用户的字段 ✓，不是造新东西 ✗ —— 得按快照还原 ✓）。
     ⚠️ 必须放在 `try` **外面** ✗✗ —— 放里面的话 `finally` 里读不到 ✓
        （`const` 是块级作用域 ✓，实测报的就是 `keepAiW is not defined` ✓）。 */
  const keepAiW = (await store()).trendAiW;
  try {
    /* 先清掉上次残留的 trends 状态 ✓ */
    try { const d0 = await store(); delete d0.trends; await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d0) }); } catch (_) {}

    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.waitForSelector('.lw-nav', { timeout: 20000 });
    ck('左栏有「热榜」入口', await p.locator('.lw-nav [data-tab="trends"]').count() === 1);
    await p.locator('.lw-nav [data-tab="trends"]').dispatchEvent('click');
    await p.waitForSelector('.lw-hl', { timeout: 20000 });
    await p.waitForTimeout(800);

    console.log('\n── ① 三栏 ──');
    ck('左栏', await p.locator('.lw-hl-side').count() === 1);
    ck('中栏', await p.locator('.lw-hl-list').count() === 1);
    ck('右栏', await p.locator('.lw-hl-read').count() === 1);
    const fill = await p.evaluate(() => {
      const m = document.querySelector('.lw-main'), cs = getComputedStyle(m), mb = m.getBoundingClientRect();
      const t = document.querySelector('.lw-hl').getBoundingClientRect();
      return Math.round((mb.bottom - parseFloat(cs.paddingBottom)) - t.bottom);
    });
    ck('★ 热榜面板填满内容区', fill <= 2, '空 ' + fill + 'px');

    console.log('\n── ② 进页面**自动拉一次**（这就是「每天自动更新」的落点）──');
    await p.waitForFunction(() => document.querySelectorAll('[data-trit]').length > 0, null, { timeout: 90000 });
    await p.waitForTimeout(1200);
    const n0 = await p.locator('[data-trit]').count();
    console.log('    自动拉到 ' + n0 + ' 条');
    ck('★ 不用手点就拉到内容了', n0 > 50, String(n0));
    ck('源列表有 11 个源', await p.locator('[data-trsrc]').count() === 12, String(await p.locator('[data-trsrc]').count()) + '（含「全部来源」）');
    const srcNames = await p.locator('[data-trsrc]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\n/g, ' ').trim()));
    console.log('    源: ' + srcNames.slice(0, 12).join(' | '));
    ck('★ 有抖音', srcNames.some((x) => x.includes('抖音')));
    ck('★ 有 arXiv 论文', srcNames.some((x) => x.includes('arXiv')));
    ck('★ 有 B站', srcNames.some((x) => x.includes('B站')));

    console.log('\n── ③ 按源筛选 ──');
    await p.locator('[data-trsrc="douyin"]').click(); await p.waitForTimeout(1200);
    const nDy = await p.locator('[data-trit]').count();
    ck('切到抖音后条数变了', nDy > 0 && nDy !== n0, n0 + ' → ' + nDy);
    ck('只剩抖音的条目', (await txt('.lw-hl-list')).includes('抖音热榜'), (await txt('.lw-hl-list')).slice(0, 50));
    await p.locator('[data-trsrc=""]').click(); await p.waitForTimeout(1200);
    ck('切回全部', await p.locator('[data-trit]').count() === n0, String(await p.locator('[data-trit]').count()));

    console.log('\n── ④ 点开一条 ──');
    const firstId = await p.locator('[data-trit]').first().getAttribute('data-trit');
    const firstTitle = (await p.locator('[data-trit]').first().locator('.ti').innerText()).trim();
    await p.locator('[data-trit]').first().click(); await p.waitForTimeout(1200);
    ck('右栏显示标题', (await txt('.lw-hl-body h2')).includes(firstTitle.slice(0, 12)), (await txt('.lw-hl-body h2')).slice(0, 40));
    ck('★ 自动标为已读（列表变灰）', await p.locator('.lw-hl-it.seen').count() >= 1, String(await p.locator('.lw-hl-it.seen').count()));
    const st1 = await store();
    ck('★ 已读落盘', st1.trends && st1.trends.seen && !!st1.trends.seen[firstId], JSON.stringify(st1.trends && st1.trends.seen).slice(0, 80));

    console.log('\n── ⑤ 收藏 ──');
    await p.locator('#lw-hl-star').click(); await p.waitForTimeout(1000);
    const st2 = await store();
    ck('★ 收藏落盘', st2.trends && st2.trends.star && !!st2.trends.star[firstId], JSON.stringify(st2.trends && st2.trends.star).slice(0, 80));
    ck('按钮变成「已收藏」', (await txt('#lw-hl-star')).includes('已收藏'), await txt('#lw-hl-star'));
    await p.locator('[data-tronly="star"]').click(); await p.waitForTimeout(1000);
    ck('★ 收藏筛选只剩 1 条', await p.locator('[data-trit]').count() === 1, String(await p.locator('[data-trit]').count()));
    await p.locator('[data-tronly="all"]').click(); await p.waitForTimeout(1000);

    console.log('\n── ⑥ 未读筛选 / 搜索 / 全部已读 ──');
    const seenNow = await p.locator('.lw-hl-it.seen').count();
    await p.locator('[data-tronly="new"]').click(); await p.waitForTimeout(1200);
    const unreadN = await p.locator('[data-trit]').count();
    ck('★ 未读筛选 = 总数 − 已读', unreadN === n0 - seenNow, n0 + ' − ' + seenNow + ' ≠ ' + unreadN);
    await p.locator('[data-tronly="all"]').click(); await p.waitForTimeout(1000);
    await p.locator('#lw-hl-q').fill('AI');
    await p.waitForTimeout(700);
    const vis = await p.locator('[data-trit]').evaluateAll((els) => els.filter((e) => e.style.display !== 'none').length);
    ck('搜索「AI」后只剩含 AI 的', vis > 0 && vis < n0, vis + ' / ' + n0);
    await p.locator('#lw-hl-q').fill(''); await p.waitForTimeout(500);
    await p.locator('#lw-hl-seenall').click(); await p.waitForTimeout(1200);
    ck('★ 全部标为已读后没有未读', await p.locator('.lw-hl-it.seen').count() === n0, String(await p.locator('.lw-hl-it.seen').count()) + ' / ' + n0);

    console.log('\n── ⑦ 刷新（force）──');
    await p.locator('#lw-hl-reload').click();
    await p.waitForTimeout(6000);
    ck('刷新后还有内容', await p.locator('[data-trit]').count() > 50, String(await p.locator('[data-trit]').count()));

    console.log('\n── ⑧ AI 日报（没配模型时要给明确提示，不能假装成功）──');
    await p.locator('#lw-hl-ai').click();
    await p.waitForFunction(() => { const e = document.querySelector('.lw-hl-ai .bd'); return e && e.innerText.trim().length > 0 && !/正在让模型/.test(e.innerText); }, null, { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const ai = await txt('.lw-hl-ai .bd');
    console.log('    AI 面板: ' + JSON.stringify(ai.slice(0, 90)));
    ck('★ AI 面板有结果（配了就出简报 / 没配就给明确提示）', ai.length > 4, ai.slice(0, 60));

    console.log('\n── ⑧b ★★ AI 日报：左右布局 / 能拖宽 / 卡片化 / 序号能跳（2026-10-08 新需求）──');
    /* 用户原话三句：
         「这个AI日报这里，窗口无法自由拖动」
         「把上下布局，改成左右布局」
         「AI日报过于简单了，我需要你来总结热点的内容和重点，等等，
           帮助我快速理解和阅读好热点信息，而不是简单概括」 */
    /* ⚠️ 这一节要**拦一个假 AI** ✗ —— 上面 ⑧ 走的是真接口（配了就出真简报 ✓），
       而这里要验的是「**卡片渲染**」✓，必须让返回内容**可控** ✓
       （不然模型今天返回 JSON、明天返回 markdown ✓，断言就飘了 ✓）。 */
    const FAKE = {
      headline: '今天最值得看的是端侧自动化和 Agent 规划两条线同时推进',
      themes: ['端侧自动化', 'Agent 规划', '世界模型'],
      items: [
        {
          n: 3, title: '探针·通知自动化',
          what: '苹果把通知处理和快捷指令打通了，通知可以直接触发自动化流程。',
          why: '做端侧自动化的话这是系统层面第一次把入口让出来。',
          points: ['通知可直接作为触发器', '和快捷指令联动，不用第三方 App'],
          tags: ['iOS', '自动化'],
        },
        {
          n: 10, title: '探针·Dot 智能体',
          what: 'OpenAI 发布了一个叫 Dot 的智能体产品，同时 AMD 收购了 World Labs。',
          why: 'Agent 产品形态和空间智能在同一天有动作，说明两条线都在加速。',
          points: ['Dot 主打长行程任务'],
          tags: ['Agent'],
        },
      ],
      skip: '纯商业融资类可以略过',
    };
    await p.route('**/api/ai/chat', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      /* ⚠️ 故意包一层 ```json 围栏 ✗ —— 模型十有八九这么答 ✓，
         验的就是「前端能不能剥干净」✓（和外刊精读那边同一条经验 ✓）。 */
      body: JSON.stringify({ ok: true, content: '好的：\n```json\n' + JSON.stringify(FAKE) + '\n```\n' }),
    }));
    /* ★ ① 左右布局 ✓（原来是上下 ✗）*/
    ck('★★ 右栏是**左右布局**（不再是上下堆叠）',
      await p.evaluate(() => getComputedStyle(document.querySelector('.lw-hl-read')).flexDirection) === 'row',
      await p.evaluate(() => getComputedStyle(document.querySelector('.lw-hl-read')).flexDirection));
    /* ★ ② 能拖 ✓ */
    ck('★★ AI 日报旁边有**拖拽条**', await p.locator('[data-pgrip="ai"]').count() === 1);
    const w0 = await p.evaluate(() => Math.round(document.querySelector('.lw-hl-ai').getBoundingClientRect().width));
    /* ⚠️ 往**左**拖（变小）✗ —— 上限是按「读栏的百分比」算的 ✓（保护正文不被挤没 ✓），
       而恢复出来的宽度**可能正好顶在上限** ✓ → 往右拖纹丝不动 ✗（实测：382 → 382 ✗）。
       往小拖一定动得了 ✓（下限 220 ✓），照样证明「能拖」✓。 */
    await p.evaluate(() => {
      const g = document.querySelector('[data-pgrip="ai"]');
      const mk = (t, x, buttons) => new PointerEvent(t, {
        bubbles: true, cancelable: true, clientX: x, clientY: 300, buttons,
        pointerId: 21, pointerType: 'mouse', isPrimary: true, button: t === 'pointerdown' ? 0 : -1,
      });
      const r = g.getBoundingClientRect(), x0 = r.left + r.width / 2;
      g.dispatchEvent(mk('pointerdown', x0, 1));
      document.dispatchEvent(mk('pointermove', x0 - 120, 1));
      document.dispatchEvent(mk('pointerup', x0 - 120, 0));
    });
    await p.waitForTimeout(500);
    const w1 = await p.evaluate(() => Math.round(document.querySelector('.lw-hl-ai').getBoundingClientRect().width));
    console.log('    AI 日报宽度 ' + w0 + ' → ' + w1);
    ck('★★ 拖拽条**真的能改宽度**（用户原话「窗口无法自由拖动」）', w1 < w0 - 60, w0 + ' → ' + w1);
    const savedW = (await store()).trendAiW;
    ck('★ 而且宽度**落盘**了（下次打开还记得）', Number(savedW) === w1, String(savedW));
    /* ★ 顺手守一条：宽度上限**不能写死** ✗ —— 写死 760 的话，
       右栏才 650px ✓，能把正文挤成一条缝 ✗（实测：正文只剩 39px ✗，
       文字折成十几行 ✓、预览也撑不起来 ✓，看着像「布局坏了」✗）。 */
    ck('★★ 正文栏没有被挤没（AI 列再宽也要给正文留地方）',
      await p.evaluate(() => Math.round(document.querySelector('.lw-hl-body').getBoundingClientRect().width)) > 150,
      '正文宽 ' + await p.evaluate(() => Math.round(document.querySelector('.lw-hl-body').getBoundingClientRect().width)) + 'px');
    /* ★ ③ 卡片化 ✓ */
    await p.locator('#lw-hl-ai').click();
    await p.waitForFunction(() => document.querySelectorAll('.lw-hl-ai .cd').length > 0, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(800);
    ck('★★ 日报渲染成**卡片**（不再是「一段文字」）', await p.locator('.lw-hl-ai .cd').count() === 2,
      String(await p.locator('.lw-hl-ai .cd').count()));
    ck('★ 有**今日总览 + 主线标签**', await p.locator('.lw-hl-ai .ov').count() === 1 && await p.locator('.lw-hl-ai .ov .th span').count() >= 2,
      await txt('.lw-hl-ai .ov'));
    const card0 = await txt('.lw-hl-ai .cd');
    console.log('    第 1 张卡: ' + JSON.stringify(card0.slice(0, 110)));
    ck('★★ 每张卡都写了「**是什么**」和「**为什么看**」（不是一句概括）',
      /通知处理/.test(card0) && /端侧自动化/.test(card0), card0.slice(0, 110));
    ck('★ 有**要点列表**和**关键词**', await p.locator('.lw-hl-ai .cd .pts div').count() >= 2 && await p.locator('.lw-hl-ai .cd .tg span').count() >= 2);
    ck('★ 卡片上带**序号徽章**', await p.locator('[data-trn]').count() === 2, String(await p.locator('[data-trn]').count()));
    /* ★ ④ 点序号 → 跳到中栏那条 ✓（「帮助我快速理解和阅读」的关键一步 ✓）*/
    const before = await p.locator('[data-trit].on').count();
    await p.locator('[data-trn]').first().click();
    await p.waitForTimeout(1200);
    ck('★★ 点序号 → 中栏对应那条被选中了', await p.locator('[data-trit].on').count() === 1, '之前 ' + before + ' 条选中');
    ck('★ 而且右边换成了那条的详情', (await txt('.lw-hl-body')).length > 10, (await txt('.lw-hl-body')).slice(0, 50));
    await p.unroute('**/api/ai/chat');

    console.log('\n── ⑨ ★ 不允许被内嵌的站，要说清楚（不是显示「拒绝连接」）──');
    /* 用户原话：「怎么有些打不开，拒绝连接」✗ —— 那是 GitHub 发的
       X-Frame-Options: deny ✗，浏览器就只显示一句「github.com 拒绝了我们的连接请求」✗。
       实测：✗ 不能嵌 = github / arxiv / openalex / openai.com；
             ✓ 能嵌  = B站 / 掘金 / 少数派 / 微博 / 百度 / 抖音 / HN ✓。 */
    const frameCheck = async (srcKey) => {
      await p.locator('[data-trsrc="' + srcKey + '"]').click();
      await p.waitForTimeout(3000);
      await p.locator('[data-trit]').first().click();
      await p.waitForTimeout(2500);
      return p.evaluate(() => {
        const body = document.querySelector('.lw-hl-body');
        const frame = document.getElementById('lw-hl-frame');
        const card = document.querySelector('.lw-hl-noframe');
        const cs = body ? getComputedStyle(body) : null;
        const bb = body ? body.getBoundingClientRect() : null;
        const last = body && body.lastElementChild ? body.lastElementChild.getBoundingClientRect() : null;
        return {
          iframe: document.querySelectorAll('#lw-hl-frame').length,
          card: document.querySelectorAll('.lw-hl-noframe').length,
          bigBtn: document.querySelectorAll('#lw-hl-openbig').length,
          txt: card ? card.innerText.replace(/\n/g, ' ').slice(0, 70) : '',
          /* ★ 新增：预览到底有没有**撑满** ✗ —— 以前 iframe 写死 340px ✗，
             而右栏是整屏高 ✓，于是下面永远空一大片 ✗（用户截图里那块空白 ✗）。
             这两项就是那个 bug 的探针 ✓。 */
          frameH: frame ? Math.round(frame.getBoundingClientRect().height) : 0,
          cardH: card ? Math.round(card.getBoundingClientRect().height) : 0,
          bodyH: bb ? Math.round(bb.height) : 0,
          bottomGap: (bb && last) ? Math.round(bb.bottom - parseFloat(cs.paddingBottom) - last.bottom) : -1,
        };
      });
    };
    const gh = await frameCheck('github');
    console.log('    GitHub → ' + JSON.stringify(gh));
    ck('★ GitHub 不塞 iframe（改出卡片）', gh.iframe === 0 && gh.card === 1, JSON.stringify(gh));
    ck('★ 卡片说清了「是对方不允许，不是这边坏了」', /不允许被内嵌/.test(gh.txt), gh.txt);
    ck('★ 卡片上有个大按钮能打开原文', gh.bigBtn === 1, String(gh.bigBtn));
    /* 那张「不允许内嵌」的卡片也要撑满 —— 不然它下面同样是一大片空白 ✗。 */
    ck('★ 卡片也撑满了（不是浮在顶上）', gh.cardH > 150, '卡片 ' + gh.cardH + ' · 栏高 ' + gh.bodyH);
    ck('★ 卡片下面也不留空白', gh.bottomGap <= 2, '还剩 ' + gh.bottomGap + 'px');
    const bl = await frameCheck('bili');
    console.log('    B站 → ' + JSON.stringify(bl));
    ck('★ B站 照旧内嵌（它允许 ✓）', bl.iframe === 1 && bl.card === 0, JSON.stringify(bl));
    /* ★★ 预览要**撑满**右栏，不能写死高度 ✗ ——
       用户原话：「怎么有一段这么大的空白，修复」。
       根因：`iframe { height:340px }` 写死 ✗，而右栏是整屏高 ✗ → 下面永远空一大片 ✗。 */
    ck('★ 预览撑满右栏（不是写死的 340px）', bl.frameH > 400, '栏高 ' + bl.bodyH + ' · 预览 ' + bl.frameH);
    ck('★ 预览下面**不留空白**', bl.bottomGap <= 2, '还剩 ' + bl.bottomGap + 'px');
    const ar = await frameCheck('arxiv');
    console.log('    arXiv → ' + JSON.stringify(ar));
    ck('★ arXiv 也走卡片（实测 SAMEORIGIN + CSP none ✗）', ar.iframe === 0 && ar.card === 1, JSON.stringify(ar));

    /* ══════════════════════════════════════════════════════════════════
       ⑨ 所有「全高页签」都不许在底部留白
       ★ 用户原话：「下面存在大量空白，修复」✓（附的截图就是**热榜**这一页 ✓）。
       根因不是热榜独有的 ✗：CSS 里那条「撑满」规则是**逐个列类名**的 ✗，
       加「热榜」时写成了 `.lw-tr` ✗✗ —— 而 **.lw-tr 早就被表格行占了** ✗
       （见 life-workbench.js 的 .lw-tr { min-height:42px } ✓），
       于是热榜的根 .lw-hl **一个都没匹配上** ✗ → 只能吃 min-height:320px ✗
       → 实测**底部空 497px** ✗✗。
       → 已改成结构性规则（.lw-main.fill > * ✓），那份会过期的类名清单整个删了 ✓。
       ⚠️ 断言要**遍历所有全高页签** ✗，不能只查热榜 ✗ ——
          原来上面那条「热榜面板填满内容区」只查热榜 ✓，
          而它就是在**加完热榜之后**写的 ✗，等于把「刚修好的那个」又验一遍 ✗，
          别的页签没人管 ✗ —— 所以这次把六个全查一遍 ✓。
       ⚠️ 放在**最后**跑 ✗ —— 中间切页签会打断热榜的状态机 ✓（还会顺带触发收信 ✗）。
       ══════════════════════════════════════════════════════════════════ */
    console.log('\n── ⑨ 所有全高页签都不许留白（.lw-main.fill > *）──');
    /* ★ 这张表要和 life-workbench.js 里的 LW_FILL_TAB 一致 ✓ ——
       ⚠️ 故意**写死在这里** ✗（不去读源码 ✗）：读源码的话，两边一起改错就永远测不出来 ✗。 */
    const FILL_TABS = ['memo', 'journal', 'mail', 'reading', 'flow', 'trends'];
    const LONG_TABS = ['today', 'quote', 'tracks', 'files'];
    const measure = () => p.evaluate(() => {
      const m = document.querySelector('.lw-main');
      if (!m) return null;
      const cs = getComputedStyle(m), mb = m.getBoundingClientRect();
      const kids = Array.from(m.children).map((e) => {
        const b = e.getBoundingClientRect();
        return { cls: (e.className || '').split(' ')[0], bottom: Math.round(b.bottom) };
      });
      return {
        fill: cs.display === 'flex',
        limit: Math.round(mb.bottom - parseFloat(cs.paddingBottom)),
        n: kids.length, kids,
      };
    });
    const goto = async (tab) => {
      await p.evaluate((t) => {
        const el = document.querySelector('.lw-nav button[data-tab="' + t + '"]');
        if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }, tab);
      await p.waitForTimeout(1300);
    };
    for (const t of FILL_TABS) {
      await goto(t);
      const r = await measure();
      if (!r) { ck('  ' + t + ' 有 .lw-main', false); continue; }
      const gap = r.n ? r.limit - Math.max(...r.kids.map((k) => k.bottom)) : 0;
      console.log('    ' + t.padEnd(8) + 'fill=' + r.fill + ' · 子元素 ' + r.n + ' 个 → '
        + r.kids.map((k) => k.cls).join(' ') + ' · 底部空 ' + gap + 'px');
      ck('★ ' + t + ' 是全高页签且**底部不留白**', r.fill && gap <= 2, '空 ' + gap + 'px');
      /* ⚠️ 结构性规则的前提：**只返回一个根元素** ✗ ——
         多一个的话它也会被 flex:1 撑开 ✗（浮层是 position:fixed ✓，不算 ✓）。 */
      ck('   ' + t + ' 只有一个根元素（> * 的前提）', r.n === 1, '有 ' + r.n + ' 个：' + r.kids.map((k) => k.cls).join(' '));
    }
    /* ★ 长列表页签**反过来**要守住：不许被撑满 ✗（撑满会把内容裁掉 ✗） */
    for (const t of LONG_TABS) {
      await goto(t);
      const r = await measure();
      if (!r) continue;
      ck('   长列表 ' + t + ' 没被 flex 撑满（撑满会裁内容）', !r.fill, 'fill=' + r.fill);
    }
    await goto('trends');      /* 切回热榜 ✓（留个和进来时一致的状态 ✓） */

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      const had = !!d.trends;
      delete d.trends;
      if (keepAiW === undefined) delete d.trendAiW; else d.trendAiW = keepAiW;
      await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const a = await store();
      console.log('\n收尾：trends 状态 ' + (had ? '已清 ✓' : '本来就没有 ✓') + ' | 现在 ' + (a.trends === undefined ? '无 ✓' : '还在 ✗')
        + ' | AI 日报宽度已还原 ' + (a.trendAiW === keepAiW ? '✓' : '✗')
        + ' | 用户备忘录 ' + (a.memos || []).length + ' 条');
    } catch (e) { console.log('\n收尾失败: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
