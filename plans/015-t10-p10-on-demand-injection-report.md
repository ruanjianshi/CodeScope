# T-10（子系统按需注入）+ P-10（首屏 stagger 补到 12 项）· 执行报告

> 执行日期：2026-11 ｜ 执行范围：`masscode-runner/`
> 允许改动面：`index.html`、`assets/motion-batch1.css`、`assets/app.js`（只准净减）
> 实际改动：**`index.html` + `assets/motion-batch1.css` 两个文件**，`app.js` **0 行改动**（净减 0，棘轮 13,000 行代码一分没涨）

---

## 0. 一句话结论

把 **10 个「只在某个视图/浮层打开时才需要」的子系统脚本** 从首屏摘掉、改成幂等按需注入
（+`system-panel` / `study-workspace` / `code-guide` / `app-pdf` / `arch-*`×6），
首屏 **79 → 65 个请求、1328.1 → 1111.9 KB**；
P-10 的「更多能力」第 9~12 项**从没有动画**补成 `320 / 360 / 400 / 440ms` 递增入场，
并补上 `prefers-reduced-motion` 整组无动画兜底。
静态闸门 architecture **91/91**、undefined-refs **0**、smoke **604 passed**、inline-syntax **6/6**，
浏览器全程 **pageerror 0**。

---

## 1. 验收第 1 条：首屏请求数 / 静态传输 · 前后数字

量法：Playwright + 本机 Chrome，`performance.getEntriesByType('resource')` + navigation entry
（`transferSize` 含响应头，服务端 brotli q11），临时 vault + 独立 `CODESCOPE_DATA_HOME` + 端口 4934；
**改前 = `git show HEAD:…` 把两个文件还原成 HEAD 再量**，改后 = 当前工作区，同一台机、同一套夹具、同一次 `load + 3.5s` 静置。

| 指标 | 改前（HEAD） | 改后 | 差 |
| --- | --- | --- | --- |
| 首屏请求数 | **79** | **65** | **−14** |
| 静态传输合计 | **1328.1 KB** | **1111.9 KB** | **−216.2 KB** |
| 其中 JS 请求 | 39 | 29 | −10 |
| 其中 JS 传输 | 1072.3 KB | 853.2 KB | −219.1 KB |
| index.html 自身传输 | 33.2 KB | 37.0 KB | **+3.8 KB**（loader + 注释） |
| `pageerror` | 0 | 0 | — |
| DCL / load（参考，单次有噪声） | 3104 / 3827 ms | 3029 / 3637 ms | −75 / −190 ms |

**消失的 14 个请求逐个可点名（合计 221.2 KB）**

| # | 资源 | KB | 何时才需要 |
| --- | --- | --- | --- |
| 1 | `/assets/system-panel.js` | 81.1 | 点「本机管家」 |
| 2 | `/assets/code-guide.js` | 47.2 | Ctrl/⌘+I 或命令面板 |
| 3 | `/assets/study-workspace.js` | 39.6 | 进「学习工作台」 |
| 4 | `/assets/app-pdf.js` | 26.9 | 打开一份 PDF |
| 5 | `/assets/arch-ai-view.js` | 7.9 | 切到「▦ 架构」 |
| 6 | `/assets/arch-layout.js` | 7.8 | 同上 |
| 7 | `/assets/arch-graph-svg.js` | 2.8 | 同上 |
| 8 | `/assets/arch-view.js` | 2.2 | 同上 |
| 9 | `/assets/arch-zoom.js` | 2.0 | 同上 |
| 10 | `/assets/arch-round.js` | 1.6 | 同上 |
| 11–12 | `/api/study/site-catalog` ×2 | 0.4 + 0.4 | 学习工作台加载时顺带打的 |
| 13 | `/api/study/config` | 0.8 | 同上 |
| 14 | `/api/system-panel/ping` | 0.5 | 本机管家加载时顺带打的 |
|  | **合计** | **221.2** | 10 个脚本 219.1 + 4 个派生接口 2.1 |

> 新增请求 **0 个**。逐 URL 对照（全量 65 / 79 条）只有上表这 14 条消失，没有别的进出。
> 「派生接口」也是真收益：模块不加载，它连带的那几次 API 请求自然不来。

---

## 2. 验收第 2 条：静态闸门 + 运行期错误面

| 闸门 | 结果 |
| --- | --- |
| `node tests/architecture.js` | **架构断言 91/91 项通过** ✅（含 `assets/app.js ≤ 13000 行代码` —— 实测仍 **12999**） |
| `node tests/undefined-refs.js` | **0 处**「引用了但没声明」（扫 18 个脚本）✅ |
| `node tests/syntax.js` | 内联脚本 **6/6 通过**、外链脚本语法 ✓（新加的两段内联脚本也被它编译过）✅ |
| `node tests/smoke.js` | **604 passed** ✅（含 `xterm 必须在 Monaco loader 之前同步注册` 这条硬断言） |
| 浏览器 `pageerror` | **全程 0**（改前 0、改后 0；逐项验证脚本里也是 0）✅ |

