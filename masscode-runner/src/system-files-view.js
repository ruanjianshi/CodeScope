/* CodeScope 本机管家 · 文件管理视图
 * ---------------------------------------------------------------------------
 * 设计取舍（来自 codescope-panel-ux-research.md 第 3、4、5、7 节）：
 *   1. 删除默认走废纸篓（POST /files/trash），删完给 5 秒撤销；只有「永久删除」才强确认；
 *   2. 日常动作（改名、新建文件夹、移动、复制）绝不弹确认框 —— 全部内联；
 *   3. 占用分析：列表 + 大小条是主力，canvas 手绘 squarified treemap 是补充，两者同数据源；
 *   4. 数据不完整必须显式标注（truncated / skipped / canScan / 没有原位置）；
 *   5. 键盘等价物与右键菜单一一对应（F2 重命名、F3/空格 预览、F5 复制、F6 移动、F7 新建、F8 送废纸篓）。
 *   6. 面板里不提供任何「执行任意命令」的入口：全部动作都落在写死的这几个 HTTP 接口上。
 *
 * 这个文件只做 UI，所有网络请求都通过宿主注入的 host.api / host.upload 完成，
 * 因此它不知道也不关心后端地址，便于单独测试与替换。
 */

const CATEGORY_PATTERNS = [
  ['image', /^(png|jpe?g|gif|webp|bmp|svg|ico|heic|heif|tiff?|psd|raw)$/],
  ['video', /^(mp4|mov|mkv|avi|webm|m4v|mpg|mpeg|flv|wmv)$/],
  ['audio', /^(mp3|wav|m4a|aac|flac|ogg|opus|aiff?)$/],
  ['code', /^(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cc|cpp|hpp|cs|php|swift|kt|kts|sh|bash|zsh|fish|json|jsonc|yml|yaml|toml|ini|cfg|xml|html|htm|css|scss|sass|less|vue|svelte|sql|lua|pl|r|dart|gradle|make|cmake|dockerfile)$/],
  ['doc', /^(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|markdown|rtf|pages|numbers|key|epub|tex|log|csv|tsv)$/],
  ['archive', /^(zip|tar|gz|tgz|bz2|xz|7z|rar|dmg|iso|pkg|jar|whl|crate|deb|rpm)$/],
];

