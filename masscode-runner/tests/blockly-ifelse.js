/*
 * if/else 积木代码生成回归测试
 * ---------------------------------------------------------------------------
 * 守的这个 bug（已实测）：`c_ifelse` 在 defineCBlocks（积木定义）和工具箱里都在，
 * 用户能从积木栏拖出来，但 `emitOne()`（积木 → C 代码）**漏了 `case 'c_ifelse'`**
 * → 落到 `default` → 整块被换成一行「未知积木 c_ifelse」注释，
 * **if 和 else 一起消失**（实测：拖一个 c_ifelse 进工作区，blockJsonToCode()
 * 只回那一行注释）。工作区里已经补好这个 case，这里把它钉死。
 *
 * 为什么必须直接造积木、不能只靠 tests/blockly-roundtrip.js：
 *   roundtrip 走「源码 → CFG → 积木 → 代码」，而 CFG 那条路
 *   `makeBlockFor()` 里 branch 恒为 `mk('c_if')`（见 index.html），
 *   **永远不会产出 c_ifelse**。也就是说：c_ifelse 的唯一来源就是用户从积木栏拖，
 *   roundtrip 再多跑几百个函数也覆盖不到这个 bug。所以这里用和「拖出来」等价的
 *   程序化构造（newBlock + 连槽）。
 *
 * 三件事：
 *   ① 造一个 c_ifelse（COND/DO/ELSE 三个槽都接上），断言生成的是真 if/else：
 *      含 `if (`、`} else {`、两个分支体各自出现，且**不含**「未知积木」
 *      （注：真实输出是 `} else {`，`if (x > 0)` 的那个 `)` 不属于 else 行，
 *        所以不能按字面断言 `) else {`）
 *   ② 全量扫描：工具箱里每个类型 + 所有 c_/cpp_ 定义都过一遍 emitOne，
 *      任何一块落到「未知积木」都报出来（防「又加了积木忘了加 case」）
 *   ③ 页面不能有 JS 报错
 *
 * 为什么是浏览器驱动：积木定义和生成器都在 index.html 运行时的 Blockly 里，
 * 只有把真页面加载起来调 `blockJsonToCode()` 才算真跑（和 blockly-validate.js
 * 同一套机制）。
 *
 * 用法: node tests/blockly-ifelse.js
 */
'use strict';

const { chromium } = require('playwright-core');

const PANEL = 'http://127.0.0.1:4877/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* 造一个签名是 int main() 的函数片段当上下文，这样 blockJsonToCode()
   会拼出「完整函数」，和实测的修复版输出逐字节对得上。 */
