'use strict';
/**
 * 内联脚本语法闸门
 * ---------------------------------------------------------------------------
 * 背景：index.html 里的 JS 一个语法错误会让**整个前端脚本都不加载**
 * （页面只剩半截 UI，报错还常常指向别处，比如 `xxx is not defined`），排查很费时间。
 *
 * 而 `tests/smoke.js` 是**静态 grep 断言**，它**不会解析 JS** ——
 * 实测踩过一次：我改代码时整行 `body: JSON.stringify(...)` 被误删，
 * smoke 依然 590 全过，但打开应用是坏的。
 *
 * 所以单独加这道闸门：把每个内联 <script> 抽出来丢给 vm.Script 编译，
 * 语法错误直接报**文件里的真实行号**并打印上下文。
 *
 * ⚠️⚠️ 2026-10-08 起 index.html **不再是单文件** ✗✗ ——
 *    内联的 1049 KB 主脚本 / 111 KB PDF 脚本 / 406 KB 样式都抽成了外链
 *    （`assets/app.js` / `assets/app-pdf.js` / `assets/app.css` ✓），
 *    为的是让它们能被浏览器**缓存住**（重复打开省 552 KB ✓）。
 *    现在 index.html 里**只剩一小段「首屏配色」** ✓（那段必须内联 ✗ ——
 *    它要在首屏绘制前跑 ✓，外链会闪一下主题 ✗）。
 *    → 所以下面**两段都要留着** ✓：
 *      ① 内联闸门（守那段配色脚本 ✓）；
 *      ② 外链闸门（守抽出去的 app.js / app-pdf.js ✓，靠 `assets/*.js` **自动扫** ✓，
 *         所以以后再加文件**不用改这里** ✓）。
 *    ⚠️ 只留 ① 的话，1160 KB 的主脚本就**没人校验**了 ✗ ——
 *       那正是「闸门看着还在跑、其实什么都没查」✗。
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

/* ── ★★★ 死代码闸门：`return a + b;` 后面还跟着 `+ c` ✗✗ ─────────────────────
   ★ 为什么要有这条 ✗：2026-10-16 实测踩过一次 ✓ ——
     `assets/life-workbench.js` 的 `epWordDetailHtml()` 里，长串 `+` 拼接中间
     多写了一个分号 ✓：
     ```js
         + colsClose;   /* 关右栏 ✓ *／        // ← 这个分号 ✗✗
           + (w.artTitle ? sec('📍', '来自', …) : '')
           + '<div class="lw-wd-foot">' + … + '</div>'
     ```
     `return a + b; + c` 里的 `+ c` 会被当成**新语句丢掉** ✗ ——
     ⚠️⚠️ **而且它不是语法错** ✗✗（`+expr` 是合法的一元表达式 ✓）：
       `vm.Script` / `node --check` **照样通过** ✗、也不告警 ✗ →
       上面那道语法闸门**完全查不出来** ✗。
     ⇒ 后果：「📍 来源」和**整个底部动作条**成了死代码 ✗ →
       词卡上**看不到「🪄 AI 补全 / 🖼 换一张 / 🗑 删除」** ✗，
       而卡片里还写着「点下面的『🪄 AI 补全』自动填」✗ ——
       让用户去找一个**根本没渲染出来**的按钮 ✓（用户就是这么报上来的 ✓）。
   ★ 判据：某行以分号结尾 ✓，而**往后第一个「非空、非注释」的行以加号 / 点 / 逗号开头** ✗ ——
     那说明拼接链在分号处断了 ✓，后面整段是死代码 ✓。
   ⚠️⚠️ 必须**跳过注释行和空行**再判 ✗✗ —— 第一版只看紧邻下一行 ✓，
      而实际上分号后面先跟着一段块注释（好几行 ✓），加号在更后面 ✓ →
      **漏报** ✗（负向测试一试就露馅 ✓：把分号加回去，闸门居然还说「没有」✗）。
   ⚠️ 排除 for 循环头里的分号 ✗（那里的分号是语法 ✓）。
   ⚠️ 只扫加号 / 点 / 逗号三种续行符 ✓ —— 它们出现在语句开头**几乎必然是**断链 ✓
      （真把一元加号当独立语句写出来是无意义的 ✓）。
   ⚠️⚠️ **写这段注释时别嵌块注释符号、也别嵌反引号** ✗✗ ——
      2026-10-16 就在这里踩了两次 ✓：注释里写一个块注释开始符号，会**把外层注释提前闭合** ✗ →
      后面那些中文就变成代码 ✓ → SyntaxError ✓。一律用普通文字 ✓。 */
{
  const deadHits = [];
  for (const rel of externals) {
    const abs = path.join(__dirname, '..', rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8').split('\n');
    /* 先标出每一行是不是「纯注释行」✓ */
    const isComment = new Array(src.length).fill(false);
    let inBlock = false;
    for (let i = 0; i < src.length; i++) {
      const raw = src[i];
      if (inBlock) {                                   /* 上一行开了一段块注释 → 本行整行是注释 ✓ */
        isComment[i] = true;
        if (raw.includes('*/')) inBlock = false;
        continue;
      }
      /* ⚠️⚠️ **块注释经常从行中间开始** ✗✗ —— 比如
         `+ colsClose;   /* 关右栏 …` ✓：行首是代码 ✓、注释在中间开 ✓。
         第一版判 `trim().startsWith('/*')` ✗ → **判不到** ✗ → 后面几行注释没被标记 ✗
         → 找「下一个非注释行」时会落到注释行上 ✗ → 第三次漏报 ✓（一路试出来的 ✓）。
         → 正确做法：先把**成对的**块注释去掉 ✓，再看**还剩没有未闭合的** ✓。 */
      const t = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
      const open = t.indexOf('/*');
      if (open >= 0) {
        if (!t.slice(0, open).trim()) isComment[i] = true;   /* 注释前没代码 → 整行注释 ✓ */
        inBlock = true;
        continue;
      }
      const trimmed = t.trim();
      if (trimmed === '' || trimmed.startsWith('//')) isComment[i] = true;
    }
    /* ⚠️⚠️ 判「这行以分号结尾」之前，**必须先把行内注释剥掉** ✗✗ ——
       实测那个 bug 的原始写法是 `+ colsClose;   /* 关右栏 … ✓）` ✓：
       **分号在行中间** ✓，行尾是注释 ✓ → 直接 `endsWith(';')` 判不出来 ✗（第二次漏报 ✓）。 */
    const codePart = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\*[\s\S]*$/, ' ').replace(/\s+$/, '');
    for (let i = 0; i < src.length - 1; i++) {
      const cur = codePart(src[i]);
      if (!cur.endsWith(';')) continue;
      if (/\bfor\s*\(/.test(cur)) continue;                 /* for(;;) 的分号是语法 ✓ */
      /* ★ 往后找第一个非空、非注释行 ✓ */
      let j = i + 1;
      while (j < src.length && isComment[j]) j++;
      if (j >= src.length) continue;
      const nx = src[j].replace(/^\s+/, '');
      if (!/^[+.,]/.test(nx)) continue;
      deadHits.push({ rel, n: i + 1, cur: cur.trim().slice(-90), nx: nx.slice(0, 70), gap: j - i - 1 });
    }
  }
  if (deadHits.length) {
    console.error('✗ 拼接链被**分号截断**（后面整段是死代码）→ ' + deadHits.length + ' 处：');
    for (const x of deadHits) {
      console.error('   ' + x.rel + ':' + x.n + (x.gap ? '（后面隔着 ' + x.gap + ' 行注释 ✓ 也算 ✗）' : ''));
      console.error('     ' + x.cur);
      console.error('   + ' + x.nx);
    }
    console.error('死代码闸门：`return a + b;` 之后的 `+ c` 会被当成**新语句丢掉** ✗ ——');
    console.error('  而且**不是语法错** ✗，语法闸门查不出来，只能在这里拦 ✓。');
    console.error('  长串 `+` 拼接的 return / 赋值里，**只在最后写一个分号** ✓。');
    process.exit(1);
  }
  console.log('死代码闸门：✓ 没有「分号截断拼接链」');
}

if (extFailed) {
  console.error('外链脚本语法闸门：' + extFailed + ' 个文件有语法错误 —— 面板会整块白屏，先修这个');
  process.exit(1);
}
