# 018 · 码境 CodeScope 全站逐页自检报告

> 目标：不等用户撞上，主动把**近三次同类回归**（自建入口被懒加载 / 交互在脚本里却被懒加载 / 改加载时机没算 ES module 时序）在全站范围排查一遍，能修的直接修。
>
> 机器：macOS · Node v26.7.0 · Chrome（playwright-core 驱动）· 隔离实例 `CODESCOPE_PORT=4955~4972`
> 全部用例都在**临时 vault + 独立 `CODESCOPE_DATA_HOME`** 上跑（`os.tmpdir()`），用完 SIGKILL 并断言端口释放。

---

## 0. 结论摘要

| 项 | 结果 |
| --- | --- |
| 逐页执行次数（有效轮次） | **136 次**（每个入口一次独立页面） |
| `pageerror` 总数 | **0** |
| 脚本级 `console.error` | **0**（36 条全是**资源级** 404/403/503/CSP 与外部依赖，见 §5） |
| 可见错误文案命中 | **1 条**，且是产品文案里自带的 `✗`（见 §5.5），不是故障提示 |
| 查出并修掉的真问题 | **1 个**：`<script defer>` 的模块被 `csLoadScript` **再注入一次并执行第二遍**（第 2 类回归的残留变体） |
| 三类回归清单 | 自建入口 **8** 条 / 按需注入 **8** 条 / 求值读全局 **12** 条；其中「有风险」**1 条（已修）**、「安全但脆弱」**1 条（未修，有理由）** |
| 回归测试 | `architecture.js` **91/91** ✅ · `undefined-refs.js` ✅（18 个脚本）· `smoke.js` **604 passed** ✅ |
| 项目自带 `browser-smoke.js` | **改前改后同样失败**在同一步（:671）⇒ 与本次改动无关（A/B 证据见 §6.4） |

---

## 1. 方法与自检工具

### 1.1 隔离实例

```bash
CODESCOPE_HOST=127.0.0.1 CODESCOPE_PORT=49xx \
CODESCOPE_VAULT=<tmp>/vault CODESCOPE_DATA_HOME=<tmp>/data \
CODESCOPE_ONLYOFFICE_URL=http://127.0.0.1:1 CODESCOPE_DSH_AUTOSTART=0 CODESCOPE_AUTO_OFFICE=0 \
node server.js
```

夹具（`tmp/selfcheck/fixture.js` + `fixture2.js`，均在 `os.tmpdir()` 下）：

- `vault/code/`：3 个片段（C / Markdown / LaTeX）+ 标签注册表（2 个标签）
- `vault/drawings/`：`flow.drawio` / `board.canvas` / `mind.xmind`（xmind 用 `jszip` 现造真 zip，含 `content.json`）
- `vault/readings/selfcheck-reading/`：`note.md` + `manual.pdf`（手写最小 PDF）+ `guide.docx`（`docx` 包生成）+ `官方文档.url`
- `vault/office/`：`demo.docx`
- `data/life-workbench.json`：1 篇日记 + 3 个分类；`data/site-catalog.json`：1 个分类 1 个站点

### 1.2 每个入口的采集

每个用例**新开一页** → `goto(waitUntil:'load')` → 稳定 1.5s → 执行操作 → **等 3.5s** → 采集：

| 采集项 | 实现 |
| --- | --- |
| JS 异常 | `page.on('pageerror')` |
| 控制台错误 | `page.on('console')`（仅 `type==='error'`，带 `location().url`） |
| 网络失败 | `page.on('requestfailed')` + `page.on('response')` 里 `status>=400`（记完整 URL） |
| 可见错误文案 | `document.body.innerText` 扫 `没加载上 / 未加载 / undefined / 加载失败 / Error / ✗ / 请重启 / is not defined / Cannot` |
| 入口是否真的生效 | 每个用例带 `probe(page)`：面板可见性、页签 `on` 状态、DOM 节点数、脚本标签数等 |

### 1.3 ⚠️ 一次自检事故（必须记录）

第三、四轮（共 59 个用例）的 runner 里写的是 `const fx = build();`，而当时新夹具 `build2()` 是 **async** ⇒ `fx` 是 Promise ⇒ `fx.vault === undefined` ⇒ spawn 时 `CODESCOPE_VAULT: undefined` ⇒ **服务端回落到默认（真实）vault**。

- **影响**：那 59 个用例是对真实数据做的**只读点击**（打开面板 / 切页签 / 开右键菜单 / 开阅读器）。
- **核查**：全仓 `git status` 只有 1 个被改文件 `markdown-vault/readings/知识库/项目经历/我的项目/公司待遇提问.md`，其 **mtime = 2026-10-31 09:36**，早于本次会话（2026-11-01 22:2x），diff 内容是用户自己加的 `**…**` / `==…==` ⇒ **与本次自检无关**；也没有产生 `undefined` 这类脏目录。
- **修正**：`runner5` 起改成 `const fx = await build();`，并重跑了对应路径。报告里凡引用第三/四轮结论的地方都已用后续轮次覆盖。

---

