/* ═══════════════════════════════════════════════════════════════════════════
 * 架构视图（assets/arch-view.js）
 * ---------------------------------------------------------------------------
 * ★ 从 app.js 抽出来的（2026-10-11）。
 *   抽出来的**直接原因**是 `tests/architecture.js` 的**棘轮**：
 *     `assets/app.js ≤ 16581 行` —— 我这一版重写走线，app.js 涨到 16737 ✓，
 *     测试直接红 ✓。棘轮注释写得很明白：
 *       「别为了让测试变绿而往上调 —— 那就把棘轮拆了」
 *   → 所以是**抽模块**，不是**调上限** ✓（和之前抽 debug-panel.js 一样的做法）。
 *
 *   抽出来的**实质原因**：这一块和 app.js 的其余部分**耦合很松** ——
 *     输入是一份 `/api/graph?scope=document` 的 JSON ✓，
 *     输出是一个 `<svg>` 元素 ✓，纯函数 ✓，没有全局状态 ✓。
 *     （唯一的两个外部依赖是 `CG_SEQ` / `CURRENT` / `$`，都是 app.js 的顶层绑定，
 *       加载顺序无所谓：函数体在**调用时**才去找它们 ✓。）
 *
 * ── 这里装什么 ──
 *   archFragOf(node)            id → 片段号（分组用）
 *   archGraphSvg(graph)         图 JSON → SVG 元素（**布局 + 走线全在这**）
 *   renderArchIntoPane(body)    抓数据 + 塞进 #cg-body
 *
 * ── 面板切换按钮（🕸 图谱 / ▦ 架构）仍在 app.js ──
 *   因为那两个按钮要跟 `CG_ACTIVE` / `renderCodeGraphPane` / 工具栏拧在一起，
 *   搬过来反而更绕 ✓。
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── 架构图（文档级）· 和「图谱」同一份数据，另一种画法 ──
   ★ 2026-10-11 新增 ✓，当天改过两轮 ✓。用户原话：
     第一轮：「和图谱那种，整合进图谱那种，自动分析当前文件里面的片段的可交互架构图」
     第二轮：「**放这个图谱里面，可以通过按钮切换**」
             「目前的这个架构图**不行，无法交互**，差的太多了」

   现在的形态：
     · 和「图谱」**同一个面板**（#cg-canvas / #cg-body），
       工具栏上两个按钮切换（🕸 图谱 / ▦ 架构）✓ —— 不另开浮层 ✗；
     · 数据源完全一样（/api/graph?scope=document）✓；
     · **点节点会高亮它和它的上下游** ✓（这就是"可交互"）。

   ⚠️⚠️ 第一版分组是错的 ✗✗（用户截图里每个文件都列出全部函数）——
      我按 `n.file` 分组 ✓，但**所有节点的 `file` 都是同一个文档** ✓，
      于是每个文件都拿到同一份完整函数表 ✓。
      **正确做法是按「片段」分组** ✓ —— 片段序号藏在 id 里：
        file 节点 id = `f:<路径>|<片段号>`
        fn   节点 id = `s:<路径>|<片段号>|<行号>|fn|<名字>`
      → 用 id 里那个片段号配对 ✓（比按 label 猜可靠 ✓）。 */
function archFragOf(node) {
  const id = String(node.id || '');
  const parts = id.split('|');
  if (id.startsWith('f:')) return parts[parts.length - 1];   /* f:path|frag */
  if (id.startsWith('s:')) return parts[1];                   /* s:path|frag|line|kind|name */
  return '';
}

