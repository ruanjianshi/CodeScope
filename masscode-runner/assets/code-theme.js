/* 代码编辑器的语法配色（2026-10-28）
   -----------------------------------------------------------------------
   ★ 问题：app.js:274 只写了 monacoTheme(){ return APP_THEME === light ? vs : vs-dark }，
     也就是说代码区一直用 Monaco 的**内置两档主题**，跟那 4 套 Phycat 文档配色毫无关系；
     结果是「Markdown 文档能换暖绿森林，旁边代码却还是通用深色」—— 两边不同步。

   ★ 做法：把 doc-theme.css 里**已经定义好的** --doc-syn-* 直接映射成 4 套 Monaco 主题，
     颜色不是新造的，是同一份调色板的另一种表达。

   ⚠️ 为什么不改 app.js 里的 monacoTheme()：它顶在 12,993 行代码的棘轮上限，
      而 defineTheme 要几十行。所以改成**拦截** setTheme：app.js 传 vs-dark 时，
      这里改投到当前文档配色对应的主题，app.js 一个字不用改。

   ⚠️ 只在 app 主题是深色时接管：APP_THEME=light 时 app.js 传的是 vs（浅色编辑器），
      我们原样放行 —— 给浅色界面套深色编辑器是更糟的选择。

   ⚠️ 幂等：defineTheme 同名重复调用会覆盖定义，不会累积。
   ⚠️ 删掉本文件 + index.html 那一行，就回到 monaco 内置主题（纯叠加，零侵入）。 */