## 2. 逐页结果表

> 说明：`pageerror` 全为 0，表里只列 `console.error` 与「可见错误文案」。`ce` = console.error 条数；**所有 ce 的 URL 都已核对到具体资源**（见 §5）。

### 2.1 主界面 · 欢迎页 8 个主操作

| 入口 | 是否报错 | pageerror | ce | 可见错误文案 | 入口是否生效（probe） |
| --- | --- | --- | --- | --- | --- |
| 查找内容 `#welcome-search` | 否 | 0 | 2（favicon 404） | 无 | 搜索面板打开 |
| 学习工作台 `#welcome-study` | 否 | 0 | 0 | 无 | `#study-workspace` 可见 |
| DeepSeek Harness `#welcome-dsh` | 否 | 0 | 1（favicon 404） | 无 | `#dsh-frame` 可见 |
| 阅读资料 `#welcome-reading` | 否 | 0 | 0 | 无 | 阅读面板打开 |
| Office 文档 `#welcome-office` | 否 | 0 | 0 | 无 | Office 面板打开 |
| 绘图设计 `#welcome-draw` | 否 | 0 | 0 | 无 | 绘图面板打开 |
| 工程工具 `#welcome-project` | 否 | 0 | 0 | 无 | `#project-panel` 可见 |
| 远程开发 `#welcome-remote` | 否 | 0 | 0 | 无 | `#remote-panel` 可见 |

### 2.2 主界面 · 欢迎页 12 个「更多能力」

| 入口 | 是否报错 | pageerror | ce | 可见错误文案 | 入口是否生效 |
| --- | --- | --- | --- | --- | --- |
| 代码工作区 `#welcome-code` | 否 | 0 | 0 | 无 | 编辑器视图切换 |
| 符号与关系 `#welcome-symbols` | 否 | 0 | 0 | 无 | `#sym-modal` 可见 |
| 代码图谱 `#welcome-codegraph` | 否 | 0 | 0 | 无 | 图谱面板打开 |
| 逻辑图 `#welcome-logicgraph` | 否 | 0 | 0 | 无 | 逻辑图面板打开 |
| 积木编程 `#welcome-blockly` | 否 | 0 | 0 | 无 | Blockly 面板打开 |
| LaTeX 工程 `#welcome-latex` | 否 | 0 | 0 | 无 | `#new-dialog` 可见（要求先命名） |
| 知识库 `#welcome-knowledge` | 否 | 0 | 0 | 无 | 知识库面板打开 |
| 思维导图 `#welcome-mindmap` | 否 | 0 | 0 | 无 | Markdown 片段下可用（见 §5.6） |
| 编辑工作台 `#welcome-vscode` | 否 | 0 | 2（favicon 404） | 无 | 打开 code-server 入口 |
| **本机管家** `#welcome-system` | 否 | 0 | 1（图标 404） | 无 | `#system-workspace` 可见；**修复前这里会额外注入一份脚本**（§4） |
| 本地时间线 `#welcome-history` | 否 | 0 | 0 | 无 | 时间线面板打开 |
| 使用手册 `#welcome-manual` | 否 | 0 | 0 | 无 | 新标签页打开 `/manual/` |

### 2.3 顶栏

| 入口 | 是否报错 | pageerror | ce | 可见错误文案 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 本机管家 `#btn-system` | 否 | 0 | 1（图标 404） | 无 | 自建按钮，defer 同步加载 |
| 个人管理面板 `#btn-lifework` | 否 | 0 | 0 | 无 | **自建按钮 + 动态注入**，实测出现（§3 清单 A4） |
| 知识库 `#btn-knowledge-launch` | 否 | 0 | 0 | 无 | 打开知识库面板 |
| 常用网址 `#site-menu-trigger` | 否 | 0 | 0 | 无 | `panelOpen=true`、徽标 `4`、分类 `15` 项 ⇒ **数据真的加载了** |
| Harness `#btn-dsh` | 否 | 0 | 1（401） | 无 | DSH 未启动时的 401，属环境 |
| opencode `#btn-dsh-restart` | 否 | 0 | 0 | 无 | 打开 opencode 入口 |
| Git 抽屉 `#btn-git-panel` | 否 | 0 | 0 | 无 | **自建按钮**（cs-sidebar.js），defer 同步 |
| 环境 `#btn-env` | 见 §2.9 | | | 无 | 注意真实 id 是 `btn-env`（不是 `btn-environment`） |

### 2.4 个人管理面板 10 个页签

| 页签 | 是否报错 | pageerror | ce | 可见错误文案（原文） | 内容是否渲染 |
| --- | --- | --- | --- | --- | --- |
| 今日 `today` | 否 | 0 | 0 | 无 | ✅（58 个项目 / 6.2 GB / 1822 文件） |
| 备忘录 `memo` | 否 | 0 | 0 | 无 | ✅ |
| 日记 `journal` | 否 | 0 | 0 | 无 | ✅（日历 + 1 篇） |
| 书签 `quote` | 否 | 0 | 0 | 无 | ✅（空态文案正常） |
| 研究方向 `tracks` | 否 | 0 | 0 | 无 | ✅ |
| 文件 `files` | 否 | 0 | 0 | 无 | ✅ |
| 阅读 `reading` | 否 | 0 | 0 | 无 | ✅ |
| 工作流 `flow` | 否 | 0 | 0 | 无 | ✅（空态 + 节点库） |
| 热榜 `trends` | 否 | 0 | 0 | 见 §5.5（文案自带 `✗`） | ✅ |
| 邮箱 `mail` | 否 | 0 | 0 | 无 | ✅（4 个账号均「未配置」，正确空态） |

