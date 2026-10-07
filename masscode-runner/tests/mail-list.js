#!/usr/bin/env node
'use strict';

/* ── 邮件列表「行」组装的回归 ────────────────────────────────────────────────
   为什么要测：`UID SEARCH 1:*` 会把**已经删掉的旧 UID** 也带回来 ✗ ——
   实测 2925（无限邮）`1:*` 回 **85** 个，而 `STATUS` 说收件箱只有 **71** 封 ✗。
   那些 UID 去 FETCH **没有响应** ✓，以前照样给它们各生成一行「(无主题)」的空邮件 ✗，
   列表里看着就像坏了 ✗。 */

const { buildMailRows } = require('../lib/mail-list.js');
const mime = require('../lib/mime.js');

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

/* 造一条 FETCH 响应（和真实服务器回的形状一致 ✓）*/
const head = (uid, subject, flags) => ({
  seq: uid, uid, flags: flags || [], size: 1024,
  headerRaw: Buffer.from('Subject: ' + subject + '\r\nFrom: 测试 <a@b.c>\r\n\r\n', 'utf8'),
});

console.log('邮件列表组装\n');

console.log('── ① 正常：全部 UID 都有 FETCH 响应 ──');
{
  const pick = [3, 2, 1];
  const rows = buildMailRows(pick, [head(1, 'A'), head(2, 'B'), head(3, 'C')], mime);
  eq('条数不变', rows.length, 3);
  eq('顺序按 pick（新的在前）', rows.map((r) => r.uid), [3, 2, 1]);
  eq('主题对上了', rows.map((r) => r.subject), ['C', 'B', 'A']);
}

console.log('\n── ② ★ 已删除的旧 UID 没有 FETCH 响应 → 必须丢掉（不生成空行）──');
{
  const pick = [105, 104, 999, 103, 998];        /* 999 / 998 是已删除的旧 UID ✓ */
  const rows = buildMailRows(pick, [head(105, '新'), head(104, '中'), head(103, '旧')], mime);
  eq('只剩有响应的 3 条', rows.length, 3);
  eq('旧 UID 被丢掉', rows.map((r) => r.uid), [105, 104, 103]);
  ok('★ 没有任何「(无主题)」空行', rows.every((r) => r.subject && r.subject !== '(无主题)'),
    JSON.stringify(rows.map((r) => r.subject)));
}

console.log('\n── ③ ★ 一封都没响应（服务器异常）→ 保持原样，绝不能把整列清空 ──');
{
  const pick = [1, 2, 3];
  const rows = buildMailRows(pick, [], mime);
  eq('条数还是 3（宁可留几行空的，也不能整列消失）', rows.length, 3);
  ok('这时候才允许出现「(无主题)」占位', rows.every((r) => r.subject === '(无主题)'));
}

console.log('\n── ④ 真的空信箱 ──');
{
  eq('空进空出', buildMailRows([], [], mime), []);
}

console.log('\n── ⑤ 标记要映射对（未读 / 重要）──');
{
  const rows = buildMailRows([1, 2, 3], [
    head(1, 'a', ['\\Seen']),
    head(2, 'b', []),                          /* 没有 \\Seen = 未读 ✓ */
    head(3, 'c', ['\\Seen', '\\Flagged']),
  ], mime);
  eq('已读判定', rows.map((r) => r.seen), [true, false, true]);
  eq('重要判定', rows.map((r) => r.flagged), [false, false, true]);
}

console.log('\n── ⑥ 缺 Subject 时给占位，不崩 ──');
{
  const rows = buildMailRows([1], [{ seq: 1, uid: 1, flags: [], size: 0, headerRaw: Buffer.from('From: a@b.c\r\n\r\n', 'utf8') }], mime);
  eq('给「(无主题)」', rows[0].subject, '(无主题)');
  eq('发件人从 From 兜底', rows[0].fromAddress, 'a@b.c');
}

console.log('\n── ⑦ 脏参数不崩 ──');
{
  eq('pick 不是数组', buildMailRows(null, null, mime), []);
  eq('heads 不是数组', buildMailRows([1, 2], null, mime).length, 2);
}

console.log('\n' + (failed ? '失败 ' + failed + ' 项 / 共 ' + (passed + failed) : '邮件列表组装：' + passed + ' 项通过 ✓'));
process.exit(failed ? 1 : 0);
