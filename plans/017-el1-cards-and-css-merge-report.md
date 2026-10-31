# 017 · P-05 收尾：`--el-1` 落卡片 + T-08 批一：6 个 motion 小表合并

> 日期：2026-11-01 · 方式：`CODESCOPE_PORT=4971` + 独立 `CODESCOPE_DATA_HOME=/tmp/cs-el1b/data` +
> 临时 `CODESCOPE_VAULT=/tmp/cs-el1b/vault`（`CODESCOPE_AUTO_OFFICE=0`、`CODESCOPE_AUTH=off`），
> 跑完 **SIGKILL** 并回读端口释放。
> **全程未触碰 4877**；**没有任何 git 写操作**（只用 `git status` / `git diff` 读）。

## 0. 结论（先给数字）

| 项 | 改前 | 改后 |
| --- | --- | --- |
| `link[rel=stylesheet]` | **17** | **12** |
| `document.styleSheets.length` | **19** | **14** |
| `--el-1` 落点 | **0 处** | **3 类 / 5 个元素**（`.env-card`×3、`.env-dsh-card`、`.env-sync-card`） |
| 卡片 `box-shadow`（静止） | `none` | `rgba(0,0,0,.18) 0 1px 2px, rgba(0,0,0,.1) 0 2px 6px, rgba(255,255,255,.06) 0 1px 0 inset` |
| 卡片 `box-shadow`（hover） | `none` | `rgba(0,0,0,.24) 0 4px 12px, rgba(0,0,0,.18) 0 12px 28px, rgba(255,255,255,.08) 0 1px 0 inset` |
| 卡片几何（宽×高） | 136×70 / 427×101 / 427×650 | **完全相同**（三态逐值相等） |
| 合并后整页 computed 差异 | — | **0 处真差异**（2493 元素 × 44 属性 = 109,692 个值） |
| 测试 | — | `architecture` **91/91**、`undefined-refs` **0**、`smoke` **604 passed**、`pageerror` **0** |

**改了哪三个文件**（`git status`）：`assets/motion-batch1.css`（+74 行，只加一个第 9 节）、
`index.html`（6 条 link → 1 条，注释重写）、**新增** `assets/bundle-motion.css`（生成物）。
`src/*`、`lib/*`、`server.js`、`tests/*`、`assets/app.css`、`assets/ui-kit.css`、`assets/motion.css`、
`assets/doc-theme.css`、`assets/life-*.js`：**一个字节都没动**。

---

## A · `--el-1` 铺到卡片

### A.1 落点为什么是「环境面板一族」，而不是派单举例里的四类

派单允许 `.lw-c` / `.sp-band` / `.pane` / `.side` 一类，但实测这四类**都不能碰**：

| 候选 | 改前 computed | 为什么不动 |
| --- | --- | --- |
| `.lw-c` | 自带 `--pp-shadow-lift` + `inset … var(--pp-glow)` + hover 抬升 | 样式由 `life-styles.js` **运行时注入到 head 末尾** ⇒ 要压过它得提到 (0,3,0)；赢了就等于**删掉它自己的抬升与内高光** ✗ |
| `.sp-band` | `box-shadow: var(--sp-ring), var(--sp-hi), var(--sp-shadow)` | 同一注入机制；换成 el-1 会把 `sp-ring`（1px 环）与 `sp-hi`（内高光）一起抹掉 ✗ |
| `#pane-tree/draw/office/reading`、`#side` | `border-radius: 0`、`box-shadow: none`，上下**紧贴** | 给 0 圆角的相邻块加投影，接缝处会压出比块本身更大的一道深沟 ✗（与 P-05 记过的「单向投影留深沟」同因） |
| `#code-wrap` | `rgba(0,0,0,.28) 0 6px 22px + inset`（editor-chrome.css） | 已经有一套卡片质感，再叠 el-1 = 两套阴影语言叠在一起 ✗ |

