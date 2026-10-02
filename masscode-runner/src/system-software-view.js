/*
 * 本机管家 · 软件管理视图
 *
 * 只做 UI：数据来自 /api/system-panel/apps*。所有危险动作都不在这里做 ——
 * 这个视图没有「卸载」按钮：想删应用请用「文件」分区把它移进废纸篓（可还原、有审计）。
 */
(function () {
  const CATEGORY_GLYPH = {
    '开发工具': '⌨', '设计与图形': '◈', '效率办公': '▤', '实用工具': '⚙', '系统自带': '⌘',
    '影音': '▶', '学习': '✎', '网络': '⇄', '社交沟通': '☰', '游戏': '⌗', '资讯': '☷', '其它': '◆',
  };
  const SORTS = [
    ['favorite', '常用优先'], ['name', '按名称'], ['recent', '按最近打开'], ['size', '按分类'],
  ];

  function createSoftwareView(host) {
    const esc = host.esc;
    const el = host.el;

    const S = {
      loading: false,
      error: '',
      data: null,
      query: '',
      category: '',
      sort: 'favorite',
      layout: 'grid',
      root: null,
      detail: null,
      detailLoading: false,
      busy: '',
      lastLoadedAt: 0,
    };

    function glyph(category) {
      return CATEGORY_GLYPH[category] || '◆';
    }

    function iconUrl(app) {
      return '/api/system-panel/apps/icon?id=' + encodeURIComponent(app.id);
    }

    /* 图标：字形垫底 + 图片立即入 DOM（未入 DOM 的 img 配 loading=lazy 永远不会加载）。
       图片解码成功才盖住字形，失败就留着字形，绝不出现破图。 */
    function iconNode(app, size) {
      const wrap = el('span', 'sw-icon');
      wrap.style.width = size + 'px';
      wrap.style.height = size + 'px';
      const glyphNode = el('span', 'sw-icon-glyph', glyph(app.category));
      glyphNode.style.fontSize = Math.round(size * 0.42) + 'px';
      wrap.appendChild(glyphNode);
      if (app.icon) {
        const img = new Image();
        img.className = 'sw-icon-img';
        img.decoding = 'async';
        img.alt = '';
        img.addEventListener('load', () => { if (img.naturalWidth > 0) wrap.classList.add('has-img'); });
        img.src = iconUrl(app);
        wrap.appendChild(img);
      }
      return wrap;
    }

    function toast(kind, message) {
      if (typeof host.toast === 'function') host.toast(kind, message);
    }

    async function load(force) {
      if (S.loading && !force) return;      /* 防重入：面板刷新会反复调 mount */
      S.loading = true;
      S.error = '';
      render();
      try {
        const data = await host.api('/apps' + (force ? '?refresh=1' : ''));
        S.data = data;
        S.lastLoadedAt = Date.now();
      } catch (error) {
        S.error = String((error && error.message) || error);
      }
      S.loading = false;
      render();
    }

    function visibleApps() {
      const all = (S.data && S.data.apps) || [];
      const query = S.query.trim().toLowerCase();
      let list = all.slice();
      if (S.category) list = list.filter((app) => app.category === S.category);
      if (query) {
        list = list.filter((app) => (app.name + ' ' + app.bundleId + ' ' + app.vendor + ' ' + app.path).toLowerCase().includes(query));
      }
      const runsOf = (app) => (S.data && S.data.runs && S.data.runs[app.id]) || app.runs || 0;
      if (S.sort === 'favorite') {
        list.sort((a, b) => (Number(b.favorite) - Number(a.favorite)) || (runsOf(b) - runsOf(a)) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
      } else if (S.sort === 'recent') {
        list.sort((a, b) => runsOf(b) - runsOf(a) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
      } else if (S.sort === 'size') {
        list.sort((a, b) => String(a.category).localeCompare(String(b.category), 'zh-Hans-CN') || a.name.localeCompare(b.name, 'zh-Hans-CN'));
      } else {
        list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
      }
      return list;
    }

    async function launch(app) {
      if (S.busy) return;
      S.busy = app.id;
      render();
      try {
        await host.api('/apps/launch', { id: app.id });
        toast('ok', '正在打开 ' + app.name);
        if (S.data) {
          S.data.runs = S.data.runs || {};
          S.data.runs[app.id] = Number(S.data.runs[app.id] || 0) + 1;
          const target = S.data.apps.find((item) => item.id === app.id);
          if (target) target.runs = S.data.runs[app.id];
        }
      } catch (error) {
        toast('err', '打不开 ' + app.name + '：' + String((error && error.message) || error));
      }
      S.busy = '';
      render();
    }

    async function reveal(app) {
      try {
        await host.api('/apps/reveal', { id: app.id });
        toast('ok', '已在访达中定位 ' + app.name);
      } catch (error) {
        toast('err', String((error && error.message) || error));
      }
    }

    async function toggleFavorite(app) {
      try {
        const data = await host.api('/apps/favorite', { id: app.id, on: !app.favorite });
        if (S.data) {
          S.data.favorites = (S.data.favorites || []).filter((item) => item.id !== app.id);
          if (data.app && data.app.favorite) S.data.favorites.unshift(data.app);
          const target = S.data.apps.find((item) => item.id === app.id);
          if (target) target.favorite = !!data.app.favorite;
        }
        toast('ok', data.app && data.app.favorite ? ('已把 ' + app.name + ' 放进常用') : ('已取消 ' + app.name + ' 的常用'));
        render();
      } catch (error) {
        toast('err', String((error && error.message) || error));
      }
    }

    async function openDetail(app) {
      S.detail = { app, info: null, size: null, createdAt: null };
      S.detailLoading = true;
      render();
      try {
        const data = await host.api('/apps/detail?id=' + encodeURIComponent(app.id));
        S.detail = { app: data.app || app, info: data.info || {}, size: data.size, createdAt: data.createdAt };
      } catch (error) {
        S.detail = { app, info: {}, size: null, createdAt: null, error: String((error && error.message) || error) };
      }
      S.detailLoading = false;
      render();
    }

    function closeDetail() {
      S.detail = null;
      S.detailLoading = false;
      render();
    }

    function copy(text) {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        toast('ok', '已复制路径');
      } catch (_) { toast('err', '复制失败，可以手动选中'); }
    }

    /* ------------------------------ 渲染 ------------------------------ */

    function appTile(app) {
      const tile = el('button', 'sw-tile');
      tile.type = 'button';
      /* 启动次数并进 tooltip：之前是右下角一个光秃秃的数字，没人知道那是什么，
         而且绝对定位在 216px 宽的卡片里会压到「分类 v版本」那一行（实测重叠 62px）。 */
      tile.title = app.path + (app.runs ? '\n从这个面板打开过 ' + app.runs + ' 次' : '');
      tile.appendChild(iconNode(app, 44));
      const body = el('div', 'sw-tile-body');
      const name = el('div', 'sw-tile-name', app.name);
      body.appendChild(name);
      const meta = el('div', 'sw-tile-meta');
      meta.appendChild(el('span', 'sw-tile-cat', app.category));
      if (app.version) meta.appendChild(el('span', 'sw-tile-ver', 'v' + app.version));
      body.appendChild(meta);
      tile.appendChild(body);
      const star = el('span', 'sw-star' + (app.favorite ? ' on' : ''), app.favorite ? '★' : '☆');
      star.title = app.favorite ? '取消常用' : '标记常用';
      star.addEventListener('click', (event) => { event.stopPropagation(); toggleFavorite(app); });
      tile.appendChild(star);
      tile.addEventListener('click', () => launch(app));
      tile.addEventListener('contextmenu', (event) => { event.preventDefault(); openDetail(app); });
      return tile;
    }

    function renderHeader() {
      const bar = el('div', 'sw-bar');
      const search = el('input', 'sp-input sw-search');
      search.type = 'search';
      search.placeholder = '搜索应用名、Bundle ID、路径…';
      search.value = S.query;
      search.addEventListener('input', () => { S.query = search.value; render(); });
      bar.appendChild(search);

      const sort = el('select', 'sp-input sw-sort');
      for (const [key, label] of SORTS) {
        const option = el('option', null, label);
        option.value = key;
        if (S.sort === key) option.selected = true;
        sort.appendChild(option);
      }
      sort.addEventListener('change', () => { S.sort = sort.value; render(); });
      bar.appendChild(sort);

      const toggle = el('button', 'sp-btn', S.layout === 'grid' ? '列表视图' : '图标视图');
      toggle.addEventListener('click', () => { S.layout = S.layout === 'grid' ? 'list' : 'grid'; render(); });
      bar.appendChild(toggle);

      const refresh = el('button', 'sp-btn', '重新扫描');
      refresh.disabled = !!S.loading;
      refresh.addEventListener('click', () => load(true));
      bar.appendChild(refresh);
      return bar;
    }

    /* 分类配色：黄金角取色（每次 +137.5°），不管有多少个分类，相邻两个的色相
       都差得够远 —— 顺序取色的话 15 个分类会绕回重复的颜色。
       饱和度压到 44%：15 段排在一起时，高饱和的彩虹条太吵，压暗一点更像仪表。 */
    function categoryColor(index) {
      return 'hsl(' + Math.round((index * 137.5 + 205) % 360) + ' 44% 57%)';
    }

    function renderCategories() {
      const groups = (S.data && S.data.groups) || [];
      const total = (S.data && S.data.total) || 0;
      const sorted = groups.slice().sort((a, b) => b.count - a.count);
      const wrap = el('div', 'sw-cats');

      /* 分布条：一条按分类分段的横条，段宽 = 该类占比。
         光看下面那串「实用工具 28 效率办公 18 …」是读不出重心的，条子一眼就有。
         段本身就是筛选按钮，色点和下面的胶囊一一对应，不用额外做图例。 */
      if (sorted.length) {
        const bar = el('div', 'sw-dist-bar');
        sorted.forEach((group, index) => {
          const seg = el('button', 'sw-dist-seg');
          seg.type = 'button';
          seg.style.width = (group.count / Math.max(1, total) * 100) + '%';
          seg.style.background = categoryColor(index);
          seg.title = group.category + '：' + group.count + ' 个（占 ' +
            Math.round(group.count / Math.max(1, total) * 100) + '%）· 点一下只看这一类';
          seg.addEventListener('click', () => { S.category = S.category === group.category ? '' : group.category; render(); });
          bar.appendChild(seg);
        });
        wrap.appendChild(bar);
      }

      const row = el('div', 'sw-cat-row');
      const chips = [['', '全部 ' + total]].concat(sorted.map((group) => [group.category, group.category + ' ' + group.count]));
      chips.forEach(([key, label], index) => {
        const chip = el('button', 'sw-cat' + (S.category === key ? ' on' : ''));
        chip.type = 'button';
        const dot = el('i', 'sw-dot');
        /* 第一个是「全部」，不给分类色；其余按分布条里的同一套色，颜色对得上 */
        dot.style.background = key ? categoryColor(index - 1) : 'var(--dim)';
        chip.appendChild(dot);
        chip.appendChild(el('span', null, label));
        chip.addEventListener('click', () => { S.category = key; render(); });
        row.appendChild(chip);
      });
      wrap.appendChild(row);
      return wrap;
    }

    function renderFavorites() {
      const favorites = (S.data && S.data.favorites) || [];
      if (!favorites.length) return null;
      const band = el('div', 'sp-band sw-fav');
      band.appendChild(el('h3', null, '常用'));
      const row = el('div', 'sw-fav-row');
      for (const app of favorites) {
        const chip = el('button', 'sw-fav-chip');
        chip.type = 'button';
        chip.appendChild(iconNode(app, 26));
        chip.appendChild(el('span', null, app.name));
        chip.title = app.path;
        chip.addEventListener('click', () => launch(app));
        chip.addEventListener('contextmenu', (event) => { event.preventDefault(); openDetail(app); });
        row.appendChild(chip);
      }
      band.appendChild(row);
      const note = el('p', 'sp-note', '点一下就打开；右键看详情。想删应用请到「文件」分区把它移进废纸篓（可还原）。');
      band.appendChild(note);
      return band;
    }

    function renderGrid(list) {
      if (!list.length) return el('div', 'sp-empty', S.query || S.category ? '没有匹配的应用' : '没有扫描到应用');
      const wrap = el('div', S.layout === 'grid' ? 'sw-grid' : 'sw-list');
      for (const app of list) wrap.appendChild(appTile(app));
      return wrap;
    }

    function renderDetail() {
      const layer = el('div', 'sw-detail-layer');
      layer.addEventListener('click', (event) => { if (event.target === layer) closeDetail(); });
      const box = el('div', 'sw-detail');
      const app = S.detail.app;
      const head = el('div', 'sw-detail-head');
      head.appendChild(iconNode(app, 56));
      const title = el('div', 'sw-detail-title');
      title.appendChild(el('strong', null, app.name));
      title.appendChild(el('span', 'sp-note', [app.category, app.version ? 'v' + app.version : ''].filter(Boolean).join(' · ')));
      head.appendChild(title);
      const close = el('button', 'sp-btn', '关闭');
      close.addEventListener('click', closeDetail);
      head.appendChild(close);
      box.appendChild(head);

      if (S.detailLoading) {
        box.appendChild(el('div', 'sp-empty', '读取详情…'));
      } else {
        const kv = el('div', 'sp-kv');
        const rows = [
          ['Bundle ID', app.bundleId || '—'],
          ['来源', app.source === 'apple' ? '系统自带（不可删）' : (app.source === 'user' ? '用户目录' : '/Applications')],
          ['路径', app.path],
          ['占用', S.detail.size ? host.fmtBytes(S.detail.size) : '—'],
          ['版本', (S.detail.info && S.detail.info.version) || app.version || '—'],
          ['最低系统', (S.detail.info && S.detail.info.minSystem) || '—'],
          ['版权', (S.detail.info && S.detail.info.copyright) || '—'],
          ['首次出现', S.detail.createdAt ? host.fmtTime(S.detail.createdAt) : '—'],
          ['打开次数', String(app.runs || 0)],
        ];
        for (const [key, value] of rows) {
          kv.appendChild(el('span', 'k', key));
          const cell = el('span', null, String(value));
          cell.title = String(value);
          kv.appendChild(cell);
        }
        box.appendChild(kv);
        if (S.detail.error) box.appendChild(el('p', 'sp-note sp-warn', S.detail.error));
        const actions = el('div', 'sp-actions');
        const open = el('button', 'sp-btn primary', '打开');
        open.addEventListener('click', () => launch(app));
        actions.appendChild(open);
        const find = el('button', 'sp-btn', '在访达中显示');
        find.addEventListener('click', () => reveal(app));
        actions.appendChild(find);
        const copyPath = el('button', 'sp-btn', '复制路径');
        copyPath.addEventListener('click', () => copy(app.path));
        actions.appendChild(copyPath);
        const fav = el('button', 'sp-btn', app.favorite ? '取消常用' : '标记常用');
        fav.addEventListener('click', () => toggleFavorite(app));
        actions.appendChild(fav);
        box.appendChild(actions);
        if (app.source === 'apple') {
          box.appendChild(el('p', 'sp-note', '这是系统自带应用，本面板不提供任何删除入口。'));
        } else {
          box.appendChild(el('p', 'sp-note', '本面板不提供卸载：要删请到「文件」分区把 ' + app.path.split('/').pop() + ' 移进废纸篓，可还原且会记审计日志。'));
        }
      }
      layer.appendChild(box);
      return layer;
    }

    function render() {
      /* 原地重绘：把新内容换进稳定容器，而不是每次造一个新的根节点丢在外面。 */
      if (!S.root) return null;
      const active = document.activeElement;
      const keepFocus = active && S.root.contains(active) && /INPUT|TEXTAREA/.test(active.tagName);
      let caret = null;
      if (keepFocus && typeof active.selectionStart === 'number') caret = [active.selectionStart, active.selectionEnd];
      const focusKey = keepFocus ? (active.className || active.tagName) : '';

      S.root.innerHTML = '';
      const root = el('div', 'sw-root-body');
      if (S.error) {
        const band = el('div', 'sp-band');
        band.appendChild(el('h3', 'sp-warn', '读取软件清单失败'));
        band.appendChild(el('p', 'sp-note', S.error));
        const retry = el('button', 'sp-btn', '重试');
        retry.addEventListener('click', () => load(true));
        band.appendChild(retry);
        root.appendChild(band);
        S.root.appendChild(root);
        return S.root;
      }
      if (S.loading && !S.data) {
        root.appendChild(el('div', 'sp-empty', '正在读取本机已装应用（首次要逐个读 Info.plist，约几秒）…'));
        S.root.appendChild(root);
        return S.root;
      }
      const list = visibleApps();
      root.appendChild(renderHeader());
      root.appendChild(renderCategories());
      const fav = renderFavorites();
      if (fav) root.appendChild(fav);
      const info = el('div', 'sw-info');
      info.appendChild(el('span', null, '共 ' + ((S.data && S.data.total) || 0) + ' 个应用 · 当前显示 ' + list.length + ' 个'));
      if (S.data && S.data.scannedAt) info.appendChild(el('span', null, '清单时间 ' + host.relTime(S.data.scannedAt)));
      if (S.loading) info.appendChild(el('span', null, '刷新中…'));
      root.appendChild(info);
      root.appendChild(renderGrid(list));
      S.root.appendChild(root);
      if (S.detail) S.root.appendChild(renderDetail());
      if (keepFocus && focusKey) {
        const next = [...S.root.querySelectorAll('input,textarea')].find((node) => (node.className || node.tagName) === focusKey);
        if (next) {
          next.focus();
          if (caret && typeof next.setSelectionRange === 'function') { try { next.setSelectionRange(caret[0], caret[1]); } catch (_) {} }
        }
      }
      return S.root;
    }

    return {
      isSoftwareView(view) { return view === 'apps'; },
      mount(container) {
        /* 关键：面板切视图时会把 body 清空，缓存的 S.root 会变成游离节点。
           只判断「S.root 是否存在」会一直往游离节点里重绘，界面就永远空白。 */
        if (!S.root || S.root.parentNode !== container) {
          if (!S.root) S.root = el('div', 'sw-root');
          container.innerHTML = '';
          container.appendChild(S.root);
        }
        render();
        if (!S.data) load(false);
      },
      unmount() { closeDetail(); },
      onPanelClosed() { closeDetail(); },
      handleKey(event) {
        if (event.key === 'Escape' && S.detail) { closeDetail(); return true; }
        return false;
      },
      state: S,
      reload: () => load(true),
    };
  }

  module.exports = { createSoftwareView };
})();
