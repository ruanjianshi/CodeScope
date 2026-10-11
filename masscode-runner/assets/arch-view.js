/* ═══════════════════════════════════════════════════════════════════════════
 * 架构视图 · 面板集成（assets/arch-view.js）
 * ---------------------------------------------------------------------------
 * 和「图谱」**同一个面板**（#cg-canvas / #cg-body），工具栏按钮切换 ✓。
 * 这里只管：抓数据 → 塞进面板 → 缩放平移 → 点方块跳源码 ✓。
 * ⚠️ 画图在 `arch-graph-svg.js`（机械图）/ `arch-ai-view.js`（AI 语义图），
 *    走线在 `arch-layout.js`，缩放平移在 `arch-zoom.js` ✓。
 * ⚠️ 面板切换按钮（🕸 图谱 / ▦ 架构）仍在 app.js —— 它和 CG_ACTIVE /
 *    renderCodeGraphPane / 工具栏拧在一起 ✓，搬过来更绕 ✓。
 * ═══════════════════════════════════════════════════════════════════════════ */

/* AI 分析结果（只对**当前文件**有效 ✓ —— 换文件自动失效，不用手动清 ✓）*/
let ARCH_AI = null;
function archAIFor(file) {
  return (ARCH_AI && ARCH_AI.file === file) ? ARCH_AI.ai : null;
}

/* 架构视图：同一份数据，画成分层方块（点节点高亮上下游 ✓） */
async function renderArchIntoPane(body) {
  const seq = ++CG_SEQ;
  body.innerHTML = '<span class="ol-empty">正在生成架构图…</span>';
  if ($('cg-stats')) $('cg-stats').textContent = '…';
  try {
    const response = await fetch('/api/graph?scope=document&file=' + encodeURIComponent(CURRENT.file));
    const graph = await response.json();
    if (seq !== CG_SEQ) return;
    if (!graph || !graph.ok) throw new Error((graph && graph.error) || '生成失败');
    if (!(graph.nodes || []).length) {
      body.innerHTML = '<span class="ol-empty">这个文档里没有代码片段</span>';
      if ($('cg-stats')) $('cg-stats').textContent = '';
      return;
    }
    /* 按**面板宽度**决定折行点 —— 面板窄就多折几行，
       让「打开即适应」的比例尽量接近可读（而不是缩到 45% 看不清字）✓ */
    const panelW = Math.max(320, (body.clientWidth || 0) - 40);
    const maxRowW = Math.min(1200, panelW * 1.2);
    const ai = archAIFor(CURRENT.file);
    const svg = ai ? archAISvg(graph, ai, { maxRowW: maxRowW * 1.6 })
                   : archGraphSvg(graph, { maxRowW });
    body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'doc-graph';
    /* ⚠️ 要 `flex:1 1 auto; min-height:0` 把面板**撑满** ✗✓ ——
       不撑满的话 host 高度由内容决定 ✓，`#cg-body` 是 `overflow:hidden` ✓，
       内容一高就被**裁掉** ✓（自己的 `overflow:auto` 永远不触发 ✓）。
       撑满之后「适应窗口」才有高度可算 ✓。 */
    host.style.cssText = 'flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px 16px;position:relative';
    host.appendChild(svg);
    body.appendChild(host);
    wireArchZoom(host, svg);
    if ($('cg-ai')) $('cg-ai').textContent = ai ? '✦ 重跑分析' : '✦ AI 分析';
    const st = graph.stats || {};
    if ($('cg-stats')) {
      $('cg-stats').textContent = (st.fragments || 0) + ' 个片段 · ' + (st.functions || 0) + ' 个函数 · '
        + (st.calls || 0) + ' 条调用 · ' + (st.includes || 0) + ' 条包含';
    }
    setStatus('ok', ai ? 'AI 架构图：点模块可高亮它的关系' : '架构图：点方块可高亮它的上下游 · 点「✦ AI 分析」出语义版');
  } catch (error) {
    if (seq !== CG_SEQ) return;
    body.innerHTML = '<span class="ol-empty">架构图失败：' + escapeHtml(String((error && error.message) || error)) + '</span>';
    if ($('cg-stats')) $('cg-stats').textContent = '';
  }
}

/* ── 工具栏接线 + 启动时同步视图状态 ──
   ⚠️⚠️ 用户撞到的 BUG：「**高亮的是图谱，为什么显示架构图**」✓
      `CG_VIEW` 从 localStorage 读 ✓，但按钮的 `on` 类和标题是 **HTML 里的死值** ✓，
      而 `setCodeGraphView()` **只在 onclick 里被调用** ✗ → 启动时两边对不上 ✓。
   ⇒ 启动补一次同步 ✓（只切类名/标题，此时 CG_ACTIVE 还是 false ✓，不会多绘 ✓）。
   详见 CHANGELOG「第五轮」。 */
function wireArchToolbar() {
  if (typeof wireArchAIButton === 'function') wireArchAIButton();
  try {
    if (typeof setCodeGraphView === 'function' && typeof CG_VIEW === 'string') setCodeGraphView(CG_VIEW);
  } catch (_) { /* app.js 还没跑完就跳过，不值得为它炸掉整个脚本 ✓ */ }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireArchToolbar);
else wireArchToolbar();