(function () {
  'use strict';

  /* 调色板：与 doc-theme.css 的 --doc-* / --doc-syn-* 一一对应（改那边记得同步这里） */
  var PALETTES = {
    everforest: { bg:'#272E33', fg:'#D3C6AA', dim:'#859289', line:'#414B50', sel:'#4C3743', kw:'#E67E80', str:'#A7C080', com:'#859289', num:'#D699B6', fn:'#7FBBB3', type:'#DBBC7F', accent:'#A7C080' },
    abyss:      { bg:'#0F111A', fg:'#D6DEEB', dim:'#5A6478', line:'#1F2233', sel:'#074B54', kw:'#C792EA', str:'#ECC48D', com:'#637777', num:'#F78C6C', fn:'#82AAFF', type:'#FFCB6B', accent:'#00B7C0' },
    radiation:  { bg:'#1B1D1B', fg:'#E6E6E6', dim:'#6B7A6B', line:'#333933', sel:'#1F3B24', kw:'#FFCB6B', str:'#C3E88D', com:'#546E7A', num:'#F78C6C', fn:'#4CD964', type:'#FFCB6B', accent:'#4CD964' },
    vampire:    { bg:'#282A36', fg:'#F8F8F2', dim:'#9AA0B5', line:'#44475A', sel:'#53304A', kw:'#FF79C6', str:'#F1FA8C', com:'#6272A4', num:'#BD93F9', fn:'#50FA7B', type:'#FFCB6B', accent:'#FF5555' }
  };
  var PREFIX = 'codescope-code-';
  var KEYS = Object.keys(PALETTES);

  function currentKey() {
    var k = document.documentElement.getAttribute('data-doc-theme');
    return KEYS.indexOf(k) >= 0 ? k : 'everforest';   /* 缺省即暖绿森林，与 doc-theme 一致 */
  }

  /* token 规则：Monaco 用 TextMate 风格 token 名，前缀匹配即可覆盖各语言 */
  function rulesOf(p) {
    return [
      { token: '', foreground: p.fg.slice(1) },
      { token: 'comment', foreground: p.com.slice(1), fontStyle: 'italic' },
      { token: 'keyword', foreground: p.kw.slice(1) },
      { token: 'keyword.control', foreground: p.kw.slice(1) },
      { token: 'string', foreground: p.str.slice(1) },
      { token: 'string.escape', foreground: p.num.slice(1) },
      { token: 'number', foreground: p.num.slice(1) },
      { token: 'constant', foreground: p.num.slice(1) },
      { token: 'type', foreground: p.type.slice(1) },
      { token: 'type.identifier', foreground: p.type.slice(1) },
      { token: 'identifier.type', foreground: p.type.slice(1) },
      { token: 'predefined', foreground: p.type.slice(1) },
      { token: 'function', foreground: p.fn.slice(1) },
      { token: 'identifier.function', foreground: p.fn.slice(1) },
      { token: 'delimiter', foreground: p.fg.slice(1) },
      { token: 'operator', foreground: p.kw.slice(1) },
      { token: 'tag', foreground: p.kw.slice(1) },
      { token: 'attribute.name', foreground: p.fn.slice(1) },
      { token: 'attribute.value', foreground: p.str.slice(1) },
      { token: 'variable', foreground: p.fg.slice(1) },
      { token: 'variable.predefined', foreground: p.type.slice(1) },
      { token: 'invalid', foreground: 'FF5370' }
    ];
  }

  function colorsOf(p) {
    var o = {};
    o['editor.background'] = p.bg;
    o['editor.foreground'] = p.fg;
    o['editorLineNumber.foreground'] = p.dim;
    o['editorLineNumber.activeForeground'] = p.accent;
    o['editorCursor.foreground'] = p.accent;
    o['editor.selectionBackground'] = p.sel;
    o['editor.lineHighlightBackground'] = p.line;
    o['editorIndentGuide.background1'] = p.line;
    o['editorIndentGuide.activeBackground1'] = p.dim;
    o['editorGutter.background'] = p.bg;
    o['editorWidget.background'] = p.bg;
    o['editorWidget.border'] = p.line;
    o['editorOverviewRuler.border'] = p.line;
    /* 括号配对着色：原本用内置色盘，会和主题打架 → 换成主题内的一组同族色 */
    o['editorBracketHighlight.foreground1'] = p.kw;
    o['editorBracketHighlight.foreground2'] = p.fn;
    o['editorBracketHighlight.foreground3'] = p.type;
    o['editorBracketHighlight.foreground4'] = p.str;
    o['editorBracketHighlight.foreground5'] = p.num;
    o['editorBracketHighlight.foreground6'] = p.dim;
    return o;
  }

  var installed = false;
  function install(monaco) {
    if (!monaco || !monaco.editor || installed) return;
    installed = true;
    KEYS.forEach(function (k) {
      var p = PALETTES[k];
      monaco.editor.defineTheme(PREFIX + k, { base: 'vs-dark', inherit: true, rules: rulesOf(p), colors: colorsOf(p) });
    });
    /* 拦截：app.js 只会传 vs / vs-dark；传 vs-dark 时改投到当前文档配色 */
    var orig = monaco.editor.setTheme.bind(monaco.editor);
    monaco.editor.setTheme = function (name) {
      if (name === 'vs-dark') return orig(PREFIX + currentKey());
      return orig(name);
    };
    /* ★ 实测踩到的坑：app.js 把 theme:'vs-dark' 写进 monacoOptions() 的 options，
       Monaco 会拿它**直接**调内部 setTheme，**绕过**上面这个包装 —— 于是第一屏拿到的是
       vs-dark（#1E1E1E），要等下一次 data-doc-theme 变化才被纠正。
       ⇒ 钩住 monaco.editor.create：每建一个编辑器就重新按一次主题（精确、不用观察整棵树）。 */
    /* ★★ 第二个坑（比第一个隐蔽）：**切片段标签时 app.js 走的是
       editor.updateOptions({ theme: ... })，不是 setTheme** —— 实测三态：
         after-open       bg = rgb(39,46,51)  （#272E33 暖绿森林，正确）
         after-tabswitch  bg = rgb(30,30,30)  （#1E1E1E vs-dark，被重置）
         手动 updateOptions({theme:'vs-dark'}) → 同样退回 #1E1E1E（证实这条路径）
       ⇒ 只包 setTheme 不够，必须连 updateOptions 里的 theme 一起拦 ✓。
       ⇒ 做法：给每个编辑器包一层 updateOptions，把 theme 字段**摘掉** ✓
         （主题只由这里一处决定，避免两处打架 ✓）。 */
    function patchEditor(ed) {
      if (!ed || ed.__csThemePatched) return;
      ed.__csThemePatched = true;
      var uo = ed.updateOptions.bind(ed);
      ed.updateOptions = function (opts) {
        if (opts && typeof opts.theme === 'string') {
          var copy = {};
          for (var k in opts) if (k !== 'theme') copy[k] = opts[k];
          opts = copy;
        }
        return uo(opts);
      };
    }
    var origCreate = monaco.editor.create;
    monaco.editor.create = function () {
      var ed = origCreate.apply(this, arguments);
      try { patchEditor(ed); } catch (_) {}
      try { orig(PREFIX + currentKey()); } catch (_) {}
      return ed;
    };
    /* 已有编辑器也要补补丁（install 可能晚于第一次 create） */
    try {
      (monaco.editor.getEditors ? monaco.editor.getEditors() : []).forEach(patchEditor);
    } catch (_) {}
    /* 立即应用一次（此时可能还没有编辑器，先定全局主题，后面创建的都会继承） */
    orig(PREFIX + currentKey());
    /* 跟着配色圆点走：doc-theme.js 改的是 html 上的 data-doc-theme */
    new MutationObserver(function () {
      try { orig(PREFIX + currentKey()); } catch (_) {}
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-doc-theme'] });
  }

  /* Monaco 是懒加载的（require 之后才挂到 window 上）—— 轻量轮询等它出现。
     ⚠️ 不用永久 setInterval：拿到就停，2 分钟还没加载就放弃（那时用户也没在用编辑器）。 */
  var tries = 0;
  (function wait() {
    if (window.monaco && window.monaco.editor && window.monaco.editor.defineTheme) { install(window.monaco); return; }
    if (tries++ > 600) return;
    setTimeout(wait, 200);
  })();
})();