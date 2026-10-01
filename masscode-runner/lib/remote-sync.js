'use strict';

/* ── 把 CodeScope 同步 / 部署到用户自己的 VPS ──
   为什么单独做一个模块：CodeScope 之前只有「本机环境检测与更新」（lib/system-env.js），
   没有任何地方负责「把这份代码送到另一台机器上跑起来」。用户要么手敲 rsync/scp，
   要么干脆放弃；敲错一次 `--delete` 就是远端目录被清空。

   本模块负责四件事，全部走同一套「先预演、再执行、事后可自检」的流程：
   ① 配置：host / user / port / identityFile / remoteDir / projectName / transport …（存 <dataRoot>/vps-sync.json）；
   ② 探测：BatchMode 免密 SSH 探一次远端（系统、rsync、tar、目录、可写性、磁盘），带 20 秒缓存；
   ③ 传输：rsync（首选）→ tar（远端只要 tar）→ scp（最慢兜底），并在 report 里说清为什么这么选；
   ④ 动作：vps-preview（只读预演）/ vps-sync / vps-deploy（同步 + 远端 npm install + 白名单重启）/ vps-check。

   ── 安全红线（代码必须保证，不是靠自觉）──
   ① 绝不 `--delete`：只有 deleteExtraneous === true 时才加入该参数，其它任何路径都不加；
   ② 即使开了删除，删除范围也只可能是 `<remoteDir>/<projectName>` 之内：remoteDir 必须通过
      assertRemoteDir 的严格校验（绝对路径、非 /、无 .. 段、无 shell 元字符），
      且 target 必须以 `remoteDir + '/'` 开头、target !== remoteDir，否则直接抛错，不执行；
   ③ 所有本机命令一律用 argv 数组交给 spawnStep，绝不拼 shell 字符串（防注入）。
      唯一例外是 ssh 的「远端命令」：ssh 协议本身要求远端命令是给登录 shell 的一行字符串，
      这是协议限制、无法用 argv 数组表达。因此远端命令只由「固定字面量 + 通过校验并单引号包裹的路径」
      拼成；路径字符集已排除单引号与所有元字符，所以单引号包裹后不可能逃逸。
      本模块永远不会把用户输入的任意文本塞进远端命令（restartCommand 走白名单前缀 + 服务名字符集）。
   ④ 默认排除 `.git` / `node_modules`（除非 includeNodeModules）/ `*.log` / `.DS_Store` /
      `__pycache__` / `.cache`；
   ⑤ `markdown-vault/` 只在 includeVault === true 时同步；report 与预演都会显式写出来。

   依赖与写法对齐 lib/system-env.js：CommonJS、零新依赖、中文注释、不 console.log（一切经 options.log）。
   spawnStep 的签名是 (task, cmd, args, timeoutMs, env)，没有 cwd 参数，所以本模块里所有路径都是绝对路径。 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

/* ── 常量 ── */

const CONFIG_FILE = 'vps-sync.json';
const PROBE_CACHE_MS = 20000;          // report 的探测缓存：别让面板每刷一次就 SSH 一次
const TOOLS_CACHE_MS = 600000;         // 本机工具链（rsync/tar/scp/ssh）很少变，缓存 10 分钟
const CONNECT_TIMEOUT_SEC = 8;         // ssh ConnectTimeout
const PROBE_TIMEOUT_MS = 20000;
const SSH_STEP_TIMEOUT_MS = 120000;
const SYNC_TIMEOUT_MS = 1800000;
const PREVIEW_TIMEOUT_MS = 600000;
const LIST_TIMEOUT_MS = 30000;
const MANIFEST_FILE_CAP = 60000;       // 本地清单上限，防止极端目录把 report 拖死
const VAULT_FILE_CAP = 20000;
const REMOTE_LIST_CAP = 20000;
const PREVIEW_LINE_CAP = 40;           // 预演里「将删除」最多列这么多条，其余只报数量
const PROJECT_NAME_MAX = 120;
const REMOTE_DIR_MAX = 400;

const VAULT_DIR = 'markdown-vault';
const BASE_EXCLUDES = ['.git', 'node_modules', '*.log', '.DS_Store', '__pycache__', '.cache'];
const TRANSPORTS = ['rsync', 'tar', 'scp'];

/* 重启命令白名单：只有这些前缀允许，其余一律拒绝并说明原因（见 assertRestartCommand）。 */
const RESTART_PREFIXES = ['systemctl restart', 'systemctl --user restart', 'pm2 restart', 'docker compose restart'];
const RESTART_ARG_RE = /^[A-Za-z0-9._@:/-]+(?: [A-Za-z0-9._@:/-]+)*$/;

/* 字符集就是安全边界，别随手放宽：
   host：字母数字点横线下划线冒号；user：字母数字点横线下划线；
   remoteDir / projectName：额外允许 `/`（remoteDir）与空格。 */
const HOST_RE = /^[A-Za-z0-9._:-]+$/;
const USER_RE = /^[A-Za-z0-9._-]+$/;
const REMOTE_DIR_RE = /^\/[A-Za-z0-9._\-/ ]*$/;
const PROJECT_NAME_RE = /^[A-Za-z0-9._\- ]+$/;

/* 本机工具链探测结果放模块级：它是「这台机器有什么」，与哪个实例无关。 */
let toolsCache = null;
let toolsCacheAt = 0;

const CONFIG_DEFAULTS = {
  host: '',
  user: '',
  port: 22,
  identityFile: '',
  remoteDir: '',
  projectName: '',
  transport: 'rsync',
  includeVault: true,
  includeNodeModules: false,
  deleteExtraneous: false,
  remoteInstall: true,
  restartCommand: '',
  lastSyncAt: 0,
  lastResult: null,
};

/* ── 基础设施：读 JSON / 原子写 / 只跑命令不碰文件系统 ── */

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function statOrNull(file) {
  try { return fs.statSync(file); } catch (_) { return null; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/* 原子写：半截配置文件会让下次启动直接读不出配置。 */
function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp-' + process.pid + '-' + Date.now().toString(36));
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/* 和 system-env 里的 exec 同款：超时必杀，绝不留下挂着的子进程。 */
function execCapture(command, args, options = {}) {
  const timeout = options.timeout || PROBE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(command, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: Object.assign({}, process.env, options.env || {}) });
    } catch (error) {
      return resolve({ ok: false, code: -1, out: '', err: String((error && error.message) || error) });
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += String(chunk); });
    child.stderr.on('data', (chunk) => { err += String(chunk); });
    child.on('error', (error) => resolve({ ok: false, code: -1, out, err: String((error && error.message) || error) }));
    child.on('close', (code) => resolve({ ok: code === 0, code: code == null ? -1 : code, out, err: err || out }));
  });
}

/* 不走 shell 找可执行文件：自己扫 PATH。这样连 `which` 都不用起进程，也不会有拼接风险。 */
function findExecutable(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) { /* 这个目录里没有就换下一个 */ }
  }
  return '';
}

function humanBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return size.toFixed(size >= 10 ? 0 : 1) + ' ' + units[index];
}

function clockLabel(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (_) { return new Date(ms).toISOString(); }
}

