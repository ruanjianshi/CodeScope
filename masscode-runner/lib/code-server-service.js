'use strict';


/* 平台差异统一问 lib/platform.js。 */
const { HOST } = require('./platform');
/* ── code-server（浏览器版 VS Code）托管服务 ──
   与 opencode / DSH 同一套模式：CodeScope 负责把它拉起来、探活、暴露状态。

   为什么 code-server 不写进 package.json：
   ① 它连 VS Code 本体一起 695MB，塞进项目（而这个项目在 iCloud Drive 里）既臃肿，
      iCloud 还可能把不常用文件"优化"成占位符，运行时直接报错；
   ② 项目里有 @electron/node-gyp，它提供的 node_modules/.bin/node-gyp 会**遮蔽**真正的 node-gyp，
      code-server 的 postinstall 会拿 Electron 版去 rebuild VS Code 的原生模块，必然失败。
   所以它和 opencode 一样是「外部可选工具」：按约定目录 + PATH 去找，找不到就如实报未安装。 */

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const DEFAULT_PORT = 4899;
const LOOPBACK = '127.0.0.1';

/* 预置的默认设置：只在用户还没有 User/settings.json 时写入，不覆盖已有配置。
   目的是治「卡」：
   - watcherExclude/search.exclude：对 iCloud Drive 里的项目尤其重要——node_modules
     这类目录一进 watcher，iCloud 的按需下载 + 同步扫描会把编辑器拖到不可用；
   - 关自动更新/自动检查：扩展与本体更新都在后台抢网络和 CPU；
   - 关启动欢迎页：iframe 里少一次无谓的渲染。 */
function defaultSettings() {
  return {
    'workbench.startupEditor': 'none',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'files.exclude': { '**/.DS_Store': true },
    'files.watcherExclude': {
      '**/node_modules/**': true,
      '**/.git/objects/**': true,
      '**/.git/subtree-cache/**': true,
      '**/dist/**': true,
      '**/build/**': true,
      '**/coverage/**': true,
    },
    'search.exclude': {
      '**/node_modules': true,
      '**/dist': true,
      '**/build': true,
      '**/coverage': true,
    },
  };
}

/* code-server 的界面语言来自 --locale 参数，而它**不读 argv.json**（那是桌面版 VS Code 的约定）。
   这里替它读一次：想换语言时仍然只需改 argv.json 里的 locale，不必翻面板设置。 */
function readLocaleArg(userDataDir) {
  try {
    const file = path.join(userDataDir, 'argv.json');
    if (!fs.existsSync(file)) return [];
    /* argv.json 是 JSONC：允许注释与尾随逗号，先清掉再解析，解析失败就当没配。 */
    const raw = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    const locale = String((JSON.parse(raw) || {}).locale || '').trim();
    return /^[A-Za-z]{2}(-[A-Za-z0-9]+)*$/.test(locale) ? ['--locale', locale] : [];
  } catch (_) { return []; }
}

/* 确保用户数据目录里有这份基础设置；已有文件则原样保留（那是用户自己的选择）。 */
function ensureDefaultSettings(userDataDir) {
  try {
    const userDir = path.join(userDataDir, 'User');
    const file = path.join(userDir, 'settings.json');
    if (fs.existsSync(file)) return;
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(defaultSettings(), null, 2) + '\n', 'utf8');
  } catch (_) { /* 写不进去不影响启动 */ }
}

/* ── 可用性用「实测」判定，不要写死 Node 主版本 ──
   code-server 4.117.0 的 package.json 声明 engines.node = "22"，但实测它在 Node 26 上完全可用
   （服务能起、/healthz 200、浏览器里 workbench 正常渲染）。反过来，这台机器上 brew 装的
   node@22 因为 libsimdjson 动态库版本错位已经跑不起来（dyld: Library not loaded）。
   所以：
   ① 不再拿 Node 主版本吓人；
   ② 真跑一次 `code-server --version` 来判断能不能用，并把版本号报出来（以前 version 恒为空）；
   ③ 指定的运行时跑不动时，自动改用实测能跑的那个，失败才如实报错。 */
const PROBE_TIMEOUT = 12000;
const probeState = { promise: null, result: null };

/* ── Node 版本闸门之一：解析 engines.node 声明（纯函数，可单独测试）──
   事故背景：code-server 4.117.0 的 package.json 声明 engines.node = "22"，但被跑在 Node 26 上时
   服务能起、编辑器本体正常，**扩展宿主约 20 秒后停止回包**，于是所有「扩展提供内容的 webview」
   （图片预览、Markdown 预览）永远转圈 —— 症状离原因很远，极难排查。所以这里要能自己判定
   「将要用来跑 code-server 的那个 node」是否满足它自己声明的范围。
   声明写法不统一（"22" / "22.x" / ">=22 <23" / "^22.0.0" / "~22.1.0" / ">=18.0.0 || >=22"），
   于是自己写一个小而完整的解析器：**解析不出来一律返回「未知」，绝不猜** ——
   猜错会把用户本来能用的环境判死，或者让自愈去乱换 node。 */