### 2.5 阅读页 · 外刊精读四个子页

| 子页 | 是否报错 | pageerror | ce | 可见错误文案 | 判据 |
| --- | --- | --- | --- | --- | --- |
| 📚 书架 `data-rdmode="shelf"` | 否 | 0 | 0 | 无 | `.on` 落在「书架」 |
| 📰 外刊精读 `ex` | 否 | 0 | 0 | **没有**「共享模块没加载上」 | 三栏渲染出「推荐外刊源 7 组 / 开源资源 11 个」⇒ **`LW_EN_TEXT` / `LW_EN_SOURCES` 都拿到了**（这正是回归 #3 的验收点） |
| 🔤 生词本 `word` | 否 | 0 | 0 | 无 | `.on` 落在「生词本」 |
| 🧬 词根词缀 `root` | 否 | 0 | 0 | 无 | 计数 `262` ⇒ `LW_ROOTS` 拿到了 |

### 2.6 本机管家 7 页

> 导航栏实测 id：`home / monitor / files / storage / runtime / software / settings`（共 7 个，与任务书「7 页」一致）。
> 逐页结果见 §2.9（隔离实例上的收尾补测）。

### 2.7 编辑器内视图（代码片段上）

| 视图 | 是否报错 | pageerror | ce | 判据 |
| --- | --- | --- | --- | --- |
| 代码图谱 `#btn-codegraph` | 否 | 0 | 0 | `#cg-view-graph` 带 `on` |
| **架构视图** `#cg-view-arch` | 否 | 0 | 0 | **`archOn=true`、SVG 节点 25 个** ⇒ 按需注入的 6 件（arch-layout / round / graph-svg / zoom / ai-view / view）真的加载并画出来了 |
| 符号与关系 `#btn-symbols` | 否 | 0 | 0 | `#sym-modal` 打开 |
| 逻辑图 `#btn-logicgraph` | 否 | 0 | 0 | 面板打开 |
| 积木编程 `#btn-blockly` | 否 | 0 | **3** | 3 条 CSP 违规（Blockly 默认音效，§5.2）；功能不受影响 |
| 大纲 `#btn-outline` | 否 | 0 | 0 | 面板打开 |
| 本地时间线 `#btn-history` | 否 | 0 | 0 | 面板打开 |
| 思维导图 `#btn-mindmap` | 否 | 0 | 0 | C 片段上按钮 `display:none`（设计如此）；Markdown 片段上可用（§2.9） |
| 反链 `#btn-backlinks` | 否 | 0 | 0 | 面板打开 |
| 并排切换 `#btn-pair-switch` | 否 | 0 | 0 | 无异常 |
| 布局 `#btn-editor-layout` | 否 | 0 | 0 | 无异常 |

### 2.8 侧栏四组树 + 右键菜单 + 命令面板 + 主题菜单

| 入口 | 是否报错 | pageerror | ce | 判据 |
| --- | --- | --- | --- | --- |
| 项目树 `#list` | 否 | 0 | 0 | 3 个片段行，点击后打开 |
| 绘图树 `#draw-list` | 否 | 0 | 0 | 3 行（drawio / canvas / xmind） |
| Office 树 `#office-list` | 否 | 0 | 2（503） | 1 行；503 是 ONLYOFFICE 指向坏端口的预期结果 |
| 阅读树 `#reading-list` | 否 | 0 | 0 | 3 行 |
| 右键菜单 · 项目树 | 否 | 0 | 0 | 6 项：打开 / 复制路径 / 下载到本地 / 编辑信息 / … / 删除片段 |
| 右键菜单 · 绘图 | 否 | 0 | 0 | 7 项：打开 / … / 重命名绘图 / 删除绘图 |
| 右键菜单 · Office | 否 | 0 | 0 | 7 项：打开 / … / 重命名 / 删除 |
| 右键菜单 · 阅读 | 否 | 0 | 0 | 8 项：打开 / … / 添加项目片段 / 项目说明与标签 / 重命名 / 删除项目 |
| 命令面板 `⌘K` | 否 | 0 | 0 | 打开的是 `#sym-modal`（代码里 `openSymModal('command')`，**这就是本项目的命令面板**） |
| 主题菜单 `#theme-btn` | 否 | 0 | 0 | 菜单打开，5 个主题项 |

---

### 2.9 收尾补测（隔离实例上重跑，9 例）