/* 展示用：含空格的参数加单引号，方便用户直接复制。密钥路径原样展示（用户要看清楚）。 */
function displayCommand(argv) {
  return argv.map((arg) => (/[\s'"]/.test(String(arg)) ? "'" + arg + "'" : String(arg))).join(' ');
}

/* ── 校验：getConfig 宽容（读坏了就给默认值），setConfig 严格（非法值一律 400）── */

function assertHost(value) {
  const host = String(value == null ? '' : value).trim();
  if (!host) return '';
  if (host.length > 255) throw invalid('host 太长（上限 255 字符）：' + host);
  if (!HOST_RE.test(host)) throw invalid('host 只允许字母、数字、点、横线、下划线和冒号（IPv6 请写域名或 A 记录）：' + host);
  if (host.startsWith('-')) throw invalid('host 不能以横线开头（会被 ssh 当成选项）：' + host);
  return host;
}

function assertUser(value) {
  const user = String(value == null ? '' : value).trim();
  if (!user) return '';
  if (user.length > 64) throw invalid('user 太长（上限 64 字符）：' + user);
  if (!USER_RE.test(user)) throw invalid('user 只允许字母、数字、点、横线和下划线：' + user);
  if (user.startsWith('-')) throw invalid('user 不能以横线开头：' + user);
  return user;
}

function assertPort(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(raw)) throw invalid('port 必须是 1-65535 的整数，收到：' + (raw || '(空)'));
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid('port 必须在 1-65535 之间，收到：' + raw);
  return port;
}

function assertIdentityFile(value) {
  const file = String(value == null ? '' : value).trim();
  if (!file) return '';
  if (!path.isAbsolute(file)) throw invalid('identityFile 必须是绝对路径（当前：' + file + '）');
  if (/['"\n\r]/.test(file)) throw invalid('identityFile 含引号或换行，无法作为 SSH 参数安全传递：' + file);
  const stat = statOrNull(file);
  if (!stat) throw invalid('identityFile 不存在：' + file);
  if (!stat.isFile()) throw invalid('identityFile 不是文件：' + file);
  return file;
}

function assertRemoteDir(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (!raw.startsWith('/')) throw invalid('remoteDir 必须是绝对路径（以 / 开头），收到：' + raw);
  if (raw.length > REMOTE_DIR_MAX) throw invalid('remoteDir 太长（上限 ' + REMOTE_DIR_MAX + ' 字符）');
  if (!REMOTE_DIR_RE.test(raw)) throw invalid('remoteDir 含危险字符（只允许字母、数字、点、下划线、横线、斜杠和空格）：' + raw);
  const normalized = raw.replace(/\/+$/, '');
  if (!normalized || normalized === '/') throw invalid('remoteDir 不能是根目录 /');
  const parts = normalized.slice(1).split('/');
  for (const part of parts) {
    if (!part) throw invalid('remoteDir 里有空路径段（连续斜杠）：' + raw);
    if (part === '.' || part === '..') throw invalid('remoteDir 不能包含 . 或 .. 路径段（含以 .. 结尾）：' + raw);
  }
  return normalized;
}

function assertProjectName(value, fallback) {
  const name = String(value == null ? '' : value).trim();
  if (!name) return fallback || '';
  if (name.length > PROJECT_NAME_MAX) throw invalid('projectName 太长（上限 ' + PROJECT_NAME_MAX + ' 字符）');
  if (!PROJECT_NAME_RE.test(name)) throw invalid('projectName 只允许字母、数字、点、横线、下划线和空格：' + name);
  if (name === '.' || name === '..' || name.startsWith('.')) throw invalid('projectName 不能以点开头：' + name);
  return name;
}

function assertTransport(value) {
  const transport = String(value == null ? '' : value).trim();
  if (!TRANSPORTS.includes(transport)) throw invalid('transport 只允许 rsync / tar / scp，收到：' + (transport || '(空)'));
  return transport;
}

function assertBool(value, label) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw invalid(label + ' 必须是 true 或 false，收到：' + String(value));
}

/* 重启命令只放这四类前缀：其余一律拒绝，并在错误里说清为什么。 */
function assertRestartCommand(value) {
  const command = String(value == null ? '' : value).trim();
  if (!command) return '';
  if (/[\n\r]/.test(command)) throw invalid('restartCommand 不能含换行');
  const prefix = RESTART_PREFIXES.find((item) => command.startsWith(item + ' '));
  if (!prefix) {
    throw invalid('restartCommand 只允许这些前缀：' + RESTART_PREFIXES.map((item) => item + ' <名称>').join('、')
      + '；收到：' + command + '（其它命令请自己在 VPS 上执行，本模块不代跑任意命令）');
  }
  const argument = command.slice(prefix.length).trim();
  if (!argument) throw invalid('restartCommand 缺少服务名 / 单元名：' + command);
  if (!RESTART_ARG_RE.test(argument)) throw invalid('restartCommand 的服务名 / 单元名含危险字符：' + command);
  if (/[;&|$`<>(){}*?!#'"\\]/.test(argument)) throw invalid('restartCommand 只能有服务名，不能带 shell 元字符：' + command);
  return prefix + ' ' + argument;
}

/* ── 远端命令的安全拼装（红线③的唯一例外，见文件头说明）── */

/* 单引号包裹：字符集里没有单引号，所以闭合不了。 */
function quoteRemote(value) {
  return "'" + String(value) + "'";
}

/* ── 本地清单：排除项在这里生效（rsync 那边由 --exclude 生效）── */

function excludePatterns(config) {
  const list = [];
  for (const pattern of BASE_EXCLUDES) {
    if (pattern === 'node_modules' && config.includeNodeModules) continue;
    list.push(pattern);
  }
  return list;
}

function matchesExclude(name, patterns) {
  for (const pattern of patterns) {
    if (pattern.startsWith('*')) {
      if (name.endsWith(pattern.slice(1))) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
}

/* 走一遍本地目录，统计「会传什么」：文件数、体积、前若干条样本（预演用）。
   只读、不跟随符号链接（软链只计数不递归，避免顺着链走出项目）。 */
function localManifest(root, options = {}) {
  const patterns = options.excludes || [];
  const skipVault = !!options.skipVault;
  const cap = options.cap || MANIFEST_FILE_CAP;
  const sample = [];
  const paths = new Set();
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const walk = (dir) => {
    if (truncated) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (truncated) return;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.name === VAULT_DIR && skipVault) continue;
      if (matchesExclude(entry.name, patterns)) continue;
      if (entry.isSymbolicLink()) { files += 1; paths.add(rel); if (sample.length < 400) sample.push({ path: rel, bytes: 0, symlink: true }); if (files >= cap) { truncated = true; return; } continue; }
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch (_) { size = 0; }
      files += 1;
      bytes += size;
      paths.add(rel);
      if (sample.length < 400) sample.push({ path: rel, bytes: size });
      if (files >= cap) { truncated = true; return; }
    }
  };
  walk(root);
  return { root, files, bytes, truncated, sample, paths, excludes: patterns.slice(), skipVault };
}

/* ── 仓库内的 vault 与「同级 vault」两种布局都要认 ──
   本仓库实测：masscode-runner/markdown-vault 不存在，真正的 vault 是它的同级目录
   （server.js 的 defaultVaultPath 也是先找 path.join(__dirname, '..', 'markdown-vault')）。
   所以 vault 可能：(a) 在项目内（则随项目一起传），(b) 在项目同级（则单独作为第二个源传进 <target>/markdown-vault）。 */
function vaultInfo(projectRoot) {
  const inside = path.join(projectRoot, VAULT_DIR);
  const sibling = path.join(path.dirname(projectRoot), VAULT_DIR);
  const insideStat = statOrNull(inside);
  const siblingStat = statOrNull(sibling);
  const localPath = insideStat && insideStat.isDirectory() ? inside : (siblingStat && siblingStat.isDirectory() ? sibling : '');
  const layout = insideStat && insideStat.isDirectory() ? 'inside' : (siblingStat && siblingStat.isDirectory() ? 'sibling' : 'none');
  let files = 0;
  let bytes = 0;
  let truncated = false;
  if (localPath) {
    const manifest = localManifest(localPath, { cap: VAULT_FILE_CAP });
    files = manifest.files;
    bytes = manifest.bytes;
    truncated = manifest.truncated;
  }
  return { layout, localPath, exists: !!localPath, files, bytes, truncated, insidePath: inside, siblingPath: sibling };
}

function defaultProjectName(projectRoot) {
  const base = path.basename(projectRoot) || 'codescope';
  const safe = base.replace(/[^A-Za-z0-9._\- ]/g, '-').replace(/^\.+/, '') || 'codescope';
  return safe.slice(0, PROJECT_NAME_MAX);
}

function targetPath(config) {
  const remoteDir = assertRemoteDir(config.remoteDir);
  const projectName = assertProjectName(config.projectName, defaultProjectName(config.projectRoot));
  return { remoteDir, projectName, path: remoteDir && projectName ? remoteDir + '/' + projectName : '' };
}

/* 删除红线②的守门人：只有在 target 严格位于 remoteDir 之内时才允许 --delete。 */
function assertDeleteScope(config) {
  const target = targetPath(config);
  if (!target.remoteDir) throw invalid('删除前必须先配置 remoteDir（绝对路径）');
  if (!target.projectName || !target.path) throw invalid('删除前必须先确定 projectName');
  if (target.path === target.remoteDir || !target.path.startsWith(target.remoteDir + '/')) {
    throw invalid('拒绝删除：目标 ' + target.path + ' 不在 ' + target.remoteDir + ' 之内');
  }
  return target;
}

/* ── 本机工具链（缓存）──
   macOS 自带的 rsync 是 openrsync（`rsync --version` 会打印 openrsync / protocol version 29），
   它只实现了一部分 GNU 选项：--info=progress2、--human-readable 之类的别用，
   本模块只用双方都有的通用选项（-a -z -n --itemize-changes --exclude= --delete -e）。 */
async function detectLocalTools(force) {
  if (!force && toolsCache && Date.now() - toolsCacheAt < TOOLS_CACHE_MS) return toolsCache;
  const rsync = findExecutable('rsync');
  const tar = findExecutable('tar');
  const scp = findExecutable('scp');
  const ssh = findExecutable('ssh');
  let rsyncKind = '';
  let tarKind = '';
  if (rsync) {
    const version = await execCapture(rsync, ['--version'], { timeout: 8000 });
    const text = String(version.out || version.err || '');
    rsyncKind = /openrsync/i.test(text) ? 'openrsync' : (/version\s+\d/i.test(text) ? 'gnu' : 'unknown');
  }
  if (tar) {
    const version = await execCapture(tar, ['--version'], { timeout: 8000 });
    const text = String(version.out || version.err || '');
    tarKind = /bsdtar/i.test(text) ? 'bsdtar' : (/GNU tar/i.test(text) ? 'gnu' : 'unknown');
  }
  toolsCache = { rsync, tar, scp, ssh, rsyncKind, tarKind, at: Date.now() };
  toolsCacheAt = Date.now();
  return toolsCache;
}

/* ── 远端探测：BatchMode=yes 是硬要求 ──
   没有它，ssh 会在没有免密登录时弹出密码提示，任务会永远挂在那里（面板也取消不掉）。
   加上它，最坏情况是 8 秒后带着「Permission denied」返回，用户至少知道该配公钥。 */
function sshArgv(config, options = {}) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=' + CONNECT_TIMEOUT_SEC,
    '-o', 'StrictHostKeyChecking=accept-new',
  ];
  if (config.identityFile) args.push('-i', config.identityFile);
  if (options.port !== false) args.push('-p', String(config.port));
  args.push(config.user + '@' + config.host);
  return args;
}

function sshFlagsText(config) {
  return sshFlagsParts(config).join(' ');
}

/* 参数数组（不 split 字符串，避免 identityFile 里带空格时被拆开）。 */
function sshFlagsParts(config) {
  const flags = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=' + CONNECT_TIMEOUT_SEC, '-o', 'StrictHostKeyChecking=accept-new'];
  if (config.identityFile) flags.push('-i', config.identityFile);
  flags.push('-p', String(config.port));
  return flags;
}

function sshCommandText(config, remoteCommand) {
  return displayCommand(['ssh'].concat(sshFlagsParts(config), [config.user + '@' + config.host, remoteCommand]));
}

/* rsync 的 -e：rsync 自己的命令行解析器按空白切分，不支持引号。
   所以 identityFile 里只要有空白，rsync 传输就会被判为不可用（退回 tar/scp），见 describeTransports。 */
function rsyncShell(config) {
  const parts = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=' + CONNECT_TIMEOUT_SEC, '-o', 'StrictHostKeyChecking=accept-new'];
  if (config.identityFile) parts.push('-i', config.identityFile);
  parts.push('-p', String(config.port));
  return parts.join(' ');
}

function remoteProbeScript(config, target) {
  const dir = quoteRemote(config.remoteDir);
  const place = quoteRemote(target || config.remoteDir);
  return [
    'echo OK',
    'uname -s 2>/dev/null || true',
    "printf 'CS_RSYNC '; command -v rsync 2>/dev/null || echo -",
    "printf 'CS_TAR '; command -v tar 2>/dev/null || echo -",
    "printf 'CS_NPM '; command -v npm 2>/dev/null || echo -",
    "printf 'CS_DIR '; if [ -d " + dir + " ]; then echo yes; else echo no; fi",
    "printf 'CS_WRITE '; if [ -w " + place + " ] 2>/dev/null; then echo target; elif [ -w " + dir + " ] 2>/dev/null; then echo dir; elif [ -w " + dir + "/.. ] 2>/dev/null; then echo parent; else echo no; fi",
    "printf 'CS_DF '; ( df -Pk " + dir + " 2>/dev/null || df -Pk " + dir + "/.. 2>/dev/null || df -Pk / 2>/dev/null ) | tail -n 1",
    'exit 0',
  ].join('; ');
}

function parseProbe(out, code, err) {
  const lines = String(out || '').split(/\r?\n/);
  /* OK 后面紧跟的那一行就是 uname -s；不要写死 lines[1]，
     因为 ssh 有可能先吐一行 banner/motd。 */
  const okIndex = lines.findIndex((line) => line.trim() === 'OK');
  const systemLine = okIndex >= 0 ? lines.slice(okIndex + 1).find((line) => line.trim()) : '';
  const pick = (prefix) => {
    for (const line of lines) {
      if (line.startsWith(prefix)) {
        const value = line.slice(prefix.length).trim();
        return value === '-' ? '' : value;
      }
    }
    return '';
  };
  const dfParts = pick('CS_DF ').split(/\s+/).filter(Boolean);
  const writable = pick('CS_WRITE ');
  return {
    system: String(systemLine || '').trim(),
    hasRsync: !!pick('CS_RSYNC '),
    rsyncPath: pick('CS_RSYNC '),
    hasTar: !!pick('CS_TAR '),
    tarPath: pick('CS_TAR '),
    hasNpm: !!pick('CS_NPM '),
    npmPath: pick('CS_NPM '),
    remoteDirExists: pick('CS_DIR ') === 'yes',
    writable: writable === 'target' || writable === 'dir' || writable === 'parent',
    writablePath: writable,
    disk: dfParts.length >= 4
      ? { filesystem: dfParts[0], totalKb: Number(dfParts[1]) || 0, usedKb: Number(dfParts[2]) || 0, freeKb: Number(dfParts[3]) || 0, capacity: dfParts[4] || '' }
      : null,
    exitCode: code,
    stderr: String(err || '').slice(0, 400),
  };
}

/* 把 ssh 的原始报错翻译成人能看懂的一句话：用户需要知道「去配公钥」而不是「再试一次」。 */
function explainSshError(text) {
  const raw = String(text || '').trim();
  if (/Permission denied \(publickey/i.test(raw)) return 'SSH 免密登录没配好（BatchMode 下无法输入密码）：请把本机公钥加到远端 ~/.ssh/authorized_keys，或用 identityFile 指定私钥';
  if (/Host key verification failed/i.test(raw)) return '远端主机指纹不匹配：请先手动 ssh 一次确认，或检查是否换了机器';
  if (/Connection timed out|Operation timed out|connect to host .* timed out|No route to host/i.test(raw)) return '连接超时：检查 host / port、防火墙与安全组';
  if (/Could not resolve hostname|nodename nor servname/i.test(raw)) return '域名解析失败：host 拼写或本机 DNS 有问题';
  if (/Connection refused/i.test(raw)) return '连接被拒绝：端口上没有 sshd，或端口写错了';
  if (/no such identity|No such file or directory/i.test(raw)) return '私钥文件读不到：检查 identityFile 路径与权限（chmod 600）';
  return raw ? raw.split('\n').filter(Boolean).pop().slice(0, 300) : '未知原因（ssh 没有输出）';
}

/* ── 动作定义（顺序固定，面板按这个顺序渲染）── */

function buildActionSpecs(config) {
  const configured = !!(config.host && config.user && config.remoteDir);
  const target = configured ? targetPath(config) : { remoteDir: '', projectName: defaultProjectName(config.projectRoot), path: '' };
  const place = target.path || '<remoteDir>/<projectName>';
  const sshTarget = config.user && config.host ? config.user + '@' + config.host : '<user>@<host>';
  const excludes = excludePatterns(config).map((item) => '--exclude=' + item).join(' ');
  const deleteFlag = config.deleteExtraneous ? ' --delete' : '';
  const keyFlag = config.identityFile ? '-i ' + config.identityFile + ' ' : '';
  const rsh = 'ssh ' + keyFlag + '-p ' + config.port;
  return [
    {
      id: 'vps-preview',
      label: '预演同步（不写远端）',
      command: 'rsync -n --itemize-changes -a -z ' + excludes + deleteFlag + ' -e "' + rsh + '" ' + config.projectRoot + '/ ' + sshTarget + ':' + place + '/',
      why: '先看清会传多少文件 / 会删哪些远端文件，再决定要不要真同步；这一步绝不写远端任何东西。',
      needed: true,
      heavy: false,
      target: place,
    },
    {
      id: 'vps-sync',
      label: '同步到 VPS',
      command: configured && config.transport === 'tar'
        ? 'tar -czf <临时包> ' + excludes + ' -C ' + config.projectRoot + ' . && scp -P ' + config.port + ' <临时包> ' + sshTarget + ':' + target.remoteDir + '/ && ssh ' + keyFlag + '-p ' + config.port + ' ' + sshTarget + ' \'mkdir -p ' + place + ' && tar -xzf <远端包> -C ' + place + '\''
        : 'rsync -a -z --itemize-changes ' + excludes + deleteFlag + ' -e "' + rsh + '" ' + config.projectRoot + '/ ' + sshTarget + ':' + place + '/',
      why: '把当前仓库内容送到远端目标目录；默认不动 .git / node_modules，markdown-vault 按配置决定。',
      needed: configured,
      heavy: true,
      target: place,
    },
    {
      id: 'vps-deploy',
      label: '部署到 VPS（同步 + 装依赖 + 重启）',
      command: (config.transport === 'tar' ? 'tar -czf - … | ' : '')
        + 'ssh ' + keyFlag + '-p ' + config.port + ' ' + sshTarget + ' \'cd ' + place + ' && '
        + (config.remoteInstall ? 'npm install --omit=dev' : '跳过 npm install')
        + (config.restartCommand ? ' && ' + config.restartCommand : '（未配置 restartCommand，不会重启服务）') + '\'',
      why: '同步之后在远端装生产依赖并重启服务；重启命令只允许 systemctl / pm2 / docker compose 重启这几种前缀。',
      needed: configured,
      heavy: true,
      target: place,
    },
    {
      id: 'vps-check',
      label: '自检（只探测，不写远端）',
      command: sshCommandText(config, "echo OK; uname -s; command -v rsync; df -Pk " + (target.remoteDir || '<remoteDir>')),
      why: '确认免密 SSH 通不通、远端有没有 rsync、目标目录可不可写、磁盘还剩多少，以及最近一次同步结果。',
      needed: configured,
      heavy: false,
      target: target.remoteDir || '',
    },
  ];
}

/* ── 工厂 ── */

function createRemoteSync(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const projectRoot = options.projectRoot || path.join(__dirname, '..');
  const dataRoot = options.dataRoot || path.join(os.homedir(), '.codescope');
  const configPath = path.join(dataRoot, CONFIG_FILE);

  let probeCache = null;
  let probeCacheAt = 0;
  let probeCacheKey = '';

  /* ── 配置读写 ── */

  function getConfig() {
    const stored = readJson(configPath);
    const source = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const config = Object.assign({}, CONFIG_DEFAULTS, source);
    config.port = Number.isInteger(Number(config.port)) && Number(config.port) >= 1 && Number(config.port) <= 65535 ? Number(config.port) : 22;
    for (const key of ['includeVault', 'includeNodeModules', 'deleteExtraneous', 'remoteInstall']) {
      config[key] = config[key] === true || config[key] === 'true';
    }
    if (!TRANSPORTS.includes(config.transport)) config.transport = 'rsync';
    config.host = String(config.host || '');
    config.user = String(config.user || '');
    config.identityFile = String(config.identityFile || '');
    config.remoteDir = String(config.remoteDir || '');
    config.projectName = String(config.projectName || '') || defaultProjectName(projectRoot);
    config.restartCommand = String(config.restartCommand || '');
    config.lastSyncAt = Number(config.lastSyncAt) || 0;
    config.lastResult = config.lastResult && typeof config.lastResult === 'object' ? config.lastResult : null;
    config.projectRoot = projectRoot;
    return config;
  }

  function persist(config) {
    const out = {};
    for (const key of Object.keys(CONFIG_DEFAULTS)) out[key] = config[key];
    writeJsonAtomic(configPath, out);
    probeCache = null;
    probeCacheAt = 0;
    probeCacheKey = '';
    return out;
  }

  /* setConfig：严格校验。任何一项非法都抛 statusCode 400 的中文错误，且不落盘（保持原配置不变）。 */
  function setConfig(patch) {
    const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    for (const key of Object.keys(input)) {
      if (!Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, key)) throw invalid('未知的配置字段：' + key);
    }
    const next = getConfig();
    if ('host' in input) next.host = assertHost(input.host);
    if ('user' in input) next.user = assertUser(input.user);
    if ('port' in input) next.port = assertPort(input.port);
    if ('identityFile' in input) next.identityFile = assertIdentityFile(input.identityFile);
    if ('remoteDir' in input) next.remoteDir = assertRemoteDir(input.remoteDir);
    if ('projectName' in input) next.projectName = assertProjectName(input.projectName, defaultProjectName(projectRoot));
    if ('transport' in input) next.transport = assertTransport(input.transport);
    if ('includeVault' in input) next.includeVault = assertBool(input.includeVault, 'includeVault');
    if ('includeNodeModules' in input) next.includeNodeModules = assertBool(input.includeNodeModules, 'includeNodeModules');
    if ('deleteExtraneous' in input) next.deleteExtraneous = assertBool(input.deleteExtraneous, 'deleteExtraneous');
    if ('remoteInstall' in input) next.remoteInstall = assertBool(input.remoteInstall, 'remoteInstall');
    if ('restartCommand' in input) next.restartCommand = assertRestartCommand(input.restartCommand);
    /* lastSyncAt / lastResult 只给内部用，外部传进来也照样校验，免得写坏状态。 */
    if ('lastSyncAt' in input) next.lastSyncAt = Number(input.lastSyncAt) || 0;
    if ('lastResult' in input) next.lastResult = input.lastResult && typeof input.lastResult === 'object' ? input.lastResult : null;
    /* 加减速：配了删除就必须配好 remoteDir（红线②的静态部分）。 */
    if (next.deleteExtraneous && !next.remoteDir) throw invalid('开启 deleteExtraneous 前必须先填 remoteDir（删除范围只能是它的子目录）');
    persist(next);
    log('vps-sync：配置已更新（' + (next.host ? next.user + '@' + next.host : '未配置主机') + '）');
    return getConfig();
  }

  /* ── 探测（20 秒缓存）── */

  function configKey(config) {
    return [config.host, config.user, config.port, config.identityFile, config.remoteDir, config.projectName].join('|');
  }

  async function probeRemote(config, force) {
    const key = configKey(config);
    if (!force && probeCache && Date.now() - probeCacheAt < PROBE_CACHE_MS && probeCacheKey === key) return probeCache;
    if (!config.host || !config.user || !config.remoteDir) {
      const skipped = { ok: false, reachable: false, skipped: true, error: '配置不完整：需要 host、user、remoteDir', at: Date.now(), ms: 0 };
      probeCache = skipped;
      probeCacheAt = Date.now();
      probeCacheKey = key;
      return skipped;
    }
    let target = config.remoteDir;
    try { target = targetPath(config).path; } catch (_) { /* 目标拼不出来就只探 remoteDir */ }
    const argv = ['ssh'].concat(sshArgv(config).slice(0), [remoteProbeScript(config, target)]);
    const command = argv.shift();
    const started = Date.now();
    const result = await execCapture(command, argv, { timeout: PROBE_TIMEOUT_MS });
    const parsed = parseProbe(result.out, result.code, result.err);
    const reachable = result.ok && /(^|\n)OK\s*(\n|$)/.test(String(result.out || ''));
    const probe = Object.assign(parsed, {
      ok: reachable,
      reachable,
      skipped: false,
      error: reachable ? '' : explainSshError(result.err || result.out),
      ms: Date.now() - started,
      at: Date.now(),
    });
    probeCache = probe;
    probeCacheAt = Date.now();
    probeCacheKey = key;
    return probe;
  }

  /* ── 传输策略：本机有什么 / 远端有什么 / 最终选谁 / 为什么 ── */

  function describeTransports(config, tools, probe) {
    const notes = [];
    const keyUnsafeForRsync = /\s/.test(config.identityFile || '');
    const local = {
      ssh: { available: !!tools.ssh, path: tools.ssh },
      rsync: { available: !!tools.rsync, path: tools.rsync, kind: tools.rsyncKind || 'unknown' },
      tar: { available: !!tools.tar, path: tools.tar, kind: tools.tarKind || 'unknown' },
      scp: { available: !!tools.scp, path: tools.scp },
    };
    const remote = probe && probe.reachable
      ? { known: true, system: probe.system, rsync: { available: probe.hasRsync, path: probe.rsyncPath }, tar: { available: probe.hasTar, path: probe.tarPath }, npm: { available: probe.hasNpm, path: probe.npmPath } }
      : { known: false, system: '', rsync: { available: false, path: '' }, tar: { available: false, path: '' }, npm: { available: false, path: '' } };
    if (local.rsync.available && local.rsync.kind === 'openrsync') {
      notes.push('本机 rsync 是 macOS 自带的 openrsync，不支持 GNU 专有选项（如 --info=progress2），本模块只用通用选项');
    }
    if (keyUnsafeForRsync) {
      notes.push('identityFile 含空白字符，rsync 的 -e 参数无法安全传递，已把 rsync 判为不可用（走 tar/scp）');
    }
    /* 判定「可用」的前提是远端探测成功：连都连不上时绝不能宣称 scp 可用，
       否则真同步会在一个未知的远端上瞎写。 */
    const usable = [];
    if (remote.known) {
      if (local.rsync.available && remote.rsync.available && !keyUnsafeForRsync) usable.push('rsync');
      if (local.tar.available && local.scp.available && local.ssh.available && remote.tar.available) usable.push('tar');
      if (local.ssh.available && local.scp.available) usable.push('scp');
    }
    const wanted = TRANSPORTS.includes(config.transport) ? config.transport : 'rsync';
    const chosen = usable.includes(wanted) ? wanted : (usable[0] || '');
    let reason;
    if (!probe || !probe.reachable) {
      reason = '远端还没探测成功（' + ((probe && probe.error) || '未探测') + '），暂时无法确定可用传输方式';
    } else if (chosen === wanted) {
      reason = '按配置选用 ' + wanted + '；' + (wanted === 'rsync'
        ? '本机与远端都有 rsync，增量传输最快，也是唯一能安全删多余文件的传输方式'
        : wanted === 'tar' ? '远端可用 tar（不必装 rsync），本机由 tar 打包 + scp 送达 + 远端 tar 解包' : 'rsync/tar 不可用，退回 scp -r 复制（最慢，且不做删除）');
    } else if (chosen) {
      reason = '配置要求 ' + wanted + '，但它当前不可用（' + (wanted === 'rsync' ? '本机或远端缺 rsync' : wanted === 'tar' ? '本机缺 tar/scp 或远端缺 tar' : '本机缺 scp')
        + '），自动退回 ' + chosen;
      notes.push('配置的 ' + wanted + ' 不可用，本次实际用 ' + chosen + '：' + reason);
    } else {
      reason = '没有任何可用传输方式：本机缺 ' + (local.ssh.available ? '' : 'ssh ') + (local.scp.available ? '' : 'scp ')
        + (local.rsync.available ? '' : 'rsync ') + (local.tar.available ? '' : 'tar ') + '或远端缺 rsync/tar';
    }
    return { local, remote, usable, wanted, chosen, reason, notes };
  }

  /* ── 计划：report 与预演共用 ── */

  function buildPlan(config, tools, probe, selection) {
    /* 手工编辑过配置文件的话，remoteDir 可能是非法值：这里不让 report 直接炸，
       而是把它变成一条 problem（真执行时才抛 400）。 */
    let target = { remoteDir: '', projectName: defaultProjectName(projectRoot), path: '' };
    let targetError = '';
    if (config.remoteDir) {
      try { target = targetPath(config); } catch (error) { targetError = String((error && error.message) || error); }
    }
    const excludes = excludePatterns(config);
    const vault = vaultInfo(projectRoot);
    /* includeVault=false 时，若 vault 在项目内，就从项目清单里排除掉。 */
    const manifest = localManifest(projectRoot, { excludes, skipVault: !config.includeVault });
    const vaultSkipped = !config.includeVault;
    const vaultOutside = vault.layout === 'sibling';
    const deleteEnabled = config.deleteExtraneous === true;
    let deleteTarget = null;
    let deleteError = '';
    if (deleteEnabled) {
      try { deleteTarget = assertDeleteScope(config); } catch (error) { deleteError = String(error.message || error); }
    }
    return { target, targetError, excludes, vault, manifest, vaultSkipped, vaultOutside, deleteEnabled, deleteTarget, deleteError, selection };
  }

  function planLines(config, plan) {
    const lines = [];
    const target = plan.target;
    const where = target.path || '<远程目录>/' + (target.projectName || defaultProjectName(projectRoot));
    if (config.host && config.user) {
      lines.push('远端：' + config.user + '@' + config.host + ':' + config.port + '（目录 ' + (target.remoteDir || '<未配置 remoteDir>') + '）');
    } else {
      lines.push('远端：还没配置（缺 host / user / remoteDir）');
    }
    lines.push('目标目录：' + where);
    if (plan.targetError) lines.push('目标目录不合法：' + plan.targetError + '（先把它改对再执行）');
    lines.push('传输方式：' + (plan.selection.chosen || '未确定') + '（' + plan.selection.reason + '）');
    lines.push('项目内容：' + plan.manifest.files + ' 个文件，约 ' + humanBytes(plan.manifest.bytes)
      + (plan.manifest.truncated ? '（已达统计上限 ' + MANIFEST_FILE_CAP + ' 个文件，实际更多）' : ''));
    if (plan.vault.exists) {
      lines.push('markdown-vault：' + (plan.vaultSkipped ? '不包含（includeVault=false）'
        : '包含，' + (plan.vault.layout === 'sibling' ? '项目同级目录 ' : '项目内目录 ') + plan.vault.localPath + '，'
          + plan.vault.files + ' 个文件 / 约 ' + humanBytes(plan.vault.bytes) + (plan.vault.truncated ? '（统计已达上限）' : '')));
    } else {
      lines.push('markdown-vault：' + (plan.vaultSkipped ? '不包含（includeVault=false）' : '本机没找到（' + plan.vault.insidePath + ' 与 ' + plan.vault.siblingPath + ' 都不存在），本次不传'));
    }
    lines.push('排除项：' + plan.excludes.join('、') + (config.includeNodeModules ? '（已开启 includeNodeModules：node_modules 不排除）' : ''));
    if (config.includeVault) lines.push('vault 开关：includeVault=true —— ' + (plan.vault.exists ? 'vault 会一起同步到 ' + (where + '/' + VAULT_DIR) : '但本机没有 vault 可传'));
    else lines.push('vault 开关：includeVault=false —— vault 一律不动（' + (plan.vault.exists ? '即使本机有 ' + plan.vault.localPath : '本机也没有') + '）');
    if (plan.deleteEnabled) {
      lines.push(plan.deleteError
        ? '删除：已开启 deleteExtraneous，但目标校验不通过，不会执行：' + plan.deleteError
        : '删除：已开启 deleteExtraneous，删除范围只可能在 ' + plan.deleteTarget.path + ' 之内（绝不动同级其它目录）');
      if (plan.selection.chosen && plan.selection.chosen !== 'rsync') {
        lines.push('删除：当前传输方式是 ' + plan.selection.chosen + '，它不做删除 —— 只有 rsync 才能安全删多余文件（tar/scp 一律不删）');
      }
    } else {
      lines.push('删除：关闭（不会传 --delete，远端多余文件一律保留）');
    }
    lines.push('远端安装依赖：' + (config.remoteInstall ? 'npm install --omit=dev' : '关闭（远端不会跑 npm install）'));
    lines.push('重启命令：' + (config.restartCommand || '未设置（同步后不会重启任何服务）'));
    return lines;
  }

  /* 真实执行时用的 argv 构造（全部是数组，红线③） */

  function rsyncArgv(config, plan, options) {
    const tools = options.tools;
    const args = ['-a', '-z', '--itemize-changes'];
    if (options.dryRun) args.push('-n');
    if (options.del) args.push('--delete');
    for (const pattern of plan.excludes) args.push('--exclude=' + pattern);
    args.push('-e', rsyncShell(config));
    args.push(options.source.replace(/\/?$/, '/'));
    args.push(config.user + '@' + config.host + ':' + quoteRemote(options.destination));
    return [tools.rsync, ...args];
  }

  /* scp 送文件：远端路径同样要单引号包裹，因为 scp 会把远端路径交给远端 shell 展开。 */
  function scpSendArgv(config, scpPath, localPath, remotePath, recursive) {
    const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=' + CONNECT_TIMEOUT_SEC, '-o', 'StrictHostKeyChecking=accept-new'];
    if (config.identityFile) args.push('-i', config.identityFile);
    args.push('-P', String(config.port));
    if (recursive) args.push('-r');
    args.push(localPath);
    args.push(config.user + '@' + config.host + ':' + quoteRemote(remotePath));
    return [scpPath || 'scp', ...args];
  }

  function sshStepArgv(config, remoteCommand) {
    return ['ssh', ...sshArgv(config), remoteCommand];
  }

  /* ── report ── */

  async function report(force) {
    const config = getConfig();
    const tools = await detectLocalTools(force);
    const problems = [];
    const notes = [];
    const configured = !!(config.host && config.user && config.remoteDir);
    let probe;
    if (configured) {
      probe = await probeRemote(config, force);
    } else {
      probe = { ok: false, reachable: false, skipped: true, error: '还没配置 host / user / remoteDir', at: Date.now(), ms: 0 };
      problems.push('还没配置 VPS：至少填 host、user、remoteDir（配置文件 ' + configPath + '）');
    }
    if (configured && !probe.reachable) problems.push('连不上远端 ' + config.user + '@' + config.host + ':' + config.port + ' —— ' + probe.error);
    if (configured && probe.reachable && !probe.writable) problems.push('远端目录不可写：' + (config.remoteDir || '(未配置)') + ' 及其父目录都写不了（换个用户或用 sudo 前缀）');
    if (configured && probe.reachable && !probe.remoteDirExists) notes.push('远端 ' + config.remoteDir + ' 还不存在，同步时会先 mkdir -p 建出来');

    const selection = describeTransports(config, tools, probe);
    for (const note of selection.notes) notes.push(note);
    if (!tools.ssh) problems.push('本机找不到 ssh：macOS/Linux 自带 ssh，Windows 请先装 OpenSSH 客户端');
    if (configured && probe.reachable && !selection.usable.length) problems.push('没有可用传输方式：' + selection.reason);
    if (!tools.rsync && !tools.tar) problems.push('本机既没有 rsync 也没有 tar，无法打包或增量同步');
    if (config.identityFile && !statOrNull(config.identityFile)) problems.push('identityFile 现在读不到了：' + config.identityFile);

    const plan = buildPlan(config, tools, probe, selection);
    if (plan.targetError) problems.push('配置里的远端目标不合法：' + plan.targetError);
    if (plan.deleteEnabled && plan.deleteError) problems.push('deleteExtraneous 已开启但目标校验不通过：' + plan.deleteError);
    if (plan.deleteEnabled && selection.chosen && selection.chosen !== 'rsync') {
      notes.push('deleteExtraneous 已开启，但当前传输方式 ' + selection.chosen + ' 不做删除；要真删请让 rsync 可用');
    }
    if (plan.vault.exists && !plan.vaultSkipped && plan.vault.bytes > 200 * 1024 * 1024) {
      notes.push('markdown-vault 约 ' + humanBytes(plan.vault.bytes) + '，首次全量同步会比较久，可用 includeVault=false 先跳过');
    }
    if (config.remoteInstall && probe.reachable && !probe.hasNpm) notes.push('远端没有 npm（command -v npm 为空），部署动作的远端安装会失败；请确认远端 PATH 或关掉 remoteInstall');
    if (config.identityFile) notes.push('私钥路径（原样展示，便于你核对）：' + config.identityFile);
    if (config.projectName && config.projectName !== defaultProjectName(projectRoot)) {
      notes.push('projectName 与目录名不同：远端会放在 ' + config.projectName + '，本地目录叫 ' + path.basename(projectRoot));
    }
    if ((config.host || '').includes(':')) notes.push('host 里含冒号：rsync/scp 的远端路径语法会歧义，建议改用域名或 A 记录');

    /* 注意：result.ok 只代表「同步那一步」成功。部署若卡在后半程（远端装依赖 / 重启），
       这里必须跟着说失败 —— 否则界面会显示「上次同步成功」，而用户其实根本没部署上。 */
    const lastResult = config.lastResult || null;
    /* 判定「部署没成」不能只看 stage：部署失败时落库的往往是「同步阶段」的结果
       （ok:true、没有 stage），只按 stage 判定会把失败记成成功。
       真正的判据是：动作是部署，而且 deployed 不是 true。 */
    const lastDeployFailed = !!(lastResult && lastResult.ok && lastResult.action === 'vps-deploy' && lastResult.deployed !== true);
    const lastSync = {
      at: config.lastSyncAt || 0,
      label: config.lastSyncAt ? clockLabel(config.lastSyncAt) : '从未同步过',
      action: (lastResult && lastResult.action) || '',
      ok: !!(lastResult && lastResult.ok) && !lastDeployFailed,
      deployed: !!(lastResult && lastResult.deployed),
      stage: (lastResult && lastResult.stage) || '',
      exit: (lastResult && lastResult.exit) || 0,
      transport: (config.lastResult && config.lastResult.transport) || '',
      files: (config.lastResult && config.lastResult.files) || 0,
      bytes: (config.lastResult && config.lastResult.bytes) || 0,
      deletes: (config.lastResult && config.lastResult.deletes) || 0,
      message: (config.lastResult && config.lastResult.message) || '',
      result: config.lastResult,
    };

    const actions = buildActionSpecs(config).map((spec) => Object.assign({}, spec, {
      status: spec.id === 'vps-preview' ? '只读预演，随时可跑'
        : !configured ? '还没配置 VPS'
          : !probe.reachable ? '连不上远端'
            : spec.id === 'vps-check' ? '可执行'
              : spec.id === 'vps-sync' ? '可执行（' + selection.chosen + '）'
                : config.remoteInstall ? '同步 + 远端 npm install' + (config.restartCommand ? ' + ' + config.restartCommand : '') : '同步 + 重启',
    }));

    return {
      ok: problems.length === 0,
      problems,
      notes,
      target: {
        host: config.host,
        user: config.user,
        port: config.port,
        identityFile: config.identityFile,
        remoteDir: config.remoteDir,
        projectName: resolvedProjectName(config),
        path: plan.target.path,
        sshTarget: config.host && config.user ? config.user + '@' + config.host : '',
        configured,
      },
      transports: {
        local: selection.local,
        remote: selection.remote,
        usable: selection.usable,
        wanted: selection.wanted,
        chosen: selection.chosen,
        reason: selection.reason,
        probe: probe,
      },
      lastSync,
      planned: planLines(config, plan),
      checkedAt: Date.now(),
      actions,
      config: {
        host: config.host,
        user: config.user,
        port: config.port,
        identityFile: config.identityFile,
        remoteDir: config.remoteDir,
        projectName: resolvedProjectName(config),
        transport: config.transport,
        includeVault: config.includeVault,
        includeNodeModules: config.includeNodeModules,
        deleteExtraneous: config.deleteExtraneous,
        remoteInstall: config.remoteInstall,
        restartCommand: config.restartCommand,
      },
      paths: { projectRoot, dataRoot, configPath },
    };
  }

  function resolvedProjectName(config) {
    try { return targetPath(config).projectName; } catch (_) { return config.projectName || defaultProjectName(projectRoot); }
  }

  /* ── 动作实现 ── */

  function makeEmit(helpers) {
    return (stream, text) => {
      const line = String(text == null ? '' : text);
      if (!line) return;
      try { if (helpers && typeof helpers.emit === 'function') helpers.emit(stream, line); } catch (_) { /* 面板断开也不影响执行 */ }
      if (stream === 'err') log('vps-sync：' + line);
    };
  }

  function makeRunner(helpers, task) {
    return async (argv, timeoutMs, env) => {
      const command = argv[0];
      const args = argv.slice(1);
      return helpers.spawnStep(task, command, args, timeoutMs, env);
    };
  }

  /* 远端只读清单：预演里算「会删哪些」，不写任何东西。 */
  async function fetchRemoteList(config, emit) {
    const target = targetPath(config);
    const script = 'if [ -d ' + quoteRemote(target.path) + ' ]; then find ' + quoteRemote(target.path) + ' -type f 2>/dev/null | head -n ' + REMOTE_LIST_CAP + '; fi';
    const argv = sshStepArgv(config, script);
    emit('out', '只看远端文件清单（只读）：' + displayCommand(argv));
    const result = await execCapture(argv[0], argv.slice(1), { timeout: LIST_TIMEOUT_MS });
    if (!result.ok) return { ok: false, files: new Set(), error: explainSshError(result.err || result.out) };
    const files = new Set();
    for (const line of String(result.out || '').split(/\r?\n/)) {
      const value = line.trim();
      if (!value) continue;
      const prefix = target.path.replace(/\/+$/, '') + '/';
      if (value.startsWith(prefix)) files.add(value.slice(prefix.length));
      if (files.size >= REMOTE_LIST_CAP) break;
    }
    return { ok: true, files, error: '' };
  }

  /* 预演：绝不写远端。rsync 可用时用 `rsync -n --itemize-changes` 拿权威差异，否则本地算清单。 */
  async function preview(config, ctx) {
    const { emit, helpers, task } = ctx;
    if (!config.host || !config.user || !config.remoteDir) {
      emit('out', '配置还不完整，先把本机这份清单看清楚：');
      const manifest = localManifest(projectRoot, { excludes: excludePatterns(config), skipVault: !config.includeVault });
      emit('out', '项目内容：' + manifest.files + ' 个文件，约 ' + humanBytes(manifest.bytes));
      emit('err', '还缺 host / user / remoteDir，无法预演远端差异');
      task.result = { dryRun: true, transport: '', files: manifest.files, bytes: manifest.bytes, deletes: 0, configured: false };
      return 1;
    }
    const tools = await detectLocalTools(false);
    const probe = await probeRemote(config, false);
    const selection = describeTransports(config, tools, probe);
    const plan = buildPlan(config, tools, probe, selection);
    emit('out', '══ 预演（不会写远端任何东西）══');
    for (const line of planLines(config, plan)) emit('out', line);
    if (plan.targetError) {
      emit('err', '目标目录不合法，预演无法继续：' + plan.targetError);
      task.result = { dryRun: true, transport: '', configured: true, targetError: plan.targetError };
      return 1;
    }
    if (plan.deleteEnabled && plan.deleteError) emit('err', '拒绝删除：' + plan.deleteError);

    let deletes = [];
    let deleteUnknown = '';
    let deleteMode = plan.deleteEnabled ? 'local-diff' : 'off';
    if (plan.deleteEnabled && !plan.deleteError) {
      if (probe.reachable && selection.chosen === 'rsync' && tools.rsync) {
        /* rsync 空跑是权威差异：它的输出（含 `*deleting` 行）会由 spawnStep 实时流到任务控制台。 */
        deleteMode = 'rsync-dry-run';
        const argv = rsyncArgv(config, plan, { tools, dryRun: true, del: true, source: projectRoot, destination: plan.target.path });
        emit('out', '权威差异来自 rsync 空跑（只读）：' + displayCommand(argv));
        const code = await makeRunner(helpers, task)(argv, PREVIEW_TIMEOUT_MS);
        if (code !== 0) emit('err', 'rsync 空跑退出码 ' + code + '（上方是远端/本机的原始输出）');
        deleteUnknown = '删除条目以上方 rsync 空跑的 *deleting 行为准';
      } else {
        const remote = probe.reachable ? await fetchRemoteList(config, emit) : { ok: false, files: new Set(), error: '远端连不上' };
        if (!remote.ok) {
          deleteMode = 'unknown';
          deleteUnknown = remote.error || '拿不到远端清单';
          emit('err', '无法计算会删哪些远端文件：' + deleteUnknown);
        } else {
          const local = plan.manifest.paths;
          for (const rel of remote.files) {
            if (local.has(rel)) continue;
            /* 排除项默认受保护（rsync 也一样：--exclude 的文件不会被 --delete 删掉）。 */
            const base = rel.split('/').pop();
            if (matchesExclude(base, plan.excludes)) continue;
            deletes.push(rel);
            if (deletes.length >= REMOTE_LIST_CAP) break;
          }
          emit('out', '将删除远端 ' + deletes.length + ' 个文件（范围仅限 ' + plan.target.path + '）：');
          for (const rel of deletes.slice(0, PREVIEW_LINE_CAP)) emit('out', '  - ' + plan.target.path + '/' + rel);
          if (deletes.length > PREVIEW_LINE_CAP) emit('out', '  …其余 ' + (deletes.length - PREVIEW_LINE_CAP) + ' 个略');
        }
      }
    } else if (plan.deleteError) {
      deleteMode = 'rejected';
    } else {
      emit('out', '删除未开启：不会传 --delete，远端多余文件全部保留。');
    }

    const commandLines = previewCommands(config, plan, tools, selection);
    emit('out', '将执行的命令（预演阶段全部只读 / 空跑）：');
    for (const line of commandLines) emit('out', '  ' + line);
    if (!selection.chosen) emit('err', '没有可用传输方式，真同步会失败：' + selection.reason);
    emit(selection.chosen ? 'out' : 'err', '预演结束：' + plan.manifest.files + ' 个文件 / ' + humanBytes(plan.manifest.bytes)
      + '，vault ' + (config.includeVault && plan.vault.exists ? '包含' : '不包含')
      + '，' + (deleteMode === 'off' ? '不会删除任何远端文件'
        : deleteMode === 'rejected' ? '删除被拒绝（目标校验不通过）'
          : deleteMode === 'rsync-dry-run' ? '删除清单见上方 rsync 空跑输出'
            : deleteMode === 'unknown' ? '删除清单没算出来：' + deleteUnknown
              : '预计删除 ' + deletes.length + ' 个远端文件')
      + (selection.chosen ? '，执行方式 ' + selection.chosen : '，但没有可用传输方式'));
    task.result = {
      dryRun: true,
      transport: selection.chosen,
      files: plan.manifest.files,
      bytes: plan.manifest.bytes,
      truncated: plan.manifest.truncated,
      includeVault: config.includeVault,
      vaultLocal: plan.vault.localPath,
      excludes: plan.excludes,
      deletes: deletes.slice(0, PREVIEW_LINE_CAP),
      deleteCount: deleteMode === 'rsync-dry-run' ? null : deletes.length,
      deleteMode,
      deleteUnknown,
      target: plan.target.path,
      commands: commandLines,
    };
    return selection.chosen ? 0 : 1;
  }

  /* 预演里展示的「将执行的命令」：与实际执行的 argv 保持同一套构造逻辑。 */
  function previewCommands(config, plan, tools, selection) {
    const lines = [];
    if (selection.chosen === 'rsync' && tools.rsync) {
      lines.push(displayCommand(rsyncArgv(config, plan, { tools, dryRun: false, del: plan.deleteEnabled && !plan.deleteError, source: projectRoot, destination: plan.target.path })));
      if (config.includeVault && plan.vaultOutside) {
        lines.push(displayCommand(rsyncArgv(config, plan, { tools, dryRun: false, del: false, source: plan.vault.localPath, destination: plan.target.path + '/' + VAULT_DIR })));
      }
    } else if (selection.chosen === 'tar') {
      lines.push('tar -czf <本地临时包> ' + plan.excludes.map((item) => '--exclude=' + item).join(' ') + ' -C ' + projectRoot + ' .'
        + (config.includeVault && plan.vaultOutside && plan.vault.exists ? ' -C ' + path.dirname(plan.vault.localPath) + ' ' + VAULT_DIR : ''));
      lines.push(displayCommand([tools.scp || 'scp', '-P', String(config.port), '<本地临时包>', config.user + '@' + config.host + ':' + quoteRemote(plan.target.remoteDir + '/.codescope-upload-<随机>.tgz')]));
      lines.push(sshCommandText(config, 'mkdir -p ' + quoteRemote(plan.target.path) + ' && tar -xzf ' + quoteRemote(plan.target.remoteDir + '/.codescope-upload-<随机>.tgz') + ' -C ' + quoteRemote(plan.target.path) + ' && rm -f ' + quoteRemote(plan.target.remoteDir + '/.codescope-upload-<随机>.tgz')));
    } else if (selection.chosen === 'scp') {
      lines.push('逐项 ' + displayCommand([tools.scp || 'scp', '-r', '-P', String(config.port), '<项目顶层条目>', config.user + '@' + config.host + ':' + quoteRemote(plan.target.path + '/')]));
      lines.push('注意：scp 无法按嵌套规则过滤，*.log / .cache / __pycache__ 这类嵌套排除项在 scp 下不生效');
    } else {
      lines.push('（没有可用传输方式）');
    }
    return lines;
  }

  /* 同步主流程：先建目录，再按选中的 transport 传输，最后写状态。 */
  async function syncOnce(config, ctx, options) {
    const { emit, helpers, task } = ctx;
    const apply = options && options.apply !== false;
    const tools = await detectLocalTools(false);
    const probe = await probeRemote(config, false);
    const selection = describeTransports(config, tools, probe);
    const plan = buildPlan(config, tools, probe, selection);
    if (!plan.target.path) throw invalid('还没配好 remoteDir，无法同步');
    if (plan.targetError) throw invalid('配置里的远端目标不合法：' + plan.targetError);
    if (!selection.chosen) throw invalid('没有可用传输方式：' + selection.reason);
    if (plan.deleteEnabled && plan.deleteError) throw invalid('拒绝执行：' + plan.deleteError);
    if (!apply) return preview(config, ctx);

    const del = plan.deleteEnabled && selection.chosen === 'rsync';
    emit('out', '传输方式：' + selection.chosen + '（' + selection.reason + '）');
    if (plan.deleteEnabled) {
      emit(del ? 'out' : 'err', del
        ? '删除已开启：--delete 只作用在 ' + plan.target.path + ' 内'
        : '删除已开启，但 ' + selection.chosen + ' 不做删除，本次只上传不删（只有 rsync 能安全删）');
    } else {
      emit('out', '删除未开启：远端多余文件保留（绝不 --delete）');
    }
    const startedAt = Date.now();
    let files = plan.manifest.files;
    let bytes = plan.manifest.bytes;
    /* vault 是第二个源（同级布局时），统计口径也要算上它。 */
    if (config.includeVault && plan.vault.exists) {
      files += plan.vault.files;
      bytes += plan.vault.bytes;
    }

    /* 1) 建目录（唯一允许的「先写」步骤，且写的是目标目录本身）。 */
    {
      const remote = 'mkdir -p ' + quoteRemote(plan.target.path)
        + (config.includeVault && plan.vault.exists ? ' ' + quoteRemote(plan.target.path + '/' + VAULT_DIR) : '');
      const argv = sshStepArgv(config, remote);
      emit('out', '准备远端目录：' + displayCommand(argv));
      const code = await makeRunner(helpers, task)(argv, SSH_STEP_TIMEOUT_MS);
      if (code !== 0) { emit('err', 'mkdir 失败（退出码 ' + code + '）'); task.result = { ok: false, transport: selection.chosen, stage: 'mkdir', exit: code }; return 1; }
    }

    if (selection.chosen === 'rsync') {
      const argv = rsyncArgv(config, plan, { tools, dryRun: false, del, source: projectRoot, destination: plan.target.path });
      emit('out', '项目同步：' + displayCommand(argv));
      const code = await makeRunner(helpers, task)(argv, SYNC_TIMEOUT_MS);
      if (code !== 0) { emit('err', 'rsync 项目同步退出码 ' + code); task.result = { ok: false, transport: 'rsync', stage: 'project', exit: code }; return 1; }
      if (config.includeVault && plan.vault.exists) {
        const vaultArgv = rsyncArgv(config, plan, { tools, dryRun: false, del: false, source: plan.vault.localPath, destination: plan.target.path + '/' + VAULT_DIR });
        emit('out', 'vault 同步：' + displayCommand(vaultArgv));
        const vaultCode = await makeRunner(helpers, task)(vaultArgv, SYNC_TIMEOUT_MS);
        if (vaultCode !== 0) { emit('err', 'rsync vault 同步退出码 ' + vaultCode); task.result = { ok: false, transport: 'rsync', stage: 'vault', exit: vaultCode }; return 1; }
      } else if (config.includeVault && !plan.vault.exists) {
        emit('out', 'includeVault=true，但本机没有可传的 markdown-vault，跳过');
      } else {
        emit('out', 'includeVault=false：markdown-vault 不动');
      }
    } else if (selection.chosen === 'tar') {
      /* tar：本机打包 → scp 送包 → 远端 tar 解包。
         注意这里没有用 `tar -czf - | ssh ...` 那种管道：spawnStep 只接受 argv 数组、没有管道/重定向能力，
         要管道就必须 sh -c 拼字符串 —— 那正好踩红线③。所以改成「临时包 + scp + 远端解包」，
         语义完全一致（远端只需要 tar，不需要 rsync），只是多一次临时文件落盘。 */
      const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const localArchive = path.join(os.tmpdir(), 'codescope-sync-' + process.pid + '-' + stamp + '.tgz');
      const remoteArchive = plan.target.remoteDir + '/.codescope-upload-' + stamp + '.tgz';
      const args = ['-czf', localArchive];
      for (const pattern of plan.excludes) args.push('--exclude=' + pattern);
      args.push('-C', projectRoot, '.');
      if (config.includeVault && plan.vaultOutside && plan.vault.exists) args.push('-C', path.dirname(plan.vault.localPath), VAULT_DIR);
      const tarArgv = [tools.tar, ...args];
      emit('out', '本地打包：' + displayCommand(tarArgv));
      const tarCode = await makeRunner(helpers, task)(tarArgv, SYNC_TIMEOUT_MS);
      if (tarCode !== 0) { emit('err', 'tar 打包失败（退出码 ' + tarCode + '）'); task.result = { ok: false, transport: 'tar', stage: 'pack', exit: tarCode }; return 1; }
      try {
        const sendArgv = scpSendArgv(config, tools.scp, localArchive, remoteArchive, false);
        emit('out', '上传压缩包：' + displayCommand(sendArgv));
        const scpCode = await makeRunner(helpers, task)(sendArgv, SYNC_TIMEOUT_MS);
        if (scpCode !== 0) { emit('err', 'scp 上传失败（退出码 ' + scpCode + '）'); task.result = { ok: false, transport: 'tar', stage: 'upload', exit: scpCode }; return 1; }
      } finally {
        try { fs.unlinkSync(localArchive); } catch (_) { /* 临时包删不掉不影响结果 */ }
      }
      const extract = 'mkdir -p ' + quoteRemote(plan.target.path)
        + ' && tar -xzf ' + quoteRemote(remoteArchive) + ' -C ' + quoteRemote(plan.target.path)
        + ' && rm -f ' + quoteRemote(remoteArchive);
      const extractArgv = sshStepArgv(config, extract);
      emit('out', '远端解包：' + displayCommand(extractArgv));
      const extractCode = await makeRunner(helpers, task)(extractArgv, SYNC_TIMEOUT_MS);
      if (extractCode !== 0) { emit('err', '远端解包失败（退出码 ' + extractCode + '）'); task.result = { ok: false, transport: 'tar', stage: 'extract', exit: extractCode }; return 1; }
    } else {
      /* scp 兜底：只能按顶层条目逐个复制，嵌套排除项（*.log / .cache / __pycache__）在这里不生效，必须明说。 */
      let entries = [];
      try { entries = fs.readdirSync(projectRoot, { withFileTypes: true }); } catch (error) { emit('err', '读不到项目目录：' + (error.message || error)); return 1; }
      const skipVault = !config.includeVault;
      let sent = 0;
      for (const entry of entries) {
        if (entry.name === VAULT_DIR && skipVault) continue;
        if (matchesExclude(entry.name, plan.excludes)) continue;
        const argv = scpSendArgv(config, tools.scp, path.join(projectRoot, entry.name), plan.target.path + '/', true);
        emit('out', 'scp ' + entry.name + '：' + displayCommand(argv));
        const code = await makeRunner(helpers, task)(argv, SYNC_TIMEOUT_MS);
        if (code !== 0) { emit('err', 'scp 复制 ' + entry.name + ' 失败（退出码 ' + code + '）'); task.result = { ok: false, transport: 'scp', stage: entry.name, exit: code }; return 1; }
        sent += 1;
      }
      if (config.includeVault && plan.vaultOutside && plan.vault.exists) {
        const argv = scpSendArgv(config, tools.scp, plan.vault.localPath, plan.target.path + '/' + VAULT_DIR, true);
        emit('out', 'scp vault：' + displayCommand(argv));
        const code = await makeRunner(helpers, task)(argv, SYNC_TIMEOUT_MS);
        if (code !== 0) { emit('err', 'scp 复制 vault 失败（退出码 ' + code + '）'); task.result = { ok: false, transport: 'scp', stage: 'vault', exit: code }; return 1; }
      }
      emit('err', 'scp 已发送 ' + sent + ' 个顶层条目；注意嵌套排除项在 scp 下不生效（*.log / .cache / __pycache__ 可能被一起复制）');
    }

    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const message = '同步完成：' + files + ' 个文件 / ' + humanBytes(bytes) + '，用时 ' + seconds + ' 秒，方式 ' + selection.chosen
      + (plan.deleteEnabled && selection.chosen !== 'rsync' ? '（删除未执行）' : '');
    emit('out', message);
    recordResult(config, { action: options.action || 'vps-sync', ok: true, transport: selection.chosen, files, bytes, deletes: 0, seconds, message });
    task.result = {
      ok: true,
      transport: selection.chosen,
      target: plan.target.path,
      files,
      bytes,
      seconds,
      includeVault: config.includeVault,
      vaultLocal: plan.vault.localPath,
      excludes: plan.excludes,
      deletes: plan.deleteEnabled && del ? '由 rsync --delete 处理（范围仅限目标目录）' : 0,
    };
    return 0;
  }

  function recordResult(config, result) {
    try {
      const next = getConfig();
      next.lastSyncAt = Date.now();
      /* 失败停在哪一步要写进结果里：下次打开界面只看一行字就知道上次为什么没成，
         而不是让人去翻几十行任务日志。 */
      if (result && result.ok && result.action === 'vps-deploy' && result.deployed !== true && !result.message) {
        result.message = '文件已送达，但部署没有完成' + (result.stage ? '（卡在「' + result.stage + '」阶段，退出码 ' + (result.exit || 0) + '）' : '（远端装依赖或重启失败，详见任务日志）');
      }
      next.lastResult = result;
      persist(next);
    } catch (error) {
      log('vps-sync：写同步状态失败：' + ((error && error.message) || error));
    }
  }

  /* 部署 = 同步 + 远端 npm install（可关）+ 白名单 restartCommand（可选）。 */
  async function deploy(config, ctx) {
    const { emit, helpers, task } = ctx;
    /* 先校验重启命令，再动任何远端文件：参数错了就不该有半截部署。 */
    const restart = assertRestartCommand(config.restartCommand);
    const code = await syncOnce(config, ctx, { apply: true, action: 'vps-deploy' });
    if (code !== 0) return code;
    const targetPathText = targetPath(config).path;

    if (config.remoteInstall) {
      const remote = 'cd ' + quoteRemote(targetPathText) + ' && npm install --omit=dev';
      const argv = sshStepArgv(config, remote);
      emit('out', '远端安装生产依赖：' + displayCommand(argv));
      const installCode = await makeRunner(helpers, task)(argv, SYNC_TIMEOUT_MS);
      if (installCode !== 0) {
        emit('err', '远端 npm install 失败（退出码 ' + installCode + '）：确认远端有 npm 且在非交互式 PATH 里');
        task.result = Object.assign({}, task.result || {}, { deployed: false, stage: 'install', exit: installCode });
        return 1;
      }
      emit('out', '远端依赖装好了（--omit=dev）');
    } else {
      emit('out', 'remoteInstall=false：跳过远端 npm install');
    }

    if (restart) {
      const remote = 'cd ' + quoteRemote(targetPathText) + ' && ' + restart;
      const argv = sshStepArgv(config, remote);
      emit('out', '远端重启：' + displayCommand(argv));
      const restartCode = await makeRunner(helpers, task)(argv, SYNC_TIMEOUT_MS);
      if (restartCode !== 0) {
        emit('err', '重启命令失败（退出码 ' + restartCode + '）：' + restart + '；同步与安装已完成，服务可能仍是旧进程');
        task.result = Object.assign({}, task.result || {}, { deployed: false, stage: 'restart', exit: restartCode, restart });
        return 1;
      }
      emit('out', '已重启：' + restart);
    } else if (config.restartCommand) {
      emit('err', 'restartCommand 为空字符串，跳过重启（配置里有值但没通过校验时 setConfig 会直接拒掉）');
    } else {
      emit('out', '未配置 restartCommand：同步 + 安装已完成，重启请自行执行');
    }

    emit('out', '部署完成');
    task.result = Object.assign({}, task.result || {}, { deployed: true, installed: !!config.remoteInstall, restart, target: targetPathText });
    return 0;
  }

  /* 自检：只探测、不写，把「能不能部署」的结论一次说完。 */
  async function check(config, ctx) {
    const { emit, task } = ctx;
    if (!config.host || !config.user || !config.remoteDir) {
      emit('err', '配置不完整：需要 host、user、remoteDir（配置写不写得了也要看 ' + configPath + '）');
      emit('out', '提示：可用 setConfig 传 host / user / remoteDir / port / transport 等字段');
      task.result = { checked: false, reason: 'config-incomplete' };
      return 1;
    }
    emit('out', '目标：' + config.user + '@' + config.host + ':' + config.port + ' → ' + targetPath(config).path);
    emit('out', 'SSH 参数：' + sshFlagsText(config) + '（BatchMode=yes：绝不挂在密码提示上）');
    const probe = await probeRemote(config, true);
    if (!probe.reachable) {
      emit('err', '连通性：失败 —— ' + probe.error);
      emit('out', '最近一次同步：' + (config.lastSyncAt ? clockLabel(config.lastSyncAt) + '（' + ((config.lastResult && config.lastResult.message) || '') + '）' : '从未同步过'));
      task.result = { checked: true, reachable: false, error: probe.error, at: probe.at };
      return 1;
    }
    emit('out', '连通性：OK（' + probe.ms + 'ms）');
    emit('out', '远端系统：' + (probe.system || '未知'));
    emit('out', '远端 rsync：' + (probe.hasRsync ? probe.rsyncPath : '未安装（不影响 tar/scp 传输）'));
    emit('out', '远端 tar：' + (probe.hasTar ? probe.tarPath : '未安装'));
    emit('out', '远端 npm：' + (probe.hasNpm ? probe.npmPath : '未找到（部署动作的远端安装会失败）'));
    emit('out', '远端目录 ' + config.remoteDir + '：' + (probe.remoteDirExists ? '已存在' : '不存在（同步时会 mkdir -p 创建）')
      + '；可写：' + (probe.writable ? '是（判定点 ' + probe.writablePath + '）' : '否'));
    if (probe.disk) {
      emit('out', '磁盘：' + probe.disk.filesystem + ' 共 ' + humanBytes(probe.disk.totalKb * 1024)
        + '，已用 ' + humanBytes(probe.disk.usedKb * 1024) + '，可用 ' + humanBytes(probe.disk.freeKb * 1024) + '（' + probe.disk.capacity + '）');
    } else {
      emit('out', '磁盘：远端没返回 df 结果（可能是不常见的 busybox 或权限限制）');
    }
    emit('out', '最近一次同步：' + (config.lastSyncAt ? clockLabel(config.lastSyncAt) + ' · ' + ((config.lastResult && config.lastResult.message) || '（无详情）') : '从未同步过'));
    const selection = describeTransports(config, await detectLocalTools(false), probe);
    emit(selection.chosen ? 'out' : 'err', '可用传输：' + (selection.usable.join('、') || '无') + '；本次会选 ' + (selection.chosen || '无') + ' —— ' + selection.reason);
    emit(probe.writable ? 'out' : 'err', probe.writable ? '结论：可以同步/部署' : '结论：目录不可写，同步会失败');
    task.result = { checked: true, reachable: true, probe, transport: selection.chosen, usable: selection.usable, lastSyncAt: config.lastSyncAt };
    return probe.writable ? 0 : 1;
  }

  /* ── runAction：面板唯一入口 ── */

  async function runAction(action, params, helpers, task) {
    const spec = buildActionSpecs(getConfig()).find((item) => item.id === action);
    if (!spec) throw invalid('未知的 VPS 动作：' + action);
    const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
    const dryRun = !!p.dryRun;
    const emit = makeEmit(helpers);
    const ctx = { emit, helpers, task, params: p };
    const config = getConfig();
    emit('out', '动作：' + spec.label + (dryRun && action !== 'vps-preview' ? '（dryRun=true：只预演）' : ''));
    emit('out', '配置文件：' + configPath);
    if (action === 'vps-check') return check(config, ctx);
    if (action === 'vps-preview' || dryRun) return preview(config, ctx);
    if (action === 'vps-sync') return syncOnce(config, ctx, { apply: true, action: 'vps-sync' });
    return deploy(config, ctx);
  }

  function actionSpecs() {
    return buildActionSpecs(getConfig());
  }

  function resetCache() {
    probeCache = null;
    probeCacheAt = 0;
    probeCacheKey = '';
    toolsCache = null;
    toolsCacheAt = 0;
    return true;
  }

  return { getConfig, setConfig, report, actionSpecs, runAction, resetCache };
}

module.exports = { createRemoteSync };
