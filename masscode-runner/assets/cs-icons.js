/* 字符图标 → 统一线性 SVG（全站共用）
   ⚠️ 单独放一个文件：app.js 有「代码行数只准变小」的棘轮，helper 塞进去会顶破上限 ✓。
   右键菜单全部从 showContextMenu 渲染，所以那边改一处即全站生效 ✓；
   其余 textContent 赋值处用 csGlyphIcon(...) 包一层 ✓。
   没登记的字形原样返回（✓ ✗ emoji 属于状态符号，不是图标，不动）✓。 */
const CS_GLYPH_ICON = { '＋':'i-plus','+':'i-plus','▣':'i-folder-plus','▣+':'i-folder-plus','P+':'i-folder-plus','M+':'i-file','✎':'i-pen','⌕':'i-search','▸':'i-chevron-right','▾':'i-chevron','✕':'i-close','⋯':'i-more','‹':'i-chevron-left','›':'i-chevron-right','↻':'i-refresh','↶':'i-undo','↷':'i-redo','▰':'i-folder','−':'i-minus','×':'i-close','ⓘ':'i-info','🗑':'i-trash','⇄':'i-swap','↗':'i-external','▤':'i-book','📁':'i-folder','📄':'i-file','📂':'i-folder' };
const csGlyphIcon = (g) => { const id = CS_GLYPH_ICON[String(g || '').trim()]; return id ? `<svg class="cs-ico" aria-hidden="true"><use href="#${id}"/></svg>` : g; };
/* 字符串开头的字形 → SVG（「✕ 关闭」这种图标+文字拼在一起的老写法也能转 ✓，纯文字原样返回 ✓） */
const csGlyphText = (s) => String(s == null ? '' : s).replace(/^(📁|📄|📂|▣\+|P\+|M\+|[＋▣✎✕▸▾‹›↶↷↻−×⋯▰⌕+ⓘ🗑⇄↗▤])\s*/, (m, g) => csGlyphIcon(g) + ' ');
/* ── 渲染后统一扫描：只走文本节点、只扫变动区域（2026-10-28 重写）────────────
   ⚠️ 旧实现在这里留了一个 O(文档元素数) 的热点 ✗，实测（CDP CPU profile，连切 6 次片段标签）：
     它在 documentElement 上挂 subtree:true 的观察器 ✓，任何一次渲染都会触发一次 rAF 回调 ✓，
     而回调是 document.body.querySelectorAll(button/.tab/span/div/b/strong/small/a) ✗，
     再对**每个**元素调一次 el.closest(pre, code, .cm-editor, .xterm) ✗。
     切一个标签要重建 21 个 tab + 代码区 + 折叠栏 ✓ → 一次渲染付一次全文档重扫 ✓；
     profile 里 csSweepIcons 3% + closest 3% + querySelectorAll 2% ✓，
     切标签中位数 127ms / 最差 170ms、21 个标签连切 2.6 秒 ✓（用户原话：渲染有点慢）。
   ⇒ 现在两处改动，语义等价、代价从「全元素」降到「有字形的文本节点」：
     ① **文本节点探针**：TreeWalker 只走文本节点 ✓，先看首个字符是不是字形 ✓
        —— 绝大多数文本节点在这一行就被否决 ✓，根本不进 DOM 查询 ✓；
     ② **只扫变动区域**：观察器把 rec.target 收进待扫集合 ✓，只在这些子树里走 ✓
        （旧实现无论哪里变都重扫整个 body ✗）。
   ⚠️ 仍然必须排除代码区 ✓：pre / code / textarea / 输入框 / 终端 / Monaco ——
      那边里的 ▸ ↻ 是**正文** ✓，转成图标就把用户代码改掉了 ✗。
   ⚠️ 祖先检查用**有界上溯**（≤12 层）而不是 closest(选择器) ✓：
      候选节点已经很少（只到含字形的那些 ✓），这里几乎不花时间 ✓。
   ⚠️ 幂等性靠「字形被消费掉」保证 ✓：转换后文本不再以字形开头 ✓，
      第二轮扫描自然找不到它 ✓（所以不需要额外的已处理标记 ✓）。 */
const CS_GLYPH_HEAD = /^(📁|📄|📂|▣\+|P\+|M\+|[＋▣✎✕▸▾‹›↶↷↻−×⋯▰⌕+ⓘ🗑⇄↗▤])\s*/;
/* 首字符白名单：用 Set 判一次 charAt(0) 远比跑正则便宜 ✓ */
const CS_GLYPH_FIRST = new Set('📁📄📂＋▣✎✕▸▾‹›↶↷↻−×⋯▰⌕+ⓘ🗑⇄↗▤PM');
const CS_SKIP = new Set(['PRE', 'CODE', 'TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE', 'KBD']);
const CS_SKIP_CLASS = ['cm-editor', 'CodeMirror', 'xterm', 'monaco-editor', 'cs-ico'];

function csInSkippedZone(node) {
  let el = node.parentElement, depth = 0;
  while (el && depth++ < 12) {
    if (CS_SKIP.has(el.tagName)) return true;
    const c = el.classList;
    if (c && c.length) {
      for (let i = 0; i < c.length; i++) if (CS_SKIP_CLASS.indexOf(c[i]) >= 0) return true;
    }
    el = el.parentElement;
  }
  return false;
}

function csSweepIcons(root) {
  const scope = (root && root.nodeType === 1 && root.isConnected) ? root : document.body;
  if (!scope) return;
  /* 先只收集、后统一改 ✗ —— 边走边改 DOM 会让 TreeWalker 的游标行为依赖引擎实现 ✓ */
  const hits = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    const v = n.nodeValue;
    if (!v) continue;
    if (!CS_GLYPH_FIRST.has(v.charAt(0))) continue;
    if (!CS_GLYPH_HEAD.test(v)) continue;
    hits.push(n);
  }
  for (const t of hits) {
    if (!t.isConnected) continue;
    if (csInSkippedZone(t)) continue;
    const el = t.parentElement;
    if (!el) continue;
    const m = CS_GLYPH_HEAD.exec(t.nodeValue);
    if (!m) continue;
    t.nodeValue = t.nodeValue.slice(m[0].length);
    el.insertAdjacentHTML('afterbegin', csGlyphIcon(m[1]));
  }
}

/* 同一帧内的多次变动合并成一次；并且只扫变动区域 ✓ */
const csPending = new Set();
let csSweepQueued = false;
function csQueueSweep(root) {
  if (root) csPending.add(root);
  if (csSweepQueued) return;
  csSweepQueued = true;
  requestAnimationFrame(() => {
    csSweepQueued = false;
    const roots = [...csPending]; csPending.clear();
    for (const r of roots) { try { csSweepIcons(r); } catch (_) {} }
  });
}
document.addEventListener('DOMContentLoaded', () => csQueueSweep(document.body));
new MutationObserver((records) => {
  for (const rec of records) {
    const t = rec.target;
    if (!t) continue;
    if (t.nodeType === 1) csQueueSweep(t);
    else if (t.parentElement) csQueueSweep(t.parentElement);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
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