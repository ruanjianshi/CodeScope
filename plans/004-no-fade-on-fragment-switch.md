# 004 — 切片段时编辑区不再整块淡入

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: HIGH
- **Category**: 1. Purpose & frequency
- **Estimated scope**: 1 文件（`motion.js`），约 3 行

## Problem

切片段（每天上百次）**每次**都会让代码编辑区跑一遍 260ms 淡入。这是审计手册明确规定的「100+ 次/天 → 永远不要动画」类别。

```css
/* masscode-runner/assets/motion.css:469-470 —— 现状 */
.mo-enter { animation: mo-enter var(--mo-3) var(--mo-out) both; }
#code-wrap.mo-enter { animation-name: mo-enter-fade; }
```
```js
/* masscode-runner/assets/motion.js:38-41 —— PANEL_IDS 含 code-wrap */
  var PANEL_IDS = [
    'pane-tree', 'pane-git', 'pane-tags', 'pane-draw', 'pane-office', 'pane-reading',
    'output', 'outline-panel', 'code-wrap', 'tagbar', 'attached-pane', 'tabs-row'
  ];
```

**实测证据**（Playwright 只读观察，切了 3 次片段）：`#code-wrap` 的 class 从 `editor-column monaco-active` 出发，期间被加上 `mo-enter` 再摘掉（`sawMoEnter: true`），即淡入**真的在跑**。

代价：`animation-fill-mode: both` 让它在 260ms 内从 `opacity:0` 起，也就是**内容一开始是不可见的**。切片段时用户正等着看代码，这 260ms 是纯等待。

## Target

把 `#code-wrap` 从 `PANEL_IDS` 里移出，并在 `motion.css` 里保留那条 `#code-wrap.mo-enter` 说明它为何被排除（不要删，防止后人加回去）。

```js
/* motion.js:38-41 —— target */
  var PANEL_IDS = [
    'pane-tree', 'pane-git', 'pane-tags', 'pane-draw', 'pane-office', 'pane-reading',
    'output', 'outline-panel', 'tagbar', 'attached-pane', 'tabs-row'
    /* ⚠️ #code-wrap 故意不在列表里（2026-10-28）：切片段是每天上百次的动作，
       给它加 260ms 淡入等于每次都让用户等 260ms 才看见代码。
       它内部是 Monaco，内容切换本身看不出"跳"，不需要淡入来掩盖。 */
  ];
```
```css
/* motion.css:470 —— 保留规则但补注释（不删，删了后人会重新加） */
/* 留作显式退出记录：#code-wrap 不走 .mo-enter（见 motion.js PANEL_IDS 注释）。 */
#code-wrap.mo-enter { animation-name: mo-enter-fade; }
```

## Repo conventions to follow

- 面板入场统一走 `motion.js` 的 `PANEL_IDS` + `.mo-enter`，不要在各处手写 `animation`。
- 「高频动作不做动画」的既有表述：`masscode-runner/assets/motion.js:47-49`（stagger 的 MAX 截断正是为了不让长列表变慢）。

## Steps

1. `motion.js`：从 `PANEL_IDS` 数组中删除 `'code-wrap'`，并按 Target 补注释。
2. `motion.css:469-470`：按 Target 补一行「留作显式退出记录」的注释。
3. `grep -n "code-wrap" masscode-runner/assets/motion.js` 确认只剩注释命中，没有其它逻辑依赖它进入 `PANEL_IDS`。

## Boundaries

- **不要**顺手把 `#code-wrap` 的入场改成"更短的淡入"（例如 120ms）—— 本计划是**移除**，不是调参；若产品上确实需要过渡，另开计划。
- 不要动其它 `PANEL_IDS` 成员（`pane-reading` 等是低频面板，260ms 入场是对的）。
- 不要动 `.mo-stagger`。
- 不要改 `motion.css:447-452` 里 `mo-enter-fade` 的 keyframes 定义本身。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`motion.js` 棘轮 362 行代码 —— 删除 1 行、增加 3 行注释，需确认未顶破，超了就如实上调）。
- **Feel check**：连续点 10 次不同的片段标签：
  - **第一帧就能读到新片段的第一行代码**（不再有淡入）；
  - 反复切同一个片段也不会闪；
  - 对照实验：临时把 `'code-wrap'` 加回 `PANEL_IDS`，确认"加回后有淡入、移除后没有"—— 证明改对了地方。
- **Done when**：切片段时 `#code-wrap` 的 class 变化里**不再出现** `mo-enter`（用 DevTools 的 Break on attribute modification 或本会话里那段 Playwright 探针验证）。
