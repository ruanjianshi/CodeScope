/* CodeScope 架构图（前端）
 * ---------------------------------------------------------------------------
 * ★ 把「指一个项目 → 出可交互架构图」做成应用内功能 ✓（2026-10-11）——
 *   用户原话：「我给他一个项目，他可以给我分析，给出可以交互的架构图等，
 *              我需要给 codescope 添加这个功能」。
 *
 * 为什么单独一个资源文件、而不是写进 index.html：
 *   和「本机管家 / 编辑工作台 / Harness / 知识库」**完全同构** ✓ ——
 *   一个 header 按钮 + 一个 position:absolute 的工作区 section + 一个 body 模式类 ✓，
 *   样式和 DOM **全部运行时自建** ✓，index.html 只加一行 script ✓。
 *   （index.html 有 1.8 万行，几个人同时改必然互相覆盖 ✓。）
 *
 * 复用的宿主能力（拿不到就退回本地实现 ✓）：
 *   window.api(path)              —— 带错误处理的 JSON 请求
 *   window.setStatus              —— 右下角状态提示
 *   window.leaveEmbeddedWorkspaces—— 关掉其它内嵌工作区
 */
(() => {
  'use strict';
  if (window.__CODESCOPE_ARCH_MAP__) return;
  window.__CODESCOPE_ARCH_MAP__ = true;

  const API = '/api/arch';
  const MODE = 'arch-mode';
  const OTHER_MODES = ['dsh-mode', 'opencode-mode', 'vscode-mode', 'study-mode', 'office-mode', 'reading-mode', 'drawing-mode', 'knowledge-mode', 'system-mode', 'arch-mode'];

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  async function getJSON(url) {
    if (typeof window.api === 'function') return window.api(url);
    const r = await fetch(url);
    return r.json();
  }

  function status(kind, text) {
    if (typeof window.setStatus === 'function') { try { window.setStatus(kind, text); return; } catch (_) {} }
    const bar = $('arch-status');
    if (bar) bar.textContent = text;
  }

  function leaveOthers() {
    if (typeof window.leaveEmbeddedWorkspaces === 'function') {
      try { window.leaveEmbeddedWorkspaces(MODE, OTHER_MODES); return; } catch (_) {}
    }
    OTHER_MODES.forEach((m) => document.body.classList.remove(m));
  }

  /* ── 样式（运行时注入 ✓ —— 不碰 index.html 的样式表 ✓）────────────── */
  const CSS = `
#arch-workspace{position:absolute;inset:0;display:none;flex-direction:column;z-index:40;background:var(--bg,#10161f)}
body.arch-mode #arch-workspace{display:flex}
#arch-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.09);flex:0 0 auto;flex-wrap:wrap}
#arch-head .t{font-weight:500;font-size:14px;margin-right:4px}
#arch-head input,#arch-head select{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:inherit;border-radius:8px;padding:5px 9px;font-size:12px;font-family:inherit}
#arch-head input{min-width:280px}
#arch-head button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);color:inherit;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer}
#arch-head button:hover{border-color:#7aa2f7;color:#7aa2f7}
#arch-head button:disabled{opacity:.5;cursor:default}
#arch-stats{display:flex;gap:14px;padding:7px 14px;font-size:12px;color:#8c9bb5;border-bottom:1px solid rgba(255,255,255,.07);flex:0 0 auto;flex-wrap:wrap}
#arch-stats b{color:#e7edf6;font-weight:500}
#arch-stats .warn{color:#f7768e}
#arch-body{flex:1;min-height:0;position:relative}
#arch-frame{width:100%;height:100%;border:0;background:#1a1b26}
#arch-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#8c9bb5;font-size:13px;text-align:center;padding:24px}
#arch-empty .big{font-size:15px;color:#c0caf5}
#arch-spin{width:22px;height:22px;border:2px solid rgba(255,255,255,.2);border-top-color:#7aa2f7;border-radius:50%;animation:archspin .8s linear infinite}
@keyframes archspin{to{transform:rotate(360deg)}}
`;

  /* ── 建 DOM ────────────────────────────────────────────────────────── */
  function build() {
    const style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    /* header 按钮 ✓ */
    const btn = el('button');
    btn.id = 'btn-arch';
    btn.title = '架构图 —— 指一个项目，出一张可交互的架构图';
    btn.textContent = '🏗';
    btn.addEventListener('click', toggle);

    const host = document.querySelector('header') || document.body;
    const anchor = $('btn-system') || $('btn-dsh') || null;
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(btn, anchor.nextSibling);
    else host.appendChild(btn);

    /* 工作区 ✓ */
    const wrap = el('section');
    wrap.id = 'arch-workspace';

    const head = el('div');
    head.id = 'arch-head';
    head.appendChild(el('span', 't', '架构图'));

    const pathInput = el('input');
    pathInput.id = 'arch-path';
    pathInput.placeholder = '要分析的目录（绝对路径）';
    pathInput.spellcheck = false;
    head.appendChild(pathInput);

    const rootsSel = el('select');
    rootsSel.id = 'arch-roots';
    rootsSel.title = '常用目录';
    head.appendChild(rootsSel);

    const depthSel = el('select');
    depthSel.id = 'arch-depth';
    [['1', '按 1 层目录归组（粗）'], ['2', '按 2 层目录归组（推荐）'], ['3', '按 3 层目录归组（细）']].forEach(([v, t]) => {
      const o = el('option', null, t); o.value = v; depthSel.appendChild(o);
    });
    depthSel.value = '2';
    head.appendChild(depthSel);

    const go = el('button', null, '生成');
    go.id = 'arch-go';
    go.addEventListener('click', run);
    head.appendChild(go);

    const open = el('button', null, '新窗口打开');
    open.id = 'arch-open';
    open.addEventListener('click', () => {
      const url = frame.dataset.url;
      if (url) window.open(url, '_blank');
    });
    head.appendChild(open);

    const close = el('button', null, '关闭');
    close.id = 'arch-close';
    close.addEventListener('click', toggle);
    head.appendChild(close);

    wrap.appendChild(head);

    const stats = el('div');
    stats.id = 'arch-stats';
    wrap.appendChild(stats);

    const body = el('div');
    body.id = 'arch-body';

    const empty = el('div');
    empty.id = 'arch-empty';
    empty.innerHTML = '<div class="big">指一个项目，出一张可交互的架构图</div>'
      + '<div>分层泳道 · 方块大小按行数 · 红色是巨型文件 · 点方块看源证据</div>'
      + '<div style="opacity:.7">选好目录后点「生成」（只分析，不改任何文件）</div>';
    body.appendChild(empty);

    const frame = el('iframe');
    frame.id = 'arch-frame';
    frame.style.display = 'none';
    body.appendChild(frame);

    wrap.appendChild(body);
    document.body.appendChild(wrap);

    pathInput.value = '';
    rootsSel.addEventListener('change', () => { if (rootsSel.value) pathInput.value = rootsSel.value; });
    loadRoots();
  }

  async function loadRoots() {
    const sel = $('arch-roots');
    if (!sel) return;
    try {
      const r = await getJSON(API + '/roots');
      sel.innerHTML = '<option value="">常用目录…</option>';
      (r.roots || []).forEach((x) => {
        const o = el('option', null, x.name + '（' + x.entries + ' 项）');
        o.value = x.path;
        sel.appendChild(o);
      });
      const first = (r.roots || [])[0];
      const input = $('arch-path');
      if (first && input && !input.value) input.value = first.path;
    } catch (_) {}
  }

  let busy = false;
  async function run() {
    if (busy) return;
    const input = $('arch-path');
    const frame = $('arch-frame');
    const empty = $('arch-empty');
    const stats = $('arch-stats');
    const go = $('arch-go');
    const path = String(input && input.value || '').trim();
    if (!path) { status('err', '先填一个目录'); return; }

    busy = true;
    if (go) { go.disabled = true; go.textContent = '分析中…'; }
    if (empty) empty.innerHTML = '<div id="arch-spin"></div><div>正在扫描…</div>';
    if (empty) empty.style.display = 'flex';
    if (stats) stats.textContent = '';

    try {
      /* 先拿 IR（拿到统计 ✓），再让 iframe 去取图 ✓ */
      const a = await getJSON(API + '/analyze?depth=' + encodeURIComponent($('arch-depth').value)
        + '&path=' + encodeURIComponent(path));
      if (!a.ok) throw new Error(a.error || '分析失败');
      const s = a.ir.summary;
      const big = a.ir.bigFiles.filter((f) => f.lines >= 3000);
      if (stats) {
        stats.innerHTML = '目录 <b>' + escapeHtml(path) + '</b>'
          + ' · 文件 <b>' + s.files + '</b>'
          + ' · <b>' + s.totalLines.toLocaleString('en-US') + '</b> 行'
          + ' · 模块 <b>' + s.modules + '</b>'
          + ' · 耗时 <b>' + a.ms + 'ms</b>'
          + (big.length ? ' · <span class="warn">巨型文件 <b>' + big.length + '</b> 个</span>' : '');
      }
      const url = API + '/map?depth=' + encodeURIComponent($('arch-depth').value)
        + '&title=' + encodeURIComponent(path.split('/').pop() || '项目')
        + '&path=' + encodeURIComponent(path);
      frame.dataset.url = url;
      frame.src = url;
      frame.style.display = 'block';
      if (empty) empty.style.display = 'none';
      status('ok', '架构图已生成（' + s.files + ' 文件 / ' + s.modules + ' 模块）');
    } catch (error) {
      if (empty) empty.innerHTML = '<div class="big">没做成</div><div>' + escapeHtml(String((error && error.message) || error)) + '</div>';
      status('err', String((error && error.message) || error));
    } finally {
      busy = false;
      if (go) { go.disabled = false; go.textContent = '生成'; }
    }
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toggle() {
    const on = !document.body.classList.contains(MODE);
    if (on) leaveOthers();
    document.body.classList.toggle(MODE, on);
    const btn = $('btn-arch');
    if (btn) btn.classList.toggle('on', on);
    if (on && !$('arch-frame').dataset.url) {
      const input = $('arch-path');
      if (input) input.focus();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