而环境面板这一族，改前 computed 实测是 **`box-shadow: none` / `transition: all 0s`**
（只有 1px 边框 + 8px 圆角）⇒ el-1 是**净增**而不是覆盖 ✓。三个类都在 `#env-panel` 里，
**一屏截图能同时看到**（`.env-card`×3 统计卡、`.env-dsh-card` 托管卡、`.env-sync-card` 云同步卡）。

### A.2 改了哪些选择器（全部在 `assets/motion-batch1.css` 第 9 节）

```css
html[data-theme] .env-card,
html[data-theme] .env-dsh-card,
html[data-theme] .env-sync-card {
  box-shadow: var(--el-1);
  transition: box-shadow 160ms var(--mo-out);
}

html[data-theme] .env-card:hover,
html[data-theme] .env-dsh-card:hover,
html[data-theme] .env-sync-card:hover {
  box-shadow: var(--el-2);
}

@media (prefers-reduced-motion: reduce) {
  html[data-theme] .env-card,
  html[data-theme] .env-dsh-card,
  html[data-theme] .env-sync-card { transition: none !important; }
}
```

- **特异性**：(0,2,1)，压 `app.css:2404` 的 `.env-card` (0,1,0)；与 `app.css:3381` 的
  `html[data-theme] .env-card`（只写 background / border-color，**不写 box-shadow**）同特异性但本文件在后 ⇒ 不冲突。
  加 `[data-theme]` 前缀的理由同 P-05 ③：将来谁往主题块里补一条阴影都压不掉它。
- **档位**：静止 el-1，hover **下一档 = el-2**（三档里 el-1 的下一档就是 el-2，没有中间档；
  与 P-05「偏移与模糊两个维度同时单调递增」的定义一致）。借的是 el-2 的**数值**、不是语义。
- **transition 只写 box-shadow**：这三个类原本 `transition: all 0s`（等于没有过渡），
  不存在 P-01 那个「transition 整体替换掉入场过渡」的坑。160ms 与 P-05 三处一致。

### A.3 验收 ①：computed box-shadow（近层 / 远层 / 内高光都在）

`.env-card`（浅色，DPR 无关）：

| 状态 | computed `box-shadow` |
| --- | --- |
| 改前 | `none` |
| 改后静止 | `rgba(0,0,0,0.18) 0px 1px 2px 0px, rgba(0,0,0,0.1) 0px 2px 6px 0px, rgba(255,255,255,0.06) 0px 1px 0px 0px inset` |
| 改后 hover | `rgba(0,0,0,0.24) 0px 4px 12px 0px, rgba(0,0,0,0.18) 0px 12px 28px 0px, rgba(255,255,255,0.08) 0px 1px 0px 0px inset` |

`.env-dsh-card` / `.env-sync-card` 的 computed 与上表**逐字符相同**（三类共用同一档令牌）。
`transition` computed = `box-shadow / 0.16s / cubic-bezier(0.2, 0.8, 0.2, 1)`。

> ⚠️ 这里的内高光是 **.06（浅色档）**，不是 P-06 想要的暗色 .10 —— 原因见 §D（既有缺陷），
> 与本次改动无关，但必须写清楚，免得被当成「选错了档」。

### A.4 验收 ②：证明不影响布局

三态（挂 el-1 / hover 到 el-2 / 强制 `box-shadow:none !important`）分别读
`getBoundingClientRect().width·height`、`offsetWidth·offsetHeight`、`clientWidth·clientHeight`、
`scrollWidth·scrollHeight`：

```
LAYOUT hover-vs-base    identical = true
LAYOUT el1-vs-stripped  identical = true
```

逐值：`.env-card` 136×70（client 134×68、scroll 134×68）、`.env-dsh-card` 427×101、
`.env-sync-card` 427×650 —— 三态**全部相同**。box-shadow 不参与布局，这里是实测而不是推断。

### A.5 验收 ③：reduced-motion 下阴影保留、只去过渡

