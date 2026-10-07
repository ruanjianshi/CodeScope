'use strict';
/**
 * 文件全景核心（File Atlas core）：把整机文件按"能不能动"分级，并产出可清理预演。
 *
 * 安全不变量（本文件自己保证，不依赖调用方自觉）：
 *   planCleanup() 的输出里永远不出现 L0/L1/L4，以及任何受保护路径
 *   （系统目录、~/.ssh、~/.gnupg、~/.codescope、iCloud 同步区、用户笔记库 markdown-vault、
 *     *sync-conflict* 副本、.git 元数据）。扫描有界：maxEntries/maxDepth/deadlineMs 是硬约束。
 *   本模块只"看"和"预演"，绝不删除或移动任何文件。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let PLATFORM_IDS = ['darwin', 'win32', 'linux'];
try {
  const platform = require('./platform');
  if (platform && Array.isArray(platform.PLATFORM_IDS) && platform.PLATFORM_IDS.length) PLATFORM_IDS = platform.PLATFORM_IDS.slice();
} catch (_) { /* 不可用时用内置三项，与仓库约定一致 */ }

/* 解释说明目录（可选依赖）：给出"这是什么/能不能动/动了会怎样"与文件类型分类。 */
let catalog = null;
try { catalog = require('./file-atlas-catalog.js'); } catch (_) { catalog = null; }
function kindOfSafe(value) {
  try { return catalog && catalog.kindOf ? catalog.kindOf(value) : '其它'; } catch (_) { return '其它'; }
}
function explainSafe(value, options) {
  try { return catalog && catalog.explainPath ? catalog.explainPath(value, options) : null; } catch (_) { return null; }
}

const TIER_IDS = ['L0-system', 'L1-app', 'L2-cache', 'L3-temp', 'L4-user'];
const TIER_META = {
  'L0-system': { id: 'L0-system', label: '系统级', writable: false, deleteRisk: 'none', note: '系统本体，只读，永不参与清理' },
  'L1-app': { id: 'L1-app', label: '应用级', writable: false, deleteRisk: 'confirm', note: '应用与守护数据，默认只读，需人工二次确认' },
  'L2-cache': { id: 'L2-cache', label: '可再生缓存', writable: true, deleteRisk: 'preview-only', note: '缓存/依赖/构建产物，可再生，可进预演' },
  'L3-temp': { id: 'L3-temp', label: '临时与垃圾', writable: true, deleteRisk: 'preview-only', note: '临时文件、日志、下载残留，可进预演' },
  'L4-user': { id: 'L4-user', label: '用户内容', writable: false, deleteRisk: 'none', note: '文档/代码/笔记/媒体，永不自动删，只归类' },
};
const SCAN_DEFAULTS = { maxEntries: 20000, maxDepth: 4, deadlineMs: 1500, minBytes: 0, topLimit: 20, followSymlinks: false };
const ALWAYS_PROTECTED_SEGMENTS = ['markdown-vault'];

const toSlash = (value) => String(value == null ? '' : value).replace(/\\/g, '/');

function normalizePath(value, platform, home) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let out = toSlash(value).trim();
  if (out === '~') out = home;
  else if (out.startsWith('~/')) out = home + out.slice(1);
  out = out.replace(/\/{2,}/g, '/');
  const trailing = out.length > 1 && out.endsWith('/');
  out = path.posix.normalize(out);
  if (trailing && !out.endsWith('/')) out += '/';
  return platform === 'win32' ? out.toLowerCase() : out;
}
const keyOf = (value, platform, home) => { const n = normalizePath(value, platform, home); return n.endsWith('/') ? n.slice(0, -1) : n; };
function isInside(candidate, root) {
  const c = (candidate.endsWith('/') ? candidate.slice(0, -1) : candidate).toLowerCase();
  const r = (root.endsWith('/') ? root.slice(0, -1) : root).toLowerCase();
  return Boolean(c && r) && (c === r || c.startsWith(r + '/'));
}
const segmentsOf = (value) => toSlash(value).split('/').filter(Boolean);

