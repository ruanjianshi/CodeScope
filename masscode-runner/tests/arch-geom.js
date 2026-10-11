#!/usr/bin/env node
'use strict';
/*
 * 架构图几何测试（tests/arch-geom.js）
 * ---------------------------------------------------------------------------
 * ★ 为什么要有这个测试 ——
 *   2026-10-11 用户原话：**「你这个架构图的线条完全是乱的」** ✓。
 *   根因不是"画得不好看"，是**几何错了**：所有边都从方块正中心进出、
 *   走贝塞尔曲线 → 57 条边里 **32 条直接穿过别的方块** ✓。
 *   「好看不好看」没法断言，**「线穿没穿方块」可以** ✓ ——
 *   这就是 Archify README 里那句 `route / label-to-route clearance` 的意思。
 *
 * ── 判据（对着 Archify 那两句来）──
 *   ① `route clearance`：任何一条边，**除了它自己的两个端点方块**，
 *      线段不能落在其它方块的内部 ✓；
 *   ② `shared automatic endpoints spread deterministically`：
 *      不能有一堆边**扎在同一个点**上 ✓。
 *
 * ── 为什么能不开浏览器 ──
 *   `archGraphSvg()` 只用到 `createElementNS / setAttribute / appendChild /
 *   textContent / dataset / addEventListener` —— 用一个 40 行的假 DOM 就够 ✓。
 *   （真开 Chrome 跑一遍要 10 秒，这个 < 50ms ✓，所以能进 `npm test` ✓。）
 *
 * 图数据是**手搓的**（不读 vault ✓）：用例固定、可复现 ✓。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/* ── 假 DOM（够 archGraphSvg 用就行）──────────────────────────────────── */
