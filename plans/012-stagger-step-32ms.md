# 012 — stagger 间隔 22ms → 32ms，让"逐项"读得出来

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: LOW
- **Category**: 7. Cohesion & tokens
- **Estimated scope**: 1 文件（`motion.js`）1 行

## Problem

列表逐项入场的间隔是 22ms/项，低于审计手册的 30–80ms 区间。12 项 × 22ms = 264ms，而单条动画本身就是 `--mo-3`(260ms) —— **波次总长几乎等于单条动画时长**，首行与末行几乎同时到场，视觉上读不出"逐项"，只剩一层整体淡入。

```js
/* masscode-runner/assets/motion.js:47-49 —— 现状 */
  var STAGGER_MAX = 12;      /* 同一批最多延迟前 12 项 ✓ —— 长列表后面的 immediate
                                （第 13 项等 delay 300ms 会显得应用卡住了 ✗） */
  var STAGGER_STEP = 22;     /* 相邻两项的间隔。12 项 × 22ms = 264ms 正好一屏内走完 ✓ */
```

## Target

```js
/* target */
  var STAGGER_MAX = 12;      /* 同一批最多延迟前 12 项 —— 再往后不延迟，避免"应用卡住"的错觉 */
  var STAGGER_STEP = 32;     /* 相邻两项的间隔。落在 AUDIT §7 的 30–80ms 区间内；
                                12 项 × 32ms = 384ms 波次总长，明显长于单条动画(260ms) ⇒
                                首项到场与末项到场能看出先后。实测 22ms 时总长≈260ms，
                                与单条动画齐平，读不出"逐项"。 */
```

## Repo conventions to follow

- 令牌与时长：`masscode-runner/assets/motion.css:41-49`。
- 长列表保护（截断 + 节流）已在 `motion.js:47-49` 与 `:382-385` 实现，本计划只动间隔值。

## Steps

1. `motion.js:49`：`22` → `32`，并按 Target 更新注释（把"264ms 正好一屏内走完"这句过时的论证替换掉）。
2. 复核 `motion.js:396` 的收尾定时器：`(n - 1) * STAGGER_STEP + cssMs('--mo-3', 240) + 120` —— 它会自动跟着变长（12 项时 352+260+120 ≈ 732ms），确认没有别处的硬编码 500ms 之类与它耦合（`grep -n "500\|720" motion.js`）。

## Boundaries

- 不要改 `STAGGER_MAX`（12）。
- 不要改 `--mo-3` 或 `mo-stagger-in` 的 keyframes。
- 不要把间隔做成按列表长度自适应的算法（超出本计划范围）。
- 如果发现 `clearStagger` 或 `.mo-flash` 的 720ms 定时器与新的 732ms 收尾冲突（两者都摘类），**停下来报告** —— 需要分别确认它们作用在不同类上。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`；`node tests/browser-smoke.js`。
- **Feel check**：把 playback 调到 10%，收起再展开左侧树（10+ 项）：
  - 行**自上而下逐项**出现，能数出先后顺序；
  - 第 13 项起不再延迟；
  - 快速连续开关 3 次，确认没有堆积（1.5s 节流仍在生效）。
- **Done when**：慢放时能明确看出"第一行先、最后一行后"。
