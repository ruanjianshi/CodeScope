/*
 * 本机管家 · 全盘扫描 & 安全管理
 *
 * 「全盘扫描」是只读盘点：只读目录结构与文件大小，不打开文件内容，不跟随软链，改不了任何东西。
 * 「安全管理」把服务端的保护策略摊开给人看：哪些路径是系统保护区（一律拒绝修改）、哪些是敏感区
 * （禁止删/移/改名）、哪些路径现在能写、以及最近做过什么（审计日志）。
 */
(function () {
  const ROOT_CHOICES = [
    { id: 'home', label: '主目录', hint: '你的文件都在这里', path: null },
    { id: 'apps', label: '应用程序', path: '/Applications' },
    { id: 'library', label: '系统库（只读）', path: '/Library' },
    { id: 'system', label: '系统目录（只读，很慢）', path: '/System' },
  ];
  const SIZE_CHOICES = [
    ['60000', '快（6 万条目）'],
    ['150000', '标准（15 万条目）'],
    ['400000', '彻底（40 万条目）'],
  ];

  function createScanView(host) {
    const el = host.el;
    const esc = host.esc;
    const S = {
      view: 'scan',
      home: '',
      root: {},
      safetyRoot: {},
      roots: { home: true, apps: true, library: false, system: false, volumes: {} },
      size: '150000',
      includeSystem: false,
      scan: null,
      polling: null,
      safety: null,
      ops: null,
      error: '',
      volumes: [],
    };

    function toast(kind, message) {
      if (typeof host.toast === 'function') host.toast(kind, message);
    }

    function homePath() { return S.home || host.home || ''; }

    function wantRoots() {
      const list = [];
      const home = homePath();
      if (S.roots.home && home) list.push(home);
      for (const choice of ROOT_CHOICES) if (choice.path && S.roots[choice.id]) list.push(choice.path);
      for (const volume of Object.keys(S.roots.volumes)) if (S.roots.volumes[volume]) list.push(volume);
      return list;
    }

    /* ------------------------------ 扫描 ------------------------------ */

    async function startScan() {
      S.error = '';
      const roots = wantRoots();
      if (!roots.length) { toast('err', '至少选一个要扫描的位置'); return; }
      try {
        const data = await host.api('/files/scan', {
          roots, includeSystem: S.includeSystem, maxEntries: Number(S.size),
        });
        S.scan = data.scan;
        startPolling();
        paintScan();
      } catch (error) {
        S.error = String((error && error.message) || error);
        paintScan();
      }
    }

    async function cancelScan() {
      try { await host.api('/files/scan/cancel', {}); } catch (_) { /* 忽略 */ }
      stopPolling();
      await pollScan();
    }

    function startPolling() {
      if (S.polling) return;
      S.polling = setInterval(pollScan, 800);
    }

    function stopPolling() {
      if (S.polling) { clearInterval(S.polling); S.polling = null; }
    }

    async function pollScan() {
      try {
        const data = await host.api('/files/scan');
        S.scan = data.scan;
        S.error = '';
        if (!S.scan || S.scan.status !== 'running') stopPolling();
        paintScan();
      } catch (error) {
        S.error = String((error && error.message) || error);
        stopPolling();
        paintScan();
      }
    }

    async function loadSafety() {
      try {
        const [safety, ops] = await Promise.all([host.api('/files/safety'), host.api('/files/ops')]);
        S.safety = safety;
        S.ops = (ops && ops.operations) || [];
      } catch (error) {
        S.safety = { ok: false, error: String((error && error.message) || error) };
      }
      paintSafety();
    }

    async function reveal(path) {
      try {
        await host.api('/files/reveal', { path });
        toast('ok', '已在访达中定位');
      } catch (error) {
        toast('err', String((error && error.message) || error));
      }
    }

    async function browse(path) {
      if (typeof host.openInFiles === 'function') host.openInFiles(path);
      else toast('info', '到「文件浏览」里打开：' + path);
    }

    /* ------------------------------ 渲染 ------------------------------ */

    function renderProgress() {
      const scan = S.scan;
      const wrap = el('div', 'scan-progress');
      const running = scan && scan.status === 'running';
      const pct = scan && scan.maxEntries ? Math.min(100, Math.round((scan.entries / scan.maxEntries) * 100)) : 0;
      const bar = el('div', 'scan-bar');
      const fill = el('i', running ? 'run' : (scan && scan.status === 'cancelled' ? 'stop' : 'done'));
      fill.style.width = Math.max(2, pct) + '%';
      bar.appendChild(fill);
      wrap.appendChild(bar);
      const line = el('div', 'scan-line');
      if (!scan) line.textContent = '还没开始。选好位置，点「开始扫描」。';
      else {
        line.appendChild(el('span', null, ({ running: '扫描中', done: '已完成', cancelled: '已取消', error: '出错' })[scan.status] || scan.status));
        line.appendChild(el('span', null, '文件 ' + scan.files.toLocaleString() + ' 个'));
        line.appendChild(el('span', null, '目录 ' + scan.dirs.toLocaleString() + ' 个'));
        line.appendChild(el('span', null, '合计 ' + host.fmtBytes(scan.bytes)));
        line.appendChild(el('span', null, '条目 ' + scan.entries.toLocaleString() + ' / ' + scan.maxEntries.toLocaleString()));
        if (scan.skippedProtected) line.appendChild(el('span', null, '跳过保护区 ' + scan.skippedProtected + ' 处'));
        if (scan.denied) line.appendChild(el('span', null, '无权限 ' + scan.denied + ' 处'));
        if (scan.links) line.appendChild(el('span', null, '软链未跟随 ' + scan.links + ' 个'));
        if (scan.stoppedEarly) line.appendChild(el('span', 'sp-warn', '因' + scan.stoppedEarly + '停止'));
      }
      wrap.appendChild(line);
      if (running && scan.current) wrap.appendChild(el('div', 'scan-current', scan.current));
      return wrap;
    }

    function renderResults() {
      const scan = S.scan;
      if (!scan || scan.status === 'running' || (!scan.files && !scan.largest.length)) return null;
      const gone = el('div', 'scan-results');
      /* 最大的文件 */
      const files = el('section', 'scan-card');
      files.appendChild(el('h4', null, '最大的文件'));
      const fileList = el('div', 'scan-list');
      for (const item of scan.largest.slice(0, 18)) {
        const row = el('div', 'scan-row');
        row.appendChild(el('span', 'scan-size', host.fmtBytes(item.bytes)));
        const name = el('button', 'scan-name', item.path);
        name.type = 'button';
        name.title = '点开所在目录：' + item.path;
        name.addEventListener('click', () => browse(item.path));
        row.appendChild(name);
        const find = el('button', 'sp-btn tiny', '访达');
        find.addEventListener('click', () => reveal(item.path));
        row.appendChild(find);
        fileList.appendChild(row);
      }
      if (!scan.largest.length) fileList.appendChild(el('p', 'sp-note', '没有超过 1MB 的文件'));
      files.appendChild(fileList);
      gone.appendChild(files);
      /* 按类型 */
      const exts = el('section', 'scan-card');
      exts.appendChild(el('h4', null, '按类型'));
      const maxBytes = (scan.byExt[0] && scan.byExt[0].bytes) || 1;
      const extList = el('div', 'scan-list');
      for (const item of scan.byExt.slice(0, 12)) {
        const row = el('div', 'scan-row scan-ext');
        row.appendChild(el('span', 'scan-size', host.fmtBytes(item.bytes)));
        row.appendChild(el('span', 'scan-name', '.' + item.name));
        const meter = el('span', 'scan-meter');
        const bar = el('i');
        bar.style.width = Math.max(3, Math.round((item.bytes / maxBytes) * 100)) + '%';
        meter.appendChild(bar);
        row.appendChild(meter);
        row.appendChild(el('span', 'scan-count', item.count.toLocaleString() + ' 个'));
        extList.appendChild(row);
      }
      exts.appendChild(extList);
      gone.appendChild(exts);
      /* 最大的目录 */
      const dirs = el('section', 'scan-card');
      dirs.appendChild(el('h4', null, '最占地方的目录'));
      const dirList = el('div', 'scan-list');
      for (const item of scan.topDirs.slice(0, 12)) {
        const row = el('div', 'scan-row');
        row.appendChild(el('span', 'scan-size', host.fmtBytes(item.bytes)));
        const name = el('button', 'scan-name', item.path);
        name.type = 'button';
        name.addEventListener('click', () => browse(item.path));
        row.appendChild(name);
        dirList.appendChild(row);
      }
      dirs.appendChild(dirList);
      gone.appendChild(dirs);
      return gone;
    }

    function paintScan() {
      const root = S.root.scan;
      if (!root || !root.isConnected) return;
      root.innerHTML = '';
      /* 安全声明放最上面：这是让人放心的前提，不是免责声明。 */
      const banner = el('div', 'sp-band scan-safety');
      banner.appendChild(el('h3', null, '只读盘点，改不了任何东西'));
      banner.appendChild(el('p', 'sp-note', '扫描只读目录结构和文件大小：不打开文件内容、不跟随软链、不写一个字节。系统保护区与敏感区默认跳过，即使勾选「包含系统保护区」也只是多读一点，依旧不能修改。'));
      root.appendChild(banner);

      const setup = el('div', 'sp-band');
      setup.appendChild(el('h3', null, '扫描范围'));
      const chips = el('div', 'scan-roots');
      const all = [{ id: 'home', label: '主目录 ' + (homePath() || '（未识别）') }].concat(ROOT_CHOICES.slice(1));
      for (const choice of all) {
        const label = el('label', 'scan-check');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = !!S.roots[choice.id];
        box.addEventListener('change', () => { S.roots[choice.id] = box.checked; paintScan(); });
        label.appendChild(box);
        label.appendChild(el('span', null, choice.label));
        chips.appendChild(label);
      }
      for (const volume of S.volumes) {
        const label = el('label', 'scan-check');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = !!S.roots.volumes[volume];
        box.addEventListener('change', () => { S.roots.volumes[volume] = box.checked; paintScan(); });
        label.appendChild(box);
        label.appendChild(el('span', null, '外接盘 ' + volume));
        chips.appendChild(label);
      }
      setup.appendChild(chips);

      const options = el('div', 'scan-options');
      const deep = el('label', 'scan-check');
      const deepBox = el('input');
      deepBox.type = 'checkbox';
      deepBox.checked = S.includeSystem;
      deepBox.addEventListener('change', () => { S.includeSystem = deepBox.checked; paintScan(); });
      deep.appendChild(deepBox);
      deep.appendChild(el('span', null, '包含系统保护区（仍然是只读）'));
      options.appendChild(deep);

      const sizeLabel = el('label', 'scan-check');
      sizeLabel.appendChild(el('span', null, '扫描深度'));
      const select = el('select', 'sp-input');
      for (const [value, label] of SIZE_CHOICES) {
        const option = el('option', null, label);
        option.value = value;
        if (S.size === value) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => { S.size = select.value; });
      sizeLabel.appendChild(select);
      options.appendChild(sizeLabel);
      setup.appendChild(options);

      const actions = el('div', 'sp-actions');
      const running = S.scan && S.scan.status === 'running';
      const start = el('button', 'sp-btn primary', running ? '重新开始' : '开始扫描');
      start.disabled = running;
      start.addEventListener('click', startScan);
      actions.appendChild(start);
      const cancel = el('button', 'sp-btn', '停止');
      cancel.disabled = !running;
      cancel.addEventListener('click', cancelScan);
      actions.appendChild(cancel);
      const refresh = el('button', 'sp-btn', '刷新结果');
      refresh.addEventListener('click', pollScan);
      actions.appendChild(refresh);
      setup.appendChild(actions);
      root.appendChild(setup);

      root.appendChild(renderProgress());
      if (S.error) root.appendChild(el('p', 'sp-note sp-warn', S.error));
      const results = renderResults();
      if (results) root.appendChild(results);
    }

    /* ------------------------------ 安全管理 ------------------------------ */

    function listCard(title, items, note) {
      const card = el('section', 'scan-card');
      card.appendChild(el('h4', null, title));
      if (note) card.appendChild(el('p', 'sp-note', note));
      const list = el('div', 'safe-paths');
      for (const item of items) list.appendChild(el('code', null, item));
      if (!items.length) list.appendChild(el('p', 'sp-note', '（无）'));
      card.appendChild(list);
      return card;
    }

    function paintSafety() {
      const root = S.root.safety;
      if (!root || !root.isConnected) return;
      root.innerHTML = '';
      const safety = S.safety;
      if (!safety) { root.appendChild(el('div', 'sp-empty', '读取安全策略…')); return; }
      if (safety.ok === false) {
        root.appendChild(el('p', 'sp-note sp-warn', safety.error || '读取失败'));
        return;
      }
      const banner = el('div', 'sp-band');
      banner.appendChild(el('h3', null, '面板能做什么，不能做什么'));
      banner.appendChild(el('p', 'sp-note', '默认「失败即拒绝」：任何位于系统保护区里的写入、删除、移动、改名都会被服务端直接拒绝，不存在「点了就删掉」的可能。删除一律先送进废纸篓，可还原；每次写操作都记审计日志。'));
      root.appendChild(banner);

      const grid = el('div', 'safe-grid');
      grid.appendChild(listCard('系统保护区（一律拒绝修改）', safety.protectedPrefixes || [],
        '这些目录整棵树都被冻结。只读浏览、扫描、看文件内容不受影响。'));
      grid.appendChild(listCard('敏感区（禁止删除/移动/改名）', safety.sensitivePrefixes || [],
        '这里既有系统运行需要的东西，也有你的数据。清理缓存请用面板里的「缓存清理」，它自带白名单。'));
      grid.appendChild(listCard('临时目录例外', safety.exemptPrefixes || [],
        '这些是临时空间，允许正常使用。'));
      grid.appendChild(listCard('常用目录本身（只保护目录，不保护内容）', safety.protectedHome || [],
        '可以整理里面的文件，但不会让你一键把整个「桌面」送进废纸篓。'));
      root.appendChild(grid);

      const extra = el('div', 'sp-band');
      extra.appendChild(el('h3', null, '其他硬约束'));
      const rules = el('ul', 'safe-rules');
      for (const line of [
        '改/删前会解析真实路径：家目录里放个指向系统目录的软链也绕不过去。',
        '应用包内部（*.app/…）一律不许写入，避免改坏一个应用。',
        '整个 .app 可以移进废纸篓（等于卸载，可还原），系统自带应用不提供删除入口。',
        '永久删除必须由界面显式传「永久删除」确认，普通删除一律先走废纸篓。',
        '整理功能默认是预演（dryRun），必须再点一次才会真的移动文件。',
        '只读模式（设置里）打开后，所有写接口直接拒绝。',
      ]) rules.appendChild(el('li', null, line));
      extra.appendChild(rules);
      root.appendChild(extra);

      const opsCard = el('section', 'scan-card safe-ops');
      opsCard.appendChild(el('h4', null, '审计日志（最近 ' + ((S.ops && S.ops.length) || 0) + ' 条）'));
      if (!S.ops || !S.ops.length) opsCard.appendChild(el('p', 'sp-note', '还没有任何写操作记录。'));
      else {
        const list = el('div', 'scan-list');
        for (const item of S.ops.slice(0, 30)) {
          const row = el('div', 'scan-row');
          row.appendChild(el('span', 'scan-size', host.relTime(item.at)));
          row.appendChild(el('span', 'safe-type', item.type));
          const detail = item.path || item.root || (item.count ? item.count + ' 项' : '') || (item.items ? item.items.length + ' 项' : '');
          row.appendChild(el('span', 'scan-name', String(detail)));
          list.appendChild(row);
        }
        opsCard.appendChild(list);
      }
      root.appendChild(opsCard);
    }

    return {
      isScanView(view) { return view === 'scan' || view === 'safety'; },
      mount(container, view) {
        S.view = view === 'safety' ? 'safety' : 'scan';
        const key = S.view;
        if (!S.root[key] || S.root[key].parentNode !== container) {
          if (!S.root[key]) S.root[key] = el('div', 'scan-root ' + (key === 'scan' ? 'scan-view' : 'safe-view'));
          container.innerHTML = '';
          container.appendChild(S.root[key]);
        }
        if (key === 'scan') {
          if (!homePath()) {
            host.api('/overview').then((data) => {
              S.home = (data && data.identity && data.identity.home) || '';
              paintScan();
            }).catch(() => {});
          }
          paintScan();
          if (!S.scan) pollScan();
          if (!S.volumes.length) {
            host.api('/files/list?path=/Volumes').then((data) => {
              const found = ((data && data.entries) || []).filter((item) => item.kind === 'dir' || item.kind === 'link')
                .map((item) => '/Volumes/' + item.name);
              S.volumes = found.slice(0, 6);
              paintScan();
            }).catch(() => {});
          }
        } else {
          if (!S.safety) paintSafety();
          loadSafety();
        }
      },
      unmount() { stopPolling(); },
      onPanelClosed() { stopPolling(); },
      handleKey() { return false; },
      state: S,
    };
  }

  module.exports = { createScanView };
})();
