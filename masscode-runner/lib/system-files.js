'use strict';

/* 平台差异（打开/定位/选目录/废纸篓/保护区）一律问 lib/platform.js，本文件不再写死 macOS 命令。 */
const { HOST } = require('./platform');

/* 本机管家 · 文件管理后端
 * ---------------------------------------------------------------------------
 * 这是整个面板里唯一会改动用户数据的模块，所以规矩定得最保守：
 *   1) 删除优先送进「废纸篓」——同卷 rename，能撤销；跨卷不做「复制+删除」这种危险动作，直接拒绝并说明；
 *   2) 永久删除必须由调用方显式传 confirm=永久删除，且服务端再拦一道受保护路径；
 *   3) 只删链接本身，绝不跟随符号链接去动目标（fs.rm 对符号链接不递归，这里再显式确认一次）；
 *   4) 受保护路径（/、/System、/Users、家目录本身、~/Desktop 等常用目录本身）一律拒绝改删；
 *   5) 每个写操作都记进操作日志，事后可查。
 * 只读能力：列目录（含磁盘余量、面包屑）、文本预览、原始预览（图片/PDF）、搜索、占用分析、大文件、重复文件。
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const LIST_MAX = 4000;                  // 单目录最多返回条数
const TEXT_MAX = 512 * 1024;            // 文本预览上限
const RAW_MAX = 64 * 1024 * 1024;       // 原始预览上限（图片/PDF）
const BODY_MAX = 4 * 1024 * 1024;       // JSON 请求体上限
const UPLOAD_MAX = 512 * 1024 * 1024;   // 上传上限
const SEARCH_NODES = 60000;             // 搜索最多扫描的条目数
const SEARCH_MS = 9000;                 // 搜索时间上限
const USAGE_CHILDREN = 40;              // 占用分析最多实测多少个子项
const DUP_MIN = 512 * 1024;             // 重复文件扫描的最小体积
const DUP_WALK = 40000;                 // 重复文件扫描最多遍历的条目
const DUP_HASH_BYTES = 8 * 1024 * 1024 * 1024;
const DUP_MS = 25000;

const HOME = os.homedir();

/* 顶层受保护路径：删/移这些目录本身没有意义，几乎只会是误操作。 */
const PROTECTED_TOP = new Set([
  '/', '/System', '/System/Volumes', '/Library', '/Applications', '/Users', '/Volumes', '/private',
  '/usr', '/bin', '/sbin', '/etc', '/var', '/tmp', '/opt', '/dev', '/cores', '/Network', '/.vol',
]);
/* 平台补充：Windows 的 %SystemRoot% / Program Files，Linux 的 /usr /etc /boot /proc 等。
   与上面的 macOS 名单取并集，macOS 行为不变；非 macOS 也终于有保护区了。 */
for (const root of HOST.protectedRoots()) PROTECTED_TOP.add(root);
PROTECTED_TOP.add(path.parse(HOME).root);
/* 常用目录「本身」也保护：可以删里面的东西，但不该一键把整个桌面送进废纸篓。 */
const PROTECTED_HOME = new Set(['Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Library', 'Public']);

/*
 * 前缀级保护区。原来的名单只做「精确匹配」，也就是只挡住了 /System 本身，
 * /System/Library/... 这种子路径是**拦不住**的 —— 那是真的会动到系统文件。
 * 这里改成前缀匹配，任何位于这些树里的路径一律拒绝写入/删除/移动/改名。
 */
const PROTECTED_PREFIXES = [
  '/System',            // 整个系统卷（含 /System/Volumes/Data 下的系统数据）
  '/Library',           // 全局库
  '/usr', '/bin', '/sbin', '/etc', '/private', '/var', '/opt', '/dev', '/cores', '/Network',
  '/Volumes/.timemachine',
  ...HOST.protectedRoots(),   // 平台补充（Windows: C:\Windows、Program Files；Linux: /boot、/proc…）
];
/* 敏感区：系统能跑起来靠它们，但里面也有用户数据。破坏性操作一律拒绝，
   只读浏览与扫描照常。清缓存请用面板里专门的「缓存清理」（自带白名单）。 */
const SENSITIVE_PREFIXES = [
  path.join(HOME, 'Library'),
  path.join(HOME, '.codescope'),   // 面板自己的配置/审计日志
  HOST.appDataDir,                 // 各平台的应用数据目录（Win: %APPDATA%，Linux: ~/.local/share）
];

/* /private 下也有「用户临时空间」，被系统保护的是 /private/etc、/private/var/db 这些。
   不加例外的话，连 /tmp 建个目录都会被打回（/tmp 是 /private/tmp 的软链）。 */
const EXEMPT_PREFIXES = [
  '/private/tmp', '/private/var/tmp', '/private/var/folders',   // /tmp、/var 的真身
  '/tmp', '/var/tmp', '/var/folders',                            // 软链写法（os.tmpdir() 就长这样）
];

function within(candidate, root) {
  if (candidate === root) return true;
  /* 用 path.relative 而不是拼 '/':Windows 的 C:\Windows 不是以 '/' 开头的，
     原来的写法会让前缀保护区在 Windows 上整体失效 —— 那是能删系统目录的漏洞。 */
  const rel = path.relative(root, candidate);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function protectedReason(target) {
  if (EXEMPT_PREFIXES.some((root) => within(target, root))) return null;
  for (const root of PROTECTED_PREFIXES) if (within(target, root)) return { kind: 'system', root };
  return null;
}

function sensitiveReason(target) {
  for (const root of SENSITIVE_PREFIXES) if (within(target, root)) return { kind: 'sensitive', root };
  return null;
}

/* 真实路径也要查一遍：家目录里放个指向 /System/Library 的软链，不能靠它绕过保护。 */
function realTarget(target) {
  try { return fs.realpathSync(target); } catch (_) {
    try { return path.join(fs.realpathSync(path.dirname(target)), path.basename(target)); } catch (_) { return target; }
  }
}

/* 「包内部」才算禁止修改：/Applications/Foo.app 本身可以进废纸篓（等于卸载，可还原），
   但 /Applications/Foo.app/Contents/... 不许写，改坏一个包等于毁掉这个应用。 */
function isInsideAppBundle(target) {
  const clean = target.replace(/\/+$/, '');
  return clean.includes('.app/');   // 「.app 后面还有东西」才算包内部；包本身可以卸载
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, BODY_MAX);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch (_) { throw new Error('请求体不是合法 JSON'); }
}

/* 并发受限的 map：文件系统调用并发太高反而变慢，还会撞上 EMFILE。 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function runFile(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      resolve({ ok: !error, stdout: stdout == null ? '' : String(stdout) });
    });
  });
}

/* 与宿主 server.js 的 trustedHttpOrigin 保持一致的判定：跨站直接拒，带 Origin 时必须同源。 */
function trustedOrigin(req) {
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  try { return new URL(origin).host === String(req.headers.host || ''); } catch (_) { return false; }
}

