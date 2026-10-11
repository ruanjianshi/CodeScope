#!/usr/bin/env node
'use strict';
/*
 * 路由批量抽取（把 server.js 里的 /api/* 全拆到 lib/routes/）
 * ---------------------------------------------------------------------------
 * 上一版（tools/extract-route.js）只能一组一组手工抽，而且**ctx 要人肉回看** ——
 * 那个是最大的坑：漏一个依赖**语法检查照样过**，跑起来才炸。
 *
 * 这一版把 ctx 也自动化了：
 *   ① 先扫 server.js 的**所有顶层名字**（const/let/var/function/class + 解构出来的）；
 *   ② 对每组，找出它正文里**引用了但自己没定义**的名字；
 *   ③ 只把**在 ① 里存在的**那些放进 ctx（其余的当全局/内置，不传）。
 *   这样"漏依赖"就变成机械可查的事，不靠人眼。
 *
 * 用法：
 *   node tools/extract-routes-all.js [--dry] [--only latex,study] [--max-lines 400]
 *
 * ⚠️ 抽完**必须**：node --check server.js + 真打几个端点 + npm test。
 *    这个脚本保证"边界和依赖对"，**不保证语义没变**。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);
const dry = process.argv.includes('--dry');
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 && process.argv[onlyArg + 1] ? process.argv[onlyArg + 1].split(',') : null;
const maxArg = process.argv.indexOf('--max-lines');
const MAX_LINES = maxArg >= 0 ? Number(process.argv[maxArg + 1]) || 400 : 400;

const serverPath = path.join(root, 'server.js');
let lines = fs.readFileSync(serverPath, 'utf8').split(NL);

/* ── ① server.js 的所有顶层名字 ─────────────────────────────────────── */
function topLevelNames(src) {
  const names = new Set();
  /* const/let/var/function/class 声明 */
  const re1 = /^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re1.exec(src))) names.add(m[1]);
  /* 解构：const { a, b: c } = … */
  const re2 = /^(?:const|let|var)\s*\{([^}]*)\}\s*=/gm;
  while ((m = re2.exec(src))) {
    m[1].split(',').forEach((part) => {
      const t = part.split(':').pop().trim().replace(/=.*$/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    });
  }
  /* 解构：const [a, b] = … */
  const re3 = /^(?:const|let|var)\s*\[([^\]]*)\]\s*=/gm;
  while ((m = re3.exec(src))) {
    m[1].split(',').forEach((t) => {
      const v = t.trim().replace(/=.*$/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(v)) names.add(v);
    });
  }
  return names;
}

/* ── 找出一个代码块引用了、但自己没定义的名字 ─────────────────────── */
const BUILTIN = new Set([
  'require', 'module', 'exports', 'process', 'console', 'Buffer', 'global', 'globalThis',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'Promise', 'JSON', 'Math', 'Date', 'Number', 'String', 'Boolean', 'Array', 'Object', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy',
  'Reflect', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'URL', 'URLSearchParams', 'TextEncoder',
  'TextDecoder', 'AbortController', 'fetch', 'structuredClone', 'atob', 'btoa',
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'this', 'arguments',
  'if', 'else', 'for', 'while', 'do', 'return', 'function', 'async', 'await', 'try', 'catch',
  'finally', 'throw', 'new', 'typeof', 'instanceof', 'in', 'of', 'const', 'let', 'var', 'class',
  'extends', 'super', 'yield', 'delete', 'void', 'case', 'switch', 'break', 'continue', 'default',
]);

function freeNames(code) {
  const declared = new Set();
  let m;
  /* 局部声明 */
  const re1 = /(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = re1.exec(code))) declared.add(m[1]);
  /* ⚠️⚠️ **不要**用"括号里的东西"当参数 ✗✗（第一版就栽在这 ✓）——
     我原来写了 `/(?:function\s*[\w$]*|\([^()]*\))/g` 想抓参数 ✓，
     结果**任何出现在括号里的标识符都被当成"已声明"** ✗ →
     `send(res, 200, { version: APP_VERSION })` 里的 `APP_VERSION` 被误判 ✓
     → **没进 ctx** ✓ → 语法全过、启动无报错、**一打那个端点就 500** ✓✓
     （实测：/api/version → "APP_VERSION is not defined" ✓）。
     → **宁可多传，不能少传** ✗✓：
       多传一个 undefined 只是白占个位置 ✓；少传一个就 500 ✓✓。 */
  /* 解构 */
  const re3 = /\{([^{}]*)\}\s*=/g;
  while ((m = re3.exec(code))) {
    m[1].split(',').forEach((p) => {
      const t = p.split(':').pop().trim().replace(/=.*$/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
    });
  }
  /* 属性访问 `x.y` 里的 y 不算自由变量 ✓ */
  const ids = new Set();
  const re4 = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
  while ((m = re4.exec(code))) ids.add(m[2]);
  return [...ids].filter((x) => !declared.has(x) && !BUILTIN.has(x));
}

