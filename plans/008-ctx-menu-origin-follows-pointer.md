# 008 — 右键菜单从「点击的那一点」长出来，而不是从中轴线张开

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: MEDIUM
- **Category**: 3. Physicality & origin
- **Estimated scope**: 2 文件（`app.js` 约 8 行 + `motion.css` 1 行注释），约 10 行

## Problem

右键菜单按**指针坐标**定位并做双向夹取，但缩放原点写死成自身顶边中点。于是它是"从自己的中轴线张开"，而不是"从我按住的那一点弹出来"。

```css
/* masscode-runner/assets/motion.css:314-338 —— 现状 */
@supports (transition-behavior: allow-discrete) {
  .ctx-menu {
    opacity: 1;
    transform: none;
    transform-origin: center top;   /* 从菜单顶部（鼠标点下去的那侧）长出来 */
    transition:
      opacity var(--mo-1) var(--mo-out),
      transform var(--mo-1) var(--mo-out);
  }
  @starting-style {
    .ctx-menu:not([hidden]) {
      opacity: 0;
      transform: translateY(4px) scale(.96);
    }
  }
}
```
```js
/* masscode-runner/assets/app.js:930-931 —— 现状：按指针坐标并双向夹取 */
  menu.style.left = Math.max(pad, Math.min(event.clientX, innerWidth - box.width - pad)) + 'px';
  /* top 同式夹取 */
```

三种情况都不对：默认（未被夹取）时菜单左上角就落在光标上，应从 `0% 0%` 长起；被右边界夹住时应从 `100% 0%`；被下边界夹住时应从 `50% 100%`。而且 `@starting-style` 的 `translateY(4px)` 恒向下，被夹到底部时菜单实际向上展开，起始位移方向与展开方向相反。

全仓没有任何 JS 改写这个原点（`transformOrigin` 只在 `motion.js:222` 给标签指示条设 `0 50%`、`life-workbench.js:1869` 设 `0 0`），所以它是纯 CSS 写死的。

## Target

由 JS 按「菜单相对指针落在哪个方向」决定原点，CSS 只读变量。

```js
/* app.js：紧接 left/top 的夹取之后 */
  const ox = menu.style.left === event.clientX + 'px' ? '0%' : '100%';   // 未被右夹 ⇒ 从左缘长
  const oy = menu.style.top === event.clientY + 'px' ? '0%' : '100%';    // 未被下夹 ⇒ 从上缘长
  menu.style.transformOrigin = ox + ' ' + oy;
```

（实现提示：更稳的写法是**在夹取前先算出目标矩形**，用 `clampedLeft === event.clientX` 判断是否被夹，而不是比较字符串。执行者应按实际变量名改写，但判据不变：被右边界夹 ⇒ `x=100%`，被下边界夹 ⇒ `y=100%`。）

```css
/* motion.css:321 —— target */
    transform-origin: var(--ctx-origin, 0% 0%); /* 由 app.js 按指针与夹取结果设置，见其注释 */
```

## Repo conventions to follow

- `--mo-1` / `--mo-out` 已在该规则里使用，保持不变（右键菜单是用户主动动作，120ms 合适）。
- 用 CSS 变量传递几何信息的先例：`masscode-runner/assets/app.css:1468`（`--outline-progress`）与 `motion.js:222`（指示条 `0 50%`）。
- 产品规则①：`.ctx-menu` 目前**不用**过冲曲线，这是对的（菜单是列表，不是按钮），不要顺手加 `--mo-back`。

## Steps

1. `app.js`：在 `menu.style.left/top` 赋值之后，按 Target 计算并写入 `menu.style.transformOrigin`。
2. 同时处理 `@starting-style` 的位移方向：被下边界夹住时起始位移应为 `translateY(-4px)`。做法：在 JS 里同时设 `menu.style.setProperty('--ctx-start-y', clamped ? '-4px' : '4px')`，CSS 侧把 `translateY(4px)` 改成 `translateY(var(--ctx-start-y, 4px))`。
3. `motion.css:321`：把 `transform-origin: center top;` 改成 `transform-origin: var(--ctx-origin, 0% 0%);`，并把注释改成说明「由 app.js 按指针与夹取结果设置」。

## Boundaries

- 不要给菜单加回弹（`--mo-back`）。
- 不要改 `.ctx-menu` 的尺寸、内边距、`z-index`、`position:fixed`。
- 不要改菜单的定位夹取逻辑本身（`Math.max`/`Math.min` 的边界值）。
- 对话框（`motion.css:356-383`，`scale(.98)` 居中）**不是本计划范围** —— 按审计手册，模态居中缩放是正确的。
- 若 `app.js` 里存在**多个**右键菜单入口（例如树、标签、编辑器各自一套），全部都要接上，先 `grep -n "ctx-menu" assets/app.js` 列出清单再动手。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`app.js` 棘轮 **12,995 行代码** —— 本计划 +5~8 行会顶破，必须按仓库规矩如实上调并在注释里写明理由）；`node tests/undefined-refs.js`；`node tests/browser-smoke.js` 中覆盖右键菜单的那三条断言应仍然通过。
- **Feel check**：把 playback 调到 10%：
  - 在**左上区域**右键：菜单从左上角向右下展开；
  - 在**右下区域**右键（会被夹取）：菜单从右下角向左上展开，且起始位移方向与展开方向一致；
  - 在**右下角极限位置**右键：菜单不超出视口。
- **Done when**：在上述三个区域右键，菜单的缩放原点都指向鼠标按下点所在的那个角。
