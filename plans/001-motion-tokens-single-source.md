# 001 — 曲线与时长令牌收敛成唯一真源

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: HIGH
- **Category**: 7. Cohesion & tokens
- **Estimated scope**: 3 文件（`motion.css` / `ui-kit.css` / `motion.js`），约 20 行改动，无逻辑变更

## Problem

同 3 条曲线在这个仓库里有 **4 套命名**，且兜底实现与真源**取值不一致** —— 改一条曲线要动 4 个文件，而且「哪一档更重」根本听不出来。

真源（`masscode-runner/assets/motion.css:41-48`）：

```css
  --mo-1: 120ms;   /* 即时反馈：变色、描边 */
  --mo-2: 180ms;   /* 常规：1px 抬升、按压缩放、阴影 */
  --mo-3: 260ms;   /* 位移 / 展开：下划线生长、面板入场 */
  --mo-4: 400ms;   /* 大块进出：脉冲、一次性提示 */

  --mo-out: cubic-bezier(.2, .8, .2, 1);       /* 平滑减速：默认曲线，99% 场景用它 */
  --mo-back: cubic-bezier(.34, 1.56, .64, 1);  /* 带回弹：**只给人主动的动作** ✓ */
  --mo-in-out: cubic-bezier(.4, 0, .2, 1);     /* 两头都慢：原地性质变化（遮罩淡入） */
```

别名（逐字符相同/等价，纯重复）：

```css
/* masscode-runner/assets/doc-theme.css:72-73 */
  --doc-ease-back:cubic-bezier(.34,1.56,.64,1);   /* == --mo-back      */
  --doc-ease-smooth:cubic-bezier(.4,0,.2,1);      /* == --mo-in-out    */
```
```css
/* masscode-runner/assets/ui-kit.css:52 */
  --cs-fast: 120ms cubic-bezier(.4,0,.2,1);       /* == --mo-1 + --mo-in-out */
```

兜底实现**与真源不一致**（只在 `motion.css` 缺失时才生效，但一旦生效就全站变色）：

```js
/* masscode-runner/assets/motion.js:54-55 */
    ':root{--mo-1:120ms;--mo-2:180ms;--mo-3:240ms;',
    '--mo-ease:cubic-bezier(.22,.61,.36,1);--mo-back:cubic-bezier(.34,1.56,.64,1);}',
```

- `--mo-3` 兜底写 **240ms**，真源是 **260ms**。
- `--mo-ease` 是 `cubic-bezier(.22,.61,.36,1)`，而真源的主力减速度曲线 `--mo-out` 是 `cubic-bezier(.2,.8,.2,1)` —— **两条不同曲线**。`motion.css` 的 `:root` 里从来没有 `--mo-ease` 这个名字。

另外 `--mo-4`（400ms「大块进出／脉冲」档）**零消费**：`grep -rn "var(--mo-4)"` 在全部 css/js 返回 0 处。四档叙事实际只跑三档，而真正的脉冲是手打的：

```css
/* masscode-runner/assets/motion.css:474 */
.mo-flash { animation: mo-status-glow 640ms var(--mo-out) 1; }
```

（640ms 是**有意**的：注释说明它与 `motion.js` 720ms 摘类的约定绑定，见 :472-473。**不要改它的时长**，这条只处理令牌归属。）

## Target

唯一真源留在 `motion.css` 的 `:root`，别名全部改成引用真源；兜底与真源逐值对齐；新增一条抽屉曲线令牌并让 `app.css` 里手抄的 4 处引用它。

```css
/* motion.css :root —— 新增一条（放在 --mo-in-out 之后） */
  --mo-drawer: cubic-bezier(.32, .72, 0, 1); /* iOS 抽屉：拖拽式大块进出，app.css 原本手抄 4 遍 */
```

```css
/* doc-theme.css:72-73 —— 改成别名，不再抄字面量 */
  --doc-ease-back: var(--mo-back);
  --doc-ease-smooth: var(--mo-in-out);
```