⚠️ `console.error` 里确实还有噪声，但 **A/B 证明不是我引入的**：
把两个文件还原成 HEAD 跑**同一套**验证脚本，同样报
`vendor/markmap-view.js` 的 `translate(NaN,NaN)` 和 `assets/pdfjs/pdf_viewer.mjs:129` 的
`offsetParent is not set` —— 两处都在**第三方库内部**，改前改后一模一样，且不升级成 pageerror。

---

## 3. 验收第 3 条：功能回归 · 逐项证据

验证脚本：Playwright 驱动真实 UI（`#welcome-system` 点击、`#welcome-study` 点击、`Meta+I` 按键、
`openReading()`、`#btn-codegraph`→`#cg-view-arch`、`openMindmap()`、`#tab-runs`、四个视图按钮），
端口 4934，临时 vault，跑完 `SIGKILL`。**23 项断言 22 项通过**，唯一未通过的是上面那条**改前就存在**的第三方 console 噪声。

### 3.1 六个「按需注入」功能，逐个「打开后可用」

| 功能 | 触发 | 点击→可用 | 可用性证据（DOM/截图） | 模块加载 |
| --- | --- | --- | --- | --- |
| **本机管家** | 点欢迎页 `#welcome-system` | **580 ms** | `body.system-mode` ✓、`#btn-system` 由模块自建 ✓、`#system-body` **16,454 字符**，正文「一切正常 / CPU 18% / 内存 68% / 磁盘 81%」+ 环形仪表 + 监控折线 | 打开前 ✗ → 打开后 ✓ |
| **学习工作台** | 点欢迎页 `#welcome-study` | **397 ms** | `body.study-mode` ✓、`.study-pane` **3 个窗格** ✓、`window.CodeScopeStudy` ✓ | 同上 |
| **代码向导** | `Meta+I` | **233 ms** | `#cgx-mask` 可见 ✓、`#cgx-style` 注入 ✓、`__CODE_GUIDE.state` ✓ | 同上 |
| **架构视图 ×6** | `#btn-codegraph` → `#cg-view-arch` | **605 ms** | `#cg-body` 2,663 字符、SVG 已画、图例「片段 / 函数 / 调用（实线）/ 包含」、正文「demo.c 2 个函数 add main」 | 打开前 ✗ → 打开后 6/6 ✓ |
| **PDF 阅读器** | 进阅读模式 + `openReading('demo/paper.pdf')` | **3,844 ms**（含 pdf.js 首载 + 一页渲染） | `#reading-pdf-host` ✓、`canvas` 1 张 ✓、页码胶囊 **1 / 1** ✓、`__readingPdfViewer.alive()` ✓、页面正文渲染出 "CodeScope on-demand PDF check" | 同上 |

> 全部 **< 5 s**（PDF 3.8 s 最慢，是 pdf.js 自己首次加载 + 渲染一页的时间，与注入时机无关：
> 改前改后分别是 3771 ms / 3844 ms，**同一量级**）。截图见 `/tmp/cs-shot-{system,study,guide,arch,mindmap,pdf}.png`。

### 3.2 普通功能回归（不受改动影响）

| 项 | 结果 |
| --- | --- |
| **打开代码文件** | `goToLocation` → Monaco 编辑器已建、`#code` 内容 `#include <stdio.h> / int add(int a, int b)` ✓ |
| **思维导图** | `openMindmap()` → `#mm-canvas.on` ✓ + 内嵌 `<svg>` ✓ + 提示文案「正在按需加载思维导图库…」→ 渲染完成 **2,267 ms** ✓；`xmind-interaction.js` **仍首屏同步加载** ✓ |
| **运行历史** | `#tab-runs` → `#run-panel` 有内容（209 字符）✓ |
| **切视图** | `#welcome-draw` / `#welcome-office` / `#welcome-code` / `#welcome-reading` 逐个点，`body` 类按预期切换（`office-mode` / `reading-mode`），**pageerror 0** ✓ |

---

## 4. 验收第 4 条：改了哪几行

### 4.1 `index.html`（diff hunk）

| hunk | 内容 |
| --- | --- |
| `@@ -28,0 +29,36 @@` | **+36 行**：幂等 loader（`csLoadScript` / `csLoadScripts`）+ 设计说明 |
| `@@ -32 +68,3 @@` | `study-workspace.js` 的 `<script defer>` → **−1 行 / +3 行注释** |
| `@@ -36 +74,5 @@` | `system-panel.js` 的 `<script defer>` → **−1 / +5 注释** |
| `@@ -53 +95,5 @@` | `code-guide.js` 的 `<script defer>` → **−1 / +5 注释** |
| `@@ -1230,0 +1277,145 @@` | **+145 行**：懒转发 stub + 五个触发点（紧跟 `<script src="/assets/app.js">` 之后） |
| `@@ -1238,13 +1429,19 @@` | 架构视图注释改写 + **删掉 7 个 `<script defer>`**（arch×6 + app-pdf） |

