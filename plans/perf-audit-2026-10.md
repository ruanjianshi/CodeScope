# 码境 CodeScope · 首屏加载与常驻负载审计（2026-10）

> 只读审计。**没有改动任何源码 / CSS / 配置**，本文件是唯一新增产物（未提交）。
> 审计对象：`masscode-runner/`（server.js 610KB · index.html 135KB · assets/ 55 个文件）
> 实测实例：`CODESCOPE_PORT=4923`（**全程未触碰 4877**）

---

## 0. 怎么读这份文档

### 0.1 证据等级（每条结论都带一个）

| 标记 | 含义 | 占本文件比例 |
| --- | --- | --- |
| **【实测】** | 我在隔离实例上跑出来的数字，附测量条件 | 主体 |
| **【读码】** | 从源码读出来的确定事实（file:line） | 主体 |
| **【推断】** | 由实测 + 读码推出来、但**没有直接测到**的结论，一律标出 | 少量 |

**先给最重要的一条纪律**：本机回环 + 空 vault 的条件下，这个应用的**首屏其实很快**（FCP 172~276ms，见 §1.3）。
所以本文的重点**不是**「首屏慢得离谱」，而是两件事：

1. **首屏做了大量与首屏无关的工作**（1.89MB 里 ~1.26MB 当前视图根本不用 → 在慢盘 / iCloud / 局域网下会被放大）；
2. **热加载完全没有缓存红利**（82 请求 / 54 次 304 往返，见 §1.5），以及**常驻侧有可量化的浪费**（§1.6 / §1.8）。

### 0.2 测量条件（所有数字的生效范围，不可外推）

| 项 | 值 |
| --- | --- |
| 机器 | 本机 macOS，Node v26.7.0，iCloud 目录下的仓库 |
| 服务 | 隔离实例 `CODESCOPE_PORT=4923`，`CODESCOPE_HOST=127.0.0.1` |
| 数据隔离 | `CODESCOPE_DATA_HOME=/tmp/cs-perf-audit-*/data`（另注入真实 `life-workbench.json` 100KB 副本） |
| Vault | `CODESCOPE_VAULT=/tmp/cs-perf-audit-*/vault`（**空 vault** —— 这是最大的一条局限，见 §5.3） |
| 其它 | `CODESCOPE_DSH_AUTOSTART=0`、`CODESCOPE_AUTO_OFFICE=0`、`CODESCOPE_ONLYOFFICE_URL=http://127.0.0.1:1` |
| 浏览器 | 系统 Chrome（headless），viewport 1600×1000，全新 profile = 冷启动 |
| 网络 | 127.0.0.1 回环（**无网络延迟**，因此传输体积的收益在这里被严重低估） |
| 计时 | Performance API（navigation / paint / LCP / ResourceTiming）+ CDP Tracing（`devtools.timeline`）+ `Performance.getMetrics` |
| 时长 | 2026-10-31 17:52–18:10；每个场景至少跑 2 次，报告区间 |

### 0.3 结论摘要

**三行数字**

- 首屏：**81 个请求 / 1915.0 KB 传输 / 6774.5 KB 解码**，其中 **35 个资源被标记为渲染阻塞**，JS 执行+编译合计 **49.2ms**。
- 其中 **1262.1 KB / 28 个请求**（66%）是**当前视图用不到**的模块（见 §3 的「可延迟集」）。
- 热加载（同 profile 二次导航）：**82 个请求、54 次 304 往返、只有 47.7KB 有效载荷** —— 缓存策略等于没有。

**六个根因（按证据强度排序）**

1. `simple-mind-map` 思维导图引擎 **1.6MB 在 idle 预热**，实测在首屏 **321ms** 就开始下载（`xmind-interaction.js:2172`）→ 与首屏抢带宽；
2. 全部静态资源 `Cache-Control: no-cache`（`server.js:4653`）→ 每次导航全量重验；
3. 16 个样式表 + 19 个无 `defer` 的经典脚本串在主线程上（`index.html:11-187 / 1176-1222`）；
4. `index.html` 只走 gzip(level 1, 44.6KB)，其余资源走 brotli q5 —— 首屏还能再省 ~170KB（§1.7）；
5. `/api/system/status` 每 3 秒拉起 **2 个子进程**（`vm_stat` + `df`，`server.js:1747-1792`），而内存缓存 TTL 1.8s < 轮询间隔 3s → **缓存永不命中**；
6. 三个「等 Monaco」的轮询（200ms / 200ms / 400ms）最长跑 6 分钟，实测空闲 10 秒内重装 **123 次定时器**（`code-theme.js:272` / `code-theme-picker.js:84` / `semantic-decorations.js:102`）。

**必须先纠正的两个前提**（详见 §5）

- ❌ `assets/reading-block-editor.js`（2.7MB）**不在首屏** —— 它已经是懒加载（`app.js:465-493`），实测首屏请求列表里没有它。它是「打开阅读/区块编辑器」的代价，不是「首屏慢」的原因。
- ❌ 「idle CPU 12%」在本机**复现不出来** —— 实测 **0.3%**（无节流）/ **0.5%**（4× 节流），10 秒内长任务 **0 个**。可量化的浪费是**定时器唤醒次数**（12.3 次/秒）和**子进程拉起**，不是 CPU 百分比。

---

## 1. 实测数据表

### 1.1 首屏静态资源清单（59 条，按传输体积降序）

> 条件：冷启动（全新 profile 首次导航），`Accept-Encoding: gzip, deflate, br`。
> 「原始 KB」= `decodedBodySize`，「传输 KB」= `transferSize`（含响应头）。
> 「执行+编译 ms」= CDP Tracing 里 `EvaluateScript` + `CompileScript` 的 `dur` 按 URL 求和（**不含**反序列化与 GC）。

| 资源 | 原始 KB | 传输 KB | 加载方式 | 阻塞渲染 | 执行+编译 ms | 开始 ms |
| --- | --- | --- | --- | --- | --- | --- |
| /simple-mind-map/simpleMindMap.esm.min.js | 1568.2 | 475.9 | requestIdleCallback 预热 ✗ | 否 | 0 | 321 |
| /assets/app.js | 958.5 | 260.8 | \<script> 无 defer ✗ | 是 | 12.62 | 204 |
| /assets/life-workbench.js | 890.2 | 253.4 | setTimeout(1500)+idle 链 | 否 | 4.46 | 1557 |
| /assets/app.css?v=20261028a | 482.3 | 93.9 | \<link> 阻塞 | 是 |  | 51 |
| /assets/system-panel.js | 362.2 | 90.9 | \<script defer> | 否 | 3.61 | 50 |
| /assets/life-styles.js | 331.4 | 81.2 | setTimeout(1500)+idle 链 | 否 | 0.41 | 1551 |
| /assets/xterm.js | 276.8 | 60.6 | \<script> 无 defer ✗ | 是 | 6.08 | 37 |
| /assets/app-reading.js | 212.0 | 57.8 | \<script> 无 defer ✗ | 是 | 0.24 | 199 |
| /assets/code-guide.js | 184.8 | 52.4 | \<script defer> | 否 | 0.69 | 50 |
| /assets/study-workspace.js | 174.3 | 43.7 | \<script defer> | 否 | 3.49 | 50 |
| /assets/highlight.min.js | 118.9 | 38.9 | \<script defer> | 否 | 4.99 | 37 |
| /assets/app-draw.js | 122.4 | 34.9 | \<script> 无 defer ✗ | 是 | 0.22 | 195 |
| /assets/app-pdf.js | 115.1 | 30.4 | \<script> 无 defer ✗ | 是 | 0.46 | 324 |
| /assets/xmind-interaction.js | 107.2 | 29.3 | \<script> 无 defer ✗ | 是 | 0.28 | 245 |
| /lib/roots.js | 56.8 | 23.5 | \<script type=module> | 否 |  | 50 |
| /assets/life-editor.js | 59.8 | 21.5 | setTimeout(1500)+idle 链 | 否 | 0.18 | 1555 |
| /assets/debug-panel.js | 52.1 | 17.7 | \<script> 无 defer ✗ | 是 | 0.09 | 182 |
| /assets/doc-theme.css?v=20261028E | 53.0 | 14.8 | \<link> 阻塞 | 是 |  | 51 |
| /assets/ui-kit.css?v=20261028a | 44.8 | 13.2 | \<link> 阻塞 | 是 |  | 51 |
| /assets/pdfjs/pdf_viewer.css | 97.9 | 13.1 | \<link> 阻塞 | 是 |  | 18 |
| /assets/motion.css?v=20261028a | 31.5 | 11.3 | \<link> 阻塞 | 是 |  | 51 |
| /assets/motion.js?v=20261028a | 30.8 | 10.7 | \<script defer> | 否 | 7.31 | 51 |
| /monaco/vs/loader.js | 29.3 | 9.0 | \<script> 无 defer ✗ | 是 | 0.74 | 136 |
| /lib/en-sources.js | 23.2 | 8.6 | \<script type=module> | 否 |  | 50 |
| /assets/motion-cg.css?v=20261028a | 23.6 | 8.4 | \<link> 阻塞 | 是 |  | 51 |
| /assets/arch-ai-view.js | 23.5 | 8.4 | \<script> 无 defer ✗ | 是 | 0.25 | 312 |
| /assets/arch-layout.js | 22.5 | 8.3 | \<script> 无 defer ✗ | 是 | 0.06 | 267 |
| /lib/expr.js | 24.2 | 8.1 | \<script type=module> | 否 |  | 50 |
| /assets/motion-study.css?v=20261028a | 20.2 | 7.6 | \<link> 阻塞 | 是 |  | 51 |
| /assets/motion-lw.css?v=20261028a | 19.2 | 7.0 | \<link> 阻塞 | 是 |  | 51 |
| /assets/code-theme.js?v=20261028a | 18.5 | 7.0 | \<script defer> | 否 | 0.08 | 51 |
| /lib/en-text.js | 15.8 | 6.6 | \<script type=module> | 否 |  | 50 |
| /assets/motion-sp.css?v=20261028a | 18.0 | 6.6 | \<link> 阻塞 | 是 |  | 51 |
| /assets/motion-dbg.css?v=20261028a | 17.0 | 6.1 | \<link> 阻塞 | 是 |  | 51 |
| /assets/study-workspace.css | 20.2 | 5.1 | \<link> 阻塞 | 是 |  | 18 |
| /assets/motion-monaco.css?v=20261028a | 12.0 | 5.0 | \<link> 阻塞 | 是 |  | 51 |
| /lib/srs.js | 9.8 | 4.3 | \<script type=module> | 否 |  | 50 |
| /assets/cs-auth.js | 10.7 | 4.2 | \<script> 无 defer（有意） | 是 | 0.04 | 202 |
| /lib/flow-schedule.js | 7.1 | 3.7 | \<script type=module> | 否 |  | 50 |
| /simple-mind-map/simpleMindMap.esm.min.css | 23.9 | 3.7 | requestIdleCallback 预热 ✗ | 否 |  | 320 |
| /assets/cs-icons.js | 6.4 | 3.3 | \<script> 无 defer ✗ | 是 | 0.16 | 191 |
| /assets/cs-lan-chip.js | 8.0 | 3.2 | \<script defer> | 否 | 0.17 | 50 |
| /assets/arch-graph-svg.js | 6.9 | 3.2 | \<script> 无 defer ✗ | 是 | 0.23 | 294 |
| /assets/run-history.js | 6.5 | 2.9 | \<script> 无 defer ✗ | 是 | 0.05 | 189 |
| /assets/semantic-decorations.js?v=20261028a | 5.3 | 2.6 | \<script defer> | 否 | 0.03 | 51 |
| /assets/arch-view.js | 4.9 | 2.5 | \<script> 无 defer ✗ | 是 | 0.09 | 319 |
| /assets/editor-chrome.css?v=20261028a | 4.5 | 2.2 | \<link> 阻塞 | 是 |  | 51 |
| /assets/arch-zoom.js | 4.6 | 2.2 | \<script> 无 defer ✗ | 是 | 0.09 | 301 |
| /assets/xterm.css | 5.3 | 2.1 | \<link> 阻塞 | 是 |  | 18 |
| /assets/doc-theme.js?v=20261028d | 5.4 | 2.1 | \<script defer> | 否 | 0.15 | 51 |
| /assets/cs-sidebar.js | 4.4 | 2.0 | \<script defer> | 否 | 0.23 | 50 |
| /assets/code-theme-picker.js?v=20261028a | 3.7 | 1.8 | \<script defer> | 否 | 0.06 | 51 |
| /assets/arch-round.js | 2.8 | 1.8 | \<script> 无 defer ✗ | 是 | 0.13 | 276 |
| /golden-layout/css/goldenlayout-base.css | 6.1 | 1.4 | \<link> 阻塞 | 是 |  | 18 |
| /assets/draw-folder.js | 2.5 | 1.4 | \<script> 无 defer ✗ | 是 | 0.08 | 193 |
| /assets/draw-canvas-embed.js | 2.4 | 1.3 | \<script> 无 defer ✗ | 是 | 0.08 | 194 |
| /assets/hljs-theme.css | 0.8 | 1.1 | \<link> 阻塞 | 是 |  | 17 |
| /assets/codescope.svg | 0.6 | 0.9 | \<link rel=icon> | 否 |  | 54 |
| /assets/codescope.svg（重复） | 0.6 | 0.3 | \<link rel=icon> + CSS 背景 | 否 |  | 452 |

