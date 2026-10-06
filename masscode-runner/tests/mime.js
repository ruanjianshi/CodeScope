#!/usr/bin/env node
/* MIME 解码单测 —— 纯逻辑、不联网 ✓
   ⚠️ 涉及编码的夹具**用代码现算**（iconv 那套手写 base64 极易算错 ✗，
      算错的话测试会「通过」但实际是错的 ✗）。Node 自带完整 ICU，
      `Buffer.from(str,'latin1')` + TextEncoder 反向就够造 GBK 字节 ✓。 */
'use strict';

const assert = require('assert');
const mime = require('../lib/mime');

let pass = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fails.push(name); console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

/* 把字符串按指定 charset 编成字节（用 TextEncoder 不行 —— 只支持 utf-8 ✗）。
   GBK 的编码：Node 没有内置 encoder，所以这里用**已知字节**构造夹具 ✓ */
const GBK_ZHONGWEN = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);          // 「中文」
const GBK_ZHUYI = Buffer.from([0xd6, 0xf7, 0xcc, 0xe2]);             // 「主题」
const GBK_NIHAO = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);             // 「你好」

t('charset 别名归一：gb2312 / GB_2312 都按 gbk 解', () => {
  assert.strictEqual(mime.decodeCharset(GBK_ZHONGWEN, 'gb2312'), '中文');
  assert.strictEqual(mime.decodeCharset(GBK_ZHONGWEN, 'GB_2312'), '中文');
  assert.strictEqual(mime.decodeCharset(GBK_ZHONGWEN, '"gbk"'), '中文');
  assert.strictEqual(mime.decodeCharset(GBK_ZHONGWEN, 'gb18030'), '中文');
});

t('charset 认不出来时退 utf-8，不抛错', () => {
  assert.strictEqual(mime.decodeCharset(Buffer.from('abc'), 'x-not-a-charset'), 'abc');
  assert.strictEqual(mime.decodeCharset(Buffer.alloc(0), 'gbk'), '');
});

t('RFC 2047：GBK + base64 的主题', () => {
  const raw = '=?GBK?B?' + GBK_ZHUYI.toString('base64') + '?=';
  assert.strictEqual(mime.decodeHeader(raw), '主题');
});

t('RFC 2047：UTF-8 + base64', () => {
  const raw = '=?UTF-8?B?' + Buffer.from('测试邮件', 'utf8').toString('base64') + '?=';
  assert.strictEqual(mime.decodeHeader(raw), '测试邮件');
});

t('RFC 2047：Q 编码（下划线代表空格）', () => {
  const raw = '=?UTF-8?Q?Hello=20World_ok?=';
  assert.strictEqual(mime.decodeHeader(raw), 'Hello World ok');
});

t('★ 相邻编码词之间的空白要删掉（否则主题多出空格）', () => {
  const a = '=?UTF-8?B?' + Buffer.from('你好', 'utf8').toString('base64') + '?=';
  const b = '=?UTF-8?B?' + Buffer.from('世界', 'utf8').toString('base64') + '?=';
  /* 折行后的写法：两个编码词之间有空白 ✓ 那是排版用的，不是内容 */
  assert.strictEqual(mime.decodeHeader(a + ' ' + b), '你好世界');
  assert.strictEqual(mime.decodeHeader(a + '\r\n ' + b), '你好世界');
});

