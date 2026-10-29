# 013 — 局域网地址 chip 的按下不再瞬跳

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: LOW
- **Category**: 3. Physicality & origin
- **Estimated scope**: 1 文件（`ui-kit.css`）1 行

## Problem

顶栏的局域网地址 chip 是 `<span class="pill">`（`index.html:797`），不是 `button`，所以全站按钮那两条过渡层都碰不到它；它自己的过渡列表里**没有 `transform`**，于是 `:active` 的 1px 下沉是**零时长瞬跳**，松手也瞬跳。

```css
/* masscode-runner/assets/ui-kit.css:318-329 —— 现状 */
  #cs-lan-chip { … transition: background .13s, color .13s; }
  #cs-lan-chip:hover { background: rgba(60, 170, 110, .22); color: #a8f0c8; }
  #cs-lan-chip:active { transform: translateY(1px); }
```

`motion.css:417` 那条 `#status, .pill { transition: background-color, color }` 也救不了：`.pill` 是 (0,1,0)，压不过 `#cs-lan-chip` 的 (1,0,0)。

这是本仓库**已诊断并修好过**的同一模式：`motion-cg.css:98-106` 的注释写明"transform 不在过渡列表里 ⇒ 瞬跳"，只是这一处漏了。

## Target

```css
/* target */
  #cs-lan-chip {
    …
    transition: background var(--mo-1) var(--mo-out),
                color var(--mo-1) var(--mo-out),
                transform var(--mo-1) var(--mo-out);
  }
  #cs-lan-chip:active { transform: translateY(1px) scale(var(--mo-press)); }
```

## Repo conventions to follow

- 令牌：`--mo-1:120ms`、`--mo-out`、`--mo-press:.985`（`masscode-runner/assets/motion.css:41-51`）。
- 同一问题已修好的范例：`masscode-runner/assets/motion-cg.css:98-106`（把 `transform` 加进过渡列表）。
- 注意 `.13s` 不在四档令牌里，本次一并收进 `--mo-1`。

## Steps

1. `ui-kit.css:320`：把 `transition: background .13s, color .13s;` 换成 Target 里的三属性版本。
2. `ui-kit.css:329`：把 `:active` 的 `transform: translateY(1px)` 补成 `translateY(1px) scale(var(--mo-press))`。
3. `grep -n "cs-lan-chip" masscode-runner/assets/*.css` 确认没有更晚加载的规则再次覆盖 `transition`（若有，按同样写法合并，不要新增第二条 `transition`）。

## Boundaries

- 不要改 `#cs-lan-chip` 的颜色、尺寸、`:hover` 取值。
- 不要改它的 `position` / `display`。
- 不要给它加过冲曲线（`--mo-back`）。
- 不要顺手改 `.pill` 的全局规则（会影响其它 chip）。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`ui-kit.css` 若有棘轮需同步）。
- `grep -n "translateY(1px)" masscode-runner/assets/ui-kit.css` 应命中新写法。
- **Feel check**：把 playback 调到 10%，按住顶栏的局域网地址 chip 不放：
  - 它有**可见的下沉过程**（不是瞬间跳下去）；松手时**平滑弹回**；
  - 与旁边 `button`（例如「主题」）的按下手感一致。
- **Done when**：按下与松手都有过渡，手感与相邻按钮无差别。
