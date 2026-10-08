#!/usr/bin/env node
/* 🖱 编辑器右键菜单（跳转到定义 / 速览定义 / 查看引用）的端到端探针 ✓
   —— 打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。

   ★ 用户原话（2026-10-08）：
     「这种右键缺少，跳转到定义的功能，类似 vscode 那样」✓

   ⚠️⚠️ 为什么原来没有 ✗：Monaco 那几条**内置**导航菜单项
      （Go to Definition / Peek / Go to References ✓，注册在
      `contrib/gotoSymbol/goToCommands.js` 的 `MenuId.EditorContext` 里 ✓）
      **只在注册了 `registerDefinitionProvider` 之后才出现** ✓ ——
      而这个项目**一个都没注册** ✗ → 右键里只剩 Rename / Cut / Copy / Paste ✗。
   ⚠️ 为什么不去注册一个 DefinitionProvider ✗：Monaco 的「转到定义」是
      **在同一个 model 里跳** ✓，而 LSP 的定义经常在**另一个文件 / 片段** ✓
      （本探针用的例子就是：`main.cpp` 里调 `add` ✓，定义在 `calc.hpp` ✓）→
      注册了照样跳不过去 ✗，还会和页面自己的 `goToLocation()` 打架 ✗。
      → 用 `addAction` 自己挂菜单项 ✓，回调走 `goToLspDefinition()` ✓。

   ⚠️⚠️ 这个探针**只读** ✗ —— 只动光标位置和面板，**不改任何代码** ✓
      （所以不需要像 code-guide 那样备份还原 ✓）。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';

/* 确定性用例 ✓：main.cpp 第 9 行 `cout << "sum = " << add(x, y)` ✓，
   而 `add` 的**定义在另一个片段**（calc.hpp 第 5 行 ✓）——
   这正是 Monaco 内置「转到定义」做不到的那种 ✓，也是最能说明问题的一种 ✓。 */
