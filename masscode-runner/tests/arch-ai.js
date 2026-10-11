#!/usr/bin/env node
'use strict';
/*
 * 架构图「语义层」断言（lib/arch/ai.js）
 * ---------------------------------------------------------------------------
 * 为什么要有这个文件：
 *   2026-10-11 用户原话：**「缺少了很多 archify 该有的功能，没有接入 AI 去分析」** ✓。
 *   接 AI 之后，**最容易出事的不是请求、是解析** ✗ ——
 *   模型会写 ```json 围栏、会在 JSON 前后加解释、会编片段名、会漏片段、
 *   会把要点写成一段话 ✓。这些如果不在解析层收敛掉，
 *   **渲染层会被它带崩** ✓（少一张卡片、或者整张图白掉 ✓）。
 *
 * ⚠️ 所以这里**不调真模型** ✓（要 key、要网络、还不稳定 ✗）——
 *    `buildPrompt` / `extractJson` / `parseReply` 三个都是**纯函数** ✓，
 *    拿手搓的"模型回复"直接喂进去断言 ✓，毫秒级、可复现 ✓。
 *
 * 跑法：npm run test:archai
 */

const path = require('path');
const ai = require(path.resolve(__dirname, '..', 'lib', 'arch', 'ai.js'));

let pass = 0, fail = 0;
function ck(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name + (detail ? '  · ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  · ' + detail : '')); }
}

console.log('\n── ① 构 prompt ──');
{
  const doc = {
    name: '串口通信驱动',
    fragments: [
      { label: 'uart.h', language: 'c', code: '#ifndef UART_H\n#define UART_H\n#endif', functions: ['uart_init'] },
      { label: 'uart.c', language: 'c', code: 'void uart_init(){}', functions: ['uart_init', 'uart_open'] },
    ],
  };
  const p = ai.buildPrompt(doc);
  ck('system 里明确要求"只返回一个 JSON 对象"', /只返回\*\*一个 JSON 对象\*\*/.test(p.system));
  ck('system 里禁止 Markdown 围栏', /不要 Markdown 围栏/.test(p.system));
  ck('system 里给了字段说明', /"title"/.test(p.system) && /"groups"/.test(p.system) && /"nodes"/.test(p.system));
  ck('system 里强调片段标签要原样用', /原样/.test(p.system));
  ck('user 里带上了文档名', p.user.indexOf('串口通信驱动') >= 0);
  ck('user 里带上了每个片段的标签', p.user.indexOf('uart.h') >= 0 && p.user.indexOf('uart.c') >= 0);
  ck('user 里带上了函数名', p.user.indexOf('uart_open') >= 0);
  ck('user 里带上了代码', p.user.indexOf('void uart_init(){}') >= 0);
  ck('片段数写对了', /【片段数】2/.test(p.user));
}

console.log('\n── ② 从模型回复里抠 JSON（三种真实写法）──');
{
  const body = '{"title":"A","nodes":[]}';
  ck('裸 JSON', ai.extractJson(body) === body);
  ck('```json 围栏', ai.extractJson('```json\n' + body + '\n```') === body);
  ck('``` 围栏（无语言）', ai.extractJson('```\n' + body + '\n```') === body);
  ck('前后有解释文字', ai.extractJson('好的，这是结果：\n' + body + '\n希望有帮助！') === body);
  /* ⚠️ 解释里也带花括号 —— 只找第一个 `{` 会截错 ✓ */
  ck('解释里也有花括号时仍抠对', ai.extractJson('说明 {不是这个} 真正的在下面：\n' + body) === body);
  ck('字符串里的花括号不干扰配平', ai.extractJson('{"title":"a}b{c","nodes":[]}') === '{"title":"a}b{c","nodes":[]}');
  ck('完全没有 JSON → null', ai.extractJson('抱歉，我无法分析。') === null);
  ck('括号不闭合 → null', ai.extractJson('{"title":"A"') === null);
}

