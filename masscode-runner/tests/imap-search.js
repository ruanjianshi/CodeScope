#!/usr/bin/env node
'use strict';

/* ── IMAP 检索（UID SEARCH）的兼容性回归 ────────────────────────────────────
   为什么要单独测：**有服务器对 `UID SEARCH ALL / UNSEEN / FLAGGED` 静默回空集** ✗✗ ——
   实测 2925（无限邮）收件箱 `STATUS` 说 71 封 / 未读 3 封，而：
     `UID SEARCH ALL`     → `* SEARCH` + `OK`（**0 封** ✗）
     `UID SEARCH UNSEEN`  → `* SEARCH` + `OK`（**0 封** ✗）
     `UID SEARCH 1:*`     → 85 个 UID ✓
   界面于是显示「这个文件夹是空的」，而左边未读数明明是 3 ✗
   （用户原话：「无限邮已经配置好了，怎么没有信显示」）。

   ★ 这里不建真 socket ✗ —— 直接拿 `ImapSession.prototype` 的方法配一个**假的 this** ✓，
     把 `command()` 换成返回**录好的原始响应** ✓。这样能把几种服务器的脾气都演一遍 ✓，
     而且不依赖网络、不依赖 TLS ✓。 */

const { ImapSession } = require('../lib/imap-client.js');

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

/* 造一个假的会话：`answers` 是「命令前缀 → 原始响应行数组」 */
function fakeSession(host, answers) {
  const log = [];
  const s = {
    host,
    timeout: 25000,
    log,
    lines: ImapSession.prototype.lines,
    fetchMeta: ImapSession.prototype.fetchMeta,
    fetchFlags: ImapSession.prototype.fetchFlags,
    filterByKey: ImapSession.prototype.filterByKey,
    search: ImapSession.prototype.search,
    async select() { return { text: '' }; },
    async command(text) {
      log.push(text);
      /* 长的前缀优先匹配 ✓（`UID SEARCH 1:*` 不能被 `UID SEARCH ` 抢走 ✗） */
      const keys = Object.keys(answers).filter((k) => text.startsWith(k)).sort((a, b) => b.length - a.length);
      if (!keys.length) throw new Error('假的会话没准备这条命令：' + text);
      const spec = answers[keys[0]];
      const lines = typeof spec === 'function' ? spec(text) : spec;
      return { units: (lines || []).map((t) => ({ type: 'line', text: t })), text: (lines || []).join('\r\n') };
    },
  };
  return s;
}
const SEARCH_LINE = (ids) => '* SEARCH' + (ids.length ? ' ' + ids.join(' ') : '');
const FLAGS_LINE = (uid, flags) => '* ' + uid + ' FETCH (UID ' + uid + ' FLAGS (' + flags.join(' ') + '))';

