# 码境 CodeScope ·「立体感 / 交互感 / 灵动感」全项目审计（2026-10）

> 只读审计。本文件之外**没有改动任何源代码文件**；没有 git 写操作。
> 审计基线：`masscode-runner` 仓库 HEAD = **`304ee9b`**（2026-10-31，`git rev-parse --short HEAD`）
> 方法论：`~/.agents/skills/improve-animations`（SKILL / AUDIT / PLAN-TEMPLATE）
> 实测环境：Chrome（`playwright-core` 无头，1440×900，DPR 1）访问 `CODESCOPE_PORT=4913` 的隔离实例，测完 **SIGKILL**；全程未触碰 4877。

## 0. 怎么读这份文档

### 0.1 证据等级（每条结论都带一个）

| 标记 | 含义 |
| --- | --- |
| **【实测】** | 在 4913 隔离实例里用 `getComputedStyle` / `performance` 读到的真实值，或跑了真命令（`node tests/architecture.js`）。数值原样抄录。 |
| **【读码】** | 只来自读 `file:line`，未在浏览器里触发。可能受运行时注入（Crepe / Monaco / 皮肤 JS）影响，执行前需复核。 |
| **【推断】** | 由特异性/层叠规则推导出的结论，未实测。计划里必须补一次实测。 |

### 0.2 被审计代码的真实分层（决定每份计划的落点）

`index.html:107-144` 的加载顺序 **（【读码】）**：

```
app.css → ui-kit.css → doc-theme.css → motion.css
        → motion-lw.css → motion-sp.css → motion-study.css → motion-cg.css → motion-dbg.css
        → motion-monaco.css → editor-chrome.css
```

三条推论，每份计划都要遵守：

1. **`motion.css` 之后还有 7 个文件能同级压它**。新规则若想赢，落点必须在这 7 个之后（建议新文件挂在 `editor-chrome.css` 之后），或自带更高特异性。
2. **`editor-chrome.css` 目前 0 条 transition / 0 个 @keyframes 【实测：grep -c = 0】** —— 它排在最后但不构成冲突，可以放心把新文件接在其后。
3. **皮肤层 `html[data-theme] button`（app.css:3284，特异性 (0,1,2)）是真正生效的基础按钮层**，任何想接管按钮过渡的规则都必须带 `html[data-theme]` 前缀（`motion.css:84-85` 已就此写过实测结论）。

### 0.3 三条硬约束的当前状态（先确认，再设计）

| 约束 | 现状 | 证据 |
| --- | --- | --- |
| 动效令牌在 `motion.css:40-53` | **存在且解析正确** | 【实测】`:root` 上读到 `--mo-1:120ms`、`--mo-2:180ms`、`--mo-3:260ms`、`--mo-4:400ms`、`--mo-out:cubic-bezier(.2,.8,.2,1)`、`--mo-back:cubic-bezier(.34,1.56,.64,1)`、`--mo-in-out:cubic-bezier(.4,0,.2,1)`、`--mo-drawer:cubic-bezier(.32,.72,0,1)`、`--mo-lift:-1px`、`--mo-press:.985` |
| `prefers-reduced-motion` 兜底 | **已经有效，不要重做** | 【实测】`emulateMedia({reducedMotion:'reduce'})` 后：`#list .item` transition-duration = `1e-05s`；`.welcome-actions button` animation-name = `none`、iteration-count = `1`；`#autosave-hint::before` duration = `1e-05s`、iteration = `1` |
| 行数棘轮 | **11 个文件余量全部为 0** | 【实测】按 `tests/architecture.js:codeLines()` 的算法统计（见 §6.2）。`node tests/architecture.js` = 91/91 通过 |

**棘轮零余量是本次审计最强的约束**：`app.css 4212/4212、motion.css 273/273、ui-kit.css 785/785、doc-theme.css 692/692、motion-canvas.css 271/271、motion-lw.css 169/169、motion-study.css 163/163、motion-cg.css 166/166、motion-dbg.css 136/136、motion-sp.css 103/103、motion-monaco.css 60/60`。
⇒ **任何新增 CSS 行都必须同时给出「腾行方案」**：要么写进一个尚未登记的新文件（推荐），要么在同一个文件里 1:1 压掉等量代码行。（`index.html` 不在棘轮清单内【读码：清单见 tests/architecture.js:208-242、:415】，所以加 `<link>` 不受限。）

### 0.4 排除区的处理方式

「本机管家」7 页（`system-panel.js`）与「个人管理面板」的备忘录/日记编辑器（Crepe + Phycat、大纲）只做**抽查是否被破坏**，结论见 §5.3；其余全部纳入本轮覆盖。

---

## 1. 现状盘点（按区域）

### 1.1 总表

| # | 区域 | 承载文件 | 判定 |
| --- | --- | --- | --- |
| A1 | 侧栏树（文件夹 / 片段行） | `motion.css:203-271` + `app.css` | **已经不错** |
| A2 | 标签页（`.tab` / `.otab` / 阅读项目 tab） | `motion.css:274-331` + `motion.js:207-368` | **已经不错**（唯一带共享指示条滑动的组件） |
| A3 | 命令面板 ⌘K（`#sym-modal`） | `app.css:2628-2651`、`:3042-3043`、`:3249`、`:3387` | **完全没有**（零入场） |
| A4 | 快捷键提示 | `app.css:3810-3811`（`.welcome-shortcuts kbd`）、`#xmind-shortcuts` | 静态（**刻意**，见 §5.1）；XMind 面板硬切 |
| A5 | 右键菜单 | `motion.css:334-373` | **已经不错**（`@starting-style` + 逐次写 `--ctx-origin`/`--ctx-start-y`） |
| A6 | 状态提示 / 通知 | `motion.css:441-511` + `app.css:2053-2059` | **已经不错**（`#nav-notice.error` 有 6px 横向入场；`#status` 有 640ms 脉冲） |
| A7 | 抽屉（git 面板等） | `ui-kit.css:378-389` | **有一层，但被 id 规则抢走**（见 S3） |
| A8 | 工作台分栏 / 拖拽分隔条 | `motion.css:417-438`（收编 5 个）+ `app.css`（未收编 6 个） | **分裂成两套实现** |
| A9 | 代码编辑区标签 / 输出标签 | `motion.css:282-290` | **已经不错**【实测 `.otab` = 0.12s×4 + 0.18s transform】 |
| A10 | 查找替换（`#editor-find`） | `app.css:2020-2033` | 硬切，**判定为刻意**（§5.1） |
| A11 | AI 助手面板 | `app.css:2965-2976`、`:122-168` | 拖拽态硬跳；typing 三点节奏独立 |
| A12 | 知识库 / 阅读 / PDF / Office / XMind | `doc-theme.css`、`motion-canvas.css:48-396`、`app.css:1880-1882` | 一半改造过（h2 已 transform 化），一半仍是裸值 |
| A13 | 轻量页（常用网址 / 热榜 / 邮箱 / 工作流） | `motion-lw.css:56-289`（8 节）+ `life-styles.js` | **已经不错**（`#site-menu-panel` 实测有 opacity+translate 入场） |
| A14 | 全局：视图切换 / 首屏 / 空状态 / 基础控件 | `motion.js:39-50`、`app.css:2331`、`:3785-3788` | 视图切换与基础控件**已经不错**；空状态**完全没有** |

### 1.2 已经不错的地方（本轮**不要动**，动了就是倒退）

| 项目 | 位置 | 为什么算好 | 证据 |
| --- | --- | --- | --- |
| 令牌四档 + 三曲线 | `motion.css:40-53` | 时长 120/180/260/400 保持 ~1.5× 梯度；过冲曲线被产品规则锁死 | 【实测】值见 §0.3 |
| 树行「按下」反馈 | `motion.css:233-238` | 按下时真有 1% 收紧 + 14% 强调色；且用 `:not(.dragging):not(.drop-target)` 打平了 app.css:3655 的 (1,4,0) | 【实测】按下瞬间 `transform: matrix(0.990001,0,0,0.990001,0,0)`、背景 `oklab(… / 0.14)` |
| 标签共享指示条 | `motion.js:207-368` | 跨 tab 滑动 + 滑动期间藏静态下划线（`#tabs[data-mo-sliding]`），是精确的 interruptibility 处理 | 【读码】 |
| 右键菜单原点跟随 | `motion.css:341-365` + `app.js:showContextMenu()` | 菜单从「被夹住的那一边」长出来，方向随实际展开方向翻转 | 【读码】 |
| 面板入场只给 11 个容器 | `motion.js:39-47` | **`#code-wrap` 被显式移出**（每次切片段都淡入 = 让用户等 260ms），并留了「退出记录」注释防回潮 | 【读码】 |
| 首屏按钮 stagger | `app.css:3785-3788` | 真的有 40ms 递进，且用的是 `--mo-3`/`--mo-out` | 【实测】第 1–8 个 delay = 0/40/80/…/280ms |
| reduced-motion 全局兜底 | `app.css:3823`（`*` 选择器） | duration→`.01ms` **且 iteration-count→1**（很多人只压 duration，动画还在无限跑） | 【实测】全部元素 `1e-05s` / iteration 1 |
| 分隔条已收编的 5 个 | `motion.css:424-438` | 拖拽中（`.active`）发光加宽用的是 `background`+`box-shadow`，**命中区宽度一格没动** | 【读码】 |

