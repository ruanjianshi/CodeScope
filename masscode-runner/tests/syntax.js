'use strict';
/**
 * 内联脚本语法闸门
 * ---------------------------------------------------------------------------
 * 背景：index.html 是**单文件**，所有 JS 都内联在里面。一个语法错误会让
 * **整个前端脚本都不加载**（页面只剩半截 UI，报错还常常指向别处，
 * 比如 `xxx is not defined`），排查很费时间。
 *
 * 而 `tests/smoke.js` 是**静态 grep 断言**，它**不会解析 JS** ——
 * 实测踩过一次：我改代码时整行 `body: JSON.stringify(...)` 被误删，
 * smoke 依然 590 全过，但打开应用是坏的。
 *
 * 所以单独加这道闸门：把每个内联 <script> 抽出来丢给 vm.Script 编译，
 * 语法错误直接报**文件里的真实行号**并打印上下文。
 *
 * 运行：node tests/syntax.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');

const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const lines = html.split('\n');
let m, index = 0, checked = 0, failed = 0;

while ((m = re.exec(html)) !== null) {
  index += 1;
  const code = m[1];
  if (!code.trim()) continue;
  checked += 1;
  const startLine = html.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(code, { filename: 'inline-' + index + '.js' });
  } catch (error) {
    failed += 1;
    const inScript = (String(error.stack || '').match(/inline-\d+\.js:(\d+)/) || [])[1];
    const realLine = inScript ? startLine + Number(inScript) - 1 : startLine;
    console.error('✗ 内联脚本 #' + index + ' 语法错误 → index.html 第 ' + realLine + ' 行');
    console.error('  ' + error.message);
    for (let k = Math.max(0, realLine - 3); k < Math.min(lines.length, realLine + 2); k++) {
      console.error('    ' + (k + 1) + ': ' + lines[k].slice(0, 150));
    }
  }
}

if (failed) {
  console.error('内联脚本语法闸门：' + failed + '/' + checked + ' 个脚本有语法错误 —— 整个前端都不会加载，先修这个');
  process.exit(1);
}
console.log('内联脚本语法闸门：' + checked + ' 个脚本全部通过');
