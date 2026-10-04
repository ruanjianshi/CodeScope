'use strict';
/**
 * 代码图谱 · 纯模块（无 fs / 无 DOM / 无全局状态）
 * ---------------------------------------------------------------------------
 * 职责：单文件多片段 → 符号索引 → 函数调用边 + 文件 include 边 → 子图抽取。
 * 前端 index.html 里 outlineFor / fnCalleeEdges / fileRelationChildren 是同一套
 * 启发式，这里收敛为可被 server.js 和单测共同引用的唯一实现。
 *
 * 输入约定 snippet = { file, name, fragments: [{ label, language, filename, code }] }
 * 符号为可序列化 plain object（不挂 snippet 引用，避免循环 JSON）：
 *   { id, name, kind, file, snippetName, frag, fragLabel, language, line, endLine, isDefinition }
 * id 与前端 symbolId 同构：[file, frag, line, kind, name].join('|')
 */

const OL_CONTROL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'return', 'sizeof',
  'new', 'delete', 'case', 'default', 'typeof', 'export', 'import', 'using',
  'namespace', 'public', 'private', 'protected', 'static', 'inline', 'virtual',
  'override', 'final', 'const', 'auto', 'void', 'int', 'double', 'float',
  'char', 'bool', 'long', 'short', 'unsigned', 'signed', 'struct', 'class',
  'enum', 'union', 'typedef', 'extern', 'template', 'synchronized', 'throws',
  'extends', 'implements', 'this', 'super', 'yield', 'await', 'async', 'var',
  'let', 'function', 'def', 'lambda', 'print', 'cout', 'cin', 'std', 'null',
  'nullptr', 'true', 'false', 'interface', 'protocol', 'extension', 'as', 'is',
  'in', 'not', 'and', 'or', 'with', 'from', 'global', 'nonlocal',
]);

const CODE_LANGUAGES = new Set(['c', 'c_cpp', 'javascript', 'typescript', 'python', 'go', 'ruby', 'java', 'swift', 'bash', 'shell']);
const SKIP_LANGUAGES = new Set(['markdown', 'latex', 'plain_text']);

const countCh = (s, ch) => { let n = 0; for (const c of String(s || '')) if (c === ch) n += 1; return n; };
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const baseName = (s) => String(s || '').replace(/\\/g, '/').split('/').pop();
const symbolIdOf = (s) => [s.file, s.frag, s.line, s.kind, s.name].join('|');
const fileNodeIdOf = (n) => (n.external ? 'external:' + n.name : n.file + '|' + n.frag);

/* 注释与字符串置空格（保留换行）：调用扫描只看掩码后文本，避免注释示例污染边。 */
function maskNonCode(code) {
  let out = '', state = 'code', quote = '';
  const src = String(code || '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (state === 'line') {
      if (c === '\n') { out += '\n'; state = 'code'; } else out += ' ';
    } else if (state === 'block') {
      if (c === '*' && n === '/') { out += '  '; i += 1; state = 'code'; }
      else out += c === '\n' ? '\n' : ' ';
    } else if (state === 'string') {
      if (c === '\\') { out += ' '; if (i + 1 < src.length) { out += src[i + 1] === '\n' ? '\n' : ' '; i += 1; } }
      else if (c === quote) { out += ' '; state = 'code'; }
      else out += c === '\n' ? '\n' : ' ';
    } else if (c === '/' && n === '/') { out += '  '; i += 1; state = 'line'; }
    else if (c === '/' && n === '*') { out += '  '; i += 1; state = 'block'; }
    else if (c === '"' || c === "'" || c === '`') { out += ' '; quote = c; state = 'string'; }
    else out += c;
  }
  return out;
}

