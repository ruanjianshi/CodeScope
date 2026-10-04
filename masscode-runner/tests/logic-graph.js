'use strict';
/**
 * 逻辑图解析器回归测试
 * ---------------------------------------------------------------------------
 * buildLogicGraph 是结构化 CFG 解析（if/else/for/while/switch 的真实嵌套 + 控制边），
 * 之前完全没有测试，改一次就容易把控制流画错（已经踩过两个坑：
 * return 之后还往下连、if 缺 false 分支）。这里把关键语义钉死。
 *
 * 运行：node tests/logic-graph.js
 */

const assert = require('assert');
const { buildLogicGraph, logicToSkeleton, logicToDrawio } = require('../lib/logic-graph');

let passed = 0;
const ok = (cond, message) => { assert(cond, message); passed++; };

const build = (lines, name = 'f') => buildLogicGraph(lines.join('\n'), { language: 'c_cpp', name });
const find = (g, kind) => g.nodes.filter((n) => n.kind === kind);
const labelOf = (g, id) => (g.nodes.find((n) => n.id === id) || {}).label;
const edgesFrom = (g, id) => g.edges.filter((e) => e.from === id);
const edgesTo = (g, id) => g.edges.filter((e) => e.to === id);

/* ── ① 基本骨架 ── */
{
  const g = build(['void f(void){', '  g();', '}']);
  ok(g.ok === true, 'ok 应为 true');
  ok(g.nodes[0].kind === 'entry' && g.nodes[0].label === '开始', '第一个节点是「开始」');
  ok(g.nodes[g.nodes.length - 1].kind === 'exit', '最后一个节点是「结束」');
  ok(find(g, 'call').length === 1, 'g(); 识别为 call 节点');
  ok(!g.nodes.some((n) => /^void f/.test(n.label)), '函数签名不应成为节点');
}

/* ── ② 注释不是节点，空行不是节点 ── */
{
  const g = build(['void f(void){', '  // 这是注释', '  /* 块注释 */', '  g();', '}']);
  ok(g.nodes.length === 3, '注释行不进图（开始 + g() + 结束）');
  ok(!g.nodes.some((n) => n.label.includes('注释')), '注释内容不应出现在标签里');
}

/* ── ③ if 无 else：必须有 true 和 false 两条边 ── */
{
  const g = build(['void f(int v){', '  if (v < 0) {', '    return;', '  }', '  g();', '}']);
  const branch = find(g, 'branch')[0];
  ok(!!branch, '识别出分支节点');
  ok(branch.label === 'if (v < 0)', '条件带关键字：if (v < 0)');
  const outs = edgesFrom(g, branch.id);
  ok(outs.some((e) => e.label === 'true'), '有 true 分支');
  ok(outs.some((e) => e.label === 'false'), '无 else 时也要有 false 分支（直接往下走）');
  const ret = find(g, 'return')[0];
  ok(!edgesFrom(g, ret.id).some((e) => e.label === 'next' && labelOf(g, e.to) === 'g();'),
    'return 之后不能连到后续语句（终止路径）');
}

/* ── ④ if/else：两个分支各自连向结束 ── */
{
  const g = build(['int f(int v){', '  if (v < 0) {', '    return -1;', '  } else {', '    return 1;', '  }', '}']);
  const branch = find(g, 'branch')[0];
  const outs = edgesFrom(g, branch.id);
  ok(outs.some((e) => e.label === 'true'), 'if/else 有 true 边');
  ok(outs.some((e) => e.label === 'false'), 'if/else 有 false 边');
  ok(find(g, 'return').length === 2, '两个 return 各成一个节点');
}

/* ── ⑤ for / while：有回边，且退出路径存在 ── */
{
  const g = build(['void f(void){', '  for (int i = 0; i < 3; i++) {', '    g(i);', '  }', '  h();', '}']);
  const loop = find(g, 'loop')[0];
  ok(loop.label === 'for (int i = 0; i < 3; i++)', 'for 保留关键字与条件');
  const body = find(g, 'call')[0];
  ok(edgesFrom(g, body.id).some((e) => e.to === loop.id && e.label === 'loop'), '有回到循环头的回边');
  ok(edgesFrom(g, loop.id).some((e) => e.label === 'next'), '有退出循环的路径');
}
{
  const g = build(['void f(int v){', '  while (v > 10) { v--; }', '}']);
  const loop = find(g, 'loop')[0];
  ok(loop && loop.label === 'while (v > 10)', '单行 while 也能取到条件');
}

/* ── ⑥ 单行 / 无花括号写法 ── */
{
  const g = build(['int f(int v){', '  if (v < 0) return -1;', '  return 0;', '}']);
  const branch = find(g, 'branch')[0];
  ok(branch && branch.label === 'if (v < 0)', '无花括号的 if 也能取到条件');
  ok(find(g, 'return').length === 2, '同一行的 return 也要成为节点');
}
{
  const g = build(['int f(void){', '  if (cmp(a, b) > 0) { g(); }', '  return 0;', '}']);
  ok(find(g, 'branch')[0].label === 'if (cmp(a, b) > 0)', '嵌套括号的条件不被截断');
}

/* ── ⑦ 行号要能对上源码（点节点跳转依赖它）── */
{
  const g = build(['void f(int v){', '  if (v < 0) {', '    g();', '  }', '  h();', '}']);
  ok(find(g, 'branch')[0].line === 2, 'if 在第 2 行');
  ok(find(g, 'call').find((n) => n.label.startsWith('g')) .line === 3, 'g() 在第 3 行');
  ok(find(g, 'call').find((n) => n.label.startsWith('h')) .line === 5, 'h() 在第 5 行');
}

/* ── ⑧ 派生输出仍可用 ── */
{
  const g = build(['int f(int v){', '  if (v < 0) { return -1; }', '  return v;', '}']);
  const skel = logicToSkeleton(g, { language: 'c_cpp', fnName: 'f' });
  ok(skel.ok && skel.code.includes('if (v < 0)'), '骨架里有正确的 if');
  ok(skel.code.includes('return -1;'), '骨架保留返回值');
  ok(!skel.code.includes('if (if'), '骨架不出现 if (if');
  const xml = logicToDrawio(g, { title: 'f' });
  ok(String(xml).includes('mxGraphModel'), 'drawio 导出含 mxGraphModel');
  ok(!/value="undefined"/.test(String(xml)), 'drawio 里没有 undefined 标签');
}

/* ── ⑨ 复杂一点的真实函数（静态池分配）── */
{
  const g = build([
    'led_t *led_create(const led_config_t *config, const led_ops_t *ops)',
    '{',
    '    if (pool_count >= STATICPOOLSIZE) {',
    '        LOG_ERROR("静态池已满");',
    '        return NULL;',
    '    }',
    '    pool_array[pool_count].config = config;',
    '    pool_array[pool_count].status = 0;',
    '    return &pool_array[pool_count];',
    '}',
  ], 'led_create');
  const branch = find(g, 'branch')[0];
  ok(branch && branch.label === 'if (pool_count >= STATICPOOLSIZE)', '真实条件提取正确');
  ok(find(g, 'stmt').length === 2, '两条赋值语句各成一个节点');
  ok(edgesFrom(g, branch.id).some((e) => e.label === 'false'), '静态池未满的路径存在');
  const retNull = find(g, 'return').find((n) => n.label.includes('NULL'));
  ok(retNull && !edgesFrom(g, retNull.id).some((e) => find(g, 'stmt').some((s) => s.id === e.to)),
    'return NULL 不连到后面的赋值');
}

console.log('逻辑图解析器测试：' + passed + ' 项通过');
