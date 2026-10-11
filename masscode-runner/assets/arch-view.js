/* ═══════════════════════════════════════════════════════════════════════════
 * 架构视图 · 面板集成（assets/arch-view.js）
 * ---------------------------------------------------------------------------
 * 和「图谱」**同一个面板**（#cg-canvas / #cg-body），工具栏两个按钮切换
 * （🕸 图谱 / ▦ 架构）—— 不另开浮层；数据源完全一样
 * （`/api/graph?scope=document&file=`）。
 *
 * ⚠️ **画图那一半在 `assets/arch-graph-svg.js`**（`archFragOf` / `archGraphSvg`）——
 *    那边是纯函数，能被 `tests/arch-geom.js` 用假 DOM 直接测。
 *    这里只管：抓数据 → 塞进面板 → 缩放平移 → 点方块跳源码。
 *
 * ⚠️ 面板切换按钮（🕸 图谱 / ▦ 架构）仍在 app.js ——
 *    它要和 `CG_ACTIVE` / `renderCodeGraphPane` / 工具栏拧在一起，搬过来更绕。
 * ═══════════════════════════════════════════════════════════════════════════ */


/* ── 架构图 · 自由缩放 / 平移 ──────────────────────────────────────────
   用户原话：「**无法自由放大缩小等**」（2026-10-11）。
   「图谱」那版有 d3.zoom（滚轮缩放 + 拖拽平移）✓，架构图这版没有 ✓ —— 这里补上。

   ⚠️ 实现上**不用 d3、也不用 transform** ✓：
      直接改 SVG 元素的 `width` / `height` 属性 ✓，外层 `.doc-graph` 本来就是
      `overflow:auto` ✓ —— 于是「缩放 = 改尺寸」「平移 = 原生滚动」，
      两件事都交给浏览器 ✓，不会出现 transform 和滚动条互相打架 ✓。
      （另一个好处：「⤢ 放大」克隆的是**当前尺寸**的 SVG ✓，看到什么放大什么 ✓。） */
function wireArchZoom(host, svg) {
  const W = Number(svg.dataset.naturalW) || Number(svg.getAttribute('width')) || 0;
  const H = Number(svg.dataset.naturalH) || Number(svg.getAttribute('height')) || 0;
  if (!W || !H) return;
  const MIN = 0.15, MAX = 5, PADPX = 24;
  let zoom = 1;

  const badge = document.createElement('div');
  badge.style.cssText = 'position:absolute;right:10px;bottom:8px;z-index:2;'
    + 'font:11px/1.6 ui-monospace,Menlo,monospace;color:#8c9bb5;background:rgba(18,20,28,.92);'
    + 'border:1px solid #2b3040;border-radius:8px;padding:1px 8px;pointer-events:none;user-select:none';
  host.appendChild(badge);

  const apply = () => {
    svg.style.maxWidth = 'none';
    svg.setAttribute('width', String(Math.round(W * zoom)));
    svg.setAttribute('height', String(Math.round(H * zoom)));
    badge.textContent = Math.round(zoom * 100) + '%';
  };
  /* 以 (cx, cy)（host 内坐标）为锚点缩放 —— 鼠标指着的地方不动 ✓ */
  const zoomAt = (next, cx, cy) => {
    const k = Math.max(MIN, Math.min(MAX, next));
    if (k === zoom) return;
    const rx = (host.scrollLeft + cx) / zoom;
    const ry = (host.scrollTop + cy) / zoom;
    zoom = k;
    apply();
    host.scrollLeft = rx * zoom - cx;
    host.scrollTop = ry * zoom - cy;
  };
  /* 适应窗口：整张图进面板 ✓（打开时的默认，也是双击的效果）*/
  const fit = () => {
    const bw = Math.max(120, host.clientWidth - PADPX * 2);
    const bh = host.clientHeight > 120 ? host.clientHeight - PADPX * 2 : 0;
    let k = bw / W;
    if (bh) k = Math.min(k, bh / H);
    zoom = Math.max(MIN, Math.min(MAX, Math.min(k, 1)));
    apply();
    host.scrollLeft = 0; host.scrollTop = 0;
  };

  /* 滚轮 = 缩放（和图谱一致）；按住 Shift 才让它正常滚动 ✓ */
  host.addEventListener('wheel', (ev) => {
    if (ev.shiftKey) return;
    ev.preventDefault();
    const r = host.getBoundingClientRect();
    zoomAt(zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });

  /* 拖拽 = 平移（按在方块上不算拖拽，那是点击高亮 ✓）*/
  let drag = null;
  host.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0 || (ev.target.closest && ev.target.closest('g[style]'))) return;
    drag = { x: ev.clientX, y: ev.clientY, l: host.scrollLeft, t: host.scrollTop };
    host.style.cursor = 'grabbing';
  });
  const endDrag = () => { drag = null; host.style.cursor = ''; };
  host.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    ev.preventDefault();
    host.scrollLeft = drag.l - (ev.clientX - drag.x);
    host.scrollTop = drag.t - (ev.clientY - drag.y);
  });
  host.addEventListener('mouseup', endDrag);
  host.addEventListener('mouseleave', endDrag);
  host.addEventListener('dblclick', (ev) => { ev.preventDefault(); fit(); });

  if (host.clientWidth) fit(); else setTimeout(fit, 60);
}

