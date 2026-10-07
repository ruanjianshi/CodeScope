'use strict';
/**
 * 文件全景核心的验收测试。重点是**安全不变量**：清理预演里永远不出现 L0/L1/L4 与受保护路径。
 * 运行：node tests/file-atlas-core.js   （退出码 0 = 全过）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const atlas = require('../lib/file-atlas-core.js');

const HOME = '/Users/demo';
const MAC = { platform: 'darwin', home: HOME };
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass += 1; console.log('  ✓ ' + name); } else { fail += 1; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); } };
const cls = (p, opts = MAC) => atlas.classifyPath(p, opts);
const tierOf = (p, opts = MAC) => cls(p, opts).tier;
const join = (...parts) => parts.join('/');

console.log('【1】分级口径（darwin）');
const tierCases = [
  ['/System/Library/CoreServices/SystemVersion.plist', 'L0-system'],
  ['/usr/bin/node', 'L0-system'],
  ['/etc/hosts', 'L0-system'],
  ['/Applications/Safari.app/Contents/Info.plist', 'L1-app'],
  [join(HOME, 'Library/Application Support/CodeScope/sync.json'), 'L1-app'],
  [join(HOME, 'Library/Caches/com.apple.Safari/x.db'), 'L2-cache'],
  [join(HOME, 'proj/node_modules/left-pad/index.js'), 'L2-cache'],
  ['/tmp/install.tmp', 'L3-temp'],
  ['/private/var/tmp/foo.log', 'L3-temp'],
  [join(HOME, 'Library/Logs/CodeScope/main.log'), 'L3-temp'],
  [join(HOME, 'Docs/note.md'), 'L4-user'],
  [join(HOME, 'Desktop/screenshot.png'), 'L4-user'],
];
for (const [p, want] of tierCases) {
  const got = tierOf(p);
  check(`${want.padEnd(9)} ← ${p.replace(HOME, '~')}`, got === want, `实际 ${got}`);
}
check('L2/L3 可进预演（deleteRisk=preview-only）', cls('/tmp/a.tmp').deleteRisk === 'preview-only' && cls(join(HOME, 'Library/Caches/a')).deleteRisk === 'preview-only');
check('L0/L4 永不可删（deleteRisk=none）', cls('/System/x').deleteRisk === 'none' && cls(join(HOME, 'Docs/a.md')).deleteRisk === 'none');
check('L1 永不可自动清理（deleteRisk 为 none/confirm 都安全，绝不是 preview-only）', ['none', 'confirm'].includes(cls('/Applications/A.app/b').deleteRisk) && cls('/Applications/A.app/b').deleteRisk !== 'preview-only');

console.log('【2】受保护路径（即使后缀像临时文件也必须挡住）');
const protectedCases = [
  join(HOME, '.ssh/id_rsa.tmp'),
  join(HOME, '.ssh/known_hosts.log'),
  join(HOME, '.gnupg/secring.gpg'),
  join(HOME, '.codescope/backups/a.bak'),
  join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault/readings/a.md'),
  '/Users/xiaoq/Desktop/markdown-vault/code/x.js',
  join(HOME, 'Docs/note.sync-conflict-20261005-194323-ANTVEEU.md'),
  join(HOME, 'proj/.git/objects/ab/cdef'),
];
for (const p of protectedCases) {
  const v = cls(p);
  check(`受保护：${p.replace(HOME, '~').slice(0, 78)}`, Boolean(v.protectedReason) && v.deleteRisk === 'none' && v.writable === false, `reason=${v.protectedReason || '(无)'} risk=${v.deleteRisk}`);
}

console.log('【3】清理预演的安全不变量（最重要）');
const evil = [
  { path: '/System/Library/x', bytes: 999 },
  { path: '/usr/bin/node', bytes: 999 },
  { path: '/Applications/WeChat.app/x', bytes: 999 },
  { path: join(HOME, '.ssh/id_rsa.tmp'), bytes: 999 },
  { path: join(HOME, '.codescope/backups/big.bak'), bytes: 999 },
  { path: join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault/readings/a.md'), bytes: 999 },
  { path: join(HOME, 'proj/a.sync-conflict-1-ANTVEEU.md'), bytes: 999 },
  { path: join(HOME, 'proj/.git/objects/x'), bytes: 999 },
  { path: join(HOME, 'Documents/thesis.docx'), bytes: 999 },
  { path: join(HOME, 'Pictures/photo.jpg'), bytes: 999 },
  { path: join(HOME, 'Library/Caches/junk.bin'), bytes: 4096 },
  { path: '/tmp/build.tmp', bytes: 2048 },
];
const plan = atlas.planCleanup(evil, MAC);
const allowed = new Set([join(HOME, 'Library/Caches/junk.bin'), '/tmp/build.tmp']);
const leaked = plan.items.filter((item) => !allowed.has(item.path)).map((item) => item.path);
check('预演只含 L2/L3 且仅限允许的两个样本', plan.items.length === 2 && leaked.length === 0, `泄漏=${leaked.join(', ') || '无'} 条数=${plan.items.length}`);
check('预演里没有任何 L0/L1/L4 条目', plan.items.every((item) => item.tier === 'L2-cache' || item.tier === 'L3-temp'));
check('预演里没有任何受保护路径', plan.items.every((item) => !cls(item.path).protectedReason));
check('被挡下的数量被如实统计（skipped）', plan.skipped.notCleanableTier >= 8, JSON.stringify(plan.skipped));
check('预演标记 dryRun 且总额正确', plan.dryRun === true && plan.bytes === 4096 + 2048, `bytes=${plan.bytes}`);
const flip = atlas.planCleanup([
  { path: join(HOME, '.ssh/id_rsa.tmp') },
  { path: join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault/a.md') },
  { path: '/System/Library/x' },
], MAC);
check('极端输入（只给受保护路径）→ 预演为空', flip.items.length === 0 && flip.count === 0);

console.log('【4】有界扫描（maxEntries / maxDepth 是硬上限）');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
try {
  for (let i = 0; i < 60; i += 1) fs.writeFileSync(path.join(sandbox, `f${i}.bin`), 'x'.repeat(10));
  fs.mkdirSync(path.join(sandbox, 'deep/er/deeper'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'deep/er/deeper/buried.bin'), 'y'.repeat(10));
  const capped = atlas.scan({ roots: [sandbox], maxEntries: 20, maxDepth: 4, deadlineMs: 5000, platform: 'darwin', home: HOME });
  check('entries 不超过 maxEntries=20', capped.stats.entries <= 20, `entries=${capped.stats.entries}`);
  check('被截断时如实标记 truncated', capped.stats.truncated === true && capped.stats.stoppedBy === 'maxEntries', JSON.stringify(capped.stats));
  const shallow = atlas.scan({ roots: [sandbox], maxEntries: 500, maxDepth: 1, deadlineMs: 5000, platform: 'darwin', home: HOME });
  check('maxDepth=1 时不进入深层目录', !shallow.topFiles.some((item) => item.path.includes('buried.bin')), `文件数=${shallow.stats.files}`);
  check('分级汇总与文件总数自洽', Object.values(shallow.tiers).reduce((sum, t) => sum + t.files, 0) === shallow.stats.files);
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }

console.log('【5】边角输入与跨平台');
check('Windows：C:\\Windows\\System32 → L0', tierOf('C:\\Windows\\System32\\cmd.exe', { platform: 'win32', home: 'C:/Users/demo' }) === 'L0-system');
check('Windows：大小写变体 c:\\windows → L0', tierOf('c:\\WINDOWS\\Temp\\a.tmp', { platform: 'win32', home: 'C:/Users/demo' }) === 'L0-system');
check('Linux：/usr/lib → L0', tierOf('/usr/lib/x.so', { platform: 'linux', home: '/home/demo' }) === 'L0-system');
check('Linux：~/.cache → L2', tierOf('/home/demo/.cache/pip/x', { platform: 'linux', home: '/home/demo' }) === 'L2-cache');
check('结尾斜杠不影响判定', tierOf('/tmp/') === tierOf('/tmp'));
check('.. 会被规范化（不给穿越留口子）', cls(join(HOME, '../../etc/hosts')).tier === 'L0-system' && cls(join(HOME, 'Docs/../../../etc/hosts')).tier === 'L0-system', cls(join(HOME, '../../etc/hosts')).tier);
check('空/非字符串输入不抛异常', cls('') && cls('   ') && cls(null) && cls(undefined) && cls(123));
check('protectedPrefixes 含 .ssh / iCloud / markdown-vault 语境', atlas.protectedPrefixes('darwin', HOME).some((p) => p.endsWith('/.ssh')) && atlas.protectedPrefixes('darwin', HOME).some((p) => p.includes('Mobile Documents')));

console.log('');
console.log(`  文件全景核心：${pass} 项通过 / ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