**合计：静态 59 条 / 传输 1885.9 KB / 解码 6774.5 KB。**
其中 `renderBlockingStatus === "blocking"` 的有 **35 条** = **16 个 `<link rel=stylesheet>`** + **19 个经典脚本**（
【实测】这 35 条逐条列在 §1.1 的「阻塞渲染」列。注意 `monaco/vs/loader.js` 那类也算脚本，所以脚本数比「index.html 里的 `<script>` 数」少，因为带 `defer` 的不阻塞）。

### 1.2 首屏接口清单（20 条）

| 接口 | 响应 KB | 耗时 ms | 开始 ms | 备注 |
| --- | --- | --- | --- | --- |
| /api/env | 12.7 | 33 | 238 | 【读码】无缓存，每次 10ms |
| /api/sync/status | 3.8 | 172 | 276 | 冷 86ms / 热 0.7ms；**172ms 是排队** |
| /api/version | 2.8 | 15 | 237 | |
| /api/readings/tree | 1.4 | 30 | 391 | |
| /api/office/providers/v1?refresh=1 | 1.3 | 30 | 392 | |
| /api/system/status | 0.8 | 28 | 223 | 冷 8.6~13.1ms（拉子进程） |
| /api/study/config | 0.8 | 1 | 363 | |
| /api/lan | 0.6 | 39 | 380 | |
| /api/remote/status | 0.5 | 5 | 224 | |
| /api/system-panel/ping | 0.5 | 42 | 376 | |
| /api/office/service | 0.5 | 172 | 392 | 冷 37ms / 热 0.4ms |
| /api/git | 0.4 | 15 | 237 | 实测被请求 **2 次** |
| /api/snippets | 0.4 | 16 | 237 | |
| /api/project/compile-db | 0.4 | 17 | 237 | |
| /api/study/site-catalog | 0.4 | 17 | 343 | **同步 XHR**（见 §2 P12） |
| /api/study/site-catalog | 0.4 | 2 | 361 | **同一 URL 又 fetch 一次** |
| /api/drawings/tree | 0.4 | 29 | 391 | |
| /api/office/tree | 0.4 | 30 | 391 | |
| /api/ai/config | 0.3 | 4 | 226 | |
| /api/life/store | 0.3 | 1 | 1568 | 挂在 life 链上 |

【实测】首屏 20 个接口**几乎同时发出**（237~392ms 之间），Node 单线程串行处理 → `/api/sync/status` 与 `/api/office/service` 各被排队到 **172ms**（单独打同一实例分别是 0.7ms / 0.4ms）。

### 1.3 加载时序表

| 指标 | 冷启动（无节流） | 冷启动（CPU 4× 节流） | 含义 |
| --- | --- | --- | --- |
| TTFB（responseStart） | 2~3 ms | 2 ms | 回环，无参考价值 |
| first-paint / **FCP** | **172 / 272 / 276 ms**（三次） | **240 ms** | 首屏壳子画出来 |
| **LCP** | **440 / 572 ms** | **1136 ms** | 元素：`DIV.draw-empty` |
| domInteractive | 329 ms | — | |
| **DOMContentLoaded** | **297~392 ms** | **765 ms** | |
| **load** | **301~403 ms** | **784 ms** | |
| DOM 节点数 | 2639~6784（随 life-* 注入变化） | 6797 | |
| 堆（JSHeapUsedSize） | 11.1 MB | 11.0 MB | |
| 解码总量 | 6774.5 KB → 7049 KB | — | |

**判读**

- FCP 与 LCP 差 ~170~300ms：FCP 是 head 里那批阻塞样式表 + 内联脚本画出的壳子；**LCP 要等 `app.js`（260.8KB / 958.5KB 解码）执行完、`refresh()` 异步回来才落笔**。所以 LCP 的杠杆在 `app.js` 及其后续渲染，不在 CSS。
- 4× 节流下 LCP 从 440 → 1136ms（**2.6×**），说明 LCP 是**纯 CPU 串行**的产物，不是网络。
- 【推断】在 iCloud 目录 + 冷文件缓存下，解码 6.8MB 的 JS/CSS 会把这段 CPU 时间进一步放大；本次未能制造该条件（见 §5.3）。

### 1.4 长任务

| 场景 | 主线程 RunTask > 50ms | 明细 |
| --- | --- | --- |
| 加载阶段（0~3.5s） | **1 个** | 56.9 ms（CDP Tracing）/ 51 ms（PerformanceObserver，起始 72ms） |
| 空载 10 秒 | **0 个** | — |
| 空载 10 秒（4× 节流） | **0 个** | — |

【实测】没有「一卡一大片」的长任务。首屏那段 51~57ms 出现在 72ms 附近，落在「阻塞样式表 + 内联脚本 + xterm/highlight 解析」区间内，**不构成需要专门拆分的任务**。

### 1.5 冷 / 热加载对比（同 profile 连续三次导航）

| 轮次 | 请求数 | 状态码分布 | 有效传输 | FCP | DCL | load |
| --- | --- | --- | --- | --- | --- | --- |
| 冷（首次） | 81 | 200×81 | **2004250 B**（1.91 MB） | 276 ms | 297 ms | 301 ms |
| 热 #1 | 82 | **200×28 / 304×54** | **47726 B**（46.6 KB） | 140 ms | 115 ms | 124 ms |
| 热 #2 | 82 | 200×31 / 304×51 | **47726 B** | 120 ms | 112 ms | 119 ms |

**判读（这是「重复访问也慢」的核心证据）**

- 热加载省下了**字节**（1.91MB → 46.6KB），但**请求数一次都没少**（82）。
- 54 个静态资源全部走 `If-None-Match` 重验。回环下 54 个 304 只要几十毫秒；**在局域网 / WiFi 下这就是 54 个独立往返**，且每个都要 Node 侧 `fs.stat` + 拼头。
- 【推断】按 30ms RTT 估算，54 个并发 304 在 HTTP/1.1 的 6 连接上限下约增加 150~300ms —— 这是「用户感觉热刷新也要等」的主因。**本次没有条件实测广域网，标注为推断。**

### 1.6 轮询与定时器频率表

**A. 实测存活的长周期定时器**（用 `addInitScript` 包住 `setInterval` 记录注册栈，页面稳定 3s 后快照）

| 周期 | 端点 / 动作 | 注册位置 | 前台可见条件 |
| --- | --- | --- | --- |
| **3000 ms** | `GET /api/system/status` | `assets/app.js:748` | `!document.hidden` |
| **3000 ms** | `syncLoop()` → `GET /api/rev` | `assets/app.js:14287` | 始终 |
| **30000 ms** | `refresh()` → `GET /api/lan` | `assets/cs-lan-chip.js:67` | 始终 |
| **60000 ms** | 同步状态点 | `assets/app.js:11111`（`bindSyncTick`） | 始终（另有 8s 首拉） |
| **60000 ms** | `loadEnv(true,true)` → `GET /api/env` | `assets/app.js:14857` | `!document.hidden` |
| **75000 ms** | `mailLoadStatus()` | `assets/life-workbench.js:5626` | 需已配邮箱 + 可见 |

**B. 条件激活的定时器（【读码】，本次未触达）**

