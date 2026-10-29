# 005 — h2 悬停改用 transform，不再借 transition:all 动布局属性

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: MEDIUM
- **Category**: 5. Performance + 2. Easing & duration
- **Estimated scope**: 1 文件（`doc-theme.css`），约 8 行

## Problem

阅读视图的 h2 两侧装饰竖线，悬停时用 `transition: all .4s` 在动 `margin-top` 和 `height` —— **布局属性 + all + 400ms**，每悬停一个标题都要重排。

```css
/* masscode-runner/assets/doc-theme.css:147-153 —— 现状（::before，左侧 5px 竖线） */
.md-doc h2::before, .reading-md-editor h2::before, … {
  content:''; position:absolute; left:0; top:auto; margin-top:.2em;
  width:5px; height:1em; border-radius:4px;
  background:var(--doc-primary); opacity:.8;
  box-shadow:0 0 8px color-mix(in srgb,var(--doc-primary) 50%,transparent);
  transition:all .4s cubic-bezier(.25,.8,.25,1);
}
/* :154-158 —— 现状（::after，右侧 2px 竖线，多一个手打 .05s 错峰） */
.md-doc h2::after, … {
  content:''; position:absolute; left:8px; top:auto; margin-top:.4em;
  width:2px; height:.6em; border-radius:2px;
  background:var(--doc-secondary); opacity:.6;
  transition:all .4s cubic-bezier(.25,.8,.25,1) .05s;
}
```
```css
/* doc-theme.css:161-164 —— 悬停时动的是这些布局属性 */
.md-doc h2:hover::before, … { margin-top:0; height:1.4em; opacity:.5; }
.md-doc h2:hover::after, … {
  margin-top:.15em; height:1.1em; width:4px; opacity:1;
  background:var(--doc-primary); box-shadow:0 0 12px var(--doc-primary);
}
```

这也是**同一仓库两种相反做法**：`motion.css:268-269` 对同类视觉（tab 下划线）明确写过「用 `transform: scaleX()` 而不是改 width，width 会触发重排」。

## Target

尺寸在常态固定，悬停只做 `transform` + `opacity`/`color`/`box-shadow`（后三者不触发 layout）。

数学核对（务必按此验证，不要凭感觉调）：
- `::before`：`margin-top .2em→0`、`height 1em→1.4em` ⇒ 上下各扩 .2em，**等于以中心为原点 `scaleY(1.4)`**。宽度 5px 不变。
- `::after`：`height .6em→1.1em`（×1.8333）、`width 2px→4px`（×2） ⇒ `scale(2, 1.8333)`，原点 `center`。

```css
/* target */
.md-doc h2::before, .reading-md-editor h2::before, .reading-md-block h2::before {
  content:''; position:absolute; left:0; top:auto; margin-top:.2em;
  width:5px; height:1em; border-radius:4px;
  background:var(--doc-primary); opacity:.8;
  box-shadow:0 0 8px color-mix(in srgb,var(--doc-primary) 50%,transparent);
  transform: scaleY(1);
  transform-origin: center;
  /* hover 类目标 100–200ms（AUDIT 判据）；原来 .4s + transition:all 全部超限 */
  transition: transform var(--mo-2) var(--mo-out), opacity var(--mo-2) var(--mo-out),
              background var(--mo-2) var(--mo-out), box-shadow var(--mo-2) var(--mo-out);
}
.md-doc h2::after, .reading-md-editor h2::after, .reading-md-block h2::after {
  content:''; position:absolute; left:8px; top:auto; margin-top:.4em;
  width:2px; height:.6em; border-radius:2px;
  background:var(--doc-secondary); opacity:.6;
  transform: scale(1, 1);
  transform-origin: center;
  transition: transform var(--mo-2) var(--mo-out), opacity var(--mo-2) var(--mo-out),
              background var(--mo-2) var(--mo-out), box-shadow var(--mo-2) var(--mo-out);
  transition-delay: 0ms; /* 原来手打 .05s 错峰；改由 --mo-2 + 下面 40ms 承担 */
}
.md-doc h2:hover::before, .reading-md-editor h2:hover::before {
  transform: scaleY(1.4);
  opacity: .5;
}
.md-doc h2:hover::after, .reading-md-editor h2:hover::after {
  transform: scale(2, 1.8333);
  opacity: 1;
  background: var(--doc-primary);
  box-shadow: 0 0 12px var(--doc-primary);
  transition-delay: 40ms; /* 40ms 错峰：落在 AUDIT 的 30–80ms 区间内 */
}
```

⚠️ 悬停规则里**必须删掉** `margin-top`/`height`/`width` 三个声明，否则它们仍会（在 400ms 后被移除的 all 之外）以无过渡方式瞬变。

## Repo conventions to follow

- 曲线与时长令牌：`masscode-runner/assets/motion.css:41-48`（`--mo-2: 180ms`、`--mo-out`）。
- 「用 transform 而不是改尺寸」的论证范例：`masscode-runner/assets/motion.css:268-269`。
- `doc-theme.css` 自己的令牌前缀是 `--doc-*`，但**时长/曲线一律复用 `--mo-*`**（`--doc-ease-*` 已在计划 001 里改成别名）。

## Steps

1. `doc-theme.css:152`：`transition:all .4s cubic-bezier(.25,.8,.25,1);` → Target 里的显式属性列表 + `transform: scaleY(1)` + `transform-origin: center`。
2. `doc-theme.css:158`：同样改写，`transform: scale(1, 1)`，去掉手打的 `.05s`。
3. `doc-theme.css:161`：删掉 `margin-top:0; height:1.4em`，改为 `transform: scaleY(1.4)`。
4. `doc-theme.css:162-164`：删掉 `margin-top:.15em; height:1.1em; width:4px`，改为 `transform: scale(2, 1.8333)` + `transition-delay: 40ms`。

## Boundaries

- 不要改 h2 本身的 `transition: color .3s ease, text-shadow .3s ease`（:145，那是文字变色，不在本计划范围）。
- 不要改 blockquote（:181/:188）与链接（:207）的 `transition: all` —— 那是另外两处，另开计划，避免一次改太多。
- 不要动 `left: 0` / `left: 8px` 的定位，也不要动 `border-radius`。
- 若 `transform-origin: center` 让上缘偏移与原文不一致（视觉上竖线像是"从中间长"而不是"从顶端长"），**停下来报告**，不要自行改成 `bottom`。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`doc-theme.css` 棘轮 685 行代码 —— 会超，需如实上调并写理由）。
- `grep -n "transition:all" masscode-runner/assets/doc-theme.css` 应从 5 处降到 3 处（本计划只处理 :152/:158 两处）。
- **Feel check**：把 playback 调到 10%，鼠标扫过连续 5 个 h2：
  - 两条竖线的**顶端与底端**分别稳步移动，中途没有"跳一下"；
  - DevTools Performance 录制悬停过程，**不应出现 Layout**（只应有 Composite/Paint）；
  - 对比改前改后截图（同一行标题），竖线在静止时的位置与尺寸应当持平。
- **Done when**：悬停 h2 时 Performance 面板没有 Layout 记录，且静止态外观与改前一致。