指针移开（确保读静止档）后 `emulateMedia({ reducedMotion: 'reduce' })`：

| 类 | `box-shadow` | `transition-property` | `transition-duration` |
| --- | --- | --- | --- |
| `.env-card` | el-1（照旧） | `none` | `0s` |
| `.env-dsh-card` | el-1（照旧） | `none` | `0s` |
| `.env-sync-card` | el-1（照旧） | `none` | `0s` |

⚠️ 必须 `!important`：`app.css:3828` 的全局兜底是 `transition-duration:.01ms !important`，
只写 `transition:none` 时 computed 仍是 `all / 1e-05s`（基线实测就是这样）。加 `!important` 之后
属性才是真正的 `none`。**阴影一条没动** —— 阴影是静态层级，不是动效。

### A.6 验收 ④：截图 `/tmp/el1-cards.png`

同一张 `.env-card`、同一裁剪、DPR 4、浅色主题，四格：①改前（抹掉 el-1）②改后静止（el-1）
③改后 hover（el-2）④②→③ 的**差异图（×5 增益）**。

数字：**38.55% 像素变化 / maxΔ 53/255**（②→③ 的 hover 抬升）。
整块面板 ①→③（含 hover）在 DPR 3 下是 **16.53% / maxΔ 75**。
差异图里只有卡片**外沿一圈**亮起来、卡内是纯黑 —— 正是「只加阴影、不动内容」的样子。

> 暗色的观感另说：el-1 在 `#0a0e14` 这类近黑底上几乎读不出，这是 P-06 已经量过的结论
> （同一改动量：浅色 8.84% / 暗色 1.31% 像素）。所以验收图以浅色为主，
> 暗色只作第三格对照，不拿它当「没做」的证据。

---

## B · T-08 批一：6 个 motion 小表 → 1 个 bundle

### B.1 判定：哪 6 个能合、剩下 11 条为什么一条都不动

**能合的 6 个**：`motion-lw` / `motion-sp` / `motion-study` / `motion-cg` / `motion-dbg` / `motion-monaco`。

三条硬依据：

1. **它们在 link 序列里本来就是连续的 6 条**（原第 10~15 条）。合并只减少请求数，
   **没有一条规则相对其它文件的先后被改动** —— 拼接后 bundle 落在原来第 10 条的位置，
   仍在 `motion.css` 之后、`editor-chrome.css` 之前 ✓（`editor-chrome.css` 依赖
   「在 motion-monaco 之后落最终外观」，这条**一点没变**）。
2. **六个文件里没有 `@charset`、没有 `@import`、没有相对 `url()`**（实测 grep 全空）
   ⇒ 字节拼接不会踩「`@import` 必须在最前」「`url()` 按本文件解析」这两个坑。
3. 它们彼此之间**本来就没有靠加载顺序取胜的依赖**：lw/sp/cg/dbg 用重复类名提特异性
   （`.lw-btn.lw-btn` → (0,2,0)）；study 只需要「在 app.css 之后」；monaco 只需要
   「在 editor-chrome 之前」—— 三条约束合并后全部满足。

**不合并的 11 条，逐条理由**（这是「不为了凑数字动加载顺序」的部分）：

| 文件 | 为什么不动 |
| --- | --- |
| `app.css` → `ui-kit.css` → `doc-theme.css` → `motion.css` | 这是一条**明确的「同特异性 + 后出现」链**（index.html:160-166 写了实测：`app.css:3284` 的 (0,1,2) 压裸 `button`）。虽然它们在 link 序列里也相邻、按序拼接**理论上**级联等价，但**派单明确要求不要动这一族**，且它们各自是「取悦后加载」的语义核心；动它的收益（4→1）不足以抵消评审成本 ⇒ **不动** ✓ |
| `motion-batch1.css` | 必须排在**所有**老 CSS 之后（本批 A 的新规则也写在这里），第 17 位，永远最后 ⇒ 不合并 |
| `editor-chrome.css` | 依赖「在 motion-monaco 之后」；留在 bundle 之后即可，**不动** |
| `hljs-theme` / `xterm` / `pdfjs/pdf_viewer` / `golden-layout` / `study-workspace` | 前四条在第 16~20 行，是**独立用途的基础依赖**（highlight.js 主题 / 终端 / PDF / 布局库），其中两条根本不在 `/assets/` 下（相对 `url()` 会失效）⇒ **不动** |
| 其余 3 条 | 见上表（`app/ui-kit/doc-theme/motion` 已成一组讨论） |