**被删掉的 10 行脚本标签（原文）**

```html
<!-- 删除（改为按需注入） -->
<script src="/assets/study-workspace.js" defer></script>
<script src="/assets/system-panel.js" defer></script>
<script src="/assets/code-guide.js" defer></script>
<script src="/assets/arch-layout.js" defer></script>
<script src="/assets/arch-round.js" defer></script>
<script src="/assets/arch-graph-svg.js" defer></script>
<script src="/assets/arch-zoom.js" defer></script>
<script src="/assets/arch-ai-view.js" defer></script>
<script src="/assets/arch-view.js" defer></script>
<script src="/assets/app-pdf.js" defer></script>
```

### 4.2 `assets/motion-batch1.css`（`@@ -725,0 +726,68 @@`，**+68 行**，全是新 CSS）

- 第 7 节：`.more` 组第 9~12 项的 `animation-name/-duration/-timing-function/-fill-mode`（**长写**，不用简写）
  + 4 条 `animation-delay: 320/360/400/440ms`
- 第 8 节：`@media (prefers-reduced-motion: reduce)` 整组 20 个按钮 `animation: none !important`
- 中间大段注释记录了**踩过的两次坑**（简写重置 delay、靠加类拼特异性反而压掉自己的 delay）

> 为什么不去把 `app.css` 的 `-n+8` 改成 `-n+12`：`app.css` 在棘轮里（4,212 行代码，全满），
> 只能靠「同特异性 + 后出现」（`motion-batch1.css` 在 index.html 里排在 `app.css` 之后）覆盖。

---

## 5. 按需加载清单与幂等实现

### 5.1 清单

| 模块 | KB | 触发点 | 懒转发方式 |
| --- | --- | --- | --- |
| `system-panel.js` | 81.1 | `#welcome-system` 点击（捕获阶段） | 注入后**代点**模块自建的 `#btn-system` |
| `code-guide.js` | 47.2 | `Ctrl/⌘+I`（捕获阶段）+ `__CODE_GUIDE.open()` | 注入后**补发**一次等价 keydown |
| `study-workspace.js` | 39.6 | `#btn-study`（隐藏按钮）的临时 onclick | 注入后**代点**同一个 `#btn-study` |
| `app-pdf.js` | 26.9 | `renderPdfViewer()` 首次被调 | 全局 stub 懒转发 + `__pdfViewerReady = true` |
| `arch-*.js` ×6 | 24.3 | `renderArchIntoPane()` 首次被调（+`#cg-view-arch` 悬停预热） | 全局 stub，按「布局 → 画图 → 面板」顺序串行注入 |

### 5.2 幂等 loader（index.html 内联，36 行）

```js
window.csLoadScript = (function () {
  var pending = new Map();                      // URL → Promise
  return function csLoadScript(url) {
    if (pending.has(url)) return pending.get(url);   // ★ 同一 URL 只加载一次，返回同一个 Promise
    var promise = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = url;
      el.onload = function () { resolve(url); };
      el.onerror = function () { pending.delete(url); reject(new Error('按需加载失败：' + url)); };  // ★ 失败可重试
      (document.head || document.documentElement).appendChild(el);
    });
    pending.set(url, promise);
    return promise;
  };
})();
window.csLoadScripts = function (list) {        // 顺序有意义的一组：串行 await
  return list.reduce(function (chain, url) {
    return chain.then(function () { return window.csLoadScript(url); });
  }, Promise.resolve());
};
```

### 5.3 懒转发 stub（三条反直觉的坑，都写进注释了）

1. **stub 里不能「读 window 上的名字再调」** —— 模块加载后那个名字可能已经变成另一个包装
   （`xmind-interaction.js` 就是现成例子：它加载时又包了一层 `window.openXmindEditor`），
   那样会自己调自己。判据用「还是不是我这个 stub」。
2. **事件类入口挂在捕获阶段** —— 真干活的是元素自己的 `onclick`（app.js 赋的），它在目标阶段才跑。
3. **代点时点真的那个元素**（`#btn-system` / `#btn-study`），不要重放原事件（会二次触发 app.js 的 onclick）。

另外每条 stub 都带**失败兜底**：加载挂了就 `console.error` 一行、安静退出，
**不把 Promise rejection 冒出去**（那会变成 pageerror，「某个视图打不开」不该记成「页面崩了」）。

### 5.4 刻意没动「有顺序约束」的那几个