| 入口 | 是否报错 | pageerror | ce | 可见错误文案 | 判据 |
| --- | --- | --- | --- | --- | --- |
| 本机管家 · 概览 `home` | 否 | 0 | 3（图标 404 ×1） | 无 | 健康总评「一切正常 / CPU 5% · 内存 67% · 磁盘 81%」 |
| 本机管家 · 性能 `monitor` | 否 | 0 | 1 | 无 | 635 个进程按 CPU 排序 |
| 本机管家 · 文件 `files` | 否 | 0 | 0 | 无 | 子页签 4 个（文件浏览 / 整理归类 / 回收站 / 安全管理） |
| 本机管家 · 存储 `storage` | 否 | 0 | 0 | 无 | 子页签 4 个（磁盘与清理 / 空间分析 / 全盘扫描 / 分级总览）；`Macintosh HD 39.0…` |
| 本机管家 · 系统 `runtime` | 否 | 0 | 0 | 无 | 子页签 5 个（服务与端口 / 容器 / 开发环境 / 环境与更新 / 远程同步） |
| 本机管家 · 软件 `software` | 否 | 0 | 1 | 无 | 101 个应用，分类统计正常 |
| 本机管家 · 设置 `settings` | 否 | 0 | 1 | 无 | 只读安全模式 / 本机信息 / AI 配置 / 重启入口都在 |
| 环境 `#btn-env` | 否 | 0 | 0 | **1 条命中**，但原文是环境面板里显示的 **git commit message**：「fix(回归): 外刊精读报「共享模块没加载上」…」⇒ 关键词误报 | `open=true` |
| 思维导图（Markdown 片段） | 否 | 0 | 0 | 无 | `#btn-mindmap` `disabled=false` ⇒ 可用 |

---

## 3. 三类回归的三份清单

### 清单 A · 谁在自建 DOM 入口（往顶栏 / 侧栏塞节点）

判据：脚本自己 `createElement` 并 `appendChild / insertBefore` 到全局 chrome（`#header-center` / `#header-left` / `#side` / 已有菜单），或者它自己声明 `btn-*` 这类全局 id。

| # | 脚本 | 自建的入口 | 插入点 | 当前加载方式 | 判定 |
| --- | --- | --- | --- | --- | --- |
| A1 | `assets/system-panel.js` | `#btn-system`（+ 整个 `#system-workspace`） | `#header-center` | `index.html:84` `<script defer>` | **已确认安全** —— 这就是回归 #1 的现场，已恢复同步加载 |
| A2 | `assets/study-workspace.js` | `#site-menu-trigger` 的 onclick / 面板渲染（入口本身在 HTML） | 顶栏「常用网址」 | `index.html:73` `defer` | **已确认安全** —— 回归 #2 的现场，已恢复同步加载 |
| A3 | `assets/cs-sidebar.js` | `#btn-git-panel`（插在 `#btn-manual` 之后）、`#btn-tag-filter` | 顶栏 / 搜索框右端 | `index.html:107` `defer` | **已确认安全** |
| A4 | `assets/life-workbench.js` | `#btn-lifework` | `#header-center`，锚点 `#knowledge-launch` 或 `#btn-system`，兜底 `appendChild` | **动态注入**（`window.load` 后 `requestIdleCallback`，链 `life-styles → life-editor → life-workbench`） | **安全，但入口会晚出现**（+300~600ms）。它有 `tryMount()` 立即试 + 100ms 定时器 + `MutationObserver` + 兜底 append，三层保证不会消失 |
| A5 | `assets/code-theme-picker.js` | 往 `#theme-menu` 追加主题项 | 已有菜单 | `index.html:284` `defer` | **已确认安全** |
| A6 | `assets/site-icons.js` | 不建入口，只替换 `#quick-sites` 里的图标位 | — | `index.html:1603` `defer` + `MutationObserver` | **已确认安全**（失败回落彩点） |
| A7 | `assets/cs-lan-chip.js` | 不建入口（要 HTML 里的 `#cs-lan-chip`，已在） | — | `index.html:106` `defer` | **已确认安全** |
| A8 | `assets/app-reading.js` | 给 `#knowledge-launch-split` 等绑 onclick（**元素在 HTML 里**） | 顶栏知识库菜单 | `index.html:1309` 同步 | **已确认安全**（且必须在 app.js 之前） |

> 结论（清单 A）：**8 条里没有一条会「消失」**。唯一「不是常显」的是 A4（个人管理面板），但它是**延迟出现**而不是缺失，且有定时器 + MutationObserver + 兜底三重保证。

### 清单 B · 谁的交互 / 数据在自己脚本里？（按需注入脚本 × 功能归属）

判据：纯视图型可以懒加载；**带全局入口或全局绑定的不行**。

