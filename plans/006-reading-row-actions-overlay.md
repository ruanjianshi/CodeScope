# 006 — 阅读树行动作条改为浮层，不再动画 max-width/margin

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: MEDIUM
- **Category**: 5. Performance
- **Estimated scope**: 1 文件（`app.css`），约 10 行

## Problem

阅读/知识库的树行，悬停时右侧会"长出来"三个操作按钮。为了腾出空间，它动画了 `max-width` 和 `margin-left` —— **两个布局属性**，而且触发它的是树行悬停（高频）。

```css
/* masscode-runner/assets/app.css:3644-3651 —— 现状 */
.reading-row-actions {
  display:flex; align-items:center; gap:2px; flex:none; max-width:0; margin-left:-3px;
  opacity:0; visibility:hidden; overflow:hidden; transform:translateX(4px);
  transition:max-width .16s ease,margin .16s ease,opacity .12s ease,transform .16s ease,visibility .12s;
}
.reading-folder:hover>.reading-row-actions,.reading-folder:focus-within>.reading-row-actions {
  max-width:116px; margin-left:1px; opacity:1; visibility:visible; overflow:visible; transform:none;
}
```

注意它**本来就有一条正确的位移写法**（`transform: translateX(4px) → none`）—— 也就是说位移部分已经做对了，`max-width`/`margin` 只是为了"腾空间"而把整行拖进 layout。全仓仅此一处对 `max-width` 做过渡，属于孤立补丁。

## Target

按钮改为**绝对定位浮层**，完全不占布局；只有 `opacity` + `transform` 参与过渡。

```css
/* target */
.reading-folder { position: relative; }          /* 若已有 position 声明则跳过此步 */

.reading-row-actions {
  position: absolute; right: 4px; top: 50%;
  display: flex; align-items: center; gap: 2px; flex: none;
  padding-left: 10px;                            /* 渐变遮罩需要的横向余量 */
  background: linear-gradient(90deg, transparent, var(--panel) 26%);
  border-radius: 6px;
  opacity: 0; visibility: hidden;
  transform: translate(4px, -50%);
  transition: opacity var(--mo-1) var(--mo-out),
              transform var(--mo-2) var(--mo-out),
              visibility 0s var(--mo-1);         /* 隐藏延迟到淡出结束后，避免消失瞬间截断 */
}
.reading-folder:hover > .reading-row-actions,
.reading-folder:focus-within > .reading-row-actions {
  opacity: 1; visibility: visible;
  transform: translate(0, -50%);
  transition: opacity var(--mo-1) var(--mo-out),
              transform var(--mo-2) var(--mo-out),
              visibility 0s;
}
```

## Repo conventions to follow

- 时长/曲线令牌：`masscode-runner/assets/motion.css:41-48`。
- "浮层不占布局"的同类既有做法：`masscode-runner/assets/motion.css:314-338` 的 `.ctx-menu`（`position:fixed` + `@starting-style`）。
- 树行本身的悬停样式在 `app.css` 同一区块（:3652 之后），保持相邻放置。

## Steps

1. 检查 `.reading-folder` 当前是否已有非 `static` 的 `position`（`grep -n "reading-folder" assets/app.css`）。没有则加 `position: relative`。
2. 按 Target 替换 `.reading-row-actions` 与它的悬停规则。
3. 确认行内文字不会被三个按钮永久遮挡到"读不出来"：如果行文本很长且右侧必须可读，把渐变遮罩的 `--panel` 换成该行实际的悬停底色变量。

## Boundaries

- 不要改 `.reading-folder` 的行高、内边距、展开/收起行为。
- 不要给按钮加 `will-change`。
- 不要动 `visibility` 之外的其他显隐机制（不要引入 `display:none`，它会让过渡失效）。
- 如果 `.reading-row-actions` 在 JS 里被读取 `offsetWidth` 用于布局计算（`grep -rn "reading-row-actions" assets/*.js`），先报告 —— 绝对定位会让这类测量变成 0。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`app.css` 有棘轮，行数增减需同步）；`node tests/browser-smoke.js` 里覆盖阅读树的那段应仍然通过。
- `grep -n "max-width .16s" masscode-runner/assets/app.css` 应返回 0 处。
- **Feel check**：把 playback 调到 10%，鼠标沿左侧阅读树自上而下一行行扫过：
  - 按钮**淡入并轻微右移归位**，右侧行文本**不发生任何横向位移**；
  - DevTools Performance 录制扫过过程：**不应出现 Layout**；
  - 快速来回移动 10 次，确认按钮不会残留、不会闪两次。
- **Done when**：悬停阅读树行时，行内其余元素的位置**逐像素不动**。
