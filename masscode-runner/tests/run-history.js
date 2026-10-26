#!/usr/bin/env node
'use strict';
/**
 * 运行历史 / 行级 diff 的单测（`assets/run-history.js`，纯逻辑，不需要浏览器）
 *
 * 为什么单独测这个：diff 是「用户会拿它下判断」的东西 ✓ ——
 * 「改了这一行，输出变了没」全靠它 ✓。算错了比不做更糟 ✗。
 * 重点守三件事：
 *   ① 相同的前后缀不会被报成改动（不然改一行会显示整段全变 ✓）
 *   ② 中间插入一行时，后面的行仍然算「相同」（LCS 对齐，不是按行号硬比）
 *   ③ 增删计数和行号要对得上
 */
const path = require('path');
const RUNS = require(path.join(__dirname, '..', 'assets', 'run-history.js'));

let pass = 0, fail = 0;
const ck = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '\n       ' + detail : '')); }
};

console.log('运行历史 / diff');

/* ── 环形缓冲 ── */
RUNS.clear();
const a = RUNS.push({ at: 1000, ms: 120, ok: true, stdout: 'a\n', stderr: '' });
const b = RUNS.push({ at: 2000, ms: 80, ok: false, code: 1, stdout: 'b\n', stderr: 'err' });
ck('push 返回带自增 id 的记录', a.id === 1 && b.id === 2, JSON.stringify([a.id, b.id]));
ck('list() 是倒序（最新在前）', RUNS.list()[0].id === 2);
ck('get(id) 取到同一条', RUNS.get(2).stdout === 'b\n');
ck('previousOf(2) 是第 1 条', RUNS.previousOf(2) && RUNS.previousOf(2).id === 1);
ck('previousOf(最老的一条) 是 null', RUNS.previousOf(1) === null);
ck('ms / at / ok 原样保存', RUNS.get(2).ms === 80 && RUNS.get(2).at === 2000 && RUNS.get(2).ok === false);

/* 上限：push 超过 MAX 条后最老的被挤掉 */
RUNS.clear();
for (let i = 0; i < RUNS.MAX + 5; i += 1) RUNS.push({ stdout: 'x' + i, ok: true });
ck('超过 MAX 条后自动裁掉最老的', RUNS.list().length === RUNS.MAX && RUNS.list()[0].stdout === 'x' + (RUNS.MAX + 4));

/* ── 摘要 ── */
ck('summarize 跳过空行取第一行有内容的', RUNS.summarize('\n\n  hello  \nworld') === 'hello');
ck('summarize 超长会截断加省略号', RUNS.summarize('x'.repeat(200)).endsWith('…'));

/* ── diff：完全相同 ── */
const same = RUNS.diffLines('a\nb\nc\n', 'a\nb\nc\n');
ck('完全相同 → same=true，增删都是 0', same.same && same.added === 0 && same.removed === 0);

/* ── diff：改一行（重点：前后缀不能算改动）── */
const one = RUNS.diffLines('a\nb\nc\n', 'a\nB\nc\n');
ck('改一行 → +1 −1', one.added === 1 && one.removed === 1, JSON.stringify([one.added, one.removed]));
/* ⚠️ 「改一行」在 diff 里是 **del + add 两行** ✓（不是一行）——
   所以总行数是 4 而不是 3 ✓（第一版断言按「一行」写，假红了一次 ✓）。 */
ck('改一行 → 只有那一行被拆成 del+add，其余是 same',
  one.rows.filter((r) => r.type !== 'same').length === 2 && one.rows.length === 4,
  JSON.stringify(one.rows));
ck('改一行 → 行号对得上（del 只有 a，add 只有 b）',
  one.rows[0].a === 1 && one.rows[1].a === 2 && one.rows[1].b === null
  && one.rows[2].a === null && one.rows[2].b === 2 && one.rows[3].a === 3 && one.rows[3].b === 3,
  JSON.stringify(one.rows.map((r) => [r.type, r.a, r.b])));

/* ── diff：中间插入一行（按行号硬比会把后面全标成改动 ✗）── */
const ins = RUNS.diffLines('a\nb\nc\nd\n', 'a\nb\nNEW\nc\nd\n');
ck('插入一行 → 只 +1', ins.added === 1 && ins.removed === 0, JSON.stringify([ins.added, ins.removed]));
ck('插入一行 → 后面的 c/d 仍是 same（LCS 对齐）',
  ins.rows.filter((r) => r.type === 'same').length === 4,
  JSON.stringify(ins.rows.map((r) => r.type + ':' + r.text)));

/* ── diff：删一行 ── */
const del = RUNS.diffLines('a\nb\nc\n', 'a\nc\n');
ck('删一行 → 只 −1', del.added === 0 && del.removed === 1, JSON.stringify([del.added, del.removed]));

/* ── diff：空输出 ── */
const fromEmpty = RUNS.diffLines('', 'x\ny\n');
ck('从「无输出」到有输出 → 全部算新增', fromEmpty.added === 2 && fromEmpty.removed === 0, JSON.stringify([fromEmpty.added, fromEmpty.removed]));
const toEmpty = RUNS.diffLines('x\n', '');
ck('从有输出到「无输出」→ 全部算删除', toEmpty.removed === 1 && toEmpty.added === 0);

/* ── diff：末尾换行不该凭空多一行 ── */
const trailing = RUNS.diffLines('a\nb', 'a\nb\n');
ck('只差末尾换行 → 视为相同（split 的空行被吃掉）', trailing.same, JSON.stringify(trailing.rows));

console.log('\n' + (fail ? '失败 ' + fail + ' 项' : '全部通过 ✅') + '（通过 ' + pass + ' · 失败 ' + fail + '）');
process.exit(fail ? 1 : 0);
