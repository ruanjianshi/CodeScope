/* 码境 CodeScope · 编辑器接入层（life-editor.js）
 * ===========================================================================
 * 拆分阶段 2（2026-10-30）：把「正文编辑器」从 life-workbench.js 里搬出来。
 *
 * 为什么单独一个文件：
 *   备忘录 / 日记的正文内核是 Crepe（assets/reading-block-editor.js 的产物，
 *   走 window.CodeScopeBlockEditor）。它自带**一整套实例生命周期**：
 *   异步挂载（首次要拉 2.7MB）、竞态代号、权威正文缓存、三道防丢保险 ——
 *   这些原来和面板渲染挤在同一个 IIFE 里，于是「改编辑器」必然动到面板代码 ✗。
 *
 * ★★ 三条不能破的规矩（搬过来一条都没变）：
 *   ① **状态整体搬走**：实例 / 挂载代号 / 权威正文（md 缓存）只住在这个文件里 ✓。
 *      面板**不许**留副本 ✗ —— 两边各存一份必然不同步，
 *      症状是「编辑正常、保存静默失效」（不报错、不崩页面，刷新才发现少了几段）。
 *   ② `read(host)` 认不出时**返回 null**，绝不返回空串 ✓ ——
 *      '' 会被保存路径当成「正文被清空」写进库里 ✗✗（静默丢内容）。
 *      所有调用方必须先判 `if (md == null) return`。
 *   ③ 加载顺序：life-styles.js → **life-editor.js** → life-workbench.js ✓
 *      （面板只在运行时用 window.CodeScopeLifeEditor；三份都是动态注入，
 *        由 index.html 的 loadWorkbench() 用 onload 串成链）。
 *
 * 对外 API（面板只通过这些调用）：
 *   mountMemo(host, opts)      opts: { key, markdown, onChange, topBar, onStatus }
 *   mountJournal(host, opts)   同上（journal 的 key 是 YYYY-MM-DD）
 *   read(host)                 → markdown | null（null = 认不出，调用方必须 if (md == null) return）
 *   write(host, markdown)      换掉界面上那一份（**不落盘** ✓）
 *   destroy(host)              退役实例（在途的异步挂载全部作废）
 *   blockIndex(hostId, lines)  → 光标所在块对应的行号（-1 = 找不到）。
 *                              —— 面板的「# 标题 / 清单 / 表格」按钮要在 markdown
 *                                文本层做行变换，而「光标在第几块」只有编辑器知道
 *                                （Crepe 不暴露“第几行”，只能反查 DOM）。
 *   exec(host, cmd)            → 跑一条 **Crepe 自己的**格式命令（true = 发出去了）
 *                                cmd: bold italic strikethrough code
 *                                     bullet-list ordered-list task-list
 *                                     quote table code-block image math hr link
 *                                     para h1…h6（段落 / 标题）
 *                                ★ 另加一条**不是** Crepe 命令的 delete ✓（2026-10-30，补「缺少删除」）：
 *                                  「有选区删选区，无选区删当前整块」（源码模式下 = 删光标那一行）。
 *                                  走浏览器原生 execCommand('delete')，理由见 removeAt 的注释 ✓
 *   adopt(host, target)        → 把 Crepe 顶栏里**CodeScope 自己插的**两组
 *                                （❝ 提示框 / A·▮ 颜色高亮）搬进面板工具栏 ✓
 *                                —— 顶栏在生活面板里被 CSS 隐藏，这两组不能跟着丢。
 *
 * ⚠️ host 可以是 null（= 这一屏没有编辑器）：此时只退役旧实例、不留副本 ✓，
 *    和「没选中任何一条备忘录 / 不在日记页」的行为一致。
 * =========================================================================== */