/* 架构视图：同一份数据，画成分层方块（点节点高亮上下游 ✓） */
async function renderArchIntoPane(body) {
  const seq = ++CG_SEQ;
  body.innerHTML = '<span class="ol-empty">正在生成架构图…</span>';
  if ($('cg-stats')) $('cg-stats').textContent = '…';
  try {
    const response = await fetch('/api/graph?scope=document&file=' + encodeURIComponent(CURRENT.file));
    const graph = await response.json();
    if (seq !== CG_SEQ) return;
    if (!graph || !graph.ok) throw new Error((graph && graph.error) || '生成失败');
    if (!(graph.nodes || []).length) {
      body.innerHTML = '<span class="ol-empty">这个文档里没有代码片段</span>';
      if ($('cg-stats')) $('cg-stats').textContent = '';
      return;
    }
    /* 按**面板宽度**决定折行点 —— 面板窄就多折几行，
       让「打开即适应」的比例尽量接近可读（而不是缩到 45% 看不清字）✓ */
    const panelW = Math.max(320, (body.clientWidth || 0) - 40);
    const svg = archGraphSvg(graph, { maxRowW: Math.min(1200, panelW * 1.2) });
    body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'doc-graph';
    /* ⚠️ 要 `flex:1 1 auto; min-height:0` 把面板**撑满** ✗✓ ——
       不撑满的话 host 高度由内容决定 ✓，`#cg-body` 是 `overflow:hidden` ✓，
       内容一高就被**裁掉** ✓（自己的 `overflow:auto` 永远不触发 ✓）。
       撑满之后「适应窗口」才有高度可算 ✓。 */
    host.style.cssText = 'flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px 16px;position:relative';
    host.appendChild(svg);
    body.appendChild(host);
    wireArchZoom(host, svg);
    const st = graph.stats || {};
    if ($('cg-stats')) {
      $('cg-stats').textContent = (st.fragments || 0) + ' 个片段 · ' + (st.functions || 0) + ' 个函数 · '
        + (st.calls || 0) + ' 条调用 · ' + (st.includes || 0) + ' 条包含';
    }
    setStatus('ok', '架构图：点方块可高亮它的上下游');
  } catch (error) {
    if (seq !== CG_SEQ) return;
    body.innerHTML = '<span class="ol-empty">架构图失败：' + escapeHtml(String((error && error.message) || error)) + '</span>';
    if ($('cg-stats')) $('cg-stats').textContent = '';
  }
}