/* "22.22.0" / "v26.7.0" → { major, minor, patch, version }；认不出来返回 null。 */
function parseNodeVersion(text) {
  const matched = String(text == null ? '' : text).trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.\-]+)?$/);
  if (!matched) return null;
  const major = Number(matched[1]);
  const minor = Number(matched[2] == null ? 0 : matched[2]);
  const patch = Number(matched[3] == null ? 0 : matched[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  return { major, minor, patch, version: major + '.' + minor + '.' + patch };
}

/* 只按数字三元组比大小。 */
function compareNodeVersion(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}

/* 一条子句 → { op, major, minor, patch, parts }；parts 是「写死的数字段数」。
   number 段里的 x / X / * 视作「没写」（"22.x" 与 "22" 同义）。看不懂返回 null。 */
function parseNodeClause(text) {
  const matched = String(text == null ? '' : text).trim().match(/^(\^|~|>=|<=|>|<|=)?\s*v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/);
  if (!matched) return null;
  const op = matched[1] || '=';
  const major = Number(matched[2]);
  const minorText = matched[3];
  const patchText = matched[4];
  const hasMinor = minorText != null && !/^[xX*]$/.test(minorText);
  const hasPatch = hasMinor && patchText != null && !/^[xX*]$/.test(patchText);
  const parts = hasPatch ? 3 : (hasMinor ? 2 : 1);
  return {
    op,
    major,
    minor: hasMinor ? Number(minorText) : 0,
    patch: hasPatch ? Number(patchText) : 0,
    parts,
  };
}

/* 一条子句是否被实际版本满足。缺段按 semver 的习惯解释：
   "22" == 22.*.*，"≥22.1" == ≥22.1.0，"<23" == <23.0.0，">22" == ≥23.0.0。 */
function nodeClauseHolds(clause, actual) {
  const target = { major: clause.major, minor: clause.minor, patch: clause.patch };
  const compared = compareNodeVersion(actual, target);
  switch (clause.op) {
    case '=':
      if (clause.parts === 3) return compared === 0;
      if (clause.parts === 2) return actual.major === clause.major && actual.minor === clause.minor;
      return actual.major === clause.major;
    /* 简化版 caret：主版本必须相同，且不低于写死的版本（^22.0.0 → ≥22.0.0 <23）。 */
    case '^':
      return actual.major === clause.major && compared >= 0;
    /* ~22.1.0 → ≥22.1.0 <22.2.0；只写主版本时等于 "^"。 */
    case '~':
      return actual.major === clause.major && (clause.parts === 1 || actual.minor === clause.minor) && compared >= 0;
    case '>=': return compared >= 0;
    case '>':
      if (clause.parts === 3) return compared > 0;
      if (clause.parts === 2) return actual.major > clause.major || (actual.major === clause.major && actual.minor > clause.minor);
      return actual.major > clause.major;
    case '<': 
      if (clause.parts === 3) return compared < 0;
      if (clause.parts === 2) return actual.major < clause.major || (actual.major === clause.major && actual.minor < clause.minor);
      return actual.major < clause.major;
    case '<=':
      if (clause.parts === 3) return compared <= 0;
      if (clause.parts === 2) return actual.major < clause.major || (actual.major === clause.major && actual.minor <= clause.minor);
      return actual.major <= clause.major;
    default: return false;
  }
}

/* 把声明切成「组」：空格或逗号是 AND，|| 是 OR。
   返回 { ok:true, any, groups } 或 { ok:false, reason }（reason 直接进提示，说明为什么是未知）。 */
function parseNodeRange(spec) {
  const text = String(spec == null ? '' : spec).trim();
  if (!text || text === '*' || text === 'x' || text === 'latest') return { ok: true, any: true, groups: [], spec: text };
  const groups = [];
  for (const groupText of text.split('||')) {
    const clauses = [];
    for (const clauseText of groupText.split(/[\s,]+/).filter(Boolean)) {
      const clause = parseNodeClause(clauseText);
      if (!clause) return { ok: false, any: false, groups: [], spec: text, reason: '不认识的版本写法「' + clauseText + '」' };
      clauses.push(clause);
    }
    if (!clauses.length) return { ok: false, any: false, groups: [], spec: text, reason: '版本声明里有空的或条件' };
    groups.push(clauses);
  }
  return { ok: true, any: false, groups, spec: text };
}

/* 三值判定：true 满足 / false 不满足 / null 未知（声明看不懂或版本号看不懂）。
   未知绝不当 false 用 —— 这正是「不猜」的落点。 */
function satisfiesNodeRange(spec, versionText) {
  const range = parseNodeRange(spec);
  if (!range.ok) return null;
  const actual = parseNodeVersion(versionText);
  if (!actual) return null;
  if (range.any) return true;
  return range.groups.some((clauses) => clauses.every((clause) => nodeClauseHolds(clause, actual)));
}

/* ── Node 版本闸门之二：换不换 node 的决策（纯函数，可单独测试）──
   current：实测出「会用来跑 code-server」的那台 node（null = 没判定出来）。
   candidates：本机可用的候选 node，按优先级排好，每项 { path, version, source, env }。
   「没判定出来」不等于「不合规」：未知时保持原样，不自作主张换 node。 */
function chooseNodePlan(input) {
  const required = String((input && input.required) || '').trim();
  const current = (input && input.current) || null;
  const candidates = ((input && input.candidates) || []).filter((item) => item && item.path && parseNodeVersion(item.version));
  const currentVersion = current && parseNodeVersion(current.version) ? current.version : '';
  if (!required) {
    return { required: '', status: 'ok', reason: 'code-server 没有声明 Node 版本要求', current, chosen: null };
  }
  const range = parseNodeRange(required);
  if (!range.ok) {
    return { required, status: 'unknown', reason: '看不懂 code-server 声明的 Node 要求：' + range.reason, current, chosen: null };
  }
  if (!currentVersion) {
    return { required, status: 'unknown', reason: '没能判定当前是哪台 node 在跑 code-server', current, chosen: null };
  }
  const verdict = satisfiesNodeRange(required, currentVersion);
  if (verdict === null) {
    return { required, status: 'unknown', reason: '声明的 Node 要求无法解析，判不了当前 v' + currentVersion, current, chosen: null };
  }
  if (verdict) {
    return { required, status: 'ok', reason: '当前 Node v' + currentVersion + ' 满足它声明的 engines.node = ' + required, current, chosen: null };
  }
  const chosen = candidates.find((item) => satisfiesNodeRange(required, item.version) === true) || null;
  if (chosen) {
    return {
      required,
      status: 'switch',
      reason: '当前 Node v' + currentVersion + ' 不满足它声明的 engines.node = ' + required + '，已自动选择 Node ' + chosen.version + '（' + chosen.path + '）',
      current,
      chosen,
    };
  }
  return {
    required,
    status: 'unsatisfied',
    reason: '当前 Node v' + currentVersion + ' 不满足它声明的 engines.node = ' + required + '，本机也没找到合规的 node',
    current,
    chosen: null,
  };
}

function isExecutableFile(target) {
  try { return !!target && fs.statSync(target).isFile(); } catch (_) { return false; }
}

/* 在 PATH（含各平台惯例目录）上找可执行文件。
   Windows 没有 which（要用 where），否则 code-server / node 永远探测不到、界面一直说「未安装」。 */
function onPath(name) {
  try {
    const found = HOST.which(name);
    return found && isExecutableFile(found) ? found : '';
  } catch (_) { return ''; }
}

/* 找一个「真正能跑的 code-server」，顺序固定：
   环境变量 → ~/.codescope 的 bin shim → 项目内 bin shim → entry.js（配一个真正的 node）→ PATH。
   返回 null 表示这台机器上没装；调用方据此给出安装提示，而不是猜版本号。 */
/* 找一个「真正的 node」：桌面版里 process.execPath 是 Electron，不能拿来跑 code-server。
   顺序：CODESCOPE_NODE_BIN → PATH 上的 node → process.execPath（且必须不是 Electron）。 */
function resolveNodeRuntime() {
  const explicit = String(process.env.CODESCOPE_NODE_BIN || '').trim();
  if (explicit && isExecutableFile(explicit)) return explicit;
  const fromPath = onPath('node');
  if (!process.versions.electron && isExecutableFile(process.execPath)) return process.execPath;
  return fromPath || '';
}

/* 找一个「真正能跑的 code-server」，顺序固定：
   环境变量 → ~/.codescope 的 bin shim → 项目内 bin shim → entry.js（配一个真正的 node）→ PATH。
   返回 null 表示这台机器上没装；调用方据此给安装提示，而不是猜版本号。 */
function resolveCodeServer() {
  const explicit = String(process.env.CODESCOPE_CODE_SERVER_BIN || '').trim();
  if (explicit && isExecutableFile(explicit)) return { command: explicit, args: [], via: 'CODESCOPE_CODE_SERVER_BIN' };
  const home = os.homedir();
  for (const shim of [
    path.join(home, '.codescope', 'node_modules', '.bin', 'code-server'),
    path.join(__dirname, '..', 'node_modules', '.bin', 'code-server'),
  ]) {
    if (isExecutableFile(shim)) return { command: shim, args: [], via: shim };
  }
  const runtime = resolveNodeRuntime();
  for (const entry of [
    path.join(home, '.codescope', 'node_modules', 'code-server', 'out', 'node', 'entry.js'),
    path.join(__dirname, '..', 'node_modules', 'code-server', 'out', 'node', 'entry.js'),
  ]) {
    if (!isExecutableFile(entry)) continue;
    if (runtime) return { command: runtime, args: [entry], via: runtime + ' ' + entry };
  }
  const fromPath = onPath('code-server');
  if (fromPath) return { command: fromPath, args: [], via: 'PATH 上的 code-server' };
  return null;
}

/* 按「先用谁跑 code-server」的顺序列出候选，探测时逐个真跑 --version。 */
function runtimeCandidates() {
  const list = [];
  const push = (command, args, via) => { if (command && isExecutableFile(command)) list.push({ command, args, via }); };
  push(String(process.env.CODESCOPE_CODE_SERVER_BIN || '').trim(), [], 'CODESCOPE_CODE_SERVER_BIN');
  const home = os.homedir();
  for (const shim of [
    path.join(home, '.codescope', 'node_modules', '.bin', 'code-server'),
    path.join(__dirname, '..', 'node_modules', '.bin', 'code-server'),
  ]) push(shim, [], shim);
  const entries = [
    path.join(home, '.codescope', 'node_modules', 'code-server', 'out', 'node', 'entry.js'),
    path.join(__dirname, '..', 'node_modules', 'code-server', 'out', 'node', 'entry.js'),
  ];
  const runtimes = [];
  const explicit = String(process.env.CODESCOPE_NODE_BIN || '').trim();
  if (explicit && isExecutableFile(explicit)) runtimes.push(explicit);
  const fromPath = onPath('node');
  if (fromPath && fromPath !== explicit) runtimes.push(fromPath);
  if (!process.versions.electron && isExecutableFile(process.execPath) && !runtimes.includes(process.execPath)) runtimes.push(process.execPath);
  for (const entry of entries) {
    if (!isExecutableFile(entry)) continue;
    for (const runtime of runtimes) push(runtime, [entry], runtime + ' ' + entry);
  }
  const onPathCodeServer = onPath('code-server');
  if (onPathCodeServer) push(onPathCodeServer, [], 'PATH 上的 code-server');
  return list;
}

function probeCandidate(candidate) {
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let out = '';
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    try { child = spawn(candidate.command, [...candidate.args, '--version'], { stdio: ['ignore', 'pipe', 'pipe'], env: candidate.env ? { ...process.env, ...candidate.env } : process.env }); }
    catch (error) { return done({ ok: false, error: String((error && error.message) || error) }); }
    const keep = (chunk) => { out = (out + String(chunk)).slice(-1200); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.once('error', (error) => done({ ok: false, error: String((error && error.message) || error) }));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} done({ ok: false, error: '探测超时' }); }, PROBE_TIMEOUT);
    child.once('exit', (code) => {
      clearTimeout(timer);
      const lines = out.split('\n').map((line) => line.trim()).filter(Boolean);
      const matched = out.match(/(\d+\.\d+\.\d+)[^\n]*with Code/i) || out.match(/\b(\d+\.\d+\.\d+)\b/);
      if (code === 0 && matched) done({ ok: true, version: matched[1] });
      else done({ ok: false, error: String(lines[lines.length - 1] || ('退出码 ' + code)).slice(0, 220) });
    });
  });
}

