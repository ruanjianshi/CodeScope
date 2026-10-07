'use strict';
/**
 * 内联脚本语法闸门
 * ---------------------------------------------------------------------------
 * 背景：index.html 是**单文件**，所有 JS 都内联在里面。一个语法错误会让
 * **整个前端脚本都不加载**（页面只剩半截 UI，报错还常常指向别处，
 * 比如 `xxx is not defined`），排查很费时间。
 *
 * 而 `tests/smoke.js` 是**静态 grep 断言**，它**不会解析 JS** ——
 * 实测踩过一次：我改代码时整行 `body: JSON.stringify(...)` 被误删，
 * smoke 依然 590 全过，但打开应用是坏的。
 *
 * 所以单独加这道闸门：把每个内联 <script> 抽出来丢给 vm.Script 编译，
 * 语法错误直接报**文件里的真实行号**并打印上下文。
 *
 * 运行：node tests/syntax.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');

const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const lines = html.split('\n');
let m, index = 0, checked = 0, failed = 0;

while ((m = re.exec(html)) !== null) {
  index += 1;
  const code = m[1];
  if (!code.trim()) continue;
  checked += 1;
  const startLine = html.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(code, { filename: 'inline-' + index + '.js' });
  } catch (error) {
    failed += 1;
    const inScript = (String(error.stack || '').match(/inline-\d+\.js:(\d+)/) || [])[1];
    const realLine = inScript ? startLine + Number(inScript) - 1 : startLine;
    console.error('✗ 内联脚本 #' + index + ' 语法错误 → index.html 第 ' + realLine + ' 行');
    console.error('  ' + error.message);
    for (let k = Math.max(0, realLine - 3); k < Math.min(lines.length, realLine + 2); k++) {
      console.error('    ' + (k + 1) + ': ' + lines[k].slice(0, 150));
    }
  }
}

if (failed) {
  console.error('内联脚本语法闸门：' + failed + '/' + checked + ' 个脚本有语法错误 —— 整个前端都不会加载，先修这个');
  process.exit(1);
}
console.log('内联脚本语法闸门：' + checked + ' 个脚本全部通过');

/* ---------------------------------------------------------------------------
 * 外链脚本同样要过闸门
 * ---------------------------------------------------------------------------
 * `index.html` 里 <script src="/assets/life-workbench.js" defer> 是**外链**，
 * 上面的正则 `(?![^>]*\bsrc=)` 会把它跳过 —— 也就是说这个文件以前**完全没被校验**。
 *
 * 而它和 index.html 一样致命：一个语法错误 → 整个面板脚本不执行 →
 * 点「个人管理面板」**一片空白**（页面其余部分正常，所以特别像"面板坏了"而不是"语法错了"）。
 *
 * 而且这个文件里有大量 CSS 模板字符串（`const CSS = \`...\``），
 * **注释里混进一个反引号就会截断模板串** —— 实测踩过 4 次。
 * 那种错误 `node --check` 一眼就能抓，但没人会记得手动跑。
 */
const externals = Array.from(new Set([
  /* ★ 面板主文件放**第一个** ✓ —— 它最常出问题（那段 CSS 模板 ✗），先看到它 ✓。 */
  'assets/life-workbench.js',
  /* ★ server.js 也要过一遍 ✓ —— 它是**唯一一个坏掉就全站不可用**的文件 ✗
     （改了它不 `node --check` 的话，只有重启那一刻才发现 ✗，
      而重启脚本本来就是为了「让改动生效」跑的 ✗，出错的时机很尴尬 ✗）。 */
  'server.js',
  /* ★★ lib 清单**不写死** ✗✗ —— 原来是一串写死的文件名 ✓，
     于是加了 lib/en-sources.js 之后它**根本没被校验** ✗（加完文件才发现 ✗）。
     这就是「同一件事写了两处」的老毛病 ✓：写死的清单**必然过期** ✗。
     → 直接扫 lib/*.js ✓，以后新增文件**自动**被覆盖 ✓，不用记着改这里 ✓。
     ⚠️ 不读 server.js 的 SHARED_LIB_FILES ✗ —— 那是「浏览器能拿哪几个」的白名单 ✓，
        和「哪些文件该过语法」不是一回事 ✓（不过白名单的也该全过 ✓，全扫更保险 ✓）。 */
  ...fs.readdirSync(path.join(__dirname, '..', 'lib'))
    .filter((f) => /\.js$/.test(f))
    .sort()
    .map((f) => 'lib/' + f),
  /* ★★ `assets/` 也要**自动扫** ✗✗ —— 原来是**写死一个** `assets/life-workbench.js` ✓，
     于是 `assets/system-panel.js` / `assets/study-workspace.js` / 后来新增的
     `assets/code-guide.js` **全都没被校验过** ✗（加完才发现 ✓）。
     这就是文件上面自己警告过的那个毛病 ✓：「写死的清单必然过期」✓。
     ⚠️ 只跳过**第三方压缩包** ✓（几万行 ✓，扫它没意义还慢 ✓）——
        自己写的**一个都不许跳** ✗（否则又变回写死清单 ✓）。 */
  ...fs.readdirSync(path.join(__dirname, '..', 'assets'))
    .filter((f) => /\.js$/.test(f))
    .filter((f) => ['highlight.min.js', 'xterm.js'].indexOf(f) < 0)
    .sort()
    .map((f) => 'assets/' + f),
]));
/* ⚠️ `Set` 是为了**去重** ✗ —— `assets/life-workbench.js` 既在开头写死了一份（要它排第一 ✓），
   又被 `assets/*.js` 扫到一次 ✓，不去重的话它会**校验两遍** ✓（白跑 + 输出里出现两行 ✓）。 */
