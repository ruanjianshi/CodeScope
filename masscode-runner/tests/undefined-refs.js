#!/usr/bin/env node
/* 静态检查：**引用了、但任何地方都没声明**的标识符 ✓（= 运行时会 ReferenceError 的那种）
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 为什么要有这个（2026-10-19）✗：
 *   用户报「文件夹无法重命名」✓ → 查出来是 `ReferenceError: renameProjectFolder is not defined` ✓ ——
 *   函数定义在闭包里 ✓，顶层右键菜单直接调 ✓，浏览器里**什么都不发生** ✓，只有控制台一行红字 ✗。
 *   顺着这条线索扫全项目，又挖出 **6 处同类问题** ✓：
 *     · 项目树「新建文件 / 新建文件夹 / 重命名」  ← 用户报的
 *     · 片段行「删除片段」
 *     · 命令面板「显示集成终端」/「项目调试」（`setOutputTab` 根本不存在 ✓）
 *     · PDF 划词取文本（`selectedRectsIn` 在 app-pdf 的 IIFE 里 ✓，没走 window.__pdfSelectedRectsIn ✗）
 *     · Markdown 删 callout 引用（`renderLive` 全项目不存在 ✓）
 *     · VS Code 打开失败时的报错文案（`response` 未定义 ✓ → 报的是「response is not defined」✗）
 *     · 本机管家「重启 CodeScope」成功后的提示（包里没有 `setStatus` ✓，叫 `toast` ✗）
 *   ⇒ 这类 bug 的共同点：**不崩页面、不弹提示、只在控制台留一行** ✗ —— 靠人工点很难发现 ✓，
 *      但静态扫一遍只要 200ms ✓。所以钉成测试 ✓。
 *
 * 做法（零依赖，用项目已有的 acorn ✓）：
 *   1. 先把**所有脚本**的「全局名」收起来 ✓（顶格 function/var/let/const/class + `window.X =` ✓）
 *   2. 再逐个文件做作用域分析 ✓，把「解析不到」的标识符报出来 ✓
 *   3. 白名单只放**真正的浏览器全局** ✓（innerWidth 这种 ✓）
 * ⚠️ 它**不是** TypeScript ✓：只查「名字存不存在」✓，不查类型 ✓。
 *    宁可漏报（比如动态拼出来的名字 ✓），也绝不制造一堆假阳性 ✓ —— 假阳性的测试没人看 ✓。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const acorn = require(path.join(root, 'node_modules', 'acorn'));

/* 只查**自己写的**脚本 ✓ —— 第三方（pdfjs / xterm / highlight / monaco…）不查 ✗：
   它们动辄几万行、还有各种动态写法 ✓，查了只会淹在噪音里 ✓。 */
const FILES = [
  'assets/app.js',
  'assets/life-workbench.js',
  'assets/app-pdf.js',
  /* ⚠️ 架构视图是**六个文件**拼起来的 ✓（index.html 按「布局 → 画图 → 面板」顺序加载 ✓）——
     只查 arch-view.js 会把它调 archGraphSvg / archAISvg / wireArchZoom 全报成「没声明」✗
     （第一版就是这样误报了 5 条 ✗）。要么全查，要么别查 ✗。 */
  'assets/arch-layout.js',
  'assets/arch-round.js',
  'assets/arch-graph-svg.js',
  'assets/arch-zoom.js',
  'assets/arch-ai-view.js',
  'assets/arch-view.js',
  'assets/debug-panel.js',
  'assets/code-guide.js',
  'src/system-panel.js',
  'src/system-files-view.js',
];

/* 真正的浏览器 / 运行时全局 ✓（**不要**往里加项目自己的函数名 ✗ —— 那就失去意义了 ✗） */
const ENV_GLOBALS = new Set(`window document console navigator location localStorage sessionStorage history screen
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask requestIdleCallback
fetch XMLHttpRequest WebSocket EventSource AbortController AbortSignal Headers Request Response FormData Blob File FileReader
URL URLSearchParams JSON Math Date Promise Map Set WeakMap WeakSet Array Object String Number Boolean RegExp Error TypeError
RangeError SyntaxError URIError EvalError Symbol BigInt Intl Reflect Proxy ArrayBuffer SharedArrayBuffer DataView
Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape
alert confirm prompt structuredClone crypto performance devicePixelRatio getComputedStyle matchMedia
CustomEvent Event MouseEvent KeyboardEvent PointerEvent WheelEvent DragEvent ClipboardEvent InputEvent FocusEvent TouchEvent
MutationObserver ResizeObserver IntersectionObserver PerformanceObserver Image Audio Option TextEncoder TextDecoder
atob btoa CSS Node Element HTMLElement DocumentFragment Range Selection FileList DataTransfer
reportError arguments undefined NaN Infinity globalThis self top parent frames innerWidth innerHeight outerWidth outerHeight
scrollX scrollY pageXOffset pageYOffset open close focus blur print
FontFace XMLSerializer DOMParser NodeFilter MutationRecord DOMRect DOMException MessageChannel BroadcastChannel Worker
indexedDB IDBKeyRange caches Notification Clipboard ClipboardItem FileSystemHandle
Path2D DOMMatrix ImageData createImageBitmap OffscreenCanvas MediaStream MediaRecorder RTCPeerConnection
monaco require module exports process Buffer __dirname __filename global
XLSX Highlight Terminal
eval`.split(/\s+/).filter(Boolean));

