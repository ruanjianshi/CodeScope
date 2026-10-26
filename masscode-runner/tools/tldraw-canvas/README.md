# 无限画布（tldraw）源码

CodeScope「无限画布」的源码。编译产物是 **`assets/vendor/tldraw.bundle.js`**（页面直接 `<script>` 引入）。

## 为什么这份源码在仓库里

它原来一直放在 `/tmp/tldraw-build/`，2026-10-26 被系统清理掉了，仓库里只剩压缩后的 bundle
（2.2 MB），源码不可还原。所以搬进仓库，和产物一起版本化。

**以后改画布：改这里的 `entry.jsx` → 重新构建 → 提交 `entry.jsx` 和 bundle 两个文件。**

## 构建

```bash
cd tools/tldraw-canvas
npm i                 # 首次
bash build.sh         # 或 npm run build
```

产物：`../../assets/vendor/tldraw.bundle.js` + 同名 `.css`（tldraw 会自动输出样式）。

> `node_modules` 已被 `.gitignore` 忽略，不用提交。

## 与外部代码的契约

画布页（`assets/canvas/index.html`）和交互层（`assets/canvas/canvas-ext.js`）依赖这几个全局：

| 全局 | 作用 |
|---|---|
| `window.__tldraw` | 编辑器实例 |
| `window.__tldrawSnapshot()` | 当前 store 快照（存盘用） |
| `window.__tldrawLoad(snap)` | 载入快照，**返回成败** —— 上层靠它判断"能不能保存" |
| `window.__csLib` | `{ createShapeId, AssetRecordType, createShapesForAssets, uploadDataUrl }` |
| `tldraw-ready` 事件 | `onMount` 里派发，上层据此开始载入数据 |

⚠️ `__tldrawLoad` **必须返回布尔值**。吞掉异常会让上层把"载入失败"当成"载入成功（空画布）"，
然后拿空画布覆盖用户文件。

## 图形清单

| type | 属性 | 缩放 | 编辑 | 说明 |
|---|---|---|---|---|
| `card` | `w,h,markdown,color` | ✓ | ✓ | 彩色标题栏 + Markdown 正文（公式 / 代码高亮 / 图片） |
| `webcard` | `w,h,url,title` | ✓ | ✓ | iframe 嵌网页；不编辑时不吃鼠标 |
| `subboard` | `w,h,title,pageId` | ✓ | ✗ | 子白板；双击派发 `cs-enter-page` |
| `sticky` | `w,h,text,color` | ✓ | ✓ | 便利贴，**自由缩放** |
| `pdfcard` | `w,h,title,pages,page,zoom` | ✓ | ✗ | PDF **连续滚动**阅读 |
| `mnode` | `w,h,text,color` | ✓ | ✓ | 早期思维导图节点（旧画布兼容） |
| `mindcard` | `w,h,title,data` | ✓ | ✓ | 思维导图窗口（内嵌 Mind Elixir） |

## 几个必须知道的坑

**① 便签不用 tldraw 自带的 `note`**
它的 props 里没有 `w/h`（只有 `size` / `growY`），尺寸自动算、`hideResizeHandles()` 恒为 true
→ 选中后没有缩放把手，拖不动大小。所以另做了 `sticky`。

**② 卡片标题只存一份**
标题取正文第一个 `# 标题`；正文渲染前会把它摘掉（`bodyMarkdownOf`），否则同一行标题出现两次。

**③ 公式只走文本节点**
`renderMathInHtml` 用 TreeWalker 跳过 `code` / `pre` —— 直接对 HTML 正则替换会把代码块里的
`$PATH` 也当公式。

**④ 卡片自动长高量的是内层 `.cs-card__md`**
不能量 `flex:1` 的容器（它永远等于卡片高度，永远不触发）。

**⑤ mindcard 的 iframe 有竞态**
iframe 一加载完就 `postMessage('ready')`，而父窗口的监听是 `useEffect` 里才挂的，可能错过
→ iframe 的 `onLoad` 里也要主动推一次数据。

**⑥ 滚轮事件**
可滚动内容（PDF 正文、卡片编辑框）的滚轮要在 **window 捕获阶段**接管，否则会被画布拿去平移
—— 这段逻辑在 `assets/canvas/canvas-ext.js` 的 `bindWheelGuard()`，不在本目录。

## 样式在哪

`assets/canvas/canvas-theme.css`。类名约定：`.cs-card*` / `.cs-web*` / `.cs-sticky*` /
`.cs-pdf*` / `.cs-mn*` / `.cs-mindw*`。改样式只动 CSS，不用重新构建。
