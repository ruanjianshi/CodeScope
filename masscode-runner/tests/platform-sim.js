'use strict';

/* ── 三平台仿真验收 ──
   本机只有 macOS，没有 Windows 可跑。所以：所有平台相关的**决策**都做成纯函数
   （命令构造、废纸篓计划、扫描根、保护区、桌面项解析），在 macOS 上注入
   platform:'win32' / 'linux' / 'darwin' 各跑一遍，逐条断言「这条路上不会出现别的平台的
   命令」。真正要执行的那部分（命令跑不跑得起来）交给 docker/colima 里的真 Linux 单独验。

   跑法：node tests/platform-sim.js

   另外：Windows 的「磁盘/进程/目录占用/监听端口」四项没有可注入的纯「决策」，只有
   「解析命令输出」这一段是纯函数（lib/system-panel.js 的 _parsers.*）。这一段同样没法在
   真 Windows 上跑，只能用**官方文档/常见输出格式的固定样本**喂进去断言数值 ——
   样本不是真机抓的，别把它当「已在 Windows 验证」。 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { createPlatformHost, PLATFORM_IDS } = require('../lib/platform');
/* 纯解析函数（吃命令输出字符串、吐结构化数组/数字，不执行任何命令）。 */
const { _parsers: parsers } = require('../lib/system-panel');

let pass = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass += 1; } catch (error) { failures.push(name + ' → ' + error.message); }
}