const SRC = ['int main() {', '  if (x > 0) {', '    a = 1;', '  } else {', '    b = 2;', '  }', '}'].join('\n');
const EXPECT_BODY = 'if (x > 0) {\n  a = 1;\n} else {\n  b = 2;\n}\n';
const EXPECT_FULL = 'int main()\n{\n  if (x > 0) {\n    a = 1;\n  } else {\n    b = 2;\n  }\n}';

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--disable-gpu'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await p.goto(PANEL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  /* 装上下文：CURRENT / CINDEX / REL_ROOT 都是内联脚本里的 let 绑定（不是
     window 属性），所以必须**裸赋值**，写 window.CURRENT = ... 是打不中的。 */
  await p.evaluate((src) => {
    CURRENT = { file: '/tmp/__blockly_ifelse__.c', fragments: [{ language: 'c_cpp', code: src }] };
    CINDEX = 0;
    /* 带 snippet 就不会再走 resolveDefinition，line 稳稳是 1 */
    REL_ROOT = { kind: 'fn', name: 'main', line: 1, endLine: 7, frag: 0, snippet: src };
  }, SRC);

  const r = await p.evaluate(async () => {
    await ensureBlockly();
    defineCBlocks();
    /* Blockly 是 ensureBlockly() 之后才挂到 window 上的，这里才取得到 */
    const B = window.Blockly;
    if (!BP_WORKSPACE) BP_WORKSPACE = B.inject(document.createElement('div'), {});
    const mk = (t) => {
      const x = BP_WORKSPACE.newBlock(t);
      if (x.initSvg) x.initSvg();
      if (x.render) x.render();
      return x;
    };
    const unknownOf = (t) => {
      const x = mk(t);
      return String(emitOne(x, 0)).indexOf('未知积木') >= 0 ? t : '';
    };

    BP_BUILDING = true;
    BP_WORKSPACE.clear();

    /* ① 等价于「从积木栏拖一个 if/else 出来」：COND = x > 0，DO = a = 1，ELSE = b = 2 */
    const ie = mk('c_ifelse');
    const cond = mk('c_expr');
    cond.setFieldValue('x > 0', 'EXPR');
    ie.getInput('COND').connection.connect(cond.outputConnection);
    const doSet = mk('c_set');
    doSet.setFieldValue('a', 'TARGET');
    const doNum = mk('c_num');
    doNum.setFieldValue(1, 'NUM');
    doSet.getInput('VALUE').connection.connect(doNum.outputConnection);
    ie.getInput('DO').connection.connect(doSet.previousConnection);
    const elseSet = mk('c_set');
    elseSet.setFieldValue('b', 'TARGET');
    const elseNum = mk('c_num');
    elseNum.setFieldValue(2, 'NUM');
    elseSet.getInput('VALUE').connection.connect(elseNum.outputConnection);
    ie.getInput('ELSE').connection.connect(elseSet.previousConnection);

    const body = emitChain(ie, 0);
    const full = blockJsonToCode();

    /* ② 全量扫描：工具箱类型 ∪ 所有 c_/cpp_ 定义 */
    const types = [];
    bpToolbox().contents.forEach((c) => (c.contents || []).forEach((it) => { if (it.kind === 'block') types.push(it.type); }));
    const defined = Object.keys(B.Blocks).filter((t) => t.indexOf('c_') === 0 || t.indexOf('cpp_') === 0);
    const union = types.concat(defined.filter((t) => types.indexOf(t) < 0));
    const missing = [], threw = [];
    BP_WORKSPACE.clear();
    union.forEach((t) => { try { const u = unknownOf(t); if (u) missing.push(u); } catch (e) { threw.push(t + ': ' + String(e.message).slice(0, 60)); } });
    BP_WORKSPACE.clear();
    BP_BUILDING = false;

    return { 工具箱: types.length, 定义: defined.length, 扫描: union.length, body, full, missing, threw };
  });

  const contains = (hay, needle) => hay.indexOf(needle) >= 0;
  check('生成的是真 if/else（不是「未知积木」）', !contains(r.body, '未知积木'), '含「未知积木」: ' + JSON.stringify(r.body));
  check('含 `if (`', contains(r.body, 'if ('), JSON.stringify(r.body));
  check('含 `} else {`（else 分支真的生成出来了）', contains(r.body, '} else {'), JSON.stringify(r.body));
  check('两个分支体都出现（a = 1; / b = 2;）', contains(r.body, 'a = 1;') && contains(r.body, 'b = 2;'), JSON.stringify(r.body));
  check('emitChain 输出逐字节等于预期', r.body === EXPECT_BODY, '实际=' + JSON.stringify(r.body) + ' 预期=' + JSON.stringify(EXPECT_BODY));
  check('blockJsonToCode() 输出完整函数（逐字节）', r.full === EXPECT_FULL, '实际=' + JSON.stringify(r.full) + ' 预期=' + JSON.stringify(EXPECT_FULL));
  check('工具箱类型数 = 41', r.工具箱 === 41, '实际 ' + r.工具箱);
  check('全量扫描无「未知积木」（' + r.扫描 + ' 个类型）', r.missing.length === 0 && r.threw.length === 0,
    (r.missing.length ? '缺 case: ' + r.missing.join(', ') : '') + (r.threw.length ? ' 创建抛错: ' + r.threw.join(' | ') : ''));
  check('页面无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('工具箱类型: ' + r.工具箱 + '，积木定义: ' + r.定义 + '（扫描 ' + r.扫描 + ' 个）');
  console.log('--- c_ifelse 生成（blockJsonToCode）---');
  console.log(r.full);
  console.log('--- 断言 ---');
  checks.forEach((c) => console.log((c.ok ? '✓ ' : '✗ ') + c.name + (c.ok ? '' : '  → ' + c.detail)));
  const bad = checks.filter((c) => !c.ok);
  console.log('\nc_ifelse 回归测试：' + (checks.length - bad.length) + '/' + checks.length + ' 项通过' + (bad.length ? '，' + bad.length + ' 项失败' : ''));

  await b.close();
  if (bad.length) process.exit(1);
})().catch((e) => { console.error('测试本身出错:', e && e.stack || e); process.exit(1); });