/* 大纲：与前端 outlineFor 同策略（C/C++ 命名定义+原型 / JS-TS / Go / py-rb 缩进）。 */
function outlineFor(code, lang) {
  const lines = String(code || '').split('\n');
  const braceLang = !['python', 'ruby'].includes(lang);
  const entries = [];
  let depth = 0;
  const indentStack = [];
  let pending = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (braceLang) {
      const d0 = depth;
      let entryLine = i + 1, name = null, type = null;
      if (lang === 'go') {
        let m = line.match(/^\s*func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/);
        if (m) { name = m[1]; type = 'fn'; }
        else { m = line.match(/^\s*(?:type\s+)?(?:interface|struct)\s+(\w+)/); if (m) { name = m[1]; type = 'class'; } }
      } else if (lang === 'javascript' || lang === 'typescript') {
        let m = line.match(/\b(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
        if (m) { name = m[1]; type = 'class'; }
        else {
          m = line.match(/\b(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
          if (m) { name = m[1]; type = 'fn'; }
          else {
            m = line.match(/\b(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/);
            if (m) { name = m[1]; type = 'fn'; }
            else { m = line.match(/^\s*(\w+)\s*\([^;{}]*\)\s*\{/); if (m) { name = m[1]; type = 'fn'; } }
          }
        }
      } else if (!/^\s*(?:\/\/|\/\*|\*|#)/.test(line)) {
        let m = line.match(/^\s*typedef\s+(?:struct|union|enum|class)\s*\{.*\}\s*([A-Za-z_]\w*)\s*;\s*(\/\/.*|\/\*[\s\S]*\*\/\s*)?$/);
        if (m) { name = m[1]; type = 'class'; pending = null; }
        else {
          if (line.match(/^\s*(?:typedef\s+)?(?:struct|union|enum|class)\s*\{?\s*$/) && !line.includes(';')) pending = { line: i + 1 };
          const close = line.match(/^\s*}\s*([A-Za-z_]\w*)\s*;/);
          if (pending && close) { name = close[1]; type = 'class'; entryLine = pending.line; pending = null; }
          else {
            m = line.match(/^\s*(?:typedef\s+)?(?:class|struct|enum|union|interface|protocol|extension|namespace)\s+([A-Za-z_]\w*)\b/);
            if (m) {
              const rest = line.slice(line.indexOf(m[1]) + m[1].length);
              if (rest.includes('{') || /^\s*(\/\/.*|\/\*[\s\S]*\*\/)?\s*$/.test(rest)) { name = m[1]; type = 'class'; }
            } else if (!line.replace(/\s+$/, '').endsWith(';')) {
              m = line.match(/^\s*(?:[\w:<>,&\[\]\s]+\s+)?(?:[*&]\s*)?([A-Za-z_~][\w:<>\~]*)\s*\([^;{}]*\)\s*(?:const|override|noexcept|volatile)?\s*(?:\{|$)/);
              if (m) { name = m[1]; type = 'fn'; }
            } else {
              const pi = line.indexOf('(');
              const isControl = /^\s*(?:return|if|for|while|switch|case|default|sizeof|new|delete|yield|async|await|break|continue|goto|throw|catch|typeof|using)\b/.test(line);
              const hasAssign = pi > 0 && line.slice(0, pi).includes('=');
              if (!isControl && !hasAssign) {
                m = line.match(/^\s*(?:[\w:<>,&\[\]]+\s+)+(?:[*&]\s*)?([A-Za-z_~][\w:<>\~]*)\s*\([^;{}]*\)\s*;/);
                if (m && !OL_CONTROL.has(m[1])) { name = m[1]; type = 'fn'; }
              }
            }
          }
        }
      }
      if (name && !OL_CONTROL.has(name)) entries.push({ type, name, line: entryLine, depth: d0 });
      depth += countCh(line, '{') - countCh(line, '}');
    } else {
      const indent = line.length - line.replace(/^\s*/, '').length;
      let name = null, type = null;
      if (lang === 'python') {
        let m = line.match(/^\s*class\s+([A-Za-z_]\w*)/);
        if (m) { name = m[1]; type = 'class'; }
        else { m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/); if (m) { name = m[1]; type = 'fn'; } }
      } else if (lang === 'ruby') {
        let m = line.match(/^\s*(?:class|module)\s+(\w+)/);
        if (m) { name = m[1]; type = 'class'; }
        else { m = line.match(/^\s*def\s+(\w+)/); if (m) { name = m[1]; type = 'fn'; } }
      }
      if (name) {
        while (indentStack.length && indent <= indentStack[indentStack.length - 1].indent) indentStack.pop();
        entries.push({ type, name, line: i + 1, depth: indentStack.length });
        indentStack.push({ indent });
      }
    }
  }
  return entries;
}

function indentedExtent(lines, line1) {
  const start = line1 - 1;
  const base = ((lines[start] || '').match(/^\s*/) || [''])[0].length;
  let end = start + 1;
  for (; end < lines.length; end++) {
    if (!lines[end].trim()) continue;
    const indent = ((lines[end] || '').match(/^\s*/) || [''])[0].length;
    if (indent <= base) break;
  }
  return { isDefinition: true, endLine: Math.max(line1, end) };
}

/* 区分声明 `foo(...);` 与定义 `foo(...) { ... }`，返回真实体边界。 */
function functionExtent(lines, maskedLines, line1, lang) {
  if (lang === 'python' || lang === 'ruby') return indentedExtent(lines, line1);
  let paren = 0, bodyDepth = 0, bodyStarted = false;
  const maxHead = Math.min(lines.length, line1 + 30);
  for (let i = line1 - 1; i < lines.length; i++) {
    if (!bodyStarted && i >= maxHead) return { isDefinition: false, endLine: line1 };
    const line = maskedLines[i] || '';
    for (const c of line) {
      if (!bodyStarted) {
        if (c === '(') paren += 1;
        else if (c === ')') paren = Math.max(0, paren - 1);
        else if (paren === 0 && c === ';') return { isDefinition: false, endLine: i + 1 };
        else if (paren === 0 && c === '{') { bodyStarted = true; bodyDepth = 1; }
      } else if (c === '{') bodyDepth += 1;
      else if (c === '}' && --bodyDepth === 0) return { isDefinition: true, endLine: i + 1 };
    }
  }
  return { isDefinition: bodyStarted, endLine: lines.length };
}

function typeExtent(lines, maskedLines, line1) {
  let depth = 0, started = false;
  for (let i = line1 - 1; i < Math.min(lines.length, line1 + 120); i++) {
    for (const c of (maskedLines[i] || '')) {
      if (c === '{') { depth += 1; started = true; }
      else if (c === '}' && started && --depth === 0) return i + 1;
    }
    if (!started && (maskedLines[i] || '').includes(';')) return i + 1;
  }
  return line1;
}

const pushSym = (out, base, name, kind, isDefinition, endLine) => {
  if (!name || OL_CONTROL.has(name)) return;
  const sym = { ...base, name, kind, isDefinition: isDefinition !== false, endLine: endLine || base.line };
  sym.id = symbolIdOf(sym);
  out.push(sym);
};

/* 单 snippet 索引：fragments 全量扫，macro / typedef 别名 / 文件级变量与前端同口径。 */
function buildSnippetIndex(snippet) {
  const syms = [];
  const file = snippet.file, snippetName = snippet.name || '';
  (snippet.fragments || []).forEach((f, fi) => {
    if (!f || typeof f.code !== 'string' || SKIP_LANGUAGES.has(f.language)) return;
    const base = { file, snippetName, frag: fi, fragLabel: f.label || '', language: f.language };
    const lines = f.code.replace(/\r\n/g, '\n').split('\n');
    const maskedLines = maskNonCode(f.code.replace(/\r\n/g, '\n')).split('\n');
    outlineFor(f.code, f.language).forEach((o) => {
      const kind = o.type === 'class' ? 'type' : 'fn';
      const ext = kind === 'fn'
        ? functionExtent(lines, maskedLines, o.line, f.language)
        : { isDefinition: true, endLine: typeExtent(lines, maskedLines, o.line) };
      pushSym(syms, { ...base, line: o.line }, o.name, kind, ext.isDefinition, ext.endLine);
    });
    lines.forEach((ln, i) => {
      const macro = ln.match(/^\s*#define\s+([A-Za-z_]\w*)/);
      if (macro) pushSym(syms, { ...base, line: i + 1 }, macro[1], 'macro', true, i + 1);
    });
    if (f.language === 'c_cpp' || f.language === 'c') {
      indexTypeAliases(syms, base, maskedLines);
      indexFileVariables(syms, base, maskedLines);
    }
  });
  const seen = new Set();
  return syms.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
}

function indexTypeAliases(syms, base, maskedLines) {
  maskedLines.forEach((ln, i) => {
    let m = ln.match(/^\s*typedef\b[^;{}]*\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*\([^;{}]*\)\s*;\s*$/);
    if (m) { pushSym(syms, { ...base, line: i + 1 }, m[1], 'type', true, i + 1); return; }
    if (/^\s*typedef\b/.test(ln) && !/[{}]/.test(ln) && /;\s*$/.test(ln)) {
      m = ln.match(/([A-Za-z_]\w*)\s*;\s*$/);
      if (m) pushSym(syms, { ...base, line: i + 1 }, m[1], 'type', true, i + 1);
      return;
    }
    m = ln.match(/^\s*using\s+([A-Za-z_]\w*)\s*=/);
    if (m) pushSym(syms, { ...base, line: i + 1 }, m[1], 'type', true, i + 1);
  });
}

function indexFileVariables(syms, base, maskedLines) {
  let braceDepth = 0, aggregateStart = null;
  const initializerEnd = (from) => {
    if ((maskedLines[from] || '').includes(';')) return from + 1;
    let depth = 0;
    for (let j = from + 1; j < maskedLines.length; j++) {
      const row = maskedLines[j];
      depth += countCh(row, '{') - countCh(row, '}');
      if (depth === 0 && row.includes(';')) return j + 1;
    }
    return from + 1;
  };
  maskedLines.forEach((ln, i) => {
    const before = braceDepth;
    const after = Math.max(0, before + countCh(ln, '{') - countCh(ln, '}'));
    if (before === 0 && !/^\s*typedef\b/.test(ln) && /^\s*(?:(?:static|extern|const|volatile|register)\s+)*(?:struct|union|enum)\b[^;=]*$/.test(ln)) {
      aggregateStart = { line: i + 1, isExtern: /^\s*extern\b/.test(ln) };
    }
    if (aggregateStart && before > 0 && after === 0) {
      const close = ln.match(/^\s*}\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*(?:=|;)/);
      if (close) pushSym(syms, { ...base, line: aggregateStart.line }, close[1], 'var', !aggregateStart.isExtern, initializerEnd(i));
      aggregateStart = null;
    }
    if (before === 0 && /[;=]/.test(ln) && !/^\s*(?:#|typedef\b|using\b|namespace\b|class\b)/.test(ln)) {
      const stop = ln.search(/[;=]/);
      let lhs = stop >= 0 ? ln.slice(0, stop).trim() : '';
      lhs = lhs.replace(/(?:\s*\[[^\]]*\])+\s*$/, '').trim();
      const forwardType = /^(?:struct|union|enum)\s+[A-Za-z_]\w*$/.test(lhs);
      const name = !forwardType && !lhs.includes('(') && lhs.match(/([A-Za-z_]\w*)\s*$/);
      if (name && /\s|\*/.test(lhs.slice(0, name.index))) {
        pushSym(syms, { ...base, line: i + 1 }, name[1], 'var', !/^\s*extern\b/.test(ln), i + 1);
      }
    }
    braceDepth = after;
  });
}

const indexAll = (snippets) => (Array.isArray(snippets) ? snippets : []).flatMap(buildSnippetIndex);
const codeLookupOf = (snippets) => {
  const map = new Map();
  (snippets || []).forEach((s) => (s.fragments || []).forEach((f, fi) => {
    if (f && typeof f.code === 'string') map.set(s.file + '|' + fi, f.code);
  }));
  return map;
};

const exactSymbols = (symbols, name, kind) => symbols.filter((s) => s.name === name && (!kind || s.kind === kind));

/* 定义优先 + 同文件/同片段加权，与前端 resolveDefinition 同分。 */
function resolveDefinition(sym, symbols) {
  if (!sym) return null;
  const cands = exactSymbols(symbols, sym.name, sym.kind);
  if (!cands.length) return sym;
  const score = (s) => (s.isDefinition ? 100 : 0)
    + (s.file === sym.file ? 35 : 0) + (s.frag === sym.frag ? 10 : 0)
    + (/\.(c|cc|cpp|cxx|m|mm)$/i.test(s.fragLabel || '') ? 8 : 0);
  return cands.slice().sort((a, b) => score(b) - score(a) || a.line - b.line)[0];
}

function preferredFunction(name, near, symbols) {
  const cands = exactSymbols(symbols, name, 'fn');
  if (!cands.length) return null;
  const score = (s) => (s.isDefinition ? 100 : 0)
    + (near && s.file === near.file ? 35 : 0) + (near && s.frag === near.frag ? 8 : 0);
  return cands.slice().sort((a, b) => score(b) - score(a))[0];
}

function functionMaskedBody(sym, symbols, codeLookup) {
  const def = resolveDefinition(sym, symbols);
  if (!def || def.kind !== 'fn' || !def.isDefinition || !def.endLine) return '';
  const code = codeLookup.get(def.file + '|' + def.frag);
  if (typeof code !== 'string') return '';
  return maskNonCode(code).split('\n').slice(def.line - 1, def.endLine).join('\n');
}

/* 成员赋值 `p->cb = realFn` 的动态分发候选：与前端 dynamicDispatchTargets 同口径。 */
function dynamicDispatchTargets(member, near, symbols, snippets) {
  const found = new Map();
  const assign = new RegExp('\\.\\s*' + escRe(member) + '\\s*=\\s*([A-Za-z_]\\w*)', 'g');
  (snippets || []).forEach((snip) => (snip.fragments || []).forEach((f) => {
    if (!f || typeof f.code !== 'string' || SKIP_LANGUAGES.has(f.language)) return;
    const src = maskNonCode(f.code);
    let m;
    while ((m = assign.exec(src))) {
      const target = preferredFunction(m[1], near, symbols);
      if (target) found.set(target.id, target);
    }
  }));
  return [...found.values()];
}

function fnCalleeEdges(sym, symbols, snippets, codeLookup) {
  const body = functionMaskedBody(sym, symbols, codeLookup || codeLookupOf(snippets));
  const found = new Map(), re = /\b([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[1];
    if (name === sym.name || OL_CONTROL.has(name)) continue;
    const target = preferredFunction(name, sym, symbols);
    if (target) found.set(target.id, { sym: target, edge: 'direct' });
    else if (/(?:->|\.)\s*$/.test(body.slice(Math.max(0, m.index - 4), m.index))) {
      dynamicDispatchTargets(name, sym, symbols, snippets).forEach((t) => found.set(t.id, { sym: t, edge: 'dynamic' }));
    }
  }
  return [...found.values()];
}

const fnCallees = (sym, symbols, snippets, codeLookup) => fnCalleeEdges(sym, symbols, snippets, codeLookup).map((x) => x.sym);

function fnCallers(sym, symbols, snippets, codeLookup) {
  const target = resolveDefinition(sym, symbols) || sym;
  return symbols.filter((s) => s.kind === 'fn' && s.isDefinition && s.id !== target.id
    && fnCalleeEdges(s, symbols, snippets, codeLookup).some((x) => x.sym.id === target.id));
}

/* 文件层：include 边（C/C++ #include；JS-TS import/require 按 basename 归一）。 */
function allCodeFiles(snippets) {
  const out = [];
  (snippets || []).forEach((snippet) => (snippet.fragments || []).forEach((fragment, frag) => {
    if (fragment && typeof fragment.code === 'string' && !SKIP_LANGUAGES.has(fragment.language)) {
      out.push({ snippet, frag, fragment, file: snippet.file, snippetName: snippet.name || '',
        name: fragment.label || fragment.filename || ('片段 ' + (frag + 1)),
        filename: fragment.filename || '', language: fragment.language, id: snippet.file + '|' + frag });
    }
  }));
  return out;
}

function fileIncludes(file) {
  const out = [];
  const raw = String(file.fragment.code || '').replace(/\r\n/g, '\n').split('\n');
  raw.forEach((ln, i) => {
    let m = ln.match(/^\s*#\s*include\s*(["<])([^"">]+)[">]/);
    if (m) { out.push({ name: m[2], system: m[1] === '<', line: i + 1, kind: 'include' }); return; }
    m = ln.match(/^\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/);
    if (m) { out.push({ name: m[1], system: !m[1].startsWith('.'), line: i + 1, kind: 'import' }); return; }
    m = ln.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m) out.push({ name: m[1], system: !m[1].startsWith('.'), line: i + 1, kind: 'require' });
  });
  return out;
}

function resolveInclude(name, files) {
  const base = baseName(name);
  return files.filter((f) => baseName(f.name) === base || baseName(f.filename) === base);
}

function fileRelationChildren(file, files, dir) {
  if (file.external) return [];
  if (dir === 'down') {
    const out = [];
    fileIncludes(file).forEach((inc) => {
      const targets = resolveInclude(inc.name, files);
      if (targets.length) targets.forEach((t) => out.push({ ...t, edge: inc.system ? 'system' : inc.kind }));
      else out.push({ external: true, name: inc.name, edge: inc.system ? 'system' : 'missing' });
    });
    return out;
  }
  const id = fileNodeIdOf(file), out = [];
  files.forEach((candidate) => fileIncludes(candidate).forEach((inc) => {
    if (resolveInclude(inc.name, files).some((t) => fileNodeIdOf(t) === id)) {
      out.push({ ...candidate, edge: 'included', includeLine: inc.line });
    }
  }));
  return out.filter((n, i) => out.findIndex((x) => fileNodeIdOf(x) === fileNodeIdOf(n)) === i);
}

/* 子图的「根」既接受 id 也接受名字。
   背景：symbolIdOf 拼出来的 id 是 "file|frag|line|kind|name"（如 main.c|0|3|fn|main），
   但调用方手里通常只有**名字** —— 前端点一个符号、接口传 ?rootFunction=main，
   原来只按 id 匹配，于是接口调用永远返回 ok=false「未找到根函数：main」。
   实测踩过。这里保留 id 精确匹配，查不到再按名字回退（优先定义处，避免命中声明）。
   文件名同理：id 形如 "file|frag"，也接受纯文件名。 */
function resolveRootSymbol(symbols, key) {
  const wanted = String(key || '');
  if (!wanted) return null;
  return symbols.find((s) => s.id === wanted)
    || symbols.find((s) => s.name === wanted && s.kind === 'fn' && s.isDefinition)
    || symbols.find((s) => s.name === wanted)
    || null;
}
function resolveRootFile(files, key) {
  const wanted = String(key || '');
  if (!wanted) return null;
  return files.find((f) => f.id === wanted)
    || files.find((f) => f.file === wanted)
    || files.find((f) => f.name === wanted)
    || null;
}

/* 子图 BFS：环用 ancestry 集合截断，depth 默认 3，与前端关系树同语义。 */
function buildFunctionSubgraph(symbols, snippets, rootId, { depth = 3, direction = 'both' } = {}) {
  const codeLookup = codeLookupOf(snippets);
  const root = resolveRootSymbol(symbols, rootId);
  if (!root) return { ok: false, error: '未找到根函数：' + rootId, nodes: [], edges: [] };
  const nodes = new Map([[root.id, { ...root }]]);
  const edges = [];
  const queue = [{ sym: root, d: 0, ancestry: new Set([root.id]) }];
  while (queue.length) {
    const { sym, d, ancestry } = queue.shift();
    if (d >= depth) continue;
    const downs = direction === 'up' ? [] : fnCalleeEdges(sym, symbols, snippets, codeLookup);
    const ups = direction === 'down' ? [] : fnCallers(sym, symbols, snippets, codeLookup).map((s) => ({ sym: s, edge: 'caller' }));
    [...ups.map((x) => ({ ...x, dir: 'up' })), ...downs.map((x) => ({ ...x, dir: 'down' }))].forEach(({ sym: child, edge, dir }) => {
      if (!nodes.has(child.id)) nodes.set(child.id, { ...child });
      edges.push({ from: dir === 'up' ? child.id : sym.id, to: dir === 'up' ? sym.id : child.id, kind: edge });
      if (!ancestry.has(child.id)) queue.push({ sym: child, d: d + 1, ancestry: new Set([...ancestry, child.id]) });
    });
  }
  return { ok: true, root: { ...root }, nodes: [...nodes.values()], edges };
}

function buildFileSubgraph(snippets, rootId, { depth = 2, direction = 'both' } = {}) {
  const files = allCodeFiles(snippets);
  const root = resolveRootFile(files, rootId);
  if (!root) return { ok: false, error: '未找到根文件：' + rootId, nodes: [], edges: [] };
  const nodes = new Map([[root.id, { id: root.id, name: root.name, file: root.file, frag: root.frag, language: root.language }]]);
  const edges = [];
  const queue = [{ file: root, d: 0, ancestry: new Set([root.id]) }];
  while (queue.length) {
    const { file, d, ancestry } = queue.shift();
    if (d >= depth) continue;
    const downs = direction === 'up' ? [] : fileRelationChildren(file, files, 'down');
    const ups = direction === 'down' ? [] : fileRelationChildren(file, files, 'up');
    [...ups.map((n) => ({ n, dir: 'up' })), ...downs.map((n) => ({ n, dir: 'down' }))].forEach(({ n, dir }) => {
      const id = fileNodeIdOf(n);
      if (!nodes.has(id)) nodes.set(id, n.external
        ? { id, external: true, name: n.name, edge: n.edge }
        : { id, name: n.name, file: n.file, frag: n.frag, language: n.language, edge: n.edge });
      edges.push({ from: dir === 'up' ? id : fileNodeIdOf(file), to: dir === 'up' ? fileNodeIdOf(file) : id, kind: n.edge || dir });
      if (!n.external && !ancestry.has(id)) queue.push({ file: n, d: d + 1, ancestry: new Set([...ancestry, id]) });
    });
  }
  return { ok: true, root: nodes.get(root.id), nodes: [...nodes.values()], edges };
}

/* 薄路由唯一入口：一次索引，同时给出函数图 + 文件图摘要。 */
function buildCodeGraph(snippets, { rootFunction = '', rootFile = '', depth = 3, direction = 'both' } = {}) {
  const symbols = indexAll(snippets);
  const files = allCodeFiles(snippets).map((f) => ({ id: f.id, name: f.name, file: f.file, frag: f.frag, language: f.language }));
  const fn = rootFunction ? buildFunctionSubgraph(symbols, snippets, String(rootFunction), { depth, direction }) : { ok: true, nodes: [], edges: [] };
  const fl = rootFile ? buildFileSubgraph(snippets, String(rootFile), { depth: Math.min(3, depth), direction }) : { ok: true, nodes: [], edges: [] };
  return {
    ok: true,
    stats: {
      snippets: (snippets || []).length, files: files.length, symbols: symbols.length,
      functions: symbols.filter((s) => s.kind === 'fn' && s.isDefinition).length,
      types: symbols.filter((s) => s.kind === 'type').length,
    },
    symbols, files, functionGraph: fn, fileGraph: fl,
  };
}

/* 文档级代码图谱：把一个文档里的**所有片段 + 所有函数**摊平，连上三类边。
   与 buildCodeGraph 的区别：那个是「以某个函数/文件为中心」的子图（要传 root），
   这个不需要 root，回答的是「整篇文档里，片段之间、函数之间整体怎么连」。

   节点 kind：
     file  片段（文档里的一个代码块）
     fn    函数定义
   边 kind：
     call     函数调用函数（跨片段也算）
     include  片段包含片段（#include / import）
     owns     片段拥有函数（归属，让片段和它的函数在图上连起来） */
function buildDocumentGraph(snippets) {
  const symbols = indexAll(snippets);
  const codeLookup = codeLookupOf(snippets);
  const files = allCodeFiles(snippets);
  const fnId = (s) => 's:' + s.id;
  const fileId = (f) => 'f:' + fileNodeIdOf(f);
  const nodes = [];
  const edges = [];
  const seenNode = new Set();
  const pushNode = (node) => { if (seenNode.has(node.id)) return; seenNode.add(node.id); nodes.push(node); };
  const seenEdge = new Set();
  const pushEdge = (edge) => {
    if (!edge.from || !edge.to || edge.from === edge.to) return;
    const key = edge.from + '>' + edge.to;
    if (seenEdge.has(key)) return;
    seenEdge.add(key); edges.push(edge);
  };

  files.forEach((f) => pushNode({
    id: fileId(f), kind: 'file', label: f.name || f.file,
    file: f.file, frag: f.frag, line: 1, language: f.language,
  }));
  const defs = symbols.filter((s) => s.kind === 'fn' && s.isDefinition);
  defs.forEach((s) => pushNode({
    id: fnId(s), kind: 'fn', label: s.name,
    file: s.file, frag: s.frag, line: s.line, endLine: s.endLine, language: s.language,
  }));

  /* 归属边：片段 → 它里面的函数 */
  defs.forEach((s) => pushEdge({ from: 'f:' + s.file + '|' + s.frag, to: fnId(s), kind: 'owns' }));
  /* 调用边：函数 → 被调函数 */
  defs.forEach((s) => {
    fnCalleeEdges(s, symbols, snippets, codeLookup).forEach((hit) => {
      if (!hit || !hit.sym || !hit.sym.isDefinition) return;
      pushEdge({ from: fnId(s), to: fnId(hit.sym), kind: 'call' });
    });
  });
  /* 包含边：片段 → 被包含片段 */
  files.forEach((f) => {
    fileIncludes(f).forEach((inc) => {
      resolveInclude(inc.name, files).forEach((target) => pushEdge({ from: fileId(f), to: fileId(target), kind: 'include' }));
    });
  });

  return {
    ok: true,
    nodes, edges,
    stats: {
      fragments: files.length,
      functions: defs.length,
      calls: edges.filter((e) => e.kind === 'call').length,
      includes: edges.filter((e) => e.kind === 'include').length,
    },
  };
}

/* 自检样例：与前端 parserSelfCheck 同夹具，保证前后端不分叉。 */
function parserSelfCheck() {
  const fixture = { file: '__parser_self_check__', name: 'parser self check', fragments: [{
    label: 'fixture.c', language: 'c_cpp', code: [
      'typedef uint32_t word_t;', 'typedef struct opaque opaque_t;', 'typedef int (*callback_t)(void);',
      'using count_t = unsigned long;', 'struct box {', '  const int member;', '};', 'static const struct',
      '{', '  int member;', '} table[] =', '{', '  { 1 }', '};', 'int plain_global;',
      'int declared(int x);', 'int defined(int x) { return x; }',
    ].join('\n'),
  }] };
  const idx = buildSnippetIndex(fixture);
  const has = (name, kind, def) => idx.some((s) => s.name === name && s.kind === kind && (def === undefined || s.isDefinition === def));
  const issues = [];
  [['word_t', 'type'], ['opaque_t', 'type'], ['callback_t', 'type'], ['count_t', 'type'], ['table', 'var'], ['plain_global', 'var']]
    .forEach(([name, kind]) => { if (!has(name, kind)) issues.push('漏识别 ' + name); });
  if (has('member', 'var')) issues.push('结构体成员被误判为文件级变量');
  const table = idx.find((s) => s.name === 'table' && s.kind === 'var');
  if (table && (table.line !== 8 || table.endLine !== 14)) issues.push('匿名结构体变量范围定位错误');
  if (!has('declared', 'fn', false)) issues.push('函数声明分类错误');
  if (!has('defined', 'fn', true)) issues.push('函数定义分类错误');
  return issues;
}

module.exports = {
  OL_CONTROL, CODE_LANGUAGES, SKIP_LANGUAGES,
  countCh, escRe, baseName, symbolIdOf, fileNodeIdOf,
  maskNonCode, outlineFor, indentedExtent, functionExtent, typeExtent,
  buildSnippetIndex, indexAll, codeLookupOf, exactSymbols,
  resolveDefinition, preferredFunction, functionMaskedBody,
  dynamicDispatchTargets, fnCalleeEdges, fnCallees, fnCallers,
  allCodeFiles, fileIncludes, resolveInclude, fileRelationChildren,
  buildFunctionSubgraph, buildFileSubgraph, buildCodeGraph, buildDocumentGraph, parserSelfCheck,
};