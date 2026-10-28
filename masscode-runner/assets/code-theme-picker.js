/* 代码高亮主题选择器（2026-10-28）
   -----------------------------------------------------------------------
   ★ 做什么：在**已有的**「主题」菜单（#theme-menu，index.html 静态标记）里追加一段
     「代码高亮主题」，12 套程序员常用主题 + 「跟随文档配色」✓，点一下即时切换并记住 ✓。

   ★ 为什么挂进那个菜单而不是自己造个按钮 ✗：
     用户的心智模型是「主题就那一个入口」✓；再造一个按钮等于让他记两个地方 ✓。
     而那个菜单是 **index.html 的静态标记** ✓ —— 不是 app.js 运行时生成的 ✓，
     所以我们能直接往里追加 DOM ✓，不用碰那个顶在 12,995 行代码上限的 app.js ✓。

   ★ 为什么复用它的 <button> + .palette 结构 ✓：样式全在 app.css 里按
     `#theme-menu button` 写的 ✓ —— 用同样的结构就自动长得一样 ✓，不用抄一套 CSS ✓。

   ⚠️ 只**追加**，不改原有 5 个界面主题按钮 ✓；点我们的项之后要把菜单收起来 ✓
      （原菜单由 app.js 开关，我们手动加 .hidden + 复位 aria-expanded ✓）。 */
(function () {
  'use strict';

  function swatch(colors) {
    return '<span class="palette">' + colors.map(function (c) {
      return '<i style="background:' + c + '"></i>';
    }).join('') + '</span>';
  }

  function build() {
    var menu = document.getElementById('theme-menu');
    var api = window.__csCodeTheme;
    if (!menu || !api) return false;
    if (document.getElementById('code-theme-section')) return true;   /* 幂等 */

    var sec = document.createElement('div');
    sec.id = 'code-theme-section';

    var title = document.createElement('div');
    title.className = 'theme-title';
    title.textContent = '代码高亮主题';
    sec.appendChild(title);

    /* 第一项：跟随文档配色（默认行为，恢复成和 Markdown 文档同一套） */
    var follow = document.createElement('button');
    follow.type = 'button';
    follow.setAttribute('data-code-theme', '');
    follow.innerHTML = swatch(['#272E33', '#A7C080', '#7FBBB3', '#D3C6AA']) + '<span>跟随文档配色</span>';
    sec.appendChild(follow);

    var list = api.list();
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-code-theme', t.id);
      btn.innerHTML = swatch([t.bg, t.kw, t.str, t.fn]) + '<span>' + t.label + '</span>';
      sec.appendChild(btn);
    }

    menu.appendChild(sec);

    function mark() {
      var cur = api.current() || '';
      var btns = sec.querySelectorAll('button[data-code-theme]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('on', (btns[i].getAttribute('data-code-theme') || '') === cur);
      }
    }
    mark();

    sec.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-code-theme]') : null;
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      try { api.apply(btn.getAttribute('data-code-theme') || ''); } catch (_) {}
      mark();
      /* 收起菜单：和 app.js 的开关保持一致（它用 .hidden + aria-expanded） */
      menu.classList.add('hidden');
      var t = document.getElementById('theme-btn');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
    return true;
  }

  /* 等两样东西：菜单 DOM + code-theme.js 的 API（后者要等 Monaco 起来） */
  var tries = 0;
  (function loop() {
    var ok = false;
    try { ok = build(); } catch (_) {}
    if (ok) return;
    if (tries++ > 900) return;   /* 最多 3 分钟 */
    setTimeout(loop, 200);
  })();
})();