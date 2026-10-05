/*!
 * life-workbench.js —— 「我的工作台」个人管理系统（v2 · 按 2026 仪表盘规范重做）
 * ---------------------------------------------------------------------------
 * 挂在「本机管家」里的一个栏目（DOM 注入，不改那个 302KB 压缩文件）。
 * 数据来自 /api/life/index（lib/life-index.js 扫本机 + 按研究方向归类）。
 *
 * 设计规格（参考 2026 dashboard 设计规范）：
 *   · 导航项 36px 高 / 圆角 8px / 激活态 8% 主色 + 左侧 3px 条
 *   · KPI 卡：主数字 30px + 一个对比 + 一个可视化（三选一，不堆）
 *   · 内容网格 12 列 / 24px 间距
 *   · 图表优先柱状与折线（长度编码比面积好读），不用环形图
 *   · 加载用骨架屏（不用 spinner）；空状态给一句话 + 出口
 */
(() => {
  'use strict';

  /* ── 设计令牌：终端 HUD / 粗野主义风 ──
     参考用户给的界面：纯黑底 + 硬米白边框 + 零圆角 + 淡黄强调色 +
     等宽字体 + 全大写标签 + 前缀编码（N-01 / CLK / T-01）。 */
  const T = {
    bg: '#0b0b0b', panel: '#0f0f0f', panel2: '#141414', line: '#e8e4d8', lineDim: '#3a382f',
    text: '#f2efe6', dim: '#8a8778', faint: '#5c5a50',
    accent: '#f2e39b', accentInk: '#111008', ok: '#9bd67a', warn: '#f0a35e', red: '#e2725b',
  };
  const KIND_COLOR = { code: '#f2e39b', doc: '#f0a35e', media: '#9bd67a', model: '#7ec8e3', other: '#5c5a50' };
  const KIND_NAME = { code: '代码', doc: '文档', media: '媒体/图', model: '三维模型', other: '其他' };
  const MONO = '"SF Mono",SFMono-Regular,Menlo,Consolas,"JetBrains Mono",monospace';

  const CSS = `
  .lw-inpanel { position:absolute; inset:0; display:flex; flex-direction:column; background:${T.bg}; overflow:hidden;
    font-family:${MONO}; color:${T.text}; font-size:12.5px; letter-spacing:.2px; }
  /* 顶栏 */
  .lw-head { display:flex; align-items:center; gap:16px; padding:12px 18px; flex:none;
    border-bottom:2px solid ${T.line}; background:${T.bg}; }
  .lw-logo { width:30px; height:30px; flex:none; display:flex; align-items:center; justify-content:center;
    border:2px solid ${T.line}; font-size:15px; }
  .lw-h1 { font-size:13px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; line-height:1.15; }
  .lw-h1 small { display:block; font-size:9px; letter-spacing:2.4px; color:${T.dim}; font-weight:400; margin-top:2px; }
  .lw-sub2 { font-size:10.5px; color:${T.dim}; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    letter-spacing:.4px; text-transform:uppercase; }
  .lw-btn { height:30px; padding:0 13px; border-radius:0; border:2px solid ${T.line}; background:transparent;
    color:${T.text}; font:600 10.5px ${MONO}; letter-spacing:1.2px; text-transform:uppercase; cursor:pointer; flex:none;
    transition:background .12s,color .12s; }
  .lw-btn:hover { background:${T.accent}; color:${T.accentInk}; }
  /* 主体 */
  .lw-body2 { flex:1; display:flex; min-height:0; }
  .lw-nav { width:196px; flex:none; padding:14px 12px; border-right:2px solid ${T.line}; background:${T.bg};
    display:flex; flex-direction:column; overflow:auto; }
  .lw-nav .grp { margin:6px 2px 8px; font-size:9px; letter-spacing:2.4px; color:${T.faint}; text-transform:uppercase; }
  .lw-nav button { width:100%; height:38px; display:flex; align-items:center; gap:9px; padding:0 9px; margin-bottom:5px;
    border:2px solid ${T.lineDim}; border-radius:0; background:transparent; color:${T.text};
    font:500 11.5px ${MONO}; letter-spacing:.6px; cursor:pointer; text-align:left; transition:all .12s; }
  .lw-nav button:hover { border-color:${T.line}; }
  .lw-nav button.on { background:${T.accent}; color:${T.accentInk}; border-color:${T.accent}; font-weight:700; }
  .lw-nav .ic { width:18px; text-align:center; font-size:13px; }
  .lw-nav .key { margin-left:auto; font-size:9.5px; letter-spacing:1.2px; color:${T.dim}; }
  .lw-nav button.on .key { color:${T.accentInk}; opacity:.65; }
  .lw-nav .foot { margin-top:auto; padding-top:14px; border-top:1px solid ${T.lineDim};
    font-size:9.5px; letter-spacing:1.4px; color:${T.faint}; text-transform:uppercase; line-height:1.9; }
  .lw-nav .foot b { color:${T.ok}; font-weight:600; }
  .lw-main { flex:1; min-width:0; overflow:auto; padding:16px 18px 28px; }
  .lw-main::-webkit-scrollbar { width:10px; } .lw-main::-webkit-scrollbar-thumb { background:#2a2a26; }
  .lw-g12 { display:grid; grid-template-columns:repeat(12,1fr); gap:14px; align-items:start; }
  /* 卡片：硬边框 + 标题栏带前缀编码 */
  .lw-c { background:${T.panel}; border:2px solid ${T.line}; border-radius:0; }
  .lw-c > h3 { margin:0; padding:8px 11px; font-size:9.5px; font-weight:600; letter-spacing:2px; text-transform:uppercase;
    color:${T.dim}; border-bottom:1px solid ${T.lineDim}; display:flex; align-items:center; gap:9px; }
  .lw-c > h3 .code { color:${T.accent}; letter-spacing:1.6px; }
  .lw-c > h3 .sp { flex:1; }
  .lw-c > h3 em { font-style:normal; letter-spacing:.6px; color:${T.faint}; font-weight:400; font-size:9.5px; }
  .lw-pad { padding:14px 16px; }
  /* KPI：图标框 + 大数字 */
  .lw-kpi { padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
  .lw-kpi .top { display:flex; align-items:flex-start; gap:12px; }
  .lw-kpi .ibox { width:38px; height:38px; flex:none; border:2px solid ${T.line}; display:flex; align-items:center;
    justify-content:center; font-size:17px; }
  .lw-kpi .num { font-size:32px; font-weight:700; line-height:1; letter-spacing:-1px; font-variant-numeric:tabular-nums; }
  .lw-kpi .num small { font-size:10.5px; font-weight:500; color:${T.dim}; margin-left:5px; letter-spacing:.6px; }
  .lw-kpi .lbl { font-size:9.5px; letter-spacing:1.6px; color:${T.faint}; text-transform:uppercase; }
  .lw-kpi .cmp { font-size:10.5px; color:${T.dim}; letter-spacing:.4px; }
  .lw-kpi .cmp b { color:${T.ok}; font-weight:700; }
  /* 表格 */
  .lw-tbl { display:flex; flex-direction:column; }
  .lw-tr { display:flex; align-items:center; gap:11px; min-height:42px; padding:0 11px; cursor:pointer;
    border-bottom:1px solid ${T.lineDim}; transition:background .12s; }
  .lw-tr:last-child { border-bottom:0; }
  .lw-tr:hover { background:${T.accent}; color:${T.accentInk}; }
  .lw-tr:hover .nm i, .lw-tr:hover .sz, .lw-tr:hover .tm, .lw-tr:hover .bd { color:${T.accentInk} !important; opacity:.72; }
  .lw-tr .ix { flex:none; width:26px; font-size:10px; color:${T.faint}; letter-spacing:.8px; }
  .lw-tr .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
  .lw-tr .nm i { font-style:normal; color:${T.faint}; font-size:10.5px; }
  .lw-tr .sz { flex:none; font-size:10.5px; color:${T.dim}; text-align:right; width:62px; font-variant-numeric:tabular-nums; }
  .lw-tr .tm { flex:none; font-size:10.5px; color:${T.faint}; width:70px; text-align:right; }
  .lw-tr .bd { flex:none; font-size:9.5px; padding:2px 7px; border:1px solid ${T.lineDim}; color:${T.dim};
    letter-spacing:.8px; text-transform:uppercase; }
  .lw-empty { padding:30px 12px; text-align:center; color:${T.faint}; font-size:11px; letter-spacing:1px; text-transform:uppercase; }
  .lw-empty .big { font-size:22px; display:block; margin-bottom:8px; opacity:.55; }
  /* 骨架 */
  .lw-sk { background:linear-gradient(90deg,#141414 25%,#1e1e1c 37%,#141414 63%); background-size:400% 100%;
    animation:lw-sk 1.3s ease infinite; }
  @keyframes lw-sk { 0%{background-position:100% 50%} 100%{background-position:0 50%} }
  /* 柱状：淡黄柱 + 柱顶数值 */
  .lw-bars { display:flex; align-items:flex-end; gap:5px; height:132px; }
  .lw-bars > div { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:5px; height:100%; }
  .lw-bars .v { font-size:9.5px; color:${T.dim}; }
  .lw-bars .b { width:100%; background:${T.accent}; }
  .lw-bars > div:hover .b { background:#fff; }
  .lw-bars .k { font-size:9px; color:${T.faint}; letter-spacing:.2px; }
  .lw-chips { display:flex; flex-wrap:wrap; gap:7px; }
  .lw-chip { font-size:10.5px; padding:3px 9px; border:1px solid ${T.lineDim}; color:${T.dim}; letter-spacing:.6px; }
  .lw-chip b { color:${T.accent}; font-weight:700; margin-left:5px; }
  .lw-tabs { display:flex; gap:7px; flex-wrap:wrap; }
  .lw-tab { padding:4px 11px; border:2px solid ${T.lineDim}; background:transparent; color:${T.dim};
    font:600 10px ${MONO}; letter-spacing:1.2px; text-transform:uppercase; cursor:pointer; }
  .lw-tab:hover { border-color:${T.line}; color:${T.text}; }
  .lw-tab.on { background:${T.accent}; border-color:${T.accent}; color:${T.accentInk}; }
  #system-nav-list button[data-section="lifework"] i { color:${T.accent}; }
  `;

  const NAV = [
    { id: 'today', icon: '☀', label: '今日', key: 'T-01' },
    { id: 'tracks', icon: '◈', label: '研究方向', key: 'F-02' },
    { id: 'paper', icon: '▤', label: '论文', key: 'P-03' },
    { id: 'files', icon: '▦', label: '文件', key: 'C-04' },
    { id: 'time', icon: '◔', label: '时间', key: 'X-05' },
  ];

  let DATA = null, TAB = 'today', LOADING = false, MOUNT_TIMER = 0;

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

  /* 迷你折线（长度编码，比环形图好读） */
  function spark(vals, w, h, color) {
    const W = w || 96, H = h || 28, C = color || T.accent;
    const n = Math.max(2, (vals || []).length);
    const max = Math.max(1, ...(vals || [0]));
    const pts = (vals || []).map((v, i) => [(i / (n - 1)) * W, H - (v / max) * (H - 4) - 2]);
    if (!pts.length) return '';
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block">
      <path d="${d} L${W},${H} L0,${H} Z" fill="${C}" opacity=".12"/>
      <path d="${d}" fill="none" stroke="${C}" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
  }

  function skeleton() {
    const kpi = [0, 1, 2, 3].map(() => `<div class="lw-c" style="grid-column:span 3">
      <div class="lw-sk" style="height:12px;width:52%"></div>
      <div class="lw-sk" style="height:30px;width:40%;margin:13px 0 11px"></div>
      <div class="lw-sk" style="height:11px;width:72%"></div></div>`).join('');
    const rows = [0, 1, 2, 3, 4].map(() => `<div class="lw-sk" style="height:30px;margin-top:11px"></div>`).join('');
    return `<div class="lw-g12">${kpi}
      <div class="lw-c" style="grid-column:span 8"><div class="lw-sk" style="height:11px;width:22%"></div>${rows}</div>
      <div class="lw-c" style="grid-column:span 4"><div class="lw-sk" style="height:11px;width:46%"></div>
        <div class="lw-sk" style="height:130px;margin-top:13px"></div></div>
    </div>`;
  }

  /* ── 挂载：注入「本机管家」侧栏 ──
     实测结构：SECTION#system-workspace > DIV#system-shell > [ASIDE#system-nav, DIV#system-main]
     system-panel.js 是 302KB 压缩文件，改源码风险大 ✗ —— 所以运行时注入。 */
  window.LifeWorkbench = { open: openInPanel, close: hidePanelView, refresh: () => load(true) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

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
      btn.title = '个人管理系统：今日 / 研究方向 / 论文 / 文件 / 时间';
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

  function render() {
    const host = document.getElementById('lifework-view');
    if (!host) return;
    if (!DATA) { host.innerHTML = headHtml() + '<div class="lw-main">' + skeleton() + '</div>'; bind(); return; }
    const main = { today: viewToday, tracks: viewTracks, paper: viewPaper, files: viewFiles, time: viewTime }[TAB] || viewToday;
    host.innerHTML = headHtml() + `<div class="lw-body2">
      <div class="lw-nav">
        <div class="grp">Views · 视图</div>
        ${NAV.map((n) => `<button data-tab="${n.id}" class="${n.id === TAB ? 'on' : ''}">
          <span class="ic">${n.icon}</span><span>${n.label}</span><span class="key">${n.key}</span></button>`).join('')}
        <div class="foot">System <b>OK</b><br>本地运行 · 数据仅存本机</div>
      </div>
      <div class="lw-main">${main()}</div></div>`;
    bind();
  }

  function headHtml() {
    const sub = DATA ? `${DATA.totals.projects} 项目 · ${DATA.totals.files} 文件 · ${DATA.totals.sizeText} · 更新 ${dstr(DATA.scannedAt)}` : '正在扫描本机…';
    return `<div class="lw-head">
      <div class="lw-logo">🎯</div>
      <div class="lw-h1">我的工作台<small>Local Command</small></div>
      <div class="lw-sub2" id="lw-sub">${esc(sub)}</div>
      <button class="lw-btn" id="lw-refresh">↻ 重新扫描</button></div>`;
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
  }

  async function load(force) {
    if (LOADING) return;
    LOADING = true;
    const s = document.getElementById('lw-sub');
    if (s) s.textContent = '正在扫描本机文件…';
    try {
      const r = await fetch('/api/life/index?depth=3', { cache: 'no-store' });
      DATA = await r.json();
      if (!DATA || !DATA.ok) throw new Error((DATA && DATA.error) || '读取失败');
    } catch (e) {
      LOADING = false;
      if (s) s.textContent = '读取失败：' + e.message;
      return;
    }
    LOADING = false;
    render();
  }

  const span = (n) => `grid-column:span ${n}`;
  const card = (code, title, extra, body, sp) =>
    `<div class="lw-c" style="${span(sp || 12)}"><h3><span class="code">${code}</span>${title}<span class="sp"></span>${extra || ''}</h3>${body}</div>`;

  /* ── 今日 ── */
  function viewToday() {
    const d = new Date(), hour = d.getHours();
    const greet = hour < 6 ? '深夜' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 19 ? '下午好' : '晚上好';
    const days = DATA.days || [];
    const today = days[days.length - 1] || { count: 0 };
    const yest = days[days.length - 2] || { count: 0 };
    const diff = today.count - yest.count;
    const maxDay = Math.max(1, ...days.map((x) => x.count));
    const week = days.slice(-7).map((x) => x.count);
    const hot = (DATA.recent || []).slice(0, 8);

    const kpis = [
      { ic: '▦', n: DATA.totals.projects, u: '个项目', l: '已纳管', c: `覆盖 ${(DATA.tracks || []).length} 个方向`, sp: null },
      { ic: '▤', n: DATA.totals.files, u: '个文件', l: `合计 ${DATA.totals.sizeText}`, c: `近 14 天有 ${days.filter((x) => x.count).length} 天在动`, sp: spark(week, 96, 26, T.accent) },
      { ic: '✎', n: today.count, u: '个改动', l: '今天', c: diff === 0 ? '与昨天持平' : (diff > 0 ? `<b>+${diff}</b> 比昨天多` : `<b style="color:${T.warn}">${diff}</b> 比昨天少`), sp: spark(week, 96, 26, T.ok) },
      { ic: '◈', n: (DATA.tracks || []).length, u: '个方向', l: '机器人 · 嵌入式 · 论文', c: '按最近改动排序', sp: null },
    ].map((k, i) => card('K-0' + (i + 1), k.l, '', `<div class="lw-kpi"><div class="top">
        <div class="ibox">${k.ic}</div><div style="flex:1;min-width:0">
          <div class="num">${k.n}<small>${k.u}</small></div></div></div>
        <div class="cmp">${k.c}</div>
        ${k.sp ? `<div>${k.sp}</div>` : ''}</div>`, 3)).join('');

    const hotBody = hot.length ? `<div class="lw-tbl">${hot.map((f, i) => `<div class="lw-tr" data-path="${esc(f.path)}">
      <span class="ix">${String(i + 1).padStart(2, '0')}</span>
      <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
      <span class="bd">${esc(f.ext || '—')}</span><span class="sz">${fmtBytes(f.size)}</span>
      <span class="tm">${ago(f.mtime)}</span></div>`).join('')}</div>` : emptyBox('还没有文件改动记录');

    const barBody = `<div class="lw-pad"><div class="lw-bars">${days.map((x) => `<div title="${x.date} · ${x.count}">
      <span class="v">${x.count || ''}</span><span class="b" style="height:${Math.max(3, Math.round(x.count / maxDay * 92))}px"></span>
      <span class="k">${x.label}</span></div>`).join('')}</div></div>`;

    const trackBody = `<div class="lw-tbl">${(DATA.tracks || []).map((t) => `<div class="lw-tr" data-path="${esc((t.list[0] || {}).path || '')}">
      <span class="ix" style="font-size:13px">${t.icon}</span>
      <span class="nm">${esc(t.name)} <i>${t.projects} 个项目</i></span>
      <span class="bd" style="border-color:${t.color};color:${t.color}">${t.files} 文件</span>
      <span class="sz">${t.sizeText}</span><span class="tm">${ago(t.newest)}</span></div>`).join('')}</div>`;

    const kindBody = `<div class="lw-pad">${Object.entries(DATA.byKind || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const pct = Math.round(v / (DATA.totals.files || 1) * 100);
      return `<div style="margin-bottom:12px"><div style="display:flex;font-size:10.5px;color:${T.dim};margin-bottom:5px">
        <span style="flex:1;letter-spacing:1px;text-transform:uppercase">${KIND_NAME[k] || k}</span>
        <span style="font-variant-numeric:tabular-nums">${v} · ${pct}%</span></div>
        <div style="height:8px;background:#1c1c1a"><i style="display:block;height:100%;width:${pct}%;background:${KIND_COLOR[k] || T.faint}"></i></div></div>`;
    }).join('')}</div>`;

    return `<div class="lw-g12">${kpis}
      ${card('N-01', `${greet} · 最近在动的文件`, '<em>点一行复制完整路径</em>', hotBody, 8)}
      ${card('N-02', '近 14 天', `<em>共 ${days.reduce((a, x) => a + x.count, 0)} 个改动</em>`, barBody, 4)}
      ${card('N-03', '各方向活跃度', '<em>按最近改动排序</em>', trackBody, 7)}
      ${card('N-04', '文件构成', `<em>${DATA.totals.files} 个文件</em>`, kindBody, 5)}
    </div>`;
  }

  function emptyBox(msg) {
    return `<div class="lw-empty"><span class="big">▢</span>${esc(msg)}</div>`;
  }

  /* ── 研究方向 ── */
  function viewTracks() {
    const tracks = DATA.tracks || [];
    if (!tracks.length) return emptyBox('还没扫到项目');
    const max = Math.max(1, ...tracks.map((t) => t.files));
    return `<div class="lw-g12">` + tracks.map((t, i) => card('F-0' + (i + 1), `${t.icon} ${esc(t.name)}`,
      `<em>${t.projects} 项目 · ${t.files} 文件 · ${t.sizeText}</em>`,
      `<div class="lw-pad" style="padding-bottom:0"><div style="height:8px;background:#1c1c1a">
        <i style="display:block;height:100%;width:${Math.round(t.files / max * 100)}%;background:${t.color}"></i></div></div>
       <div class="lw-tbl">${t.list.map((p) => `<div class="lw-tr" data-path="${esc(p.path)}">
        <span class="nm">${esc(p.name)} <i>${esc(p.base)}</i></span>
        <span class="bd">${p.files} 文件</span><span class="sz">${p.sizeText}</span>
        <span class="tm">${ago(p.newest)}</span></div>`).join('')}</div>`, 6)).join('') + `</div>`;
  }

  /* ── 论文 ── */
  function viewPaper() {
    const ps = (DATA.projects || []).filter((p) => p.track === 'paper' || /paper|manuscript|论文|latex|投稿|开题|摘要/i.test(p.name));
    const docs = (DATA.recent || []).filter((f) => /\.(docx?|tex|pdf|pptx?|md)$/i.test(f.name)).slice(0, 12);
    const track = (DATA.tracks || []).find((t) => t.id === 'paper');
    const kpi = (code, ic, n, u, l, c) => card(code, l, '', `<div class="lw-kpi"><div class="top">
      <div class="ibox">${ic}</div><div style="flex:1;min-width:0"><div class="num">${n}<small>${u}</small></div></div></div>
      <div class="cmp">${c}</div></div>`, 3);
    return `<div class="lw-g12">
      ${kpi('P-01', '▤', track ? track.projects : 0, '个项目', '论文 / 投稿', track ? track.files + ' 个文件 · ' + track.sizeText : '未归类到论文')}
      ${kpi('P-02', '✎', docs.length, '篇', '文稿 / 插图', 'docx · tex · pdf · pptx')}
      ${card('P-03', '论文项目', `<em>${ps.length} 个</em>`,
        `<div class="lw-tbl">${ps.length ? ps.map((p) => `<div class="lw-tr" data-path="${esc(p.path)}">
          <span class="nm">${esc(p.name)} <i>${esc(p.base)}</i></span>
          <span class="bd">${p.files} 文件</span><span class="tm">${ago(p.newest)}</span></div>`).join('') : emptyBox('还没归类到论文项目')}</div>`, 6)}
      ${card('P-04', '文稿与插图', '<em>最近改动</em>',
        `<div class="lw-tbl">${docs.length ? docs.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext)}</span><span class="sz">${fmtBytes(f.size)}</span>
          <span class="tm">${ago(f.mtime)}</span></div>`).join('') : emptyBox('最近没有文稿改动')}</div>`, 12)}
    </div>`;
  }

  /* ── 文件 ── */
  function viewFiles() {
    const exts = Object.entries(DATA.byExt || {}).sort((a, b) => b[1] - a[1]).slice(0, 26);
    const recent = (DATA.recent || []).slice(0, 26);
    return `<div class="lw-g12">
      ${card('C-01', '扩展名分布', `<em>共 ${DATA.totals.files} 个文件</em>`,
        `<div class="lw-pad"><div class="lw-chips">${exts.map(([e, n]) => `<span class="lw-chip">${esc(e)}<b>${n}</b></span>`).join('')}</div></div>`, 12)}
      ${card('C-02', '最近改动', '<em>点一行复制完整路径</em>',
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
    const kpi = (code, ic, n, u, l, c) => card(code, l, '', `<div class="lw-kpi"><div class="top">
      <div class="ibox">${ic}</div><div style="flex:1;min-width:0"><div class="num">${n}<small>${u}</small></div></div></div>
      <div class="cmp">${c}</div></div>`, 3);
    return `<div class="lw-g12">
      ${kpi('X-01', 'Σ', total, '个改动', '近 14 天', '日均 ' + (total / 14).toFixed(1) + ' 个')}
      ${kpi('X-02', '◔', active, '天', '有改动', '共 14 天')}
      ${card('X-03', '改动趋势', '<em>近 14 天</em>',
        `<div class="lw-pad"><div style="padding:6px 0">${spark(days.map((x) => x.count), 420, 92, T.accent)}</div>
         <div style="display:flex;justify-content:space-between;font-size:9.5px;color:${T.faint};margin-top:6px">
          <span>${(days[0] || {}).label || ''}</span><span>${(days[days.length - 1] || {}).label || ''}</span></div></div>`, 6)}
      ${card('X-04', '每日改动量', `<em>峰值 ${max}</em>`,
        `<div class="lw-pad"><div class="lw-bars">${days.map((x) => `<div title="${x.date} · ${x.count}">
          <span class="v">${x.count || ''}</span><span class="b" style="height:${Math.max(3, Math.round(x.count / max * 92))}px"></span>
          <span class="k">${x.label}</span></div>`).join('')}</div></div>`, 12)}
      ${card('X-05', '各方向最近活跃', '<em>点一行复制项目路径</em>',
        `<div class="lw-tbl">${(DATA.tracks || []).map((t) => `<div class="lw-tr" data-path="${esc((t.list[0] || {}).path || '')}">
          <span class="ix" style="font-size:13px">${t.icon}</span><span class="nm">${esc(t.name)} <i>${t.projects} 个项目</i></span>
          <span class="bd" style="border-color:${t.color};color:${t.color}">${t.files} 文件</span>
          <span class="sz">${t.sizeText}</span><span class="tm">${ago(t.newest)}</span></div>`).join('')}</div>`, 12)}
    </div>`;
  }
})();