| 周期 | 动作 | 位置 | 何时激活 |
| --- | --- | --- | --- |
| 1000 ms | 秒针 + 日进度条 | `assets/life-workbench.js:4125` | 工作台面板打开 |
| 20000 ms | 格言轮换 | `assets/life-workbench.js:4174`（`QUOTE_EVERY_MS = 20000`，定义在 :487） | 工作台面板打开 |
| 60000 ms | `flowPollSchedule()` | `assets/life-workbench.js:8157` | 流程视图打开 |
| 100 ms | `tryMount()`（挂上面板即停） | `assets/life-workbench.js:993` | 启动后到挂载成功 |
| 1500 ms | 知识库翻页记忆 | `assets/app-reading.js:135` | `knowledge-mode` |
| 5000 ms | `pollLibraryFolder()` | `assets/app-draw.js:586` | 素材库面板打开 |
| 1000 ms | 生成状态 | `assets/app-draw.js:232` | AI 生成中 |

**C. 三个「等 Monaco」的自旋轮询（本次审计发现的最大常驻浪费）**

| 位置 | 周期 | 上限 | 退出条件 |
| --- | --- | --- | --- |
| `assets/code-theme.js:272-276` | **200 ms** | `tries > 600` → **120 s** | `window.monaco.editor.defineTheme` 出现 |
| `assets/code-theme-picker.js:84-90` | **200 ms** | `tries > 900` → **180 s** | `build()` 返回 true |
| `assets/semantic-decorations.js:102-110` | **400 ms** | `tries > 900` → **360 s** | 永不真正退出，只是停止重排 |

【实测】空载 10 秒内 CDP Tracing 记录到：

- `TimerInstall(timeout=200)` **98 次**（≈ 5 次/秒 × 2 个 200ms 轮询）
- `TimerInstall(timeout=400)` **25 次**
- 合计 **12.3 次定时器唤醒 / 秒**，在**用户根本没打开编辑器**的空载状态下持续 2~6 分钟。

【实测】同一 10 秒内网络轮询只有 **8 个请求**：`/api/system/status`×3、`/api/rev`×3、`/api/git`×1、`/api/life/sync-status`×1。

### 1.7 HTTP 层实测

**A. 响应头（同一批资源逐个抓取）**

| 头部 | `/assets/*` (39 个) | `/monaco/vs/*`、`/golden-layout/*` | `/`（index.html） |
| --- | --- | --- | --- |
| `Cache-Control` | **`no-cache`**（默认值，`server.js:4653`） | **`public, max-age=86400`** ✅ | **`no-cache`**（`server.js:4604`） |
| `ETag` | `W/"<size>-<mtimeMs>"`（`server.js:4652`） | 同 | `W/"<size>-<mtimeMs>"` |
| `Vary` | `Accept-Encoding` | `Accept-Encoding` | `Accept-Encoding` |
| `Content-Encoding` | `br`（brotli q5） | `br` | **`gzip`（level 1）** ❌ |
| `X-Content-Type-Options` | `nosniff` | 无 | `nosniff` |

**同一个服务里存在两套缓存策略**：应用自己的 `assets/` 每次重验，而 vendored 的 `node_modules` 静态目录给了一天的 `max-age`。

**B. `?v=` 指纹无效（【读码】+【实测】）**

- `index.html` 里 16 处 `?v=20261028a`（`app.css` / `ui-kit.css` / 5 个 `motion-*.css` / `doc-theme.js` …）是**手写常量**，不是构建产物哈希。
- 实测值已经过期：`app.css` 的 mtime 是 **10-29 20:27**，而 `?v=` 还写着 **20261028a**。
- `server.js:4647` 的 `streamStatic` 只用 `pathname`（`path.resolve(root, relative)`），**查询串完全不参与** —— 所以 `?v=` 既不改变 ETag，也不改变服务端行为；它只让浏览器缓存键变成另一个 URL。
- 结论：**`?v=` 现在是纯装饰**。要么升级成「内容哈希 / mtime 自动注入 + 长缓存」，要么删掉（现在它只是增加了「同一文件两个缓存键」的风险）。而 `index.html` 里有 11 个资源**没有** `?v=`（`xterm.js`、`study-workspace.css`、`/lib/*.js` …），说明这套指纹本来也没统一。

**C. 压缩：已启用，但档位保守，且 index.html 漏了 brotli**

| 文件 | 原始 KB | 现状（服务端实际发送） | gzip -1 | gzip -9 | brotli q5 | brotli q11 | 现状→q11 可省 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| index.html | 133 | **gzip1 44.6KB** | 43.9 | 38.6 | 34.9 | **31.6** | **13.0 KB** |
| assets/app.js | 958 | br5 260.5 | 347.6 | 297.9 | 260.5 | **228.3** | 32.2 |
| assets/app.css | 482 | br5 93.6 | 134.7 | 102.9 | 93.6 | **78.9** | 14.8 |
| assets/life-workbench.js | 890 | br5 253.1 | 343.2 | 294.5 | 253.1 | **219.8** | 33.3 |
| assets/system-panel.js | 362 | br5 90.6 | 119.7 | 97.2 | 90.6 | **80.8** | 9.8 |
| assets/life-styles.js | 331 | br5 80.9 | 108.1 | 88.8 | 80.9 | **71.4** | 9.5 |
| simpleMindMap.esm.min.js | 1568 | br5 475.6 | 579.4 | 501.5 | 475.6 | **427.0** | 48.7 |
| assets/xterm.js | 277 | br5 60.3 | 78.7 | 64.0 | 60.3 | **53.6** | 6.8 |
| assets/code-guide.js | 185 | br5 52.1 | 69.4 | 58.7 | 52.1 | **46.9** | 5.1 |
| assets/study-workspace.js | 174 | br5 43.4 | 55.5 | 45.1 | 43.4 | **39.4** | 4.0 |
| assets/reading-block-editor.js（懒加载，不在首屏） | 2715 | br5 833.6 | 1038.1 | 899.4 | 833.6 | **719.2** | 114.4 |
| assets/reading-block-editor.css（懒加载） | 1478 | br5 827.3 | 983.5 | 938.4 | 827.3 | **800.9** | 26.4 |

- 【读码】`lib/static-compress.js:19`：brotli **质量写死 5**（注释理由：「体积和 CPU 的平衡点」）；`server.js:4628` gzip 用 `Z_BEST_SPEED`。
- 【实测】只对**首屏实际加载**的 9 个 >150KB 文件统计：br5 → br11 合计可再省 **164.2 KB**（首屏静态总量 1885.9 KB 的 8.7%），且这些是**一次性 CPU**（已有缓存层，见 §2 P7 的风险说明）。

**D. 请求数**

| 维度 | 冷 | 热 |
| --- | --- | --- |
| 总请求 | **81** | **82** |
| 静态资源去重后 | 57 | 57 |
| 接口 | 20 | 20（+ 轮询） |
| 重复 URL | 4 个：`codescope.svg`×2、`/api/system/status`×2、`/api/git`×2、`/api/study/site-catalog`×2 | 同 |

### 1.8 常驻空闲负载

【实测】`Performance.getMetrics` 的 `TaskDuration` 增量（主线程真正忙的时间）：

| 场景 | 10 秒内 TaskDuration | ScriptDuration | LayoutDuration | 主线程忙时占比 | 长任务 | 堆 | DOM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 无节流 | **32 ms** | 6 ms | 1 ms | **0.3 %** | 0 | 11.1 MB | 6784 |
| 4× 节流 | **49 ms** | 9 ms | 4 ms | **0.5 %** | 0 | 11.0 MB | 6797 |

【实测】同一 10 秒内 DOM 变更（MutationObserver）：

- `childList` **32 次**、`attributes` **28 次**、`characterData` 0 次；
- **没有一次**变更涉及超过 300 个元素 → **不存在「整屏 render 每 3 秒重建一次」**。

【实测】服务端侧单次成本（curl 打同一隔离实例，各 6 次）：

| 端点 | 单次耗时 | 大小 | 说明 |
| --- | --- | --- | --- |
| `/api/system/status` | **8.6 ~ 13.1 ms** | 485 B | 每 3s 一次；macOS 上拉 `vm_stat` + `df` 两个子进程 |
| `/api/env` | **9.8 ~ 10.3 ms** | 12.5 KB | 每 60s 一次，**无缓存** |
| `/api/rev` | 0.7 ~ 1.1 ms | 31 B | 每 3s 一次（空 vault） |
| `/api/life/store` | 0.6 ~ 1.6 ms | 100 KB | 一次性 |
| `/api/lan` | 0.5 ~ 0.7 ms | 333 B | 每 30s |
| `/api/sync/status` | 冷 86 ms / 热 0.7 ms | — | 有缓存 |
| `/api/office/service` | 冷 37 ms / 热 0.4 ms | — | 有缓存 |

---

## 2. 问题清单

> 每条：**现象（实测）→ 根因（file:line / 响应头）→ 预估收益 → 修复建议（含风险）**
> 收益一律给「本机实测基线」与「换到慢环境后的推断」两档，推断明确标注。

### P1 · 1.6MB 思维导图引擎在首屏期间预热

- **现象【实测】**：`/simple-mind-map/simpleMindMap.esm.min.js` **475.9 KB 传输 / 1568.2 KB 解码，在 321ms 就开始下载**，是首屏**体积第一**的资源，比 `app.js` 还大 1.8 倍。
- **根因【读码】**：`assets/xmind-interaction.js:2172-2182` 在 `requestIdleCallback(run, { timeout: 4000 })` 里调 `ensureXmindEditorLib()`（`assets/app-draw.js:1024-1032` → `import('/simple-mind-map/simpleMindMap.esm.min.js')`）。注释写着「不跟首屏抢带宽」，但**实测它 321ms 就发了** —— 此刻首屏那批 script 还在陆续到达。`requestIdleCallback` 的回调只在「当前没有更高优先级任务」时执行，**首屏期间到处都是这种空隙**，所以它事实上和首屏并发。
- **收益**：本机回环 **≈0ms**（带宽不是瓶颈）；【推断】局域网 / WiFi 下，首屏关键字节被挤占，FCP 增加 **80~250ms**（取决于链路）；任何环境下都省 **476 KB**。
- **建议**：把预热从 `requestIdleCallback` 改成「首屏 load 事件之后 + 用户首次 `pointerenter`/`focus` 到绘图入口 + 至少 8s 延迟」的三重门。**最省事的版本**：`window.addEventListener('load', () => setTimeout(run, 10000), { once:true })`。
- **风险**：低。唯一的反面是「用户 10 秒内就点开导图」→ 回到原来 1~2 秒的等待。可用「`pointerenter` 到绘图 tab 立即预热」补上（用户把鼠标移向绘图入口时通常还有 200~400ms 的移动时间）。

