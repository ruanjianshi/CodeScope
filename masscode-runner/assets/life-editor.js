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
  function mountInto(slot, host, opts, clearFirst) {
    opts = opts || {};
    const key = opts.key == null ? '' : String(opts.key);
    const markdown = opts.markdown == null ? '' : String(opts.markdown);
    const token = ++slot.token;
    const prev = slot.inst;
    const inst = { key, token, ctrl: null, md: markdown, host: host || null, opts };
    slot.inst = inst;                                              /* ① */
    if (prev && prev.ctrl) { try { prev.ctrl.destroy(); } catch (_) {} }   /* ② */
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
    if (typeof loadBlockEditor !== 'function') {
      host.innerHTML = '<div class="lw-memo-err">块级编辑器不可用（loadBlockEditor 缺失）</div>';
      return;
    }
    loadBlockEditor().then((api) => api.create({
      root: host,
      markdown,
      /* ★★ 2026-10-30 改回 true：关掉后编辑时**没有任何格式工具栏** ✗ ——
         粗体/斜体/标题/列表/引用/表格/图片全在那条自带工具栏上，
         而面板自己的按钮只有 Aa / ✓ / ⊞ / 源码 ✓。功能优先于「不重复」✓。 */
      topBar: opts.topBar !== false,
      onChange: (md) => {
        if (token !== slot.token || !slot.inst) return;
        slot.inst.md = md;
        /* 初始化时 Crepe 会规范化一次并回调 —— 那不是用户编辑，不回调 ✓（同 app-reading.js:522）*/
        if (!host.contains(document.activeElement)) return;
        if (typeof opts.onChange === 'function') opts.onChange(md);
      },
      onError: (err) => {
        if (typeof opts.onStatus === 'function') opts.onStatus('编辑器：' + String((err && err.message) || err));
      },
    })).then((ctrl) => {
      if (token !== slot.token || !host.isConnected) { try { ctrl.destroy(); } catch (_) {} return; }
      slot.inst.ctrl = ctrl;
      host.dataset.editorReady = 'true';
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
    if (s.inst && s.inst.ctrl) { try { s.inst.ctrl.destroy(); } catch (_) {} }
    s.inst = null;
    s.token += 1;
    if (host) { try { delete host.dataset.editorKey; delete host.dataset.editorReady; } catch (_) {} }
  }

  /* 光标所在块 → markdown 里的行号（-1 = 找不到）✓ —— 面板的行变换按钮用 ✓ */
  function blockIndex(hostId, lines) {
    return ceBlockIndex(lines || [], caretBlockText(hostId));
  }

  window.CodeScopeLifeEditor = {
    mountMemo: mountMemo,
    mountJournal: mountJournal,
    read: read,
    write: write,
    destroy: destroy,
    blockIndex: blockIndex,
  };
})();
