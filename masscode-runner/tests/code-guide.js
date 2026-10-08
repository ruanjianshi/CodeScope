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
/* ★★★★ 「怎么用」手册 ✓ —— 用户原话：
   「我需要用到哈希表，但是我不记得哈希表的如何定义，
     以及如何实现**增删改查插**等，我就需要进查询，
     就类似，以前程序员经常需要查**文档手册**一样去写代码」✓。
   ⚠️ 这份假数据**故意按「定义 → 增 → 查 → 删 → 遍历」排** ✗ ——
      探针要断言的就是「这几段都在」✓（用户原话里点名的就是这个 ✓）。
   ⚠️ 而且它是**按请求里的符号名生成**的 ✓（`符号：xxx` ✓）——
      不然「手册里真的出现了那个符号」这条断言 ✓ 就变成在验假数据了 ✗。 */
function fakeManual(sym) {
  const s = sym || 'unordered_map';
  return {
    what: s + '：按 key 直接查到 value',
    header: '#include <unordered_map>',
    sections: [
      { t: '定义', d: '声明一个「字符串 → 整数」的表', code: 'std::unordered_map<std::string, int> m;  // ' + s },
      { t: '增 / 改', d: '不存在就插入，存在就覆盖', code: 'm["a"] = 1;\nm.insert({"b", 2});' },
      { t: '查', d: '找不到时返回 end()', code: 'auto it = m.find("a");\nif (it != m.end()) { /* it->second */ }' },
      { t: '删', d: '按 key 删', code: 'm.erase("a");' },
      { t: '遍历', d: 'C++17 结构化绑定最省事', code: 'for (auto& [k, v] : m) { /* ... */ }' },
    ],
    apis: [{ n: 'find', sig: '', d: '查，返回迭代器' }, { n: 'count', sig: '', d: '存在返回 1' }],
    pitfalls: ['用 m[key] 查会把不存在的 key 建出来'],
  };
}
/* ★★ 「找方案」✓ —— 用户原话：「我**选中代码**，我需要实现这个功能，
   但是我不清楚该如何用，用什么包，函数等来实现…基于上下文**推荐**」✓。 */
