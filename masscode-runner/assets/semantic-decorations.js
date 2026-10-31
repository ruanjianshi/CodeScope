/* 语义上色 · 装饰器方案（2026-10-28，二期最终实现）
   -----------------------------------------------------------------------
   ★ 为什么不用 Monaco 的 DocumentSemanticTokensProvider ✗（实测结论）：
     本项目的 monaco-editor 0.52 min/vs 构建里，**注册 API 在、消费侧不在** ✓：
       · registerDocumentSemanticTokensProvider 调用成功（返回 disposable，不抛）✓
       · 但提供者永远不被调用 ✗ —— 逐一排除了：裸语言 id、选择器对象 {language,scheme}、
         内置 vs-dark 主题、自定义主题、全新创建的编辑器、强制 setModel 重着色 ✓
       · 连 editor.getAction('editor.action.semanticTokens.refresh') 都是 undefined ✗
     ⇒ 四种组合下 provider 调用数都是 0 ✓ —— 不是我们写错了，是这个构建不跑那套贡献 ✓。

   ★ 改用**装饰器**（deltaDecorations + inlineClassName）✓：
     服务端那条链路是完全可用的（实测 clangd 返回 200 个 token / legend 25 类）✓，
     我们只是把「上色」这一步从 Monaco 的语义管道换成自己挂装饰 ✓ ——
     位置/长度都在 token 里 ✓，类名由我们决定 ✓，颜色走 --doc-syn-* ✓（换配色自动跟）✓。

   ⚠️ 纯增强 ✓：服务器不支持 / 索引未就绪 / 请求失败 ⇒ 什么都不挂 ✓，
      编辑器与没有本文件**完全一致** ✓（词法着色照旧）✓。
   ⚠️ 只在内容变化后**防抖 450ms** 才请求 ✓；同一编辑器同一内容不重复挂 ✓。 */
(function () {
  'use strict';

  /* 语义类型 → CSS 类（颜色定义在 editor-chrome.css 里，走 --doc-syn-* 变量） */
  var TYPE_CLASS = {
    function: 'cs-sem-fn', method: 'cs-sem-fn',
    parameter: 'cs-sem-param',
    property: 'cs-sem-prop',
    variable: 'cs-sem-var',
    /* ★ 实测：clangd 的 legend 里主要用 **type**（不是 class/struct/enum）✓ ——
       漏了它就只有 namespace 那几个能上色 ✓（第一次验收：只挂上 1 个 span ✓）。 */
    type: 'cs-sem-type', concept: 'cs-sem-type',
    class: 'cs-sem-type', struct: 'cs-sem-type', enum: 'cs-sem-type',
    interface: 'cs-sem-type', typeParameter: 'cs-sem-type',
    typedef: 'cs-sem-type',
    namespace: 'cs-sem-ns',
    macro: 'cs-sem-macro',
    enumMember: 'cs-sem-const',
    keyword: 'cs-sem-kw',
    comment: 'cs-sem-com'
  };
  var MAX_DECOS = 4000;      /* 上限：极端大文件不把界面拖死 */
  var DEBOUNCE_MS = 450;

  /* 从 model.uri 反解 file / index —— 与 semantic-tokens.js 同一个坑：
     绝对路径里的 %E5%A4%9A（中文）必须解码，否则服务端 404。 */
  function parseRef(input) {
    var str = String(input || '');
    var m = /^inmemory:\/\/codescope\/(.+)$/.exec(str);
    if (!m) return null;
    var rest = m[1];
    var slash = rest.lastIndexOf('/');
    if (slash < 0) return null;
    var tail = rest.slice(slash + 1);
    if (!/^\d+$/.test(tail)) return null;
    var file = rest.slice(0, slash);
    if (!file) return null;
    if (file.indexOf('%') >= 0) { try { file = decodeURIComponent(file); } catch (_) {} }
    return { file: file, index: Number(tail) };
  }

  function attach(monaco, ed) {
    if (!ed || ed.__csSemAttached) return;
    ed.__csSemAttached = true;
    var timer = 0, lastKey = '';
    var decos = [];

    function refresh() {
      var model = ed.getModel();
      if (!model || !window.api) return;
      var ref = parseRef(model.uri.toString());
      if (!ref) return;
      var code = model.getValue();
      var key = model.uri.toString() + '\u0000' + (model.getVersionId ? model.getVersionId() : 0);
      if (key === lastKey) return;
      lastKey = key;
      window.api('/api/lsp/query', { file: ref.file, fragment: ref.index, code: code, action: 'semanticTokens', line: 1, column: 1 })
        .then(function (res) {
          if (!res || !res.ok || !res.available || !Array.isArray(res.tokens)) return;
          var types = (res.legend && res.legend.tokenTypes) || [];
          var next = [];
          for (var i = 0; i < res.tokens.length && next.length < MAX_DECOS; i++) {
            var t = res.tokens[i];
            var cls = TYPE_CLASS[types[t.type]];
            if (!cls) continue;
            next.push({
              range: new monaco.Range(t.line + 1, t.start + 1, t.line + 1, t.start + t.length + 1),
              options: { inlineClassName: cls }
            });
          }
          decos = ed.deltaDecorations(decos, next);
        })
        .catch(function () { /* 静默：失败就保持词法着色 */ });
    }

    function schedule() { clearTimeout(timer); timer = setTimeout(refresh, DEBOUNCE_MS); }
    try { ed.onDidChangeModelContent(schedule); } catch (_) {}
    try { ed.onDidChangeModel(schedule); } catch (_) {}
    schedule();
  }

  /* ★ 2026-10-31 性能审计 T-01：这里原来是「每 400ms 扫一遍编辑器列表」
     （最长扫 6 分钟 = 900 次定时器唤醒 ✓，实测空载时它占唤醒的大头之一）。
     现在拆成两半，都是事件驱动、零轮询：
       ① Monaco 就绪 → app.js 的 ensureMonaco() 派发 cs:monaco-ready ⇒ 给**已有**的编辑器挂上；
       ② 之后**新建**的编辑器 → 钩 monaco.editor.create（app.js / app-reading.js 都走它）✓。
     ⚠️ 只在 monaco 真就绪后钩 create ✓：早了没有 create 可钩，晚了会漏掉第一个编辑器。
     ⚠️ attach 本身幂等（ed.__csSemAttached）✓，钩子只装一次（__csSemHooked）✓。 */
  function hook(monaco) {
    try { monaco.editor.getEditors().forEach(function (ed) { attach(monaco, ed); }); } catch (_) {}
    var create = monaco.editor.create;
    if (!create || create.__csSemHooked) return;
    var wrapped = function () { var ed = create.apply(this, arguments); try { attach(monaco, ed); } catch (_) {} return ed; };
    wrapped.__csSemHooked = true; monaco.editor.create = wrapped;
  }
  if (window.monaco && window.monaco.editor && window.monaco.editor.create) hook(window.monaco);
  else window.addEventListener('cs:monaco-ready', function () { if (window.monaco) hook(window.monaco); }, { once: true });
})();