/* ── Node 版本闸门之三：找 code-server 的声明、找合规的 node、实测「实际会用哪台 node」 ── */

/* 从一个路径里认出 code-server 的安装根（用户可能用 CODESCOPE_CODE_SERVER_BIN 指到别处，
   那台 code-server 的声明与原生模块都要按它自己的目录来判，不能按默认目录猜）。 */
function codeServerRootFrom(target) {
  const marker = path.sep + 'node_modules' + path.sep + 'code-server' + path.sep;
  const at = String(target || '').indexOf(marker);
  return at < 0 ? '' : String(target).slice(0, at + marker.length - 1);
}

/* code-server 的安装目录（跟 resolveCodeServer 认的是同一批约定目录）。 */
function codeServerRoots() {
  const home = os.homedir();
  const list = [];
  const resolved = resolveCodeServer();
  for (const target of [resolved && resolved.command, resolved && resolved.args && resolved.args[0]]) {
    const root = codeServerRootFrom(target);
    if (root) list.push(root);
  }
  list.push(path.join(home, '.codescope', 'node_modules', 'code-server'));
  list.push(path.join(__dirname, '..', 'node_modules', 'code-server'));
  return list.filter((item, index) => list.indexOf(item) === index);
}

/* 判据只有一个：code-server 自己 package.json 里的 engines.node。
   读不到就如实说读不到（此时不判定、不换 node），绝不自造一个版本要求。 */
function readCodeServerEngines() {
  for (const root of codeServerRoots()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const required = String(((parsed || {}).engines || {}).node || '').trim();
      return { ok: true, root, packageVersion: String((parsed || {}).version || ''), required };
    } catch (_) { /* 换下一个候选目录 */ }
  }
  return { ok: false, root: '', packageVersion: '', required: '', reason: '读不到 code-server 的 package.json，无法核对 Node 版本要求' };
}

/* 换 node 启动时得有一个入口脚本。shim 自己也是 exec 这个 entry.js，所以直接找它。 */
function codeServerEntry(resolved) {
  const fromArgs = String((resolved && resolved.args && resolved.args[0]) || '');
  if (/entry\.js$/.test(fromArgs) && isExecutableFile(fromArgs)) return fromArgs;
  for (const root of codeServerRoots()) {
    const entry = path.join(root, 'out', 'node', 'entry.js');
    if (isExecutableFile(entry)) return entry;
  }
  return '';
}

/* Homebrew 的 simdjson / simdutf 被升级后，旧 node@22 二进制仍按老 soname 找库，
   而老 keg 里还留着那些 dylib，加上 DYLD_FALLBACK_LIBRARY_PATH 就能跑起来。
   这与 ~/.codescope/node22-node.sh 是同一招，只是不依赖那个脚本存在（它可能被 npm install 冲掉），
   也绝不去改它一分一毫。 */