### 1.3 完全没有的地方（本次新增覆盖）

| 项目 | 位置 | 现状 |
| --- | --- | --- |
| 命令面板整屏过渡 | `#sym-modal` | 连采 6 帧（间隔 40ms）`opacity` 恒为 `1`、`transform` 恒为 `none`、`transition-duration` = `0s`【实测】 |
| 抽屉的方向与曲线归口 | `#pane-git` | 实测吃到的是 `cs-drawer-in 0.16s ease-out translateX(18px)`，与 `--mo-drawer`、`--mo-3` 无关【实测】 |
| 拖拽中状态过渡 | `.stack-pane.dragging`、`#ai-panel.dragging` | 加类瞬间 `opacity` 直接 0.42、`filter` 直接 saturate(.7)，`transition-duration` = `0s`【实测】 |
| 浮层入场（.hidden 切换那一类） | `#code-actions-pop`、`#definition-peek`、`#lsp-problems`、`#xmind-shortcuts` | 四个全部 `transition-duration: 0s`、`animation-name: none`【实测】 |
| 层级（elevation）语言 | 全站 `box-shadow` | 首页存在 **50 个互不相同**的 box-shadow；浮层类 6 组近似值并存【实测】 |
| 空状态的处理 | `.empty-state`（app.css:2331） | 纯静态文本，N→0 时瞬变（**但主列表每 1.5–4s 重建 ⇒ 这里不该加动画**，见 §5.1） |
| 首屏 stagger 的收尾 | `app.css:3785` | 只覆盖每组前 8 个；`#welcome-vscode / #welcome-system / #welcome-history / #welcome-manual` 的 animation-name = none【实测】 |

---

## 2. 问题清单

分三档。每条：**现象 → 根因（具体到选择器/JS 行）→ 影响面 → 修复建议（取值 + 落点文件 + 所需特异性）**。

### 2.1 立体感（层级、阴影、材质）

#### S1 · 全站没有 elevation 三档，浮层之间分不出「高多少」【实测】

- **现象**：首页 50 个不同 `box-shadow`。单看「浮起来的东西」就有 6 组近似但不相同的值：`0 6px 16px rgba(0,0,0,.55)`、`0 8px 24px rgba(0,0,0,.42)`、`0 12px 40px rgba(0,0,0,.42)`、`0 16px 40px rgba(0,0,0,.55)`、`0 18px 50px rgba(0,0,0,.34)`、`0 24px 40px rgba(0,0,0,.55)`。命令面板（`app.css:3043`）与右键菜单（`app.css:270`）在数值上**几乎无法区分层级**。
- **根因**：仓库只有颜色/间距令牌，**没有阴影令牌**；每个组件各自手写像素值（`app.css` 内 `box-shadow` 直接出现的行 > 120 处【读码】）。这是 AUDIT §7「five hand-typed curves」的阴影版本。
- **影响面**：所有浮层（菜单/下拉/弹窗/抽屉/palette）。用户学不到「哪一层更高」，只能靠明暗猜；新增组件必然再造一个新值。
- **修复建议**：新增 `assets/motion-depth.css`（**新文件，绕开棘轮**），在 `:root` 落三档：

```css
:root {
  /* e1 抬升（行/卡片 hover、拖拽中） */
  --mo-e1: 0 2px 6px -2px rgb(0 0 0 / .45);
  /* e2 浮层（菜单 / 下拉 / 组合框 / 抽屉把手） */
  --mo-e2: 0 8px 24px -6px rgb(0 0 0 / .55);
  /* e3 模态（palette / 弹窗 / 抽屉） */
  --mo-e3: 0 18px 50px -12px rgb(0 0 0 / .62);
}
```

三档必须**同时**在 y-offset（2 / 8 / 18）、blur（6 / 24 / 50）、alpha（.45 / .55 / .62）三个维度单调，这样 computed 值可机器比对（§4 P-05 验收）。首批只改 3 个「学费最高」的面：`#sym-modal-box`（→ e3）、`.ctx-menu`（→ e2）、`#pane-git`（→ e3）。
**特异性**：`#sym-modal-box` 是 id（(1,0,0)），`.ctx-menu` 是类（(0,1,0)，但被 app.css 里 3 条同名主题规则压着）⇒ 写 `#sym-modal-box`、`html[data-theme] .ctx-menu`、`body.git-open #pane-git`，并让新文件排在 `editor-chrome.css` 之后。

#### S2 · 命令面板把整个视口一帧变暗 + 整屏模糊【实测】

- **现象**：`#sym-modal` 从 `display:none` 变 `display:flex`，同一帧就把 `rgba(3,7,12,.73)` 的遮罩 + `backdrop-filter: blur(7px)` 铺满视口。采样 6 帧（0/40/…/200ms）`opacity` 恒 1、`transform` 恒 none、`transition-duration` 恒 `0s`。
- **根因**：`app.css:2628-2629` 只有 `#sym-modal { display:none } / #sym-modal.open { display:flex }`；`backdrop-filter:blur(7px)` 在 `:3249` 的主题块里，同样没有过渡。`motion.css:387-414` 收编了 7 种弹窗，**唯独漏了 `#sym-modal`**。
- **影响面**：⌘K 是文档里自己列出的主手筋（`index.html` 的 `welcome-shortcuts` 同时列了 ⌘K 与 ⌘⇧P）。它一天被开几十次，每次都是「整屏啪一下」，而同一产品的弹窗、右键菜单、标签页都有节奏 —— 这是**唯一一个完全没有过渡的高频浮层**。
- **修复建议**：**面板本体不加任何动画**（键盘高频动作，Raycast 口径），只给遮罩 120ms 线性淡入：

```css
/* assets/motion-palette.css —— 排在 editor-chrome.css 之后 */
#sym-modal.open { animation: mo-overlay-in 120ms linear both; }
@keyframes mo-overlay-in { from { opacity: 0; } }
```

**特异性**：`#sym-modal.open` = (1,1,0)，高于现有的 `#sym-modal`，且新文件后加载 ⇒ 稳赢，不需要 `!important`。
**为什么是 opacity 而不是 background-color**：主题块有 4 处不同的背景色（`app.css:2628 / :3042 / :3249 / :3387`），逐条镜像会在皮肤层留下 4 份副本；opacity 与颜色无关。代价是面板也参与这 120ms 淡入（约 2 帧），这是**有意取舍**。
**注意**：`backdrop-filter` 仍会瞬现；不要在 120ms 里过渡 blur —— 全屏滤镜动画在 Safari 上是已知掉帧点（AUDIT §5），计划里给了实测判据而不是默认放行。

#### S3 · 抽屉有两层动效，且被 id 选择器抢走【实测】

- **现象**：`#pane-git` 的 computed `animation-name` = **`cs-drawer-in`**（`0.16s`、`ease-out`、`translateX(18px)` + `opacity .55→1`），而不是 `motion.js` 给它挂的 `mo-enter`（260ms、`--mo-out`）。同一元素上两个系统都在写 `animation`。
- **根因**：`ui-kit.css:387` 是 `body.git-open #pane-git { animation: cs-drawer-in .16s ease-out }`，特异性 **(1,2,1)**；`motion.css:500` 的 `.mo-enter` 只有 **(0,1,0)**。**id 级规则赢，与加载顺序无关**。另外 `cs-drawer-in` 用的是字面值 `ease-out` 和 `.16s`，既不读 `--mo-drawer` 也不读 `--mo-3` —— 那个令牌的注释（「app.css 原本手抄 4 遍的大块拖拽式进出」）在抽屉上**名存实亡**。
- **影响面**：抽屉是「从右侧滑出的一大块」，AUDIT §2 给的时间预算是 200–500ms；现在 160ms + 无回弹曲线，比同产品的弹窗（260ms）还快，读起来像「弹出警告框」而不是「一层抽屉推出来」。
- **修复建议**：`assets/motion-drawer.css` 里用**同款 id 特异性 + 后加载**接管：

```css
body.git-open #pane-git { animation: mo-drawer-in var(--mo-3) var(--mo-drawer) both; }
@keyframes mo-drawer-in { from { transform: translateX(24px); opacity: 0; } }
```

同时把 `ui-kit.css:387-389` 的两条**删掉**（净 -3 行，正好把 ui-kit 的 0 余量腾出来，不必上调棘轮）。
验收要能证明「赢的是新的」：实测 `animationName === 'mo-drawer-in'`，且 `animationTimingFunction` = `cubic-bezier(0.32, 0.72, 0, 1)`。