function makeDom() {
  class El {
    constructor(tag) {
      this.tagName = tag;
      this.attrs = {};
      this.children = [];
      this.textContent = '';
      this.dataset = {};
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
    appendChild(n) { n.parent = this; this.children.push(n); return n; }
    addEventListener() {}
    /* 方便测试：整棵树递归 */
    all(tag, out) {
      out = out || [];
      if (!tag || this.tagName === tag) out.push(this);
      this.children.forEach((c) => c.all(tag, out));
      return out;
    }
  }
  return { createElementNS: (ns, tag) => new El(tag) };
}

/* ── 加载「纯画图」那一半 ──
   ⚠️ 2026-10-11 它从 `assets/arch-view.js` 拆成了 **`assets/arch-graph-svg.js`** ✓
      （棘轮：arch-view.js ≤ 408 行，加完「自由缩放 + 卡片折行」涨到 611 →
       按天然边界拆：**纯画图** vs **面板集成**）。
   三个路径都找一遍 ✓ —— 以后再搬家也不会让测试莫名其妙地"找不到函数" ✓。 */
const ARCH_SOURCES = ['assets/arch-graph-svg.js', 'assets/arch-view.js', 'assets/app.js'];
/* 布局+走线在 arch-layout.js（纯数据），画 SVG 在 arch-graph-svg.js ——
   两个拼起来才能跑 ✓（顺序不能反：archGraphSvg 调 archLayout）。 */
const ARCH_PRELUDE = ['assets/arch-layout.js'];
function loadArchView() {
  for (const rel of ARCH_SOURCES) {
    let src;
    try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { continue; }
    if (src.indexOf('function archGraphSvg(') < 0) continue;
    let pre = '';
    for (const q of ARCH_PRELUDE) {
      try { pre += fs.readFileSync(path.join(root, q), 'utf8') + '\n'; } catch (_) {}
    }
    const sandbox = { document: makeDom() };
    // eslint-disable-next-line no-new-func
    const factory = new Function('document', pre + src + '\nreturn { archGraphSvg, archFragOf, archBestRowW };');
    return factory(sandbox.document);
  }
  throw new Error('在 ' + ARCH_SOURCES.join(' / ') + ' 里都找不到 archGraphSvg');
}

/* ── 手搓一份有代表性的图 ──────────────────────────────────────────────
   刻意凑齐四种走线情形 ✓：
     · 同片段、相邻行（直连竖线）
     · 同片段、隔行（借走廊绕）
     · 跨片段调用（走顶部水平走廊）
     · include（卡片 → 卡片）
   还有**一个 0 函数的头文件片段** ✓（真实数据里很常见，卡片要能压扁）。 */
function buildGraph() {
  const F = '/doc.md';
  const frags = [
    { frag: 0, label: 'led.c', fns: ['led_create', 'led_open', 'led_read', 'led_write', 'led_close', 'dev_open', 'dev_read', 'dev_write', 'dev_close'] },
    { frag: 1, label: 'uart.c', fns: ['uart_init', 'uart_open', 'uart_write', 'uart_read', 'uart_close'] },
    { frag: 2, label: 'uart.h', fns: [] },
    { frag: 3, label: 'main.c', fns: ['main'] },
  ];
  const nodes = [];
  const idOf = {};
  frags.forEach((f) => {
    const fid = 'f:' + F + '|' + f.frag;
    nodes.push({ id: fid, kind: 'file', label: f.label, file: F, frag: f.frag, line: 1 });
    f.fns.forEach((name, i) => {
      const sid = 's:' + F + '|' + f.frag + '|' + (i * 10 + 1) + '|fn|' + name;
      nodes.push({ id: sid, kind: 'fn', label: name, file: F, frag: f.frag, line: i * 10 + 1 });
      idOf[f.frag + ':' + name] = sid;
    });
    idOf['card' + f.frag] = fid;
  });
  const edges = [];
  frags.forEach((f) => {
    f.fns.forEach((name) => edges.push({ from: idOf['card' + f.frag], to: idOf[f.frag + ':' + name], kind: 'owns' }));
  });
  const call = (a, b) => edges.push({ from: idOf[a], to: idOf[b], kind: 'call' });
  const inc = (a, b) => edges.push({ from: idOf['card' + a], to: idOf['card' + b], kind: 'include' });
  call('3:main', '0:led_create');          /* 跨片段 */
  call('0:led_create', '0:dev_open');      /* 同片段、隔行 */
  call('0:led_create', '0:dev_read');      /* 同片段、同一个源出两条（端点要分散）*/
  call('0:led_open', '0:dev_write');
  call('0:dev_close', '0:led_close');      /* 同片段、隔行、反向 */
  call('1:uart_init', '1:uart_open');      /* 同片段、相邻行 → 直连竖线 */
  call('1:uart_write', '1:uart_close');    /* 同片段、隔行 */
  call('1:uart_init', '1:uart_write');
  call('0:led_read', '1:uart_read');       /* 跨片段 */
  inc(0, 2); inc(1, 2); inc(3, 2);         /* 三个卡片 include 同一个头文件 */
  /* ⚠️ 再加一条**同列跨行**的 include（main.c 在第 2 行第 1 列 → led.c 在第 1 行第 1 列）——
     这正是用户截图里那条 882px "大环"的触发条件 ✓：
     同一列时 `round((ca+cb)/2)` 就等于 `ca`，而 `ca = 0` 是**最左外侧通道** ✓。
     没有这条边，下面那条「绕远路」断言就是**恒真**的 ✓（第一次加就踩到了 ✓）。 */
  inc(3, 0);
  return { nodes, edges, stats: { fragments: 4, functions: 15, calls: 9, includes: 3 } };
}

/* ── 几何判定 ────────────────────────────────────────────────────────── */
const PAD = 3;   /* 允许贴边 3px（线正好压在方块边界上不算穿 ✓） */

/* 分三类（不靠颜色/尺寸猜 ✓，靠**结构**）：
     · 函数方块 —— rect 的父亲是 `<g style="cursor:pointer">`（点击高亮那个组）
     · 片段卡片 —— rect 的父亲是**没有属性**的 `<g>`（节点层）
     · 图例       —— rect 的父亲是 `<svg>` 本身（浮在角落，不算障碍物）
   ⚠️ 一开始我按 `width >= 240` 认卡片 ✗ —— 但卡片宽 = 走廊 + 176 + 走廊 ≈ 204 ✓，
      判据直接落空（"画出了 4 张卡片：实际 0" ✓）。**别用尺寸猜结构** ✓。 */
function classify(svg) {
  const chips = [], cards = [], other = [];
  svg.all('rect').forEach((r) => {
    const p = r.parent;
    const geo = { x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')),
      w: Number(r.getAttribute('width')), h: Number(r.getAttribute('height')) };
    if (p && p.tagName === 'g' && p.attrs.style) chips.push(geo);
    else if (p && p.tagName === 'g') cards.push(geo);
    else other.push(geo);
  });
  return { chips, cards, other };
}
const boxesOf = (svg) => { const c = classify(svg); return c.chips.concat(c.cards); };
/* ⚠️ 取**所有坐标对**，不挑指令 ✗ ——
   原来只认 `M`/`L` ✓，于是贝塞尔路径只剩一个 `M` 点 ✓，
   穿块检测退化成"路径点不足" ✓（"它没穿块"和"它没被检查"长得一样 ✗）。
   取全部坐标对：折线得到折点 ✓，曲线得到**控制多边形** ✓ ——
   三次贝塞尔必落在控制点的凸包内 ✓，所以"控制多边形没穿"是保守但正确的判据 ✓。 */
function pointsOf(d) {
  const nums = String(d || '').match(/-?\d+(?:\.\d+)?/g) || [];
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: +nums[i], y: +nums[i + 1] });
  return pts;
}
function inBox(p, b, pad) {
  return p.x > b.x + pad && p.x < b.x + b.w - pad && p.y > b.y + pad && p.y < b.y + b.h - pad;
}
function touches(p, b) {
  return p.x >= b.x - 1 && p.x <= b.x + b.w + 1 && p.y >= b.y - 1 && p.y <= b.y + b.h + 1;
}

