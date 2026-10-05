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
  .lw-inpanel { position:absolute; inset:0; display:flex; flex-direction:column; background:${T.bg}; overflow:hidden;
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
  /* 备忘录：左列表 + 右详情（Apple 备忘录的两栏结构） */
  .lw-mlist { display:flex; flex-direction:column; max-height:560px; overflow:auto; }
  .lw-mrow { padding:9px 12px; border-bottom:1px solid ${T.lineDim}; cursor:pointer; transition:background .12s; }
  .lw-mrow:hover { background:#141412; }
  .lw-mrow.on { background:${T.accent}; color:${T.accentInk}; }
  .lw-mrow.on .s, .lw-mrow.on .d { color:${T.accentInk}; opacity:.7; }
  .lw-mrow .t { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-mrow .s { font-size:10.5px; color:${T.dim}; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-mrow .d { font-size:9.5px; color:${T.faint}; margin-top:3px; letter-spacing:.6px; }
  .lw-mdetail { display:flex; flex-direction:column; min-height:460px; }
  .lw-mtitle { border:0; border-bottom:1px solid ${T.lineDim}; background:transparent; color:${T.text};
    font:600 15px ${UI}; padding:13px 14px; outline:none; }
  .lw-mbody { flex:1; border:0; background:transparent; color:${T.text}; font:12.5px/1.75 ${UI};
    padding:12px 14px; resize:none; outline:none; min-height:300px; }
  .lw-mtools { display:flex; align-items:center; gap:9px; padding:11px 14px; border-top:1px solid ${T.lineDim}; }
  .lw-mck { display:flex; align-items:center; gap:7px; font-size:11px; color:${T.dim}; cursor:pointer; letter-spacing:.6px; }
  .lw-mck input { accent-color:${T.accent}; }
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
  #system-nav-list button[data-section="lifework"] i { color:${T.accent}; }
  `;

  const NAV = [
    { id: 'today', icon: '☀', label: '今日', grp: '面板', key: 'T-01' },
    { id: 'memo', icon: '✎', label: '备忘录', grp: '面板', key: 'M-01', badge: true },
    { id: 'journal', icon: '◈', label: '日记', grp: '面板', key: 'J-01' },
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

  /* ── 挂载：注入「本机管家」侧栏（DOM 注入，不改那个 302KB 压缩文件） ── */
  function mount() {
    if (MOUNT_TIMER) return;
    if (!document.getElementById('lifework-style')) {
      const st = document.createElement('style');
      st.id = 'lifework-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    MOUNT_TIMER = setInterval(() => {
      const nav = document.getElementById('system-nav-list');
      const main = document.getElementById('system-main');
      if (!nav || !main) return;
      try { if (getComputedStyle(main).position === 'static') main.style.position = 'relative'; } catch (_) {}
      if (nav.querySelector('[data-section="lifework"]')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.section = 'lifework';
      btn.title = '个人管理面板：今日 / 待办 / 笔记 / 研究方向 / 论文 / 文件 / 时间 / 邮箱';
      btn.innerHTML = '<i>🎯</i><span>我的工作台</span>';
      btn.addEventListener('click', () => openInPanel());
      nav.appendChild(btn);
      nav.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('button[data-section]') : null;
        if (b && b.dataset.section !== 'lifework') hidePanelView();
      }, true);
    }, 600);
  }

  function openInPanel() {
    mount();
    const nav = document.getElementById('system-nav-list');
    const main = document.getElementById('system-main');
    if (!nav || !main) return;
    nav.querySelectorAll('button[data-section]').forEach((b) => b.classList.toggle('on', b.dataset.section === 'lifework'));
    [...main.children].forEach((c) => { if (c.id !== 'lifework-view') c.style.display = 'none'; });
    let view = document.getElementById('lifework-view');
    if (!view) {
      view = document.createElement('div');
      view.id = 'lifework-view';
      view.className = 'lw-inpanel';
      main.appendChild(view);
    }
    view.style.display = '';
    if (!DATA) load(false); else render();
  }

  function hidePanelView() {
    const view = document.getElementById('lifework-view');
    if (view) view.remove();
    const main = document.getElementById('system-main');
    if (main) [...main.children].forEach((c) => { c.style.display = ''; });
  }

  async function load(force) {
    if (LOADING) return;
    LOADING = true;
    const s = document.getElementById('lw-sub');
    if (s) s.textContent = '正在扫描本机文件…';
    const j = async (u, opt) => { try { const r = await fetch(u, opt); return await r.json(); } catch (_) { return null; } };
    const [idx, store, weather] = await Promise.all([
      j('/api/life/index?depth=3', { cache: 'no-store' }),
      j('/api/life/store', { cache: 'no-store' }),
      j('/api/life/weather?city=' + encodeURIComponent(CITY), { cache: 'no-store' }),
    ]);
    if (idx && idx.ok) DATA = idx;
    STORE = (store && store.data) || {};
    if (STORE.city) CITY = STORE.city;
    if (weather && weather.ok) WX = weather;
    LOADING = false;
    render();
  }

  async function saveStore() {
    try {
      await fetch('/api/life/store', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(STORE || {}),
      });
    } catch (_) {}
  }

  function render() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    if (!DATA) { host.innerHTML = headHtml() + '<div class="lw-main">' + skeleton() + '</div>'; bind(); return; }
    CODE_SEQ = 0; KPI_SEQ = 0;   /* 每个视图的编码都从 01 开始 */
    const main = { today: viewToday, memo: viewMemo, journal: viewJournal, tracks: viewTracks, paper: viewPaper, files: viewFiles, time: viewTime, mail: viewMail }[TAB] || viewToday;
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
      <div class="lw-h1">我的工作台<small>Personal Command</small></div>
      <div class="lw-sub2" id="lw-sub">${esc(sub)}</div>
      ${wxHtml}
      <button class="lw-btn" id="lw-refresh">↻ 刷新</button></div>`;
  }

  function bind() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    const q = (sel) => host.querySelector(sel);
    const qa = (sel) => Array.from(host.querySelectorAll(sel));
    qa('.lw-nav button').forEach((b) => { b.onclick = () => { TAB = b.dataset.tab; render(); }; });
    const rf = q('#lw-refresh'); if (rf) rf.onclick = () => load(true);
    qa('[data-path]').forEach((el) => {
      el.onclick = () => { try { navigator.clipboard.writeText(el.dataset.path); const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '已复制路径：' + el.dataset.path; } catch (_) {} };
    });

    /* ── 备忘录 ── */
    qa('[data-memo]').forEach((el) => {
      el.onclick = () => { STORE.memoSel = el.dataset.memo; saveStore(); render(); };
    });
    const mNew = q('#lw-memo-new');
    if (mNew) mNew.onclick = () => {
      const id = 'm' + Date.now();
      STORE.memos = STORE.memos || [];
      STORE.memos.unshift({ id, text: '新备忘录', todo: false, done: false, at: Date.now() });
      STORE.memoSel = id; saveStore(); render();
      const t = document.getElementById('lw-memo-title'); if (t) { t.focus(); t.select(); }
    };
    const mSave = q('#lw-memo-save');
    if (mSave) mSave.onclick = () => {
      const cur = (STORE.memos || []).find((x) => x.id === STORE.memoSel);
      if (!cur) return;
      const title = (q('#lw-memo-title') || {}).value || '';
      const body = (q('#lw-memo-body') || {}).value || '';
      cur.text = title + (body ? '\n' + body : '');
      cur.todo = !!(q('#lw-memo-todo') || {}).checked;
      cur.at = Date.now();
      saveStore(); render();
      const s2 = document.getElementById('lw-sub'); if (s2) s2.textContent = '已保存备忘录';
    };
    const mDel = q('#lw-memo-del');
    if (mDel) mDel.onclick = () => {
      STORE.memos = (STORE.memos || []).filter((x) => x.id !== STORE.memoSel);
      STORE.memoSel = (STORE.memos[0] || {}).id || '';
      saveStore(); render();
    };

    /* ── 日记 ── */
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
  function viewMemo() {
    const all = ((STORE && STORE.memos) || []).slice().sort((a, b) => b.at - a.at);
    const sel = (STORE && STORE.memoSel) || (all[0] && all[0].id) || '';
    const cur = all.find((x) => x.id === sel) || all[0] || null;
    const list = all.length ? all.map((m) => {
      const lines = String(m.text || '').split('\n');
      const first = (lines[0] || '').slice(0, 30) || '(空)';
      const sub = lines.slice(1).join(' ').slice(0, 28);
      return `<div class="lw-mrow ${cur && m.id === cur.id ? 'on' : ''}" data-memo="${m.id}">
        <div class="t">${m.todo ? '☑ ' : ''}${esc(first)}</div>
        <div class="s">${esc(sub || (m.todo ? '待办清单' : '备忘录'))}</div>
        <div class="d">${dstr(m.at).slice(5, 16)}</div></div>`;
    }).join('') : `<div class="lw-empty"><span class="big">✎</span>还没有备忘录</div>`;
    const detail = cur ? `<div class="lw-mdetail">
        <input class="lw-mtitle" id="lw-memo-title" value="${esc(String(cur.text || '').split('\n')[0])}" placeholder="标题" />
        <textarea class="lw-mbody" id="lw-memo-body" placeholder="正文…">${esc(String(cur.text || '').split('\n').slice(1).join('\n'))}</textarea>
        <div class="lw-mtools">
          <label class="lw-mck"><input type="checkbox" id="lw-memo-todo" ${cur.todo ? 'checked' : ''}/> 待办清单</label>
          <span style="flex:1"></span>
          <button class="lw-btn" id="lw-memo-save">保存</button>
          <button class="lw-btn" id="lw-memo-del">删除</button>
        </div></div>` : `<div class="lw-empty"><span class="big">✎</span>选一条，或点上面「＋ 新建」</div>`;
    return `<div class="lw-g12">
      <div class="lw-c" style="${sp(4)}">
        <h3><span class="code">M-01</span>备忘录<span class="sp"></span><em>${all.length} 条</em><span class="act" id="lw-memo-new">＋ 新建</span></h3>
        <div class="lw-mlist">${list}</div>
      </div>
      <div class="lw-c" style="${sp(8)}">
        <h3><span class="code">M-02</span>${cur ? '编辑' : '详情'}<span class="sp"></span><em>${cur ? dstr(cur.at) : ''}</em></h3>
        ${detail}
      </div>
    </div>`;
  }

  /* ── 日记（按天一条 + 时间线）── */
  function viewJournal() {
    const d0 = new Date();
    const tk = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
    const all = ((STORE && STORE.journal) || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const cur = all.find((x) => x.date === tk) || null;
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (all.some((x) => x.date === k)) streak++; else if (i > 0) break;
    }
    const todayFiles = (DATA.recent || []).filter((f) => new Date(f.mtime).toDateString() === d0.toDateString()).slice(0, 8);
    const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const timeline = all.length ? all.map((j) => {
      const wd = WD[new Date(j.date + 'T00:00:00').getDay()] || '';
      return `<div class="lw-jrow"><div class="lw-jdate"><b>${esc(j.date.slice(5))}</b><span>${wd}</span></div>
        <div class="lw-jbody">${esc(j.text)}</div><span class="del" data-jdel="${esc(j.date)}">✕</span></div>`;
    }).join('') : `<div class="lw-empty"><span class="big">◈</span>还没有日记</div>`;
    return `<div class="lw-g12">
      <div class="lw-c" style="${sp(7)}">
        <h3><span class="code">J-01</span>今天 · ${esc(tk)}<span class="sp"></span><em>${cur ? '已写' : '还没写'}</em></h3>
        <div class="lw-pad">
          <textarea class="lw-jtext" id="lw-j-text" placeholder="今天做了什么 / 卡在哪 / 明天要做什么…">${cur ? esc(cur.text) : ''}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="lw-btn" id="lw-j-save">保存今天</button></div>
        </div>
      </div>
      <div class="lw-c" style="${sp(5)}">
        <h3><span class="code">J-02</span>连续记录<span class="sp"></span><em>共 ${all.length} 篇</em></h3>
        <div class="lw-kpi"><div class="row"><div class="ic">◈</div>
          <div style="flex:1;min-width:0"><div class="num">${streak}<small>天</small></div></div></div>
          <div class="cmp">${streak ? '继续保持' : '今天开个头'}</div></div>
        <h3 style="border-top:1px solid ${T.lineDim}"><span class="code">J-03</span>今天动过的文件</h3>
        <div class="lw-tbl">${todayFiles.length ? todayFiles.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)}</span><span class="bd">${esc(f.ext || '—')}</span>
          <span class="tm">${ago(f.mtime)}</span></div>`).join('') : `<div class="lw-empty">今天还没动文件</div>`}</div>
      </div>
      <div class="lw-c" style="${sp(12)}">
        <h3><span class="code">J-04</span>日记时间线<span class="sp"></span><em>${all.length} 篇</em></h3>
        <div class="lw-jlist">${timeline}</div>
      </div>
    </div>`;
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


