/* ═══════════════════════════════════════════════════════════════════════════
 * 架构图 · 面板里的自由缩放 / 平移（assets/arch-zoom.js）
 * ---------------------------------------------------------------------------
 * ★ 从 arch-view.js 抽出来的（2026-10-11）—— 抽的**直接原因**是棘轮
 *   （`arch-view.js ≤ 137 行`，要加「AI 视图」的分支就不够了 ✓）。
 *   抽的**实质理由**也成立：缩放/平移是一件**独立的事** ——
 *   它只跟"一个滚动容器 + 一个 SVG 元素"打交道 ✓，不知道图是怎么画出来的 ✓。
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
