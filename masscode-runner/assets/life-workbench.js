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

  const T = {
    bg: '#0e1116', panel: '#151a22', panel2: '#1a2029', line: '#242c39', line2: '#2e3846',
    text: '#e8ecf3', dim: '#8b95a6', faint: '#5d6779',
    accent: '#4f8cff', ok: '#3fb950', warn: '#f0883e', purple: '#a371f7', cyan: '#39c5cf',
  };
  const KIND_COLOR = { code: '#4f8cff', doc: '#f0883e', media: '#a371f7', model: '#3fb950', other: '#5d6779' };
  const KIND_NAME = { code: '代码', doc: '文档', media: '媒体/图', model: '三维模型', other: '其他' };

  const CSS = `
  .lw-inpanel { position:absolute; inset:0; display:flex; flex-direction:column; background:${T.bg}; overflow:hidden;
    font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; color:${T.text}; }
  .lw-head { display:flex; align-items:center; gap:14px; padding:14px 22px; flex:none;
    border-bottom:1px solid ${T.line}; background:${T.panel}; }
  .lw-h1 { font-size:15px; font-weight:700; letter-spacing:.2px; display:flex; align-items:center; gap:8px; }
  .lw-sub2 { font-size:12px; color:${T.dim}; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-btn { height:30px; padding:0 13px; border-radius:8px; border:1px solid ${T.line2}; background:${T.panel2};
    color:#cfd6e2; font-size:12px; cursor:pointer; flex:none; transition:all .15s; }
  .lw-btn:hover { background:#232c3b; border-color:${T.accent}; color:#fff; }
  .lw-body2 { flex:1; display:flex; min-height:0; }
  .lw-nav { width:200px; flex:none; padding:14px 10px; border-right:1px solid ${T.line}; background:#12161d; overflow:auto; }
  .lw-nav .grp { margin:10px 10px 7px; font-size:11px; letter-spacing:1.2px; color:${T.faint}; text-transform:uppercase; font-weight:600; }
  .lw-nav button { width:100%; height:36px; display:flex; align-items:center; gap:10px; padding:0 12px; margin-bottom:2px;
    border:0; border-left:3px solid transparent; border-radius:8px; background:transparent;
    color:#a9b3c4; font-size:13px; cursor:pointer; text-align:left; transition:background .15s,color .15s; }
  .lw-nav button:hover { background:rgba(255,255,255,.04); color:${T.text}; }
  .lw-nav button.on { background:rgba(79,140,255,.08); border-left-color:${T.accent}; color:#eaf1ff; font-weight:600; }
  .lw-nav .ic { width:18px; text-align:center; font-size:14px; }
  .lw-main { flex:1; min-width:0; overflow:auto; padding:22px; }
  .lw-main::-webkit-scrollbar { width:10px; } .lw-main::-webkit-scrollbar-thumb { background:#2a3242; border-radius:6px; }
  .lw-g12 { display:grid; grid-template-columns:repeat(12,1fr); gap:24px; align-items:start; }
  .lw-c { background:${T.panel}; border:1px solid ${T.line}; border-radius:12px; padding:18px 20px; }
  .lw-c h3 { margin:0 0 14px; font-size:11.5px; font-weight:600; color:${T.dim}; letter-spacing:.6px;
    display:flex; align-items:center; gap:8px; text-transform:uppercase; }
  .lw-c h3 .sp { flex:1; }
  .lw-c h3 em { font-style:normal; text-transform:none; letter-spacing:0; color:${T.faint}; font-weight:400; font-size:11px; }
  .lw-kpi { display:flex; flex-direction:column; gap:7px; }
  .lw-kpi .num { font-size:30px; font-weight:700; line-height:1; letter-spacing:-.8px; }
  .lw-kpi .num small { font-size:12px; font-weight:500; color:${T.dim}; margin-left:6px; letter-spacing:0; }
  .lw-kpi .lbl { font-size:12px; color:${T.dim}; }
  .lw-kpi .cmp { font-size:11.5px; color:${T.faint}; }
  .lw-kpi .cmp b { color:${T.ok}; font-weight:600; }
  .lw-tbl { display:flex; flex-direction:column; }
  .lw-tr { display:flex; align-items:center; gap:12px; min-height:44px; padding:0 10px; border-radius:8px;
    border-bottom:1px solid rgba(36,44,57,.55); cursor:pointer; transition:background .12s; }
  .lw-tr:last-child { border-bottom:0; }
  .lw-tr:hover { background:rgba(79,140,255,.07); }
  .lw-tr .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  .lw-tr .nm i { font-style:normal; color:${T.faint}; font-size:11.5px; }
  .lw-tr .sz { flex:none; font-size:11.5px; color:${T.dim}; font-variant-numeric:tabular-nums; text-align:right; width:64px; }
  .lw-tr .tm { flex:none; font-size:11.5px; color:${T.faint}; width:72px; text-align:right; }
  .lw-tr .bd { flex:none; font-size:10px; padding:2px 8px; border-radius:999px; border:1px solid ${T.line2}; color:${T.dim}; }
  .lw-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;
    padding:34px 10px; color:${T.faint}; font-size:12.5px; }
  .lw-empty .big { font-size:26px; opacity:.5; }
  .lw-sk { background:linear-gradient(90deg,#1a2029 25%,#222a36 37%,#1a2029 63%); background-size:400% 100%;
    animation:lw-sk 1.3s ease infinite; border-radius:8px; }
  @keyframes lw-sk { 0%{background-position:100% 50%} 100%{background-position:0 50%} }
  .lw-bars { display:flex; align-items:flex-end; gap:8px; height:130px; }
  .lw-bars > div { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:5px; height:100%; }
  .lw-bars .v { font-size:10px; color:${T.dim}; }
  .lw-bars .b { width:100%; border-radius:5px 5px 0 0; background:linear-gradient(180deg,${T.accent},#2b5cab); }
  .lw-bars .k { font-size:10px; color:${T.faint}; }
  .lw-heat { display:grid; grid-auto-flow:column; grid-template-rows:repeat(7,1fr); gap:4px; }
  .lw-heat i { width:15px; height:15px; border-radius:3px; background:#1b222c; }
  .lw-chips { display:flex; flex-wrap:wrap; gap:8px; }
  .lw-chip { font-size:11.5px; padding:4px 10px; border-radius:999px; border:1px solid ${T.line2};
    background:${T.panel2}; color:#a9b3c4; }
  .lw-chip b { color:#8fb8ff; font-weight:600; margin-left:4px; }
  #system-nav-list button[data-section="lifework"] i { color:${T.accent}; }
  `;

  const NAV = [
    { id: 'today', icon: '☀️', label: '今日' },
    { id: 'tracks', icon: '🎯', label: '研究方向' },
    { id: 'paper', icon: '📄', label: '论文' },
    { id: 'files', icon: '🗂', label: '文件' },
    { id: 'time', icon: '📈', label: '时间' },
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
      <div class="lw-nav">${NAV.map((n) =>
        `<button data-tab="${n.id}" class="${n.id === TAB ? 'on' : ''}"><span class="ic">${n.icon}</span>${n.label}</button>`).join('')}</div>
      <div class="lw-main">${main()}</div></div>`;
    bind();
  }

  function headHtml() {
    const sub = DATA ? `已扫 ${DATA.totals.projects} 个项目 · ${DATA.totals.files} 个文件 · ${DATA.totals.sizeText} · 更新于 ${dstr(DATA.scannedAt)}` : '正在扫描本机…';
    return `<div class="lw-head"><div class="lw-h1">🎯 我的工作台</div>
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
    const hot = (DATA.recent || []).slice(0, 8);

    const kpi = [
      { n: DATA.totals.projects, u: '个项目', l: '本机已纳管', c: `覆盖 ${(DATA.tracks || []).length} 个研究方向`, sp: null },
      { n: DATA.totals.files, u: '个文件', l: '合计 ' + DATA.totals.sizeText, c: `近 14 天有 ${days.filter((x) => x.count).length} 天在动`, sp: spark(week, 96, 26, T.accent) },
      { n: today.count, u: '个改动', l: '今天', c: diff === 0 ? '与昨天持平' : (diff > 0 ? `<b>+${diff}</b> 比昨天多` : `<b style="color:${T.warn}">${diff}</b> 比昨天少`), sp: spark(week, 96, 26, T.ok) },
      { n: (DATA.tracks || []).length, u: '个方向', l: '机器人 · 嵌入式 · 论文', c: (DATA.tracks || []).map((t) => t.icon).join(' '), sp: null },
    ].map((k) => `<div class="lw-c" style="${span(3)}"><div class="lw-kpi">
        <div class="num">${k.n}<small>${k.u}</small></div>
        <div class="lbl">${k.l}</div>
        <div class="cmp">${k.c}</div>
        ${k.sp ? `<div style="margin-top:2px">${k.sp}</div>` : '<div style="height:26px"></div>'}
      </div></div>`).join('');

    return `<div class="lw-g12">${kpi}
      <div class="lw-c" style="${span(8)}">
        <h3>${greet} · 最近在动的文件 <span class="sp"></span><em>点一行复制完整路径</em></h3>
        <div class="lw-tbl">${hot.length ? hot.map((f, i) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="sz" style="width:22px;color:${T.faint}">${i + 1}</span>
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext || '—')}</span>
          <span class="sz">${fmtBytes(f.size)}</span>
          <span class="tm">${ago(f.mtime)}</span></div>`).join('') : emptyBox('还没有文件改动记录')}</div>
      </div>
      <div class="lw-c" style="${span(4)}">
        <h3>近 14 天 <span class="sp"></span><em>共 ${days.reduce((a, x) => a + x.count, 0)} 个改动</em></h3>
        <div class="lw-bars">${days.map((x) => `<div title="${x.date} · ${x.count} 个文件">
          <span class="v">${x.count || ''}</span>
          <span class="b" style="height:${Math.max(3, Math.round(x.count / maxDay * 96))}px"></span>
          <span class="k">${x.label}</span></div>`).join('')}</div>
      </div>
      <div class="lw-c" style="${span(7)}">
        <h3>各方向活跃度 <span class="sp"></span><em>按最近改动排序</em></h3>
        <div class="lw-tbl">${(DATA.tracks || []).map((t) => `<div class="lw-tr" data-path="${esc((t.list[0] || {}).path || '')}">
          <span style="font-size:15px">${t.icon}</span>
          <span class="nm">${esc(t.name)} <i>${t.projects} 个项目</i></span>
          <span class="bd" style="border-color:${t.color};color:${t.color}">${t.files} 文件</span>
          <span class="sz">${t.sizeText}</span>
          <span class="tm">${ago(t.newest)}</span></div>`).join('')}</div>
      </div>
      <div class="lw-c" style="${span(5)}">
        <h3>文件构成 <span class="sp"></span><em>${DATA.totals.files} 个文件</em></h3>
        ${Object.entries(DATA.byKind || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
          const pct = Math.round(v / (DATA.totals.files || 1) * 100);
          return `<div style="margin-bottom:11px">
            <div style="display:flex;font-size:12px;color:${T.dim};margin-bottom:5px"><span style="flex:1">${KIND_NAME[k] || k}</span>
            <span style="font-variant-numeric:tabular-nums">${v} · ${pct}%</span></div>
            <div style="height:7px;border-radius:4px;background:#232b38;overflow:hidden">
              <i style="display:block;height:100%;width:${pct}%;border-radius:4px;background:${KIND_COLOR[k] || T.faint}"></i></div></div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function emptyBox(msg) {
    return `<div class="lw-empty"><div class="big">📭</div>${esc(msg)}</div>`;
  }

  /* ── 研究方向 ── */
  function viewTracks() {
    const tracks = DATA.tracks || [];
    if (!tracks.length) return emptyBox('还没扫到项目');
    const max = Math.max(1, ...tracks.map((t) => t.files));
    const cards = tracks.map((t) => `<div class="lw-c" style="${span(6)}">
      <h3><span style="font-size:15px">${t.icon}</span>${esc(t.name)}<span class="sp"></span>
        <em>${t.projects} 项目 · ${t.files} 文件 · ${t.sizeText}</em></h3>
      <div style="height:6px;border-radius:4px;background:#232b38;overflow:hidden;margin-bottom:14px">
        <i style="display:block;height:100%;width:${Math.round(t.files / max * 100)}%;border-radius:4px;background:${t.color}"></i></div>
      <div class="lw-tbl">${t.list.map((p) => `<div class="lw-tr" data-path="${esc(p.path)}">
        <span class="nm">${esc(p.name)} <i>${esc(p.base)}</i></span>
        <span class="bd">${p.files} 文件</span><span class="sz">${p.sizeText}</span>
        <span class="tm">${ago(p.newest)}</span></div>`).join('')}</div>
    </div>`).join('');
    return `<div class="lw-g12">${cards}</div>`;
  }

  /* ── 论文 ── */
  function viewPaper() {
    const ps = (DATA.projects || []).filter((p) => p.track === 'paper' || /paper|manuscript|论文|latex|投稿|开题|摘要/i.test(p.name));
    const docs = (DATA.recent || []).filter((f) => /\.(docx?|tex|pdf|pptx?|md)$/i.test(f.name)).slice(0, 12);
    const track = (DATA.tracks || []).find((t) => t.id === 'paper');
    return `<div class="lw-g12">
      <div class="lw-c" style="${span(3)}"><div class="lw-kpi">
        <div class="num">${track ? track.projects : 0}<small>个项目</small></div>
        <div class="lbl">论文 / 投稿</div>
        <div class="cmp">${track ? track.files + ' 个文件 · ' + track.sizeText : '未归类到论文'}</div>
        <div style="height:26px"></div></div></div>
      <div class="lw-c" style="${span(3)}"><div class="lw-kpi">
        <div class="num">${docs.length}<small>篇</small></div>
        <div class="lbl">文稿 / 插图</div>
        <div class="cmp">docx · tex · pdf · pptx</div>
        <div style="height:26px"></div></div></div>
      <div class="lw-c" style="${span(6)}">
        <h3>论文项目 <span class="sp"></span><em>${ps.length} 个</em></h3>
        <div class="lw-tbl">${ps.length ? ps.map((p) => `<div class="lw-tr" data-path="${esc(p.path)}">
          <span class="nm">${esc(p.name)} <i>${esc(p.base)}</i></span>
          <span class="bd">${p.files} 文件</span><span class="tm">${ago(p.newest)}</span></div>`).join('') : emptyBox('还没归类到论文项目')}</div>
      </div>
      <div class="lw-c" style="${span(12)}">
        <h3>文稿与插图 <span class="sp"></span><em>最近改动</em></h3>
        <div class="lw-tbl">${docs.length ? docs.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext)}</span><span class="sz">${fmtBytes(f.size)}</span>
          <span class="tm">${ago(f.mtime)}</span></div>`).join('') : emptyBox('最近没有文稿改动')}</div>
      </div>
    </div>`;
  }

  /* ── 文件 ── */
  function viewFiles() {
    const exts = Object.entries(DATA.byExt || {}).sort((a, b) => b[1] - a[1]).slice(0, 26);
    const recent = (DATA.recent || []).slice(0, 26);
    return `<div class="lw-g12">
      <div class="lw-c" style="${span(12)}">
        <h3>扩展名分布 <span class="sp"></span><em>共 ${DATA.totals.files} 个文件</em></h3>
        <div class="lw-chips">${exts.map(([e, n]) => `<span class="lw-chip">${esc(e)}<b>${n}</b></span>`).join('')}</div>
      </div>
      <div class="lw-c" style="${span(12)}">
        <h3>最近改动 <span class="sp"></span><em>点一行复制完整路径</em></h3>
        <div class="lw-tbl">${recent.map((f) => `<div class="lw-tr" data-path="${esc(f.path)}">
          <span class="nm">${esc(f.name)} <i>${esc(String(f.path).replace(DATA.home, '~').replace(/\/[^/]+$/, ''))}</i></span>
          <span class="bd">${esc(f.ext || '—')}</span><span class="sz">${fmtBytes(f.size)}</span>
          <span class="tm">${ago(f.mtime)}</span></div>`).join('')}</div>
      </div>
    </div>`;
  }

  /* ── 时间 ── */
  function viewTime() {
    const days = DATA.days || [];
    const max = Math.max(1, ...days.map((x) => x.count));
    const total = days.reduce((a, x) => a + x.count, 0);
    const active = days.filter((x) => x.count).length;
    return `<div class="lw-g12">
      <div class="lw-c" style="${span(3)}"><div class="lw-kpi">
        <div class="num">${total}<small>个改动</small></div><div class="lbl">近 14 天</div>
        <div class="cmp">日均 ${(total / 14).toFixed(1)} 个</div><div style="height:26px"></div></div></div>
      <div class="lw-c" style="${span(3)}"><div class="lw-kpi">
        <div class="num">${active}<small>天</small></div><div class="lbl">有改动</div>
        <div class="cmp">共 14 天</div><div style="height:26px"></div></div></div>
      <div class="lw-c" style="${span(6)}">
        <h3>改动趋势 <span class="sp"></span><em>近 14 天</em></h3>
        <div style="padding-top:6px">${spark(days.map((x) => x.count), 420, 96, T.accent)}</div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:${T.faint};margin-top:6px">
          <span>${(days[0] || {}).label || ''}</span><span>${(days[days.length - 1] || {}).label || ''}</span></div>
      </div>
      <div class="lw-c" style="${span(12)}">
        <h3>每日改动量 <span class="sp"></span><em>峰值 ${max}</em></h3>
        <div class="lw-bars">${days.map((x) => `<div title="${x.date} · ${x.count}">
          <span class="v">${x.count || ''}</span>
          <span class="b" style="height:${Math.max(3, Math.round(x.count / max * 96))}px"></span>
          <span class="k">${x.label}</span></div>`).join('')}</div>
      </div>
      <div class="lw-c" style="${span(12)}">
        <h3>各方向最近活跃 <span class="sp"></span><em>点一行复制项目路径</em></h3>
        <div class="lw-tbl">${(DATA.tracks || []).map((t) => `<div class="lw-tr" data-path="${esc((t.list[0] || {}).path || '')}">
          <span style="font-size:15px">${t.icon}</span><span class="nm">${esc(t.name)} <i>${t.projects} 个项目</i></span>
          <span class="bd" style="border-color:${t.color};color:${t.color}">${t.files} 文件</span>
          <span class="sz">${t.sizeText}</span><span class="tm">${ago(t.newest)}</span></div>`).join('')}</div>
      </div>
    </div>`;
  }
})();