t('RFC 2047：GBK + Q 编码', () => {
  const q = GBK_ZHUYI.toString('latin1').replace(/[^\x20-\x7e]/g, (c) => '=' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  assert.strictEqual(mime.decodeHeader('=?GBK?Q?' + q + '?='), '主题');
});

t('quoted-printable：=XX 转义 + 软换行', () => {
  assert.strictEqual(mime.decodeQuotedPrintable(Buffer.from('a=3Db', 'latin1')).toString(), 'a=b');
  /* 行尾的 = 是软换行，不产生换行 ✓ */
  assert.strictEqual(mime.decodeQuotedPrintable(Buffer.from('abc=\r\ndef', 'latin1')).toString(), 'abcdef');
  assert.strictEqual(mime.decodeQuotedPrintable(Buffer.from('abc=\ndef', 'latin1')).toString(), 'abcdef');
  /* 孤立的 = 原样保留 ✓ */
  assert.strictEqual(mime.decodeQuotedPrintable(Buffer.from('a=zz', 'latin1')).toString(), 'a=zz');
});

t('★ quoted-printable 是字节级：GBK 中文不会被切坏', () => {
  const qp = GBK_NIHAO.toString('latin1').replace(/[^\x20-\x7e]/g, (c) => '=' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  const bytes = mime.decodeQuotedPrintable(Buffer.from(qp, 'latin1'));
  assert.deepStrictEqual([...bytes], [...GBK_NIHAO]);
  assert.strictEqual(mime.decodeCharset(bytes, 'gb2312'), '你好');
});

t('transfer-encoding：base64 里的换行/空白要清掉', () => {
  const b64 = Buffer.from('正文内容', 'utf8').toString('base64');
  const spaced = b64.slice(0, 4) + '\r\n  ' + b64.slice(4) + '\n';
  assert.strictEqual(mime.decodeTransferEncoding(Buffer.from(spaced, 'latin1'), 'base64').toString('utf8'), '正文内容');
  assert.strictEqual(mime.decodeTransferEncoding(Buffer.from('abc'), '7bit').toString(), 'abc');
});

t('Content-Type 解析：boundary 带引号 / charset 带引号', () => {
  const a = mime.parseContentType('multipart/mixed; boundary="----=_Part_0"');
  assert.strictEqual(a.type, 'multipart/mixed');
  assert.strictEqual(a.params.boundary, '----=_Part_0');
  const b = mime.parseContentType('text/plain; charset="gb2312"; format=flowed');
  assert.strictEqual(b.type, 'text/plain');
  assert.strictEqual(b.params.charset, 'gb2312');
  assert.strictEqual(b.params.format, 'flowed');
});

t('头部折行要并到上一行', () => {
  const head = Buffer.from('Subject: =?UTF-8?B?' + Buffer.from('很长的主', 'utf8').toString('base64') + '?=\r\n =?UTF-8?B?' + Buffer.from('题', 'utf8').toString('base64') + '?=\r\nFrom: a@b.c\r\n', 'utf8');
  const h = mime.parseHeaders(head);
  assert.strictEqual(mime.decodeHeader(h.subject), '很长的主题');
  assert.strictEqual(h.from, 'a@b.c');
});

t('multipart 切分：段尾那个 CRLF 属于分隔符，不属于内容', () => {
  const body = Buffer.from('pre\r\n--B\r\nAAA\r\n--B\r\nBBB\r\n--B--\r\n', 'utf8');
  const parts = mime.splitMultipart(body, 'B');
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].toString(), 'AAA');
  assert.strictEqual(parts[1].toString(), 'BBB');
});

t('multipart/alternative：优先 HTML，纯文本也留一份', () => {
  const b = '=_x';
  const raw = Buffer.from([
    'Subject: test',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + b + '"',
    '',
    '--' + b,
    'Content-Type: text/plain; charset=utf-8',
    '',
    '纯文本版本',
    '--' + b,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>HTML 版本</p>',
    '--' + b + '--',
    '',
  ].join('\r\n'), 'utf8');
  const m = mime.parseMessage(raw);
  assert.strictEqual(m.subject, 'test');
  assert.strictEqual(m.html, '<p>HTML 版本</p>');
  assert.strictEqual(m.text, '纯文本版本');
  assert.strictEqual(m.attachments.length, 0);
});

t('★ GBK 正文 + GBK 主题（国内邮件最常见）', () => {
  const raw = Buffer.concat([
    Buffer.from('Subject: =?GBK?B?' + GBK_ZHUYI.toString('base64') + '?=\r\n', 'latin1'),
    /* ⚠️ 显示名用**真 GBK 字节**造夹具 ✓ ——
       `Buffer.from('测试','latin1')` 不是 GBK 编码 ✗，拿它当夹具等于在测乱码 ✗ */
    Buffer.from('From: =?GBK?B?' + GBK_ZHONGWEN.toString('base64') + '?= <a@qq.com>\r\n', 'latin1'),
    Buffer.from('Content-Type: text/plain; charset="gb2312"\r\nContent-Transfer-Encoding: base64\r\n\r\n', 'latin1'),
    Buffer.from(GBK_NIHAO.toString('base64'), 'latin1'),
    Buffer.from('\r\n', 'latin1'),
  ]);
  const m = mime.parseMessage(raw);
  assert.strictEqual(m.subject, '主题');
  assert.strictEqual(m.text, '你好');
  assert.strictEqual(m.from, '中文 <a@qq.com>');
  assert.deepStrictEqual(mime.parseAddress(m.from), { name: '中文', address: 'a@qq.com' });
});