function kindOf(stats) {
  if (stats.isSymbolicLink()) return 'link';
  if (stats.isDirectory()) return 'dir';
  if (stats.isFile()) return 'file';
  return 'other';
}

function assertPath(value, label) {
  const raw = String(value == null ? '' : value);
  if (!raw.trim()) throw new Error((label || '路径') + '不能为空');
  if (raw.includes('\0')) throw new Error((label || '路径') + '含非法字符');
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) throw new Error((label || '路径') + '必须是绝对路径');
  return resolved;
}

/*
 * 改/删前的守卫。默认「失败即拒绝」：宁可少一个功能，也不能动到系统。
 *   - 前缀级系统保护区：任何写入/删除/移动/改名一律拒绝
 *   - 敏感区（~/Library、面板自身数据）：破坏性操作拒绝（浏览与扫描不受影响）
 *   - 家目录本身、常用目录本身：拒绝
 *   - .app 包内部：拒绝写入（改坏一个应用包等于毁掉它）
 */
function assertMutable(value, label, options) {
  const opts = options || {};
  const resolved = assertPath(value, label);
  const real = realTarget(resolved);
  const candidates = real === resolved ? [resolved] : [resolved, real];
  /* 精确级保护（含 /tmp 本身、家目录本身、常用目录本身）永远生效。 */
  for (const candidate of candidates) {
    if (PROTECTED_TOP.has(candidate)) throw new Error('这是系统受保护目录，拒绝操作：' + candidate);
    if (candidate === HOME) throw new Error('拒绝把家目录本身当作操作对象');
    if (path.dirname(candidate) === HOME && PROTECTED_HOME.has(path.basename(candidate))) {
      throw new Error('这是你的常用目录（' + path.basename(candidate) + '），只能操作里面的内容');
    }
  }
  /* 前缀级保护：临时空间整体豁免（判定同时看真实路径与写入路径，
     否则 /var/folders/... 会因为「/var」这个前缀被误拦）。 */
  const exempt = EXEMPT_PREFIXES.some((root) => candidates.some((item) => within(item, root)));
  if (!exempt) for (const candidate of candidates) {
    const blocked = protectedReason(candidate);
    if (blocked) {
      throw Object.assign(new Error('系统保护区，面板不提供任何修改：' + candidate + '（保护区：' + blocked.root + '）'), { statusCode: 403, protectedPath: blocked.root });
    }
    if (opts.destructive && !opts.allowAppBundle) {
      const sensitive = sensitiveReason(candidate);
      if (sensitive) {
        throw Object.assign(new Error('敏感目录，面板不做删除/移动/改名：' + candidate + '（如需清理请用「缓存清理」或访达）'), { statusCode: 403, sensitivePath: sensitive.root });
      }
      if (isInsideAppBundle(candidate)) {
        throw Object.assign(new Error('这是应用包内部，拒绝修改：' + candidate), { statusCode: 403 });
      }
    } else if (!opts.allowAppBundle && isInsideAppBundle(candidate) && within(candidate, path.join('/Applications'))) {
      throw Object.assign(new Error('不要把文件写进应用包里：' + candidate), { statusCode: 403 });
    }
  }
  return resolved;
}

function assertChildName(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name) throw new Error('名称不能为空');
  if (name === '.' || name === '..') throw new Error('名称不合法');
  if (/[\/\\\0]/.test(name)) throw new Error('名称里不能包含路径分隔符');
  if (name.length > 200) throw new Error('名称过长');
  return name;
}

async function exists(target) {
  try { await fsp.lstat(target); return true; } catch (_) { return false; }
}

/* 目标重名时按 Finder 的习惯加 (2)(3)…；连扩展名也照顾到。 */
async function uniquePath(dir, name) {
  const first = path.join(dir, name);
  if (!(await exists(first))) return first;
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; i < 100; i += 1) {
    const candidate = path.join(dir, stem + ' (' + i + ')' + ext);
    if (!(await exists(candidate))) return candidate;
  }
  return path.join(dir, stem + ' (' + Date.now() + ')' + ext);
}

async function crumbTrail(target) {
  const parts = [];
  let current = path.resolve(target);
  for (;;) {
    parts.unshift({ name: current === path.sep ? '/' : path.basename(current), path: current });
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    if (parts.length > 64) break;
  }
  return parts;
}

async function diskInfo(target) {
  try {
    const info = await fsp.statfs(target);
    const total = Number(info.blocks) * Number(info.bsize);
    const free = Number(info.bavail) * Number(info.bsize);
    return { total, free, used: Math.max(0, total - free) };
  } catch (_) { return { total: 0, free: 0, used: 0 }; }
}

function entryOf(name, full, stats, linkTarget) {
  return {
    name,
    path: full,
    kind: kindOf(stats),
    size: stats.isDirectory() ? 0 : Number(stats.size) || 0,
    mtime: Math.round(Number(stats.mtimeMs) || 0),
    mode: '0' + (stats.mode & 0o777).toString(8),
    link: stats.isSymbolicLink() ? (linkTarget || '') : '',
    ext: stats.isFile() ? (path.extname(name).slice(1).toLowerCase() || '') : '',
  };
}

function compareEntries(sort, order) {
  const sign = order === 'asc' ? 1 : -1;
  return (a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (b.kind === 'dir' && a.kind !== 'dir') return 1;
    let diff = 0;
    if (sort === 'size') diff = a.size - b.size;
    else if (sort === 'mtime') diff = a.mtime - b.mtime;
    else if (sort === 'kind') diff = String(a.ext).localeCompare(String(b.ext)) || a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
    else diff = a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    if (diff === 0) diff = a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
    return diff * sign;
  };
}

function globToRegExp(text) {
  const escaped = String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp('^' + escaped + '$', 'i');
}

function matchQuery(name, query) {
  const raw = String(query || '').trim();
  if (!raw) return true;
  if (/[*?]/.test(raw)) return globToRegExp(raw).test(name);
  return name.toLowerCase().includes(raw.toLowerCase());
}

/* 二进制判定按 git 的思路：出现 NUL 直接判二进制；否则看控制字符（除 	 
 
  ）占比，
   超过三成也判二进制。只看 NUL 会把「一堆 0x07」这种文件误当成文本。 */
function isProbablyBinary(buffer) {
  const probe = buffer.subarray(0, 8192);
  if (!probe.length) return false;
  let suspicious = 0;
  for (let i = 0; i < probe.length; i += 1) {
    const byte = probe[i];
    if (byte === 0) return true;
    const printable = byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 8 || (byte >= 32 && byte !== 127);
    if (!printable) suspicious += 1;
  }
  return suspicious / probe.length > 0.3;
}

