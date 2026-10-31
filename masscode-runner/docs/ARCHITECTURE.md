# CodeScope 架构

> 本文档里的**每个数字都是从代码里量出来的**（`wc -l` / `grep`），不是估计值。
> 出处见每节末尾的「源证据」。
>
> 学自 [Archify](https://github.com/tt-a1i/archify) 的三条做法：
> ① **节点要带源证据**（能追到文件/行数，图才不会变成"想象"）；
> ② **架构是可校验的**（能写成断言，而不是只靠人看图）；
> ③ **图要能对比变化**（否则画完就过时）。

---

## 一、分层

```
浏览器
  index.html          1,219 行  ← 已抽外链（原 1,771 行）；2026-10-28 加了 cs-auth.js 一行
  assets/app.js      14,883 行  ← ★ 2026-10-28 抽出阅读文库/知识库 + 绘图/XMind 渲染层（原 17,466 行）；同日动效审计 008/010 再 +20（代码 +5）菜单「展开/收起」失效；2026-10-31 T-01 改事件驱动（Monaco 等待轮询）再 +6
  assets/xmind-interaction.js  399 行  ← ★ 2026-10-26 抽出来的（思维导图鼠标/键盘/框选/平移）
  assets/debug-panel.js  879 行  ← ★ 抽出来的（断点 / 单步 / 变量表）
  assets/arch-layout.js     481 行  ← ★ 抽出来的（架构图**布局 + 走线**，纯数据不碰 DOM）
  assets/arch-graph-svg.js  132 行  ← ★ 抽出来的（把布局数据画成 SVG）
  assets/arch-view.js    137 行  ← ★ 抽出来的（架构图面板集成 + 缩放平移）
  assets/app.css      4,839 行
  src/                 9,485 行  ← 10 个独立视图
        │  HTTP / SSE
        ▼
服务端
  server.js           9,566 行  ← 215 个端点 / 22 组；2026-10-31 T-04 静态压缩 brotli q11 收口（净 −4 行代码）
        │  函数调用
        ▼
领域服务 lib/        17,154 行  ← 35 个模块
        │  子进程 / 网络
        ▼
外部运行时
  OnlyOffice · code-server · DeepSeek Harness · Octave / Python
```

**源证据**：`wc -l server.js assets/app.js assets/app.css index.html lib/*.js src/*.js`；
端点数 `grep -oE "'/api/[a-z0-9-]+" server.js | sort -u | wc -l`。

### 无限画布（`canvas`）· 移植 tldraw 5.5.2

绘图面板的第四种类型，`.canvas` 文件，内嵌在面板里（**不新开窗口**，和 Draw.io 同套路）。

| 文件 | 作用 |
|---|---|
| `assets/canvas/index.html` | 宿主页：`?file=` → 读 vault；改动防抖 1.2s 存盘；**关闭前 `sendBeacon` 兜底** |
| `assets/canvas/canvas-theme.css` | 主题层：把 tldraw 的「近黑 + 冷紫」换成 CodeScope 石墨灰（30 个 `--tl-color-*`）+ 左侧功能条 / 面包屑 / 子白板卡片样式 |
| `assets/canvas/canvas-ext.js` | 功能层：插入 图片 / 视频 / 网页 / PDF、子白板、页面导航、一键绑定连线 |
| `assets/draw-canvas-embed.js` | 把宿主页以 iframe 嵌进 `#canvas-root`，并和其它编辑器互斥 |
| `assets/vendor/tldraw.bundle.js` | esbuild 打的 IIFE（React 19 + tldraw），必须 `--jsx=automatic` |
| `assets/vendor/tldraw-assets/` | **自托管**图标 sprite / 字体 / 翻译 / 嵌入图标（84 个文件，2.75 MB） |
| `assets/pdfjs/` | PDF 渲染（含 **cmaps** —— 没有它中文 PDF 整片空白） |
| `lib/drawings-asset.js` | 图片 / PDF 页 / 视频落盘：`<vault>/.canvas-assets/<sha1>.<ext>` |
| `assets/vendor/tldraw.LICENSE.md` | 授权原文（分发需附带；**水印不得移除**） |

四条关键决定：

- **不用 `persistenceKey`** ✓：vault 里的 `.canvas` 是唯一真相源 ✓。tldraw 自带 localStorage
  会再写一份 ✓，换文件时残留内容串味、删掉的文件还能复活 ✗。
- **静态资源必须自托管** ✓：tldraw 的图标是 CSS `mask: url(<cdn>/…svg#id)` ✓，
  `cdn.tldraw.com` 不通时工具栏**只剩高亮方块**（没有图标）✗ —— 用
  `setDefaultUiAssetUrls()` / `setDefaultEditorAssetUrls()` 改指本地 ✓。
- **二进制不进 .canvas** ✓：tldraw 默认 `inlineBase64AssetStore` ✗ —— 一页 A4 渲染成 PNG
  约 880KB（base64 后），24 页 PDF 会把画布撑到 20MB+ ✓，而且每次防抖保存都要
  `JSON.stringify` 整张画布 ✗。改成 `assets={{ upload, resolve }}` 存盘后，同样一页只剩 **3KB** ✓。
- **子白板 = page + `meta.parentId`** ✓：`props.pageId` 指向子页，子页 `meta.parentId` 指回父页 ✓，
  两边都存 → 卡片能往下跳、面包屑能往上走 ✓，可无限嵌套 ✓。
- **网页用自己写的 `webcard` 图形，不用 tldraw 的 `embed`** ✓：tldraw 只对白名单站点
  （YouTube / Figma / CodePen…）真内嵌 ✓，其它 URL 一律退化成 bookmark 链接卡片 ✗
  （就是「只剩一行裸网址」那种）；就算硬塞进 `embed`，没匹配到定义时用的是
  `unknownEmbedShapePermissionOverrides`（`allow-same-origin: false`）✗ → 页面白屏。
  `webcard` 自己定沙箱 ✓、顶栏带「重载 / 浏览器打开」✓、双击进交互态（不交互时
  `pointer-events: none` 让图形可拖）✓。**顶栏不能吞 `pointerdown`** ✗ —— 吞了 tldraw
  收不到双击，永远进不了交互态 ✓。
- **分组 / 包含关系直接用 tldraw 的 `frame`** ✓：frame 天生是容器 —— 拖进去自动变成它的
  child ✓、拖出来自动解除 ✓、frame 还能套 frame（无限嵌套）✓，不用自己造树结构 ✓。
  「组合」= 建一个 frame 盖住选区 + `reparentShapes()` ✓（它会保持**页面绝对位置**，
  换爹不会跳位 ✓）；「解组」= 先把孩子 `reparentShapes` 回 page ✓ **再**删框 ✗
  （直接删框会把孩子一起带走）。
  侧栏大纲按 `getSortedChildIdsForParent()` 递归画成树 ✓；行内 ↑↓ 交换兄弟的
  `x/y + index` ✓（画布上看得见的那种调顺序）。
  ⚠️ frame 的填充是**写死的 `#0c0c0c`** ✗（比画布还黑，像个洞）—— 用 CSS
  `.tl-frame__body { fill: … !important }` 盖掉 SVG 的 presentation attribute ✓。
- **分组框自适应**：tldraw 的 frame **不会**跟着孩子长大/缩小 ✗ —— 拖进去一张卡片，
  框还是原来那么大，卡片就戳到框外面。补了一个 `fitFrame()`：
  ①只在**子节点变化**时触发 ✓（用户手动拉大框不会被抢回去）；
  ②拖动/缩放**过程中不动** ✓（中途改孩子的相对坐标会和 tldraw 的临时变换打架），
  等操作停了（`select.translating` 退出）再贴；
  ③框往左上长时**同步反补孩子的相对坐标** ✓ —— 孩子的**页面位置保持不动**；
  ④打开旧画布时只**撑大**不缩小 ✓（`growOnly`），且 `loadSnapshot` 期间要屏蔽 ✗
  （一次换整个 store 会被当成"用户挪了孩子"，把所有框缩回去）。

- **对齐：自己画参考线，不指望 tldraw 的 snap 指示器** ✓。实测 tldraw 的 `isSnapMode`
  只对**网格**生效（拖到 x≈3 吸到 0、x≈9 吸到 10），形状之间的对齐参考线在这个嵌入环境里
  `editor.snaps.getIndicators()` 恒为 0、屏幕上什么都没有 ✗。所以自己算：
  拖动中（`editor.isIn('select.translating')`）拿被选图形的 **左/中/右 × 上/中/下** 和
  其它图形的同三条边比，差在 6 屏幕像素内就画一条红线 ✓；**松手时**再把位置吸过去（4px 内）✓。
  ⚠️ `pointerup` 里必须先判 `isIn('select.translating')` ✗ —— 单击选中也会走 pointerup，
  不判断的话点一下就把图形悄悄挪 4px ✓（实测：单击 420→420 不动、拖动 →0 ✓）。
  另外补了**对齐工具条**（选中 ≥2 个出现）：六个方向 + 水平/垂直等距；
  选中分组框时出现「整理」= 按大纲顺序竖排 + 自动贴合 ✓。

- **★ 保存必须有「载入完成」闸门**（`assets/canvas/index.html` 的 `ready` / `loadFailed`）：
  `window.__tldrawSnapshot` 在 `onMount` 就有了，而 `load()` 还要等 `fetch` ✓ ——
  这中间如果切文件/关面板触发 `flush()`，就会拿**一张空画布**把磁盘上的文件覆盖掉 ✗
  （2026-10-25 真的发生了一次，整块板被清空）。所以：`save()` 和 `flush()` 都必须
  `if (!ready || loadFailed) return;` ✓，读取失败时**永久停用保存**并提示 ✓ ——
  读不出来就不该写回去。服务端再补一道：写入前把旧文件复制成 `<name>.canvas.bak` ✓。

- **★ 三层防「空覆盖」**（缺一层都会重演）：
  ① `__tldrawLoad` 必须**返回成败** ✓ —— 以前把异常吞了，上层会把「载入失败」当成
  「载入成功（空画布）」，然后拿空画布覆盖文件；
  ② 客户端记住载入时的图形数 `loadedShapes`，`save()`/`flush()` 里只要
  「原来有、现在 0」就拒绝写入 ✓；
  ③ **服务端** `lib/drawings-asset.js` 的 `canSaveCanvas()` 再拦一道 ✓ ——
  浏览器可能还跑着旧版前端（没刷新），只有服务端拦得住 ✓。

- **画布内思维导图**：节点是自定义图形 `mnode`（`props { w, h, text, color }`），
  父子关系存在 **`shape.meta.mmParent`** ✓（不占 props，改结构不用迁移 ✓）。
  连线**不用绑定箭头** ✗ —— 位置由布局算死，绑定没意义；每次 `mmLayout()` 后
  删掉所有 `meta.mmLink` 的箭头再重建 ✓。
  布局是向右生长的整齐树：先递归量每个**子树高度**，再把子节点块垂直居中到父节点 ✓；
  框往左长不动、只往右长，所以父节点位置稳定 ✓。
  操作：`Tab` 加子节点 / `Enter` 加同级 / 节点工具条（＋子节点、＋同级、排版、删除）。
  ⚠️ **节点默认文本必须为空** ✗ —— 带默认文字的话进编辑态光标在末尾，
  打字会**追加**成「中心主题项目规划」✓（改成空文本 + 灰色占位符）。
  ⚠️ **选中状态在 `session` 作用域** ✗（`instance_page_state`）—— 只监听
  `{scope:'document'}` 的话，取消选中后工具条不会消失 ✓（要再挂一个 session 监听）。

- **PDF 用一张 `pdfcard`，**连续滚动**阅读（不是一页一页翻）** ✓：最早是把每页渲染成
  图片铺在画布上 ✗（3 页原理图 = 3 张巨型图）；后来改成一张卡里 `‹ ›` 翻页，用户还是要滚动 ✓；
  现在所有页**竖着排在同一个滚动区**里 ✓，滚到哪页标题栏就显示 `2/3` ✓，
  右下角浮 `− 100% +` 缩放条（不随内容滚走）✓。
  所有页都上传成文件 ✓，卡片里只存 URL（`props.pages` 用 `\n` 拼）✓。
  **分辨率必须 1800px 宽、PNG 无损** ✓ —— 900px 在视网膜屏上要放大 1.5 倍才填满卡片，
  看着糊；WebP 有损压缩会把原理图那种细线压发虚。
  **正文层要 `pointer-events: auto` + `overflow: auto`** ✓ 才能滚 —— 代价是拖卡片得抓顶栏
  （所以顶栏不能吞 `pointerdown`）；图片加 `loading="lazy"`，几十页也不会一次全解码 ✓。
  ⚠️ **光有 `overflow:auto` 滚不动** ✗：tldraw 在画布上监听 `wheel` 做平移/缩放，
  指针明明在 PDF 正文上，滚轮照样把画布平移了（实测：`scrollTop` 不变、`camera.y` 直接 -400）。
  必须在 **`window` 捕获阶段**把事件抢下来 ✓ —— 比画布上的监听更早，
  `preventDefault + stopPropagation` 之后**自己改 `scrollTop`**（默认滚动也被 prevent 掉了）。
  内容不溢出时放行 ✓，画布缩放/平移不受影响。

- **便签 `sticky`（自定义）**：tldraw 自带的 `note` **props 里没有 w/h**（只有
  `size` / `growY` / `scale`），尺寸自动算、`hideResizeHandles()` 恒为 true ✗ ——
  选中没有缩放把手、拖不动大小。所以自己写一个带 `w/h` 的 `sticky` ✓（自由缩放 ✓、
  双击改字 ✓、颜色走 `DefaultColorStyle` ✓），并把工具栏的 `tools.note` 隐藏 ✓，
  避免两个"便签"并存。
- **入口不重复**：媒体插入放在左侧功能条，tldraw 工具栏的 `tools.asset`（媒体）用 CSS 隐藏 ✓。
- **卡片标题不重复**：正文渲染前先用 `bodyMarkdownOf()` 摘掉开头那个 `# 标题` ✗ ——
  它已经显示在彩色标题栏里了，不摘就是同一行标题出现两次 ✓。

- **笔记卡片 `card`**：彩色标题栏 + Markdown 正文（`marked` + 手写消毒）✓，标题取正文里
  第一个 `# 标题` ✓（只维护一份内容），颜色复用 tldraw 的 `DefaultColorStyle` ✓
  （右上角样式面板的色板直接能改 ✓）。正文按内容**只增不减**地自动长高 ✓。
  图片进卡片有三条路：**拖文件到卡片上 / 编辑时粘贴 / 标题栏的插图按钮** ✓，
  三条路都落到 `![](<url>)`（上传到 `.canvas-assets/`，不塞 base64）✓。
  拖放那条必须用**捕获阶段**的 `window` 监听 ✗ 否则 tldraw 先在画布上建一个图片图形，
  图片就跑到卡片旁边去了 ✓。
  两个坑：①自动长高必须量**内层内容** `.cs-card__md` ✗ 不能量 `flex:1` 的容器
  （它的 `scrollHeight` 恒等于自身高度 → 每帧 +58 → 无限自增 → tldraw 白屏）✓；
  ②只靠 textarea 的 `autoFocus` 不行 ✗，tldraw 随后会把焦点收回 `.tl-container`，
  必须 `requestAnimationFrame` 里手动 `focus()` ✓，并且**输入即提交**（tldraw 退出编辑态
  是直接卸载组件，`onBlur` 不保证先到）✓。图片是异步加载的，`img.onload` 之后要**再量一次**
  高度 ✓，否则图会被裁掉。
- **`createShapeId('xxx')` 会返回固定 id** ✗（`shape:xxx`）—— 第二次调用就撞车：
  第二张卡片建不出来、第二条连线把绑定全叠到同一条箭头上 ✓。一律无参调用 ✓。

⚠️ **v5 的 `createShape` / `createPage` / `createBindings` / `createShapesForAssets` 都返回
`editor` 本身**（链式）✗ —— 拿不到新建的记录 ✓，必须用 `createShapeId()` 显式给 id，
或者用「前后 id 差集」反查 ✓。

### 已做的拆分（棘轮在往下走）

| 日期 | 动作 | 效果 |
|---|---|---|
| 2026-10-10 | `ceff78b` 把内联脚本抽成外链 | 重复打开 595 KB → 43 KB |
| **2026-10-11** | **抽出调试面板** + **路由模块化：25 组抽到 lib/routes/** | app.js 17,142 → 16,294；server.js 9,084 → 8,263 |
| **2026-10-11** | **架构视图重写走线**（涨到 16,737 → 棘轮红）→ **抽出 `assets/arch-view.js`** | app.js 16,737 → 16,356；上限**往下拧**到 16,356 |
| **2026-10-11** | 架构图加**自由缩放 + 卡片折行**（arch-view.js 涨到 611 → 棘轮又红）→ **再拆成纯画图 + 面板集成** | arch-view.js 611 → 467 + 137 |
| **2026-10-11** | 架构图加**主干合并（总线画法）**（arch-graph-svg.js 涨到 550 → 棘轮又红）→ **按管线拆：布局+走线 \| 画 SVG** | arch-graph-svg.js 550 → 436 + 132 |

⚠️ 抽完之后**棘轮要同步调小**（`tests/architecture.js` 里的 `SIZE_CAP`）——
否则下次有人涨回去也不会红，**棘轮就白上了**。


---

## 二、API 分组（22 组，按端点数排序）

| 组 | 端点数 | 组 | 端点数 |
|---|---|---|---|
| `/api/life` | 58 | `/api/git` | 6 |
| `/api/readings` | 31 | `/api/term` | 5 |
| `/api/office` | 22 | `/api/libraries` | 4 |
| `/api/drawings` | 11 | `/api/ai` | 4 |
| `/api/remote` | 9 | `/api/timeline` | 3 |
| `/api/fs` | 9 | `/api/py` | 3 |
| `/api/project` | 7 | `/api/integrations` | 3 |
| `/api/latex` | 7 | 其余 8 组 | 各 1–2 |
| `/api/sync` `/api/study` `/api/knowledge` | 各 6 | | |

**源证据**：`grep -oE "'/api/[a-z0-9-]+" server.js | sed "s|'/api/||" | sort | uniq -c | sort -rn`

---

## 三、lib/ 的职责（前 10 大）

| 模块 | 行数 | 职责 |
|---|---|---|
| `system-panel.js` | 2,471 | 系统状态面板 |
| `knowledge-base.js` | 1,406 | 知识库（VitePress 生成） |
| `remote-sync.js` | 1,384 | 双向同步 |
| `system-files.js` | 1,217 | 文件系统能力 |
| `code-server-service.js` | 1,068 | 托管 code-server |
| `system-software.js` | 683 | 软件安装 |
| `imap-client.js` | 679 | 邮件 |
| `roots.js` | 613 | 路径/根目录策略 |
| `workflow.js` | 598 | 工作流 |
| `code-graph.js` | 587 | 代码图（CFG） |

**源证据**：`wc -l lib/*.js | sort -rn | head -10`

---

## 四、可改进项（按性价比排序）

### P0 · 两个巨型单文件

⚠️ **行数写两个** ✓（总行 / **代码行**）—— 棘轮守的是**代码行** ✓（见下）。

| 文件 | 现状 | 问题 |
|---|---|---|
| `assets/app.js` | **14,877 行 / 13,000 行代码 / 0.9 MB**（原 17,466） | 改任何一处都要**通读**；`git blame` 失效；无法按需加载 |
| `server.js` | **9,566 行 / 7,863 行代码 / 223 端点**（原 9,084） | 还留着一批端点没归组；加一组新 API 仍要动同一个文件 |
| `assets/life-workbench.js` | **14,111 行 / 926 KB** | 生活工作台整块；下一个该拆的 |
| `assets/app.css` | **4,839 行 / 4,212 行代码** | 样式也很大；按面板拆成几个文件是下一步 |

#### ★ 棘轮的度量换成了「代码行数」（2026-10-11）

原来守的是**总行数** ✗ —— 但这个项目的风格就是**注释多** ✓（把"为什么"写清楚 ✓），
于是加一段解释就红 ✓，只有两条路：砍注释 ✗、或调上限 ✗，**两条都在毁掉棘轮** ✓。
（实测：v3.1.0 为了不调上限，一天里**拆了 4 次文件、压了 7 次注释** ✓，
已经压到"再改一行就红" ✓ —— 那不是棘轮，那是镣铐 ✓。）

⇒ 现在只数**非空、非注释**的行 ✓：**注释可以随便写 ✓，代码要克制 ✓**。
上限**全部重新量过** ✓（不是"往上调" ✓ —— 代码行数普遍比总行数小 ✓）。

**已经做对的一半**：`ceff78b` 把内联的 1,049 KB 抽成了外链
（重复打开 595 KB → 43 KB，省 93%）。**但那是"传输层"的拆分，不是"代码层"的。**

**建议**：按**已有的天然边界**拆 —— `server.js` 的 22 个 `/api/*` 前缀就是现成的模块边界，
一个前缀一个文件（`routes/life.js` / `routes/office.js` …），
`server.js` 只留「挂载 + 中间件」。`app.js` 同理，按面板拆。

### P1 · 架构图会过时 —— ✅ **已做**（v3.1.0）

原话是「现在没有架构图」。**现在有了** ✓ —— 而且是**带源证据 + 有变化检测**的：

- 代码图谱面板里的 **▦ 架构** 视图：按片段顺序横向排开，一个片段一张卡片，卡片里列函数 ✓；
- **走线几何上不可能穿方块**（卡片间隙当纵向通道、行间当横向通道）✓，
  同源的线**合并成主干 + 带箭头的横档** ✓；
- **每个数字都能自己跑一遍**：`tests/arch-geom.js` 把「穿块 / 端点重叠 / 箭头落点 /
  折返 / 圆角半径」全断言了 ✓ —— 不是画完就完事 ✓。

「重构进度可观测」那条也落了地：`tests/architecture.js` 里有一张 **SIZE_CAP 棘轮**
（每个文件一个行数上限 ✓），超了就红 ✓。

### P2 · 缺「架构断言」这一类测试 —— ✅ **已做**（v3.1.0）

当时「50 个测试全是功能测试，没有一条在守结构」。**现在有了** ✓：

| 建议 | 现状 |
|---|---|
| 没有任何单文件超过 N 行 | ✅ `tests/architecture.js` 的 **SIZE_CAP 棘轮**（13 个文件）|
| 模块间没有循环依赖 | ⬜ 还没做 |
| 每个 `/api/*` 分组都有测试 | ⬜ 还没做 |
| 前端不 fetch 未登记的端点 | ⬜ 还没做 |

另外**超出原建议**、这次新加的两类结构断言 ✓：

- **`tests/architecture.js`**（56 条）：路由模块化的进度、**「依赖用 ctx 显式传」的完整性**
  （这条是**真抓到过 bug 的** ✓ —— 三个路由模块漏了依赖，一调就 500 ✓）、
  文档里的数字 vs 代码、有没有遗留标记；
- **`tests/arch-geom.js`**（33 条）：架构图的几何不变量（见 P1）。

⚠️ **还有一件事原建议没提到，但这次踩到了**：
`tests/` 下有 **51 个测试，而 `npm test` 只串了约 30 个** ✓ ——
剩下 20 来个**没有任何入口、没人跑** ✓，上面那 3 个 500 的 bug 就藏在里面 ✓。
⇒ 新增 **`npm run test:all`**（跑每一个测试 + 超时 + 汇总 ✓）。
**「测试没接进入口」= 等于没有测试** ✓。

### P3 · 前端状态没有单一真相

`app.js` 里 `CURRENT` / `CINDEX` / `EDITING` / `DEBUG` / `BREAKPOINTS` …
都是模块级可变全局。多个面板（变量面板 / 输出 / 调试条）都在读它们，
**改一个要记得通知其他几个**（这次做「自动刷新」就踩到了：
面板关掉后必须清引用，否则会去动已移除的节点）。

**建议**：把跨面板共享的状态收进一个 `state` 对象 + 一个极简的订阅
（`on('debug:line', fn)`），比"记得手动同步"可靠。

### P4 · 文档与代码的双向引用

`README.md` / `CHANGELOG.md` / `docs/` 都有，但**代码里不指向文档**，
文档里也不指向代码。

**建议**：像本文这样，**每个数字都写清是哪条命令量出来的**。
下次有人问「这数还准吗」，他**能自己跑一遍**。

---

## 五、这次自检量到的健康度（v3.1.0 重新量过）

| 项 | 结果 |
|---|---|
| `npm test` | ✅ 全绿（架构 56/56、几何 33/33、语义层 41/41、smoke 595、平台 38/38）|
| `npm run test:all`（51 个测试） | ✅ 50 个通过；剩 1 项是**测试自己的前置条件没造出来**（内容没超出容器）|
| `browser-smoke`（原来是"陈年红"） | ✅ **修好了** —— 两个真因：① VNC 按钮的可用性来自**服务端**（本机没装 VNC 客户端 → 按钮恒灰 → 点不动 ✓），补了 mock；② **Tab 缩进有两个真相源**（`INDENT_WIDTH\|\|2` vs `indentUnit()`）→ Python 探到 4 却插 2 ✓ |
| 架构图全库几何回归（12 个文档） | ✅ 穿块 **0**、端点重叠 **0** |
| TODO / FIXME / HACK | ✅ 只剩 vendor CSS 里 1 处（不是我们的代码）|
| 路由模块的 ctx 依赖 | ✅ 完整性有断言守着（之前漏了 3 个 → HTTP 500）|

✅ **棘轮的度量已换成「代码行数」**（2026-10-11，见上面 P0 那节 ✓）——
原来 13 个上限里 11 个顶格 ✓，加一段解释就红 ✓，只能砍注释或调上限 ✗，两条都在毁掉棘轮 ✓。
现在只数**非空、非注释**的行 ✓：上限**全部重新量过** ✓（不是往上调 ✓）。

实测：给 `arch-layout.js` 加 **5 行纯注释** → 旧度量 **486 > 481 红** ✗、新度量 **绿** ✓；
加 **1 行代码** → **红** ✓（棘轮还在 ✓，只是不再误伤注释 ✓）。
| 单文件最大行数 | ⚠️ `assets/app.js` 17,142 行 |
