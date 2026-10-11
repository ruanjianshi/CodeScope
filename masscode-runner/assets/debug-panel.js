/*
 * 调试面板（断点 / 单步 / 变量表 / 当前位置）
 * ---------------------------------------------------------------------------
 * ★ 从 assets/app.js 抽出来的（2026-10-11）——
 *   抽它的理由：
 *     · app.js 当时 17,142 行，是**全项目最大的单文件**，
 *       架构图把它标红了（见 docs/architecture.html）；
 *     · 这块**内聚**：三条语言线共用一套 UI，只有命令名不同；
 *     · 它依赖的全局就那几个（DEBUG / BREAKPOINTS / DEBUG_OUT / MONACO_EDITOR），
 *       所以抽出来**不用改任何调用方**。
 *
 * ⚠️ 加载顺序**必须是 debug-panel.js 在 app.js 之前** ——
 *    因为 app.js 启动时就会调 showDbgBar() / scanDebugOutput()，
 *    而这两个是**函数声明**（有提升），所以先加载就能被调到。
 *
 * ⚠️ 这里仍然是**经典脚本**（不是 ESM）—— 项目整体就是经典脚本，
 *    混进 ESM 会让全局变量的可见性变复杂。抽出来的目的是
 *    **让文件变小、边界变清楚**，不是换模块系统。
 */
/* ★★ 调试：命令映射 + 会话状态 ✓✓（2026-10-10）
   设计稿见 docs/design/调试能力设计.md ✓。
   ⚠️ **三条线共用一套 UI** ✗✓（断点红点 / 当前行 / 变量 / 继续 / 单步 ✓），
      **只有命令名不同** ✓ —— 所以这里就是一张映射表 ✓。
      加一门语言 = 加一行 ✓（这正是 DAP「协议与 UI 解耦」的朴素版本 ✓）。 */
const DEBUG_CMDS = {
  matlab: { continue: 'dbcont', next: 'dbstep', stepIn: 'dbstep in', stepOut: 'dbstep out', vars: 'who', stop: 'dbquit' },
  octave: { continue: 'dbcont', next: 'dbstep', stepIn: 'dbstep in', stepOut: 'dbstep out', vars: 'who', stop: 'dbquit' },
  python: { continue: 'c', next: 'n', stepIn: 's', stepOut: 'r', vars: 'p list(locals().items())', stop: 'q' },
  c_cpp: { continue: 'continue', next: 'next', stepIn: 'step', stepOut: 'finish', vars: 'info locals', stop: 'quit' },
  c: { continue: 'continue', next: 'next', stepIn: 'step', stepOut: 'finish', vars: 'info locals', stop: 'quit' },
};
const DEBUG = { active: false, lang: '', file: '', label: '', lastLine: 0, pos: '' };

function dbgCmdSet() { return DEBUG_CMDS[String(DEBUG.lang || '').toLowerCase()] || null; }

/* 往终端里发一行 ✓（和「MATLAB 命令窗口」用的是同一个通道 ✓） */
function termSend(line) {
  return fetch('/api/term/input', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: String(line) + '\r' }),
  }).catch(() => {});
}

function showDbgBar(on) {
  const bar = $('dbg-bar');
  if (bar) bar.style.display = on ? '' : 'none';
  const st = $('dbg-state');
  if (st) {
    /* ★ 调试条要显示**会话绑在哪个片段上** ✓✓（2026-10-10）——
       用户实测报的 bug：「我切换文件，他不会自己更新」✓。
       ⚠️ 现象 ✗：切到 uart.c（C++）后，调试条还写着「调试中 · matlab」✓ ——
          那是**上一次**调试留下的状态 ✓，切片段时没跟着更新 ✓。
       ⚠️ 但不能「切了就把语言换成新的」✗ ——
          调试会话跑在**终端**里 ✓，绑的是**旧文件** ✓；
          把标签改成新语言会**骗人** ✓（按钮发出去的命令还是旧会话的 ✓）。
       → 正确做法：显示**会话自己的语言 + 文件名** ✓，
          切到别的片段时**照实说明**「会话在 xxx 上」✓，
          而不是假装跟随 ✓。 */
    const sessLang = String(DEBUG.lang || '');
    /* ⚠️ 用**片段名**（label ✓）而不是文件路径 ✗ ——
       用户关心的是「在调 main.c 还是 uart.c」✓，
       不是「在哪个 .md 里」✓（一个 .md 里可能有 5 个片段 ✓）。 */
    const sessName = String(DEBUG.label || (DEBUG.file || '').split('/').pop());
    const cur = CURRENT && CURRENT.fragments[CINDEX];
    const curLang = String((cur && cur.language) || '').toLowerCase();
    const elsewhere = on && sessLang && curLang && sessLang !== curLang;
    st.textContent = !on ? '未在调试'
      : (elsewhere
        ? ('调试中 · ' + sessLang + '（会话在 ' + sessName + ' 上 · 当前片段是 ' + curLang + '）')
        /* ★ 顺手把「停在第几行」也带出来 ✓✓（2026-10-10）——
           用户要「位置，所在位置行号」✓；调试条**一直在** ✓，
           比变量面板更容易看到 ✓（面板可能没开 ✓）。 */
        : ('调试中 · ' + sessLang + (sessName ? ' · ' + sessName : '') + (DEBUG.lastLine ? ' · 第 ' + DEBUG.lastLine + ' 行' : '')));
    st.className = 'dbg-state' + (on ? ' on' : '');
    st.title = elsewhere ? '调试会话绑定在终端里跑的那个文件上；要调当前片段请先「停止」再重新点 🐞' : '';
    /* ★ 点调试条 → **跳到当前停的那一行** ✓✓（2026-10-11）—— 用户：「多多检查和优化」✓
       ⚠️ 为什么要做 ✗：调试时经常「眼睛在终端、想知道代码在哪」 ✓，
          或者滚走了想回来 ✓ —— 点一下比手动找行号快得多 ✓。
       ⚠️ 只在**有行号**时才让它是可点的 ✗（`on && lastLine` ✓）——
          否则点了没反应，用户会以为坏了 ✓。
       ⚠️ 用 `style.cursor` + `onclick` 而不是给整条加 ✗ ——
          只让**状态文字**可点 ✓，免得和「停止」按钮抢点击 ✓。 */
    const canJump = on && DEBUG.lastLine > 0;
    st.style.cursor = canJump ? 'pointer' : '';
    st.onclick = canJump ? () => {
      try {
        MONACO_EDITOR.revealLineInCenter(DEBUG.lastLine);
        MONACO_EDITOR.setPosition({ lineNumber: DEBUG.lastLine, column: 1 });
        MONACO_EDITOR.focus();
      } catch (_) {}
    } : null;
    if (canJump) st.title = '点一下跳到第 ' + DEBUG.lastLine + ' 行';
  }
}

/* ★ 启动调试 ✓✓ ——
   ⚠️ Octave / MATLAB 的做法 ✗：**在终端里跑** ✓，而不是走「▶ 运行」✓。
      因为断点需要**持久会话** ✓（`dbstop` 设好之后要在**同一个** Octave 里 run ✓），
      而「▶ 运行」每次都开新进程 ✓，断点设了也白设 ✓。
   ⚠️ 命令顺序**不能错** ✗：先 `dbstop in <file> at <line>`（每个断点一条 ✓），
      最后 `run <file>` ✓；反过来的话 run 完了才设断点 ✓。
   ⚠️ 文件名用**运行时同名** ✓（main.m ✓）—— 和服务端写临时文件的名字一致 ✓，
      否则 dbstop 找不到文件 ✓。 */
