/* ═══════════════════════════════════════════════════════════════════════════
 * 架构图 · 画成 SVG（assets/arch-graph-svg.js）
 * ---------------------------------------------------------------------------
 * 只做一件事：把 `archLayout()` 算出来的**纯数据**（坐标 + 路径）变成 `<svg>` ✓。
 * 布局和走线在 `assets/arch-layout.js`（那边不碰 DOM，所以能直接单测）。
 *
 * ⚠️ 骨架、四条铁律（owns 不画线 / 端点分散 / **主干合并** / orient 必须是 auto）
 *    都写在 `arch-layout.js` 的注释里 —— **改走线去那边改** ✓。
 * ═══════════════════════════════════════════════════════════════════════════ */

function archGraphSvg(graph, opts) {
  const NS = 'http://www.w3.org/2000/svg';
  const L = archLayout(graph, opts);
  const edges = graph.edges || [];
  const svg = document.createElementNS(NS, 'svg');
  const mk = (tag, attrs, text, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = String(text);
    (parent || svg).appendChild(n);
    return n;
  };
  const W = L.W, H = L.H, PAD = L.PAD, LEGEND_W = L.LEGEND_W, LEGEND_H = L.LEGEND_H;
  const CHIP_W = L.CHIP_W;
  const legendY = L.legendY, cards = L.cards, pos = L.chipPos, pending = L.pending;

  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  /* ⚠️ 必须给**明确像素宽** —— 「⤢ 放大」把 SVG 克隆进浮层，克隆体没有父容器约束，
     `width:100%` 会退化成极小值。明确 px + `max-width:100%` 两处都对。
     （面板里**自由缩放**靠改这两个属性，见 wireArchZoom ✓。） */
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('style', 'background:#12141c;border-radius:10px;display:block;max-width:100%;height:auto');
  svg.dataset.naturalW = String(W);
  svg.dataset.naturalH = String(H);

  const edgeLayer = mk('g', {});
  const edgeEls = [];

  pending.forEach((x) => {
    const path = mk('path', {
      d: x.d,
      fill: 'none',
      stroke: x.inc ? '#8c9bb5' : '#7aa2f7',
      'stroke-opacity': x.inc ? .45 : .6,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
      ...(x.inc ? { 'stroke-dasharray': '4 4' } : {}),
      ...(x.marker ? { 'marker-end': 'url(#arch-arrow)' } : {}),
    }, null, edgeLayer);
    edgeEls.push({ el: path, ids: x.ids, kind: x.inc ? 'include' : 'call' });
  });

  /* 箭头 ✓ ⚠️ `orient` 必须是 `auto` —— 原来写的 `auto-start-start-reverse`
     是**非法值**，Chrome 报错后**静默回退到 0 → 箭头一律朝右**（详见 CHANGELOG）。 */
  const defs = mk('defs', {});
  const marker = mk('marker', { id: 'arch-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 6, markerHeight: 6, orient: 'auto' }, null, defs);
  mk('path', { d: 'M2 1L8 5L2 9', fill: 'none', stroke: '#7aa2f7',
    'stroke-width': 1.5, 'stroke-linecap': 'round' }, null, marker);

  /* ── 方块层 ── */
  const nodeLayer = mk('g', {});
  const nodeEls = new Map();
  cards.forEach((c) => {
    mk('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 12,
      fill: 'rgba(239,159,39,.07)', stroke: '#EF9F27', 'stroke-opacity': .45, 'stroke-width': .8 }, null, nodeLayer);
    /* ⚠️ 标题/计数要放在**函数列**里，不能放到走廊上 ——
       放到走廊上会被竖线划过（用户截图里「9 个函数」上就有线）。 */
    const headX = c.x + (c.kids.length ? c.lw : 0);
    mk('text', { x: headX + 12, y: c.y + 25, fill: '#EF9F27', 'font-size': 14, 'font-weight': 500 },
      String(c.node.label || '').slice(0, 22), nodeLayer);
    mk('text', { x: headX + (c.kids.length ? CHIP_W : c.w) - 12, y: c.y + 25,
      fill: '#8a7350', 'font-size': 11, 'text-anchor': 'end' }, c.kids.length + ' 个函数', nodeLayer);
    c.kids.forEach((k) => {
      const p = pos.get(k.id);
      const grp = mk('g', { style: 'cursor:pointer' }, null, nodeLayer);
      const rect = mk('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 7,
        fill: 'rgba(122,162,247,.14)', stroke: '#7aa2f7', 'stroke-opacity': .5, 'stroke-width': .8 }, null, grp);
      const label = mk('text', { x: p.x + 10, y: p.y + 19, fill: '#c0caf5', 'font-size': 13 },
        String(k.label || '').slice(0, 20), grp);
      nodeEls.set(k.id, { rect, label, node: k });
      /* ★ 点节点 → 高亮它和它的上下游 ✓✓（这就是"可交互" ✓）*/
      grp.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const up = new Set(), down = new Set();
        edges.forEach((e) => { if (e.to === k.id) up.add(e.from); if (e.from === k.id) down.add(e.to); });
        nodeEls.forEach((o, oid) => {
          const on = oid === k.id || up.has(oid) || down.has(oid);
          o.rect.setAttribute('fill', oid === k.id ? 'rgba(239,159,39,.35)' : (on ? 'rgba(122,162,247,.3)' : 'rgba(122,162,247,.05)'));
          o.label.setAttribute('fill', on ? '#e7edf6' : '#565f89');
        });
        edgeEls.forEach((o) => {
          /* ⚠️ 主干是**多条边共用**的 → 只要组里有这条边涉及的点，整条主干就亮 ✓ */
          const on = o.ids.indexOf(k.id) >= 0;
          o.el.setAttribute('stroke-opacity', on ? .95 : .06);
          o.el.setAttribute('stroke-width', on ? 2 : 1);
        });
      });
    });
  });
  /* 点空白 → 复原 ✓ */
  svg.addEventListener('click', () => {
    nodeEls.forEach((o) => {
      o.rect.setAttribute('fill', 'rgba(122,162,247,.14)');
      o.label.setAttribute('fill', '#c0caf5');
    });
    edgeEls.forEach((o) => {
      o.el.setAttribute('stroke-opacity', o.kind === 'include' ? .4 : .55);
      o.el.setAttribute('stroke-width', 1.2);
    });
  });

  /* ── 图例（放在内容**下面**，不再压在卡片上）── */
  const lg = [['#EF9F27', '片段'], ['#7aa2f7', '函数'], ['#7aa2f7', '调用（实线）'], ['#8c9bb5', '包含 / include（虚线）']];
  const lh = 19, lx = Math.max(PAD, W - LEGEND_W - 14), ly = legendY;
  mk('rect', { x: lx, y: ly, width: LEGEND_W - 8, height: LEGEND_H, rx: 10,
    fill: 'rgba(18,20,28,.94)', stroke: '#2b3040', 'stroke-width': .8 });
  lg.forEach(([color, label], i) => {
    const cy = ly + 13 + i * lh;
    mk('rect', { x: lx + 12, y: cy - 5, width: 10, height: 10, rx: 3, fill: color });
    mk('text', { x: lx + 28, y: cy + 4, fill: '#8c9bb5', 'font-size': 12 }, label);
  });

  /* 提示一行（告诉用户怎么用 ✓）*/
  mk('text', { x: PAD, y: H - 14, fill: '#565f89', 'font-size': 12 },
    '点方块 → 高亮上下游 · 滚轮缩放 · 拖拽平移 · 双击适应窗口 · ' + L.fragCount + ' 个片段 / ' + L.fnCount + ' 个函数');

  svg.dataset.count = String(edgeEls.length);
  return svg;
}
