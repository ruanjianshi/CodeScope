/*!
 * life-styles.js —— 「生活工作台」面板的**样式数据层**（life-workbench.js 拆分 · 阶段 1，2026-10-30）
 * ---------------------------------------------------------------------------
 * 为什么单独一个文件：assets/life-workbench.js 单文件 17,096 行 / 1.1MB，
 *   「改一行 CSS 也要动那颗巨型文件」✗ —— 而样式是**纯数据**（零逻辑 / 零 DOM）✓，
 *   按天然边界先切出来 ✓（方案见 plans/life-split-spec.md 阶段 1）。
 *
 * 这个文件里**只有纯数据** ✓：没有 DOM 操作、没有事件、没有副作用（除最后挂一行 window 导出）。
 *   · T / UI / MONO —— 语义令牌 → --pp-* 的映射与两套字体栈（CSS 模板要插值它们 ✓）
 *   · CSS           —— 面板自身样式（模板字符串，2,277 行）
 *   · MEMO_DOC_CSS  —— 备忘录 / 日记正文的 Crepe 块级内核 + Phycat 移植规则（979 行）
 *
 * 导出（面板侧唯一入口）：
 *   window.CodeScopeLifeStyles = { css, memoDocCss, tokens, ui, mono }
 *
 * ⚠️ 加载顺序（index.html）：本文件必须排在 assets/life-workbench.js **之前** ✓ ——
 *    面板要读 CodeScopeLifeStyles.tokens / .css ✓（都是 defer，按文档顺序执行 ✓）。
 * ⚠️ 令牌表**只此一份** ✓ —— 面板里 const T = CodeScopeLifeStyles.tokens 取用 ✓。
 *    两个文件各存一份必然会不同步 ✗（这个仓库反复踩的就是「同一件事写两处」✗）。
 * ⚠️ 搬家是**逐字节**的 ✓：CSS + MEMO_DOC_CSS 求值后拼接、去掉所有空白字符，
 *    sha256 = 1e21c82f8721696ead1d3d260b9447e6918236b655f9125b6c34c519a4a1d2f2
 *    与拆分前完全相同 ✓（拆分前的值见本文件 git 历史 ✓）。
 */
(function () {
  'use strict';

  /* ── 设计令牌：**纸感 · 有厚度**（v4，2026-10-29 · 规范第 7 节定稿）────────────
     调色板**不在 JS 里写死** ✗ —— 全部走面板根容器上的 --pp-* 变量 ✓：
       · 浅色 App 主题（html[data-theme=light]）→ 暖白纸
       · 深色 App 主题（ocean / graphite / midnight / forest）→ 哑光墨纸
     ⇒ 面板跟随 App 主题（方案 B ✓），且只在作用域内覆盖 ✓：
       不碰 assets/app.css ✓、不外溢到其它视图 ✓。
     ⚠️ 浮层（新邮件 / 保存失败 / 右键菜单 / 词群放大 / 邮箱文件夹选择）
        挂在 document.body 上 ✗，不是面板的后代 ✗ —— 它们的作用域写在 CSS 顶部
        的调色板那一段里 ✓（只写 .lw-inpanel 的话浮层会掉回 App 深色令牌 ✗）。
     ⚠️ 这里只放**语义到纸感令牌的映射** ✓；两套主题的具体色值在 CSS 顶部的
        调色板块里（深浅各一套，只换值不换规则 ✓）。 */
  const T = {
    bg: 'var(--pp-page)', bg2: 'var(--pp-sheet)', card: 'var(--pp-sheet)', card2: 'var(--pp-sheet2)',
    line: 'var(--pp-line)', lineDim: 'var(--pp-line)', line2: 'var(--pp-line)',
    text: 'var(--pp-ink)', dim: 'var(--pp-ink2)', faint: 'var(--pp-ink2)',
    accent: 'var(--pp-accent)', accentInk: 'var(--pp-on-accent)',
    ok: 'var(--pp-ok)', warn: 'var(--pp-warn)', red: 'var(--pp-err)',
    grad: 'none',
  };

  /* ★ 正文字体 = 主界面 body 的字体栈 ✓（原来是全站等宽 ✗ —— 中文正文发飘 ✗）
     ★ MONO 只给数字 / 时间 / 键位 / 编号 ✓（见 CSS 末尾「等宽只给数字」那一段 ✓）。*/
  const UI = '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  const MONO = '"SF Mono",SFMono-Regular,Menlo,Consolas,"JetBrains Mono",monospace';

  const CSS = `
  /* ═══ 纸感调色板 · 第 7 节定稿（方案 B：面板跟随 App 主题）═══════════════════
     主题名与取值都来自 assets/app.css:3253-3283 的**真实** html[data-theme=...]：
       ocean / graphite / midnight / forest / light
     ⚠️ 其中 graphite 的 --bg 是 #101113 —— 它是**深色**主题 ✓
        （规范 §7.1 的示例把它和 light 并列 ✗，这里按真实取值归进深色组 ✓）。
     ⚠️ 几个浮层挂在 document.body 上 ✗，不是 .lw-inpanel 的后代 ✗：
        #lw-toast（新邮件）/ #lw-savetoast（保存失败）/ #lw-ctx（右键菜单）/
        #lw-map-zoom（词群放大）/ #lw-ml-pick（邮箱文件夹选择）✓
        ⇒ 作用域必须把它们一起列上 ✓，否则浮层拿不到 --pp-* ✗，
          会掉回 App 的深色令牌 ✗（调色板只写 .lw-inpanel 就只覆盖面板本体 ✗）。
     ⚠️ 一套样式 + 两套值 ✓（规范 §7.1 允许的「变量间接」✓）：
        A 块 = 深色默认值 + App 语义令牌映射；B 块 = 浅色主题只换值 ✓。
        因为 A 块的选择器在**任何**主题下都命中同一个元素 ✓，
        --pp-* 的延迟求值保证 B 块换值后映射自动跟上 ✓，不用复制整套样式 ✓。 */
  .lw-inpanel, #lw-toast, #lw-savetoast, #lw-ctx, #lw-map-zoom, #lw-ml-pick { /* 深色：哑光墨纸 */ --pp-page:#14120f;   --pp-sheet:#1c1a16;   --pp-sheet2:#232019; --pp-ink:#ece7db;    --pp-ink2:#a49d8e;    --pp-line:rgba(236,231,219,.12); --pp-accent:#d8c9a3; --pp-on-accent:#17140f; --pp-ok:#8fbf8a;     --pp-warn:#d3a24a;    --pp-err:#e0796a; --pp-glow:rgba(255,255,255,.05);   /* 内高光：深色纸很轻，不然发灰 */ --pp-shadow:0 1px 1px rgba(0,0,0,.45), 0 4px 10px rgba(0,0,0,.42), 0 12px 28px rgba(0,0,0,.38); --pp-shadow-lift:0 2px 2px rgba(0,0,0,.45), 0 8px 18px rgba(0,0,0,.55), 0 22px 44px rgba(0,0,0,.50); --pp-shadow-float:0 4px 8px rgba(0,0,0,.45), 0 16px 36px rgba(0,0,0,.55), 0 40px 80px rgba(0,0,0,.50); --pp-inset:inset 0 2px 4px rgba(0,0,0,.55); --pp-scrim:rgba(8,7,5,.62); --pp-hover:rgba(236,231,219,.07); /* App 的语义令牌一起改 ✓ —— 面板里的 <button>/<input> 吃的是 html[data-theme] 那层全局皮肤（app.css:3293-3309 渐变+内高光+抬起/按下）✓， 把这几个值换成纸色，它们就自动变成纸感控件 ✓，不用逐条重写 ✓。 */ --bg:var(--pp-page); --panel:var(--pp-sheet); --panel2:var(--pp-sheet2); --border:var(--pp-line); --text:var(--pp-ink); --dim:var(--pp-ink2); --accent:var(--pp-accent); --ok:var(--pp-ok); --err:var(--pp-err); --control:var(--pp-sheet2); --control-hover:color-mix(in srgb, var(--pp-sheet2) 88%, var(--pp-ink) 12%); --surface-hover:color-mix(in srgb, var(--pp-sheet2) 92%, var(--pp-ink) 8%); --accent-soft:color-mix(in srgb, var(--pp-accent) 14%, transparent); --theme-header:var(--pp-sheet); --theme-side:var(--pp-page); --theme-sub:var(--pp-page); --theme-deep:var(--pp-page); --theme-elevated:var(--pp-sheet); --theme-code:var(--pp-sheet2); --theme-overlay:var(--pp-scrim); --pp-pill-bg:8%; }
  /* 浅色 App 主题（light）→ 暖白纸；只换值 ✓ */
  html[data-theme="light"] .lw-inpanel, html[data-theme="light"] #lw-toast, html[data-theme="light"] #lw-savetoast, html[data-theme="light"] #lw-ctx, html[data-theme="light"] #lw-map-zoom, html[data-theme="light"] #lw-ml-pick { --pp-page:#f4f1e8;   --pp-sheet:#fdfbf6;   --pp-sheet2:#f7f3e9; --pp-ink:#221f1b;    --pp-ink2:#6c6659;    --pp-line:rgba(34,31,27,.12); --pp-accent:#2f5d46; --pp-on-accent:#fdfbf6; --pp-ok:#3f7a4f;     --pp-warn:#9a6b1f;    --pp-err:#a23b2a; --pp-glow:rgba(255,255,255,.72); --pp-shadow:0 1px 1px rgba(28,24,16,.10), 0 4px 10px rgba(28,24,16,.09), 0 12px 28px rgba(28,24,16,.08); --pp-shadow-lift:0 2px 2px rgba(28,24,16,.13), 0 8px 18px rgba(28,24,16,.14), 0 22px 44px rgba(28,24,16,.12); --pp-shadow-float:0 4px 8px rgba(28,24,16,.16), 0 16px 36px rgba(28,24,16,.18), 0 40px 80px rgba(28,24,16,.16); --pp-inset:inset 0 2px 4px rgba(28,24,16,.20); --pp-scrim:rgba(34,31,27,.34); --pp-hover:rgba(34,31,27,.06); --pp-pill-bg:5%; }
  /* ── 编辑器纸面令牌（2026-10-31）══════════════════════════════════════════
     ── 用户报的现象 ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯
     「背景色彩有些突兀」：面板是暖墨纸（--pp-page / --pp-sheet），
     而备忘录 / 日记的正文区铺的是 Phycat 的 --doc-bg（四套全是偏冷的灰蓝：
     #272E33 / #0F111A / #1B1D1B / #282A36）⇒ 两色温相撞，正文区像贴上去的一块玻璃 ✗。

     ── 为什么令牌挂在 .lw-inpanel 上（而不是编辑器容器上）✗
     正文区 / 工具栏 / 代码块 / 提示框 / 行内代码 / 源码 textarea 分属**不同层级** ✓：
     工具栏 .lw-nt-bar 在编辑器容器**外面** ✓；源码模式的 .lw-memo-src 又**不是**
     .markdown-preview-view ✓ —— 挂在容器上的话这两种都取不到变量 ✗。
     而它们**一定**在 .lw-inpanel 里面（life-workbench.js 只在这一处产出
     .lw-memo-ce / .lw-j-ce，见 memoEditorHostHtml / viewJournal ✓）→ 挂在面板根上 ✓。

     ── 为什么这四个值不用给浅色再写一遍 ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯
     全部用 color-mix 从 --pp-* 现算 ✓，而 --pp-page 在**深色和浅色里都是更暗的那一档**
     （#14120f / #f4f1e8）、--pp-sheet 都是更亮的那一档（#1c1a16 / #fdfbf6）✓ ⇒
     混色的**方向在两套主题下自动一致** ✓，不用写第二份 ✓。
     同理：这四个值**一个 --doc-* 都不引用** ✓ ⇒ 切四套 Phycat 配色时底色必不动 ✓
     （只变字色 / 强调色 / 语法高亮 ✓）。

     ── 四个档位 ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯
       · --ed-paper  正文区：--pp-sheet 混 3% 暖白(#f0e6d2) → 比面板底高半档 ✓
         深色 rgb(34,32,28) L=12.2 / 浅色 rgb(253,250,245) L=97.6；
         与面板底(--pp-page) 的亮度差 5.3% / 4.3%（判据 2%~6% ✓），色相差 4° / 7.5°（判据 ≤12° ✓）。
         ⚠️ 暖白是**写死的锚点** ✗ 不能改成混 --pp-ink：ink 在深色里是浅的（往上提 ✓），
            在浅色里却是深的（会往下压 ✗）—— 那样两套主题的层次方向就反了 ✗。
       · --ed-chrome 工具栏条 / 引用块卡：sheet 与 page 之间 → 比纸面低半档 ✓
       · --ed-sunk   代码块 / 行内代码 / 提示框底：再低半档 ✓
       · --ed-hover  块悬停底：纸面混 4% ink（深色变亮 / 浅色变暗，两套都是「抬起来」✓）
     ⚠️ 这四个只改**颜色** ✓，不碰排版 / 间距 / 字号 ✓（刚定稿）。
     ═══════════════════════════════════════════════════════════════════════ */
  /* 独立面板：铺满顶栏以下的整个主区域 */
  .lw-inpanel { position:fixed; left:0; right:0; bottom:0; top:44px; z-index:8800; display:flex; flex-direction:column; background:${T.bg}; overflow:hidden; font-family:inherit; color:${T.text}; font-size:12.5px; letter-spacing:.2px; --ed-paper:color-mix(in srgb, var(--pp-sheet) 97%, #f0e6d2); --ed-chrome:color-mix(in srgb, var(--pp-sheet) 55%, var(--pp-page)); --ed-sunk:color-mix(in srgb, var(--pp-sheet) 20%, var(--pp-page)); --ed-hover:color-mix(in srgb, var(--ed-paper) 96%, var(--pp-ink)); }
  /* 顶栏 */
  /* ⚠️ 加了时钟 / 问候 / 心情三个胶囊之后，窄一点的窗口会挤 ✗ ——
     给 row-gap 并允许换行 ✓（换行也比挤成一坨好 ✓）。 */
  .lw-head { display:flex; align-items:center; gap:12px; row-gap:9px; padding:11px 18px; flex:none; border-bottom:1px solid ${T.line}; background:${T.bg}; flex-wrap:wrap; }
  .lw-logo { width:32px; height:32px; flex:none; border:1px solid ${T.line}; display:flex; align-items:center; justify-content:center; font-size:16px; }
  .lw-h1 { font-size:13px; font-weight:700;   line-height:1.15; }
  .lw-h1 small { display:block; font-size:9px;  color:${T.dim}; font-weight:400; margin-top:2px; }
  /* 数据读取失败的横幅 ✓ —— 贴在顶栏下面、整宽 ✓ */
  .lw-storebar { display:flex; align-items:center; gap:10px; margin:0 14px 10px; padding:10px 14px; border-radius:8px; border:1px solid color-mix(in srgb, var(--pp-warn) 45%, transparent); background:color-mix(in srgb, var(--pp-warn) 10%, transparent); }
  .lw-storebar.bad { border-color:color-mix(in srgb, var(--pp-err) 50%, transparent); background:color-mix(in srgb, var(--pp-err) 10%, transparent); }
  .lw-storebar .ic { font-size:15px; flex:none; }
  .lw-storebar .tx { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
  .lw-storebar .tx b { font-size:12px; color:${T.text}; }
  .lw-storebar .tx span { font-size:11px; color:${T.dim}; line-height:1.5; }
  .lw-storebar button { flex:none; padding:5px 12px; font-size:11px; border-radius:8px; cursor:pointer; border:1px solid ${T.lineDim}; background:${T.card2}; color:${T.text}; }
  .lw-storebar button:hover { border-color:${T.accent}; }
  /* ★ 保存失败的浮层 ✓ —— 类名**故意**不叫 lw-toast ✗：
     那个名字已经被「新邮件提醒」占了 ✓（mailShowToast 用同一个 id + class ✓），
     两边抢同一个元素会互相覆盖 ✗（实测：我的红框被邮件那条的 2px 金色描边盖掉了 ✗）。 */
  .lw-savetoast { position:fixed; right:22px; bottom:22px; z-index:9600; max-width:420px; display:none; padding:12px 14px; border-radius:8px; font-size:12px; line-height:1.6; border:1px solid color-mix(in srgb, var(--pp-err) 55%, transparent); background:var(--pp-sheet); color:var(--pp-ink); box-shadow:var(--pp-shadow-float); }
  .lw-savetoast.on { display:block; animation:lwSaveToastIn .16s ease-out; }
  @keyframes lwSaveToastIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  .lw-savetoast .tx { margin-top:5px; color:var(--pp-ink2); word-break:break-word; }
  .lw-savetoast .acts { display:flex; gap:8px; margin-top:10px; }
  .lw-savetoast .acts button { padding:4px 12px; font-size:11.5px; border-radius:8px; cursor:pointer; border:1px solid color-mix(in srgb, var(--pp-err) 60%, transparent); background:color-mix(in srgb, var(--pp-err) 18%, transparent); color:var(--pp-ink); }
  .lw-savetoast .acts button:hover { background:color-mix(in srgb, var(--pp-err) 30%, transparent); }
  .lw-savetoast .acts button.ghost { border-color:color-mix(in srgb, var(--pp-ink) 11%, transparent); background:transparent; color:var(--pp-ink2); }
  @media (prefers-reduced-motion: reduce) { .lw-savetoast.on { animation:none; } }
  /* 状态栏里的行内小按钮（「重试」✓）—— 不能撑高顶栏 ✗ */
  .lw-inline-btn { margin-left:4px; padding:1px 8px; font-size:10.5px; line-height:1.6; border-radius:8px; border:1px solid currentColor; background:transparent; color:inherit; cursor:pointer; vertical-align:baseline; }
  .lw-inline-btn:hover { background:color-mix(in srgb, var(--pp-ink) 4%, transparent); }
  .lw-sub2 { font-size:10.5px; color:${T.dim}; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:.4px;  }
  .lw-btn { height:30px; padding:0 13px; border-radius:8px; border:1px solid ${T.line}; background:transparent; color:${T.text}; font:600 10.5px ${UI};   cursor:pointer; flex:none;
    transition:background .12s,color .12s; }
  .lw-btn:hover { background:${T.accent}; color:${T.accentInk}; }
  /* 天气胶囊 */
  /* ★ 天气和邮箱两个胶囊**必须一样高** ✗ ——
     天气那边是两行（地区 + 体感/湿度），邮箱那边原来只有一行，
     并排时一个 38.6px、一个 28px，看着就是「没对齐」✗（用户截图报的）。
     统一给固定高度 + 垂直居中 ✓；高度取 40（天气的内容实高约 27 + 内边距 8 + 边框 4）✓。 */
  .lw-wx, .lw-mb { height:40px; box-sizing:border-box; align-items:center; }
  .lw-wx { display:flex; gap:11px; padding:0 13px 0 10px; border:1px solid ${T.line}; flex:none; }
  .lw-wx .wi { font-size:19px; line-height:1; }
  .lw-wx .wt { font-size:16px; font-weight:700; color:${T.accent}; }
  .lw-wx .wc { font-size:9.5px; color:${T.dim}; line-height:1.4; letter-spacing:.4px; }
  /* ── 顶栏：状态胶囊（时钟 / 心情）✓ ──────────────────────────────────────
     ⚠️ 必须和天气 / 邮箱胶囊**统一 40px 等高** ✗（不然并排高低不齐 ✗，之前踩过一次 ✓）。
     ⚠️ 注释里不能出现反引号 ✗ —— 这段 CSS 整个在 JS 模板字符串里 ✗。 */
  .lw-stat { display:flex; align-items:center; gap:9px; height:40px; box-sizing:border-box; padding:0 12px; border:1px solid ${T.line}; flex:none; position:relative; }
  .lw-stat .ic { flex:none; color:${T.accent}; display:flex; }
  .lw-stat .big { font-size:15px; font-weight:700; color:${T.accent}; font-family:${MONO}; line-height:1; letter-spacing:.6px; font-variant-numeric:tabular-nums; }
  .lw-stat .cap { font-size:9.5px; color:${T.dim}; line-height:1.35; letter-spacing:.4px; white-space:nowrap; }
  .lw-stat .mid { display:flex; flex-direction:column; gap:3px; min-width:0; }
  .lw-stat.click { cursor:pointer; }
  .lw-stat.click:hover { background:${T.card2}; }
  .lw-stat .em { font-size:20px; line-height:1; }
  /* 今日进度：一条极细的条，贴在时钟胶囊下沿 ✓ */
  .lw-daybar { position:absolute; left:0; right:0; bottom:-2px; height:2px; background:${T.lineDim}; }
  .lw-daybar i { display:block; height:100%; background:${T.accent}; transition:width .6s linear; }
  /* 问候语 */
  .lw-greet { flex:none; display:flex; flex-direction:column; gap:3px; padding:0 2px; }
  .lw-greet b { font-size:13px; font-weight:700; letter-spacing:.8px; color:${T.text}; }
  .lw-greet b em { font-style:normal; color:${T.accent}; }
  .lw-greet span { font-size:9.5px; color:${T.dim}; letter-spacing:.4px; white-space:nowrap; }
  /* 心情选择浮层 ✓ */
  .lw-moodpick { position:absolute; top:46px; left:0; z-index:60; background:${T.card}; border:1px solid ${T.line}; padding:8px; display:grid; grid-template-columns:repeat(4,1fr); gap:4px;
    box-shadow:var(--pp-shadow-float); }
  .lw-moodpick div { display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 9px; cursor:pointer; font-size:9px; color:${T.dim}; white-space:nowrap; }
  .lw-moodpick div:hover { background:${T.card2}; color:${T.text}; }
  .lw-moodpick div.on { background:${T.accent}; color:${T.accentInk}; }
  .lw-moodpick div i { font-size:19px; font-style:normal; line-height:1; }
  /* ── 顶栏第二行：今日格言 + 今日状态 ✓ ─────────────────────────────────── */
  /* ★★ 要让格言**真居中**，光靠 flex 不行 ✗✗ ——
     .q { flex:1 } 拿到的是「右边状态块**之外**的剩余空间」✗，
     所以它的中心会**偏左** ✗（实测 1500 宽下偏了 123px ✗，用户一眼就看出来 ✗）。
     正解：三列网格 ✓ —— 左右各一个 1fr ✓、中间 auto ✓，
     两个 1fr 一样宽 ✓ → 中间那列的中心**就是整行的中心** ✓，**不用任何魔数** ✓。
     ⚠️ 窄屏把右边的状态隐藏时 ✓，右列变空 ✓，但两个 1fr 仍然相等 ✓ → 依旧居中 ✓。 */
  .lw-strip { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; column-gap:12px; padding:7px 18px; flex:none; border-bottom:1px solid ${T.line}; background:${T.card}; font-size:10.5px; color:${T.dim}; }
  /* ★ 格言**居中** ✓（用户要求：往中间放，中间还有位置 ✓）。
     .q 占满剩余空间 ✓，内容用 justify-content:center 居中 ✓。 */
  .lw-strip .q { grid-column:2; min-width:0; max-width:100%; display:flex; align-items:center; justify-content:center; gap:8px; }
  .lw-strip .q .ic { flex:none; color:${T.accent}; display:flex; }
  .lw-strip .q .tx { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${T.text}; }
  .lw-strip .q .from { color:${T.faint}; white-space:nowrap; }
  /* ★ 自动切换时**淡入**一下 ✓ —— 不然每 20 秒文字「啪」地换掉，很跳 ✗。
     ⚠️ 只动 .tx ✓，不给整行加动画 ✗（整行动会把右边的状态块也带着抖 ✗）。 */
  @keyframes lw-quote-in { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
  .lw-strip .q.swap .tx { animation:lw-quote-in .45s ease; }
  @media (prefers-reduced-motion: reduce) { .lw-strip .q.swap .tx { animation:none; } }
  .lw-strip .st { grid-column:3; justify-self:end; display:flex; align-items:center; gap:11px; }
  .lw-strip .st > span { display:flex; align-items:center; gap:5px; white-space:nowrap; }
  .lw-strip .st .ic { color:${T.dim}; display:flex; }
  .lw-strip .st b { color:${T.text}; font-weight:600; }
  .lw-strip .st .hot { color:${T.accent}; }
  .lw-strip .st .ok { color:${T.ok}; }
  /* 窄屏**逐级**收掉，别把顶栏挤成两行 ✗ ——
     ⚠️ 阈值是**算出来的** ✗：每个胶囊都是 flex:none（不可压缩 ✗），
        只有 .lw-sub2 能缩到 0 ✓（flex:1 + overflow:hidden ✓）。
        所以「基准总宽 = 所有固定项之和 + 间距 + 内边距」一旦超过窗口宽，
        整行就会换行 ✗（不管 sub2 还剩多少 ✗）。
        1440 时基准约 1183 → 收掉问候 → 1048 → 收掉时钟 → 907 → 收掉天气 → 697 ✓。
     ⚠️ 收掉的是**装饰性**的，天气 / 邮箱 / 刷新一个都不能收 ✗（那是功能 ✓）。 */
  @media (max-width: 1320px) { .lw-strip .st { display:none; } }
  @media (max-width: 1240px) { .lw-sub2 { display:none; } }
  @media (max-width: 1200px) { .lw-greet { display:none; } }
  @media (max-width: 1080px) { .lw-stat.clock { display:none; } }
  @media (max-width: 940px) { .lw-wx { display:none; } }
  /* 主体 */
  .lw-body2 { flex:1; display:flex; min-height:0; }
  .lw-nav { width:196px; flex:none; padding:14px 12px; border-right:1px solid ${T.line}; background:${T.bg}; display:flex; flex-direction:column; overflow:auto; }
  .lw-nav .grp { margin:6px 2px 8px; font-size:9px;  color:${T.faint};  }
  .lw-nav button { width:100%; height:38px; display:flex; align-items:center; gap:9px; padding:0 9px; margin-bottom:5px; border:1px solid ${T.lineDim}; border-radius:8px; background:transparent; color:${T.text};
    font:500 11.5px ${UI}; letter-spacing:.6px; cursor:pointer; text-align:left; transition:all .12s; }
  .lw-nav button:hover { border-color:${T.line}; }
  .lw-nav button.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; font-weight:700; }
  .lw-nav .ic { width:18px; text-align:center; font-size:13px; }
  .lw-nav .badge { margin-left:auto; font-size:9.5px;  color:${T.dim}; }
  .lw-nav button.on .badge { color:${T.accentInk}; opacity:.65; }
  /* ★ 「该复习了 N」的角标要**跳出来** ✗ —— 和别的编码角标长得一样就等于没有 ✗。
     用 warn 色 + 一圈淡底 ✓：扫一眼就能看出「这儿有事要做」✓。 */
  .lw-nav .badge.hot { color:${T.warn}; border:1px solid ${T.warn}; padding:0 5px; background:color-mix(in srgb, ${T.warn} 14%, transparent); }
  .lw-nav button.on .badge.hot { color:${T.accentInk}; border-color:transparent; }
  .lw-nav .foot { margin-top:auto; padding-top:14px; border-top:1px solid ${T.lineDim}; font-size:9.5px;  color:${T.faint};  line-height:1.9; }
  .lw-nav .foot b { color:${T.ok}; font-weight:600; }
  /* ★★ 窄屏：左栏改成**顶部横条** ✓✓（2026-10-18）——
     ⚠️ 实测 430px（手机浏览器走局域网打开 ✓）：左栏固定 196px ✓ + 内容区只剩 **234px** ✓
        → 卡片全被挤成一列、表格横着滚 ✗，等于手机上没法用 ✗。
     ⇒ 窄屏把导航摊成一行**可横滑的胶囊** ✓，内容占满整宽 ✓。
     ⚠️ 只改**布局方向** ✗，不动任何交互 / 结构 ✓（桌面宽度完全不受影响 ✓）。 */
  @media (max-width: 820px) { .lw-body2 { flex-direction:column; }
    .lw-nav { width:auto; flex:none; flex-direction:row; align-items:center; gap:6px; padding:8px 10px; border-right:0; border-bottom:1px solid ${T.line};
      overflow-x:auto; overflow-y:hidden; scrollbar-width:none; }
    .lw-nav::-webkit-scrollbar { display:none; }
    .lw-nav .grp, .lw-nav .foot { display:none; }
    .lw-nav button { width:auto; flex:none; height:32px; margin-bottom:0; padding:0 10px; gap:6px; }
    .lw-nav .badge { margin-left:4px; }
    .lw-main { padding:12px 12px 24px; }
  }
  .lw-main { flex:1; min-width:0; overflow:auto; padding:16px 18px 28px; }
  .lw-main::-webkit-scrollbar { width:10px; } .lw-main::-webkit-scrollbar-thumb { background:var(--pp-line); }
  /* ★★★ 「全高面板」必须**真正填满内容区** ✗✗ ——
     用户原话：「窗口无法拖拽，下面一大半都是空白」。
     根因：.lw-ml（邮箱）只写了 flex:1 ✗，而它的父级 .lw-main 是
     **display:block** ✗ → flex:1 完全不起作用 ✗ → 面板高度由**内容**决定 ✗
     （邮箱实测只有 545px，而内容区有 846px ✗）→ 底下留 **301px 空白** ✗，
     视口越高越明显 ✗。而且**两条拖拽条也只有 545px 高** ✗ →
     用户在空白那一大段里抓不到它 ✗，看着就像「拖不动」✗（其实是没东西可抓 ✗）。
     备忘录 / 日记则是另一套毛病：用 calc(100vh - 250px) 这种**魔数** ✗，
     同样对不齐（实测差 46~61px ✗），而且窗口一变就可能更歪 ✗。
     → 统一改成「父级变 flex 列 + 面板 flex:1」✓，**一个魔数都不用** ✓。
     ⚠️ 「哪些页签该 fill」**只在 LW_FILL_TAB 里决定一次** ✓（见下面那张表 ✓）——
        今日 / 书签 / 研究方向 / 文件是**长列表** ✓，
        它们本来就该撑高页面让 .lw-main 自己滚 ✓，加了 flex:1 反而会把内容裁掉 ✗。
     ⚠️ 这里**不再列视图根元素的类名** ✗ —— 那份清单是会悄悄过期的副本 ✗（见下面那条注释 ✓）。 */
  .lw-main.fill { display:flex; flex-direction:column; }
  /* ★★★ 这里**故意不逐个列类名** ✗✗ —— 列一次踩一次坑 ✓，第三次终于栽了 ✗：
     原来是「.lw-main.fill > .lw-ml, > .lw-rd, > .lw-fl, > .lw-tr, > .lw-jr { flex:1 }」✓，
     ① 加了「阅读外面套 .lw-rd-wrap」→ 补一条 ✓；
     ② 加「热榜」时写的是 .lw-tr ✗✗ —— 而 **.lw-tr 早就被表格行占了** ✗
        （见下面 .lw-tr { display:flex; … min-height:42px } ✓），
        于是热榜的根 .lw-hl **一个都没匹配上** ✗ →
        只能吃 .lw-hl { min-height:320px } ✗ → 实测**底部空 497px** ✗✗
        （用户截图就是这一张 ✓：「下面存在大量空白」✓）。
     → 改成**结构性规则** ✓：「哪些页签是全高」这个决定**只留在 LW_FILL_TAB 一个地方** ✓，
       CSS 只管「.lw-main.fill 的直接子元素撑满」✓ ——
       以后**再加 / 改名视图的根元素，这里一个字都不用动** ✓。
       （这才是不会再犯的写法 ✓：类名清单 = 一份会悄悄过期的副本 ✗。）
     ⚠️ 前提：全高页签的视图**只返回一个根元素** ✓（6 个页签实测都是 1 个 ✓）；
        浮层（.lw-imp）是 position:fixed ✓，脱离文档流 ✓，不受影响 ✓。
        这条前提由 tests/life-trends.js 的「每个全高页签底部不留白」断言守着 ✓。 */
  .lw-main.fill > * { flex:1; min-height:0; }
  /* 备忘录：面板在 .lw-g12 > .lw-c 里面 ✗（grid 单元格默认 align-items:start 不撑高 ✗）
     —— 得把这条链也一起撑开 ✓ */
  .lw-main.fill > .lw-g12 { align-items:stretch; }
  /* ★★ 长列表页签（今日 / 书签 / 研究方向 / 文件）也要「填满」，但**不能变成 flex** ✗ ★★
     这四个页签是长列表 ✓：把 .lw-main 改成 flex 列、再给子元素 flex:1 ✗
     会把内容**裁掉**（tests/life-trends.js 有一条断言专门守这个 ✓），
     所以用**另一条路**：父级保持 display:block ✓，只给网格一个**下限**✓ ——
       min-height:100% = 内容区高度（.lw-main 是 flex 项，高度是确定值 ✓，百分比能解析 ✓）。
     ⇒ 内容比视口**矮**时，网格被撑到内容区高度 ✓ → 最后一行落到底部 ✓ 不留白 ✓；
        内容比视口**高**时，min-height 不生效 ✓ → 照旧由 .lw-main 自己滚 ✓。
     一次写法同时满足两种数据量 ✓（这两页的空白与否**取决于用户有多少条数据** ✓，
     所以「按内容长短切换行为」本来就是对的 ✓，不需要 JS 判断 ✓）。
     ⚠️ grid 的 align-content 默认 stretch ✓ —— 富余高度会**按行平分**✓，
        最后一行因此落到底部 ✓（不是只长最后一行 ✓，但底部不会留白 ✓）。 */
  .lw-main:not(.fill) > .lw-g12 { min-height:100%; }
  .lw-main.fill > .lw-g12 > .lw-c { display:flex; flex-direction:column; min-height:0; }
  .lw-main.fill > .lw-g12 > .lw-c > .lw-nt { flex:1; min-height:0; height:auto; }
  /* ★★★ 2026-10-29 全站改根（用户：「窗口一大一小、空白太多」，个人面板同样中招）★★★
     ① align-items 从 start ⇒ stretch ✓：
        原来是「每张卡各自按内容高」✗ ⇒ 同一行的卡高低不齐 ✓
        （实测 今日 122/123/120/123 ✓、研究方向 229/236 ✓、文件 257/250 ✓、596x411/596x417 ✓），
        这就是用户说的「一大一小」✓。stretch 之后同一行的卡**等高**✓，
        多出来的高度留在卡片内部（卡片本来就有 overflow:auto ✓）。
     ② 轨道从 1fr ⇒ minmax(0,1fr) ✓：
        1fr 的下限是 auto ✓ ⇒ 卡片里的长路径 / 长命令名能把轨道**顶宽**✗，
        于是同一行两栏一个宽一个窄 ✓（跨栏卡按 data-span 算 px 时尤其明显 ✗）。
        minmax(0,1fr) 把下限压成 0 ✓，跨栏宽度就变成**可算**的（span*colW + (span-1)*16 ✓）。
     ⚠️ 跨栏（data-span 3/4/6/8）不是「一大一小」✗ —— 那是用户自己拖出来的排版意图 ✓，
        CSS 里 12 轨 + span 的宽度是可算且稳定的 ✓，所以保留 ✓。 */
  .lw-g12 { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:16px; align-items:stretch; }
  /* ★ 卡片：**拖「边」改大小** ✓（右边改宽 ✓ / 下边改高 ✓ / 右下角一起改 ✓）
     原生 resize 只能拖右下角 ✗ —— 所以改成手写三条热区 ✓。
     热区用绝对定位的细条 ✓，**不占布局** ✓，平时看不见 ✓，hover 时亮起来 ✓。
     （提醒：CSS 是模板字符串，注释里不要写反引号 ✗ —— 踩过四次 ✗。）*/
  .lw-c { background:${T.card}; border:1px solid ${T.lineDim}; overflow:auto; min-width:240px; min-height:120px; position:relative; }
  .lw-c:hover { border-color:${T.line}; }
  /* ★ 卡片反馈强化 ✓✓（2026-10-09）——
     原来只有「边框颜色变一下」✓，鼠标移上去几乎没感觉 ✓。
     ⚠️⚠️ **绝对不能用 transform: translateY()** ✗✗ ——
        卡片右边/下边/右下角有**拖拽热区**（「.lw-rs」，绝对定位在卡片边缘 ✓），
        transform 会把热区一起挪走 ✓ → 用户拖的时候**抓不住** ✓（实测踩过这类坑 ✓）。
     → 只用 **border-color + box-shadow** ✓（不占布局、不动热区 ✓）。
     ⚠️ 也不加 border-radius ✗ —— 卡片是**刻意的直角**（「border-radius:8px」 ✓，
        这套 HUD 风格的一部分 ✓），不是漏了 ✓。 */
  .lw-c { transition: border-color .14s ease, box-shadow .14s ease; }
  .lw-c:hover { border-color:${T.line}; box-shadow:var(--pp-shadow-lift), inset 0 1px 0 var(--pp-glow); }
  .lw-c:active { box-shadow:var(--pp-inset); }
  /* 拖拽时别跟着 hover 抖 ✓ */
  .lw-c.lw-dragging:hover { box-shadow:none; }
  /* 三条热区 */
  .lw-rs { position:absolute; z-index:3; }
  .lw-rs-e  { top:0; bottom:0; right:-3px; width:8px; cursor:ew-resize; }      /* 右边 → 改宽 */
  .lw-rs-s  { left:0; right:0; bottom:-3px; height:8px; cursor:ns-resize; }    /* 下边 → 改高 */
  .lw-rs-se { right:-3px; bottom:-3px; width:14px; height:14px; cursor:nwse-resize; }  /* 右下角 */
  /* hover 时把对应的边点亮 ✓（一眼知道能拖哪里 ✓）*/
  .lw-c:hover > .lw-rs-e  { box-shadow:inset -3px 0 0 ${T.accent}; }
  .lw-c:hover > .lw-rs-s  { box-shadow:inset 0 -3px 0 ${T.accent}; }
  .lw-c:hover > .lw-rs-se { background:linear-gradient(135deg, transparent 40%, ${T.accent} 40%, ${T.accent} 62%, transparent 62%, transparent 72%, ${T.accent} 72%, ${T.accent} 92%, transparent 92%); }
  .lw-rs.on { box-shadow:none !important; }
  .lw-rs-e.on  { box-shadow:inset -3px 0 0 ${T.accent} !important; }
  .lw-rs-s.on  { box-shadow:inset 0 -3px 0 ${T.accent} !important; }
  .lw-rs-se.on { background:${T.accent} !important; }
  /* 卡片：硬边框 + 标题栏带前缀编码 */
  .lw-c { background:${T.card}; border:1px solid ${T.line}; border-radius:8px; }
  .lw-c > h3 { position:sticky; top:0; z-index:2; background:${T.card}; margin:0; padding:8px 11px; font-size:9.5px; font-weight:600; color:${T.dim}; border-bottom:1px solid ${T.lineDim}; display:flex; align-items:center; gap:9px; }
  .lw-c > h3 .code { color:${T.accent};  }
  .lw-c > h3 .sp { flex:1; }
  .lw-c > h3 em { font-style:normal; letter-spacing:.6px; color:${T.faint}; font-weight:400; font-size:9.5px; }
  .lw-c > h3 .act { font-size:9.5px;  color:${T.accent}; cursor:pointer; font-weight:600; }
  .lw-pad { padding:13px 14px; }
  /* KPI：方框图标 + 大数字 */
  .lw-kpi { padding:14px 15px; }
  .lw-kpi .row { display:flex; align-items:center; gap:12px; }
  .lw-kpi .ic { width:40px; height:40px; flex:none; border:1px solid ${T.line}; display:flex; align-items:center; justify-content:center; font-size:18px; background:transparent; color:${T.accent}; }
  .lw-kpi .num { font-size:31px; font-weight:700; line-height:1; letter-spacing:-1px; font-variant-numeric:tabular-nums; }
  .lw-kpi .num small { font-size:10.5px; font-weight:500; color:${T.dim}; margin-left:5px; letter-spacing:.6px; }
  .lw-kpi .lbl { font-size:9.5px;  color:${T.faint};  margin-top:10px; }
  .lw-kpi .cmp { font-size:10.5px; color:${T.dim}; letter-spacing:.4px; margin-top:4px; }
  .lw-kpi .cmp b { color:${T.ok}; font-weight:700; }
  /* 列表 */
  .lw-tbl { display:flex; flex-direction:column; }
  .lw-tr { display:flex; align-items:center; gap:11px; min-height:42px; padding:0 11px; cursor:pointer; border-bottom:1px solid ${T.lineDim}; transition:background .12s; }
  .lw-tr:last-child { border-bottom:0; }
  .lw-tr:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-tr:hover .nm i, .lw-tr:hover .sz, .lw-tr:hover .tm, .lw-tr:hover .bd { color:${T.accentInk} !important; opacity:.72; }
  .lw-tr .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
  .lw-tr .nm i { font-style:normal; color:${T.faint}; font-size:10.5px; }
  .lw-tr .sz { flex:none; font-size:10.5px; color:${T.dim}; text-align:right; width:62px; font-variant-numeric:tabular-nums; }
  .lw-tr .tm { flex:none; font-size:10.5px; color:${T.faint}; width:70px; text-align:right; }
  .lw-tr .bd { flex:none; font-size:9.5px; padding:2px 7px; border:1px solid ${T.lineDim}; color:${T.dim}; letter-spacing:.8px;  }
  /* 待办 */
  .lw-todo { display:flex; align-items:flex-start; gap:11px; padding:10px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-todo:last-child { border-bottom:0; }
  .lw-todo:hover { background:var(--pp-sheet2); }
  .lw-todo .ck { width:17px; height:17px; flex:none; margin-top:1px; border:1px solid ${T.lineDim}; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:11px; color:transparent; transition:all .12s; }
  .lw-todo .ck:hover { border-color:${T.accent}; }
  .lw-todo.done .ck { background:${T.ok}; border-color:${T.ok}; color:${T.bg}; }
  .lw-todo .tx { flex:1; min-width:0; font-size:12px; line-height:1.5; word-break:break-word; }
  .lw-todo.done .tx { color:${T.faint}; text-decoration:line-through; }
  .lw-todo .due { font-size:9.5px; color:${T.faint}; margin-top:3px; letter-spacing:.6px; }
  .lw-todo .del { flex:none; font-size:14px; color:${T.faint}; cursor:pointer; opacity:0; padding:0 4px; }
  .lw-todo:hover .del { opacity:1; }
  .lw-todo .del:hover { color:${T.red}; }
  .lw-add { display:flex; gap:8px; padding:11px 12px; border-top:1px solid ${T.lineDim}; }
  .lw-add input { flex:1; min-width:0; height:32px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11.5px ${UI}; outline:none; }
  .lw-add input:focus { border-color:${T.accent}; }
  .lw-add button { height:32px; padding:0 14px; border:1px solid ${T.accent}; background:${T.accent}; color:${T.accentInk}; font:700 10.5px ${UI};   cursor:pointer; }
  /* 笔记 */
  .lw-note { padding:11px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-note:last-child { border-bottom:0; }
  .lw-note:hover { background:var(--pp-sheet2); }
  .lw-note .h { display:flex; align-items:center; gap:8px; font-size:9.5px; color:${T.faint}; margin-bottom:5px; letter-spacing:.8px; }
  .lw-note .h .del { margin-left:auto; cursor:pointer; opacity:0; }
  .lw-note:hover .h .del { opacity:1; }
  .lw-note .h .del:hover { color:${T.red}; }
  .lw-note .b { font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }
  .lw-note textarea { width:100%; min-height:72px; resize:vertical; padding:10px 11px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:12px/1.6 ${UI}; outline:none; }
  .lw-note textarea:focus { border-color:${T.accent}; }
  /* 快捷入口 */
  .lw-links { display:grid; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); gap:8px; }
  .lw-link { display:flex; align-items:center; gap:9px; padding:10px 11px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; text-decoration:none; font-size:11.5px; letter-spacing:.4px;
    cursor:pointer; transition:all .12s; }
  .lw-link:hover { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-link .ic { font-size:15px; }
  /* 柱状 */
  .lw-bars { display:flex; align-items:flex-end; gap:5px; height:126px; }
  .lw-bars > div { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:5px; height:100%; }
  .lw-bars .v { font-size:9.5px; color:${T.dim}; }
  .lw-bars .b { width:100%; background:${T.accent}; }
  .lw-bars > div:hover .b { background:var(--pp-sheet); }
  .lw-bars .k { font-size:9px; color:${T.faint}; letter-spacing:.2px; }
  .lw-empty { padding:28px 12px; text-align:center; color:${T.faint}; font-size:11px; letter-spacing:1px;  }
  .lw-empty .big { font-size:22px; display:block; margin-bottom:8px; opacity:.55; }
  .lw-sk { background:linear-gradient(90deg,var(--pp-sheet2) 25%,var(--pp-sheet2) 37%,var(--pp-sheet2) 63%); background-size:400% 100%; animation:lw-sk 1.3s ease infinite; }
  @keyframes lw-sk { 0%{background-position:100% 50%} 100%{background-position:0 50%} }
  .lw-chips { display:flex; flex-wrap:wrap; gap:7px; }
  .lw-chip { font-size:10.5px; padding:3px 9px; border:1px solid ${T.lineDim}; color:${T.dim}; letter-spacing:.6px; }
  .lw-chip b { color:${T.accent}; font-weight:700; margin-left:5px; }
  /* 网上热点 / AI 输出 */
  .lw-hotlist { display:flex; flex-direction:column; max-height:340px; overflow:auto; }
  .lw-hotrow { padding:9px 14px; border-top:1px solid ${T.lineDim}; }
  .lw-hotrow:hover { background:var(--pp-sheet2); }
  .lw-hotrow .t { font-size:12.5px; line-height:1.5; }
  .lw-hotrow .t a { color:${T.text}; text-decoration:none; }
  .lw-hotrow .t a:hover { color:${T.accent}; text-decoration:underline; }
  .lw-hotrow .m { font-size:10px; color:${T.faint}; margin-top:4px; letter-spacing:.4px; }
  .lw-hotkw { cursor:pointer; }
  .lw-hotkw:hover { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-aiout { padding:12px 14px; font-size:12.5px; line-height:1.85; color:${T.text}; border-top:1px solid ${T.lineDim}; }
  .lw-btn[disabled] { cursor:default; }
  /* 备忘录：结构照 macOS 备忘录，**配色跟 HUD 深色统一**（不再黑壳塞白块 ✗） */
  .lw-memo { display:flex; height:calc(100vh - 260px); min-height:460px; overflow:hidden; }
  .lw-memo-list { width:272px; flex:none; background:var(--pp-page); border-right:1px solid ${T.lineDim}; display:flex; flex-direction:column; }
  .lw-memo-search { padding:10px 11px 8px; border-bottom:1px solid ${T.lineDim}; }
  .lw-memo-search input { width:100%; height:28px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11.5px ${UI}; outline:none; }
  .lw-memo-search input:focus { border-color:${T.accent}; }
  .lw-memo-search input::placeholder { color:${T.faint}; }
  .lw-memo-bar { display:flex; align-items:center; gap:8px; padding:7px 11px; border-bottom:1px solid ${T.lineDim}; }
  .lw-memo-bar .n { font-size:10px; color:${T.faint}; letter-spacing:1px;  }
  .lw-memo-bar .sp { flex:1; }
  .lw-memo-bar button, .lw-memo-bar select { height:24px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:600 10px ${UI}; letter-spacing:.8px; cursor:pointer; }
  .lw-memo-bar button.pri { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-memo-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-memo-bar button.pri:hover { color:${T.accentInk}; }
  .lw-memo-bar select option { background:var(--pp-sheet); color:${T.text}; }
  .lw-mlist { flex:1; overflow:auto; }
  .lw-mrow { padding:9px 12px; border-bottom:1px solid ${T.lineDim}; cursor:pointer; position:relative; }
  .lw-mrow:hover { background:var(--pp-sheet2); }
  .lw-mrow.on { background:${T.accent}; }
  .lw-mrow.on .t, .lw-mrow.on .d { color:${T.accentInk}; }
  .lw-mrow.on .s { color:color-mix(in srgb, var(--pp-on-accent) 60%, transparent); }
  .lw-mrow .t { font-size:12px; font-weight:600; color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:62px; }
  .lw-mrow .d { position:absolute; right:12px; top:9px; font-size:10px; color:${T.faint}; }
  .lw-mrow .s { font-size:10.5px; color:${T.faint}; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-mrow .pin { color:${T.accent}; font-size:10px; margin-right:4px; }
  .lw-memo-editor { flex:1; min-width:0; display:flex; flex-direction:column; }
  .lw-memo-tools { display:flex; align-items:center; gap:10px; padding:8px 14px; border-bottom:1px solid ${T.lineDim}; }
  .lw-memo-tools .sp { flex:1; }
  .lw-memo-tools button { height:25px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:600 10px ${UI}; letter-spacing:.8px; cursor:pointer; }
  .lw-memo-tools button.pri { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-memo-tools button.del { color:${T.red}; border-color:color-mix(in srgb, var(--pp-err) 50%, transparent); }
  .lw-memo-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-memo-tools button.pri:hover { color:${T.accentInk}; }
  .lw-memo-tools button.del:hover { background:${T.red}; color:var(--pp-on-accent); border-color:${T.red}; }
  .lw-mtitle { border:0; background:transparent; color:${T.text}; font:700 17px ${UI}; padding:15px 18px 6px; outline:none; }
  .lw-mtitle::placeholder { color:${T.faint}; }
  .lw-mbody { flex:1; border:0; background:transparent; color:${T.text}; font:12.5px/1.8 ${UI}; padding:4px 18px 14px; resize:none; outline:none; min-height:200px; }
  .lw-mbody::placeholder { color:${T.faint}; }
  .lw-mfoot { padding:7px 18px; border-top:1px solid ${T.lineDim}; font-size:10px; color:${T.faint}; letter-spacing:.6px; }
  /* 清单模式：每行一个可勾选项 */
  .lw-mcheck { flex:1; overflow:auto; padding:4px 18px 14px; }
  .lw-mcitem { display:flex; align-items:flex-start; gap:9px; padding:5px 0; }
  .lw-mcitem .ck { width:16px; height:16px; flex:none; margin-top:2px; border:1px solid ${T.lineDim}; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:10px; color:transparent; }
  .lw-mcitem .ck:hover { border-color:${T.accent}; }
  .lw-mcitem.done .ck { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-mcitem .tx { flex:1; min-width:0; font-size:12.5px; line-height:1.65; word-break:break-word; }
  .lw-mcitem.done .tx { color:${T.faint}; text-decoration:line-through; }
  .lw-mcitem .del { flex:none; opacity:0; cursor:pointer; color:${T.faint}; font-size:12px; }
  .lw-mcitem:hover .del { opacity:1; }
  .lw-mcitem .del:hover { color:${T.red}; }
  .lw-mcadd { display:flex; gap:8px; padding:8px 18px 14px; }
  .lw-mcadd input { flex:1; min-width:0; height:30px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:12px ${UI}; outline:none; }
  .lw-mcadd input:focus { border-color:${T.accent}; }
  .lw-mcadd button { height:30px; padding:0 12px; border:1px solid ${T.accent}; background:${T.accent}; color:${T.accentInk}; font:700 10px ${UI}; letter-spacing:1px; cursor:pointer; }
  /* Markdown 预览 */
  .lw-md { flex:1; overflow:auto; padding:4px 18px 16px; font-size:13px; line-height:1.8; color:${T.text}; }
  .lw-md h1, .lw-md h2, .lw-md h3 { margin:14px 0 8px; font-weight:700; color:var(--pp-ink); }
  .lw-md h1 { font-size:19px; } .lw-md h2 { font-size:16px; } .lw-md h3 { font-size:14px; }
  .lw-md p { margin:8px 0; }
  .lw-md code { background:var(--pp-sheet); padding:1px 5px; font-family:${MONO}; font-size:11.5px; color:${T.accent}; }
  .lw-md pre { background:var(--pp-sheet2); border-left:2px solid ${T.accent}; padding:10px 12px; overflow:auto; margin:10px 0; }
  .lw-md pre code { background:transparent; padding:0; }
  .lw-md blockquote { margin:8px 0; padding:4px 12px; border-left:1px solid ${T.lineDim}; color:${T.dim}; }
  .lw-md ul, .lw-md ol { margin:8px 0; padding-left:22px; }
  .lw-md li { margin:3px 0; }
  .lw-md a { color:${T.accent}; }
  .lw-md hr { border:0; border-top:1px solid ${T.lineDim}; margin:14px 0; }
  .lw-md strong { color:var(--pp-ink); }
  .lw-md .tag { color:${T.accent}; background:color-mix(in srgb, var(--pp-accent) 12%, transparent); padding:1px 6px; font-size:11.5px; }
  /* 标签栏 */
  .lw-mtags { display:flex; flex-wrap:wrap; gap:6px; padding:8px 11px; border-bottom:1px solid ${T.lineDim}; }
  .lw-mtags span { font-size:10px; padding:2px 8px; border:1px solid ${T.lineDim}; color:${T.dim}; cursor:pointer; letter-spacing:.4px; }
  .lw-mtags span:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-mtags span.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; font-weight:700; }
  .lw-save { font-size:10px; color:${T.faint}; letter-spacing:.6px; }
  .lw-save.ok { color:${T.ok}; }
  /* 回收站 */
  .lw-trash { padding:9px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-trash .t { font-size:11.5px; color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-trash .r { display:flex; gap:8px; margin-top:6px; }
  .lw-trash button { height:22px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:600 10px ${UI}; cursor:pointer; }
  .lw-trash button:hover { border-color:${T.accent}; color:${T.accent}; }
  /* ── Memos 风格：单列时间线 ── */
  .lw-mo { display:flex; flex-direction:column; gap:0; }
  .lw-mo-write { display:flex; gap:10px; padding:12px 14px; border:1px solid ${T.lineDim}; background:var(--pp-page); }
  .lw-mo-write textarea { flex:1; min-height:52px; border:0; background:transparent; color:${T.text}; font:12.5px/1.7 ${UI}; resize:vertical; outline:none; }
  .lw-mo-write textarea::placeholder { color:${T.faint}; }
  .lw-mo-write .side { display:flex; flex-direction:column; justify-content:flex-end; gap:6px; flex:none; }
  .lw-mo-write button { height:28px; padding:0 13px; border:1px solid ${T.accent}; background:${T.accent}; color:${T.accentInk}; font:700 10px ${UI}; letter-spacing:1px; cursor:pointer; }
  .lw-mo-write button:disabled { opacity:.35; cursor:default; }
  .lw-mo-day { margin:16px 0 8px; font-size:10.5px; color:${T.faint}; display:flex; align-items:center; gap:10px; }
  .lw-mo-day::after { content:""; flex:1; height:1px; background:${T.lineDim}; }
  .lw-mo-card { border:1px solid ${T.lineDim}; background:var(--pp-sheet); padding:11px 13px; margin-bottom:9px; }
  .lw-mo-card:hover { border-color:${T.line}; }
  .lw-mo-card.pin { border-left:2px solid ${T.accent}; }
  .lw-mo-head { display:flex; align-items:center; gap:9px; margin-bottom:7px; }
  .lw-mo-head .tm { font-size:10px; color:${T.faint}; letter-spacing:.6px; }
  .lw-mo-head .pin { color:${T.accent}; font-size:11px; }
  .lw-mo-head .sp { flex:1; }
  .lw-mo-head button { height:20px; padding:0 8px; border:1px solid ${T.lineDim}; background:transparent; color:${T.faint}; font:600 9.5px ${UI}; letter-spacing:.6px; cursor:pointer; opacity:0; }
  .lw-mo-card:hover .lw-mo-head button { opacity:1; }
  .lw-mo-head button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-mo-head button.del:hover { border-color:${T.red}; color:${T.red}; }
  .lw-mo-body { font-size:12.5px; line-height:1.8; color:${T.text}; }
  .lw-mo-body p { margin:6px 0; }
  .lw-mo-body p:first-child { margin-top:0; }
  .lw-mo-body ul { margin:6px 0; padding-left:20px; }
  .lw-mo-body code { background:var(--pp-sheet); padding:1px 5px; font-family:${MONO}; font-size:11px; color:${T.accent}; }
  .lw-mo-body pre { background:var(--pp-sheet2); border-left:2px solid ${T.accent}; padding:9px 11px; overflow:auto; margin:8px 0; }
  .lw-mo-body pre code { background:transparent; padding:0; }
  .lw-mo-body blockquote { margin:6px 0; padding:3px 11px; border-left:1px solid ${T.lineDim}; color:${T.dim}; }
  .lw-mo-body h1, .lw-mo-body h2, .lw-mo-body h3 { margin:9px 0 5px; color:var(--pp-ink); font-size:13.5px; }
  .lw-mo-body a { color:${T.accent}; }
  .lw-mo-body strong { color:var(--pp-ink); }
  .lw-mo-body .tag { color:${T.accent}; background:color-mix(in srgb, var(--pp-accent) 12%, transparent); padding:1px 6px; font-size:11px; cursor:pointer; }
  .lw-mo-edit textarea { width:100%; min-height:110px; border:1px solid ${T.accent}; background:var(--pp-page); color:${T.text}; font:12.5px/1.7 ${UI}; padding:10px 11px; resize:vertical; outline:none; }
  .lw-mo-edit .row { display:flex; gap:8px; margin-top:9px; }
  .lw-mo-edit button { height:26px; padding:0 12px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:600 10px ${UI}; letter-spacing:1px; cursor:pointer; }
  .lw-mo-edit button.pri { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-mo-empty { padding:40px 12px; text-align:center; color:${T.faint}; font-size:12px; }
  .lw-mo-empty .big { font-size:26px; display:block; margin-bottom:9px; opacity:.5; }
  /* ── macOS 备忘录三栏 ── */
  /* ⚠️ 高度**故意不写** ✗ —— 以前是 calc(100vh - 250px) 这种**魔数** ✗，
     对不齐内容区（实测差 61px ✗），而且窗口一变就更歪 ✗。
     现在由 .lw-main.fill > .lw-g12 > .lw-c > .lw-nt { flex:1 } 撑满 ✓
     （见 .lw-main 那一段的注释 ✓）。min-height 只作**矮窗口时的下限** ✓。 */
  .lw-nt { display:flex; min-height:320px; border:1px solid ${T.lineDim}; }
  /* 左：文件夹 + 标签 */
  .lw-nt-side { width:172px; flex:none; background:var(--pp-page); border-right:1px solid ${T.lineDim}; padding:10px 8px; overflow:auto; }
  /* 三栏之间可拖拽的竖条（左右自由调宽 ✓，双击恢复默认 ✓） */
  /* ★ 拖拽调宽的竖条 —— 备忘录和邮箱共用同一套样式 ✓
     （用户报「邮箱怎么没有左右自由拖动功能」✗，现在两个模块一致 ✓）*/
  /* ★ 通用三栏拖拽条 .lw-pgrip ✓ —— 阅读 / 工作流 / 热榜 共用 ✓。
     （用户先在邮箱那儿要过一次拖拽 ✗，又在热榜这儿要了一次 ✗ ——
       说明「三栏可拖」是**每个模块的默认预期** ✓ → 做成通用的 ✓，以后加模块直接复用 ✓。） */
  .lw-nt-grip, .lw-ml-grip, .lw-pgrip { flex:none; width:7px; cursor:col-resize; position:relative; background:var(--pp-sheet2); }
  .lw-nt-grip::after, .lw-ml-grip::after, .lw-pgrip::after { content:''; position:absolute; left:3px; top:0; bottom:0; width:1px; background:${T.lineDim}; }
  .lw-nt-grip:hover::after, .lw-nt-grip.on::after, .lw-nt-grip:hover::after, .lw-ml-grip:hover::after, .lw-nt-grip.on::after, .lw-ml-grip.on::after, .lw-pgrip:hover::after, .lw-pgrip.on::after, .lw-pgrip.dragging::after { background:${T.accent}; width:2px; left:2px; }
  /* 拖拽把备忘录移到文件夹时的落点高亮 */
  .lw-nt-side .it.drop { background:color-mix(in srgb,${T.ok} 18%,transparent); border-color:${T.ok}; color:${T.text}; }
  .lw-nt-row.dragging { opacity:.45; }
  .lw-nt-side .hd { display:flex; gap:6px; margin-bottom:10px; }
  .lw-nt-side .hd button { flex:1; height:26px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font-size:12px; cursor:pointer; }
  .lw-nt-side .hd button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-nt-side .grp { margin:12px 6px 6px; font-size:9.5px;  color:${T.faint};  }
  .lw-nt-side .it { display:flex; align-items:center; gap:8px; padding:6px 9px; font-size:11.5px; color:${T.dim}; cursor:pointer; border:1px solid transparent; }
  .lw-nt-side .it:hover { background:var(--pp-sheet2); color:${T.text}; }
  .lw-nt-side .it.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; font-weight:700; }
  .lw-nt-side .it .n { margin-left:auto; font-size:10px; opacity:.7; }
  /* 中：列表 */
  .lw-nt-list { width:288px; flex:none; background:var(--pp-page); border-right:1px solid ${T.lineDim}; display:flex; flex-direction:column; }
  .lw-nt-list .top { padding:9px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-nt-list .top .t1 { font-size:12.5px; font-weight:700; color:${T.text}; }
  .lw-nt-list .top .t2 { font-size:10px; color:${T.faint}; margin-top:2px; }
  .lw-nt-list .top input { width:100%; margin-top:8px; height:28px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11.5px ${UI}; outline:none; }
  .lw-nt-list .top input:focus { border-color:${T.accent}; }
  .lw-nt-scroll { flex:1; overflow:auto; }
  .lw-nt-grp { padding:9px 12px 5px; font-size:11px; font-weight:700; color:${T.text}; }
  .lw-nt-row { display:flex; gap:9px; padding:8px 12px; border-bottom:1px solid var(--pp-sheet2); cursor:pointer; }
  .lw-nt-row:hover { background:var(--pp-sheet2); }
  .lw-nt-row.on { background:var(--pp-sheet2); }
  .lw-nt-row .c { flex:1; min-width:0; }
  .lw-nt-row .tt { font-size:12px; font-weight:600; color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-nt-row .mt { font-size:10px; color:${T.faint}; margin-top:2px; }
  .lw-nt-row .mt b { color:${T.dim}; font-weight:400; }
  .lw-nt-row .sub { font-size:10.5px; color:${T.faint}; margin-top:3px; display:flex; align-items:center; gap:5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-nt-row .pin { color:${T.accent}; }
  /* 右：编辑区 */
  .lw-nt-edit { flex:1; min-width:0; display:flex; flex-direction:column; background:var(--pp-sheet); }
  /* ══ 唯一的一条工具栏 ✓（2026-10-30：四条横栏合并成一条）══
     ⚠️ 这里**不许换行** ✗✗ —— 用户要求「只剩一条工具栏」✓：
        · 原来这里是 flex-wrap:wrap ✓（窄屏把溢出的按钮换到第二行「保证每个都点得到」），
          但那就成了**第二条横栏** ✗，和本次的目标直接冲突 ✓；
        · 现在改 nowrap + 「放不下就收进 ⋯ 更多」✓（见下面的容器查询 ✓）——
          1280 宽实测编辑区只有 570px ✓，靠的是把表格/代码块/图片/引用/删除线/置顶收进更多 ✓。
     ⚠️ overflow 保持默认 visible ✗（不设 auto/hidden ✓）：
        popup（更多 / Aa）是栏内的 absolute 元素 ✓，hidden 会把它裁掉 ✓；
        而内容真的溢出时也是「画出去」而不是出横向滚动条 ✓（用户明确不要滚动条 ✓）。 */
  .lw-nt-bar { display:flex; align-items:center; gap:4px; flex-wrap:nowrap; padding:6px 10px; border-bottom:1px solid ${T.lineDim}; position:relative; min-height:38px; background:var(--ed-chrome); }
  .lw-nt-bar button { height:26px; min-width:26px; padding:0 6px; border:1px solid ${T.lineDim}; background:transparent; flex:none; color:${T.text}; font:600 11px ${UI}; cursor:pointer; line-height:1; white-space:nowrap; }
  .lw-nt-bar button b { font-weight:600; margin-left:4px; }
  .lw-nt-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-nt-bar button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  /* 撤销/重做没有可退的步骤时明确置灰（别让人以为点了没反应） */
  .lw-nt-bar button:disabled { opacity:.35; cursor:default; }
  .lw-nt-bar button:disabled:hover { border-color:${T.lineDim}; color:${T.text}; }
  .lw-nt-bar .sp { flex:1; min-width:0; }
  .lw-nt-bar .st { font-size:10px; color:${T.faint}; flex:none; white-space:nowrap; }
  .lw-nt-bar .st.ok { color:${T.ok}; }
  .lw-nt-bar .st.bad { color:${T.red}; }
  /* 分组竖线 / 日期（日期从「独占一行」改成右侧小字 ✓ --pp-ink2 · 11px ✓）*/
  .lw-nt-bar .div { flex:none; width:1px; height:16px; background:${T.lineDim}; margin:0 1px; }
  .lw-nt-bar .dt { flex:none; font-size:11px; color:var(--pp-ink2); white-space:nowrap; }
  /* 「回收站」（原「删除」✓ 2026-10-30 改名）：宽屏给三个字，≤760px 交给下面那条
     容器查询换成 🗑 图标 ✓ —— 图标宽度 = 原来「删除」两个字那档的宽度 ✓，
     所以 1280 视口那一档（实测正好放满 ✓）不会因为改名多出 12px 而溢出 ✓。 */
  .lw-nt-bar #lw-memo-del .ico { display:none; font-style:normal; }
  .lw-nt-bar #lw-memo-del .lbl { white-space:nowrap; }
  /* 搬进来的 ❝ 提示框 / A ▮ 颜色高亮（原本吃的是 .milkdown .top-bar-item 那套尺寸 ✓）
     ⚠️ .codescope-color-group 在 app.css 里是 absolute + right/bottom ✓（贴 Crepe 顶栏右下角）
        —— 搬出来必须改回 static ✗，否则它会飘到我们这条栏的右上角去 ✓。 */
  .lw-nt-bar .chrome { display:flex; align-items:center; gap:2px; flex:none; }
  .lw-nt-bar .chrome > div { display:flex; align-items:center; gap:2px; position:static; right:auto; bottom:auto; margin:0; }
  .lw-nt-bar .chrome .top-bar-item { width:26px; height:26px; min-width:26px; margin:0; padding:0; position:static; display:flex; align-items:center; justify-content:center; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; cursor:pointer; }
  .lw-nt-bar .chrome .top-bar-item:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-nt-bar .chrome .top-bar-item svg { width:16px; height:16px; fill:currentColor; }
  .lw-nt-bar .codescope-callout-glyph, .lw-nt-bar .codescope-color-glyph { font-size:12px; }
  /* ⚠️⚠️ 2026-10-30 修「❝ 点了没反应」：**z-index 陷阱** ✗✗ ——
     菜单不是没渲染、也不是被塞在隐藏的顶栏子树里 ✓（实测：点完它就 hidden=false、
     display:grid、172×223 的矩形、body 的直接子节点 ✓）——
     问题在**层叠**：面板自己是 position:fixed + z-index:8800 ✓（全屏浮层 ✗），
     而 doc-theme.css 给 .codescope-callout-menu 的是 320 ✓ / app.css 给
     .codescope-color-menu 的是 260 ✓、.codescope-color-bar 是 265 ✓
     ⇒ 三个都**在面板下面** ✗，画是画了、用户看不见也点不到 ✓。
     判据（可复现）：document.elementFromPoint(菜单中心) 返回 DIV.milkdown ✗
     —— 说明那个点上最顶层的不是菜单 ✓。
     修法：面板开着时把这三层抬到面板之上、App 级抽屉（8900）/ 命令面板（9700）之下 ✓。
     ⚠️ 不直接改 doc-theme.css / app.css ✗（全站共用 ✓，改它们会动到阅读视图 / 主编辑区）；
        用 body.lw-panel-open 限定作用域 ✓（life-workbench.js 的 open / hide 两处加 / 删 ✓）——
        关掉面板后这三个浮层回到原来的层级 ✓。
     ⚠️ 用 (0,2,1) 特异性压过 app.css / doc-theme.css 的裸类 ✓（不靠加载顺序 ✓）。 */
  body.lw-panel-open > .codescope-callout-menu,
  body.lw-panel-open > .codescope-color-menu,
  body.lw-panel-open > .codescope-color-bar { z-index:8850; }
  /* 同一条坑里的 Crepe 自带浮层 ✓（都在 body 上 ✗，z-index 只有 180 上下 ✓）：
     选中文字后的快捷工具条 / 「/」斜杠菜单 / 块操作手柄 / 链接预览 ——
     面板一盖，它们和 ❝ 菜单是同一症状「点了没东西」✓。 */
  body.lw-panel-open > .milkdown-toolbar,
  body.lw-panel-open > .milkdown-slash-menu,
  body.lw-panel-open > .milkdown-block-handle,
  body.lw-panel-open > .milkdown-link-preview,
  body.lw-panel-open > .milkdown-link-edit,
  body.lw-panel-open > .milkdown-latex-inline-edit,
  body.lw-panel-open > .milkdown-ai-instruction { z-index:8840; }
  /* ══ 选中文字后弹的**两条浮动工具条**：生活面板里一律不弹 ✓✓（用户明确不要 ✗）══
     · 颜色条 .codescope-color-bar —— CodeScope 自己建的（src/reading-block-editor.js 的
       attachColorControls：**无条件**创建 + document.body.appendChild ✓，选中文字后由
       positionBar() 弹出 ✓，内容 = 10 个色块 + ▮ 高亮 + ⌫ 清除 ✓）。
     · .milkdown-toolbar —— Crepe 自带的选区工具条（B I S 行内代码 Σ 链接 ✓）。
     ⚠️ 为什么只能 CSS、不能用 option 关 ✗✗：读 src 的 create(options) 确认过，
        它**只认 root / markdown / topBar / onChange / onError** 这几个键 ✓ ——
        没有 selectionToolbar / colorBar / features 之类的开关 ✓，而 src 是禁改文件
        （阅读视图共用 ✗）。⇒ 隐藏 ✓，并且**只隐藏这两处容器里的** ✓：
        · body.lw-panel-open 只由 life-workbench 的 open/hide 加删 ✓（关掉面板就恢复 ✓）；
        · 后两条  :is(.lw-memo-ce,.lw-j-ce)  兜住「顶栏被搬走 / body 类没来得及加」的时序 ✓。
     ⚠️ 阅读视图 / 主编辑区**一个字都没动** ✗：它们既不是 .lw-memo-ce/.lw-j-ce，
        也不会带上 lw-panel-open ✓ → 两处浮条照旧 ✓。
     ⚠️ 用 display:none（不是 visibility / opacity）✗：positionBar 会量 offsetWidth 定位 ✓，
        尺寸为 0 时它算出来的坐标无所谓 ✓（反正不显示 ✓），也不会盖住别的浮层 ✓。 */
  body.lw-panel-open > .codescope-color-bar, body.lw-panel-open > .milkdown-toolbar, :is(.lw-memo-ce,.lw-j-ce) .codescope-color-bar, :is(.lw-memo-ce,.lw-j-ce) .milkdown-toolbar { display:none !important; }
  /* 日记那条栏多出来的三样：分类下拉 / 模板按钮 / 自动套用 */
  .lw-nt-bar select { height:26px; max-width:110px; padding:0 4px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:600 11px ${UI}; flex:none; outline:none; }
  .lw-nt-bar .autotpl { display:flex; align-items:center; gap:4px; flex:none; font-size:10.5px; color:${T.faint}; cursor:pointer; white-space:nowrap; }
  .lw-nt-bar .autotpl input { accent-color:${T.accent}; margin:0; }
  .lw-nt-bar .autotpl i { font-style:normal; }
  /* 日期两版：宽屏带年份、窄屏省年份 ✓（只有 .dt-full / .dt-mini 两个 b 切换）*/
  .lw-nt-bar .dt b { font-weight:400; }
  .lw-nt-bar .dt .dt-mini { display:none; }
  /* ══ 容器查询：编辑区窄到放不下时，把**低频**动作收进 ⋯ 更多 ✓
     ⚠️ 为什么用容器查询而不是媒体查询 ✗：编辑区宽度不跟视口成正比 ✓
        （左右两栏都能拖宽 ✓），媒体查询会在「栏拖窄了、视口还很宽」时判断错 ✓。
     ⚠️ 阈值和「收哪几个」都是**实测**出来的 ✓（不是拍脑袋 ✗）：
        · 1600 视口 → 编辑区 975px：全部 26 个控件一行放得下 ✓（实测 scrollW = clientW ✓）；
        · 1280 视口 → 编辑区只有 570px：本规则把这 6 个收进「⋯ 更多」✓ + 按钮改紧凑 ✓
          + 日期换成省年份版 ✓（1280 实测 scrollW = clientW ✓，见测试记录 ✓）。
     ⚠️ 收起来的每一个都**同时**在「⋯ 更多」里有一项 ✓（不收进去就等于点了没入口 ✗）。
     ⚠️ 日记那条栏另有取舍 ✓：模板按钮（.tpl）**不能收** ✗ —— 它是日记唯一插模板的入口，
        没有「更多」里的替代项，收了就彻底点不到 ✓。 */
  .lw-nt-edit, .lw-jr-edit { container-type: inline-size; }
  @container (max-width: 760px) {
    .lw-nt-bar { gap:2px; padding:5px 6px; }
    .lw-nt-bar button { height:24px; min-width:22px; padding:0 3px; font-size:10.5px; }
    .lw-nt-bar .chrome { gap:1px; }
    .lw-nt-bar .chrome .top-bar-item { width:24px; height:24px; min-width:24px; margin:0; }
    .lw-nt-bar .div { margin:0; }
    .lw-nt-bar .st { font-size:9.5px; }
    .lw-nt-bar [data-lfmt="strikethrough"], .lw-nt-bar [data-lfmt="quote"],
    .lw-nt-bar [data-lfmt="table"], .lw-nt-bar [data-lfmt="code-block"],
    .lw-nt-bar [data-lfmt="image"], .lw-nt-bar [data-mpin],
    .lw-nt-bar .dt-full { display:none; }
    .lw-nt-bar .dt .dt-mini { display:inline; }
    .lw-nt-bar button b { display:none; }
    /* 「回收站」三个字在这一档换成 🗑 —— 宽度回到改名前的量级 ✓（理由见上面那条注释）*/
    .lw-nt-bar #lw-memo-del .lbl { display:none; }
    .lw-nt-bar #lw-memo-del .ico { display:inline; }
  }
  @container (max-width: 420px) {
    .lw-nt-bar .chrome { display:none; }
    .lw-nt-bar .dt { display:none; }
  }
  /* ══ 藏掉 Crepe 自带顶栏 ✓（用户原话：「与面板自己的按钮重复，很扎眼」）══
     ⚠️ 为什么是**藏**、而不是 create({ topBar:false }) ✗✗ —— 读源码确认过：
        controller 只暴露 { getMarkdown, focus, destroy }（src/reading-block-editor.js:1025 ✓），
        crepe / commandsCtx 全关在 create() 的闭包里 ✗，而 src 是禁改文件（阅读视图共用 ✗）。
        而**顶栏那排按钮本身就是命令入口** ✓（onPointerdown → commandsCtx.call ✓）——
        留着它、只把它藏起来，格式动作才能真正「用 Crepe 自己的命令」✓（见 life-editor.js 的 exec）。
     ⚠️ CodeScope 自己插进顶栏的两组（❝ 提示框 / A ▮ 颜色高亮）在挂载后由 life-editor 的
        adopt 搬进我们的工具栏 ✓ —— 所以整条藏掉不会丢功能 ✓。
     ⚠️ 只作用于生活面板这两个容器 ✓（阅读视图与主编辑区共用同一份内核 ✗，不能误伤 ✓）。 */
  :is(.lw-memo-ce, .lw-j-ce) .milkdown-top-bar { display:none !important; }
  /* 格式菜单（浮层） */
  .lw-nt-menu { position:absolute; z-index:60; width:186px; background:var(--pp-sheet2); border:1px solid ${T.line}; box-shadow:var(--pp-shadow-float); }
  .lw-nt-menu .r { display:flex; gap:4px; padding:9px 10px; border-bottom:1px solid ${T.lineDim}; }
  .lw-nt-menu .r button { width:28px; height:26px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font-size:12px; cursor:pointer; }
  .lw-nt-menu .r button:hover { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-nt-menu .mi { padding:7px 12px; font-size:12px; color:${T.text}; cursor:pointer; display:flex; align-items:center; gap:8px; }
  .lw-nt-menu .mi:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-nt-menu .mi.on::before { content:"✓"; font-size:11px; }
  .lw-nt-menu .sep { height:1px; background:${T.lineDim}; margin:4px 0; }
  /* 工具栏里的浮层（更多 / Aa）：挂在**栏内** ✓ —— 这样 --pp-* 主题变量才解析得到 ✓
     （挂到 body 上就没有这些变量了 ✗，浮层会变成透明底 ✓）。 */
  .lw-nt-menu.lw-pop { position:absolute; }
  /* 不在这里 overflow:auto —— 正文是 .lw-ce，它自己滚 ✓（两层都滚会互相打架 ✗）*/
  .lw-nt-body { flex:1; display:flex; flex-direction:column; min-height:0; background:var(--ed-paper); }
  /* ══ 标题大纲（编辑器左侧那一栏 · 2026-10-31）══════════════════════════════
     ★ 视觉语言照 Phycat 侧栏那一套 ✓（和 .lw-nt-side / .lw-nt-list 一致）：
       底色 --pp-page、右侧一条 --pp-line 分线、当前项 = 2px 强调色竖条 + 10% accent 底 ✓。
     ★ 为什么包一层 .lw-nt-main / .lw-jr-row ✗：大纲要在**工具栏之下、正文之左** ✓，
       而 .lw-nt-body 是纵向 flex（标题 + 正文）✗、.lw-ce 自己 flex:1 ✓ ——
       所以外面套一个**横排**容器，正文那一块**一个字都没改** ✓（还是原来的 flex:1）。
     ⚠️ 默认 display:none ✓ —— 一开就从 570 掉到 382（1280 实测 ✓），不能默认占着 ✗；
        收起时**不留空条** ✓（空笔记的「还没有标题」只在展开后显示 ✓）。
     ═══════════════════════════════════════════════════════════════════════ */
  .lw-nt-main { flex:1; min-height:0; display:flex; }
  .lw-nt-main > .lw-nt-body { min-width:0; }
  .lw-jr-row { flex:1; min-height:0; display:flex; }
  .lw-jr-main { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
  .lw-outl { position:relative; display:none; flex:none; width:188px; min-width:0; flex-direction:column; background:var(--pp-page); border-right:1px solid ${T.lineDim}; }
  .lw-outl.on { display:flex; }
  .lw-outl-hd { display:flex; align-items:center; gap:6px; padding:9px 8px 7px 10px; border-bottom:1px solid ${T.lineDim}; }
  .lw-outl-hd b { font-size:12px; font-weight:600; letter-spacing:0; color:var(--pp-ink2); } .lw-outl-hd .sp { flex:1; }
  /* 头部关闭键：改成**幽灵图标**（无边框无底色，悬停才有底色）✓
     ⚠️ 为什么选择器要写到 .lw-outl .lw-outl-hd .lw-outl-x（0-3-0）✗✗：
       全站有 html[data-theme] button（0-1-1：1px 边框 + 渐变底 + 内高光 + 接触阴影），
       只写 .lw-outl-x（0-1-0）**从来没赢过** —— 用户截图里「每一项都是实心按钮」就是这个 ✓。
       :hover 那条全站是（0-3-2），所以这里必须再高一级到（0-4-0）才压得住 ✓。 */
  .lw-outl .lw-outl-hd .lw-outl-x { flex:none; width:20px; height:20px; min-height:20px; padding:0; border:0; border-radius:4px; background:transparent; box-shadow:none; transform:none; color:var(--pp-ink2); font:14px/1 ${UI}; cursor:pointer; transition:background-color .12s ease,color .12s ease; }
  .lw-outl .lw-outl-hd .lw-outl-x:hover { border:0; background:var(--pp-hover); box-shadow:none; transform:none; color:var(--pp-ink); }
  .lw-outl-list { flex:1; min-height:0; overflow:auto; padding:4px 6px 10px; }
  .lw-outl-empty { padding:10px 6px; font-size:11px; color:var(--pp-ink2); }
  /* 条目：**纯文本行**（无边框无底色，宽度一律 100% 右缘齐平）✓
     ★ 行高 22px / 字号 12px / 圆角 4px ✓；层级只靠**缩进（JS 写 padding-left）+ 字号**，
       不用颜色区分 ✓ —— 颜色只区分「当前项 / 悬停」✓。
     ⚠️⚠️ 这里所有选择器都必须写到 .lw-outl .lw-outl-list .lw-outl-i 这一级（0-3-0）✗✗：
       全站的 html[data-theme] button（0-1-1）会给每个 <button> 套 1px 边框 + 6px 圆角 +
       linear-gradient 底色 + 内高光阴影 + 悬停上浮 1px，正是用户说的「一堆实心按钮」✓。
       ⚠️ 所以一条 0-1-0 的 .lw-outl-i 根本没资格覆盖它 ✓。
       :hover / :active 全站是（0-3-2），所以状态规则写到（0-4-0）✓。
     ⚠️ min-height 必须**显式写 22px** ✗✗ —— app.css 里有一条全局的
        button { min-height:30px } ✓，不覆盖的话每一行都变成 30px（实测 ✓）。
     ⚠️ 底色一律用 background / background-color 声明 ✗ 不用 background-image：
        条目自己的 background-image 要留给引导线之外的东西吗？不用 —— 引导线画在 ::before 上 ✓。
     （本文件是模板字符串：注释里不写反引号 ✗）*/
  .lw-outl .lw-outl-list .lw-outl-i { position:relative; display:block; width:100%; min-width:0; height:22px; min-height:22px; line-height:22px; margin:0; padding:0 8px; padding-left:calc(8px + var(--ind,0px)); border:0; border-radius:4px; background:transparent; box-shadow:none; transform:none; color:var(--pp-ink2); font-family:${UI}; font-weight:400; font-size:12px; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; transition:background-color .12s ease,color .12s ease; }
  /* 层级：字号 12 / 11.5 / 11 / 10.5 / 10 / 10 ✓；同时把「这一级要画几条引导线」写进 --gw ✓
     （= 祖先层数 × 12px；最深一级不画自己的线，所以 lv6 只有 5 条 ✓）*/
  .lw-outl .lw-outl-list .lw-outl-i.lv1 { --gw:0px; font-size:12px; font-weight:600; }
  .lw-outl .lw-outl-list .lw-outl-i.lv2 { --gw:12px; font-size:11.5px; font-weight:500; }
  .lw-outl .lw-outl-list .lw-outl-i.lv3 { --gw:24px; font-size:11px; font-weight:400; }
  .lw-outl .lw-outl-list .lw-outl-i.lv4 { --gw:36px; font-size:10.5px; font-weight:400; }
  .lw-outl .lw-outl-list .lw-outl-i.lv5 { --gw:48px; font-size:10px; font-weight:400; }
  .lw-outl .lw-outl-list .lw-outl-i.lv6 { --gw:60px; font-size:10px; font-weight:400; }
  /* 层级引导线：一条 ::before 里用 12px 周期的重复渐变画出**这一级所有祖先的竖线** ✓
     —— 每条线 1px、颜色 color-mix(--pp-line 60%, transparent)，位置 6 / 18 / 30 / 42 / 54px ✓
     （left:6px 是缩进 8px 的上一级文字左缘再往左 2px，视觉上贴着祖先那一列 ✓）*/
  .lw-outl .lw-outl-list .lw-outl-i::before { content:''; position:absolute; left:6px; top:0; bottom:0; width:var(--gw,0px); pointer-events:none; background-repeat:no-repeat; background-image:repeating-linear-gradient(to right, color-mix(in srgb, var(--pp-line) 60%, transparent) 0 1px, transparent 1px 12px); }
  /* 悬停 / 按下：**极淡强调底 + 文字提亮，不加边框** ✓ */
  .lw-outl .lw-outl-list .lw-outl-i:hover, .lw-outl .lw-outl-list .lw-outl-i:active { border:0; background:color-mix(in srgb, var(--pp-accent) 6%, transparent); box-shadow:none; transform:none; color:var(--pp-ink); }
  /* 当前项：12% 强调底 + 左侧 2px 竖条 + 强调色文字 + 600 ✓（**不是实心深色块** ✗）
     ⚠️ 必须写在 .lv* / :hover **之后** ✗ —— 同为（0-4-0）靠后来者覆盖 ✓ */
  .lw-outl .lw-outl-list .lw-outl-i.cur { border:0; background:color-mix(in srgb, var(--pp-accent) 12%, transparent); box-shadow:none; transform:none; color:var(--pp-accent); font-weight:600; }
  .lw-outl .lw-outl-list .lw-outl-i.cur::after { content:''; position:absolute; left:0; top:4px; bottom:4px; width:2px; border-radius:1px; background:var(--pp-accent); pointer-events:none; }
  /* 条目里的图标与文本壳：**极简样式里必须完全隐形** ✓
     ⚠️ 图标 display:none（否则极简每行左侧多出 11px + gap ✗，观感就和定稿那版不一样了 ✓）；
        文本壳是裸 span（不加任何声明）✓ —— 这样极简那套的行盒、省略号、行高一个字都没变 ✓。 */
  .lw-outl .lw-outl-list .lw-outl-i .lw-outl-ic { display:none; }
  /* ★ 折叠箭头（极简样式）：默认这里也**显示** ✓ —— 用户报的「怎么没法折叠收起来」就是
     极简下箭头整个 display:none（只有胶囊才有 ▾ ✓），点了当然没反应 ✗。
     ★★ 2026-10-31 修「折叠箭头位置不对」（用户截图：箭头浮在胶囊右边缘之外、各层还错位）：
        原来这条是「top:0; height:22px; line-height:22px」✗ —— 绝对定位 + **写死 22px 高**，
        而实际行高是：极简 22px ✓、胶囊 lv3+ 30px ✓、胶囊 lv1/lv2 34px ✓。
        ⇒ 箭头盒**永远贴在行顶**：34px 胶囊里中心比行中心高 6px ✓、30px 行里高 4px ✓（改前实测），
          各层偏得还不一样 = 视觉上一条**歪斜的阶梯** ✓；
          再叠加 10px 圆角 —— 6px 上偏正好把 ▾ 送到**右上角的圆角弧上** ✓，
          弧外就是面板底色 → 看起来像「掉到胶囊外面」✓（= 用户截图那张 ✓）。
        ⇒ 现在 top:0 + bottom:0 + height:auto = **撑满整行**，行内 flex 垂直居中 ✓
          （transform-origin 居中 ✓；折叠态 rotate(-90deg) 与 120ms 过渡**原样保留** ✓）。
          不再写死行高：以后行高再变，它也自己跟着居中 ✓。
     ★ 右端定位：right:2px + width:14px ⇒ 箭头**中心**距行右边缘 = 2 + 7 = **9px** ✓
       （验收要 8~10px ✓）。取 9 不取 10 是给「整屏 0.88 缩放」这类场景留余量 ✓（rect 会带小数 ✓）。
     ★ 有子级的行右侧留 **22px** 内边距（箭头左缘在 16px 处 ✓）⇒ 文字盒右缘永远比箭头左缘
       再左 6px ✓，超出部分走省略号 ✓（极简的省略号是行级 text-overflow ✓）。
       ⚠️ 胶囊样式自己的 padding 会盖掉这条 ✗，所以那边两条 padding 里也写了 22px ✓。
     ⚠️ 选择器都写到（0-4-0）以上 ✓：全站 button（0-1-1）与本文件条目（0-3-0）都压不住它 ✓。 */
  .lw-outl .lw-outl-list .lw-outl-i.has-kid { padding-right:22px; }
  .lw-outl .lw-outl-list .lw-outl-i .lw-outl-ar { display:none; }
  .lw-outl .lw-outl-list .lw-outl-i.has-kid .lw-outl-ar { display:flex; position:absolute; right:2px; top:0; bottom:0; width:14px; height:auto; align-items:center; justify-content:center; line-height:1; transform-origin:center; text-align:center; font-size:10px; color:var(--pp-ink2); opacity:.55; cursor:pointer; transition:transform .12s ease,opacity .12s ease; }
  .lw-outl .lw-outl-list .lw-outl-i.has-kid .lw-outl-ar:hover { opacity:1; color:var(--pp-ink); }
  .lw-outl .lw-outl-list .lw-outl-i.folded .lw-outl-ar { transform:rotate(-90deg); }
  /* 折叠时本条文字降一档权重 ✓（任务要求：用 --pp-ink2 以示区别 ✓）*/
  .lw-outl .lw-outl-list .lw-outl-i.folded .lw-outl-tx { color:var(--pp-ink2); opacity:.7; }
  /* 被祖先折叠盖住的条目：**不占行高**地消失 ✓（验收按「可见条目数」数 ✓）*/
  .lw-outl .lw-outl-list .lw-outl-i.is-hidden { display:none; }
  /* ══ 大纲宽度：右侧拖动条（2026-10-31）══════════════════════════════════
     ★ 4px 热区**整条压在栏内**（right:0 ✓）：一开始写的 right:-2px（探出去 2px，更好抓）✗，
       实测 aside 自己的 scrollWidth 立刻从 187 变成 189 ✓（绝对定位的子元素溢出也算进
       scrollWidth ✓）→ 「拖到最窄也不许出现横向滚动条」那条当场就挂 ✓，所以收回框内 ✓。
       平时**全透明** ✓（不占视觉），悬停 / 拖动中才露出右缘那条 1px 强调色线 ✓。
     ★ touch-action:none 必须写 ✗ —— 触屏上不写的话，手指按下去会先被浏览器当成
       滚动手势抢走 ✓，pointermove 收不到 ✓（拖动这条栏在平板上等于没做 ✗）。
     ★ 选择器写到（0-3-0）✓：类 + 类 + 属性；它不是 <button>，本来就躲得开
       html[data-theme] button（0-1-1），但和本文件其余条目**同一规矩** ✓，不吃亏。 */
  .lw-outl .lw-outl-grip[data-outl-grip] { position:absolute; top:0; right:0; bottom:0; width:4px; z-index:3; cursor:col-resize; background:transparent; touch-action:none; }
  .lw-outl .lw-outl-grip[data-outl-grip]::after { content:''; position:absolute; top:0; bottom:0; right:0; width:1px; background:transparent; transition:background-color .12s ease; }
  .lw-outl .lw-outl-grip[data-outl-grip]:hover::after, .lw-outl .lw-outl-grip[data-outl-grip].on::after { background:var(--pp-accent); }
  /* ══ 大纲第二种视觉：分支胶囊树（Phycat 文件侧栏 · 2026-10-31 重做）═══════════════
     ★ 只在 .lw-outl.pill 下生效 ✓（「⋯ 更多 → 大纲样式：极简 / 胶囊」，默认极简 ✓）——
       上面那套极简规则**一个字都没改** ✓，两种样式并存 ✓。
     ★ 这一版和上一版（已被否 ✗）的区别，正是用户点名的四条：
        ① 上一版**每一行都是胶囊** ✗ → 现在只有**分支级**（lv1/lv2）是胶囊 ✓，
           lv3 及更深是**无底色的文字行** ✓（+ 一枚灰色小文档图标 ✓，靠缩进 + 引导线 + 逐级变淡体现层级 ✓）；
        ② 上一版颜色**按层级轮转** ✗（lv1/lv4 同色、lv2/lv5 同色…）→ 现在按**分支**给 ✓：
           第 N 个 H1 取 7 色盘的第 N 色 ✓（JS 写 --bc + data-br ✓），
           该分支下的 H2 **继承同一个 --bc** ✓，lv3 及更深走中性色 + 淡分支色图标 ✓；
        ③ 上一版没有折叠箭头 ✗ → 现在**任何层级只要有子级**就在 DOM 里生成 ▾ ✓（点击折叠 ✓）；
        ④ 上一版子级也带底色和圆角 ✗ → 现在子级透明 ✓，不和父级抢视觉 ✓。
     ★ 数值来源：Phycat theme.css 的**源码规格**（父级抓的权威版 ✓，不是观感近似 ✓）——
         folder 行（theme.css:8514-8533）：圆角 10px / padding 6px 10px / 底色 92~95% 透明 ✓；
         file 行（theme.css:8597-8612）：圆角 8px / padding 5px 8px / **默认透明** / 文字 muted ✓；
         箭头（.collapse-icon）：靠右、16px 宽、颜色 muted、opacity .65 ✓；
         分组间距：Phycat 的 .nav-folder 是**真嵌套**（标题 + children 容器）✗，
         我们的是**扁平标题流** ✗ → 10px 只标在「每个分支的最后一条」上 ✓（JS 写 .br-end ✓），
         这样它只出现在分支之间、不会把 H1 和它自己的 H2 拆开 ✓。
     ★ 缩进：极简靠 padding-left（--ind × 12px ✓），胶囊必须靠 margin-left ✓ ——
         胶囊的内边距是规格写死的 6px 10px ✗，缩进只能给外距 ✓。
         胶囊的台阶是 **20px**（= --ind × 5/3 ✓，见 --pi）而不是 12px ✓：
         因为 folder 行多一个 12px 图标 + 6px 间距 ✓，用 12px 台阶的话
         H3 文字（32px）会跑到父级 H2 文字（44px）的**左边**，层级看着是反的 ✗；
         20px 台阶下 H3 文字 = 40 + 8 = 48px ✓，正好和父级 H2 的文字左缘对齐 ✓。
     ★ 引导线：沿用极简那条 ::before（一条伪元素、1px 竖线 ✓），但——
         · 位置改成**每一级自己的父级列** ✓：left 固定 -10px ✓（= 缩进台阶 20px 时
           父级图标左缘相对本条目的位置 ✓），所以 lv2 的线落在 10px、lv3 的线落在 30px ✓；
         · 宽度 1px（不再用 --gw 的多列渐变 ✓）—— 参考图里子级只有**一条**竖线 ✓；
         · 颜色 color-mix(--pp-line 55%, transparent) ✓（用户指定 ✓，比极简的 60% 淡一档 ✓）；
         · top/bottom 各探出 3px ✓ —— 相邻两行之间只有 1~2px 外边距 ✓，
           探出 3px 才能首尾相接、看起来是一条连续的线 ✓（不是每行一段 ✓）。
     ⚠️ 选择器一律（0-4-0）以上 ✓：极简的条目是（0-3-0）、:hover 是（0-4-0）、.cur 是（0-4-0）✓，
        这里每条都带 .pill（+1 类）→（0-5-0）/（0-6-0）✓，靠特异性赢，**不用 !important** ✓。
     ⚠️ 顺序也是规矩 ✗：:hover 写在条目之后、.cur 写在 :hover 之后 ✓（靠后来者覆盖 ✓）。
     ⚠️ overflow 必须放开 ✗✗ —— 极简的 ::before 画在条目**框内** ✓；胶囊的条目右移了 --pi，
        同一条线落到框**外面**（left 为负数 ✓），条目上原本有 overflow:hidden（为了省略号 ✗）
        → 线会被整条裁掉 ✓（上一版实测过 ✓）。所以这里 overflow:visible ✓，
        省略号交给 .lw-outl-tx（它自己 overflow:hidden ✓）。
     （本文件是模板字符串：注释里不写反引号 ✗）*/
  .lw-outl.pill .lw-outl-list .lw-outl-i { --pi:calc(var(--ind,0px) * 5 / 3); display:flex; align-items:center; gap:6px; width:calc(100% - var(--pi,0px)); min-width:0; height:30px; min-height:30px; margin:1px 0 1px var(--pi,0px); padding:5px 22px 5px 8px; border:0; border-radius:8px; background:transparent; box-shadow:none; transform:none; color:var(--pp-ink2); font-family:${UI}; font-weight:400; font-size:11px; text-align:left; white-space:nowrap; overflow:visible; text-overflow:clip; cursor:pointer; transition:background-color .16s ease,color .16s ease; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv1, .lw-outl.pill .lw-outl-list .lw-outl-i.lv2 { height:34px; min-height:34px; margin:2px 0 2px var(--pi,0px); padding:6px 22px 6px 10px; border-radius:10px; background:color-mix(in srgb, var(--bc, var(--pp-accent)) var(--pp-pill-bg, 8%), transparent); color:var(--pp-ink); font-weight:500; font-size:12px; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv3, .lw-outl.pill .lw-outl-list .lw-outl-i.lv4, .lw-outl.pill .lw-outl-list .lw-outl-i.lv5, .lw-outl.pill .lw-outl-list .lw-outl-i.lv6 { height:30px; min-height:30px; margin:1px 0 1px var(--pi,0px); padding:5px 22px 5px 8px; border-radius:8px; background:transparent; color:var(--pp-ink2); font-weight:400; font-size:11px; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.br-end { margin-bottom:10px; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv1 .lw-outl-ic, .lw-outl.pill .lw-outl-list .lw-outl-i.lv2 .lw-outl-ic { display:block; flex:none; width:12px; height:12px; color:var(--bc, var(--pp-accent)); fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  /* ★ 胶囊的箭头**只覆盖外观**（字号 / 颜色 / 透明度）✗ 不再自带 position / top / height / width / margin ✗✗
     —— 改前这里写的是「display:block; flex:0 0 16px; width:16px; margin-left:8px」✓，
        可**定位三件套（position/top/right/height）全留在基础规则里** ✓（0-5-0 那条），
        于是胶囊里箭头还是「贴行顶、高 22px」✗ → 34px 胶囊偏 6px、30px 行偏 4px ✓（改前实测）✓。
        现在定位与居中**只有一份**（基础规则 ✓），这里再想改也不会把它拆成两半 ✓。
     ⚠️ display 必须跟着写 flex ✗：这条（0-6-0）比基础规则（0-5-0）高 ✓，
        留 display:block 会把行内居中整条打回原形 ✗。 */
  .lw-outl.pill .lw-outl-list .lw-outl-i.has-kid .lw-outl-ar { display:flex; text-align:center; font-size:12px; line-height:1; color:var(--pp-ink2); opacity:.65; cursor:pointer; transition:transform .12s ease,opacity .12s ease; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.has-kid .lw-outl-ar:hover { opacity:1; color:var(--pp-ink); }
  /* 折叠：同一颗 ▾ 转 -90°（= ▸ ✓），120ms 过渡 ✓ —— 不换字符，状态只改一个 transform ✓ */
  .lw-outl.pill .lw-outl-list .lw-outl-i.folded .lw-outl-ar { transform:rotate(-90deg); }
  .lw-outl.pill .lw-outl-list .lw-outl-i.folded .lw-outl-tx { color:var(--pp-ink2); opacity:.72; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.is-hidden { display:none; }
  .lw-outl.pill .lw-outl-list .lw-outl-i .lw-outl-tx { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv1:hover, .lw-outl.pill .lw-outl-list .lw-outl-i.lv2:hover, .lw-outl.pill .lw-outl-list .lw-outl-i.lv1:active, .lw-outl.pill .lw-outl-list .lw-outl-i.lv2:active { background:color-mix(in srgb, var(--bc, var(--pp-accent)) 10%, transparent); color:var(--pp-ink); box-shadow:none; transform:none; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.cur, .lw-outl.pill .lw-outl-list .lw-outl-i.cur:hover, .lw-outl.pill .lw-outl-list .lw-outl-i.cur:active { background:color-mix(in srgb, var(--pp-accent) 12%, transparent); color:var(--pp-accent); font-weight:500; box-shadow:none; transform:none; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv3.cur, .lw-outl.pill .lw-outl-list .lw-outl-i.lv4.cur, .lw-outl.pill .lw-outl-list .lw-outl-i.lv5.cur, .lw-outl.pill .lw-outl-list .lw-outl-i.lv6.cur { background:transparent; color:var(--pp-ink); font-weight:500; }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv2::before, .lw-outl.pill .lw-outl-list .lw-outl-i.lv3::before, .lw-outl.pill .lw-outl-list .lw-outl-i.lv4::before, .lw-outl.pill .lw-outl-list .lw-outl-i.lv5::before, .lw-outl.pill .lw-outl-list .lw-outl-i.lv6::before { left:-10px; width:1px; top:-3px; bottom:-3px; background-repeat:no-repeat; background-image:none; background-color:color-mix(in srgb, var(--pp-line) 55%, transparent); }
  /* ══ 子级（lv3~lv6）：**有图标、有逐级递减**，但仍然无底色、无胶囊 ══════════════
     ★ 照 Phycat theme.css 的原则：「颜色只出现在标题行和图标里，展开内容保持通透」✓
       —— 所以 lv3+ 依旧**不上底色**（只有缩进 + 引导线）✓，我们补的是当初漏掉的那块：
       ① 图标：灰色小文档（i-file ✓），颜色 = 分支色 45% + ink2 55% ✓（淡淡透出分支色）；
       ② 尺寸随层级递减：11 / 10 / 9 / 8px ✓（lv1/lv2 的 12px 略小 ✓）；
       ③ 文字逐级变淡：ink2 → 88% → 78% → 70% ✓（最深一级仍是可读的次要文字 ✓，不是灰到看不见）。
     ⚠️ 层级色这几条是（0-5-0）✓、图标是（0-6-0）✓：前者写在 lv3~lv6 基础色（也是 0-5-0）之后 ✓，
        所以能覆盖它 ✓；而 .cur 那几条（0-6-0）虽然写在本段**之前**，
        但特异性比（0-5-0）高 ✓ —— 当前项照样被提亮成 --pp-ink ✓，不靠顺序 ✓。 */
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv3 { --isz:11px; color:var(--pp-ink2); }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv4 { --isz:10px; color:color-mix(in srgb, var(--pp-ink2) 88%, transparent); }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv5 { --isz:9px; color:color-mix(in srgb, var(--pp-ink2) 78%, transparent); }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv6 { --isz:8px; color:color-mix(in srgb, var(--pp-ink2) 70%, transparent); }
  .lw-outl.pill .lw-outl-list .lw-outl-i.lv3 .lw-outl-ic, .lw-outl.pill .lw-outl-list .lw-outl-i.lv4 .lw-outl-ic, .lw-outl.pill .lw-outl-list .lw-outl-i.lv5 .lw-outl-ic, .lw-outl.pill .lw-outl-list .lw-outl-i.lv6 .lw-outl-ic { display:block; flex:none; width:var(--isz,11px); height:var(--isz,11px); color:color-mix(in srgb, var(--bc, var(--pp-ink2)) 45%, var(--pp-ink2)); fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  /* ≡ 开关：默认不占宽度 ✓ —— 1280 那条栏实测**已放满**（再加 22px 溢出 11px ✗），
     所以只在编辑区够宽（容器 ≥861px）时才出现 ✓；窄屏走「⋯ 更多」/ ⌥⌘O ✓。 */
  .lw-nt-bar .lw-outl-tog { display:none; }
  .lw-nt-bar .lw-outl-tog.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  @container (min-width: 861px) { .lw-nt-bar .lw-outl-tog { display:inline-flex; align-items:center; justify-content:center; } }
  .lw-nt-meta { padding:12px 20px 0; font-size:11px; color:${T.faint}; text-align:center; }
  .lw-nt-title { border:0; background:transparent; color:${T.text}; font:700 18px ${UI}; padding:6px 20px 4px; outline:none; }
  .lw-nt-title::placeholder { color:${T.faint}; }
  /* 正文默认就是可编辑的（不再需要双击 ✗）；编辑区样式见 .lw-ce / .lw-memo-ce */
  /* 格式条：**横排放在工具栏下面**（不再用浮层 ✗）*/
  .lw-nt-fmt { display:flex; align-items:center; gap:5px; padding:7px 12px; border-bottom:1px solid ${T.lineDim}; background:var(--pp-sheet2); flex-wrap:wrap; }
  .lw-nt-fmt .div { width:1px; height:18px; background:${T.lineDim}; margin:0 4px; }
  .lw-nt-fmt button { height:26px; min-width:28px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:600 10.5px ${UI}; cursor:pointer; white-space:nowrap; }
  .lw-nt-fmt button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-nt-fmt button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-nt-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:${T.faint}; font-size:12px; gap:8px; }
  .lw-nt-empty .big { font-size:26px; opacity:.5; }
  /* ── Markdown 渲染：提高区分度（标题/引用/代码/列表/表格/标签 各有明显形态）── */
  .lw-md2 { font-size:13px; line-height:1.85; color:var(--pp-ink); }
  /* 标题：大 + 左侧黄条 */
  .lw-md2 h1, .lw-md2 h2, .lw-md2 h3 { color:var(--pp-ink); font-weight:700; margin:16px 0 8px; padding-left:10px; border-left:2px solid ${T.accent}; line-height:1.35; }
  .lw-md2 h1 { font-size:21px; letter-spacing:-.3px; }
  .lw-md2 h2 { font-size:17px; }
  .lw-md2 h3 { font-size:14.5px; color:${T.accent}; border-left-color:${T.lineDim}; }
  .lw-md2 > h1:first-child, .lw-md2 > h2:first-child { margin-top:2px; }
  .lw-md2 p { margin:8px 0; }
  /* 引用：整块底色 + 左条 */
  .lw-md2 blockquote { margin:10px 0; padding:8px 13px; background:color-mix(in srgb, var(--pp-accent) 6%, transparent); border-left:2px solid ${T.accent}; color:var(--pp-ink2); font-style:italic; }
  .lw-md2 blockquote p { margin:3px 0; }
  /* 行内码 / 代码块 */
  .lw-md2 code { background:var(--pp-sheet2); border:1px solid ${T.lineDim}; padding:1px 6px; font-family:${MONO}; font-size:11.5px; color:${T.accent}; }
  .lw-md2 pre { background:var(--pp-sheet2); border:1px solid ${T.lineDim}; border-left:2px solid ${T.accent}; padding:11px 13px; overflow:auto; margin:10px 0; }
  .lw-md2 pre code { background:transparent; border:0; padding:0; color:var(--pp-ink); }
  /* 列表：黄色圆点 + 缩进 */
  .lw-md2 ul, .lw-md2 ol { margin:9px 0; padding-left:8px; list-style:none; }
  .lw-md2 li { margin:5px 0; padding-left:17px; position:relative; }
  .lw-md2 ul > li::before { content:""; position:absolute; left:3px; top:9px; width:5px; height:5px; background:${T.accent}; }
  .lw-md2 ol { counter-reset:mdol; }
  .lw-md2 ol > li::before { counter-increment:mdol; content:counter(mdol) "."; position:absolute; left:0; top:0; color:${T.accent}; font-size:11.5px; font-weight:700; }
  /* 复选框清单 */
  .lw-md2 li.mdck { list-style:none; }
  .lw-md2 li.mdck::before { content:"☐"; left:1px; top:0; width:auto; height:auto; background:none; color:${T.dim}; font-size:12px; }
  .lw-md2 li.mdck.done::before { content:"☑"; color:${T.ok}; }
  .lw-md2 li.mdck.done { color:${T.faint}; text-decoration:line-through; }
  /* 表格 */
  .lw-md2 table { border-collapse:collapse; margin:11px 0; font-size:12px; width:100%; }
  .lw-md2 th, .lw-md2 td { border:1px solid ${T.lineDim}; padding:6px 10px; text-align:left; }
  .lw-md2 th { background:var(--pp-sheet2); color:${T.accent}; font-weight:700; }
  .lw-md2 tr:nth-child(even) td { background:color-mix(in srgb, var(--pp-ink) 1%, transparent); }
  /* 链接 / 标签 / 强调 */
  .lw-md2 a { color:${T.accent}; text-decoration:underline; text-underline-offset:2px; }
  .lw-md2 strong { color:var(--pp-ink); font-weight:700; background:color-mix(in srgb, var(--pp-accent) 10%, transparent); padding:0 2px; }
  .lw-md2 em { color:var(--pp-ink); }
  .lw-md2 del { color:${T.faint}; }
  .lw-md2 .tag { color:${T.accent}; background:color-mix(in srgb, var(--pp-accent) 14%, transparent); border:1px solid color-mix(in srgb, var(--pp-accent) 30%, transparent); padding:1px 7px; font-size:11.5px; }
  .lw-md2 hr { border:0; border-top:1px dashed ${T.lineDim}; margin:16px 0; }
  /* 正文：整篇一个 contenteditable，逐行实时渲染（见 .lw-ce）
     —— 原来这里是「左编辑 / 右预览」的可拖分栏，已按需求改成和日记一致 ✓。 */
  /* 右键菜单 */
  .lw-ctx { position:fixed; z-index:9600; min-width:150px; background:var(--pp-sheet2); border:1px solid ${T.line}; box-shadow:var(--pp-shadow-float); padding:4px 0; }
  .lw-ctx .mi { padding:8px 14px; font-size:12px; color:${T.text}; cursor:pointer; display:flex; align-items:center; gap:9px; }
  .lw-ctx .mi:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-ctx .mi.danger { color:${T.red}; }
  .lw-ctx .mi.danger:hover { background:${T.red}; color:var(--pp-on-accent); }
  .lw-ctx .sep { height:1px; background:${T.lineDim}; margin:4px 0; }
  /* ── 书签：好词好句（衬线字体 + 卡片墙 + 引号装饰）── */
  .lw-bk-hero { border:1px solid ${T.line}; background:var(--pp-page); padding:22px 26px; position:relative; margin-bottom:14px; }
  .lw-bk-hero .q { font-family:"Songti SC","STSong",Georgia,"Times New Roman",serif; font-size:22px; line-height:1.9; color:var(--pp-ink); letter-spacing:.5px; }
  .lw-bk-hero .q::before { content:"❝"; position:absolute; left:6px; top:2px; font-size:40px; color:${T.accent}; opacity:.28; }
  .lw-bk-hero .from { margin-top:14px; font-size:11.5px; color:${T.dim}; letter-spacing:.6px; display:flex; align-items:center; gap:10px; }
  .lw-bk-hero .from .sp { flex:1; }
  .lw-bk-hero .from button { height:26px; padding:0 11px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:600 10px ${UI}; letter-spacing:1px; cursor:pointer; }
  .lw-bk-hero .from button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-bk-write { display:flex; gap:10px; border:1px solid ${T.lineDim}; background:var(--pp-page); padding:12px 14px; margin-bottom:14px; }
  .lw-bk-write .col { flex:1; display:flex; flex-direction:column; gap:8px; min-width:0; }
  .lw-bk-write input, .lw-bk-write textarea { width:100%; border:0; border-bottom:1px solid ${T.lineDim}; background:transparent; color:${T.text}; outline:none; }
  .lw-bk-write textarea { font-family:"Songti SC","STSong",Georgia,serif; font-size:15px; line-height:1.8; min-height:56px; resize:vertical; }
  .lw-bk-write input { font:11.5px ${UI}; padding:4px 0; }
  .lw-bk-write input::placeholder, .lw-bk-write textarea::placeholder { color:${T.faint}; }
  .lw-bk-write button { align-self:flex-end; height:30px; padding:0 15px; border:1px solid ${T.accent}; background:${T.accent}; color:${T.accentInk}; font:700 10.5px ${UI};  cursor:pointer; }
  /* 卡片墙 */
  .lw-bk-wall { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; }
  .lw-bk-card { border:1px solid ${T.lineDim}; background:var(--pp-page); padding:15px 16px 12px; position:relative; display:flex; flex-direction:column; min-height:132px; }
  .lw-bk-card:hover { border-color:${T.accent}; }
  .lw-bk-card.pin { border-left:4px solid ${T.accent}; }
  .lw-bk-card .txt { font-family:"Songti SC","STSong",Georgia,"Times New Roman",serif; font-size:14px; line-height:1.85; color:var(--pp-ink); flex:1; word-break:break-word; }
  .lw-bk-card .txt::first-letter { }
  .lw-bk-card .src { margin-top:11px; font-size:10.5px; color:${T.faint}; letter-spacing:.4px; display:flex; align-items:center; gap:8px; }
  .lw-bk-card .src .sp { flex:1; }
  .lw-bk-card .src .tg { color:${T.accent}; }
  .lw-bk-card .ops { position:absolute; right:8px; top:8px; display:flex; gap:4px; opacity:0; }
  .lw-bk-card:hover .ops { opacity:1; }
  .lw-bk-card .ops button { width:20px; height:20px; border:1px solid ${T.lineDim}; background:var(--pp-page); color:${T.dim}; font-size:10px; cursor:pointer; line-height:1; }
  .lw-bk-card .ops button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-bk-card .ops button.del:hover { border-color:${T.red}; color:${T.red}; }
  .lw-bk-day { padding:5px 2px 0; font-size:10.5px; color:${T.faint};  }
  /* ── 日记：月历 + 当天编辑 ── */
  /* ── 日记：可拖拽的左右分栏（填满高度，自适应窗口 ✓）── */
  /* ⚠️ 高度同 ：**不写魔数** ✗，由 .lw-main.fill > .lw-jr { flex:1 } 撑满 ✓ */
  .lw-jr { display:flex; min-height:320px; }
  .lw-jr-l { flex:none; display:flex; flex-direction:column; min-width:220px; overflow:auto; padding-right:2px; }
  .lw-jr-r { flex:1; min-width:280px; display:flex; flex-direction:column; overflow:hidden; }
  /* 拖拽条（左右拉）*/
  .lw-jr-grip { flex:none; width:6px; cursor:col-resize; background:transparent; position:relative; }
  .lw-jr-grip::after { content:""; position:absolute; left:2px; top:0; bottom:0; width:2px; background:${T.lineDim}; }
  .lw-jr-grip:hover::after, .lw-jr-grip.on::after { background:${T.accent}; }
  /* 左栏内部：每个面板可单独拖高 ✓ */
  .lw-jr-l .lw-c { flex:none; display:flex; flex-direction:column; overflow:hidden; }
  .lw-jr-l .lw-c > .lw-cbd { flex:1; min-height:0; overflow:auto; }
  .lw-vgrip { flex:none; height:7px; cursor:row-resize; position:relative; }
  .lw-vgrip::after { content:""; position:absolute; top:3px; left:12px; right:12px; height:1px; background:${T.lineDim}; transition:background .12s; }
  .lw-vgrip:hover::after, .lw-vgrip.on::after { background:${T.accent}; height:2px; top:2px; }
  /* 分类管理 */
  .lw-cats { padding:8px 10px 10px; }
  .lw-cats .row { display:flex; align-items:center; gap:7px; padding:6px 8px; font-size:11.5px; color:${T.text}; cursor:pointer; border:1px solid transparent; }
  .lw-cats .row:hover { background:var(--pp-sheet2); border-color:${T.lineDim}; }
  .lw-cats .row.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; font-weight:700; }
  .lw-cats .row .n { margin-left:auto; font-size:10px; opacity:.7; }
  .lw-cats .row .del { opacity:0; font-size:11px; padding:0 3px; }
  .lw-cats .row:hover .del { opacity:1; }
  .lw-cats .row .del:hover { color:${T.red}; }
  .lw-cats .add { display:flex; gap:6px; margin-top:8px; }
  .lw-cats .add input { flex:1; min-width:0; height:26px; padding:0 8px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11px ${UI}; outline:none; }
  .lw-cats .add input:focus { border-color:${T.accent}; }
  .lw-cats .add button { height:26px; padding:0 10px; border:1px solid ${T.accent}; background:${T.accent}; color:${T.accentInk}; font:700 10px ${UI}; cursor:pointer; }
  /* 右侧上下分：编辑 + 信息，中间也可拖 */
  .lw-jr-r .lw-jr-edit { flex:none; display:flex; flex-direction:column; overflow:hidden; }
  .lw-jr-hgrip { flex:none; height:6px; cursor:row-resize; position:relative; }
  .lw-jr-hgrip::after { content:""; position:absolute; top:2px; left:0; right:0; height:2px; background:${T.lineDim}; }
  .lw-jr-hgrip:hover::after, .lw-jr-hgrip.on::after { background:${T.accent}; }
  .lw-jr-info { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:12px; padding:12px 14px; }
  .lw-jr .lw-live { flex:1; min-height:120px; display:flex; flex-direction:column; }
  .lw-jr .lw-live-bd { flex:1; overflow:auto; }
  /* 日历占满左栏 */
  .lw-jr .lw-cal-d { height:30px; font-size:12px; }
  .lw-cal-hd { display:flex; align-items:center; gap:9px; padding:10px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-cal-hd .m { font-size:13px; font-weight:700; color:${T.text}; letter-spacing:.6px; }
  .lw-cal-hd .sp { flex:1; }
  .lw-cal-hd button { height:24px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:600 10.5px ${UI}; cursor:pointer; }
  .lw-cal-hd button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-cal { padding:8px 10px 10px; }
  .lw-cal-wk { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:3px; }
  .lw-cal-wk span { text-align:center; font-size:9.5px; color:${T.faint}; letter-spacing:.6px; }
  .lw-cal-g { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
  /* ⚠️ 以前用 aspect-ratio:1 ✗ → 日历特别高、下面大片空白 ✗。改成固定矮高度 ✓ */
  .lw-cal-d { height:26px; display:flex; align-items:center; justify-content:center; border:1px solid transparent; font-size:11.5px; color:${T.dim}; cursor:pointer; position:relative; }
  .lw-cal-d:hover { border-color:${T.lineDim}; color:${T.text}; }
  .lw-cal-d.out { color:var(--pp-line); cursor:default; }
  .lw-cal-d.out:hover { border-color:transparent; }
  .lw-cal-d.has { color:${T.text}; font-weight:700; }
  .lw-cal-d.has::after { content:""; position:absolute; bottom:2px; width:3px; height:3px; background:${T.accent}; }
  .lw-cal-d.today { border-color:${T.lineDim}; }
  .lw-cal-d.sel { background:${T.accent}; color:${T.accentInk}; font-weight:700; border-color:${T.accent}; }
  .lw-cal-d.sel::after { background:${T.accentInk}; }
  .lw-jday-hd { padding:12px 16px 4px; font-size:12px; color:${T.dim}; letter-spacing:.5px; }
  .lw-jday-hd b { color:${T.accent}; font-weight:700; }
  /* ── 日记：contenteditable 实时渲染（Obsidian / Typora 的做法）──
     ★ 原理（这才是关键）：
       不是 overlay 叠层 ✗，而是**一个 contenteditable 容器，每行一个 div** ✓。
       · **光标所在行**：内容是**源码** + 可编辑 ✓ → 光标天然准确 ✓
       · **其他行**：内容是**渲染后的 HTML** + contenteditable=false ✓ → 真排版 ✓
       两者**不同时存在于同一行** ✓ → 那个"标记占位 vs 光标偏移"的死结自然解开 ✓✓
     （注意：写这个文件里的 CSS 注释时不要用反引号 / 美元花括号 —— CSS 是模板字符串，
       会被截断 ✗。这个坑踩过三次了 ✗。）*/
  .lw-ce { flex:1; min-height:0; overflow:auto; padding:10px 14px; outline:none; font:12.5px/1.9 ${UI}; color:${T.text}; cursor:text; }
  .lw-ce > .ln { min-height:1.9em; white-space:pre-wrap; word-break:break-word; }
  /* 当前行（源码）：给一点视觉提示 ✓，但不改字号 ✓ */
  .lw-ce > .ln.cur { background:color-mix(in srgb, var(--pp-accent) 5%, transparent); box-shadow:inset 2px 0 0 color-mix(in srgb, var(--pp-accent) 55%, transparent); }
  /* 渲染行 */
  .lw-ce > .ln.r-h1 { font-size:18px; font-weight:700; color:var(--pp-ink); padding-left:10px; border-left:2px solid ${T.accent}; line-height:1.5; margin:8px 0 4px; }
  .lw-ce > .ln.r-h2 { font-size:16px; font-weight:700; color:var(--pp-ink); padding-left:10px; border-left:2px solid ${T.accent}; line-height:1.5; margin:7px 0 3px; }
  .lw-ce > .ln.r-h3 { font-size:14px; font-weight:700; color:${T.accent}; padding-left:9px; border-left:1px solid color-mix(in srgb, var(--pp-accent) 45%, transparent); line-height:1.5; margin:6px 0 2px; }
  .lw-ce > .ln.r-quote { padding:6px 12px; background:color-mix(in srgb, var(--pp-accent) 6%, transparent); border-left:2px solid ${T.accent}; color:var(--pp-ink); font-style:italic; }
  .lw-ce > .ln.r-li { padding-left:6px; }
  .lw-ce > .ln.r-li .bullet { color:${T.accent}; font-weight:700; margin-right:6px; }
  .lw-ce > .ln.r-li .ckbox { color:${T.dim}; font-weight:700; margin-right:6px; }
  .lw-ce > .ln.r-li.done .ckbox { color:${T.ok}; }
  .lw-ce > .ln.r-li.done { color:${T.faint}; text-decoration:line-through; }
  .lw-ce > .ln.r-code { background:var(--pp-sheet2); border-left:2px solid ${T.accent}; padding:7px 11px; color:var(--pp-ink); font-family:${MONO}; font-size:11.5px; }
  .lw-ce > .ln.r-hr { color:${T.lineDim}; }
  .lw-ce b { color:var(--pp-ink); font-weight:700; }
  .lw-ce i { color:var(--pp-ink); font-style:italic; }
  .lw-ce s { color:${T.faint}; }
  .lw-ce code { background:var(--pp-sheet2); color:var(--pp-warn); padding:1px 5px; font-family:${MONO}; font-size:11.5px; }
  .lw-ce a { color:${T.accent}; text-decoration:underline; }
  .lw-ce .tag { color:var(--pp-warn); background:color-mix(in srgb, var(--pp-accent) 16%, transparent); padding:1px 5px; }
  .lw-ce .empty { color:${T.faint}; }
  /* ── 行号 ──────────────────────────────────────────────────────────────
     用 CSS 计数器做：**不往 DOM 里加任何元素** ✓，
     所以 readAll() / textContent 读回源码完全不受影响 ✓（伪元素不进 textContent ✓）。
     绝对定位放在左侧留白里：长行折行时数字不会跟着重复 ✓、折行文本也对齐在数字右边 ✓。
     ⚠️ 这段必须放在上面那些 .r-* 规则**之后**：它们各自带 padding-left（标题 10px、
        列表 6px、代码块 11px…），同优先级下写在后面才盖得住 —— 否则行号会被压在文字底下看不见 ✗
        （实测踩过：标题 / 列表 / 引用行的行号直接消失了）。
     ⚠️ **垂直对齐靠 --ln-lh 这个变量**（由 ceAlignLineNumbers() 在渲染后量出来写上去）：
        行号不能简单用 line-height:inherit ✗ —— 标题/代码块那些行的行高是**无单位**的
        （比如 1.5），无单位值会按**伪元素自己的 font-size（10px）**重算 ✗ →
        行号的行盒只有 15px、正文的行盒 27px，基线就对不上（标题行号明显偏高 ✗，实测踩过）。
        拿「该行的实际行高」在 CSS 里做不到，所以量出来塞进变量、让行号用它撑出等高的盒子，
        再用 flex 居中 ✓ —— 这样不同语法（标题/代码/引用/列表）都能对齐 ✓。 */
  .lw-ce { counter-reset: ln; }
  .lw-ce > .ln, .lw-ce > .ln.r-h1, .lw-ce > .ln.r-h2, .lw-ce > .ln.r-h3, .lw-ce > .ln.r-li, .lw-ce > .ln.r-quote, .lw-ce > .ln.r-code, .lw-ce > .ln.r-hr { position:relative; padding-left:34px; }
  .lw-ce > .ln::before { counter-increment: ln; content: counter(ln); /* ⚠️ left 要**减去该行的左边框宽度**：绝对定位的 left 是相对 padding box 的， 而 border-left 在 padding box 之外 ✗ → 不补偿的话，标题/引用/代码块（带 3px 左边框） 的行号会被整体右移 3px，和普通行对不齐（用户反馈的就是这个）。 --ln-bl 由 ceAlignLineNumbers() 量出来写上去 ✓。 */ position:absolute; left:calc(-1 * var(--ln-bl, 0px)); top:0; width:24px; height:var(--ln-lh, 23.75px); display:flex; align-items:center; justify-content:flex-end; color:${T.faint}; font-family:${MONO}; font-size:10px; line-height:1;
    user-select:none; -webkit-user-select:none; pointer-events:none; }
  /* 代码块 / 引用自带 padding-top，行号跟着往下挪同样的距离，别贴到框顶
     （7px / 6px 要和上面 .r-code / .r-quote 的 padding-top 一致，否则会差 1px ✗）*/
  .lw-ce > .ln.r-code::before { top:7px; }
  .lw-ce > .ln.r-quote::before { top:6px; }
  /* 备忘录也走同一套「逐行实时渲染」（和日记一致 ✓，不再是左右分栏 ✗）。
     正文空的时候给一句占位提示 —— 只有「唯一一行且是空行」时才显示 ✓。 */
  .lw-memo-ce { padding:2px 18px 20px; }
  .lw-memo-ce > .ln.cur:only-child { position:relative; }
  .lw-memo-ce > .ln.cur:only-child:has(> br:only-child)::after { content:'直接在这里写…（# 标题 / **粗体** / - [ ] 清单 / | 表格 | / #标签）'; position:absolute; left:0; top:0; color:${T.faint}; pointer-events:none;
  }
  /* ── 图片预览：点「图片」后编辑区切成「左编辑 / 右图片预览」两栏 ──
     注意这和之前被拆掉的 Markdown 分栏**不是一回事**：
     这里只是把导出结果先看一眼再下载 ✓（用户要求「先是预览效果，分栏」）。 */
  .lw-img-split { flex:1; display:flex; min-height:0; }
  .lw-img-split > .pane { min-width:0; display:flex; flex-direction:column; }
  .lw-img-split > .pane:first-child { flex:1 1 54%; }
  .lw-img-split > .pane.img { flex:1 1 46%; border-left:1px solid ${T.lineDim}; background:var(--pp-page); }
  .lw-img-split .panehd { flex:none; display:flex; align-items:center; gap:8px; padding:7px 12px; border-bottom:1px solid ${T.lineDim}; color:${T.faint}; font-size:9.5px;   }
  .lw-img-split .panehd .sp { flex:1; }
  .lw-img-split .panehd button { height:24px; padding:0 9px; font-size:11px; letter-spacing:0; text-transform:none; }
  .lw-img-size { font:10px ${MONO}; color:${T.dim}; letter-spacing:0; text-transform:none; }
  .lw-img-split .panebd { flex:1; overflow:auto; padding:12px; }
  .lw-img-split .panebd img { display:block; width:100%; height:auto; border:1px solid ${T.lineDim}; }
  .lw-img-hint { padding:26px 6px; color:${T.faint}; font-size:12px; text-align:center; }
  .lw-img-hint.err { color:${T.red}; }
  /* 工具栏（紧凑 ✓ 不换行 ✓）*/
  .lw-live-bar { display:flex; align-items:center; gap:7px; padding:6px 10px; flex:none; border-bottom:1px solid ${T.lineDim}; background:var(--pp-sheet2); font-size:10px; color:${T.faint}; letter-spacing:.4px; }
  .lw-live-bar .sp { flex:1; min-width:6px; }
  .lw-live-bar .brand { color:${T.accent}; font-weight:700; white-space:nowrap; }
  .lw-live-bar .hint { color:${T.faint}; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lw-live-bar button { height:22px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:600 10px ${UI}; cursor:pointer; white-space:nowrap; flex:none; }
  .lw-live-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-live-bar select { height:22px; padding:0 6px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:10px ${UI}; outline:none; flex:none; }
  .lw-live-bar select option { background:var(--pp-sheet); color:${T.text}; }
  .lw-jtpl { display:flex; align-items:center; gap:7px; padding:9px 14px; border-bottom:1px solid ${T.lineDim}; font-size:10.5px; color:${T.faint}; flex-wrap:wrap; }
  .lw-jtpl .sp { flex:1; }
  .lw-jtpl button { height:26px; padding:0 11px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:600 10.5px ${UI}; letter-spacing:.6px; cursor:pointer; }
  .lw-jtpl button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-jtpl button:active { background:${T.accent}; color:${T.accentInk}; }
  /* 日记 */
  .lw-jtext { width:100%; min-height:190px; resize:vertical; padding:12px 13px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:12.5px/1.8 ${UI}; outline:none; }
  .lw-jtext:focus { border-color:${T.accent}; }
  .lw-jlist { display:flex; flex-direction:column; max-height:420px; overflow:auto; }
  .lw-jrow { display:flex; gap:14px; padding:12px 14px; border-bottom:1px solid ${T.lineDim}; align-items:flex-start; }
  .lw-jrow:hover { background:var(--pp-sheet2); }
  .lw-jrow .del { opacity:0; cursor:pointer; color:${T.faint}; }
  .lw-jrow:hover .del { opacity:1; }
  .lw-jrow .del:hover { color:${T.red}; }
  .lw-jdate { flex:none; width:74px; text-align:right; }
  .lw-jdate b { display:block; font-size:14px; font-weight:700; color:${T.accent}; letter-spacing:.4px; }
  .lw-jdate span { font-size:9.5px; color:${T.faint}; letter-spacing:1px; }
  .lw-jbody { flex:1; min-width:0; font-size:12.5px; line-height:1.75; white-space:pre-wrap; word-break:break-word; }
  /* 论文检索 */
  .lw-search { display:flex; gap:9px; }
  .lw-search input { flex:1; min-width:0; height:36px; padding:0 12px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:12.5px ${UI}; outline:none; }
  .lw-search input:focus { border-color:${T.accent}; }
  .lw-kw { cursor:pointer; }
  .lw-kw:hover { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-plist { display:flex; flex-direction:column; max-height:620px; overflow:auto; }
  .lw-parow { padding:12px 14px; border-bottom:1px solid ${T.lineDim}; }
  .lw-parow:hover { background:var(--pp-sheet2); }
  .lw-parow .t { font-size:12.5px; font-weight:600; line-height:1.5; }
  .lw-parow .t a { color:${T.accent}; text-decoration:none; }
  .lw-parow .t a:hover { text-decoration:underline; }
  .lw-parow .m { font-size:10px; color:${T.faint}; margin-top:5px; letter-spacing:.4px; }
  .lw-parow .s { font-size:11.5px; color:${T.dim}; line-height:1.7; margin-top:6px; }
  /* 邮箱表单 */
  .lw-form { display:flex; flex-direction:column; gap:9px; }
  .lw-form label { display:flex; flex-direction:column; gap:4px; font-size:10px; color:${T.faint};  }
  .lw-form input { height:32px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:12px ${UI}; outline:none; letter-spacing:.4px; }
  .lw-form input:focus { border-color:${T.accent}; }
  /* 邮箱：按地址自动识别服务商后的提示条 */
  .lw-mail-hint { margin-top:9px; padding:7px 10px; border:1px solid color-mix(in srgb,${T.ok} 34%,transparent); border-radius:8px; background:color-mix(in srgb,${T.ok} 9%,transparent); color:${T.dim}; font-size:11px; line-height:1.6; }
  .lw-mail-hint b { color:${T.ok}; font-family:${MONO}; }
  /* 测试连接 / 发信的结果：成功绿、失败红，并把每一步列出来（方便定位卡在哪一步） */
  .lw-mail-result { margin-top:10px; font-size:11px; line-height:1.7; color:${T.dim}; }
  .lw-mail-result:empty { display:none; }
  .lw-mail-result .ok { color:${T.ok}; font-weight:650; }
  .lw-mail-result .err { color:${T.red}; font-weight:650; }
  .lw-mail-result .step { color:${T.faint}; font-family:${MONO}; font-size:10.5px; }
  .lw-mail-result ol { margin:4px 0 0 16px; padding:0; }
  /* 发信表单 */
  .lw-mail-send { margin-top:13px; padding-top:11px; border-top:1px dashed ${T.lineDim}; display:flex; flex-direction:column; gap:9px; }
  .lw-mail-send .hd { font-size:10px;   color:${T.faint}; }
  .lw-mail-send label { display:flex; flex-direction:column; gap:4px; font-size:10px; color:${T.faint};  }
  .lw-mail-send input, .lw-mail-send textarea { padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:12px ${UI}; outline:none; letter-spacing:.4px; }
  .lw-mail-send input { height:32px; }
  .lw-mail-send textarea { padding:8px 10px; resize:vertical; line-height:1.6; }
  .lw-mail-send input:focus, .lw-mail-send textarea:focus { border-color:${T.accent}; }
  #btn-lifework.on { background:var(--accent) !important; color:var(--bg) !important; }
  /* ── 邮箱：顶栏状态胶囊（和天气胶囊等高 ✓，见 .lw-wx 的注释）── */
  .lw-mb { display:flex; gap:9px; padding:0 12px; border:1px solid ${T.line}; flex:none; cursor:pointer; transition:background .12s; }
  .lw-mb:hover { background:${T.card2}; }
  .lw-mb .ic { font-size:15px; line-height:1; }
  .lw-mb .n { font-size:16px; font-weight:700; color:${T.dim}; font-family:${MONO}; line-height:1; }
  .lw-mb.has .n { color:${T.accent}; }
  .lw-mb .t { font-size:9.5px; color:${T.dim}; line-height:1.4; letter-spacing:.4px; max-width:190px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-mb.bad { border-color:color-mix(in srgb,${T.red} 46%,transparent); }
  .lw-mb.bad .t { color:${T.red}; }
  /* 收到新邮件时胶囊闪一下 ✓（只闪几秒，不一直动 ✓）*/
  .lw-mb.fresh { animation:lw-mail-flash 1s ease-in-out 3; }
  @keyframes lw-mail-flash { 0%,100% { background:transparent; border-color:${T.line}; }
    50% { background:${T.accent}; border-color:${T.accent}; }
  }
  @media (prefers-reduced-motion: reduce) { .lw-mb.fresh { animation:none; background:${T.card2}; } }
  /* ── 新邮件提醒的浮层 ✓ ──────────────────────────────────────────────
     放在 body 上（**不放在面板里** ✗）—— 面板关着的时候也要能提醒 ✓。
     z-index 9500：高于面板 8800 和右侧抽屉 8900，低于命令面板 9700 ✓。 */
  .lw-toast { position:fixed; right:22px; bottom:22px; z-index:9500; width:330px; display:flex; gap:11px; padding:12px 13px; background:${T.card}; border:1px solid ${T.accent};
    font-family:inherit; color:${T.text}; cursor:pointer; box-shadow:var(--pp-shadow-float);
    animation:lw-toast-in .18s ease-out; }
  @keyframes lw-toast-in { from { transform:translateY(10px); opacity:0; } to { transform:none; opacity:1; } }
  @media (prefers-reduced-motion: reduce) { .lw-toast { animation:none; } }
  .lw-toast .ic { font-size:17px; line-height:1.1; color:${T.accent}; flex:none; }
  .lw-toast .bd { flex:1; min-width:0; }
  .lw-toast .t1 { font-size:10px;   color:${T.accent}; }
  .lw-toast .t2 { font-size:11.5px; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-toast .t3 { font-size:11px; color:${T.dim}; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-toast .x { flex:none; width:20px; height:20px; border:0; background:transparent; color:${T.faint}; cursor:pointer; font-size:12px; padding:0; line-height:1; }
  .lw-toast .x:hover { color:${T.text}; }
  /* ── 邮箱：三栏 ─────────────────────────────────────────────────── */
  /* ⚠️ 高度由 .lw-main.fill > .lw-ml { flex:1 } 给 ✓（以前这里写 flex:1 是**无效**的 ✗ —— 父级是 block ✗）*/
  .lw-ml { display:flex; min-height:280px; }
  .lw-ml-side { width:196px; flex:none; border-right:1px solid ${T.line}; overflow:auto; padding:10px 0; }
  .lw-ml-list { width:330px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; }
  .lw-ml-read { flex:1; min-width:0; display:flex; flex-direction:column; }
  .lw-ml-hd { font-size:9px;   color:${T.faint}; padding:10px 12px 6px; }
  .lw-ml-acct { display:flex; align-items:center; gap:8px; padding:8px 12px; cursor:pointer; border-left:1px solid transparent; font-size:11.5px; }
  .lw-ml-acct:hover { background:${T.card2}; }
  .lw-ml-acct.on { background:${T.card2}; border-left-color:${T.accent}; }
  .lw-ml-acct .em { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-acct .cnt { font-family:${MONO}; font-size:10.5px; color:${T.dim}; }
  .lw-ml-acct .cnt.has { color:${T.accent}; font-weight:700; }
  .lw-ml-acct .err { font-size:9.5px; color:${T.red}; }
  .lw-ml-box { padding:6px 12px; cursor:pointer; font-size:11px; display:flex; gap:8px; align-items:center; border-left:1px solid transparent; color:${T.dim}; }
  .lw-ml-box:hover { background:${T.card2}; }
  .lw-ml-box.on { border-left-color:${T.accent}; color:${T.text}; background:${T.card2}; }
  .lw-ml-box .n { margin-left:auto; font-family:${MONO}; font-size:10px; }
  .lw-ml-item { padding:9px 12px; border-bottom:1px solid ${T.lineDim}; cursor:pointer; }
  .lw-ml-item:hover { background:${T.card2}; }
  .lw-ml-item.on { background:${T.card2}; border-left:2px solid ${T.accent}; padding-left:9px; }
  .lw-ml-item .r1 { display:flex; gap:8px; align-items:baseline; }
  .lw-ml-item .who { font-size:11px; color:${T.dim}; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-item .when { font-size:9.5px; color:${T.faint}; font-family:${MONO}; flex:none; }
  .lw-ml-item .subj { font-size:11.5px; color:${T.dim}; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-item.unread .who { color:${T.text}; }
  .lw-ml-item.unread .subj { color:${T.text}; font-weight:650; }
  .lw-ml-item.unread .r1::before { content:'●'; color:${T.accent}; font-size:8px; flex:none; }
  .lw-ml-tools { display:flex; gap:7px; align-items:center; padding:9px 11px; border-bottom:1px solid ${T.line}; flex:none; }
  /* ⚠️ 位置：**垂直居中** ✓（原来 align-items:flex-start + padding-top 8vh ✗ ——
     弹窗顶在页面上边、跟邮件面板没有关系，看着很怪 ✗，用户报过 ✓）。
     遮罩留一点内边距 ✓，弹窗最高 88vh、内部可滚 ✓，内容多了也不会顶出屏幕 ✗。 */
  .lw-mc-mask { position:fixed; inset:0; z-index:60; background:var(--pp-scrim); display:flex; align-items:center; justify-content:center; padding:24px 16px; overflow:auto; }
  .lw-mc { width:min(620px,100%); max-height:88vh; overflow:auto; background:${T.card}; border:1px solid ${T.line}; border-radius:8px;
    box-shadow:var(--pp-shadow-float); padding:14px 16px 16px; }
  .lw-mc .hd { display:flex; align-items:center; font:700 13px ${UI}; color:${T.text}; margin-bottom:10px; }
  .lw-mc .hd .sp { flex:1; }
  .lw-mc .hd button { border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; cursor:pointer; width:24px; height:24px; border-radius:8px; font-size:12px; }
  .lw-mc label { display:block; font:600 10px ${UI}; color:${T.dim}; margin-bottom:9px; letter-spacing:.5px; }
  .lw-mc input, .lw-mc select, .lw-mc textarea { display:block; width:100%; margin-top:4px; padding:7px 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11.5px ${UI};
    border-radius:8px; outline:none; }
  .lw-mc textarea { resize:vertical; line-height:1.7; }
  .lw-mc .ft { display:flex; gap:8px; align-items:center; margin-top:11px; }
  .lw-mc .ft .sp { flex:1; }
  .lw-mc .msg { font:11px ${UI}; }
  .lw-mc-empty { font-size:12px; line-height:1.9; color:${T.dim}; padding:6px 0 2px; }
  .lw-mc .two { display:flex; gap:10px; }
  .lw-mc .two label { flex:1; min-width:0; }
  /* 「附件」那行：左边标题、右边「选择文件」按钮 ✓ */
  .lw-mc label:has(#lw-mc-pick) { display:flex; align-items:center; gap:8px; }
  .lw-mc label:has(#lw-mc-pick) .sp { flex:1; }
  .lw-mc .mini { height:24px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:600 10px ${UI}; border-radius:8px; cursor:pointer; }
  .lw-mc .mini:hover { color:${T.text}; border-color:${T.accent}; }
  .lw-mc .atts { display:flex; flex-wrap:wrap; gap:6px; margin:-2px 0 10px; }
  .lw-mc .atts .none { font:10.5px ${UI}; color:${T.faint}; }
  .lw-mc .atts .att { display:inline-flex; align-items:center; gap:5px; padding:3px 6px; border:1px solid ${T.lineDim}; border-radius:8px; font:10.5px ${UI}; color:${T.text};
    max-width:100%; overflow:hidden; }
  .lw-mc .atts .att b { color:${T.faint}; font-weight:400; font-size:9.5px; }
  .lw-mc .atts .att i { cursor:pointer; color:${T.faint}; font-style:normal; padding:0 1px; }
  .lw-mc .atts .att i:hover { color:${T.red}; }
  .lw-ml-tools input { flex:1; height:28px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11px ${UI}; outline:none; min-width:0; }
  .lw-ml-tools button { height:28px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:600 9.5px ${UI}; letter-spacing:.8px;  cursor:pointer; flex:none; }
  .lw-ml-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-ml-tools button.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-ml-rhd { flex:none; padding:14px 18px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-ml-rhd .subj { font-size:15px; font-weight:650; line-height:1.4; word-break:break-word; }
  .lw-ml-rhd .meta { margin-top:9px; font-size:11px; color:${T.dim}; line-height:1.8; }
  .lw-ml-rhd .meta b { color:${T.text}; font-weight:600; }
  .lw-ml-rhd .acts { display:flex; gap:7px; margin-top:11px; flex-wrap:wrap; }
  .lw-ml-frame { flex:1; min-height:0; width:100%; border:0; background:var(--pp-sheet); }
  .lw-ml-body { flex:1; min-height:0; overflow:auto; padding:16px 18px; font-size:12.5px; line-height:1.85; white-space:pre-wrap; word-break:break-word; }
  .lw-ml-body a { color:${T.accent}; }
  .lw-ml-atts { flex:none; border-top:1px solid ${T.lineDim}; padding:11px 18px; display:flex; flex-direction:column; gap:7px; max-height:190px; overflow:auto; }
  .lw-ml-att { display:flex; align-items:center; gap:10px; font-size:11px; }
  .lw-ml-att .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-att .sz { color:${T.faint}; font-family:${MONO}; font-size:10px; }
  .lw-ml-empty { padding:34px 20px; text-align:center; color:${T.faint}; font-size:11.5px; line-height:2; }
  .lw-ml-more { padding:12px; text-align:center; font-size:11px; color:${T.accent}; cursor:pointer; border-top:1px dashed ${T.lineDim}; letter-spacing:.6px; }
  .lw-ml-more:hover { background:${T.card2}; }
  .lw-ml-item .star { color:${T.accent}; font-size:10px; flex:none; }
  /* ── 分类管理：文件夹行的「新建 / 删除 / 放置目标」+ 移动浮层 ── */
  .lw-ml-box .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-box .del { flex:none; margin-left:5px; padding:0 3px; color:${T.faint}; font-size:10px; visibility:hidden; }
  .lw-ml-box:hover .del { visibility:visible; }
  .lw-ml-box .del:hover { color:${T.red}; }
  .lw-ml-box.add { color:${T.faint}; }
  .lw-ml-box.add:hover { color:${T.accent}; }
  /* 拖邮件经过时的放置高亮 ✓（和备忘录一致 ✓）*/
  .lw-ml-box.drop { background:color-mix(in srgb,${T.ok} 18%,transparent); color:${T.text}; }
  .lw-ml-item.dragging { opacity:.45; }
  .lw-undo { color:${T.accent}; cursor:pointer; text-decoration:underline; margin-left:8px; }
  .lw-ml-pickwrap { position:fixed; inset:0; z-index:9500; background:var(--pp-scrim); display:flex; align-items:center; justify-content:center; }
  .lw-ml-pick { width:320px; max-height:70vh; overflow:auto; background:${T.card}; border:1px solid ${T.accent}; font-family:inherit; color:${T.text}; }
  .lw-ml-pick .hd { display:flex; align-items:center; padding:11px 13px; border-bottom:1px solid ${T.lineDim}; font-size:10px;   color:${T.accent}; }
  .lw-ml-pick .hd .x { margin-left:auto; cursor:pointer; color:${T.faint}; }
  .lw-ml-pick .hd .x:hover { color:${T.text}; }
  .lw-ml-pick .it { padding:9px 13px; font-size:12px; cursor:pointer; border-bottom:1px solid ${T.lineDim}; display:flex; align-items:center; gap:8px; }
  .lw-ml-pick .it:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-ml-pick .it.cur { color:${T.faint}; cursor:default; }
  .lw-ml-pick .it.cur:hover { background:transparent; color:${T.faint}; }
  .lw-ml-pick .it .tag { margin-left:auto; font-size:9.5px; }
  /* 对照翻译：左边**原样渲染整封邮件** ✓，右边列译文 ✓（见 mailReaderHtml 的注释）*/
  .lw-ml-trbar { flex:none; display:flex; align-items:center; gap:10px; padding:8px 18px; border-bottom:1px solid ${T.lineDim}; font-size:10px;
    color:${T.faint}; }
  .lw-ml-trbar .sp { flex:1; }
  /* ══════════════════════════════════════════════════════════════════════
     工作流模块（参考 n8n 的节点图）✓
     ⚠️ 注释里不能出现反引号 ✗（这段在 JS 模板字符串里 ✗）。
     ══════════════════════════════════════════════════════════════════════ */
  .lw-fl { display:flex; min-height:320px; border:1px solid ${T.lineDim}; background:${T.bg}; }
  .lw-fl-side { width:212px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; padding:10px 0; background:${T.bg}; }
  .lw-fl-cv { flex:1; min-width:0; position:relative; overflow:auto; background:${T.bg2}; background-image:radial-gradient(${T.lineDim} 1px, transparent 1px);
    background-size:18px 18px; }
  .lw-fl-cfg { width:302px; flex:none; border-left:1px solid ${T.lineDim}; overflow:auto; background:${T.card}; padding:0 0 16px; }
  .lw-fl-row { display:flex; align-items:center; gap:8px; padding:6px 12px; font-size:11px; cursor:pointer; color:${T.dim}; border-left:1px solid transparent; }
  .lw-fl-row:hover { background:${T.card2}; color:${T.text}; }
  .lw-fl-row.on { background:${T.card2}; color:${T.text}; border-left-color:${T.accent}; }
  .lw-fl-row .em { font-size:13px; line-height:1; }
  .lw-fl-row .n { margin-left:auto; font-size:9.5px; color:${T.faint}; }
  .lw-fl-pal { display:flex; align-items:center; gap:8px; padding:6px 12px; font-size:11px; cursor:grab; color:${T.dim}; }
  .lw-fl-pal:hover { background:${T.card2}; color:${T.accent}; }
  .lw-fl-pal .em { font-size:13px; line-height:1; }
  .lw-fl-tools { position:sticky; top:0; left:0; z-index:5; display:flex; gap:6px; align-items:center; padding:8px 10px; background:${T.card}; border-bottom:1px solid ${T.line};
    flex-wrap:wrap; }
  .lw-fl-tools button { height:26px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10px ${UI}; cursor:pointer; letter-spacing:.4px; }
  .lw-fl-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-fl-tools button.pri { border-color:${T.accent}; color:${T.accent}; }
  .lw-fl-tools button.pri:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-fl-tools .hint { font-size:9.5px; color:${T.faint}; margin-left:auto; }
  /* 「模型与密钥」面板 ✓（右栏 302px 宽 ✓，一家服务一张卡 ✓） */
  .lw-fl-prov { margin:0 14px 12px; padding:10px 10px 6px; border:1px solid ${T.lineDim}; border-radius:8px; background:${T.card2}; }
  .lw-fl-prov .hd { display:flex; align-items:center; gap:6px; margin-bottom:8px; font-size:11px; }
  .lw-fl-prov .hd b { font-size:11.5px; color:${T.text}; }
  .lw-fl-prov .hd .ok { font-size:9px; color:${T.ok}; }
  .lw-fl-prov .hd .no { font-size:9px; color:${T.warn}; }
  .lw-fl-prov .hd button { margin-left:auto; padding:2px 7px; font-size:10px; }
  .lw-fl-prov .hd button + button { margin-left:0; }
  /* 「网页版」面板里每个站点一行 ✓ */
  .lw-fl-web-row { display:flex; align-items:center; gap:8px; margin:0 14px 8px; padding:8px 10px; border:1px solid ${T.lineDim}; border-radius:8px; background:${T.card2}; }
  .lw-fl-web-row .nm { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .lw-fl-web-row .nm b { font-size:11.5px; color:${T.text}; }
  .lw-fl-web-row .nm .ok { font-size:9px; color:${T.ok}; }
  .lw-fl-web-row .nm .no { font-size:9px; color:${T.warn}; }
  .lw-fl-web-row button { margin-left:auto; padding:4px 9px; font-size:10.5px; flex:none; }
  .lw-fl-plane { position:relative; }
  .lw-fl-node { position:absolute; width:170px; height:56px; box-sizing:border-box; border:1px solid ${T.line}; background:${T.card}; cursor:move; user-select:none; }
  .lw-fl-node:hover { border-color:${T.accent}; }
  .lw-fl-node.on { border-color:${T.accent}; box-shadow:0 0 0 2px color-mix(in srgb, ${T.accent} 30%, transparent); }
  .lw-fl-node .hd { display:flex; align-items:center; gap:6px; padding:5px 8px 0; font-size:9px; letter-spacing:.8px; color:${T.faint};  }
  .lw-fl-node .bd { display:flex; align-items:center; gap:6px; padding:2px 8px 0; font-size:11.5px; color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-fl-node .bd .em { font-size:13px; line-height:1; flex:none; }
  .lw-fl-node .st { position:absolute; right:-2px; bottom:-9px; padding:1px 6px; font-size:9.5px; line-height:1.5; background:${T.bg}; border:1px solid ${T.lineDim};
    color:${T.dim}; white-space:nowrap; }
  /* ★★ 运行状态要**看得见** ✗✗ —— 用户原话：「执行，也没有执行到哪的显示」✓。
     原来那个「✓0ms」是 9px 的淡灰字 ✗、缩在节点右下角 ✗，等于没显示 ✗。
     → 改成**带边框的小徽章** ✓ + 整圈颜色跟着状态走 ✓。 */
  .lw-fl-node.s-ok { border-color:${T.ok}; }
  .lw-fl-node.s-ok .st { color:${T.ok}; border-color:${T.ok}; }
  .lw-fl-node.s-error { border-color:${T.red}; }
  .lw-fl-node.s-error .st { color:${T.red}; border-color:${T.red}; }
  .lw-fl-node.s-skipped { opacity:.45; }
  .lw-fl-node.s-disabled .st { color:${T.warn}; border-color:${T.warn}; }
  /* ★ 正在跑的那个：亮边 + 呼吸 ✓ —— 一眼看出「跑到哪了」✓（n8n 也是这个感觉 ✓）。 */
  .lw-fl-node.running { border-color:${T.accent}; box-shadow:0 0 0 2px color-mix(in srgb, ${T.accent} 45%, transparent);
    animation:lw-fl-run 1.1s ease-in-out infinite; }
  .lw-fl-node.running .st { color:${T.accent}; border-color:${T.accent}; }
  @keyframes lw-fl-run { 0%,100% { opacity:1 } 50% { opacity:.5 } }
  /* ★ 多选 / 禁用 / 便签 / 框选 ✓（对齐 n8n 的画布 ✓） */
  .lw-fl-node.picked { border-color:${T.ok}; box-shadow:0 0 0 2px color-mix(in srgb, ${T.ok} 35%, transparent); }
  .lw-fl-node.off { opacity:.5; border-style:dashed; }
  .lw-fl-node.sticky { border:1px solid ${T.warn}; background:color-mix(in srgb, ${T.warn} 12%, ${T.card}); cursor:move; z-index:0; }
  .lw-fl-node.sticky .sticky-hd { display:flex; align-items:center; gap:6px; padding:6px 9px 0; font-size:10px; letter-spacing:.8px; color:${T.warn}; }
  .lw-fl-node.sticky .sticky-hd .fid { margin-left:auto; color:${T.faint}; letter-spacing:0; }
  .lw-fl-node.sticky .sticky-bd { padding:6px 9px 0; font-size:11px; line-height:1.75; color:${T.dim}; white-space:pre-wrap; overflow:hidden; }
  .lw-fl-marquee { position:absolute; border:1px dashed ${T.accent}; background:color-mix(in srgb, ${T.accent} 12%, transparent); pointer-events:none; z-index:9; }
  /* 画布上的浮层工具条 ✓（撤销 / 复制 / 整理 都在这一条上 ✓） */
  .lw-fl-bar { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
  .lw-fl-bar .sep { width:1px; height:16px; background:${T.lineDim}; margin:0 3px; }
  .lw-fl-port { position:absolute; width:12px; height:12px; border:1px solid ${T.line}; background:${T.bg}; border-radius:50%; top:22px; cursor:crosshair; z-index:3; }
  .lw-fl-port:hover { background:${T.accent}; border-color:${T.accent}; }
  .lw-fl-port.in { left:-8px; }
  .lw-fl-port.out { right:-8px; }
  .lw-fl-port.out.p1 { top:36px; }
  .lw-fl-port.armed { background:${T.warn}; border-color:${T.warn}; }
  /* 多出口圆点旁边的小标签 ✓ —— 底色用**画布底色** ✓，让它把连线「切断」✓，
     不然字压在线上糊成一团 ✗。 */
  .lw-fl-plabel { position:absolute; right:-9px; transform:translateX(100%); z-index:3; font-size:9px; line-height:1; color:${T.faint}; background:${T.bg}; padding:1px 3px;
    pointer-events:none; }
  .lw-fl-svg { position:absolute; left:0; top:0; pointer-events:none; z-index:1; }
  /* ⚠️ 颜色用 faint ✗ 不用 lineDim ✗ —— lineDim(var(--pp-line)) 压在底色(var(--pp-page))上
     对比度只有 **1.67:1** ✗（WCAG 非文本最低要 3:1 ✗），连线基本看不见 ✗
     —— 这正是用户说「怎么连线」的根因之一 ✓。faint(var(--pp-ink2)) 约 2.8:1 ✓，看得见又不抢镜 ✓。 */
  .lw-fl-svg path { fill:none; stroke:${T.faint}; stroke-width:2; }
  .lw-fl-svg path.hot { stroke:${T.accent}; }
  /* ★★ 箭头的颜色要**单独写** ✗✗ —— 上面那条「.lw-fl-svg path」会**连带命中
     <defs> 里的 marker** ✓（marker 也是 .lw-fl-svg 的子孙 ✓），
     而 CSS **优先级高于** SVG 的 stroke 属性 ✗ →
     实测：高亮态的箭头写 stroke="accent" 也没用 ✗，被覆盖成 faint ✗，
     **选中节点时线变黄、箭头却不变** ✗（连线看着像断了一截 ✗）。
     → 用**更具体的选择器**按状态分别指定 ✓（「.lw-fl-svg defs marker path」比
       「.lw-fl-svg path」多两个元素，一定赢 ✓）。 */
  .lw-fl-svg defs marker path { stroke:${T.faint}; }
  .lw-fl-svg defs marker#lw-fl-ah-hot path { stroke:${T.accent}; }
  /* ★ 连线只有 2px 粗 ✗，直接点很难点中 ✗ —— 再叠一条 14px 宽的**透明**路径当命中区 ✓。
     ⚠️ 必须用 **class** ✗，不能用 SVG 的 stroke / stroke-width **属性** ✗ ——
        属性优先级**低于** CSS ✗，会被上面那条 .lw-fl-svg path { stroke-width:2 } 覆盖掉 ✗
        （实测：属性写了 14 也没用 ✗，线还是 2px 粗、点不中 ✗）。 */
  .lw-fl-svg path.hit { stroke:transparent; stroke-width:14; }
  .lw-fl-svg g { pointer-events:all; cursor:pointer; }
  .lw-fl-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:${T.faint}; font-size:11.5px; text-align:center; line-height:2; }
  .lw-fl-field { padding:9px 14px 0; }
  .lw-fl-field label { display:block; font-size:9.5px; color:${T.faint}; letter-spacing:.8px; margin-bottom:5px; }
  .lw-fl-field input, .lw-fl-field select, .lw-fl-field textarea { width:100%; box-sizing:border-box; border:1px solid ${T.lineDim}; background:${T.bg2}; color:${T.text}; font:11.5px/1.7 ${UI};
    padding:6px 8px; outline:none; resize:vertical; }
  .lw-fl-field input:focus, .lw-fl-field select:focus, .lw-fl-field textarea:focus { border-color:${T.accent}; }
  .lw-fl-field .tip { font-size:9.5px; color:${T.faint}; margin-top:5px; line-height:1.7; }
  .lw-fl-log { padding:8px 14px 0; font-size:10.5px; line-height:1.8; }
  .lw-fl-log div { display:flex; gap:7px; padding:3px 0; border-bottom:1px solid ${T.lineDim}; }
  .lw-fl-log .dot { flex:none; }
  .lw-fl-log .nm { color:${T.dim}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-fl-log .ok { color:${T.ok}; }
  .lw-fl-log .error { color:${T.red}; }
  .lw-fl-log .skipped { color:${T.faint}; }
  /* ★★ 节点库改成**两行** ✓ —— 第一行名字 ✓，第二行「这节点是干什么的」✓。
     用户原话：「你得告诉我怎么样，每个节点的作用」——
     让他**不用点、不用查**，扫一眼节点库就知道该拖哪个 ✓。
     ⚠️ 改成 flex-start ✗（两行时 emoji 要贴第一行 ✓，居中会飘到两行中间 ✗）。 */
  .lw-fl-pal { align-items:flex-start; }
  .lw-fl-pal .em { margin-top:1px; }
  .lw-fl-pal .tx { display:flex; flex-direction:column; gap:1px; min-width:0; }
  .lw-fl-pal .tx b { font-weight:400; font-size:11px; }
  .lw-fl-pal .tx i { font-style:normal; font-size:9.5px; color:${T.faint}; line-height:1.55; white-space:normal; }
  .lw-fl-pal:hover .tx i { color:${T.dim}; }
  /* 画布节点右上角显示**节点 id** ✓ —— 写 {{引用}} 时要用它 ✗，不给就只能瞎猜 ✗。 */
  .lw-fl-node .hd .fid { margin-left:auto; letter-spacing:0; text-transform:none; color:${T.dim}; font-size:9px; }
  /* 属性栏标题下的「这个节点是干什么的」✓ */
  .lw-fl-cfg .fd { padding:0 14px 4px; font-size:10.5px; color:${T.dim}; line-height:1.8; }
  .lw-fl-cfg .fd .fid { display:inline-block; border:1px solid ${T.lineDim}; padding:0 5px; margin-right:6px; color:${T.accent}; font-size:9.5px; }
  .lw-fl-cfg .fhow { padding:6px 14px 0; font-size:9.5px; color:${T.faint}; line-height:1.85; }
  .lw-fl-cfg .fout { padding:6px 14px 0; font-size:9.5px; color:${T.faint}; line-height:1.85; }
  .lw-fl-cfg .fout b { color:${T.ok}; font-weight:400; }
  /* ── 「📖 说明」面板 ✓（用户要的「每个节点的作用 + 提示怎么用」✓）────────── */
  .lw-fl-help { flex:1; min-width:0; overflow:auto; background:${T.bg2}; padding:20px 26px 40px; }
  .lw-fl-helpin { max-width:820px; margin:0 auto; font-size:11.5px; line-height:1.95; color:${T.dim}; }
  .lw-fl-help h3 { font-size:11px;   color:${T.accent}; margin:26px 0 10px; padding-bottom:6px; border-bottom:1px solid ${T.lineDim}; }
  .lw-fl-help h3:first-child { margin-top:0; }
  .lw-fl-help p { margin:0 0 9px; }
  .lw-fl-help ol, .lw-fl-help ul { margin:0 0 10px; padding-left:20px; }
  .lw-fl-help li { margin-bottom:4px; }
  .lw-fl-help b { color:${T.text}; font-weight:600; }
  .lw-fl-help code { background:${T.card2}; border:1px solid ${T.lineDim}; padding:0 4px; color:${T.accent}; font-size:10.5px; }
  .lw-fl-help .warn { color:${T.warn}; }
  .lw-fl-hn { border:1px solid ${T.lineDim}; background:${T.card}; padding:9px 12px; margin-bottom:7px; }
  .lw-fl-hn .t { display:flex; align-items:center; gap:7px; font-size:11.5px; color:${T.text}; }
  .lw-fl-hn .t .em { font-size:13px; line-height:1; }
  .lw-fl-hn .t .io { margin-left:auto; font-size:9px; color:${T.faint}; }
  .lw-fl-hn .d { margin-top:5px; font-size:11px; color:${T.dim}; line-height:1.8; }
  .lw-fl-hn .h { margin-top:4px; font-size:10px; color:${T.faint}; line-height:1.85; }
  .lw-fl-hn .o { margin-top:4px; font-size:10px; color:${T.faint}; line-height:1.85; }
  .lw-fl-hn .o b { color:${T.ok}; font-weight:400; }
  .lw-fl-hn .c { margin-top:4px; font-size:10px; color:${T.faint}; }
  .lw-fl-hd2 { font-size:10px;   color:${T.faint}; margin:16px 0 7px; }
  .lw-fl-help table { width:100%; border-collapse:collapse; font-size:10.5px; }
  .lw-fl-help th, .lw-fl-help td { text-align:left; vertical-align:top; padding:6px 8px; border-bottom:1px solid ${T.lineDim}; line-height:1.8; }
  .lw-fl-help th { color:${T.faint}; font-weight:400; font-size:9.5px; letter-spacing:.8px; }
  .lw-fl-help td.k { color:${T.text}; white-space:nowrap; }
  /* ══════════════════════════════════════════════════════════════════════
     热榜模块（多源聚合 + AI 日报）✓
     ⚠️ 注释里不能出现反引号 ✗（这段在 JS 模板字符串里 ✗）。
     ══════════════════════════════════════════════════════════════════════ */
  /* ★★★ flex 子项默认 min-height:auto ✗✗ —— 意思是「**不能比内容更矮**」✗，
     于是内容一长，三栏里的那一栏就会**撑到内容那么高** ✗、
     整个容器被撑破、**根本不会滚动** ✗✗。
     实测：热榜列表拉到 365 条时，那一栏变成 **24628px 高** ✗、位置跑到 y=-11742 ✗、
     点都点不到 ✗（Playwright 报「element is outside of the viewport」✗）。
     ⚠️ 这个问题在**所有**三栏布局里都潜伏着 ✗ ——
        邮箱 / 阅读 / 工作流只是**内容刚好没超过容器**才没露出来 ✗。
     → 凡是「自己 overflow:auto 的 flex 子项」，都要显式写 min-height:0 ✓。 */
  .lw-ml-side, .lw-ml-list, .lw-ml-read, .lw-rd-side, .lw-rd-list, .lw-rd-read, .lw-fl-side, .lw-fl-cfg, .lw-hl-side, .lw-hl-list, .lw-hl-read, .lw-nt-side, .lw-nt-list, .lw-nt-edit, .lw-jr-l, .lw-jr-r { min-height:0; }
  .lw-hl { display:flex; min-height:320px; border:1px solid ${T.lineDim}; background:${T.bg}; }
  .lw-hl-side { width:200px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; padding:10px 0; background:${T.bg}; }
  .lw-hl-list { width:392px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; background:${T.card}; }
  /* ★★ 右栏改成**左右布局** ✓ —— 用户原话：「把上下布局，改成左右布局」✓。
     原来是 AI 日报在上、文章预览在下（列向 flex ✓）——
     可 AI 日报一旦写长 ✓，下面的预览就被挤到看不见 ✓（而且它还有个 max-height:220px ✗，
     内容一多就在自己里面滚 ✓，等于两个滚动条套着 ✓）。
     → 改成**并排** ✓：AI 日报一列（宽度可拖 ✓）、文章预览一列 ✓。 */
  .lw-hl-read { flex:1; min-width:0; display:flex; flex-direction:row; overflow:hidden; }
  .lw-hl-tools { display:flex; gap:6px; align-items:center; padding:9px 11px; border-bottom:1px solid ${T.line}; position:sticky; top:0; background:${T.card}; z-index:2; flex-wrap:wrap; }
  .lw-hl-tools input { flex:1; min-width:80px; height:26px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11px ${UI}; outline:none; }
  .lw-hl-tools input:focus { border-color:${T.accent}; }
  .lw-hl-tools button { height:26px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10px ${UI}; cursor:pointer; letter-spacing:.4px; flex:none; }
  .lw-hl-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-hl-tools button.pri { border-color:${T.accent}; color:${T.accent}; }
  .lw-hl-tools button.pri:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-hl-src { font-size:9px;  color:${T.faint}; padding:11px 13px 5px; border-bottom:1px solid var(--pp-sheet2); background:${T.bg}; }
  .lw-hl-it { display:flex; gap:9px; padding:9px 13px; border-bottom:1px solid var(--pp-sheet2); cursor:pointer; }
  .lw-hl-it:hover { background:${T.card2}; }
  .lw-hl-it.on { background:${T.card2}; box-shadow:inset 3px 0 0 ${T.accent}; }
  .lw-hl-it .rk { flex:none; width:19px; text-align:right; font-size:10.5px; color:${T.faint}; font-variant-numeric:tabular-nums; line-height:1.5; }
  .lw-hl-it .rk.top { color:${T.red}; font-weight:700; }
  .lw-hl-it .mn { flex:1; min-width:0; }
  .lw-hl-it .ti { font-size:12px; line-height:1.55; color:${T.text}; word-break:break-word; }
  .lw-hl-it.seen .ti { color:${T.dim}; }
  .lw-hl-it .mt { display:flex; align-items:center; gap:8px; margin-top:4px; font-size:9px; color:${T.faint}; }
  .lw-hl-it .mt .badge { border:1px solid ${T.lineDim}; padding:1px 5px; }
  .lw-hl-it .mt .hot { color:${T.accent}; }
  .lw-hl-it .st { color:${T.warn}; }
  /* ★★ AI 日报：**左边一列** ✓（宽度能拖 ✓，见 「paneGrip('ai')」 ✓）——
     用户原话：「这个 AI 日报这里，窗口无法自由拖动」✓。
     ⚠️ min-height:0 必须写 ✗ —— flex 子项默认 min-height:auto ✓，
        不写的话这一列会被内容撑破 ✓（这个坑项目里踩过好几次 ✓）。 */
  .lw-hl-ai { flex:none; width:300px; min-width:0; min-height:0; overflow:auto; border-right:1px solid ${T.lineDim}; padding:12px 14px 22px; background:${T.bg}; }
  .lw-hl-ai .hd { display:flex; align-items:center; gap:7px; margin-bottom:10px; flex-wrap:wrap; }
  .lw-hl-ai .hd b { font-size:11px;  }
  .lw-hl-ai .hd .sp { flex:1; }
  .lw-hl-ai .hd button { height:26px; padding:0 10px; border:1px solid ${T.accent}; background:transparent; color:${T.accent}; font:10px ${UI}; cursor:pointer; letter-spacing:.5px; }
  .lw-hl-ai .hd button:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-hl-ai .hd button.ghost { border-color:${T.lineDim}; color:${T.dim}; }
  .lw-hl-ai .hd button.ghost:hover { background:transparent; color:${T.accent}; border-color:${T.accent}; }
  .lw-hl-ai .bd { font-size:12px; line-height:1.9; color:${T.text}; white-space:pre-wrap; }
  /* ⚠️ 卡片模式下要**关掉 「pre-wrap」** ✗ —— 不然 HTML 里的换行 / 缩进会变成一片空白 ✓
     （pre-wrap 对纯文本是对的 ✓，对卡片是灾难 ✓）。 */
  .lw-hl-ai .bd.cards { white-space:normal; line-height:1.6; }
  .lw-hl-ai .bd:empty::before { content:'点上面「生成 AI 日报」—— 把当前榜单交给模型，出一份能直接读的简报 ✓'; color:${T.faint}; font-size:11px; }
  /* ── AI 日报的卡片 ✓（不再是「一段文字」✗）─────────────────────────────
     ★ 用户原话：「AI 日报过于简单了，我需要你来总结热点的内容和重点，等等，
       帮助我快速理解和阅读好热点信息，而不是简单概括」✓。
     → 每条拆成：序号徽章（**可点，跳回中栏那条** ✓）/ 标题 / 是什么 / 为什么值得看 /
       要点 / 关键词 ✓ —— 一眼扫完就知道「要不要去读原文」✓。 */
  .lw-hl-ai .ov { border:1px solid ${T.lineDim}; border-left:1px solid ${T.accent}; background:${T.card}; padding:9px 11px; margin-bottom:10px; }
  .lw-hl-ai .ov .hl { font-size:12.5px; line-height:1.75; color:${T.text}; }
  .lw-hl-ai .ov .th { display:flex; gap:5px; flex-wrap:wrap; margin-top:7px; }
  .lw-hl-ai .ov .th span { font-size:9.5px; color:${T.accent}; border:1px solid ${T.accent}; padding:1px 6px; }
  .lw-hl-ai .cd { border:1px solid ${T.lineDim}; background:${T.card}; margin-bottom:9px; padding:9px 11px; }
  .lw-hl-ai .cd:hover { border-color:${T.dim}; }
  .lw-hl-ai .cd .ti { display:flex; gap:7px; align-items:flex-start; }
  .lw-hl-ai .cd .no { flex:none; min-width:20px; height:20px; display:flex; align-items:center; justify-content:center; border:1px solid ${T.accent}; color:${T.accent}; font-size:10px;
    cursor:pointer; font-variant-numeric:tabular-nums; }
  .lw-hl-ai .cd .no:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-hl-ai .cd .tt { flex:1; min-width:0; font-size:12px; line-height:1.6; color:${T.text}; font-weight:600; }
  .lw-hl-ai .cd .what { font-size:11.5px; line-height:1.8; color:${T.dim}; margin-top:7px; }
  .lw-hl-ai .cd .why { font-size:11.5px; line-height:1.8; color:${T.text}; margin-top:6px; border-left:1px solid ${T.accent}; padding-left:8px; }
  .lw-hl-ai .cd .pts { margin-top:7px; padding-left:2px; }
  .lw-hl-ai .cd .pts div { font-size:11px; line-height:1.75; color:${T.dim}; }
  .lw-hl-ai .cd .pts div::before { content:'· '; color:${T.faint}; }
  .lw-hl-ai .cd .tg { display:flex; gap:5px; flex-wrap:wrap; margin-top:7px; }
  .lw-hl-ai .cd .tg span { font-size:9px; color:${T.faint}; border:1px solid ${T.lineDim}; padding:1px 5px; }
  .lw-hl-ai .skip { font-size:10.5px; color:${T.faint}; line-height:1.8; margin-top:4px; }
  /* ⚠️ 正文栏必须是**列向 flex** ✗ —— 不然预览只能写死高度 ✗：
     以前是 iframe 写死 height:340px ✗，而右栏是**整屏高** ✓，
     于是预览下面**永远空一大片** ✗（用户截图里那块空白就是它 ✗）。
     → 父级列向 flex ✓ + 预览 flex:1 撑满剩下的高度 ✓。 */
  .lw-hl-body { flex:1; min-height:0; overflow:auto; padding:14px 18px 20px; display:flex; flex-direction:column; }
  /* 标题 / 元信息 / 按钮行**不许被压扁** ✗（列向 flex 里它们默认可收缩 ✗，
     窗口一矮就会被挤成一条线 ✗）。 */
  .lw-hl-body > h2, .lw-hl-body > .meta, .lw-hl-body > .acts { flex:none; }
  .lw-hl-body h2 { font-size:15px; line-height:1.5; margin-bottom:8px; }
  .lw-hl-body .meta { font-size:10px; color:${T.faint}; margin-bottom:12px; }
  .lw-hl-body .acts { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .lw-hl-body .acts button { height:26px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10px ${UI}; cursor:pointer; }
  .lw-hl-body .acts button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-hl-body .acts button.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  /* ★ 预览撑满剩下的高度 ✓ —— min-height:340px 是**保底** ✗：
     窗口很矮时至少还有 340px ✓，再矮就交给父级滚动 ✓（不会挤成一条线 ✗）。 */
  .lw-hl-body iframe { width:100%; flex:1; min-height:340px; border:1px solid ${T.lineDim}; background:var(--pp-sheet); }
  .lw-hl-hint { flex:none; font-size:10px; color:${T.faint}; margin-top:8px; line-height:1.8; }
  /* ★ 有些站**不允许被内嵌** ✗（实测 GitHub / arXiv / OpenAlex / openai.com ✗）——
     硬塞 iframe 的话浏览器只会显示一句「xxx 拒绝了我们的连接请求」✗，
     用户看着像坏了 ✗。所以改成一张**说清楚的卡片** ✓ + 一个大按钮 ✓。 */
  /* ⚠️ 卡片也要撑满 ✗ —— 不然它下面同样是一大片空白 ✗（和 iframe 那个毛病一样 ✗）。
     内容居中 ✓，看着像「故意这样排的」✓，而不是「没画完」✗。 */
  .lw-hl-noframe { flex:1; min-height:200px; display:flex; flex-direction:column; justify-content:center; border:1px dashed ${T.lineDim}; padding:26px 22px; text-align:center; background:${T.bg2}; }
  .lw-hl-noframe .ic { font-size:26px; line-height:1; margin-bottom:12px; }
  .lw-hl-noframe .ti { font-size:13px; font-weight:700; color:${T.text}; margin-bottom:8px; }
  .lw-hl-noframe .why { font-size:11px; color:${T.dim}; line-height:1.9; margin-bottom:16px; }
  .lw-hl-noframe button { height:32px; padding:0 16px; border:1px solid ${T.accent}; background:transparent; color:${T.accent}; font:600 11px ${UI}; letter-spacing:.8px; cursor:pointer; }
  .lw-hl-noframe button:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-hl-noframe .url { font-size:10px; color:${T.faint}; margin-top:14px; word-break:break-all; line-height:1.7; }
  .lw-hl-err { font-size:10.5px; color:${T.red}; line-height:1.8; padding:8px 13px; }
  /* ══════════════════════════════════════════════════════════════════════
     阅读模块（个人阅读管理）✓
     ⚠️ 注释里不能出现反引号 ✗ —— 这段整个在 JS 模板字符串里 ✗。
     ⚠️ 三栏高度由 .lw-main.fill 那条链撑满 ✓（见上面全高面板的注释 ✓）。
     ══════════════════════════════════════════════════════════════════════ */
  .lw-rd { display:flex; min-height:320px; border:1px solid ${T.lineDim}; background:${T.bg}; }
  /* ⚠️⚠️ overflow-anchor:none 是**必须**的 ✗ —— 见 render() 里 lwRestScroll 的注释 ✓：
     Chrome 的「滚动锚定」会在我们设完 scrollTop **之后**再自己调一次 ✓，
     于是「换词群后词表归零」被它调成了「停在列表底部」✗（实测 0 → 22 ✓）。
     ⚠️ 这里是**模板字符串** ✗ —— 注释里不能出现反引号 ✓（写了会直接语法错 ✓，踩过 ✓）。 */
  .lw-rd-side { width:206px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; overflow-anchor:none; padding:12px 0; background:${T.bg}; }
  .lw-rd-list { width:330px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; overflow-anchor:none; background:${T.card}; }
  .lw-rd-read { flex:1; min-width:0; display:flex; flex-direction:column; overflow:hidden; }
  /* ── 本地电子书阅读器 ✓（用户原话：「我需要的是可以实现阅读」✓）────────────
     ⚠️ 正文的**最大宽度**是关键 ✗ —— 一行铺满 1400px 的话，
        读完一行要往回找下一行 ✗，眼睛很累 ✓。700px 左右正好 ✓。 */
  .lw-eb { position:relative; }
  .lw-eb-bar { display:flex; align-items:center; gap:6px; padding:8px 12px; flex-wrap:wrap; flex:none; border-bottom:1px solid ${T.lineDim}; background:${T.card}; }
  .lw-eb-bar button { height:24px; min-width:26px; padding:0 8px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:11px ${UI}; cursor:pointer; }
  .lw-eb-bar button:hover:not(:disabled) { border-color:${T.accent}; color:${T.accent}; }
  .lw-eb-bar button:disabled { opacity:.3; cursor:default; }
  .lw-eb-bar button.on { border-color:${T.accent}; color:${T.accent}; }
  .lw-eb-bar select { flex:1; min-width:110px; max-width:420px; height:24px; border:1px solid ${T.lineDim}; background:${T.bg2}; color:${T.text}; font:11px ${UI}; outline:none; }
  .lw-eb-bar .sp { flex:1; }
  .lw-eb-bar .n { font-size:10px; color:${T.faint}; white-space:nowrap; }
  .lw-eb-body { flex:1; min-height:0; overflow:auto; padding:26px 32px 90px; background:${T.bg}; }
  .lw-eb-body > p, .lw-eb-body > h3 { max-width:700px; margin:0 auto 1.15em; line-height:2.05; }
  .lw-eb-body.wide > p, .lw-eb-body.wide > h3 { max-width:min(1120px, 100%); }
  /* ★ 中文书**首行缩进两格** ✓、英文书不缩进 ✗ ——
     两种排版习惯不一样 ✓，一律缩进的话英文段落看着很怪 ✗。 */
  .lw-eb-body.cjk > p { text-indent:2em; }
  .lw-eb-t { font-size:1.12em; font-weight:600; color:${T.text}; margin:0 auto 1.5em !important; }
  /* 划词后浮出来的「＋ 加生词」✓ —— 用 mousedown 触发 ✗（click 会先把选区清掉 ✗） */
  .lw-eb-pick { position:absolute; z-index:20; padding:5px 10px; border:1px solid ${T.accent}; background:${T.bg}; color:${T.accent}; font:11px ${UI}; cursor:pointer; white-space:nowrap; }
  .lw-eb-pick:hover { background:${T.accent}; color:${T.accentInk}; }
  /* ══ 阅读器外壳 ✓（用户原话：「去移植成熟的电子书阅读器设计，或者参考，
     还有…电子书阅读器的很多功能都没有，优化」✓）════════════════════════════
     参照成熟阅读器（Kindle / Apple Books / 微信读书）的**基本盘**：
     目录抽屉 · 可拖进度条 · 阅读设置（字号/行距/页宽/字体/主题）·
     全文搜索 · 划线笔记 · 记住读到哪儿 ✓。 */
  .lw-eb-bar .ttl { flex:1; min-width:0; font-size:11.5px; color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
  .lw-eb-bar .ttl:hover { color:${T.accent}; }
  /* ★ 进度条 ✓ —— 点一下 / 拖一下就能跳章 ✓（成熟阅读器都有 ✓）*/
  .lw-eb-prog { flex:none; width:140px; height:6px; background:${T.lineDim}; cursor:pointer; position:relative; }
  .lw-eb-prog i { position:absolute; left:0; top:0; bottom:0; background:${T.accent}; display:block; }
  .lw-eb-prog:hover i { background:${T.ok}; }
  /* ★ 左侧抽屉（目录 / 搜索）✓ —— ⚠️ 覆盖在正文上 ✗，不挤走正文 ✓：
     挤走的话正文宽度会跳一下 ✓（读书时最烦这个 ✓）。 */
  .lw-eb-drawer { position:absolute; left:0; top:0; bottom:0; width:min(320px,86%); z-index:30; display:flex; flex-direction:column; background:${T.card}; border-right:1px solid ${T.lineDim};
    box-shadow:var(--pp-shadow-float); }
  .lw-eb-drawer .hd { display:flex; align-items:center; gap:7px; padding:9px 12px; flex:none; border-bottom:1px solid ${T.lineDim}; font-size:11px; color:${T.faint}; }
  .lw-eb-drawer .hd b { color:${T.text}; font-size:11.5px; }
  .lw-eb-drawer .hd .sp { flex:1; }
  /* 抽屉顶部那两个**页签** ✓（目录 / 笔记 ✓）*/
  .lw-eb-drawer .hd button { height:22px; padding:0 8px; border:1px solid ${T.lineDim}; background:transparent; color:${T.faint}; font:10.5px ${UI}; cursor:pointer; }
  .lw-eb-drawer .hd button:hover { color:${T.text}; }
  .lw-eb-drawer .hd button.on { border-color:${T.accent}; color:${T.accent}; }
  .lw-eb-drawer .hd .x { cursor:pointer; padding:0 4px; }
  .lw-eb-drawer .hd .x:hover { color:${T.red}; }
  .lw-eb-drawer .find { flex:none; padding:8px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-eb-drawer .find input { width:100%; height:28px; padding:0 9px; background:${T.bg}; color:${T.text}; border:1px solid ${T.lineDim}; font:11.5px ${UI}; outline:none; }
  .lw-eb-drawer .find input:focus { border-color:${T.accent}; }
  .lw-eb-drawer .bd { flex:1; min-height:0; overflow:auto; }
  .lw-eb-tocrow { display:flex; align-items:baseline; gap:8px; padding:7px 12px; cursor:pointer; border-left:1px solid transparent; }
  .lw-eb-tocrow:hover { background:${T.card2}; }
  .lw-eb-tocrow.on { background:${T.card2}; border-left-color:${T.accent}; }
  .lw-eb-tocrow .no { flex:none; width:28px; font-size:10px; color:${T.faint}; }
  .lw-eb-tocrow .tx { flex:1; min-width:0; font-size:11.5px; color:${T.dim}; line-height:1.5; word-break:break-word; }
  .lw-eb-tocrow.on .tx { color:${T.text}; }
  .lw-eb-tocrow .n { flex:none; font-size:9.5px; color:${T.faint}; }
  /* 搜索命中 ✓ —— 带上下文，一眼看清「它在哪句话里」✓ */
  .lw-eb-hit { padding:8px 12px; border-bottom:1px solid ${T.lineDim}; cursor:pointer; }
  .lw-eb-hit:hover { background:${T.card2}; }
  .lw-eb-hit .ch { font-size:10px; color:${T.accent}; margin-bottom:3px; }
  .lw-eb-hit .sn { font-size:11px; color:${T.dim}; line-height:1.7; word-break:break-word; }
  .lw-eb-hit .sn b { color:${T.accent}; font-weight:600; }
  /* 阅读设置浮层 ✓ */
  .lw-eb-set { position:absolute; right:12px; top:44px; z-index:31; width:262px; background:${T.card}; border:1px solid ${T.lineDim}; box-shadow:var(--pp-shadow-float); }
  .lw-eb-set .rw { display:flex; align-items:center; gap:6px; padding:9px 12px; border-bottom:1px solid ${T.lineDim}; font-size:11px; color:${T.dim}; }
  .lw-eb-set .rw:last-child { border-bottom:0; }
  .lw-eb-set .rw .lb { flex:none; width:34px; color:${T.faint}; font-size:10px; }
  .lw-eb-set .rw .sp { flex:1; }
  .lw-eb-set .rw .vv { flex:none; width:34px; text-align:center; color:${T.text}; font-size:11px; }
  .lw-eb-set button { height:22px; padding:0 8px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10.5px ${UI}; cursor:pointer; }
  .lw-eb-set button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-eb-set button.on { border-color:${T.accent}; color:${T.accent}; }
  /* 主题 ✓ —— ⚠️ 阅读区**自带底色** ✗，不跟着整个面板的主题走 ✓
     （护眼/浅色是「读这本书时的偏好」✓，不是「整个 App 的主题」✓）。 */
  .lw-eb-body.th-light { background:var(--pp-ink); color:var(--pp-sheet2); }
  .lw-eb-body.th-light .lw-eb-t { color:var(--pp-sheet); }
  .lw-eb-body.th-sepia { background:var(--pp-ink); color:var(--pp-sheet2); }
  .lw-eb-body.th-sepia .lw-eb-t { color:var(--pp-sheet2); }
  .lw-eb-body.serif > p, .lw-eb-body.serif > h3 { font-family:Georgia,"Songti SC","Noto Serif CJK SC",serif; }
  .lw-eb-body.lh-0 > p { line-height:1.72; }
  .lw-eb-body.lh-2 > p { line-height:2.4; }
  .lw-eb-body.nw-0 > p, .lw-eb-body.nw-0 > h3 { max-width:560px; }
  .lw-eb-body.nw-2 > p, .lw-eb-body.nw-2 > h3 { max-width:min(1120px, 100%); }
  /* 划线 ✓（读过的句子标出来 ✓，点一下能看笔记 ✓）*/
  .lw-eb-body mark.hl { background:color-mix(in srgb, ${T.warn} 26%, transparent); color:inherit; border-bottom:1px solid ${T.warn}; cursor:pointer; }
  .lw-rd-hd { font-size:9px;  color:${T.faint}; padding:10px 13px 5px; }
  .lw-rd-row { display:flex; align-items:center; gap:8px; padding:6px 13px; font-size:11px; cursor:pointer; color:${T.dim}; border-left:1px solid transparent; }
  .lw-rd-row:hover { background:${T.card2}; color:${T.text}; }
  .lw-rd-row.on { background:${T.card2}; color:${T.text}; border-left-color:${T.accent}; }
  .lw-rd-row .n { margin-left:auto; font-size:9.5px; color:${T.faint}; font-variant-numeric:tabular-nums; }
  .lw-rd-row .em { font-size:13px; line-height:1; }
  /* ★ 分类行上的「⋯」✓（改名 / 删分类 ✓）—— 平时**淡**一点 ✗，
     hover 那行才亮 ✓（免得一栏里全是图标，和右边的数字打架 ✓）。
     ⚠️ .n 有 margin-left:auto ✓，所以「⋯」会紧跟在数字右边 ✓。
     ⚠️ 这段注释里不许出现反引号 ✗（本会话第 8 次了 ✗）。 */
  .lw-rd-row .x { flex:none; font-size:12px; line-height:1; color:${T.faint}; cursor:pointer; padding:0 2px; }
  .lw-rd-row .x:hover { color:${T.accent}; }
  /* 左栏统计 */
  .lw-rd-stat { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:${T.lineDim}; margin:0 13px 12px; border:1px solid ${T.lineDim}; }
  .lw-rd-stat div { background:${T.card}; padding:8px 9px; }
  .lw-rd-stat b { display:block; font-size:18px; font-weight:700; color:${T.accent}; font-variant-numeric:tabular-nums; line-height:1.1; }
  .lw-rd-stat span { font-size:9px; color:${T.faint}; letter-spacing:.6px; }
  /* 中栏：工具条 + 书卡 */
  .lw-rd-tools { display:flex; gap:6px; align-items:center; padding:9px 11px; border-bottom:1px solid ${T.line}; position:sticky; top:0; background:${T.card}; z-index:2; flex-wrap:wrap; }
  .lw-rd-tools input { flex:1; min-width:80px; height:26px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11px ${UI}; outline:none; }
  .lw-rd-tools input:focus { border-color:${T.accent}; }
  .lw-rd-tools button { height:26px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10px ${UI}; cursor:pointer; letter-spacing:.5px; flex:none; }
  /* ★ 「挑一篇」要**看得出来是主入口** ✓ —— 用户一进来是空的时候，
     满屏灰按钮里必须有一个亮的 ✓（不然他不知道从哪开始 ✓）。 */
  .lw-rd-tools button.pri { border-color:${T.accent}; color:${T.accent}; }
  .lw-rd-tools button.pri:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-ep-big { height:32px; padding:0 18px; border:1px solid ${T.accent}; background:transparent; color:${T.accent}; font:11.5px ${UI}; cursor:pointer; }
  .lw-ep-big:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-rd-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-bk { display:flex; gap:11px; padding:11px 13px; border-bottom:1px solid var(--pp-sheet2); cursor:pointer; position:relative; }
  /* ★ 书架每行右上角「🗑」✓（用户原话：「还有这个电子书这边缺少删除书籍等」✓）——
     平时 opacity:0 ✓（一屏十几本都挂个垃圾桶会很吵 ✓），hover / 当前这本才显 ✓。 */
  .lw-bk .ops { position:absolute; top:6px; right:6px; display:flex; gap:2px; opacity:0; transition:opacity .12s; }
  .lw-bk:hover .ops, .lw-bk.on .ops { opacity:1; }
  .lw-bk .ops button { width:22px; height:22px; padding:0; border:1px solid ${T.lineDim}; background:${T.bg}; color:${T.dim}; font-size:11px; line-height:1; cursor:pointer; }
  .lw-bk .ops button.del:hover { border-color:${T.red}; color:${T.red}; }
  .lw-bk:hover { background:${T.card2}; }
  .lw-bk.on { background:${T.card2}; box-shadow:inset 3px 0 0 ${T.accent}; }
  .lw-bk .cv { width:42px; height:58px; flex:none; border:1px solid ${T.lineDim}; background:${T.bg2}; display:flex; align-items:center; justify-content:center; font-size:19px; overflow:hidden; }
  .lw-bk .cv img { width:100%; height:100%; object-fit:cover; }
  .lw-bk .mn { flex:1; min-width:0; }
  .lw-bk .ti { font-size:12.5px; font-weight:600; color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-bk .au { font-size:10px; color:${T.dim}; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-bk .mt { display:flex; align-items:center; gap:6px; margin-top:7px; font-size:9px; color:${T.faint}; }
  .lw-bk .mt .tag { border:1px solid ${T.lineDim}; padding:1px 5px; letter-spacing:.4px; }
  .lw-bar { flex:1; height:3px; background:${T.lineDim}; position:relative; min-width:24px; }
  .lw-bar i { position:absolute; left:0; top:0; bottom:0; background:${T.accent}; }
  /* 右栏 */
  .lw-rd-rhd { flex:none; padding:14px 18px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-rd-rhd h2 { font-size:17px; font-weight:700; letter-spacing:.4px; line-height:1.3; }
  .lw-rd-rhd .meta { font-size:10.5px; color:${T.dim}; margin-top:6px; letter-spacing:.4px; }
  .lw-rd-rhd .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
  .lw-rd-chip { border:1px solid ${T.lineDim}; padding:3px 8px; font-size:9.5px; color:${T.dim}; cursor:pointer; letter-spacing:.4px; }
  .lw-rd-chip:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rd-chip.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-rd-chip[data-act="del"]:hover { border-color:${T.red}; color:${T.red}; }
  .lw-rd-body { flex:1; min-height:0; overflow:auto; padding:0 18px 20px; }
  .lw-rd-sec { font-size:9px;  color:${T.faint}; padding:16px 0 8px; border-bottom:1px solid ${T.lineDim}; margin-bottom:10px; }
  /* 进度条（可点）*/
  .lw-rd-prog { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .lw-rd-prog .track { flex:1; height:8px; background:${T.lineDim}; position:relative; cursor:pointer; }
  .lw-rd-prog .track i { position:absolute; left:0; top:0; bottom:0; background:${T.accent}; }
  .lw-rd-prog .pct { font-size:12px; font-weight:700; color:${T.accent}; width:44px; text-align:right; font-variant-numeric:tabular-nums; }
  .lw-rd-quick { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .lw-rd-quick button { height:26px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10px ${UI}; cursor:pointer; }
  .lw-rd-quick button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rd-quick input { width:62px; height:26px; padding:0 8px; border:1px solid ${T.lineDim}; background:transparent; color:${T.text}; font:11px ${UI}; outline:none; }
  /* 笔记 */
  .lw-note { border-left:1px solid ${T.lineDim}; padding:9px 0 9px 12px; margin-bottom:10px; position:relative; }
  .lw-note.k-idea { border-left-color:${T.warn}; }
  .lw-note.k-quote { border-left-color:${T.accent}; }
  .lw-note .tx { font-size:12px; line-height:1.85; white-space:pre-wrap; word-break:break-word; }
  .lw-note.k-quote .tx { color:${T.text}; }
  .lw-note.k-idea .tx { color:${T.dim}; }
  .lw-note .ft { display:flex; align-items:center; gap:9px; margin-top:7px; font-size:9px; color:${T.faint}; }
  .lw-note .ft .x { cursor:pointer; }
  .lw-note .ft .x:hover { color:${T.red}; }
  .lw-rd-empty { padding:40px 20px; text-align:center; color:${T.faint}; font-size:11.5px; line-height:2; }
  /* 近 14 天柱状 */
  .lw-rd-chart { display:flex; align-items:flex-end; gap:4px; height:66px; padding-top:6px; }
  .lw-rd-chart div { flex:1; background:${T.lineDim}; position:relative; min-height:2px; }
  .lw-rd-chart div.has { background:${T.accent}; }
  .lw-rd-chart div:hover::after { content:attr(data-tip); position:absolute; bottom:100%; left:50%; transform:translateX(-50%); background:${T.card2}; border:1px solid ${T.line}; color:${T.text};
    font-size:9px; padding:3px 6px; white-space:nowrap; z-index:5; }
  .lw-rd-axis { display:flex; gap:4px; margin-top:5px; font-size:8.5px; color:${T.faint}; }
  .lw-rd-axis span { flex:1; text-align:center; }
  /* 导入浮层 */
  .lw-imp { position:fixed; inset:0; background:var(--pp-scrim); z-index:8800; display:flex; align-items:center; justify-content:center; }
  .lw-imp .box { width:min(760px,92vw); max-height:86vh; background:${T.bg}; border:1px solid ${T.line}; display:flex; flex-direction:column; }
  .lw-imp .hd { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid ${T.line}; }
  .lw-imp .hd b { font-size:12px; letter-spacing:1px; }
  .lw-imp .hd .x { margin-left:auto; cursor:pointer; color:${T.dim}; }
  .lw-imp .hd .x:hover { color:${T.red}; }
  .lw-imp .bd { flex:1; min-height:0; overflow:auto; padding:14px 16px; }
  .lw-imp textarea { width:100%; height:210px; resize:vertical; border:1px solid ${T.lineDim}; background:${T.card}; color:${T.text}; font:11.5px/1.7 ${UI}; padding:10px; outline:none; }
  .lw-imp textarea:focus { border-color:${T.accent}; }
  .lw-imp .tip { font-size:10.5px; color:${T.dim}; line-height:1.9; margin-bottom:10px; }
  .lw-imp .tip code { background:${T.card2}; border:1px solid ${T.lineDim}; padding:1px 5px; }
  .lw-imp .ft { display:flex; gap:8px; align-items:center; padding:12px 16px; border-top:1px solid ${T.line}; }
  .lw-imp .ft button { height:30px; padding:0 14px; border:1px solid ${T.line}; background:transparent; color:${T.text}; font:600 10.5px ${UI}; letter-spacing:1px; cursor:pointer; }
  .lw-imp .ft button.pri { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-imp .ft button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-imp .ft button.pri:hover { background:transparent; color:${T.accent}; }
  .lw-imp .pv { font-size:10.5px; color:${T.dim}; line-height:1.9; }
  .lw-imp .pv b { color:${T.accent}; }
  /* ★ 微信读书「连接」面板的补充样式 ✓ —— 复用 .lw-imp 那套浮层 ✓（别再造一个 ✗）。
     「怎么拿 Cookie」那四步是**这个功能的成败关键** ✗ ——
     用户就是卡在这一步 ✗，所以给它一个显眼的盒子 ✓，别混在灰字里 ✗。 */
  .lw-imp .steps { border:1px solid ${T.lineDim}; background:${T.card}; padding:11px 14px; margin:10px 0 12px; }
  .lw-imp .steps .h { font-size:10px; color:${T.accent}; margin-bottom:8px; }
  .lw-imp .steps ol { margin:0; padding-left:18px; font-size:10.5px; color:${T.dim}; line-height:1.95; }
  .lw-imp .steps li { margin-bottom:3px; }
  .lw-imp .steps code { background:${T.card2}; border:1px solid ${T.lineDim}; padding:1px 5px; color:${T.text}; }
  .lw-imp .steps .n { margin-top:8px; font-size:10px; color:${T.warn}; line-height:1.85; }
  .lw-imp .st { font-size:10.5px; line-height:1.9; margin-top:10px; min-height:18px; color:${T.dim}; word-break:break-all; }
  .lw-imp .st.ok { color:${T.ok}; }
  .lw-imp .st.err { color:${T.red}; }
  .lw-imp .st2 { font-size:10px; color:${T.faint}; line-height:1.9; margin-top:4px; }
  /* ── 应用内对话框 ✓（替掉原生 prompt / confirm ✓）────────────────────────
     ★ 用户原话：「不要用这种网页的弹出输入去输入内容」✓。
     ⚠️ 它复用 「.lw-imp」 那套浮层 ✓ —— 同一套遮罩 / 边框 / 按钮 ✓，
        不要另起一套 ✗（那就会出现两种长得不一样的浮层 ✗）。 */
  .lw-dlg-lb { font-size:11px; color:${T.dim}; margin-bottom:7px; }
  #lw-dlg input { width:100%; height:34px; padding:0 11px; border:1px solid ${T.lineDim}; background:${T.bg2}; color:${T.text}; font:13px ${UI}; outline:none; }
  #lw-dlg input:focus { border-color:${T.accent}; }
  #lw-dlg input::placeholder { color:${T.faint}; }
  .lw-dlg-text { font-size:12px; line-height:1.95; color:${T.text}; white-space:pre-wrap; }
  .lw-dlg-hint { font-size:10.5px; line-height:1.85; color:${T.faint}; margin-top:8px; }
  /* ⚠️ 空值不让过时**抖一下** ✗ —— 不然用户点了「确定」没反应，会以为按钮坏了 ✗。 */
  @keyframes lw-dlg-shake { 0%,100% { transform:translateX(0) } 20%,60% { transform:translateX(-5px) } 40%,80% { transform:translateX(5px) } }
  #lw-dlg input.shake { animation:lw-dlg-shake .36s ease-in-out; border-color:${T.red}; }
  /* ── 推荐外刊源浮层 ✓ ───────────────────────────────────────────────────
     ★ 用户原话：「自行帮我抓取热门的，和别人开源的外刊资源等等」✓。
     ⚠️ 左栏固定宽 + 右栏 flex:1 各**自己滚** ✗ —— 用整块滚的话，
        源一多（7 个分组 20 多个源 ✗）就得先滚到底才看得到文章列表 ✗。
     ⚠️ 两个滚动容器都要 min-height:0 ✗（flex 子项默认 min-height:auto ✗，
        内容一长就不滚、把父级撑破 ✗ —— 这个坑在这个项目里踩过好几次 ✗）。 */
  .lw-epsrc-tabs { display:flex; gap:0; margin-left:14px; }
  .lw-epsrc-tabs button { height:24px; padding:0 11px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10.5px ${UI}; cursor:pointer; }
  .lw-epsrc-tabs button + button { border-left:0; }
  .lw-epsrc-tabs button:hover { color:${T.text}; }
  .lw-epsrc-tabs button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-epsrc { display:flex; height:min(70vh,640px); }
  .lw-epsrc-side { width:250px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; min-height:0; padding:8px 0; background:${T.bg}; }
  .lw-epsrc-main { flex:1; min-width:0; min-height:0; overflow:auto; background:${T.bg}; }
  .lw-epsrc-one { height:min(70vh,640px); overflow:auto; min-height:0; padding:12px 16px; background:${T.bg}; }
  .lw-epsrc-g { font-size:9px;  color:${T.faint}; padding:10px 13px 4px; }
  .lw-epsrc-s { display:flex; align-items:center; gap:8px; padding:6px 13px; cursor:pointer; }
  .lw-epsrc-s:hover { background:${T.card2}; }
  .lw-epsrc-s.on { background:${T.card2}; box-shadow:inset 3px 0 0 ${T.accent}; }
  .lw-epsrc-s .em { flex:none; font-size:12px; line-height:1; }
  .lw-epsrc-s .tx { flex:1; min-width:0; display:flex; align-items:baseline; gap:6px; }
  .lw-epsrc-s .tx b { font-size:11.5px; font-weight:400; color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-epsrc-s.on .tx b { color:${T.accent}; }
  .lw-epsrc-s .tx i { font-style:normal; flex:none; font-size:9px; color:${T.faint}; }
  .lw-epsrc-hd { display:flex; align-items:center; gap:9px; padding:11px 16px; position:sticky; top:0; background:${T.bg}; border-bottom:1px solid ${T.lineDim}; z-index:2; }
  .lw-epsrc-hd b { font-size:12px; }
  .lw-epsrc-hd .lv { font-size:9px; color:${T.accent}; border:1px solid ${T.lineDim}; padding:1px 5px; }
  .lw-epsrc-hd .n { font-size:10px; color:${T.faint}; }
  .lw-epsrc-hd button { margin-left:auto; height:22px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10px ${UI}; cursor:pointer; }
  .lw-epsrc-hd button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-epsrc-hd a { font-size:10px; color:${T.dim}; text-decoration:none; }
  .lw-epsrc-hd a:hover { color:${T.accent}; }
  .lw-epsrc-list { padding:0 0 10px; }
  .lw-epsrc-it { padding:10px 16px; border-bottom:1px solid var(--pp-sheet2); cursor:pointer; }
  .lw-epsrc-it:hover { background:${T.card2}; }
  .lw-epsrc-it.busy { opacity:.6; cursor:progress; }
  .lw-epsrc-it .ti { font-size:12.5px; line-height:1.55; color:${T.text}; }
  .lw-epsrc-it .de { font-size:10.5px; line-height:1.75; color:${T.dim}; margin-top:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .lw-epsrc-it .mt { display:flex; align-items:center; gap:9px; margin-top:5px; font-size:9.5px; color:${T.faint}; }
  .lw-epsrc-it .mt .go { color:${T.faint}; }
  .lw-epsrc-it:hover .mt .go { color:${T.accent}; }
  .lw-epsrc-it .mt .op { margin-left:auto; color:${T.faint}; text-decoration:none; }
  .lw-epsrc-it .mt .op:hover { color:${T.accent}; }
  .lw-epsrc-tip { padding:22px 18px; font-size:11.5px; line-height:2; color:${T.dim}; }
  .lw-os-tags { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
  .lw-os-tags button { height:24px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10.5px ${UI}; cursor:pointer; }
  .lw-os-tags button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-os-tags button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-os { border:1px solid ${T.lineDim}; background:${T.card}; padding:11px 13px; margin-bottom:9px; }
  .lw-os .hd { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .lw-os .hd b { font-size:12.5px; color:${T.text}; }
  .lw-os .hd .by { font-size:10px; color:${T.faint}; }
  .lw-os .hd .st { font-size:10px; color:${T.accent}; }
  .lw-os .hd .tg { font-size:9px; color:${T.dim}; border:1px solid ${T.lineDim}; padding:1px 5px; }
  .lw-os .hd .lv { font-size:9px; color:${T.faint}; }
  .lw-os .hd .op { margin-left:auto; font-size:10.5px; color:${T.accent}; text-decoration:none; }
  .lw-os .de { font-size:11px; line-height:1.85; color:${T.dim}; margin-top:6px; }
  .lw-os .wn { font-size:10.5px; line-height:1.8; color:${T.warn}; margin-top:5px; }
  /* ══════════════════════════════════════════════════════════════════════
     外刊精读 / 生词本 ✓（阅读模块的两个子模式 ✓）
     ⚠️ 注释里不能出现反引号 ✗（这段在 JS 模板字符串里 ✗）。
     ⚠️ 三栏**复用** .lw-rd-side / .lw-rd-list / .lw-rd-read 这套类名 ✓ ——
        这样 bindPaneGrips 那份 spec **一个字都不用改** ✓，
        拖拽调宽 / 双击复位 / 宽度落盘全都自动有了 ✓（新做一套就等于重踩一遍 ✗）。
     ══════════════════════════════════════════════════════════════════════ */
  .lw-rd-wrap { display:flex; flex-direction:column; min-height:0; }
  .lw-rd-wrap > .lw-rd { flex:1; min-height:0; }
  .lw-rd-modes { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:8px 11px; background:${T.card}; border:1px solid ${T.lineDim}; border-bottom:none; }
  .lw-rd-modes .seg { display:flex; align-items:center; gap:6px; height:26px; padding:0 11px; border:1px solid ${T.lineDim}; color:${T.dim}; font:10.5px ${UI}; cursor:pointer; letter-spacing:.5px; }
  .lw-rd-modes .seg:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rd-modes .seg.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-rd-modes .seg i { font-style:normal; font-size:9px; opacity:.7; }
  .lw-rd-modes .sp { flex:1; }
  .lw-rd-modes .tip { font-size:9.5px; color:${T.faint}; }
  /* ══ 词根词缀：思维导图 ✓ ═══════════════════════════════════════════════
     ★ 用户原话：「大致做成思维导图的样式…强化可视化和巧记，图形化等等」✓。
     ⚠️ 画法沿用工作流画布那套 ✓：**HTML 节点 + SVG 连线** ✓ ——
        比纯 SVG 好写（文字自动换行 / 好点 / 好挂 hover ✓），
        比纯 HTML 好画（曲线连接得靠 SVG ✓）。 */
  .lw-rm-row { display:flex; align-items:center; gap:8px; padding:8px 13px; cursor:pointer; border-bottom:1px solid ${T.lineDim}; border-left:1px solid transparent; }
  .lw-rm-row:hover { background:${T.card2}; }
  .lw-rm-row.on { background:${T.card2}; border-left-color:${T.accent}; }
  .lw-rm-row .fm { font-size:13px; color:${T.text}; letter-spacing:.4px; min-width:62px; }
  .lw-rm-row.on .fm { color:${T.accent}; }
  .lw-rm-row .mn { flex:1; font-size:10.5px; color:${T.dim}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-rm-row .n { font-size:9px; color:${T.faint}; }
  .lw-rm-row .b { font-size:10px; }
  .lw-rm-row .b.star { color:${T.accent}; }
  .lw-rm-row .b.done { color:${T.ok}; }
  .lw-rm-bar { display:flex; align-items:center; gap:6px; padding:8px 12px; flex-wrap:wrap; flex:none; border-bottom:1px solid ${T.lineDim}; background:${T.card}; }
  .lw-rm-bar .fm { font-size:14px; letter-spacing:.5px; }
  .lw-rm-bar .tp { font-size:9.5px; color:${T.faint}; border:1px solid ${T.lineDim}; padding:1px 6px; }
  .lw-rm-bar .sp { flex:1; }
  .lw-rm-bar button { height:24px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10.5px ${UI}; cursor:pointer; }
  .lw-rm-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rm-bar button.on { border-color:${T.accent}; color:${T.accent}; }
  /* ★ 画布 ✓ —— ⚠️ 必须 overflow:hidden + min-height:0 ✗：
     flex 子项默认 min-height:auto ✓，不写的话画布会把面板撑破 ✗（这个坑踩过 ✓）。 */
  .lw-rm-stage { flex:1; min-height:0; position:relative; overflow:hidden; background:radial-gradient(circle at 1px 1px, ${T.lineDim} 1px, transparent 0) 0 0/22px 22px; }
  .lw-rm-plane { position:absolute; left:0; top:0; transform-origin:0 0; }
  .lw-rm-svg { position:absolute; left:0; top:0; pointer-events:none; }
  .lw-rm-hint { position:absolute; left:10px; bottom:8px; font-size:9.5px; color:${T.faint}; pointer-events:none; }
  .lw-rm-n { position:absolute; display:flex; flex-direction:column; justify-content:center; padding:0 10px; box-sizing:border-box; border:1px solid ${T.lineDim}; background:${T.bg};
    cursor:pointer; overflow:hidden; transition:box-shadow .12s, transform .12s; }
  .lw-rm-n:hover { box-shadow:0 0 0 2px var(--pp-line); z-index:3; }
  .lw-rm-n .t { font-size:11.5px; color:${T.text}; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lw-rm-n .t.wrap { white-space:normal; font-size:11px; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .lw-rm-n .s { font-size:9px; color:${T.faint}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lw-rm-n .f { position:absolute; right:5px; top:50%; transform:translateY(-50%); font-size:9px; color:${T.faint}; }
  .lw-rm-n.k-root { justify-content:center; font-weight:600; }
  .lw-rm-n.k-root .t { font-size:16px; color:${T.accentInk}; }
  .lw-rm-n.k-root .s { color:${T.accentInk}; opacity:.75; }
  .lw-rm-n.k-dim { background:${T.card2}; }
  .lw-rm-n.k-dim .t { font-size:11px; }
  .lw-rm-n.k-item { background:${T.card}; border-style:dashed; }
  .lw-rm-n.k-item .t { color:${T.dim}; }
  .lw-rm-n.fold { border-style:dotted; opacity:.75; }
  /* ★ 整词拆解那张卡 ✓（查询一个词 → 先看怎么拆 → 点部件跳到词根 ✓）*/
  .lw-rm-card { margin:10px 12px 0; border:1px solid ${T.lineDim}; background:${T.card}; flex:none; }
  .lw-rm-card .hd { display:flex; align-items:center; padding:7px 10px; font-size:11px; color:${T.dim}; border-bottom:1px solid ${T.lineDim}; }
  .lw-rm-card .hd .x { margin-left:auto; cursor:pointer; color:${T.faint}; }
  .lw-rm-card .hd .x:hover { color:${T.red}; }
  .lw-rm-split { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:10px; }
  .lw-rm-chip { display:flex; flex-direction:column; gap:1px; padding:5px 9px; border:1px solid ${T.lineDim}; font-size:12.5px; color:${T.text}; }
  .lw-rm-chip i { font-style:normal; font-size:9px; color:${T.faint}; }
  .lw-rm-chip.go { cursor:pointer; }
  .lw-rm-chip.go:hover { background:${T.card2}; }
  .lw-rm-split .plus { color:${T.faint}; font-size:12px; }
  /* 随机自测 ✓ */
  .lw-rm-quiz { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px; text-align:center; }
  .lw-rm-quiz .q { font-size:13px; color:${T.dim}; }
  .lw-rm-quiz .q b { display:block; margin-top:10px; font-size:30px; color:${T.accent}; letter-spacing:1px; font-weight:600; }
  .lw-rm-quiz .a { font-size:18px; color:${T.text}; }
  .lw-rm-quiz .btns { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
  .lw-rm-quiz .btns button { height:30px; padding:0 14px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:11px ${UI}; cursor:pointer; }
  .lw-rm-quiz .btns button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rm-quiz .btns button.pri { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-rm-quiz .tip { font-size:10px; color:${T.faint}; }
  /* ── 文章列表 ── */
  /* ⚠️ position:relative 是给右上角那两个操作（.ops ✓）当定位基准的 ✗ ——
     少了它，.ops 会一路往上找最近的定位祖先 ✓ → 飘到整个列表外面去 ✓。
     ⚠️ 这段注释里不许出现反引号 ✗（CSS 装在 JS 模板串里 ✓，本会话栽过 7 次 ✗）。 */
  .lw-ep-art { padding:11px 13px; border-bottom:1px solid ${T.lineDim}; cursor:pointer; border-left:1px solid transparent; position:relative; }
  .lw-ep-art:hover { background:${T.card2}; }
  .lw-ep-art.on { background:${T.card2}; border-left-color:${T.accent}; }
  .lw-ep-art .ti { font-size:12px; color:${T.text}; line-height:1.5; margin-bottom:5px; }
  .lw-ep-art .mt { display:flex; gap:8px; flex-wrap:wrap; font-size:9.5px; color:${T.faint}; }
  .lw-ep-art .mt .lv { color:${T.accent}; }
  .lw-ep-art .mt .done { color:${T.ok}; }
  /* ★★ 每行右上角那两个操作 ✓（📁 分类 / 🗑 删除 ✓）——
     用户原话：「这里缺少删除」+「还有缺少分类管理」✓。
     ⚠️ 平时 **opacity:0** ✗（不占视觉），hover / 当前这篇才显出来 ✓ ——
        一直显示的话，一屏十几行挂二十几个图标，列表会很吵 ✓。
     ⚠️ 绝对定位 + 父级相对定位 ✗（父级那条规则里已经加了 ✓）*/
  .lw-ep-art .ops { position:absolute; top:6px; right:6px; display:flex; gap:2px; opacity:0; transition:opacity .12s; }
  .lw-ep-art:hover .ops, .lw-ep-art.on .ops { opacity:1; }
  .lw-ep-art .ops button { width:22px; height:22px; padding:0; border:1px solid ${T.lineDim}; background:${T.bg}; color:${T.dim}; font-size:11px; line-height:1; cursor:pointer; }
  .lw-ep-art .ops button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-ep-art .ops button.del:hover { border-color:${T.red}; color:${T.red}; }
  /* 分类标记 ✓ —— 一行里要能一眼看出这篇归在哪 ✓ */
  .lw-ep-art .mt .cat { color:${T.accent}; }
  /* ── 正文（逐句）── */
  .lw-ep-body { flex:1; min-height:0; overflow:auto; padding:22px 30px 60px; background:${T.bg}; }
  .lw-ep-body .hd { max-width:760px; margin:0 auto 18px; }
  .lw-ep-body .hd h2 { font-size:19px; line-height:1.45; color:${T.text}; font-weight:400; margin:0 0 8px; }
  .lw-ep-body .hd .mt { font-size:10.5px; color:${T.faint}; display:flex; gap:10px; flex-wrap:wrap; }
  .lw-ep-body .hd .mt b { color:${T.dim}; font-weight:400; }
  .lw-ep-body .bd { max-width:760px; margin:0 auto; }
  /* 正文在上、句子面板在下 ✓ —— 面板高度**可拖** ✓（见 .lw-ep-grip ✓）。
     ⚠️ 以前是写死的「flex:0 0 44%」✗ —— 用户原话「上下窗口无法自由拖动」✗。
        写死比例的毛病：文章短的时候面板太大 ✓、句子长的时候又太小 ✓，
        而且用户**没有任何办法**调整 ✗。
     ⚠️ 没拖过时用 44% ✓（flex:0 0 44% ✓），拖过之后由 JS 写 height ✓
        （写了 height 就同时要 flex:none ✗，不然 flex-basis 会打架 ✗）。 */
  /* ★★ 上半部分**左右两栏**（左正文 / 右查词）+ 下半部分**通栏**（句子详情）✗✗ ——
     用户原话：「上面两栏，下面一栏」✓，配合前一句
     「左边原文，右边所查询和加入单词本的单词」✓。
     ⚠️ 我第一版搞反了 ✗ —— 把查词放在了**句子面板**的右边 ✓
        （＝上面一栏、下面两栏 ✓），用户否掉了 ✓。
        正确的读法是：**查词要挨着正文** ✓ —— 一边读一边看词卡 ✓，
        不用先往下滚到句子面板再找 ✓。
     结构（⚠️ 这里不许用代码围栏 ✗ —— CSS 装在 JS 模板串里 ✓，围栏那三个反引号会把串截断 ✓）：
       .lw-ep-top    上：flex 行
         .lw-ep-body   左：正文（flex:1 ✓ 自带 overflow:auto ✓）
         .lw-ep-side   右：查词 / 加生词 / 词卡 / 本篇生词（固定宽 ✓ 可拖 ✓）
       .lw-ep-grip   上下拖拽条
       .lw-ep-panel  下：句子详情（通栏 ✓） */
  .lw-ep-top { flex:1; min-height:0; display:flex; }
  .lw-ep-side { flex:none; width:260px; min-height:0; overflow-y:auto; overflow-x:hidden; border-left:1px solid ${T.lineDim}; background:${T.card}; padding-bottom:14px; }
  .lw-ep-panel { flex:0 0 44%; min-height:0; overflow:auto; border-top:1px solid ${T.lineDim}; background:${T.card}; padding-bottom:14px; }
  /* ★ 上下拖拽条 ✓ —— 和左右那条（.lw-pgrip）一个思路 ✓，只是方向转了 90° ✓。
     ⚠️ 热区给 8px 高 ✗（看着只有 2px ✗）—— 太细抓不住 ✗，
        而它平时是**看不见**的 ✓，hover / 拖动时才亮 ✓。 */
  .lw-ep-grip { flex:none; height:8px; margin:-5px 0 -3px; cursor:row-resize; position:relative; z-index:3; }
  .lw-ep-grip::after { content:''; position:absolute; left:0; right:0; top:3px; height:2px; background:transparent; transition:background .12s; }
  .lw-ep-grip:hover::after, .lw-ep-grip.on::after { background:${T.accent}; }
  /* ── 双语对照 ✓（译文就挂在**每句下面** ✓ —— 精读要一句一句对着看 ✓）── */
  .lw-ep-tr { display:block; font-size:13px; line-height:1.95; color:${T.dim}; margin:2px 0 10px; padding-left:10px; border-left:1px solid ${T.lineDim};
    max-width:760px; }
  .lw-ep-tr.pending { color:${T.faint}; font-style:italic; }
  .lw-ep-tr.err { color:${T.red}; }
  /* ⚠️ 对照开着的时候句子**别再用 line-height:2.05** ✗ ——
     原文和译文叠一起会拉得特别高 ✗，一屏看不了几句 ✗。 */
  .lw-ep-body.tr .lw-ep-s { line-height:1.75; }
  .lw-ep-body.tr .lw-ep-p { margin-bottom:8px; }
  .lw-ep-p { margin:0 0 15px; }
  /* 句子 = 一个 span ✓ —— 点它选中 ✓，朗读时高亮 ✓，标记「已懂」变淡 ✓。
     行高给到 2.05 ✗：精读要**慢**，挤在一起没法看 ✗。
     ⚠️ padding 改成「4px 0」（原来是 1px ✗）—— inline 元素的**纵向 padding 不占布局** ✓
        （行高一点不变 ✓），但它**算进点击热区** ✓ →
        正好把行距撑出来的那条「**点不中的缝**」填掉一大半 ✓。
        （实测：line-height 2.05 下每行上下各约 7px 是死区 ✗，
          在缝里点句子**毫无反应** ✗ —— 用户会以为「点了没反应」✗。） */
  .lw-ep-s { font-size:15px; line-height:2.05; color:${T.text}; cursor:pointer; border-bottom:1px solid transparent; padding:4px 0; }
  .lw-ep-s:hover { background:${T.card2}; }
  .lw-ep-s.on { background:color-mix(in srgb, ${T.accent} 16%, transparent); border-bottom-color:${T.accent}; }
  .lw-ep-s.hl { background:color-mix(in srgb, ${T.ok} 22%, transparent); }
  .lw-ep-s.done { color:${T.faint}; }
  /* ★★ 正文里**已加进生词本**的词 ✓ —— 用户原话：
     「这种划词的单词，需要在原文中标记…方便后期我记单词」✓。
     ⚠️ 只是**下划线**还不够 ✗（读到第 30 句早忘了哪个标过 ✓）——
        所以给它一点底色 ✓，扫一眼就能看出「这句里有我记过的词」✓。
     ⚠️ 别用太重的样式 ✗：正文是用来读的 ✓，花哨了反而读不下去 ✓。
     ⚠️ 原来的 .lw-ep-s .wk / .lw-ep-sent .sp.have 两条规则**从来没接上线** ✗
        （类名对不上 ✓，属于死代码 ✓）—— 顺手删掉 ✓，换成下面这套真正在用的 ✓。 */
  .lw-ep-w { border-bottom:1px dotted ${T.accent}; cursor:pointer; font-weight:600; background:color-mix(in srgb, ${T.accent} 11%, transparent); }
  .lw-ep-w:hover { background:color-mix(in srgb, ${T.accent} 24%, transparent); }
  /* ★★ 「📍 回到原文」定位到的**那个词** ✓ —— 用户原话：
     「还有单词需要定位到大概位置」✓。
     ⚠️ 光把**句子**滚进视野是不够的 ✗：一句十几二十个词 ✓，
        用户还是得自己找那个词在哪儿 ✓。→ 给**那个词**加个更重的底 ✓ + 描边 ✓。
     ⚠️ 必须加 !important ✗ —— 上面「.lw-ep-sent .lw-ep-w」那条的**选择器权重更高** ✓，
        不加的话句子面板里那个词点不亮 ✓（实测踩过 ✓）。
     ⚠️ 这段注释里**一个反引号都不能有** ✗（CSS 装在 JS 模板串里 ✓，本会话栽过 6 次 ✗）。 */
  .lw-ep-w.focus { background:color-mix(in srgb, ${T.accent} 42%, transparent) !important; box-shadow:0 0 0 2px color-mix(in srgb, ${T.accent} 45%, transparent); border-radius:3px; }
  /* ── 右栏：句子详情 ── */
  .lw-ep-sent { font-size:13px; line-height:1.95; color:${T.text}; padding:12px 14px; border-left:1px solid ${T.accent}; background:${T.card}; margin:10px 0 4px; }
  /* ★ 这句里的已加生词 ✓ —— 和正文里**同一套**高亮 ✓（点一下也能看词卡 ✓）*/
  .lw-ep-sent .lw-ep-w { border-bottom:1px dotted ${T.accent}; cursor:pointer; font-weight:600; background:color-mix(in srgb, ${T.accent} 11%, transparent); }
  /* 这句的译文 ✓（单句翻译 / 整篇翻译都显示在这儿 ✓）*/
  .lw-ep-senttr { font-size:12.5px; line-height:1.9; color:${T.dim}; padding:2px 14px 0; border-left:1px solid ${T.lineDim}; margin-left:14px; }
  .lw-ep-act { display:flex; gap:6px; flex-wrap:wrap; padding:8px 14px 0; }
  .lw-ep-act button, .lw-ep-act .btn { height:24px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:9.5px ${UI}; cursor:pointer; }
  .lw-ep-act button:hover, .lw-ep-act .btn:hover { border-color:${T.accent}; color:${T.accent}; }
  /* ── 🧩 句子拆解（语法分析）✓ ──────────────────────────────────────────
     用户原话：「对句子进行拆解和分析，类似用英语语法的方式进行分析句子」✓。
     ⚠️ 结构**照抄「拆词」那一套** ✗（这个词根词缀模块里已经有了 ✓）——
        骨架 + 逐成分（片段 / 角色 / 中文）+ 时态语态 + 为什么这么写 + 句式 + 仿写 ✓。
        用户已经习惯了那个读法 ✓，换一套排版反而要多学一遍 ✓。 */
  .lw-ep-an { margin:10px 14px 0; border:1px solid ${T.lineDim}; border-left:1px solid ${T.ok}; }
  .lw-ep-an .hd { display:flex; align-items:center; gap:7px; flex-wrap:wrap; padding:8px 11px; border-bottom:1px solid ${T.lineDim}; font-size:10px; color:${T.faint}; }
  .lw-ep-an .hd b { font-size:11px; color:${T.text}; font-weight:600; }
  .lw-ep-an .hd .ai { margin-left:auto; font-size:9px; color:${T.faint}; }
  .lw-ep-an .row { display:flex; gap:8px; padding:7px 11px; border-bottom:1px solid ${T.lineDim}; }
  .lw-ep-an .row:last-child { border-bottom:0; }
  .lw-ep-an .row .k { flex:none; width:52px; font-size:9.5px; color:${T.faint}; padding-top:2px; }
  .lw-ep-an .row .v { flex:1; min-width:0; font-size:12px; line-height:1.85; color:${T.text}; }
  .lw-ep-an .skel { font-size:12.5px; line-height:1.9; color:${T.ok}; }
  /* 逐成分：英文片段用等宽 / 主题色 ✓，一眼和中文说明分开 ✓ */
  .lw-ep-an .p { display:flex; gap:8px; padding:6px 0; border-bottom:1px dotted ${T.lineDim}; }
  .lw-ep-an .p:last-child { border-bottom:0; }
  .lw-ep-an .p .en { flex:none; max-width:46%; font-size:11.5px; color:${T.accent}; word-break:break-word; }
  .lw-ep-an .p .rl { flex:1; min-width:0; font-size:11px; line-height:1.8; color:${T.dim}; }
  .lw-ep-an .p .rl i { font-style:normal; color:${T.faint}; }
  .lw-ep-an .note { font-size:11.5px; line-height:1.9; color:${T.text}; }
  .lw-ep-an .eg { font-size:11.5px; line-height:1.85; color:${T.dim}; }
  .lw-ep-an .miss { font-size:11px; color:${T.faint}; line-height:1.8; }
  .lw-ep-add { display:flex; gap:6px; padding:8px 14px 0; }
  /* ★★ 词卡 ✓ —— 用户原话：「还有下面这种音标和词义，不应该需要我来填写，去掉。
     应该和查词一样，显示给我」✓。
     → 原来那两个**手填输入框**已经删了 ✗，换成这一块自动显示 ✓。 */
  .lw-ep-peek { margin:8px 14px 0; padding:10px 12px; border:1px solid ${T.lineDim}; background:${T.card}; border-left:1px solid ${T.accent}; }
  .lw-ep-peek .hd { display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; }
  .lw-ep-peek .hd b { font-size:15px; color:${T.text}; letter-spacing:.4px; }
  .lw-ep-peek .ph { font-size:11.5px; color:${T.accent}; font-family:inherit; }
  .lw-ep-peek .ph.warn { color:${T.warn}; }
  .lw-ep-peek .pos { font-size:10px; color:${T.dim}; border:1px solid ${T.lineDim}; padding:0 5px; }
  .lw-ep-peek .df { font-size:12.5px; color:${T.text}; margin-top:6px; line-height:1.7; }
  .lw-ep-peek .df.warn { color:${T.warn}; }
  .lw-ep-peek .eg { font-size:11.5px; color:${T.dim}; margin-top:7px; line-height:1.7; border-left:1px solid ${T.lineDim}; padding-left:8px; }
  .lw-ep-peek .egzh { font-size:11px; color:${T.faint}; margin-top:2px; padding-left:10px; }
  .lw-ep-peek .mnem { font-size:11.5px; color:${T.dim}; margin-top:7px; line-height:1.7; }
  .lw-ep-add input { flex:1; min-width:0; height:26px; padding:0 8px; border:1px solid ${T.lineDim}; background:${T.bg2}; color:${T.text}; font:11.5px ${UI}; outline:none; }
  .lw-ep-add input:focus { border-color:${T.accent}; }
  .lw-ep-add button { height:26px; padding:0 10px; border:1px solid ${T.accent}; background:transparent; color:${T.accent}; font:10px ${UI}; cursor:pointer; }
  .lw-ep-add button:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-ep-tip { padding:6px 14px 0; font-size:9.5px; color:${T.faint}; line-height:1.85; }
  /* ── 生词本 ── */
  /* ★★ 性能：content-visibility:auto ✗✗ ——
     词书一筛就是 **1979 行** ✓（每行 6~8 个元素 + 一张缩略图 ✓，
     整个面板 DOM 一万四千多个节点 ✓）。整块重建之后浏览器要**全部布局 + 绘制** ✗，
     实测点一个词到下一帧要 **3 秒** ✓（用户反馈「点击单词加载时间太长，很卡顿」✓）。
     content-visibility:auto 让浏览器**跳过屏幕外那些行** ✓ ——
     只算可见的十几行 ✓，滚到哪儿才渲染哪儿 ✓。
     ⚠️ 必须配 contain-intrinsic-size ✗ —— 否则屏幕外的行高度算 0 ✓，
        滚动条会乱跳 ✓、滚到后面位置全错 ✓。
        用 auto 52px ✓（先按 52px 估 ✓，量过之后记住真实高度 ✓）。
     ⚠️⚠️ 这一段是**模板字符串** ✗ —— 注释里**不能出现反引号** ✓（我在这上面栽两次了 ✓）。 */
  .lw-wd-row { display:flex; align-items:center; gap:8px; padding:8px 13px; content-visibility:auto; contain-intrinsic-size:auto 52px; border-bottom:1px solid ${T.lineDim}; cursor:pointer; border-left:1px solid transparent; }
  .lw-wd-row:hover { background:${T.card2}; }
  .lw-wd-row.on { background:${T.card2}; border-left-color:${T.accent}; }
  .lw-wd-row .w { font-size:12.5px; color:${T.text}; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-wd-row .df { font-size:10px; color:${T.faint}; margin-left:auto; flex:none; }
  /* 列表里的小缩略图 ✓ —— 36px 见方 ✓，不占地方但扫一眼就能想起来 ✓ */
  .lw-wd-thumb { width:34px; height:34px; flex:none; object-fit:cover; border:1px solid ${T.lineDim}; }
  .lw-wd-dot { width:7px; height:7px; border-radius:50%; flex:none; background:${T.faint}; }
  .lw-wd-dot.fresh { background:${T.dim}; }
  .lw-wd-dot.learning { background:${T.warn}; }
  .lw-wd-dot.young { background:${T.accent}; }
  .lw-wd-dot.mature { background:${T.ok}; }
  .lw-wd-hd { font-size:11px;   color:${T.faint}; padding:12px 13px 6px; }
  .lw-wd-big { font-size:22px; color:${T.text}; padding:14px 14px 0; line-height:1.3; }
  .lw-wd-ph { font-size:11.5px; color:${T.dim}; padding:4px 14px 0; }
  .lw-wd-def { font-size:12.5px; color:${T.text}; padding:10px 14px 0; line-height:1.9; }
  .lw-wd-eg { font-size:11px; color:${T.dim}; padding:8px 14px 0; line-height:1.9; border-left:1px solid ${T.lineDim}; margin:8px 14px 0; }
  /* ⚠️⚠️ 词卡里的**水平间距只能有一条基准线**（16px）✗✗ ——
     踩过 ✗：.lw-wd-sec 自己已经有 16px 内边距 ✓，而 .lw-wd-next / .lw-wd-hist /
     .lw-wd-ef 这几条是**旧版词卡**留下的 ✓（那时它们不在 sec 里 ✓），各自又带了 14px ✗
     → 复习区块里的文字被**双重缩进成 30px** ✗，
     比同一张卡上的释义 / 例句明显右移一截 ✗（截图一眼就看出来了 ✓）。
     → 规矩：**.lw-wd-sec 的子元素一律不许再写水平 padding / margin** ✗，
        只写 margin-top ✓；要离边就用 .lw-wd-sec 的 padding ✓。
     ⚠️ 这条注释里不许出现反引号 ✗（CSS 装在 JS 模板串里 ✓，本会话已经栽过 4 次 ✗）。 */
  .lw-wd-hist { display:flex; gap:3px; flex-wrap:wrap; margin-top:8px; }
  .lw-wd-hist i { width:11px; height:11px; display:block; border:1px solid ${T.lineDim}; }
  .lw-wd-hist i.ok { background:${T.ok}; border-color:${T.ok}; }
  .lw-wd-hist i.bad { background:${T.red}; border-color:${T.red}; }
  .lw-wd-hist i.hard { background:${T.warn}; border-color:${T.warn}; }
  .lw-wd-next { font-size:10.5px; color:${T.dim}; line-height:1.9; }
  .lw-wd-next b { color:${T.accent}; font-weight:400; }
  /* ══ 词详情：**词典式**排版 ✓ ══════════════════════════════════════════
     ★ 用户原话：「这个词的详情，一般不需要我去修改，所以不用是这种输入框，
       大概设计和字典那样就行，美化，优化一下布局和设计，
       让人可以直观的学习和理解这个单词」✓。
     ⚠️ 默认**一个输入框都没有** ✗ —— 全是「读」的排版 ✓；
        想改才点「✏️ 编辑」✓（能力没砍 ✗，只是不挡路 ✓）。 */
  /* ⚠️⚠️ 词卡**自己得能滚** ✗✗ —— 父级 .lw-rd-read 是 overflow:hidden ✓，
     而词卡改成词典式之后**明显变高** ✓（分条释义 + 例句高亮 + 巧记 / 场景框 ✓）：
     实测内容 1014px / 可视区 769px ✓ → 底部的「🪄 AI 补全 / 🖼 换一张 / 🗑 删除」
     **鼠标滚轮滚不到** ✗（只有脚本能滚 ✓ —— 所以端到端探针**照样全绿** ✗，
     是「探针点得到、用户够不着」✗ 这种最阴的 ✓；靠「scrollHeight 大于 clientHeight」才量出来 ✓）。
     → 抄外刊精读正文面板那套 ✓（.lw-ep-body 就是 flex:1 + min-height:0 + overflow:auto ✓）。
     ⚠️ 别去动 .lw-rd-read ✗ —— 那个类名被**四个模式共用** ✓
        （电子书 / 外刊 / 词根 / 生词本 ✓），动它等于一次改四处 ✗。 */
  /* ★ container-type:inline-size ✓ —— 让下面那个「几栏」的判断看**卡片自己的宽度** ✗，
     而不是视口宽度 ✗（2026-10-17 实测：词表侧栏是**固定 419px** ✓，
     卡片宽度 = 视口 − 875px ✓ → 1200px 的窗口卡片只有 **325px** ✓，
     两栏各 150px ✓，字全被挤成一列一个 ✓。视口断点根本对不上 ✓）。 */
  .lw-wd-detail { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding:0 0 20px; container-type:inline-size; }
  /* 编辑区那个标题复用了侧栏的 .lw-rd-hd ✓ —— 它自带 13px 左右边距 ✗，
     跟词卡的 16px 基准线差 3px ✓（单独看不出来 ✓，和下面的输入框并排就露馅 ✗）→ 在卡里覆盖掉 ✓。 */
  .lw-wd-detail .lw-rd-hd { padding-left:16px; padding-right:16px; }
  .lw-wd-top { padding:16px 16px 13px; border-bottom:1px solid ${T.lineDim}; }
  .lw-wd-title { display:flex; align-items:center; gap:6px; }
  .lw-wd-title .w { font-size:26px; line-height:1.3; color:${T.text}; font-weight:600; letter-spacing:.4px; cursor:pointer; word-break:break-word; }
  .lw-wd-title .w:hover { color:${T.accent}; }
  .lw-wd-title .spk { flex:none; width:28px; height:28px; border:1px solid ${T.lineDim}; border-radius:50%; background:transparent; color:${T.dim}; font-size:12px; cursor:pointer; }
  .lw-wd-title .spk:hover { border-color:${T.accent}; color:${T.accent}; }
  /* ★ 熟练度星标 ✓ —— 三态：未标（灰）→ 不熟悉（黄）→ 完全不记得（红）✓。
     颜色**硬编码** ✗（不走主题变量 ✓）—— 「警告黄 / 危险红」是有语义的 ✓，
     跟着主题色变反而看不出严重程度 ✗。 */
  /* ⚠️ 四个按钮**挤在一起** ✓（外面那个 span 负责 gap ✓）—— 单个按钮缩到 30px ✓，
     不然加上单词 / 发音 / 编辑，标题栏会被撑爆 ✗。 */
  .lw-wd-title .lw-wd-marks { flex:none; display:flex; gap:3px; }
  .lw-wd-title .mark { flex:none; min-width:30px; height:28px; padding:0 3px; border:1px solid ${T.lineDim}; border-radius:8px; background:transparent; color:${T.faint}; cursor:pointer; font-size:12px;
    line-height:1; display:flex; align-items:center; justify-content:center; }
  .lw-wd-title .mark:hover { border-color:${T.accent}; }
  .lw-wd-title .mark.on-fuzzy { color:var(--pp-warn); border-color:color-mix(in srgb, var(--pp-warn) 60%, transparent); background:color-mix(in srgb, var(--pp-warn) 12%, transparent); }
  .lw-wd-title .mark.on-blank { color:var(--pp-err); border-color:color-mix(in srgb, var(--pp-err) 60%, transparent); background:color-mix(in srgb, var(--pp-err) 12%, transparent); }
  .lw-wd-title .mark.on-confuse { color:var(--pp-accent); border-color:color-mix(in srgb, var(--pp-accent) 60%, transparent); background:color-mix(in srgb, var(--pp-accent) 12%, transparent); }
  .lw-wd-title .mark.on-trap { color:var(--pp-warn); border-color:color-mix(in srgb, var(--pp-warn) 60%, transparent); background:color-mix(in srgb, var(--pp-warn) 12%, transparent); }
  .lw-wd-title .sp { flex:1; }
  .lw-wd-title .ed { flex:none; height:26px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent; color:${T.faint}; font:10.5px ${UI}; cursor:pointer; }
  .lw-wd-title .ed:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-wd-title .ed.on { border-color:${T.accent}; color:${T.accent}; }
  .lw-wd-sub { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; margin-top:8px; }
  .lw-wd-sub .ph { font-size:15px; color:${T.accent}; letter-spacing:.3px; }
  .lw-wd-sub .ph.miss { font-size:11px; color:${T.warn}; }
  .lw-wd-sub .pos { font-size:11px; color:${T.dim}; border:1px solid ${T.lineDim}; padding:0 6px; }
  .lw-wd-sub .tag { font-size:10px; color:${T.faint}; border:1px solid ${T.lineDim}; padding:0 6px; }
  .lw-wd-sub .tag.warn { color:${T.warn}; border-color:${T.warn}; }
  /* ★ 排版优化（第二轮）✓ —— 用户：「继续优化一下排版」✓。
     ⚠️ 原来 14px ✗ → 15px → 现在 20px ✓：十几个区块紧贴着排，
        视线没有落脚点 ✗；拉开一点才有「一段一段读」的节奏 ✓。
     ⚠️ 这是**顶部内边距** ✗（区块之间靠它撑开 ✓），不是 margin ✗ ——
        和上面那条「子元素不许写水平 padding」的规矩不冲突 ✓（这是纵向的 ✓）。 */
  /* ★★ 左右两列 ✓✓ —— 用户原话：「是否可以考虑左右排布，不要把页面拉的很长，
     需要滚轮去翻页面」✓。
     ⚠️ 原来是**十几个区块一路竖排** ✗（截图里得滚好几屏 ✓），
        而右半边**大片空白** ✗（配图只有小小一块 ✓）—— 两头浪费 ✓。
     → hero（释义 + 例句 | 配图）**保持全宽** ✓（它本身就是两列 ✓），
       **下面那堆参考资料分左右两栏** ✓：左栏放「怎么记」（巧记 / 场景 ✓），
       右栏放「查什么」（考频 / 词形 / 短语 / 用法 / 真题 / 同反义 / 拓展 ✓）。
     ⚠️ align-items:start 不能省 ✗ —— 不加的话两栏会被拉成等高 ✓，
        左栏底下留一大块空白 ✗（和之前 hero 那个坑同源 ✓）。
     ⚠️ 窄屏（小于 1100px）**退回单列** ✗ —— 两栏挤在一起比一栏还难读 ✓。
     ⚠️ 注释里别写反引号 ✗（这是 CSS 模板字符串 ✓，会提前终止 ✓）。 */
  /* ★★ 改用**真瀑布流**（CSS columns）✗✗ —— 用户截图：「左侧空白太多」✓。
     ⚠️ 第一版是 grid 两栏**手动分组** ✗（左栏巧记/场景 ✓、右栏其余 7 块 ✓）——
        结果**严重不均衡** ✗：abnormal 的巧记+场景很短 ✓，左栏早早结束 ✓，
        下面空出一大片 ✗（截图里就是这个问题 ✓）。
     → columns 由**浏览器自己按高度平衡** ✓，块数/高度怎么变都不会空 ✓✓。
     ⚠️ break-inside:avoid 必须有 ✗ —— 不然一个区块会被从中间劈到两栏 ✓
        （标题在这栏、内容在那栏 ✓，完全没法读 ✓）。
     ⚠️ 阅读顺序变成「先左栏到底、再右栏」✗（不再是左右交替 ✓）——
        对「上面 7 块参考资料」这种并列内容完全没问题 ✓。
     ⚠️ 窄屏退回单列 ✗。
     ⚠️⚠️ 这一段在 **CSS 模板字符串** 里 ✗ —— 注释里**一个反引号都不能有** ✗
        （踩过三次了 ✓ 每次都让整个文件语法错误 ✓）。 */
  /* ★★★ 改回 grid 两栏 + **手动分组** ✓✓✓ ——
     columns 试过三版都不行 ✗：它**自己决定每个块分到哪栏** ✓，
     不管我怎么调结构 ✓（标签配对核对过是平衡的 ✓，但「复习」仍被分到左栏 ✗）。
     ⇒ 换成 grid：**每个块放哪栏由我说了算** ✓✓。
     分组依据（用户要「填补右侧的空白」✓）：
       左栏 = 怎么记 + 基础信息（巧记/场景/考频/词形/短语/用法 ✓）
       右栏 = 参考资料 + **复习**（真题/同反义/拓展/复习 ✓）
     ⚠️ 「复习」放**右栏** ✗ 而不是全宽 ✗ —— 右栏本来就短 ✓，
        把它放进去两栏自然就齐了 ✓✓，**不用碰 column-span / 跨栏** ✗✓。
     ⚠️ align-items:start 不能省 ✗ —— 否则两栏被拉成等高 ✓，短的那栏底下留空白 ✗。 */
  .lw-wd-cols { columns:2; column-gap:22px; }
  /* ⚠️ 判断依据是**卡片宽度** ✓ 不是视口 ✗ —— 见 .lw-wd-detail 上那段 ✓。
     700px 是实测出来的：两栏各 ~330px 才够读 ✓（600px 的卡片两栏各 290 ✓ 勉强 ✓，
     425px 的卡片两栏各 200 ✓ 就挤成一列一个字了 ✗）。 */
  @container (max-width: 700px) { .lw-wd-cols { columns:1; } }
  /* 兜底 ✓ —— 不支持容器查询的老浏览器按视口退回单栏 ✓（1560 是实测的拐点 ✓）。 */
  @media (max-width: 1560px) { .lw-wd-cols { columns:1; } }
  /* ⚠️ break-inside:avoid 必须有 ✗ —— 不然一个区块会被从中间劈到两栏 ✓
     （标题在这栏、内容在那栏 ✓，完全没法读 ✓）。 */
  .lw-wd-sec { padding:20px 16px 0; break-inside:avoid; }
  /* ★ 排版改进 ✓ —— 用户原话：「内容深度不够，排版不好」✓。
     ⚠️ 原来区块标题是 10px + faint 色 ✗ —— 又小又淡 ✓，
        十几个区块排下来整页像一锅粥 ✗，找不到「释义在哪、例句在哪」✗。
     → ① 字号 10 → 11.5px ✓ ② 颜色 faint → dim ✓ ③ 加粗 ✓
       ④ 左侧加一根**主题色小竖条** ✓ —— 视线能顺着竖条扫下来 ✓，
          区块边界一眼分明 ✓（比加分割线轻 ✗，不会把页面切碎 ✗）。
     ⚠️ 这段是 CSS 模板字符串 ✗✗ —— 注释里**不能写反引号** ✗（会提前终止字符串 ✗），
        也**不能写美元花括号插值写法** ✗（会被求值 ✗）。两种都踩过 ✓。 */
  .lw-wd-sec .hd { display:flex; align-items:center; gap:6px; margin-bottom:9px; font-size:11.5px; letter-spacing:.5px; color:${T.dim}; font-weight:600; }
  .lw-wd-sec .hd::before { content:''; flex:none; width:3px; height:13px; border-radius:3px; background:${T.accent}; opacity:.75; }
  .lw-wd-sec .hd .ic { font-size:13px; letter-spacing:0; }
  /* 释义：**主角** ✓ —— 字号最大 ✓，多义项编号 ✓（词典就是这么排的 ✓）*/
  .lw-wd-defs { margin:0; padding:0; list-style:none; }
  .lw-wd-defs li { position:relative; padding-left:21px; margin-bottom:3px; font-size:15px; line-height:1.85; color:${T.text}; }
  .lw-wd-defs li i { position:absolute; left:0; top:0; font-style:normal; font-size:11px; color:${T.faint}; line-height:2.5; }
  .lw-wd-defs.one { font-size:15px; line-height:1.85; color:${T.text}; }
  /* ★ 释义 + 右边的小标签（词群 / 六级考频）✓（2026-10-17）——
     用户原话：「直接标注在释义那边右侧空白不就行，本身就是简短说明」✓。
     ⚠️ margin-left:auto 把它推到**右边** ✓；窄的时候 flex-wrap 让它掉到释义**下面** ✓，
        仍然右对齐 ✓（一行脚注，比两个区块省 150px 以上 ✓）。 */
  .lw-wd-defrow { display:flex; flex-wrap:wrap; align-items:flex-start; gap:5px 18px; }
  .lw-wd-defcol { flex:1 1 auto; min-width:0; }
  .lw-wd-meta { flex:0 0 auto; margin-left:auto; display:flex; flex-direction:column; gap:4px; align-items:flex-end; text-align:right; max-width:340px; }
  .lw-wd-meta .lw-wd-mt { font-size:11px; line-height:1.75; color:${T.dim}; }
  .lw-wd-meta .lw-wd-mt i { font-style:normal; color:${T.faint}; margin-right:5px; }
  .lw-wd-meta .lw-wd-mt.freq i { margin-right:0; }
  .lw-wd-meta .lw-wd-badge { margin-right:6px; }
  .lw-wd-miss { font-size:12px; color:${T.faint}; line-height:1.8; }
  /* 例句：英文 + 中文对照 ✓，**本词高亮** ✓ */
  .lw-wd-eg-en { font-size:13.5px; line-height:1.85; color:${T.text}; padding-left:10px; border-left:1px solid ${T.accent}; }
  .lw-wd-eg-zh { font-size:12px; line-height:1.8; color:${T.dim}; margin-top:5px; padding-left:12px; }
  .lw-wd-hit { color:${T.accent}; font-weight:600; border-bottom:1px solid ${T.accent}; }
  .lw-wd-secact { display:flex; gap:6px; margin-top:8px; }
  .lw-wd-secact button, .lw-wd-src button { height:24px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10px ${UI}; cursor:pointer; }
  .lw-wd-secact button:hover, .lw-wd-src button:hover { border-color:${T.accent}; color:${T.accent}; }
  /* 巧记 / 场景：高亮框 ✓（一眼看到 ✓，不用在表单里找 ✓）*/
  /* ⚠️ 色块**调淡** ✗（10% → 6.5% / 9% → 5.5%）+ 竖条 3px → 2px + 右侧圆角 ✓ ——
     用户截图里巧记/场景两块**绿黄一大片** ✗，抢了释义的视线 ✓；
     它们本来就是**辅助信息** ✓，淡淡的提示一下就够了 ✓。 */
  .lw-wd-tipbox { font-size:12.5px; line-height:1.9; color:${T.text}; padding:10px 13px; border-radius:8px 7px 7px 0; }
  .lw-wd-tipbox.mnem { background:color-mix(in srgb, ${T.accent} 6.5%, transparent); border-left:1px solid color-mix(in srgb, ${T.accent} 65%, transparent); }
  .lw-wd-tipbox.scene { background:color-mix(in srgb, ${T.ok} 5.5%, transparent); border-left:1px solid color-mix(in srgb, ${T.ok} 65%, transparent); }
  /* ★ 列表行的星标 ✓ —— 颜色硬编码 ✗（黄/红有语义 ✓，同卡片头部 ✓）。 */
  .lw-wd-mk { flex:none; font-size:9px; line-height:1; margin-left:2px; letter-spacing:-1px; }
  /* ★ 列表里的词群标记 ✓（有词群的词挂个 🗂 ✓）。 */
  .lw-wd-grp { flex:none; font-size:9px; line-height:1; margin-left:2px; opacity:.85; }
  /* ★ 词群栏的滚动容器 ✓ —— 全书 174 个词群 ✗，不限高会把侧栏撑到几屏 ✓。
     缩进 22px 区分于上面那些一级分组 ✓，字号略小一点 ✓。 */
  .lw-rd-grps { max-height:240px; overflow-y:auto; overflow-anchor:none; }
  .lw-rd-grps .lw-rd-row { padding-left:22px; font-size:10.5px; }
  .lw-wd-mk.fuzzy { color:var(--pp-warn); }
  .lw-wd-mk.blank { color:var(--pp-err); }
  .lw-wd-mk.confuse { color:var(--pp-accent); }
  .lw-wd-mk.trap { color:var(--pp-warn); }
  /* ★ 考频徽章 ✓ —— 「高频」要一眼看见 ✓，平铺成一行文字就淹了 ✗。
     颜色**硬编码** ✗（红/黄/灰 = 严重程度 ✓，跟主题色变就失去意义 ✗）。 */
  .lw-wd-badge { display:inline-block; padding:2px 9px; border-radius:8px; font-size:11px; font-weight:600; letter-spacing:.3px; }
  .lw-wd-badge.hi { color:var(--pp-err); background:color-mix(in srgb, var(--pp-err) 13%, transparent); border:1px solid color-mix(in srgb, var(--pp-err) 35%, transparent); }
  .lw-wd-badge.mid { color:var(--pp-warn); background:color-mix(in srgb, var(--pp-warn) 13%, transparent); border:1px solid color-mix(in srgb, var(--pp-warn) 35%, transparent); }
  .lw-wd-badge.lo { color:${T.dim}; background:${T.lineDim}; border:1px solid ${T.lineDim}; }
  /* ★ 标签云 ✓ —— 同义词 / 反义词 / 词形变化用标签排 ✓，
     比一行逗号连缀好扫 ✓（用户要「全方位拆解」✓，排得清爽才看得下去 ✓）。 */
  .lw-wd-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:3px; }
  .lw-wd-tags span { padding:2px 10px; border-radius:8px; font-size:12px; line-height:1.75; background:color-mix(in srgb, ${T.accent} 11%, transparent); color:${T.text}; }
  .lw-wd-tags.ant span { background:color-mix(in srgb, var(--pp-err) 11%, transparent); }
  /* ★★ 词根词缀拆解 ✓ —— 用户原话：「帮我给单词，补充词根词缀的说明，那种，
     全部词都要，新增词根词缀说明拆解等，合理布局」✓。
     读法：一排**部件胶囊**，中间的加号把它们串起来 ✓。
     胶囊上的字母**连起来就是这个单词** ✓（前缀带尾横、后缀带首横 ✓）——
     学习者一眼就能看到「哪一块是词根、哪一块是前后缀」✓。
     ⚠️ 颜色按类型分 ✗：前缀橙 / 词根黄（主角）/ 后缀绿 / 词干灰 / 词尾淡灰 ✓。
        这套颜色和「巧记（黄）· 场景（绿）」是一脉的 ✓，不引入新色 ✓。
     ⚠️ 这一段在 **CSS 模板字符串** 里 ✗✗ —— 注释里**一个反引号都不能有** ✗。 */
  /* ★★ 词根词缀：**全宽横排** ✓（2026-10-17 重排，用户：「重新合理排布，目前排布不合理」✓）——
     胶囊一行排开 ✓，「→ 拼出来的意思 / 同族」跟在**右边** ✓，
     放不下时 flex-wrap 自己折行 ✓（窄屏就变成上下的老样子 ✓，不用写媒体查询 ✓）。 */
  .lw-wd-rd { display:flex; flex-wrap:wrap; align-items:center; gap:10px 22px; }
  .lw-wd-rd .chips { display:flex; flex-wrap:wrap; align-items:stretch; gap:7px; }
  /* ⚠️ 加号和胶囊包成一个 unit ✗ —— 不然窄一点加号会孤零零留在上一行 ✓（截图见过 ✓）。 */
  .lw-wd-rd .unit { display:flex; align-items:stretch; gap:7px; flex:none; }
  /* ★ 意思 + 说明**横排**（放不下自己折行 ✓）—— 竖排会多占一行高度 ✓，
     横排还能把整条撑得宽一点 ✓，右侧不至于空一大截 ✓。 */
  .lw-wd-rd .tail { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 20px; min-width:0; flex:1 1 320px; }
  .lw-wd-rd .pc { display:flex; flex-direction:column; justify-content:center; gap:1px; padding:7px 12px 8px; border-radius:8px; border:1px solid; min-width:0; max-width:230px; }
  .lw-wd-rd .pc .k { font-size:8.5px; letter-spacing:.8px; opacity:.85; line-height:1.2; }
  .lw-wd-rd .pc .s { font-family:${MONO}; font-size:15px; font-weight:600; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lw-wd-rd .pc .m { font-size:10.5px; line-height:1.45; opacity:.92; }
  .lw-wd-rd .pc.pre { color:${T.warn}; border-color:color-mix(in srgb, ${T.warn} 36%, transparent); background:color-mix(in srgb, ${T.warn} 9%, transparent); }
  .lw-wd-rd .pc.root { color:${T.accent}; border-color:color-mix(in srgb, ${T.accent} 44%, transparent); background:color-mix(in srgb, ${T.accent} 11%, transparent); }
  .lw-wd-rd .pc.suf { color:${T.ok}; border-color:color-mix(in srgb, ${T.ok} 36%, transparent); background:color-mix(in srgb, ${T.ok} 9%, transparent); }
  .lw-wd-rd .pc.stem { color:${T.dim}; border-color:${T.lineDim}; background:${T.bg2}; }
  .lw-wd-rd .pc.end { color:${T.faint}; border-color:${T.lineDim}; background:transparent; }
  .lw-wd-rd .plus { align-self:center; flex:none; color:${T.faint}; font-size:13px; line-height:1; }
  .lw-wd-rd .gloss { font-size:12.5px; line-height:1.85; color:${T.text}; }
  .lw-wd-rd .gloss b { color:${T.accent}; font-weight:600; }
  .lw-wd-rd .note { font-size:11.5px; line-height:1.8; color:${T.dim}; }
  .lw-wd-rd .base { align-self:flex-start; padding:3px 10px; border-radius:8px; font-size:11px; line-height:1.7; color:${T.dim}; background:${T.lineDim}; }
  .lw-wd-src { font-size:12px; color:${T.dim}; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .lw-wd-pv { display:flex; gap:10px; flex-wrap:wrap; margin-top:7px; font-size:10.5px; color:${T.faint}; }
  .lw-wd-pv b { color:${T.dim}; font-weight:400; }
  /* 新词阶段四档会重合 ✓ → 补一句解释 ✓（⚠️ 别加水平 padding ✗，见上面的基准线规矩 ✓）*/
  .lw-wd-pvnote { font-size:10px; color:${T.faint}; margin-top:5px; line-height:1.8; }
  .lw-wd-ef { font-size:10.5px; color:${T.faint}; margin-top:7px; }
  .lw-wd-ef b { color:${T.dim}; font-weight:400; }
  /* 底部动作条 ✓ —— **真的常驻** ✓，不跟内容一起滚走 ✓（想补全时不用往上翻 ✓）。
     ⚠️⚠️ 这条注释以前是**假的** ✗✗ —— 写的是「常驻」✓，实现却是普通流 ✓，
        词卡一变高它就跟着滚出视野 ✗（本次实测才发现 ✓）。
        → 改成 position:sticky + bottom:0 ✓（父级 .lw-wd-detail 就是滚动容器 ✓）。
     ⚠️ 必须给**不透明底色** ✗ —— 不然内容会从按钮底下透出来 ✓（.lw-rd-read 本身没底色 ✓，
        继承下来就是 T.bg ✓，和卡片一致 ✓）。
     ⚠️ 状态提示（正在补全 / 报错）要放在它**前面** ✗ —— 否则被压在底下看不见 ✓。 */
  .lw-wd-foot { position:sticky; bottom:0; z-index:2; background:${T.bg}; display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:16px 16px 0; padding-top:13px; border-top:1px solid ${T.lineDim}; }
  .lw-wd-foot .sp { flex:1; }
  .lw-wd-foot button { height:28px; padding:0 11px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:10.5px ${UI}; cursor:pointer; }
  .lw-wd-foot button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-wd-foot button.on { border-color:${T.accent}; color:${T.accent}; }
  .lw-wd-foot button.danger { border-color:${T.lineDim}; color:${T.faint}; }
  .lw-wd-foot button.danger:hover { border-color:${T.red}; color:${T.red}; }
  /* ── 生词卡片：一行「标签 + 控件」✓（音标 / 词性 / 释义 / 例句 / 巧记 / 场景 共用 ✓）──
     ⚠️⚠️ 类名**不能叫 .lw-wd-row** ✗✗ —— 那个**已经被生词列表项占了** ✗
        （「epWordRowHtml」 里的 「<div class="lw-wd-row">」 ✓）。
        我第一版就叫了这个名 ✗ → 两套规则叠在一起 ✓ →
        列表项会继承 「align-items:flex-start」 ✓、面板里的行会继承 「align-items:center」 ✓，
        **两边一起坏** ✗，而且 CSS 里两条同名规则谁赢只看先后 ✗，极难查 ✗。
        （这个项目在 「.lw-tr」 上栽过一模一样的跟头 ✓，见 skill 里那条 ✓。）
        → 改成 「.lw-wd-f」（field ✓），和列表项彻底分开 ✓。
     ⚠️ 标签**固定宽** ✗ —— 不固定的话每个输入框的左边参差不齐 ✗，一眼就乱 ✗。 */
  .lw-wd-f { display:flex; gap:9px; align-items:flex-start; padding:7px 16px 0; }
  .lw-wd-f label { flex:none; width:56px; padding-top:5px; font-size:10.5px; color:${T.faint}; }
  .lw-wd-f input, .lw-wd-f textarea { flex:1; min-width:0; border:1px solid ${T.lineDim}; background:${T.bg2}; color:${T.text}; font:11.5px/1.75 ${UI}; padding:5px 8px; outline:none; resize:vertical; }
  .lw-wd-f input:focus, .lw-wd-f textarea:focus { border-color:${T.accent}; }
  .lw-wd-f input::placeholder, .lw-wd-f textarea::placeholder { color:${T.faint}; }
  /* ── 配图 ✓（用户要的「图片场景理解」✓）── */
  .lw-wd-imgwrap { margin:10px 16px 0; border:1px solid ${T.lineDim}; background:${T.bg2}; }
  /* ★★ 释义 + 配图**并排** ✓（用户原话：「中间这个图片，百度图片，
     放置的位置不合理，左右存在大量空白，图片两边，合理重新排布一下位置设计」✓）——
     ⚠️ 原来是**上下堆** ✗：图占一整宽 ✓，而配图**常常是竖图** ✓ →
        图只占中间一小条 ✓ → 左右各空一大片 ✗（截图里就是这样 ✓）。
     → 释义和图**并排** ✓：左边读释义 ✓、右边看图 ✓，横向空间就用起来了 ✓。
     ⚠️ 图片列**要有上限** ✗（max-width ✓）：不给的话横图会撑到半屏 ✓，
        把释义挤成一条 ✓；也不写死像素 ✗（窄窗口会溢出 ✓）。
     ⚠️ 没释义时**不并排** ✗（那就只放图 ✓，别留一个空列 ✓）。 */
  /* ★★ 释义 / 词根词缀 / 配图 **三列** ✓（2026-10-17 第二次重排 ✓）——
     用户原话：「图片左边，有一大块空白，这是可以把词根词缀放这空白处」✓。
     ⚠️ 空白是「短内容撑不满宽列」造成的 ✓（例句 48 字只用 225px，列宽 719px ✗），
        所以让词根词缀去填 ✓，而不是把列改窄 ✗。
     ⚠️ 三列都用**明确的 flex-basis** ✗ —— 用 flex:1 让浏览器自己分的话，
        长例句的词会被挤成一条 ✓（bacterial 315 字的例句在 380px 下要排十几行 ✗）。 */
  .lw-wd-hero { display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; padding:0 16px; }
  /* ⚠️ 文本列的 basis 用 **300** 不是 380 ✗ —— 380 时 380+260（配图）已经 654 ✓，
     比窄卡片（625 的卡片里可用 593）还宽 ✓ → 换行规则按 basis 算 ✓，
     于是「释义」和「配图」被拆到两行 ✗（老用户明确要过「释义和配图并排」✗）。
     300 + 260 + 14 = 574 ≤ 593 ✓ → 窄卡片里它俩**先并排** ✓，
     词根那一列再掉到下一行 ✓（变成整宽一条 ✓）。 */
  .lw-wd-hero-a { flex:1 1 300px; min-width:0; order:1; }
  .lw-wd-hero-rd { flex:1 1 300px; min-width:0; max-width:360px; order:2; }
  .lw-wd-hero-b { flex:0 0 260px; min-width:140px; max-width:280px; order:3; }
  /* 三列挤不下（300+300+260+28 = 888 → 卡片 < 920）时 ✓：
     ① 词根那一列**独占整行** ✓（不然它只有 360 宽 ✓，右边空一截 ✓，等于把刚填掉的空白又造出来 ✗）；
     ② 配图**排到词根前面** ✓ —— ⚠️ 换行是**按 order 之后的顺序**算的 ✗，
        DOM 顺序是「文本 / 词根 / 配图」✓，不调的话窄卡片会变成「文本」+「词根+配图」✗，
        「释义和配图并排」那条就没了 ✗（实测当场红过 ✓）。 */
  @container (max-width: 920px) { .lw-wd-hero-rd { max-width:none; order:3; }
    .lw-wd-hero-b { order:2; }
  }
  /* 并排之后，内边距由**外层**统一给 ✓（子元素再给就是双重缩进 ✗）*/
  .lw-wd-hero .lw-wd-sec { padding-left:0; padding-right:0; }
  .lw-wd-hero .lw-wd-imgwrap { margin:14px 0 0; }
  .lw-wd-hero .lw-wd-imgwrap .cap { font-size:9px; padding:3px 6px; }
  /* ⚠️ 用 contain ✗ **不用 cover** ✗ ——
     配图的用途是「图片场景理解」✓，cover 会把一张 16:9 的图**裁掉近一半**✗
     （700 宽下自然高 394 ✓ → 硬压到 210 ✓ → 竖着砍 46% ✗），
     主体（人 / 物）十有八九正好在裁掉的那半里 ✗。
     宁可留点边（底色就是 .lw-wd-imgwrap 的 bg2 ✓，看着像相框 ✓），也要让人**看全** ✓。
     ⚠️ 上面这几行**绝对不能出现反引号** ✗ —— 这段 CSS 装在 JS 模板字符串里 ✓，
        一个反引号就把字符串截断 ✓ → 整个面板白屏 ✗（本会话已经栽过 3 次 ✗）。 */
  .lw-wd-img { display:block; width:100%; max-height:260px; object-fit:contain; }
  /* ⚠️ 图挂了要**收起来** ✗（破图标很难看 ✗）—— 「onerror」 加 .bad ✓ */
  .lw-wd-imgwrap.bad { display:none; }
  /* ★★ 词群导图 ✓（2026-10-17）—— 从 PDF 裁出来的**白底**页面图 ✓，
     放在深色卡上会是一块刺眼的白 ✓ → 给它一圈「纸」的边框 + 圆角 ✓，
     看起来像「把书页贴上来」✓，不像「图片没加载完」✗。 */
  .lw-wd-map img { display:block; width:100%; max-height:480px; object-fit:contain; background:var(--pp-sheet); border:1px solid ${T.lineDim}; border-radius:8px; padding:8px; cursor:zoom-in; }
  .lw-wd-map .cap { margin-top:6px; font-size:10.5px; color:${T.faint}; text-align:center; }
  .lw-wd-map.bad { display:none; }
  /* 点图放大 ✓ —— 导图字小 ✓，卡片里 480px 高根本看不清 ✓ */
  .lw-map-zoom { position:fixed; inset:0; z-index:9900; display:none; align-items:center; justify-content:center; padding:22px; background:var(--pp-scrim); cursor:zoom-out; }
  .lw-map-zoom.on { display:flex; }
  .lw-map-zoom img { max-width:100%; max-height:100%; object-fit:contain; background:var(--pp-sheet); }
  .lw-wd-imgwrap .cap { font-size:9.5px; color:${T.faint}; padding:4px 8px; border-top:1px solid ${T.lineDim}; }
  /* 「来自哪句话」✓ —— 给这个词一个上下文 ✓（也方便回忆是在哪儿遇到的 ✓） */
  .lw-wd-sent { font-size:11px; line-height:1.85; color:${T.dim}; margin:8px 0 0; padding-left:9px; border-left:1px solid ${T.lineDim}; }
  /* ⚠️ 正在跑 / 已开启的按钮要**看得出来** ✗（补全中 / 找图中 ✓） */
  .lw-ep-act button.on { border-color:${T.accent}; color:${T.accent}; }
  /* ── 复习浮层（遗忘曲线要**看得见** ✓）── */
  .lw-rev-card { min-height:220px; display:flex; flex-direction:column; align-items:center; justify-content:center; border:1px solid ${T.lineDim}; background:${T.card}; padding:26px 20px; }
  .lw-rev-card .w { font-size:30px; color:${T.text}; line-height:1.3; text-align:center; word-break:break-word; }
  .lw-rev-card .ph { font-size:13px; color:${T.dim}; margin-top:8px; }
  .lw-rev-card .df { font-size:14px; color:${T.text}; margin-top:16px; line-height:1.9; text-align:center; max-width:560px; }
  .lw-rev-card .eg { font-size:12px; color:${T.dim}; margin-top:12px; line-height:1.9; text-align:center; max-width:560px; }
  .lw-rev-card .src { font-size:10px; color:${T.faint}; margin-top:14px; }
  .lw-rev-card .ask { font-size:11.5px; color:${T.faint}; }
  .lw-rev-bar { display:flex; gap:6px; align-items:center; padding:12px 0 0; flex-wrap:wrap; }
  .lw-rev-bar button { flex:1; min-width:110px; height:44px; border:1px solid ${T.lineDim}; background:transparent; color:${T.dim}; font:11px ${UI}; cursor:pointer; line-height:1.5; }
  .lw-rev-bar button b { display:block; font-size:9.5px; color:${T.faint}; font-weight:400; }
  .lw-rev-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rev-bar button:hover b { color:${T.accent}; }
  .lw-rev-bar button.g1:hover { border-color:${T.red}; color:${T.red}; }
  .lw-rev-bar button.g1:hover b { color:${T.red}; }
  .lw-rev-bar button.g5:hover { border-color:${T.ok}; color:${T.ok}; }
  .lw-rev-bar button.g5:hover b { color:${T.ok}; }
  .lw-rev-prog { font-size:10.5px; color:${T.faint}; display:flex; gap:10px; align-items:center; }
  .lw-rev-prog .bar { flex:1; height:4px; background:${T.card2}; }
  .lw-rev-prog .bar i { display:block; height:100%; background:${T.accent}; }
  .lw-rev-done { text-align:center; padding:30px 10px; }
  .lw-rev-done .big { font-size:26px; color:${T.ok}; }
  .lw-rev-done .sub { font-size:12px; color:${T.dim}; margin-top:10px; line-height:2; }
  /* ── 朗读条 ── */
  .lw-spk { display:flex; align-items:center; gap:8px; padding:8px 14px 0; flex-wrap:wrap; }
  .lw-spk .lb { font-size:9.5px; color:${T.faint}; }
  .lw-spk select, .lw-spk input { height:24px; border:1px solid ${T.lineDim}; background:${T.bg2}; color:${T.text}; font:10px ${UI}; padding:0 6px; outline:none; max-width:150px; }
  .lw-spk select:focus, .lw-spk input:focus { border-color:${T.accent}; }
  .lw-ml-tr { flex:1; min-height:0; display:grid; grid-template-columns:1fr 1fr; }
  .lw-ml-tr .pane { min-width:0; min-height:0; }
  .lw-ml-tr .pane.origin { border-right:1px solid ${T.lineDim}; display:flex; overflow:hidden; }
  .lw-ml-tr .pane.origin iframe { flex:1; width:100%; border:0; background:var(--pp-sheet); }
  .lw-ml-tr .pane.trans { overflow:auto; padding:4px 16px 16px; }
  .lw-ml-tr .pane.trans .p { padding:9px 0; border-bottom:1px solid ${T.lineDim}; color:${T.text}; font-size:12.5px; line-height:1.85; white-space:pre-wrap; word-break:break-word; }
  .lw-ml-tr .pane.trans .p:last-child { border-bottom:0; }
  .lw-ml-tr .pane.trans .pending { color:${T.faint}; }
  .lw-btn.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  /* ══ ★★ 窄屏（手机 / 分屏窄栏）收尾覆盖 ✓✓（2026-10-18）══════════════════
     ⚠️ 必须放在**整个样式表最后** ✗ —— 上面 266 行还有 .lw-g12 的基础规则 ✓，
        放在它前面会被盖掉 ✓（第一版就是这么白改的 ✗）。
     ⚠️ 三个都要压 ✓：
        ① 12 栏网格 → 单栏 ✓（430px 下 12 栏每栏只剩 18px ✓，卡片根本放不下 ✗）
        ② 卡片的**内联 span** ✓（内联写 grid-column:span 3 ✓，内联优先级最高 → !important ✓）
        ③ 卡片被用户**拖过大小**后带的内联 width / height ✓
           （实测：87×122 的卡片在手机上只剩一条 ✓）→ 窄屏一律回到自适应 ✓。
     ⚠️ 桌面宽度**完全不受影响** ✗（用户拖出来的大小仍然记得 ✓）。 */
  /* ⚠️ 断点 **1200** 不是 820 ✗✗ —— 12 栏里跨 3 栏的卡片最小要 240px ✓，
     一栏 = (内容区 - 11×16) / 12 ✓ → 内容区 < 968px 时 3 栏就不到 240 ✓
     （实测 900px 视口：内容区 704 ✓ → 每栏 176 ✓ → 卡片被切掉一半 ✗）。
     内容区 ≈ 视口 - 196（左栏）- 36（内边距）✓ → 视口 < 1250 一律单栏 ✓
     （实测 1200 还差 22px ✓、1280 才刚好 ✓）。 */
  @media (max-width: 1249px) { .lw-g12 { grid-template-columns:1fr; gap:12px; }
    .lw-g12 > .lw-c { grid-column:1 / -1 !important; width:auto !important; min-width:0; height:auto !important; min-height:120px; }
  }
  /* ★ 中等宽度（分屏 / 小笔记本）用**两列** ✓（2026-10-19）——
     ⚠️ 全单列在 900~1249 太浪费 ✗（KPI 卡只有一百多字 ✓，占满 900px 全是空白 ✗）。
     判据用 data-span 属性 ✓（bind() 里打的 ✓）：
       · 跨 1~5 栏的窄卡（KPI / 列表卡 ✓）→ 两列 ✓
       · 跨 6 及以上的宽卡（表格 / 长列表 ✓）→ 整行 ✓（挤成半宽会横着滚 ✗）
     ⚠️ 只改**布局** ✗，不改任何卡片的渲染与交互 ✓。 */
  @media (min-width: 821px) and (max-width: 1249px) { .lw-g12 { grid-template-columns:repeat(2, minmax(0,1fr)); }
    .lw-g12 > .lw-c { grid-column:span 1 !important; }
    .lw-g12 > .lw-c[data-span="6"], .lw-g12 > .lw-c[data-span="7"], .lw-g12 > .lw-c[data-span="8"], .lw-g12 > .lw-c[data-span="9"], .lw-g12 > .lw-c[data-span="10"], .lw-g12 > .lw-c[data-span="11"], .lw-g12 > .lw-c[data-span="12"] { grid-column:1 / -1 !important; }
  }
  /* ═══ 纸感立体感 · 第 7.2 / 7.3 节（四层厚度 + 抬起 + 按下 + 入场）═══════════
     层级：L0 页面（无阴影）→ L1 纸片卡（阴影 + 1px 线 + 内高光）
           → L2 抬起（hover 抬 1px + 更深的阴影）→ L3 浮层（再加一层大阴影）✓
     ⚠️ 全部用 .lw-inpanel 前缀 ✓：① 不外溢到其它视图 ✓ ② 特异性比原来那批
        .lw-xxx 规则高一级 ✓（原规则是 0-1-1，这里是 0-2-1）⇒ 后出现的也能稳赢 ✓。
     ⚠️ 时长/曲线只用主界面已有的 --mo-1..4 / --mo-out / --mo-drawer ✓，不新造 ✓。 */
  /* ── L1 纸片卡 ─────────────────────────────────────────────────────────── */
  .lw-inpanel .lw-c { background:var(--pp-sheet); border:1px solid var(--pp-line); border-radius:8px; box-shadow:var(--pp-shadow), inset 0 1px 0 var(--pp-glow); transition:transform var(--mo-2) var(--mo-out), box-shadow var(--mo-2) var(--mo-out), border-color var(--mo-2) var(--mo-out); }
  /* ── L2 抬起 ───────────────────────────────────────────────────────────── */
  .lw-inpanel .lw-c:hover { transform:translateY(-1px); box-shadow:var(--pp-shadow-lift), inset 0 1px 0 var(--pp-glow); border-color:color-mix(in srgb, var(--pp-accent) 34%, var(--pp-line)); }
  /* ── 按下：凹进去（不是变小 ✓ —— 纸被按下去是凹的 ✓）───────────────────── */
  .lw-inpanel .lw-c:active { transform:translateY(1px); box-shadow:var(--pp-inset), inset 0 1px 0 var(--pp-glow); }
  /* ⚠️ 卡片右/下/右下角有拖拽热区（.lw-rs ✓）—— 悬停热区时**不能抬** ✗，
     否则热区跟着挪 1px ✓，鼠标一抖就 hover 掉 ✓ → 抬/落抖动 ✗（原来那条
     「绝对不能用 translateY」的注释说的就是这个 ✓，这里用 :has 精确排掉 ✓）。 */
  .lw-inpanel .lw-c:hover:has(> .lw-rs:hover), .lw-inpanel .lw-c.lw-dragging, .lw-inpanel .lw-c.lw-dragging:hover { transform:none; }
  .lw-inpanel .lw-c.lw-dragging:hover { box-shadow:var(--pp-shadow), inset 0 1px 0 var(--pp-glow); }
  /* ── 区块标题：12.5px/650 + 左侧 3px 强调竖条（与系统面板同一语言）───────── */
  .lw-inpanel .lw-c > h3 { background:var(--pp-sheet); color:var(--pp-ink); font-size:12.5px; font-weight:650; letter-spacing:0; text-transform:none; padding:10px 12px; border-bottom:1px solid var(--pp-line); }
  .lw-inpanel .lw-c > h3::before { content:""; flex:none; width:3px; height:12px; border-radius:2px; background:var(--pp-accent); }
  .lw-inpanel .lw-c > h3 .code { font:10.5px/1 var(--mono); color:var(--pp-ink2); letter-spacing:0; opacity:.7; }
  .lw-inpanel .lw-c > h3 em, .lw-inpanel .lw-c > h3 .act { color:var(--pp-ink2); letter-spacing:0; }
  .lw-inpanel .lw-c > h3 .act { color:var(--pp-accent); }
  /* ── 左栏：选中 = 底色 --pp-sheet2 + 左侧 3px 竖条（**竖条生长** ✓）───────── */
  .lw-inpanel .lw-nav button { position:relative; border:1px solid transparent; border-radius:8px; background:transparent; box-shadow:none; transition:background var(--mo-1) var(--mo-out), color var(--mo-1) var(--mo-out), box-shadow var(--mo-2) var(--mo-out); }
  .lw-inpanel .lw-nav button:hover { background:var(--pp-hover); border-color:transparent; transform:none; box-shadow:none; }
  .lw-inpanel .lw-nav button::before { content:""; position:absolute; left:0; top:50%; width:3px; height:0; border-radius:0 2px 2px 0; background:var(--pp-accent); transform:translateY(-50%); transition:height var(--mo-2) var(--mo-out); }
  .lw-inpanel .lw-nav button.on { background:var(--pp-sheet2); color:var(--pp-ink); border-color:var(--pp-line); font-weight:650; box-shadow:inset 0 1px 0 var(--pp-glow); transform:none; }
  .lw-inpanel .lw-nav button.on::before { height:62%; }
  .lw-inpanel .lw-nav button.on .badge { color:var(--pp-ink2); opacity:1; }
  .lw-inpanel .lw-nav .grp { letter-spacing:0; text-transform:none; color:var(--pp-ink2); }
  .lw-inpanel .lw-nav .foot { letter-spacing:0; text-transform:none; color:var(--pp-ink2); }
  /* ═══ 阶段 2（规范 §9.1 / §9.2）：线性图标 + 信息层级 ═════════════════════════
     ⚠️ 全部带 .lw-inpanel 前缀 ✓ —— 主界面那套 .cs-ico 在 ui-kit.css 里，一行没动 ✓；
        这里的「降一档 / 合 band」也只在本面板成立 ✓，不外溢到别的视图 ✓。 */
  /* ── 左栏分区图标：线性 sprite ✓（原来是 emoji / 几何字符 ✗）────────────── */
  .lw-inpanel .lw-nav .ic { width:18px; color:var(--pp-ink2); font-size:15px; display:inline-flex; align-items:center; justify-content:center; }
  .lw-inpanel .lw-nav .ic .cs-ico { stroke-width:1.6; }
  .lw-inpanel .lw-nav button.on .ic { color:var(--pp-accent); }
  /* ── 标题 / 按钮里的图标：跟文字一个基线，别把行高顶开 ✓ ─────────────────── */
  .lw-inpanel .lw-c > h3 .cs-ico { font-size:13px; color:var(--pp-ink2); }
  .lw-inpanel button .cs-ico, .lw-inpanel .act .cs-ico { vertical-align:-.16em; }
  /* ★ 收藏 / 置顶的「亮 / 暗」两态：**同一份路径** ✗ 不新增 symbol ✓（§9.1 只允许 5 个 ✓）——
     空心 = 未收藏 ✓，实心 = 已收藏 ✓（fill 当前色 ✓，描边不变 ✓）。 */
  .lw-inpanel .cs-ico.is-on { fill:currentColor; }
  /* ── KPI 降一档（§9.2）：它们是**参考值** ✓，不该和待办 / 文件抢注意力 ✗ ──── */
  /* ★ KPI 卡「降一档」= 底色淡一档 + **阴影用浅档**，而不是**没有阴影** ✗
     （原来 box-shadow:none ✓ ⇒ 在纸面上像一块贴纸 ✓，「立体感不行」有一半是这里 ✓）。
     层级关系仍然成立：普通卡 = 浅档，KPI 卡 = 浅档 + 更淡的底 ✓，抬起时才到中档 ✓。 */
  .lw-inpanel .lw-c.lw-kpi-c { background:color-mix(in srgb, var(--pp-sheet) 42%, var(--pp-page)); box-shadow:var(--pp-shadow), inset 0 1px 0 var(--pp-glow); }
  .lw-inpanel .lw-c.lw-kpi-c > h3 { background:transparent; }
  .lw-inpanel .lw-c.lw-kpi-c:hover { transform:none; box-shadow:var(--pp-shadow), inset 0 1px 0 var(--pp-glow); }
  .lw-inpanel .lw-kpi { padding:10px 13px 11px; }
  .lw-inpanel .lw-kpi .row { gap:11px; }
  .lw-inpanel .lw-kpi .ic { width:32px; height:32px; border-radius:8px; font-size:15px; color:var(--pp-ink2); background:transparent; }
  .lw-inpanel .lw-kpi .num { font-size:26px; font-weight:600; letter-spacing:-.4px; }
  .lw-inpanel .lw-kpi .num small { font-size:10px; color:var(--pp-ink2); margin-left:4px; }
  .lw-inpanel .lw-kpi .lbl { margin-top:7px; color:var(--pp-ink2); }
  .lw-inpanel .lw-kpi .cmp { margin-top:3px; font-size:10px; color:var(--pp-ink2); }
  /* ── 文件 band：左表格 / 右构成条（同一张卡，少一次视线跳转 ✓）§9.2 ──────── */
  .lw-band { display:grid; grid-template-columns:minmax(0,1.7fr) minmax(240px,1fr); align-items:stretch; }
  .lw-band-l { min-width:0; }
  .lw-band-r { min-width:0; padding:12px 14px 14px; border-left:1px solid var(--pp-line); background:color-mix(in srgb, var(--pp-sheet2) 42%, transparent); }
  .lw-band-h { display:flex; align-items:center; gap:8px; margin-bottom:11px; font-size:11px; font-weight:650; color:var(--pp-ink); }
  .lw-band-h .sp { flex:1; }
  .lw-band-h span:last-child { font:10px/1 var(--mono); color:var(--pp-ink2); }
  .lw-kbt { margin-bottom:10px; }
  .lw-kbt-h { display:flex; font-size:11px; color:var(--pp-ink2); margin-bottom:4px; }
  .lw-kbt-h span:first-child { flex:1; }
  .lw-kbt-h span:last-child { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .lw-kbt-bar { height:6px; border-radius:4px; background:color-mix(in srgb, var(--pp-ink) 9%, transparent); overflow:hidden; }
  .lw-kbt-bar > i { display:block; height:100%; border-radius:4px; }
  .lw-kbt-more { display:flex; align-items:center; gap:6px; margin-top:2px; padding-top:8px; border-top:1px solid var(--pp-line); font-size:11px; color:var(--pp-ink2); }
  .lw-kbt-more > b { margin-left:auto; font:11px/1 var(--mono); font-weight:600; color:var(--pp-ink2); }
  .lw-kbt-more .cs-ico { font-size:12px; opacity:.55; }
  @media (max-width: 1249px) { .lw-band { grid-template-columns:1fr; } .lw-band-r { border-left:0; border-top:1px solid var(--pp-line); } }
  /* ── 行悬停：一层薄填充 ✓（原来整行刷强调色太狠 ✗，纸质里像涂了一块墨 ✗）── */
  .lw-inpanel .lw-tr:hover, .lw-inpanel .lw-todo:hover, .lw-inpanel .lw-note:hover, .lw-inpanel .lw-hotrow:hover, .lw-inpanel .lw-mrow:hover, .lw-inpanel .lw-link:hover, .lw-inpanel .lw-hotkw:hover, .lw-inpanel .lw-kw:hover, .lw-inpanel .lw-eb-pick:hover, .lw-inpanel .lw-ep-big:hover, .lw-inpanel .lw-jtpl button:hover { background:var(--pp-hover); color:var(--pp-ink); }
  /* ⚠️ 原来那批 hover 用 !important 把子元素刷成 accentInk（深底浅字 ✓）——
     现在底色变成浅纸 ✓，浅字就看不见了 ✗ ⇒ 同特异性 + 后出现 + 也带 !important ✓ */
  .lw-inpanel .lw-tr:hover .nm i, .lw-inpanel .lw-tr:hover .sz, .lw-inpanel .lw-tr:hover .tm, .lw-inpanel .lw-tr:hover .bd { color:var(--pp-ink2) !important; opacity:1; }
  /* 大块的「选中行」（整行刷强调色 ✗）→ 索引标签：竖条 + 次级底色 ✓ */
  .lw-inpanel .lw-mrow.on, .lw-inpanel .lw-nt-side .it.on, .lw-inpanel .lw-cats .row.on, .lw-inpanel .lw-nt-side .hd button.on, .lw-inpanel .lw-mtags span.on, .lw-inpanel .lw-epsrc-s.on, .lw-inpanel .lw-bk.on, .lw-inpanel .lw-hl-it.on { background:var(--pp-sheet2); color:var(--pp-ink); box-shadow:inset 3px 0 0 var(--pp-accent); }
  .lw-inpanel .lw-mrow.on .t, .lw-inpanel .lw-mrow.on .d { color:var(--pp-ink); }
  .lw-inpanel .lw-mrow.on .s { color:var(--pp-ink2); }
  /* 小药丸 / 分段控件 / 日期格：强调色软底 + 强调字（像盖了个墨章 ✓，不刷满 ✓）*/
  .lw-inpanel .lw-chip.on, .lw-inpanel .lw-rd-chip.on, .lw-inpanel .lw-rd-modes .seg.on, .lw-inpanel .lw-nt-fmt button.on, .lw-inpanel .lw-nt-bar button.on, .lw-inpanel .lw-epsrc-tabs button.on, .lw-inpanel .lw-ml-tools button.on, .lw-inpanel .lw-os-tags button.on, .lw-inpanel .lw-hl-body .acts button.on, .lw-inpanel .lw-moodpick div.on, .lw-inpanel .lw-cal-d.sel { background:color-mix(in srgb, var(--pp-accent) 14%, transparent); color:var(--pp-ink); border-color:color-mix(in srgb, var(--pp-accent) 46%, var(--pp-line)); }
  /* ── 主按钮：纸被压出来的一块「墨章」✓（渐变只给这层，别处一律纯色 ✓）───── */
  .lw-inpanel .lw-add button, .lw-inpanel .lw-mcadd button, .lw-inpanel .lw-bk-write button, .lw-inpanel .lw-mo-write button, .lw-inpanel .lw-memo-bar button.pri, .lw-inpanel .lw-memo-tools button.pri, .lw-inpanel .lw-imp .ft button.pri, .lw-inpanel .lw-fl-tools button.pri, .lw-inpanel .lw-rd-tools button.pri, .lw-inpanel .lw-hl-tools button.pri, .lw-inpanel .btn-pri { background:linear-gradient(180deg, color-mix(in srgb, var(--pp-accent) 86%, #fff 14%), var(--pp-accent)); color:var(--pp-on-accent); border:1px solid color-mix(in srgb, var(--pp-accent) 72%, #000 28%); border-radius:8px; box-shadow:var(--pp-shadow), inset 0 1px 0 color-mix(in srgb, #fff 26%, transparent); transition:transform var(--mo-2) var(--mo-out), box-shadow var(--mo-2) var(--mo-out), background var(--mo-1) var(--mo-out); }
  .lw-inpanel .lw-add button:hover, .lw-inpanel .lw-mcadd button:hover, .lw-inpanel .lw-bk-write button:hover, .lw-inpanel .lw-mo-write button:hover, .lw-inpanel .lw-memo-bar button.pri:hover, .lw-inpanel .lw-memo-tools button.pri:hover, .lw-inpanel .lw-imp .ft button.pri:hover, .lw-inpanel .lw-fl-tools button.pri:hover, .lw-inpanel .lw-rd-tools button.pri:hover, .lw-inpanel .lw-hl-tools button.pri:hover, .lw-inpanel .btn-pri:hover { color:var(--pp-on-accent); transform:translateY(-1px); box-shadow:var(--pp-shadow-lift), inset 0 1px 0 color-mix(in srgb, #fff 32%, transparent); }
  .lw-inpanel .lw-add button:active, .lw-inpanel .lw-mcadd button:active, .lw-inpanel .lw-bk-write button:active, .lw-inpanel .lw-mo-write button:active, .lw-inpanel .lw-memo-bar button.pri:active, .lw-inpanel .lw-memo-tools button.pri:active, .lw-inpanel .lw-imp .ft button.pri:active, .lw-inpanel .btn-pri:active { transform:translateY(1px); box-shadow:var(--pp-inset); }
  /* ── 输入框：压进纸面里（凹）✓ ────────────────────────────────────────── */
  .lw-inpanel input:not([type=checkbox]):not([type=radio]):not([type=range]), .lw-inpanel textarea, .lw-inpanel select { background:var(--pp-sheet2); color:var(--pp-ink); border:1px solid var(--pp-line); border-radius:8px; box-shadow:var(--pp-inset); transition:border-color var(--mo-1) var(--mo-out), box-shadow var(--mo-1) var(--mo-out); }
  .lw-inpanel input:focus, .lw-inpanel textarea:focus, .lw-inpanel select:focus { border-color:color-mix(in srgb, var(--pp-accent) 58%, var(--pp-line)); box-shadow:var(--pp-inset), 0 0 0 3px color-mix(in srgb, var(--pp-accent) 15%, transparent); outline:none; }
  /* ── L3 浮层：菜单 / 提醒 / 对话框 / 抽屉（再加一层大阴影 ✓）─────────────── */
  .lw-inpanel .lw-imp .box, .lw-inpanel .lw-mc, .lw-inpanel .lw-nt-menu, .lw-inpanel .lw-eb-set, #lw-ctx, #lw-toast, #lw-savetoast, #lw-ml-pick .lw-ml-pick, .lw-inpanel .lw-moodpick, .lw-inpanel .lw-eb-drawer { background:var(--pp-sheet); border:1px solid var(--pp-line); border-radius:8px; box-shadow:var(--pp-shadow-float); }
  .lw-inpanel .lw-imp { background:var(--pp-scrim); }
  .lw-map-zoom { background:color-mix(in srgb, var(--pp-ink) 68%, transparent); }
  /* 浮层入场：translateY(8px) + scale(.99) + opacity ✓（--mo-4 + --mo-drawer ✓）*/
  @keyframes pp-layer-in { from { opacity:0; transform:translateY(8px) scale(.99); } to { opacity:1; transform:none; } }
  .lw-inpanel .lw-imp .box, .lw-inpanel .lw-eb-drawer, #lw-ctx, #lw-ml-pick .lw-ml-pick { animation:pp-layer-in var(--mo-4) var(--mo-drawer) both; }
  /* ── 等宽只给数字 / 时间 / 编号 ✓（中文正文一律正文字体 ✓）──────────────── */
  .lw-inpanel .lw-kpi .num, .lw-inpanel .lw-stat .big, .lw-inpanel .lw-tr .sz, .lw-inpanel .lw-tr .tm, .lw-inpanel .lw-wx .wt, .lw-inpanel .lw-mb .n, .lw-inpanel .lw-bars .v, .lw-inpanel .lw-mrow .d, .lw-inpanel .lw-todo .due, .lw-inpanel .lw-memo-bar .n, .lw-inpanel .lw-nav .badge, .lw-inpanel .lw-c > h3 .code, .lw-inpanel .lw-kpi .lbl { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .lw-inpanel .lw-kpi .lbl, .lw-inpanel .lw-memo-bar .n { letter-spacing:0; text-transform:none; }
  /* ── 区块 / 卡片入场：opacity + translateY(6px)，同批 40ms 步进（前 8 个）───
     ⚠️ 只在**切页签 / 首次渲染**时挂 ✓（JS 里 lwEnterBatch ✓）；
        轮询刷新重建 DOM 时**不挂** ✗ —— 否则每次刷新整块闪一下 ✗（规范 §7.3 ✓）。 */
  @keyframes pp-enter { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  @keyframes pp-enter-fade { from { opacity:0; } to { opacity:1; } }
  .lw-inpanel .pp-in { animation:pp-enter var(--mo-3) var(--mo-out) both; }
  /* 数字变化：一次性纸黄高亮，回落 ✓（不滚动、不滴答 ✓）*/
  @keyframes pp-num-flash { 0% { background:color-mix(in srgb, var(--pp-warn) 30%, transparent); }
    100% { background:transparent; }
  }
  .lw-inpanel .pp-flash { animation:pp-num-flash 400ms var(--mo-out) 1; border-radius:3px; }
  /* ── prefers-reduced-motion：只去掉位移 / 缩放 ✓，**阴影与颜色保留** ✓────── */
  @media (prefers-reduced-motion: reduce) { .lw-inpanel .lw-c, .lw-inpanel .lw-nav button, .lw-inpanel .lw-nav button::before { transition:none; }
    .lw-inpanel .lw-c:hover, .lw-inpanel .lw-c:active, .lw-inpanel .lw-add button:hover, .lw-inpanel .lw-mcadd button:hover, .lw-inpanel .lw-bk-write button:hover, .lw-inpanel .lw-mo-write button:hover, .lw-inpanel .btn-pri:hover, .lw-inpanel .btn-pri:active { transform:none; }
    .lw-inpanel .lw-c:hover { box-shadow:var(--pp-shadow-lift), inset 0 1px 0 var(--pp-glow); }
    .lw-inpanel .lw-c:active { box-shadow:var(--pp-inset), inset 0 1px 0 var(--pp-glow); }
    .lw-inpanel .pp-in { animation:pp-enter-fade var(--mo-3) var(--mo-out) both; }
    .lw-inpanel .lw-imp .box, .lw-inpanel .lw-eb-drawer, #lw-ctx, #lw-ml-pick .lw-ml-pick { animation:pp-enter-fade var(--mo-1) linear both; }
    .lw-inpanel .lw-nav button.on::before { transition:none; }
  }
  `;

  /* ══════════════════════════════════════════════════════════════════════
     备忘录正文 · Crepe 块级内核的 Phycat 主题规则（2026-10-30）
     ----------------------------------------------------------------------
     ⚠️ 为什么这些规则写在**这个文件**里，而不是 assets/doc-theme.css ✗：
        doc-theme.css 有代码行棘轮（tests/architecture.js:208 的 692）✓ 且**正好顶满** ✓
        —— 往里加规则必然把它顶红 ✗，而那条棘轮只准往下调 ✓（见 architecture.js 第 79 行注释）。
        棘轮按实测值单独登记在 tests/architecture.js ✓，所以放在这里 ✓。
     ⚠️ 令牌一个都没新增 ✓ —— 全部用 doc-theme.css 的 --doc-* 与面板的 --pp-* ✓。
     ⚠️ 必须走 lifework-style 这条注入 ✓（和面板 CSS 同一张 style 表 ✓），
        而不是改 doc-theme.css：运行时注入在 head 末尾 ✓，正好压在 Crepe
        运行时注入的那张表**之前**——所以下面凡是跟 Crepe 抢的地方都多带了一级选择器 ✓。 */
  const MEMO_DOC_CSS = `/* ═══════════════════════════════════════════════════════════════════════
   ㉑ 备忘录 / 日记正文 · Crepe 块级内核的 Phycat 移植（2026-10-30）
   -----------------------------------------------------------------------
   作用域只到 .lw-memo-ce / .lw-j-ce（= 生活面板备忘录 / 日记的正文容器）✓ ——
   阅读模块那几套（.md-doc / .reading-md-*）**一个字都没动** ✓。
   ⚠️ 所有选择器都写成 :is(.lw-memo-ce,.lw-j-ce) ✓（2026-10-30 日记迁到同一颗内核时改的）——
      :is() 取**参数里最高的特异性** ✓，两个类都是 0,1,0，所以原样抄下来的每条规则
      特异性**一点没变** ✓（不用重新算谁压谁 ✗），CSS 也只多了这 3 个字符 ✗。

   ★ 规则来源（每条都指到文件和选择器，spec 第 10 节要求）：
     · H1 居中 + 40px 短线 + 悬停展开 …… theme.css:3348-3396
       （.theme-light .markdown-preview-view h1 / h1::after / h1:hover::after）
     · H2 双子塔（两条错位竖线，悬停互换）…… theme.css:3549-3655
       （.theme-light.h2-style-twin .markdown-preview-view h2 + h2::before + h2::after）
     · H2 胶囊（可选样式，默认关闭）…… theme.css:3507-3537
       （.theme-light.h2-style-capsule .markdown-preview-view h2）
     · H3 左侧竖条 …… theme.css:3665-3688
     · 引用块 ✨ 圆角卡片 …… theme.css:5178-5260
     · 行内链接方括号呼吸 …… theme.css:5269-5360
     · 圆形任务复选框 …… theme.css:4807-4908（**选择器不可直接移植**，见 ⑦）
     · 纸面居中列 …… preview-layout.css 的 .markdown-preview-view /
       .markdown-preview-sizer { max-width:var(--file-line-width) }

   ★★ 为什么**不能**直接把 theme.css 的选择器抄过来（实测，不是猜）：
     Crepe 产出的 DOM 与 Obsidian 的 DOM 契约不同 ✗ ——
       实测一条含 h1/h2/列表/任务/引用/表格的备忘录，ProseMirror 里是：
         <h1 id="…"> <h2> <p> <ul> <li class="list-item">
         <blockquote> <div class="milkdown-table-block">
         任务项 = <li class="list-item"> + <span class="milkdown-icon label unchecked"><svg></span>
       而 spec 10.1 要求的 input.task-list-item-checkbox / a.tag / .markdown-preview-sizer
       **一个都不存在** ✗。
     ⇒ 能用类名对上的（h1/h2/h3/blockquote/a）照规则移植 ✓；
        对不上的（复选框 / .tag / sizer）逐条标明改成什么或为什么做不到 ✓，不假装抄到 ✓。
   ═══════════════════════════════════════════════════════════════════════ */

/* ── ① 纸面：容器 + 居中列 ──────────────────────────────────────────────
   来源 preview-layout.css：.markdown-preview-view{padding:24px 30px 45px}、
   .markdown-preview-sizer{max-width:var(--file-line-width,900px);margin:auto}。
   ⚠️ Crepe 没有 .markdown-preview-sizer（见上）→ 把 sizer 的两条几何
   （max-width + margin:auto）落到 .ProseMirror 上 ✓，语义等价 ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view {
  --file-line-width: 700px;
  background: var(--ed-paper);
  color: var(--doc-text);
  padding: 22px 30px 46px;
  border: 0;
  border-radius: 0;
  font-size: 14.5px;
  line-height: 1.78;
  overflow: auto;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror {
  max-width: var(--file-line-width);
  margin: 0 auto;
  padding: 0;
  /* Crepe 自带 border-radius:16px + 边框 + 投影（见本文件 ⑩ 的注释）→ 拍平 */
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  color: var(--doc-text);
}

/* ── ② 标题：H1 居中短线（theme.css:3348-3396）─────────────────────────
   默认容器类 = h1-align-center（= preview.html 里 body 的默认值）✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h1 {
  display: block; width: 100%; min-width: 0;
  font-size: 26px !important; font-weight: 700; line-height: 1.4;
  margin: 1.6em 0 .9em; padding: 0 0 12px !important;
  border: 0; background: none; color: var(--doc-strong);
  position: relative;
  transition: color .3s ease, transform .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).h1-align-center.markdown-preview-view h1 {
  text-align: center;
  margin-left: auto !important; margin-right: auto !important;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h1::after {
  content: '';
  position: absolute; bottom: 0; left: 50%;
  width: 40px; height: 4px; border-radius: 4px;
  background: var(--doc-primary);
  box-shadow: 0 0 5px color-mix(in srgb, var(--doc-primary) 20%, transparent);
  transform: translateX(-50%);
  transition: width .3s var(--doc-ease-smooth), box-shadow .3s ease;
  pointer-events: none;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h1:hover { color: var(--doc-primary); transform: translateY(-2px); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h1:hover::after { width: 100%; box-shadow: 0 0 15px var(--doc-primary); }

/* ── ③ H2 双子塔（theme.css:3549-3655）—— 默认样式 ────────────────────── */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2 {
  font-size: 19px !important; font-weight: 700; line-height: 1.5;
  position: relative; display: block; width: 100%;
  /* ⚠️ padding 必须 !important：Crepe 的标题样式是运行时注入到 head 末尾的，
     比本文件晚 → 同特异性它会赢 ✗（本文件 ④ 的 H2 踩过同一个坑）。 */
  padding: 0 0 .12em 20px !important;
  margin: 1.6em 0 .6em;
  border: 0; background: none; border-radius: 0;
  color: var(--doc-text);
  transition: color .3s ease, text-shadow .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2::before {
  content: ''; position: absolute; left: 0; top: auto; margin-top: .2em;
  width: 5px; height: 1em; border-radius: 4px;
  background: var(--doc-primary); opacity: .85;
  box-shadow: 0 0 8px color-mix(in srgb, var(--doc-primary) 50%, transparent);
  transform-origin: left center;
  /* ★ 曲线照抄 theme.css:3597 的 all .4s cubic-bezier(.25,.8,.25,1) ✓ ——
     这条**故意不换 --mo-*** ✗：官方 h2 双子塔用的就是这条手写曲线，
     换成 --mo-out 后回弹感没了，悬停时两根柱子会「啪」地跳到位 ✓。 */
  transition: height .4s cubic-bezier(.25, .8, .25, 1), margin-top .4s cubic-bezier(.25, .8, .25, 1),
              opacity .4s cubic-bezier(.25, .8, .25, 1);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2::after {
  content: ''; position: absolute; left: 8px; top: auto; margin-top: .3em;
  width: 2px; height: .6em; border-radius: 2px;
  background: var(--doc-secondary); opacity: .6;
  transform-origin: left center;
  /* 细线那条官方带 0.05s 延迟（theme.css:3630 的 ... .4s cubic-bezier(.25,.8,.25,1) 0.05s ✓），
     正是「交错律动」的来源 —— 两条柱子同时到位就没有那个味道了 ✓。 */
  transition: width .4s cubic-bezier(.25, .8, .25, 1) .05s, height .4s cubic-bezier(.25, .8, .25, 1) .05s,
              margin-top .4s cubic-bezier(.25, .8, .25, 1) .05s,
              background .4s cubic-bezier(.25, .8, .25, 1) .05s, opacity .4s cubic-bezier(.25, .8, .25, 1) .05s;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2:hover { color: var(--doc-primary); text-shadow: var(--doc-glow-text); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2:hover::before { height: 1.4em; margin-top: 0; opacity: .4; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2:hover::after {
  width: 4px; height: 1.1em; margin-top: .15em; opacity: 1;
  background: var(--doc-primary); transition-delay: 40ms;
}
/* 容器类 h2-style-capsule = 换成 theme.css:3507 那版胶囊（默认不开 ✓） */
:is(.lw-memo-ce,.lw-j-ce).h2-style-capsule.markdown-preview-view h2 {
  font-size: 18px !important; display: inline-block; width: fit-content;
  padding: 6px 16px !important; margin: 1.4em 0 .6em;
  border-radius: 8px; border: 0 !important;
  background: color-mix(in srgb, var(--doc-primary) 18%, var(--ed-paper)) !important;
  color: var(--doc-strong) !important;
  box-shadow: 0 2px 5px color-mix(in srgb, var(--doc-primary) 22%, transparent);
  transition: transform .4s ease, box-shadow .4s ease;
}
:is(.lw-memo-ce,.lw-j-ce).h2-style-capsule.markdown-preview-view h2::before,
:is(.lw-memo-ce,.lw-j-ce).h2-style-capsule.markdown-preview-view h2::after { content: none; }
:is(.lw-memo-ce,.lw-j-ce).h2-style-capsule.markdown-preview-view h2:hover {
  transform: scale(1.01);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--doc-primary) 26%, transparent);
}

/* ── ④ H3 左侧竖条（theme.css:3665-3688）／H4~H6（theme.css:3193-3211 配色）── */
/* ★ 2026-10-30 H3 悬停：**不改 padding** ✗ ——
   theme.css:3683 那版是 padding-left 15px → 20px ✓，可 padding 是布局属性 ✗：
   悬停一下宽度就变（width:fit-content 跟着重算），下面的内容会被推着跳一行 ✓。
   ✓ 改成视觉等价、零布局的做法：padding 恒为 20px ✓，悬停时
     h3 整体 translateX(5px)（文字右移 5px ✓）+ ::before 反向 translateX(-5px)（柱子留在原地 ✓）
     —— 和官方那版的**相对关系一模一样** ✓，但一个像素的布局都没动 ✓。
   柱子：高 1.3rem → 24px、宽 5px → 7px（theme.css:3690 ✓，绝对定位、不占位 ✓）。
   曲线照抄官方 all .3s cubic-bezier(.25,.8,.25,1) ✓，不换 --mo-*。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h3 {
  font-size: 16px !important; width: fit-content; position: relative;
  padding: 0 0 0 20px !important; margin: 1.3em 0 .5em;
  color: var(--doc-primary);
  transition: transform .3s cubic-bezier(.25, .8, .25, 1), color .3s cubic-bezier(.25, .8, .25, 1);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h3::before {
  content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 5px; height: 1.3rem; border-radius: 4px; background: var(--doc-primary);
  transition: height .3s cubic-bezier(.25, .8, .25, 1), width .3s cubic-bezier(.25, .8, .25, 1),
              transform .3s cubic-bezier(.25, .8, .25, 1), background .3s cubic-bezier(.25, .8, .25, 1);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h3:hover { transform: translateX(5px); color: var(--doc-primary); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h3:hover::before {
  transform: translateY(-50%) translateX(-5px); height: 24px; width: 7px;
}
/* ★ 2026-10-30 H4~H6：主题里这三级**本来就有装饰点**（实心圆 / 空心圆 / 短横，
   theme.css:3696-3786 ✓），悬停是「右移 6px + 点放大发光」✓ ——
   之前这份移植只搬了配色、没搬点 ✗，于是「悬停 H4~H6」无从谈起 ✓（没有可放大的东西）。
   ✓ 现在补齐：padding-left 恒为 20px ✓、悬停只 translateX + scale + box-shadow ✓ —— 零布局。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6 {
  position: relative; padding-left: 20px !important;
  transition: color .3s ease, transform .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4 { font-size: 15px !important; color: var(--doc-strong); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4::before {
  content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--doc-primary); border: 1px solid var(--doc-primary);
  transition: transform .3s ease, box-shadow .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5 { font-size: 14px !important; color: var(--doc-text-2); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5::before {
  content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 10px; height: 10px; border-radius: 50%; box-sizing: border-box;
  background: transparent; border: 2px solid var(--doc-primary);
  transition: transform .3s ease, box-shadow .3s ease, background .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6 { font-size: 13px !important; color: var(--doc-text-3); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6::before {
  content: '-'; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  color: var(--doc-primary); font-weight: 700; line-height: 1;
  transition: transform .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4:hover,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5:hover,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6:hover {
  color: var(--doc-primary); transform: translateX(6px);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4:hover::before {
  transform: translateY(-50%) scale(1.3); box-shadow: 0 0 0 4px var(--doc-glow);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5:hover::before {
  background: var(--doc-primary); transform: translateY(-50%) scale(1.2); box-shadow: 0 0 0 3px var(--doc-glow);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6:hover::before { transform: translateY(-50%) scaleX(1.8); }

/* ── ⑤ 引用块：✨ 圆角卡片（theme.css:5178-5260）────────────────────────
   ⚠️ theme.css:5206 的 content:"✨" 是权威写法 ✓ ——
      阅读模块那套用的是 ❝（本文件 ⑥，2026-10-28 的旧移植），这里按 theme.css 来 ✓。 */
/* ★ 2026-10-30 修「点进去看不到光标」——三个原因一起兜住 ✗：
   ① blockquote 左侧留了 48px 内边距给 ✨ 装饰，点在空白上不会落光标 ⇒ 整块 cursor:text，
      并把 padding 区也纳入可点（ProseMirror 会自行把点击映射到最近的文本位置）；
   ② 装饰性伪元素没设 pointer-events:none ⇒ 它压在文字左上角，点击会命中它而不是文本；
   ③ 编辑器没显式设 caret-color ⇒ 继承正文色，在纸感底上几乎看不见。
   ⚠️ caret 用 --doc-primary 而不是正文色：四套配色下它都是高对比强调色，一眼能找到光标。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror { caret-color: var(--doc-primary); }
/* ⚠️ 刻意带 :not(.md-callout) —— 提示框在 Crepe 里**也是 blockquote**
   （实测 DOM：blockquote.md-callout.note ✓，见 ⑭）；不排除的话
   每个提示框左上角都会多一颗 ✨、内边距被压成 48px ✗。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout) { cursor: text; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout)::before,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout)::after { pointer-events: none; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout) {
  position: relative;
  margin: 20px 0; padding: 18px 20px 18px 48px !important;
  background: var(--ed-chrome) !important;
  border: 1px solid color-mix(in srgb, var(--doc-primary) 20%, transparent) !important;
  border-radius: 16px !important;
  color: var(--doc-text-2);
  transition: transform .3s var(--doc-ease-back), background .3s ease,
              box-shadow .3s ease, border-color .3s ease;
}
/* ⚠️ 这几行「复位」是**必须的** ✗✗ —— 实测（把命中这个伪元素的规则全 dump 出来）：
   Crepe 的 reading-block-editor.css 也给同一个伪元素画了东西
     .milkdown .ProseMirror blockquote::before
       { width:4px; height:100%; background:rgb(47,47,47); left:0; position:absolute }
   ⇒ 本规则只改了 content 和定位 ✗，**没清掉那条背景和尺寸** ⇒
      ✨ 画在一条 4px 的深色竖条上 ✗（第一版截图里那根黑条就是它 ✓）。
   ✓ 表格里这几条 background/width/height/border 是给「引用块」用的复位 ✓，
     提示框那边走 ⑭ 的 content:none，两种一块块分开处理 ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout)::before {
  content: '✨';
  position: absolute; left: 14px; top: 18px;
  width: auto; height: auto; background: none; border: 0;
  font-size: 20px; line-height: 1; font-style: normal;
  transform: rotate(30deg);
  transition: transform .3s var(--doc-ease-back), text-shadow .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout) p { color: var(--doc-text-2); margin: 0 0 .5em; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout) p:last-child { margin-bottom: 0; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout):hover {
  transform: scale(1.02);
  background: var(--ed-hover) !important;
  border-color: var(--doc-primary) !important;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--doc-primary) 15%, transparent);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout):hover::before {
  transform: rotate(0deg);
  text-shadow: 0 0 8px var(--doc-primary);
}

/* ── ⑥ 行内链接：两侧方括号，悬停向两侧弹开（theme.css:5269-5360）──────
   ⚠️ 必须排除 #cc- 开头的锚点（{红|文字} / ==高亮== 的行内标注，见本文件 ⑦）。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a:not([href^="#cc-"]) {
  color: var(--doc-secondary); text-decoration: none; font-weight: 500;
  transition: color .3s ease, background .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a:not([href^="#cc-"])::before,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a:not([href^="#cc-"])::after {
  color: var(--doc-text-3); opacity: .7;
  transition: transform .3s var(--doc-ease-back), color .3s, opacity .3s;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a:not([href^="#cc-"])::before { content: '['; display: inline-block; margin-right: 1px; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a:not([href^="#cc-"])::after { content: ']'; display: inline-block; margin-left: 1px; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a:not([href^="#cc-"]):hover {
  color: var(--doc-primary); background: color-mix(in srgb, var(--doc-primary) 8%, transparent);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a:not([href^="#cc-"]):hover::before { transform: translateX(-4px); color: var(--doc-primary); opacity: 1; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a:not([href^="#cc-"]):hover::after { transform: translateX(4px); color: var(--doc-primary); opacity: 1; }

/* ── ⑦ 任务复选框：**选择器不可移植，视觉搬过来** ─────────────────────
   ✗ theme.css:4807 / 4839 / 4873 三条规则全部以 input[type=checkbox] /
     .task-list-item-checkbox 为锚点 ✓，而 Crepe 的清单项是
     <li class="list-item"> + <span class="milkdown-icon label unchecked|checked"><svg> ✗
     （实测 DOM，见本节开头）→ 那三条规则在这里 0 命中 ✓。
   ✓ 做法：把同一套视觉（4839 圆形底座 + 4860 选中变主题色 + 4873 白色对勾）
     画到 Crepe 的 label 图标上 ✓，令牌按 spec 10.1 对齐到 --doc-* ✓：
       --checkbox-bg-unchecked     → var(--doc-bg-dim)
       --checkbox-border-unchecked → --doc-text-3 混色
       --checkbox-bg-checked       → --doc-primary 混色
       --phycat-primary-color（边框/对勾）→ var(--doc-primary)
   ⚠️ 只命中 .unchecked/.checked ✗ —— 不能写 .milkdown-icon.label ✓：
      普通列表项用的是 .milkdown-icon.label.bullet ✓，一起命中的话每条列表前面
      都会多出一个圆圈（实测 DOM 里两类共用同一个 label 类 ✗）。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item .milkdown-icon.label.unchecked,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item .milkdown-icon.label.checked {
  width: 1.2rem; height: 1.2rem;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: var(--ed-sunk);
  border: 2px solid color-mix(in srgb, var(--doc-text-3) 70%, transparent);
  transition: all .3s var(--doc-ease-back);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item .milkdown-icon.label.checked {
  border: 1px solid var(--doc-primary);
  background: color-mix(in srgb, var(--doc-primary) 22%, transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--doc-primary) 30%, transparent);
}
/* Crepe 自带的方块/对勾 SVG 要藏掉，否则圆圈里叠一个原生图标 ✗ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item .milkdown-icon.label.unchecked > svg,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item .milkdown-icon.label.checked > svg { display: none; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item .milkdown-icon.label.checked::after {
  content: '';
  width: .45rem; height: .25rem;
  border: 2.5px solid var(--doc-strong);
  border-top: 0; border-right: 0;
  transform: translateY(-1px) rotate(-45deg);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item .milkdown-icon.label.bullet { color: var(--doc-primary); }

/* ── ⑧ 正文元素（配色沿用 theme.css:3183-3211，行高沿用 5088）────────── */
/* ⚠️⚠️ 「选中态不明显」的**真正根因**（实测像素采样，2026-10-30）✗✗：
     原来这条写的是 background: var(--doc-select) ✓ —— 四套 Phycat 配色各给一个值 ✓，
     可**它根本没生效** ✗：Crepe 自己也有一条选区规则
       .milkdown .ProseMirror *::selection { background: var(--crepe-color-selected) }
     （node_modules/@milkdown/crepe/lib/theme/common/reset.css:52 ✓，!important 都没有 ✓），
     特异性 0,2,0 —— 和原来那条**一模一样** ✗，而它的样式表是**编辑器挂载时**才注入的 ✓
     （life-styles.js 的样式早就进 head 了 ✗）→ 平手时后注入的赢 ✗ →
     选区的底色一直是 Crepe 的 --crepe-color-selected = **#2f2f2f**（frame-dark 主题 ✓）。
     证据：四套配色 + 浅色纸下把「选中 / 未选中」两张截图做像素众数统计 ✓，
     选中那一带的底色**恒为 rgb(47,47,47)** ✓，与纸色无关 ✓：
       everforest #272E33 → 47,47,47 几乎同色 → 看不见 ✗（用户就是这么发现问题的 ✓）；
       浅色纸 #F4F1E8 → 47,47,47 反而看得见 ✓。
     ⇒ 两条修法**一起上** ✓：
       ① 特异性抬到 0,3,0（多带一个 .ProseMirror ✓）→ 压过 Crepe 那条 ✓，不靠加载顺序 ✓；
       ② 底色换成一套**与纸色无关、四套配色共用**的强调蓝 ✓ ——
          rgb(63 116 216 / .62) 叠在纸面上：
            深色 rgb(52,84,145) L=38.6（ΔL +26.4 vs 纸面 12.2，对比度 2.19）✓
            浅色 rgb(135,167,227) L=71.0（ΔL −26.6 vs 纸面 97.6，对比度 2.33）✓
          判据：ΔL ≥18 或对比度 ≥1.9 ✓ —— 两条都过 ✓（实测见报告）。
      ★★ 2026-10-31 用户追加：「选中一段后和未选中看上去区别不大」✗ ——
        上一版是**主色 32% 叠加** ✓，可主色自己就在变 ✗：
          everforest 绿 32% → ΔL 15.8 ✗（判据 18）、vampire 红 32% → 17.4 ✗、
          abyss 青 / radiation 绿也都在 16~17 ✓ —— 四套里没有一套真正达标 ✓；
          而且底色一换配色就换色 ✓（用户要的是「一眼分得开」，不是「每套各有各的淡」✗）。
        ⇒ 改成**固定蓝** ✓：① 与纸色无关 → 四套配色 + 浅色纸下**完全一致** ✓；
          ② ΔL≈26 / 对比度 2.19~2.33 ✓；
          ③ 和行内高亮（暖黄 #efb93c 55%）一眼能分开 ✓ ——
             蓝 =「我刚选的」，黄 =「我标过的」✓（用户要求两者不许混淆 ✓）。
      ⚠️ 只作用于这两个容器（.lw-memo-ce / .lw-j-ce）✗，不写全局 ::selection ✓
         （含源码模式那个 textarea ✓ —— 它没有 markdown-preview-view 类，所以不带 var() ✓）。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror ::selection, :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror::selection, :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view::selection, :is(.lw-memo-ce,.lw-j-ce).lw-memo-src::selection, :is(.lw-memo-ce,.lw-j-ce) textarea::selection { background: rgb(63 116 216 / .62); color: var(--doc-strong, inherit); }
/* ★ 2026-10-31 加粗不明显（用户：和没加粗没多大差距）——
   编辑器作用域里原来**没有任何 font-weight 规则**，全靠浏览器对 <strong> 的默认 bold；
   而中文系统字体（PingFang/思源）在 600 与 700 之间的字重差极小，配上我们偏暗的正文色就看不出 ✗。
   三重加强：字重拉到 800 + 正文色提到最亮档 + 极细描边补足笔画厚度（0.28px，肉眼几乎不糊）✓ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror strong,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror b {
  /* ★ 二次加强（实测驱动的修正）：样式其实都生效了（weight 800 / ink / stroke .28px 都量到），
     但中文系统字体**没有 800 这一档**，浏览器把 700 与 800 合成为同一厚度 ⇒ 小字号下看不出 ✗。
     用户观察「只有鼠标放上去才明显」正好点明关键：悬停时那条 text-shadow 发光才是可见来源 ✓。
     所以把发光**常驻**（两层 .45px 微阴影把笔画撑厚），描边同步提到 .4px ✓。 */
  /* ★ 2026-10-31 二次回调（用户：加粗泛白严重）：上一版把发光常驻 + 描边 .4px + 颜色提到最亮档，
     三者叠加在深色底上产生了一圈**白晕** ✗ —— 笔画确实厚了，但整体发灰发白，比正文还虚。
     收敛为：颜色不再用最亮档（mix 到 ink2 与 ink 之间）、描边走 .3px、**去掉 text-shadow**（白晕就是它造成的），
     厚度靠字重本身 + 细描边表达 ✓。 */
  font-weight: 800;
  color: color-mix(in srgb, var(--pp-ink) 62%, var(--pp-ink2));
  -webkit-text-stroke: .3px currentColor;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view p { margin: var(--lw-gap, 12px) 0; padding: 0 !important; line-height: var(--lw-lh, 1.5); }

/* ── ⑧-a 加粗（theme.css:5529-5589「Underglow」）─────────────────────────
   官方不是「变个色」而已 ✓：常态先给一条 2px 的**透明**下边框占位 ✓，
   悬停时把这条边框染成主色 70% 透明 + 文字改主色 + 下方投一层柔光 ✓ ——
   占位边框是关键 ✗：没有它，悬停一出现边框，行高就会跳一下 ✓。
   box-decoration-break: clone = 跨行时**每一行**各自画自己的底线 ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view strong {
  color: var(--doc-strong);
  display: inline; position: relative;
  border-bottom: 2px solid transparent;
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
  transition: border-color .3s ease, color .3s ease, text-shadow .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view strong:hover {
  color: var(--doc-primary) !important;
  border-bottom-color: color-mix(in srgb, var(--doc-primary), transparent 70%);
  text-shadow: 0 2px 10px color-mix(in srgb, var(--doc-primary), transparent 60%);
}

/* ── ⑧-b 斜体：**流动波浪线**（theme.css:5601-5726）─────────────────────
   ⚠️ 不是虚线 ✗ —— theme.css 用两段 radial-gradient（上弧 + 下弧）拼一个完整波长，
      background-size:16px 2px 平铺 ✓：
        · 第一层圆心 (4px, -7.5px) = 上半弧 ✓
        · 第二层圆心 (12px, 9.5px) = 下半弧 ✓
      两层 background-position 差 2px（0 100% / 0 calc(100% - 2px) ✓），
      在交界处接成连续波浪 ✓ —— 手写 border-bottom:dashed 是山寨 ✗。
   半线宽由 --italic-wave-half 调（默认 .5px ✓）；
   悬停动画 memoItalicWaveFlow 每 .8s 平移一个完整波长（16px ✓）→ 波浪流动 ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view em {
  font-style: italic; text-decoration: none !important;
  /* ★ 2026-10-31 斜体与相邻文字贴太近（用户截图）：中文斜体是合成的，倾斜后字形向右探出，
     而这里是 display:inline + 无左右内边距 ⇒ 右端会压到下一个字。补 2px 左右呼吸 + 极轻字距 ✓ */
  display: inline; padding-bottom: 2px; padding-inline: 2px; margin-inline: 1px; letter-spacing: .01em;
  color: var(--doc-secondary);
  --italic-wave: color-mix(in srgb, var(--doc-secondary), transparent 60%);
  background-repeat: repeat-x;
  background-position: 0 100%, 0 calc(100% - 2px);
  background-size: 16px 2px;
  background-image:
    radial-gradient(circle at 4px -7.5px,
      transparent calc(8.5px - var(--italic-wave-half, .5px)),
      var(--italic-wave) calc(8.833px - var(--italic-wave-half, .5px)),
      var(--italic-wave) calc(8.167px + var(--italic-wave-half, .5px)),
      transparent calc(8.5px + var(--italic-wave-half, .5px))),
    radial-gradient(circle at 12px 9.5px,
      transparent calc(8.5px - var(--italic-wave-half, .5px)),
      var(--italic-wave) calc(8.833px - var(--italic-wave-half, .5px)),
      var(--italic-wave) calc(8.167px + var(--italic-wave-half, .5px)),
      transparent calc(8.5px + var(--italic-wave-half, .5px)));
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
  transition: color .2s ease, -webkit-text-stroke .2s ease, text-shadow .2s ease;
}
@keyframes memoItalicWaveFlow {
  from { background-position-x: 0; }
  to { background-position-x: 16px; }
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view em:hover {
  color: var(--doc-primary);
  --italic-wave: var(--doc-primary);
  -webkit-text-stroke: .6px var(--doc-primary);
  animation: memoItalicWaveFlow .8s linear infinite;
}

/* ── ⑧-c 删除线（theme.css:5732-5786）───────────────────────────────────
   常态：字色走 --phycat-strikethrough-color、贯穿线走主色 60% ✓；
   悬停：文字回到正文色、贯穿线换色，并且 **cursor:not-allowed** ✓ ——
   「删掉的东西不可点」是一句交互语言 ✓，不是漏写。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view del,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view s {
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--doc-primary), transparent 40%);
  color: var(--doc-text-3);
  transition: color .3s ease, text-decoration-color .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view del:hover,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view s:hover {
  color: var(--doc-text) !important;
  text-decoration-color: var(--doc-secondary);
  cursor: not-allowed;
}

/* ── ⑧-d 高亮（theme.css:5394-5466「弹性注水 / Elastic Ink」）──────────
   ⚠️ 这里**没有 mark** ✗✗ —— 实测 Crepe 的 commonmark 预设不含 mark 节点：
      写进正文的 ==值得记住的高亮== 原样留在 <p> 里（DOM 实测见报告），
      整篇文档 querySelector('mark') 返回 null ✓。
      本仓的高亮走**另一条路**：色板把选中文字包成 [文字](#cc-hl)（链接 mark ✓，
      见 src/reading-block-editor.js 的 HIGHLIGHT_HREF），所以按
      a[href^="#cc-hl"] 移植官方那套「注水」✓ —— 视觉与官方 ==高亮== 一致 ✓。
   官方做法：**不改背景色**，而是铺一层「底部 40% 高」的渐变 ✓，
      悬停把 background-size 从 40% 弹到 100%（曲线带回弹 ✓）→ 像墨水注满 ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a[href^="#cc-hl"] {
  padding: 0 2px; margin: 0; border-radius: 4px;
  color: var(--doc-text); text-decoration: none !important; cursor: text;
  background-color: transparent;
  background-repeat: no-repeat;
  background-position: 0 100%;
  background-image: linear-gradient(to top, color-mix(in srgb, var(--doc-primary), transparent 80%), transparent);
  background-size: 100% 40%;
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
  transition: background-size .4s cubic-bezier(.34, 1.56, .64, 1), color .3s ease,
              text-shadow .3s ease, box-shadow .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a[href^="#cc-hl"]:hover {
  background-size: 100% 100%;
  background-image: linear-gradient(to top, color-mix(in srgb, var(--doc-primary), transparent 75%), color-mix(in srgb, var(--doc-primary), transparent 92%));
}

/* ── ⑧-d-2 **真高亮 <mark>**（2026-10-30，推翻上面那条注释的前半段）────────
   ⚠️ 上面那段注释说「这里没有 mark」——那是**旧内核**的事实 ✗。现在不一样了 ✓：
      色板不再把文字包成 [文字](#cc-hl)（假链接 → 点上去弹链接预览 ✗、还被标签系统
      当成 #cc-hl 收进索引 ✗），改成**存储 <mark>文字</mark>**，由
      assets/life-editor.js 的「画手」把编辑器里渲染出来的 <a href="#cc-hl"> 就地画成
      <mark> ✓（机制见那边的长注释 ✓）。
   ★ 底色必须是**实打实的 background-color** ✗✗ —— 旧的「注水」用的是渐变
      （background-image），computed background-color 是 transparent ✓，
      验收要「可见底色」这一条就过不了 ✓，用户也说「看不出是高亮」✓。
      所以这里给一层**真的高亮笔底** ✓；渐变那套留给
      尚未被画到的 <a href="#cc-hl">（就是画手跑之前那一帧 ✓，避免闪一下）。
   ★★ 2026-10-31 用户追加：「行内高亮也偏淡」✗ —— 从 rgb(242 193 78 / .34) 提到
      rgb(239 185 60 / .55)（悬停 .72）✓。为什么这个数（实测，判据 ΔL ≥15）：
        · 深色纸 rgb(34,32,28)：合成后 rgb(147,116,46) L=37.8 → ΔL +25.6 ✓（旧值 +17.2）；
        · 浅色纸 rgb(253,250,245)：合成后 rgb(245,214,143) L=76.1 → ΔL −21.5 ✓（旧值只有 −11.9 ✗）。
      ⚠️ 浅色纸是旧色**唯一不达标**的那一侧 ✗ —— 深色下 .34 本来就够 ✓，所以这次是按浅色定值 ✓。
      ★ 四套配色下这个合成色**完全一样** ✓：底色来自 --ed-paper（只跟 --pp-* 走 ✓），
        黄笔是固定色 ✓ —— 用户要的「四套 + 浅色纸都成立」是同一组数字 ✓。
      ★ 和选中态（固定蓝 rgb(63 116 216 / .62)）**刻意分色** ✓：
        蓝 =「刚选的」，黄 =「标过的」✓，一眼能分辨 ✓（用户要求 ✓）。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view mark {
  background-color: rgb(239 185 60 / .55); color: inherit; padding: 0 2px; border-radius: 3px;
  text-decoration: none; -webkit-box-decoration-break: clone; box-decoration-break: clone;
  transition: background-color .25s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view mark:hover { background-color: rgb(239 185 60 / .72); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror span[data-cc-color] { text-decoration: none !important; }

/* ── ⑧-e 行内代码：胶囊 + 悬停实心化（theme.css:7193-7236）──────────────
   常态 = 主色字 + 主色 15% 描边 + 6px 圆角 ✓；
   悬停 = **实心强调色底 + 反色字** + 15px 光晕 + scale(1.05) ✓，
   曲线 .2s cubic-bezier(.34,1.56,.64,1) 带回弹 ✓（照抄，不换 --mo-*）。
   ★ 2026-10-31 底色改造（用户：「背景色彩有些突兀」）✗✗：
     · 常态底原本是 color-mix(--doc-primary 10%, transparent) ✗ —— 那是**铺一层主色** ✓，
       切四套 Phycat 配色时底色跟着变（绿 / 青 / 绿 / 红）✗；
       ⇒ 换成 var(--ed-sunk)（面板同一套纸色的下沉半档 ✓，代号见 .lw-inpanel 那段注释 ✓）。
     · 悬停底原本是**实心 --doc-primary + #fff 字** ✗ —— 同样是拿 --doc-* 铺底 ✓，
       而且 vampire（#FF5555）下白字对比度只有 2.5 ✗；
       ⇒ 换成 var(--pp-accent) + var(--pp-on-accent) ✓（面板的强调色 / 反色字成对给的 ✓，
         深色 #d8c9a3/#17140f、浅色 #2f5d46/#fdfbf6 ✓），底色不再随文档配色跳 ✓。
     ⚠️ 主色的两处用途**保留** ✓：字色（--doc-primary）和描边（主色 15%）✓ ——
        用户明确说「--doc-primary 可以继续染字，但不许铺底」✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view :not(pre) > code {
  font-family: ui-monospace, SFMono-Regular, Menlo, var(--font-monospace, monospace);
  letter-spacing: .5px;
  background-color: var(--ed-sunk);
  color: var(--doc-primary) !important;
  border: 1px solid color-mix(in srgb, var(--doc-primary), transparent 85%);
  padding: 2px 6px !important; margin: 0 2px;
  border-radius: 6px; vertical-align: middle;
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
  transition: background-color .2s cubic-bezier(.34, 1.56, .64, 1), color .2s cubic-bezier(.34, 1.56, .64, 1),
              border-color .2s cubic-bezier(.34, 1.56, .64, 1), box-shadow .2s cubic-bezier(.34, 1.56, .64, 1),
              transform .2s cubic-bezier(.34, 1.56, .64, 1);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view :not(pre) > code:hover {
  background-color: var(--pp-accent) !important;
  color: var(--pp-on-accent) !important;
  border-color: var(--pp-accent);
  box-shadow: 0 0 15px color-mix(in srgb, var(--pp-accent), transparent 60%);
  transform: scale(1.05);
  position: relative; z-index: 1;
}

/* ── ⑧-f 代码块：Mac 顶栏 + 悬停描边（theme.css:6124-6182）─────────────
   ★★ 这里有一处**实测出来的坑**，不写清楚下一轮又会踩 ✗✗
     官方把代码块画在 .markdown-preview-view pre 上 ✓，看起来 Crepe 也有 pre ✓ ——
     但那是**过渡态**：Crepe 的代码块是**进视口才挂载**的 ✓（懒加载），
       ① 没进视口： div.milkdown-code-block > pre.milkdown-code-block-placeholder > code
       ② 一进视口： div.milkdown-code-block[data-v-app]
                      > div.tools（语言按钮 + 复制按钮）
                      > div.codemirror-host > div.cm-editor > …
     实测（滚动前后各 dump 一次 DOM）：pre 的数量 1 → **0** ✓，
     .cm-editor 0 → 1 ✓。⇒ 只给 pre 上样式 = 只画到**闪一下的那一帧** ✗。
   ✓ 所以真正要画的是 .milkdown-code-block 这颗容器 + 它里面的 .tools 头栏 + .cm-editor ✓；
     pre 那几条保留（首帧不跳色 ✓），但**不再给它铺 Mac 三色点** ✗ ——
     三色点改画在 .tools 的 ::before 上 ✓（= 一直可见的那条头栏 ✓）。
     官方那段 SVG 原图 base64 原样搬 ✓。
   悬停：描边转主色 + 0 4px 12px 投影 ✓、头栏底色与分割线同时提一点 ✓；
   曲线 border-color/box-shadow .3s ease 照抄 ✓ —— 全在边框和阴影上，零布局 ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block {
  position: relative;
  margin: 20px 0 !important;
  padding: 0 !important;
  background-color: var(--ed-sunk) !important;
  border: 1px solid var(--pp-line) !important;
  border-radius: 8px !important;
  overflow: hidden;
  box-shadow: none !important;
  transition: border-color .3s ease, box-shadow .3s ease;
}
/* 头栏：官方 .markdown-preview-view pre::before（32px、主色 4% 底、左侧 54px 三色点）✓
   ⚠️ 左边要多留 72px —— Crepe 的「js」语言按钮本来贴在最左 ✗，
      不留位就会被三色点压住 ✓（静态让位，不是悬停位移 ✓）。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .tools {
  position: relative;
  min-height: 32px;
  padding-left: 72px !important;
  background-color: var(--ed-chrome);
  background-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgIHg9IjBweCIgeT0iMHB4IiB3aWR0aD0iNDUwcHgiIGhlaWdodD0iMTMwcHgiPgogIDxlbGxpcHNlIGN4PSI2NSIgY3k9IjY1IiByeD0iNTAiIHJ5PSI1MiIgc3Ryb2tlPSJyZ2IoMjIwLDYwLDU0KSIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJyZ2IoMjM3LDEwOCw5NikiLz4KICA8ZWxsaXBzZSBjeD0iMjI1IiBjeT0iNjUiIHJ4PSI1MCIgcnk9IjUyIiAgc3Ryb2tlPSJyZ2IoMjE4LDE1MSwzMykiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0icmdiKDI0NywxOTMsODEpIi8+CiAgPGVsbGlwc2UgY3g9IjM4NSIgY3k9IjY1IiByeD0iNTAiIHJ5PSI1MiIgIHN0cm9rZT0icmdiKDI3LDE2MSwzNykiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0icmdiKDEwMCwyMDAsODYpIi8+Cjwvc3ZnPg==);
  background-repeat: no-repeat;
  background-size: 54px;
  background-position: 12px center;
  border-bottom: 1px solid var(--pp-line);
  border-radius: 8px 8px 0 0;
  transition: background-color .3s ease, border-bottom-color .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .tools .language-button {
  background: transparent !important;
  border-color: var(--pp-line) !important;
  color: var(--doc-text-2) !important;
  box-shadow: none !important;
}
/* CodeMirror 那两层自带**深色底**（实测 .cm-editor / .cm-gutters 都是 rgb(18,18,18) ✗）——
   在浅色纸上一块黑 ✗。拍平成透明、文字改用 --doc-text ✓（和本文件 ⑫ 拍平 .milkdown 同一手法 ✓）。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-editor,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-gutters,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-scroller {
  background: transparent !important;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-content,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-line {
  color: var(--doc-text) !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, var(--font-monospace, monospace);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-gutters,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-gutterElement {
  color: var(--doc-text-3) !important;
  border: 0 !important;
}
/* 当前行的高亮同样是**深色块**（实测 .cm-activeLineGutter 的底色是一块 rgb(60,56,54) ✗，
   在浅色纸上像贴了一张黑胶带 ✓）→ 改成主色 6% 的极淡一层 ✓，和 Phycat 的纸面同色系 ✓ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-activeLine,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block .cm-activeLineGutter {
  background-color: var(--ed-hover) !important;
}
/* 悬停：主色描边 + 投影 + 头栏提亮（官方 pre:hover 与 pre:hover::before 两段 ✓） */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block:hover {
  border-color: var(--doc-primary) !important;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--doc-primary), transparent 85%);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown-code-block:hover .tools {
  background-color: color-mix(in srgb, var(--ed-chrome) 82%, var(--pp-ink));
  border-bottom-color: color-mix(in srgb, var(--doc-primary), transparent 80%);
}
/* 首帧（还没挂载 CodeMirror 时）的占位 pre：和上面同一张卡，避免闪一下别的颜色 ✓ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view pre {
  position: relative;
  background-color: var(--ed-sunk) !important;
  border: 1px solid var(--pp-line) !important;
  border-radius: 8px !important;
  padding: 12px 16px !important;
  margin: 20px 0; overflow: hidden;
  box-shadow: none !important;
  transition: border-color .3s ease, box-shadow .3s ease;
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view pre:hover {
  border-color: var(--doc-primary) !important;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--doc-primary), transparent 85%);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view pre code {
  display: block; overflow-x: auto;
  background: none !important; color: var(--doc-text) !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, var(--font-monospace, monospace);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view hr {
  border: none; height: 1px; margin: var(--lw-gap-lg, 20px) 0;
  background: linear-gradient(90deg, transparent,
    color-mix(in srgb, var(--doc-primary) 42%, transparent), transparent);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view th {
  background: color-mix(in srgb, var(--doc-primary) 12%, transparent); color: var(--doc-strong);
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view th,
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view td { border-color: color-mix(in srgb, var(--doc-text) 10%, transparent); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view tbody tr:hover td { background: color-mix(in srgb, var(--doc-primary) 7%, transparent); }

/* ── ⑧-g 列表标记对齐 + 纵向节奏（两档）+ 内容列撑满（2026-10-30）─────────
   ★★ 现象（用户直接指出，2026-10-30）：有序 1. / 无序 · / 任务圆圈 **全都比文字偏高** ✓。
     **判据是量出来的，不是看图** ✓ —— 备忘 + 日记各取有序/无序/任务 3 条（共 18 个样本），
     用 getBoundingClientRect 量「标记盒中心 Y − 同一行文字的行盒中心 Y」：
       改前：-12.29 / -12.30 / -12.30 …（18 条全落在 -12.29 ~ -12.30 ✓，方向一致 ✓）
       改后：+0.50 / +0.50 / +0.50 …（18 条全是 +0.50 ✓，远小于判据的 ≤2px ✓）

   ★ 为什么正好差 12.3px ✗✗ —— **是我们自己推下去的，不是 Crepe 的锅** ✓：
     Crepe 的列表项是 flex 布局（node_modules/@milkdown/crepe/lib/theme/common/list-item.css：
       .milkdown-list-item-block > .list-item { display:flex; align-items:flex-start }）✓
     标记盒子 .label-wrapper 写死 height:32px、**贴 li 顶边** ✓ → 标记中心 = li 顶 + 16 ✓；
     而 ⑧ 那条 p 原本是 margin:.8em 0 ✓ —— em 落在 Crepe 的 16px 上 = **上下各 12.8px** ✗，
     把文字整体往下推了 12.8px ✓ → 文字行盒中心 = li 顶 + 28.3 ✓，差值正是 -12.3 ✓。
     ⚠️ 阅读模块（.md-doc）里看不出这个 bug ✓：那边用的是浏览器原生列表符号（::marker
        跟着行盒走 ✓），**没有「独立定位的标记盒子」这层结构** ✓ —— 换到 Crepe 才炸 ✓。

   ★ 修法（缺①差 12px，缺②差 1~2px，两条都必须有）：
     ① 列表项里的 p 不再带上下 margin ✓（下面第 4 条规则）→ 文字回到 li 顶边 ✓；
     ② 标记盒高度 = **正文首行行盒高** ✓（第 5 条规则，--lw-lh × 1em）——
        ✗ 不写死 32px：Crepe 那个 32 是「4+4 padding + 24 行盒」凑出来的 ✓，
          一旦字号/行高变（⑪ 浅色主题、以后调字号），写死的值立刻又偏 ✓；
        ✓ 钉成 calc 之后，标记盒中心 ≡ 文字行盒中心 **跟着变** ✓ —— 结构性对齐，不是对数字 ✓。
        ⚠️ 剩下那 0.5px 是**字体墨迹盒（ink box）**本身比行盒偏下 0.5px（16px 字实测：行盒 24、
          墨迹盒 17 且起点不在正中 ✓），属于字体几何，不是布局误差 ✓ —— 再往上凑就是挪数字了 ✗。

   ★ 纵向节奏：**只有 12 / 20 两档** ✓（--lw-gap / --lw-gap-lg，定义在 .ProseMirror 上，
     因为这三个变量只给正文用 ✓）：
       · 12px = 段落之间、段落↔列表、标题之下 ✓
       · 20px = 标题之上、引用块上下、代码块上下（⑧-f 的 pre 本来就是 20 ✓）✓
     ⚠️ 标题的 margin 必须 !important ✗✗ —— Crepe 的 reset.css 给 h1~h6 都写了 margin-top
        （32 / 28 / 24 / 20 / 16 / 16px ✓），而且那张表**注入在本文件之后** ✓
        → 同特异性 Crepe 赢 ✓（实测：③ 里写的 h2 margin-top:1.6em 从来没生效过 ✓，
          量出来一直是 Crepe 的 28px ✓ —— 和 ③ 注释里记的那个坑是同一件事 ✓）。
     ⚠️ 这里只动 margin-top / margin-bottom **两个长写** ✗ —— 不能写 margin 简写：
        ② 的 .h1-align-center h1 { margin-left:auto !important; margin-right:auto !important }
        和本规则**特异性相同** ✓，又是本规则在后 ✓ → 简写会把「H1 居中」顺手干掉 ✗✗。
     ⚠️ p 的 margin **别加 !important** ✗：Crepe 的 .milkdown * { margin:0 } 是 (0,1,0) ✓，
        ⑧ 那条 (0,2,1) 本来就赢 ✓；加了反而会顶掉 ⑤ 引用块里那句 p { margin:0 0 .5em } ✗
        （那条没带 !important ✓）。**padding 反而必须带 !important** ✓ ——
        Crepe 的 .milkdown .ProseMirror p { padding:4px 0 } 与 ⑧ 同特异性 (0,2,1)、后注入 ✓
        → 不标 !important 就还是 4px ✗（4+4 会把「段间 12」实测量成 20 ✓，一眼能看出来 ✗）。

   ★ 内容列撑满可视区（底部不留大片空白）✓：
     .milkdown 设 min-height:100% + flex 列 ✓，.ProseMirror flex:1 吃掉剩下的高度 ✓ ——
     实测短备忘（正文只有一行）：.ProseMirror 高 **32px → 451.7px** ✓
     （= 纸面 563.7 − Crepe 顶栏 44 − 上下 padding 68 ✓）。
     ⚠️ 不能只给 .ProseMirror 写 min-height:100% ✗✗ —— 它的包含块是 .milkdown，
        而 .milkdown 的高度是「内容撑出来的」(auto) ✓ → 百分比 min-height 按 auto 处理 ✓
        = **完全不生效** ✓（实测 min-height:100% / calc(100% - 68px) 两种写法，量出来都还是 32px ✓）。
     ⚠️ .milkdown 变 flex 列**不会**打乱 Crepe 那些浮层 ✓（toolbar / link-preview /
        link-edit / block-handle / slash-menu 全是绝对定位，不参与 flex ✓ —— 改后实测仍是 0×0 ✓）。
     ★ 为什么这算「样式」不算「改行为」✓：点击落光标是 ProseMirror 自己的事 ✓，
       盒子撑满只是让「点正文下面那片空白」也能落到文档末尾 ✓ —— 一行 JS 都没动 ✓。

   ★ 列宽：760px → 700px ✓ —— 正文实测是 16px（Crepe 的 --crepe-base-font-size 默认值 ✓，
     ① 里那句 14.5px 落不到正文上 ✓），760px 一行能放 **约 47 个汉字** ✗，
     超出「CJK 一行 30~45 字」的舒适区 ✓；700px ≈ **43 个字** ✓，落在区间内 ✓。
     实测本机 1440 宽时中栏本来就只有 670px ✓，所以这条只在更宽的窗口上才看得见 ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror { --lw-gap: 12px; --lw-gap-lg: 20px; --lw-lh: 1.5; flex: 1 1 auto; }
/* ★ 2026-10-30 修「正文像缩进了一块 / 不安左」：⑧-g 给 .milkdown 加了 display:flex，
   而 .ProseMirror 上有 margin:0 auto ⇒ flex 交叉轴的 auto margin 触发 shrink-to-fit，
   空笔记时列宽算成 0（实测 39 字一行宽 616px、左边界 787 而容器左 607）。
   补 width:100% 撑满，再靠 max-width + auto margin 居中 ✓ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror { width: 100%; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror > :is(ul, ol) { margin: var(--lw-gap) 0; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .ProseMirror > :is(h1, h2, h3, h4, h5, h6) { margin-top: var(--lw-gap-lg) !important; margin-bottom: var(--lw-gap) !important; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item .content-dom > p { margin: 0; }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view li.list-item > .label-wrapper { height: calc(var(--lw-lh) * 1em); }
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view .milkdown { display: flex; flex-direction: column; min-height: 100%; }

/* ── ⑨ 源码模式（textarea）也跟着纸面走 ─────────────────────────────── */
.lw-memo-src {
  background: var(--ed-sunk) !important;
  color: var(--doc-text) !important;
  border: 1px solid var(--doc-line) !important;
  border-radius: 10px; padding: 14px 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px; line-height: 1.75;
  width: 100%; resize: vertical; min-height: 320px; outline: none;
}

/* ── ⑩ 加载失败时的兜底展示（不静默 ✗，见 life-workbench.js 的 memoMountEditor）── */
.lw-memo-err {
  margin: 0 0 10px; padding: 8px 12px; border-radius: 8px;
  background: color-mix(in srgb, #E67E80 16%, transparent);
  border: 1px solid color-mix(in srgb, #E67E80 45%, transparent);
  color: var(--doc-text); font-size: 12px;
}
.lw-memo-fallback {
  white-space: pre-wrap; word-break: break-word; margin: 0;
  color: var(--doc-text-2); font-size: 12.5px;
}

/* ── ⑪ 浅色 App 主题（html[data-theme="light"]）→ 正文纸色跟着面板走 ────
   为什么必须单独一段 ✗：--doc-* 那 4 套**全是深色** ✓（本文件开头写着：
     亮色 8 套要整套反色、没做，半套的亮色主题比没有更糟 ✓）。
   而备忘录面板自己**有**浅色纸（life-workbench.js:90 的 --pp-*，实测
     --pp-page:#f4f1e8 / --pp-ink:#221f1b）✓ —— 不接的话，浅色 App 下
   正文会是一张深色纸，和周围面板打架 ✗。
   ✓ 做法：在**这个容器内**把 --doc-* 重映射到 --pp-*（派生量用 color-mix）✓ ——
     不新增任何色值 ✓、不动那 4 套调色板 ✓（和本文件 ⑩ 的「容器内覆盖令牌」同一手法）。
   ★★ 2026-10-31（底色改造）之后这一段**只管字色 / 线色 / 强调色** ✓：
     正文纸面改成 --ed-paper（只由 --pp-* 推导 ✓，见 .lw-inpanel 那段注释），
     已经**没有任何规则**再拿 --doc-bg / --doc-bg-dim 铺底 ✓（grep 可查 ✓）。
     下面这三行 --doc-bg* 留着当**保险** ✗ 不删：以后若有人又写一条 var(--doc-bg) 铺底，
     浅色下它会落到 --pp-page（纸面同族 ✓）而不是那张偏冷的 Phycat 纸（#272E33 ✗）。 */
html[data-theme="light"] :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view {
  --doc-bg: var(--pp-page);
  --doc-bg-dim: color-mix(in srgb, var(--pp-page) 94%, #000);
  --doc-bg-soft: var(--pp-sheet);
  --doc-text: var(--pp-ink);
  --doc-text-2: var(--pp-ink2);
  --doc-text-3: color-mix(in srgb, var(--pp-ink2) 72%, transparent);
  --doc-strong: var(--pp-ink);
  --doc-primary: var(--pp-accent);
  --doc-secondary: color-mix(in srgb, var(--pp-accent) 62%, var(--pp-ink2));
  --doc-line: var(--pp-line);
  --doc-select: color-mix(in srgb, var(--pp-accent) 22%, transparent);
  --doc-pink: color-mix(in srgb, var(--pp-accent) 30%, transparent);
  /* 派生量在 :root 上算（用的是深色 primary）→ 这里必须重算一遍 ✗ */
  --doc-glow: color-mix(in srgb, var(--pp-accent) 22%, transparent);
  --doc-glow-text: 0 0 14px color-mix(in srgb, var(--pp-accent) 50%, transparent);
}

/* ── ⑫ Crepe 自己的深色底 → 必须接管 ✗✗
   实测（浅色 App 主题下量出来的）：容器背景已经是 #f4f1e8 ✓，
   但里面 .milkdown 这一层是 rgb(26,26,26) ✗ —— 那是 Crepe 自带的深色底色，
   连文字一起盖住，于是整块看起来还是一张黑纸 ✗（第一版截图就是这样：面板白了、正文还是黑的）。
   ⚠️ 选择器里多带一个 .codescope-crepe-host（= 区块编辑器自己加在 root 上的类 ✓，
      见 src/reading-block-editor.js 的 create）：提一级特异性 ✓，不用跟 Crepe 赌注入顺序 ✓。
   ★ 2026-10-30：Crepe 自带那条 TopBar **已经不在这两处出现了** ✓ ——
      create({ topBar:false }) 关掉的 ✓（默认仍是 true：阅读视图 / 分栏 / 主编辑区一个都没动 ✓，
      见 src/reading-block-editor.js 里 topBar 的注释）。
      所以原来给 .milkdown-top-bar 上色 / 去投影的那四条规则**一并删掉了** ✓：
      它们只会匹配到一个不存在的元素，留着就是死规则 ✗。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view.codescope-crepe-host .milkdown {
  background: transparent !important;
  color: var(--doc-text) !important;
}

/* ── ⑭ 提示框（callout）：7 种语气 + 悬停（2026-10-30）════════════════════
   ── 为什么不能照抄 theme.css 的选择器 ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯
   ✗✗ theme.css 那套的骨架是**两级 DOM**：
        .callout > .callout-title > (.callout-icon + .callout-title-inner)
                 + .callout-content > p
      靠 .callout-title 做胶囊、.callout-content 装正文 ✓。
   而 Crepe 里的提示框是**一条 blockquote + 三个 span**（实测 outerHTML，
   用的是 src/reading-block-editor.js 里 calloutPlugin 的 Decoration：
        blockquote.md-callout.note
          > p > span.cc-callout-prefix              （[!note] 那截，已被全局规则藏掉）
              + span.cc-callout-title               （标题「笔记」）
              + span[data-type=hardbreak]           （换行，doc-theme.css 里 display:block）
              + span.cc-callout-title               （正文）
   ⇒ **没有** .callout-title / .callout-content / .callout-icon 这三个钩子 ✓。
   ✓ 做法：胶囊落到「紧跟在 .cc-callout-prefix 后面那个 .cc-callout-title」上 ✓
     （.cc-callout-prefix + .cc-callout-title 是相邻兄弟选择器，结构上必然命中 ✓，
       比写 :nth-child(2) 稳 ✓）；正文那个 span 用 hardbreak 做前锚点反向选中 ✓。
   ✓ 菱形符号用胶囊的 ::before（官方是 .callout-icon 里的 ◇ 字面量 ✓，同字形 ✓）。
   ✓ 水印就是官方 .callout::after 那一条，原样搬 ✓。

   ── 令牌从哪来（不是我自己调的色 ✓）⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯ ⋯⋯
   theme.css 的 :root 里每类有 5 个 --phycat-callout-<type>-* 令牌 ✓；
   palette.js:256-275 的 'callout' 配方说明 **title-color 是种子色**，
   background = 种子色 10%（悬停 18%）的低透明度铺底、watermark = 种子色 ✓。
   所以这里直接取 theme.css:2586-2664 的**实际值**（不是推导值）✓ ——
   它们是 rgba(…) 半透明色 ✓，铺在深色纸上会自然降饱和 ✓，四套配色都不用改 ✓。

   ⚠️ 已知偏离官方「亮色渲染」的一处，故意这么做（见报告）：
     theme.css:6618-6648 在亮色下把 info / todo 的底面**并到 note** 上
     （.theme-light .callout[data-callout="info"]{ background: var(--…-note-background) }），
     于是官方亮色里 info/todo 和 note 同色 ✗。
     但 palette-data.js 里 info/todo 各自有独立令牌（#74c0fc 蓝 / #50fa7b 绿 ✓），
     本项目要的是「7 种语气各自配色」✓ ⇒ 按 token 走，三种颜色是分开的 ✓。
     要改回官方那种并色，只需把下面 .info / .todo 的 --co-bg / --co-title 换成 note 那两行。
   ═══════════════════════════════════════════════════════════════════════ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout {
  /* 兜底 = note（也覆盖菜单里能插入、但这里没逐个列出的语气）*/
  --co-bg: color-mix(in srgb, #306bd6 10%, var(--ed-sunk));
  --co-hover: color-mix(in srgb, #6c5ce7 15%, var(--ed-sunk));
  --co-title: #6c5ce7;
  --co-wm: #6c5ce7;
  --co-glyph: "📝";
  /* 胶囊底/描边：深色纸给「白 6%」，浅色纸在下面单独覆盖成官方那版「白 60%」✓ */
  --co-pill-bg: rgba(255, 255, 255, .06);
  --co-pill-border: rgba(255, 255, 255, .1);
  position: relative;
  padding: 12px 16px !important;
  /* 2026-10-30：块间距统一成 12/20 两档（见 ⑧-g）—— 原来是 1em=16px，属于第三档 ✗ */
  margin-block: var(--lw-gap-lg, 20px) !important;
  border: 0 !important;
  border-radius: 12px !important;
  overflow: hidden;
  background-color: var(--co-bg) !important;
  /* 官方 .callout 的三条过渡照抄（theme.css:6488-6491 ✓），
     background-color 那条是悬停换底色的唯一通道 ✓。 */
  transition: transform .3s cubic-bezier(.34, 1.56, .64, 1),
              box-shadow .3s ease, background-color .3s ease;
}
/* 悬停：z-index 抬起来（官方 .callout:hover 只做这一件 ✓），底色换成该类的 hover 档 ✓ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout:hover {
  z-index: 5;
  background-color: var(--co-hover) !important;
}
/* 正文容器：Crepe 只有这一个 p，⑧ 的 p 上下 margin 必须清掉，
   否则 12px 内边距会被撑成 30px ✗（同 ⑤ 引用块踩过的坑 ✓）。*/
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout > p {
  position: relative; z-index: 2;
  margin: 0 !important; padding: 0 !important;
  line-height: 1.6; color: var(--doc-text-2);
}
/* 胶囊标题：官方 .callout-title（theme.css:6507-6533）逐条搬 ——
   inline-flex / radius 50px / padding 4px 12px / 700 / .9em / margin-bottom 12px ✓ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout > p > .cc-callout-prefix + .cc-callout-title {
  display: inline-flex !important; align-items: center;
  margin: 0 0 12px !important;
  padding: 4px 12px !important;
  border-radius: 50px !important;
  font-weight: 700 !important; font-size: .9em; line-height: 1.2;
  color: var(--co-title) !important;
  background-color: var(--co-pill-bg) !important;
  border: 1px solid var(--co-pill-border) !important;
  position: relative; z-index: 2;
}
/* 菱形符号：官方 .callout-icon 是 16px 的 ◇ + margin-right 6px（theme.css:6535-6545）✓ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout > p > .cc-callout-prefix + .cc-callout-title::before {
  content: '◇'; margin-right: 6px; flex: 0 0 auto;
  font-weight: 400; line-height: 1; color: currentColor;
}
/* 正文那个 span 也带着 .cc-callout-title（同一个 Decoration ✗），
   而 doc-theme.css:469 给它统一上了「700 + 语气色」⇒ 这里必须按结构反向拆开 ✓，
   否则正文也是粗体、也是语气色 ✗ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout > p > [data-type="hardbreak"] + .cc-callout-title {
  display: inline; font-weight: 400 !important; color: var(--doc-text-2) !important;
}
/* ⚠️ 必须显式**掐掉** Crepe 自带的引用块左竖条 ✗✗ ——
   实测（把命中这条 blockquote 的规则全 dump 出来）：那根深色竖条来自
     reading-block-editor.css 的 .milkdown .ProseMirror blockquote::before
     （content:"" / width 4px / 背景 rgb(47,47,47) / position:absolute / left:0 ✓）。
   ⚠️ 本文件 ⑤ 的规则写的是 blockquote:not(.md-callout)::before ✓，
      正好**放过**了提示框 ✓ ⇒ 不补这一条，每个提示框左边都会多一根黑条 ✗
      （第一版截图就是这样 ✓）。用 content:none 而不是 display:none：
      伪元素没内容就整个不生成盒子 ✓，比藏一个 4px 空盒干净 ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout::before {
  content: none !important;
}
/* 水印：官方 .callout::after（theme.css:6561-6592）原样搬 ——
   ⚠️ 位置是**右下角**（right:-10px / bottom:-15px ✓），不是右上角 ✗；
      80px、opacity .12、rotate(-15deg)、grayscale(100%)、pointer-events:none ✓。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout::after {
  content: var(--co-glyph);
  position: absolute !important;
  right: -10px !important; bottom: -15px !important;
  font-family: "Segoe UI Emoji", "Apple Color Emoji", sans-serif;
  font-size: 80px !important; line-height: 1; font-style: normal;
  color: var(--co-wm);
  opacity: .12 !important;
  transform: rotate(-15deg);
  filter: grayscale(100%);
  pointer-events: none;
  z-index: 0;
  transition: transform .4s cubic-bezier(.34, 1.56, .64, 1), opacity .4s cubic-bezier(.34, 1.56, .64, 1),
              right .4s cubic-bezier(.34, 1.56, .64, 1), bottom .4s cubic-bezier(.34, 1.56, .64, 1),
              filter .4s cubic-bezier(.34, 1.56, .64, 1);
}
/* 悬停：水印回正 + 放大 1.1 + 升起（bottom -15 → -5）+ 恢复彩色 + 变浓 ✓
   —— 这就是官方页脚说的「悬停提示框，看颜色和水印的变化」✓ */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout:hover::after {
  transform: rotate(0deg) scale(1.1) !important;
  opacity: .25 !important;
  right: 0 !important; bottom: -5px !important;
  filter: grayscale(0%) !important;
}

/* ── ⑭-b 七种语气的令牌（theme.css:2586-2664 的实际值，逐条抄）────────────── */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.note {
  --co-bg: color-mix(in srgb, #306bd6 10%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #6c5ce7 15%, var(--ed-sunk));
  --co-title: #6c5ce7; --co-wm: #6c5ce7; --co-glyph: "📝";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.info {
  --co-bg: color-mix(in srgb, #74c0fc 10%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #74c0fc 16%, var(--ed-sunk));
  --co-title: #74c0fc; --co-wm: #74c0fc; --co-glyph: "ℹ️";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.todo {
  --co-bg: color-mix(in srgb, #50fa7b 10%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #50fa7b 16%, var(--ed-sunk));
  --co-title: #50fa7b; --co-wm: #50fa7b; --co-glyph: "✅";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.tip {
  --co-bg: color-mix(in srgb, #00b894 10%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #00b894 15%, var(--ed-sunk));
  --co-title: #00b894; --co-wm: #00b894; --co-glyph: "💡";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.warning {
  --co-bg: color-mix(in srgb, #fdcb6e 15%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #fdcb6e 20%, var(--ed-sunk));
  --co-title: #e17055; --co-wm: #e17055; --co-glyph: "⚠️";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.important {
  --co-bg: color-mix(in srgb, #ff7675 12%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #ff7675 18%, var(--ed-sunk));
  --co-title: #ff7675; --co-wm: #ff7675; --co-glyph: "📌";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.caution {
  --co-bg: color-mix(in srgb, #d63031 8%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #d63031 12%, var(--ed-sunk));
  --co-title: #d63031; --co-wm: #d63031; --co-glyph: "🔥";
}
/* 另外 7 类：提示框菜单里也能插（14 个按钮 ✓），不补就是「点出来长得像笔记」✗。
   值同样取自 theme.css:6739-6894 ✓，一个都不是我调的。 */
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.success {
  --co-bg: color-mix(in srgb, #55efc4 15%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #55efc4 25%, var(--ed-sunk));
  --co-title: #00b894; --co-wm: #00b894; --co-glyph: "🎉";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.question {
  --co-bg: color-mix(in srgb, #fdcb6e 15%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #fdcb6e 25%, var(--ed-sunk));
  --co-title: #f39c12; --co-wm: #f39c12; --co-glyph: "❓";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.example {
  --co-bg: color-mix(in srgb, #a29bfe 15%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #a29bfe 25%, var(--ed-sunk));
  --co-title: #6c5ce7; --co-wm: #6c5ce7; --co-glyph: "🧩";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.quote {
  --co-bg: color-mix(in srgb, #b2bec3 15%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #b2bec3 25%, var(--ed-sunk));
  --co-title: #636e72; --co-wm: #636e72; --co-glyph: "💬";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.danger {
  --co-bg: color-mix(in srgb, #d63031 15%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #d63031 20%, var(--ed-sunk));
  --co-title: #d63031; --co-wm: #d63031; --co-glyph: "⚡";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.bug {
  --co-bg: color-mix(in srgb, #d63031 8%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #d63031 12%, var(--ed-sunk));
  --co-title: #d63031; --co-wm: #d63031; --co-glyph: "🐛";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.failure {
  --co-bg: color-mix(in srgb, #2d3436 10%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #2d3436 12%, var(--ed-sunk));
  --co-title: #c0392b; --co-wm: #c0392b; --co-glyph: "📉";
}
:is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout.abstract {
  --co-bg: color-mix(in srgb, #81ecec 20%, var(--ed-sunk)); --co-hover: color-mix(in srgb, #81ecec 30%, var(--ed-sunk));
  --co-title: #00cec9; --co-wm: #00cec9; --co-glyph: "📑";
}
/* 浅色纸：胶囊底/描边换回官方亮色那两档（theme.css:2586-2587 ✓） */
html[data-theme="light"] :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout {
  --co-pill-bg: rgba(255, 255, 255, .6);
  --co-pill-border: rgba(0, 0, 0, .05);
}

/* ── ⑮ 减少动态效果（prefers-reduced-motion）════════════════════════════
   ⚠️ theme.css 自己只有一条 @media（5733 行附近），**只关掉 em 的动画** ✗，
      其余十几个悬停动效照跑 ✓ —— 这里按「只保留颜色」补齐：
        · 全部 transition 只留颜色类属性（color / background / border-color /
          text-decoration-color / opacity / filter）✓
        · 全部 animation 关掉 ✓
        · 位移与缩放类的悬停**整个不发生**（不是变快，是不动 ✗）——
          否则 80px 的水印一瞬飞到角落、标题一瞬右移 6px，对前庭敏感用户
          依然是一次「跳」 ✓。颜色反馈一个不少 ✓（这才是要保留的那部分 ✓）。
   ═══════════════════════════════════════════════════════════════════════ */
@media (prefers-reduced-motion: reduce) {
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h1,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h3,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h1::after,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2::before,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2::after,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h3::before,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4::before,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5::before,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6::before,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view strong,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view em,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view del,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view s,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a::before,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view a::after,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view :not(pre) > code,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view pre,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view pre::before,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote::before,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout::after {
    animation: none !important;
    transition-property: color, background-color, border-color, text-decoration-color, opacity, filter, text-shadow, box-shadow !important;
    transition-duration: .2s !important;
    transition-delay: 0s !important;
  }
  /* 位移/缩放类悬停：reduced-motion 下原地不动，只变色 ✓ */
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h1:hover,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h3:hover,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4:hover,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5:hover,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6:hover,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view :not(pre) > code:hover,
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout):hover {
    transform: none !important;
  }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h1:hover::after { width: 40px; }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2:hover::before { height: 1em; margin-top: .2em; opacity: .85; }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h2:hover::after { width: 2px; height: .6em; margin-top: .3em; opacity: .6; background: var(--doc-secondary); }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h3:hover::before { transform: translateY(-50%); height: 1.3rem; width: 5px; }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h4:hover::before { transform: translateY(-50%); }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h5:hover::before { transform: translateY(-50%); }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view h6:hover::before { transform: translateY(-50%); }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote:not(.md-callout):hover::before { transform: rotate(30deg); }
  /* 波浪线保留（它本来就是静态装饰 ✓），只关掉「流动」与描边增粗 ✓ */
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view em:hover { -webkit-text-stroke: 0; }
  :is(.lw-memo-ce,.lw-j-ce).markdown-preview-view blockquote.md-callout:hover::after {
    transform: rotate(-15deg) !important;
    right: -10px !important; bottom: -15px !important;
    opacity: .18 !important;
  }
}
`;

  /* ★ 唯一出口：样式数据 + 令牌表（面板侧不再各存一份 ✓）*/
  window.CodeScopeLifeStyles = {
    css: CSS,
    memoDocCss: MEMO_DOC_CSS,
    tokens: T,
    ui: UI,
    mono: MONO,
  };
})();