async function startDebug() {
  const f = CURRENT && CURRENT.fragments[CINDEX];
  if (!f) return;
  const lang = String(f.language || '').toLowerCase();
  const cmds = DEBUG_CMDS[lang];
  if (!cmds) { setStatus('err', '这个语言还没有调试支持（现在有：MATLAB/Octave · Python · C/C++）'); return; }
  const ref = { file: CURRENT.file, index: CINDEX };
  const bps = BREAKPOINTS.list(ref);
  /* ⚠️⚠️ 一个终端里只能有**一个**调试器 ✗✗（2026-10-10）——
     用户实测：Octave 会话还在跑 ✓，切到 Python 片段又点 🐞 ✓ →
     终端里**两个调试器叠着** ✓ → 点「单步」发出的 pdb 命令 `n`
     被**旧 Octave** 吃了 ✓ → `error: 'n' undefined near line 1, column 1` ✓✓。
     → 重开调试前**先把终端重启**（清掉旧会话 ✓）——
       这是最稳的清理方式 ✓：比往旧调试器里发 quit 可靠 ✓，
       因为旧调试器可能已经卡在某个状态里 ✓（比如正停在断点上 ✓）。
     ⚠️ 还要**清掉 MONCONSOLE_KEY** ✗ —— 终端重启后引擎也没了 ✓，
        不清的话下次会以为「引擎已经起过」而跳过启动 ✓。 */
  if (DEBUG.active) {
    setStatus('idle', '先清理上一个调试会话…');
    try { const old = dbgCmdSet(); if (old) termSend(old.stop); } catch (_) {}
    try {
      fetch('/api/term/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1800));
    DEBUG.active = false; MONCONSOLE_KEY = ''; setDebugLine(0);
  }
  DEBUG.active = true; DEBUG.lang = lang; DEBUG.file = CURRENT.file; DEBUG.label = (f.label || ''); DEBUG.lastLine = 0;
  showDbgBar(true);
  switchOutTab('term');
  if (lang === 'matlab' || lang === 'octave') {
    if (!bps.length) {
      setStatus('idle', '没有断点 —— 先点行号槽左侧设一个（直接跑也行，出错会停在 error 上）');
      return;
    }
    /* ⚠️⚠️ 还要**先把片段写到临时目录** ✗✗（2026-10-10）——
       用户实测：终端里是
         octave:1> dbstop in main.m at 3
         error: add_breakpoints_in_function: unable to find function 'main.m'
         octave:2> run main.m
         error: run: file SCRIPT must exist and be a valid Octave scriptfile
       **因为 Octave 起在项目目录** ✓，而片段代码在**临时目录** ✓ ——
       调试器在**找不到文件的地方**起来了 ✓。
       ⚠️ 这和 C/C++ 那个 bug 是**同一类** ✗✓：
          **调试器必须在「放代码的目录」里起** ✓ ——
          所以这里也走 `/api/dbg/prepare`（它现在两种语言都支持 ✓）。
       ⚠️ 还有个小坑 ✗：Octave 的 `dbstop` / `run` 认的是**不带扩展名**的名字 ✓
          （`dbstop in main at 3` ✓，不是 `main.m` ✓）——
          接口会返回 `entry` 就是这个 ✓。 */
    setStatus('idle', '正在准备调试（把片段写到临时目录）…');
    const mFiles = (CURRENT.fragments || []).map((x) => ({ filename: (x.label || 'main.m'), code: x.code }));
    const prep = await api('/api/dbg/prepare', { language: lang, code: f.code, files: mFiles });
    if (!prep || !prep.ok) {
      setStatus('err', '调试准备失败');
      showOut(String((prep && prep.error) || '调试准备失败'), '', false);
      DEBUG.active = false; showDbgBar(false);
      return;
    }
    setStatus('idle', '正在终端里启动引擎…');
    setTimeout(async () => {
      /* ① 进到放代码的目录，在那里起引擎 ✓ */
      await termSend('cd ' + JSON.stringify(prep.dir) + ' && ' + prep.launch);
      /* ② 等引擎起来 ✓（Octave 快、MATLAB 慢 ✓） */
      await new Promise((r) => setTimeout(r, 2600));
      /* ③ 设断点、再 run ✓（名字**不带 .m** ✓） */
      for (const line of bps) await termSend('dbstop in ' + prep.entry + ' at ' + line);
      await termSend('run ' + prep.entry);
      setStatus('ok', '已进入调试（' + bps.length + ' 个断点）· 用上面的按钮单步');
    }, 900);
  } else if (lang === 'python') {
    /* ★ Python ✓✓（2026-10-10）——
       ⚠️ 用户实测报的 bug ✗：在 Python 片段上点 🐞，
          调试条显示「调试中 · python」✓，但终端里跑的还是**上一个 Octave 会话** ✓
          → 点「单步」发出 pdb 的 `n` ✓ → **Octave** 执行它 →
            `error: 'n' undefined near line 1, column 1` ✓✓。
       根因：Python 分支原来是**空壳** ✓（只提示「已就绪」✓），
             却把 DEBUG.lang 改成了 python ✗ → **劫持了旧会话的状态** ✓。
       → 现在给 Python 一个**真会话** ✓：`python3 -m pdb <脚本>` ✓
          （**标准库自带** ✓，不用装 debugpy ✓）。
       ⚠️ 命令映射（DEBUG_CMDS.python ✓）本来就是 pdb 的 ✓：
          c / n / s / r / p locals() / q ✓。
       ⚠️ pdb 设断点是 `b <行号>` ✓（不是 dbstop ✓）。 */
    setStatus('idle', '正在准备 Python 调试（写片段到临时目录）…');
    const pyFiles = (CURRENT.fragments || []).map((x) => ({ filename: (x.label || 'main.py'), code: x.code }));
    const prep = await api('/api/dbg/prepare', { language: 'python', code: f.code, files: pyFiles });
    if (!prep || !prep.ok) {
      setStatus('err', '调试准备失败');
      showOut(String((prep && prep.error) || '调试准备失败'), '', false);
      DEBUG.active = false; showDbgBar(false);
      return;
    }
    setStatus('idle', '正在终端里启动 pdb…');
    setTimeout(async () => {
      await termSend('cd ' + JSON.stringify(prep.dir) + ' && ' + prep.launch);
      /* pdb 起得很快 ✓，给一点点时间就够 ✓ */
      await new Promise((r) => setTimeout(r, 1400));
      for (const line of bps) await termSend('b ' + line);
      await termSend('c');
      setStatus('ok', '已进入 pdb 调试（' + bps.length + ' 个断点）· 用上面的按钮单步');
    }, 900);
  } else if (lang === 'c' || lang === 'c_cpp') {
    /* ★ C / C++ ✓✓（2026-10-10）——
       ⚠️ 用户实测报的 bug ✗：在 C++ 文件上点 🐞，命令却**发给了 bash** ✓ →
           `bash: syntax error near unexpected token '('` / `bash: p: command not found` ✓。
       根因：**C/C++ 的调试会话必须先有 gdb 在跑** ✓，
             而终端只是个裸 shell ✓ —— 往 shell 里发 `next` / `info locals` 当然不认 ✓。
       还有一层：现有「▶ 运行」编译时**不带 `-g`** ✗ →
             就算起了 gdb，断点也对不上、变量全被优化掉 ✓。
       → 所以：① 先让服务端**带 `-g -O0` 编译** ✓
               ② 再在终端里 `cd <dir> && gdb ./a.out` ✓
               ③ 最后才把断点和 run 发进去 ✓（顺序不能错 ✓）。 */
    setStatus('idle', '正在编译（带 -g 调试符号）…');
    const files = (CURRENT.fragments || []).map((x) => ({ filename: (x.label || 'main.c'), code: x.code }));
    const r = await api('/api/dbg/prepare', { language: lang, code: f.code, files });
    if (!r || !r.ok) {
      setStatus('err', '编译失败 —— 调试需要一个能编译通过的程序');
      showOut(String((r && r.error) || '编译失败'), '', false);
      DEBUG.active = false; showDbgBar(false);
      return;
    }
    if (!r.gdb) {
      setStatus('err', '这台机器上没有 gdb —— 先装一个（Linux: apt install gdb · macOS: brew install gdb，且需要签名）');
      DEBUG.active = false; showDbgBar(false);
      return;
    }
    setTimeout(async () => {
      await termSend('cd ' + JSON.stringify(r.dir) + ' && gdb ./' + r.bin);
      for (const line of bps) await termSend('break ' + (f.label || 'main.c') + ':' + line);
      await termSend('run');
      setStatus('ok', '已进入 gdb 调试（' + bps.length + ' 个断点）· 用上面的按钮单步');
    }, 900);
  } else {
    setStatus('idle', lang + ' 调试已就绪 —— 继续=' + cmds.continue + ' 单步=' + cmds.next + '（命令会发到终端）');
  }
}

function stopDebug() {
  const cmds = dbgCmdSet();
  if (cmds && DEBUG.active) termSend(cmds.stop);
  DEBUG.active = false; DEBUG.lastLine = 0; DEBUG.label = ''; DEBUG.pos = '';
  showDbgBar(false);
  setDebugLine(0);
  setStatus('idle', '已退出调试');
}

/* ★ 「变量」不再往终端发命令 ✗✓（2026-10-10）——
   改成**弹一个表格面板** ✓（用户选了 A ✓）。
   ⚠️ 面板自己会发 `whos` / `p locals()` / `info locals` ✓ ——
      比 DEBUG_CMDS.vars 更适合解析 ✓（`who` 只有名字、没有值 ✓）。 */

/* ⚠️⚠️ 下面这些接线**必须等 app.js 加载完** ✗✗（2026-10-11 实测修）——
   本文件在 index.html 里排在 app.js **之前** ✓（因为 app.js 启动时就要调
   showDbgBar() / scanDebugOutput() ✓，那两个是**函数声明** ✓、有提升 ✓）。
   但下面这些是**顶层语句** ✓，加载到本文件时 `$` 还没定义 ✓ →
   `$ is not defined` ✓（实测就是这样：**页面能开，但一进调试就炸** ✓）。

   ⚠️ 根因要说清 ✗：`$` 在 app.js 里是 **`const $ = (id) => ...`** ✓，
      **const 没有提升** ✓（函数声明才有 ✓）——
      所以"排在后面"的脚本里，任何**在 app.js 执行前**跑的顶层代码都拿不到它 ✓。

   ⚠️ 排查时踩了一个小坑 ✗：那个 `[['dbg-continue', ...]].forEach` 块
      **缩进是 2 个空格** ✓，**看着像在函数体里** ✓，其实在**顶层** ✓；
      我第一遍找它时正则写成 `['` 开头 ✓，而它其实是 **`[[`** 开头 ✓ → 没匹配上 ✓。
      → **"没找到"时先核对匹配串，别急着换思路** ✓。 */
document.addEventListener('DOMContentLoaded', () => {
  /* 调试按钮 ✓ —— 全部就是「把对应命令发进终端」✓ */
  [['dbg-continue', 'continue'], ['dbg-next', 'next'], ['dbg-stepin', 'stepIn'],
    ['dbg-stepout', 'stepOut']].forEach(([id, key]) => {
    const btn = $(id);
    if (!btn) return;
    btn.onclick = () => {
      const cmds = dbgCmdSet();
      if (!cmds || !DEBUG.active) { setStatus('err', '还没进入调试'); return; }
      termSend(cmds[key]);
      setStatus('idle', '已发送：' + cmds[key]);
      /* ★ 变量面板开着 → **过一会儿自动刷新** ✓✓（2026-10-11）——
         用户：「多多检查和优化」✓。
         ⚠️ 为什么要做 ✗：调试时「单步 → 看变量 → 单步 → 看变量」是**最高频的循环** ✓，
            每次都要手点「↻ 刷新」很烦 ✓。
         ⚠️ 为什么要**延迟** ✗：命令刚发出去 ✓，调试器还没处理完、
            还没打印新位置 ✓（实测 1.2 秒够 ✓）。
         ⚠️ 为什么挂在**这几个按钮**上 ✗：`termSend` 到处都是 ✓，
            挂在这里**语义最清楚**（就是「调试动作之后」✓），
            而且**面板没开时不会发多余命令** ✓（不污染终端 ✓）。 */
      if (VAR_PANEL_REFRESH) setTimeout(() => { try { VAR_PANEL_REFRESH(); } catch (_) {} }, 1200);
    };
  });
  if ($('dbg-vars')) $('dbg-vars').onclick = () => {
    if (!DEBUG.active) { setStatus('err', '还没进入调试'); return; }
    openVarPanel();
  };
  if ($('dbg-stop')) $('dbg-stop').onclick = stopDebug;
  if ($('btn-debug')) $('btn-debug').onclick = () => startDebug();
});

/* ★ 从终端输出里认出「停在哪一行」✓✓ ——
   ⚠️ 这是**解析文本** ✗（最脆的一环 ✓）：
      Octave 是 `stopped in t at line 3 [/path/t.m]` ✓、
      pdb 是 `> /path/x.py(12)main()` ✓、gdb 是 `Breakpoint 1, main () at t.c:5` ✓。
      所以按语言分别匹配 ✓，**匹配不到就不动高亮** ✓
      （宁可不高亮，也别高亮错行 ✓）。
   ⚠️ 匹配到之后**同时**做两件事 ✗：① 高亮那一行 ✓ ② 记下 lastLine ✓。 */
/* ★ 调试输出缓冲 ✓✓（2026-10-10）—— 「变量」面板要从这里解析 ✓
   ⚠️ 为什么要缓冲 ✗：终端是**流式**的 ✓，xterm 只负责**显示** ✓；
      要「把 `whos` / `p locals()` 的输出变成表格」✓，
      必须**自己留一份文本** ✓（xterm 的 buffer 能读 ✓，但按行取很难对齐 ✓）。
   ⚠️ 只留最近 400 行 ✗ —— 调试输出可能很长 ✓（死循环里刷几万行 ✓），
      无上限会吃内存 ✓。 */
const DEBUG_OUT = { lines: [] };
function pushDebugOut(chunk) {
  try {
    const t = String(chunk == null ? '' : chunk);
    if (!t) return;
    /* ⚠️⚠️ 先**剥掉 ANSI 转义** ✗✗（2026-10-10 实测修）——
       终端里混着 `\x1b[?2004l`（关闭 bracketed paste ✓）、`\x1b[C`（光标右移 ✓）
       这类控制序列 ✓ → 不剥的话**会混进变量名** ✓
       （实测：名字变成 `\u001b[?2004lA` ✓，行号也对不上 ✓）。 */
    const clean = t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    for (const raw of clean.split('\n')) DEBUG_OUT.lines.push(raw.replace(/\r/g, ''));
    if (DEBUG_OUT.lines.length > 400) DEBUG_OUT.lines.splice(0, DEBUG_OUT.lines.length - 400);
  } catch (_) {}
}

/* 从缓冲里**从后往前**找第一段符合 pattern 的输出 ✓
   （调试器的回答紧跟在命令之后 ✓，所以从尾部找最快也最准 ✓） */
function debugOutTail(count) {
  return DEBUG_OUT.lines.slice(-(count || 40)).join('\n');
}

/* ★★ 变量面板 ✓✓（2026-10-10）—— 用户选了「A. 变量面板」✓
   ⚠️ 为什么值得做 ✗：`who` / `p locals()` 的输出在变量多的时候**真的看不清** ✓
      （用户例子里已经 7 个 ✓，实际项目里几十个 ✓）。
   ⚠️ 三种调试器的格式**完全不同** ✗✓，所以**解析必须分语言** ✓：
      · Octave/MATLAB `whos` → 带表头的**列对齐**文本 ✓（按列宽切 ✓）
      · pdb `p locals()`     → Python **dict repr** ✓（正则配对 ✓）
      · gdb `info locals`    → `name = value` 一行一个 ✓（最简单 ✓）
   ⚠️ 解析**失败就原样显示** ✗ —— 别为了好看把内容吞掉 ✓
      （用户至少还能看到原文 ✓，也能据此告诉我「格式变了」✓）。 */
function parseVars(lang, text) {
  const rows = [];
  const lines = String(text || '').split('\n');
  if (/^(matlab|octave)$/.test(lang)) {
    /* ★ 新版 Octave 命令也输出 `\x1f` 四段 ✓（2026-10-10）—— **先试它** ✓ */
    const usRows = lines.filter((l) => l.indexOf('\x1f') >= 0);
    if (usRows.length) {
      for (const l of usRows) {
        const p = l.split('\x1f');
        if (p[0]) rows.push({ name: p[0], value: p[1] || '', size: p[2] || '', type: p[3] || '' });
      }
      return rows;
    }
    /* ── 兜底：老格式（`whos` 的表 ✓）——
       万一新命令失败（比如某个变量让 `eval` 抛了 ✓），面板还能显示名字 / 大小 / 类型 ✓。
       ⚠️ 注意：这条路上**没有值** ✓（`whos` 本来就不给 ✓）。 */
    let head = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(\S+\s+)?Name\s+Size\s+Bytes\s+Class\s*$/.test(lines[i])) { head = i; break; }
    }
    if (head >= 0) {
      const H = lines[head];
      const iName = H.indexOf('Name'), iSize = H.indexOf('Size'), iBytes = H.indexOf('Bytes'), iClass = H.indexOf('Class');
      for (let i = head + 2; i < lines.length; i++) {   /* head+1 是 ==== 那行 ✓ */
        const l = lines[i];
        if (!l.trim() || /^\s*====/.test(l)) continue;
        if (/^\s*(debug>|\(|error)/.test(l)) break;      /* 到提示符就结束 ✓ */
        /* ⚠️ 到汇总行也**必须停** ✗✓ —— 实测 `Total is 7 elements using 42 bytes`
           会被当成一个变量 ✓（名字变成 `7 elements u` ✓）。 */
        if (/^Total is\b/i.test(l.trim()) || /^variables in scope/i.test(l.trim())) break;
        const name = l.slice(iName, iSize).trim();
        if (!name) continue;
        rows.push({ name, size: l.slice(iSize, iBytes).trim(), type: l.slice(iClass).trim(), value: '' });
      }
    }
  } else if (lang === 'python') {
    /* ⚠️ Python 用 `\x1f` 分隔**四段** ✗✓：名字 \x1f 值 \x1f 类型 \x1f 长度 ✓
       ⚠️ **按 `\x1f` 切，不按空格 / 逗号** ✗ —— 值里本来就有它们 ✓
          （`[0, 1, 4, 9, 16, 25]` ✓）。
       ⚠️ **兼容没有 `\x1f` 的行** ✗：比如用户手敲过旧命令、或以后命令改了 ✓，
          退回「name = value」解析 ✓ —— **别让整张表空掉** ✓。 */
    for (const l of lines) {
      if (l.indexOf('\x1f') >= 0) {
        const p = l.split('\x1f');
        if (p[0] && !/^__/.test(p[0])) {
          rows.push({ name: p[0], value: p[1] || '', type: p[2] || '', size: p[3] || '' });
        }
      } else {
        const m = /^\s*([A-Za-z_][\w.]*)\s*=\s*(.+)$/.exec(l);
        if (m && !/^__/.test(m[1])) rows.push({ name: m[1], size: '', type: '', value: m[2].trim() });
      }
    }
  } else {
    /* gdb：`info locals` 是 `name = value` ✓ */
    for (const l of lines) {
      const m = /^\s*([A-Za-z_][\w.]*)\s*=\s*(.+)$/.exec(l);
      if (m) rows.push({ name: m[1], size: '', type: '', value: m[2].trim() });
    }
  }
  return rows;
}

/* 每种语言「问变量」用哪条命令 ✓
   ⚠️⚠️ Python 不能用 `p locals()` ✗✗（实测踩到两次 ✓）：
      ① 它会把 **`__builtins__`** 整个打出来 ✓（几百个内置名 ✓）→ 面板被淹没 ✓；
      ② 就算过滤了 ✓，**dict repr 里的嵌套逗号**会把值切碎 ✓
         （`'arr': '[1, 2, 3]'` 被切成 `'[1` ✓，实测就是这样 ✓）。
      → 改成**一行一个变量** ✓：用 `'\n'.join(...)` + `repr` ✓，
        解析就退化成最简单的 `name = value` ✓（和 gdb 那套共用 ✓）。
   ⚠️ Octave 用 `whos` 而不是 `who` ✗ ——
      `who` 只给**名字** ✓，`whos` 给 **Name / Size / Bytes / Class** ✓，
      正好是面板要的四列 ✓。 */
const VARS_CMD = {
  /* ⚠️⚠️ Octave/MATLAB 的 `whos` **不给值** ✗✗（用户实测：「变量怎么没有数值」✓）——
     `whos` 只给 Name / Size / Bytes / Class ✓，所以「值」那列**永远是空的** ✓。
     → 换成**自己遍历 + `mat2str`** ✓：一行一个变量 ✓，四段用 `\x1f` 隔开 ✓
       （**和 Python 那边同一套** ✓，解析器也共用 ✓）。
     ⚠️ `eval` 每个变量要**包 try** ✗ —— function_handle / 大对象可能报错 ✓，
        报错就写「<无法显示>」✓，**不能因为一个变量挂了整张表** ✓。
     ⚠️ 值**截断到 120 字符** ✗ —— 一个 1000×1000 矩阵 mat2str 出来几 MB ✓，
        会把终端和面板都卡死 ✓。
     ⚠️ 末尾**清掉自己的临时变量** ✗ —— 否则 `_v` / `_i` / `_n` / `_e` / `_s`
        会出现在**下一次**的变量表里 ✓。
     ⚠️⚠️ 换行和分隔符**必须用 `char(10)` / `char(31)`** ✗✗（实测踩到 ✓）——
        **Octave 的双引号字符串「不处理转义」** ✓：`"\n"` 就是**反斜杠 + n 两个字符** ✓
        （单引号才处理 ✓）→ 输出全挤在一行 ✓，面板只解析出 1 个变量 ✓。
        用 `char()` 最**无歧义** ✓，也不依赖单双引号的差异 ✓。
     ⚠️⚠️ **MATLAB 和 Octave 必须用同一条命令** ✗✗（2026-10-10 实测又踩到 ✓）——
        我原来只给 `octave` 换了新命令 ✓，`matlab` 还留着 `whos` ✓ →
        而**用户那个片段的语言标签正是 `matlab`** ✓ →
        `VARS_CMD['matlab']` = `whos` ✓ → **值那列永远是空的** ✓✓
        （用户截图里就是这样 ✓，我一开始还以为是解析问题 ✓）。
        这条命令是**纯 MATLAB 语法** ✓（`mat2str` / `ischar` / `strrep` / `class` / `char` ✓）
        → **两边都能跑** ✓，不需要分两份 ✓。 */
  matlab: 'cs_vars',
  octave: 'cs_vars',
  /* ⚠️⚠️ 用 `print(...)` 而不是 `p ...` ✗✗（2026-10-10 实测修）——
     `p` 是**求值并显示结果** ✓，**字符串结果会带引号**打出来 ✓ →
     面板拿到的第一行是 `'a = 3'` ✓（**开头一个单引号** ✓）→ 解析器认不出 ✓
     （用户截图里正是这个 ✓）。
     `print` 才是「**按原样输出**」✓ —— 这才是我们要的 ✓。
     ⚠️ 顺带：`print` 在 pdb 里也是合法命令 ✓（它就是普通 Python 语句 ✓）。 */
  /* ⚠️ 用户问「**没有大小、类型吗**」✗✓（2026-10-10）——
     Python **是有类型的** ✓（int / list / module / function … ✓），
     容器也**有长度** ✓ —— 只是我第一版没让 pdb 把它们打出来 ✓。
     → 现在拼四段 ✓：**名字 \x1f 值 \x1f 类型 \x1f 长度** ✓。
     ⚠️ 为什么用 `\x1f`（ASCII 单元分隔符）当分隔符 ✗：
        **值里本来就有逗号和空格** ✓（`[0, 1, 4, 9, 16, 25]` ✓）——
        拿它们当分隔符**必然切错** ✓（这个坑今天在 dict repr 上已经踩过一次 ✓）。
        `\x1f` 是专门干这个的 ✓，正常值里不会出现 ✓。 */
  python: "print('\\n'.join(k + '\\x1f' + repr(v) + '\\x1f' + type(v).__name__ + '\\x1f' + (str(len(v)) if hasattr(v, '__len__') else '') for k, v in locals().items() if not k.startswith('__')))",
  c: 'info locals', c_cpp: 'info locals',
};

/* ★ 变量「**定义在哪一行**」✓✓（2026-10-10）—— 用户要「变量所在的行号」✓
   ⚠️ 调试器**给不了**这个 ✗（Python 不记录赋值位置 ✓，Octave 的 whos / gdb 的 info locals 也没有 ✓）——
      所以这里**不看调试器，看源码** ✓：
      **静态扫一遍当前片段的代码** ✓，找每个变量**第一次被赋值 / 定义**的那一行 ✓。
   ⚠️ 是**近似**，不是精确 ✗：只看「名字出现在赋值左侧 / for / def / import」✓；
      同名变量在多个分支里赋值时只给**第一次** ✓（够用 ✓，而且**比没有强得多** ✓）。
   ⚠️ **找不到就留空** ✗（**不猜** ✓）—— 比如内置名、调试器临时变量 ✓。
   ⚠️ 三种语言的赋值写法不同 ✗，所以按语言分开匹配 ✓。 */
function findVarLines(code, lang) {
  const map = new Map();
  const set = (name, ln) => { if (name && !map.has(name)) map.set(name, ln); };
  String(code || '').split('\n').forEach((raw, i) => {
    const ln = i + 1;
    /* 去掉行尾注释 ✓（`a = 3  # 说明` 不该被注释干扰 ✓）——
       ⚠️ 别去 `#` 前面的内容 ✗：Python 里 `#` 是注释 ✓，但 C 里 `#` 是预处理 ✓，
          所以只在 Python / MATLAB 下按 `#` 切 ✓。 */
    const l = (lang === 'python' || lang === 'matlab' || lang === 'octave')
      ? raw.replace(/#.*$/, '') : raw.replace(/\/\/.*$/, '');
    let m;
    if (lang === 'python') {
      if ((m = /^\s*([A-Za-z_]\w*)\s*(?:,\s*[A-Za-z_]\w*\s*)*=(?!=)/.exec(l))) set(m[1], ln);
      if ((m = /^\s*for\s+([A-Za-z_]\w*)/.exec(l))) set(m[1], ln);
      if ((m = /^\s*def\s+([A-Za-z_]\w*)/.exec(l))) set(m[1], ln);
      if ((m = /^\s*import\s+([A-Za-z_]\w*)/.exec(l))) set(m[1], ln);
      if ((m = /^\s*from\s+\S+\s+import\s+([A-Za-z_]\w*)/.exec(l))) set(m[1], ln);
      if ((m = /^\s*class\s+([A-Za-z_]\w*)/.exec(l))) set(m[1], ln);
    } else if (lang === 'matlab' || lang === 'octave') {
      if ((m = /^\s*([A-Za-z_]\w*)\s*=\s*/.exec(l))) set(m[1], ln);
      if ((m = /^\s*function\s+.*?([A-Za-z_]\w*)\s*\(/.exec(l))) set(m[1], ln);
    } else {
      if ((m = /^\s*(?:[\w:*&<>]+\s+)+([A-Za-z_]\w*)\s*(?:=|;|\[)/.exec(l))) set(m[1], ln);
      /* ⚠️ **函数定义**也要认 ✗✓（实测漏了 ✓）——
         `int main(void) {` 里 `main` 后面只有 `(` ✓，没有 `=` / `;` / `[` ✓，
         所以上面那条匹配不到 ✓。 */
      if ((m = /^\s*[\w:*&<>]+\s+([A-Za-z_]\w*)\s*\(/.exec(l))) set(m[1], ln);
    }
  });
  return map;
}

/* ★ 类型标签的配色 ✓✓（2026-10-10）—— 扫一眼就能分辨 ✓
   ⚠️ 按**语义分类**而不是按语言 ✗ —— 三种语言的类型名不一样 ✓
      （Python 是 `list` / Octave 是 `double` / C 是 `int` ✓），
      但**用户看到的东西**是一类：数字 / 字符串 / 序列 / 函数 / 模块 ✓。
   ⚠️ 认不出就**用默认灰** ✓（别乱上色 ✓）。 */
function typeClass(t) {
  const s = String(t || '').toLowerCase();
  if (/^(int|float|double|complex|bool|long|short|char|uint|size_t|number|decimal)/.test(s)) return 't-num';
  if (/^(str|string|char|bytes|text)/.test(s)) return 't-str';
  if (/^(list|tuple|dict|set|array|ndarray|vector|matrix|struct|cell|map)/.test(s)) return 't-seq';
  /* ⚠️ `module` 必须排在 `t-fn` **前面** ✗✓（2026-10-10）——
     不然 `module` 会被 `t-fn` 抢走 ✓（两条规则都含它 ✓，**先匹配的赢** ✓），
     颜色就不是我想要的青色了 ✓。 */
  if (/^(module|package)/.test(s)) return 't-mod';
  if (/^(function|builtin|method|function_handle|lambda|type|class)/.test(s)) return 't-fn';
  return '';
}

/* ★ 列宽可以拖 ✓✓（2026-10-10）—— 用户：「这种变量面板，表格，之间需要可以自由拖动」✓
   ⚠️ 实现要点 ✗：表用了 `table-layout: fixed` ✓ →
      改列宽必须改 **`<col>` 的 width** ✓（改 `th` 的**没用** ✓，这个坑刚踩过 ✓）。
   ⚠️ 拖拽用 **pointer 事件 + `setPointerCapture`** ✗（和拖窗口 / 缩放面板同一套 ✓）——
      不然鼠标一移出表头，拖动就断了 ✓。
   ⚠️ 最窄 **36px** ✗ —— 拖到 0 列就消失了 ✓，用户会以为坏了 ✓。
   ⚠️ 列宽**记住** ✗（localStorage ✓，按「有哪些列」当键 ✓）——
      用户调一次就够了 ✓；列的组合变了（比如 Octave 有 5 列、Python 有 4 列）就各自记 ✓。 */
function makeColsResizable(tbl, key) {
  try {
    const cols = [...tbl.querySelectorAll('colgroup > col')];
    const ths = [...tbl.querySelectorAll('thead > tr > th')];
    if (!cols.length || cols.length !== ths.length) return;
    /* 恢复上次的列宽 ✓ */
    try {
      const saved = JSON.parse(localStorage.getItem('cs.varcols.' + key) || 'null');
      if (Array.isArray(saved) && saved.length === cols.length) {
        saved.forEach((w, i) => { if (w > 30) cols[i].style.width = w + 'px'; });
      }
    } catch (_) {}
    const saveCols = () => {
      try {
        localStorage.setItem('cs.varcols.' + key, JSON.stringify(cols.map((c) => Math.round(c.getBoundingClientRect().width))));
      } catch (_) {}
    };
    ths.forEach((th, i) => {
      /* ⚠️⚠️ 把手**不能做成 `th` 的子元素** ✗✗（2026-10-10 实测修）——
         原来在 `th` 里插一个 `position:absolute` 的 div ✓，
         但实测 `elementFromPoint(把手中心)` 返回的是 **`TH`** ✗ →
         **把手根本收不到 pointerdown** ✓ → 拖动**完全没反应** ✓
         （量了宽度：拖前拖后一模一样 ✓，五个把手位置都对 ✓，就是不动 ✓）。
         ⚠️ 真因 ✗：`th` 自己 `position: relative` ✓ 且带 `z-index` ✓ →
            **子元素的 z-index 压不过父元素本身** ✓（同一个层叠上下文 ✓）。
         → 改成**直接在 `th` 上判断** ✓：
            `pointerdown` 时看 `e.clientX` 是否落在**右边缘 8px** 内 ✓，
            是就当成「拖列宽」✓；不是就**直接放行** ✓
            （让表头以后可能有的点击 / 排序照常 ✓）。 */
      th.classList.add('var-th-grip');
      th.addEventListener('pointerdown', (e) => {
        const box = th.getBoundingClientRect();
        if (box.right - e.clientX > 8) return;
        e.preventDefault(); e.stopPropagation();
        const sx = e.clientX;
        /* ⚠️⚠️ 开拖之前，先把**所有列都钉成当前像素宽** ✗✗（2026-10-10 实测修）——
           原来只有**被拖的那一列**是 px ✓，别的列还是 `15%` / `auto` ✓ →
           拖「值」（它 `auto` ✓）让它变宽时 ✓，**浏览器会拿 `15%` 的名字列开刀** ✓
           （实测：名字 93 → 23 ✓，几乎看不见了 ✓）。
           → 先把每一列都转成 px ✓，拖动时**只有目标列变** ✓，
             **别的列纹丝不动** ✓（这才是「拖列宽」该有的手感 ✓）。 */
        const start = cols.map((c) => c.getBoundingClientRect().width);
        start.forEach((w0, k) => { cols[k].style.width = Math.round(w0) + 'px'; });
        th.classList.add('dragging');
        try { th.setPointerCapture(e.pointerId); } catch (_) {}
        const move = (ev) => {
          const d = ev.clientX - sx;
          cols[i].style.width = Math.max(36, Math.round(start[i] + d)) + 'px';
        };
        const up = () => {
          th.removeEventListener('pointermove', move);
          th.removeEventListener('pointerup', up);
          th.classList.remove('dragging');
          saveCols();
        };
        th.addEventListener('pointermove', move);
        th.addEventListener('pointerup', up);
      });
    });
  } catch (_) {}
}

/* ★ 变量面板的「刷新」入口 ✓✓（2026-10-11）——
   面板开着时记下来 ✓，调试动作之后**自动刷新** ✓；关掉时清空 ✓。
   ⚠️ 为什么用模块级变量 ✗：面板是**动态创建**的 ✓，
      而单步按钮在别处 ✓，那里拿不到面板内部的 `doRefresh` ✓。 */
let VAR_PANEL_REFRESH = null;

function openVarPanel() {
  try {
    const old = document.getElementById('var-panel');
    if (old) old.remove();
    const win = document.createElement('div');
    win.id = 'var-panel';
    const bar = document.createElement('div');
    bar.className = 'var-bar';
    bar.innerHTML = '<b>👁 变量</b>';
    /* ★ 标题栏显示「**当前停在哪**」✓✓（2026-10-10）——
       用户要「位置，**所在位置行号**」✓。
       ⚠️ 放**标题栏**而不是表格的一列 ✗ ——
          因为它描述的是**整个调试会话**（「现在停在哪」✓），
          不是某个变量的属性 ✓（变量没有「位置」这个属性 ✓，见 scanDebugOutput 的说明 ✓）。 */
    const posEl = document.createElement('span');
    posEl.className = 'var-pos';
    posEl.textContent = DEBUG.pos || (DEBUG.lastLine ? ('第 ' + DEBUG.lastLine + ' 行') : '');
    posEl.title = posEl.textContent || '';
    bar.appendChild(posEl);
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '点「刷新」重新读一次';
    bar.appendChild(hint);
    const close = document.createElement('button');
    close.textContent = '✕'; close.title = '关闭';
    const refresh = document.createElement('button');
    refresh.textContent = '↻ 刷新';
    /* ★ 一键靠右 ✓✓（2026-10-10）—— 用户：「解决**又被遮挡**问题」✓
       ⚠️ 为什么需要它 ✗：浮窗**天生会挡内容** ✓ ——
          与其猜「放哪儿不挡」✓，不如给一个**一键挪开**的出口 ✓；
          而且挪完会**记住** ✓（下次打开就在右边 ✓，**不会再挡** ✓）。 */
    const snap = document.createElement('button');
    snap.textContent = '⇥ 靠右';
    snap.title = '贴到窗口右边（会记住，下次不再挡代码）';
    snap.onclick = () => {
      const w0 = win.offsetWidth;
      win.style.left = Math.max(12, Math.round(window.innerWidth - w0 - 22)) + 'px';
      win.style.top = '72px';
      saveBox();
    };
    bar.appendChild(snap);
    bar.appendChild(refresh);
    bar.appendChild(close);
    const body = document.createElement('div');
    body.className = 'var-body';
    body.innerHTML = '<div class="var-empty">正在读取…</div>';
    /* ★ 右下角缩放把手 ✓✓（2026-10-10）—— 用户：「**无法自由拖动大小**」✓
       和图片浮窗（.img-popup-rs）/ 代码向导（.cg-rs）**同一套** ✓ ——
       同一个应用里别有两套拖窗手感 ✓。 */
    const rs = document.createElement('div');
    rs.className = 'var-rs';
    win.appendChild(bar); win.appendChild(body); win.appendChild(rs);
    /* ⚠️ 记住上次的**位置和大小** ✓（用户调过一次之后不用每次再调 ✓）——
       和图片浮窗那边是同一个做法 ✓。 */
    const saveBox = () => {
      try {
        localStorage.setItem('cs.varpanel', JSON.stringify({
          w: win.offsetWidth, h: win.offsetHeight, l: win.offsetLeft, t: win.offsetTop,
        }));
      } catch (_) {}
    };
    /* ★ 默认位置：**贴右边** ✓✓（2026-10-10）—— 用户：「解决**又被遮挡**问题」✓
       ⚠️ 原来是 `left: 60px; top: 90px` ✗ —— **正盖在代码中间** ✓
          （用户截图里它挡住了第 4~27 行 ✓）。
       ⚠️ 为什么默认放右边 ✗：代码**从左上开始写** ✓，
          **右下角最不容易挡到内容** ✓；
          而且用户**拖动后会记住** ✓（下次就在他自己放的地方 ✓）。
       ⚠️ 宽度也别用死值 ✗：**窗口窄的时候 640px 会占掉大半个屏** ✓
          → 用 `min(640px, 44vw)` ✓。 */
    try {
      const saved = JSON.parse(localStorage.getItem('cs.varpanel') || 'null');
      if (saved && saved.w) win.style.width = Math.max(360, saved.w) + 'px';
      else win.style.width = 'min(640px, 44vw)';
      if (saved && saved.h) win.style.height = Math.max(160, saved.h) + 'px';
      if (saved && saved.l != null) {
        win.style.left = saved.l + 'px';
        win.style.top = saved.t + 'px';
      } else {
        /* 先量一下宽度再算 left ✓（否则 offsetWidth 还是 0 ✓） */
        const w0 = win.getBoundingClientRect().width || 640;
        win.style.left = Math.max(12, Math.round(window.innerWidth - w0 - 22)) + 'px';
        win.style.top = '72px';
      }
    } catch (_) {}
    rs.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, sw = win.offsetWidth, sh = win.offsetHeight;
      rs.setPointerCapture(e.pointerId);
      const move = (ev) => {
        win.style.width = Math.max(360, sw + ev.clientX - sx) + 'px';
        win.style.height = Math.max(160, sh + ev.clientY - sy) + 'px';
      };
      const up = () => {
        rs.removeEventListener('pointermove', move); rs.removeEventListener('pointerup', up);
        saveBox();
      };
      rs.addEventListener('pointermove', move); rs.addEventListener('pointerup', up);
    });
    /* ⚠️ 用 `let` 而不是 `const` ✗✓（2026-10-11）——
       下面要把它**包一层** ✓：关面板时顺手清掉「自动刷新」的引用 ✓
       （不清的话，面板关掉后单步还会去动已移除的节点 ✓）。 */
    let shut = () => { win.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') shut(); };
    close.onclick = shut;
    document.addEventListener('keydown', onKey);
    /* 拖动（和图片浮窗 / 代码向导 / 图形编辑器同一套 ✓） */
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const sx = e.clientX, sy = e.clientY, sl = win.offsetLeft, st = win.offsetTop;
      const move = (ev) => { win.style.left = Math.max(0, sl + ev.clientX - sx) + 'px'; win.style.top = Math.max(0, st + ev.clientY - sy) + 'px'; };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); saveBox(); };
      bar.setPointerCapture(e.pointerId);
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
    });
    async function doRefresh() {
      const lang = String(DEBUG.lang || '').toLowerCase();
      const cmd = VARS_CMD[lang];
      if (!DEBUG.active || !cmd) { body.innerHTML = '<div class="var-empty">还没进入调试</div>'; return; }
      body.innerHTML = '<div class="var-empty">正在读取…</div>';
      DEBUG_OUT.lines.length = 0;              /* 清空缓冲 ✓，免得读到上一次的 ✓ */
      /* ⚠️⚠️ **不要 `await termSend(cmd)`** ✗✗（2026-10-11 实测修）——
         `termSend` 返回的是 `fetch(...)` 的 Promise ✓，
         **请求挂住时它永远不 resolve** ✓ →
         后面的等待代码**永远执行不到** ✓ → 面板**卡在「正在读取…」** ✓✓
         （实测就是这样：面板 body 永远是「正在读取…」✓）。
         → **发出去就行** ✓，用**定时等待**控制节奏 ✓（这才是本来的意图 ✓）。 */
      termSend(cmd);
      await new Promise((r) => setTimeout(r, 1400));
      const raw = debugOutTail(60);
      const rows = parseVars(lang, raw);
      if (!rows.length) {
        body.innerHTML = '<div class="var-empty">没能解析出变量（原文如下）</div>';
        const pre = document.createElement('pre');
        pre.className = 'var-raw';
        pre.textContent = raw.trim();
        body.appendChild(pre);
        return;
      }
      /* ★ 列**按需显示** ✓✓（2026-10-10）—— 用户反馈「排布美化，优化」✓
         ⚠️ Python / gdb **没有** size / type ✗（那两列全空 ✓）——
            硬撑着显示只会把「值」挤窄 ✓（用户截图里表头「大小/类型」都竖排换行了 ✓）。
         → **哪一列全空就不显示** ✓（Octave 四列 ✓，Python/gdb 两列 ✓）。 */
      const hasSize = rows.some((r) => r.size);
      const hasType = rows.some((r) => r.type);
      /* ★ 「行」列：**变量定义在源码的第几行** ✓✓（2026-10-10）——
         用户要「变量所在的行号」✓。**静态扫源码**得到 ✓（见 findVarLines 的说明 ✓）。
         ⚠️ **有数据才显示这一列** ✗ —— 一个都没找到时别留个空列 ✓。 */
      const curFrag = (CURRENT && CURRENT.fragments[CINDEX]) || {};
      const lineMap = findVarLines(curFrag.code, String(DEBUG.lang || '').toLowerCase());
      const hasLine = rows.some((r) => lineMap.has(r.name));
      const cols = [];
      if (hasLine) cols.push(['行', 'line']);
      cols.push(['名字', 'name'], ['值', 'value']);
      if (hasSize) cols.push(['大小', 'size']);
      if (hasType) cols.push(['类型', 'type']);
      const tbl = document.createElement('table');
      tbl.className = 'var-table' + (cols.length > 2 ? ' wide' : '');
      /* ⚠️⚠️ `table-layout: fixed` 下，列宽**必须写在第一行 / colgroup** ✗✗（实测踩到 ✓）——
         我原来把 width 写在 `td` 上 ✓ → **完全不生效** ✓ →
         五列被**平均分成 124px** ✓（= 640/5 ✓，值列一点没变宽 ✓）。
         → 用 **`<colgroup>`** ✓：**一处定义、整表生效** ✓，也最干净 ✓。 */
      const colW = { line: '34px', name: '15%', value: 'auto', size: '44px', type: '84px' };
      tbl.innerHTML = '<colgroup>' + cols.map(([, k]) => '<col style="width:' + (colW[k] || 'auto') + '">').join('') + '</colgroup>'
        + '<thead><tr>' + cols.map(([h]) => '<th>' + h + '</th>').join('') + '</tr></thead>';
      const tb = document.createElement('tbody');
      for (const r of rows) {
        const tr = document.createElement('tr');
        for (const [, key] of cols) {
          const td = document.createElement('td');
          /* 「行」列特殊 ✓：做成**小胶囊** ✓，点它**跳到编辑器里那一行** ✓ */
          if (key === 'line') {
            const ln = lineMap.get(r.name);
            td.className = 'var-line';
            if (ln) {
              const sp = document.createElement('span');
              sp.textContent = String(ln);
              sp.title = '跳到第 ' + ln + ' 行';
              sp.onclick = () => {
                try {
                  MONACO_EDITOR.revealLineInCenter(ln);
                  MONACO_EDITOR.setPosition({ lineNumber: ln, column: 1 });
                  MONACO_EDITOR.focus();
                } catch (_) {}
              };
              td.appendChild(sp);
            }
            tr.appendChild(td);
            continue;
          }
          const raw = String(r[key] || '');
          td.className = 'var-' + key;
          /* 「类型」做成**彩色小标签** ✓（扫一眼就能分辨数字 / 字符串 / 序列 / 函数 / 模块 ✓） */
          if (key === 'type' && raw) {
            const sp = document.createElement('span');
            sp.textContent = raw;
            sp.className = typeClass(raw);
            td.appendChild(sp);
            tr.appendChild(td);
            continue;
          }
          td.textContent = raw;
          /* ★ 值可以**点一下复制** ✓✓（2026-10-11）—— 用户：「多多检查和优化」✓
             ⚠️ 为什么要做 ✗：调试时经常要把值**贴到别处** ✓
                （去搜索、去对比、写进笔记 ✓）—— 手动拖选一长串很容易选漏 ✓。
             ⚠️ 长值**显示是截断的** ✓，但**复制的是完整值** ✗ ——
                这才是用户要的（**看到的是缩略，拿到的是全的** ✓）。
             ⚠️ `navigator.clipboard` 是**异步而且可能被拒** ✗（非安全上下文 / 无权限 ✓）→
                兜底用 `execCommand('copy')` ✓；两条都不行就**明说复制失败** ✓
                （别假装成功 ✓，用户会以为复制到了、粘出来是空的 ✓）。 */
          if (key === 'value' && raw) {
            td.title = raw.length > 40 ? raw : '点一下复制';
            td.classList.add('var-copyable');
            td.onclick = () => {
              const full = String(r.value || '');
              const done = () => setStatus('ok', '已复制：' + (full.length > 40 ? full.slice(0, 40) + '…' : full));
              const fail = () => setStatus('err', '复制失败（浏览器不允许）—— 可以手动选中复制');
              const legacy = () => {
                try {
                  const ta = document.createElement('textarea');
                  ta.value = full;
                  ta.style.position = 'fixed';
                  ta.style.opacity = '0';
                  document.body.appendChild(ta);
                  ta.select();
                  const ok = document.execCommand('copy');
                  ta.remove();
                  ok ? done() : fail();
                } catch (_) { fail(); }
              };
              try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(full).then(done).catch(legacy);
                } else { legacy(); }
              } catch (_) { legacy(); }
            };
          }
          if (key === 'value' && raw.length > 90) td.textContent = raw.slice(0, 90) + '…';
          if (raw.length > 40) td.title = raw;
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      /* ★ 列宽可拖 ✓✓（2026-10-10）—— 用户：「表格之间需要可以自由拖动」✓
         ⚠️ 键用**列的组合** ✗（`line-name-value-size-type` ✓）——
            三条线的列数不一样 ✓（Octave 5 列 / Python 4 列 ✓），
            用同一个键会把彼此的列宽**串掉** ✓。 */
      makeColsResizable(tbl, cols.map(([, k]) => k).join('-'));
      body.innerHTML = '';
      body.appendChild(tbl);
      body.insertAdjacentHTML('beforeend', '<div class="var-count">共 ' + rows.length + ' 个变量</div>');
    }
    refresh.onclick = doRefresh;
    document.body.appendChild(win);
    VAR_PANEL_REFRESH = doRefresh;
    const origShut = shut;
    shut = () => { VAR_PANEL_REFRESH = null; origShut(); };
    close.onclick = shut;
    /* ⚠️⚠️ 这行**不能少** ✗✗（2026-10-11 实测踩到）——
       我上一处编辑把它删了 ✓ → 面板**永远停在「正在读取…」** ✓
       （因为 `doRefresh` 只在点「↻ 刷新」时才跑 ✓）。
       教训：**改「创建面板」的代码时，别忘了它最后还要**自己跑一次** ✓。 */
    doRefresh();
  } catch (_) {}
}