console.log('\n── ③ 解析 + 收敛（模型乱写也不会带崩渲染层）──');
{
  const labels = ['uart.h', 'uart.c', 'main.c'];
  const fns = ['uart_init', 'uart_open', 'main'];
  /* 故意写坏：编了一个不存在的片段、漏了一个真片段、分组漏了一个、
     要点写成一段长话、边的两端有一个是编的、标题超长 ✓ */
  const reply = '```json\n' + JSON.stringify({
    title: '这是一个特别特别特别特别特别特别长的标题超过了限制',
    tagline: '一句话说明。',
    groups: [
      { label: '接口', tone: 'policy', frags: ['uart.h', '不存在的片段'] },
      { label: '实现', tone: '瞎写的色调', frags: ['uart.c'] },
    ],
    nodes: [
      { frag: 'uart.h', title: '串口头文件', icon: 'policy', bullets: ['只放声明', '定义结构体', '第三条', '第四条'] },
      { frag: '不存在的片段', title: '编的', icon: 'x', bullets: ['a'] },
    ],
    edges: [
      { from: 'uart_init', to: 'uart_open', label: '初始化后打开' },
      { from: 'main', to: '编的函数', label: '不该出现' },
    ],
  }) + '\n```';

  const out = ai.parseReply(reply, labels, fns);
  ck('title 被截断到 16 字以内', out.title.length <= 16, out.title);
  ck('编出来的片段被丢掉', out.nodes.every((n) => labels.indexOf(n.frag) >= 0));
  ck('漏掉的片段被补上（main.c）', out.nodes.some((n) => n.frag === 'main.c'));
  ck('nodes 顺序 = 服务端给的片段顺序', out.nodes.map((n) => n.frag).join(',') === labels.join(','));
  ck('要点最多 3 条', out.nodes.find((n) => n.frag === 'uart.h').bullets.length === 3);
  ck('非法的 icon 收敛成 code', out.nodes.find((n) => n.frag === 'main.c').icon === 'code');
  ck('非法 tone 收敛成 other', out.groups.find((g) => g.label === '实现').tone === 'other');
  ck('分组漏掉的片段进「其它」组', out.groups.some((g) => g.label === '其它' && g.frags.indexOf('main.c') >= 0));
  ck('编出来的边被丢掉', out.edges.length === 1 && out.edges[0].from === 'uart_init');
  ck('合法边保留且带标签', out.edges[0].label === '初始化后打开');
}

console.log('\n── ④ 退化输入不炸 ──');
{
  const t = (name, fn) => { let e = ''; try { fn(); } catch (err) { e = String(err.message || err); } ck(name, e === '', e); };
  t('空字符串 → 抛「找不到 JSON」而不是 TypeError', () => {
    let threw = '';
    try { ai.parseReply('', ['a'], []); } catch (err) { threw = String(err.message); }
    if (!/找不到 JSON/.test(threw)) throw new Error('抛的是：' + threw);
  });
  t('JSON 语法错 → 抛「解析失败」', () => {
    let threw = '';
    try { ai.parseReply('{不是合法 json}', ['a'], []); } catch (err) { threw = String(err.message); }
    if (!/解析失败/.test(threw)) throw new Error('抛的是：' + threw);
  });
  t('groups/nodes/edges 全缺 → 不炸，且每个片段都有卡片', () => {
    const out = ai.parseReply('{"title":"X"}', ['a', 'b'], []);
    if (out.nodes.length !== 2) throw new Error('nodes 数不对：' + out.nodes.length);
    if (out.groups.length !== 1) throw new Error('应该兜成一个组');
  });
  t('fragLabels 是空数组 → 不炸', () => { ai.parseReply('{"title":"X"}', [], []); });
}

console.log('');
console.log('架构图语义层：' + pass + '/' + (pass + fail) + ' 项通过' + (fail ? '，失败 ' + fail + ' 项' : ''));
if (fail) process.exit(1);
console.log('\n全部通过 ✅');
