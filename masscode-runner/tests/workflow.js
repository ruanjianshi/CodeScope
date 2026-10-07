#!/usr/bin/env node
'use strict';

/* ── 工作流引擎的回归 ────────────────────────────────────────────────────
   纯逻辑、无 DOM ✓，直接跑 ✓（不建浏览器 ✓，不联网 ✓ —— fetch 是注入的 ✓）。
   ★ 引擎**不落地任何输出** ✗ —— 只产出 effects ✓，由前端应用 ✓。
     这条是硬约束 ✓（否则「跑一次工作流」会偷偷改用户数据 ✗），下面有断言守着 ✓。 */

const W = require('../lib/workflow.js');

let passed = 0, failed = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { console.log('  ✓ ' + name); passed++; }
  else { console.log('  ✗ ' + name + '\n      实际 ' + a + '\n      期望 ' + b); failed++; }
};
const ok = (name, cond, extra) => {
  if (cond) { console.log('  ✓ ' + name); passed++; }
  else { console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); failed++; }
};
const node = (id, type, cfg) => ({ id, type, x: 0, y: 0, cfg: cfg || {} });
const edge = (from, port, to) => ({ from, port: port || 0, to });
const run = (nodes, edges, extra) => W.runFlow({ nodes, edges }, Object.assign({ fetch: async () => ({ status: 200, ok: true, text: async () => '{}' }) }, extra || {}));

