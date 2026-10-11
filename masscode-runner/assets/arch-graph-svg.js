/* ═══════════════════════════════════════════════════════════════════════════
 * 架构图 · 纯画图（assets/arch-graph-svg.js）
 * ---------------------------------------------------------------------------
 * ★ 从 arch-view.js 拆出来的（2026-10-11）—— 拆的**直接原因**是棘轮：
 *   `assets/arch-view.js ≤ 408 行`，加完「自由缩放 + 卡片折行」涨到 611 → 测试红。
 *   棘轮的规矩是「别为了让测试变绿而往上调」→ 拆 ✓。
 *
 *   拆的**天然边界**：这一半是**纯函数** ——
 *     输入一份 `/api/graph?scope=document` 的 JSON，
 *     输出一个 `<svg>` 元素，**不碰网络、不碰面板、没有全局状态**
 *     （所以 `tests/arch-geom.js` 能用 40 行假 DOM 直接跑它 ✓）。
 *   另一半（`arch-view.js`）是**面板集成**：抓数据 / 塞进 #cg-body / 缩放平移。
 *
 * ── 走线骨架：卡片 + 走廊 ──
 *   · 卡片**折行**排布，一行超过 MAX_ROW_W 就换行（调用方按面板宽传）；
 *   · **列宽对齐**（每列取该列最宽卡片）→ 列间隙**跨行贯通**，
 *     跨行的线就近在某个列间隙里上下走，不用绕到画布最外侧；
 *   · 卡片内左右两条**垂直走廊**，行与行之间是**水平通道**；
 *   · 0 函数的片段卡片**收窄**（只放标题）。
 *   ⇒ 水平段只落在「行通道」里、垂直段只落在「卡片内走廊 / 列间隙」里，
 *     **几何上不可能穿过任何方块**（Archify 说的 route clearance）。
 * ═══════════════════════════════════════════════════════════════════════════ */

function archFragOf(node) {
  const id = String(node.id || '');
  const parts = id.split('|');
  if (id.startsWith('f:')) return parts[parts.length - 1];   /* f:path|frag */
  if (id.startsWith('s:')) return parts[1];                   /* s:path|frag|line|kind|name */
  return '';
}

