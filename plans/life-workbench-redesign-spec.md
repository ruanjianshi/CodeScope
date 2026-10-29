# 个人管理面板 · 重构设计规范（v1，2026-10-29）

> 对象：`assets/life-workbench.js`（16,271 行 / 1.0 MB，手写、无构建脚本、自带主题常量 `T` 与内联 CSS）。
> 诉求（用户原话）：「终端风格和 CodeScope 太违和、不匹配、看着不舒服」「重新设计」「要灵动感、动态感、交互感」「看上去舒服、柔和」。

## 0. 为什么违和（先诊断，再动手）

`assets/life-workbench.js:44-58` 定义的是一套**刻意选择的终端 HUD 语言**：
纯黑底 `#0b0b0b` + 硬米白边框 `#e8e4d8` + 零/小圆角 + 淡黄强调 `#f2e39b` + **全站等宽字体** + 全大写 + `K-01 / N-01` 编号 + 满屏 1px 实线框。

它与 CodeScope 主界面冲突的点（每一条都能指到具体声明）：

| # | 冲突点 | 现状 | 目标 |
| --- | --- | --- | --- |
| 1 | 底色更黑更暖 | `T.bg #0b0b0b`、`card #0f0f0f` | 用主界面令牌 `var(--bg)` / `var(--panel)` / `var(--panel2)` |
| 2 | 边框是「米白硬线」 | `2px solid ${T.line}`（顶栏）、满屏 `1px solid #e8e4d8` | `1px solid var(--border)`，只做分隔、不做造型 |
| 3 | **全站等宽字体** | `font-family:${UI}`（整个面板，含中文正文） | 正文用主界面字体栈；**等宽只给数字/时间/键位** |
| 4 | 全大写 + 大字距 | `.lw-h1{text-transform:uppercase;letter-spacing:1.6px}` | 正常大小写，中文标题 12.5px/650，字距 0 |
| 5 | 编号前缀 `K-01 / N-01` | 每个区块左上角 | 保留为极小号等宽灰字，或直接去掉 |
| 6 | 零装饰、无层次 | 全靠线框分层 | 用「底色差 + 10px 圆角 + 柔和阴影」分层 |
| 7 | 淡黄强调 | `T.accent #f2e39b` | 改用主界面强调色 `var(--accent)`；状态色沿用 `--ok/--warn/--err` |

## 1. 令牌替换（第一步，也是收益最大的一步）

`T` 里的字面量**逐个换成主界面 CSS 变量**（面板渲染在主文档内，`:root` 变量都可用）：

```js
const T = {
  bg: 'var(--bg)', bg2: 'var(--panel)', card: 'var(--panel)', card2: 'var(--panel2)',
  line: 'var(--border)', lineDim: 'var(--border)', line2: 'var(--border)',
  text: 'var(--text)', dim: 'var(--dim)', faint: 'var(--dim)',
  accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)', red: 'var(--err)',
  grad: 'none',
};
```

⚠️ 若某个 `var(--x)` 在主界面里不存在，**不要凭空造变量**：去 `assets/app.css` 的 `:root` 里查真实名字再写。查不到就退回中性字面量，并在报告里列出。

## 2. 排版

- 正文字体：与主界面一致（`font-family:inherit` 或复制 `body` 的字体栈）；**不许**把等宽字体设到容器上。
- `MONO` 只用于：表格数字、时间、快捷键、`K-01` 这类稳定编号。
- 字号阶梯：12.5px 正文 / 11px 次要 / 10.5px 元信息 / 15–18px 关键数字（等宽 + `font-variant-numeric: tabular-nums`）。
- 去掉 `text-transform:uppercase` 与大于 1px 的 letter-spacing（全仓范围内，不只标题）。
- 标题：中文不加大写；区块标题 12.5px/650 + 左侧 2px 强调竖条（与系统面板同一语言）。

## 3. 容器与层级

只允许两种容器（与「本机管家」规范**完全一致**，两个面板要看起来是同一个产品的两个视图）：

1. **band（区块）**：无阴影、无圆角、无边框；靠 24px 纵向间距 + 11px 区块标题分节。
2. **card（卡片）**：`var(--panel2)` 底 + `1px solid var(--border)` + **10px 圆角** + 柔和阴影。

禁止：2px 硬描边、纯黑 `#0b0b0b`、渐变按钮、满屏等宽。

## 4. 灵动 / 动态 / 交互（用户明确要的三件事）

全部复用主界面已有令牌，**不要新造时长**：

- `--mo-1:120ms` 即时反馈、`--mo-2:180ms` 卡片抬升、`--mo-3:260ms` 区块入场。
- 曲线默认 `var(--mo-out)`；**过冲 `var(--mo-back)` 只给用户主动操作**，不给系统自发的重排。
- **卡片悬停**：`transform: translateY(-1px)` + 阴影加深，`var(--mo-2)`。
- **按下**：`transform: scale(.985)`，`var(--mo-1)`。
- **区块入场**：`opacity 0→1` + `translateY(4px)→0`，`var(--mo-3)`；同批卡片 40ms 步进（前 8 个）。
- **数字变化**：不要瞬跳 —— 用颜色过渡或一次性高亮脉冲（复用 `mo-status-glow`）。
- **不做**：轮询刷新不要加动画，否则每次刷新整块闪。
- 必须写 `prefers-reduced-motion` 分支：只去掉位移，保留透明度/颜色反馈。