#### S4 · 六个分隔条仍在悬停改 `width`，与已收编的五个走两套实现【实测】

- **现象**：
  - 已收编：`#split-v / #split-h / #split-v2 / .hsplit / #edit-split-v`（motion.css:424-438）
  - 未收编：`#bp-split-v / #lg-split-v / #cg-split-v`（app.css:278-282）、`#bp-inner-split`（:299-305）、`.reading-html-split`（:1177）、`.editor-group-divider`（:2074-2075）、`#remote-resizer`（:2515）、`#remote-resizer-y`（:2518）
  - 实测：`#bp-split-v::after` 的 `transition-property` = `background, width`，`transition-duration` = `0.15s, 0.15s`；hover 时 `width: 1px → 2px`。
- **根因**：这 6 处是「1px 绝对定位伪元素」，宽度变化**不会推动兄弟节点**（所以不是布局抖动 —— 这一点要纠正：它的问题不是 reflow），真正的问题是：① 1px→2px 在 HiDPI 上是**整像素跳变**（浏览器不给它抗锯齿过渡），看起来像线「闪粗」而不是「长出来」；② 全站 11 条同类控件里 5 条只过渡颜色/阴影、6 条用 `width`，同一手势两种节奏；③ `.15s` 是令牌表外的散值。
- **影响面**：工作台右侧三块（积木 / 逻辑图 / 图谱）、阅读分栏、远程面板 —— 都是每天要拖的地方，抓不抓得住直接影响「这软件跟不跟手」。
- **修复建议**：新增 `assets/motion-split.css`，把这 6 组的线宽变化改成只过渡颜色/阴影（几何一行不动）。

```css
/* 以 #bp-split-v 为例：几何沿用 app.css:278-282，只把"变粗"去掉 */
#bp-split-v::after, #lg-split-v::after, #cg-split-v::after,
#bp-inner-split::after, .reading-html-split::after,
.editor-group-divider::after, #remote-resizer::after, #remote-resizer-y::after {
  transition: background-color var(--mo-1) var(--mo-out),
              box-shadow var(--mo-1) var(--mo-out);
}
```

  并在 `app.css` 对应位置删掉 hover 里的 `width:2px` / `height:2px`（保留 `background: var(--accent)`）。
  ⚠️ 那条 1px 线与 `transform: translateX(-50%)` 同属性 —— 本计划选择**只过渡颜色**这一更小改动（AUDIT：拖拽锚点优先保证「抓得住」，不追求形变）。

#### S5 · 文档主题内部：`transition: all .3s` 与「宽度生长」两种反模式并存【读码】

- **现象**（逐行原文）：
  - `doc-theme.css:193` `.md-doc blockquote { transition: all .3s ease }`，hover 时 `transform: scale(1.01)`
  - `doc-theme.css:200` `blockquote::before { transition: all .3s var(--doc-ease-back) }`（引号从 30° 转回 0°）
  - `doc-theme.css:219` `.md-doc a { transition: all .3s ease }`
  - `doc-theme.css:131` `h1::after { transition: width .3s …, box-shadow .3s ease }`，hover 把 `width: 40px → 100%`
- **根因**：`transition: all` 会把 `border-color/background/box-shadow/filter/color` 全部拉上（AUDIT §5：always a finding）；`.3s` 是 UI 时长上限的边缘（AUDIT §2：UI 一律 < 300ms）。同一文件的 h2 已经被改造过（`doc-theme.css:178-184`：`transform: scaleY/scale(2,1.83)` + `--mo-2` + 40ms 错峰），**h1 与引用块是同一轮遗漏的**。
- **影响面**：阅读区 / 知识库正文。这是「读」的页面，任何 300ms 的迟到感都会被放大；`transition: all` 还会和皮肤主题的 `border/background` 切换互相拖。
- **修复建议**：1:1 原地替换（不动棘轮余量）：
  - `blockquote`：`transition: border-color var(--mo-2) var(--mo-out), background-color var(--mo-2) var(--mo-out), box-shadow var(--mo-2) var(--mo-out), transform var(--mo-2) var(--mo-out);`
  - `blockquote::before`：`transition: transform var(--mo-2) var(--mo-back), color var(--mo-2) var(--mo-out), text-shadow var(--mo-2) var(--mo-out);`（引号回正是人主动悬停 ⇒ 允许 `--mo-back`）
  - `a`：`transition: color var(--mo-1) var(--mo-out);`
  - `h1::after`：**不能用 scaleX**（目标是 100% 宽度，依赖容器，无法用固定 scale 表达）⇒ 用 `clip-path`：

```css
.md-doc h1::after { width: 100%; clip-path: inset(0 50% 0 50%); transition: clip-path var(--mo-3) var(--mo-out), box-shadow var(--mo-2) var(--mo-out); }
.md-doc h1:hover::after { clip-path: inset(0 0 0 0); }
```

- **特异性**：`.md-doc h1::after` = (0,1,1)，与现规则同档 ⇒ 直接改原行即可（不需要新选择器）。**不要**动 `::selection`（Crepe reset 会压它，这是已知坑）。

### 2.2 交互感（反馈、可打断、跟手）

#### I1 · 拖拽中的面板是「硬跳」而不是「抓住」【实测】

- **现象**：给 `#ai-panel` 加 `.dragging` 后，computed `opacity` 立刻 0.42、`filter` 立刻 `saturate(0.7)`，而 `transition-duration` = `0s`、`transition-property` = `all`（初始值）。
- **根因**：`app.css:2969` `.stack-pane.dragging, #ai-panel.dragging { opacity:.42; filter:saturate(.7); }` —— 全文件唯一写这两条状态的地方，没有任何过渡声明。
- **影响面**：栈面板（大纲/输出/AI/标签页）与 AI 面板的重排拖拽。抓起来的瞬间整块**闪一下**，正是「跟不跟手」最敏感的一帧；松手时又闪回来。
- **修复建议**：给**基态**加过渡（过渡必须挂在基态上，否则加类瞬间没有 before-change style）：

```css
.stack-pane, #ai-panel {
  transition: opacity var(--mo-1) var(--mo-out), filter var(--mo-1) var(--mo-out);
}
```

`.stack-pane` 与 `#ai-panel` 已在 `app.css:2967` 有 `transition: border-color .12s, background .12s`（(0,1,0)）⇒ 新文件同选择器 + 后加载即可覆盖，**不要**加 `!important`。
取值理由：120ms（`--mo-1`）—— 拖拽反馈属于「即时反馈」档，260ms 会让「抓起来」慢半拍；用 `--mo-out` 而不是 `--mo-back`（拖拽中回弹会跟着鼠标抖，`motion.css:247` 已写过同一条判断）。

#### I2 · 四个 .hidden 浮层零入场，而形状已经写明「从哪来」【实测】

- **现象**：`#code-actions-pop`、`#definition-peek`、`#lsp-problems`、`#xmind-shortcuts` 的 computed `transition-duration` 全为 `0s`、`animation-name` 全为 `none`；它们的显示方式是 `remove('hidden')` / `display:none→flex`。
- **根因**：`motion.css:387-414` 只收编了 7 种 dialog（.open / .on / remove .hidden / inline display 四种显示方式），这四个**不在名单里**。`#lsp-problems`（app.css:2013 附近）与 `#code-actions-pop` 都挂在编辑器上，出现位置固定，缺的只是「怎么出现」。
- **影响面**：代码操作（⌘.）、F8 诊断列表、F12 定义预览、XMind 快捷键面板 —— 都是**偶发**动作（不是每键），正是 AUDIT §2 允许标准入场的那一档。
- **修复建议**：新增 `assets/motion-popover.css`，用 `@starting-style`（与 `motion.css:341/401` 同批约定，配 `@supports (transition-behavior: allow-discrete)` 探针）：

```css
@supports (transition-behavior: allow-discrete) {
  :is(#code-actions-pop, #lsp-problems, #definition-peek, #xmind-shortcuts) {
    opacity: 1; transform: none;
    transform-origin: top right;
    transition: opacity var(--mo-1) var(--mo-out), transform var(--mo-1) var(--mo-out);
  }
  @starting-style {
    :is(#code-actions-pop:not([hidden]), #lsp-problems:not([hidden]),
        #definition-peek:not([hidden]), #xmind-shortcuts:not([hidden])) {
      opacity: 0; transform: translateY(-4px) scale(.98);
    }
  }
}
```

取值：125–200ms 是 AUDIT 给 "tooltips, small popovers" 的预算 → 用 `--mo-1`(120ms) 落在下沿；`scale(.98)` 不是 `scale(0)`（AUDIT §3 硬规则）；原点 `top right` 因为它们都贴着右上角触发器。
**不要给 `#comp-pop`（LSP 补全）与 `#sym-modal-box` 加**：前者每次按键都可能重开（100+/天），后者见 S2。