| # | 按需注入的脚本 | 体积 | 它 own 的东西 | 判定 |
| --- | --- | --- | --- | --- |
| B1 | `assets/arch-layout/round/graph-svg/zoom/ai-view/view.js`（6 件） | 24.3 KB | 只画「代码图谱 → ▦ 架构」这一块 | **安全**（纯视图；唯一同步入口 `renderArchIntoPane` 有 lazyForward 转发，悬停 `#cg-view-arch` 还会预取）。实测：**SVG 25 个节点画出** |
| B2 | `assets/app-pdf.js` | 26.9 KB | 只画 PDF 阅读器 | **安全**。`window.__pdfViewerReady` 在 index.html 里**提前**置 true，而 `app-reading.js:1194` 是**运行时**读它 ⇒ 不会掉进「用 iframe 直接显示原始 PDF」的降级分支 |
| B3 | `assets/code-guide.js` | 47.2 KB | **全局快捷键 Ctrl/⌘+I**（它自己在 capture 阶段注册） | **安全**，但**正因为它是全局绑定**，index.html 里先接住这个键再注入、注入完补发一次等价按键（否则就是「按了没反应」） |
| B4 | `assets/life-styles/editor/workbench.js`（3 件链） | ~276 KB | **自建顶栏入口 + 10 个页签 + 邮箱自举 + 全局键盘闸门** | **安全**：自挂载带三层兜底（A4），且只在 `window.load` 之后调度 ⇒ 共享模块已就绪 |
| B5 | `assets/xmind-interaction.js` | 26.6 KB | 导图的鼠标/键盘/框选/平移**绑定** | **安全（=保守做法）**：它**没有**懒加载 —— 注释写明「bind 只在渲染路径里调一次、守卫是静默跳过、之后不会补绑」，所以用 26.6 KB 换零回归 |
| B6 | `assets/reading-block-editor.js`（Crepe） | 2.7 MB | 阅读笔记的块编辑器 | **安全**：由 `app.js:4337` 在**用户点开笔记时**注入，带失败提示 |
| B7 | `/vendor/excal-loader.min.js` | — | Excalidraw | **安全**：`loadExcalLoader()` 点击时加载，带 20s 超时 + 三条明确失败文案，失败会清空缓存的 Promise |
| B8 | `window.CodeScopeSystemPanel` / `CodeScopeStudy` 的 lazyForward 式 stub | — | 替代全局对象的转发壳 | **⚠️ 有风险（本次已修）**：stub 用来判断「模块到没到」的 `SP_READY` **只由它自己置位**，而真模块已经是静态 `defer` ⇒ 判据恒假 ⇒ **每次点击都再注入一份**（§4） |

### 清单 C · 谁在**求值时**读全局？

判据：模块顶层 / IIFE 顶层就把 `window.X` 读进常量（`const X = window.Y || null` 这种），且 `Y` 由**别的文件**在**更晚**的时机定义。扫描范围：`assets/*.js` 全部 44 处 `window.<全局>` 命中，逐条人工过。

| # | 位置 | 读的全局 | 谁在什么时候定义 | 判定 |
| --- | --- | --- | --- | --- |
| C1 | `life-workbench.js:634` `const EN = window.LW_EN_TEXT || null` | `LW_EN_TEXT` | `/lib/en-text.js`（`<script type="module">`，index.html:95） | **已确认安全，但脆弱** ⚠️ |
| C2 | `life-workbench.js:635` `const SRS = window.LW_SRS || null` | `LW_SRS` | `/lib/srs.js`（module，:96） | 同上 |
| C3 | `life-workbench.js:639` `const ENSRC = window.LW_EN_SOURCES || null` | `LW_EN_SOURCES` | `/lib/en-sources.js`（module，:99） | 同上（非硬依赖：没加载上只少一个入口） |
| C4 | `life-workbench.js:644` `const ROOTS = window.LW_ROOTS || null` | `LW_ROOTS` | `/lib/roots.js`（module，:100） | 同上 |
| C5 | `life-workbench.js:647` `const FLOW_SCHED = window.LW_FLOW_SCHED || null` | `LW_FLOW_SCHED` | `/lib/flow-schedule.js`（module，:98） | 同上 |
| C6 | `life-workbench.js:1169` `const ed = window.CodeScopeLifeEditor` | `CodeScopeLifeEditor` | `life-editor.js`（动态注入，链在面板之前） | **安全**（在函数体内，运行时读） |
| C7 | `life-workbench.js:1928` `const Ed = () => window.CodeScopeLifeEditor || null` | 同上 | 同上 | **安全且是正确写法**（每次调用重读，天然免疫时序） |
| C8 | `app-draw.js:1136` `if (window.__csXmindInteraction) …bind()` | `__csXmindInteraction` | `assets/xmind-interaction.js`（`defer`，:1465） | **安全**（渲染路径里运行时读；且该文件已改回同步 defer） |
| C9 | `app-draw.js:459` `window.__openCanvasEditor` | 画布嵌入层 | `draw-canvas-embed.js`（defer:1295） | **安全**（`DRAW_KIND === 'canvas'` 分支内，运行时） |
| C10 | `app.js:390` `window.__CODE_GUIDE`、`app.js:1395` `window.__drawFolderMenu`、`CS_RUNS` 11 处 | 各种 | code-guide（懒）/ draw-folder（defer）/ run-history（defer） | **安全**（全部在函数体内，且有真值守卫） |
| C11 | `app-reading.js:1194 / 1266` `window.__pdfViewerReady` | PDF 就绪标志 | index.html 的懒转发块**提前**置 true | **安全**（运行时读） |
| C12 | `app-reading.js:98/164/170`、`app.js:14531`、`system-panel.js:1258` `window.CodeScopeStudy` | 学习工作台 API | `study-workspace.js`（defer:73） | **安全**（运行时读，且 `study-mode` 守卫） |

