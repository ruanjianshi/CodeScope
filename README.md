# 码境 CodeScope v2.0

面向代码阅读、编写、工程文档、论文研究与可视化的一体化本地工作台。CodeScope 把代码编辑器、Markdown 知识库、PDF 阅读笔记、Office 文档与多种绘图工具放进同一个可组合界面，数据仍保存在用户自己的 `markdown-vault` 中。

CodeScope 采用“单内核、双入口”架构：Web 端与桌面端共用界面、服务 API 和 Vault 数据格式。Web 端适合浏览器、局域网与服务器部署；桌面端提供独立窗口、原生菜单、Vault 选择、单实例运行和自动更新能力。

## v2.0 能做什么

| 工作区 | 主要能力 |
| --- | --- |
| 代码 | Monaco 编辑器、多光标、折叠、查找替换、语法高亮、LSP、定义/引用/调用关系、运行、检查、格式化、Git Diff、本地时间线与多栏编辑 |
| Markdown / LaTeX | 源码、分栏、实时编辑、阅读模式；Obsidian 风格 Markdown 渲染、区块操作、拖拽排序、引用代码定位；LaTeX 实时编译 PDF |
| 论文阅读 | PDF 文库、多版本并排、缩略图、可选文本、翻译、摘录和页码定位，笔记与原文一一对应 |
| 绘图 | Draw.io、Excalidraw、XMind；思维导图支持直接编辑、重排父子关系、自由主题、缩放、平移、导入导出与多种布局 |
| Office | 独立 Office 文库；连接 ONLYOFFICE Docs 时完整编辑 DOCX/XLSX/PPTX，离线时提供 Word/表格兼容编辑与演示文稿预览 |
| 工程与远程 | 构建/测试/调试入口、编译数据库、工程健康检查、SSH、SFTP、VNC 与跨平台环境诊断 |

## 快速开始

### Web 模式

要求 Node.js 18 或更高版本。启动脚本会检查版本、Vault 权限、端口与运行依赖，缺少 npm 依赖时自动安装。

- macOS：双击 `启动码境.command`
- Windows：双击 `启动码境.bat`
- Linux / WSL：运行 `chmod +x 启动码境.sh && ./启动码境.sh`
- 命令行：进入 `masscode-runner` 后执行 `npm ci && npm start`

默认地址为 `http://127.0.0.1:4877`，仅监听本机。需要可信局域网访问时显式设置 `CODESCOPE_HOST=0.0.0.0`。可用 `CODESCOPE_PORT`、`CODESCOPE_VAULT` 与 `CODESCOPE_DATA_HOME` 覆盖端口、资料库和应用数据目录。

### 桌面模式

```bash
cd masscode-runner
npm ci
npm run desktop:dev       # 开发模式
npm run make:desktop      # 生成当前系统安装包
```

桌面端会在独立进程启动同一套本地服务，默认复用已有 Vault；首次使用时会在系统“文档/CodeScope/markdown-vault”创建资料库。通过“文件 → 切换 Vault”可选择其他资料库。正式安装包由 GitHub Actions 分别为 macOS、Windows 和 Linux 构建，更新不会覆盖 Vault。

正式桌面安装包已内置 Electron、Node.js 和 CodeScope 的 npm 运行依赖，目标电脑无需另装 Node.js 或执行 `npm install`，安装后即可从应用图标启动。编译器、LaTeX、语言服务器、ONLYOFFICE Docs 等属于按功能启用的可选工具链：阅读、Markdown、PDF、Office 兼容模式和本地绘图不依赖它们，只有运行对应语言或启用完整 Office/LaTeX 能力时才需安装。

## 数据与兼容性

- 代码、文档、论文、Office 文件和图稿均保存在 `markdown-vault`，不绑定云服务。
- 兼容 macOS、Windows、Linux 与 WSL；环境面板会显示系统、包管理器、Node、目录权限、依赖、浏览器能力及项目实际需要的工具链。
- Web 与桌面模式共用 Vault；应用程序、运行缓存和用户资料相互分离，升级或重新安装不会删除代码与文档。
- ONLYOFFICE、Draw.io 在线编辑和 AI 绘图属于可选服务；不可用时不会阻塞代码、Markdown、PDF 或本地绘图能力。
- SSH/VNC 凭据不写入 Vault；本地时间线存放在系统 CodeScope 应用数据目录。

## 开发与验证

```bash
cd masscode-runner
npm ci
npm test
npm run test:browser
node preflight.js --json
```

更完整的操作说明见 [masscode-runner/README.md](masscode-runner/README.md)，版本变更见 [masscode-runner/CHANGELOG.md](masscode-runner/CHANGELOG.md)。

项目地址：[github.com/ruanjianshi/massCode](https://github.com/ruanjianshi/massCode)
