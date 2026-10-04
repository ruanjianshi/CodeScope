'use strict';
/**
 * 逻辑图 · 纯模块（无 fs / 无 DOM）
 * ---------------------------------------------------------------------------
 * 职责：函数实现 → **控制流图（CFG）** → draw.io XML；以及逻辑图 → 代码骨架。
 * 与 lib/code-graph.js 互补：code-graph 回答“谁调用谁”，logic-graph 回答
 * “这个函数内部先做什么、再做什么、哪里分支”。
 *
 * 节点：{ id, kind, label, line, endLine, level, indent }
 *       kind ∈ entry|exit|stmt|branch|loop|call|return
 * 边：  { from, to, label }   label ∈ ''|true|false|loop|next
 * 布局：BFS 分层（assignLevels），前端按边画线；draw.io 直接拼 mxGraphModel。
 *
 * 解析方式（v2，2026-10-04 重写）：
 *   旧版是「逐行建节点」—— 一行一个节点，`if (...)` 的头部和 body 平级，
 *   画出来就是「代码从上到下」，既看不出分支也看不出嵌套。
 *   新版先解析成**嵌套结构**，再按控制流连边：
 *     if / else      → 决策节点 + 是/否两条边 + 汇合
 *     for / while    → 循环头 + body + 回边（退出从循环头出）
 *     do … while     → 先 body 后判断
 *     switch / case  → 多路决策
 *   产出的是真正的 CFG，前端按边画就是流程图（对齐 Valla.ai 那种「函数逻辑图」）。
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

/* 与第 i 行的 { 配对的 } 所在行号。找不到就返回最后一行。 */
function matchBrace(lines, i) {
  let depth = 0, started = false;
  for (let k = i; k < lines.length; k++) {
    const s = lines[k];
    for (let c = 0; c < s.length; c++) {
      if (s[c] === '{') { depth++; started = true; }
      else if (s[c] === '}') { depth--; if (started && depth === 0) return k; }
    }
  }
  return lines.length - 1;
}

