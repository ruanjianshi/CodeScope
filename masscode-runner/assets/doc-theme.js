/* ═══════════════════════════════════════════════════════════════════════
   CodeScope 文档配色切换器
   -----------------------------------------------------------------------
   在 Markdown 阅读器的模式按钮组（大纲 / 源码 / 区块编辑 / 阅读）末尾追加
   四个色点，点一下换一套文档配色。

   为什么是独立文件、而且是"动态注入"而不是改 app.js：
     · app.js 的代码行数正好顶在架构测试的棘轮上限（12993），一行都加不进去；
     · 阅读器工具栏是 app.js 运行时创建的，静态写在 index.html 里会被冲掉，
       所以用 MutationObserver 盯着，出现就挂、被重建就重挂。
   ⚠️ 只影响文档区配色（--doc-* 变量），不动 App 的 5 个主题。
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var THEMES = [
    ['everforest', '暖绿森林', '#A7C080'],
    ['abyss',      '深渊',     '#00B7C0'],
    ['radiation',  '生化辐射', '#4CD964'],
    ['vampire',    '吸血鬼',   '#FF5555']
  ];
  var KEY = 'codescope-doc-theme';
  var LAYOUT_KEY = 'codescope-doc-layout';
  var root = document.documentElement;

  function current() {
    return root.getAttribute('data-doc-theme') || 'everforest';
  }

  function currentLayout() {
    return root.getAttribute('data-doc-layout') === 'cards' ? 'cards' : 'flat';
  }

  function apply(id, persist) {
    /* 缺省即 everforest —— 不写属性，这样别人 clone 这份 CSS 也能直接用 */
    if (id === 'everforest') root.removeAttribute('data-doc-theme');
    else root.setAttribute('data-doc-theme', id);
    var dots = document.querySelectorAll('.doc-theme-picker .dtp-dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].setAttribute('aria-pressed', String(dots[i].getAttribute('data-theme') === id));
    }
    if (persist) { try { localStorage.setItem(KEY, id); } catch (e) {} }
  }

  var saved = 'everforest';
  try { saved = localStorage.getItem(KEY) || 'everforest'; } catch (e) {}
  if (!THEMES.some(function (t) { return t[0] === saved; })) saved = 'everforest';
  apply(saved, false);

  /* 布局：flat（铺满，原样）/ cards（文档浮起来变成一张卡片） */
  function applyLayout(mode, persist) {
    if (mode === 'cards') root.setAttribute('data-doc-layout', 'cards');
    else root.removeAttribute('data-doc-layout');
    var btn = document.querySelector('.doc-theme-picker .dtp-layout');
    if (btn) {
      btn.setAttribute('aria-pressed', String(mode === 'cards'));
      btn.title = mode === 'cards' ? '卡片布局（点一下切回平铺）' : '平铺布局（点一下切成卡片）';
    }
    if (persist) { try { localStorage.setItem(LAYOUT_KEY, mode); } catch (e) {} }
  }
  var savedLayout = 'flat';
  try { savedLayout = localStorage.getItem(LAYOUT_KEY) === 'cards' ? 'cards' : 'flat'; } catch (e) {}
  applyLayout(savedLayout, false);

  function build() {
    var box = document.createElement('span');
    box.className = 'doc-theme-picker';
    box.title = '文档外观';

    /* 布局切换（平铺 / 卡片）—— 图标里的小方块：大=铺满，小=卡片有边距 */
    var lay = document.createElement('button');
    lay.type = 'button';
    lay.className = 'dtp-layout';
    lay.setAttribute('aria-label', '切换卡片 / 平铺布局');
    lay.setAttribute('aria-pressed', String(currentLayout() === 'cards'));
    lay.title = currentLayout() === 'cards' ? '卡片布局（点一下切回平铺）' : '平铺布局（点一下切成卡片）';
    lay.addEventListener('click', function () {
      applyLayout(currentLayout() === 'cards' ? 'flat' : 'cards', true);
    });
    box.appendChild(lay);

    var sep = document.createElement('span');
    sep.className = 'dtp-sep';
    box.appendChild(sep);

    THEMES.forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dtp-dot';
      btn.setAttribute('data-theme', t[0]);
      btn.title = t[1];
      btn.setAttribute('aria-label', '文档配色：' + t[1]);
      btn.setAttribute('aria-pressed', String(current() === t[0]));
      btn.style.setProperty('--dot', t[2]);
      btn.addEventListener('click', function () { apply(t[0], true); });
      box.appendChild(btn);
    });
    return box;
  }

  function mount() {
    if (document.querySelector('.doc-theme-picker')) return;
    /* .reading-md-mode 是模式按钮的类，取第一个再拿它的父容器（按钮组） */
    var mode = document.querySelector('.reading-md-mode');
    var host = mode && mode.parentElement;
    if (!host) return;
    host.appendChild(build());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* 工具栏是运行时建的，且切文档时会重建 —— 盯着 DOM，出现就挂（rAF 节流） */
  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; mount(); });
  }).observe(document.body, { childList: true, subtree: true });
})();
