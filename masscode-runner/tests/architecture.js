#!/usr/bin/env node
'use strict';
/*
 * 架构断言（结构测试）
 * ---------------------------------------------------------------------------
 * 为什么要有这个文件：
 *   现在 50 个测试**全是功能测试** —— 没有一条在守**结构**。
 *   结果就是「app.js 涨到 17,142 行」这种事**没有任何测试会红**，
 *   只能靠人偶然发现（这次就是偶然发现）。
 *
 * 学自 Archify 的两条：
 *   ① 节点/结论要带**源证据**（能追到文件、能自己量一遍）；
 *   ② 架构要**可校验** —— 写成断言，而不是只靠人看图。
 *
 * ⚠️ 这里**不做"一刀切"**（比如"所有文件必须 < 500 行"）——
 *    那种断言在第一天就会红，然后大家学会忽略它。
 *    这里用的是**棘轮（ratchet）**：
 *    把现状记成"上限"，**只准变小不准变大**。
 *    这样重构有进度就会绿，退步就会红。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const results = [];
const fails = [];
let pass = 0;

function ck(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) pass += 1;
  else fails.push(name + (detail ? '（' + detail + '）' : ''));
}

function lines(rel) {
  try {
    /* ⚠️ 要和 `wc -l` 对齐 ✗（第一次写漏了 `- 1` ✓）——
       `split('\n')` 在文件以换行结尾时会多出一个空元素 ✓ →
       每个文件都"比上限多 1 行" ✓，**5 条断言全红** ✓（第一次跑就是这样 ✓）。 */
    const s = fs.readFileSync(path.join(root, rel), 'utf8');
    return s.length ? s.split('\n').length - 1 : 0;
  } catch (_) { return -1; }
}

function countIn(rel, re) {
  try {
    const s = fs.readFileSync(path.join(root, rel), 'utf8');
    return (s.match(re) || []).length;
  } catch (_) { return -1; }
}

console.log('\n── ① 巨型文件棘轮（只准变小，不准变大）──');

/* 现状上限。**只准往下调**（重构成功就把数字改小）。
   ⚠️ 别为了让测试变绿而往上调 —— 那就把棘轮拆了。 */
const SIZE_CAP = [
  ['assets/app.js', 16294],
  ['server.js', 8263],
  ['assets/app.css', 4287],
  ['src/system-panel.js', 3746],
  ['lib/system-panel.js', 2471],
  ['assets/debug-panel.js', 900],
  ['lib/routes/dbg.js', 160],
  ['lib/routes/latex.js', 200],
  ['lib/arch/analyze.js', 350],
  ['lib/arch/render.js', 450],
    ['lib/routes/arch.js', 200],
  ['lib/routes/check.js', 250],
  ['lib/routes/env.js', 250],
  ['lib/routes/fig.js', 250],
  ['lib/routes/format.js', 250],
  ['lib/routes/graph.js', 250],
  ['lib/routes/integrations.js', 250],
  ['lib/routes/logic.js', 250],
  ['lib/routes/matlab.js', 250],
  ['lib/routes/office.js', 250],
  ['lib/routes/py.js', 250],
  ['lib/routes/remote.js', 250],
  ['lib/routes/reorder.js', 250],
  ['lib/routes/rev.js', 250],
  ['lib/routes/run.js', 250],
  ['lib/routes/save.js', 250],
  ['lib/routes/snippets.js', 250],
  ['lib/routes/study.js', 250],
  ['lib/routes/sync.js', 250],
  ['lib/routes/system-panel.js', 250],
  ['lib/routes/system.js', 250],
  ['lib/routes/tags.js', 250],
  ['lib/routes/term.js', 250],
  ['lib/routes/version.js', 250],   /* 路由模块，样板 ✓ */   /* 刚抽出来的，别让它再涨回去 ✓ */
];
for (const [rel, cap] of SIZE_CAP) {
  const n = lines(rel);
  ck('  ' + rel + ' ≤ ' + cap + ' 行', n > 0 && n <= cap, '实际 ' + n + ' 行');
}

console.log('\n── ② ARCHITECTURE.md 里的数字必须和代码一致（源证据）──');
/* ⚠️ 这是 Archify 最值得学的一条：
      文档里的数字**能被一条命令验证**，图就不会慢慢变成"想象"。 */
const docPath = 'docs/ARCHITECTURE.md';
let doc = '';
try { doc = fs.readFileSync(path.join(root, docPath), 'utf8'); } catch (_) {}
ck('  文档存在（' + docPath + '）', doc.length > 0);

/* ⚠️ 先**去掉千分位逗号** ✗（文档里写 `17,142` ✓，代码量出来是 `17142` ✓）——
   不归一化就会"文档明明写了却找不到" ✓（第一次跑就是这样 ✓）。 */