let pass = 0, fail = 0;
/* 数「有多少条线扎进了无关方块」—— 主流程用一次，折行那组也复用 ✓ */
function crossingsOf(svg) {
  const { chips, cards } = classify(svg);
  const boxes = chips.concat(cards);
  let n = 0;
  /* ⚠️ 检查**所有** path，不只是带箭头的 —— 主干（多条边共用的那一段）
     是**不带箭头**的 ✓，漏掉它等于漏掉一半的线 ✓。 */
  svg.all('path').forEach((p) => {
    const pts = pointsOf(p.getAttribute('d'));
    if (pts.length < 2) { n += 1; return; }
    const samples = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const c = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let t = 0; t <= c; t++) samples.push({ x: a.x + (b.x - a.x) * t / c, y: a.y + (b.y - a.y) * t / c });
    }
    const owners = new Set();
    [pts[0], pts[pts.length - 1]].forEach((q) => boxes.forEach((b, bi) => { if (touches(q, b)) owners.add(bi); }));
    const bad = new Set();
    samples.forEach((q) => boxes.forEach((b, bi) => { if (!owners.has(bi) && inBox(q, b, PAD)) bad.add(bi); }));
    if (bad.size) n += 1;
  });
  return n;
}

function ck(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  —— ' + detail : '')); }
}

console.log('\n── 架构图几何（线不能穿过别人的方块 / 端点不能重叠）──\n');

const { archGraphSvg, archFragOf, archBestRowW } = loadArchView();
const graph = buildGraph();
const svg = archGraphSvg(graph);

/* ① 基本结构 */
const { chips, cards } = classify(svg);
const boxes = chips.concat(cards);
const paths = svg.all('path').filter((p) => p.getAttribute('marker-end'));
ck('画出了 4 张片段卡片', cards.length === 4, '实际 ' + cards.length);
ck('画出了 15 个函数方块', chips.length === 15, '实际 ' + chips.length);

/* ② `owns` 边不画 —— 它由"函数装在卡片里"表达，画出来就是重复信息（原来 57 条边里 29 条是它） */
ck('owns 边不画线（9 条 owns 一条都不该出现）', paths.length === 13, '实际 ' + paths.length + ' 条（应为 9 call + 4 include）');