function protectedPrefixes(platform, home) {
  const byPlatform = {
    darwin: ['/System', '/usr', '/bin', '/sbin', '/etc', '/private', '/cores', '/dev', '/Library', '/Applications'],
    win32: ['c:/windows', 'c:/program files', 'c:/program files (x86)'],
    linux: ['/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/proc', '/sys', '/dev', '/var/lib'],
  };
  const common = [home + '/.ssh', home + '/.gnupg', home + '/.codescope', home + '/Library/Keychains', home + '/Library/Mobile Documents'];
  return (byPlatform[platform] || byPlatform.linux).concat(common).map((item) => keyOf(item, platform, home)).filter(Boolean);
}

function protectionReason(raw, platform, home) {
  const key = keyOf(raw, platform, home);
  if (!key) return '';
  for (const root of protectedPrefixes(platform, home)) if (isInside(key, root)) return '受保护目录：' + root;
  const segments = segmentsOf(key);
  for (const protect of ALWAYS_PROTECTED_SEGMENTS) if (segments.includes(protect)) return '用户笔记库（' + protect + '）不参与自动清理';
  if (/sync-conflict/i.test(key)) return '同步冲突副本属于用户数据，不自动清理';
  if (segments.includes('.git')) return 'Git 元数据不参与清理';
  return '';
}

const extOf = (key) => { const base = key.slice(key.lastIndexOf('/') + 1); const dot = base.lastIndexOf('.'); return dot > 0 ? base.slice(dot).toLowerCase() : ''; };

const L0_ROOTS = {
  darwin: ['/System', '/usr', '/bin', '/sbin', '/etc', '/private', '/cores', '/dev', '/Library'],
  win32: ['c:/windows'],
  linux: ['/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/proc', '/sys', '/dev'],
};
const L1_ROOTS = {
  darwin: ['/Applications'],
  win32: ['c:/program files', 'c:/program files (x86)', 'c:/programdata'],
  linux: ['/opt', '/snap', '/srv'],
};
const CACHE_SEGMENTS = new Set(['node_modules', '.cache', 'caches', 'deriveddata', '.npm', '.gradle', '.cargo', '.next', '.turbo']);
const TEMP_EXTS = new Set(['.tmp', '.temp', '.log', '.dmp', '.crdownload', '.download', '.part', '.partial', '.swp', '.orig', '.bak']);
const TEMP_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

function makeClassifier({ platform, home }) {
  // 匹配时统一小写（Linux 区分大小写，保持原样）；展示仍用调用方传入的原始路径。
  const k = (value) => { const key = keyOf(value, platform, home); return platform === 'linux' ? key : key.toLowerCase(); };
  const homeKey = k(home);
  function classifyPath(value) {
    const key = k(value);
    const raw = typeof value === 'string' ? value : '';
    if (!key || !raw.trim()) return { tier: 'L4-user', reason: '空路径按用户内容处理', writable: false, deleteRisk: 'none', protectedReason: '' };
    const protect = protectionReason(key, platform, home);
    const wrap = (tier, reason) => {
      const meta = TIER_META[tier];
      return { tier, reason, writable: meta.writable && !protect, deleteRisk: protect ? 'none' : meta.deleteRisk, protectedReason: protect };
    };
    // 临时目录先判（macOS 的 /private/var/tmp 否则会被 /private 吞成 L0）；Windows 保持"系统优先"语义。
    if (platform !== 'win32') {
      for (const root of ['/tmp', '/private/tmp', '/private/var/tmp', '/var/tmp']) if (isInside(key, root)) return wrap('L3-temp', '临时目录：' + root);
    }
    for (const root of (L0_ROOTS[platform] || L0_ROOTS.linux)) if (isInside(key, root)) return wrap('L0-system', '系统本体：' + root);
    for (const root of (L1_ROOTS[platform] || L1_ROOTS.linux)) if (isInside(key, root)) return wrap('L1-app', '应用或服务：' + root);
    const underHome = key === homeKey || key.startsWith(homeKey + '/');
    const rel = underHome ? key.slice(homeKey.length) : '';
    if (underHome) {
      for (const seg of ['/applications', '/library/application support', '/appdata/roaming', '/appdata/local']) {
        if (rel === seg || rel.startsWith(seg + '/')) return wrap('L1-app', '应用数据：~' + rel.split('/').slice(0, 3).join('/'));
      }
    }
    const tempRoots = platform === 'win32'
      ? [k(process.env.TEMP || home + '/AppData/Local/Temp'), 'c:/windows/temp']
      : ['/tmp', '/private/tmp', '/private/var/tmp', '/var/tmp'];
    for (const root of tempRoots) if (root && isInside(key, root)) return wrap('L3-temp', '临时目录：' + root);
    const base = key.slice(key.lastIndexOf('/') + 1);
    if (TEMP_NAMES.has(base)) return wrap('L3-temp', '系统垃圾文件：' + base);
    if (TEMP_EXTS.has(extOf(key))) return wrap('L3-temp', '临时/日志文件：' + extOf(key));
    if (underHome && ['/library/logs', '/.trash'].some((s) => rel === s || rel.startsWith(s + '/'))) return wrap('L3-temp', '日志或废纸篓：~' + rel);
    const cacheRoots = platform === 'win32'
      ? [k(home + '/AppData/Local'), k(home + '/AppData/LocalLow')]
      : platform === 'darwin'
        ? [k(home + '/Library/Caches'), k(home + '/Library/Developer/Xcode/DerivedData'), k(home + '/.npm'), k(home + '/.cache'), '/var/cache']
        : [k(home + '/.cache'), '/var/cache'];
    for (const root of cacheRoots) if (root && isInside(key, root)) return wrap('L2-cache', '可再生缓存：' + root);
    for (const seg of segmentsOf(key)) if (CACHE_SEGMENTS.has(platform === 'win32' ? seg.toLowerCase() : seg)) return wrap('L2-cache', '可再生目录段：' + seg + '/');
    return wrap('L4-user', underHome ? '用户内容：~' + (rel.split('/').slice(0, 3).join('/') || '/') : '用户内容');
  }
  return { classifyPath };
}

