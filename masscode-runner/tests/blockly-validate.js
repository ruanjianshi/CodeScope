/*
 * 积木定义校验（回归测试）
 * ---------------------------------------------------------------------------
 * 两重校验：
 *   ① 静态：每个积木的 message 占位符数量 == args 数量
 *   ② 实际：每个积木都真的能 newBlock 出来（不抛错）
 *
 * 为什么必须有：Blockly 的 message 少写一个 %1 就会在**创建积木时抛错**，
 * 整个积木直接不可用（工具箱里点不出来）。实测踩过（cpp_mutex）。
 *
 * 用法: node tests/blockly-validate.js [文档路径]
 */
/* 校验所有积木定义：message 占位符数量必须和 args 数量一致，
   否则 Blockly 会在**创建积木时抛错**，整个积木不可用。
   （实测踩过：cpp_mutex 的 message0 少写一个 %1） */
const { chromium } = require('playwright-core');
const FILE = process.argv[2] || '/Users/xiaoq/Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault/code/Test/手搓代码/接口化最小代码实现.md';
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-gpu'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await p.goto('http://127.0.0.1:4877/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.evaluate((f) => new Promise((r) => {
    const s = document.createElement('script');
    s.textContent = 'CURRENT = { file: ' + JSON.stringify(f) + ', fragments: [{ language: "c_cpp", code: "" }] };'
      + 'CINDEX = 1; REL_ROOT = { kind: "fn", name: "led_open", line: 42, endLine: 48, frag: 1 };'
      + 'setBlocklyActive(true);';
    document.body.appendChild(s);
    setTimeout(r, 9000);
  }), FILE);
  const r = await p.evaluate(() => {
    const B = window.Blockly;
    const all = Object.keys(B.Blocks).filter((t) => t.indexOf('c_') === 0 || t.indexOf('cpp_') === 0);
    const bad = [], ok = [];
    all.forEach((t) => {
      const def = B.Blocks[t];
      if (!def || !def.json) { ok.push(t + '(非json)'); return; }
      const j = def.json;
      const msgs = Object.keys(j).filter((k) => /^message\d+$/.test(k));
      let argsN = 0, phN = 0;
      msgs.forEach((k) => {
        const args = j[k.replace('message', 'args')] || [];
        argsN += args.length;
        const m = String(j[k]).match(/%\d+/g) || [];
        phN += new Set(m).size;
      });
      if (argsN !== phN) bad.push(t + ' (占位符 ' + phN + ' ≠ 参数 ' + argsN + ')');
      else ok.push(t);
    });
    /* 再实测：每个积木都真的能创建出来 */
    const fail = [];
    BP_BUILDING = true;
    all.forEach((t) => { try { BP_WORKSPACE.newBlock(t); } catch (e) { fail.push(t + ': ' + e.message.slice(0, 60)); } });
    BP_WORKSPACE.clear();
    BP_BUILDING = false;
    return { 总数: all.length, 静态不匹配: bad, 创建失败: fail };
  });
  console.log('积木总数:', r.总数);
  console.log('静态检查不匹配:', r.静态不匹配.length ? '✗ ' + r.静态不匹配.join(' | ') : '✓ 无');
  console.log('实际创建失败:', r.创建失败.length ? '✗ ' + r.创建失败.join(' | ') : '✓ 无');
  console.log('页面错误:', errs.length ? errs.slice(0, 2).join(' | ') : '无 ✓');
  await b.close();
})();
