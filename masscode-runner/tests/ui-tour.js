#!/usr/bin/env node
/**
 * 模拟正常人的点击巡游
 * ---------------------------------------------------------------------------
 * 为什么要有这个 ✗：别的探针都是**盯住某一个功能深挖** ✓，
 * 于是「某个入口点下去就报错」「某个面板打不开」这类**整体性**的问题
 * 反而没人管 ✗ —— 因为没人会**把所有入口挨个点一遍** ✓。
 *
 * 这里就干一件事：**像人一样把能点的地方点一遍** ✓，然后看：
 *   ① 有没有 pageerror（JS 报错）✗
 *   ② 该打开的有没有打开 ✗
 *   ③ 有没有点下去毫无反应 / 卡住 ✗
 *
 * ⚠️ 只读 ✓ —— 不改任何数据 ✓（打开面板、切页签、看一圈就关掉 ✓）。
 * ⚠️ 每个面板打开后要**真的等一会儿** ✗ —— 异步渲染没回来就断言 = 假失败 ✓。
 *
 * 运行：node tests/ui-tour.js
 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.env.CODESCOPE_BASE || 'http://127.0.0.1:4877';
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));

const fails = [];
const ck = (name, ok, detail) => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  → ' + detail : ''));
  if (!ok) fails.push(name);
};

(async () => {
  const b = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160)); });
  const errAt = (label) => { if (errs.length) { console.log('    ⚠️ 到「' + label + '」为止的报错: ' + errs.slice(0, 2).join(' | ')); } };

  try {
    console.log('── ① 打开首页 ──');
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { try { return Array.isArray(SNIPPETS) && SNIPPETS.length > 0; } catch (_) { return false; } }, null, { timeout: 40000 });
    await p.waitForTimeout(2500);
    ck('首页起来了（SNIPPETS 有内容）', await p.evaluate(() => SNIPPETS.length > 0));
    ck('首屏没有 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

    console.log('\n── ② 顶栏按钮挨个点 ──');
    const topBtns = await p.evaluate(() => [...document.querySelectorAll('header button, header a.btn, .top button')]
      .map((el) => el.id || (el.textContent || '').trim().slice(0, 12))
      .filter((x) => x && !/^$/.test(x)));
    console.log('    顶栏上能看到 ' + topBtns.length + ' 个按钮');
    /* ⚠️ 只点「开关面板」这类安全的 ✓ —— 不点「删除 / 重启 / 运行」这种有副作用的 ✗。
       ⚠️ `#btn-study` **不在**这里 ✗ —— 它的入口已经收进次级菜单了 ✓，
          点了不会有反应 ✓（放在这儿会变成一条「看着在测、其实测不到」的断言 ✓）。 */
    const SAFE = ['btn-env', 'btn-remote', 'btn-project', 'btn-lifework', 'btn-manual', 'btn-outline', 'btn-symbols', 'btn-preview', 'btn-editor-layout', 'btn-backlinks', 'btn-codegraph'];
    for (const id of SAFE) {
      const el = p.locator('#' + id);
      if (!(await el.count())) continue;
      const before = errs.length;
      await el.click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(900);
      /* 再点一次关掉 ✓（开关型）*/
      await el.click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(500);
      const bad = errs.length - before;
      ck('#' + id + ' 点得动、且开关正常', bad === 0, bad ? errs.slice(before, before + 2).join(' | ') : '');
    }

    console.log('\n── ③ 左栏 6 个面板 ──');
    /* ⚠️ 左栏不是「页签」✗ —— 那 6 个面板是**常驻堆叠**的（可以拖拽换位 ✓，
       顺序存在 localStorage ✓）。所以这里断言的是「都在、都有内容」✓，
       而不是「点一下切过去」✗（第一版就是按页签写的 ✓，结果全 skip 了 ✓）。 */
    {
      const panes = await p.evaluate(() => ['pane-tree', 'pane-git', 'pane-tags', 'pane-draw', 'pane-office', 'pane-reading']
        .map((id) => { const el = document.getElementById(id); return { id, has: !!el, h: el ? Math.round(el.getBoundingClientRect().height) : 0 }; }));
      panes.forEach((x) => ck('左栏面板 ' + x.id + ' 在、且有高度', x.has && x.h > 10, JSON.stringify(x)));
    }

    console.log('\n── ④ 打开一个文件、编辑器要起来 ──');
    await p.evaluate(() => { try { const s = SNIPPETS[0]; if (s) { select(s); renderMain(); } } catch (_) {} });
    await p.waitForTimeout(3000);
    ck('编辑器起来了（Monaco 有内容）', await p.evaluate(() => {
      try { return !!MONACO_EDITOR && MONACO_EDITOR.getValue().length > 0; } catch (_) { return false; }
    }));

    console.log('\n── ⑤ 学习工作台：走真实入口 → 三个窗格 → 关掉 ──');
    /* ⚠️ 入口**不在** `#btn-study` ✗ —— 它已经收进次级菜单了 ✓（见 browser-smoke 的注释 ✓）。
       走真实路径：`#workspace-launch-more` → `#workspace-launch-study` ✓。 */
    {
      const before = errs.length;
      await p.locator('#workspace-launch-more').click({ timeout: 8000 });
      await p.waitForTimeout(500);
      await p.locator('#workspace-launch-study').click({ timeout: 8000 });
      await p.waitForSelector('#study-workspace', { state: 'visible', timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(2500);
      const kinds = await p.evaluate(() => [...document.querySelectorAll('#study-layout .study-pane')].map((n) => n.dataset.kind));
      ck('学习工作台打开、三栏都在', ['browser', 'code', 'notes'].every((k) => kinds.includes(k)), JSON.stringify(kinds));
      await p.locator('#workspace-launch-more').click({ timeout: 8000 });
      await p.waitForTimeout(500);
      await p.locator('#workspace-launch-study').click({ timeout: 8000 });
      await p.waitForTimeout(1200);
      ck('学习工作台能关掉，且没报错', errs.length === before, errs.slice(before, before + 2).join(' | '));
    }

    console.log('\n── ⑥ 个人管理面板：每个页签点一遍 ──');
    {
      const before = errs.length;
      await p.locator('#btn-lifework').click({ timeout: 8000 }).catch(() => {});
      await p.waitForSelector('#lifework-view', { timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(2000);
      ck('个人管理面板打开了', await p.locator('#lifework-view').count() > 0);
      const tabs = await p.evaluate(() => [...document.querySelectorAll('.lw-nav [data-tab]')].map((n) => n.dataset.tab));
      console.log('    页签 ' + tabs.length + ' 个: ' + tabs.join(' '));
      for (const t of tabs) {
        const n0 = errs.length;
        await p.locator('.lw-nav [data-tab="' + t + '"]').dispatchEvent('click').catch(() => {});
        await p.waitForTimeout(1600);
        const body = await p.evaluate(() => (document.querySelector('.lw-main') || {}).innerText || '');
        /* ⚠️⚠️ 断言要**认「空态」** ✗✗ —— 有些页签在**没有数据**时显示的是空态文案 ✓
           （实测：「追更」在云端实例上是「▢ 还没扫到项目」✓ ——
            那是**正常渲染** ✓，不是 bug ✗；本地有数据才是 979 字的卡片 ✓）。
           → 只要求「**渲染出了东西**」✓（空态文案也算 ✓），不要求「内容多」✗ ——
             原来写 `> 10` ✗，把云端那个 8 字的空态判成了失败 ✓。 */
        ck('页签「' + t + '」渲染出了内容', body.trim().length > 3 && errs.length === n0,
          (body.trim().length <= 3 ? '内容是空的' : '') + (errs.length > n0 ? errs.slice(n0, n0 + 1).join(' | ') : ''));
      }
      await p.locator('#btn-lifework').click({ timeout: 8000 }).catch(() => {});
      await p.waitForTimeout(800);
      ck('个人管理面板能关掉', errs.length === before, errs.slice(before, before + 2).join(' | '));
    }

    console.log('\n── ⑦ 代码向导：⌘I → 三个页签 → 关掉 ──');
    {
      const before = errs.length;
      await p.keyboard.press('Meta+i');
      await p.waitForTimeout(2200);
      ck('⌘I 能唤出代码向导', await p.locator('#cgx-box').count() > 0);
      for (const t of ['look', 'find', 'break']) {
        const n0 = errs.length;
        await p.locator('[data-cgtab="' + t + '"]').click().catch(() => {});
        await p.waitForTimeout(2000);
        ck('代码向导页签「' + t + '」点得动', errs.length === n0, errs.slice(n0, n0 + 1).join(' | '));
      }
      await p.locator('#cgx-hist').click().catch(() => {});
      await p.waitForTimeout(800);
      ck('「🕘 查阅历史」打得开', await p.locator('.cg-hist').count() > 0);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(700);
      ck('代码向导能关掉', errs.length === before, errs.slice(before, before + 2).join(' | '));
    }

    console.log('\n── ⑧ 使用手册页 ──');
    {
      const before = errs.length;
      await p.goto(BASE + '/manual/', { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(2200);
      ck('手册页打开了（有章节）', await p.locator('section.doc').count() >= 18, String(await p.locator('section.doc').count()));
      ck('手册页没有报错', errs.length === before, errs.slice(before, before + 2).join(' | '));
    }

    console.log('\n── ⑨ 收尾：全程报错汇总 ──');
    ck('★ 整趟巡游**一个 JS 报错都没有**', errs.length === 0, errs.slice(0, 4).join(' | '));
  } catch (e) {
    fails.push('异常:' + e.message);
    console.log('\n✗ 异常: ' + e.message);
  } finally {
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})();
