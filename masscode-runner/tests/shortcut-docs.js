#!/usr/bin/env node
'use strict';
/**
 * 快捷键「代码 ↔ 文档」一致性检查（2026-10-09）
 *
 * ⚠️ 为什么要有 ✗✗：
 *   这一天加了 6 个新快捷键（⌘K / ⌘B / ⌘E / ⌘⇧E / ⌘1~3 / ⌘⇧7,8 / ⌘⇧N / Tab），
 *   但**手册和欢迎页一个都没跟上** ✗ —— 最后是**用户自己发现**的 ✗。
 *   同类问题以前也有：按钮 title 写着「撤销（⌘Z）」但根本没实现 ✗
 *   （那个由 tests/shortcut-titles.js 在**运行时**兜住 ✓）。
 *   → 这里补上**文档侧**：实现的快捷键必须**写进手册** ✓。
 *
 * ⚠️ 为什么用**显式登记表**而不是去 grep 代码 ✗✗：
 *   这一天我的静态检查累计**误报 4 次** ✓（正则扫压缩 JS 不可靠 ✓）。
 *   → 登记表是**一处**显式声明 ✓，改快捷键时**必须**同时改这里 ✓
 *     （这本身就是想要的：强迫「加键 = 登记 = 写文档」三步一起做 ✓）。
 *   ⚠️ 登记表里的键，**运行时是否真的生效**由 tests/shortcut-titles.js 负责 ✓，
 *      两个测试**分工不同**，都要跑 ✓。
 *
 * 运行：node tests/shortcut-docs.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manual = fs.readFileSync(path.join(root, 'docs', 'manual', 'index.html'), 'utf8');
const welcome = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/**
 * ★★ 归一化：同一件事在不同地方写法不一样 ✗✓
 *   手册写 `Ctrl/⌘+P`（全写 ✓），欢迎页写 `⌘ P`（简写 ✓），
 *   还有 `⇧` 和 `Shift` 两种写法 ✓ —— **不归一化就是拿不同写法在比** ✓，
 *   会报一堆假失败 ✓（我第一版就是这样 ✓）。
 *   → 统一成：Ctrl 保留、⌘ → Meta、⇧ → Shift、去掉分隔符和小写化 ✓。
 *     `Ctrl/⌘+P` → `metap` ✓  `⌘ P` → `metap` ✓  `⌘ ⇧ F` → `metashiftf` ✓
 */
function norm(s) {
  return String(s)
    .replace(/\s+/g, '')
    .replace(/⇧/g, 'Shift')
    .replace(/⌘/g, 'Meta')
    .replace(/^Ctrl\/Meta\+?/, 'Meta')   /* Ctrl/⌘+P → MetaP */
    .replace(/^Ctrl\//, 'Ctrl')          /* Ctrl+Shift+F → CtrlShiftF */
    .replace(/\+/g, '')
    .toLowerCase();
}

/* 手册里出现的所有 <kbd>（归一化后比对 ✓） */
const kbdSet = new Set(
  [...manual.matchAll(/<kbd>([^<]*)<\/kbd>/g)].map((m) => norm(m[1]))
);
const manualText = manual.replace(/<[^>]+>/g, '');

/* 欢迎页底部那排提示 ✓（用户第一眼会看到的那几个 ✓） */
const welcomeHints = (() => {
  const m = welcome.match(/<div class="welcome-shortcuts">([\s\S]*?)<\/div>/);
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/<kbd>([^<]*)<\/kbd>/g)].map((x) => norm(x[1])));
})();

/**
 * 登记表：应用**对外承诺**的快捷键 ✓
 *   keys   —— 在手册里应该出现的写法（<kbd> 里的文本 ✓，比对时会去掉空白）
 *   label  —— 人类可读的名字（报错时用 ✓）
 *   welcome—— 是否应该在**欢迎页**那排提示里出现（只挑最常用的几个 ✓）
 *   note   —— 补充说明（可选 ✓）
 */
