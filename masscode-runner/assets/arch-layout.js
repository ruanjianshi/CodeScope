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

  /* ── 骨架：**卡片 + 走廊** ──
     卡片折行排布（列宽对齐 → 列间隙跨行贯通）、卡片内左右两条垂直走廊、行与行之间是水平通道。
     ⇒ 水平段只落在行通道里、垂直段只落在卡片内走廊 / 列间隙里，**几何上不可能穿方块** ✓。
     详见 CHANGELOG「第一 / 二 / 三 / 七轮」。 */
  /* ⚠️ 第八轮：用户选了「**更紧凑**」（原话：「整体太空」）—— 整体缩一圈：
     函数块 176×30→158×25、卡片头 38→32、列间隙 30→24、行通道 14+n·7→12+n·6、
     外边距 24→18、0 函数卡片 148→**104**（只放名字）。9 函数的卡片 390→**330** ✓。 */
  const CHIP_W = 158, CHIP_H = 25, CHIP_GAP = 6;
  const CARD_HEAD = 32, CARD_TAIL = 8;
  const COL_GAP = 24;                 /* 列间隙基准宽（会按负载加宽） */
  const LANE_BASE = 12, LANE_STEP = 7, LANE_MAX = 72;
  const SLOT = 8;
  const PAD = 18;
  const EMPTY_CARD_W = 104;           /* 0 函数的片段：只放标题 */
  /* 一行超过这个宽就折行。**调用方可以传**（renderArchIntoPane 按面板宽算）——
     固定值会让窄侧栏里的图要么太宽（缩放后字太小）要么太窄（高得离谱）✓。 */
  const MAX_ROW_W = Math.max(360, Number(opts && opts.maxRowW) || 820);
  const LEGEND_W = 168, LEGEND_H = 4 * 17 + 12;

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

  /* ③ 走廊宽度按**真实左右负载**分别算 ✗（原来两边都按「总边数 / 2」估 ✓，
        但同卡片的边**一律走右** ✗ → 右边按一半宽度做、却要塞全部同卡片边 ✓ → 挤成一团 ✓）。
        同卡片的边**不需要位置**就能定侧 ✓ → 全额算右边 ✓；跨卡片只能各半估 ✓。 */
  const perSide = new Map();
  const bump = (k, v) => perSide.set(k, (perSide.get(k) || 0) + v);
  plan.forEach((p) => {
    if (p.cardA || p.cardB) return;                  /* 卡片端点在顶边，不占内部走廊 */
    const ia = idxOf.get(p.a), ib = idxOf.get(p.b);
    if (ia === ib) { bump(ia + 'R', 1); return; }
    bump(ia + 'L', 0.5); bump(ia + 'R', 0.5); bump(ib + 'L', 0.5); bump(ib + 'R', 0.5);
  });
  const laneW = (key) => {
    const n = Math.ceil(perSide.get(key) || 0);
    return Math.max(LANE_BASE, Math.min(LANE_MAX, LANE_BASE + Math.max(0, n - 1) * LANE_STEP));
  };

  /* ④ 卡片尺寸 */
  cards.forEach((c, i) => {
    if (c.kids.length) {
      c.lw = laneW(i + 'L'); c.rw = laneW(i + 'R');
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
  /* ⚠️ 贪心折行会把**最后一行留成"几乎空的"** ✗（用户截图：4 张一行 + 1 张一行）——
     折完**平衡一下**：把最宽那行的**尾卡**挪到最窄那行，直到两边差不多宽 ✓。
     （最多挪 8 次防震荡；只挪尾卡 → 阅读顺序基本不变 ✓。） */
  if (rows.length > 1) {
    for (let guard = 0; guard < 8; guard++) {
      const w = rows.map((r) => r.reduce((a, c) => a + c.w, 0) + Math.max(0, r.length - 1) * COL_GAP);
      const wi = w.indexOf(Math.max.apply(null, w)), ni = w.indexOf(Math.min.apply(null, w));
      const mv = rows[wi][rows[wi].length - 1];
      if (wi === ni || rows[wi].length < 2 || w[wi] - mv.w <= w[ni] + mv.w) break;
      rows[wi].pop(); rows[ni].push(mv);
    }
  }
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
      /* ⚠️⚠️ 同一列时 `round((ca+cb)/2)` 就等于 `ca` ✓ —— 而 `ca = 0` 是**最左外侧通道** ✗，
         线于是要**绕到所有卡片左边**再上去 ✓（实测一条 882px 的"大环"✓，
         在图上看着像凭空多了个虚线框 ✓）。同一列 → 取**右边那条间隙** ✓。 */
      if (r2 !== r1) {
        const ca = colOfCard.get(p.a), cb = colOfCard.get(p.b);
        p.gap = (ca === cb) ? Math.min(nCols, ca + 1)
          : Math.max(0, Math.min(nCols, Math.round((ca + cb) / 2)));
      }
      const k = gkeyOf(p);
      if (counted.has(k)) return;
      counted.add(k);
      rowLoad[r1] += 1;
      if (r2 === r1) return;                          /* 同一行：走行通道就够，不用列间隙 */
      rowLoad[r2] += 1;
      gapLoad[p.gap] += 1;
    });
  }
  const rowLaneH = rowLoad.map((n) => Math.max(22, 12 + n * 6));
  const gapW = gapLoad.map((n) => Math.max(18, 10 + n * 6));

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
      /* ⚠️ 卡片**顶对齐**（原来是行内居中 ✗）—— 居中时矮卡会**悬在行中间** ✓，
         因为行高由最高的卡决定 ✓；顶对齐后卡片头落在同一条线上 ✓，还顺带把线变短 ✓。
         详见 CHANGELOG「第七轮」。 */
      c.y = y;
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
      p.side = 'R';   /* 同卡片一律走右侧走廊（试过左右分走，断言红了 → 先回退）*/
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
     ★ 同一条「源 → 目标卡片」的线**合并成一条主干 + 若干短横档**（总线画法）——
       主干不带箭头、横档带箭头 ✓，所以「按 marker-end 数线」的口径不变 ✓。
       横档**只画横向那一小段** ✗（重复画竖直段会让透明度叠加、比主干深一截 ✓）。
       详见 CHANGELOG「第三轮」。 */

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
    const half = Math.max(0, (w - 6) / 2);   /* 槽位偏移钳在走廊里（漏过一次 ✓）*/
    const off = (i - (n - 1) / 2) * step;
    return base + Math.max(-half, Math.min(half, off));
  };
  /* ⚠️⚠️ 槽位偏移**必须钳在通道带内** ✗✗ ——
     偏移是 `(i - (n-1)/2) * step` ✓，边一多（n 大）就会**散出通道带** ✓，
     于是水平段落到**旁边卡片身上** ✓（穿块断言抓到了 ✓）。
     钳到半宽/半高之内 ✓，最多是槽位挤一点 ✓，但绝不会跑到卡片上 ✓。 */
  const rowLaneY = (r) => {
    const n = rowLoad[r] || 1;
    const i = rowSlotUsed.get(r) || 0;
    rowSlotUsed.set(r, i + 1);
    const step = n > 1 ? Math.min(7, Math.max(2, (rowLaneH[r] - 8) / (n - 1))) : 0;
    const half = Math.max(0, (rowLaneH[r] - 10) / 2);
    const off = (i - (n - 1) / 2) * step;
    return laneY[r] + Math.max(-half, Math.min(half, off));
  };
  const gapLaneX = (g) => {
    const n = gapLoad[g] || 1;
    const i = gapSlotUsed.get(g) || 0;
    gapSlotUsed.set(g, i + 1);
    const step = n > 1 ? Math.min(7, Math.max(2, (gapW[g] - 8) / (n - 1))) : 0;
    const half = Math.max(0, (gapW[g] - 10) / 2);
    const off = (i - (n - 1) / 2) * step;
    return gapXOf(g) + Math.max(-half, Math.min(half, off));
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
      /* ⚠️⚠️ 卡片端点用的是 `pos` 里的**头部条**盒子（h = CARD_HEAD）✗，
         **不是整张卡片** ✓ —— 所以要用 `A.card` / `B.card` 拿真高度 ✓
         （拿头部条的话 `y + h` 落在卡片**中间** ✓，箭头就贴不到边 ✓）。 */
      const cA = A.card || A, cB = B.card || B;
      /* ⚠️⚠️ 判反过一次 ✗：目标是**在下面**（r2 > r1）才从**底边**出 ✓；
         目标在**上面**要从**顶边**出 ✓。写成 `r2 < r1 ? 底边 : 顶边` 就反了 ✓ ——
         于是线从底边出发、却要往上去够**卡片上方**的通道 ✓ → **穿过整张卡片** ✓
         （穿块断言抓到了 ✓）。 */
      const aY = p.cardA ? (r2 > r1 ? cA.y + cA.h : cA.y) : outY(A, p.e.from);
      const aLane = p.cardA ? portX(cA, p.e.from) : laneXOf(p.a, p.side, p.keyA);
      /* ⚠️⚠️ 通道必须和**出口在同一侧** ✗✗ —— 这条我错了两次 ✓：
         · 源端从**底边**出（目标在下面）→ 通道必须是**源下方**那条 = `laneY[r1+1]` ✓，
           用 `laneY[r1]`（源**上方**那条）就会**从底边往上穿过整张卡片** ✗；
         · 目标端从**顶边**进（目标在下面）→ 通道是**目标上方**那条 = `laneY[r2]` ✓，
           反了就会从下面穿过目标卡片去够顶边 ✗。
         ⇒ 统一成：`ly1 = laneY[down ? r1+1 : r1]`、`ly2 = laneY[down ? r2 : r2+1]` ✓。
         ⇒ 同行 / 相邻行时这两条**是同一条** ✓ → 只取一次（省两个弯）✓，
           不用绕列间隙 ✓。 */
      const down = r2 > r1;
      const near = Math.abs(r2 - r1) <= 1;
      let ly1, ly2, gx = null;
      if (near) {
        ly1 = ly2 = rowLaneY(r2 === r1 ? r1 : (down ? r2 : r1));
      } else {
        ly1 = rowLaneY(down ? r1 + 1 : r1);
        ly2 = rowLaneY(down ? r2 : r2 + 1);
        gx = gapLaneX(p.gap);
      }
      const bLane = p.cardB ? portX(cB, p.e.to) : laneXOf(p.b, p.sideB, p.keyB);
      g.trunkX = bLane;
      g.juncY = ly2;
      g.head = 'M' + (p.cardA ? aLane : outX(A, p.side)) + ' ' + aY
        + (p.cardA ? '' : ' L' + aLane + ' ' + aY)
        + ' L' + aLane + ' ' + ly1
        + (near
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
    /* ⚠️⚠️ 卡片端点：**从上面来就进顶边、从下面来就进底边** ✗✓ ——
       一律用顶边的话，从下面上来的线会**穿过整张卡片**去够顶边 ✓
       （穿块断言和"箭头指向"断言同时抓到了 ✓）。
       ⚠️ 而且必须用**整张卡片** `B.card` 的高度 ✗ ——
          `B` 是 `pos` 里的**头部条**（h = CARD_HEAD = 38）✓，
          `B.y + B.h` 落在卡片**中间** ✓，箭头就贴不到边 ✓。 */
    const cB = B.card || B;
    const bY = p.cardB ? (g.juncY <= cB.y ? cB.y : cB.y + cB.h) : outY(B, p.e.to);
    const bOut = p.cardB ? g.trunkX : outX(B, p.sideB);
    if (g.bMin == null || bY < g.bMin) g.bMin = bY;
    if (g.bMax == null || bY > g.bMax) g.bMax = bY;
    g.stubs.push({ bY, bOut, inc, ids: [p.e.from, p.e.to] });
  });

  /* 主干：从**笔当前的位置**（`juncY` ✓）往**远端**画 ✓ —— 原来画 `lo → hi` 会折返 ✓。 */
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
    const far = g.juncY < g.bMin ? [g.bMax] : g.juncY > g.bMax ? [g.bMin] : [g.bMin, g.bMax];
    pending.push({
      d: g.head + far.map((y) => ' L' + g.trunkX + ' ' + y).join(''),
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

/* 挑折行宽度 —— 用户要「按片段顺序横向排开」→ **优先一行放完**（宽了横向滚动 ✓）；离谱才折行 ✗。 */
function archBestRowW(graph, panelW, panelH) {
  if (archLayout(graph, { maxRowW: 1e6 }).W <= panelW * 2.5) return 1e6;
  let best = panelW * 1.2, score = Infinity;
  [0.7, 1.0, 1.5, 2.2].forEach((k) => {
    const L = archLayout(graph, { maxRowW: Math.max(360, panelW * k) });
    const d = Math.abs(Math.log((L.W / L.H) / (panelW / Math.max(1, panelH))));
    if (d < score) { score = d; best = Math.max(360, panelW * k); }
  });
  return best;
}