function homebrewLibraryFallback() {
  if (process.platform !== 'darwin') return '';
  const parts = [];
  for (const lib of ['simdjson', 'simdutf']) {
    const kegRoot = path.join('/opt/homebrew/Cellar', lib);
    let cells = [];
    try { cells = fs.readdirSync(kegRoot).sort(); } catch (_) { continue; }
    for (const cell of cells) {
      const dir = path.join(kegRoot, cell, 'lib');
      try {
        if (fs.readdirSync(dir).includes('lib' + lib + '.dylib')) parts.push(dir);
      } catch (_) { /* 这个 keg 的 lib 目录不可读就跳过 */ }
    }
  }
  return parts.join(':');
}

/* 跑一次 `<node> -v`，拿到真实版本号（不拿路径名里的数字猜）。 */
function nodeVersionOnce(binary, extraEnv) {
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let out = '';
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    try { child = spawn(binary, ['-v'], { stdio: ['ignore', 'pipe', 'pipe'], env: extraEnv ? { ...process.env, ...extraEnv } : process.env }); }
    catch (error) { return done({ ok: false, error: String((error && error.message) || error) }); }
    const keep = (chunk) => { out = (out + String(chunk)).slice(-600); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.once('error', (error) => done({ ok: false, error: String((error && error.message) || error) }));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} done({ ok: false, error: '探测超时' }); }, PROBE_TIMEOUT);
    child.once('exit', (code) => {
      clearTimeout(timer);
      const lines = out.trim().split('\n').map((line) => line.trim()).filter(Boolean);
      const version = parseNodeVersion((out.match(/v(\d+\.\d+\.\d+)/) || [])[1] || '');
      /* output 保留完整尾部：dyld 的报错首行才是原因，末行只是「Reason: tried: ...」，
         只看末行会漏掉「Library not loaded」而放弃一次本来能成的重试。 */
      if (code === 0 && version) done({ ok: true, version: version.version, output: out });
      else done({ ok: false, error: (lines[lines.length - 1] || ('退出码 ' + code)).slice(0, 220), output: out });
    });
  });
}

/* 探测一台 node 到底能不能跑：先直接跑，dyld 报错就补上 Homebrew 旧库搜索路径再跑一次。
   跑不起来的一律不做候选 —— 否则「自愈」会把一个起不来的 node 换上去，比不换更糟
   （这台机器上 /opt/homebrew/opt/node@22/bin/node 正是这种：直接跑 dyld 就挂）。 */
async function probeNodeBinary(entry) {
  const plain = await nodeVersionOnce(entry.path, null);
  if (plain.ok) return { path: entry.path, version: plain.version, source: entry.source, env: null, note: '' };
  const fallback = homebrewLibraryFallback();
  const text = (plain.error || '') + ' ' + (plain.output || '');
  if (fallback && /dyld|Library not loaded|image not found|\.dylib/i.test(text)) {
    const env = { DYLD_FALLBACK_LIBRARY_PATH: (process.env.DYLD_FALLBACK_LIBRARY_PATH ? process.env.DYLD_FALLBACK_LIBRARY_PATH + ':' : '') + fallback };
    const retried = await nodeVersionOnce(entry.path, env);
    if (retried.ok) {
      return { path: entry.path, version: retried.version, source: entry.source, env, note: '需要补 DYLD_FALLBACK_LIBRARY_PATH（Homebrew 升级了 simdjson/simdutf）' };
    }
  }
  return null;
}

/* 声明里出现的主版本号 → 去这些常见位置找对应的 node。 */
function nodeMajorHints(spec) {
  const range = parseNodeRange(spec);
  const majors = [];
  if (range.ok) {
    for (const group of range.groups) {
      for (const clause of group) if (!majors.includes(clause.major)) majors.push(clause.major);
    }
  }
  return majors;
}

/* 候选 node：环境变量排第一（用户说了算），然后是声明要求的各主版本的惯例安装位置，
   最后才是 PATH 上的 node 与当前进程自己 —— 这两个只是兜底，未必合规。 */
function commonNodePaths(spec) {
  const home = os.homedir();
  const list = [];
  const push = (target, source) => {
    const item = String(target || '').trim();
    if (item && isExecutableFile(item)) list.push({ path: item, source });
  };
  push(String(process.env.CODESCOPE_NODE_BIN || '').trim(), 'CODESCOPE_NODE_BIN');
  for (const major of nodeMajorHints(spec)) {
    push('/opt/homebrew/opt/node@' + major + '/bin/node', 'Homebrew node@' + major);
    push('/usr/local/opt/node@' + major + '/bin/node', 'Homebrew node@' + major);
    try {
      for (const cell of fs.readdirSync(path.join('/opt/homebrew/Cellar', 'node@' + major)).sort()) {
        push(path.join('/opt/homebrew/Cellar', 'node@' + major, cell, 'bin', 'node'), 'Homebrew node@' + major);
      }
    } catch (_) { /* 没装这个 keg */ }
    try {
      for (const cell of fs.readdirSync(path.join(home, '.nvm', 'versions', 'node')).sort()) {
        if (new RegExp('^v' + major + '\\.').test(cell)) push(path.join(home, '.nvm', 'versions', 'node', cell, 'bin', 'node'), 'nvm node ' + cell);
      }
    } catch (_) { /* 没有 nvm */ }
  }
  push(onPath('node'), 'PATH 上的 node');
  if (!process.versions.electron && isExecutableFile(process.execPath)) push(process.execPath, 'CodeScope 自己的 node');
  return list.filter((item, index) => list.findIndex((other) => other.path === item.path) === index);
}

/* 兜底判定（不起进程）：.bin/code-server 被 npm install 还原成指向 entry.js 的符号链接时，
   实际用的是 shebang 里的那个 node（`#!/usr/bin/env node` → PATH 上的 node）——这正是要抓的回归。 */
