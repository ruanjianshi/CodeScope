#!/usr/bin/env node
/* 🧭 代码向导（`assets/code-guide.js`）的端到端探针 ✓
   —— 打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。

   ★ 用户原话（2026-10-08）：
     「我常常在写代码的时候…有些我记不清了，但是我记得我需要大致什么功能，
       那么我可以通过这个弹出的指导工具，告诉我该变量是什么，怎么用等等；
       还有些，我不太清楚，大致需要用到什么函数或变量…给我相关指导和推荐，
       然后给我解析；包括还有一些实现逻辑，我可能捋不清了，这个指导工具和帮我
       拆解和可视化，图解逻辑图分析，告诉我该怎么实现等等。
       我需要这个指导工具，便捷，简洁，方便，随时可用可观，可查等等。」

   ⚠️⚠️ 这个探针会**改用户的真实代码文件** ✗（「插到光标处」那一条 ✓）——
      而这个项目**开着自动保存** ✗（改完自动写进 vault ✓）。
      → 所以必须三步走 ✗：
        ① 开跑前**记下原文** ✓；
        ② 验完**立刻还原**（编辑器里 setValue 回去 ✓ + 等自动保存落盘 ✓）；
        ③ `finally` 里**再读一次 vault 校验** ✓，还不一样就用 `/api/save` 硬写回去 ✓。
      ⚠️ 少任何一步都可能**把用户的代码改坏** ✗（这是探针最不能犯的错 ✓）。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';

/* 假 AI ✓ —— 只答「找函数」那一路（要 JSON ✓），并故意包一层 ```json 围栏 ✓ */
const FAKE_AI = {
  names: [
    { n: '探针_读文件', why: '一句话：把整个文件读成字符串', use: 'auto s = readAll("a.txt");' },
    { n: '探针_逐行读', why: '一句话：一行一行读，省内存', use: 'while (getline(in, line)) { }' },
  ],
  hint: '小文件用第一个，大文件用第二个。',
};

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  /* ① 先记下「待会儿可能要改的那个片段」的原文 ✓ */
  const snips = await (await fetch(BASE + '/api/snippets', { cache: 'no-store' })).json();
  const list = Array.isArray(snips) ? snips : (snips && snips.snippets) || [];
  const target = list.find((s) => s && s.fragments && s.fragments.length && /c_cpp|python|javascript|typescript|go|c\b/.test(String(s.fragments[0].language || '')));
  if (!target) { console.log('（跳过：vault 里没有带代码片段的条目 ✓）'); process.exit(0); }
  const origCode = String(target.fragments[0].code || '');
  const origFile = String(target.file);
  console.log('用这个片段做实验：《' + String(target.name || origFile) + '》 · '
    + String(target.fragments[0].label || '') + ' · ' + String(target.fragments[0].language || '')
    + ' · ' + origCode.length + ' 字');

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  /* ⚠️ 原生弹窗哨兵 ✓ —— 只在**真的弹了原生框**时才触发 ✓（页内浮层不会 ✓）*/
  const natives = [];
  p.on('dialog', async (d) => { natives.push(d.type()); await d.dismiss().catch(() => {}); });
  let aiCalls = 0;
  await p.route('**/api/ai/chat', (r) => {
    aiCalls++;
    return r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, content: '好的：\n```json\n' + JSON.stringify(FAKE_AI) + '\n```\n' }),
    });
  });
  await p.addInitScript(() => {
    try { localStorage.setItem('mc-ai-cfg', JSON.stringify({ url: 'https://example.invalid/v1/chat/completions', key: 'k', model: 'm' })); } catch (_) {}
  });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' | ').trim() : '(没有)'; };
  const has = async (s) => (await p.locator(s).count()) > 0;
  const cgOpen = async () => { await p.keyboard.press('Meta+i'); await p.waitForTimeout(900); };
  const cgBody = () => p.evaluate(() => { const e = document.getElementById('cgx-body'); return e ? e.innerText.replace(/\n/g, ' | ') : '(没有)'; });
  const editorCode = () => p.evaluate(() => { try { return MONACO_EDITOR.getModel().getValue(); } catch (_) { return null; } });

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);

    console.log('\n── ① 装上了没 + ⌘I 召唤 ──');
    ck('★★ 脚本挂上了（window.__CODE_GUIDE）', await p.evaluate(() => !!window.__CODE_GUIDE));
    ck('★ 样式也注入了（自带 CSS，不用改 index.html）', await p.evaluate(() => !!document.getElementById('cgx-style')));
    /* ★★★ id 撞车守卫 ✓✓ —— 这条是**真踩过的坑** ✗：
       我给浮层起名 `#cg-body` ✓，而 `index.html` 里**早就有一个** `#cg-body` ✗
       （文档级代码图谱那个面板 ✓）→ 页面的 `#cg-body{flex:1 1 auto;overflow:hidden}` ✗
       **直接盖到我的元素上** ✗ → 我的内容区高度塌成 14px ✗ →
       逻辑图整块看不见 ✓、按钮全点不到 ✗（探针报的是「按钮 not visible」✗，
       而真相是**容器被别人的 CSS 吃了** ✗ —— 查了半天才想到 grep id ✓）。
       ⚠️ 判据：**同一个 id 在文档里出现两次** → `querySelectorAll('#x').length === 2` ✓。
       加浮层前先 grep 一遍 id ✓，加完之后**用这条守着** ✓。 */
    ck('★★★ 浮层的 id 没和页面已有的撞（撞了会被别人的 CSS 盖掉）', await p.evaluate(() => {
      const mine = ['cgx-mask', 'cgx-box', 'cgx-tabs', 'cgx-q', 'cgx-go', 'cgx-ctx', 'cgx-tip',
        'cgx-body', 'cgx-graph', 'cgx-skel', 'cgx-explain', 'cgx-style', 'cgx-close'];
      const bad = mine.filter((id) => document.querySelectorAll('#' + id).length > 1);
      return bad.length ? bad.join(',') : '';
    }) === '', await p.evaluate(() => {
      const mine = ['cgx-mask', 'cgx-box', 'cgx-tabs', 'cgx-q', 'cgx-go', 'cgx-ctx', 'cgx-tip',
        'cgx-body', 'cgx-graph', 'cgx-skel', 'cgx-explain', 'cgx-style', 'cgx-close'];
      return mine.filter((id) => document.querySelectorAll('#' + id).length > 1).join(',');
    }));
    await cgOpen();
    ck('★★ ⌘I 能唤出浮层', await p.evaluate(() => { const e = document.getElementById('cgx-mask'); return !!e && e.classList.contains('on'); }));
    ck('★ 三个模式都在', await p.locator('[data-cgtab]').count() === 3, String(await p.locator('[data-cgtab]').count()));
    ck('★ 每条结果都标了来源（图例：LSP/本地 = 已核实 · AI = 未核实）',
      /已核实/.test(await txt('.cg-foot')) && /未核实/.test(await txt('.cg-foot')), await txt('.cg-foot'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    ck('★ Esc 能关掉', await p.evaluate(() => { const e = document.getElementById('cgx-mask'); return !e || !e.classList.contains('on'); }));

    console.log('\n── ② 打开一个代码文件（后面几条都要有上下文）──');
    await p.locator('.item').first().click();
    await p.waitForTimeout(4000);
    const ctx = await p.evaluate(() => { try { return CURRENT ? { file: CURRENT.file, lang: CURRENT.fragments[CINDEX].language } : null; } catch (_) { return null; } });
    ck('★ 真的打开了片段', !!ctx, JSON.stringify(ctx));
    ck('★ 编辑器起来了（Monaco）', await p.evaluate(() => { try { return !!MONACO_EDITOR; } catch (_) { return false; } }));

    console.log('\n── ③ 🔍 查符号（光标放上去直接 ⌘I）──');
    /* 把光标放到正文里第一个「像标识符」的词上 ✓ */
    const placed = await p.evaluate(() => {
      try {
        const m = MONACO_EDITOR.getModel();
        for (let i = 1; i <= m.getLineCount(); i++) {
          const mm = /[A-Za-z_][A-Za-z0-9_]{2,}/.exec(m.getLineContent(i));
          if (mm) { MONACO_EDITOR.setPosition({ lineNumber: i, column: mm.index + 2 }); return mm[0]; }
        }
      } catch (_) {}
      return '';
    });
    console.log('    光标放在: ' + JSON.stringify(placed));
    ck('  找到一个可以查的标识符', !!placed, placed);
    await cgOpen();
    await p.waitForTimeout(2200);
    ck('★★ 头部显示**当前上下文**（文件名 · 语言 · 光标位置）',
      (await txt('#cgx-ctx')).indexOf('·') > 0, await txt('#cgx-ctx'));
    const q = await p.evaluate(() => { const e = document.getElementById('cgx-q'); return e ? e.value : ''; });
    ck('★★ 输入框**自动预填**光标底下那个词（省一次打字）', q.toLowerCase() === placed.toLowerCase(), JSON.stringify(q) + ' vs ' + JSON.stringify(placed));
    const lookBody = await cgBody();
    console.log('    结果: ' + JSON.stringify(lookBody.slice(0, 160)));
    ck('★★ 查出了结果', await p.locator('.cg-row').count() >= 1, String(await p.locator('.cg-row').count()));
    ck('★★ 结果上**标着来源**（本地符号 / LSP，不是含糊的「AI 说的」）',
      /本地符号|LSP/.test(lookBody), lookBody.slice(0, 100));

    console.log('\n── ④ 💡 找函数（大白话 → 候选，再回头核实）──');
    await p.locator('[data-cgtab="find"]').click(); await p.waitForTimeout(600);
    await p.locator('#cgx-q').fill('怎么把文件整个读进来');
    await p.locator('#cgx-go').click();
    await p.waitForFunction(() => !/正在让 AI/.test(document.getElementById('cgx-body').innerText), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const findBody = await cgBody();
    console.log('    结果: ' + JSON.stringify(findBody.slice(0, 220)));
    ck('★ 真的问了 AI（aiCalls ≥ 1）', aiCalls >= 1, String(aiCalls));
    ck('★★ AI 给的候选**渲染出来了**（剥掉了 ```json 围栏）',
      /探针_读文件/.test(findBody), findBody.slice(0, 160));
    ck('★★★ AI 那条**明确标着「未核实」**（不假装是权威）',
      /未核实/.test(findBody), findBody.slice(0, 200));
    ck('★ 而且说清了「用之前先确认名字对不对」', /确认|报错为准|核实/.test(findBody), findBody.slice(0, 200));
    ck('★ AI 给的 hint 也显示了', /小文件用第一个|大文件用第二个/.test(findBody), findBody.slice(0, 220));
    /* ★★ 中文查询**不该**把英文符号全捞出来 ✗✗ —— 实测踩到 ✓：
       「标点 / 下划线不敏感」那条兜底里 ✓，中文会被 strip 成**空串** ✗，
       而 `'add'.indexOf('') === 0` **恒成立** ✗ → 所有符号全部命中 ✗ →
       截图里 `main.cpp` / `int` / `calc.hpp` 这种噪音全冒出来 ✓，把 AI 的候选挤到下面去了 ✗。 */
    ck('★★ 中文查询**没有**把一堆无关符号全捞出来（那条兜底要判空）',
      !/main\.cpp|calc\.hpp|keyword/.test(findBody), findBody.slice(0, 160));

    console.log('\n── ⑤ 🧩 拆逻辑（画图 + 骨架）──');
    await p.locator('[data-cgtab="break"]').click();
    await p.waitForFunction(() => !!document.getElementById('cgx-graph'), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2500);
    ck('★★ 逻辑图画出来了（复用了页面自己的渲染器）', await has('#cgx-graph'));
    const nodes = await p.locator('#cgx-graph .logic-node').count();
    console.log('    图上节点数: ' + nodes);
    ck('★★ 图上真的有节点（不是空壳）', nodes >= 2, String(nodes));
    ck('★ 图头写了函数名 + 节点数', /个节点/.test(await txt('#cgx-graph .cg-gbar')), await txt('#cgx-graph .cg-gbar'));
    ck('★ 有「给我一个骨架」按钮（该怎么实现）', await has('#cgx-skel'));
    ck('★ 有「让它讲一遍」按钮', await has('#cgx-explain'));
    await p.locator('#cgx-skel').click();
    await p.waitForFunction(() => !!document.getElementById('cgx-skelcode'), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(800);
    ck('★★ 骨架代码出来了（走已有的 /api/logic/skeleton）', await has('#cgx-skelcode'),
      (await txt('#cgx-body')).slice(0, 120));

    console.log('\n── ⑥ 「插到光标处」真的会改编辑器（改完立刻还原）──');
    const before = await editorCode();
    await p.locator('[data-cgtab="look"]').click(); await p.waitForTimeout(400);
    await p.locator('#cgx-q').fill(placed); await p.locator('#cgx-go').click();
    await p.waitForTimeout(2200);
    const useBtn = p.locator('[data-cgact="use"]').first();
    if (await useBtn.count()) {
      await useBtn.click();
      await p.waitForTimeout(1200);
      const after = await editorCode();
      console.log('    编辑器内容长度 ' + String(before && before.length) + ' → ' + String(after && after.length));
      ck('★★ 「插到光标处」真的改了编辑器', !!after && after !== before, String(before && before.length) + ' → ' + String(after && after.length));
      ck('★ 插完浮层自动关掉（不挡着你看结果）',
        await p.evaluate(() => { const e = document.getElementById('cgx-mask'); return !e || !e.classList.contains('on'); }));
      /* ⚠️ 立刻还原 ✗ —— 这个项目开着**自动保存** ✓，不还的话用户的文件就被改了 ✗ */
      await p.evaluate((code) => { try { MONACO_EDITOR.getModel().setValue(code); } catch (_) {} }, before);
      await p.waitForTimeout(3500);                 /* 等自动保存把「还原后」的内容落盘 ✓ */
      const back = await editorCode();
      ck('★★ 已经还原回原文（不留痕迹）', back === before, String(back && back.length) + ' vs ' + String(before && before.length));
    } else {
      ck('★ 查出来的条目带「插到光标处」按钮', false, '没找到按钮');
    }

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
    ck('★★ 全程没有原生弹窗（这个项目明令禁止）', natives.length === 0, JSON.stringify(natives));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    /* ③ 最后再兜一道 ✓：万一上面哪一步没还原干净 ✓，直接用接口把原文写回去 ✓ */
    try {
      const cur = await (await fetch(BASE + '/api/snippets', { cache: 'no-store' })).json();
      const arr = Array.isArray(cur) ? cur : (cur && cur.snippets) || [];
      const t = arr.find((s) => s && s.file === origFile);
      const now = t && t.fragments && t.fragments[0] ? String(t.fragments[0].code || '') : '';
      if (now !== origCode) {
        const r = await fetch(BASE + '/api/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: origFile, fragment: 0, code: origCode }),
        });
        const d = await r.json();
        console.log('\n⚠️ 收尾：vault 里的内容和原文不一样 → 已用 /api/save 写回 ✓（' + JSON.stringify(d && d.message) + '）');
      } else {
        console.log('\n收尾：vault 内容与开跑前一致 ✓（没动过用户的代码）');
      }
    } catch (e) { console.log('\n收尾失败: ' + e.message); fails.push('收尾失败'); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