## 5. 硬约束

- **不许删功能**：待办 / 笔记 / 书签 / 研究日常 / 文件 / 阅读 / 热榜 / 邮箱 / 工作流，全部保留。
- **不许改** `lib/*`（服务端）与其它面板的文件。
- **不许碰 4877** 那个正在运行的实例；验证一律隔离实例（`CODESCOPE_PORT=49xx` + 临时 vault/data，测完杀进程）。
- 该文件**没有构建脚本**，直接改 `assets/life-workbench.js`；改完必须 `node --check` 通过。
- 不许 git commit / add / stash；不许改 `tests/architecture.js`。
---

## 6. ⚠️ 方向修订（2026-10-29，用户新指令）：程序员风格 · 简朴 · 纸质化

用户后续要求：「程序员风格的那种，简朴，纸质化风格」。
这是对第 1 节调色板方向的**修订**，但**第 2/3/4 节的结构与动效规则全部保留**（细线、10px 圆角以内的克制、等宽只给数字、区块/卡片两级容器）。

### 6.1 纸质调色板（实现方式：**在这个面板容器内覆盖令牌**）

面板自带容器类（如 `.lw-inpanel`），所以在它上面**局部覆盖主界面变量**即可，不需要改 `app.css`，也不会外溢到其它视图：

```css
.lw-inpanel {
  --bg: #f6f3ea;          /* 纸底：暖白，不刺眼 */
  --panel: #fbf9f3;       /* 卡片：比纸底再亮一档 */
  --panel2: #f1ede1;      /* 次级面：表格斑马纹、内嵌块 */
  --border: #d9d3c4;      /* 细线：像印刷品的 hairline */
  --text: #221f1b;        /* 墨字 */
  --dim: #6c6659;         /* 次要墨：注释、元信息 */
  --accent: #2f5d46;      /* 墨绿：唯一的强调色，像钢笔水 */
  --ok: #3f7a4f; --warn: #9a6b1f; --err: #a23b2a;
  --lw-shadow: none;      /* 纸质不用投影 */
}
```

### 6.2 「简朴」的具体含义（否则会退化成空）

- **无阴影、无渐变、无玻璃**。层级只靠：底色差（三档）+ hairline 细线 + 间距。
- **圆角收到 3px**（纸不会圆角），比原来的 6–10px 更硬朗但不尖。
- **强调色只出现在三处**：区块标题左侧 2px 竖条、当前选中项、关键数字。别处一律用墨色。
- **等宽字体回来说得通**（程序员风格）：数字、时间、键位、代码样片段用等宽；中文正文仍用正文字体。
- 去掉满屏 1px 实线框：区块之间只留 **24px 间距 + 一条 8% 灰的 hairline**，不要每块都画框。

### 6.3 动效在纸质风格里的收敛（与第 4 节的冲突怎么办）

第 4 节要求「灵动/动态」，纸质要求「简朴」——两者的交集是：**短、静、只做必要的提示**。

- 保留：hover 底色变化 `var(--mo-1)`、选中态左侧竖条生长 `var(--mo-2)`、区块入场只做 `opacity`（**去掉 translateY**，纸不会飘起来）。
- 保留：数字变化用一次性高亮（背景闪一次纸黄 → 回落），不要滴答滚动。
- **去掉**：卡片抬升 `translateY(-1px)`、按下 `scale(.985)`、过冲曲线 —— 这些是「塑料感/悬浮感」的来源。
- 仍然必须写 `prefers-reduced-motion`：只保留颜色变化。

### 6.4 需要用户确认的一件事（写在这里备忘）

纸质面板是**浅色**的，而 CodeScope 主界面默认是深色 —— 打开面板会是一整块亮色区域。
两种可能：**(a)** 就要这个反差，像「桌面上摊开一本笔记本」；**(b)** 面板跟随 App 主题：App 浅色时才用纸白，深色时用「深色哑光纸」（`#1b1a17` 底 + `#e8e4d8` 字，无阴影无圆角感）。
默认按 **(a)** 实现；若用户选 (b)，只需在 `.lw-inpanel` 上再加一段 `html[data-theme]` 版本。
---

## 7. ★ 最终方向（2026-10-29 定稿，**覆盖 6.1 / 6.3 中与本节冲突的部分**）

用户最终指令：「**B**（面板跟随 App 主题）+ **不是简朴，需要很好的交互立体感**」。

⇒ 物理隐喻从「平摊的一张纸」改成「**一叠有厚度的纸**」：有层次、有压痕、能拿起来、能按下去。
⇒ 调色板必须做**两套**，由 `html[data-theme]` 切换（App 深色/浅色各自成立）。