### P2 · 全部应用资源 `no-cache`，热加载 54 次 304 往返

- **现象【实测】**：热加载 82 个请求里有 **54 个 304**，有效载荷只有 46.6 KB，但请求数与冷启动几乎一样（82 vs 81）。
- **根因【读码】**：`server.js:4653` `const cacheControl = options.cacheControl || 'no-cache';`；`server.js:4604` `sendIndex` 同样写死 `'Cache-Control': 'no-cache'`。对比同服务里 vendored 目录：`/monaco/vs/loader.js` 与 `/golden-layout/css/goldenlayout-base.css` 拿到的都是 `public, max-age=86400`。
- **收益**：本机 **~10ms**（回环）；【推断】30ms RTT 下热加载少 **54 个往返**，按 6 并发估算 **-150~300ms**；服务端每轮少 54 次 `fs.stat`。
- **建议**：分两类处理 ——
  1. **带内容哈希的**（改名或改 `?v=` 为真实哈希，见 P3）：`Cache-Control: public, max-age=31536000, immutable`；
  2. **不带哈希的**（过渡期）：`Cache-Control: no-cache` 保留，但把 `ETag` 从 `W/"size-mtime"` 换成**内容哈希**（现在是弱验证器 + mtime，mtime 变动但内容不变时（`touch`、iCloud 同步、`git checkout`）会白掉缓存）。
- **风险**：**中**。做错就是「改了 CSS 用户看不到」。必须和 P3 一起做，否则长缓存 + 手写 `?v=` = 线上陈旧资源。**这是本次唯一一条「必须成对实施」的建议。**

### P3 · `?v=` 是手写常量、与内容无关，且服务端完全忽略查询串

- **现象【实测 + 读码】**：`index.html` 有 16 处 `?v=20261028a`/`?v=20261028E`/`?v=20261028d`；`app.css` 的实际 mtime 是 **10-29 20:27**，比 `v` 值新一天多。但同时**约 36 处没有** `?v=`（
	- 5 个 `<link>`：`hljs-theme.css`、`xterm.css`、`pdfjs/pdf_viewer.css`、`golden-layout/…`、`study-workspace.css`；
	- 31 个 `<script>`：`highlight.min.js`、`xterm.js`、`study-workspace.js`、`system-panel.js`、6 个 `/lib/*.js`、`code-guide.js`、`cs-lan-chip.js`、`cs-sidebar.js`、`/monaco/vs/loader.js`、`debug-panel.js`、`run-history.js`、`cs-icons.js`、`draw-folder.js`、`draw-canvas-embed.js`、`app-draw.js`、`app-reading.js`、`cs-auth.js`、`app.js`、`xmind-interaction.js`、6 个 `arch-*.js`、`app-pdf.js`）。
	→ **指纹只覆盖了 16/52，而且盖的那 16 个里没有一个是首屏体积最大的**（`app.js` 260.8KB、`xterm.js` 60.6KB、`system-panel.js` 90.9KB 全都不带；唯一的 `simple-mind-map` 是动态 `import()` 来的，压根不经过 index.html）。
- **根因【读码】**：`server.js:4647` `streamStatic` 只用 `path.resolve(root, relative)`，`?v=` 不参与任何判断；`index.html` 的版本号是人手改的，没有构建步骤生成。
- **收益**：本身 0ms；它是 P2 的**前置条件** —— 没有真指纹就不能开长缓存。
- **建议**：在 `sendIndex` 拼 HTML 时把 `?v=<token>` 统一替换成**文件内容哈希的前 8 位**（或 `mtimeMs` 的 base36）。已有 `indexAsset()` 缓存层（`server.js:4577-4592`），在那里顺手做字符串替换即可，**不改 index.html 一行**。
- **风险**：低-中。替换逻辑写错会导致 404（`?v=` 拼到 `pathname` 之外）。必须加一条冒烟断言：`GET /` 返回的每个 `/assets/*` URL 都能 200。

### P4 · 首屏 66% 的字节是「当前视图用不到」的模块

- **现象【实测】**：静态 1885.9 KB 中，**1262.1 KB / 28 个请求**属于下列集合：

| 模块 | 传输 KB | 请求数 | 何时才真正需要 |
| --- | --- | --- | --- |
| simple-mind-map js+css | 479.6 | 2 | 打开导图编辑 |
| life-workbench + life-styles + life-editor | 356.1 | 3 | 打开「我的工作台」 |
| system-panel | 90.9 | 1 | 打开本机管家 |
| xterm js+css | 62.7 | 2 | 打开终端 |
| code-guide | 52.4 | 1 | 打开代码指南浮层 |
| study-workspace js+css | 48.8 | 2 | 打开学习工作台 |
| app-draw | 34.9 | 1 | 打开绘图 |
| 5 个 `motion-*` 子系统 CSS | 35.7 | 5 | 对应子系统打开 |
| app-pdf | 30.4 | 1 | 打开 PDF |
| xmind-interaction | 29.3 | 1 | 打开导图 |
| arch-*（5 个文件） | 18.0 | 5 | 打开架构视图 |
| debug-panel | 17.7 | 1 | 打开调试面板 |
| run-history + draw-folder + draw-canvas-embed | 5.6 | 3 | 对应面板 |
| **合计** | **1262.1** | **28** | |

- **根因【读码】**：`index.html:1176-1222` 把 18 个**经典脚本**（无 `defer`）按依赖顺序平铺在 body 末尾；`index.html:31 / 27 / 48-50` 的 `defer` 脚本同样无条件加载；`index.html:122-132` 把 5 个子系统微交互 CSS 全量引入。
- **收益**：本机回环 **FCP/LCP 变化很小**（带宽和解析都不是瓶颈，JS 执行+编译总共只有 49.2ms）；**真正的收益在慢环境**：【推断】按 10Mbps / 60ms RTT 估算，少下 1.26MB 可让 load 提前 **0.8~1.5s**；任何环境下省 1.26MB 流量。
- **建议**：不要一次全改。分三批，**每批都用「打开该面板仍能正常工作」的冒烟测**：
  - 批一（风险最低，纯 `defer` 化）：`arch-*`×5、`app-pdf`、`app-draw`、`debug-panel`、`run-history`、`draw-folder`、`draw-canvas-embed`、`xmind-interaction` 加 `defer`。**注意** `index.html:1191-1197` 明确写了 `app-reading.js` 必须在 `app.js` 之前且 app.js 顶层直接取它的函数对象 —— 这一条**不能**动。
  - 批二：`system-panel.js`、`study-workspace.js`+`.css`、`code-guide.js`、5 个 `motion-*.css` 改为「首次打开对应面板时注入」（`app.js:465-493` 的 `loadBlockEditor` 就是现成范式）。
  - 批三：`xterm.js` 改为终端打开时加载。**注意** `index.html:25` 的注释：xterm 必须在 Monaco AMD loader 之前执行，否则 UMD 被误判为 AMD —— 改成立即注入时**必须保持这个顺序约束**。
- **风险**：批一低（`defer` 只是延后执行，保持顺序）；批二中（子系统脚本可能被 `app.js` 顶层的静态引用摸到，要像 `app-reading` 那样逐个核对）；批三中（那条 AMD 顺序注释是实测踩出来的坑）。

### P5 · 16 个样式表全部阻塞渲染，其中 5 个是子系统微交互

- **现象【实测】**：35 个阻塞渲染资源里 **16 个是 `<link rel=stylesheet>`**，分别来自 `index.html:11-15`（5 个）、`:107-144`（12 个，其中 5 个是 `motion-*`）。它们**全部在 17~51ms 之间并发发出**。
- **根因【读码】**：这些样式表靠「后出现覆盖前面」的层叠顺序协作（`index.html:109-113` 的注释写得很清楚：`motion.css` 必须排在 `app.css/ui-kit.css/doc-theme.css` 之后）。
- **收益**：本机回环几乎为 0（都在 50ms 内到齐）；但**每一个 `<link>` 都是一次「阻塞到 CSSOM 就绪」的等待**，在慢网络上 16 个请求 × RTT/6 并发 是实打实的。且【实测】其中 `motion-lw/sp/study/cg/dbg` 合计 **35.7 KB** 服务的是**打不开就看不见的子系统**。
- **建议**：只做「归并」不做「重排」—— 用 `scripts/` 里已有的构建脚本把 `app.css + ui-kit.css + doc-theme.css + motion.css + editor-chrome.css` 合成一个 `app.bundle.css`（**保持现有顺序**，这 5 个的顺序语义就是层叠语义）。5 个 `motion-*` 按 P4 批二延后。
- **风险**：中。合并后「靠后出现覆盖」的语义必须靠拼接顺序保住；任何顺序错都会静默改变外观。**建议先做一次「合并前后 computed style 快照 diff」再合并。**

### P6 · `/api/system/status` 每 3 秒拉起两个子进程，缓存 TTL 永远不命中

- **现象【实测】**：单次 `/api/system/status` **8.6~13.1 ms**（对比 `/api/rev` 的 0.7~1.1ms），每 3 秒一次，与「系统监视弹层是否打开」无关。
- **根因【读码】**：
  - `assets/app.js:748` `setInterval(() => { if(!document.hidden) loadSystemStatus(); }, 3000)` —— **无条件**；
  - `server.js:1748` `if (MEMORY_CACHE.value && Date.now() - MEMORY_CACHE.at < 1800) return MEMORY_CACHE.value;` → **1800ms < 3000ms ⇒ 缓存命中率恒为 0**，每次都要 `execFileText('vm_stat')`（`server.js:1756`）；
  - `server.js:1771` `DISK_CACHE` TTL 5000ms → 每 2 次轮询还要 `execFileText('df', ['-Pk', vaultPath()])`（`server.js:1781`）。
- **收益**：本机 Node 侧**每 tab 每 3 秒 ~9ms 主线程阻塞 + 2 次进程创建**；【推断】按 1 个 tab 24 小时 = **28800 次 `vm_stat` + 14400 次 `df`**。浏览器侧每 3 秒一次 `JSON.parse` + 12 个 DOM 写入（`setSystemMetric` ×3 + `$('smd-*')` ×9）。
- **建议**（三条独立可选）：
  1. **提高服务端 TTL**：`MEMORY_CACHE` 1800 → 4000ms（≥ 轮询间隔 × 1.3）。改一行，收益立竿见影；
  2. **只在需要时轮询**：`loadSystemStatus` 只在 `#sysmon-detail` 展开或顶栏 CPU 卡片可见时跑；关掉弹层就降到 15s；
  3. **`df` 结果按挂载点缓存 30s**（磁盘容量本来也不会 3 秒变一次）。