/* ③ route clearance：线不许扎进别的方块 */
const crossings = [];
/* ⚠️ 同上：主干也走这段检查（它没箭头，但一样会穿方块）*/
svg.all('path').forEach((p, i) => {
  const pts = pointsOf(p.getAttribute('d'));
  if (pts.length < 2) { crossings.push({ i, why: '路径点不足' }); return; }
  const samples = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
    for (let t = 0; t <= n; t++) samples.push({ x: a.x + (b.x - a.x) * t / n, y: a.y + (b.y - a.y) * t / n });
  }
  const owners = new Set();
  [pts[0], pts[pts.length - 1]].forEach((q) => boxes.forEach((b, bi) => { if (touches(q, b)) owners.add(bi); }));
  const bad = new Set();
  samples.forEach((q) => boxes.forEach((b, bi) => { if (!owners.has(bi) && inBox(q, b, PAD)) bad.add(bi); }));
  if (bad.size) crossings.push({ i, why: '穿过 ' + bad.size + ' 个无关方块', d: p.getAttribute('d') });
});
ck('没有一条线穿过无关方块（route clearance）', crossings.length === 0,
  crossings.length ? crossings.slice(0, 3).map((c) => '#' + c.i + ' ' + c.why).join(' / ') : '');

/* 数「有多少条线绕了远路」—— 路径长度 / 两端曼哈顿距离 ——
   ⚠️ 这条是**肉眼看出来的、当时所有断言都放过去了** ✓：
      用户截图里 `main.c → led.h` 绕到**最左外侧通道**再上去 ✓，882px 一圈 ✓，
      在图上看着像凭空多了个虚线框 ✓。
      根因：同一列时 `round((ca+cb)/2)` 就等于 `ca` ✓，而 `ca = 0` 是**最左外侧** ✗。
   ⇒ 判据：**路径长度 ≤ 两端曼哈顿距离 × 2.5 + 120** ✓
     （正常走线是「横一段 + 竖一段」，比例远小于 2.5 ✓）。 */
function detoursOf(svg) {
  const out = [];
  svg.all('path').forEach((p) => {
    const pts = pointsOf(p.getAttribute('d'));
    if (pts.length < 2) return;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    const a = pts[0], z = pts[pts.length - 1];
    const direct = Math.abs(z.x - a.x) + Math.abs(z.y - a.y);
    if (len > direct * 2.5 + 120) out.push(Math.round(len) + 'px（直线只要 ' + Math.round(direct) + 'px）');
  });
  return out;
}

/* ③b 不能**绕远路** ——
   ⚠️ 这条是**肉眼看出来的、上面所有断言都放过去了** ✓：
      用户截图里 `main.c → led.h` 绕到了**最左外侧通道**再上去 ✓，
      882px 的一圈 ✓，在图上看着像凭空多了个虚线框 ✓。
      根因：同一列时 `round((ca+cb)/2)` 就等于 `ca` ✓，而 `ca = 0` 是**最左外侧** ✗。
   ⇒ 判据：**路径长度 ≤ 两端曼哈顿距离 × 2.5 + 120** ✓
     （正常走线是「横一段 + 竖一段」，比例远小于 2.5 ✓）。 */
const detours = detoursOf(svg);
ck('没有绕远路的线（路径长度 ≤ 两端曼哈顿距离×2.5+120）', detours.length === 0, detours.slice(0, 3).join(' / '));

/* ④ 端点确定性分散：不能一堆线扎在同一个点 */
const anchors = new Map();
paths.forEach((p) => {
  const pts = pointsOf(p.getAttribute('d'));
  if (!pts.length) return;
  const k = pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
  anchors.set(k, (anchors.get(k) || 0) + 1);
});
const piled = [...anchors.entries()].filter(([, n]) => n > 1);
ck('没有一堆线扎在同一个起点（deterministic spread）', piled.length === 0,
  piled.slice(0, 3).map(([k, n]) => k + '×' + n).join(' / '));

/* ⑤ 全是正交折线 —— 没有贝塞尔（`C` 曲线是"一团毛线"的来源） */
const curved = paths.filter((p) => /[CcSsQqTtAa]/.test(p.getAttribute('d') || ''));
ck('全部是正交折线（没有曲线段）', curved.length === 0, curved.length + ' 条带曲线');

/* ⑥ 卡片宽度一致（同一批数据里，负载相近的卡片不该宽窄悬殊） */
const widths = cards.map((c) => c.w);
ck('卡片宽度整齐（极差 ≤ 200px）', Math.max(...widths) - Math.min(...widths) <= 200,
  '宽度 ' + widths.map(Math.round).join(' / '));

