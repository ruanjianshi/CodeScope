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
    /* ★★ 正在跑的是**哪个**动作 ✗✗ —— 用户原话：
       「这些按键设计的也不合理，按下思考，都没有加载提醒…高亮和按下都分不清」✓。
       ⚠️ 原来只有一个笼统的 `busy` ✓ → 一忙起来**所有**按钮都长一样 ✗，
          用户根本不知道点的是哪个 ✓、也不知道点没点上 ✓。
       → 记具体动作 ✓（'run' / 'graph' / 'flow' / 'skel' / 'explain' / 'jump' ✓），
         只有**那一个**按钮进忙碌态 ✓，其余照常可点 ✓。 */
    busyAct: '',
    busyTxt: '',          /* 忙碌横幅上那句话 ✓ */
    err: '',
    rows: [],             /* 结果条目 ✓（每条带 source ✓）*/
    ai: null,             /* AI 那一路的状态：{ busy, err, names, hint } ✓ */
    graph: null,          /* 拆逻辑：{ payload, root, err } ✓ */
    /* ★★★★ AI 拆解（思维导图 / 实现流程）✓ —— 用户原话：
       「第二个这里拆逻辑这里，我需要的是让AI给我拆解分析实现逻辑和功能的流程图，
         思维导图那种，不是代码」✓。
       ⚠️ 和 `graph`（代码级控制流图 ✓）**是两份东西** ✗：
          graph  = 确定性来源 ✓（服务端解析出来的 if/return 语句 ✓），精确 ✓，但**是代码** ✗；
          aiFlow = 模型把这段逻辑**讲成人话** ✓，不精确 ✓，但**看得懂** ✓。
          两份都留着 ✓，用视图切换 ✓ —— 别用一个去替另一个 ✗。 */
    aiFlow: null,         /* { busy, err, data } ✓ */
    root: null,           /* 当前正在拆的那个函数 ✓（{name,line,frag} ✓）*/
    /* ★★★★ 「怎么用」手册 ✓ —— 用户原话：
       「我需要用到哈希表，但是我不记得哈希表的如何定义，
         以及如何实现增删改查插等，我就需要进查询，
         就类似，以前程序员经常需要查**文档手册**一样去写代码」✓。
       ⚠️ 一条一展开 ✓（`name` 是**哪一条**在展开 ✓）—— 同时开十个手册没有意义 ✓。 */
    manual: null,         /* { name, busy, err, data } ✓ */
    /* ★★★★ 每个页签**各存一份** ✗✗ —— 用户原话：
       「AI 思考后**切换按钮后，东西就丢失了**，后面又得重新思考，太慢了」✓。
       ⚠️⚠️ 原来切页签是**一把全清** ✗（`CG.rows = []` / `CG.graph = null` /
           `CG.aiFlow = null` / `CG.ai = null` ✓）→
          在「找方案」等 AI 想出方案 ✓ → 切去「拆逻辑」看一眼 ✓ → 切回来**全没了** ✗
          → 又得等 5~20 秒 ✓（用户的原话就是「太慢了」✓）。
       ⚠️ AI 那几项**是真的慢**（5~20 秒 ✓），而切页签是**零成本的界面动作** ✓ ——
          把它和「重算」绑在一起是没道理的 ✗。
       → 切页签时先 `cgStash()` 存当前 ✓、再 `cgRestore()` 取目标 ✓；
         目标页签**已经有结果就不重跑** ✓（见 `cgTabHasResult` ✓）。 */
    saved: {},            /* { look: {...}, find: {...}, break: {...} } ✓ */
    /* ★★★★ 查阅历史 ✓ —— 用户原话：「再给我新增**查阅历史记录**，方便我回看」✓。
       ⚠️ 存 `localStorage` ✗（**纯界面偏好** ✓，和服务端那份 store 无关 ✓）——
          和服务端无关就不会被别的页面整份覆盖 ✓
          （见 skill 里「整份覆盖会丢字段」那条 ✓）。
       ⚠️ 记的是「**我查过什么**」✓，不是「查到了什么」✗ ——
          查到的东西可能几 MB ✓（手册 / 思维导图 ✓），存下来会把 localStorage 撑爆 ✗。
          回看的时候**点一下重查**就行 ✓（AI 那几项本来就该重算 ✓，
          而「查过什么」才是他记不住的 ✓）。 */
    hist: [],             /* [{ tab, q, name, line, file, at, res }] ✓ 最近 60 条 ✓ */
    histOn: false,        /* 历史面板开着没 ✓ */
    /* ★ 「存到知识库」的对话框状态 ✓ —— 用户原话：
       「给所查询的记录，做一个注入到知识库的按钮，同时做好管理和分类」✓ */
    ask: null,            /* { tab, q, title, cat, proj, cats, projs, md, busy, err, loaded } ✓ */
    view: 'mind',         /* 拆逻辑下的视图：'mind'（思维导图）/ 'flow'（实现流程）/ 'code'（代码级）✓ */
    note: '',             /* 一句提示（比如「这段不是函数体，画不了图」）✓ */
    sym: null,            /* 当前文档的符号索引缓存 ✓ */
    symFor: '',           /* 缓存是给哪个文件算的 ✓ */
    list: null,           /* LSP 补全缓存 ✓ */
    listFor: '',
    allFns: null,         /* 全库函数索引 ✓（跨文件跳转用 ✓）*/
    allFnsAt: 0,
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

  /* ══ ★★★★ 按钮 + 忙碌态 ✓ —— 用户原话：
     「这些按键设计的也不合理，按下思考，都没有加载提醒，等等，高亮和按下都分不清等等」✓。

     ⚠️⚠️ 两条硬规矩 ✗✗（这个文件里所有按钮都必须走这两个函数 ✓，不许手写 `<button>` ✗）：
       ① **点了立刻有反应** ✓：按下 → 进 busy 态（转圈 + 文案换成「正在…」）→ 完成才恢复 ✓。
          ⚠️ 不许「点了没反应、等几秒突然出结果」✗ —— 用户会以为没点上 ✓，
             然后再点一次 ✓（就变成两个并发请求 ✓）。
       ② **忙碌时那个按钮 disabled** ✓：防重复点 ✓，也顺手把「正在跑」表达清楚了 ✓。

     ⚠️ 为什么用 `data-cgact` 而不是给每个按钮绑 onclick ✗：
        结果区每次重绘 ✓（`innerHTML` 整个换掉 ✓），绑在元素上的监听会**一起消失** ✗ →
        只能事件委托 ✓（`#cgx-body` 上那一个 ✓）。 */
  function cgBtn(o) {
    const act = o.act ? ' data-cgact="' + esc(o.act) + '"' : '';
    const id = o.id ? ' id="' + esc(o.id) + '"' : '';
    const text = o.text ? ' data-cgtext="' + esc(o.text) + '"' : '';
    const val = o.val ? ' data-cgval="' + esc(o.val) + '"' : '';
    const busy = !!o.busy;
    const dis = busy || o.disabled;
    const cls = ['cg-btn', o.pri ? 'pri' : '', o.on ? 'on' : '', busy ? 'busy' : ''].filter(Boolean).join(' ');
    const label = busy ? (o.busyText || '正在…') : o.label;
    return '<button class="' + cls + '"' + id + act + text + val
      + (dis ? ' disabled' : '')
      + (o.title ? ' title="' + esc(o.title) + '"' : '')
      + '>' + (busy ? '<span class="cg-spin"></span>' : (o.icon ? '<span>' + o.icon + '</span>' : ''))
      + '<span>' + esc(label) + '</span></button>';
  }
  /* 当前是不是这个动作在跑 ✓ */
  const cgIsBusy = (act) => CG.busyAct === act;
  /* ★★ 页签之间的状态搬运 ✓（见 CG.saved 那段注释 ✓）——
     ⚠️ 要搬的字段写**一处** ✗（抄两份必然漏 ✓）。 */
  const CG_KEEP = ['rows', 'note', 'err', 'graph', 'ai', 'aiFlow', 'manual', 'q'];
  const CG_DEF = { rows: () => [], note: () => '', err: () => '', graph: () => null, ai: () => null, aiFlow: () => null, manual: () => null, q: () => '' };
  function cgStash() {
    const box = {};
    CG_KEEP.forEach((k) => { box[k] = CG[k]; });
    CG.saved[CG.tab] = box;
  }
  function cgRestore(tab) {
    const s = CG.saved[tab];
    CG_KEEP.forEach((k) => { CG[k] = (s && s[k] !== undefined) ? s[k] : CG_DEF[k](); });
  }
  /* 这个页签**已经有东西可看**了吗 ✓ —— 有就**不要重跑 AI** ✗（那才是「太慢」的根源 ✓）*/
  function cgTabHasResult(tab) {
    if (tab === 'break') return !!(CG.graph || CG.aiFlow);
    if (tab === 'find') return !!(CG.rows.length || (CG.ai && CG.ai.plan) || CG.manual);
    return !!(CG.rows.length || CG.manual);
  }
  /* ══ ★★★★ 查阅历史 ✓ ══════════════════════════════════════════════════
     用户原话：「再给我新增**查阅历史记录**，方便我回看」✓。

     ⚠️⚠️ 存 `localStorage` ✗✗，**不进服务端那份 store** ✓ ——
        这是「我查过什么」的界面偏好 ✓，和服务端数据无关 ✓；
        进 store 的话会被别的页面 / 探针的整份覆盖带跑 ✗
        （本项目在这上面栽过好几次 ✓，见 skill 那条 ✓）。
     ⚠️ 上限 60 条 ✗（localStorage 有配额 ✓，而且翻到第 100 条也没意义 ✓）。
     ⚠️ **同名去重** ✓（同一个词查十遍只留最近一次 ✓，但时间更新 ✓）——
        不然历史会被反复查的同一个词刷满 ✗。 */
  const CG_HIST_KEY = 'cg-hist';
  const CG_HIST_MAX = 60;
  /* ⚠️ 结果**不是每条都存** ✗（见 `cgHistSave` ✓）—— 落盘要限量 ✓ */
  const CG_HIST_RES_MAX = 20;
  const CG_HIST_RES_BYTES = 60 * 1024;
  function cgHistLoad() {
    try {
      const a = JSON.parse(localStorage.getItem(CG_HIST_KEY) || '[]');
      CG.hist = Array.isArray(a) ? a.filter((x) => x && x.tab && (x.q || x.name)).slice(0, CG_HIST_MAX) : [];
    } catch (_) { CG.hist = []; }
    return CG.hist;
  }
  function cgHistSave() {
    try {
      /* ⚠️⚠️ 落盘前把**太大 / 太旧**的结果丢掉 ✗✗ —— localStorage 有配额 ✓，
         撑爆了会**连历史一起写不进去** ✗（那就得不偿失了 ✓）。
         · 只给**最近 20 条**存结果 ✓（再往前的「回看」需求本来就低 ✓）；
         · 单条结果超过 **60 KB** 就不存 ✓（思维导图偶尔会很大 ✓）——
           这些条**照样在历史里** ✓，只是点开时得重算一次 ✓。 */
      const slim = CG.hist.slice(0, CG_HIST_MAX).map((x, i) => {
        const o = Object.assign({}, x);
        if (i >= CG_HIST_RES_MAX) delete o.res;
        else if (o.res) {
          let s = '';
          try { s = JSON.stringify(o.res); } catch (_) { s = ''; }
          if (!s || s.length > CG_HIST_RES_BYTES) delete o.res;
        }
        return o;
      });
      localStorage.setItem(CG_HIST_KEY, JSON.stringify(slim));
    } catch (_) {
      /* ⚠️ 还是写不进去（配额真满了 ✓）→ **退一步**：只存「查过什么」✗，
         把结果全丢掉 ✓ —— 那本来就是历史最主要的信息 ✓，
         而且绝不能因为「想存结果」把整条历史搞没 ✗。 */
      try {
        localStorage.setItem(CG_HIST_KEY, JSON.stringify(CG.hist.map((x) => {
          const o = Object.assign({}, x); delete o.res; return o;
        })));
      } catch (__) {}
    }
  }
  /* ★★★★ 把「这次查到的结果」跟着历史一起存下来 ✗✗ —— 用户原话：
     「**为什么点击加载历史记录，还需要 AI 重新思考**」✓。

     ⚠️⚠️ 我第一版是**故意**让它重跑的 ✗，理由写在 `cgHistGo` 里：
        「缓存里那份可能是别的词留下的」✓ —— 那是**怕拿错** ✓，
        但代价是「回看」要再等 5~20 秒 ✗，而**那就不是回看了** ✗。
     → 正解是**把结果存进那条历史记录本身** ✓（按记录取 ✓，就不可能拿错 ✓），
       而不是「每次重算」✗。这也说明：「怕拿错」应该用**更准的键**去解 ✗，
       不该用「干脆不算」去解 ✓。 */
  function cgHistSnapshot(tab) {
    if (tab === 'break') return { graph: CG.graph, aiFlow: CG.aiFlow, view: CG.view, root: CG.root };
    return { rows: CG.rows, note: CG.note, manual: CG.manual, ai: CG.ai };
  }
  function cgHistSetResult() {
    const key = String(CG.q || (CG.root && CG.root.name) || '').trim();
    if (!key) return;
    const row = (CG.hist || []).find((x) => x.tab === CG.tab && String(x.q || x.name) === key);
    if (!row) return;
    row.res = cgHistSnapshot(CG.tab);
    row.resAt = Date.now();
    cgHistSave();
  }
  /* 记一条 ✓ —— `record` 为 false 的那些（打开时自动带上下文的查 ✓）**不记** ✗，
     不然开十次面板就刷出十条一样的 ✓（那不是「我查过的」✓，是「工具自己查的」✗）。 */
  function cgHistPush(tab, q, extra) {
    const key = String(q || (extra && extra.name) || '').trim();
    if (!key) return;
    const row = Object.assign({ tab, q: String(q || '').trim(), at: Date.now() }, extra || {});
    /* 同名同页签 → 只更新时间 + 挪到最前 ✓ */
    CG.hist = CG.hist.filter((x) => !(x.tab === tab && String(x.q || x.name) === key));
    CG.hist.unshift(row);
    if (CG.hist.length > CG_HIST_MAX) CG.hist.length = CG_HIST_MAX;
    cgHistSave();
  }
  function cgHistClear() {
    CG.hist = []; cgHistSave();
  }
  /* 「3 分钟前」这种人话 ✓ —— 摆一个 `2026-10-08T11:20:33.123Z` 给用户看等于没说 ✗ */
  function cgAgo(ts) {
    const d = Date.now() - Number(ts || 0);
    if (!Number.isFinite(d) || d < 0) return '';
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    if (d < 86400000 * 30) return Math.floor(d / 86400000) + ' 天前';
    try { return new Date(Number(ts)).toISOString().slice(0, 10); } catch (_) { return ''; }
  }
  /* 进 / 出忙碌态 ✓ —— 每次都**重绘** ✓（不重绘的话按钮还停在旧样子 ✗）*/
  function cgBegin(act, txt) { CG.busyAct = act; CG.busyTxt = txt || ''; CG.busy = true; cgRender(); }
  function cgEnd() { CG.busyAct = ''; CG.busyTxt = ''; CG.busy = false; cgRender(); }
  /* 忙碌横幅 ✓ —— 「按下去了、正在想」必须**全局可见** ✗，
     不能只体现在那个小按钮上 ✓（按钮可能已经滚出视野 ✓）。 */
  function cgBusyBar() {
    if (!CG.busyAct) return '';
    const txt = CG.busyTxt || '正在处理…';
    return '<div class="cg-busy"><span class="cg-spin"></span><span class="t">' + esc(txt)
      + '<i>AI 那几项通常要 5~20 秒；本地那几项是一瞬间 ✓</i></span></div>';
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
      let selText = '', hasSel = false;
      try {
        if (ed && sel && ed.getModel && !sel.isEmpty && !sel.isEmpty()) {
          selText = String(ed.getModel().getValueInRange(sel) || '');
          hasSel = selText.trim().length > 0;
        }
      } catch (_) {}
      /* ★★★ 光标底下的词 / 所在那一行 ✓ —— 用户原话（2026-10-08 第三次）：
         「我写代码的时候，有时会不记得一些变量怎么写，或者…我需要用到哈希表，
           但是我不记得哈希表的如何定义，以及如何实现增删改查插等，我就需要进查询，
           就类似，以前程序员经常需要查**文档手册**一样去写代码」✓。
         ⚠️⚠️ 这两个字段是给「打开就**自动查**」用的 ✗✗（见 cgSeed ✓）——
            原来打开面板是**空的** ✓，写着「输入一个符号名」✓ →
            用户光标明明停在 `std::unordered` 上 ✓，面板却一片空白 ✓（截图里就是这样 ✓）→
            他得**手打一遍**「unordered」才知道怎么用 ✗（而他本来就记不清 ✓，鸡生蛋 ✓）。 */
      let word = '', lineText = '';
      try {
        if (ed && pos && ed.getModel) {
          const m = ed.getModel().getWordAtPosition && ed.getModel().getWordAtPosition(pos);
          word = String((m && m.word) || '');
          lineText = String(ed.getModel().getLineContent(pos.lineNumber) || '').trim();
        }
      } catch (_) {}
      /* ⚠️ 选区可能是空的 ✓ —— 那就退回「光标所在那一行」✓
         （用户不选、直接把光标放在一行上也是很常见的用法 ✓）。 */
      if (!selText && lineText.length > 2) selText = lineText;
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
        hasSel,
        word,
        lineText,
      };
    } catch (_) { return null; }
  }
  const LSP_LANGS = ['c', 'c_cpp', 'python', 'javascript', 'typescript', 'go'];

  /* ══ ①b ★★★★ 「打开就该查什么」✓ —— 别再给用户一块空面板 ✗✗ ═══════════
     用户原话：「我主要需要的功能是…**不记得**一些变量怎么写…**不知道用什么**…
               就类似，以前程序员经常需要**查文档手册**一样去写代码」✓。

     ⚠️⚠️ 判据（按「用户此刻最可能想查什么」排 ✓，不是按技术上好取 ✓）：
       ① **有选中** → 用选中的那段里的**第一个标识符** ✓（他刚框住一段代码 ✓）
       ② 光标在一个**像标识符的词**上 → 用那个词 ✓（`unordered` ✓ —— 最常见 ✓）
       ③ 光标在 `a.b` / `a::b` 上 → 用**限定名** ✓（`std::unordered` ✓ 比裸 `unordered` 好查 ✓）
       ④ 都不行 → 用**当前函数名** ✓（他大概在看这个函数 ✓）
       ⑤ 再不行 → 空 ✓（这时才该显示「输入一个符号名」✓）
     ⚠️ 别把**整行**当查询词 ✗ —— `std::unordered_map<string,int> m;` 拿去模糊搜 ✓
        基本什么都匹配不上 ✓（子序列匹配会捞一堆垃圾 ✓）。
        整行只用来**喂给 AI 当上下文** ✓（那是另一回事 ✓）。 */
  function cgSeed() {
    const ctx = cgCtx();
    if (!ctx) return '';
    const clean = (s) => String(s || '').replace(/[^A-Za-z0-9_:$]+/g, ' ').trim();
    /* ① **真的框选**了一段 → 用里面的第一个标识符 ✓
       ⚠️ 必须判 `hasSel` ✗✗ —— `ctx.sel` 在「没框选」时会**回退成整行** ✓（那是给 AI 当上下文用的 ✓），
          拿它当「有选区」会误判 ✓ → 光标下的词永远轮不到 ✗（那就白做了 ✓）。 */
    if (ctx.hasSel && ctx.sel) {
      const m = clean(ctx.sel).match(/[A-Za-z_$][A-Za-z0-9_$]*/);
      if (m && m[0].length >= 2) return m[0];
    }
    /* ② **光标底下的词** ✓ —— 这是最常见的一档 ✓
       ⚠️⚠️ 用**裸词**（`unorder` ✓），**不要**拼成限定名（`std::unorder` ✗）✗✗ ——
          实测：LSP 补全项的名字是 `unordered_map<...>` ✓，**不带 `std::` 前缀** ✗ →
          拿 `std::unorder` 去模糊匹配 ✓ → 前缀 / 子串 / 子序列**全都不中** ✗
          （`:` 在名字里根本不存在 ✓）→ 一条结果都没有 ✗。
          而裸词 `unorder` 一搜就有 ✓（实测截图：`unordered_set` / `unordered_map` / … 全出来了 ✓）。
       ⚠️ 而且**光标在词中间**时 `before` 只有半截（`std::unorde` ✓）→
          拼出来的限定名还比词本身短 ✓，更匹配不上 ✗。
       → 命名空间那点信息**交给 AI 当上下文** ✓（`ctx.lineText` 里就有 `std::` ✓），
         模糊匹配只用裸词 ✓。 */
    if (ctx.word && ctx.word.length >= 2) return ctx.word;
    /* ④ 光标那一行里**离光标最近**的标识符 ✓（比「第一个」靠谱 ✓：
       写 `std::unordered_map<string,int> freq;` 时，光标通常就在正在敲的那个词附近 ✓）*/
    if (ctx.lineText) {
      const ids = [];
      const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
      let m;
      while ((m = re.exec(ctx.lineText)) !== null) ids.push({ w: m[0], at: m.index });
      if (ids.length) {
        const col = Math.max(0, ctx.column - 1);
        let best = ids[0];
        ids.forEach((x) => { if (Math.abs(x.at - col) < Math.abs(best.at - col)) best = x; });
        if (best.w.length >= 2) return best.w;
      }
    }
    /* ⑤ 当前函数名 ✓ */
    try {
      const syms = CG.sym || [];
      let best = null;
      syms.filter((s) => s.line && s.line <= ctx.line && (s.kind === 'fn' || s.kind === 'method'))
        .forEach((s) => { if (!best || s.line > best.line) best = s; });
      if (best) return best.name;
    } catch (_) {}
    return '';
  }

  /* ══ ② 当前文档的符号索引 ✓（走已有的代码图谱接口 ✓，不另造一套 ✗）════
     ★★★★ 这里从 `scope=document` 换成了 `file=` ✗✗ —— 用户原话：
       「有些怎么缺少跳转等等」✓。
     ⚠️⚠️ 根因 ✗：`/api/graph?scope=document` 返回的节点**只有 file 和 fn 两种** ✗
        （实测：`{"file":30,"fn":95}` ✓）→
        `led` / `led_t` / `led_ops` 这些**类型**、`LED_H` 这些**宏**、文件级**变量** ✓
        **一个都不在索引里** ✗ → 搜到了也没有行号 ✗ → 卡片上**根本没有「跳过去」按钮** ✗
        （用户截图里那一列 `led_xxx` 就是这个现象 ✓）。
     ⚠️ 而 `/api/graph?file=<文件>` 走的是**另一条路** ✓，返回完整的 `symbols` ✓
        （实测：`{"type":4,"fn":19,"macro":7,"var":4}` ✓，每条带 `line` + `frag` ✓）。
        → 换过来 ✓，顺手把「跳到源码」这条打通 ✓。 */
  async function cgSymbols(force) {
    const ctx = cgCtx();
    if (!ctx) return [];
    if (!force && CG.sym && CG.symFor === ctx.file) return CG.sym;
    try {
      const r = await fetch('/api/graph?file=' + encodeURIComponent(ctx.file));
      const d = await r.json();
      const out = [];
      const seen = new Set();
      const push = (o) => {
        const name = String((o && (o.name || o.label || o.text)) || '').trim();
        if (!name || name.length > 120 || seen.has(name)) return;
        seen.add(name);
        out.push({
          name,
          kind: String((o && (o.kind || o.type)) || ''),
          line: Number((o && (o.line || o.startLine)) || 0) || 0,
          frag: Number.isFinite(Number(o && o.frag)) ? Number(o.frag) : -1,
        });
      };
      /* 新接口的形状 ✓（symbols 数组 ✓） */
      if (d && Array.isArray(d.symbols)) d.symbols.forEach(push);
      /* ⚠️ 兜底：万一服务端版本不一样 ✓（没有 symbols ✓）→ 还是按老办法在树里刨 ✓，
         刨到的照样能用 ✓（只是少了类型 ✓）。接口换形状不该让整个工具哑掉 ✗。 */
      if (!out.length) {
        const walk = (v, depth) => {
          if (!v || depth > 4) return;
          if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
          if (typeof v !== 'object') return;
          if (v.name || v.label) push(v);
          ['nodes', 'functions', 'symbols', 'items', 'children', 'groups', 'subgraphs'].forEach((k) => walk(v[k], depth + 1));
        };
        walk(d, 0);
      }
      CG.sym = out;
      CG.symFor = ctx.file;
      return out;
    } catch (_) { return []; }
  }

  /* ══ ②b 全库**函数**索引 ✓（跨文件跳转用 ✓）════════════════════════════
     ⚠️ 为什么单列一个 ✗：LSP 补全项**不带位置** ✗（`line: 0` ✓）——
        它们是「在这个光标位置可以敲哪些名字」✓，不是「这个名字定义在哪」✗。
        用户截图里 `led_open(led_t *led_handler)` 就在别的文件里 ✓，
        当前文件的索引当然找不到 ✓ → 得去**全库**捞 ✓。
     ⚠️ 全库那份**只有函数**（`scope=document` 的老限制 ✓）——
        类型 / 宏 / 变量跨文件跳不了 ✓。这不是偷懒 ✗：
        真要跨文件找类型，得改服务端的图谱构建 ✓（那是另一件事 ✓）。
        → 所以**找不到的时候要说清原因** ✓，不能干晾着用户 ✗（见 cgJumpInfo ✓）。 */
  async function cgAllFns() {
    const now = Date.now();
    if (CG.allFns && (now - CG.allFnsAt) < 60000) return CG.allFns;
    try {
      const r = await fetch('/api/graph?scope=document');
      const d = await r.json();
      const out = [];
      const seen = new Set();
      (d && Array.isArray(d.nodes) ? d.nodes : []).forEach((n) => {
        if (!n || n.kind !== 'fn') return;
        const name = String(n.label || n.name || '').trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        out.push({ name, file: String(n.file || ''), frag: Number(n.frag) || 0, line: Number(n.line) || 0 });
      });
      CG.allFns = out; CG.allFnsAt = now;
      return out;
    } catch (_) { return CG.allFns || []; }
  }

  /* ══ ②c 「这条能不能跳、跳到哪」✓ —— 每条结果都要有个说法 ✗✗ ═══════════
     ⚠️ 用户原话：「有些怎么缺少跳转等等」✓ ——
        他要的不只是「多几个按钮」✓，而是**别让他猜** ✓：
        能跳的给出按钮 ✓；不能跳的**写清为什么** ✓
        （「标准库 / 头文件里的，本地没有源码」✓ 比「什么都没有」好一百倍 ✓）。
     返回 { file, frag, line } 或 { why } ✓。 */
  function cgJumpInfo(r, ctx) {
    if (!r) return { why: '这条没有可跳的位置' };
    if (r.line && r.line > 0) return { file: r.file || (ctx && ctx.file) || '', frag: Number.isFinite(r.frag) ? r.frag : -1, line: r.line };
    if (r._def) return r._def;                       /* 已经查过的 ✓ */
    return { why: r.source === 'ai'
      ? 'AI 想出来的名字，本地没核实过，也就没有可跳的位置'
      : '标准库 / 头文件里的名字，本地没有它的源码' };
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
      name: s.name, kind: s.kind, line: s.line, frag: s.frag,
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
        name: it.label, kind: it.kind, line: 0, frag: -1,
        source: 'lsp', label: 'LSP ✓ 已核实',
        detail: it.detail || '', doc: it.documentation || '', insert: it.insertText || it.label,
      }));
      /* ⚠️⚠️ 合并**按匹配度排** ✗✗ —— 原来是「LSP 全排在本地前面」✓，
         于是搜 `led` 时最上面是 `std::stable_partition` ✗、
         而用户要找的 `led` / `led_t` / `led_ops` 被挤到下面 ✓
         （实测截图就是这个样子 ✓，一眼就不对 ✓）。
         → 两边一起打分 ✓、一起排 ✓；**同名时 LSP 赢** ✓（它更权威 ✓，这条规矩不变 ✓）。 */
      const scored = [];
      local.forEach((r) => scored.push({ r, sc: cgScore(r.name, q2), lsp: false }));
      lsp.forEach((r) => scored.push({ r, sc: cgScore(r.name, q2), lsp: true }));
      const byName = new Map();
      scored.forEach((x) => {
        const k = x.r.name.toLowerCase();
        const prev = byName.get(k);
        if (!prev || (x.lsp && !prev.lsp) || (x.lsp === prev.lsp && x.sc > prev.sc)) byName.set(k, x);
      });
      CG.rows = Array.from(byName.values())
        .sort((a, b) => b.sc - a.sc)
        .slice(0, 16)
        .map((x) => x.r);
    }
    /* ★★ 补「能不能跳」✓ —— 本地索引里没有的（LSP 补全项 / AI 候选 ✓），
       再去**全库函数索引**里捞一遍 ✓（用户截图里 `led_open` 就定义在别的文件 ✓）。
       ⚠️ 捞到就补上 file/frag/line ✓ → 卡片上会多一个「跳到定义」✓。 */
    await cgFillJump(ctx, CG.rows);
    if (!CG.rows.length) {
      /* ★★★★ 输入的是**一句话**（含中文 ✓）→ 本地符号搜索**必然白搭** ✗✗ ——
         用户原话：「**有些问题，怎么无法查阅，显示出来**」✓
         （截图里他打的是「哈希表定义」✓，然后只看到一句「没找到」✗）。
         ⚠️ 他问的是**概念** ✓，这条路上**根本没有符号可查** ✗ →
            本地怎么搜都是白找 ✓ → **只能让 AI 直答** ✓（见 cgAskConcept ✓）。
         ⚠️ 但**不能**所有查不到的都去问 AI ✗（那是 5~20 秒 ✓）——
            「`snpf` 打错了」不值得 ✓ → 只在**含中文**时才自动走 AI ✓（见 cgIsQuestion ✓）。 */
      if (cgIsQuestion(q2)) {
        CG.note = '「' + q2 + '」是一句话 ✓，不是符号名 —— 符号搜索找不到是正常的 ✓。'
          + '我按「你想问什么」让 AI 整理了一份手册 ✓（下面那些是相关的符号 ✓）';
        await cgAskConcept(q2);
      } else {
        CG.note = '没找到「' + q2 + '」相关的符号。'
          + '换个写法试试（缩写 / 片段都行），或者切到「💡 找方案」用大白话描述你要干什么 ✓';
      }
    } else {
      CG.note = '';
    }
  }
  /* 给一批结果补上「跳转位置」✓ —— 只补还**没有行号**的那些 ✓，别覆盖已有的 ✓ */
  async function cgFillJump(ctx, rows) {
    const need = rows.filter((r) => r && !(r.line > 0));
    if (!need.length) return;
    const fns = await cgAllFns();
    if (!fns.length) return;
    const byName = new Map();
    fns.forEach((f) => { const k = f.name.toLowerCase(); if (!byName.has(k)) byName.set(k, f); });
    need.forEach((r) => {
      const hit = byName.get(String(r.name || '').toLowerCase());
      /* ⚠️ 只认**完全同名** ✓ —— 模糊匹配在这里是灾难 ✗：
         用户搜 `led` 时会蹦出一堆 `led_xxx` ✓，全标成「跳到定义」= 骗人 ✗。 */
      if (hit) { r.file = hit.file; r.frag = hit.frag; r.line = hit.line; r.crossFile = hit.file !== (ctx && ctx.file); }
    });
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
      name: s.name, kind: s.kind, line: s.line, frag: Number.isFinite(s.frag) ? s.frag : -1,
      source: 'local', label: '本地 / LSP ✓ 已核实',
      detail: s.line ? ('第 ' + s.line + ' 行') : '', doc: (s._lsp && s._lsp.documentation) || '',
    }));
    /* 本地也捞不到位置的（LSP 补全项 ✓）→ 去全库函数索引里补一遍 ✓ */
    await cgFillJump(ctx, CG.rows);
    /* ② 问 AI 要候选名 + **方案** ✓（只要名字 ✓，外加一段思路 ✓）
       ★★★★ 用户原话（2026-10-08 第三次）：
         「以及我**选中代码**，我需要实现这个功能，但是我不清楚该如何用，
           用什么包，函数等来实现，所以，可以借助来查询，选中代码，
           基于上下文**推荐**，来给我推荐该可以通过什么方式实现等等」✓。
       ⚠️⚠️ 所以这里**不只是「候选名」** ✗ —— 用户要的是**方案**：
          用哪个包 / 头文件 ✓、关键函数怎么串起来 ✓、一段能直接改的示例 ✓。
       ⚠️ 但「候选名」仍然要 ✓，而且要**回头核实** ✓（见下面 known / extra ✓）——
          「用什么包」可以让模型说 ✓，「这个函数到底存不存在」不能让模型说 ✗
          （文件头那条铁律 ✓：编一个不存在的函数名，用户编译不过还会怪自己 ✗）。 */
    CG.ai = { busy: true, err: '', names: [], hint: '', plan: null };
    cgBegin('find', '正在按你的上下文想方案…');
    try {
      const sys = '你是资深工程师。用户正在写代码，他知道**要什么功能**，但**不知道用什么**。\n'
        + '请基于他给的**选中代码 / 上下文**给方案。\n'
        + '⚠️ 硬要求：\n'
        + '① 只输出一个 JSON 对象，不要 markdown 围栏、不要前后废话；\n'
        + '② `names` 里**只给真实存在的**函数 / 类型名（标准库或这个语言里通用的）——'
        + '不确定的**宁可不写**，绝不编造 ✗；\n'
        + '③ `plan` 是**思路**：为什么用这个、怎么串起来（2~3 句中文，说人话）；\n'
        + '④ `example` 是一段**能直接改的代码**（用他上下文里的变量名，6~15 行）；\n'
        + '⑤ `steps` 是 2~5 条落地步骤（每条一句话）。\n'
        + 'JSON 结构：\n'
        + '{"plan":"一句话思路",'
        + '"names":[{"n":"函数/类型名","why":"一句话：它管什么","use":"一行最简用法","header":"要 include 什么（没有就空串）"}],'
        + '"example":"可直接改的代码",'
        + '"steps":["第 1 步…"],'
        + '"hint":"一句话说明这几个的关系 / 该选哪个"}';
      const usr = '语言：' + (ctx.language || '未知') + '\n'
        + '文件：' + (ctx.filename || ctx.file) + '\n'
        + '他**选中的代码 / 光标所在那一段**（这是最重要的上下文，优先按它来）：\n'
        + String(ctx.sel || '').slice(0, 1200) + '\n\n'
        + '他想要的功能：' + q + '\n\n'
        + '请给 4~8 个候选 + 一份方案。';
      const out = await cgAi(sys, usr);
      const o = cgJson(out);
      const names = (o && Array.isArray(o.names) ? o.names : []).map((x) => (typeof x === 'string'
        ? { n: x, why: '', use: '', header: '' }
        : {
          n: String((x && x.n) || ''), why: String((x && x.why) || ''),
          use: String((x && x.use) || ''), header: String((x && (x.header || x.include)) || ''),
        }))
        .filter((x) => x.n && x.n.length <= 80).slice(0, 10);
      if (!names.length) throw new Error('模型没按要求返回 JSON（再点一次试试）');
      /* ★ 核实 ✓ —— 拿 AI 给的名字，回头去①那份**已核实**的名单里找 ✓ */
      const known = new Set(CG.rows.map((x) => x.name.toLowerCase()));
      const extra = names.filter((x) => !known.has(x.n.toLowerCase())).map((x) => ({
        name: x.n, kind: '', line: 0, frag: -1,
        source: 'ai', label: 'AI 建议 · 未核实 ⚠️',
        detail: x.why, use: x.use, header: x.header,
      }));
      /* ⚠️ AI 那几条也**顺手核实一下位置** ✓ —— 模型给的名字经常就是本地已有的函数 ✓
         （只是①里没搜到 ✓）→ 能在全库里找到就照样给「跳到定义」✓。 */
      await cgFillJump(ctx, extra);
      CG.rows = CG.rows.concat(extra);
      CG.ai = {
        busy: false, err: '', names, hint: String((o && o.hint) || ''),
        plan: {
          plan: String((o && o.plan) || ''),
          example: String((o && o.example) || ''),
          steps: (Array.isArray(o && o.steps) ? o.steps : []).map((x) => String(x || '')).filter(Boolean).slice(0, 6),
        },
      };
      CG.note = extra.length
        ? '下面带「AI 建议 · 未核实 ⚠️」的那几条，是模型根据你的描述想出来的 ✓ —— '
          + '我没有在本地核实过它们 ✗。用之前先确认名字对不对（编译器 / 编辑器报错为准 ✓）。'
        : 'AI 给的候选**全都在本地核实过了** ✓。';
    } catch (e) {
      CG.ai = { busy: false, err: String((e && e.message) || e), names: [], hint: '', plan: null };
      if (!CG.rows.length) CG.note = '';
    }
    cgEnd();
  }

  /* ══ ⑧ 模式三：拆逻辑 ✓ ════════════════════════════════════════════════
     ⚠️ 逻辑图**需要一个「函数符号」** ✗（`/api/logic/graph` 是按 `line` 找函数的 ✓）。
        所以：光标 / 选区**落在哪个函数里**，就拆哪个 ✓；
        不在任何函数里 → 老实说「选一个函数」✓，别硬画 ✗（硬画出来的图是错的 ✓）。

     ★★★★ 用户原话（2026-10-08，第二次改）：
       「第二个这里拆逻辑这里，我需要的是让AI给我拆解分析实现逻辑和功能的流程图，
         思维导图那种，不是代码」✓。

     ⚠️⚠️ 上一版**整个理解偏了** ✗✗：只把服务端解析出来的**控制流图**画了出来 ✓，
        而那张图上每一格都是**代码原文** ✗（`if (led_handler == NULL || status == NULL)` ✓）——
        用户要的恰恰是**别给他看代码** ✗，要的是「这段在干什么、分几步、哪里分叉」的人话 ✓。

     → 现在**两份东西都要** ✓，各管各的 ✗：
        · `CG.graph`  = 服务端的**控制流图** ✓ —— 精确 ✓（它不会编 ✓），但全是代码 ✓
                        → 归到「◇ 代码级」视图 ✓，当**核对用** ✓（AI 讲错了能对回来 ✓）
        · `CG.aiFlow` = 让 AI 把这段逻辑**讲成人话** ✓ + 结构化步骤 ✓
                        → 归到「🧠 思维导图」/「🔀 实现流程」✓，**默认视图** ✓
     ⚠️ 别拿一个去替另一个 ✗ —— AI 那份会编 ✓，但没有它用户看不懂 ✓；
        控制流图不会编 ✓，但用户看不懂 ✓。**两份并排**才对 ✓。 */
  async function cgRunBreak(opts) {
    const ctx = cgCtx();
    if (!ctx) { CG.err = '先打开一个代码文件 ✓'; return; }
    CG.graph = null; CG.aiFlow = null;
    const syms = await cgSymbols();
    /* 找「包含光标行的、行号最大的那个函数」✓（函数是嵌套的 ✓，取最里层 ✓）。
       ⚠️ 这里**必须过滤成 fn / method** ✗✗ —— 符号索引换成全量之后 ✓
          （见 cgSymbols 那段注释 ✓），`led_ops` 这种**类型**也会带行号 ✓ →
          不过滤的话，光标停在类型定义里就会拿一个类型去画控制流图 ✗（画不出来 ✓）。 */
    const line = ctx.line;
    let root = null;
    syms.filter((s) => s.line && s.line <= line && (s.kind === 'fn' || s.kind === 'method')).forEach((s) => {
      if (!root || s.line > root.line) root = s;
    });
    /* ⚠️⚠️ 光标不在函数里时，**先用「上一次拆的那个」** ✗✗ ——
       踩过 ✓：从列表里点「拆这个」拆了 A ✓，接着点「重新拆解」✓ →
       光标还停在原地（不在函数里 ✓）→ 又给回一张「挑一个函数」的列表 ✗ →
       用户会以为「重新拆解把我刚才选的弄丢了」✗。
       ⚠️ 只在**光标真的不在任何函数里**时才回退 ✗ ——
          光标已经挪到别的函数里了 ✓，那当然按光标的来 ✓（那才是用户的意思 ✓）。 */
    if (!root && CG.root && CG.root.file === ctx.file) root = CG.root;
    if (!root) {
      /* 兜底：光标在最上面、或者符号索引没给出行号 ✓ → 让用户明确选一个函数 ✓ */
      const fns = syms.filter((s) => s.line && (s.kind === 'fn' || s.kind === 'method'))
        .sort((a, b) => a.line - b.line).slice(0, 12);
      CG.note = '光标不在任何函数里 —— 从下面挑一个要拆的函数 ✓'
        + (fns.length ? '' : '（这个文件里没识别出函数 ✗）');
      CG.rows = fns.map((s) => ({
        name: s.name, kind: s.kind, line: s.line, frag: s.frag,
        source: 'local', label: '本地符号 ✓', detail: '第 ' + s.line + ' 行', pick: true,
      }));
      /* ⚠️⚠️ 这里**必须自己重绘** ✗✗ —— 原来这个 `return` 后面是靠外层的
         `cgRun()` 兜一次 `cgRender()` ✓；改成「页签一点就直接跑」之后 ✓，
         调用方不再兜了 ✓ → 不重绘的话页面上**一直停在空态** ✗
         （实测：探针看到的是「把光标放在要拆的函数里」✓，
           而其实 `CG.rows` 里已经有 3 个函数了 ✓ —— 数据对、界面没刷 ✓）。
         ⚠️ 这类「数据更新了但没重绘」的 bug **探针一眼就能抓到** ✓（就是这次 ✓），
            但它在浏览器里表现为「点了没反应」✗，很容易被当成「按钮坏了」✓。 */
      cgRender();
      return;
    }
    CG.root = Object.assign({}, root, { file: ctx && ctx.file });
    /* ★ 拆了哪个函数也记一笔 ✓（回看时能看到「我拆过 led_read」✓）*/
    if (!opts || opts.record !== false) cgHistPush('break', root.name, { line: root.line, file: ctx && ctx.file });
    CG.note = '';
    cgBegin('flow', '正在拆解「' + root.name + '」—— 先出控制流图，再让 AI 讲成人话…');
    /* 先出控制流图 ✓（本地解析，毫秒级 ✓）—— 用户马上有东西看 ✓，
       不用干等 AI ✓（AI 要 5~20 秒 ✓，这期间界面全空是最糟的 ✗）。 */
    await cgLoadGraph(root);
    /* 再让 AI 拆 ✓ */
    await cgAiFlow(root);
    /* ★ 结果也记进历史 ✓（下次点它秒开 ✓，不再问 AI ✓）*/
    if (!CG.err) cgHistSetResult();
    cgEnd();
  }
  async function cgLoadGraph(root) {
    const ctx = cgCtx();
    if (!ctx || !root) return;
    CG.graph = { root, payload: null, err: '' };
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
    cgRender();
  }
  /* ══ ⑧b ★★★★ AI 拆解 ✓ —— 把代码讲成「人话流程图」════════════════════
     ⚠️⚠️ 提示词里那几条「不许」是**关键** ✗✗ ——
        不写的话模型十有八九会把代码原样抄进 `steps` ✓，
        那就等于白做 ✗（用户要的就是不看代码 ✓）。
        · 不许出现代码原文 ✓（要写成「检查参数是否为空」✓，不是 `if (x == NULL)` ✓）
        · 不许出现变量名（除非它本身就是业务概念 ✓）
        · 每步一句话，不许长篇 ✓ */
  async function cgAiFlow(root) {
    const ctx = cgCtx();
    if (!ctx || !root) return;
    CG.aiFlow = { busy: true, err: '', data: null };
    cgRender();
    try {
      const src = (CG.graph && CG.graph.payload && CG.graph.payload.source) || '';
      const code = src || ctx.sel || String(ctx.code || '').slice(0, 6000);
      if (!String(code).trim()) throw new Error('这段没有可分析的代码（光标放到函数体里试试 ✓）');
      const sys = '你是资深嵌入式 / 系统工程师，负责把一段代码**讲成人话**，并整理成流程图。\n'
        + '读者**看不懂代码**，他要的是：这段实现了什么功能、分几步、每步在干什么、哪里会分叉。\n'
        + '⚠️⚠️ 硬要求（违反了这份回答就废了）：\n'
        + '① steps 里**绝对不许出现代码原文** —— 不要写 "if (x == NULL)"，要写「检查参数是否为空」；\n'
        + '② 不要贴变量名 / 函数名（除非它本身就是业务概念，比如 LED、串口）；\n'
        + '③ 每一步**一句话**说清，最多 40 字，不要长篇大论；\n'
        + '④ 3~8 步，按**执行顺序**排；\n'
        + '⑤ 只输出一个 JSON 对象，不要 markdown 围栏、不要前后废话。\n'
        + 'JSON 结构：\n'
        + '{"title":"8 字内的短标题",'
        + '"what":"一句话：这个函数干什么（40 字内）",'
        + '"io":{"in":["输入是什么（人话）"],"out":["输出 / 返回什么（人话）"]},'
        + '"steps":[{"t":"步骤标题（4~10 字）","d":"这一步在干什么（一句话）",'
        + '"kind":"start|step|branch|loop|call|return|end",'
        + '"branch":[{"cond":"什么条件（人话）","to":"就走哪儿（人话）"}]}],'
        + '"keys":["关键点"],"pitfalls":["容易搞错的地方"]}\n'
        + '⚠️ branch 只有 kind=branch 的步骤才需要；没有分支就给空数组。';
      const usr = '语言：' + (ctx.language || '未知') + '\n'
        + '函数：' + root.name + '（第 ' + root.line + ' 行起）\n\n'
        + '```\n' + String(code).slice(0, 8000) + '\n```';
      const out = await cgAi(sys, usr, 150000);
      const o = cgJson(out);
      const d = cgFlowData(o);
      if (!d.steps.length) throw new Error('模型没按要求返回 JSON（再点一次试试）');
      CG.aiFlow = { busy: false, err: '', data: d };
    } catch (e) {
      CG.aiFlow = { busy: false, err: String((e && e.message) || e), data: null };
    }
    cgRender();
  }
  /* 把模型那份 JSON **洗干净** ✓ —— 字段名 / 类型都可能飘 ✓，一律兜住 ✓。
     ⚠️ 上限 14 步 ✗：模型偶尔会一口气给 30 步 ✓，图会长到没法看 ✓。 */
  function cgFlowData(o) {
    const s = (v) => String(v == null ? '' : v).trim();
    const arr = (v) => (Array.isArray(v) ? v : []).map(s).filter(Boolean);
    const steps = (o && Array.isArray(o.steps) ? o.steps : []).map((x) => ({
      t: s(x && (x.t || x.title || x.name)),
      d: s(x && (x.d || x.desc || x.detail || x.why)),
      kind: s(x && x.kind) || 'step',
      branch: (Array.isArray(x && x.branch) ? x.branch : []).map((b) => ({
        cond: s(b && (b.cond || b.if || b.c)),
        to: s(b && (b.to || b.then || b.go)),
      })).filter((b) => b.cond || b.to),
    })).filter((x) => x.t || x.d).slice(0, 14);
    const io = (o && o.io) || {};
    return {
      title: s(o && o.title),
      what: s(o && o.what),
      steps,
      in: arr(io.in || io.inputs || (o && o.inputs)),
      out: arr(io.out || io.outputs || (o && o.outputs)),
      keys: arr(o && o.keys),
      pitfalls: arr(o && (o.pitfalls || o.notes)),
    };
  }
  const CG_KIND_ICON = {
    start: '▶', step: '▸', branch: '◆', loop: '↻', call: 'ƒ', return: '⏎', end: '■',
  };
  /* ══ ⑧c ★★★★ 思维导图渲染 ✓ ═══════════════════════════════════════════
     做法 ✓：节点是**绝对定位的 HTML** ✓（好排版、文字能选中 ✓），
             连线是**一层 SVG** ✓（贝塞尔曲线 ✓）。
     ⚠️ 为什么不用纯 SVG 画文字 ✗：SVG 不换行 ✓，中文长句得自己算折行 ✓，不值当 ✗。
     ⚠️ 为什么要**先测量再摆** ✗：节点高度是文字撑出来的 ✓（一步的说明可能两行 ✓），
        写死高度必然错位 ✓ → 先 append 到 DOM 量 `offsetHeight` ✓，再算 y ✓。
     ⚠️⚠️ 三列的宽度**必须跟着窗口算** ✗✗ —— 第一版写死 152/176/208 ✓（合计 614px ✓），
        而窗口默认才 560 宽 ✓ → **右边那一列直接被裁掉** ✗
        （实测截图：叶子节点半个字都看不见 ✓）。
        → 按容器的实际宽度分配 ✓，窗口拖宽了就自动铺满 ✓。
     ⚠️⚠️ 节点必须挂在**有 `position:relative` 的容器**里 ✗✗ ——
        第一版给容器忘了加 `cg-mind` 这个类 ✓ → 相对定位没生效 ✓ →
        节点去找最近的定位祖先 ✓ → 找到的是 `.cg-box`（`position:fixed` ✓）→
        **整张图跑到标题栏上去了** ✗（实测截图 ✓，还盖住了「代码向导」那一行 ✓）。
        ⚠️ 这类「少写一个类名」的错**探针查不出来** ✗（节点数、连线数、文字全对 ✓），
           只有**截图**能看出来 ✓ —— 这就是为什么排版类改动必须截一次 ✓。 */
  const CG_MIND_GAP = 26;
  function cgMindCols(width) {
    const avail = Math.max(360, width - 10);
    const gaps = CG_MIND_GAP * 2;
    let root = Math.round(Math.min(160, Math.max(104, avail * 0.24)));
    let branch = Math.round(Math.min(170, Math.max(108, avail * 0.26)));
    let leaf = avail - root - branch - gaps;
    if (leaf < 150) { leaf = 150; }
    return { root, branch, leaf };
  }
  function cgMindData(d) {
    const branches = [];
    if (d.what) branches.push({ id: 'what', ic: '🎯', text: '干什么', leaves: [{ text: d.what }] });
    if (d.in.length) branches.push({ id: 'in', ic: '📥', text: '输入', leaves: d.in.map((x) => ({ text: x })) });
    if (d.out.length) branches.push({ id: 'out', ic: '📤', text: '输出', leaves: d.out.map((x) => ({ text: x })) });
    d.steps.forEach((s, i) => {
      const leaves = [];
      if (s.d) leaves.push({ text: s.d });
      s.branch.forEach((b) => leaves.push({ cond: b.cond, text: b.to || '（继续）', chip: true }));
      branches.push({ id: 's' + i, ic: CG_KIND_ICON[s.kind] || '▸', text: s.t || ('第 ' + (i + 1) + ' 步'), leaves, kind: s.kind });
    });
    if (d.keys.length) branches.push({ id: 'keys', ic: '🔑', text: '关键点', leaves: d.keys.map((x) => ({ text: x })) });
    if (d.pitfalls.length) branches.push({ id: 'pit', ic: '⚠️', text: '容易搞错', leaves: d.pitfalls.map((x) => ({ text: x })) });
    return branches;
  }
  function cgDrawMind() {
    const host = $('#cgx-mind');
    if (!host) return;
    const d = CG.aiFlow && CG.aiFlow.data;
    if (!d) return;
    const branches = cgMindData(d);
    if (!branches.length) { host.innerHTML = '<div class="cg-empty">这份拆解是空的</div>'; return; }
    host.innerHTML = '';
    const COL = cgMindCols(host.clientWidth || 520);
    const X = [4, 4 + COL.root + CG_MIND_GAP, 4 + COL.root + COL.branch + CG_MIND_GAP * 2];
    const mk = (cls, html, x, w) => {
      const el = document.createElement('div');
      el.className = 'cg-mind-node ' + cls;
      el.style.left = x + 'px'; el.style.top = '0px'; el.style.width = w + 'px';
      el.style.visibility = 'hidden';
      el.innerHTML = html;
      host.appendChild(el);
      return el;
    };
    const rootEl = mk('cg-mind-root', esc(d.title || d.what || '这段逻辑')
      + (d.what && d.title ? '<span class="t2">' + esc(d.what) + '</span>' : ''), X[0], COL.root);
    const rows = branches.map((b) => {
      const bEl = mk('cg-mind-branch', '<span class="ic">' + esc(b.ic) + '</span>' + esc(b.text), X[1], COL.branch);
      const lEls = b.leaves.map((lf) => mk('cg-mind-leaf' + (lf.chip ? ' chip' : ''),
        (lf.chip && lf.cond ? '<span class="k">' + esc(lf.cond) + '</span>' : '') + esc(lf.text), X[2], COL.leaf));
      return { b, bEl, lEls };
    });
    /* ── 量高度 → 算 y ✓ ── */
    const GAPY = 9, GRP = 16;
    let cursor = 0;
    rows.forEach((r) => {
      const lh = r.lEls.map((e) => e.offsetHeight || 26);
      let y = cursor;
      r.leafY = lh.map((h) => { const cur = y; y += h + GAPY; return cur; });
      const groupH = r.lEls.length ? (y - GAPY - cursor) : 0;
      r.groupH = groupH;
      r.bElH = r.bEl.offsetHeight || 26;
      const total = Math.max(groupH, r.bElH);
      r.bY = cursor + (total - r.bElH) / 2;
      r.leafBase = cursor + (total - groupH) / 2;
      cursor += total + GRP;
    });
    const totalH = Math.max(40, cursor - GRP);
    const rootH = rootEl.offsetHeight || 30;
    const rootY = Math.max(0, (totalH - rootH) / 2);
    /* ── 摆位置 ✓ ── */
    rootEl.style.top = Math.round(rootY) + 'px';
    rootEl.style.visibility = '';
    rows.forEach((r) => {
      r.bEl.style.top = Math.round(r.bY) + 'px';
      r.bEl.style.visibility = '';
      r.lEls.forEach((e, i) => {
        e.style.top = Math.round(r.leafBase + (r.leafY[i] - r.leafY[0])) + 'px';
        e.style.visibility = '';
      });
    });
    const width = X[2] + COL.leaf + 6;
    host.style.height = Math.round(totalH + 8) + 'px';
    /* ── 连线 ✓ ── */
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(Math.round(totalH + 8)));
    const path = (x1, y1, x2, y2) => {
      const mx = (x1 + x2) / 2;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'var(--border)');
      p.setAttribute('stroke-width', '1.5');
      svg.appendChild(p);
    };
    const hb = (el) => (el.offsetHeight || 26) / 2;
    const x0 = X[0] + COL.root;
    const x1 = X[1] + COL.branch;
    rows.forEach((r) => {
      const by = r.bY + hb(r.bEl);
      path(x0, rootY + hb(rootEl), X[1], by);
      r.lEls.forEach((e, i) => {
        path(x1, by, X[2], r.leafBase + (r.leafY[i] - r.leafY[0]) + hb(e));
      });
    });
    host.insertBefore(svg, host.firstChild);
  }
  /* ══ ⑧d 实现流程（垂直步骤 + 箭头）✓ ══════════════════════════════════
     ⚠️ 和思维导图**是同一份数据** ✓（`CG.aiFlow.data` ✓），只是画法不同 ✗：
        思维导图看**结构** ✓（有哪些块、块里有什么 ✓）；
        流程看**顺序** ✓（先干什么、再干什么、哪儿分叉 ✓）。
     ⚠️ 箭头用 CSS 元素而不是 SVG ✗ —— 竖着一列 ✓，画线纯属自找麻烦 ✓。 */
  function cgDrawFlow() {
    const host = $('#cgx-flow');
    if (!host) return;
    const d = CG.aiFlow && CG.aiFlow.data;
    if (!d) return;
    const steps = d.steps || [];
    if (!steps.length) { host.innerHTML = '<div class="cg-empty">这份拆解是空的</div>'; return; }
    host.innerHTML = '<div class="cg-flow">'
      + steps.map((s, i) => '<div class="cg-step k-' + esc(s.kind) + '">'
        + '<span class="n">' + (i + 1) + '</span>'
        + '<div class="t">' + esc(CG_KIND_ICON[s.kind] || '') + ' ' + esc(s.t || ('第 ' + (i + 1) + ' 步')) + '</div>'
        + (s.d ? '<div class="d">' + esc(s.d) + '</div>' : '')
        + (s.branch.length ? '<div class="br">' + s.branch.map((b) =>
          '<span>' + esc(b.cond || '分支') + ' → ' + esc(b.to || '继续') + '</span>').join('') + '</div>' : '')
        + '</div>').join('<div class="cg-arrow">↓</div>')
      + '</div>';
  }
  /* 把图画到浮层里 ✓ —— 代码级那张复用页面自己的渲染函数 ✓ */
  function cgDrawGraph() {
    const box = $('#cgx-graph');
    if (!box || !CG.graph || !CG.graph.payload) return;
    box.innerHTML = '';
    const p = CG.graph.payload;
    const bar = document.createElement('div');
    bar.className = 'cg-gbar';
    bar.innerHTML = '<span class="t">' + esc(p.name || (CG.graph.root && CG.graph.root.name) || '') + '</span>'
      + '<span class="n">' + ((p.nodes || []).length) + ' 个节点</span>'
      + '<span class="badge">精确 · 服务端解析</span>';
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
    if (!CG.graph || !CG.graph.payload) { toast('还没有控制流图 —— 先「重新拆解」一次 ✓'); return; }
    const ctx = cgCtx();
    cgBegin('skel', '正在按控制流图生成骨架代码…');
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
    cgEnd();
  }
  /* AI 讲一遍这段在干什么 ✓（不涉及精确签名 ✓，所以可以让它说 ✓）*/
  async function cgExplain() {
    const ctx = cgCtx();
    if (!ctx) return;
    const code = (CG.graph && CG.graph.payload && CG.graph.payload.source) || ctx.sel || ctx.code.slice(0, 3000);
    cgBegin('explain', '正在让 AI 讲一遍这段在干什么…');
    try {
      const out = await cgAi(
        '你是资深工程师，帮人**看懂**一段代码。用中文，说人话，**别复述代码**。'
          + '要求：① 一句话说这段在干什么；② 分步骤讲清楚流程（每步一行）；'
          + '③ 指出**容易搞错的地方**（边界 / 空值 / 溢出 / 资源释放之类），没有就直说没有。',
        '语言：' + (ctx.language || '') + '\n\n```\n' + String(code).slice(0, 6000) + '\n```',
        120000);
      CG.graph = Object.assign({}, CG.graph, { explain: out, explainErr: '' });
    } catch (e) {
      CG.graph = Object.assign({}, CG.graph, { explainErr: String((e && e.message) || e) });
    }
    cgEnd();
  }

  /* ══ ⑧e ★★★★ 「怎么用」手册 ✓ —— 这个工具**最主要**的用途 ✗✗ ═══════════
     用户原话：「我主要需要的功能是，我写代码的时候，有时会不记得一些变量怎么写，
               或者，有时，我需要实现某个功能，但是不知道用什么，
               就比如现在，我写代码测试函数，我需要用到**哈希表**，
               但是我不记得哈希表的**如何定义**，以及**如何实现增删改查插**等，
               我就需要进查询，就类似，以前程序员经常需要查**文档手册**一样去写代码」✓。

     ⚠️⚠️ 这跟「查到一个名字」是**两回事** ✗✗：
        查到 `unordered_map` 这个名字 ✓，用户**还是不会用** ✗（他还是不知道怎么写增删改查 ✓）。
        手册要的是**能照着抄** ✓：怎么定义 ✓、增删改查遍历各一行 ✓、一段完整例子 ✓。

     ⚠️⚠️ 但这里有个**必须守住的边界** ✗✗（文件头那条铁律 ✓）：
        **签名 / 参数顺序 / 这个符号存不存在** → 只认 LSP ✓，**绝不让模型写** ✗；
        **「怎么用」的示例代码** → 可以让模型写 ✓（那就是手册的内容 ✓），
        但**必须标出来是 AI 写的** ✓，并且**附上 LSP 的权威签名** ✓ 让用户自己对 ✓。
        → 一份手册 = 「LSP 的签名（权威）」+「AI 的用法示例（参考）」 ✓，两段分开摆 ✓。 */
  async function cgManual(r) {
    const ctx = cgCtx();
    if (!ctx || !r || !r.name) return;
    /* 再点一次就收起 ✓（开开关关很正常 ✓） */
    if (CG.manual && CG.manual.name === r.name && CG.manual.data && !CG.manual.busy) {
      CG.manual = null; cgRender(); return;
    }
    CG.manual = { name: r.name, busy: true, err: '', data: null };
    cgBegin('manual', '正在整理「' + r.name + '」的用法…');
    await cgManualFetch(CG.manual, { name: r.name, kind: r.kind, line: r.line, doc: r.doc });
    cgEnd();
  }
  /* ══ ⑧f ★★★★ 「问一句话」也要能查 ✗✗ —— 用户原话：
     「**有些问题，怎么无法查阅，显示出来**」✓（截图里他打的是「哈希表定义」✓）。

     ⚠️⚠️ 病根 ✗：查手册走的是**符号模糊匹配**（`cgScore` 那一套 ✓）——
        而「哈希表定义」是**一句话** ✓，一个符号名都对不上 ✓ →
        必然回一句「没找到」✗。用户看到的是「这东西没用」✗。
     ⚠️ 而这条路上**根本没有符号可查** ✓（他要的是概念 ✓）→
        本地怎么搜都是白搭 ✗ → **只能让 AI 直答** ✓。
     ⚠️⚠️ 但**不能**所有查不到的都去问 AI ✗✗ —— 那是 5~20 秒 ✓，
        而「`snpf` 打错了」这种根本不值得 ✓。
        → 只在**输入里含中文**（= 一句话，不是符号名 ✓）时才自动走 AI ✓。
          英文标识符查不到 → 还是给「换个写法 / 切到找方案」+ 可点的例子 ✓。 */
  function cgIsQuestion(q) {
    const s = String(q || '').trim();
    if (!s) return false;
    /* 含中日韩汉字 → 一定是「问一句话」✓（标识符里不会有 ✓）*/
    if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(s)) return true;
    /* 有空格且不像调用（`std::vector<int>` 这种没空格 ✓）*/
    return /\s/.test(s) && s.length > 12;
  }
  async function cgAskConcept(q) {
    const ctx = cgCtx();
    if (!ctx || !q) return;
    CG.manual = { name: q, busy: true, err: '', data: null, concept: true };
    cgBegin('concept', '「' + q + '」不是符号名 —— 正在让 AI 按「你想问什么」整理…');
    await cgManualFetch(CG.manual, { name: q, concept: true });
    cgEnd();
  }
  /* ★★ 手册正文的**唯一实现** ✓ —— 两条路共用 ✓：
       ① 卡片上的「📖 怎么用」（有具体符号 ✓）
       ② 查手册里问了一句话（`concept: true` ✓，没有符号 ✓）
     ⚠️ 抽成一个函数 ✗（抄两份必然漂移 ✓，这个项目在这上面栽过好几次 ✓）。 */
  async function cgManualFetch(slot, opt) {
    const ctx = cgCtx();
    try {
      /* ⚠️ 先把 LSP 的**权威信息**拿到手 ✓（签名 / 文档 ✓）——
         这段**不经模型** ✓，直接摆给用户 ✓。
         ⚠️ 概念提问（`concept` ✓）没有符号 ✓ → 跳过 ✓（也就没有「LSP 签名」那一段 ✓）。
         ⚠️⚠️ 要 hover 在**符号名那一列** ✗✗，不能一律 `column:1` ✗ ——
            `int add(int a, int b) {` 的第 1 列是 `int` ✓，
            hover 出来的是「int 是什么」✗，不是 `add` 的签名 ✓（那就白拿了 ✓）。
         → 在那一行里**找一下名字的位置** ✓；找不到再退回第 1 列 ✓。 */
      let sig = '', doc = opt.doc || '';
      if (!opt.concept && LSP_LANGS.indexOf(ctx.language) >= 0 && opt.line > 0) {
        try {
          let col = 1;
          const lines = String(ctx.code || '').split('\n');
          const line = lines[opt.line - 1] || '';
          const bare = String(opt.name).split('(')[0].split('<')[0].trim();
          const at = bare ? line.indexOf(bare) : -1;
          if (at >= 0) col = at + 1;
          const d = await cgLsp('hover', { line: opt.line, column: col });
          if (d && d.ok && d.hover && d.hover.markdown) {
            /* ⚠️⚠️ hover 回来的是 **markdown** ✗✗ —— clangd 给的是
               `### function \\`main\\`` + ```cpp 围栏 ✓ →
               直接取第一行会得到 `### function \\`main\\`` 这种**带标记的怪东西** ✗
               （实测截图里就是这么显示的 ✓，用户看到一堆 `###` 和反引号 ✓）。
               → 先剥围栏 ✓、再剥 `#` / 反引号 / `**` ✓，然后挑**像签名的那一行** ✓
                 （带括号 / 逗号 / 分号的 ✓，比如 `int main()` ✓）。 */
            const md = String(d.hover.markdown).replace(/```[\w+-]*\n?/g, ' ');
            const plain = md.replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
            const lines = plain.split('\n').map((x) => x.trim()).filter(Boolean);
            const sigLine = lines.find((x) => /[(){};,=]/.test(x)) || lines[0] || '';
            sig = sigLine.slice(0, 200);
            if (!doc) {
              doc = lines.filter((x) => x !== sigLine).join('\n').slice(0, 500);
            }
          }
        } catch (_) {}
      }
      const sys = '你是给程序员查的**速查手册**。读者知道要用什么，但**不记得怎么写**。\n'
        + '⚠️ 硬要求：\n'
        + '① 只输出一个 JSON 对象，不要 markdown 围栏、不要前后废话；\n'
        + '② `code` 字段里是**可以直接抄的代码**（一行或几行），不要伪代码、不要省略号；\n'
        + '③ 按「怎么用」的顺序组织：定义 → 增 → 删 → 改 → 查 → 遍历 → 其他常用；\n'
        + '④ **只写这个语言里真的存在的用法**，不确定的宁可不写，绝不编造 API 名；\n'
        + '⑤ 每段配一句中文说明（10~30 字）。\n'
        + 'JSON 结构：\n'
        + '{"what":"一句话：它是干什么的（30 字内）",'
        + '"header":"要 include / import 什么（没有就空串）",'
        + '"sections":[{"t":"定义","d":"一句说明","code":"可直接抄的代码"}],'
        + '"apis":[{"n":"成员/函数名","sig":"签名（不确定就留空）","d":"一句说明"}],'
        + '"pitfalls":["容易踩的坑"]}\n'
        + '⚠️ sections 给 4~7 段（定义 / 增 / 删 / 改 / 查 / 遍历 / 其他 里挑相关的）。';
      /* ⚠️ 概念提问要**换个说法** ✗ —— 对着「哈希表定义」说「请给这份**符号**一份手册」✓
         模型会犯迷糊 ✓（它不知道该查哪个符号 ✓）。 */
      const usr = '语言：' + (ctx.language || '未知') + '\n'
        + (opt.concept
          ? ('他想问的是：' + opt.name + '\n'
            + '⚠️ 这**不是**一个符号名 ✓，是一句人话 ✓ —— 请自己判断他想问什么，'
            + '在这个语言里挑**最该用的那个东西**（比如「哈希表」→ C++ 里就是 unordered_map ✓），'
            + '然后按上面的格式给手册 ✓。\n')
          : ('符号：' + opt.name + (opt.kind ? '（' + opt.kind + '）' : '') + '\n'
            + (sig ? ('LSP 给的签名（权威，不要改它）：' + sig + '\n') : '')
            + (doc ? ('已有文档：' + String(doc).slice(0, 600) + '\n') : '')))
        + '他正在写的代码（光标附近）：\n' + String(ctx.sel || ctx.lineText || '').slice(0, 400) + '\n\n'
        + '请给一份「怎么写」的速查手册。';
      const out = await cgAi(sys, usr, 150000);
      const o = cgJson(out);
      const d = cgManualData(o);
      if (!d.sections.length && !d.apis.length) throw new Error('模型没按要求返回 JSON（再点一次试试）');
      slot.busy = false; slot.err = ''; slot.data = d; slot.sig = sig; slot.doc = doc;
    } catch (e) {
      slot.busy = false; slot.err = String((e && e.message) || e); slot.data = null;
    }
  }
  /* 把模型那份手册洗干净 ✓（字段名 / 类型都会飘 ✓） */
  function cgManualData(o) {
    const s = (v) => String(v == null ? '' : v).trim();
    const arr = (v) => (Array.isArray(v) ? v : []).map(s).filter(Boolean);
    return {
      what: s(o && o.what),
      header: s(o && (o.header || o.include)),
      sections: (o && Array.isArray(o.sections) ? o.sections : []).map((x) => ({
        t: s(x && (x.t || x.title)) || '用法',
        d: s(x && (x.d || x.desc)),
        code: s(x && (x.code || x.example || x.snippet)),
      })).filter((x) => x.code || x.d).slice(0, 10),
      apis: (o && Array.isArray(o.apis) ? o.apis : []).map((x) => ({
        n: s(x && (x.n || x.name)),
        sig: s(x && (x.sig || x.signature)),
        d: s(x && (x.d || x.desc)),
      })).filter((x) => x.n).slice(0, 24),
      pitfalls: arr(o && (o.pitfalls || o.notes)).slice(0, 8),
    };
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
  /* 按文件路径找页面自己的 snippet 对象 ✓ —— `goToLocation` 要的就是它 ✓ */
  function cgSnippetFor(file) {
    try {
      if (typeof SNIPPETS === 'undefined' || !Array.isArray(SNIPPETS)) return null;
      const want = String(file || '').replace(/#editing$/, '');
      return SNIPPETS.find((s) => s && String(s.file).replace(/#editing$/, '') === want) || null;
    } catch (_) { return null; }
  }
  /* ★★★★ 跳到某个符号 ✓ —— 用户原话：
     「有些怎么缺少跳转等等，还有点击跳转，会导致代码向导被关闭等等问题」✓。

     ⚠️⚠️ 原来两个毛病 ✗✗，都在这里修掉：
       ① **跳完就 `cgClose()`** ✗ —— 用户点一下「跳过去」✓，向导**没了** ✗，
          想接着查下一个得重新 ⌘I ✓（而他正在**照着学** ✓，一次要跳好几处 ✓）。
          → **不关** ✓。它是浮在页面上的小窗口 ✓，本来就能拖到一边 ✓
            （这正是上一轮改成浮窗的意义 ✓，关掉等于把那个改动又抹了 ✗）。
       ② 用 `MONACO_EDITOR.revealLineInCenter` ✗ —— 那个**只能跳当前文件** ✓，
          跨文件（`led_open` 定义在另一个文件里 ✓）就废了 ✗，
          而且它是直接操作编辑器 ✓，**绕过了页面自己的导航栈** ✗（返回按钮不认 ✓）。
          → 改用页面自己的 `goToLocation({snippet, frag, line})` ✓：
            它知道怎么切文件 ✓、怎么切片段 ✓、怎么推导航栈 ✓（返回能用 ✓）。
     ⚠️ 找不到 snippet 对象时**退回**旧的编辑器跳转 ✓（本文件内的还是能跳 ✓），
        别整个哑掉 ✗。 */
  function cgGoto(row) {
    const ctx = cgCtx();
    const info = cgJumpInfo(row, ctx);
    if (!info || !info.line) { toast(info && info.why ? info.why : '这条没有可跳的位置'); return; }
    const file = info.file || (ctx && ctx.file) || '';
    const name = String(row && row.name || '').trim();
    /* ① 首选：页面自己的跳转 ✓（能跨文件 ✓、进导航栈 ✓）*/
    try {
      const snip = cgSnippetFor(file);
      if (snip && typeof goToLocation === 'function') {
        const frag = (Number.isFinite(info.frag) && info.frag >= 0) ? info.frag : 0;
        if (goToLocation({ snippet: snip, frag, line: info.line })) {
          toast('✓ 已跳到 ' + (name || '那行') + ' · ' + String(snip.name || file.split('/').pop())
            + ' 第 ' + info.line + ' 行' + (info.crossFile ? '（另一个文件）' : ''));
          return;
        }
      }
    } catch (_) {}
    /* ② 退回：本文件内直接操作编辑器 ✓ */
    try {
      const same = !file || !ctx || file === ctx.file;
      const ed = (typeof MONACO_EDITOR !== 'undefined') ? MONACO_EDITOR : null;
      if (same && ed && ed.revealLineInCenter && ed.setPosition) {
        ed.revealLineInCenter(info.line);
        ed.setPosition({ lineNumber: info.line, column: 1 });
        ed.focus();
        toast('✓ 已跳到第 ' + info.line + ' 行');
        return;
      }
    } catch (_) {}
    toast('跳不过去 —— 手动到第 ' + info.line + ' 行看看 ✓');
  }

  /* ══ ⑩ 渲染 ✓ ══════════════════════════════════════════════════════════ */
  const TABS = [
    { k: 'look', e: '🔍', n: '查手册', ph: '符号名（记得个大概也行：snpf → snprintf）', tip: '打开就自动查光标底下那个词；想查「怎么写」点卡片上的「📖 怎么用」' },
    { k: 'find', e: '💡', n: '找方案', ph: '用大白话说你要干什么：把字符串转成整数', tip: '选中一段代码再问，它会按上下文给方案（用哪个包 / 函数 + 例子）' },
    { k: 'break', e: '🧩', n: '拆逻辑', ph: '（不用输）光标放在要拆的函数里就行', tip: 'AI 讲成人话 + 思维导图 + 实现流程（想看代码有「代码级」视图）' },
  ];
  /* 拆逻辑下的三个视图 ✓ —— 用户原话：「我需要的是让AI给我拆解分析实现逻辑和功能的
     流程图，思维导图那种，不是代码」✓。
     ⚠️ 默认落在「思维导图」✓（**不是**代码 ✓）—— 用户要看的顺序就是这个 ✓。 */
  const VIEWS = [
    { k: 'mind', e: '🧠', n: '思维导图', tip: '这段逻辑有哪些块、每块在干什么（人话，不看代码）' },
    { k: 'flow', e: '🔀', n: '实现流程', tip: '按执行顺序一步步走，哪里分叉' },
    { k: 'code', e: '◇', n: '代码级', tip: '服务端解析出来的精确控制流图 —— 拿它核对 AI 有没有讲错' },
  ];
  function cgSrcChip(r) {
    const cls = r.source === 'ai' ? 'ai' : 'ok';
    return '<span class="cg-src ' + cls + '">' + esc(r.label) + '</span>';
  }
  /* ★★ 结果卡片 ✓ —— 「跳过去」这条按 cgJumpInfo 走 ✗✗：
     能跳 → 给按钮 ✓（跨文件的标出来 ✓）；
     不能跳 → **写清为什么** ✓（用户原话「有些怎么缺少跳转」✓ ——
     他要的是「别让我猜」✓，不是「多几个按钮」✓）。 */
  function cgRowHtml(r) {
    const ctx = cgCtx();
    const sub = [];
    if (r.kind) sub.push(esc(r.kind));
    if (r.detail) sub.push(esc(r.detail));
    if (r.crossFile) sub.push('另一个文件：' + esc(String(r.file || '').split('/').pop()));
    const jump = cgJumpInfo(r, ctx);
    const canJump = !!(jump && jump.line);
    const openM = !!(CG.manual && CG.manual.name === r.name);
    /* ⚠️ `data-cgline` 是给**探针**用的 ✗（量「跳完真的到了那一行」✓）——
       界面上不需要它 ✓，但没有它探针就只能去正则扒文案 ✓（脆 ✓）。 */
    return '<div class="cg-row" data-cgrow="' + esc(r.name) + '" data-cgline="' + (canJump ? jump.line : '') + '">'
      + '<div class="hd"><span class="nm">' + esc(r.name) + '</span>' + cgSrcChip(r) + '</div>'
      + (sub.length ? '<div class="sub">' + sub.join(' · ') + '</div>' : '')
      + (r.doc ? '<pre class="doc">' + esc(String(r.doc).slice(0, 600)) + '</pre>' : '')
      + (r.use ? '<pre class="use">' + esc(r.use) + '</pre>' : '')
      + '<div class="acts">'
      /* ★★ 「怎么用」摆**最前面** ✗✗ —— 用户原话：
         「我不记得哈希表的如何定义，以及如何实现增删改查插等…
           就类似，以前程序员经常需要查**文档手册**一样去写代码」✓。
         → 这才是这个工具的主用途 ✓，别把它埋在「插到光标处」后面 ✓。 */
      + cgBtn({
        act: 'manual', pri: !openM, on: openM, icon: '📖',
        label: openM ? '收起用法' : '怎么用',
        busy: openM && cgIsBusy('manual'), busyText: '正在整理…',
        title: '给一份「怎么写」的速查手册：定义 / 增删改查 / 遍历 / 可直接抄的代码',
      })
      + (canJump ? cgBtn({
        act: 'goto', icon: '↗', label: r.crossFile ? '跳到定义（另一个文件）' : '跳过去',
        title: '跳到第 ' + jump.line + ' 行' + (jump.crossFile ? '（会切到另一个文件）' : '') + ' —— 向导不会关',
      }) : '')
      + (r.use || r.insert ? cgBtn({
        act: 'use', text: r.use || r.insert, icon: '⤵', label: '插到光标处',
        title: '把这段插到你编辑器里的光标处（插完向导会关掉，好让你看结果）',
      }) : '')
      + cgBtn({ act: 'copy', icon: '⧉', label: '复制名字' })
      + (r.pick ? cgBtn({ act: 'pick', pri: true, icon: '🧩', label: '拆这个' }) : '')
      + '</div>'
      + (openM ? cgManualHtml() : '')
      + (canJump ? '' : '<div class="nj">' + esc((jump && jump.why) || '这条没有可跳的位置') + '（还是可以复制名字 ✓）</div>')
      + '</div>';
  }
  /* ══ ★★★★ 代码高亮 ✓ —— 复用页面**自己那一套** ✗✗ ═════════════════════
     用户原话：「代码**缺少渲染和语法高亮**」✓（截图里手册的代码块全是灰白一片 ✓）。

     ⚠️ 页面里早就有了 ✓：`codeHtml(code, lang)` ✓（`index.html` 顶层函数 ✓）
        —— 编辑器的代码块 / 定义速览 / Markdown 预览**都用它** ✓，
        而且 `html[data-theme] .hljs-*` 有一层**主题变量覆盖** ✓
        （`--syntax-keyword` / `--syntax-string` … ✓）→ 深浅色自动跟着走 ✓。
     ⚠️⚠️ **不要**给 `<pre>` 加 `hljs` 这个类 ✗✗ ——
        它在 `assets/hljs-theme.css` 里带着**写死的深色底** ✗
        （`.hljs{color:#abb2bf;background:#282c34}` ✓）→
        浅色主题下会糊成一块黑 ✗。只取它吐出来的 `<span class="hljs-*">` ✓ 就够了 ✓。
     ⚠️ `codeHtml` 是**页面里**的函数 ✓（这个文件是经典脚本 ✓ 才拿得到 ✓）——
        拿不到就退回 `esc()` ✓，**绝不让整块面板崩掉** ✗。 */
  function cgCode(code, lang) {
    const t = String(code == null ? '' : code);
    try { if (typeof codeHtml === 'function') return codeHtml(t, lang || 'plaintext'); } catch (_) {}
    return esc(t);
  }

  /* ★★★★ 手册正文 ✓ —— 两段**必须分开摆** ✗✗（文件头那条铁律 ✓）：
     · 「LSP 给的签名」= 权威 ✓（参数顺序 / 返回类型都对 ✓）
     · 「AI 写的用法」  = 参考 ✓（能照着抄 ✓，但编译前自己对一眼 ✓）
     ⚠️ 混在一起的话，用户会把 AI 编的签名也当成真的 ✗
        （「模型给的签名看着特别像真的」正是文件头警告的那个事故 ✓）。 */
  function cgManualHtml() {
    const m = CG.manual;
    if (!m) return '';
    const lang = (cgCtx() && cgCtx().language) || 'plaintext';
    if (m.busy) return '<div class="cg-man"><div class="cg-busy"><span class="cg-spin"></span>'
      + '<span class="t">正在整理「' + esc(m.name) + '」的用法…<i>通常 5~20 秒</i></span></div></div>';
    if (m.err) {
      return '<div class="cg-man"><div class="cg-note err">✗ ' + esc(m.err) + '</div>'
        + '<div class="cg-acts">' + cgBtn({ act: 'manual', pri: true, icon: '📖', label: '再试一次' }) + '</div></div>';
    }
    const d = m.data;
    if (!d) return '';
    let h = '<div class="cg-man">';
    h += '<div class="cg-man-hd"><span class="t">📖 ' + esc(m.name) + (m.concept ? ' · 怎么用' : ' 怎么用') + '</span>'
      + '<span class="tag ai">AI 整理 · 编译前对一眼</span>'
      /* ⚠️ 概念手册**没有对应的卡片** ✗（它是「问了一句话」换来的 ✓）→
         收不起来 ✓，所以得在这儿放一个「重新整理」✓（不然想重来一次都没入口 ✗）。 */
      + (m.concept ? cgBtn({ act: 'concept', val: m.name, icon: '🪄', label: '重新整理',
        busy: cgIsBusy('concept'), busyText: '正在整理…' }) : '')
      + '</div>';
    if (d.what) h += '<div class="cg-man-what">' + esc(d.what) + '</div>';
    if (m.sig) h += '<div class="cg-man-sig"><span class="k">LSP 签名（权威）</span><code>' + cgCode(m.sig, lang) + '</code></div>';
    if (d.header) h += '<div class="cg-man-inc"><span class="k">要包含</span><code>' + cgCode(d.header, lang) + '</code>'
      + cgBtn({ act: 'use', text: d.header, icon: '⤵', label: '插到光标处' }) + '</div>';
    h += d.sections.map((s) => '<div class="cg-man-sec">'
      + '<div class="cg-man-t"><span>' + esc(s.t) + '</span>'
      + (s.d ? '<span class="d">' + esc(s.d) + '</span>' : '')
      + '<span class="sp"></span>'
      /* ⚠️⚠️ 按钮放在**标题行右边** ✗✗ —— 第一版是绝对定位**压在代码上** ✓ →
         盖住了第一行代码 ✗（实测截图：`std::unordered_map<...>` 被「复制」挡住半个字 ✓）。
         放标题行既不挡代码 ✓，又比「代码下面再来一行按钮」省一半高度 ✓
         （一份手册有 5~7 段 ✓，每段多一行按钮会把面板撑爆 ✓）。 */
      + (s.code ? cgBtn({ act: 'copysk2', text: s.code, icon: '⧉', label: '复制' })
        + cgBtn({ act: 'use', text: s.code, icon: '⤵', label: '插入' }) : '')
      + '</div>'
      + (s.code ? '<div class="cg-man-code"><pre>' + cgCode(s.code, lang) + '</pre></div>' : '')
      + '</div>').join('');
    if (d.apis.length) {
      h += '<div class="cg-man-sec"><div class="cg-man-t">常用成员</div><table class="cg-man-api">'
        + d.apis.map((a) => '<tr><td class="n">' + esc(a.n) + '</td>'
          + '<td class="s">' + esc(a.sig || '') + '</td>'
          + '<td class="d">' + esc(a.d || '') + '</td></tr>').join('')
        + '</table></div>';
    }
    if (d.pitfalls.length) {
      h += '<div class="cg-man-sec"><div class="cg-man-t">容易踩的坑</div><ul class="cg-man-pit">'
        + d.pitfalls.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
    }
    h += '<div class="cg-man-foot">'
      + (m.concept
        ? '这一份是 AI 按你问的那句话整理的 ✓（参考）—— 里面用到的 API 名请以编译器 / 编辑器的提示为准 ✓。'
        : '上面「LSP 签名」来自编译器 / LSP ✓（权威）；用法示例是 AI 整理的 ✓（参考）。'
          + '编译不过时以 LSP / 编译器报错为准 ✓。')
      + '</div>';
    h += '</div>';
    return h;
  }
  /* 拆逻辑的视图切换条 ✓ */
  function cgViewsHtml() {
    return '<div class="cg-views">' + VIEWS.map((v) => cgBtn({
      act: 'view', val: v.k, on: CG.view === v.k, icon: v.e, label: v.n, title: v.tip,
    })).join('') + '</div>';
  }
  function cgBodyHtml() {
    const ctx = cgCtx();
    const tab = CG.tab;
    let h = '';
    /* ★ 历史面板**盖住整块正文** ✓ —— 它不属于任何一个页签 ✓，
       而且「回看」的时候本来就该把别的东西让开 ✓。 */
    if (CG.histOn) return cgHistHtml();
    /* ★ 「存到知识库」的对话框也盖住整块 ✓（它是模态的 ✓）*/
    if (CG.ask) return cgAskHtml();
    if (CG.err) h += '<div class="cg-note err">✗ ' + esc(CG.err) + '</div>';
    /* ★ 「存到知识库」✓ —— 用户原话：「把一些常用的记录下来，到知识库，
       做成**技术知识积累**」✓。**当前这次结果**也能直接存 ✓
       （不必先绕到历史里点那一下 ✓ —— 刚查完就想存是最自然的时机 ✓）。 */
    if (!CG.busy && cgTabHasResult(tab)) {
      h += '<div class="cg-tools">'
        + cgBtn({ act: 'asksavecur', icon: '📥', label: '存到知识库',
          title: '把这次查到的存进知识库（分类 / 项目可选，能接着编辑）' })
        + '<span class="tip">存进知识库以后能搜到、也能继续编辑 ✓</span></div>';
    }
    if (!ctx) {
      return h + '<div class="cg-empty">先打开一个代码文件 ✓<br>'
        + '<span>（这个工具要知道你正在编辑什么，才能查符号 / 拆逻辑 ✓）</span></div>';
    }
    if (tab === 'break') {
      /* ⚠️ 没有上下文（光标不在函数里 ✓）→ 先给「挑一个」的列表 ✓，不给空图 ✗ */
      if (!CG.graph && !CG.rows.length) {
        return h + cgBusyBar()
          + (CG.note ? '<div class="cg-note">' + esc(CG.note) + '</div>' : '')
          + '<div class="cg-empty">把光标放在「要拆的那个函数」里 ✓，再点「拆」<br>'
          + '<span>会先出一张控制流图，再让 AI 讲成人话 + 画成思维导图 ✓</span></div>';
      }
      if (CG.rows.length) {
        h += cgBusyBar();
        if (CG.note) h += '<div class="cg-note">' + esc(CG.note) + '</div>';
        h += CG.rows.map(cgRowHtml).join('');
        return h;
      }
      h += cgViewsHtml();
      h += cgBusyBar();
      if (CG.note) h += '<div class="cg-note">' + esc(CG.note) + '</div>';
      if (CG.view === 'code') {
        h += '<div id="cgx-graph" class="cg-graph"></div>';
        if (CG.graph && CG.graph.err) h += '<div class="cg-note err">✗ ' + esc(CG.graph.err) + '</div>';
      } else if (CG.view === 'flow') {
        if (CG.aiFlow && CG.aiFlow.err) h += cgAiFlowErr();
        else if (!CG.aiFlow || (!CG.aiFlow.data && !CG.aiFlow.busy)) h += '<div class="cg-empty">还没有 AI 拆解结果</div>';
        else if (CG.aiFlow.data) h += '<div id="cgx-flow"></div>';
      } else {
        if (CG.aiFlow && CG.aiFlow.err) h += cgAiFlowErr();
        else if (!CG.aiFlow || (!CG.aiFlow.data && !CG.aiFlow.busy)) h += '<div class="cg-empty">还没有 AI 拆解结果</div>';
        else if (CG.aiFlow.data) {
          const d = CG.aiFlow.data;
          if (d.what) h += '<div class="cg-summary"><span class="k">这段在干什么</span>' + esc(d.what) + '</div>';
          h += '<div id="cgx-mind" class="cg-mind"></div>';
        }
      }
      /* ── 动作按钮 ✓ —— 忙碌时**只有那一个**变转圈 ✓（其余照常可点 ✓） */
      const g = CG.graph;
      h += '<div class="cg-acts">'
        + cgBtn({
          act: 'flow', pri: true, icon: '🪄', label: CG.aiFlow && CG.aiFlow.data ? '重新拆解' : '让 AI 拆解',
          busy: cgIsBusy('flow'), busyText: '正在拆解…', title: '让 AI 用大白话讲一遍这段逻辑，并画成思维导图',
        })
        + cgBtn({
          id: 'cgx-skel', act: 'skel', icon: '🧱', label: '给我一个骨架', busy: cgIsBusy('skel'), busyText: '正在生成…',
          disabled: !(g && g.payload), title: '按控制流图生成一份骨架代码（走服务端解析，不是 AI 编的）',
        })
        + cgBtn({
          id: 'cgx-explain', act: 'explain', icon: '📖', label: '讲一遍这段在干什么',
          busy: cgIsBusy('explain'), busyText: '正在讲…',
        })
        + '</div>';
      if (g && g.skelErr) h += '<div class="cg-note err">✗ ' + esc(g.skelErr) + '</div>';
      if (g && g.skel) {
        h += '<pre class="cg-code" id="cgx-skelcode">' + cgCode(g.skel, (g.payload && g.payload.language) || (cgCtx() && cgCtx().language) || 'plaintext') + '</pre>'
          + '<div class="cg-acts">'
          + cgBtn({ act: 'use', text: g.skel, icon: '⤵', label: '插到光标处' })
          + cgBtn({ act: 'copysk', icon: '⧉', label: '复制' })
          + '</div>';
      }
      if (g && g.explainErr) h += '<div class="cg-note err">✗ ' + esc(g.explainErr) + '</div>';
      if (g && g.explain) h += '<div class="cg-explain">' + esc(g.explain).replace(/\n/g, '<br>') + '</div>';
      return h;
    }
    h += cgBusyBar();
    if (CG.note) h += '<div class="cg-note">' + esc(CG.note).replace(/\*\*(.+?)\*\*/g, '$1') + '</div>';
    if (tab === 'find' && CG.ai && CG.ai.err) h += '<div class="cg-note err">✗ AI：' + esc(CG.ai.err) + '</div>';
    /* ★★ 方案 ✓ —— 用户原话：「选中代码，基于上下文推荐，
       来给我推荐该可以通过什么方式实现」✓ → 先给**思路 + 示例**，再列候选 ✓。 */
    if (tab === 'find' && CG.ai && CG.ai.plan && CG.ai.plan.plan) {
      const pl = CG.ai.plan;
      h += '<div class="cg-plan"><div class="hd"><span class="t">💡 建议这么实现</span>'
        + '<span class="tag ai">AI 整理 · 供参考</span></div>'
        + '<div class="p">' + esc(pl.plan) + '</div>'
        + (pl.steps.length ? '<ol class="st">' + pl.steps.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>' : '')
        + (pl.example ? '<div class="cg-man-sec"><div class="cg-man-t"><span>可直接改的示例</span>'
          + '<span class="sp"></span>'
          + cgBtn({ act: 'copysk2', text: pl.example, icon: '⧉', label: '复制' })
          + cgBtn({ act: 'use', text: pl.example, icon: '⤵', label: '插到光标处' })
          + '</div><div class="cg-man-code"><pre>' + cgCode(pl.example, (cgCtx() && cgCtx().language) || 'plaintext') + '</pre></div></div>' : '')
        + '<div class="foot">下面那几条是具体可用的函数 / 类型 ✓ —— 带「已核实」的可以直接用 ✓，'
        + '带「未核实」的先确认名字 ✓。</div></div>';
    }
    if (tab === 'find' && CG.ai && CG.ai.hint) h += '<div class="cg-note">💡 ' + esc(CG.ai.hint) + '</div>';
    if (!CG.rows.length && !CG.busy) {
      /* ★★ 问了一句话 → 手册挂在**没有结果行**的位置上 ✗（它不属于任何一行 ✓）*/
      if (CG.manual) h += cgManualHtml();
      else h += cgEmptyHtml(tab, !!CG.note);
      return h;
    }
    h += CG.rows.map(cgRowHtml).join('');
    return h;
  }
  /* ★★ 空态**给能点的东西** ✗✗ —— 原来只有一句「输入一个符号名」✓，
     用户面对一块空白 ✓ 不知道该干嘛 ✓（截图里就是这样 ✓）。
     ⚠️ 而且**不要**用「试试这些」这种空话 ✗ —— 直接给可点的例子 ✓，
        点了就真的去查 ✓（`data-cgact="demo"` ✓）。
     ⚠️ `brief` = 上面已经有一句「没找到 X」的提示了 ✓ → 只留那几个按钮 ✓，
        别再说一遍「输入一个符号名」✗（自相矛盾 ✓）。 */
  /* ══ ★★★★ 「存到知识库」✓ ═══════════════════════════════════════════════
     用户原话：「给所查询的记录，做一个**注入到知识库**的按钮，同时做好**管理和分类**，
               这样可以把一些常用的记录下来，到知识库，做成**技术知识积累**」✓。

     ⚠️⚠️ 两件事必须做对 ✗✗：
     ① **「分类 / 项目」两级**是知识库**自己的结构** ✓（`知识库/分类/项目/文档.md` ✓，
        页面路径少于 3 段会被 `createPage()` 拒掉 ✓）——
        所以这里照它的结构来 ✓，**不另造一套分类** ✗（另造一套 = 用户在知识库里
        看到两套目录 ✗）。
     ② **写文件之前要先确保「项目」存在** ✗ —— 知识库靠项目里的 `.meta` 认它 ✓，
        直接写 `.md` 的话页面**可能根本不出现** ✗（那就白存了 ✓，而且很难查 ✓）。
        → 先 `POST /api/knowledge/project` ✓（已存在会报错 ✓，忽略即可 ✓），
          再 `POST /api/readings/text-fragment` 写正文 ✓（它落在知识库目录下会自动触发重建 ✓）。
     ⚠️ 用**页内浮层** ✗（这个项目禁用原生弹窗 ✓ —— 见 skill ✓）。 */
  const CG_KB_KEY = 'cg-kb-last';
  function cgKbLast() {
    try { return JSON.parse(localStorage.getItem(CG_KB_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function cgKbRemember(cat, proj) {
    try { localStorage.setItem(CG_KB_KEY, JSON.stringify({ cat, proj, at: Date.now() })); } catch (_) {}
  }
  function cgKbSafe(s) {
    /* ⚠️ 文件名里不能出现 `/ \ : * ? " < > | #` ✗（会跑到别的目录 / 建不出来 ✓）*/
    return String(s == null ? '' : s).replace(/[\\/:*?"<>|#]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  /* 把「这次查到的」变成一段能长期留着的 markdown ✓。
     ⚠️ 三种页签的正文形态**完全不一样** ✗ → 分开写 ✓（硬凑成一种会很难看 ✓，
        而且「手册」和「思维导图」本来就不是一类东西 ✓）。 */
  function cgMdOf(tab, snap, q) {
    const L = [];
    const kind = tab === 'look' ? '速查手册' : tab === 'find' ? '实现方案' : '逻辑拆解';
    L.push('---');
    L.push('title: ' + JSON.stringify(q));
    L.push('tags: [代码向导, ' + kind + ']');
    L.push('---', '');
    L.push('# ' + q, '');
    L.push('> 由「代码向导」在 ' + new Date().toLocaleString('zh-CN') + ' 存入 —— ' + kind + ' ✓');
    L.push('');
    if (tab === 'look') {
      const m = snap && snap.manual;
      const d = m && m.data;
      if (d) {
        if (d.what) L.push(d.what, '');
        if (d.header) { L.push('```c_cpp', d.header, '```', ''); }
        (d.sections || []).forEach((s) => {
          L.push('## ' + s.t, '');
          if (s.d) L.push(s.d, '');
          if (s.code) L.push('```c_cpp', s.code, '```', '');
        });
        if ((d.apis || []).length) {
          L.push('## 常用成员', '', '| 名字 | 签名 | 说明 |', '| --- | --- | --- |');
          d.apis.forEach((a) => L.push('| `' + a.n + '` | ' + (a.sig || '—') + ' | ' + (a.d || '') + ' |'));
          L.push('');
        }
        if ((d.pitfalls || []).length) {
          L.push('## 容易踩的坑', '');
          d.pitfalls.forEach((x) => L.push('- ' + x));
          L.push('');
        }
        if (m.sig) L.push('> LSP 给的签名（权威）：`' + m.sig + '`', '');
      } else if (snap && (snap.rows || []).length) {
        L.push('## 相关符号', '');
        (snap.rows || []).forEach((r) => {
          L.push('- `' + r.name + '`' + (r.doc ? ' —— ' + String(r.doc).split('\n')[0].slice(0, 120) : ''));
        });
        L.push('');
      }
    } else if (tab === 'find') {
      const ai = (snap && snap.ai) || {};
      const pl = ai.plan || {};
      if (pl.plan) L.push('## 思路', '', pl.plan, '');
      if ((pl.steps || []).length) {
        L.push('## 步骤', '');
        pl.steps.forEach((s, i) => L.push((i + 1) + '. ' + s));
        L.push('');
      }
      if (pl.example) L.push('## 示例代码', '', '```c_cpp', pl.example, '```', '');
      if (ai.hint) L.push('## 注意', '', ai.hint, '');
      if ((ai.names || []).length) {
        L.push('## 用到的东西', '', '| 名字 | 为什么 | 怎么用 |', '| --- | --- | --- |');
        ai.names.forEach((n) => L.push('| `' + n.n + '` | ' + (n.why || '') + ' | `' + (n.use || '') + '` |'));
        L.push('');
      }
    } else {
      const fl = snap && snap.aiFlow && snap.aiFlow.data;
      if (fl) {
        if (fl.what) L.push('## 这段在干什么', '', fl.what, '');
        if ((fl.in || []).length || (fl.out || []).length) {
          L.push('## 输入 / 输出', '');
          (fl.in || []).forEach((x) => L.push('- 进：' + x));
          (fl.out || []).forEach((x) => L.push('- 出：' + x));
          L.push('');
        }
        if ((fl.steps || []).length) {
          L.push('## 步骤', '');
          fl.steps.forEach((s, i) => {
            L.push((i + 1) + '. **' + (s.t || '') + '**' + (s.d ? ' —— ' + s.d : ''));
            (s.branch || []).forEach((b) => L.push('   - 如果' + (b.cond || '') + ' → ' + (b.to || '')));
          });
          L.push('');
        }
        if ((fl.pitfalls || []).length) {
          L.push('## 容易搞错的地方', '');
          fl.pitfalls.forEach((x) => L.push('- ' + x));
          L.push('');
        }
      }
      const g = snap && snap.graph;
      if (g && g.payload && (g.payload.nodes || []).length) {
        L.push('## 控制流', '');
        (g.payload.nodes || []).slice(0, 40).forEach((n) => {
          L.push('- `' + String(n.kind || n.type || '').slice(0, 12) + '` ' + String(n.label || n.text || '').slice(0, 90));
        });
        L.push('');
      }
    }
    L.push('---', '');
    L.push('<!-- 由 CodeScope 代码向导生成 —— 存下来是为了以后不用再查一遍，可以自由编辑 ✓ -->');
    return L.join('\n');
  }
  function cgAskOpen(tab, q, snap) {
    const title = String(q || '').slice(0, 60);
    CG.ask = {
      tab, q: String(q || ''), title, cat: '', proj: '', busy: false, err: '', loaded: false,
      newCat: false, newProj: false, byCat: {},
      md: cgMdOf(tab, snap, String(q || '')),
    };
    CG.histOn = false;
    cgRender();
    /* 拉现有的分类 / 项目 ✓（异步 ✓，回来再重绘 ✓）*/
    fetch('/api/knowledge/status', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      if (!CG.ask) return;
      /* ⚠️⚠️ 先把**用户已经打进去的**收回来 ✗✗ —— 这次会**重绘** ✓，
         而重绘是按 `CG.ask` 重建输入框的 ✓ →
         用户在「列表还没拉回来」那几百毫秒里打的字**会被抹掉** ✗✗。
         实测踩过 ✓：探针先把分类填成 `__探针代码向导__` ✓，
         拉取回来一重绘就变回默认的「快速开始 / 使用指南」✓ →
         结果**存到了用户的默认分类下** ✗（探针自己的清理还查不到它 ✓，
         因为那个断言只盯 `__探针代码向导__` ✓）。
         ⚠️ 这类 bug 在界面上表现为「我明明打了字，怎么又变回去了」✗，
            用户只会觉得「这个框有毛病」✓。 */
      const t0 = document.getElementById('cg-ask-title');
      const c0 = document.getElementById('cg-ask-cat');
      const p0 = document.getElementById('cg-ask-proj');
      if (t0 && t0.value) CG.ask.title = t0.value;
      if (c0 && c0.value && c0.value !== '__new__') CG.ask.cat = c0.value;
      if (p0 && p0.value && p0.value !== '__new__') CG.ask.proj = p0.value;
      const pages = (d && d.pages) || [];
      const cats = [], byCat = {};
      pages.forEach((p) => {
        const parts = String((p && p.path) || '').split('/');
        if (parts.length >= 2 && parts[0] && parts[0] !== 'index.md') {
          if (cats.indexOf(parts[0]) < 0) cats.push(parts[0]);
          byCat[parts[0]] = byCat[parts[0]] || [];
          if (byCat[parts[0]].indexOf(parts[1]) < 0) byCat[parts[0]].push(parts[1]);
        }
      });
      CG.ask.cats = cats;
      CG.ask.byCat = byCat;
      CG.ask.loaded = true;
      const last = cgKbLast();
      /* ⚠️ 只在**还是空的**时候才套默认值 ✗（已经填过的不要覆盖 ✓）*/
      if (!CG.ask.cat) CG.ask.cat = last.cat || cats[0] || '技术积累';
      if (!CG.ask.proj) {
        const list = byCat[CG.ask.cat] || [];
        CG.ask.proj = (last.cat === CG.ask.cat && last.proj) || list[0] || '常用代码';
      }
      cgRender();
    }).catch(() => { if (CG.ask) { CG.ask.loaded = true; if (!CG.ask.cat) CG.ask.cat = '技术积累'; if (!CG.ask.proj) CG.ask.proj = '常用代码'; cgRender(); } });
  }
  async function cgAskRun() {
    const a = CG.ask;
    if (!a || a.busy) return;
    const cat = cgKbSafe(a.cat), proj = cgKbSafe(a.proj), title = cgKbSafe(a.title) || cgKbSafe(a.q) || '未命名';
    if (!cat || !proj) { a.err = '分类和项目都要填 ✓'; cgRender(); return; }
    a.busy = true; a.err = ''; cgRender();
    try {
      /* ① 先确保**项目**存在 ✓（知识库靠项目里的 .meta 认它 ✓ —— 见上面那段注释 ✓）*/
      try {
        await fetch('/api/knowledge/project', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cat + '/' + proj, description: '代码向导积累的技术知识' }),
        });
      } catch (_) {}
      /* ② 再写正文 ✓（落在知识库目录下会自动触发重建 ✓）*/
      const rel = '知识库/' + cat + '/' + proj + '/' + title + '.md';
      const r = await fetch('/api/readings/text-fragment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: rel, content: a.md }),
      });
      const d = await r.json();
      if (!d || !d.ok) throw new Error((d && d.error) || '保存失败');
      cgKbRemember(cat, proj);
      CG.ask = null;
      cgRender();
      toast('已存进知识库 ✓ ' + cat + ' / ' + proj + ' / ' + title + '.md');
    } catch (e) {
      a.busy = false; a.err = String((e && e.message) || e); cgRender();
    }
  }
  /* 分类那一格 ✓ —— 现有分类的下拉 ✓，最后一项「＋ 新建分类…」✓；
     选了「新建」就换成输入框 ✓（**能建新的**这件事必须看得见 ✗）。 */
  function cgAskCatField(a) {
    if (a.newCat) {
      return '<input id="cg-ask-cat" value="' + esc(a.cat || '') + '" placeholder="新分类的名字，如 代码向导">'
        + cgBtn({ act: 'askbackcat', icon: '↩', label: '选现有的' });
    }
    const cats = a.cats || [];
    return '<select id="cg-ask-cat">'
      + (cats.length ? '' : '<option value="">（还没有分类）</option>')
      + cats.map((x) => '<option value="' + esc(x) + '"' + (x === a.cat ? ' selected' : '') + '>' + esc(x) + '</option>').join('')
      + '<option value="__new__">＋ 新建分类…</option></select>';
  }
  /* 项目那一格 ✓ —— ⚠️ **只列「当前分类下」的项目** ✗✗ ——
     原来是把所有项目都列出来 ✓（还只取路径第二段 ✓）→
     选了「代码向导」这个分类 ✓，项目里却还挂着「使用指南」✗（那是别的分类下的 ✓），
     选下去会存到 `代码向导/使用指南/…` ✗ —— 目录结构就乱了 ✓。 */
  function cgAskProjField(a) {
    if (a.newProj) {
      return '<input id="cg-ask-proj" value="' + esc(a.proj || '') + '" placeholder="新项目的名字，如 常用代码 / STL">'
        + cgBtn({ act: 'askbackproj', icon: '↩', label: '选现有的' });
    }
    const list = ((a.byCat || {})[a.cat] || []);
    return '<select id="cg-ask-proj">'
      + (list.length ? '' : '<option value="">（这个分类下还没有项目）</option>')
      + list.map((x) => '<option value="' + esc(x) + '"' + (x === a.proj ? ' selected' : '') + '>' + esc(x) + '</option>').join('')
      + '<option value="__new__">＋ 新建项目…</option></select>';
  }
  function cgAskHtml() {
    const a = CG.ask;
    if (!a) return '';
    const kind = a.tab === 'look' ? '速查手册' : a.tab === 'find' ? '实现方案' : '逻辑拆解';
    let h = '<div class="cg-ask">';
    h += '<div class="cg-ask-hd"><span class="t">📥 存到知识库</span>'
      + '<span class="tag">' + esc(kind) + '</span><span class="sp"></span>'
      + cgBtn({ act: 'ask', icon: '✕', label: '取消' }) + '</div>';
    h += '<div class="cg-ask-b">';
    h += '<div class="cg-ask-row"><label>标题</label><input id="cg-ask-title" value="' + esc(a.title) + '" placeholder="文档标题"></div>';
    /* ⚠️⚠️ 分类 / 项目用**真正的下拉** ✗✗，不用 `<datalist>` ——
       用户原话：「**没有其他选择**，比如代码向导里面去」✓。
       实测：`<datalist>` 在 macOS 上**长得就像个下拉** ✓，
       用户根本不会想到「这里还能自己打字」✗ → 等于**锁死在现有的分类里** ✗。
       → 改成：**下拉列出现有的** ✓ + 最后一项「＋ 新建…」✓，
         选它就把这一格换成输入框 ✓（明确告诉用户「能建新的」✓）。 */
    h += '<div class="cg-ask-row"><label>分类</label>' + cgAskCatField(a) + '</div>';
    h += '<div class="cg-ask-row"><label>项目</label>' + cgAskProjField(a) + '</div>';
    h += '<div class="cg-ask-path">会存到：<code>' + esc('知识库/' + (cgKbSafe(a.cat) || '分类') + '/' + (cgKbSafe(a.proj) || '项目') + '/' + (cgKbSafe(a.title) || '标题') + '.md') + '</code></div>';
    if (!a.loaded) h += '<div class="cg-ask-hint">正在读现有的分类 / 项目…</div>';
    else if (!(a.cats || []).length) h += '<div class="cg-ask-hint">知识库里还没有分类 —— 选「＋ 新建分类…」建一个 ✓</div>';
    else if (!(a.byCat || {})[a.cat] || !(a.byCat || {})[a.cat].length) h += '<div class="cg-ask-hint">「' + esc(a.cat || '') + '」下还没有项目 —— 选「＋ 新建项目…」建一个 ✓</div>';
    h += '<div class="cg-ask-md">' + esc(String(a.md).slice(0, 260)) + (String(a.md).length > 260 ? '\n…（共 ' + Math.round(String(a.md).length / 1024) + ' KB）' : '') + '</div>';
    if (a.err) h += '<div class="cg-note err">✗ ' + esc(a.err) + '</div>';
    h += '<div class="cg-ask-ft">'
      + cgBtn({ act: 'askrun', pri: true, icon: '📥', label: a.busy ? '正在存…' : '存进去', busy: a.busy, busyText: '正在存…' })
      + cgBtn({ act: 'ask', icon: '✕', label: '取消' })
      + '<span class="tip">存进去之后，知识库里就能搜到、也能接着编辑 ✓</span></div>';
    h += '</div></div>';
    return h;
  }

  /* ★★★★ 历史面板 ✓ —— 用户原话：「再给我新增查阅历史记录，方便我回看」✓。
     ⚠️ 每一行**点一下就重查** ✗（不只是给你看看 ✓）——
        「回看」的目的十有八九是「再看一遍那个东西」✓，
        只展示不能点的话，你还得**手打一遍**那个词 ✗（那就不叫方便了 ✓）。
     ⚠️ 在**别的文件**里拆的（`break` ✓）要标出来 ✗ ——
        点它会跳不过去 ✓，得说清楚为什么 ✓（别让用户以为按钮坏了 ✗）。 */
  function cgHistHtml() {
    const list = CG.hist || [];
    const ctx = cgCtx();
    const tabOf = (k) => (TABS.find((x) => x.k === k) || TABS[0]);
    let h = '<div class="cg-hist">';
    h += '<div class="cg-hist-hd"><span class="t">🕘 查阅历史</span>'
      + '<span class="n">' + list.length + ' 条</span><span class="sp"></span>'
      + cgBtn({ act: 'histclear', icon: '🗑', label: '清空', disabled: !list.length })
      + cgBtn({ act: 'hist', icon: '✕', label: '收起' }) + '</div>';
    if (!list.length) {
      return h + '<div class="cg-empty">还没查过东西 ✓<br>'
        + '<span>你查过的会自动记在这儿，方便回看 ✓</span></div></div>';
    }
    h += list.map((x, i) => {
      const t = tabOf(x.tab);
      const q = String(x.q || x.name || '');
      const other = x.tab === 'break' && x.file && ctx && x.file !== ctx.file;
      return '<div class="cg-hist-row' + (other ? ' off' : '') + '" data-cgact="histgo" data-cgval="' + i + '"'
        + ' title="' + esc(other ? '这条是在另一个文件里拆的 —— 先把那个文件打开' : ('再查一遍「' + q + '」')) + '">'
        + '<span class="e">' + esc(t.e) + '</span>'
        + '<span class="q">' + esc(q) + '</span>'
        + (other ? '<span class="w">别的文件</span>' : '')
        /* ★ 「存到知识库」✓ —— 用户原话：「给所查询的记录，做一个注入到知识库的按钮」✓。
           ⚠️ 它是**行内的按钮** ✗（整行是「点一下重查」✓）——
              靠 `closest('[data-cgact]')` **先命中自己** ✓，
              所以点它不会顺手把这条重查一遍 ✓（不用手动 stopPropagation ✓）。 */
        + cgBtn({ act: 'asksave', val: i, icon: '📥', label: '存知识库', disabled: !x.res,
          title: x.res ? '把这条查到的存进知识库（做技术积累）' : '这条没存下结果 —— 先点它一次再来存' })
        + '<span class="ago">' + esc(cgAgo(x.at)) + '</span></div>';
    }).join('');
    return h + '</div>';
  }
  /* 从历史点回来 ✓ —— 用户原话：「**为什么点击加载历史记录，还需要 AI 重新思考**」✓。
     ⚠️⚠️ 现在**有结果就直接摆出来** ✗（秒开 ✓），只有「没存到结果」的才重算 ✓
        （结果太大的 / 太旧的，落盘时被丢掉了 ✓ —— 见 cgHistSave ✓）。 */
  function cgHistGo(i) {
    const row = (CG.hist || [])[Number(i)];
    if (!row) return;
    CG.histOn = false;
    if (row.tab === 'break') {
      const ctx = cgCtx();
      if (row.file && ctx && row.file !== ctx.file) {
        toast('「' + row.q + '」是在另一个文件里拆的 —— 先把那个文件打开 ✓');
        cgRender();
        return;
      }
      /* ★ 存过结果 → 直接把那张导图摆回来 ✓（**不用再拆一遍** ✗）*/
      if (row.res && row.res.graph) {
        CG.graph = row.res.graph;
        CG.aiFlow = row.res.aiFlow || null;
        CG.view = row.res.view || 'mind';
        CG.root = row.res.root || { name: row.q, line: row.line };
        CG.err = ''; CG.note = ''; CG.rows = [];
        CG.busyAct = ''; CG.busyTxt = ''; CG.busy = false;
        cgRender();
        return;
      }
      if (!row.line) { toast('这条没记下行号 —— 回到「拆逻辑」从列表里挑一个 ✓'); cgRender(); return; }
      cgPick({ name: row.q, line: row.line, frag: -1 });
      return;
    }
    /* 切到那个页签 ✓、把查询词填回去 ✓ */
    if (CG.tab !== row.tab) { cgStash(); CG.tab = row.tab; cgRestore(row.tab); }
    CG.busyAct = ''; CG.busyTxt = ''; CG.busy = false;
    CG.q = String(row.q || '');
    if (row.res) {
      /* ★ 秒开 ✓ —— 一个字节都不用重算 ✓ */
      CG.rows = row.res.rows || [];
      CG.note = row.res.note || '';
      CG.manual = row.res.manual || null;
      CG.ai = row.res.ai || null;
      CG.graph = null; CG.aiFlow = null; CG.err = '';
      cgRender();
      const qi = $('#cgx-q');
      if (qi) { qi.value = CG.q; qi.disabled = false; }
      return;
    }
    /* 没存到结果（太大 / 太旧 / 老记录 ✓）→ 老老实实重查一遍 ✓ */
    CG.rows = []; CG.manual = null; CG.ai = null; CG.aiFlow = null; CG.note = ''; CG.err = '';
    cgRender();
    const q = $('#cgx-q');
    if (q) { q.value = CG.q; q.disabled = false; }
    cgRun();
  }
  function cgEmptyHtml(tab, brief) {
    const ctx = cgCtx();
    const lang = (ctx && ctx.language) || '';
    const demos = /c_cpp|c\b/.test(lang) ? ['unordered_map', 'vector', 'std::string', 'printf']
      : /python/.test(lang) ? ['dict', 'list', 'enumerate', 'json.dumps']
        : /javascript|typescript/.test(lang) ? ['Map', 'Array.map', 'JSON.stringify', 'Promise.all']
          : /go/.test(lang) ? ['map', 'slice', 'fmt.Sprintf', 'sync.Mutex'] : ['vector', 'unordered_map'];
    const list = tab === 'look' ? demos
      : ['把字符串转成整数', '读一个文件', '统计词频', '哈希表'];
    const icon = tab === 'look' ? '🔍' : '💡';
    const btns = '<div class="cg-demos">' + list.map((x) => cgBtn({
      act: 'demo', val: x, icon, label: x,
    })).join('') + '</div>';
    /* ★ 空态顺手把**最近查过的**摆出来 ✓ —— 用户原话：
       「再给我新增查阅历史记录，方便我回看」✓。
       ⚠️ 只挑**当前页签**的 ✗（在「查手册」里摆一堆「找方案」的记录 ✓ 点不了还乱 ✗）。 */
    const recent = (CG.hist || []).filter((x) => x.tab === tab).slice(0, 4);
    const recentHtml = recent.length
      ? '<div class="cg-hist-mini"><span class="lb">最近查过</span>'
        + recent.map((x) => {
          const at = (CG.hist || []).indexOf(x);
          return '<span class="cg-hist-chip" data-cgact="histgo" data-cgval="' + at + '" title="再查一遍">'
            + esc(String(x.q || x.name || '')) + '<i>' + esc(cgAgo(x.at)) + '</i></span>';
        }).join('')
        + '</div>'
      : '';
    if (brief) return btns + recentHtml;
    if (tab === 'look') {
      return '<div class="cg-empty">把光标放到你要查的那个词上 ✓，再按 ⌘I<br>'
        + '<span>打开就会自动帮你查它怎么用（定义 / 增删改查 / 例子）✓</span>'
        + btns + recentHtml + '</div>';
    }
    return '<div class="cg-empty">用大白话说你要干什么 ✓<br>'
      + '<span>先选中一段代码再说，它会按你的上下文给方案（用哪个包 / 函数 + 例子）✓</span>'
      + btns + recentHtml + '</div>';
  }
  /* AI 拆解失败 ✓ —— 必须带**重试入口** ✗（不能只报错就走 ✓，
     这个项目在「源挂了却说没内容」上栽过 ✓）。 */
  function cgAiFlowErr() {
    const msg = String((CG.aiFlow && CG.aiFlow.err) || '');
    const isNet = /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg);
    return '<div class="cg-note err">✗ AI 拆解失败：' + esc(msg) + '</div>'
      + (isNet ? '<div class="cg-note">多半是 CodeScope 刚重启过（重启会掐断正在跑的请求）。等一下再点「重新拆解」✓</div>' : '')
      + '<div class="cg-acts">' + cgBtn({ act: 'flow', pri: true, icon: '🪄', label: '再试一次' }) + '</div>';
  }
  /* 重绘之后要把三张图**重新画一遍** ✗ —— 它们是用 DOM 量出来的 ✓，
     `innerHTML` 一换就全没了 ✓（只写 HTML 是画不出来的 ✓）。 */
  function cgDrawAll() {
    cgDrawGraph();
    cgDrawMind();
    cgDrawFlow();
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
    /* 历史按钮要**看得出开着** ✗（不然用户不知道自己在看历史面板 ✓）*/
    const histBtn = $('#cgx-hist');
    if (histBtn) histBtn.classList.toggle('on', !!CG.histOn);
    /* ★ 存知识库的对话框：打字时**实时更新「会存到哪」** ✓
       ⚠️ 只改那一行文字 ✗，**不重绘** ✗ —— 重绘会把输入框重建 ✓，光标就丢了 ✓。 */
    if (CG.ask) {
      const pick = (id) => document.getElementById(id);
      const sync = (changedId) => {
        const t = pick('cg-ask-title'), c = pick('cg-ask-cat'), p = pick('cg-ask-proj');
        if (CG.ask) {
          if (t) CG.ask.title = t.value;
          if (c && c.value && c.value !== '__new__') CG.ask.cat = c.value;
          if (p && p.value && p.value !== '__new__') CG.ask.proj = p.value;
        }
        const code = document.querySelector('.cg-ask-path code');
        if (code && CG.ask) {
          code.textContent = '知识库/' + (cgKbSafe(CG.ask.cat) || '分类') + '/'
            + (cgKbSafe(CG.ask.proj) || '项目') + '/' + (cgKbSafe(CG.ask.title) || '标题') + '.md';
        }
        /* ★ 换了**分类** → 项目列表要跟着换 ✓ ——
           原来那个项目多半不属于新分类 ✓，留着就会存成 `新分类/老项目/…` ✗（目录就乱了 ✓）。
           ⚠️ 重绘同样要**推到下一个任务** ✗（原因见上面 `onchange` 那段注释 ✓）。 */
        if (changedId === 'cg-ask-cat' && CG.ask) {
          const list = ((CG.ask.byCat || {})[CG.ask.cat] || []);
          if (list.indexOf(CG.ask.proj) < 0) { CG.ask.proj = list[0] || ''; CG.ask.newProj = !list.length; }
          setTimeout(cgRender, 0);
        }
      };
      ['cg-ask-title', 'cg-ask-cat', 'cg-ask-proj'].forEach((id) => {
        const el = pick(id);
        if (!el) return;
        el.oninput = () => sync(id);
        /* ★ 下拉选到「＋ 新建…」→ 把这一格换成输入框 ✓（用户原话：
           「**没有其他选择**，比如代码向导里面去」✓ —— 得让他**看得见能建新的** ✗）*/
        el.onchange = () => {
          if (el.value === '__new__' && CG.ask) {
            if (id === 'cg-ask-cat') { CG.ask.newCat = true; CG.ask.cat = ''; }
            else if (id === 'cg-ask-proj') { CG.ask.newProj = true; CG.ask.proj = ''; }
            /* ⚠️⚠️ 必须**让事件先跑完**再重绘 ✗✗ ——
               在 `change` 处理器里直接 `cgRender()` ✓ → `innerHTML = …` 会把
               **正在派发事件的那个 `<select>`** 从文档里摘掉 ✗ → Chrome 直接报
               「The node to be removed is no longer a child of this node.
                 Perhaps it was moved in a 'blur' event handler?」✗
               （实测：`code-guide` 和 `editor-menu` 两个探针的「无页面异常」都挂了 ✗）。
               → `setTimeout(…, 0)` 推到下一个任务 ✓，这时事件已经派发完了 ✓。 */
            setTimeout(() => {
              cgRender();
              const n = document.getElementById(id);
              if (n) n.focus();
            }, 0);
            return;
          }
          sync(id);
        };
        /* 回车 = 直接存 ✓（这种小表单就该能一路回车走完 ✓）*/
        el.onkeydown = (ev) => {
          if (ev.key !== 'Enter') return;
          ev.preventDefault();
          const b = document.querySelector('[data-cgact="askrun"]');
          if (b) b.click();
        };
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
    /* ⚠️ 三张图（控制流 / 思维导图 / 实现流程）都是**量出来的** ✗✗ ——
       `innerHTML` 一换就全没了 ✓，光写 HTML 画不出来 ✓ → 必须重画一遍 ✓。 */
    cgDrawAll();
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
          原来 .cg-mask 是一层半透明全屏遮罩 ✓ 而且**点它就关闭** ✓ →
          用户**没法一边查一边写代码** ✗（点一下编辑器，向导就没了 ✓）。
       → 现在：外层只用来兜住定位 ✓，pointer-events:none ✓（底下的页面**完全可点** ✓），
         只有窗口本身 pointer-events:auto ✓。
       ⚠️ 也**不再「点外面关闭」** ✗ —— 它是常驻小工具 ✓，要关就点 ✕ / 按 Esc ✓。 */
    '.cg-mask{position:fixed;inset:0;z-index:9990;display:none;pointer-events:none}',
    '.cg-mask.on{display:block}',
    '.cg-box{position:fixed;pointer-events:auto;width:560px;min-width:340px;max-width:96vw;',
    'max-height:76vh;display:flex;flex-direction:column;',
    'background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden;',
    'box-shadow:0 26px 80px rgba(0,0,0,.5),0 2px 10px rgba(0,0,0,.32);font-family:var(--ui);color:var(--text)}',
    /* 顶栏 = **拖动把手** ✓ —— cursor:move 让「这个能拖」一眼看得出来 ✓
       （不能拖的地方写着 cursor:move 是骗人 ✗；能拖的地方不写就是藏着 ✓）。 */
    '.cg-head{display:flex;align-items:center;gap:9px;padding:11px 13px;flex:none;cursor:move;',
    'border-bottom:1px solid var(--border);user-select:none;',
    'background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 12%,transparent),transparent)}',
    '.cg-head.dragging{cursor:grabbing}',
    /* 折叠成一条「药丸」✓ —— 用户原话：「也可以拖动放到一边」✓。 */
    '.cg-box.min{max-height:none}',
    '.cg-box.min .cg-tabs,.cg-box.min .cg-search,.cg-box.min .cg-tip,',
    '.cg-box.min .cg-body,.cg-box.min .cg-foot,.cg-box.min .cg-rs{display:none}',
    '.cg-box.min .cg-head{border-bottom:0}',
    /* 右下角缩放把手 ✓（和「能拖」是一对：能挪位置，也能改大小 ✓）*/
    '.cg-rs{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:2}',
    '.cg-rs::after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;opacity:.45;',
    'border-right:2px solid var(--dim);border-bottom:2px solid var(--dim)}',
    '.cg-rs:hover::after{opacity:.95;border-color:var(--accent)}',
    '.cg-head .ic{font-size:16px;line-height:1}',
    '.cg-head b{font-size:13px;letter-spacing:.3px;white-space:nowrap;font-weight:600}',
    '.cg-head .ctx{font-size:10.5px;color:var(--dim);font-family:var(--mono);overflow:hidden;',
    'text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}',
    '.cg-head .sp{flex:1;min-width:0}',
    '.cg-head .kbd{font-size:10px;color:var(--dim);border:1px solid var(--border);border-radius:5px;padding:2px 6px;flex:none;',
    'background:color-mix(in srgb,var(--panel2) 70%,transparent)}',
    /* ⚠️ 顶栏上那两个按钮**不能继承 cursor:move** ✗ ——
       不然鼠标移上去还写着「可拖动」✓，点的时候心里没底 ✓。 */
    '.cg-head .hb{flex:none;width:26px;height:24px;display:flex;align-items:center;justify-content:center;',
    'border:1px solid transparent;border-radius:7px;color:var(--dim);cursor:pointer;font-size:12px;line-height:1;',
    'transition:background .13s,border-color .13s,color .13s}',
    '.cg-head .hb:hover{border-color:var(--border);color:var(--text);background:var(--bg)}',
    '.cg-head .hb:active{transform:translateY(1px)}',
    '.cg-head .hb:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
    '.cg-head .hb.x:hover{color:var(--err);border-color:var(--err)}',
    /* ── 页签 ✓ ────────────────────────────────────────────────────────── */
    '.cg-tabs{display:flex;gap:6px;padding:10px 13px 0;flex:none}',
    '.cg-tab{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:6px 12px;border-radius:8px;',
    'border:1px solid var(--border);background:transparent;color:var(--dim);cursor:pointer;',
    'transition:background .13s,border-color .13s,color .13s}',
    '.cg-tab:hover{color:var(--text);background:var(--bg);border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}',
    '.cg-tab:active{transform:translateY(1px)}',
    '.cg-tab:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
    '.cg-tab.on{color:var(--accent);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,transparent)}',
    '.cg-tab .e{font-size:12px}',
    /* ── 搜索行 ✓ ──────────────────────────────────────────────────────── */
    '.cg-search{display:flex;gap:8px;padding:10px 13px 0;flex:none}',
    '.cg-search input{flex:1;min-width:0;height:35px;padding:0 12px;background:var(--bg);color:var(--text);',
    'border:1px solid var(--border);border-radius:8px;font:13px var(--mono);outline:none;transition:border-color .13s}',
    '.cg-search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}',
    '.cg-search input:disabled{opacity:.45}',
    '.cg-search .cg-btn{height:35px;padding:0 18px;font-size:12.5px;flex:none}',
    '.cg-tip{font-size:11px;color:var(--dim);padding:7px 13px 0;flex:none;line-height:1.6}',
    /* ⚠️⚠️ 这里必须是 flex:1 1 auto ✗✗，**不能写 flex:1** ✗ ——
       flex:1 = flex-basis:0% ✓，而 .cg-box 的高度是**内容撑出来的**（只有 max-height ✗，
       没有固定高度 ✓）→ 父级高度「不确定」时 ✓，basis 0 的子项**拿不到任何剩余空间** ✗ →
       实测**高度直接塌成 0** ✗ → 逻辑图整块被裁掉 ✓、下面的按钮全都点不到 ✗
       （探针报的是「#cg-skel not visible」✗，看着像按钮没了 ✓，其实是**容器 0 高** ✗）。
       → flex-basis:auto ✓：跟着**内容**长 ✓，长到超过 max-height 再靠 overflow 滚 ✓。 */
    '.cg-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 13px 14px}',
    '.cg-note{font-size:11.5px;line-height:1.75;color:var(--dim);padding:8px 11px;margin-bottom:9px;border-radius:0 7px 7px 0;',
    'border-left:2px solid var(--border);background:color-mix(in srgb,var(--panel2) 55%,transparent)}',
    '.cg-note.err{color:var(--err);border-left-color:var(--err);background:color-mix(in srgb,var(--err) 8%,transparent)}',
    '.cg-note b{color:var(--text)}',
    '.cg-empty{color:var(--dim);font-size:12px;line-height:1.9;text-align:center;padding:28px 12px}',
    '.cg-empty span{font-size:11px;opacity:.8}',
    /* ★★ 空态里那几个**可点的例子** ✓ —— 用户面对一块空白不知道该干嘛 ✗，
       给几个真能点的入口 ✓（点了就去查 ✓，不是摆设 ✓）。 */
    '.cg-demos{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:14px}',
    '.cg-demos .cg-btn{height:26px;font-size:11px}',
    /* ── ★★ 查阅历史 ✓（用户原话：「再给我新增查阅历史记录，方便我回看」✓）────
       ⚠️ 每一行**整行可点** ✗（不是只有一个小按钮 ✓）—— 「回看」的动作就是点它 ✓，
          给一个小靶子反而难点 ✓。 */
    '.cg-head .hb.on{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 55%,transparent);',
    'background:color-mix(in srgb,var(--accent) 14%,transparent)}',
    '.cg-hist-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:9px}',
    '.cg-hist-hd .t{font-size:12.5px;font-weight:600;color:var(--text)}',
    '.cg-hist-hd .n{font-size:10.5px;color:var(--dim)}',
    '.cg-hist-hd .sp{flex:1;min-width:0}',
    '.cg-hist-row{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;',
    'border:1px solid var(--border);background:var(--panel2);margin-bottom:6px;cursor:pointer;',
    'transition:border-color .13s,background .13s,transform .06s}',
    '.cg-hist-row:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));',
    'background:color-mix(in srgb,var(--accent) 8%,var(--panel2))}',
    '.cg-hist-row:active{transform:translateY(1px)}',
    '.cg-hist-row.off{opacity:.6}',
    '.cg-hist-row .e{flex:none;font-size:12px}',
    '.cg-hist-row .q{flex:1;min-width:0;font-size:12px;color:var(--text);font-family:var(--mono);',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cg-hist-row .w{flex:none;font-size:9.5px;color:var(--dim);border:1px solid var(--border);',
    'border-radius:999px;padding:1px 6px}',
    '.cg-hist-row .ago{flex:none;font-size:10px;color:var(--dim)}',
    /* 空态下面那排「最近查过」✓ —— 一眼看到、点一下就重查 ✓ */
    '.cg-hist-mini{margin-top:14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center}',
    '.cg-hist-mini .lb{font-size:10.5px;color:var(--dim)}',
    '.cg-hist-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:3px 9px;',
    'border-radius:999px;border:1px solid var(--border);background:var(--panel2);color:var(--text);',
    'cursor:pointer;font-family:var(--mono);transition:border-color .13s,color .13s,background .13s}',
    '.cg-hist-chip:hover{border-color:var(--accent);color:var(--accent);',
    'background:color-mix(in srgb,var(--accent) 10%,var(--panel2))}',
    '.cg-hist-chip i{font-style:normal;font-size:9.5px;color:var(--dim)}',
    /* ── ★★ 「存到知识库」✓（用户原话：「做一个注入到知识库的按钮，同时做好管理和分类」✓）
       ⚠️ 历史行里的那个 📥 要**压小一点** ✗ —— 行本身才 30 多像素高 ✓，
          用默认尺寸会把整行撑变形 ✓。 */
    '.cg-hist-row .cg-btn{height:22px;font-size:10.5px;padding:0 8px;gap:4px}',
    '.cg-tools{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:8px 0 10px}',
    '.cg-tools .tip{font-size:10.5px;color:var(--dim)}',
    '.cg-ask-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
    '.cg-ask-hd .t{font-size:12.5px;font-weight:600;color:var(--text)}',
    '.cg-ask-hd .sp{flex:1;min-width:0}',
    '.cg-ask-b{display:flex;flex-direction:column;gap:8px}',
    '.cg-ask-row{display:flex;align-items:center;gap:9px}',
    '.cg-ask-row label{flex:none;width:38px;font-size:11.5px;color:var(--dim);text-align:right}',
    '.cg-ask-row input{flex:1;min-width:0;height:28px;padding:0 9px;border-radius:7px;',
    'border:1px solid var(--border);background:var(--panel2);color:var(--text);font-size:12px;',
    'font-family:inherit;outline:none}',
    '.cg-ask-row input:focus{border-color:var(--accent)}',
    /* ★ 分类 / 项目 的**下拉** ✓（原来是 `<datalist>` 输入框 ✗ —— 用户看不出能建新的 ✓）*/
    '.cg-ask-row select{flex:1;min-width:0;height:28px;padding:0 8px;border-radius:7px;',
    'border:1px solid var(--border);background:var(--panel2);color:var(--text);font-size:12px;',
    'font-family:inherit;outline:none;cursor:pointer}',
    '.cg-ask-row select:focus{border-color:var(--accent)}',
    '.cg-ask-row .cg-btn{height:28px;font-size:11px;flex:none}',
    '.cg-ask-path{font-size:10.5px;color:var(--dim);line-height:1.6;word-break:break-all}',
    '.cg-ask-path code{font-family:var(--mono);color:var(--text)}',
    '.cg-ask-hint{font-size:10.5px;color:var(--dim)}',
    /* 预览：让人**存之前就知道要存什么** ✗（不然点了才知道内容不对 ✓）*/
    '.cg-ask-md{margin-top:2px;max-height:150px;overflow:auto;padding:9px 10px;border-radius:8px;',
    'border:1px solid var(--border);background:var(--panel2);color:var(--dim);',
    'font-family:var(--mono);font-size:10.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
    '.cg-ask-ft{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:4px}',
    '.cg-ask-ft .tip{font-size:10.5px;color:var(--dim)}',
    /* ── ★★ 「找方案」的结果 ✓（思路 + 步骤 + 示例）────────────────────────── */
    '.cg-plan{border:1px solid color-mix(in srgb,var(--accent) 32%,transparent);border-radius:10px;',
    'background:color-mix(in srgb,var(--accent) 7%,transparent);padding:11px 12px;margin-bottom:11px}',
    '.cg-plan .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px}',
    '.cg-plan .hd .t{font-size:12.5px;font-weight:600;color:var(--text)}',
    '.cg-plan .hd .tag{font-size:10px;padding:1px 7px;border-radius:999px;color:#d29922;',
    'border:1px solid color-mix(in srgb,#d29922 50%,transparent);background:color-mix(in srgb,#d29922 12%,transparent)}',
    '.cg-plan .p{font-size:12.5px;line-height:1.85;color:var(--text)}',
    '.cg-plan .st{margin:8px 0 0;padding-left:19px;font-size:11.5px;line-height:1.85;color:var(--dim)}',
    '.cg-plan .foot{font-size:10.5px;line-height:1.7;color:var(--dim);margin-top:9px}',
    '.cg-plan .cg-man-code{margin-top:9px}',
    /* ── 结果卡片 ✓ ────────────────────────────────────────────────────── */
    '.cg-row{border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:9px;background:var(--panel2);',
    'transition:border-color .13s,box-shadow .13s}',
    '.cg-row:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));',
    'box-shadow:0 2px 10px rgba(0,0,0,.16)}',
    '.cg-row .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.cg-row .nm{font-family:var(--mono);font-size:13px;color:var(--text);font-weight:600;word-break:break-all}',
    '.cg-src{font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid;white-space:nowrap}',
    '.cg-src.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 55%,transparent);background:color-mix(in srgb,var(--ok) 12%,transparent)}',
    '.cg-src.ai{color:#d29922;border-color:color-mix(in srgb,#d29922 55%,transparent);background:color-mix(in srgb,#d29922 12%,transparent)}',
    '.cg-row .sub{font-size:11px;color:var(--dim);margin-top:4px}',
    '.cg-row .doc,.cg-row .use{font-family:var(--mono);font-size:11.5px;line-height:1.65;color:var(--text);',
    'white-space:pre-wrap;word-break:break-word;margin:8px 0 0;padding:8px 10px;background:var(--bg);border-radius:7px;max-height:150px;overflow:auto}',
    '.cg-row .use{color:var(--accent)}',
    '.cg-row .nj{font-size:10.5px;color:var(--dim);margin-top:7px;opacity:.9}',
    /* ── ★★★★ 「怎么用」手册 ✓ —— 用户要的「查文档手册」就是这个 ✓ ─────────
       ⚠️ 两段必须**视觉上分开** ✗✗：LSP 签名（权威 ✓）和 AI 用法（参考 ✓）。
         混在一起的话用户会把 AI 编的签名也当真 ✗。 */
    '.cg-man{margin-top:11px;border-top:1px dashed var(--border);padding-top:10px}',
    '.cg-man-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
    '.cg-man-hd .t{font-size:12px;font-weight:600;color:var(--text)}',
    '.cg-man-hd .tag{font-size:10px;padding:1px 7px;border-radius:999px;',
    'color:#d29922;border:1px solid color-mix(in srgb,#d29922 50%,transparent);',
    'background:color-mix(in srgb,#d29922 12%,transparent)}',
    '.cg-man-what{font-size:12px;line-height:1.75;color:var(--text);margin-bottom:9px}',
    '.cg-man-sig,.cg-man-inc{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:9px;',
    'padding:7px 9px;border-radius:7px;border:1px solid color-mix(in srgb,var(--ok) 40%,transparent);',
    'background:color-mix(in srgb,var(--ok) 8%,transparent)}',
    '.cg-man-inc{border-color:var(--border);background:var(--bg)}',
    '.cg-man-sig .k,.cg-man-inc .k{flex:none;font-size:10px;letter-spacing:.6px;color:var(--dim)}',
    '.cg-man-sig code,.cg-man-inc code{font-family:var(--mono);font-size:11.5px;color:var(--text);',
    'word-break:break-all;min-width:0;flex:1}',
    '.cg-man-sec{margin-bottom:10px}',
    '.cg-man-t{font-size:11.5px;font-weight:600;color:var(--text);margin-bottom:5px;display:flex;',
    'align-items:center;gap:8px;flex-wrap:wrap}',
    '.cg-man-t .d{font-size:10.5px;font-weight:400;color:var(--dim)}',
    '.cg-man-t .sp{flex:1;min-width:0}',
    '.cg-man-t .cg-btn{height:22px;font-size:10px;padding:0 8px;font-weight:400}',
    /* ⚠️ 代码块里**不放绝对定位的按钮** ✗（第一版就是那么写的 ✓ → 盖住第一行代码 ✗）——
       按钮挪到标题行右边 ✓（见 cgManualHtml ✓）。 */
    '.cg-man-code{border:1px solid var(--border);border-radius:7px;background:var(--bg);padding:8px 10px}',
    '.cg-man-code pre{font-family:var(--mono);font-size:11.5px;line-height:1.7;color:var(--text);',
    'white-space:pre-wrap;word-break:break-word;margin:0}',
    '.cg-man-api{width:100%;border-collapse:collapse;font-size:11px}',
    '.cg-man-api td{padding:4px 6px;border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent);',
    'vertical-align:top;line-height:1.6}',
    '.cg-man-api td.n{font-family:var(--mono);color:var(--accent);white-space:nowrap;width:1%}',
    '.cg-man-api td.s{font-family:var(--mono);color:var(--dim);font-size:10.5px}',
    '.cg-man-api td.d{color:var(--dim)}',
    '.cg-man-pit{margin:0;padding-left:18px;font-size:11px;line-height:1.8;color:var(--dim)}',
    '.cg-man-foot{font-size:10.5px;line-height:1.7;color:var(--dim);padding:7px 9px;border-radius:7px;',
    'border-left:2px solid var(--border);background:color-mix(in srgb,var(--panel2) 55%,transparent)}',
    /* ── ★★★★ 按钮：hover / 按下 / 禁用 / 忙 —— 四态必须分得清 ✗✗ ────────────
       用户原话：「这些按键设计的也不合理，按下思考，都没有加载提醒，
                  等等，高亮和按下都分不清等等」✓。
       ⚠️ 原来只有一条 hover 规则 ✓（还是只换边框和字色 ✓，很淡 ✗）→
          鼠标悬停和真的按下**长得一模一样** ✗，用户点完不知道点没点上 ✗。
       → 四态各有明确视觉 ✓：
          hover  淡背景 + 边框亮 ✓
          active 更深的背景 + **下沉 1px** ✓（「按下去」的触感 ✓）
          busy   主题色描边 + 转圈 + 文案换成「正在…」✓
          disabled 变灰 + not-allowed ✓（不可点的东西**必须看得出来** ✓）*/
    '.cg-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:8px;',
    'border:1px solid var(--border);background:var(--panel2);color:var(--dim);font:11.5px var(--ui);cursor:pointer;',
    'transition:background .13s,border-color .13s,color .13s,transform .06s}',
    '.cg-btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--accent) 60%,var(--border));color:var(--text);',
    'background:color-mix(in srgb,var(--accent) 11%,var(--panel2))}',
    '.cg-btn:active:not(:disabled){transform:translateY(1px);border-color:var(--accent);',
    'background:color-mix(in srgb,var(--accent) 24%,var(--panel2))}',
    '.cg-btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
    '.cg-btn:disabled{cursor:not-allowed;opacity:.45}',
    '.cg-btn.pri{border-color:color-mix(in srgb,var(--accent) 70%,transparent);color:var(--accent);',
    'background:color-mix(in srgb,var(--accent) 10%,transparent)}',
    '.cg-btn.pri:hover:not(:disabled){background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent)}',
    '.cg-btn.pri:active:not(:disabled){background:color-mix(in srgb,var(--accent) 34%,transparent)}',
    '.cg-btn.on{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 15%,transparent)}',
    '.cg-btn.busy,.cg-btn.busy:disabled{border-color:var(--accent);color:var(--accent);opacity:1;',
    'background:color-mix(in srgb,var(--accent) 14%,transparent);cursor:progress}',
    /* 转圈 ✓ —— 用 currentColor ✓，跟着按钮的字色走 ✓（主题切换不用管 ✓）*/
    '.cg-spin{flex:none;width:11px;height:11px;border-radius:50%;',
    'border:1.6px solid color-mix(in srgb,currentColor 28%,transparent);border-top-color:currentColor;',
    'animation:cg-spin .7s linear infinite}',
    '@keyframes cg-spin{to{transform:rotate(360deg)}}',
    /* 忙碌横幅 ✓ —— 「按下去了、正在想」要**全局可见** ✓，不能只体现在那个小按钮上 ✓ */
    '.cg-busy{display:flex;align-items:center;gap:9px;font-size:11.5px;color:var(--accent);padding:9px 12px;',
    'margin-bottom:10px;border-radius:9px;border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);',
    'background:color-mix(in srgb,var(--accent) 9%,transparent)}',
    '.cg-busy .t{flex:1;min-width:0;line-height:1.5}',
    '.cg-busy .t i{display:block;font-style:normal;color:var(--dim);font-size:10.5px;margin-top:2px}',
    '.cg-acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}',
    '.cg-row .acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}',
    '.cg-row .acts .cg-btn,.cg-acts .cg-btn{height:27px}',
    /* ── 视图切换（拆逻辑内部）✓ ─────────────────────────────────────────── */
    '.cg-views{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;padding:5px;border-radius:10px;',
    'background:color-mix(in srgb,var(--bg) 70%,transparent);border:1px solid var(--border)}',
    '.cg-views .cg-btn{height:26px;font-size:11px;border-color:transparent;background:transparent}',
    '.cg-views .cg-btn.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}',
    /* ── ★★ 思维导图 ✓（用户原话：「流程图，思维导图那种，不是代码」✓）──────────
       做法：节点是**绝对定位的 HTML** ✓（好排版、能选中文字 ✓），
       连线是**一层 SVG** ✓（贝塞尔 ✓）—— 和页面自己的 buildLogicFlow 同一套技术 ✓
       （纯 SVG 画文字要自己算换行 ✓，不值当 ✓）。 */
    '.cg-mind{position:relative;min-width:100%;padding:4px 0 8px}',
    '.cg-mind svg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}',
    '.cg-mind-node{position:absolute;border-radius:9px;border:1px solid var(--border);background:var(--panel2);',
    'padding:7px 10px;font-size:11.5px;line-height:1.55;color:var(--text);box-sizing:border-box;',
    'transition:border-color .13s,box-shadow .13s}',
    '.cg-mind-node:hover{border-color:var(--accent);box-shadow:0 2px 10px rgba(0,0,0,.2)}',
    '.cg-mind-root{border-color:var(--accent);font-weight:600;font-size:12.5px;',
    'background:color-mix(in srgb,var(--accent) 15%,var(--panel2))}',
    '.cg-mind-root .t2{display:block;font-weight:400;font-size:10.5px;color:var(--dim);margin-top:3px;line-height:1.5}',
    '.cg-mind-branch{font-weight:600}',
    '.cg-mind-branch .ic{margin-right:4px}',
    '.cg-mind-leaf{background:var(--bg);font-size:11px;color:var(--dim);padding:6px 9px}',
    '.cg-mind-leaf.chip{border-style:dashed}',
    '.cg-mind-leaf.chip .k{color:var(--ok);font-weight:600;margin-right:3px}',
    /* ── 实现流程（垂直步骤 + 箭头）✓ ────────────────────────────────────── */
    '.cg-flow{position:relative;padding:2px 0 4px}',
    '.cg-flow svg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}',
    '.cg-step{position:relative;border:1px solid var(--border);border-radius:9px;background:var(--panel2);',
    'padding:9px 11px;margin-bottom:0}',
    '.cg-arrow{display:flex;justify-content:center;align-items:center;height:18px;color:var(--dim);font-size:12px}',
    '.cg-step .n{position:absolute;left:-9px;top:-9px;width:20px;height:20px;border-radius:50%;',
    'display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:600;',
    'background:var(--accent);color:#fff}',
    '.cg-step .t{font-size:12.5px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px}',
    '.cg-step .d{font-size:11.5px;line-height:1.75;color:var(--dim);margin-top:4px}',
    '.cg-step .br{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}',
    '.cg-step .br span{font-size:10.5px;padding:2px 8px;border-radius:999px;border:1px dashed var(--ok);color:var(--ok)}',
    '.cg-step.k-branch{border-color:color-mix(in srgb,var(--ok) 45%,var(--border))}',
    '.cg-step.k-branch .n{background:var(--ok)}',
    '.cg-step.k-return .n,.cg-step.k-end .n{background:var(--err)}',
    '.cg-step.k-loop .n{background:#d29922}',
    '.cg-step.k-call .n{background:color-mix(in srgb,var(--accent) 70%,#000)}',
    '.cg-summary{font-size:12.5px;line-height:1.85;color:var(--text);padding:10px 12px;border-radius:9px;',
    'border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);',
    'background:color-mix(in srgb,var(--accent) 8%,transparent);margin-bottom:11px}',
    '.cg-summary .k{font-size:10px;letter-spacing:1.4px;color:var(--accent);display:block;margin-bottom:4px}',
    /* ── 代码级控制流图（保留原渲染器）✓ ──────────────────────────────────── */
    '.cg-graph{border:1px solid var(--border);border-radius:9px;padding:9px;background:var(--bg);',
    'max-height:46vh;overflow:auto;margin-bottom:10px}',
    '.cg-gbar{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dim);margin-bottom:7px}',
    '.cg-gbar .t{font-family:var(--mono);color:var(--text)}',
    '.cg-gbar .badge{font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid var(--border);color:var(--dim)}',
    '.cg-code{font-family:var(--mono);font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;',
    'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:11px;max-height:290px;overflow:auto;margin:0 0 9px}',
    '.cg-explain{font-size:12px;line-height:1.9;color:var(--text);border-left:2px solid var(--accent);',
    'padding:9px 12px;background:color-mix(in srgb,var(--panel2) 55%,transparent);border-radius:0 8px 8px 0}',
    /* ── 底栏 ✓ ────────────────────────────────────────────────────────── */
    '.cg-foot{display:flex;align-items:center;gap:8px;padding:9px 13px;border-top:1px solid var(--border);',
    'font-size:10.5px;color:var(--dim);flex:none}',
    '.cg-foot .sp{flex:1}',
    '.cg-foot .src-legend{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
    '.cg-foot .src-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:8px}',
    '.cg-foot .src-legend i.ok{background:var(--ok)}',
    '.cg-foot .src-legend i.ai{background:#d29922}',
    '.cg-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(12px);z-index:9999;',
    'background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:9px;',
    'padding:10px 16px;font:12px var(--ui);opacity:0;pointer-events:none;transition:.18s;',
    'box-shadow:0 10px 30px rgba(0,0,0,.35)}',
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
    /* ⚠️ 窗口宽度变了 → 思维导图要**重新分列** ✗（它的列宽是按容器宽度算的 ✓，
       见 cgMindCols ✓）。不重算的话：拖宽了图还是窄的 ✓、拖窄了右边被裁 ✗。
       ⚠️ 用 rAF 而不是同步重画 ✗ —— cgPlace 可能在一帧里被调好几次（resize 事件很密 ✓），
          同步重画等于每帧量一次 DOM ✓（白烧 CPU ✓）。 */
    if (CG.open && !CG.min) {
      if (CG._drawT) cancelAnimationFrame(CG._drawT);
      CG._drawT = requestAnimationFrame(() => { try { cgDrawAll(); } catch (_) {} });
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
        /* 拖完大小 → 思维导图重新分列 ✓（拖的过程中不重画 ✓，不然每帧量一次 DOM ✓）*/
        try { cgDrawAll(); } catch (_) {}
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
    /* ⚠️⚠️ 展开之后要**重画一遍图** ✗✗ —— 折起来的时候 `.cg-body` 是 `display:none` ✓，
       里面所有元素的 `offsetHeight` 都是 **0** ✓ →
       思维导图 / 实现流程全是靠量高度摆位置的 ✓ → 会摆成一堆重叠的方块 ✗
       （实测：折一下再展开，导图就塌了 ✓）。
       ⚠️ 而且这属于「探针天然测不到」那一类 ✗（它只在人手动折叠时才出现 ✓）。 */
    if (!CG.min) requestAnimationFrame(() => { try { cgDrawAll(); } catch (_) {} });
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
      /* ★ 「🕘 查阅历史」✓ —— 用户原话：「再给我新增查阅历史记录，方便我回看」✓。
         ⚠️ 摆在标题栏 ✗（**随时点得到** ✓）—— 塞进某个页签里的话，
            想回看还得先切到那个页签 ✓（而且「历史」本来就不属于任何一个页签 ✓）。 */
      + '<span class="hb" id="cgx-hist" title="查阅历史（回看 / 重查以前查过的）">🕘</span>'
      /* 折叠成一条药丸 ✓（用户原话：「也可以拖动放到一边」✓）——
         ⚠️ 折叠状态**也要落盘** ✗，不然每次打开都弹开 ✓，挡着代码 ✓。 */
      + '<span class="hb" id="cgx-min" title="折起来 / 展开（折起来只剩这一条，可以拖到边上）">—</span>'
      + '<span class="hb x" id="cgx-close" title="关闭（Esc）">✕</span></div>'
      + '<div class="cg-tabs" id="cgx-tabs">'
      + TABS.map((t) => '<span class="cg-tab' + (t.k === CG.tab ? ' on' : '') + '" data-cgtab="' + t.k + '"'
        + ' title="' + esc(t.tip) + '"><span class="e">' + t.e + '</span><span>' + esc(t.n) + '</span></span>').join('')
      + '</div>'
      + '<div class="cg-search"><input id="cgx-q" placeholder="" autocomplete="off" spellcheck="false"/>'
      + '<button class="cg-btn pri" id="cgx-go">查</button></div>'
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
    /* ★ 「🕘 查阅历史」✓ —— 用户原话：「再给我新增查阅历史记录，方便我回看」✓ */
    $('#cgx-hist', el).onclick = () => { CG.histOn = !CG.histOn; cgRender(); };
    cgDrag(el);
    cgResize(el);
    Array.from(el.querySelectorAll('[data-cgtab]')).forEach((t) => {
      t.onclick = () => {
        const next = t.dataset.cgtab;
        /* ⚠️ 同一个页签点了不重来 ✗（点两下不该把结果清掉 ✓）*/
        if (next === CG.tab) return;
        /* ★★ 先存当前、再取目标 ✗✗ —— 用户原话：
           「AI 思考后切换按钮后，东西就丢失了，后面又得重新思考，太慢了」✓。
           ⚠️ 原来这里是一把全清 ✓ → 切走再切回来就全没了 ✗。 */
        cgStash();
        CG.tab = next;
        cgRestore(next);
        CG.busyAct = ''; CG.busyTxt = ''; CG.busy = false;
        CG.histOn = false;      /* ★ 切页签 → 历史面板收起 ✓（不然挡住内容 ✓）*/
        const q = $('#cgx-q');
        cgRender();
        /* ★ 目标页签**已经有结果** → 直接看 ✓，**绝不重跑 AI** ✗ */
        if (cgTabHasResult(next)) {
          if (q && next !== 'break') q.focus();
          return;
        }
        /* ⚠️ 同上：拆逻辑自动拆的**函数名记** ✓、查手册自动带的光标词**不记** ✗ */
        if (next === 'break') cgRunBreak();
        else if (next === 'look') {
          const seed = cgSeed();
          if (seed) { CG.q = seed; if (q) q.value = seed; cgRun({ record: false }); }
          else if (q) q.focus();
        } else if (q) q.focus();
      };
    });
    const inp = $('#cgx-q', el);
    /* ⚠️ 输入框**不能每敲一个字就整块重绘** ✗ —— 会失焦 ✓（这个项目里踩过好几次 ✓）。
       只存值 ✓，回车 / 点「查」才跑 ✓。 */
    inp.oninput = () => { CG.q = inp.value; };
    inp.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); cgRun(); }
    };
    $('#cgx-go', el).onclick = () => cgRun();
    /* ★★ 结果区用**事件委托** ✓ —— 内容每次重绘 ✓（innerHTML 整个换掉 ✓），
       绑在元素上的监听会跟着消失 ✗ → 只能挂在**不重绘的父级**上 ✓。
       ⚠️ 一个监听搞定全部动作 ✗（原来是两个 ✓，加动作就得加一个 ✓，迟早漏 ✓）。 */
    $('#cgx-body', el).addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-cgact]') : null;
      if (!btn || btn.disabled) return;
      const act = btn.dataset.cgact;
      const row = btn.closest('[data-cgrow]');
      const name = row ? row.dataset.cgrow : '';
      const r = CG.rows.find((x) => x.name === name) || {};
      if (act === 'use') { cgInsert(btn.dataset.cgtext || r.use || r.insert || ''); return; }
      if (act === 'copy') { cgCopy(name); return; }
      if (act === 'copysk') { cgCopy((CG.graph && CG.graph.skel) || ''); return; }
      if (act === 'copysk2') { cgCopy(btn.dataset.cgtext || ''); return; }
      if (act === 'goto') { cgGoto(r); return; }
      if (act === 'pick') { cgPick(r); return; }
      if (act === 'manual') { cgManual(r); return; }
      if (act === 'concept') { cgAskConcept(btn.dataset.cgval || CG.manual && CG.manual.name || ''); return; }
      if (act === 'hist') { CG.histOn = !CG.histOn; cgRender(); return; }
      if (act === 'histclear') { cgHistClear(); cgRender(); return; }
      if (act === 'histgo') { cgHistGo(btn.dataset.cgval); return; }
      /* ★ 存到知识库 ✓ —— 用户原话：「做一个注入到知识库的按钮」✓ */
      if (act === 'asksave') {
        const row = (CG.hist || [])[Number(btn.dataset.cgval)];
        if (row) {
          const snap = row.res || null;
          if (!snap) { toast('这条没存下结果 —— 先点它一次，再把结果存进知识库 ✓'); return; }
          cgAskOpen(row.tab, row.q || row.name, snap);
        }
        return;
      }
      if (act === 'asksavecur') { cgAskOpen(CG.tab, CG.q || (CG.root && CG.root.name) || '', cgHistSnapshot(CG.tab)); return; }
      if (act === 'ask') { CG.ask = null; cgRender(); return; }
      /* ★ 分类 / 项目 下拉 ✓ —— 选「＋ 新建…」就把那一格换成输入框 ✓。
         ⚠️ 这几个也要**推到下一个任务**再重绘 ✗ —— 它们都是**点在自己身上**的 ✓，
            重绘会把正在派发点击的那个按钮摘掉 ✗（和 `<select>` 的 change 同一类问题 ✓）。 */
      if (act === 'askbackcat') {
        if (CG.ask) { CG.ask.newCat = false; CG.ask.cat = (CG.ask.cats || [])[0] || ''; }
        setTimeout(cgRender, 0);
        return;
      }
      if (act === 'askbackproj') {
        if (CG.ask) { CG.ask.newProj = false; CG.ask.proj = (((CG.ask.byCat || {})[CG.ask.cat] || [])[0]) || ''; }
        setTimeout(cgRender, 0);
        return;
      }
      if (act === 'askrun') {
        /* ⚠️ 先把输入框 / 下拉里的值收进来 ✗ —— 它们是 DOM ✓，
           `cgAskRun` 读的是状态 ✓。`__new__` 是「＋ 新建…」这个占位选项 ✓，不是真名字 ✗。 */
        const t = $('#cg-ask-title'), c = $('#cg-ask-cat'), p = $('#cg-ask-proj');
        if (t && CG.ask) CG.ask.title = t.value;
        if (c && CG.ask && c.value !== '__new__') CG.ask.cat = c.value;
        if (p && CG.ask && p.value !== '__new__') CG.ask.proj = p.value;
        cgAskRun();
        return;
      }
      if (act === 'demo') {
        /* 空态里那些「可点的例子」✓ —— 点了就真的去查 ✓（不是摆设 ✓）*/
        const v = btn.dataset.cgval || '';
        const q = $('#cgx-q');
        CG.q = v; if (q) q.value = v;
        cgRun();
        return;
      }
      if (act === 'view') { CG.view = btn.dataset.cgval || 'mind'; cgRender(); return; }
      if (act === 'flow') { cgRunBreak(); return; }
      if (act === 'skel') { cgSkeleton(); return; }
      if (act === 'explain') { cgExplain(); }
    });
    CG_EL = el;
    return el;
  }
  /* 「拆这个」✓ —— 从挑函数的那一列点进来 ✓ */
  function cgPick(r) {
    if (!r || !r.name) return;
    const ctx = cgCtx();
    /* ★ 记住「这次拆的是谁」✓ —— 不然再点「重新拆解」会弹回列表 ✗（见 cgRunBreak 那段注释 ✓）*/
    CG.root = { name: r.name, line: r.line, frag: r.frag, file: ctx && ctx.file };
    cgHistPush('break', r.name, { line: r.line, file: ctx && ctx.file });
    cgBegin('flow', '正在拆解「' + r.name + '」…');
    const root = CG.root;
    CG.rows = [];
    Promise.resolve()
      .then(() => cgLoadGraph(root))
      .then(() => cgAiFlow(root))
      .then(() => { if (!CG.err) cgHistSetResult(); cgEnd(); })
      .catch((e) => { CG.err = String((e && e.message) || e); cgEnd(); });
  }
  async function cgRun(opts) {
    CG.err = ''; CG.note = ''; CG.rows = []; CG.graph = null; CG.aiFlow = null; CG.manual = null;
    /* ★ 记进历史 ✓ —— 但**打开时自动带上下文的查**不记 ✗（`record:false` ✓），
       不然开十次面板就刷出十条一样的 ✓。 */
    if (!opts || opts.record !== false) cgHistPush(CG.tab, CG.q);
    /* ★ 真去查了 → 历史面板**自动收起** ✓（不然结果被它挡着 ✓）*/
    CG.histOn = false;
    cgBegin('run', CG.tab === 'find' ? '先搜本地，再让 AI 按你的上下文想方案…' : '正在查…');
    try {
      if (CG.tab === 'look') await cgRunLook();
      else if (CG.tab === 'find') await cgRunFind();
      else { await cgRunBreak(); return; }   /* 拆逻辑自己管 busy ✓（它要跑两趟 ✓）*/
    } catch (e) {
      CG.err = String((e && e.message) || e);
    }
    /* ★ 把这次的结果**记进那条历史** ✓（下次点它就能秒开 ✓，不再问 AI ✓）*/
    if (!CG.err) cgHistSetResult();
    cgEnd();
  }
  function cgOpen(tab) {
    if (tab) CG.tab = tab;
    CG.err = ''; CG.note = ''; CG.rows = []; CG.graph = null; CG.ai = null; CG.aiFlow = null; CG.manual = null;
    CG.saved = {};    /* ★ 新开一次会话 → 三个页签的缓存全丢掉 ✓（上一轮的别串过来 ✓）*/
    CG.histOn = false; /* ★ 历史面板也收起 ✓（每次打开都是「你要查什么」✓）*/
    CG.busyAct = ''; CG.busyTxt = ''; CG.busy = false;
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
       ★★「查手册」也是**打开就跑** ✗✗ —— 用户原话：
         「我写代码的时候，有时会不记得一些变量怎么写…就类似，
           以前程序员经常需要查**文档手册**一样去写代码」✓。
         ⚠️⚠️ 原来这里是「把光标底下的词**预填**进输入框」✓，但**不自动查** ✓ →
            用户打开看到的还是「输入一个符号名」+ 空白 ✗
            （实测截图：光标明明停在 `std::unordered` 上 ✓，面板一片空白 ✓）。
            他得**手打一遍**才知道怎么用 ✗ —— 而他本来就记不清 ✗（鸡生蛋 ✓）。
         → 用 cgSeed() 取「此刻最可能想查的东西」✓，直接查 ✓。 */
    /* ★★ 历史记不记，按「**这条有没有回看价值**」分 ✗✗：
       · 「拆逻辑」自动拆的那个**函数名** → **记** ✓（「我拆过 led_read」是有价值的 ✓）
       · 「查手册」自动带的光标词 → **不记** ✗ ——
         它十有八九是 `int` / `return` / `;` 这种噪音 ✓
         （实测截图里就出现过一条 `int` ✓），记进去只会把真查过的挤下去 ✗。
       ⚠️ 但用户**手动打进去的**（点「查」/ 回车 ✓）一律记 ✓ —— 那才是「我查过的」✓。 */
    if (CG.tab === 'break') cgRunBreak();
    else {
      const i = $('#cgx-q');
      if (i) { i.disabled = false; i.value = ''; i.focus(); }
      if (CG.tab === 'look') {
        const seed = cgSeed();
        /* ⚠️ `record:false` ✗✗ —— 这是**工具自己查的** ✓，不是「用户查过的」✗。
           记进去的话，开十次面板就刷出十条一样的 ✓（而且用户根本没查过 ✗）。 */
        if (seed) { CG.q = seed; if (i) i.value = seed; cgRun({ record: false }); }
        else if (i) { i.value = ''; CG.q = ''; }
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
    /* ★ 查阅历史在**挂载时读一次** ✓（之后都走内存 + 随手落盘 ✓）*/
    cgHistLoad();
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
