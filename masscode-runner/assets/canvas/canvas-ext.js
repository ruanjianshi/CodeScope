/* ═══════════════════════════════════════════════════════════════════════
   canvas 功能层 —— 补齐「成熟白板」该有的东西
   -----------------------------------------------------------------------
   · 插入：图片 / 视频（原生）· 网页（链接卡片或内嵌）· PDF（pdf.js 逐页铺开）
   · 子白板：一块板里套一块板，可无限嵌套（page + meta.parentId 双向记录）
   · 连线：选中两个图形 → 一键生成**绑定**箭头（跟着图形走，不是画条线）
   全部通过 window.__tldraw 的公开 API 操作，不碰 tldraw 内部状态 ✓
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  const ed = () => window.__tldraw;
  const lib = () => window.__csLib || {};
  /* ⚠️ `createShapeId('xxx')` 会返回**固定 id** `shape:xxx` ✗ ——
     第二次调用就撞车（第二张卡片建不出来、第二条连线把绑定全叠到同一条箭头上）✓
     ⇒ 一律无参调用，让它自己生成随机 id ✓ */
  const newId = () => lib().createShapeId();
  const toast = (t, k) => (window.__csStatus || function () {})(t, k);
  const $ = (id) => document.getElementById(id);

  function centerPoint() {
    const b = ed().getViewportPageBounds();
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  function topLeftPoint(pad) {
    const b = ed().getViewportPageBounds();
    return { x: b.x + (pad || 60), y: b.y + (pad || 60) };
  }

  /* ── 文件选择 ─────────────────────────────────────────────────────── */
  function pickFile(accept, multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      if (multiple) inp.multiple = true;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = () => { resolve([...(inp.files || [])]); inp.remove(); };
      inp.oncancel = () => { resolve([]); inp.remove(); };
      inp.click();
    });
  }

  /* ── 图片 / 视频：交给 tldraw 原生（内联 base64，跨刷新不丢）────────── */
  async function insertMedia(kind) {
    const files = await pickFile(kind === 'video' ? 'video/*' : 'image/*', true);
    if (!files.length) return;
    try {
      await ed().putExternalContent({ type: 'files', files, point: centerPoint() });
      toast(`已插入 ${files.length} 个${kind === 'video' ? '视频' : '图片'}`);
    } catch (e) { toast('插入失败：' + (e && e.message || e), 'err'); }
  }

  /* ── 网页：默认**真内嵌**（自定义 webcard 图形），另给一个「链接卡片」── */
  function openDialog(cfg) {
    $('cs-dlg-title').textContent = cfg.title;
    $('cs-dlg-hint').textContent = cfg.hint;
    const inp = $('cs-dlg-input');
    inp.placeholder = cfg.placeholder || 'https://';
    inp.value = cfg.value || '';
    const alt = $('cs-dlg-alt');
    alt.style.display = cfg.altLabel ? '' : 'none';
    alt.textContent = cfg.altLabel || '';
    $('cs-dlg-ok').textContent = cfg.okLabel || '插入';
    $('cs-dialog').classList.add('on');
    setTimeout(() => inp.focus(), 30);
    const close = () => {
      $('cs-dialog').classList.remove('on');
      $('cs-dlg-ok').onclick = null; $('cs-dlg-cancel').onclick = null; alt.onclick = null; inp.onkeydown = null;
    };
    const take = (fn) => { const v = inp.value.trim(); if (!v) return; close(); fn(v); };
    $('cs-dlg-cancel').onclick = close;
    alt.onclick = cfg.onAlt ? () => take(cfg.onAlt) : null;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') take(cfg.onOk);
      if (e.key === 'Escape') close();
    };
    $('cs-dlg-ok').onclick = () => take(cfg.onOk);
  }

  /* 用户可能直接写 `/knowledge/` 或 `127.0.0.1:4877/...` ✓ —— 补全成绝对地址 */
  function normalizeUrl(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (v.startsWith('/')) return location.origin + v;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(v)) return 'http://' + v;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(v)) return 'https://' + v;
    return 'https://' + v;
  }

  function insertWebCard(url) {
    const editor = ed();
    const c = centerPoint();
    let host = url;
    try { host = new URL(url).host; } catch (_) {}
    editor.createShape({
      id: newId(),
      type: 'webcard',
      x: Math.round(c.x - 450), y: Math.round(c.y - 310),
      props: { w: 900, h: 620, url, title: host },
    });
    toast('已插入网页 · 双击卡片进入交互');
  }

  function insertWeb() {
    openDialog({
      title: '嵌入网页',
      hint: '可以直接写本机路径（如 /knowledge/），也可以贴完整网址。'
        + '「内嵌网页」= 在画布里直接看和点；「链接卡片」= 只放一张可点开的卡片。',
      placeholder: '/knowledge/  或  https://…',
      okLabel: '内嵌网页',
      altLabel: '链接卡片',
      onOk: (v) => insertWebCard(normalizeUrl(v)),
      onAlt: async (v) => {
        const u = normalizeUrl(v);
        try {
          await ed().putExternalContent({ type: 'url', url: u, point: centerPoint() });
          toast('已插入链接卡片');
        } catch (e) { toast('插入失败：' + (e && e.message || e), 'err'); }
      },
    });
  }

  /* ── PDF：pdf.js 逐页渲染成图片，竖着铺开 ───────────────────────────── */
  const PDF_MAX_PAGES = 24;
  /* ⚠️ 900 太低了 ✗ —— 卡片在视网膜屏上显示 680 CSS px 就要 1360 设备像素，
     900px 的图被放大 1.5 倍 → 糊 ✓。1800 才够清晰（也够放到 200% 看细节）✓ */
  const PDF_WIDTH = 1800;

  async function insertPdf() {
    const [file] = await pickFile('application/pdf');
    if (!file) return;
    toast('正在解析 PDF…');
    let pdfjs;
    try {
      pdfjs = await import('/assets/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.mjs';
    } catch (e) { toast('pdf.js 加载失败', 'err'); return; }

    let doc;
    try {
      doc = await pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        /* 中文 PDF 必须有 cMap，否则汉字整片空白 ✗ */
        cMapUrl: '/assets/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/assets/pdfjs/standard_fonts/',
      }).promise;
    } catch (e) { toast('PDF 打不开：' + (e && e.message || e), 'err'); return; }

    const total = doc.numPages;
    const n = Math.min(total, PDF_MAX_PAGES);
    const { uploadDataUrl } = lib();
    if (!uploadDataUrl) { toast('缺少上传接口', 'err'); return; }

    const urls = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: PDF_WIDTH / base.width });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      /* 每页都是几百 KB 的位图 → **上传成文件**，卡片里只留 URL ✓ */
      let src;
      try {
        /* PNG 无损 ✓ —— 原理图这种线条图用 WebP 有损压缩会发虚 ✓ */
        src = await uploadDataUrl(`${file.name}-p${i}.png`, cv.toDataURL('image/png'));
      } catch (_) {
        src = cv.toDataURL('image/png');   // 服务端不可用时退回内联，别让用户白等
      }
      urls.push(src);
      toast(`渲染 PDF ${i}/${n}…`);
    }

    /* ⚠️ 只建**一张卡片** ✓ —— 以前是每页一张大图铺在画布上，
       3 页原理图就是 3 张巨型图，画布直接被撑爆 ✗ */
    const at = topLeftPoint(60);
    ed().createShape({
      id: newId(),
      type: 'pdfcard',
      x: Math.round(at.x), y: Math.round(at.y),
      props: { w: 440, h: 620, title: file.name, pages: urls.join('\n'), page: 0 },
    });
    toast(total > n ? `已放入 PDF（前 ${n} 页，共 ${total} 页）` : `已放入 PDF（${n} 页）· 卡片里可翻页`);
  }

  /* ═══ 组合 / 解组（用 tldraw 的 frame 当容器）═══════════════════════════
     frame 天生就是"能装东西的框"：拖进去自动变成它的 child ✓，拖出来自动解除 ✓，
     frame 还能套 frame（无限嵌套）✓ —— 所以「包含关系」不用自己造数据结构 ✓
     ⚠️ reparentShapes 会保持图形的**页面绝对位置** ✓，不会因为换爹而跳位 ✓ */
  function pageIdOf() { return ed().getCurrentPageId(); }

  function boundsOf(ids) {
    const editor = ed();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const b = editor.getShapePageBounds(id);
      if (!b) continue;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function groupSelected() {
    const editor = ed();
    const sel = editor.getSelectedShapeIds();
    const ids = sel.filter((id) => {
      const s = editor.getShape(id);
      return s && s.type !== 'frame';
    });
    if (ids.length < 2) {
      toast('先选中至少两个图形，再点「组合」');
      return;
    }
    const b = boundsOf(ids);
    if (!b) return;
    const PAD = 36, HEAD = 44;
    const groups = [...editor.getCurrentPageShapeIds()]
      .map((i) => editor.getShape(i))
      .filter((s) => s && s.type === 'frame').length;
    const fid = newId();
    editor.createShape({
      id: fid,
      type: 'frame',
      x: Math.round(b.x - PAD),
      y: Math.round(b.y - PAD - HEAD),
      props: {
        w: Math.round(b.w + PAD * 2),
        h: Math.round(b.h + PAD * 2 + HEAD),
        name: '分组 ' + (groups + 1),
        color: 'grey',
      },
    });
    editor.reparentShapes(ids, fid);
    editor.setSelectedShapes([fid]);
    toast('已组合 · 拖动分组框可整体移动，双击名字可改名');
  }

  function ungroupSelected() {
    const editor = ed();
    const frames = editor.getSelectedShapeIds()
      .map((i) => editor.getShape(i))
      .filter((s) => s && s.type === 'frame');
    if (!frames.length) { toast('先选中一个分组框，再点「解组」'); return; }
    const freed = [];
    for (const f of frames) {
      const kids = editor.getSortedChildIdsForParent(f.id);
      /* 先摘孩子再删框 ✓ —— 直接删框会把孩子一起带走 ✗ */
      if (kids.length) editor.reparentShapes(kids, pageIdOf());
      freed.push(...kids);
      editor.deleteShapes([f.id]);
    }
    editor.setSelectedShapes(freed);
    toast('已解组 · ' + freed.length + ' 个图形回到画布');
  }

  function groupOrUngroup() {
    const editor = ed();
    const sel = editor.getSelectedShapeIds().map((i) => editor.getShape(i)).filter(Boolean);
    if (sel.some((s) => s.type === 'frame')) return ungroupSelected();
    return groupSelected();
  }

  /* 把图形移出所在分组（回画布顶层） */
  function moveOutOfGroup(shapeId) {
    const editor = ed();
    const s = editor.getShape(shapeId);
    if (!s || !s.parentId || s.parentId === pageIdOf()) return;
    editor.reparentShapes([shapeId], pageIdOf());
    toast('已移出分组');
  }

  /* 在同一父级里调顺序：交换两个兄弟的位置（画布上看得见的那种"调顺序"） */
  function moveSibling(shapeId, dir) {
    const editor = ed();
    const s = editor.getShape(shapeId);
    if (!s) return;
    const sibs = editor.getSortedChildIdsForParent(s.parentId);
    const i = sibs.indexOf(shapeId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sibs.length) return;
    const a = editor.getShape(sibs[i]);
    const b = editor.getShape(sibs[j]);
    if (!a || !b) return;
    editor.updateShapes([
      { id: a.id, type: a.type, x: b.x, y: b.y, index: b.index },
      { id: b.id, type: b.type, x: a.x, y: a.y, index: a.index },
    ]);
  }

  /* ═══ 笔记卡片 ═════════════════════════════════════════════════════════ */
  const CARD_COLORS = ['orange', 'violet', 'blue', 'green', 'red', 'grey'];
  let cardColorIdx = 0;

  /* 新卡片接在最右边那张的右侧（横向流），而不是全堆在视口中心 */
  function nextCardSpot(w, h) {
    const editor = ed();
    const cards = [...editor.getCurrentPageShapeIds()]
      .map((i) => editor.getShape(i))
      .filter((s) => s && s.type === 'card');
    if (!cards.length) {
      const c = centerPoint();
      return { x: Math.round(c.x - (w || 300) / 2), y: Math.round(c.y - (h || 240) / 2) };
    }
    let right = cards[0];
    for (const s of cards) if (s.x > right.x) right = s;
    return { x: Math.round(right.x + right.props.w + 60), y: Math.round(right.y) };
  }

  function insertCard() {
    const editor = ed();
    const color = CARD_COLORS[cardColorIdx++ % CARD_COLORS.length];
    const spot = nextCardSpot(340, 280);
    editor.createShape({
      id: newId(),
      type: 'card',
      x: spot.x, y: spot.y,
      props: {
        w: 340, h: 280, color,
        markdown: '# 新卡片\n\n双击开始写。\n\n- 支持 **加粗**、`代码`\n- 列表、引用、表格\n- 图片 `![](url)`',
      },
    });
    toast('已新建卡片 · 双击编辑');
  }

  function insertSticky() {
    const editor = ed();
    const c = centerPoint();
    const id = newId();
    editor.createShape({
      id,
      type: 'sticky',
      x: Math.round(c.x - 100), y: Math.round(c.y - 100),
      props: { w: 200, h: 200, text: '', color: 'yellow' },
    });
    editor.setSelectedShapes([id]);
    editor.setEditingShape(id);        // 建完直接能打字 ✓
    toast('便签 · 拖四角改大小，双击改内容');
  }

  /* ── 大纲：按**真实的父子关系**画成树（分组框是父节点）─────────────── */
  const CARD_DOT = {
    black: '#3a414d', grey: '#5a6371', orange: '#a96c22', yellow: '#8d7420',
    violet: '#6a4d99', 'light-violet': '#8568bb', blue: '#2c6aa1', 'light-blue': '#4787bd',
    green: '#3b7550', 'light-green': '#56946a', red: '#984848', 'light-red': '#bb6666',
  };
  const OUTLINE_SKIP = new Set(['arrow', 'line', 'draw', 'highlight']);

  function shapeLabel(s) {
    switch (s.type) {
      case 'card': return cardTitleOf(s.props.markdown);
      case 'frame': return s.props.name || '分组';
      case 'webcard': { try { return new URL(s.props.url).host; } catch (_) { return '网页'; } }
      case 'image': return '图片';
      case 'video': return '视频';
      case 'note': return '便签';
      case 'sticky': return (s.props.text || '便签').split('\n')[0].slice(0, 40);
      case 'text': return '文本';
      case 'subboard': return s.props.title || '子白板';
      case 'geo': return '形状';
      default: return s.type;
    }
  }
  function shapeDot(s) {
    if (s.type === 'card') return CARD_DOT[s.props.color] || CARD_DOT.black;
    if (s.type === 'frame') return '#5b93ff';
    if (s.type === 'image' || s.type === 'video') return '#5f6a7a';
    return '#454d5a';
  }

  function renderOutline() {
    const el = $('cs-outline');
    if (!el || !ed()) return;
    const editor = ed();
    el.innerHTML = '';

    const rows = [];
    const walk = (parentId, depth) => {
      for (const id of editor.getSortedChildIdsForParent(parentId)) {
        const s = editor.getShape(id);
        if (!s || OUTLINE_SKIP.has(s.type)) continue;
        rows.push({ shape: s, depth });
        if (s.type === 'frame') walk(id, depth + 1);
      }
    };
    walk(pageIdOf(), 0);

    const head = document.createElement('div');
    head.className = 'cs-ol-head';
    head.innerHTML = '<span>大纲</span><span>' + rows.length + ' 个节点</span>';
    el.appendChild(head);

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'cs-ol-empty';
      empty.textContent = '还没有内容。左边第一个按钮建卡片，选中多个图形后点「组合」可以把它们装进一个分组框。';
      el.appendChild(empty);
      return;
    }

    rows.forEach(({ shape: s, depth }) => {
      const row = document.createElement('div');
      row.className = 'cs-ol-row' + (s.type === 'frame' ? ' cs-ol-row--group' : '');
      if (depth) row.style.paddingLeft = (8 + depth * 14) + 'px';

      const dot = document.createElement('span');
      dot.className = 'cs-ol-dot';
      dot.style.background = shapeDot(s);
      row.appendChild(dot);

      const txt = document.createElement('span');
      txt.className = 'cs-ol-txt';
      txt.textContent = shapeLabel(s);
      txt.title = txt.textContent;
      row.appendChild(txt);

      /* 悬浮出现的小按钮：上移 / 下移 / 移出分组 */
      const acts = document.createElement('span');
      acts.className = 'cs-ol-acts';
      const mkBtn = (label, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.onclick = (e) => { e.stopPropagation(); fn(); renderOutline(); };
        acts.appendChild(b);
      };
      mkBtn('↑', '上移', () => moveSibling(s.id, -1));
      mkBtn('↓', '下移', () => moveSibling(s.id, 1));
      if (s.parentId && s.parentId !== pageIdOf()) mkBtn('⇤', '移出分组', () => moveOutOfGroup(s.id));
      row.appendChild(acts);

      row.onclick = () => {
        const b = editor.getShapePageBounds(s);
        editor.select(s.id);
        if (b) editor.zoomToBounds(b, { inset: 120, animation: { duration: 260 } });
      };
      el.appendChild(row);
    });
  }

  /* 和 bundle 里 cardTitleOf 同一套规则（这里只要标题文本，不要 HTML） */
  function cardTitleOf(md) {
    const text = String(md || '');
    const h = /^\s{0,3}#{1,6}\s+(.+)$/m.exec(text);
    if (h) return h[1].trim();
    const first = text.split('\n').map((s) => s.trim()).find(Boolean) || '';
    return first.replace(/^#{1,6}\s*/, '').replace(/[*_`>]/g, '').slice(0, 48) || '新卡片';
  }

  /* ═══ 子白板 ═══════════════════════════════════════════════════════════ */
  function newSubBoard() {
    const editor = ed();
    const cur = editor.getCurrentPage();
    const name = '子白板 ' + (editor.getPages().length);
    const before = new Set(editor.getPages().map((p) => p.id));
    try { editor.createPage({ name }); } catch (e) { toast('新建页面失败', 'err'); return; }
    const page = editor.getPages().find((p) => !before.has(p.id));
    if (!page) { toast('新建页面失败', 'err'); return; }
    try { editor.updatePage({ id: page.id, meta: { ...(cur.meta || {}), parentId: cur.id } }); } catch (_) {}
    const c = centerPoint();
    editor.createShape({
      id: newId(),
      type: 'subboard',
      x: c.x - 170, y: c.y - 110,
      props: { w: 340, h: 220, title: name, pageId: page.id },
    });
    renderCrumb();
    toast('已新建子白板 · 双击卡片进入');
  }

  function enterPage(pageId) {
    const editor = ed();
    const page = editor.getPage(pageId);
    if (!page) { toast('子白板不存在（可能已被删除）', 'err'); return; }
    let switched = false;
    try { editor.setCurrentPage(page); switched = true; } catch (_) {}
    if (!switched) {
      try { editor.setCurrentPageId(page.id); switched = true; } catch (_) {}
    }
    if (!switched) { toast('切换子白板失败', 'err'); return; }
    editor.setSelectedShapes([]);
    renderCrumb();
    renderPages();
    /* ★ 进入后**居中显示**这块子白板的内容 ✓
       （用户：「和导图一样去居中显示子白板的东西」）
       子页面刚切过去时形状可能还没渲染完，等一帧再 fit ✓ */
    const fit = (attempt) => {
      requestAnimationFrame(() => {
        try {
          const e2 = ed();
          if (!e2) return;
          const shapes = e2.getCurrentPageShapes ? e2.getCurrentPageShapes() : [];
          if (!shapes.length && attempt < 3) { setTimeout(() => fit(attempt + 1), 120); return; }
          if (!shapes.length) return;          /* 真·空页面：保持默认视图 ✓ */
          if (typeof e2.zoomToFit === 'function') e2.zoomToFit({ animation: { duration: 220 } });
          else if (typeof e2.zoomToContent === 'function') e2.zoomToContent();
        } catch (_) {}
      });
    };
    fit(0);
  }

  /* ── 面包屑：沿 meta.parentId 往上走 ─────────────────────────────────── */
  function pageChain() {
    const editor = ed();
    const chain = [];
    const seen = new Set();
    let p = editor.getCurrentPage();
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      chain.unshift(p);
      const pid = p.meta && p.meta.parentId;
      p = pid ? editor.getPage(pid) : null;
    }
    return chain;
  }

  function renderCrumb() {
    const el = $('cs-crumb');
    if (!el || !ed()) return;
    const chain = pageChain();
    if (chain.length < 2) { el.classList.remove('on'); el.innerHTML = ''; return; }
    el.classList.add('on');
    el.innerHTML = '';
    chain.forEach((p, i) => {
      if (i) {
        const s = document.createElement('span');
        s.className = 'cs-crumb-sep';
        s.textContent = '›';
        el.appendChild(s);
      }
      const last = i === chain.length - 1;
      if (last) {
        const now = document.createElement('span');
        now.className = 'cs-crumb-now';
        now.textContent = p.name || '未命名';
        el.appendChild(now);
      } else {
        const a = document.createElement('a');
        a.textContent = p.name || '未命名';
        a.title = '返回「' + (p.name || '未命名') + '」';
        a.onclick = () => enterPage(p.id);
        el.appendChild(a);
      }
    });
    /* 「上一级」按钮 */
    const up = document.createElement('a');
    up.textContent = '↰ 上一级';
    up.style.marginLeft = '4px';
    up.onclick = () => enterPage(chain[chain.length - 2].id);
    el.appendChild(up);
  }

  /* ── 页面列表（按 parentId 缩进）─────────────────────────────────────── */
  function depthOf(page) {
    let d = 0, p = page, seen = new Set();
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      const pid = p.meta && p.meta.parentId;
      p = pid ? ed().getPage(pid) : null;
      if (p) d++;
      if (d > 30) break;
    }
    return d;
  }

  function renderPages() {
    const el = $('cs-pages');
    if (!el || !ed()) return;
    const editor = ed();
    const cur = editor.getCurrentPage();
    const pages = editor.getPages();
    el.innerHTML = '';
    pages.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'cs-pg' + (p.id === cur.id ? ' now' : '');
      const d = depthOf(p);
      if (d) {
        const ind = document.createElement('span');
        ind.className = 'cs-pg-indent';
        ind.style.width = (d * 12) + 'px';
        row.appendChild(ind);
      }
      const ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ico.setAttribute('viewBox', '0 0 24 24');
      ico.setAttribute('class', 'cs-pg-ico');
      ico.innerHTML = d
        ? '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>'
        : '<rect x="4" y="4" width="16" height="16" rx="3"/>';
      row.appendChild(ico);
      const nm = document.createElement('span');
      nm.className = 'cs-pg-name';
      nm.textContent = p.name || '未命名';
      row.appendChild(nm);
      const n = document.createElement('span');
      n.className = 'cs-pg-n';
      try { n.textContent = editor.getPageShapeIds(p.id).size; } catch (_) { n.textContent = ''; }
      row.appendChild(n);
      row.onclick = () => { enterPage(p.id); };
      el.appendChild(row);
    });
  }

  /* ── 连线：选中两个图形 → 生成绑定箭头 ──────────────────────────────── */
  function connectSelected() {
    const editor = ed();
    const ids = editor.getSelectedShapeIds();
    if (ids.length < 2) {
      editor.setCurrentTool('arrow');
      toast('已切到箭头：从一个图形内部拖到另一个图形，会自动吸附');
      return;
    }
    const a = editor.getShape(ids[0]);
    const b = editor.getShape(ids[1]);
    const ba = editor.getShapePageBounds(a);
    const bb = editor.getShapePageBounds(b);
    if (!ba || !bb) return;
    editor.markHistoryStoppingPoint();
    const start = { x: ba.maxX, y: ba.center.y };
    const end = { x: bb.minX, y: bb.center.y };
    const arrowId = newId();
    editor.createShape({
      id: arrowId,
      type: 'arrow',
      x: start.x, y: start.y,
      props: {
        start: { x: 0, y: 0 },
        end: { x: end.x - start.x, y: end.y - start.y },
        arrowheadEnd: 'arrow',
        color: 'blue',
        /* 折线（正交走线）—— 和卡片流的「流程箭头」一个观感 ✓ */
        kind: 'elbow',
      },
    });
    /* 绑定：之后拖图形，箭头会跟着走 ✓（不是画一条死线 ✗）
       ⚠️ props 必须和 tldraw 自己建的**一模一样** —— 少一个 snap:'center'
       绑定记录虽然写进去了，但图形移动时箭头不会重算 ✗（踩过） */
    const bindProps = (terminal) => ({
      terminal,
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
      snap: 'center',
    });
    try {
      editor.createBindings([
        { type: 'arrow', fromId: arrowId, toId: a.id, props: bindProps('start') },
        { type: 'arrow', fromId: arrowId, toId: b.id, props: bindProps('end') },
      ]);
    } catch (e) { /* 绑定失败也留着直线，别让用户觉得没反应 */ }
    editor.setSelectedShapes([arrowId]);
    toast('已连线 · 拖动图形时箭头会跟随');
  }

  /* ═══ 分组框自动贴合子节点 ═════════════════════════════════════════════
     tldraw 的 frame 不会跟着孩子长大/缩小 ✗ —— 拖进去一张卡片，框还是原来那么大 ✓，
     卡片就戳到框外面去了。这里补一个「自适应」：
       · 只由**子节点变化**触发 ✓（用户手动拉大框不会被立刻抢回去 ✓）
       · 拖动/缩放过程中不动 ✓（等操作停了再贴 ✓，否则会跟 tldraw 的临时变换打架）
       · 框位移时同步调整孩子的相对坐标 ✓（孩子的**页面位置保持不动** ✓）
     ═══════════════════════════════════════════════════════════════════════ */
  const FIT_PAD = 40, FIT_HEAD = 48;

  function fitFrame(fid, opts) {
    const editor = ed();
    const frame = editor.getShape(fid);
    if (!frame || frame.type !== 'frame') return;
    const kids = editor.getSortedChildIdsForParent(fid);
    if (!kids.length) return;                       // 空框保持原样，别缩成 0

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of kids) {
      const b = editor.getShapePageBounds(id);
      if (!b) continue;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) return;

    const want = {
      x: minX - FIT_PAD,
      y: minY - FIT_PAD - FIT_HEAD,
      w: maxX - minX + FIT_PAD * 2,
      h: maxY - minY + FIT_PAD * 2 + FIT_HEAD,
    };
    const fb = editor.getShapePageBounds(frame);
    if (!fb) return;

    /* 打开旧画布时只**撑大**不缩小 ✓ —— 用户手动拉大的框不该被抢回去 ✓ */
    if (opts && opts.growOnly) {
      want.x = Math.min(want.x, fb.x);
      want.y = Math.min(want.y, fb.y);
      want.w = Math.max(want.w, fb.w + (fb.x - want.x));
      want.h = Math.max(want.h, fb.h + (fb.y - want.y));
    }

    const dx = want.x - fb.x, dy = want.y - fb.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(want.w - fb.w) < 1 && Math.abs(want.h - fb.h) < 1) return;

    const updates = [{
      id: frame.id,
      type: 'frame',
      x: frame.x + dx,
      y: frame.y + dy,
      props: { ...frame.props, w: Math.round(want.w), h: Math.round(want.h) },
    }];
    /* 框往左上长的时候，孩子要反向补回来，视觉上才不动 */
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      for (const id of kids) {
        const k = editor.getShape(id);
        if (k) updates.push({ id, type: k.type, x: k.x - dx, y: k.y - dy });
      }
    }
    editor.updateShapes(updates);
  }

  /* 从一次 store 变更里收集「父级是 frame」的形状，再回头去贴那些框 */
  const fitTargets = new Set();
  let fitTimer = 0;

  function collectFitTargets(entry) {
    if (!entry || !entry.changes) return;
    const take = (rec) => {
      if (!rec || rec.typeName !== 'shape') return;
      if (rec.type === 'frame') return;             // 框自己变了不算（手动改大小要保留）
      if (rec.parentId && String(rec.parentId).startsWith('shape:')) fitTargets.add(String(rec.parentId));
    };
    for (const [, [from, to]] of Object.entries(entry.changes.updated || {})) { take(to); take(from); }
    for (const [, rec] of Object.entries(entry.changes.added || {})) take(rec);
    for (const [, rec] of Object.entries(entry.changes.removed || {})) take(rec);
    if (!fitTargets.size) return;
    clearTimeout(fitTimer);
    fitTimer = setTimeout(runFit, 200);
  }

  function runFit() {
    const editor = ed();
    if (!editor) return;
    /* 载入快照时不贴（loadSnapshot 的批量变更不是"用户挪了孩子"） */
    if (window.__csLoading) { fitTimer = setTimeout(runFit, 200); return; }
    /* 正在拖动/缩放就先别动 —— 中途改孩子的相对坐标会和 tldraw 的临时变换打架 ✗ */
    if (editor.isInAny('select.translating', 'select.resizing', 'select.dragging_handle')) {
      fitTimer = setTimeout(runFit, 200);
      return;
    }
    const ids = [...fitTargets];
    fitTargets.clear();
    for (const fid of ids) fitFrame(fid);
  }

  /* ═══ 对齐 / 等距 / 整理 ═══════════════════════════════════════════════
     拖动时的吸附参考线（isSnapMode）只能"靠近才吸"，靠它把一堆卡片摆整齐太累 ✗。
     这里给确定性的：选中 ≥2 个 → 六个对齐方向 + 两个等距；选中分组框 → 一键竖排。
     ═══════════════════════════════════════════════════════════════════════ */
  function selBoxes() {
    const editor = ed();
    const out = [];
    for (const id of editor.getSelectedShapeIds()) {
      const s = editor.getShape(id);
      const b = editor.getShapePageBounds(id);
      if (s && b) out.push({ id, s, b });
    }
    return out;
  }

  function alignSelected(kind) {
    const editor = ed();
    const items = selBoxes();
    if (items.length < 2) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { b } of items) {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.maxX); y1 = Math.max(y1, b.maxY);
    }
    const updates = [];
    for (const { id, s, b } of items) {
      let dx = 0, dy = 0;
      if (kind === 'left') dx = x0 - b.x;
      else if (kind === 'hcenter') dx = (x0 + x1) / 2 - (b.x + b.maxX) / 2;
      else if (kind === 'right') dx = x1 - b.maxX;
      else if (kind === 'top') dy = y0 - b.y;
      else if (kind === 'vcenter') dy = (y0 + y1) / 2 - (b.y + b.maxY) / 2;
      else if (kind === 'bottom') dy = y1 - b.maxY;
      else return;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      updates.push({ id, type: s.type, x: s.x + dx, y: s.y + dy });
    }
    if (updates.length) editor.updateShapes(updates);
  }

  function distributeSelected(axis) {
    const editor = ed();
    const items = selBoxes();
    if (items.length < 3) { toast('等距需要至少 3 个图形'); return; }
    const horiz = axis === 'h';
    items.sort((a, b) => (horiz ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0];
    const last = items[items.length - 1];
    const span = horiz ? (last.b.maxX - first.b.x) : (last.b.maxY - first.b.y);
    const used = items.reduce((n, it) => n + (horiz ? it.b.w : it.b.h), 0);
    const gap = (span - used) / (items.length - 1);
    let cursor = horiz ? first.b.x : first.b.y;
    const updates = [];
    for (const it of items) {
      const d = cursor - (horiz ? it.b.x : it.b.y);
      if (Math.abs(d) > 0.5) {
        updates.push({ id: it.id, type: it.s.type, x: it.s.x + (horiz ? d : 0), y: it.s.y + (horiz ? 0 : d) });
      }
      cursor += (horiz ? it.b.w : it.b.h) + gap;
    }
    if (updates.length) editor.updateShapes(updates);
  }

  /* 一键竖排：按大纲顺序（= index 顺序）从上到下排，左边缘对齐分组框内边距 */
  function tidyGroup(frameId) {
    const editor = ed();
    const frame = editor.getShape(frameId);
    if (!frame || frame.type !== 'frame') { toast('先选中一个分组框'); return; }
    const kids = editor.getSortedChildIdsForParent(frameId);
    if (!kids.length) return;
    const fb = editor.getShapePageBounds(frame);
    if (!fb) return;
    const left = fb.x + FIT_PAD;
    let y = fb.y + FIT_HEAD + 12;
    const GAP = 20;
    const updates = [];
    for (const id of kids) {
      const k = editor.getShape(id);
      const kb = editor.getShapePageBounds(id);
      if (!k || !kb) continue;
      const dx = left - kb.x;
      const dy = y - kb.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) updates.push({ id, type: k.type, x: k.x + dx, y: k.y + dy });
      y += kb.h + GAP;
    }
    if (updates.length) editor.updateShapes(updates);
    setTimeout(() => fitFrame(frameId), 80);
    toast('已按顺序竖排');
  }

  /* 工具条显隐：≥2 个才显示对齐按钮；选中分组框才显示「整理」 */
  function updateAlignBar() {
    const el = $('cs-align');
    if (!el || !ed()) return;
    const editor = ed();
    const ids = editor.getSelectedShapeIds();
    /* ⚠️ 这里是 **id 数组**，不是 shape 对象 ✗ —— 别再 .id 一次 ✓ */
    const frames = ids.filter((id) => { const s = editor.getShape(id); return s && s.type === 'frame'; });
    const enough = ids.length >= 2;
    const showTidy = frames.length >= 1;
    el.classList.toggle('on', enough || showTidy);
    el.querySelectorAll('button[data-align]').forEach((b) => {
      if (b.dataset.align === 'tidy') { b.style.display = showTidy ? '' : 'none'; return; }
      b.style.display = enough ? '' : 'none';
    });
    const seps = el.querySelectorAll('.cs-sep');
    if (seps[0]) seps[0].style.display = enough ? '' : 'none';
    if (seps[1]) seps[1].style.display = showTidy && enough ? '' : 'none';
    el.__frames = frames;
  }

  function bindAlignBar() {
    const el = $('cs-align');
    if (!el) return;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-align]');
      if (!btn) return;
      const kind = btn.dataset.align;
      if (kind === 'hdist') return distributeSelected('h');
      if (kind === 'vdist') return distributeSelected('v');
      if (kind === 'tidy') {
        const frames = el.__frames || [];
        if (!frames.length) { toast('先选中一个分组框'); return; }
        return tidyGroup(frames[0]);
      }
      return alignSelected(kind);
    });
  }

  /* ═══ 对齐参考线（拖动时实时）═════════════════════════════════════════
     tldraw 自带的 snap 指示器只对**网格**生效 ✓，形状之间的对齐参考线在这个
     嵌入环境里压根不出现 ✗。所以自己算：拖动中被选图形 vs 其它图形，
     左边/中线/右边、上边/中线/下边 任意一对在阈值内 → 画一条红线 ✓，
     松手时再吸附过去（4 屏幕像素以内才吸，避免"甩不掉"）✓
     ═══════════════════════════════════════════════════════════════════════ */
  const GUIDE_TH = 6;        // 屏幕像素：多远之内显示参考线
  const SNAP_TH = 4;         // 屏幕像素：多远之内松手吸附

  function collectAlignLines(thresholdPx) {
    const editor = ed();
    if (!editor) return [];
    const sel = editor.getSelectedShapeIds();
    if (!sel.length) return [];
    const selSet = new Set(sel);
    const zoom = editor.getZoomLevel();
    const th = thresholdPx / zoom;
    const targets = [];
    for (const id of editor.getCurrentPageShapeIds()) {
      if (selSet.has(id)) continue;
      const s = editor.getShape(id);
      if (!s || s.type === 'frame' || s.type === 'arrow' || s.type === 'line') continue;
      const b = editor.getShapePageBounds(id);
      if (b) targets.push(b);
    }
    if (!targets.length) return [];

    const out = [];
    const seen = new Set();
    for (const id of sel) {
      const b = editor.getShapePageBounds(id);
      if (!b) continue;
      const xs = [b.x, b.x + b.w / 2, b.maxX];
      const ys = [b.y, b.y + b.h / 2, b.maxY];
      for (const t of targets) {
        const txs = [t.x, t.x + t.w / 2, t.maxX];
        const tys = [t.y, t.y + t.h / 2, t.maxY];
        for (const x of xs) for (const tx of txs) {
          if (Math.abs(x - tx) > th) continue;
          const key = 'v' + Math.round(tx);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ dir: 'v', at: tx, delta: tx - x });
        }
        for (const y of ys) for (const ty of tys) {
          if (Math.abs(y - ty) > th) continue;
          const key = 'h' + Math.round(ty);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ dir: 'h', at: ty, delta: ty - y });
        }
      }
    }
    return out;
  }

  function drawGuides() {
    const el = $('cs-guides');
    const editor = ed();
    if (!el || !editor) return;
    if (!editor.isIn('select.translating')) { if (el.childElementCount) el.innerHTML = ''; return; }
    const lines = collectAlignLines(GUIDE_TH);
    el.innerHTML = '';
    const vp = editor.getViewportScreenBounds();
    for (const ln of lines) {
      const d = document.createElement('div');
      d.className = 'cs-guide cs-guide--' + ln.dir;
      if (ln.dir === 'v') {
        const sx = editor.pageToScreen({ x: ln.at, y: 0 }).x;
        d.style.left = Math.round(sx) + 'px';
        d.style.top = '0';
        d.style.height = Math.round(vp.h) + 'px';
      } else {
        const sy = editor.pageToScreen({ x: 0, y: ln.at }).y;
        d.style.top = Math.round(sy) + 'px';
        d.style.left = '0';
        d.style.width = Math.round(vp.w) + 'px';
      }
      el.appendChild(d);
    }
  }

  /* 松手时吸附：把被选图形整体平移到最近的参考线 */
  function snapAfterRelease() {
    const editor = ed();
    const el = $('cs-guides');
    if (el && el.childElementCount) el.innerHTML = '';
    if (!editor) return;
    const sel = editor.getSelectedShapeIds();
    if (!sel.length) return;
    const lines = collectAlignLines(SNAP_TH);
    if (!lines.length) return;
    /* 取绝对值最小的一条（x / y 各一条），整体位移 */
    let bestV = null, bestH = null;
    for (const ln of lines) {
      if (ln.dir === 'v' && (!bestV || Math.abs(ln.delta) < Math.abs(bestV.delta))) bestV = ln;
      if (ln.dir === 'h' && (!bestH || Math.abs(ln.delta) < Math.abs(bestH.delta))) bestH = ln;
    }
    const dx = bestV ? bestV.delta : 0;
    const dy = bestH ? bestH.delta : 0;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    const updates = [];
    for (const id of sel) {
      const s = editor.getShape(id);
      if (s) updates.push({ id, type: s.type, x: s.x + dx, y: s.y + dy });
    }
    if (updates.length) editor.updateShapes(updates);
  }

  function bindGuides() {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; drawGuides(); });
    };
    const editor = ed();
    if (!editor) return;
    editor.store.listen(schedule, { scope: 'document' });
    editor.store.listen(schedule, { scope: 'session' });
    window.addEventListener('pointermove', () => { if (editor.isIn('select.translating')) schedule(); }, true);
    /* ⚠️ 只有"拖动结束"才吸附 ✗ —— 单击选中也会走 pointerup，
       不加判断的话，点一下就把图形悄悄挪了 4px ✓（很难查的那种 bug） */
    window.addEventListener('pointerup', () => {
      const edi = ed();
      const wasTranslating = !!edi && edi.isIn('select.translating');
      if (!wasTranslating) { const g = $('cs-guides'); if (g) g.innerHTML = ''; return; }
      setTimeout(snapAfterRelease, 0);
    }, true);
  }

  /* ═══ 滚轮归属：指针在可滚动内容上时，滚内容而不是平移画布 ═══════════════
     ⚠️ tldraw 在画布上监听 `wheel` 做平移/缩放 ✗ —— 指针明明在 PDF 正文上，
     滚轮照样把画布平移了 ✓（实测：scrollTop 不变、camera.y 直接 -400）。
     必须在 **window 捕获阶段**抢下来（比画布上的监听更早）✓：
       · preventDefault + stopPropagation → 画布收不到
       · 自己改 scrollTop（因为 preventDefault 之后浏览器默认滚动也没了）
     ═══════════════════════════════════════════════════════════════════════ */
  const SCROLLABLE_SEL = '.cs-pdf__body, .cs-card__edit, .cs-sticky__edit';

  function bindWheelGuard() {
    window.addEventListener('wheel', (e) => {
      const t = e.target;
      const el = t && t.closest ? t.closest(SCROLLABLE_SEL) : null;
      if (!el) return;
      const canY = el.scrollHeight > el.clientHeight + 1;
      const canX = el.scrollWidth > el.clientWidth + 1;
      if (!canY && !canX) return;              // 内容本来就不溢出 → 放行给画布缩放
      e.preventDefault();
      e.stopPropagation();
      if (canY) el.scrollTop += e.deltaY;
      if (canX) el.scrollLeft += e.deltaX;
    }, { passive: false, capture: true });
  }

  /* ═══ 思维导图（canvas 内）══════════════════════════════════════════════
     数据：节点是 `mnode` 图形，父子关系存在 `shape.meta.mmParent` ✓
     连线：不是绑定箭头，而是**排版后重建**（位置由布局算死，绑定没意义）✓
     布局：向右生长的整齐树 —— 先量子树高度，再把子节点块垂直居中到父节点 ✓
     ═══════════════════════════════════════════════════════════════════════ */
  const MM_COLORS = ['violet', 'blue', 'green', 'grey', 'orange', 'red'];
  const MM_GAP_X = 64, MM_GAP_Y = 16, MM_H = 40;

  const isMNode = (s) => !!s && s.type === 'mnode';
  const mmParentOf = (s) => (s && s.meta && s.meta.mmParent) ? String(s.meta.mmParent) : '';

  function mmNodes() {
    const editor = ed();
    const map = new Map();
    for (const id of editor.getCurrentPageShapeIds()) {
      const s = editor.getShape(id);
      if (isMNode(s)) map.set(String(id), s);
    }
    return map;
  }

  function mmRootOf(nodeId, map) {
    let cur = map.get(String(nodeId));
    const seen = new Set();
    while (cur) {
      const p = mmParentOf(cur);
      if (!p || !map.has(p) || seen.has(p)) break;
      seen.add(p);
      cur = map.get(p);
    }
    return cur ? String(cur.id) : String(nodeId);
  }

  /* ★ 思维导图 = 一张**窗口卡片**（里面嵌 Mind Elixir），不再是散落的 mnode 节点 ✓ */
  function newMindCard() {
    const editor = ed();
    const c = centerPoint();
    const id = newId();
    editor.createShape({
      id, type: 'mindcard',
      x: Math.round(c.x - 310), y: Math.round(c.y - 210),
      props: { w: 620, h: 420, title: '思维导图', data: '' },
    });
    editor.setSelectedShapes([id]);
    toast('双击进入编辑 · 退出后自动缩放显示全图');
  }

  function mmNewRoot() {
    const editor = ed();
    const c = centerPoint();
    const id = newId();
    editor.createShape({
      id, type: 'mnode',
      x: Math.round(c.x - 70), y: Math.round(c.y - 20),
      props: { w: 140, h: MM_H, text: '', color: 'violet' },
      meta: {},
    });
    editor.setSelectedShapes([id]);
    editor.setEditingShape(id);
    toast('思维导图 · Tab 加子节点，Enter 加同级');
  }

  function mmAddChild(parentId) {
    const editor = ed();
    const map = mmNodes();
    const parent = map.get(String(parentId));
    if (!parent) return;
    const depth = mmDepthOf(parentId, map);
    const id = newId();
    editor.createShape({
      id, type: 'mnode',
      x: parent.x + parent.props.w + MM_GAP_X,
      y: parent.y + parent.props.h + MM_GAP_Y,
      props: { w: 120, h: MM_H, text: '', color: MM_COLORS[Math.min(depth + 1, MM_COLORS.length - 1)] },
      meta: { mmParent: String(parentId) },
    });
    mmLayout(mmRootOf(parentId, map));
    editor.setSelectedShapes([id]);
    editor.setEditingShape(id);
  }

  function mmAddSibling(nodeId) {
    const editor = ed();
    const map = mmNodes();
    const node = map.get(String(nodeId));
    if (!node) return;
    const pid = mmParentOf(node);
    if (!pid) { toast('根节点没有同级，用「子节点」往下长'); return; }
    const depth = mmDepthOf(nodeId, map);
    const id = newId();
    editor.createShape({
      id, type: 'mnode',
      x: node.x, y: node.y + node.props.h + MM_GAP_Y,
      props: { w: 120, h: MM_H, text: '', color: MM_COLORS[Math.min(depth, MM_COLORS.length - 1)] },
      meta: { mmParent: pid },
    });
    mmLayout(mmRootOf(nodeId, map));
    editor.setSelectedShapes([id]);
    editor.setEditingShape(id);
  }

  function mmDepthOf(nodeId, map) {
    let d = 0, cur = map.get(String(nodeId)), seen = new Set();
    while (cur) {
      const p = mmParentOf(cur);
      if (!p || !map.has(p) || seen.has(p)) break;
      seen.add(p); d++; cur = map.get(p);
    }
    return d;
  }

  /* 删除节点 = 连同整棵子树（连线和节点一起） */
  function mmDelete(nodeId) {
    const editor = ed();
    const map = mmNodes();
    if (!map.has(String(nodeId))) return;
    const parentId = mmParentOf(map.get(String(nodeId)));
    const dead = [];
    const walk = (id) => {
      dead.push(String(id));
      for (const [cid, s] of map) if (mmParentOf(s) === String(id)) walk(cid);
    };
    walk(nodeId);
    editor.deleteShapes(dead);
    if (parentId && map.has(parentId)) mmLayout(mmRootOf(parentId, map));
    toast('已删除 ' + dead.length + ' 个节点');
  }

  function mmRebuildLinks(map, parentOf) {
    const editor = ed();
    /* 先清掉旧的连线（meta.mmLink 标记的箭头） */
    const old = [];
    for (const id of editor.getCurrentPageShapeIds()) {
      const s = editor.getShape(id);
      if (s && s.type === 'arrow' && s.meta && s.meta.mmLink) old.push(String(id));
    }
    if (old.length) editor.deleteShapes(old);

    const created = [];
    for (const [cid, s] of map) {
      const pid = parentOf(cid);
      if (!pid || !map.has(pid)) continue;
      const p = map.get(pid);
      const sx = p.x + p.props.w;
      const sy = p.y + p.props.h / 2;
      const ex = s.x;
      const ey = s.y + s.props.h / 2;
      const id = newId();
      editor.createShape({
        id, type: 'arrow',
        x: Math.round(sx), y: Math.round(sy),
        props: {
          start: { x: 0, y: 0 },
          end: { x: Math.round(ex - sx), y: Math.round(ey - sy) },
          color: 'grey',
          kind: 'arc',
          arrowheadStart: 'none',
          arrowheadEnd: 'none',
          dash: 'solid',
          size: 's',
        },
        meta: { mmLink: true },
      });
      created.push(id);
    }
    return created;
  }

  function mmLayout(rootId) {
    const editor = ed();
    const map = mmNodes();
    const root = map.get(String(rootId));
    if (!root) return;

    const parentOf = (id) => mmParentOf(map.get(id));
    const kids = new Map();
    for (const [id] of map) {
      const p = parentOf(id);
      if (p && map.has(p)) {
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p).push(id);
      }
    }

    const measure = (id, guard) => {
      const s = map.get(id);
      const cs = kids.get(id) || [];
      if (!cs.length || guard > 30) return s.props.h;
      let total = 0;
      for (const c of cs) total += measure(c, guard + 1);
      total += MM_GAP_Y * (cs.length - 1);
      return Math.max(s.props.h, total);
    };

    const pos = new Map();
    const place = (id, left, top) => {
      const s = map.get(id);
      const subH = measure(id, 0);
      pos.set(id, { x: Math.round(left), y: Math.round(top + subH / 2 - s.props.h / 2) });
      const cs = kids.get(id) || [];
      if (!cs.length) return;
      const blockH = cs.reduce((n, c) => n + measure(c, 0), 0) + MM_GAP_Y * (cs.length - 1);
      let cy = top + (subH - blockH) / 2;
      for (const c of cs) {
        place(c, left + s.props.w + MM_GAP_X, cy);
        cy += measure(c, 0) + MM_GAP_Y;
      }
    };
    place(String(rootId), root.x, root.y);

    const updates = [];
    for (const [id, p] of pos) {
      const s = map.get(id);
      if (Math.round(s.x) !== p.x || Math.round(s.y) !== p.y) updates.push({ id, type: 'mnode', x: p.x, y: p.y });
    }
    if (updates.length) editor.updateShapes(updates);

    /* 用**排好之后**的位置重建连线 */
    const after = mmNodes();
    mmRebuildLinks(after, (id) => mmParentOf(after.get(id)));
    renderMindBar();
  }

  /* ═══ 节点工具条：选中一个 mnode 时出现 ═══ */
  function renderMindBar() {
    const el = $('cs-mind');
    const editor = ed();
    if (!el || !editor) return;
    const sel = editor.getSelectedShapeIds().map((i) => editor.getShape(i)).filter(isMNode);
    if (sel.length !== 1) { el.classList.remove('on'); return; }
    el.classList.add('on');
    el.__node = String(sel[0].id);
  }

  function bindMindBar() {
    const el = $('cs-mind');
    if (!el) return;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mm]');
      if (!btn) return;
      const id = el.__node;
      if (!id) return;
      const act = btn.dataset.mm;
      if (act === 'child') return mmAddChild(id);
      if (act === 'sibling') return mmAddSibling(id);
      if (act === 'layout') {
        const map = mmNodes();
        return mmLayout(mmRootOf(id, map));
      }
      if (act === 'delete') return mmDelete(id);
    });
    /* Tab 子节点 / Enter 同级（没在编辑文字时） */
    window.addEventListener('keydown', (e) => {
      const editor = ed();
      if (!editor || editor.getEditingShapeId()) return;
      if (e.key !== 'Tab' && e.key !== 'Enter') return;
      const sel = editor.getSelectedShapeIds().map((i) => editor.getShape(i)).filter(isMNode);
      if (sel.length !== 1) return;
      e.preventDefault();
      if (e.key === 'Tab') mmAddChild(String(sel[0].id));
      else mmAddSibling(String(sel[0].id));
    }, true);
  }

  /* ═══ 左侧功能条 ═══════════════════════════════════════════════════════ */
  function bindRail() {
    const rail = $('cs-rail');
    if (!rail) return;
    rail.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'card') return insertCard();
      if (act === 'sticky') return insertSticky();
      if (act === 'image') return insertMedia('image');
      if (act === 'video') return insertMedia('video');
      if (act === 'web') return insertWeb();
      if (act === 'pdf') return insertPdf();
      if (act === 'subboard') return newSubBoard();
      if (act === 'mind') return newMindCard();
      if (act === 'group') return groupOrUngroup();
      if (act === 'link') return connectSelected();
      if (act === 'pages') {
        const p = $('cs-pages');
        const on = p.classList.toggle('on');
        if (on) renderPages();
        return;
      }
      if (act === 'outline') {
        const o = $('cs-outline');
        const on = o.classList.toggle('on');
        if (on) renderOutline();
        return;
      }
    });
    /* 点别处关掉页面列表 / 大纲 */
    document.addEventListener('pointerdown', (e) => {
      const p = $('cs-pages');
      if (p && p.classList.contains('on') && !p.contains(e.target) && !e.target.closest('#cs-rail')) p.classList.remove('on');
      const o = $('cs-outline');
      if (o && o.classList.contains('on') && !o.contains(e.target) && !e.target.closest('#cs-rail')) o.classList.remove('on');
    }, true);
  }

  /* ── 把图片拖到卡片上 → 变成卡片正文里的 ![](url) ✓ ─────────────────
     ⚠️ 必须用**捕获阶段**的 window 监听 ✗ 否则 tldraw 先在画布上建一个图片图形 ✓，
     图片就跑到卡片旁边去了（用户要的是"放进卡片"）✓ */
  function readAsDataUrl(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = () => rej(new Error('读取文件失败'));
      fr.readAsDataURL(file);
    });
  }

  function bindCardDrop() {
    window.addEventListener('drop', async (e) => {
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => /^image\//.test(f.type || ''));
      if (!files.length) return;
      const editor = ed();
      if (!editor) return;
      let shape = null;
      try {
        const pt = editor.screenToPage({ x: e.clientX, y: e.clientY });
        shape = editor.getShapeAtPoint(pt, { hitInside: true, margin: 0 });
      } catch (_) { return; }
      if (!shape || shape.type !== 'card') return;   // 不在卡片上 → 放行，交给 tldraw 正常插图
      e.preventDefault();
      e.stopPropagation();
      try {
        let md = shape.props.markdown || '';
        for (const f of files) {
          const url = await lib().uploadDataUrl(f.name, await readAsDataUrl(f));
          md += `\n\n![](${url})`;
        }
        editor.updateShape({ id: shape.id, type: 'card', props: { markdown: md } });
        toast('已把 ' + files.length + ' 张图片放进卡片');
      } catch (err) { toast('插入失败：' + (err && err.message || err), 'err'); }
    }, true);
  }

  /* ── 拖文件进画布的提示 ─────────────────────────────────────────────── */
  function bindDropHint() {
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      document.body.classList.add('cs-dragover');
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) document.body.classList.remove('cs-dragover');
    });
    window.addEventListener('drop', () => { depth = 0; document.body.classList.remove('cs-dragover'); });
  }

  /* ── 启动 ───────────────────────────────────────────────────────────── */
  let booted = false;
  function boot() {
    if (booted || !window.__tldraw) return;
    booted = true;
    bindRail();
    bindAlignBar();
    bindMindBar();
    bindWheelGuard();
    bindGuides();
    bindDropHint();
    bindCardDrop();
    /* 双击子白板卡片 → 进入 */
    window.addEventListener('cs-enter-page', (e) => enterPage(e.detail));
    /* ⚠️ 兜底：**自己监听原生 dblclick** ✗
       bundle 里那个派发在某些情况下不触发（用户实测：双击卡片没反应），
       这里直接按坐标命中 subboard 形状 → 进子画布 ✓ */
    const host = document.querySelector('.tl-container') || document.body;
    host.addEventListener('dblclick', (event) => {
      const editor2 = ed();
      if (!editor2) return;
      let point;
      try { point = editor2.screenToPage({ x: event.clientX, y: event.clientY }); } catch (_) { return; }
      let all = [];
      try {
        all = (typeof editor2.getCurrentPageShapes === 'function' && editor2.getCurrentPageShapes())
          || (typeof editor2.getCurrentPageRenderingShapes === 'function' && editor2.getCurrentPageRenderingShapes())
          || [];
      } catch (_) { all = []; }
      const shapes = all.filter((sh) => sh && sh.type === 'subboard');
      const hit = shapes.find((sh) => {
        const w = Number(sh.props?.w || 0);
        const h = Number(sh.props?.h || 0);
        return point.x >= sh.x && point.x <= sh.x + w && point.y >= sh.y && point.y <= sh.y + h;
      });
      if (!hit || !hit.props?.pageId) return;
      event.preventDefault();
      event.stopPropagation();
      enterPage(hit.props.pageId);
    }, true);
    /* 页面切换后刷新面包屑 / 列表 */
    const editor = ed();
    if (!editor) return;
    let t = 0;
    editor.store.listen((entry) => {
      collectFitTargets(entry);          // 子节点动了 → 让分组框自己贴上去
      clearTimeout(t);
      t = setTimeout(() => {
        renderCrumb();
        updateAlignBar();
        renderMindBar();
        if ($('cs-pages').classList.contains('on')) renderPages();
        if ($('cs-outline').classList.contains('on')) renderOutline();
      }, 220);
    }, { scope: 'document' });
    /* ⚠️ 选中状态在 **session 作用域**（instance_page_state），不在 document ✗ ——
       只监听 document 的话，取消选中后工具条不会消失 ✓（实测踩过） */
    editor.store.listen(() => {
      updateAlignBar();
      renderMindBar();
    }, { scope: 'session' });
    renderCrumb();
    updateAlignBar();
    renderMindBar();
    /* 打开已有画布时，把"孩子已经戳到框外面"的分组框补一次 ✓（只撑大不缩小 ✓） */
    setTimeout(() => {
      const edi = ed();
      if (!edi) return;
      for (const id of edi.getCurrentPageShapeIds()) {
        const s = edi.getShape(id);
        if (s && s.type === 'frame') fitFrame(id, { growOnly: true });
      }
    }, 1600);
  }

  /* ⚠️ tldraw-ready 有可能在我们挂上监听之前就发过了（React 并发渲染 + 脚本顺序）✗
     → 除了监听事件，再加一个轮询兜底 ✓，boot() 自己有 booted 闸门 ✓ */
  function tryBoot() {
    if (window.__tldraw) { boot(); return; }
    if (tryBoot.n > 200) return;
    tryBoot.n = (tryBoot.n || 0) + 1;
    setTimeout(tryBoot, 100);
  }
  window.addEventListener('tldraw-ready', boot);
  tryBoot();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryBoot);
})();
