/* ═══════════════════════════════════════════════════════════════════════════
 * 架构图 · 布局 + 走线（assets/arch-layout.js）—— **纯数据，不碰 DOM**
 * ---------------------------------------------------------------------------
 * ★ 从 arch-graph-svg.js 拆出来的（2026-10-11）—— 拆的**直接原因**是棘轮：
 *   `arch-graph-svg.js ≤ 467 行`，加完「主干合并（总线画法）」涨到 550 → 测试红。
 *   棘轮的规矩是「别为了让测试变绿而往上调」→ 拆 ✓。
 *
 *   拆的**天然边界**是这条管线：
 *       布局（方块放哪） → 走线（线怎么走） → 画出来（DOM）
 *     这一半是**前两段**：输入图 JSON，输出坐标 + 路径字符串，
 *     **一个 `document` 都不碰** ✓ —— 所以能直接在 Node 里断言 ✓。
 *   后一段（`arch-graph-svg.js`）只管把数据变成 `<svg>`。
 * ═══════════════════════════════════════════════════════════════════════════ */

function archFragOf(node) {
  const id = String(node.id || '');
  const parts = id.split('|');
  if (id.startsWith('f:')) return parts[parts.length - 1];   /* f:path|frag */
  if (id.startsWith('s:')) return parts[1];                   /* s:path|frag|line|kind|name */
  return '';
}

