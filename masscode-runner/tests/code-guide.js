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

/* 假 AI ✓ —— **两条路都要答** ✗（同一个 /api/ai/chat ✓，靠请求内容分岔 ✓）：
   ① 「找函数」要的是候选名 ✓（FAKE_AI ✓）
   ② 「拆逻辑」要的是**人话流程图** ✓（FAKE_FLOW ✓）—— 用户原话：
      「我需要的是让AI给我拆解分析实现逻辑和功能的流程图，思维导图那种，不是代码」✓
   ⚠️ 两份都故意包一层 ```json 围栏 + 前言 ✗（验的就是「能不能剥干净」✓）。
   ⚠️⚠️ FAKE_FLOW 里**故意不写任何代码原文** ✗ ——
      探针要断言的就是「导图上不会出现 if (...) / return -1 这种」✓。
      如果假数据里带了代码 ✓，那条断言就变成**恒假** ✗（永远红 ✓），
      而真正要防的是「产品把 AI 给的代码原样渲染出来」✓。 */
const FAKE_AI = {
  names: [
    { n: '探针_读文件', why: '一句话：把整个文件读成字符串', use: 'auto s = readAll("a.txt");' },
    { n: '探针_逐行读', why: '一句话：一行一行读，省内存', use: 'while (getline(in, line)) { }' },
  ],
  hint: '小文件用第一个，大文件用第二个。',
};
const FAKE_FLOW = {
  title: '读 LED 电平',
  what: '把 LED 当前的电平读出来，交给调用者',
  io: { in: ['LED 句柄', '一个用来装结果的变量'], out: ['成功返回 0', '参数不对返回 -1'] },
  steps: [
    { t: '检查参数', d: '先看句柄和结果变量有没有传进来', kind: 'branch', branch: [{ cond: '有一个是空的', to: '直接返回失败码' }] },
    { t: '读取电平', d: '从句柄里把当前电平取出来，写进结果变量', kind: 'step' },
    { t: '打日志', d: '把读到的电平值记进日志，方便排查', kind: 'call' },
    { t: '返回成功', d: '告诉调用者这次读成功了', kind: 'return' },
  ],
  keys: ['先查空指针再解引用'],
  pitfalls: ['忘记把结果写回调用者的变量'],
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
  let aiCalls = 0, flowCalls = 0;
  await p.route('**/api/ai/chat', async (r) => {
    aiCalls++;
    /* ⚠️ 按**请求内容**分岔 ✗（不是按调用顺序 ✓）——
       顺序会随着「哪个按钮先点」变 ✓，按顺序判必然错位 ✓。 */
    let body = '';
    try { body = JSON.stringify(r.request().postDataJSON() || {}); } catch (_) {}
    const isFlow = /流程图|思维导图|讲成人话/.test(body);
    if (isFlow) {
      flowCalls++;
      /* ★★ 故意**拖一会儿** ✗✗ —— 不给这点延迟的话 ✓，
         请求瞬间返回 ✓ → 「按下有反馈 / 忙碌转圈」根本来不及观察 ✓ →
         那两条断言就变成**恒真**（按钮已经恢复了 ✓）✗。
         1.6 秒够探针量一次计算样式了 ✓。 */
      await new Promise((ok) => setTimeout(ok, 1600));
    }
    return r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, content: '好的：\n```json\n' + JSON.stringify(isFlow ? FAKE_FLOW : FAKE_AI) + '\n```\n' }),
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
      const mine = ['cgx-mask', 'cgx-box', 'cgx-head', 'cgx-tabs', 'cgx-q', 'cgx-go', 'cgx-ctx', 'cgx-tip',
        'cgx-body', 'cgx-graph', 'cgx-mind', 'cgx-flow', 'cgx-skel', 'cgx-explain', 'cgx-skelcode',
        'cgx-style', 'cgx-close', 'cgx-min', 'cgx-rs'];
      const bad = mine.filter((id) => document.querySelectorAll('#' + id).length > 1);
      return bad.length ? bad.join(',') : '';
    }) === '', await p.evaluate(() => {
      const mine = ['cgx-mask', 'cgx-box', 'cgx-head', 'cgx-tabs', 'cgx-q', 'cgx-go', 'cgx-ctx', 'cgx-tip',
        'cgx-body', 'cgx-graph', 'cgx-mind', 'cgx-flow', 'cgx-skel', 'cgx-explain', 'cgx-skelcode',
        'cgx-style', 'cgx-close', 'cgx-min', 'cgx-rs'];
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

    /* ══ ⑤ ★★★★ 拆逻辑：**AI 讲成人话** + 思维导图 / 实现流程 / 代码级 ══════
       用户原话（第二次改）：
       「第二个这里拆逻辑这里，我需要的是让AI给我拆解分析实现逻辑和功能的流程图，
         思维导图那种，**不是代码**」✓。
       ⚠️⚠️ 这一节是**整节重写的** ✗ —— 上一版只验「逻辑图画出来了」✓，
          而那张图上每格都是**代码原文** ✗（`if (led_handler == NULL ...)` ✓），
          恰恰是用户明确说不要的东西 ✓。
          → 现在判据换成：**导图上必须是人话、不许出现代码** ✓。 */
    console.log('\n── ⑤ 🧩 拆逻辑：AI 讲成人话 + 思维导图（不是代码）──');
    await p.locator('[data-cgtab="break"]').click();
    await p.waitForTimeout(1500);
    /* ⚠️ 光标不一定落在函数体里 ✓（③ 是随便挑的「第一个像标识符的词」✓）→
       那样会先给一张「挑一个函数」的列表 ✓ → 顺手点第一个「拆这个」✓。
       ⚠️ 不自愈的话这条会**偶发红** ✗（取决于那个文件第一行长啥样 ✓）。 */
    if (!(await has('#cgx-mind')) && (await p.locator('[data-cgact="pick"]').count())) {
      console.log('    （光标不在函数里 → 点第一个「拆这个」）');
      await p.locator('[data-cgact="pick"]').first().click();
    }
    await p.waitForFunction(() => !!document.getElementById('cgx-mind'), null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(1200);
    ck('★★★ AI 拆解出**思维导图**了（默认视图，不是代码图）', await has('#cgx-mind'), (await cgBody()).slice(0, 160));
    const mnodes = await p.locator('#cgx-mind .cg-mind-node').count();
    console.log('    导图节点数: ' + mnodes);
    ck('★★ 导图上有节点（不是空壳）', mnodes >= 3, String(mnodes));
    ck('★★ 有一条从「根」到「分支」的连线（真的画了图，不是一列文字）',
      await p.locator('#cgx-mind svg path').count() >= 3, String(await p.locator('#cgx-mind svg path').count()));
    const mindTxt = await txt('#cgx-mind');
    console.log('    导图文字: ' + JSON.stringify(mindTxt.slice(0, 150)));
    /* ★★★ 核心判据 —— 用户要的就是这个 ✗✗ */
    ck('★★★ 导图里是**人话**（出现了「检查参数」这种描述）',
      /检查参数|读取电平|打日志/.test(mindTxt), mindTxt.slice(0, 160));
    ck('★★★ 导图里**没有代码原文**（不许出现 if ( / return -1 / NULL / 分号）',
      !/if\s*\(|return\s+-?\d|NULL|;/.test(mindTxt), mindTxt.slice(0, 200));
    ck('★★ 顶部有「这段在干什么」的一句话总结', /这段在干什么/.test(await txt('.cg-summary')), await txt('.cg-summary'));
    /* ★ 实现流程视图 ✓ —— 同一份数据、换个画法 ✓ */
    await p.locator('[data-cgact="view"][data-cgval="flow"]').click(); await p.waitForTimeout(700);
    const flowN = await p.locator('#cgx-flow .cg-step').count();
    ck('★★ 「实现流程」视图能切出来（按顺序一步步）', flowN >= 3, String(flowN));
    ck('★ 流程里把**分支条件**标出来了', /→/.test(await txt('#cgx-flow')), (await txt('#cgx-flow')).slice(0, 140));
    ck('★ 流程里也是人话（没代码）', !/if\s*\(|NULL|;/.test(await txt('#cgx-flow')), (await txt('#cgx-flow')).slice(0, 160));
    /* ★ 代码级视图 ✓ —— 精确的那份**留着** ✓（拿它核对 AI 有没有讲错 ✓）*/
    await p.locator('[data-cgact="view"][data-cgval="code"]').click();
    await p.waitForFunction(() => !!document.getElementById('cgx-graph'), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(900);
    ck('★★ 「代码级」视图还在（复用了页面自己的渲染器 —— 精确、可核对）', await has('#cgx-graph'));
    const nodes = await p.locator('#cgx-graph .logic-node').count();
    console.log('    代码级图上节点数: ' + nodes);
    ck('★★ 代码级图上真的有节点（不是空壳）', nodes >= 2, String(nodes));
    ck('★ 图头写了函数名 + 节点数', /个节点/.test(await txt('#cgx-graph .cg-gbar')), await txt('#cgx-graph .cg-gbar'));
    ck('★ 而且标了「精确 · 服务端解析」（让人知道这份不是 AI 编的）',
      /精确/.test(await txt('#cgx-graph .cg-gbar')), await txt('#cgx-graph .cg-gbar'));
    ck('★ 有「给我一个骨架」按钮（该怎么实现）', await has('#cgx-skel'));
    ck('★ 有「讲一遍」按钮', await has('#cgx-explain'));
    await p.locator('#cgx-skel').click();
    await p.waitForFunction(() => !!document.getElementById('cgx-skelcode'), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(800);
    ck('★★ 骨架代码出来了（走已有的 /api/logic/skeleton）', await has('#cgx-skelcode'),
      (await txt('#cgx-body')).slice(0, 120));

    /* ══ ⑥ ★★ 按钮：按下有反馈 / 忙碌转圈 / 不能重复点 ══════════════════════
       用户原话：「这些按键设计的也不合理，按下思考，都没有加载提醒，等等，
                 高亮和按下都分不清等等」✓。
       ⚠️⚠️ 这一节**必须靠假 AI 的延迟**才验得出来 ✗（见上面 route 里那 1.6 秒 ✓）——
          不延迟的话请求瞬间返回 ✓，量到的永远是「已经恢复」的样子 ✓ →
          断言**恒真** ✗（「看着通过、其实什么都没验」✓）。 */
    console.log('\n── ⑥ 🖱 按钮：按下有反馈 / 忙碌转圈 / 不能重复点 ──');
    const styleOf = (sel) => p.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderColor, color: cs.color, tr: cs.transform, op: cs.opacity };
    }, sel);
    await p.locator('[data-cgact="view"][data-cgval="mind"]').click(); await p.waitForTimeout(400);
    /* ⚠️⚠️ 拿**视图切换按钮**做 hover / 按下测试 ✗✗ —— 别拿「重新拆解」✗：
       `mouse.down()` + `mouse.up()` 本身就是**一次真点击** ✓ →
       按在「重新拆解」上会把分析**重跑一遍** ✓（好几秒 ✓），
       而且中途 DOM 整个换掉 ✓ → 后面那句 `.click()` 找不到元素、干等 30 秒超时 ✗
       （实测就是这么挂的 ✓）。视图切换是幂等的 ✓，随便点 ✓。 */
    const vsel = '[data-cgact="view"][data-cgval="flow"]';
    const b0 = await styleOf(vsel);
    await p.locator(vsel).hover(); await p.waitForTimeout(300);
    const b1 = await styleOf(vsel);
    ck('★ 悬停和默认**长得不一样**（不是「只有一条很淡的 hover」）',
      !!b0 && !!b1 && (b0.bg !== b1.bg || b0.border !== b1.border), JSON.stringify({ def: b0, hov: b1 }));
    const bb = await p.locator(vsel).boundingBox();
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await p.mouse.down(); await p.waitForTimeout(250);
    const b2 = await styleOf(vsel);
    await p.mouse.up(); await p.waitForTimeout(300);
    ck('★★ 按下和悬停**也不一样**（下沉 1px —— 「按下去」要有触感）',
      !!b1 && !!b2 && (b1.tr !== b2.tr || b1.bg !== b2.bg), JSON.stringify({ hov: b1.tr, act: b2.tr }));
    /* 回到思维导图视图 ✓，再点「重新拆解」看忙碌态 ✓ */
    await p.locator('[data-cgact="view"][data-cgval="mind"]').click(); await p.waitForTimeout(400);
    /* ★★ 点下去**立刻**有反应 ✗✗ —— 这是用户最直接的抱怨 ✓ */
    await p.locator('[data-cgact="flow"]').click();
    await p.waitForTimeout(450);                    /* 假 AI 要 1.6 秒 ✓，这时候还在跑 ✓ */
    const busy = await p.evaluate(() => {
      const b = document.querySelector('[data-cgact="flow"]');
      const bar = document.querySelector('.cg-busy');
      if (!b) return null;
      return {
        cls: b.className, disabled: !!b.disabled,
        spin: !!b.querySelector('.cg-spin'),
        txt: (b.innerText || '').trim(),
        bar: bar ? (bar.innerText || '').replace(/\n/g, ' ').trim() : '',
      };
    });
    console.log('    忙碌态: ' + JSON.stringify(busy));
    ck('★★★ 点下去**立刻**进忙碌态（转圈 + 文案变成「正在…」）',
      !!busy && busy.spin && /正在/.test(busy.txt), JSON.stringify(busy));
    ck('★★★ 忙碌时那个按钮**不可重复点**（disabled，防连点发两次请求）',
      !!busy && busy.disabled === true, JSON.stringify(busy));
    ck('★★ 而且有一条**全局可见**的进度提示（不只体现在小按钮上）',
      !!busy && busy.bar.length > 4, JSON.stringify(busy));
    await p.waitForFunction(() => !document.querySelector('.cg-busy'), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(600);
    const after = await p.evaluate(() => {
      const b = document.querySelector('[data-cgact="flow"]');
      return b ? { disabled: !!b.disabled, spin: !!b.querySelector('.cg-spin'), txt: (b.innerText || '').trim() } : null;
    });
    ck('★★ 跑完**自己恢复**（不是一直转圈）',
      !!after && !after.disabled && !after.spin, JSON.stringify(after));

    /* ══ ⑦ ★★ 跳转：该有的都有入口 + 跳完**不关窗** ═══════════════════════
       用户原话：「有些怎么缺少跳转等等，还有点击跳转，会导致代码向导被关闭等等问题」✓。 */
    console.log('\n── ⑦ ↗ 跳转：入口 + 跳完不关窗 ──');
    /* ⚠️⚠️ 搜索词必须挑**这个文件里真的有定义**的符号 ✗✗ ——
       第一版拿的是 ③ 那个 `placed`（= 第一行的第一个标识符 ✓），
       而那个词是 `include` ✗ → 它是**预处理指令** ✓，本来就没有「定义在哪」✓ →
       四条结果全是 LSP 片段 ✓、一条都没有跳转入口 ✓ →
       断言红了 ✓，而**产品是对的** ✗（假失败 ✓，白查一轮 ✓）。
       → 改成：直接问页面要一个**本地真有的**符号（fn / type / macro / var ✓）。 */
    const localSym = await p.evaluate(async () => {
      try {
        const r = await fetch('/api/graph?file=' + encodeURIComponent(CURRENT.file));
        const d = await r.json();
        const s = (d.symbols || []).find((x) => x && x.name && x.line
          && ['fn', 'type', 'macro', 'var', 'method'].indexOf(x.kind) >= 0);
        return s ? { name: s.name, line: s.line, kind: s.kind } : null;
      } catch (_) { return null; }
    });
    console.log('    拿这个本地符号试跳转: ' + JSON.stringify(localSym));
    ck('  这个文件里找得到一个有行号的本地符号', !!(localSym && localSym.name), JSON.stringify(localSym));
    await p.locator('[data-cgtab="look"]').click(); await p.waitForTimeout(500);
    await p.locator('#cgx-q').fill((localSym && localSym.name) || placed);
    await p.locator('#cgx-go').click();
    await p.waitForTimeout(2600);
    const jinfo = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.cg-row'));
      /* ⚠️ 找**第一个带跳转入口**的行 ✗，不是「第一行」✗ ——
         LSP 补全项排在前面 ✓，它们本来就可能没有位置 ✓（标准库 ✓）→
         拿第一行判会**偶发红** ✓。 */
      const hit = rows.find((r) => r.querySelector('[data-cgact="goto"]'));
      if (!hit) return { hasBtn: false, total: rows.length };
      return { name: hit.dataset.cgrow, hasBtn: true, line: Number(hit.dataset.cgline) || 0, total: rows.length };
    });
    console.log('    第一条: ' + JSON.stringify(jinfo));
    ck('★★ 能定位的条目**有「跳过去」按钮**（旧版只有本地符号才有，LSP 项一律没有）',
      !!(jinfo && jinfo.hasBtn), JSON.stringify(jinfo));
    /* ⚠️ 不能跳的那些**必须写清为什么** ✗ —— 用户抱怨的「缺少跳转」有一半是「不知道为什么没有」✓ */
    const noJump = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.cg-row'));
      const miss = rows.filter((r) => !r.querySelector('[data-cgact="goto"]'));
      return { total: rows.length, miss: miss.length, why: miss.length ? (miss[0].querySelector('.nj') || {}).textContent || '' : '' };
    });
    console.log('    没有跳转入口的条目: ' + JSON.stringify(noJump));
    ck('★★ 不能跳的条目**写清了原因**（不是干晾着用户）',
      noJump.miss === 0 || String(noJump.why).length > 4, JSON.stringify(noJump));
    if (jinfo && jinfo.hasBtn) {
      await p.locator('[data-cgact="goto"]').first().click();
      /* ⚠️ 跨片段跳转会**重建编辑器**（renderMain ✓）→ 多等一会儿 ✗ */
      await p.waitForTimeout(2000);
      const open2 = await p.evaluate(() => { const e = document.getElementById('cgx-mask'); return !!e && e.classList.contains('on'); });
      ck('★★★ 跳完向导**还开着**（旧版一点就关 —— 用户没法连着跳好几处）', open2 === true);
      const at = await p.evaluate(() => { try { return MONACO_EDITOR.getPosition().lineNumber; } catch (_) { return -1; } });
      console.log('    跳完光标在第 ' + at + ' 行（目标第 ' + jinfo.line + ' 行）');
      ck('★★ 而且真的**跳到了那一行**（不是只弹个提示）', at === jinfo.line, String(at) + ' vs ' + jinfo.line);
    } else {
      ck('★★★ 跳完向导还开着', false, '上一条没有按钮，跳不了');
    }

    console.log('\n── ⑧ 「插到光标处」真的会改编辑器（改完立刻还原）──');
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

    /* ══ ⑨ ★★ 浮在页面上的**小窗口**（可拖 / 可折 / 记位置）══════════════════
       用户原话：「给我改成小窗口，可以任意拖动显示到不同位置，是浮于页面之上的那种，
                  小窗口显示查询，可以随时查询和关闭，也可以拖动放到一边，
                  参考学习这写代码等等」✓。
       ⚠️ 和旧版最大的差别：**没有遮罩、点外面不关** ✗ ——
          旧版是一层半透明全屏遮罩 + 点它关闭 ✓ →
          用户**没法一边查一边写代码** ✗（点一下编辑器，向导就没了 ✓）。 */
    console.log('\n── ⑨ ★★ 浮动小窗口：可拖 / 可折 / 记住位置 ──');
    const win0 = await p.evaluate(() => localStorage.getItem('cg-win'));
    await p.keyboard.press('Meta+i'); await p.waitForTimeout(800);
    const f1 = await p.evaluate(() => {
      const box = document.querySelector('#cgx-box');
      const mask = document.querySelector('#cgx-mask');
      if (!box || !mask) return null;
      const r = box.getBoundingClientRect();
      const cs = getComputedStyle(box); const ms = getComputedStyle(mask);
      return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width),
        pos: cs.position, maskPe: ms.pointerEvents, maskBg: ms.backgroundColor };
    });
    ck('★★ 是**浮在页面上**的（position:fixed，不是居中的模态框）', !!f1 && f1.pos === 'fixed', JSON.stringify(f1));
    ck('★★ 遮罩**不挡点击、没有背景**（所以能一边查一边写代码）',
      !!f1 && f1.maskPe === 'none' && f1.maskBg === 'rgba(0, 0, 0, 0)', JSON.stringify(f1 && { pe: f1.maskPe, bg: f1.maskBg }));
    ck('★ 窗口不大（是个「小窗口」，不是整屏）', !!f1 && f1.w <= 700, String(f1 && f1.w));
    /* ★ 点页面别处**不该关** —— 这是「能一边查一边写」的关键 ✓ */
    await p.mouse.click(60, 700); await p.waitForTimeout(500);
    /* ⚠️⚠️ 判「开着」要看 **`#cgx-mask` 上的 `.on`** ✗✗ ——
       `.on` 是加在**遮罩**上的 ✓（`el.classList.add('on')`，el = mask ✓），
       盒子 `#cgx-box` **永远没有** `.on` ✗。
       我第一版写成 `#cgx-box.on` ✗ → 这条**必挂** ✓（暴露了 ✓），
       而下面「Esc 能关掉」那条判 `count() === 0` ✗ → **恒真、假通过** ✗✗
       （「看着通过、其实什么都没验」✓ —— 要不是上面那条挂了，我根本不会发现 ✓）。 */
    ck('★★ 点页面别处**不会把它关掉**（旧版一点外面就没了）',
      await p.evaluate(() => { const e = document.getElementById('cgx-mask'); return !!e && e.classList.contains('on'); }));
    /* ★ 拖顶栏 ✓ */
    const hb = await p.locator('#cgx-head').boundingBox();
    await p.mouse.move(hb.x + 120, hb.y + hb.height / 2);
    await p.mouse.down();
    await p.mouse.move(hb.x + 120 - 300, hb.y + hb.height / 2 + 200, { steps: 8 });
    await p.mouse.up(); await p.waitForTimeout(600);
    const f2 = await p.evaluate(() => {
      const r = document.querySelector('#cgx-box').getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), saved: localStorage.getItem('cg-win') };
    });
    ck('★★ 拖顶栏真的能挪位置', f2.left < f1.left - 100 && f2.top > f1.top + 80, JSON.stringify(f2));
    ck('★ 位置**落盘**了（下次按 ⌘I 还在那儿）', /"x":/.test(f2.saved || ''), String(f2.saved));
    /* ★ 折叠 ✓ */
    await p.locator('#cgx-min').click(); await p.waitForTimeout(600);
    const f3 = await p.evaluate(() => {
      const box = document.querySelector('#cgx-box');
      const body = document.querySelector('#cgx-body');
      return { min: box.classList.contains('min'), h: Math.round(box.getBoundingClientRect().height),
        bodyHidden: !body || getComputedStyle(body).display === 'none' };
    });
    ck('★★ 「—」能折成一条（放到边上不挡代码）', f3.min && f3.bodyHidden && f3.h < 80, JSON.stringify(f3));
    /* ★ 关掉再开：位置 + 折叠都记住 ✓ */
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    ck('★ Esc 能关掉', await p.evaluate(() => { const e = document.getElementById('cgx-mask'); return !e || !e.classList.contains('on'); }));
    await p.keyboard.press('Meta+i'); await p.waitForTimeout(800);
    const f4 = await p.evaluate(() => {
      const box = document.querySelector('#cgx-box');
      const r = box.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), min: box.classList.contains('min') };
    });
    ck('★★ 再打开：**位置和折叠状态都记住了**', f4.left === f2.left && f4.top === f2.top && f4.min === true, JSON.stringify(f4));
    await p.locator('#cgx-min').click(); await p.waitForTimeout(500);
    /* ★★ 存一个「屏幕外」的坐标 → 必须夹回来 ✗（不然窗口跑到视口外 = 用户找不到它）*/
    await p.evaluate(() => localStorage.setItem('cg-win', JSON.stringify({ x: 99999, y: 99999 })));
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    await p.keyboard.press('Meta+i'); await p.waitForTimeout(800);
    const f5 = await p.evaluate(() => {
      const r = document.querySelector('#cgx-box').getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), vw: innerWidth, vh: innerHeight };
    });
    ck('★★★ 存成「屏幕外」的坐标也会**夹回视口内**（不然按了 ⌘I 像什么都没发生）',
      f5.left >= 0 && f5.top >= 0 && f5.left < f5.vw && f5.top < f5.vh, JSON.stringify(f5));
    /* ★ 右下角改大小 ✓ —— ⚠️ 先把窗口摆到左上角 ✗：
       贴着右边缘时它已经到视口上限了 ✓，「改不动」是**对的** ✓。 */
    await p.evaluate(() => localStorage.setItem('cg-win', JSON.stringify({ x: 70, y: 80 })));
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    await p.keyboard.press('Meta+i'); await p.waitForTimeout(800);
    const rsb = await p.locator('#cgx-rs').boundingBox();
    await p.mouse.move(rsb.x + 6, rsb.y + 6); await p.mouse.down();
    await p.mouse.move(rsb.x + 6 + 170, rsb.y + 6 + 150, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(600);
    const f6 = await p.evaluate(() => {
      const r = document.querySelector('#cgx-box').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), saved: localStorage.getItem('cg-win') };
    });
    ck('★★ 右下角能拖大（和「能挪位置」是一对）', f6.w > 560 && f6.h > 320, JSON.stringify(f6));
    ck('★ 大小也落盘了', /"w":/.test(f6.saved || ''), String(f6.saved));
    /* 收尾：把这次改的界面偏好还原 ✓（不动用户自己的位置）*/
    await p.evaluate((v) => {
      try { if (v === null) localStorage.removeItem('cg-win'); else localStorage.setItem('cg-win', v); } catch (_) {}
    }, win0);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);

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