- **风险**：低。唯一副作用是「CPU 百分比刷新变慢 1 秒」，而它本来就是 1 秒采样的（`server.js:1184-1188` 的 `CPU_SAMPLE_TIMER` 1000ms），所以 4s 的缓存不会让数字失真。

### P7 · 压缩档位保守（brotli q5 / gzip -1），index.html 完全没走 brotli

- **现象【实测】**：`/assets/*` 都是 brotli q5；`/`（index.html）只有 **gzip level 1 = 44.6 KB**，brotli q11 只需 **31.6 KB**。首屏 9 个 >150KB 文件 q5→q11 合计再省 **164.2 KB**。
- **根因【读码】**：`lib/static-compress.js:19` 写死 `BROTLI_PARAM_QUALITY: 5`；`server.js:4628` gzip 用 `Z_BEST_SPEED`；`sendIndex`（`server.js:4587`）只有 `zlib.gzipSync(raw, { level: Z_BEST_SPEED })`，**完全没有 brotli 分支**。
- **收益**：**index.html 13.0 KB / 次导航**（gzip1 → br11）；静态资源 **164.2 KB**（首屏实际加载集）。CPU 成本：q11 对 2.7MB 的 JS 约需 300~800ms **一次性**（有缓存层兜着，见下）。
- **建议**：
  1. `sendIndex` 增加 brotli 分支（与 `streamStatic` 一致：`accept-encoding` 含 `br` 就发 br），缓存里同时存 gzip 与 br 两份；
  2. `lib/static-compress.js` 的 quality 5 → 9（**不要一步到 11**：q11 对 1.6MB 的 simpleMindMap 要 1s+，而 `CACHE` 只有 80 条、超了直接 `CACHE.clear()`（`lib/static-compress.js:20`），会反复重压）；
  3. 冷门大文件（reading-block-editor 2.7MB）保留 q5，因为它本来是懒加载的。
- **风险**：低-中。注意 `lib/static-compress.js:20` 的 `if (CACHE.size > MAX_ENTRIES) CACHE.clear()` —— **清空策略是「全清」而不是 LRU**，把 quality 提高会放大这个抖动。建议同时改成淘汰最旧一条。

### P8 · 三个「等 Monaco」的自旋轮询（12.3 次唤醒/秒，最长 6 分钟）

- **现象【实测】**：空载 10 秒内 `TimerInstall(200)` **98 次** + `TimerInstall(400)` **25 次**。空载 CPU 只有 0.3%，但**定时器唤醒次数**很高，直接后果是浏览器无法进入深度省电、笔记本风扇/功耗上升。
- **根因【读码】**：
  - `assets/code-theme.js:272-276`：`setTimeout(wait, 200)`，`tries > 600`（120s）才放弃；
  - `assets/code-theme-picker.js:84-90`：`setTimeout(loop, 200)`，`tries > 900`（180s）；
  - `assets/semantic-decorations.js:102-110`：`setTimeout(loop, 400)`，`tries > 900`（**360s**）。
  三者都在等 `window.monaco` 出现，而 `monaco` **只有在用户打开编辑器时才会由 AMD loader 加载**。
- **收益**：12.3 次/秒 → 3 次/秒（或 0 次）= 空闲唤醒**-75%**；网页空闲 CPU 的实测值虽只有 0.3%，但唤醒次数是「待机耗电」的直接指标。
- **建议**：把「轮询等 monaco」改成**事件驱动**：
  - 统一成一个 `window.whenMonaco(cb)`：先查 `window.monaco`，没有就把 cb 塞进队列；由 `app.js` 里「`require(['vs/editor/editor.main'])` 成功」那一处（或一个 `monaco-ready` `CustomEvent`）统一 flush；
  - 兜底仍保留定时器，但周期 200→1000ms、上限 120→30 次（30 秒），30 秒后彻底停。
- **风险**：低。最坏情况是「编辑器打开后主题晚 1 秒生效」。**注意**：这三个脚本都写了「纯渐进增强，失效时页面与没有它完全一致」的自述，所以删除它们也不会坏功能 —— 可以先用一个开关验证。

### P9 · `/api/rev` 每 3 秒同步遍历整棵 `vault/code` 树

- **现象【实测】**：空 vault 下 `/api/rev` 0.7~1.1ms、响应 31 B；每 3 秒一次，**每个打开的标签页各一份**。
- **根因【读码】**：`server.js:2760-2786` `computeRev()` 用 `fs.readdirSync` 递归 + `fs.statSync` 每个文件，**纯同步**，拼 `path:mtime:size` 串再做 DJB2 哈希。实测 vault/code 下有 **65 个文件 / 30 个目录** → 每次约 95 次同步 syscall。同步代码会**阻塞整个 Node 事件循环**，即：这一毫秒里别的请求（含静态资源）都得等。
- **收益**：本机 **~1ms/3s**；【推断】vault 长到 2000 个文件时约 **10~30ms/3s** 的**全服务**阻塞，会让首屏静态资源出现可感知的抖动。
- **建议**（按成本递增）：
  1. `computeRev` 加 **1~2 秒的记忆化**（同一 rev 窗口内重复调用直接返回缓存）—— 一行改动，直接消掉多标签页的重复遍历；
  2. 把 rev 改成**增量**：先 `stat` 顶层目录的 mtime，未变即返回上次结果（目录 mtime 在子项增删时会变，覆盖 90% 场景）；
  3. 长线：改成 `fs.watch` / `chokidar` 维护一个 rev 计数器。
- **风险**：低（1、2）；中（3，watcher 在 iCloud 目录上不可靠 —— `.stfolder`/`.stignore` 的存在说明这个 vault 还挂在 Syncthing 下）。

### P10 · 首屏 20 个接口同时开火，Node 侧排队

- **现象【实测】**：`/api/sync/status` 与 `/api/office/service` 在首屏里各占 **172ms**，而单独打同一实例是 **0.7ms / 0.4ms**。
- **根因【读码】**：`app.js` 顶层连续调 `loadSystemStatus()` / `loadAppVersion()` / `refresh(false)` / `loadEnv(false,true)` 等，加上 `debug-panel` / `system-panel` / `study-workspace` 各自的启动请求，237~392ms 之间挤进 20 个请求。Node 是单线程，且其中有同步工作（`computeRev` 的 `statSync`、`loadReadingOrder` 的 `readFileSync`），排队被放大。
- **收益**：本机 **~170ms 的尾部延迟**（首屏 load 301ms 里有 172ms 是这些慢响应在等）；【推断】慢盘上更明显。
- **建议**：把「非首屏必需」的接口延后到 `requestIdleCallback` 或 `load` 之后：`/api/office/*`（4 个）、`/api/git`、`/api/project/compile-db`、`/api/ai/config`、`/api/remote/status`。判定标准很简单：**它们的数据在首屏可见区域里都没有渲染入口**。
- **风险**：低。需要逐个确认「首屏有没有一处 DOM 依赖它的返回值」；`/api/version`（写 `.brand-version`）和 `/api/snippets`（渲染文件树）要保留。

### P11 · `study-workspace.js` 在主线程上做同步 XHR，又重复 fetch 同一 URL

- **现象【实测】**：`/api/study/site-catalog` 被请求 **2 次**（一次 `xmlhttprequest` 17ms、一次 `fetch` 2ms）。
- **根因【读码】**：`src/study-sites.js:130-140` `loadCatalogSync()` → `xhr.open('GET', CATALOG_URL, false)`（**async=false**），在模块求值阶段同步执行；紧接着 `src/study-sites.js:144-150` `loadCatalogAsync()` 又 `fetch` 同一 URL。源码注释（`:126-129`）说明这是**有意**的：`FEATURED_SITES` 在模块求值期就被抓进 `DEFAULT_BOOKMARKS`，异步拿回来只影响「以后新建的」。
- **收益**：本机 **17ms 主线程阻塞 + 1 个重复请求**；【推断】高延迟下同步 XHR 会把**整个主线程**钉住一个 RTT（30~80ms）。
- **建议**：**不建议直接改异步**（会破坏注释里写的语义）。可选的两步：
  1. 让 `loadCatalogSync` 的失败路径**不要**再触发 `loadCatalogAsync` 重复拉取（实测两次都发了，说明同步那次返回的 `catalog` 没通过 `applyCatalog` 的形状校验 → 白拉一次）；
  2. 长线：把 `DEFAULT_BOOKMARKS` 改成 getter，在首次读取时才取 catalog，就可以全异步。
- **风险**：低（1）；中（2，碰到「常用栏首次渲染是占位」的回归点）。

### P12 · 两套缓存策略共存（`assets/` no-cache vs vendored 一天）

- **现象【实测】**：同一个 `GET` 里，`/monaco/vs/loader.js` 和 `/golden-layout/css/goldenlayout-base.css` 返回 `public, max-age=86400`，而 `/assets/*` 全是 `no-cache`。
- **根因【读码】**：`server.js:6293-6295` 与 `/golden-layout/` 走的是另一条 `streamStatic` 调用（`options.cacheControl` 传了长缓存），而 `/assets/` 没传。
- **收益**：合并后一致性提升；本身 0ms。
- **建议**：把「缓存策略」抽成一个 `cachePolicyFor(filePath, hashedUrl)` 函数，两条路径共用。这也是 P2/P3 的落地位置。
- **风险**：低（纯重构）。

### P13 · `/api/env` 无缓存，每次 10ms

- **现象【实测】**：`/api/env` 每次 **9.8~10.3ms**，响应 12.5 KB，首屏 + 每 60 秒各一次。
- **根因【读码】**：`app.js:14857` `setInterval(() => { if(!document.hidden) loadEnv(true, true); }, 60000)`；服务端没有像 `memoryStatus` 那样的 TTL 缓存（对比 `SYNC_STATUS_CACHE`、`DISK_CACHE`、`MEMORY_CACHE` 都有）。
- **收益**：60 秒 10ms ≈ **0.017% 的一个核**；【推断】它做的是环境探测（`clientEnvironment()` 会探 `localStorage`、`WebGL`、各种 API），真实耗时随探测项增长。
- **建议**：加 30s TTL 缓存（环境不会 30 秒变一次）；或把轮询间隔 60s → 300s。
- **风险**：极低。

