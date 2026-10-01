'use strict';

/* ── 三平台仿真验收 ──
   本机只有 macOS，没有 Windows 可跑。所以：所有平台相关的**决策**都做成纯函数
   （命令构造、废纸篓计划、扫描根、保护区、桌面项解析），在 macOS 上注入
   platform:'win32' / 'linux' / 'darwin' 各跑一遍，逐条断言「这条路上不会出现别的平台的
   命令」。真正要执行的那部分（命令跑不跑得起来）交给 docker/colima 里的真 Linux 单独验。

   跑法：node tests/platform-sim.js */

const assert = require('assert');
const path = require('path');
const { createPlatformHost, PLATFORM_IDS } = require('../lib/platform');

let pass = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass += 1; } catch (error) { failures.push(name + ' → ' + error.message); }
}

const ENVS = {
  darwin: { HOME: '/Users/demo', SHELL: '/bin/zsh' },
  win32: { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local', ProgramFiles: 'C:\\Program Files', ProgramData: 'C:\\ProgramData', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
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
  assert.ok(hosts.win32.commands.appIconExtract('C:\\A.exe'));
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
