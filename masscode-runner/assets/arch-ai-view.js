/* ═══════════════════════════════════════════════════════════════════════════
 * 架构图 · AI 视图（assets/arch-ai-view.js）
 * ---------------------------------------------------------------------------
 * ★ 2026-10-11 新增。用户原话：
 *     「**缺少了很多 archify 该有的功能，没有接入 AI 去分析，解析出架构图等等**」
 *
 *   对照真正的 Archify 输出，它有两层，我之前只做了第二层：
 *     ① **语义层** —— 节点标题、2~3 条自然语言要点、**语义边界**（"执行策略边界"这种）、
 *        边上的理由。这些**机械调用图给不出来**，只能让模型读代码 ✓
 *        （服务端在 `lib/arch/ai.js` + `POST /api/arch/ai` ✓）。
 *     ② **视觉层** —— 卡片（图标 / 标题 / 要点 / 徽章）+ **虚线边界框** + 网格底
 *        + 着色边 + 标题栏。**就是这个文件** ✓。
 *
 * ── 为什么单独一个文件，而不是塞进 arch-graph-svg.js ──
 *   这是**另一种视图**，不是原来那个的微调 ✓：
 *     · 原来的图是「片段 → 函数」两级，边是函数→函数（所以要走廊、主干那套 ✓）；
 *     · 这张图是「边界 → 模块」两级，**边是模块→模块**（聚合过的 ✓）——
 *       和 Archify 一样，一张图上不该有几十条线 ✓。
 *   两者的骨架、尺寸、语义都不一样，硬合在一起只会互相牵制 ✓。
 *   ⚠️ 而且 `arch-graph-svg.js` 顶到棘轮了 —— 新功能进新文件 ✓。
 *
 * ── 布局 ──
 *   ┌ 边界 A ──────────────────────────────┐
 *   │  ┌────────┐   ┌────────┐            │   ← 卡片：图标 + 标题 + 要点 + 徽章
 *   │  └────────┘   └────────┘            │
 *   └──────────────────────────────────────┘
 *   · **一个边界 = 一段连续的行** ✓ —— 组内折行、组间留空，边界框把这几行圈起来 ✓；
 *   · 列宽对齐（每列取该列最宽卡片）→ 列间隙跨行贯通 → 跨行的线就近上下走 ✓；
 *   · 边按 (源模块 → 目标模块) **聚合**：多个函数之间的调用合成一条线，
 *     线上带 AI 给的标签 + 次数徽章 ✓。
 * ═══════════════════════════════════════════════════════════════════════════ */

/* 语义色调 —— 和 Archify 一样按"这块是干什么的"上色，而不是随机上色 */
const TONE = {
  flow: { line: '#4f9cff', fill: 'rgba(79,156,255,.10)', text: '#9cc4ff' },
  policy: { line: '#ff6b9d', fill: 'rgba(255,107,157,.10)', text: '#ffa8c6' },
  config: { line: '#c58bff', fill: 'rgba(197,139,255,.10)', text: '#d7b4ff' },
  data: { line: '#ffb347', fill: 'rgba(255,179,71,.10)', text: '#ffd08a' },
  io: { line: '#3ddc97', fill: 'rgba(61,220,151,.10)', text: '#8ce9c0' },
  other: { line: '#8c9bb5', fill: 'rgba(140,155,181,.10)', text: '#b9c4d6' },
};
const toneOf = (t) => TONE[t] || TONE.other;

/* 卡片上的小图标（纯 SVG path，不引外部字体 ✓）*/
const ICON = {
  flow: 'M3 12h6m6 0h6M9 6l3 6-3 6',
  policy: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  config: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8 4h2M2 12h2m14.5-6.5l1.4-1.4M4.1 19.9l1.4-1.4m0-13l-1.4-1.4m15.8 15.8l-1.4-1.4',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
  io: 'M4 9h11l-3-3m5 9H6l3 3',
  code: 'M9 6l-5 6 5 6m6-12l5 6-5 6',
  other: 'M12 8a4 4 0 100 8 4 4 0 000-8z',
};