---

## 3. 优先级矩阵（按 收益 ÷ 风险 排序，13 条）

> 收益 = 「本机实测可验证的改善」为主，慢环境推断为辅；风险 = 改错的概率 × 改错的后果。

| # | 条目 | 收益（实测基线） | 慢环境推断收益 | 风险 | 收益÷风险 | 改动量 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **T-01** | P8 三个 Monaco 轮询改事件驱动 | 唤醒 12.3/s → ≤3/s | 待机功耗 | **低** | ★★★★★ | 3 文件 / ~40 行 | 无 |
| **T-02** | P6 提高 system/status 缓存 TTL + 按需轮询 | 每 tab 每 3s 省 ~9ms + 2 次进程创建 | 服务端 CPU | **低** | ★★★★★ | 2 行 + 1 个条件 | 无 |
| **T-03** | P1 思维导图预热推后 | 首屏少 476 KB | FCP -80~250ms | **低** | ★★★★★ | 1 文件 / ~6 行 | 无 |
| **T-04** | P7 index.html 加 brotli + quality 5→9 | 每次导航 -13.0 KB；静态 -164.2 KB | load -50~150ms | **低-中** | ★★★★☆ | 2 文件 / ~25 行 | 无 |
| **T-05** | P9 `computeRev` 记忆化 | 每 3s 省 ~1ms 同步阻塞（多 tab 线性叠加） | 大 vault 下省 10~30ms/3s | **低** | ★★★★☆ | 1 函数 / ~8 行 | 无 |
| **T-06** | P4 批一：12 个经典脚本加 `defer` | 阻塞数 35 → 23 | FCP -100~200ms | **低** | ★★★★☆ | index.html 12 行 | 无 |
| **T-07** | P10 非首屏接口延后 | 首屏尾部 -172ms | load -200~400ms | **低** | ★★★★☆ | app.js 数处 | 无 |
| **T-08** | P5 合并 5 个首屏样式表 | 阻塞数 -4 | FCP -50~150ms | **中** | ★★★☆☆ | 1 脚本 + index.html | T-06 |
| **T-09** | P2+P3 内容哈希 + 长缓存 | 热加载 82 → ~28 请求 | 热加载 -150~300ms | **中** | ★★★☆☆ | server.js + index.html | **必须成对** |
| **T-10** | P4 批二：子系统按需注入 | 再少 246 KB / 9 请求 | load -300~500ms | **中** | ★★★☆☆ | 4-5 处注入点 | T-06 |
| **T-11** | P13 `/api/env` 加 TTL | 60s 一次 10ms | 可忽略 | **极低** | ★★★☆☆ | 3 行 | 无 |
| **T-12** | P11 去掉重复的 catalog fetch | 1 个请求 + 17ms 同步阻塞 | 一个 RTT | **低** | ★★★☆☆ | 1 分支 | 无 |
| **T-13** | P4 批三：`xterm.js` 按需 + P12 缓存策略收口 | 62.7 KB / 2 请求 | 一致性 | **中** | ★★☆☆☆ | 3 处 | T-06, T-09 |

**排序逻辑**：T-01~T-03 是「几乎不可能改错、且立刻可测」的三条，先做；T-04/T-05/T-06/T-07 是「单点小改、收益确定」；T-08/T-09/T-10 涉及布局与缓存语义，需要成组验证；T-13 最后做。

---

## 4. 可直接派单的执行计划（13 条）

> 每条都是**自包含**的：目标 / 改动边界 / 可测量验收。
> 「验收」一律写成**能跑出来的数字或命令**，不写「感觉快了」。

### T-01 · 把三个「等 Monaco」的轮询改成事件驱动

- **目标**：空闲态定时器唤醒从 **12.3 次/秒** 降到 **≤3 次/秒**（浏览器里实测）。
- **改动边界**：只允许改 `assets/code-theme.js`、`assets/code-theme-picker.js`、`assets/semantic-decorations.js` 三个文件的「等待循环」那几行（`code-theme.js:269-276`、`code-theme-picker.js:82-90`、`semantic-decorations.js:100-110`），以及**新增**一个 `window.whenMonaco`（若要做队列，新增文件 `assets/monaco-ready.js` 并在 index.html 加一行 `defer`）。**不许碰 `app.js`**。
- **约束**：三个文件各自都写了「纯渐进增强、失效时页面与没有它一致」，改造后必须保持这一点；兜底轮询上限 30 次（30 秒）后必须彻底停。
- **验收**（可测量）：
  1. `Performance` / CDP Tracing 采样空载 10s：`TimerInstall(timeout=200)` **< 10 次**（现值 98），`TimerInstall(timeout=400)` **< 5 次**（现值 25）；
  2. 打开一次 Markdown 编辑器后，**代码区主题立即（≤200ms）生效**、语义高亮正常（截图对比）；
  3. 不打开编辑器时，`window.monaco` 始终 `undefined` 且无报错（Console 0 error）。
- **回滚**：三个文件独立，可单独 revert。

### T-02 · `/api/system/status` 缓存 TTL 与轮询条件

- **目标**：单次 `/api/system/status` 从 **8.6~13.1ms** 降到 **<2ms**（缓存命中）；每 10 秒的子进程拉起次数从 **~6.7 次** 降到 **≤1 次**。
- **改动边界**：
  - `server.js:1748` `MEMORY_CACHE` TTL 1800 → **4000**；
  - `server.js:1771` `DISK_CACHE` TTL 5000 → **30000**；
  - `assets/app.js:731-748`：把 `loadSystemStatus` 从「无条件 3s」改成「顶栏 CPU 卡片在视口内且 `!document.hidden` 时 3s，否则 15s」（只在 `setInterval` 的回调里加判断，**不要改 `loadSystemStatus` 函数体**）。
- **约束**：`#sysmon-detail` 展开时必须是 3s 刷新（用户在盯着看）；`toggleSystemDetail` 点击后立刻补一次。
- **验收**：
  1. `for i in 1..10; do curl -w '%{time_total}' /api/system/status; done` → 中位数 **<3ms**，最大值 **<15ms**；
  2. `ps` 观察 60 秒内 `vm_stat` 与 `df` 的**启动次数**（`sudo fs_usage -w -f exec | grep -c vm_stat` 或用 `dtrace` 替代方案）→ `vm_stat` ≤15 次/60s（现值 ~20）；
  3. 顶栏 CPU 百分比仍**每秒级刷新**（视觉验证：数字变化间隔 ≤4s）。
- **回滚**：两个常量 + 一个条件，一行一个。

### T-03 · 思维导图引擎预热推后到「首屏后 + 有交互意图」

- **目标**：`/simple-mind-map/simpleMindMap.esm.min.js` 的**首个请求时刻**从 **321ms** 推到 **>8000ms**（无交互时）；首屏静态传输从 **1885.9 KB** 降到 **~1410 KB**。
- **改动边界**：只改 `assets/xmind-interaction.js:2167-2182`（`warmEngine` 那段 IIFE）。`ensureXmindEditorLib`（`app-draw.js:1024`）不动。
- **约束**：用户点开绘图 / 导图时**必须仍然立刻能用**（那就走 `ensureXmindEditorLib` 的原路径，1~2 秒等待可接受，且有既有的「引擎加载中」状态）。
- **验收**：
  1. 冷启动后不碰页面，Performance 资源列表里**没有** `/simple-mind-map/`（或它的 `startTime > 8000`）；
  2. 冷启动后**立刻**（500ms 内）点「绘图」→ 导图仍能打开（允许 1~2 秒等待，出现 loading 态）；
  3. 冷启动后把鼠标移到绘图入口 → 导图在 **≤1.5s** 内就绪（预热被 `pointerenter` 提前触发）。
- **回滚**：单文件单 IIFE。

### T-04 · index.html 走 brotli，brotli 质量 5→9

- **目标**：`GET /` 的传输体积从 **44601 B** 降到 **≤35000 B**；首屏静态总量从 1885.9 KB 降到 **~1720 KB**。
- **改动边界**：
  - `server.js:4577-4611` `indexAsset()` / `sendIndex()`：缓存里同时存 `gzip` 与 `brotli`，按 `accept-encoding` 选；
  - `lib/static-compress.js:19` `BROTLI_PARAM_QUALITY: 5` → **9**；同时把 `:20` 的 `CACHE.clear()`（全清）改成「删除最旧一条」（`CACHE.delete(CACHE.keys().next().value)`）。
- **约束**：`reading-block-editor.js/.css`（懒加载的 2.7MB/1.4MB）保持 q5 —— q11 对它们要 1s+。`Vary: Accept-Encoding` 必须保留，否则 CDN/代理会串味。
- **验收**：
  1. `curl -s -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}\n' http://127.0.0.1:4923/` → **≤35000**（现 44601 走的是 gzip；加 br 后应命中 br 分支）；
  2. `curl -s -H 'Accept-Encoding: gzip' ...` → 仍返回 gzip 且内容可解压（两个分支都要能跑）；
  3. `getComputedStyle` 抽查无变化（压缩不改内容）；
  4. 连续 200 次刷新内不出现「反复重压」（观察 `STATIC_GZIP_CACHE`/`CACHE` 尺寸稳定）。
- **回滚**：两个常量 + 一个分支。

### T-05 · `computeRev` 记忆化

- **目标**：`/api/rev` 在同一 1.5 秒窗口内的重复调用从 **0.7~1.1ms** 降到 **<0.05ms**；多标签页场景线性收益。
- **改动边界**：只改 `server.js:2760-2786` `computeRev()` 函数体（加一个 `{ at, value }` 模块级缓存，TTL 1500ms）。
- **约束**：**不能被前端感知到「改文件后 rev 不变」超过 1.5 秒**（前端 `syncLoop` 是 3 秒一次，1.5s 的 TTL 在 3s 窗口内最多命中 1 次，不会漏）。必须保证 `save` 路径（`lib/routes/save.js`）在写完后**主动失效缓存**——或者干脆把 TTL 设成 **500ms**（只吃多标签页重叠，不改变单标签语义）。
- **验收**：
  1. 两个标签页同时开 → 服务端 `computeRev` 调用计数从 2×/3s 降到 ~1×/3s（打日志或加计数端点验证）；
  2. 用编辑器保存一个文件 → 另一个标签页的 `/api/rev` 在 **≤4 秒**内返回新 rev（现值 ≤3s，允许 +1s）；
  3. `tests/smoke.js` 里 rev 相关断言全绿。
