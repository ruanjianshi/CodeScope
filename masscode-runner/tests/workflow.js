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

  /* ══════════════════════════════════════════════════════════════════════
     以下是对齐 n8n 的那批新东西 ✓（用户原话：「工作流的功能太少，参考 N8N 的完整设计」✓）
     ══════════════════════════════════════════════════════════════════════ */

  console.log('\n── ⑪ 表达式（n8n 风格）──');
  {
    const list = [{ t: 'c', n: 3 }, { t: 'a', n: 1 }, { t: 'b', n: 2 }];
    const f = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ data: { list } }) });
    const r = await W.runFlow({
      nodes: [
        node('t', 'trigger.manual'),
        node('h', 'http.request', { url: 'https://x.test' }),
        node('j', 'data.json', { path: 'data.list' }),
        node('s', 'data.set', { assign: '大写 = $json.t.toUpperCase()' }),
        node('tp', 'data.template', { text: '{{ $json[0].大写 }} / {{ $json.length }} / {{ $json[0].t }} / {{ $json.length + 1 }}' }),
      ],
      edges: [edge('t', 0, 'h'), edge('h', 0, 'j'), edge('j', 0, 's'), edge('s', 0, 'tp')],
    }, { fetch: f });
    eq('★ 数组输入时逐条改（n8n 的 items 思路）', r.vars.s.map((x) => x.大写).join(''), 'CAB');
    eq('★ 模板里能做算术、能用下标', r.vars.tp, 'C / 3 / c / 4');
  }
  {
    /* 单个对象输入时，set 就是普通的「编辑字段」✓ */
    const r = await run([
      node('a', 'trigger.manual'),
      node('s', 'data.set', { assign: '甲 = $json.fired\n乙 = $json.甲 ? "有" : "无"' }),
    ], [edge('a', 0, 's')]);
    eq('★ 对象输入时正常赋值（还能引用刚赋的值）', [r.vars.s.甲, r.vars.s.乙], [true, '有']);
  }
  {
    const r = await W.runFlow({
      nodes: [
        node('a', 'trigger.manual'),
        node('b', 'data.template', { text: 'B 节点' }),
        node('c', 'data.template', { text: '拿到 A 的名字：{{ $node["甲"].value }}' }),
      ],
      edges: [edge('a', 0, 'b'), edge('b', 0, 'c')],
    });
    /* 给节点起名字 ✓ —— $node["名字"] 才认得 ✓ */
    r.steps.forEach((s) => { if (s.id === 'b') s.name = '甲'; });
    const g2 = {
      nodes: [
        Object.assign(node('a', 'trigger.manual'), { name: '开始' }),
        Object.assign(node('b', 'data.template', { text: 'B' }), { name: '甲' }),
        Object.assign(node('c', 'data.template', { text: 'A={{ $node["开始"].fired }} B={{ $node["甲"] }}' }), { name: '乙' }),
      ],
      edges: [edge('a', 0, 'b'), edge('b', 0, 'c')],
    };
    const r2 = await W.runFlow(g2);
    eq('★ $node["节点名"] 能取到别的节点输出', String(r2.vars.c).slice(0, 6), 'A=true');
  }
  {
    const r = await run([
      node('a', 'trigger.manual'),
      node('b', 'data.template', { text: '{{ $now > 0 ? "有时间" : "没时间" }}' }),
    ], [edge('a', 0, 'b')]);
    eq('★ $now 能用', r.vars.b, '有时间');
  }
  {
    /* 向后兼容：老写法一个都不能坏 ✓ */
    const r = await run([
      node('a', 'trigger.manual'),
      node('b', 'data.template', { text: '老写法={{a.fired}} 新写法={{ $json.fired }}' }),
    ], [edge('a', 0, 'b')]);
    eq('★ 老写法 {{节点id.字段}} 仍然能用', r.vars.b, '老写法=true 新写法=true');
  }

  console.log('\n── ⑫ 节点设置（禁用 / 重试 / 出错继续 / 备注）──');
  {
    const r = await run([
      node('a', 'trigger.manual'),
      Object.assign(node('b', 'data.template', { text: '不该跑' }), { disabled: true }),
      node('c', 'data.template', { text: 'c 拿到 {{ $json.fired }}' }),
    ], [edge('a', 0, 'b'), edge('b', 0, 'c')]);
    eq('★ 禁用的节点被跳过', r.steps.find((s) => s.id === 'b').status, 'disabled');
    eq('★ 但它**直通**（下游照样跑）', r.vars.c, 'c 拿到 true');
  }
  {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 3) throw new Error('网络抖了一下');
      return { status: 200, ok: true, text: async () => '{"ok":1}' };
    };
    const r = await W.runFlow({
      nodes: [
        node('a', 'trigger.manual'),
        Object.assign(node('h', 'http.request', { url: 'https://x.test' }), { retry: 3, retryDelay: 0 }),
      ],
      edges: [edge('a', 0, 'h')],
    }, { fetch: flaky });
    eq('★ 重试 3 次之后成功了', r.steps.find((s) => s.id === 'h').status, 'ok');
    eq('★ 记下了试了几次', r.steps.find((s) => s.id === 'h').attempts, 3);
    eq('  真的调了 3 次', calls, 3);
  }
  {
    let err = null;
    try {
      await run([
        node('a', 'trigger.manual'),
        Object.assign(node('h', 'http.request', { url: '不是网址' }), { retry: 2, retryDelay: 0 }),
      ], [edge('a', 0, 'h')]);
    } catch (e) { err = e; }
    ok('重试完还是失败 → 抛错', !!err, err && err.message);
    eq('  报错里带上重试次数', err.steps.find((s) => s.id === 'h').attempts, 3);
  }
  {
    const r = await run([
      node('a', 'trigger.manual'),
      Object.assign(node('h', 'http.request', { url: '不是网址' }), { onError: 'continue' }),
      node('c', 'data.template', { text: '失败了吗：{{ $json.failed }}｜原因：{{ $json.error }}' }),
    ], [edge('a', 0, 'h'), edge('h', 0, 'c')]);
    eq('★ 出错继续 → 后面的节点照样跑', r.steps.find((s) => s.id === 'c').status, 'ok');
    ok('★ 下游能拿到失败信息', /失败了吗：true/.test(r.vars.c), r.vars.c);
    eq('  出错那步标了 continued', r.steps.find((s) => s.id === 'h').continued, true);
  }
  {
    /* 默认（没设 onError）还是**停** ✓ —— 不能悄悄变成「出错也继续」✗ */
    let err = null;
    try { await run([node('a', 'trigger.manual'), node('h', 'http.request', { url: '不是网址' })], [edge('a', 0, 'h')]); }
    catch (e) { err = e; }
    ok('★ 默认仍然「出错就停」', !!err, err && err.message);
  }

  console.log('\n── ⑬ 多路分支（switch）──');
  {
    const mk = (v) => ({
      nodes: [
        node('a', 'trigger.manual'),
        node('s', 'logic.switch', { value: v, case1: '红', case2: '黄', case3: '绿' }),
        node('r', 'data.template', { text: '走红' }),
        node('y', 'data.template', { text: '走黄' }),
        node('g', 'data.template', { text: '走绿' }),
        node('e', 'data.template', { text: '都没中' }),
      ],
      edges: [edge('a', 0, 's'), edge('s', 0, 'r'), edge('s', 1, 'y'), edge('s', 2, 'g'), edge('s', 3, 'e')],
    });
    const st = async (v) => {
      const r = await W.runFlow(mk(v));
      const got = r.steps.filter((s) => ['r', 'y', 'g', 'e'].indexOf(s.id) >= 0 && s.status === 'ok').map((s) => s.id);
      return got.join(',');
    };
    eq('★ case1 命中 → 只走第一个口', await st('红'), 'r');
    eq('★ case2 命中', await st('黄'), 'y');
    eq('★ case3 命中', await st('绿'), 'g');
    eq('★ 都不中 → 走 else 口', await st('蓝'), 'e');
  }

  console.log('\n── ⑭ 列表节点（n8n 的 items 思路）──');
  {
    const list = [{ t: 'c', n: 3 }, { t: 'a', n: 1 }, { t: 'b', n: 2 }, { t: 'a', n: 9 }];
    const f = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ data: { list } }) });
    const base = [node('t', 'trigger.manual'), node('h', 'http.request', { url: 'https://x.test' }), node('j', 'data.json', { path: 'data.list' })];
    const e0 = [edge('t', 0, 'h'), edge('h', 0, 'j')];
    const go = async (n) => W.runFlow({ nodes: base.concat([n]), edges: e0.concat([edge('j', 0, n.id)]) }, { fetch: f });

    const s = await go(node('x', 'list.sort', { by: '$json.t', dir: 'asc' }));
    eq('★ 排序（按字段）', s.vars.x.map((x) => x.t).join(''), 'aabc');
    const sd = await go(node('x', 'list.sort', { by: '$json.n', dir: 'desc' }));
    eq('★ 排序（数字倒序）', sd.vars.x.map((x) => x.n).join(','), '9,3,2,1');
    const u = await go(node('x', 'list.unique', { by: '$json.t' }));
    eq('★ 去重（按字段）', u.vars.x.map((x) => x.t).join(','), 'c,a,b');
    const fl = await go(node('x', 'list.filter', { left: '{{ $json.n }}', op: '大于', right: '1' }));
    eq('★ 过滤', fl.vars.x.map((x) => x.n).join(','), '3,2,9');
    const li = await go(node('x', 'list.limit', { n: '2' }));
    eq('★ 取前 2 条', li.vars.x.length, 2);
    const li2 = await go(node('x', 'list.limit', { n: '2', skip: '2' }));
    eq('★ 跳过 2 条再取 2 条', li2.vars.x.map((x) => x.n).join(','), '2,9');
    const ag = await go(node('x', 'list.aggregate', { op: '求和', field: '$json.n' }));
    eq('★ 聚合求和', ag.vars.x.value, 15);
    eq('  聚合计数', (await go(node('x', 'list.aggregate', { op: '计数' }))).vars.x.value, 4);
    eq('  聚合平均', (await go(node('x', 'list.aggregate', { op: '平均', field: '$json.n' }))).vars.x.value, 3.75);
    eq('  聚合最大', (await go(node('x', 'list.aggregate', { op: '最大', field: '$json.n' }))).vars.x.value, 9);
    eq('  聚合拼接', (await go(node('x', 'list.aggregate', { op: '拼接', field: '$json.t', sep: '-' }))).vars.x.value, 'c-a-b-a');
    const sp = await go(node('x', 'list.split', { size: '3' }));
    eq('★ 拆分（每 3 条一批）', sp.vars.x.length, 2);
    eq('  第二批只有 1 条', sp.vars.x[1].length, 1);
    /* 合并：两个列表接起来 ✓（两个入口都是数组 → 引擎给「数组的数组」✓） */
    const mg = await run([
      node('a', 'trigger.manual'),
      node('s', 'data.set', { assign: '甲 = [1,2]\n乙 = [3,4,5]' }),
      node('l1', 'data.json', { path: '甲' }),
      node('l2', 'data.json', { path: '乙' }),
      node('m', 'list.merge', {}),
      node('c', 'list.aggregate', { op: '计数' }),
    ], [
      edge('a', 0, 's'), edge('s', 0, 'l1'), edge('s', 0, 'l2'),
      edge('l1', 0, 'm'), edge('l2', 0, 'm'), edge('m', 0, 'c'),
    ]);
    eq('★ 两个列表合并成 5 条', mg.vars.c.value, 5);
    eq('  合并后顺序也对', mg.vars.m.join(''), '12345');
  }
  {
    let err = null;
    try { await run([node('a', 'trigger.manual'), node('x', 'list.filter', { left: '1', op: '等于', right: '1' })], [edge('a', 0, 'x')]); }
    catch (e) { err = e; }
    ok('★ 上游不是数组 → 报错说得清楚（不是静默空）', err && /不是数组/.test(err.message), err && err.message);
  }

  console.log('\n── ⑮ 编辑字段 / 代码 / 日期 / 哈希 ──');
  {
    const r = await run([
      node('a', 'trigger.manual'),
      node('s', 'data.set', { assign: '标题 = "新标题"\n价格 = 10 * 2', remove: 'at,fired' }),
    ], [edge('a', 0, 's')]);
    eq('★ 赋值生效', r.vars.s.标题, '新标题');
    eq('★ 算出来的值也对', r.vars.s.价格, 20);
    ok('★ remove 里的字段被删了', r.vars.s.at === undefined && r.vars.s.fired === undefined, JSON.stringify(r.vars.s));
  }
  {
    const r = await run([
      node('a', 'trigger.manual'),
      node('c', 'data.code', { code: '甲 = $json.fired\n乙 = 甲 ? "有" : "无"\n丙 = 1 + 2\n# 这行是注释，跳过\n' }),
    ], [edge('a', 0, 'c')]);
    eq('★ 代码节点：逐行赋值', [r.vars.c.甲, r.vars.c.乙, r.vars.c.丙], [true, '有', 3]);
  }
  {
    let err = null;
    try { await run([node('a', 'trigger.manual'), node('c', 'data.code', { code: '这行没有等号' })], [edge('a', 0, 'c')]); }
    catch (e) { err = e; }
    ok('★ 代码写错 → 报第几行（不是静默）', err && /第 1 行/.test(err.message), err && err.message);
  }
  {
    const r = await run([
      node('a', 'trigger.manual'),
      node('d', 'data.date', { mode: 'format', value: '2026-10-07T12:34:56', format: 'YYYY/MM/DD HH:mm' }),
    ], [edge('a', 0, 'd')]);
    eq('★ 日期格式化', r.vars.d.text, '2026/10/07 12:34');
  }
  {
    const r = await run([
      node('a', 'trigger.manual'),
      node('d', 'data.date', { mode: 'add', value: '', amount: '3', unit: 'day' }),
    ], [edge('a', 0, 'd')]);
    ok('★ 日期加 3 天（相对「现在」）', r.vars.d.at > Date.now() + 2 * 86400000, String(r.vars.d.at));
  }
  {
    const r = await run([
      node('a', 'trigger.manual'),
      node('c', 'data.crypto', { op: 'sha256', value: 'abc' }),
      node('b', 'data.crypto', { op: 'base64', value: '你好' }),
      node('u', 'data.crypto', { op: 'uuid', value: '' }),
    ], [edge('a', 0, 'c'), edge('a', 0, 'b'), edge('a', 0, 'u')]);
    eq('★ sha256', r.vars.c.text, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    eq('★ base64', r.vars.b.text, '5L2g5aW9');
    ok('★ uuid 是 36 位', /^[0-9a-f-]{36}$/.test(r.vars.u.text), r.vars.u.text);
  }

  console.log('\n── ⑯ 子工作流（只产 effect，不在这里落地）──');
  {
    const r = await run([
      node('a', 'trigger.manual'),
      node('f', 'out.flow', { flow: '另一个流', input: '' }),
    ], [edge('a', 0, 'f')]);
    eq('★ 产出 flow effect', r.effects.length, 1);
    eq('  带上子流程名', r.effects[0].flow, '另一个流');
    ok('★ 引擎自己**不执行**子流程（由前端递归，带深度上限）', r.effects[0].kind === 'flow');
  }

  console.log('\n' + (failed ? '失败 ' + failed + ' 项 / 共 ' + (passed + failed) : '工作流引擎：' + passed + ' 项通过 ✓'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('✗ 异常: ' + e.message); process.exit(1); });