> **C1–C5 为什么不修**：它们是同一个机制（`life-workbench.js` 在模块顶层把 5 个共享模块读进常量）。现在的保护是
> `index.html:168-173` —— `scheduleWorkbench()` **只在 `window.load` 之后**才进空闲队列，而 6 个 `type="module"` 脚本在
> `DOMContentLoaded` 之前就执行完了 ⇒ 读到的一定是真对象。
> 实测证据：外刊精读页渲染出「推荐外刊源 7 组 / 开源资源 11 个」、词根词缀 262 条 ⇒ 5 个模块全部到位。
> **要改得更硬**（改成 `const EN = () => window.LW_EN_TEXT`）需要改 60+ 个调用点，而 `assets/life-workbench.js` 的代码行
> **正好卡在棘轮上限 10,643**，一行都加不了 ⇒ 本轮只记录风险与判据（见 §5.4）。

---

## 4. 修了什么

### 4.1 【真问题】`<script defer>` 的子系统被 `csLoadScript` 再注入一次并执行第二遍

**属于**：第 2 类回归（交互在脚本里，却被当成「可以按需加载」）的**残留变体** —— 入口没消失、点了也有反应，所以用户不会报，但它每次点击都在重复干活。

**位置**：`index.html` 的 `④ 本机管家` / `⑤ 学习工作台` 两段（自检前在 1409–1459 行）。

**根因**：

```js
var SP_READY = false;                 // ← 只有下面这个回调会把它置 true
function spLoad() {
  return SP_READY ? Promise.resolve()
    : window.csLoadScript('/assets/system-panel.js').then(function () { SP_READY = true; });
}
```

1. `system-panel.js` 在 2026-11-01 已恢复成 `index.html:84` 的 `<script defer>` ⇒ **从不经过 `csLoadScript`**；
2. `csLoadScript` 的幂等表 `pending` 里**没有**它的记录（那张表只记自己插的 script）；
3. ⇒ `SP_READY` **永远是 false** ⇒ 每次点欢迎页「本机管家」，捕获阶段的处理器都会 `e.stopPropagation()` 后再 `csLoadScript('/assets/system-panel.js')` ⇒ **插第二个同样的 script 标签，把 81 KB 模块完整执行第二遍**。

**改前证据**（探针 `probe/dup-system`，同一份夹具、同一操作）：

```
点击 #welcome-system 之前： { tags: 1, btns: 1 }
点击 #welcome-system 之后： { scriptTags: 2, btnSystem: 1, workspace: 1, open: true }
```

`#btn-system` 仍是 1，是因为 `system-panel.js` 自己那句 `if(!d("btn-system") && d("header-center"))` 挡着 —— 所以症状**不是**「两个按钮」，而是「模块白跑一遍 + 全局监听重复注册」。这类问题正是不主动查就发现不了的那种。

**改法**（判据从「我自己置位的标志」换成「**真入口在不在**」，全程不注入）：

```js
/* 本页用 <script defer> 静态加载的模块：只等它执行完，绝不再注入一份 */
function afterStatic() {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise(function (resolve) {
    document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });
}
var SP_STUB = {
  version: '1.0.0',
  open: function () { return afterStatic().then(function () {
    if (window.CodeScopeSystemPanel !== SP_STUB) return window.CodeScopeSystemPanel.open();  // 身份判据，防自递归
  }); },
  close: function () { if (window.CodeScopeSystemPanel !== SP_STUB) window.CodeScopeSystemPanel.close(); }
};
window.CodeScopeSystemPanel = SP_STUB;
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t || typeof t.closest !== 'function' || !t.closest('#welcome-system')) return;
  if (document.getElementById('btn-system')) return;   /* 真入口已在 → 不拦，走 app.js 的 onclick */
  e.preventDefault(); e.stopPropagation();
  afterStatic().then(function () {
    var btn = document.getElementById('btn-system');
    if (btn) btn.click(); else window.CodeScopeSystemPanel.open();
  }).catch(noop);
}, true);
```

`⑤` 同理：`stLoad()` → `afterStatic()`，并删掉 `ST_READY` / `stLoad` 两个已经没用的名字。

**改后证据**（同一探针、同一操作）：

```
点击 #welcome-system 之后： { scriptTags: 1, btnSystem: 1, workspace: 1, open: true }
```

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| `script[src*=system-panel]` 个数 | **2** | **1** |
| 面板是否打开（`open`） | true | **true**（没修坏） |
| `#btn-system` 个数 | 1 | 1 |
| `console.error` | 1（图标 404） | 1（同一条图标 404，**无新增**） |
| `pageerror` | 0 | 0 |

