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
  var PREFIX = 'codescope-code-';        /* 跟随文档配色的 4 套 */
  var CODE_PREFIX = 'cs-code-';          /* 12 套常用主题 */
  var KEYS = Object.keys(PALETTES);

  function currentKey() {
    var k = document.documentElement.getAttribute('data-doc-theme');
    return KEYS.indexOf(k) >= 0 ? k : 'everforest';   /* 缺省即暖绿森林，与 doc-theme 一致 */
  }

  /* ═══════════════════════════════════════════════════════════════════════
     程序员常用编辑器主题（2026-10-28 追加）
     -----------------------------------------------------------------------
     ★ 需求：用户希望除了那 4 套「跟文档配色走」的方案外，还能直接选程序员
       熟悉的经典主题，并且**自己随手切** ✓。
     ★ 取舍：这些主题的颜色是**各家官方值**（逐个人工核对过），不跟 --doc-* 走 ✓ ——
       它们的意义就是「稳定的、你熟悉的那套配色」✗，跟着文档变反而怪 ✓。
     ⚠️ 新增主题只要往这个表里加一行 ✓：字段与 PALETTES 同形 ✓，
        其余（defineTheme / 切换 / 持久化）全自动 ✓。
     ═══════════════════════════════════════════════════════════════════════ */
  var THEMES = [
    { id: 'one-dark',       label: 'One Dark Pro',   bg:'#282C34', fg:'#ABB2BF', dim:'#5C6370', line:'#2C313A', sel:'#3E4451', kw:'#C678DD', str:'#98C379', com:'#5C6370', num:'#D19A66', fn:'#61AFEF', type:'#E5C07B', accent:'#61AFEF' },
    { id: 'dracula',        label: 'Dracula',        bg:'#282A36', fg:'#F8F8F2', dim:'#6272A4', line:'#44475A', sel:'#44475A', kw:'#FF79C6', str:'#F1FA8C', com:'#6272A4', num:'#BD93F9', fn:'#50FA7B', type:'#8BE9FD', accent:'#BD93F9' },
    { id: 'monokai',        label: 'Monokai',        bg:'#272822', fg:'#F8F8F2', dim:'#75715E', line:'#3E3D32', sel:'#49483E', kw:'#F92672', str:'#E6DB74', com:'#75715E', num:'#AE81FF', fn:'#A6E22E', type:'#66D9EF', accent:'#A6E22E' },
    { id: 'github-dark',    label: 'GitHub Dark',    bg:'#0D1117', fg:'#C9D1D9', dim:'#8B949E', line:'#161B22', sel:'#264F78', kw:'#FF7B72', str:'#A5D6FF', com:'#8B949E', num:'#79C0FF', fn:'#D2A8FF', type:'#FFA657', accent:'#58A6FF' },
    { id: 'tokyo-night',    label: 'Tokyo Night',    bg:'#1A1B26', fg:'#C0CAF5', dim:'#565F89', line:'#292E42', sel:'#33467C', kw:'#BB9AF7', str:'#9ECE6A', com:'#565F89', num:'#FF9E64', fn:'#7AA2F7', type:'#2AC3DE', accent:'#7AA2F7' },
    { id: 'nord',           label: 'Nord',           bg:'#2E3440', fg:'#D8DEE9', dim:'#616E88', line:'#3B4252', sel:'#434C5E', kw:'#81A1C1', str:'#A3BE8C', com:'#616E88', num:'#B48EAD', fn:'#88C0D0', type:'#8FBCBB', accent:'#88C0D0' },
    { id: 'solarized-dark', label: 'Solarized Dark', bg:'#002B36', fg:'#93A1A1', dim:'#586E75', line:'#073642', sel:'#0B4C5A', kw:'#859900', str:'#2AA198', com:'#586E75', num:'#D33682', fn:'#268BD2', type:'#B58900', accent:'#268BD2' },
    { id: 'gruvbox-dark',   label: 'Gruvbox Dark',   bg:'#282828', fg:'#EBDBB2', dim:'#928374', line:'#3C3836', sel:'#504945', kw:'#FB4934', str:'#B8BB26', com:'#928374', num:'#D3869B', fn:'#83A598', type:'#FABD2F', accent:'#FABD2F' },
    { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', bg:'#1E1E2E', fg:'#CDD6F4', dim:'#6C7086', line:'#313244', sel:'#45475A', kw:'#CBA6F7', str:'#A6E3A1', com:'#6C7086', num:'#FAB387', fn:'#89B4FA', type:'#F9E2AF', accent:'#89B4FA' },
    { id: 'vscode-dark-plus', label: 'VS Code 默认深色', bg:'#1E1E1E', fg:'#D4D4D4', dim:'#6A9955', line:'#2A2D2E', sel:'#264F78', kw:'#569CD6', str:'#CE9178', com:'#6A9955', num:'#B5CEA8', fn:'#DCDCAA', type:'#4EC9B0', accent:'#569CD6' },
    { id: 'night-owl',      label: 'Night Owl',      bg:'#011627', fg:'#D6DEEB', dim:'#637777', line:'#0B2942', sel:'#1D3B53', kw:'#C792EA', str:'#ECC48D', com:'#637777', num:'#F78C6C', fn:'#82AAFF', type:'#FFCB6B', accent:'#82AAFF' },
    { id: 'material-ocean', label: 'Material Ocean', bg:'#0F111A', fg:'#A6ACCD', dim:'#464B5D', line:'#1F2233', sel:'#1F2233', kw:'#C792EA', str:'#C3E88D', com:'#464B5D', num:'#F78C6C', fn:'#82AAFF', type:'#FFCB6B', accent:'#84FFFF' }
  ];
  var THEME_BY_ID = {};
  THEMES.forEach(function (t) { THEME_BY_ID[t.id] = t; });

  var STORE_KEY = 'codescope-code-theme';
  /* 空字符串 = 跟随文档配色（默认行为）；否则是 THEMES 里的 id */
  function explicitId() {
    try { var v = localStorage.getItem(STORE_KEY) || ''; return THEME_BY_ID[v] ? v : ''; } catch (_) { return ''; }
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
      /* ★ 一期（2026-10-28）：标点与运算符**主动后退**成次要色。
         用户拿 Phycat 生成器的示例代码做对比：那边括号/逗号/分号是暗灰的，
         主体（关键字、字符串、函数）才跳出来。原来这里标点用正文色，
         整屏密度一样，看着就「平」。实测 Monaco 的 C++ 词法会给 delimiter.cpp /
         delimiter.curly.cpp / delimiter.parenthesis.cpp，都吃 delimiter 这条前缀规则。 */
      { token: 'delimiter', foreground: p.dim.slice(1) },
      { token: 'operator', foreground: p.dim.slice(1) },
      /* 预处理指令给一个明确色（#include / #define 那类）—— 它们成排出现，
         和正文同色会让文件头「糊成一片」。用关键字的色，但不像关键字那么抢。 */
      { token: 'keyword.directive', foreground: p.kw.slice(1) },
      { token: 'string.include.identifier', foreground: p.str.slice(1) },
      { token: 'tag', foreground: p.kw.slice(1) },
      { token: 'attribute.name', foreground: p.fn.slice(1) },
      { token: 'attribute.value', foreground: p.str.slice(1) },
      { token: 'variable', foreground: p.fg.slice(1) },
      { token: 'variable.predefined', foreground: p.type.slice(1) },
      /* ★ 二期：语义高亮的 token 类型（clangd / pyright 提供）。
         Monaco 用「token 名 = semanticTokensProvider legend 里的类型名」来上色 ✓，
         所以这里按**语义角色**给色，而不是按词法类别 ✓。
         ⚠️ 这些只有在 semantic-tokens.js 注册了 provider 之后才会出现 ✓ ——
            没有它时下面几条是「备而不用」，不会影响现有配色 ✓。 */
      { token: 'parameter', foreground: p.type.slice(1) },        /* 形参：和金/黄系走 */
      { token: 'property', foreground: p.fn.slice(1) },           /* 成员/字段：同函数系，弱一档 */
      { token: 'method', foreground: p.fn.slice(1) },
      { token: 'class', foreground: p.type.slice(1) },
      { token: 'struct', foreground: p.type.slice(1) },
      { token: 'enum', foreground: p.type.slice(1) },
      { token: 'namespace', foreground: p.type.slice(1) },
      { token: 'typeParameter', foreground: p.type.slice(1) },
      { token: 'interface', foreground: p.type.slice(1) },
      { token: 'macro', foreground: p.kw.slice(1) },              /* 宏：和预处理指令一个色系 */
      { token: 'decorator', foreground: p.num.slice(1) },
      { token: 'enumMember', foreground: p.num.slice(1) },        /* 枚举值：数字系（它本质是常量） */
      { token: 'event', foreground: p.fn.slice(1) },
      { token: 'modifier', foreground: p.kw.slice(1) },
      { token: 'regexp', foreground: p.str.slice(1) },
      { token: 'invalid', foreground: 'FF5370' }
    ];
  }

  /* ★ 2026-10-28 修正「背景泛白」（用户反馈）：
     原来编辑器底色直接用 --doc-bg（everforest = #272E33），而 App 面板是 #0D131B ——
     代码区比周围**亮了两档**，看着就发白。正文用 #272E33 是对的（大面积文字要够亮才不刺眼），
     但代码区是「嵌在深色界面里的一块板」，必须比正文再压一档才显得沉下去 ✓。
     ⇒ 编辑器底色 = --doc-bg 混 22% 黑；正文（Markdown）仍用原色 ✓，两边各自合适 ✓。
     ⚠️ 混黑而不是换色 ✓：色相不变 ✓，四套调色板的性格都保住 ✓。 */
  function deepen(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = 1 - amount;
    var h = function (v) { v = Math.round(v * f); return (v < 16 ? '0' : '') + v.toString(16); };
    return '#' + h(r) + h(g) + h(b);
  }

  /* 两色混合：t=0 取 a，t=1 取 b（用来做「底色 + 一点点前景色」的弱化层） */
  function mix(a, b, t) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var ch = function (sh) {
      var va = (pa >> sh) & 255, vb = (pb >> sh) & 255;
      var v = Math.round(va + (vb - va) * t);
      return (v < 16 ? '0' : '') + v.toString(16);
    };
    return '#' + ch(16) + ch(8) + ch(0);
  }

  function colorsOf(p) {
    var o = {};
    var bgDeep = deepen(p.bg, 0.22);   /* 上下文栏 / 底色都压这一档 ✓ */
    o['editor.background'] = bgDeep;
    o['editor.foreground'] = p.fg;
    o['editorLineNumber.foreground'] = p.dim;
    o['editorLineNumber.activeForeground'] = p.accent;
    o['editorCursor.foreground'] = p.accent;
    o['editor.selectionBackground'] = p.sel;
    /* 当前行高亮：原来用 p.line（#414B50），在压暗后的底色上会变成一条**亮带**，很扎眼。
       改成「底色混入 7% 前景色」—— 只提一点点，像纸被光扫到。 */
    o['editor.lineHighlightBackground'] = mix(bgDeep, p.fg, 0.07);
    o['editorIndentGuide.background1'] = mix(bgDeep, p.fg, 0.10);
    o['editorIndentGuide.activeBackground1'] = mix(bgDeep, p.dim, 0.35);
    o['editorGutter.background'] = bgDeep;
    o['editorWidget.background'] = bgDeep;
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
      /* ★★ semanticHighlighting: true 是**必须的**（2026-10-28 实测）：
         自定义主题不写这个字段时，Monaco 会**忽略**所有语义 token ✓ ——
         症状极具欺骗性：provider 注册成功 ✓、服务端返回 200 + 200 个 token ✓、
         控制台零报错 ✓，但颜色**一个都不变** ✓（因为主题没声明它接受语义着色 ✓）。
         Monaco 内置的 vs/vs-dark 是 true，自定义主题默认不是 ✓。 */
      monaco.editor.defineTheme(PREFIX + k, { base: 'vs-dark', inherit: true, semanticHighlighting: true, rules: rulesOf(p), colors: colorsOf(p) });
    });
    /* 12 套程序员常用主题：同一个颜色表结构，同一套 rulesOf/colorsOf ✓ */
    THEMES.forEach(function (t) {
      monaco.editor.defineTheme(CODE_PREFIX + t.id, { base: 'vs-dark', inherit: true, semanticHighlighting: true, rules: rulesOf(t), colors: colorsOf(t) });
    });

    /* 当前该用哪个主题名 ✓：用户显式选过就用他选的 ✓，否则跟随文档配色 ✓ */
    function activeThemeName() {
      var id = explicitId();
      return id ? (CODE_PREFIX + id) : (PREFIX + currentKey());
    }

    /* 对外 API（给 code-theme-picker.js 用）：列表 / 当前值 / 切换 */
    window.__csCodeTheme = {
      list: function () { return THEMES.map(function (t) { return { id: t.id, label: t.label, bg: t.bg, accent: t.accent, kw: t.kw, str: t.str, fn: t.fn }; }); },
      current: function () { return explicitId(); },   /* 空 = 跟随文档配色 */
      apply: function (id) {
        try {
          if (id && THEME_BY_ID[id]) localStorage.setItem(STORE_KEY, id);
          else localStorage.removeItem(STORE_KEY);
        } catch (_) {}
        try { orig(activeThemeName()); } catch (_) {}
        return activeThemeName();
      }
    };

    /* 拦截：app.js 只会传 vs / vs-dark；传 vs-dark 时改投到当前选中的主题 */
    var orig = monaco.editor.setTheme.bind(monaco.editor);
    monaco.editor.setTheme = function (name) {
      if (name === 'vs-dark') return orig(activeThemeName());
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
      try { orig(activeThemeName()); } catch (_) {}
      return ed;
    };
    /* 已有编辑器也要补补丁（install 可能晚于第一次 create） */
    try {
      (monaco.editor.getEditors ? monaco.editor.getEditors() : []).forEach(patchEditor);
    } catch (_) {}
    /* 立即应用一次（此时可能还没有编辑器，先定全局主题，后面创建的都会继承） */
    orig(activeThemeName());
    /* 跟着配色圆点走：doc-theme.js 改的是 html 上的 data-doc-theme */
    new MutationObserver(function () {
      try { orig(activeThemeName()); } catch (_) {}
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-doc-theme'] });
    /* 通知 code-theme-picker.js：API 与主题都就位了（它原来靠 200ms 轮询等这一下）✓ */
    window.dispatchEvent(new Event('cs:code-theme-ready'));
  }

  /* ★ 2026-10-31 性能审计 T-01：**事件驱动**代替 200ms 轮询 ——
     原来这里 setTimeout(wait,200) 一路空转到 Monaco 出现（最长 2 分钟），
     实测空载 10 秒装 40 次 200ms 定时器、三个文件合计唤醒 11.4 次/秒。
     现在：app.js 的 ensureMonaco() 在 Monaco 真正就绪的那一刻派发 cs:monaco-ready
     （见 app.js:333 的注释 ✓），三个旁挂文件都只监听它 ⇒ 空闲时**零唤醒** ✓。
     ⚠️ 绝不能在这里调 ensureMonaco() ✗：那个函数会**立刻开始加载 Monaco**，
        等于把懒加载变成首屏加载（也违反「没开编辑器时 window.monaco 始终 undefined」）。
     ⚠️ 开头仍查一次 window.monaco：万一它在本脚本执行前就已经就绪 ✓（例如别的路径预载过）✓。 */
  if (window.monaco && window.monaco.editor && window.monaco.editor.defineTheme) install(window.monaco);
  else window.addEventListener('cs:monaco-ready', function () { if (window.monaco) install(window.monaco); }, { once: true });
})();