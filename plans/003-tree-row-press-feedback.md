# 003 — 给树行补按下反馈（全站点击最频繁的目标现在按下毫无变化）

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: HIGH
- **Category**: 3. Physicality & origin
- **Estimated scope**: 1 文件（`motion.css`），约 12 行

## Problem

树行（`.item` / `.fnode`）是全站点击最频繁的元素，**悬停反馈很足、按下毫无变化**。过渡列表里早已为 `transform` 留好位置，但全仓没有任何 `:active` 规则去用它 —— 它是一条死声明。

```css
/* masscode-runner/assets/motion.css:206-214 —— 现状 */
.item, .fnode {
  transition:
    background-color var(--mo-2) var(--mo-out),
    border-color var(--mo-2) var(--mo-out),
    box-shadow var(--mo-2) var(--mo-out),
    color var(--mo-2) var(--mo-out),
    opacity var(--mo-2) var(--mo-out),
    transform var(--mo-2) var(--mo-out);
}
```

实测：`grep -E "\.item[^{]*:active|\.fnode[^{]*:active"` 在 `app.css` + 7 个 `motion-*.css` 里**命中 0 条**。唯一被用到的 `transform` 是 `motion.css:224` 的 `.dragging` 倾斜。

而悬停叠加了三处（`app.css:3655` / `:3135` / `:3341`），`app.css:529` 还给了 `#list .item { cursor: grab; }` —— 「抓得起来」的暗示配上「按下去什么都不发生」，手感是断的。

## Target

补一条按下反馈，复用已有令牌（`--mo-press` / `--mo-back`），并**用底色压深作为主反馈、transform 作为辅助**（28~31px 高的行做缩放容易让行内文字抖，见 Boundaries）。

```css
/* motion.css —— 加在 .item/.fnode 规则之后 */
/* 按下反馈：全站点击最频繁的树行，此前按下零变化。
   底色压深是主反馈（不移动文字），transform 只做 1% 的轻微收紧。
   ⚠️ 不用 scale(.97)：行高只有 28~31px，2~3% 缩放会让行内 13px 文字重新栅格化、
      观感是"抖一下"而不是"陷下去"。 */
.item:active, .fnode:active {
  background-color: color-mix(in srgb, var(--accent) 14%, transparent);
  transform: scale(0.99);
  transition-duration: var(--mo-1);
}
```

## Repo conventions to follow

- 令牌定义在 `masscode-runner/assets/motion.css:41-51`：`--mo-1:120ms`、`--mo-press:.985`、`--mo-lift:-1px`。
- 按钮按下反馈的现成范例（照抄这个形状，别另起数值）：`masscode-runner/assets/motion.css` 按钮层 `transform: scale(var(--mo-press))` + `var(--mo-1)`。
- 产品规则①：过冲 `--mo-back` 只用于用户主动动作 —— 按下属于主动动作，但**本计划故意不用过冲**：行是列表项，回弹会让列表"发飘"。

## Steps

1. 在 `motion.css` 中 `.item, .fnode { … }` 规则之后追加上述 `:active` 规则。
2. **选择器必须是 `#list .item:active:not(.dragging):not(.drop-target)`**（`.fnode` 同理）。

   ⚠️ 本计划原文写「(1,2,0) 足够压过任何类选择器」是**错的**（2026-10-28 执行时实测发现）：
   `app.css:3655` 的悬停规则是 `#list .item:hover:not(.dragging):not(.drop-target)`，特异性 **(1,4,0)**；
   而按下时行**必然同时处于 `:hover`** ⇒ (1,2,0) 会被盖掉。后果很隐蔽：
   `transform: scale(.99)` 仍生效（按下确实有变化），但 `background-color` 被盖掉 ——
   也就是「主反馈（底色压深）实际不存在」，而 Done-when 表面上还能通过。
   加上同样两个 `:not()` 后打平 (1,4,0)，靠 `motion.css` 后加载取胜。

3. **必须同时补 `reduced-motion` 段**（`motion.css` §10 里 `transform: none !important` 的那组选择器）：
   把这条 `:active` 加进去。该段既有注释写明「前庭敏感的用户受不了按压缩放，哪怕只有 1px」，
   漏了这条等于给这类用户新引入一处位移。**只取消 `transform`，保留底色变化**（那是状态反馈，不是运动）。

## Boundaries

- **不要**给 `.item`/`.fnode` 用 `scale(.97)` 或更小 —— 行内文字会抖（`motion.css:337` 已对右键菜单行否决过同一做法）。
- 不要动悬停规则、不要改 `cursor`。
- 不要给 `.dragging` 那条倾斜规则加过渡。
- 不要把这个反馈加到 `.tchip`（标签芯片）等其它元素上，本计划只覆盖树行。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`motion.css` 棘轮 264 行代码 —— 本次 +8 行左右，**会顶破上限**，需按仓库规矩如实上调并写明理由）。
- **Feel check**：按住左键不松，在左侧树上从一行拖到另一行：
  - 按下的那一行**先略微陷下去**再开始拖，松手后弹回；
  - 快速连点 5 次同一行，确认不会因为 `:active` ↔ 常态切换而闪烁；
  - 把 playback 调到 10%，确认按下的收紧幅度**几乎看不出位移，但能感觉到**。
- **Done when**：鼠标按下（不松开）时树行外观立即变化，且拖动时文字没有抖动感。