#### I3 · 保存指示器上有一个 2.2s 无限脉动的绿点【实测】

- **现象**：`#autosave-hint::before` 的 computed `animation-name: asave-pulse`、`duration: 2.2s`、`iteration-count: infinite`；`.dirty` 状态下同一元素又换成 `saveModePulse 1.5s infinite`。
- **根因**：`app.css:2165-2166`（绿点，2.2s）与 `:3509-3510`（`.dirty`，1.5s）两处独立定义。二者都是「常驻元素上的永动」：AUDIT §1 —— 一个每天被看到上千次的小圆点，任何持续运动都不是「有意义」，只是「有一个东西在动」。
- **影响面**：编辑器顶栏。它抢注意力（读代码时周边视野里一直有东西闪），并与真实语义冲突：这颗绿点的意思是「自动保存已开启」，不是「正在录制」。
- **修复建议**：见 §4 P-06（含产品决策点 A/B）。

#### I4 · 可点行里只有 4 类有按下反馈，另外 5 类没有【读码】

- **现象**：有按下反馈的：`button`（motion.css:86-89）、`.tchip`（:196-198）、`#list .item/.fnode`（:233-238）。
  没有的：`.office-row`、`.reading-project`/`.reading-row`、`.draw-row`、`.lw-hotrow`、`.symr`、`.ctx-item`。
  实测 `.office-row` 的 transition 只有 `background, box-shadow, border-color`（0.14s），**不含 transform**。
- **根因**：`motion.css` 的收编是「按普查清单逐个列」（文件里到处是「下面每一个都是从普查清单里抄的真实选择器」这类注释）。清单停在侧栏/标签/toolbar，**办公行、阅读行、绘图行、生活页热榜行、palette 结果行**当时没被列进去。
- **影响面**：这些行是各自页面的主目标 —— 用户在这些页面上永远缺「我按下去了」那一下。它们也**不该**用 `scale(.97)`（行高 28–31px 会抖），应沿用树行那套「底色压深为主 + 1% 收紧为辅」。
- **修复建议**：新增 `assets/motion-row-press.css`：

```css
.office-row, .reading-project, #reading-list .reading-row, .draw-row, .lw-hotrow,
.symr, .ctx-item {
  transition: background-color var(--mo-1) var(--mo-out),
              color var(--mo-1) var(--mo-out),
              box-shadow var(--mo-2) var(--mo-out),
              transform var(--mo-1) var(--mo-out);
}
.office-row:active, .reading-project:active, #reading-list .reading-row:active,
.draw-row:active, .lw-hotrow:active { transform: scale(.99); }
```

**`.symr` 与 `.ctx-item` 只给过渡、不给缩放**：它们是键盘 ↑↓ 移动的当前项，缩放会让高亮框跳（AUDIT §1 的 100+/天档）。

#### I5 · `.reading-folder:hover` 仍在改 `max-width`（承接上轮 006 的残留）【读码+实测】

- **现象**：`app.css:3812` `.reading-folder:hover > .reading-row-actions, .reading-folder:focus-within > .reading-row-actions { max-width: 140px; }`
- **根因**：动作条曾用 `max-width` 从 0 → 140px 揭示（布局属性）。但【实测】当前 `.reading-row-actions` 的 computed 是 `position: absolute`、`transition-property: opacity, transform, visibility` ⇒ **已经有一份浮层化实现**，`:3812` 那条 hover 是**遗留的死规则**（对绝对定位元素设 max-width 不产生揭示效果）。
- **影响面**：真正影响为 0，但它是「同一组件两套实现」的证据，且占着 app.css 的 1 行额度。
- **修复建议**：删掉 `app.css:3812` 那一行。**执行者第一步必须实测** `position` 是否已为 absolute；若不是，改用 `opacity + translateX` 方案（照抄 `motion-lw.css:283`）。

#### I6 · 首屏 stagger 到第 8 个就断，后 4 个硬出现【实测】

- **现象**：`#welcome-vscode`、`#welcome-system`、`#welcome-history`、`#welcome-manual` 的 `animation-name` = `none`、`animation-delay` = `0s`；前 16 个（两组各 8 个）各有 0→280ms 的 40ms 递进。
- **根因**：`app.css:3785` `#workspace-welcome:not([hidden]) .welcome-actions > button:nth-child(-n+8)` 把范围钉死在 8 —— 但 `.welcome-actions.more` 有 **12** 个按钮【实测 moreCount: 12 / topCount: 8】。
- **影响面**：首屏是唯一「允许花欢愉预算」的地方（AUDIT §8）。现在它在最后四分之一处**突然停止**，观感是「动画卡住了」而不是「入场结束」，比完全没有 stagger 更糟。
- **修复建议**：`:nth-child(-n+8)` 扩到 `-n+12`，步长 40ms → **32ms**（与 `motion.js:66` 的 `STAGGER_STEP = 32` 对齐 —— 那里有实测论证：32ms 才能读出先后）。12 项 × 32ms ⇒ 末项 352ms 起、612ms 止。

### 2.3 灵动感（节奏、连贯、收尾）

#### D1 · `--mo-drawer` 只有 3 处使用者，且都不是「大块位移」【读码】

- **现象**：`--mo-drawer` 在 `app.css` 只被 3 处引用（`:3297`、`:3504`、`:3606`），全部是按钮的 `transform` 曲线；**真正的大块进出（抽屉）没有用它**。
- **根因**：令牌建立时（`motion.css:49` 注释「app.css 原本手抄 4 遍的大块拖拽式进出」）目标是抽屉，落地时抽屉那条被 `ui-kit.css` 的 id 规则抢走了（S3）。
- **影响面**：曲线语义名存实亡；未来任何人想给「大块位移」找曲线，会引用一个**没有任何大块位移在用**的令牌。
- **修复建议**：并入 P-04（不单独开计划）。验收加一条：`grep -c 'var(--mo-drawer)'` ≥ 4 且至少 1 处在 `#pane-git` 上。

#### D2 · 三个「无限但周期不同」的循环并存【实测+读码】

- **现象**：`.typing i` = `ai-typing 1.1s infinite`（app.css:165）、`#autosave-hint.dirty` = `saveModePulse 1.5s`（:3509）、`#autosave-hint::before` = `asave-pulse 2.2s`（:2165）。三者都是 `ease-in-out`、都无限、都在**同一屏幕区域**（编辑器顶栏 + AI 面板）。
- **根因**：三次独立引入，没有统一「等待/进行中」这一档的节奏。AUDIT §7：五个手打曲线 = 一个 consolidate finding；这里是三个手打**周期**。
- **影响面**：同时出现两个脉动（AI 正在回 + 未保存）时，两个错的周期会让界面像**失拍**。
- **修复建议**：统一「进行中」为 **1.2s**、`ease-in-out`、`infinite alternate`，复用与 `app.css:2391` `env-pulse` 同义的单一键帧 `mo-busy`（`to { opacity: .35 }`）。`.typing i` 保留三点的 `translateY(-3px)` 位移（那是「AI 正在输出」的主信号），只统一周期。

#### D3 · 视图切换没有方向感（阅读/绘图/Office 都从下方淡入）【推断】

- **现象**：`motion.js:39-47` 的 `PANEL_IDS` 给 11 个容器统一挂 `.mo-enter`（`translateY(4px)` + 淡入）；侧栏类面板（`pane-reading`/`pane-office`/`pane-draw`）与底部面板（`output`/`outline-panel`）**用同一个方向**。
- **根因**：`mo-enter` 是单一 keyframes（`motion.css:478-481`），没有方向参数；`motion.js` 也没有按面板位置分流。
- **影响面**：AUDIT §8「spatially-connected UI with no motion explaining where it came from」。侧栏面板从**下方**淡入，等于告诉眼睛「它从底下来」—— 而它其实在左边。
- **修复建议**：只在 `motion.js` 里按容器分流（加 `data-mo-side="left"`），CSS 侧新增一条 `mo-enter-left`（`translateX(-4px)`）。收益中等、成本中等 ⇒ P2，且**必须先验证 4px 横向是否可感**（见 P-12 的预期失败模式）。

#### D4 · `--mo-4`（400ms）几乎没有使用者【读码·已知取舍】

- **现象**：`--mo-4` 的注释是「大块进出：脉冲、一次性提示」，但实际引用极少；`.mo-flash` 用的是硬编码 `640ms`（`motion.css:511`，注释解释了为什么不换成 `--mo-4`：时长归 `motion.js` 的摘类定时器管）。
- **判定**：**已知并有论证的取舍，不作为修复项**。只建议在 `motion.css:44` 的注释里补一句「目前无人使用；一次性的 640ms 脉冲由 motion.js 定时器定义，别改这里」（文档级，P2）。

#### D5 · 空状态在低频页面缺入场，在高频列表**不该有**【实测+读码】