(async () => {
console.log('IMAP 检索兼容性\n');

/* ═══ ① 2925 型：不认检索键，只认 UID 区间 ═══ */
console.log('── ① 2925 型服务器（`UID SEARCH ALL/UNSEEN` 静默回空集）──');
{
  const s = fakeSession('imap.2925.test', {
    'UID SEARCH ALL': [SEARCH_LINE([])],
    'UID SEARCH 1:*': [SEARCH_LINE([11, 22, 33])],
    'UID FETCH': [FLAGS_LINE(11, ['\\Seen']), FLAGS_LINE(22, ['\\Recent']), FLAGS_LINE(33, ['\\Seen', '\\Flagged'])],
  });
  eq('ALL 拿回全集（不是空）', await s.search('ALL'), [11, 22, 33]);
  eq('UNSEEN 客户端筛出未读', await s.search('UNSEEN'), [22]);
  eq('FLAGGED 客户端筛出重要', await s.search('FLAGGED'), [33]);
  eq('SEEN 客户端筛出已读', await s.search('SEEN'), [11, 33]);
  ok('探测只跑一次（第二次不再探）', s.log.filter((t) => t === 'UID SEARCH ALL').length === 1,
    '跑了 ' + s.log.filter((t) => t === 'UID SEARCH ALL').length + ' 次');
  ok('第一次之后再查 UNSEEN 不再探 ALL', s.log.filter((t) => t === 'UID SEARCH UNSEEN').length === 0,
    '发了 ' + s.log.filter((t) => t === 'UID SEARCH UNSEEN').length + ' 次 UNSEEN');
}

/* ═══ ② 正常服务器：检索键好用 → 直接透传，别做无用功 ═══ */
console.log('\n── ② 正常服务器（检索键好用，QQ / 163 就是这种）──');
{
  const s = fakeSession('imap.normal.test', {
    'UID SEARCH ALL': [SEARCH_LINE([1, 2, 3])],
    'UID SEARCH 1:*': [SEARCH_LINE([1, 2, 3])],
    'UID SEARCH UNSEEN': [SEARCH_LINE([2])],
  });
  eq('ALL 透传', await s.search('ALL'), [1, 2, 3]);
  eq('UNSEEN 透传（服务器自己筛的）', await s.search('UNSEEN'), [2]);
  ok('★ 没有多拉一次 FLAGS（无用的重活）', s.log.every((t) => !/UID FETCH/.test(t)),
    s.log.filter((t) => /UID FETCH/.test(t)).join(' | '));
  ok('★ 正常服务器最多只多探一次 `1:*`（一次进程内只探一回）',
    s.log.filter((t) => t === 'UID SEARCH 1:*').length <= 1,
    '发了 ' + s.log.filter((t) => t === 'UID SEARCH 1:*').length + ' 次：' + s.log.join(' | '));
}

/* ═══ ③ 真·空信箱：不能误判成「服务器不认检索键」═══ */
console.log('\n── ③ 真的空信箱（ALL 和 1:* 都空）──');
{
  const s = fakeSession('imap.empty.test', {
    'UID SEARCH ALL': [SEARCH_LINE([])],
    'UID SEARCH 1:*': [SEARCH_LINE([])],
    'UID SEARCH UNSEEN': [SEARCH_LINE([])],
  });
  eq('ALL → 空', await s.search('ALL'), []);
  eq('UNSEEN → 空', await s.search('UNSEEN'), []);
  ok('★ 没被误判成「不认检索键」（UNSEEN 仍然走检索键）',
    s.log.includes('UID SEARCH UNSEEN'), s.log.join(' | '));
  ok('没去拉 FLAGS', s.log.every((t) => !/UID FETCH/.test(t)), s.log.join(' | '));
}

/* ═══ ④ 不认检索键 + 认不出的条件：宁可多给，不能自己乱筛把邮件藏掉 ═══ */
console.log('\n── ④ 不认检索键的服务器 + 认不出的检索条件 ──');
{
  const s = fakeSession('imap.2925b.test', {
    'UID SEARCH ALL': [SEARCH_LINE([])],
    'UID SEARCH 1:*': [SEARCH_LINE([7, 8, 9])],
    'UID SEARCH SINCE 1-Jan-2020': [SEARCH_LINE([])],
  });
  eq('认不出的条件 → 原样返回全集（不乱筛）', await s.search('SINCE 1-Jan-2020'), [7, 8, 9]);
  ok('没去拉 FLAGS', s.log.every((t) => !/UID FETCH/.test(t)), s.log.join(' | '));
}

/* ═══ ⑤ filterByKey 本身 ═══ */
console.log('\n── ⑤ filterByKey：全集 / 区间直接放行 ──');
{
  const s = fakeSession('imap.f.test', {});
  eq('ALL 放行', await s.filterByKey([1, 2], 'ALL'), [1, 2]);
  eq('1:* 放行', await s.filterByKey([1, 2], '1:*'), [1, 2]);
  eq('数字区间放行', await s.filterByKey([1, 2], '5:9'), [1, 2]);
  eq('认不出的放行', await s.filterByKey([1, 2], 'BOGUS KEY'), [1, 2]);
  ok('放行时不发任何命令', s.log.length === 0, s.log.join(' | '));
}

/* ═══ ⑥ 另一种「不认检索键」：`UID SEARCH ALL` 直接报错 ═══ */
console.log('\n── ⑥ `UID SEARCH ALL` 直接报 BAD 的服务器 ──');
{
  const s = fakeSession('imap.bad.test', {
    'UID SEARCH ALL': () => { throw new Error('IMAP SEARCH 失败：BAD Command not recognized'); },
    'UID SEARCH 1:*': [SEARCH_LINE([4, 5])],
  });
  eq('★ 报错也算「不认检索键」→ 退回 1:*（不是静默空列表）', await s.search('ALL'), [4, 5]);
}
{
  const s = fakeSession('imap.bad2.test', {
    'UID SEARCH ALL': () => { throw new Error('IMAP SEARCH 失败：BAD Command not recognized'); },
    'UID SEARCH 1:*': () => { throw new Error('IMAP SEARCH 失败：BAD'); },
  });
  const got = await s.search('ALL').catch((e) => 'throw');
  eq('★ 两条都失败 → **原样抛出**（绝不能静默返回空列表 ✗）', got, 'throw');
}

  console.log('\n' + (failed ? '失败 ' + failed + ' 项 / 共 ' + (passed + failed) : 'IMAP 检索兼容性：' + passed + ' 项通过 ✓'));
  process.exit(failed ? 1 : 0);
})();
