# 007 — 大纲进度条改为 scaleX，变量不再跨层驱动宽度

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: MEDIUM
- **Category**: 5. Performance
- **Estimated scope**: 2 文件（`app.css` 1 条规则 + `app-reading.js` 1 行），约 6 行

## Problem

阅读大纲顶部有一条 2px 的阅读进度条。它的宽度由**父节点上写的 CSS 变量**算出来，并且带 `.14s` 过渡，而该变量在**每个滚动帧**都被重写 —— 一次滚动同时踩中两条判据：父级变量驱动子元素 + 动画布局属性。

```css
/* masscode-runner/assets/app.css:1467-1468 —— 现状 */
.reading-md-outline-progress { grid-column:1 / -1; position:relative; height:2px; margin:8px -12px -8px; background:color-mix(…); }
.reading-md-outline-progress::after { content:''; position:absolute; top:0; bottom:0; left:0;
  width:calc(var(--outline-progress,0) * 100%); border-radius:0 2px 2px 0;
  background:linear-gradient(90deg,…); transition:width .14s linear; }
```
```js
/* masscode-runner/assets/app-reading.js:464 —— 变量写在父节点 .reading-md-outline 上 */
  outline.style.setProperty('--outline-progress',ratio.toFixed(4));
```

后果：滚动每帧重设变量 → 每帧重新解析子元素的 `width: calc()` → 布局失效；再叠 `.14s linear`，过渡永远追不上滚动，滚完还要再爬 140ms 才停。

## Target

宽度写死 100%，进度用 `transform: scaleX()` 表达；变量改写在**进度条元素自身**上，不再跨层。

```css
/* target */
.reading-md-outline-progress::after {
  content:''; position:absolute; top:0; bottom:0; left:0;
  width:100%;                    /* 尺寸固定，进度用 transform 表达 */
  transform: scaleX(var(--outline-progress, 0));
  transform-origin: left center;
  border-radius:0 2px 2px 0;
  background:linear-gradient(90deg,…);   /* 保持原渐变 */
  transition: transform .14s linear;     /* linear 是对的：进度条属持续量，AUDIT 明确 linear */
}
```
```js
/* app-reading.js:464 —— target：写到进度条元素自身，而不是祖先节点 */
  outline.style.setProperty('--outline-progress', ratio.toFixed(4));
  const bar = outline.querySelector('.reading-md-outline-progress');
  if (bar) bar.style.setProperty('--outline-progress', ratio.toFixed(4));
```

（若 `.reading-md-outline-progress` 是伪元素宿主、无法直接设变量，就把变量设到该宿主元素上 —— 关键是**它自己**消费，而不是祖先。）

## Repo conventions to follow

- 进度/持续量用 `linear`（AUDIT §2：constant motion → linear），本条保留 `.14s linear` 不变，只换属性。
- 用 transform 表达比例的既有范例：`masscode-runner/assets/motion.css:268-283`（tab 下划线 `scaleX`）。

## Steps

1. `app.css:1468`：把 `width:calc(var(--outline-progress,0) * 100%)` 换成 `width:100%` + `transform:scaleX(var(--outline-progress,0))` + `transform-origin:left center`，过渡改为 `transition: transform .14s linear`。
2. `app-reading.js:464`：把变量同时写到 `.reading-md-outline-progress` 元素上（见 Target 代码）。
3. 确认没有别处读 `--outline-progress`：`grep -rn "outline-progress" masscode-runner/assets` 应只剩这两处。

## Boundaries

- 不要改 `.14s linear` 的时长与曲线（进度条就应该是线性的）。
- 不要改进度条高度、圆角、渐变配色。
- 不要动 `app.css:1566` 那条 `prefers-reduced-motion` 里对 `.reading-md-outline-progress::after` 的 `transition:none` —— 它仍需覆盖新属性。
- 不要引入新的 JS 计时器或 rAF 循环；现有滚动处理已在 rAF 内。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`；`node tests/undefined-refs.js`。
- **Feel check**：慢慢滚动一篇长文档：
  - 进度条**紧跟**滚动，松手瞬间停住（不再有 140ms 追赶）；
  - DevTools Performance 录制滚动 2 秒：Layout 次数应显著下降（旧写法每帧一次 calc 引起的布局失效）；
  - 直接跳到文末，确认进度条到达 100% 且不溢出圆角。
- **Done when**：滚动时 Performance 面板不再出现逐帧 Layout，且进度条不再有"滞后感"。
