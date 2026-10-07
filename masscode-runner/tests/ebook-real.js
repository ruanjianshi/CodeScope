/* ★★★ 用**真实电子书**跑解析器 ✓ —— 纯单测 ✓，不联网 ✓、不起服务 ✓。
   ⚠️⚠️ 为什么要单独有这么一个 ✗✗：
     `tests/ebook.js` 里全是**现造样本** ✓ —— 而古登堡样板那几个坑
     （1.8 万字的样板 / 目录页切成 135 个空章 / 署名在 START 标记之后 ✓）
     **现造样本永远测不出来** ✗，全是拿真书跑才暴露的 ✓。
   ⚠️ 书放在 `~/Documents/CodeScope 电子书/`（`EBOOK_DIR` 环境变量可覆盖 ✓）；
     **没有就跳过** ✓ —— 绝不变成假失败 ✗（别人的机器上没有这些书 ✓）。
   ⚠️ 只读 ✗ —— 一个字都不写 ✓。

   断言的都是**不变式** ✓（不是「某本书必须多少章」✗ —— 用户可能删书 ✓）：
     · 每本都能解析出来 ✓
     · **没有空章** ✗（目录页那个坑的症状 ✓）
     · 章名不出现 "Project Gutenberg" ✗（样板标题被当章名 ✓）
     · 正文里没有样板标记 / 署名 ✗
     · 章名唯一率够高 ✗（重名 = 标题取错了 ✓） */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../lib/ebook.js');

const DIR = process.env.EBOOK_DIR || path.join(os.homedir(), 'Documents/CodeScope 电子书');
let files = [];
try { files = fs.readdirSync(DIR).filter((f) => /\.epub$/i.test(f)).sort(); } catch (_) { files = []; }
if (!files.length) {
  console.log('（跳过：' + DIR + ' 里没有 .epub —— 这个探针要真实电子书 ✓，没有就不跑 ✓）');
  process.exit(0);
}

let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) pass++; else { fails.push(n + (x ? '  → ' + x : '')); console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };

console.log('用 ' + files.length + ' 本真实电子书跑（' + DIR + '）\n');
const rows = [];
files.forEach((f) => {
  let b = null;
  try { b = E.parseEpub(fs.readFileSync(path.join(DIR, f))); } catch (e) { b = { err: e.message }; }
  if (b.err) { ck(f + ' 能解析', false, b.err); return; }
  const chars = b.chapters.reduce((n, c) => n + c.text.length, 0);
  const zero = b.chapters.filter((c) => !c.text.trim()).length;
  const uniq = new Set(b.chapters.map((c) => c.title)).size;
  const all = b.chapters.map((c) => c.text).join('\n');
  rows.push({ f, n: b.chapters.length, chars, zero, uniq, title: b.title });

  ck(f + ' 抽出了正文', chars > 2000, chars + ' 字');
  ck(f + ' ★★ 一个空章都没有（目录页那个坑）', zero === 0, zero + ' 个空章');
  ck(f + ' ★ 章名里没有样板（Project Gutenberg）',
    !b.chapters.some((c) => /project gutenberg|gutenberg\.org/i.test(c.title)),
    JSON.stringify(b.chapters.map((c) => c.title).find((t) => /gutenberg/i.test(t)) || ''));
  ck(f + ' ★ 正文里没有 START/END 标记', !/\*\*\*\s*(?:START|END) OF (?:THE|THIS) PROJECT GUTENBERG/i.test(all));
  ck(f + ' ★ 正文里没有「Produced by …」署名', !/^\s*Produced by\b/m.test(all));
  ck(f + ' ★ 章名唯一率 > 60%（重名 = 标题取错了）', b.chapters.length < 2 || uniq / b.chapters.length > 0.6,
    uniq + '/' + b.chapters.length);
  ck(f + ' 每章都有正文', b.chapters.every((c) => String(c.text || '').trim().length > 0));
});

console.log('\n书名'.padEnd(40) + '章数'.padStart(6) + '  万字'.padStart(9) + '  空章  章名唯一');
rows.forEach((r) => {
  console.log(('《' + String(r.title).slice(0, 26) + '》').padEnd(36) + String(r.n).padStart(6)
    + (r.chars / 10000).toFixed(1).padStart(9) + String(r.zero).padStart(6) + ('  ' + r.uniq + '/' + r.n).padStart(10));
});
console.log('\n合计 ' + rows.reduce((n, r) => n + r.n, 0) + ' 章 · '
  + rows.reduce((n, r) => n + r.chars, 0).toLocaleString() + ' 字');

console.log('\n真实电子书解析：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败 ✗' : ' ✓'));
if (fails.length) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