- **回滚**：单函数。

### T-06 · 批一：12 个经典脚本加 `defer`

- **目标**：`renderBlockingStatus === 'blocking'` 的资源从 **35** 降到 **23**；加载期那个 51~57ms 长任务消失（或 <50ms）。
- **改动边界**：只改 `index.html`，给下列 12 个 `<script src>` 加 `defer`：
  `arch-layout.js`、`arch-round.js`、`arch-graph-svg.js`、`arch-zoom.js`、`arch-ai-view.js`、`arch-view.js`、`app-pdf.js`、`debug-panel.js`、`run-history.js`、`draw-folder.js`、`draw-canvas-embed.js`、`xmind-interaction.js`。
- **硬约束【读码，不可违反】**：
  - `index.html:1177-1179`：`debug-panel.js` **必须在 app.js 之前**执行（`app.js` 启动时就调 `showDbgBar()`）→ 加 `defer` 后**执行顺序仍是文档顺序**，所以「在 app.js 之前」依然成立，但**两者都会推迟到解析完成后**；
  - `index.html:1185-1189`：`app-draw.js` 顶层声明 `let DRAW_*`（不是 window 属性），`app.js` 运行时读 → 本批**不动 app-draw.js**；
  - `index.html:1191-1197`：`app-reading.js` 是**硬约束**必须在 app.js 之前且 app.js 顶层直接取函数对象 → 本批**不动 app-reading.js**；
  - `index.html:1199-1203`：`cs-auth.js` **不能加 defer**（注释写明会漏掉首屏 401）→ 不动。
- **验收**：
  1. 冷启动资源列表里，上述 12 个的 `renderBlockingStatus === 'non-blocking'`；
  2. `PerformanceObserver` 的长任务（>50ms）在加载阶段从 **1 个**降到 **0 个**；
  3. **全功能冒烟**：打开绘图 / 架构视图 / PDF / 调试面板 / 运行历史各一次，Console 0 error（`tests/browser-smoke.js` 全绿）；
  4. FCP 不低于基线（**≤300ms**，本机现值 172~276）；
  5. 阻塞渲染资源 **35 → 23**（减掉这 12 个）。
- **回滚**：删掉 12 个 `defer` 属性。

### T-07 · 非首屏接口延后

- **目标**：首屏 20 个接口里，**7 个**（`/api/office/*`×4、`/api/git`、`/api/project/compile-db`、`/api/ai/config`）改到 `load` 事件之后 500ms 发出；首屏尾部延迟 **-172ms**。
- **改动边界**：只改 `assets/app.js` 里这些请求的**调用点**（包一层 `afterLoad(fn)` 工具），**不改接口实现、不改 server.js**。
- **约束**：`/api/version`（写 `.brand-version`）与 `/api/snippets`（渲染文件树）**必须留在原位**。
- **验收**：
  1. 首屏（`load` 事件前）请求数从 **81** 降到 **≤72**；
  2. `/api/sync/status` 与 `/api/office/service` 的首屏耗时从 **172ms** 降到 **<10ms**；
  3. `load` 时间从 **301~403ms** 降到 **≤250ms**（本机）；
  4. 打开 Git 面板 / Office 面板后数据正常出现（各截图一次）。
- **回滚**：把包装去掉。

### T-08 · 合并 5 个首屏样式表

- **目标**：`<link rel=stylesheet>` 阻塞数从 **16** 降到 **12**（5 个合成 1 个）；首屏样式请求从 16 降到 12。
- **改动边界**：`index.html:107-116`（`app.css`、`ui-kit.css`、`doc-theme.css`、`motion.css`）+ `:144`（`editor-chrome.css`）合成 `/assets/app.bundle.css`；新增一个`scripts/build-app-css.js`（照 `scripts/build-reading-editor.js` 的写法）。**不要动 `:11-15` 的 5 个**（它们有独立用途）。
- **硬约束**：合并后的拼接顺序**必须**是 `app.css → ui-kit.css → doc-theme.css → motion.css → editor-chrome.css`（`index.html:109-113` 的注释说明这五者靠「同特异性 + 后出现」协作，改顺序会静默改变外观）。
- **验收**：
  1. 阻塞样式表 16 → 12，阻塞渲染资源总数 35 → 31；
  2. **视觉回归**：合并前后对 5 个主题（`ocean/graphite/midnight/forest/light`）× 3 个视图（代码 / 阅读 / 工作台）各截一张图，`pixelmatch` diff **= 0**；
  3. `document.styleSheets.length` 从 21 降到 17（16 个外链 + 运行时注入的内联表）。
- **回滚**：恢复 5 个 `<link>`，保留 bundle 文件不引用。

### T-09 · 内容哈希 + 长缓存（**必须与 T-09b 成对**）

- **目标**：热加载请求数从 **82** 降到 **≤30**（只剩 20 个接口 + 轮询）；54 个 304 中 **≥50 个**变成直接从缓存命中（**0 请求**）。
- **改动边界**：
  - `server.js:4577-4611` `sendIndex`：输出 HTML 时把 `/assets/<name>?v=<token>` 的 `token` 替换成该文件**内容哈希前 8 位**（在 `indexAsset()` 里做一次，随 index 缓存一起失效）；
  - `server.js:4646-4690` `streamStatic`：新增 `options.cacheControl`，对 `/assets/*` 且 **URL 带 `?v=`** 的请求返回 `public, max-age=31536000, immutable`；**不带 `?v=` 的仍然 `no-cache`**（安全默认）。
- **硬约束**：
  - 必须保留 `/assets/hljs-theme.css` 等**极小文件**的 `no-cache`（1.1KB，不差这点）；
  - 不能改变 `/monaco/`、`/golden-layout/` 的现有行为（它们已经是一天缓存）；
  - **不做任何 git 写操作**。
- **验收**：
  1. `curl -s /` 里每个 `/assets/*?v=*` 的 `v` 值 = 该文件内容 sha256 的前 8 位（脚本比对）；
  2. 冷启动 → 刷新 → `page.on('requestfinished')` 统计：**静态资源请求数 ≤5**（其余应从 memory/disk cache 直接命中，Chrome 会报 `fromCache`）；
  3. 改一个 CSS（改 test fixture 里的副本即可）→ `v` 变化 → 页面**立刻**用新样式（不出现陈旧资源）；
  4. `tests/smoke.js` 全绿。
- **风险与回滚**：**中高**。做错 = 用户拿到陈旧 CSS/JS。回滚方式是**立即把所有路由改回 `no-cache`**（一个常量），所以务必让这一条单独成为一个 commit。

### T-09b · `ETag` 弱验证器 → 内容哈希

与 T-09 同批：`server.js:4652` `const etag = 'W/"' + stat.size + '-' + Math.floor(stat.mtimeMs) + '"'` → 改为 `sha1(内容).slice(0,16)`（可复用 T-09 算好的哈希）。
**验收**：`touch` 一个文件但不改内容 → `If-None-Match` 仍返回 **304**（现在会返回 200 + 全量内容）。
**风险**：低。需要每文件一次 `readFile`（有压缩缓存层可复用）。

### T-10 · 批二：子系统脚本按需注入

- **目标**：首屏静态传输再降 **227.8 KB / 9 个请求**（`system-panel.js` 90.9 + `study-workspace.js` 43.7 + `study-workspace.css` 5.1 + `code-guide.js` 52.4 + 5 个 `motion-*.css` 35.7）。
- **改动边界**：`index.html:27-31`（`study-workspace`、`system-panel`）、`:48`（`code-guide`）、`:122-132`（`motion-lw/sp/study/cg/dbg`）。实现方式：仿 `app.js:465-493` `loadBlockEditor`，做一个 `ensureAsset(id, href, onReady)`；注入点在这些面板的**打开函数**里。
- **硬约束**：
  - `system-panel.js` 的按钮在首屏就渲染（顶栏本机管家），所以**顶栏那个按钮不能依赖脚本已加载** —— 它必须在 index.html 里静态存在，或由 `app.js` 绑定；
  - `study-workspace.js` 的同步 XHR（P11）如果延后，就**不再阻塞首屏** —— 这是额外的收益，但必须确认它的**首次渲染质量**（占位数据问题，见 P11 风险）。
- **验收**：
  1. 首屏静态传输 **≤1640 KB**（从 1885.9）；
  2. 首屏请求数 **≤72**；
  3. 打开本机管家 / 学习工作台 / 代码指南各一次，功能与改造前**像素级一致**（截图对比）；
  4. 第一次打开各自面板的延迟 **≤300ms**（注入 + 执行的实测值）。
- **风险**：中。5 个注入点，任一漏了就是一个打不开的面板。

### T-11 · `/api/env` 加 TTL 缓存

- **目标**：`/api/env` 单次耗时从 **9.8~10.3ms** 降到 **<1ms**（命中）。
- **改动边界**：`server.js` 里 `/api/env` 的处理函数（参考 `SYNC_STATUS_CACHE` 的写法，TTL 30s）。
- **验收**：连续 10 次 `curl /api/env` → 中位数 **<2ms**；环境检测面板显示的内容与改造前一致。
- **风险**：极低。

### T-12 · 去掉重复的 site-catalog fetch

- **目标**：`/api/study/site-catalog` 首屏请求数 **2 → 1**；省掉一次 17ms 同步 XHR 之后的冗余拉取。
- **改动边界**：`src/study-sites.js:130-150`（`loadCatalogSync` 的返回判定与 `loadCatalogAsync` 的触发条件）。**保持同步 XHR 不动**（源码注释 :126-129 的理由成立）。
- **验收**：
  1. 首屏 `/api/study/site-catalog` 请求数 = **1**；
  2. 学习工作台的「常用网址」列表正确（截图对比）；
  3. 站点目录文件被外部修改后，重开工作台能看到新数据（这是 `loadCatalogAsync` 存在的理由，不能破）。
- **风险**：低。

### T-13 · 批三：`xterm.js` 按需 + 缓存策略收口