- **现象**：`.empty-state`（`app.css:2331`）纯静态；`app.js:1233/1238` 用 `innerHTML` 直接塞。主列表 `#list` 每 1.5–4s 由轮询整块重建（`motion.css` 文件头与 `motion.js:38` 都写过）。
- **根因**：同一个类被两种语义共用（「这个列表暂时空了」vs「首次加载完还没有内容」）。
- **影响面**：若直接在 `.empty-state` 上加入场，它会**跟着每次轮询重播** —— 正是铁律 ② 禁止的。
- **修复建议**：**主列表不加**。只给低频页面（阅读/Office/绘图）在**首次** 0→空时播一次，复用 `motion.js` 的 `flushBatch` 判据 + `mo-enter-fade` 键帧（零新增动画）。

#### D6 · Monaco / xterm / PTY 区域：一条动画都没有（**正确**）【实测+读码】

- **现象**：`motion-monaco.css`（60 行、22 处令牌）只过渡 `border-color/background/caret` 一类属性；`xterm.css` 0 条 transition；`#code-wrap` 被显式移出 `PANEL_IDS`。
- **判定**：**这是本仓最正确的一处克制**，不要动。写进文档只为对照，防后人「补全」。

---

## 3. 优先级矩阵（收益 × 成本，12 条）

排序依据 = 影响面 ÷ 改动成本。**P0 = 现在就肉眼可见的不跟手/不自洽**；**P1 = 明显能感觉到，但需要取舍**；**P2 = 打磨**。

| # | 条目 | 档 | 收益 | 成本 | 依赖 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 | I1 拖拽中面板加 120ms 过渡 | **P0** | 高（每天几十次的实际手势） | 极低（新文件 2 行） | 无 | 纯加声明，无删除风险 |
| P-02 | S4 六个分隔条收编（只过渡颜色） | **P0** | 中高（11 条同类控件统一） | 低（新文件 + app.css 删 6 处） | 无 | 棘轮：app.css 净 -6 行 |
| P-03 | S2 命令面板遮罩 120ms 淡入 | **P0** | 高（最高频浮层，整屏瞬变） | 低（新文件 3 行） | 无 | 面板本体**不动** |
| P-04 | S3 抽屉曲线接管 + 删 `cs-drawer-in` | **P1** | 中高（唯一「大块进出」） | 中（ui-kit 删 3 行 + 新文件） | 与 P-05 同批 | 【实测】现被 id 规则抢走 |
| P-05 | S1 elevation 三档令牌（先落 3 个面） | **P1** | 高（层级语言，影响全站浮层） | 中高（新文件 + 3 处覆盖要正确特异性） | 无 | 不做 50 处全量重写 |
| P-06 | I3 永动绿点降级 + `.dirty` 改单次脉冲 | **P1** | 中（去掉常驻干扰） | 低（改 2 行 + 决策） | 决策项 | 二选一方案见 P-06 |
| P-07 | I2 四个浮层补入场 | **P1** | 中（偶发但每天；空间连续性） | 低（新文件 15 行） | 无 | 明确排除 `#comp-pop` |
| P-08 | S5 doc-theme 去 `transition: all` + h1 clip-path | **P1** | 中（阅读区是主场景） | 中（4 处原地改） | 无 | 棘轮：1:1 原地替换 |
| P-09 | I4 办公/阅读/绘图/热榜行补按下反馈 | **P2** | 中（7 类可点行） | 低（新文件 12 行） | 无 | `.symr/.ctx-item` 只过渡不缩放 |
| P-10 | I6 首屏 stagger 扩到 12 项 + 步长 32ms | **P2** | 中（首屏是唯一欢愉预算） | 中（app.css 零余量，要压行） | 需 P-02/P-06 腾行 | 【实测】末 4 个 `none` |
| P-11 | D2 三个循环周期统一 1.2s | **P2** | 中低（失拍感） | 低（新文件 + 改 2 行） | 与 P-06 同批 | 复用 `mo-busy` |
| P-12 | D3 侧栏面板改为横向入场 | **P2** | 中（空间连贯） | 中高（动 `motion.js`） | 需先 feel-check | 【推断】先验证再铺开 |

**为什么 S1（层级）不是 P0**：它的收益是「整个产品的立体语言」，但一次改 50 处阴影是灾难；拆成「3 个面 + 令牌」后成本才可控，作为 P1 更诚实。

**建议执行顺序**：P-01 → P-02 → P-03（三条互不冲突，可并行派单）→ P-04 → P-05 → P-06 → P-07 → P-08 → P-09 → P-10 → P-11 → P-12。
前三条是「零风险 + 立竿见影」，建议先做一轮回归看手感，再决定 P-04/P-05 的投入。

---

## 4. 可直接派单的执行计划

> 每条都能独立派给**没有本文件上下文**的执行者。五要素齐：目标 / 改动边界 / 步骤 / 验收（可测量）/ 依赖。
> **所有 CSS 新增一律写新文件**（棘轮余量全为 0，见 §0.3），并插在 `index.html:144` 的 `editor-chrome.css` 之后。
> 每条改完必须跑：

```bash
cd masscode-runner
node tests/architecture.js     # 棘轮：只准下降
node tests/undefined-refs.js
```

### P-01 · 拖拽中的面板不再硬跳（120ms 过渡）

- **目标**：给栈面板 / AI 面板的拖拽态补 120ms 的 `opacity` + `filter` 过渡，使「抓起来」与「松手」都有过程。
- **改动边界**：
  - 新增 `assets/motion-drag.css`（唯一新增文件）
  - `index.html` 加一行 `<link rel="stylesheet" href="/assets/motion-drag.css?v=20261031a">`（紧跟 `editor-chrome.css` 那行之后）
  - **不许**改 `app.css:2967-2976` 的任何一行（那是布局/描边定义）
- **步骤**：
  1. 新建 `assets/motion-drag.css`：

```css
/* 拖拽态：抓起来与放下都要有过程。
   过渡必须挂在**基态**（.stack-pane / #ai-panel）上 —— 挂在 .dragging 上时，
   加类那一帧没有 before-change style，过渡不会启动。
   120ms（--mo-1）是"即时反馈"档；曲线用 --mo-out 而不是 --mo-back：
   拖拽中的面板若回弹，会跟着鼠标一起抖（motion.css:247 同一条判断）。 */
.stack-pane, #ai-panel {
  transition: opacity var(--mo-1) var(--mo-out), filter var(--mo-1) var(--mo-out);
}
```

  2. 在 `index.html` 的 `editor-chrome.css` 之后插入 link。
- **验收判据**：
  - 机制：`node tests/architecture.js` 通过（本计划不新增受棘轮文件的代码行）。
  - 实测：给 `#ai-panel` 加 `.dragging` 后 `getComputedStyle(el).transitionDuration` 必须**包含 `0.12s`**；同一帧读 `opacity` 应接近 `1`（过渡起点），120ms 后读为 `0.42`；去掉类后 120ms 内回到 `1`。
  - Feel check（DevTools Animations 面板 10% 速度）：抓住面板拖动，整块应「淡下去」而不是「闪一下」；松手不该跳变。
  - reduced-motion：开启后过渡应为 `1e-05s`（由 `app.css:3823` 全局兜底保证，**不要**在本文件再写一份）。
- **依赖**：无。

### P-02 · 六个分隔条收编到「只过渡颜色」

- **目标**：`#bp-split-v/#lg-split-v/#cg-split-v/#bp-inner-split/.reading-html-split/.editor-group-divider/#remote-resizer/#remote-resizer-y` 悬停时不再改 `width`/`height`，与 `motion.css:424-438` 已收编的 5 个节奏一致。
- **改动边界**：
  - 新增 `assets/motion-split.css`
  - `app.css` **只删不增**：:280/:301 的 `transition: background .15s, width .15s` 去掉 `width` 子句；:282/:305/:1177/:2075/:2517/:2519 的 hover `width:2px`/`height:2px` 删掉
  - **不许**动这些元素的 `width: 9px` 命中区、`cursor`、`::before` 抓手点
- **步骤**：
  1. 先在浏览器里确认这 6 组的真实 hover 规则行号（本文行号以 304ee9b 为准，漂移则以选择器为准）。
  2. 新建 `assets/motion-split.css`：

```css
/* 分隔条：拖拽锚点的反馈只允许颜色/阴影（motion.css §8 已对 5 个同类控件如此处理）。
   这里把剩下 6 组的"线变粗"去掉，只保留提亮 —— 1px 线在 HiDPI 上 1→2px 是整像素跳变，
   看起来是"闪一下"而不是"亮起来"。几何、命中区.width(9px)、cursor 全部不动。 */
:is(#bp-split-v, #lg-split-v, #cg-split-v, #bp-inner-split,
    .reading-html-split, .editor-group-divider)::after,
:is(#remote-resizer, #remote-resizer-y)::after {
  transition: background-color var(--mo-1) var(--mo-out),
              box-shadow var(--mo-1) var(--mo-out);
}
```

  3. 删除 `app.css` 里这 6 组 hover 规则中的 `width:2px` / `height:2px`（保留 `background: var(--accent)`）。