const FAKE_PLAN = {
  plan: '用 unordered_map 边读边累加，key 是词、value 是次数。',
  names: FAKE_AI.names,
  example: 'std::unordered_map<std::string, int> freq;\nfor (const auto& w : words) freq[w]++;',
  steps: ['包含 <unordered_map>', '声明 freq 表', '遍历 words 累加'],
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
  let aiCalls = 0, flowCalls = 0, manualCalls = 0, planCalls = 0;
  /* ⚠️ 把「方案」那一次请求体存下来 ✓ —— 用来验「选中的代码有没有真的被当上下文送进去」✓
     （只看界面出没出方案 ✗ 验不出这个 ✓：不送上下文也照样有方案 ✓，只是瞎猜的 ✓）。 */
  let lastPlanBody = '';
  await p.route('**/api/ai/chat', async (r) => {
    aiCalls++;
    /* ⚠️ 按**请求内容**分岔 ✗（不是按调用顺序 ✓）——
       顺序会随着「哪个按钮先点」变 ✓，按顺序判必然错位 ✓。
       现在同一个接口上有**四条路**了 ✓，所以标记要挑**各自独有的词** ✓。 */
    let body = '';
    try { body = JSON.stringify(r.request().postDataJSON() || {}); } catch (_) {}
    const isManual = /速查手册/.test(body);
    const isPlan = /不知道用什么/.test(body);
    const isFlow = /讲成人话/.test(body);
    let payload = FAKE_AI;
    if (isManual) {
      manualCalls++;
      /* ⚠️ 手册要**跟着请求里的那个词**生成 ✗ —— 写死成「哈希表」的话 ✓，
         「手册里真的出现了那个符号」那条断言就变成在验假数据 ✗。
         ⚠️ 两种问法都要认 ✗：对着**符号**问（`符号：add` ✓）和
            对着**一句话**问（`他想问的是：哈希表定义` ✓，见 cgAskConcept ✓）。 */
      const mm = /符号：([^\n（(\\"]+)/.exec(body) || /他想问的是：([^\n\\"]+)/.exec(body);
      payload = fakeManual(mm ? mm[1].trim() : '');
    } else if (isPlan) { planCalls++; payload = FAKE_PLAN; lastPlanBody = body; }
    else if (isFlow) { flowCalls++; payload = FAKE_FLOW; }
    if (isFlow) {
      /* ★★ 故意**拖一会儿** ✗✗ —— 不给这点延迟的话 ✓，
         请求瞬间返回 ✓ → 「按下有反馈 / 忙碌转圈」根本来不及观察 ✓ →
         那两条断言就变成**恒真**（按钮已经恢复了 ✓）✗。
         1.6 秒够探针量一次计算样式了 ✓。 */
      await new Promise((ok) => setTimeout(ok, 1600));
    }
    return r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, content: '好的：\n```json\n' + JSON.stringify(payload) + '\n```\n' }),
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

    console.log('\n── ③ 🔍 查手册（打开就**自动带上下文查**，不用手打）──');
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
    /* ★★★★ ③b 「📖 怎么用」手册 ✓ —— 用户**最主要**的用途 ✗✗
       用户原话：「我主要需要的功能是…我需要用到哈希表，但是我不记得哈希表的如何定义，
                 以及如何实现**增删改查插**等，我就需要进查询，
                 就类似，以前程序员经常需要查**文档手册**一样去写代码」✓。
       ⚠️ 判据是「**这几段都在**」✗✗ —— 光有「定义」不够 ✓，
          用户点名的是「定义 + 增删改查」四件套 ✓（少一件他还是不会用 ✓）。 */
    console.log('\n── ③b 📖 「怎么用」手册（定义 / 增删改查 / 能照抄的代码）──');
    /* ⚠️ 得挑一条**有行号**的（本地符号 ✓）—— LSP 补全项没有行号 ✓，
       手册里那段「LSP 权威签名」就拿不到 ✓（hover 要行号 ✓）。 */
    const lsym = await p.evaluate(async () => {
      try {
        const r = await fetch('/api/graph?file=' + encodeURIComponent(CURRENT.file));
        const d = await r.json();
        const s = (d.symbols || []).find((x) => x && x.name && x.line
          && ['fn', 'type', 'macro', 'var', 'method'].indexOf(x.kind) >= 0);
        return s ? { name: s.name, line: s.line, kind: s.kind } : null;
      } catch (_) { return null; }
    });
    console.log('    拿这个本地符号试手册: ' + JSON.stringify(lsym));
    await p.locator('#cgx-q').fill((lsym && lsym.name) || placed);
    await p.locator('#cgx-go').click();
    await p.waitForTimeout(2600);
    ck('★ 卡片上有「怎么用」按钮（摆在**第一个** —— 这是主用途）',
      await p.locator('[data-cgact="manual"]').count() >= 1, String(await p.locator('[data-cgact="manual"]').count()));
    /* ⚠️ 记下**点的是哪一条** ✓ —— 手册是给它做的 ✓，
       「手册里有没有出现那个符号」要拿**它**比 ✓，不能拿别的 ✓。 */
    const manRow = await p.evaluate(() => {
      const b = document.querySelector('[data-cgact="manual"]');
      const row = b && b.closest ? b.closest('[data-cgrow]') : null;
      return row ? String(row.dataset.cgrow || '') : '';
    });
    console.log('    给这条做手册: ' + JSON.stringify(manRow));
    await p.locator('[data-cgact="manual"]').first().click();
    await p.waitForSelector('.cg-man', { timeout: 30000 }).catch(() => {});
    await p.waitForFunction(() => !document.querySelector('.cg-man .cg-spin'), null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(900);
    const man = await txt('.cg-man');
    console.log('    手册片段: ' + JSON.stringify(man.slice(0, 150)));
    ck('★★★ 手册出来了', /怎么用/.test(man), man.slice(0, 120));
    ck('★★★ 有「定义」（怎么声明）', /定义/.test(man), man.slice(0, 200));
    ck('★★★ 有「增 / 改」（怎么插进去）', /增/.test(man), man.slice(0, 240));
    ck('★★★ 有「查」', /查/.test(man), man.slice(0, 240));
    ck('★★★ 有「删」', /删/.test(man), man.slice(0, 260));
    ck('★★ 有「遍历」', /遍历/.test(man), man.slice(0, 260));
    const manCodes = await p.locator('.cg-man-code pre').count();
    console.log('    可抄的代码块: ' + manCodes);
    ck('★★★ 每段都配了**可以直接抄的代码**（不是只有文字说明）', manCodes >= 4, String(manCodes));
    /* ══ ★★★★ 代码块要**有语法高亮** ✗✗ ═══════════════════════════════════
       用户原话：「代码**缺少渲染和语法高亮**」✓（截图里手册的代码块全是灰白一片 ✗）。
       ⚠️ 复用的是页面自己那一套 ✓（`codeHtml()` ✓ —— 编辑器 / 定义速览 / Markdown 预览
          都用它 ✓，而且 `html[data-theme] .hljs-*` 有**主题变量覆盖** ✓ → 深浅色自动跟着走 ✓）。
       ⚠️⚠️ 但**不能给 `<pre>` 加 `hljs` 那个类** ✗✗ ——
          它在 `assets/hljs-theme.css` 里带着**写死的深色底** ✗
          （`.hljs{color:#abb2bf;background:#282c34}` ✓）→
          浅色主题下会糊成一块黑 ✗。下面两条一起守 ✓。 */
    const hl = await p.locator('.cg-man-code pre [class^="hljs-"]').count();
    console.log('    高亮片段: ' + hl);
    ck('★★★ 代码块**有语法高亮**（不是灰白一片）', hl >= 3, String(hl) + ' 个高亮片段');
    ck('★★★ 而且**没给 pre 加 `hljs` 类**（那个类带写死的深色底，浅色主题会糊成一块黑）',
      await p.locator('.cg-man-code pre.hljs, .cg-man-code pre code.hljs, .cg-man-code pre .hljs').count() === 0);
    ck('★★★ 手册里真的出现了**那个符号**（不是一份通用模板）',
      !!manRow && new RegExp(manRow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(man),
      '找 ' + manRow + ' → ' + man.slice(0, 140));
    ck('★★★ 「LSP 签名」和「AI 用法」**分开摆**（不能混成一份 —— 混了用户会把 AI 编的签名当真）',
      (await p.locator('.cg-man-sig').count()) === 1 && /LSP 签名/.test(man), man.slice(0, 200));
    ck('★★ 而且明确标了「AI 整理」（不假装是权威）', /AI 整理/.test(man), man.slice(0, 140));
    ck('★★ 底部说清了「编译不过以 LSP / 编译器为准」', /为准/.test(man), man.slice(-160));
    ck('★ 给了「要包含」的头文件 / import', /要包含/.test(man), man.slice(0, 200));
    ck('★ 有「常用成员」表', await p.locator('.cg-man-api tr').count() >= 1, String(await p.locator('.cg-man-api tr').count()));
    ck('★ 有「容易踩的坑」', await p.locator('.cg-man-pit li').count() >= 1, String(await p.locator('.cg-man-pit li').count()));
    ck('★★ 真的调了 AI 整理手册（不是本地编的）', manualCalls >= 1, String(manualCalls));
    /* 收起来 ✓ */
    await p.locator('[data-cgact="manual"]').first().click(); await p.waitForTimeout(500);
    ck('★ 再点一下能收起（开开关关）', (await p.locator('.cg-man').count()) === 0);

    /* ══ ★★★★ ③c 在「查手册」里问**一句话**也要能查 ✗✗ ═══════════════════
       用户原话：「**有些问题，怎么无法查阅，显示出来**」✓
       （截图里他在「查手册」里打的是「**哈希表定义**」✓，结果只看到一句「没找到」✗）。
       ⚠️ 根因 ✗：查手册走的是**符号模糊匹配** ✓ —— 而「哈希表定义」是**一句话** ✓，
          一个符号名都对不上 ✓ → 必然回「没找到」✗。
       ⚠️ 他问的是**概念** ✓，这条路上**根本没有符号可查** ✗ → 本地怎么搜都是白找 ✓
          → **只能让 AI 直答** ✓（这就是这一节要守的 ✓）。
       ⚠️ 但**不能**所有查不到的都去问 AI ✗（5~20 秒 ✓）——「`snpf` 打错了」不值得 ✓
          → 只在**含中文**时才自动走 ✓（见 cgIsQuestion ✓），下面两条一起守 ✓。 */
    console.log('\n── ③c 💬 在「查手册」里问一句话（中文）也要能查 ──');
    const qCallsBefore = manualCalls;
    await p.locator('[data-cgtab="look"]').click(); await p.waitForTimeout(700);
    await p.locator('#cgx-q').fill('哈希表定义');
    await p.locator('#cgx-go').click();
    await p.waitForSelector('.cg-man', { timeout: 40000 }).catch(() => {});
    await p.waitForFunction(() => !document.querySelector('.cg-man .cg-spin'), null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(900);
    const cm = await txt('.cg-man');
    console.log('    概念手册片段: ' + JSON.stringify(cm.slice(0, 150)));
    ck('★★★ 中文问题**不再是「没找到」**，而是真的给了一份手册',
      /怎么用/.test(cm) && cm.length > 60, cm.slice(0, 150));
    ck('★★ 手册里有「定义」（能照着写）', /定义/.test(cm), cm.slice(0, 180));
    ck('★★ 而且说清了「你问的是一句话，不是符号名」',
      /一句话|不是符号名/.test(await cgBody()), (await cgBody()).slice(0, 170));
    ck('★★ 真的调了 AI（不是本地编的）', manualCalls > qCallsBefore, qCallsBefore + ' → ' + manualCalls);
    ck('★ 有「重新整理」入口（概念手册没有卡片可以收起，得留个重来的按钮）',
      await p.locator('[data-cgact="concept"]').count() === 1);
    /* ⚠️ 反向：**英文符号**查不到时**不该**自动去问 AI ✗（那是 5~20 秒 ✓，不值得 ✓）*/
    const qCalls2 = manualCalls;
    await p.locator('#cgx-q').fill('zzzznosuchsymbol');
    await p.locator('#cgx-go').click();
    await p.waitForTimeout(2800);
    ck('★★ 但**英文符号**查不到时**不会**自动去问 AI（那是 5~20 秒，不值得）',
      manualCalls === qCalls2 && /没找到/.test(await cgBody()), qCalls2 + ' → ' + manualCalls);
    ck('★ 而且给了能点的例子（不让用户对着空白发呆）',
      await p.locator('.cg-demos .cg-btn').count() >= 3);

    console.log('\n── ④ 💡 找方案（大白话 → 候选，再回头核实）──');
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
    /* ★★★★ ④b 「选中代码 → 基于上下文给方案」✓ —— 用户原话：
       「以及我**选中代码**，我需要实现这个功能，但是我不清楚该如何用，
         用什么包，函数等来实现，所以，可以借助来查询，选中代码，
         基于上下文**推荐**，来给我推荐该可以通过什么方式实现等等」✓。
       ⚠️ 判据是「给了**方案**」✗✗，不只是「列了一堆候选名」✓ ——
          候选名解决不了「我该怎么把它们串起来」✓，那正是用户卡住的地方 ✓。 */
    console.log('\n── ④b 🧭 选中代码 → 基于上下文给方案（思路 + 步骤 + 例子）──');
    ck('★★★ 给了「建议这么实现」的方案块（不只是候选名清单）', await has('.cg-plan'), (await cgBody()).slice(0, 160));
    const planTxt = await txt('.cg-plan');
    console.log('    方案片段: ' + JSON.stringify(planTxt.slice(0, 140)));
    ck('★★★ 方案里有**思路**（为什么这么用）', /累加|unordered_map/.test(planTxt), planTxt.slice(0, 160));
    ck('★★ 方案里有**落地步骤**', await p.locator('.cg-plan .st li').count() >= 2, String(await p.locator('.cg-plan .st li').count()));
    ck('★★★ 方案里有**能直接改的示例代码**', await p.locator('.cg-plan .cg-man-code pre').count() === 1,
      String(await p.locator('.cg-plan .cg-man-code pre').count()));
    ck('★★ 示例代码也**有语法高亮**（和手册同一套）',
      await p.locator('.cg-plan .cg-man-code pre [class^="hljs-"]').count() >= 3,
      String(await p.locator('.cg-plan .cg-man-code pre [class^="hljs-"]').count()));
    ck('★★ 示例代码能一键插到光标处（不是只能看）',
      await p.locator('.cg-plan [data-cgact="use"]').count() === 1);
    ck('★★ 方案标了「AI 整理 · 供参考」（不假装权威）', /AI 整理/.test(planTxt), planTxt.slice(0, 120));
    ck('★★ 而且说清了「未核实的先确认名字」', /未核实|确认名字|已核实/.test(planTxt), planTxt.slice(-140));
    ck('★ 真的调了 AI 出方案', planCalls >= 1, String(planCalls));
    /* ⚠️⚠️ 「选中代码」这条要**真的验一下** ✗✗ —— 上面那次是「光标停在某一行」✓，
       严格说不算选中 ✓。这里手动框一段 ✓，再看它有没有**被当成上下文送进请求** ✓。
       ⚠️ 判据必须是「**请求体里出现了选中的那段原文**」✗ ——
          只看界面上有没有方案 ✗ 是验不出「上下文到底送没送」的 ✓
          （不送也照样有方案 ✓，只是方案是瞎猜的 ✓）。 */
    const selText = await p.evaluate(() => {
      try {
        const m = MONACO_EDITOR.getModel();
        const end = Math.min(m.getLineLength(1), 14);
        MONACO_EDITOR.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: end });
        return m.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: end });
      } catch (_) { return ''; }
    });
    console.log('    手动框选: ' + JSON.stringify(selText));
    ck('  框住了一段代码', String(selText).trim().length >= 5, JSON.stringify(selText));
    lastPlanBody = '';
    await p.locator('#cgx-go').click();
    await p.waitForTimeout(2800);
    /* ⚠️⚠️ 请求体是 **JSON.stringify 过的** ✗✗ —— 选区里的 `"` 会变成 `\"` ✓、
       换行会变成 `\n` ✓ → 拿**原文**去 indexOf **必然找不到** ✗
       （实测就是这么假失败的 ✓：选区是 `#include "calc.hpp"` ✓，body 里是 `#include \"calc.hpp\"` ✗）。
       → 先把转义还原回去 ✓ 再找 ✓。 */
    const flatBody = String(lastPlanBody)
      .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
    ck('★★★ 选中的那段代码**真的被当上下文送进请求了**（不是摆设）',
      !!lastPlanBody && String(selText).trim().length >= 5 && flatBody.indexOf(String(selText).trim()) >= 0,
      '找 ' + JSON.stringify(String(selText).trim()) + ' → ' + flatBody.slice(flatBody.indexOf('选中的代码'), flatBody.indexOf('选中的代码') + 180));

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

    /* ══ ★★★★ ⑤b 切页签**不丢结果、不重跑 AI** ✗✗ ═══════════════════════
       用户原话：「**AI 思考后切换按钮后，东西就丢失了，后面又得重新思考，太慢了**」✓。

       ⚠️⚠️ 原来切页签是**一把全清** ✗（`CG.rows = []` / `CG.graph = null` /
          `CG.aiFlow = null` / `CG.ai = null` ✓）→
          在「找方案」等 AI 想出方案 ✓ → 切去「拆逻辑」看一眼 ✓ → 切回来**全没了** ✗
          → 又得等 5~20 秒 ✓。
       ⚠️ AI 那几项**是真的慢**（5~20 秒 ✓），而切页签是**零成本的界面动作** ✓ ——
          把两者绑在一起毫无道理 ✗。
       ⚠️⚠️ 判据必须是**两条一起** ✗✗：
          ① 切回来**立刻**有东西 ✓（不是转圈 ✓）
          ② 而且**没重新问 AI** ✓（计数没涨 ✓）——
          只验①的话，「重跑一遍但很快返回」也能过 ✓（假 AI 是毫秒级 ✓）→ 恒真 ✗。
          这也是为什么下面那两次切换只等 **0.6 秒** ✓（真重跑的话来不及回来 ✓）。 */
    console.log('\n── ⑤b ★★★ 切页签不丢结果、不重跑 AI（用户原话「切走了就得重新思考，太慢了」）──');
    await p.locator('[data-cgact="view"][data-cgval="mind"]').click(); await p.waitForTimeout(700);
    const mindBefore = await txt('#cgx-mind');
    const flowBefore = flowCalls, planBefore = planCalls;
    /* ⚠️ 别在**拆逻辑**页签里取「输入框原值」✗ —— 那个页签的输入框是**禁用**的 ✓、
       值是空 ✓（`CG.q` 在 break 下本来就是 '' ✓）→ 拿它去比必然不等 ✗
       （实测就是这么假失败的 ✓）。要比就跟 ④ 里**真正用过的那句查询**比 ✓。 */
    const FIND_Q = '怎么把文件整个读进来';
    /* → 切到「找方案」 */
    await p.locator('[data-cgtab="find"]').click();
    await p.waitForTimeout(600);
    const planTxt2 = await txt('.cg-plan');
    console.log('    切回「找方案」0.6 秒后的内容: ' + JSON.stringify(planTxt2.slice(0, 70)));
    ck('★★★ 切到「找方案」**立刻**还有原来那份方案（不用再等 AI）',
      /建议这么实现/.test(planTxt2), planTxt2.slice(0, 90));
    ck('★★★ 而且**没有重新问 AI**（planCalls 没涨）', planCalls === planBefore, planBefore + ' → ' + planCalls);
    ck('★ 输入框里还是刚才那句话（不用重打）',
      (await p.evaluate(() => { const e = document.getElementById('cgx-q'); return e ? e.value : ''; })) === FIND_Q,
      JSON.stringify(await p.evaluate(() => { const e = document.getElementById('cgx-q'); return e ? e.value : ''; })));
    /* → 切回「拆逻辑」 */
    await p.locator('[data-cgtab="break"]').click();
    await p.waitForTimeout(600);
    const mindAfter = await txt('#cgx-mind');
    ck('★★★ 切回「拆逻辑」**立刻**还有那张导图', mindAfter.length > 20 && mindAfter === mindBefore,
      JSON.stringify(mindAfter.slice(0, 70)));
    ck('★★★ 而且**没有重新拆**（AI 没再跑一遍）', flowCalls === flowBefore, flowBefore + ' → ' + flowCalls);
    ck('★★ 连骨架代码都还在（切页签不该把整页冲掉）', await has('#cgx-skelcode'));
    ck('★★ 连当前视图都记得（切回来还是「思维导图」，不是跳回默认）',
      (await p.locator('#cgx-mind').count()) === 1 && (await p.locator('#cgx-graph').count()) === 0);

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

    /* ══ ★★★★ ⑦b 查阅历史 ✓ —— 用户原话：
       「再给我新增**查阅历史记录**，方便我回看」✓。

       ⚠️ 判据要**两条一起** ✗✗：
         ① 手动查的**进**历史 ✓
         ② 打开面板时「自动带上下文的查」**不进** ✗ ——
            不然开十次面板就刷出十条一样的 ✓（那不是「我查过的」✗，是「工具自己查的」✓）。
       ⚠️ 而且「回看」的目的十有八九是「再看一遍」✓ →
          点历史里的一条必须**真的重查** ✓（不只是展示 ✓）。
       ⚠️ 探针跑在**全新的浏览器 profile** 里 ✓ → localStorage 是隔离的 ✓
          （不会动到用户自己那份历史 ✓，所以这里可以直接清 ✓）。 */
    console.log('\n── ⑦b 🕘 查阅历史（回看 + 一键重查）──');
    const histOf = () => p.evaluate(() => { try { return (window.__CODE_GUIDE.state.hist || []).length; } catch (_) { return -1; } });
    /* 先清干净 ✓（前面几节已经查过好几轮了 ✓）*/
    await p.evaluate(() => { try { window.__CODE_GUIDE.state.hist = []; localStorage.removeItem('cg-hist'); } catch (_) {} });
    ck('  标题栏有「🕘 查阅历史」按钮', await p.locator('#cgx-hist').count() === 1);
    /* ① 自动带上下文的查**不该**进历史 ✗ */
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    await p.keyboard.press('Meta+i'); await p.waitForTimeout(1600);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    await p.keyboard.press('Meta+i'); await p.waitForTimeout(1600);
    const n0 = await histOf();
    ck('★★★ 打开面板时**自动带的光标词不进历史**（那十有八九是 `int` 这种噪音）', n0 === 0, String(n0));
    /* ①b 但「拆逻辑」自动拆的那个**函数名要记** ✓ —— 「我拆过 led_read」是有回看价值的 ✓ */
    await p.locator('[data-cgtab="break"]').click();
    await p.waitForFunction(() => !!document.getElementById('cgx-mind'), null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(900);
    const nBreak = await histOf();
    const breakName = await p.evaluate(() => { try { const h = window.__CODE_GUIDE.state.hist || []; return h.length ? String(h[0].q || '') : ''; } catch (_) { return ''; } });
    ck('★★★ 拆逻辑自动拆的**函数名进了历史**（这才有回看价值）',
      nBreak >= 1 && !!breakName, breakName + ' · 共 ' + nBreak + ' 条');
    await p.locator('[data-cgtab="look"]').click(); await p.waitForTimeout(900);
    /* ② 手动查两次 → 进历史 ✓ */
    await p.locator('#cgx-q').fill('main'); await p.locator('#cgx-go').click(); await p.waitForTimeout(2600);
    await p.locator('#cgx-q').fill('add'); await p.locator('#cgx-go').click(); await p.waitForTimeout(2600);
    const n1 = await histOf();
    ck('★★★ 手动查的**进了历史**', n1 >= 2, String(n1));
    /* ③ 面板能打开、内容对 ✓ */
    await p.locator('#cgx-hist').click(); await p.waitForTimeout(700);
    ck('★★★ 点「🕘」能打开历史面板', await has('.cg-hist'));
    const histTxt = await txt('.cg-hist');
    console.log('    历史面板: ' + JSON.stringify(histTxt.slice(0, 150)));
    ck('★★ 面板里能看到**刚才查过的那两个词**', /add/.test(histTxt) && /main/.test(histTxt), histTxt.slice(0, 150));
    ck('★★ 每行标了**是哪个页签**查的（🔍 查手册 / 💡 找方案 / 🧩 拆逻辑）', /🔍/.test(histTxt), histTxt.slice(0, 90));
    ck('★★ 时间写的是**人话**（「刚刚 / N 分钟前」），不是一串 ISO 时间',
      /刚刚|分钟前|小时前|天前/.test(histTxt), histTxt.slice(0, 150));
    ck('★ 而且新的排在**最上面**（`add` 是后查的）', histTxt.indexOf('add') < histTxt.indexOf('main'), histTxt.slice(0, 150));
    /* ④ 点一条 → **秒开**（不再问 AI）✓ —— 用户原话：
       「**为什么点击加载历史记录，还需要 AI 重新思考**」✓。
       ⚠️⚠️ 判据要**两条一起** ✗✗：
         ① 点完**立刻**就有内容 ✓（只等 0.5 秒 ✓ —— 真重跑的话这时候还没回来 ✓）；
         ② 而且 `aiCalls` **一次都没涨** ✓ —— 只验①的话，
            「重跑一遍但很快返回」也能过 ✓（假 AI 是毫秒级 ✓）→ 恒真 ✗。 */
    const goIdx = await p.evaluate(() => (window.__CODE_GUIDE.state.hist || []).findIndex((x) => x.q === 'main'));
    const callsBeforeGo = aiCalls;
    await p.locator('[data-cgact="histgo"][data-cgval="' + goIdx + '"]').click();
    await p.waitForTimeout(500);
    const afterGo = await p.evaluate(() => {
      const e = document.getElementById('cgx-q');
      return { q: e ? e.value : '', rows: document.querySelectorAll('.cg-row').length, panel: !!document.querySelector('.cg-hist') };
    });
    console.log('    点历史里那条 main → ' + JSON.stringify(afterGo) + '（AI 调用 ' + callsBeforeGo + ' → ' + aiCalls + '）');
    ck('★★★ 点历史里的一条 → **立刻**就有内容（不用再等 AI）',
      afterGo.q === 'main' && afterGo.rows >= 1, JSON.stringify(afterGo));
    ck('★★★ 而且**一次 AI 都没调**（结果跟着历史一起存下来了）',
      aiCalls === callsBeforeGo, callsBeforeGo + ' → ' + aiCalls);
    ck('★★ 而且历史面板**自己收起了**（不挡着刚摆出来的结果）', afterGo.panel === false);
    /* ⑤ 落盘 ✓ —— 「回看」跨会话才有意义 ✓ */
    const saved = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('cg-hist') || '[]').length; } catch (_) { return -1; } });
    ck('★★★ 历史**落盘**了（关掉再打开还在 —— 不然「回看」无从谈起）', saved >= 2, String(saved));
    /* ⑥ 清空 + 收起 ✓ */
    await p.locator('#cgx-hist').click(); await p.waitForTimeout(700);
    await p.locator('[data-cgact="histclear"]').click(); await p.waitForTimeout(700);
    const cleared = await histOf();
    const clearedLs = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('cg-hist') || '[]').length; } catch (_) { return -1; } });
    ck('★★ 「清空」能清掉（内存和落盘都清）', cleared === 0 && clearedLs === 0, cleared + ' / ' + clearedLs);
    ck('★ 清空后面板说了「还没查过东西」（不是一片空白）', /还没查过/.test(await txt('.cg-hist')), (await txt('.cg-hist')).slice(0, 80));
    await p.locator('[data-cgact="hist"]').click(); await p.waitForTimeout(600);
    ck('★ 「收起」能关掉面板', (await p.locator('.cg-hist').count()) === 0);

    /* ══ ★★★★ ⑦c 存到知识库 ✓ —— 用户原话：
       「给所查询的记录，做一个**注入到知识库**的按钮，同时做好**管理和分类**，
        这样可以把一些常用的记录下来，到知识库，做成**技术知识积累**」✓。

       ⚠️⚠️ 这一段会往**真知识库**里写东西 ✗✗ —— 所以：
        ① 分类 / 项目 / 标题全用 `__探针代码向导__` 这种**一眼能认出来的名字** ✓；
        ② 跑完**必须自己删掉** ✓（删项目 + 删分类 ✓），并且**断言删干净了** ✓；
        ③ 名字里不带探针标记的话，用户的知识库里会多出一篇莫名其妙的东西 ✗。 */
    console.log('\n── ⑦c 📥 存到知识库（分类 / 项目 + 能接着编辑）──');
    await p.locator('[data-cgtab="find"]').click(); await p.waitForTimeout(700);
    await p.locator('#cgx-q').fill('我想统计一段文本里每个词出现了几次');
    await p.locator('#cgx-go').click(); await p.waitForTimeout(3400);
    ck('★★ 结果区有「存到知识库」按钮', await p.locator('[data-cgact="asksavecur"]').count() >= 1);
    await p.locator('[data-cgact="asksavecur"]').first().click();
    await p.waitForSelector('.cg-ask', { timeout: 10000 }).catch(() => {});
    ck('★★★ 点它弹出「存到知识库」对话框（页内浮层，不是原生弹窗）', await has('.cg-ask'));
    const askTxt = await txt('.cg-ask');
    console.log('    对话框: ' + JSON.stringify(askTxt.slice(0, 130)));
    ck('★★ 对话框里有**分类 / 项目 / 标题**三项',
      /分类/.test(askTxt) && /项目/.test(askTxt) && /标题/.test(askTxt), askTxt.slice(0, 130));
    ck('★★ 而且写清了**会存到哪个路径**（存之前就知道）', /知识库\//.test(askTxt), askTxt.slice(0, 170));
    ck('★★ 还能**预览正文**（存之前看得出要存什么）', /由「代码向导」/.test(askTxt), askTxt.slice(0, 200));
    /* ★★★ 分类 / 项目是**下拉**，而且**能建新的** ✗✗ —— 用户原话：
       「**没有其他选择**，比如代码向导里面去」✓。
       ⚠️ 原来是 `<datalist>` 输入框 ✗ —— 在 macOS 上长得就像个下拉 ✓，
          用户根本不会想到「这里还能自己打字」✗ → 等于**锁死在现有分类里** ✗。 */
    const catOpts = await p.locator('#cg-ask-cat option').allTextContents();
    console.log('    分类下拉: ' + JSON.stringify(catOpts));
    ck('★★★ 分类是**下拉**（列出现有的），而且带「＋ 新建分类…」',
      catOpts.some((x) => /新建分类/.test(x)), JSON.stringify(catOpts));
    const projOpts = await p.locator('#cg-ask-proj option').allTextContents();
    console.log('    项目下拉: ' + JSON.stringify(projOpts));
    ck('★★★ 项目也是下拉，而且带「＋ 新建项目…」',
      projOpts.some((x) => /新建项目/.test(x)), JSON.stringify(projOpts));
    /* ⚠️ 这条要**真去对一遍** ✗ —— 光看「下拉里有东西」是恒真的 ✓。
       判据：项目下拉里那几项，**必须都属于当前分类** ✓（不是把别的分类的项目也堆上来 ✗）。 */
    const kbNow = await p.evaluate(async () => (await (await fetch('/api/knowledge/status', { cache: 'no-store' })).json()));
    const catNow = await p.locator('#cg-ask-cat').inputValue().catch(() => '');
    const expect = new Set((kbNow.pages || [])
      .filter((x) => String(x.path).indexOf(catNow + '/') === 0)
      .map((x) => String(x.path).split('/')[1]));
    const gotProj = projOpts.filter((x) => !/新建|还没有/.test(x));
    console.log('    当前分类 ' + JSON.stringify(catNow) + ' → 该有的项目 ' + JSON.stringify([...expect]) + '，下拉里 ' + JSON.stringify(gotProj));
    ck('★★★ 项目列表**只列当前分类下的**（不是把所有项目都堆上来）',
      gotProj.every((x) => expect.has(x)), JSON.stringify({ cat: catNow, gotProj, expect: [...expect] }));
    await p.locator('#cg-ask-cat').selectOption('__new__');
    await p.waitForTimeout(500);
    ck('★★★ 选「＋ 新建分类…」→ **变成输入框**（说明「能建新的」看得见）',
      await p.locator('#cg-ask-cat').evaluate((el) => el.tagName) === 'INPUT');
    await p.locator('#cg-ask-title').fill('__探针词频方案__');
    await p.locator('#cg-ask-cat').fill('__探针代码向导__');
    await p.waitForTimeout(500);
    /* ⚠️ 新建分类之后，项目那一格**自己就变成输入框**了 ✗ ——
       新分类下当然没有项目 ✓（这是对的行为 ✓，不是 bug ✓）→
       不能无脑 `selectOption` ✗，得看它现在是什么标签 ✓。 */
    const projTag = await p.locator('#cg-ask-proj').evaluate((el) => el.tagName);
    ck('★★ 新建分类之后，项目那格**自动变成输入框**（新分类下本来就没有项目）',
      projTag === 'INPUT', projTag);
    if (projTag === 'SELECT') { await p.locator('#cg-ask-proj').selectOption('__new__'); await p.waitForTimeout(500); }
    await p.locator('#cg-ask-proj').fill('__探针分类__');
    await p.waitForTimeout(500);
    ck('★ 路径预览**跟着输入实时更新**（不用重绘、不丢焦点）',
      /__探针代码向导__/.test(await txt('.cg-ask-path')), await txt('.cg-ask-path'));
    await p.locator('[data-cgact="askrun"]').click();
    await p.waitForTimeout(3800);
    ck('★★★ 存完对话框**自己关了**', (await p.locator('.cg-ask').count()) === 0);
    const kb1 = await p.evaluate(async () => (await (await fetch('/api/knowledge/status', { cache: 'no-store' })).json()));
    const hit = (kb1.pages || []).find((x) => String(x.path).indexOf('__探针代码向导__') === 0);
    console.log('    知识库里: ' + JSON.stringify(hit || null));
    ck('★★★ 文件**真的进了知识库**（`/api/knowledge/status` 列得到它）',
      !!hit, JSON.stringify((kb1.pages || []).map((x) => x.path).slice(0, 6)));
    /* ⚠️⚠️ 还要断言**没有存到别的地方** ✗✗ ——
       实测踩过：拉分类列表回来时会**重绘** ✓，而重绘会把已经填好的分类
       **抹回默认值** ✗ → 文件存进了**用户自己的**「快速开始 / 使用指南」✗；
       而上面那条断言只盯 `__探针代码向导__` ✓ → **根本看不见它** ✗
       （用户的知识库里就这么多了一篇莫名其妙的东西 ✓）。
       → 这里再查一次：探针那个标题**不许出现在别的分类下** ✓。 */
    const strays = (kb1.pages || []).filter((x) => String(x.path).indexOf('__探针词频方案__') >= 0
      && String(x.path).indexOf('__探针代码向导__') !== 0);
    ck('★★★ 而且**没有**存到别的分类下（填好的分类不能被重绘抹回默认值）',
      strays.length === 0, JSON.stringify(strays.map((x) => x.path)));
    for (const s of strays) {
      try {
        await p.evaluate(async (rel) => {
          await fetch('/api/readings/delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '知识库/' + rel }),
          });
        }, s.path);
      } catch (_) {}
    }
    const content = await p.evaluate(async () => {
      const r = await fetch('/api/readings/text-fragment?path=' + encodeURIComponent('知识库/__探针代码向导__/__探针分类__/__探针词频方案__.md'), { cache: 'no-store' });
      const d = await r.json();
      return d && d.ok ? String(d.content || '') : ('✗ ' + ((d && d.error) || '读不到'));
    });
    console.log('    存进去的正文片段: ' + JSON.stringify(content.slice(0, 160)));
    ck('★★★ 存的是**查到的内容**（不是空模板 —— 有思路 / 步骤 / 示例）',
      /## 思路|## 步骤|## 示例/.test(content) && content.length > 150, content.slice(0, 160));
    ck('★★ 而且带了**来源说明**（一眼知道是哪来的、什么时候存的）',
      /由「代码向导」/.test(content), content.slice(0, 200));
    ck('★★ 还写了 frontmatter（title / tags）—— 知识库里能搜到',
      /^---\ntitle:/.test(content) && /tags:/.test(content), content.slice(0, 130));
    /* ★ 清干净 ✓ —— 探针在**真知识库**里写过东西 ✗，必须自己收掉 ✓ */
    await p.evaluate(async () => {
      await fetch('/api/readings/project/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: '知识库/__探针代码向导__/__探针分类__' }),
      });
      await fetch('/api/readings/folder/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: '知识库/__探针代码向导__' }),
      });
    });
    await p.waitForTimeout(800);
    const kb2 = await p.evaluate(async () => (await (await fetch('/api/knowledge/status', { cache: 'no-store' })).json()));
    ck('★★ 探针**自己清干净了**（没在真知识库里留东西）',
      !(kb2.pages || []).some((x) => String(x.path).indexOf('__探针代码向导__') === 0),
      JSON.stringify((kb2.pages || []).map((x) => x.path).slice(0, 6)));

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