⇒ 减少 **5 条**（6 → 1）：**17 → 12**，正好达到 T-08 的目标下限，且**没有一条顺序被改**。

### B.2 怎么合的（不引入构建步骤）

- **新增 `assets/bundle-motion.css`**：`cat` 六个文件、**按原 link 顺序**、逐字节拼接。
  实测：`written bytes = 112,699` ＝ `19,661 + 18,439 + 20,654 + 24,212 + 17,422 + 12,311`
  ＝ 六个源文件字节数之和，`exact concat = true`。
- **`index.html`**：删掉 6 条 link，插入 1 条
  `<link rel="stylesheet" href="/assets/bundle-motion.css?v=20261101a">`，
  并把三处原注释改写成「已并进 bundle，写在 bundle 里的先后不变」，**原解释全部保留**。
  再生成方式直接写在 `index.html` 的注释里（`cat` 六行），**没有 `scripts/` 构建步骤、没有改 npm scripts**。
- **六个源文件留在仓库里、一字未改**（棘轮 `architecture.js` 逐个守着它们，全部照旧）。
  回滚 = 删掉 bundle 那条 link、恢复六条。

### B.3 验收 ①：数量

| | 改前 | 改后 |
| --- | --- | --- |
| `document.querySelectorAll('link[rel=stylesheet]').length` | **17** | **12** |
| `document.styleSheets.length` | **19** | **14** |

link 序列（改后）：`hljs-theme → xterm → pdfjs → goldenlayout → study-workspace → app → ui-kit →
doc-theme → motion → **bundle-motion** → editor-chrome → motion-batch1`。

### B.4 验收 ②：规则集一字不差（不是「差不多」）

把「参与合并的样式表」的 `cssRules` 逐条 `cssText` 取出来、按顺序拼接后取 sha256：

| | 表数 | 规则行数 | sha256（前 16） |
| --- | --- | --- | --- |
| 改前（6 张表） | 6 | **275** | `cf4208f8829491bd` |
| 改后（1 张 bundle） | 1 | **275** | `cf4208f8829491bd` |

⇒ **规则条数、内容、先后全部相同**。

### B.5 验收 ③：整页 computed 逐元素 A/B（最硬的一条）

同一份 index.html，用 Playwright `route` 拦截**只把这一行 link 换回六条**（磁盘不动），
两次冷加载后对**每个元素 × 44 个属性**（含 `::before`/`::after` 的 color/bg/shadow/width/transform/content）
取 `getComputedStyle` 做对比：

```
links  bundle=12  six-link=17
elements bundle=2499  six-link=2504  common(两态都存在的元素)=2493
COMPUTED DIFFS over 2493 elements × 44 props = 1
  {"path":"BODY:1>HEADER:1>DIV:2>DIV:0>BUTTON:0>SPAN:2>I:0","prop":"transform",
   "bundle":"matrix(0.13, 0, 0, 1, 0, 0)","six":"matrix(0.04, 0, 0, 1, 0, 0)"}
```

**这 1 条是噪声，不是合并造成的** —— 用 **A/A 对照**证明：同一份 bundle 连跑两次，
同样的 1 条、同一个路径、同一个属性再次出现：

```
links  bundle=12  bundle=12
COMPUTED DIFFS over 2499 elements × 44 props = 1
  {"path":"BODY:1>HEADER:1>DIV:2>DIV:0>BUTTON:0>SPAN:2>I:0","prop":"transform",
   "bundle":"matrix(0.1, 0, 0, 1, 0, 0)","six":"matrix(0.02, 0, 0, 1, 0, 0)"}
```

