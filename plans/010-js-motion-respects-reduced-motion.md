# 010 — JS 驱动的位移尊重 prefers-reduced-motion

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: MEDIUM
- **Category**: 6. Accessibility
- **Estimated scope**: 1 文件（`app.js`）3 处，约 15 行

## Problem

CSS 侧的降级做得很完整（每个 `motion-*.css` 都有自己的 `@media (prefers-reduced-motion:reduce)` 段），但**JS 驱动的位移完全不看这个偏好**。

全仓 11 处 `prefers-reduced-motion` 命中**全是注入的 CSS 字符串**（`motion.js:78`、`life-workbench.js:99/172/992/1002`、`system-panel.js:509/1046`），`matchMedia('(prefers-reduced-motion: reduce)')` 在 `app.js` / `motion.js` / `life-workbench.js` 里**各 0 处**。

三类位移照跑：

```js
/* ① masscode-runner/assets/app.js:14213 */
$('welcome-reading').onclick = () => {
  const head = $('reading-head');
  if (!READING_OPEN) head.click();
  head.scrollIntoView({ behavior:'smooth', block:'center' });
};

/* ② masscode-runner/assets/app.js:9240 */
      try { tabs.scrollBy({ left: dir * Math.max(160, tabs.clientWidth * 0.8), behavior: 'smooth' }); } catch (_) {}

/* ③ masscode-runner/assets/app.js:6492 —— d3 相机位移 */
      svg.transition().duration(420).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
```

`app.css:3817` 的全局降级（`transition-duration:.01ms !important` + `scroll-behavior:auto !important`）**管不到**这三种：`scrollIntoView`/`scrollBy` 的 `behavior` 选项按规范显式覆盖 CSS `scroll-behavior`，而 d3 transition 是 JS 逐帧改 `transform`，与 CSS 动画无关。

对前庭敏感用户，420ms 的整块画布缩放平移正是最难受的那类运动。

## Target

引入一个只读判据函数，三处位移分支化。

```js
/* app.js —— 放在文件顶部工具函数区（与 $ / api 同级） */
/* 系统级「减少动态效果」偏好。只读，不缓存结果的反面：用户可能在系统设置里改。 */
function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}
```

```js
/* ① app.js:14213 —— target */
  head.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });

/* ② app.js:9240 —— target */
  try {
    tabs.scrollBy({ left: dir * Math.max(160, tabs.clientWidth * 0.8),
                    behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } catch (_) {}

/* ③ app.js:6492 —— target：降级模式下直接跳到目标，不要 420ms 相机位移 */
  if (prefersReducedMotion()) {
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  } else {
    svg.transition().duration(420).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }
```

## Repo conventions to follow

- 「减少动效时减少**运动**、保留**反馈**」：`masscode-runner/assets/motion.css:477-500` 的降级段只压位移，颜色/透明度反馈保留。
- 容错式读取浏览器能力：本仓库大量使用 `try { … } catch (_) {}` 包裹（如 `app.js:9240` 自身），照此风格。

## Steps

1. `app.js`：在工具函数区新增 `prefersReducedMotion()`（Target 第 1 段）。
2. `app.js:14213`：按 Target ① 改。
3. `app.js:9240`：按 Target ② 改。
4. `app.js:6492`：按 Target ③ 改（分支化，别删 `duration(420)` 的正常路径）。
5. `grep -n "behavior[: ]*'smooth'\|behavior: \"smooth\"" assets/app.js` 复核：**不应再有**不带判断的 `smooth`（若有第四处，一并按同一模式改）。

## Boundaries

- 不要把这个判据用到「非位移」的地方（例如不要因为 reduced-motion 就跳过滚动本身）。
- 不要删除 `duration(420)` 的正常分支，也不要把 420 改成别的值。
- 不要缓存 `matchMedia(...).matches` 到模块级常量（用户可能中途改系统设置；每次调用开销可忽略）。
- 不要动 `app.css:3817` 的全局降级段（它是有意的既有决策，见 `motion.css:479` 注释）。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`app.js` 棘轮 **12,995 行代码** —— 本次约 +12 行，**会顶破**，必须如实上调并在注释里写明理由：新增 a11y 分支）；`node tests/undefined-refs.js`；`node tests/browser-smoke.js`。
- **Feel check**：开系统「减少动态效果」（或 DevTools → Rendering → emulate `prefers-reduced-motion: reduce`）：
  - 点「欢迎页 → 阅读」的跳转：**瞬间定位**，无平滑滚动；
  - 点标签栏左右滚动箭头：瞬间滚动；
  - 在逻辑图里触发「适应视图」：**瞬间到位**，无 420ms 相机运动；
  - 关掉该偏好后三处**恢复**平滑行为。
- **Done when**：上述四个检查在「开/关」两种系统偏好下分别表现正确。
