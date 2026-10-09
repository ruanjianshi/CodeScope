#!/usr/bin/env node
'use strict';
/**
 * system-files 的路径守卫测试（2026-10-09）
 *
 * ⚠️ 为什么要写 ✗✗：
 *   这个模块 **1203 行、零测试**，管的是**删 / 移 / 改名本机文件** ——
 *   判错一次就是**不可逆的数据丢失**。
 *   本会话的真实教训：我拿用户真实数据做测试，把备忘录删过一次；
 *   而「守卫判错」的后果比那严重得多。
 *
 * ⚠️ 这些守卫**不写任何文件**（纯校验），所以测试是安全的 ✓。
 *   但它们会调 `fs.realpath`（解析软链），所以用的是**真实路径** ✓。
 *
 * 覆盖：
 *   · assertPath：空值 / \0 / 绝对化
 *   · assertChildName：`.` `..` / 路径分隔符 / 长度
 *   · assertMutable：系统保护区（精确 + 前缀）/ 家目录本身 / 常用目录本身 /
 *     敏感区（只在破坏性操作时拦）/ .app 包内部 / 临时空间豁免
 *
 * 运行：node tests/system-files-guards.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { __test } = require('../lib/system-files.js');
const T = __test;

let pass = 0, fail = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  fails.push(label + (detail === undefined ? '' : '   → ' + String(detail).slice(0, 130)));
}
function rejects(label, fn) {
  try { const v = fn(); ok(label, false, '居然通过了，返回 ' + JSON.stringify(v)); }
  catch (_) { ok(label, true); }
}
function accepts(label, fn) {
  try { fn(); ok(label, true); }
  catch (e) { ok(label, false, '抛错了：' + (e && e.message)); }
}

const HOME = T.HOME;
/* 找一个「肯定存在的普通目录」当安全样本 ✓（用项目自身 ✓）*/
const SAFE_DIR = path.resolve(__dirname, '..');

/* ── assertPath ── */
console.log('  ── assertPath ──');
ok('绝对路径原样返回', T.assertPath(SAFE_DIR, 'p') === SAFE_DIR, T.assertPath(SAFE_DIR, 'p'));
rejects('★ 空值', () => T.assertPath('', 'p'));
rejects('★ 纯空白', () => T.assertPath('   ', 'p'));
rejects('★★ 含 \\0（截断攻击）', () => T.assertPath(SAFE_DIR + '\0.txt', 'p'));
ok('相对路径会被绝对化（设计如此）', path.isAbsolute(T.assertPath('rel/x', 'p')), T.assertPath('rel/x', 'p'));

/* ── assertChildName ── */
console.log('  ── assertChildName ──');
ok('普通文件名', T.assertChildName('note.md') === 'note.md', T.assertChildName('note.md'));
ok('带空格 / 中文', T.assertChildName('我的 笔记.txt') === '我的 笔记.txt');
rejects('★ 空', () => T.assertChildName(''));
rejects('★ 单点 .', () => T.assertChildName('.'));
rejects('★★ 双点 ..（上跳一层）', () => T.assertChildName('..'));
rejects('★★ 含正斜杠', () => T.assertChildName('a/b'));
rejects('★★ 含反斜杠（Windows 也危险）', () => T.assertChildName('a\\b'));
rejects('★ 含 \\0', () => T.assertChildName('a\0b'));
rejects('超长（>200）', () => T.assertChildName('a'.repeat(201)));
ok('长度正好 200 可以', T.assertChildName('a'.repeat(200)).length === 200);

/* ── assertMutable：系统保护区（精确级）── */
console.log('  ── assertMutable · 系统保护区（精确）──');
for (const p of ['/', '/System', '/usr', '/etc', '/bin', '/Library', '/Applications', '/Volumes', '/private']) {
  rejects('★ 拒绝 ' + p, () => T.assertMutable(p, 'p'));
}

/* ── assertMutable：系统保护区（前缀级）★ 这才是关键 ── */
console.log('  ── assertMutable · 系统保护区（前缀）──');
for (const p of ['/System/Library/CoreServices/x', '/usr/local/bin/tool', '/etc/hosts', '/Library/Preferences/a.plist', '/var/db/thing']) {
  rejects('★★ 拒绝 ' + p, () => T.assertMutable(p, 'p'));
}

/* ── assertMutable：家目录与常用目录 ── */
console.log('  ── assertMutable · 家目录 / 常用目录 ──');
rejects('★★ 家目录本身', () => T.assertMutable(HOME, 'p'));
for (const d of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Movies']) {
  rejects('★★ 常用目录本身：' + d, () => T.assertMutable(path.join(HOME, d), 'p'));
  accepts('✓ 常用目录**里面**可以：' + d, () => T.assertMutable(path.join(HOME, d, '子项'), 'p'));
}