/* ⑥b 卡片**顶对齐** ——
   ⚠️ 用户截图：`led.h` / `uart.c` / `uart.h`（都是 0 函数）**浮在行中间** ✓，
      因为行高由最高的那张卡决定 ✓，矮卡**居中**之后就悬在半空 ✓，
      看着像"飘着" ✓。顶对齐之后卡片头落在同一条水平线上 ✓，读起来像表格 ✓。
   ⇒ 判据：**顶边 y 的种类数 ≤ 行数** ✓（居中时每张卡的 y 都不同 ✗，这条会红 ✓）。 */
const topYs = [...new Set(cards.map((c) => Math.round(c.y)))];
ck('卡片头按行对齐（顶对齐，不是行内居中）', topYs.length <= 2, '顶边 y = ' + topYs.join(' / '));

/* ⑦ 0 函数的片段：卡片要压扁，不能留一片空白 */
const flat = Math.min(...cards.map((c) => c.h));
ck('0 函数的片段卡片是压扁的（≤ 60px）', flat <= 60, '最矮 ' + Math.round(flat) + 'px');

/* ⑧ 有明确像素宽（放大浮层靠它，写 `width:100%` 会在浮层里缩成一小团） */
ck('SVG 有明确像素宽高（放大浮层用）',
  Number(svg.getAttribute('width')) > 0 && Number(svg.getAttribute('height')) > 0,
  'width=' + svg.getAttribute('width'));

/* ⑨ 箭头 marker 的 `orient` 必须是**合法值** ——
   ⚠️ 实测踩过（2026-10-11）：原来写的是 `auto-start-start-reverse` ✓
      （**多了一个 `start-`** ✓），**非法值** ✓ →
      Chrome 报 `<marker> attribute orient: Expected angle, "auto-start-start…"` ✓
      然后**静默回退到 `0`** ✓ → **所有箭头一律朝右** ✓，
      线往上走、往下走、往左走，箭头统统朝右 ✓。
      （这个 bug **几何断言抓不到** ✓ —— 折线的最后一段方向是对的 ✓，
        错的是**渲染出来的箭头** ✓。只能断言 `orient` 的取值 ✓。）
   `marker-end` 要的就是 `auto` ✓；`auto-start-reverse` 是给 `marker-start` 用的 ✓。 */
const marker = svg.all('marker')[0];
const orient = marker ? marker.getAttribute('orient') : '';
ck('箭头 marker 的 orient 是合法值（auto / auto-start-reverse / 角度）',
  orient === 'auto' || orient === 'auto-start-reverse' || /^-?[\d.]+(deg|rad|grad|turn)?$/.test(String(orient)),
  'orient=' + JSON.stringify(orient) + '（非法值会让浏览器静默回退到 0 → 箭头一律朝右）');

/* ⑩ 箭头方向：末端要贴在某个方块边上，而且**从外指向内** */
const arrowBad = [];
paths.forEach((p) => {
  const pts = pointsOf(p.getAttribute('d'));
  if (pts.length < 2) { arrowBad.push(p.getAttribute('d')); return; }
  const z = pts[pts.length - 1], pv = pts[pts.length - 2];
  let ok = false;
  boxes.forEach((b) => {
    const onV = (Math.abs(z.x - b.x) < 1.5 || Math.abs(z.x - (b.x + b.w)) < 1.5)
      && z.y > b.y - 1.5 && z.y < b.y + b.h + 1.5;
    const onH = (Math.abs(z.y - b.y) < 1.5 || Math.abs(z.y - (b.y + b.h)) < 1.5)
      && z.x > b.x - 1.5 && z.x < b.x + b.w + 1.5;
    if (!onV && !onH) return;
    const dx = (b.x + b.w / 2) - z.x, dy = (b.y + b.h / 2) - z.y;
    if (dx * (z.x - pv.x) + dy * (z.y - pv.y) > 0) ok = true;
  });
  if (!ok) arrowBad.push(p.getAttribute('d'));
});
ck('箭头末端贴在方块边上且指向内部', arrowBad.length === 0, arrowBad.slice(0, 2).join(' / '));