```css
/* ui-kit.css:52 —— 改成复合别名 */
  --cs-fast: var(--mo-1) var(--mo-in-out);
```

```js
/* motion.js:54-55 —— 兜底与真源逐值一致 */
    ':root{--mo-1:120ms;--mo-2:180ms;--mo-3:260ms;',
    '--mo-out:cubic-bezier(.2,.8,.2,1);--mo-back:cubic-bezier(.34,1.56,.64,1);--mo-in-out:cubic-bezier(.4,0,.2,1);',
    '--mo-drawer:cubic-bezier(.32,.72,0,1);}',
```

## Repo conventions to follow

- 令牌一律定义在 `masscode-runner/assets/motion.css` 的 `:root`，消费方写 `var(--mo-N) var(--mo-out)`。
- 现成范例（照抄这个形状）：`masscode-runner/assets/motion-sp.css:192-194`

```css
#system-workspace .sp-bar i {
  transition: width var(--mo-3) var(--mo-out);
}
```

- 文件头注释体例：每条规则先写「为什么」，实测数字或反例写在括号里（见 `motion.css:41-50` 的逐档注释）。

## Steps

1. `motion.css`：在 `--mo-in-out` 那一行下方新增 `--mo-drawer: cubic-bezier(.32, .72, 0, 1);`，注释写明「app.css 原本手抄 4 遍的 iOS 抽屉曲线」。
2. `doc-theme.css:72-73`：把两个字面量替换为 `var(--mo-back)` / `var(--mo-in-out)`。
3. `ui-kit.css:52`：把复合值替换为 `var(--mo-1) var(--mo-in-out)`。
4. `motion.js:54-55`：把兜底串改成与真源逐值一致（`--mo-3:260ms`，补 `--mo-out` / `--mo-in-out` / `--mo-drawer`，删除 `--mo-ease`）。
5. `motion.js`：把用 `var(--mo-ease)` 的地方改成 `var(--mo-out)`（`grep -n "mo-ease" motion.js` 逐处替换；现仅注释与 keyframes 使用）。
6. `app.css`：把 4 处手抄的 `cubic-bezier(.32,.72,0,1)`（:3288、:3493、:3509、:3595）替换为 `var(--mo-drawer)`。
7. `motion.css:474`：**保持 640ms 不变**，仅在其上方补一行注释说明「与 motion.js 720ms 摘类约定绑定，故不走 --mo-4」。

## Boundaries

- 不要改动 `--mo-4` 的值，也不要为了「用上 --mo-4」而去改 `motion.css:474` 的 640ms —— 它和 JS 的 720ms 摘类定时器绑定。
- 不碰 `assets/reading-block-editor.js`、`assets/*.bundle.js`（第三方打包产物）。
- 不动任何选择器、不动 markup、不加依赖。
- 如果 `motion.js` 里 `--mo-ease` 的用法与上面的行号不符（提交后代码有漂移），停止并报告，不要即兴发挥。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（棘轮：`motion.css` 上限 264 行代码，本次只增 1-2 行，需确认未顶破）；`node tests/undefined-refs.js` 应仍然 0 问题。
- `grep -rn "cubic-bezier(.32,.72,0,1)" masscode-runner/assets/*.css` 应返回 **0 处**字面量（只剩 `motion.css` 的令牌定义）。
- `grep -rn "var(--mo-4)" masscode-runner/assets/*.css` 允许仍为 0 —— 本计划不要求消费它。
- **Feel check**：打开应用，把 DevTools 的 Animations 面板 playback 调到 10%，依次触发：主题切换（`app.css:3288` 那条）、右键菜单、抽屉/浮层。确认三处的减速段**看起来一致**，没有一处明显更「弹」或更「闷」。
- **Done when**：`doc-theme.css` / `ui-kit.css` / `motion.js` 里不再出现任何 cubic-bezier 字面量（除 `motion.css` 的 4 条令牌定义），且架构断言仍全绿。
