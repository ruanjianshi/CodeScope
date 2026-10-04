'use strict';
/**
 * 逻辑图 · 纯模块（无 fs / 无 DOM）
 * ---------------------------------------------------------------------------
 * 职责：函数实现 → 语句级控制流图（CFG） → draw.io XML；以及逻辑图 → 代码骨架。
 * 与 lib/code-graph.js 互补：code-graph 回答“谁调用谁”，logic-graph 回答
 * “这个函数内部先做什么、再做什么、哪里分支”。
 *
 * 节点：{ id, kind, label, line, endLine, level }          kind ∈ entry|exit|stmt|branch|loop|call|return|unknown
 * 边：  { from, to, label }                                label ∈ ''|true|false|loop|next|fallthrough
 * 布局：DFS 分层 + 同层按发现序排布（x = order*180, y = depth*120），前端只管画线。
 * draw.io：直接拼合法 mxGraphModel XML（复用 server.js inspectDrawioXml 的格式约束）。
 */

const { maskNonCode } = require('./code-graph');

const LAYOUT_DX = 200, LAYOUT_DY = 120;

const stripComments = (line) => {
  let out = '', state = 'code', quote = '';
  const src = String(line || '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (state === 'line') break;
    else if (state === 'block') { if (c === '*' && n === '/') { i += 1; state = 'code'; } }
    else if (state === 'string') {
      out += c;
      if (c === '\\' && i + 1 < src.length) { out += src[i + 1]; i += 1; }
      else if (c === quote) state = 'code';
    } else if (c === '/' && n === '/') break;
    else if (c === '/' && n === '*') { i += 1; state = 'block'; }
    else if (c === '"' || c === "'" || c === '`') { out += c; quote = c; state = 'string'; }
    else out += c;
  }
  return out;
};

const shortLabel = (text, maxLen = 42) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t;
};

/* 取 if / for / while 的条件表达式。
   原来的正则末尾是 \) \s* \{? \s*$ —— 要求整行**以 ) 或 { 结尾**，于是：
     if (v < 0) {              → "v < 0"   ✓
     if (v < 0) { return -1; } → "if"      ✗ 单行写法
     if (v < 0) return -1;     → "if"      ✗ 无花括号写法
   label 退化成关键字后，logicToSkeleton 会生成 `if (if {` 这种坏代码。
   改成从关键字后的第一个 '(' 开始做**括号配对**扫描：既能吃到行尾，
   也能正确跨过嵌套括号（if (f(a) > 0)）和字符串里的括号。 */
const branchCond = (line, kw) => {
  const text = String(line || '');
  const at = text.search(new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'));
  const open = at < 0 ? -1 : text.indexOf('(', at);
  if (open < 0) return shortLabel(kw, 36);
  let depth = 0, quote = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return shortLabel(text.slice(open + 1, i).trim() || kw, 36);
    }
  }
  /* 括号没闭合（多行条件）：退回关键字之后的内容，总比只给关键字有用 */
  return shortLabel(text.slice(open + 1).trim() || kw, 36);
};

