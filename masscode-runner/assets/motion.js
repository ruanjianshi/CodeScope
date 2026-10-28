'use strict';
/* ============================================================================
   motion.js —— 「只读旁挂」的交互动效层（2026-10-28）
   ----------------------------------------------------------------------------
   为什么要有这个文件 ✓：
     app.css 里 77 条 transition 的时长只有 .12s/.13s/.14s/.15s/.16s/.18s 六种，
     几乎相同却各写一遍；曲线 ease×59、linear×6、自定义 cubic-bezier 只有 4 处 ——
     "所有动作都是 120~180ms 的默认缓动"，没有节奏也没有性格 ✗。
     但有三种效果 **CSS 做不到**：① 面板由隐藏变可见这件事只有 JS 知道（同一块面板
     可能被 style.display / class / hidden 属性三套写法里的任意一套切换）；
     ② 一条从旧标签滑到新标签的共享指示条；③ 「首次出现」与「每 3 秒轮询重建」的区别。
     ⇒ 所以时长/曲线/令牌仍然归 CSS（见下方 FALLBACK_CSS 与 motion.css 的分工），
        JS 只负责 **何时** 该动 ✓。

   ⚠️⚠️ 硬约束（改这个文件之前先读）✗：
     · **不改 app.js**（架构棘轮顶到上限，一行都加不进去 ✓）——
       全部靠 MutationObserver / 事件委托**只读**观察现有 DOM ✗，绝不改既有逻辑。
     · **渐进增强**：本文件任何一步抛错都必须被吞掉 ✓；JS 失效时页面必须和
       "根本没有这个脚本" 完全一样 ✓（每个 observe / 每次回调各自 try-catch ✓）。
     · **不碰任何 app.js 的全局变量** —— 只认 DOM ✓。
     · 一律避免「每次渲染都会发生」的动画 ✗：这个应用每 3 秒轮询一次并整块重建列表，
       每 3 秒弹一下会让人疯 ✓（第 3 节就是专门治这个的）。

   产品判断（唯一一条，别放宽）✓：
     **只有「人主动做的动作」才允许带回弹（overshoot）**；状态同步 / 自动刷新 /
     轮询导致的视觉变化一律用平滑曲线 ✓。理由同上：整块重建是常态，回弹是奖励。
   ============================================================================ */