function bytesLabel(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(value) || 0, index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return (index === 0 ? String(Math.round(size)) : size.toFixed(size >= 100 ? 0 : 1)) + ' ' + units[index];
}

/** 有界扫描：maxEntries / maxDepth / deadlineMs 均为硬上限，超限即停并标记 truncated。 */
function scan(options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || os.homedir();
  const classifier = options.classifyPath ? { classifyPath: options.classifyPath } : makeClassifier({ platform, home });
  const cfg = Object.assign({}, SCAN_DEFAULTS, options);
  const roots = (Array.isArray(cfg.roots) ? cfg.roots : [home]).filter((item) => typeof item === 'string' && item.trim());
  const startedAt = Date.now();
  const tiers = {};
  for (const id of TIER_IDS) tiers[id] = { id, label: TIER_META[id].label, files: 0, bytes: 0, deleteRisk: TIER_META[id].deleteRisk };
  const topFiles = [], errors = [];
  let entries = 0, files = 0, bytes = 0, truncated = false, stoppedBy = '';
  const stack = roots.map((root) => ({ dir: keyOf(root, platform, home), depth: 0 }));
  const seen = new Set();
  while (stack.length) {
    if (entries >= cfg.maxEntries) { truncated = true; stoppedBy = 'maxEntries'; break; }
    if (Date.now() - startedAt > cfg.deadlineMs) { truncated = true; stoppedBy = 'deadlineMs'; break; }
    if (cfg.signal && cfg.signal.aborted) { truncated = true; stoppedBy = 'aborted'; break; }
    const current = stack.pop();
    if (!current.dir || seen.has(current.dir) || current.depth > cfg.maxDepth) continue;
    seen.add(current.dir);
    let listing;
    try { listing = fs.readdirSync(current.dir, { withFileTypes: true }); }
    catch (error) { errors.push({ path: current.dir, message: String((error && error.code) || (error && error.message) || error) }); continue; }
    for (const entry of listing) {
      if (entries >= cfg.maxEntries) { truncated = true; stoppedBy = 'maxEntries'; break; }
      const full = current.dir + '/' + entry.name;
      entries += 1;
      /* 关键：时限必须**在每个条目**上检查。只在目录之间检查的话，遇到一个几万文件的大目录
         （~/Library/Caches 这类）会一路读到底，把面板同步阻塞十几秒。每 512 项查一次，开销可忽略。 */
      if ((entries & 0x1ff) === 0 && Date.now() - startedAt > cfg.deadlineMs) { truncated = true; stoppedBy = 'deadlineMs'; break; }
      let stat = null;
      try { stat = fs.lstatSync(full); } catch (_) { continue; }
      if (stat.isSymbolicLink() && !cfg.followSymlinks) continue;
      if (stat.isDirectory()) { stack.push({ dir: full, depth: current.depth + 1 }); continue; }
      if (!stat.isFile()) continue;
      const size = Number(stat.size) || 0;
      if (size < cfg.minBytes) continue;
      const verdict = classifier.classifyPath(full);
      files += 1; bytes += size;
      const bucket = tiers[verdict.tier] || tiers['L4-user'];
      bucket.files += 1; bucket.bytes += size;
      topFiles.push({ path: full, bytes: size, tier: verdict.tier, mtime: Number(stat.mtimeMs) || 0 });
    }
  }
  topFiles.sort((a, b) => b.bytes - a.bytes);
  const limit = Math.max(1, Number(cfg.topLimit) || 20);
  // 清理预演需要看到**全部** L2/L3 文件，不能只看"大文件 Top20"（那会把可回收量严重低估）。
  const candidateFiles = topFiles.filter((item) => item.tier === 'L2-cache' || item.tier === 'L3-temp');
  const candidateLimit = Math.max(1, Number(cfg.candidateLimit) || 3000);
  const candidateBytes = candidateFiles.reduce((sum, item) => sum + item.bytes, 0);
  return {
    roots, platform, home,
    generatedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    stats: { entries, files, bytes, bytesLabel: bytesLabel(bytes), truncated, stoppedBy, maxEntries: cfg.maxEntries, maxDepth: cfg.maxDepth },
    tiers,
    topFiles: topFiles.slice(0, limit),
    candidates: candidateFiles.slice(0, candidateLimit),
    candidateStats: { files: candidateFiles.length, bytes: candidateBytes, bytesLabel: bytesLabel(candidateBytes), capped: candidateFiles.length > candidateLimit, limit: candidateLimit },
    errors: errors.slice(0, 20),
  };
}

