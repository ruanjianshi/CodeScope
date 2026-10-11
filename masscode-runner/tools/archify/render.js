#!/usr/bin/env node
'use strict';
/*
 * 架构 IR → 自包含 HTML
 * ---------------------------------------------------------------------------
 * 设计原则（学 Archify）：
 *   ① **自包含**：一个 .html 文件，**不依赖任何 CDN**，
 *      双击就能开、能发给人、能进版本库（十年后还能开）；
 *   ② **可核对**：点任何节点都显示**源证据**（文件 / 行数 / 导出符号），
 *      图不是"想象"，随时能回代码看；
 *   ③ **该显眼的显眼**：巨型文件用红色 + 按行数放大 ——
 *      它是最该拆的地方，不该和别的节点一样大；
 *   ④ 只画**结构性的事实**，不画"我觉得应该是这样"。
 *
 * 用法：node render.js <ir.json> [--out architecture.html] [--title "项目名"]
 */

const fs = require('fs');
const path = require('path');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const LAYER_META = {
  ui: { name: '界面 / 前端', color: '#7aa2f7' },
  server: { name: '服务端 / API', color: '#7dcfff' },
  domain: { name: '领域服务', color: '#9ece6a' },
  tool: { name: '工具 / 脚本', color: '#e0af68' },
  test: { name: '测试', color: '#bb9af7' },
  doc: { name: '文档', color: '#a9b1d6' },
  other: { name: '其他', color: '#565f89' },
};

/* 巨型文件阈值：超过它就标红（**这是最该拆的信号**） */
const BIG_FILE_LINES = 3000;