function archLayout(graph, opts) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];

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
  /* 一条「源 → 目标卡片」的线共享一条主干 → 用**组**当键 ✓
     （同组的多条边只占通道里的**一个**槽；按边算会高估 → 通道留一堆空槽、
       单独一条线被挤到一边不在正中 ✓）。 */
  const gkeyOf = (p) => p.e.from + '>' + (p.cardB ? 'C' + p.e.to : 'N' + idxOf.get(p.b))
    + '#' + (p.gap == null ? '-' : p.gap);
  const rowLoad = rows.map(() => 0);
  const gapLoad = new Array(nCols + 1).fill(0);      /* 0 = 最左外侧；nCols = 最右外侧；中间 = 列间隙 */
  {
    const counted = new Set();
    plan.forEach((p) => {
      if (p.same) return;
      const r1 = rowOfCard.get(p.a), r2 = rowOfCard.get(p.b);
      if (r2 !== r1) p.gap = Math.max(0, Math.min(nCols, Math.round((colOfCard.get(p.a) + colOfCard.get(p.b)) / 2)));
      const k = gkeyOf(p);
      if (counted.has(k)) return;
      counted.add(k);
      rowLoad[r1] += 1;
      if (r2 === r1) return;                          /* 同一行：走行通道就够，不用列间隙 */
      rowLoad[r2] += 1;
      gapLoad[p.gap] += 1;
    });
  }
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
  /* 走线 —— 全部正交折线，段只落在走廊 / 通道里。

     ★★ 2026-10-11 第三轮（用户：「感觉还是有些乱，**线条还是不够有序**」）★★
        最刺眼的是**梳子**：`main` 调 `led.c` 里 5 个函数 = 5 条平行线并排跑一大段 ✓。
        可它们本质上**共享同一条路径**，只是最后分叉到各自的函数 ✓。
        → 同一条「源 → 目标卡片」的线**合并成一条主干 + 若干短横档**（总线画法）：
            主干：源 → 卡片内走廊 → 本行通道 →（跨行时）列间隙 → 目标行通道 → 目标卡片内走廊
            横档：在目标函数那一行，从主干横出去一小段，进方块
          ⇒ 5 条长平行线变成 **1 条主干 + 5 个短横档** ✓。
        ⚠️ 主干**不带箭头**、横档**带箭头** —— 所以 `tests/arch-geom.js` 里
          「按 `marker-end` 数线」的口径不变 ✓（主干不会被算成一条边）。
        ⚠️ 横档**只画横向那一小段**，不重复画主干已覆盖的竖直段 ——
          否则同一段被画 N 次，透明度叠加，比主干深一截 ✓。 */

  /* 先按**空间位置**排序 —— 槽位按这个顺序分配，线不会互相穿插 ✓ */
  plan.sort((p, q) => {
    const a1 = pos.get(p.e.from), a2 = pos.get(q.e.from);
    const b1 = pos.get(p.e.to), b2 = pos.get(q.e.to);
    if (!a1 || !a2) return 0;
    return (a1.y - a2.y) || (a1.x - a2.x) || ((b1 ? b1.y : 0) - (b2 ? b2.y : 0));
  });

  /* 走廊**真实**负载 —— 按**组**算（同组共享一条主干，只占一个槽 ✓）。
     按边算会高估 → 通道里留一堆空槽 → 单独一条线被挤到一边、不在正中 ✓。 */
  const realLoad = new Map();
  {
    const seen = new Set();
    plan.forEach((p) => {
      const k = gkeyOf(p);
      if (seen.has(k)) return;
      seen.add(k);
      if (p.cardA) realLoad.set('p' + p.e.from, (realLoad.get('p' + p.e.from) || 0) + 1);
      else realLoad.set(p.keyA, (realLoad.get(p.keyA) || 0) + 1);
      if (p.cardB) realLoad.set('p' + p.e.to, (realLoad.get('p' + p.e.to) || 0) + 1);
      else realLoad.set(p.keyB, (realLoad.get(p.keyB) || 0) + 1);
    });
  }

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
  /* 同一个函数出多条边 → 出口在它侧边上**上下错开** ✓（按组，不按边）*/
  const outY = (box, id) => {
    const k = portIdx.get('y' + id) || 0;
    portIdx.set('y' + id, k + 1);
    const off = Math.min(11, Math.round(k / 2) * 8) * (k % 2 ? -1 : 1);
    return box.y + box.h / 2 + off;
  };

  /* ── 组：共享坐标只算一次（第一次遇到这条「源 → 目标卡片」时算）── */
  const groups = new Map();
  const groupOf = (p) => {
    const k = gkeyOf(p);
    const hit = groups.get(k);
    if (hit) return hit;
    const A = pos.get(p.e.from), B = pos.get(p.e.to);
    const g = { key: k, ids: [], stubs: [], n: 0, inc: p.e.kind === 'include' };
    if (p.same) {
      const oy = outY(A, p.e.from);
      const lx = laneXOf(p.a, p.side, p.keyA);
      g.trunkX = lx;
      g.juncY = oy;
      g.head = 'M' + outX(A, p.side) + ' ' + oy + ' L' + lx + ' ' + oy;
    } else {
      const r1 = rowOfCard.get(p.a), r2 = rowOfCard.get(p.b);
      const aY = p.cardA ? A.y : outY(A, p.e.from);
      const aLane = p.cardA ? portX(A, p.e.from) : laneXOf(p.a, p.side, p.keyA);
      const ly1 = rowLaneY(r1);
      const ly2 = (r2 === r1) ? ly1 : rowLaneY(r2);
      const gx = (r2 === r1) ? null : gapLaneX(p.gap);
      const bLane = p.cardB ? portX(B, p.e.to) : laneXOf(p.b, p.sideB, p.keyB);
      g.trunkX = bLane;
      g.juncY = ly2;
      g.head = 'M' + (p.cardA ? aLane : outX(A, p.side)) + ' ' + aY
        + (p.cardA ? '' : ' L' + aLane + ' ' + aY)
        + ' L' + aLane + ' ' + ly1
        + (r2 === r1
          ? ' L' + bLane + ' ' + ly1
          : ' L' + gx + ' ' + ly1 + ' L' + gx + ' ' + ly2 + ' L' + bLane + ' ' + ly2);
    }
    groups.set(k, g);
    return g;
  };

  const pending = [];
  plan.forEach((p) => {
    const A = pos.get(p.e.from), B = pos.get(p.e.to);
    if (!A || !B) return;
    const inc = p.e.kind === 'include';
    if (p.same && !p.cardA && !p.cardB && Math.abs(A.row - B.row) === 1) {
      /* 同一列上下相邻 → 一条竖线最干净 ✓（本来就唯一，不进组）*/
      const mx = stubX(A, p.e.from);
      pending.push({
        d: A.row < B.row
          ? 'M' + mx + ' ' + (A.y + A.h) + ' L' + mx + ' ' + B.y
          : 'M' + mx + ' ' + A.y + ' L' + mx + ' ' + (B.y + B.h),
        inc, marker: true, ids: [p.e.from, p.e.to],
      });
      return;
    }
    const g = groupOf(p);
    g.n += 1;
    g.ids.push(p.e.from, p.e.to);
    const bY = p.cardB ? B.y : outY(B, p.e.to);
    const bOut = p.cardB ? g.trunkX : outX(B, p.sideB);
    if (g.bMin == null || bY < g.bMin) g.bMin = bY;
    if (g.bMax == null || bY > g.bMax) g.bMax = bY;
    g.stubs.push({ bY, bOut, inc, ids: [p.e.from, p.e.to] });
  });

  /* 主干：竖直段**一次画到覆盖所有目标** ✓，横档只画横向那一小段 ✓ */
  groups.forEach((g) => {
    if (!g.stubs.length) return;
    const mkStub = (s) => (s.bOut === g.trunkX
      ? { d: '', inc: s.inc, marker: false, ids: s.ids }                    /* 目标就在主干上（卡片端点）*/
      : { d: 'M' + g.trunkX + ' ' + s.bY + ' L' + s.bOut + ' ' + s.bY, inc: s.inc, marker: true, ids: s.ids });
    if (g.n === 1) {
      const s = g.stubs[0];
      pending.push({
        d: g.head + ' L' + g.trunkX + ' ' + s.bY + (s.bOut === g.trunkX ? '' : ' L' + s.bOut + ' ' + s.bY),
        inc: s.inc, marker: true, ids: s.ids,
      });
      return;
    }
    const lo = Math.min(g.juncY, g.bMin), hi = Math.max(g.juncY, g.bMax);
    pending.push({
      d: g.head + ' L' + g.trunkX + ' ' + lo + ' L' + g.trunkX + ' ' + hi,
      inc: g.inc, marker: false, ids: g.ids,
    });
    g.stubs.forEach((s) => { const t = mkStub(s); if (t.d) pending.push(t); });
  });

  /* 布局 + 走线 → **纯数据**（一个 `document` 都不碰）✓ ——
     所以 `tests/arch-geom.js` 能直接断言这些坐标 / 路径字符串，连假 DOM 都不用 ✓。 */
  return {
    W, H, legendY, PAD, LEGEND_W, LEGEND_H, CHIP_W,
    cards, chipPos: pos, pending,
    fragCount: cards.length, fnCount: fnNodes.length,
  };
}
