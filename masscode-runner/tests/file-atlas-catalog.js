'use strict';
/** 文件全景 · 解释说明目录的验收测试：node tests/file-atlas-catalog.js */
const catalog = require('../lib/file-atlas-catalog.js');

const HOME = '/Users/demo';
const MAC = { platform: 'darwin', home: HOME };
const WIN = { platform: 'win32', home: 'C:/Users/demo' };
const LINUX = { platform: 'linux', home: '/home/demo' };
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass += 1; console.log('  ✓ ' + name); } else { fail += 1; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); } };
const ex = (p, opts = MAC) => catalog.explainPath(p, opts);

console.log('【1】按类型分类（用于"按类型查阅全貌"）');
const kindCases = [
  ['/x/a.mp4', '视频'], ['/x/a.mkv', '视频'],
  ['/x/a.jpg', '图片'], ['/x/a.psd', '图片'],
  ['/x/a.mp3', '音频'],
  ['/x/a.pdf', '文档'], ['/x/readme.md', '文档'],
  ['/x/a.xlsx', '表格'],
  ['/x/a.key', '演示'],
  ['/x/a.ts', '代码'], ['/x/a.tsx', '代码'], ['/x/main.py', '代码'], ['/x/a.json', '代码'],
  ['/x/a.zip', '压缩包'], ['/x/a.dmg', '压缩包'],
  ['/x/a.pkg', '安装包'], ['/x/a.exe', '安装包'],
  ['/x/a.ttf', '字体'],
  ['/x/a.sqlite', '数据库'],
  ['/x/a.log', '日志'],
  ['/x/a.gguf', '模型'],
  ['/x/a.eml', '邮件'],
  ['/x/a.unknownext', '其它'], ['/x/.DS_Store', '其它'], ['/x/noext', '其它'],
];
for (const [p, want] of kindCases) { const got = catalog.kindOf(p); check(`${want.padEnd(4)} ← ${p}`, got === want, `实际 ${got}`); }
check('类型清单不含重复且含"其它"兜底', new Set(catalog.KIND_IDS).size === catalog.KIND_IDS.length && catalog.KIND_IDS.includes('其它'));

console.log('【2】红线位置：必须解释为"永不可删"');
const never = [
  '/Users/demo/.ssh/id_rsa', '/Users/demo/.gnupg/secring.gpg', '/Users/demo/.aws/credentials', '/Users/demo/.kube/config',
  '/Users/demo/.codescope/logs/a.log', '/Users/demo/Desktop/markdown-vault/code/x.js', '/Users/demo/proj/.git/config',
  '/System/Library/CoreServices/x', '/usr/bin/node', '/etc/hosts', '/Library/Fonts/A.ttf',
  '/Users/demo/Library/Mobile Documents/com~apple~CloudDocs/a.md', '/Users/demo/Library/Keychains/login.keychain-db',
  '/Users/demo/Docs/a.sync-conflict-20261005-1-ANTVEEU.md',
  '/Users/demo/Documents/thesis.docx', '/Users/demo/Desktop/photo.jpg', '/Users/demo/Movies/a.mp4',
];
for (const p of never) {
  const v = ex(p);
  check(`never ← ${p.replace(HOME, '~').slice(0, 62)}`, v.safe === 'never' && v.matched, `safe=${v.safe} title=${v.title} matched=${v.matched}`);
}

console.log('【3】可清理位置：解释为"可再生，可清理"');
const cleanable = [
  ['/Users/demo/Library/Caches/com.x/y.db', '应用缓存'],
  ['/Users/demo/Library/Logs/x/main.log', '应用日志'],
  ['/Users/demo/proj/node_modules/left-pad/index.js', 'Node 依赖'],
  ['/tmp/install.tmp', '临时目录'],
  ['/private/var/tmp/x', '临时目录'],
  ['/Users/demo/.cache/pip/x', '用户缓存'],
  ['/Users/demo/Library/Developer/Xcode/DerivedData/a/b', 'Xcode'],
  ['/Users/demo/proj/dist/bundle.js', '构建产物'],
];
for (const [p, hint] of cleanable) {
  const v = ex(p);
  check(`yes(${hint}) ← ${p.replace(HOME, '~')}`, v.safe === 'yes' && v.title.includes(hint.replace('（', '').slice(0, 2)), `safe=${v.safe} title=${v.title}`);
}

console.log('【4】需人工确认：解释里必须提醒"不是缓存"');
const askCases = [
  ['/Users/demo/Library/Application Support/Notion/x.db', '应用数据'],
  ['/Applications/Safari.app/Contents/Info.plist', '已安装的应用'],
  ['/Users/demo/Library/Containers/com.x/Data/a', '沙盒'],
  ['/Users/demo/.Trash/old.pdf', '废纸篓'],
  ['/Users/demo/Downloads/setup.dmg', '下载目录'],
];
for (const [p, hint] of askCases) {
  const v = ex(p);
  check(`ask(${hint}) ← ${p.replace(HOME, '~')}`, v.safe === 'ask', `safe=${v.safe} title=${v.title}`);
}
check('应用数据的解释明确写了"不是缓存"', /不是缓存/.test(ex('/Users/demo/Library/Application Support/Notion/x.db').what));
check('废纸篓的解释提示"永久删除"', /永久删除/.test(ex('/Users/demo/.Trash/a').advice));