function archGraphSvg(graph) {
  const NS = 'http://www.w3.org/2000/svg';
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const svg = document.createElementNS(NS, 'svg');
  const mk = (tag, attrs, text, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = String(text);
    (parent || svg).appendChild(n);
    return n;
  };

  /* ★ 按**片段**分组（不是按 file —— 同一文档里所有节点的 file 都一样）*/
  const fileNodes = nodes.filter((n) => n.kind === 'file');
  const fnNodes = nodes.filter((n) => n.kind === 'fn');
  const fnByFrag = new Map();
  fnNodes.forEach((n) => {
    const k = archFragOf(n);
    if (!fnByFrag.has(k)) fnByFrag.set(k, []);
    fnByFrag.get(k).push(n);
  });

  /* ── 尺寸 ──────────────────────────────────────────────────────────
     ★★ 骨架是「**卡片 + 走廊**」，不是「网格 + 中心锚点」★★
        这一版之前错在哪：函数摆成横向网格、边只有「方块中心」一个锚点 →
        同层两个不相邻方块之间的线**几何上必然穿过中间的方块**，
        跨层的线又没有通道可走，只能横穿整个画布（实测 57 条边里 32 条穿块、
        最长一条跨 773px）。Archify 的 README 正好点名这个病：
          「shared automatic endpoints spread deterministically
            instead of piling arrows on one midpoint」
          「route / label-to-route clearance 必须全过」

        现在的骨架：
          ┌─ 卡片（一个片段）──────────────────┐
          │ laneL │  函数方块（单列）  │ laneR │
          └───────────────────────────────────┘
            ↑ 卡片内的**垂直走廊**，边在这里上下走
          卡片**横向并排**（宽度整齐，不再宽窄不一）；
          卡片**上方**留一条水平走廊 TOP_H —— 跨卡片的边走那里。

        ⇒ 每条边的水平段只出现在走廊里、垂直段也只出现在走廊里，
          **几何上不可能穿过任何方块** ✓（这就是 route clearance）。
        ⇒ 走廊宽度**先按负载算**（几条边要走它 → 多宽），再摆方块 ✓
          （Archify：「Layout judgment over generic auto-layout」——
           先决定通道，再决定块，不是摆完块让线自己找路）。 */
  const CHIP_W = 176, CHIP_H = 30, ROW_GAP = 9;
  const CARD_HEAD = 40, CARD_TAIL = 12;
  const CARD_GAP_X = 46;
  const PAD = 26;
  const LANE_BASE = 14, LANE_STEP = 6, LANE_MAX = 62;
  const SLOT = 6;
  const LEGEND_W = 190;

  /* ① 一个片段 = 一张卡片 */
  const cards = [];
  const cardOf = new Map();
  const taken = new Set();
  fileNodes.forEach((f) => {
    const frag = archFragOf(f);
    const kids = fnByFrag.get(frag) || [];
    const card = { node: f, frag, kids };
    kids.forEach((k) => { cardOf.set(k.id, card); taken.add(k.id); });
    cardOf.set(f.id, card);            /* 卡片自身也可作端点（include：卡片→卡片）*/
    cards.push(card);
  });
  const rest = fnNodes.filter((n) => !taken.has(n.id));
  if (rest.length) {
    const card = { node: { id: '__orphan', label: '（未归类）', kind: 'file' }, frag: '__orphan', kids: rest };
    rest.forEach((k) => cardOf.set(k.id, card));
    cards.push(card);
  }
  const idxOf = new Map();
  cards.forEach((c, i) => idxOf.set(c, i));

  /* ② 路由计划 —— **必须先算**：走廊要多宽取决于有多少条边走它 */
  const plan = [];
  edges.forEach((e, i) => {
    if (e.from === e.to) return;                     /* 自环不画 */
    /* ⚠️ `owns`（文件"拥有"函数）**不画线** —— 已由"函数装在卡片里"表达；
       实测某文档 57 条边里 29 条是 owns，纯重复信息，是"毛线"的主要来源。 */
    if (e.kind === 'owns') return;
    const a = cardOf.get(e.from), b = cardOf.get(e.to);
    if (!a || !b) return;
    const same = a === b;
    const ia = idxOf.get(a), ib = idxOf.get(b);
    /* 端点是"卡片本身"（include）→ 从**卡片顶边中点**进出 */
    const cardA = String(e.from).startsWith('f:'), cardB = String(e.to).startsWith('f:');
    let sideA, sideB;
    if (cardA) sideA = 'T';
    else if (same) sideA = (i % 2 === 0) ? 'R' : 'L';
    else sideA = ia < ib ? 'R' : 'L';
    if (cardB) sideB = 'T';
    else if (same) sideB = sideA;
    else sideB = ia < ib ? 'L' : 'R';
    plan.push({ e, a, b, same, ia, ib, sideA, sideB, cardA, cardB,
      keyA: ia + sideA, keyB: ib + sideB });
  });
  const load = new Map();
  plan.forEach((p) => {
    load.set(p.keyA, (load.get(p.keyA) || 0) + 1);
    if (p.keyB !== p.keyA) load.set(p.keyB, (load.get(p.keyB) || 0) + 1);
  });
  /* 卡片端点（include）也要分散 —— 别让 4 条线都扎在卡片顶边正中间 */
  const cardPortLoad = new Map();
  plan.forEach((p) => {
    if (p.cardA) cardPortLoad.set(p.e.from, (cardPortLoad.get(p.e.from) || 0) + 1);
    if (p.cardB) cardPortLoad.set(p.e.to, (cardPortLoad.get(p.e.to) || 0) + 1);
  });
  const cross = plan.filter((p) => !p.same).length;
  const TOP_H = Math.max(30, 16 + cross * 6);
  const laneW = (key) => {
    const n = load.get(key) || 0;
    return Math.max(LANE_BASE, Math.min(LANE_MAX, LANE_BASE + Math.max(0, n - 1) * LANE_STEP));
  };

  /* ③ 布局：卡片横向并排，函数在卡片里**单列**（单列才不会横向穿邻居） */
  const pos = new Map();
  const topY = PAD;
  let cx = PAD, maxH = 0;
  cards.forEach((c, ci) => {
    c.lw = laneW(ci + 'L');
    c.rw = laneW(ci + 'R');
    c.x = cx;
    c.y = PAD + TOP_H;
    c.w = c.lw + CHIP_W + c.rw;
    c.rows = Math.max(1, c.kids.length);
    /* 一个函数都没有的片段（比如只被 include 的头文件）→ 卡片压扁，别占一片空白 */
    c.h = CARD_HEAD + CARD_TAIL
      + (c.kids.length ? c.rows * CHIP_H + (c.rows - 1) * ROW_GAP : 0);
    c.laneLx = c.x + c.lw / 2;
    c.laneRx = c.x + c.lw + CHIP_W + c.rw / 2;
    c.chipX = c.x + c.lw;
    c.kids.forEach((k, i) => {
      pos.set(k.id, {
        x: c.chipX, y: c.y + CARD_HEAD + i * (CHIP_H + ROW_GAP),
        w: CHIP_W, h: CHIP_H, row: i, card: c,
      });
    });
    pos.set(c.node.id, { x: c.x, y: c.y, w: c.w, h: CARD_HEAD, card: c });
    cx += c.w + CARD_GAP_X;
    maxH = Math.max(maxH, c.h);
  });
  const W = Math.max(720, cx - CARD_GAP_X + PAD + LEGEND_W);
  const H = Math.max(360, PAD + TOP_H + maxH + 66);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
  /* ⚠️ 必须给**明确像素宽** —— 「⤢ 放大」把 SVG 克隆进浮层，克隆体没有父容器约束，
     `width:100%` 会退化成极小值。明确 px + `max-width:100%` 两处都对。 */
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('style', 'background:#12141c;border-radius:10px;display:block;max-width:100%;height:auto');

  /* ④ 走线 —— 全部正交折线，段只落在走廊里 */
  const edgeLayer = mk('g', {});
  const edgeEls = [];
  const usedSlot = new Map();
  let topSlot = 0;
  /* 同一条走廊里的第 i 条边 → 走廊内的第 i 个子通道 ✓（确定性分散） */
  const laneX = (card, side, key) => {
    const n = load.get(key) || 1;
    const i = usedSlot.get(key) || 0;
    usedSlot.set(key, i + 1);
    const w = laneW(key);
    const step = n > 1 ? Math.min(SLOT, Math.max(2, (w - 6) / (n - 1))) : 0;
    const base = side === 'R' ? card.laneRx : card.laneLx;
    return base + (i - (n - 1) / 2) * step;
  };
  const outX = (box, side) => (side === 'R' ? box.x + box.w : box.x);
  /* 相邻函数之间的竖线：同一个节点的多条竖线要错开，否则叠成一条 ✓ */
  const stubIdx = new Map();
  const stubX = (box, id) => {
    const k = stubIdx.get(id) || 0;
    stubIdx.set(id, k + 1);
    return box.x + box.w / 2 + ((k % 3) - 1) * 9;
  };
  /* 卡片顶边上的第 i 个端口（同卡片多条 include 时横向散开 ✓） */
  const portIdx = new Map();
  const portX = (card, id) => {
    const k = portIdx.get(id) || 0;
    portIdx.set(id, k + 1);
    const n = cardPortLoad.get(id) || 1;
    return card.x + card.w / 2 + (k - (n - 1) / 2) * 16;
  };
  /* 同一个函数出多条边 → 出口在它右边上**上下错开** ✓（不然全从中心一点冒出） */
  const outY = (box, id) => {
    const k = portIdx.get('y' + id) || 0;
    portIdx.set('y' + id, k + 1);
    const off = Math.min(11, Math.round(k / 2) * 8) * (k % 2 ? -1 : 1);
    return box.y + box.h / 2 + off;
  };

  plan.forEach((p) => {
    const A = pos.get(p.e.from), B = pos.get(p.e.to);
    if (!A || !B) return;
    const ay = A.y + A.h / 2, by = B.y + B.h / 2;
    let d;
    if (p.cardA || p.cardB) {
      /* 卡片 → 卡片（include）→ 从卡片**顶边中点**上去，走顶部水平走廊 ✓ */
      const ax = p.cardA ? portX(A, p.e.from) : outX(A, p.sideA);
      const bx = p.cardB ? portX(B, p.e.to) : outX(B, p.sideB);
      const aTop = p.cardA ? A.y : ay, bTop = p.cardB ? B.y : by;
      const ty = topY + 10 + (topSlot++) * 6;
      d = 'M' + ax + ' ' + aTop + ' L' + ax + ' ' + ty
        + ' L' + bx + ' ' + ty + ' L' + bx + ' ' + bTop;
    } else if (p.same && Math.abs(A.row - B.row) === 1) {
      /* 同一列上下相邻 → 一条竖线最干净 ✓（也绝不会穿到别处） */
      const mx = stubX(A, p.e.from);
      d = A.row < B.row
        ? 'M' + mx + ' ' + (A.y + A.h) + ' L' + mx + ' ' + B.y
        : 'M' + mx + ' ' + A.y + ' L' + mx + ' ' + (B.y + B.h);
    } else if (p.same) {
      /* 同卡片不相邻 → 借本卡片靠那一侧的走廊绕一下 ✓ */
      const lx = laneX(p.a, p.sideA, p.keyA);
      const oy = outY(A, p.e.from);
      d = 'M' + outX(A, p.sideA) + ' ' + oy + ' L' + lx + ' ' + oy
        + ' L' + lx + ' ' + by + ' L' + outX(B, p.sideB) + ' ' + by;
    } else {
      /* 跨卡片 → 从源卡片的走廊上去，走**卡片上方的水平走廊**，
         再下到目标卡片的走廊 ✓（横穿整个画布也不会碰到任何方块） */
      const lx1 = laneX(p.a, p.sideA, p.keyA);
      const lx2 = laneX(p.b, p.sideB, p.keyB);
      const ty = topY + 10 + (topSlot++) * 6;
      const oy = outY(A, p.e.from);
      d = 'M' + outX(A, p.sideA) + ' ' + oy + ' L' + lx1 + ' ' + oy
        + ' L' + lx1 + ' ' + ty + ' L' + lx2 + ' ' + ty
        + ' L' + lx2 + ' ' + by + ' L' + outX(B, p.sideB) + ' ' + by;
    }
    const inc = p.e.kind === 'include';
    const path = mk('path', {
      d,
      fill: 'none',
      stroke: inc ? '#8c9bb5' : '#7aa2f7',
      'stroke-opacity': inc ? .45 : .6,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
      ...(inc ? { 'stroke-dasharray': '4 4' } : {}),
      'marker-end': 'url(#arch-arrow)',
    }, null, edgeLayer);
    edgeEls.push({ el: path, from: p.e.from, to: p.e.to, kind: p.e.kind });
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
    mk('text', { x: c.x + 14, y: c.y + 26, fill: '#EF9F27', 'font-size': 14, 'font-weight': 500 },
      String(c.node.label || '').slice(0, 22), nodeLayer);
    mk('text', { x: c.x + c.w - 14, y: c.y + 26, fill: '#8a7350', 'font-size': 11, 'text-anchor': 'end' },
      c.kids.length + ' 个函数', nodeLayer);
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
          const on = o.from === k.id || o.to === k.id;
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

  /* ── 图例 ── */
  const lg = [['#EF9F27', '片段'], ['#7aa2f7', '函数'], ['#7aa2f7', '调用（实线）'], ['#8c9bb5', '包含 / include（虚线）']];
  const lh = 19, lx = W - LEGEND_W - 14, ly = H - lg.length * lh - 24;
  mk('rect', { x: lx, y: ly, width: LEGEND_W - 8, height: lg.length * lh + 14, rx: 10,
    fill: 'rgba(18,20,28,.94)', stroke: '#2b3040', 'stroke-width': .8 });
  lg.forEach(([color, label], i) => {
    const cy = ly + 13 + i * lh;
    mk('rect', { x: lx + 12, y: cy - 5, width: 10, height: 10, rx: 3, fill: color });
    mk('text', { x: lx + 28, y: cy + 4, fill: '#8c9bb5', 'font-size': 12 }, label);
  });

  /* 提示一行（告诉用户能点 ✓）*/
  mk('text', { x: PAD, y: H - 16, fill: '#565f89', 'font-size': 12 },
    '点任意方块 → 高亮它的上下游 · 点空白处复原 · ' + cards.length + ' 个片段 / ' + fnNodes.length + ' 个函数');

  svg.dataset.count = String(edgeEls.length);
  return svg;
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
    const svg = archGraphSvg(graph);
    body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'doc-graph';
    host.style.cssText = 'overflow:auto;padding:10px 12px 16px';
    host.appendChild(svg);
    body.appendChild(host);
    /* ⚠️ 图比侧栏宽时**别缩**（1572px 缩进 490px 面板 = 31%，字变 4px 没法看）→
       原始尺寸 + 横向滚动；图本身不宽才跟着面板走 ✓（详见 CHANGELOG）。 */
    const svgW = Number(svg.getAttribute('width')) || 0;
    if (svgW && host.clientWidth && svgW > host.clientWidth + 24) svg.style.maxWidth = 'none';
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
