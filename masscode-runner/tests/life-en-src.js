#!/usr/bin/env node
/* 外刊精读「推荐源」的端到端探针 ✓ —— 打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。
   ⚠️ 它会**真的导入一篇文章**到用户的 STORE ✗ —— 所以 finally 里按 id 删掉自己加的那篇 ✓
      （⚠️ 不能按名字删 ✗：用户可能自己也有同名文章 ✗）。 */
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

  const before = await store();
  const artIdsBefore = new Set((before.articles || []).map((a) => a && a.id));
  const madeIds = [];

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 }); await p.waitForTimeout(1200);

    /* 进外刊精读模式（模式是落盘的 ✓ —— 上次可能是书架 ✓） */
    await p.evaluate(() => {
      const el = document.querySelector('[data-rdmode="ex"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await p.waitForTimeout(1500);

    console.log('\n── ① 双栖模块加载 + 入口 ──');
    const mod = await p.evaluate(() => ({
      src: !!(window.LW_EN_SOURCES),
      n: (window.LW_EN_SOURCES && window.LW_EN_SOURCES.catalog().length) || 0,
      os: (window.LW_EN_SOURCES && window.LW_EN_SOURCES.OS_RESOURCES.length) || 0,
    }));
    console.log('    window.LW_EN_SOURCES = ' + JSON.stringify(mod));
    ck('★ /lib/en-sources.js 在浏览器里挂上了', mod.src === true);
    ck('  目录有 24 个源', mod.n === 24, String(mod.n));
    ck('  开源资源有 11 个', mod.os === 11, String(mod.os));
    ck('中栏有「🌐 挑一篇」按钮', await p.locator('#lw-ep-src').count() === 1);
    ck('左栏有「推荐外刊源」入口', await p.locator('[data-epsrcopen="web"]').count() === 1);
    ck('左栏有「开源资源」入口', await p.locator('[data-epsrcopen="os"]').count() === 1);
    ck('★ 空态里有个**能点的大按钮**（不是只写一句「点上面」）',
      await p.locator('#lw-ep-src2').count() === 1 || await p.locator('#lw-ep-src3').count() === 1);
    const sideTxt = await txt('.lw-rd-side');
    ck('左栏写着「推荐外刊源」', /推荐外刊源/.test(sideTxt), sideTxt.slice(0, 60));
    ck('左栏写着「开源资源」', /开源资源/.test(sideTxt));

    console.log('\n── ② 打开面板：**自动拉第一个源**（不用再点一下）──');
    await p.click('#lw-ep-src');
    await p.waitForSelector('#lw-epsrc', { timeout: 15000 });
    ck('浮层开了', await p.locator('#lw-epsrc').count() === 1);
    ck('★ 两个页签都在（在线外刊源 / 开源资源）',
      await p.locator('[data-epsrctab="web"]').count() === 1 && await p.locator('[data-epsrctab="os"]').count() === 1);
    /* 等自动加载出条目 ✓（curl 通道下第一个源 ~1.4s ✓） */
    await p.waitForSelector('[data-epsrcit]', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(600);
    const nItems = await p.locator('[data-epsrcit]').count();
    console.log('    自动拉到 ' + nItems + ' 条');
    ck('★★ 一打开就自动拉好了（用户不用再点一下）', nItems > 0, nItems + ' 条');
    const head = await txt('.lw-epsrc-hd');
    console.log('    源信息: ' + JSON.stringify(head.slice(0, 70)));
    ck('★ 顶部写清了是哪个源 + 难度 + 条数', /篇/.test(head) && head.length > 4, head.slice(0, 60));
    const firstTitle = await txt('.lw-epsrc-it');
    ck('★ 列出来的是**真文章标题**（不是站点首页 / 站名）', firstTitle.length > 12, firstTitle.slice(0, 60));
    /* ⚠️ 那个「抓到站点首页」的坑的正面断言 ✗ */
    const titles = await p.locator('.lw-epsrc-it .ti').allInnerTexts();
    ck('★★ 标题里没有「站点名」那种（Atom 首页陷阱）',
      titles.every((t) => !/^(Aeon|WIRED|Quanta Magazine|Nautilus|Our World in Data|Psyche|MIT Technology Review|Home|Homepage)$/i.test(t.trim())),
      JSON.stringify(titles.slice(0, 3)));

    console.log('\n── ③ 换一个源 ──');
    const keys = await p.locator('[data-epsrc]').evaluateAll((els) => els.map((e) => e.dataset.epsrc));
    console.log('    左栏有 ' + keys.length + ' 个源');
    ck('★ 左栏列出了全部 24 个源', keys.length === 24, String(keys.length));
    ck('★ 分了组（不是一长条）', await p.locator('.lw-epsrc-g').count() >= 6, String(await p.locator('.lw-epsrc-g').count()));
    const target = keys.indexOf('aeon') >= 0 ? 'aeon' : keys[keys.length - 1];
    await p.locator('[data-epsrc="' + target + '"]').click();
    await p.waitForFunction(() => !document.querySelector('.lw-epsrc-tip') || !/正在拉/.test(document.querySelector('.lw-epsrc-tip').textContent || ''), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(800);
    const n2 = await p.locator('[data-epsrcit]').count();
    console.log('    切到 ' + target + ' 后 ' + n2 + ' 条');
    ck('★ 换源能拉到（不是只认第一个）', n2 > 0, n2 + ' 条');
    ck('  选中态跟着走', await p.locator('[data-epsrc="' + target + '"].on').count() === 1);

    console.log('\n── ④ 点一条 → 真的导进精读 ──');
    const artBefore = ((await store()).articles || []).length;
    await p.locator('[data-epsrcit]').first().click();
    /* 等浮层关掉（导入成功就会关 ✓） */
    await p.waitForFunction(() => !document.getElementById('lw-epsrc'), null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(1500);
    ck('★ 导入成功后浮层自动关掉（不关用户以为没成功）', await p.locator('#lw-epsrc').count() === 0);
    const after = await store();
    const arts = after.articles || [];
    const fresh = arts.filter((a) => a && !artIdsBefore.has(a.id));
    fresh.forEach((a) => madeIds.push(a.id));
    console.log('    文章数 ' + artBefore + ' → ' + arts.length + '；新增 ' + fresh.length + ' 篇');
    ck('★★ 真的写进精读文章列表了', fresh.length === 1, JSON.stringify(fresh.map((a) => a.title)));
    if (fresh[0]) {
      const a = fresh[0];
      console.log('    《' + String(a.title).slice(0, 50) + '》 ' + a.words + ' 词 · ' + a.level + ' · ' + a.site);
      ck('★ 正文抽出来了（不是空壳）', Number(a.words) > 120, String(a.words) + ' 词');
      ck('★ 难度算出来了', !!a.level, a.level);
      ck('★ 记下了来源站', !!a.site, a.site);
      ck('★ 记下了原文链接', /^https:\/\//.test(a.url || ''), a.url);
    }
    ck('★ 状态切到外刊精读（不是留在书架）', await p.locator('.lw-ep-s').count() > 0, String(await p.locator('.lw-ep-s').count()));

    console.log('\n── ⑤ 开源资源页签 ──');
    await p.click('#lw-ep-src'); await p.waitForSelector('#lw-epsrc', { timeout: 15000 });
    await p.locator('[data-epsrctab="os"]').click(); await p.waitForTimeout(900);
    ck('★ 切到开源资源', await p.locator('.lw-os').count() >= 6, String(await p.locator('.lw-os').count()));
    const osTxt = await txt('.lw-epsrc-one');
    ck('★ 列了 awesome-english-ebooks（那个 3.7 万星的）', /awesome-english-ebooks/.test(osTxt));
    ck('★ 也列了别的（教材 / 背单词 / 资源清单…）', /NCE|qwerty|learning-english/.test(osTxt));
    ck('★★ 归档类资源**带版权提示**（不能装作没这回事）', /版权/.test(osTxt), osTxt.slice(0, 80));
    ck('★ 每个都给了 GitHub 链接', await p.locator('.lw-os a[href^="https://github.com/"]').count() >= 6,
      String(await p.locator('.lw-os a[href^="https://github.com/"]').count()));
    const tags = await p.locator('[data-epostag]').evaluateAll((els) => els.map((e) => e.dataset.epostag));
    console.log('    分类: ' + JSON.stringify(tags));
    ck('★ 有分类筛选', tags.length >= 3, JSON.stringify(tags));
    await p.locator('[data-epostag="教材"]').click(); await p.waitForTimeout(700);
    ck('  筛选生效（只剩教材类）', await p.locator('.lw-os').count() >= 1 && await p.locator('.lw-os').count() < 11,
      String(await p.locator('.lw-os').count()));

    console.log('\n── ⑥ 关掉 / Escape ──');
    await p.keyboard.press('Escape'); await p.waitForTimeout(700);
    ck('★ Escape 能关掉浮层', await p.locator('#lw-epsrc').count() === 0);
    await p.click('#lw-ep-src'); await p.waitForSelector('#lw-epsrc', { timeout: 15000 });
    await p.click('#lw-epsrc-x'); await p.waitForTimeout(700);
    ck('✕ 也能关掉', await p.locator('#lw-epsrc').count() === 0);
    /* ⚠️ 关掉再开，**不能重新拉一遍** ✗ —— 缓存过的要秒开 ✓（TTL 15~60 分钟 ✓） */
    const t0 = Date.now();
    await p.click('#lw-ep-src'); await p.waitForSelector('[data-epsrcit]', { timeout: 20000 });
    const ms = Date.now() - t0;
    console.log('    再开一次耗时 ' + ms + 'ms');
    ck('★ 再打开是**秒开**（走了缓存，没重新打人家）', ms < 3000, ms + 'ms');
    await p.click('#lw-epsrc-x'); await p.waitForTimeout(500);

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message + '\n' + String(e.stack).split('\n').slice(1, 4).join('\n'));
    fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      const before2 = (d.articles || []).length;
      d.articles = (d.articles || []).filter((a) => a && madeIds.indexOf(a.id) < 0);
      /* ⚠️ 生词也一起清 ✗ —— 导入文章会带出「当前文章」，但不加词 ✓；
         保险起见把 artId 指向被删文章的也清掉 ✓（免得留孤儿） */
      d.words = (d.words || []).filter((w) => w && madeIds.indexOf(w.artId) < 0);
      d.artNotes = (d.artNotes || []).filter((n) => n && madeIds.indexOf(n.artId) < 0);
      if (madeIds.indexOf(d.epArt) >= 0) delete d.epArt;
      await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const a = await store();
      console.log('\n收尾：文章 ' + before2 + '→' + (a.articles || []).length
        + ' · 残留探针文章 ' + (a.articles || []).filter((x) => x && madeIds.indexOf(x.id) >= 0).length);
    } catch (e) { console.log('\n收尾失败: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
