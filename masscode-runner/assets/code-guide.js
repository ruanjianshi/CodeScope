/* ══════════════════════════════════════════════════════════════════════════
   🧭 代码向导（CodeGuide）—— 写代码时随手可用的「查 / 找 / 拆」浮层
   ══════════════════════════════════════════════════════════════════════════
   ★ 用户原话（2026-10-08）：
     「我常常在写代码的时候，需要用到很多库，每个库里面有很多函数、等变量，
       有些我记不清了，但是我记得我需要大致什么功能，那么我可以通过这个弹出的
       指导工具，告诉我该变量是什么，怎么用等等；还有些，我不太清楚，大致需要
       用到什么函数或变量，我同样需要这个指导工具，可以给我相关指导和推荐，
       然后给我解析；包括还有一些实现逻辑，我可能捋不清了，这个指导工具和帮我
       拆解和可视化，图解逻辑图分析，告诉我该怎么实现等等。
       我需要这个指导工具，便捷，简洁，方便，随时可用可观，可查等等。」

   ── 三个模式（一个输入框 + 三个页签）────────────────────────────────────
     ① 查符号：我记得个大概名字 / 不确定怎么用
              → 当前文件里的符号模糊搜 + **LSP hover / 签名**（权威 ✓）
     ② 找函数：我只知道要什么功能，不知道用哪个
              → **LSP 补全**（在光标处，权威 ✓）+ AI 给候选名 → 再拿 LSP 核实
     ③ 拆逻辑：这段逻辑我捋不清
              → **逻辑图**（`/api/logic/graph` + 复用 `buildLogicFlow` 画出来）
              + AI 讲一遍 + **骨架代码**（`/api/logic/skeleton`）

   ── ★★★ 这个文件最重要的一条设计原则（别改）────────────────────────────
     **精确的东西必须来自「确定性来源」** ✗✗：
       签名 / 参数名 / 参数顺序 / 返回值 / 这个符号**到底存不存在** ——
       一律走 **LSP** 或**代码图谱**（`/api/graph`）✓，
       **绝不让模型来写** ✗。

     AI 只干两件事 ✓：
       · 把「我想把字符串转成整数」这种**自然语言**翻成**候选符号名**（它擅长这个 ✓）；
       · 解释 / 拆解逻辑（不涉及精确签名 ✓）。

     ⚠️ 为什么这么死板 ✗：模型给的签名**看着特别像真的** ✓（`strtol(const char*, char**, int)` ✓），
        参数顺序错一个、返回类型错一个 ✓，用户复制过去**编译不过** ✓，
        而他**多半会以为是自己的问题** ✗（和「音标背错」「拆词编词根」是同一类事故 ✓）。
     → 所以每一条结果都**必须标来源** ✓：
         `LSP ✓ 已核实` / `本地符号 ✓` / `AI 建议 · 未核实 ⚠️` —— 不许含混 ✗。

   ── ⚠️⚠️ 技术约束：本文件**必须是经典脚本**（`<script src=… defer>`）✗✗
     不能用 `type="module"` ✗ —— 因为 `CURRENT` / `CINDEX` / `MONACO_EDITOR`
     是 `index.html` 里**顶层 `let`** ✓，只有**经典脚本**才和它共享全局词法环境 ✓
     （模块有自己的作用域 ✓，读不到 ✓ —— 这个坑项目里踩过 ✓）。
     ⚠️ 而且要**惰性读** ✗：`let` 在 TDZ 里读会抛 ✓ ——
        只在**用户真的打开浮层时**才去碰它们 ✓，模块顶层一个都不碰 ✓。

   ⚠️ 本文件**不用 build** ✓（和 `assets/life-workbench.js` 一样 ✓）——
     改完硬刷新即可 ✓；但 `tests/syntax.js` 的外链清单要能覆盖到它 ✓。
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 状态 ✓（只放内存 ✗ —— 关掉浮层就该忘掉 ✓）──────────────────────── */
  const CG = {
    open: false,
    tab: 'look',          /* look = 查 / find = 找 / break = 拆 ✓ */
    q: '',                /* 输入框内容 ✓ */
    busy: false,
    err: '',
    rows: [],             /* 结果条目 ✓（每条带 source ✓）*/
    ai: null,             /* AI 那一路的状态：{ busy, err, names, hint } ✓ */
    graph: null,          /* 拆逻辑：{ payload, root, err } ✓ */
    note: '',             /* 一句提示（比如「这段不是函数体，画不了图」）✓ */
    sym: null,            /* 当前文档的符号索引缓存 ✓ */
    symFor: '',           /* 缓存是给哪个文件算的 ✓ */
    list: null,           /* LSP 补全缓存 ✓ */
    listFor: '',
    /* ★ 折起来了没 ✓（用户原话：「也可以拖动放到一边」✓）——
       折起来只剩顶栏一条 ✓，不挡代码 ✓；状态**落盘** ✓（见 cgWinSave ✓）。 */
    min: false,
  };

  /* ── 小工具 ✓ ─────────────────────────────────────────────────────────── */
  const $ = (sel, root) => (root || document).querySelector(sel);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg) {
    /* 复用页面自己的 toast（有就用 ✓，没有就退回一句 console ✓）——
       ⚠️ 绝不弹原生 alert ✗（这个项目明令禁止 ✓，用户原话：
          「把这种弹出这种窗口的写入，等都修改掉」✓）。 */
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    } catch (_) {}
    let el = document.getElementById('cgx-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cgx-toast';
      el.className = 'cg-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('on'), 3200);
  }

  /* ══ ① 上下文 ✓ —— 「用户现在在哪、在写什么」════════════════════════════
     ⚠️ 全部**惰性读** ✗（见文件头那条 TDZ 警告 ✓）。拿不到就返回 null ✓，
        绝不让整块浮层崩掉 ✗。 */
  function cgCtx() {
    try {
      const cur = (typeof CURRENT !== 'undefined') ? CURRENT : null;
      if (!cur || !cur.file) return null;
      const idx = (typeof CINDEX !== 'undefined') ? Number(CINDEX) || 0 : 0;
      const frag = cur.fragments && cur.fragments[idx] ? cur.fragments[idx] : null;
      if (!frag) return null;
      const ed = (typeof MONACO_EDITOR !== 'undefined') ? MONACO_EDITOR : null;
      let pos = null, sel = null;
      try { if (ed && ed.getPosition) pos = ed.getPosition(); } catch (_) {}
      try { if (ed && ed.getSelection) sel = ed.getSelection(); } catch (_) {}
      let selText = '';
      try {
        if (ed && sel && ed.getModel && !sel.isEmpty && !sel.isEmpty()) selText = String(ed.getModel().getValueInRange(sel) || '');
      } catch (_) {}
      /* ⚠️ 选区可能是空的 ✓ —— 那就退回「光标所在那一行」✓
         （用户不选、直接把光标放在一行上也是很常见的用法 ✓）。 */
      if (!selText && pos) {
        try {
          const line = ed.getModel().getLineContent(pos.lineNumber);
          if (String(line || '').trim().length > 2) selText = String(line).trim();
        } catch (_) {}
      }
      return {
        file: String(cur.file),
        name: String(cur.name || ''),
        index: idx,
        language: String(frag.language || ''),
        filename: String(frag.filename || ''),
        code: String(frag.code || ''),
        line: pos ? Number(pos.lineNumber) : 1,
        column: pos ? Number(pos.column) : 1,
        sel: selText,
      };
    } catch (_) { return null; }
  }
  const LSP_LANGS = ['c', 'c_cpp', 'python', 'javascript', 'typescript', 'go'];

  /* ══ ② 当前文档的符号索引 ✓（走已有的代码图谱接口 ✓，不另造一套 ✗）════ */
  async function cgSymbols(force) {
    const ctx = cgCtx();
    if (!ctx) return [];
    if (!force && CG.sym && CG.symFor === ctx.file) return CG.sym;
    try {
      const r = await fetch('/api/graph?scope=document&file=' + encodeURIComponent(ctx.file));
      const d = await r.json();
      /* ⚠️ 接口的形状要**容错** ✗ —— 文档级图谱返回的是若干组节点 ✓，
         不同版本字段名可能不一样 ✓；这里把「看起来像符号」的都收进来 ✓，
         收错了顶多多几条候选 ✓，收漏了才是真丢东西 ✓。 */
      const out = [];
      const seen = new Set();
      const push = (o) => {
        const name = String((o && (o.name || o.label || o.text)) || '').trim();
        if (!name || name.length > 120 || seen.has(name)) return;
        seen.add(name);
        out.push({ name, kind: String((o && (o.kind || o.type)) || ''), line: Number((o && (o.line || o.startLine)) || 0) || 0 });
      };
      const walk = (v, depth) => {
        if (!v || depth > 4) return;
        if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
        if (typeof v !== 'object') return;
        if (v.name || v.label) push(v);
        ['nodes', 'functions', 'symbols', 'items', 'children', 'groups', 'subgraphs'].forEach((k) => walk(v[k], depth + 1));
      };
      walk(d, 0);
      CG.sym = out;
      CG.symFor = ctx.file;
      return out;
    } catch (_) { return []; }
  }

  /* ══ ③ 模糊匹配 ✓ —— 「记得个大概」也能搜到 ✓══════════════════════════
     ⚠️ 判据要**分层** ✗（分数差一档就是一个量级 ✓，别混在一起排序 ✓）：
       完全相等 > 前缀 > 子串 > 子序列（`snpf` → `snprintf` ✓）。 */
  function cgScore(name, q) {
    const n = String(name).toLowerCase(), s = String(q).toLowerCase();
    if (!s) return 1;
    if (n === s) return 1000;
    if (n.indexOf(s) === 0) return 800 - n.length;
    const at = n.indexOf(s);
    if (at > 0) return 600 - at * 2 - n.length;
    /* 子序列：把 q 的字符按顺序在 n 里找一遍 ✓（打错 / 缩写都能中 ✓）*/
    let i = 0;
    for (let k = 0; k < n.length && i < s.length; k++) if (n[k] === s[i]) i++;
    if (i === s.length) return 300 - n.length;
    /* 最后再试「标点 / 下划线不敏感」✓（`str_len` → `strlen` ✓） */
    const strip = (x) => String(x).replace(/[^a-z0-9]/g, '');
    /* ⚠️⚠️ **必须先判「剥完还是不是空的」** ✗✗ —— 实测踩到 ✓：
          用户输入的是**中文**（「怎么把文件整个读进来」✓）→
          `strip(s)` 把汉字全剥掉 → 得到**空串** ✗ →
          而 `'add'.indexOf('') === 0` ✓ **恒成立** ✗ →
          **所有符号全部匹配上** ✗✗（截图里 `main.cpp` / `int` 这种噪音全冒出来了 ✓）。
          → 剥完是空的就**当这条兜底不存在** ✓。 */
    const qs = strip(s);
    if (qs && strip(n).indexOf(qs) >= 0) return 200 - n.length;
    return 0;
  }
  function cgBest(rows, q, limit) {
    return rows.map((r) => ({ r, sc: cgScore(r.name || r.label || '', q) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, limit || 12)
      .map((x) => x.r);
  }

  /* ══ ④ LSP ✓（唯一的「权威」来源 ✓）════════════════════════════════════
     ⚠️ `file` 必须是 **snippet 的绝对路径** ✓、`fragment` 是**数字下标** ✓、
        `line`/`column` 是 **1-based** ✓（服务端自己减 1 ✓，别在这儿减 ✗）。 */
  async function cgLsp(action, extra) {
    const ctx = cgCtx();
    if (!ctx) return { ok: false, error: '没有打开任何文件' };
    if (LSP_LANGS.indexOf(ctx.language) < 0) {
      return { ok: false, available: false, error: '这个语言还没配 LSP（当前支持：C / C++ / Python / JS / TS / Go）' };
    }
    try {
      const r = await fetch('/api/lsp/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({
          file: ctx.file, fragment: ctx.index, code: ctx.code,
          action, line: ctx.line, column: ctx.column,
        }, extra || {})),
      });
      return await r.json();
    } catch (e) { return { ok: false, error: '连不上 LSP：' + String((e && e.message) || e) }; }
  }

  /* ══ ⑤ AI ✓（只用来出「候选名」和「解释」✓）════════════════════════════
     ⚠️ 配置**复用页面那一份** ✓（`aiCfg()` ✓，localStorage 的 `mc-ai-cfg` ✓）——
        绝不让用户在这儿再配一次 ✗。 */
  function cgAiCfg() {
    try { if (typeof aiCfg === 'function') return aiCfg() || null; } catch (_) {}
    try { return JSON.parse(localStorage.getItem('mc-ai-cfg') || 'null'); } catch (_) { return null; }
  }
  function cgAiErr(msg) {
    const s = String(msg || '');
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(s)) {
      return '连不上本机服务 —— 多半是 CodeScope 刚重启过（重启会掐断正在跑的请求）。等一下再点一次就好 ✓';
    }
    if (/401|403|Unauthorized|invalid.*key/i.test(s)) return 'API Key 不对或没权限 —— 去右侧「AI」面板检查一下 ✓';
    if (/404/.test(s)) return 'API 地址不对（404）—— 去右侧「AI」面板检查一下 ✓';
    if (/429|rate.?limit/i.test(s)) return '被限流了 —— 缓一会儿再试 ✓';
    if (/timeout|超时|abort/i.test(s)) return '等太久了（模型没在时限内回）—— 再点一次试试 ✓';
    return s;
  }
  async function cgAi(system, user, timeoutMs) {
    const cfg = cgAiCfg();
    if (!cfg || !cfg.url || !cfg.model) {
      throw new Error('还没配 AI —— 去右侧「AI」面板填一下模型和 Key（这里会自动复用 ✓）');
    }
    const r = await fetch('/api/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: cfg.url, key: cfg.key, model: cfg.model,
        timeoutMs: timeoutMs || 120000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    const d = await r.json();
    if (!d || !d.ok) throw new Error(cgAiErr((d && d.error) || 'AI 请求失败'));
    return String(d.content || '');
  }
  /* 从模型回复里抠出 JSON ✓（剥 ```json 围栏 + 前后废话 ✓，和别处同一套 ✓）*/
  function cgJson(text) {
    let t = String(text || '').trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) t = fence[1].trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    try { return JSON.parse(t); } catch (_) { return null; }
  }

  /* ══ ⑥ 模式一：查符号 ✓ ════════════════════════════════════════════════
     两条路一起给 ✓：
       · **本地符号**（当前文档的代码图谱 ✓）—— 能跳转 ✓
       · **LSP 补全**（光标处 ✓）—— 权威 ✓，但没行号 ✗
     选中一条之后再去问 **hover** ✓ 拿文档 ✓（省着点用 ✓，LSP 是重资源 ✓）。 */
  async function cgRunLook() {
    const ctx = cgCtx();
    if (!ctx) { CG.err = '先打开一个代码文件 ✓'; return; }
    const q = CG.q.trim();
    CG.rows = [];
    if (!q) {
      /* 空查询 → 就把**光标底下那个词**当成查询 ✓（最常见的用法：光标放上去直接 ⌘I ✓）*/
      let word = '';
      try {
        const ed = (typeof MONACO_EDITOR !== 'undefined') ? MONACO_EDITOR : null;
        const m = ed && ed.getModel && ed.getPosition && ed.getModel().getWordAtPosition(ed.getPosition());
        word = String((m && m.word) || '');
      } catch (_) {}
      if (!word) { CG.note = '输入一个符号名（记得个大概也行，支持 snpf → snprintf 这种缩写）✓'; return; }
      CG.q = word;
      const inp = $('#cgx-q'); if (inp) inp.value = word;
    }
    const q2 = CG.q.trim();
    const syms = await cgSymbols();
    const local = cgBest(syms, q2, 10).map((s) => ({
      name: s.name, kind: s.kind, line: s.line,
      source: 'local', label: '本地符号 ✓', detail: s.line ? ('第 ' + s.line + ' 行') : '',
    }));
    CG.rows = local;
    /* LSP 补全（在光标处 ✓）—— 用来把「标准库 / 三方库」那些不在本文档里的也带出来 ✓ */
    if (LSP_LANGS.indexOf(ctx.language) >= 0) {
      if (!CG.list || CG.listFor !== ctx.file + '#' + ctx.index) {
        const d = await cgLsp('completion', { triggerKind: 1 });
        CG.list = (d && d.ok && Array.isArray(d.items)) ? d.items : [];
        CG.listFor = ctx.file + '#' + ctx.index;
      }
      const lsp = cgBest(CG.list, q2, 10).map((it) => ({
        name: it.label, kind: it.kind, line: 0,
        source: 'lsp', label: 'LSP ✓ 已核实',
        detail: it.detail || '', doc: it.documentation || '', insert: it.insertText || it.label,
      }));
      /* 合并去重 ✓：同名时**以 LSP 为准** ✓（它更权威 ✓）*/
      const have = new Set(lsp.map((x) => x.name));
      CG.rows = lsp.concat(local.filter((x) => !have.has(x.name)));
    }
    if (!CG.rows.length) {
      CG.note = '没找到「' + q2 + '」相关的符号。'
        + '换个写法试试（缩写 / 片段都行），或者切到「💡 找」用大白话描述你要干什么 ✓';
    } else {
      CG.note = '';
    }
  }

  /* ══ ⑦ 模式二：找函数 ✓ ════════════════════════════════════════════════
     ★★ 两步走（这是整个工具最要紧的地方 ✓）：
       ① **先搜本地**（符号索引 + 光标处的 LSP 补全 ✓）—— 已核实 ✓
       ② **再问 AI 要候选名** ✓ —— 拿到名字之后**回头去核实** ✓：
          能在①里找到的 → 标「已核实」✓；
          找不到的 → 标「AI 建议 · 未核实 ⚠️」✓，并且**只显示名字和用法**，
          **绝不显示 AI 编的签名** ✗✗。
     ⚠️ 顺序不能反 ✗ —— 先问 AI 的话，用户第一眼看到的就是一堆没核实的东西 ✓。 */
  async function cgRunFind() {
    const ctx = cgCtx();
    if (!ctx) { CG.err = '先打开一个代码文件 ✓'; return; }
    const q = CG.q.trim();
    if (!q) { CG.note = '用大白话描述你要干什么，比如「把字符串转成整数」「读一个文件」「定时器」✓'; return; }
    const syms = await cgSymbols();
    const words = q.split(/[\s,，。、；;：:]+/).filter((x) => x.length >= 2);
    const localHit = new Map();
    words.forEach((w) => cgBest(syms, w, 6).forEach((s) => localHit.set(s.name, s)));
    if (LSP_LANGS.indexOf(ctx.language) >= 0) {
      if (!CG.list || CG.listFor !== ctx.file + '#' + ctx.index) {
        const d = await cgLsp('completion', { triggerKind: 1 });
        CG.list = (d && d.ok && Array.isArray(d.items)) ? d.items : [];
        CG.listFor = ctx.file + '#' + ctx.index;
      }
      words.forEach((w) => cgBest(CG.list, w, 6).forEach((it) => {
        if (!localHit.has(it.label)) localHit.set(it.label, { name: it.label, kind: it.kind, line: 0, _lsp: it });
      }));
    }
    CG.rows = Array.from(localHit.values()).map((s) => ({
      name: s.name, kind: s.kind, line: s.line,
      source: 'local', label: '本地 / LSP ✓ 已核实',
      detail: s.line ? ('第 ' + s.line + ' 行') : '', doc: (s._lsp && s._lsp.documentation) || '',
    }));
    /* ② 问 AI 要候选名 ✓（只要名字 ✓）*/
    CG.ai = { busy: true, err: '', names: [], hint: '' };
    cgRender();
    try {
      const sys = '你是编程助手。用户用中文描述他想做的事，你**只输出候选 API 名字**，'
        + '不要写代码、不要解释、不要客套。\n'
        + '⚠️ **只给真实存在的**函数 / 类型名（标准库或这个语言里通用的）——'
        + '不确定的**宁可不写**，绝不编造 ✗。';
      const usr = '语言：' + (ctx.language || '未知') + '\n'
        + '文件：' + (ctx.filename || ctx.file) + '\n'
        + '他正在写的上下文（光标附近，可能为空）：\n' + String(ctx.sel || '').slice(0, 400) + '\n\n'
        + '他想做的事：' + q + '\n\n'
        + '请给 4~8 个候选，输出**一个 JSON 对象**（不要 markdown 围栏）：\n'
        + '{"names":[{"n":"函数名","why":"一句话：它管什么","use":"一行最简用法示例"}],"hint":"一句话说明这几个的关系 / 该选哪个"}';
      const out = await cgAi(sys, usr);
      const o = cgJson(out);
      const names = (o && Array.isArray(o.names) ? o.names : []).map((x) => (typeof x === 'string'
        ? { n: x, why: '', use: '' }
        : { n: String((x && x.n) || ''), why: String((x && x.why) || ''), use: String((x && x.use) || '') }))
        .filter((x) => x.n && x.n.length <= 80).slice(0, 10);
      if (!names.length) throw new Error('模型没按要求返回 JSON（再点一次试试）');
      /* ★ 核实 ✓ —— 拿 AI 给的名字，回头去①那份**已核实**的名单里找 ✓ */
      const known = new Set(CG.rows.map((x) => x.name.toLowerCase()));
      const extra = names.filter((x) => !known.has(x.n.toLowerCase())).map((x) => ({
        name: x.n, kind: '', line: 0,
        source: 'ai', label: 'AI 建议 · 未核实 ⚠️',
        detail: x.why, use: x.use,
      }));
      CG.rows = CG.rows.concat(extra);
      CG.ai = { busy: false, err: '', names, hint: String((o && o.hint) || '') };
      CG.note = extra.length
        ? '下面带「AI 建议 · 未核实 ⚠️」的那几条，是模型根据你的描述想出来的 ✓ —— '
          + '我没有在本地核实过它们 ✗。用之前先确认名字对不对（编译器 / 编辑器报错为准 ✓）。'
        : 'AI 给的候选**全都在本地核实过了** ✓。';
    } catch (e) {
      CG.ai = { busy: false, err: String((e && e.message) || e), names: [], hint: '' };
      if (!CG.rows.length) CG.note = '';
    }
  }

  /* ══ ⑧ 模式三：拆逻辑 ✓ ════════════════════════════════════════════════
     ⚠️ 逻辑图**需要一个「函数符号」** ✗（`/api/logic/graph` 是按 `line` 找函数的 ✓）。
        所以：光标 / 选区**落在哪个函数里**，就拆哪个 ✓；
        不在任何函数里 → 老实说「选一个函数」✓，别硬画 ✗（硬画出来的图是错的 ✓）。
     ⚠️ 画图复用页面**已有的** `buildLogicFlow()` ✓ —— 不另写一套渲染 ✗
        （同一张图两种画法，迟早对不上 ✓）。 */
  async function cgRunBreak() {
    const ctx = cgCtx();
    if (!ctx) { CG.err = '先打开一个代码文件 ✓'; return; }
    CG.graph = null;
    const syms = await cgSymbols();
    /* 找「包含光标行的、行号最大的那个符号」✓（函数是嵌套的 ✓，取最里层 ✓）*/
    const line = ctx.line;
    let root = null;
    syms.filter((s) => s.line && s.line <= line).forEach((s) => {
      if (!root || s.line > root.line) root = s;
    });
    if (!root) {
      /* 兜底：光标在最上面、或者符号索引没给出行号 ✓ → 让用户明确选一个函数 ✓ */
      const fns = syms.filter((s) => s.line).sort((a, b) => a.line - b.line).slice(0, 12);
      CG.note = '光标不在任何函数里 —— 从下面挑一个要拆的函数 ✓'
        + (fns.length ? '' : '（这个文件里没识别出函数 ✗）');
      CG.rows = fns.map((s) => ({ name: s.name, kind: s.kind, line: s.line, source: 'local', label: '本地符号 ✓', detail: '第 ' + s.line + ' 行', pick: true }));
      return;
    }
    CG.note = '';
    await cgLoadGraph(root);
  }
  async function cgLoadGraph(root) {
    const ctx = cgCtx();
    if (!ctx || !root) return;
    CG.busy = true; CG.graph = { root, payload: null, err: '' };
    cgRender();
    try {
      const r = await fetch('/api/logic/graph', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: ctx.file, fragment: ctx.index, line: root.line, name: root.name }),
      });
      const d = await r.json();
      if (!d || !d.ok) throw new Error((d && d.error) || '逻辑图生成失败');
      CG.graph = { root, payload: d, err: '' };
    } catch (e) {
      CG.graph = { root, payload: null, err: String((e && e.message) || e) };
    }
    CG.busy = false;
    cgRender();
    cgDrawGraph();
  }
  /* 把图画到浮层里 ✓ —— 复用页面那两个渲染函数 ✓ */
  function cgDrawGraph() {
    const box = $('#cgx-graph');
    if (!box || !CG.graph || !CG.graph.payload) return;
    box.innerHTML = '';
    const p = CG.graph.payload;
    const bar = document.createElement('div');
    bar.className = 'cg-gbar';
    bar.innerHTML = '<span class="t">' + esc(p.name || (CG.graph.root && CG.graph.root.name) || '') + '</span>'
      + '<span class="n">' + ((p.nodes || []).length) + ' 个节点</span>';
    box.appendChild(bar);
    try {
      if (typeof buildLogicFlow === 'function') buildLogicFlow(box, p);       /* 卡片流程 ✓（自包含 ✓）*/
      else if (typeof renderLogicMermaid === 'function') renderLogicMermaid(box, p, CG.graph.root);
      else box.insertAdjacentHTML('beforeend', '<div class="cg-empty">页面里没有可用的逻辑图渲染器 ✗</div>');
    } catch (e) {
      box.insertAdjacentHTML('beforeend', '<div class="cg-empty">画图失败：' + esc(String((e && e.message) || e)) + '</div>');
    }
  }
  /* 「该怎么实现」✓ —— 用逻辑图生成骨架代码 ✓（走已有的 /api/logic/skeleton ✓）*/
  async function cgSkeleton() {
    if (!CG.graph || !CG.graph.payload) return;
    const ctx = cgCtx();
    CG.busy = true; cgRender();
    try {
      const p = CG.graph.payload;
      const r = await fetch('/api/logic/skeleton', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: { nodes: p.nodes, edges: p.edges },
          language: p.language || (ctx && ctx.language) || 'c_cpp',
          fnName: p.name || (CG.graph.root && CG.graph.root.name) || 'generated',
        }),
      });
      const d = await r.json();
      if (!d || !d.ok) throw new Error((d && d.error) || '生成骨架失败');
      CG.graph.skel = String(d.code || '');
    } catch (e) {
      CG.graph.skelErr = String((e && e.message) || e);
    }
    CG.busy = false;
    cgRender();
  }
  /* AI 讲一遍这段在干什么 ✓（不涉及精确签名 ✓，所以可以让它说 ✓）*/
  async function cgExplain() {
    const ctx = cgCtx();
    if (!ctx) return;
    const code = (CG.graph && CG.graph.payload && CG.graph.payload.source) || ctx.sel || ctx.code.slice(0, 3000);
    CG.busy = true; cgRender();
    try {
      const out = await cgAi(
        '你是资深工程师，帮人**看懂**一段代码。用中文，说人话，**别复述代码**。'
          + '要求：① 一句话说这段在干什么；② 分步骤讲清楚流程（每步一行）；'
          + '③ 指出**容易搞错的地方**（边界 / 空值 / 溢出 / 资源释放之类），没有就直说没有。',
        '语言：' + (ctx.language || '') + '\n\n```\n' + String(code).slice(0, 6000) + '\n```',
        120000);
      CG.graph = Object.assign({}, CG.graph, { explain: out });
    } catch (e) {
      CG.graph = Object.assign({}, CG.graph, { explainErr: String((e && e.message) || e) });
    }
    CG.busy = false;
    cgRender();
  }

  /* ══ ⑨ 动作 ✓ ══════════════════════════════════════════════════════════ */
  function cgInsert(text) {
    const t = String(text == null ? '' : text);
    if (!t) return;
    try {
      const ed = (typeof MONACO_EDITOR !== 'undefined') ? MONACO_EDITOR : null;
      if (!ed || !ed.executeEdits) throw new Error('没有可用的编辑器');
      const sel = ed.getSelection();
      ed.executeEdits('code-guide', [{ range: sel, text: t, forceMoveMarkers: true }]);
      ed.focus();
      toast('✓ 已插到光标处');
      cgClose();
    } catch (e) {
      /* ⚠️ 插不进去就**把内容给用户** ✓ —— 别让他干瞪眼 ✗（浮层里本来就有「复制」✓）。 */
      toast('插不进去（' + String((e && e.message) || e) + '）—— 用「复制」吧 ✓');
    }
  }
  function cgCopy(text) {
    try {
      navigator.clipboard.writeText(String(text || ''));
      toast('✓ 已复制');
    } catch (_) { toast('复制失败 ✗ 手动选一下吧'); }
  }
  /* 跳到某个符号 ✓ —— 复用页面自己的跳转 ✓（它知道怎么切文件 / 定位 ✓）*/
  function cgGoto(row) {
    if (!row || !row.line) { toast('这条没有行号（LSP 补全项不带位置 ✓）'); return; }
    try {
      const ed = (typeof MONACO_EDITOR !== 'undefined') ? MONACO_EDITOR : null;
      if (ed && ed.revealLineInCenter && ed.setPosition) {
        ed.revealLineInCenter(row.line);
        ed.setPosition({ lineNumber: row.line, column: 1 });
        ed.focus();
        cgClose();
        return;
      }
    } catch (_) {}
    toast('跳不过去 —— 手动到第 ' + row.line + ' 行看看 ✓');
  }

  /* ══ ⑩ 渲染 ✓ ══════════════════════════════════════════════════════════ */
  const TABS = [
    { k: 'look', e: '🔍', n: '查符号', ph: '符号名（记得个大概也行：snpf → snprintf）', tip: '光标底下那个词直接 ⌘I 也行' },
    { k: 'find', e: '💡', n: '找函数', ph: '用大白话说你要干什么：把字符串转成整数', tip: '先搜本地，再让 AI 补候选，然后回头核实' },
    { k: 'break', e: '🧩', n: '拆逻辑', ph: '（不用输）光标放在要拆的函数里就行', tip: '画逻辑图 + 讲一遍 + 出骨架代码' },
  ];
  function cgSrcChip(r) {
    const cls = r.source === 'ai' ? 'ai' : 'ok';
    return '<span class="cg-src ' + cls + '">' + esc(r.label) + '</span>';
  }
  function cgRowHtml(r) {
    const sub = [];
    if (r.kind) sub.push(esc(r.kind));
    if (r.detail) sub.push(esc(r.detail));
    return '<div class="cg-row" data-cgrow="' + esc(r.name) + '">'
      + '<div class="hd"><span class="nm">' + esc(r.name) + '</span>' + cgSrcChip(r) + '</div>'
      + (sub.length ? '<div class="sub">' + sub.join(' · ') + '</div>' : '')
      + (r.doc ? '<pre class="doc">' + esc(String(r.doc).slice(0, 600)) + '</pre>' : '')
      + (r.use ? '<pre class="use">' + esc(r.use) + '</pre>' : '')
      + '<div class="acts">'
      + (r.use ? '<button data-cgact="use" data-cgtext="' + esc(r.use) + '">插到光标处</button>' : '')
      + (r.insert ? '<button data-cgact="use" data-cgtext="' + esc(r.insert) + '">插到光标处</button>' : '')
      + (r.line ? '<button data-cgact="goto">跳过去</button>' : '')
      + '<button data-cgact="copy">复制名字</button>'
      + (r.pick ? '<button data-cgact="pick">拆这个</button>' : '')
      + '</div></div>';
  }
  function cgBodyHtml() {
    const ctx = cgCtx();
    const tab = CG.tab;
    let h = '';
    if (CG.err) h += '<div class="cg-note err">✗ ' + esc(CG.err) + '</div>';
    if (!ctx) {
      return h + '<div class="cg-empty">先打开一个代码文件 ✓<br>'
        + '<span>（这个工具要知道你正在编辑什么，才能查符号 / 拆逻辑 ✓）</span></div>';
    }
    if (tab === 'break') {
      h += CG.graph
        ? '<div id="cgx-graph" class="cg-graph"></div>'
          + (CG.graph.err ? '<div class="cg-note err">✗ ' + esc(CG.graph.err) + '</div>' : '')
          + '<div class="cg-acts">'
          + '<button class="pri" id="cgx-skel">🧱 给我一个骨架（该怎么实现）</button>'
          + '<button id="cgx-explain">🧠 让它讲一遍这段在干什么</button>'
          + '</div>'
          + (CG.graph.skelErr ? '<div class="cg-note err">✗ ' + esc(CG.graph.skelErr) + '</div>' : '')
          + (CG.graph.skel ? '<pre class="cg-code" id="cgx-skelcode">' + esc(CG.graph.skel) + '</pre>'
            + '<div class="cg-acts"><button data-cgact="use" data-cgtext="' + esc(CG.graph.skel) + '">插到光标处</button>'
            + '<button data-cgact="copysk">复制</button></div>' : '')
          + (CG.graph.explainErr ? '<div class="cg-note err">✗ ' + esc(CG.graph.explainErr) + '</div>' : '')
          + (CG.graph.explain ? '<div class="cg-explain">' + esc(CG.graph.explain).replace(/\n/g, '<br>') + '</div>' : '')
        : '<div class="cg-empty">把光标放在「要拆的那个函数」里 ✓，再点「拆」<br>'
          + '<span>会画一张控制流图 + 讲一遍 + 给你一份骨架代码 ✓</span></div>';
      if (CG.rows.length) h += CG.rows.map(cgRowHtml).join('');
      return h;
    }
    if (CG.busy) h += '<div class="cg-note">正在查…</div>';
    if (CG.note) h += '<div class="cg-note">' + esc(CG.note).replace(/\*\*(.+?)\*\*/g, '$1') + '</div>';
    if (tab === 'find' && CG.ai && CG.ai.busy) h += '<div class="cg-note">正在让 AI 想候选…</div>';
    if (tab === 'find' && CG.ai && CG.ai.err) h += '<div class="cg-note err">✗ AI：' + esc(CG.ai.err) + '</div>';
    if (tab === 'find' && CG.ai && CG.ai.hint) h += '<div class="cg-note">💡 ' + esc(CG.ai.hint) + '</div>';
    if (!CG.rows.length && !CG.busy) {
      if (!CG.note) h += '<div class="cg-empty">' + (tab === 'look'
        ? '输入一个符号名，或者直接把光标放在那个词上按 ⌘I ✓'
        : '用大白话描述你要干什么，比如「读一个文件」「定时器」「把 JSON 转成对象」✓') + '</div>';
      return h;
    }
    h += CG.rows.map(cgRowHtml).join('');
    return h;
  }
  function cgRender() {
    const box = $('#cgx-body');
    if (!box) return;
    box.innerHTML = cgBodyHtml();
    /* ⚠️ 头部那行「上下文」要**每次重绘都刷新** ✗✗ ——
       它是在 `cgBuild()`（**只建一次** ✗）里写的 ✓，
       于是第二次打开浮层时它还是**上一次**的内容 ✗
       （实测：明明打开了文件 ✓，头上却写着「没有打开文件」✗）。
       凡是「跟着当前状态走」的东西 ✗，都不能只在「建的时候」写一次 ✓。 */
    const ctxEl = $('#cgx-ctx');
    if (ctxEl) {
      const c = cgCtx();
      ctxEl.textContent = c
        ? ((c.filename || c.file.split('/').pop()) + ' · ' + c.language + ' · 光标 ' + c.line + ':' + c.column)
        : '没有打开文件';
    }
    const tabs = $('#cgx-tabs');
    if (tabs) {
      Array.from(tabs.children).forEach((el) => {
        el.classList.toggle('on', el.dataset.cgtab === CG.tab);
      });
    }
    const inp = $('#cgx-q');
    if (inp) {
      const t = TABS.find((x) => x.k === CG.tab) || TABS[0];
      inp.placeholder = t.ph;
      if (document.activeElement !== inp && inp.value !== CG.q) inp.value = CG.q;
      inp.disabled = CG.tab === 'break';
    }
    const tip = $('#cgx-tip');
    if (tip) tip.textContent = (TABS.find((x) => x.k === CG.tab) || TABS[0]).tip;
    cgDrawGraph();
  }

  /* ══ ⑪ 样式 ✓ ══════════════════════════════════════════════════════════
     ⚠️ 样式**跟着 JS 一起走** ✗（注入 `<style>` ✓）—— 这个工具是**一个文件** ✓，
        不想为了它再改 index.html 里那一大坨 CSS ✓（也就不存在「改了 JS 忘了改 CSS」✗）。
     ⚠️ 颜色**全部用页面的 CSS 变量** ✓（`--bg/--panel/--border/--text/--dim/--accent/…` ✓）
        —— 这样深色 / 浅色主题切换**自动跟着变** ✓，不用维护两套 ✓。 */
  const CG_CSS = [
    /* ★★★★ 从「居中模态框」改成**浮在页面上的小窗口** ✗✗ —— 用户原话：
       「给我改成小窗口，可以任意拖动显示到不同位置，是浮于页面之上的那种，
        小窗口显示查询，可以随时查询和关闭，也可以拖动放到一边，参考学习这写代码等等」✓。

       ⚠️⚠️ 最关键的差别：**没有遮罩** ✗ ——
          原来 `.cg-mask` 是一层半透明全屏遮罩 ✓ 而且**点它就关闭** ✓ →
          用户**没法一边查一边写代码** ✗（点一下编辑器，向导就没了 ✓）。
       → 现在：外层只用来兜住定位 ✓，`pointer-events:none` ✓（底下的页面**完全可点** ✓），
         只有窗口本身 `pointer-events:auto` ✓。
       ⚠️ 也**不再「点外面关闭」** ✗ —— 它是常驻小工具 ✓，要关就点 ✕ / 按 Esc ✓
          （顺手还解决了「想复制一段但一点外面就没了」✓）。 */
    '.cg-mask{position:fixed;inset:0;z-index:9990;display:none;pointer-events:none}',
    '.cg-mask.on{display:block}',
    '.cg-box{position:fixed;pointer-events:auto;width:520px;min-width:330px;max-width:96vw;',
    'max-height:74vh;display:flex;flex-direction:column;',
    'background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden;',
    'box-shadow:0 22px 70px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);font-family:var(--ui);color:var(--text)}',
    /* 顶栏 = **拖动把手** ✓ —— `cursor:move` 让「这个能拖」一眼看得出来 ✓
       （不能拖的地方写着 cursor:move 是骗人 ✗；能拖的地方不写就是藏着 ✓）。 */
    '.cg-head{display:flex;align-items:center;gap:8px;padding:10px 12px;flex:none;cursor:move;',
    'border-bottom:1px solid var(--border);user-select:none;',
    'background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 10%,transparent),transparent)}',
    '.cg-head.dragging{cursor:grabbing}',
    /* 折叠成一条「药丸」✓ —— 用户原话：「也可以拖动放到一边」✓。
       折起来之后只剩顶栏 ✓，可以贴着屏幕边放 ✓，不挡代码 ✓。 */
    '.cg-box.min{max-height:none}',
    '.cg-box.min .cg-tabs,.cg-box.min .cg-search,.cg-box.min .cg-tip,',
    '.cg-box.min .cg-body,.cg-box.min .cg-foot,.cg-box.min .cg-rs{display:none}',
    '.cg-box.min .cg-head{border-bottom:0}',
    /* 右下角缩放把手 ✓（和「能拖」是一对：能挪位置，也能改大小 ✓）*/
    '.cg-rs{position:absolute;right:0;bottom:0;width:15px;height:15px;cursor:nwse-resize;z-index:2}',
    '.cg-rs::after{content:"";position:absolute;right:3px;bottom:3px;width:6px;height:6px;opacity:.45;',
    'border-right:2px solid var(--dim);border-bottom:2px solid var(--dim)}',
    '.cg-rs:hover::after{opacity:.9;border-color:var(--accent)}',
    '.cg-head .ic{font-size:15px}',
    '.cg-head b{font-size:13px;letter-spacing:.4px;white-space:nowrap}',
    '.cg-head .ctx{font-size:11px;color:var(--dim);font-family:var(--mono);overflow:hidden;',
    'text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}',
    '.cg-head .sp{flex:1;min-width:0}',
    '.cg-head .kbd{font-size:10px;color:var(--dim);border:1px solid var(--border);border-radius:4px;padding:1px 6px;flex:none}',
    /* ⚠️ 顶栏上那两个按钮**不能继承 cursor:move** ✗ ——
       不然鼠标移上去还写着「可拖动」✓，点的时候心里没底 ✓。 */
    '.cg-head .hb{flex:none;width:24px;height:22px;display:flex;align-items:center;justify-content:center;',
    'border:1px solid transparent;border-radius:6px;color:var(--dim);cursor:pointer;font-size:12px;line-height:1}',
    '.cg-head .hb:hover{border-color:var(--border);color:var(--text);background:var(--bg)}',
    '.cg-head .hb.x:hover{color:var(--err);border-color:var(--err)}',
    '.cg-tabs{display:flex;gap:6px;padding:9px 14px 0;flex:none}',
    '.cg-tab{font-size:12px;padding:5px 11px;border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--dim)}',
    '.cg-tab:hover{color:var(--text)}',
    '.cg-tab.on{color:var(--accent);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}',
    '.cg-search{display:flex;gap:8px;padding:10px 14px 0;flex:none}',
    '.cg-search input{flex:1;min-width:0;height:34px;padding:0 11px;background:var(--bg);color:var(--text);',
    'border:1px solid var(--border);border-radius:7px;font:13px var(--mono);outline:none}',
    '.cg-search input:focus{border-color:var(--accent)}',
    '.cg-search input:disabled{opacity:.5}',
    '.cg-search button{height:34px;padding:0 16px;border-radius:7px;border:1px solid var(--accent);',
    'background:transparent;color:var(--accent);font:12px var(--ui);cursor:pointer}',
    '.cg-search button:hover{background:var(--accent);color:#fff}',
    '.cg-tip{font-size:11px;color:var(--dim);padding:7px 14px 0;flex:none}',
    /* ⚠️⚠️ 这里必须是 `flex:1 1 auto` ✗✗，**不能写 `flex:1`** ✗ ——
       `flex:1` = `flex-basis:0%` ✓，而 `.cg-box` 的高度是**内容撑出来的**（只有 max-height ✗，
       没有固定高度 ✓）→ 父级高度「不确定」时 ✓，basis 0 的子项**拿不到任何剩余空间** ✗ →
       实测**高度直接塌成 0** ✗ → 逻辑图整块被裁掉 ✓、下面的按钮全都点不到 ✗
       （探针报的是「#cg-skel not visible」✗，看着像按钮没了 ✓，其实是**容器 0 高** ✗）。
       → `flex-basis:auto` ✓：跟着**内容**长 ✓，长到超过 max-height 再靠 overflow 滚 ✓。 */
    '.cg-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 14px 14px}',
    '.cg-note{font-size:11.5px;line-height:1.75;color:var(--dim);padding:7px 10px;margin-bottom:8px;',
    'border-left:2px solid var(--border);background:color-mix(in srgb,var(--panel2) 60%,transparent)}',
    '.cg-note.err{color:var(--err);border-left-color:var(--err)}',
    '.cg-empty{color:var(--dim);font-size:12px;line-height:1.9;text-align:center;padding:26px 10px}',
    '.cg-empty span{font-size:11px;opacity:.8}',
    '.cg-row{border:1px solid var(--border);border-radius:8px;padding:9px 11px;margin-bottom:8px;background:var(--panel2)}',
    '.cg-row:hover{border-color:var(--accent)}',
    '.cg-row .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.cg-row .nm{font-family:var(--mono);font-size:13px;color:var(--text);font-weight:600;word-break:break-all}',
    '.cg-src{font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid}',
    '.cg-src.ok{color:var(--ok);border-color:var(--ok)}',
    '.cg-src.ai{color:#d29922;border-color:#d29922}',
    '.cg-row .sub{font-size:11px;color:var(--dim);margin-top:3px}',
    '.cg-row .doc,.cg-row .use{font-family:var(--mono);font-size:11.5px;line-height:1.65;color:var(--text);',
    'white-space:pre-wrap;word-break:break-word;margin:7px 0 0;padding:7px 9px;background:var(--bg);border-radius:6px;max-height:150px;overflow:auto}',
    '.cg-row .use{color:var(--accent)}',
    '.cg-row .acts,.cg-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
    '.cg-row .acts button,.cg-acts button{height:26px;padding:0 10px;border:1px solid var(--border);border-radius:6px;',
    'background:transparent;color:var(--dim);font:11px var(--ui);cursor:pointer}',
    '.cg-row .acts button:hover,.cg-acts button:hover{border-color:var(--accent);color:var(--accent)}',
    '.cg-acts button.pri{border-color:var(--accent);color:var(--accent)}',
    '.cg-acts button.pri:hover{background:var(--accent);color:#fff}',
    '.cg-graph{border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg);',
    'max-height:44vh;overflow:auto;margin-bottom:10px}',
    '.cg-gbar{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dim);margin-bottom:6px}',
    '.cg-gbar .t{font-family:var(--mono);color:var(--text)}',
    '.cg-code{font-family:var(--mono);font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;',
    'background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:10px;max-height:280px;overflow:auto;margin:0 0 8px}',
    '.cg-explain{font-size:12px;line-height:1.9;color:var(--text);border-left:2px solid var(--accent);',
    'padding:8px 11px;background:color-mix(in srgb,var(--panel2) 60%,transparent);border-radius:0 6px 6px 0}',
    '.cg-foot{display:flex;align-items:center;gap:8px;padding:8px 14px;border-top:1px solid var(--border);',
    'font-size:10.5px;color:var(--dim);flex:none}',
    '.cg-foot .sp{flex:1}',
    '.cg-foot .src-legend{display:flex;align-items:center;gap:5px}',
    '.cg-foot .src-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:7px}',
    '.cg-foot .src-legend i.ok{background:var(--ok)}',
    '.cg-foot .src-legend i.ai{background:#d29922}',
    '.cg-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(12px);z-index:9999;',
    'background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;',
    'padding:9px 15px;font:12px var(--ui);opacity:0;pointer-events:none;transition:.18s}',
    '.cg-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}',
  ].join('');
  function cgStyle() {
    if (document.getElementById('cgx-style')) return;
    const st = document.createElement('style');
    st.id = 'cgx-style';
    st.textContent = CG_CSS;
    document.head.appendChild(st);
  }

  /* ══ ⑫ 窗口的位置 / 大小 / 折叠 ✓ ────────────────────────────────────────
     ⚠️ 为什么要**落盘** ✗：用户把它拖到屏幕右边放着 ✓，
        下次按 ⌘I 又弹回中间 ✗ —— 等于白拖 ✓（用户原话：
        「可以任意拖动显示到不同位置…也可以拖动放到一边」✓，就是要它**记住** ✓）。
     ⚠️ 存哪儿 ✗：`localStorage` ✓ —— 这是**纯界面偏好** ✓，
        和服务端那份 store 无关 ✓（也就不会被别的页面整份覆盖 ✓，
        见 skill 里「整份覆盖会丢字段」那条 ✓）。
     ⚠️⚠️ 恢复时**必须按视口夹一下** ✗✗ —— 和 `bindPaneGrips` / `bindRowGrip`
        那两个坑一模一样 ✓：上次存在第二块屏幕上的坐标 ✓，这次只有一块屏 ✓ →
        窗口跑到屏幕外 ✓ → 用户看到的是「按了 ⌘I，什么都没出现」✗
        （最糟的是他**不知道该往哪儿找** ✓）。 */
  const CG_POS_KEY = 'cg-win';
  function cgWin() {
    try { return JSON.parse(localStorage.getItem(CG_POS_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function cgWinSave(patch) {
    try { localStorage.setItem(CG_POS_KEY, JSON.stringify(Object.assign(cgWin(), patch || {}))); } catch (_) {}
  }
  /* 摆到「记住的位置」✓；没记过就**靠右上角** ✓ ——
     ⚠️ 不放正中间 ✗：正中间正好压着代码 ✓，而这个窗口是**边看边用**的 ✓
        （用户原话「参考学习这写代码」✓）。 */
  function cgPlace() {
    const box = $('#cgx-box');
    if (!box) return;
    const w = cgWin();
    const vw = window.innerWidth, vh = window.innerHeight;
    const bw = box.offsetWidth || 520;
    const bh = box.offsetHeight || 320;
    let x = Number.isFinite(Number(w.x)) ? Number(w.x) : (vw - bw - 24);
    let y = Number.isFinite(Number(w.y)) ? Number(w.y) : 72;
    /* ⚠️ 用**当前**宽高夹 ✗（折叠之后高度会变 ✓）——
       夹的时候按「整个窗口都要看得见」算 ✓。 */
    x = Math.max(8, Math.min(x, Math.max(8, vw - Math.min(bw, vw - 16) - 8)));
    y = Math.max(8, Math.min(y, Math.max(8, vh - Math.min(bh, vh - 16) - 8)));
    box.style.left = Math.round(x) + 'px';
    box.style.top = Math.round(y) + 'px';
    if (Number(w.w) >= 330) box.style.width = Math.round(Math.min(Number(w.w), vw - 16)) + 'px';
    /* ⚠️ 自己拖过高度之后，要把 CSS 里那条 max-height 让开 ✗ ——
       不让开的话「拖到 800 高」会被 `max-height:74vh` 悄悄截回 74% ✓，
       用户看到的是「拖了但没变高」✗（这个项目在「写死的尺寸上限」上栽过好几次 ✓）。 */
    if (Number(w.h) >= 160) {
      const h = Math.round(Math.min(Number(w.h), vh - 16));
      box.style.height = h + 'px';
      box.style.maxHeight = h + 'px';
    }
  }
  /* ★ 拖动 ✓ —— 把手是**顶栏** ✓（`cursor:move` ✓）。
     ⚠️ 顶栏上那两个按钮**不能当把手** ✗ —— 不然点「—」/「✕」会变成拖一下 ✓
        （点不动、还顺手把窗口挪走 ✓）。
     ⚠️ 拖动范围要**留边** ✗ —— 完全推出屏幕就抓不回来了 ✓
        （拖出屏幕外 = 用户再也点不到它 ✗）。 */
  function cgDrag(el) {
    const box = $('#cgx-box', el);
    const head = $('#cgx-head', el);
    if (!box || !head) return;
    head.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      if (ev.target && ev.target.closest && ev.target.closest('.hb')) return;
      ev.preventDefault();
      head.classList.add('dragging');
      const sx = ev.clientX, sy = ev.clientY;
      const r = box.getBoundingClientRect();
      const ox = r.left, oy = r.top;
      const move = (e2) => {
        const vw = window.innerWidth, vh = window.innerHeight;
        const bw = box.offsetWidth;
        const x = Math.max(8 - bw + 56, Math.min(ox + (e2.clientX - sx), vw - 56));
        const y = Math.max(8, Math.min(oy + (e2.clientY - sy), vh - 34));
        box.style.left = Math.round(x) + 'px';
        box.style.top = Math.round(y) + 'px';
      };
      const up = () => {
        head.classList.remove('dragging');
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        const r2 = box.getBoundingClientRect();
        cgWinSave({ x: Math.round(r2.left), y: Math.round(r2.top) });
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    });
  }
  /* ★ 右下角改大小 ✓ —— 和「能拖」是一对 ✓（能挪位置，也能改大小 ✓）*/
  function cgResize(el) {
    const box = $('#cgx-box', el);
    const rs = $('#cgx-rs', el);
    if (!box || !rs) return;
    rs.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const sx = ev.clientX, sy = ev.clientY;
      const r = box.getBoundingClientRect();
      const move = (e2) => {
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.max(330, Math.min(r.width + (e2.clientX - sx), vw - r.left - 8));
        const h = Math.max(160, Math.min(r.height + (e2.clientY - sy), vh - r.top - 8));
        box.style.width = Math.round(w) + 'px';
        box.style.height = Math.round(h) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        const r2 = box.getBoundingClientRect();
        cgWinSave({ w: Math.round(r2.width), h: Math.round(r2.height) });
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    });
  }
  /* ★ 折叠 ✓（用户原话：「也可以拖动放到一边」✓）——
     折起来只剩顶栏那一条 ✓，贴着边放不挡代码 ✓。
     ⚠️ 折起来之后**位置要重夹** ✗ —— 高度一下子变小 ✓，
        原来贴底的坐标会显得很怪 ✓（甚至跑到视口外 ✓）。 */
  function cgMin(on) {
    const box = $('#cgx-box');
    if (!box) return;
    CG.min = !!on;
    box.classList.toggle('min', CG.min);
    const b = $('#cgx-min'); if (b) b.textContent = CG.min ? '▢' : '—';
    cgWinSave({ min: CG.min });
    cgPlace();
  }

  /* ══ ⑫ 浮层 ✓ ══════════════════════════════════════════════════════════ */
  let CG_EL = null;
  function cgBuild() {
    if (CG_EL) return CG_EL;
    const ctx = cgCtx();
    const el = document.createElement('div');
    el.className = 'cg-mask';
    el.id = 'cgx-mask';
    el.innerHTML = '<div class="cg-box" id="cgx-box" role="dialog" aria-label="代码向导">'
      + '<div class="cg-head" id="cgx-head" title="按住这里拖动窗口">'
      + '<span class="ic">🧭</span><b>代码向导</b>'
      + '<span class="ctx" id="cgx-ctx">' + (ctx ? esc((ctx.filename || ctx.file.split('/').pop()) + ' · ' + ctx.language + ' · 光标 ' + ctx.line + ':' + ctx.column) : '没有打开文件') + '</span>'
      + '<span class="kbd">⌘I</span>'
      /* 折叠成一条药丸 ✓（用户原话：「也可以拖动放到一边」✓）——
         ⚠️ 折叠状态**也要落盘** ✗，不然每次打开都弹开 ✓，挡着代码 ✓。 */
      + '<span class="hb" id="cgx-min" title="折起来 / 展开（折起来只剩这一条，可以拖到边上）">—</span>'
      + '<span class="hb x" id="cgx-close" title="关闭（Esc）">✕</span></div>'
      + '<div class="cg-tabs" id="cgx-tabs">'
      + TABS.map((t) => '<span class="cg-tab' + (t.k === CG.tab ? ' on' : '') + '" data-cgtab="' + t.k + '">' + t.e + ' ' + t.n + '</span>').join('')
      + '</div>'
      + '<div class="cg-search"><input id="cgx-q" placeholder="" autocomplete="off" spellcheck="false"/>'
      + '<button class="pri" id="cgx-go">查</button></div>'
      + '<div class="cg-tip" id="cgx-tip"></div>'
      + '<div class="cg-body" id="cgx-body"></div>'
      + '<div class="cg-foot"><span>Esc 关掉</span><span class="sp"></span>'
      + '<span class="src-legend"><i class="ok"></i>LSP / 本地 = 已核实<i class="ai"></i>AI = 未核实</span></div>'
      + '<div class="cg-rs" id="cgx-rs" title="拖动改大小"></div>'
      + '</div>';
    document.body.appendChild(el);
    /* ⚠️⚠️ **没有「点外面关闭」** ✗✗ —— 它是常驻小工具 ✓，
       点编辑器 / 看代码都不该把它关掉 ✓（用户原话：「可以随时查询和关闭」✓，
       关是**显式**动作：✕ / Esc ✓）。 */
    $('#cgx-close', el).onclick = cgClose;
    $('#cgx-min', el).onclick = () => cgMin(!CG.min);
    cgDrag(el);
    cgResize(el);
    Array.from(el.querySelectorAll('[data-cgtab]')).forEach((t) => {
      t.onclick = () => {
        CG.tab = t.dataset.cgtab;
        CG.rows = []; CG.note = ''; CG.err = ''; CG.graph = null; CG.ai = null;
        cgRender();
        if (CG.tab === 'break') cgRunBreak();
        else { const i = $('#cgx-q'); if (i) i.focus(); }
      };
    });
    const inp = $('#cgx-q', el);
    /* ⚠️ 输入框**不能每敲一个字就整块重绘** ✗ —— 会失焦 ✓（这个坑项目里踩过好几次 ✓）。
       只存值 ✓，回车 / 点「查」才跑 ✓。 */
    inp.oninput = () => { CG.q = inp.value; };
    inp.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); cgRun(); }
    };
    $('#cgx-go', el).onclick = () => cgRun();
    /* 结果区用**事件委托** ✓ —— 内容每次重绘 ✓，逐条绑会漏 ✓ */
    $('#cgx-body', el).addEventListener('click', (ev) => {
      const btn = ev.target.closest ? ev.target.closest('[data-cgact]') : null;
      if (!btn) return;
      const act = btn.dataset.cgact;
      const row = btn.closest('[data-cgrow]');
      const name = row ? row.dataset.cgrow : '';
      const r = CG.rows.find((x) => x.name === name) || {};
      if (act === 'use') { cgInsert(btn.dataset.cgtext || r.use || r.insert || ''); return; }
      if (act === 'copy') { cgCopy(name); return; }
      if (act === 'copysk') { cgCopy((CG.graph && CG.graph.skel) || ''); return; }
      if (act === 'goto') { cgGoto(r); return; }
      if (act === 'pick') { cgLoadGraph({ name: r.name, line: r.line }); return; }
    });
    /* 「骨架 / 讲一遍」这两个按钮也是重绘出来的 ✓ → 同样走委托 ✓ */
    $('#cgx-body', el).addEventListener('click', (ev) => {
      const t = ev.target;
      if (!t || !t.id) return;
      if (t.id === 'cgx-skel') { cgSkeleton(); return; }
      if (t.id === 'cgx-explain') { cgExplain(); }
    });
    CG_EL = el;
    return el;
  }
  async function cgRun() {
    CG.err = ''; CG.note = ''; CG.rows = []; CG.graph = null;
    CG.busy = true; cgRender();
    try {
      if (CG.tab === 'look') await cgRunLook();
      else if (CG.tab === 'find') await cgRunFind();
      else await cgRunBreak();
    } catch (e) {
      CG.err = String((e && e.message) || e);
    }
    CG.busy = false;
    cgRender();
  }
  function cgOpen(tab) {
    if (tab) CG.tab = tab;
    CG.err = ''; CG.note = ''; CG.rows = []; CG.graph = null; CG.ai = null;
    CG.q = '';
    const el = cgBuild();
    el.classList.add('on');
    CG.open = true;
    /* ★ 恢复「上次摆哪儿 / 多大 / 折没折」✓（用户原话：「可以拖动放到一边」✓）——
       ⚠️ 顺序不能反 ✗：先定折叠 ✓ 再摆位置 ✓ ——
          折叠会改高度 ✓，先摆位置的话夹取用的是旧高度 ✓（会摆偏 ✓）。 */
    cgMin(!!cgWin().min);
    cgRender();
    cgPlace();
    /* ⚠️ 「拆逻辑」一打开就**直接跑** ✓（它不需要输入 ✓，省一次点击 ✓）；
       「查」把光标底下的词预填上 ✓（用户八成就是想知道它 ✓）。 */
    if (CG.tab === 'break') cgRunBreak();
    else {
      const i = $('#cgx-q');
      if (i) { i.disabled = false; i.value = ''; i.focus(); }
      if (CG.tab === 'look') {
        let word = '';
        try {
          const ed = (typeof MONACO_EDITOR !== 'undefined') ? MONACO_EDITOR : null;
          const m = ed && ed.getModel && ed.getPosition && ed.getModel().getWordAtPosition(ed.getPosition());
          word = String((m && m.word) || '');
        } catch (_) {}
        if (word) { CG.q = word; if (i) i.value = word; cgRun(); }
      }
    }
  }
  function cgClose() {
    CG.open = false;
    if (CG_EL) CG_EL.classList.remove('on');
  }
  function cgToggle() { if (CG.open) cgClose(); else cgOpen(); }

  /* ══ ⑬ 快捷键 ✓ ────────────────────────────────────────────────────────
     ★ ⌘I ✓ —— 全文件搜过，**没被占用** ✓（⌘P / ⌘⇧P / ⌘F / ⌘G / ⌘. / ⌘/ 都有人在用 ✓）。
     ⚠️ 用 **capture** 抢在 Monaco 前面 ✗ —— 不然焦点在编辑器里时会被 Monaco 吞掉 ✓。
     ⚠️ 只在**编辑器页**生效 ✓：没有 `CURRENT` 时按了也给一句人话提示 ✓，不静默 ✗。 */
  function cgOnKey(e) {
    const cmd = e.ctrlKey || e.metaKey;
    if (!cmd) return;
    const k = String(e.key || '').toLowerCase();
    if (k === 'i' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      cgToggle();
      return;
    }
    if (k === 'escape' && CG.open) { e.preventDefault(); cgClose(); }
  }
  function cgMount() {
    cgStyle();
    document.addEventListener('keydown', cgOnKey, true);
    /* 全局 Esc 兜底 ✓（浮层自己也会收 ✓）*/
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && CG.open) cgClose(); });
    window.addEventListener('blur', () => { if (CG.open) cgClose(); });
    /* ★ 窗口变小之后**重新夹一次位置** ✓ —— 不然拖到右下角的窗口会被挤到屏幕外 ✓
       （和 `bindPaneGrips` 恢复时夹取是同一个道理 ✓，见 skill 那条 ✓）。
       ⚠️ 用 `resize` 而不是定时轮询 ✗ —— 事件驱动够了 ✓，也不烧 CPU ✓。 */
    window.addEventListener('resize', () => { if (CG.open) cgPlace(); });
    window.__CODE_GUIDE = { open: cgOpen, close: cgClose, toggle: cgToggle, state: CG, place: cgPlace, min: cgMin };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cgMount);
  else cgMount();
})();
