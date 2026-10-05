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

  /* ── 设计令牌：苹果风 · 柔和马卡龙（参考 Intelly Healthcare Dashboard）──
     要点：柔和的粉彩底 + 大圆角 + 柔和阴影（不用硬描边）+ 明快对比 +
     圆润的图标块（像 iOS 设置页）。整体感觉「轻、亮、有活力」。 */
  const T = {
    bg: '#f6f7fb', bg2: '#ffffff', card: '#ffffff',
    line: 'rgba(17,24,39,.07)', line2: 'rgba(17,24,39,.12)',
    text: '#1b1f2a', dim: '#6b7280', faint: '#9aa3b2',
    accent: '#5b8def', accent2: '#8b7cf6', ok: '#34c77b', warn: '#f5a524', red: '#f26d6d',
    mint: '#e8f8f1', lilac: '#efecfe', sky: '#e8f0fe', peach: '#fef1e8', rose: '#fdeef3', lemon: '#fdf6e3',
    mintInk: '#1f9d68', lilacInk: '#6d5ce0', skyInk: '#3b74d6', peachInk: '#d9782f', roseInk: '#d8557f', lemonInk: '#c08a12',
    shadow: '0 1px 2px rgba(17,24,39,.04), 0 6px 20px rgba(17,24,39,.06)',
    shadowHover: '0 2px 6px rgba(17,24,39,.06), 0 12px 32px rgba(17,24,39,.10)',
  };
  const KIND_COLOR = { code: '#5b8def', doc: '#f5a524', media: '#8b7cf6', model: '#34c77b', other: '#9aa3b2' };
  const KIND_NAME = { code: '代码', doc: '文档', media: '媒体/图', model: '三维模型', other: '其他' };
  const UI = '-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  const MONO = '"SF Mono",SFMono-Regular,Menlo,monospace';

  const CSS = `
  .lw-inpanel { position:absolute; inset:0; display:flex; flex-direction:column; overflow:hidden;
    background:${T.bg}; font-family:${UI}; color:${T.text}; font-size:13.5px;
    -webkit-font-smoothing:antialiased; }
  /* 顶栏：白底 + 极轻分隔 */
  .lw-head { display:flex; align-items:center; gap:16px; padding:14px 24px; flex:none;
    background:${T.bg2}; border-bottom:1px solid ${T.line}; }
  .lw-logo { width:38px; height:38px; flex:none; border-radius:12px;
    background:linear-gradient(160deg,${T.accent},${T.accent2}); display:flex; align-items:center;
    justify-content:center; font-size:18px; box-shadow:0 4px 12px rgba(91,141,239,.28); }
  .lw-h1 { font-size:15px; font-weight:600; letter-spacing:-.2px; line-height:1.2; }
  .lw-h1 small { display:block; font-size:11px; color:${T.faint}; font-weight:400; margin-top:2px; }
  .lw-sub2 { font-size:12.5px; color:${T.dim}; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-btn { height:34px; padding:0 16px; border-radius:11px; border:1px solid ${T.line2}; background:${T.bg2};
    color:${T.text}; font:500 13px ${UI}; cursor:pointer; flex:none; transition:all .16s; }
  .lw-btn:hover { background:${T.sky}; border-color:rgba(91,141,239,.35); color:${T.skyInk}; }
  /* 天气胶囊 */
  .lw-wx { display:flex; align-items:center; gap:11px; padding:6px 15px 6px 12px; border-radius:14px;
    background:${T.lemon}; flex:none; }
  .lw-wx .wi { font-size:21px; line-height:1; }
  .lw-wx .wt { font-size:17px; font-weight:600; color:${T.lemonInk}; letter-spacing:-.3px; }
  .lw-wx .wc { font-size:11px; color:${T.lemonInk}; opacity:.85; line-height:1.35; }
  /* 主体 */
  .lw-body2 { flex:1; display:flex; min-height:0; }
  .lw-nav { width:196px; flex:none; padding:16px 12px; background:${T.bg2}; border-right:1px solid ${T.line};
    display:flex; flex-direction:column; overflow:auto; }
  .lw-nav .grp { margin:10px 10px 7px; font-size:11px; letter-spacing:.4px; color:${T.faint}; font-weight:600; }
  .lw-nav button { width:100%; height:36px; display:flex; align-items:center; gap:11px; padding:0 11px; margin-bottom:3px;
    border:0; border-radius:10px; background:transparent; color:${T.dim};
    font:500 13px ${UI}; cursor:pointer; text-align:left; transition:all .15s; }
  .lw-nav button:hover { background:${T.bg}; color:${T.text}; }
  .lw-nav button.on { background:${T.sky}; color:${T.skyInk}; font-weight:600; }
  .lw-nav .ic { width:20px; text-align:center; font-size:15px; }
  .lw-nav .badge { margin-left:auto; font-size:11px; padding:1px 8px; border-radius:999px;
    background:${T.rose}; color:${T.roseInk}; font-weight:600; }
  .lw-nav .foot { margin-top:auto; padding:14px 10px 0; border-top:1px solid ${T.line};
    font-size:11px; color:${T.faint}; line-height:1.8; }
  .lw-nav .foot b { color:${T.ok}; font-weight:600; }
  .lw-main { flex:1; min-width:0; overflow:auto; padding:22px 24px 36px; }
  .lw-main::-webkit-scrollbar { width:10px; } .lw-main::-webkit-scrollbar-thumb { background:rgba(17,24,39,.14); border-radius:6px; }
  .lw-g12 { display:grid; grid-template-columns:repeat(12,1fr); gap:18px; align-items:start; }
  /* 卡片：白底 + 大圆角 + 柔和阴影（不描边） */
  .lw-c { background:${T.card}; border-radius:18px; overflow:hidden; box-shadow:${T.shadow}; transition:box-shadow .2s; }
  .lw-c:hover { box-shadow:${T.shadowHover}; }
  .lw-c > h3 { margin:0; padding:15px 18px 12px; font-size:13.5px; font-weight:600; color:${T.text};
    display:flex; align-items:center; gap:9px; letter-spacing:-.1px; }
  .lw-c > h3 .sp { flex:1; }
  .lw-c > h3 em { font-style:normal; color:${T.faint}; font-weight:400; font-size:11.5px; }
  .lw-c > h3 .act { font-size:12px; color:${T.accent}; cursor:pointer; font-weight:500; }
  .lw-c > h3 .act:hover { text-decoration:underline; }
  .lw-pad { padding:0 18px 18px; }
  /* KPI：圆润图标块 + 大数字 */
  .lw-kpi { padding:18px; }
  .lw-kpi .row { display:flex; align-items:center; gap:13px; }
  .lw-kpi .ic { width:44px; height:44px; flex:none; border-radius:14px; display:flex; align-items:center;
    justify-content:center; font-size:19px; }
  .lw-kpi .num { font-size:29px; font-weight:600; line-height:1; letter-spacing:-1px; font-variant-numeric:tabular-nums; }
  .lw-kpi .num small { font-size:12px; font-weight:500; color:${T.dim}; margin-left:5px; letter-spacing:0; }
  .lw-kpi .lbl { font-size:12.5px; color:${T.dim}; margin-top:12px; }
  .lw-kpi .cmp { font-size:12px; color:${T.faint}; margin-top:4px; }
  .lw-kpi .cmp b { color:${T.ok}; font-weight:600; }
  /* 列表 */
  .lw-tbl { display:flex; flex-direction:column; padding:0 6px 8px; }
  .lw-tr { display:flex; align-items:center; gap:12px; min-height:44px; padding:0 12px; cursor:pointer;
    border-radius:11px; transition:background .14s; }
  .lw-tr:hover { background:${T.bg}; }
  .lw-tr .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  .lw-tr .nm i { font-style:normal; color:${T.faint}; font-size:11.5px; }
  .lw-tr .sz { flex:none; font-size:11.5px; color:${T.dim}; text-align:right; width:64px; font-variant-numeric:tabular-nums; }
  .lw-tr .tm { flex:none; font-size:11.5px; color:${T.faint}; width:68px; text-align:right; }
  .lw-tr .bd { flex:none; font-size:11px; padding:3px 9px; border-radius:8px; background:${T.bg}; color:${T.dim}; }
  /* 待办 */
  .lw-todo { display:flex; align-items:flex-start; gap:12px; padding:11px 18px; }
  .lw-todo:hover { background:${T.bg}; }
  .lw-todo .ck { width:20px; height:20px; flex:none; margin-top:1px; border-radius:7px; border:1.5px solid ${T.line2};
    cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px; color:transparent; transition:all .15s; }
  .lw-todo .ck:hover { border-color:${T.ok}; }
  .lw-todo.done .ck { background:${T.ok}; border-color:${T.ok}; color:#fff; }
  .lw-todo .tx { flex:1; min-width:0; font-size:13px; line-height:1.5; word-break:break-word; }
  .lw-todo.done .tx { color:${T.faint}; text-decoration:line-through; }
  .lw-todo .due { font-size:11px; color:${T.faint}; margin-top:3px; }
  .lw-todo .del { flex:none; font-size:15px; color:${T.faint}; cursor:pointer; opacity:0; padding:0 5px; }
  .lw-todo:hover .del { opacity:1; }
  .lw-todo .del:hover { color:${T.red}; }
  .lw-add { display:flex; gap:9px; padding:13px 18px 16px; }
  .lw-add input { flex:1; min-width:0; height:36px; padding:0 13px; border-radius:11px;
    border:1px solid ${T.line2}; background:${T.bg}; color:${T.text}; font:13px ${UI}; outline:none; transition:all .15s; }
  .lw-add input:focus { border-color:${T.accent}; background:#fff; box-shadow:0 0 0 3px rgba(91,141,239,.12); }
  .lw-add button { height:36px; padding:0 17px; border-radius:11px; border:0;
    background:linear-gradient(160deg,${T.accent},${T.accent2}); color:#fff; font:600 13px ${UI};
    cursor:pointer; box-shadow:0 3px 10px rgba(91,141,239,.28); }
  /* 笔记 */
  .lw-note { padding:12px 18px; }
  .lw-note:hover { background:${T.bg}; }
  .lw-note .h { display:flex; align-items:center; gap:8px; font-size:11px; color:${T.faint}; margin-bottom:6px; }
  .lw-note .h .del { margin-left:auto; cursor:pointer; opacity:0; }
  .lw-note:hover .h .del { opacity:1; }
  .lw-note .h .del:hover { color:${T.red}; }
  .lw-note .b { font-size:13px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }
  .lw-note textarea { width:100%; min-height:76px; resize:vertical; padding:12px 13px; border-radius:12px;
    border:1px solid ${T.line2}; background:${T.bg}; color:${T.text}; font:13px/1.6 ${UI}; outline:none; transition:all .15s; }
  .lw-note textarea:focus { border-color:${T.accent}; background:#fff; box-shadow:0 0 0 3px rgba(91,141,239,.12); }
  /* 快捷入口：马卡龙色块 */
  .lw-links { display:grid; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); gap:11px; }
  .lw-link { display:flex; align-items:center; gap:11px; padding:13px 14px; border-radius:14px;
    background:${T.bg}; color:${T.text}; text-decoration:none; font-size:13px; font-weight:500;
    cursor:pointer; transition:all .16s; }
  .lw-link:hover { background:${T.sky}; color:${T.skyInk}; transform:translateY(-2px); box-shadow:${T.shadow}; }
  .lw-link .ic { font-size:17px; }
  /* 柱状 / 折线 */
  .lw-bars { display:flex; align-items:flex-end; gap:7px; height:128px; }
  .lw-bars > div { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:6px; height:100%; }
  .lw-bars .v { font-size:11px; color:${T.dim}; font-variant-numeric:tabular-nums; }
  .lw-bars .b { width:100%; border-radius:7px 7px 3px 3px; background:linear-gradient(180deg,#8fb3f5,${T.accent}); }
  .lw-bars > div:hover .b { background:linear-gradient(180deg,${T.accent2},${T.accent}); }
  .lw-bars .k { font-size:10.5px; color:${T.faint}; }
  .lw-empty { padding:30px 18px; text-align:center; color:${T.faint}; font-size:13px; }
  .lw-empty .big { font-size:24px; display:block; margin-bottom:8px; opacity:.5; }
  .lw-sk { background:linear-gradient(90deg,#eef0f5 25%,#f7f8fb 37%,#eef0f5 63%);
    background-size:400% 100%; animation:lw-sk 1.3s ease infinite; border-radius:10px; }
  @keyframes lw-sk { 0%{background-position:100% 50%} 100%{background-position:0 50%} }
  .lw-chips { display:flex; flex-wrap:wrap; gap:8px; }
  .lw-chip { font-size:11.5px; padding:5px 11px; border-radius:9px; background:${T.bg}; color:${T.dim}; }
  .lw-chip b { color:${T.accent}; font-weight:600; margin-left:5px; }
  #system-nav-list button[data-section="lifework"] i { color:${T.accent}; }
  `;

  const NAV = [
    { id: 'today', icon: '🏠', label: '今日', grp: '面板' },
    { id: 'todo', icon: '✓', label: '待办', grp: '面板', badge: true },
    { id: 'notes', icon: '✎', label: '笔记', grp: '面板' },
    { id: 'tracks', icon: '🎯', label: '研究方向', grp: '科研' },
    { id: 'paper', icon: '📄', label: '论文', grp: '科研' },
    { id: 'files', icon: '🗂', label: '文件', grp: '科研' },
    { id: 'time', icon: '📈', label: '时间', grp: '科研' },
    { id: 'mail', icon: '✉️', label: '邮箱 / 入口', grp: '外部' },
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
    const main = { today: viewToday, todo: viewTodo, notes: viewNotes, tracks: viewTracks, paper: viewPaper, files: viewFiles, time: viewTime, mail: viewMail }[TAB] || viewToday;
    const openTodo = ((STORE && STORE.todos) || []).filter((t) => !t.done).length;
    const grps = [];
    NAV.forEach((n) => { if (!grps.includes(n.grp)) grps.push(n.grp); });
    const navHtml = grps.map((g) => `<div class="grp">${g}</div>` + NAV.filter((n) => n.grp === g).map((n) =>
      `<button data-tab="${n.id}" class="${n.id === TAB ? 'on' : ''}"><span class="ic">${n.icon}</span><span>${n.label}</span>` +
      (n.badge && openTodo ? `<span class="badge">${openTodo}</span>` : '') + `</button>`).join('')).join('');
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
    host.querySelectorAll('.lw-nav button').forEach((b) => { b.onclick = () => { TAB = b.dataset.tab; render(); }; });
    const rf = host.querySelector('#lw-refresh');
    if (rf) rf.onclick = () => load(true);
    host.querySelectorAll('[data-path]').forEach((el) => {
      el.onclick = () => {
        try {
          navigator.clipboard.writeText(el.dataset.path);
          const s = document.getElementById('lw-sub');
          if (s) s.textContent = '已复制路径：' + el.dataset.path;
        } catch (_) {}
      };
    });
    /* 待办交互 */
    host.querySelectorAll('[data-todo-toggle]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const t = (STORE.todos || []).find((x) => x.id === el.dataset.todoToggle);
        if (t) { t.done = !t.done; saveStore(); render(); }
      };
    });
    host.querySelectorAll('[data-todo-del]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        STORE.todos = (STORE.todos || []).filter((x) => x.id !== el.dataset.todoDel);
        saveStore(); render();
      };
    });
    const addBtn = host.querySelector('#lw-todo-add');
    const addInput = host.querySelector('#lw-todo-input');
    if (addBtn && addInput) {
      const add = () => {
        const v = addInput.value.trim();
        if (!v) return;
        STORE.todos = STORE.todos || [];
        STORE.todos.unshift({ id: 't' + Date.now(), text: v, done: false, at: Date.now() });
        addInput.value = '';
        saveStore(); render();
        const i2 = document.getElementById('lw-todo-input');
        if (i2) i2.focus();
      };
      addBtn.onclick = add;
      addInput.onkeydown = (e) => { if (e.key === 'Enter') add(); };
    }
    /* 笔记交互 */
    const nSave = host.querySelector('#lw-note-add');
    const nInput = host.querySelector('#lw-note-input');
    if (nSave && nInput) {
      nSave.onclick = () => {
        const v = nInput.value.trim();
        if (!v) return;
        STORE.notes = STORE.notes || [];
        STORE.notes.unshift({ id: 'n' + Date.now(), text: v, at: Date.now() });
        nInput.value = '';
        saveStore(); render();
      };
    }
    host.querySelectorAll('[data-note-del]').forEach((el) => {
      el.onclick = () => { STORE.notes = (STORE.notes || []).filter((x) => x.id !== el.dataset.noteDel); saveStore(); render(); };
    });
    const cityBtn = host.querySelector('#lw-city');
    if (cityBtn) {
      cityBtn.onclick = () => {
        const c = prompt('城市名（中文或英文）：', CITY);
        if (c && c.trim()) { CITY = c.trim(); STORE.city = CITY; saveStore(); load(true); }
      };
    }
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
  const card = (title, extra, body, n, act) =>
    `<div class="lw-c" style="${sp(n || 12)}"><h3>${title}<span class="sp"></span>${act || ''}${extra ? `<em>${extra}</em>` : ''}</h3>${body}</div>`;
  const TINT = { sky: [T.sky, T.skyInk], lilac: [T.lilac, T.lilacInk], mint: [T.mint, T.mintInk], lemon: [T.lemon, T.lemonInk], peach: [T.peach, T.peachInk], rose: [T.rose, T.roseInk] };
  const kpiCard = (ic, num, unit, lbl, cmp, n, tint) => { const c = TINT[tint] || TINT.sky; return `<div class="lw-c" style="${sp(n || 3)}"><div class="lw-kpi">
    <div class="row"><div class="ic" style="background:${c[0]};color:${c[1]}">${ic}</div>
      <div style="flex:1;min-width:0"><div class="num">${num}<small>${unit}</small></div></div></div>
    <div class="lbl">${lbl}</div>${cmp ? `<div class="cmp">${cmp}</div>` : ''}</div></div>`; };

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
  function viewTodo() {
    const all = (STORE && STORE.todos) || [];
    const open = all.filter((t) => !t.done), done = all.filter((t) => t.done);
    const body = (list, isDone) => list.length ? list.map((t) => `<div class="lw-todo ${isDone ? 'done' : ''}">
      <span class="ck" data-todo-toggle="${t.id}">✓</span>
      <div class="tx">${esc(t.text)}<div class="due">${dstr(t.at)}</div></div>
      <span class="del" data-todo-del="${t.id}">✕</span></div>`).join('') : `<div class="lw-empty"><span class="big">✓</span>${isDone ? '还没有完成的' : '还没有待办，下面加一条'}</div>`;
    return `<div class="lw-g12">
      ${kpiCard('✓', open.length, '项', '待处理', all.length ? `已完成 ${done.length} / 共 ${all.length}` : '—', 4, 'peach')}
      ${kpiCard('📅', done.length, '项', '已完成', all.length ? '完成率 ' + Math.round(done.length / all.length * 100) + '%' : '—', 4, 'rose')}
      ${kpiCard('⏱', open.length ? ago(Math.max(...open.map((t) => t.at))) : '—', '', '最早一条', '按添加时间', 4, 'sky')}
      ${card('待处理', '', `<div>${body(open, false)}</div><div class="lw-add">
        <input id="lw-todo-input" placeholder="加一条待办，回车即可…" />
        <button id="lw-todo-add">添加</button></div>`, 7)}
      ${card('已完成', done.length ? `${done.length} 项` : '', `<div>${body(done, true)}</div>`, 5)}
    </div>`;
  }

  /* ── 笔记 ── */
  function viewNotes() {
    const notes = (STORE && STORE.notes) || [];
    const recent = DATA.recent || [];
    const mdFiles = recent.filter((f) => /\.(md|txt|tex|docx?)$/i.test(f.name)).slice(0, 10);
    return `<div class="lw-g12">
      ${card('快速笔记', '存本机 · 随手记',
        `<div class="lw-note"><textarea id="lw-note-input" placeholder="记点什么…（想法 / 实验现象 / 待查资料）"></textarea>
         <div style="display:flex;justify-content:flex-end;margin-top:9px"><button class="lw-btn" id="lw-note-add" style="background:linear-gradient(160deg,${T.accent},${T.accent2});border:0;color:#fff">保存</button></div></div>`, 5)}
      ${card('全部笔记', `${notes.length} 条`, notes.length ? notes.map((n) => `<div class="lw-note">
        <div class="h">${dstr(n.at)}<span class="del" data-note-del="${n.id}">✕</span></div>
        <div class="b">${esc(n.text)}</div></div>`).join('') : `<div class="lw-empty"><span class="big">✎</span>还没有笔记</div>`, 7)}
      ${card('知识库里的笔记文件', '最近改动 · 点一行复制路径',
        mdFiles.length ? `<div class="lw-tbl">${mdFiles.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext)}</span><span class="tm">${ago(f.mtime)}</span></div>`).join('')}</div>`
          : `<div class="lw-empty">没有找到笔记文件</div>`, 12)}
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
    const ps = (DATA.projects || []).filter((p) => p.track === 'paper' || /paper|manuscript|论文|latex|投稿|开题|摘要/i.test(p.name));
    const docs = (DATA.recent || []).filter((f) => /\.(docx?|tex|pdf|pptx?|md)$/i.test(f.name)).slice(0, 12);
    const track = (DATA.tracks || []).find((t) => t.id === 'paper');
    return `<div class="lw-g12">
      ${kpiCard('📄', track ? track.projects : 0, '个项目', '论文 / 投稿', track ? track.files + ' 个文件 · ' + track.sizeText : '未归类到论文', 3, 'lilac')}
      ${kpiCard('✎', docs.length, '篇', '文稿 / 插图', 'docx · tex · pdf · pptx', 3, 'mint')}
      ${kpiCard('◈', (DATA.tracks || []).length, '个方向', '整体进度', '按最近改动排序', 3, 'lemon')}
      ${kpiCard('▦', DATA.totals.projects, '个项目', '全部项目', DATA.totals.sizeText, 3, 'peach')}
      ${card('论文项目', `${ps.length} 个`, ps.length ? `<div class="lw-tbl">${ps.map((p) => `<div class="lw-tr" data-path="${esc(p.path)}">
        <span class="nm">${esc(p.name)} <i>${esc(p.base)}</i></span>
        <span class="bd">${p.files} 文件</span><span class="tm">${ago(p.newest)}</span></div>`).join('')}</div>` : emptyBox('还没归类到论文项目'), 6)}
      ${card('文稿与插图', '最近改动', docs.length ? `<div class="lw-tbl">${docs.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
        <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
        <span class="bd">${esc(f.ext)}</span><span class="sz">${fmtBytes(f.size)}</span>
        <span class="tm">${ago(f.mtime)}</span></div>`).join('')}</div>` : emptyBox('最近没有文稿改动'), 6)}
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
  function viewMail() {
    const links = [
      { ic: '📮', n: 'QQ 邮箱', u: 'https://mail.qq.com' },
      { ic: '✉️', n: '网易邮箱', u: 'https://mail.163.com' },
      { ic: '📧', n: 'Gmail', u: 'https://mail.google.com' },
      { ic: '📚', n: '知网', u: 'https://www.cnki.net' },
      { ic: '🔬', n: 'Google 学术', u: 'https://scholar.google.com' },
      { ic: '📖', n: 'arXiv', u: 'https://arxiv.org' },
      { ic: '🐙', n: 'GitHub', u: 'https://github.com' },
      { ic: '📝', n: 'Overleaf', u: 'https://www.overleaf.com/project' },
      { ic: '🤗', n: 'HuggingFace', u: 'https://huggingface.co' },
      { ic: '🧭', n: 'ROS Wiki', u: 'https://wiki.ros.org' },
      { ic: '⚙️', n: 'STM32 文档', u: 'https://www.st.com' },
      { ic: '🎓', n: '学校邮箱', u: 'https://mail.qq.com' },
    ];
    const mailFiles = (DATA.recent || []).filter((f) => /邮件|mail|revision|审稿|投稿|回复/i.test(f.name)).slice(0, 8);
    return `<div class="lw-g12">
      ${card('常用入口', '在新标签打开',
        `<div class="lw-pad"><div class="lw-links">${links.map((l) =>
          `<a class="lw-link" href="${l.u}" target="_blank" rel="noopener"><span class="ic">${l.ic}</span>${l.n}</a>`).join('')}</div></div>`, 12)}
      ${card('邮件相关文件', '最近改动 · 点一行复制路径',
        mailFiles.length ? `<div class="lw-tbl">${mailFiles.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext || '—')}</span><span class="tm">${ago(f.mtime)}</span></div>`).join('')}</div>`
          : `<div class="lw-empty"><span class="big">✉️</span>没有找到邮件相关文件<br><span style="font-size:11px">把审稿意见、投稿回复放进来就会出现在这</span></div>`, 12)}
    </div>`;
  }

  function emptyBox(msg) {
    return `<div class="lw-empty"><span class="big">▢</span>${esc(msg)}</div>`;
  }
})();


