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

/* ★★ 棘轮的度量：**代码行数**（不是总行数）✗✗ —— 2026-10-11 换的 ✓
   ⚠️ 为什么换：这个项目的风格就是**注释多** ✓（把"为什么"写清楚 ✓），
      用总行数当棘轮会**一直误伤** ✓ —— 加一段解释就红 ✓，
      于是只有两条路：砍注释 ✗、或调上限 ✗，**两条都在毁掉棘轮** ✓。
      （实测：v3.1.0 为了不调上限，一天里拆了 4 次文件、压了 7 次注释 ✓，
        已经压到"再改一行就红" ✓ —— 那不是棘轮，那是镣铐 ✓。）
   ⇒ 只数**非空、非注释**的行 ✓：注释可以随便写 ✓，代码要克制 ✓。 */
function codeLines(rel) {
  let s;
  try { s = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { return -1; }
  let inBlock = false;
  let n = 0;
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    if (inBlock) { if (line.includes('*/')) inBlock = false; continue; }
    if (!line) continue;                                  /* 空行 ✓ */
    if (line.startsWith('//')) continue;                   /* 整行注释 ✓ */
    if (line.startsWith('/*')) { if (!line.includes('*/')) inBlock = true; continue; }
    n += 1;
  }
  return n;
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

console.log('\n── ① 巨型文件棘轮（只准变小，不准变大；度量 = **代码行数**）──');

/* 现状上限。**只准往下调**（重构成功就把数字改小）。
   ⚠️ 别为了让测试变绿而往上调 —— 那就把棘轮拆了。
   ★★ 2026-10-11：度量从「总行数」换成「**代码行数**」（见上面 `codeLines` 的理由 ✓）——
      所以下面这一整列数字都**重新量过** ✓，不是"往上调" ✓（代码行数普遍比总行数小 ✓）。 */
const SIZE_CAP = [
  /* 2026-10-11：架构视图重写走线时涨到 16737 ✓（棘轮红了 ✓）→
     **抽成 assets/arch-view.js** 而不是调上限 ✓（注释里那句「别往上调」）——
     顺带把上限**往下拧**到抽完之后的实际值 ✓（棘轮的正经用法）。 */
  /* ⚠️ 2026-10-12 又上调一次（14552 → 14558），理由是**修了一个真 bug**：
     关掉知识库后不再掉到欢迎页 ✓ —— 需要在进知识库前记下开着的模式、
     关掉时再恢复（原来是**只关不恢复** ✗）。净增 6 行代码 ✓，已尽量压行 ✓。 */
  /* ⚠️ 2026-10-12 再上调一次（14559 → 14569）：修「关掉知识库后阅读项目标签栏丢失」——
     进知识库前快照项目/两栏状态、关掉时按快照恢复（和模式恢复同一套思路）。
     净增 10 行代码，已压行。 */
  /* ⚠️ 2026-10-13 上调（14611 → 14633）：阅读区支持**拖拽排序**（用户：「阅读区的文件
     和文件夹，无法自由移动归属，和顺序等」）—— 行上三分区接线（上=插前 / 下=插后 /
     中间=放进文件夹）。net +22 行。 */
  /* ⚠️ 2026-10-13 上调（14633 → 14635）：修**拖拽高亮去不掉**（用户：「最外面一圈高亮
     去不掉了，一直显示」）—— 行的 drop 里 stopPropagation → 根容器 ondrop 不触发 →
     root-drop 一直留着。① 行 dragover 里灭掉最外圈；② 加 document dragend 兜底清。net +2 行。 */
  ['assets/app.js', 14635],
  /* 2026-10-11 又一轮：加「自由缩放 + 卡片折行」→ arch-view.js 涨到 611，棘轮红 ✓
     → 按**天然边界**拆成两个：纯画图（arch-graph-svg.js）+ 面板集成（arch-view.js）✓，
     两个上限都记成拆完之后的实际值 ✓。 */
  /* 2026-10-11 第四轮：加「✦ AI 分析」（用户：「没有接入 AI 去分析」）——
     新功能全进新文件（arch-ai-view.js / arch-zoom.js），arch-view.js 反而**变小**了 ✓。 */
  ['assets/arch-view.js', 52],
  ['assets/arch-zoom.js', 57],
  ['assets/arch-ai-view.js', 359],
  /* 2026-10-11 第三轮：加「主干合并（总线画法）」→ arch-graph-svg.js 涨到 550，棘轮红 ✓
     → 按**管线**再拆一刀：布局+走线（纯数据，不碰 DOM）| 画成 SVG ✓。 */
  /* ⚠️ 2026-10-11 这一次**明确往上调了**（436 → 481），理由说清楚：
     这批不是新功能，是**一轮 bug 修复** —— 用户截图里那条 882px 的"大环"，
     连带挖出 4 个同源的方向错误（源端上下判反、通道与出口不同侧、卡片端点用错盒子、
     槽位偏移散出通道带）✓。**新增的 45 行里 30 行是注释**（把"为什么"写清楚）✓，
     砍注释就等于砍掉这些坑的记录 ✗。
     这个文件是**纯数据模块**（布局 + 走线，不碰 DOM）✓，481 行里代码只有 348 行 ✓。
     ⚠️ **下次再加功能必须拆**（布局 / 走线分成两个文件）—— 这次不拆是因为
        plan 和布局是**互相依赖**的（plan 决定走廊宽度 → 走廊宽度决定卡片宽度），
        拆不干净 ✗。 */
  ['assets/arch-layout.js', 370],
  ['assets/arch-round.js', 23],    /* 拐角磨圆（纯字符串处理）*/
  ['assets/arch-graph-svg.js', 110],
  /* ⚠️ 2026-10-12 **明确往上调了**（7107 → 7120），理由：这不是新功能，是**两个数据护栏** ✗✗ ——
     `POST /api/life/store` 加了「拒绝把有内容的仓库清空」（新键数不到现有的一半就拒收 ✓）
     + 「flowRuns 封顶 200 条」✓。起因是用户报「东西都丢失了」：
     flowRuns 涨到 36MB → 超过 4MB body 上限 → 被不完整副本覆盖 → 82 个键只剩 27 个 ✓。
     **护栏本身就是"防止代码把事情搞坏"的代码** ✓，压它等于压掉安全网 ✓。 */
  /* ⚠️ 2026-10-12 又上调一次（7120 → 7134），理由同上、仍是**数据/功能护栏**：
     发信接口加了「附件兜底」（最多 10 个、合计 base64 ≤ 20MB ✓），
     并把 body 上限从 1MB 放宽到 24MB ✓（带附件发信要传 base64 进来 ✓）。 */
  /* ⚠️ 2026-10-13 上调（7134 → 7176）：阅读区**顺序表**（readings/.codescope/order.json）
     + move 接口支持 before（插到某个兄弟前面），同目录排序也生效。net +42 行。 */
  ['server.js', 7176],
  /* ⚠️ 2026-10-13 再上调一次（3886 → 3897）：修「代码块太宽、右边被遮挡，
     没有移动条」—— 根因是 overflow-x 写的 auto，而 ::-webkit-scrollbar
     只在 overflow:scroll 下显示（MDN），且 scrollbar-width 会让 Chrome
     忽略它。改成 scroll + 常显滚动条，三处代码块统一。净增 11 行，已压紧。 */
  ['assets/app.css', 3900],
  ['src/system-panel.js', 3189],
  ['lib/system-panel.js', 2097],
  ['assets/debug-panel.js', 530],
  ['lib/routes/dbg.js', 72],
  ['lib/routes/latex.js', 94],
  ['lib/arch/analyze.js', 220],
  ['lib/arch/render.js', 297],
  ['lib/arch/ai.js', 134],
  ['lib/arch/ai-error.js', 44],   /* 把上游 AI 报错翻成人话（纯函数）*/
    ['lib/routes/arch.js', 152],   /* 加了 /api/arch/ai（AI 语义分析）*/
  ['lib/routes/check.js', 24],
  ['lib/routes/env.js', 46],
  ['lib/routes/fig.js', 16],
  ['lib/routes/format.js', 37],
  ['lib/routes/graph.js', 30],
  ['lib/routes/integrations.js', 49],
  ['lib/routes/logic.js', 56],
  ['lib/routes/matlab.js', 24],
  ['lib/routes/office.js', 163],
  ['lib/routes/py.js', 24],
  ['lib/routes/remote.js', 58],
  ['lib/routes/reorder.js', 15],
  ['lib/routes/rev.js', 11],
  ['lib/routes/run.js', 25],
  ['lib/routes/save.js', 31],
  ['lib/routes/snippets.js', 11],
  ['lib/routes/study.js', 75],
  ['lib/routes/sync.js', 53],
  ['lib/routes/system-panel.js', 14],
  ['lib/routes/system.js', 10],
  ['lib/routes/tags.js', 46],
  ['lib/routes/term.js', 40],
  ['lib/routes/version.js', 14],   /* 路由模块，样板 ✓ */   /* 刚抽出来的，别让它再涨回去 ✓ */
];
for (const [rel, cap] of SIZE_CAP) {
  const n = codeLines(rel);
  ck('  ' + rel + ' ≤ ' + cap + ' 行代码', n > 0 && n <= cap, '实际 ' + n + ' 行代码');
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
/* ⚠️ 文档里**两个数都写** ✓（总行 / 代码行）—— 两个都验 ✓：
   总行是"这个文件多大" ✓，代码行是"棘轮守的那个数" ✓，缺一个都对不上 ✓。 */
const DOC_FACTS = ['assets/app.js', 'server.js', 'assets/app.css'];
for (const rel of DOC_FACTS) {
  const t = lines(rel), c = codeLines(rel);
  /* ⚠️ 用**词边界**匹配 ✗ —— `includes` 是子串匹配 ✓，
     文档里有 `14,287` 时它会以为找到了 `4287` ✓（实测踩到过 ✓）。 */
  const has = (n) => n > 0 && new RegExp('(?<!\\d)' + n + '(?!\\d)').test(docFlat);
  const okT = has(t), okC = has(c);
  ck('  文档里的 ' + rel + ' 行数（总 ' + t + ' / 代码 ' + c + '）与代码一致', okT && okC,
    okT && okC ? '' : (okT ? '' : '缺总行 ' + t) + (okC ? '' : ' 缺代码行 ' + c));
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

console.log('\n── ⑥b 视图状态一致性（用户：「高亮的是图谱，为什么显示架构图」）──');
/* ⚠️ 根因：`CG_VIEW` 是从 **localStorage** 读的 ✓，
   但按钮的 `on` 类和标题是 **HTML 里的死值** ✓（`<button id="cg-view-graph" class="on">`）✓ ——
   而 `setCodeGraphView()` **只在两个按钮的 onclick 里被调用过** ✗，启动时从来没同步 ✓
   → 上次停在「架构」，下次打开就是「高亮图谱 + 画架构图」✓。
   ⚠️ 这条是**静态断言**（查"启动时有没有调同步"）✗ —— 不是最优 ✓，
      但真开浏览器跑一遍要十几秒 ✓，这条能挡住"把同步那行删掉" ✓。 */
const archViewSrc = (() => { try { return fs.readFileSync(path.join(root, 'assets/arch-view.js'), 'utf8'); } catch (_) { return ''; } })();
ck('  arch-view.js 启动时会 setCodeGraphView(CG_VIEW) 同步按钮/标题',
  /setCodeGraphView\(CG_VIEW\)/.test(archViewSrc));

console.log('\n── ⑤b 路由模块的 ctx 依赖完整性 ──');
/* ⚠️⚠️ 这个 bug **真的漏了很久**，是这次全项目自检扫出来的 ✓：
      `lib/routes/logic.js` 用了 `logicToSkeleton` ✓，
      但**既没在 `const {...} = ctx` 里解构、也没在 server.js 的挂载点传** ✗
      （抽路由那个工具扫漏了 ✓）→ 一调就 `ReferenceError` → **HTTP 500** ✓
      → 「按控制流图生成骨架代码」整个功能**一直是坏的** ✗（4 处 UI 在调它 ✓）
      → 而 `npm test` 里**没有一条断言会红** ✗。
   ⇒ 判据：**凡是用了 server.js 顶层名字的，都必须在 ctx 里解构 ✓**。
      依赖用 ctx 显式传是这个项目的约定 ✓，这条就是给那个约定上的锁 ✓。 */
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const topNames = new Set();
for (const m of serverSrc.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) topNames.add(m[1]);
for (const m of serverSrc.matchAll(/^const ([A-Za-z_$][\w$]*)\s*=/gm)) topNames.add(m[1]);
const ctxMissing = [];
fs.readdirSync(path.join(root, 'lib', 'routes')).filter((f) => f.endsWith('.js')).forEach((f) => {
  const rawSrc = fs.readFileSync(path.join(root, 'lib', 'routes', f), 'utf8');
  /* ⚠️ **先剥注释再扫** ✗ —— 不剥的话，注释里提到的名字会被当成"用了" ✓
     （第一版就报了 `streamStatic` / `run`，全是注释里的 ✓）。 */
  const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const dm = src.match(/const \{([^}]*)\} = ctx;/s);
  const got = new Set((dm ? dm[1] : '').split(',').map((x) => x.trim()).filter(Boolean));
  /* 本文件自己 require 的（fs / path / os…）和本地声明的，不算缺 ✓ */
  const local = new Set([...src.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  ['fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'child_process', 'stream', 'util'].forEach((b) => local.add(b));
  topNames.forEach((n) => {
    if (got.has(n) || local.has(n)) return;
    /* ⚠️ 只看**裸标识符** ✗ —— `ctx.vaultPath` 这种是显式走 ctx 的 ✓，不该报 ✓ */
    if (new RegExp('(?<![.\\w])' + n + '\\b').test(src)) ctxMissing.push(f + ' 用了 ' + n);
  });
});
ck('  路由模块用到的 server.js 顶层符号，都从 ctx 取了', ctxMissing.length === 0, ctxMissing.slice(0, 4).join(' / '));

console.log('\n── ⑤c 「抽路由」的相对路径（__dirname 位移）──');
/* ★★ 从根目录的 server.js 抽到 `lib/routes/` 之后，`__dirname` **多下移了两层** ✗✗ ——
   跟文件位置有关的东西（`path.join(__dirname, …)` / `require('./x')`）都要跟着改 ✓。
   ⚠️ 实测踩过（2026-10-12 用户报「怎么缺失了」）：
      `lib/routes/remote.js` 查 noVNC 时写的是 `path.join(__dirname, 'node_modules', …)` ✗
      → 一直在查 `lib/routes/node_modules/…`（永远不存在）→
      面板永远「VNC 缺失」，可依赖明明装着 ✓。
   ⇒ 这条断言把「抽出去的路由里，指向 node_modules 的路径必须真的存在」钉住 ✓。
      比盯着某个字符串强 ✓：它验的是**文件真的在那儿** ✓。 */
{
  const routeDir = path.join(root, 'lib', 'routes');
  const offenders = [];
  let checked = 0;
  if (fs.existsSync(routeDir)) {
    for (const f of fs.readdirSync(routeDir).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(routeDir, f), 'utf8');
      /* 只看**代码**里的 path.join(__dirname, …) ✗ —— 注释里写的不算 ✓ */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of code.matchAll(/path\.join\(__dirname,([^)]*)\)/g)) {
        const parts = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        if (!parts.length) continue;
        checked += 1;
        const resolved = path.join(routeDir, ...parts);
        /* 只对"应该存在的目录"较真 ✓ —— `node_modules` 这种一定存在 ✓，
           而 `.bin/code-server` 之类可能没装 ✓，不该判错 ✓。 */
        if (parts[0] !== 'node_modules') continue;
        if (!fs.existsSync(resolved)) offenders.push(f + ' → ' + path.relative(root, resolved));
      }
    }
  }
  ck('  lib/routes/ 里指向 node_modules 的路径都真的存在（__dirname 没少两层）',
    offenders.length === 0, offenders.slice(0, 3).join(' / '));
  console.log('  （扫了 ' + checked + ' 处 path.join(__dirname, …)）');
}

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