(async () => {
  console.log('工作流引擎\n');

  console.log('── ① 变量替换 ──');
  eq('{{a}} 取顶层', W.renderTpl('x={{a}}', { a: '1' }, null), 'x=1');
  eq('{{a.b.c}} 走路径', W.renderTpl('{{a.b.c}}', { a: { b: { c: '深' } } }, null), '深');
  eq('{{a.b[1]}} 数组下标', W.renderTpl('{{a.b[1]}}', { a: { b: ['零', '一'] } }, null), '一');
  eq('{{input}} 取上游', W.renderTpl('{{input}}', {}, '上游值'), '上游值');
  eq('对象自动转 JSON', W.renderTpl('{{a}}', { a: { k: 1 } }, null), '{\n  "k": 1\n}');
  eq('认不出的变量 → 空串（不报错）', W.renderTpl('[{{nope.x}}]', {}, null), '[]');
  eq('getPath 数组', W.getPath({ a: [{ b: 9 }] }, 'a[0].b'), 9);
  eq('getPath 缺字段 → undefined', W.getPath({}, 'a.b'), undefined);

  console.log('\n── ② 拓扑排序 ──');
  eq('线性图按序', W.topoSort([node('a', 'x'), node('b', 'x'), node('c', 'x')], [edge('a', 0, 'b'), edge('b', 0, 'c')]), ['a', 'b', 'c']);
  {
    let threw = '';
    try { W.topoSort([node('a', 'x'), node('b', 'x')], [edge('a', 0, 'b'), edge('b', 0, 'a')]); }
    catch (e) { threw = e.message; }
    ok('★ 有环直接报错（不能死循环）', /环/.test(threw), threw || '(没报错)');
  }

  console.log('\n── ③ 跑一张最简单的图 ──');
  {
    const r = await run([node('t', 'trigger.manual'), node('tp', 'data.template', { text: '触发时间 {{t.at}}' })], [edge('t', 0, 'tp')]);
    eq('两步都 ok', r.steps.map((s) => s.status), ['ok', 'ok']);
    ok('模板拿到了上游的值', /触发时间 \d+/.test(String(r.vars.tp)), String(r.vars.tp));
  }

  console.log('\n── ④ JSON 取值 ──');
  {
    const r = await run([
      node('t', 'trigger.manual'),
      node('j', 'data.json', { path: 'items[1].name' }),
    ], [edge('t', 0, 'j')], { });
    /* 上游是 {fired:true, at:…} → 取 items 取不到 ✓，应为 null ✓ */
    eq('上游里没有 items → null（不报错）', r.vars.j, null);
  }
  {
    const r = await run([
      node('h', 'http.request', { url: 'https://x.test/api', method: 'GET' }),
      node('j', 'data.json', { path: 'data.list[0].title' }),
    ], [edge('h', 0, 'j')], {
      fetch: async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ data: { list: [{ title: '第一条' }] } }) }),
    });
    eq('HTTP 拿回 body', typeof r.vars.h.body, 'string');
    eq('★ HTTP 顺手解析了 JSON（不用再挂一个解析节点）', r.vars.h.json && r.vars.h.json.data.list[0].title, '第一条');
    eq('★ 下游 JSON 节点以它为根取值', r.vars.j, '第一条');
  }

  console.log('\n── ⑤ 条件分支：没走的那条要跳过 ──');
  {
    const r = await run([
      node('t', 'trigger.manual'),
      node('i', 'logic.if', { left: '{{t.fired}}', op: '等于', right: 'true' }),
      node('yes', 'data.template', { text: '走真分支' }),
      node('no', 'data.template', { text: '走假分支' }),
      node('after', 'data.template', { text: '汇合' }),
    ], [edge('t', 0, 'i'), edge('i', 0, 'yes'), edge('i', 1, 'no'), edge('yes', 0, 'after')]);
    const byId = Object.fromEntries(r.steps.map((s) => [s.id, s]));
    eq('条件判定为真', byId.i.out.ok, true);
    eq('真分支跑了', byId.yes.status, 'ok');
    eq('★ 假分支被跳过', byId.no.status, 'skipped');
    eq('真分支的下游跑了', byId.after.status, 'ok');
  }
  {
    const r = await run([
      node('t', 'trigger.manual'),
      node('i', 'logic.if', { left: 'a', op: '等于', right: 'b' }),
      node('no', 'data.template', { text: '假分支' }),
    ], [edge('t', 0, 'i'), edge('i', 1, 'no')]);
    const byId = Object.fromEntries(r.steps.map((s) => [s.id, s]));
    eq('判定为假', byId.i.out.ok, false);
    eq('假分支跑了', byId.no.status, 'ok');
  }

  console.log('\n── ⑥ 各种比较符 ──');
  for (const [op, l, r, want] of [['包含', 'hello world', 'world', true], ['等于', 'a', 'a', true], ['不等于', 'a', 'b', true], ['大于', '10', '3', true], ['小于', '3', '10', true], ['非空', 'x', '', true], ['为空', '', '', true], ['正则匹配', 'abc123', '\\d+', true]]) {
    const res = await run([node('t', 'trigger.manual'), node('i', 'logic.if', { left: l, op, right: r })], [edge('t', 0, 'i')]);
    eq('「' + op + '」' + l + ' / ' + r, res.vars.i.ok, want);
  }

  console.log('\n── ⑦ ★ 输出节点只产出 effects，不落地 ──');
  {
    const r = await run([
      node('t', 'trigger.manual'),
      node('m', 'out.memo', { folder: '工作流', title: '标题 {{t.fired}}', text: '正文' }),
      node('j', 'out.journal', { text: '日记内容' }),
      node('n', 'out.notify', { text: '提醒一下' }),
      node('e', 'out.mail', { to: 'a@b.c', subject: '主题', body: '正文' }),
    ], [edge('t', 0, 'm'), edge('m', 0, 'j'), edge('j', 0, 'n'), edge('n', 0, 'e')]);
    eq('产出 4 个 effect', r.effects.length, 4);
    eq('effect 类型', r.effects.map((e) => e.kind), ['memo', 'journal', 'notify', 'mail']);
    eq('★ effect 里带上了 nodeId（前端要知道是哪一步产出的）', r.effects.every((e) => !!e.nodeId), true);
    ok('模板在 effect 里也解析过了', r.effects[0].title === '标题 true', JSON.stringify(r.effects[0].title));
  }

  console.log('\n── ⑧ AI 节点 ──');
  {
    let seen = null;
    const r = await W.runFlow({ nodes: [node('t', 'trigger.manual'), node('a', 'ai.chat', { system: '你是助手', prompt: '总结：{{input}}' })], edges: [edge('t', 0, 'a')] }, {
      fetch: async () => ({ status: 200, ok: true, text: async () => '{}' }),
      ai: { url: 'https://ai.test/v1/chat', key: 'k', model: 'm' },
      aiChat: async (cfg, messages) => { seen = { cfg, messages }; return '这是 AI 的回答'; },
    });
    eq('AI 输出进 vars', r.vars.a.text, '这是 AI 的回答');
    eq('system 提示带上了', seen.messages[0].role, 'system');
    eq('user 提示解析了变量', /总结：/.test(seen.messages[1].content), true);
    eq('模型配置透传', seen.cfg.model, 'm');
  }
  {
    let threw = '';
    try {
      await W.runFlow({ nodes: [node('t', 'trigger.manual'), node('a', 'ai.chat', { prompt: 'x' })], edges: [edge('t', 0, 'a')] }, { fetch: async () => ({ status: 200, ok: true, text: async () => '{}' }) });
    } catch (e) { threw = e.message; }
    ok('★ 没配 AI 时给**明确的**报错（不是静默失败）', /没配 AI/.test(threw), threw || '(没报错)');
  }

  console.log('\n── ⑨ 出错时要带上下文 ──');
  {
    let err = null;
    try {
      await run([node('t', 'trigger.manual'), node('h', 'http.request', { url: 'ftp://bad' })], [edge('t', 0, 'h')]);
    } catch (e) { err = e; }
    ok('URL 不合法时报错', err && /URL 不合法/.test(err.message), err && err.message);
    ok('★ 报错时带上是哪个节点', err && err.nodeId === 'h', err && err.nodeId);
    ok('★ 报错时带上已经跑过的步骤（前端能显示日志）', err && Array.isArray(err.steps) && err.steps.length === 2, err && String(err.steps && err.steps.length));
  }
  {
    let err = null;
    try { await run([node('t', 'trigger.manual'), node('z', 'bogus.type')], [edge('t', 0, 'z')]); } catch (e) { err = e; }
    ok('不认识的节点类型报错', err && /不认识的节点类型/.test(err.message), err && err.message);
  }
  {
    let err = null;
    try { await run([], []); } catch (e) { err = e; }
    ok('空图报错', err && /一个节点都没有/.test(err.message), err && err.message);
  }

  console.log('\n── ⑩ delay 与合并 ──');
  {
    const t0 = Date.now();
    const r = await run([node('t', 'trigger.manual'), node('d', 'util.delay', { ms: '60' })], [edge('t', 0, 'd')]);
    ok('等待节点真的等了', Date.now() - t0 >= 50, String(Date.now() - t0) + 'ms');
    eq('返回等待时长', r.vars.d.waited, 60);
  }
  {
    const r = await run([
      node('a', 'trigger.manual'), node('b', 'trigger.manual'),
      node('m', 'logic.merge'), node('tp', 'data.template', { text: '{{value}}' }),
    ], [edge('a', 0, 'm'), edge('b', 0, 'm'), edge('m', 0, 'tp')]);
    eq('合并节点拿到输入', r.steps.find((s) => s.id === 'm').status, 'ok');
  }

  console.log('\n' + (failed ? '失败 ' + failed + ' 项 / 共 ' + (passed + failed) : '工作流引擎：' + passed + ' 项通过 ✓'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('✗ 异常: ' + e.message); process.exit(1); });