function createFileManager(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const dataRoot = options.dataRoot || path.join(HOME, '.codescope');
  const opsFile = path.join(dataRoot, 'system-panel-files.json');
  /* 操作日志要落盘：废纸篓里的东西重启后还得能找回原位置，否则「还原」就是空话。
     内存里保留最近 300 条，磁盘上同样最多存 300 条，文件权限收紧到 0600。 */
  const operations = [];
  try {
    const saved = JSON.parse(fs.readFileSync(opsFile, 'utf8'));
    if (Array.isArray(saved && saved.operations)) operations.push(...saved.operations.slice(0, 300));
  } catch (_) { /* 首次运行没有这个文件，正常 */ }

  let saveTimer = null;
  function saveOperations() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(dataRoot, { recursive: true });
        fs.writeFileSync(opsFile, JSON.stringify({ version: 1, operations: operations.slice(0, 300) }, null, 1), { mode: 0o600 });
      } catch (error) { log('[files] 操作日志写入失败：' + error.message); }
    }, 400);
    if (saveTimer.unref) saveTimer.unref();
  }

  function record(type, detail) {
    const item = Object.assign({ type, at: Date.now() }, detail);
    operations.unshift(item);
    if (operations.length > 300) operations.pop();
    log('[files] ' + type + ' ' + JSON.stringify(detail).slice(0, 240));
    saveOperations();
    return item;
  }

  /* 从日志里找出「废纸篓里的这一项原本在哪」。 */
  function originOf(trashPath) {
    for (const item of operations) {
      if (item.type !== 'trash' || !Array.isArray(item.items)) continue;
      const hit = item.items.find((one) => one && one.to === trashPath && one.from);
      if (hit) return { from: hit.from, at: item.at };
    }
    return null;
  }

  /* ------------------------------- 只读 ------------------------------- */

  async function listDir(params) {
    const wanted = assertPath(params.get('path') || HOME, '路径');
    const stats = await fsp.lstat(wanted).catch(() => null);
    if (!stats) return { ok: false, error: '路径不存在：' + wanted };
    const dir = stats.isDirectory() ? wanted : path.dirname(wanted);
    const showHidden = params.get('hidden') === '1';
    const sort = ['name', 'size', 'mtime', 'kind'].includes(params.get('sort')) ? params.get('sort') : 'name';
    const order = params.get('order') === 'desc' ? 'desc' : 'asc';

    let dirents;
    try { dirents = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (error) { return { ok: false, error: '读不到这个目录（' + (error.code || 'ERROR') + '）：' + dir }; }
    const total = dirents.length;
    let visible = showHidden ? dirents : dirents.filter((item) => !item.name.startsWith('.'));
    const truncated = visible.length > LIST_MAX;
    visible = visible.slice(0, LIST_MAX);

    const entries = (await mapLimit(visible, 48, async (dirent) => {
      const full = path.join(dir, dirent.name);
      const info = await fsp.lstat(full).catch(() => null);
      if (!info) return null;
      let linkTarget = '';
      if (info.isSymbolicLink()) linkTarget = await fsp.readlink(full).catch(() => '');
      return entryOf(dirent.name, full, info, linkTarget);
    })).filter(Boolean);

    entries.sort(compareEntries(sort, order));
    return {
      ok: true,
      path: dir,
      parent: path.dirname(dir) === dir ? '' : path.dirname(dir),
      crumbs: await crumbTrail(dir),
      entries,
      truncated,
      total,
      hidden: !showHidden,
      sort,
      order,
      dirs: entries.filter((item) => item.kind === 'dir').length,
      files: entries.filter((item) => item.kind !== 'dir').length,
      bytes: entries.reduce((sum, item) => sum + (item.kind === 'dir' ? 0 : item.size), 0),
      fs: await diskInfo(dir),
    };
  }

  async function statPath(params) {
    const target = assertPath(params.get('path'), '路径');
    const info = await fsp.lstat(target).catch(() => null);
    if (!info) return { ok: false, error: '路径不存在：' + target };
    const linkTarget = info.isSymbolicLink() ? await fsp.readlink(target).catch(() => '') : '';
    const entry = entryOf(path.basename(target), target, info, linkTarget);
    let children = 0;
    if (entry.kind === 'dir') children = (await fsp.readdir(target).catch(() => [])).length;
    return { ok: true, entry, children, protected: PROTECTED_TOP.has(target) || target === HOME };
  }

  async function readText(params) {
    const target = assertPath(params.get('path'), '路径');
    const info = await fsp.lstat(target).catch(() => null);
    if (!info) return { ok: false, error: '文件不存在：' + target };
    if (!info.isFile()) return { ok: false, error: '这不是普通文件，无法按文本预览' };
    const max = Math.min(Number(params.get('max')) || TEXT_MAX, 4 * 1024 * 1024);
    const handle = await fsp.open(target, 'r');
    try {
      const size = Number(info.size) || 0;
      const length = Math.min(size, max);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      if (isProbablyBinary(buffer)) return { ok: true, binary: true, bytes: size, text: '', truncated: size > length };
      return { ok: true, binary: false, bytes: size, text: buffer.toString('utf8'), truncated: size > length, encoding: 'utf8' };
    } finally { await handle.close(); }
  }

  /* 原始字节预览（图片/PDF）：只发给同源页面，并限制体积。 */
  async function rawFile(req, res, params) {
    if (!trustedOrigin(req)) { sendJson(res, 403, { ok: false, error: '来源不受信任' }); return; }
    const target = assertPath(params.get('path'), '路径');
    const info = await fsp.lstat(target).catch(() => null);
    if (!info || !info.isFile()) { sendJson(res, 404, { ok: false, error: '文件不存在' }); return; }
    if (Number(info.size) > RAW_MAX) { sendJson(res, 413, { ok: false, error: '文件太大，不适合在面板里预览' }); return; }
    const ext = path.extname(target).toLowerCase();
    const types = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
      '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    };
    const download = params.get('download') === '1';
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Content-Length': Number(info.size),
      'Cache-Control': 'no-store',
      'Content-Disposition': (download ? 'attachment' : 'inline') + '; filename*=UTF-8\'\'' + encodeURIComponent(path.basename(target)),
    });
    fs.createReadStream(target).pipe(res);
  }

  /* 搜索：广度优先 + 条目数/时间双预算，被截断时如实说明。 */
  async function search(params) {
    const root = assertPath(params.get('path') || HOME, '路径');
    const rootInfo = await fsp.lstat(root).catch(() => null);
    if (!rootInfo) return { ok: false, error: '路径不存在：' + root };
    const query = String(params.get('q') || '');
    if (!query.trim()) return { ok: false, error: '请输入要查找的关键词' };
    const recursive = params.get('recursive') !== '0';
    const wantKind = params.get('kind') || '';
    const minSize = Math.max(0, Number(params.get('minSize')) || 0);
    const hidden = params.get('hidden') === '1';
    const limit = Math.min(Math.max(Number(params.get('limit')) || 300, 1), 2000);
    const depthMax = Math.min(Math.max(Number(params.get('depth')) || 6, 1), 20);
    const started = Date.now();
    const matches = [];
    let scanned = 0;
    let truncated = false;
    const queue = [{ dir: root, depth: 0 }];
    while (queue.length) {
      const { dir, depth } = queue.shift();
      let dirents;
      try { dirents = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const item of dirents) {
        if (!hidden && item.name.startsWith('.')) continue;
        scanned += 1;
        const full = path.join(dir, item.name);
        const isDir = item.isDirectory();
        if (matchQuery(item.name, query)) {
          const info = await fsp.lstat(full).catch(() => null);
          if (info && (!wantKind || (wantKind === 'dir') === isDir) && (!minSize || Number(info.size) >= minSize)) {
            let linkTarget = '';
            if (info.isSymbolicLink()) linkTarget = await fsp.readlink(full).catch(() => '');
            matches.push(entryOf(item.name, full, info, linkTarget));
            if (matches.length >= limit) { truncated = true; break; }
          }
        }
        if (recursive && isDir && depth < depthMax) queue.push({ dir: full, depth: depth + 1 });
        if (scanned >= SEARCH_NODES || Date.now() - started > SEARCH_MS) { truncated = true; break; }
      }
      if (truncated) break;
    }
    matches.sort(compareEntries('name', 'asc'));
    return { ok: true, root, query, matches, scanned, truncated, ms: Date.now() - started, limit };
  }

  async function dirSize(target) {
    const result = await runFile('du', ['-sk', target], 60000);
    const kb = parseInt(String(result.stdout).trim().split(/\s+/)[0], 10);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  }

  /* 占用分析：只实测有限个子项（du 很慢），其余标记为未实测，避免拖垮页面。 */
  async function usage(params) {
    const target = assertPath(params.get('path') || HOME, '路径');
    const info = await fsp.lstat(target).catch(() => null);
    if (!info) return { ok: false, error: '路径不存在：' + target };
    if (!info.isDirectory()) return { ok: false, error: '占用分析需要一个目录' };
    const dirents = (await fsp.readdir(target, { withFileTypes: true }).catch(() => []))
      .filter((item) => !item.name.startsWith('.'));
    const children = dirents.map((item) => ({ name: item.name, path: path.join(target, item.name), kind: item.isDirectory() ? 'dir' : 'file' }));
    children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    const measured = children.slice(0, USAGE_CHILDREN);
    const started = Date.now();
    const items = await mapLimit(measured, 4, async (child) => {
      const size = child.kind === 'dir' ? await dirSize(child.path) : (await fsp.lstat(child.path).catch(() => ({ size: 0 }))).size || 0;
      return Object.assign({}, child, { size: Number(size) || 0 });
    });
    const total = items.reduce((sum, item) => sum + item.size, 0) || (await dirSize(target));
    for (const item of items) item.share = total ? item.size / total : 0;
    items.sort((a, b) => b.size - a.size);
    return {
      ok: true, path: target, total, items,
      measured: items.length, children: children.length,
      skipped: Math.max(0, children.length - items.length),
      ms: Date.now() - started,
      fs: await diskInfo(target),
    };
  }

  /* 遍历收集文件（带预算），供大文件与重复文件复用。 */
  async function collectFiles(root, opts) {
    const minSize = opts.minSize || 0;
    const found = [];
    let scanned = 0;
    const started = Date.now();
    const queue = [root];
    while (queue.length && found.length < (opts.maxFiles || DUP_WALK)) {
      const dir = queue.shift();
      let dirents;
      try { dirents = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const item of dirents) {
        if (item.name.startsWith('.')) continue;
        scanned += 1;
        if (scanned > DUP_WALK || Date.now() - started > DUP_MS) return { files: found, scanned, truncated: true };
        const full = path.join(dir, item.name);
        if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) { queue.push(full); continue; }
        if (!item.isFile()) continue;
        const info = await fsp.lstat(full).catch(() => null);
        if (!info) continue;
        if (Number(info.size) < minSize) continue;
        found.push({ path: full, size: Number(info.size), mtime: Math.round(info.mtimeMs || 0) });
      }
    }
    return { files: found, scanned, truncated: queue.length > 0 };
  }

  async function largeFiles(params) {
    const root = assertPath(params.get('path') || HOME, '路径');
    const minSize = Math.max(1024 * 1024, Number(params.get('minSize')) || 200 * 1024 * 1024);
    const limit = Math.min(Math.max(Number(params.get('limit')) || 60, 1), 500);
    const info = await fsp.lstat(root).catch(() => null);
    if (!info) return { ok: false, error: '路径不存在：' + root };
    const started = Date.now();
    const { files, scanned, truncated } = await collectFiles(root, { minSize, maxFiles: 40000 });
    files.sort((a, b) => b.size - a.size);
    return {
      ok: true, root, minSize, files: files.slice(0, limit), total: files.length,
      scanned, truncated, ms: Date.now() - started,
    };
  }

  async function hashFile(target, limit) {
    return new Promise((resolve) => {
      const hash = crypto.createHash('sha1');
      const stream = fs.createReadStream(target, limit ? { start: 0, end: limit - 1 } : undefined);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', () => resolve(''));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /* 重复文件：先按体积分组，再局部哈希粗筛，最后整文件哈希确认——三级过滤，尽量少读盘。 */
  async function duplicates(params) {
    const root = assertPath(params.get('path') || HOME, '路径');
    const minSize = Math.max(1024, Number(params.get('minSize')) || DUP_MIN);
    const maxGroups = Math.min(Math.max(Number(params.get('limit')) || 40, 1), 200);
    const info = await fsp.lstat(root).catch(() => null);
    if (!info) return { ok: false, error: '路径不存在：' + root };
    const started = Date.now();
    const walk = await collectFiles(root, { minSize, maxFiles: DUP_WALK });
    const bySize = new Map();
    for (const file of walk.files) {
      if (!bySize.has(file.size)) bySize.set(file.size, []);
      bySize.get(file.size).push(file.path);
    }
    const candidates = [...bySize.entries()].filter(([, list]) => list.length > 1).sort((a, b) => b[0] * b[1].length - a[0] * a[1].length);
    const groups = [];
    let hashedBytes = 0;
    for (const [size, list] of candidates) {
      if (groups.length >= maxGroups) break;
      if (Date.now() - started > DUP_MS || hashedBytes > DUP_HASH_BYTES) break;
      const coarse = new Map();
      for (const file of list) {
        const digest = await hashFile(file, 65536);
        hashedBytes += Math.min(size, 65536);
        if (!digest) continue;
        if (!coarse.has(digest)) coarse.set(digest, []);
        coarse.get(digest).push(file);
      }
      for (const bucket of coarse.values()) {
        if (bucket.length < 2) continue;
        if (Date.now() - started > DUP_MS || hashedBytes > DUP_HASH_BYTES) break;
        const fine = new Map();
        for (const file of bucket) {
          const digest = await hashFile(file, 0);
          hashedBytes += size;
          if (!digest) continue;
          if (!fine.has(digest)) fine.set(digest, []);
          fine.get(digest).push(file);
        }
        for (const same of fine.values()) {
          if (same.length < 2) continue;
          const rows = [];
          for (const file of same) {
            const stat = await fsp.lstat(file).catch(() => null);
            rows.push({ path: file, size, mtime: stat ? Math.round(stat.mtimeMs || 0) : 0 });
          }
          rows.sort((a, b) => a.mtime - b.mtime);
          groups.push({ hash: crypto.createHash('sha1').update(same[0] + size).digest('hex').slice(0, 12), size, files: rows, wasted: size * (rows.length - 1) });
        }
      }
    }
    groups.sort((a, b) => b.wasted - a.wasted);
    return {
      ok: true, root, minSize, groups: groups.slice(0, maxGroups),
      scanned: walk.scanned, truncated: walk.truncated || groups.length > maxGroups,
      scannedFiles: walk.files.length, ms: Date.now() - started,
    };
  }

  /* ------------------------------- 写操作 ------------------------------- */

  async function mkdir(body) {
    const dir = assertMutable(body.path, '目录');
    const name = assertChildName(body.name);
    const target = path.join(dir, name);
    if (await exists(target)) throw new Error('已存在同名文件或文件夹：' + name);
    await fsp.mkdir(target, { recursive: false });
    record('mkdir', { path: target });
    return { ok: true, path: target };
  }

  async function rename(body) {
    const source = assertMutable(body.path, '路径', { destructive: true });
    const name = assertChildName(body.name);
    const target = path.join(path.dirname(source), name);
    if (target === source) return { ok: true, path: source, unchanged: true };
    if (await exists(target)) throw new Error('同目录下已有同名项：' + name);
    await fsp.rename(source, target);
    record('rename', { from: source, to: target });
    return { ok: true, path: target };
  }

  async function move(body) {
    const list = Array.isArray(body.paths) ? body.paths : [body.path];
    const targetDir = assertPath(body.to, '目标目录');
    const targetInfo = await fsp.lstat(targetDir).catch(() => null);
    if (!targetInfo || !targetInfo.isDirectory()) throw new Error('目标目录不存在：' + targetDir);
    const copy = !!body.copy;
    const done = [];
    for (const item of list) {
      const source = assertMutable(item, '源路径', { destructive: true });
      if (targetDir === source || targetDir.startsWith(source + path.sep)) throw new Error('不能把目录移动到它自己里面：' + source);
      const target = await uniquePath(targetDir, path.basename(source));
      if (copy) await fsp.cp(source, target, { recursive: true, errorOnExist: false, force: false, preserveTimestamps: true });
      else {
        try { await fsp.rename(source, target); }
        catch (error) {
          if (error.code === 'EXDEV') throw new Error('跨磁盘移动需要复制，请改用「复制」（或先复制再删除原文件）：' + path.basename(source));
          throw error;
        }
      }
      done.push({ from: source, to: target });
    }
    record(copy ? 'copy' : 'move', { to: targetDir, count: done.length, items: done.slice(0, 10) });
    return { ok: true, items: done, count: done.length };
  }

  async function trash(body) {
    const list = Array.isArray(body.paths) ? body.paths : [body.path];
    /* 废纸篓位置按平台来：
       · macOS 保持原行为 —— 直接 rename 进 ~/.Trash（Finder 认得，能还原）；
       · Linux 走 XDG：~/.local/share/Trash/files/ 放内容，info/*.trashinfo 记原始路径与时间，
         少了 info 那一步，文件管理器里就还原不了；
       · Windows 走系统回收站（PowerShell SendToRecycleBin）。
       以前这里写死 ~/.Trash —— 在 Linux 上建了个没人认的目录，在 Windows 上更糟：
       用户目录里多一个假废纸篓，真回收站里什么都没有。 */
    const trashDir = path.join(HOME, '.Trash');
    if (HOST.isMac) await fsp.mkdir(trashDir, { recursive: true }).catch(() => {});
    const done = [];
    for (const item of list) {
      const source = assertMutable(item, '路径', { destructive: true });
      const info = await fsp.lstat(source).catch(() => null);
      if (!info) throw new Error('要删除的路径不存在：' + source);
      const plan = HOST.trashPlan(source);
      let target = plan.moves && plan.moves[0] ? plan.moves[0].to : '';
      if (!target && HOST.isMac) target = await uniquePath(trashDir, path.basename(source));
      if (plan.method === 'recycle-bin' && plan.command) {
        const moved = await runFile(plan.command.file, plan.command.args, 20000);
        if (!moved.ok) throw new Error('送进系统回收站失败：' + String(moved.stderr || moved.stdout || '').trim().slice(0, 120));
        done.push({ from: source, to: '(系统回收站)', kind: kindOf(info) });
        continue;
      }
      if (!target) throw new Error('这个平台没有可用的废纸篓方案');
      await fsp.mkdir(path.dirname(target), { recursive: true }).catch(() => {});
      try { await fsp.rename(source, target); }
      catch (error) {
        if (error.code === 'EXDEV') throw new Error('这个位置在别的磁盘卷上，无法直接送进废纸篓（不做危险的复制+删除）。请手动处理：' + source);
        throw error;
      }
      /* Linux 的 XDG 废纸篓必须同时写 info/*.trashinfo，否则文件管理器里还原不了。 */
      for (const file of (plan.files || [])) {
        try {
          await fsp.mkdir(path.dirname(file.path), { recursive: true });
          await fsp.writeFile(file.path, String(file.content || ''), 'utf8');
        } catch (_) { /* 写不了 info 不影响文件已经进了废纸篓 */ }
      }
      done.push({ from: source, to: target, kind: kindOf(info) });
    }
    record('trash', { count: done.length, items: done.slice(0, 10) });
    const trashLabel = HOST.isMac ? trashDir : HOST.isWin ? '系统回收站' : (HOST.trashPlan(HOME).trashRoot || trashDir);
    return { ok: true, items: done, count: done.length, trash: trashLabel };
  }

  /* 永久删除：必须显式确认，且服务端再拦一道受保护路径。符号链接只删链接本身。 */
  async function purge(body) {
    if (String(body.confirm || '') !== '永久删除') throw new Error('永久删除需要在请求里显式确认');
    const list = Array.isArray(body.paths) ? body.paths : [body.path];
    const done = [];
    for (const item of list) {
      const source = assertMutable(item, '路径', { destructive: true });
      const info = await fsp.lstat(source).catch(() => null);
      if (!info) { done.push({ path: source, skipped: '不存在' }); continue; }
      if (info.isSymbolicLink() || info.isFile()) await fsp.unlink(source);
      else await fsp.rm(source, { recursive: true, force: false });
      done.push({ path: source });
    }
    record('purge', { count: done.length, items: done.slice(0, 10) });
    return { ok: true, items: done, count: done.length };
  }

  async function writeText(body) {
    const target = assertMutable(body.path, '路径', { destructive: true });
    if (typeof body.text !== 'string') throw new Error('缺少要写入的内容');
    if (Buffer.byteLength(body.text, 'utf8') > TEXT_MAX) throw new Error('内容过大，超出面板可保存的上限');
    const info = await fsp.lstat(target).catch(() => null);
    if (info && !info.isFile()) throw new Error('这不是普通文件，拒绝写入');
    await fsp.writeFile(target, body.text, 'utf8');
    record('write', { path: target, bytes: Buffer.byteLength(body.text, 'utf8') });
    return { ok: true, path: target, bytes: Buffer.byteLength(body.text, 'utf8') };
  }

  async function upload(req, params) {
    if (!trustedOrigin(req)) throw new Error('来源不受信任');
    const dir = assertMutable(params.get('path'), '目标目录');
    const name = assertChildName(decodeURIComponent(params.get('name') || ''));
    const info = await fsp.lstat(dir).catch(() => null);
    if (!info || !info.isDirectory()) throw new Error('目标目录不存在：' + dir);
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > UPLOAD_MAX) throw new Error('文件太大，超出面板上传上限（512MB）');
    const target = await uniquePath(dir, name);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(target);
      let written = 0;
      req.on('data', (chunk) => {
        written += chunk.length;
        if (written > UPLOAD_MAX) { out.destroy(); req.destroy(); reject(new Error('文件太大，超出面板上传上限')); }
      });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    });
    const stat = await fsp.lstat(target).catch(() => ({ size: 0 }));
    record('upload', { path: target, bytes: Number(stat.size) || 0 });
    return { ok: true, path: target, bytes: Number(stat.size) || 0 };
  }

  /* 回收站视图。
     macOS 隐私保护不允许列 ~/.Trash 目录（EPERM），但允许按已知路径 lstat 与改名，
     所以列表以本面板自己的删除记录为准：每条都能显示原位置并能一键还原；
     如果哪天用户给了完全磁盘访问权限、目录能列了，就把其它来源的项目也补进来（标为不可还原）。 */
  async function trashList() {
    const trashDir = path.join(HOME, '.Trash');
    const known = new Map();
    for (const item of operations) {
      if (item.type !== 'trash' || !Array.isArray(item.items)) continue;
      for (const one of item.items) {
        if (one && one.to && !known.has(one.to)) known.set(one.to, { original: one.from || '', at: item.at });
      }
    }
    let scanned = [];
    let scanError = '';
    try { scanned = await fsp.readdir(trashDir, { withFileTypes: true }); }
    catch (error) {
      scanError = error.code === 'EPERM'
        ? 'macOS 隐私保护不允许读取废纸篓目录，所以这里只列本面板删除过的项目；其它项目请在「访达 → 废纸篓」里查看'
        : '读不到废纸篓目录（' + (error.code || error.message) + '）';
    }
    const paths = new Set(known.keys());
    for (const dirent of scanned) paths.add(path.join(trashDir, dirent.name));
    const items = (await mapLimit([...paths], 32, async (full) => {
      const info = await fsp.lstat(full).catch(() => null);
      if (!info) return null;                       // 已被系统或用户清空
      const origin = known.get(full) || null;
      const originalDir = origin && origin.original ? path.dirname(origin.original) : '';
      const dirOk = !!originalDir && fs.existsSync(originalDir);
      return {
        name: path.basename(full), path: full, kind: kindOf(info),
        size: Number(info.size) || 0, mtime: Math.round(info.mtimeMs || 0),
        original: origin ? origin.original : '',
        trashedAt: origin ? origin.at : 0,
        tracked: !!origin,
        restorable: !!(origin && origin.original && dirOk),
        reason: !origin ? '不是通过本面板删除的，无法还原到原位置' : (dirOk ? '' : '原目录已不存在，需要指定新的目标目录'),
      };
    })).filter(Boolean);
    items.sort((a, b) => b.mtime - a.mtime);
    return {
      ok: true, path: trashDir, items, total: items.length,
      restorable: items.filter((item) => item.restorable).length,
      tracked: items.filter((item) => item.tracked).length,
      scannedCount: scanned.length, canScan: !scanError, scanError,
    };
  }

  /* 还原：只接受位于 ~/.Trash 内的路径，原位置从日志取，重名自动让路。 */
  async function restore(body) {
    const source = assertPath(body.path, '路径');
    const trashDir = path.join(HOME, '.Trash');
    if (path.dirname(source) !== trashDir) throw new Error('只能还原废纸篓里的项目：' + source);
    const origin = originOf(source);
    if (!origin || !origin.from) throw new Error('这个项目不是通过本面板删除的，日志里没有原位置。你可以用「移动」手动放回去');
    const targetDir = body.to ? assertPath(body.to, '目标目录') : path.dirname(origin.from);
    /* 还原等于「往目标目录里写」，目标本身必须先过安全校验，否则能借还原把文件塞回系统目录。 */
    assertMutable(path.join(targetDir, path.basename(origin.from)), '目标路径', { destructive: true, allowAppBundle: true });
    const info = await fsp.lstat(targetDir).catch(() => null);
    if (!info || !info.isDirectory()) throw new Error('原目录已不存在，请指定一个目标目录：' + targetDir);
    const target = await uniquePath(targetDir, path.basename(origin.from));
    try { await fsp.rename(source, target); }
    catch (error) {
      if (error.code === 'EXDEV') throw new Error('跨磁盘卷无法直接还原，请用「移动」（会走复制）');
      throw error;
    }
    record('restore', { from: source, to: target, original: origin.from });
    return { ok: true, path: target, original: origin.from };
  }

  /* 归类整理：把一堆散文件按类型或日期归进子目录。
     默认只「预演」——把将发生的每一步列出来，用户确认后才真的移动。
     只动文件不动目录、符号链接一律不碰、重名让路、整批结果逐项回报、全程记日志。 */
  const EXT_GROUPS = [
    ['图片', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'tiff', 'svg', 'ico', 'raw']],
    ['视频', ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'm4v']],
    ['音频', ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'aiff']],
    ['文档', ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'csv', 'pages', 'numbers', 'key', 'epub']],
    ['压缩包', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'iso']],
    ['代码', ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift', 'kt', 'sh', 'json', 'yml', 'yaml', 'toml', 'sql', 'html', 'css', 'scss']],
    ['安装包', ['pkg', 'app', 'exe', 'msi', 'deb', 'rpm', 'apk']],
  ];

  function extGroup(ext) {
    for (const [name, list] of EXT_GROUPS) if (list.includes(ext)) return name;
    return '其它';
  }

  async function organize(body) {
    const dryRun = body.dryRun !== false;          // 不传就当预演，绝不默认动手
    const mode = body.mode === 'date' ? 'date' : 'ext';
    const root = assertMutable(body.path, '目录', { destructive: !dryRun });
    const dirents = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
    const moves = [];
    const groups = new Map();
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue;
      if (!dirent.isFile()) continue;              // 只整理文件，目录一概不动
      const from = path.join(root, dirent.name);
      const stat = await fsp.lstat(from).catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      const ext = path.extname(dirent.name).slice(1).toLowerCase();
      let bucket;
      if (mode === 'date') {
        const when = new Date(stat.mtimeMs);
        bucket = when.getFullYear() + '-' + String(when.getMonth() + 1).padStart(2, '0');
      } else bucket = extGroup(ext);
      const parent = mode === 'date' ? '按月份' : '按类型';
      const to = path.join(root, parent, bucket, dirent.name);
      moves.push({ from, to, bucket, size: Number(stat.size) || 0, conflict: fs.existsSync(to) });
      const key = parent + '/' + bucket;
      const group = groups.get(key) || { name: key, count: 0, bytes: 0 };
      group.count += 1;
      group.bytes += Number(stat.size) || 0;
      groups.set(key, group);
    }
    const planned = moves.filter((move) => !move.conflict);
    const summary = {
      root, mode, total: moves.length, movable: planned.length,
      conflicts: moves.length - planned.length,
      groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes),
    };
    if (dryRun) return Object.assign({ ok: true, dryRun: true, moves }, summary);
    const results = [];
    for (const move of planned) {
      try {
        await fsp.mkdir(path.dirname(move.to), { recursive: true });
        await fsp.rename(move.from, move.to);
        results.push(Object.assign({}, move, { ok: true }));
      } catch (error) {
        results.push(Object.assign({}, move, { ok: false, error: String((error && error.message) || error) }));
      }
    }
    const moved = results.filter((item) => item.ok).length;
    record('organize', { root, mode, moved, failed: results.length - moved });
    return Object.assign({ ok: true, dryRun: false, moved, failed: results.length - moved, results }, summary);
  }

  /* 一个目录到底占多大：du -sk 走一趟，带 45 秒超时。
     目录的 lstat.size 只有几十字节，直接当体积显示是骗人的（也正是「数字不说所以呢」的反面教材），
     所以这里做成「按需计算」的入口，超时就如实说超时，绝不返回一个看起来很确定的假数字。 */
  async function measurePath(params) {
    const target = assertPath(params.get('path'), '路径');
    const info = await fsp.lstat(target).catch(() => null);
    if (!info) throw new Error('路径不存在：' + target);
    if (!info.isDirectory()) {
      return { ok: true, path: target, kind: 'file', bytes: Number(info.size) || 0, ms: 0 };
    }
    const started = Date.now();
    const measured = await runFile('du', ['-sk', target], 45000);   // 本模块的助手是 runFile，不是 exec
    const parsed = /^(\d+)/.exec(String(measured.stdout || '').trim());
    if (!parsed) {
      return {
        ok: true, path: target, kind: 'dir', bytes: null, timedOut: measured.ok === false,
        note: '统计失败或超过 45 秒被中断（可能目录过大或没有读取权限）',
        ms: Date.now() - started,
      };
    }
    return { ok: true, path: target, kind: 'dir', bytes: Number(parsed[1]) * 1024, timedOut: false, ms: Date.now() - started };
  }

  async function reveal(body) {
    const target = assertPath(body.path, '路径');
    if (!(await exists(target))) throw new Error('路径不存在：' + target);
    const revealSpec = HOST.commands.revealInFileManager(target);
    await runFile(revealSpec.file, revealSpec.args, 8000);
    return { ok: true, path: target };
  }

  async function openPath(body) {
    const target = assertPath(body.path, '路径');
    if (!(await exists(target))) throw new Error('路径不存在：' + target);
    const openSpec = HOST.commands.openExternal(target);
    await runFile(openSpec.file, openSpec.args, 8000);
    return { ok: true, path: target };
  }

  /* ------------------------------- 路由 ------------------------------- */

  /* ------------------------------ 全盘扫描 ------------------------------
   * 只读盘点：只做 readdir / lstat，不打开文件内容、不跟随软链、不写任何东西。
   * 保护区和敏感区默认跳过（想盘点系统目录得显式 includeSystem），并有条目数与
   * 时间双上限，绝不允许把磁盘扫到卡死。进度放在内存里，前端轮询 /files/scan。
   */
  const SCAN_SKIP_NAMES = new Set(['.Spotlight-V100', '.fseventsd', '.DocumentRevisions-V100', '.TemporaryItems', '.Trashes', '.vol', 'dev']);
  const SCAN_MAX_ENTRIES = 400000;
  const SCAN_BUDGET_MS = 180000;
  let scan = null;

  function scanSnapshot() {
    if (!scan) return { ok: true, scan: null };
    const top = (map, key, count) => [...map.entries()]
      .map(([name, value]) => ({ name, bytes: value.bytes, count: value.count }))
      .sort((a, b) => b.bytes - a.bytes).slice(0, count);
    return {
      ok: true,
      scan: {
        id: scan.id, status: scan.status, startedAt: scan.startedAt, endedAt: scan.endedAt,
        roots: scan.roots, includeSystem: scan.includeSystem,
        files: scan.files, dirs: scan.dirs, bytes: scan.bytes, entries: scan.entries,
        denied: scan.denied, skippedProtected: scan.skippedProtected, links: scan.links,
        maxEntries: scan.maxEntries, budgetMs: scan.budgetMs, stoppedEarly: scan.stoppedEarly,
        current: scan.current, error: scan.error || '',
        byExt: top(scan.byExt, 40),
        largest: scan.largest.slice(0, 120),
        topDirs: scan.topDirs.slice(0, 40),
      },
    };
  }

  function bumpTop(list, item, limit, key) {
    list.push(item);
    list.sort((a, b) => b[key] - a[key]);
    if (list.length > limit) list.length = limit;
  }

  async function runScan(options) {
    const roots = options.roots;
    const state = scan;
    const started = Date.now();
    const stack = roots.map((root) => ({ dir: root, depth: 0 }));
    while (stack.length && state.status === 'running') {
      if (state.entries >= state.maxEntries || Date.now() - started > state.budgetMs) {
        state.stoppedEarly = state.entries >= state.maxEntries ? '条目上限' : '时间上限';
        break;
      }
      const item = stack.pop();
      state.current = item.dir;
      let dirents;
      try { dirents = await fsp.readdir(item.dir, { withFileTypes: true }); }
      catch (_) { state.denied += 1; continue; }
      state.dirs += 1;
      let directBytes = 0;
      for (const dirent of dirents) {
        if (state.status !== 'running') break;
        state.entries += 1;
        if (state.entries >= state.maxEntries) break;
        const full = path.join(item.dir, dirent.name);
        if (dirent.isSymbolicLink()) { state.links += 1; continue; }
        if (dirent.isDirectory()) {
          if (SCAN_SKIP_NAMES.has(dirent.name)) continue;
          if (!state.includeSystem && protectedReason(realTarget(full))) { state.skippedProtected += 1; continue; }
          stack.push({ dir: full, depth: item.depth + 1 });
          continue;
        }
        if (!dirent.isFile()) continue;
        let stats;
        try { stats = await fsp.lstat(full); } catch (_) { state.denied += 1; continue; }
        const size = Number(stats.size) || 0;
        state.files += 1;
        state.bytes += size;
        directBytes += size;
        const ext = (path.extname(dirent.name).slice(1) || '无扩展名').toLowerCase().slice(0, 12);
        const bucket = state.byExt.get(ext) || { bytes: 0, count: 0 };
        bucket.bytes += size; bucket.count += 1;
        state.byExt.set(ext, bucket);
        if (size > 1024 * 1024) bumpTop(state.largest, { path: full, name: dirent.name, bytes: size, mtime: stats.mtimeMs }, 120, 'bytes');
      }
      if (directBytes > 0) bumpTop(state.topDirs, { path: item.dir, bytes: directBytes }, 40, 'bytes');
    }
    if (state.status === 'running') state.status = 'done';
    state.endedAt = Date.now();
    state.current = '';
    log('[files] 扫描 ' + state.status + '：' + state.files + ' 文件 / ' + state.dirs + ' 目录 / ' + Math.round(state.bytes / 1048576) + 'MB，用时 ' + (state.endedAt - state.startedAt) + 'ms' + (state.stoppedEarly ? '（' + state.stoppedEarly + '）' : ''));
    return state;
  }

  function startScan(body) {
    if (scan && scan.status === 'running') scan.status = 'cancelled';
    const raw = Array.isArray(body.roots) && body.roots.length ? body.roots : [HOME];
    const roots = [];
    for (const item of raw.slice(0, 12)) {
      const resolved = assertPath(item, '扫描根目录');
      let stats = null;
      try { stats = fs.statSync(resolved); } catch (_) { continue; }
      if (stats.isDirectory() && !roots.includes(resolved)) roots.push(resolved);
    }
    if (!roots.length) throw Object.assign(new Error('没有可扫描的目录'), { statusCode: 400 });
    const maxEntries = clampNumber(body.maxEntries, 1000, SCAN_MAX_ENTRIES, 150000);
    scan = {
      id: 's' + Date.now().toString(36), status: 'running',
      startedAt: Date.now(), endedAt: 0, roots,
      includeSystem: body.includeSystem === true,
      files: 0, dirs: 0, bytes: 0, entries: 0, denied: 0, skippedProtected: 0, links: 0,
      maxEntries, budgetMs: SCAN_BUDGET_MS, stoppedEarly: '', current: roots[0], error: '',
      byExt: new Map(), largest: [], topDirs: [],
    };
    runScan({ roots }).catch((error) => {
      if (scan) { scan.status = 'error'; scan.error = String((error && error.message) || error); scan.endedAt = Date.now(); }
    });
    return scanSnapshot();
  }

  async function handle(req, res, u, rest) {
    if (!rest.startsWith('/files')) return false;
    const method = (req.method || 'GET').toUpperCase();
    const route = rest.replace(/^\/files/, '') || '/';
    const params = u.searchParams;

    try {
      if (method === 'GET') {
        if (route === '/list') return sendJson(res, 200, await listDir(params)), true;
        if (route === '/stat') return sendJson(res, 200, await statPath(params)), true;
        if (route === '/text') return sendJson(res, 200, await readText(params)), true;
        if (route === '/raw') { await rawFile(req, res, params); return true; }
        if (route === '/search') return sendJson(res, 200, await search(params)), true;
        if (route === '/size') return sendJson(res, 200, await measurePath(params)), true;
        if (route === '/usage') return sendJson(res, 200, await usage(params)), true;
        if (route === '/large') return sendJson(res, 200, await largeFiles(params)), true;
        if (route === '/duplicates') return sendJson(res, 200, await duplicates(params)), true;
        if (route === '/ops') return sendJson(res, 200, { ok: true, operations: operations.slice(0, 80) }), true;
        if (route === '/trash') return sendJson(res, 200, await trashList()), true;
        if (route === '/scan') return sendJson(res, 200, scanSnapshot()), true;
        if (route === '/safety') return sendJson(res, 200, {
          ok: true,
          protectedPrefixes: PROTECTED_PREFIXES.slice(),
          sensitivePrefixes: SENSITIVE_PREFIXES.slice(),
          exemptPrefixes: EXEMPT_PREFIXES.slice(),
          protectedTop: [...PROTECTED_TOP],
          protectedHome: [...PROTECTED_HOME],
          home: HOME,
          dataRoot,
          opsCount: operations.length,
        }), true;
        if (route === '/pick') {
          /* 目录选择用系统面板（macOS 的 choose folder），失败就退回手输路径。 */
          if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: '来源不受信任' }), true;
          const picked = HOST.isMac
              ? await runFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择目录")'], 120000)
              : HOST.isWin
                ? await runFile('powershell.exe', ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog() -eq "OK"){[Console]::Out.Write($f.SelectedPath)}'], 120000)
                : await runFile('zenity', ['--file-selection', '--directory', '--title=选择目录'], 120000);
          const value = String(picked.stdout || '').trim();
          if (!picked.ok || !value) return sendJson(res, 200, { ok: false, error: '已取消选择' }), true;
          return sendJson(res, 200, { ok: true, path: value.replace(/\/$/, '') || '/' }), true;
        }
        return sendJson(res, 404, { ok: false, error: '未知的文件接口：' + route }), true;
      }

      if (method === 'POST') {
        if (route === '/upload') return sendJson(res, 200, await upload(req, params)), true;
        const body = await readJson(req);
        if (route === '/mkdir') return sendJson(res, 200, await mkdir(body)), true;
        if (route === '/rename') return sendJson(res, 200, await rename(body)), true;
        if (route === '/move') return sendJson(res, 200, await move(body)), true;
        if (route === '/trash') return sendJson(res, 200, await trash(body)), true;
        if (route === '/restore') return sendJson(res, 200, await restore(body)), true;
        if (route === '/purge') return sendJson(res, 200, await purge(body)), true;
        if (route === '/write') return sendJson(res, 200, await writeText(body)), true;
        if (route === '/scan') return sendJson(res, 200, startScan(body)), true;
        if (route === '/scan/cancel') {
          if (scan && scan.status === 'running') { scan.status = 'cancelled'; scan.endedAt = Date.now(); }
          return sendJson(res, 200, { ok: true, scan: scan && scan.status }), true;
        }
        if (route === '/organize') return sendJson(res, 200, await organize(body)), true;
        if (route === '/reveal') return sendJson(res, 200, await reveal(body)), true;
        if (route === '/open') return sendJson(res, 200, await openPath(body)), true;
        return sendJson(res, 404, { ok: false, error: '未知的文件接口：' + route }), true;
      }

      sendJson(res, 405, { ok: false, error: '不支持的方法' });
      return true;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String((error && error.message) || error) });
      return true;
    }
  }

  return {
    handle,
    operations,
    listDir, statPath, readText, search, usage, largeFiles, duplicates, trashList,
    measurePath,
    mkdir, rename, move, trash, restore, purge, writeText, reveal, openPath, organize,
    _internal: { assertMutable, assertChildName, uniquePath, matchQuery, globToRegExp, kindOf, trustedOrigin, PROTECTED_TOP },
  };
}

module.exports = { createFileManager };
