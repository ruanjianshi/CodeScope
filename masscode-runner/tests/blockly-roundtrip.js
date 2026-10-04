/*
 * 积木往返一致性审计（回归测试）
 * ---------------------------------------------------------------------------
 * 遍历一个代码文档里**所有函数**，把每个函数走一遍：
 *   源码 → CFG（/api/logic/graph）→ 积木 → 生成代码
 * 然后把「生成代码」和「源码原文」做**语义比较**（忽略空白与花括号差异）——
 * 因为积木生成的代码本来就会重排缩进、给单行 if 补花括号，那是格式不是语义。
 *
 * 存在的意义：这个模块出过好几次「生成的代码和原文不一样」的 bug
 * （表达式被截断、声明被当函数调用…），全靠这个审计才发现。
 * 改 `buildBlocksFromGraph` / `makeBlockFor` / `emitOne` 之后**必须跑一遍**。
 *
 * 用法: node tests/blockly-roundtrip.js /绝对路径/文档.md
 */
/* 全量审计：遍历文档里每个函数，对比「原文」与「积木生成的代码」 */
const fs = require('fs');
const { chromium } = require('playwright-core');
const FILE = process.argv[2];
if (!FILE) { console.error('用法: node tests/blockly-roundtrip.js <文档绝对路径>'); process.exit(1); }
(async () => {
  const md = fs.readFileSync(FILE, 'utf8');
  const frags = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) frags.push(m[2]);

  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-gpu'] });
  const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  await p.goto('http://127.0.0.1:4877/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.evaluate((arg) => new Promise((r) => {
    const s = document.createElement('script');
    s.textContent = 'CURRENT = { file: ' + JSON.stringify(arg.file) + ', fragments: ' + JSON.stringify(arg.frags) + ' };';
    document.body.appendChild(s);
    setTimeout(r, 800);
  }), { file: FILE, frags: frags.map((c) => ({ language: 'c_cpp', code: c })) });

  /* 1) 用文档图谱拿所有函数 */
  const fns = await p.evaluate(async () => {
    const g = await (await fetch('/api/graph?scope=document&file=' + encodeURIComponent(CURRENT.file))).json();
    return (g.nodes || []).filter((n) => n.kind === 'fn').map((n) => ({ name: n.label, line: n.line, frag: n.frag }));
  });
  console.log('文档里的函数:', fns.length, '个:', fns.map((f) => f.name).join(', '));

  /* 2) 逐个函数：拿 CFG → 建积木 → 生成 */
  const results = [];
  for (const fn of fns) {
    const out = await p.evaluate(async (arg) => {
      const g = await (await fetch('/api/logic/graph', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: CURRENT.file, fragment: arg.frag, line: arg.line, name: arg.name }) })).json();
      if (!g || !g.ok) return { err: (g && g.error) || 'CFG 失败' };
      const nodes = (g.nodes || []);
      const entry = nodes.find((n) => n.kind === 'entry'), exit = nodes.find((n) => n.kind === 'exit');
      CINDEX = arg.frag;
      REL_ROOT = { kind: 'fn', name: arg.name, line: entry ? entry.line : arg.line, endLine: exit ? exit.line : arg.line, frag: arg.frag };
      await ensureBlockly(); defineCBlocks(); await loadDocFunctions();
      if (!BP_WORKSPACE) BP_WORKSPACE = window.Blockly.inject(document.createElement('div'), {});
      BP_BUILDING = true;
      BP_WORKSPACE.clear();
      const count = buildBlocksFromGraph(BP_WORKSPACE, g);
      BP_BUILDING = false;
      return { 语句数: count, 起始行: entry ? entry.line : null, 结束行: exit ? exit.line : null, 生成: blockJsonToCode(), CFG: nodes.map((n) => n.kind + '@' + n.line + ':' + String(n.label).slice(0, 50)) };
    }, { name: fn.name, line: fn.line, frag: fn.frag });

    if (out.err) { results.push({ fn: fn.name, err: out.err }); continue; }
    /* 3) 从本地片段里切原文 */
    const code = frags[fn.frag] || '';
    const lines = code.split('\n');
    const orig = lines.slice((out.起始行 || fn.line) - 1, out.结束行 || fn.line).join('\n');
    const norm = (t) => String(t).replace(/\/\/[^\n]*/g, '').replace(/[\s{}]+/g, '');
    const same = norm(orig) === norm(out.生成);
    results.push({ fn: fn.name, 语句数: out.语句数, 一致: same, 原文: orig, 生成: out.生成, CFG: out.CFG });
  }

  /* 4) 报告 */
  console.log('\n================ 审计结果 ================');
  let bad = 0;
  results.forEach((r) => {
    if (r.err) { console.log('✗ ' + r.fn + ' — ' + r.err); bad++; return; }
    console.log((r.一致 ? '✓ ' : '✗ ') + r.fn + '（' + r.语句数 + ' 条语句）' + (r.一致 ? '' : ' ← 不一致'));
    if (!r.一致) bad++;
  });
  console.log('\n共 ' + results.length + ' 个函数，' + bad + ' 个不一致');
  /* 打印第一个不一致的细节 */
  const bads = results.filter((r) => !r.err && !r.一致);
  for (const first of bads.slice(0, 3)) {
    console.log('\n=== 不一致：' + first.fn + ' ===');
    console.log('--- 原文 ---\n' + first.原文);
    console.log('--- 生成 ---\n' + first.生成);
    console.log('--- CFG ---');
    (first.CFG || []).forEach((c) => console.log('  ' + c));
  }
  console.log('\n页面错误:', errs.length ? errs.slice(0, 2).join(' | ') : '无 ✓');
  await b.close();
})();
