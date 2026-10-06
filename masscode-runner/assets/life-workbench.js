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
  const TINT = { sky: ['#1c1c1a', '#f2e39b'], lilac: ['#1c1c1a', '#f2e39b'], mint: ['#1c1c1a', '#f2e39b'],
    lemon: ['#1c1c1a', '#f2e39b'], peach: ['#1c1c1a', '#f2e39b'], rose: ['#1c1c1a', '#f2e39b'] };

  const CSS = `
  /* 独立面板：铺满顶栏以下的整个主区域 */
  .lw-inpanel { position:fixed; left:0; right:0; bottom:0; top:44px; z-index:8800; display:flex; flex-direction:column; background:${T.bg}; overflow:hidden;
    font-family:${UI}; color:${T.text}; font-size:12.5px; letter-spacing:.2px; }
  /* 顶栏 */
  .lw-head { display:flex; align-items:center; gap:16px; padding:12px 18px; flex:none;
    border-bottom:2px solid ${T.line}; background:${T.bg}; }
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
  .lw-wx { display:flex; align-items:center; gap:11px; padding:4px 13px 4px 10px; border:2px solid ${T.line}; flex:none; }
  .lw-wx .wi { font-size:19px; line-height:1; }
  .lw-wx .wt { font-size:16px; font-weight:700; color:${T.accent}; }
  .lw-wx .wc { font-size:9.5px; color:${T.dim}; line-height:1.4; letter-spacing:.4px; }
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
  .lw-nt { display:flex; height:calc(100vh - 250px); min-height:440px; border:2px solid ${T.lineDim}; }
  /* 左：文件夹 + 标签 */
  .lw-nt-side { width:172px; flex:none; background:#0c0c0b; border-right:1px solid ${T.lineDim};
    padding:10px 8px; overflow:auto; }
  /* 三栏之间可拖拽的竖条（左右自由调宽 ✓，双击恢复默认 ✓） */
  .lw-nt-grip { flex:none; width:7px; cursor:col-resize; position:relative; background:#131312; }
  .lw-nt-grip::after { content:''; position:absolute; left:3px; top:0; bottom:0; width:1px; background:${T.lineDim}; }
  .lw-nt-grip:hover::after, .lw-nt-grip.on::after { background:${T.accent}; width:2px; left:2px; }
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
  .lw-jr { display:flex; height:calc(100vh - 200px); min-height:400px; }
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
  `;

  const NAV = [
    { id: 'today', icon: '☀', label: '今日', grp: '面板', key: 'T-01' },
    { id: 'memo', icon: '✎', label: '备忘录', grp: '面板', key: 'M-01', badge: true },
    { id: 'journal', icon: '◈', label: '日记', grp: '面板', key: 'J-01' },
    { id: 'quote', icon: '❝', label: '书签', grp: '面板', key: 'B-01' },
    { id: 'tracks', icon: '◇', label: '研究方向', grp: '科研', key: 'F-01' },
    { id: 'files', icon: '▦', label: '文件', grp: '科研', key: 'C-01' },
    { id: 'mail', icon: '✉', label: '邮箱', grp: '外部', key: 'E-01' },
  ];

  let DATA = null, STORE = null, WX = null, TAB = 'today', LOADING = false, MOUNT_TIMER = 0, CITY = '广州';
  /* ★ 日记「未落盘内容」的提交钩子（模块级，跨 render 存在 ✓）
     为什么放模块级而不是 bind() 里：面板关闭 / 页面隐藏时 bind() 的闭包已经拿不到 DOM 了 ✗，
     但 `visibilitychange` 还得能调它 ✓。bind() 每次 render 都会把它重置成空函数 ✓，
     只有真的挂上了日记编辑框（`if (ce)`）才会变成真正的实现 ✓ → 不在日记页调用它是安全的 no-op ✓。 */
  let JOURNAL_FLUSH = () => { };
  let FLUSH_HOOKS_ON = false;

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
  function dstr(ms) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
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
      if (document.getElementById('btn-lifework')) { clearInterval(MOUNT_TIMER); MOUNT_TIMER = 0; return true; }
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
    /* 页脚要显示「面板资源」的构建时间：拿到后补渲染一次 ✓（只发生一次）*/
    if (!BUILD_STAMP) ensureBuildStamp().then((stamp) => { if (stamp) render(); });
  }

  /* 关闭：撤掉视图，顶部标签恢复 */
  function hidePanelView() {
    /* ★ 关面板 = 整个 DOM 被 remove ✓ → 日记编辑框里没防抖落盘的字会**直接消失** ✗
       （用户报的"改分类丢内容"是同一类问题：render 重建 DOM 把未落盘的字冲掉 ✗）
       → 先提交，再删 ✓ */
    try { JOURNAL_FLUSH(); } catch (_) { }
    const view = document.getElementById('lifework-view');
    if (view) view.remove();
    const btn = document.getElementById('btn-lifework');
    if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('on'); }
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
  /* 生成 + 直接下载（一步到位，给需要跳预览的场景用）*/
  async function memoExportImage(title, bodyHtml, whenText, fileBase) {
    const rendered = await memoRenderImage(title, bodyHtml, whenText);
    memoDownloadImage(rendered, fileBase);
    return { w: rendered.w, h: rendered.h };
  }

  function render() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    if (!DATA) { host.innerHTML = headHtml() + '<div class="lw-main">' + skeleton() + '</div>'; bind(); return; }
    CODE_SEQ = 0; KPI_SEQ = 0;   /* 每个视图的编码都从 01 开始 */
    const main = { today: viewToday, memo: viewMemo, journal: viewJournal, quote: viewQuote, tracks: viewTracks, paper: viewTracks, files: viewFiles, time: viewFiles, mail: viewMail }[TAB] || viewToday;
    const openTodo = ((STORE && STORE.memos) || []).filter((t) => t.todo && !t.done).length;
    const grps = [];
    NAV.forEach((n) => { if (!grps.includes(n.grp)) grps.push(n.grp); });
    const navHtml = grps.map((g) => `<div class="grp">${g}</div>` + NAV.filter((n) => n.grp === g).map((n) =>
      `<button data-tab="${n.id}" class="${n.id === TAB ? 'on' : ''}"><span class="ic">${n.icon}</span><span>${n.label}</span>` +
      (n.badge && openTodo ? `<span class="badge">${openTodo}</span>` : `<span class="badge">${n.key || ''}</span>`) + `</button>`).join('')).join('');
    host.innerHTML = headHtml() + `<div class="lw-body2">
      <div class="lw-nav">${navHtml}<div class="foot">System <b>OK</b><br>本地运行 · 数据仅存本机<br><span title="面板前端资源的构建时间；如果改了代码没生效，先看这里是不是最新">面板资源 ${esc(buildStampText())}</span></div></div>
      <div class="lw-main">${main()}</div></div>`;
    bind();
  }

  /* ⚠️ 只重建「左栏 + 中栏」—— 筛选类操作（点分组/文件夹/标签/搜索）用它 ✓
     以前一律走 render() ✗，会把**编辑器也重建一遍** ✗ → 每次点击 ~45ms ✗、光标丢失 ✗。 */
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
    const cur = ((STORE && STORE.memos) || []).find((x) => x.id === (STORE && STORE.memoSel));
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
    cur.text = (title == null ? old[0] : title) + (bodyNext ? '\n' + bodyNext : '');
    cur.edit = Date.now();
    return cur;
  }

  function headHtml() {
    const d = new Date();
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    const sub = DATA ? `${d.getMonth() + 1}月${d.getDate()}日 ${wd} · ${DATA.totals.projects} 项目 · ${DATA.totals.files} 文件 · ${DATA.totals.sizeText}` : '正在扫描本机…';
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
      <div class="lw-sub2" id="lw-sub">${esc(sub)}</div>
      ${wxHtml}
      <button class="lw-btn" id="lw-refresh">↻ 刷新</button></div>`;
  }

  /* 左栏 + 中栏 的交互（筛选类操作用 renderMemoList() 局部刷新 ✓）*/
  function bindMemoSide() {
    const host = document.getElementById("lifework-view");
    if (!host) return;
    const q = (sel) => host.querySelector(sel);
    const qa = (sel) => Array.from(host.querySelectorAll(sel));
    const memoById = (id) => (STORE.memos || []).find((x) => x.id === id);
    const flushMemo = () => {
      const cur = memoById(STORE.memoSel) || (STORE.memos || []).filter((m) => !m.trash)[0];
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
      snapMemo('move');                                        /* 可撤销 ✓ */
      m.folder = target.slice(0, 24);
      STORE.memoFolders = STORE.memoFolders || [];
      if (!STORE.memoFolders.includes(m.folder)) STORE.memoFolders.push(m.folder);
      saveStore();
      renderMemoList();
      const s2 = document.getElementById('lw-sub');
      if (s2) s2.textContent = '已移到「' + m.folder + '」';
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
      grip.onmousedown = (event) => {
        event.preventDefault();
        grip.classList.add('on');
        const startX = event.clientX;
        const startW = target.getBoundingClientRect().width;
        const min = which === 'side' ? 120 : 180;
        const max = which === 'side' ? 420 : 640;
        const move = (event2) => {
          const w = Math.max(min, Math.min(max, startW + (event2.clientX - startX)));
          target.style.width = Math.round(w) + 'px';
          target.style.flex = 'none';
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          grip.classList.remove('on');
          const w = Math.round(target.getBoundingClientRect().width);
          if (which === 'side') STORE.memoSideW = w; else STORE.memoListW = w;
          saveStore();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };
      grip.ondblclick = () => {
        target.style.width = '';
        if (which === 'side') STORE.memoSideW = 0; else STORE.memoListW = 0;
        saveStore();
      };
    });
    qa("[data-mfolder]").forEach((el) => { el.onclick = () => { flushMemo(); STORE.memoFolder = el.dataset.mfolder || ""; STORE.memoSmart = ""; STORE.memoSel = ""; saveStore(); renderMemoList(); }; });
    qa("[data-msmart]").forEach((el) => {
      el.onclick = () => {
        flushMemo();
        STORE.memoSmart = (STORE.memoSmart === el.dataset.msmart) ? "" : el.dataset.msmart;
        STORE.memoSel = ""; saveStore(); renderMemoList();
      };
    });
    qa("[data-mtag]").forEach((el) => { el.onclick = () => { flushMemo(); STORE.memoTag = el.dataset.mtag || ""; STORE.memoSmart = ""; STORE.memoSel = ""; saveStore(); renderMemoList(); }; });
    const mQ = q("#lw-memo-q");
    if (mQ) mQ.oninput = () => { STORE.memoQ = mQ.value; renderMemoList(); const i2 = document.getElementById("lw-memo-q"); if (i2) { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } };
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
    /* 视图切换（▤ 文件夹 / ▦ 全部列表）*/
    const mView = qa("[data-mview]");
    mView.forEach((el) => { el.onclick = () => { flushMemo(); STORE.memoView = el.dataset.mview; saveStore(); renderMemoList(); }; });
    const addFol = q("#lw-nt-addfol");
    if (addFol) addFol.onclick = () => {
      const name = prompt("新建文件夹名称：", "新文件夹");
      if (!name || !name.trim()) return;
      const n = name.trim().slice(0, 24);
      STORE.memoFolders = STORE.memoFolders || ["备忘录", "Study note"];
      if (!STORE.memoFolders.includes(n)) STORE.memoFolders.push(n);
      STORE.memoFolder = n; STORE.memoSmart = ""; STORE.memoSel = ""; saveStore(); renderMemoList();
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
            STORE.memoFolder = nn; saveStore(); renderMemoList();
          } },
        { label: "🗑 删除文件夹", danger: true, run: () => {
            if (!confirm("删除文件夹「" + name + "」？\n里面的备忘录会移到「备忘录」。")) return;
            STORE.memoFolders = (STORE.memoFolders || []).filter((x) => x !== name);
            (STORE.memos || []).forEach((m) => { if ((m.folder || "备忘录") === name) m.folder = "备忘录"; });
            STORE.memoFolder = ""; saveStore(); renderMemoList();
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
            saveStore(); renderMemoList();
          } },
        { label: "🗑 删除标签（只从正文移除）", danger: true, run: () => {
            if (!confirm("从所有备忘录里移除 #" + tag + " ？")) return;
            (STORE.memos || []).forEach((m) => { m.text = String(m.text || "").replace(new RegExp("\\s*#" + tag + "(?![\\u4e00-\\u9fa5\\w-])", "g"), ""); });
            if (STORE.memoTag === tag) STORE.memoTag = "";
            saveStore(); renderMemoList();
          } },
      ]);
    });
    qa("[data-memo]").forEach((el) => {
      const id = el.dataset.memo;
      el.oncontextmenu = (e) => openCtx(e, [
        { label: "☆ 置顶 / 取消", run: () => { const m = memoById(id); if (m) { m.pin = !m.pin; saveStore(); renderMemoList(); } } },
        { label: "📁 移到文件夹…", run: () => {
            const n = prompt("移到哪个文件夹？（现有：" + (STORE.memoFolders || []).join(" / ") + "）", (STORE.memoFolders || [])[0] || "备忘录");
            if (!n || !n.trim()) return;
            const m = memoById(id); if (!m) return;
            m.folder = n.trim().slice(0, 24);
            STORE.memoFolders = STORE.memoFolders || [];
            if (!STORE.memoFolders.includes(m.folder)) STORE.memoFolders.push(m.folder);
            saveStore(); renderMemoList();
          } },
        "-",
        { label: "🗑 删除", danger: true, run: () => { const m = memoById(id); if (m) { m.trash = true; STORE.memoSel = ""; saveStore(); renderMemoList(); } } },
      ]);
    });
  }

  function bind() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    /* 左栏 + 中栏的交互（提出来，方便 renderMemoList() 局部刷新时复用 ✓）*/
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
            h.addEventListener('mousedown', (e) => {
              e.preventDefault(); e.stopPropagation();
              h.classList.add('on');
              const x0 = e.clientX, y0 = e.clientY, w0 = card.offsetWidth, h0 = card.offsetHeight;
              /* 用元素索引当持久化 key ✓（卡片顺序稳定 ✓）*/
              const idx = Array.from(host.querySelectorAll('.lw-c')).indexOf(card);
              const key = 'rsz_' + TAB + '_' + idx;
              const move = (ev) => {
                if (dir !== 's') card.style.width = Math.max(240, w0 + (ev.clientX - x0)) + 'px';
                if (dir !== 'e') card.style.height = Math.max(120, h0 + (ev.clientY - y0)) + 'px';
                /* 卡片在网格里要跟着改 span ✓，否则宽度会被 grid 拉回去 ✗ */
                const grid = card.parentElement;
                if (grid && dir !== 's') {
                  const colW = (grid.clientWidth - 11 * 16) / 12;
                  const span = Math.max(1, Math.min(12, Math.round((card.offsetWidth + 16) / (colW + 16))));
                  card.style.gridColumn = 'span ' + span;
                }
              };
              const up = () => {
                document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
                h.classList.remove('on');
                STORE[key] = { w: card.offsetWidth, h: card.offsetHeight, span: card.style.gridColumn };
                saveStore();
              };
              document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
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
    qa('.lw-nav button').forEach((b) => { b.onclick = () => { JOURNAL_FLUSH(); TAB = b.dataset.tab; render(); }; });
    const rf = q('#lw-refresh'); if (rf) rf.onclick = () => load(true);
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
    /* 把界面上的内容写回 cur.text（不落盘、**不删条目**）*/
    const writeMemo = () => memoWriteFromEditor(curMemo());
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
      g.onmousedown = (e) => {
        e.preventDefault(); g.classList.add('on');
        const panel = qa('[data-jpanel]')[idx];
        if (!panel) return;
        const startY = e.clientY, startH = panel.offsetHeight;
        const move = (ev) => { panel.style.height = Math.max(90, Math.min(700, startH + (ev.clientY - startY))) + 'px'; };
        const up = () => {
          document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
          g.classList.remove('on');
          const key = PANEL_KEY[panel.dataset.jpanel];
          if (key) { STORE[key] = panel.offsetHeight; saveStore(); }
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      };
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
      grip.onmousedown = (e) => {
        e.preventDefault(); grip.classList.add('on');
        const startX = e.clientX, startW = jrL.offsetWidth;
        const totalW = (jrL.parentElement || {}).clientWidth || window.innerWidth;
        const move = (ev) => {
          const w = Math.max(220, Math.min(totalW - 300, startW + (ev.clientX - startX)));
          jrL.style.width = w + 'px';
        };
        const up = () => {
          document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
          grip.classList.remove('on');
          STORE.journalLeftW = jrL.offsetWidth; saveStore();
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      };
    }
    if (hgrip && jrE) {
      hgrip.onmousedown = (e) => {
        e.preventDefault(); hgrip.classList.add('on');
        const startY = e.clientY, startH = jrE.offsetHeight;
        const wrapH = (jrE.parentElement || {}).clientHeight || window.innerHeight;
        const move = (ev) => {
          const h = Math.max(160, Math.min(wrapH - 120, startH + (ev.clientY - startY)));
          jrE.style.height = h + 'px';
          const bd = document.getElementById('lw-j-bd'), ta = document.getElementById('lw-j-text');
          if (bd && ta) { const h2 = Math.max(80, h - 170); ta.style.height = h2 + 'px'; bd.style.height = h2 + 'px'; }
        };
        const up = () => {
          document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
          hgrip.classList.remove('on');
          STORE.journalEditH = jrE.offsetHeight; saveStore();
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      };
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
    if (TAB === 'mail') loadMailAccounts();
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
    qa('[data-mailsave]').forEach((btn) => {
      btn.onclick = async () => {
        const k = btn.dataset.mailsave;
        const acc = Object.assign({}, STORE.mailAcc || {});
        const cur = Object.assign({}, acc[k] || {});
        qa('[data-mail="' + k + '"]').forEach((inp) => { cur[inp.dataset.f] = inp.value; });
        acc[k] = cur;
        STORE.mailAcc = acc;
        saveStore();
        try { await fetch('/api/life/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: { [k]: cur } }) }); } catch (_) {}
        const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '邮箱配置已保存（只存本机）';
        load(true);
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
      const extra = td.total ? ("☑ " + td.done + "/" + td.total) : ((String(m.text || "").match(/\|/g) || []).length > 3 ? "1 个表格" : "备忘录");
      /* ⚠️ `▦ 全部列表` 视图下**显示所属文件夹** ✓ ——
         否则"文件夹视图"和"全部列表"看起来一模一样 ✗（用户反馈"这两个按钮没用"✗）。*/
      const folTag = (view === 'all' && (m.folder || '备忘录')) ? '<span class="bd" style="color:' + T.accent + '">' + esc(m.folder || '备忘录') + '</span>' : '';
      return '<div class="lw-nt-row ' + (cur && m.id === cur.id ? "on" : "") + '" data-memo="' + m.id + '" draggable="true" title="拖到左边文件夹可移动归属">'
        + '<div class="c"><div class="tt">' + (m.pin ? '<span class="pin">★ </span>' : "") + esc(String(m.text || "").split("\n")[0].slice(0, 30) || "新备忘录") + '</div>'
        + '<div class="mt"><b>' + when + '</b>' + (body ? "  " + esc(body) : "") + '</div>'
        + '<div class="sub">' + folTag + (td.total ? (td.open ? "▣ " : "▣ ") : "▤ ") + extra + (tagsOf(m.text).length ? " · #" + tagsOf(m.text)[0] : "") + '</div></div></div>';
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
  async function loadMailAccounts() {
    if (MAIL_LOADING) return;
    MAIL_LOADING = true;
    try {
      const r = await fetch('/api/life/mail', { cache: 'no-store' });
      const d = await r.json();
      if (d && d.ok && d.accounts) {
        /* 服务端为准，但保留本地已有的（比如刚填还没保存的）✓ */
        STORE.mailAcc = Object.assign({}, STORE.mailAcc || {}, d.accounts);
        if (TAB === 'mail' && document.getElementById('lifework-view')) render();
      }
    } catch (_) {} finally { MAIL_LOADING = false; }
  }

  function viewMail() {
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
            <button class="lw-btn" data-mailtest="${k}">测试连接</button>
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
          <span style="color:${T.faint}">收信 / 发信还没接 —— 等你的 SMTP 服务就绪后再加。</span>
        </div>
      </div>
      ${cards}
    </div>`;
  }


  function emptyBox(msg) {
    return `<div class="lw-empty"><span class="big">▢</span>${esc(msg)}</div>`;
  }
})();


