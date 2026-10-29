# 002 — 顶栏进度条改 transform，止住「永不停」的宽度动画

- **Status**: TODO
- **Commit**: 707c6c0
- **Severity**: HIGH
- **Category**: 5. Performance（同时违反本项目已确立的动效规则②）
- **Estimated scope**: 2 文件（`app.css` 1 行 + `app.js` 1 处赋值），约 6 行

## Problem

顶栏三条常驻进度条每 3 秒被就地重写宽度，而宽度上有 450ms 过渡 —— 等于它们**有 15% 的墙钟时间永远在动，且永不停止**。

```css
/* masscode-runner/assets/app.css:23-24 */
  .sm-bar { grid-column:1 / -1; height:3px; overflow:hidden; border-radius:2px; background:#26303c; }
  .sm-bar > i { display:block; width:0; height:100%; border-radius:inherit; background:#4f9a72; transition:width .45s ease,background .25s ease; }
```
```js
/* masscode-runner/assets/app.js:742 */
  setInterval(() => { if(!document.hidden) loadSystemStatus(); }, 3000);
/* masscode-runner/assets/app.js:700-702 */
    if (!ok) { value.textContent = '--%'; bar.style.width = '0'; return; }
    const rounded = Math.max(0, Math.min(100, Math.round(n)));
    value.textContent = rounded + '%'; bar.style.width = rounded + '%';
```

同时踩三条：① `width` 是布局属性（触发 layout+paint，不走合成层）；② `450ms` 不在 `--mo-*` 任何一档上，且裸 `ease` 不是 `--mo-out`；③ 违反本项目**已确立**的规则②「不许给每次轮询都会重绘的东西加动画」。

同族的 `#system-workspace .sp-bar i` 已经用对了写法（`motion-sp.css:192-194`：`width` + `--mo-3` + `--mo-out`），但它仍在动 `width`；本计划把**两条都**改成 `transform: scaleX()`。

## Target

进度条结构与过渡改为纯合成层属性：

```css
/* app.css:24 —— target */
  .sm-bar > i { display:block; width:100%; height:100%; border-radius:inherit; background:#4f9a72;
                transform:scaleX(0); transform-origin:left center;
                transition:transform var(--mo-3) var(--mo-out), background var(--mo-2) var(--mo-out); }

/* motion-sp.css:192-194 —— target */
#system-workspace .sp-bar i {
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--mo-3) var(--mo-out);
}
```

```js
/* app.js:700-702 —— target：写 transform 而不是 width */
    if (!ok) { value.textContent = '--%'; bar.style.transform = 'scaleX(0)'; return; }
    const rounded = Math.max(0, Math.min(100, Math.round(n)));
    value.textContent = rounded + '%'; bar.style.transform = 'scaleX(' + (rounded / 100) + ')';
```

## Repo conventions to follow

- 位移/生长一律 `transform` + `transform-origin`，令牌用 `var(--mo-N) var(--mo-out)`。
- 已给出理由的范例：`masscode-runner/assets/motion.css:268-269`（tab 下划线用 `transform: scaleX()` 而不是改 `width`，注释写明「width 会触发重排」）。
- 轮询刷新「不应该有无限动画」的既有决策：`motion.js:380-385` 的 1.5s 节流注释。

## Steps

1. `app.css:24`：按 Target 改写 `.sm-bar > i`（`width:100%` + `transform:scaleX(0)` + 新过渡）。
2. `app.js:700`：把 `bar.style.width = '0'` 改为 `bar.style.transform = 'scaleX(0)'`。
3. `app.js:702`：把 `bar.style.width = rounded + '%'` 改为 `bar.style.transform = 'scaleX(' + (rounded/100) + ')'`。
4. ~~`motion-sp.css:192-194`：按 Target 改写。~~ **已撤回（2026-10-28 执行时发现计划错误）**

   ⚠️ 本计划的 Target 对 `.sp-bar i` 的改法是**错的**，照做会让系统面板所有进度条变成 0 宽（看不见）。
   证据：`#system-workspace .sp-bar i` 的宽度**不是** `app.js` 写的，而是 `assets/system-panel.js`
   （计划外的第 4 个文件）用 inline `width` 写的，且**从不写 transform**：
   - `system-panel.js:1112` 就地写磁盘卷宽度（1.5s 刷新，是唯一「看得见动画」的那条）
   - `system-panel.js:45` 的 `be()` 产出 `<i style="width:X%">`，调用点 `1174 / 1240 / 1258`
   - `system-panel.js:12` 用量列表行

   `grep -c "style.width" assets/system-panel.js` = **6**，`grep -c "style.transform"` = **0**。
   给 CSS 加 `transform: scaleX(0)` 会把现有 inline `width` 全部乘成 0 —— 真机 Chromium 实测：
   顶栏那条（JS 写 `scaleX(.42)`）视觉 252/600px 正常；`.sp-bar` 那条（JS 仍写 `width:42%`）
   视觉 **0px**，整条空白。

   ⇒ **结论：本计划只收顶栏三条（`#header-right` 内的 `.sm-bar`），`motion-sp.css` 保持原样。**
   顶栏那三条才是「3 秒轮询 × 450ms 过渡、永不停止」的那一个；系统面板的条子用 `--mo-3` +
   `--mo-out`（令牌正确），且只在展开面板时可见，风险面远低于改一个压缩过的 10k 行文件。
   若将来真要收它，需要同时把 `system-panel.js` 的 6 处 `width` 改成 `transform`，
   **另开一份计划**，不要塞回本计划。
5. `grep -n "sp-bar" assets/app.js` 确认还有没有第二处写 `width` 的地方（`#system-workspace` 详情面板的条）；如果有，同样改成 `scaleX`。

## Boundaries

- 不要改 3 秒轮询间隔（`app.js:742`）—— 频率是产品决策。
- 不要动 `.sm-bar` 的容器尺寸、颜色、`overflow`。
- 不要给进度条加额外动画（例如到达 100% 时的脉冲）。
- 如果 `app.js` 里 `bar` 还有别的地方被写 `width`（尤其 `display`/`flex` 依赖宽度的场景），先报告，不要连带改。

## Verification

- **Mechanical**：`cd masscode-runner && node tests/architecture.js`（`app.js` 棘轮 12,995 行代码，本次行数不变）；`node tests/undefined-refs.js`。
- `grep -n "style.width" masscode-runner/assets/app.js` 不应再命中进度条相关的两处。
- **Feel check**：打开应用盯着顶栏 CPU/内存/磁盘三条 60 秒。确认：
  - 数值每次跳变时条子**平滑滑到新位置并停住**（不再持续 450ms 缓慢爬行后又被下一次重置）；
  - DevTools Performance 录制 30 秒 idle，确认没有持续的 Layout 记录（旧写法每 3 秒一条 Layout）；
  - 把 playback 调到 10%，确认生长方向始终**从左往右**（`transform-origin: left center` 生效，不是从中间张开）。
- **Done when**：Performance 录制 30 秒 idle 期间 Layout 事件数 ≈ 0，且三条进度条在数值不变时不产生任何动画。