async function staticRuntimeNode(candidate) {
  let target = '';
  try {
    if (!fs.lstatSync(candidate.command).isSymbolicLink()) return null;
    target = fs.realpathSync(candidate.command);
  } catch (_) { return null; }
  if (!/\.(js|cjs|mjs)$/.test(target)) return null;
  let shebang = '';
  try { shebang = String(fs.readFileSync(target, 'utf8')).split('\n')[0].trim(); } catch (_) { return null; }
  const direct = shebang.match(/^#!\s*(\/\S*\/node)\b/);
  const binary = direct && isExecutableFile(direct[1])
    ? direct[1]
    : (/^#!\s*\/usr\/bin\/env(-S)?\s+node\b/.test(shebang) ? onPath('node') : '');
  if (!binary) return null;
  const probed = await nodeVersionOnce(binary, null);
  if (!probed.ok) return null;
  return { path: binary, version: probed.version, source: direct ? '代码入口的 shebang' : 'PATH 上的 node（代码入口的 shebang）', note: '' };
}

/* 「实际会用来跑 code-server 的那台 node」用实测判定，不读脚本文本猜：
   给候选命令注入 NODE_OPTIONS=--require <探针>，真正执行 code-server 的那个 node 会把
   version / execPath 写出来。对 ~/.codescope/node_modules/.bin/code-server 这种 sh 包装脚本也有效
   （探针会穿透包装脚本）——这是「兼容那套手工修复、不替换它」的关键。 */
function measureRuntimeNode(candidate) {
  return new Promise((resolve) => {
    if (!candidate || !candidate.command) return resolve(null);
    const probeFile = path.join(os.tmpdir(), 'codescope-node-probe-' + process.pid + '-' + Date.now() + '.js');
    const outFile = probeFile + '.json';
    const cleanup = () => {
      try { fs.rmSync(probeFile, { force: true }); } catch (_) { /* 清不掉不影响结论 */ }
      try { fs.rmSync(outFile, { force: true }); } catch (_) { /* 同上 */ }
    };
    /* NODE_OPTIONS 按空格切分，路径里有空格就干脆不注入（退回静态判定）。 */
    if (/\s/.test(probeFile)) return resolve(null);
    try {
      fs.writeFileSync(probeFile, 'try { require("fs").writeFileSync(' + JSON.stringify(outFile)
        + ', JSON.stringify({ version: process.version, execPath: process.execPath })); } catch (e) {}\n', 'utf8');
    } catch (_) { return resolve(null); }
    const previous = String(process.env.NODE_OPTIONS || '').trim();
    const env = { ...process.env, ...(candidate.env || {}), NODE_OPTIONS: (previous ? previous + ' ' : '') + '--require ' + probeFile };
    let settled = false;
    let child = null;
    const done = (value) => { if (settled) return; settled = true; cleanup(); resolve(value); };
    try { child = spawn(candidate.command, [...(candidate.args || []), '--version'], { stdio: ['ignore', 'pipe', 'pipe'], env }); }
    catch (_) { return done(null); }
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    child.once('error', () => done(null));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} done(null); }, PROBE_TIMEOUT);
    child.once('exit', () => {
      clearTimeout(timer);
      let measured = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        const version = parseNodeVersion(parsed && parsed.version);
        if (version) measured = { path: String((parsed && parsed.execPath) || candidate.command), version: version.version, source: '实测（' + candidate.via + '）', note: '' };
      } catch (_) { measured = null; }
      done(measured);
    });
  });
}

/* Node 闸门的结果全局算一次（status() 每 1.5 秒被轮询，不能每次都起进程）。 */
const nodeState = { promise: null, result: null };

function nodeRuntimePlan() {
  if (nodeState.result) return Promise.resolve(nodeState.result);
  if (nodeState.promise) return nodeState.promise;
  nodeState.promise = (async () => {
    const engines = readCodeServerEngines();
    const candidate = runtimeCandidates()[0] || null;
    let current = candidate ? await measureRuntimeNode(candidate) : null;
    if (!current && candidate) current = await staticRuntimeNode(candidate);
    let plan = chooseNodePlan({ required: engines.required, current });
    /* 只有「实测不满足」时才去找别的 node：状态未知就保持原样，不自作主张换。 */
    if (plan.status === 'unsatisfied') {
      const usable = [];
      for (const entry of commonNodePaths(engines.required)) {
        const probed = await probeNodeBinary(entry);
        if (probed && !usable.some((item) => item.path === probed.path)) usable.push(probed);
      }
      plan = chooseNodePlan({ required: engines.required, current, candidates: usable });
    }
    nodeState.result = { ...plan, engines, autoSelected: null };
    return nodeState.result;
  })();
  nodeState.promise.then(() => { nodeState.promise = null; }, () => { nodeState.promise = null; });
  return nodeState.promise;
}

/* ── 原生模块完整性检查 ──
   事故背景：code-server 的 postinstall 硬性拒绝非 Node 22，于是 @vscode/spdlog、
   @vscode/native-watchdog、@vscode/sqlite3 没编译、@vscode/fs-copyfile 没装上，
   vscode.git 激活失败 → 左侧「源代码管理」图形界面整个不可用。
   这里只**看**（存在性）加一个隔离子进程 require（功能性判定），**绝不自动联网安装**。 */
const VSCODE_NATIVE_MODULES = [
  { name: 'spdlog', why: '日志与输出通道' },
  { name: 'native-watchdog', why: '主进程看门狗' },
  { name: 'fs-copyfile', why: '大文件复制加速（vscode.git 依赖它）' },
  { name: 'sqlite3', why: '源代码管理（Git）图形界面' },
];
const nativeState = { promise: null, result: null };

function nativeModuleDir(root, name) {
  return path.join(root, 'lib', 'vscode', 'node_modules', '@vscode', name, 'build', 'Release');
}

/* 一个 Release 目录里有没有 .node（文件名各模块不同：spdlog.node / watchdog.node /
   vscode_fs.node / vscode-sqlite3.node，所以不写死文件名）。 */
function nativeBinaries(dir) {
  try { return fs.readdirSync(dir).filter((file) => file.endsWith('.node')); } catch (_) { return []; }
}

/* 功能性判定放在子进程里做：原生模块加载失败可能直接把进程带走，不能拿面板进程去试。 */
function nativeLoadCheck(root, modules, nodePath, extraEnv) {
  return new Promise((resolve) => {
    const items = modules.map((item) => ({ name: item.name, dir: path.join(root, 'lib', 'vscode', 'node_modules', '@vscode', item.name) }));
    if (!items.length) return resolve({ ok: true, verdicts: {} });
    const script = [
      'const items = ' + JSON.stringify(items) + ';',
      'const out = items.map(function (item) { try { require(item.dir); return item.name + "=OK"; } catch (error) { return item.name + "=FAIL " + String((error && error.message) || error).split("\\n")[0]; } });',
      'console.log(out.join("\\n"));',
    ].join('\n');
    const binary = nodePath && isExecutableFile(nodePath) ? nodePath : process.execPath;
    let settled = false;
    let child = null;
    let out = '';
    const done = (value) => { if (settled) return; settled = true; resolve(value); };
    try {
      child = spawn(binary, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], env: extraEnv ? { ...process.env, ...extraEnv } : process.env });
    } catch (_) { return done({ ok: false, verdicts: {} }); }
    const keep = (chunk) => { out = (out + String(chunk)).slice(-2000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.once('error', () => done({ ok: false, verdicts: {} }));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} done({ ok: false, verdicts: {} }); }, PROBE_TIMEOUT);
    child.once('exit', (code) => {
      clearTimeout(timer);
      const verdicts = {};
      for (const line of out.split('\n')) {
        const matched = line.trim().match(/^([\w-]+)=(OK|FAIL) ?(.*)$/);
        if (matched) verdicts[matched[1]] = { ok: matched[2] === 'OK', error: matched[3] || '' };
      }
      /* 子进程自己都没跑起来（比如 node 挂了）就只说「不知道」，不诬告模块缺失。 */
      done({ ok: code === 0 && Object.keys(verdicts).length > 0, verdicts });
    });
  });
}