function createFilesView(host) {
  const api = (path, body) => host.api('/files' + path, body);
  const el = host.el;
  const esc = host.esc;
  const fmtBytes = host.fmtBytes;
  const fmtTime = host.fmtTime;
  const relTime = host.relTime;
  const toast = host.toast;

  const BROWSE_RENDER_MAX = 1200;      // 单目录最多渲染多少行（LIST_MAX 是 4000）
  const UNDO_MS = 5000;

  const S = {
    container: null,
    active: false,
    view: 'files',
    path: '',
    home: '',
    sort: 'name', order: 'asc', hidden: false,
    data: null,
    loading: false,
    error: '',
    filter: '',
    selection: new Set(),
    anchor: -1,
    renaming: '', renameValue: '',
    creating: false, createValue: '',
    moving: null,                       // {mode:'move'|'copy', value:''}
    preview: null,                      // {entry, text, binary, truncated, loading, error, url}
    menu: null,
    undo: null,                         // {items:[{from,to}], left, timer}
    batch: null,                        // {title, rows:[{path,ok,error,skipped}]}
    query: '', search: null, searching: false,
    usagePath: '', usage: null, usageBusy: false, usageError: '',
    treemapRects: [], treemapHoverPath: '',
    organizePath: '', organizeMode: 'ext', organize: null, organizePlan: false, organizeBusy: false, organizeError: '',
    trash: null, trashBusy: false, trashError: '',
    ops: null,
    showOps: false,
  };

  let bound = false;
  let resizeBound = false;
  let observer = null;

  /* ------------------------------------------------------------ 工具 */

  function canWrite() { return host.canWrite(); }
  function reason() { return host.readonlyNote(); }
  function lock(node, why) {
    /* 只读模式：按钮禁用 + 说清原因，而不是静默失效。 */
    if (!node) return node;
    if (canWrite()) return node;
    node.disabled = true;
    node.title = why || reason();
    node.classList.add('fsv-locked');
    return node;
  }

  function categories() {
    const grid = {};
    for (const [name, pattern] of CATEGORY_PATTERNS) grid[name] = pattern;
    return grid;
  }
  const EXT_CATEGORY = categories();

  function categoryOf(entry) {
    if (!entry) return 'other';
    if (entry.kind === 'dir') return 'dir';
    if (entry.kind === 'link') return 'link';
    const ext = String(entry.ext || String(entry.name || '').split('.').pop() || '').toLowerCase();
    for (const key of Object.keys(EXT_CATEGORY)) if (EXT_CATEGORY[key].test(ext)) return key;
    return 'other';
  }

  const CATEGORY_LABEL = {
    dir: '文件夹', image: '图片', video: '视频', audio: '音频', code: '代码',
    doc: '文档', archive: '压缩包', link: '链接', other: '其它',
  };
  const CATEGORY_MIX = {
    dir: 'color-mix(in srgb, var(--accent) 88%, var(--text))',
    image: 'color-mix(in srgb, var(--accent) 42%, var(--ok))',
    video: 'color-mix(in srgb, var(--ok) 68%, var(--accent))',
    audio: 'color-mix(in srgb, var(--dim) 52%, var(--accent))',
    code: 'color-mix(in srgb, var(--accent) 72%, var(--text))',
    doc: 'color-mix(in srgb, var(--dim) 62%, var(--ok))',
    archive: 'color-mix(in srgb, var(--err) 46%, var(--dim))',
    link: 'color-mix(in srgb, var(--dim) 70%, var(--accent))',
    other: 'color-mix(in srgb, var(--dim) 58%, var(--border))',
  };

  /* canvas 只认具体颜色：把 CSS 变量/color-mix 解析成 rgb()，这样浅色主题也跟着变。
     用一个隐藏探针元素让浏览器自己算，比在 JS 里手写调色板可靠得多。 */
  let probe = null;
  const colorCache = new Map();
  function resolveColor(css) {
    if (colorCache.has(css)) return colorCache.get(css);
    if (!probe) {
      probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;';
      document.body.appendChild(probe);
    }
    probe.style.color = '';
    probe.style.color = css;
    const value = getComputedStyle(probe).color || 'rgb(128,128,128)';
    colorCache.set(css, value);
    return value;
  }
  function invalidateColors() { colorCache.clear(); }

  function parentOf(target) {
    if (!target) return '';
    const cut = target.replace(/\/+$/, '').lastIndexOf('/');
    if (cut <= 0) return '/';
    return target.slice(0, cut);
  }

  function joinPath(dir, name) {
    if (!dir || dir === '/') return '/' + name;
    return dir.replace(/\/+$/, '') + '/' + name;
  }

  function selectedEntries() {
    const list = currentEntries();
    return list.filter((entry) => S.selection.has(entry.path));
  }

  function currentEntries() {
    if (S.search && S.search.matches) return S.search.matches;
    return (S.data && S.data.entries) || [];
  }

  function fmtSize(entry) {
    if (!entry) return '';
    if (entry.kind === 'dir') return '—';
    return fmtBytes(entry.size);
  }

  function clearSelection() { S.selection.clear(); S.anchor = -1; }

  /* ------------------------------------------------------------ 数据加载 */

  async function listDir(target, options) {
    const path = target || S.path || S.home;
    S.loading = true; S.error = '';
    if (!options || !options.keepSelection) clearSelection();
    render();
    try {
      const data = await api('/list?path=' + encodeURIComponent(path) +
        '&sort=' + encodeURIComponent(S.sort) + '&order=' + encodeURIComponent(S.order) +
        '&hidden=' + (S.hidden ? '1' : '0'));
      S.data = data;
      S.path = data.path;
      S.search = null;
      if (!S.home) S.home = data.path;
    } catch (error) {
      S.error = String((error && error.message) || error);
    }
    S.loading = false;
    render();
  }

  async function boot() {
    try {
      const data = await api('/list?path=' + encodeURIComponent(S.path || '') + '&hidden=' + (S.hidden ? '1' : '0'));
      S.data = data; S.path = data.path; S.home = S.path;
    } catch (error) {
      /* 家目录都读不到时，退回根目录，并把原因留住。 */
      S.error = String((error && error.message) || error);
      try { const root = await api('/list?path=%2F'); S.data = root; S.path = root.path; } catch (_) { /* 留着错误 */ }
    }
    render();
  }

  /* ------------------------------------------------------------ 写操作 */

  function requireWrite() {
    if (canWrite()) return true;
    toast('warn', reason());
    return false;
  }

  async function doMkdir(name) {
    if (!requireWrite()) return;
    if (!name) return;
    try {
      await api('/mkdir', { path: S.path, name });
      toast('ok', '已新建文件夹 ' + name);
      S.creating = false; S.createValue = '';
      await listDir(S.path, { keepSelection: true });
    } catch (error) {
      toast('err', String((error && error.message) || error));
    }
  }

  async function doRename(entry, name) {
    if (!requireWrite()) return;
    S.renaming = ''; S.renameValue = '';
    if (!entry || !name || name === entry.name) { render(); return; }
    try {
      await api('/rename', { path: entry.path, name });
      toast('ok', '已重命名为 ' + name);
      clearSelection();
      await listDir(S.path, { keepSelection: true });
    } catch (error) {
      toast('err', String((error && error.message) || error));
      render();
    }
  }

  /* 批量操作逐项汇报：失败/跳过都要说清原因，绝不吞成一句「完成」。 */
  async function runBatch(title, paths, worker) {
    if (!requireWrite()) return;
    const rows = [];
    for (const path of paths) {
      try {
        const result = await worker(path);
        rows.push({ path, ok: true, note: result || '' });
      } catch (error) {
        rows.push({ path, ok: false, note: String((error && error.message) || error) });
      }
    }
    S.batch = { title, rows };
    const okCount = rows.filter((row) => row.ok).length;
    toast(okCount === rows.length ? 'ok' : 'warn', title + '：成功 ' + okCount + '/' + rows.length);
  }

  async function doTrash(entries) {
    if (!requireWrite()) return;
    if (!entries.length) return;
    const paths = entries.map((entry) => entry.path);
    try {
      const data = await api('/trash', { paths });
      /* 后端把每一项的真实落点回给我们，撤销才可能是精确的。 */
      S.undo = { items: (data.items || []).map((item) => ({ from: item.from, to: item.to })), left: UNDO_MS / 1000 };
      clearSelection();
      await listDir(S.path, { keepSelection: true });
      startUndoTimer();
    } catch (error) {
      toast('err', String((error && error.message) || error));
    }
  }

  function startUndoTimer() {
    if (!S.undo) return;
    if (S.undo.timer) clearInterval(S.undo.timer);
    S.undo.timer = setInterval(() => {
      if (!S.undo) return;
      S.undo.left -= 1;
      if (S.undo.left <= 0) { S.undo = null; }
      renderUndoBar();
    }, 1000);
  }

  async function undoTrash() {
    if (!S.undo) return;
    const items = S.undo.items.slice();
    if (S.undo.timer) clearInterval(S.undo.timer);
    S.undo = null;
    const rows = [];
    for (const item of items) {
      try {
        await api('/restore', { path: item.to });
        rows.push({ path: item.from, ok: true });
      } catch (error) {
        rows.push({ path: item.from, ok: false, note: String((error && error.message) || error) });
      }
    }
    const okCount = rows.filter((row) => row.ok).length;
    S.batch = { title: '撤销删除', rows };
    toast(okCount ? 'ok' : 'err', '已还原 ' + okCount + '/' + rows.length + ' 项');
    if (S.view === 'files-trash') await loadTrash(); else await listDir(S.path, { keepSelection: true });
  }

  async function doPurge(entries, onDone) {
    if (!requireWrite()) return;
    if (!entries.length) return;
    const total = entries.reduce((sum, entry) => sum + (entry.kind === 'dir' ? 0 : Number(entry.size) || 0), 0);
    const ok = await host.askConfirm({
      title: '永久删除 ' + entries.length + ' 项？',
      message: entries.slice(0, 12).map((entry) => '· ' + entry.name).join('\n') +
        (entries.length > 12 ? '\n… 还有 ' + (entries.length - 12) + ' 项' : '') +
        '\n\n这是不可撤销的操作：文件会从磁盘上抹掉，不进废纸篓。' +
        (total ? '\n涉及体积约 ' + fmtBytes(total) + '。' : ''),
      okLabel: '永久删除', danger: true,
    });
    if (!ok) return;
    const rows = [];
    for (const entry of entries) {
      try {
        await api('/purge', { paths: [entry.path], confirm: '永久删除' });
        rows.push({ path: entry.name, ok: true });
      } catch (error) {
        rows.push({ path: entry.name, ok: false, note: String((error && error.message) || error) });
      }
    }
    S.batch = { title: '永久删除', rows };
    toast('warn', '永久删除完成，成功 ' + rows.filter((row) => row.ok).length + '/' + rows.length);
    if (onDone) await onDone();
  }

  async function doMove(mode, entries, to) {
    if (!requireWrite()) return;
    if (!entries.length) return;
    const target = String(to || '').trim();
    if (!target) { toast('warn', '先填目标目录，或用「选择目录」'); return; }
    const rows = [];
    for (const entry of entries) {
      try {
        await api('/move', { paths: [entry.path], to: target, copy: mode === 'copy' });
        rows.push({ path: entry.name, ok: true });
      } catch (error) {
        rows.push({ path: entry.name, ok: false, note: String((error && error.message) || error) });
      }
    }
    S.moving = null;
    S.batch = { title: mode === 'copy' ? '复制' : '移动', rows };
    toast(rows.every((row) => row.ok) ? 'ok' : 'warn', (mode === 'copy' ? '复制' : '移动') + '完成：' + rows.filter((row) => row.ok).length + '/' + rows.length);
    await listDir(S.path, { keepSelection: true });
  }

  async function reveal(target) {
    try { await api('/reveal', { path: target }); }
    catch (error) { toast('err', String((error && error.message) || error)); }
  }

  async function openInFinder(target) {
    /* 文件/目录用 open（等价于双击）；reveal 是「在访达中显示」。 */
    try { await api('/open', { path: target }); }
    catch (error) { toast('err', String((error && error.message) || error)); }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea');
        area.value = text; area.style.position = 'fixed'; area.style.left = '-9999px';
        document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
      }
      toast('ok', '已复制路径');
    } catch (_) { toast('warn', '复制失败：' + text); }
  }

  async function pickDirectory() {
    try {
      const data = await api('/pick');
      if (!data || data.ok === false) { toast('warn', (data && data.error) || '已取消选择'); return ''; }
      return data.path || '';
    } catch (error) {
      toast('warn', String((error && error.message) || error));
      return '';
    }
  }

  /* ------------------------------------------------------------ 搜索 */

  async function runSearch() {
    const query = S.query.trim();
    if (!query) { S.search = null; render(); return; }
    S.searching = true; S.search = null; render();
    try {
      S.search = await api('/search?path=' + encodeURIComponent(S.path) + '&q=' + encodeURIComponent(query) +
        '&recursive=1&limit=300&hidden=' + (S.hidden ? '1' : '0'));
      clearSelection();
    } catch (error) {
      toast('err', String((error && error.message) || error));
    }
    S.searching = false;
    render();
  }

  /* 供 ⌘K 命令面板调用：不改变当前视图，只把结果给出去。 */
  async function searchFiles(query, limit) {
    const data = await api('/search?path=' + encodeURIComponent(S.path || S.home || '/') + '&q=' + encodeURIComponent(query) +
      '&recursive=1&limit=' + (limit || 12));
    return data.matches || [];
  }

  /* ------------------------------------------------------------ 预览 */

  async function preview(entry) {
    if (!entry) return;
    const category = categoryOf(entry);
    const base = { entry, loading: true, text: '', binary: false, truncated: false, error: '', url: '' };
    S.preview = base;
    renderPreview();
    if (entry.kind === 'dir') {
      S.preview = Object.assign(base, { loading: false, text: '这是个文件夹（' + entry.name + '）。按 Enter 进入。' });
      renderPreview();
      return;
    }
    if (category === 'image' || /\.(pdf)$/i.test(entry.name)) {
      S.preview = Object.assign(base, { loading: false, url: '/api/system-panel/files/raw?path=' + encodeURIComponent(entry.path) });
      renderPreview();
      return;
    }
    if (entry.kind === 'link') {
      S.preview = Object.assign(base, { loading: false, text: '符号链接 → ' + (entry.link || '（目标未知）') });
      renderPreview();
      return;
    }
    try {
      const data = await api('/text?path=' + encodeURIComponent(entry.path) + '&max=262144');
      S.preview = Object.assign(base, {
        loading: false, binary: !!data.binary, text: data.text || '', truncated: !!data.truncated,
        bytes: data.bytes,
      });
    } catch (error) {
      S.preview = Object.assign(base, { loading: false, error: String((error && error.message) || error) });
    }
    renderPreview();
  }

  function closePreview() {
    S.preview = null;
    const node = document.getElementById('fsv-preview');
    if (node) node.remove();
  }

  /* ------------------------------------------------------------ 右键菜单 */

  function closeMenu() {
    S.menu = null;
    const node = document.getElementById('fsv-menu');
    if (node) node.remove();
  }

  function openMenu(event, entry) {
    closeMenu();
    event.preventDefault();
    if (entry && !S.selection.has(entry.path)) { S.selection.clear(); S.selection.add(entry.path); }
    const targets = S.selection.size ? selectedEntries() : (entry ? [entry] : []);
    if (!targets.length) return;
    const single = targets.length === 1;
    S.menu = targets;
    const node = document.createElement('div');
    node.id = 'fsv-menu';
    node.className = 'fsv-menu';
    const actions = menuActions(targets, single);
    node.innerHTML = actions.map((action, index) => action.separator
      ? '<div class="fsv-menu-sep"></div>'
      : '<button type="button" class="fsv-menu-item ' + (action.danger ? 'danger' : '') + '" data-menu="' + index + '"' + (action.disabled ? ' disabled title="' + esc(action.why || '') + '"' : '') + '>' +
        '<span>' + esc(action.label) + '</span><em>' + esc(action.hint || '') + '</em></button>').join('');
    document.body.appendChild(node);
    const width = node.offsetWidth, height = node.offsetHeight;
    const x = Math.min(event.clientX, window.innerWidth - width - 8);
    const y = Math.min(event.clientY, window.innerHeight - height - 8);
    node.style.left = Math.max(8, x) + 'px';
    node.style.top = Math.max(8, y) + 'px';
    node.addEventListener('click', (clickEvent) => {
      const button = clickEvent.target.closest('button[data-menu]');
      if (!button) return;
      const action = actions[Number(button.dataset.menu)];
      closeMenu();
      if (action && action.run) action.run();
    });
  }

  function menuActions(targets, single) {
    const one = targets[0];
    const list = [
      { label: '打开', hint: '⏎', run: () => (one.kind === 'dir' ? enterDir(one) : preview(one)) },
      { label: '预览', hint: 'F3 / 空格', run: () => preview(one) },
      { label: '在访达中显示', hint: '⌘⇧R', run: () => reveal(one.path) },
      { label: '用默认程序打开', hint: '⌥⏎', run: () => openInFinder(one.path) },
      { separator: true },
      { label: '复制路径', hint: '⌘C', run: () => copyText(targets.map((item) => item.path).join('\n')) },
      { label: '重命名', hint: 'F2', disabled: !single, why: '一次只能改名一项', run: () => { if (single) startRename(one); } },
      { separator: true },
      { label: '移动到…', hint: 'F6', run: () => { S.moving = { mode: 'move', value: '' }; render(); } },
      { label: '复制到…', hint: 'F5', run: () => { S.moving = { mode: 'copy', value: '' }; render(); } },
      { separator: true },
      { label: '送进废纸篓', hint: 'F8', danger: true, run: () => doTrash(targets) },
    ];
    return list;
  }

  /* ------------------------------------------------------------ 选择 */

  function selectRow(entry, index, event) {
    const additive = !!(event && (event.metaKey || event.ctrlKey));
    const ranged = !!(event && event.shiftKey);
    if (ranged && S.anchor >= 0) {
      const list = currentEntries();
      const [from, to] = S.anchor < index ? [S.anchor, index] : [index, S.anchor];
      if (!additive) S.selection.clear();
      for (let i = from; i <= to; i += 1) if (list[i]) S.selection.add(list[i].path);
    } else if (additive) {
      if (S.selection.has(entry.path)) S.selection.delete(entry.path); else S.selection.add(entry.path);
      S.anchor = index;
    } else {
      const only = S.selection.size === 1 && S.selection.has(entry.path);
      S.selection.clear();
      if (!only) S.selection.add(entry.path);
      S.anchor = index;
    }
    render();
  }

  function selectAll() {
    const list = currentEntries();
    S.selection = new Set(list.map((entry) => entry.path));
    render();
  }

  function enterDir(entry) {
    S.search = null; S.query = '';
    listDir(entry.path);
  }

  function startRename(entry) {
    if (!canWrite()) { toast('warn', reason()); return; }
    S.renaming = entry.path;
    S.renameValue = entry.name;
    render();
    const input = S.container && S.container.querySelector('.fsv-rename');
    if (input) { input.focus(); input.select(); }
  }

  /* ------------------------------------------------------------ 占用分析 */

  async function scanUsage(target) {
    const path = String(target == null ? S.usagePath : target).trim();
    if (!path) { toast('warn', '先填一个要分析的目录'); return; }
    S.usagePath = path;
    S.usageBusy = true; S.usageError = ''; S.usage = null; render();
    try {
      S.usage = await api('/usage?path=' + encodeURIComponent(path));
    } catch (error) {
      S.usageError = String((error && error.message) || error);
    }
    S.usageBusy = false;
    render();
    const canvas = S.container && S.container.querySelector('.fsv-treemap');
    if (canvas && S.usage) drawTreemap(canvas, S.usage.items || []);
  }

  /* squarified treemap：面积 = 大小，颜色 = 类型，嵌套 = 目录结构（下钻）。
     约 60 行，换来一屏看清「谁大」，比环形图省一半力气还没有角度标注难题。 */
  function squarify(children, x, y, w, h) {
    const out = [];
    const items = children.slice().sort((a, b) => b.value - a.value);
    const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
    const scale = (w * h) / total;
    const areas = items.map((item) => ({ item, area: item.value * scale }));
    let rx = x, ry = y, rw = w, rh = h;
    let index = 0;
    const worst = (row, side) => {
      const sum = row.reduce((acc, value) => acc + value, 0);
      if (sum <= 0) return Infinity;
      const max = Math.max.apply(null, row);
      const min = Math.min.apply(null, row);
      if (min <= 0) return Infinity;
      return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
    };
    while (index < areas.length) {
      const vertical = rw >= rh;
      const side = Math.max(1, vertical ? rh : rw);
      const row = [];
      while (index < areas.length) {
        const candidate = row.concat([areas[index].area]);
        if (!row.length || worst(candidate, side) <= worst(row, side)) { row.push(areas[index].area); index += 1; }
        else break;
      }
      const sum = row.reduce((acc, value) => acc + value, 0);
      const thickness = sum / side;
      if (!(thickness > 0)) break;
      const startIndex = index - row.length;
      if (vertical) {
        let oy = ry;
        for (let k = 0; k < row.length; k += 1) {
          const length = row[k] / thickness;
          out.push({ item: areas[startIndex + k].item, x: rx, y: oy, w: thickness, h: length });
          oy += length;
        }
        rx += thickness; rw -= thickness;
      } else {
        let ox = rx;
        for (let k = 0; k < row.length; k += 1) {
          const length = row[k] / thickness;
          out.push({ item: areas[startIndex + k].item, x: ox, y: ry, w: length, h: thickness });
          ox += length;
        }
        ry += thickness; rh -= thickness;
      }
      if (rw < 1 || rh < 1) break;
    }
    return out;
  }

  function drawTreemap(canvas, items) {
    if (!canvas) return;
    const width = Math.max(120, Math.round(canvas.clientWidth || canvas.parentNode.clientWidth || 320));
    const height = Math.max(120, Math.round(canvas.clientHeight || 220));
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const background = resolveColor('var(--panel2)');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    const rows = (items || []).filter((item) => Number(item.size) > 0);
    if (!rows.length) {
      ctx.fillStyle = resolveColor('var(--dim)');
      ctx.font = '12px ' + (resolveColor('var(--mono)') ? 'inherit' : 'inherit');
      ctx.fillText('没有可展示的占用数据（可能全为空目录或没有权限）', 10, 22);
      S.treemapRects = [];
      return;
    }
    const rects = squarify(rows.map((item) => ({ value: Number(item.size) || 0, item })), 0, 0, width, height);
    S.treemapRects = rects;
    const textColor = resolveColor('var(--text)');
    const dimColor = resolveColor('var(--dim)');
    for (const rect of rects) {
      const category = categoryOf({ kind: rect.item.kind, name: rect.item.name });
      const fill = resolveColor(CATEGORY_MIX[category] || CATEGORY_MIX.other);
      ctx.globalAlpha = rect.item.path === S.treemapHoverPath ? 1 : 0.86;
      ctx.fillStyle = fill;
      ctx.fillRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.w - 1), Math.max(0, rect.h - 1));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = background;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.w - 1), Math.max(0, rect.h - 1));
      if (rect.w > 54 && rect.h > 26) {
        ctx.fillStyle = textColor;
        ctx.font = '600 11px -apple-system,"PingFang SC",sans-serif';
        const label = rect.item.name.length > Math.floor(rect.w / 7) ? rect.item.name.slice(0, Math.max(3, Math.floor(rect.w / 7) - 1)) + '…' : rect.item.name;
        ctx.fillText(label, rect.x + 5, rect.y + 15);
        if (rect.h > 40) {
          ctx.fillStyle = dimColor;
          ctx.font = '10px "SF Mono",Menlo,monospace';
          ctx.fillText(fmtBytes(rect.item.size), rect.x + 5, rect.y + 28);
        }
      }
    }
  }

  function treemapHit(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (let i = S.treemapRects.length - 1; i >= 0; i -= 1) {
      const cell = S.treemapRects[i];
      if (x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h) return cell;
    }
    return null;
  }

  /* 右键 treemap = 在列表里定位（两份数据同源，索引直接对得上）。 */
  function locateInList(path) {
    const row = S.container && S.container.querySelector('[data-row-path="' + (window.CSS && CSS.escape ? CSS.escape(path) : path) + '"]');
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('fsv-flash');
    setTimeout(() => row.classList.remove('fsv-flash'), 1400);
  }

  /* ------------------------------------------------------------ 回收站 */

  async function loadTrash() {
    S.trashBusy = true; S.trashError = ''; render();
    try {
      S.trash = await api('/trash');
      if (S.showOps) await loadOps();
    } catch (error) {
      S.trashError = String((error && error.message) || error);
    }
    S.trashBusy = false;
    render();
  }

  async function loadOps() {
    try { const data = await api('/ops'); S.ops = data.operations || []; }
    catch (_) { S.ops = []; }
  }

  async function restoreTrash(entry, to) {
    if (!requireWrite()) return;
    try {
      const data = await api('/restore', to ? { path: entry.path, to } : { path: entry.path });
      toast('ok', '已还原到 ' + data.path);
      await loadTrash();
    } catch (error) {
      toast('err', String((error && error.message) || error));
    }
  }

  /* ------------------------------------------------------------ 渲染 */

  function render() {
    if (!S.container || !S.container.isConnected) return;
    S.container.innerHTML = '';
    const wrap = el('div', 'fsv-root');
    if (!bound) { bindGlobal(); bound = true; }
    if (S.view === 'files') wrap.appendChild(viewBrowse());
    else if (S.view === 'files-usage') wrap.appendChild(viewUsage());
    else if (S.view === 'files-organize') wrap.appendChild(viewOrganize());
    else wrap.appendChild(viewTrash());
    if (S.batch) wrap.appendChild(batchPanel());
    S.container.appendChild(wrap);
    if (S.view === 'files') renderUndoBar();
    if (S.view === 'files-usage' && S.usage) {
      const canvas = wrap.querySelector('.fsv-treemap');
      if (canvas) requestAnimationFrame(() => drawTreemap(canvas, S.usage.items || []));
    }
    if (S.preview) renderPreview();
  }

  /* 这里原本还有一行自己的标签（浏览 / 占用分析 / 整理 / 回收站），
     和外层「文件」分区的子导航（文件浏览 / 空间分析 / 整理归类 / 回收站）完全重复 ——
     同一页出现两排标签、名字还不一样，谁都会看懵。已删掉，统一走外层子导航。 */
  function setView(view) {
    if (S.view === view) return;
    closePreview(); closeMenu();
    S.view = view;
    if (view === 'files-trash' && !S.trash) { render(); loadTrash(); return; }
    if (view === 'files-usage' && !S.usage && !S.usageBusy) { S.usagePath = S.usagePath || S.path || S.home; }
    if (view === 'files-organize' && !S.organizePath) S.organizePath = S.path || S.home;
    render();
  }

  function toolbar() {
    const bar = el('div', 'fsv-toolbar');
    const back = el('button', 'sp-btn', '↑ 上级');
    back.type = 'button';
    back.title = '回到上一级 (⌘↑)';
    back.disabled = !(S.data && S.data.parent);
    back.onclick = () => { if (S.data && S.data.parent) listDir(S.data.parent); };
    bar.appendChild(back);

    const mkdir = el('button', 'sp-btn', '＋ 新建文件夹');
    mkdir.type = 'button';
    mkdir.title = '在当前目录新建文件夹 (F7)';
    mkdir.onclick = () => { if (!canWrite()) { toast('warn', reason()); return; } S.creating = true; S.createValue = ''; render(); focusCreate(); };
    lock(mkdir);
    bar.appendChild(mkdir);

    const uploadLabel = el('label', 'sp-btn fsv-upload', '⇧ 上传');
    uploadLabel.title = '把文件复制到这个目录 (⌘U)';
    const upload = document.createElement('input');
    upload.type = 'file'; upload.multiple = true; upload.style.display = 'none';
    upload.onchange = () => { uploadFiles(Array.from(upload.files || [])); upload.value = ''; };
    uploadLabel.appendChild(upload);
    if (!canWrite()) { uploadLabel.classList.add('fsv-locked'); uploadLabel.title = reason(); uploadLabel.onclick = (event) => { event.preventDefault(); toast('warn', reason()); }; }
    bar.appendChild(uploadLabel);

    const refresh = el('button', 'sp-btn', '↻ 刷新');
    refresh.type = 'button';
    refresh.title = '重新读取当前目录 (⌘R)';
    refresh.onclick = () => listDir(S.path, { keepSelection: true });
    bar.appendChild(refresh);

    const spacer = el('span', 'grow');
    bar.appendChild(spacer);

    const filter = document.createElement('input');
    filter.className = 'sp-input fsv-filter';
    filter.placeholder = '在本目录内过滤…';
    filter.value = S.filter;
    filter.oninput = () => { S.filter = filter.value; renderRowsOnly(); };
    bar.appendChild(filter);

    const search = document.createElement('input');
    search.className = 'sp-input fsv-search';
    search.placeholder = '递归搜索（按 / 聚焦）';
    search.value = S.query;
    search.oninput = () => { S.query = search.value; };
    search.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); runSearch(); } };
    bar.appendChild(search);

    const searchButton = el('button', 'sp-btn', '搜索');
    searchButton.type = 'button';
    searchButton.onclick = () => runSearch();
    bar.appendChild(searchButton);

    const hidden = el('label', 'fsv-switch');
    hidden.title = '显示 / 隐藏以 . 开头的文件 (⌘⇧.)';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = S.hidden;
    box.onchange = () => { S.hidden = box.checked; listDir(S.path, { keepSelection: true }); };
    hidden.appendChild(box);
    hidden.appendChild(el('span', null, '隐藏文件'));
    bar.appendChild(hidden);
    return bar;
  }

  function focusCreate() {
    const input = S.container && S.container.querySelector('.fsv-create');
    if (input) input.focus();
  }

  function crumbs() {
    const bar = el('div', 'fsv-crumbs');
    const crumbs = (S.data && S.data.crumbs) || [{ name: '（读取中）', path: S.path }];
    crumbs.forEach((crumb, index) => {
      const button = el('button', 'fsv-crumb' + (index === crumbs.length - 1 ? ' on' : ''), crumb.name);
      button.type = 'button';
      button.title = crumb.path;
      button.onclick = () => listDir(crumb.path);
      bar.appendChild(button);
      if (index < crumbs.length - 1) bar.appendChild(el('span', 'fsv-crumb-sep', '›'));
    });
    /* 点空白处（或 ⌘L）把面包屑换成路径输入框：比一路点回去快得多。 */
    const blank = el('button', 'fsv-crumb-blank', '按 ⌘L 或点这里输入路径');
    blank.type = 'button';
    blank.onclick = () => editPath(bar);
    bar.appendChild(blank);
    return bar;
  }

  function editPath(bar) {
    bar.innerHTML = '';
    const input = document.createElement('input');
    input.className = 'sp-input fsv-path';
    input.value = S.path;
    bar.appendChild(input);
    const go = el('button', 'sp-btn primary', '跳转');
    go.type = 'button';
    go.onclick = () => listDir(input.value.trim());
    bar.appendChild(go);
    const pick = el('button', 'sp-btn', '选择…');
    pick.type = 'button';
    pick.onclick = async () => { const chosen = await pickDirectory(); if (chosen) listDir(chosen); };
    bar.appendChild(pick);
    input.focus(); input.select();
    input.onkeydown = (event) => {
      if (event.key === 'Enter') { event.preventDefault(); listDir(input.value.trim()); }
      if (event.key === 'Escape') { event.preventDefault(); render(); }
    };
  }

  function enterPathEdit() {
    const bar = S.container && S.container.querySelector('.fsv-crumbs');
    if (bar) editPath(bar);
  }

  function sortHeader(label, key, extraClass) {
    const active = S.sort === key;
    const arrow = active ? (S.order === 'asc' ? ' ▲' : ' ▼') : '';
    const th = el('th', (extraClass || '') + (active ? ' on' : ''), label + arrow);
    th.title = '按' + label + '排序（点击升降序切换）';
    th.style.cursor = 'pointer';
    th.onclick = () => {
      if (S.sort === key) S.order = S.order === 'asc' ? 'desc' : 'asc';
      else { S.sort = key; S.order = 'asc'; }
      listDir(S.path, { keepSelection: true });
    };
    return th;
  }

  function viewBrowse() {
    const wrap = el('div', 'fsv-view');
    wrap.appendChild(toolbar());
    wrap.appendChild(crumbs());

    if (S.moving) wrap.appendChild(moveBar());
    if (S.search) wrap.appendChild(searchSummary());

    if (S.searching) { wrap.appendChild(el('div', 'sp-empty', '正在递归搜索…')); return wrap; }
    if (S.loading) { wrap.appendChild(el('div', 'sp-empty', '正在读取目录…')); return wrap; }
    if (S.error) {
      const band = el('div', 'sp-band');
      band.innerHTML = '<h3 class="sp-warn">读不到这个目录</h3><p class="sp-note">' + esc(S.error) + '</p>';
      const back = el('button', 'sp-btn', '回到 ' + (S.home || '/'));
      back.type = 'button';
      back.onclick = () => listDir(S.home || '/');
      band.appendChild(back);
      wrap.appendChild(band);
      return wrap;
    }
    wrap.appendChild(fileTable());
    if (S.selection.size) wrap.appendChild(selectionBar());
    const stats = el('div', 'fsv-stats');
    const data = S.data || {};
    const fs = data.fs || {};
    if (S.search) {
      stats.textContent = '命中 ' + (S.search.matches || []).length + ' 项 · 扫描 ' + S.search.scanned + ' 个条目 · 用时 ' + S.search.ms + 'ms' +
        (S.search.truncated ? ' · 已达上限，结果被截断（缩小目录或加更具体的关键词）' : '');
    } else {
      stats.textContent = data.dirs + ' 个文件夹 · ' + data.files + ' 个文件 · 合计 ' + fmtBytes(data.bytes) +
        (data.truncated ? ' · 目录太大，只列出了前 ' + (data.entries || []).length + ' 项（共 ' + data.total + '）' : '') +
        (fs.total ? ' · 所在卷剩余 ' + fmtBytes(fs.free) + ' / ' + fmtBytes(fs.total) : '');
    }
    if (data.hidden) stats.appendChild(el('span', 'muted', '　· 隐藏文件已隐藏（但它们仍占用磁盘；用上面的开关显示）'));
    wrap.appendChild(stats);
    return wrap;
  }

  function searchSummary() {
    const band = el('div', 'sp-band fsv-searchband');
    band.innerHTML = '<h3>搜索结果' + (S.search ? '（' + (S.search.matches || []).length + '）' : '') + '</h3>' +
      '<p class="sp-note">在 <code>' + esc(S.path) + '</code> 下递归查找 <b>' + esc(S.query) + '</b>' +
      (S.search ? '：扫描 ' + S.search.scanned + ' 个条目，用时 ' + S.search.ms + 'ms' + (S.search.truncated ? '，<span class="sp-warn">结果被截断</span>' : '') : '') + '</p>';
    const back = el('button', 'sp-btn', '退出搜索，回到目录');
    back.type = 'button';
    back.onclick = () => { S.search = null; S.query = ''; listDir(S.data ? S.data.path : S.path); };
    band.appendChild(back);
    return band;
  }

  function moveBar() {
    const band = el('div', 'sp-band fsv-movebar');
    const mode = S.moving.mode;
    band.innerHTML = '<h3>' + (mode === 'copy' ? '复制' : '移动') + ' ' + S.selection.size + ' 项到…</h3>';
    const row = el('div', 'sp-actions');
    const input = document.createElement('input');
    input.className = 'sp-input fsv-move-target';
    input.placeholder = '目标目录的绝对路径，如 /Users/you/Documents';
    input.value = S.moving.value;
    input.oninput = () => { S.moving.value = input.value; };
    row.appendChild(input);
    const pick = el('button', 'sp-btn', '选择目录…');
    pick.type = 'button';
    pick.onclick = async () => { const chosen = await pickDirectory(); if (chosen) { S.moving.value = chosen; render(); } };
    row.appendChild(pick);
    const go = el('button', 'sp-btn primary', mode === 'copy' ? '复制过去' : '移动过去');
    go.type = 'button';
    go.onclick = () => doMove(mode, selectedEntries(), S.moving.value);
    lock(go);
    row.appendChild(go);
    const cancel = el('button', 'sp-btn', '取消');
    cancel.type = 'button';
    cancel.onclick = () => { S.moving = null; render(); };
    row.appendChild(cancel);
    band.appendChild(row);
    band.appendChild(el('p', 'sp-note', '同名文件会自动改名（加 (2)），不会覆盖；跨磁盘的「移动」会被拒绝，请改用「复制」。'));
    return band;
  }

  function fileTable() {
    const table = el('table', 'sp-table fsv-table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(el('th', 'fsv-checkcol'));
    headRow.appendChild(sortHeader('名称', 'name'));
    headRow.appendChild(sortHeader('大小', 'size', 'num'));
    headRow.appendChild(sortHeader('修改时间', 'mtime'));
    headRow.appendChild(sortHeader('类型', 'kind'));
    headRow.appendChild(el('th', 'fsv-actcol'));
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    body.className = 'fsv-tbody';
    if (S.creating) body.appendChild(createRow());
    const list = visibleEntries();
    for (let index = 0; index < list.length; index += 1) body.appendChild(fileRow(list[index], index));
    if (!list.length && !S.creating) {
      const row = document.createElement('tr');
      const cell = el('td', 'sp-empty', S.filter ? '没有匹配「' + S.filter + '」的项' : '这个目录是空的');
      cell.colSpan = 6;
      row.appendChild(cell);
      body.appendChild(row);
    }
    table.appendChild(body);
    return table;
  }

  function visibleEntries() {
    const list = currentEntries();
    const filter = S.filter.trim().toLowerCase();
    const filtered = filter ? list.filter((entry) => entry.name.toLowerCase().includes(filter)) : list;
    return filtered.slice(0, BROWSE_RENDER_MAX);
  }

  function createRow() {
    const row = el('tr', 'fsv-createrow');
    const cell = el('td');
    cell.colSpan = 2;
    const input = document.createElement('input');
    input.className = 'sp-input fsv-create';
    input.placeholder = '新文件夹名称，Enter 创建，Esc 取消';
    input.value = S.createValue;
    input.oninput = () => { S.createValue = input.value; };
    input.onkeydown = (event) => {
      if (event.key === 'Enter') { event.preventDefault(); doMkdir(input.value.trim()); }
      if (event.key === 'Escape') { event.preventDefault(); S.creating = false; S.createValue = ''; render(); }
    };
    cell.appendChild(input);
    row.appendChild(cell);
    const rest = el('td', 'muted', 'Enter 创建 · Esc 取消');
    rest.colSpan = 4;
    row.appendChild(rest);
    return row;
  }

  function fileRow(entry, index) {
    const row = el('tr', 'fsv-row');
    row.dataset.rowPath = entry.path;
    row.dataset.index = String(index);
    if (S.selection.has(entry.path)) row.classList.add('sel');
    if (S.renaming === entry.path) row.classList.add('renaming');

    const check = el('td', 'fsv-checkcol');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = S.selection.has(entry.path);
    box.onclick = (event) => { event.stopPropagation(); selectRow(entry, index, event); };
    check.appendChild(box);
    row.appendChild(check);

    const nameCell = el('td', 'fsv-name');
    if (S.renaming === entry.path) {
      const input = document.createElement('input');
      input.className = 'sp-input fsv-rename';
      input.value = S.renameValue;
      input.oninput = () => { S.renameValue = input.value; };
      input.onkeydown = (event) => {
        if (event.key === 'Enter') { event.preventDefault(); doRename(entry, input.value.trim()); }
        if (event.key === 'Escape') { event.preventDefault(); S.renaming = ''; S.renameValue = ''; render(); }
        event.stopPropagation();
      };
      input.onblur = () => { if (S.renaming === entry.path) doRename(entry, input.value.trim()); };
      nameCell.appendChild(input);
    } else {
      const icon = el('span', 'fsv-icon fsv-icon-' + categoryOf(entry), entry.kind === 'dir' ? '▸' : '·');
      icon.title = CATEGORY_LABEL[categoryOf(entry)] || '文件';
      nameCell.appendChild(icon);
      nameCell.appendChild(el('span', 'fsv-name-text', entry.name));
      if (entry.kind === 'link') nameCell.appendChild(el('span', 'muted fsv-link', '→ ' + (entry.link || '')));
    }
    row.appendChild(nameCell);

    row.appendChild(el('td', 'num', fmtSize(entry)));
    row.appendChild(el('td', 'muted', fmtTime(entry.mtime) + '　' + relTime(entry.mtime)));
    row.appendChild(el('td', 'muted', (CATEGORY_LABEL[categoryOf(entry)] || '') + (entry.kind === 'file' && entry.ext ? ' · ' + entry.ext : '') + (entry.mode ? ' · ' + entry.mode : '')));

    const actions = el('td', 'fsv-actcol');
    const previewButton = el('button', 'sp-btn', '预览');
    previewButton.type = 'button';
    previewButton.title = '空格 / F3';
    previewButton.onclick = (event) => { event.stopPropagation(); preview(entry); };
    actions.appendChild(previewButton);
    row.appendChild(actions);

    row.onclick = (event) => { if (event.target.closest('input')) return; selectRow(entry, index, event); };
    row.ondblclick = () => { if (entry.kind === 'dir') enterDir(entry); else preview(entry); };
    row.oncontextmenu = (event) => openMenu(event, entry);
    return row;
  }

  function renderRowsOnly() {
    /* 过滤时不整页重绘，避免搜索框失焦。 */
    const table = S.container && S.container.querySelector('.fsv-table');
    if (!table) { render(); return; }
    const body = table.querySelector('tbody');
    body.innerHTML = '';
    const list = visibleEntries();
    for (let index = 0; index < list.length; index += 1) body.appendChild(fileRow(list[index], index));
    if (!list.length) {
      const row = el('tr');
      const cell = el('td', 'sp-empty', '没有匹配「' + S.filter + '」的项');
      cell.colSpan = 6;
      row.appendChild(cell);
      body.appendChild(row);
    }
    const stats = S.container.querySelector('.fsv-stats');
    if (stats && S.filter) stats.dataset.filtered = String(list.length);
  }

  function renderUndoBar() {
    const old = document.getElementById('fsv-undo');
    if (old) old.remove();
    if (!S.undo || !S.container || !S.container.isConnected) return;
    const bar = el('div', 'fsv-undo');
    bar.id = 'fsv-undo';
    bar.innerHTML = '<span>已把 ' + S.undo.items.length + ' 项送进废纸篓</span>';
    const undo = el('button', 'sp-btn primary', '撤销（' + Math.max(0, S.undo.left) + 's）');
    undo.type = 'button';
    undo.onclick = () => undoTrash();
    bar.appendChild(undo);
    const where = el('button', 'sp-btn', '看回收站');
    where.type = 'button';
    where.onclick = () => setView('files-trash');
    bar.appendChild(where);
    S.container.appendChild(bar);
  }

  function batchPanel() {
    const band = el('div', 'sp-band fsv-batch');
    const okCount = S.batch.rows.filter((row) => row.ok).length;
    const head = el('div', 'fsv-batch-head');
    head.appendChild(el('h3', null, S.batch.title + '：成功 ' + okCount + ' / ' + S.batch.rows.length));
    const close = el('button', 'sp-btn', '关闭');
    close.type = 'button';
    close.onclick = () => { S.batch = null; render(); };
    head.appendChild(close);
    band.appendChild(head);
    const list = el('div', 'fsv-batch-list');
    for (const row of S.batch.rows) {
      const line = el('div', 'fsv-batch-row ' + (row.ok ? 'ok' : 'bad'));
      line.appendChild(el('span', 'fsv-batch-mark', row.ok ? '✓ 成功' : '✗ 失败'));
      line.appendChild(el('span', 'grow mono', row.path));
      line.appendChild(el('span', 'muted', row.note || ''));
      list.appendChild(line);
    }
    band.appendChild(list);
    return band;
  }

  function selectionBar() {
    const bar = el('div', 'fsv-selbar');
    const entries = selectedEntries();
    const total = entries.reduce((sum, entry) => sum + (entry.kind === 'dir' ? 0 : Number(entry.size) || 0), 0);
    bar.appendChild(el('span', 'fsv-selcount', '已选 ' + entries.length + ' 项' + (total ? ' · ' + fmtBytes(total) : '')));
    const add = (label, hint, handler, options) => {
      const button = el('button', 'sp-btn' + (options && options.danger ? ' danger' : ''), label);
      button.type = 'button';
      if (hint) button.title = hint;
      button.onclick = handler;
      if (options && options.locked) lock(button);
      bar.appendChild(button);
    };
    add('移动…', 'F6', () => { S.moving = { mode: 'move', value: '' }; render(); });
    add('复制…', 'F5', () => { S.moving = { mode: 'copy', value: '' }; render(); });
    add('复制路径', '⌘C', () => copyText(entries.map((entry) => entry.path).join('\n')));
    add('在访达中显示', '⌘⇧R', () => reveal(entries[0].path));
    if (S.view === 'files-trash') add('永久删除', '⇧F8', () => doPurge(entries, loadTrash), { danger: true });
    else add('送进废纸篓', 'F8', () => doTrash(entries), { danger: true });
    bar.appendChild(el('span', 'grow'));
    add('全选', '⌘A', () => selectAll());
    add('取消选择', 'Esc', () => { clearSelection(); render(); });
    return bar;
  }

  function viewUsage() {
    const wrap = el('div', 'fsv-view');
    const bar = el('div', 'fsv-toolbar');
    const input = document.createElement('input');
    input.className = 'sp-input fsv-usage-path';
    input.value = S.usagePath || S.path || S.home;
    input.placeholder = '要分析的目录（绝对路径）';
    input.oninput = () => { S.usagePath = input.value; };
    input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); scanUsage(); } };
    bar.appendChild(input);
    const pick = el('button', 'sp-btn', '选择目录…');
    pick.type = 'button';
    pick.onclick = async () => { const chosen = await pickDirectory(); if (chosen) { S.usagePath = chosen; render(); scanUsage(chosen); } };
    bar.appendChild(pick);
    const scan = el('button', 'sp-btn primary', S.usageBusy ? '正在实测…' : '开始分析');
    scan.type = 'button';
    scan.disabled = S.usageBusy;
    scan.onclick = () => scanUsage();
    bar.appendChild(scan);
    wrap.appendChild(bar);

    if (S.usageBusy) {
      wrap.appendChild(el('div', 'sp-empty', '正在用 du 实测每个子目录（目录越大越慢，属正常）…'));
    }
    if (S.usageError) {
      const band = el('div', 'sp-band');
      band.innerHTML = '<h3 class="sp-warn">分析失败</h3><p class="sp-note">' + esc(S.usageError) + '</p>';
      wrap.appendChild(band);
    }
    if (!S.usage) {
      if (!S.usageBusy && !S.usageError) wrap.appendChild(el('div', 'sp-empty', '选一个目录开始分析：会实测它的一级子项占用，并画出面积图。'));
      return wrap;
    }
    const data = S.usage;
    const summary = el('div', 'sp-band');
    summary.innerHTML = '<h3>占用合计 ' + fmtBytes(data.total) + '　<span class="muted">' + esc(data.path) + '</span></h3>' +
      '<p class="sp-note">实测了 <b>' + data.measured + '</b> / ' + data.children + ' 个子项，用时 ' + (data.ms / 1000).toFixed(1) + 's' +
      (data.skipped > 0 ? '；<b class="sp-warn">还有 ' + data.skipped + ' 个子项没有实测</b>，所以上面的合计只覆盖已实测部分，真实占用会比它更大' : '') +
      (data.fs && data.fs.total ? '；所在卷剩余 ' + fmtBytes(data.fs.free) + ' / ' + fmtBytes(data.fs.total) : '') + '</p>';
    wrap.appendChild(summary);

    const cols = el('div', 'fsv-usage-cols');
    const listBand = el('div', 'sp-band fsv-usage-list');
    listBand.appendChild(el('h3', null, '按占用排序（主力视图，可键盘选取）'));
    const list = el('div', 'sp-list');
    for (const item of data.items) {
      const line = el('div', 'sp-li fsv-usage-row');
      line.dataset.rowPath = item.path;
      const isDir = item.kind === 'dir';
      const name = el('span', 'grow', (isDir ? '▸ ' : '· ') + item.name);
      name.title = item.path;
      line.appendChild(name);
      const barWrap = el('span', 'barwrap');
      const barNode = el('span', 'sp-bar ' + (item.share > 0.5 ? 'crit' : item.share > 0.2 ? 'warn' : 'ok'));
      const inner = document.createElement('i');
      inner.style.width = Math.max(1, Math.min(100, item.share * 100)).toFixed(1) + '%';
      barNode.appendChild(inner);
      barNode.title = (item.share * 100).toFixed(1) + '%';
      barWrap.appendChild(barNode);
      line.appendChild(barWrap);
      const size = el('span', 'num mono fsv-usage-size', fmtBytes(item.size));
      line.appendChild(size);
      const ratio = el('span', 'muted fsv-usage-share', (item.share * 100).toFixed(1) + '%');
      line.appendChild(ratio);
      if (isDir) {
        const drill = el('button', 'sp-btn', '下钻');
        drill.type = 'button';
        drill.title = '分析这个子目录';
        drill.onclick = () => { S.usagePath = item.path; render(); scanUsage(item.path); };
        line.appendChild(drill);
      }
      line.onmouseenter = () => { S.treemapHoverPath = item.path; redrawTreemap(); };
      line.onmouseleave = () => { S.treemapHoverPath = ''; redrawTreemap(); };
      list.appendChild(line);
    }
    if (!data.items.length) list.appendChild(el('div', 'sp-empty', '这个目录的一级子项没有可实测的占用'));
    listBand.appendChild(list);
    cols.appendChild(listBand);

    const mapBand = el('div', 'sp-band fsv-usage-map');
    mapBand.appendChild(el('h3', null, '面积图（补充视图：面积=大小，颜色=类型）'));
    const canvas = document.createElement('canvas');
    canvas.className = 'fsv-treemap';
    canvas.style.width = '100%';
    canvas.style.height = '260px';
    mapBand.appendChild(canvas);
    const tip = el('div', 'fsv-tip');
    tip.hidden = true;
    mapBand.appendChild(tip);
    mapBand.appendChild(el('p', 'sp-note', '悬停看明细 · 单击下钻 · 右键在左侧列表里定位。颜色：' +
      Object.keys(CATEGORY_LABEL).map((key) => CATEGORY_LABEL[key]).join(' / ')));
    canvas.onmousemove = (event) => {
      const cell = treemapHit(canvas, event);
      if (!cell) { tip.hidden = true; if (S.treemapHoverPath) { S.treemapHoverPath = ''; redrawTreemap(); } return; }
      S.treemapHoverPath = cell.item.path;
      tip.hidden = false;
      tip.textContent = cell.item.name + ' · ' + fmtBytes(cell.item.size) + ' · ' + ((cell.item.share || 0) * 100).toFixed(1) + '%';
      tip.style.left = Math.min(event.clientX - canvas.getBoundingClientRect().left + 8, Math.max(0, canvas.clientWidth - 200)) + 'px';
      tip.style.top = (event.clientY - canvas.getBoundingClientRect().top + 8) + 'px';
      redrawTreemap();
    };
    canvas.onmouseleave = () => { tip.hidden = true; S.treemapHoverPath = ''; redrawTreemap(); };
    canvas.onclick = (event) => {
      const cell = treemapHit(canvas, event);
      if (!cell) return;
      if (cell.item.kind === 'dir') { S.usagePath = cell.item.path; render(); scanUsage(cell.item.path); }
      else { locateInList(cell.item.path); }
    };
    canvas.oncontextmenu = (event) => {
      const cell = treemapHit(canvas, event);
      if (!cell) return;
      event.preventDefault();
      locateInList(cell.item.path);
    };
    cols.appendChild(mapBand);
    wrap.appendChild(cols);
    return wrap;
  }

  function redrawTreemap() {
    const canvas = S.container && S.container.querySelector('.fsv-treemap');
    if (canvas && S.usage) drawTreemap(canvas, S.usage.items || []);
  }

  function viewTrash() {
    const wrap = el('div', 'fsv-view');
    const bar = el('div', 'fsv-toolbar');
    const refresh = el('button', 'sp-btn', '↻ 刷新');
    refresh.type = 'button';
    refresh.onclick = () => loadTrash();
    bar.appendChild(refresh);
    const finder = el('button', 'sp-btn', '在访达中打开废纸篓');
    finder.type = 'button';
    finder.title = '面板看不到其它 App 删的东西时，用访达兜底';
    finder.onclick = async () => {
      const target = (S.trash && S.trash.path) || '';
      if (!target) { toast('warn', '还没读到废纸篓路径'); return; }
      try { await api('/open', { path: target }); toast('ok', '已让访达打开废纸篓'); }
      catch (error) { toast('err', String((error && error.message) || error)); }
    };
    bar.appendChild(finder);
    const ops = el('button', 'sp-btn', S.showOps ? '隐藏操作日志' : '显示操作日志');
    ops.type = 'button';
    ops.onclick = async () => { S.showOps = !S.showOps; if (S.showOps && !S.ops) await loadOps(); render(); };
    bar.appendChild(ops);
    wrap.appendChild(bar);

    if (S.trashBusy && !S.trash) { wrap.appendChild(el('div', 'sp-empty', '正在读取回收站…')); return wrap; }
    if (S.trashError) {
      const band = el('div', 'sp-band');
      band.innerHTML = '<h3 class="sp-warn">读不到回收站</h3><p class="sp-note">' + esc(S.trashError) + '</p>';
      wrap.appendChild(band);
      return wrap;
    }
    const data = S.trash || { items: [], total: 0, restorable: 0, tracked: 0, canScan: true, scannedCount: 0, scanError: '' };

    /* 重要：macOS 不允许列 ~/.Trash（EPERM）。必须把这句话原样告诉用户，
       否则「回收站只有 0 项」会被当成面板坏了。 */
    if (data.canScan === false) {
      const warn = el('div', 'sp-band fsv-trashwarn');
      warn.innerHTML = '<h3 class="sp-warn">看不到完整的废纸篓</h3>' +
        '<p class="sp-note">' + esc(data.scanError || 'macOS 不允许面板读取废纸篓目录') + '</p>' +
        '<p class="sp-note">所以下面列的是<b>本面板删除过、并且还留在废纸篓里</b>的项目（每一条都能显示原位置、也能一键还原）。' +
        '用其它方式删除的文件请点上面的「在访达中打开废纸篓」。</p>';
      wrap.appendChild(warn);
    }
    const summary = el('div', 'sp-band');
    summary.innerHTML = '<h3>本面板删除的记录：' + data.total + ' 项 <span class="muted">· 可一键还原 ' + data.restorable + ' 项 · 有原位置记录 ' + data.tracked + ' 项</span></h3>' +
      '<p class="sp-note">还原＝用 <code>/files/restore</code> 把项目搬回原目录（原目录不在时会提示你指定新目录）。' +
      '永久删除必须显式确认，不进废纸篓、不可撤销。</p>';
    wrap.appendChild(summary);

    if (!data.items.length) {
      wrap.appendChild(el('div', 'sp-empty', '这里还没有记录。送进废纸篓的文件会出现在这里（重启 CodeScope 也还在：删除记录已落盘）。'));
    } else {
      const table = el('table', 'sp-table fsv-table');
      table.innerHTML = '<thead><tr><th class="fsv-checkcol"></th><th>名称</th><th class="num">大小</th><th>删除时间</th><th>原位置</th><th class="fsv-actcol"></th></tr></thead>';
      const body = document.createElement('tbody');
      for (const item of data.items) {
        const row = el('tr', 'fsv-row');
        row.dataset.rowPath = item.path;
        if (S.selection.has(item.path)) row.classList.add('sel');
        const check = el('td', 'fsv-checkcol');
        const box = document.createElement('input');
        box.type = 'checkbox'; box.checked = S.selection.has(item.path);
        box.onclick = (event) => { event.stopPropagation(); selectRow(item, 0, event); render(); };
        check.appendChild(box);
        row.appendChild(check);
        const nameCell = el('td', 'fsv-name');
        nameCell.appendChild(el('span', 'fsv-icon fsv-icon-' + categoryOf(item), item.kind === 'dir' ? '▸' : '·'));
        nameCell.appendChild(el('span', 'fsv-name-text', item.name));
        row.appendChild(nameCell);
        row.appendChild(el('td', 'num', item.kind === 'dir' ? '—' : fmtBytes(item.size)));
        row.appendChild(el('td', 'muted', fmtTime(item.trashedAt || item.mtime) + '　' + relTime(item.trashedAt || item.mtime)));
        row.appendChild(el('td', 'mono', item.original || '（没有记录）'));
        const actions = el('td', 'fsv-actcol');
        const restore = el('button', 'sp-btn', '还原');
        restore.type = 'button';
        if (!item.restorable) {
          restore.disabled = true;
          restore.title = item.reason || '无法自动还原';
        }
        restore.onclick = () => restoreTrash(item);
        lock(restore, item.reason || reason());
        actions.appendChild(restore);
        const toButton = el('button', 'sp-btn', '还原到…');
        toButton.type = 'button';
        toButton.title = '原目录不存在时，指定一个新目录';
        toButton.onclick = async () => {
          const chosen = await pickDirectory();
          if (chosen) restoreTrash(item, chosen);
        };
        lock(toButton, reason());
        actions.appendChild(toButton);
        const purge = el('button', 'sp-btn danger', '永久删除');
        purge.type = 'button';
        purge.onclick = () => doPurge([item], loadTrash);
        lock(purge, reason());
        actions.appendChild(purge);
        row.appendChild(actions);
        if (!item.restorable && item.reason) {
          const noteRow = el('tr', 'fsv-noterow');
          const cell = el('td', 'muted', '↳ ' + item.reason);
          cell.colSpan = 6;
          noteRow.appendChild(cell);
          body.appendChild(row);
          body.appendChild(noteRow);
          continue;
        }
        body.appendChild(row);
      }
      table.appendChild(body);
      wrap.appendChild(table);
      if (S.selection.size) wrap.appendChild(selectionBar());
    }

    if (S.showOps) {
      const band = el('div', 'sp-band');
      band.appendChild(el('h3', null, '操作日志（最近 80 条，落盘在 ~/.codescope/system-panel-files.json）'));
      const ops = S.ops || [];
      if (!ops.length) band.appendChild(el('div', 'sp-empty', '还没有任何文件操作记录'));
      else {
        const list = el('div', 'sp-list');
        for (const item of ops.slice(0, 80)) {
          const line = el('div', 'sp-li');
          line.appendChild(el('span', 'mono muted fsv-ops-at', fmtTime(item.at)));
          line.appendChild(el('span', 'fsv-ops-type', String(item.type || '')));
          const detail = item.path || (item.items && item.items[0] && item.items[0].from) || (item.to ? '→ ' + item.to : '') || '';
          line.appendChild(el('span', 'grow mono', detail + (item.count > 1 ? '（共 ' + item.count + ' 项）' : '')));
          list.appendChild(line);
        }
        band.appendChild(list);
      }
      wrap.appendChild(band);
    }
    return wrap;
  }

  function renderPreview() {
    /* 预览是浮层：不动主列表，所以单独维护，不参与整页重绘。 */
    let node = document.getElementById('fsv-preview');
    if (!S.preview) { if (node) node.remove(); return; }
    if (!node) {
      node = el('div', 'fsv-preview');
      node.id = 'fsv-preview';
      node.onclick = (event) => { if (event.target === node) closePreview(); };
      document.body.appendChild(node);
    }
    const data = S.preview;
    const entry = data.entry || {};
    node.innerHTML = '';
    /* 浮层只当半透明背板，内容统一放进居中卡片：文本预览以前直接挂在背板上，
       结果渲染成一条贴底的横条（没有圆角、没有投影）。 */
    const card = el('div', 'fsv-preview-card');
    node.appendChild(card);
    const head = el('div', 'fsv-preview-head');
    head.appendChild(el('b', null, entry.name || ''));
    head.appendChild(el('span', 'muted mono', entry.path || ''));
    head.appendChild(el('span', 'grow'));
    const revealButton = el('button', 'sp-btn', '在访达中显示');
    revealButton.type = 'button';
    revealButton.onclick = () => reveal(entry.path);
    head.appendChild(revealButton);
    if (entry.kind === 'file' && canWrite()) {
      const editButton = el('button', 'sp-btn', '用编辑器打开');
      editButton.type = 'button';
      editButton.onclick = () => { closePreview(); host.openEditor(parentOf(entry.path)); };
      head.appendChild(editButton);
    }
    const close = el('button', 'sp-btn', '关闭 Esc');
    close.type = 'button';
    close.onclick = () => closePreview();
    head.appendChild(close);
    card.appendChild(head);
    const body = el('div', 'fsv-preview-body');
    if (data.loading) body.appendChild(el('div', 'sp-empty', '正在读取…'));
    else if (data.error) body.innerHTML = '<div class="sp-warn">' + esc(data.error) + '</div>';
    else if (data.url) {
      if (/\.pdf$/i.test(entry.name || '')) {
        const frame = document.createElement('iframe');
        frame.className = 'fsv-preview-frame';
        frame.src = data.url;
        body.appendChild(frame);
      } else {
        const image = document.createElement('img');
        image.className = 'fsv-preview-image';
        image.src = data.url;
        image.alt = entry.name || '';
        body.appendChild(image);
      }
    } else if (data.binary) {
      body.innerHTML = '<div class="sp-note">这是二进制文件（' + fmtBytes(data.bytes || entry.size) + '），面板只做文本预览，没有对应的预览方式。<br>可以「在访达中显示」用系统程序打开。</div>';
    } else {
      const pre = el('pre', 'fsv-preview-text');
      pre.textContent = data.text || '（空文件）';
      body.appendChild(pre);
      if (data.truncated) body.appendChild(el('p', 'sp-note sp-warn', '文件太大，这里只预览了开头一部分（全文 ' + fmtBytes(data.bytes) + '）。'));
    }
    card.appendChild(body);
  }

  /* ------------------------------------------------------------ 键盘 */

  function typingInPanel(event) {
    const node = event.target;
    if (!node || !node.tagName) return false;
    if (!S.container || !S.container.contains(node)) return false;
    if (node.classList && node.classList.contains('fsv-filter')) return true;
    return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable;
  }

  function handleKey(event) {
    if (!S.active) return false;
    if (!S.container || !S.container.isConnected || !document.body.classList.contains('system-mode')) return false;
    const key = event.key;
    const meta = event.metaKey || event.ctrlKey;
    const typing = typingInPanel(event);
    if (key === 'Escape') {
      if (S.menu) { closeMenu(); return true; }
      if (S.preview) { closePreview(); return true; }
      if (S.moving) { S.moving = null; render(); return true; }
      if (S.batch) { S.batch = null; render(); return true; }
      if (S.renaming || S.creating) { S.renaming = ''; S.creating = false; render(); return true; }
      if (S.selection.size) { clearSelection(); render(); return true; }
      return false;
    }
    /* 输入框里一律放行浏览器：⌘A 该选中输入框里的文字，空格该打空格。 */
    if (typing) return false;
    if (S.view !== 'files' && S.view !== 'files-trash') return false;
    const entries = selectedEntries();
    const one = entries[0];
    if (meta && String(key).toLowerCase() === 'l') { enterPathEdit(); return true; }
    if (meta && String(key).toLowerCase() === 'r' && !event.shiftKey) { if (S.view === 'files') listDir(S.path, { keepSelection: true }); else loadTrash(); return true; }
    if (meta && String(key).toLowerCase() === 'a' && S.view === 'files') { selectAll(); return true; }
    if (meta && String(key).toLowerCase() === 'c' && entries.length) { copyText(entries.map((entry) => entry.path).join('\n')); return true; }
    if (meta && event.shiftKey && String(key).toLowerCase() === 'r' && one) { reveal(one.path); return true; }
    if (meta && key === 'ArrowUp') { if (S.data && S.data.parent) listDir(S.data.parent); return true; }
    if (key === 'F2' && one) { startRename(one); return true; }
    if (key === 'F3' && one) { preview(one); return true; }
    if (key === 'F5' && entries.length) { S.moving = { mode: 'copy', value: '' }; render(); return true; }
    if (key === 'F6' && entries.length) { S.moving = { mode: 'move', value: '' }; render(); return true; }
    if (key === 'F7') { if (!canWrite()) { toast('warn', reason()); return true; } S.creating = true; render(); focusCreate(); return true; }
    if (key === 'F8') {
      if (event.shiftKey && S.view === 'files-trash') { doPurge(entries, loadTrash); return true; }
      if (S.view === 'files' && entries.length) { doTrash(entries); return true; }
      return true;
    }
    if (key === ' ' && one && !typing && !(document.activeElement && /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))) { preview(one); return true; }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const list = visibleEntries();
      if (!list.length) return false;
      const current = one ? list.findIndex((entry) => entry.path === one.path) : -1;
      let next = key === 'ArrowDown' ? current + 1 : current - 1;
      if (next < 0) next = 0;
      if (next >= list.length) next = list.length - 1;
      S.selection.clear();
      S.selection.add(list[next].path);
      S.anchor = next;
      render();
      const row = S.container.querySelector('[data-row-path="' + (window.CSS && CSS.escape ? CSS.escape(list[next].path) : list[next].path) + '"]');
      if (row) row.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (key === 'Enter' && one) {
      if (event.shiftKey) { startRename(one); return true; }
      if (one.kind === 'dir') { if (S.view === 'files') enterDir(one); return true; }
      preview(one);
      return true;
    }
    if (key === 'Backspace' && meta) { if (S.data && S.data.parent) listDir(S.data.parent); return true; }
    if (key === 'Delete') { if (S.view === 'files' && entries.length) { doTrash(entries); return true; } }
    return false;
  }

  function bindGlobal() {
    /* 键盘统一由宿主面板转发进来（handleKey），这里不再抢占 document 的 keydown：
       否则面板的 Esc（退出面板）会和这里的 Esc（关预览/清选择）打架。 */
    document.addEventListener('mousedown', (event) => {
      const menu = document.getElementById('fsv-menu');
      if (menu && !menu.contains(event.target)) closeMenu();
    }, true);
    if (!resizeBound) {
      window.addEventListener('resize', () => { if (S.view === 'files-usage') redrawTreemap(); });
      resizeBound = true;
    }
  }

  /* ------------------------------------------------------------ 整理（先干跑，后执行） */

  async function runOrganize(dryRun) {
    if (!dryRun && !requireWrite()) return;
    S.organizeBusy = true; S.organizeError = ''; render();
    try {
      S.organize = await api('/organize', { path: S.organizePath, mode: S.organizeMode, dryRun: !!dryRun });
      S.organizePlan = !!dryRun;
    } catch (error) {
      S.organizeError = String((error && error.message) || error);
      S.organizePlan = false;
    }
    S.organizeBusy = false;
    render();
  }

  function viewOrganize() {
    const wrap = el('div', 'fsv-view');
    const bar = el('div', 'fsv-toolbar');
    const input = document.createElement('input');
    input.className = 'sp-input fsv-organize-path';
    input.value = S.organizePath || S.path || S.home;
    input.placeholder = '要整理的目录（绝对路径）';
    input.oninput = () => { S.organizePath = input.value; };
    input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); runOrganize(true); } };
    bar.appendChild(input);
    const pick = el('button', 'sp-btn', '选择目录…');
    pick.type = 'button';
    pick.onclick = async () => { const chosen = await pickDirectory(); if (chosen) { S.organizePath = chosen; render(); } };
    bar.appendChild(pick);
    const mode = document.createElement('select');
    mode.className = 'sp-input fsv-organize-mode';
    mode.title = '按什么规则分桶';
    for (const [value, label] of [['ext', '按类型（图片/视频/文档…）'], ['date', '按月份（YYYY-MM）']]) {
      const option = document.createElement('option');
      option.value = value; option.textContent = label;
      if (S.organizeMode === value) option.selected = true;
      mode.appendChild(option);
    }
    mode.onchange = () => { S.organizeMode = mode.value; S.organize = null; S.organizePlan = false; render(); };
    bar.appendChild(mode);
    const preview = el('button', 'sp-btn primary', S.organizeBusy ? '正在预演…' : '预演（先不动文件）');
    preview.type = 'button';
    preview.disabled = S.organizeBusy;
    preview.onclick = () => runOrganize(true);
    bar.appendChild(preview);
    wrap.appendChild(bar);

    wrap.appendChild(el('p', 'sp-note', '整理只动<b>文件</b>，不动目录、不碰符号链接；重名的自动跳过。永远先预演给你看清单，你确认之后才真的移动。'));

    if (S.organizeBusy) wrap.appendChild(el('div', 'sp-empty', '正在扫描这个目录…'));
    if (S.organizeError) {
      const band = el('div', 'sp-band');
      band.innerHTML = '<h3 class="sp-warn">整理失败</h3><p class="sp-note">' + esc(S.organizeError) + '</p>';
      wrap.appendChild(band);
    }
    const data = S.organize;
    if (!data) {
      if (!S.organizeBusy && !S.organizeError) wrap.appendChild(el('div', 'sp-empty', '选好目录和规则，点「预演」看会发生什么。'));
      return wrap;
    }
    const band = el('div', 'sp-band');
    if (data.dryRun) {
      band.innerHTML = '<h3>预演结果：将移动 <b>' + data.movable + '</b> / ' + data.total + ' 个文件' +
        (data.conflicts > 0 ? '　<span class="sp-warn">有 ' + data.conflicts + ' 个同名文件会被跳过</span>' : '') + '</h3>' +
        '<p class="sp-note">目录 <code>' + esc(data.root) + '</code> · 规则 ' + (data.mode === 'ext' ? '按类型' : '按月份') +
        ' · 现在<b>还没有动任何文件</b>。</p>';
    } else {
      band.innerHTML = '<h3>执行完成：成功移动 <b>' + (data.moved || 0) + '</b> 个' +
        (data.failed ? '　<span class="sp-warn">失败 ' + data.failed + ' 个</span>' : '') + '</h3>' +
        '<p class="sp-note">目录 <code>' + esc(data.root) + '</code> · 规则 ' + (data.mode === 'ext' ? '按类型' : '按月份') + '。</p>';
    }
    const groups = el('div', 'fsv-organize-groups');
    for (const group of (data.groups || [])) {
      const card = el('div', 'fsv-organize-group');
      card.appendChild(el('b', null, group.name));
      card.appendChild(el('span', 'muted', group.count + ' 个 · ' + fmtBytes(group.bytes)));
      groups.appendChild(card);
    }
    if ((data.groups || []).length) band.appendChild(groups);
    wrap.appendChild(band);

    if (data.dryRun && data.movable > 0) {
      const actions = el('div', 'sp-actions');
      const go = el('button', 'sp-btn primary', '确认执行（移动 ' + data.movable + ' 个文件）');
      go.type = 'button';
      go.onclick = () => runOrganize(false);
      lock(go);
      actions.appendChild(go);
      actions.appendChild(el('span', 'muted', '这一步才会真的移动文件；同名项会被跳过，不覆盖任何东西。'));
      wrap.appendChild(actions);
    }
    if (!data.dryRun) {
      const actions = el('div', 'sp-actions');
      const again = el('button', 'sp-btn', '回到当前目录');
      again.type = 'button';
      again.onclick = () => { S.path = data.root; setView('files'); listDir(data.root); };
      actions.appendChild(again);
      const refresh = el('button', 'sp-btn', '再预演一次');
      refresh.type = 'button';
      refresh.onclick = () => runOrganize(true);
      actions.appendChild(refresh);
      wrap.appendChild(actions);
    }

    const moves = data.dryRun ? (data.moves || []) : (data.results || []);
    if (moves.length) {
      const table = el('table', 'sp-table fsv-table');
      table.innerHTML = '<thead><tr><th>原路径</th><th>目标</th><th class="num">大小</th><th>结果</th></tr></thead>';
      const body = document.createElement('tbody');
      for (const move of moves.slice(0, 200)) {
        const row = el('tr');
        row.appendChild(el('td', 'ellip mono', move.from || ''));
        row.appendChild(el('td', 'ellip mono muted', move.to || ''));
        row.appendChild(el('td', 'num', move.size == null ? '' : fmtBytes(move.size)));
        const state = data.dryRun
          ? (move.conflict ? '同名，将跳过' : '将移动')
          : (move.ok ? '✓ 已移动' : '✗ ' + (move.error || '失败'));
        row.appendChild(el('td', move.conflict && data.dryRun ? 'sp-warn' : (move.ok === false ? 'sp-warn' : 'muted'), state));
        body.appendChild(row);
      }
      table.appendChild(body);
      wrap.appendChild(table);
      if (moves.length > 200) wrap.appendChild(el('p', 'sp-note', '只列出前 200 项（共 ' + moves.length + '）。'));
    }
    return wrap;
  }

  /* ------------------------------------------------------------ 上传 */

  async function uploadFiles(files) {
    if (!requireWrite()) return;
    if (!files.length) return;
    const rows = [];
    for (const file of files) {
      try {
        const url = '/api/system-panel/files/upload?path=' + encodeURIComponent(S.path) + '&name=' + encodeURIComponent(file.name);
        const response = await fetch(url, { method: 'POST', body: file });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.ok === false) throw new Error((data && data.error) || ('HTTP ' + response.status));
        rows.push({ path: file.name, ok: true, note: fmtBytes(data.bytes) });
      } catch (error) {
        rows.push({ path: file.name, ok: false, note: String((error && error.message) || error) });
      }
    }
    S.batch = { title: '上传', rows };
    toast(rows.every((row) => row.ok) ? 'ok' : 'warn', '上传完成：' + rows.filter((row) => row.ok).length + '/' + rows.length);
    await listDir(S.path, { keepSelection: true });
  }

  /* ------------------------------------------------------------ 生命周期 */

  return {
    mount(container, view) {
      S.container = container;
      S.active = true;
      if (view === 'files') {
        S.view = 'files';
        /* 目录已经读过就只重绘，避免每次切回来都打一次磁盘。 */
        if (S.path && S.data) render(); else boot();
        return;
      }
      S.view = view;
      if (view === 'files-usage') {
        if (!S.usagePath) S.usagePath = S.path || S.home || '';
        render();
        return;
      }
      if (view === 'files-organize') {
        if (!S.organizePath) S.organizePath = S.path || S.home || '';
        render();
        return;
      }
      render();
      if (!S.trash) loadTrash();
    },
    renderView(view) { this.mount(S.container, view); },
    isFilesView(view) { return view === 'files' || view === 'files-usage' || view === 'files-organize' || view === 'files-trash'; },
    handleKey,
    unmount() {
      S.active = false;
      closePreview(); closeMenu();
      if (S.undo && S.undo.timer) { clearInterval(S.undo.timer); S.undo = null; }
    },
    onPanelClosed() {
      S.active = false;
      closePreview(); closeMenu();
      /* 撤销计时器不需要跟着面板关闭而停：后端已经落盘，回来还能看到回收站记录。 */
    },
    onThemeChange() { invalidateColors(); redrawTreemap(); },
    searchFiles,
    navigateTo(path) { S.view = 'files'; S.active = true; if (S.container) { this.mount(S.container, 'files'); listDir(path); } },
    currentPath() { return S.path; },
    invalidateColors,
    state: S,
  };
}

module.exports = { createFilesView };
