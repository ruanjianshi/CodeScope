#!/usr/bin/env node
'use strict';
/*
 * 路由抽取工具（一次性的，但可以反复用）
 * ---------------------------------------------------------------------------
 * 为什么要有它：
 *   server.js 里 215 个端点挤在一个 3,623 行的 http.createServer 回调里。
 *   要把它拆成 lib/routes/<组名>.js，**手工切很容易切错一行** ——
 *   而且切错了**语法检查还能过**（上次就踩到：少切了最后一行，
 *   块少了闭合括号，node --check 照样通过）。
 *
 *   → 把这套动作写成脚本：**边界是算出来的，不是手抄的**。
 *
 * 用法：
 *   node tools/extract-route.js <组名> <起始行> <结束行> [--dry]
 *   例：node tools/extract-route.js latex 7296 7381
 *
 * 它做四件事：
 *   ① 从 server.js 切出 [起始行, 结束行]（**含两端**）；
 *   ② 写成 lib/routes/<组名>.js（带上约定说明）；
 *   ③ 把 server.js 里那段换成 `if (await xxxRoute.handle(req,res,u,ctx)) return;`；
 *   ④ 在 server.js 顶部加 require。
 *
 * ⚠️ 做完**必须自己验**：node --check 两个文件 + 跑一遍那个功能 + npm test。
 *    这个脚本只保证"切的位置对"，不保证"语义没变"。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);

const group = process.argv[2];
const from = Number(process.argv[3]);
const to = Number(process.argv[4]);
const dry = process.argv.includes('--dry');

if (!group || !from || !to) {
  console.error('用法：node tools/extract-route.js <组名> <起始行> <结束行> [--dry]');
  process.exit(1);
}

const serverPath = path.join(root, 'server.js');
const lines = fs.readFileSync(serverPath, 'utf8').split(NL);

const s = from - 1;      /* 0-based ✓ */
const e = to;            /* slice 不含 e ✓ —— 所以传进来的"结束行"要 +1 才是我们要的 */
const body = lines.slice(s, e);

console.log('  组名: /api/' + group);
console.log('  切出: L' + from + ' → L' + to + '（' + body.length + ' 行）');
console.log('  首行: ' + JSON.stringify((body[0] || '').slice(0, 70)));
console.log('  末行: ' + JSON.stringify((body[body.length - 1] || '').slice(0, 70)));

/* 安全检查：末行必须是一个闭合的 `}`（说明边界是整块的） */
if (!/^\s*\}\s*$/.test(body[body.length - 1] || '')) {
  console.error('  ✗ 末行不是单独的 `}` —— 边界八成不对，先核对再切');
  process.exit(2);
}
/* 安全检查：首行必须是个 if ✓ */
if (!/^\s*if \(/.test(body[0] || '')) {
  console.error('  ✗ 首行不是 `if (` —— 边界八成不对');
  process.exit(2);
}

if (dry) { console.log('  （--dry：没有写任何文件）'); process.exit(0); }

/* 降一级缩进（原来在 server 回调的 try 里，6 空格 → 4 空格） */
const dedented = body.map((l) => (l.startsWith('      ') ? l.slice(2) : l)).join(NL);

const head = [
  '#!/usr/bin/env node',
  "'use strict';",
  '/*',
  ' * 路由：' + group + '（/api/' + group + '/*）',
  ' * ---------------------------------------------------------------------------',
  ' * ★ 从 server.js 抽出来的（2026-10-11）——',
  ' *   用 tools/extract-route.js 切的，边界是**算出来**的，不是手抄的。',
  ' *',
  ' * ── 约定（每个 lib/routes/*.js 都一样）──',
  ' *   ① 导出 `async function handle(req, res, u, ctx) → boolean`；',
  ' *   ② **处理了就返回 true**，没处理返回 false，让调用方继续往下走',
  ' *      （路由是**顺序 if**，不返回的话会继续往下撞别的分支）；',
  ' *   ③ **依赖用 ctx 显式传**，不用全局 ——',
  ' *      显式传看起来啰嗦，但**看得见依赖**；全局看不见，拆到第三个文件就没人敢动了。',
  ' *',
  ' * ⚠️ 改完要验：node --check 两个文件 + 跑一遍这个功能 + npm test。',
  ' */',
  '',
  'async function handle(req, res, u, ctx) {',
  '  /* ctx 里约定要有的东西，按需解构（调用方保证传）*/',
  '  const { readBody, send } = ctx;',
  '',
  dedented,
  '  return false;   /* 这一组没吃掉，调用方继续往下走 */',
  '}',
  '',
  'module.exports = { handle };',
  '',
].join(NL);

fs.writeFileSync(path.join(root, 'lib', 'routes', group + '.js'), head);

/* 替换 server.js 里那一段 ✓ */
const varName = group.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Route';
const call = [
  '      /* ★ ' + group + ' 路由抽到 lib/routes/' + group + '.js（2026-10-11）——',
  '         样板见那个文件的文件头。 */',
  '      if (await ' + varName + '.handle(req, res, u, ctx)) return;',
];
const out = lines.slice(0, s).concat(call).concat(lines.slice(e));
let src = out.join(NL);

/* 加 require ✓ */
const reqLine = "const " + varName + " = require('./lib/routes/" + group + "');";
if (!src.includes(reqLine)) {
  const anchor = src.indexOf('const dbgRoute = require(');
  if (anchor > 0) {
    const lineEnd = src.indexOf(NL, anchor);
    src = src.slice(0, lineEnd + 1) + reqLine + NL + src.slice(lineEnd + 1);
  } else {
    src = src.replace(/'use strict';/, "'use strict';" + NL + NL + reqLine);
  }
}
fs.writeFileSync(serverPath, src);

console.log('  ✓ lib/routes/' + group + '.js 已写');
console.log('  ✓ server.js：' + lines.length + ' → ' + src.split(NL).length + ' 行');
console.log('  ⚠️ 接下来自己验：node --check 两个文件 + 跑一遍功能 + npm test');