/* ⑪ 分组按**片段号**（不是按 file —— 同一文档里 file 全一样，原来就栽在这） */
ck('archFragOf 能从 id 里取出片段号', archFragOf({ id: 's:/d.md|7|19|fn|foo' }) === '7'
  && archFragOf({ id: 'f:/d.md|3' }) === '3');

/* ⑫ 退化输入不炸 */
let threw = '';
try {
  archGraphSvg({ nodes: [], edges: [] });
  archGraphSvg({});
  archGraphSvg({ nodes: [{ id: 'x', kind: 'fn', label: 'a', file: 'f', frag: 0, line: 1 }], edges: [{ from: 'x', to: 'x', kind: 'call' }] });
} catch (e) { threw = String(e.message); }
ck('空图 / 只有自环 都不炸', threw === '', threw);

/* ⑫b **全局函数必须真的是全局的** ——
   ⚠️ 我踩过：把 `archBestRowW` 插到了 `archLayout` **函数体内部** ✓
      （锚点选在了 `return {` 上面的注释 ✓）→ 它是合法的**嵌套函数** ✓
      → 语法检查过 ✓、几何断言全过 ✓ → 但 `arch-view.js` 调它时
      **`ReferenceError: archBestRowW is not defined`** ✗，图直接白屏 ✓。
   ⇒ 所以「改完跑一下真实调用链」和「断言它存在」都要有 ✓。 */
ck('archBestRowW 是**顶层**函数（能被 arch-view.js 调到）', typeof archBestRowW === 'function');
ck('archBestRowW 会按面板宽高比挑折行宽度',
  (() => {
    if (typeof archBestRowW !== 'function') return false;
    const wide = archBestRowW(graph, 1400, 400);   /* 面板很扁 → 图也该扁 → 一行更宽 */
    const tall = archBestRowW(graph, 500, 900);    /* 面板很高 → 图该多折几行 → 一行更窄 */
    return Number.isFinite(wide) && Number.isFinite(tall) && wide > tall;
  })());

/* ⑬ 折行 —— 用户原话「**排布不合理**」（2026-10-11）：
   5 个片段横向铺开 1494px，侧栏只有 ~520px → 得滚半天才看得全。
   现在按 maxRowW 折行，而且**调用方按面板宽传**（renderArchIntoPane）✓。
   ⚠️ 折行改了骨架，必须重新验一遍 route clearance ✓（这里就是那条回归）。 */
console.log('── 折行（按面板宽自适应）──');
const wrapNarrow = archGraphSvg(graph, { maxRowW: 380 });
const wrapOne = archGraphSvg(graph, { maxRowW: 99999 });
const wW = Number(wrapNarrow.getAttribute('width')), wH = Number(wrapNarrow.getAttribute('height'));
const oW = Number(wrapOne.getAttribute('width')), oH = Number(wrapOne.getAttribute('height'));
ck('maxRowW 小 → 画布更窄', wW < oW, wW + 'px vs ' + oW + 'px');
ck('maxRowW 小 → 画布更高（真的折行了）', wH > oH, wH + 'px vs ' + oH + 'px');
ck('折行之后仍然不穿块', crossingsOf(wrapNarrow) === 0, crossingsOf(wrapNarrow) + ' 条');
/* ⚠️ **「绕远路」的触发条件在窄版** —— 窄版才把卡片折成"同列跨行" ✓，
   所以这条必须在这里再验一次 ✓（只验默认宽度的话它是**恒真**的 ✓，第一次就踩到了 ✓）。 */
const wrapDetours = detoursOf(wrapNarrow);
ck('折行之后仍然没有绕远路的线', wrapDetours.length === 0, wrapDetours.slice(0, 3).join(' / '));
ck('折行之后端点仍然不重叠', (() => {
  const seen = new Map();
  wrapNarrow.all('path').filter((p) => p.getAttribute('marker-end')).forEach((p) => {
    const pts = pointsOf(p.getAttribute('d'));
    if (!pts.length) return;
    const k = pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
    seen.set(k, (seen.get(k) || 0) + 1);
  });
  return [...seen.values()].every((n) => n === 1);
})());

console.log('\n架构图几何：' + pass + '/' + (pass + fail) + ' 项通过' + (fail ? '，失败 ' + fail + ' 项' : ''));
if (fail) process.exit(1);