### 7.1 两套调色板（局部覆盖在面板根容器上）

```css
/* 浅色：暖白纸 */
html[data-theme=light] .lw-inpanel, html[data-theme=graphite] .lw-inpanel { /* 具体选择器按 App 实际主题名调整 */
  --pp-page:#f4f1e8; --pp-sheet:#fdfbf6; --pp-sheet2:#f7f3e9;
  --pp-ink:#221f1b; --pp-ink2:#6c6659; --pp-line:rgba(34,31,27,.10);
  --pp-accent:#2f5d46;
  --pp-shadow:0 1px 1px rgba(28,24,16,.05), 0 2px 4px rgba(28,24,16,.06), 0 8px 18px rgba(28,24,16,.05);
  --pp-shadow-lift:0 2px 2px rgba(28,24,16,.06), 0 6px 12px rgba(28,24,16,.10), 0 16px 32px rgba(28,24,16,.08);
  --pp-inset:inset 0 1px 2px rgba(28,24,16,.14);
}
/* 深色：哑光墨纸 */
html[data-theme=ocean] .lw-inpanel, html[data-theme=midnight] .lw-inpanel, html[data-theme=forest] .lw-inpanel {
  --pp-page:#14120f; --pp-sheet:#1c1a16; --pp-sheet2:#232019;
  --pp-ink:#ece7db; --pp-ink2:#a49d8e; --pp-line:rgba(236,231,219,.10);
  --pp-accent:#d8c9a3;
  --pp-shadow:0 1px 0 rgba(0,0,0,.5), 0 6px 16px rgba(0,0,0,.42);
  --pp-shadow-lift:0 2px 0 rgba(0,0,0,.5), 0 10px 26px rgba(0,0,0,.55);
  --pp-inset:inset 0 1px 2px rgba(0,0,0,.5);
}
```

⚠️ **主题选择器必须先去 `assets/app.css` 查真实的 `html[data-theme=...]` 取值**（已知至少有 ocean / graphite / midnight / forest / light），不要凭记忆写。
⚠️ 若两套选择器写法太繁琐，允许用**变量间接**：一套基于 `--pp-*` 的规则，两处只定义 `--pp-*` 的值。**不要复制两遍整套样式**。

### 7.2 立体感系统（这是本节的重点，不是可选）

四个明确的层级，每个层级的「厚度」由阴影 + 底色差 + 1px 内高光共同表达：

| 层级 | 用途 | 视觉 |
| --- | --- | --- |
| L0 页面 | 面板底 | `--pp-page`，**无阴影** |
| L1 纸片卡 | 待办/笔记/文件等主卡片 | `--pp-sheet` 底 + `--pp-shadow` + 1px `--pp-line` + **内高光** `inset 0 1px 0 rgba(255,255,255,.7)`（深色版用 `rgba(255,255,255,.04)`） |
| L2 抬起 | 卡片 hover | `translateY(-1px)` + `--pp-shadow-lift`，180ms `var(--mo-out)` |
| L3 浮层 | 对话框 / 抽屉 / 菜单 | `--pp-shadow-lift` 再加一层 `0 24px 60px rgba(0,0,0,.22)`，入场 `translateY(6px)+opacity`，260ms |

**按下**：`--pp-inset` + `translateY(1px)`（不是 scale，纸被按下去是凹的，不是变小）。
**选中**：左侧 3px `--pp-accent` 竖条 + 底色 `--pp-sheet2`（像索引标签）。

### 7.3 动效（立体感靠这几条，不要省）

- 卡片 hover：`transform: translateY(-1px)` + `box-shadow` 换 `--pp-shadow-lift`，`var(--mo-2)` + `var(--mo-out)`。
- 卡片按下：`translateY(1px)` + `--pp-inset`，`var(--mo-1)`。
- 区块/卡片入场：`opacity 0→1` + `translateY(6px)→0`，`var(--mo-3)`，同批 **40ms 步进**（前 8 个）。
- 抽屉/对话框：`translateY(8px) scale(.99) + opacity`，`var(--mo-4)` + `var(--mo-drawer)`（**新增令牌**，已存在）。
- 数字变化：一次性纸黄高亮（背景闪 → 回落 400ms），不要滚动。
- ⚠️ 轮询刷新**不加动画**。
- 必须写 `prefers-reduced-motion`：去掉位移与缩放，保留阴影/颜色/透明度变化（层次感不能丢）。

### 7.4 验收（必须两套主题各截一张）

1. 深色主题（默认 ocean）下：`/tmp/pp-dark-1600.png`。
2. 浅色主题下：点顶栏「主题」→「日光白」后：`/tmp/pp-light-1600.png`。
3. 两张都必须能看出：**至少三层厚度**（页面 / 卡片 / 抬起或浮层）、卡片有内高光、按下是凹进去的。
4. 截图时鼠标**悬停在其中一张卡片上**（用 Playwright `hover()`），让抬起态可见。