⇒ 那是顶栏里由 JS 驱动的 `scaleX` 动画（矩阵值是采样时刻的中间帧），
**跑一次自己和自己都比不等**。把这一条扣掉，**真差异 = 0 / 109,692 个 computed 值**。

### B.6 验收 ④：被合并表里的关键规则仍然生效（computed 证据）

每个文件挑一条**只在它自己里定义**的规则，用探针元素实测（改前改后**逐项相同**）：

| 源文件 | 探针选择器 | computed（改前 = 改后） |
| --- | --- | --- |
| `motion-lw` | `.lw-inpanel .lw-nav button .ic` | `transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)` |
| `motion-sp` | `#system-workspace #system-head button` | `transition-property: background-color, border-color, color, box-shadow, transform`；`0.12s, 0.12s, 0.12s, 0.18s, 0.18s` |
| `motion-study` | `#study-workspace #study-head select` | `0.12s ×3 / cubic-bezier(0.2, 0.8, 0.2, 1)` |
| `motion-cg` | `.cg-tab.cg-tab` | `transition-property: background-color, border-color, color, transform`；`border-top-color: rgb(232, 237, 244)` |
| `motion-dbg` | `.var-bar button`（探针走 `html[data-theme] .var-bar button` 那条） | `0.12s, 0.12s, 0.12s, 0.18s, 0.18s` |
| `motion-monaco` | `.editor-group-divider::after` | `transition: transform, background, box-shadow 0.12s`；`width: 1px`；`background: color(srgb 0.152941 0.196078 0.254902 / 0.72)` |

外加「主题色 / 动效令牌 / 面板底色」这组（与被合并表同链、确认整条链路没被带动）：

| 项 | computed |
| --- | --- |
| 动效令牌 | `--mo-1: 120ms`、`--mo-2: 180ms`、`--mo-3: 260ms`、`--mo-out: cubic-bezier(.2,.8,.2,1)`、`--mo-back: cubic-bezier(.34,1.56,.64,1)` |
| 主题色（app.css） | `--accent: #78a9ff`、`--bg: #0a0e14`、`--panel: #10161f`、`--border: #273241`、`--text: #e8edf4` |
| 文档配色（doc-theme.css） | `--doc-bg: #272E33`、`--doc-text: #D3C6AA`（Everforest 仍在） |
| 面板底色 | `#side: rgb(15,21,29)`、`header: rgb(16,22,31)`、`body: rgb(10,14,20)` |

并且 `/assets/bundle-motion.css?v=20261101a` 首屏 **HTTP 200**，全站 CSS 请求里已无
`motion-lw/sp/study/cg/dbg/monaco` 六个 URL。

---

## C · 测试

| 测试 | 结果 |
| --- | --- |
| `node tests/architecture.js` | **架构断言：91/91 项通过** |
| `node tests/undefined-refs.js` | **0 处**（查了 18 个脚本） |
| `node tests/smoke.js` | **604 passed** |
| 浏览器 `pageerror`（每次探针都统计） | **0**（首屏 / 环境面板 / A/B 两态 / 截图四轮全部 0） |

---

## D · 发现的既有缺陷（**不是本次改动引入的，我没修，需要你决定**）

**P-06 的暗色 elevation 覆盖块整条失效**（`motion-batch1.css:277-281`）。

- 现象：`html[data-theme="ocean"]`（暗色，默认主题）下
  `getComputedStyle(html).getPropertyValue('--el-1')` 拿到的是**浅色档** `inset … .06`，
  应该是暗色的 `.10`；`--el-2 / --el-3` 同理。
- 证据 1：该文件的 CSSOM 只有 **33 条**规则，其中**没有任何**一条
  `html[data-theme]:not([data-theme="light"])` 的 `--el-*` 定义。