function renderHTML(ir, opts) {
  const title = (opts && opts.title) || path.basename(ir.root || 'project');
  const layers = (ir.layers || []).filter((L) => ir.modules.some((m) => m.layer === L));
  const data = JSON.stringify({ ir, layers, bigThreshold: BIG_FILE_LINES, layerMeta: LAYER_META });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 架构图</title>
<style>
:root{
  --bg:#1a1b26; --panel:#24283b; --panel2:#1f2335; --line:#3b4261;
  --fg:#c0caf5; --dim:#565f89; --accent:#7aa2f7; --warn:#f7768e; --ok:#9ece6a;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);
  font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif}
#wrap{display:flex;height:100%}
#left{flex:1;min-width:0;display:flex;flex-direction:column}
header{padding:14px 18px 10px;border-bottom:1px solid var(--line);flex:0 0 auto}
h1{margin:0 0 4px;font-size:15px;font-weight:500}
.sub{color:var(--dim);font-size:12px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
.chip{border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:12px;color:var(--dim)}
.chip b{color:var(--fg);font-weight:500}
#stage{flex:1;min-height:0;overflow:hidden;position:relative;cursor:grab}
#stage.dragging{cursor:grabbing}
#stage svg{display:block;width:100%;height:100%}
#tools{position:absolute;right:14px;bottom:14px;display:flex;gap:6px;z-index:5}
#tools button{background:var(--panel);border:1px solid var(--line);color:var(--fg);
  border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
#tools button:hover{border-color:var(--accent);color:var(--accent)}
#right{width:360px;flex:0 0 360px;border-left:1px solid var(--line);
  background:var(--panel2);overflow:auto;padding:16px}
#right h2{margin:0 0 10px;font-size:14px;font-weight:500}
.empty{color:var(--dim);font-size:12px}
.kv{display:flex;justify-content:space-between;gap:10px;padding:4px 0;
  border-bottom:1px solid rgba(59,66,97,.5);font-size:12px}
.kv span:first-child{color:var(--dim)}
.kv span:last-child{text-align:right;word-break:break-all}
.sect{margin-top:14px}
.sect h3{margin:0 0 6px;font-size:12px;font-weight:500;color:var(--dim)}
.tag{display:inline-block;background:var(--panel);border:1px solid var(--line);
  border-radius:6px;padding:1px 7px;margin:0 4px 4px 0;font-size:12px}
.tag.warn{border-color:var(--warn);color:var(--warn)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.legend{position:absolute;left:14px;bottom:14px;background:rgba(31,35,53,.92);
  border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:12px;z-index:5}
.legend div{display:flex;align-items:center;gap:7px;margin:2px 0}
.dot{width:9px;height:9px;border-radius:3px;flex:0 0 auto}
</style>
</head>
<body>
<div id="wrap">
  <div id="left">
    <header>
      <h1>${esc(title)} · 架构图</h1>
      <div class="sub" id="sub"></div>
      <div class="chips" id="chips"></div>
    </header>
    <div id="stage">
      <svg id="svg"></svg>
      <div class="legend" id="legend"></div>
      <div id="tools">
        <button data-act="fit">适应窗口</button>
        <button data-act="in">放大</button>
        <button data-act="out">缩小</button>
        <button data-act="reset">重置</button>
      </div>
    </div>
  </div>
  <aside id="right"><h2>选一个模块</h2><div class="empty">点左边的方块，这里显示它的<b>源证据</b>（文件 / 行数 / 导出符号 / 依赖）。<br><br>方块<b>越大</b>表示行数越多；<b>红色</b>表示它是巨型文件，最该拆。</div></aside>
</div>
<script>
const DATA = ${data};
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('svg');
const stage = document.getElementById('stage');
let view = { x: 0, y: 0, k: 1 };

/* ⚠️⚠️ 浏览器这边**也要有一份 esc** ✗✗（第一次漏了 ✓）——
   上面 Node 里的 esc 是**渲染模板时**用的 ✓，
   这里的是**运行时**用的（详情面板要拼 innerHTML ✓）——
   两个作用域完全不通 ✓，漏了就会 "esc is not defined" ✓，
   而且**只在点节点时才炸** ✓（页面本身看着是好的 ✓，最容易漏测 ✓）。
   ⚠️ 这段注释里**不能写反引号** ✗ —— 整个 HTML 是一个模板字符串 ✓，
      反引号会把它提前结束 ✓（这个坑刚踩过 ✓）。 */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmt(n){ return (n||0).toLocaleString('en-US'); }

document.getElementById('sub').textContent =
  DATA.ir.summary.files + ' 个文件 · ' + fmt(DATA.ir.summary.totalLines) + ' 行 · '
  + DATA.ir.summary.modules + ' 个模块 · 扫描于 ' + (DATA.ir.generatedAt||'').slice(0,10);

(function chips(){
  const box = document.getElementById('chips');
  DATA.ir.summary.langs.slice(0,6).forEach(function(pair){
    const d = document.createElement('span');
    d.className = 'chip';
    d.innerHTML = pair[0] + ' <b>' + fmt(pair[1].lines) + '</b> 行';
    box.appendChild(d);
  });
  const big = DATA.ir.bigFiles.filter(function(f){ return f.lines >= DATA.bigThreshold; }).length;
  if (big){
    const d = document.createElement('span');
    d.className = 'chip';
    d.innerHTML = '巨型文件 <b style="color:var(--warn)">' + big + '</b> 个';
    box.appendChild(d);
  }
})();

(function legend(){
  const box = document.getElementById('legend');
  DATA.layers.forEach(function(L){
    const meta = DATA.layerMeta[L]; if(!meta) return;
    const row = document.createElement('div');
    row.innerHTML = '<i class="dot" style="background:' + meta.color + '"></i>' + meta.name;
    box.appendChild(row);
  });
  const row = document.createElement('div');
  row.innerHTML = '<i class="dot" style="background:var(--warn)"></i>巨型文件（最该拆）';
  box.appendChild(row);
})();

/* ── 布局：每个分层一条泳道；节点面积 ∝ 行数 ───────────────────────── */
function layout(){
  const PAD = 26, LANE_H = 132, GAP = 14, TOP = 20;
  const W = 1180;
  const nodes = [];
  let y = TOP;
  DATA.layers.forEach(function(L){
    const meta = DATA.layerMeta[L];
    const mods = DATA.ir.modules.filter(function(m){ return m.layer === L; });
    if (!mods.length) return;
    nodes.push({ kind:'lane', layer:L, meta:meta, y:y, h:LANE_H, mods:mods.length });
    const maxLines = Math.max.apply(null, mods.map(function(m){ return m.lines; }).concat([1]));
    let x = PAD;
    let rowY = y + 34;
    let rowH = 0;
    mods.forEach(function(m){
      const scale = Math.sqrt(m.lines / maxLines);
      const w = Math.max(96, Math.round(60 + scale * 150));
      const h = 62;
      if (x + w > W - PAD){ x = PAD; rowY += h + GAP; }
      const isBig = (m.evidence[0] && m.evidence[0].lines >= DATA.bigThreshold);
      nodes.push({ kind:'mod', m:m, x:x, y:rowY, w:w, h:h, color:meta.color, big:isBig });
      x += w + GAP;
      rowH = Math.max(rowH, rowY + h - y);
    });
    y += Math.max(LANE_H, rowH + 34) + GAP;
  });
  return { nodes: nodes, w: W, h: y + TOP };
}

const L = layout();
const content = document.createElementNS(SVGNS, 'g');
content.setAttribute('id', 'content');
svg.appendChild(content);

function el(tag, attrs, text){
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}

L.nodes.forEach(function(nd){
  if (nd.kind === 'lane'){
    const g = el('g', {});
    g.appendChild(el('rect', { x:8, y:nd.y, width:L.w-16, height:nd.h + 8, rx:16,
      fill:'rgba(36,40,59,.55)', stroke:nd.meta.color, 'stroke-opacity':.28, 'stroke-width':.5 }));
    g.appendChild(el('text', { x:24, y:nd.y + 21, fill:nd.meta.color,
      'font-size':13, 'font-weight':500 }, nd.meta.name + '  ·  ' + nd.mods + ' 个模块'));
    content.appendChild(g);
  } else {
    const g = el('g', { style:'cursor:pointer' });
    g.appendChild(el('rect', { x:nd.x, y:nd.y, width:nd.w, height:nd.h, rx:10,
      fill: nd.big ? 'rgba(247,118,142,.13)' : 'rgba(36,40,59,.95)',
      stroke: nd.big ? 'var(--warn)' : nd.color, 'stroke-opacity': nd.big ? .9 : .55, 'stroke-width': .5 }));
    const label = nd.m.id.length > 20 ? nd.m.id.slice(0, 19) + '…' : nd.m.id;
    g.appendChild(el('text', { x:nd.x + 12, y:nd.y + 24, fill:'#c0caf5',
      'font-size':13, 'font-weight':500 }, label));
    g.appendChild(el('text', { x:nd.x + 12, y:nd.y + 42, fill:'#565f89', 'font-size':12 },
      fmt(nd.m.lines) + ' 行 · ' + nd.m.fileCount + ' 文件'));
    const t = el('title', {}, nd.m.id + '\\n' + nd.m.lines + ' 行 · ' + nd.m.fileCount + ' 个文件');
    g.appendChild(t);
    g.addEventListener('click', function(){ select(nd.m, nd.big); });
    content.appendChild(g);
  }
});

function apply(){ content.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')'); }
function fit(){
  const r = stage.getBoundingClientRect();
  const k = Math.min(r.width / L.w, r.height / L.h) * 0.96;
  view.k = Math.max(0.15, k);
  view.x = (r.width - L.w * view.k) / 2;
  view.y = (r.height - L.h * view.k) / 2;
  apply();
}
document.querySelectorAll('#tools button').forEach(function(b){
  b.addEventListener('click', function(){
    const act = b.dataset.act;
    if (act === 'fit') return fit();
    if (act === 'reset'){ view = { x:0, y:0, k:1 }; return apply(); }
    const r = stage.getBoundingClientRect();
    const cx = r.width/2, cy = r.height/2;
    const nk = act === 'in' ? view.k * 1.2 : view.k / 1.2;
    view.x = cx - (cx - view.x) * (nk / view.k);
    view.y = cy - (cy - view.y) * (nk / view.k);
    view.k = nk; apply();
  });
});
let drag = null;
stage.addEventListener('mousedown', function(e){
  if (e.target.closest('#tools')) return;
  drag = { x:e.clientX, y:e.clientY, vx:view.x, vy:view.y };
  stage.classList.add('dragging');
});
window.addEventListener('mousemove', function(e){
  if (!drag) return;
  view.x = drag.vx + (e.clientX - drag.x);
  view.y = drag.vy + (e.clientY - drag.y);
  apply();
});
window.addEventListener('mouseup', function(){ drag = null; stage.classList.remove('dragging'); });
stage.addEventListener('wheel', function(e){
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const nk = e.deltaY < 0 ? view.k * 1.1 : view.k / 1.1;
  view.x = cx - (cx - view.x) * (nk / view.k);
  view.y = cy - (cy - view.y) * (nk / view.k);
  view.k = nk; apply();
}, { passive:false });

/* ── 详情面板：**源证据**是重点 ─────────────────────────────────────── */
function select(m, isBig){
  const R = document.getElementById('right');
  let h = '';
  h += '<h2>' + m.id + '</h2>';
  h += '<div class="kv"><span>分层</span><span>' + (DATA.layerMeta[m.layer] ? DATA.layerMeta[m.layer].name : m.layer) + '</span></div>';
  h += '<div class="kv"><span>行数</span><span class="mono">' + fmt(m.lines) + '</span></div>';
  h += '<div class="kv"><span>文件数</span><span class="mono">' + m.fileCount + '</span></div>';
  h += '<div class="kv"><span>体积</span><span class="mono">' + (m.bytes/1024).toFixed(0) + ' KB</span></div>';
  if (isBig) h += '<div class="sect"><span class="tag warn">含巨型文件，最该拆</span></div>';

  h += '<div class="sect"><h3>源证据（最大的文件）</h3>';
  (m.evidence||[]).forEach(function(e){
    const warn = e.lines >= DATA.bigThreshold;
    h += '<div class="kv"><span class="mono" style="color:' + (warn?'var(--warn)':'var(--fg)') + '">'
      + esc(e.rel) + '</span><span class="mono">' + fmt(e.lines) + '</span></div>';
  });
  if (!(m.evidence||[]).length) h += '<div class="empty">（无）</div>';
  h += '</div>';

  if ((m.exports||[]).length){
    h += '<div class="sect"><h3>导出符号</h3>';
    m.exports.forEach(function(x){ h += '<span class="tag">' + esc(x) + '</span>'; });
    h += '</div>';
  }
  if ((m.deps||[]).length){
    h += '<div class="sect"><h3>依赖</h3>';
    m.deps.forEach(function(x){ h += '<span class="tag">' + esc(x) + '</span>'; });
    h += '</div>';
  }
  h += '<div class="sect"><h3>语言构成</h3>';
  for (const k in (m.langs||{})) h += '<span class="tag">' + esc(k) + ' × ' + m.langs[k] + '</span>';
  h += '</div>';
  R.innerHTML = h;
}

fit();
window.addEventListener('resize', fit);
</script>
</body>
</html>
`;
}

function main() {
  const args = process.argv.slice(2);
  const src = args.find((a) => !a.startsWith('--'));
  if (!src || !fs.existsSync(src)) {
    console.error('用法：node render.js <ir.json> [--out architecture.html] [--title "项目名"]');
    process.exit(1);
  }
  const get = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };
  const ir = JSON.parse(fs.readFileSync(src, 'utf8'));
  const out = get('--out', 'architecture.html');
  const title = get('--title', path.basename(ir.root || 'project'));
  fs.writeFileSync(out, renderHTML(ir, { title }));
  console.error('✓ 架构图已写出：' + out);
}

if (require.main === module) main();
module.exports = { renderHTML };