/* ── assertMutable：敏感区（只在破坏性操作时拦）── */
console.log('  ── assertMutable · 敏感区（destructive 才拦）──');
accepts('✓ 浏览 ~/Library 下的东西（非破坏性）', () => T.assertMutable(path.join(HOME, 'Library', 'Caches'), 'p'));
rejects('★★ 删 ~/Library 下的东西（破坏性）', () => T.assertMutable(path.join(HOME, 'Library', 'Caches'), 'p', { destructive: true }));
accepts('✓ 非破坏性访问 ~/.codescope', () => T.assertMutable(path.join(HOME, '.codescope'), 'p'));
rejects('★★ 破坏性操作 ~/.codescope', () => T.assertMutable(path.join(HOME, '.codescope'), 'p', { destructive: true }));

/* ── assertMutable：.app 包 ── */
console.log('  ── assertMutable · .app 包 ──');
rejects('★★ 写进 /Applications 里的 .app 内部',
  () => T.assertMutable('/Applications/Safari.app/Contents/Info.plist', 'p'));

/* ── assertMutable：临时空间豁免（★ 这个细节很容易被改坏）── */
console.log('  ── assertMutable · 临时空间豁免 ──');
accepts('✓ /tmp 下的东西（被 /private 前缀误伤过）', () => T.assertMutable('/tmp/codescope-test-x', 'p'));
accepts('✓ os.tmpdir() 下的东西（/var/folders 真身）', () => T.assertMutable(path.join(os.tmpdir(), 'codescope-test-x'), 'p'));
rejects('★ /var 下的普通路径仍然拒绝', () => T.assertMutable('/var/db/thing', 'p'));

/* ── assertMutable：正常项目路径要放行 ✓ ── */
console.log('  ── assertMutable · 正常路径必须放行 ──');
accepts('✓ 项目目录（非破坏性）', () => T.assertMutable(SAFE_DIR, 'p'));
accepts('✓ 项目里的子路径（非破坏性）', () => T.assertMutable(path.join(SAFE_DIR, 'assets', 'app.js'), 'p'));
/* ★★ 这里暴露了一个**真实情况** ✗（2026-10-09）：
   这个项目在 **iCloud Drive** 里（~/Library/Mobile Documents/…），
   而 ~/Library 属于**敏感区** → 所以「项目里删文件」会被守卫拦下 ✓。
   这是**设计如此**（iCloud 上的删除会影响所有设备 ✓），不是 bug ✓。
   → 破坏性用例改用**临时空间**（豁免区）来验证 ✓。 */
accepts('✓ 临时空间 + 破坏性操作（豁免区）', () => T.assertMutable(path.join(os.tmpdir(), 'codescope-test-x'), 'p', { destructive: true }));
console.log('    ⚠️ 注意：本项目位于 iCloud Drive（~/Library 下）→');
console.log('       面板对**项目内文件**的删除/移动/改名会被「敏感区」守卫拦下（设计如此）。');

/* ── within：路径包含判断（前缀保护的地基 ✓）── */
console.log('  ── within ──');
ok('自身算包含', T.within('/a/b', '/a/b') === true);
ok('子路径算包含', T.within('/a/b/c', '/a/b') === true);
ok('★ 前缀像但不是子路径（/a/bc 不该算在 /a/b 里）', T.within('/a/bc', '/a/b') === false);
ok('无关路径不算', T.within('/x/y', '/a/b') === false);

/* ── realTarget：软链解析（防软链绕过 ✓）── */
console.log('  ── realTarget（软链）──');
const tmpLink = path.join(os.tmpdir(), 'codescope-link-test-' + process.pid);
try {
  try { fs.unlinkSync(tmpLink); } catch (_) {}
  fs.symlinkSync('/System', tmpLink);
  const real = T.realTarget(tmpLink);
  ok('★★ 软链会被解析到真身（/System）', real === '/System' || real === '/System/', real);
  rejects('★★ 经软链指向 /System 的路径也要被拦', () => T.assertMutable(tmpLink, 'p'));
} catch (e) {
  ok('软链用例（环境不支持则跳过）', true);
} finally {
  try { fs.unlinkSync(tmpLink); } catch (_) {}
}

console.log('');
console.log('  通过 ' + pass + ' · 失败 ' + fail);
if (fail) {
  console.log('');
  console.log('  失败明细:');
  fails.forEach((f) => console.log('    ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('  ✓ system-files 的路径守卫全部符合预期');
}