/* ── ② 找出所有 /api 组，以及每组的块范围 ─────────────────────────── */
function findGroups(src) {
  const L = src.split(NL);
  const groups = [];
  for (let i = 0; i < L.length; i++) {
    const m = /^\s*if \(.*u\.pathname === ['"]\/api\/([a-z0-9-]+)/.exec(L[i]);
    if (!m) continue;
    /* 找这个 if 的结束（括号配平 ✓） */
    let d = 0, j = i;
    for (; j < L.length; j++) {
      for (const ch of L[j]) { if (ch === '{') d++; else if (ch === '}') d--; }
      if (j > i && d <= 0) break;
    }
    groups.push({ g: m[1], from: i + 1, to: j + 1, len: j - i + 1 });
  }
  /* 同组的多段合并成一段（它们通常连续 ✓） */
  const byG = {};
  groups.forEach((x) => {
    if (!byG[x.g]) byG[x.g] = { g: x.g, from: x.from, to: x.to, len: x.len, n: 1 };
    else { byG[x.g].to = x.to; byG[x.g].len = byG[x.g].to - byG[x.g].from + 1; byG[x.g].n++; }
  });
  return Object.values(byG);
}

const TOP = topLevelNames(lines.join(NL));
console.log('  server.js 顶层名字: ' + TOP.size + ' 个');

let groups = findGroups(lines.join(NL)).sort((a, b) => a.from - b.from);

/* ⚠️⚠️ **重叠检测** ✗✗（第一次 dry-run 才发现的 ✓）——
   有些组的代码是**交错**的：比如 /api/readings 的段从 L6942 一直到 L7212，
   而 /api/knowledge 的段（L6947→6971）**夹在它中间** ✓。
   直接按 [from, to] 抽，会把 knowledge 的代码**一起拖进 readings 文件** ✓ →
   而**语法检查照样过** ✓（两段都是合法的 if ✓），**跑起来才发现 knowledge 没了** ✓✓。
   → **重叠的组一律跳过** ✓，留给人工单独处理 ✓（宁可不做，不能做错 ✓）。 */
const overlap = new Set();
for (let i = 0; i < groups.length; i++) {
  for (let j = i + 1; j < groups.length; j++) {
    const a = groups[i], b = groups[j];
    if (a.from <= b.to && b.from <= a.to) { overlap.add(a.g); overlap.add(b.g); }
  }
}
const skipped = groups.filter((x) => overlap.has(x.g));
groups = groups.filter((x) => !overlap.has(x.g));
if (skipped.length) {
  console.log('  ⚠️ 跳过 ' + skipped.length + ' 个**代码交错**的组（人工处理）：');
  skipped.forEach((x) => console.log('      /api/' + x.g.padEnd(14) + 'L' + x.from + '→' + x.to));
}

if (only) groups = groups.filter((x) => only.includes(x.g));
groups = groups.filter((x) => x.len <= MAX_LINES);
console.log('  待抽的组: ' + groups.length + ' 个（每组 ≤ ' + MAX_LINES + ' 行）');
groups.forEach((x) => console.log('    /api/' + x.g.padEnd(14) + 'L' + x.from + '→' + x.to + '  ' + x.len + ' 行  ' + x.n + ' 段'));

if (dry) { console.log('  （--dry：没写任何文件）'); process.exit(0); }

/* ── ③ 从后往前抽（这样行号不会乱 ✓）────────────────────────────────── */
const results = [];
for (const g of groups.slice().sort((a, b) => b.from - a.from)) {
  /* 重新读（前面的抽取改了行号 ✓ —— 所以用「组名 + 内容」定位更稳 ✓） */
  const src = lines.join(NL);
  const L = src.split(NL);
  const again = findGroups(src).find((x) => x.g === g.g);
  if (!again) { results.push({ g: g.g, ok: false, why: '找不到（可能已被抽走）' }); continue; }
  const s = again.from - 1, e = again.to;
  const body = L.slice(s, e);
  if (!/^\s*\}\s*$/.test(body[body.length - 1] || '')) { results.push({ g: g.g, ok: false, why: '末行不是 }' }); continue; }
  if (!/^\s*if \(/.test(body[0] || '')) { results.push({ g: g.g, ok: false, why: '首行不是 if (' }); continue; }

  /* ★ 自动推 ctx ✓ —— 这是这一版的重点 ✓ */
  const free = freeNames(body.join(NL)).filter((x) => TOP.has(x));
  const varName = g.g.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Route';
  const dedented = body.map((l) => (l.startsWith('      ') ? l.slice(2) : l)).join(NL);

  const head = [
    '#!/usr/bin/env node',
    "'use strict';",
    '/*',
    ' * 路由：' + g.g + '（/api/' + g.g + '/*）',
    ' * ---------------------------------------------------------------------------',
    ' * ★ 从 server.js 抽出来的（2026-10-11），用 tools/extract-routes-all.js ✓',
    ' *',
    ' * ── 约定（每个 lib/routes/*.js 都一样）──',
    ' *   ① 导出 `async function handle(req, res, u, ctx) → boolean`；',
    ' *   ② **处理了就返回 true**，没处理返回 false，让调用方继续往下走',
    ' *      （路由是**顺序 if**，不返回的话会继续往下撞别的分支）；',
    ' *   ③ **依赖用 ctx 显式传**，不用全局 ——',
    ' *      显式传看起来啰嗦，但**看得见依赖**；全局看不见，拆到第三个文件就没人敢动了。',
    ' *',
    ' * ⚠️ 下面的 ctx 解构是**工具扫出来**的（扫 server.js 的顶层名字 ✓），',
    ' *    不是人写的 —— 所以它应该刚好等于"这组真正用到的外部符号" ✓。',
    ' *    如果手工改了这里，记得同步 server.js 的调用点 ✓。',
    ' */',
    '',
    'async function handle(req, res, u, ctx) {',
    free.length ? '  const { ' + free.join(', ') + ' } = ctx;' : '  /* 这组不依赖 server.js 的顶层符号 ✓ */',
    '',
    dedented,
    '  return false;   /* 这一组没吃掉，调用方继续往下走 */',
    '}',
    '',
    'module.exports = { handle };',
    '',
  ].join(NL);
  fs.writeFileSync(path.join(root, 'lib', 'routes', g.g + '.js'), head);

  const call = [
    '      /* ★ ' + g.g + ' 路由抽到 lib/routes/' + g.g + '.js（2026-10-11）*/',
    '      if (await ' + varName + '.handle(req, res, u, { ' + free.join(', ') + ' })) return;',
  ];
  lines = L.slice(0, s).concat(call).concat(L.slice(e));
  results.push({ g: g.g, ok: true, lines: again.len, ctx: free.length, varName });
}

/* ── ④ 加 require ✓ ─────────────────────────────────────────────────── */
let src = lines.join(NL);
const reqs = results.filter((r) => r.ok).map((r) => "const " + r.varName + " = require('./lib/routes/" + r.g + "');");
if (reqs.length) {
  const anchor = src.indexOf('const dbgRoute = require(');
  const block = reqs.filter((r) => !src.includes(r)).join(NL);
  if (block) {
    if (anchor > 0) {
      const lineEnd = src.indexOf(NL, anchor);
      src = src.slice(0, lineEnd + 1) + block + NL + src.slice(lineEnd + 1);
    } else {
      src = src.replace(/'use strict';/, "'use strict';" + NL + NL + block);
    }
  }
}
fs.writeFileSync(serverPath, src);

console.log('');
const okN = results.filter((r) => r.ok).length;
console.log('  ✓ 抽了 ' + okN + ' 组');
results.filter((r) => r.ok).forEach((r) => console.log('    /api/' + r.g.padEnd(14) + r.lines + ' 行 → ' + r.ctx + ' 个依赖'));
results.filter((r) => !r.ok).forEach((r) => console.log('    ✗ /api/' + r.g + '：' + r.why));
console.log('  server.js: ' + lines.length + ' 行');
console.log('  ⚠️ 自己验：node --check server.js + 真打端点 + npm test');