| 脚本 | 为什么必须同步 |
| --- | --- |
| `xterm.js` | 必须在正文 Monaco AMD loader 注册 `window.define` **之前**执行，否则 UMD 被误判成 AMD 模块（`tests/smoke.js` 有硬断言） |
| `cs-auth.js` | 包 `window.fetch` 拦 401；defer 一下首屏那批请求就拿不到 401 处理（整页空白 + 红字） |
| `cs-icons.js` | app.js 起手渲染树行就调 `sideGlyphMarkup()` |
| `debug-panel.js` | app.js 启动即调 `showDbgBar()` / `scanDebugOutput()`（函数声明提升，必须先加载） |
| `app-draw.js` / `app-reading.js` / `app.js` | app.js 顶层直接把这些函数**对象**取去做点击接线，后加载 = `ReferenceError` |

---

## 6. 保守未改（及理由）

| 项 | 体积 | 为什么不动 |
| --- | --- | --- |
| **`xmind-interaction.js`** | 26.6 KB | 它唯一的接线点是 `app-draw.js:1136` 的 `if(window.__csXmindInteraction)window.__csXmindInteraction.bind(engine, XMIND_MAP)` —— 跑在**导图渲染路径里**、而且守卫是「没有就静默跳过」：模块没加载时 bind 不执行、之后也**不会补绑** → 导图变成「点不动、框选不了」（正是 2026-10-26 用户报的那个 bug）。它没有单一的同步全局入口可以懒转发，**用 26.6 KB 换零回归风险**。 |
| `debug-panel.js` | 16.3 KB | 见 §5.4：app.js 启动即调，属于「加载期可达引用 ≠ 0」 |
| `highlight.min.js` | 35.4 KB | Markdown 渲染 / 代码高亮首屏就可能用到 |
| `cs-sidebar.js` / `cs-lan-chip.js` | 4.8 KB | 侧栏与状态栏 LAN 芯片是首屏 UI |
| `code-theme.js` / `semantic-decorations.js` / `code-theme-picker.js` / `doc-theme.js` | 27.3 KB | 都挂在首屏就可能渲染的代码区 / 文档主题菜单上；收益小、风险不成比例 |
| `run-history.js` / `draw-folder.js` / `draw-canvas-embed.js` | 6.8 KB | `window.CS_RUNS` 是**数据全局**，被 app.js 多处同步读（都是 `window.CS_RUNS ? …` 守卫，懒加载会**静默丢运行历史**）；另外两个只有 2.5 / 2.4 KB |

---

## 7. 没做到的 / 已知限制

1. **P-10 我没按「`--i` 变量统一写法」实现**：线上没有 `--i` 这套变量，改成变量写法要动
   `index.html` 里 20 个按钮的 markup（加 `style="--i:n"`），改动面比收益大。选了「nth-child 补 4 项」这条等价路线。
2. **PDF 的「打开后可用」是从 `openReading()` 驱动的**（app-reading.js:1194 的**同一个函数、同一组参数**），
   不是从文件树点文件名点进去的 —— 我的夹具没有完整的阅读项目结构，走 UI 逐层点太脆。
   渲染结果、`__readingPdfViewer.alive()`、页码胶囊、canvas 都已验证，但**这一条的证据链比其余五项短一截**。
3. **首屏 DCL/load 的改善（−75 / −190 ms）是单次测量的数**，没说成显著 —— 我的 harness 只有一次采样，
   而且这台机在 iCloud 目录上冷启动本身抖动 8.5~8.8 s。可信的是**请求数与传输字节**这两个确定性指标。
4. **`index.html` 自身多了 3.8 KB**（loader + 大量注释），已计入净差；如果只看 JS 是 −219.1 KB。
5. **没有引入「空闲预热」**：本轮有意**不**在 `load` 之后偷偷预取这 10 个模块 ——
   那样首屏总量又回去了，会把这个改动的收益做假。代价是每个功能第一次打开要多等 0.2~3.8 s。
6. **没跑 `tests/browser-smoke.js` 全量**（它要 10 分钟以上且依赖 onlyoffice 桩），
   只跑了 `smoke` + `architecture` + `undefined-refs` + `syntax` + 自写的 23 项浏览器验证。
   `tests/perf-budget.js` 也**没跑完**（120 s 执行预算耗尽），所以「长任务 / 切视图耗时」没有前后对比。
7. **4877 端口没碰**：全程 `CODESCOPE_PORT=4934/4935/4936` + `mktemp` 出来的独立
   `CODESCOPE_DATA_HOME` + 临时 vault，每个脚本跑完都 `SIGKILL` 服务进程。
8. **没有任何 git 写操作**：只用过 `git show HEAD:…`（读）和 `git diff/log/status`（读）。
   A/B 时把两个文件临时还原成 HEAD 再量，量完按 sha256 校验复原（`47a8aadb…` / `49a385d8…`）。