function scanDebugOutput(text) {
  if (!DEBUG.active || !text) return;
  const s = String(text);
  let line = 0;
  if (/^(matlab|octave)$/.test(DEBUG.lang)) {
    const m = /at line\s+(\d+)/i.exec(s);
    if (m) line = Number(m[1]);
  } else if (DEBUG.lang === 'python') {
    const m = /\((\d+)\)/.exec(s);
    if (m) line = Number(m[1]);
  } else {
    const m = /at\s+[\w./\\-]+:(\d+)/.exec(s) || /:(\d+)$/m.exec(s);
    if (m) line = Number(m[1]);
  }
  if (line && line !== DEBUG.lastLine) {
    DEBUG.lastLine = line;
    setDebugLine(line);
    /* ★ 顺手记下「停在哪」的**原始描述** ✓✓（2026-10-10）——
       用户要「**位置，所在位置行号**」✓。
       ⚠️ 「每个变量定义在哪一行」**三种调试器都给不了** ✗：
          Python 不记录赋值位置 ✓，Octave 的 whos 也没有 ✓，gdb 的 info locals 也没有 ✓。
       ✅ 但**「调试器当前停在哪」能拿到** ✓ —— 而且这才是调试时最常看的 ✓。
       ⚠️ 保留**原文**（`stopped in main at line 3 [/path/main.m]` ✓）而不是只留数字 ✗ ——
          文件名 / 函数名都在里面 ✓，光有行号用户不知道是哪个文件 ✓。 */
    try {
      const m = /(stopped in .+|>\s+\S+\(\d+\).*|Breakpoint \d+.*)/.exec(s);
      if (m) DEBUG.pos = m[1].trim().slice(0, 160);
      else DEBUG.pos = 'line ' + line;
    } catch (_) {}
    /* ⚠️ 位置变了要**刷新调试条** ✗（它上面就显示着行号 ✓），
       不然调试条会一直停在旧行号上 ✓。 */
    try { showDbgBar(DEBUG.active); } catch (_) {}
  }
}