function nativeModuleCheck() {
  if (nativeState.result) return Promise.resolve(nativeState.result);
  if (nativeState.promise) return nativeState.promise;
  nativeState.promise = (async () => {
    const engines = readCodeServerEngines();
    if (!engines.root) {
      nativeState.result = { ok: true, root: '', modules: [], missing: [], unloadable: [], reason: engines.reason, checkedAt: Date.now() };
      return nativeState.result;
    }
    const modules = VSCODE_NATIVE_MODULES.map((item) => {
      const dir = nativeModuleDir(engines.root, item.name);
      const binaries = nativeBinaries(dir);
      return { name: item.name, why: item.why, dir, binaries, present: binaries.length > 0, loadable: null };
    });
    const present = modules.filter((item) => item.present);
    if (present.length) {
      /* 用「实际跑 code-server 的那台 node」去 require 最有说服力；还没判定出来就用面板自己的 node
         （这几个模块是 N-API，实测两代 node 都能加载）。 */
      const plan = nodeState.result;
      const runtime = (plan && (plan.autoSelected || plan.current)) || null;
      const loaded = await nativeLoadCheck(engines.root, present, runtime && runtime.path, runtime && runtime.env);
      if (loaded.ok) {
        for (const item of present) {
          const verdict = loaded.verdicts[item.name];
          if (verdict) item.loadable = verdict.ok ? true : String(verdict.error || '加载失败');
        }
      }
    }
    const missing = modules.filter((item) => !item.present);
    const unloadable = modules.filter((item) => item.present && item.loadable !== null && item.loadable !== true);
    nativeState.result = {
      ok: missing.length === 0 && unloadable.length === 0,
      root: engines.root,
      modules,
      missing,
      unloadable,
      reason: '',
      checkedAt: Date.now(),
    };
    return nativeState.result;
  })();
  nativeState.promise.then(() => { nativeState.promise = null; }, () => { nativeState.promise = null; });
  return nativeState.promise;
}

/* 探测结果全局缓存一次：status() 每 1.5 秒被轮询，不能每次都 fork 一个进程。 */
function probeRuntime() {
  if (probeState.result) return Promise.resolve(probeState.result);
  if (probeState.promise) return probeState.promise;
  probeState.promise = (async () => {
    const candidates = runtimeCandidates();
    const failures = [];
    for (const candidate of candidates) {
      const outcome = await probeCandidate(candidate);
      if (outcome.ok) {
        probeState.result = { ok: true, command: candidate.command, args: candidate.args, via: candidate.via, version: outcome.version, failures };
        return probeState.result;
      }
      failures.push({ via: candidate.via, error: outcome.error });
    }
    probeState.result = { ok: false, count: candidates.length, failures };
    return probeState.result;
  })();
  probeState.promise.then(() => { probeState.promise = null; }, () => { probeState.promise = null; });
  return probeState.promise;
}

/* 环境更新装完 code-server 之后必须让它重新实测：探测结果全局只算一次，
   不清掉的话「未安装」会一直挂到进程重启，用户会以为装了没用。
   Node 闸门与原生模块检查同理：重装/重建之后必须重算，否则新装的模块看着还是缺的。 */
function resetProbe() {
  probeState.result = null;
  probeState.fallbackNote = '';
  nodeState.result = null;
  nativeState.result = null;
}

/* hint 里的「运行 node」这句：判定结果出来了就照实说，没判定出来就维持原来的说法，
   绝不因为「还没测完」就把版本号写成别的。 */
function nodeRuntimeSentence() {
  const plan = nodeState.result;
  if (!plan) return '当前 Node v' + process.versions.node;
  if (plan.autoSelected && plan.autoSelected.version) {
    return '已自动选择 Node ' + parseNodeVersion(plan.autoSelected.version).major + '（v' + plan.autoSelected.version + '）运行，满足它声明的 engines.node = ' + plan.required;
  }
  if (plan.status === 'switch' && plan.chosen) {
    return '将自动改用 Node ' + parseNodeVersion(plan.chosen.version).major + '（v' + plan.chosen.version + '）启动，因为它声明要求 ' + plan.required;
  }
  const running = plan.current;
  if (!running || !running.version) return '当前 Node v' + process.versions.node;
  if (plan.status === 'ok') return '运行 Node v' + running.version + '（满足它声明的 engines.node = ' + plan.required + '）';
  if (plan.status === 'unsatisfied') return '运行 Node v' + running.version + '，但不满足它声明的 engines.node = ' + plan.required;
  return '运行 Node v' + running.version + '（无法判定是否满足它声明的 engines.node）';
}

/* 给 status() 用的同步摘要：还没探完就先不说吓人的话。 */
function runtimeSummary() {
  const result = probeState.result;
  if (!result) return { version: '', hint: '' };
  if (!result.ok) {
    const first = result.failures[0] || {};
    return {
      version: '',
      hint: result.count === 0
        ? '没找到可执行的 code-server（试试：mkdir -p ~/.codescope && cd ~/.codescope && npm install code-server）'
        : 'code-server 在这台机器上跑不起来：' + (first.error || '未知原因')
          + (result.failures.length > 1 ? '（已试 ' + result.failures.length + ' 种运行方式）' : ''),
    };
  }
  const note = probeState.fallbackNote ? probeState.fallbackNote + ' · ' : '';
  return { version: result.version, hint: note + '实测可用：code-server ' + result.version + ' · ' + nodeRuntimeSentence() };
}

