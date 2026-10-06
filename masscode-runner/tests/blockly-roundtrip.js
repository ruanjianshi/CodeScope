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
  while ((m = re.exec(md)) !== null) frags.push({ language: (m[1] || 'plain_text').toLowerCase(), code: m[2] });

  /* ⚠️ 只审计 C/C++ 片段。文档里常常混着 html / javascript 块（比如带可视化页面的笔记），
     拿它们当 C 解析必然「不一致」—— 那是**假阳性**，会把真正的 bug 淹没在噪声里
     （实测：C++排序算法.md 里一个 html 块就贡献了 3 个假失败）。 */
  const C_LIKE = ['c_cpp', 'c', 'cpp', 'c++', 'cc', 'cxx', 'h', 'hpp'];
  const cFrags = frags.map((f, i) => (C_LIKE.indexOf(f.language) >= 0 ? i : -1)).filter((i) => i >= 0);
  console.log('片段: ' + frags.length + ' 个（C/C++ ' + cFrags.length + ' 个：' + frags.map((f, i) => i + ':' + f.language).join(', ') + '）');
  if (!cFrags.length) { console.error('这个文档里没有 C/C++ 片段，没什么可审的'); process.exit(0); }

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
  }), { file: FILE, frags: frags.map((f) => ({ language: f.language, code: f.code })) });

  /* 1) 用文档图谱拿所有函数（只留 C/C++ 片段里的） */
  const fns = await p.evaluate(async (keep) => {
    const g = await (await fetch('/api/graph?scope=document&file=' + encodeURIComponent(CURRENT.file))).json();
    return (g.nodes || []).filter((n) => n.kind === 'fn' && keep.indexOf(n.frag) >= 0).map((n) => ({ name: n.label, line: n.line, frag: n.frag }));
  }, cFrags);
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
    const code = (frags[fn.frag] || {}).code || '';
    const lines = code.split('\n');
    const orig = lines.slice((out.起始行 || fn.line) - 1, out.结束行 || fn.line).join('\n');
    /* 语义比较：忽略「格式」差异 —— 缩进/空白/花括号（积木生成本来就会重排缩进、
       给单行 if 补花括号）以及**注释**（积木模型不携带注释，生成时必然丢弃）。
       ⚠️ 块注释（斜杠星号那种）必须一起剥掉：只剥行注释的话，
       带块注释的函数会全被误报成「不一致」，把真正的 bug 淹没在噪声里（实测踩过）。 */
    const norm = (t) => String(t)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/[\s{}]+/g, '');
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
  /* 只打印结果不算守门：有函数不一致（或 CFG/构建失败）必须给非 0 退出码 */
  console.log('积木往返审计：' + (bad ? '✗ 失败（' + bad + ' 个函数）' : '✓ 通过'));
  await b.close();
  if (bad) process.exit(1);
})().catch((e) => { console.error('测试本身出错:', (e && e.stack) || e); process.exit(1); });