function archAISvg(graph, ai, opts) {
  const NS = 'http://www.w3.org/2000/svg';
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  const svg = document.createElementNS(NS, 'svg');
  const mk = (tag, attrs, text, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = String(text);
    (parent || svg).appendChild(n);
    return n;
  };

  /* ── ① 把「片段」和「AI 分析」合起来 ──
     ⚠️⚠️ 键要用**片段标签**（`led.c` 这种）✗✗，**不是片段序号** ✗ ——
         AI 那边看到的、分组里写的、nodes[].frag 里回的都是**标签** ✓；
         而 `graph` 里的 `frag` 字段是**序号** ✓。第一次就是拿序号去查标签表，
         结果**全部落空** → 分组只剩一个「其它」、要点一条都不显示 ✓（截图里就是这样 ✓）。*/
  const fileNodes = nodes.filter((n) => n.kind === 'file');
  const labelOfIdx = new Map();
  fileNodes.forEach((f) => labelOfIdx.set(String(f.frag), String(f.label || '')));

  const fnByLabel = new Map();
  const fnIdToLabel = new Map();
  nodes.filter((n) => n.kind === 'fn').forEach((n) => {
    const parts = String(n.id || '').split('|');
    const label = labelOfIdx.get(parts.length > 1 ? parts[1] : '0') || '';
    fnIdToLabel.set(String(n.id), String(n.label || ''));
    if (!fnByLabel.has(label)) fnByLabel.set(label, []);
    fnByLabel.get(label).push(n.label);
  });

  const aiNode = new Map();
  ((ai && ai.nodes) || []).forEach((n) => aiNode.set(String(n.frag), n));

  const frags = fileNodes.map((f) => {
    const label = String(f.label || '');
    const a = aiNode.get(label) || {};
    const fns = fnByLabel.get(label) || [];
    return {
      id: String(f.id), frag: label, file: f.file, line: f.line || 1,
      raw: label,
      title: a.title || label,
      icon: a.icon || 'code',
      bullets: (a.bullets && a.bullets.length ? a.bullets : []).slice(0, 3),
      fns,
    };
  });
  const byFrag = new Map(frags.map((f) => [f.frag, f]));

  /* AI 给的分组 → 卡片顺序；没分到的兜到「其它」 */
  const groups = [];
  const placed = new Set();
  ((ai && ai.groups) || []).forEach((g) => {
    const members = (g.frags || []).map((x) => String(x)).filter((x) => byFrag.has(x) && !placed.has(x));
    if (!members.length) return;
    members.forEach((x) => placed.add(x));
    groups.push({ label: g.label || '未命名边界', tone: g.tone || 'other', frags: members });
  });
  const rest = frags.filter((f) => !placed.has(f.frag)).map((f) => f.frag);
  if (rest.length) groups.push({ label: '其它', tone: 'other', frags: rest });
  if (!groups.length) groups.push({ label: '全部', tone: 'other', frags: frags.map((f) => f.frag) });

  /* ── ② 尺寸与布局 ── */
  const CARD_W = 252, CARD_GAP = 18, BUL_LH = 17;
  const GROUP_PAD = 16, GROUP_HEAD = 26, GROUP_GAP = 22;
  const PAD = 26, TOPBAR = 54, LANE = 26, SLOT = 7;
  const CH_LANE = 24;

  frags.forEach((f) => {
    f.w = CARD_W;
    f.h = 30 + (f.bullets.length ? f.bullets.length * BUL_LH + 8 : 0) + 14;
  });

  /* 每个边界 → 若干行；列宽按**列号**对齐（跨边界也对齐 ✓，跨界的线才好走 ✓）*/
  const rows = [];
  groups.forEach((g, gi) => {
    let cur = [], curW = 0;
    const maxRow = Math.max(520, Number(opts && opts.maxRowW) || 900);
    g.frags.forEach((fr) => {
      const f = byFrag.get(fr);
      const add = (cur.length ? CARD_GAP : 0) + f.w;
      if (cur.length && curW + add > maxRow) { rows.push({ gi, items: cur }); cur = []; curW = 0; }
      curW += (cur.length ? CARD_GAP : 0) + f.w;
      cur.push(f);
    });
    if (cur.length) rows.push({ gi, items: cur });
  });

  const nCols = rows.reduce((m, r) => Math.max(m, r.items.length), 0);
  const colW = new Array(nCols).fill(CARD_W);
  const rowOfFrag = new Map();
  rows.forEach((r, ri) => r.items.forEach((f) => rowOfFrag.set(f.frag, ri)));

  /* 行间通道高度 / 列间隙宽度 —— 按**跨行边**的条数算 ✓（列间隙要够走线 ✓）*/
  const gapLoad = new Array(nCols + 1).fill(0);
  const rowLoad = rows.map(() => 0);
  const pairSeen = new Set();
  edges.filter((e) => e.kind === 'call' || e.kind === 'include').forEach((e) => {
    const a = fragOfNode(e.from), b = fragOfNode(e.to);
    if (a == null || b == null || a === b) return;
    const k = a + '>' + b;
    if (pairSeen.has(k)) return;
    pairSeen.add(k);
    const r1 = rowOfFrag.get(a), r2 = rowOfFrag.get(b);
    if (r1 == null || r2 == null) return;
    rowLoad[r1] += 1;
    if (r2 === r1) return;
    rowLoad[r2] += 1;
    const c1 = rows[r1].items.findIndex((x) => x.frag === a);
    const c2 = rows[r2].items.findIndex((x) => x.frag === b);
    const g = Math.max(0, Math.min(nCols, Math.round((c1 + c2) / 2)));
    gapLoad[g] += 1;
  });
  /* ⚠️ 返回的是**片段标签**（不是序号）—— 和 `byFrag` / AI 的键保持一致 ✓ */
  function fragOfNode(id) {
    const s = String(id || '');
    const parts = s.split('|');
    const idx = parts.length > 1 ? parts[1] : null;
    return idx == null ? null : (labelOfIdx.get(idx) || null);
  }
  const rowLaneH = rowLoad.map((n) => Math.max(20, 8 + n * SLOT + 6));
  const gapW = gapLoad.map((n) => Math.max(16, 8 + n * SLOT + 6));

  /* 位置 */
  const colX = new Array(nCols).fill(0);
  {
    let x = PAD + gapW[0];
    for (let i = 0; i < nCols; i++) {
      colX[i] = x;
      x += colW[i];
      if (i < nCols - 1) x += gapW[i + 1];
    }
  }
  const contentRight = nCols ? colX[nCols - 1] + colW[nCols - 1] : PAD;
  const rowTop = [], laneY = [];
  let y = PAD + TOPBAR;
  const groupRows = new Map();
  rows.forEach((r, ri) => {
    y += GROUP_HEAD + GROUP_PAD + rowLaneH[ri];
    rowTop[ri] = y;
    laneY[ri] = y - rowLaneH[ri] / 2;
    const h = Math.max.apply(null, r.items.map((f) => f.h));
    r.items.forEach((f, ci) => { f.x = colX[ci]; f.y = y; });
    y += h + GROUP_PAD;
    if (!groupRows.has(r.gi)) groupRows.set(r.gi, []);
    groupRows.get(r.gi).push(ri);
  });

  /* 边界框：把同一个边界的行圈起来 ✓ */
  const boundaries = [];
  groups.forEach((g, gi) => {
    const rs = groupRows.get(gi);
    if (!rs || !rs.length) return;
    const first = rs[0], last = rs[rs.length - 1];
    const top = rowTop[first] - GROUP_HEAD - GROUP_PAD;
    const bottom = rowTop[last] + Math.max.apply(null, rows[last].items.map((f) => f.h)) + GROUP_PAD;
    const rightMost = Math.max.apply(null, rows.slice(first, last + 1)
      .flatMap((r) => r.items.map((f) => f.x + f.w)));
    boundaries.push({ label: g.label, tone: g.tone, x: PAD + 4, y: top, w: rightMost - PAD + 10, h: bottom - top });
    y = Math.max(y, bottom + GROUP_GAP);
  });
  const contentBottom = y;

  const W = Math.max(760, contentRight + gapW[nCols] + PAD);
  const H = Math.max(420, contentBottom + 46);

  /* ── ③ 边：模块 → 模块，**聚合**（多个函数调用合成一条 ✓）── */
  /* ⚠️ AI 的 edges 用的是**函数名** ✓，图里的 e.from / e.to 是**节点 id** ✓ ——
     要先翻译一次，否则标签永远配不上（= 一条都不显示 ✓）。 */
  const labelOf = new Map();
  ((ai && ai.edges) || []).forEach((e) => labelOf.set(String(e.from) + '>' + String(e.to), e.label));
  const pairAgg = new Map();
  edges.forEach((e) => {
    if (e.kind === 'owns') return;
    const a = fragOfNode(e.from), b = fragOfNode(e.to);
    if (a == null || b == null || a === b) return;
    const k = a + '>' + b;
    const hit = pairAgg.get(k) || { a, b, n: 0, inc: e.kind === 'include', label: '' };
    hit.n += 1;
    hit.inc = hit.inc && e.kind === 'include';
    hit.label = hit.label || labelOf.get((fnIdToLabel.get(String(e.from)) || '') + '>' + (fnIdToLabel.get(String(e.to)) || '')) || '';
    pairAgg.set(k, hit);
  });

  const usedSlot = new Map();
  const rowSlot = new Map();
  const gapSlot = new Map();
  /* ⚠️⚠️ 通道要放在**边界框外面** ✗✗ ——
     放框里的话线会在框内绕 ✓，还会从**别的框的标签**上穿过去 ✓
     （第一版就是这样：线看着像框里的装饰 ✓）。
     · 「框上方」= 进这个框的线走的通道 ✓
     · 「框下方」= 从这个框出去的线走的通道 ✓ */
  const boxOfRow = new Map();
  boundaries.forEach((b, gi) => (groupRows.get(gi) || []).forEach((ri) => boxOfRow.set(ri, b)));
  const laneAboveBase = (ri) => (boxOfRow.get(ri) ? boxOfRow.get(ri).y - 11 : laneY[ri]);
  const laneBelowBase = (ri) => (boxOfRow.get(ri) ? boxOfRow.get(ri).y + boxOfRow.get(ri).h + 11 : laneY[ri] + 20);
  const laneYOf = (ri, below) => {
    const n = rowLoad[ri] || 1, i = rowSlot.get(ri) || 0;
    rowSlot.set(ri, i + 1);
    const step = n > 1 ? Math.min(SLOT, Math.max(2, (rowLaneH[ri] - 8) / (n - 1))) : 0;
    return (below ? laneBelowBase(ri) : laneAboveBase(ri)) + (i - (n - 1) / 2) * step;
  };
  const gapXOf = (g) => {
    const base = g <= 0 ? PAD + gapW[0] / 2
      : (g >= nCols ? contentRight + gapW[nCols] / 2 : colX[g - 1] + colW[g - 1] + gapW[g] / 2);
    const n = gapLoad[g] || 1, i = gapSlot.get(g) || 0;
    gapSlot.set(g, i + 1);
    const step = n > 1 ? Math.min(SLOT, Math.max(2, (gapW[g] - 8) / (n - 1))) : 0;
    return base + (i - (n - 1) / 2) * step;
  };

  const edgeLayer = mk('g', {});
  const edgeEls = [];
  pairAgg.forEach((hit) => {
    const A = byFrag.get(hit.a), B = byFrag.get(hit.b);
    if (!A || !B) return;
    const r1 = rowOfFrag.get(hit.a), r2 = rowOfFrag.get(hit.b);
    if (r1 == null || r2 == null) return;
    const c1 = rows[r1].items.findIndex((x) => x.frag === hit.a);
    const c2 = rows[r2].items.findIndex((x) => x.frag === hit.b);
    const midCol = Math.max(0, Math.min(nCols, Math.round((c1 + c2) / 2)));
    const gx = gapXOf(midCol);
    const down = r2 > r1;
    const ax = A.x + A.w / 2, bx = B.x + B.w / 2;
    const ay = down ? A.y + A.h : A.y;
    const by = down ? B.y : B.y + B.h;
    let d;
    if (r1 === r2) {
      /* 同一行 → 从**框上方**绕一圈（框内不留线 ✓）*/
      const ty = laneYOf(r1, false);
      d = 'M' + ax + ' ' + A.y + ' L' + ax + ' ' + ty + ' L' + bx + ' ' + ty + ' L' + bx + ' ' + B.y;
    } else if (r2 > r1) {
      /* 目标在**下面** → 从源框下方出去、目标框上方进去 ✓ */
      const ly1 = laneYOf(r1, true), ly2 = laneYOf(r2, false);
      d = 'M' + ax + ' ' + (A.y + A.h) + ' L' + ax + ' ' + ly1
        + ' L' + gx + ' ' + ly1 + ' L' + gx + ' ' + ly2
        + ' L' + bx + ' ' + ly2 + ' L' + bx + ' ' + B.y;
    } else {
      /* ⚠️ 目标在**上面** → 必须从源框**上方**出去 ✓。
         第一版不分方向，一律"先下后上"✓ —— 于是线要穿过**两个**框 ✗
         （看起来就是"框里穿来穿去"✓）。 */
      const ly1 = laneYOf(r1, false), ly2 = laneYOf(r2, true);
      d = 'M' + ax + ' ' + A.y + ' L' + ax + ' ' + ly1
        + ' L' + gx + ' ' + ly1 + ' L' + gx + ' ' + ly2
        + ' L' + bx + ' ' + ly2 + ' L' + bx + ' ' + (B.y + B.h);
    }
    const inc = hit.inc;
    const path = mk('path', {
      d: archRoundPath(d), fill: 'none',   /* 拐角磨圆 ✓ */
      stroke: inc ? '#8c9bb5' : '#7aa2f7',
      'stroke-opacity': inc ? .6 : .85, 'stroke-width': 1.5,
      'stroke-linejoin': 'round',
      ...(inc ? { 'stroke-dasharray': '5 4' } : {}),
      'marker-end': 'url(#arch-arrow)',
    }, null, edgeLayer);
    edgeEls.push({ el: path, ids: [A.id, B.id], kind: inc ? 'include' : 'call' });
    if (hit.label) {
      const mx = (ax + bx) / 2, my = r1 === r2 ? laneY[r1] - 9 : (ly1 + ly2) / 2;
      mk('text', { x: mx, y: my + 3, fill: '#8fa3bd', 'font-size': 11, 'text-anchor': 'middle' }, hit.label, edgeLayer);
    }
  });

  /* ── ④ 画 ── */
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('style', 'background:#0e1116;border-radius:10px;display:block;max-width:100%;height:auto');
  svg.dataset.naturalW = String(W);
  svg.dataset.naturalH = String(H);

  /* 网格底 ✓（Archify 那张图就是这个质感）*/
  const defs = mk('defs', {});
  const pat = mk('pattern', { id: 'arch-grid', width: 26, height: 26, patternUnits: 'userSpaceOnUse' }, null, defs);
  mk('path', { d: 'M26 0H0V26', fill: 'none', stroke: 'rgba(255,255,255,.045)', 'stroke-width': 1 }, null, pat);
  const bgLayer = mk('g', {});
  mk('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#arch-grid)' }, null, bgLayer);
  const marker = mk('marker', { id: 'arch-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 6, markerHeight: 6, orient: 'auto' }, null, defs);
  mk('path', { d: 'M2 1L8 5L2 9', fill: 'none', stroke: '#7aa2f7', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, null, marker);

  /* 标题栏 ✓ */
  const titleLayer = mk('g', {});
  mk('text', { x: PAD, y: 30, fill: '#e7edf6', 'font-size': 19, 'font-weight': 600 },
    String((ai && ai.title) || '架构图').slice(0, 30), titleLayer);
  mk('text', { x: PAD, y: 47, fill: '#7c8ba3', 'font-size': 12 },
    String((ai && ai.tagline) || '').slice(0, 70), titleLayer);
  mk('text', { x: W - PAD, y: 30, fill: '#4f9cff', 'font-size': 11, 'text-anchor': 'end' },
    '✦ AI 分析 · ' + frags.length + ' 个模块 / ' + edges.filter((e) => e.kind !== 'owns').length + ' 条关系', titleLayer);
  mk('line', { x1: PAD, y1: TOPBAR - 8, x2: W - PAD, y2: TOPBAR - 8, stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1 }, null, titleLayer);

  /* 边界框（虚线 + 左上角标签 ✓）*/
  const boundLayer = mk('g', {});
  boundaries.forEach((b) => {
    const t = toneOf(b.tone);
    mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14,
      fill: t.fill, stroke: t.line, 'stroke-opacity': .55, 'stroke-width': 1.2, 'stroke-dasharray': '6 5' }, null, boundLayer);
    const lw = String(b.label).length * 13 + 16;
    mk('rect', { x: b.x + 12, y: b.y - 11, width: lw, height: 21, rx: 6, fill: '#0e1116' }, null, boundLayer);
    mk('text', { x: b.x + 20, y: b.y + 4, fill: t.text, 'font-size': 12.5, 'font-weight': 500 }, b.label, boundLayer);
  });

  /* 卡片 ✓ */
  const nodeLayer = mk('g', {});
  const nodeEls = new Map();
  frags.forEach((f) => {
    const g = groups.find((x) => x.frags.indexOf(f.frag) >= 0) || { tone: 'other' };
    const t = toneOf(g.tone);
    const grp = mk('g', { style: 'cursor:pointer' }, null, nodeLayer);
    const rect = mk('rect', { x: f.x, y: f.y, width: f.w, height: f.h, rx: 11,
      fill: '#151a22', stroke: t.line, 'stroke-opacity': .75, 'stroke-width': 1.3 }, null, grp);
    /* 图标 */
    mk('path', { d: ICON[f.icon] || ICON.code, transform: 'translate(' + (f.x + 14) + ',' + (f.y + 14) + ')',
      fill: 'none', stroke: t.text, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, null, grp);
    const label = mk('text', { x: f.x + 38, y: f.y + 24, fill: '#e7edf6', 'font-size': 14.5, 'font-weight': 600 },
      String(f.title).slice(0, 16), grp);
    f.bullets.forEach((b, i) => {
      mk('text', { x: f.x + 16, y: f.y + 46 + i * BUL_LH, fill: '#8fa3bd', 'font-size': 11.5 },
        '· ' + String(b).slice(0, 22), grp);
    });
    /* 徽章：这个模块有几个函数 ✓（= Archify 的 SRC n）*/
    const badge = f.fns.length + ' fn';
    mk('rect', { x: f.x + f.w - 20 - badge.length * 6.2, y: f.y + 9, width: badge.length * 6.2 + 12, height: 17, rx: 8,
      fill: 'rgba(255,255,255,.07)', stroke: 'rgba(255,255,255,.12)', 'stroke-width': .8 }, null, grp);
    mk('text', { x: f.x + f.w - 14, y: f.y + 21, fill: '#93a3ba', 'font-size': 10, 'text-anchor': 'end' }, badge, grp);
    nodeEls.set(f.id, { rect, label, frag: f });
    grp.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const on = new Set([f.id]);
      edgeEls.forEach((o) => { if (o.ids.indexOf(f.id) >= 0) o.ids.forEach((x) => on.add(x)); });
      nodeEls.forEach((o, oid) => {
        const lit = on.has(oid);
        o.rect.setAttribute('stroke-opacity', lit ? 1 : .22);
        o.label.setAttribute('fill', lit ? '#e7edf6' : '#5b6879');
      });
      edgeEls.forEach((o) => {
        const lit = o.ids.indexOf(f.id) >= 0;
        o.el.setAttribute('stroke-opacity', lit ? .95 : .07);
        o.el.setAttribute('stroke-width', lit ? 2 : 1.3);
      });
    });
  });
  svg.addEventListener('click', () => {
    nodeEls.forEach((o) => { o.rect.setAttribute('stroke-opacity', .75); o.label.setAttribute('fill', '#e7edf6'); });
    edgeEls.forEach((o) => {
      o.el.setAttribute('stroke-opacity', o.kind === 'include' ? .6 : .85);
      o.el.setAttribute('stroke-width', 1.5);
    });
  });

  /* ⚠️⚠️ 重排图层顺序 ✗✗ —— 边界框的**填充是半透明的** ✓，
     画在边**之后**会把边整片压暗 ✓（第一版就是这样：边界框看得见、边全看不见 ✓）。
     appendChild 对已有子节点是**移动** ✓，所以这里按正确顺序重挂一遍就行 ✓。 */
  svg.appendChild(bgLayer);
  svg.appendChild(boundLayer);
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);
  svg.appendChild(titleLayer);

  mk('text', { x: PAD, y: H - 12, fill: '#4a5666', 'font-size': 11 },
    '点模块 → 高亮它的关系 · 滚轮缩放 · 拖拽平移 · 双击适应宽度');
  svg.dataset.count = String(edgeEls.length);
  return svg;
}