/** 清理预演：只产出 L2/L3，且逐条再过一遍安全判定（纵深防御）。绝不执行删除。 */
function planCleanup(input, options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || os.homedir();
  const classifier = makeClassifier({ platform, home });
  // 优先用 scan 给出的全量候选集合；没有就退回 topFiles（两者都只含文件记录）。
  const entries = Array.isArray(input)
    ? input
    : (input && Array.isArray(input.candidates) ? input.candidates : (input && Array.isArray(input.topFiles) ? input.topFiles : []));
  const items = [];
  const skipped = { protectedPath: 0, notCleanableTier: 0, invalid: 0 };
  let bytes = 0;
  for (const entry of entries) {
    const target = entry && typeof entry.path === 'string' ? entry.path : '';
    if (!target) { skipped.invalid += 1; continue; }
    const verdict = classifier.classifyPath(target);
    const cleanable = verdict.tier === 'L2-cache' || verdict.tier === 'L3-temp';
    const safe = verdict.deleteRisk === 'preview-only' && !verdict.protectedReason;
    if (!cleanable) { skipped.notCleanableTier += 1; continue; }
    if (!safe) { skipped.protectedPath += 1; continue; }
    const size = Number(entry && entry.bytes) || 0;
    bytes += size;
    items.push({ path: target, bytes: size, bytesLabel: bytesLabel(size), tier: verdict.tier, reason: verdict.reason });
  }
  items.sort((a, b) => b.bytes - a.bytes);
  return {
    dryRun: true, generatedAt: Date.now(), platform, home, items,
    count: items.length, bytes, bytesLabel: bytesLabel(bytes), skipped,
    note: '预演结果，未执行任何删除；L0/L1/L4 与受保护路径永不出现。',
  };
}

function createFileAtlas(options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || os.homedir();
  const classifier = makeClassifier({ platform, home });
  return {
    platform, home,
    classifyPath: (value) => classifier.classifyPath(value),
    scan: (scanOptions = {}) => scan(Object.assign({}, scanOptions, { platform, home, classifyPath: classifier.classifyPath })),
    planCleanup: (input, planOptions = {}) => planCleanup(input, Object.assign({}, planOptions, { platform, home })),
    protectedPrefixes: () => protectedPrefixes(platform, home),
  };
}

module.exports = {
  createFileAtlas,
  classifyPath: (value, options = {}) => makeClassifier({ platform: options.platform || process.platform, home: options.home || os.homedir() }).classifyPath(value),
  scan,
  planCleanup,
  TIER_IDS,
  TIER_META,
  SCAN_DEFAULTS,
  PLATFORM_IDS,
  protectedPrefixes,
  bytesLabel,
  _internal: { normalizePath, keyOf, isInside, protectionReason, makeClassifier },
};
