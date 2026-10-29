# 011 — 面板与列表不再双层淡入（重影）

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: MEDIUM
- **Category**: 7. Cohesion & tokens
- **Estimated scope**: 1 文件（`motion.js`）1 处，约 4 行

## Problem

面板出现时，面板自己跑一层 `.mo-enter` 淡入，**同时**它内部的列表又跑一层逐行 `.mo-stagger` 淡入 —— 两层 `opacity` 相乘，行在前 100ms 是"灰而淡"的中间态。这正是代码注释里说要避免的重影。

```js
/* masscode-runner/assets/motion.js:36-37 —— 设计意图（原文） */
     ⚠️ #list 不在这里：它的显隐由祖先 #pane-tree 决定，加进来会和 #pane-tree
        同时触发一层嵌套淡入（视觉上重影）✗ —— 它归第 3 节的 stagger 负责 ✓。 */
```
```js
/* masscode-runner/assets/motion.js:163-166 —— 但这一行把它重新引入了 */
          if (now && !seen.get(e)) {       /* ★ 只在 不可见 → 可见 的那一次 ✓ */
            markEnter(e, moMs);
            staggerListsInside(e);         /* 列表跟着面板一起出来时也要 stagger ✓ */
```
```js
/* masscode-runner/assets/motion.js:401-409 —— panel.contains(el) 成立就触发 */
  function staggerListsInside(panel) {
    try {
      for (var i = 0; i < LIST_IDS.length; i++) {
        var el = byId(LIST_IDS[i]);
        if (!el) continue;
        if (el === panel || (panel.contains && panel.contains(el))) staggerList(el);
      }
    } catch (_) {}
  }
```

结构事实：`#pane-tree`（`index.html:282`）在 `PANEL_IDS` 里，而 `#list`（`index.html:295`）是它的**子节点**且在 `LIST_IDS` 里；`staggerList()`（`motion.js:375-397`）对子行**无条件**挂 `.mo-stagger`（只受 1.5s 节流）。所以 `#pane-tree` 一出现，两层 opacity 动画必然同时启动。

## Target

面板正在跑入场动画时，**跳过**它内部列表的 stagger —— 让每个内容只淡入一次。

```js
/* motion.js:163-166 —— target */
        if (now && !seen.get(e)) {       /* ★ 只在 不可见 → 可见 的那一次 ✓ */
          markEnter(e, moMs);
          /* ⚠️ 只在面板**本身没在入场**时才让列表 stagger ✗✗（2026-10-28 修）
             面板刚挂上 .mo-enter 时，它内部的行若同时挂 .mo-stagger，
             两层 opacity 相乘 ⇒ 行在前 100ms 呈"灰而淡"的重影（与 :36 的注释矛盾）。
             判据：面板刚 markEnter 过 ⇒ 这批行由面板那一层负责淡入，不再叠第二层。 */
          if (!e.classList.contains('mo-enter')) staggerListsInside(e);
        }
```

（等价实现：保留调用，但在 `staggerListsInside` 内加同样的守卫。二选一，不要两处都加。）

## Repo conventions to follow

- 「同一批内容只淡入一次」的既有防护范例：`masscode-runner/assets/motion.css` 里 `#tabs[data-mo-sliding]` 的写法（滑动期间抑制子元素过渡）。
- 注释体例：改哪一行就在哪一行说明「为什么」，并引用矛盾的那条注释（本计划已按此写）。

## Steps

1. `motion.js:165`：按 Target 加上 `if (!e.classList.contains('mo-enter'))` 守卫。
2. 在 `motion.js:36-37` 那段注释末尾补一句：「本文件 :165 已按此判据加守卫，见该行注释。」
3. 复核 `staggerListsInside` 的其它调用点（`grep -n "staggerListsInside" motion.js`）：若还有别处调用，确认它们不处于面板入场时刻。

## Boundaries

- 不要改 `STAGGER_STEP` / `STAGGER_MAX` / 1.5s 节流（它们是另外的计划）。
- 不要改 `.mo-enter` / `.mo-stagger` 的 keyframes 与时长。
- 不要删除 `staggerListsInside` 这个函数（列表在**面板已可见**时刷新仍需要它，例如 3 秒轮询重建首屏）。
- 不要顺手把 `#list` 加进 `PANEL_IDS`。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`motion.js` 棘轮 362 行代码，本次 +2 行内）；`node tests/browser-smoke.js`。
- **Feel check**：把 playback 调到 10%：
  - 收起左侧树再展开（或切到 git/标签面板再切回）：清单**整块淡入一次**，行不再先"灰而淡"再变实；
  - 面板已可见时触发一次列表重建（例如点「刷新」或等 3 秒轮询）：行**仍应**逐项 stagger（证明守卫只挡住了"面板入场时刻"这一种情况）。
- **Done when**：面板首次出现时，行不出现两次叠加的淡入；而面板已存在时的列表刷新仍有 stagger。