/* 与 text[open] 处的 ( 配对的 ) 的下标。跳过字符串里的括号。 */
function matchParen(text, open) {
  let depth = 0, quote = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* 关键字后面的条件表达式。括号配对扫描，能跨嵌套括号（if (f(a) > 0)）
   和字符串里的括号（strcmp(s, ")")）。 */
function conditionAfter(text, kw) {
  const at = text.search(new RegExp('\\b' + kw + '\\b'));
  const open = at < 0 ? -1 : text.indexOf('(', at);
  if (open < 0) return '';
  const close = matchParen(text, open);
  return (close > open ? text.slice(open + 1, close) : text.slice(open + 1)).trim();
}

/* 把关键字后面的 {...} 体的行范围取出来。
   ⚠️ 花括号**同行开闭**（`if (v < 0) { return -1; }`）时必须当单行体处理 ——
   否则 matchBrace 返回同一行，体范围变成 from > to 的空区间，整个 body 丢掉（实测踩过）。 */
function bodyRange(lines, headLine) {
  const text = lines[headLine].trim();
  if (text.includes('{')) {
    const close = matchBrace(lines, headLine);
    if (close === headLine) return { from: headLine, to: headLine + 1, next: headLine + 1, inline: true };
    return { from: headLine + 1, to: close, next: close + 1 };
  }
  return { from: headLine, to: headLine + 1, next: headLine + 1, inline: true };
}

/* 单行体的正文：`while (v > 10) { v--; }` → `v--;`
   注意：单行体**不能**拿整行去递归解析 —— 那一行还是 `while (...)`，
   会重复命中同一个循环头，直接无限递归爆栈（实测踩过）。 */
function inlineBodyText(text, kw) {
  const at = text.search(new RegExp('\\b' + kw + '\\b'));
  const open = at < 0 ? -1 : text.indexOf('(', at);
  const close = open < 0 ? -1 : matchParen(text, open);
  let rest = close >= 0 ? text.slice(close + 1).trim() : '';
  rest = rest.replace(/^\{\s*/, '').replace(/\s*\}$/, '').trim();
  return rest;
}

/* 单行语句归类 */
function classifyStatement(text) {
  if (/^(return|break|continue|goto|throw)\b/.test(text)) return 'return';
  /* `a = f(b)` 是赋值，不算调用；`f(b);` 才算 */
  if (/^[A-Za-z_][\w\.\[\]\->\s]*=[^=]/.test(text)) return 'stmt';
  if (/\b[A-Za-z_]\w*\s*\(/.test(text)) return 'call';
  return 'stmt';
}

function buildLogicGraph(code, { language = 'c_cpp', name = 'fn' } = {}) {
  const raw = String(code || '').replace(/\r\n/g, '\n');
  const rawLines = raw.split('\n');
  const maskedLines = maskNonCode(raw).split('\n');
  const nodes = [{ id: 'entry', kind: 'entry', label: '开始', line: 1, endLine: 1, level: 0, indent: 0 }];
  const edges = [];
  let seq = 0;

  const add = (kind, label, line, endLine, extra) => {
    const id = 'n' + (++seq);
    nodes.push({ id, kind, label: shortLabel(label), line, endLine: Math.max(line, endLine || line), level: 0, ...(extra || {}) });
    return id;
  };
  const link = (from, to, label) => {
    if (!from || !to) return;
    if (edges.some((e) => e.from === from && e.to === to)) return;   /* 多路汇合时去重 */
    edges.push({ from, to, label: label || '' });
  };
  const linkAll = (ids, to, label) => ids.forEach((id) => link(id, to, label));
  /* 记下「从这里出去代表条件为假」的节点，连边时标成 false 而不是 next */
  const FALSE_TAILS = new Set();
  /* 终止语句（return 等）要连到「结束」，别让它们悬空 */
  const TERMINALS = [];

  /* 解析 [from, to) 行范围，把语句接到 tails 之后，返回出口节点列表。
     edgeLabel 只作用于本段第一个节点（决策节点连过来的 是/否/循环 标签）。 */
  const emitSeq = (from, to, tails, depth, edgeLabel) => {
    let out = tails.slice();
    let first = true;
    const join = (id, label, kind) => {
      out.forEach((from, index) => {
        /* 从「条件为假」的出口连过来 → false；本段第一个 → 传入的边标签（是/循环）；其余 → next */
        const edgeLabel2 = FALSE_TAILS.has(from) ? 'false'
          : (index === 0 && first ? (edgeLabel || 'next') : 'next');
        link(from, id, edgeLabel2);
      });
      first = false;
      /* return / break / continue / goto / throw 会**终止这条路径** ——
         不能把它当成出口继续往下连，否则会画出「return 之后接着执行」这种错图
         （实测踩过：`return NULL;` 后面连到了 if 之后的赋值语句）。 */
      if (/^(return|break|continue|goto|throw)\b/.test(kind || '')) { TERMINALS.push(id); out = []; }
      else out = [id];
    };
    let buffer = '', bufferLine = 0;
    let i = from;
    while (i < to) {
      const text = maskedLines[i].trim();
      const shown = stripComments(rawLines[i] || '').trim();
      if (!text) { i++; continue; }                      /* 空行 / 纯注释行：不是节点 */
      if (text === '{' || text === '}') { i++; continue; }
      if (text === 'else' || /^else\s*$/.test(text)) { i++; continue; }   /* 裸 else 由 if 处理 */

      let m;
      /* ── if / else if / else ── */
      if ((m = text.match(/^if\s*\(/))) {
        const cond = conditionAfter(text, 'if');
        const head = add('branch', 'if (' + cond + ')', i + 1, i + 1, { indent: depth, cond });
        join(head, null, 'branch');
        const then = bodyRange(maskedLines, i);
        let thenTails;
        if (then.inline) {
          /* `if (v < 0) return -1;` —— 体在同一行，直接取关键字后的剩余部分，
             不能再递归整行（会重复命中同一个 if） */
          const rest = inlineBodyText(text, 'if');
          const k = rest ? classifyStatement(rest) : '';
          thenTails = rest ? [add(k, rest, i + 1, i + 1, { indent: depth + 1 })] : [];
          link(head, thenTails[0] || null, 'true');
        } else {
          thenTails = emitSeq(then.from, then.to, [head], depth + 1, 'true');
        }
        let tails2 = thenTails;
        let next = then.next;
        let endsWithElse = false;
        /* 后面跟 else？ */
        while (next < to) {
          const ntext = maskedLines[next].trim();
          if (!ntext) { next++; continue; }
          if (/^else\s+if\s*\(/.test(ntext)) {
            const c2 = conditionAfter(ntext, 'if');
            const h2 = add('branch', 'if (' + c2 + ')', next + 1, next + 1, { indent: depth, cond: c2 });
            link(head, h2, 'false');                     /* 条件为假 → 下一个判断 */
            const b2 = bodyRange(maskedLines, next);
            tails2 = tails2.concat(emitSeq(b2.from, b2.to, [h2], depth + 1, 'true'));
            next = b2.next;
          } else if (/^else\b/.test(ntext)) {
            const b3 = bodyRange(maskedLines, next);
            tails2 = tails2.concat(emitSeq(b3.from, b3.to, [head], depth + 1, 'false'));
            endsWithElse = true;
            next = b3.next;
          } else break;
        }
        /* 没有收尾的 else 时，**条件为假要能直接往下走** ——
           否则那条路径整个断掉（实测：if 只画出了「是」的一半）。
           标进 FALSE_TAILS，连边时才写成 false 而不是 next。 */
        if (!endsWithElse) { tails2 = tails2.concat([head]); FALSE_TAILS.add(head); }
        out = tails2; first = false; i = next; continue;
      }

      /* ── for / while ── */
      if ((m = text.match(/^(for|while)\s*\(/))) {
        const kw = m[1];
        const cond = conditionAfter(text, kw);
        const head = add('loop', kw + ' (' + cond + ')', i + 1, i + 1, { indent: depth, kw, cond });
        join(head, null, 'loop');
        const body = bodyRange(maskedLines, i);
        let bodyTails;
        if (body.inline) {
          const rest = inlineBodyText(text, kw);
          const k = rest ? classifyStatement(rest) : '';
          bodyTails = rest ? [add(k, rest, i + 1, i + 1, { indent: depth + 1 })] : [];
          link(head, bodyTails[0] || null, 'loop');
        } else {
          bodyTails = emitSeq(body.from, body.to, [head], depth + 1, 'loop');
        }
        bodyTails.forEach((id) => link(id, head, 'loop'));   /* 回边 */
        out = [head]; first = false; i = body.next; continue;  /* 退出循环也从循环头出 */
      }

      /* ── do { } while (); ── */
      if (/^do\b/.test(text)) {
        const body = bodyRange(maskedLines, i);
        const bodyEntry = add('loop', 'do', i + 1, body.next, { indent: depth, kw: 'do' });
        join(bodyEntry, null, 'loop');
        const bodyTails = emitSeq(body.from, body.to, [bodyEntry], depth + 1, 'next');
        let after = body.next, cond = '';
        while (after < to && !/^while\s*\(/.test(maskedLines[after].trim())) after++;
        if (after < to) cond = conditionAfter(maskedLines[after].trim(), 'while');
        const test = add('loop', 'while (' + cond + ')', after + 1, after + 1, { indent: depth, kw: 'while', cond });
        linkAll(bodyTails, test, 'next');
        link(test, bodyEntry, 'loop');                       /* 成立就再转一圈 */
        out = [test]; first = false; i = after + 1; continue;
      }

      /* ── switch / case ── */
      if (/^switch\s*\(/.test(text)) {
        const cond = conditionAfter(text, 'switch');
        const head = add('branch', 'switch (' + cond + ')', i + 1, i + 1, { indent: depth, cond });
        join(head, null, 'branch');
        const body = bodyRange(maskedLines, i);
        let tails2 = [head];
        for (let k = body.from; k < body.to; k++) {
          const ct = maskedLines[k].trim();
          if (!/^(case|default)\b/.test(ct)) continue;
          const label = stripComments(rawLines[k] || '').trim().replace(/\s*\{?\s*$/, '');
          const caseNode = add('branch', label, k + 1, k + 1, { indent: depth + 1 });
          link(head, caseNode, '');
          tails2 = tails2.concat(emitSeq(k + 1, body.to, [caseNode], depth + 2, 'next'));
          break;                                             /* 只处理第一个 case，其余走 body 内部 */
        }
        out = tails2; first = false; i = body.next; continue;
      }

      /* ── 普通语句：累积到分号（支持跨行表达式）── */
      if (!buffer) bufferLine = i + 1;
      buffer = buffer ? buffer + ' ' + shown : shown;
      if (/;\s*$/.test(shown) || /[{}]\s*$/.test(shown)) {
        const kind = classifyStatement(buffer);
        join(add(kind, buffer, bufferLine, i + 1, { indent: depth }), null, kind);
        buffer = '';
      }
      i++;
    }
    if (buffer) { const k2 = classifyStatement(buffer); join(add(k2, buffer, bufferLine, to, { indent: depth }), null, k2); }
    return out;
  };

  /* 函数体：跳过签名行（第一行），从第一个 { 之后开始 */
  let bodyStart = 0;
  for (let i = 0; i < maskedLines.length; i++) {
    if (maskedLines[i].includes('{')) { bodyStart = i + 1; break; }
  }
  let bodyEnd = maskedLines.length;
  for (let i = maskedLines.length - 1; i >= 0; i--) {
    if (maskedLines[i].trim() === '}') { bodyEnd = i; break; }
  }
  const tails = emitSeq(bodyStart, bodyEnd, ['entry'], 0, 'next');
  const exit = add('exit', '结束', rawLines.length, rawLines.length, { indent: 0 });
  linkAll(tails, exit, 'next');
  /* 终止语句（return 等）也连到「结束」—— 否则那些节点在图上悬空 */
  TERMINALS.forEach((id) => link(id, exit, 'next'));
  assignLevels(nodes, edges);
  return { ok: true, name, nodes, edges, language };
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
    const depth = Number.isFinite(n.indent) ? n.indent : (Number(n.level) || 1);
    const pad = indentUnit.repeat(Math.max(1, Math.min(8, depth)));
    while (pending.length && pending[pending.length - 1] >= depth) {
      lines.push(indentUnit.repeat(Math.max(1, pending.pop())) + '}');
    }
    if (n.kind === 'branch') {
      /* label 已经是 `if (cond)` 形态，直接用 */
      const head = /^(if|switch|case|default|else)\b/.test(n.label) ? n.label : 'if (' + n.label + ')';
      lines.push(pad + (isPy ? '# ' + head : head + ' {'));
      if (!isPy) pending.push(depth);
    } else if (n.kind === 'loop') {
      const head = /^(for|while|do)\b/.test(n.label) ? n.label : (n.kw || 'while') + ' (' + n.label + ')';
      lines.push(pad + (isPy ? '# ' + head : head + ' {'));
      if (!isPy) pending.push(depth);
    } else if (n.kind === 'return') lines.push(pad + (/^(return|break|continue|goto|throw)\b/.test(n.label) ? n.label : 'return;'));
    else if (n.kind === 'call') lines.push(pad + (/[;{}]\s*$/.test(n.label) ? n.label : n.label + ';'));
    else lines.push(pad + (/[;{}]\s*$/.test(n.label) ? n.label : n.label + ';'));
  });
  while (pending.length) lines.push(indentUnit.repeat(Math.max(1, pending.pop())) + '}');
  if (!isPy) lines.push('}');
  return { ok: true, code: lines.join('\n'), language };
}

module.exports = { buildLogicGraph, logicToDrawio, logicToSkeleton, NODE_STYLE };