const FILE = '多文件示例_CPP.md';
const FROM = { frag: 0, line: 9, col: 24 };     /* main.cpp 里那个 `add` ✓ */
const TO = { frag: 1, line: 5 };                /* calc.hpp 里的定义 ✓ */

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1100 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  const has = async (s) => (await p.locator(s).count()) > 0;
  const pos = () => p.evaluate(() => { try { return { frag: CINDEX, line: MONACO_EDITOR.getPosition().lineNumber }; } catch (_) { return null; } });
  /* ⚠️⚠️ Monaco 的右键菜单在 **shadow DOM** 里 ✗✗ ——
     `document.querySelectorAll('*')` **看不到它** ✓
     （实测：dump 全是空 ✓，而截图里菜单明明在 ✓）→ 必须**穿透 shadow root** ✓。 */
  const menuItems = () => p.evaluate(() => {
    const roots = [document];
    Array.from(document.querySelectorAll('*')).forEach((e) => { if (e.shadowRoot) roots.push(e.shadowRoot); });
    for (const r of roots) {
      const items = r.querySelectorAll('.monaco-menu .action-item');
      if (items.length) return Array.from(items).map((e) => String(e.innerText || '').replace(/\s+/g, ' ').trim());
    }
    return [];
  });
  const openMenu = async () => {
    const box = await p.evaluate((a) => {
      try {
        MONACO_EDITOR.setPosition({ lineNumber: a.line, column: a.col });
        MONACO_EDITOR.revealLineInCenter(a.line);
        /* ⚠️⚠️ 点**这个词的首字符** ✗✗ —— 第一版写的是 `vp.left + 26` ✓
           （想往右挪一点避开行首 ✓），结果挪过头 **3 个字符** ✓ →
           右键落在了 `x, y` 的 `x` 上 ✗ → 跳转跳到了 `int x, y;` 那行 ✓
           （断言红的是「没跳到另一个片段」✗，而真因是**我点错了词**✗）。
           → 用 `getWordAtPosition` 拿词的**起始列** ✓，再往右偏 4px 落在首字符里 ✓。 */
        const w = MONACO_EDITOR.getModel().getWordAtPosition({ lineNumber: a.line, column: a.col });
        const col = w ? w.startColumn : a.col;
        const vp = MONACO_EDITOR.getScrolledVisiblePosition({ lineNumber: a.line, column: col });
        const r = MONACO_EDITOR.getDomNode().getBoundingClientRect();
        return { x: r.left + vp.left + 4, y: r.top + vp.top + vp.height / 2, word: w && w.word };
      } catch (_) { return null; }
    }, FROM);
    if (!box) return false;
    await p.waitForTimeout(700);
    await p.mouse.click(Math.round(box.x), Math.round(box.y), { button: 'right' });
    await p.waitForTimeout(900);
    return box.word || true;
  };
  const clickItem = async (re) => {
    /* ⚠️⚠️ **不能**在 `evaluate` 里 `el.click()` ✗✗ —— 实测点了没反应 ✓
       （菜单**不关**、动作**不跑** ✓）。Monaco 的菜单项是拿
       `mousedown` / `pointerdown` 之类的事件驱动的 ✓，合成 click 到不了 ✓。
       → 先拿到它的**屏幕坐标** ✓，再用 Playwright 的**真实鼠标**点 ✓。
       ⚠️ 坐标要从 **shadow root 里**取 ✗（`document.querySelector` 看不到它 ✓）。 */
    const box = await p.evaluate((src) => {
      const roots = [document];
      Array.from(document.querySelectorAll('*')).forEach((e) => { if (e.shadowRoot) roots.push(e.shadowRoot); });
      const rx = new RegExp(src);
      for (const r of roots) {
        const items = Array.from(r.querySelectorAll('.monaco-menu .action-item'));
        const hit = items.find((e) => rx.test(String(e.innerText || '')));
        if (hit) {
          const b = hit.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
      }
      return null;
    }, re.source);
    if (!box) return false;
    await p.mouse.click(Math.round(box.x), Math.round(box.y));
    await p.waitForTimeout(1900);
    return true;
  };

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { try { return Array.isArray(SNIPPETS) && SNIPPETS.length > 0; } catch (_) { return false; } }, null, { timeout: 25000 });
    const opened = await p.evaluate((f) => {
      const s = SNIPPETS.find((x) => String(x.file).endsWith(f));
      if (!s) return false;
      CINDEX = 0; select(s); CINDEX = 0; renderMain();
      return true;
    }, FILE);
    await p.waitForTimeout(5200);
    console.log('用例：《' + FILE + '》片段 ' + FROM.frag + ' 第 ' + FROM.line + ' 行的 add → 定义在片段 ' + TO.frag + ' 第 ' + TO.line + ' 行');

    console.log('\n── ① 右键菜单里有「跳转到定义」吗（用户原话「这种右键缺少」）──');
    ck('  打开了那个文件', opened === true);
    ck('  编辑器起来了（Monaco）', await p.evaluate(() => { try { return !!MONACO_EDITOR; } catch (_) { return false; } }));
    await openMenu();
    const items = await menuItems();
    console.log('    菜单项: ' + JSON.stringify(items));
    ck('★★★ 右键菜单里有「跳转到定义」', items.some((t) => /跳转到定义/.test(t)), JSON.stringify(items));
    /* ⚠️ 位置也要对 ✗ —— 用户说的是「类似 vscode 那样」✓，
       VS Code 里这条就在**最上面** ✓（内置导航项用的就是 `navigation` 这个组 ✓）。 */
    ck('★★ 而且排在**最前面**（和 VS Code 一致，不是埋在 Cut/Copy 下面）',
      items.length > 0 && /跳转到定义/.test(items[0]), JSON.stringify(items.slice(0, 3)));
    ck('★ 有「速览定义」（不离开当前文件先看一眼）', items.some((t) => /速览定义/.test(t)), JSON.stringify(items));
    ck('★ 有「查看引用」', items.some((t) => /查看引用/.test(t)), JSON.stringify(items));
    ck('★ 有「用代码向导查这个符号」（和代码向导串起来）', items.some((t) => /代码向导/.test(t)), JSON.stringify(items));
    ck('★ 原来的 Rename / Cut / Copy 还在（没把 Monaco 自带的挤掉）',
      items.some((t) => /Rename Symbol/.test(t)) && items.some((t) => /Copy/.test(t)), JSON.stringify(items));

    console.log('\n── ② 点「跳转到定义」—— 真的跳过去（而且**跨片段**）──');
    const before = await pos();
    const hit = await clickItem(/跳转到定义/);
    const after = await pos();
    console.log('    跳转前: ' + JSON.stringify(before) + ' → 跳转后: ' + JSON.stringify(after));
    ck('  点中了那一项', hit === true);
    /* ⚠️⚠️ 这条是**整个改动的意义** ✗✗ —— 目标是**另一个片段** ✓，
       而 Monaco 内置的「转到定义」只能在**同一个 model 里跳** ✓
       （所以就算注册了 DefinitionProvider 也到不了这儿 ✓）。 */
    ck('★★★ 跳到了**另一个片段**里的定义（第 ' + TO.frag + ' 片段第 ' + TO.line + ' 行）',
      !!after && after.frag === TO.frag && after.line === TO.line, JSON.stringify(after));
    ck('★★ 而且菜单关掉了（点完不该还挂在那儿）', (await menuItems()).length === 0);

    console.log('\n── ③ F12 也能跳（快捷键归 action 管，不是老的 addCommand 残留）──');
    await p.evaluate((a) => { try { CINDEX = a.frag; renderMain(); } catch (_) {} }, { frag: FROM.frag });
    await p.waitForTimeout(2200);
    await p.evaluate((a) => {
      try { MONACO_EDITOR.setPosition({ lineNumber: a.line, column: a.col }); MONACO_EDITOR.focus(); } catch (_) {}
    }, FROM);
    await p.waitForTimeout(400);
    await p.keyboard.press('F12');
    await p.waitForTimeout(2200);
    const afterKey = await pos();
    console.log('    F12 之后: ' + JSON.stringify(afterKey));
    ck('★★ F12 也能跳到定义（而且只跳一次 —— 两边都绑会触发两下）',
      !!afterKey && afterKey.frag === TO.frag && afterKey.line === TO.line, JSON.stringify(afterKey));

    console.log('\n── ④ 速览定义（不离开当前文件先看一眼）──');
    await p.evaluate((a) => { try { CINDEX = a.frag; renderMain(); } catch (_) {} }, { frag: FROM.frag });
    await p.waitForTimeout(2200);
    await p.evaluate((a) => { try { closeDefinitionPeek(); MONACO_EDITOR.setPosition({ lineNumber: a.line, column: a.col }); } catch (_) {} }, FROM);
    await openMenu();
    await clickItem(/速览定义/);
    const peek = await p.evaluate(() => {
      const el = document.getElementById('definition-peek');
      return el ? { hidden: el.classList.contains('hidden'), title: String((document.getElementById('peek-title') || {}).textContent || '') } : null;
    });
    console.log('    peek: ' + JSON.stringify(peek));
    ck('★★ 「速览定义」弹出了浮层（没有跳走，还在当前文件）',
      !!peek && peek.hidden === false && /add/.test(peek.title), JSON.stringify(peek));
    ck('★ 而且没把光标挪走（速览就是「先看一眼」）',
      JSON.stringify(await pos()) === JSON.stringify({ frag: FROM.frag, line: FROM.line }), JSON.stringify(await pos()));

    console.log('\n── ⑤ 查看引用 ──');
    await p.evaluate(() => { try { closeDefinitionPeek(); } catch (_) {} });
    await p.waitForTimeout(300);
    await openMenu();
    await clickItem(/查看引用/);
    const sym = await p.evaluate(() => { try { return SYM_SEL ? { name: SYM_SEL.name, kind: SYM_SEL.kind } : null; } catch (_) { return null; } });
    console.log('    SYM_SEL: ' + JSON.stringify(sym));
    ck('★★ 「查看引用」把符号送到了右侧面板（SYM_SEL 被设上）',
      !!sym && sym.name === 'add', JSON.stringify(sym));

    console.log('\n── ⑥ 用代码向导查这个符号 ──');
    await openMenu();
    await clickItem(/代码向导/);
    await p.waitForTimeout(1200);
    const cg = await p.evaluate(() => {
      const el = document.getElementById('cgx-mask');
      const q = document.getElementById('cgx-q');
      return { open: !!el && el.classList.contains('on'), q: q ? q.value : '' };
    });
    console.log('    代码向导: ' + JSON.stringify(cg));
    ck('★★ 「用代码向导查这个符号」把向导叫起来了', cg.open === true, JSON.stringify(cg));
    ck('★ 而且输入框里就是那个符号（不是空的让你自己打）', /add/i.test(cg.q), JSON.stringify(cg.q));
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