- **目标**：首屏再少 **62.7 KB / 2 请求**；`assets/` 与 vendored 目录共用一套缓存策略。
- **改动边界**：`index.html:26`（`xterm.js`）+ `:12`（`xterm.css`）改成终端打开时注入；`server.js` 抽 `cachePolicyFor()` 供两条 `streamStatic` 调用点共用。
- **硬约束【读码】**：`index.html:25` 的注释 —— **xterm 必须在 Monaco 的 AMD loader 注册 `window.define` 之前执行**，否则 UMD 被误判为 AMD 模块。按需注入时，如果 Monaco 已经起来了，就必须用 `<script>` 而非 `import()`，并且**先临时屏蔽 `window.define`**（`const d = window.define; window.define = undefined; ...; window.define = d;`）。**这一条是本次审计里技术风险最高的一处，建议最后做，且做之前先写一个专门的回归测试。**
- **验收**：
  1. 首屏无 `/assets/xterm.js` 与 `xterm.css`；
  2. 打开终端 → xterm 正常工作（截图 + 敲一条 `echo`）；
  3. **在已打开过 Monaco 的情况下**打开终端 → 仍正常（这条是 AMD 冲突的回归用例）；
  4. 阻塞渲染资源 ≤17。
- **风险**：中-高（AMD 顺序约束）。**如果时间不够，就只做 `cachePolicyFor` 收口那一半。**

---

## 5. 刻意不做 / 假阳性 / 前提纠正

### 5.1 前提纠正：`reading-block-editor.js`（2.7MB）**不在首屏**

- **【读码】** `assets/app.js:461-493` `loadBlockEditor()`：CSS 用 `<link data-block-editor-style>` 注入、JS 用 `<script async>` 注入，两者都在 `Promise.all` 里等就绪。注释明确写着「首屏不再加载：原来那份 CSS 还是阻塞渲染的」。
- **【实测】** 首屏 81 个请求里**没有**它（见 §1.1 的 59 条静态清单）。
- **结论**：它是「打开 Markdown 区块编辑器 / 阅读笔记」时的一次性代价（br5 **833.6 KB** + CSS **827.3KB** ≈ **1.63 MB**）。如果用户抱怨「打开某个阅读笔记要等一下」，那是**另一个问题**（可以做「进入阅读模式时预热」），但**不是首屏问题**。别把它写进首屏优化清单 —— 那会白改。
- **顺带一个可做的小优化**：这两个文件的 br 压缩比很差（JS 0.31、CSS **0.56**）。CSS 1.4MB→827KB 只压掉 44%，说明里面大量是**不可压缩的结构**（大概率是 base64 内嵌资源或枚举式颜色表）。值得单独看一眼 —— 但这需要拆包，属于独立议题。

### 5.2 假阳性：「idle CPU 12%」

- **【实测】** 空载 10 秒 `TaskDuration` = **32ms**（无节流）/ **49ms**（4× 节流）→ **0.3% / 0.5%**。长任务 **0 个**。详见 §1.8。
- 「12%」可能来自三种情况，本次**没有条件复现**：
  1. **真实 vault**（我这份隔离实例的 vault 是空的）→ `computeRev` 的遍历成本、`/api/snippets` 的解析成本都会上升（见 §5.3）；
  2. **工作台面板开着**（`life-workbench` 的 1s 秒针 + 20s 格言 + 60s 排期 + 75s 邮箱，见 §1.6B），以及 **生活工作台的 `render()`**；
  3. **浏览器开了多个标签页** → 轮询总和线性叠加（每个 tab 独立跑 3s/3s/30s/60s/60s/75s）。
- **【推断】最可能的是第 2 条**：工作台面板打开时，1 秒一次的 `tick` 虽然只改两个 DOM 节点（`life-workbench.js:4117-4124`），但 20 秒一次的格言、60 秒一次的排期轮询、以及任何一次 `render()`（`life-workbench.js` 里有大量 `render()` 调用点）都会重建整块面板。**这条需要用真实数据 + 打开工作台才能测准，本次没测。**

### 5.3 假阳性：「`render()` 整屏重建每 3 秒一次」

- **【实测】** 空载 10 秒 DOM 变更：`childList` **32** 次、`attributes` **28** 次、**没有一次**涉及 >300 个元素。
- **【读码】** `app.js:14287` 的 `syncLoop` 确实每 3 秒跑，但逻辑是 `GET /api/rev` → **只有 `rev` 变了才 `refresh(true)`**（`app.js:14280-14286`）。rev 不变 = 什么都不发生。
- **结论**：这个「3 秒整屏重建」在本机不成立。真正要担心的是「**vault 变化时** `refresh()` 的成本」，那是数据驱动的，不是定时的。

### 5.4 本次的局限（**执行者必须知道，别把推断当实测**）

| 局限 | 影响 | 怎么补 |
| --- | --- | --- |
| **vault 是空的** | `computeRev` / `/api/snippets` / 文件树的真实成本被严重低估；工作台面板因数据为空而没有渲染 | 用真实 vault 起一个**只读**实例（`CODESCOPE_VAULT=<真实>`），只发 GET，不点任何按钮 |
| **回环网络** | 所有「传输体积→时间」的换算都是**推断**；本机实测里字节几乎不花时间 | 用 Chrome DevTools 的 `Network.emulateNetworkConditions` 或 Network Link Conditioner 补测 |
| **没有 iCloud 冷文件** | 仓库和 vault 都在 iCloud 目录，冷启动时 `stat`/`read` 可能慢一个数量级 | `sudo purge` 后重测（本机权限未确认） |
| **工作台面板没打开** | `life-workbench` 的 1s/20s/60s/75s 定时器和 `render()` 频率**未实测** | 点开「我的工作台」再采一轮 |

---

## 6. 附录：复现步骤

### 6.1 起隔离实例（**不碰 4877**）

```bash
ROOT=/tmp/cs-perf-audit-$(date +%s)
mkdir -p "$ROOT/data" "$ROOT/vault"

cd masscode-runner
CODESCOPE_HOST=127.0.0.1 \
CODESCOPE_PORT=4923 \
CODESCOPE_VAULT="$ROOT/vault" \
CODESCOPE_DATA_HOME="$ROOT/data" \
CODESCOPE_ONLYOFFICE_URL=http://127.0.0.1:1 \
CODESCOPE_DSH_AUTOSTART=0 CODESCOPE_DSH_PORT=3199 \
CODESCOPE_AUTO_OFFICE=0 \
CODESCOPE_VSCODE_PORT=4978 CODESCOPE_VSCODE_INTERNAL_PORT=4999 \
node server.js
# 收尾：kill -9 <pid>（本次用 SIGKILL 结束）
```

（可选，让数据更真实）把真实 store 复制进去 —— **只复制，不改原件**：

```bash
cp "$HOME/Library/Application Support/CodeScope/life-workbench.json" "$ROOT/data/"
cp "$HOME/Library/Application Support/CodeScope/life-flow-schedule.json" "$ROOT/data/"
```

### 6.2 HTTP 层

```bash
# 头 + 压缩 + 指纹
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip, deflate, br' http://127.0.0.1:4923/
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip, deflate, br' http://127.0.0.1:4923/assets/app.js
# 单次成本
for i in $(seq 6); do curl -s -o /dev/null -w '%{time_total}\n' http://127.0.0.1:4923/api/system/status; done
```

### 6.3 浏览器侧（本文件所有 §1.1–§1.5 的数字都来自这套）

- `playwright-core` 在 `masscode-runner/node_modules` 里（1.63.0），Chrome 用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；
- 采数点：
  - **ResourceTiming**：`performance.getEntriesByType('resource')` 的 `transferSize / encodedBodySize / decodedBodySize / startTime / duration / responseStart-responseStart`、`renderBlockingStatus`；
  - **导航**：`performance.getEntriesByType('navigation')[0]`；
  - **FCP**：`performance.getEntriesByType('paint')`；
  - **LCP / 长任务**：`PerformanceObserver` + `buffered: true`；
  - **每脚本执行/编译**：CDP `Tracing.start({ includedCategories: ['devtools.timeline','v8','v8.execute','toplevel'] })`，然后按 `EvaluateScript` / `CompileScript` 的 `args.data.url` 聚合 `dur`；
  - **常驻主线程忙时**：CDP `Performance.enable` + `Performance.getMetrics` 的 `TaskDuration` 增量；
  - **轮询频率**：CDP Tracing 的 `TimerInstall`（`args.data.timeout`）与 `TimerFire`（`args.data.timerId`）；**不要**用「页面里 patch `setInterval`」以外的办法猜 —— 本次两种方法交叉验证过，一致；
  - **DOM 变更**：`MutationObserver` 在 `documentElement` 上 `childList/attributes/characterData`，统计**单次批次涉及的 element 数**（判断是否整屏重建）。

### 6.4 关键实测值速查（供执行者做前后对比）

| 指标 | 2026-10-31 基线 |
| --- | --- |
| 冷启动请求数 | **81** |
| 首屏静态传输 / 解码 | **1885.9 KB / 6774.5 KB** |
| 阻塞渲染资源 | **35** |
| JS 执行 + 编译合计 | **49.2 ms** |
| FCP（无节流 / 4×） | **172~276 ms / 240 ms** |
| LCP（无节流 / 4×） | **440~572 ms / 1136 ms** |
| DCL | **297~392 ms** |
| load | **301~403 ms** |
| 加载期长任务 | **1 个（51~57 ms）** |
| 空载 10s 主线程忙时 | **32 ms（0.3%）** |
| 空载 10s 长任务 | **0 个** |
| 空载 10s 定时器重装 | **200ms×98 + 400ms×25** |
| 空载 10s 网络请求 | **8 个** |
| 热加载请求数 / 304 | **82 / 54** |
| 热加载有效传输 | **46.6 KB** |
| `/api/system/status` | **8.6~13.1 ms** |
| `/api/rev`（空 vault） | **0.7~1.1 ms** |
| 首屏阻塞样式表（`<link>`） | **16** |
| 首屏无 `defer` 的经典脚本 | **19**（其中 `cs-auth.js` 是**有意**不加） |
| 阻塞渲染资源合计 | **35**（16 + 19） |
| 堆 / DOM 节点 | **11.1 MB / 2639~6784** |

---

## 7. 一句话结论

**这个应用的首屏不慢在「下载」，慢在「下载了 66% 用不到的东西、而且下次也不给缓存」。**
三条改动（T-01 / T-02 / T-03）一共不到 50 行，能立刻把常驻唤醒和首屏字节打下来，且几乎不可能改错 —— 建议先做这三条，再评估 T-04~T-09。
