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

/* ---------------------------------------------------------------------------
 * 外链脚本同样要过闸门
 * ---------------------------------------------------------------------------
 * `index.html` 里 <script src="/assets/life-workbench.js" defer> 是**外链**，
 * 上面的正则 `(?![^>]*\bsrc=)` 会把它跳过 —— 也就是说这个文件以前**完全没被校验**。
 *
 * 而它和 index.html 一样致命：一个语法错误 → 整个面板脚本不执行 →
 * 点「个人管理面板」**一片空白**（页面其余部分正常，所以特别像"面板坏了"而不是"语法错了"）。
 *
 * 而且这个文件里有大量 CSS 模板字符串（`const CSS = \`...\``），
 * **注释里混进一个反引号就会截断模板串** —— 实测踩过 4 次。
 * 那种错误 `node --check` 一眼就能抓，但没人会记得手动跑。
 */
const externals = ['assets/life-workbench.js'];
let extFailed = 0;

for (const rel of externals) {
  const abs = path.join(__dirname, '..', rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  try {
    new vm.Script(src, { filename: rel });
    console.log('外链脚本语法：✓ ' + rel + '（' + src.split('\n').length + ' 行）');
  } catch (error) {
    extFailed += 1;
    const at = (String(error.stack || '').match(new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)')) || [])[1];
    const srcLines = src.split('\n');
    console.error('✗ 外链脚本语法错误 → ' + rel + (at ? ' 第 ' + at + ' 行' : ''));
    console.error('  ' + error.message);
    if (at) {
      const n = Number(at);
      for (let k = Math.max(0, n - 3); k < Math.min(srcLines.length, n + 2); k++) {
        console.error('    ' + (k + 1) + ': ' + srcLines[k].slice(0, 150));
      }
    }
  }
}

if (extFailed) {
  console.error('外链脚本语法闸门：' + extFailed + ' 个文件有语法错误 —— 面板会整块白屏，先修这个');
  process.exit(1);
}