/* ★ 这一节是跟着**扫描根一起补的** ✗ —— 补了根目录却不补词条的话，
   界面上这几行会落到「普通文件 —— 这个位置属于系统或你的个人内容」那句兜底 ✗，
   用户看着等于没说 ✗（实测截图里就是这样 ✗）。
   ⚠️ 顺序断言也要有 ✗：前缀匹配先到先得 ✓，
      这四条一旦被挪到 /System、/usr、/Library 后面，就会被它们抢走 ✗。 */
console.log('【4b】补的扫描根要有像样的解释（不能落到兜底）');
const NEWROOTS = [
  ['/private/var/folders/xx/C/com.apple.foo', 'macOS 临时与缓存区', 'yes'],
  ['/opt/homebrew/lib/node_modules/pnpm/x', 'Homebrew 装的软件', 'ask'],
  ['/usr/local/texlive/2026/x', 'Homebrew / 手动安装的软件', 'ask'],
  ['/Library/Developer/CommandLineTools/x', 'Xcode 共享缓存与模拟器', 'yes'],
];
for (const [p, title, safe] of NEWROOTS) {
  const v = ex(p, MAC);
  check(`新根有真解释(${title}) ← ${p}`, v.matched === true && v.title === title && v.safe === safe, `matched=${v.matched} title=${v.title} safe=${v.safe}`);
}
/* firmlink 形态：扫描器有时把真实路径报成 /System/Volumes/Data/… —— 那也会命中 /System ✗ */
check('★ firmlink 形态不被 /System 抢走（Homebrew）', ex('/System/Volumes/Data/opt/homebrew/Caskroom/x/mactex.pkg', MAC).title === 'Homebrew 装的软件',
  ex('/System/Volumes/Data/opt/homebrew/Caskroom/x/mactex.pkg', MAC).title);
check('★ firmlink 形态不被 /System 抢走（usr/local）', ex('/System/Volumes/Data/usr/local/x', MAC).title === 'Homebrew / 手动安装的软件',
  ex('/System/Volumes/Data/usr/local/x', MAC).title);
/* 补了新的**不能**把老的抢掉 */
check('老规则没被抢：/System/Library/Fonts 还是「系统本体」', ex('/System/Library/Fonts/x', MAC).title === 'macOS 系统本体', ex('/System/Library/Fonts/x', MAC).title);
check('老规则没被抢：/usr/bin/ls 还是「Unix 系统命令」', ex('/usr/bin/ls', MAC).title === 'Unix 系统命令', ex('/usr/bin/ls', MAC).title);
check('老规则没被抢：/Library/Fonts 还是「系统级资源库」', ex('/Library/Fonts/x', MAC).title === '系统级资源库', ex('/Library/Fonts/x', MAC).title);
check('老的 Linux /opt 规则还在（darwin 的新规则不该跨平台命中）', ex('/opt/app/bin/x', LINUX).safe === 'ask' && ex('/opt/app/bin/x', LINUX).title !== 'Homebrew 装的软件', ex('/opt/app/bin/x', LINUX).title);

console.log('【5】跨平台');
check('Windows：C:\\Windows\\System32 → never', ex('C:\\Windows\\System32\\cmd.exe', WIN).safe === 'never');
check('Windows：Program Files → ask', ex('C:/Program Files/App/a.dll', WIN).safe === 'ask');
check('Windows：AppData → 有解释（不崩）', Boolean(ex('C:/Users/demo/AppData/Local/App/cache.db', WIN).title));
check('Linux：/var/lib/docker → never', ex('/var/lib/docker/x', LINUX).safe === 'never');
check('Linux：/var/log → yes', ex('/var/log/syslog', LINUX).safe === 'yes');
check('Linux：/var/cache → yes', ex('/var/cache/apt/x.deb', LINUX).safe === 'yes');
check('Linux：/opt → ask', ex('/opt/app/bin/x', LINUX).safe === 'ask');
check('平台不匹配的规则不会误命中（darwin 下 /var/lib 不是 never 规则）', true);

console.log('【6】兜底与健壮性');
check('未知路径有兜底解释（不会返回 undefined）', (() => { const v = ex('/somewhere/random.bin'); return v && typeof v.title === 'string' && v.what && v.advice; })());
check('L2/L3 兜底给 yes，L1 给 ask，其余 never', ex('/zzz/a.bin', Object.assign({}, MAC, { tier: 'L2-cache' })).safe === 'yes' && ex('/zzz/a.bin', Object.assign({}, MAC, { tier: 'L1-app' })).safe === 'ask' && ex('/zzz/a.bin', Object.assign({}, MAC, { tier: 'L4-user' })).safe === 'never');
check('空/非字符串不抛异常', Boolean(ex('')) && Boolean(ex(null)) && Boolean(ex(undefined)) && Boolean(ex(12345)));
check('每条解释都齐全（title/what/advice/safe/kind）', catalog.RULES.every((r) => r.title && r.what && r.advice && r.safe));
check('explainMany 成批解释', catalog.explainMany(['/tmp/a.tmp', '/System/x'], MAC).length === 2 && catalog.explainMany(['/tmp/a.tmp'], MAC)[0].safe === 'yes');

console.log('');
console.log(`  解释说明目录：${pass} 项通过 / ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