function probe(url, timeout = 800) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => { res.destroy(); resolve(res.statusCode >= 200 && res.statusCode < 500); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/* 端口上只要有东西在听就算被占——哪怕它对 /healthz 回 502。
   只看 HTTP 探活会漏掉那种「占着端口、上游已死、每秒重试」的反代：
   code-server 一启动就 EADDRINUSE 退出，用户视角就是编辑工作台永远打不开。 */
function portOccupied(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    const done = (value) => { try { socket.destroy(); } catch (_) {} resolve(value); };
    socket.setTimeout(600, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/* 两类问题的中文结论。前端只渲染 hint，所以结论拼进 hint 里，另外也给结构化字段，
   方便以后有别的界面要显示时不用再解析中文。 */
function runtimeWarnings() {
  const plan = nodeState.result;
  const natives = nativeState.result;
  const warnings = [];
  if (plan && plan.status === 'switch' && plan.chosen && !plan.autoSelected) {
    warnings.push('运行 code-server 的 Node 版本不合规（它声明 engines.node = ' + plan.required + '，当前 v' + plan.current.version
      + '）：启动时会自动改用 ' + plan.chosen.path + '（Node ' + parseNodeVersion(plan.chosen.version).major + '，v' + plan.chosen.version + '）');
  } else if (plan && plan.status === 'unsatisfied') {
    warnings.push('运行 code-server 的 Node 版本不合规（它声明 engines.node = ' + plan.required + '，当前 v' + plan.current.version
      + '），本机也没有找到合规的 node：扩展提供的预览（图片、Markdown）可能启动约 20 秒后一直转圈；'
      + '把 CODESCOPE_NODE_BIN 指向 Node ' + plan.required + ' 的 node 可修复');
  } else if (plan && plan.status === 'unknown') {
    warnings.push('无法判定运行 code-server 的 Node 是否满足它声明的 engines.node = ' + (plan.required || '（未声明）') + '：' + plan.reason);
  }
  if (natives && !natives.ok) {
    const missing = (natives.missing || []).map((item) => item.name).join('、');
    const unloadable = (natives.unloadable || []).map((item) => item.name + '（' + item.loadable + '）').join('、');
    warnings.push('VS Code 原生模块不完整' + (missing ? '，缺少 ' + missing : '') + (unloadable ? '，加载失败 ' + unloadable : '')
      + '：左侧「源代码管理」等图形界面会不可用；需要在 Node ' + ((plan && plan.required) || '22') + ' 下重建（CodeScope 不会自动联网安装）');
  }
  return warnings;
}

/* 结构化字段：判定依据一眼可见，不必去解析中文提示。 */
function nodeRuntimeField() {
  const plan = nodeState.result;
  if (!plan) return { required: '', status: 'checking', version: process.versions.node, path: '', autoSelected: false, note: '正在核对 code-server 声明的 Node 版本要求' };
  const running = plan.autoSelected || plan.current;
  return {
    required: plan.required || '',
    status: plan.status,
    version: (running && running.version) || '',
    path: (running && running.path) || '',
    autoSelected: !!plan.autoSelected,
    note: plan.reason,
  };
}

function nativeModuleField() {
  const natives = nativeState.result;
  if (!natives) return { ok: null, root: '', missing: [], unloadable: [], note: '正在检查 VS Code 原生模块' };
  return {
    ok: natives.ok,
    root: natives.root,
    missing: (natives.missing || []).map((item) => item.name),
    unloadable: (natives.unloadable || []).map((item) => item.name),
    note: natives.ok
      ? '原生模块齐全（' + (natives.modules || []).length + ' 个：' + (natives.modules || []).map((item) => item.name).join('、') + '）'
      : (natives.reason || '原生模块缺失，只能由 Node 22 下的 postinstall 重建，CodeScope 不联网安装'),
  };
}

function createCodeServerService(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  let port = Number(options.port) || DEFAULT_PORT;
  const hostname = options.hostname || LOOPBACK;
  const proxyPort = Number(options.proxyPort) || 0;
  const dataRoot = options.dataRoot || path.join(os.tmpdir(), 'codescope');
  const onPortChange = typeof options.onPortChange === 'function' ? options.onPortChange : null;
  const userDataDir = path.join(dataRoot, 'code-server');
  const extensionsDir = path.join(userDataDir, 'extensions');
  const configFile = path.join(userDataDir, 'config.yaml');
  let url = `http://${hostname}:${port}`;
  let child = null;
  let state = 'stopped';
  let message = '';
  let startPromise = null;

  /* ⚠️⚠️ 提示要给**两条路** ✗✗ —— 原来只写 `npm install code-server` ✓，
     实测在云服务器（Ubuntu + Node 24）上**装不上** ✗：
     code-server 的 npm 包会拉一个原生模块 `kerberos` ✓ → `gyp ERR!` 编译失败 ✗
     （缺构建依赖 ✓，而且编过了也未必对 ✓）。
     → 官方**推荐**的是那个独立安装脚本 ✓（下的是预编译包 ✓，不碰原生模块 ✓）；
        npm 那条路只在**项目外**装才有意义 ✓（项目内有 @electron/node-gyp 会遮蔽 ✓）。
     两条都写上 ✓，用户哪条能走通走哪条 ✓。 */
  const missingHint = '未安装 code-server。二选一：'
    + '① 官方脚本（推荐，装到 /usr/bin）：curl -fsSL https://code-server.dev/install.sh | sh  —— '
    + '若服务器连不上 GitHub，就去 https://github.com/coder/code-server/releases 下 '
    + 'code-server-<版本>-linux-amd64.tar.gz，解到 /usr/lib/code-server 再把 bin/code-server 链到 /usr/bin；'
    + '② npm 方式（要本机有编译工具链，可能因原生模块 kerberos 编译失败）：'
    + 'mkdir -p ~/.codescope && cd ~/.codescope && npm install code-server';

  function installed() {
    const resolved = resolveCodeServer();
    return !!(resolved && resolved.command);
  }

  function status() {
    const resolved = resolveCodeServer();
    const ready = state === 'running' || state === 'external';
    const present = !!(resolved && resolved.command);
    /* 顺手触发后台实测（不阻塞这次响应），下次轮询就能给出真实结论。
       三件事各自只算一次：能不能跑（probeState）、Node 版本闸门（nodeState）、原生模块（nativeState）。 */
    if (!probeState.result) probeRuntime().catch(() => {});
    if (present && !nodeState.result) nodeRuntimePlan().catch(() => {});
    if (present && !nativeState.result) nativeModuleCheck().catch(() => {});
    const summary = runtimeSummary();
    const warnings = present ? runtimeWarnings() : [];
    const baseHint = summary.hint || (present
      ? '由 CodeScope 托管运行；扩展市场是 Open VSX（非微软市场）'
      : missingHint);
    return {
      key: 'code-server',
      label: 'VS Code',
      group: '代码编辑器',
      for: '浏览器版 VS Code（iframe 内嵌），可打开本机任意文件夹',
      available: ready,
      installed: present,
      managed: !!child,
      state,
      version: summary.version,
      url,
      port,
      proxyPort,
      extensionsDir,
      message: message || (present ? '等待启动 VS Code 服务' : (resolved && resolved.broken) || missingHint),
      hint: warnings.length ? baseHint + ' · ' + warnings.join(' · ') : baseHint,
      nodeRuntime: nodeRuntimeField(),
      nativeModules: nativeModuleField(),
      warnings,
    };
  }

  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      let resolved = resolveCodeServer();
      if (!resolved || !resolved.command) {
        state = 'unavailable';
        message = (resolved && resolved.broken) || missingHint;
        return status();
      }
      /* 实测能跑的运行方式优先：比如 CODESCOPE_NODE_BIN 指向的 Node 其实起不来时，
         自动改用真正能跑的那个，而不是把失败原样丢给用户。 */
      const probed = await probeRuntime().catch(() => null);
      if (probed && probed.ok && probed.command && (probed.command !== resolved.command || String(probed.args[0] || '') !== String(resolved.args[0] || ''))) {
        resolved = { command: probed.command, args: probed.args, via: probed.via };
        probeState.fallbackNote = '已自动改用实测可运行的运行方式';
        message = probeState.fallbackNote + '（' + probed.via + '）';
      }
      /* ── Node 版本闸门与自愈 ──
         判据是 code-server 自己声明的 engines.node。不合规时把 spawn 的 executable 换成
         找到的那台合规 node，**参数一个不动**（入口脚本 + 原来的 code-server 参数）。
         找不到合规 node 时不擅自 brew install / npm install，也不阻断启动（非破坏性：
         宁可给一个「预览可能失效但能编辑」的编辑器，并把结论如实暴露出去）。 */
      const nodePlan = await nodeRuntimePlan().catch(() => null);
      if (nodePlan && nodePlan.status === 'switch' && nodePlan.chosen) {
        const entry = codeServerEntry(resolved);
        if (entry) {
          const major = parseNodeVersion(nodePlan.chosen.version).major;
          resolved = {
            command: nodePlan.chosen.path,
            args: [entry, ...resolved.args.slice(resolved.args.length ? 1 : 0)],
            env: nodePlan.chosen.env || null,
            via: nodePlan.chosen.path + ' ' + entry,
          };
          nodePlan.autoSelected = { path: nodePlan.chosen.path, version: nodePlan.chosen.version, env: nodePlan.chosen.env || null };
          probeState.fallbackNote = '已自动选择 Node ' + major + '（v' + nodePlan.chosen.version + '）启动 code-server'
            + (nodePlan.chosen.note ? '，' + nodePlan.chosen.note : '');
          message = probeState.fallbackNote;
          log('[code-server] ' + probeState.fallbackNote + '：' + nodePlan.reason);
        } else {
          /* 连入口脚本都找不到就没法换 node，如实说，不改启动方式。 */
          message = nodePlan.reason + '；找不到 code-server 的入口脚本，只能按原方式启动';
          log('[code-server] ' + message);
        }
      }
      if (child && child.exitCode == null) { state = 'running'; return status(); }
      ensureDefaultSettings(userDataDir);
      /* 已经有别人跑在同一个端口上就直接复用，不重复拉起。 */
      if (await probe(url + '/healthz')) {
        state = 'external';
        message = `已连接 ${url} 上现有的 code-server`;
        return status();
      }
      /* 默认端口被别的程序占着就自动往上换：有一种占法特别隐蔽——一个上游已死的反代
         占着端口对 /healthz 回 502，HTTP 探活认不出它，code-server 一启动就 EADDRINUSE，
         用户视角就是「编辑工作台永远打不开」。所以用 TCP 探测、逐个跳过。 */
      const preferredPort = Number(options.port) || DEFAULT_PORT;
      for (let attempt = 0; attempt < 12 && await portOccupied(hostname, port); attempt++) port += 1;
      if (port !== preferredPort) {
        url = `http://${hostname}:${port}`;
        if (onPortChange) onPortChange(port);
      }
      fs.mkdirSync(extensionsDir, { recursive: true });
      state = 'starting';
      message = '正在启动 VS Code 服务…';
      const args = [...resolved.args,
        '--bind-addr', `${hostname}:${port}`,
        '--auth', 'none',
        '--disable-telemetry',
        /* 不禁用工作区信任的话，打开新文件夹会弹「是否信任此作者」对话框——
           它在 iframe（尤其 Safari）里经常弹不出来或无法交互，用户视角就是
           「点打开文件夹没反应、整个界面卡死」。托管场景里直接关掉。 */
        '--disable-workspace-trust',
        '--disable-update-check',
        ...readLocaleArg(userDataDir),
        '--config', configFile,
        '--user-data-dir', userDataDir,
        '--extensions-dir', extensionsDir,
      ];
      /* 把实际启动参数写进服务日志：界面语言这类「传了但没生效」的问题，
         没有参数记录就只能靠猜（踩过）。放在 spawn 之前，失败时也留得下。 */
      log('[code-server] 启动参数：' + [resolved.command].concat(args).join(' '));
      child = spawn(resolved.command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        /* resolved.env 是自愈换 node 时可能需要的额外环境（例如 Homebrew node@22 的旧库搜索路径）。 */
        env: { ...process.env, ...(resolved.env || {}), VSCODE_LOGS: path.join(userDataDir, 'logs') },
        /* 自成进程组：code-server 会再派生 extension host 等子进程，
           停止时只有整组回收才不会留下孤儿（实测会留下 bootstrap-fork）。 */
        detached: true,
      });
      let tail = '';
      const keep = (chunk) => { tail = (tail + String(chunk)).slice(-600); };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      child.once('error', (error) => { state = 'error'; message = 'VS Code 服务启动失败：' + (error.message || error); });
      child.once('exit', () => {
        child = null;
        if (state === 'running' || state === 'starting') { state = 'stopped'; message = 'VS Code 服务已退出' + (tail ? '：' + tail.trim().split('\n').pop() : ''); }
      });
      for (let attempt = 0; attempt < 150; attempt++) {
        if (await probe(url + '/healthz', 500)) {
          state = 'running';
          message = 'VS Code 已由 CodeScope 托管运行';
          return status();
        }
        if (!child || child.exitCode != null || state === 'error') break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (state !== 'error') {
        state = 'error';
        message = 'VS Code 服务启动超时' + (tail ? '：' + tail.trim().split('\n').slice(-1)[0] : '');
      }
      return status();
    })();
    try { return await startPromise; } finally { startPromise = null; }
  }

  /* 收掉整组进程：只 kill 直接子进程会留下 extension host 孤儿（实测残留约 150MB/个）。 */
  function killTree(target) {
    if (!target || target.exitCode != null) return;
    try { process.kill(-target.pid, 'SIGTERM'); }
    catch (_) { try { target.kill('SIGTERM'); } catch (_) {} }
    setTimeout(() => { try { process.kill(-target.pid, 'SIGKILL'); } catch (_) {} }, 3000).unref();
  }

  async function stop() {
    if (child && child.exitCode == null) killTree(child);
    child = null;
    state = 'stopped';
    message = 'VS Code 服务已停止';
    return status();
  }

  return { status, start, stop, port, proxyPort, hostname };
}

/* 导出面：纯函数单独导出，测试不必起服务、不必碰真实环境就能断言；
   nodeRuntimePlan / nativeModuleCheck 导出是为了能在真机上核对判定结论。 */
module.exports = {
  createCodeServerService,
  resolveCodeServer,
  resetProbe,
  parseNodeVersion,
  parseNodeRange,
  satisfiesNodeRange,
  chooseNodePlan,
  readCodeServerEngines,
  nodeRuntimePlan,
  nativeModuleCheck,
  homebrewLibraryFallback,
};
