/* ── 左侧栏重构：Git 与标签不再各占一块 ────────────────────────────────────
   用户原话（2026-10-26）：
     「GIT 和标签，没必要占用左边的模块 —— git 一般只是用于查看和提交、回退等管理的，
       不太需要单独占用；标签用于检索的，应该和搜索那边挂钩」
   ⇒ ① Git  → 顶栏一个按钮，点开**右侧抽屉**（查看/提交/推送/回退都在里面）✓
      ② 标签 → 收进**搜索框**：输入框右边的筛选按钮，点开就在下面弹标签筛选 ✓

   ⚠️ 为什么不直接把节点搬走 ✗：
      app.js 的 `applyPanelOrder()` 每次加载都会把 `#pane-git` / `#pane-tags`
      按 PANEL_ORDER 重新 append 回 `#side` ✓ —— 搬走会被它搬回来 ✓
   ⇒ 所以节点**原地不动**，只用 CSS 让它们在"关闭"时 `display:none`、
      在"打开"时 `position:fixed` 浮出来 ✓ 逻辑（绑定 id 的那套）完全不受影响 ✓ */
(function () {
  var gitPane = document.getElementById('pane-git');
  var tagPane = document.getElementById('pane-tags');
  var search = document.getElementById('search');
  if (!gitPane) return;

  /* ── 遮罩：点空白处关掉抽屉/弹层 ── */
  var mask = document.createElement('div');
  mask.id = 'cs-panel-mask';
  document.body.appendChild(mask);

  function closeAll() { document.body.classList.remove('git-open', 'tags-open'); }
  mask.addEventListener('click', closeAll);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  /* ── ① Git 抽屉：按钮挂在顶栏「常用网址」前面 ── */
  var siteMenu = document.getElementById('site-menu');
  var gitBtn = document.createElement('button');
  gitBtn.id = 'btn-git-panel';
  gitBtn.type = 'button';
  gitBtn.title = 'Git：查看改动 / 提交 / 推送 / 拉取 / 回退';
  gitBtn.setAttribute('aria-expanded', 'false');
  /* 只放图标 ✓ —— 和顶部 github / book 那几个小图标一个规格（用户要求） */
  gitBtn.innerHTML = '<svg class="cs-ico" aria-hidden="true"><use href="#i-git"/></svg>';
  if (siteMenu && siteMenu.parentNode) siteMenu.parentNode.insertBefore(gitBtn, siteMenu);
  else document.body.appendChild(gitBtn);

  gitBtn.addEventListener('click', function () {
    var on = !document.body.classList.contains('git-open');
    document.body.classList.remove('tags-open');
    document.body.classList.toggle('git-open', on);
    gitBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    /* 打开时刷新一次状态 ✓（面板自带 ↻，但打开就该是最新的） */
    if (on) { var r = document.getElementById('git-refresh'); if (r) r.click(); }
  });

  /* ── ② 标签筛选：按钮浮在搜索框右端 ── */
  if (search && tagPane) {
    var tagBtn = document.createElement('button');
    tagBtn.id = 'btn-tag-filter';
    tagBtn.type = 'button';
    tagBtn.title = '按标签筛选（与搜索叠加生效）';
    tagBtn.setAttribute('aria-expanded', 'false');
    tagBtn.innerHTML = '<svg class="cs-ico cs-ico-sm" aria-hidden="true"><use href="#i-tag"/></svg>';
    search.parentNode.insertBefore(tagBtn, search.nextSibling);

    var place = function () {
      var r = search.getBoundingClientRect();
      tagPane.style.left = Math.round(r.left) + 'px';
      tagPane.style.top = Math.round(r.bottom + 6) + 'px';
      tagPane.style.width = Math.round(r.width) + 'px';
    };

    tagBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var on = !document.body.classList.contains('tags-open');
      document.body.classList.remove('git-open');
      if (on) place();
      document.body.classList.toggle('tags-open', on);
      tagBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    /* 弹层里点选标签不要关掉它 ✓ —— 用户要连续挑几个 */
    tagPane.addEventListener('click', function (e) { e.stopPropagation(); });
    window.addEventListener('resize', function () {
      if (document.body.classList.contains('tags-open')) place();
    });
  }
})();