- **验收判据**：
  - 实测：hover 前后 `getComputedStyle(el,'::after').width` **恒为 `1px`**（不再变化）；`backgroundColor` 从 `var(--border)` 变为 `var(--accent)`；`transitionProperty` **不含 `width`**。
  - 命中区不变：`el.getBoundingClientRect().width` 恒为 `9px`。
  - 棘轮：`node tests/architecture.js` 通过且 `app.css` 代码行数**下降 ≥ 6 行**。
- **依赖**：无。可与 P-01、P-03 并行。

### P-03 · 命令面板：遮罩 120ms 淡入，面板保持瞬时

- **目标**：⌘K 打开时不再「整屏一帧变暗」，改为 120ms 淡入；**面板本体与结果列表不加任何动画**。
- **改动边界**：
  - 新增 `assets/motion-palette.css`
  - **不许**改 `app.css:2628-2651`、`:3042-3043`、`:3249`、`:3387`（4 个主题块的颜色）
  - **不许**给 `#sym-modal-box`、`.symr`、`#sym-modal-res` 加动画
- **步骤**：
  1. 新建 `assets/motion-palette.css`：

```css
/* ⌘K 是每天几十次的动作（AUDIT §1：100+/天 → 不加动画）。
   唯一例外是遮罩：它一帧铺满整个视口，属于要避免的 jarring change。
   120ms 只覆盖遮罩，面板与结果在第一帧就已完全可读（不做位移、不做缩放）。
   不用 background-color 过渡的原因：遮罩颜色在 4 个主题块里各有一份
   （app.css:2628/:3042/:3249/:3387），逐条镜像会在皮肤层留 4 份副本。 */
#sym-modal.open { animation: mo-overlay-in 120ms linear both; }
@keyframes mo-overlay-in { from { opacity: 0; } }
```

  2. `index.html` 追加 link（排在 `editor-chrome.css` 之后）。
- **验收判据**：
  - 实测：按 ⌘K 后以 40ms 间隔采 6 帧，`#sym-modal` 的 `opacity` 必须出现**至少一个中间值**（0 < v < 1）；把这 6 个值贴进 PR。**当前基线是 6 帧全 1** —— 这条判据就是为了区分。
  - 面板无动画：`#sym-modal-box` 的 `animation-name` 必须为 `none`、`transition-duration` 为 `0s`。
  - 首帧可读：打开后**第 1 帧**（不等 timeout）`#sym-modal-input` 应已可聚焦、`#sym-modal-res` 的 `getBoundingClientRect().height > 0`。
  - reduced-motion：开启后无动画（全局兜底保证）。
  - ⚠️ **必须真机复核一次**：120ms 整屏淡入会不会让「立即」变得迟疑。若迟疑，退化为 `80ms`，或只过渡 `backdrop-filter`（需另测掉帧）。
- **依赖**：无。**这条最容易被执行者写错**：不要「顺手」给面板加 `scale(.98)`。

### P-04 · 抽屉接管 `--mo-drawer` 曲线，删掉 ui-kit 的抢权规则

- **目标**：git 抽屉入场从「160ms `ease-out` 字面值」改回「260ms + `--mo-drawer`」，并让 `motion.css` 的 `.mo-enter` 契约在 `#pane-git` 上真正生效。
- **改动边界**：
  - 新增 `assets/motion-drawer.css`
  - `ui-kit.css:387-389` **删除**（`animation: cs-drawer-in` 与 `@keyframes cs-drawer-in`，净 -3 行）
  - **不许**动 `#pane-git` 的定位、宽度、内边距
- **步骤**：
  1. 新建 `assets/motion-drawer.css`：

```css
/* 抽屉：ui-kit 原本用 body.git-open #pane-git (1,2,1) 抢走了 motion.js 的 .mo-enter (0,1,0)。
   这里用同款特异性 + 后加载接管，曲线回到 --mo-drawer、时长回到 --mo-3。
   位移 24px：AUDIT §3 的"从触发方向进"；18px 在 400px 宽的抽屉上读不出方向。 */
body.git-open #pane-git {
  animation: mo-drawer-in var(--mo-3) var(--mo-drawer) both;
}
@keyframes mo-drawer-in {
  from { transform: translateX(24px); opacity: 0; }
  to   { transform: none; opacity: 1; }
}
```

  2. 删除 `ui-kit.css` 的 `body.git-open #pane-git { animation: ... }` 与 `@keyframes cs-drawer-in` 两处。
- **验收判据**：
  - 实测：打开 git 抽屉后 `animationName === 'mo-drawer-in'`、`animationTimingFunction === 'cubic-bezier(0.32, 0.72, 0, 1)'`、`animationDuration === '0.26s'`。**当前基线是 `cs-drawer-in` / `ease-out` / `0.16s`** —— 执行前后各贴一次。
  - 棘轮：`ui-kit.css` 代码行数下降 3 行（785 → 782），测试通过。
  - `grep -c 'var(--mo-drawer)'` 在 `assets/` 下 ≥ 4（D1 的验收）。
  - Feel check：10% 慢放开抽屉，应看到「先快后缓」的一次性滑入 + 同时淡入；不应看到右边缘先出现再左移的错位。
- **依赖**：与 P-05 共享 `#pane-git` 落点，建议同批（先 P-04 后 P-05）。

### P-05 · 建立 elevation 三档令牌，先落 3 个面

- **目标**：新增 `--mo-e1/e2/e3`，并把**三个浮层代表**切换过去：命令面板（e3）、右键菜单（e2）、git 抽屉（e3）。
- **改动边界**：
  - 新增 `assets/motion-depth.css`（`:root` 令牌 + 3 条覆盖）
  - **不许**动其余 47 处 box-shadow（全量重写 = 不可评审的 diff）
  - **不许**改任何布局/圆角/边框
- **步骤**：
  1. 新建文件：

```css
:root {
  /* 立体感三档：y-offset / blur / alpha 三轴同时单调，可机器比对（见验收）。
     取值锚定实测普查里最常出现的三组（0 8px 24px .42 / 0 12px 40px .42 /
     0 18px 50px .34），只加了负扩散，让阴影有"接触面"而不是一团雾。 */
  --mo-e1: 0 2px 6px -2px rgb(0 0 0 / .45);
  --mo-e2: 0 8px 24px -6px rgb(0 0 0 / .55);
  --mo-e3: 0 18px 50px -12px rgb(0 0 0 / .62);
}
/* ① 命令面板：模态层 */
#sym-modal-box { box-shadow: var(--mo-e3); }
/* ② 右键菜单：浮层。主题块里有 3 条同名规则，带 html[data-theme] 打平 */
html[data-theme] .ctx-menu { box-shadow: var(--mo-e2); }
/* ③ git 抽屉：模态层（从右侧覆盖内容）；保留原有的向左投影，再叠 e3 */
body.git-open #pane-git { box-shadow: -14px 0 36px rgb(0 0 0 / .48), var(--mo-e3); }
```

  2. 若 `.ctx-menu` 的既有规则出现 `!important`，**停下报告**（本仓约定不用 `!important` 抢外观）。
- **验收判据**：
  - 三档拉开（可机器判）：读 `getComputedStyle(document.documentElement).getPropertyValue('--mo-e1/2/3')`，解析 y-offset / blur / alpha，要求三个序列**严格单调**且相邻比 ≥ 2（2→8→18；6→24→50）。
  - 覆盖面：`#sym-modal-box` 的 computed box-shadow 等于 `--mo-e3` 的展开值；`.ctx-menu` 等于 `--mo-e2`。
  - 视觉：同屏同时打开右键菜单与命令面板，**必须能一眼看出面板更高**（截图贴 PR）。
  - 棘轮：新文件不受约束，`node tests/architecture.js` 必须仍通过。
- **依赖**：P-04（共用 `#pane-git` 落点）。

### P-06 · 保存指示器：把永动降成一次性脉冲（含一个产品决策点）

- **目标**：去掉顶栏绿点的无限脉动，保留「有未保存修改」时的强调。
- **决策点（执行者必须先问，只有两个合法答案）**：
  - **A（推荐）**：绿点静态（表示「自动保存开启」），只有 `.dirty` 时脉动。
  - **B**：绿点保留脉动，但改成 1.2s 且与 `.dirty` 共用 `mo-busy` 键帧（D2 的做法）。
  - 无法确认时**默认 A**，并在 PR 里写明选了 A。