const SHORTCUTS = [
  { keys: ['Ctrl/⌘+P'], label: '快速打开', welcome: true },
  { keys: ['Ctrl/⌘+Shift+P', 'F1'], label: '命令面板', welcome: true },
  { keys: ['Ctrl/⌘+K'], label: '命令面板（⌘K 别名）', welcome: true },
  { keys: ['Ctrl/⌘+Shift+F'], label: '全文搜索', welcome: true },
  { keys: ['Ctrl/⌘+F'], label: '查找' },
  { keys: ['Ctrl/⌘+H'], label: '替换' },
  { keys: ['Ctrl/⌘+G'], label: '跳转到行' },
  { keys: ['Ctrl/⌘+/'], label: '切换行注释' },
  { keys: ['Alt+↑', 'Alt+↓'], label: '上移 / 下移行' },
  { keys: ['Alt+Shift+↑', 'Alt+Shift+↓'], label: '复制行到上 / 下' },
  { keys: ['Ctrl/⌘+Shift+K'], label: '删除当前行' },
  { keys: ['Ctrl/⌘+Enter'], label: '在下方插入行' },
  { keys: ['Ctrl/⌘+Shift+Enter'], label: '在上方插入行' },
  { keys: ['Tab'], label: '缩进（多行整体缩进）' },
  { keys: ['Shift+Tab'], label: '反缩进' },
  { keys: ['Alt+Z'], label: '自动换行' },
  { keys: ['Ctrl/⌘+0'], label: '字号恢复默认' },
  { keys: ['F12'], label: '跳转到定义' },
  { keys: ['Shift+F12'], label: '查找引用' },
  { keys: ['Alt+F12'], label: '固定预览定义' },
  { keys: ['F8'], label: '下一个问题' },
  { keys: ['Shift+F8'], label: '上一个问题' },
  { keys: ['⌘B'], label: '加粗（Markdown / 备忘录 / 日记）' },
  { keys: ['⌘E'], label: '行内代码' },
  { keys: ['⌘⇧E'], label: '斜体（浏览器里 ⌘I 被占用，见手册说明）' },
  { keys: ['⌘1', '⌘2', '⌘3'], label: '一 / 二 / 三级标题' },
  { keys: ['⌘⇧7'], label: '有序列表' },
  { keys: ['⌘⇧8'], label: '无序列表' },
  { keys: ['⌘Z'], label: '撤销' },
  { keys: ['⌘⇧Z'], label: '重做' },
  { keys: ['⌘N'], label: '新建（备忘录）' },
  { keys: ['⌘F'], label: '搜索（备忘录）' },
  { keys: ['Ctrl/⌘+Shift+N', '⌘⇧N'], label: '快速捕捉', welcome: true },
];

/* 允许「同一件事有别名」：手册里出现任意一个写法就算写了 ✓ */
const MISSING_KBD = [];
const MISSING_TEXT = [];
const MISSING_WELCOME = [];

for (const s of SHORTCUTS) {
  const hitKbd = s.keys.some((k) => kbdSet.has(norm(k)));
  if (!hitKbd) MISSING_KBD.push(s);
  /* 再兜一层：<kbd> 里没有时，正文里出现也算（有的地方是行文提到 ✓）*/
  const hitText = s.keys.some((k) => manualText.includes(k));
  if (!hitText) MISSING_TEXT.push(s);
  if (s.welcome) {
    const hitW = s.keys.some((k) => welcomeHints.has(norm(k)));
    if (!hitW) MISSING_WELCOME.push(s);
  }
}

const pad = (x) => String(x).padEnd(2);
console.log('  登记在册的快捷键: ' + SHORTCUTS.length + ' 项');
console.log('  手册里的 <kbd> 去重: ' + kbdSet.size + ' 个 · 欢迎页提示: ' + welcomeHints.size + ' 个');
console.log('');

let bad = 0;
if (MISSING_KBD.length) {
  bad += MISSING_KBD.length;
  console.log('  ✗ 手册的 <kbd> 里缺 ' + MISSING_KBD.length + ' 项:');
  MISSING_KBD.forEach((s) => console.log('      ' + pad(s.keys.join(' / ')) + '  ' + s.label));
}
if (MISSING_TEXT.length) {
  bad += MISSING_TEXT.length;
  console.log('  ✗ 手册正文里也完全没提 ' + MISSING_TEXT.length + ' 项:');
  MISSING_TEXT.forEach((s) => console.log('      ' + pad(s.keys.join(' / ')) + '  ' + s.label));
}
if (MISSING_WELCOME.length) {
  bad += MISSING_WELCOME.length;
  console.log('  ✗ 欢迎页底部提示里缺 ' + MISSING_WELCOME.length + ' 项（这几个是最常用的 ✓）:');
  MISSING_WELCOME.forEach((s) => console.log('      ' + pad(s.keys.join(' / ')) + '  ' + s.label));
}

if (!bad) {
  console.log('  ✓ 登记在册的 ' + SHORTCUTS.length + ' 项快捷键，手册和欢迎页都写了');
} else {
  console.log('');
  console.log('  → 加/改快捷键时，三件事要一起做：');
  console.log('     ① 实现它  ② 在 tests/shortcut-docs.js 的登记表里加一行');
  console.log('     ③ 写进 docs/manual/index.html（常用的还要加进欢迎页提示）');
  console.log('  ⚠️ 「运行时是否真的生效」由 tests/shortcut-titles.js 负责，两个都要跑。');
  process.exitCode = 1;
}