/* 单函数体 → 语句节点 + 控制边。braceLang 用 {} 划分块，py 用缩进划分块。 */
function buildLogicGraph(code, { language = 'c_cpp', name = 'fn' } = {}) {
  const rawLines = String(code || '').replace(/\r\n/g, '\n').split('\n');
  const maskedLines = maskNonCode(rawLines.join('\n')).split('\n');
  const nodes = [{ id: 'entry', kind: 'entry', label: 'enter ' + name, line: 1, endLine: 1, level: 0 }];
  const edges = [];
  let seq = 0, cursor = 'entry', loopKw = '';
  const newNode = (kind, label, line, endLine, extra) => {
    const id = 'n' + (++seq);
    nodes.push({ id, kind, label: shortLabel(label), line, endLine, level: 0, ...(extra || {}) });
    return id;
  };
  const link = (to, label = '') => edges.push({ from: cursor, to, label });

  const pyLang = language === 'python' || language === 'ruby';
  if (pyLang) {
    const indentOf = (l) => ((l.match(/^\s*/) || [''])[0]).length;
    const base = indentOf(rawLines[0] || '');
    const stack = [{ indent: base, id: 'entry', kind: 'root' }];
    rawLines.forEach((ln, i) => {
      const text = stripComments(ln).trim();
      if (!text || /^(def|class)\b/.test(text)) return;
      const indent = indentOf(ln);
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const top = stack[stack.length - 1];
      let kind = 'stmt', label = text, edgeLabel = '';
      let m = text.match(/^(if|elif)\b(.*):\s*$/);
      if (m) { kind = 'branch'; label = (m[1] === 'elif' ? 'elif' : 'if') + ' ' + m[2]; edgeLabel = 'true'; }
      else if (/^else\s*:\s*$/.test(text)) { kind = 'branch'; label = 'else'; edgeLabel = 'false'; }
      else if (m = text.match(/^(for|while)\b(.*):\s*$/)) { kind = 'loop'; label = m[1] + ' ' + m[2]; edgeLabel = 'loop'; }
      else if (/^return\b/.test(text)) kind = 'return';
      else if ((m = text.match(/\b([A-Za-z_]\w*)\s*\(/))) { kind = 'call'; label = m[1] + '(…)'; }
      const id = newNode(kind, label, i + 1, i + 1);
      link(id, edgeLabel);
      if ((kind === 'branch' || kind === 'loop') && !/:.*\S/.test(text.slice(text.indexOf(':') + 1))) {
        stack.push({ indent, id, kind });
        cursor = id;
      } else cursor = id;
      if (kind === 'return' || /^(break|continue|raise)\b/.test(text)) cursor = top.id;
    });
  } else {
    /* 用**花括号嵌套深度**当缩进依据，而不是图深度。
       图是线性链（每个节点连下一个），assignLevels 算出来的 level 会一路递增，
       骨架里就变成越缩越深的阶梯。花括号深度才是源码里真实的嵌套。 */
    let brace = 0;
    rawLines.forEach((ln, i) => {
      const raw = stripComments(ln);
      const text = raw.trim();
      const closesFirst = /^\}/.test(text);
      if (closesFirst) brace = Math.max(0, brace - 1);
      const depth = brace;
      const opens = (text.match(/\{/g) || []).length;
      let closes = (text.match(/\}/g) || []).length;
      if (closesFirst) closes -= 1;                 /* 这一个已经在上面减过，别重复 */
      brace = Math.max(0, brace + opens - closes);
      if (!text || text === '{' || text === '}') return;
      let kind = 'stmt', label = text.replace(/[{}]/g, '').trim() || text, edgeLabel = '';
      let m = text.match(/^(if|else\s+if)\b/);
      if (m) { kind = 'branch'; label = branchCond(text, m[1].startsWith('else') ? 'else if' : 'if'); edgeLabel = 'true'; }
      else if (/^else\b/.test(text)) { kind = 'branch'; label = 'else'; edgeLabel = 'false'; }
      else if (m = text.match(/^(for|while|do)\b/)) {
        kind = 'loop'; loopKw = m[1]; label = m[1] === 'do' ? 'do … while' : branchCond(text, m[1]); edgeLabel = 'loop';
      } else if (m = text.match(/^(switch|case|default)\b/)) { kind = 'branch'; label = shortLabel(text.replace(/\{?\s*$/, '')); edgeLabel = ''; }
      else if (/^return\b/.test(text)) kind = 'return';
      /* 函数签名行（int classify(int v){）不是一次调用 —— 以前会被记成 call 节点，
         骨架里就多出一行 classify(); 。判据：第一行 + 有 (...) + 以 { 或 ) 结尾。 */
      else if (i === 0 && /\)\s*\{?\s*$/.test(text) && /\([^;]*\)/.test(text)) { kind = 'stmt'; label = shortLabel(text.replace(/[{}]/g, '').trim(), 36); }
      else if ((m = text.match(/\b([A-Za-z_]\w*)\s*\(/))) { kind = 'call'; label = m[1] + '(…)'; }
      const id = newNode(kind, label, i + 1, i + 1, loopKw ? { kw: loopKw, indent: depth } : { indent: depth });
      loopKw = '';
      link(id, edgeLabel);
      cursor = id;
    });
  }
  const exit = newNode('exit', 'exit', rawLines.length, rawLines.length);
  edges.push({ from: cursor, to: exit, label: 'next' });
  assignLevels(nodes, edges);
  return { ok: true, name, nodes, edges };
}

function assignLevels(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map([['entry', 0]]);
  const queue = ['entry'];
  while (queue.length) {
    const id = queue.shift();
    const d = depth.get(id) || 0;
    edges.filter((e) => e.from === id).forEach((e) => {
      if (!depth.has(e.to) || depth.get(e.to) > d + 1) { depth.set(e.to, d + 1); queue.push(e.to); }
    });
  }
  const order = new Map();
  nodes.forEach((n) => {
    const d = depth.get(n.id) || 0;
    n.level = d;
    n.x = (order.get(d) || 0) * LAYOUT_DX + 40;
    n.y = d * LAYOUT_DY + 40;
    order.set(d, (order.get(d) || 0) + 1);
  });
  return byId;
}

/* 逻辑图 → draw.io XML：节点矩形/菱形 + 边 label，前端绘图面板可直接打开。 */
const NODE_STYLE = {
  entry: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;',
  exit: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;',
  stmt: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#6c8ebf;',
  call: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;',
  branch: 'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;',
  loop: 'rhombus;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;',
  return: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;',
  unknown: 'rounded=0;whiteSpace=wrap;html=1;',
};

const escXml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function logicToDrawio(graph, { title = 'logic' } = {}) {
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  const cells = [
    '<root><mxCell id="0" /><mxCell id="1" parent="0" />',
    ...nodes.map((n) => '<mxCell id="' + escXml(n.id) + '" value="' + escXml(n.label) + '" style="'
      + (NODE_STYLE[n.kind] || NODE_STYLE.unknown) + '" vertex="1" parent="1">'
      + '<mxGeometry x="' + (n.x || 40) + '" y="' + (n.y || 40) + '" width="160" height="60" as="geometry" /></mxCell>'),
    ...edges.map((e, i) => '<mxCell id="e' + i + '" value="' + escXml(e.label || '') + '" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="'
      + escXml(e.from) + '" target="' + escXml(e.to) + '"><mxGeometry relative="1" as="geometry" /></mxCell>'),
    '</root>',
  ].join('');
  return '<?xml version="1.0" encoding="UTF-8"?><mxfile host="CodeScope" version="1.0">'
    + '<diagram name="' + escXml(title) + '" id="logic-' + Date.now().toString(36) + '"><mxGraphModel>'
    + cells + '</mxGraphModel></diagram></mxfile>';
}

/* 逻辑图 → 代码骨架：按拓扑序把节点还原为带注释的伪实现，供“画图生成代码”用。 */
function logicToSkeleton(graph, { language = 'c_cpp', fnName = 'generated' } = {}) {
  const nodes = ((graph && graph.nodes) || []).filter((n) => n.kind !== 'entry' && n.kind !== 'exit');
  const isPy = language === 'python';
  const lines = isPy ? ['def ' + fnName + '():'] : ['void ' + fnName + '() {'];
  const indentUnit = isPy ? '    ' : '  ';
  const pending = [];   /* 还没闭合的块，存它们的缩进层 */
  nodes.forEach((n) => {
    /* 缩进优先用解析时记下的花括号深度（真实嵌套）；
       没有就退回 level（图深度，线性链时会一路递增）。 */
    const depth = Number.isFinite(n.indent) ? n.indent : (Number(n.level) || 1);
    const pad = indentUnit.repeat(Math.max(1, Math.min(8, depth)));
    /* 先收掉「已经走出去」的块 —— 原来是一遇到分支就立刻补 }，
       结果 body 全跑到块外面去了（if (x) { } 之后才 return）。 */
    while (pending.length && pending[pending.length - 1] >= depth) {
      lines.push(indentUnit.repeat(Math.max(1, pending.pop())) + '}');
    }
    if (n.kind === 'branch') { lines.push(pad + (isPy ? '# if ' : 'if (') + n.label + (isPy ? ':' : ') {')); if (!isPy) pending.push(depth); }
    /* 保留 for / while 的区别：原来一律写成 while，for 循环看起来像 while */
    else if (n.kind === 'loop') {
      const kw = n.kw === 'do' ? 'while' : (n.kw || 'while');
      lines.push(pad + (isPy ? '# loop ' : kw + ' (') + n.label + (isPy ? ':' : ') {'));
      if (!isPy) pending.push(depth);
    }
    /* 原来恒为 return; —— 把表达式丢了。节点 label 里本来就带着完整语句 */
    else if (n.kind === 'return') lines.push(pad + (/^return\b/.test(n.label) ? n.label : 'return;'));
    else if (n.kind === 'call') lines.push(pad + n.label.replace(/\(…\)$/, '()') + '; // ' + n.id);
    else lines.push(pad + '// ' + n.label);
  });
  while (pending.length) lines.push(indentUnit.repeat(Math.max(1, pending.pop())) + '}');
  if (!isPy) lines.push('}');
  return { ok: true, code: lines.join('\n'), language };
}

module.exports = { buildLogicGraph, logicToDrawio, logicToSkeleton, NODE_STYLE };