function archGraphSvg(graph, opts) {
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

  /* ── 骨架：**卡片 + 走廊** ──────────────────────────────────────────
     第一版错在：函数摆成横向网格、边只有「方块中心」一个锚点 →
     同层两个不相邻方块之间的线**几何上必然穿过中间的方块**，
     跨层的线没有通道可走，只能横穿整个画布。
     Archify 的 README 正好点名这个病：
       「shared automatic endpoints spread deterministically
         instead of piling arrows on one midpoint」
       「route / label-to-route clearance 必须全过」

     ★★ 2026-10-11 第二轮（用户：「无法自由放大缩小等，第二点，排布不合理」）★★
        原来 5 个片段**横向铺开 1494px**，侧栏只有 ~520px → 得滚半天才看得全；
        卡片还**顶对齐**，一个 9 函数的卡片旁边挂着两个空卡片，下面一大片空白。
        第三轮又发现：光折行还不够 ✗ —— 列不对齐的话，
        跨行的线只能**绕到画布最外侧**兜一大圈（实测 main.c → led.c 绕了 600px）。

     现在的骨架：
        ┌ 行通道（水平走线）─────────────────────────────┐
        │  laneL │ 函数方块（单列） │ laneR  │           │
        └────────────────────────────────────────────────┘
          ↑ 卡片内垂直走廊     ↑ 列间隙（跨行时在这里上下走）
        · 卡片**折行**排布，一行超过 MAX_ROW_W 就换行；
        · **列宽对齐**（每列取该列最宽卡片）→ 列间隙**跨行贯通** ✓
          → 跨行的线就近在某个列间隙里上下走，不用绕最外侧 ✓；
        · 行内**垂直居中**；0 函数的片段卡片**收窄**（只放标题）。
        ⇒ 水平段只落在「行通道」里、垂直段只落在「卡片内走廊 / 列间隙」里，
          **几何上不可能穿过任何方块** ✓（route clearance）。
        ⇒ 走廊宽度**先按负载算**，再摆方块 ✓
          （Archify：「Layout judgment over generic auto-layout」）。 */
  const CHIP_W = 176, CHIP_H = 30, CHIP_GAP = 9;
  const CARD_HEAD = 38, CARD_TAIL = 10;
  const COL_GAP = 30;                 /* 列间隙基准宽（会按负载加宽） */
  const LANE_BASE = 14, LANE_STEP = 6, LANE_MAX = 62;
  const SLOT = 6;
  const PAD = 24;
  const EMPTY_CARD_W = 148;           /* 0 函数的片段：只放标题 */
  /* 一行超过这个宽就折行。**调用方可以传**（renderArchIntoPane 按面板宽算）——
     固定值会让窄侧栏里的图要么太宽（缩放后字太小）要么太窄（高得离谱）✓。 */
  const MAX_ROW_W = Math.max(360, Number(opts && opts.maxRowW) || 820);
  const LEGEND_W = 186, LEGEND_H = 4 * 19 + 14;

  /* ① 一个片段 = 一张卡片 */
  const cards = [];
  const cardOf = new Map();
  const taken = new Set();
  fileNodes.forEach((f) => {
    const frag = archFragOf(f);
    const kids = fnByFrag.get(frag) || [];
    const card = { node: f, frag, kids };
    kids.forEach((k) => { cardOf.set(k.id, card); taken.add(k.id); });
    cardOf.set(f.id, card);            /* 卡片自身也可作端点（include）*/
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

  /* ② 路由计划：只做「哪些边不画」+「端点是方块还是卡片」 */
  const plan = [];
  edges.forEach((e) => {
    if (e.from === e.to) return;                     /* 自环不画 */
    /* ⚠️ `owns`（文件"拥有"函数）**不画线** —— 已由"函数装在卡片里"表达；
       实测某文档 57 条边里 29 条是 owns，纯重复信息，是"毛线"的主要来源。 */
    if (e.kind === 'owns') return;
    const a = cardOf.get(e.from), b = cardOf.get(e.to);
    if (!a || !b) return;
    plan.push({
      e, a, b, same: a === b,
      cardA: String(e.from).startsWith('f:'),
      cardB: String(e.to).startsWith('f:'),
    });
  });

  /* ③ 走廊宽度 —— ⚠️ 这里只能**估**：
        「走卡片哪一侧」要等列位置定下来才知道 ✓（那才是循环依赖）。
        按「一个卡片的边**两边各分一半**」估 ✓ ——
        估出来只会**偏宽**（实际每条走廊只用一半的边）✓，不会溢出 ✓。 */
  const perCard = new Map();
  plan.forEach((p) => {
    if (p.cardA || p.cardB) return;                  /* 卡片端点在顶边，不占内部走廊 */
    const ia = idxOf.get(p.a), ib = idxOf.get(p.b);
    perCard.set(ia, (perCard.get(ia) || 0) + 1);
    if (ib !== ia) perCard.set(ib, (perCard.get(ib) || 0) + 1);
  });
  const laneW = (i) => {
    const n = Math.ceil((perCard.get(i) || 0) / 2);
    return Math.max(LANE_BASE, Math.min(LANE_MAX, LANE_BASE + Math.max(0, n - 1) * LANE_STEP));
  };

  /* ④ 卡片尺寸 */
  cards.forEach((c, i) => {
    if (c.kids.length) {
      c.lw = c.rw = laneW(i);
      c.w = c.lw + CHIP_W + c.rw;
      c.h = CARD_HEAD + c.kids.length * CHIP_H + (c.kids.length - 1) * CHIP_GAP + CARD_TAIL;
    } else {
      /* 0 函数的片段（只被 include 的头文件）→ 卡片**收窄**，只放标题 ✓ */
      c.lw = c.rw = 0;
      c.w = EMPTY_CARD_W;
      c.h = CARD_HEAD + CARD_TAIL;
    }
  });

  /* ⑤ 折行 */
  const rows = [];
  {
    let cur = [], curW = 0;
    cards.forEach((c) => {
      const add = (cur.length ? COL_GAP : 0) + c.w;
      if (cur.length && curW + add > MAX_ROW_W) { rows.push(cur); cur = []; curW = 0; }
      curW += (cur.length ? COL_GAP : 0) + c.w;
      cur.push(c);
    });
    if (cur.length) rows.push(cur);
  }
  const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const rowOfCard = new Map(), colOfCard = new Map();
  rows.forEach((row, ri) => row.forEach((c, ci) => { rowOfCard.set(c, ri); colOfCard.set(c, ci); }));

  /* ⑥ 列宽对齐 + 行/间隙负载 */
  const colW = new Array(nCols).fill(0);
  cards.forEach((c) => { const ci = colOfCard.get(c); colW[ci] = Math.max(colW[ci], c.w); });
  const rowLoad = rows.map(() => 0);
  const gapLoad = new Array(nCols + 1).fill(0);      /* 0 = 最左外侧；nCols = 最右外侧；中间 = 列间隙 */
  plan.forEach((p) => {
    if (p.same) return;
    const r1 = rowOfCard.get(p.a), r2 = rowOfCard.get(p.b);
    rowLoad[r1] += 1;
    if (r2 === r1) return;                            /* 同一行：走行通道就够，不用列间隙 */
    rowLoad[r2] += 1;
    p.gap = Math.max(0, Math.min(nCols, Math.round((colOfCard.get(p.a) + colOfCard.get(p.b)) / 2)));
    gapLoad[p.gap] += 1;
  });
  const rowLaneH = rowLoad.map((n) => Math.max(26, 14 + n * 7));
  const gapW = gapLoad.map((n) => Math.max(22, 12 + n * 7));

  /* ⑦ 位置：列内居中、行内垂直居中 */
  const pos = new Map();
  const colX = new Array(nCols).fill(0);
  {
    let x = PAD + gapW[0];
    for (let i = 0; i < nCols; i++) {
      colX[i] = x;
      x += colW[i];
      if (i < nCols - 1) x += gapW[i + 1];
    }
  }
  const rowTop = [], laneY = [], rowH = [];
  let y = PAD;
  rows.forEach((row, ri) => {
    y += rowLaneH[ri];
    rowTop[ri] = y;
    laneY[ri] = y - rowLaneH[ri] / 2;
    const h = Math.max.apply(null, row.map((c) => c.h));
    rowH[ri] = h;
    row.forEach((c, ci) => {
      c.x = colX[ci] + (colW[ci] - c.w) / 2;
      c.y = y + (h - c.h) / 2;
    });
    y += h;
  });
  const contentBottom = rows.length ? y : PAD;
  const contentRight = nCols ? colX[nCols - 1] + colW[nCols - 1] : PAD;
  cards.forEach((c) => {
    c.kids.forEach((k, i) => {
      pos.set(k.id, {
        x: c.x + c.lw,
        y: c.y + CARD_HEAD + i * (CHIP_H + CHIP_GAP),
        w: CHIP_W, h: CHIP_H, row: i, card: c,
      });
    });
    pos.set(c.node.id, { x: c.x, y: c.y, w: c.w, h: CARD_HEAD, card: c });
  });

  const legendY = contentBottom + 24;
  const W = Math.max(680, contentRight + gapW[nCols] + PAD);
  const H = Math.max(340, legendY + LEGEND_H + 46);
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

  /* ⑧ 定「走哪一侧 / 走哪个列间隙」——**这时位置已知了** ✓ */
  const gapXOf = (g) => {
    if (g <= 0) return PAD + gapW[0] / 2;
    if (g >= nCols) return contentRight + gapW[nCols] / 2;
    return colX[g - 1] + colW[g - 1] + gapW[g] / 2;
  };
  plan.forEach((p) => {
    if (p.same) {
      /* 同卡片：看目标在上还是下、在左还是右，挑近的那条走廊 */
      p.side = 'R';
    } else {
      const r1 = rowOfCard.get(p.a), r2 = rowOfCard.get(p.b);
      if (r2 === r1) {
        const ca = p.a.x + p.a.w / 2, cb = p.b.x + p.b.w / 2;
        p.side = cb < ca ? 'L' : 'R';
        p.sideB = p.side;
      } else {
        const gx = gapXOf(p.gap);
        p.side = gx < (p.a.x + p.a.w / 2) ? 'L' : 'R';
        p.sideB = gx < (p.b.x + p.b.w / 2) ? 'L' : 'R';
      }
    }
    if (p.cardA) p.side = 'T';
    if (p.cardB) p.sideB = 'T';
    if (!p.sideB) p.sideB = p.side;
    p.keyA = idxOf.get(p.a) + p.side;
    p.keyB = idxOf.get(p.b) + p.sideB;
  });
  /* 走廊**真实**负载（估算的宽度只会偏宽，这里按真实条数分摊槽位 ✓）*/
  const realLoad = new Map();
  plan.forEach((p) => {
    if (p.cardA) { realLoad.set('p' + p.e.from, (realLoad.get('p' + p.e.from) || 0) + 1); }
    else realLoad.set(p.keyA, (realLoad.get(p.keyA) || 0) + 1);
    if (p.cardB) { realLoad.set('p' + p.e.to, (realLoad.get('p' + p.e.to) || 0) + 1); }
    else realLoad.set(p.keyB, (realLoad.get(p.keyB) || 0) + 1);
  });

  /* ⑨ 走线 —— 全部正交折线，段只落在走廊 / 通道里 */
  const edgeLayer = mk('g', {});
  const edgeEls = [];
  const usedSlot = new Map();
  const rowSlotUsed = new Map();
  const gapSlotUsed = new Map();
  const laneXOf = (card, side, key) => {
    const n = realLoad.get(key) || 1;
    const i = usedSlot.get(key) || 0;
    usedSlot.set(key, i + 1);
    const w = side === 'R' ? card.rw : card.lw;
    const step = n > 1 ? Math.min(SLOT, Math.max(2, (w - 6) / (n - 1))) : 0;
    const base = side === 'R' ? card.x + card.lw + CHIP_W + card.rw / 2 : card.x + card.lw / 2;
    return base + (i - (n - 1) / 2) * step;
  };
  const rowLaneY = (r) => {
    const n = rowLoad[r] || 1;
    const i = rowSlotUsed.get(r) || 0;
    rowSlotUsed.set(r, i + 1);
    const step = n > 1 ? Math.min(7, Math.max(2, (rowLaneH[r] - 8) / (n - 1))) : 0;
    return laneY[r] + (i - (n - 1) / 2) * step;
  };
  const gapLaneX = (g) => {
    const n = gapLoad[g] || 1;
    const i = gapSlotUsed.get(g) || 0;
    gapSlotUsed.set(g, i + 1);
    const step = n > 1 ? Math.min(7, Math.max(2, (gapW[g] - 8) / (n - 1))) : 0;
    return gapXOf(g) + (i - (n - 1) / 2) * step;
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
    const n = realLoad.get('p' + id) || 1;
    return card.x + card.w / 2 + (k - (n - 1) / 2) * 16;
  };
  /* 同一个函数出多条边 → 出口在它侧边上**上下错开** ✓ */
  const outY = (box, id) => {
    const k = portIdx.get('y' + id) || 0;
    portIdx.set('y' + id, k + 1);
    const off = Math.min(11, Math.round(k / 2) * 8) * (k % 2 ? -1 : 1);
    return box.y + box.h / 2 + off;
  };

  plan.forEach((p) => {
    const A = pos.get(p.e.from), B = pos.get(p.e.to);
    if (!A || !B) return;
    let d;
    if (p.same && !p.cardA && !p.cardB) {
      const by = B.y + B.h / 2;
      if (Math.abs(A.row - B.row) === 1) {
        /* 同一列上下相邻 → 一条竖线最干净 ✓ */
        const mx = stubX(A, p.e.from);
        d = A.row < B.row
          ? 'M' + mx + ' ' + (A.y + A.h) + ' L' + mx + ' ' + B.y
          : 'M' + mx + ' ' + A.y + ' L' + mx + ' ' + (B.y + B.h);
      } else {
        /* 同卡片不相邻 → 借本卡片靠那一侧的走廊绕一下 ✓ */
        const lx = laneXOf(p.a, p.side, p.keyA);
        const oy = outY(A, p.e.from);
        d = 'M' + outX(A, p.side) + ' ' + oy + ' L' + lx + ' ' + oy
          + ' L' + lx + ' ' + by + ' L' + outX(B, p.side) + ' ' + by;
      }
    } else {
      /* 跨卡片 → 卡片内走廊 → 本行通道 →（跨行时）列间隙 → 目标行通道 → 目标卡片内走廊 */
      const r1 = rowOfCard.get(p.a), r2 = rowOfCard.get(p.b);
      const aY = p.cardA ? A.y : outY(A, p.e.from);
      const bY = p.cardB ? B.y : outY(B, p.e.to);
      const aLane = p.cardA ? portX(A, p.e.from) : laneXOf(p.a, p.side, p.keyA);
      const bLane = p.cardB ? portX(B, p.e.to) : laneXOf(p.b, p.sideB, p.keyB);
      const ly1 = rowLaneY(r1);
      const ly2 = (r2 === r1) ? ly1 : rowLaneY(r2);
      d = 'M' + (p.cardA ? aLane : outX(A, p.side)) + ' ' + aY;
      if (!p.cardA) d += ' L' + aLane + ' ' + aY;
      d += ' L' + aLane + ' ' + ly1;
      if (r2 === r1) {
        d += ' L' + bLane + ' ' + ly1;
      } else {
        const gx = gapLaneX(p.gap);
        d += ' L' + gx + ' ' + ly1 + ' L' + gx + ' ' + ly2 + ' L' + bLane + ' ' + ly2;
      }
      d += ' L' + bLane + ' ' + bY;
      if (!p.cardB) d += ' L' + outX(B, p.sideB) + ' ' + bY;
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
    '点方块 → 高亮上下游 · 滚轮缩放 · 拖拽平移 · 双击适应窗口 · ' + cards.length + ' 个片段 / ' + fnNodes.length + ' 个函数');

  svg.dataset.count = String(edgeEls.length);
  return svg;
}