**行数**：`index.html` 总行 1,605 → **1,614**（+9，全部是「为什么不能再注入一份」的注释），**代码行 1,536 → 1,534（净减 2）**；
`docs/ARCHITECTURE.md` 已同步这两个数字（不同步的话架构测试会红，已改并复跑通过）。

**为什么不是「加轮询 / 重试」**：任务书要求优先恢复同步加载，而这里的模块**已经是**同步 `defer` 了 —— 问题出在**另一段代码不知道这件事**。
所以正确的修法是让那段代码看**真实的界面事实**（`#btn-system` 在不在），而不是看一个自维护的布尔量：后者永远会和真实状态脱节。

---

## 5. 没修的和为什么

### 5.1 Draw.io 编辑器依赖外部 CDN，实测 403

- 现象：打开 `flow.drawio` 时 `https://embed.diagrams.net/?embed=1&proto=json&…` 返回 **403**，控制台 1 条 `console.error`。
- 位置：`assets/app-draw.js:30` `const DRAWIO_ORIGIN = 'https://embed.diagrams.net'`；全仓**没有本地副本**（`assets/vendor/` 只有 tldraw / katex / mind-elixir）。
- **没修的原因**：修它要么把 diagrams.net 自托管进来（约 2 MB 新资产，且要动 vendor 目录），要么换成别的编辑器 —— 两条都超出「只改 index.html + assets/*.js 且只准净减」的边界。
  **需要人工在有正常外网的机器上确认这条 403 是否只是本机网络 / 无 Referer 导致**；若确实是 CDN 政策变化，这是一个真实的用户可见故障。

### 5.2 Blockly 默认音效被 CSP 拦下（3 条 console.error）

- 现象：打开积木编程时 3 条 `Loading media from 'https://blockly-demo.appspot.com/static/media/*.mp3' violates … "default-src 'self' data: blob:"`。
- 原因：Blockly 自带默认音效 URI 指向官方 demo 站，而 `index.html:6` 的 CSP 是 `default-src 'self' data: blob:`（**这条 CSP 是对的**）。
- **没修的原因**：正确修法是「把音效 URI 指到本地」或「关掉音效」，两者都要改 Blockly 的初始化（`app.js:6917` 附近），而 `assets/app.js` 的代码行是 **12,999 / 上限 13,000** —— 只剩 1 行余量，不值得为 3 条无害噪音消耗掉。
  绝**不能**的修法是往 CSP 里加 `media-src https://blockly-demo.appspot.com` —— 那等于为一个 demo 站放宽整站策略。
- 影响级别：**功能不受影响**（积木能拖能跑，只是没有点击音效），属「控制台噪音」。

### 5.3 `/api/favicon` 与 `/api/system-panel/apps/icon` 的 404

- 现象：打开网址导航 / 本机管家时出现 `404 /api/favicon?host=github.com`、`404 /api/system-panel/apps/icon?id=…`。
- 原因：前者是**本机取不到该站点的 favicon**（离线 / 被墙就是这样），后者是某个已装应用提不出图标。
- **没修的原因**：这是**设计内的失败路径**（前端有回落到彩点 / 首字母的兜底），不是缺陷；改它等于让服务端「假装成功」。

### 5.4 `life-workbench.js` 模块级读 `window.LW_*`（清单 C1–C5）—— 安全但脆弱

- 现状：靠 `index.html` 的「等 `window.load` 再调度」保护，实测 5 个模块全部到位（外刊精读 / 生词本 / 词根词缀都渲染出真实数据）。
- **没修的原因**：改成惰性 getter 要动 60+ 处调用点，而该文件代码行**正好等于棘轮上限 10,643**（`tests/architecture.js` 里 `['assets/life-workbench.js', 10643]`），加一行就红。
- **给后来人的判据**（写在这里，因为不能写进代码）：**任何时候都不要把 `scheduleWorkbench` 从 `window.load` 上摘下来**；
  若要改成「直接 `requestIdleCallback` 就跑」，必须同时把这 5 个常量改成函数式惰性读取 —— 否则就是回归 #3 原样重演。

### 5.5 热榜页的可见文案里带 `✗`

- 原文：`请到 CodeScope 的 AI 面板 配一次 ✓，这里会自动复用 ✓（不再重复造配置 ✗）`（`life-workbench.js` 热榜的空态说明）。
- 这是**作者的书写习惯漏进了用户可见文案**（源码注释里到处用 ✓/✗，但这一条是 `innerText` 里真实渲染出来的）。
- **没修的原因**：纯文案，改它要动棘轮顶格的文件，且不影响功能。记录在此，作为「下次动这个文件时顺手清掉」的待办。

### 5.6 思维导图按钮在非 Markdown 片段上是隐藏的

- `app.js:4381-4384`：`$('btn-mindmap').disabled = !isMd; $('btn-mindmap').style.display = isMd ? '' : 'none';`
- 这是**设计如此**（导图是从 Markdown 转的），不是回归。已用 Markdown 片段单独验证：`disabled=false`（§2.9）。

### 5.7 阅读项目的「子文件」这一步未完全覆盖（探针限制，不是缺陷）

- 夹具里的阅读项目行能渲染、能点开（`selfcheck-reading`），但自动化里「再点进 `manual.pdf` 那一层」没命中（子项渲染在 `.reading-library-children` 里，需要更复杂的展开序列）。
- 已覆盖的相邻路径：阅读四大子页（§2.5）、`window.__pdfViewerReady`（PDF 阅读器已就绪）、Office 面板（§2.8）。
- 结论：**没有观察到任何报错**，但这一行在报告里标为「未完全覆盖」，不假装验证过。

---

## 6. 测试结果

### 6.1 `node tests/architecture.js`（改后）

```
架构断言：91/91 项通过

全部通过 ✅
```

（改前同一份测试也是 91/91；`index.html` 不在棘轮名单里，但 `docs/ARCHITECTURE.md` 的数字已按新实测值同步，否则 ② 那条断言会红。）

### 6.2 `node tests/undefined-refs.js`（改后）

```
✅ 没有「引用了但没声明」的标识符（查了 18 个脚本）
```

### 6.3 `node tests/smoke.js`（改后）

```
CodeScope smoke tests: 604 passed
```

### 6.4 `node tests/browser-smoke.js`（A/B 对照）

**改后**：在 `tests/browser-smoke.js:671` 失败 —— 点网址卡的 `⋯` 管理按钮时被 `.quick-site` 自己挡住（`intercepts pointer events`）。

**改前**（用 `git show HEAD:masscode-runner/index.html` 取出改动前的 index.html —— 这是一次**只读** git 操作，把文件替换后重跑，跑完立刻还原）：

```
locator.click: Timeout 30000ms exceeded.
…
  - <div tabindex="0" role="button" draggable="true" class="quick-site" …> intercepts pointer events
    at main (…/tests/browser-smoke.js:671:106)
```

**两次是同一个位置、同一个错误** ⇒ **这条失败与本次改动无关，是既有问题**（疑似 `.quick-site-manage` 被父卡片的命中层盖住，鼠标 hover 无法把它抬到可点位置）。
按要求没有去修它（不属于本任务的三类回归，且动它要碰 `study-workspace` 的样式）。

还原后校验：`cmp index.html tmp/selfcheck/index.fixed.html` → **IDENTICAL**（sha1 `10cd0192383a92856dd5ed7c5d439fc67c4a2be2`）。

### 6.5 逐页自检的轮次与规模

| 轮次 | 用例数 | pageerror | console.error | 说明 |
| --- | --- | --- | --- | --- |
| 1（改前） | 28 | 0 | 8 | 欢迎页 20 + 顶栏 8 |
| 1'（改后） | 10 | 0 | 5 | 欢迎页 / 顶栏回归 |
| 2 | 38 | 0 | 7 | 个人面板 10 页 + 阅读 4 子页 + 本机管家 + 树 / 菜单 / 视图 + 3 个注入探针 |
| 5 | 26 | 0 | 3 | 四组树 + 四种右键菜单 + 10 个编辑器视图 + 架构视图 + 阅读 / 绘图 / Office（夹具 v2） |
| 6 | 19 | 0 | 8 | 程序化点击重测 + 展开探针 + 积木 |
| 7 | 6 | 0 | 5 | 阅读三格式 + 绘图三格式 |
| 8 | 9 | 0 | 7 | 本机管家 7 页 + `#btn-env` + Markdown 导图 |
| **合计（有效）** | **136** | **0** | **36** | 36 条全部是资源级 / 外部依赖，逐条列在 §5 |

（第 3、4 轮共 59 例因 §1.3 的隔离事故作废，已由上表覆盖。）

---

## 7. 复现方式（全程只读，跑完自动 SIGKILL 并断言端口释放）

```bash
cd masscode-runner/tmp/selfcheck

# 静态三清单（只读源码，输出 JSON）
node analyze.js > analyze.json

# 第一轮：欢迎页 20 个入口 + 顶栏
node runner.js 'welcome/|topbar/' --port=4955

# 第二轮：面板内部 + 注入探针
node runner2.js '.*' --port=4956

# 第五轮起：真实文件夹具（PDF / DOCX / drawio / canvas / xmind）
node runner5.js '.*' --port=4965

# 收尾：本机管家 7 页
node runner8.js '.*' --port=4972
```

每个 runner 结束时都会打印 `PORT 49xx RELEASED`；本报告所有轮次均为 `RELEASED`，**未触碰 4877**。

---

## 8. 一句话给下一位维护者

> 这个项目里「按需注入」有三类东西：**纯视图**（可以懒）、**带全局入口的脚本**（不能懒，`system-panel` / `study-workspace` 就是）、
> **带全局绑定的交互层**（`xmind-interaction` / `code-guide`，要么同步、要么自己接管触发键）。
> 而判断「某个模块到没到」**绝不能看一个只有自己会置位的布尔量** —— 要么看它建的 DOM 在不在，要么用 `lazyForward` 那种对象身份判据。
> 这次就是这两条撞在一起：模块被改回同步加载了，判据却没跟着改。

