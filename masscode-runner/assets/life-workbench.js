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
  .lw-g12 { display:grid; grid-template-columns:repeat(12,1fr); gap:14px; align-items:start; }
  /* 卡片：硬边框 + 标题栏带前缀编码 */
  .lw-c { background:${T.card}; border:2px solid ${T.line}; border-radius:0; }
  .lw-c > h3 { margin:0; padding:8px 11px; font-size:9.5px; font-weight:600; letter-spacing:2px; text-transform:uppercase;
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
  .lw-memo-body { flex:1; display:flex; flex-direction:column; min-height:0; }
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
  .lw-nt-bar { display:flex; align-items:center; gap:6px; padding:8px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-nt-bar button { height:26px; min-width:28px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.text}; font:600 10.5px ${UI}; cursor:pointer; }
  .lw-nt-bar button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-nt-bar button.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
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
  .lw-nt-body { flex:1; overflow:auto; display:flex; flex-direction:column; min-height:0; }
  .lw-nt-meta { padding:12px 20px 0; font-size:11px; color:${T.faint}; text-align:center; }
  .lw-nt-title { border:0; background:transparent; color:${T.text}; font:700 18px ${UI};
    padding:6px 20px 4px; outline:none; }
  .lw-nt-title::placeholder { color:${T.faint}; }
  /* 正文默认就是可编辑的（不再需要双击 ✗）*/
  .lw-nt-ta { flex:1; border:0; background:transparent; color:${T.text}; font:13px/1.85 ${UI};
    padding:2px 20px 16px; resize:none; outline:none; min-height:260px; width:100%; box-sizing:border-box; }
  .lw-nt-ta::placeholder { color:${T.faint}; }
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
  /* 左右分栏（预览开启时）*/
  .lw-nt-split { flex:1; display:flex; min-height:0; }
  .lw-nt-split > .pane { flex:1; min-width:0; display:flex; flex-direction:column; overflow:auto; }
  .lw-nt-split > .pane + .pane { border-left:2px solid ${T.lineDim}; background:#0d0d0c; }
  .lw-nt-split .panehd { padding:6px 14px; font-size:9.5px; letter-spacing:1.4px; color:${T.faint};
    text-transform:uppercase; border-bottom:1px solid ${T.lineDim}; flex:none; }
  .lw-nt-split .panebd { flex:1; overflow:auto; padding:2px 18px 16px; }
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
  .lw-cal-hd { display:flex; align-items:center; gap:9px; padding:10px 12px; border-bottom:1px solid ${T.lineDim}; }
  .lw-cal-hd .m { font-size:13px; font-weight:700; color:${T.text}; letter-spacing:.6px; }
  .lw-cal-hd .sp { flex:1; }
  .lw-cal-hd button { height:24px; padding:0 9px; border:1px solid ${T.lineDim}; background:transparent;
    color:${T.dim}; font:600 10.5px ${UI}; cursor:pointer; }
  .lw-cal-hd button:hover { border-color:${T.accent}; color:${T.accent}; }
  .lw-cal { padding:8px 10px 12px; }
  .lw-cal-wk { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; margin-bottom:4px; }
  .lw-cal-wk span { text-align:center; font-size:9.5px; color:${T.faint}; letter-spacing:.6px; }
  .lw-cal-g { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
  .lw-cal-d { aspect-ratio:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
    border:1px solid transparent; font-size:11.5px; color:${T.dim}; cursor:pointer; position:relative; }
  .lw-cal-d:hover { border-color:${T.lineDim}; color:${T.text}; }
  .lw-cal-d.out { color:#3a3a34; cursor:default; }
  .lw-cal-d.out:hover { border-color:transparent; }
  .lw-cal-d.has { color:${T.text}; font-weight:700; }
  .lw-cal-d.has::after { content:""; position:absolute; bottom:4px; width:4px; height:4px; background:${T.accent}; }
  .lw-cal-d.today { border-color:${T.lineDim}; }
  .lw-cal-d.sel { background:${T.accent}; color:${T.accentInk}; font-weight:700; border-color:${T.accent}; }
  .lw-cal-d.sel::after { background:${T.accentInk}; }
  .lw-jday-hd { padding:12px 16px 4px; font-size:12px; color:${T.dim}; letter-spacing:.5px; }
  .lw-jday-hd b { color:${T.accent}; font-weight:700; }
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
  #btn-lifework.on { background:${T.accent} !important; color:${T.accentInk} !important; }
  `;

  const NAV = [
    { id: 'today', icon: '☀', label: '今日', grp: '面板', key: 'T-01' },
    { id: 'memo', icon: '✎', label: '备忘录', grp: '面板', key: 'M-01', badge: true },
    { id: 'journal', icon: '◈', label: '日记', grp: '面板', key: 'J-01' },
    { id: 'quote', icon: '❝', label: '书签', grp: '面板', key: 'B-01' },
    { id: 'tracks', icon: '◇', label: '研究方向', grp: '科研', key: 'F-01' },
    { id: 'paper', icon: '▤', label: '论文检索', grp: '科研', key: 'P-01' },
    { id: 'files', icon: '▦', label: '文件', grp: '科研', key: 'C-01' },
    { id: 'time', icon: '◔', label: '时间', grp: '科研', key: 'X-01' },
    { id: 'mail', icon: '✉', label: '邮箱', grp: '外部', key: 'E-01' },
  ];

  let DATA = null, STORE = null, WX = null, TAB = 'today', LOADING = false, MOUNT_TIMER = 0, CITY = '广州';

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
    if (!document.getElementById('lifework-style')) {
      const st = document.createElement('style');
      st.id = 'lifework-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    MOUNT_TIMER = setInterval(() => {
      const bar = document.getElementById('header-center');
      if (!bar) return;
      if (document.getElementById('btn-lifework')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btn-lifework';
      btn.className = 'header-action';
      btn.textContent = '个人管理面板';
      btn.title = '个人管理面板：今日 / 备忘录 / 日记 / 研究方向 / 论文检索 / 文件 / 时间 / 邮箱';
      btn.setAttribute('aria-pressed', 'false');
      const anchor = document.getElementById('knowledge-launch') || document.getElementById('btn-system');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
      else bar.appendChild(btn);
      btn.addEventListener('click', () => {
        if (document.getElementById('lifework-view')) hidePanelView();
        else openInPanel();
      });
    }, 600);
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
  }

  /* 关闭：撤掉视图，顶部标签恢复 */
  function hidePanelView() {
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

  function render() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    if (!DATA) { host.innerHTML = headHtml() + '<div class="lw-main">' + skeleton() + '</div>'; bind(); return; }
    CODE_SEQ = 0; KPI_SEQ = 0;   /* 每个视图的编码都从 01 开始 */
    const main = { today: viewToday, memo: viewMemo, journal: viewJournal, quote: viewQuote, tracks: viewTracks, paper: viewPaper, files: viewFiles, time: viewTime, mail: viewMail }[TAB] || viewToday;
    const openTodo = ((STORE && STORE.memos) || []).filter((t) => t.todo && !t.done).length;
    const grps = [];
    NAV.forEach((n) => { if (!grps.includes(n.grp)) grps.push(n.grp); });
    const navHtml = grps.map((g) => `<div class="grp">${g}</div>` + NAV.filter((n) => n.grp === g).map((n) =>
      `<button data-tab="${n.id}" class="${n.id === TAB ? 'on' : ''}"><span class="ic">${n.icon}</span><span>${n.label}</span>` +
      (n.badge && openTodo ? `<span class="badge">${openTodo}</span>` : `<span class="badge">${n.key || ''}</span>`) + `</button>`).join('')).join('');
    host.innerHTML = headHtml() + `<div class="lw-body2">
      <div class="lw-nav">${navHtml}<div class="foot">System <b>OK</b><br>本地运行 · 数据仅存本机</div></div>
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
    if (nSide && oSide) oSide.replaceWith(nSide);
    if (nList && oList) oList.replaceWith(nList);
    /* 只重新绑「左栏 + 中栏」相关的交互（编辑器不碰 ✓）*/
    bindMemoSide();
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
      const ti = q("#lw-memo-title"), ta = q("#lw-memo-body");
      if (ti) cur.text = ti.value + (ta && ta.value ? "\n" + ta.value : (String(cur.text || "").indexOf("\n") >= 0 ? "\n" + String(cur.text).split("\n").slice(1).join("\n") : ""));
      else if (ta) { const t0 = String(cur.text || "").split("\n")[0]; cur.text = t0 + (ta.value ? "\n" + ta.value : ""); }
      cur.edit = Date.now();
      if (!cur.text.trim() || cur.text.trim() === "新备忘录") {
        STORE.memos = (STORE.memos || []).filter((x) => x.id !== cur.id);
        if (STORE.memoSel === cur.id) STORE.memoSel = "";
        saveStore(); return;
      }
      saveStore();
    };
    qa("[data-memo]").forEach((el) => {
      el.onclick = () => { flushMemo(); STORE.memoSel = el.dataset.memo; STORE.memoEditing = ""; saveStore(); render(); };
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
    const q = (sel) => host.querySelector(sel);
    const qa = (sel) => Array.from(host.querySelectorAll(sel));
    qa('.lw-nav button').forEach((b) => { b.onclick = () => { TAB = b.dataset.tab; render(); }; });
    const rf = q('#lw-refresh'); if (rf) rf.onclick = () => load(true);
    qa('[data-path]').forEach((el) => {
      el.onclick = () => { try { navigator.clipboard.writeText(el.dataset.path); const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '已复制路径：' + el.dataset.path; } catch (_) {} };
    });

    /* ── 备忘录（macOS 三栏）：列表 / 文件夹 / 标签 / 格式菜单 / 编辑 / 回收站 ── */
    const memoById = (id) => (STORE.memos || []).find((x) => x.id === id);
    const curMemo = () => memoById(STORE.memoSel) || (STORE.memos || []).filter((m) => !m.trash)[0];
    /* 保存当前编辑内容（自动保存 / 切走 / 保存按钮都用它）*/
    const flushMemo = () => {
      const cur = curMemo(); if (!cur) return;
      const ti = q("#lw-memo-title"), ta = q("#lw-memo-body");
      if (ti) cur.text = ti.value + (ta && ta.value ? "\n" + ta.value : (String(cur.text || "").indexOf("\n") >= 0 ? "\n" + String(cur.text).split("\n").slice(1).join("\n") : ""));
      else if (ta) { const t0 = String(cur.text || "").split("\n")[0]; cur.text = t0 + (ta.value ? "\n" + ta.value : ""); }
      cur.edit = Date.now();
      /* ⚠️ 空的自动丢弃 ✗ —— 点「新建」后不输入就切走，会留下一堆「新备忘录」垃圾 ✗ */
      if (!cur.text.trim() || cur.text.trim() === "新备忘录") {
        STORE.memos = (STORE.memos || []).filter((x) => x.id !== cur.id);
        if (STORE.memoSel === cur.id) STORE.memoSel = "";
        saveStore();
        return;
      }
      STORE.memoSaved = true; saveStore();
      const st = document.getElementById("lw-memo-status");
      if (st) { st.textContent = "✓ 已自动保存"; st.classList.add("ok"); }
      setTimeout(() => { STORE.memoSaved = false; }, 1500);
    };
    let memoBuf = 0;
    const autoSave = () => { clearTimeout(memoBuf); memoBuf = setTimeout(flushMemo, 600); };
    const ti = q("#lw-memo-title"), ta = q("#lw-memo-body");
    if (ti) ti.oninput = autoSave;
    if (ta) ta.oninput = autoSave;
    /* 双击正文 → 进入编辑 */
    const prev = q("#lw-nt-prev");
    if (prev) prev.ondblclick = () => { flushMemo(); STORE.memoEditing = STORE.memoSel; saveStore(); render(); const t2 = document.getElementById("lw-memo-body"); if (t2) t2.focus(); };
    /* 新建 */
    const mNew = q("#lw-memo-new");
    if (mNew) mNew.onclick = () => {
      flushMemo();
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
        const id = STORE.memoSel;
        STORE.memoFmt = STORE.memoFmt || {};
        STORE.memoFmt[id] = el.dataset.mfmt;
        /* 同时把前缀写进正文，导出/预览都保留语义 */
        const cur = curMemo();
        if (cur && el.dataset.mfmt !== "body") {
          const pre = { title: "# ", h2: "## ", h3: "### ", mono: "`", ul: "- ", dash: "– ", ol: "1. ", quote: "> " }[el.dataset.mfmt] || "";
          const lines = String(cur.text || "").split("\n");
          if (lines[1]) lines[1] = pre + lines[1].replace(/^(#+ |[-–>] |1\. |`)/, "");
          cur.text = lines.join("\n");
        }
        STORE.memoMenu = false; saveStore(); render();
      };
    });
    qa("[data-mwrap]").forEach((el) => {
      el.onclick = () => {
        const w = el.dataset.mwrap;
        const elTa = document.getElementById("lw-memo-body");
        if (elTa) { const a = elTa.selectionStart || 0, b = elTa.selectionEnd || 0; const sel = elTa.value.slice(a, b) || "文字"; elTa.value = elTa.value.slice(0, a) + w + sel + w + elTa.value.slice(b); elTa.focus(); }
        else { const cur = curMemo(); if (cur) { const lines = String(cur.text || "").split("\n"); if (lines[1]) lines[1] = w + lines[1] + w; cur.text = lines.join("\n"); saveStore(); render(); } }
      };
    });
    /* 清单 / 表格 快捷插入 */
    const ck = q("#lw-nt-check");
    if (ck) ck.onclick = () => { const elTa = document.getElementById("lw-memo-body"); if (elTa) { elTa.value += (elTa.value ? "\n" : "") + "- [ ] "; elTa.focus(); } else { const cur = curMemo(); if (cur) { cur.text += "\n- [ ] "; saveStore(); render(); } } };
    const tb = q("#lw-nt-table");
    if (tb) tb.onclick = () => { const cur = curMemo(); if (!cur) return; cur.text += "\n| 列1 | 列2 |\n| --- | --- |\n|  |  |"; saveStore(); render(); };
    /* 置顶 / 导出 / 删除 */
    qa("[data-mpin]").forEach((el) => { el.onclick = () => { const m = memoById(el.dataset.mpin); if (m) { m.pin = !m.pin; saveStore(); render(); } }; });
    const mExp = q("#lw-memo-export");
    if (mExp) mExp.onclick = () => {
      const cur = curMemo(); if (!cur) return;
      const blob = new Blob([String(cur.text || "")], { type: "text/markdown;charset=utf-8" });
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(blob);
      a2.download = (String(cur.text || "").split("\n")[0] || "note").slice(0, 40).replace(/[\\/:*?"<>|]/g, "_") + ".md";
      a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 3000);
    };
    const mDel = q("#lw-memo-del");
    if (mDel) mDel.onclick = () => { const cur = curMemo(); if (cur) { cur.trash = true; STORE.memoSel = ""; STORE.memoEditing = ""; saveStore(); render(); } };
    /* 回收站 */
    qa("[data-mrestore]").forEach((el) => { el.onclick = () => { const m = memoById(el.dataset.mrestore); if (m) { m.trash = false; saveStore(); render(); } }; });
    qa("[data-mkill]").forEach((el) => { el.onclick = () => { STORE.memos = (STORE.memos || []).filter((x) => x.id !== el.dataset.mkill); saveStore(); render(); } });
    const tEmpty = q("#lw-trash-empty");
    if (tEmpty) tEmpty.onclick = () => { if (!confirm("清空回收站？无法恢复。")) return; STORE.memos = (STORE.memos || []).filter((x) => !x.trash); saveStore(); render(); };
    /* 快捷键 */
    if (!bind._keys) {
      bind._keys = (e) => {
        if (!document.getElementById("lifework-view")) return;
        if (!(e.metaKey || e.ctrlKey)) return;
        const k = String(e.key || "").toLowerCase();
        if (k === "f") { e.preventDefault(); const i = document.getElementById("lw-memo-q"); if (i) { i.focus(); i.select(); } }
        else if (k === "n" && TAB === "memo") { e.preventDefault(); const b2 = document.getElementById("lw-memo-new"); if (b2) b2.click(); }
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
      const all = STORE.quotes || []; if (!all.length) return;
      const i = Math.floor(Math.random() * all.length);
      const s2 = document.getElementById("lw-sub"); if (s2) s2.textContent = "❝ " + all[i].text + (all[i].from ? " —— " + all[i].from : "");
      render();
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

    /* ── 日记：月历选择日期 ── */
    qa("[data-jday]").forEach((el) => {
      el.onclick = () => { STORE.journalSel = el.dataset.jday; STORE.journalMonth = el.dataset.jday.slice(0, 7); saveStore(); render(); };
    });
    const jDel = q('#lw-j-del');
    if (jDel) jDel.onclick = () => {
      const k = STORE.journalSel;
      if (!k || !confirm('删除 ' + k + ' 的日记？')) return;
      STORE.journal = (STORE.journal || []).filter((x) => x.date !== k);
      saveStore(); render();
    };
    const jPrev = q("#lw-j-prev"), jNext = q("#lw-j-next"), jToday = q("#lw-j-today");
    const shiftMonth = (n) => {
      const d = new Date((STORE.journalMonth || new Date().toISOString().slice(0, 7)) + "-01T00:00:00");
      d.setMonth(d.getMonth() + n);
      STORE.journalMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      saveStore(); render();
    };
    if (jPrev) jPrev.onclick = () => shiftMonth(-1);
    if (jNext) jNext.onclick = () => shiftMonth(1);
    if (jToday) jToday.onclick = () => {
      const d = new Date();
      STORE.journalMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      STORE.journalSel = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      saveStore(); render();
    };
    const jSave = q('#lw-j-save');
    if (jSave) jSave.onclick = () => {
      const d0 = new Date();
      const k = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
      const text = ((q('#lw-j-text') || {}).value || '').trim();
      STORE.journal = STORE.journal || [];
      const hit = STORE.journal.find((x) => x.date === k);
      if (hit) { hit.text = text; hit.at = Date.now(); }
      else STORE.journal.unshift({ date: k, text, at: Date.now() });
      STORE.journal = STORE.journal.filter((x) => x.text);
      saveStore(); render();
      const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '已保存今天的日记';
    };
    qa('[data-jdel]').forEach((el) => {
      el.onclick = () => { STORE.journal = (STORE.journal || []).filter((x) => x.date !== el.dataset.jdel); saveStore(); render(); };
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
    const todos = ((STORE && STORE.todos) || []).filter((t) => !t.done).slice(0, 6);
    const notes = ((STORE && STORE.notes) || []).slice(0, 4);

    const kpis = [
      kpiCard('▦', DATA.totals.projects, '个项目', '已纳管', `覆盖 ${(DATA.tracks || []).length} 个方向`, 3, 'sky'),
      kpiCard('▤', DATA.totals.files, '个文件', `合计 ${DATA.totals.sizeText}`, `近 14 天有 ${days.filter((x) => x.count).length} 天在动`, 3, 'lilac'),
      kpiCard('✎', today.count, '个改动', '今天', diff === 0 ? '与昨天持平' : (diff > 0 ? `<b>+${diff}</b> 比昨天多` : `<b style="color:${T.warn}">${diff}</b> 比昨天少`), 3, 'mint'),
      kpiCard('◈', (DATA.tracks || []).length, '个方向', '机器人 · 嵌入式 · 论文', '按最近改动排序', 3, 'lemon'),
    ].join('');

    const todoBody = todos.length
      ? `<div>${todos.map((t) => `<div class="lw-todo" data-todo-toggle="${t.id}"><span class="ck">✓</span>
          <div class="tx">${esc(t.text)}<div class="due">${ago(t.at)}</div></div></div>`).join('')}</div>`
      : `<div class="lw-empty"><span class="big">✓</span>今天没有待办</div>`;
    const noteBody = notes.length
      ? `<div>${notes.map((n) => `<div class="lw-note"><div class="h">${dstr(n.at).slice(5)}</div>
          <div class="b">${esc(String(n.text).slice(0, 180))}${String(n.text).length > 180 ? '…' : ''}</div></div>`).join('')}</div>`
      : `<div class="lw-empty"><span class="big">✎</span>还没有笔记</div>`;

    return `<div class="lw-g12">${kpis}
      ${card(`${greet} · 待办`, todos.length ? `${todos.length} 项待处理` : '', todoBody, 4, '<span class="act" id="lw-goto-todo">全部 →</span>')}
      ${card('最近笔记', '', noteBody, 4, '<span class="act" id="lw-goto-notes">全部 →</span>')}
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
      return '<div class="lw-nt-row ' + (cur && m.id === cur.id ? "on" : "") + '" data-memo="' + m.id + '">'
        + '<div class="c"><div class="tt">' + (m.pin ? '<span class="pin">★ </span>' : "") + esc(String(m.text || "").split("\n")[0].slice(0, 30) || "新备忘录") + '</div>'
        + '<div class="mt"><b>' + when + '</b>' + (body ? "  " + esc(body) : "") + '</div>'
        + '<div class="sub">' + (td.total ? (td.open ? "▣ " : "▣ ") : "▤ ") + extra + (tagsOf(m.text).length ? " · #" + tagsOf(m.text)[0] : "") + '</div></div></div>';
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
    const listTitle = smart ? (SMART_NAME[smart] || "全部") : (fol ? fol : "iCloud 全部");
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
      + '<button id="lw-nt-aa" class="' + ((STORE && STORE.memoMenu) ? "on" : "") + '" title="格式">Aa</button>'
      + '<button id="lw-nt-check" title="插入清单项">☑</button>'
      + '<button id="lw-nt-table" title="插入表格">▦</button>'
      + '<button id="lw-nt-live" class="' + (STORE.memoLive ? "on" : "") + '" title="Markdown 实时预览">◫ 预览</button>'
      + '<span class="sp"></span>'
      + '<span class="st ' + (STORE.memoSaved ? "ok" : "") + '" id="lw-memo-status">' + (STORE.memoSaved ? "✓ 已自动保存" : "自动保存") + '</span>'
      + '<button data-mpin="' + cur.id + '" title="置顶">' + (cur.pin ? "★" : "☆") + '</button>'
      + '<button id="lw-memo-export" title="导出 Markdown">导出</button>'
      + '<button id="lw-memo-del" title="移到回收站">删除</button></div>'
      + fmtBar
      + '<div class="lw-nt-body"><div class="lw-nt-meta">' + esc(meta) + '</div>'
      + (STORE.memoLive
        ? '<div class="lw-nt-split">'
          + '<div class="pane"><div class="panehd">✎ 编辑</div><div class="panebd" style="display:flex;flex-direction:column">'
          + '<input class="lw-nt-title" id="lw-memo-title" value="' + esc(String(cur.text || "").split("\n")[0]) + '" placeholder="标题" />'
          + '<textarea class="lw-nt-ta" id="lw-memo-body" placeholder="直接在这里写…（# 标题 / **粗体** / - [ ] 清单 / | 表格 | / #标签）">'
          + esc(String(cur.text || "").split("\n").slice(1).join("\n")) + '</textarea></div></div>'
          + '<div class="pane"><div class="panehd">◫ Markdown 实时预览</div><div class="panebd">'
          + '<div class="lw-md2" id="lw-nt-livebody">'
          + (mdToHtml(String(cur.text || "").split("\n").slice(1).join("\n")) || '<span style="color:#5c5a50">（这里会实时显示渲染结果）</span>')
          + '</div></div></div></div>'
        : '<input class="lw-nt-title" id="lw-memo-title" value="' + esc(String(cur.text || "").split("\n")[0]) + '" placeholder="标题" />'
          + '<textarea class="lw-nt-ta" id="lw-memo-body" placeholder="直接在这里写…（支持 Markdown：# 标题 / **粗体** / - 列表 / #标签）">'
          + esc(String(cur.text || "").split("\n").slice(1).join("\n")) + '</textarea>')
      + '</div>'
      : '<div class="lw-nt-bar"><button id="lw-memo-new">✎ 新建</button></div><div class="lw-nt-empty"><span class="big">✎</span>选一条备忘录，或点「✎ 新建」</div>';

    return '<div class="lw-g12"><div class="lw-c" style="grid-column:span 12">'
      + '<h3><span class="code">M-00</span>备忘录<span class="sp"></span><em>macOS 备忘录 · 三栏 · 自动保存</em></h3>'
      + '<div class="lw-nt">' + side + list + '<div class="lw-nt-edit">' + editor + '</div></div>'
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
    /* 每日一句：按日期做种子，保证同一天看到同一条 ✓ */
    const d0 = new Date();
    const daySeed = d0.getFullYear() * 372 + (d0.getMonth() + 1) * 31 + d0.getDate();
    const hero = all.length ? all[daySeed % all.length] : null;
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
  /* ── 日记：月历 + 选中当天编辑（+ 当天天气）── */
  function viewJournal() {
    const d0 = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const keyOf = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    const todayK = keyOf(d0);
    const all = ((STORE && STORE.journal) || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const hasSet = {}; all.forEach((j) => { hasSet[j.date] = j; });
    const mon = (STORE && STORE.journalMonth) || todayK.slice(0, 7);
    const sel = (STORE && STORE.journalSel) || todayK;
    const cur = hasSet[sel] || null;
    const WD = ["日", "一", "二", "三", "四", "五", "六"];
    /* 连续记录 */
    let streak = 0;
    for (let i = 0; i < 400; i++) { const d = new Date(); d.setDate(d.getDate() - i); const k = keyOf(d); if (hasSet[k]) streak++; else if (i > 0) break; }

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
    let wxHtml = "";
    if (WX && WX.ok) {
      const ic = wx(WX.code)[0], nm = wx(WX.code)[1];
      wxHtml = '<div class="lw-c" style="grid-column:span 12"><h3><span class="code">J-04</span>当天天气'
        + '<span class="sp"></span><em>' + esc(WX.city) + '（点顶部天气可换地区）</em></h3>'
        + '<div class="lw-kpi"><div class="row"><div class="ic">' + ic + '</div>'
        + '<div style="flex:1;min-width:0"><div class="num">' + Math.round(WX.temp) + '<small>°C</small></div></div>'
        + '<div style="text-align:right;font-size:11px;color:' + T.dim + ';line-height:1.8">' + esc(nm) + '<br>体感 ' + Math.round(WX.feels) + '° · 湿 ' + WX.hum + '%<br>风 ' + WX.wind + ' km/h</div></div>'
        + '<div class="cmp">' + (WX.days || []).slice(0, 3).map((x) => esc(x.date.slice(5)) + " " + wx(x.code)[0] + " " + Math.round(x.min) + "~" + Math.round(x.max) + "°").join("　") + '</div></div></div>';
    }

    return '<div class="lw-g12">'
      + '<div class="lw-c" style="grid-column:span 5"><h3><span class="code">J-01</span>日历<span class="sp"></span><em>' + all.length + ' 篇</em></h3>' + cal + '</div>'
      + '<div class="lw-c" style="grid-column:span 7"><h3><span class="code">J-02</span>' + esc(sel) + ' · ' + wdName + '<span class="sp"></span><em>' + (cur ? "已写 " + String(cur.text || "").length + " 字" : "还没写") + '</em></h3>'
      + '<div class="lw-pad"><textarea class="lw-jtext" id="lw-j-text" placeholder="今天做了什么 / 卡在哪 / 明天要做什么…">' + (cur ? esc(cur.text) : "") + '</textarea>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">'
      + (cur ? '<button class="lw-btn" id="lw-j-del">删除这篇</button>' : "")
      + '<button class="lw-btn" id="lw-j-save">保存</button></div></div></div>'
      + '<div class="lw-c" style="grid-column:span 4"><h3><span class="code">J-03</span>连续记录<span class="sp"></span><em>共 ' + all.length + ' 篇</em></h3>'
      + '<div class="lw-kpi"><div class="row"><div class="ic">◈</div><div style="flex:1;min-width:0"><div class="num">' + streak + '<small>天</small></div></div></div>'
      + '<div class="cmp">' + (streak ? "继续保持" : "今天开个头") + '</div></div>'
      + '<h3 style="border-top:1px solid ' + T.lineDim + '"><span class="code">J-05</span>最近写过</h3>'
      + '<div class="lw-tbl">' + (all.length ? all.slice(0, 6).map((j) => '<div class="lw-tr" data-jday="' + esc(j.date) + '">'
          + '<span class="nm">' + esc(j.date.slice(5)) + '</span><span class="bd">' + String(j.text || "").length + ' 字</span>'
          + '<span class="tm">' + esc(String(j.text || "").slice(0, 10)) + '</span></div>').join("") : '<div class="lw-empty">还没写过</div>') + '</div></div>'
      + wxHtml
      + '</div>';
  }

  /* ── 研究方向 ── */
  function viewTracks() {
    const tracks = DATA.tracks || [];
    if (!tracks.length) return emptyBox('还没扫到项目');
    const max = Math.max(1, ...tracks.map((t) => t.files));
    const list = tracks.map((t) => card(`${t.icon} ${esc(t.name)}`,
      `${t.projects} 项目 · ${t.files} 文件 · ${t.sizeText}`,
      `<div class="lw-pad" style="padding-bottom:0"><div style="height:7px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden">
        <i style="display:block;height:100%;width:${Math.round(t.files / max * 100)}%;background:${t.color}"></i></div></div>
       <div class="lw-tbl">${t.list.map((p) => `<div class="lw-tr" data-path="${esc(p.path)}">
        <span class="nm">${esc(p.name)} <i>${esc(p.base)}</i></span>
        <span class="bd">${p.files} 文件</span><span class="sz">${p.sizeText}</span>
        <span class="tm">${ago(p.newest)}</span></div>`).join('')}</div>`, 6)).join('');
    return `<div class="lw-g12">${list}</div>`;
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
    wx: { name: '无限邮', host: '', port: '', imapHost: '', imapPort: '', web: '' },
  };
  function viewMail() {
    const acc = (STORE && STORE.mailAcc) || {};
    const keys = Object.keys(MAIL_PRESET);
    const cards = keys.map((k, i) => {
      const P = MAIL_PRESET[k];
      const a = acc[k] || {};
      return `<div class="lw-c" style="${sp(6)}">
        <h3><span class="code">E-0${i + 1}</span>${esc(P.name)}<span class="sp"></span><em>${a.user ? esc(a.user) : '未配置'}</em></h3>
        <div class="lw-pad">
          <div class="lw-form">
            <label>SMTP 服务器<input data-mail="${k}" data-f="host" placeholder="${esc(P.host || 'smtp.example.com')}" value="${esc(a.host || '')}"/></label>
            <label>端口<input data-mail="${k}" data-f="port" placeholder="${esc(P.port || '465')}" value="${esc(a.port || '')}"/></label>
            <label>邮箱账号<input data-mail="${k}" data-f="user" placeholder="you@example.com" value="${esc(a.user || '')}"/></label>
            <label>授权码 / 密码<input data-mail="${k}" data-f="pass" type="password" placeholder="${a.hasPass ? '已保存（留空不改）' : '授权码'}" value=""/></label>
            <label>IMAP 服务器<input data-mail="${k}" data-f="imapHost" placeholder="${esc(P.imapHost || 'imap.example.com')}" value="${esc(a.imapHost || '')}"/></label>
          </div>
          <div style="display:flex;gap:8px;margin-top:11px">
            <button class="lw-btn" data-mailsave="${k}">保存</button>
            ${P.web ? `<a class="lw-btn" href="${P.web}" target="_blank" rel="noopener" style="text-decoration:none">打开网页版</a>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
    return `<div class="lw-g12">
      <div class="lw-c" style="${sp(12)}">
        <h3><span class="code">E-00</span>说明<span class="sp"></span></h3>
        <div class="lw-pad" style="font-size:12px;line-height:1.9;color:${T.dim}">
          填好 SMTP / IMAP 后点「保存」——配置只存本机（life-mail.json），不上传。<br>
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