- **改动边界**：`app.css:2165`（`animation: asave-pulse 2.2s infinite`）、`:2166`（`@keyframes asave-pulse`）、`:3509-3510`（`.dirty` + `saveModePulse`）。
- **步骤（方案 A）**：
  1. `app.css:2165`：删掉 `; animation: asave-pulse 2.2s infinite`（净 -1 行）。
  2. `app.css:2166`：删掉 `@keyframes asave-pulse`（净 -1 行）。
  3. `.dirty`：`animation: saveModePulse 1.5s ease-in-out infinite` → `animation: mo-status-glow 640ms var(--mo-out) 1`（复用 `motion.css:495-499` 的既有脉冲，零新增键帧）。
- **验收判据**：
  - 实测：`#autosave-hint::before` 的 `animationName` 必须为 `none`；`.dirty` 状态下 `animationIterationCount === '1'`。
  - 无新增键帧：`grep -c '@keyframes' assets/app.css` 必须比改前**少 1**（记录改前后数字）。
  - reduced-motion 下外观不变（静态点）。
  - 棘轮：`app.css` 代码行数下降 2 行。
- **依赖**：与 P-11 同批（周期统一）。

### P-07 · 四个 .hidden 浮层补 120ms 入场（明确排除补全菜单）

- **目标**：`#code-actions-pop`、`#definition-peek`、`#lsp-problems`、`#xmind-shortcuts` 出现时有 120ms 的「从触发器方向就位」。
- **改动边界**：新增 `assets/motion-popover.css`；**不许**碰 `#comp-pop`、`#sym-modal*`、`#signature-help`（都是每键触发）。
- **步骤**：按 §2.2 I2 的代码块写入；原点 `top right`（四者都贴右上）；`@supports (transition-behavior: allow-discrete)` 包裹，保证不支持时静默退化（与 `motion.css:341` 同手法）。
- **验收判据**：
  - 实测：打开 `#lsp-problems` 后 40ms 内读到 `opacity` 的中间值；`transitionProperty` 含 `opacity, transform`。
  - 反向判据：`#comp-pop` 的 `transition-duration` 必须**仍为 `0s`**（防误伤）。
  - reduced-motion：位移消失、颜色保留。
- **依赖**：无。

### P-08 · 文档主题：去 `transition: all`，h1 改 `clip-path`

- **目标**：`doc-theme.css` 里 4 处反模式收敛到令牌；h1 下划线用 `clip-path` 而不是 `width`。
- **改动边界**：`doc-theme.css` 的 :131、:193、:200、:219 四行**原地改**（1:1 替换，不加行）；**不许**动 `:178-190` 的 h2 段（上一轮已收口的范例）。
- **步骤**：按 §2.1 S5 的四条目标声明逐行替换。h1 用 `width:100% + clip-path`（**不要**用 `scaleX`，100% 宽度无法用固定 scale 表达）。
- **验收判据**：
  - 实测：`grep -n 'transition: *all' assets/doc-theme.css` 必须**为 0 命中**（最硬的判据）。
  - 悬停过程：hover `h1` 期间 `getComputedStyle(el,'::after').width` **恒为 `100%`**（不再变化），`clipPath` 从 `inset(0 50% 0 50%)` 插值到 `inset(0 0 0 0)`。
  - 时长：hover 类规则的 `transition-duration` 全部 ≤ 0.26s。
  - 棘轮：`doc-theme.css` 代码行数**不增加**（≤692）。
- **依赖**：无。

### P-09 · 七类可点行补「按下」反馈

- **目标**：`.office-row`、`.reading-project`、`.reading-row`、`.draw-row`、`.lw-hotrow` 有 1% 按下收紧；`.symr`、`.ctx-item` 只补过渡不缩放。
- **改动边界**：新增 `assets/motion-row-press.css`；**不许**改行高/内边距/网格。
- **步骤**：按 §2.2 I4 的代码块写入；`.reading-row` 用 `#reading-list .reading-row` 前缀（压过既有 `#reading-list` 规则）。
- **验收判据**：
  - 实测（每类各一次）：`mousedown` 后 `transform === 'matrix(0.99, 0, 0, 0.99, 0, 0)'`；`mouseup` 后 200ms 内回到 `none`。
  - 反例判据：`.symr`、`.ctx-item` 的 `transform` 在按下前后**都必须为 `none`**。
  - 行高不变：按下前后 `offsetHeight` 相同。
- **依赖**：无。

### P-10 · 首屏 stagger 补到 12 项，步长 32ms

- **目标**：`#workspace-welcome` 的两组按钮全部有递进入场，步长与 `motion.js:66` 的 `STAGGER_STEP=32` 一致。
- **改动边界**：`app.css:3785-3788`（`:nth-child(-n+8)` + 12 条 delay 声明）；**必须同时腾出等量行数**（本计划预计 +4 行，需先删 ≥4 行 —— 与 P-02/P-06 的删除合并，或压掉同段注释）。
- **步骤**：
  1. `:nth-child(-n+8)` → `:nth-child(-n+12)`。
  2. 12 条 `animation-delay` 从 40ms 步长改成 32ms 步长（0/32/64/…/352ms）。
  3. 若腾不出 4 行：**停下报告**，不要上调棘轮。
- **验收判据**：
  - 实测：`Array.from(document.querySelectorAll('.welcome-actions.more > button')).map(b=>getComputedStyle(b).animationDelay)` 必须是 `['0s','0.032s',…,'0.352s']`（12 项，**无 `none`**）；当前基线是第 9–12 项 `animationName: 'none'`。
  - 波次总时长：末项起始 352ms + 260ms 动画 = 612ms ≤ 800ms（AUDIT §7：stagger 必须不阻塞交互）。
  - 棘轮：`app.css` 代码行数 ≤ 4212。
- **依赖**：P-02 / P-06 先落地（提供腾行额度）。

### P-11 · 「进行中」只保留一个周期（1.2s）

- **目标**：`.typing` 三点与 `#autosave-hint.dirty` 共用同一个 `mo-busy` 键帧与 1.2s 周期。
- **改动边界**：新增 `assets/motion-busy.css`；`app.css:165-168`、`:3509-3510` 原地改（1:1）。
- **步骤**：

```css
/* 与 app.css:2391 的 env-pulse 同义（opacity 呼吸），统一成一条：
   同时出现两个不同周期的脉动会读成"失拍"。
   .typing 保留三点位移（那是"AI 正在输出"的主信号），只统一周期。 */
@keyframes mo-busy { to { opacity: .35; } }
.typing i { animation: ai-typing 1.2s ease-in-out infinite; }
html[data-theme] #autosave-hint.dirty { animation: mo-busy 1.2s ease-in-out infinite alternate; }
```

- **验收判据**：
  - 实测：`.typing i` 的 `animationDuration === '1.2s'`；`.dirty` 的 `animationName === 'mo-busy'`、`duration === '1.2s'`、`direction === 'alternate'`。
  - 同屏同相：两者同时出现时截两张间隔 600ms 的图，应同时处于暗/亮。
  - reduced-motion：`animation-duration` 压到 `1e-05s`、iteration 1。
- **依赖**：P-06（同一元素）。

### P-12 · 侧栏面板改为横向入场（先验证再铺开）

- **目标**：`pane-reading`/`pane-office`/`pane-draw`（侧栏类）从**左侧**就位，而不是从下方淡入。
- **改动边界**：`motion.js` 的 `PANEL_IDS`（:39-47）分流 + 新增 `assets/motion-panel-side.css`；**不许**改 `motion.css:478-511` 的既有键帧语义。
- **步骤**：
  1. `motion.js`：给三个侧栏 id 挂 `.mo-enter` 时同时写 `data-mo-side="left"`（约 3 行）。
  2. 新文件：

```css
[data-mo-side="left"].mo-enter { animation-name: mo-enter-left; }
@keyframes mo-enter-left { from { opacity: 0; transform: translateX(-4px); } }
```

  3. **先只对 `pane-reading` 上线**，其余两个保持原样，跑几天手感再决定。
- **验收判据**：
  - 实测：切到阅读面板后 `#pane-reading` 的 `animationName === 'mo-enter-left'`；另外两个仍为 `mo-enter`。
  - Feel check（10% 慢放）：录 3 帧，必须能看出「从左边推进来 4px」；**若看不出差别（很可能），放弃本计划并记录** —— 这是本计划预期的失败模式。
  - 棘轮：`motion.js` 不在棘轮清单内（`app.js` 才是 12,995 行那条），但**改完仍要跑 `tests/architecture.js`**。
- **依赖**：无，但**建议最后做**（收益不确定）。

---

## 5. 刻意不做 / 假阳性 / 上一轮的残余

### 5.1 刻意不做（**不要**把它们写成新计划）