- 证据 2（根因）：第 254 行注释里写着 `maxΔ **15**/255` —— `**15**/255` 这段文本本身
  含 `*/` 两个字符，**提前把注释关掉了**；剩下的注释文字被当成一个非法选择器，
  一路吞到第 277 行那个块的 `{`，于是整个暗色块被**当成无效规则丢弃**（258 行的 `**16**/255` 是同样序列，两个都要改）。
- 证据 3（验证）：把同一份 CSS 里的 `**15**/255` / `**16**/255` 改成 `**15** /255`
  （各加一个空格）后重测：规则数 **33 → 34**（暗色块被解析回来了），
  `--el-1` 的 inset 从 **.06 → .10** ✓。
- **影响**：`#pane-git` / `#sym-modal-box` / `.ctx-menu` 三个面在暗色下一直拿的是浅色档内高光
  —— 也就是说 P-06 报的那次「暗色改用内高光 + 描边」**在成品里没有生效**（描边那条
  `outline` 规则是独立的第 353 行块，是生效的）。
- **为什么我没修**：修了会**改变那三个面在暗色下的 computed 阴影**（0.06→0.10 / 0.08→0.14 / 0.10→0.18），
  属于本次派单之外的视觉变更，而且会让 `plans/016` 里 P-06 那批数字对不上现状。
  一行改动即可（在 `**15**/` 和 `**16**/` 里各插一个空格），**建议单独一个 commit**。
  本次 A 的卡片不受影响：它们走同一个 `--el-1`，跟着一起改就对了。

---

## E · 没做到的 / 已知限制

1. **`--el-1` 只落了 3 类（环境面板一族）**，派单举例的 `.lw-c` / `.sp-band` / `.pane` / `.side`
   **一个都没落**（理由见 A.1）。如果目标是「卡片档全站统一」，那必须先给 `.lw-c`（`--pp-shadow*`）
   与 `.sp-band`（`--sp-*`）**各自的老阴影体系做迁移**，那是另一个批次，不能靠 override 硬压。
2. **hover 借用了 `--el-2` 的数值**当作「上一档」。若评审认为 el-2 的语义（浮层/右键菜单）
   不该被卡片借用，那就需要新增 `--el-1h`（三档之间再来一档）；改动点只有第 9 节一处。
3. **暗色下 el-1 的观感几乎看不出来**（P-06 已量化：同一改动量暗色只动 1.31% 像素）。
   本次没有为此调数值 —— 按「外阴影明暗共用 + 暗色靠内高光」的既定结论走；
   若要让暗色卡片「看得出层级」，得改 `--el-out-1`，那是全局三档的事，不建议在这一批做。
4. **B 只减了 5 条（17→12）**，没有继续往下压：再往下就必须动
   `app.css/ui-kit/doc-theme/motion` 这条「后加载取胜」链或那 5 条基础依赖，
   风险远大于收益（派单原话：不要为了凑数字动加载顺序）。
5. **`link` 的 `?v=` 版本号** 我用了 `20261101a`（新文件的自然值）。T-09（内容哈希长缓存）
   落地时会被自动接管；在那之前它只是个缓存 busting 标记，与其它资源的写法一致。
6. 首屏 CSS **请求数**我没有单独统计（`golden-layout` 那条在探针的 URL 过滤里漏掉了）；
   能确定的是 link **元素数** 17→12、样式表对象 19→14，这两个数是数出来的。

---

## F · 回滚方式

- **A**：删掉 `assets/motion-batch1.css` 第 9 节（从「9. P-05 落地」注释到文件末尾），
  `.env-card / .env-dsh-card / .env-sync-card` 立刻回到 `box-shadow: none`。
- **B**：删掉 `index.html` 里那条 `bundle-motion.css`，把六条 link 加回原位（注释里已写明原位置），
  `assets/bundle-motion.css` 可留可删 —— 源文件从未修改，随时可 `cat` 重建。
