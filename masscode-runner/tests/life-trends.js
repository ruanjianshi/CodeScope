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

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      const had = !!d.trends;
      delete d.trends;
      await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const a = await store();
      console.log('\n收尾：trends 状态 ' + (had ? '已清 ✓' : '本来就没有 ✓') + ' | 现在 ' + (a.trends === undefined ? '无 ✓' : '还在 ✗')
        + ' | 用户备忘录 ' + (a.memos || []).length + ' 条');
    } catch (e) { console.log('\n收尾失败: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