(function () {
  var VERSION = '1.0.0';

  /* ── 要观察的面板 ────────────────────────────────────────────────────────
     为什么是**固定清单**而不是 observe(document.body, {subtree:true}) ✗：
     整棵树的 attribute 变化每秒几十次（光标行号、脏标记、编辑器内部），
     observer 回调会把主线程吃掉 ✓。这里只盯"会整块显隐"的十几个容器 ✓。
     ⚠️ #list 不在这里：它的显隐由祖先 #pane-tree 决定，加进来会和 #pane-tree
        同时触发一层嵌套淡入（视觉上重影）✗ —— 它归第 3 节的 stagger 负责 ✓。 */
  var PANEL_IDS = [
    'pane-tree', 'pane-git', 'pane-tags', 'pane-draw', 'pane-office', 'pane-reading',
    'output', 'outline-panel', 'code-wrap', 'tagbar', 'attached-pane', 'tabs-row'
  ];

  /* ── 要做 stagger 的"列表容器" ────────────────────────────────────────────
     只挑**行式列表**：给按钮/工具条做 stagger 纯属添乱 ✗。 */
  var LIST_IDS = ['list', 'outline-list', 'reading-list', 'office-list', 'draw-list', 'git-list'];

  var STAGGER_MAX = 12;      /* 同一批最多延迟前 12 项 ✓ —— 长列表后面的 immediate
                                （第 13 项等 delay 300ms 会显得应用卡住了 ✗） */
  var STAGGER_STEP = 22;     /* 相邻两项的间隔。12 项 × 22ms = 264ms 正好一屏内走完 ✓ */

  /* ⚠️ 兜底样式只在**没有 motion.css** 时注入 ✓（见 injectFallbackStyle）。
     分工：motion.css（若有）拥有视觉；本文件只保证"类加上了就看得见"。 */
  var FALLBACK_CSS = [
    ':root{--mo-1:120ms;--mo-2:180ms;--mo-3:240ms;',
    '--mo-ease:cubic-bezier(.22,.61,.36,1);--mo-back:cubic-bezier(.34,1.56,.64,1);}',
    /* 面板入场：淡入 + 上移 4px。曲线用 --mo-ease（平滑）而**不是** --mo-back ✓：
       面板是"状态变化"，不是人点的按钮，回弹会显得廉价 ✗。 */
    '@keyframes mo-enter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
    /* #code-wrap 里有 Monaco 和几层 absolute 定位（行高亮 / 折叠装订线 / 缩进参考线）——
       transform 会新建包含块，虽然不改布局，但没必要冒险 ✗ → 这一块只做淡入 ✓。 */
    '@keyframes mo-enter-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes mo-stagger-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
    '@keyframes mo-status-glow{0%{box-shadow:0 0 0 0 transparent}',
    '28%{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 32%,transparent)}',
    '100%{box-shadow:0 0 0 0 transparent}}',
    '.mo-enter{animation:mo-enter var(--mo-3) var(--mo-ease) both}',
    '#code-wrap.mo-enter{animation-name:mo-enter-fade}',
    '.mo-stagger{animation:mo-stagger-in var(--mo-3) var(--mo-ease) both}',
    '.mo-flash{animation:mo-status-glow 640ms var(--mo-ease)}',
    /* 指示条滑动期间隐藏标签自己的静态下划线（app.css 2906/3417 的 ::after 与
       3509 的 inset box-shadow）—— 不藏就会"新标签立刻亮一条 + 旧标签滑走"，
       同一时刻两条线，比硬跳更难看 ✗。静止时故意**不藏**：滑动条正好盖在上面，
       零成本保持一致（万一它对不齐，露出的是原来那条线，不是空白 ✓）。 */
    '#tabs[data-mo-sliding] .tab.active::after{opacity:0}',
    '#tabs[data-mo-sliding] .tab.active{box-shadow:none}',
    /* motion.css 缺失时也要尊重 reduced-motion ✓（app.css 3817 的全局兜底只管
       transition-duration，管不到 animation ✗） */
    '@media (prefers-reduced-motion:reduce){.mo-enter,.mo-stagger,.mo-flash{animation:none}}'
  ].join('');

  /* ════════════════════════════════════════════════════════════════════════
     小工具
     ════════════════════════════════════════════════════════════════════════ */
  function byId(id) {
    try { return document.getElementById(id); } catch (_) { return null; }
  }

  /* 读 CSS 变量里的时长（ms）。读不到就给兜底值 ——
     ⚠️ 不能把 'var(--mo-3)' 直接塞进 inline style：motion.css 若把令牌改名，
        整条 transition 就变成非法值 → 静默失效 ✗。所以这里**解出具体数字** ✓。 */
  function cssMs(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (!v) return fallback;
      if (/^[\d.]+ms$/.test(v)) return parseFloat(v);
      if (/^[\d.]+s$/.test(v)) return parseFloat(v) * 1000;
      return fallback;
    } catch (_) { return fallback; }
  }

  function cssValue(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_) { return fallback; }
  }

  /* ★ 判定"真的可见" —— 三套写法（style.display / class 里的 .hidden / hidden 属性）
     全部落到同一个结果上 ✓，所以**绝不看 class 名** ✗。
     getClientRects() 比 offsetParent 更准：它连 position:fixed 的祖先、
     display:contents、零尺寸都算得对（offsetParent 对 fixed 元素返回 null ✗）。 */
  function isShown(el) {
    try {
      if (!el || !el.isConnected) return false;
      if (el.getClientRects().length === 0) return false;      /* display:none / hidden / 未布局 */
      var r = el.getBoundingClientRect();
      return r.width > 0.5 && r.height > 0.5;
    } catch (_) { return false; }
  }

  function on(node, type, fn, opts) {
    try { node.addEventListener(type, fn, opts); } catch (_) {}
  }

  /* ════════════════════════════════════════════════════════════════════════
     ① 面板入场（其它动效的"底座"：先让切换被看见，再谈细节）
     ════════════════════════════════════════════════════════════════════════ */
  var enterTimers = new WeakMap();   /* el → 移除 mo-enter 的 timer（WeakMap：容器不会被这里钉住 ✓） */

  function markEnter(el, moMs) {
    if (!el || !isShown(el)) return;
    if (el.classList.contains('mo-enter')) return;    /* 还在动：别重启动画（会闪）✗ */
    var old = enterTimers.get(el);
    if (old) { try { clearTimeout(old); } catch (_) {} }
    el.classList.add('mo-enter');
    enterTimers.set(el, setTimeout(function () {
      try { el.classList.remove('mo-enter'); } catch (_) {}
      enterTimers.delete(el);
    }, moMs + 80));                                    /* +80ms 余量：动画结束再摘，别提前切掉最后一帧 */
  }

  function initPanels() {
    var moMs = cssMs('--mo-3', 240);
    var els = PANEL_IDS.map(byId).filter(Boolean);
    if (!els.length) return;

    /* 基线 = 当前可见性。页面加载不该有一堆淡入 ✓（那是"渲染"，不是"人的动作"）。 */
    var seen = new WeakMap();
    els.forEach(function (el) { seen.set(el, isShown(el)); });

    var mo = new MutationObserver(function (records) {
      try {
        var touched = [];
        for (var i = 0; i < records.length; i++) {
          var el = records[i].target;
          if (!el || !seen.has(el)) continue;
          if (touched.indexOf(el) < 0) touched.push(el);
        }
        /* 读几何放在循环外一次做完：一次观察回调里多次读到的是同一份 layout ✓ */
        for (var j = 0; j < touched.length; j++) {
          var e = touched[j];
          var now = isShown(e);
          if (now && !seen.get(e)) {       /* ★ 只在 不可见 → 可见 的那一次 ✓ */
            markEnter(e, moMs);
            staggerListsInside(e);         /* 列表跟着面板一起出来时也要 stagger ✓ */
          }
          seen.set(e, now);
        }
      } catch (_) { /* 全部吞掉：动效层出错不许影响主流程 ✓ */ }
    });

    els.forEach(function (el) {
      try {
        /* subtree:false —— 只盯容器自己；subtree:true 会把面板里每次内容变化都喂进来 ✗ */
        mo.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'], subtree: false });
      } catch (_) {}
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     ② 标签页共享指示条
     ════════════════════════════════════════════════════════════════════════ */
  function initTabs() {
    var tabs = byId('tabs');
    if (!tabs) return;

    /* 定位上下文：实测 #tabs 的 computed position 是 static（app.css 从头到尾没给它
       position）✓ —— 做法是在原容器上补 position:relative（**不包一层包裹层**）：
       包裹层会改 flex 结构、且 #tabs 自己就是横滚容器（scrollWidth 由子节点算），
       多一层必然影响"全部"按钮的溢出判断 ✗（app.js:9182 依赖 tabs.scrollWidth）✓。 */
    try {
      if (getComputedStyle(tabs).position === 'static') tabs.style.position = 'relative';
    } catch (_) {}

    var ind = null;
    var lastKey = '';
    var hasPos = false;        /* 曾经定过位（= 有一个"上一个位置"可以当起点） */
    var fresh = false;         /* 当前这条是刚重建的（app.js 每次 renderMain 都会把它清掉） */
    var lastX = 0;
    var lastW = 0;
    var frame = 0;
    var slideTimer = 0;

    var moMs = cssMs('--mo-3', 240);
    var backCurve = cssValue('--mo-back', 'cubic-bezier(.34,1.56,.64,1)');

    function ensureIndicator() {
      if (ind && ind.isConnected && ind.parentNode === tabs) return ind;
      /* ⚠️ app.js:9106 每次 renderMain 都 tabs.innerHTML='' → 指示条被一起清掉 ✓，
         所以这里"按需重建"，不是一次性的 ✓。 */
      ind = document.createElement('div');
      ind.setAttribute('data-mo-indicator', '');       /* 验收用：[data-mo-indicator] */
      ind.setAttribute('aria-hidden', 'true');
      var s = ind.style;
      s.position = 'absolute';
      s.left = '0';
      s.bottom = '0';
      s.width = '1px';                                  /* 基准宽 1px → 宽度全靠 scaleX ✓ */
      s.height = '2px';
      s.borderRadius = '2px 2px 0 0';
      s.background = 'var(--accent)';
      s.transformOrigin = '0 50%';
      s.pointerEvents = 'none';                         /* ★ 绝不能挡住命中测试 ✓ */
      s.opacity = '0';
      s.willChange = 'transform, opacity';
      s.zIndex = '2';                                   /* 盖过 .tab 自己的 ::after（z-index:auto） */
      /* ★ 起点必须写成**上一次的位置**，不能用元素默认的 translateX(0) scaleX(1) ✗：
         app.js:9106 每次 renderMain 都 tabs.innerHTML='' → 指示条跟着被删 ✓，
         新插入的条若从默认位置滑，看起来是"从左边缘长出来"而不是"从旧标签滑过来" ✗。
         所以：先落旧位置 → 插入 → 下一帧再过渡到新位置 ✓。 */
      s.transform = 'translateX(' + lastX + 'px) scaleX(' + lastW + ')';
      s.opacity = hasPos && lastW > 0 ? '1' : '0';
      s.transition = 'none';
      try { tabs.insertBefore(ind, tabs.firstChild); } catch (_) { return null; }
      fresh = true;
      return ind;
    }

    function update() {
      frame = 0;
      try {
        var el = ensureIndicator();
        if (!el) return;
        var active = tabs.querySelector('.tab.active');
        var x = 0, w = 0, key;
        if (active) {
          /* 用 getBoundingClientRect 而不是 offsetLeft ✓：offsetLeft 依赖 offsetParent 是谁
             （#tabs 一旦被别处改成 static 就会跳到 body），rect 相减是唯一不猜的选择 ✓。
             + scrollLeft 把视口坐标换算回**内容坐标** —— 指示条在横滚容器里，随内容一起滚 ✓。 */
          var tr = tabs.getBoundingClientRect();
          var ar = active.getBoundingClientRect();
          x = (ar.left - tr.left) + tabs.scrollLeft + 9;   /* 9px = app.css:3417 的 left/right 内缩 */
          w = Math.max(0, ar.width - 18);
          key = Math.round(x) + ':' + Math.round(w);
        } else {
          key = 'none';                                     /* 没有选中标签 → 收成 0 宽 ✓ */
        }
        var wasFresh = fresh;
        fresh = false;
        if (key === lastKey && !wasFresh) return;           /* 位置没变就不写样式（省一次重排）✓ */
        lastKey = key;

        /* ★ 先让浏览器结算"旧位置"，再改目标值 ✗✗：
           同一帧里连续写 transform，浏览器只会看到最后一次 → 过渡不会发生 ✓。 */
        el.style.transition = 'none';
        if (wasFresh) {
          el.style.transform = 'translateX(' + lastX + 'px) scaleX(' + lastW + ')';
          el.style.opacity = hasPos && lastW > 0 ? '1' : '0';
        }
        void el.offsetWidth;                                /* 强制结算 ✓ */

        var animate = hasPos;                               /* 第一次出现直接落位，不从 0 滑 ✓ */
        el.style.transition = animate
          ? 'transform ' + moMs + 'ms ' + backCurve + ', opacity ' + moMs + 'ms ease'
          : 'none';
        el.style.transform = 'translateX(' + Math.round(x) + 'px) scaleX(' + Math.round(w) + ')';
        el.style.opacity = w > 0 ? '1' : '0';
        lastX = x; lastW = w; hasPos = true;

        armSlide();
      } catch (_) {}
    }

    /* 滑动窗口内藏掉静态下划线（见 FALLBACK_CSS）✓。用属性而不是 class：
       #tabs 上已经有 .more-left/.more-right/.tabs-compact 三个状态类，
       再加一个极容易在排查时被误读 ✗。 */
    function armSlide() {
      try {
        tabs.setAttribute('data-mo-sliding', '');
        if (slideTimer) clearTimeout(slideTimer);
        slideTimer = setTimeout(function () {
          slideTimer = 0;
          try { tabs.removeAttribute('data-mo-sliding'); } catch (_) {}
        }, moMs + 80);
      } catch (_) {}
    }

    /* ★ 重建后**同步**占位，而不是等下一帧 ✗✗：
       app.js 每次 renderMain 都 tabs.innerHTML='' → 指示条跟着被删 ✓；
       若等 rAF 再插，中间那一帧只剩标签自己的静态 ::after →
       用户看到的是"下划线先亮在新标签 → 消失 → 再从旧标签滑过来"，比硬跳更像 bug ✗。
       MutationObserver 回调是**微任务**，在这一次绘制之前就跑 ✓，
       所以在这里同步把条摆回旧位置：绘画时它已经在旧标签上，接着才滑走 ✓。 */
    function seed() {
      try {
        var had = !!(ind && ind.isConnected && ind.parentNode === tabs);
        var el = ensureIndicator();
        if (!el) return;
        if (!had && hasPos) armSlide();   /* 只在"刚被重建"时藏静态线，别每次 mutation 都藏 ✗ */
      } catch (_) {}
    }

    function schedule() {
      if (frame) return;
      try { frame = requestAnimationFrame(update); } catch (_) { frame = 0; }
    }

    /* ① 标签被整块重建（切片段 / 切分片 / 重排）→ childList ✓
       ② .active 就地切换（并排编辑提升等）→ subtree 上的 class ✓
       ⚠️ subtree:true 在这里是安全的：#tabs 里只有标签按钮 + 两个 span，节点数是个位 ✓ */
    try {
      new MutationObserver(function () {
        try { seed(); } catch (_) {}
        schedule();
      }).observe(tabs, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class']
      });
    } catch (_) {}

    /* ③ 窗口缩放 / 语言 chip 变宽变窄 → 尺寸变化（不看 window：改宽度不一定过 window） */
    try {
      if (typeof ResizeObserver === 'function') {
        var ro = new ResizeObserver(schedule);
        ro.observe(tabs);
      }
    } catch (_) {}

    /* ④ 点击兜底：app.js 的 onclick 在**冒泡阶段**执行完毕并同步重建完 DOM，
          所以这里冒泡晚于它 ✓（capture 会抢在它前面，读到的是旧 DOM ✗） */
    on(tabs, 'click', schedule, false);

    schedule();
  }

  /* ════════════════════════════════════════════════════════════════════════
     ③ 列表 stagger —— 只在一个时机触发
     ⚠️⚠️ 最大的坑：renderListNow 每次都是 innerHTML='' 再逐项 append。
        如果按"子项数变了就动"来写，那就是**每 3 秒轮询都弹一次** ✗✗。
        区别在于：重建是  N → 0 → N（同一批 mutation），首次出现是 0 → N。
        但 MutationObserver 会把"清空"和"追加"分成两条记录，若逐条比较就会看成 0→N ✗。
        ⇒ 解法：把整批 mutation 拿到 requestAnimationFrame 里**一次结算**，
          拿"这一批开始之前的稳定数量"跟"这一批结束后的数量"比 ✓。
          重建：start=N（稳定）→ now=N → 不动 ✓
          首次：start=0 → now=N → 动 ✓
     ════════════════════════════════════════════════════════════════════════ */
  var settled = new WeakMap();     /* el → 上一批结算后的子项数 */
  var batchStart = new WeakMap();  /* el → 这一批 mutation 开始前的子项数 */
  var lastStagger = new WeakMap(); /* el → 上次 stagger 的时间戳（兜底节流，见下） */
  var pending = [];
  var batchFrame = 0;
  var staggerNodes = [];
  var staggerTimer = 0;

  function clearStagger() {
    try {
      for (var i = 0; i < staggerNodes.length; i++) {
        staggerNodes[i].classList.remove('mo-stagger');
        staggerNodes[i].style.animationDelay = '';
      }
    } catch (_) {}
    staggerNodes = [];
    if (staggerTimer) { try { clearTimeout(staggerTimer); } catch (_) {} staggerTimer = 0; }
  }

  function staggerList(el) {
    if (!el || !isShown(el)) return;
    var kids = el.children;
    var n = Math.min(kids.length, STAGGER_MAX);
    if (n <= 0) return;
    /* 兜底节流：真的被某条异步路径连续重建时，最多 1.5s 一弹 ✓ ——
       它只可能**减少**动画，绝不会凭空多加一次 ✗ */
    var now = Date.now();
    var last = lastStagger.get(el) || 0;
    if (now - last < 1500) return;
    lastStagger.set(el, now);

    clearStagger();                                  /* 上一批还没收尾就先摘干净，别叠加 ✗ */
    var nodes = [];
    for (var i = 0; i < n; i++) {
      var k = kids[i];
      k.style.animationDelay = (i * STAGGER_STEP) + 'ms';
      k.classList.add('mo-stagger');
      nodes.push(k);
    }
    staggerNodes = nodes;
    staggerTimer = setTimeout(clearStagger, (n - 1) * STAGGER_STEP + cssMs('--mo-3', 240) + 120);
  }

  /* 面板整体显隐带出来的列表 —— 面板自己的属性变了，列表自身没有 mutation ✗，
     所以由 ① 的 observer 转告这里 ✓（两条路径都进 staggerList，节流保证不会双触发） */
  function staggerListsInside(panel) {
    try {
      for (var i = 0; i < LIST_IDS.length; i++) {
        var el = byId(LIST_IDS[i]);
        if (!el) continue;
        if (el === panel || (panel.contains && panel.contains(el))) staggerList(el);
      }
    } catch (_) {}
  }

  function flushBatch() {
    batchFrame = 0;
    var list = pending;
    pending = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      try {
        var start = batchStart.get(el);
        if (start === undefined) start = settled.has(el) ? settled.get(el) : el.children.length;
        batchStart.delete(el);
        var now = el.children.length;
        /* ★★ 就是这一行把"首次出现"和"3 秒轮询重建"分开了 ✓ */
        if (start === 0 && now > 0) staggerList(el);
        settled.set(el, now);
      } catch (_) {}
    }
  }

  function flushSoon() {
    if (batchFrame) return;
    try { batchFrame = requestAnimationFrame(flushBatch); } catch (_) { batchFrame = 0; }
  }

  function initLists() {
    var els = LIST_IDS.map(byId).filter(Boolean);
    if (!els.length) return;
    els.forEach(function (el) { settled.set(el, el.children.length); });

    var mo = new MutationObserver(function (records) {
      try {
        for (var i = 0; i < records.length; i++) {
          var el = records[i].target;
          if (!el || el.nodeType !== 1 || !settled.has(el)) continue;
          if (!batchStart.has(el)) {
            batchStart.set(el, settled.get(el));   /* 这一批的起点 = 上一批结算值 ✓ */
            pending.push(el);
          }
        }
        if (pending.length) flushSoon();
      } catch (_) {}
    });

    var visMo = new MutationObserver(function (records) {
      try {
        for (var i = 0; i < records.length; i++) {
          var el = records[i].target;
          if (!el || !settled.has(el)) continue;
          if (isShown(el)) staggerList(el);        /* 隐藏→可见 的那一次 ✓ */
        }
      } catch (_) {}
    });

    els.forEach(function (el) {
      try { mo.observe(el, { childList: true, subtree: false }); } catch (_) {}
      try { visMo.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] }); } catch (_) {}
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     ④ 状态提示脉冲（#status 由 app.js:11025 的 setStatus 写）
     ════════════════════════════════════════════════════════════════════════ */
  function initStatus() {
    var st = byId('status');
    if (!st) return;
    var last = st.textContent;      /* 基线：加载时不该闪 ✓ */
    var timer = 0;

    try {
      new MutationObserver(function () {
        try {
          var t = st.textContent;
          /* 只认"文字真的变了" ✓：setStatus 在轮询里对同一句话重复赋值很常见，
             每次都闪等于制造噪音 ✗ */
          if (t === last) return;
          last = t;
          if (timer) { try { clearTimeout(timer); } catch (_) {} }
          st.classList.remove('mo-flash');
          void st.offsetWidth;         /* 强制重排：同一个类要能重新触发动画（否则第二次不动）✓ */
          st.classList.add('mo-flash');
          timer = setTimeout(function () {
            timer = 0;
            try { st.classList.remove('mo-flash'); } catch (_) {}
          }, 720);
        } catch (_) {}
      }).observe(st, { childList: true, characterData: true, subtree: true });
    } catch (_) {}
  }

  /* ════════════════════════════════════════════════════════════════════════
     兜底样式 + 启动
     ════════════════════════════════════════════════════════════════════════ */
  function injectFallbackStyle() {
    /* ★ 兜底样式**永远注入**，并插在 <head> 的**第一个子节点** ✓ ——
       于是一条链上谁都不必猜加载顺序：
         · index.html 里后出现的 <link motion.css> 天然覆盖我（同级选择器后者胜）✓
         · 我兜的是**最小集**：.mo-enter / .mo-stagger / .mo-flash / #tabs[data-mo-sliding]
           这几条「JS 挂类、CSS 上效果」的契约 ✓ —— 少任何一条都是
           「类加上了却没效果」，而且看起来像 JS 坏了，最难查 ✗
       ✗ 反例（第一版的做法）：有 motion.css 就整个不注入 →
         一旦 CSS 侧漏了某一条，症状同上 ✗。
       ⚠️ 2026-10-28 更新：motion.css 定稿后**已经**定义了上面那几条
         （.mo-enter / .mo-stagger / .mo-flash / data-mo-sliding 全都在）✓，
         所以现在兜底是**纯保险**、不再是主力 ✓；两边同名同义、靠后加载取胜 ✓。
       ⚠️ 兜底只写"看得见的最小集"：不重做按钮/行 hover 那类已归 motion.css 的东西。 */
    try {
      var style = document.createElement('style');
      style.setAttribute('data-mo-fallback', '');
      style.textContent = FALLBACK_CSS;
      var head = document.head || document.documentElement;
      if (!head) return;
      head.insertBefore(style, head.firstChild);
    } catch (_) {}
  }

  function boot() {
    try { document.documentElement.setAttribute('data-mo', VERSION); } catch (_) {}
    try { injectFallbackStyle(); } catch (_) {}
    /* 每个特性独立 try-catch：指示条挂了不影响 stagger，反之亦然 ✓ */
    try { initPanels(); } catch (_) {}
    try { initLists(); } catch (_) {}
    try { initTabs(); } catch (_) {}
    try { initStatus(); } catch (_) {}
  }

  try {
    if (document.readyState === 'loading') {
      on(document, 'DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  } catch (_) { /* 连启动都不许炸 ✓ */ }
})();