| 项目 | 决定 | 依据 |
| --- | --- | --- |
| 首屏骨架屏 | **不做** | 【实测】FCP 116ms、侧栏 49 行在 296ms 出现、且首次填充已走 `flushBatch` 的 stagger。为 296ms 空白做骨架 = 制造一次闪烁。 |
| `#sym-modal-box` 本体的入场（scale/位移） | **不做** | ⌘K 是 100+/天（AUDIT §1：ever）。只给遮罩（P-03）。 |
| `#comp-pop`（LSP 补全） | **不做** | 每次按键都可能重开；动它就是给打字加延迟。 |
| `#editor-find` 入场 | **不做** | ⌘F 高频；且它一出现就要能直接打字，120ms 淡入会让首次按键落在半透明层上。 |
| `.empty-state`（主列表）入场 | **不做** | 列表每 1.5–4s 重建（铁律 ②）。只在低频面板做（D5）。 |
| 给 `#code-wrap` / Monaco / xterm / PTY 加任何动画 | **不做** | 铁律 ②；`motion.js:43-46` 已有「每次切片段都淡入 = 让用户等 260ms」的实测论证。 |
| 把 `--mo-out` 换成手册的 `cubic-bezier(0.23,1,0.32,1)` | **不做** | 仓库自有曲线已是「强 ease-out」，且 6 个 motion 文件 + doc-theme 别名都挂在它上面；换值 = 全站重新校准。手册规则是「extend repo conventions」。 |
| `--doc-ease-smooth/back` 视为「第二套真源」 | **假阳性，不上报** | 【实测】`doc-theme.css:72-73` 就是 `var(--mo-in-out)` / `var(--mo-back)` 的**别名**；computed 值相同是别名生效，不是重复定义。 |
| 全站 `scale(0)` | **假阳性，0 处** | 【实测】`scale(0)` / `scale(0,` 在 13 个 CSS 文件里 0 命中。 |
| `transition: all` 在 `motion-lw.css:36/59` | **假阳性** | 那是注释里的排查笔记，不是代码（上一轮已澄清）。真正的是 `doc-theme.css:193/200/219`（S5）。 |
| `ease-in` 反模式 | **假阳性，0 处** | 【实测】`ease-in`（排除 `ease-in-out`）在 13 个 CSS 文件里 0 命中。 |

### 5.2 上一轮（`plans/001-014`）的残余，本轮归属

| 上轮残余 | 本轮归属 |
| --- | --- |
| 「面板入场与列表首屏填充的窄口子」（`flushBatch` 的 `start===0 && now>0` 绕过判据） | **仍未处理**，本轮不新开计划：复现要求「面板入场」与「列表 0→N」落在同一帧批次，本轮实测未能构造。若要动，落点 `motion.js:444`，判据「同一帧内 `.mo-enter` 与 `.mo-stagger` 不同时出现在祖先/子孙链上」。 |
| `system-panel.js` 6 处 `style.width` 未收编 | **专项范围外**（本机管家 7 页）。抽查：`motion-sp.css:192-214` 的过渡仍在，注释标明「宽度是就地在已存在节点上更新」—— 未被破坏。 |
| `app.css` 只剩 1 行余量 | **已变为 0 行**（【实测】4212/4212）。本轮所有涉及 app.css 的计划都要求「先腾行」。 |
| 右键菜单贴底时起始位移方向可能反向 4px | **不重开**（上轮已判定「收益 4px ⇒ 暂不值得」，本轮尊重该决策）。 |

### 5.3 排除区的抽查结论（是否被破坏）

| 排除区 | 抽查方式 | 结论 |
| --- | --- | --- |
| 本机管家 7 页（`system-panel.js`） | 读 `motion-sp.css`（103 行、55 处令牌、2 个 reduced-motion 段） | **未被破坏**：`#system-workspace .sp-bar i { transition: width … }` 与注释中的实测依据都在（motion-sp.css:192-214）。已知残留（6 处 `style.width`）属专项。 |
| 备忘录 / 日记编辑器（Crepe + Phycat、大纲） | 读 `motion-lw.css`（169 行、8 节，含 `.lw-eb-drawer` 的浮层化） | **未被破坏**：`motion-lw.css:273-283` 的 `opacity:0 + translateX(-10px)` 入场仍在，且 `:342-363` 的 reduced-motion 段完整。 |

---

## 6. 附录：实测方法与可复现脚本

### 6.1 起隔离实例（**不许碰 4877**）

```bash
cd masscode-runner
CODESCOPE_PORT=4913 nohup node server.js > /tmp/cs4913.log 2>&1 &
sleep 6 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4913/   # 期望 200
# 用完必须收尾：
lsof -ti tcp:4913 | xargs -r kill -9
```

### 6.2 棘轮余量核算（本轮实测）

与 `tests/architecture.js` 的 `codeLines()` 同算法：去空行、去整行 `//` 注释、去 `/* */` 块注释。

| 文件 | 代码行 | 上限 | 余量 |
| --- | --- | --- | --- |
| assets/app.css | 4212 | 4212 | **0** |
| assets/motion.css | 273 | 273 | **0** |
| assets/ui-kit.css | 785 | 785 | **0** |
| assets/doc-theme.css | 692 | 692 | **0** |
| assets/motion-canvas.css | 271 | 271 | **0** |
| assets/motion-lw.css | 169 | 169 | **0** |
| assets/motion-study.css | 163 | 163 | **0** |
| assets/motion-cg.css | 166 | 166 | **0** |
| assets/motion-dbg.css | 136 | 136 | **0** |
| assets/motion-sp.css | 103 | 103 | **0** |
| assets/motion-monaco.css | 60 | 60 | **0** |

### 6.3 关键实测值（照抄，供执行者做前后对比）

| 判据 | 本轮基线值 |
| --- | --- |
| `#sym-modal` 打开 | `display:flex`、`opacity:1`、`transform:none`、`transition-duration:0s`、`backdrop-filter:blur(7px)`；6 帧采样无中间值 |
| `#sym-modal-box` | `transition-duration:0s`、`box-shadow: rgba(0,0,0,0.34) 0 18px 50px` |
| `#pane-git`（`body.git-open`） | `animation-name: cs-drawer-in`、`0.16s`、`ease-out` |
| `#pane-git`（加 `.mo-enter`、无 body 类） | `animation-name: mo-enter`、`0.26s`、`cubic-bezier(0.2,0.8,0.2,1)` |
| `#ai-panel.dragging` | `opacity:0.42`、`filter:saturate(0.7)`、`transition-duration:0s`、`transition-property:all` |
| `#bp-split-v::after` | `transition-property: background, width`、`0.15s, 0.15s`、`width:1px`（hover 2px） |
| `#code-actions-pop` / `#lsp-problems` / `#definition-peek` / `#xmind-shortcuts` | 全部 `transition-duration:0s`、`animation-name:none` |
| `#autosave-hint::before` | `asave-pulse`、`2.2s`、`infinite` |
| `#workspace-welcome` 按钮（20 个） | 前 16 个 `mo-stagger-in` + 0→280ms（40ms 步长）；`#welcome-vscode/system/history/manual` = `none` |
| `#list .item` | `transition: 6 属性 × 0.18s`；按下载荷 `matrix(0.990001,…)` + `oklab(…/0.14)` |
| 全站 `box-shadow`（首页） | **50 个不同值**；浮层类 6 组近似值 |
| 首屏时序 | `FCP 116ms`、`DOMInteractive 226ms`、`load 279ms`、侧栏 49 行 @296ms |
| reduced-motion 生效 | 元素 `transition-duration:1e-05s`；`.welcome-actions button` `animation-name:none`、`iteration:1` |
| `tests/architecture.js` | `91/91 通过`（HEAD 304ee9b，未改动任何文件时） |

### 6.4 复现脚本（无头采数，放 /tmp，不落仓库）

```js
const { chromium } = require('<repo>/node_modules/playwright-core');
const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ headless: true, executablePath: exe, args: ['--disable-gpu'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4913/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// 判据示例：验证 P-03 —— 打开面板后 6 帧里是否有中间值
await page.keyboard.press('Meta+k');
for (let i = 0; i < 6; i++) {
  console.log(await page.evaluate(() => getComputedStyle(document.getElementById('sym-modal')).opacity));
  await page.waitForTimeout(40);
}
await b.close();
```

---

## 7. 一句话结论

这个仓的**主链交互层（树行 / 标签页 / 右键菜单 / 状态提示 / 面板入场 / reduced-motion）已经做到相当高的水位**，真正的欠账只集中在三处：

1. **最高频的那个浮层（⌘K）完全没有过渡**，且 `motion.css` 的弹窗名单里根本没有它；
2. **同一类控件存在两套实现**：11 条分隔条（5 收编 / 6 未收编）、抽屉被 id 规则抢权、`doc-theme` 里 h2 已改造而 h1 仍是宽度生长；
3. **没有层级（elevation）语言**，50 个阴影值各说各话，浮层之间分不出高低。

三者都不需要重写：只要「**新文件 + 正确特异性 + 3～6 处精确定位**」，且**全部能在 0 行棘轮余量的前提下完成**（靠删除旧规则腾行）。