function parse(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true, locations: true });
}

/* 收集「这个文件对外暴露的名字」✓（顶格声明 + window.X = ...） */
function collectGlobals(ast) {
  const names = new Set();
  for (const node of ast.body) {
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) names.add(node.id.name);
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.id.type === 'Identifier') names.add(d.id.name);
        if (d.id.type === 'ObjectPattern') d.id.properties.forEach((p) => { if (p.value && p.value.type === 'Identifier') names.add(p.value.name); });
      }
    }
  }
  /* window.xxx = ...（含 if (typeof x === 'undefined') window.x = …） */
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'AssignmentExpression' && node.left && node.left.type === 'MemberExpression'
      && !node.left.computed && node.left.object && node.left.object.name === 'window'
      && node.left.property && node.left.property.type === 'Identifier') {
      names.add(node.left.property.name);
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((x) => { if (x && typeof x.type === 'string') walk(x); });
      else if (v && typeof v.type === 'string') walk(v);
    }
  };
  walk(ast);
  return names;
}

function analyze(ast, externalGlobals) {
  const declare = (pat, scope) => {
    if (!pat) return;
    switch (pat.type) {
      case 'Identifier': scope.names.add(pat.name); break;
      case 'ObjectPattern': pat.properties.forEach((p) => declare(p.value || p.argument, scope)); break;
      case 'ArrayPattern': pat.elements.forEach((e) => declare(e, scope)); break;
      case 'RestElement': declare(pat.argument, scope); break;
      case 'AssignmentPattern': declare(pat.left, scope); break;
    }
  };
  const collect = (node, scope) => {
    if (!node || typeof node.type !== 'string') return;
    if (/Function/.test(node.type)) {
      if (node.type === 'FunctionDeclaration' && node.id) scope.names.add(node.id.name);
      return;                                   /* 不进子函数体 ✓ */
    }
    if (node.type === 'VariableDeclaration') node.declarations.forEach((d) => declare(d.id, scope));
    if (node.type === 'ClassDeclaration' && node.id) scope.names.add(node.id.name);
    if (node.type === 'CatchClause' && node.param) declare(node.param, scope);
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((x) => { if (x && typeof x.type === 'string') collect(x, scope); });
      else if (v && typeof v.type === 'string') collect(v, scope);
    }
  };
  const resolve = (name, scope) => {
    if (ENV_GLOBALS.has(name) || externalGlobals.has(name)) return true;
    let s = scope;
    while (s) { if (s.names.has(name)) return true; s = s.parent; }
    return false;
  };
  const problems = [];
  const visit = (node, scope, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    if (/Function/.test(node.type)) {
      const s = { names: new Set(), parent: scope };
      (node.params || []).forEach((p) => declare(p, s));
      if (node.type === 'FunctionExpression' && node.id) s.names.add(node.id.name);
      collect(node.body, s);
      if (node.id && node.type === 'FunctionDeclaration') scope.names.add(node.id.name);
      if (node.body) visit(node.body, s, node, 'body');
      return;
    }
    if (node.type === 'Identifier') {
      if (parent) {
        if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
        if (parent.type === 'Property' && key === 'key' && !parent.computed) return;
        if (parent.type === 'MethodDefinition' && key === 'key') return;
        if (/Label|Break|Continue/.test(parent.type)) return;
        if (/Import|Export/.test(parent.type)) return;
      }
      if (!resolve(node.name, scope)) problems.push({ name: node.name, line: node.loc ? node.loc.start.line : 0 });
      return;
    }
    if (node.type === 'VariableDeclaration') node.declarations.forEach((d) => declare(d.id, scope));
    if (node.type === 'ClassDeclaration' && node.id) scope.names.add(node.id.name);
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((x) => { if (x && typeof x.type === 'string') visit(x, scope, node, k); });
      else if (v && typeof v.type === 'string') visit(v, scope, node, k);
    }
  };
  const rootScope = { names: new Set(), parent: null };
  collect(ast, rootScope);
  visit(ast, rootScope, null, null);
  const uniq = new Map();
  for (const p of problems) if (!uniq.has(p.name)) uniq.set(p.name, p);
  return [...uniq.values()];
}

const asts = new Map();
for (const f of FILES) {
  try { asts.set(f, parse(f)); } catch (e) { console.log('  ⚠ 跳过（解析失败）：' + f + ' —— ' + e.message); }
}
/* 所有文件的「对外名字」并集 ✓ —— 跨文件调用（debug-panel / arch-view / app-pdf）靠它 ✓ */
const globals = new Set();
for (const ast of asts.values()) for (const n of collectGlobals(ast)) globals.add(n);

let bad = 0;
for (const [f, ast] of asts) {
  const probs = analyze(ast, globals);
  if (!probs.length) continue;
  bad += probs.length;
  console.log('\n  ✗ ' + f + ' 有 ' + probs.length + ' 处引用了没声明的名字：');
  probs.slice(0, 20).forEach((p) => console.log('      行' + String(p.line).padEnd(6) + p.name));
}
if (bad) {
  console.log('\n✗ 共 ' + bad + ' 处 —— 这些在浏览器里都是 **ReferenceError** ✓：');
  console.log('  表现是「点了没反应」/「某块一直读取中」✓，只有控制台一行红字 ✗，用户完全看不到 ✗。');
  process.exit(1);
}
console.log('  ✅ 没有「引用了但没声明」的标识符（查了 ' + asts.size + ' 个脚本）');
