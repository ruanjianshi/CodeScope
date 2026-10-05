/*!
 * life-workbench.js —— 「我的工作台」个人管理系统
 * ---------------------------------------------------------------------------
 * 挂在「本机管家」里的一个独立模块（自建 UI，和主界面互不覆盖）。
 * 数据来自 /api/life/index（lib/life-index.js 扫本机 + 按研究方向归类）。
 *
 * 面向：研究生 · 机器人运动控制 / 嵌入式开发 / 论文撰写
 * 五块：今日 / 研究方向 / 论文 / 文件 / 时间
 */
(() => {
  'use strict';

  const CSS = `
  .lw-mask { position:fixed; inset:0; z-index:9600; background:rgba(4,7,12,.72); backdrop-filter:blur(6px);
    display:none; align-items:center; justify-content:center; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
  .lw-mask.on { display:flex; }
  .lw { width:min(1440px,96vw); height:min(920px,94vh); display:flex; flex-direction:column;
    background:linear-gradient(180deg,#151922,#11151c); border:1px solid #2a3140; border-radius:16px;
    box-shadow:0 30px 90px rgba(0,0,0,.62); color:#e6e8ee; overflow:hidden; }
  .lw-top { display:flex; align-items:center; gap:14px; padding:14px 20px; border-bottom:1px solid #232a36;
    background:linear-gradient(180deg,#1a1f29,#161a22); }
  .lw-title { font-size:16px; font-weight:700; letter-spacing:.3px; }
  .lw-title em { font-style:normal; color:#4f8cff; }
  .lw-sub { font-size:12px; color:#8b95a6; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lw-btn { height:30px; padding:0 12px; border-radius:9px; border:1px solid #30384a; background:#1d2430;
    color:#cfd6e2; font-size:12px; cursor:pointer; }
  .lw-btn:hover { background:#232c3b; border-color:#3d4860; }
  .lw-body { flex:1; display:flex; min-height:0; }
  .lw-nav { width:186px; flex:none; padding:14px 10px; border-right:1px solid #232a36; background:#13171f; }
  .lw-nav button { width:100%; display:flex; align-items:center; gap:9px; padding:9px 11px; margin-bottom:4px;
    border:1px solid transparent; border-radius:10px; background:transparent; color:#a9b3c4; font-size:13px; cursor:pointer; text-align:left; }
  .lw-nav button:hover { background:#1b212c; color:#e6e8ee; }
  .lw-nav button.on { background:linear-gradient(90deg,rgba(79,140,255,.20),rgba(79,140,255,.05));
    border-color:rgba(79,140,255,.42); color:#eaf1ff; font-weight:600; }
  .lw-nav .ic { width:18px; text-align:center; }
  .lw-nav .sep { margin:12px 8px 8px; font-size:10px; letter-spacing:1.4px; color:#5b6577; text-transform:uppercase; }
  .lw-main { flex:1; min-width:0; overflow:auto; padding:20px 22px 40px; }
  .lw-main::-webkit-scrollbar { width:10px; } .lw-main::-webkit-scrollbar-thumb { background:#2a3242; border-radius:6px; }
  .lw-grid { display:grid; gap:14px; }
  .lw-card { background:linear-gradient(180deg,#1a2029,#171c25); border:1px solid #252d3a; border-radius:14px; padding:16px 18px; }
  .lw-card h3 { margin:0 0 12px; font-size:13px; font-weight:600; color:#c8d1e0; display:flex; align-items:center; gap:8px; }
  .lw-card h3 .sp { flex:1; }
  .lw-card h3 small { font-weight:400; color:#7c869a; font-size:11px; }
  .lw-kpi { font-size:30px; font-weight:700; line-height:1.1; letter-spacing:-.5px; }
  .lw-kpi small { font-size:12px; font-weight:400; color:#8b95a6; margin-left:5px; }
  .lw-hint { font-size:11px; color:#7c869a; margin-top:5px; }
  .lw-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:9px; }
  .lw-row:hover { background:#1d232e; }
  .lw-row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px; }
  .lw-row .mt { font-size:11px; color:#7c869a; flex:none; }
  .lw-row .tag { font-size:10px; padding:1px 7px; border-radius:999px; border:1px solid #333c4d; color:#9aa6ba; flex:none; }
  .lw-bar { height:7px; border-radius:4px; background:#232b38; overflow:hidden; }
  .lw-bar i { display:block; height:100%; border-radius:4px; }
  .lw-empty { color:#6f7a8d; font-size:12.5px; padding:14px 4px; }
  .lw-heat { display:grid; grid-template-columns:repeat(14,1fr); gap:4px; }
  .lw-heat i { aspect-ratio:1; border-radius:4px; background:#1e2531; }
  .lw-chips { display:flex; flex-wrap:wrap; gap:7px; }
  .lw-chip { font-size:11px; padding:3px 9px; border-radius:999px; border:1px solid #303948; background:#1b2129; color:#a9b3c4; }
  .lw-open { cursor:pointer; }
  .lw-open:hover { color:#7fb0ff; }
  /* 悬浮启动按钮 */
  .lw-launch { position:fixed; left:14px; bottom:14px; z-index:9400; display:flex; align-items:center; gap:7px;
    padding:8px 13px 8px 11px; border-radius:11px; border:1px solid #33405a;
    background:linear-gradient(180deg,#1e2634,#171d27); color:#dbe4f2; font-size:12.5px; font-weight:600;
    cursor:pointer; box-shadow:0 8px 26px rgba(0,0,0,.5); font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
  .lw-launch:hover { border-color:#4f8cff; color:#fff; box-shadow:0 10px 30px rgba(79,140,255,.28); }
  .lw-launch .dot { width:7px; height:7px; border-radius:50%; background:#3fb950; box-shadow:0 0 8px #3fb950; }
  `;

  const NAV = [
    { id: 'today', icon: '☀️', label: '今日' },
    { id: 'tracks', icon: '🎯', label: '研究方向' },
    { id: 'paper', icon: '📄', label: '论文' },
    { id: 'files', icon: '🗂', label: '文件' },
    { id: 'time', icon: '📈', label: '时间' },
  ];

  let ROOT = null, DATA = null, TAB = 'today', LOADING = false;

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
    if (d < h) return Math.floor(d / m) + ' 分钟前';
    if (d < day) return Math.floor(d / h) + ' 小时前';
    if (d < day * 30) return Math.floor(d / day) + ' 天前';
    return new Date(ms).toISOString().slice(0, 10);
  }
  function dstr(ms) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }

  window.LifeWorkbench = { open, close };
  document.addEventListener('DOMContentLoaded', mount);

  function mount() {
    if (ROOT) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    ROOT = document.createElement('div'); ROOT.className = 'lw-mask';
    ROOT.innerHTML = `
      <div class="lw">
        <div class="lw-top">
          <div class="lw-title">我的工作台 <em>·</em> 研究生</div>
          <div class="lw-sub" id="lw-sub">正在读取本机…</div>
          <button class="lw-btn" id="lw-refresh">↻ 重新扫描</button>
          <button class="lw-btn" id="lw-close">关闭</button>
        </div>
        <div class="lw-body">
          <div class="lw-nav" id="lw-nav"></div>
          <div class="lw-main" id="lw-main"></div>
        </div>
      </div>`;
    document.body.appendChild(ROOT);
    ROOT.querySelector('#lw-close').onclick = close;
    ROOT.querySelector('#lw-refresh').onclick = () => load(true);
    ROOT.addEventListener('click', (e) => { if (e.target === ROOT) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ROOT.classList.contains('on')) close(); });
    renderNav();
    /* 悬浮启动按钮：不占主界面位置，随时能开 */
    if (!document.querySelector('.lw-launch')) {
      const lb = document.createElement('button');
      lb.className = 'lw-launch';
      lb.innerHTML = '<span class="dot"></span>我的工作台';
      lb.title = '个人管理系统 · 今日 / 研究方向 / 论文 / 文件 / 时间';
      lb.onclick = open;
      document.body.appendChild(lb);
    }
  }

  function renderNav() {
    const nav = ROOT.querySelector('#lw-nav');
    nav.innerHTML = '<div class="sep">视图</div>' + NAV.map((n) =>
      `<button data-tab="${n.id}" class="${n.id === TAB ? 'on' : ''}"><span class="ic">${n.icon}</span>${n.label}</button>`).join('');
    nav.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { TAB = b.dataset.tab; renderNav(); render(); };
    });
  }

  function open() {
    mount();
    ROOT.classList.add('on');
    if (!DATA) load(false); else render();
  }
  function close() { if (ROOT) ROOT.classList.remove('on'); }

  async function load(force) {
    if (LOADING) return;
    LOADING = true;
    const sub = ROOT.querySelector('#lw-sub');
    sub.textContent = '正在扫描本机文件…';
    try {
      const r = await fetch('/api/life/index?depth=3', { cache: 'no-store' });
      DATA = await r.json();
      if (!DATA || !DATA.ok) throw new Error((DATA && DATA.error) || '读取失败');
      sub.textContent = `已扫 ${DATA.totals.projects} 个项目 · ${DATA.totals.files} 个文件 · ${DATA.totals.sizeText} · 更新于 ${dstr(DATA.scannedAt)}`;
    } catch (e) {
      sub.textContent = '读取失败：' + e.message;
    }
    LOADING = false;
    render();
  }

  function render() {
    if (!DATA) return;
    const main = ROOT.querySelector('#lw-main');
    if (TAB === 'today') main.innerHTML = viewToday();
    else if (TAB === 'tracks') main.innerHTML = viewTracks();
    else if (TAB === 'paper') main.innerHTML = viewPaper();
    else if (TAB === 'files') main.innerHTML = viewFiles();
    else main.innerHTML = viewTime();
    main.querySelectorAll('[data-path]').forEach((el) => {
      el.classList.add('lw-open');
      el.onclick = () => copyPath(el.dataset.path);
    });
  }

  function copyPath(p) {
    try {
      navigator.clipboard.writeText(p);
      const sub = ROOT.querySelector('#lw-sub');
      sub.textContent = '已复制路径：' + p;
    } catch (_) {}
  }

  function trackOf(id) { return (DATA.tracks || []).find((t) => t.id === id) || null; }

  /* ── 今日 ── */
  function viewToday() {
    const d = new Date();
    const hour = d.getHours();
    const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 19 ? '下午好' : '晚上好';
    const today = d.toISOString().slice(0, 10);
    const todayCount = (DATA.days || []).find((x) => x.date === today);
    const hot = (DATA.recent || []).slice(0, 9);
    const maxDay = Math.max(1, ...(DATA.days || []).map((x) => x.count));

    return `
    <div class="lw-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
      <div class="lw-card"><div class="lw-kpi">${DATA.totals.projects}<small>个项目</small></div><div class="lw-hint">本机已纳管</div></div>
      <div class="lw-card"><div class="lw-kpi">${DATA.totals.files}<small>个文件</small></div><div class="lw-hint">合计 ${DATA.totals.sizeText}</div></div>
      <div class="lw-card"><div class="lw-kpi">${todayCount ? todayCount.count : 0}<small>个改动</small></div><div class="lw-hint">今天（近 14 天）</div></div>
      <div class="lw-card"><div class="lw-kpi">${(DATA.tracks || []).length}<small>个方向</small></div><div class="lw-hint">机器人 · 嵌入式 · 论文</div></div>
    </div>
    <div class="lw-grid" style="grid-template-columns:1.35fr 1fr">
      <div class="lw-card">
        <h3>${greet} · 最近在动的文件 <small>点一下复制路径</small></h3>
        ${hot.map((f) => `<div class="lw-row" data-path="${esc(f.path)}">
          <span class="tag">${esc(f.ext || '—')}</span>
          <span class="nm">${esc(f.name)}</span>
          <span class="mt">${ago(f.mtime)}</span></div>`).join('') || '<div class="lw-empty">暂无</div>'}
      </div>
      <div>
        <div class="lw-card" style="margin-bottom:14px">
          <h3>近 14 天改动强度</h3>
          <div class="lw-heat">${(DATA.days || []).map((x) => {
            const a = x.count / maxDay;
            return `<i title="${x.date} · ${x.count} 个文件" style="background:${x.count ? `rgba(79,140,255,${0.18 + a * 0.82})` : '#1e2531'}"></i>`;
          }).join('')}</div>
          <div class="lw-hint" style="margin-top:8px">${(DATA.days || []).map((x) => x.label).join(' · ')}</div>
        </div>
        <div class="lw-card">
          <h3>文件构成</h3>
          ${Object.entries(DATA.byKind || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
            const total = DATA.totals.files || 1, pct = Math.round(v / total * 100);
            const color = { code: '#4f8cff', doc: '#f0883e', media: '#a371f7', model: '#3fb950', other: '#5b6577' }[k] || '#5b6577';
            const name = { code: '代码', doc: '文档', media: '媒体/图', model: '三维模型', other: '其他' }[k] || k;
            return `<div style="margin-bottom:9px"><div style="display:flex;font-size:11.5px;color:#9aa6ba;margin-bottom:4px">
              <span style="flex:1">${name}</span><span>${v} · ${pct}%</span></div>
              <div class="lw-bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }

  /* ── 研究方向 ── */
  function viewTracks() {
    const tracks = DATA.tracks || [];
    if (!tracks.length) return '<div class="lw-empty">还没扫到项目</div>';
    const maxFiles = Math.max(1, ...tracks.map((t) => t.files));
    return `<div class="lw-grid" style="grid-template-columns:repeat(2,1fr)">` + tracks.map((t) => `
      <div class="lw-card">
        <h3><span style="font-size:16px">${t.icon}</span>${esc(t.name)}
          <span class="sp"></span><small>${t.projects} 项目 · ${t.files} 文件 · ${t.sizeText}</small></h3>
        <div class="lw-bar" style="margin-bottom:12px"><i style="width:${Math.round(t.files / maxFiles * 100)}%;background:${t.color}"></i></div>
        ${t.list.map((p) => `<div class="lw-row" data-path="${esc(p.path)}">
          <span class="nm">${esc(p.name)}</span>
          <span class="tag">${p.files} 文件</span>
          <span class="mt">${ago(p.newest)}</span></div>`).join('')}
      </div>`).join('') + `</div>`;
  }

  /* ── 论文 ── */
  function viewPaper() {
    const paper = trackOf('paper');
    const ps = (DATA.projects || []).filter((p) => p.track === 'paper' || /paper|manuscript|论文|latex|投稿|开题|摘要/i.test(p.name));
    const docs = (DATA.recent || []).filter((f) => /\.(docx?|tex|pdf|pptx?|md)$/i.test(f.name)).slice(0, 14);
    return `
    <div class="lw-grid" style="grid-template-columns:1fr 1fr;margin-bottom:14px">
      <div class="lw-card"><div class="lw-kpi">${paper ? paper.projects : 0}<small>个论文项目</small></div>
        <div class="lw-hint">${paper ? paper.files + ' 个文件 · ' + paper.sizeText : '未归类到论文'}</div></div>
      <div class="lw-card"><div class="lw-kpi">${docs.length}<small>篇文档在近期待办</small></div>
        <div class="lw-hint">docx / tex / pdf / pptx</div></div>
    </div>
    <div class="lw-grid" style="grid-template-columns:1fr 1fr">
      <div class="lw-card"><h3>论文项目</h3>
        ${ps.map((p) => `<div class="lw-row" data-path="${esc(p.path)}">
          <span class="nm">${esc(p.name)}</span><span class="tag">${p.files}</span><span class="mt">${ago(p.newest)}</span></div>`).join('') || '<div class="lw-empty">暂无</div>'}
      </div>
      <div class="lw-card"><h3>文稿 / 插图 <small>最近改动</small></h3>
        ${docs.map((f) => `<div class="lw-row" data-path="${esc(f.path)}">
          <span class="tag">${esc(f.ext)}</span><span class="nm">${esc(f.name)}</span><span class="mt">${ago(f.mtime)}</span></div>`).join('') || '<div class="lw-empty">暂无</div>'}
      </div>
    </div>`;
  }

  /* ── 文件 ── */
  function viewFiles() {
    const exts = Object.entries(DATA.byExt || {}).sort((a, b) => b[1] - a[1]).slice(0, 22);
    return `
    <div class="lw-card" style="margin-bottom:14px">
      <h3>扩展名分布 <small>共 ${DATA.totals.files} 个文件</small></h3>
      <div class="lw-chips">${exts.map(([e, n]) => `<span class="lw-chip">${esc(e)} <b style="color:#7fb0ff">${n}</b></span>`).join('')}</div>
    </div>
    <div class="lw-card">
      <h3>最近改动 <small>点一下复制完整路径</small></h3>
      ${(DATA.recent || []).map((f) => `<div class="lw-row" data-path="${esc(f.path)}">
        <span class="tag">${esc(f.ext || '—')}</span>
        <span class="nm">${esc(f.name)}<span style="color:#5f6b7e;font-size:11px"> · ${esc(f.path.replace(DATA.home, '~'))}</span></span>
        <span class="mt">${fmtBytes(f.size)} · ${ago(f.mtime)}</span></div>`).join('')}
    </div>`;
  }

  /* ── 时间 ── */
  function viewTime() {
    const days = DATA.days || [];
    const max = Math.max(1, ...days.map((x) => x.count));
    return `
    <div class="lw-card" style="margin-bottom:14px">
      <h3>近 14 天改动量</h3>
      <div style="display:flex;align-items:flex-end;gap:8px;height:150px;padding:6px 2px">
        ${days.map((x) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px">
          <span style="font-size:10px;color:#8b95a6">${x.count || ''}</span>
          <i style="display:block;width:100%;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#4f8cff,#2f5fb0);
            height:${Math.max(3, Math.round(x.count / max * 110))}px"></i>
          <span style="font-size:10px;color:#6f7a8d">${x.label}</span></div>`).join('')}
      </div>
    </div>
    <div class="lw-card">
      <h3>各方向最近活跃</h3>
      ${(DATA.tracks || []).map((t) => `<div class="lw-row" data-path="${esc((t.list[0] || {}).path || '')}">
        <span class="tag" style="border-color:${t.color};color:${t.color}">${t.icon}</span>
        <span class="nm">${esc(t.name)}</span>
        <span class="mt">${t.files} 文件 · ${t.sizeText} · ${ago(t.newest)}</span></div>`).join('')}
    </div>`;
  }
})();