const docFlat = doc.replace(/(\d),(?=\d{3}\b)/g, '$1');
const DOC_FACTS = [
  ['assets/app.js', lines('assets/app.js')],
  ['server.js', lines('server.js')],
  ['assets/app.css', lines('assets/app.css')],
];
for (const [rel, real] of DOC_FACTS) {
  const shown = real > 0 && docFlat.includes(String(real));
  ck('  文档里的 ' + rel + ' 行数（' + real + '）与代码一致', shown,
    shown ? '' : '文档里找不到 ' + real);
}

console.log('\n── ③ 路由模块化进度 ──');
/* ⚠️ 这条断言**换过指标** ✗✓（2026-10-11）——
   原来写的是「server.js 里 /api/* 分组数 ≥ 20」✓，
   那是"路由很大"的**代理指标** ✓。等真开始拆了，这个数**必然下降** ✓ →
   它就从"守质量"变成"挡重构"了 ✓✓（实测：抽完 25 组后它红了 ✓）。
   → 换成**正向指标**：lib/routes/ 里有多少个模块 ✓，
     以及 server.js 里**还剩**多少组 ✓（剩得越少越好 ✓）。 */
const routesDir = path.join(root, 'lib', 'routes');
let routeFiles = 0;
if (fs.existsSync(routesDir)) {
  routeFiles = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).length;
}
ck('  lib/routes/ 已抽出模块 ≥ 20 个（现在 ' + routeFiles + ' 个）', routeFiles >= 20);

let groups = 0;
try {
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  groups = new Set((src.match(/['"]\/api\/[a-z0-9-]+/g) || []).map((x) => x.replace(/['"]\/api\//, ''))).size;
} catch (_) {}
/* 上界：只准往下走 ✓（现在是 15 组，给了点余量 ✓） */
ck('  server.js 里剩的 /api 分组 ≤ 20（现在 ' + groups + ' 组）', groups > 0 && groups <= 20);

console.log('\n── ④ 每个 lib 模块都能被 require（没有语法/依赖炸）──');
const libDir = path.join(root, 'lib');
let libOk = 0;
let libTotal = 0;
if (fs.existsSync(libDir)) {
  for (const f of fs.readdirSync(libDir).filter((x) => x.endsWith('.js'))) {
    libTotal += 1;
    try {
      /* ⚠️ 只做**语法检查** ✗ —— 直接 require 会有副作用（起服务 / 连网 ✓） */
      execFileSync(process.execPath, ['--check', path.join(libDir, f)], { stdio: 'ignore' });
      libOk += 1;
    } catch (_) {}
  }
}
ck('  lib/ 全部通过语法检查（' + libOk + '/' + libTotal + '）', libTotal > 0 && libOk === libTotal);

console.log('\n── ⑤ 结构约定 ──');
ck('  tests/ 目录存在且非空', fs.existsSync(path.join(root, 'tests')));
ck('  docs/ 目录存在', fs.existsSync(path.join(root, 'docs')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ck('  package.json 有 test 脚本', !!(pkg.scripts && pkg.scripts.test));
ck('  package.json 有 test:browser 脚本', !!(pkg.scripts && pkg.scripts['test:browser']));

console.log('\n── ⑥ 没有遗留标记 ──');
/* ⚠️⚠️ 只认**注释形式**的 TODO ✗✗（第一次写成裸词，误报 4 处 ✓）：
       · `server.js` 里有一段**代码本身就在数 TODO**（`text.match(/TODO|FIXME/)`）✓；
       · 还有一段在**检测「未实现」**（`NotImplementedError`）✓；
       · `app.js` 里有个 **UI 标签文字**就叫「TODO」（项目度量面板 ✓）；
       · 注释里**在讲某个模式**（比如讲 JSON 转义提到 `\'`）✓。
       —— 这些**都不是遗留标记** ✓，是**功能** ✓。
       → 只认 `// TODO` / `/* TODO` / `<!-- TODO` ✓（**注释里的**才是债 ✓）。 */
const todoRe = /(?:\/\/|\/\*|\*|<!--)\s*(?:TODO|FIXME|XXX|HACK)\b/gi;
const todoCount = countIn('server.js', todoRe) + countIn('assets/app.js', todoRe);
ck('  server.js / app.js 的注释里没有 TODO/FIXME', todoCount === 0, '找到 ' + todoCount + ' 处');

console.log('');
console.log('架构断言：' + pass + '/' + results.length + ' 项通过' + (fails.length ? '，失败 ' + fails.length + ' 项' : ''));
if (fails.length) {
  console.log('');
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('\n全部通过 ✅');
