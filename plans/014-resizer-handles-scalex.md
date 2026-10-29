# 014 — 分隔条手柄改用 scaleX 揭示，不再动画 width

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: LOW
- **Category**: 5. Performance
- **Estimated scope**: 1 文件（`app.css`）2 处，约 8 行

## Problem

拖动分隔条时，手柄（`::after`，1px 竖线）在 hover/active/dragging 时把宽度变成 2px，并对 `width` 做过渡 —— **拖动过程中真的在重排**（不是理论问题：拖拽期间该元素处于 `.dragging` 状态）。

```css
/* masscode-runner/assets/app.css:3962-3966 —— 现状（基态：宽 1px） */
  html[data-theme] #reading-fragments-resizer::after,
  html[data-theme] #xmind-outline-resizer::after,
  html[data-theme] #remote-resizer::after {
    content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; height: auto;
    transform: translateX(-50%); border-radius:2px; background: var(--ui-divider);
    transition: width .14s ease, background .14s ease, box-shadow .14s ease;
  }
/* :3974-3983 —— 悬停/拖动时宽 2px */
  … #remote-resizer:hover::after,
  … #remote-resizer.active::after {
    width: 2px; background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
  }
```

注意它**已经在用** `transform: translateX(-50%)` 做居中 —— 只要把"变宽"也并入 transform 即可。

## Target

宽度固定 1px，用 `scaleX(2)` 揭示：

```css
/* target 基态 */
  html[data-theme] #reading-fragments-resizer::after,
  html[data-theme] #xmind-outline-resizer::after,
  html[data-theme] #remote-resizer::after {
    content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; height: auto;
    transform: translateX(-50%) scaleX(1);
    border-radius: 2px; background: var(--ui-divider);
    transition: transform var(--mo-1) var(--mo-out),
                background var(--mo-1) var(--mo-out),
                box-shadow var(--mo-1) var(--mo-out);
  }

/* target 悬停/拖动 */
  … #remote-resizer:hover::after,
  … #remote-resizer.active::after {
    transform: translateX(-50%) scaleX(2);
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
  }
```

⚠️ `scaleX(2)` 会把 2px 圆角横向拉伸成视觉椭圆。若不接受这个副作用，替代方案是让基态宽度就是 2px 而用 `scaleX(.5)` 起步 —— 但那样光标命中区可能变化，**必须真机确认**（见 Verification）。

## Repo conventions to follow

- 令牌：`--mo-1:120ms` / `--mo-out`（`masscode-runner/assets/motion.css:41-48`）。
- 同类"用 scaleX 而不是改宽度"的范例：`masscode-runner/assets/motion.css:268-283`（tab 下划线）。
- 原 `.14s ease` 不在四档令牌内，本次收进 `--mo-1`。

## Steps

1. `app.css:3963`：`transform: translateX(-50%)` → `transform: translateX(-50%) scaleX(1)`。
2. `app.css:3965`：过渡列表改成 `transform/background/box-shadow` + `var(--mo-1) var(--mo-out)`。
3. `app.css:3981`：`width: 2px` 删掉，改为 `transform: translateX(-50%) scaleX(2)`。
4. 同文件里**横向**分隔条（`.hsplit` / `#split-h` / `.pane-resizer` 等，`:3984` 之后）若有同样写法，按 `scaleY` 同构处理 —— 先 `grep -n "height: 2px" assets/app.css` 列清单。

## Boundaries

- 不要改分隔条的命中区宽度（`::after` 之外的 `padding`/`width` 容器不要动）。
- 不要改 `left: 50%` / `translateX(-50%)` 的居中方式。
- 不要动拖动逻辑（`.dragging` 类由 JS 加，本计划不改 JS）。
- 若 `scaleX(2)` 让圆角明显变形且不可接受，**停下来报告**并给出替代方案，不要自行改成基态 2px（会改变命中区）。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`app.css` 棘轮需同步）；`node tests/browser-smoke.js` 中覆盖分隔条的断言应通过。
- `grep -n "transition: width .14s" masscode-runner/assets/app.css` 应返回 0 处。
- **Feel check**：把 playback 调到 10%：
  - 鼠标移到分隔条上：1px 线**变粗为 2px 并向两侧均等扩张**，颜色变强调色；
  - 拖动时保持 2px 不跳变；
  - DevTools Performance 录制一次拖动：**不应出现 Layout**（旧写法每帧一次）；
  - 放大截图检查 2px 线的两端圆角是否仍圆（`scaleX(2)` 会把 1px 圆角拉成椭圆）。
- **Done when**：拖动过程 Performance 无 Layout，且手柄端头圆角在视觉上可接受。
