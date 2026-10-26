/* 字符图标 → 统一线性 SVG（全站共用）
   ⚠️ 单独放一个文件：app.js 有「代码行数只准变小」的棘轮，helper 塞进去会顶破上限 ✓。
   右键菜单全部从 showContextMenu 渲染，所以那边改一处即全站生效 ✓；
   其余 textContent 赋值处用 csGlyphIcon(...) 包一层 ✓。
   没登记的字形原样返回（✓ ✗ emoji 属于状态符号，不是图标，不动）✓。 */
const CS_GLYPH_ICON = { '＋':'i-plus','+':'i-plus','▣':'i-folder-plus','▣+':'i-folder-plus','P+':'i-folder-plus','M+':'i-file','✎':'i-pen','⌕':'i-search','▸':'i-chevron-right','▾':'i-chevron','✕':'i-close','⋯':'i-more','‹':'i-chevron-left','›':'i-chevron-right','↻':'i-refresh','↶':'i-undo','↷':'i-redo','▰':'i-folder','−':'i-minus','×':'i-close','ⓘ':'i-info','🗑':'i-trash','⇄':'i-swap','↗':'i-external','▤':'i-book','📁':'i-folder','📄':'i-file','📂':'i-folder' };
const csGlyphIcon = (g) => { const id = CS_GLYPH_ICON[String(g || '').trim()]; return id ? `<svg class="cs-ico" aria-hidden="true"><use href="#${id}"/></svg>` : g; };
/* 字符串开头的字形 → SVG（「✕ 关闭」这种图标+文字拼在一起的老写法也能转 ✓，纯文字原样返回 ✓） */
const csGlyphText = (s) => String(s == null ? '' : s).replace(/^(📁|📄|📂|▣\+|P\+|M\+|[＋▣✎✕▸▾‹›↶↷↻−×⋯▰⌕+ⓘ🗑⇄↗▤])\s*/, (m, g) => csGlyphIcon(g) + ' ');

/* ── 渲染后统一扫描 ───────────────────────────────────────────────
   ⚠️ 还有一批图标藏在 HTML 模板字符串里（`<button>↻ 立即生成</button>`）✓，
      逐个改模板要么引号冲突、要么破坏拼接 ✗。
   这里改成**渲染完扫一遍**：只处理「元素第一个子节点是文本、且以字形开头」的情况 ✓，
   把那个字形换成 SVG ✓。带 MutationObserver，动态渲染出来的也覆盖 ✓。
   ⚠️ 必须排除代码区：pre / code / textarea / 输入框 / 终端 —— 那些里的 ▸ ↻ 是正文 ✗。 */
const CS_GLYPH_HEAD = /^(📁|📄|📂|▣\+|P\+|M\+|[＋▣✎✕▸▾‹›↶↷↻−×⋯▰⌕+ⓘ🗑⇄↗▤])\s*/;
const CS_SKIP = new Set(['PRE', 'CODE', 'TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE', 'KBD']);
let csSweepQueued = false;
function csSweepIcons(root) {
  const scope = root && root.querySelectorAll ? root : document.body;
  if (!scope) return;
  const nodes = scope.querySelectorAll('button, .tab, .tabs-all, span, div, b, strong, small, a');
  for (const el of nodes) {
    if (CS_SKIP.has(el.tagName)) continue;
    if (el.closest('pre, code, textarea, .cm-editor, .CodeMirror, .xterm')) continue;
    if (el.firstElementChild && el.firstElementChild.classList && el.firstElementChild.classList.contains('cs-ico')) continue;
    const t = el.firstChild;
    if (!t || t.nodeType !== 3) continue;
    const m = CS_GLYPH_HEAD.exec(t.nodeValue);
    if (!m) continue;
    t.nodeValue = t.nodeValue.slice(m[0].length);
    el.insertAdjacentHTML('afterbegin', csGlyphIcon(m[1]));
  }
}
function csQueueSweep() {
  if (csSweepQueued) return;
  csSweepQueued = true;
  requestAnimationFrame(() => { csSweepQueued = false; try { csSweepIcons(document.body); } catch (_) {} });
}
document.addEventListener('DOMContentLoaded', csQueueSweep);
new MutationObserver(csQueueSweep).observe(document.documentElement, { childList: true, subtree: true });

/* 反查：从按钮里已经渲染好的 SVG 反推出它原本是哪个字形（右键菜单要复用这个字形当图标 ✓） */
const CS_ICON_GLYPH = Object.fromEntries(Object.entries(CS_GLYPH_ICON).map(([g, id]) => [id, g]));
const csGlyphOf = (el) => {
  const g = el && el.dataset && el.dataset.glyph;
  if (g) return g;
  const t = (el && el.textContent || '').trim();
  if (t) return t;
  const use = el && el.querySelector && el.querySelector('svg.cs-ico use');
  const id = use && use.getAttribute('href');
  return (id && CS_ICON_GLYPH[id.replace('#', '')]) || '';
};