(function () {
  'use strict';

  /* 面板的转义 —— 这个文件里只用于两段失败兜底的 HTML ✓ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ════ 颜色 / 高亮：**真颜色**层（2026-10-30 重做）═════════════════════════
     ⚠️⚠️ 这一层解决的是一条**真缺陷**（用户截图指出）：
       色板（顶栏 A / ▮）原来把选中文字包成**内部链接** ——
         [文字](#cc-fg-red)   ← 颜色
         [文字](#cc-hl)        ← 高亮
       两个后果都不是「不好看」，是**坏的** ✗：
         ① 点上去弹**链接预览浮窗**（#cc-fg-red + 复制/编辑/删除三颗图标）——
            用户看到的是链接，不是颜色 ✓；
         ② #cc-fg-blue 是**标准标签语法** ✗ → 被标签系统当真标签收进索引 ✓
            （用户截图：「所有标签」下面冒出 # cc-fg-blue 1 这种数据污染 ✓）。

     ★ 目标：颜色 = **文字自己的属性**（内联样式 <span style="color:#ff7675">）、
        高亮 = **<mark>**；不产出链接、不产出标签、不弹链接预览 ✓。
     ★ 存储（落进 STORE.memos[].text / STORE.journal[].text 的格式）就是上面那两种 ✓。

     ⚠️⚠️ 为什么不能只改字符串、也不能只改 DOM（实测记录，别重走）：
       · 只改存储 ✗：编辑器里还是 <a href="#cc-fg-red"> → 仍旧弹链接预览 ✓，验收过不了 ✓。
       · 只改 DOM ✗✗：把 <a> 就地换成 <span>，ProseMirror 的 DOMObserver 会把这看成
         「用户把链接标记删掉了」→ 立刻发一条事务 ✓ → 实测 1 秒内 markdown 从
         [文字](#cc-fg-red) 变成**纯文本**，颜色**真的丢了** ✓（数据损坏，不是样式问题 ✗）。
       · 想走 EditorView.setProps({markViews}) 也不行 ✗：这个构建里 ViewDesc **不存 view**
         （实测 pmViewDesc 只有 parent/children/dom/contentDOM/dirty/node/outerDeco/innerDeco ✓），
         DOM 上也没有 Vue / milkdown 句柄 ✓，外面**拿不到** EditorView ✓。
       · 改 src ✗（禁改文件）、改构建产物 ✗（不在可改清单）→ 只剩下面这条路 ✓。

     ★★★ 所以：**编辑器文档里保持链接标记（零改动、零丢数据）+ 渲染层改成真样式** ✓
       ① 挂载时：存储里的 <span>/<mark> → 反编码成 [文字](#cc-fg-red) 交给 Crepe ✓
          （Crepe 能原样保留的只有链接 mark —— src/reading-block-editor.js:495 那句注释 ✓）；
       ② 渲染后：把 <a href="#cc-fg-*"> 就地画成 <span style="color:...">、<mark> ✓；
       ③ 保存时：链接语法 → 存储格式 <span>/<mark> ✓（STORE 里**永远**是真 HTML ✓）；
       ④ 画的时候用 MutationObserver 守卫屏蔽 ProseMirror 的回调 ✓（见 CC_PAINTING）——
          编辑器「看不到」这次改动 → 文档一个字节都不动 ✓，颜色不会丢 ✓。
     ── 实测（2026-10-30，4933 临时实例）─────────────────────────────────
       · 画完 DOM：<p><span style="color:#f2555a">文字</span></p>，无 <a href="#cc-fg" ✓
       · getComputedStyle().color = rgb(242, 85, 90)（原色 rgb(211, 198, 170)）✓
       · 同一时刻 markdown 仍是 [文字](#cc-fg-red) → 文档没被改 ✓
       · 在色块中间敲字：文字落点正确（颜色守Z卫测试）✓，敲完重绘回 <a>，画手再贴回 <span> ✓
     ══════════════════════════════════════════════════════════════════════ */
  /* 色板键 ↔ 真颜色。必须和 src/reading-block-editor.js 的 COLOR_ITEMS **逐字一致** ✗：
     不一致的话，用户点了「红」，存下来的是另一个红 ✓（迁移映射表也会对不上 ✓）。 */
  const CC_COLORS = [['red', '#f2555a'], ['orange', '#f0883e'], ['yellow', '#dcb13c'], ['green', '#4bbd7a'],
    ['cyan', '#3fb6c4'], ['blue', '#5b9cf5'], ['purple', '#a97bf0'], ['pink', '#ef7bb0'], ['gray', '#95a0ae']];
  const CC_HEX = {}, CC_KEY = {};
  CC_COLORS.forEach((p) => { CC_HEX[p[0]] = p[1]; CC_KEY[p[1]] = p[0]; });
  const CC_HL = '#cc-hl';
  const CC_FG = '#cc-fg-';
  /* 自己改 DOM 的**屏蔽计数器** ✓（>0 时 ProseMirror 的 mutation 回调整个跳过 ✓）*/
  let CC_PAINTING = 0;
  const CC_MO = typeof window.MutationObserver === 'function' ? window.MutationObserver : null;
  /* ★ 守卫必须装在**编辑器创建之前** ✗✗：MutationObserver 是 View 在构造时 new 出来的 ✓，
     装晚了它已经拿到原生构造器 → 屏蔽无效 ✓（实测：晚装的守卫一点用都没有，markdown 照样被改 ✓）。
     这个文件在 life-workbench.js 之前加载 ✓，而备忘录 / 日记的编辑器是**打开面板后**才创建的 ✓，
     所以这里的时机是够的 ✓。包装是**完全透明**的：CC_PAINTING 为 0 时原样转发 ✓，
     不会影响任何一个别处的观察者 ✓。 */
  if (CC_MO) {
    const Guarded = function (cb) {
      return new CC_MO(function () {
        if (CC_PAINTING > 0) return;
        return cb.apply(this, arguments);
      });
    };
    Guarded.prototype = CC_MO.prototype;
    try { window.MutationObserver = Guarded; } catch (_) {}
  }
  /* 一段普通文本里找 [文字](#cc-fg-<key>) / [文字](#cc-hl)，交给 make 换掉 ✓。
     ⚠️ 必须按「配对括号 + 反斜杠转义」扫 ✗✗：正文里出现「[注]」这种方括号很常见 ✓，
        拿 /\[[^\]]+\]/ 一刀切会把 [注] 后面的内容一起吞掉 → **改坏用户内容** ✗。
     ⚠️ 只认 #cc-fg-* 与 #cc-hl ✗：用户自己写的真链接必须原样留着 ✓（迁移同理 ✓）。 */
  function ccLinks(seg, make) {
    let out = '', i = 0;
    while (i < seg.length) {
      const c = seg.charAt(i);
      if (c === '\\') { out += seg.substr(i, 2); i += 2; continue; }
      if (c !== '[') { out += c; i += 1; continue; }
      let depth = 0, j = i, close = -1;
      while (j < seg.length) {
        const ch = seg.charAt(j);
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') depth += 1;
        else if (ch === ']') { depth -= 1; if (!depth) { close = j; break; } }
        j += 1;
      }
      if (close < 0) { out += c; i += 1; continue; }
      const m = /^\((#[^)\s]+)(?:\s+"[^"]*")?\)/.exec(seg.slice(close + 1));
      const href = m ? m[1] : '';
      if (!m || (href !== CC_HL && href.indexOf(CC_FG) !== 0) || (href !== CC_HL && !CC_HEX[href.slice(CC_FG.length)])) {
        out += seg.slice(i, close + 1); i = close + 1; continue;
      }
      out += make(seg.slice(i + 1, close), href);
      i = close + 1 + m[0].length;
    }
    return out;
  }
  /* 行内代码 `...` 原样跳过 ✓（示例代码里的 [文字](#cc-hl) 不是内容 ✓）*/
  function ccInline(line, fn) {
    const s = String(line);
    if (s.indexOf('`') < 0) return fn(s);
    return s.split(/(`+[^\`]*`+)/).map((p) => (p && p.charAt(0) === '`') ? p : fn(p)).join('');
  }
  /* 逐行做替换，**围栏代码块整段跳过** ✓ —— 理由同 normalizeMd：
     笔记里本来就可能写着「本仓把 ==高亮== 编码成 [文字](#cc-hl)」这种**示例**
     （assets/life-styles.js 里就有 ✓），把示例改成 <mark> 就是把正文读坏 ✗。 */
  function ccMap(md, fn) {
    const lines = String(md == null ? '' : md).split('\n');
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
      if (fence) continue;
      lines[i] = ccInline(lines[i], fn);
    }
    return lines.join('\n');
  }
  /* 编辑器 markdown（链接语法）→ **存储格式**（<span>/<mark>）✓
     ⚠️ 幂等 ✓：已经是 <span>/<mark> 的字符串再走一遍**逐字不变** ✓ ——
        迁移要跑两次结果相同，靠的就是这一点 ✓。 */
  function mdToStore(md) {
    return ccMap(md, (seg) => ccLinks(seg, (body, href) => (href === CC_HL)
      ? '<mark>' + body + '</mark>'
      : '<span style="color:' + CC_HEX[href.slice(CC_FG.length)] + '">' + body + '</span>'));
  }
  /* 存储格式 → 编辑器 markdown ✓（挂载时用；认不出的 span 原样留着 ✓，绝不猜颜色 ✗）*/
  function mdToEditor(md) {
    return ccMap(md, (seg) => seg
      .replace(/<span\b[^>]*?\bstyle\s*=\s*(["'])([^"']*)\1[^>]*>([^<]*)<\/span>/gi, (m, q, style, body) => {
        const c = /color\s*:\s*(#[0-9a-f]{3,8})/i.exec(style);
        const key = c ? (CC_KEY[c[1].toLowerCase()] || '') : '';
        return key ? '[' + body + '](' + CC_FG + key + ')' : m;
      })
      .replace(/<mark\b[^>]*>([^<]*)<\/mark>/gi, (m, body) => '[' + body + '](' + CC_HL + ')'));
  }
  /* 「画手」：把编辑器里渲染出来的假链接**就地画成真样式** ✓
     ⚠️ 必须包在 CC_PAINTING 里 ✗✗ —— 否则 ProseMirror 会把这次 DOM 改动读成
        「用户删掉了颜色标记」→ 发事务 → 文档里的标记真被删 → 颜色丢 ✓（实测 ✓）。
     计数清零放在 setTimeout(0) ✓（不是 Promise）✗：mutation 记录在**当前任务结束**的
     微任务检查点里派发 ✓，而定时器排在它之后 → 那时清零，自己这批记录一定被屏蔽 ✓。*/
  function ccPaint(host) {
    const prose = host && host.querySelector('.ProseMirror');
    const links = prose ? prose.querySelectorAll('a[href^="#cc-"]') : null;
    if (!links || !links.length) return 0;
    CC_PAINTING += 1;
    try {
      Array.prototype.forEach.call(links, (a) => {
        const href = String(a.getAttribute('href') || '');
        const key = href.indexOf(CC_FG) === 0 ? href.slice(CC_FG.length) : '';
        const hex = CC_HEX[key] || '';
        if (!hex && href !== CC_HL) return;
        const box = document.createElement(hex ? 'span' : 'mark');
        if (hex) box.setAttribute('style', 'color:' + hex);
        box.setAttribute('data-cc-color', hex ? key : 'hl');
        while (a.firstChild) box.appendChild(a.firstChild);
        a.replaceWith(box);
      });
    } finally {
      setTimeout(() => { CC_PAINTING = 0; }, 0);
    }
    return 1;
  }
  /* 每个挂载实例一个**自己的**观察者 ✓（用保存下来的原生构造器，不走守卫 ✓）：
     ProseMirror 每次重绘那一块都会把 <a> 还原 ✓ → 这里立刻补画 ✓。
     收敛性：没有可画的就**不动 DOM** ✓ → 不产生新记录 → 不会自激 ✓。 */
  function ccWatch(host, inst) {
    if (!CC_MO || !host || !inst) return;
    const draw = () => {
      if (inst.paintTimer) return;
      inst.paintTimer = setTimeout(() => {
        inst.paintTimer = 0;
        const s = slotOf(host);
        if (!s || s.inst !== inst || !host.isConnected) return;
        ccPaint(host);
      }, 0);
    };
    inst.painter = new CC_MO(() => { if (CC_PAINTING > 0) return; draw(); });
    inst.painter.observe(host, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
    draw();
  }
  function ccStop(inst) {
    if (!inst) return;
    if (inst.paintTimer) { clearTimeout(inst.paintTimer); inst.paintTimer = 0; }
    if (inst.painter) { try { inst.painter.disconnect(); } catch (_) {} inst.painter = null; }
  }

  /* ── 两个槽位（备忘录 / 日记）─────────────────────────────────────────────
     一个槽位 = 一份**完整**的编辑器状态：
       inst  = { key, token, ctrl, md, host, opts } —— md 是权威正文 ✓
       token = 挂载代号（异步竞态里淘汰旧实例，同 app-reading 的 blockMountId）
     ⚠️ 状态只准住在这里 ✗（规矩 ①）：面板那边一个字段都不存 ✓ */
  function newSlot() { return { inst: null, token: 0 }; }
  const MEMO = newSlot();
  const JOURNAL = newSlot();

  /* ════ 序列化：**唯一入口** ═══════════════════════════════════════════════
     ⚠️ 为什么收敛成一处 ✗✗：读回 markdown 的代码原来散在 **7 处**（全是同一个模式
     —— `querySelectorAll(':scope > .ln')` → 逐行取 textContent/dataset → join('\n') ✓）。
     只要漏掉任何一处，那条保存链路就还在读旧 DOM ✓ → 换内核之后**静默丢内容** ✗
     （不报错、不崩页面，刷新才发现少了几段 ✓）。
     判据统一成 `data-src || textContent` ✓：原来备忘录用 `contenteditable === 'false'`、
     日记用 `.cur` 类 ✓ —— 在 ceHtml() 产出的 DOM 上二者等价 ✓
     （渲染行必有**非空** data-src ⟺ textContent 非空 ✓），所以换判据后逐字不变 ✓。
     ★ 现在只剩「旧内核的 DOM」这一种情况会走到它（Crepe 挂上之后里面没有 .ln ✓）。 */
  function readLn(host) {
    if (!host) return '';
    return Array.from(host.querySelectorAll(':scope > .ln')).map((el) => {
      const src = el.dataset ? el.dataset.src : null;
      return (src != null && src !== '') ? String(src) : String(el.textContent || '');
    }).join('\n');
  }

  /* 光标所在**块**的纯文本 —— Crepe 不暴露“第几行”，只能这样反查 ✓。
     hostId = 正文容器 id（'lw-memo-ce' / 'lw-j-ce'）✓ —— 备忘录和日记共用这一份 ✓ */
  function caretBlockText(hostId) {
    const host = document.getElementById(hostId);
    const sel = window.getSelection();
    if (!host || !sel || !sel.rangeCount) return null;
    /* ⚠️ 必须走到 **.ProseMirror 的直接子节点** 为止 ✗✗ —— 那一层才是「一个块」✓。
       原来走到「host 的直接子节点」✗：Crepe 的层级是 host > .milkdown > .ProseMirror > 块 ✓，
       于是停下来的那一刻拿到的是**整篇的文本** ✗ → 行号永远匹配不上 ✓ →
       「# 标题 / 清单」静默退化成「改第一行」✗（实测踩到：点清单，第一行变任务项 ✓）。 */
    const prose = host.querySelector('.ProseMirror');
    if (!prose) return null;
    let el = sel.getRangeAt(0).startContainer;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!el || !prose.contains(el)) return null;
    while (el && el.parentElement && el.parentElement !== prose) el = el.parentElement;
    if (!el || el === prose) return null;
    return String(el.textContent || '').trim();
  }

  /* 「界面上那一块的文本」→「markdown 里第几行」✓ —— 备忘录和日记共用 ✓。
     ⚠️ **不能直接比字符串** ✗✗：块里的文本是**渲染后**的（列表项就是「任务点我」✓），
        而 markdown 那一行**带着标记**（「- [ ] 任务点我」✓）→ 永远匹配不上 ✗，
        于是「# 标题 / 清单」退化成「改第一行」✗（实测踩到：点清单，第一行变成了任务项 ✓）。
        ⇒ 两边都先去掉行首标记（引用 / 标题 / 列表 / 任务 / 有序列表）再比 ✓。 */
  function ceBlockIndex(lines, want) {
    if (!want) return -1;
    const strip = (s) => String(s == null ? '' : s)
      .replace(/^\s*>+\s*/, '')
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s*)?|\d+[.)]\s+)/, '')
      .trim();
    return lines.findIndex((l) => strip(l) === want);
  }

  /* ── 挂 / 换内核（备忘录与日记共用这一套，只有 clearFirst 不同）──────────────
     ⚠️ 三件事必须成对做对，少一件就丢内容 ✗：
       ① **同步**先把权威正文（md 缓存）设成「库里那条 / 今天那篇」的正文 ✓ ——
          挂载是异步的（首次要拉 2.7MB ✓），这中间用户改标题 / 切分类会触发保存 ✓，
          不先设好就会读到空正文，把内容清掉 ✗；
       ② 旧实例要 destroy ✓，且**用代号**判断「回来的是不是最新那次」✗（连点切条目会竞态）；
       ③ destroy 期间**不清 DOM** ✗ —— 清理可能晚于下一次挂载，一清就把新实例抹掉
          （src/reading-block-editor.js:1023 那段注释踩过同一个坑）。
     其余差异：
       · 备忘录每次 render() 给的都是**全新节点** → 不用清空 ✓；
       · 日记的 apply（模板 / # 标题 / 清单）是**原地重挂** → 必须先清空 ✓，
         不清的话 Crepe 会往同一个容器里再挂一份，屏幕上两套正文叠着（实测踩到 ✓）。 */
  /* Crepe 的序列化把无序列表写成 "* " ✓（合法 markdown ✓），但本仓别处一律写 "- " ✓
     （待办统计的正则、用户习惯、验收口径都是 "- [ ]" ✓）——
     ⇒ 存盘前统一成 "- " ✓（幂等 ✓：再存一次还是 "- " ✓）。
     ⚠️ 代码围栏里的 "* " **不许碰** ✗（那是正文内容 ✓，改了就是破坏数据 ✓），
        所以按行扫、遇到 ``` 就整个跳过 ✓。 */
  function normalizeMd(md) {
    const lines = String(md == null ? '' : md).split('\n');
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
      if (fence) continue;
      lines[i] = lines[i].replace(/^(\s*)[*+] /, '$1- ');
    }
    return lines.join('\n');
  }

  function mountInto(slot, host, opts, clearFirst) {
    opts = opts || {};
    const key = opts.key == null ? '' : String(opts.key);
    const markdown = opts.markdown == null ? '' : String(opts.markdown);
    const token = ++slot.token;
    const prev = slot.inst;
    const inst = { key, token, ctrl: null, md: markdown, host: host || null, opts, menu: null };
    slot.inst = inst;                                              /* ① */
    if (prev && prev.ctrl) { try { prev.ctrl.destroy(); } catch (_) {} }   /* ② */
    /* ★ 退役旧实例时**顺手收掉它的提示框菜单** ✗✗ —— src/reading-block-editor.js 的
       destroy() 漏调了 detachCalloutControls（attachColorControls 有 ✓、它没有 ✗；
       src 是禁改文件）→ 菜单留在 body 上 ✓。实测：每挂一次多一个 14 按钮的浮层 ✓。
       ⚠️ 必须收在**这里**、不是 create 的 then 里 ✗：源码模式 / 没有 host /
         加载失败这几条路都在 create 之前就 return 了 ✓，放 then 里就漏 ✓。*/
    if (prev && prev.menu && prev.menu.isConnected) { try { prev.menu.remove(); } catch (_) {} }
    /* ★ 旧实例的「画手」也要停 ✗：它观察的是**同一个 host**，不停就会和新实例抢着改 DOM ✓
       （画出来的东西一样，但两个观察者会互相触发，白烧 CPU ✓）。 */
    ccStop(prev);
    if (!host) return;
    host.dataset.editorKey = key;
    /* 源码模式：整篇一个 textarea（原样 markdown ✓）—— 没有 Crepe，读 value 就够 ✓ */
    if (host.tagName === 'TEXTAREA') {
      host.oninput = () => {
        if (token !== slot.token) return;
        inst.md = host.value;
        if (typeof opts.onChange === 'function') opts.onChange(host.value);
      };
      return;
    }
    if (clearFirst) host.replaceChildren();                        /* ③' */
    /* 挂之前先记下「body 上已有的提示框菜单」✓（下一步用它认出**新建的那一个** → inst.menu）*/
    const menusBefore = new Set(Array.from(document.querySelectorAll('body > .codescope-callout-menu')));
    if (typeof loadBlockEditor !== 'function') {
      host.innerHTML = '<div class="lw-memo-err">块级编辑器不可用（loadBlockEditor 缺失）</div>';
      return;
    }
    loadBlockEditor().then((api) => api.create({
      root: host,
      /* ★ 交给 Crepe 的是**编辑器语法**（[文字](#cc-fg-red)）✗✗ —— 存储格式里的
         <span style="color:…"> 它不认（commonmark 预设没有 html 节点 ✓），原样喂进去
         会被当普通文本留着 / 干脆丢掉 ✓。回来时再由 onChange 转回存储格式 ✓。 */
      markdown: mdToEditor(markdown),
      /* ★★ topBar **必须留 true** ✗✗（2026-10-30 合并工具栏时的结论，推翻了上一版注释）：
         关掉它 = 连**命令入口**一起关掉 ✓ —— 控制器只暴露 getMarkdown/focus/destroy ✓，
         外面拿不到 crepe / commandsCtx ✓（src 禁改 ✗），而顶栏那排按钮就是命令入口 ✓。
         所以留着它、由 life-styles.js 在生活面板里 display:none 藏起来 ✓，
         面板按钮走 exec() 派发 pointerdown ✓（同一条 Crepe 命令 ✓）。
         ⚠️ 只有生活面板这么用 ✓：阅读视图与主编辑区不传这个参数 ✓（默认 true ✓ 顶栏照常显示 ✓）。 */
      topBar: opts.topBar !== false,
      onChange: (md) => {
        if (token !== slot.token || !slot.inst) return;
        /* ★ 存储格式在**这一步**定下来 ✗✗ —— 面板拿 slot.inst.md 直接落盘 ✓，
           所以 [文字](#cc-fg-red) 必须在这里就变成 <span style="color:#f2555a"> ✓；
           只在「读出口」转的话，别处照样能把链接语法写进库里（还有别的写入口 ✓）。 */
        slot.inst.md = mdToStore(normalizeMd(md));
        /* 初始化时 Crepe 会规范化一次并回调 —— 那不是用户编辑，不回调 ✓（同 app-reading.js:522）*/
        if (!host.contains(document.activeElement)) return;
        /* ⚠️ 往下传的必须是**归一化后**的那一份 ✗✗ —— 面板拿它直接落盘 ✓，
           传原始 md 就白归一了 ✓（存进去还是 "* [ ]" ✗）。 */
        if (typeof opts.onChange === 'function') opts.onChange(slot.inst.md);
      },
      onError: (err) => {
        if (typeof opts.onStatus === 'function') opts.onStatus('编辑器：' + String((err && err.message) || err));
      },
    })).then((ctrl) => {
      /* ★ 认领「这一次 create 新建的提示框菜单」✗✗ —— 根因在 src/reading-block-editor.js：
         attachColorControls 在 destroy() 里有对应的 detach ✓，但 attachCalloutControls
         **漏了** ✗（src 是禁改文件 ✗）→ 每挂一次，body 上就多留一个 14 按钮的
         .codescope-callout-menu ✓（实测：点一次「新建」会挂 2 次 → 2 个菜单；
         切几次页签能堆到 6 个 ✓）。
         ⚠️ 只认「挂之前不在 body 上的那一个」✓，不按类名全删 ✗ ——
           阅读视图 / 主编辑区的同名菜单不是我们的 ✓，删了那边就坏 ✓。
         ⚠️ 必须在**代号淘汰之前**认领 ✗：掉队的那份 create 也会建菜单（实测 ✓），
           在淘汰分支里也得把它收掉，否则照样漏 ✓。 */
      const newMenu = Array.from(document.querySelectorAll('body > .codescope-callout-menu')).find((m) => !menusBefore.has(m)) || null;
      if (token !== slot.token || !host.isConnected) {
        try { ctrl.destroy(); } catch (_) {}
        if (newMenu && newMenu.isConnected) { try { newMenu.remove(); } catch (_) {} }
        return;
      }
      slot.inst.ctrl = ctrl;
      host.dataset.editorReady = 'true';
      slot.inst.menu = newMenu;
      /* ★ 挂好了才开「画手」✗：挂之前 .ProseMirror 还不存在 ✓，观察了也没东西可画 ✓。 */
      ccWatch(host, slot.inst);
      /* 挂好了 → 通知面板：它要把顶栏里 CodeScope 自己插的两组搬进自己那条工具栏 ✓ */
      if (typeof opts.onReady === 'function') { try { opts.onReady(host); } catch (_) {} }
    }).catch((err) => {
      if (token !== slot.token) return;
      /* 加载失败**不回退**到逐行编辑器 ✗（那套已经删了 ✓）；把正文原样贴出来，
         至少能读、能复制，并明确告诉用户保存链路没断 ✓。 */
      host.innerHTML = '<div class="lw-memo-err">块级编辑器加载失败：' + esc(String((err && err.message) || err)) + '</div>'
        + '<pre class="lw-memo-fallback">' + esc(markdown) + '</pre>';
    });
  }

  function mountMemo(host, opts) { mountInto(MEMO, host, opts, false); }
  function mountJournal(host, opts) { mountInto(JOURNAL, host, opts, true); }

  /* 哪个槽位挂在这个 host 上 ✓（按**元素身份**比，不按 id ✗ —— render() 会换掉节点，
     旧实例认的是**旧节点**，拿新节点来读就是「认不出」）。*/
  function slotOf(host) {
    if (!host) return null;
    if (MEMO.inst && MEMO.inst.host === host) return MEMO;
    if (JOURNAL.inst && JOURNAL.inst.host === host) return JOURNAL;
    return null;
  }

  /* 正文的**唯一**读出口 ✓（落盘 / 导出 / 撤销 / 格式按钮 全走这里）。
     ★ 规矩 ②：认不出就返回 **null**，绝不给空串 ✗✗ ——
       返回 '' 会被保存路径当成「正文被清空」写进库里（静默丢内容 ✓）。 */
  function read(host) {
    if (!host) return null;
    if (host.tagName === 'TEXTAREA') return host.value;            /* 源码模式 ✓ */
    const s = slotOf(host);
    if (s && s.inst) return s.inst.md;                             /* 权威正文 ✓ */
    /* host 上没挂过实例：只有旧内核的 DOM 还能读（理论上不会再出现）✓，
       其余情况（Crepe 已挂 / 仍在异步加载但实例对不上）→ 宁可不写 ✓ */
    return host.querySelector('.ln') ? readLn(host) : null;
  }

  /* 换掉界面上那一份（**不落盘** ✓）—— 面板的「模板 / # 标题 / 清单」用 ✓。
     语义和迁移前一致：只改**界面上那一份** ✓，等用户真的敲字才由面板的保存链路写进库 ✓
     （所以「只插了模板就走」仍然不会在日历上白点一片 ✓）。
     ⚠️ Crepe 没暴露 setMarkdown（controller 只有 getMarkdown / focus / destroy ✗）→ 原地重挂 ✓。 */
  function write(host, markdown) {
    const s = slotOf(host) || ((host && host.id === 'lw-j-ce') ? JOURNAL : MEMO);
    const md = markdown == null ? '' : String(markdown);
    mountInto(s, host, Object.assign({}, (s.inst && s.inst.opts) || {}, { markdown: md }), true);
    return true;
  }

  /* 退役实例（在途的异步挂载全部作废 ✓）—— 不清 DOM ✗（见 ③ 的理由）*/
  function destroy(host) {
    const s = slotOf(host);
    if (!s) return;
    ccStop(s.inst);                                  /* 先停画手 ✓（不然它还在观察已退役的 DOM）*/
    if (s.inst && s.inst.ctrl) { try { s.inst.ctrl.destroy(); } catch (_) {} }
    /* 退役时把它自己的提示框菜单一并收掉 ✓（同 ③ 上面的理由：src 的 destroy 漏了这一步 ✗）*/
    if (s.inst && s.inst.menu && s.inst.menu.isConnected) { try { s.inst.menu.remove(); } catch (_) {} }
    s.inst = null;
    s.token += 1;
    if (host) { try { delete host.dataset.editorKey; delete host.dataset.editorReady; } catch (_) {} }
  }

  /* 光标所在块 → markdown 里的行号（-1 = 找不到）✓ —— 面板的行变换按钮用 ✓ */
  function blockIndex(hostId, lines) {
    return ceBlockIndex(lines || [], caretBlockText(hostId));
  }

  /* ════ 格式动作：**Crepe 自己的命令**，一条都不重写 ✓✓ ═══════════════════════
     ★★ 为什么不是 ctrl.exec(cmd) ✗✗ —— 读源码（src/reading-block-editor.js:1025）
        确认过：控制器**只**暴露三个方法 ✓

            return { getMarkdown, focus, destroy }

        crepe 与 ctx（commandsCtx 就在 ctx 里）全在 create() 的闭包里 ✓，
        外面一个都拿不到 ✗ —— 而 src 是**禁改文件**（阅读视图共用）✗。
     ⇒ 不改 src、又能跑**同一条命令**的唯一入口，是 Crepe 顶栏那排按钮本身 ✓：
        产物里每一项都是 button.top-bar-item + onPointerdown: onRun ✓，
        onRun 展开就是 ctx.get(commandsCtx).call(...) ✓（顶栏配置里逐条可查 ✓）。
     ⚠️ 必须是 **pointerdown** ✗✗ —— 实测 click / mousedown 一律无效 ✓
        （键盘那条更诱人：包里确实有 Mod-b / Mod-i / Mod-e，但合成 keydown 进不了
         ProseMirror 的 keymap ✓，实测 0 次生效 ✓，所以没走它 ✓）。
     ⚠️ 顶栏在生活面板里被 life-styles.js 的 display:none 藏掉 ✓ ——
        dispatchEvent **不看可见性** ✓，命令照跑 ✓（实测 12 条全过 ✓）。
     ⚠️ 顶栏顺序来自 Crepe 的顶栏配置 ✓（formatting → list → insert → block → more），
        所以这是个**下标表**；Crepe 升级若加减按钮，这里要跟着改 ✗（exec 里有长度校验 ✓）。 */
  const TOP_ITEMS = ['bold', 'italic', 'strikethrough', 'code',
    'bullet-list', 'ordered-list', 'task-list',
    'link', 'image', 'table',
    'code-block', 'math',
    'quote', 'hr'];

  function topBarOf(host) { return host ? host.querySelector('.milkdown-top-bar') : null; }

  /* 顶栏按钮认的是 pointerdown ✓；合成一个「左键按下」就够 ✓。 */
  function press(el) {
    if (!el) return false;
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1,
      }));
      return true;
    } catch (_) { return false; }
  }

  /* ════ 「删除」：有选区删选区，无选区删**当前整块** ✓✓ ═════════════════════════
     ⚠️ 为什么不用 Crepe 命令 ✗✗：顶栏那 14 项（TOP_ITEMS）**没有**「删块」一项 ✓，
        commandsCtx 又在 create() 的闭包里拿不到（src 禁改 ✓，理由同上面 exec）✗。
     ⇒ 走**浏览器原生编辑** execCommand('delete') ✓ —— 它产生的是**真实输入**：
        ProseMirror 的 DOM 观察器（readDOMChange）把这次改动收成一条**普通事务** ✓
        （prosemirror-view 1.42.3 的 readDOMChange **不带** addToHistory:false ✓
         → 这条事务进撤销栈 ✓ → ⌘Z 能撤 ✓），markdownUpdated 照常触发 ✓
        → 面板的 onChange（memoCommitSoon / journalCommitSoon）压快照 + 防抖落盘 ✓。
     ⚠️ 不能用「合成 keydown 派发 Backspace」✗：实测进不了 ProseMirror 的 keymap
        （见上面 exec 那段注释：试过，0 次生效 ✗）。
     ⚠️ 「当前整块」的边界 = **.ProseMirror 的直接子节点** ✓（判据和 caretBlockText 一致 ✗，
        否则列表项 / 引用块会被算成「整篇」✓）。
     ⚠️ 选区必须是**真 DOM 选区**再让浏览器去删 ✗ —— 直接 el.remove() 属于外部 DOM 改动，
        ProseMirror 有可能整片重渲染（改动被丢掉 ✓），走 execCommand 才是它会认的输入 ✓。 */
  function removeAt(host) {
    if (host.tagName === 'TEXTAREA') return removeLineInTextarea(host);
    const prose = host.querySelector('.ProseMirror'), sel = window.getSelection();
    if (!prose || !sel || !sel.rangeCount) return false;
    if (!sel.isCollapsed) return document.execCommand('delete');
    const anchor = sel.anchorNode;
    let el = anchor && anchor.nodeType === 3 ? anchor.parentElement : anchor;
    if (!el || !prose.contains(el)) return false;
    while (el.parentElement && el.parentElement !== prose) el = el.parentElement;
    const kids = prose.childNodes, i = Array.prototype.indexOf.call(kids, el), range = document.createRange();
    if (i > 0) { range.setStart(kids[i - 1], kids[i - 1].childNodes.length); range.setEnd(el, el.childNodes.length); }
    else if (kids.length > 1) { range.setStart(el, 0); range.setEnd(kids[1], 0); }
    else range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    return document.execCommand('delete');
  }

  /* 源码模式（整篇一个 textarea）：有选区删选区，无选区删**光标那一行** ✓。
     同样走 execCommand ✓（原生撤销栈认它 ✓ 而 setRangeText 不认 ✗）。 */
  function removeLineInTextarea(ta) {
    const value = ta.value, from = ta.selectionStart, to = ta.selectionEnd;
    if (from !== to) return document.execCommand('delete');
    let start = value.lastIndexOf('\n', Math.max(0, from - 1)) + 1, end = value.indexOf('\n', from);
    end = end < 0 ? value.length : end + 1;
    /* ⚠️ 块之间的空行是 markdown 的分隔符 ✓：只删「本行 + 它自己的换行」会**多留一个空段**
       （实测：删掉「第三段」之后，第二段和第四段之间变成两条空行 ✗）→ 尾随空行一起吃掉 ✓；
       光标在最后一行时改成把**前面**那条换行吃掉 ✓（否则末尾留一个空行 ✗）。 */
    if (value[end] === '\n') end += 1;
    else if (end >= value.length && start > 1) start -= 1;
    ta.setSelectionRange(start, end);
    return document.execCommand('delete');
  }

  function exec(host, cmd) {
    const key = cmd == null ? '' : String(cmd);
    /* 「删除」不是 Crepe 命令（见 removeAt 的注释）→ 先在这里分出去 ✓ */
    if (host && key === 'delete') return removeAt(host);
    const bar = topBarOf(host);
    if (!bar || !key) return false;
    /* 段落 / 标题：Crepe 的 Paragraph 下拉是**两跳**（先开下拉、再点选项 ✓）
       —— 选项是 Vue 渲染的 ✓，派发后要等一帧才进 DOM ✓（同步读一定是空 ✓）。 */
    if (key === 'para' || /^h[1-6]$/.test(key)) {
      const btn = bar.querySelector('.top-bar-heading-button');
      if (!press(btn)) return false;
      const want = key === 'para' ? 0 : Number(key.slice(1));
      const pick = () => {
        const opts = bar.querySelectorAll('.top-bar-heading-option');
        if (opts[want]) press(opts[want]);
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pick);
      else setTimeout(pick, 16);
      return true;
    }
    const i = TOP_ITEMS.indexOf(key);
    if (i < 0) return false;
    const items = bar.querySelectorAll(':scope > .top-bar-inner > button.top-bar-item');
    /* ⚠️ 只数 top-bar-inner 的**直接子** button ✓ —— CodeScope 自己插的 ❝ / A / ▮
       住在 div 里（不是 button 直子 ✓），用 button 直子取下标才和 TOP_ITEMS 一一对上 ✓。
       ⚠️ 数量对不上（Crepe 换了顶栏配置）→ **不乱点** ✓：宁可不做，也不点错一个按钮 ✗。 */
    if (items.length !== TOP_ITEMS.length) return false;
    return press(items[i]);
  }

  /* 顶栏里**CodeScope 自己插的**两组（提示框 / 颜色·高亮）搬上工具栏 ✓。
     为什么必须搬 ✗：顶栏被隐藏，它们的触发器也跟着看不见 ✓ ——
     而它们弹出的菜单是 **body 级**、按触发器矩形定位的 ✓（src 里 appendChild 到 body ✓），
     所以只要把触发器放到可见的地方，功能一行都不用重写 ✓。 */
  const ADOPT_GROUPS = ['.codescope-callout-group', '.codescope-color-group'];

  function adopt(host, target) {
    const bar = topBarOf(host);
    if (!bar || !target) return false;
    let moved = 0;
    ADOPT_GROUPS.forEach((sel) => {
      const g = bar.querySelector(':scope > .top-bar-inner > ' + sel) || bar.querySelector(sel);
      if (!g || g.parentElement === target) return;
      g.classList.add('lw-chrome');
      target.appendChild(g);
      moved += 1;
    });
    return moved > 0;
  }

  window.CodeScopeLifeEditor = {
    /* 迁移 / 互转（life-workbench.js 的一次性迁移只走这两个口子 ✓，
       颜色表和括号扫描器**只留一份** ✗ —— 两份必然有一天对不上 ✓）。 */
    mdToStore: mdToStore,
    mdToEditor: mdToEditor,
    mountMemo: mountMemo,
    mountJournal: mountJournal,
    read: read,
    write: write,
    destroy: destroy,
    blockIndex: blockIndex,
    exec: exec,
    adopt: adopt,
  };
})();
