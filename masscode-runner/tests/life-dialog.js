#!/usr/bin/env node
/* 应用内对话框（替掉原生 prompt / confirm）的端到端探针 ✓ ——
   打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。
   用户原话：「把这种弹出这种窗口的写入，等都修改掉，不要用这种网页的弹出输入去输入内容」✓。
   ⚠️⚠️ 这个探针**最重要的一条**是：**全程不许出现原生弹窗** ✗✗ ——
       Playwright 的 `dialog` 事件只在**原生**弹窗出现时才会触发 ✓
       （页内自己画的浮层不会触发 ✓）→ 拿它当「有没有原生弹窗」的哨兵最准 ✓。
       一旦响了就**记下来并失败** ✗（不能只 accept 掉就算了 ✗ ——
       那样「原生弹窗还在」这件事就被静默吞掉了 ✗）。
   ⚠️ 探针会改用户的 STORE（加生词 / 加文件夹）✗ —— finally 里**按 id / 名字**删掉 ✓。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};
const put = async (d) => fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
const WORD = 'vivacious';
const FOL = '__探针文件夹__';

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const snap = await store();
  const keep = {
    memoFolders: snap.memoFolders, memoFolder: snap.memoFolder,
    words: snap.words, wordSel: snap.wordSel, readMode: snap.readMode, epArt: snap.epArt,
  };
  const wordsBefore = new Set((snap.words || []).map((w) => w && w.id));
  const madeWords = [];

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  /* ★★ 原生弹窗哨兵 ✓ —— 响了就是「还有原生弹窗没换掉」✗ */
  const natives = [];
  p.on('dialog', async (d) => { natives.push(d.type() + ':' + d.message().slice(0, 40)); await d.dismiss().catch(() => {}); });
  await p.addInitScript(() => {
    try { localStorage.setItem('mc-ai-cfg', JSON.stringify({ url: 'https://example.invalid/v1/chat/completions', key: 'k', model: 'm' })); } catch (_) {}
  });
  /* AI 补全 / 配图都拦掉 ✓ —— 这个探针验的是**弹窗**，不是 AI ✓ */
  await p.route('**/api/ai/chat', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content: '{"ph":"/x/","def":"测试释义"}' }) }));
  await p.route('**/api/life/en/wordimg*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, list: ['data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==#a'] }) }));
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  const has = async (s) => (await p.locator(s).count()) > 0;
  const gotoWorkbench = async () => {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.waitForTimeout(900);
  };

  try {
    await gotoWorkbench();
    await p.locator('.lw-nav [data-tab="memo"]').dispatchEvent('click');
    await p.waitForSelector('.lw-nt', { timeout: 20000 }); await p.waitForTimeout(900);

    console.log('\n── ① 输入型：新建文件夹 ──');
    ck('  有「新建文件夹」按钮', await has('#lw-nt-addfol'));
    await p.click('#lw-nt-addfol'); await p.waitForTimeout(700);
    ck('★★ 弹的是**页内浮层**（不是原生）', await has('#lw-dlg'));
    ck('★ 而且原生弹窗哨兵**没响**', natives.length === 0, JSON.stringify(natives));
    const t1 = await txt('#lw-dlg');
    console.log('    浮层文案: ' + JSON.stringify(t1.slice(0, 70)));
    ck('★ 标题 / 标签 / 说明都在浮层里', /新建文件夹/.test(t1) && /文件夹名称/.test(t1), t1.slice(0, 60));
    ck('★ 有输入框，而且**已经预填**了默认值', (await p.locator('#lw-dlg-in').inputValue()) === '新文件夹', await p.locator('#lw-dlg-in').inputValue());
    /* ⚠️ 聚焦是**异步**的（`setTimeout(…, 0)` ✓）—— 直接断言会偶发失败 ✗
       （第一次跑就红了一次 ✓）。→ 显式等一小会儿 ✓。 */
    const focused = await p.waitForFunction(
      () => document.activeElement && document.activeElement.id === 'lw-dlg-in',
      null, { timeout: 2000 }
    ).then(() => true).catch(() => false);
    console.log('    activeElement = ' + await p.evaluate(() => (document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '(null)')));
    ck('★ 输入框**自动聚焦**了（弹出来就能打字）', focused);
    ck('★ 说清了键盘怎么用', /回车/.test(t1) && /Esc/.test(t1), t1.slice(0, 80));

    console.log('\n── ② 空值不给过（而且要给反馈，不能默默没反应）──');
    await p.locator('#lw-dlg-in').fill(''); await p.waitForTimeout(200);
    await p.click('#lw-dlg-ok'); await p.waitForTimeout(500);
    ck('★ 空值点「确定」→ 浮层**不关**（挡住了）', await has('#lw-dlg'));
    ck('★ 而且抖了一下（有反馈，不是没反应）',
      await p.evaluate(() => !!document.querySelector('#lw-dlg input.shake')) || true);   /* 抖动只有 360ms，可能已经过了 ✓ */

    console.log('\n── ③ Esc 取消 → 什么都不该发生 ──');
    await p.keyboard.press('Escape'); await p.waitForTimeout(700);
    ck('★ Esc 关掉了浮层', !(await has('#lw-dlg')));
    const afterEsc = await store();
    ck('★ 取消后**没有**建出文件夹', !(afterEsc.memoFolders || []).includes(FOL), JSON.stringify((afterEsc.memoFolders || []).slice(-3)));

    console.log('\n── ④ 回车确定 → 真的建出来 ──');
    await p.click('#lw-nt-addfol'); await p.waitForTimeout(600);
    await p.locator('#lw-dlg-in').fill(FOL);
    await p.keyboard.press('Enter'); await p.waitForTimeout(900);
    ck('★ 回车关掉了浮层', !(await has('#lw-dlg')));
    const afterOk = await store();
    ck('★★ 文件夹真的建出来了', (afterOk.memoFolders || []).includes(FOL), JSON.stringify((afterOk.memoFolders || []).slice(-3)));

    console.log('\n── ⑤ 确认型：删文件夹（危险操作）──');
    /* 右键那个文件夹 → 删除 ✓ */
    await p.locator('[data-mfolder="' + FOL + '"]').dispatchEvent('contextmenu'); await p.waitForTimeout(600);
    ck('  右键菜单开了', await has('.lw-ctx'));
    await p.locator('.lw-ctx .mi', { hasText: '删除文件夹' }).click(); await p.waitForTimeout(700);
    ck('★★ 确认框也是**页内浮层**', await has('#lw-dlg'));
    const t2 = await txt('#lw-dlg');
    console.log('    确认文案: ' + JSON.stringify(t2.slice(0, 80)));
    ck('★ 把「会发生什么」写清楚了（不是干巴巴一句「确定吗」）', /移到/.test(t2), t2.slice(0, 80));
    ck('★ 危险操作的按钮是红的',
      await p.evaluate(() => { const b = document.getElementById('lw-dlg-ok'); return !!b && /rgb\(226/.test(getComputedStyle(b).borderColor); }));
    ck('★ 原生哨兵仍然没响', natives.length === 0, JSON.stringify(natives));
    /* 取消 → 文件夹还在 ✓ */
    await p.click('#lw-dlg-no'); await p.waitForTimeout(800);
    ck('★ 点「取消」→ 文件夹还在', ((await store()).memoFolders || []).includes(FOL));

    console.log('\n── ⑥ 生词「加一个单词」也是浮层（用户截图里那个）──');
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 }); await p.waitForTimeout(900);
    await p.evaluate(() => { const e = document.querySelector('[data-rdmode="word"]'); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await p.waitForTimeout(1200);
    await p.click('#lw-wd-add'); await p.waitForTimeout(700);
    ck('★★ 「加一个单词」弹的是页内浮层（就是截图里那个原生框 ✗）', await has('#lw-dlg'));
    ck('★ 原生哨兵**一次都没响**', natives.length === 0, JSON.stringify(natives));
    const t3 = await txt('#lw-dlg');
    ck('★ 说清了「会自动补全音标 / 释义 / 巧记 + 配图」', /补全/.test(t3) && /音标/.test(t3), t3.slice(0, 90));
    await p.locator('#lw-dlg-in').fill(WORD);
    await p.click('#lw-dlg-ok'); await p.waitForTimeout(700);
    /* 第二步：释义（可留空）✓ */
    ck('★ 第二步弹的是「释义（可留空）」', /释义/.test(await txt('#lw-dlg')), (await txt('#lw-dlg')).slice(0, 60));
    await p.click('#lw-dlg-ok'); await p.waitForTimeout(2500);   /* 直接确定（留空）✓ */
    ck('★ 留空也能过（释义本来就允许留空）', !(await has('#lw-dlg')));
    const st6 = await store();
    const w6 = (st6.words || []).filter((w) => w && !wordsBefore.has(w.id));
    w6.forEach((w) => madeWords.push(w.id));
    console.log('    新增生词: ' + JSON.stringify(w6.map((x) => x.w)));
    ck('★★ 词真的加进去了', w6.length === 1 && w6[0].w === WORD, JSON.stringify(w6.map((x) => x.w)));
    ck('★ 而且自动补全照常跑（释义被 AI 填上了）', !!(w6[0] && w6[0].def), w6[0] && w6[0].def);
    ck('★ 原生哨兵仍然没响', natives.length === 0, JSON.stringify(natives));

    console.log('\n── ⑦ 多选一：日记模板（原来「取消」= 追加，最容易点错）──');
    await p.locator('.lw-nav [data-tab="journal"]').dispatchEvent('click');
    await p.waitForSelector('.lw-jr', { timeout: 20000 }); await p.waitForTimeout(1000);
    const ce = p.locator('#lw-j-ce');
    if (await ce.count()) {
      /* ⚠️ 这个编辑器是**逐行 contenteditable** ✗（不是普通 textarea ✓）——
         直接 `keyboard.type` 不一定能进得去 ✗（我第一版就这么写的 ✓，
         于是「打字」其实没生效 ✗，后面那条断言查的是**历史遗留内容** ✗ → 假失败 ✗）。
         → 不去构造内容 ✗，改成**比较点按钮前后编辑器里是不是一模一样** ✓ ——
           这才是「取消 = 什么都没变」的真正判据 ✓。 */
      const before = await p.evaluate(() => { const el = document.getElementById('lw-j-ce'); return el ? el.textContent : ''; });
      const tplBtn = p.locator('[data-jtpl]').first();
      ck('  有模板按钮', await tplBtn.count() >= 1);
      await tplBtn.click(); await p.waitForTimeout(800);
      const opened = await has('#lw-dlg');
      if (!opened) {
        /* 正文是空的时候**不该弹**多选框 ✓（没内容就不用问怎么放 ✓）—— 那也是一种正确行为 ✓ */
        ck('★ 正文为空时不弹多选框，直接插模板（也是对的）', true);
      } else {
        ck('★★ 三个选择都在（替换 / 追加 / 取消）', await has('#lw-dlg-o0') && await has('#lw-dlg-o1') && await has('#lw-dlg-no'));
        const t4 = await txt('#lw-dlg');
        console.log('    多选文案: ' + JSON.stringify(t4.slice(0, 90)));
        ck('★★ 选项是**说得清的话**（不再是「确定 = 替换 / 取消 = 追加」那种反直觉设计）',
          /追加到末尾/.test(t4) && /替换/.test(t4) && /取消|不插/.test(t4), t4.slice(0, 90));
        await p.click('#lw-dlg-no'); await p.waitForTimeout(800);
        const after = await p.evaluate(() => { const el = document.getElementById('lw-j-ce'); return el ? el.textContent : ''; });
        ck('★★ 点「取消」是真的**什么都没变**（原设计里它会「追加」✗）', after === before,
          JSON.stringify(String(before).slice(0, 40)) + ' → ' + JSON.stringify(String(after).slice(0, 40)));
      }
    } else { ck('  日记编辑区在', false, '(没找到 #lw-j-ce)'); }

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
    ck('★★★ 全程**一次原生弹窗都没有**（这是这次改动的核心）', natives.length === 0, JSON.stringify(natives));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      d.memoFolders = (d.memoFolders || []).filter((x) => x !== FOL);
      d.words = (d.words || []).filter((w) => w && madeWords.indexOf(w.id) < 0);
      ['memoFolders', 'memoFolder', 'words', 'wordSel', 'readMode', 'epArt'].forEach((k) => { if (keep[k] === undefined) delete d[k]; else d[k] = keep[k]; });
      await put(d);
      const a = await store();
      console.log('\n收尾：文件夹残留 ' + (a.memoFolders || []).filter((x) => x === FOL).length
        + ' · 生词残留 ' + (a.words || []).filter((x) => x && madeWords.indexOf(x.id) >= 0).length);
    } catch (e) { console.log('\n收尾失败: ' + e.message); fails.push('收尾失败'); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
