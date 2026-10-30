# 拆分规范：life-workbench.js 按职责分层（2026-10-30）

> 目标文件：`masscode-runner/assets/life-workbench.js`（16,475 总行 / 12,419 行代码 / 1.1MB，单文件）。
> 动机：连续三次「修一个体验问题就要为行数打一次仗」；且编辑器与面板渲染耦合，改编辑器必然动到面板代码。

## 0. 关键约束（先读，决定可行性）

1. **该文件是单一 IIFE**（第 13 行 `(() => {`）—— 内部全是闭包私有。
   ⇒ 拆出去的部分**必须**通过 `window.CodeScope…` 暴露，否则面板调不到；
   ⇒ 且面板里**引用它内部状态的每一个闭包**都要改成走这个 API（这是工作量所在）。
2. **加载顺序**由 `index.html` 决定。拆分后必须：
   `life-styles.js`（纯数据）→ `life-editor.js`（编辑器接入）→ `life-workbench.js`（面板，依赖前两个）。
3. **棘轮**：`tests/architecture.js` 里 `assets/life-workbench.js` 当前 12,419（零余量）。
   每拆出一个文件，就在棘轮里**新增该文件的上限**并**把原文件上限往下拧**，总和不许变大。

## 1. 阶段 1：抽样式层（`life-styles.js`）—— 风险极低，先做

**搬走的东西**：
- `CSS` 常量（面板自身样式，模板字符串，约 2,000 行）
- `MEMO_DOC_CSS` 常量（Crepe 编辑器 + Phycat 移植规则，约 300 行）

**形式**：纯数据，零逻辑。
```js
(function () {
  'use strict';
  window.CodeScopeLifeStyles = { css: <原 CSS>, memoDocCss: <原 MEMO_DOC_CSS> };
})();
```

**面板侧改动（只有两处）**：
- 注入样式那处（约 :3566 `st.textContent = CSS + MEMO_DOC_CSS`）→ `st.textContent = CodeScopeLifeStyles.css + CodeScopeLifeStyles.memoDocCss`
- 删掉两个常量的定义

**为什么安全**：模板字符串是纯字面量，不引用任何闭包变量。**搬完必须验证「除搬家外无实质变化」**：
两侧拼接后的字符串做归一化（去空白）后 **sha256 必须相同**。

## 2. 阶段 2：抽编辑器接入层（`life-editor.js`）—— 中等风险

**搬走的东西**（都是 Crepe 相关，不碰面板渲染）：
- `readMemoMarkdown` / `writeMemoMarkdown`（序列化收敛后的两个函数）
- `caretBlockText` / `ceBlockIndex`（共用助手）
- `memoMountEditor` / `journalMountEditor` 及其配套（token 淘汰、三道防丢保险）
- 与它们直接相关的常量（`MEMO_CE` / `MEMO_CE_TOKEN` / `JOURNAL_CE` / `JOURNAL_CE_TOKEN` 等）

**对外 API（面板只通过这些调用）**：
```js
window.CodeScopeLifeEditor = {
  mountMemo(host, opts),    // opts: { markdown, onChange, topBar }
  mountJournal(host, opts),
  read(host),               // → markdown | null（null = 认不出，调用方必须 if (!md) return）
  write(host, markdown),
  destroy(host)
};
```

**⚠️ 最容易出事的地方**：面板里有多处回调依赖编辑器内部状态（当前实例、token、md 缓存）。
搬迁时**不允许**把这些状态留在面板侧（否则两边各存一份必然不同步）—— 状态必须整体搬进 `life-editor.js`。

## 3. 阶段 3：棘轮重排

拆完按实测值重排：
```js
['assets/life-workbench.js', <拆分后实测>],   // 往下拧
['assets/life-styles.js',     <实测>],        // 新增
['assets/life-editor.js',     <实测>],        // 新增
```
并更新文件头注释里「为什么这么分」。

## 4. 每个阶段都必须过的验收

1. **保存回归 ×2**（备忘录 + 日记）：输入含标题/列表/任务勾选 → 等自动保存 → `page.reload()` → 再进同一页 → 内容一字不差（`innerText` 逐字符相同）。
2. `node --check` 改动的每个文件。
3. `node tests/architecture.js` 全绿、`node tests/undefined-refs.js` 0 问题。
4. 页面 `pageerror = 0`。
5. 阶段 1 额外要求：**归一化后的样式字符串 sha256 与拆分前相同**（证明只是搬家）。

## 5. 禁止事项

- 不许顺手改视觉或行为（这是纯重构；任何观感变化都说明搬错了东西）。
- 不许把 `src/reading-block-editor.js` 牵扯进来（阅读视图共用，独立演进）。
- 不许改 `tests/architecture.js` 的其它条目。
- 不许 git commit / add / stash。