/* ── 工具栏那个「✦ AI 分析」按钮 ──────────────────────────────────────────
   用户原话：「**没有接入 AI 去分析，解析出架构图等等**」。
   点了之后：把 AI 配置 + 当前文件发给 `/api/arch/ai` ✓ →
   服务端读代码、构 prompt、调模型、**按 (文件, rev, 模型) 缓存** ✓ →
   拿到结构化结果 → 塞进 `ARCH_AI` → 重画（这次走 archAISvg）✓。

   ⚠️ 没配 AI 时给**明确提示** ✓，不是静默失败 ✗。
   ⚠️ 缓存命中时秒回 ✓（服务端回 `cached:true`）—— 同一个文件不用反复烧 token ✓。 */
function wireArchAIButton() {
  const btn = document.getElementById('cg-ai');
  if (!btn || btn.__archAIWired) return;
  btn.__archAIWired = true;
  btn.onclick = async () => {
    if (!CURRENT || !CURRENT.file) { setStatus('err', '先打开一个代码文档'); return; }
    const cfg = (typeof aiCfg === 'function') ? aiCfg() : {};
    const url = (typeof aiNormalizeUrl === 'function') ? aiNormalizeUrl(cfg.url) : String(cfg.url || '');
    if (!url || !cfg.model) { setStatus('err', '还没配置 AI：先填 API URL 和模型（AI 面板里）'); return; }
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '✦ 分析中…';
    setStatus('ok', 'AI 正在读这个文档…（第一次十几秒，之后有缓存）');
    try {
      const resp = await fetch('/api/arch/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: CURRENT.file, url, key: cfg.key || '', model: cfg.model }),
      });
      const r = await resp.json();
      if (!r || !r.ok) throw new Error((r && r.error) || '分析失败');
      ARCH_AI = { file: CURRENT.file, ai: r.ai };
      btn.textContent = '✦ 重跑分析';
      setStatus('ok', (r.cached ? 'AI 分析（缓存命中）' : 'AI 分析完成') + '：' + String(r.ai.title || ''));
      if (typeof CG_ACTIVE !== 'undefined' && CG_ACTIVE) renderCodeGraphPane();
    } catch (error) {
      btn.textContent = old;
      setStatus('err', 'AI 分析失败：' + String((error && error.message) || error));
    } finally {
      btn.disabled = false;
    }
  };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireArchAIButton);
else wireArchAIButton();