t('嵌套 multipart + 附件（RFC 2231 文件名）', () => {
  const outer = '=_o', inner = '=_i';
  const fname = "utf-8''" + encodeURIComponent('报告.pdf');
  const raw = Buffer.from([
    'Subject: 带附件',
    'Content-Type: multipart/mixed; boundary="' + outer + '"',
    '',
    '--' + outer,
    'Content-Type: multipart/alternative; boundary="' + inner + '"',
    '',
    '--' + inner,
    'Content-Type: text/plain; charset=utf-8',
    '',
    '正文',
    '--' + inner + '--',
    '',
    '--' + outer,
    'Content-Type: application/pdf; name="' + fname + '"',
    'Content-Disposition: attachment; filename="' + fname + '"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-1.4 fake', 'utf8').toString('base64'),
    '--' + outer + '--',
    '',
  ].join('\r\n'), 'utf8');
  const m = mime.parseMessage(raw);
  assert.strictEqual(m.text, '正文');
  assert.strictEqual(m.attachments.length, 1);
  assert.strictEqual(m.attachments[0].name, '报告.pdf');
  assert.strictEqual(m.attachments[0].type, 'application/pdf');
  assert.strictEqual(m.attachments[0].size, '%PDF-1.4 fake'.length);
});

t('内嵌图片（Content-ID）不算附件', () => {
  const b = '=_x';
  const raw = Buffer.from([
    'Subject: 内嵌图',
    'Content-Type: multipart/related; boundary="' + b + '"',
    '',
    '--' + b,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<img src="cid:logo@x">',
    '--' + b,
    'Content-Type: image/png; name="logo.png"',
    'Content-ID: <logo@x>',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('PNGDATA').toString('base64'),
    '--' + b + '--',
    '',
  ].join('\r\n'), 'utf8');
  const m = mime.parseMessage(raw);
  assert.strictEqual(m.html, '<img src="cid:logo@x">');
  assert.strictEqual(m.attachments.length, 0, '有 filename 但没有 attachment 处置时不该算附件');
});

t('地址解析：显示名 <地址>', () => {
  assert.deepStrictEqual(mime.parseAddress('张三 <z@qq.com>'), { name: '张三', address: 'z@qq.com' });
  assert.deepStrictEqual(mime.parseAddress('"李 四" <l@qq.com>'), { name: '李 四', address: 'l@qq.com' });
  assert.deepStrictEqual(mime.parseAddress('x@qq.com'), { name: '', address: 'x@qq.com' });
  assert.deepStrictEqual(mime.parseAddress(''), { name: '', address: '' });
});

t('日期解析：带注释尾巴也能解', () => {
  assert.ok(mime.parseMessage(Buffer.from('Date: Tue, 06 Oct 2026 22:00:00 +0800 (CST)\r\n\r\nx', 'utf8')).date > 0);
  assert.strictEqual(mime.parseMessage(Buffer.from('Date: 乱码\r\n\r\nx', 'utf8')).date, 0);
});

t('缺 Subject 时给「(无主题)」，不崩', () => {
  assert.strictEqual(mime.parseMessage(Buffer.from('\r\n\r\nx', 'utf8')).subject, '(无主题)');
  assert.strictEqual(mime.parseMessage(Buffer.alloc(0)).subject, '(无主题)');
});

t('畸形邮件不递归爆栈', () => {
  let raw = Buffer.from('Content-Type: multipart/mixed; boundary="b"\r\n\r\n', 'utf8');
  for (let i = 0; i < 40; i++) raw = Buffer.concat([raw, Buffer.from('--b\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n', 'utf8')]);
  mime.parseMessage(raw);   /* 只要不抛栈溢出就算过 ✓ */
  assert.ok(true);
});

console.log('\nMIME 解码：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败：' + fails.join(' / ') : ' ✓'));
process.exit(fails.length ? 1 : 0);
