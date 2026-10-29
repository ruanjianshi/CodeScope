# 009 — 四处「凭 display 硬切」的浮层补上入场

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: MEDIUM
- **Category**: 8. Missed opportunities
- **Estimated scope**: 1 文件（`app.css`）主要改动 + 可能 1 处 JS 加类，约 40 行

## Problem

四个界面元素靠 `display` 开关瞬间出现/消失，没有任何过渡。同仓库的右键菜单**已经**有 `@starting-style` + `scale(.96)`，机制是现成的、只是没推广 —— 所以这是「不一致」，不是风格偏好。

```css
/* ① 欢迎工作台：14 张卡片瞬间出现/消失（masscode-runner/assets/app.css:3770） */
    #workspace-welcome[hidden] { display:none; }

/* ② 主题菜单（app.css:3394） */
    #theme-menu.hidden { display:none; }

/* ③ 系统详情浮层：460px 宽、十余行（app.css:28-29） */
    #sysmon-detail { display:none; position:absolute; z-index:260; right:0; top:40px; width:460px; … }
    #sysmon-detail.open { display:block; }

/* ④ 错误提示：瞬时插入，还会把右侧两个按钮推开（app.css:2049-2050） */
    #nav-notice { display:none; … }
    #nav-notice.error { display:inline-flex; … }
```

④ 的额外问题：`#nav-notice` 在 DOM 里夹在 `#btn-edit`（`index.html:490`）与 `#autosave-hint`（`:492`）之间，一出现就把右边按钮横向推开，2.6 秒后再弹回（`app.js:8205` 写 `display='inline-flex'`）。

## Target

统一用本仓库已接受的 `@starting-style` 机制（见 `motion.css:314-338`），按「出现的来源」决定位移与原点。

```css
/* target —— ①②③ 三个浮层共用一组入场 */

/* ② 主题菜单：从触发按钮下方长出（trigger 在上方，right:0 对齐） */
@supports (transition-behavior: allow-discrete) {
  #theme-menu {
    transform-origin: 100% 0%;
    opacity: 1; transform: none;
    transition: opacity var(--mo-1) var(--mo-out), transform var(--mo-1) var(--mo-out);
  }
  @starting-style {
    #theme-menu:not(.hidden) { opacity: 0; transform: translateY(-4px) scale(.96); }
  }
}

/* ③ 系统详情：从顶栏那颗 CPU 按钮向下展开（right:0 对齐，向下） */
@supports (transition-behavior: allow-discrete) {
  #sysmon-detail {
    transform-origin: 100% 0%;
    opacity: 1; transform: none;
    transition: opacity var(--mo-1) var(--mo-out), transform var(--mo-2) var(--mo-out);
  }
  @starting-style {
    #sysmon-detail.open { opacity: 0; transform: translateY(-4px) scale(.98); }
  }
}

/* ① 欢迎工作台：整块淡入 + 轻微上移（它占满主区，不做缩放） */
@supports (transition-behavior: allow-discrete) {
  #workspace-welcome {
    opacity: 1; transform: none;
    transition: opacity var(--mo-3) var(--mo-out), transform var(--mo-3) var(--mo-out);
  }
  @starting-style {
    #workspace-welcome:not([hidden]) { opacity: 0; transform: translateY(6px); }
  }
}
```

卡片本身再加一层 30–80ms 的 stagger（只在前 8 张，避免长列表变慢）：

```css
#workspace-welcome:not([hidden]) .welcome-card { animation: mo-stagger-in var(--mo-3) var(--mo-out) both; }
#workspace-welcome:not([hidden]) .welcome-card:nth-child(1) { animation-delay: 0ms; }
#workspace-welcome:not([hidden]) .welcome-card:nth-child(2) { animation-delay: 40ms; }
/* … 依次 40ms 递增到第 8 张（280ms）；第 9 张起不再延迟 */
```

④ 错误提示改为**不占布局**的浮层，从右侧滑入：

```css
#nav-notice {
  position: absolute;          /* 不再挤动相邻按钮 */
  right: 0; top: 50%;
  transform: translate(6px, -50%);
  opacity: 0; pointer-events: none;
  transition: opacity var(--mo-2) var(--mo-out), transform var(--mo-2) var(--mo-out);
}
#nav-notice.error { display: inline-flex; opacity: 1; transform: translate(0, -50%); pointer-events: auto; }
```

（`#nav-notice` 的父容器需要 `position: relative`；执行时先确认它所在的顶栏行是否可以承接绝对定位，若不行则改用 `max-width` 从 0 展开 + `overflow:hidden`，但那会把按钮推移回来 —— 两者取舍见 Boundaries。）

## Repo conventions to follow

- `@starting-style` 的现成范例（照抄结构）：`masscode-runner/assets/motion.css:314-338`。
- stagger 类：`masscode-runner/assets/motion.css:471`（`.mo-stagger`）与 `motion.js:47-49`（`STAGGER_STEP` / `STAGGER_MAX`）—— 卡片这里用纯 CSS 的 `nth-child` 延迟，不引入 JS。
- 「4px 是最小可感知位移」的既有论证：`motion.css:314-338` 的注释。

## Steps

1. `app.css`：为 `#theme-menu` 加入场（Target 第 1 段），保留原有 `#theme-menu.hidden{display:none}` 不动。
2. `app.css`：为 `#sysmon-detail` 加入场（Target 第 2 段）。
3. `app.css`：为 `#workspace-welcome` 加入场 + 前 8 张卡片的 stagger（Target 第 3 段）。
4. `app.css`：把 `#nav-notice` 改为绝对定位浮层（Target 第 4 段）；确认父元素 `position`。
5. 用 DevTools 的 Rendering → `prefers-reduced-motion: reduce` 复核：四处只应保留透明度变化，位移应被 `app.css:3817` 的全局降级压掉（它会同时把 `@starting-style` 的过渡压到 .01ms，等于瞬显 —— 这是已知的全局降级行为，不改）。

## Boundaries

- 不要改这四个元素的任何 `z-index`、尺寸、内边距、滚动行为。
- 不要动 `app.js` 里控制它们的开关逻辑（本计划尽量纯 CSS；若 ④ 必须加类/改父级定位，只允许最小的那一处）。
- `#workspace-welcome` **不要**加缩放（它占满主区，缩放会露出背景）。
- 如果 ④ 的绝对定位会导致提示遮挡顶栏其它按钮（因为不再挤开它们），**停下来报告**并给出两个选项（绝对定位遮挡 vs 保留挤动但加过渡），不要自行决定。
- 不要给这四个元素加过冲曲线。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`app.css` 有棘轮，行数增加需同步上调）；`node tests/browser-smoke.js` 应保持通过（其中「命令面板关闭按钮」「主题菜单」等断言会走到这些元素）。
- **Feel check**：把 playback 调到 10%：
  - 点顶栏主题按钮 → 菜单从按钮下方"落下"并轻微放大，不是闪现；
  - 点 CPU 徽标 → 460px 详情从顶栏下滑展开；
  - 关掉所有片段 → 欢迎台整体淡入，14 张卡**逐张**出现（前 8 张有节奏，后面不再延迟）；
  - 触发一次保存错误 → 提示从右侧滑入且**右侧按钮不移动**。
- **Done when**：四处都不再是"瞬间出现/消失"，且没有任何一处因为入场而导致布局跳动。