let extFailed = 0;

for (const rel of externals) {
  const abs = path.join(__dirname, '..', rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  try {
    new vm.Script(src, { filename: rel });
    console.log('外链脚本语法：✓ ' + rel + '（' + src.split('\n').length + ' 行）');
  } catch (error) {
    extFailed += 1;
    const at = (String(error.stack || '').match(new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)')) || [])[1];
    const srcLines = src.split('\n');
    console.error('✗ 外链脚本语法错误 → ' + rel + (at ? ' 第 ' + at + ' 行' : ''));
    console.error('  ' + error.message);
    if (at) {
      const n = Number(at);
      for (let k = Math.max(0, n - 3); k < Math.min(srcLines.length, n + 2); k++) {
        console.error('    ' + (k + 1) + ': ' + srcLines[k].slice(0, 150));
      }
    }
  }
}

/* ★★★ 专项检查：CSS 模板里**混进反引号** ✗✗ ——
   这段 CSS 整个装在一个 JS 模板字符串里（`const CSS = \`…\``）✓，
   所以注释里写一个反引号（比如「用 `.q` 占满」✗）就会**把字符串提前截断** ✗ ——
   ⚠️ 而且**语法闸门查不出来** ✗✗：剩下的部分恰好是合法 JS ✗
      （`"…css…" .q is not a function` ✓），vm.Script 照样通过 ✓，
      结果就是**整个面板白屏** ✗（实测踩过 4 次 ✗）。
   → 这里专门守一条：CSS 模板的**第一个收尾反引号后面必须紧跟分号** ✓。
      提前截断的话，后面跟的是 `.` 或别的字符 ✗，立刻报错 ✓。
   ⚠️ 而且要把**所有**中招的行一次列全 ✗ —— 原来只报第一个 ✓，
      于是一段注释里有 8 个反引号就要来回改 8 次 ✗（实测：改一次、跑一次、再改 ✗，
      白跑了三轮 ✗）。一次列全，一轮改完 ✓。 */
const cssGuardFailed = [];
for (const rel of externals) {
  const abs = path.join(__dirname, '..', rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const m = /const CSS = `/.exec(src);
  if (!m) continue;                                   /* 没这段就跳过 ✓ */
  const from = m.index + m[0].length;
  const close = src.indexOf('`', from);
  if (close < 0) continue;                            /* 没收尾 → 上面的语法闸门已经会报 ✓ */
  const after = src.slice(close + 1).replace(/^\s*/, '').charAt(0);
  if (after !== ';') {
    /* ★ 把 CSS 模板「真正的那一行结尾」（单独一行只有反引号+分号 ✓）当终点 ✓，
       然后把这区间里**每一行**的反引号都列出来 ✓ —— 一次看全 ✓。 */
    const lines = src.split('\n');
    const startLine = src.slice(0, m.index).split('\n').length;      /* 1-based */
    let endLine = lines.length;
    for (let i = startLine; i < lines.length; i++) {
      if (/^\s*`\s*;/.test(lines[i])) { endLine = i + 1; break; }
    }
    const offenders = [];
    for (let i = startLine; i < endLine; i++) {                       /* 1-based → 0-based */
      if (lines[i - 1] && lines[i - 1].includes('`')) offenders.push({ n: i, t: lines[i - 1].trim().slice(0, 110) });
    }
    const line = src.slice(0, close).split('\n').length;
    const text = src.slice(0, close).split('\n').pop();
    cssGuardFailed.push({ rel, line, text: String(text).trim().slice(0, 110), offenders });
  }
}
if (cssGuardFailed.length) {
  for (const x of cssGuardFailed) {
    console.error('✗ CSS 模板被**提前截断** → ' + x.rel + ' 第 ' + x.line + ' 行');
    console.error('   ' + x.text);
    if (x.offenders.length > 1) {
      console.error('   这一段 CSS 里**一共 ' + x.offenders.length + ' 行**混进了反引号，一次改完：');
      for (const o of x.offenders) console.error('     ' + o.n + ': ' + o.t);
    }
  }
  console.error('CSS 模板闸门：注释里**不能出现反引号** ✗ —— 这段 CSS 装在 JS 模板字符串里，');
  console.error('  一个反引号就会把字符串截断，而语法闸门**查不出来**（剩下的恰好是合法 JS），');
  console.error('  结果是整个面板白屏。写 CSS 注释时用「」或 .lw-xx 这种写法，别加反引号。');
  process.exit(1);
}
console.log('CSS 模板闸门：✓ 没有混进反引号');

/* ── ★★ UI 文案闸门：**别在界面文案里写 markdown 粗体** ✗✗ ──────────────────
   ★ 为什么要有这条 ✗：`assets/life-workbench.js` 里的界面文案是**直接塞进 HTML** 的 ✓，
     **不经过任何 markdown 渲染** ✗ —— 写 `**重要**` 的话，用户看到的就是
     **两个星号** ✓（「左边那份日报里的**序号可以点**」✓ 实测就是这样漏出去的 ✓）。
   ⚠️ 但**提示词**里写 `**强调**` 是**对的** ✓（那是给模型看的 ✓，模型吃这一套 ✓）——
      所以不能「见到 `**` 就报」✗，得只盯**用户看得见的地方** ✓。
   判据：这一行里有 `**` ✓，而且它**同时**是在拼 HTML / 弹提示 ✓
     （含标签 ✓、或调 `rdToast` / `setStatus` ✓、或写 `title=` / `placeholder=` ✓）。
   ⚠️ 这网不是密的 ✗（跨行拼接的漏得掉 ✓），但**能挡住九成** ✓，
      而且报错信息里直接告诉你怎么改 ✓。 */
{
  const uiBad = [];
  for (const rel of externals) {
    const abs = path.join(__dirname, '..', rel);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((L, i) => {
      /* ⚠️ 必须是**字符串字面量里**的 `**` ✗ —— 注释里写 `**强调**` 完全没问题 ✓
         （注释是给维护者看的 ✓，不进界面 ✓）。第一版没加这条 ✓，
         结果把一大堆注释全报出来了 ✗（16 条误报里 15 条是注释 ✓）。 */
      const strs = L.match(/'(?:[^'\\]|\\.)*'/g) || [];
      if (!strs.some((s) => /\*\*[^*]+\*\*/.test(s))) return;
      const looksUi = /<\w+[\s/>]/.test(L) || /rdToast\(|setStatus\(|title="|placeholder="/.test(L);
      if (looksUi) uiBad.push({ rel, n: i + 1, t: L.trim().slice(0, 120) });
    });
  }
  if (uiBad.length) {
    console.error('✗ 界面文案里混进了 markdown 粗体（`**…**`）→ ' + uiBad.length + ' 行：');
    for (const x of uiBad) console.error('   ' + x.rel + ':' + x.n + '  ' + x.t);
    console.error('UI 文案闸门：这个文件**不渲染 markdown** ✗ —— 星号会**原样显示**给用户 ✓。');
    console.error('  想强调就直接写 ✓，或者用「」括起来 ✓；别写 `**粗体**` ✗。');
    console.error('  ⚠️ 注意：**提示词**（发给模型的那几段）里写 `**` 是**对的** ✓，不用改 ✓。');
    process.exit(1);
  }
  console.log('UI 文案闸门：✓ 界面文案里没有 markdown 粗体');
}

if (extFailed) {
  console.error('外链脚本语法闸门：' + extFailed + ' 个文件有语法错误 —— 面板会整块白屏，先修这个');
  process.exit(1);
}
