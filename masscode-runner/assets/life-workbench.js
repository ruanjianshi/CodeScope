/*!
 * life-workbench.js —— 「我的工作台」个人管理面板（v3）
 * ---------------------------------------------------------------------------
 * 挂在「本机管家」里的一个栏目（DOM 注入，不改那个 302KB 压缩文件）。
 * 数据：/api/life/index（本机文件归类）+ /api/life/weather（天气）+ /api/life/store（待办/笔记）
 *
 * 模块：今日 · 待办 · 笔记 · 研究方向 · 论文 · 文件 · 时间 · 邮箱
 *
 * 风格：**深色玻璃卡**（Linear / Vercel 风）——
 *   圆角 14px · 1px 半透明描边 · 极轻阴影 · 青蓝强调 · 数字等宽对齐 ·
 *   16px 网格间距（比上一版更密，避免大片留白）。
 */
(() => {
  'use strict';

  /* ── 面板资源自身的构建时间（显示在页脚）────────────────────────────────
     目的很实际：前端资源是 no-cache，但**页面不重新加载就拿不到新代码** ——
     改完看不到效果时，第一步要能判断「我这份页面到底是新的还是旧的」。
     页脚挂上这行，一眼就能对 ✓（省掉「改了没生效」的来回排查）。
     ⚠️ document.currentScript 只在脚本**执行期间**有效，必须在顶层立刻存下来 ✓。 */
  const SELF_SRC = (() => { try { return (document.currentScript && document.currentScript.src) || ''; } catch (_) { return ''; } })();
  let BUILD_STAMP = '';
  function buildStampText() { return BUILD_STAMP || '读取中…'; }
  async function ensureBuildStamp() {
    if (BUILD_STAMP || !SELF_SRC) return BUILD_STAMP;
    try {
      const res = await fetch(SELF_SRC, { method: 'HEAD', cache: 'no-store' });
      /* 服务端只发 ETag（形如 W/"206373-1791290559011"，后半段就是文件 mtime）——
         没有 Last-Modified，所以优先解析 ETag，再退回 Last-Modified ✓ */
      let ms = 0;
      const etag = res.headers.get('ETag') || '';
      const hit = /-(\d{10,})\D*$/.exec(etag);
      if (hit) ms = Number(hit[1]);
      if (!ms) { const lm = res.headers.get('Last-Modified'); if (lm) ms = new Date(lm).getTime(); }
      if (ms && !Number.isNaN(ms)) {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, '0');
        BUILD_STAMP = p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      }
    } catch (_) {}
    return BUILD_STAMP;
  }

  /* ── 设计令牌：终端 HUD / 粗野主义（用户最终选定的风格）──
     纯黑底 + 硬米白边框 + 零圆角 + 淡黄强调 + 等宽字体 + 全大写标签 + 前缀编码。
     （中途试过玻璃卡、苹果马卡龙，用户最后说「改回终端 HUD」——
       所以这里保留 HUD 主题，但**功能全部保留**：待办 / 笔记 / 天气 / 邮箱。） */
  const T = {
    bg: '#0b0b0b', bg2: '#0f0f0f', card: '#0f0f0f', card2: '#141414',
    line: '#e8e4d8', lineDim: '#3a382f', line2: '#3a382f',
    text: '#f2efe6', dim: '#8a8778', faint: '#5c5a50',
    accent: '#f2e39b', accentInk: '#111008', ok: '#9bd67a', warn: '#f0a35e', red: '#e2725b',
    grad: 'linear-gradient(160deg,#f2e39b,#e0cd7a)',
  };
  const KIND_COLOR = { code: '#f2e39b', doc: '#f0a35e', media: '#9bd67a', model: '#7ec8e3', other: '#5c5a50' };
  const KIND_NAME = { code: '代码', doc: '文档', media: '媒体/图', model: '三维模型', other: '其他' };
  const UI = '"SF Mono",SFMono-Regular,Menlo,Consolas,"JetBrains Mono",monospace';
  const MONO = UI;

  const CSS = `
  /* 独立面板：铺满顶栏以下的整个主区域 */
  .lw-inpanel { position:fixed; left:0; right:0; bottom:0; top:44px; z-index:8800; display:flex; flex-direction:column; background:${T.bg}; overflow:hidden;
    font-family:${UI}; color:${T.text}; font-size:12.5px; letter-spacing:.2px; }
  /* 顶栏 */
  /* ⚠️ 加了时钟 / 问候 / 心情三个胶囊之后，窄一点的窗口会挤 ✗ ——
     给 row-gap 并允许换行 ✓（换行也比挤成一坨好 ✓）。 */
  .lw-head { display:flex; align-items:center; gap:12px; row-gap:9px; padding:11px 18px; flex:none;
    border-bottom:2px solid ${T.line}; background:${T.bg}; flex-wrap:wrap; }
  .lw-logo { width:32px; height:32px; flex:none; border:2px solid ${T.line}; display:flex; align-items:center;
    justify-content:center; font-size:16px; }
  .lw-h1 { font-size:13px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; line-height:1.15; }
  .lw-h1 small { display:block; font-size:9px; letter-spacing:2.4px; color:${T.dim}; font-weight:400; margin-top:2px; }
  .lw-sub2 { font-size:10.5px; color:${T.dim}; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    letter-spacing:.4px; text-transform:uppercase; }
  .lw-btn { height:30px; padding:0 13px; border-radius:0; border:2px solid ${T.line}; background:transparent;
    color:${T.text}; font:600 10.5px ${UI}; letter-spacing:1.2px; text-transform:uppercase; cursor:pointer; flex:none;
    transition:background .12s,color .12s; }
  .lw-btn:hover { background:${T.accent}; color:${T.accentInk}; }
  /* 天气胶囊 */
  /* ★ 天气和邮箱两个胶囊**必须一样高** ✗ ——
     天气那边是两行（地区 + 体感/湿度），邮箱那边原来只有一行，
     并排时一个 38.6px、一个 28px，看着就是「没对齐」✗（用户截图报的）。
     统一给固定高度 + 垂直居中 ✓；高度取 40（天气的内容实高约 27 + 内边距 8 + 边框 4）✓。 */
  .lw-wx, .lw-mb { height:40px; box-sizing:border-box; align-items:center; }
  .lw-wx { display:flex; gap:11px; padding:0 13px 0 10px; border:2px solid ${T.line}; flex:none; }
  .lw-wx .wi { font-size:19px; line-height:1; }
  .lw-wx .wt { font-size:16px; font-weight:700; color:${T.accent}; }
  .lw-wx .wc { font-size:9.5px; color:${T.dim}; line-height:1.4; letter-spacing:.4px; }
  /* ── 顶栏：状态胶囊（时钟 / 心情）✓ ──────────────────────────────────────
     ⚠️ 必须和天气 / 邮箱胶囊**统一 40px 等高** ✗（不然并排高低不齐 ✗，之前踩过一次 ✓）。
     ⚠️ 注释里不能出现反引号 ✗ —— 这段 CSS 整个在 JS 模板字符串里 ✗。 */
  .lw-stat { display:flex; align-items:center; gap:9px; height:40px; box-sizing:border-box;
    padding:0 12px; border:2px solid ${T.line}; flex:none; position:relative; }
  .lw-stat .ic { flex:none; color:${T.accent}; display:flex; }
  .lw-stat .big { font-size:15px; font-weight:700; color:${T.accent}; font-family:${MONO};
    line-height:1; letter-spacing:.6px; font-variant-numeric:tabular-nums; }
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
  .lw-moodpick { position:absolute; top:46px; left:0; z-index:60; background:${T.card};
    border:2px solid ${T.line}; padding:8px; display:grid; grid-template-columns:repeat(4,1fr); gap:4px;
    box-shadow:0 10px 30px rgba(0,0,0,.55); }
  .lw-moodpick div { display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 9px;
    cursor:pointer; font-size:9px; color:${T.dim}; white-space:nowrap; }
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
  .lw-strip { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; column-gap:12px;
    padding:7px 18px; flex:none;
    border-bottom:2px solid ${T.line}; background:${T.card}; font-size:10.5px; color:${T.dim}; }
  /* ★ 格言**居中** ✓（用户要求：往中间放，中间还有位置 ✓）。
     .q 占满剩余空间 ✓，内容用 justify-content:center 居中 ✓。 */
  .lw-strip .q { grid-column:2; min-width:0; max-width:100%; display:flex; align-items:center;
    justify-content:center; gap:8px; }
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
  .lw-nav { width:196px; flex:none; padding:14px 12px; border-right:2px solid ${T.line}; background:${T.bg};
    display:flex; flex-direction:column; overflow:auto; }
  .lw-nav .grp { margin:6px 2px 8px; font-size:9px; letter-spacing:2.4px; color:${T.faint}; text-transform:uppercase; }
  .lw-nav button { width:100%; height:38px; display:flex; align-items:center; gap:9px; padding:0 9px; margin-bottom:5px;
    border:2px solid ${T.lineDim}; border-radius:0; background:transparent; color:${T.text};
    font:500 11.5px ${UI}; letter-spacing:.6px; cursor:pointer; text-align:left; transition:all .12s; }
  .lw-nav button:hover { border-color:${T.line}; }
  .lw-nav button.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; font-weight:700; }
  .lw-nav .ic { width:18px; text-align:center; font-size:13px; }
  .lw-nav .badge { margin-left:auto; font-size:9.5px; letter-spacing:1.2px; color:${T.dim}; }
  .lw-nav button.on .badge { color:${T.accentInk}; opacity:.65; }
  .lw-nav .foot { margin-top:auto; padding-top:14px; border-top:1px solid ${T.lineDim};
    font-size:9.5px; letter-spacing:1.4px; color:${T.faint}; text-transform:uppercase; line-height:1.9; }
  .lw-nav .foot b { color:${T.ok}; font-weight:600; }
  .lw-main { flex:1; min-width:0; overflow:auto; padding:16px 18px 28px; }
  .lw-main::-webkit-scrollbar { width:10px; } .lw-main::-webkit-scrollbar-thumb { background:#2a2a26; }
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
     ⚠️ 只给这三个页签加 fill ✗ —— 今日 / 书签 / 研究方向 / 文件是**长列表** ✓，
        它们本来就该撑高页面让 .lw-main 自己滚 ✓，加了 flex:1 反而会把内容裁掉 ✗。 */
  .lw-main.fill { display:flex; flex-direction:column; }
  /* 邮箱 / 日记：面板就是 .lw-main 的直接子元素 ✓ */
  .lw-main.fill > .lw-ml,
  .lw-main.fill > .lw-rd,
  .lw-main.fill > .lw-fl,
  .lw-main.fill > .lw-tr,
  .lw-main.fill > .lw-jr { flex:1; min-height:0; }
  /* ★ 阅读模块外面套了一层 .lw-rd-wrap ✗（顶上多了「书架 / 外刊精读 / 生词本」那条 ✓）——
     所以**撑满那一条要挂到 wrap 上** ✗，不然 wrap 不撑高、里面三栏就塌了 ✗
     （实测踩过：底部留一大片空白 ✗）。 */
  .lw-main.fill > .lw-rd-wrap { flex:1; min-height:0; }
  /* 备忘录：面板在 .lw-g12 > .lw-c 里面 ✗（grid 单元格默认 align-items:start 不撑高 ✗）
     —— 得把这条链也一起撑开 ✓ */
  .lw-main.fill > .lw-g12 { flex:1; min-height:0; align-items:stretch; }
  .lw-main.fill > .lw-g12 > .lw-c { display:flex; flex-direction:column; min-height:0; }
  .lw-main.fill > .lw-g12 > .lw-c > .lw-nt { flex:1; min-height:0; height:auto; }
  .lw-g12 { display:grid; grid-template-columns:repeat(12,1fr); gap:16px; align-items:start; }
  /* ★ 卡片：**拖「边」改大小** ✓（右边改宽 ✓ / 下边改高 ✓ / 右下角一起改 ✓）
     原生 resize 只能拖右下角 ✗ —— 所以改成手写三条热区 ✓。
     热区用绝对定位的细条 ✓，**不占布局** ✓，平时看不见 ✓，hover 时亮起来 ✓。
     （提醒：CSS 是模板字符串，注释里不要写反引号 ✗ —— 踩过四次 ✗。）*/
  .lw-c { background:${T.card}; border:2px solid ${T.lineDim}; overflow:auto;
    min-width:240px; min-height:120px; position:relative; }
  .lw-c:hover { border-color:${T.line}; }
  /* 三条热区 */
  .lw-rs { position:absolute; z-index:3; }
  .lw-rs-e  { top:0; bottom:0; right:-3px; width:8px; cursor:ew-resize; }      /* 右边 → 改宽 */
  .lw-rs-s  { left:0; right:0; bottom:-3px; height:8px; cursor:ns-resize; }    /* 下边 → 改高 */
  .lw-rs-se { right:-3px; bottom:-3px; width:14px; height:14px; cursor:nwse-resize; }  /* 右下角 */
  /* hover 时把对应的边点亮 ✓（一眼知道能拖哪里 ✓）*/
  .lw-c:hover > .lw-rs-e  { box-shadow:inset -3px 0 0 ${T.accent}; }
  .lw-c:hover > .lw-rs-s  { box-shadow:inset 0 -3px 0 ${T.accent}; }
  .lw-c:hover > .lw-rs-se { background:linear-gradient(135deg, transparent 40%, ${T.accent} 40%,
      ${T.accent} 62%, transparent 62%, transparent 72%, ${T.accent} 72%, ${T.accent} 92%, transparent 92%); }
  .lw-rs.on { box-shadow:none !important; }
  .lw-rs-e.on  { box-shadow:inset -3px 0 0 ${T.accent} !important; }
  .lw-rs-s.on  { box-shadow:inset 0 -3px 0 ${T.accent} !important; }
  .lw-rs-se.on { background:${T.accent} !important; }
  /* 卡片：硬边框 + 标题栏带前缀编码 */
  .lw-c { background:${T.card}; border:2px solid ${T.line}; border-radius:0; }
  .lw-c > h3 { position:sticky; top:0; z-index:2; background:${T.card}; margin:0; padding:8px 11px; font-size:9.5px; font-weight:600; letter-spacing:2px; text-transform:uppercase;
    color:${T.dim}; border-bottom:1px solid ${T.lineDim}; display:flex; align-items:center; gap:9px; }
  .lw-c > h3 .code { color:${T.accent}; letter-spacing:1.6px; }
  .lw-c > h3 .sp { flex:1; }
  .lw-c > h3 em { font-style:normal; letter-spacing:.6px; color:${T.faint}; font-weight:400; font-size:9.5px; }
  .lw-c > h3 .act { font-size:9.5px; letter-spacing:1.2px; color:${T.accent}; cursor:pointer; font-weight:600; }
  .lw-pad { padding:13px 14px; }
  /* KPI：方框图标 + 大数字 */
  .lw-kpi { padding:14px 15px; }
  .lw-kpi .row { display:flex; align-items:center; gap:12px; }
  .lw-kpi .ic { width:40px; height:40px; flex:none; border:2px solid ${T.line}; display:flex; align-items:center;
    justify-content:center; font-size:18px; background:transparent; color:${T.accent}; }
  .lw-kpi .num { font-size:31px; font-weight:700; line-height:1; letter-spacing:-1px; font-variant-numeric:tabular-nums; }
  .lw-kpi .num small { font-size:10.5px; font-weight:500; color:${T.dim}; margin-left:5px; letter-spacing:.6px; }
  .lw-kpi .lbl { font-size:9.5px; letter-spacing:1.6px; color:${T.faint}; text-transform:uppercase; margin-top:10px; }
  .lw-kpi .cmp { font-size:10.5px; color:${T.dim}; letter-spacing:.4px; margin-top:4px; }
  .lw-kpi .cmp b { color:${T.ok}; font-weight:700; }
  /* 列表 */
  .lw-tbl { display:flex; flex-direction:column; }
  .lw-tr { display:flex; align-items:center; gap:11px; min-height:42px; padding:0 11px; cursor:pointer;
    border-bottom:1px solid ${T.lineDim}; transition:background .12s; }
  .lw-tr:last-child { border-bottom:0; }
  .lw-tr:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-tr:hover .nm i, .lw-tr:hover .sz, .lw-tr:hover .tm, .lw-tr:hover .bd { color:${T.accentInk} !important; opacity:.72; }
  .lw-tr .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
  .lw-tr .nm i { font-style:normal; color:${T.faint}; font-size:10.5px; }
  .lw-tr .sz { flex:none; font-size:10.5px; color:${T.dim}; text-align:right; width:62px; font-variant-numeric:tabular-nums; }
  .lw-tr .tm { flex:none; font-size:10.5px; color:${T.faint}; width:70px; text-align:right; }
  .lw-tr .bd { flex:none; font-size:9.5px; padding:2px 7px; border:1px solid ${T.lineDim}; color:${T.dim};
    letter-spacing:.8px; text-transform:uppercase; }
  /* 待办 */
  .lw-todo { display:flex; align-items:flex-start; gap:11px; padding:10px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-todo:last-child { border-bottom:0; }
  .lw-todo:hover { background:#141412; }
  .lw-todo .ck { width:17px; height:17px; flex:none; margin-top:1px; border:2px solid ${T.lineDim};
    cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:11px; color:transparent; transition:all .12s; }
  .lw-todo .ck:hover { border-color:${T.accent}; }
  .lw-todo.done .ck { background:${T.ok}; border-color:${T.ok}; color:${T.bg}; }
  .lw-todo .tx { flex:1; min-width:0; font-size:12px; line-height:1.5; word-break:break-word; }
  .lw-todo.done .tx { color:${T.faint}; text-decoration:line-through; }
  .lw-todo .due { font-size:9.5px; color:${T.faint}; margin-top:3px; letter-spacing:.6px; }
  .lw-todo .del { flex:none; font-size:14px; color:${T.faint}; cursor:pointer; opacity:0; padding:0 4px; }
  .lw-todo:hover .del { opacity:1; }
  .lw-todo .del:hover { color:${T.red}; }
  .lw-add { display:flex; gap:8px; padding:11px 12px; border-top:1px solid ${T.lineDim}; }
  .lw-add input { flex:1; min-width:0; height:32px; padding:0 10px; border:2px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:11.5px ${UI}; outline:none; }
  .lw-add input:focus { border-color:${T.accent}; }
  .lw-add button { height:32px; padding:0 14px; border:2px solid ${T.accent}; background:${T.accent};
    color:${T.accentInk}; font:700 10.5px ${UI}; letter-spacing:1.2px; text-transform:uppercase; cursor:pointer; }
  /* 笔记 */
  .lw-note { padding:11px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-note:last-child { border-bottom:0; }
  .lw-note:hover { background:#141412; }
  .lw-note .h { display:flex; align-items:center; gap:8px; font-size:9.5px; color:${T.faint}; margin-bottom:5px; letter-spacing:.8px; }
  .lw-note .h .del { margin-left:auto; cursor:pointer; opacity:0; }
  .lw-note:hover .h .del { opacity:1; }
  .lw-note .h .del:hover { color:${T.red}; }
  .lw-note .b { font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }
  .lw-note textarea { width:100%; min-height:72px; resize:vertical; padding:10px 11px; border:2px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:12px/1.6 ${UI}; outline:none; }
  .lw-note textarea:focus { border-color:${T.accent}; }
  /* 快捷入口 */
  .lw-links { display:grid; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); gap:8px; }
  .lw-link { display:flex; align-items:center; gap:9px; padding:10px 11px; border:2px solid ${T.lineDim};
    background:transparent; color:${T.text}; text-decoration:none; font-size:11.5px; letter-spacing:.4px;
    cursor:pointer; transition:all .12s; }
  .lw-link:hover { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-link .ic { font-size:15px; }
  /* 柱状 */
  .lw-bars { display:flex; align-items:flex-end; gap:5px; height:126px; }
  .lw-bars > div { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:5px; height:100%; }
  .lw-bars .v { font-size:9.5px; color:${T.dim}; }
  .lw-bars .b { width:100%; background:${T.accent}; }
  .lw-bars > div:hover .b { background:#fff; }
  .lw-bars .k { font-size:9px; color:${T.faint}; letter-spacing:.2px; }
  .lw-empty { padding:28px 12px; text-align:center; color:${T.faint}; font-size:11px; letter-spacing:1px; text-transform:uppercase; }
  .lw-empty .big { font-size:22px; display:block; margin-bottom:8px; opacity:.55; }
  .lw-sk { background:linear-gradient(90deg,#141414 25%,#1e1e1c 37%,#141414 63%);
    background-size:400% 100%; animation:lw-sk 1.3s ease infinite; }
  @keyframes lw-sk { 0%{background-position:100% 50%} 100%{background-position:0 50%} }
  .lw-chips { display:flex; flex-wrap:wrap; gap:7px; }
  .lw-chip { font-size:10.5px; padding:3px 9px; border:1px solid ${T.lineDim}; color:${T.dim}; letter-spacing:.6px; }
  .lw-chip b { color:${T.accent}; font-weight:700; margin-left:5px; }
  /* 网上热点 / AI 输出 */
  .lw-hotlist { display:flex; flex-direction:column; max-height:340px; overflow:auto; }
  .lw-hotrow { padding:9px 14px; border-top:1px solid ${T.lineDim}; }
  .lw-hotrow:hover { background:#141412; }
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
  .lw-memo-list { width:272px; flex:none; background:#0d0d0c; border-right:2px solid ${T.lineDim};
    display:flex; flex-direction:column; }
  .lw-memo-search { padding:10px 11px 8px; border-bottom:1px solid ${T.lineDim}; }
  .lw-memo-search input { width:100%; height:28px; padding:0 10px; border:2px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:11.5px ${UI}; outline:none; }
  .lw-memo-search input:focus { border-color:${T.accent}; }
  .lw-memo-search input::placeholder { color:${T.faint}; }
  .lw-memo-bar { display:flex; align-items:center; gap:8px; padding:7px 11px; border-bottom:1px solid ${T.lineDim}; }
  .lw-memo-bar .n { font-size:10px; color:${T.faint}; letter-spacing:1px; text-transform:uppercase; }
  .lw-memo-bar .sp { flex:1; }
  .lw-memo-bar button, .lw-memo-bar select { height:24px; padding:0 9px; border:2px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:600 10px ${UI}; letter-spacing:.8px; cursor:pointer; }
  .lw-memo-bar button.pri { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-memo-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-memo-bar button.pri:hover { color:${T.accentInk}; }
  .lw-memo-bar select option { background:#111; color:${T.text}; }
  .lw-mlist { flex:1; overflow:auto; }
  .lw-mrow { padding:9px 12px; border-bottom:1px solid ${T.lineDim}; cursor:pointer; position:relative; }
  .lw-mrow:hover { background:#141412; }
  .lw-mrow.on { background:${T.accent}; }
  .lw-mrow.on .t, .lw-mrow.on .d { color:${T.accentInk}; }
  .lw-mrow.on .s { color:rgba(17,16,8,.6); }
  .lw-mrow .t { font-size:12px; font-weight:600; color:${T.text}; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; padding-right:62px; }
  .lw-mrow .d { position:absolute; right:12px; top:9px; font-size:10px; color:${T.faint}; }
  .lw-mrow .s { font-size:10.5px; color:${T.faint}; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-mrow .pin { color:${T.accent}; font-size:10px; margin-right:4px; }
  .lw-memo-editor { flex:1; min-width:0; display:flex; flex-direction:column; }
  .lw-memo-tools { display:flex; align-items:center; gap:10px; padding:8px 14px; border-bottom:1px solid ${T.lineDim}; }
  .lw-memo-tools .sp { flex:1; }
  .lw-memo-tools button { height:25px; padding:0 10px; border:2px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:600 10px ${UI}; letter-spacing:.8px; cursor:pointer; }
  .lw-memo-tools button.pri { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-memo-tools button.del { color:${T.red}; border-color:rgba(226,114,91,.5); }
  .lw-memo-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-memo-tools button.pri:hover { color:${T.accentInk}; }
  .lw-memo-tools button.del:hover { background:${T.red}; color:#111; border-color:${T.red}; }
  .lw-mtitle { border:0; background:transparent; color:${T.text}; font:700 17px ${UI};
    padding:15px 18px 6px; outline:none; }
  .lw-mtitle::placeholder { color:${T.faint}; }
  .lw-mbody { flex:1; border:0; background:transparent; color:${T.text}; font:12.5px/1.8 ${UI};
    padding:4px 18px 14px; resize:none; outline:none; min-height:200px; }
  .lw-mbody::placeholder { color:${T.faint}; }
  .lw-mfoot { padding:7px 18px; border-top:1px solid ${T.lineDim}; font-size:10px; color:${T.faint}; letter-spacing:.6px; }
  /* 清单模式：每行一个可勾选项 */
  .lw-mcheck { flex:1; overflow:auto; padding:4px 18px 14px; }
  .lw-mcitem { display:flex; align-items:flex-start; gap:9px; padding:5px 0; }
  .lw-mcitem .ck { width:16px; height:16px; flex:none; margin-top:2px; border:2px solid ${T.lineDim};
    cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:10px; color:transparent; }
  .lw-mcitem .ck:hover { border-color:${T.accent}; }
  .lw-mcitem.done .ck { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-mcitem .tx { flex:1; min-width:0; font-size:12.5px; line-height:1.65; word-break:break-word; }
  .lw-mcitem.done .tx { color:${T.faint}; text-decoration:line-through; }
  .lw-mcitem .del { flex:none; opacity:0; cursor:pointer; color:${T.faint}; font-size:12px; }
  .lw-mcitem:hover .del { opacity:1; }
  .lw-mcitem .del:hover { color:${T.red}; }
  .lw-mcadd { display:flex; gap:8px; padding:8px 18px 14px; }
  .lw-mcadd input { flex:1; min-width:0; height:30px; padding:0 10px; border:2px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:12px ${UI}; outline:none; }
  .lw-mcadd input:focus { border-color:${T.accent}; }
  .lw-mcadd button { height:30px; padding:0 12px; border:2px solid ${T.accent}; background:${T.accent};
    color:${T.accentInk}; font:700 10px ${UI}; letter-spacing:1px; cursor:pointer; }
  /* Markdown 预览 */
  .lw-md { flex:1; overflow:auto; padding:4px 18px 16px; font-size:13px; line-height:1.8; color:${T.text}; }
  .lw-md h1, .lw-md h2, .lw-md h3 { margin:14px 0 8px; font-weight:700; color:#fff; }
  .lw-md h1 { font-size:19px; } .lw-md h2 { font-size:16px; } .lw-md h3 { font-size:14px; }
  .lw-md p { margin:8px 0; }
  .lw-md code { background:#1b1b19; padding:1px 5px; font-family:${MONO}; font-size:11.5px; color:${T.accent}; }
  .lw-md pre { background:#141412; border-left:3px solid ${T.accent}; padding:10px 12px; overflow:auto; margin:10px 0; }
  .lw-md pre code { background:transparent; padding:0; }
  .lw-md blockquote { margin:8px 0; padding:4px 12px; border-left:3px solid ${T.lineDim}; color:${T.dim}; }
  .lw-md ul, .lw-md ol { margin:8px 0; padding-left:22px; }
  .lw-md li { margin:3px 0; }
  .lw-md a { color:${T.accent}; }
  .lw-md hr { border:0; border-top:1px solid ${T.lineDim}; margin:14px 0; }
  .lw-md strong { color:#fff; }
  .lw-md .tag { color:${T.accent}; background:rgba(242,227,155,.12); padding:1px 6px; font-size:11.5px; }
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
  .lw-trash button { height:22px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:600 10px ${UI}; cursor:pointer; }
  .lw-trash button:hover { border-color:${T.accent}; color:${T.accent}; }
  /* ── Memos 风格：单列时间线 ── */
  .lw-mo { display:flex; flex-direction:column; gap:0; }
  .lw-mo-write { display:flex; gap:10px; padding:12px 14px; border:2px solid ${T.lineDim}; background:#0d0d0c; }
  .lw-mo-write textarea { flex:1; min-height:52px; border:0; background:transparent; color:${T.text};
    font:12.5px/1.7 ${UI}; resize:vertical; outline:none; }
  .lw-mo-write textarea::placeholder { color:${T.faint}; }
  .lw-mo-write .side { display:flex; flex-direction:column; justify-content:flex-end; gap:6px; flex:none; }
  .lw-mo-write button { height:28px; padding:0 13px; border:2px solid ${T.accent}; background:${T.accent};
    color:${T.accentInk}; font:700 10px ${UI}; letter-spacing:1px; cursor:pointer; }
  .lw-mo-write button:disabled { opacity:.35; cursor:default; }
  .lw-mo-day { margin:16px 0 8px; font-size:10.5px; letter-spacing:1.6px; text-transform:uppercase;
    color:${T.faint}; display:flex; align-items:center; gap:10px; }
  .lw-mo-day::after { content:""; flex:1; height:1px; background:${T.lineDim}; }
  .lw-mo-card { border:2px solid ${T.lineDim}; background:#0f0f0e; padding:11px 13px; margin-bottom:9px; }
  .lw-mo-card:hover { border-color:${T.line}; }
  .lw-mo-card.pin { border-left:3px solid ${T.accent}; }
  .lw-mo-head { display:flex; align-items:center; gap:9px; margin-bottom:7px; }
  .lw-mo-head .tm { font-size:10px; color:${T.faint}; letter-spacing:.6px; }
  .lw-mo-head .pin { color:${T.accent}; font-size:11px; }
  .lw-mo-head .sp { flex:1; }
  .lw-mo-head button { height:20px; padding:0 8px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.faint}; font:600 9.5px ${UI}; letter-spacing:.6px; cursor:pointer; opacity:0; }
  .lw-mo-card:hover .lw-mo-head button { opacity:1; }
  .lw-mo-head button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-mo-head button.del:hover { border-color:${T.red}; color:${T.red}; }
  .lw-mo-body { font-size:12.5px; line-height:1.8; color:${T.text}; }
  .lw-mo-body p { margin:6px 0; }
  .lw-mo-body p:first-child { margin-top:0; }
  .lw-mo-body ul { margin:6px 0; padding-left:20px; }
  .lw-mo-body code { background:#1b1b19; padding:1px 5px; font-family:${MONO}; font-size:11px; color:${T.accent}; }
  .lw-mo-body pre { background:#141412; border-left:3px solid ${T.accent}; padding:9px 11px; overflow:auto; margin:8px 0; }
  .lw-mo-body pre code { background:transparent; padding:0; }
  .lw-mo-body blockquote { margin:6px 0; padding:3px 11px; border-left:3px solid ${T.lineDim}; color:${T.dim}; }
  .lw-mo-body h1, .lw-mo-body h2, .lw-mo-body h3 { margin:9px 0 5px; color:#fff; font-size:13.5px; }
  .lw-mo-body a { color:${T.accent}; }
  .lw-mo-body strong { color:#fff; }
  .lw-mo-body .tag { color:${T.accent}; background:rgba(242,227,155,.12); padding:1px 6px; font-size:11px; cursor:pointer; }
  .lw-mo-edit textarea { width:100%; min-height:110px; border:2px solid ${T.accent}; background:#0d0d0c;
    color:${T.text}; font:12.5px/1.7 ${UI}; padding:10px 11px; resize:vertical; outline:none; }
  .lw-mo-edit .row { display:flex; gap:8px; margin-top:9px; }
  .lw-mo-edit button { height:26px; padding:0 12px; border:2px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:600 10px ${UI}; letter-spacing:1px; cursor:pointer; }
  .lw-mo-edit button.pri { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-mo-empty { padding:40px 12px; text-align:center; color:${T.faint}; font-size:12px; }
  .lw-mo-empty .big { font-size:26px; display:block; margin-bottom:9px; opacity:.5; }
  /* ── macOS 备忘录三栏 ── */
  /* ⚠️ 高度**故意不写** ✗ —— 以前是 calc(100vh - 250px) 这种**魔数** ✗，
     对不齐内容区（实测差 61px ✗），而且窗口一变就更歪 ✗。
     现在由 .lw-main.fill > .lw-g12 > .lw-c > .lw-nt { flex:1 } 撑满 ✓
     （见 .lw-main 那一段的注释 ✓）。min-height 只作**矮窗口时的下限** ✓。 */
  .lw-nt { display:flex; min-height:320px; border:2px solid ${T.lineDim}; }
  /* 左：文件夹 + 标签 */
  .lw-nt-side { width:172px; flex:none; background:#0c0c0b; border-right:1px solid ${T.lineDim};
    padding:10px 8px; overflow:auto; }
  /* 三栏之间可拖拽的竖条（左右自由调宽 ✓，双击恢复默认 ✓） */
  /* ★ 拖拽调宽的竖条 —— 备忘录和邮箱共用同一套样式 ✓
     （用户报「邮箱怎么没有左右自由拖动功能」✗，现在两个模块一致 ✓）*/
  /* ★ 通用三栏拖拽条 .lw-pgrip ✓ —— 阅读 / 工作流 / 热榜 共用 ✓。
     （用户先在邮箱那儿要过一次拖拽 ✗，又在热榜这儿要了一次 ✗ ——
       说明「三栏可拖」是**每个模块的默认预期** ✓ → 做成通用的 ✓，以后加模块直接复用 ✓。） */
  .lw-nt-grip, .lw-ml-grip, .lw-pgrip { flex:none; width:7px; cursor:col-resize; position:relative; background:#131312; }
  .lw-nt-grip::after, .lw-ml-grip::after, .lw-pgrip::after { content:''; position:absolute; left:3px; top:0; bottom:0; width:1px; background:${T.lineDim}; }
  .lw-nt-grip:hover::after, .lw-nt-grip.on::after,
  .lw-nt-grip:hover::after, .lw-ml-grip:hover::after, .lw-nt-grip.on::after, .lw-ml-grip.on::after,
  .lw-pgrip:hover::after, .lw-pgrip.on::after, .lw-pgrip.dragging::after { background:${T.accent}; width:2px; left:2px; }
  /* 拖拽把备忘录移到文件夹时的落点高亮 */
  .lw-nt-side .it.drop { background:color-mix(in srgb,${T.ok} 18%,transparent); border-color:${T.ok}; color:${T.text}; }
  .lw-nt-row.dragging { opacity:.45; }
  .lw-nt-side .hd { display:flex; gap:6px; margin-bottom:10px; }
  .lw-nt-side .hd button { flex:1; height:26px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font-size:12px; cursor:pointer; }
  .lw-nt-side .hd button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-nt-side .grp { margin:12px 6px 6px; font-size:9.5px; letter-spacing:1.4px; color:${T.faint}; text-transform:uppercase; }
  .lw-nt-side .it { display:flex; align-items:center; gap:8px; padding:6px 9px; font-size:11.5px; color:${T.dim};
    cursor:pointer; border:1px solid transparent; }
  .lw-nt-side .it:hover { background:#161614; color:${T.text}; }
  .lw-nt-side .it.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; font-weight:700; }
  .lw-nt-side .it .n { margin-left:auto; font-size:10px; opacity:.7; }
  /* 中：列表 */
  .lw-nt-list { width:288px; flex:none; background:#0d0d0c; border-right:1px solid ${T.lineDim}; display:flex; flex-direction:column; }
  .lw-nt-list .top { padding:9px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-nt-list .top .t1 { font-size:12.5px; font-weight:700; color:${T.text}; }
  .lw-nt-list .top .t2 { font-size:10px; color:${T.faint}; margin-top:2px; }
  .lw-nt-list .top input { width:100%; margin-top:8px; height:28px; padding:0 9px; border:1px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:11.5px ${UI}; outline:none; }
  .lw-nt-list .top input:focus { border-color:${T.accent}; }
  .lw-nt-scroll { flex:1; overflow:auto; }
  .lw-nt-grp { padding:9px 12px 5px; font-size:11px; font-weight:700; color:${T.text}; }
  .lw-nt-row { display:flex; gap:9px; padding:8px 12px; border-bottom:1px solid #1c1c1a; cursor:pointer; }
  .lw-nt-row:hover { background:#161614; }
  .lw-nt-row.on { background:#232320; }
  .lw-nt-row .c { flex:1; min-width:0; }
  .lw-nt-row .tt { font-size:12px; font-weight:600; color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-nt-row .mt { font-size:10px; color:${T.faint}; margin-top:2px; }
  .lw-nt-row .mt b { color:${T.dim}; font-weight:400; }
  .lw-nt-row .sub { font-size:10.5px; color:${T.faint}; margin-top:3px; display:flex; align-items:center; gap:5px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-nt-row .pin { color:${T.accent}; }
  /* 右：编辑区 */
  .lw-nt-edit { flex:1; min-width:0; display:flex; flex-direction:column; background:#0f0f0e; }
  /* ⚠️ 必须允许换行：按钮没有 flex:none 时会被压成 28px 的空壳（文字被裁掉看不清），
     加了「图片」按钮之后窄屏（~1100px）更是直接溢出、最右边的「删除」被裁掉点不到。
     改成「放不下就换到第二行」，任何宽度下每个按钮都完整可点。 */
  .lw-nt-bar { display:flex; align-items:center; gap:6px; row-gap:7px; flex-wrap:wrap; padding:8px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-nt-bar button { height:26px; min-width:28px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent; flex:none;
    color:${T.text}; font:600 10.5px ${UI}; cursor:pointer; }
  .lw-nt-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-nt-bar button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  /* 撤销/重做没有可退的步骤时明确置灰（别让人以为点了没反应） */
  .lw-nt-bar button:disabled { opacity:.35; cursor:default; }
  .lw-nt-bar button:disabled:hover { border-color:${T.lineDim}; color:${T.text}; }
  .lw-nt-bar .sp { flex:1; }
  .lw-nt-bar .st { font-size:10px; color:${T.faint}; }
  .lw-nt-bar .st.ok { color:${T.ok}; }
  /* 格式菜单（浮层） */
  .lw-nt-menu { position:absolute; z-index:20; width:186px; background:#151513; border:2px solid ${T.line};
    box-shadow:0 12px 32px rgba(0,0,0,.6); }
  .lw-nt-menu .r { display:flex; gap:4px; padding:9px 10px; border-bottom:1px solid ${T.lineDim}; }
  .lw-nt-menu .r button { width:28px; height:26px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font-size:12px; cursor:pointer; }
  .lw-nt-menu .r button:hover { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-nt-menu .mi { padding:7px 12px; font-size:12px; color:${T.text}; cursor:pointer; display:flex; align-items:center; gap:8px; }
  .lw-nt-menu .mi:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-nt-menu .mi.on::before { content:"✓"; font-size:11px; }
  .lw-nt-menu .sep { height:1px; background:${T.lineDim}; margin:4px 0; }
  /* 不在这里 overflow:auto —— 正文是 .lw-ce，它自己滚 ✓（两层都滚会互相打架 ✗）*/
  .lw-nt-body { flex:1; display:flex; flex-direction:column; min-height:0; }
  .lw-nt-meta { padding:12px 20px 0; font-size:11px; color:${T.faint}; text-align:center; }
  .lw-nt-title { border:0; background:transparent; color:${T.text}; font:700 18px ${UI};
    padding:6px 20px 4px; outline:none; }
  .lw-nt-title::placeholder { color:${T.faint}; }
  /* 正文默认就是可编辑的（不再需要双击 ✗）；编辑区样式见 .lw-ce / .lw-memo-ce */
  /* 格式条：**横排放在工具栏下面**（不再用浮层 ✗）*/
  .lw-nt-fmt { display:flex; align-items:center; gap:5px; padding:7px 12px; border-bottom:1px solid ${T.lineDim};
    background:#131312; flex-wrap:wrap; }
  .lw-nt-fmt .div { width:1px; height:18px; background:${T.lineDim}; margin:0 4px; }
  .lw-nt-fmt button { height:26px; min-width:28px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:600 10.5px ${UI}; cursor:pointer; white-space:nowrap; }
  .lw-nt-fmt button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-nt-fmt button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  .lw-nt-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
    color:${T.faint}; font-size:12px; gap:8px; }
  .lw-nt-empty .big { font-size:26px; opacity:.5; }
  /* ── Markdown 渲染：提高区分度（标题/引用/代码/列表/表格/标签 各有明显形态）── */
  .lw-md2 { font-size:13px; line-height:1.85; color:#d8d5cb; }
  /* 标题：大 + 左侧黄条 */
  .lw-md2 h1, .lw-md2 h2, .lw-md2 h3 { color:#fff; font-weight:700; margin:16px 0 8px; padding-left:10px;
    border-left:3px solid ${T.accent}; line-height:1.35; }
  .lw-md2 h1 { font-size:21px; letter-spacing:-.3px; }
  .lw-md2 h2 { font-size:17px; }
  .lw-md2 h3 { font-size:14.5px; color:${T.accent}; border-left-color:${T.lineDim}; }
  .lw-md2 > h1:first-child, .lw-md2 > h2:first-child { margin-top:2px; }
  .lw-md2 p { margin:8px 0; }
  /* 引用：整块底色 + 左条 */
  .lw-md2 blockquote { margin:10px 0; padding:8px 13px; background:rgba(242,227,155,.06);
    border-left:3px solid ${T.accent}; color:#b9b5a8; font-style:italic; }
  .lw-md2 blockquote p { margin:3px 0; }
  /* 行内码 / 代码块 */
  .lw-md2 code { background:#20201d; border:1px solid ${T.lineDim}; padding:1px 6px; font-family:${MONO};
    font-size:11.5px; color:${T.accent}; }
  .lw-md2 pre { background:#141412; border:1px solid ${T.lineDim}; border-left:3px solid ${T.accent};
    padding:11px 13px; overflow:auto; margin:10px 0; }
  .lw-md2 pre code { background:transparent; border:0; padding:0; color:#cfd6e2; }
  /* 列表：黄色圆点 + 缩进 */
  .lw-md2 ul, .lw-md2 ol { margin:9px 0; padding-left:8px; list-style:none; }
  .lw-md2 li { margin:5px 0; padding-left:17px; position:relative; }
  .lw-md2 ul > li::before { content:""; position:absolute; left:3px; top:9px; width:5px; height:5px;
    background:${T.accent}; }
  .lw-md2 ol { counter-reset:mdol; }
  .lw-md2 ol > li::before { counter-increment:mdol; content:counter(mdol) "."; position:absolute; left:0; top:0;
    color:${T.accent}; font-size:11.5px; font-weight:700; }
  /* 复选框清单 */
  .lw-md2 li.mdck { list-style:none; }
  .lw-md2 li.mdck::before { content:"☐"; left:1px; top:0; width:auto; height:auto; background:none;
    color:${T.dim}; font-size:12px; }
  .lw-md2 li.mdck.done::before { content:"☑"; color:${T.ok}; }
  .lw-md2 li.mdck.done { color:${T.faint}; text-decoration:line-through; }
  /* 表格 */
  .lw-md2 table { border-collapse:collapse; margin:11px 0; font-size:12px; width:100%; }
  .lw-md2 th, .lw-md2 td { border:1px solid ${T.lineDim}; padding:6px 10px; text-align:left; }
  .lw-md2 th { background:#1a1a17; color:${T.accent}; font-weight:700; }
  .lw-md2 tr:nth-child(even) td { background:rgba(255,255,255,.02); }
  /* 链接 / 标签 / 强调 */
  .lw-md2 a { color:${T.accent}; text-decoration:underline; text-underline-offset:2px; }
  .lw-md2 strong { color:#fff; font-weight:700; background:rgba(242,227,155,.10); padding:0 2px; }
  .lw-md2 em { color:#cfc9b4; }
  .lw-md2 del { color:${T.faint}; }
  .lw-md2 .tag { color:${T.accent}; background:rgba(242,227,155,.14); border:1px solid rgba(242,227,155,.3);
    padding:1px 7px; font-size:11.5px; }
  .lw-md2 hr { border:0; border-top:1px dashed ${T.lineDim}; margin:16px 0; }
  /* 正文：整篇一个 contenteditable，逐行实时渲染（见 .lw-ce）
     —— 原来这里是「左编辑 / 右预览」的可拖分栏，已按需求改成和日记一致 ✓。 */
  /* 右键菜单 */
  .lw-ctx { position:fixed; z-index:9600; min-width:150px; background:#171715; border:2px solid ${T.line};
    box-shadow:0 14px 36px rgba(0,0,0,.7); padding:4px 0; }
  .lw-ctx .mi { padding:8px 14px; font-size:12px; color:${T.text}; cursor:pointer; display:flex; align-items:center; gap:9px; }
  .lw-ctx .mi:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-ctx .mi.danger { color:${T.red}; }
  .lw-ctx .mi.danger:hover { background:${T.red}; color:#111; }
  .lw-ctx .sep { height:1px; background:${T.lineDim}; margin:4px 0; }
  /* ── 书签：好词好句（衬线字体 + 卡片墙 + 引号装饰）── */
  .lw-bk-hero { border:2px solid ${T.line}; background:#12120f; padding:22px 26px; position:relative; margin-bottom:14px; }
  .lw-bk-hero .q { font-family:"Songti SC","STSong",Georgia,"Times New Roman",serif;
    font-size:22px; line-height:1.9; color:#fff; letter-spacing:.5px; }
  .lw-bk-hero .q::before { content:"❝"; position:absolute; left:6px; top:2px; font-size:40px;
    color:${T.accent}; opacity:.28; }
  .lw-bk-hero .from { margin-top:14px; font-size:11.5px; color:${T.dim}; letter-spacing:.6px;
    display:flex; align-items:center; gap:10px; }
  .lw-bk-hero .from .sp { flex:1; }
  .lw-bk-hero .from button { height:26px; padding:0 11px; border:2px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:600 10px ${UI}; letter-spacing:1px; cursor:pointer; }
  .lw-bk-hero .from button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-bk-write { display:flex; gap:10px; border:2px solid ${T.lineDim}; background:#0d0d0c; padding:12px 14px; margin-bottom:14px; }
  .lw-bk-write .col { flex:1; display:flex; flex-direction:column; gap:8px; min-width:0; }
  .lw-bk-write input, .lw-bk-write textarea { width:100%; border:0; border-bottom:1px solid ${T.lineDim};
    background:transparent; color:${T.text}; outline:none; }
  .lw-bk-write textarea { font-family:"Songti SC","STSong",Georgia,serif; font-size:15px; line-height:1.8;
    min-height:56px; resize:vertical; }
  .lw-bk-write input { font:11.5px ${UI}; padding:4px 0; }
  .lw-bk-write input::placeholder, .lw-bk-write textarea::placeholder { color:${T.faint}; }
  .lw-bk-write button { align-self:flex-end; height:30px; padding:0 15px; border:2px solid ${T.accent};
    background:${T.accent}; color:${T.accentInk}; font:700 10.5px ${UI}; letter-spacing:1.2px; cursor:pointer; }
  /* 卡片墙 */
  .lw-bk-wall { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; }
  .lw-bk-card { border:2px solid ${T.lineDim}; background:#101010; padding:15px 16px 12px; position:relative;
    display:flex; flex-direction:column; min-height:132px; }
  .lw-bk-card:hover { border-color:${T.accent}; }
  .lw-bk-card.pin { border-left:4px solid ${T.accent}; }
  .lw-bk-card .txt { font-family:"Songti SC","STSong",Georgia,"Times New Roman",serif;
    font-size:14px; line-height:1.85; color:#e8e5da; flex:1; word-break:break-word; }
  .lw-bk-card .txt::first-letter { }
  .lw-bk-card .src { margin-top:11px; font-size:10.5px; color:${T.faint}; letter-spacing:.4px;
    display:flex; align-items:center; gap:8px; }
  .lw-bk-card .src .sp { flex:1; }
  .lw-bk-card .src .tg { color:${T.accent}; }
  .lw-bk-card .ops { position:absolute; right:8px; top:8px; display:flex; gap:4px; opacity:0; }
  .lw-bk-card:hover .ops { opacity:1; }
  .lw-bk-card .ops button { width:20px; height:20px; border:1px solid ${T.lineDim}; background:#101010;
    color:${T.dim}; font-size:10px; cursor:pointer; line-height:1; }
  .lw-bk-card .ops button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-bk-card .ops button.del:hover { border-color:${T.red}; color:${T.red}; }
  .lw-bk-day { padding:5px 2px 0; font-size:10.5px; color:${T.faint}; letter-spacing:1.2px; }
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
  .lw-vgrip::after { content:""; position:absolute; top:3px; left:12px; right:12px; height:1px;
    background:${T.lineDim}; transition:background .12s; }
  .lw-vgrip:hover::after, .lw-vgrip.on::after { background:${T.accent}; height:2px; top:2px; }
  /* 分类管理 */
  .lw-cats { padding:8px 10px 10px; }
  .lw-cats .row { display:flex; align-items:center; gap:7px; padding:6px 8px; font-size:11.5px; color:${T.text};
    cursor:pointer; border:1px solid transparent; }
  .lw-cats .row:hover { background:#161614; border-color:${T.lineDim}; }
  .lw-cats .row.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; font-weight:700; }
  .lw-cats .row .n { margin-left:auto; font-size:10px; opacity:.7; }
  .lw-cats .row .del { opacity:0; font-size:11px; padding:0 3px; }
  .lw-cats .row:hover .del { opacity:1; }
  .lw-cats .row .del:hover { color:${T.red}; }
  .lw-cats .add { display:flex; gap:6px; margin-top:8px; }
  .lw-cats .add input { flex:1; min-width:0; height:26px; padding:0 8px; border:1px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:11px ${UI}; outline:none; }
  .lw-cats .add input:focus { border-color:${T.accent}; }
  .lw-cats .add button { height:26px; padding:0 10px; border:1px solid ${T.accent}; background:${T.accent};
    color:${T.accentInk}; font:700 10px ${UI}; cursor:pointer; }
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
  .lw-cal-hd button { height:24px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:600 10.5px ${UI}; cursor:pointer; }
  .lw-cal-hd button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-cal { padding:8px 10px 10px; }
  .lw-cal-wk { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:3px; }
  .lw-cal-wk span { text-align:center; font-size:9.5px; color:${T.faint}; letter-spacing:.6px; }
  .lw-cal-g { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
  /* ⚠️ 以前用 aspect-ratio:1 ✗ → 日历特别高、下面大片空白 ✗。改成固定矮高度 ✓ */
  .lw-cal-d { height:26px; display:flex; align-items:center; justify-content:center;
    border:1px solid transparent; font-size:11.5px; color:${T.dim}; cursor:pointer; position:relative; }
  .lw-cal-d:hover { border-color:${T.lineDim}; color:${T.text}; }
  .lw-cal-d.out { color:#3a3a34; cursor:default; }
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
  .lw-ce { flex:1; min-height:0; overflow:auto; padding:10px 14px; outline:none;
    font:12.5px/1.9 ${UI}; color:${T.text}; cursor:text; }
  .lw-ce > .ln { min-height:1.9em; white-space:pre-wrap; word-break:break-word; }
  /* 当前行（源码）：给一点视觉提示 ✓，但不改字号 ✓ */
  .lw-ce > .ln.cur { background:rgba(242,227,155,.05); box-shadow:inset 2px 0 0 rgba(242,227,155,.5); }
  /* 渲染行 */
  .lw-ce > .ln.r-h1 { font-size:18px; font-weight:700; color:#fff; padding-left:10px;
    border-left:3px solid ${T.accent}; line-height:1.5; margin:8px 0 4px; }
  .lw-ce > .ln.r-h2 { font-size:16px; font-weight:700; color:#fff; padding-left:10px;
    border-left:3px solid ${T.accent}; line-height:1.5; margin:7px 0 3px; }
  .lw-ce > .ln.r-h3 { font-size:14px; font-weight:700; color:${T.accent}; padding-left:9px;
    border-left:2px solid rgba(242,227,155,.45); line-height:1.5; margin:6px 0 2px; }
  .lw-ce > .ln.r-quote { padding:6px 12px; background:rgba(242,227,155,.06);
    border-left:3px solid ${T.accent}; color:#c8c4b6; font-style:italic; }
  .lw-ce > .ln.r-li { padding-left:6px; }
  .lw-ce > .ln.r-li .bullet { color:${T.accent}; font-weight:700; margin-right:6px; }
  .lw-ce > .ln.r-li .ckbox { color:${T.dim}; font-weight:700; margin-right:6px; }
  .lw-ce > .ln.r-li.done .ckbox { color:${T.ok}; }
  .lw-ce > .ln.r-li.done { color:${T.faint}; text-decoration:line-through; }
  .lw-ce > .ln.r-code { background:#141412; border-left:3px solid ${T.accent};
    padding:7px 11px; color:#cfd6e2; font-family:${MONO}; font-size:11.5px; }
  .lw-ce > .ln.r-hr { color:${T.lineDim}; }
  .lw-ce b { color:#fff; font-weight:700; }
  .lw-ce i { color:#cfc9b4; font-style:italic; }
  .lw-ce s { color:${T.faint}; }
  .lw-ce code { background:#2a2616; color:#ffe08a; padding:1px 5px; font-family:${MONO}; font-size:11.5px; }
  .lw-ce a { color:${T.accent}; text-decoration:underline; }
  .lw-ce .tag { color:#ffe9a8; background:rgba(242,227,155,.16); padding:1px 5px; }
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
  .lw-ce > .ln,
  .lw-ce > .ln.r-h1, .lw-ce > .ln.r-h2, .lw-ce > .ln.r-h3,
  .lw-ce > .ln.r-li, .lw-ce > .ln.r-quote, .lw-ce > .ln.r-code, .lw-ce > .ln.r-hr {
    position:relative; padding-left:34px;
  }
  .lw-ce > .ln::before {
    counter-increment: ln; content: counter(ln);
    /* ⚠️ left 要**减去该行的左边框宽度**：绝对定位的 left 是相对 padding box 的，
       而 border-left 在 padding box 之外 ✗ → 不补偿的话，标题/引用/代码块（带 3px 左边框）
       的行号会被整体右移 3px，和普通行对不齐（用户反馈的就是这个）。
       --ln-bl 由 ceAlignLineNumbers() 量出来写上去 ✓。 */
    position:absolute; left:calc(-1 * var(--ln-bl, 0px)); top:0; width:24px; height:var(--ln-lh, 23.75px);
    display:flex; align-items:center; justify-content:flex-end;
    color:${T.faint}; font-family:${MONO}; font-size:10px; line-height:1;
    user-select:none; -webkit-user-select:none; pointer-events:none;
  }
  /* 代码块 / 引用自带 padding-top，行号跟着往下挪同样的距离，别贴到框顶
     （7px / 6px 要和上面 .r-code / .r-quote 的 padding-top 一致，否则会差 1px ✗）*/
  .lw-ce > .ln.r-code::before { top:7px; }
  .lw-ce > .ln.r-quote::before { top:6px; }
  /* 备忘录也走同一套「逐行实时渲染」（和日记一致 ✓，不再是左右分栏 ✗）。
     正文空的时候给一句占位提示 —— 只有「唯一一行且是空行」时才显示 ✓。 */
  .lw-memo-ce { padding:2px 18px 20px; }
  .lw-memo-ce > .ln.cur:only-child { position:relative; }
  .lw-memo-ce > .ln.cur:only-child:has(> br:only-child)::after {
    content:'直接在这里写…（# 标题 / **粗体** / - [ ] 清单 / | 表格 | / #标签）';
    position:absolute; left:0; top:0; color:${T.faint}; pointer-events:none;
  }
  /* ── 图片预览：点「图片」后编辑区切成「左编辑 / 右图片预览」两栏 ──
     注意这和之前被拆掉的 Markdown 分栏**不是一回事**：
     这里只是把导出结果先看一眼再下载 ✓（用户要求「先是预览效果，分栏」）。 */
  .lw-img-split { flex:1; display:flex; min-height:0; }
  .lw-img-split > .pane { min-width:0; display:flex; flex-direction:column; }
  .lw-img-split > .pane:first-child { flex:1 1 54%; }
  .lw-img-split > .pane.img { flex:1 1 46%; border-left:1px solid ${T.lineDim}; background:#0d0d0c; }
  .lw-img-split .panehd { flex:none; display:flex; align-items:center; gap:8px; padding:7px 12px;
    border-bottom:1px solid ${T.lineDim}; color:${T.faint}; font-size:9.5px; letter-spacing:1.4px; text-transform:uppercase; }
  .lw-img-split .panehd .sp { flex:1; }
  .lw-img-split .panehd button { height:24px; padding:0 9px; font-size:11px; letter-spacing:0; text-transform:none; }
  .lw-img-size { font:10px ${MONO}; color:${T.dim}; letter-spacing:0; text-transform:none; }
  .lw-img-split .panebd { flex:1; overflow:auto; padding:12px; }
  .lw-img-split .panebd img { display:block; width:100%; height:auto; border:1px solid ${T.lineDim}; }
  .lw-img-hint { padding:26px 6px; color:${T.faint}; font-size:12px; text-align:center; }
  .lw-img-hint.err { color:${T.red}; }
  /* 工具栏（紧凑 ✓ 不换行 ✓）*/
  .lw-live-bar { display:flex; align-items:center; gap:7px; padding:6px 10px; flex:none;
    border-bottom:1px solid ${T.lineDim}; background:#131312; font-size:10px; color:${T.faint}; letter-spacing:.4px; }
  .lw-live-bar .sp { flex:1; min-width:6px; }
  .lw-live-bar .brand { color:${T.accent}; font-weight:700; white-space:nowrap; }
  .lw-live-bar .hint { color:${T.faint}; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lw-live-bar button { height:22px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:600 10px ${UI}; cursor:pointer; white-space:nowrap; flex:none; }
  .lw-live-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-live-bar select { height:22px; padding:0 6px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:10px ${UI}; outline:none; flex:none; }
  .lw-live-bar select option { background:#111; color:${T.text}; }
  .lw-jtpl { display:flex; align-items:center; gap:7px; padding:9px 14px; border-bottom:1px solid ${T.lineDim};
    font-size:10.5px; color:${T.faint}; flex-wrap:wrap; }
  .lw-jtpl .sp { flex:1; }
  .lw-jtpl button { height:26px; padding:0 11px; border:2px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:600 10.5px ${UI}; letter-spacing:.6px; cursor:pointer; }
  .lw-jtpl button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-jtpl button:active { background:${T.accent}; color:${T.accentInk}; }
  /* 日记 */
  .lw-jtext { width:100%; min-height:190px; resize:vertical; padding:12px 13px; border:2px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:12.5px/1.8 ${UI}; outline:none; }
  .lw-jtext:focus { border-color:${T.accent}; }
  .lw-jlist { display:flex; flex-direction:column; max-height:420px; overflow:auto; }
  .lw-jrow { display:flex; gap:14px; padding:12px 14px; border-bottom:1px solid ${T.lineDim}; align-items:flex-start; }
  .lw-jrow:hover { background:#141412; }
  .lw-jrow .del { opacity:0; cursor:pointer; color:${T.faint}; }
  .lw-jrow:hover .del { opacity:1; }
  .lw-jrow .del:hover { color:${T.red}; }
  .lw-jdate { flex:none; width:74px; text-align:right; }
  .lw-jdate b { display:block; font-size:14px; font-weight:700; color:${T.accent}; letter-spacing:.4px; }
  .lw-jdate span { font-size:9.5px; color:${T.faint}; letter-spacing:1px; }
  .lw-jbody { flex:1; min-width:0; font-size:12.5px; line-height:1.75; white-space:pre-wrap; word-break:break-word; }
  /* 论文检索 */
  .lw-search { display:flex; gap:9px; }
  .lw-search input { flex:1; min-width:0; height:36px; padding:0 12px; border:2px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:12.5px ${UI}; outline:none; }
  .lw-search input:focus { border-color:${T.accent}; }
  .lw-kw { cursor:pointer; }
  .lw-kw:hover { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-plist { display:flex; flex-direction:column; max-height:620px; overflow:auto; }
  .lw-parow { padding:12px 14px; border-bottom:1px solid ${T.lineDim}; }
  .lw-parow:hover { background:#141412; }
  .lw-parow .t { font-size:12.5px; font-weight:600; line-height:1.5; }
  .lw-parow .t a { color:${T.accent}; text-decoration:none; }
  .lw-parow .t a:hover { text-decoration:underline; }
  .lw-parow .m { font-size:10px; color:${T.faint}; margin-top:5px; letter-spacing:.4px; }
  .lw-parow .s { font-size:11.5px; color:${T.dim}; line-height:1.7; margin-top:6px; }
  /* 邮箱表单 */
  .lw-form { display:flex; flex-direction:column; gap:9px; }
  .lw-form label { display:flex; flex-direction:column; gap:4px; font-size:10px; letter-spacing:1.2px;
    color:${T.faint}; text-transform:uppercase; }
  .lw-form input { height:32px; padding:0 10px; border:2px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:12px ${UI}; outline:none; letter-spacing:.4px; }
  .lw-form input:focus { border-color:${T.accent}; }
  /* 邮箱：按地址自动识别服务商后的提示条 */
  .lw-mail-hint { margin-top:9px; padding:7px 10px; border:1px solid color-mix(in srgb,${T.ok} 34%,transparent);
    border-radius:6px; background:color-mix(in srgb,${T.ok} 9%,transparent); color:${T.dim}; font-size:11px; line-height:1.6; }
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
  .lw-mail-send .hd { font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:${T.faint}; }
  .lw-mail-send label { display:flex; flex-direction:column; gap:4px; font-size:10px; letter-spacing:1.2px;
    color:${T.faint}; text-transform:uppercase; }
  .lw-mail-send input, .lw-mail-send textarea { padding:0 10px; border:2px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:12px ${UI}; outline:none; letter-spacing:.4px; }
  .lw-mail-send input { height:32px; }
  .lw-mail-send textarea { padding:8px 10px; resize:vertical; line-height:1.6; }
  .lw-mail-send input:focus, .lw-mail-send textarea:focus { border-color:${T.accent}; }
  #btn-lifework.on { background:${T.accent} !important; color:${T.accentInk} !important; }

  /* ── 邮箱：顶栏状态胶囊（和天气胶囊等高 ✓，见 .lw-wx 的注释）── */
  .lw-mb { display:flex; gap:9px; padding:0 12px; border:2px solid ${T.line}; flex:none;
    cursor:pointer; transition:background .12s; }
  .lw-mb:hover { background:${T.card2}; }
  .lw-mb .ic { font-size:15px; line-height:1; }
  .lw-mb .n { font-size:16px; font-weight:700; color:${T.dim}; font-family:${MONO}; line-height:1; }
  .lw-mb.has .n { color:${T.accent}; }
  .lw-mb .t { font-size:9.5px; color:${T.dim}; line-height:1.4; letter-spacing:.4px; max-width:190px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-mb.bad { border-color:color-mix(in srgb,${T.red} 46%,transparent); }
  .lw-mb.bad .t { color:${T.red}; }
  /* 收到新邮件时胶囊闪一下 ✓（只闪几秒，不一直动 ✓）*/
  .lw-mb.fresh { animation:lw-mail-flash 1s ease-in-out 3; }
  @keyframes lw-mail-flash {
    0%,100% { background:transparent; border-color:${T.line}; }
    50% { background:${T.accent}; border-color:${T.accent}; }
  }
  @media (prefers-reduced-motion: reduce) { .lw-mb.fresh { animation:none; background:${T.card2}; } }

  /* ── 新邮件提醒的浮层 ✓ ──────────────────────────────────────────────
     放在 body 上（**不放在面板里** ✗）—— 面板关着的时候也要能提醒 ✓。
     z-index 9500：高于面板 8800 和右侧抽屉 8900，低于命令面板 9700 ✓。 */
  .lw-toast { position:fixed; right:22px; bottom:22px; z-index:9500; width:330px;
    display:flex; gap:11px; padding:12px 13px; background:${T.card}; border:2px solid ${T.accent};
    font-family:${UI}; color:${T.text}; cursor:pointer; box-shadow:0 10px 30px rgba(0,0,0,.45);
    animation:lw-toast-in .18s ease-out; }
  @keyframes lw-toast-in { from { transform:translateY(10px); opacity:0; } to { transform:none; opacity:1; } }
  @media (prefers-reduced-motion: reduce) { .lw-toast { animation:none; } }
  .lw-toast .ic { font-size:17px; line-height:1.1; color:${T.accent}; flex:none; }
  .lw-toast .bd { flex:1; min-width:0; }
  .lw-toast .t1 { font-size:10px; letter-spacing:1.4px; text-transform:uppercase; color:${T.accent}; }
  .lw-toast .t2 { font-size:11.5px; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-toast .t3 { font-size:11px; color:${T.dim}; margin-top:2px; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .lw-toast .x { flex:none; width:20px; height:20px; border:0; background:transparent; color:${T.faint};
    cursor:pointer; font-size:12px; padding:0; line-height:1; }
  .lw-toast .x:hover { color:${T.text}; }

  /* ── 邮箱：三栏 ─────────────────────────────────────────────────── */
  /* ⚠️ 高度由 .lw-main.fill > .lw-ml { flex:1 } 给 ✓（以前这里写 flex:1 是**无效**的 ✗ —— 父级是 block ✗）*/
  .lw-ml { display:flex; min-height:280px; }
  .lw-ml-side { width:196px; flex:none; border-right:2px solid ${T.line}; overflow:auto; padding:10px 0; }
  .lw-ml-list { width:330px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; }
  .lw-ml-read { flex:1; min-width:0; display:flex; flex-direction:column; }
  .lw-ml-hd { font-size:9px; letter-spacing:2.2px; text-transform:uppercase; color:${T.faint};
    padding:10px 12px 6px; }
  .lw-ml-acct { display:flex; align-items:center; gap:8px; padding:8px 12px; cursor:pointer;
    border-left:3px solid transparent; font-size:11.5px; }
  .lw-ml-acct:hover { background:${T.card2}; }
  .lw-ml-acct.on { background:${T.card2}; border-left-color:${T.accent}; }
  .lw-ml-acct .em { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-acct .cnt { font-family:${MONO}; font-size:10.5px; color:${T.dim}; }
  .lw-ml-acct .cnt.has { color:${T.accent}; font-weight:700; }
  .lw-ml-acct .err { font-size:9.5px; color:${T.red}; }
  .lw-ml-box { padding:6px 12px; cursor:pointer; font-size:11px; display:flex; gap:8px; align-items:center;
    border-left:3px solid transparent; color:${T.dim}; }
  .lw-ml-box:hover { background:${T.card2}; }
  .lw-ml-box.on { border-left-color:${T.accent}; color:${T.text}; background:${T.card2}; }
  .lw-ml-box .n { margin-left:auto; font-family:${MONO}; font-size:10px; }
  .lw-ml-item { padding:9px 12px; border-bottom:1px solid ${T.lineDim}; cursor:pointer; }
  .lw-ml-item:hover { background:${T.card2}; }
  .lw-ml-item.on { background:${T.card2}; border-left:3px solid ${T.accent}; padding-left:9px; }
  .lw-ml-item .r1 { display:flex; gap:8px; align-items:baseline; }
  .lw-ml-item .who { font-size:11px; color:${T.dim}; flex:1; min-width:0; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-item .when { font-size:9.5px; color:${T.faint}; font-family:${MONO}; flex:none; }
  .lw-ml-item .subj { font-size:11.5px; color:${T.dim}; margin-top:3px; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-item.unread .who { color:${T.text}; }
  .lw-ml-item.unread .subj { color:${T.text}; font-weight:650; }
  .lw-ml-item.unread .r1::before { content:'●'; color:${T.accent}; font-size:8px; flex:none; }
  .lw-ml-tools { display:flex; gap:7px; align-items:center; padding:9px 11px; border-bottom:2px solid ${T.line}; flex:none; }
  .lw-ml-tools input { flex:1; height:28px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:11px ${UI}; outline:none; min-width:0; }
  .lw-ml-tools button { height:28px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:600 9.5px ${UI}; letter-spacing:.8px; text-transform:uppercase; cursor:pointer; flex:none; }
  .lw-ml-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-ml-tools button.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-ml-rhd { flex:none; padding:14px 18px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-ml-rhd .subj { font-size:15px; font-weight:650; line-height:1.4; word-break:break-word; }
  .lw-ml-rhd .meta { margin-top:9px; font-size:11px; color:${T.dim}; line-height:1.8; }
  .lw-ml-rhd .meta b { color:${T.text}; font-weight:600; }
  .lw-ml-rhd .acts { display:flex; gap:7px; margin-top:11px; flex-wrap:wrap; }
  .lw-ml-frame { flex:1; min-height:0; width:100%; border:0; background:#fff; }
  .lw-ml-body { flex:1; min-height:0; overflow:auto; padding:16px 18px; font-size:12.5px; line-height:1.85;
    white-space:pre-wrap; word-break:break-word; }
  .lw-ml-body a { color:${T.accent}; }
  .lw-ml-atts { flex:none; border-top:1px solid ${T.lineDim}; padding:11px 18px; display:flex;
    flex-direction:column; gap:7px; max-height:190px; overflow:auto; }
  .lw-ml-att { display:flex; align-items:center; gap:10px; font-size:11px; }
  .lw-ml-att .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-ml-att .sz { color:${T.faint}; font-family:${MONO}; font-size:10px; }
  .lw-ml-empty { padding:34px 20px; text-align:center; color:${T.faint}; font-size:11.5px; line-height:2; }
  .lw-ml-more { padding:12px; text-align:center; font-size:11px; color:${T.accent}; cursor:pointer;
    border-top:1px dashed ${T.lineDim}; letter-spacing:.6px; }
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
  .lw-ml-pickwrap { position:fixed; inset:0; z-index:9500; background:rgba(0,0,0,.45);
    display:flex; align-items:center; justify-content:center; }
  .lw-ml-pick { width:320px; max-height:70vh; overflow:auto; background:${T.card};
    border:2px solid ${T.accent}; font-family:${UI}; color:${T.text}; }
  .lw-ml-pick .hd { display:flex; align-items:center; padding:11px 13px; border-bottom:1px solid ${T.lineDim};
    font-size:10px; letter-spacing:1.4px; text-transform:uppercase; color:${T.accent}; }
  .lw-ml-pick .hd .x { margin-left:auto; cursor:pointer; color:${T.faint}; }
  .lw-ml-pick .hd .x:hover { color:${T.text}; }
  .lw-ml-pick .it { padding:9px 13px; font-size:12px; cursor:pointer; border-bottom:1px solid ${T.lineDim};
    display:flex; align-items:center; gap:8px; }
  .lw-ml-pick .it:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-ml-pick .it.cur { color:${T.faint}; cursor:default; }
  .lw-ml-pick .it.cur:hover { background:transparent; color:${T.faint}; }
  .lw-ml-pick .it .tag { margin-left:auto; font-size:9.5px; }
  /* 对照翻译：左边**原样渲染整封邮件** ✓，右边列译文 ✓（见 mailReaderHtml 的注释）*/
  .lw-ml-trbar { flex:none; display:flex; align-items:center; gap:10px; padding:8px 18px;
    border-bottom:1px solid ${T.lineDim}; font-size:10px; letter-spacing:1.2px; text-transform:uppercase;
    color:${T.faint}; }
  .lw-ml-trbar .sp { flex:1; }

  /* ══════════════════════════════════════════════════════════════════════
     工作流模块（参考 n8n 的节点图）✓
     ⚠️ 注释里不能出现反引号 ✗（这段在 JS 模板字符串里 ✗）。
     ══════════════════════════════════════════════════════════════════════ */
  .lw-fl { display:flex; min-height:320px; border:2px solid ${T.lineDim}; background:${T.bg}; }
  .lw-fl-side { width:212px; flex:none; border-right:2px solid ${T.lineDim}; overflow:auto;
    padding:10px 0; background:${T.bg}; }
  .lw-fl-cv { flex:1; min-width:0; position:relative; overflow:auto;
    background:${T.bg2}; background-image:radial-gradient(${T.lineDim} 1px, transparent 1px);
    background-size:18px 18px; }
  .lw-fl-cfg { width:302px; flex:none; border-left:2px solid ${T.lineDim}; overflow:auto;
    background:${T.card}; padding:0 0 16px; }
  .lw-fl-row { display:flex; align-items:center; gap:8px; padding:6px 12px; font-size:11px;
    cursor:pointer; color:${T.dim}; border-left:2px solid transparent; }
  .lw-fl-row:hover { background:${T.card2}; color:${T.text}; }
  .lw-fl-row.on { background:${T.card2}; color:${T.text}; border-left-color:${T.accent}; }
  .lw-fl-row .em { font-size:13px; line-height:1; }
  .lw-fl-row .n { margin-left:auto; font-size:9.5px; color:${T.faint}; }
  .lw-fl-pal { display:flex; align-items:center; gap:8px; padding:6px 12px; font-size:11px;
    cursor:grab; color:${T.dim}; }
  .lw-fl-pal:hover { background:${T.card2}; color:${T.accent}; }
  .lw-fl-pal .em { font-size:13px; line-height:1; }
  .lw-fl-tools { position:sticky; top:0; left:0; z-index:5; display:flex; gap:6px;
    align-items:center; padding:8px 10px; background:${T.card}; border-bottom:2px solid ${T.line};
    flex-wrap:wrap; }
  .lw-fl-tools button { height:26px; padding:0 10px; border:1px solid ${T.lineDim};
    background:transparent; color:${T.dim}; font:10px ${UI}; cursor:pointer; letter-spacing:.4px; }
  .lw-fl-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-fl-tools button.pri { border-color:${T.accent}; color:${T.accent}; }
  .lw-fl-tools button.pri:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-fl-tools .hint { font-size:9.5px; color:${T.faint}; margin-left:auto; }
  .lw-fl-plane { position:relative; }
  .lw-fl-node { position:absolute; width:170px; height:56px; box-sizing:border-box;
    border:2px solid ${T.line}; background:${T.card}; cursor:move; user-select:none; }
  .lw-fl-node:hover { border-color:${T.accent}; }
  .lw-fl-node.on { border-color:${T.accent}; box-shadow:0 0 0 2px color-mix(in srgb, ${T.accent} 30%, transparent); }
  .lw-fl-node .hd { display:flex; align-items:center; gap:6px; padding:5px 8px 0; font-size:9px;
    letter-spacing:.8px; color:${T.faint}; text-transform:uppercase; }
  .lw-fl-node .bd { display:flex; align-items:center; gap:6px; padding:2px 8px 0; font-size:11.5px;
    color:${T.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-fl-node .bd .em { font-size:13px; line-height:1; flex:none; }
  .lw-fl-node .st { position:absolute; right:5px; bottom:3px; font-size:9px; color:${T.faint}; }
  .lw-fl-node.s-ok { border-color:${T.ok}; }
  .lw-fl-node.s-error { border-color:${T.red}; }
  .lw-fl-node.s-skipped { opacity:.45; }
  .lw-fl-port { position:absolute; width:12px; height:12px; border:2px solid ${T.line};
    background:${T.bg}; border-radius:50%; top:22px; cursor:crosshair; z-index:3; }
  .lw-fl-port:hover { background:${T.accent}; border-color:${T.accent}; }
  .lw-fl-port.in { left:-8px; }
  .lw-fl-port.out { right:-8px; }
  .lw-fl-port.out.p1 { top:36px; }
  .lw-fl-port.armed { background:${T.warn}; border-color:${T.warn}; }
  .lw-fl-svg { position:absolute; left:0; top:0; pointer-events:none; z-index:1; }
  .lw-fl-svg path { fill:none; stroke:${T.lineDim}; stroke-width:2; }
  .lw-fl-svg path.hot { stroke:${T.accent}; }
  /* ★ 连线只有 2px 粗 ✗，直接点很难点中 ✗ —— 再叠一条 14px 宽的**透明**路径当命中区 ✓。
     ⚠️ 必须用 **class** ✗，不能用 SVG 的 stroke / stroke-width **属性** ✗ ——
        属性优先级**低于** CSS ✗，会被上面那条 .lw-fl-svg path { stroke-width:2 } 覆盖掉 ✗
        （实测：属性写了 14 也没用 ✗，线还是 2px 粗、点不中 ✗）。 */
  .lw-fl-svg path.hit { stroke:transparent; stroke-width:14; }
  .lw-fl-svg g { pointer-events:all; cursor:pointer; }
  .lw-fl-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    color:${T.faint}; font-size:11.5px; text-align:center; line-height:2; }
  .lw-fl-field { padding:9px 14px 0; }
  .lw-fl-field label { display:block; font-size:9.5px; color:${T.faint}; letter-spacing:.8px;
    text-transform:uppercase; margin-bottom:5px; }
  .lw-fl-field input, .lw-fl-field select, .lw-fl-field textarea { width:100%; box-sizing:border-box;
    border:1px solid ${T.lineDim}; background:${T.bg2}; color:${T.text}; font:11.5px/1.7 ${UI};
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
  .lw-fl-pal .tx i { font-style:normal; font-size:9.5px; color:${T.faint};
    line-height:1.55; white-space:normal; }
  .lw-fl-pal:hover .tx i { color:${T.dim}; }

  /* 画布节点右上角显示**节点 id** ✓ —— 写 {{引用}} 时要用它 ✗，不给就只能瞎猜 ✗。 */
  .lw-fl-node .hd .fid { margin-left:auto; letter-spacing:0; text-transform:none;
    color:${T.dim}; font-size:9px; }
  /* 属性栏标题下的「这个节点是干什么的」✓ */
  .lw-fl-cfg .fd { padding:0 14px 4px; font-size:10.5px; color:${T.dim}; line-height:1.8; }
  .lw-fl-cfg .fd .fid { display:inline-block; border:1px solid ${T.lineDim}; padding:0 5px;
    margin-right:6px; color:${T.accent}; font-size:9.5px; }
  .lw-fl-cfg .fhow { padding:6px 14px 0; font-size:9.5px; color:${T.faint}; line-height:1.85; }
  .lw-fl-cfg .fout { padding:6px 14px 0; font-size:9.5px; color:${T.faint}; line-height:1.85; }
  .lw-fl-cfg .fout b { color:${T.ok}; font-weight:400; }

  /* ── 「📖 说明」面板 ✓（用户要的「每个节点的作用 + 提示怎么用」✓）────────── */
  .lw-fl-help { flex:1; min-width:0; overflow:auto; background:${T.bg2}; padding:20px 26px 40px; }
  .lw-fl-helpin { max-width:820px; margin:0 auto; font-size:11.5px; line-height:1.95; color:${T.dim}; }
  .lw-fl-help h3 { font-size:11px; letter-spacing:1.4px; text-transform:uppercase; color:${T.accent};
    margin:26px 0 10px; padding-bottom:6px; border-bottom:1px solid ${T.lineDim}; }
  .lw-fl-help h3:first-child { margin-top:0; }
  .lw-fl-help p { margin:0 0 9px; }
  .lw-fl-help ol, .lw-fl-help ul { margin:0 0 10px; padding-left:20px; }
  .lw-fl-help li { margin-bottom:4px; }
  .lw-fl-help b { color:${T.text}; font-weight:600; }
  .lw-fl-help code { background:${T.card2}; border:1px solid ${T.lineDim}; padding:0 4px;
    color:${T.accent}; font-size:10.5px; }
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
  .lw-fl-hd2 { font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:${T.faint};
    margin:16px 0 7px; }
  .lw-fl-help table { width:100%; border-collapse:collapse; font-size:10.5px; }
  .lw-fl-help th, .lw-fl-help td { text-align:left; vertical-align:top; padding:6px 8px;
    border-bottom:1px solid ${T.lineDim}; line-height:1.8; }
  .lw-fl-help th { color:${T.faint}; font-weight:400; font-size:9.5px; letter-spacing:.8px;
    text-transform:uppercase; }
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
  .lw-ml-side, .lw-ml-list, .lw-ml-read,
  .lw-rd-side, .lw-rd-list, .lw-rd-read,
  .lw-fl-side, .lw-fl-cfg,
  .lw-hl-side, .lw-hl-list, .lw-hl-read,
  .lw-nt-side, .lw-nt-list, .lw-nt-edit,
  .lw-jr-l, .lw-jr-r { min-height:0; }
  .lw-hl { display:flex; min-height:320px; border:2px solid ${T.lineDim}; background:${T.bg}; }
  .lw-hl-side { width:200px; flex:none; border-right:2px solid ${T.lineDim}; overflow:auto;
    padding:10px 0; background:${T.bg}; }
  .lw-hl-list { width:392px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; background:${T.card}; }
  .lw-hl-read { flex:1; min-width:0; display:flex; flex-direction:column; overflow:hidden; }
  .lw-hl-tools { display:flex; gap:6px; align-items:center; padding:9px 11px;
    border-bottom:2px solid ${T.line}; position:sticky; top:0; background:${T.card}; z-index:2; flex-wrap:wrap; }
  .lw-hl-tools input { flex:1; min-width:80px; height:26px; padding:0 9px; border:1px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:11px ${UI}; outline:none; }
  .lw-hl-tools input:focus { border-color:${T.accent}; }
  .lw-hl-tools button { height:26px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:10px ${UI}; cursor:pointer; letter-spacing:.4px; flex:none; }
  .lw-hl-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-hl-tools button.pri { border-color:${T.accent}; color:${T.accent}; }
  .lw-hl-tools button.pri:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-hl-src { font-size:9px; letter-spacing:1.4px; color:${T.faint}; text-transform:uppercase;
    padding:11px 13px 5px; border-bottom:1px solid #1c1c1a; background:${T.bg}; }
  .lw-hl-it { display:flex; gap:9px; padding:9px 13px; border-bottom:1px solid #1c1c1a; cursor:pointer; }
  .lw-hl-it:hover { background:${T.card2}; }
  .lw-hl-it.on { background:${T.card2}; box-shadow:inset 3px 0 0 ${T.accent}; }
  .lw-hl-it .rk { flex:none; width:19px; text-align:right; font-size:10.5px; color:${T.faint};
    font-variant-numeric:tabular-nums; line-height:1.5; }
  .lw-hl-it .rk.top { color:${T.red}; font-weight:700; }
  .lw-hl-it .mn { flex:1; min-width:0; }
  .lw-hl-it .ti { font-size:12px; line-height:1.55; color:${T.text}; word-break:break-word; }
  .lw-hl-it.seen .ti { color:${T.dim}; }
  .lw-hl-it .mt { display:flex; align-items:center; gap:8px; margin-top:4px; font-size:9px; color:${T.faint}; }
  .lw-hl-it .mt .badge { border:1px solid ${T.lineDim}; padding:1px 5px; }
  .lw-hl-it .mt .hot { color:${T.accent}; }
  .lw-hl-it .st { color:${T.warn}; }
  .lw-hl-ai { flex:none; border-bottom:2px solid ${T.lineDim}; padding:12px 18px; background:${T.bg}; }
  .lw-hl-ai .hd { display:flex; align-items:center; gap:9px; margin-bottom:9px; }
  .lw-hl-ai .hd b { font-size:11px; letter-spacing:1.2px; }
  .lw-hl-ai .hd button { margin-left:auto; height:26px; padding:0 11px; border:1px solid ${T.accent};
    background:transparent; color:${T.accent}; font:10px ${UI}; cursor:pointer; letter-spacing:.5px; }
  .lw-hl-ai .hd button:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-hl-ai .bd { font-size:12px; line-height:1.9; color:${T.text}; white-space:pre-wrap;
    max-height:220px; overflow:auto; }
  .lw-hl-ai .bd:empty::before { content:'点右边「🤖 生成 AI 日报」—— 把当前榜单交给模型，出一份带重点的简报 ✓';
    color:${T.faint}; font-size:11px; }
  .lw-hl-body { flex:1; min-height:0; overflow:auto; padding:14px 18px 20px; }
  .lw-hl-body h2 { font-size:15px; line-height:1.5; margin-bottom:8px; }
  .lw-hl-body .meta { font-size:10px; color:${T.faint}; margin-bottom:12px; }
  .lw-hl-body .acts { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .lw-hl-body .acts button { height:26px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:10px ${UI}; cursor:pointer; }
  .lw-hl-body .acts button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-hl-body .acts button.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-hl-body iframe { width:100%; height:340px; border:1px solid ${T.lineDim}; background:#fff; }
  /* ★ 有些站**不允许被内嵌** ✗（实测 GitHub / arXiv / OpenAlex / openai.com ✗）——
     硬塞 iframe 的话浏览器只会显示一句「xxx 拒绝了我们的连接请求」✗，
     用户看着像坏了 ✗。所以改成一张**说清楚的卡片** ✓ + 一个大按钮 ✓。 */
  .lw-hl-noframe { border:1px dashed ${T.lineDim}; padding:26px 22px; text-align:center; background:${T.bg2}; }
  .lw-hl-noframe .ic { font-size:26px; line-height:1; margin-bottom:12px; }
  .lw-hl-noframe .ti { font-size:13px; font-weight:700; color:${T.text}; margin-bottom:8px; }
  .lw-hl-noframe .why { font-size:11px; color:${T.dim}; line-height:1.9; margin-bottom:16px; }
  .lw-hl-noframe button { height:32px; padding:0 16px; border:2px solid ${T.accent}; background:transparent;
    color:${T.accent}; font:600 11px ${UI}; letter-spacing:.8px; cursor:pointer; }
  .lw-hl-noframe button:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-hl-noframe .url { font-size:10px; color:${T.faint}; margin-top:14px; word-break:break-all; line-height:1.7; }
  .lw-hl-err { font-size:10.5px; color:${T.red}; line-height:1.8; padding:8px 13px; }

  /* ══════════════════════════════════════════════════════════════════════
     阅读模块（个人阅读管理）✓
     ⚠️ 注释里不能出现反引号 ✗ —— 这段整个在 JS 模板字符串里 ✗。
     ⚠️ 三栏高度由 .lw-main.fill 那条链撑满 ✓（见上面全高面板的注释 ✓）。
     ══════════════════════════════════════════════════════════════════════ */
  .lw-rd { display:flex; min-height:320px; border:2px solid ${T.lineDim}; background:${T.bg}; }
  .lw-rd-side { width:206px; flex:none; border-right:2px solid ${T.lineDim}; overflow:auto; padding:12px 0; background:${T.bg}; }
  .lw-rd-list { width:330px; flex:none; border-right:1px solid ${T.lineDim}; overflow:auto; background:${T.card}; }
  .lw-rd-read { flex:1; min-width:0; display:flex; flex-direction:column; overflow:hidden; }
  .lw-rd-hd { font-size:9px; letter-spacing:1.8px; color:${T.faint}; text-transform:uppercase;
    padding:10px 13px 5px; }
  .lw-rd-row { display:flex; align-items:center; gap:8px; padding:6px 13px; font-size:11px;
    cursor:pointer; color:${T.dim}; border-left:2px solid transparent; }
  .lw-rd-row:hover { background:${T.card2}; color:${T.text}; }
  .lw-rd-row.on { background:${T.card2}; color:${T.text}; border-left-color:${T.accent}; }
  .lw-rd-row .n { margin-left:auto; font-size:9.5px; color:${T.faint}; font-variant-numeric:tabular-nums; }
  .lw-rd-row .em { font-size:13px; line-height:1; }
  /* 左栏统计 */
  .lw-rd-stat { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:${T.lineDim};
    margin:0 13px 12px; border:1px solid ${T.lineDim}; }
  .lw-rd-stat div { background:${T.card}; padding:8px 9px; }
  .lw-rd-stat b { display:block; font-size:18px; font-weight:700; color:${T.accent};
    font-variant-numeric:tabular-nums; line-height:1.1; }
  .lw-rd-stat span { font-size:9px; color:${T.faint}; letter-spacing:.6px; }
  /* 中栏：工具条 + 书卡 */
  .lw-rd-tools { display:flex; gap:6px; align-items:center; padding:9px 11px;
    border-bottom:2px solid ${T.line}; position:sticky; top:0; background:${T.card}; z-index:2; flex-wrap:wrap; }
  .lw-rd-tools input { flex:1; min-width:80px; height:26px; padding:0 9px; border:1px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:11px ${UI}; outline:none; }
  .lw-rd-tools input:focus { border-color:${T.accent}; }
  .lw-rd-tools button { height:26px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:10px ${UI}; cursor:pointer; letter-spacing:.5px; flex:none; }
  .lw-rd-tools button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-bk { display:flex; gap:11px; padding:11px 13px; border-bottom:1px solid #1c1c1a; cursor:pointer; }
  .lw-bk:hover { background:${T.card2}; }
  .lw-bk.on { background:${T.card2}; box-shadow:inset 3px 0 0 ${T.accent}; }
  .lw-bk .cv { width:42px; height:58px; flex:none; border:1px solid ${T.lineDim}; background:${T.bg2};
    display:flex; align-items:center; justify-content:center; font-size:19px; overflow:hidden; }
  .lw-bk .cv img { width:100%; height:100%; object-fit:cover; }
  .lw-bk .mn { flex:1; min-width:0; }
  .lw-bk .ti { font-size:12.5px; font-weight:600; color:${T.text}; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .lw-bk .au { font-size:10px; color:${T.dim}; margin-top:3px; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .lw-bk .mt { display:flex; align-items:center; gap:6px; margin-top:7px; font-size:9px; color:${T.faint}; }
  .lw-bk .mt .tag { border:1px solid ${T.lineDim}; padding:1px 5px; letter-spacing:.4px; }
  .lw-bar { flex:1; height:3px; background:${T.lineDim}; position:relative; min-width:24px; }
  .lw-bar i { position:absolute; left:0; top:0; bottom:0; background:${T.accent}; }
  /* 右栏 */
  .lw-rd-rhd { flex:none; padding:14px 18px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-rd-rhd h2 { font-size:17px; font-weight:700; letter-spacing:.4px; line-height:1.3; }
  .lw-rd-rhd .meta { font-size:10.5px; color:${T.dim}; margin-top:6px; letter-spacing:.4px; }
  .lw-rd-rhd .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
  .lw-rd-chip { border:1px solid ${T.lineDim}; padding:3px 8px; font-size:9.5px; color:${T.dim};
    cursor:pointer; letter-spacing:.4px; }
  .lw-rd-chip:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rd-chip.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-rd-chip[data-act="del"]:hover { border-color:${T.red}; color:${T.red}; }
  .lw-rd-body { flex:1; min-height:0; overflow:auto; padding:0 18px 20px; }
  .lw-rd-sec { font-size:9px; letter-spacing:1.8px; color:${T.faint}; text-transform:uppercase;
    padding:16px 0 8px; border-bottom:1px solid ${T.lineDim}; margin-bottom:10px; }
  /* 进度条（可点）*/
  .lw-rd-prog { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .lw-rd-prog .track { flex:1; height:8px; background:${T.lineDim}; position:relative; cursor:pointer; }
  .lw-rd-prog .track i { position:absolute; left:0; top:0; bottom:0; background:${T.accent}; }
  .lw-rd-prog .pct { font-size:12px; font-weight:700; color:${T.accent}; width:44px; text-align:right;
    font-variant-numeric:tabular-nums; }
  .lw-rd-quick { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .lw-rd-quick button { height:26px; padding:0 10px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:10px ${UI}; cursor:pointer; }
  .lw-rd-quick button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rd-quick input { width:62px; height:26px; padding:0 8px; border:1px solid ${T.lineDim};
    background:transparent; color:${T.text}; font:11px ${UI}; outline:none; }
  /* 笔记 */
  .lw-note { border-left:2px solid ${T.lineDim}; padding:9px 0 9px 12px; margin-bottom:10px; position:relative; }
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
  .lw-rd-chart div:hover::after { content:attr(data-tip); position:absolute; bottom:100%; left:50%;
    transform:translateX(-50%); background:${T.card2}; border:1px solid ${T.line}; color:${T.text};
    font-size:9px; padding:3px 6px; white-space:nowrap; z-index:5; }
  .lw-rd-axis { display:flex; gap:4px; margin-top:5px; font-size:8.5px; color:${T.faint}; }
  .lw-rd-axis span { flex:1; text-align:center; }
  /* 导入浮层 */
  .lw-imp { position:fixed; inset:0; background:rgba(0,0,0,.66); z-index:8800; display:flex;
    align-items:center; justify-content:center; }
  .lw-imp .box { width:min(760px,92vw); max-height:86vh; background:${T.bg}; border:2px solid ${T.line};
    display:flex; flex-direction:column; }
  .lw-imp .hd { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:2px solid ${T.line}; }
  .lw-imp .hd b { font-size:12px; letter-spacing:1px; }
  .lw-imp .hd .x { margin-left:auto; cursor:pointer; color:${T.dim}; }
  .lw-imp .hd .x:hover { color:${T.red}; }
  .lw-imp .bd { flex:1; min-height:0; overflow:auto; padding:14px 16px; }
  .lw-imp textarea { width:100%; height:210px; resize:vertical; border:1px solid ${T.lineDim};
    background:${T.card}; color:${T.text}; font:11.5px/1.7 ${UI}; padding:10px; outline:none; }
  .lw-imp textarea:focus { border-color:${T.accent}; }
  .lw-imp .tip { font-size:10.5px; color:${T.dim}; line-height:1.9; margin-bottom:10px; }
  .lw-imp .tip code { background:${T.card2}; border:1px solid ${T.lineDim}; padding:1px 5px; }
  .lw-imp .ft { display:flex; gap:8px; align-items:center; padding:12px 16px; border-top:2px solid ${T.line}; }
  .lw-imp .ft button { height:30px; padding:0 14px; border:2px solid ${T.line}; background:transparent;
    color:${T.text}; font:600 10.5px ${UI}; letter-spacing:1px; cursor:pointer; }
  .lw-imp .ft button.pri { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-imp .ft button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-imp .ft button.pri:hover { background:transparent; color:${T.accent}; }
  .lw-imp .pv { font-size:10.5px; color:${T.dim}; line-height:1.9; }
  .lw-imp .pv b { color:${T.accent}; }
  /* ★ 微信读书「连接」面板的补充样式 ✓ —— 复用 .lw-imp 那套浮层 ✓（别再造一个 ✗）。
     「怎么拿 Cookie」那四步是**这个功能的成败关键** ✗ ——
     用户就是卡在这一步 ✗，所以给它一个显眼的盒子 ✓，别混在灰字里 ✗。 */
  .lw-imp .steps { border:1px solid ${T.lineDim}; background:${T.card}; padding:11px 14px; margin:10px 0 12px; }
  .lw-imp .steps .h { font-size:10px; letter-spacing:1.2px; text-transform:uppercase;
    color:${T.accent}; margin-bottom:8px; }
  .lw-imp .steps ol { margin:0; padding-left:18px; font-size:10.5px; color:${T.dim}; line-height:1.95; }
  .lw-imp .steps li { margin-bottom:3px; }
  .lw-imp .steps code { background:${T.card2}; border:1px solid ${T.lineDim}; padding:1px 5px; color:${T.text}; }
  .lw-imp .steps .n { margin-top:8px; font-size:10px; color:${T.warn}; line-height:1.85; }
  .lw-imp .st { font-size:10.5px; line-height:1.9; margin-top:10px; min-height:18px;
    color:${T.dim}; word-break:break-all; }
  .lw-imp .st.ok { color:${T.ok}; }
  .lw-imp .st.err { color:${T.red}; }
  .lw-imp .st2 { font-size:10px; color:${T.faint}; line-height:1.9; margin-top:4px; }

  /* ══════════════════════════════════════════════════════════════════════
     外刊精读 / 生词本 ✓（阅读模块的两个子模式 ✓）
     ⚠️ 注释里不能出现反引号 ✗（这段在 JS 模板字符串里 ✗）。
     ⚠️ 三栏**复用** .lw-rd-side / .lw-rd-list / .lw-rd-read 这套类名 ✓ ——
        这样 bindPaneGrips 那份 spec **一个字都不用改** ✓，
        拖拽调宽 / 双击复位 / 宽度落盘全都自动有了 ✓（新做一套就等于重踩一遍 ✗）。
     ══════════════════════════════════════════════════════════════════════ */
  .lw-rd-wrap { display:flex; flex-direction:column; min-height:0; }
  .lw-rd-wrap > .lw-rd { flex:1; min-height:0; }
  .lw-rd-modes { display:flex; align-items:center; gap:6px; flex-wrap:wrap;
    padding:8px 11px; background:${T.card}; border:2px solid ${T.lineDim}; border-bottom:none; }
  .lw-rd-modes .seg { display:flex; align-items:center; gap:6px; height:26px; padding:0 11px;
    border:1px solid ${T.lineDim}; color:${T.dim}; font:10.5px ${UI}; cursor:pointer; letter-spacing:.5px; }
  .lw-rd-modes .seg:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-rd-modes .seg.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  .lw-rd-modes .seg i { font-style:normal; font-size:9px; opacity:.7; }
  .lw-rd-modes .sp { flex:1; }
  .lw-rd-modes .tip { font-size:9.5px; color:${T.faint}; }

  /* ── 文章列表 ── */
  .lw-ep-art { padding:11px 13px; border-bottom:1px solid ${T.lineDim}; cursor:pointer;
    border-left:2px solid transparent; }
  .lw-ep-art:hover { background:${T.card2}; }
  .lw-ep-art.on { background:${T.card2}; border-left-color:${T.accent}; }
  .lw-ep-art .ti { font-size:12px; color:${T.text}; line-height:1.5; margin-bottom:5px; }
  .lw-ep-art .mt { display:flex; gap:8px; flex-wrap:wrap; font-size:9.5px; color:${T.faint}; }
  .lw-ep-art .mt .lv { color:${T.accent}; }
  .lw-ep-art .mt .done { color:${T.ok}; }

  /* ── 正文（逐句）── */
  .lw-ep-body { flex:1; min-height:0; overflow:auto; padding:22px 30px 60px; background:${T.bg}; }
  .lw-ep-body .hd { max-width:760px; margin:0 auto 18px; }
  .lw-ep-body .hd h2 { font-size:19px; line-height:1.45; color:${T.text}; font-weight:400; margin:0 0 8px; }
  .lw-ep-body .hd .mt { font-size:10.5px; color:${T.faint}; display:flex; gap:10px; flex-wrap:wrap; }
  .lw-ep-body .hd .mt b { color:${T.dim}; font-weight:400; }
  .lw-ep-body .bd { max-width:760px; margin:0 auto; }
  /* 正文在上、句子面板在下 ✓ —— 面板给固定比例 + 自己滚 ✓（不定高的话正文会被挤没 ✗）。 */
  .lw-ep-panel { flex:0 0 44%; min-height:0; overflow:auto; border-top:2px solid ${T.lineDim};
    background:${T.card}; padding-bottom:14px; }
  .lw-ep-p { margin:0 0 15px; }
  /* 句子 = 一个 span ✓ —— 点它选中 ✓，朗读时高亮 ✓，标记「已懂」变淡 ✓。
     行高给到 2.05 ✗：精读要**慢**，挤在一起没法看 ✗。 */
  .lw-ep-s { font-size:15px; line-height:2.05; color:${T.text}; cursor:pointer;
    border-bottom:1px solid transparent; padding:1px 0; }
  .lw-ep-s:hover { background:${T.card2}; }
  .lw-ep-s.on { background:color-mix(in srgb, ${T.accent} 16%, transparent); border-bottom-color:${T.accent}; }
  .lw-ep-s.hl { background:color-mix(in srgb, ${T.ok} 22%, transparent); }
  .lw-ep-s.done { color:${T.faint}; }
  .lw-ep-s .wk { border-bottom:1px dotted ${T.dim}; }

  /* ── 右栏：句子详情 ── */
  .lw-ep-sent { font-size:13px; line-height:1.95; color:${T.text}; padding:12px 14px;
    border-left:2px solid ${T.accent}; background:${T.card}; margin:10px 0 4px; }
  .lw-ep-sent .sp { display:inline-block; margin:0 2px; }
  .lw-ep-sent .sp.have { color:${T.accent}; border-bottom:1px dotted ${T.accent}; cursor:pointer; }
  .lw-ep-act { display:flex; gap:6px; flex-wrap:wrap; padding:8px 14px 0; }
  .lw-ep-act button, .lw-ep-act .btn { height:24px; padding:0 9px; border:1px solid ${T.lineDim};
    background:transparent; color:${T.dim}; font:9.5px ${UI}; cursor:pointer; }
  .lw-ep-act button:hover, .lw-ep-act .btn:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-ep-add { display:flex; gap:6px; padding:8px 14px 0; }
  .lw-ep-add input { flex:1; min-width:0; height:26px; padding:0 8px; border:1px solid ${T.lineDim};
    background:${T.bg2}; color:${T.text}; font:11.5px ${UI}; outline:none; }
  .lw-ep-add input:focus { border-color:${T.accent}; }
  .lw-ep-add button { height:26px; padding:0 10px; border:1px solid ${T.accent}; background:transparent;
    color:${T.accent}; font:10px ${UI}; cursor:pointer; }
  .lw-ep-add button:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-ep-tip { padding:6px 14px 0; font-size:9.5px; color:${T.faint}; line-height:1.85; }

  /* ── 生词本 ── */
  .lw-wd-row { display:flex; align-items:center; gap:8px; padding:8px 13px;
    border-bottom:1px solid ${T.lineDim}; cursor:pointer; border-left:2px solid transparent; }
  .lw-wd-row:hover { background:${T.card2}; }
  .lw-wd-row.on { background:${T.card2}; border-left-color:${T.accent}; }
  .lw-wd-row .w { font-size:12.5px; color:${T.text}; min-width:0; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .lw-wd-row .df { font-size:10px; color:${T.faint}; margin-left:auto; flex:none; }
  .lw-wd-dot { width:7px; height:7px; border-radius:50%; flex:none; background:${T.faint}; }
  .lw-wd-dot.fresh { background:${T.dim}; }
  .lw-wd-dot.learning { background:${T.warn}; }
  .lw-wd-dot.young { background:${T.accent}; }
  .lw-wd-dot.mature { background:${T.ok}; }
  .lw-wd-hd { font-size:11px; letter-spacing:1.3px; text-transform:uppercase; color:${T.faint};
    padding:12px 13px 6px; }
  .lw-wd-big { font-size:22px; color:${T.text}; padding:14px 14px 0; line-height:1.3; }
  .lw-wd-ph { font-size:11.5px; color:${T.dim}; padding:4px 14px 0; }
  .lw-wd-def { font-size:12.5px; color:${T.text}; padding:10px 14px 0; line-height:1.9; }
  .lw-wd-eg { font-size:11px; color:${T.dim}; padding:8px 14px 0; line-height:1.9;
    border-left:2px solid ${T.lineDim}; margin:8px 14px 0; }
  .lw-wd-hist { display:flex; gap:3px; flex-wrap:wrap; padding:8px 14px 0; }
  .lw-wd-hist i { width:11px; height:11px; display:block; border:1px solid ${T.lineDim}; }
  .lw-wd-hist i.ok { background:${T.ok}; border-color:${T.ok}; }
  .lw-wd-hist i.bad { background:${T.red}; border-color:${T.red}; }
  .lw-wd-hist i.hard { background:${T.warn}; border-color:${T.warn}; }
  .lw-wd-next { font-size:10.5px; color:${T.dim}; padding:8px 14px 0; line-height:1.9; }
  .lw-wd-next b { color:${T.accent}; font-weight:400; }

  /* ── 复习浮层（遗忘曲线要**看得见** ✓）── */
  .lw-rev-card { min-height:220px; display:flex; flex-direction:column; align-items:center;
    justify-content:center; border:1px solid ${T.lineDim}; background:${T.card}; padding:26px 20px; }
  .lw-rev-card .w { font-size:30px; color:${T.text}; line-height:1.3; text-align:center; word-break:break-word; }
  .lw-rev-card .ph { font-size:13px; color:${T.dim}; margin-top:8px; }
  .lw-rev-card .df { font-size:14px; color:${T.text}; margin-top:16px; line-height:1.9; text-align:center; max-width:560px; }
  .lw-rev-card .eg { font-size:12px; color:${T.dim}; margin-top:12px; line-height:1.9; text-align:center; max-width:560px; }
  .lw-rev-card .src { font-size:10px; color:${T.faint}; margin-top:14px; }
  .lw-rev-card .ask { font-size:11.5px; color:${T.faint}; }
  .lw-rev-bar { display:flex; gap:6px; align-items:center; padding:12px 0 0; flex-wrap:wrap; }
  .lw-rev-bar button { flex:1; min-width:110px; height:44px; border:1px solid ${T.lineDim};
    background:transparent; color:${T.dim}; font:11px ${UI}; cursor:pointer; line-height:1.5; }
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
  .lw-spk select, .lw-spk input { height:24px; border:1px solid ${T.lineDim}; background:${T.bg2};
    color:${T.text}; font:10px ${UI}; padding:0 6px; outline:none; max-width:150px; }
  .lw-spk select:focus, .lw-spk input:focus { border-color:${T.accent}; }

  .lw-ml-tr { flex:1; min-height:0; display:grid; grid-template-columns:1fr 1fr; }
  .lw-ml-tr .pane { min-width:0; min-height:0; }
  .lw-ml-tr .pane.origin { border-right:1px solid ${T.lineDim}; display:flex; overflow:hidden; }
  .lw-ml-tr .pane.origin iframe { flex:1; width:100%; border:0; background:#fff; }
  .lw-ml-tr .pane.trans { overflow:auto; padding:4px 16px 16px; }
  .lw-ml-tr .pane.trans .p { padding:9px 0; border-bottom:1px solid ${T.lineDim}; color:${T.text};
    font-size:12.5px; line-height:1.85; white-space:pre-wrap; word-break:break-word; }
  .lw-ml-tr .pane.trans .p:last-child { border-bottom:0; }
  .lw-ml-tr .pane.trans .pending { color:${T.faint}; }
  .lw-btn.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; }
  `;

  const NAV = [
    { id: 'today', icon: '☀', label: '今日', grp: '面板', key: 'T-01' },
    { id: 'memo', icon: '✎', label: '备忘录', grp: '面板', key: 'M-01', badge: true },
    { id: 'journal', icon: '◈', label: '日记', grp: '面板', key: 'J-01' },
    { id: 'quote', icon: '❝', label: '书签', grp: '面板', key: 'B-01' },
    { id: 'tracks', icon: '◇', label: '研究方向', grp: '科研', key: 'F-01' },
    { id: 'files', icon: '▦', label: '文件', grp: '科研', key: 'C-01' },
    { id: 'reading', icon: '📖', label: '阅读', grp: '外部', key: 'R-01' },
    { id: 'flow', icon: '⚙', label: '工作流', grp: '自动化', key: 'W-01' },
    { id: 'trends', icon: '🔥', label: '热榜', grp: '外部', key: 'H-01' },
    { id: 'mail', icon: '✉', label: '邮箱', grp: '外部', key: 'E-01' },
  ];

  /* ★★★ 哪些页签是「全高面板」（要真正填满内容区 ✓），哪些是「长列表」（撑高页面让它滚 ✓）
     —— 见 CSS 里 `.lw-main.fill` 那一段的注释 ✓。
     ⚠️ 只有这三个 ✗ —— 今日 / 书签 / 研究方向 / 文件是长列表 ✓，
        给它们加 flex:1 反而会把内容裁掉 ✗。 */
  /* ── 工作流模块 ✓ ────────────────────────────────────────────────────────
     节点目录（参考 n8n 的节点模型 ✓）：in = 入端口数，out = 出端口数，
     cfg = 配置字段 [key, 标签, 类型, 默认值, 提示]。
     ★ 输出类节点**不在这里落地** ✗ —— 引擎只回 effects ✓，由前端应用 ✓。 */
  /* ★★ 每个节点都要**自己说清自己是干什么的** ✗ —— 用户原话：
     「你得告诉我怎么样，每个节点的作用，提示怎么用等等」。
     → 每个节点补三个字段 ✓：
       `d`   一句话「作用」  ✓（节点库第二行 / 属性栏标题下 / 说明面板 ✓ 三处都显示 ✓）
       `how` 「怎么用 / 要注意什么」✓（说明面板 + 悬停提示 ✓）
       `o`   「输出什么」✓ —— **下游 {{...}} 要引用的字段名** ✓（这个不写清就只能瞎猜 ✗）
     ⚠️ 这三段是**直接塞进 HTML** 的 ✗（不 esc ✗），所以里面只能写 `&lt;b&gt;` 这类标签 ✓，
        不能写 markdown 星号 ✗（面板不渲染 markdown ✗，会原样显示星号 ✗）。 */
  const FLOW_NODES = {
    /* ── 触发：每个工作流必须从**恰好一个**触发节点开始 ✓ ── */
    'trigger.manual': {
      e: '▶', n: '手动触发', g: '触发', in: 0, out: 1, cfg: [],
      d: '工作流的起点 —— 你点「▶ 运行」时才跑。',
      how: '调试阶段用这个。它自己不干活，只负责「把流程点着」。',
      o: 'at、fired —— 它只负责「把流程点着」，一般用不到',
    },
    'trigger.timer': {
      e: '⏰', n: '定时触发', g: '触发', in: 0, out: 1,
      cfg: [['every', '间隔（分钟）', 'number', 60, '到点自动跑（先把图搭好，定时在服务端排期）']],
      d: '每隔 N 分钟自动跑一次。',
      how: '<b>目前只存了配置，服务端还没真正排期</b> —— 现在仍然要点「▶ 运行」才跑。先把图搭好，等排期做出来它就直接生效。',
      o: 'at、fired —— 它只负责「把流程点着」，一般用不到',
    },
    'trigger.webhook': {
      e: '🔗', n: 'Webhook', g: '触发', in: 0, out: 1,
      cfg: [['path', '路径', 'text', '', '外部调用 /api/life/flow/hook/你的路径 就能触发']],
      d: '外部系统发一条 HTTP 请求就能把它点着。',
      how: '填个短路径（例如 daily），之后任何东西只要 POST /api/life/flow/hook/daily 就触发。',
      o: 'at、fired —— 它只负责「把流程点着」，一般用不到',
    },
    /* ── 数据：拿数据 / 拼文字 / 取值 ✓ ── */
    'http.request': {
      e: '🌐', n: 'HTTP 请求', g: '数据', in: 1, out: 1,
      cfg: [['url', 'URL', 'text', '', '支持 {{变量}} 插值；响应体自动解析成 JSON'], ['method', '方法', 'select', 'GET', 'GET / POST / PUT / DELETE'], ['body', '请求体', 'area', '', '仅 POST / PUT 时发送']],
      d: '去网上要一份数据回来。',
      how: 'URL 里可以插变量（例如 ...?q={{n1}}）。响应体会<b>自动试着</b>解析成 JSON —— 解析不了也不算失败，纯文本接口照样能用。',
      o: 'status、ok、body、json —— 比如取第一条标题写 {{id.json.data.list[0].title}}',
    },
    'data.template': {
      e: '✎', n: '文本模板', g: '数据', in: 1, out: 1,
      cfg: [['text', '模板', 'area', '', '用 {{节点id}} / {{节点id.字段}} / {{input}} 引用']],
      d: '把上游的结果拼成一段文字。',
      how: '写死的文字 + {{引用}} 混着写。想把几个节点结果拼成一封邮件正文，就用它。',
      o: '拼好的那段文字 —— 下游直接写 {{id}} 就能用',
    },
    'data.json': {
      e: '{ }', n: 'JSON 取值', g: '数据', in: 1, out: 1,
      cfg: [['path', '路径', 'text', '', '如 data.list[0].title；留空则返回整个对象']],
      d: '从上游的 JSON 里按路径挖出一个字段。',
      how: '前面接 HTTP 时，路径<b>直接从 data 开始写</b>（不用写 json.data）；想整段丢给 AI 就留空。',
      o: '挖出来的那个值 —— 下游直接写 {{id}} 就能用',
    },
    /* ── 逻辑：分叉与合流 ✓ ── */
    'logic.if': {
      e: '⑂', n: '条件分支', g: '逻辑', in: 1, out: 2,
      cfg: [['left', '左值', 'text', '', ''], ['op', '比较', 'select', '包含', '包含 / 等于 / 不等于 / 大于 / 小于 / 为空 / 非空 / 正则匹配'], ['right', '右值', 'text', '', '']],
      d: '判断一下，然后走「成立」或「不成立」两条路中的一条。',
      how: '它右边有<b>两个</b>圆点：上面＝成立，下面＝不成立。没走的那条路，下游节点会显示「跳过」（灰掉是正常的，不是坏了）。',
      o: 'ok、left、right —— 它只负责分岔，一般用不到',
    },
    'logic.merge': {
      e: '⋈', n: '合并', g: '逻辑', in: 2, out: 1, cfg: [],
      d: '把分开的两条路重新并回一条。',
      how: '接在条件分支的两条路后面。不管哪条走通了，都从这里继续往下 —— 省得后面的事写两遍。',
      o: '上游传进来的东西，原样透传',
    },
    /* ── AI：复用 CodeScope 里配好的模型 ✓ ── */
    'ai.chat': {
      e: '🤖', n: 'AI 对话', g: 'AI', in: 1, out: 1,
      cfg: [['system', '系统提示', 'area', '', '定角色 / 定语气 / 定输出格式；留空则只有用户提示'], ['prompt', '用户提示', 'area', '', '把数据塞进去，例如「总结下面内容：{{n3}}」']],
      d: '把上游的内容交给大模型，换回一段回答。',
      how: '复用 CodeScope 里已经配好的模型（不用在这里再填一遍 key）。<b>系统提示</b>写「你是谁、怎么输出」，<b>用户提示</b>里用 {{}} 把数据塞进去。',
      o: 'text（模型的回答）—— 引用要写 {{id.text}}',
    },
    /* ── 工具 ── */
    'util.delay': {
      e: '⏳', n: '等待', g: '工具', in: 1, out: 1,
      cfg: [['ms', '毫秒', 'number', 1000, '上限 30 秒']],
      d: '停一会儿再往下走。',
      how: '单位是毫秒，最多 30 秒。用来给接口留反应时间，或者别把人家 API 打太频。',
      o: 'waited（等了多久）—— 一般用不到',
    },
    /* ── 输出：引擎只排队 ✓，跑完由前端真正落地 ✓ ── */
    'out.memo': {
      e: '📝', n: '写入备忘录', g: '输出', in: 1, out: 1,
      cfg: [['folder', '文件夹', 'text', '工作流', '不存在会自动建 ✓'], ['title', '标题', 'text', '工作流产出', ''], ['text', '正文', 'area', '', '']],
      d: '在备忘录里新建一条。',
      how: '文件夹不存在会自动建。标题和正文都支持 {{}}。⚠️ <b>跑一次加一条</b>，跑三次就是三条（不覆盖）。',
      o: 'queued（只表示「已经排队去写了」，一般用不到）',
    },
    'out.journal': {
      e: '◈', n: '追加日记', g: '输出', in: 1, out: 1,
      cfg: [['text', '内容', 'area', '', '追加到今天的日记末尾 ✓']],
      d: '把内容追加到<b>今天</b>的日记末尾。',
      how: '今天已经有日记就接着写，没有就新建今天的。适合「每天自动记一笔」。',
      o: 'queued（只表示「已经排队去写了」，一般用不到）',
    },
    'out.notify': {
      e: '🔔', n: '通知', g: '输出', in: 1, out: 1,
      cfg: [['text', '内容', 'area', '', '显示在面板顶栏状态条 ✓']],
      d: '在面板顶栏弹一条提示。',
      how: '跑完不留痕。适合「跑完了」「有新东西了」这种即时提醒；要留档就用备忘录 / 日记。',
      o: 'queued（只表示「已经排队去写了」，一般用不到）',
    },
    'out.mail': {
      e: '✉', n: '发邮件', g: '输出', in: 1, out: 1,
      cfg: [['to', '收件人', 'text', '', '用第一个已配置的邮箱账号发 ✓'], ['subject', '主题', 'text', '', '支持 {{}} ✓'], ['body', '正文', 'area', '', '支持 {{}} ✓']],
      d: '用你已经配好的邮箱，把内容发出去。',
      how: '用<b>第一个</b>已配置的邮箱账号发。没配邮箱时会明确报错（不会静默失败）。',
      o: 'queued（只表示「已经排队去发了」，一般用不到）',
    },
  };
  const FLOW_GROUPS = ['触发', '数据', '逻辑', 'AI', '工具', '输出'];
  const FLOW_W = 170, FLOW_H = 56;
  const FLOW_UI = { sel: '', node: '', arm: '', steps: null, err: '', busy: false, help: false };

  /* ── 热榜模块的状态 ✓（同样必须放顶部区 ✗）────────────────────────────
     源目录来自服务端 ✓（`/api/life/trends` 会带回来 ✓），这里只放界面状态 ✓。 */
  const TR_UI = { src: '', q: '', only: 'all', sel: '', busy: false, ai: '', aiBusy: false, data: null, err: '', at: 0 };
  const TR_GROUPS = ['视频', '社交', '搜索', '技术', '开源', '学术', '资讯'];

  /* ── 顶栏格言：**固定间隔自动切换** ✓ ────────────────────────────────────
     用户原话：「不需要加一个换一句按钮，让他隔固定时间，自动切换」。
     ★ 序号只放**内存** ✗（`QUOTE_IDX` ✓）—— 自动轮播**不落盘** ✗：
       落盘的话每次切换都写一次 STORE ✗（20 秒一次，纯浪费 ✗），
       而且会盖掉「当天种子」✗。
     ★ 起点的「当天种子」还是从 `STORE.dailyQuote` 读 ✓ ——
       同一天第一次打开是同一句 ✓，不同天起点不同 ✓。 */
  let QUOTE_TIMER = 0;
  let QUOTE_IDX = null;
  const QUOTE_EVERY_MS = 20000;

  /* 阅读模块的状态 ✓ —— 同样必须放这里 ✗（`mount()` 在模块最顶上就被调用了 ✓）。 */
  const RD_SRC = {
    weread: { e: '📗', n: '微信读书' }, paper: { e: '📖', n: '纸质书' },
    kindle: { e: '📕', n: 'Kindle' }, other: { e: '📚', n: '其他' },
  };
  const RD_ST = {
    want: { e: '🌱', n: '想读' }, reading: { e: '📖', n: '在读' },
    done: { e: '✅', n: '读完' }, paused: { e: '⏸', n: '搁置' },
  };
  const RD_ST_ORDER = ['reading', 'want', 'done', 'paused'];
  const RD_UI = {
    status: 'all', src: 'all', tag: '', q: '', sel: '',
    impOpen: false, impText: '', impPv: null, noteKind: 'quote', noteText: '',
    /* ★ 微信读书「连接」面板的状态 ✓ —— 用户原话：
       「这个没有接入微信读书，可以实现读取微信读书里面的书」。
       ⚠️ 这些都只放**内存** ✗ —— Cookie 本身落盘（STORE.wereadCookie ✓），
          但「面板开没开 / 正在连 / 上一句提示」刷新就重置 ✓（不该留 ✓）。 */
    connOpen: false, connText: '', connBusy: false, connMsg: '', connOk: false,
    autoAt: 0,
  };

  /* ── 外刊精读 / 生词本的状态 ✓（阅读模块的两个子模式 ✓）──────────────────
     用户原话：「还需要加入外刊精读，用于阅读和学习英语，你来设计，
     该有的单词记忆，管理等等，都需要有，可以参考网上成熟的体系，
     包括什么遗忘曲线等等，记得加入语音读法等」。

     ⚠️ 这些**必须**声明在模块顶部 ✗（`mount()` 在模块最顶上就被调用了 ✓）。
     ⚠️ 只放**界面状态** ✓ —— 文章 / 生词本身落 STORE ✓（`STORE.articles` / `STORE.words` ✓）。 */
  const EP_LEVELS = ['A2', 'B1', 'B2', 'C1'];
  const EP_PRESET = ['The Economist', 'The Guardian', 'BBC', 'NPR', 'The New York Times',
    'The Atlantic', 'The Conversation', 'Aeon', 'Science', '其他'];
  const EP_UI = {
    mode: '',                    /* '' = 书架 ✓ / 'ex' = 外刊精读 ✓ / 'word' = 生词本 ✓ */
    art: '',                     /* 当前文章 id ✓ */
    q: '',                       /* 文章搜索 ✓ */
    sel: -1,                     /* 当前选中的**句子序号** ✓ */
    pick: '',                    /* 划词划中的那个词 ✓ */
    impOpen: false, impTab: 'url', impUrl: '', impBusy: false, impMsg: '',
    impTitle: '', impSite: '', impText: '', impLevel: '',
    wordQ: '', wordFilter: 'all', wordSel: '', wordNew: '', wordPh: '', wordDef: '', wordEg: '',
    revOpen: false, revQ: [], revI: 0, revShown: false, revDone: 0, revOK: 0,
    artNote: '',
  };
  /* 朗读 ✓（Web Speech API ✓）—— 只放内存 ✗，语速 / 音色落 STORE ✓ */
  const SPK = { voices: [], loaded: false, listening: false, seq: 0, speaking: false };
  /* ★★ 共享的纯逻辑模块 ✓（双栖的 ✓，见 lib/en-text.js 和 lib/srs.js 末尾 ✓）——
     它们由 index.html 在 life-workbench.js **之前**加载 ✓（都是 defer ✓，按顺序执行 ✓）。
     ⚠️ 万一没加载上（缓存 / 404 ✗），**不能整个模块崩掉** ✗ ——
        下面所有用到的地方都要判空 ✓，并给一句「说明为什么用不了」✓。 */
  const EN = (typeof window !== 'undefined' && window.LW_EN_TEXT) || null;
  const SRS = (typeof window !== 'undefined' && window.LW_SRS) || null;
  /* 分句结果缓存 ✓（按文章 id + 正文长度当 key ✓）—— 每次渲染都重切一遍纯属浪费 ✗。
     ⚠️ 不落盘 ✗：正文一变（重新导入 ✓）长度就变了 ✓，key 自动失效 ✓。 */
  const EP_SENTS = new Map();

  const LW_FILL_TAB = { memo: 1, journal: 1, mail: 1, reading: 1, flow: 1, trends: 1 };

  /* ── 顶栏状态条：时钟 / 问候 / 心情 / 每日格言 ✓ ─────────────────────────
     ⚠️ 这些**必须声明在模块顶部** ✗ —— `headHtml()` 在 `mount()` 的调用链上就会碰到 ✓
        （见上面那段 TDZ 的说明 ✗）。 */
  let CLOCK_TIMER = 0;          /* 秒针定时器（**单例** ✗ —— 每次 bind 前先清 ✓，不然会越挂越多 ✗）*/
  let MOOD_OPEN = false;        /* 心情浮层开着吗 ✓ */
  let MOOD_AWAY = null;         /* 浮层「点别处关掉」的监听器 ✓（重绑前必须摘掉 ✗，不然会叠加 ✗）*/
  /* 心情备选 —— 12 个，4 列 3 行 ✓（emoji 直接用系统字体，不引外部资源 ✓）*/
  const MOODS = [
    { e: '😄', n: '很好' }, { e: '🙂', n: '还行' }, { e: '😌', n: '平静' }, { e: '🤩', n: '兴奋' },
    { e: '🔥', n: '专注' }, { e: '🌱', n: '慢慢来' }, { e: '🎯', n: '有目标' }, { e: '☕', n: '放空' },
    { e: '😐', n: '一般' }, { e: '🥱', n: '有点累' }, { e: '😔', n: '低落' }, { e: '😤', n: '有点烦' },
  ];
  /* 格言的兜底池 ✓ —— 用户自己的「好词好句」为空时才用它 ✓（优先用他自己的 ✓，那才最贴 ✓）*/
  const QUOTE_POOL = [
    { text: '一个人只有用心去看，才能看到真实。', from: '《小王子》' },
    { text: '我们所有的昨天，不过是个序幕。', from: '《麦克白》' },
    { text: '慢慢来，比较快。', from: '民谚' },
    { text: '怕什么真理无穷，进一寸有一寸的欢喜。', from: '胡适' },
    { text: '生活是种律动，须有光有影，有左有右，有晴有雨。', from: '老舍' },
    { text: '重要的东西用眼睛是看不见的。', from: '《小王子》' },
    { text: '凡是过往，皆为序章。', from: '莎士比亚' },
    { text: '你只需努力，剩下的交给时间。', from: '佚名' },
    { text: '知不可乎骤得，托遗响于悲风。', from: '苏轼《赤壁赋》' },
    { text: '不积跬步，无以至千里。', from: '《荀子》' },
    { text: '人生如逆旅，我亦是行人。', from: '苏轼' },
    { text: '把每一件小事做好，就是了不起。', from: '佚名' },
    { text: '心安即是归处。', from: '苏轼' },
    { text: '所有的坚持，都是因为热爱。', from: '佚名' },
  ];
  /* 线性图标 ✓ —— 统一 16 视窗、stroke 描边、currentColor 跟随主题色 ✓。
     比 emoji 稳 ✗（emoji 在各平台字形差异大、大小不一、还不跟随主题色 ✗）。 */
  const ICON = {
    clock: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/>',
    mood: '<circle cx="8" cy="8" r="6.2"/><path d="M5.7 9.5c.6.8 1.4 1.2 2.3 1.2s1.7-.4 2.3-1.2"/><path d="M6.1 6.4h.02M9.9 6.4h.02"/>',
    quote: '<path d="M3.4 4.6h3.8v3.8H5.4c0 1.5-.6 2.4-1.9 3"/><path d="M8.8 4.6h3.8v3.8h-1.8c0 1.5-.6 2.4-1.9 3"/>',
    check: '<path d="M3.2 8.4l3.1 3.1L12.8 5"/>',
    fire: '<path d="M8 2.6c2.3 2.3 3.5 3.9 3.5 5.4a3.5 3.5 0 1 1-7 0c0-1.5 1.2-3.1 3.5-5.4z"/>',
    cal: '<rect x="2.6" y="3.8" width="10.8" height="9.6" rx="1.2"/><path d="M2.6 6.8h10.8M5.8 2.6v2.4M10.2 2.6v2.4"/>',
    list: '<path d="M5.8 4.4h7.6M5.8 8h7.6M5.8 11.6h7.6"/><path d="M2.8 4.4h.02M2.8 8h.02M2.8 11.6h.02"/>',
    chart: '<path d="M2.6 13.2V9.8M6.2 13.2V6.4M9.8 13.2V8.2M13.4 13.2V3.6"/>',
  };
  function svgIcon(name, size) {
    const p = ICON[name];
    if (!p) return '';
    const s = size || 15;
    return '<svg class="ic" viewBox="0 0 16 16" width="' + s + '" height="' + s + '" fill="none"'
      + ' stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'
      + ' aria-hidden="true">' + p + '</svg>';
  }

  let DATA = null, STORE = null, WX = null, TAB = 'today', LOADING = false, MOUNT_TIMER = 0, CITY = '广州';
  /* ★ 日记「未落盘内容」的提交钩子（模块级，跨 render 存在 ✓）
     为什么放模块级而不是 bind() 里：面板关闭 / 页面隐藏时 bind() 的闭包已经拿不到 DOM 了 ✗，
     但 `visibilitychange` 还得能调它 ✓。bind() 每次 render 都会把它重置成空函数 ✓，
     只有真的挂上了日记编辑框（`if (ce)`）才会变成真正的实现 ✓ → 不在日记页调用它是安全的 no-op ✓。 */
  let JOURNAL_FLUSH = () => { };
  let FLUSH_HOOKS_ON = false;
  /* ★ 编辑器**当前正在显示哪一条**备忘录的 id ✓（由 viewMemo() 每次渲染时写下）
     为什么需要：`curMemo()` 在 `memoSel` 为空时会回落到 `STORE.memos[0]` ✗ ——
     如果编辑器 DOM 里还停在上一条（筛选后没重建编辑器），一打字就会把
     **界面上的内容写进另一条备忘录** ✗✗（真数据损坏，不是显示问题）。
     写盘前比对一下这个 id，不一致就拒绝写 ✓（见 writeMemo / refreshMemoDerived）。 */
  let MEMO_EDITOR_ID = '';
  /* ── 邮箱收信界面状态（放模块级 ✓ 才能在 render() 之间存活）────────────
     ⚠️ 不能存在函数局部 ✗ —— render() 会重建整个 DOM，
        存局部的话每渲染一次就丢一次（列表/正文全部重新请求，界面一直闪 ✗）。 */
  const MAIL_UI = {
    key: '', box: 'INBOX', unreadOnly: false, importantOnly: false, q: '',
    /* ★ 分批加载 ✓ —— 一次取 40 封头部在 QQ 上要 0.4~2.1 秒 ✗（服务端**每封**都要处理），
       先取 15 封，点「加载更多」每次 +15 ✓ */
    limit: 15,
    boxes: null, boxesErr: '', boxesLoading: false,
    list: null, listErr: '', listLoading: false,
    uid: 0, msg: null, msgErr: '', msgLoading: false,
    cfgOpen: false, showImages: false,
    /* 在途去重用：记「正在拉的是哪个 (账号,文件夹)」✓（见 mailLoadList 的注释）*/
    _loadingKey: '', _loadingBox: '',
    /* 对照翻译的状态（每封邮件一份）✓ */
    tr: null, trBusy: false,
  };
  let MAIL_STATUS = null;          /* 顶栏用：{ total, accounts:[…] } */
  let MAIL_STATUS_BUSY = false;
  let MAIL_STATUS_TIMER = 0;

  /* ★★ 邮箱的其余状态**必须声明在这里（模块顶部）** ✗ ——
     `mount()` 是在模块**最顶上**就被调用的（`document.readyState` 那几行），
     它会一路走到 `bootstrapMailNotify()` ✓；如果这些 `let` / `const` 还写在文件后面，
     那时它们还在**暂时性死区（TDZ）**里 ✗ → 抛
     `Cannot access 'MAIL_BOOTSTRAPPED' before initialization` ✗，
     整个自举静默失败（提醒功能完全不生效 ✗，实测踩过）。
     **凡是 `mount()` 调用链上碰得到的模块状态，都要放在这里。** */
  /* 开机自举拿到的账号/开关放**独立变量**里，**不能塞进 STORE** ✗ ——
     `saveStore()` 是把整个 STORE POST 上去的，STORE 里只放了一部分字段的话
     一次保存就把用户的备忘录/日记全冲掉 ✗✗（这类覆盖事故之前踩过一次）。 */
  const MAIL_BOOT = { acc: null, notify: undefined };
  let MAIL_BOOTSTRAPPED = false;
  let MAIL_SEEN_TOTAL = null;
  let MAIL_TOAST_TIMER = 0;
  let MAIL_FRESH_TIMER = 0;
  let MAIL_VIS_HOOK = false;
  /* ★ 顶部状态栏（`#lw-sub`）的状态 —— 必须放这里 ✗（见上面的 TDZ 说明）：
     `render()` 末尾要调 `paintStatus()` ✓，而 `render()` 有可能在模块求值期间被碰到 ✓。
     消息记在模块作用域 → 整屏 render() 之后能重画 ✓（`#lw-sub` 每次 render 都会被重建 ✗）。 */
  let STATUS_HTML = '', STATUS_UNTIL = 0, STATUS_UNDO = null;
  let MAIL_MOVE_BUSY = '';      /* 同一个移动在途时去重 ✓（拖放监听器曾重复挂载 ✗） */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtBytes(n) {
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = Number(n) || 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  /* 迷你 Markdown 渲染：标题 / 粗体 / 斜体 / 行内码 / 代码块 / 引用 / 列表 / 复选框 / 表格 / 链接 / 分隔线 / #标签 */
  function mdToHtml(src) {
    const lines = String(src == null ? '' : src).split('\n');
    let out = '', inCode = false, inList = '', inTable = false;
    const inline = (t) => esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/#([\u4e00-\u9fa5\w/-]+)/g, '<span class="tag">#$1</span>');
    const closeList = () => { if (inList) { out += '</' + inList + '>'; inList = ''; } };
    const closeTable = () => { if (inTable) { out += '</tbody></table>'; inTable = false; } };
    for (let i = 0; i < lines.length; i++) {
      const l = String(lines[i]).replace(/\s+$/, '');
      if (/^\s*```/.test(l)) { closeList(); closeTable(); out += inCode ? '</code></pre>' : '<pre><code>'; inCode = !inCode; continue; }
      if (inCode) { out += esc(l) + '\n'; continue; }
      /* 表格：`| a | b |` + `| --- | --- |` */
      if (/^\s*\|.*\|\s*$/.test(l)) {
        const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
        const next = String(lines[i + 1] || '');
        if (!inTable && /^\s*\|[\s:|-]+\|\s*$/.test(next)) {
          closeList();
          out += '<table><thead><tr>' + cells.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
          inTable = true; i++; continue;
        }
        if (inTable) { out += '<tr>' + cells.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>'; continue; }
      } else { closeTable(); }
      const h = l.match(/^(#{1,3})\s+(.*)$/);
      if (h) { closeList(); out += '<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'; continue; }
      /* 复选框清单 - [ ] / - [x] */
      const ck = l.match(/^\s*[-*+]\s*\[([ xX])\]\s*(.*)$/);
      if (ck) {
        if (inList !== 'ul') { closeList(); out += '<ul>'; inList = 'ul'; }
        const done = ck[1].toLowerCase() === 'x';
        out += '<li class="mdck' + (done ? ' done' : '') + '">' + inline(ck[2]) + '</li>'; continue;
      }
      if (/^\s*[-*+]\s+/.test(l)) {
        if (inList !== 'ul') { closeList(); out += '<ul>'; inList = 'ul'; }
        out += '<li>' + inline(l.replace(/^\s*[-*+]\s+/, '')) + '</li>'; continue;
      }
      if (/^\s*\d+[.)]\s+/.test(l)) {
        if (inList !== 'ol') { closeList(); out += '<ol>'; inList = 'ol'; }
        out += '<li>' + inline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; continue;
      }
      if (/^\s*>\s?/.test(l)) { closeList(); out += '<blockquote>' + inline(l.replace(/^\s*>\s?/, '')) + '</blockquote>'; continue; }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { closeList(); out += '<hr>'; continue; }
      if (!l.trim()) { closeList(); continue; }
      closeList();
      out += '<p>' + inline(l) + '</p>';
    }
    closeList(); closeTable();
    if (inCode) out += '</code></pre>';
    return out;
  }

  function ago(ms) {
    if (!ms) return '—';
    const d = Date.now() - ms, m = 60000, h = 3600000, day = 86400000;
    if (d < m) return '刚刚';
    if (d < h) return Math.floor(d / m) + ' 分前';
    if (d < day) return Math.floor(d / h) + ' 小时前';
    if (d < day * 30) return Math.floor(d / day) + ' 天前';
    return new Date(ms).toISOString().slice(0, 10);
  }
  function spark(vals, w, h, color) {
    const W = w || 96, H = h || 26, C = color || T.accent;
    const n = Math.max(2, (vals || []).length), max = Math.max(1, ...(vals || [0]));
    const pts = (vals || []).map((v, i) => [(i / (n - 1)) * W, H - (v / max) * (H - 5) - 2]);
    if (!pts.length) return '';
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block">
      <path d="${d} L${W},${H} L0,${H} Z" fill="${C}" opacity=".14"/>
      <path d="${d}" fill="none" stroke="${C}" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
  }
  /* 天气代码 → 图标 + 中文 */
  function wx(code) {
    const c = Number(code);
    if (c === 0) return ['☀️', '晴'];
    if (c <= 2) return ['🌤', '多云'];
    if (c === 3) return ['☁️', '阴'];
    if (c <= 48) return ['🌫', '雾'];
    if (c <= 57) return ['🌦', '毛毛雨'];
    if (c <= 67) return ['🌧', '雨'];
    if (c <= 77) return ['🌨', '雪'];
    if (c <= 82) return ['🌧', '阵雨'];
    if (c <= 86) return ['🌨', '阵雪'];
    return ['⛈', '雷雨'];
  }

  window.LifeWorkbench = { open: openInPanel, close: hidePanelView, refresh: () => load(true) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* ── 挂载：在**顶部标签栏**加一个「个人管理面板」（不再塞进本机管家的侧栏 ✗）──
     做法照 system-panel.js：按钮挂在 #header-center，插在「知识库」之前。 */
  function mount() {
    if (MOUNT_TIMER) return;
    /* ★ 一次性挂「离开前提交」监听 ✓（用 FLUSH_HOOKS_ON 防止 mount 重入时重复挂 ✗）
       为什么需要：日记编辑框的自动保存是 600ms 防抖 ✗，
       用户敲完字**立刻**关面板 / 切到别的浏览器标签 → 防抖还没跑 → 这次编辑就丢了 ✗。
       pagehide / visibilitychange 是浏览器**保证**会触发（比 beforeunload 可靠 ✓）。 */
    if (!FLUSH_HOOKS_ON) {
      FLUSH_HOOKS_ON = true;
      const commit = () => { try { JOURNAL_FLUSH(); } catch (_) { } };
      window.addEventListener('pagehide', commit);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') commit(); });
    }
    if (!document.getElementById('lifework-style')) {
      const st = document.createElement('style');
      st.id = 'lifework-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    /* ⚠️ 挂载要快 ✗ —— 原来用 setInterval(600ms) 轮询 ✗，
       按钮最多要等 **600ms** 才出现 ✗ → 用户感觉"这个按钮加载比其他慢" ✗。
       改法：① 立刻试一次 ✓ ② 间隔缩到 100ms ✓ ③ **挂上就停掉定时器** ✓（不再空转 ✗）。 */
    const tryMount = () => {
      const bar = document.getElementById('header-center');
      if (!bar) return false;
      if (document.getElementById('btn-lifework')) {
        clearInterval(MOUNT_TIMER); MOUNT_TIMER = 0;
        /* ★ 自举放在**这里**而不是 mount() 的调用处 ✗ ——
           按钮经常是稍后由定时器 / MutationObserver 挂上的（首次进来时 #header-center 还没出来），
           放在调用处的话那条路径不会触发 → 提醒功能整个不生效 ✗（实测踩过）。 */
        bootstrapMailNotify();
        return true;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btn-lifework';
      btn.className = 'header-action';
      btn.textContent = '个人管理面板';
      btn.title = '个人管理面板：今日 / 备忘录 / 日记 / 书签 / 研究方向 / 文件 / 邮箱';
      btn.setAttribute('aria-pressed', 'false');
      const anchor = document.getElementById('knowledge-launch') || document.getElementById('btn-system');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
      else bar.appendChild(btn);
      btn.addEventListener('click', () => {
        if (document.getElementById('lifework-view')) hidePanelView();
        else openInPanel();
      });
      clearInterval(MOUNT_TIMER); MOUNT_TIMER = 0;
      bootstrapMailNotify();
      return true;
    };
    if (tryMount()) return;
    MOUNT_TIMER = setInterval(tryMount, 100);
    /* 兜底：DOM 一变就试 ✓（比死等定时器更快 ✓）*/
    try {
      new MutationObserver(() => { if (MOUNT_TIMER && tryMount()) { /* 挂上就自动停了 ✓ */ } })
        .observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  /* 打开：铺满主区域（在顶栏之下），并高亮顶部标签 */
  function openInPanel() {
    mount();
    if (!document.getElementById('lifework-view')) {
      const view = document.createElement('div');
      view.id = 'lifework-view';
      view.className = 'lw-inpanel';
      document.body.appendChild(view);
    }
    const btn = document.getElementById('btn-lifework');
    if (btn) { btn.setAttribute('aria-pressed', 'true'); btn.classList.add('on'); }
    /* ⚠️ 立刻先画一次（骨架屏）—— 不能等数据回来才渲染 ✗，
       否则打开面板会有一段**纯黑** ✗，看起来就是"启动很慢"。 */
    render();
    if (!DATA) load(false);
    /* ★ 邮箱账号要在**打开面板时**就读回来 ✓ —— 不能等用户点进邮箱页 ✗，
       否则顶栏那个「新邮件」胶囊一直显示「未配置」（账号明明配了）✗。
       读完账号再拉未读数（未读数要账号就绪才能查 ✓）。 */
    loadMailAccounts();
    /* 页脚要显示「面板资源」的构建时间：拿到后补渲染一次 ✓（只发生一次）*/
    if (!BUILD_STAMP) ensureBuildStamp().then((stamp) => { if (stamp) render(); });
    /* ★ 打开之后要**盯着别人**：别的「工作区」一开，本面板就让位 ✓（见 watchAway 的注释 ✓）*/
    watchAway();
  }

  /* 关闭：撤掉视图，顶部标签恢复 */
  function hidePanelView() {
    /* ★ 关面板 = 整个 DOM 被 remove ✓ → 日记编辑框里没防抖落盘的字会**直接消失** ✗
       （用户报的"改分类丢内容"是同一类问题：render 重建 DOM 把未落盘的字冲掉 ✗）
       → 先提交，再删 ✓ */
    try { JOURNAL_FLUSH(); } catch (_) { }
    /* 秒针也要停 ✗ —— 面板都没了，还每秒空转一个定时器没意义 ✗
       （`tick` 里也有「元素没了就自己停」的兜底 ✓，这里显式停更干净 ✓）。 */
    if (CLOCK_TIMER) { clearInterval(CLOCK_TIMER); CLOCK_TIMER = 0; }
    if (QUOTE_TIMER) { clearInterval(QUOTE_TIMER); QUOTE_TIMER = 0; }
    if (MOOD_AWAY) { document.removeEventListener('mousedown', MOOD_AWAY, true); MOOD_AWAY = null; }
    MOOD_OPEN = false;
    stopWatchAway();
    const view = document.getElementById('lifework-view');
    if (view) view.remove();
    const btn = document.getElementById('btn-lifework');
    if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('on'); }
  }

  /* ★★★ 打开别的「工作区」时，个人管理面板要**自动让位** ✗✗ ——
     用户原话：「打开个人管理面板，我点击其他例如 harness，打开 DSH，
     会被个人管理面板覆盖，切换不过去」。

     **根因**：本面板是**独立的全屏浮层** ✗（`#lifework-view.lw-inpanel`，z-index 8800 ✗），
     而应用里其它工作区是靠 `body` 上的 `xxx-mode` class **互相让位**的 ✓
     （`openDsh` 会先 `remove('study-mode','office-mode',…)` 再 `add('dsh-mode')` ✓，
      `openVSCode` / `openOpencode` / `openKnowledgeWorkspace` 同理 ✓）——
     **本面板没参加这套** ✗ → 它一直盖在最上面 ✗ → DSH 明明开了却看不见 ✗。

     → 不去改 index.html 里那一堆 open 函数 ✗（改不全 ✗、以后新加工作区还会漏 ✗），
       改成**盯住 `body` 的 class** ✓：只要冒出一个**新的** `*-mode` ✓ 就自己让位 ✓。
       一处收口，以后新加的工作区**自动兼容** ✓。

     ⚠️ 「新的」很重要 ✗ —— 打开面板时如果**已经在**某个工作区里 ✓（比如先开了 DSH ✓），
        那个 class 是**旧**的 ✓，不能再触发一次让位 ✗，
        否则面板刚开就被自己关掉 ✗。所以先快照一份 ✓，只认「新出现的」✗。

     另加一条：**点顶栏上别的按钮也让位** ✓ ——
     有些入口（下拉菜单之类 ✗）不一定加 mode class ✗，光盯 class 会漏 ✗。 */
  let LW_AWAY_OBS = null, LW_AWAY_CLICK = null, LW_AWAY_SEEN = null;
  function lwModeSet() {
    const m = String(document.body.className || '').match(/(?:^|\s)([\w-]+-mode)(?=\s|$)/g) || [];
    return new Set(m.map((x) => x.trim()));
  }
  function watchAway() {
    stopWatchAway();
    LW_AWAY_SEEN = lwModeSet();                 /* 打开那一刻已经有的 → 不算「新开」✓ */
    try {
      LW_AWAY_OBS = new MutationObserver(() => {
        const now = lwModeSet();
        for (const m of now) if (!LW_AWAY_SEEN.has(m)) { hidePanelView(); return; }
      });
      LW_AWAY_OBS.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (_) { }
    LW_AWAY_CLICK = (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest('#btn-lifework')) return;    /* 本面板自己的开关 → 交给它 ✓ */
      if (t.closest('#lifework-view')) return;   /* 面板内部 → 不管 ✓ */
      if (t.closest('#header-center') || t.closest('.header-action')) hidePanelView();
    };
    document.addEventListener('click', LW_AWAY_CLICK, true);
  }
  function stopWatchAway() {
    if (LW_AWAY_OBS) { try { LW_AWAY_OBS.disconnect(); } catch (_) { } LW_AWAY_OBS = null; }
    if (LW_AWAY_CLICK) { document.removeEventListener('click', LW_AWAY_CLICK, true); LW_AWAY_CLICK = null; }
    LW_AWAY_SEEN = null;
  }

  async function load(force) {
    if (LOADING) return;
    LOADING = true;
    const s = document.getElementById('lw-sub');
    const j = async (u, opt) => { try { const r = await fetch(u, opt); return await r.json(); } catch (_) { return null; } };
    if (s) s.textContent = '正在读取本机数据…';
    /* ⚠️ 分批：先拿「本机数据 + 待办/笔记」，**立刻渲染** ✓；
       天气单独跑（要走外网、慢得多 ✗），回来了再补一次渲染 ✓。
       以前三个请求 Promise.all 一起等 ✗ —— 天气最慢，把整个面板卡住 ✗。 */
    const [idx, store] = await Promise.all([
      j('/api/life/index?depth=3' + (force ? '&fresh=1' : ''), { cache: 'no-store' }),
      j('/api/life/store', { cache: 'no-store' }),
    ]);
    if (idx && idx.ok) DATA = idx;
    STORE = (store && store.data) || {};
    if (STORE.city) CITY = STORE.city;
    LOADING = false;
    render();
    /* 天气：不阻塞界面，回来再刷一次 */
    j('/api/life/weather?city=' + encodeURIComponent(CITY), { cache: 'no-store' }).then((weather) => {
      if (weather && weather.ok) { WX = weather; render(); }
      else if (weather && weather.error && !WX) { WX = weather; render(); }
    });
  }

  /* ⚠️ 存盘要**合并**：以前每次操作都发一次 POST ✗，连打字都会连发 ✗。
     现在 300ms 防抖 + 只发最后一次 ✓（本地写文件，不怕丢 ✓）。 */
  let SAVE_TIMER = 0, SAVE_PENDING = false;
  function saveStore(now) {
    if (now) {
      clearTimeout(SAVE_TIMER);
      SAVE_PENDING = false;
      fetch('/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(STORE || {}) }).catch(() => {});
      return;
    }
    SAVE_PENDING = true;
    clearTimeout(SAVE_TIMER);
    SAVE_TIMER = setTimeout(() => {
      SAVE_PENDING = false;
      fetch('/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(STORE || {}) }).catch(() => {});
    }, 300);
  }

  /* ── 撤销 / 重做（备忘录）──────────────────────────────────────────────
     以前完全没有撤销 ✗：textarea 的原生 ⌘Z 只在「没重渲染过」时有效，
     一点格式按钮 / 删除就把 textarea 整个换掉 → 原生撤销栈直接丢 ✗，
     删除、格式化、置顶这些操作更是完全没法回退 ✗（用户反馈「没有撤销功能」）。

     做法：**整份 memos 的快照栈**（深拷贝，几十条备忘录也就几十 KB）。
     优点是不用给每种操作单独写逆操作，删除 / 格式化 / 置顶 / 新建全都能撤 ✓。
     ⚠️ 连续打字必须合并成「一步」，否则每敲一个字都压一帧 ✗（见 snapMemo 的 label 判定）。 */
  let UNDO = [], REDO = [], UNDO_AT = 0, MEMO_STATUS_TIMER = 0;
  function snapshotMemos() {
    return {
      memos: JSON.parse(JSON.stringify((STORE && STORE.memos) || [])),
      sel: (STORE && STORE.memoSel) || '',
      editing: (STORE && STORE.memoEditing) || '',
    };
  }
  /* 在**改动之前**调用。kind==='edit' 且「上一次也是 edit」且距上次不足 900ms
     → 视为同一次连续输入，不重复压栈。
     ⚠️ 必须同时要求「上一次也是 edit」—— 只看时间的话，「新建后立刻打字」时
        这次 edit 会被**上一次的 new 吞掉** ✗，撤销就直接退回到「这条备忘录还不存在」，
        用户按 ⌘Z 想撤的是刚打的字，结果整条都没了 ✗（实测踩过）。 */
  function snapMemo(kind) {
    if (!STORE) return;
    const now = Date.now();
    const last = UNDO[UNDO.length - 1];
    if (kind === 'edit' && last && last.kind === 'edit' && now - UNDO_AT < 900) { UNDO_AT = now; return; }
    UNDO.push(Object.assign({ at: now, kind }, snapshotMemos()));
    if (UNDO.length > 80) UNDO.shift();
    REDO.length = 0;
    UNDO_AT = now;
    syncUndoButtons();
  }
  function canUndo() { return UNDO.length > 0; }
  function canRedo() { return REDO.length > 0; }
  /* 按钮的 disabled 只在 viewMemo() 里算，而打字时**不会**整屏渲染 ——
     不单独同步的话，刚打完字「撤销」还是灰的 ✗（点了没反应）。 */
  function syncUndoButtons() {
    const u = document.getElementById('lw-memo-undo');
    const r = document.getElementById('lw-memo-redo');
    if (u) u.disabled = !canUndo();
    if (r) r.disabled = !canRedo();
  }
  function applySnap(s) {
    STORE.memos = s.memos;
    STORE.memoSel = s.sel;
    STORE.memoEditing = s.editing;
    /* 立刻落盘：不然刚撤销完，之前排队的防抖保存可能又把旧内容写回来 ✗ */
    saveStore(true);
    render();
  }
  function undoMemo() {
    if (!UNDO.length) return false;
    REDO.push(Object.assign({ at: Date.now() }, snapshotMemos()));
    applySnap(UNDO.pop());
    syncUndoButtons();
    return true;
  }
  function redoMemo() {
    if (!REDO.length) return false;
    UNDO.push(Object.assign({ at: Date.now() }, snapshotMemos()));
    applySnap(REDO.pop());
    syncUndoButtons();
    return true;
  }

  /* ── 备忘录：导出为图片（PNG）─────────────────────────────────────────
     做法：把「渲染后的内容」包进 SVG 的 <foreignObject>，载成图片再画到 Canvas 导出。

     ⚠️ 两个必须踩对的点（都实测过，错一个就出不来图）：
     ① **必须用 data: URL 载入 SVG，不能用 blob: URL。**
        Chrome 对「blob: URL 的 SVG + foreignObject」会把 Canvas 标记为 tainted，
        toBlob / getImageData 直接抛错。思维导图那边就是栽在这里，
        只好退化成「纯 <text> 副本」，结果文字对不齐、一直没修好。
        换成 data: URL 就不污染 ✓（实测：blob 被污染 ✗ / data 正常 ✓）。
     ② **样式必须自带**：外部样式表在「图片上下文」里不会加载 ✗。
        所以导出模板把 CSS 直接写在 foreignObject 里的 <style> 中（不是外链、也不是内联到每个元素）。
     ③ 序列化要用 XMLSerializer，不能直接拼字符串 ——
        mdToHtml 产出的 HTML 里有 <br> 这类非自闭合标签，塞进 SVG 会解析失败 ✗。 */
  const MEMO_IMG_W = 720;
  const MEMO_IMG_BG = '#141413';
  const MEMO_IMG_CSS = [
    '*{box-sizing:border-box}',
    '.mx{width:' + MEMO_IMG_W + 'px;padding:34px 38px 38px;background:' + MEMO_IMG_BG + ';color:#d8d5cb;',
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;',
    'font-size:13px;line-height:1.85;}',
    '.mx-hd{display:flex;align-items:baseline;gap:12px;padding-bottom:14px;margin-bottom:22px;border-bottom:1px solid #2b2a24;}',
    '.mx-hd b{font-size:19px;font-weight:700;color:#fff;line-height:1.3;}',
    '.mx-hd span{margin-left:auto;flex:none;font-size:11px;color:#6f6d63;}',
    '.mx-bd>*:first-child{margin-top:0}',
    '.mx-bd h1,.mx-bd h2,.mx-bd h3,.mx-bd h4{color:#fff;font-weight:700;margin:18px 0 8px;padding-left:10px;',
    'border-left:3px solid #f2e39b;line-height:1.35;}',
    '.mx-bd h1{font-size:20px}',
    '.mx-bd h2{font-size:16px}',
    '.mx-bd h3{font-size:14px;color:#f2e39b;border-left-color:#3a382f}',
    '.mx-bd h4{font-size:13px;color:#f2e39b;border-left-color:#3a382f}',
    '.mx-bd p{margin:8px 0}',
    '.mx-bd strong{color:#fff}',
    '.mx-bd del{color:#6f6d63}',
    '.mx-bd a{color:#f2e39b;text-decoration:none}',
    '.mx-bd blockquote{margin:10px 0;padding:8px 13px;background:rgba(242,227,155,.06);',
    'border-left:3px solid #f2e39b;color:#b9b5a8;font-style:italic}',
    '.mx-bd code{background:#20201d;border:1px solid #3a382f;padding:1px 6px;border-radius:3px;',
    'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:#f2e39b}',
    '.mx-bd pre{background:#0f0f0d;border:1px solid #3a382f;border-left:3px solid #f2e39b;',
    'border-radius:4px;padding:11px 13px;margin:10px 0;white-space:pre-wrap;word-break:break-word}',
    '.mx-bd pre code{background:transparent;border:0;padding:0;color:#cfd6e2}',
    '.mx-bd ul,.mx-bd ol{margin:9px 0;padding-left:22px}',
    '.mx-bd li{margin:5px 0}',
    '.mx-bd ul{list-style:disc}',
    '.mx-bd ol{list-style:decimal}',
    '.mx-bd table{border-collapse:collapse;width:100%;margin:12px 0;font-size:12px}',
    '.mx-bd th,.mx-bd td{border:1px solid #3a382f;padding:7px 10px;text-align:left}',
    '.mx-bd th{background:#1d1d1a;color:#fff;font-weight:600}',
    '.mx-bd hr{border:0;border-top:1px solid #2b2a24;margin:16px 0}',
    '.mx-bd .tag{color:#f2e39b;background:rgba(242,227,155,.1);border-radius:3px;padding:0 5px;font-size:11.5px}',
    '.mx-ft{margin-top:26px;padding-top:12px;border-top:1px solid #2b2a24;color:#5c5a50;font-size:10.5px;',
    'display:flex;gap:8px}',
  ].join('');
  /* 图片预览状态：null = 没开；开了就把编辑区切成「左编辑 / 右图片预览」两栏
     （用户要求：点「图片」**先出预览**，确认后再下载 ✓）。
     ⚠️ 只在内存里 —— 刷新页面回到纯编辑状态，不写进 STORE ✓。 */
  let MEMO_IMG_PREVIEW = null;   /* { url, w, h, blob, base, busy, err } */
  function closeMemoImgPreview() {
    if (MEMO_IMG_PREVIEW && MEMO_IMG_PREVIEW.url) { try { URL.revokeObjectURL(MEMO_IMG_PREVIEW.url); } catch (_) {} }
    MEMO_IMG_PREVIEW = null;
  }
  function memoImageHtml(title, bodyHtml, whenText) {
    return '<div xmlns="http://www.w3.org/1999/xhtml" class="mx">'
      + '<style>' + MEMO_IMG_CSS + '</style>'
      + '<div class="mx-hd"><b>' + esc(title || '备忘录') + '</b><span>' + esc(whenText || '') + '</span></div>'
      + '<div class="mx-bd">' + bodyHtml + '</div>'
      + '<div class="mx-ft"><span>码境 CodeScope · 备忘录</span></div>'
      + '</div>';
  }
  function memoDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  /* 生成图片但**不下载**，返回 { blob, url, w, h }。
     —— 拆成「生成」和「下载」两步：工具栏的「图片」先出预览、确认后再下载 ✓。
     url 是 blob 地址，用完（关闭预览 / 重新生成）要 revoke，别漏 ✓。 */
  async function memoRenderImage(title, bodyHtml, whenText) {
    const html = memoImageHtml(title, bodyHtml, whenText);
    /* 先挂到页面上量高度：<style> 在图片上下文里能用，但高度只能在真实文档里算出来 */
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + MEMO_IMG_W + 'px;pointer-events:none;';
    host.innerHTML = html;
    document.body.appendChild(host);
    let W = MEMO_IMG_W, H = 200, xhtml = '';
    try {
      const node = host.firstElementChild;
      const box = node.getBoundingClientRect();
      W = Math.max(120, Math.ceil(box.width));
      H = Math.max(120, Math.ceil(box.height));
      /* ★ 用 XMLSerializer 产出合法 XHTML；直接拼 innerHTML 会因为 <br> 之类解析失败 */
      xhtml = new XMLSerializer().serializeToString(node);
    } finally { host.remove(); }

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
      + '<foreignObject width="100%" height="100%">' + xhtml + '</foreignObject></svg>';
    /* ★ data: URL —— 换成 blob: URL 会被 Chrome 判为跨域、画布直接污染 ✗ */
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG 图像加载失败'));
      img.src = url;
    });
    /* 2× 输出；同时限住最长边，避免超长笔记撑爆 Canvas 上限 */
    const scale = Math.max(.5, Math.min(2, 12000 / W, 12000 / H));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建 Canvas');
    ctx.fillStyle = MEMO_IMG_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png'));
    return { blob, url: URL.createObjectURL(blob), w: canvas.width, h: canvas.height };
  }
  function memoDownloadImage(rendered, fileBase) {
    if (!rendered || !rendered.blob) return;
    memoDownload(rendered.blob, (fileBase || 'memo') + '.png');
  }

  function render() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    if (!DATA) { host.innerHTML = headHtml() + '<div class="lw-main">' + skeleton() + '</div>'; bind(); return; }
    CODE_SEQ = 0; KPI_SEQ = 0;   /* 每个视图的编码都从 01 开始 */
    const main = { today: viewToday, memo: viewMemo, journal: viewJournal, quote: viewQuote, tracks: viewTracks, paper: viewTracks, files: viewFiles, time: viewFiles, mail: viewMail, reading: viewReading, flow: viewFlow, trends: viewTrends }[TAB] || viewToday;
    const openTodo = ((STORE && STORE.memos) || []).filter((t) => t.todo && !t.done).length;
    const grps = [];
    NAV.forEach((n) => { if (!grps.includes(n.grp)) grps.push(n.grp); });
    const navHtml = grps.map((g) => `<div class="grp">${g}</div>` + NAV.filter((n) => n.grp === g).map((n) =>
      `<button data-tab="${n.id}" class="${n.id === TAB ? 'on' : ''}"><span class="ic">${n.icon}</span><span>${n.label}</span>` +
      (n.badge && openTodo ? `<span class="badge">${openTodo}</span>` : `<span class="badge">${n.key || ''}</span>`) + `</button>`).join('')).join('');
    host.innerHTML = headHtml() + `<div class="lw-body2">
      <div class="lw-nav">${navHtml}<div class="foot">System <b>OK</b><br>本地运行 · 数据仅存本机<br><span title="面板前端资源的构建时间；如果改了代码没生效，先看这里是不是最新">面板资源 ${esc(buildStampText())}</span></div></div>
      <div class="lw-main${LW_FILL_TAB[TAB] ? ' fill' : ''}">${main()}</div></div>`;
    bind();
    /* ★ `#lw-sub` 刚被重建 ✗ —— 把还没过期的状态消息（如「已移到… ↩ 撤销」）重画上去 ✓，
       否则会被默认的「日期 · 项目数」盖掉 ✗（天气异步回来就会触发一次 render ✗）。 */
    paintStatus();
  }

  /* ⚠️ 只重建「左栏 + 中栏」，**故意不碰编辑器** ✓
     唯一该用它的地方是 `refreshMemoDerived()` —— 打字时刷列表（200ms 防抖）✓，
     那时「当前是哪一条」没变，重建编辑器只会把光标/选区弄丢 ✗。
     ★ 反过来：**凡是会改变「当前是哪一条」的操作**（点文件夹/标签/智能项/切视图/
       搜索/新建文件夹/右键改归属/删除）都**必须走 `render()`** ✗ ——
       否则右栏会停留在上一篇上（用户看到「点了没反应」），
       而且 `memoSel` 被清空后一打字就会写进 `STORE.memos[0]`（**另一条**）✗✗。 */
  function renderMemoList() {
    if (TAB !== 'memo' || !document.getElementById('lifework-view')) { render(); return; }
    const host = document.getElementById('lifework-view');
    const wrap = host.querySelector('.lw-nt');
    if (!wrap) { render(); return; }
    const html = viewMemo();                       /* 生成完整 HTML */
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const nSide = tmp.querySelector('.lw-nt-side');
    const nList = tmp.querySelector('.lw-nt-list');
    const oSide = wrap.querySelector('.lw-nt-side');
    const oList = wrap.querySelector('.lw-nt-list');
    /* ⚠️ 换掉列表会把滚动位置冲回顶部 ✗ —— 打字时列表要跟着更新（见 refreshMemoDerived），
       每次跳回顶部就没法用了。记下来再还原。 */
    const oScroll = oList && oList.querySelector('.lw-nt-scroll');
    const keepTop = oScroll ? oScroll.scrollTop : 0;
    if (nSide && oSide) oSide.replaceWith(nSide);
    if (nList && oList) oList.replaceWith(nList);
    const nScroll = wrap.querySelector('.lw-nt-list .lw-nt-scroll');
    if (nScroll && keepTop) nScroll.scrollTop = keepTop;
    /* 只重新绑「左栏 + 中栏」相关的交互（编辑器不碰 ✓）*/
    bindMemoSide();
  }

  /* ── 输入时的「派生视图」刷新 ──────────────────────────────────────────
     ⚠️ 这是「左右不同步」的根因所在：以前 oninput 只做防抖保存（flushMemo），
     **从不刷新任何视图** ✗ —— 于是左边打字、右边预览和左栏列表摘要都不动，
     要等到别的操作（删除/切文件夹/点格式）触发整屏 render() 才「追上来」✗。
     用户看到的「左边改了右边不变」「删了才同步」都是这一个原因。

     注意：**绝对不能调 render()** —— 那会把正文编辑器一起重建，
     光标位置、选区全丢 ✗。这里只刷新左侧列表（renderMemoList 不碰编辑器 ✓）。
     正文本身不用刷新 —— 现在是逐行实时渲染，光标行是源码、其他行本来就是渲染好的 ✓。 */
  let LIVE_BUF = 0;
  function refreshMemoDerived() {
    if (TAB !== 'memo') return;
    /* ★ 走唯一入口 ✓ —— 写盘目标只能是「编辑器正在显示的那一条」✗（见 memoWriteTarget 注释）*/
    const cur = memoWriteTarget();
    if (!cur) return;
    /* ⚠️ 必须**先**把编辑器内容写回 cur.text 再刷列表 ——
       cur.text 平时要等 600ms 的 flushMemo 才更新，而列表刷新是 200ms，
       不先写回的话列表读到的是旧数据 ✗（实测：打完字列表摘要少一行）。 */
    memoWriteFromEditor(cur);
    /* 图片预览开着时改了内容 → 在预览栏提示一下。
       ⚠️ **不能自动重新生成** —— 那要调 render()，会把编辑器整个重建、抢走光标 ✗，
          打字时体验直接废掉。所以只提示，让用户自己点「图片」✓。 */
    if (MEMO_IMG_PREVIEW && !MEMO_IMG_PREVIEW.busy) {
      const note = document.getElementById('lw-memo-img-note');
      if (note) note.textContent = '内容已更新 · 点「图片」重新生成';
    }
    /* 左侧列表摘要 + 侧栏计数：稍作防抖，避免每个字都重建一遍 */
    clearTimeout(LIVE_BUF);
    LIVE_BUF = setTimeout(() => { if (TAB === 'memo') renderMemoList(); }, 200);
  }

  /* ── 从界面上读回「标题 + 正文」────────────────────────────────────────
     正文是逐行实时渲染的 contenteditable：**可编辑行取 textContent、渲染行取 data-src**。
     bind()（编辑器）和 bindMemoSide()（切文件夹/标签前的保存）都要用 → 放模块作用域。 */
  function memoReadEditor() {
    const ti = document.getElementById('lw-memo-title');
    const ce = document.getElementById('lw-memo-ce');
    const body = ce
      ? Array.from(ce.querySelectorAll(':scope > .ln')).map((el) =>
          el.getAttribute('contenteditable') === 'false' ? String(el.dataset.src || '') : String(el.textContent || '')
        ).join('\n')
      : null;
    return { title: ti ? ti.value : null, body };
  }
  /* 把界面内容写回 cur.text（只改内存、不落盘）。没有编辑器时返回 null（= 保持原样）。 */
  function memoWriteFromEditor(cur) {
    if (!cur) return null;
    const { title, body } = memoReadEditor();
    if (title == null && body == null) return null;
    const old = String(cur.text || '').split('\n');
    const bodyNext = body == null ? old.slice(1).join('\n') : body;
    const next = (title == null ? old[0] : title) + (bodyNext ? '\n' + bodyNext : '');
    /* ★★ 内容**没变**就绝不能动 `edit` ✗✗ ——
       列表是按 `edit` 倒序排的（新的在上 ✓），而「点开一条看一眼」也会走到这里
       （切走前要 flush ✓）。以前无条件 `cur.edit = Date.now()` ✗ →
       **光是打开一条就会把它顶到列表最上面** ✗
       （用户原话：「是否会自动按照最新打开的放到最上面排序，不需要这个」）。
       现在只有内容真的变了才更新时间戳 ✓ —— 打开不再改变顺序，
       真正编辑过的才会浮上来（这也是笔记类应用的通行行为 ✓）。 */
    if (next === String(cur.text || '')) return cur;
    cur.text = next;
    cur.edit = Date.now();
    return cur;
  }


  /* ★★★ 统一的「按住拖」会话 ✗✗ —— 这一版修的是用户报的那个 bug：
     「我鼠标点击后拖动，后续重新鼠标移动到这，自动莫名的拖动了，
      没有点击去要拖动，他还是拖动了」。

     **根因**：拖动会话是「按下时往 document 挂 mousemove / mouseup」✗，
     而**松手如果没落在 document 上**（在窗口外松的 ✗、拖到浏览器边框上松的 ✗、
     拖到系统菜单上松的 ✗、右键/弹窗打断的 ✗），`mouseup` 就**永远到不了** ✗
     → `move` 一直挂在 document 上 ✗ → 之后**只要鼠标经过就在拖动** ✗✗
     —— 用户看到的「没点也拖」✗。

     三道保险，缺一不可 ✓：
       ① **Pointer Events + `setPointerCapture`** ✓ —— 指针被捕获后，
          `pointerup` **一定会**派发回捕获元素 ✓（哪怕在窗口外松手 ✓）；
       ② `move` 里查 `ev.buttons` ✗✗ —— 只要发现**一个键都没按** ✓，
          立刻结束会话 ✓。这是**最后一道兜底** ✓：
          任何原因漏掉的 up（切窗口 / 弹窗 / 系统手势 ✗）都会被它收掉 ✓；
       ③ `pointercancel` / `blur` / `visibilitychange` 也一并收尾 ✓。

     ⚠️ 这个 bug 在**全部 7 处拖动**里都存在 ✗ ——
        邮箱两条、备忘录两条、卡片缩放三条、日记两条、工作流节点一条 ✗，
        只是用户先在邮箱那儿撞上 ✗。所以**全部统一走这里** ✓，以后再修只修一处 ✓。

     ⚠️ `pointerdown` 只认**左键** ✗（`button !== 0` 直接不管 ✓）——
        以前右键点一下也会开一个拖动会话 ✗，右键菜单一弹，up 就丢了 ✗。

     handlers：
       down(ev) → 返回一个「会话对象」（想拖就给对象 ✓，不拖就 return null ✓）
       move(ev, sess) / up(ev, sess, cancelled) ✓
     up 里不用自己摘监听 ✓ —— 助手会摘 ✓（而且**一定会**调 up ✓，cancelled 只是告诉你原因 ✓）。 */
  /* ── 三栏宽度：读上次存的 ✓（没存 / 太小 → 交给 CSS 默认 ✓）── */
  function paneW(key, min) {
    const w = Number((STORE && STORE[key]) || 0);
    return (w >= min) ? ' style="width:' + w + 'px;flex:none"' : '';
  }
  /* 一条拖拽条的 HTML ✓ */
  function paneGrip(which) {
    return '<div class="lw-pgrip" data-pgrip="' + esc(which) + '" title="左右拖动调整宽度；双击恢复默认"></div>';
  }
  /* ★★ 给一个三栏布局挂上拖拽调宽 ✓✗ —— 阅读 / 工作流 / 热榜 共用 ✓。
     spec: [{ which, target(选择器), min, max, key(STORE 字段) }, …] ✓
     ⚠️ 走 `lwGrab` ✗（不是自己挂 mousemove ✗）—— 那套有三道保险 ✓，
        能防「松手没收干净 → 之后鼠标经过就自己拖」✗。 */
  function bindPaneGrips(root, specs) {
    if (!root) return;
    specs.forEach((sp) => {
      const el = root.querySelector('[data-pgrip="' + sp.which + '"]');
      const target = root.querySelector(sp.target);
      if (!el || !target) return;
      /* 恢复上次的宽度 ✓（存在 STORE 里 ✓，切页签/重开都不丢 ✓）*/
      const saved = Number((STORE && STORE[sp.key]) || 0);
      if (saved >= sp.min) { target.style.width = saved + 'px'; target.style.flex = 'none'; }
      lwGrab(el, {
        down: (ev) => {
          el.classList.add('on');
          return { x: ev.clientX, w: target.getBoundingClientRect().width };
        },
        move: (ev, sess) => {
          const w = Math.max(sp.min, Math.min(sp.max, sess.w + (ev.clientX - sess.x)));
          target.style.width = Math.round(w) + 'px';
          target.style.flex = 'none';
        },
        up: () => {
          el.classList.remove('on');
          STORE[sp.key] = Math.round(target.getBoundingClientRect().width);
          saveStore();
        },
      });
      el.ondblclick = () => {
        target.style.width = '';
        target.style.flex = '';
        STORE[sp.key] = 0;
        saveStore();
      };
    });
  }

  function lwGrab(el, handlers) {
    if (!el) return;
    let sess = null;
    const onMove = (ev) => {
      if (!sess) return;
      /* ② 一个键都没按 → 这个会话其实早就该结束了 ✗ → 立刻收尾 ✓ */
      if (ev.buttons === 0) { end(ev, true); return; }
      try { handlers.move && handlers.move(ev, sess); } catch (_) { }
    };
    const onUp = (ev) => end(ev, false);
    const onCancel = (ev) => end(ev, true);
    const onBlur = () => end(null, true);
    const onVis = () => { if (document.visibilityState !== 'visible') end(null, true); };
    function end(ev, cancelled) {
      if (!sess) return;
      const s = sess;
      sess = null;
      try { if (s.pid != null && el.releasePointerCapture) el.releasePointerCapture(s.pid); } catch (_) { }
      el.classList.remove('dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      try { handlers.up && handlers.up(ev, s, !!cancelled); } catch (_) { }
    }
    el.onpointerdown = (ev) => {
      if (ev.button !== 0) return;               /* 只认左键 ✓ */
      if (ev.target && ev.target.classList && ev.target.classList.contains('lw-fl-port')) return;
      end(null, true);                            /* 上一次没收干净 → 先收掉 ✓ */
      let sess2 = null;
      try { sess2 = handlers.down ? handlers.down(ev) : {}; } catch (_) { sess2 = null; }
      if (!sess2) return;
      sess2.pid = ev.pointerId;
      sess = sess2;
      try { el.setPointerCapture(ev.pointerId); } catch (_) { }
      el.classList.add('dragging');
      ev.preventDefault();
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onVis);
    };
  }

  /* ── 顶栏状态条：小工具 ✓ ─────────────────────────────────────────────── */
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const hhmmss = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  /* 问候语：按小时分段 ✓ */
  function greetOf(d) {
    const h = d.getHours();
    if (h < 5) return { hi: '夜深了', tip: '该休息了，明天才有精神' };
    if (h < 9) return { hi: '早上好', tip: '先做最重要的一件事' };
    if (h < 12) return { hi: '上午好', tip: '趁状态好，把硬骨头啃掉' };
    if (h < 14) return { hi: '中午好', tip: '吃口饭，歇一会儿' };
    if (h < 18) return { hi: '下午好', tip: '收个尾，别把线头留到明天' };
    if (h < 22) return { hi: '晚上好', tip: '回顾一下今天，写两句日记' };
    return { hi: '夜深了', tip: '该收工了' };
  }
  /* 今天过了多少 % ✓（00:00 → 0，24:00 → 100 ✓）*/
  function dayPct(d) {
    return Math.min(100, Math.round(((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400) * 100));
  }
  /* 现在的心情 ✓（STORE.mood = { e, n, at } ✓）*/
  function moodNow() {
    const m = STORE && STORE.mood;
    if (!m || !m.e) return null;
    return { e: String(m.e), n: String(m.n || '') };
  }
  /* 今日格言 ✓ —— **优先用用户自己的「好词好句」** ✓（那才最贴 ✓，也不用联网 ✗）。
     ⚠️ 同一天内必须**稳定** ✗ —— 存在 STORE.dailyQuote = { day, idx } ✓，
        点「换一句」才 +1 ✓。不然每次 render 都换一句，眼睛都花了 ✗。 */
  function dailyQuoteOf() {
    const mine = ((STORE && STORE.quotes) || []).filter((q) => q && String(q.text || '').trim());
    const pool = mine.length ? mine : QUOTE_POOL;
    /* 起点：当天的种子 ✓（同一天首次打开是同一句 ✓）—— 之后由定时器往前推 ✓。 */
    if (QUOTE_IDX == null) {
      const day = dayKey(new Date());
      const dq = (STORE && STORE.dailyQuote) || null;
      QUOTE_IDX = (dq && dq.day === day && Number.isFinite(dq.idx)) ? dq.idx : 0;
    }
    const idx = QUOTE_IDX;
    const q = pool[((idx % pool.length) + pool.length) % pool.length] || pool[0];
    return { text: String(q.text || ''), from: String(q.from || ''), mine: mine.length > 0, idx };
  }
  /* 格言那一块的内容 ✓（首次渲染和自动切换**共用同一份** ✓，不会两处写法不一致 ✗）*/
  function quoteInnerHtml() {
    const q = dailyQuoteOf();
    return svgIcon('quote', 14)
      + '<span class="tx">' + esc(q.text) + '</span>'
      + (q.from ? '<span class="from">— ' + esc(q.from) + '</span>' : '')
      + (q.mine ? '' : '<span class="from">（内置）</span>');
  }
  /* ★ 自动切换时**只改这一个元素** ✗✗ —— 不能整屏 render ✗
     （20 秒重绘一次整个面板，输入框会失焦、iframe 会重载 ✗）。 */
  function paintQuote() {
    const el = document.getElementById('lw-quote');
    if (!el) return;
    el.innerHTML = quoteInnerHtml();
    el.title = dailyQuoteOf().text;
    /* 重播淡入动画 ✓（先摘类 + 强制重排 ✓，不然同名类不会重播 ✗）*/
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
  }
  /* 日记连续记录天数 ✓ —— 口径和「今日」页一致 ✓（今天没写也不断，从昨天往前数 ✓）*/
  function journalStreak() {
    const js = ((STORE && STORE.journal) || []);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const dd = new Date(); dd.setDate(dd.getDate() - i);
      if (js.some((x) => x && x.date === dayKey(dd))) n++;
      else if (i > 0) break;
    }
    return n;
  }
  /* 未完成待办数 ✓ —— 和「今日」页同一个口径 ✓（备忘录正文里的 - [ ] xxx / ☐ xxx）*/
  function openTodoCount() {
    let n = 0;
    ((STORE && STORE.memos) || []).forEach((m) => {
      String((m && m.text) || '').split('\n').forEach((l) => {
        const a = /^\s*[-*+]\s*\[([ xX])\]\s*\S/.exec(l);
        const b = /^\s*([☐☑])\s*\S/.exec(l);
        if ((a && a[1].toLowerCase() !== 'x') || (b && b[1] === '☐')) n++;
      });
    });
    return n;
  }
  function todayWroteJournal() {
    const k = dayKey(new Date());
    return ((STORE && STORE.journal) || []).some((j) => j && j.date === k);
  }
  /* 时钟胶囊 ✓（含一条「今天已过 xx%」的细进度条 ✓）*/
  function clockHtml(d) {
    const pct = dayPct(d);
    return '<div class="lw-stat clock" title="本机时间 · 今天已过 ' + pct + '%">' + svgIcon('clock')
      + '<div class="mid"><div class="big" id="lw-clock">' + hhmmss(d) + '</div>'
      + '<div class="cap">' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WD[d.getDay()] + '</div></div>'
      + '<div class="lw-daybar"><i id="lw-daybar" style="width:' + pct + '%"></i></div></div>';
  }
  function greetHtml(d) {
    const g = greetOf(d);
    return '<div class="lw-greet"><b>' + esc(g.hi) + ' <em>' + dayPct(d) + '%</em></b>'
      + '<span>' + esc(g.tip) + '</span></div>';
  }
  function moodPickHtml() {
    const cur = moodNow();
    return '<div class="lw-moodpick" id="lw-moodpick">'
      + MOODS.map((m) => '<div data-mood="' + esc(m.e) + '"' + (cur && cur.e === m.e ? ' class="on"' : '') + '>'
        + '<i>' + m.e + '</i>' + esc(m.n) + '</div>').join('')
      + '<div data-mood=""><i>✕</i>不设</div></div>';
  }
  function moodHtml() {
    const m = moodNow();
    return '<div class="lw-stat click mood" id="lw-mood" title="点一下记录今天的心情">'
      + svgIcon('mood') + '<span class="em">' + (m ? m.e : '🙂') + '</span>'
      + '<div class="mid"><div class="big" style="font-size:12px;letter-spacing:.5px">' + esc(m ? (m.n || '心情') : '记一笔') + '</div>'
      + '<div class="cap">' + (m ? '今天心情' : '点一下记录') + '</div></div>'
      + (MOOD_OPEN ? moodPickHtml() : '') + '</div>';
  }
  /* 第二行：今日格言 + 今日状态 ✓ */
  function stripHtml() {
    const q = dailyQuoteOf();
    const todo = openTodoCount();
    const streak = journalStreak();
    const wrote = todayWroteJournal();
    return '<div class="lw-strip">'
      /* ⚠️ 这里用 `quoteInnerHtml()` ✓ —— 和自动切换走**同一份**写法 ✓（见 paintQuote ✓）。 */
      + '<div class="q" id="lw-quote" title="' + esc(q.text) + '">' + quoteInnerHtml() + '</div>'
      + '<div class="st">'
      + '<span title="备忘录里的未完成待办">' + svgIcon('list', 13) + '待办 <b class="' + (todo ? 'hot' : '') + '">' + todo + '</b></span>'
      + '<span title="日记连续记录天数">' + svgIcon('fire', 13) + '连续 <b class="' + (streak ? 'hot' : '') + '">' + streak + '</b> 天</span>'
      + '<span title="今天的日记写了没有">' + svgIcon('cal', 13) + '今日日记 <b class="' + (wrote ? 'ok' : '') + '">' + (wrote ? '已写' : '未写') + '</b></span>'
      + '</div></div>';
  }

  function headHtml() {
    const d = new Date();
    const sub = DATA
      ? (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WD[d.getDay()] + ' · ' + DATA.totals.projects + ' 项目 · ' + DATA.totals.files + ' 文件 · ' + DATA.totals.sizeText
      : '正在扫描本机…';
    let wxHtml = '';
    if (WX && WX.ok) {
      const [ic, name] = wx(WX.code);
      wxHtml = `<div class="lw-wx" title="${esc(WX.city)}${esc(WX.admin)} · 湿度 ${WX.hum}% · 风 ${WX.wind}km/h">
        <span class="wi">${ic}</span>
        <div><div class="wt">${Math.round(WX.temp)}°</div></div>
        <div class="wc">${esc(name)} · ${esc(WX.city)}<br>体感 ${Math.round(WX.feels)}° · 湿 ${WX.hum}%</div></div>`;
    } else if (WX && WX.error) {
      wxHtml = `<div class="lw-wx"><span class="wi">🌡</span><div class="wc">天气不可用<br>${esc(String(WX.error).slice(0, 24))}</div></div>`;
    }
    return `<div class="lw-head">
      <div class="lw-logo">🎯</div>
      <div class="lw-h1">个人管理面板<small>Personal Console</small></div>
      ${clockHtml(d)}
      ${greetHtml(d)}
      ${moodHtml()}
      <div class="lw-sub2" id="lw-sub">${esc(sub)}</div>
      ${wxHtml}
      <div id="lw-mbslot">${mailBadgeHtml()}</div>
      <button class="lw-btn" id="lw-refresh">↻ 刷新</button></div>${stripHtml()}`;
  }

  /* 左栏 + 中栏 的交互（筛选类操作用 render() 局部刷新 ✓）*/
  /* ★★ 写盘的**唯一**目标：编辑器**正在显示**的那一条 ✓
     为什么必须是它、且**不能有回落** ✗：
       以前两条 flush 路径都写成 `memoById(STORE.memoSel) || memos.filter(!trash)[0]` ✗ ——
       而 `memoSel` 为空时（比如刚打开备忘录页、还没点过任何一条）它会回落到**列表第一条** ✗，
       此时编辑器显示的可能完全是另一条 → **把 A 的正文写成 C 的** ✗✗。
       实测：只要「依次点开三条备忘录」，第一条的内容就被第三条覆盖了 ✗
       （用户真实数据就是这么被改坏的 —— 静默、无报错、看起来一切正常 ✗✗）。
       现在：**编辑器显示谁，就只能写谁** ✓；没有编辑器（空态）就什么都不写 ✓。 */
  function memoWriteTarget() {
    if (!MEMO_EDITOR_ID) return null;
    return ((STORE && STORE.memos) || []).find((m) => m.id === MEMO_EDITOR_ID) || null;
  }

  function bindMemoSide() {
    const host = document.getElementById("lifework-view");
    if (!host) return;
    const q = (sel) => host.querySelector(sel);
    const qa = (sel) => Array.from(host.querySelectorAll(sel));
    const memoById = (id) => (STORE.memos || []).find((x) => x.id === id);
    const flushMemo = () => {
      /* ★ 走唯一入口 ✓（以前这里是无守卫的 memoWriteFromEditor ✗，就是写串数据的元凶）*/
      const cur = memoWriteTarget();
      if (!cur) return;
      memoWriteFromEditor(cur);
      if (!cur.text.trim() || cur.text.trim() === "新备忘录") {
        STORE.memos = (STORE.memos || []).filter((x) => x.id !== cur.id);
        if (STORE.memoSel === cur.id) STORE.memoSel = "";
        saveStore(); return;
      }
      saveStore();
    };
    qa("[data-memo]").forEach((el) => {
      el.onclick = () => { flushMemo(); closeMemoImgPreview(); STORE.memoSel = el.dataset.memo; STORE.memoEditing = ""; saveStore(); render(); };
    });

    /* ── 把备忘录**拖进文件夹**（自由归属 ✓）────────────────────────────────
       以前只有右键菜单里的「📁 移到文件夹…」+ 一个 prompt ✗ —— 不好发现、也不好用。
       现在直接拖：拖到左边任意文件夹上松手即可 ✓，落点会高亮 ✓。 */
    const moveMemoTo = (id, folder) => {
      const m = memoById(id); if (!m) return;
      const target = String(folder || '').trim() || '备忘录';   /* 拖到「iCloud 全部」= 放回默认文件夹 ✓ */
      if ((m.folder || '备忘录') === target) return;
      /* ★ 先落盘再快照 ✓ —— 正文自动保存是 600ms 防抖 ✗，
         不 flush 就 snapMemo() 的话，撤销快照里缺最后敲的那几个字 ✗
         （拖一下再撤销，字就回不来了）。和日记改分类是同一类问题 ✓。 */
      flushMemo();
      snapMemo('move');                                        /* 可撤销 ✓ */
      const m2 = memoById(id); if (!m2) return;                /* flush 可能把空备忘录删掉了 ✓ */
      m2.folder = target.slice(0, 24);
      STORE.memoFolders = STORE.memoFolders || [];
      if (!STORE.memoFolders.includes(m2.folder)) STORE.memoFolders.push(m2.folder);
      saveStore();
      render();                       /* ★ 整屏重建：移出当前文件夹时编辑器要跟着换 ✓ */
      const s2 = document.getElementById('lw-sub');
      if (s2) s2.textContent = '已移到「' + m2.folder + '」';
    };
    let DRAG_MEMO = '';
    qa("[data-memo]").forEach((el) => {
      el.addEventListener('dragstart', (event) => {
        DRAG_MEMO = el.dataset.memo;
        el.classList.add('dragging');
        try { event.dataTransfer.setData('text/plain', DRAG_MEMO); event.dataTransfer.effectAllowed = 'move'; } catch (_) {}
      });
      el.addEventListener('dragend', () => { DRAG_MEMO = ''; el.classList.remove('dragging'); });
    });
    qa("[data-mfolder]").forEach((el) => {
      el.addEventListener('dragover', (event) => {
        if (!DRAG_MEMO) return;
        event.preventDefault();
        try { event.dataTransfer.dropEffect = 'move'; } catch (_) {}
        el.classList.add('drop');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (event) => {
        event.preventDefault();
        el.classList.remove('drop');
        const id = DRAG_MEMO || (event.dataTransfer && event.dataTransfer.getData('text/plain')) || '';
        if (!id) return;
        moveMemoTo(id, el.dataset.mfolder);
      });
    });

    /* ── 三栏之间：拖竖条左右调宽 ✓（双击恢复默认 ✓，宽度记住到 STORE ✓）── */
    qa('[data-mgrip]').forEach((grip) => {
      const which = grip.dataset.mgrip;
      const target = which === 'side' ? q('.lw-nt-side') : q('.lw-nt-list');
      if (!target) return;
      lwGrab(grip, {
        down: (event) => {
          grip.classList.add('on');
          return {
            startX: event.clientX, startW: target.getBoundingClientRect().width,
            min: which === 'side' ? 120 : 180, max: which === 'side' ? 420 : 640,
          };
        },
        move: (e2, sess) => {
          const w = Math.max(sess.min, Math.min(sess.max, sess.startW + (e2.clientX - sess.startX)));
          target.style.width = Math.round(w) + 'px';
          target.style.flex = 'none';
        },
        up: (e2, sess) => {
          grip.classList.remove('on');
          const w = Math.round(target.getBoundingClientRect().width);
          if (which === 'side') STORE.memoSideW = w; else STORE.memoListW = w;
          saveStore();
        },
      });
      grip.ondblclick = () => {
        target.style.width = '';
        if (which === 'side') STORE.memoSideW = 0; else STORE.memoListW = 0;
        saveStore();
      };
    });
    /* ── 点左栏的文件夹 / 智能项 / 标签 ──
       ★★ 这里全部用 `render()` 而不是 `renderMemoList()` ✓ ——
       为什么：`renderMemoList()` 只换左栏 + 中栏、**故意不碰编辑器** ✗（那是给打字时刷列表用的 ✓）。
       而这些动作会**改变「当前是哪一条备忘录」** ✗ → 编辑器必须跟着重建 ✓，
       否则右栏会停留在上一篇上：用户看到的是「点了文件夹没反应」✗；
       更糟的是 `memoSel` 已被清空 → 一打字就会写进 `STORE.memos[0]`（**另一条**）✗✗。
       （写盘那道 MEMO_EDITOR_ID 守卫是兜底，这里的 render() 才是正解 ✓）
       ★ 点文件夹**必须同时切回「文件夹视图」** ✓ ——
         以前只改 `STORE.memoFolder` ✗，而「▦ 全部列表」模式下压根不按文件夹过滤 ✗
         （见 viewMemo 里 `view === "all" || ...`），
         于是用户点「测试文件夹」（计数 0）时：左栏高亮了、列表却还是 3 条 ✗，
         看起来就像「点文件夹没反应」✗（用户截图报的就是这个）。
         语义上「点某个文件夹」= 「我要看这个文件夹」✓，所以顺带切视图是符合直觉的 ✓；
         「▦ 全部列表」仍是「跨文件夹总览」，点它就进、点任意文件夹就出 ✓。 */
    qa("[data-mfolder]").forEach((el) => { el.onclick = () => { flushMemo(); STORE.memoFolder = el.dataset.mfolder || ""; STORE.memoSmart = ""; STORE.memoView = "folder"; STORE.memoSel = ""; saveStore(); render(); }; });
    qa("[data-msmart]").forEach((el) => {
      el.onclick = () => {
        flushMemo();
        STORE.memoSmart = (STORE.memoSmart === el.dataset.msmart) ? "" : el.dataset.msmart;
        STORE.memoSel = ""; saveStore(); render();
      };
    });
    qa("[data-mtag]").forEach((el) => { el.onclick = () => { flushMemo(); STORE.memoTag = el.dataset.mtag || ""; STORE.memoSmart = ""; STORE.memoSel = ""; saveStore(); render(); }; });
    const mQ = q("#lw-memo-q");
    /* 搜索也要整屏重建（筛掉当前那条时编辑器得换）✓；重建后把焦点和光标还给输入框 ✓ */
    if (mQ) mQ.oninput = () => { STORE.memoQ = mQ.value; render(); const i2 = document.getElementById("lw-memo-q"); if (i2) { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } };
    /* 「◫ 源码」开关：关（默认）= 逐行实时渲染；开 = 整篇显示源码（方便整段改写 / 复制）。
       —— 原来这里是「左编辑 / 右预览」分栏的开关，分栏已按需求去掉 ✓ */
    const srcBtn = q('#lw-nt-live');
    if (srcBtn) srcBtn.onclick = () => {
      flushMemo();
      STORE.memoSource = !STORE.memoSource;
      saveStore(); render();
      const s2 = document.getElementById('lw-sub');
      if (s2) s2.textContent = STORE.memoSource ? '已切到源码模式 ✓' : '已切回实时渲染 ✓';
    };
    /* 视图切换（▤ 文件夹 / ▦ 全部列表）—— 会改变列表范围 → 整屏重建 ✓ */
    const mView = qa("[data-mview]");
    mView.forEach((el) => { el.onclick = () => { flushMemo(); STORE.memoView = el.dataset.mview; saveStore(); render(); }; });
    const addFol = q("#lw-nt-addfol");
    if (addFol) addFol.onclick = () => {
      const name = prompt("新建文件夹名称：", "新文件夹");
      if (!name || !name.trim()) return;
      const n = name.trim().slice(0, 24);
      STORE.memoFolders = STORE.memoFolders || ["备忘录", "Study note"];
      if (!STORE.memoFolders.includes(n)) STORE.memoFolders.push(n);
      STORE.memoFolder = n; STORE.memoSmart = ""; STORE.memoView = "folder"; STORE.memoSel = ""; saveStore(); render();
    };
    /* 右键菜单：文件夹 / 标签 / 备忘录行 */
    const closeCtx = () => { const c = document.getElementById("lw-ctx"); if (c) c.remove(); };
    document.addEventListener("click", (e) => { if (e.button !== 2) closeCtx(); });
    const openCtx = (e, items) => {
      e.preventDefault(); e.stopPropagation(); closeCtx();
      const box = document.createElement("div");
      box.className = "lw-ctx"; box.id = "lw-ctx";
      box.innerHTML = items.map((it, i) => it === "-" ? '<div class="sep"></div>' : '<div class="mi ' + (it.danger ? "danger" : "") + '" data-ci="' + i + '">' + it.label + '</div>').join("");
      document.body.appendChild(box);
      box.style.left = Math.min(e.clientX, window.innerWidth - box.offsetWidth - 8) + "px";
      box.style.top = Math.min(e.clientY, window.innerHeight - box.offsetHeight - 8) + "px";
      box.querySelectorAll("[data-ci]").forEach((el) => {
        el.onclick = (ev) => { ev.stopPropagation(); const it = items[Number(el.dataset.ci)]; closeCtx(); if (it && it.run) it.run(); };
      });
    };
    qa("[data-mfolder]").forEach((el) => {
      const name = el.dataset.mfolder; if (!name) return;
      el.oncontextmenu = (e) => openCtx(e, [
        { label: "✎ 重命名", run: () => {
            const n = prompt("重命名文件夹：", name); if (!n || !n.trim() || n.trim() === name) return;
            const nn = n.trim().slice(0, 24);
            STORE.memoFolders = (STORE.memoFolders || []).map((x) => (x === name ? nn : x));
            (STORE.memos || []).forEach((m) => { if ((m.folder || "备忘录") === name) m.folder = nn; });
            STORE.memoFolder = nn; saveStore(); render();
          } },
        { label: "🗑 删除文件夹", danger: true, run: () => {
            if (!confirm("删除文件夹「" + name + "」？\n里面的备忘录会移到「备忘录」。")) return;
            STORE.memoFolders = (STORE.memoFolders || []).filter((x) => x !== name);
            (STORE.memos || []).forEach((m) => { if ((m.folder || "备忘录") === name) m.folder = "备忘录"; });
            STORE.memoFolder = ""; saveStore(); render();
          } },
      ]);
    });
    qa("[data-mtag]").forEach((el) => {
      const tag = el.dataset.mtag; if (!tag) return;
      el.oncontextmenu = (e) => openCtx(e, [
        { label: "✎ 重命名标签", run: () => {
            const n = prompt("把 #" + tag + " 改成：", tag); if (!n || !n.trim() || n.trim() === tag) return;
            const nn = n.trim().replace(/^#/, "").slice(0, 24);
            (STORE.memos || []).forEach((m) => { m.text = String(m.text || "").replace(new RegExp("#" + tag + "(?![\\u4e00-\\u9fa5\\w-])", "g"), "#" + nn); });
            if (STORE.memoTag === tag) STORE.memoTag = nn;
            saveStore(); render();
          } },
        { label: "🗑 删除标签（只从正文移除）", danger: true, run: () => {
            if (!confirm("从所有备忘录里移除 #" + tag + " ？")) return;
            (STORE.memos || []).forEach((m) => { m.text = String(m.text || "").replace(new RegExp("\\s*#" + tag + "(?![\\u4e00-\\u9fa5\\w-])", "g"), ""); });
            if (STORE.memoTag === tag) STORE.memoTag = "";
            saveStore(); render();
          } },
      ]);
    });
    qa("[data-memo]").forEach((el) => {
      const id = el.dataset.memo;
      el.oncontextmenu = (e) => openCtx(e, [
        { label: "☆ 置顶 / 取消", run: () => { const m = memoById(id); if (m) { m.pin = !m.pin; saveStore(); render(); } } },
        { label: "📁 移到文件夹…", run: () => {
            const n = prompt("移到哪个文件夹？（现有：" + (STORE.memoFolders || []).join(" / ") + "）", (STORE.memoFolders || [])[0] || "备忘录");
            if (!n || !n.trim()) return;
            const m = memoById(id); if (!m) return;
            m.folder = n.trim().slice(0, 24);
            STORE.memoFolders = STORE.memoFolders || [];
            if (!STORE.memoFolders.includes(m.folder)) STORE.memoFolders.push(m.folder);
            saveStore(); render();
          } },
        "-",
        { label: "🗑 删除", danger: true, run: () => { const m = memoById(id); if (m) { m.trash = true; STORE.memoSel = ""; saveStore(); render(); } } },
      ]);
    });
  }

  function bind() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    /* 左栏 + 中栏的交互（提出来，方便 render() 局部刷新时复用 ✓）*/
    bindMemoSide();
    /* ── 卡片：拖「边」改大小 ✓（右边改宽 / 下边改高 / 右下角一起）──
       给每张卡插三条热区 ✓，拖动时实时改宽高 ✓，松手存进 STORE ✓（下次还记得 ✓）。*/
    if (!bind._rs) {
      bind._rs = true;
      const install = () => {
        const host = document.getElementById('lifework-view');
        if (!host) return;
        host.querySelectorAll('.lw-c').forEach((card, idx) => {
          /* 先恢复上次拖过的尺寸 ✓（卡片每次 render 都会重建 ✗，所以必须重放 ✓）
             ⚠️ STORE 首屏可能是 null ✗（`Cannot read properties of null` ✗ —— 第二次踩 ✗）*/
          const saved = STORE ? STORE['rsz_' + TAB + '_' + idx] : null;
          if (saved) {
            if (saved.w) card.style.width = saved.w + 'px';
            if (saved.h) card.style.height = saved.h + 'px';
            if (saved.span) card.style.gridColumn = saved.span;
          }
          if (card.dataset.rsReady) return;
          card.dataset.rsReady = '1';
          ['e', 's', 'se'].forEach((dir) => {
            const h = document.createElement('div');
            h.className = 'lw-rs lw-rs-' + dir;
            card.appendChild(h);
            lwGrab(h, {
              down: (e) => {
                h.classList.add('on');
                const x0 = e.clientX, y0 = e.clientY, w0 = card.offsetWidth, h0 = card.offsetHeight;
              /* 用元素索引当持久化 key ✓（卡片顺序稳定 ✓）*/
                const idx = Array.from(host.querySelectorAll('.lw-c')).indexOf(card);
                const key = 'rsz_' + TAB + '_' + idx;
                return { x0, y0, w0, h0, key };
              },
              move: (ev, sess) => {
                const x0 = sess.x0, y0 = sess.y0, w0 = sess.w0, h0 = sess.h0;
                if (dir !== 's') card.style.width = Math.max(240, w0 + (ev.clientX - x0)) + 'px';
                if (dir !== 'e') card.style.height = Math.max(120, h0 + (ev.clientY - y0)) + 'px';
                /* 卡片在网格里要跟着改 span ✓，否则宽度会被 grid 拉回去 ✗ */
                const grid = card.parentElement;
                if (grid && dir !== 's') {
                  const colW = (grid.clientWidth - 11 * 16) / 12;
                  const span = Math.max(1, Math.min(12, Math.round((card.offsetWidth + 16) / (colW + 16))));
                  card.style.gridColumn = 'span ' + span;
                }
              },
              up: (ev, sess) => {
                h.classList.remove('on');
                STORE[sess.key] = { w: card.offsetWidth, h: card.offsetHeight, span: card.style.gridColumn };
                saveStore();
              },
            });
          });
        });
      };
      bind._rsInstall = install;
    }
    if (bind._rsInstall) bind._rsInstall();
    /* ── 网上热点 + AI 助手（研究方向视图 ✓）── */
    const viewEl = document.getElementById('lifework-view');
    const qv = (sel) => (viewEl ? viewEl.querySelector(sel) : null);
    const qav = (sel) => (viewEl ? Array.from(viewEl.querySelectorAll(sel)) : []);
    /* 热点 */
    const doHot = async (kw) => {
      const inp = qv('#lw-hot-q');
      const key = String(kw || (inp && inp.value) || '').trim() || 'robotics';
      STORE.hotQ = key; STORE.hotLoading = true; render();
      try { const r = await fetch('/api/life/hot?q=' + encodeURIComponent(key), { cache: 'no-store' }); STORE.hot = await r.json(); }
      catch (e) { STORE.hot = { ok: false, error: '请求失败：' + e.message }; }
      STORE.hotLoading = false; render();
    };
    const hotGo = qv('#lw-hot-go'); if (hotGo) hotGo.onclick = () => doHot();
    const hotInp = qv('#lw-hot-q'); if (hotInp) hotInp.onkeydown = (e) => { if (e.key === 'Enter') doHot(); };
    qav('.lw-hotkw').forEach((el) => { el.onclick = () => doHot(el.dataset.kw); });
    /* ★ 自动推 ✓ —— 进研究方向就自动按「我的方向」搜一次 ✓，不用手动点 ✗。
       只在**没搜过**的时候自动（有缓存就复用 ✓，避免每次切页都请求 ✗）。
       ⚠️ 必须判 STORE 非空 ✗ —— 首屏渲染时 STORE 可能还是 null ✗
       （踩过：`Cannot read properties of null (reading 'hot')` ✗）。 */
    if (STORE && !STORE.hot && !STORE.hotLoading) {
      const auto = (() => {
        const words = [];
        (DATA.tracks || []).forEach((t) => {
          String(t.name || '').split(/[\/、·]+/).forEach((x) => { const w = x.trim(); if (w.length >= 2) words.push(w); });
          (t.list || []).slice(0, 4).forEach((p) => {
            const w = String(p.name || '').replace(/[-_]+/g, ' ').replace(/\b(test|demo|new|old|v?\d+)\b/gi, '').trim();
            if (w.length >= 3) words.push(w);
          });
        });
        return Array.from(new Set(words)).slice(0, 2).join(' ') || 'robotics';
      })();
      doHot(auto);
    }
    /* AI：**调用 CodeScope 现成的 `/api/ai/chat`** ✓（配置读 localStorage['mc-ai-cfg'] ✓）
       不再自己存一份配置 ✗。 */
    const askAI = async (prompt) => {
      let cfg = {}; try { cfg = JSON.parse(localStorage.getItem('mc-ai-cfg') || '{}') || {}; } catch (_) {}
      if (!cfg.url || !cfg.key) { STORE.aiRes = { ok: false, error: '还没配 AI —— 请到 CodeScope 的 AI 面板配一次 ✓（这里会自动复用 ✓）' }; render(); return; }
      STORE.aiLoading = true; STORE.aiRes = null; render();
      try {
        const r = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cfg.url, key: cfg.key, model: cfg.model, timeoutMs: 300000,
            messages: [{ role: 'system', content: '你是科研助手。回答用简体中文，简洁具体，不要客套。' }, { role: 'user', content: prompt }] }) });
        const j = await r.json();
        /* 兼容两种返回形状：{ok,text} 或 OpenAI 原始 {choices:[{message:{content}}]} */
        if (j && j.ok === false) STORE.aiRes = { ok: false, error: String(j.error || '调用失败').slice(0, 300) };
        else {
          const txt = (j && j.text) || ((((j || {}).choices || [])[0] || {}).message || {}).content || (j && j.content) || '';
          STORE.aiRes = txt ? { ok: true, text: String(txt) } : { ok: false, error: 'AI 没有返回内容：' + JSON.stringify(j).slice(0, 200) };
        }
      } catch (e) { STORE.aiRes = { ok: false, error: '请求失败：' + e.message }; }
      STORE.aiLoading = false; render();
    };
    const aiHot = qv('#lw-ai-hot');
    if (aiHot) aiHot.onclick = () => {
      const items = ((STORE.hot || {}).items || []).slice(0, 10).map((h, i) => (i + 1) + '. ' + h.title + '（▲' + h.points + ' 💬' + h.comments + '）').join('\n');
      if (!items) { const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '先搜一次热点，再让 AI 总结 ✓'; return; }
      askAI('下面是 Hacker News 上关于「' + ((STORE.hotQ) || '') + '」的热门讨论：\n\n' + items +
        '\n\n请用中文：\n1) 3 句话概括这些讨论反映的技术趋势；\n2) 指出 2 个值得深入的方向；\n3) 给 3 条具体可执行的建议。');
    };
    const aiIdea = qv('#lw-ai-idea');
    if (aiIdea) aiIdea.onclick = () => {
      const tracks = (DATA.tracks || []).map((t) => t.name + '（' + t.projects + ' 个项目）').join('、');
      askAI('我的研究方向/项目分布是：' + (tracks || '机器人、嵌入式、论文') +
        '。\n\n请用中文给出 5 个**具体的**、可以在一到两周内启动的小选题，每个包含：\n- 题目\n- 为什么现在做（一句话）\n- 第一步做什么（一句话）\n要具体到能动手，不要泛泛而谈。');
    };
    /* AI 读选中的热点（把那条热点的标题 + HN 讨论喂给它）*/
    const aiRead = qv('#lw-ai-read');
    if (aiRead) aiRead.onclick = () => {
      const first = ((STORE.hot || {}).items || [])[0];
      if (!first) { const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '先搜一次热点 ✓'; return; }
      askAI('请用中文解读这条技术动态，面向一个做机器人/嵌入式的研究生：\n\n标题：' + first.title +
        '\n链接：' + first.url + '\n热度：▲' + first.points + ' · 💬' + first.comments +
        '\n\n请说：1) 它在讲什么（3 句）；2) 为什么值得关注；3) 我能从中借鉴什么（具体到做法）。');
    };
    /* 联网搜索：**复用 CodeScope 的 `/api/ai/web-search`** ✓ */
    const doWS = async () => {
      const inp = qv('#lw-ws-q');
      const query = String((inp && inp.value) || '').trim();
      if (!query) return;
      /* 搜索的 key 从 CodeScope 的配置里找（不同版本键名可能不同，逐个试 ✓）*/
      let sk = '', provider = '';
      try {
        const cfg = JSON.parse(localStorage.getItem('mc-ai-cfg') || '{}') || {};
        if (cfg.searchKey) { sk = cfg.searchKey; provider = cfg.searchProvider || 'tavily'; }
        else if (cfg.tavilyKey) { sk = cfg.tavilyKey; provider = 'tavily'; }
        else if (cfg.braveKey) { sk = cfg.braveKey; provider = 'brave'; }
      } catch (_) {}
      if (!sk) { STORE.wsRes = { ok: false, error: '没找到联网搜索的 Key —— 请在 CodeScope 里配置 Tavily / Brave ✓' }; STORE.wsQ = query; render(); return; }
      STORE.wsQ = query; STORE.wsLoading = true; STORE.wsRes = null; render();
      try {
        const r = await fetch('/api/ai/web-search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, key: sk, query }) });
        STORE.wsRes = await r.json();
      } catch (e) { STORE.wsRes = { ok: false, error: '请求失败：' + e.message }; }
      STORE.wsLoading = false; render();
    };
    const wsGo = qv('#lw-ws-go'); if (wsGo) wsGo.onclick = doWS;
    const wsInp = qv('#lw-ws-q'); if (wsInp) wsInp.onkeydown = (e) => { if (e.key === 'Enter') doWS(); };
    /* 今日面板：跳转 + 点待办跳到对应备忘录 ✓
       （注意：q / qa 是 bindMemoSide() 里的局部变量 ✗，这里不能用 ✗ —— 用原生查询 ✓）*/
    const view0 = document.getElementById('lifework-view');
    const gM = document.getElementById('lw-goto-memo'); if (gM) gM.onclick = () => { TAB = 'memo'; render(); };
    const gJ = document.getElementById('lw-goto-journal'); if (gJ) gJ.onclick = () => { TAB = 'journal'; render(); };
    const gQ = document.getElementById('lw-goto-quote'); if (gQ) gQ.onclick = () => { TAB = 'quote'; render(); };
    if (view0) view0.querySelectorAll('[data-todo-go]').forEach((el) => {
      el.onclick = () => { STORE.memoSel = el.dataset.todoGo; STORE.memoSmart = ''; STORE.memoTag = ''; saveStore(); TAB = 'memo'; render(); };
    });
    const q = (sel) => host.querySelector(sel);
    const qa = (sel) => Array.from(host.querySelectorAll(sel));
    qa('.lw-nav button').forEach((b) => {
      b.onclick = () => {
        JOURNAL_FLUSH();
        TAB = b.dataset.tab;
        render();
        /* ★ 进邮箱页时**重新拉一次账号配置** ✓ ——
           `loadMailAccounts` 平时只加载一次（防 render/fetch 乒乓 ✓），
           但「切到这个页签」是个自然且便宜（服务端读本地 JSON，约 10ms）的刷新点 ✓，
           配置真变了它自己会 render ✓，没变就什么都不做 ✓。 */
        if (TAB === 'mail') { loadMailAccounts(true); ensureMailLoad(); }
      };
    });
    const rf = q('#lw-refresh'); if (rf) rf.onclick = () => load(true);
    /* 顶栏的邮箱胶囊：点了直接进邮箱页 ✓ */
    const mb = q('#lw-mb');
    if (mb) mb.onclick = () => { JOURNAL_FLUSH(); TAB = 'mail'; render(); loadMailAccounts(true); ensureMailLoad(); };
    qa('[data-path]').forEach((el) => {
      el.onclick = () => { try { navigator.clipboard.writeText(el.dataset.path); const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '已复制路径：' + el.dataset.path; } catch (_) {} };
    });

    /* ── 备忘录（macOS 三栏）：列表 / 文件夹 / 标签 / 格式菜单 / 编辑 / 回收站 ── */
    const memoById = (id) => (STORE.memos || []).find((x) => x.id === id);
    const curMemo = () => memoById(STORE.memoSel) || (STORE.memos || []).filter((m) => !m.trash)[0];
    /* ── 备忘录正文：整篇一个 contenteditable，逐行实时渲染 ──
       和日记用同一套做法（.lw-ce / ceHtml ✓）：
         · 光标所在行 = **源码**（可编辑）· 其余行 = **渲染后的 HTML**（contenteditable=false）
         · 读回源码：可编辑行取 textContent，渲染行取 data-src
       ⚠️ 打字时**绝不重渲染** —— 那会把光标重置到行尾，快打时字符会跑到错误的位置 ✗。
          当前行本来就是源码、其他行也没变 → 只存盘就够了 ✓。
          只有「换行 / 点别的行 / 切源码模式」才重渲染 ✓。 */
    let memoCeIdx = (STORE && STORE.memoCurLine) || 0;
    const memoCeEl = () => q('#lw-memo-ce');
    const readCe = () => {
      const ce = memoCeEl(); if (!ce) return null;
      return Array.from(ce.querySelectorAll(':scope > .ln')).map((el) =>
        el.getAttribute('contenteditable') === 'false' ? String(el.dataset.src || '') : String(el.textContent || '')
      ).join('\n');
    };
    /* 用给定的文本重渲染（并可选把光标放回第 idx 行）。
       ⚠️ 不要用 renderMemoCe 来「先改后渲染」—— 它会先 readCe() 把**旧 DOM** 读回来，
          你刚改的东西会被覆盖掉 ✗。要改内容就用这个直接喂文本。 */
    const applyCe = (text, idx, keepFocus, caretOffset) => {
      const ce = memoCeEl(); if (!ce) return;
      const lines = String(text == null ? '' : text).split('\n');
      if (idx >= lines.length) idx = lines.length - 1;
      if (idx < 0) idx = 0;
      memoCeIdx = idx;
      ce.innerHTML = ceHtml(lines.join('\n'), idx, !!STORE.memoSource);
      STORE.memoCurLine = idx;
      ceAlignLineNumbers(ce);            /* 行号垂直对齐（各语法行高不同）✓ */
      if (!keepFocus) return;
      const all = Array.from(ce.querySelectorAll(':scope > .ln'));
      ceSetCaret(all[idx] || all[all.length - 1], caretOffset);
    };
    const renderMemoCe = (keepFocus) => applyCe(readCe() == null ? '' : readCe(), memoCeIdx, keepFocus);
    /* 对「光标所在行」做一次变换（格式按钮 / 插入清单 / 插入表格都用它）*/
    const editCurrentLine = (fn) => {
      const lines = String(readCe() == null ? '' : readCe()).split('\n');
      const i = Math.min(Math.max(0, memoCeIdx), Math.max(0, lines.length - 1));
      lines[i] = fn(String(lines[i] || ''));
      applyCe(lines.join('\n'), i, true);
      saveMemoText();
    };
    /* 把界面上的内容写回 cur.text（不落盘、**不删条目**）
       ★★ 守卫：编辑器显示的那条（MEMO_EDITOR_ID）必须和要写的那条（curMemo()）**是同一条** ✓
       为什么必须有：`curMemo()` 在 `memoSel` 为空时会回落到 `STORE.memos[0]` ✗ ——
       一旦编辑器 DOM 还停在上一条（筛选/切换后没重建编辑器），
       这一写就会把**界面上的内容灌进另一条备忘录** ✗✗（静默的数据损坏，比丢内容更糟）。
       宁可这次不写（用户下次操作会重建编辑器并重新同步），也绝不写错条目 ✓。 */
    const writeMemo = () => memoWriteFromEditor(memoWriteTarget());
    /* 只写不删的保存：光标操作 / 换行用它。
       ⚠️ 不能直接用 flushMemo —— 它在内容为空时会把整条删掉 ✗，
          那条规则是给「切走」用的，光标动一下就触发就完了。 */
    const saveMemoText = () => { if (writeMemo()) saveStore(); };
    /* 保存当前编辑内容（自动保存 / 切走 / 撤销前都用它）*/
    const flushMemo = () => {
      const cur = writeMemo(); if (!cur) return;
      /* ⚠️ 空的自动丢弃 ✗ —— 点「新建」后不输入就切走，会留下一堆「新备忘录」垃圾 ✗ */
      if (!cur.text.trim() || cur.text.trim() === "新备忘录") {
        STORE.memos = (STORE.memos || []).filter((x) => x.id !== cur.id);
        if (STORE.memoSel === cur.id) STORE.memoSel = "";
        saveStore();
        return;
      }
      STORE.memoSaved = true; saveStore();
      const st = document.getElementById("lw-memo-status");
      if (st) { st.textContent = "✓ 已保存"; st.classList.add("ok"); }
      setTimeout(() => { STORE.memoSaved = false; }, 1500);
    };
    let memoBuf = 0;
    const autoSave = () => { clearTimeout(memoBuf); memoBuf = setTimeout(flushMemo, 600); };
    const ti = q("#lw-memo-title");
    /* ⚠️ 输入时必须**同时**刷新派生视图（左侧列表摘要）——
       以前只 autoSave() ✗，于是「左边改了、左边列表不动」，
       要等别的操作触发整屏 render() 才追上来（用户反馈的左右不同步）。
       refreshMemoDerived 只碰列表，不重建编辑器 ✓（光标/选区不丢）。 */
    const onEdit = () => { snapMemo("edit"); refreshMemoDerived(); autoSave(); };
    if (ti) ti.oninput = onEdit;
    /* ⚠️ 变量名别用 `ce` —— 下面日记那段已经用了同名 const，同一个函数作用域会撞 ✗ */
    const memoCeNode = memoCeEl();
    if (memoCeNode) {
      memoCeNode.oninput = onEdit;
      /* 点别的行 → 那行变「当前行」（显示源码 ✓）*/
      memoCeNode.onmousedown = (e) => {
        if (STORE.memoSource) return;   /* 源码模式下每行都可编辑，不需要切换 ✗ */
        const ln = e.target && e.target.closest ? e.target.closest('.ln') : null;
        if (!ln || ln.classList.contains('cur')) return;
        e.preventDefault();
        saveMemoText();
        const all = Array.from(memoCeNode.querySelectorAll(':scope > .ln'));
        memoCeIdx = all.indexOf(ln);
        renderMemoCe(true);
      };
      /* Enter 换行：在光标行后面插一行空的，然后重渲染并把光标放过去
         ⚠️ 必须用 applyCe 直接喂新文本 —— 用 renderMemoCe 的话它会**再读一次旧 DOM**，
            刚 splice 出来的新行会被覆盖掉 ✗（实测踩过：按回车没反应、字全挤在一行）。 */
      memoCeNode.onkeydown = (e) => {
        /* ★ 行首退格 / 行尾 Delete 必须自己处理 —— 交给浏览器会把内容整片删掉 ✗
           （实测：按一次退格 4 行变 0 行）。详见 ceLineKey 的注释。 */
        if (ceLineKey(e, {
          ce: memoCeNode,
          index: memoCeIdx,
          readAll: () => (readCe() == null ? '' : readCe()),
          apply: (text, idx, keepFocus, caret) => { applyCe(text, idx, keepFocus, caret); saveMemoText(); },
        })) return;
        if (e.key !== 'Enter') return;
        e.preventDefault();
        saveMemoText();
        const lines = String(readCe() == null ? '' : readCe()).split('\n');
        /* ★ 在**光标处**把当前行切成两半，后半段移到新行 ✓。
           以前只会「在下面插一个空行」✗ —— 光标在行中间按回车时，后面的文字不跟着换行
           （用户反馈的「文字不跟着换行」）。光标取不到时退回行尾（= 老行为）✓。 */
        const curLine = String(lines[memoCeIdx] || '');
        const caretAt = ceCaretOffset(memoCeNode, memoCeIdx);
        const cut = caretAt == null ? curLine.length : Math.max(0, Math.min(caretAt, curLine.length));
        lines[memoCeIdx] = curLine.slice(0, cut);
        lines.splice(memoCeIdx + 1, 0, curLine.slice(cut));
        applyCe(lines.join('\n'), memoCeIdx + 1, true, 0);   /* 光标落到新行开头 ✓ */
        saveMemoText();
      };
      /* 初始化：把光标放到上次那一行（存过就恢复 ✓）*/
      renderMemoCe(true);
    }
    /* 撤销 / 重做：先把待保存的正文落进 cur.text，再回退（否则 REDO 那一帧是旧的 ✗） */
    /* 状态提示：⚠️ 定时器放**模块作用域** —— bind() 每次渲染都会重跑，
       放函数里的话快捷键处理器（只绑一次、捕获的是第一次的闭包）
       清不掉后来那次渲染留下的定时器 ✗。 */
    const flashMemoStatus = (text) => {
      const st = document.getElementById("lw-memo-status");
      if (!st) return;
      clearTimeout(MEMO_STATUS_TIMER);
      st.textContent = text; st.classList.add("ok");
      MEMO_STATUS_TIMER = setTimeout(() => {
        const s2 = document.getElementById("lw-memo-status");
        if (s2) s2.textContent = "✓ 已保存";
      }, 1600);
    };
    const mUndo = q("#lw-memo-undo"), mRedo = q("#lw-memo-redo");
    if (mUndo) mUndo.onclick = () => {
      flushMemo(); clearTimeout(memoBuf);
      if (undoMemo()) flashMemoStatus("↶ 已撤销"); else flashMemoStatus("没有可撤销的操作");
    };
    if (mRedo) mRedo.onclick = () => {
      flushMemo(); clearTimeout(memoBuf);
      if (redoMemo()) flashMemoStatus("↷ 已重做"); else flashMemoStatus("没有可重做的操作");
    };
    /* 双击正文 → 进入编辑（现在正文默认就可编辑，留着兼容旧交互）*/
    const prev = q("#lw-nt-prev");
    if (prev) prev.ondblclick = () => { flushMemo(); STORE.memoEditing = STORE.memoSel; saveStore(); render(); const t2 = document.getElementById("lw-memo-ce"); if (t2) t2.focus(); };
    /* 新建 */
    const mNew = q("#lw-memo-new");
    if (mNew) mNew.onclick = () => {
      flushMemo(); clearTimeout(memoBuf);
      closeMemoImgPreview();
      snapMemo("new");
      const id = "m" + Date.now();
      STORE.memos = STORE.memos || [];
      STORE.memos.unshift({ id, text: "新备忘录", folder: STORE.memoFolder || "备忘录", pin: false, at: Date.now(), edit: Date.now() });
      STORE.memoSel = id; STORE.memoEditing = id; STORE.memoTag = ""; saveStore(); render();
      const t2 = document.getElementById("lw-memo-title"); if (t2) { t2.focus(); t2.select(); }
    };
    /* 格式菜单 Aa */
    const aa = q("#lw-nt-aa");
    if (aa) aa.onclick = () => { flushMemo(); STORE.memoMenu = !STORE.memoMenu; saveStore(); render(); };
    qa("[data-mfmt]").forEach((el) => {
      el.onclick = () => {
        snapMemo("format");
        const id = STORE.memoSel;
        STORE.memoFmt = STORE.memoFmt || {};
        STORE.memoFmt[id] = el.dataset.mfmt;
        /* 前缀写进**光标所在行**（不再固定改第二行 ✗），导出 / 渲染都保留语义 ✓ */
        const pre = { title: "# ", h2: "## ", h3: "### ", mono: "`", ul: "- ", dash: "– ", ol: "1. ", quote: "> " }[el.dataset.mfmt] || "";
        editCurrentLine((line) => pre + line.replace(/^(#+ |[-–>] |1\. |`)/, ""));
        STORE.memoMenu = false; saveStore(); render();
      };
    });
    /* 格式按钮（B / I / U / S）：把**光标所在行**整行包起来。
       正文现在是逐行实时渲染 —— 光标行就是源码，改完立刻重渲染 ✓ */
    qa("[data-mwrap]").forEach((el) => {
      el.onclick = () => {
        snapMemo("format");
        const w = el.dataset.mwrap;
        editCurrentLine((line) => {
          if (!line) return line;
          /* 已经包着就去掉（再点一次 = 取消），否则包起来 */
          if (line.length > w.length * 2 && line.startsWith(w) && line.endsWith(w)) return line.slice(w.length, -w.length);
          return w + line + w;
        });
      };
    });
    /* 清单 / 表格 快捷插入（都插在光标行上/后面）*/
    const ck = q("#lw-nt-check");
    if (ck) ck.onclick = () => {
      snapMemo("insert");
      editCurrentLine((line) => line.replace(/^\s*[-*+]\s*(\[[ xX]\]\s*)?/, "- [ ] "));
    };
    const tb = q("#lw-nt-table");
    if (tb) tb.onclick = () => {
      snapMemo("insert");
      const lines = String(readCe() == null ? '' : readCe()).split('\n');
      const i = Math.min(Math.max(0, memoCeIdx), Math.max(0, lines.length - 1));
      lines.splice(i + 1, 0, "| 列1 | 列2 |", "| --- | --- |", "|  |  |", "");
      applyCe(lines.join('\n'), i + 1, true);
      saveMemoText();
    };
    /* 置顶 / 导出 / 删除 */
    qa("[data-mpin]").forEach((el) => { el.onclick = () => { const m = memoById(el.dataset.mpin); if (m) { snapMemo("pin"); m.pin = !m.pin; saveStore(); render(); } }; });
    const mExp = q("#lw-memo-export");
    if (mExp) mExp.onclick = () => {
      const cur = curMemo(); if (!cur) return;
      writeMemo();   /* 先把编辑器里的最新内容收进来，否则导出的是上次保存的 ✗ */
      const blob = new Blob([String(cur.text || "")], { type: "text/markdown;charset=utf-8" });
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(blob);
      a2.download = (String(cur.text || "").split("\n")[0] || "note").slice(0, 40).replace(/[\\/:*?"<>|]/g, "_") + ".md";
      a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 3000);
    };
    /* 导出为图片：点「图片」**先出预览**（编辑区切成「左编辑 / 右图片预览」两栏），
       确认后再点预览栏里的「下载 PNG」✓ —— 不再一点就直接落盘（用户要求）。 */
    const memoImageParts = () => {
      const cur = curMemo(); if (!cur) return null;
      writeMemo();   /* 先收拢编辑器内容，否则生成的是上次保存的 ✗ */
      const lines = String(cur.text || "").split("\n");
      const title = (lines[0] || "备忘录").trim() || "备忘录";
      const body = lines.slice(1).join("\n");
      const d = new Date(cur.edit || cur.at || Date.now());
      const pad2 = (n) => String(n).padStart(2, "0");
      const when = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 "
        + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
      const base = title.slice(0, 40).replace(/[\\/:*?"<>|]/g, "_") || "note";
      return { title, body: mdToHtml(body) || '<p style="color:#5c5a50">（正文还是空的）</p>', when, base };
    };
    const refreshMemoImage = async () => {
      const parts = memoImageParts(); if (!parts) return;
      closeMemoImgPreview();
      MEMO_IMG_PREVIEW = { url: "", w: 0, h: 0, blob: null, base: parts.base, busy: true, err: "" };
      render();                       /* 先把预览栏画出来（带「正在生成…」）*/
      try {
        const r = await memoRenderImage(parts.title, parts.body, parts.when);
        /* 生成期间预览可能已被关掉 / 换了条目 → 别把结果塞回去，顺手回收 blob ✓ */
        if (!MEMO_IMG_PREVIEW) { try { URL.revokeObjectURL(r.url); } catch (_) {} return; }
        MEMO_IMG_PREVIEW = { url: r.url, w: r.w, h: r.h, blob: r.blob, base: parts.base, busy: false, err: "" };
        flashMemoStatus("预览已生成 · " + r.w + "×" + r.h);
      } catch (error) {
        MEMO_IMG_PREVIEW = { url: "", w: 0, h: 0, blob: null, base: parts.base, busy: false, err: String(error.message || error) };
        flashMemoStatus("生成图片失败：" + (error.message || error));
      }
      render();
    };
    const mImg = q("#lw-memo-image");
    if (mImg) mImg.onclick = () => {
      if (MEMO_IMG_PREVIEW) { refreshMemoImage(); return; }   /* 已经开着 → 重新生成 ✓ */
      MEMO_IMG_PREVIEW = { url: "", w: 0, h: 0, blob: null, base: "memo", busy: true, err: "" };
      refreshMemoImage();
    };
    const mImgSave = q("#lw-memo-img-save");
    if (mImgSave) mImgSave.onclick = () => {
      if (!MEMO_IMG_PREVIEW || !MEMO_IMG_PREVIEW.blob) return;
      memoDownloadImage(MEMO_IMG_PREVIEW, MEMO_IMG_PREVIEW.base);
      flashMemoStatus("已下载 PNG · " + MEMO_IMG_PREVIEW.w + "×" + MEMO_IMG_PREVIEW.h);
    };
    const mImgClose = q("#lw-memo-img-close");
    if (mImgClose) mImgClose.onclick = () => { closeMemoImgPreview(); render(); };
    const mDel = q("#lw-memo-del");
    if (mDel) mDel.onclick = () => {
      const cur = curMemo(); if (!cur) return;
      /* 先把编辑器里最新内容收进 cur.text —— 但**不走 flushMemo**：
         它会顺手把空内容整条删掉，那条规则是给「切走」用的，删除按钮不需要。 */
      writeMemo();
      clearTimeout(memoBuf);                 /* 别再让排队的自动保存回来搅一遍 */
      snapMemo("delete");                    /* 删除可撤销 ✓ */
      cur.trash = true; STORE.memoSel = ""; STORE.memoEditing = "";
      saveStore(); render();
      flashMemoStatus("已移到回收站 · ⌘Z 可撤销");
    };
    /* 回收站 */
    qa("[data-mrestore]").forEach((el) => { el.onclick = () => { const m = memoById(el.dataset.mrestore); if (m) { snapMemo("restore"); m.trash = false; saveStore(); render(); } }; });
    qa("[data-mkill]").forEach((el) => { el.onclick = () => { snapMemo("kill"); STORE.memos = (STORE.memos || []).filter((x) => x.id !== el.dataset.mkill); saveStore(); render(); }; });
    const tEmpty = q("#lw-trash-empty");
    if (tEmpty) tEmpty.onclick = () => { if (!confirm("清空回收站？无法恢复。")) return; snapMemo("empty-trash"); STORE.memos = (STORE.memos || []).filter((x) => !x.trash); saveStore(); render(); };
    /* 快捷键 */
    if (!bind._keys) {
      bind._keys = (e) => {
        if (!document.getElementById("lifework-view")) return;
        if (!(e.metaKey || e.ctrlKey)) return;
        const k = String(e.key || "").toLowerCase();
        if (k === "f") { e.preventDefault(); const i = document.getElementById("lw-memo-q"); if (i) { i.focus(); i.select(); } }
        else if (k === "n" && TAB === "memo") { e.preventDefault(); const b2 = document.getElementById("lw-memo-new"); if (b2) b2.click(); }
        else if (k === "z" && TAB === "memo") {
          /* 光标在输入框里 → 让浏览器做**原生文本撤销**（用户预期），不拦 ✓。
             原生撤销也会触发 input 事件，所以预览/列表照样会跟着刷新 ✓。
             光标不在输入框（例如刚点完删除/格式）→ 走应用级撤销。 */
          const ae = document.activeElement;
          if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
          e.preventDefault();
          const ok = e.shiftKey ? redoMemo() : undoMemo();
          flashMemoStatus(ok ? (e.shiftKey ? "↷ 已重做" : "↶ 已撤销") : (e.shiftKey ? "没有可重做的操作" : "没有可撤销的操作"));
        }
      };
      document.addEventListener("keydown", bind._keys);
    }

    /* ── 书签（好词好句）── */
    const qById = (id) => (STORE.quotes || []).find((x) => x.id === id);
    const addQuote = () => {
      const t = q("#lw-bk-text"), f = q("#lw-bk-from"), g = q("#lw-bk-tag");
      const text = ((t && t.value) || "").trim(); if (!text) return;
      STORE.quotes = STORE.quotes || [];
      STORE.quotes.unshift({ id: "q" + Date.now(), text, from: ((f && f.value) || "").trim(), tag: ((g && g.value) || "").trim(), at: Date.now() });
      saveStore(); render();
      const t2 = document.getElementById("lw-bk-text"); if (t2) t2.focus();
    };
    const bkAdd = q("#lw-bk-add"); if (bkAdd) bkAdd.onclick = addQuote;
    const bkTa = q("#lw-bk-text");
    if (bkTa) bkTa.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); addQuote(); } };
    qa("[data-bktag]").forEach((el) => { el.onclick = () => { STORE.quoteTag = el.dataset.bktag || ""; saveStore(); render(); }; });
    qa("[data-bk-pin]").forEach((el) => { el.onclick = () => { const x = qById(el.dataset.bkPin); if (x) { x.pin = !x.pin; saveStore(); render(); } }; });
    qa("[data-bk-del]").forEach((el) => { el.onclick = () => { STORE.quotes = (STORE.quotes || []).filter((x) => x.id !== el.dataset.bkDel); saveStore(); render(); }; });
    qa("[data-bk-copy]").forEach((el) => {
      el.onclick = () => {
        const x = qById(el.dataset.bkCopy); if (!x) return;
        try { navigator.clipboard.writeText(x.text + (x.from ? "\n—— " + x.from : "")); const s2 = document.getElementById("lw-sub"); if (s2) s2.textContent = "已复制书签"; } catch (_) {}
      };
    });
    const bkRand = q("[data-bk-random]");
    if (bkRand) bkRand.onclick = () => {
      const list = STORE.quotes || []; if (!list.length) return;
      /* 随机挑一条**不等于当前**的 ✓（只有一条时就保持 ✓）*/
      let pick = list[Math.floor(Math.random() * list.length)];
      if (list.length > 1 && STORE.quoteHero === pick.id) {
        pick = list[(list.indexOf(pick) + 1) % list.length];
      }
      STORE.quoteHero = pick.id;
      saveStore(); render();
      const s2 = document.getElementById('lw-sub');
      if (s2) s2.textContent = '❝ ' + pick.text.slice(0, 40) + (pick.text.length > 40 ? '…' : '');
    };
    const bkQ = q("#lw-bk-q");
    if (bkQ) bkQ.oninput = () => { STORE.quoteQ = bkQ.value; render(); const i2 = document.getElementById("lw-bk-q"); if (i2) { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } };

    /* ── 天气：点胶囊换地区 ── */
    const wxEl = q(".lw-wx");
    if (wxEl) {
      wxEl.style.cursor = "pointer";
      wxEl.title = "点击切换地区";
      wxEl.onclick = () => {
        const c = prompt("输入城市（中文或英文）：", CITY);
        if (c && c.trim()) { CITY = c.trim(); STORE.city = CITY; saveStore(true); load(true); }
      };
    }

    /* ── 日记：把编辑框里的**未落盘内容**先写回条目 ──
       ⚠️ 这是「改分类丢内容」的第二半原因 ✗ ——
       编辑框的自动保存是 **600ms 防抖** ✗，而切换分类 / 切日期 / 点筛选
       都会直接 `render()` ✗ → 整个 DOM（含编辑框）被重建 ✓ → 防抖还没触发，
       **刚敲的字就没了** ✗。所以凡是会 render() 的日记操作，都先调 JOURNAL_FLUSH() ✓。
       真实实现在下面的 `if (ce) {...}` 里（那里才拿得到 DOM），这里先占位 ✓。 */
    JOURNAL_FLUSH = () => { };
    /* 只填了模板 / 全空 → 不算"写过" ✓（否则模板会被当成正文写进那一天 ✗，
       日历上就白点一片 ✗ —— 和 #lw-j-save 用同一套判断 ✓）*/
    const jIsTplOnly = (txt) => {
      const t = String(txt == null ? '' : txt).trim();
      return !t || t === J_TPL.daily.text.trim() || t === J_TPL.research.text.trim() || t === J_TPL.review.text.trim();
    };
    /* ── 日记：月历选择日期 ── */
    qa("[data-jday]").forEach((el) => {
      el.onclick = () => { JOURNAL_FLUSH(); STORE.journalSel = el.dataset.jday; STORE.journalMonth = el.dataset.jday.slice(0, 7); saveStore(); render(); };
    });
    const jDel = q('#lw-j-del');
    if (jDel) jDel.onclick = () => {
      const k = STORE.journalSel;
      if (!k || !confirm('删除 ' + k + ' 的日记？')) return;
      JOURNAL_FLUSH();
      STORE.journal = (STORE.journal || []).filter((x) => x.date !== k);
      saveStore(); render();
    };
    /* ── 左栏：每个面板单独拖高（记住到 STORE ✓）── */
    const PANEL_KEY = { cal: 'jpH1', stat: 'jpH2', recent: 'jpH3', cat: 'jpH4', wx: 'jpH5' };
    qa('[data-vgrip]').forEach((g, idx) => {
      lwGrab(g, {
        down: (e) => {
          const panel = qa('[data-jpanel]')[idx];
          if (!panel) return null;
          g.classList.add('on');
          return { panel, startY: e.clientY, startH: panel.offsetHeight };
        },
        move: (ev, sess) => {
          sess.panel.style.height = Math.max(90, Math.min(700, sess.startH + (ev.clientY - sess.startY))) + 'px';
        },
        up: (ev, sess) => {
          g.classList.remove('on');
          const key = PANEL_KEY[sess.panel.dataset.jpanel];
          if (key) { STORE[key] = sess.panel.offsetHeight; saveStore(); }
        },
      });
    });
    /* ── 分类：筛选 / 新增 / 删除 / 给日记设分类 ── */
    qa('[data-jcat]').forEach((el) => {
      el.onclick = (ev) => {
        if (ev.target && ev.target.dataset && ev.target.dataset.jcatdel) return;
        JOURNAL_FLUSH();                 /* ★ 先落盘，再 render（否则防抖里的字被重建冲掉 ✗）*/
        STORE.journalCat = el.dataset.jcat || ''; saveStore(); render();
      };
    });
    qa('[data-jcatdel]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const c = el.dataset.jcatdel;
        if (!confirm('删除分类「' + c + '」？\n日记不会被删，只是取消这个分类。')) return;
        JOURNAL_FLUSH();
        STORE.journalCats = (STORE.journalCats || []).filter((x) => x !== c);
        (STORE.journal || []).forEach((j) => { if (j.cat === c) j.cat = ''; });
        if (STORE.journalCat === c) STORE.journalCat = '';
        saveStore(); render();
      };
    });
    const catAdd = q('#lw-jcat-add'), catIn = q('#lw-jcat-new');
    if (catAdd && catIn) {
      const add = () => {
        const v = catIn.value.trim().slice(0, 12); if (!v) return;
        STORE.journalCats = STORE.journalCats || ['学习', '工作', '生活', '科研'];
        if (!STORE.journalCats.includes(v)) STORE.journalCats.push(v);
        JOURNAL_FLUSH();                 /* 同上：新增分类会 render ✗ */
        saveStore(); render();
      };
      catAdd.onclick = add;
      catIn.onkeydown = (e) => { if (e.key === 'Enter') add(); };
    }
    /* ── 给「当前这一天」设分类 ──
       ★ 关键顺序：**先 flush 落盘，再改 cat，最后 render** ✓
         ① 先 flush  → 把编辑框里还没防抖落盘的字写进条目 ✓
         ② 再改 cat  → 只动分类字段，text 一个字节都不碰 ✓
         ③ 最后 render → 用新分类重建界面 ✓
       任何一步颠倒（尤其 ② ③ 之间再 flush）都可能把界面上的旧内容盖回去 ✗。 */
    const catSel = q('#lw-j-catsel');
    if (catSel) catSel.onchange = () => {
      JOURNAL_FLUSH();                   /* ① */
      const k = STORE.journalSel;
      const cur2 = (STORE.journal || []).find((x) => x.date === k);
      /* 这天还没写 → 别硬造一条空日记 ✓，提示用户先写 */
      if (!cur2) { const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '先写一篇再设分类 ✓'; return; }
      cur2.cat = catSel.value;          /* ② */
      saveStore(); render();            /* ③ */
    };
    /* ── 拖拽调整：左栏宽度 / 编辑区高度（记住到 STORE ✓）── */
    const grip = q('#lw-jr-grip'), hgrip = q('#lw-jr-hgrip');
    const jrL = q('#lw-jr-l'), jrE = q('#lw-jr-edit'), jrR = q('.lw-jr-r');
    if (grip && jrL && jrR) {
      lwGrab(grip, {
        down: (e) => {
          grip.classList.add('on');
          return {
            startX: e.clientX, startW: jrL.offsetWidth,
            totalW: (jrL.parentElement || {}).clientWidth || window.innerWidth,
          };
        },
        move: (ev, sess) => {
          const w = Math.max(220, Math.min(sess.totalW - 300, sess.startW + (ev.clientX - sess.startX)));
          jrL.style.width = w + 'px';
        },
        up: () => { grip.classList.remove('on'); STORE.journalLeftW = jrL.offsetWidth; saveStore(); },
      });
    }
    if (hgrip && jrE) {
      lwGrab(hgrip, {
        down: (e) => {
          hgrip.classList.add('on');
          return {
            startY: e.clientY, startH: jrE.offsetHeight,
            wrapH: (jrE.parentElement || {}).clientHeight || window.innerHeight,
          };
        },
        move: (ev, sess) => {
          const h = Math.max(160, Math.min(sess.wrapH - 120, sess.startH + (ev.clientY - sess.startY)));
          jrE.style.height = h + 'px';
          const bd = document.getElementById('lw-j-bd'), ta = document.getElementById('lw-j-text');
          if (bd && ta) { const h2 = Math.max(80, h - 170); ta.style.height = h2 + 'px'; bd.style.height = h2 + 'px'; }
        },
        up: () => { hgrip.classList.remove('on'); STORE.journalEditH = jrE.offsetHeight; saveStore(); },
      });
    }
    /* ── contenteditable 实时渲染 ──
       规则：**光标所在行 = 源码 ✓，其他行 = 渲染 ✓**（Obsidian 的做法 ✓）*/
    const ce = q('#lw-j-ce');
    if (ce) {
      let ceIdx = (STORE.journalCurLine || 0);
      /* 把 DOM 读回源码：当前行取 textContent ✓，其他行取 data-src ✓ */
      const readAll = () => Array.from(ce.querySelectorAll(':scope > .ln')).map((el) => {
        const isCur = el.classList.contains('cur');
        return isCur ? String(el.textContent || '') : String(el.dataset.src || el.textContent || '');
      }).join('\n');
      const persist = () => {
        const txt = readAll().replace(/\s+$/, '');
        /* ⚠️ journalSel 为空时**不能**写出 date 缺失的条目 ——
           那会让「最近写过」渲染时 j.date.slice() 抛错、**整页日记崩掉** ✗（实测踩过）。
           兜底用今天（本地日期，别用 toISOString —— 那是 UTC，跨时区会差一天 ✗）。 */
        const now = new Date();
        const k = STORE.journalSel || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'));
        STORE.journalSel = k;
        STORE.journal = STORE.journal || [];
        const hit = STORE.journal.find((x) => x.date === k);
        if (hit) { hit.text = txt; hit.at = Date.now(); } else STORE.journal.unshift({ date: k, text: txt, at: Date.now() });
        saveStore();
      };
      /* 用给定文本重渲染（光标可指定字符偏移）。renderCe 是它的「读回 DOM 再渲染」版本 ✓ */
      const applyCeJ = (text, idx, keepFocus, caretOffset) => {
        const lines = String(text == null ? '' : text).split('\n');
        if (idx >= lines.length) idx = lines.length - 1;
        if (idx < 0) idx = 0;
        ceIdx = idx;
        ce.innerHTML = ceHtml(lines.join('\n'), idx);
        STORE.journalCurLine = idx;
        ceAlignLineNumbers(ce);          /* 行号垂直对齐（各语法行高不同）✓ */
        if (keepFocus) ceSetCaret(ce.querySelectorAll(':scope > .ln')[idx], caretOffset);
      };
      const renderCe = (keepFocus) => applyCeJ(readAll(), ceIdx, keepFocus);
      let cebuf = 0;
      /* ⚠️ 打字时**绝不重渲染** ✗ ——
         之前 oninput 里调 renderCe() ✗ → 每次都把光标**重置到行尾** ✗ →
         打字快的时候字符会跑到错误的位置 ✗（用户报的"打字有 BUG" ✗）。
         其实当前行本来就是**源码**（不需要渲染 ✓），其他行也没变 ✓
         → **只存盘就够了** ✓。只有「换行 / 切行 / 点别的行」才需要重渲染 ✓。 */
      ce.oninput = () => {
        clearTimeout(cebuf);
        cebuf = setTimeout(() => {
          persist();
          const s2 = document.getElementById('lw-sub');
          if (s2) s2.textContent = '✓ 已自动保存';
        }, 600);
      };
      /* ★ 真正的 flush：把编辑框内容**立刻**落盘（不等 600ms 防抖）✓
         用于「切分类 / 切日期 / 点筛选 / 关页面」这些会 render() 或会离开的动作 ✓。
         三种情况**不写**，避免制造垃圾数据 ✗：
           ① 这天本来没条目，内容又只是模板/空 → 不写 ✓（否则日历白点一片 ✗）
           ② 有条目、但内容和库里**一模一样** → 不写 ✓（免得白刷 at 时间戳 ✗）
           ③ 防抖定时器清掉 ✓（否则它稍后会在**重建后的新 DOM** 上再 persist 一次 ✗）*/
      JOURNAL_FLUSH = () => {
        clearTimeout(cebuf);
        const k = STORE.journalSel;
        const hit = k ? (STORE.journal || []).find((x) => x.date === k) : null;
        const txt = readAll().replace(/\s+$/, '');
        if (!hit && jIsTplOnly(txt)) return;       /* ① */
        if (hit && txt === String(hit.text == null ? '' : hit.text)) return;  /* ② */
        persist();
      };
      /* 点任意行 → 那行变成"当前行"（显示源码 ✓）*/
      ce.onmousedown = (e) => {
        const ln = e.target && e.target.closest ? e.target.closest('.ln') : null;
        if (!ln || ln.classList.contains('cur')) return;
        e.preventDefault();
        persist();
        const all = Array.from(ce.querySelectorAll(':scope > .ln'));
        ceIdx = all.indexOf(ln);
        renderCe(true);
      };
      /* Enter 换行 / 行首退格 / 行尾 Delete */
      ce.onkeydown = (e) => {
        /* ★ 和备忘录同一套：行首退格 / 行尾 Delete 必须自己拦 ✗
           交给浏览器的话，它会去合并「上一个 contenteditable=false 的渲染行」，
           实测会把整篇内容删光 ✗（详见 ceLineKey 的注释）。 */
        if (ceLineKey(e, {
          ce,
          index: ceIdx,
          readAll,
          apply: (text, idx, keepFocus, caret) => { applyCeJ(text, idx, keepFocus, caret); persist(); },
        })) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          persist();
          const lines = readAll().split('\n');
          /* ★ 和备忘录同一套：在**光标处**把当前行切成两半 ✓
             （以前只在下面插空行 ✗，行中间回车时后半段不跟着走）*/
          const curLine = String(lines[ceIdx] || '');
          const caretAt = ceCaretOffset(ce, ceIdx);
          const cut = caretAt == null ? curLine.length : Math.max(0, Math.min(caretAt, curLine.length));
          lines[ceIdx] = curLine.slice(0, cut);
          lines.splice(ceIdx + 1, 0, curLine.slice(cut));
          applyCeJ(lines.join('\n'), ceIdx + 1, true, 0);
        }
      };
      /* 初始化：把光标放到当前行 ✓ */
      renderCe(true);
    }
    /* 工具栏：插入标题 / 清单项 */
    /* ⚠️ 这三个按钮是**直接改 DOM**（不走 applyCeJ）✗ → 改完必须立刻落盘 ✓，
       否则 STORE 里还是旧文本 → 标题的"已写 N 字"、左栏列表都会显示错的 ✗ */
    const jMd2 = q('#lw-j-md');
    if (jMd2) jMd2.onclick = () => {
      const c2 = q('#lw-j-ce'); if (!c2) return;
      const lines = Array.from(c2.querySelectorAll(':scope > .ln')).map((el) => el.classList.contains('cur') ? String(el.textContent || '') : String(el.dataset.src || ''));
      const i = STORE.journalCurLine || 0;
      lines[i] = '## ' + String(lines[i] || '').replace(/^#{1,3}\s*/, '');
      c2.innerHTML = ceHtml(lines.join('\n'), i);
      ceAlignLineNumbers(c2);
      const cur = c2.querySelector(':scope > .ln.cur'); if (cur) cur.focus();
      JOURNAL_FLUSH();
    };
    const jCk2 = q('#lw-j-ck');
    if (jCk2) jCk2.onclick = () => {
      const c2 = q('#lw-j-ce'); if (!c2) return;
      const lines = Array.from(c2.querySelectorAll(':scope > .ln')).map((el) => el.classList.contains('cur') ? String(el.textContent || '') : String(el.dataset.src || ''));
      const i = STORE.journalCurLine || 0;
      lines[i] = '- [ ] ' + String(lines[i] || '').replace(/^\s*[-*+]\s*(\[[ xX]\]\s*)?/, '');
      c2.innerHTML = ceHtml(lines.join('\n'), i);
      ceAlignLineNumbers(c2);
      const cur = c2.querySelector(':scope > .ln.cur'); if (cur) cur.focus();
      JOURNAL_FLUSH();
    };
    qa('[data-jtpl]').forEach((btn) => {
      btn.onclick = () => {
        const tpl = J_TPL[btn.dataset.jtpl]; if (!tpl) return;
        const c2 = document.getElementById('lw-j-ce'); if (!c2) return;
        const lines = Array.from(c2.querySelectorAll(':scope > .ln')).map((el) => el.classList.contains('cur') ? String(el.textContent || '') : String(el.dataset.src || ''));
        const curTxt = lines.join('\n').trim();
        let next = tpl.text;
        if (curTxt && !confirm('当前已有内容。\n\n确定 = 替换成模板　取消 = 追加到末尾')) next = curTxt.replace(/\s*$/, '') + '\n\n' + tpl.text;
        c2.innerHTML = ceHtml(next, 0);
        ceAlignLineNumbers(c2);
        STORE.journalCurLine = 0;
        const cur = c2.querySelector(':scope > .ln.cur'); if (cur) cur.focus();
        JOURNAL_FLUSH();
        const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '已插入「' + tpl.name + '」模板，记得保存 ✓';
      };
    });
    const autoTpl = q('#lw-j-autotpl');
    if (autoTpl) autoTpl.onchange = () => { STORE.journalAutoTpl = autoTpl.checked; saveStore(); };
    const jPrev = q("#lw-j-prev"), jNext = q("#lw-j-next"), jToday = q("#lw-j-today");
    const shiftMonth = (n) => {
      JOURNAL_FLUSH();                   /* ★ 翻月会 render ✗ → 先落盘 */
      const d = new Date((STORE.journalMonth || new Date().toISOString().slice(0, 7)) + "-01T00:00:00");
      d.setMonth(d.getMonth() + n);
      STORE.journalMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      saveStore(); render();
    };
    if (jPrev) jPrev.onclick = () => shiftMonth(-1);
    if (jNext) jNext.onclick = () => shiftMonth(1);
    if (jToday) jToday.onclick = () => {
      JOURNAL_FLUSH();                   /* ★ 同上 */
      const d = new Date();
      STORE.journalMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      STORE.journalSel = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      saveStore(); render();
    };
    const jSave = q('#lw-j-save');
    if (jSave) jSave.onclick = () => {
      const k = STORE.journalSel;
      const c2 = document.getElementById('lw-j-ce');
      const text = c2 ? Array.from(c2.querySelectorAll(':scope > .ln'))
        .map((el) => el.classList.contains('cur') ? String(el.textContent || '') : String(el.dataset.src || ''))
        .join('\n').replace(/\s+$/, '') : '';
      /* 只填了模板、没动过 → 不算写 ✓（免得日历上白点一片 ✗）*/
      if (jIsTplOnly(text)) {
        const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '还只填了模板 —— 补两句再保存 ✓';
        return;
      }
      STORE.journal = STORE.journal || [];
      const hit = STORE.journal.find((x) => x.date === k);
      if (hit) { hit.text = text; hit.at = Date.now(); }
      else STORE.journal.unshift({ date: k, text, at: Date.now() });
      saveStore(); render();
      const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '已保存今天的日记';
    };
    qa('[data-jdel]').forEach((el) => {
      el.onclick = () => {
        JOURNAL_FLUSH();                 /* ★ 先落盘，再删（删的是别的一天，别把当前这天弄丢 ✗）*/
        STORE.journal = (STORE.journal || []).filter((x) => x.date !== el.dataset.jdel);
        saveStore(); render();
      };
    });

    /* ── 论文检索 ── */
    const pGo = q('#lw-paper-go');
    const doSearch = async (kw) => {
      const input = q('#lw-paper-q');
      const key = (kw || (input && input.value) || '').trim();
      if (!key) return;
      STORE.paperQ = key; STORE.paperLoading = true; render();
      try {
        const r = await fetch('/api/life/papers?max=14&q=' + encodeURIComponent(key), { cache: 'no-store' });
        STORE.paperRes = await r.json();
      } catch (e) { STORE.paperRes = { ok: false, error: '检索失败：' + e.message }; }
      STORE.paperLoading = false; render();
    };
    if (pGo) pGo.onclick = () => doSearch();
    const pQ = q('#lw-paper-q');
    if (pQ) pQ.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
    qa('.lw-kw').forEach((el) => { el.onclick = () => doSearch(el.dataset.kw); });

    /* ── 邮箱配置 ── */
    /* 进邮箱页就从**服务端**拉一次配置 ✓
       （权威在 life-mail.json；以前只 POST 不 GET ✗ → 刷新后全变「未配置」）*/
    /* 邮箱：配置字段 / 测试 / 发信的绑定在下面；收件箱三栏的绑定走 bindMail() ✓
       ⚠️ 顺序：先 bindMail() 再 ensureMailLoad() —— 后者会异步拉数据并调
          renderMailPane()，那时 DOM 和绑定都得已经就位 ✓ */
    bindMail();
    if (TAB === 'mail') { loadMailAccounts(); ensureMailLoad(); }
    /* 填了邮箱地址就自动补 SMTP / IMAP（认得出服务商的话）✓
       只在**空**的时候补，别覆盖用户手填的值 ✓ */
    qa('[data-mail][data-f="user"]').forEach((inp) => {
      inp.oninput = () => {
        const k = inp.dataset.mail;
        const g = mailGuess(inp.value);
        if (!g) return;
        const put = (f, v) => {
          const el = qa('[data-mail="' + k + '"][data-f="' + f + '"]')[0];
          if (el && !String(el.value || '').trim()) el.value = v;
        };
        put('host', g.host); put('port', g.port); put('imapHost', g.imapHost); put('imapPort', g.imapPort);
      };
    });
    /* 🔔 新邮件提醒开关 —— 打开时才申请系统通知权限 ✓（不自动弹，那很打扰 ✗）*/
    const mNotify = q('#lw-mail-notify');
    if (mNotify) mNotify.onchange = () => {
      STORE.mailNotify = mNotify.checked;
      saveStore();
      const s = document.getElementById('lw-sub');
      if (mNotify.checked) {
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
        } catch (_) { }
        /* 刚打开时基线可能还没有 → 补拉一次，这样下一条新邮件就能提醒 ✓ */
        if (MAIL_SEEN_TOTAL === null) mailLoadStatus(false);
        ensureMailStatusTimer();
        if (s) s.textContent = '已开启新邮件提醒 ✓';
      } else {
        mailHideToast();
        if (s) s.textContent = '已关闭新邮件提醒';
      }
    };
    qa('[data-mailsave]').forEach((btn) => {      btn.onclick = async () => {
        const k = btn.dataset.mailsave;
        const acc = Object.assign({}, STORE.mailAcc || {});
        const cur = Object.assign({}, acc[k] || {});
        qa('[data-mail="' + k + '"]').forEach((inp) => { cur[inp.dataset.f] = inp.value; });
        acc[k] = cur;
        STORE.mailAcc = acc;
        saveStore();
        try { await fetch('/api/life/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: { [k]: cur } }) }); } catch (_) {}
        const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '邮箱配置已保存（只存本机）';
        /* ⚠️ 只重新拉**邮箱账号** ✓ —— 以前调 `load(true)` ✗，
           那会把本机扫描 + 天气全重跑一遍（几秒），只为刷新一个账号配置 ✗。 */
        loadMailAccounts(true).then(() => { if (TAB === 'mail') { MAIL_KICKED = ''; render(); ensureMailLoad(); } });
      };
    });

    /* ── 测试连接 / 发信 ──
       都交给服务端做（密码不回传前端，服务端从 life-mail.json 里取 ✓）。
       界面上把每一步都列出来，卡在哪一步一眼能看见 ✓。 */
    const mailFields = (k) => {
      const out = {};
      qa('[data-mail="' + k + '"]').forEach((inp) => { out[inp.dataset.f] = inp.value; });
      return out;
    };
    const mailResult = (k, html) => {
      const host = document.getElementById('lw-mail-result-' + k);
      if (host) host.innerHTML = html;
    };
    const mailSteps = (title, r) => {
      const head = r && r.ok
        ? '<div class="ok">✓ ' + esc(title) + '</div>'
        : '<div class="err">✗ ' + esc((r && r.error) || '失败') + '</div>';
      const list = ((r && r.steps) || []).map((s) => '<li class="step">' + esc(s) + '</li>').join('');
      return head + (list ? '<ol>' + list + '</ol>' : '');
    };
    const mailPost = async (path, payload) => {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return res.json();
    };
    qa('[data-mailtest]').forEach((btn) => {
      btn.onclick = async () => {
        const k = btn.dataset.mailtest;
        btn.disabled = true;
        mailResult(k, '<div class="step">正在连接…</div>');
        try {
          const r = await mailPost('/api/life/mail/test', { key: k, account: mailFields(k) });
          mailResult(k, mailSteps('连接 + 认证通过', r));
        } catch (error) { mailResult(k, '<div class="err">✗ ' + esc(String(error.message || error)) + '</div>'); }
        btn.disabled = false;
      };
    });
    const mailSend = async (k, selfOnly) => {
      const val = (sel, f) => { const el = q(sel); return el ? el.value : ''; };
      const to = selfOnly ? val('[data-mail="' + k + '"][data-f="user"]') : val('[data-msend="' + k + '"][data-f="to"]');
      const subject = selfOnly ? '码境 CodeScope · 发信测试' : val('[data-msend="' + k + '"][data-f="subject"]');
      const body = selfOnly
        ? '这是一封来自「码境 CodeScope · 个人管理面板」的测试邮件。\n\n看到它说明这台机器的 SMTP 配置可以正常发信 ✓'
        : val('[data-msend="' + k + '"][data-f="body"]');
      if (!String(to).trim()) { mailResult(k, '<div class="err">✗ 没有填收件人</div>'); return; }
      mailResult(k, '<div class="step">正在发送…</div>');
      try {
        const r = await mailPost('/api/life/mail/send', { key: k, account: mailFields(k), to, subject, body });
        mailResult(k, mailSteps('已发送到 ' + to, r));
      } catch (error) { mailResult(k, '<div class="err">✗ ' + esc(String(error.message || error)) + '</div>'); }
    };
    qa('[data-mailsend]').forEach((btn) => { btn.onclick = () => mailSend(btn.dataset.mailsend, false); });
    qa('[data-mailself]').forEach((btn) => { btn.onclick = () => mailSend(btn.dataset.mailself, true); });
    /* 阅读 / 工作流模块 ✓（各自会判 TAB ✓，不在这页就直接返回 ✓）*/
    bindReading();
    bindFlow();
    bindTrends();
    /* 顶栏状态条（秒针 / 心情 / 换一句）✓ —— 放最后 ✓，
       它是**每一页**都要绑的 ✓，不跟着某个页签的绑定走 ✓。 */
    bindHead();
  }

  /* ── 顶栏状态条：交互 ✓ ─────────────────────────────────────────────────
     ⚠️ 这个函数**每次 render 都会跑一遍** ✗（render → bind → bindHead ✓）——
        所以：定时器必须先清再挂 ✗（不然越挂越多 ✗），
        全局监听器必须先摘再挂 ✗（同上 ✗）。 */
  function bindHead() {
    /* ① 秒针 ✓ —— 只改时钟那一个元素 ✓，**不整屏 render** ✗（每秒重渲染整个面板会卡死 ✗）*/
    if (CLOCK_TIMER) { clearInterval(CLOCK_TIMER); CLOCK_TIMER = 0; }
    const tick = () => {
      const el = document.getElementById('lw-clock');
      const bar = document.getElementById('lw-daybar');
      if (!el) { clearInterval(CLOCK_TIMER); CLOCK_TIMER = 0; return; }   /* 面板被关掉 → 自己停 ✓ */
      const d = new Date();
      el.textContent = hhmmss(d);
      if (bar) bar.style.width = dayPct(d) + '%';
    };
    tick();
    CLOCK_TIMER = setInterval(tick, 1000);

    /* ② 心情：点胶囊开关浮层 ✓ */
    const mood = document.getElementById('lw-mood');
    if (mood) {
      mood.onclick = (ev) => {
        const pick = document.getElementById('lw-moodpick');
        if (pick && pick.contains(ev.target)) return;    /* 点浮层里的项 → 交给下面那组绑定 ✓ */
        MOOD_OPEN = !MOOD_OPEN;
        render();
      };
    }
    const pick = document.getElementById('lw-moodpick');
    if (pick) {
      pick.querySelectorAll('[data-mood]').forEach((el) => {
        el.onclick = (ev) => {
          ev.stopPropagation();
          const e = el.dataset.mood || '';
          if (!e) delete STORE.mood;                      /* 选「不设」→ 清掉 ✓ */
          else {
            const hit = MOODS.find((x) => x.e === e);
            STORE.mood = { e, n: hit ? hit.n : '', at: Date.now() };
          }
          MOOD_OPEN = false;
          saveStore();
          render();
        };
      });
    }
    /* 点别处关掉浮层 ✓（capture 阶段，先于别处的 onclick ✓）*/
    if (MOOD_AWAY) { document.removeEventListener('mousedown', MOOD_AWAY, true); MOOD_AWAY = null; }
    if (MOOD_OPEN) {
      MOOD_AWAY = (ev) => {
        const m = document.getElementById('lw-mood');
        if (m && m.contains(ev.target)) return;           /* 点在胶囊（含浮层）里 → 不算「别处」✓ */
        document.removeEventListener('mousedown', MOOD_AWAY, true);
        MOOD_AWAY = null;
        MOOD_OPEN = false;
        render();
      };
      document.addEventListener('mousedown', MOOD_AWAY, true);
    }

    /* ③ 格言：**固定间隔自动切换** ✓ —— 用户要求去掉「换一句」按钮，改成自动 ✓。
       ⚠️ 定时器必须**单例** ✗ —— `bindHead()` 每次 `render()` 都会跑一遍 ✓
          （切页签、开浮层、存盘都会 render ✗），不清旧的就会越挂越多 ✗
          （和秒针那个坑一模一样 ✗）。
       ⚠️ 只改格言那一个元素 ✗，**不整屏 render** ✗。 */
    if (QUOTE_TIMER) { clearInterval(QUOTE_TIMER); QUOTE_TIMER = 0; }
    QUOTE_TIMER = setInterval(() => {
      const el = document.getElementById('lw-quote');
      if (!el) { clearInterval(QUOTE_TIMER); QUOTE_TIMER = 0; return; }   /* 面板关了 → 自己停 ✓ */
      QUOTE_IDX = (QUOTE_IDX == null ? 0 : QUOTE_IDX) + 1;
      paintQuote();
    }, QUOTE_EVERY_MS);
  }


  function skeleton() {
    const kpi = [0, 1, 2, 3].map(() => `<div class="lw-c" style="grid-column:span 3">
      <div class="lw-kpi"><div class="lw-sk" style="height:34px;width:34px;border-radius:10px"></div>
      <div class="lw-sk" style="height:26px;width:44%;margin-top:12px"></div>
      <div class="lw-sk" style="height:11px;width:70%;margin-top:10px"></div></div></div>`).join('');
    const rows = [0, 1, 2, 3, 4].map(() => `<div class="lw-sk" style="height:30px;margin-top:10px"></div>`).join('');
    return `<div class="lw-g12">${kpi}
      <div class="lw-c" style="grid-column:span 8"><div class="lw-pad"><div class="lw-sk" style="height:11px;width:22%"></div>${rows}</div></div>
      <div class="lw-c" style="grid-column:span 4"><div class="lw-pad"><div class="lw-sk" style="height:11px;width:46%"></div>
      <div class="lw-sk" style="height:120px;margin-top:12px"></div></div></div></div>`;
  }

  const sp = (n) => `grid-column:span ${n}`;
  /* HUD 风格：每张卡带前缀编码（按当前视图自动编号，免得每处手写） */
  let CODE_SEQ = 0, KPI_SEQ = 0;
  const CODE_PREFIX = { today: 'N', todo: 'T', notes: 'M', tracks: 'F', paper: 'P', files: 'C', time: 'X', mail: 'E' };
  const card = (title, extra, body, n, act) => {
    CODE_SEQ += 1;
    const code = (CODE_PREFIX[TAB] || 'N') + '-' + String(CODE_SEQ).padStart(2, '0');
    return `<div class="lw-c" style="${sp(n || 12)}"><h3><span class="code">${code}</span>${title}<span class="sp"></span>${act || ''}${extra ? `<em>${extra}</em>` : ''}</h3>${body}</div>`;
  };
  const kpiCard = (ic, num, unit, lbl, cmp, n) => {
    KPI_SEQ += 1;
    const code = 'K-' + String(KPI_SEQ).padStart(2, '0');
    return `<div class="lw-c" style="${sp(n || 3)}"><h3><span class="code">${code}</span>${lbl}<span class="sp"></span></h3>
      <div class="lw-kpi"><div class="row"><div class="ic">${ic}</div>
      <div style="flex:1;min-width:0"><div class="num">${num}<small>${unit}</small></div></div></div>
      ${cmp ? `<div class="cmp">${cmp}</div>` : ''}</div></div>`;
  };

  /* ── 今日 ── */
  function viewToday() {
    const d = new Date(), hour = d.getHours();
    const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 19 ? '下午好' : '晚上好';
    const days = DATA.days || [];
    const today = days[days.length - 1] || { count: 0 };
    const yest = days[days.length - 2] || { count: 0 };
    const diff = today.count - yest.count;
    const maxDay = Math.max(1, ...days.map((x) => x.count));
    const week = days.slice(-7).map((x) => x.count);
    const hot = (DATA.recent || []).slice(0, 7);
    /* ⚠️ 待办和笔记已经合并进「备忘录」了 ✗ ——
       以前这里读的是 STORE.todos / STORE.notes ✗（早就不存在 ✗）→ 永远显示空 ✗。
       现在改成从**备忘录**里聚合清单项 ✓，以及读**日记 / 书签** ✓。 */
    const memos = ((STORE && STORE.memos) || []).filter((m) => !m.trash);
    const allTodos = [];
    memos.forEach((m) => {
      String(m.text || '').split('\n').forEach((l, i) => {
        const ck = l.match(/^\s*[-*+]\s*\[([ xX])\]\s*(.*)$/);
        const bx = l.match(/^\s*([☐☑])\s*(.*)$/);
        if (ck && ck[2].trim()) allTodos.push({ memo: m, idx: i, done: ck[1].toLowerCase() === 'x', text: ck[2].trim() });
        else if (bx && bx[2].trim()) allTodos.push({ memo: m, idx: i, done: bx[1] === '☑', text: bx[2].trim() });
      });
    });
    const openTodos = allTodos.filter((t) => !t.done).slice(0, 6);
    const journals = ((STORE && STORE.journal) || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const tk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const todayJ = journals.find((j) => j.date === tk) || null;
    const quotes = ((STORE && STORE.quotes) || []).slice(0, 3);
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const dd = new Date(); dd.setDate(dd.getDate() - i);
      const k = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
      if (journals.some((x) => x.date === k)) streak++; else if (i > 0) break;
    }

    const kpis = [
      kpiCard('▦', DATA.totals.projects, '个项目', '已纳管', `覆盖 ${(DATA.tracks || []).length} 个方向`, 3, 'sky'),
      kpiCard('▤', DATA.totals.files, '个文件', `合计 ${DATA.totals.sizeText}`, `近 14 天有 ${days.filter((x) => x.count).length} 天在动`, 3, 'lilac'),
      kpiCard('✎', today.count, '个改动', '今天', diff === 0 ? '与昨天持平' : (diff > 0 ? `<b>+${diff}</b> 比昨天多` : `<b style="color:${T.warn}">${diff}</b> 比昨天少`), 3, 'mint'),
      kpiCard('◈', streak, '天', '日记连续记录', journals.length ? `共 ${journals.length} 篇 · 待办 ${allTodos.filter((t) => !t.done).length} 项` : '还没写过日记', 3, 'lemon'),
    ].join('');

    const todoBody = openTodos.length
      ? `<div>${openTodos.map((t) => `<div class="lw-todo" data-todo-go="${t.memo.id}"><span class="ck">✓</span>
          <div class="tx">${esc(t.text)}<div class="due">来自《${esc(String(t.memo.text || '').split('\n')[0].slice(0, 16) || '备忘录')}》</div></div></div>`).join('')}</div>`
      : `<div class="lw-empty"><span class="big">✓</span>没有未完成的待办</div>`;
    const todayBody = (todayJ || quotes.length)
      ? `<div>${todayJ ? `<div class="lw-note"><div class="h">今天的日记 · ${String(todayJ.text || '').length} 字</div>
          <div class="b">${esc(String(todayJ.text || '').replace(/^#{1,3}\s*/gm, '').replace(/^\s*[-*+]\s*(\[[ xX]\]\s*)?/gm, '· ').slice(0, 150))}…</div></div>`
        : `<div class="lw-empty" style="padding:16px"><span class="big">◈</span>今天还没写日记</div>`}
        ${quotes.map((q) => `<div class="lw-note"><div class="h">❝ 书签</div><div class="b">${esc(String(q.text || '').slice(0, 80))}${q.from ? `<span style="color:${T.faint}"> —— ${esc(String(q.from).slice(0, 20))}</span>` : ''}</div></div>`).join('')}</div>`
      : `<div class="lw-empty"><span class="big">❝</span>还没有日记和书签</div>`;

    return `<div class="lw-g12">${kpis}
      ${card('☑ 待办清单', allTodos.filter((t) => !t.done).length ? `${allTodos.filter((t) => !t.done).length} 项未完成` : '', todoBody, 4, '<span class="act" id="lw-goto-memo">去备忘录 →</span>')}
      ${card('今日日记 · 书签', todayJ ? '今天已写' : '', todayBody, 4, '<span class="act" id="lw-goto-journal">去日记 →</span>')}
      ${card('近 14 天改动', `共 ${days.reduce((a, x) => a + x.count, 0)} 个`,
        `<div class="lw-pad"><div class="lw-bars">${days.map((x) => `<div title="${x.date} · ${x.count}">
          <span class="v">${x.count || ''}</span><span class="b" style="height:${Math.max(3, Math.round(x.count / maxDay * 88))}px"></span>
          <span class="k">${x.label}</span></div>`).join('')}</div></div>`, 4)}
      ${card('最近在动的文件', '点一行复制完整路径',
        `<div class="lw-tbl">${hot.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext || '—')}</span><span class="sz">${fmtBytes(f.size)}</span>
          <span class="tm">${ago(f.mtime)}</span></div>`).join('')}</div>`, 7)}
      ${card('文件构成', `${DATA.totals.files} 个文件`,
        `<div class="lw-pad">${Object.entries(DATA.byKind || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
          const pct = Math.round(v / (DATA.totals.files || 1) * 100);
          return `<div style="margin-bottom:11px"><div style="display:flex;font-size:11px;color:${T.dim};margin-bottom:5px">
            <span style="flex:1">${KIND_NAME[k] || k}</span><span style="font-variant-numeric:tabular-nums">${v} · ${pct}%</span></div>
            <div style="height:7px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden">
              <i style="display:block;height:100%;width:${pct}%;border-radius:5px;background:${KIND_COLOR[k] || T.faint}"></i></div></div>`;
        }).join('')}</div>`, 5)}
    </div>`;
  }

  /* ── 待办 ── */
  /* ── 备忘录：Memos 风格（单列时间线 + Markdown 卡片）── */
  /* ── 备忘录：macOS 备忘录三栏（文件夹/标签 · 时间分组列表 · 编辑区 + 格式菜单）── */
  function viewMemo() {
    const raw = (STORE && STORE.memos) || [];
    const folders = (STORE && STORE.memoFolders) || ["备忘录", "Study note"];
    const fol = (STORE && STORE.memoFolder) || "";
    const view = (STORE && STORE.memoView) || "folder";   /* folder = 只看当前文件夹；all = 跨文件夹看全部 */
    const smart = (STORE && STORE.memoSmart) || "";        /* todo / pin / today / trash */
    /* 待办相关：从正文里数出 `- [ ]` / `☐` / `☑` 的条数 */
    const todoOf = (m) => {
      const lines = String(m.text || "").split("\n");
      let open = 0, done = 0;
      lines.forEach((l) => {
        if (/^\s*[-*+]\s*\[\s*\]/.test(l) || /^\s*☐/.test(l)) open++;
        else if (/^\s*[-*+]\s*\[[xX]\]/.test(l) || /^\s*☑/.test(l)) done++;
      });
      return { open, done, total: open + done };
    };
    const dayK0 = (ms) => { const d = new Date(ms || Date.now()); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const todayK0 = dayK0(Date.now());
    const allNoTrash = raw.filter((m) => !m.trash);
    const smartCount = {
      todo: allNoTrash.filter((m) => todoOf(m).total > 0).length,
      pin: allNoTrash.filter((m) => m.pin).length,
      today: allNoTrash.filter((m) => dayK0(m.edit || m.at) === todayK0).length,
      trash: raw.filter((m) => m.trash).length,
    };
    let all = raw.filter((m) => !m.trash && (view === "all" || !fol || (m.folder || "备忘录") === fol));
    if (smart === "todo") all = allNoTrash.filter((m) => todoOf(m).total > 0);
    else if (smart === "pin") all = allNoTrash.filter((m) => m.pin);
    else if (smart === "today") all = allNoTrash.filter((m) => dayK0(m.edit || m.at) === todayK0);
    else if (smart === "trash") all = raw.filter((m) => m.trash);
    const kw = String((STORE && STORE.memoQ) || "").trim().toLowerCase();
    const tagF = (STORE && STORE.memoTag) || "";
    const editing = (STORE && STORE.memoEditing) || "";
    const fmt = (STORE && STORE.memoFmt) || {};
    const tagsOf = (t) => (String(t || "").match(/#[\u4e00-\u9fa5\w/-]+/g) || []).map((x) => x.slice(1));
    const tagCount = {};
    raw.filter((m) => !m.trash).forEach((m) => tagsOf(m.text).forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    let shown = all.filter((m) => (!kw || String(m.text || "").toLowerCase().includes(kw)) && (!tagF || tagsOf(m.text).includes(tagF)));
    shown.sort((a, b) => { if (!!b.pin !== !!a.pin) return (b.pin ? 1 : 0) - (a.pin ? 1 : 0); return (b.edit || b.at || 0) - (a.edit || a.at || 0); });
    const sel = (STORE && STORE.memoSel) || (shown[0] && shown[0].id) || "";
    const cur = shown.find((x) => x.id === sel) || shown[0] || null;
    /* ★ 记下「编辑器现在显示的是哪一条」✓ —— 写盘前要比对（见 MEMO_EDITOR_ID 的注释）*/
    MEMO_EDITOR_ID = cur ? cur.id : '';

    /* 时间分组：今天 / 昨天 / M月 / YYYY 年（照 macOS 备忘录的分组方式）*/
    const D = (ms) => new Date(ms || Date.now());
    const pad = (n) => String(n).padStart(2, "0");
    const dayK = (ms) => { const d = D(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
    const now = new Date();
    const todayK = dayK(Date.now()), yestK = dayK(Date.now() - 86400000);
    const grpKey = (ms) => {
      const k = dayK(ms), d = D(ms);
      if (k === todayK) return "今天";
      if (k === yestK) return "昨天";
      if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + " 月";
      return d.getFullYear() + " 年";
    };
    const groups = [];
    shown.forEach((m) => { const k = grpKey(m.edit || m.at); const g = groups.find((x) => x.k === k); if (g) g.list.push(m); else groups.push({ k, list: [m] }); });

    const rowHtml = (m) => {
      const d = D(m.edit || m.at);
      const isToday = dayK(m.edit || m.at) === todayK;
      const when = isToday ? (pad(d.getHours()) + ":" + pad(d.getMinutes())) : (d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate());
      const body = String(m.text || "").split("\n").slice(1).join(" ").replace(/^[☐☑]\s*/gm, "").replace(/^\s*[-*+]\s*\[[ xX]\]\s*/gm, "").slice(0, 22);
      const td = todoOf(m);
      /* `extra` 描述的是**内容形态**（待办进度 / 有没有表格），**不是文件夹名** ✓
         ⚠️ 以前这里回退成字面量 "备忘录" ✗ —— 和文件夹名撞在一起，
            行里会出现「Study note ▤ 备忘录」，看起来像「这条属于「备忘录」文件夹」✗
            （用户截图里就是这句，很容易和左边的文件夹列表搞混 ✗）。
            改成「笔记」✓，并且给真正的文件夹名加 ▤ 前缀和分隔符 ✓。 */
      const extra = td.total ? ("☑ " + td.done + "/" + td.total) : ((String(m.text || "").match(/\|/g) || []).length > 3 ? "1 个表格" : "笔记");
      /* ⚠️ `▦ 全部列表` 视图下**显示所属文件夹** ✓ ——
         否则"文件夹视图"和"全部列表"看起来一模一样 ✗（用户反馈"这两个按钮没用"✗）。*/
      const folTag = (view === 'all' && (m.folder || '备忘录'))
        ? '<span class="bd" style="color:' + T.accent + '">▤ ' + esc(m.folder || '备忘录') + '</span> · ' : '';
      return '<div class="lw-nt-row ' + (cur && m.id === cur.id ? "on" : "") + '" data-memo="' + m.id + '" draggable="true" title="拖到左边文件夹可移动归属">'
        + '<div class="c"><div class="tt">' + (m.pin ? '<span class="pin">★ </span>' : "") + esc(String(m.text || "").split("\n")[0].slice(0, 30) || "新备忘录") + '</div>'
        + '<div class="mt"><b>' + when + '</b>' + (body ? "  " + esc(body) : "") + '</div>'
        + '<div class="sub">' + folTag + extra + (tagsOf(m.text).length ? " · #" + tagsOf(m.text)[0] : "") + '</div></div></div>';
    };

    const listHtml = groups.length
      ? groups.map((g) => '<div class="lw-nt-grp">' + esc(g.k) + '</div>' + g.list.map(rowHtml).join("")).join("")
      : '<div class="lw-nt-empty" style="padding:30px 10px">' + (kw || tagF ? "没有匹配的备忘录" : "还没有备忘录") + '</div>';

    const tagKeys = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]);
    const side = '<div class="lw-nt-side">'
      + '<div class="hd"><button data-mview="folder" class="' + ((STORE.memoView || 'folder') === 'folder' ? "on" : "") + '" title="文件夹视图">▤</button>'
      + '<button data-mview="all" class="' + (STORE.memoView === 'all' ? "on" : "") + '" title="全部列表">▦</button></div>'
      + '<div class="grp">智能</div>'
      + '<div class="it ' + (smart === 'todo' ? "on" : "") + '" data-msmart="todo">☑ 待办清单<span class="n">' + smartCount.todo + '</span></div>'
      + '<div class="it ' + (smart === 'pin' ? "on" : "") + '" data-msmart="pin">☆ 置顶<span class="n">' + smartCount.pin + '</span></div>'
      + '<div class="it ' + (smart === 'today' ? "on" : "") + '" data-msmart="today">◔ 今天<span class="n">' + smartCount.today + '</span></div>'
      + '<div class="it ' + (smart === 'trash' ? "on" : "") + '" data-msmart="trash">🗑 回收站<span class="n">' + smartCount.trash + '</span></div>'
      + '<div class="grp">iCloud <span id="lw-nt-addfol" title="新建文件夹" style="float:right;cursor:pointer;color:' + T.accent + '">＋</span></div>'
      + '<div class="it ' + (!smart && !fol && !tagF ? "on" : "") + '" data-mfolder="" data-mname="iCloud 全部">▤ iCloud 全部<span class="n">' + raw.filter((m) => !m.trash).length + '</span></div>'
      + folders.map((f) => '<div class="it ' + (!smart && fol === f ? "on" : "") + '" data-mfolder="' + esc(f) + '" data-mname="' + esc(f) + '">▤ ' + esc(f) + '<span class="n">' + raw.filter((m) => !m.trash && (m.folder || "备忘录") === f).length + '</span></div>').join("")
      + '<div class="grp">标签</div>'
      + '<div class="it" data-mtag="" data-mname="所有标签"># 所有标签<span class="n">' + tagKeys.length + '</span></div>'
      + (tagKeys.length ? tagKeys.map((t) => '<div class="it ' + (!smart && tagF === t ? "on" : "") + '" data-mtag="' + esc(t) + '" data-mname="#' + esc(t) + '"># ' + esc(t) + '<span class="n">' + tagCount[t] + '</span></div>').join("") : '<div class="it" style="color:#5c5a50">正文里写 #标签</div>')
      + '</div>';

    const SMART_NAME = { todo: "☑ 待办清单", pin: "☆ 置顶", today: "◔ 今天", trash: "🗑 回收站" };
    /* ⚠️ 标题必须和**实际显示的内容**一致：
       「▦ 全部列表」视图下不按文件夹过滤（那一栏每条都带文件夹标签 ✓），
       所以标题不能再显示文件夹名 ✗ —— 否则会出现「标题写着「测试文件夹 · 3 个备忘录」、
       左边那个文件夹的计数却是 0」这种自相矛盾的画面（用户截图里就是这个，
       很容易让人以为「移进文件夹没生效」✗）。 */
    const listTitle = smart ? (SMART_NAME[smart] || "全部")
      : (view === "all" ? ("全部列表" + (fol ? "（不限文件夹）" : "")) : (fol ? fol : "iCloud 全部"));
    const todoSum = (() => {
      let open = 0, done = 0;
      all.forEach((m) => { const t = todoOf(m); open += t.open; done += t.done; });
      return { open, done };
    })();
    const list = '<div class="lw-nt-list"><div class="top"><div class="t1">' + esc(listTitle) + '</div>'
      + '<div class="t2">' + shown.length + ' 个备忘录'
      + (smart === 'todo' && todoSum.open + todoSum.done ? ' · 未完成 ' + todoSum.open + ' / 共 ' + (todoSum.open + todoSum.done) : '')
      + (smart === 'trash' ? ' · 右键可恢复' : '') + '</div>'
      + '<input id="lw-memo-q" placeholder="搜索（⌘F）" value="' + esc((STORE && STORE.memoQ) || "") + '" /></div>'
      + '<div class="lw-nt-scroll">' + listHtml + '</div></div>';

    /* 格式条：**横排**放在工具栏下面（不再弹浮层 ✗）*/
    const fmts = [["title", "标题"], ["h2", "小标题"], ["h3", "副标题"], ["body", "正文"], ["mono", "等宽"], ["ul", "• 列表"], ["dash", "– 短划线"], ["ol", "1. 编号"], ["quote", "❘ 引用"]];
    const curFmt = cur ? ((STORE.memoFmt || {})[cur.id] || "body") : "body";
    const fmtBar = (cur && STORE.memoMenu) ? '<div class="lw-nt-fmt">'
      + '<button data-mwrap="**" title="粗体">B</button><button data-mwrap="*" title="斜体">I</button>'
      + '<button data-mwrap="_" title="下划线">U</button><button data-mwrap="~~" title="删除线">S</button>'
      + '<span class="div"></span>'
      + fmts.map((f) => '<button data-mfmt="' + f[0] + '" class="' + (curFmt === f[0] ? "on" : "") + '">' + f[1] + '</button>').join("")
      + '</div>' : '';

    const d = cur ? D(cur.edit || cur.at) : null;
    const meta = d ? (d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + pad(d.getHours()) + ":" + pad(d.getMinutes())) : "";
    const editor = cur ? '<div class="lw-nt-bar">'
      + '<button id="lw-memo-new" title="新建（⌘N）">✎ 新建</button>'
      + '<button id="lw-memo-undo" title="撤销（⌘Z）"' + (canUndo() ? '' : ' disabled') + '>↶ 撤销</button>'
      + '<button id="lw-memo-redo" title="重做（⌘⇧Z）"' + (canRedo() ? '' : ' disabled') + '>↷</button>'
      + '<button id="lw-nt-aa" class="' + ((STORE && STORE.memoMenu) ? "on" : "") + '" title="格式">Aa</button>'
      + '<button id="lw-nt-check" title="插入清单项">☑</button>'
      + '<button id="lw-nt-table" title="插入表格">▦</button>'
      + '<button id="lw-nt-live" class="' + (STORE.memoSource ? "on" : "") + '" title="显示全部源码（关掉则是实时渲染）">◫ 源码</button>'
      + '<span class="sp"></span>'
      + '<span class="st ' + (STORE.memoSaved ? "ok" : "") + '" id="lw-memo-status">' + (STORE.memoSaved ? "✓ 已保存" : "自动保存") + '</span>'
      + '<button data-mpin="' + cur.id + '" title="置顶">' + (cur.pin ? "★" : "☆") + '</button>'
      + '<button id="lw-memo-export" title="导出 Markdown（.md）">导出</button>'
      + '<button id="lw-memo-image" title="导出为图片：把渲染后的内容存成 PNG（含标题与日期）">图片</button>'
      + '<button id="lw-memo-del" title="移到回收站（可撤销）">删除</button></div>'
      + fmtBar
      + '<div class="lw-nt-body"><div class="lw-nt-meta">' + esc(meta) + '</div>'
      + (() => {
        /* 编辑区（标题 + 正文）。图片预览打开时会和预览栏并排成两栏 ✓ */
        const editPane = '<input class="lw-nt-title" id="lw-memo-title" value="' + esc(String(cur.text || "").split("\n")[0]) + '" placeholder="标题" />'
          + '<div class="lw-ce lw-memo-ce" id="lw-memo-ce" contenteditable="true" spellcheck="false">'
          + ceHtml(String(cur.text || "").split("\n").slice(1).join("\n"), STORE.memoCurLine || 0, !!STORE.memoSource)
          + '</div>';
        const pv = MEMO_IMG_PREVIEW;
        if (!pv) return editPane;
        const head = '<div class="panehd">◫ 图片预览<span class="sp"></span>'
          + '<span class="lw-img-size" id="lw-memo-img-note">' + (pv.busy ? '正在生成…' : (pv.w ? pv.w + '×' + pv.h : '')) + '</span>'
          + '<button id="lw-memo-img-save"' + (pv.url ? '' : ' disabled') + ' title="保存为 PNG（含标题与日期）">下载 PNG</button>'
          + '<button id="lw-memo-img-close" title="关掉预览，回到纯编辑">关闭</button></div>';
        const bodyHtml = pv.busy ? '<div class="lw-img-hint">正在生成预览…</div>'
          : pv.err ? '<div class="lw-img-hint err">' + esc(pv.err) + '</div>'
            : '<img id="lw-memo-img" src="' + esc(pv.url || '') + '" alt="图片预览" />';
        return '<div class="lw-img-split">'
          + '<div class="pane">' + editPane + '</div>'
          + '<div class="pane img">' + head + '<div class="panebd">' + bodyHtml + '</div></div>'
          + '</div>';
      })()
      + '</div>'
      : '<div class="lw-nt-bar"><button id="lw-memo-new">✎ 新建</button></div><div class="lw-nt-empty"><span class="big">✎</span>选一条备忘录，或点「✎ 新建」</div>';

    /* 三栏宽度可拖拽调整（记住到 STORE ✓，双击竖条恢复默认 ✓）*/
    const sideW = Number(STORE.memoSideW) || 0;
    const listW = Number(STORE.memoListW) || 0;
    return '<div class="lw-g12"><div class="lw-c" style="grid-column:span 12">'
      + '<h3><span class="code">M-00</span>备忘录<span class="sp"></span><em>macOS 备忘录 · 三栏（可拖宽）· 拖条目到文件夹改归属 · 自动保存</em></h3>'
      + '<div class="lw-nt">'
      + side.replace('class="lw-nt-side"', 'class="lw-nt-side"' + (sideW >= 120 ? ' style="width:' + sideW + 'px"' : ''))
      + '<div class="lw-nt-grip" data-mgrip="side" title="左右拖动调整宽度；双击恢复默认"></div>'
      + list.replace('class="lw-nt-list"', 'class="lw-nt-list"' + (listW >= 160 ? ' style="width:' + listW + 'px"' : ''))
      + '<div class="lw-nt-grip" data-mgrip="list" title="左右拖动调整宽度；双击恢复默认"></div>'
      + '<div class="lw-nt-edit">' + editor + '</div></div>'
      + '</div></div>';
  }



  /* ── 书签：好词好句（衬线字体 · 卡片墙 · 每日一句）── */
  function viewQuote() {
    const all = ((STORE && STORE.quotes) || []).slice();
    const kw = String((STORE && STORE.quoteQ) || '').trim().toLowerCase();
    const tagF = (STORE && STORE.quoteTag) || '';
    const tagsOf = (q) => (String(q.tag || '').match(/[\u4e00-\u9fa5\w-]+/g) || []);
    const tagCount = {};
    all.forEach((q) => tagsOf(q).forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    let shown = all.filter((q) => (!kw || String(q.text || '').toLowerCase().includes(kw) || String(q.from || '').toLowerCase().includes(kw))
      && (!tagF || tagsOf(q).includes(tagF)));
    shown.sort((a, b) => { if (!!b.pin !== !!a.pin) return (b.pin ? 1 : 0) - (a.pin ? 1 : 0); return (b.at || 0) - (a.at || 0); });
    /* 每日一句：默认按日期做种子（同一天看到同一条 ✓）；
       点「换一句」后改用 STORE.quoteHero 指定的那条 ✓（以前只改了顶栏文字、没换卡片 ✗）*/
    const d0 = new Date();
    const daySeed = d0.getFullYear() * 372 + (d0.getMonth() + 1) * 31 + d0.getDate();
    const heroPick = (STORE && STORE.quoteHero) ? all.find((x) => x.id === STORE.quoteHero) : null;
    const hero = heroPick || (all.length ? all[daySeed % all.length] : null);
    const tagKeys = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]);

    const heroHtml = hero ? '<div class="lw-bk-hero"><div class="q">' + esc(hero.text) + '</div>'
      + '<div class="from">' + (hero.from ? '—— ' + esc(hero.from) : '未署出处')
      + (tagsOf(hero).length ? ' · ' + tagsOf(hero).map((t) => '<span class="tg">#' + esc(t) + '</span>').join(' ') : '')
      + '<span class="sp"></span><span style="color:' + T.faint + '">每日一句 · ' + (d0.getMonth() + 1) + ' 月 ' + d0.getDate() + ' 日</span>'
      + '<button data-bk-random="1">换一句</button></div></div>'
      : '<div class="lw-bk-hero"><div class="q" style="color:' + T.faint + '">还没有书签 —— 下面记下第一句吧</div></div>';

    const write = '<div class="lw-bk-write"><div class="col">'
      + '<textarea id="lw-bk-text" placeholder="记一句好词好句…"></textarea>'
      + '<input id="lw-bk-from" placeholder="出处（书名 / 作者 / 场景）" />'
      + '<input id="lw-bk-tag" placeholder="标签（空格分隔，如 写作 灵感）" /></div>'
      + '<button id="lw-bk-add">记下 ⌘⏎</button></div>';

    const wall = shown.length ? '<div class="lw-bk-wall">' + shown.map((q) => '<div class="lw-bk-card ' + (q.pin ? 'pin' : '') + '">'
      + '<div class="ops"><button data-bk-pin="' + q.id + '" title="置顶">' + (q.pin ? '★' : '☆') + '</button>'
      + '<button data-bk-copy="' + q.id + '" title="复制">⧉</button>'
      + '<button class="del" data-bk-del="' + q.id + '" title="删除">✕</button></div>'
      + '<div class="txt">' + esc(q.text) + '</div>'
      + '<div class="src">' + (q.from ? '—— ' + esc(q.from) : '')
      + '<span class="sp"></span>' + tagsOf(q).map((t) => '<span class="tg">#' + esc(t) + '</span>').join(' ')
      + '</div></div>').join('') + '</div>'
      : '<div class="lw-mo-empty" style="padding:34px 0"><span class="big">❝</span>' + (kw || tagF ? '没有匹配的书签' : '还没有书签') + '</div>';

    const tagBar = tagKeys.length ? '<div class="lw-mtags" style="padding:0 0 12px"><span data-bktag="" class="' + (tagF ? '' : 'on') + '">全部 ' + all.length + '</span>'
      + tagKeys.map((t) => '<span data-bktag="' + esc(t) + '" class="' + (tagF === t ? 'on' : '') + '">#' + esc(t) + ' ' + tagCount[t] + '</span>').join('') + '</div>' : '';

    return '<div class="lw-g12">'
      + '<div class="lw-c" style="' + sp(12) + '"><h3><span class="code">B-00</span>书签 · 好词好句<span class="sp"></span>'
      + '<em>' + all.length + ' 条 · ' + tagKeys.length + ' 个标签</em>'
      + '<input id="lw-bk-q" placeholder="搜索（⌘F）" value="' + esc((STORE && STORE.quoteQ) || '') + '" style="height:22px;width:150px;padding:0 8px;border:1px solid ' + T.lineDim + ';background:transparent;color:' + T.text + ';font:10.5px ' + UI + ';outline:none" /></h3>'
      + '<div style="padding:14px 16px">' + heroHtml + write + tagBar + wall + '</div></div></div>';
  }

  /* ── 日记（按天一条 + 时间线）── */
  /* ── 日记模板（新建时自动套用，也可手动插入）── */
  const J_TPL = {
    daily: { name: '日常', icon: '☀', text: '## 今天做了什么\n- \n\n## 卡在哪里\n- \n\n## 明天要做什么\n- \n\n## 心情 / 收获\n' },
    research: { name: '科研', icon: '◈', text: '## 今日进展\n- \n\n## 实验 / 数据\n- 跑了什么：\n- 结果如何：\n- 异常现象：\n\n## 遇到的问题\n- \n\n## 下一步\n- \n\n## 文献 / 灵感\n- ' },
    review: { name: '复盘', icon: '◔', text: '## 做得好的\n- \n\n## 做得不好的\n- \n\n## 学到了什么\n- \n\n## 明天改进\n- ' },
  };

  /* 就地实时渲染：**逐行 + 字符保留** ✓
     ⚠️ 关键：**一个字符都不能删/换** ✗ ——
       渲染层和 textarea 是两层重叠 ✗，只要字符宽度不同，光标就会偏 ✗。
       所以 `#` / `- ` / `**` / `` ` `` / `#标签` 这些标记**全部保留** ✓，
       只用**颜色 / 字重 / 底纹 / 竖线**表达语义 ✓（标记本身变暗 ✓）。
     和 mdToHtml() 的区别：那个会产出块级元素并吃掉标记 ✗（适合只读预览 ✓）。 */

  /* contenteditable 实时渲染：把整篇拆成「每行一个 div」✓
     · curIdx 那一行 → **源码**（contenteditable ✓ 可编辑 ✓ 光标准 ✓）
     · 其他行     → **渲染后的 HTML**（contenteditable=false ✓ 真排版 ✓）
     行内渲染器：**保留语义但丢掉标记** ✓（这里可以放心丢 ✗ —— 因为不参与光标定位 ✓）*/
  function ceInline(src) {
    return esc(src)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/#([\u4e00-\u9fa5\w/-]+)/g, '<span class="tag">#$1</span>');
  }
  function ceHtml(text, curIdx, srcOnly) {
    const lines = String(text == null ? '' : text).split('\n');
    /* srcOnly：整篇都当源码显示（备忘录的「◫ 源码」模式 ✓，日记不用 ✓） */
    if (srcOnly) {
      return lines.map((raw) => '<div class="ln src" contenteditable="true">' + (esc(raw) || '<br>') + '</div>').join('');
    }
    return lines.map((raw, i) => {
      if (i === curIdx) {
        return '<div class="ln cur" contenteditable="true">' + (esc(raw) || '<br>') + '</div>';
      }
      const L = raw;
      let cls = 'ln', body = '';
      const h = L.match(/^(#{1,3})\s+(.*)$/);
      const ck = L.match(/^\s*[-*+]\s*\[([ xX])\]\s*(.*)$/);
      const ul = L.match(/^\s*[-*+]\s+(.*)$/);
      const ol = L.match(/^\s*\d+[.)]\s+(.*)$/);
      if (/^\s*```/.test(L)) { cls += ' r-code'; body = esc(L); }
      else if (h) { cls += ' r-h' + h[1].length; body = ceInline(h[2]); }
      else if (/^\s*>\s?/.test(L)) { cls += ' r-quote'; body = ceInline(L.replace(/^\s*>\s?/, '')); }
      else if (ck) { const on = ck[1].toLowerCase() === 'x'; cls += ' r-li' + (on ? ' done' : ''); body = '<span class="ckbox">' + (on ? '☑' : '☐') + '</span>' + ceInline(ck[2]); }
      else if (ul) { cls += ' r-li'; body = '<span class="bullet">•</span>' + ceInline(ul[1]); }
      else if (ol) { cls += ' r-li'; body = '<span class="bullet">' + esc(L.match(/^\s*(\d+[.)])/)[1]) + '</span>' + ceInline(L.replace(/^\s*\d+[.)]\s+/, '')); }
      else if (/^\s*(---|\*\*\*|___)\s*$/.test(L)) { cls += ' r-hr'; body = esc(L); }
      else { body = ceInline(L) || '<br>'; }
      return '<div class="' + cls + '" contenteditable="false" data-src="' + esc(L) + '">' + body + '</div>';
    }).join('');
  }

  /* 把光标放到某个行元素的第 offset 个字符处（不传 offset = 放到行尾）。
     行内一般是单个文本节点；保险起见按 childNodes 累加找位置 ✓。 */
  function ceSetCaret(lineEl, offset) {
    if (!lineEl) return;
    lineEl.focus();
    try {
      const range = document.createRange();
      if (offset == null) { range.selectNodeContents(lineEl); range.collapse(false); }
      else {
        let node = null, left = Math.max(0, offset);
        for (const child of lineEl.childNodes) {
          if (child.nodeType === 3) { if (left <= child.nodeValue.length) { node = child; break; } left -= child.nodeValue.length; }
        }
        if (node) { range.setStart(node, left); range.collapse(true); }
        else { range.selectNodeContents(lineEl); range.collapse(false); }
      }
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    } catch (_) {}
  }

  /* 光标在第 index 行内的**字符偏移**；光标不在这行（或有选区）时返回 null。
     行首退格 / 行尾 Delete / 回车切分都要用它 ✓。 */
  function ceCaretOffset(ce, index) {
    const sel = window.getSelection();
    if (!ce || !sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return null;
    const lineEl = Array.from(ce.querySelectorAll(':scope > .ln'))[index];
    if (!lineEl || !lineEl.contains(range.startContainer)) return null;
    try {
      const probe = range.cloneRange();
      probe.selectNodeContents(lineEl);
      probe.setEnd(range.startContainer, range.startOffset);
      return probe.toString().length;
    } catch (_) { return null; }
  }

  /* 把每行的**实际行高**写成 CSS 变量 --ln-lh，把**左边框宽度**写成 --ln-bl，
     供行号对齐用 ✓。每次重建正文后都要调（applyCe / applyCeJ 里已经接好了 ✓）。

     ⚠️ 为什么需要 --ln-lh（垂直）：
        行号不能靠 CSS 的 line-height:inherit 对齐 —— 标题 / 代码块那些行的行高是**无单位**值
        （如 1.5），无单位值会按伪元素**自己的** font-size（10px）重算 ✗ →
        行号行盒 15px、正文行盒 27px，基线对不上（标题行号明显偏高 ✗，实测踩过）。
        「该行的实际行高」在 CSS 里拿不到，只能渲染后量：getComputedStyle 返回**用后值（px）** ✓。

     ⚠️ 为什么需要 --ln-bl（水平）：
        绝对定位的 left 是相对 **padding box** 的，而 border-left 在 padding box **之外** ✗ →
        标题 / 引用 / 代码块带 3px 左边框，它们的行号会被整体**往右推 3px** ✗，
        和普通行对不齐（用户反馈「行号不对齐」就是它）。量出边框宽度，让行号 left 取负值补偿 ✓。 */
  function ceAlignLineNumbers(ce) {
    if (!ce) return;
    for (const el of ce.querySelectorAll(':scope > .ln')) {
      const cs = getComputedStyle(el);
      const lh = cs.lineHeight;
      if (lh && lh !== 'normal') el.style.setProperty('--ln-lh', lh);
      else el.style.removeProperty('--ln-lh');
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      if (bl > 0) el.style.setProperty('--ln-bl', bl + 'px');
      else el.style.removeProperty('--ln-bl');
    }
  }

  /* ── 行首退格 / 行尾 Delete：**必须自己拦**，不能交给浏览器 ──────────────
     contenteditable 里在行首按退格，浏览器会去「合并上一个块」，
     而上一块是 contenteditable="false" 的渲染行 → 浏览器的处理是**毁灭性**的 ✗✗：
     实测在备忘录里按**一次**退格，4 行直接变 0 行，而且空内容还被存进了服务端 ✗（数据丢失）。
     这里自己实现「和上一行合并 / 把下一行并上来」，并 preventDefault ✓。
     opts: { ce, index, readAll, apply(text, idx, keepFocus, caretOffset) } */
  function ceLineKey(event, opts) {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
    const ce = opts.ce;
    if (!ce) return false;
    const offset = ceCaretOffset(ce, opts.index);
    if (offset == null) return false;                          /* 光标不在这行 / 有选区 → 交给浏览器 ✓ */
    const lineEl = Array.from(ce.querySelectorAll(':scope > .ln'))[opts.index];
    const lineText = String(lineEl ? lineEl.textContent : '');
    if (event.key === 'Backspace' && offset === 0) {
      event.preventDefault();
      if (opts.index <= 0) return true;                       /* 首行行首：什么也不做 ✓（绝不能让它删）*/
      const lines = String(opts.readAll()).split('\n');
      const at = String(lines[opts.index - 1] || '').length;
      lines[opts.index - 1] = String(lines[opts.index - 1] || '') + String(lines[opts.index] || '');
      lines.splice(opts.index, 1);
      opts.apply(lines.join('\n'), opts.index - 1, true, at);  /* 光标停在合并处 ✓ */
      return true;
    }
    if (event.key === 'Delete' && offset === lineText.length) {
      event.preventDefault();
      const lines = String(opts.readAll()).split('\n');
      if (opts.index >= lines.length - 1) return true;         /* 末行行尾：什么也不做 ✓ */
      const at = lineText.length;
      lines[opts.index] = lineText + String(lines[opts.index + 1] || '');
      lines.splice(opts.index + 1, 1);
      opts.apply(lines.join('\n'), opts.index, true, at);
      return true;
    }
    return false;
  }

  /* ── 日记：月历 + 选中当天编辑（+ 当天天气）── */
  function viewJournal() {
    const d0 = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const keyOf = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    const todayK = keyOf(d0);
    /* 分类统计 + 筛选 ✓
       · `total`      = 全部篇数（全部分类用 ✓）
       · `catCount`   = 每个分类的篇数（分类行用 ✓）
       · `all`        = 按分类筛选后的（列表 / 日历高亮用 ✓）
       · `journalAll` = 全量（连续记录用 ✓，streak 不该被筛选影响 ✓）
       ⚠️ 以前「最近写过」用的是 `journalAll` ✗ → 筛了分类它也不变 ✗，
          用户反馈"没有实际起到分类查询的作用" ✗ → 改成用 `all` ✓。 */
    const total = ((STORE && STORE.journal) || []).length;
    const journalAll = ((STORE && STORE.journal) || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const catNow = (STORE && STORE.journalCat) || '';
    const catOf2 = (j) => String(j.cat || '');
    const catCount2 = {};
    journalAll.forEach((j) => { const c = catOf2(j); if (c) catCount2[c] = (catCount2[c] || 0) + 1; });
    const all = journalAll.filter((j) => !catNow || catOf2(j) === catNow);
    /* 日历高亮用：筛选时只标该分类的日期 ✓ */
    const hasSet2 = {};
    journalAll.forEach((j) => { if (!catNow || catOf2(j) === catNow) hasSet2[j.date] = j; });
    /* 日历黄点：筛选时只标该分类的日期 ✓（用户要的"分类查询"效果 ✓）*/
    const hasSet = hasSet2;
    const mon = (STORE && STORE.journalMonth) || todayK.slice(0, 7);
    const sel = (STORE && STORE.journalSel) || todayK;
    /* ⚠️ 编辑器必须按**选中的日期**取条目，**不能**受分类筛选影响 ✗ ——
       以前 cur 是从分类筛选后的 hasSet 里取的 ✗，于是「把这条日记改成另一个分类」时
       它不再匹配当前筛选 → cur 变 null → 编辑器显示**模板** ✗，
       用户看到的就是「改分类把内容弄丢了」✗；更糟的是这时候一打字，
       persist() 会把模板写进那一天，**真的把原文覆盖掉** ✗✗。
       日历高亮用筛选后的 hasSet ✓（那是筛选该有的效果），但编辑器用全量 ✓。 */
    const cur = journalAll.find((x) => x.date === sel) || null;
    const WD = ["日", "一", "二", "三", "四", "五", "六"];
    /* 连续记录 */
    let streak = 0;
    for (let i = 0; i < 400; i++) { const d = new Date(); d.setDate(d.getDate() - i); const k = keyOf(d); if (journalAll.some((x) => x.date === k)) streak++; else if (i > 0) break; }

    /* 月历网格 */
    const [yy, mm] = mon.split("-").map(Number);
    const first = new Date(yy, mm - 1, 1);
    const startWd = first.getDay();
    const daysInMon = new Date(yy, mm, 0).getDate();
    const prevDays = new Date(yy, mm - 1, 0).getDate();
    const cells = [];
    for (let i = startWd - 1; i >= 0; i--) cells.push({ d: new Date(yy, mm - 2, prevDays - i), out: true });
    for (let i = 1; i <= daysInMon; i++) cells.push({ d: new Date(yy, mm - 1, i), out: false });
    while (cells.length % 7 !== 0) { const last = cells[cells.length - 1].d; cells.push({ d: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), out: true }); }
    const cal = '<div class="lw-cal-hd"><button id="lw-j-prev">‹</button>'
      + '<span class="m">' + yy + ' 年 ' + mm + ' 月</span><span class="sp"></span>'
      + '<button id="lw-j-today">今天</button><button id="lw-j-next">›</button></div>'
      + '<div class="lw-cal"><div class="lw-cal-wk">' + WD.map((w) => "<span>" + w + "</span>").join("") + '</div><div class="lw-cal-g">'
      + cells.map((c) => {
          const k = keyOf(c.d);
          const cls = ["lw-cal-d"];
          if (c.out) cls.push("out");
          if (hasSet[k]) cls.push("has");
          if (k === todayK) cls.push("today");
          if (k === sel) cls.push("sel");
          return '<div class="' + cls.join(" ") + '" ' + (c.out ? "" : 'data-jday="' + k + '"') + '>' + c.d.getDate() + "</div>";
        }).join("")
      + '</div></div>';

    /* 当天天气 */
    const dSel = new Date(sel + "T00:00:00");
    const wdName = "周" + WD[dSel.getDay()];
    /* ⚠️ 只返回**内容**，不带 card 外壳和标题 ✗ ——
       外层 J-04 面板已经提供了 `<h3>J-04 当天天气</h3>` ✓，
       这里再带一层就会**标题重复** ✗（之前就踩了 ✗）。 */
    let wxHtml = "";
    if (WX && WX.ok) {
      const ic = wx(WX.code)[0], nm = wx(WX.code)[1];
      wxHtml = '<div class="lw-kpi"><div class="row"><div class="ic">' + ic + '</div>'
        + '<div style="flex:1;min-width:0"><div class="num">' + Math.round(WX.temp) + '<small>°C</small></div></div>'
        + '<div style="text-align:right;font-size:11px;color:' + T.dim + ';line-height:1.8">' + esc(nm) + '<br>体感 ' + Math.round(WX.feels) + '° · 湿 ' + WX.hum + '%<br>风 ' + WX.wind + ' km/h</div></div>'
        + '<div class="cmp" style="margin-top:10px">' + (WX.days || []).filter((x) => x && x.date).slice(0, 3).map((x) => esc(String(x.date).slice(5)) + " " + wx(x.code)[0] + " " + Math.round(x.min) + "~" + Math.round(x.max) + "°").join("　") + '</div></div>';
    }

    /* 布局：左栏多面板（可逐个拖高 ✓）+ 右栏编辑区，整体填满视口 ✓ */
    const lw = (STORE.journalLeftW || 360);
    const cats = (STORE.journalCats || ['学习', '工作', '生活', '科研']);
    const catF = (STORE.journalCat || '');
    /* catOf 已并入 catOf2 ✓ */
    const catCount = {};
    const catList = cats.length ? cats.map((c) => '<div class="row ' + (catF === c ? 'on' : '') + '" data-jcat="' + esc(c) + '">'
        + '<span>▸ ' + esc(c) + '</span><span class="n">' + (catCount2[c] || 0) + '</span>'
        + '<span class="del" data-jcatdel="' + esc(c) + '" title="删除分类">✕</span></div>').join('')
      : '<div style="padding:8px 4px;color:' + T.faint + ';font-size:11px">还没有分类</div>';

    return '<div class="lw-jr" id="lw-jr">'
      + '<div class="lw-jr-l" id="lw-jr-l" style="width:' + lw + 'px">'

      + '<div class="lw-c" data-jpanel="cal" style="height:' + (STORE.jpH1 || 250) + 'px"><h3><span class="code">J-01</span>日历<span class="sp"></span><em>' + total + ' 篇' + (catNow ? ' · 筛选中' : '') + '</em></h3>'
      + '<div class="lw-cbd">' + cal + '</div></div><div class="lw-vgrip" data-vgrip="1"></div>'

      + '<div class="lw-c" data-jpanel="stat" style="height:' + (STORE.jpH2 || 150) + 'px"><h3><span class="code">J-03</span>连续记录<span class="sp"></span><em>共 ' + total + ' 篇</em></h3>'
      + '<div class="lw-cbd"><div class="lw-kpi"><div class="row"><div class="ic">◈</div><div style="flex:1;min-width:0"><div class="num">' + streak + '<small>天</small></div></div></div>'
      + '<div class="cmp">' + (streak ? "继续保持" : "今天开个头") + '</div></div></div></div><div class="lw-vgrip" data-vgrip="2"></div>'

      + '<div class="lw-c" data-jpanel="recent" style="height:' + (STORE.jpH3 || 170) + 'px"><h3><span class="code">J-05</span>最近写过<span class="sp"></span><em>' + (catNow ? '筛选中 ' + all.length + ' / 共 ' + total : '共 ' + total) + ' 篇</em></h3>'
      + '<div class="lw-cbd"><div class="lw-tbl">' + (all.length ? all.slice(0, 12).map((j) => '<div class="lw-tr" data-jday="' + esc(j.date) + '">'
          + '<span class="nm">' + esc(String(j.date || '').slice(5)) + (catOf2(j) ? ' <i>#' + esc(catOf2(j)) + '</i>' : '') + '</span><span class="bd">' + String(j.text || "").length + ' 字</span>'
          + '<span class="tm">' + esc(String(j.text || "").replace(/\n/g, ' ').slice(0, 8)) + '</span></div>').join("") : '<div class="lw-empty">还没写过</div>') + '</div></div></div><div class="lw-vgrip" data-vgrip="3"></div>'

      + '<div class="lw-c" data-jpanel="cat" style="height:' + (STORE.jpH4 || 200) + 'px"><h3><span class="code">J-06</span>管理分类<span class="sp"></span><em>点选筛选</em></h3>'
      + '<div class="lw-cbd"><div class="lw-cats">'
      + '<div class="row ' + (catF ? '' : 'on') + '" data-jcat="">▸ 全部分类<span class="n">' + total + '</span></div>'
      + catList
      + '<div class="add"><input id="lw-jcat-new" placeholder="新分类名…" /><button id="lw-jcat-add">＋ 添加</button></div>'
      + '</div></div></div><div class="lw-vgrip" data-vgrip="4"></div>'

      + '<div class="lw-c" data-jpanel="wx" style="height:' + (STORE.jpH5 || 190) + 'px"><h3><span class="code">J-04</span>当天天气<span class="sp"></span><em>' + (WX && WX.ok ? esc(WX.city) + '（点顶部天气可换地区）' : '加载中…') + '</em></h3>'
      + '<div class="lw-cbd">' + (wxHtml || '<div class="lw-empty">天气加载中…</div>') + '</div></div>'

      + '</div>'
      + '<div class="lw-jr-grip" id="lw-jr-grip" title="拖动调整宽度"></div>'
      + '<div class="lw-jr-r">'
      + '<div class="lw-jr-edit" id="lw-jr-edit" style="flex:1;min-height:0">'
      + '<div class="lw-c" style="flex:1;min-height:0;display:flex;flex-direction:column"><h3 style="flex:none"><span class="code">J-02</span>' + esc(sel) + ' · ' + wdName
      /* ⚠️ 这里显示的是**条目自己的分类**（cur.cat），**不是**左侧筛选的分类 ✗ ——
         编辑器按日期取条目、不受筛选影响 ✓，所以筛选「工作」时完全可能在编辑一篇「生活」，
         标题上写筛选值会让用户以为串了 ✗。筛选值在左栏 J-06 已经高亮了 ✓。 */
      + (cur && catOf2(cur) ? ' <span style="color:' + T.accent + '">#' + esc(catOf2(cur)) + '</span>' : '')
      + (catF && (!cur || catOf2(cur) !== catF) ? ' <span style="color:' + T.faint + ';font-weight:400">（不在「' + esc(catF) + '」筛选内）</span>' : '')
      + '<span class="sp"></span><em>' + (cur ? "已写 " + String(cur.text || "").length + " 字" : "还没写") + '</em></h3>'
      + '<div class="lw-jtpl">模板：' + Object.keys(J_TPL).map((k) => '<button data-jtpl="' + k + '" title="插入' + J_TPL[k].name + '模板">' + J_TPL[k].icon + ' ' + J_TPL[k].name + '</button>').join('')
      + '<span class="sp"></span><label style="font-size:10.5px;color:' + T.faint + ';display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="lw-j-autotpl"' + (STORE.journalAutoTpl === false ? '' : ' checked') + ' style="accent-color:' + T.accent + '"/>新建时自动套用</label></div>'
      + '<div class="lw-live-bar"><span class="brand">✎ 边写边渲染</span>'
      + '<span class="hint">光标行显示源码，其他行即时渲染</span>'
      + '<span class="sp"></span>'
      + '<select id="lw-j-catsel">'
      + '<option value="">无分类</option>' + cats.map((c) => '<option value="' + esc(c) + '"' + (cur && catOf2(cur) === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>'
      + '<button id="lw-j-md" title="把当前行变成标题"># 标题</button>'
      + '<button id="lw-j-ck" title="把当前行变成清单项">☐ 清单</button>'
      + '</div>'
      + '<div class="lw-ce" id="lw-j-ce" contenteditable="true" spellcheck="false">' + ceHtml(cur ? cur.text : (STORE.journalAutoTpl === false ? '' : J_TPL.daily.text), 0) + '</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid ' + T.lineDim + '">'
      + (cur ? '<button class="lw-btn" id="lw-j-del">删除这篇</button>' : "")
      + '<button class="lw-btn" id="lw-j-save">保存</button></div></div></div>'
      + '</div></div>';
  }

  /* ── 研究方向 ── */
  /* 研究方向的项目卡 —— 内容是**本机文件** ✓，所以按用户要求放进「文件」视图 ✓ */
  function tracksCards() {
    const tracks = DATA.tracks || [];
    if (!tracks.length) return '';
    const max = Math.max(1, ...tracks.map((t) => t.files));
    return tracks.map((t) => card(`${t.icon} ${esc(t.name)}`,
      `${t.projects} 项目 · ${t.files} 文件 · ${t.sizeText}`,
      `<div class="lw-pad" style="padding-bottom:2px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:10px;color:${T.faint};letter-spacing:.6px">占比</span>
          <div style="flex:1;height:6px;background:rgba(255,255,255,.06);overflow:hidden">
            <i style="display:block;height:100%;width:${Math.round(t.files / max * 100)}%;background:${t.color}"></i></div>
          <span style="font-size:10px;color:${T.dim}">${Math.round(t.files / max * 100)}%</span>
        </div></div>
       <div class="lw-tbl">${t.list.map((p) => `<div class="lw-tr" data-path="${esc(p.path)}">
        <span class="nm">${esc(p.name)} <i>${esc(p.base)}</i></span>
        <span class="bd">${p.files} 文件</span><span class="sz">${p.sizeText}</span>
        <span class="tm">${ago(p.newest)}</span></div>`).join('')}</div>`, 6)).join('');
  }

  function viewTracks() {
    const tracks = DATA.tracks || [];
    if (!tracks.length) return emptyBox('还没扫到项目');
    const max = Math.max(1, ...tracks.map((t) => t.files));
    const totalProjects = tracks.reduce((a, t) => a + t.projects, 0);
    const totalFiles = tracks.reduce((a, t) => a + t.files, 0);
    const hottest = tracks.slice().sort((a, b) => b.files - a.files)[0] || null;

    /* 顶部概览（原来一上来就是卡片墙 ✗，缺一个总览 ✗）*/
    const kpis = [
      kpiCard('◈', tracks.length, '个方向', '研究方向', '按最近改动排序', 3, 'sky'),
      kpiCard('▦', totalProjects, '个项目', '全部方向', `覆盖 ${totalFiles} 个文件`, 3, 'lilac'),
      kpiCard('◉', hottest ? hottest.name : '—', '', '最活跃', hottest ? `${hottest.files} 文件 · ${hottest.sizeText}` : '—', 3, 'mint'),
      kpiCard('🔥', ((STORE && STORE.hot) || {}).count || 0, '条', '网上热点', (STORE && STORE.hotQ) ? '关键词：' + esc(STORE.hotQ) : '下面点「搜热点」', 3, 'lemon'),
    ].join('');

    /* 🔥 网上热点 —— **自动推** ✓（不用手动搜 ✗）
       关键词自动从**你的研究方向 / 项目名**里提取 ✓。 */
    const hotQ = (STORE && STORE.hotQ) || '';
    const hotRes = (STORE && STORE.hot) || null;
    /* 自动关键词：取项目名里"有意义的词"（去掉版本号/前缀，保留英文与中文 ✓）*/
    const autoKw = (() => {
      const words = [];
      /* ⚠️ 只要**英文词** ✓ —— Hacker News 是英文站 ✗，中文关键词搜出来是空的 ✗ */
      const keep = (w) => /[A-Za-z]/.test(w) && !/[\u4e00-\u9fa5]/.test(w) && w.length >= 3;
      (DATA.tracks || []).forEach((t) => {
        String(t.id || '').trim().split(/[-_]+/).forEach((x) => { if (keep(x)) words.push(x); });
        (t.list || []).slice(0, 5).forEach((p) => {
          String(p.name || '').replace(/[-_]+/g, ' ').replace(/\b(test|demo|new|old|main|master|v?\d+)\b/gi, ' ')
            .split(/\s+/).forEach((x) => { if (keep(x)) words.push(x); });
        });
      });
      const uniq = Array.from(new Set(words));
      /* 不够 2 个词就补通用词 ✓（否则搜出来是空的 ✗）*/
      while (uniq.length < 2) uniq.push(uniq.length === 0 ? 'robotics' : 'robot');
      return uniq.slice(0, 2).join(' ');
    })();
    const hotHtml = (STORE && STORE.hotLoading) ? '<div class="lw-empty">正在自动搜相关热点…</div>'
      : (hotRes && hotRes.ok)
        ? (hotRes.items || []).map((h) => `<div class="lw-hotrow">
            <div class="t"><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a></div>
            <div class="m">▲ ${h.points} · 💬 ${h.comments} · ${esc(String(h.at).slice(0, 10))}</div></div>`).join('')
        : (hotRes && hotRes.error ? `<div class="lw-empty">${esc(hotRes.error)}</div>`
          : '<div class="lw-empty"><span class="big">🔥</span>正在准备…</div>');
    const hotCard = `<div class="lw-c" style="${sp(6)}">
      <h3><span class="code">F-90</span>网上热点<span class="sp"></span>
        <em>${hotQ ? '按「' + esc(hotQ) + '」自动推' : '自动推'}</em></h3>
      <div class="lw-pad" style="padding-bottom:10px">
        <div class="lw-search"><input id="lw-hot-q" placeholder="换关键词（回车即可）" value="${esc(hotQ)}" />
          <button class="lw-btn" id="lw-hot-go">换一批</button></div>
        <div class="lw-chips" style="margin-top:9px">
          ${autoKw ? `<span class="lw-chip lw-hotkw" data-kw="${esc(autoKw)}">★ 我的方向</span>` : ''}
          ${(tracks || []).slice(0, 4).map((t) => `<span class="lw-chip lw-hotkw" data-kw="${esc(t.name)}">${esc(t.name)}</span>`).join('')}
        </div>
      </div>
      <div class="lw-hotlist">${hotHtml}</div>
    </div>`;

    /* 🤖 AI 助手 —— **复用 CodeScope 已有的配置和接口** ✓
       ⚠️ 我一开始自己又造了一套 AI 配置 ✗ —— 但 CodeScope 早就有了 ✗：
        · 配置在 localStorage['mc-ai-cfg'] ✓（{ url, key, model } ✓）
        · 接口是 POST /api/ai/chat ✓（服务器只做转发 ✓）
        · 还有 POST /api/ai/web-search ✓（Tavily / Brave 联网搜索 ✓）
       所以这里**只读现成配置 + 调现成接口** ✓，不再自己存一份 ✗。 */
    const aiCfg = (() => { try { return JSON.parse(localStorage.getItem('mc-ai-cfg') || '{}') || {}; } catch (_) { return {}; } })();
    const aiReady = !!(aiCfg.url && aiCfg.key);
    const aiRes = (STORE && STORE.aiRes) || null;
    const wsRes = (STORE && STORE.wsRes) || null;
    const aiCard = `<div class="lw-c" style="${sp(6)}">
      <h3><span class="code">F-91</span>AI 助手<span class="sp"></span>
        <em>${aiReady ? '用 CodeScope 的配置 · ' + esc(aiCfg.model || '未指定模型') : '未配置'}</em></h3>
      <div class="lw-pad" style="padding-bottom:10px">
        <div style="font-size:11px;color:${T.dim};line-height:1.8;margin-bottom:10px">
          ${aiReady
            ? '✓ 已复用 CodeScope 的 AI 配置（<b style="color:' + T.accent + '">' + esc(String(aiCfg.url).replace(/^https?:\/\//, '').slice(0, 34)) + '</b>）——不用再配一遍 ✓'
            : '⚠️ 还没配 AI —— 请到 <b style="color:' + T.accent + '">CodeScope 的 AI 面板</b> 配一次 ✓，这里会自动复用 ✓（不再重复造配置 ✗）'}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="lw-btn" id="lw-ai-hot" ${aiReady ? '' : 'disabled style="opacity:.45"'}>让 AI 总结热点</button>
          <button class="lw-btn" id="lw-ai-idea" ${aiReady ? '' : 'disabled style="opacity:.45"'}>让 AI 出选题</button>
          <button class="lw-btn" id="lw-ai-read" ${aiReady ? '' : 'disabled style="opacity:.45"'}>AI 读这篇（选中热点）</button>
        </div>
      </div>
      <div class="lw-hotlist" id="lw-ai-out">${(STORE && STORE.aiLoading) ? '<div class="lw-empty">AI 思考中…</div>'
        : (aiRes ? (aiRes.ok ? `<div class="lw-aiout">${esc(aiRes.text).replace(/\n/g, '<br>')}</div>` : `<div class="lw-empty">${esc(aiRes.error)}</div>`)
          : '<div class="lw-empty"><span class="big">🤖</span>可以让 AI 帮你读热点、出选题</div>')}</div>
    </div>`;

    /* 🔍 联网搜索（复用 CodeScope 的 /api/ai/web-search ✓ —— Tavily / Brave ✓）*/
    const wsHtml = (STORE && STORE.wsLoading) ? '<div class="lw-empty">联网搜索中…</div>'
      : (wsRes && wsRes.ok)
        ? (wsRes.results || []).map((r) => `<div class="lw-hotrow">
            <div class="t"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></div>
            <div class="m">${esc(String(r.content || r.snippet || '').slice(0, 150))}</div></div>`).join('')
        : (wsRes && wsRes.error ? `<div class="lw-empty">${esc(wsRes.error)}</div>`
          : '<div class="lw-empty"><span class="big">🔍</span>输入问题，去网上搜一圈</div>');
    const wsCard = `<div class="lw-c" style="${sp(12)}">
      <h3><span class="code">F-92</span>联网搜索<span class="sp"></span><em>复用 CodeScope · Tavily / Brave</em></h3>
      <div class="lw-pad" style="padding-bottom:10px">
        <div class="lw-search"><input id="lw-ws-q" placeholder="想问什么？比如「legged robot 最新 SOTA 是什么」" value="${esc((STORE && STORE.wsQ) || '')}" />
          <button class="lw-btn" id="lw-ws-go">联网搜索</button></div>
        <div style="font-size:10.5px;color:${T.faint};margin-top:8px">用 CodeScope 已配的搜索 Key ✓；没配的话它会提示 ✓</div>
      </div>
      <div class="lw-hotlist">${wsHtml}</div>
    </div>`;

    /* 把「论文检索」的内容并进研究方向 ✓
       （用户：「论文检索，应该放到研究方向里面去」✓）
       直接把 viewPaper() 的结果**剥掉外层 lw-g12 容器** ✓ 再拼进来 ✓，
       这样不用改 viewPaper 本身 ✓，两边内容也不会互相覆盖 ✓。 */
    const paperInner = String(viewPaper() || '').replace(/^\s*<div class="lw-g12">/, '').replace(/<\/div>\s*$/, '');
    return `<div class="lw-g12">${kpis}${hotCard}${aiCard}${wsCard}${paperInner}</div>`;
  }

  /* ── 论文 ── */
  function viewPaper() {
    const local = (DATA.recent || []).filter((f) => /\.(pdf|docx?|tex|md)$/i.test(f.name));
    const tracks = (DATA.tracks || []).filter((t) => ['robot', 'rl', 'paper'].includes(t.id));
    const q = (STORE && STORE.paperQ) || '';
    const res = (STORE && STORE.paperRes) || null;
    const kw = ['legged robot locomotion', 'bipedal wheeled robot control', 'reinforcement learning locomotion', 'MPC legged robot'];
    const resHtml = (STORE && STORE.paperLoading) ? '<div class="lw-empty">正在检索 arXiv…</div>'
      : (res && res.ok ? (res.items || []).map((p) => `<div class="lw-parow">
            <div class="t"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></div>
            <div class="m">${esc((p.authors || []).join(', '))} · ${esc(p.published)}</div>
            <div class="s">${esc(p.summary)}</div></div>`).join('')
        : (res && res.error ? `<div class="lw-empty">${esc(res.error)}</div>` : '<div class="lw-empty"><span class="big">▤</span>输入关键词，或点一个推荐词</div>'));
    return `<div class="lw-g12">
      <div class="lw-c" style="${sp(12)}">
        <h3><span class="code">P-01</span>论文检索<span class="sp"></span><em>arXiv 在线 + 本机库</em></h3>
        <div class="lw-pad">
          <div class="lw-search"><input id="lw-paper-q" placeholder="关键词，如 legged robot MPC…" value="${esc(q)}" /><button class="lw-btn" id="lw-paper-go">检索</button></div>
          <div class="lw-chips" style="margin-top:10px">${kw.map((k) => `<span class="lw-chip lw-kw" data-kw="${esc(k)}">${esc(k)}</span>`).join('')}</div>
        </div>
      </div>
      <div class="lw-c" style="${sp(7)}">
        <h3><span class="code">P-02</span>在线论文推荐<span class="sp"></span><em>arXiv 最新</em></h3>
        <div class="lw-plist">${resHtml}</div>
      </div>
      <div class="lw-c" style="${sp(5)}">
        <h3><span class="code">P-03</span>我电脑里的论文<span class="sp"></span><em>${local.length} 个</em></h3>
        <div class="lw-tbl">${local.slice(0, 16).map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext)}</span><span class="tm">${ago(f.mtime)}</span></div>`).join('') || '<div class="lw-empty">没找到论文文件</div>'}</div>
      </div>
      <div class="lw-c" style="${sp(12)}">
        <h3><span class="code">P-04</span>按研究方向找<span class="sp"></span><em>点一下用该方向的项目名检索</em></h3>
        <div class="lw-pad"><div class="lw-chips">${tracks.flatMap((t) => (t.list || []).slice(0, 5).map((p) =>
          `<span class="lw-chip lw-kw" data-kw="${esc(p.name.replace(/[_\-.].*$/, ''))}">${esc(p.name)}</span>`)).join('')}</div></div>
      </div>
    </div>`;
  }


  /* ── 文件 ── */
  function viewFiles() {
    const exts = Object.entries(DATA.byExt || {}).sort((a, b) => b[1] - a[1]).slice(0, 30);
    const recent = (DATA.recent || []).slice(0, 30);
    const byKind = Object.entries(DATA.byKind || {}).sort((a, b) => b[1] - a[1]);
    return `<div class="lw-g12">
      ${card('文件构成', `${DATA.totals.files} 个文件 · ${DATA.totals.sizeText}`,
        `<div class="lw-pad">${byKind.map(([k, v]) => {
          const pct = Math.round(v / (DATA.totals.files || 1) * 100);
          return `<div style="margin-bottom:10px"><div style="display:flex;font-size:11px;color:${T.dim};margin-bottom:5px">
            <span style="flex:1">${KIND_NAME[k] || k}</span><span>${v} · ${pct}%</span></div>
            <div style="height:7px;border-radius:5px;background:rgba(255,255,255,.06)"><i style="display:block;height:100%;width:${pct}%;border-radius:5px;background:${KIND_COLOR[k] || T.faint}"></i></div></div>`;
        }).join('')}</div>`, 4)}
      ${card('扩展名分布', '', `<div class="lw-pad"><div class="lw-chips">${exts.map(([e, n]) => `<span class="lw-chip">${esc(e)}<b>${n}</b></span>`).join('')}</div></div>`, 8)}
      ${card('最近改动', '点一行复制完整路径',
        `<div class="lw-tbl">${recent.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext || '—')}</span><span class="sz">${fmtBytes(f.size)}</span>
          <span class="tm">${ago(f.mtime)}</span></div>`).join('')}</div>`, 12)}
      ${/* 把「时间」的内容并进文件 ✓（用户：「时间也应该放到文件里面」✓）
           同样剥掉 viewTime() 的外层 lw-g12 ✓，两边不互相覆盖 ✓ */
        String(viewTime() || '').replace(/^\s*<div class="lw-g12">/, '').replace(/<\/div>\s*$/, '')}
      ${tracksCards()}
    </div>`;
  }

  /* ── 时间 ── */
  function viewTime() {
    const days = DATA.days || [];
    const max = Math.max(1, ...days.map((x) => x.count));
    const total = days.reduce((a, x) => a + x.count, 0);
    const active = days.filter((x) => x.count).length;
    const peak = days.find((x) => x.count === max) || {};
    return `<div class="lw-g12">
      ${kpiCard('Σ', total, '个改动', '近 14 天', '日均 ' + (total / 14).toFixed(1) + ' 个', 3, 'rose')}
      ${kpiCard('◔', active, '天', '有改动', '共 14 天', 3, 'sky')}
      ${kpiCard('↑', max, '个', '单日峰值', peak.label || '—', 3, 'lilac')}
      ${kpiCard('▦', DATA.totals.projects, '个', '在跟的项目', DATA.totals.sizeText, 3, 'mint')}
      ${card('改动趋势', '近 14 天', `<div class="lw-pad"><div style="padding:4px 0">${spark(days.map((x) => x.count), 460, 84, T.accent)}</div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:${T.faint};margin-top:6px">
          <span>${(days[0] || {}).label || ''}</span><span>${(days[days.length - 1] || {}).label || ''}</span></div></div>`, 6)}
      ${card('每日改动量', `峰值 ${max}`, `<div class="lw-pad"><div class="lw-bars">${days.map((x) => `<div title="${x.date} · ${x.count}">
        <span class="v">${x.count || ''}</span><span class="b" style="height:${Math.max(3, Math.round(x.count / max * 88))}px"></span>
        <span class="k">${x.label}</span></div>`).join('')}</div></div>`, 6)}
      ${card('各方向最近活跃', '点一行复制项目路径',
        `<div class="lw-tbl">${(DATA.tracks || []).map((t) => `<div class="lw-tr" data-path="${esc((t.list[0] || {}).path || '')}">
          <span class="nm">${t.icon} ${esc(t.name)} <i>${t.projects} 个项目</i></span>
          <span class="bd" style="background:${t.color}22;color:${t.color}">${t.files} 文件</span>
          <span class="sz">${t.sizeText}</span><span class="tm">${ago(t.newest)}</span></div>`).join('')}</div>`, 12)}
    </div>`;
  }

  /* ── 邮箱 / 外部入口 ── */
  const MAIL_PRESET = {
    qq: { name: 'QQ 邮箱', host: 'smtp.qq.com', port: '465', imapHost: 'imap.qq.com', imapPort: '993', web: 'https://mail.qq.com' },
    '163': { name: '网易邮箱', host: 'smtp.163.com', port: '465', imapHost: 'imap.163.com', imapPort: '993', web: 'https://mail.163.com' },
    gmail: { name: 'Gmail', host: 'smtp.gmail.com', port: '465', imapHost: 'imap.gmail.com', imapPort: '993', web: 'https://mail.google.com' },
    wx: { name: '无限邮', host: 'smtp.2925.com', port: '465', imapHost: 'imap.2925.com', imapPort: '993', web: 'https://mail.2925.com' },
  };

  /* ── 按邮箱地址自动判断服务商 ──────────────────────────────────────────
     用户要求「自行获取我的谷歌邮箱SMTP」—— 不该让人手敲 smtp.gmail.com ✓。
     只要填了邮箱地址，SMTP / IMAP 的服务器和端口就自动补上 ✓。
     常见服务商的官方参数（端口 465 = SSL，587 = STARTTLS）： */
  const MAIL_BY_DOMAIN = [
    { re: /@(gmail|googlemail)\.com$/i, host: 'smtp.gmail.com', port: '465', imapHost: 'imap.gmail.com', imapPort: '993', note: 'Gmail 需要「应用专用密码」，不能用登录密码' },
    { re: /@(qq|foxmail)\.com$/i, host: 'smtp.qq.com', port: '465', imapHost: 'imap.qq.com', imapPort: '993', note: 'QQ 邮箱需要「授权码」（设置 → 账户 → POP3/SMTP 服务）' },
    { re: /@(163|126)\.com$/i, host: 'smtp.163.com', port: '465', imapHost: 'imap.163.com', imapPort: '993', note: '网易邮箱需要「授权码」' },
    /* 无限邮（2925）：实测 smtp/imap/pop3 都是 465 / 993 / 995（SSL），587 超时不通 ✗ */
    { re: /@2925\.com$/i, host: 'smtp.2925.com', port: '465', imapHost: 'imap.2925.com', imapPort: '993', note: '无限邮 2925：用 465/993（SSL），587 不通' },
    { re: /@(outlook|hotmail|live)\.(com|cn)$/i, host: 'smtp.office365.com', port: '587', imapHost: 'outlook.office365.com', imapPort: '993', note: 'Outlook / Hotmail 用 STARTTLS（587）' },
    { re: /@(yahoo|ymail)\.com$/i, host: 'smtp.mail.yahoo.com', port: '465', imapHost: 'imap.mail.yahoo.com', imapPort: '993', note: 'Yahoo 需要「应用密码」' },
    { re: /@(icloud|me|mac)\.com$/i, host: 'smtp.mail.me.com', port: '587', imapHost: 'imap.mail.me.com', imapPort: '993', note: 'iCloud 需要「App 专用密码」' },
    { re: /@(sina|sina\.cn)$/i, host: 'smtp.sina.com', port: '465', imapHost: 'imap.sina.com', imapPort: '993', note: '新浪邮箱需要开启 SMTP 服务' },
    { re: /@(139|189)\.com$/i, host: 'smtp.139.com', port: '465', imapHost: 'imap.139.com', imapPort: '993', note: '移动 / 电信邮箱需要开启 SMTP 服务' },
    { re: /@aliyun\.com$|@(aliyun|mxhichina)\./i, host: 'smtp.mxhichina.com', port: '465', imapHost: 'imap.mxhichina.com', imapPort: '993', note: '阿里企业邮箱' },
  ];
  function mailGuess(user) {
    const u = String(user || '').trim();
    if (!u || u.indexOf('@') < 0) return null;
    return MAIL_BY_DOMAIN.find((p) => p.re.test(u)) || null;
  }

  /* 邮箱配置的**权威在服务端**（life-mail.json，密码不回传明文，只回 hasPass）。
     ⚠️ 以前只有 POST 没有 GET ✗ —— 保存后一刷新就全变「未配置」，
        用户之前填好的 Gmail 也读不出来（服务端明明存着）✗。 */
  let MAIL_LOADING = false;
  let MAIL_ACCOUNTS_LOADED = false;
  /* ★★ 账号配置**只加载一次**（force=true 才重新拉）——
     以前 `bind()` 里 `TAB==='mail'` 就无条件调它 ✗，而它拉完又会 `render()` ✗
     → `render()` → `bind()` → 再调它 → **render/fetch 乒乓** ✗。
     实测：进一次邮箱页发 4×`/boxes` + 4×`/list`（**8 条 IMAP 连接**，
     每条 0.6~3.7 秒，因为服务端每个请求都要新建 TLS + 登录）✗✗ ——
     用户感觉到的「点击很卡」就是这个，前端渲染其实只要 8ms ✓。
     账号配置是用户手动改的，没有理由每次渲染都去问服务端 ✓。 */
  async function loadMailAccounts(force) {
    if (MAIL_LOADING) return;
    if (!force && MAIL_ACCOUNTS_LOADED) return;
    MAIL_LOADING = true;
    try {
      const r = await fetch('/api/life/mail', { cache: 'no-store' });
      const d = await r.json();
      if (d && d.ok && d.accounts) {
        const before = JSON.stringify(STORE.mailAcc || {});
        /* 服务端为准，但保留本地已有的（比如刚填还没保存的）✓ */
        STORE.mailAcc = Object.assign({}, STORE.mailAcc || {}, d.accounts);
        MAIL_ACCOUNTS_LOADED = true;
        /* ⚠️ 以前只在 TAB==='mail' 时 render() ✗ → 停在「今日」页时
           顶栏的邮箱胶囊永远显示「未配置」✗（账号其实早就读回来了）。
           现在无论在哪一页都重画胶囊 ✓；在邮箱页才整屏重渲染 ✓。 */
        paintMailBadge();
        ensureMailStatusTimer();
        /* ★ 只有账号**真的变了**才整屏重渲染 ✓ —— 否则又成乒乓 ✓ */
        const changed = before !== JSON.stringify(STORE.mailAcc);
        if (changed && TAB === 'mail' && document.getElementById('lifework-view')) { render(); ensureMailLoad(); }
        /* ★★★ 已经有未读数了就**别再拉一次** ✗✗ ——
           用户原话：「窗口无法拖拽，下面一大半都是空白」（这次是在自检时顺带发现的 ✗）。
           现象：打开一封未读邮件（顶栏 3 → 2 ✓），
           只要**再点一下「邮箱」页签**（或从别的页签切回邮箱 ✗），顶栏未读数就**跳回 3** ✗✗，
           要等 60 秒服务端缓存过期才自然校正 ✗。
           根因链：切页签 → `loadMailAccounts(true)`（强制 ✗）→ 账号没变 → 走到这里
           → `mailLoadStatus(false)` 重新拉 → 服务端**缓存还是旧的 60 秒内的值** ✗
           → `MAIL_STATUS = d` 把**本地刚减掉的数冲回去** ✗。
           → 所以只在「**一次都还没拿到**未读数」时才顺手拉 ✓；
             之后的刷新交给 75 秒轮询 / 切回前台补查 ✓（那两条是**设计好**的刷新点 ✓），
             它们拿到的也才是真正过期后的新值 ✓。 */
        else if (!MAIL_STATUS) mailLoadStatus(false);
      }
    } catch (_) {} finally { MAIL_LOADING = false; }
  }

  /* ── 邮箱：收件箱（IMAP 收信）────────────────────────────────────────────
     用户原话：「邮箱不是配置放着，我需要的是通过SMTP来进行邮箱的管理和查阅」
     → 主体改成**收件箱**（账号 / 邮件列表 / 正文阅读 三栏 ✓），
       配置收进「⚙ 账号配置」，要用时才展开 ✓。
     密码永远只在服务端 ✓，前端只传账号 key ✓。 */

  /* 列表里的时间：今天给时分、今年给月日、更早给年月日 ✓（省地方 ✓）*/
  function mailWhen(ms) {
    if (!ms) return '';
    const d = new Date(ms), now = new Date(), p = (n) => String(n).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return p(d.getHours()) + ':' + p(d.getMinutes());
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function mailFullTime(ms) {
    if (!ms) return '(没有日期)';
    const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function mailSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  /* 纯文本正文 → HTML：转义 ✓ + 链接化 ✓（换行交给外层 white-space:pre-wrap ✓）*/
  function mailTextHtml(text) {
    return esc(text).replace(/(https?:\/\/[^\s<>"'）】]+)/g,
      (u) => '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
  }

  /* ── 把邮件 HTML 包成 iframe 文档 ────────────────────────────────────────
     ★★ 安全：邮件正文是**不可信内容** ✗ —— 里面的 <script> / on* 事件一旦执行，
        就等于让发件人在本地面板里跑任意代码 ✗（面板能读本机数据 ✗）。
        所以**必须**用 `<iframe sandbox>` ✓（不带 allow-scripts ✓），
        再叠一层 CSP 兜底 ✓。**不要**图省事直接 innerHTML 塞进主文档 ✗。
     ★ 远程图片默认**屏蔽** ✓（CSP 里 img-src 不给 http/https）：
        营销邮件常用 1px 追踪像素回报「你什么时候打开、打开了几次」✗，
        主流邮件客户端默认也是不加载 ✓。要看图点「🖼 显示图片」✓。
     ★ 内嵌图（`cid:xxx`）已经在服务端转成 data URL ✓，这里换回去 ✓，
        不然邮件里的插图全是破图 ✗。 */
  function mailFrameDoc(msg, showImages) {
    let body = String(msg.html || '');
    /* 把 <style> 抠出来放进 head ✓（很多邮件把排版写在 head 的 style 里，
       只取 body 的话样式全丢 ✗） */
    const styles = [];
    body = body.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => { styles.push(css); return ''; });
    /* <script> 一律删掉 ✓（sandbox + CSP 已经拦住了，但留着也是垃圾 ✓）*/
    body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    /* cid: 内嵌图 → data URL ✓ */
    for (const im of (msg.inline || [])) {
      if (!im.cid) continue;
      const safe = String(im.cid).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      body = body.replace(new RegExp('cid:' + safe, 'gi'), im.dataUrl);
    }
    const imgSrc = showImages ? "img-src data: cid: https: http:" : 'img-src data: cid:';
    const csp = "default-src 'none'; " + imgSrc + "; style-src 'unsafe-inline'; font-src data:; media-src data:;";
    return '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'
      + '<style>'
      + 'html,body{margin:0;padding:0;background:#fff;color:#1a1a1a;}'
      + 'body{padding:16px 18px;font:13px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;word-break:break-word;overflow-wrap:anywhere;}'
      + 'img{max-width:100%;height:auto;}a{color:#1a5fb4;}'
      + 'table{max-width:100%;}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #ddd;color:#555;}'
      + 'pre{white-space:pre-wrap;word-break:break-word;background:#f5f5f5;padding:8px;font-size:12px;}'
      + '</style>'
      + (styles.length ? '<style>' + styles.join('\n') + '</style>' : '')
      + '</head><body>' + body + '</body></html>';
  }

  /* ── 顶栏邮箱胶囊 ──────────────────────────────────────────────────────── */
  function mailConfiguredKeys() {
    const acc = (STORE && STORE.mailAcc) || MAIL_BOOT.acc || {};
    return Object.keys(MAIL_PRESET).filter((k) => acc[k] && String(acc[k].user || '').trim());
  }
  function mailBadgeHtml() {
    /* ⚠️ `mailAcc` 还没读回来（undefined）时要显示「检查中」✗ 不能显示「未配置」✗ ——
       否则面板刚打开那 1 秒会闪一下错的提示，看起来像「我的配置丢了」✗。 */
    if (STORE && (STORE.mailAcc === undefined || STORE.mailAcc === null)) {
      return '<div class="lw-mb" id="lw-mb" title="正在读取邮箱配置…"><span class="ic">✉</span>'
        + '<div class="t">读取邮箱…</div></div>';
    }
    const keys = mailConfiguredKeys();
    if (!keys.length) {
      return '<div class="lw-mb" id="lw-mb" title="还没有配置邮箱账号 —— 点这里去配置"><span class="ic">✉</span>'
        + '<div class="t">邮箱未配置<br>点这里添加</div></div>';
    }
    if (!MAIL_STATUS) {
      return '<div class="lw-mb" id="lw-mb" title="正在检查邮箱…"><span class="ic">✉</span><span class="n">·</span>'
        + '<div class="t">检查中…</div></div>';
    }
    const accts = MAIL_STATUS.accounts || [];
    const good = accts.filter((a) => a.ok);
    const bad = accts.filter((a) => !a.ok);
    const total = MAIL_STATUS.total || 0;
    const latest = good.map((a) => a.latest).filter(Boolean).sort((a, b) => (b.date || 0) - (a.date || 0))[0];
    /* 一个账号都没通 → 显示红色错误胶囊 ✓（静默失败最坑 ✗，必须让人看见 ✗）*/
    if (!good.length) {
      const why = bad[0] ? String(bad[0].error || '连接失败').slice(0, 46) : '连接失败';
      return '<div class="lw-mb bad" id="lw-mb" title="' + esc(accts.map((a) => a.user + '：' + (a.ok ? '正常' : a.error)).join('\n')) + '">'
        + '<span class="ic">✉</span><div class="t">收信失败 · ' + esc(why) + '</div></div>';
    }
    const title = accts.map((a) => a.user + '：' + (a.ok ? (a.unseen + ' 封未读 / 共 ' + a.messages) : ('✗ ' + a.error))).join('\n');
    const tip = latest
      ? esc(String(latest.from || '').slice(0, 18)) + ' · ' + esc(String(latest.subject || '').slice(0, 40))
      : '没有未读邮件';
    return '<div class="lw-mb' + (total ? ' has' : '') + '" id="lw-mb" title="' + esc(title) + '">'
      + '<span class="ic">✉</span>'
      + (total ? '<span class="n">' + total + '</span>' : '')
      + '<div class="t">' + (total ? '未读 · ' + tip : '收件箱已读 · ' + tip) + '</div></div>';
  }
  function paintMailBadge() {
    const el = document.getElementById('lw-mb');
    if (!el) return;
    el.outerHTML = mailBadgeHtml();
    const next = document.getElementById('lw-mb');
    if (next) next.onclick = () => { TAB = 'mail'; render(); ensureMailLoad(); };
  }
  /* ── 新邮件提醒 ──────────────────────────────────────────────────────────
     轮询未读数 → 比上次**多**了就提醒 ✓。三条必须守的：
       ① **首次拿到只当基线** ✗ —— 否则一打开面板就报「有新邮件」✗（未读本来就是 97 封）。
       ② **后台标签页不轮询** ✗ —— 一直连邮箱没必要，还会把连接池占着 ✗；
          切回前台立刻补查一次 ✓。
       ③ 提醒要能在**面板关着**时出现 ✓ —— 所以浮层挂 body、不挂面板 ✓。 */
  function mailNotifyEnabled() {
    if (STORE && STORE.mailNotify !== undefined) return STORE.mailNotify !== false;
    if (MAIL_BOOT.notify !== undefined) return MAIL_BOOT.notify !== false;
    return true;                                   /* 默认开 ✓ */
  }

  function mailHideToast() {
    clearTimeout(MAIL_TOAST_TIMER);
    const el = document.getElementById('lw-toast');
    if (el) el.remove();
  }

  function mailShowToast(delta, latest) {
    mailHideToast();
    const el = document.createElement('div');
    el.className = 'lw-toast';
    el.id = 'lw-toast';
    el.title = '点这里打开邮箱';
    el.innerHTML = '<div class="ic">✉</div><div class="bd">'
      + '<div class="t1">新邮件 · ' + delta + ' 封</div>'
      + '<div class="t2">' + esc(String((latest && latest.from) || '（未知发件人）').slice(0, 60)) + '</div>'
      + '<div class="t3">' + esc(String((latest && latest.subject) || '').slice(0, 70)) + '</div>'
      + '</div><button class="x" title="关闭">✕</button>';
    el.onclick = (ev) => {
      if (ev.target && ev.target.classList && ev.target.classList.contains('x')) { mailHideToast(); return; }
      mailHideToast();
      /* 点提醒 → 打开面板并跳到邮箱页 ✓ */
      if (!document.getElementById('lifework-view')) openInPanel();
      TAB = 'mail';
      if (latest && latest.uid) { MAIL_UI.box = 'INBOX'; }
      render();
      loadMailAccounts(true);
      ensureMailLoad();
    };
    document.body.appendChild(el);
    /* 自动消失 ✓ —— 但鼠标停在上面就别收（正在看呢 ✗）*/
    const arm = () => { MAIL_TOAST_TIMER = setTimeout(() => { if (!el.matches(':hover')) mailHideToast(); else arm(); }, 12000); };
    arm();
  }

  /* 系统通知（桌面弹窗）✓ —— **只在用户已经授权过时用** ✗
     绝不自动弹权限申请 ✗（那很打扰）；想开的人在「账号配置」里点开关时才申请 ✓。 */
  function mailNotifySystem(delta, latest) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const n = new Notification('新邮件 · ' + delta + ' 封', {
        body: String((latest && latest.from) || '') + '\n' + String((latest && latest.subject) || ''),
        tag: 'codescope-mail',          /* 同 tag 会替换上一条，不会堆一屏 ✓ */
      });
      n.onclick = () => { try { window.focus(); } catch (_) { } mailHideToast(); };
      setTimeout(() => { try { n.close(); } catch (_) { } }, 15000);
    } catch (_) { }
  }

  /* 和上次比：变多了就是新邮件 ✓ */
  function mailCheckNew(next) {
    const total = Number(next && next.total) || 0;
    if (MAIL_SEEN_TOTAL === null) { MAIL_SEEN_TOTAL = total; return; }   /* ① 基线 */
    if (total <= MAIL_SEEN_TOTAL) { MAIL_SEEN_TOTAL = total; return; }
    const delta = total - MAIL_SEEN_TOTAL;
    MAIL_SEEN_TOTAL = total;
    /* 顶栏胶囊闪一下 ✓（无论开关是否打开 —— 那是状态不是打扰 ✓）*/
    const badge = document.getElementById('lw-mb');
    if (badge) {
      badge.classList.remove('fresh');
      void badge.offsetWidth;                  /* 强制重排，动画才会重播 ✓ */
      badge.classList.add('fresh');
      clearTimeout(MAIL_FRESH_TIMER);
      MAIL_FRESH_TIMER = setTimeout(() => badge.classList.remove('fresh'), 4000);
    }
    if (!mailNotifyEnabled()) return;
    const latest = (next.accounts || []).map((a) => a.latest).filter(Boolean)
      .sort((a, b) => (b.date || 0) - (a.date || 0))[0] || null;
    mailShowToast(delta, latest);
    mailNotifySystem(delta, latest);
  }

  /* 拉未读数（顶栏用）。静默失败 ✓ —— 网络抖一下不该弹错 ✓ */
  async function mailLoadStatus(force) {
    if (MAIL_STATUS_BUSY) return;
    if (!mailConfiguredKeys().length) return;
    MAIL_STATUS_BUSY = true;
    try {
      const r = await fetch('/api/life/mail/status' + (force ? '?force=1' : ''), { cache: 'no-store' });
      const d = await r.json();
      if (d && d.accounts) {
        MAIL_STATUS = d;
        paintMailBadge();
        mailCheckNew(d);
      }
    } catch (_) { } finally { MAIL_STATUS_BUSY = false; }
  }
  /* 面板打开时启动轮询 ✓（75 秒一次 —— 服务端 status 缓存是 60 秒，
     轮询间隔比它略长，每次都能拿到新数据 ✓，又不会把邮箱服务器打爆 ✓）*/
  function ensureMailStatusTimer() {
    if (MAIL_STATUS_TIMER) return;
    if (!mailConfiguredKeys().length) return;
    MAIL_STATUS_TIMER = setInterval(() => {
      if (document.visibilityState !== 'visible') return;      /* ② 后台不轮询 */
      if (!mailConfiguredKeys().length) return;
      mailLoadStatus(false);
    }, 75000);
    if (!MAIL_VIS_HOOK) {
      MAIL_VIS_HOOK = true;
      /* 切回前台立刻补查一次 ✓（后台那段时间可能来了新邮件 ✓）*/
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && mailConfiguredKeys().length) mailLoadStatus(false);
      });
    }
  }

  /* ── 开机自举：让「新邮件提醒」在**面板没打开**时也能工作 ✓ ──────────────
     否则用户不点开面板就永远收不到提醒 ✗（那就不是提醒了 ✗）。
     只拉一次 store（很小）拿到「账号 + 提醒开关」，然后启动轮询 ✓。
     ⚠️ 拿到的账号/开关只放进 `MAIL_BOOT`，**不放进 STORE** ✗（见它的注释）。 */
  async function bootstrapMailNotify() {
    if (MAIL_BOOTSTRAPPED) return;
    MAIL_BOOTSTRAPPED = true;
    try {
      const r = await fetch('/api/life/store', { cache: 'no-store' });
      const d = await r.json();
      const s = (d && d.data) || null;
      if (s) {
        if (!MAIL_BOOT.acc) MAIL_BOOT.acc = s.mailAcc || {};
        if (MAIL_BOOT.notify === undefined) MAIL_BOOT.notify = s.mailNotify;
      }
    } catch (_) { }
    if (!mailConfiguredKeys().length) return;
    if (!mailNotifyEnabled()) return;
    mailLoadStatus(false);
    ensureMailStatusTimer();
  }

  /* ── 账号是否具备收信条件 ──────────────────────────────────────────────── */
  function mailImapOf(key) {
    const a = ((STORE && STORE.mailAcc) || {})[key] || {};
    const g = mailGuess(a.user);
    return {
      user: String(a.user || '').trim(),
      host: a.imapHost || (g ? g.imapHost : ''),
      port: a.imapPort || (g ? g.imapPort : ''),
      hasPass: !!a.hasPass,
    };
  }

  /* ── IMAP 系统文件夹名 → 中文 ✓ ──────────────────────────────────────────
     IMAP 返回的是**服务商自己的名字** ✗ —— QQ 是英文（Sent Messages / Drafts /
     Deleted Messages / Junk），网易、阿里、Gmail 又各不相同 ✓。
     所以按**常见叫法**做匹配，认不出的**原样显示** ✓（别写死成只有 QQ 那四个 ✗）。
     原文保留在 `title` 里，鼠标悬停能看见 ✓。 */
  const MAIL_BOX_CN = [
    [/^(inbox)$/i, '收件箱'],
    [/^(sent|sent\s*messages|sent\s*items|sent\s*mail)$/i, '已发送'],
    [/^(drafts?)$/i, '草稿箱'],
    [/^(deleted\s*messages|deleted\s*items|trash|bin|废纸篓)$/i, '已删除'],
    [/^(junk|junk\s*e-?mail|spam|bulk\s*mail)$/i, '垃圾邮件'],
    [/^(ad\s*mails?|ads?)$/i, '广告邮件'],
    [/^(virus|virus\s*folder)$/i, '病毒文件夹'],
    [/^(archive|archives|all\s*mail)$/i, '归档'],
    [/^(notes?)$/i, '笔记'],
    [/^(outbox)$/i, '发件箱'],
  ];
  function mailBoxCN(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    /* ★★ 本来就是中文名的**原样保留** ✓ —— 中文→中文的「翻译」没有信息量 ✗，
       反而会制造**撞名** ✗：实测 2925 同时有「垃圾箱」和「已删除」两个文件夹，
       都被规范成「已删除」→ 左栏出现**两行同名** ✗，用户根本分不清点哪个 ✗
       （163 的「垃圾邮件 / 广告邮件」同理 ✓）。只翻译**外文**名字 ✓。 */
    if (/[\u3400-\u9fff]/.test(n)) return n;
    for (const [re, cn] of MAIL_BOX_CN) if (re.test(n)) return cn;
    return n;                                  /* 认不出 → 原样 ✓ */
  }
  /* 系统文件夹：**不给删** ✗（删了收件箱/已发送就麻烦了 ✗）。
     认不出的（用户自己建的分类 ✓）才允许删 ✓。

     ★★ 必须**同时认中英文** ✓ —— 上一版只列了英文名 ✗，
     而 163 返回的是「草稿箱 / 已发送 / 已删除 / 垃圾邮件 / 病毒文件夹 / 广告邮件」✗，
     2925 返回「垃圾箱 / 已发送 / 已删除 / 草稿箱」✗ → 界面上给系统文件夹也画了 ✕ ✗。
     所以这里**复用 MAIL_BOX_CN 的规范化结果** ✓：认出来 = 系统文件夹 ✓。
     中文名现在原样返回，所以这份名单要**把中文叫法也列全** ✓。
     （INBOX 单独判 —— 它可能大小写不一：QQ/163 是 INBOX、2925 是 Inbox ✗） */
  const MAIL_SYS_CN = new Set([
    '收件箱', '已发送', '已发送邮件', '已发送的邮件', '草稿箱', '草稿',
    '已删除', '已删除邮件', '垃圾箱', '废纸篓',
    '垃圾邮件', '不明邮件', '广告邮件', '病毒文件夹', '病毒邮件',
    '归档', '存档', '所有邮件', '笔记', '发件箱', '待发送',
  ]);
  function mailIsSysBox(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    if (/^inbox$/i.test(n)) return true;          /* 协议保留名 ✓ */
    return MAIL_SYS_CN.has(mailBoxCN(n));
  }

  /* ── 左栏：账号 + 文件夹 + 配置入口 ────────────────────────────────────── */
  function mailSideHtml() {
    const acc = (STORE && STORE.mailAcc) || {};
    const keys = Object.keys(MAIL_PRESET);
    const rows = keys.map((k) => {
      const a = acc[k] || {};
      const P = MAIL_PRESET[k];
      const imap = mailImapOf(k);
      const st = (MAIL_STATUS && (MAIL_STATUS.accounts || []).find((x) => x.key === k)) || null;
      const on = MAIL_UI.key === k;
      const label = imap.user || (P ? P.name : k);
      let right = '';
      if (!imap.user) right = '<span class="err">未配置</span>';
      else if (st && !st.ok) right = '<span class="err" title="' + esc(st.error) + '">收信失败</span>';
      else if (st && st.unseen) right = '<span class="cnt has">' + st.unseen + '</span>';
      else if (st) right = '<span class="cnt">' + st.messages + '</span>';
      else right = '<span class="cnt">·</span>';
      return '<div class="lw-ml-acct' + (on ? ' on' : '') + '" data-mkey="' + esc(k) + '" title="' + esc(imap.user || '未配置') + '">'
        + '<span class="em">' + esc(label) + '</span>' + right + '</div>';
    }).join('');

    /* 文件夹：只在选中账号、且已经拉到列表时显示 ✓ */
    let boxesHtml = '';
    if (MAIL_UI.key) {
      if (MAIL_UI.boxesLoading) boxesHtml = '<div class="lw-ml-box">正在读取文件夹…</div>';
      else if (MAIL_UI.boxesErr) boxesHtml = '<div class="lw-ml-box" style="color:' + T.red + '">' + esc(MAIL_UI.boxesErr) + '</div>';
      else if (MAIL_UI.boxes) {
        const inbox = MAIL_UI.boxes.inbox || {};
        /* ★ 文件夹名中文化 ✓（原文放 title，认不出的原样显示 ✓）*/
        /* ⚠️ 排除收件箱要**不分大小写** ✗ —— QQ/163 是 `INBOX`，2925 是 `Inbox` ✗，
           只比 `!== 'INBOX'` 会让 2925 的收件箱**出现两次** ✗。 */
        const list = [{ name: 'INBOX', label: '收件箱', raw: 'INBOX', n: inbox.unseen }].concat(
          MAIL_UI.boxes.boxes.filter((b) => b.selectable && !/^inbox$/i.test(b.name))
            .map((b) => ({ name: b.name, label: mailBoxCN(b.name), raw: b.name, n: 0 })));
        /* ★★ 中文化后**撞名要消歧** ✗ —— 实测 2925 同时有「垃圾箱」和「已删除」两个文件夹，
           都规范成「已删除」→ 左栏出现**两行同名** ✗，用户根本分不清点哪个 ✗
           （163 的「垃圾邮件 / 广告邮件」同理 ✓）。
           规范名相同的，第二个起把**原文**缀上 ✓。 */
        const used = new Set();
        boxesHtml = list.map((b) => {
          let label = b.label;
          if (used.has(label)) label = b.label + '（' + b.raw + '）';
          used.add(b.label);
          const rawTitle = label === b.raw ? b.raw : (label + '（' + b.raw + '）');
          /* ★ 分类管理：系统文件夹不能删 ✗（收件箱/已发送/草稿/已删除/垃圾邮件/广告邮件/病毒文件夹/发件箱/归档 ✓），
             其它的悬停时给一个 ✕ ✓。拖动邮件时这些行是**放置目标** ✓。 */
          const del = mailIsSysBox(b.name) ? '' : '<span class="del" data-mboxdel="' + esc(b.name) + '" title="删除这个文件夹（只能删空的）">✕</span>';
          return '<div class="lw-ml-box' + (MAIL_UI.box === b.name ? ' on' : '') + '" data-mbox="' + esc(b.name) + '"'
            + ' title="' + esc(rawTitle + '　（可把邮件拖到这里）') + '">'
            + '<span class="nm">' + esc(label) + '</span>'
            + (b.n ? '<span class="n" style="color:' + T.accent + '">' + b.n + '</span>' : '')
            + del + '</div>';
        }).join('');
        /* ＋ 新建分类 ✓ */
        boxesHtml += '<div class="lw-ml-box add" id="lw-ml-newbox"><span>＋ 新建文件夹</span></div>';
      }
    }

    return '<div class="lw-ml-hd">账号</div>' + rows
      + (boxesHtml ? '<div class="lw-ml-hd">文件夹</div>' + boxesHtml : '')
      + '<div class="lw-ml-hd">设置</div>'
      + '<div class="lw-ml-box' + (MAIL_UI.cfgOpen ? ' on' : '') + '" data-mcfg="1"><span>⚙ 账号配置</span></div>'
      + (MAIL_UI.key ? '<div class="lw-ml-box" id="lw-ml-readall"><span>✓ 本箱全部标为已读</span></div>' : '')
      + '<div class="lw-ml-box" data-mrefresh="1"><span>↻ 重新收信</span></div>';
  }

  /* ── 中栏：邮件列表 ────────────────────────────────────────────────────── */
  function mailListHtml() {
    if (!MAIL_UI.key) return '<div class="lw-ml-empty">← 先在左边选一个邮箱账号<br><span style="color:' + T.faint + '">没有账号？点「⚙ 账号配置」添加</span></div>';
    const imap = mailImapOf(MAIL_UI.key);
    if (!imap.user) return '<div class="lw-ml-empty">这个账号还没填邮箱地址<br>点「⚙ 账号配置」补上</div>';
    if (!imap.host) return '<div class="lw-ml-empty">没识别出 IMAP 服务器<br>点「⚙ 账号配置」手填</div>';
    if (!imap.hasPass) return '<div class="lw-ml-empty">这个账号还没存授权码 / 密码<br>点「⚙ 账号配置」补上（收信必须要）</div>';

    const tools = '<div class="lw-ml-tools">'
      + '<input id="lw-ml-q" placeholder="筛选发件人 / 主题…" value="' + esc(MAIL_UI.q) + '"/>'
      + '<button id="lw-ml-unread" class="' + (MAIL_UI.unreadOnly ? 'on' : '') + '" title="只看未读">未读</button>'
      + '<button id="lw-ml-star" class="' + (MAIL_UI.importantOnly ? 'on' : '') + '" title="只看重要（⭐）">⭐</button>'
      + '<button id="lw-ml-reload" title="重新收信">↻</button></div>';

    if (MAIL_UI.listLoading) return tools + '<div class="lw-ml-empty">正在收信…</div>';
    if (MAIL_UI.listErr) return tools + '<div class="lw-ml-empty" style="color:' + T.red + '">✗ ' + esc(MAIL_UI.listErr) + '</div>';
    if (!MAIL_UI.list || !MAIL_UI.list.length) {
      return tools + '<div class="lw-ml-empty">' + (MAIL_UI.unreadOnly ? '没有未读邮件 ✓' : (MAIL_UI.importantOnly ? '没有标为重要的邮件<br><span style="color:' + T.faint + '">在阅读区点「☆ 重要」标记</span>' : '这个文件夹是空的')) + '</div>';
    }
    const q = String(MAIL_UI.q || '').trim().toLowerCase();
    const items = MAIL_UI.list.map((m) => {
      const hay = (m.fromName + ' ' + m.fromAddress + ' ' + m.subject).toLowerCase();
      const hit = !q || hay.indexOf(q) >= 0;
      return '<div class="lw-ml-item' + (m.seen ? '' : ' unread') + (MAIL_UI.uid === m.uid ? ' on' : '') + '"'
        + ' data-muid="' + m.uid + '" data-hay="' + esc(hay) + '"' + (hit ? '' : ' style="display:none"') + '>'
        + '<div class="r1">' + (m.flagged ? '<span class="star" title="重要">★</span>' : '')
        + '<span class="who">' + esc(String(m.fromName || m.fromAddress || '(未知发件人)').slice(0, 40)) + '</span>'
        + '<span class="when">' + esc(mailWhen(m.date)) + '</span></div>'
        + '<div class="subj">' + esc(m.subject) + '</div></div>';
    }).join('');
    /* ★ 分批加载 ✓ —— 一次取 40 封头部在 QQ 上要 0.4~2.1 秒 ✗
       （瓶颈是服务端**每封**的处理成本：INBOX ~10ms/封，Sent ~53ms/封 ✗），
       所以先取 15 封（~0.13/0.8 秒 ✓），要更多再点 ✓。 */
    const more = (MAIL_UI.list.length >= MAIL_UI.limit && MAIL_UI.limit < 120)
      ? '<div class="lw-ml-more" id="lw-ml-more">加载更多（已显示 ' + MAIL_UI.list.length + ' 封）</div>'
      : '';
    return tools + items + more;
  }

  /* ── 对照翻译 ────────────────────────────────────────────────────────────
     走**已有的 AI 入口** ✓（和「逻辑图 · AI 解读」「PDF 翻译」同一个 `/api/ai/chat`），
     配置也复用同一份（`localStorage['mc-ai-cfg']`，即「本机管家 → AI」里填的那个）✓
     —— 不另起一套配置，用户不用配两遍 ✓。
     做法：把正文切成段落 → 分批送模型 → 按**编号**对齐回原文 → 左右对照渲染 ✓。
     ★ 三件事必须有：① 缓存（同一封不重复请求）② 防重入 ③ 失败兜底提示 ✓。 */
  function mailAiCfg() {
    /* 直接读 localStorage ✓ —— 不依赖 index.html 里 `let AI_CFG` 的作用域
       （它虽然在全局词法作用域里能读到，但换写法就会断 ✗，读存储最稳 ✓） */
    try {
      const raw = localStorage.getItem('mc-ai-cfg');
      if (raw) { const c = JSON.parse(raw); if (c && c.url && c.model) return c; }
    } catch (_) { }
    try { if (typeof AI_CFG !== 'undefined' && AI_CFG && AI_CFG.url && AI_CFG.model) return AI_CFG; } catch (_) { }
    return null;
  }

  /* 段落太长就**按句子再切** ✓ ——
     营销邮件常把整封信塞进一个大 `<td>`，剥完标签就是一段 800+ 字 ✗：
     挤在一个对照格里没法看 ✗，而且模型对**小段落**的翻译质量明显更好 ✓。
     断点取中英文句末标点（。！？!?.;；）✓，单段上限 260 字 ✓。 */
  const MAIL_PARA_MAX = 260;
  function mailSplitLong(text) {
    const p = String(text || '');
    if (p.length <= MAIL_PARA_MAX) return p ? [p] : [];
    const out = [];
    let buf = '';
    for (const piece of p.split(/(?<=[。！？!?.;；])\s*/)) {
      if (buf && (buf + piece).length > MAIL_PARA_MAX) { out.push(buf.trim()); buf = piece; }
      else buf += piece;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  /* 纯文本部分**能不能用** ✗ ——
     ★★ 很多营销邮件的 `text/plain` 是**用空格排版的**（一行几百个空格做居中/对齐 ✗），
     实测一封 987 字的纯文本里有 **623 个空格（63%）** ✗：
     拿它切段会把整封信粘成**一大坨** ✗，用户看到的「原文排序是乱的」就是这个 ✗✗。
     而同一封的 HTML 分支能切出 8 段干净的结果 ✓。
     判据：① 有实质内容（非空白 > 40 字）✓ ② 空格占比 ≤ 25%（否则说明是「空格排版」✗）✓ */
  function mailTextUsable(text) {
    const s = String(text || '');
    if (s.replace(/\s/g, '').length <= 40) return false;
    const spaces = (s.match(/[ \t\u00a0]/g) || []).length;
    return spaces / s.length <= 0.25;
  }

  /* 把邮件正文切成段落 ✓ —— 纯文本优先（但必须是**能用的**纯文本 ✗）；否则剥 HTML ✓ */
  function mailParagraphs(msg) {
    const text = String((msg && msg.text) || '');
    if (mailTextUsable(text)) {
      return text.split(/\n{2,}/).map((s) => s.trim()).filter((s) => s.length > 1).flatMap(mailSplitLong);
    }
    let h = String((msg && msg.html) || '');
    h = h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
    /* ★ 表格：**单元格用 ` | ` 连成一行、行之间才断段** ✓ ——
       ⚠️ 以前把 `</td>` 也当段落分隔 ✗ → 一封期刊列表邮件被切出 **44 个碎片** ✗
       （「期刊名字」「最新IF」「数量」「链接」各占一段 ✗，完全没法读也没法对照 ✗）。
       现在同一行的单元格并成一行 ✓：「ROBOTICA | 2.900 | 2条 | 查看」✓。 */
    h = h.replace(/<\/t[dh]>/gi, ' | ');
    h = h.replace(/<\/tr>/gi, '\n\n');
    /* 其余块级标签：正常断段 ✓（`</td>`/`</tr>` 已经在上面处理过，这里不再列 ✓）*/
    h = h.replace(/<\/(p|div|li|h[1-6]|table|tbody|blockquote|section|article|header|footer|dd|dt|pre|figcaption|center)>/gi, '\n\n');
    /* ★ `<br>` 要当**段落分隔** ✗ —— 邮件里 `Dear Valued User:` / `Thank you for…` /
       `Your subscription is valid for 1 Month.` 这些是**用 `<br>` 分行**的 ✓，
       以前只当普通换行、后面又被「行内换行折成空格」合并掉 ✗ →
       整段 229 字挤成一个翻译单元 ✗（实测）。改成断段后：6 段 → **9 段、最长 109 字** ✓，
       其它邮件只是 0~1 段的差别（不会切碎 ✗）。 */
    h = h.replace(/<br\s*\/?>/gi, '\n\n');
    h = h.replace(/<[^>]+>/g, '');
    /* ★ 实体要**解全** ✗ —— 以前只解了 `&nbsp;` 这几个具名的 ✗，
       而很多邮件用的是**数字实体**（`&#19987;` = 「专」✗）→ 原文里留着一堆 `&#xxxx;` ✗，
       喂给模型的就是乱码 ✗（实测：一封邮件里全是 `&#19987;&#19994;` ✗）。 */
    h = h.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch (_) { return m; } });
    h = h.replace(/&#(\d+);/g, (m, dec) => { try { return String.fromCodePoint(Number(dec)); } catch (_) { return m; } });
    h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
    return h.split(/\n{2,}/).map((s) => s.replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim())
      .map((s) => s.replace(/(\s*\|\s*)+$/, '').trim())          /* 去掉行尾多出来的 ` | ` ✓ */
      .filter((s) => s.length > 1).flatMap(mailSplitLong);
  }

  async function mailTranslate() {
    const m = MAIL_UI.msg;
    if (!m) return;
    const s = document.getElementById('lw-sub');
    if (MAIL_UI.trBusy) return;
    /* 已经译过这一封 → 只是切换显示 ✓（缓存，不重复请求 ✓）*/
    if (MAIL_UI.tr && MAIL_UI.tr.uid === m.uid && MAIL_UI.tr.pairs.length) return;
    const cfg = mailAiCfg();
    if (!cfg) {
      if (s) s.textContent = '✗ 还没配置 AI —— 在「本机管家 → AI」里填 API URL 与模型';
      MAIL_UI.tr = { uid: m.uid, pairs: [], err: '还没配置 AI（本机管家 → AI）', done: 0, total: 0 };
      renderMailPane('read');
      return;
    }
    const paras = mailParagraphs(m);
    if (!paras.length) {
      MAIL_UI.tr = { uid: m.uid, pairs: [], err: '这封邮件没有可翻译的正文', done: 0, total: 0 };
      renderMailPane('read');
      return;
    }
    const use = paras.slice(0, 80);                 /* 上限，别把整封巨型营销邮件全丢给模型 ✓ */
    MAIL_UI.trBusy = true;
    MAIL_UI.tr = { uid: m.uid, pairs: use.map((p) => ({ src: p, dst: '' })), done: 0, total: use.length, err: '' };
    renderMailPane('read');
    try {
      const CHUNK = 10;
      for (let i = 0; i < use.length; i += CHUNK) {
        const part = use.slice(i, i + CHUNK);
        const numbered = part.map((p, j) => '[' + (j + 1) + '] ' + p).join('\n\n');
        const r = await fetch('/api/ai/chat', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: cfg.url, key: cfg.key, model: cfg.model, timeoutMs: 180000,
            messages: [
              { role: 'system', content: '你是专业邮件翻译。把用户给的每一段翻译成简体中文。必须保留段落编号，输出格式为每行 `[序号]译文`，序号与输入完全一致。只输出译文，不要解释、不要合并段落、不要加标题或前言。' },
              { role: 'user', content: numbered },
            ],
          }),
        });
        const d = await r.json();
        if (!d || !d.ok) throw new Error((d && d.error) || 'AI 请求失败');
        const body = String(d.content || '');
        /* ① 优先按 `[n]` 编号对齐 ✓ */
        const got = {};
        body.split('\n').forEach((line) => {
          const mm = /^\s*\[(\d+)\]\s*(.*)$/.exec(line);
          if (mm) got[Number(mm[1])] = mm[2].trim();
        });
        /* ② 模型没守编号时退而求其次：按空行分段、顺序对齐 ✓（总比整块空白强 ✓）*/
        if (!Object.keys(got).length) {
          body.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).forEach((x, j) => { got[j + 1] = x; });
        }
        part.forEach((p, j) => { const dst = got[j + 1]; if (dst) MAIL_UI.tr.pairs[i + j].dst = dst; });
        MAIL_UI.tr.done = Math.min(use.length, i + CHUNK);
        renderMailPane('read');
      }
    } catch (e) {
      MAIL_UI.tr.err = e.message;
    } finally {
      MAIL_UI.trBusy = false;
      renderMailPane('read');
      if (s) s.textContent = MAIL_UI.tr && MAIL_UI.tr.err ? ('✗ 翻译失败：' + MAIL_UI.tr.err) : '✓ 对照翻译完成';
    }
  }

  /* ── 右栏：正文阅读 ────────────────────────────────────────────────────── */
  function mailReaderHtml() {
    if (MAIL_UI.msgLoading) return '<div class="lw-ml-empty">正在收取正文…</div>';
    if (MAIL_UI.msgErr) return '<div class="lw-ml-empty" style="color:' + T.red + '">✗ ' + esc(MAIL_UI.msgErr) + '</div>';
    const m = MAIL_UI.msg;
    if (!m) return '<div class="lw-ml-empty">← 从中间选一封邮件</div>';

    const hasHtml = !!String(m.html || '').trim();
    const atts = (m.attachments || []).length
      ? '<div class="lw-ml-atts">' + m.attachments.map((a) => '<div class="lw-ml-att">'
          + '<span>📎</span><span class="nm" title="' + esc(a.name) + '">' + esc(a.name) + '</span>'
          + '<span class="sz">' + esc(mailSize(a.size)) + '</span>'
          + '<a class="lw-btn" style="height:24px;padding:0 9px;text-decoration:none;line-height:20px;font-size:9.5px"'
          + ' href="/api/life/mail/part?key=' + encodeURIComponent(MAIL_UI.key) + '&box=' + encodeURIComponent(MAIL_UI.box)
          + '&uid=' + m.uid + '&n=' + a.n + '">下载</a></div>').join('') + '</div>'
      : '';

    const tr = (MAIL_UI.tr && MAIL_UI.tr.uid === m.uid) ? MAIL_UI.tr : null;
    const head = '<div class="lw-ml-rhd">'
      + '<div class="subj">' + (m.flagged ? '<span style="color:' + T.accent + '">★ </span>' : '') + esc(m.subject) + '</div>'
      + '<div class="meta">'
      + '<div><b>' + esc(String(m.from || '').slice(0, 80)) + '</b></div>'
      + '<div>' + esc(mailFullTime(m.date)) + ' · ' + esc(mailSize(m.size))
      + (m.to ? ' · 收件人 ' + esc(String(m.to).slice(0, 60)) : '') + '</div>'
      + '</div>'
      + '<div class="acts">'
      + '<button class="lw-btn" data-mact="' + (m.flagged ? 'unflag' : 'flag') + '" data-muid="' + m.uid + '"'
      + ' title="重要（IMAP \\Flagged，其它邮件客户端也能看到）">' + (m.flagged ? '★ 已标重要' : '☆ 标为重要') + '</button>'
      /* ★ 分类管理：把邮件移到别的文件夹 ✓（也可以直接把列表里的邮件拖到左栏文件夹 ✓）*/
      + '<button class="lw-btn" id="lw-ml-move" data-muid="' + m.uid + '" title="移到别的文件夹（也可以直接把左边列表里的邮件拖到文件夹上）">📁 移到…</button>'
      + '<button class="lw-btn' + (tr ? ' on' : '') + '" id="lw-ml-tr">'
      + (MAIL_UI.trBusy ? '翻译中…' : (tr ? '⇄ 对照中' : '⇄ 对照翻译')) + '</button>'
      + '<button class="lw-btn" data-mact="' + (m.seen ? 'unread' : 'read') + '" data-muid="' + m.uid + '">'
      + (m.seen ? '标为未读' : '标为已读') + '</button>'
      + (hasHtml ? '<button class="lw-btn" data-mimg="' + (MAIL_UI.showImages ? '0' : '1') + '">'
          + (MAIL_UI.showImages ? '🚫 隐藏图片' : '🖼 显示图片') + '</button>' : '')
      + '<button class="lw-btn" data-mact="delete" data-muid="' + m.uid + '">删除</button>'
      + '</div></div>';

    let bodyHtml;
    if (tr && tr.pairs.length) {
      /* ── 对照视图 ✓ ────────────────────────────────────────────────────
         ★★ 左边**保持邮件原本的样子** ✗ —— 用户原话：「应该保持原本邮箱的样子」。
         以前左边是把正文剥成纯文本再逐段列出来 ✗，等于把邮件**重新排版**了一遍：
         标题、表格、加粗全没了，行与行还会被粘在一起 ✗（用户说的「原文排序是乱的」✗）。
         现在左边直接**原样渲染整封邮件**（还是那个 sandbox iframe ✓），
         右边列出译文 ✓ —— 原文一个像素都不动，对照也依然成立 ✓。 */
      const srcPane = hasHtml
        ? '<iframe class="lw-ml-frame" sandbox="" referrerpolicy="no-referrer" srcdoc="' + esc(mailFrameDoc(m, MAIL_UI.showImages)) + '"></iframe>'
        : '<div class="lw-ml-body">' + (String(m.text || '').trim() ? mailTextHtml(m.text) : '<span style="color:' + T.faint + '">这封邮件没有可显示的正文</span>') + '</div>';
      const dstList = tr.pairs.map((p) => '<div class="p">' + (p.dst ? esc(p.dst) : '<span class="pending">…</span>') + '</div>').join('');
      const bar = '<div class="lw-ml-trbar">'
        + '<span>左：原文原样　·　右：译文</span>'
        + '<span class="sp"></span>'
        + (tr.err ? '<span style="color:' + T.red + '">✗ ' + esc(tr.err) + '</span>' : '')
        + (MAIL_UI.trBusy ? '<span>翻译中 ' + tr.done + '/' + tr.total + '</span>' : '<span>' + tr.total + ' 段</span>')
        + '</div>';
      bodyHtml = bar + '<div class="lw-ml-tr">'
        + '<div class="pane origin">' + srcPane + '</div>'
        + '<div class="pane trans">' + dstList + '</div>'
        + '</div>';
    } else if (hasHtml) {
      /* ★ 邮件 HTML 走 sandbox iframe ✓（详见 mailFrameDoc 的注释）*/
      bodyHtml = '<iframe class="lw-ml-frame" sandbox="" referrerpolicy="no-referrer"'
        + ' srcdoc="' + esc(mailFrameDoc(m, MAIL_UI.showImages)) + '"></iframe>';
    } else {
      const t = String(m.text || '');
      bodyHtml = '<div class="lw-ml-body">'
        + (t.trim() ? mailTextHtml(t) : '<span style="color:' + T.faint + '">这封邮件没有可显示的正文（可能只有 HTML 版被服务端过滤了）</span>')
        + '</div>';
    }
    return head + bodyHtml + atts;
  }

  /* ── 组装整个邮箱页 ──────────────────────────────────────────────────────
     ★ 三栏都能**左右拖动调宽** ✓（用户报「怎么没有左右自由拖动功能」✗）——
     和备忘录那套完全一致：同一份 grip 样式 ✓、宽度存 STORE ✓、双击恢复默认 ✓。 */
  /* ══════════════════════════════════════════════════════════════════════
     阅读模块（个人阅读管理）✓
     ══════════════════════════════════════════════════════════════════════
     数据全在 STORE 里 ✓（服务端存本地 JSON ✓，不联网 ✓）：
       STORE.books     = [{ id, title, author, cover, src, status, prog, rating, tags, pages, startAt, doneAt, at, edit }]
       STORE.bookNotes = [{ id, bookId, kind: 'quote' | 'idea', text, loc, at }]
       STORE.readLog   = [{ id, date: 'YYYY-MM-DD', bookId, min, pages, at }]

     ★ 关于「接入微信读书」✓：微信读书**没有对外的公开 API** ✗。
       实测过（这台机器上）：
         ✗ `weread.qq.com/web/login/getuid` → **404** ✗ —— 老的「扫码登录」接口已经没了 ✗，
            所以**做不了**「点一下扫码就登录」✗（试过，别再来试 ✗）。
         ✓ `weread.qq.com/web/shelf/sync` 和 `i.weread.qq.com/shelf/sync` **都通** ✓，
            不带 Cookie 时明确回 `{"errCode":-2010,"errMsg":"用户不存在"}` ✓
            —— 说明**接口是活的 ✓，只差一个登录身份** ✓。
       结论：**唯一可行的路是借用用户浏览器里的 Cookie** ✓。

       所以这里做的是**两条都能用**的路 ✓：
         ① 「📥 导入笔记」—— 把微信读书 App 里「导出笔记」的文本粘进来 ✓
            （这条路**一定可用** ✓，而且导入的是用户自己真正划过的东西 ✓）
         ② 「🔗 微信读书」—— 服务端的**非官方接口代理** ✓，
            用一个**正经的连接面板**（不是 prompt ✗）引导用户把 Cookie 粘进来 ✓，
            **明确标注「非官方、可能随时失效」** ✓，
            失败时给**能照着修**的提示 ✓（少了 wr_vid？粘错了行？✗），
            绝不假装成功 ✗。
     ══════════════════════════════════════════════════════════════════════ */

  const bookById = (id) => ((STORE && STORE.books) || []).find((b) => b && b.id === id) || null;
  /* ★ 当前选中的书 ✗ —— RD_UI.sel 只在内存里 ✓，刷新就没了 ✗，
     所以要以 STORE.bookSel（落过盘的 ✓）兜底 ✓。
     实测踩过：只读 RD_UI.sel 的话，刷新后面板右栏永远是「← 从中间选一本书」✗。 */
  const rdSel = () => RD_UI.sel || (STORE && STORE.bookSel) || '';
  const rdCurrent = () => bookById(rdSel());
  const bookNotesOf = (id) => ((STORE && STORE.bookNotes) || []).filter((n) => n && n.bookId === id);
  const rdTagList = () => {
    const m = new Map();
    ((STORE && STORE.books) || []).forEach((b) => (b.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  function rdBooks() {
    const q = String(RD_UI.q || '').trim().toLowerCase();
    return ((STORE && STORE.books) || []).filter((b) => {
      if (!b) return false;
      if (RD_UI.status !== 'all' && b.status !== RD_UI.status) return false;
      if (RD_UI.src !== 'all' && b.src !== RD_UI.src) return false;
      if (RD_UI.tag && !(b.tags || []).includes(RD_UI.tag)) return false;
      if (q && (String(b.title || '') + ' ' + String(b.author || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort((a, b) => {
      /* 在读优先 ✓ → 再看最近动过的 ✓ */
      const ra = a.status === 'reading' ? 0 : 1, rb = b.status === 'reading' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (b.edit || b.at || 0) - (a.edit || a.at || 0);
    });
  }
  /* 阅读统计 ✓ */
  function rdStats() {
    const books = ((STORE && STORE.books) || []).filter(Boolean);
    const notes = ((STORE && STORE.bookNotes) || []).filter(Boolean);
    const log = ((STORE && STORE.readLog) || []).filter(Boolean);
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const dd = new Date(); dd.setDate(dd.getDate() - i);
      const k = dayKey(dd);
      const min = log.filter((x) => x.date === k).reduce((a, x) => a + (Number(x.min) || 0), 0);
      days.push({ date: k, min, label: (dd.getMonth() + 1) + '/' + dd.getDate() });
    }
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const dd = new Date(); dd.setDate(dd.getDate() - i);
      if (log.some((x) => x.date === dayKey(dd))) streak++;
      else if (i > 0) break;
    }
    return {
      reading: books.filter((b) => b.status === 'reading').length,
      done: books.filter((b) => b.status === 'done').length,
      total: books.length,
      notes: notes.length,
      streak,
      days,
      maxMin: Math.max(1, ...days.map((d) => d.min)),
      todayMin: days.length ? days[days.length - 1].min : 0,
    };
  }
  /* 进度条（可点）✓ */
  function rdBar(pct, cls) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    return '<div class="' + (cls || 'lw-bar') + '"><i style="width:' + p + '%"></i></div>';
  }
  function rdStars(rating) {
    const r = Math.round(Number(rating) || 0);
    return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r);
  }
  /* ── 微信读书笔记解析 ✓ ──────────────────────────────────────────────────
     宽容解析 ✗：不假设只有一种导出格式 ✓。能认出来的都认 ✓：
       · 《书名》 或 单独一行 + 下一行是「作者：」→ 新书 ✓
       · 「作者：X」→ 作者 ✓
       · 单独一行「划线 / 原文 / 摘录」→ 下一条是**划线** ✓
       · 单独一行「想法 / 笔记 / 点评」→ 下一条是**想法** ✓
       · 日期行（2024-01-01 / 2024年1月1日 …）→ 只当分隔，不当内容 ✓
       · Markdown 风：# 书名 / > 划线 / - 想法 ✓
       · 其它非空行 → 按当前类型收（默认划线 ✓）
     ⚠️ 导入前**一定先给预览** ✓ —— 解析结果摆出来让用户确认 ✓，
        不搞「一键导入然后发现全乱了」✗。 */
  function parseWeread(raw) {
    const lines = String(raw || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
    const books = [];
    let cur = null, mode = '', chap = '';
    const DATE = /^\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;
    const MARK = /^(划线|原文|摘录|引用|quote)$/i;
    const IDEA = /^(想法|笔记|点评|感想|idea)$/i;
    /* ★ 章节标题要**认出来** ✗ —— 微信读书导出的笔记里章节名是单独一行 ✓，
       不认的话会被当成一条「划线」✗（实测：3 条笔记被解析成 4 条 ✗）。
       只在**明确的章节写法**上认 ✓，不靠「短行」猜 ✗（短行也可能真是条划线 ✗）。 */
    const CHAP = /^(第[一二三四五六七八九十百零两\d]+[章节卷篇部讲回]|序言?|自序|前言|后记|尾声|附录|导读|楔子|引言|结语)/;
    const mk = (title, author) => { const b = { title: String(title || '').trim(), author: String(author || '').trim(), notes: [] }; books.push(b); return b; };
    for (const l of lines) {
      if (!l) { mode = ''; continue; }
      if (/^[-=—]{3,}$/.test(l)) { mode = ''; continue; }
      let m = /^#\s+(.+)$/.exec(l);
      if (m) {
        const t = m[1].split(/[—–\-|]/);
        cur = mk(t[0], t[1]);
        mode = '';
        continue;
      }
      m = /^《(.+)》$/.exec(l);
      if (!m && !cur && !/^作者[：:]/.test(l) && l.length <= 60) {
        /* 第一行通常是书名 ✓（后面跟着「作者：」更确定 ✓）*/
        m = [null, l];
      }
      if (m) { cur = mk(m[1]); mode = ''; chap = ''; continue; }
      m = /^作者[：:]\s*(.+)$/.exec(l);
      if (m) { if (!cur) cur = mk('未命名书籍'); cur.author = m[1].trim(); continue; }
      if (MARK.test(l)) { mode = 'quote'; continue; }
      if (IDEA.test(l)) { mode = 'idea'; continue; }
      if (DATE.test(l)) { mode = ''; continue; }
      if (CHAP.test(l) && l.length <= 40) { chap = l; mode = ''; continue; }
      m = /^>\s*(.+)$/.exec(l);
      if (m) { if (!cur) cur = mk('未命名书籍'); cur.notes.push({ kind: 'quote', text: m[1].trim(), loc: chap }); continue; }
      m = /^[-*+]\s+(.+)$/.exec(l);
      if (m) { if (!cur) cur = mk('未命名书籍'); cur.notes.push({ kind: 'idea', text: m[1].trim(), loc: chap }); continue; }
      if (!cur) cur = mk('未命名书籍');
      cur.notes.push({ kind: mode || 'quote', text: l, loc: chap });
      mode = '';
    }
    return books.filter((b) => b.title && b.notes.length);
  }
  /* ── 阅读：视图 ────────────────────────────────────────────────────────── */
  function rdSideHtml() {
    const st = rdStats();
    const tags = rdTagList();
    const cnt = (fn) => ((STORE && STORE.books) || []).filter(fn).length;
    const stRows = RD_ST_ORDER.map((k) => '<div class="lw-rd-row' + (RD_UI.status === k ? ' on' : '') + '" data-rdst="' + k + '">'
      + '<span class="em">' + RD_ST[k].e + '</span>' + RD_ST[k].n + '<span class="n">' + cnt((b) => b && b.status === k) + '</span></div>').join('');
    const srcRows = Object.keys(RD_SRC).map((k) => '<div class="lw-rd-row' + (RD_UI.src === k ? ' on' : '') + '" data-rdsrc="' + k + '">'
      + '<span class="em">' + RD_SRC[k].e + '</span>' + RD_SRC[k].n + '<span class="n">' + cnt((b) => b && b.src === k) + '</span></div>').join('');
    return '<div class="lw-rd-hd">阅读统计</div>'
      + '<div class="lw-rd-stat">'
      + '<div><b>' + st.reading + '</b><span>在读</span></div>'
      + '<div><b>' + st.done + '</b><span>读完</span></div>'
      + '<div><b>' + st.notes + '</b><span>条笔记</span></div>'
      + '<div><b>' + st.streak + '</b><span>连续天数</span></div>'
      + '</div>'
      + '<div class="lw-rd-hd">状态</div>'
      + '<div class="lw-rd-row' + (RD_UI.status === 'all' ? ' on' : '') + '" data-rdst="all"><span class="em">▣</span>全部<span class="n">' + st.total + '</span></div>'
      + stRows
      + '<div class="lw-rd-hd">来源</div>'
      + '<div class="lw-rd-row' + (RD_UI.src === 'all' ? ' on' : '') + '" data-rdsrc="all"><span class="em">▣</span>全部</div>'
      + srcRows
      + (tags.length ? '<div class="lw-rd-hd">标签</div>'
        + '<div class="lw-rd-row' + (RD_UI.tag === '' ? ' on' : '') + '" data-rdtag=""><span class="em">#</span>全部</div>'
        + tags.map(([t, n]) => '<div class="lw-rd-row' + (RD_UI.tag === t ? ' on' : '') + '" data-rdtag="' + esc(t) + '"><span class="em">#</span>' + esc(t) + '<span class="n">' + n + '</span></div>').join('') : '');
  }
  const rdSideInnerHtml = rdSideHtml;
  function rdBookCard(b) {
    const st = RD_ST[b.status] || RD_ST.want;
    const src = RD_SRC[b.src] || RD_SRC.other;
    const n = bookNotesOf(b.id).length;
    const cover = b.cover
      ? '<div class="cv"><img src="' + esc(b.cover) + '" alt="" onerror="this.style.display=\'none\'"/></div>'
      : '<div class="cv">' + src.e + '</div>';
    return '<div class="lw-bk' + (rdSel() === b.id ? ' on' : '') + '" data-rdbk="' + esc(b.id) + '">'
      + cover
      + '<div class="mn"><div class="ti">' + esc(b.title || '未命名') + '</div>'
      + '<div class="au">' + esc(b.author || '—') + '</div>'
      + '<div class="mt">' + rdBar(b.prog, 'lw-bar') + '<span>' + (Number(b.prog) || 0) + '%</span></div>'
      + '<div class="mt"><span class="tag">' + st.e + ' ' + st.n + '</span>'
      + (b.rating ? '<span>' + rdStars(b.rating) + '</span>' : '')
      + (n ? '<span>' + n + ' 条笔记</span>' : '')
      + '<span>' + src.n + '</span></div>'
      + '</div></div>';
  }
  function rdListHtml() {
    const list = rdBooks();
    const tools = '<div class="lw-rd-tools">'
      + '<input id="lw-rd-q" placeholder="搜索书名 / 作者…" value="' + esc(RD_UI.q) + '"/>'
      + '<button id="lw-rd-add" title="手动添加一本书">＋ 加书</button>'
      + '<button id="lw-rd-imp" title="把微信读书 App 导出的笔记粘进来">📥 导入笔记</button>'
      + '<button id="lw-rd-sync" title="' + (rdWrOn() ? '同步微信读书书架（已连接，点一下直接拉）' : '连接微信读书，把你的书架读进来') + '">'
      + (rdWrOn() ? '📗 同步' : '🔗 微信读书') + '</button>'
      + '</div>';
    if (!list.length) {
      const empty = ((STORE && STORE.books) || []).length ? '没有符合条件的书' : '书架还是空的<br><span style="color:' + T.faint + '">点「＋ 加书」或「📥 导入笔记」开始</span>';
      return tools + '<div class="lw-rd-empty">' + empty + '</div>';
    }
    return tools + list.map(rdBookCard).join('');
  }
  function rdNoteHtml(n) {
    const isIdea = n.kind === 'idea';
    return '<div class="lw-note k-' + (isIdea ? 'idea' : 'quote') + '">'
      + '<div class="tx">' + esc(n.text) + '</div>'
      + '<div class="ft"><span>' + (isIdea ? '💭 想法' : '✏️ 划线') + '</span>'
      + (n.loc ? '<span>' + esc(n.loc) + '</span>' : '')
      + '<span>' + (n.at ? new Date(n.at).toLocaleDateString('zh-CN') : '') + '</span>'
      + '<span class="x" data-rdnotedel="' + esc(n.id) + '" title="删除这条笔记">✕</span></div></div>';
  }
  function rdReadHtml() {
    const b = rdCurrent();
    if (!b) {
      return '<div class="lw-rd-read"><div class="lw-rd-empty">← 从中间选一本书<br><span style="color:' + T.faint + '">或者先「＋ 加书」/「📥 导入笔记」</span></div></div>';
    }
    const st = rdStats();
    const notes = bookNotesOf(b.id).slice().sort((a, c) => (c.at || 0) - (a.at || 0));
    const chips = RD_ST_ORDER.map((k) => '<span class="lw-rd-chip' + (b.status === k ? ' on' : '') + '" data-rdset="' + k + '">' + RD_ST[k].e + ' ' + RD_ST[k].n + '</span>').join('')
      + Object.keys(RD_SRC).map((k) => '<span class="lw-rd-chip' + (b.src === k ? ' on' : '') + '" data-rdsrcset="' + k + '">' + RD_SRC[k].e + ' ' + RD_SRC[k].n + '</span>').join('')
      + [1, 2, 3, 4, 5].map((r) => '<span class="lw-rd-chip' + (Number(b.rating) === r ? ' on' : '') + '" data-rdrate="' + r + '" title="打 ' + r + ' 星">' + '★'.repeat(r) + '</span>').join('')
      + '<span class="lw-rd-chip" data-act="del" id="lw-rd-del" title="删掉这本书和它的笔记">🗑 删除</span>';
    const log = ((STORE && STORE.readLog) || []).filter((x) => x && x.bookId === b.id);
    const totalMin = log.reduce((a, x) => a + (Number(x.min) || 0), 0);
    const totalPg = log.reduce((a, x) => a + (Number(x.pages) || 0), 0);
    const bars = st.days.map((d) => '<div class="' + (d.min ? 'has' : '') + '" style="height:' + Math.max(2, Math.round((d.min / st.maxMin) * 100)) + '%"'
      + ' data-tip="' + esc(d.date) + ' · ' + d.min + ' 分钟"></div>').join('');
    return '<div class="lw-rd-read">'
      + '<div class="lw-rd-rhd"><h2>' + esc(b.title || '未命名') + '</h2>'
      + '<div class="meta">' + esc(b.author || '—')
      + ' · ' + (RD_SRC[b.src] || RD_SRC.other).n
      + ' · ' + (RD_ST[b.status] || RD_ST.want).n
      + (b.pages ? ' · 共 ' + b.pages + ' 页' : '')
      + (b.startAt ? ' · 开始 ' + esc(String(b.startAt).slice(0, 10)) : '')
      + (b.doneAt ? ' · 读完 ' + esc(String(b.doneAt).slice(0, 10)) : '')
      + '</div><div class="chips">' + chips + '</div></div>'
      + '<div class="lw-rd-body">'
      /* 进度 */
      + '<div class="lw-rd-sec">阅读进度</div>'
      + '<div class="lw-rd-prog"><div class="track" id="lw-rd-track" title="点一下直接设进度"><i style="width:' + Math.max(0, Math.min(100, Number(b.prog) || 0)) + '%"></i></div>'
      + '<div class="pct">' + (Number(b.prog) || 0) + '%</div></div>'
      + '<div class="lw-rd-quick">'
      + '<button data-rdprog="5">+5%</button><button data-rdprog="10">+10%</button>'
      + '<button data-rdprog="100">标记读完</button><button data-rdprog="0">归零</button>'
      + '<input id="lw-rd-progset" type="number" min="0" max="100" placeholder="%"/><button id="lw-rd-progok">设为</button>'
      + '</div>'
      /* 记录阅读 */
      + '<div class="lw-rd-sec">记录这次阅读' + (totalMin ? '（累计 ' + totalMin + ' 分钟' + (totalPg ? ' · ' + totalPg + ' 页' : '') + '）' : '') + '</div>'
      + '<div class="lw-rd-quick">'
      + '<input id="lw-rd-min" type="number" min="1" max="1440" placeholder="分钟"/>'
      + '<input id="lw-rd-pg" type="number" min="0" max="9999" placeholder="页数"/>'
      + '<button id="lw-rd-log">✓ 记一笔</button>'
      + '<button id="lw-rd-logdel" title="删掉今天的记录">撤销今天</button>'
      + '</div>'
      /* 笔记 */
      + '<div class="lw-rd-sec">笔记 · ' + notes.length + ' 条</div>'
      + '<div class="lw-rd-quick">'
      + '<textarea id="lw-rd-notetx" placeholder="粘贴划线或写下想法…" style="flex:1;min-width:180px;height:64px;resize:vertical;border:1px solid ' + T.lineDim + ';background:' + T.card + ';color:' + T.text + ';font:11.5px/1.7 ' + UI + ';padding:8px;outline:none"></textarea>'
      + '</div>'
      + '<div class="lw-rd-quick">'
      + '<button id="lw-rd-notequote">✏️ 存为划线</button><button id="lw-rd-noteidea">💭 存为想法</button>'
      + '<span style="font-size:9.5px;color:' + T.faint + '">按 ⌘/Ctrl+Enter 存为划线</span>'
      + '</div>'
      + (notes.length ? notes.map(rdNoteHtml).join('') : '<div class="lw-rd-empty" style="padding:22px">还没有笔记</div>')
      /* 图表 */
      + '<div class="lw-rd-sec">近 14 天阅读时长</div>'
      + '<div class="lw-rd-chart">' + bars + '</div>'
      + '<div class="lw-rd-axis">' + st.days.map((d, i) => '<span>' + (i % 3 === 0 ? d.label : '') + '</span>').join('') + '</div>'
      + '</div></div>';
  }
  /* ══════════════════════════════════════════════════════════════════════
     工作流模块 ✓（参考 n8n：节点 + 连线 + 执行日志）
     数据：STORE.flows = [{ id, name, nodes:[{id,type,x,y,cfg}], edges:[{from,port,to}], at }]
     ══════════════════════════════════════════════════════════════════════ */
  const flowList = () => ((STORE && STORE.flows) || []).filter(Boolean);
  const flowSel = () => FLOW_UI.sel || (STORE && STORE.flowSel) || '';
  const flowCurrent = () => flowList().find((f) => f.id === flowSel()) || null;
  const flowNodeById = (f, id) => ((f && f.nodes) || []).find((n) => n && n.id === id) || null;
  /* 节点说明里允许写 <b> 这类标签 ✓（面板不渲染 markdown ✗），
     但放进 title="" 这种**属性**里就得先把标签剥掉 ✓，否则会原样显示 ✗。
     ⚠️ 必须写成 function 声明 ✓ —— 不要用 const 箭头 ✗：
        箭头有 TDZ ✗，而 mount() 可能在模块求值期间就 render 到工作流页签 ✗
        （见顶部那条铁律 ✓）。函数声明会提升 ✓，没这个问题 ✓。 */
  function flowPlain(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ''); }
  function flowNew() {
    const name = prompt('工作流名字：', '新工作流');
    if (!name || !name.trim()) return;
    const id = 'w' + Date.now();
    STORE.flows = flowList().concat([{ id, name: name.trim(), nodes: [], edges: [], at: Date.now() }]);
    FLOW_UI.sel = id; STORE.flowSel = id; FLOW_UI.steps = null; FLOW_UI.err = '';
    saveStore(); render();
  }
  function flowDel() {
    const f = flowCurrent(); if (!f) return;
    if (!confirm('删掉工作流「' + f.name + '」？')) return;
    STORE.flows = flowList().filter((x) => x.id !== f.id);
    FLOW_UI.sel = ''; STORE.flowSel = '';
    saveStore(); render();
  }
  function flowAddNode(type) {
    const f = flowCurrent(); if (!f) { setStatus(esc('先新建一个工作流 ✓'), 5000); return; }
    const meta = FLOW_NODES[type]; if (!meta) return;
    const n = (f.nodes || []).length;
    const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const cfg = {};
    (meta.cfg || []).forEach((c) => { cfg[c[0]] = c[3]; });
    f.nodes = (f.nodes || []).concat([{ id, type, x: 40 + (n % 4) * 200, y: 40 + Math.floor(n / 4) * 100, cfg }]);
    f.at = Date.now();
    FLOW_UI.node = id; FLOW_UI.sel = f.id; STORE.flowSel = f.id;
    saveStore(); render();
  }
  function flowDelNode(id) {
    const f = flowCurrent(); if (!f) return;
    f.nodes = (f.nodes || []).filter((n) => n.id !== id);
    f.edges = (f.edges || []).filter((e) => e.from !== id && e.to !== id);
    if (FLOW_UI.node === id) FLOW_UI.node = '';
    if (FLOW_UI.arm === id) FLOW_UI.arm = '';
    f.at = Date.now(); saveStore(); render();
  }
  /* 端口中心坐标 ✓（节点尺寸固定 170x56 ✓，直接算就行 ✓，不用量 DOM ✓）*/
  function flowPortXY(n, side, port) {
    const y = n.y + (Number(port) === 1 ? 42 : 28);
    return { x: side === 'out' ? n.x + FLOW_W : n.x, y };
  }
  function flowEdgeD(a, b) {
    const dx = Math.max(36, Math.abs(b.x - a.x) * 0.5);
    return 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y;
  }
  function flowCanvasHtml(f) {
    const nodes = (f.nodes || []);
    const edges = (f.edges || []);
    const planeW = Math.max(880, ...nodes.map((n) => n.x + FLOW_W + 260));
    const planeH = Math.max(520, ...nodes.map((n) => n.y + FLOW_H + 200));
    const stepMap = {};
    (FLOW_UI.steps || []).forEach((st) => { stepMap[st.id] = st; });
    const svg = '<svg class="lw-fl-svg" width="' + planeW + '" height="' + planeH + '">'
      + edges.map((e, i) => {
        const a = flowNodeById(f, e.from), b = flowNodeById(f, e.to);
        if (!a || !b) return '';
        const hot = FLOW_UI.node === e.from || FLOW_UI.node === e.to;
        return '<g data-flowedge="' + i + '" title="点一下删掉这条连线"><path class="hit" d="'
          + flowEdgeD(flowPortXY(a, 'out', e.port), flowPortXY(b, 'in', 0)) + '"/>'
          + '<path class="' + (hot ? 'hot' : '') + '" d="' + flowEdgeD(flowPortXY(a, 'out', e.port), flowPortXY(b, 'in', 0)) + '"/></g>';
      }).join('') + '</svg>';
    const body = nodes.map((n) => {
      const meta = FLOW_NODES[n.type] || { e: '?', n: n.type, in: 1, out: 1 };
      const st = stepMap[n.id];
      const cls = 'lw-fl-node' + (FLOW_UI.node === n.id ? ' on' : '') + (st ? ' s-' + st.status : '');
      const outs = [];
      for (let i = 0; i < (meta.out || 1); i++) {
        outs.push('<div class="lw-fl-port out' + (i === 1 ? ' p1' : '') + (FLOW_UI.arm === n.id && i === 0 ? ' armed' : '')
          + '" data-flout="' + n.id + '" data-flport="' + i + '" title="点这里，再点目标节点的左圆点就连上了"></div>');
      }
      return '<div class="' + cls + '" data-flnode="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px" title="' + esc(flowPlain(meta.d || '')) + '">'
        + ((meta.in || 0) > 0 ? '<div class="lw-fl-port in" data-flin="' + n.id + '"></div>' : '')
        + outs.join('')
        + '<div class="hd">' + esc(meta.g || '') + '<span class="fid">' + esc(n.id) + '</span></div>'
        + '<div class="bd"><span class="em">' + meta.e + '</span>' + esc(meta.n) + '</div>'
        + (st ? '<div class="st">' + (st.status === 'ok' ? '✓' + (st.ms || 0) + 'ms' : st.status === 'error' ? '✗' : '跳过') + '</div>' : '')
        + '</div>';
    }).join('');
    return '<div class="lw-fl-cv" id="lw-fl-cv"><div class="lw-fl-plane" id="lw-fl-plane" style="width:' + planeW + 'px;height:' + planeH + 'px">'
      + svg + body
      + (nodes.length ? '' : '<div class="lw-fl-empty">左边点一个节点就能加进来 ✓<br><span style="color:' + T.faint + '">先加「手动触发」，再加要干的事，最后接「输出」</span></div>')
      + '</div></div>';
  }
  const flowCfgHtml = (f) => '<div class="lw-fl-cfg">' + flowCfgInnerHtml(f) + '</div>';
  function flowCfgInnerHtml(f) {
    if (!f) return '<div class="lw-rd-empty">← 先新建 / 选一个工作流</div>';
    const n = flowNodeById(f, FLOW_UI.node);
    let inner = '';
    if (!n) {
      inner = '<div class="lw-rd-empty" style="padding:26px 16px">点画布上的节点<br>就能在这里改它的设置</div>';
    } else {
      const meta = FLOW_NODES[n.type] || { n: n.type, cfg: [] };
      /* ★ 属性栏第一眼就要回答三件事 ✓：**它是谁**（id ✓，写 {{引用}} 要用 ✓）、
         **它是干什么的**（d ✓）、**怎么用 / 要注意什么**（how ✓）。
         用户原话：「你得告诉我怎么样，每个节点的作用，提示怎么用等等」。 */
      inner = '<div class="lw-rd-sec" style="margin:0 14px 0;padding:14px 0 8px">' + esc(meta.n) + '</div>'
        + '<div class="fd"><span class="fid" title="下游要引用它，就写 {{' + esc(n.id) + '}}">' + esc(n.id) + '</span>'
        + (meta.d || '') + '</div>'
        + (meta.how ? '<div class="fhow">' + meta.how + '</div>' : '')
        + (meta.cfg || []).map((c) => {
          const [k, label, type, def, tip] = c;
          const v = n.cfg && n.cfg[k] != null ? n.cfg[k] : (def == null ? '' : def);
          if (type === 'area') {
            return '<div class="lw-fl-field"><label>' + esc(label) + '</label>'
              + '<textarea rows="4" data-flcfg="' + esc(k) + '">' + esc(v) + '</textarea>'
              + (tip ? '<div class="tip">' + esc(tip) + '</div>' : '') + '</div>';
          }
          if (type === 'select') {
            const opts = String(tip || '').split('/').map((x) => x.trim()).filter(Boolean);
            return '<div class="lw-fl-field"><label>' + esc(label) + '</label><select data-flcfg="' + esc(k) + '">'
              + opts.map((o) => '<option' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('')
              + '</select></div>';
          }
          return '<div class="lw-fl-field"><label>' + esc(label) + '</label>'
            + '<input data-flcfg="' + esc(k) + '" type="' + (type === 'number' ? 'number' : 'text') + '" value="' + esc(v) + '"/>'
            + (tip ? '<div class="tip">' + esc(tip) + '</div>' : '') + '</div>';
        }).join('')
        + (meta.o ? '<div class="fout">输出 <b>' + meta.o + '</b></div>' : '')
        + '<div class="lw-fl-field"><button class="lw-rd-chip" data-act="del" id="lw-fl-nodedel" style="border-color:' + T.lineDim + ';padding:5px 10px">🗑 删掉这个节点</button></div>';
    }
    const steps = FLOW_UI.steps;
    const log = steps && steps.length
      ? '<div class="lw-rd-sec" style="margin:0 14px 0;padding:14px 0 8px">运行日志</div><div class="lw-fl-log">'
        + steps.map((st) => {
          const meta = FLOW_NODES[st.type] || { e: '?', n: st.type };
          return '<div><span class="dot ' + st.status + '">' + (st.status === 'ok' ? '✓' : st.status === 'error' ? '✗' : '○') + '</span>'
            + '<span class="nm">' + meta.e + ' ' + esc(meta.n) + '</span>'
            + '<span class="' + st.status + '" style="margin-left:auto">' + (st.status === 'ok' ? (st.ms || 0) + 'ms' : st.status === 'skipped' ? '跳过' : '失败') + '</span></div>'
            + (st.error ? '<div style="color:' + T.red + ';font-size:9.5px;padding:0 0 4px 16px;word-break:break-all">' + esc(st.error) + '</div>' : '');
        }).join('') + '</div>'
      : '';
    return inner + log;
  }
  /* ══════════════════════════════════════════════════════════════════════
     「📖 说明」面板 ✓ + 「✨ 示例」一键搭图 ✓
     用户原话：「这个工作流，你得告诉我怎么样，每个节点的作用，提示怎么用等等」。
     ⚠️ 这里是**给用户看的文档** ✗，不是代码注释 ✗ —— 所以写成正常人话 ✓，
        内部那套「✓ / ✗」的记号**别出现在这里** ✗（那是我自己备忘用的 ✗，用户看着累 ✗）。
     ⚠️ 允许直接塞 <b> / <code> 这类标签 ✓，但**绝对不能有反引号** ✗✗
        （这段在一个 JS 模板字符串里 ✗ —— 见文件顶部那条铁律 ✗）。
     ══════════════════════════════════════════════════════════════════════ */
  function flowHelpHtml() {
    /* 节点全表 ✓ —— 直接由 FLOW_NODES 生成 ✓，加节点不用回来改文档 ✓（不会忘 ✓）。 */
    const nodeRows = FLOW_GROUPS.map((g) => '<div class="lw-fl-hd2">' + g + '</div>'
      + Object.keys(FLOW_NODES).filter((k) => FLOW_NODES[k].g === g).map((k) => {
        const m = FLOW_NODES[k];
        return '<div class="lw-fl-hn">'
          + '<div class="t"><span class="em">' + m.e + '</span>' + esc(m.n)
          + '<span class="io">' + (m.in || 0) + ' 进 · ' + (m.out || 1) + ' 出</span></div>'
          + '<div class="d">' + (m.d || '') + '</div>'
          + (m.how ? '<div class="h">' + m.how + '</div>' : '')
          + ((m.cfg || []).length ? '<div class="c">要填：' + m.cfg.map((c) => esc(c[1])).join(' · ') + '</div>' : '')
          + (m.o ? '<div class="o">输出 <b>' + m.o + '</b></div>' : '')
          + '</div>';
      }).join('')).join('');
    const faq = [
      ['点了「运行」没反应', '画布是空的，或者缺一个「触发」节点。每张图都要有一个触发当起点。'],
      ['报「图里有环」', '连线绕回自己了。工作流不能走回头路，把绕回去的那条线点掉。'],
      ['AI 节点报「没配 AI」', '先去 CodeScope 的 AI 面板配一次模型。工作流会自动复用它，不用在这里再填一遍 key。'],
      ['条件分支的另一条路上，节点是灰的', '正常，那叫「跳过」。没走的那条路不会执行，不是坏了。'],
      ['「定时触发」到点了没自己跑', '服务端排期还没做，现在仍然要点「运行」。先把图搭好，等做出来就直接生效。'],
      ['「写入备忘录」跑一次多一条', '它只负责「新建」，不覆盖。想每天累积就用它；只想留最新的一份，改用「追加日记」。'],
      ['Webhook 怎么触发', '往 /api/life/flow/hook/ 后面接你填的那个路径发一条 POST 就行。'],
      ['HTTP 请求拿到的数据怎么接着用', '后面接一个「JSON 取值」。路径直接从 data 开始写，不用写 json.data。'],
      ['{{}} 写出来是空的', '多半是节点 id 写错了。取不到只会变成空字符串，不会报错。点一下那个节点，看右栏标题下面的 id。'],
    ].map((r) => '<tr><td class="k">' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
    return '<div class="lw-fl-help"><div class="lw-fl-helpin">'

      + '<h3>① 一分钟上手</h3>'
      + '<p>工作流就是「把几件事按顺序串起来，点一下全做完」。界面分三块：左边挑节点、中间画图、右边改设置。</p>'
      + '<ol>'
      + '<li>点左上角 <b>＋ 新建</b>，起个名字。</li>'
      + '<li>在左边<b>节点库</b>里点一下，节点就落到画布上。顺序永远是：先放一个<b>触发</b>，中间放要干的事，最后接<b>输出</b>。</li>'
      + '<li>连线：先点某个节点<b>右边的圆点</b>，再点目标节点<b>左边的圆点</b>。连错了就点那条线本身，删掉。</li>'
      + '<li>点 <b>▶ 运行</b>。右栏会出现运行日志（每一步成功还是失败、各花多久），画布上的节点也会亮状态。</li>'
      + '</ol>'
      + '<p class="warn">不想从零搭，就点 <b>✨ 示例</b> —— 它会直接搭一张能跑的图出来，照着改最快。</p>'

      + '<h3>② 变量怎么传（这节最关键）</h3>'
      + '<p>每个节点跑完，结果都存在它自己的<b>节点 id</b> 名下 —— 就是画布上节点右上角那个小字，比如 n3。下游想用它，写两层花括号：</p>'
      + '<table>'
      + '<tr><th>写法</th><th>意思</th></tr>'
      + '<tr><td class="k"><code>{{n3}}</code></td><td>把 n3 的整个输出塞进来。是对象或数组就自动转成 JSON 文本</td></tr>'
      + '<tr><td class="k"><code>{{n3.text}}</code></td><td>只取 n3 输出里的 text 字段 —— 比如 AI 节点的回答就这么取</td></tr>'
      + '<tr><td class="k"><code>{{n3.json.data.list[0].title}}</code></td><td>一层层往下挖，数组用方括号</td></tr>'
      + '<tr><td class="k"><code>{{input}}</code></td><td>所有上游输出的合并。只有一个上游时，它就等于那个上游</td></tr>'
      + '</table>'
      + '<p>凡是提示里写了「支持变量」的输入框都能这么写：HTTP 的 URL 和请求体、文本模板、AI 提示、邮件的主题和正文、输出节点的标题和正文。</p>'
      + '<p>取不到只会变成<b>空字符串，不会报错</b>。所以看到结果是空的，先回去检查 id 有没有写错。</p>'

      + '<h3>③ 每个节点是干什么的</h3>'
      + '<p>「几进几出」指的是它左右两边的圆点数量。左边是入口，右边是出口 —— 出口超过一个的（比如条件分支），每条出口通向不同的路。</p>'
      + nodeRows

      + '<h3>④ 常见问题</h3>'
      + '<table><tr><th>现象</th><th>怎么回事</th></tr>' + faq + '</table>'

      + '<h3>⑤ 照着搭一个：B 站热门 AI 摘要</h3>'
      + '<p>目标：抓 B 站当前热门 → 让 AI 挑 5 条 → 写进备忘录，顺手弹个提醒。</p>'
      + '<table>'
      + '<tr><th>节点</th><th>怎么填</th></tr>'
      + '<tr><td class="k">▶ 手动触发</td><td>不用填</td></tr>'
      + '<tr><td class="k">🌐 HTTP 请求</td><td>URL 填 <code>https://api.bilibili.com/x/web-interface/popular?ps=20&amp;pn=1</code>，方法 GET</td></tr>'
      + '<tr><td class="k">{ } JSON 取值</td><td>路径填 <code>data.list</code>（直接写 data，不用写 json.data）</td></tr>'
      + '<tr><td class="k">🤖 AI 对话</td><td>系统提示写「你是资讯编辑，只输出中文」；用户提示写「下面是 B 站热门 JSON，挑 5 条最值得看的，每条一行：序号 + 标题 + 一句话理由」，末尾用 <code>{{上一步的id}}</code> 把数据塞进去</td></tr>'
      + '<tr><td class="k">📝 写入备忘录</td><td>文件夹「工作流」，正文写 <code>{{AI节点的id.text}}</code></td></tr>'
      + '<tr><td class="k">🔔 通知</td><td>内容随便写一句「今日热门已更新」</td></tr>'
      + '</table>'
      + '<p>连线顺序：手动触发 → HTTP 请求 → JSON 取值 → AI 对话 →（分两路）→ 写入备忘录、通知。'
      + '点 <b>✨ 示例</b> 就是把这个图直接搭好。</p>'

      + '</div></div>';
  }
  /* 「✨ 示例」：一键搭一张**真能跑**的图 ✓ —— 教人最快的办法就是给个能改的成品 ✓。 */
  function flowExample() {
    const f = { id: 'w' + Date.now(), name: '示例：B站热门 AI 摘要', nodes: [], edges: [], at: Date.now() };
    const mk = (type, x, y, over) => {
      const meta = FLOW_NODES[type];
      const cfg = {};
      (meta.cfg || []).forEach((c) => { cfg[c[0]] = c[3]; });
      Object.assign(cfg, over || {});
      const id = 'n' + (f.nodes.length + 1);
      f.nodes.push({ id, type, x, y, cfg });
      return id;
    };
    const a = mk('trigger.manual', 40, 70);
    const b = mk('http.request', 260, 70, { url: 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1', method: 'GET' });
    const c = mk('data.json', 480, 70, { path: 'data.list' });
    const d = mk('ai.chat', 700, 70, {
      system: '你是资讯编辑。只输出中文，不要客套话，不要解释你在做什么。',
      prompt: '下面是 B 站当前热门视频的 JSON。请挑 5 条最值得看的，每条一行：序号 + 标题 + 一句话理由。\n\n' + '{{' + c + '}}',
    });
    const e1 = mk('out.memo', 920, 30, { folder: '工作流', title: 'B站热门精选', text: '{{' + d + '.text}}' });
    const e2 = mk('out.notify', 920, 150, { text: '今日 B 站热门已写入备忘录' });
    f.edges = [
      { from: a, port: 0, to: b },
      { from: b, port: 0, to: c },
      { from: c, port: 0, to: d },
      { from: d, port: 0, to: e1 },
      { from: d, port: 0, to: e2 },
    ];
    STORE.flows = flowList().concat([f]);
    FLOW_UI.sel = f.id; STORE.flowSel = f.id;
    FLOW_UI.node = ''; FLOW_UI.arm = ''; FLOW_UI.steps = null; FLOW_UI.help = false;
    saveStore(); render();
    setStatus(esc('✓ 示例搭好了 —— 点「▶ 运行」试试（AI 节点要先在 CodeScope 里配好模型）'), 12000);
  }
  function viewFlow() {
    const list = flowList();
    const f = flowCurrent();
    /* ★ 节点库：**两行** ✓（名字 + 这个节点是干什么的 ✓）——
       用户不用点、不用查，扫一眼就知道该拖哪个 ✓。 */
    const pal = FLOW_GROUPS.map((g) => '<div class="lw-rd-hd">' + g + '</div>'
      + Object.keys(FLOW_NODES).filter((k) => FLOW_NODES[k].g === g).map((k) => {
        const m = FLOW_NODES[k];
        return '<div class="lw-fl-pal" data-fladd="' + k + '" title="点一下加到画布：' + esc(flowPlain(m.d || m.n)) + '">'
          + '<span class="em">' + m.e + '</span>'
          + '<span class="tx"><b>' + esc(m.n) + '</b><i>' + (m.d || '') + '</i></span></div>';
      }).join('')).join('');
    const rows = list.map((x) => '<div class="lw-fl-row' + (flowSel() === x.id ? ' on' : '') + '" data-flsel="' + esc(x.id) + '">'
      + '<span class="em">⚙</span>' + esc(x.name) + '<span class="n">' + (x.nodes || []).length + '</span></div>').join('');
    const tools = '<div class="lw-fl-tools">'
      + '<button id="lw-fl-new">＋ 新建</button>'
      + '<button id="lw-fl-save">💾 保存</button>'
      + '<button class="pri" id="lw-fl-run"' + (f && (f.nodes || []).length ? '' : ' disabled') + '>▶ 运行</button>'
      + '<button id="lw-fl-example" title="一键搭一个能跑的示例（B站热门 → AI 挑 5 条 → 写进备忘录）">✨ 示例</button>'
      + '<button id="lw-fl-help" class="' + (FLOW_UI.help ? 'pri' : '') + '" title="每个节点是干什么的、怎么用">📖 说明</button>'
      + '<button id="lw-fl-clear">清空画布</button>'
      + '<button id="lw-fl-del">🗑 删工作流</button>'
      + '<span class="hint">' + (FLOW_UI.busy ? '正在跑…'
        : FLOW_UI.help ? '看完点「📖 说明」收起来' : '点节点改设置 · 点右圆点再点左圆点就连线 · 点连线删掉') + '</span>'
      + '</div>';
    return '<div class="lw-fl">'
      + '<div class="lw-fl-side"' + paneW('flowSideW', 150) + '><div class="lw-rd-hd">我的工作流</div>' + (rows || '<div class="lw-fl-row" style="color:' + T.faint + '">还没有，点「＋ 新建」</div>')
      + '<div class="lw-rd-hd">节点库</div>' + pal + '</div>' + paneGrip('side')
      + '<div style="flex:1;min-width:0;display:flex;flex-direction:column">' + tools
      + (FLOW_UI.help ? flowHelpHtml()
        : f ? flowCanvasHtml(f) : '<div class="lw-fl-cv"><div class="lw-fl-empty">← 先新建一个工作流 ✓<br><span style="color:' + T.faint + '">或者从左边选一个已有的</span></div></div>')
      + '</div>' + paneGrip('cfg')
      + '<div class="lw-fl-cfg"' + paneW('flowCfgW', 220) + '>' + flowCfgInnerHtml(f) + '</div></div>';
  }
  /* ── 运行 ✓ ────────────────────────────────────────────────────────────── */
  function flowAiCfg() {
    try { return JSON.parse(localStorage.getItem('mc-ai-cfg') || '{}') || {}; } catch (_) { return {}; }
  }
  async function flowRun() {
    const f = flowCurrent(); if (!f || FLOW_UI.busy) return;
    if (!(f.nodes || []).length) { setStatus(esc('画布是空的 ✓ 先加几个节点'), 5000); return; }
    FLOW_UI.busy = true; FLOW_UI.steps = null; FLOW_UI.err = '';
    render();
    try {
      const ai = flowAiCfg();
      const r = await fetch('/api/life/flow/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ graph: { nodes: f.nodes, edges: f.edges }, ai: { url: ai.url || '', key: ai.key || '', model: ai.model || '' } }),
      });
      const d = await r.json();
      FLOW_UI.steps = (d && d.steps) || [];
      FLOW_UI.err = (d && d.ok) ? '' : ((d && d.error) || '运行失败');
      if (d && d.ok) {
        const msg = await flowApplyEffects(d.effects || []);
        setStatus(esc('✓ 跑完了' + (msg ? ' · ' + msg : '')), 8000);
      } else {
        setStatus(esc('✗ ' + FLOW_UI.err), 12000);
      }
    } catch (e) {
      FLOW_UI.err = e.message;
      setStatus(esc('✗ 运行失败：' + e.message), 12000);
    }
    FLOW_UI.busy = false;
    render();
  }
  /* ★ 输出类节点在这里**才**落地 ✗ —— 引擎只回 effects ✓，STORE 归前端管 ✓ */
  async function flowApplyEffects(effects) {
    if (!effects.length) return '';
    const parts = [];
    let wrote = 0;
    for (const e of effects) {
      if (e.kind === 'memo') {
        const id = 'm' + Date.now() + Math.random().toString(36).slice(2, 5);
        STORE.memos = ((STORE && STORE.memos) || []).concat([{
          id, text: String(e.title || '工作流产出') + '\n' + String(e.text || ''),
          folder: String(e.folder || '工作流'), pin: false, at: Date.now(), edit: Date.now(),
        }]);
        if (!(STORE.memoFolders || []).includes(String(e.folder || '工作流'))) {
          STORE.memoFolders = ((STORE && STORE.memoFolders) || []).concat([String(e.folder || '工作流')]);
        }
        wrote++; parts.push('写了 1 条备忘录');
      } else if (e.kind === 'journal') {
        const k = dayKey(new Date());
        let j = ((STORE && STORE.journal) || []).find((x) => x && x.date === k);
        if (!j) { j = { date: k, text: '', cat: '', at: Date.now() }; STORE.journal = ((STORE && STORE.journal) || []).concat([j]); }
        j.text = String(j.text || '') + (j.text ? '\n' : '') + String(e.text || '');
        j.at = Date.now(); wrote++; parts.push('追加了今天的日记');
      } else if (e.kind === 'notify') {
        setStatus(esc('🔔 ' + String(e.text || '').slice(0, 120)), 10000);
      } else if (e.kind === 'mail') {
        try {
          const key = (mailConfiguredKeys() || [])[0];
          if (!key) { parts.push('✗ 没配邮箱，邮件没发出去'); continue; }
          const r = await fetch('/api/life/mail/send', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key, account: {}, to: e.to, subject: e.subject, body: e.body }),
          });
          const d = await r.json();
          parts.push(d && d.ok ? '发了 1 封邮件' : ('✗ 邮件失败：' + ((d && d.error) || '')));
        } catch (err) { parts.push('✗ 邮件失败：' + err.message); }
      }
    }
    if (wrote) { saveStore(); }
    return parts.join(' · ');
  }
  function bindFlow() {
    const host = document.getElementById('lifework-view');
    if (!host || TAB !== 'flow') return;
    bindPaneGrips(host, [
      { which: 'side', target: '.lw-fl-side', min: 150, max: 420, key: 'flowSideW' },
      { which: 'cfg', target: '.lw-fl-cfg', min: 220, max: 560, key: 'flowCfgW' },
    ]);
    const q = (sel) => host.querySelector(sel);
    const qa = (sel) => Array.from(host.querySelectorAll(sel));
    qa('[data-flsel]').forEach((el) => { el.onclick = () => { FLOW_UI.sel = el.dataset.flsel; STORE.flowSel = el.dataset.flsel; FLOW_UI.node = ''; FLOW_UI.steps = null; render(); }; });
    qa('[data-fladd]').forEach((el) => { el.onclick = () => flowAddNode(el.dataset.fladd); });
    const nw = q('#lw-fl-new'); if (nw) nw.onclick = () => flowNew();
    const dl = q('#lw-fl-del'); if (dl) dl.onclick = () => flowDel();
    const sv = q('#lw-fl-save'); if (sv) sv.onclick = () => { const f = flowCurrent(); if (f) { f.at = Date.now(); saveStore(); } setStatus(esc('✓ 工作流已保存'), 4000); };
    const rn = q('#lw-fl-run'); if (rn) rn.onclick = () => flowRun();
    const ex = q('#lw-fl-example'); if (ex) ex.onclick = () => flowExample();
    const hp = q('#lw-fl-help');
    if (hp) hp.onclick = () => { FLOW_UI.help = !FLOW_UI.help; render(); };
    const cl = q('#lw-fl-clear');
    if (cl) cl.onclick = () => {
      const f = flowCurrent(); if (!f) return;
      if (!confirm('清空画布上的所有节点和连线？（工作流本身还在）')) return;
      f.nodes = []; f.edges = []; f.at = Date.now();
      FLOW_UI.node = ''; FLOW_UI.arm = ''; FLOW_UI.steps = null;
      saveStore(); render();
    };
    const nd = q('#lw-fl-nodedel'); if (nd) nd.onclick = () => flowDelNode(FLOW_UI.node);
    /* 节点：点选 / 拖动 ✓ */
    qa('[data-flnode]').forEach((el) => {
      el.onclick = (ev) => {
        if (ev.target.classList && ev.target.classList.contains('lw-fl-port')) return;
        FLOW_UI.node = el.dataset.flnode; FLOW_UI.arm = ''; render();
      };
      lwGrab(el, {
        down: (ev) => {
          /* 端口上按下 = 连线，不是拖节点 ✓（lwGrab 里也挡了一道 ✓）*/
          if (ev.target.classList && ev.target.classList.contains('lw-fl-port')) return null;
          const f = flowCurrent(); if (!f) return null;
          const n = flowNodeById(f, el.dataset.flnode); if (!n) return null;
          return { f, n, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, moved: false };
        },
        move: (e2, sess) => {
          const dx = e2.clientX - sess.sx, dy = e2.clientY - sess.sy;
          if (!sess.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
          sess.moved = true;
          sess.n.x = Math.max(0, sess.ox + dx); sess.n.y = Math.max(0, sess.oy + dy);
          el.style.left = sess.n.x + 'px'; el.style.top = sess.n.y + 'px';
          const svgEl = q('.lw-fl-svg');
          if (svgEl) svgEl.outerHTML = ''; /* 拖动时先清掉线 ✓，松手重画 ✓（省得每帧重算 ✓）*/
        },
        up: (e2, sess) => { if (sess.moved) { sess.f.at = Date.now(); saveStore(); render(); } },
      });
    });
    /* 连线：先点出端口（arm ✓），再点目标节点的入端口 ✓ */
    qa('[data-flout]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        FLOW_UI.arm = (FLOW_UI.arm === el.dataset.flout && FLOW_UI.armPort === el.dataset.flport) ? '' : el.dataset.flout;
        FLOW_UI.armPort = el.dataset.flport;
        render();
      };
    });
    qa('[data-flin]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const f = flowCurrent(); if (!f) return;
        const from = FLOW_UI.arm, to = el.dataset.flin;
        if (!from) { setStatus(esc('先点左边节点的「右」圆点 ✓'), 4000); return; }
        if (from === to) { setStatus(esc('不能连到自己 ✓'), 4000); return; }
        const port = Number(FLOW_UI.armPort) || 0;
        if ((f.edges || []).some((e) => e.from === from && Number(e.port) === port && e.to === to)) { FLOW_UI.arm = ''; render(); return; }
        f.edges = (f.edges || []).concat([{ from, port, to }]);
        f.at = Date.now();
        FLOW_UI.arm = '';
        saveStore(); render();
      };
    });
    qa('[data-flowedge]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const f = flowCurrent(); if (!f) return;
        const i = Number(el.dataset.flowedge);
        f.edges = (f.edges || []).filter((_e, k) => k !== i);
        f.at = Date.now(); saveStore(); render();
      };
    });
    /* 配置字段：改完就存 ✓（不整屏重绘 ✗，否则每敲一个字输入框就失焦 ✗）*/
    qa('[data-flcfg]').forEach((el) => {
      const on = () => {
        const f = flowCurrent(); if (!f) return;
        const n = flowNodeById(f, FLOW_UI.node); if (!n) return;
        n.cfg = n.cfg || {};
        n.cfg[el.dataset.flcfg] = el.value;
        f.at = Date.now();
        saveStore();
      };
      el.oninput = on;
      el.onchange = on;
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     热榜模块（多源聚合 + AI 日报）✓
     数据：STORE.trends = { star: { id: at }, seen: { id: at } }
     源目录与内容都来自服务端 `/api/life/trends` ✓（lib/hot.js ✓，11 个源都实测过 ✓）。
     ══════════════════════════════════════════════════════════════════════ */
  /* ★★ 哪些站**不允许被 iframe 内嵌** ✗✗ —— 这份名单是**实测出来的** ✓，不是猜的 ✓：
     逐个 curl 看响应头 ✓，凡是带 `X-Frame-Options: deny|SAMEORIGIN` 或
     `Content-Security-Policy: frame-ancestors 'none'` 的 ✗，浏览器就会直接显示
     「xxx 拒绝了我们的连接请求」✗（用户截图里 GitHub 那条就是这个 ✗）。
     实测结果 ✓：
       ✗ 不能嵌：github.com（deny + CSP none）/ arxiv.org（SAMEORIGIN + CSP none）/
                 openalex.org（SAMEORIGIN）/ openai.com（SAMEORIGIN）
       ✓ 能嵌：  B站 / 掘金 / 少数派 / 微博 / 百度 / 抖音 / Hacker News
     名单里另外补了几个**众所周知的**反内嵌站 ✓（知乎 / 微信公众号 / X / Google … ✓）。
     ⚠️ 光靠运行时探测**测不准** ✗ —— 试过读 `iframe.contentDocument` ✗，
        被拒和「还没加载完」长得一模一样 ✗（都是空文档 ✗）。
        所以宁可**按名单判断** ✓：能嵌就嵌 ✓，不能嵌就**说清楚** ✓。 */
  const NO_FRAME_HOSTS = /(^|\.)(github\.com|githubusercontent\.com|arxiv\.org|openalex\.org|openai\.com|zhihu\.com|mp\.weixin\.qq\.com|x\.com|twitter\.com|google\.com|youtube\.com|facebook\.com|instagram\.com|linkedin\.com)$/i;
  function canFrame(url) {
    try { return !NO_FRAME_HOSTS.test(new URL(String(url || '')).hostname); } catch (_) { return false; }
  }
  const hostOf = (url) => { try { return new URL(String(url || '')).hostname; } catch (_) { return ''; } };

  const trStore = () => (STORE.trends = STORE.trends || { star: {}, seen: {} });
  const trIsStar = (id) => !!(trStore().star || {})[id];
  const trIsSeen = (id) => !!(trStore().seen || {})[id];
  const trCatalog = () => ((TR_UI.data && TR_UI.data.sources) || []);
  const trResults = () => ((TR_UI.data && TR_UI.data.results) || []);
  function trFlat() {
    const out = [];
    trResults().forEach((r) => {
      if (!r || !r.items) return;
      r.items.forEach((it, i) => out.push(Object.assign({}, it, { srcKey: r.key, srcName: r.name, srcIcon: r.icon, srcGroup: r.group, rank: i + 1 })));
    });
    return out;
  }
  function trFiltered() {
    const q = String(TR_UI.q || '').trim().toLowerCase();
    return trFlat().filter((x) => {
      if (TR_UI.src && x.srcKey !== TR_UI.src) return false;
      if (TR_UI.only === 'star' && !trIsStar(x.id)) return false;
      if (TR_UI.only === 'new' && trIsSeen(x.id)) return false;
      if (q && (String(x.title) + ' ' + String(x.extra)).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  const trById = (id) => trFlat().find((x) => x.id === id) || null;
  /* 拉数据 ✓ —— 单源失败**不影响别的源** ✓（服务端已经逐个兜底了 ✓）*/
  async function trLoad(force) {
    if (TR_UI.busy) return;
    TR_UI.busy = true; TR_UI.err = '';
    render();
    try {
      const r = await fetch('/api/life/trends' + (force ? '?force=1' : ''), { cache: 'no-store' });
      const d = await r.json();
      if (d && d.ok) { TR_UI.data = d; TR_UI.at = Date.now(); }
      else TR_UI.err = (d && d.error) || '拉取失败';
    } catch (e) { TR_UI.err = '拉取失败：' + e.message; }
    TR_UI.busy = false;
    render();
  }
  function trStar(id) {
    const st = trStore();
    st.star = st.star || {};
    if (st.star[id]) delete st.star[id]; else st.star[id] = Date.now();
    saveStore(); render();
  }
  function trSeen(id) {
    const st = trStore();
    st.seen = st.seen || {};
    st.seen[id] = Date.now();
    saveStore();
  }
  function trMarkAllSeen() {
    const st = trStore();
    st.seen = st.seen || {};
    const now = Date.now();
    trFiltered().forEach((x) => { st.seen[x.id] = now; });
    saveStore(); render();
  }
  /* ── AI 日报 ✓ ─────────────────────────────────────────────────────────── */
  async function trAiDaily() {
    if (TR_UI.aiBusy) return;
    const list = trFiltered().slice(0, 60);
    if (!list.length) { setStatus(esc('先拉一次榜单 ✓'), 5000); return; }
    let cfg = {}; try { cfg = JSON.parse(localStorage.getItem('mc-ai-cfg') || '{}') || {}; } catch (_) {}
    if (!cfg.url || !cfg.key || !cfg.model) {
      TR_UI.ai = '✗ 还没配大模型 —— 去 CodeScope 的 AI 面板配一次 ✓（这里会自动复用 ✓）';
      render(); return;
    }
    TR_UI.aiBusy = true; TR_UI.ai = '正在让模型读这 ' + list.length + ' 条…'; render();
    const body = list.map((x, i) => '[' + (i + 1) + ']（' + x.srcName + '）' + x.title + (x.extra ? ' —— ' + x.extra : '')).join('\n');
    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: cfg.url, key: cfg.key, model: cfg.model,
          messages: [
            { role: 'system', content: '你是信息筛选助手。读者是做机器人与 AI 研究的工程师。用中文输出，克制、具体、不要空话。' },
            { role: 'user', content: '下面是今天各平台的热榜 + 最新论文，共 ' + list.length + ' 条。\n\n' + body + '\n\n请输出一份简报：\n1. 【值得看的 5 条】每条一行，写清**为什么值得看**（一句话），并带上序号；\n2. 【前沿动态】把和机器人 / AI / 具身智能相关的单独拎出来讲；\n3. 【可以忽略的】一句话带过。\n不要复述全部条目，不要写客套话。' },
          ],
          timeoutMs: 180000,
        }),
      });
      const d = await r.json();
      TR_UI.ai = (d && d.ok) ? d.content : ('✗ ' + ((d && d.error) || 'AI 调用失败'));
    } catch (e) { TR_UI.ai = '✗ AI 调用失败：' + e.message; }
    TR_UI.aiBusy = false;
    render();
  }
  function trSaveAiToMemo() {
    const text = String(TR_UI.ai || '').trim();
    if (!text || text.startsWith('✗')) { setStatus(esc('先成功生成一份日报 ✓'), 5000); return; }
    const id = 'm' + Date.now();
    STORE.memos = ((STORE && STORE.memos) || []).concat([{
      id, text: '今日热榜 AI 日报 · ' + dayKey(new Date()) + '\n' + text,
      folder: '热榜', pin: false, at: Date.now(), edit: Date.now(),
    }]);
    if (!((STORE.memoFolders || []).includes('热榜'))) STORE.memoFolders = ((STORE && STORE.memoFolders) || []).concat(['热榜']);
    saveStore();
    setStatus(esc('✓ 已存进备忘录（文件夹「热榜」）'), 6000);
  }
  /* 系统通知 ✓ —— 只用于「用户主动点」✗（不自动弹权限 ✗）*/
  function trNotify() {
    const list = trFiltered().filter((x) => !trIsSeen(x.id)).slice(0, 5);
    if (!list.length) { setStatus(esc('没有新条目 ✓'), 4000); return; }
    if (typeof Notification === 'undefined') { setStatus(esc('这个环境不支持系统通知 ✗'), 5000); return; }
    if (Notification.permission !== 'granted') {
      Notification.requestPermission().then((perm) => {
        setStatus(esc(perm === 'granted' ? '✓ 已开启通知，再点一次就会弹 ✓' : '✗ 你拒绝了通知权限'), 7000);
      });
      return;
    }
    try {
      const n = new Notification('今日热榜 · ' + list.length + ' 条新', {
        body: list.map((x) => '· ' + x.title.slice(0, 30)).join('\n'), tag: 'codescope-trends',
      });
      setTimeout(() => { try { n.close(); } catch (_) {} }, 15000);
      setStatus(esc('✓ 已推送 ' + list.length + ' 条 ✓'), 5000);
    } catch (e) { setStatus(esc('✗ 推送失败：' + e.message), 6000); }
  }
  /* ── 视图 ─────────────────────────────────────────────────────────────── */
  function trSideHtml() {
    const cat = trCatalog();
    const results = trResults();
    const byKey = {}; results.forEach((r) => { byKey[r.key] = r; });
    const all = trFlat();
    const newCount = all.filter((x) => !trIsSeen(x.id)).length;
    const starCount = all.filter((x) => trIsStar(x.id)).length;
    const rows = TR_GROUPS.map((g) => {
      const inG = cat.filter((c) => c.group === g);
      if (!inG.length) return '';
      return '<div class="lw-rd-hd">' + g + '</div>' + inG.map((c) => {
        const r = byKey[c.key];
        const n = r && r.items ? r.items.length : 0;
        const bad = r && !r.ok;
        return '<div class="lw-rd-row' + (TR_UI.src === c.key ? ' on' : '') + '" data-trsrc="' + esc(c.key) + '" title="' + esc(bad ? (r.error || '') : (n + ' 条')) + '">'
          + '<span class="em">' + c.icon + '</span>' + esc(c.name)
          + '<span class="n" style="color:' + (bad ? T.red : T.faint) + '">' + (TR_UI.busy ? '…' : (bad ? '✗' : n)) + '</span></div>';
      }).join('');
    }).join('');
    return '<div class="lw-rd-hd">筛选</div>'
      + '<div class="lw-rd-row' + (TR_UI.only === 'all' ? ' on' : '') + '" data-tronly="all"><span class="em">▣</span>全部<span class="n">' + all.length + '</span></div>'
      + '<div class="lw-rd-row' + (TR_UI.only === 'new' ? ' on' : '') + '" data-tronly="new"><span class="em">✨</span>未读<span class="n">' + newCount + '</span></div>'
      + '<div class="lw-rd-row' + (TR_UI.only === 'star' ? ' on' : '') + '" data-tronly="star"><span class="em">⭐</span>收藏<span class="n">' + starCount + '</span></div>'
      + '<div class="lw-rd-hd">来源</div>'
      + '<div class="lw-rd-row' + (TR_UI.src === '' ? ' on' : '') + '" data-trsrc=""><span class="em">▣</span>全部来源</div>'
      + (rows || '<div class="lw-rd-row" style="color:' + T.faint + '">还没拉过 —— 点右边「↻ 刷新」</div>');
  }
  const trSideInnerHtml = trSideHtml;
  function trItemHtml(x) {
    const star = trIsStar(x.id), seen = trIsSeen(x.id);
    return '<div class="lw-hl-it' + (TR_UI.sel === x.id ? ' on' : '') + (seen ? ' seen' : '') + '" data-trit="' + esc(x.id) + '">'
      + '<div class="rk' + (x.rank <= 3 ? ' top' : '') + '">' + x.rank + '</div>'
      + '<div class="mn"><div class="ti">' + esc(x.title) + '</div>'
      + '<div class="mt"><span class="badge">' + x.srcIcon + ' ' + esc(x.srcName) + '</span>'
      + (x.hotText ? '<span class="hot">' + esc(x.hotText) + '</span>' : '')
      + (x.extra ? '<span>' + esc(String(x.extra).slice(0, 24)) + '</span>' : '')
      + (star ? '<span class="st">⭐</span>' : '')
      + '</div></div></div>';
  }
  function trListHtml() {
    const tools = '<div class="lw-hl-tools">'
      + '<input id="lw-hl-q" placeholder="筛选标题…" value="' + esc(TR_UI.q) + '"/>'
      + '<button class="pri" id="lw-hl-reload">' + (TR_UI.busy ? '拉取中…' : '↻ 刷新') + '</button>'
      + '<button id="lw-hl-seenall">全部标为已读</button>'
      + '</div>';
    if (TR_UI.err) return tools + '<div class="lw-hl-err">✗ ' + esc(TR_UI.err) + '</div>';
    if (!TR_UI.data) return tools + '<div class="lw-rd-empty">还没拉过<br><span style="color:' + T.faint + '">点「↻ 刷新」拉一次（11 个源，几秒钟）</span></div>';
    const list = trFiltered();
    if (!list.length) return tools + '<div class="lw-rd-empty">没有符合条件的条目</div>';
    /* 选了单个源 → 直接列 ✓；「全部」→ 按源分组 ✓（读起来清楚得多 ✓）*/
    if (TR_UI.src) return tools + list.map(trItemHtml).join('');
    const bySrc = new Map();
    list.forEach((x) => { if (!bySrc.has(x.srcKey)) bySrc.set(x.srcKey, []); bySrc.get(x.srcKey).push(x); });
    let html = '';
    bySrc.forEach((arr, k) => {
      const r = trResults().find((z) => z.key === k) || {};
      html += '<div class="lw-hl-src">' + (r.icon || '') + ' ' + esc(r.name || k) + ' · ' + arr.length + ' 条</div>' + arr.map(trItemHtml).join('');
    });
    return tools + html;
  }
  function trReadHtml() {
    const x = trById(TR_UI.sel);
    const ai = '<div class="lw-hl-ai"><div class="hd"><b>🤖 AI 日报</b>'
      + '<button id="lw-hl-ai">' + (TR_UI.aiBusy ? '生成中…' : '生成 AI 日报') + '</button>'
      + '<button id="lw-hl-aimemo" style="border-color:' + T.lineDim + ';color:' + T.dim + '">存进备忘录</button></div>'
      + '<div class="bd">' + esc(TR_UI.ai) + '</div></div>';
    if (!x) {
      return '<div class="lw-hl-read">' + ai + '<div class="lw-rd-empty">← 从中间点一条看看<br><span style="color:' + T.faint + '">或者直接点右上「生成 AI 日报」，让它先帮你筛一遍 ✓</span></div></div>';
    }
    return '<div class="lw-hl-read">' + ai + '<div class="lw-hl-body">'
      + '<h2>' + esc(x.title) + '</h2>'
      + '<div class="meta">' + x.srcIcon + ' ' + esc(x.srcName) + ' · 第 ' + x.rank + ' 位'
      + (x.hotText ? ' · ' + esc(x.hotText) : '') + (x.extra ? ' · ' + esc(x.extra) : '') + '</div>'
      + '<div class="acts">'
      + '<button id="lw-hl-open">↗ 用浏览器打开原文</button>'
      + '<button id="lw-hl-star" class="' + (trIsStar(x.id) ? 'on' : '') + '">' + (trIsStar(x.id) ? '⭐ 已收藏' : '☆ 收藏') + '</button>'
      + '<button id="lw-hl-notify">🔔 推送这条</button>'
      + '<button id="lw-hl-copy">⧉ 复制标题</button>'
      + '</div>'
      + (canFrame(x.url)
        ? '<iframe id="lw-hl-frame" sandbox="allow-same-origin" src="' + esc(x.url) + '" title="原文预览"></iframe>'
          + '<div style="font-size:10px;color:' + T.faint + ';margin-top:8px;line-height:1.8">'
          + '上面是<b>沙箱预览</b>（不带脚本 ✓，防追踪 ✓）；排版可能和原站有出入 ✓</div>'
        : '<div class="lw-hl-noframe">'
          + '<div class="ic">🚫</div>'
          + '<div class="ti">' + esc(hostOf(x.url)) + ' 不允许被内嵌</div>'
          + '<div class="why">它自己设了 <b>X-Frame-Options</b> / <b>CSP frame-ancestors</b>（防点击劫持）✗，'
          + '任何网站都嵌不了它 ✗ —— 不是这边坏了 ✓，只能在新标签页打开 ✓。</div>'
          + '<button id="lw-hl-openbig">↗ 在浏览器里打开原文</button>'
          + '<div class="url">' + esc(x.url) + '</div></div>')
      + '</div></div>';
  }
  function viewTrends() {
    return '<div class="lw-hl">'
      + '<div class="lw-hl-side"' + paneW('trendSideW', 150) + '>' + trSideInnerHtml() + '</div>' + paneGrip('side')
      + '<div class="lw-hl-list"' + paneW('trendListW', 260) + '>' + trListHtml() + '</div>' + paneGrip('list')
      + trReadHtml() + '</div>';
  }
  function bindTrends() {
    const host = document.getElementById('lifework-view');
    if (!host || TAB !== 'trends') return;
    bindPaneGrips(host, [
      { which: 'side', target: '.lw-hl-side', min: 150, max: 420, key: 'trendSideW' },
      { which: 'list', target: '.lw-hl-list', min: 260, max: 760, key: 'trendListW' },
    ]);
    const q = (sel) => host.querySelector(sel);
    const qa = (sel) => Array.from(host.querySelectorAll(sel));
    qa('[data-trsrc]').forEach((el) => { el.onclick = () => { TR_UI.src = el.dataset.trsrc; TR_UI.sel = ''; render(); }; });
    qa('[data-tronly]').forEach((el) => { el.onclick = () => { TR_UI.only = el.dataset.tronly; render(); }; });
    qa('[data-trit]').forEach((el) => {
      el.onclick = () => { TR_UI.sel = el.dataset.trit; trSeen(el.dataset.trit); render(); };
    });
    const rl = q('#lw-hl-reload'); if (rl) rl.onclick = () => trLoad(true);
    const sa = q('#lw-hl-seenall'); if (sa) sa.onclick = () => trMarkAllSeen();
    const ai = q('#lw-hl-ai'); if (ai) ai.onclick = () => trAiDaily();
    const aim = q('#lw-hl-aimemo'); if (aim) aim.onclick = () => trSaveAiToMemo();
    const st = q('#lw-hl-star'); if (st) st.onclick = () => trStar(TR_UI.sel);
    const nf = q('#lw-hl-notify'); if (nf) nf.onclick = () => trNotify();
    const cp = q('#lw-hl-copy');
    if (cp) cp.onclick = () => { const x = trById(TR_UI.sel); if (!x) return; try { navigator.clipboard.writeText(x.title + '\n' + x.url); setStatus(esc('✓ 已复制 ✓'), 4000); } catch (_) {} };
    const op = q('#lw-hl-open');
    if (op) op.onclick = () => { const x = trById(TR_UI.sel); if (x) window.open(x.url, '_blank', 'noopener'); };
    const opb = q('#lw-hl-openbig');
    if (opb) opb.onclick = () => { const x = trById(TR_UI.sel); if (x) window.open(x.url, '_blank', 'noopener'); };
    const qi = q('#lw-hl-q');
    if (qi) qi.oninput = () => {
      /* 只改显隐 ✓，不整屏重绘 ✗（否则每敲一个字输入框就失焦 ✗）*/
      TR_UI.q = qi.value;
      const needle = qi.value.trim().toLowerCase();
      qa('[data-trit]').forEach((el) => {
        const x = trById(el.dataset.trit);
        const hay = x ? (String(x.title) + ' ' + String(x.extra)).toLowerCase() : '';
        el.style.display = (!needle || hay.indexOf(needle) >= 0) ? '' : 'none';
      });
    };
    /* ★ 进这一页如果数据太旧就**自动拉一次** ✓ —— 这就是「每天自动更新」的落点之一 ✓
       （另一个落点是服务端的定时/自动化 ✓）。⚠️ 别每次 render 都拉 ✗（会打爆上游 ✗）。 */
    if (!TR_UI.busy && (!TR_UI.data || Date.now() - TR_UI.at > 10 * 60 * 1000)) trLoad(false);
  }

  function viewEnglish() {
    return '<div class="lw-rd">'
      + '<div class="lw-rd-side"' + paneW('bookSideW', 150) + '>' + epSideHtml() + '</div>' + paneGrip('side')
      + '<div class="lw-rd-list"' + paneW('bookListW', 260) + '>' + epArtListHtml() + '</div>' + paneGrip('list')
      + '<div class="lw-rd-read">' + epReadHtml(epCurArt()) + '</div>'
      + '</div>';
  }
  function viewReading() {
    const mode = epMode();
    const shelf = '<div class="lw-rd">'
      + '<div class="lw-rd-side"' + paneW('bookSideW', 150) + '>' + rdSideInnerHtml() + '</div>' + paneGrip('side')
      + '<div class="lw-rd-list"' + paneW('bookListW', 260) + '>' + rdListHtml() + '</div>' + paneGrip('list')
      + rdReadHtml() + '</div>';
    /* ⚠️ 三个模式**复用同一套三栏类名** ✗（.lw-rd-side / .lw-rd-list / .lw-rd-read ✓）——
       于是拖拽调宽那份 spec 一个字都不用改 ✓（新做一套等于重踩一遍 ✗）。 */
    const inner = mode === 'ex' ? (EN ? viewEnglish() : '<div class="lw-rd">' + epNoLib() + '</div>')
      : mode === 'word' ? viewWordbook() : shelf;
    return '<div class="lw-rd-wrap">' + epModeBar() + inner
      + (RD_UI.impOpen ? rdImportHtml() : '')
      + (RD_UI.connOpen ? rdWrConnHtml() : '')
      + (EP_UI.impOpen ? epImportHtml() : '')
      + (EP_UI.revOpen ? epReviewHtml() : '')
      + '</div>';
  }
  /* 导入浮层 ✓（先预览再导入 ✓）*/
  function rdImportHtml() {
    const pv = RD_UI.impPv;
    let preview = '';
    if (pv) {
      preview = pv.length
        ? '<div class="pv"><b>解析出 ' + pv.length + ' 本书：</b><br>'
          + pv.map((b) => '· 《' + esc(b.title) + '》' + (b.author ? ' — ' + esc(b.author) : '') + ' · ' + b.notes.length + ' 条笔记').join('<br>')
          + '</div>'
        : '<div class="pv" style="color:' + T.warn + '">没解析出内容 ✗ —— 确认粘的是「书名 + 划线/想法」那种导出文本</div>';
    }
    return '<div class="lw-imp" id="lw-imp"><div class="box">'
      + '<div class="hd"><b>📥 导入阅读笔记</b><span class="x" id="lw-imp-x">✕</span></div>'
      + '<div class="bd">'
      + '<div class="tip">把 <b>微信读书 App</b> 里的笔记导出文本粘到下面 ✓ ——'
      + '路径：<code>打开书 → 右上角 ··· → 笔记 → 导出/复制全文</code>。<br>'
      + '认得的写法：<code>《书名》</code>、<code>作者：xxx</code>、'
      + '单独一行的 <code>划线</code> / <code>想法</code>、日期行（只当分隔）、'
      + '以及 Markdown 风的 <code># 书名</code> / <code>&gt; 划线</code> / <code>- 想法</code> ✓。<br>'
      + '别的阅读器（Kindle / Apple Books / 豆瓣）导出成类似结构也一样能进 ✓。</div>'
      + '<textarea id="lw-imp-tx" placeholder="《置身事内：中国政府与经济发展》&#10;作者：兰小欢&#10;&#10;第一章 地方政府的权力与事务&#10;划线&#10;2023-01-01 12:00:00&#10;原文内容……&#10;想法&#10;我的想法……">' + esc(RD_UI.impText) + '</textarea>'
      + '<div style="margin-top:12px" id="lw-imp-pv">' + preview + '</div>'
      + '</div>'
      + '<div class="ft">'
      + '<button id="lw-imp-preview">解析预览</button>'
      + '<button class="pri" id="lw-imp-do"' + (pv && pv.length ? '' : ' disabled') + '>导入 ' + (pv && pv.length ? pv.reduce((a, b) => a + b.notes.length, 0) + ' 条笔记' : '') + '</button>'
      + '<span style="font-size:10px;color:' + T.faint + ';margin-left:auto">同名书会自动合并 ✓ 不会重复建 ✗</span>'
      + '</div></div></div>';
  }
  /* ── 阅读：交互 ────────────────────────────────────────────────────────── */
  function rdSave() { saveStore(); }
  function rdPickBook(id) { RD_UI.sel = id; STORE.bookSel = id; render(); }
  function rdAddBook() {
    const title = prompt('书名：', '');
    if (!title || !title.trim()) return;
    const author = prompt('作者（可留空）：', '') || '';
    const id = 'b' + Date.now();
    STORE.books = ((STORE && STORE.books) || []).concat([{
      id, title: title.trim(), author: author.trim(), cover: '', src: 'paper',
      status: 'want', prog: 0, rating: 0, tags: [], pages: 0, at: Date.now(), edit: Date.now(),
    }]);
    RD_UI.sel = id; STORE.bookSel = id;
    rdSave(); render();
  }
  function rdSetProg(p) {
    const b = rdCurrent(); if (!b) return;
    const v = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
    b.prog = v; b.edit = Date.now();
    if (v >= 100 && b.status !== 'done') { b.status = 'done'; b.doneAt = dayKey(new Date()); }
    else if (v > 0 && v < 100 && b.status === 'want') { b.status = 'reading'; b.startAt = b.startAt || dayKey(new Date()); }
    else if (v === 0 && b.status === 'done') { b.status = 'reading'; b.doneAt = ''; }
    rdSave(); render();
  }
  function rdSetStatus(k) {
    const b = rdCurrent(); if (!b) return;
    b.status = k; b.edit = Date.now();
    if (k === 'reading' && !b.startAt) b.startAt = dayKey(new Date());
    if (k === 'done') { b.doneAt = dayKey(new Date()); b.prog = 100; }
    rdSave(); render();
  }
  function rdSetSrc(k) { const b = rdCurrent(); if (!b) return; b.src = k; b.edit = Date.now(); rdSave(); render(); }
  function rdSetRating(r) { const b = rdCurrent(); if (!b) return; b.rating = (Number(b.rating) === r ? 0 : r); b.edit = Date.now(); rdSave(); render(); }
  function rdDelBook() {
    const b = rdCurrent(); if (!b) return;
    if (!confirm('删掉《' + b.title + '》？它的 ' + bookNotesOf(b.id).length + ' 条笔记也会一起删掉，不能撤销。')) return;
    STORE.books = ((STORE && STORE.books) || []).filter((x) => x.id !== b.id);
    STORE.bookNotes = ((STORE && STORE.bookNotes) || []).filter((x) => x.bookId !== b.id);
    RD_UI.sel = ''; STORE.bookSel = '';
    rdSave(); render();
  }
  function rdAddNote(kind) {
    const b = rdCurrent(); if (!b) return;
    const ta = document.getElementById('lw-rd-notetx');
    const text = String((ta && ta.value) || '').trim();
    if (!text) { rdToast('先写点什么再存 ✓'); return; }
    STORE.bookNotes = ((STORE && STORE.bookNotes) || []).concat([{
      id: 'n' + Date.now(), bookId: b.id, kind: kind === 'idea' ? 'idea' : 'quote', text, loc: '', at: Date.now(),
    }]);
    b.edit = Date.now();
    rdSave(); render();
  }
  function rdDelNote(id) {
    STORE.bookNotes = ((STORE && STORE.bookNotes) || []).filter((x) => x.id !== id);
    rdSave(); render();
  }
  function rdLog(min, pages) {
    const b = rdCurrent(); if (!b) return;
    const m = Math.max(1, Math.min(1440, Math.round(Number(min) || 0)));
    if (!m) { rdToast('先填分钟数 ✓'); return; }
    const p = Math.max(0, Math.min(9999, Math.round(Number(pages) || 0)));
    STORE.readLog = ((STORE && STORE.readLog) || []).concat([{
      id: 'r' + Date.now(), date: dayKey(new Date()), bookId: b.id, min: m, pages: p, at: Date.now(),
    }]);
    b.edit = Date.now();
    rdSave(); render();
    rdToast('记下了：' + m + ' 分钟' + (p ? ' · ' + p + ' 页' : '') + ' ✓');
  }
  function rdUndoTodayLog() {
    const b = rdCurrent(); if (!b) return;
    const k = dayKey(new Date());
    const before = ((STORE && STORE.readLog) || []).length;
    STORE.readLog = ((STORE && STORE.readLog) || []).filter((x) => !(x.bookId === b.id && x.date === k));
    if (((STORE.readLog || []).length) === before) { rdToast('今天还没记过 ✓'); return; }
    rdSave(); render();
    rdToast('已撤掉今天的记录 ✓');
  }
  function rdToast(msg) {
    /* 复用顶栏状态栏 ✓（它会自己过期 ✓，整屏 render 也不会把它冲掉 ✓）*/
    setStatus(esc(msg), 5000);
  }
  function rdDoImport() {
    const pv = RD_UI.impPv;
    if (!pv || !pv.length) return;
    let added = 0, merged = 0, notes = 0;
    pv.forEach((nb) => {
      let b = ((STORE && STORE.books) || []).find((x) => x && x.title === nb.title);
      if (b) merged++;
      else {
        b = { id: 'b' + Date.now() + Math.random().toString(36).slice(2, 6), title: nb.title, author: nb.author, cover: '', src: 'weread', status: 'reading', prog: 0, rating: 0, tags: [], pages: 0, startAt: dayKey(new Date()), at: Date.now(), edit: Date.now() };
        STORE.books = ((STORE && STORE.books) || []).concat([b]);
        added++;
      }
      if (nb.author && !b.author) b.author = nb.author;
      b.edit = Date.now();
      const exist = new Set(bookNotesOf(b.id).map((n) => String(n.text)));
      nb.notes.forEach((n) => {
        if (!n.text || exist.has(n.text)) return;      /* 同一条划线不重复导入 ✓ */
        exist.add(n.text);
        STORE.bookNotes = ((STORE && STORE.bookNotes) || []).concat([{
          id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6), bookId: b.id, kind: n.kind, text: n.text, loc: n.loc || '', at: Date.now(),
        }]);
        notes++;
      });
      RD_UI.sel = b.id; STORE.bookSel = b.id;
    });
    RD_UI.impOpen = false; RD_UI.impText = ''; RD_UI.impPv = null;
    rdSave(); render();
    rdToast('导入完成：新增 ' + added + ' 本' + (merged ? ' · 合并 ' + merged + ' 本' : '') + ' · ' + notes + ' 条笔记 ✓');
  }
  /* ══════════════════════════════════════════════════════════════════════
     微信读书「连接」✓ —— 用户原话：
     「这个没有接入微信读书，可以实现读取微信读书里面的书」
     ⚠️ 以前是一个 `prompt()` ✗ —— 那个连「怎么拿 Cookie」都写不下 ✗，
        用户只会一脸茫然 ✗（他截图来问的就是这个 ✗）。改成正经面板 ✓。
     ⚠️ 实测过（这台机器上 ✓）：`weread.qq.com/web/shelf/sync` 是**活的** ✓，
        不带 Cookie 会明确回 `{"errCode":-2010,"errMsg":"用户不存在"}` ✓ ——
        所以**唯一缺的就是一个登录身份** ✓，别的都是通的 ✓。
     ══════════════════════════════════════════════════════════════════════ */
  const rdWrOn = () => !!String((STORE && STORE.wereadCookie) || '').trim();
  /* ★ 用户十有八九会把「Cookie: 」这个前缀一起复制进来 ✗（从 DevTools 整行复制的 ✓）——
     那就**帮他剥掉** ✓，别让他自己猜哪儿多复制了 ✗。顺带收拾换行 / 首尾引号 ✓。 */
  function rdWrClean(t) {
    return String(t == null ? '' : t)
      .replace(/^\s*cookie\s*[:：]\s*/i, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/^\s*["']+|["']+\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  /* 本地先判一道 ✓ —— 明显不是 Cookie 的别白跑一趟网络 ✓（省时间，提示也更准 ✓）。 */
  function rdWrLocalCheck(t) {
    if (!t) return '还没粘 Cookie';
    if (t.length > 8000) return '太长了 —— 多半把整个请求头都复制进来了，只要 Cookie 那一行';
    if (t.indexOf('=') < 0) return '看起来不是 Cookie。它应该长这样：wr_vid=1234567; wr_skey=abcdefg';
    return '';
  }
  function rdWrConnOpen() {
    RD_UI.connOpen = true; RD_UI.connMsg = ''; RD_UI.connOk = false;
    RD_UI.connText = RD_UI.connText || String((STORE && STORE.wereadCookie) || '');
    render();
  }
  /* silent = 进页面时的**自动**同步 ✓ —— 不弹面板、不打扰 ✓，只在顶栏说一声 ✓。 */
  async function rdSyncWeread(silent) {
    if (RD_UI.connBusy) return;
    const cookie = rdWrClean(RD_UI.connText || (STORE && STORE.wereadCookie) || '');
    if (!cookie) {
      if (!silent) { RD_UI.connOpen = true; RD_UI.connMsg = '还没连接微信读书 —— 先按下面四步把 Cookie 粘进来'; RD_UI.connOk = false; render(); }
      return;
    }
    const bad = rdWrLocalCheck(cookie);
    if (bad) { RD_UI.connOpen = true; RD_UI.connMsg = bad; RD_UI.connOk = false; render(); return; }
    RD_UI.connBusy = true;
    if (!silent) { RD_UI.connMsg = '正在连微信读书…'; RD_UI.connOk = false; render(); }
    try {
      const r = await fetch('/api/life/weread/shelf', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cookie }),
      });
      const d = await r.json();
      if (!d || !d.ok) {
        RD_UI.connBusy = false;
        const msg = (d && d.error) || '未知错误';
        if (silent) rdToast('✗ 微信读书自动同步失败：' + msg);
        else { RD_UI.connMsg = '✗ ' + msg; RD_UI.connOk = false; render(); }
        return;
      }
      /* ★★ 合并策略：同名书**更新**进度 / 作者 / 封面 ✓，不是跳过 ✗ ——
         同步的意义就在「把阅读进度带回来」✗；跳过的话等于白同步 ✗
         （第一版就是跳过的 ✗，用户同步完发现进度没变 ✗）。 */
      let added = 0, updated = 0;
      (d.books || []).forEach((nb) => {
        if (!nb || !nb.title) return;
        const t = String(nb.title).trim();
        const p = Math.max(0, Math.min(100, Number(nb.prog) || 0));
        const hit = ((STORE && STORE.books) || []).find((x) => x && String(x.title).trim() === t);
        if (hit) {
          let ch = false;
          if (nb.author && hit.author !== nb.author) { hit.author = nb.author; ch = true; }
          if (nb.cover && hit.cover !== nb.cover) { hit.cover = nb.cover; ch = true; }
          if (hit.src !== 'weread') { hit.src = 'weread'; ch = true; }
          if (p > 0 && Number(hit.prog) !== p) { hit.prog = p; ch = true; }
          if (p >= 100 && hit.status !== 'done') { hit.status = 'done'; hit.doneAt = hit.doneAt || dayKey(new Date()); ch = true; }
          else if (p > 0 && p < 100 && hit.status === 'want') { hit.status = 'reading'; hit.startAt = hit.startAt || dayKey(new Date()); ch = true; }
          hit.wereadAt = Date.now();
          if (ch) { hit.edit = Date.now(); updated++; }
          return;
        }
        STORE.books = ((STORE && STORE.books) || []).concat([{
          id: 'b' + Date.now() + Math.random().toString(36).slice(2, 6), title: t, author: nb.author || '',
          cover: nb.cover || '', src: 'weread', status: p >= 100 ? 'done' : 'reading', prog: p,
          rating: 0, tags: [], pages: 0, startAt: dayKey(new Date()), at: Date.now(), edit: Date.now(),
          wereadAt: Date.now(),
        }]);
        added++;
      });
      STORE.wereadCookie = cookie;
      STORE.wereadSyncAt = Date.now();
      STORE.wereadCount = (d.books || []).length;
      RD_UI.connBusy = false;
      rdSave(); render();
      const msg = '✓ 同步成功：书架 ' + (d.books || []).length + ' 本 · 新增 ' + added + ' 本'
        + (updated ? ' · 更新 ' + updated + ' 本' : '');
      if (silent) rdToast(msg);
      else { RD_UI.connMsg = msg; RD_UI.connOk = true; render(); }
    } catch (e) {
      RD_UI.connBusy = false;
      const msg = /Failed to fetch|NetworkError/i.test(String(e.message)) ? '连不上本机服务（CodeScope 还开着吗？）' : e.message;
      if (silent) rdToast('✗ 微信读书自动同步失败：' + msg);
      else { RD_UI.connMsg = '✗ ' + msg; RD_UI.connOk = false; render(); }
    }
  }
  function rdWrConnHtml() {
    const on = rdWrOn();
    const at = Number((STORE && STORE.wereadSyncAt) || 0);
    const n = Number((STORE && STORE.wereadCount) || 0);
    const status = on
      ? '<b style="color:' + T.ok + '">已连接</b>'
        + (at ? ' · 上次同步 ' + esc(new Date(at).toLocaleString('zh-CN', { hour12: false })) : ' · 还没同步过')
        + (n ? ' · 上次拿到 ' + n + ' 本' : '')
      : '<b style="color:' + T.faint + '">还没连接</b>';
    const msgCls = RD_UI.connMsg ? (RD_UI.connOk ? ' ok' : (/^✓/.test(RD_UI.connMsg) ? ' ok' : ' err')) : '';
    return '<div class="lw-imp" id="lw-wrc"><div class="box">'
      + '<div class="hd"><b>📗 微信读书</b><span class="x" id="lw-wrc-x">✕</span></div>'
      + '<div class="bd">'
      + '<div class="tip">'
      + '微信读书<b>没有对外的公开接口</b>，所以只能借用你浏览器里的登录身份（Cookie）。<br>'
      + '它只存在<b>你自己这台机器</b>上，也<b>只会发给 weread.qq.com</b> —— 不会去别的地方。<br>'
      + '<span style="color:' + T.faint + '">（实测：它的书架接口是活的，不带 Cookie 时会明确回「用户不存在」，'
      + '所以缺的就是这个登录身份，别的都通。）</span>'
      + '</div>'
      + '<div class="steps">'
      + '<div class="h">怎么拿 —— 约 30 秒</div>'
      + '<ol>'
      + '<li>浏览器打开 <code>weread.qq.com</code>，确认<b>已经登录</b>（右上角是你的头像）</li>'
      + '<li>按 <code>F12</code> 打开开发者工具，切到「<b>网络 / Network</b>」</li>'
      + '<li>刷新一下页面，点左边任意一条 <code>weread.qq.com</code> 的请求</li>'
      + '<li>在「<b>标头 / Headers</b>」里找到「请求标头」下的 <code>Cookie:</code> 那一行，'
      + '把<b>冒号后面整行</b>复制下来（<b>越长越好</b>，别只挑一两个）</li>'
      + '</ol>'
      + '<div class="n">⚠️ 整行复制没关系 —— 前面的 <code>Cookie:</code> 我们会自动去掉。<br>'
      + '⚠️ 如果复制出来的里面<b>没有</b> <code>wr_vid</code> / <code>wr_skey</code>，'
      + '说明网页版还没登录，先登录再复制。</div>'
      + '</div>'
      + '<textarea id="lw-wrc-tx" spellcheck="false" placeholder="wr_vid=1234567; wr_skey=AbCdEfGh...; wr_rt=...; wr_localvid=...">' + esc(RD_UI.connText) + '</textarea>'
      + '<div class="st' + msgCls + '" id="lw-wrc-st">' + (RD_UI.connMsg ? esc(RD_UI.connMsg) : '') + '</div>'
      + '<div class="st2">状态：' + status + '</div>'
      + '</div>'
      + '<div class="ft">'
      + '<button class="pri" id="lw-wrc-go"' + (RD_UI.connBusy ? ' disabled' : '') + '>'
      + (RD_UI.connBusy ? '正在连…' : (on ? '🔄 重新同步' : '🔗 连接并同步')) + '</button>'
      + (on ? '<button id="lw-wrc-off">断开连接</button>' : '')
      + '<span style="font-size:10px;color:' + T.faint + ';margin-left:auto">非官方接口 ✓ 可能随时失效 ✗</span>'
      + '</div></div></div>';
  }
  function bindReading() {
    const host = document.getElementById('lifework-view');
    /* ⚠️ 离开阅读页签要把朗读**停掉** ✗ —— 不然切到邮箱还在念英文 ✗，很吓人 ✗。 */
    if (!host || TAB !== 'reading') { spkStop(); return; }
    bindPaneGrips(host, [
      { which: 'side', target: '.lw-rd-side', min: 150, max: 420, key: 'bookSideW' },
      { which: 'list', target: '.lw-rd-list', min: 260, max: 760, key: 'bookListW' },
    ]);
    const q = (s) => host.querySelector(s);
    const qa = (s) => Array.from(host.querySelectorAll(s));
    qa('[data-rdst]').forEach((el) => { el.onclick = () => { RD_UI.status = el.dataset.rdst; render(); }; });
    qa('[data-rdsrc]').forEach((el) => { el.onclick = () => { RD_UI.src = el.dataset.rdsrc; render(); }; });
    qa('[data-rdtag]').forEach((el) => { el.onclick = () => { RD_UI.tag = el.dataset.rdtag; render(); }; });
    qa('[data-rdbk]').forEach((el) => { el.onclick = () => rdPickBook(el.dataset.rdbk); });
    qa('[data-rdset]').forEach((el) => { el.onclick = () => rdSetStatus(el.dataset.rdset); });
    qa('[data-rdsrcset]').forEach((el) => { el.onclick = () => rdSetSrc(el.dataset.rdsrcset); });
    qa('[data-rdrate]').forEach((el) => { el.onclick = () => rdSetRating(Number(el.dataset.rdrate)); });
    qa('[data-rdprog]').forEach((el) => {
      el.onclick = () => { const b = rdCurrent(); if (!b) return; rdSetProg(Number(el.dataset.rdprog) === 0 ? 0 : (Number(b.prog) || 0) + Number(el.dataset.rdprog)); };
    });
    const set = q('#lw-rd-progok');
    if (set) set.onclick = () => { const i = q('#lw-rd-progset'); rdSetProg(i ? i.value : 0); };
    const track = q('#lw-rd-track');
    if (track) track.onclick = (ev) => {
      const r = track.getBoundingClientRect();
      rdSetProg(Math.round(((ev.clientX - r.left) / Math.max(1, r.width)) * 100));
    };
    const log = q('#lw-rd-log');
    if (log) log.onclick = () => { const m = q('#lw-rd-min'), p = q('#lw-rd-pg'); rdLog(m ? m.value : 0, p ? p.value : 0); };
    const ldel = q('#lw-rd-logdel');
    if (ldel) ldel.onclick = () => rdUndoTodayLog();
    const nq = q('#lw-rd-notequote'); if (nq) nq.onclick = () => rdAddNote('quote');
    const ni = q('#lw-rd-noteidea'); if (ni) ni.onclick = () => rdAddNote('idea');
    const ntx = q('#lw-rd-notetx');
    if (ntx) ntx.onkeydown = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); rdAddNote('quote'); } };
    qa('[data-rdnotedel]').forEach((el) => { el.onclick = (ev) => { ev.stopPropagation(); rdDelNote(el.dataset.rdnotedel); }; });
    const del = q('#lw-rd-del'); if (del) del.onclick = () => rdDelBook();
    const add = q('#lw-rd-add'); if (add) add.onclick = () => rdAddBook();
    /* 🔗 还没连接 → 打开连接面板 ✓；📗 已连接 → 直接同步 ✓（点一下就用 ✓） */
    const sync = q('#lw-rd-sync');
    if (sync) sync.onclick = () => { if (rdWrOn()) rdSyncWeread(false); else rdWrConnOpen(); };
    const imp = q('#lw-rd-imp'); if (imp) imp.onclick = () => { RD_UI.impOpen = true; RD_UI.impPv = null; render(); };
    const qq = q('#lw-rd-q');
    if (qq) qq.oninput = () => {
      /* 只改列表显隐 ✓，不整屏重绘 ✗（否则每敲一个字输入框就失焦 ✗）*/
      RD_UI.q = qq.value;
      const needle = qq.value.trim().toLowerCase();
      qa('.lw-bk').forEach((el) => {
        const b = bookById(el.dataset.rdbk);
        const hay = b ? (String(b.title || '') + ' ' + String(b.author || '')).toLowerCase() : '';
        el.style.display = (!needle || hay.indexOf(needle) >= 0) ? '' : 'none';
      });
    };
    /* 导入浮层 ✓ */
    const ix = q('#lw-imp-x'); if (ix) ix.onclick = () => { RD_UI.impOpen = false; render(); };
    const itx = q('#lw-imp-tx');
    if (itx) itx.oninput = () => { RD_UI.impText = itx.value; };
    const ipv = q('#lw-imp-preview');
    if (ipv) ipv.onclick = () => {
      const ta = q('#lw-imp-tx');
      RD_UI.impText = ta ? ta.value : RD_UI.impText;
      RD_UI.impPv = parseWeread(RD_UI.impText);
      render();
    };
    const ido = q('#lw-imp-do'); if (ido) ido.onclick = () => rdDoImport();
    /* ── 微信读书「连接」浮层 ✓ ───────────────────────────────────────────── */
    const wx = q('#lw-wrc-x'); if (wx) wx.onclick = () => { RD_UI.connOpen = false; render(); };
    const wtx = q('#lw-wrc-tx'); if (wtx) wtx.oninput = () => { RD_UI.connText = wtx.value; };
    const wgo = q('#lw-wrc-go'); if (wgo) wgo.onclick = () => rdSyncWeread(false);
    const woff = q('#lw-wrc-off');
    if (woff) woff.onclick = () => {
      if (!confirm('断开微信读书？\n\n已经同步进来的书会保留，只是以后不再自动更新。')) return;
      STORE.wereadCookie = ''; STORE.wereadSyncAt = 0; STORE.wereadCount = 0;
      RD_UI.connText = ''; RD_UI.connMsg = '已断开 ✓'; RD_UI.connOk = true;
      rdSave(); render();
    };
    /* ★ 进页面时**静默**补一次 ✓ —— 已连接 + 上次同步超过 6 小时才拉 ✓。
       ⚠️ 必须有两道闸 ✗✗（少一道就会出问题 ✗，`bindReading()` 每次 render 都跑 ✗）：
          ① `connBusy` 防重入 ✓；
          ② `autoAt` 十分钟冷却 ✓ —— **不能只看 wereadSyncAt** ✗：
             同步**失败**时不写 wereadSyncAt ✗，只看它的话会**每次 render 都重试** ✗
             （实测会疯狂打微信读书 ✗）。 */
    if (rdWrOn() && !RD_UI.connBusy
        && Date.now() - (RD_UI.autoAt || 0) > 10 * 60 * 1000
        && Date.now() - (Number(STORE.wereadSyncAt) || 0) > 6 * 3600 * 1000) {
      RD_UI.autoAt = Date.now();
      rdSyncWeread(true);
    }
    /* 外刊精读 / 生词本的交互 ✓（它自己判模式 ✓，不在那两个模式里就直接返回 ✓） */
    bindEnglish();
  }

  /* ══════════════════════════════════════════════════════════════════════
     外刊精读 + 生词本 ✓（阅读模块的两个子模式 ✓）
     用户原话：「还需要加入外刊精读，用于阅读和学习英语，你来设计，该有的单词记忆，
     管理等等，都需要有，可以参考网上成熟的体系，包括什么遗忘曲线等等，
     记得加入语音读法等」。

     ★ 设计（照成熟体系来 ✓，不自己发明 ✗）
       ① **精读的最小单位是句子** ✓ —— 逐句朗读 ✓、逐句划词 ✓、逐句标「已懂」✓。
          这是所有精读教材的做法 ✓（整篇灌下去记不住 ✗）。
       ② 生词**自动进记忆系统** ✓：艾宾浩斯遗忘曲线 → 简化 SM-2 ✓
          （算法在 lib/srs.js ✓ 纯函数 ✓，单测里把时间推着走 ✓）。
       ③ 复习时四个按钮上**直接写下次间隔** ✓（「忘了 · 10 分钟」「记得 · 15 天」✓）——
          遗忘曲线本身是看不见的 ✗，但这么一写，用户一眼就懂这套系统在干嘛 ✓。
       ④ 语音用浏览器**自带的** Web Speech API ✓ —— 零依赖 ✓、零流量 ✓、零 key ✓。
       ⑤ 文章两条来源 ✓：贴链接（服务端抽正文 ✓）/ 贴正文（一定可用 ✓）。

     ⚠️ 纯逻辑**绝不在前端重抄** ✗ —— 分句 / 洗词走 lib/en-text.js ✓、
        复习间隔走 lib/srs.js ✓（两个都是**双栖**模块 ✓，见它们末尾 ✓）。
        抄两遍必然走偏 ✗，而且走偏了用户查不出来 ✗。
     ══════════════════════════════════════════════════════════════════════ */

  /* ── 数据 ✓ ─────────────────────────────────────────────────────────────
     STORE.articles = [{ id, title, site, url, text, level, at, edit, done: { 句子序号: 1 } }]
     STORE.words    = [{ id, w, ph, def, eg, artId, artTitle, at, edit, ef, step, reps, lapses, ivl, due, hist }]
     STORE.artNotes = [{ id, artId, sent, text, at }]
     ⚠️ 全用 **function 声明** ✗（不用 const 箭头 ✗）：箭头有 TDZ ✗，
        而 render 可能在模块求值期间就跑到阅读页签 ✗（见顶部那条铁律 ✓）。 */
  function epArts() { return ((STORE && STORE.articles) || []).filter(Boolean); }
  function epWords() { return ((STORE && STORE.words) || []).filter(Boolean); }
  function epArtById(id) { return epArts().find((a) => a && a.id === id) || null; }
  /* ★ 当前文章：`EP_UI.art`（内存 ✓）→ `STORE.epArt`（落盘 ✓）→ **最近编辑的那篇**（兜底 ✓）。
     最后那层兜底很关键 ✗：不兜的话，切出去再回来 / 刷新一下，
     正文区永远是「← 从中间选一篇文章」✗，用户会以为文章没了 ✗。 */
  function epCurArt() {
    const hit = epArtById(EP_UI.art || String((STORE && STORE.epArt) || ''));
    if (hit) return hit;
    return epArts().slice().sort((a, b) => (Number(b.edit) || 0) - (Number(a.edit) || 0))[0] || null;
  }
  function epPickArt(id) {
    EP_UI.art = id; if (STORE) STORE.epArt = id;
    EP_UI.sel = -1; EP_UI.pick = '';
    spkStop(); epSave(); render();
  }
  function epWordOf(w) { return epWords().find((x) => x && x.w === w) || null; }
  function epWordById(id) { return epWords().find((x) => x && x.id === id) || null; }
  function epNotesOf(id) { return ((STORE && STORE.artNotes) || []).filter((n) => n && n.artId === id); }
  function epSave() { saveStore(); }
  function epMode() {
    const m = EP_UI.mode || String((STORE && STORE.readMode) || '') || 'shelf';
    return (m === 'ex' || m === 'word') ? m : 'shelf';
  }
  function epSetMode(m) {
    EP_UI.mode = m; if (STORE) STORE.readMode = m;
    EP_UI.sel = -1; EP_UI.pick = '';
    spkStop(); epSave(); render();
  }
  /* 分句结果缓存 ✓ —— 每次渲染都重切一遍纯属浪费 ✗。
     ⚠️ key 里带上**正文长度** ✗：正文一改（重新导入 ✓）key 就变了 ✓，自动失效 ✓。
     ⚠️ 只放内存 ✗（落盘会让 STORE 白胖一圈 ✗）。 */
  function epSents(a) {
    if (!a || !EN) return [];
    const key = String(a.text || '');
    const hit = EP_SENTS.get(a.id);
    if (hit && hit.key === key) return hit.list;
    const list = EN.splitSentences(key);
    EP_SENTS.set(a.id, { key, list });
    /* ⚠️ 缓存别无限长 ✗（Map 留 30 篇够了 ✓，超了丢最早那个 ✓） */
    if (EP_SENTS.size > 30) EP_SENTS.delete(EP_SENTS.keys().next().value);
    return list;
  }
  function epDoneOf(a) { return Object.keys((a && a.done) || {}).length; }
  function epArtProg(a) {
    const n = epSents(a).length;
    return n ? Math.round((epDoneOf(a) / n) * 100) : 0;
  }
  function epWordsOfArt(id) { return epWords().filter((w) => w && w.artId === id); }

  /* ══ 朗读 ✓（浏览器自带的 Web Speech API ✓）══════════════════════════════
     ⚠️⚠️ 两个必踩的坑 ✗✗：
       ① `getVoices()` **第一次经常返回空数组** ✗ —— 得等 `voiceschanged` ✓。
          不处理的话用户看到的是一个**空的音色下拉框** ✗，以为功能坏了 ✗。
       ② 长文本一次性丢给 `speak()` 在 Chrome 上**会被截断** ✗ ——
          所以按句子切成小块排队 ✓（正好我们本来就有句子 ✓）。
     ⚠️ 朗读必须**能在离开页签时停掉** ✗ —— 不然切到邮箱还在念 ✗，很吓人 ✗。 */
  function spkOK() {
    return typeof window !== 'undefined' && !!window.speechSynthesis
      && typeof window.SpeechSynthesisUtterance === 'function';
  }
  function spkLoadVoices() {
    if (!spkOK()) return [];
    let all = [];
    try { all = window.speechSynthesis.getVoices() || []; } catch (_) { all = []; }
    const en = all.filter((v) => /^en([-_]|$)/i.test(String(v.lang || '')));
    SPK.voices = en.length ? en : all;      /* 一个英文音色都没有时，别的也先列出来 ✓ */
    if (SPK.voices.length) SPK.loaded = true;
    return SPK.voices;
  }
  function spkInit() {
    if (!spkOK() || SPK.loaded || SPK.listening) return;
    spkLoadVoices();
    if (SPK.voices.length) return;
    /* ⚠️⚠️ 这个监听**只能挂一次** ✗✗ —— `spkInit()` 每次渲染都会被调到 ✓，
       而回调里又要 `render()` ✓ → 不设闸的话就是**渲染 → 挂监听 → 事件 → 渲染**的死循环 ✗，
       实测直接把浏览器跑崩 ✗（报 `Target page … has been closed` ✗，特别难查 ✗）。 */
    SPK.listening = true;
    try {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        if (spkLoadVoices().length && TAB === 'reading') render();   /* 音色到位了重画一次 ✓ */
      });
    } catch (_) { SPK.listening = false; }
  }
  function spkPick() {
    if (!SPK.voices.length) spkLoadVoices();
    const want = String((STORE && STORE.epVoice) || '');
    if (want) {
      const h = SPK.voices.find((v) => v.voiceURI === want || v.name === want);
      if (h) return h;
    }
    /* 优先美音 ✓ → 英音 ✓ → 任意英文 ✓ —— 学英语默认美音更常见 ✓ */
    return SPK.voices.find((v) => /^en[-_]US/i.test(v.lang))
      || SPK.voices.find((v) => /^en[-_]GB/i.test(v.lang))
      || SPK.voices.find((v) => /^en/i.test(v.lang))
      || SPK.voices[0] || null;
  }
  function spkRate() {
    const r = Number((STORE && STORE.epRate) || 1);
    return r >= 0.5 && r <= 1.5 ? r : 1;
  }
  function spkStop() {
    try { if (spkOK()) window.speechSynthesis.cancel(); } catch (_) {}
    SPK.seq++; SPK.speaking = false;
    const host = document.getElementById('lifework-view');
    if (host) host.querySelectorAll('.lw-ep-s.hl').forEach((el) => el.classList.remove('hl'));
  }
  /* parts 可以是一段（读单词 ✓）或多段（读整篇 ✓）—— 多段就是排队逐句念 ✓ */
  function spkSay(parts, opts) {
    const list = (Array.isArray(parts) ? parts : [parts])
      .map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
    if (!list.length) return false;
    if (!spkOK()) {
      rdToast('这个浏览器没有语音合成 —— 换 Chrome / Edge / Safari 再试');
      return false;
    }
    spkStop();
    const my = SPK.seq;
    const v = spkPick();
    const rate = Math.max(0.5, Math.min(1.5, Number((opts && opts.rate) || spkRate()) || 1));
    SPK.speaking = true;
    list.forEach((txt, i) => {
      let u;
      try { u = new window.SpeechSynthesisUtterance(txt); } catch (_) { return; }
      u.lang = (v && v.lang) || 'en-US';
      if (v) { try { u.voice = v; } catch (_) {} }
      u.rate = rate;
      u.onstart = () => { if (SPK.seq === my && opts && opts.onPart) opts.onPart(i); };
      u.onerror = () => { if (SPK.seq === my) SPK.speaking = false; };
      if (i === list.length - 1) {
        u.onend = () => { if (SPK.seq === my) { SPK.speaking = false; if (opts && opts.onEnd) opts.onEnd(); } };
      }
      try { window.speechSynthesis.speak(u); } catch (_) {}
    });
    return true;
  }
  /* 朗读时**只改那一个 class** ✓ —— 不整屏 render ✗（重绘会把滚动位置丢掉 ✗，
     读到第 40 句时视图跳回顶部 ✗，根本没法跟读 ✗）。 */
  function spkHighlight(i) {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    host.querySelectorAll('.lw-ep-s.hl').forEach((el) => el.classList.remove('hl'));
    const el = host.querySelector('[data-epsent="' + i + '"]');
    if (el) {
      el.classList.add('hl');
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    }
  }

  /* ══ 模式条 ✓（书架 / 外刊精读 / 生词本）════════════════════════════════ */
  function epModeTip() {
    const m = epMode();
    if (m === 'ex') return '点句子选中 · 选中后划词就能加生词 · 右键？不，用「🔊」听';
    if (m === 'word') return '按遗忘曲线排期 · 到期的先复习';
    return '手动加书 / 导入微信读书笔记 / 同步微信读书书架';
  }
  function epModeBar() {
    const nArt = epArts().length, nWord = epWords().length;
    const due = SRS ? SRS.dueCards(epWords(), Date.now()).length : 0;
    const seg = (k, label, n, tail) => '<span class="seg' + (epMode() === k ? ' on' : '') + '" data-rdmode="' + k + '">'
      + label + (n ? ' <i>' + n + '</i>' : '') + (tail || '') + '</span>';
    return '<div class="lw-rd-modes">'
      + seg('shelf', '📚 书架', 0)
      + seg('ex', '📰 外刊精读', nArt)
      + seg('word', '🔤 生词本', nWord, due ? ' <i style="color:' + T.warn + '">' + due + ' 待复习</i>' : '')
      + '<span class="sp"></span>'
      + '<span class="tip">' + esc(epModeTip()) + '</span>'
      + '</div>';
  }
  /* 共享模块没加载上时的兜底 ✓ —— 宁可说清「为什么用不了」✗，也不要整块白屏 ✗ */
  function epNoLib() {
    return '<div class="lw-rd-empty" style="margin:auto;max-width:420px">'
      + '外刊精读要用到的共享模块没加载上 ✗<br>'
      + '<span style="color:' + T.faint + '">（/lib/en-text.js 和 /lib/srs.js）—— '
      + '硬刷新一下（⌘⇧R）试试；还不行说明服务端没重启过。</span></div>';
  }

  /* ══ 外刊精读：三栏 ✓ ══════════════════════════════════════════════════ */
  function epSideHtml() {
    const arts = epArts(), ws = epWords();
    const st = SRS ? SRS.stats(ws, Date.now()) : { total: ws.length, due: 0, fresh: 0, learning: 0, young: 0, mature: 0, retention: 0, retentionN: 0 };
    const doneN = arts.filter((a) => epArtProg(a) >= 100).length;
    const words = arts.reduce((n, a) => n + (Number(a.words) || 0), 0);
    const flt = (k, label, n) => '<div class="lw-rd-row' + (EP_UI.wordFilter === k ? ' on' : '') + '" data-epflt="' + k + '">'
      + '<span class="em">▣</span>' + label + '<span class="n">' + n + '</span></div>';
    return '<div class="lw-rd-hd">精读统计</div>'
      + '<div class="lw-rd-stat">'
      + '<div><b>' + arts.length + '</b><span>篇文章</span></div>'
      + '<div><b>' + doneN + '</b><span>已精读</span></div>'
      + '<div><b>' + words + '</b><span>总词数</span></div>'
      + '<div><b>' + st.total + '</b><span>生词</span></div>'
      + '</div>'
      + '<div class="lw-rd-hd">生词状态</div>'
      + flt('all', '全部', st.total)
      + flt('due', '⏰ 该复习了', st.due)
      + flt('fresh', '新词', st.fresh)
      + flt('learning', '学习中', st.learning)
      + flt('mature', '已掌握', st.mature)
      + '<div class="lw-rd-hd">朗读</div>'
      + epSpkHtml()
      + '<div class="lw-rd-hd">怎么用</div>'
      + '<div class="lw-ep-tip">'
      + '① 上面「＋ 导入文章」贴链接或正文<br>'
      + '② 中间点一句话 → 右边出现这句<br>'
      + '③ 用鼠标「划」一个词 → 右边自动填上 → 回车加进生词本<br>'
      + '④ 切到「生词本」按遗忘曲线复习<br>'
      + '<span style="color:' + T.faint + '">（划词：按住鼠标左键拖过单词再松手）</span>'
      + '</div>';
  }
  function epSpkHtml() {
    if (!spkOK()) {
      return '<div class="lw-ep-tip">这个浏览器没有语音合成 ✗<br>'
        + '<span style="color:' + T.faint + '">换 Chrome / Edge / Safari 就有朗读了</span></div>';
    }
    spkInit();
    const cur = String((STORE && STORE.epVoice) || '');
    const rate = spkRate();
    const opts = SPK.voices.map((v) => '<option value="' + esc(v.voiceURI || v.name) + '"'
      + ((cur ? cur === (v.voiceURI || v.name) : false) ? ' selected' : '') + '>'
      + esc(String(v.name || '') + ' · ' + String(v.lang || '')) + '</option>').join('');
    return '<div class="lw-spk" style="padding:0 14px">'
      + '<span class="lb">音色</span>'
      + '<select id="lw-ep-voice" style="flex:1">'
      + (opts || '<option value="">（还没检测到音色）</option>')
      + '</select></div>'
      + '<div class="lw-spk" style="padding:6px 14px 0">'
      + '<span class="lb">语速</span>'
      + '<input id="lw-ep-rate" type="range" min="0.5" max="1.5" step="0.1" value="' + rate + '" style="flex:1;padding:0;border:0;background:transparent;height:20px"/>'
      + '<span class="lb" id="lw-ep-ratev">' + rate.toFixed(1) + '×</span></div>'
      + '<div class="lw-ep-tip">' + (SPK.voices.length
        ? SPK.voices.length + ' 个可用音色'
        : '还没检测到音色 —— 点一下页面任意处再看（浏览器是异步给的）') + '</div>';
  }
  function epArtListHtml() {
    const q = String(EP_UI.q || '').trim().toLowerCase();
    const list = epArts().filter((a) => {
      if (q && (String(a.title || '') + ' ' + String(a.site || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort((a, b) => (Number(b.edit) || 0) - (Number(a.edit) || 0));
    const tools = '<div class="lw-rd-tools">'
      + '<input id="lw-ep-q" placeholder="搜索标题 / 来源…" value="' + esc(EP_UI.q) + '"/>'
      + '<button id="lw-ep-imp" title="贴链接或正文，导入一篇外刊">＋ 导入文章</button>'
      + '</div>';
    if (!list.length) {
      return tools + '<div class="lw-rd-empty">还没有文章<br>'
        + '<span style="color:' + T.faint + '">点「＋ 导入文章」贴个链接，或直接贴正文</span></div>';
    }
    return tools + list.map((a) => {
      const p = epArtProg(a);
      const nw = epWordsOfArt(a.id).length;
      return '<div class="lw-ep-art' + (epCurArt() && epCurArt().id === a.id ? ' on' : '') + '" data-epart="' + esc(a.id) + '">'
        + '<div class="ti">' + esc(a.title || '未命名') + '</div>'
        + '<div class="mt">'
        + (a.site ? '<span>' + esc(a.site) + '</span>' : '')
        + '<span>' + (Number(a.words) || 0) + ' 词</span>'
        + (a.level ? '<span class="lv">' + esc(a.level) + '</span>' : '')
        + (nw ? '<span>' + nw + ' 生词</span>' : '')
        + (p >= 100 ? '<span class="done">✓ 已精读</span>' : (p > 0 ? '<span>' + p + '%</span>' : ''))
        + '</div></div>';
    }).join('');
  }
  function epReadHtml(a) {
    if (!a) {
      return '<div class="lw-rd-empty" style="margin:auto">← 从中间选一篇文章<br>'
        + '<span style="color:' + T.faint + '">还没有就点「＋ 导入文章」</span></div>';
    }
    const sents = epSents(a);
    const s = EP_UI.sel >= 0 && sents[EP_UI.sel] ? sents[EP_UI.sel] : null;
    const done = a.done || {};
    let body = '';
    let cur = -1;
    sents.forEach((x, i) => {
      if (x.para !== cur) { if (cur >= 0) body += '</p>'; body += '<p class="lw-ep-p">'; cur = x.para; }
      body += '<span class="lw-ep-s' + (EP_UI.sel === i ? ' on' : '') + (done[i] ? ' done' : '')
        + '" data-epsent="' + i + '">' + esc(x.text) + '</span> ';
    });
    if (cur >= 0) body += '</p>';
    return '<div class="lw-ep-body" id="lw-ep-body">'
      + '<div class="hd"><h2>' + esc(a.title || '未命名') + '</h2>'
      + '<div class="mt">'
      + (a.site ? '<span>' + esc(a.site) + '</span>' : '')
      + (a.url ? '<span><a href="' + esc(a.url) + '" target="_blank" rel="noopener" style="color:inherit">原文 ↗</a></span>' : '')
      + '<span><b>' + (Number(a.words) || 0) + '</b> 词</span>'
      + '<span>约 <b>' + (Number(a.minutes) || 1) + '</b> 分钟</span>'
      + (a.level ? '<span>难度 <b>' + esc(a.level) + '</b>（估算）</span>' : '')
      + '<span>' + sents.length + ' 句</span>'
      + '<span>精读 <b>' + epArtProg(a) + '%</b></span>'
      + '</div>'
      + '<div class="lw-ep-act" style="padding:10px 0 0">'
      + '<button id="lw-ep-play" title="从第一句开始逐句朗读整篇">🔊 朗读全文</button>'
      + '<button id="lw-ep-stop" title="停止朗读">■ 停</button>'
      + '<button id="lw-ep-allok" title="把所有句子标成已懂">✓ 全标已懂</button>'
      + '<button id="lw-ep-reset" title="清掉这篇的已懂标记">↺ 重置进度</button>'
      + '<button id="lw-ep-delart" title="删掉这篇文章（生词保留）">🗑 删文章</button>'
      + '</div></div>'
      + '<div class="bd">' + (sents.length ? body
        : '<div class="lw-rd-empty" style="position:static">这篇没抽出正文 ✗</div>') + '</div>'
      + '</div>'
      + '<div class="lw-ep-panel" id="lw-ep-panel">' + epSentPanelHtml(a, s) + '</div>';
  }
  function epSentPanelHtml(a, s) {
    const idx = EP_UI.sel;
    const notes = epNotesOf(a.id).filter((n) => Number(n.sent) === idx);
    const have = s ? epWords().filter((w) => new RegExp('(^|[^A-Za-z])' + w.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z]|$)', 'i').test(s.text)) : [];
    const head = '<div class="lw-rd-hd">第 ' + (idx + 1) + ' 句 / 共 ' + epSents(a).length + ' 句</div>';
    if (!s) {
      return '<div class="lw-rd-hd">句子</div>'
        + '<div class="lw-rd-empty" style="position:static;padding:30px 14px">'
        + '点中间任意一句话<br><span style="color:' + T.faint + '">选中后就能朗读、划词、加生词</span></div>';
    }
    const words = EN ? EN.tokenizeWords(s.text, { minLen: 1 }) : [];
    const lv = EN ? EN.levelOf(s.text) : '';
    return head
      + '<div class="lw-ep-sent">' + esc(s.text) + '</div>'
      + '<div class="lw-ep-act">'
      + '<button id="lw-ep-say" title="朗读这一句">🔊 读这句</button>'
      + '<button id="lw-ep-say-slow" title="慢速朗读（0.6 倍）">🐢 慢速</button>'
      + '<button id="lw-ep-ok" title="标成已懂 / 取消">' + ((a.done || {})[idx] ? '↺ 取消已懂' : '✓ 已懂') + '</button>'
      + '<button id="lw-ep-copy" title="复制这一句">⧉ 复制</button>'
      + '</div>'
      + '<div class="lw-ep-tip">' + words.length + ' 个词' + (lv ? ' · 难度 ' + lv + '（估算）' : '') + '</div>'
      + '<div class="lw-rd-hd">加生词</div>'
      + '<div class="lw-ep-add">'
      + '<input id="lw-ep-new" placeholder="划一个词，或手打…" value="' + esc(EP_UI.pick) + '"/>'
      + '<button id="lw-ep-addbtn" title="加进生词本（回车也行）">＋ 加</button>'
      + '</div>'
      + '<div class="lw-ep-tip" id="lw-ep-newtip">' + (EP_UI.pick
        ? '划中的是「' + esc(EP_UI.pick) + '」✓ 回车直接加'
        : '用鼠标在正文里「划」一个词，这里会自动填上 ✓') + '</div>'
      + '<div class="lw-ep-add">'
      + '<input id="lw-ep-ph" placeholder="音标（选填）"/>'
      + '<input id="lw-ep-def" placeholder="释义（选填）"/>'
      + '</div>'
      + (have.length ? '<div class="lw-rd-hd">这句里的生词</div>'
        + have.map((w) => '<div class="lw-rd-row" data-epword="' + esc(w.id) + '">'
          + '<span class="em">' + (SRS ? ({ fresh: '○', learning: '◐', young: '●', mature: '◉' }[SRS.stageOf(w)] || '○') : '○') + '</span>'
          + esc(w.w) + '<span class="n">' + (w.def ? esc(String(w.def).slice(0, 8)) : '') + '</span></div>').join('') : '')
      + '<div class="lw-rd-hd">这句的笔记</div>'
      + notes.map((n) => '<div class="lw-note k-quote"><div class="tx">' + esc(n.text) + '</div>'
        + '<div class="ft"><span class="x" data-epnotedel="' + esc(n.id) + '">✕</span></div></div>').join('')
      + '<div class="lw-ep-add"><input id="lw-ep-note" placeholder="给这句写点笔记…"/><button id="lw-ep-notebtn">＋</button></div>';
  }

  /* ══ 生词本 ✓ ══════════════════════════════════════════════════════════ */
  function epFilteredWords() {
    const q = String(EP_UI.wordQ || '').trim().toLowerCase();
    const f = EP_UI.wordFilter || 'all';
    const now = Date.now();
    return epWords().filter((w) => {
      if (q && (String(w.w || '') + ' ' + String(w.def || '')).toLowerCase().indexOf(q) < 0) return false;
      if (f === 'all') return true;
      if (f === 'due') return Number(w.due || 0) <= now;
      if (SRS) return SRS.stageOf(w) === f;
      return true;
    }).sort((a, b) => (Number(a.due) || 0) - (Number(b.due) || 0));
  }
  function epWordRowHtml(w) {
    const st = SRS ? SRS.stageOf(w) : 'fresh';
    const due = Number(w.due || 0);
    const now = Date.now();
    const when = !SRS ? '' : (due <= now ? '该复习' : SRS.fmtGap(due - now) + '后');
    return '<div class="lw-wd-row' + (EP_UI.wordSel === w.id ? ' on' : '') + '" data-epword="' + esc(w.id) + '">'
      + '<span class="lw-wd-dot ' + st + '" title="' + ({ fresh: '新词', learning: '学习中', young: '年轻', mature: '已掌握' }[st] || '') + '"></span>'
      + '<span class="w">' + esc(w.w) + '</span>'
      + (w.def ? '<span class="df">' + esc(String(w.def).slice(0, 14)) + '</span>'
        : '<span class="df" style="color:' + T.warn + '">缺释义</span>')
      + '<span class="df" style="color:' + (due <= now ? T.warn : T.faint) + '">' + esc(when) + '</span>'
      + '</div>';
  }
  function viewWordbook() {
    if (!SRS) return '<div class="lw-rd">' + epNoLib() + '</div>';
    const list = epFilteredWords();
    const now = Date.now();
    const st = SRS.stats(epWords(), now);
    const due = SRS.dueCards(epWords(), now).length;
    const tools = '<div class="lw-rd-tools">'
      + '<input id="lw-wd-q" placeholder="搜索单词 / 释义…" value="' + esc(EP_UI.wordQ) + '"/>'
      + '<button class="pri" id="lw-wd-rev" style="' + (due ? 'border-color:' + T.accent + ';color:' + T.accent : '') + '"'
      + (due ? '' : ' disabled') + '>▶ 复习 ' + (due ? due : '') + '</button>'
      + '<button id="lw-wd-add">＋ 加词</button>'
      + '</div>';
    return '<div class="lw-rd">'
      + '<div class="lw-rd-side"' + paneW('bookSideW', 150) + '>' + epWordSideHtml(st) + '</div>' + paneGrip('side')
      + '<div class="lw-rd-list"' + paneW('bookListW', 260) + '>' + tools
      + (list.length ? list.map(epWordRowHtml).join('')
        : '<div class="lw-rd-empty">没有符合条件的词<br><span style="color:' + T.faint + '">去「外刊精读」里划几个词</span></div>')
      + '</div>' + paneGrip('list')
      + '<div class="lw-rd-read">' + epWordDetailHtml() + '</div>'
      + '</div>';
  }
  function epWordSideHtml(st) {
    const flt = (k, label, n) => '<div class="lw-rd-row' + (EP_UI.wordFilter === k ? ' on' : '') + '" data-epwflt="' + k + '">'
      + '<span class="em">▣</span>' + label + '<span class="n">' + n + '</span></div>';
    return '<div class="lw-rd-hd">记忆统计</div>'
      + '<div class="lw-rd-stat">'
      + '<div><b>' + st.total + '</b><span>总词数</span></div>'
      + '<div><b style="color:' + (st.due ? T.warn : T.faint) + '">' + st.due + '</b><span>待复习</span></div>'
      + '<div><b>' + st.mature + '</b><span>已掌握</span></div>'
      + '<div><b>' + (st.retentionN ? st.retention + '%' : '—') + '</b><span>记住率</span></div>'
      + '</div>'
      + '<div class="lw-rd-hd">按阶段</div>'
      + flt('all', '全部', st.total)
      + flt('due', '⏰ 该复习了', st.due)
      + flt('fresh', '○ 新词', st.fresh)
      + flt('learning', '◐ 学习中', st.learning)
      + flt('young', '● 年轻', st.young)
      + flt('mature', '◉ 已掌握', st.mature)
      + '<div class="lw-rd-hd">遗忘曲线怎么走</div>'
      + '<div class="lw-ep-tip">'
      + '答对 → <b>10 分钟</b>后再见<br>'
      + '再答对 → <b>1 天</b>后<br>'
      + '再答对 → <b>6 天 → 15 天 → 38 天…</b><br>'
      + '答「太简单」→ 新词直接跳到 <b>4 天</b>后<br>'
      + '答错 → 打回 <b>10 分钟</b>，难度因子扣一点<br>'
      + '<span style="color:' + T.faint + '">（艾宾浩斯曲线 → 简化 SM-2 ✓ 算法在 lib/srs.js）</span>'
      + '</div>';
  }
  function epWordDetailHtml() {
    const w = epWordById(EP_UI.wordSel);
    if (!w) {
      return '<div class="lw-rd-empty" style="margin:auto">← 从中间选一个词<br>'
        + '<span style="color:' + T.faint + '">选好就能改释义、听发音、看复习历史</span></div>';
    }
    const st = SRS ? SRS.stageOf(w) : 'fresh';
    const now = Date.now();
    const due = Number(w.due || 0);
    const hist = Array.isArray(w.hist) ? w.hist : [];
    const pv = SRS ? SRS.gradePreviews(w, now) : [];
    return '<div class="lw-rd-rhd"><h2>' + esc(w.w) + '</h2>'
      + '<div class="meta">'
      + '<span>' + ({ fresh: '新词', learning: '学习中', young: '年轻', mature: '已掌握' }[st] || '') + '</span>'
      + (Number(w.reps) ? '<span>答对 ' + w.reps + ' 次</span>' : '')
      + (Number(w.lapses) ? '<span>忘过 ' + w.lapses + ' 次</span>' : '')
      + '<span>难度因子 ' + (Number(w.ef) || 0).toFixed(2) + '</span>'
      + '</div></div>'
      + '<div class="lw-ep-act">'
      + '<button id="lw-wd-say" title="朗读这个单词">🔊 读单词</button>'
      + '<button id="lw-wd-say-slow" title="慢速朗读">🐢 慢速</button>'
      + (w.eg ? '<button id="lw-wd-say-eg" title="朗读例句">🔊 读例句</button>' : '')
      + '<button data-act="del" id="lw-wd-del" style="border-color:' + T.lineDim + '" title="从生词本删掉">🗑 删除</button>'
      + '</div>'
      + '<div class="lw-wd-next">下次复习：<b>' + (due <= now ? '现在（已到期）' : (SRS ? SRS.fmtGap(due - now) + '后' : '—')) + '</b>'
      + (w.ivl ? ' · 当前间隔 ' + w.ivl + ' 天' : '') + '</div>'
      + (hist.length ? '<div class="lw-rd-hd">最近 ' + hist.length + ' 次</div>'
        + '<div class="lw-wd-hist">' + hist.slice(-14).map((h) => '<i class="'
          + (Number(h.q) >= 4 ? 'ok' : Number(h.q) >= 3 ? 'hard' : 'bad') + '" title="'
          + new Date(Number(h.at) || 0).toLocaleString('zh-CN', { hour12: false }) + ' · '
          + (Number(h.q) >= 4 ? '记得' : Number(h.q) >= 3 ? '模糊' : '忘了') + '"></i>').join('') + '</div>' : '')
      + (pv.length ? '<div class="lw-rd-hd">现在复习会排到</div>'
        + '<div class="lw-ep-tip">' + pv.map((g) => g.label + ' → <b>' + g.next + '</b>').join('　') + '</div>' : '')
      + '<div class="lw-rd-hd">释义</div>'
      + '<div class="lw-ep-add" style="padding:0 14px">'
      + '<input id="lw-wd-ph" placeholder="音标 如 /həˈmɪs.fɪə/" value="' + esc(w.ph || '') + '"/></div>'
      + '<div class="lw-ep-add" style="padding:6px 14px 0">'
      + '<input id="lw-wd-def" placeholder="中文释义 / 英文解释" value="' + esc(w.def || '') + '"/></div>'
      + '<div class="lw-ep-add" style="padding:6px 14px 0">'
      + '<textarea id="lw-wd-eg" rows="2" placeholder="例句（会一起朗读）" style="flex:1;min-width:0;border:1px solid ' + T.lineDim
      + ';background:' + T.bg2 + ';color:' + T.text + ';font:11.5px/1.7 ' + UI + ';padding:6px 8px;outline:none;resize:vertical">'
      + esc(w.eg || '') + '</textarea></div>'
      + '<div class="lw-ep-tip">改完离开输入框就自动存 ✓（失焦即保存 ✓）</div>'
      + (w.artTitle ? '<div class="lw-rd-hd">来自</div><div class="lw-ep-tip">《' + esc(w.artTitle) + '》</div>' : '');
  }

  /* ══ 复习浮层 ✓（遗忘曲线要**看得见** ✓）══════════════════════════════════ */
  function epStartReview() {
    if (!SRS) return;
    const due = SRS.dueCards(epWords(), Date.now(), 50);
    if (!due.length) { rdToast('现在没有到期的词 ✓ 明天再来'); return; }
    EP_UI.revQ = due.map((c) => c.id);
    EP_UI.revI = 0; EP_UI.revShown = false; EP_UI.revDone = 0; EP_UI.revOK = 0;
    EP_UI.revOpen = true;
    render();
  }
  function epRevCur() { return epWordById(EP_UI.revQ[EP_UI.revI]); }
  function epGrade(q) {
    const w = epRevCur();
    if (!w || !SRS) return;
    const next = SRS.review(w, q, Date.now());
    Object.assign(w, next); w.edit = Date.now();
    EP_UI.revDone++;
    if (q >= 3) EP_UI.revOK++;
    EP_UI.revI++;
    EP_UI.revShown = false;
    epSave(); render();
  }
  function epReviewHtml() {
    if (!SRS) return '';
    const total = EP_UI.revQ.length;
    const w = epRevCur();
    const head = '<div class="hd"><b>🧠 复习</b>'
      + '<span class="lw-rev-prog" style="margin-left:12px"><span>' + Math.min(EP_UI.revI + (w ? 1 : 0), total) + ' / ' + total + '</span>'
      + '<span class="bar" style="width:120px"><i style="width:' + (total ? Math.round((EP_UI.revI / total) * 100) : 0) + '%"></i></span></span>'
      + '<span class="x" id="lw-rev-x">✕</span></div>';
    if (!w) {
      const rate = EP_UI.revDone ? Math.round((EP_UI.revOK / EP_UI.revDone) * 100) : 0;
      return '<div class="lw-imp" id="lw-rev"><div class="box">' + head
        + '<div class="bd"><div class="lw-rev-done">'
        + '<div class="big">✓ 这一轮完了</div>'
        + '<div class="sub">复习了 <b>' + EP_UI.revDone + '</b> 张 · 记住 <b>' + EP_UI.revOK + '</b> 张'
        + (EP_UI.revDone ? ' · 这一轮记住率 ' + rate + '%' : '') + '<br>'
        + '答错的词已经排到 <b>10 分钟后</b>，过会儿回来还有一轮<br>'
        + '<span style="color:' + T.faint + '">（这就是遗忘曲线在干活）</span></div>'
        + '</div></div>'
        + '<div class="ft"><button class="pri" id="lw-rev-close">完成</button></div>'
        + '</div></div>';
    }
    const st = SRS.stageOf(w);
    const body = '<div class="lw-rev-card">'
      + '<div class="w">' + esc(w.w) + '</div>'
      + (EP_UI.revShown
        ? (w.ph ? '<div class="ph">' + esc(w.ph) + '</div>' : '')
          + '<div class="df">' + (w.def ? esc(w.def) : '<span style="color:' + T.warn + '">还没填释义 —— 去生词本补一下</span>') + '</div>'
          + (w.eg ? '<div class="eg">' + esc(w.eg) + '</div>' : '')
          + (w.artTitle ? '<div class="src">来自《' + esc(w.artTitle) + '》</div>' : '')
        : '<div class="ask">先在心里说出意思，再点下面</div>')
      + '</div>'
      + '<div class="lw-ep-act" style="justify-content:center;padding:12px 0 0">'
      + '<button id="lw-rev-say">🔊 听发音</button>'
      + (EP_UI.revShown ? '' : '<button class="pri" id="lw-rev-show" style="border-color:' + T.accent + ';color:' + T.accent + '">显示答案</button>')
      + '</div>';
    /* ★ 四个按钮上**直接写下次间隔** ✓ —— 这就是把「遗忘曲线」摆到台面上 ✓ */
    const bar = EP_UI.revShown
      ? '<div class="lw-rev-bar">' + SRS.gradePreviews(w, Date.now()).map((g, i) =>
        '<button class="g' + g.q + '" data-epgrade="' + g.q + '">' + g.label + '<b>' + g.next + '</b></button>').join('') + '</div>'
      : '<div class="lw-rev-bar"><button id="lw-rev-show2">显示答案（空格）</button></div>';
    return '<div class="lw-imp" id="lw-rev"><div class="box">' + head
      + '<div class="bd">' + body + '</div>'
      + '<div class="ft" style="display:block">' + bar
      + '<div class="lw-ep-tip" style="padding:8px 0 0">'
      + '阶段：' + ({ fresh: '新词', learning: '学习中', young: '年轻', mature: '已掌握' }[st] || '') 
      + ' · 难度因子 ' + (Number(w.ef) || 0).toFixed(2)
      + (Number(w.lapses) ? ' · 忘过 ' + w.lapses + ' 次' : '') + '</div>'
      + '</div></div></div>';
  }

  /* ══ 导入文章 ✓ ════════════════════════════════════════════════════════ */
  function epImportHtml() {
    const t = String(EP_UI.impText || '');
    const stat = (t && EN)
      ? (() => {
        const n = EN.countWords(t);
        return n + ' 词 · 约 ' + EN.readingMinutes(n) + ' 分钟 · 难度 ' + (EN.levelOf(t) || '—') + '（估算）';
      })()
      : '';
    const lvOpts = ['', ...EP_LEVELS].map((x) => '<option value="' + x + '"'
      + (String(EP_UI.impLevel) === x ? ' selected' : '') + '>' + (x || '自动（估算）') + '</option>').join('');
    const siteOpts = EP_PRESET.map((x) => '<option value="' + esc(x) + '"></option>').join('');
    return '<div class="lw-imp" id="lw-epimp"><div class="box">'
      + '<div class="hd"><b>📰 导入外刊文章</b><span class="x" id="lw-epimp-x">✕</span></div>'
      + '<div class="bd">'
      + '<div class="tip">两条路 ✓：<b>贴链接</b>（服务端帮你把正文抽出来 ✓）/ <b>贴正文</b>（一定可用 ✓）。<br>'
      + '⚠️ 实测过：NPR / Aeon 这类站抓得到 ✓；要登录或付费墙的抓不到 ✗ —— 那就直接复制正文粘进来 ✓。</div>'
      + '<div class="lw-fl-field"><label>链接（选填）</label>'
      + '<div style="display:flex;gap:6px">'
      + '<input id="lw-epimp-url" type="text" placeholder="https://www.npr.org/…" value="' + esc(EP_UI.impUrl) + '"/>'
      + '<button id="lw-epimp-go" style="flex:none;height:auto;padding:0 12px;border:1px solid ' + T.lineDim
      + ';background:transparent;color:' + T.dim + ';font:10.5px ' + UI + ';cursor:pointer"'
      + (EP_UI.impBusy ? ' disabled' : '') + '>' + (EP_UI.impBusy ? '抓取中…' : '⬇ 抓正文') + '</button>'
      + '</div></div>'
      + '<div class="lw-fl-field"><label>标题</label>'
      + '<input id="lw-epimp-title" type="text" placeholder="留空就用抓到的 / 正文第一行" value="' + esc(EP_UI.impTitle) + '"/></div>'
      + '<div class="lw-fl-field"><label>来源</label>'
      + '<input id="lw-epimp-site" type="text" list="lw-ep-preset" placeholder="如 The Economist / NPR" value="' + esc(EP_UI.impSite) + '"/>'
      + '<datalist id="lw-ep-preset">' + siteOpts + '</datalist></div>'
      + '<div class="lw-fl-field"><label>难度</label><select id="lw-epimp-level">' + lvOpts + '</select></div>'
      + '<div class="lw-fl-field"><label>正文</label>'
      + '<textarea id="lw-epimp-text" rows="12" placeholder="把英文原文粘到这里…">' + esc(t) + '</textarea>'
      + '<div class="tip" id="lw-epimp-stat">' + esc(stat || '粘上正文后这里会显示词数 / 时长 / 难度') + '</div></div>'
      + (EP_UI.impMsg ? '<div class="st ' + (/^✓/.test(EP_UI.impMsg) ? 'ok' : 'err') + '">' + esc(EP_UI.impMsg) + '</div>' : '')
      + '</div>'
      + '<div class="ft">'
      + '<button class="pri" id="lw-epimp-do"' + (t.trim().length > 20 ? '' : ' disabled') + '>导入这篇</button>'
      + '<button id="lw-epimp-cancel">取消</button>'
      + '<span style="font-size:10px;color:' + T.faint + ';margin-left:auto">只抓你给的那一个链接 ✓ 不做爬虫 ✗</span>'
      + '</div></div></div>';
  }

  /* ══ 动作 ✓ ════════════════════════════════════════════════════════════ */
  function epArtAdd(o) {
    const text = String((o && o.text) || '').trim();
    if (text.length < 20) { rdToast('正文太短了，先粘完整一点'); return null; }
    const words = EN ? EN.countWords(text) : 0;
    const a = {
      id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6),
      title: String((o && o.title) || '').trim() || (EN ? EN.splitSentences(text)[0] : '').slice(0, 60) || '未命名文章',
      site: String((o && o.site) || '').trim(),
      url: String((o && o.url) || '').trim(),
      text,
      level: String((o && o.level) || '').trim() || (EN ? EN.levelOf(text) : ''),
      words, minutes: EN ? EN.readingMinutes(words) : 0,
      done: {}, at: Date.now(), edit: Date.now(),
    };
    STORE.articles = epArts().concat([a]);
    EP_UI.art = a.id; if (STORE) STORE.epArt = a.id;
    EP_UI.sel = -1; EP_UI.pick = '';
    epSave(); render();
    return a;
  }
  function epArtDel() {
    const a = epCurArt(); if (!a) return;
    if (!confirm('删掉《' + a.title + '》？\n\n（它带进来的生词会保留，复习记录不受影响）')) return;
    STORE.articles = epArts().filter((x) => x.id !== a.id);
    STORE.artNotes = ((STORE && STORE.artNotes) || []).filter((n) => n.artId !== a.id);
    EP_SENTS.delete(a.id);
    EP_UI.art = ''; EP_UI.sel = -1; if (STORE) STORE.epArt = '';
    epSave(); render();
  }
  function epSentMark(on) {
    const a = epCurArt(); if (!a || EP_UI.sel < 0) return;
    a.done = a.done || {};
    if (on) a.done[EP_UI.sel] = 1; else delete a.done[EP_UI.sel];
    a.edit = Date.now();
    epSave(); render();
  }
  function epArtMarkAll(on) {
    const a = epCurArt(); if (!a) return;
    a.done = {};
    if (on) epSents(a).forEach((_s, i) => { a.done[i] = 1; });
    a.edit = Date.now();
    epSave(); render();
  }
  function epWordAdd(raw, extra) {
    const w = EN ? EN.cleanWord(raw) : String(raw || '').trim().toLowerCase();
    if (!w || w.length < 1) { rdToast('没识别出单词 ✓ 手动打一个'); return null; }
    const hit = epWordOf(w);
    if (hit) { EP_UI.wordSel = hit.id; rdToast('「' + w + '」已经在生词本里了 ✓'); render(); return hit; }
    const a = epCurArt();
    const card = Object.assign({
      id: 'w' + Date.now() + Math.random().toString(36).slice(2, 6),
      w, ph: String((extra && extra.ph) || ''), def: String((extra && extra.def) || ''),
      eg: String((extra && extra.eg) || ''),
      artId: a ? a.id : '', artTitle: a ? a.title : '',
      at: Date.now(), edit: Date.now(),
    }, SRS ? SRS.newSrs(Date.now()) : {});
    STORE.words = epWords().concat([card]);
    EP_UI.wordSel = card.id;
    epSave(); render();
    rdToast('已加入生词本：「' + w + '」✓ 10 分钟后再见它');
    return card;
  }
  function epWordDel() {
    const w = epWordById(EP_UI.wordSel); if (!w) return;
    if (!confirm('把「' + w.w + '」从生词本删掉？\n\n（复习记录也一起没了）')) return;
    STORE.words = epWords().filter((x) => x.id !== w.id);
    EP_UI.wordSel = '';
    epSave(); render();
  }
  function epWordSave() {
    const w = epWordById(EP_UI.wordSel); if (!w) return;
    const host = document.getElementById('lifework-view'); if (!host) return;
    const g = (id) => { const el = host.querySelector(id); return el ? String(el.value || '').trim() : null; };
    const ph = g('#lw-wd-ph'), def = g('#lw-wd-def'), eg = g('#lw-wd-eg');
    let ch = false;
    if (ph !== null && ph !== String(w.ph || '')) { w.ph = ph; ch = true; }
    if (def !== null && def !== String(w.def || '')) { w.def = def; ch = true; }
    if (eg !== null && eg !== String(w.eg || '')) { w.eg = eg; ch = true; }
    if (ch) { w.edit = Date.now(); epSave(); }
  }
  function epNoteAdd() {
    const a = epCurArt(); if (!a || EP_UI.sel < 0) return;
    const host = document.getElementById('lifework-view');
    const el = host && host.querySelector('#lw-ep-note');
    const t = el ? String(el.value || '').trim() : '';
    if (!t) return;
    STORE.artNotes = ((STORE && STORE.artNotes) || []).concat([{
      id: 'an' + Date.now() + Math.random().toString(36).slice(2, 5),
      artId: a.id, sent: EP_UI.sel, text: t, at: Date.now(),
    }]);
    epSave(); render();
  }
  /* 划词 ✓ —— 只在**正文里**取选区 ✓，别把别处的选中也当成生词 ✗ */
  function epGrabPick() {
    try {
      const sel = String(window.getSelection && window.getSelection().toString() || '');
      const w = EN ? EN.cleanWord(sel) : sel.trim().toLowerCase();
      if (!w || w.length > 40 || !/[a-z]/i.test(w)) return false;
      if (w === EP_UI.pick) return false;
      EP_UI.pick = w;
      const host = document.getElementById('lifework-view');
      const el = host && host.querySelector('#lw-ep-new');
      if (el) { el.value = w; el.focus(); }              /* 只改输入框 ✓ 不整屏 render ✗ */
      const tip = host && host.querySelector('#lw-ep-newtip');
      if (tip) tip.innerHTML = '划中的是「' + esc(w) + '」✓ 回车直接加';
      return true;
    } catch (_) { return false; }
  }

  /* ══ 绑定 ✓ ════════════════════════════════════════════════════════════ */
  function bindEnglish() {
    const host = document.getElementById('lifework-view');
    if (!host || TAB !== 'reading') return;
    const q = (s) => host.querySelector(s);
    const qa = (s) => Array.from(host.querySelectorAll(s));
    qa('[data-rdmode]').forEach((el) => { el.onclick = () => epSetMode(el.dataset.rdmode); });

    /* ── 外刊精读 ── */
    const ai = q('#lw-ep-imp'); if (ai) ai.onclick = () => { EP_UI.impOpen = true; EP_UI.impMsg = ''; render(); };
    const aq = q('#lw-ep-q');
    if (aq) aq.oninput = () => { EP_UI.q = aq.value; const host2 = document.getElementById('lifework-view'); /* 只过滤 ✓ */ };
    qa('[data-epart]').forEach((el) => { el.onclick = () => epPickArt(el.dataset.epart); });
    qa('[data-epflt]').forEach((el) => { el.onclick = () => { EP_UI.wordFilter = el.dataset.epflt; epSetMode('word'); }; });
    qa('[data-epwflt]').forEach((el) => { el.onclick = () => { EP_UI.wordFilter = el.dataset.epwflt; render(); }; });
    qa('[data-epword]').forEach((el) => { el.onclick = () => { EP_UI.wordSel = el.dataset.epword; epSetMode('word'); }; });
    qa('[data-epnotedel]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        STORE.artNotes = ((STORE && STORE.artNotes) || []).filter((n) => n.id !== el.dataset.epnotedel);
        epSave(); render();
      };
    });
    /* 正文：点句子 / 划词 */
    qa('[data-epsent]').forEach((el) => {
      el.onclick = () => {
        const i = Number(el.dataset.epsent);
        if (EP_UI.sel === i) return;
        EP_UI.sel = i; EP_UI.pick = '';
        render();
      };
      el.onmouseup = () => { setTimeout(epGrabPick, 0); };   /* 等浏览器把选区定下来 ✓ */
    });
    const say = q('#lw-ep-say');
    if (say) say.onclick = () => {
      const a = epCurArt(); const sents = epSents(a);
      if (!sents[EP_UI.sel]) return;
      spkSay(sents[EP_UI.sel].text, { onPart: () => spkHighlight(EP_UI.sel) });
    };
    const saySlow = q('#lw-ep-say-slow');
    if (saySlow) saySlow.onclick = () => {
      const a = epCurArt(); const sents = epSents(a);
      if (!sents[EP_UI.sel]) return;
      spkSay(sents[EP_UI.sel].text, { rate: 0.6, onPart: () => spkHighlight(EP_UI.sel) });
    };
    const play = q('#lw-ep-play');
    if (play) play.onclick = () => {
      const a = epCurArt(); if (!a) return;
      const sents = epSents(a).map((s) => s.text);
      if (!sents.length) return;
      const from = EP_UI.sel >= 0 ? EP_UI.sel : 0;
      /* 从选中的那句开始念 ✓（读到哪点哪 ✓），念到底再停 ✓ */
      spkSay(sents.slice(from), { onPart: (i) => spkHighlight(from + i) });
      rdToast('从第 ' + (from + 1) + ' 句开始朗读 ✓（切页签会自动停）');
    };
    const stop = q('#lw-ep-stop'); if (stop) stop.onclick = () => { spkStop(); rdToast('停了'); };
    const okb = q('#lw-ep-ok'); if (okb) okb.onclick = () => { const a = epCurArt(); epSentMark(!((a && a.done || {})[EP_UI.sel])); };
    const allok = q('#lw-ep-allok'); if (allok) allok.onclick = () => epArtMarkAll(true);
    const reset = q('#lw-ep-reset'); if (reset) reset.onclick = () => epArtMarkAll(false);
    const delart = q('#lw-ep-delart'); if (delart) delart.onclick = () => epArtDel();
    const copy = q('#lw-ep-copy');
    if (copy) copy.onclick = () => {
      const s = epSents(epCurArt())[EP_UI.sel];
      if (!s) return;
      try { navigator.clipboard.writeText(s.text); rdToast('✓ 已复制这句'); } catch (_) {}
    };
    const addbtn = q('#lw-ep-addbtn');
    const doAdd = () => {
      const el = q('#lw-ep-new');
      const raw = el ? String(el.value || '').trim() : '';
      if (!raw) { rdToast('先划一个词，或者手打一个'); return; }
      const ph = q('#lw-ep-ph'), def = q('#lw-ep-def');
      epWordAdd(raw, { ph: ph ? ph.value : '', def: def ? def.value : '' });
      EP_UI.pick = '';
    };
    if (addbtn) addbtn.onclick = doAdd;
    const newEl = q('#lw-ep-new');
    if (newEl) {
      newEl.oninput = () => { EP_UI.pick = newEl.value; };
      newEl.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doAdd(); } };
    }
    const nb = q('#lw-ep-notebtn'); if (nb) nb.onclick = () => epNoteAdd();
    const nt = q('#lw-ep-note');
    if (nt) nt.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); epNoteAdd(); } };

    /* ── 朗读设置 ── */
    const vs = q('#lw-ep-voice');
    if (vs) vs.onchange = () => { if (STORE) STORE.epVoice = vs.value; epSave(); spkStop(); };
    const rt = q('#lw-ep-rate');
    if (rt) {
      rt.oninput = () => { const v = q('#lw-ep-ratev'); if (v) v.textContent = Number(rt.value).toFixed(1) + '×'; };
      rt.onchange = () => { if (STORE) STORE.epRate = Number(rt.value) || 1; epSave(); };
    }

    /* ── 生词本 ── */
    const wq = q('#lw-wd-q');
    if (wq) wq.oninput = () => { EP_UI.wordQ = wq.value; render(); };
    const rev = q('#lw-wd-rev'); if (rev) rev.onclick = () => epStartReview();
    const wa = q('#lw-wd-add');
    if (wa) wa.onclick = () => {
      const raw = prompt('加一个单词：', '');
      if (raw === null) return;
      const def = prompt('释义（可留空）：', '') || '';
      if (String(raw).trim()) epWordAdd(raw, { def });
    };
    const wdel = q('#lw-wd-del'); if (wdel) wdel.onclick = () => epWordDel();
    ['#lw-wd-ph', '#lw-wd-def', '#lw-wd-eg'].forEach((sel) => {
      const el = q(sel);
      if (el) el.onblur = () => epWordSave();
    });
    const ws1 = q('#lw-wd-say'); if (ws1) ws1.onclick = () => { const w = epWordById(EP_UI.wordSel); if (w) spkSay(w.w); };
    const ws2 = q('#lw-wd-say-slow'); if (ws2) ws2.onclick = () => { const w = epWordById(EP_UI.wordSel); if (w) spkSay(w.w, { rate: 0.6 }); };
    const ws3 = q('#lw-wd-say-eg'); if (ws3) ws3.onclick = () => { const w = epWordById(EP_UI.wordSel); if (w && w.eg) spkSay(w.eg); };

    /* ── 复习浮层 ── */
    const rx = q('#lw-rev-x'); if (rx) rx.onclick = () => { EP_UI.revOpen = false; render(); };
    const rc = q('#lw-rev-close'); if (rc) rc.onclick = () => { EP_UI.revOpen = false; render(); };
    const rsh = q('#lw-rev-show'); if (rsh) rsh.onclick = () => { EP_UI.revShown = true; render(); };
    const rsh2 = q('#lw-rev-show2'); if (rsh2) rsh2.onclick = () => { EP_UI.revShown = true; render(); };
    const rsay = q('#lw-rev-say');
    if (rsay) rsay.onclick = () => { const w = epRevCur(); if (w) spkSay(w.w); };
    qa('[data-epgrade]').forEach((el) => { el.onclick = () => epGrade(Number(el.dataset.epgrade)); });

    /* ── 导入浮层 ── */
    const ix = q('#lw-epimp-x'); if (ix) ix.onclick = () => { EP_UI.impOpen = false; render(); };
    const ic = q('#lw-epimp-cancel'); if (ic) ic.onclick = () => { EP_UI.impOpen = false; render(); };
    const iu = q('#lw-epimp-url'); if (iu) iu.oninput = () => { EP_UI.impUrl = iu.value; };
    const it = q('#lw-epimp-title'); if (it) it.oninput = () => { EP_UI.impTitle = it.value; };
    const is = q('#lw-epimp-site'); if (is) is.oninput = () => { EP_UI.impSite = is.value; };
    const il = q('#lw-epimp-level'); if (il) il.onchange = () => { EP_UI.impLevel = il.value; };
    const itx = q('#lw-epimp-text');
    if (itx) itx.oninput = () => {
      EP_UI.impText = itx.value;
      const st = q('#lw-epimp-stat');
      const n = EN ? EN.countWords(itx.value) : 0;
      if (st) st.textContent = itx.value.trim().length > 20
        ? (n + ' 词 · 约 ' + (EN ? EN.readingMinutes(n) : 0) + ' 分钟 · 难度 ' + (EN ? (EN.levelOf(itx.value) || '—') : '—') + '（估算）')
        : '粘上正文后这里会显示词数 / 时长 / 难度';
      const go = q('#lw-epimp-do');
      if (go) { if (itx.value.trim().length > 20) go.removeAttribute('disabled'); else go.setAttribute('disabled', ''); }
    };
    const igo = q('#lw-epimp-go');
    if (igo) igo.onclick = async () => {
      const url = String(EP_UI.impUrl || '').trim();
      if (!/^https?:\/\//i.test(url)) { EP_UI.impMsg = '链接要 http:// 或 https:// 开头'; render(); return; }
      EP_UI.impBusy = true; EP_UI.impMsg = '正在抓这一页…'; render();
      try {
        const r = await fetch('/api/life/en/fetch', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const d = await r.json();
        EP_UI.impBusy = false;
        if (!d || !d.ok) { EP_UI.impMsg = '✗ ' + ((d && d.error) || '抓取失败'); render(); return; }
        EP_UI.impText = d.text || '';
        EP_UI.impTitle = EP_UI.impTitle || d.title || '';
        EP_UI.impSite = EP_UI.impSite || d.site || '';
        EP_UI.impLevel = EP_UI.impLevel || d.level || '';
        EP_UI.impMsg = '✓ 抓到了：' + d.paras + ' 段 · ' + d.words + ' 词 · 难度 ' + (d.level || '—')
          + '（用的规则：' + (d.via || '—') + '）';
        render();
      } catch (e) {
        EP_UI.impBusy = false;
        EP_UI.impMsg = '✗ 抓取失败：' + e.message;
        render();
      }
    };
    const ido2 = q('#lw-epimp-do');
    if (ido2) ido2.onclick = () => {
      const a = epArtAdd({
        title: EP_UI.impTitle, site: EP_UI.impSite, url: EP_UI.impUrl,
        text: EP_UI.impText, level: EP_UI.impLevel,
      });
      if (!a) return;
      EP_UI.impOpen = false;
      EP_UI.impText = ''; EP_UI.impTitle = ''; EP_UI.impSite = ''; EP_UI.impLevel = ''; EP_UI.impMsg = '';
      epSetMode('ex');
      rdToast('导入好了：《' + a.title + '》· ' + a.words + ' 词 ✓');
    };

    /* ── 键盘：复习时空格翻面，1~4 直接评分 ✓ ── */
    host.onkeydown = (ev) => {
      if (!EP_UI.revOpen) return;
      if (ev.key === ' ' || ev.key === 'Enter') {
        if (!EP_UI.revShown) { ev.preventDefault(); EP_UI.revShown = true; render(); }
        return;
      }
      const n = Number(ev.key);
      if (EP_UI.revShown && n >= 1 && n <= 4) {
        ev.preventDefault();
        epGrade((SRS ? SRS.GRADES : [])[n - 1] ? SRS.GRADES[n - 1].q : 4);
      }
    };
  }

  function viewMail() {
    /* 宽度每次渲染都从 STORE 现读 ✓（拖完立刻重绘也能拿到新值 ✓）；
       0 / 没设 = 不写 inline style → 用 CSS 里的默认宽度 ✓ */
    const sideW = Number(STORE && STORE.mailSideW) || 0;
    const listW = Number(STORE && STORE.mailListW) || 0;
    const wStyle = (w, min) => (w >= min ? ' style="width:' + Math.round(w) + 'px"' : '');
    const grip = (which) => '<div class="lw-ml-grip" data-mlgrip="' + which + '" title="左右拖动调整宽度；双击恢复默认"></div>';
    const sideEl = '<div class="lw-ml-side"' + wStyle(sideW, 140) + '>' + mailSideHtml() + '</div>';
    if (MAIL_UI.cfgOpen) {
      return '<div class="lw-ml">' + sideEl + grip('side')
        + '<div style="flex:1;min-width:0;overflow:auto">' + mailConfigHtml() + '</div></div>';
    }
    return '<div class="lw-ml">'
      + sideEl + grip('side')
      + '<div class="lw-ml-list"' + wStyle(listW, 200) + '>' + mailListHtml() + '</div>' + grip('list')
      + '<div class="lw-ml-read">' + mailReaderHtml() + '</div></div>';
  }

  /* 局部重绘 ✓ —— 不整屏 render()，否则阅读区的 iframe 每次都被重建、邮件重新加载 ✗ */
  /* 局部重绘 ✓ —— 不整屏 render()，否则阅读区的 iframe 每次都被重建、邮件重新加载 ✗
     ★ 可以一次传多个 pane（数组）✓ —— 以前切文件夹要连调 3 次 ✗，
       每次都跑一遍 `bindMail()`（里面有十几个 querySelectorAll）✗，白做三遍 ✓。 */
  function renderMailPane(which) {
    if (TAB !== 'mail' || !document.getElementById('lifework-view')) return;
    const host = document.getElementById('lifework-view');
    const map = { side: ['.lw-ml-side', mailSideHtml], list: ['.lw-ml-list', mailListHtml], read: ['.lw-ml-read', mailReaderHtml] };
    for (const w of (Array.isArray(which) ? which : [which])) {
      const hit = map[w];
      if (!hit) { render(); return; }
      const el = host.querySelector(hit[0]);
      if (!el) { render(); return; }
      el.innerHTML = hit[1]();
    }
    bindMail();
  }

  /* ── 拉数据 ────────────────────────────────────────────────────────────── */
  /* ★★ 所有邮件请求都要有**在途去重** ✓ ——
     以前靠 `MAIL_UI.list` 是否为空来判断「要不要拉」✗，
     而请求进行中它本来就是 null ✗ → 同一个请求被反复发起 ✗
     （实测进一次邮箱页 4×boxes + 4×list = 8 条 IMAP 连接，每条 0.6~3.7 秒）✗✗。 */
  async function mailLoadBoxes(force) {
    const key = MAIL_UI.key;
    if (!key) return;
    if (MAIL_UI.boxesLoading) return;
    if (!force && MAIL_UI.boxes) return;
    MAIL_UI.boxesLoading = true; MAIL_UI.boxesErr = '';
    renderMailPane('side');
    try {
      const r = await fetch('/api/life/mail/boxes?key=' + encodeURIComponent(key) + (force ? '&force=1' : ''), { cache: 'no-store' });
      const d = await r.json();
      if (MAIL_UI.key !== key) return;                 /* 期间切了账号 → 丢弃 ✓ */
      if (d && d.ok) { MAIL_UI.boxes = { boxes: d.boxes || [], inbox: d.inbox || {} }; MAIL_UI.boxesErr = ''; }
      else { MAIL_UI.boxes = null; MAIL_UI.boxesErr = (d && d.error) || '读不到文件夹'; }
    } catch (e) { MAIL_UI.boxesErr = '读文件夹失败：' + e.message; }
    finally { MAIL_UI.boxesLoading = false; renderMailPane('side'); }
  }

  async function mailLoadList(force) {
    const key = MAIL_UI.key, box = MAIL_UI.box;
    if (!key) return;
    /* 已经在拉**同一个** (账号, 文件夹) → 别重复发起 ✓（拉别的文件夹不受影响 ✓）*/
    if (MAIL_UI.listLoading && MAIL_UI._loadingKey === key && MAIL_UI._loadingBox === box) return;
    MAIL_UI.listLoading = true; MAIL_UI._loadingKey = key; MAIL_UI._loadingBox = box;
    MAIL_UI.listErr = '';
    renderMailPane('list');
    try {
      const url = '/api/life/mail/list?key=' + encodeURIComponent(key)
        + '&box=' + encodeURIComponent(box) + '&limit=' + MAIL_UI.limit
        + (MAIL_UI.unreadOnly ? '&unread=1' : '')
        + (MAIL_UI.importantOnly ? '&flagged=1' : '')
        + (force ? '&force=1' : '');
      const r = await fetch(url, { cache: 'no-store' });
      const d = await r.json();
      if (MAIL_UI.key !== key || MAIL_UI.box !== box) return;
      if (d && d.ok) { MAIL_UI.list = d.mails || []; MAIL_UI.listErr = ''; }
      else { MAIL_UI.list = []; MAIL_UI.listErr = (d && d.error) || '收信失败'; }
    } catch (e) { MAIL_UI.list = []; MAIL_UI.listErr = '收信失败：' + e.message; }
    finally {
      MAIL_UI.listLoading = false; MAIL_UI._loadingKey = ''; MAIL_UI._loadingBox = '';
      renderMailPane('list');
    }
  }

  /* ★ 本地调整未读数 ✓ —— 标已读 / 删信之后**不要**再 `mailLoadStatus(true)` ✗：
     那会对**每个账号**各开一条 IMAP 连接（本机到 gmail 还要等 15 秒超时 ✗），
     只为把一个数字减 1，完全不值 ✗。本地先改、立刻重画胶囊 ✓，
     服务端的 60 秒缓存 + 顶栏 120 秒轮询会自然校正回来 ✓。 */
  function mailAdjustUnread(delta) {
    if (!MAIL_STATUS || !delta) return;
    MAIL_STATUS.total = Math.max(0, (MAIL_STATUS.total || 0) + delta);
    const a = (MAIL_STATUS.accounts || []).find((x) => x.key === MAIL_UI.key);
    if (a) a.unseen = Math.max(0, (a.unseen || 0) + delta);
    /* ⚠️ 基线也要跟着动 ✓ —— 不然本地减了 1、基线还是旧值，
       下一轮轮询会误判成「变多了」→ 弹一个假的新邮件提醒 ✗。 */
    if (MAIL_SEEN_TOTAL !== null) MAIL_SEEN_TOTAL = MAIL_STATUS.total;
    paintMailBadge();
  }

  async function mailOpen(uid) {
    const key = MAIL_UI.key, box = MAIL_UI.box;
    MAIL_UI.uid = uid; MAIL_UI.msg = null; MAIL_UI.msgErr = ''; MAIL_UI.msgLoading = true;
    MAIL_UI.showImages = false;                       /* 换一封 → 远程图片重新默认屏蔽 ✓ */
    MAIL_UI.tr = null;                                /* 换一封 → 清掉上一封的译文缓存 ✓ */
    renderMailPane(['list', 'read']);
    try {
      const r = await fetch('/api/life/mail/read?key=' + encodeURIComponent(key)
        + '&box=' + encodeURIComponent(box) + '&uid=' + uid, { cache: 'no-store' });
      const d = await r.json();
      if (MAIL_UI.uid !== uid) return;
      if (d && d.ok) {
        MAIL_UI.msg = d;
        /* 服务端顺手标了已读 ✓ → 本地列表 + 顶栏未读数都要跟着变 ✓
           （否则要点两次才刷新 ✗ / 顶栏数字不降 ✗）*/
        const item = (MAIL_UI.list || []).find((x) => x.uid === uid);
        if (item && !item.seen) mailAdjustUnread(-1);
        if (item) item.seen = true;
      } else MAIL_UI.msgErr = (d && d.error) || '读信失败';
    } catch (e) { MAIL_UI.msgErr = '读信失败：' + e.message; }
    finally {
      MAIL_UI.msgLoading = false;
      renderMailPane(['read', 'list']);
    }
  }

  async function mailFlag(uid, action) {
    try {
      const item = (MAIL_UI.list || []).find((x) => x.uid === uid);
      const wasUnseen = item ? !item.seen : false;
      const r = await fetch('/api/life/mail/flag', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: MAIL_UI.key, box: MAIL_UI.box, uid, action }),
      });
      const d = await r.json();
      if (!d || !d.ok) { const s = document.getElementById('lw-sub'); if (s) s.textContent = '✗ ' + ((d && d.error) || '操作失败'); return; }
      if (action === 'delete') {
        MAIL_UI.list = (MAIL_UI.list || []).filter((x) => x.uid !== uid);
        if (wasUnseen) mailAdjustUnread(-1);
        if (MAIL_UI.uid === uid) { MAIL_UI.uid = 0; MAIL_UI.msg = null; }
      } else if (action === 'read') {
        if (item && !item.seen) mailAdjustUnread(-1);
        if (item) item.seen = true;
      } else if (action === 'unread') {
        if (item && item.seen) mailAdjustUnread(1);
        if (item) item.seen = false;
      } else if (action === 'flag') {
        if (item) item.flagged = true;
      } else if (action === 'unflag') {
        if (item) item.flagged = false;
      } else if (action === 'readall') {
        /* 整箱已读 ✓ —— 本地列表全标已读，顶栏未读数直接清零 ✓（不再连 IMAP 去问 ✗）*/
        (MAIL_UI.list || []).forEach((x) => { x.seen = true; });
        if (MAIL_STATUS) {
          const a = (MAIL_STATUS.accounts || []).find((x) => x.key === MAIL_UI.key);
          if (a) { MAIL_STATUS.total = Math.max(0, (MAIL_STATUS.total || 0) - (a.unseen || 0)); a.unseen = 0; }
          paintMailBadge();
        }
      }
      if (MAIL_UI.msg && MAIL_UI.msg.uid === uid) {
        if (action === 'read') MAIL_UI.msg.seen = true;
        if (action === 'unread') MAIL_UI.msg.seen = false;
        if (action === 'flag') MAIL_UI.msg.flagged = true;
        if (action === 'unflag') MAIL_UI.msg.flagged = false;
      }
      const s = document.getElementById('lw-sub');
      const word = { delete: '已删除', read: '已标为已读', unread: '已标为未读', flag: '已标为重要 ⭐', unflag: '已取消重要' };
      if (s) s.textContent = word[action] || '已更新';
      renderMailPane(['list', 'read']);
      /* 星标会影响「⭐ 重要」列表的成员 → 该视图下要重新拉一次 ✓（其它视图不用） */
      if ((action === 'flag' || action === 'unflag') && MAIL_UI.importantOnly) {
        MAIL_UI.list = null; MAIL_KICKED = ''; ensureMailLoad();
      }
    } catch (e) {
      const s = document.getElementById('lw-sub'); if (s) s.textContent = '✗ ' + e.message;
    }
  }

  /* ── 分类管理：移动邮件 / 新建文件夹 / 删文件夹 ──────────────────────────
     移动走 IMAP 的 **UID MOVE**（原子 ✓），而且**可撤销** ✓ ——
     移完在状态栏给一个「撤销」，15 秒内有效 ✓（撤销就是再移回去 ✓）。 */
  let MAIL_UNDO_TIMER = 0;
  /* ── 顶部状态栏（`#lw-sub`）────────────────────────────────────────────
     ⚠️ `#lw-sub` 是 `headHtml()` 里渲染的 ✓ —— **每次整屏 `render()` 都会被重建** ✗。
     而面板打开时天气是**异步补渲染**的（`load()` 里 `weather.then(() => render())` ✓），
     于是「已移到… ↩ 撤销」刚显示就被日期串盖掉 ✗
     （实测：拖完 7 秒后状态栏是「10月7日 周三 · 59 项目…」✗，撤销按钮也没了 ✗）。
     所以状态消息记在**模块作用域**（`STATUS_HTML` 等，声明在顶部状态区 ✓），
     `render()` 末尾重画一遍 ✓（撤销按钮的 onclick 也要重挂 ✓ —— 元素换掉了，旧绑定一起没 ✗）。 */
  function setStatus(html, ttl, undo) {
    STATUS_HTML = String(html == null ? '' : html);
    STATUS_UNTIL = ttl ? Date.now() + ttl : 0;
    STATUS_UNDO = undo || null;
    paintStatus();
  }
  function paintStatus() {
    const s = document.getElementById('lw-sub');
    if (!s) return;
    if (STATUS_UNTIL && Date.now() > STATUS_UNTIL) { STATUS_HTML = ''; STATUS_UNDO = null; STATUS_UNTIL = 0; }
    if (!STATUS_HTML) return;                  /* 没消息 / 过期 → 保留默认文案（日期 · 项目数）✓ */
    s.innerHTML = STATUS_HTML;
    const u = document.getElementById('lw-ml-undo');
    if (u && STATUS_UNDO) u.onclick = STATUS_UNDO;
  }
  function mailSetStatus(html, ttl, undo) { setStatus(html, ttl, undo); }
  async function mailMove(uid, to, quiet, fromOverride) {
    /* ★★ 源文件夹必须能**显式传入** ✗✗ —— 不能一律取 `MAIL_UI.box`：
       「撤销」是把邮件从**分类**搬回**收件箱** ✓，而此时界面正停在收件箱 ✗
       → `MAIL_UI.box` 就是收件箱 → 撞上下面的 `to === from` 守卫 → **直接 return** ✗
       （实测：点「↩ 撤销」界面毫无反应、也不发请求 ✗）。
       撤销那条路用 `fromOverride` 把「邮件现在到底在哪个文件夹」说清楚 ✓。 */
    const from = fromOverride || MAIL_UI.box;
    if (!uid || !to || to === from) return;
    /* ★★ 同一个移动**在途时去重** ✗✗ —— 见 `bindMail` 里那段注释：
       拖放的 drop 监听器曾被重复挂载 ✗，一次拖放发出 3 个相同请求 ✗，
       第一个拿到 newUid ✓、后两个是空操作（newUid=0 ✗）→ 前端用最后一个响应 ✗
       → 「↩ 撤销」时有时无 ✗。绑定已经改成幂等的 `onXXX =` ✓，
       这里再加一道闸门 ✓（双击 / 连点 / 未来新增入口都挡得住 ✓）。 */
    const ticket = from + '|' + uid + '|' + to;
    if (MAIL_MOVE_BUSY === ticket) return;
    MAIL_MOVE_BUSY = ticket;
    try {
      const r = await fetch('/api/life/mail/move', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: MAIL_UI.key, box: from, uid, to }),
      });
      const d = await r.json();
      if (!d || !d.ok) { mailSetStatus('✗ ' + esc((d && d.error) || '移动失败')); return; }
      /* ★★ 撤销要用**目标文件夹里的新 UID** ✗✗ —— UID 是**按文件夹分配**的 ✓，
         移过去之后原 UID 就失效了 ✗（拿它去移回会报「Mails not exist」✗）。
         服务端会算好 newUid 一起返回 ✓（QQ 不回 COPYUID ✗，它用 UID 快照比对算 ✓）。 */
      const backUid = Number(d.newUid) || 0;
      /* 本地列表里去掉它 ✓（不用重新收信 ✗，快得多 ✓）*/
      MAIL_UI.list = (MAIL_UI.list || []).filter((x) => x.uid !== uid);
      if (MAIL_UI.uid === uid) { MAIL_UI.uid = 0; MAIL_UI.msg = null; }
      renderMailPane(['list', 'read']);
      if (!quiet) {
        const undoable = backUid ? '　<span class="lw-undo" id="lw-ml-undo">↩ 撤销</span>' : '';
        clearTimeout(MAIL_UNDO_TIMER);
        /* ★ 撤销的 onclick 交给 `setStatus` 重挂 ✓ —— 整屏 render() 会把 `#lw-sub`
           整个换掉 ✗，旧元素上的绑定跟着消失 ✗（天气回来就会触发一次 render ✗）。 */
        mailSetStatus('已移到「' + esc(mailBoxCN(to)) + '」' + undoable, backUid ? 15000 : 8000,
          backUid ? () => mailMove(backUid, from, true, to) : null);
        MAIL_UNDO_TIMER = setTimeout(() => { setStatus(''); }, backUid ? 15000 : 8000);
      } else {
        clearTimeout(MAIL_UNDO_TIMER);
        /* ⚠️ 这里要报**目的地**（`to`）✗，不是 `from` ——
           `from` 是「邮件原来待的地方」（= 分类 ✗），
           写它会显示成「已移回「测试分类」」，方向完全反了 ✗（实测）。 */
        mailSetStatus('已移回「' + esc(mailBoxCN(to)) + '」', 6000);
      }
      /* 文件夹计数会变 → 重新拉一次 ✓（服务端缓存已经清掉了 ✓）*/
      MAIL_UI.boxes = null;
      mailLoadBoxes(true);
      /* ★★ 移到的正是**当前在看的文件夹**时，本地列表里没有它 ✗ ——
         它是那个文件夹里的**新 UID** ✗，本地删/筛都凑不出来 ✗。
         典型场景就是「撤销」：界面停在收件箱、邮件从分类搬回收件箱 ✓，
         不重新拉的话邮件**凭空消失** ✗，要手动点「↻ 重新收信」才回来 ✗（实测踩过）。
         反过来（从当前文件夹移走）本地删掉就够 ✓，不用重新收信 ✓。 */
      if (to === MAIL_UI.box) { MAIL_UI.list = null; MAIL_KICKED = ''; mailLoadList(true); }
    } catch (e) { mailSetStatus('✗ ' + esc(e.message), 8000); }
    finally { if (MAIL_MOVE_BUSY === ticket) MAIL_MOVE_BUSY = ''; }
  }

  /* 文件夹选择浮层 ✓ —— 阅读区「📁 移到…」用它 ✓ */
  function mailHidePicker() { const e = document.getElementById('lw-ml-pick'); if (e) e.remove(); }
  function mailShowPicker(uid) {
    mailHidePicker();
    const all = ((MAIL_UI.boxes && MAIL_UI.boxes.boxes) || []).filter((b) => b.selectable);
    const cur = MAIL_UI.box;
    const wrap = document.createElement('div');
    wrap.className = 'lw-ml-pickwrap';
    wrap.id = 'lw-ml-pick';
    wrap.innerHTML = '<div class="lw-ml-pick"><div class="hd">把邮件移到…<span class="x" id="lw-ml-pick-x">✕</span></div>'
      + (all.length
        ? all.map((b) => '<div class="it' + (b.name === cur ? ' cur' : '') + '" data-pick="' + esc(b.name) + '">'
            + esc(mailBoxCN(b.name)) + (b.name === cur ? '<span class="tag">当前</span>' : '') + '</div>').join('')
        : '<div class="it" style="color:' + T.faint + '">还没读到文件夹列表，点左栏「↻ 重新收信」</div>')
      + '</div>';
    document.body.appendChild(wrap);
    const close = () => mailHidePicker();
    wrap.onclick = (ev) => { if (ev.target === wrap) close(); };
    const x = document.getElementById('lw-ml-pick-x');
    if (x) x.onclick = close;
    wrap.querySelectorAll('[data-pick]').forEach((el) => {
      el.onclick = () => { const to = el.dataset.pick; close(); mailMove(uid, to); };
    });
  }

  /* 新建 / 删除文件夹（分类）✓ */
  async function mailNewBox() {
    const name = prompt('新建文件夹（分类）名称：', '');
    if (!name || !name.trim()) return;
    try {
      const r = await fetch('/api/life/mail/newbox', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: MAIL_UI.key, name: name.trim() }),
      });
      const d = await r.json();
      if (!d || !d.ok) { mailSetStatus('✗ ' + esc((d && d.error) || '新建失败'), 10000); return; }
      mailSetStatus('已新建文件夹「' + esc(name.trim()) + '」', 8000);
      MAIL_UI.boxes = null;
      mailLoadBoxes(true);
    } catch (e) { mailSetStatus('✗ ' + esc(e.message), 10000); }
  }
  async function mailDelBox(name) {
    if (!name) return;
    if (!confirm('删除文件夹「' + mailBoxCN(name) + '」？\n（IMAP 只允许删**空的**文件夹，里面有邮件会被拒绝）')) return;
    try {
      const r = await fetch('/api/life/mail/delbox', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: MAIL_UI.key, name }),
      });
      const d = await r.json();
      if (!d || !d.ok) { mailSetStatus('✗ ' + esc((d && d.error) || '删除失败'), 10000); return; }
      mailSetStatus('已删除文件夹「' + esc(mailBoxCN(name)) + '」', 8000);
      if (MAIL_UI.box === name) { MAIL_UI.box = 'INBOX'; MAIL_UI.list = null; MAIL_KICKED = ''; }
      MAIL_UI.boxes = null;
      mailLoadBoxes(true);
      ensureMailLoad();
    } catch (e) { mailSetStatus('✗ ' + esc(e.message), 10000); }
  }

  /* 进邮箱页时按需拉一次 ✓
     ★★ 判据用**独立的 stamp**，不能用「`MAIL_UI.list` 非空」✗ ——
        请求进行中它就是 null ✗，于是同一个请求被反复重新发起 ✗
        （实测进一次邮箱页 4×boxes + 4×list = **8 条 IMAP 连接**，每条 0.6~3.7 秒）✗✗。
        任何「想强制重新拉」的动作，先把 `MAIL_KICKED` 清空再调本函数 ✓。 */
  let MAIL_KICKED = '';
  function ensureMailLoad() {
    if (TAB !== 'mail') return;
    if (!MAIL_UI.key) MAIL_UI.key = mailConfiguredKeys()[0] || '';
    if (!MAIL_UI.key) return;
    const stamp = MAIL_UI.key + '|' + MAIL_UI.box + '|' + (MAIL_UI.unreadOnly ? 1 : 0)
      + '|' + (MAIL_UI.importantOnly ? 1 : 0) + '|' + MAIL_UI.limit;
    if (MAIL_KICKED === stamp) return;
    MAIL_KICKED = stamp;
    if (!MAIL_UI.boxes) mailLoadBoxes();
    mailLoadList();
    if (!MAIL_STATUS) mailLoadStatus(false);
  }

  /* ── 邮箱：交互绑定 ────────────────────────────────────────────────────── */
  function bindMail() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    const qa = (s) => Array.from(host.querySelectorAll(s));
    /* ★ 三栏**左右拖动调宽** ✓ —— 和备忘录那套逻辑完全一致：
       拖动时改宽度（带上下限 ✓）、松手写进 STORE ✓、双击恢复默认 ✓。
       绑在这里是因为 `renderMailPane()` 会重绘 pane ✓，而 grip 是它们的**兄弟节点** ✓，
       重绘不影响它，重复绑定也是幂等的（用 `.onmousedown =` 而不是 addEventListener ✓）。 */
    qa('[data-mlgrip]').forEach((gripEl) => {
      const which = gripEl.dataset.mlgrip;
      lwGrab(gripEl, {
        down: (event) => {
          /* ★★ 目标必须**在按下的这一刻**才查 ✗✗ ——
             以前是在绑定时 `host.querySelector(...)` 捕获的 ✗，
             而中间只要发生过一次**整屏 render()**，那个元素就已经被移除 ✗ →
             拖动时改的是**已脱离文档的旧元素** ✗ → 鼠标按下了、事件也到了，
             **界面就是纹丝不动** ✗（实测：命中计数 1、inline 宽度却是空 ✗）。
             拖拽条是 pane 的兄弟节点、重绘时不会跟着换 ✓，所以它身上的旧引用会一直留着 ✗。 */
          const root = document.getElementById('lifework-view') || document;
          const target = which === 'side' ? root.querySelector('.lw-ml-side') : root.querySelector('.lw-ml-list');
          if (!target) return null;
          gripEl.classList.add('on');
          return {
            target, startX: event.clientX, startW: target.getBoundingClientRect().width,
            min: which === 'side' ? 140 : 200, max: which === 'side' ? 460 : 760,
          };
        },
        move: (e2, sess) => {
          const w = Math.max(sess.min, Math.min(sess.max, sess.startW + (e2.clientX - sess.startX)));
          sess.target.style.width = Math.round(w) + 'px';
          sess.target.style.flex = 'none';
        },
        up: (e2, sess) => {
          gripEl.classList.remove('on');
          const w = Math.round(sess.target.getBoundingClientRect().width);
          if (which === 'side') STORE.mailSideW = w; else STORE.mailListW = w;
          saveStore();
        },
      });
      gripEl.ondblclick = () => {
        const root = document.getElementById('lifework-view') || document;
        const target = which === 'side' ? root.querySelector('.lw-ml-side') : root.querySelector('.lw-ml-list');
        if (target) target.style.width = '';
        if (which === 'side') STORE.mailSideW = 0; else STORE.mailListW = 0;
        saveStore();
      };
    });
    qa('[data-mkey]').forEach((el) => {
      el.onclick = () => {
        const k = el.dataset.mkey;
        if (MAIL_UI.key === k) return;
        MAIL_UI.key = k; MAIL_UI.box = 'INBOX'; MAIL_UI.list = null; MAIL_UI.msg = null;
        MAIL_UI.limit = 15;                       /* 换账号 → 重新从 15 封开始 ✓ */
        MAIL_UI.uid = 0; MAIL_UI.boxes = null; MAIL_UI.listErr = ''; MAIL_UI.boxesErr = '';
        MAIL_UI.cfgOpen = false;
        MAIL_KICKED = '';
        render(); ensureMailLoad();
      };
    });
    qa('[data-mbox]').forEach((el) => {
      el.onclick = () => {
        const b = el.dataset.mbox;
        if (MAIL_UI.box === b) return;
        MAIL_UI.box = b; MAIL_UI.list = null; MAIL_UI.msg = null; MAIL_UI.uid = 0;
        MAIL_UI.limit = 15;                       /* 换文件夹 → 重新从 15 封开始 ✓ */
        /* ★ 只切文件夹 → **不用重新拉文件夹列表** ✓（以前会重复请求 boxes ✗）；
           三个 pane 一次重绘 + 只 bindMail 一次 ✓ */
        MAIL_KICKED = '';
        renderMailPane(['side', 'read', 'list']);
        ensureMailLoad();
      };
    });
    qa('[data-mcfg]').forEach((el) => { el.onclick = () => { MAIL_UI.cfgOpen = !MAIL_UI.cfgOpen; render(); }; });
    /* ★ 分类管理：新建文件夹 / 删文件夹 ✓ */
    const newBox = host.querySelector('#lw-ml-newbox');
    if (newBox) newBox.onclick = () => mailNewBox();
    qa('[data-mboxdel]').forEach((el) => {
      el.onclick = (ev) => { ev.stopPropagation(); mailDelBox(el.dataset.mboxdel); };
    });
    /* ★ 分类管理：把**列表里的邮件拖到左栏文件夹** ✓ —— 和备忘录完全一致的交互 ✓
       ⚠️⚠️ 必须用 `onXXX =` 赋值，**不能用 addEventListener** ✗✗ ——
       `bindMail()` 在**每次局部重绘**后都会跑一遍（`renderMailPane` 里 ✓），
       而左栏 DOM **未必**被替换 ✗ → `addEventListener` 会**叠加** ✗ →
       实测**一次拖放发出 3 个相同的 move 请求** ✗：
       第一个成功（拿到 newUid ✓），后两个是空操作（邮件已不在源文件夹 →
       服务端算出的 newUid = 0 ✗），而前端用的是**最后一个响应** ✗ →
       「↩ 撤销」时有时无 ✗。`onXXX =` 是**覆盖**语义 ✓，天然幂等 ✓。 */
    let DRAG_MAIL = 0;
    qa('.lw-ml-item').forEach((el) => {
      el.draggable = true;
      el.ondragstart = (ev) => {
        DRAG_MAIL = Number(el.dataset.muid) || 0;
        el.classList.add('dragging');
        try { ev.dataTransfer.setData('text/plain', String(DRAG_MAIL)); ev.dataTransfer.effectAllowed = 'move'; } catch (_) { }
      };
      el.ondragend = () => { DRAG_MAIL = 0; el.classList.remove('dragging'); };
    });
    qa('[data-mbox]').forEach((el) => {
      el.ondragover = (ev) => {
        if (!DRAG_MAIL) return;
        ev.preventDefault();
        try { ev.dataTransfer.dropEffect = 'move'; } catch (_) { }
        el.classList.add('drop');
      };
      el.ondragleave = () => el.classList.remove('drop');
      el.ondrop = (ev) => {
        ev.preventDefault();
        el.classList.remove('drop');
        const uid = DRAG_MAIL || Number(ev.dataTransfer.getData('text/plain')) || 0;
        DRAG_MAIL = 0;
        if (uid) mailMove(uid, el.dataset.mbox);
      };
    });
    /* 阅读区「📁 移到…」→ 文件夹选择浮层 ✓ */
    const moveBtn = host.querySelector('#lw-ml-move');
    if (moveBtn) moveBtn.onclick = () => mailShowPicker(Number(moveBtn.dataset.muid));
    qa('[data-mrefresh]').forEach((el) => {
      el.onclick = () => {
        MAIL_UI.boxes = null; MAIL_UI.list = null; MAIL_KICKED = '';
        renderMailPane(['side', 'list']);
        mailLoadStatus(true);
        /* ★ 显式 force ✓ —— 服务端对「已知连不上」的账号会快速返回上次的错误 ✗，
           而用户点「重新收信」就是想真的再试一次 ✓（比如刚修好网络 / 改完配置）*/
        mailLoadBoxes(true);
        mailLoadList(true);
      };
    });
    qa('[data-muid]').forEach((el) => {
      el.onclick = () => { if (Number(el.dataset.muid)) mailOpen(Number(el.dataset.muid)); };
    });
    const q = host.querySelector('#lw-ml-q');
    if (q) q.oninput = () => {
      /* 只切 DOM 显隐 ✓ —— 不重绘，否则每敲一个字输入框就失焦 ✗ */
      MAIL_UI.q = q.value;
      const needle = q.value.trim().toLowerCase();
      qa('.lw-ml-item').forEach((el) => {
        el.style.display = (!needle || String(el.dataset.hay || '').indexOf(needle) >= 0) ? '' : 'none';
      });
    };
    const un = host.querySelector('#lw-ml-unread');
    if (un) un.onclick = () => {
      MAIL_UI.unreadOnly = !MAIL_UI.unreadOnly;
      MAIL_UI.list = null; MAIL_KICKED = '';
      renderMailPane('list'); ensureMailLoad();
    };
    /* ⭐ 只看重要（\Flagged）*/
    const st = host.querySelector('#lw-ml-star');
    if (st) st.onclick = () => {
      MAIL_UI.importantOnly = !MAIL_UI.importantOnly;
      MAIL_UI.list = null; MAIL_KICKED = '';
      renderMailPane('list'); ensureMailLoad();
    };
    /* 「加载更多」—— 每次 +15 封 ✓（见 MAIL_UI.limit 的注释）*/
    const more = host.querySelector('#lw-ml-more');
    if (more) more.onclick = () => {
      MAIL_UI.limit = Math.min(120, MAIL_UI.limit + 15);
      MAIL_KICKED = '';
      ensureMailLoad();
    };
    const rl = host.querySelector('#lw-ml-reload');
    if (rl) rl.onclick = () => {
      MAIL_UI.list = null; MAIL_KICKED = '';
      renderMailPane('list'); ensureMailLoad(); mailLoadStatus(true);
    };
    qa('[data-mact]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const action = el.dataset.mact, uid = Number(el.dataset.muid);
        if (action === 'delete' && !confirm('删除这封邮件？（服务器上会真的删掉）')) return;
        mailFlag(uid, action);
      };
    });
    qa('[data-mimg]').forEach((el) => { el.onclick = () => { MAIL_UI.showImages = el.dataset.mimg === '1'; renderMailPane('read'); }; });
    /* ⇄ 对照翻译：没译过就去译 ✓，译过了就切换「显示 / 收起」✓（缓存，不重复请求 ✓）*/
    const trBtn = host.querySelector('#lw-ml-tr');
    if (trBtn) trBtn.onclick = () => {
      const m = MAIL_UI.msg;
      if (!m) return;
      if (MAIL_UI.tr && MAIL_UI.tr.uid === m.uid && MAIL_UI.tr.pairs.length) {
        MAIL_UI.tr = null;                 /* 收起 → 回到原文 ✓（再点会重新显示缓存，不重新请求 ✓）*/
        renderMailPane('read');
        return;
      }
      mailTranslate();
    };
    /* 「全部标为已读」 */
    const ra = host.querySelector('#lw-ml-readall');
    if (ra) ra.onclick = () => {
      if (!confirm('把「' + MAIL_UI.box + '」里所有邮件标为已读？')) return;
      mailFlag(0, 'readall');
    };
  }

  /* ── 邮箱配置（收进可折叠区，不再是页面主体 ✓）───────────────────────── */
  function mailConfigHtml() {
    const acc = (STORE && STORE.mailAcc) || {};
    const keys = Object.keys(MAIL_PRESET);
    const cards = keys.map((k, i) => {
      const P = MAIL_PRESET[k];
      const a = acc[k] || {};
      /* ★ 按地址自动识别服务商：用户只要填邮箱地址，SMTP / IMAP 自动补上 ✓
         （用户要求「自行获取我的谷歌邮箱SMTP」——不该让人手敲 smtp.gmail.com） */
      const g = mailGuess(a.user);
      const host = a.host || (g ? g.host : '');
      const port = a.port || (g ? g.port : '');
      const imapHost = a.imapHost || (g ? g.imapHost : '');
      const imapPort = a.imapPort || (g ? g.imapPort : '');
      const autoNote = (g && !a.host)
        ? `<div class="lw-mail-hint">✓ 已按地址识别：SMTP <b>${esc(g.host)}:${esc(g.port)}</b> · IMAP <b>${esc(g.imapHost)}:${esc(g.imapPort)}</b>（点「保存」写进配置）</div>`
        : '';
      return `<div class="lw-c" style="${sp(6)}">
        <h3><span class="code">E-0${i + 1}</span>${esc(P.name)}<span class="sp"></span><em>${a.user ? esc(a.user) : '未配置'}</em></h3>
        <div class="lw-pad">
          <div class="lw-form">
            <label>邮箱账号<input data-mail="${k}" data-f="user" placeholder="you@example.com" value="${esc(a.user || '')}"/></label>
            <label>SMTP 服务器<input data-mail="${k}" data-f="host" placeholder="${esc(P.host || 'smtp.example.com')}" value="${esc(host)}"/></label>
            <label>SMTP 端口<input data-mail="${k}" data-f="port" placeholder="${esc(P.port || '465')}" value="${esc(port)}"/></label>
            <label>IMAP 服务器<input data-mail="${k}" data-f="imapHost" placeholder="${esc(P.imapHost || 'imap.example.com')}" value="${esc(imapHost)}"/></label>
            <label>IMAP 端口<input data-mail="${k}" data-f="imapPort" placeholder="${esc(P.imapPort || '993')}" value="${esc(imapPort)}"/></label>
            <label>授权码 / 密码<input data-mail="${k}" data-f="pass" type="password" placeholder="${a.hasPass ? '已保存（留空不改）' : '授权码'}" value=""/></label>
          </div>
          ${autoNote}
          <div style="display:flex;gap:8px;margin-top:11px;flex-wrap:wrap">
            <button class="lw-btn" data-mailsave="${k}">保存</button>
            <button class="lw-btn" data-mailtest="${k}">测试 SMTP</button>
            ${P.web ? `<a class="lw-btn" href="${P.web}" target="_blank" rel="noopener" style="text-decoration:none">打开网页版</a>` : ''}
          </div>
          <div class="lw-mail-result" id="lw-mail-result-${k}"></div>
          <div class="lw-mail-send">
            <div class="hd">发一封邮件</div>
            <label>收件人<input data-msend="${k}" data-f="to" placeholder="someone@example.com（多个用逗号分隔）"/></label>
            <label>主题<input data-msend="${k}" data-f="subject" placeholder="（无主题）"/></label>
            <label>正文<textarea data-msend="${k}" data-f="body" rows="4" placeholder="写点什么…"></textarea></label>
            <div style="display:flex;gap:8px;margin-top:9px">
              <button class="lw-btn" data-mailsend="${k}">发送</button>
              <button class="lw-btn" data-mailself="${k}" title="发给自己（用上面的账号），用来验证发信链路">发一封给自己</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
    return `<div class="lw-g12">
      <div class="lw-c" style="${sp(12)}">
        <h3><span class="code">E-00</span>说明<span class="sp"></span></h3>
        <div class="lw-pad" style="font-size:12px;line-height:1.9;color:${T.dim}">
          只要填<b style="color:${T.accent}">邮箱地址</b>，SMTP / IMAP 的服务器和端口会<b>自动识别</b>填好
          （Gmail / QQ / 网易 / Outlook / Yahoo / iCloud / 新浪 / 移动·电信 / 阿里 都认），填完点「保存」。<br>
          配置只存本机（<code>life-mail.json</code>），不上传；密码不回传明文，只记「有没有存过」。<br>
          「密码」要填<b style="color:${T.accent}">授权码</b>，不是登录密码：QQ 在「设置 → 账户 → POP3/SMTP 服务」生成，网易类似，Gmail 要「应用专用密码」。<br>
          填好后回左边的「收件箱」就能直接收信、读信、下载附件 ✓。服务商那侧还要确认<b style="color:${T.accent}">已开启 IMAP 服务</b>。
          <label style="display:flex;align-items:flex-start;gap:9px;margin-top:12px;padding-top:11px;border-top:1px dashed ${T.lineDim};cursor:pointer">
            <input type="checkbox" id="lw-mail-notify"${mailNotifyEnabled() ? ' checked' : ''} style="accent-color:${T.accent};margin-top:2px"/>
            <span>🔔 <b style="color:${T.accent}">新邮件提醒</b> —— 每 75 秒查一次（页面在后台时不查，切回来自动补查），
            发现未读数变多就在右下角弹提醒、顶栏胶囊闪一下，点提醒直接跳到那封邮件。<br>
            <span style="color:${T.faint}">打开这个开关时才会向浏览器申请系统通知权限（不会自动弹）。</span></span>
          </label>
        </div>
      </div>
      ${cards}
    </div>`;
  }



  function emptyBox(msg) {
    return `<div class="lw-empty"><span class="big">▢</span>${esc(msg)}</div>`;
  }
})();


