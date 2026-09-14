# 码境 CodeScope v2.3.0

面向代码阅读、编辑、运行、工程文档和远程开发的一体化工作台。
码境可以独立使用现有 Markdown Vault，同时兼容读取 [massCode](https://masscode.io/) 片段库，不修改原始数据格式。

当前版本：**v2.3.0**。版本变更见 [CHANGELOG.md](CHANGELOG.md)。

桌面版下载：[GitHub Releases](https://github.com/ruanjianshi/massCode/releases/latest)。macOS 提供 Apple Silicon / Intel 的 DMG 与 ZIP，Windows 提供 x64 安装程序，Linux 提供 x64 的 DEB、RPM 与 ZIP。

## Web 与桌面双模式

CodeScope 的 Web 端和 Electron 桌面端共用 `server.js`、`index.html`、全部 `/api` 接口与 Vault 数据格式：

| 模式 | 启动方式 | 适用场景 |
| --- | --- | --- |
| Web | `npm start` 或三端启动脚本 | 浏览器、本机服务、可信局域网和服务器部署 |
| Desktop | `npm run desktop:dev` | 独立窗口、原生菜单、Vault 切换和桌面调试 |
| Desktop 安装包 | `npm run make:desktop` | macOS、Windows、Linux 一键安装与启动 |

桌面主进程位于 `desktop/main.js`，通过隔离的 preload 桥接原生能力；CodeScope 服务运行在 Electron Utility Process 中。渲染器不开放 Node.js 权限，Web 端也不依赖 Electron API。

## v2.3 概览

- 统一项目、Office、阅读、绘图与 Git 的侧栏标题、计数、操作按钮、树行、悬停和选中反馈；五套工作台主题共用同一套语义化颜色与间距。
- 代码工作区使用 Monaco，提供多栏、LSP、定义/引用/调用关系、运行、调试、测试、Git Diff 与可恢复本地时间线。
- Markdown 提供源码、分栏、区块编辑和阅读模式；分栏预览严格绑定当前文件与片段，并按源码行锚点双向同步滚动。阅读模块的区块模式使用本地打包的 Milkdown Crepe（MIT），支持直接编辑、拖拽排序、斜杠菜单、选区工具栏、表格、任务列表、代码高亮、公式、原生撤销及代码/PDF 引用定位；左侧内置可折叠层级大纲、当前章节高亮与 60%–180% 无光标偏移的字号缩放。正文具备完整标题层级、列表基线、引用、链接、行内代码、代码块、表格与图片排版，原始 `.md` 与 frontmatter 保持兼容。
- 阅读工作区把 PDF 原文、译本、Markdown、LaTeX 与代码片段组织在同一项目中。PDF 阅读内核采用本地打包的 Mozilla PDF.js 官方 Viewer，支持 20%–400% 自由缩放、适合宽度、适合整页、实际大小、连续滚动、单页、双页、封面双页、旋转、手型拖动、页码跳转、全文查找、目录、缩略图、专注阅读、摘录、高亮和笔记；页面与缩略图均按可视区域懒渲染，适合数百页大文档。
- 绘图工作区统一管理 Draw.io、Excalidraw 和 XMind；XMind 支持官方原貌查看、可编辑导图、节点重排、父子关系迁移、自由节点、缩放/平移与多布局。
- Office 工作区只使用 ONLYOFFICE Docs，统一提供 DOCX/XLSX/PPTX 高保真编辑、审阅与多人协作；PDF 阅读工具栏也可直接进入 ONLYOFFICE PDF Editor，并通过独立令牌、自动保存回调和最近 5 份隐藏备份安全回写原 PDF。未连接时显示连接设置，不再使用内置兼容编辑器。
- 环境检测扩展为运行基础、浏览器能力和项目工具链三层；三端启动脚本共用 `preflight.js` 检查 Node、端口、Vault 权限和依赖完整性。
- 桌面安装包新增完整离线编辑辅助工具链：Prettier + Shell 插件、Ruff Python 格式化器、Pyright、TypeScript/TypeScript Language Server 和按平台编译的 gopls；Finder 启动时也会识别 Homebrew、用户 Python 与 Go 的常见工具目录。

远程仓库：[github.com/ruanjianshi/massCode](https://github.com/ruanjianshi/massCode)

> **📦 已整体迁移到 iCloud Drive，自动云同步**（见下文「云同步」）。
> 所在位置：`~/Library/Mobile Documents/com~apple~CloudDocs/massCode`（Finder 里就是 **iCloud Drive / massCode**）。

## 目录结构

```
iCloud Drive/massCode/
├── markdown-vault/            ← massCode 的片段库（code/ notes/ 等，随 iCloud 同步）
├── masscode-runner/           ← 码境程序目录（保留旧目录名以兼容已有路径）
│   ├── server.js              ← HTTP 服务（127.0.0.1:4877）
│   ├── preflight.js           ← 跨平台启动预检（Node / 端口 / 权限 / 依赖）
│   ├── desktop/               ← Electron 主进程与安全 preload 桥接
│   ├── forge.config.js        ← macOS / Windows / Linux 安装包配置
│   ├── index.html             ← 界面
│   ├── assets/                ← 高亮库等静态资源（离线可用）
│   └── README.md
└── 启动码境.command            ← macOS 一键启动（前台运行，Ctrl+C 停止）
└── 启动码境.bat                ← Windows 一键启动（前台运行，Ctrl+C 停止）
└── 启动码境.sh                 ← Linux / WSL 一键启动
```

## 快速开始

### 桌面端

```bash
cd masscode-runner
npm ci
npm run desktop:dev
```

生成当前操作系统的安装包：

```bash
npm run make:desktop
```

构建结果位于 `masscode-runner/out/make/`。GitHub 标签发布时，`.github/workflows/desktop-release.yml` 会在 macOS、Windows 和 Linux 分别构建并把安装包上传到对应 Release。macOS 自动更新正式启用前需要配置开发者签名与公证。

正式安装包内置 Electron、Node.js、Prettier、Ruff、Pyright、TypeScript Language Server、TypeScript 和 gopls，用户电脑无需安装 Node.js、npm、pip、Black 或 Go 工具即可使用这些编辑能力。编译器、语言解释器与 LaTeX 仍按项目语言调用系统工具。AI 绘图是可选外部连接；Office 工作区则明确要求一台 ONLYOFFICE Document Server，未连接不影响代码、Markdown、PDF 与绘图模块，但 Office 会保持在连接页。

### ONLYOFFICE 集成

CodeScope 不再提供或自动回退到内置 Office 兼容编辑器。DOCX、XLSX/XLS/CSV 与 PPTX 全部由 ONLYOFFICE Docs 打开；阅读模块中的 PDF 可从工具栏进入 ONLYOFFICE PDF Editor。Document Server 未连接时，Office 页面只显示连接说明和配置表单，PDF 则继续由本地 PDF.js Viewer 阅读，不会把低保真预览误当成完整编辑器。

在 Office 工作区点击“连接设置”，填写：

- `Document Server 地址`：当前浏览器能访问的 ONLYOFFICE 地址，例如本机 Docker 的 `http://127.0.0.1:8088` 或团队服务器的 HTTPS 地址。
- `回调 / 文档访问地址`：Document Server 能回访 CodeScope 的地址。本机 Docker 通常使用 `http://host.docker.internal:4877`；远程服务必须使用服务器可达的局域网或公网地址。
- `JWT 密钥`：与 Document Server 的 `JWT_SECRET` 一致。密钥只写入 CodeScope 应用数据目录的 `office-connection.json`，权限设为仅当前用户可读写，接口不会回显明文。

也可以在部署环境中设置 `CODESCOPE_ONLYOFFICE_URL`、`CODESCOPE_ONLYOFFICE_CALLBACK_BASE` 与 `CODESCOPE_ONLYOFFICE_JWT_SECRET`。环境变量优先于保存的界面配置。Provider 状态和能力矩阵由 `GET /api/office/providers/v1` 返回；连接设置使用 `GET/POST /api/office/connection`。接口与侧车扩展边界见 [Office Provider API v1](docs/office-provider-v1.md)。

PDF 编辑沿用同一套连接设置，并使用独立的 `/api/readings/onlyoffice/config`、只读文档传输令牌和保存回调。保存前 CodeScope 会在 `readings/.codescope/pdf-backups/` 留下最多 5 份滚动备份；普通 PDF.js 阅读、搜索、摘录与标注完全不依赖 Document Server。

官方 Community Edition 可使用 Docker 部署（[amd64 指南](https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-docker.aspx)、[ARM64 指南](https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-docker-arm64.aspx)）。生产环境建议使用 HTTPS、固定 JWT 密钥和持久化数据卷。Document Server 是独立服务器进程，不适合伪装为 Electron 内的 JavaScript 组件，因此不会被打进 CodeScope 的 ASAR。这样升级 CodeScope 或 ONLYOFFICE 时可以各自独立更新。

本机 Docker 示例（把密钥替换为随机长字符串）：

```bash
docker run -d --name codescope-onlyoffice --restart=always \
  -p 8088:80 \
  -e JWT_SECRET='replace-with-a-long-random-secret' \
  -e ALLOW_PRIVATE_IP_ADDRESS=true \
  onlyoffice/documentserver:latest
```

`ALLOW_PRIVATE_IP_ADDRESS=true` 只应用于 Document Server 需要回访本机或可信局域网 CodeScope 的场景；公网部署应保留请求过滤并只允许明确的 CodeScope 地址。启动后在 CodeScope 中填写 `http://127.0.0.1:8088`、`http://host.docker.internal:4877` 和相同 JWT 密钥。

macOS 如果从 iCloud Drive / File Provider 目录构建，Forge 会自动改用系统临时目录 `codescope-forge-out` 存放产物，避免云盘写入 FinderInfo 后破坏应用签名；终端最后会显示实际产物路径。可用 `CODESCOPE_FORGE_OUT_DIR` 指定其他非云盘输出目录。正式无提示安装还需要发行者配置 Apple Developer ID 与公证凭据；构建接口读取 `CODESCOPE_MAC_SIGN_IDENTITY` 和 `CODESCOPE_MAC_NOTARY_PROFILE`（`notarytool` 钥匙串 Profile），不会把证书或密码写入仓库。缺少凭据时生成的是可供开发测试的 ad-hoc 签名包。

### Web 端

**macOS**：在 Finder 打开 `iCloud Drive / massCode`，**双击「启动码境.command」**
- 终端窗口保持前台运行服务，浏览器自动打开 http://127.0.0.1:4877
- 如果已配置本机 ONLYOFFICE，启动器会先检查并自动恢复 Colima/Docker 容器，避免重启后 Office 只显示连接页。
- 局域网访问 CodeScope 时，Office 编辑器会自动使用当前 CodeScope 主机名访问 8088 端口，不会错误连到访问设备自己的 `127.0.0.1`。
- 用完直接 **`Ctrl+C`**（或关掉终端窗口）即停止
- 已运行时再次双击 → 只打开页面，不重复启动

**Windows**：打开 `iCloud Drive/massCode`（或同步下来的 `massCode` 文件夹），**双击「启动码境.bat」**
- 黑窗口前台运行服务并自动打开浏览器；用完 `Ctrl+C` 或关窗口即停止
- 首次使用需先装 [Node.js](https://nodejs.org)（脚本会自动检查并提示）

**Linux / WSL**：在终端进入项目目录后执行：
```bash
chmod +x 启动码境.sh
./启动码境.sh
```
- 自动定位同级 `markdown-vault`，支持 `CODESCOPE_VAULT`、`CODESCOPE_PORT` 和 `CODESCOPE_HOST` 覆盖；旧的 `MASSCODE_*` 配置仍兼容。
- 桌面 Linux 使用 `xdg-open` / `gio` 打开浏览器，WSL 安装了 `wslview` 时自动打开 Windows 浏览器。
- Debian、Ubuntu、Fedora、RHEL、Arch、openSUSE、Alpine 均可识别对应包管理器。
- Node.js 需要 18 或更高版本；启动脚本和环境面板都会区分“未安装”与“版本过低”。

**命令行（任意系统）**：
```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/massCode/masscode-runner   # macOS
cd masscode-runner                                                             # Windows / Linux
npm install
node server.js
```

## 功能

| 按钮 | 说明 |
|------|------|
| ▶ 运行 | 用对应解释器执行当前片段，显示 stdout/stderr/退出码/耗时，超时(10s)自动终止；检测到 `cin`、`scanf`、`input()` 等读取操作时，自动在输出区提示填写 stdin |
| ✓ 语法检查 | 不执行，只做语法校验 |
| ✨ 格式化 | 按语言自动选工具（见下表），格式化后写回 vault（massCode 实时同步），格式偏好跟随 massCode 编辑器设置 |
| 👁 预览 | 仅 HTML 片段：在沙箱 iframe 中渲染 |
| 📄 Markdown | markdown 片段默认**渲染成文档**（标题/表格/代码块/列表/引用），按钮可切换「📄 源码」查看原文；右侧大纲变成**标题目录**，点标题跳转到文档对应位置；行内代码引用到已索引的函数或文件名时可直接跳转到代码定义；点运行会提示"暂不支持"（文档无运行意义） |
| 📕 LaTeX | 点左侧 `+ TeX` 创建完整工程：自动生成 `main.tex` 及 `data / figures / fonts` 资源目录；编辑区左侧编写源码，右侧由 XeLaTeX/pdfLaTeX 防抖实时编译并显示 PDF，自动执行至少两遍以稳定交叉引用及 TikZ 页面定位；分割条宽度可记忆，大纲按章节生成，编译错误直接显示在预览区 |
| ✏️ 绘图 | 左侧绘图面板可按文件夹管理两类图稿：**Excalidraw** 适合手绘草图，**Draw.io** 适合流程图、架构图和 UML；新建时选择类型，分别保存为 `.excalidraw` 或 `.drawio`，支持打开、编辑、重命名、拖拽移动和自动保存。Draw.io 内置“✨ AI 绘图”和“`</>` XML”：可用自然语言生成/修改标准 mxGraph XML，可选联网检索绘图经验；也可直接查看、格式化、校验并载入 XML。应用会检查 XML 语法、根节点、单元 ID 及连线引用。Draw.io 编辑时需要联网，图稿仍保存于本地 vault 的 `drawings/` 目录 |
| 📚 阅读 | 与项目、Git、标签和绘图同级的阅读项目管理器，文件保存在 `vault/readings/`。左侧支持多级文件夹，项目和文件夹均可拖拽改变层级，每个项目可维护说明和标签；打开项目后，PDF 原版、中文/双语 PDF、Markdown、LaTeX 与常用代码文件统一显示为顶部片段标签。“＋片段”可直接选择片段类型；默认单栏，拖动标签到阅读区右侧会自动生成第二栏，关闭栏位后恢复单栏。Markdown 可在源码、Milkdown Crepe 区块编辑和阅读模式间切换，区块编辑器已随 Web/桌面资源离线打包；代码片段可直接编辑并自动保存。PDF 可切换“可选文本”，划选后 AI 翻译或保存摘录，右侧独立管理页码摘录和笔记。原始 PDF 始终保持不变 |
| 🧭 大纲 | 右侧结构导航器：按类型/函数/宏/文件级变量分组，支持普通 `typedef`、不透明类型别名和匿名结构体全局变量，显示签名、行号及函数声明/定义状态；可即时筛选、折叠分组，并在多文件片段中切换“当前文件/全部文件”。代码滚动时自动标出当前函数，点击条目跨文件跳转；编辑模式实时刷新 |
| ✨ AI 搜索 | 顶部统一搜索入口默认接受自然语言问题，可查询 API/函数的用途、签名、参数、返回值、异常、版本差异、注意事项和代码示例；先通过 Tavily 或 Brave Search 实时联网检索，再把带 URL、摘要和检索时间的资料连同当前项目符号交给 AI，项目命中项可直接点击定位。联网失败时明确提示，可手动选择仅用模型知识回答；“搜索记录”在当前浏览器保存最近 20 条查询，支持筛选、回填、单条删除和清空；弹窗内可切换回“项目符号”，Ctrl/⌘+Shift+F 仍直接打开原全局符号检索 |
| ⌕ 全文 / 📄 文件 | 搜索中心可检索全部代码、Markdown 与 LaTeX 片段，支持大小写和正则表达式，结果带命中行预览并可直接跳转；`Ctrl/⌘+P` 快速按文件名打开文件，`Ctrl/⌘+Shift+F` 直接进入全文搜索，`Ctrl/⌘+Shift+O` 打开项目符号检索 |
| 🔎 符号 | **Source Insight 式阅读**（右侧面板「🧭 大纲 / 🔍 符号」切换）：
  - **符号窗口**：按当前文件列出 函数 ƒ / 类型 ▣ / 宏 # / 变量 =，并明确区分函数**声明/定义**；
  - **上下文窗口**：点击代码中任意标识符 → 自动解析到最佳定义，右侧显示精确函数体、定义来源与**整个 vault 的代码引用**，点击可跨片段/文件跳转；注释、字符串和 Markdown 示例不会混入引用；
  - **调用关系**：基于真实函数定义统计整个 vault 的调用者(callers) / 被调(callees)，不会再把头文件声明后的代码误当成函数体；
  - **全局检索**：在顶部“✨ AI 搜索”弹窗切换到“🔎 项目符号”，或按 Ctrl/⌘+Shift+F 直接打开；可按函数/类型/宏/变量过滤，支持前缀、连续子串与字符序列模糊匹配，↑/↓ 选择、Enter 打开 |
| LSP 代码理解 | 内置 Pyright、TypeScript Language Server/TypeScript 和 gopls，为 Python、JavaScript/TypeScript 和 Go 提供悬停类型、跨文件定义与实时诊断；C/C++ 项目自动连接系统 clangd，不可用时继续使用内置符号索引。顶部代码面包屑持续显示当前文件、类型、函数与签名，右侧状态按钮可查看并跳转错误/警告 |
| 🌳 关系 | Source Insight 式关系图：默认用三栏箭头图直观呈现“调用者 → 当前函数 → 被调用”或“包含当前文件 → 当前文件 → 当前文件包含”，蓝线表示流入、绿线表示流出，函数指针目标标为“动态候选”；可切换传统树形、向下/向上/双向。文件关系可解析跨片段本地头文件与系统头文件；图形节点点击即可跳转并成为新的关系中心，树形节点支持逐层展开 |
| 窗口与标签 | 大纲、符号、关系、AI 都可作为独立窗口：从横向标签栏向下拖出后，像左侧面板一样纵向排列并可上下拉伸；把窗口标题拖回标签栏后，重新变成点一个显示一个的标签 |
| ▶ / ✓ / ✨ / ⌨（位置） | 运行/检查/格式化/输入按钮**固定在大纲面板顶部**，与大纲排在一起；点「🧭 大纲」收起大纲列表后，仍保留一列操作按钮，随时可用 |
| ✏ 编辑 / 💾 保存 | 只读 ↔ 可编辑切换：**Markdown / LaTeX** 编辑时左侧源码 / 右侧实时渲染并排（分割条可拖、宽度自动记忆）；**代码**使用与 VS Code 同源的 Monaco 内核，具备多光标、代码折叠、括号配对、小地图、悬停、诊断、命令面板和原生撤销。Ctrl/⌘+F 查找，Ctrl/⌘+H（macOS 也支持 ⌘⌥F）展开替换，F3 / Shift+F3 跳转，Alt+Z 切换并记忆自动换行，Ctrl/⌘+Space 按需显示代码补全；顶部面包屑同步显示当前作用域与 `Ln / Col` 光标位置。Cmd/Ctrl+S 或自动保存写回 vault，运行/检查/格式化可直接作用于尚未保存的编辑器内容 |
| ▥ 多栏编辑 | 像 VS Code 一样把顶部文件标签或左侧代码片段拖进编辑区，可自由组成 **2 栏、3 栏或 4 栏**，同时查看和编辑 `.h`、`.c` 等不同文件；每栏独立滚动、语法高亮和自动保存，栏间分割线可左右拖动并记忆宽度。辅助栏点 `↖` 可设为主栏，让大纲、符号、关系和运行功能随之切换；顶部 `▥ N 栏` 可一键恢复单栏。多栏时 Markdown / LaTeX 暂以源码栏显示，恢复单栏后继续使用实时渲染预览 |
| ⎇ Git Diff | 左侧 Git 面板按目录列出工作区改动；点击任意文件打开提交前差异检查，逐行区分新增、删除与上下文，并显示增删统计；支持未跟踪文本和二进制文件提示 |
| 🕘 本地时间线 | 每个片段自动保存时记录覆盖前版本；两分钟内的连续输入归为一次编辑会话，只保留会话开始前的可恢复版本，避免一行修改产生多条记录，最多保留 60 个；可预览差异并一键恢复，恢复前内容也会自动创建保护检查点；历史存放于系统 CodeScope 应用数据目录，不写入 Git 仓库 |
| ◫ 工程 | 自动发现 CMake、Make、Ninja、npm、Python 构建入口并支持自定义命令；读取 `compile_commands.json` 的编译单元、宏和头文件路径（宏同时参与 C/C++ 补全）；健康报告统计规模、语言、TODO、可能未实现项和头文件循环依赖，并排除论文 PDF、绘图、缓存和内置第三方库，避免把资料库误报成代码问题 |
| 🔍 环境 | 明确分为“运行基础 / 应用内置 / 项目工具 / 外部连接”：桌面安装包内置 CodeScope、编辑器、PDF/XMind、Prettier、Ruff、Pyright、TypeScript LSP 与 gopls；编译器、解释器和 LaTeX 按 vault 语言提示；AI 为可选连接，ONLYOFFICE Docs 明确标为 Office 必需服务 |
| ◐ 主题 | 提供深海蓝、石墨灰、午夜紫、森林绿和日光白五套完整工作台主题；代码高亮、终端、侧栏、关系图、弹窗与远程面板同步切换，并在本机自动记忆选择 |
| 🖥 远程 | 集成 SSH、SFTP 文件浏览与 VNC：SSH 复用底部真实 PTY 终端；远程窗口左边缘和上边缘可分别拖动调整宽度、高度并自动记忆；远程文件页可浏览目录、编辑 2 MB 内的 UTF-8 文本，通过流式接口无限制上传/下载文件，还可保留层级上传文件夹、把当前远程目录打包为 `.tar.gz` 下载；VNC 通过 noVNC 显示远程桌面并支持缩放、分辨率适配、只读模式、连续文本/中文输入和实时网络延迟 |
| 顶部电脑状态 | 页面可见时每 3 秒刷新 CPU、内存、硬盘使用率，以进度条和黄/红状态提示资源压力；切到后台后自动暂停轮询。点击任一指标可查看处理器、系统负载、可用内存、磁盘余量、系统与运行时间。macOS 使用可回收内存、Linux 使用 `MemAvailable`，避免把文件缓存误判为内存占满 |

**布局与侧栏**：
- 📐 **拖拽调整**：左侧列表宽度、右侧大纲宽度、底部输出窗口高度均可直接拖拽，自动记忆（左侧向右拉变宽；右侧**向左**拉变宽；输出向上拉变高）
- 🧩 **右侧窗口/标签组**：横向标签栏内一次只显示一个面板；把某个标签向下拖到内容区，它会脱离标签组成为独立窗口。多个独立窗口按纵向排列，拖标题可上下换位，拖底部分隔条可调整高度；点击标题栏的 `↩` 或把标题拖回标签栏，可重新合并为横向标签
- 🏷 **标签栏**：位于左侧**底部**、**两栏**排列；点「🏷 标签」整行可折叠成一行（标签多时不挤占空间），折叠后标题仍显示总数与已选标签；状态记忆
- 🔍 搜索 + 文件夹树（按 `.meta.yaml` 还原真实层级，空文件夹也显示，可折叠）

> - 代码区带内置语法高亮（离线可用，无需联网）。
> - **阅读快捷键**：鼠标停留在函数、类型、宏或变量上约 550ms → 显示定义位置、签名和源码片段；单击符号 → 右侧预览定义；Ctrl/⌘+单击、双击或 F12 → 跳转到最佳定义（多栏编辑器同样支持）；Alt+F12 → 就地预览定义；Shift+F12 → 查看引用；Alt+O → 切换同名 `.h/.c/.cpp`；Ctrl/⌘+- 与 Ctrl/⌘+Shift+- → 后退/前进代码位置。
> - **实时同步**：页面可见时每 3 秒自动检测 vault 变更（新增/修改/删除片段都会立刻反映），切到后台后暂停轮询；编辑模式不会被同步覆盖。
> - **环境检测**：启动前由 `preflight.js` 验证 Node.js 18+、监听地址/端口、Vault 与临时目录权限以及 npm 依赖；进入工作台后继续检测浏览器能力、本地工具、可选语言服务器、ONLYOFFICE 与 Draw.io 在线服务。项目工具按 vault 实际语言计算必需项，网络服务不可用时仅降级对应功能，不会误加入一键安装命令。顶部「环境」绿点表示所有必需项就绪，红点表示需要处理。

开发验证：`npm test` 运行服务端/API/静态回归测试；`npm run test:browser` 使用本机 Chrome/Chromium 运行真实编辑器交互测试。可用 `CODESCOPE_BROWSER` 指定浏览器可执行文件。
>   缺某个工具时，运行/检查/格式化会给出明确的「缺少 xx，安装: xxx」提示，而不是晦涩报错。
> - **一键配置**：只安装当前项目实际需要且尚未安装的工具。macOS、Linux、Windows 都会切换到底部交互终端执行，涉及系统权限时可直接输入密码；命令结束后自动复检并给出成功或缺失结果。
> - **远程凭据**：SSH 终端密码只交给系统 `ssh`；SFTP 文件浏览密码和 VNC 密码只保存在当前网页内存，服务端仅在当次连接中使用且不记录。浏览器只持久化主机、用户名和端口。

## SSH / VNC 远程开发

点击顶部「🖥 远程」：

- SSH：填写主机、用户名和端口，可选填私钥绝对路径；连接后在底部终端完成指纹确认或密码输入。点“断开并回到本地”后，终端会恢复本地 shell。
- 远程文件：复用同一组 SSH 参数，通过 SFTP 浏览目录、打开文本并保存回远端；可上传单个/多个文件，也可选择或拖入整个本机文件夹并保留其层级。选中远程文件可直接下载，“下载当前文件夹”会在远端实时打包为 `.tar.gz`。文件传输采用流式接口，不设应用层大小上限；同名文件上传前会确认。私钥或 SSH Agent 认证可直接使用。系统 SSH 终端不会把交互输入的密码暴露给网页，因此使用密码认证时需要在“远程文件”页的不保存密码框中重新输入一次。
- VNC：填写远程桌面的主机、端口（默认 `5900`）和密码，随后在全屏工作区操作；可随时切换“只读”。远端必须先启用 VNC/屏幕共享。
- 局域网访问码境时，SSH/VNC 入口也会随页面开放。只应在可信网络使用，并通过系统防火墙限制 `4877` 端口的访问来源。

## LaTeX 工程资源

新建 LaTeX 工程会自动生成以下结构：

```text
工程名/
├── main.tex
├── data/
│   └── references.bib
├── figures/
└── fonts/
```

- `data`：存放并在线编辑 `.bib`、`.csv`、`.json`、`.yaml`、`.tex` 等文本资源；模板已接入 `data/references.bib`，环境有 Biber 时自动生成参考文献。
- `figures`：上传并预览 PNG、JPEG、PDF 等图片或图表，支持在预览页直接重命名，源码可通过 `\includegraphics{文件名}` 引用。
- `fonts`：上传并预览 OTF、TTF、TTC、WOFF 字体；XeLaTeX 可通过 `\setmainfont{字体文件名}[Path=fonts/]` 使用本地字体。
- 左侧资源文件可直接打开；文本可编辑保存，图片、PDF、字体可预览，也可通过目录行的 `＋` 上传或替换。项目文件夹可拖到其他普通文件夹或根目录，资源也可拖到另一工程的同类型资源目录。LaTeX 左侧源码在编辑过程中持续语法高亮，右侧同步编译 PDF。编译时资源会按原目录复制到隔离的临时环境中；单个资源上限为 32 MB、工程资源总量上限为 96 MB，超限文件会在编译日志中明确列出。

## 多文件片段（.cpp + .hpp 一起编译）

massCode 一个片段里可以有多个 fragment。**把 fragment 标签写成文件名**，运行时就会把所有 fragment
写到同一临时目录并**一起编译/运行**：

- **C/C++**：标签命名如 `main.cpp`、`calc.hpp` → 运行 = `g++ main.cpp ... -I<dir>` 一起编译（头文件用
  `#include "calc.hpp"` 即可找到），再执行二进制。
- **Python/JS/TS/Bash/Ruby/Swift/Go**：同样按文件名写进同一目录，跨文件 `import` / `require` 生效。
- 标签不是文件名时自动兜底：单文件 `main.<ext>`，多文件 `file1.<ext>`、`file2.<ext>`…
- 界面上多文件片段会显示「📦 N 个文件」徽章；大纲/编辑按当前选中的 fragment 生效。

## 支持的语言

| 语言 | 运行 | 检查 | 格式化 |
|------|:--:|:--:|:--:|
| JavaScript | node | node --check | Prettier |
| TypeScript | node（原生剥离类型） | node --check | Prettier |
| Python | python3 | py_compile | 内置 Ruff（Black 兼容） |
| Bash | bash | bash -n | Prettier |
| C | gcc 编译+运行 | gcc -fsyntax-only | clang-format |
| C/C++ | g++ 编译+运行 | g++ -fsyntax-only | clang-format |
| Java | java（单文件源码运行） | javac | — |
| Ruby | ruby | ruby -c | — |
| Swift | swift | swiftc -typecheck | — |
| Go | go run | go vet | gofmt |
| JSON | —（校验结构） | JSON.parse | Prettier |
| HTML | 预览渲染 | — | Prettier |
| LaTeX | 实时编译 PDF（XeLaTeX，回退 pdfLaTeX） | 编译即检查 | — |
| 其他 | 提示不支持 | — | 提示不支持 |

> 格式化工具：C/C++ → clang-format，Go → gofmt，Python → 内置 Ruff，其余 → 内置 Prettier。
> Ruff、Prettier 和 Shell 格式化插件随应用离线分发，不会在第一次使用时联网下载。clang-format / gofmt 仅在对应原生工具链项目中使用。

## 配置

- 端口：`CODESCOPE_PORT`（默认 `4877`）
- 监听地址：默认 `CODESCOPE_HOST=127.0.0.1`（仅本机）；局域网访问时设置为 `0.0.0.0`，再通过本机局域网 IP 访问，例如 `http://10.16.0.205:4877`
- 手动指定 vault：`CODESCOPE_VAULT=/path/to/markdown-vault node server.js`
- 兼容旧配置：`MASSCODE_RUNNER_PORT`、`MASSCODE_RUNNER_HOST`、`MASSCODE_VAULT` 仍然有效，但优先使用 `CODESCOPE_*`。
- 自动从 massCode 偏好设置（`~/Library/Application Support/massCode/v2/preferences.json` 的 `storage.rootPath`）
  读取 vault 路径（vault = rootPath 下的 `markdown-vault`）；读不到时按 `~/massCode/markdown-vault` 兜底
- 运行日志建议写到 `/tmp/codescope.log`（不写进程序目录，避免云同步到日志）

## 云同步（iCloud Drive）

**当前状态：整个 `massCode` 目录已放进 iCloud Drive，片段与工具自动同步到你的所有设备。**

- **同步内容**：`markdown-vault/`（片段库）、`masscode-runner/`（码境程序）、`启动码境.command`。
  用任一台 Mac 修改片段，其他设备稍后自动同步（iCloud 后台上传/下载）。
- **为什么能同步**：massCode 没有内置云同步，但它的片段就是普通 `.md` 文件；放进 iCloud Drive 后，
  由 iCloud 负责跨设备同步文件。本工具和 massCode 的 vault 路径都指向 iCloud 里的同一份 `markdown-vault`，
  所以两端读写的是同一份数据。
- **修改文件后**：在 massCode 里能看到（它在监听 vault）；反之 massCode 里改的，本工具 2.5s 内自动刷新。

### 换一台 Mac 的步骤

1. 确保新 Mac 登录了**同一个 Apple ID 且开启 iCloud Drive**，等待 `iCloud Drive/massCode` 同步完成。
2. 安装依赖（工具本体随 iCloud 走，无需拷贝）：
   ```bash
   brew install node                 # 必须：跑工具 + JS/TS
   xcode-select --install            # 强烈建议：gcc/g++/clang-format/swift 全有了
   brew install go                   # Go 运行 + gofmt（可选）
   # 想跑哪种语言就装哪种运行时（Java/Ruby/Python-black 等，见「🔍 环境」面板提示）
   ```
3. 让 massCode 指向 iCloud 里的 vault：
   - 方法一（推荐）：打开新 Mac 的 `~/Library/Application Support/massCode/v2/preferences.json`，
     把 `storage.rootPath` 改成 iCloud 里的 `massCode` 路径，再启动 massCode；
   - 方法二：给码境设置环境变量 `CODESCOPE_VAULT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault"`。
4. 双击 `iCloud Drive/massCode/启动码境.command` → 打开 http://127.0.0.1:4877 → 点「🔍 环境」检查缺什么。

> **注意**：iCloud 为省空间可能把个别文件标记为「仅云端」（文件名带 ☁ 图标）。工具运行前会按需下载，
> 一般无感；若某片段缺失，等它下载完即可。避免在**多台电脑同时编辑同一个片段**，以免 iCloud 版本冲突。

### 常见场景
- **只想片段同步**：只需把 `markdown-vault/` 放进 iCloud/云盘即可。
- **不用 iCloud 也行**：换用 Dropbox / Google Drive / Syncthing / Git 仓库做同步目录，原理一样。
- **Windows/Linux**：工具是纯 Node + 跨平台，同样可用；把 Homebrew 换成对应包管理器即可。

## 跨系统（Windows / Linux）

工具采用 **Node.js + 浏览器**，逻辑上跨系统通用；已针对各平台做了适配与验证：

| 项 | 适配情况 |
|----|---------|
| **vault 自动定位** | ① 优先找工具目录上级的 `markdown-vault`（整个文件夹一起放云盘/本地时一定成立，**跨系统最稳**）；② 再读 massCode 各平台偏好设置（macOS/Win/Linux 路径均已内置）；③ 最后常用路径兜底。Windows 上无需手动配置也能找到 vault |
| **Python** | Windows 通常没有 `python3`，已自动回退用 `python` / `py`（运行、检查、black 均生效） |
| **超时终止** | Windows 没有 POSIX 进程组，已改用在任何系统都能杀掉超时子进程的方式 |
| **安装提示** | 「🔍 环境」面板按当前系统给出安装命令：macOS→brew，Windows→winget，Linux→自动识别 apt/dnf/yum/pacman/zypper/apk |
| **一键部署** | 扫描 vault 语言后只安装缺失依赖；部署过程进入交互终端，不隐藏权限申请和错误输出 |
| **一键启动** | macOS `.command` / Windows `.bat` / Linux、WSL `.sh`（前台运行、Ctrl+C 停止） |

### 各平台开箱即用 / 需安装

| 语言 | macOS | Windows | Linux |
|------|:--:|:--:|:--:|
| JS / TS | ✅ node | 装 Node.js 后 ✅ | 装 nodejs 后 ✅ |
| Python | ✅ python3 | `python`/`py` 自动识别 ✅ | ✅ python3 |
| Bash | ✅ 自带 | ⚠️ 默认无 bash，需 Git Bash 或 WSL | ✅ 自带 |
| C / C++ | ✅ xcode 工具链 | ⚠️ 需 MinGW-w64 或 VS C++ 工具 | ⚠️ 需 `apt install gcc g++` |
| Java / Ruby / Go | 装对应运行时 | 装对应运行时 | 装对应运行时 |
| Swift | ✅ xcode 工具链 | ⚠️ 仅实验性工具链 | ⚠️ swift.org 工具链 |

> 浏览器端（界面/大纲/高亮/标签/拖拽/编辑保存）无系统差异，Windows 上体验与 macOS 一致。
> 唯一小坑：在 Windows 里**用 CRLF 换行创建的 bash 片段**可能报 `$'\r'` 错误——用 LF 即可（工具解析、写回都兼容 CRLF）。

## 安全提示

本工具会在本机以你的权限执行片段代码。片段库通常是你自己的代码，风险可控；
但请勿在**共享/不信任的 vault** 上点击运行任意片段。

## 局限

- Web 模式关闭浏览器页面不会自动结束后端服务，需要在启动终端按 `Ctrl+C` 停止；桌面模式退出应用时会一并停止其本地服务。
- 不拦截系统调用：`rm -rf` 之类会真实执行（这就是"运行"的意义，使用时请留意）。
- 本机没有的运行时（如 rustc/php/dotnet/perl）会提示不支持；装好后刷新环境面板即可。