const ENVS = {
  darwin: { HOME: '/Users/demo', SHELL: '/bin/zsh' },
  win32: { USERPROFILE: 'C:\\Users\\demo', APPDATA: 'C:\\Users\\demo\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local', ProgramFiles: 'C:\\Program Files', ProgramData: 'C:\\ProgramData', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  linux: { HOME: '/home/demo', SHELL: '/bin/bash', XDG_DATA_HOME: '/home/demo/.local/share' },
};
const HOMES = { darwin: '/Users/demo', win32: 'C:\\Users\\demo', linux: '/home/demo' };

const hosts = {};
for (const id of PLATFORM_IDS) hosts[id] = createPlatformHost({ platform: id, env: ENVS[id], homedir: HOMES[id], exec: () => ({ ok: false, code: 1, stdout: '', stderr: '' }) });

/* ── 基础事实 ── */
t('exeSuffix 只有 Windows 带后缀', () => {
  assert.strictEqual(hosts.win32.exeSuffix, '.exe');
  assert.strictEqual(hosts.darwin.exeSuffix, '');
  assert.strictEqual(hosts.linux.exeSuffix, '');
});
t('npmCmd 在 Windows 是 npm.cmd', () => {
  assert.strictEqual(hosts.win32.npmCmd, 'npm.cmd');
  assert.strictEqual(hosts.linux.npmCmd, 'npm');
});
t('appDataDir 三平台各自正确', () => {
  assert.ok(hosts.darwin.appDataDir.endsWith(path.join('Library', 'Application Support')));
  assert.strictEqual(hosts.win32.appDataDir, 'C:\\Users\\demo\\AppData\\Roaming');
  assert.strictEqual(hosts.linux.appDataDir, '/home/demo/.local/share');
});
t('标签与自我识别正确', () => {
  assert.deepStrictEqual(PLATFORM_IDS.map((id) => hosts[id].label), ['macOS', 'Windows', 'Linux']);
  assert.ok(hosts.win32.isWin && !hosts.win32.isMac && !hosts.win32.isLinux);
});

/* ── 命令构造：绝不能串平台 ── */
t('openExternal：mac=open / win=cmd start / linux=xdg-open，且互不串台', () => {
  const mac = hosts.darwin.commands.openExternal('https://x');
  const win = hosts.win32.commands.openExternal('https://x');
  const lin = hosts.linux.commands.openExternal('https://x');
  assert.strictEqual(mac.file, 'open');
  assert.strictEqual(lin.file, 'xdg-open');
  assert.strictEqual(win.file, 'cmd.exe');
  assert.ok(win.args.includes('/c') && win.args.some((a) => /start/.test(a)));
  for (const [id, spec] of Object.entries({ win32: win, linux: lin })) assert.ok(!/osascript|^open$/.test(spec.file), id + ' 不该出现 mac 命令');
});
t('reveal：mac=open -R / win=explorer /select / linux=xdg-open 目录', () => {
  assert.deepStrictEqual(hosts.darwin.commands.revealInFileManager('/tmp/a.txt').args, ['-R', '/tmp/a.txt']);
  assert.strictEqual(hosts.win32.commands.revealInFileManager('C:\\a.txt').file, 'explorer.exe');
  assert.ok(hosts.win32.commands.revealInFileManager('C:\\a.txt').args[0].startsWith('/select,'));
  assert.strictEqual(hosts.linux.commands.revealInFileManager('/tmp/a.txt').file, 'xdg-open');
});
t('端口查询：Linux 首选 ss（真 Linux 上没有 lsof），Windows 走 netstat -ano', () => {
  const lin = hosts.linux.commands.listenerPlans(4877);
  assert.strictEqual(lin[0].via, 'ss');
  assert.ok(!lin.some((plan) => plan.via === 'osascript'));
  const win = hosts.win32.commands.listenerPlans(4877);
  assert.strictEqual(win[0].file, 'netstat');
  assert.deepStrictEqual(hosts.darwin.commands.listenerPlans(4877)[0].args.slice(0, 2), ['-nP', '-iTCP:4877']);
});
t('Windows 没有 loadavg 就老实返回 null，不编造', () => {
  assert.strictEqual(hosts.win32.commands.loadAverage(), null);
  assert.ok(hosts.darwin.commands.loadAverage() && hosts.linux.commands.loadAverage());
});
t('图标提取：Linux 不给可执行文件图标（走 .desktop），另两个平台各有路', () => {
  assert.strictEqual(hosts.linux.commands.appIconExtract('/usr/bin/foo'), null);
  assert.ok(hosts.darwin.commands.appIconExtract('/Applications/A.app'));
  assert.ok(hosts.win32.commands.appIconExtract('C:\\A.exe', 'C:\\out\\A.png'));
});
/* win32 的 ExtractAssociatedIcon().ToBitmap().Save(...) 必须有输出落点：
   老实现把空串写进 Save("")，调用方既拿不到图标、原样执行还会直接抛异常。
   这里钉死两件事：① 给了 outPath 就必须出现在命令里；② 不给 outPath 时宁可 null
   （「明说给不出」），也绝不再交出空路径命令。 */
t('win32 图标提取：命令必须带 out 落点，且不传 outPath 时返回 null 而不是空路径命令', () => {
  const app = 'C:\\Program Files\\X\\x.lnk';
  const out = 'C:\\out\\x.png';
  const spec = hosts.win32.commands.appIconExtract(app, out);
  assert.ok(spec && Array.isArray(spec.args), 'win32 给了 outPath 就该给出完整命令：' + JSON.stringify(spec));
  const blob = spec.file + ' ' + spec.args.join(' ');
  /* 用命令原文断言：JSON.stringify 会把反斜杠翻倍，拿它比路径会假失败。 */
  assert.ok(blob.includes(out), 'win32 命令里没带上 out 路径：' + blob);
  assert.ok(!blob.includes('.Save("")'), 'win32 命令仍是空路径，原样执行会抛异常：' + blob);
  assert.ok(blob.includes(app), 'win32 命令里没带上应用路径：' + blob);
  /* 向后兼容：不传 outPath → null（不可用），而不是一条会炸的命令。 */
  const bare = hosts.win32.commands.appIconExtract('C:\\A.exe');
  assert.ok(bare === null || bare === undefined, '不传 outPath 时应当返回 null：' + JSON.stringify(bare));
  /* macOS 断言不变：sips 命令照旧，且带上 --out。 */
  const mac = hosts.darwin.commands.appIconExtract('/Applications/A.app');
  assert.ok(mac && mac.file === 'sips' && mac.args.includes('--out'));
});

/* ── spawn 规格：Windows 的 .cmd 陷阱 ── */
t('Windows 上次 npm.cmd 必须经 cmd /c（否则 spawn EINVAL）', () => {
  const spec = hosts.win32.spawnSpec('C:\\Program Files\\nodejs\\npm.cmd', ['run', 'build:assets']);
  assert.strictEqual(spec.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepStrictEqual(spec.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.ok(/npm\.cmd run build:assets/.test(spec.args[3]));
  assert.strictEqual(spec.windowsHide, true);
});
t('带空格的参数在 Windows 上会被引号保护', () => {
  const spec = hosts.win32.spawnSpec('npm.cmd', ['--prefix', 'C:\\My Project\\app', 'run', 'x']);
  assert.ok(spec.args[3].includes('"C:\\My Project\\app"'), spec.args[3]);
});
t('非 Windows 不加 shell、原样透传 argv（防注入）', () => {
  const spec = hosts.linux.spawnSpec('rsync', ['-az', '/tmp/a b/', 'u@h:/d/']);
  assert.strictEqual(spec.shell, false);
  assert.deepStrictEqual(spec.args, ['-az', '/tmp/a b/', 'u@h:/d/']);
});

/* ── 废纸篓/回收站 ── */
t('Linux 走 XDG 废纸篓（files/ + info/*.trashinfo），不是自建目录', () => {
  const plan = hosts.linux.trashPlan('/home/demo/x.txt');
  assert.strictEqual(plan.method, 'xdg-trash');
  assert.ok(plan.moves[0].to.endsWith(path.join('Trash', 'files', 'x.txt')));
  const info = plan.files.find((f) => f.path.endsWith('x.txt.trashinfo'));
  assert.ok(info && info.content.includes('[Trash Info]') && info.content.includes('DeletionDate='));
});
t('macOS 走 Finder 废纸篓，Windows 走回收站', () => {
  const mac = hosts.darwin.trashPlan('/Users/demo/x.txt');
  assert.strictEqual(mac.command.file, 'osascript');
  assert.ok(/trash|delete/i.test(mac.command.args.join(' ')));
  const win = hosts.win32.trashPlan('C:\\Users\\demo\\x.txt');
  assert.strictEqual(win.command.file, 'powershell.exe');
  assert.ok(win.command.args.join(' ').includes('SendToRecycleBin'));
});

/* ── 保护区（数据安全线） ── */
t('保护区覆盖三平台的系统目录', () => {
  const win = hosts.win32.protectedRoots();
  assert.ok(win.some((p) => /Windows/i.test(p)), 'Windows 必须保护 %SystemRoot%');
  assert.ok(win.some((p) => /Program Files$/.test(p)));
  const lin = hosts.linux.protectedRoots();
  for (const need of ['/usr', '/etc', '/boot', '/proc']) assert.ok(lin.includes(need), 'Linux 缺 ' + need);
  const mac = hosts.darwin.protectedRoots();
  for (const need of ['/System', '/Library', '/Applications']) assert.ok(mac.includes(need), 'macOS 缺 ' + need);
});

/* ── 应用扫描根 ── */
t('应用扫描根按平台给，Windows 不出现 /Applications', () => {
  const dirs = hosts.win32.appRoots().map((r) => r.dir);
  assert.ok(!dirs.some((d) => d.startsWith('/Applications')));
  assert.ok(dirs.some((d) => /Start Menu|Program Files/.test(d)));
  assert.ok(hosts.linux.appRoots().some((r) => r.dir === '/usr/share/applications'));
  assert.ok(hosts.darwin.appRoots().some((r) => r.dir === '/Applications'));
});

/* ── Windows 路径保真度：注入 win32 时不许混进宿主 posix 的路径语义 ──
   本机是 macOS，宿主的 path.* 全是 posix 的。lib/platform.js 的 Windows 分支一旦漏用
   path.win32，仿真出来的就是 'C:\Windows/System32' 这种混合分隔符，或者 sep='/'、pathSep=':' ——
   保护区、回收站这些**安全判断**在 macOS 上就没法验收了（真 Windows 上 path 本来就是 win32，
   这个错只有注入仿真看得见，所以必须在这里钉死）。 */
t('注入 win32：扫描根/回收站/搜索目录/保护区里没有宿主 /Users/，分隔符是 Windows 语义', () => {
  const win = createPlatformHost({ platform: 'win32', env: ENVS.win32, homedir: HOMES.win32, exec: () => ({ ok: false, code: 1, stdout: '', stderr: '' }) });
  const blob = JSON.stringify(win.appRoots())
    + JSON.stringify(win.trashPlan('C:\\Users\\demo\\a.txt'))
    + JSON.stringify(win.searchDirs())
    + JSON.stringify(win.protectedRoots());
  assert.ok(!blob.includes('/Users/'), '注入 win32 时不该混进宿主 /Users/：' + blob);
  /* 字段名以 lib/platform.js 实际导出为准：sep 是路径分隔符，pathSep 是 PATH 分隔符。 */
  assert.strictEqual(win.sep, '\\');
  assert.strictEqual(win.pathSep, ';');
  const report = win.report();
  assert.strictEqual(report.sep, '\\');
  assert.strictEqual(report.pathSep, ';');
});
t('注入 win32：APPDATA 缺失时的兜底目录与保护区 System32 都是纯反斜杠', () => {
  /* 专门钉死两处曾用宿主 path.join 的 Windows 兜底：没有 APPDATA 时的
     %USERPROFILE%\AppData\Roaming，以及 %SystemRoot%\System32。 */
  const bare = createPlatformHost({
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\demo', SystemRoot: 'C:\\Windows', ProgramData: 'C:\\ProgramData', ProgramFiles: 'C:\\Program Files' },
    exec: () => ({ ok: false, code: 1, stdout: '', stderr: '' }),
  });
  assert.strictEqual(bare.appDataDir, 'C:\\Users\\demo\\AppData\\Roaming');
  assert.ok(!bare.appDataDir.includes('/'), 'AppData 兜底目录混进了 posix 分隔符：' + bare.appDataDir);
  assert.ok(bare.protectedRoots().includes('C:\\Windows\\System32'), '保护区缺 %SystemRoot%\\System32：' + JSON.stringify(bare.protectedRoots()));
  for (const dir of bare.searchDirs()) assert.ok(!dir.includes('/'), '搜索目录混进了 posix 分隔符：' + dir);
});
t('注入 darwin：分隔符仍是 posix，且扫描根/废纸篓不回归（macOS 不能跟着变）', () => {
  const mac = createPlatformHost({ platform: 'darwin', env: ENVS.darwin, homedir: HOMES.darwin, exec: () => ({ ok: false, code: 1, stdout: '', stderr: '' }) });
  assert.strictEqual(mac.sep, '/');
  assert.strictEqual(mac.pathSep, ':');
  const report = mac.report();
  assert.strictEqual(report.sep, '/');
  assert.strictEqual(report.pathSep, ':');
  assert.strictEqual(mac.appRoots().map((x) => x.source).join(','), 'system,apple,apple,user');
  assert.strictEqual(mac.trashPlan('/Users/xiaoq/a.txt').method, 'finder');
});

/* ── .desktop 解析（拿真实 Ubuntu 格式的样本）── */
const DESKTOP_SAMPLE = [
  '[Desktop Entry]',
  'Type=Application',
  'Name=Firefox',
  'Name[zh_CN]=火狐浏览器',
  'Comment=Browse the Web',
  'Exec=firefox %u',
  'Icon=firefox',
  'Terminal=false',
  'Categories=Network;WebBrowser;',
  '',
  '[Desktop Action new-window]',
  'Name=Open a New Window',
  'Exec=firefox --new-window %u',
].join('\n');

t('.desktop 解析：取到名称/命令/图标，并剥掉 %u 这类占位符', () => {
  const entry = hosts.linux.parseDesktopEntry(DESKTOP_SAMPLE);
  assert.strictEqual(entry.name, '火狐浏览器');
  assert.strictEqual(entry.exec, 'firefox');
  assert.strictEqual(entry.icon, 'firefox');
  assert.strictEqual(entry.terminal, false);
});
/* 回归防线：appRoots().source 必须是机器可读值。曾经被写成中文，
   结果 macOS 上 rank[source] 变 NaN、系统自带应用被标成「可卸载」——
   smoke 测试没覆盖到这条，所以这里专门钉死。 */
t('appRoots 的 source 是机器可读值（macOS 必须是 system/apple/user）', () => {
  assert.strictEqual(hosts.darwin.appRoots().map((x) => x.source).join(','), 'system,apple,apple,user');
  assert.strictEqual(hosts.darwin.appRoots().filter((x) => x.source === 'apple').length, 2);
  for (const [id, host] of Object.entries(hosts)) {
    const allowed = id === 'darwin' ? ['system', 'apple', 'user'] : id === 'win32' ? ['system', 'user'] : ['system', 'user', 'flatpak', 'snap'];
    for (const root of host.appRoots()) {
      assert.ok(allowed.includes(root.source), id + ' 的 source 非法：' + root.source);
      assert.ok(!/[\u4e00-\u9fa5]/.test(root.source), id + ' 的 source 混进了中文：' + root.source);
      assert.ok(root.label, id + ' 缺少给人看的 label');
    }
  }
});

t('.desktop 解析：NoDisplay/Hidden 带标记返回、非 Application 一律跳过', () => {
  const hidden = hosts.linux.parseDesktopEntry('[Desktop Entry]\nType=Application\nName=隐藏项\nExec=x\nNoDisplay=true');
  assert.ok(hidden && hidden.name === '隐藏项', 'NoDisplay 条目也应当被解析出来');
  assert.strictEqual(hidden.noDisplay, true);
  const hidden2 = hosts.linux.parseDesktopEntry('[Desktop Entry]\nType=Application\nName=隐藏项2\nExec=x\nHidden=true');
  assert.ok(hidden2 && hidden2.noDisplay === true);
  const visible = hosts.linux.parseDesktopEntry('[Desktop Entry]\nType=Application\nName=可见项\nExec=x');
  assert.ok(visible && visible.noDisplay === false);
  assert.strictEqual(hosts.linux.parseDesktopEntry('[Desktop Entry]\nType=Link\nName=X\nExec=x'), null);
  assert.strictEqual(hosts.linux.parseDesktopEntry(''), null);
  assert.strictEqual(hosts.linux.parseDesktopEntry(null), null);
});

/* ── 包管理器与安装提示 ── */
t('包管理器按平台候选正确', () => {
  assert.deepStrictEqual(hosts.darwin.packageManagers().map((p) => p.id), ['brew', 'mas']);
  assert.ok(hosts.linux.packageManagers().map((p) => p.id).includes('apt'));
  assert.ok(hosts.win32.packageManagers().map((p) => p.id).includes('winget'));
});
t('安装提示三平台各自成句，不把 mac 方案丢给 Windows', () => {
  const win = hosts.win32.commands.installHint('node');
  assert.ok(/winget/.test(win.command) && !/brew/.test(win.command), win.command);
  const lin = hosts.linux.commands.installHint('docker');
  assert.ok(/apt/.test(lin.command));
  assert.ok(/brew/.test(hosts.darwin.commands.installHint('git').command));
  assert.strictEqual(hosts.linux.commands.installHint('不存在的工具'), null);
});

/* ── 能力自述（界面直接用） ── */
t('report() 三平台都有完整能力自述，没有「没路可走」的项', () => {
  for (const id of PLATFORM_IDS) {
    const report = hosts[id].report();
    assert.ok(report.adapters, id + ' 缺 adapters');
    assert.deepStrictEqual(report.adaptersMissing, [], id + ' 有没实现的能力：' + JSON.stringify(report.adaptersMissing));
    for (const key of ['openExternal', 'reveal', 'trash', 'apps', 'icons', 'ports', 'disk', 'memory', 'network']) {
      assert.ok(report.adapters[key] && typeof report.adapters[key].via === 'string', id + ' 的 ' + key + ' 没说清走哪条路');
    }
    assert.ok(report.pathSep && report.npmCmd && typeof report.exeSuffix === 'string');
  }
});
t('report() 是纯数据：不执行任何命令（传进一个会炸的 exec 也不受影响）', () => {
  const strict = createPlatformHost({ platform: 'linux', env: ENVS.linux, homedir: '/home/demo', exec: () => { throw new Error('report 不该执行命令'); } });
  assert.strictEqual(strict.report().label, 'Linux');
  assert.strictEqual(strict.commands.openExternal('x').file, 'xdg-open');
  assert.strictEqual(strict.trashPlan('/home/demo/y').method, 'xdg-trash');
});

/* ── Windows 命令输出解析（固定样本）────────────────────────────────────
   本机没有 Windows：这些样本取自 Windows 官方文档与常见输出格式，**未经真机验证**。
   能钉住的只有「同一段字符串喂进解析函数，出来的数值对不对」。 */

const NETSTAT_SAMPLE = [
  '',
  '活动连接',
  '',
  '  协议  本地地址          外部地址        状态           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1304',
  '  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4',
  '  TCP    127.0.0.1:4877         0.0.0.0:0              LISTENING       1234',
  '  TCP    192.168.1.5:139        0.0.0.0:0              LISTENING       4',
  '  TCP    [::]:135               [::]:0                 LISTENING       1304',
  '  TCP    [::]:445               [::]:0                 LISTENING       4',
  '  TCP    [::1]:4877             [::]:0                 LISTENING       1234',
  '  UDP    0.0.0.0:500            *:*                                    1560',
  '  UDP    [::]:500               *:*                                    1560',
  '  TCP    192.168.1.5:52344      93.184.216.34:443      ESTABLISHED     9012',
  '',
  '',
].join('\r\n');

t('netstat -ano -p TCP 样本：只留 LISTENING，IPv6 认得出，UDP/ESTABLISHED/表头都跳过', () => {
  const rows = parsers.parseNetstatListen(NETSTAT_SAMPLE);
  assert.strictEqual(rows.length, 7, '应当只留 7 条 LISTENING，实际 ' + rows.length);
  assert.deepStrictEqual(rows.map((row) => row.port), [135, 445, 4877, 139, 135, 445, 4877]);
  const loopback = rows.find((row) => row.port === 4877 && !row.ipv6);
  assert.strictEqual(loopback.address, '127.0.0.1:4877');
  assert.strictEqual(loopback.bind, '127.0.0.1');
  assert.strictEqual(loopback.pid, 1234);
  assert.strictEqual(loopback.ipv6, false);
  const v6 = rows.find((row) => row.port === 445 && row.ipv6);
  assert.strictEqual(v6.address, '[::]:445', '[::] 这种 IPv6 写法必须认');
  assert.strictEqual(v6.bind, '[::]');
  assert.strictEqual(v6.pid, 4);
  /* 英文表头版本同样认得（解析不依赖本地化的标题文字）。 */
  const english = parsers.parseNetstatListen([
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       777',
    '',
  ].join('\r\n'));
  assert.deepStrictEqual(english.map((row) => [row.port, row.pid]), [[80, 777]]);
});

t('netstat 样本：空行/垃圾输入返回空数组而不是抛异常', () => {
  for (const bad of ['', '   ', '\r\n\r\n', '这不是 netstat 的输出', '  TCP 1.2.3.4:80 5.6.7.8:443 ESTABLISHED 11', null, undefined, 12345, {}]) {
    const rows = parsers.parseNetstatListen(bad);
    assert.ok(Array.isArray(rows) && rows.length === 0, '坏输入应当给空数组：' + String(bad));
  }
});

const TASKLIST_SAMPLE = [
  '"映像名称","PID","会话名","会话#","内存使用"',
  '"System Idle Process","0","Services","0","8 K"',
  '"System","4","Services","0","144 K"',
  '"chrome.exe","1234","Console","1","123,456 K"',
  '"node.exe","9876","Console","1","1,234,567 K"',
  '"svchost.exe","808","Services","0","45,678 K"',
  '',
].join('\r\n');

t('tasklist /FO CSV /NH 样本：引号与千位逗号都剥对，内存换成字节', () => {
  const rows = parsers.parseTasklistCsv(TASKLIST_SAMPLE);
  assert.strictEqual(rows.length, 5, '表头行必须被跳过，实际 ' + rows.length);
  const chrome = rows.find((row) => row.pid === 1234);
  assert.strictEqual(chrome.command, 'chrome.exe');
  assert.strictEqual(chrome.app, 'chrome.exe');
  assert.strictEqual(chrome.rss, 123456 * 1024, '千位逗号没剥干净：' + chrome.rss);
  assert.strictEqual(chrome.state, 'Console');
  assert.strictEqual(rows.find((row) => row.pid === 9876).rss, 1234567 * 1024);
  assert.strictEqual(rows.find((row) => row.pid === 4).rss, 144 * 1024);
  assert.strictEqual(rows.find((row) => row.pid === 0).command, 'System Idle Process');
  for (const row of rows) {
    /* 前端拿 cpu 直接 .toFixed(1)：必须是数字 0，给 null/undefined 会当场炸。 */
    assert.strictEqual(typeof row.cpu, 'number', 'cpu 必须是数字');
    assert.strictEqual(typeof row.rss, 'number', 'rss 必须是数字');
    assert.strictEqual(row.user, '', '会话名不是用户名，不能塞进 user 冒充');
  }
});

t('tasklist 样本：坏输入/缺列返回空数组，内存单位换算单独钉一遍', () => {
  for (const bad of ['', '\r\n', 'INFO: No tasks are running which match the specified criteria.', '"a.exe","111","Console"', null, undefined, 42]) {
    const rows = parsers.parseTasklistCsv(bad);
    assert.ok(Array.isArray(rows) && rows.length === 0, '坏输入应当给空数组：' + String(bad));
  }
  assert.strictEqual(parsers.parseKbLabel('1,234,567 K'), 1234567 * 1024);
  assert.strictEqual(parsers.parseKbLabel('8 K'), 8 * 1024);
  assert.strictEqual(parsers.parseKbLabel('12 MB'), 12 * 1024 * 1024);
  assert.strictEqual(parsers.parseKbLabel('N/A'), null);
});

const DISK_CSV_SAMPLE = [
  '"DeviceID","Size","FreeSpace"',
  '"C:","511,574,536,704","123,456,789,012"',
  '"D:","2,000,398,934,016","1,999,000,000,000"',
  '"E:","0","0"',
  '',
].join('\r\n');

t('ConvertTo-Csv 磁盘样本：千位逗号剥掉，容量/可用/已用/百分比算对，0 容量盘跳过', () => {
  const rows = parsers.parseWindowsVolumes(DISK_CSV_SAMPLE);
  assert.strictEqual(rows.length, 2, 'C:/D: 留下，E:（容量 0）跳过，实际 ' + rows.length);
  const c = rows[0];
  assert.strictEqual(c.device, 'C:');
  assert.strictEqual(c.mount, 'C:\\');
  assert.strictEqual(c.total, 511574536704);
  assert.strictEqual(c.free, 123456789012);
  assert.strictEqual(c.used, 388117747692);
  assert.strictEqual(c.capacity, 76);
  assert.ok(Math.abs(c.usage - (388117747692 / 511574536704 * 100)) < 1e-9, 'usage 该是 used/total*100：' + c.usage);
  assert.strictEqual(c.kind, 'system', '%SystemRoot% 所在的盘要算系统盘');
  const d = rows[1];
  assert.strictEqual(d.total, 2000398934016);
  assert.strictEqual(d.free, 1999000000000);
  assert.strictEqual(d.used, 1398934016);
});

t('Win32_LogicalDisk 的 JSON（平台层现有计划）也认：单盘对象与多盘数组都对', () => {
  const one = parsers.parseWindowsVolumes(JSON.stringify({ DeviceID: 'C:', Size: 511574536704, FreeSpace: 123456789012, DriveType: 3 }));
  assert.strictEqual(one.length, 1);
  assert.strictEqual(one[0].mount, 'C:\\');
  assert.strictEqual(one[0].free, 123456789012);
  assert.strictEqual(one[0].kind, 'system');
  const many = parsers.parseWindowsVolumes(JSON.stringify([
    { DeviceID: 'C:', Size: 511574536704, FreeSpace: 123456789012, DriveType: 3 },
    { DeviceID: 'E:', Size: 2000398934016, FreeSpace: 1000000000000, DriveType: 3 },
    { DeviceID: 'Z:', Size: 107374182400, FreeSpace: 10737418240, DriveType: 4 },
    { DeviceID: 'F:', Size: null, FreeSpace: null, DriveType: 2 },
  ]));
  assert.deepStrictEqual(many.map((row) => row.kind), ['system', 'other', 'network'], 'DriveType 4 是网络盘、2 是可移动盘：' + JSON.stringify(many.map((row) => row.kind)));
  assert.deepStrictEqual(many.map((row) => row.device), ['C:', 'E:', 'Z:'], '没插盘的 F: 不该出现在列表里');
});

t('磁盘样本：坏 JSON/空输出返回空数组，不抛异常', () => {
  for (const bad of ['', '   ', '{"DeviceID":', 'Get-CimInstance : 拒绝访问', null, undefined, 42]) {
    assert.deepStrictEqual(parsers.parseWindowsVolumes(bad), []);
  }
});

t('目录占用样本：du 的 KB 与 PowerShell 的字节各按自己的单位换算', () => {
  assert.strictEqual(parsers.parseDirSizeOutput('1953125\t/Users/demo/Library/Caches', 'kb'), 1953125 * 1024);
  assert.strictEqual(parsers.parseDirSizeOutput('2000000000\r\n', 'kb'), 2000000000 * 1024);
  assert.strictEqual(parsers.parseDirSizeOutput('8192', 'bytes'), 8192);
  assert.strictEqual(parsers.parseDirSizeOutput('\r\n126418944\r\n', 'bytes'), 126418944);
  /* PowerShell 脚本对空目录兜底输出 0（不是空串）。 */
  assert.strictEqual(parsers.parseDirSizeOutput('0', 'bytes'), 0);
  for (const bad of ['du: cannot access foo', '', '   \r\n', null, undefined, 42]) {
    assert.strictEqual(parsers.parseDirSizeOutput(bad, 'kb'), null, '坏输入应当给 null：' + String(bad));
  }
});

/* 真机样本：本机 macOS 的 ps -Ao（列与 lib/system-panel.js 的 PS_FIELDS 完全一致）。 */
const PS_SAMPLE = [
  '    1     0 root               0.1  0.1  15856 06:45:02 Ss   /sbin/launchd',
  '  587     1 root               0.4  0.1  23952 01:38:10 Ss   /usr/libexec/logd',
  ' 4321     1 ' + os.userInfo().username + '              1.5  0.3  123456 02:10:33 S    /Applications/CodeScope.app/Contents/MacOS/CodeScope --flag',
  '',
].join('\n');

t('posix 的 ps -Ao 样本照旧解析（加 Windows 分支不能动 macOS 这条路）', () => {
  const rows = parsers.parsePsOutput(PS_SAMPLE);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].pid, 1);
  assert.strictEqual(rows[0].user, 'root');
  assert.strictEqual(rows[0].rss, 15856 * 1024);
  assert.strictEqual(rows[0].elapsed, '06:45:02');
  assert.strictEqual(rows[0].state, 'Ss');
  assert.strictEqual(rows[0].command, '/sbin/launchd');
  assert.strictEqual(rows[0].app, 'launchd');
  assert.strictEqual(rows[0].mine, false);
  const me = rows[2];
  assert.strictEqual(me.pid, 4321);
  assert.strictEqual(me.user, os.userInfo().username);
  assert.strictEqual(me.cpu, 1.5);
  assert.strictEqual(me.rss, 123456 * 1024);
  assert.strictEqual(me.app, 'CodeScope', '.app/Contents/MacOS 里取可执行名');
  assert.strictEqual(me.mine, true);
});

t('Windows 的进程/目录占用计划来自平台层，且不混进 posix 命令', () => {
  const win = hosts.win32.commands;
  const tasklist = win.processList();
  assert.strictEqual(tasklist.file, 'tasklist');
  assert.deepStrictEqual(tasklist.args, ['/FO', 'CSV', '/NH']);
  const usage = win.dirUsage('C:\\A B\\x');
  assert.strictEqual(usage.file, 'powershell.exe');
  assert.strictEqual(usage.unit, 'bytes');
  assert.ok(usage.args.includes('-NoProfile'), 'PowerShell 必须带 -NoProfile');
  const script = usage.args.join(' ');
  assert.ok(script.includes('Get-ChildItem') && script.includes('Measure-Object'), '目录占用应当是递归求和：' + script);
  assert.ok(script.includes("'C:\\A B\\x'"), '带空格的路径必须被 PowerShell 单引号包住：' + script);
  assert.ok(!/\bdu\b|\bdf\b/.test(script), 'Windows 计划里不该出现 du/df：' + script);
  /* posix 侧原样：processList() 交回 null（调用方继续用自己的 ps -Ao），dirUsage 还是 du -sk。 */
  for (const id of ['darwin', 'linux']) {
    assert.strictEqual(hosts[id].commands.processList(), null, id + ' 不该拿到 tasklist');
    const plan = hosts[id].commands.dirUsage('/tmp/x');
    assert.strictEqual(plan.file, 'du');
    assert.deepStrictEqual(plan.args, ['-sk', '/tmp/x']);
    assert.strictEqual(plan.unit, 'kb');
  }
});

t('真机 posix 回归：du 计划真跑一遍，parseDirSizeOutput 吃真输出', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-platform-sim-'));
  try {
    fs.writeFileSync(path.join(tmp, 'blob.bin'), Buffer.alloc(8192));
    const plan = hosts.darwin.commands.dirUsage(tmp);
    const run = cp.spawnSync(plan.file, plan.args, { encoding: 'utf8', timeout: 20000 });
    const bytes = parsers.parseDirSizeOutput(run.stdout, plan.unit);
    assert.ok(typeof bytes === 'number' && bytes >= 8192, 'du 真跑至少应统计到 8KB，实际 ' + bytes);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log('');
for (const [id, host] of Object.entries(hosts)) {
  const report = host.report();
  console.log('  ' + id.padEnd(6) + ' ' + report.label.padEnd(8) + ' npm=' + report.npmCmd.padEnd(8) + ' 家目录=' + report.home.padEnd(18) + ' 能力 ' + report.adaptersReady.length + '/' + Object.keys(report.adapters).length);
}
console.log('');
if (failures.length) {
  console.log('  ✗ 平台仿真：' + pass + ' 通过 / ' + failures.length + ' 失败');
  for (const line of failures) console.log('      ' + line);
  process.exit(1);
}
console.log('  ✅ 平台仿真（darwin / win32 / linux 注入）：' + pass + '/' + pass + ' 通过');
