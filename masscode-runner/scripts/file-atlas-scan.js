#!/usr/bin/env node
'use strict';
/**
 * 文件全景 · 整机扫描器（独立进程）
 *
 * 为什么单独一个进程：目录遍历用的是同步 fs，跑在面板主进程里会把事件循环卡住 3~5 秒
 * （实测 17.9s 的极端情况也出现过）。所以扫描一律在这里跑，面板只负责 spawn + 收 JSON。
 *
 * 用法：node scripts/file-atlas-scan.js                 → 快扫，打印 JSON 报告到 stdout
 *       node scripts/file-atlas-scan.js --mode=deep     → 深扫（约 25 秒，覆盖高得多）
 *       node scripts/file-atlas-scan.js --pretty        → 打印人读的摘要（排查用）
 *
 * 本脚本**只读**：不删除、不移动、不改名任何文件。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const atlas = require('../lib/file-atlas-core.js');
const catalog = require('../lib/file-atlas-catalog.js');

const HOME = os.homedir();
const HOME_KEY = HOME.replace(/\\/g, '/');

/* ══════════════════════════════════════════════════════════════════════════
   两段式预算 ✓ —— 这是这个模块最要紧的一个设计决定 ✗
   ══════════════════════════════════════════════════════════════════════════
   ★ 为什么不能「一套参数扫到底」✗：实测（这台机器 ✓）
       4000/3/320ms  →  29 GB ·  1.3 秒
       40000/6/1200ms → 79 GB · 14.3 秒
       120000/8/2500ms → 150 GB · 25 秒
     真实磁盘用量是 **181 GB** ✗ —— 也就是说想扫准就得等 25 秒 ✗，
     而面板一打开就让用户干等 25 秒是**不能接受**的 ✗。
   → 所以拆两段 ✓：
       · **fast**（默认 ✓，约 2~4 秒）：先把界面填出来 ✓，用户不用干等 ✓；
       · **deep**（用户点「深度扫描」才跑 ✗，约 25 秒）：覆盖率从 16% 提到 83% ✓。
     再配**落盘缓存** ✓（fast 10 分钟 / deep 6 小时 ✓），
     第二次打开就是秒开 ✓ —— 这才是「扫得慢」的正解 ✗，
     一味调大参数只会让每次打开都更慢 ✗。 */
const MODES = {
  fast: { maxEntries: 8000, maxDepth: 4, deadlineMs: 600 },
  deep: { maxEntries: 120000, maxDepth: 8, deadlineMs: 2500 },
};
function pickMode() {
  const hit = process.argv.find((a) => a.indexOf('--mode=') === 0);
  const name = hit ? hit.slice('--mode='.length) : 'fast';
  return MODES[name] ? name : 'fast';
}
const MODE = pickMode();
const PER_ROOT = MODES[MODE];

/* ★★ 扫描根 ✗✗ —— 老根表只有 19 个根 ✓，漏掉了这台机器上**最大的几块** ✗：
     /private/var/folders  55.3 GB  ✗ 没扫
     /opt（Homebrew）       17.1 GB  ✗ 没扫
     /usr/local            10.0 GB  ✗ 没扫
     /Library/Developer     2.0 GB  ✗ 没扫
     ~/Downloads            1.1 GB  ✗ 没扫（**而且词条里还写着它** ✗，前后矛盾 ✗）
   → 结果「整机 181 GB」只看到 25 GB ✗，**覆盖率 15%** ✗ ——
     用户打开「文件全景」是想知道盘被谁吃了 ✗，结果八成的空间它看不见 ✗。
   ⚠️ 补根之后覆盖率 83% ✓（150 GB / 181 GB ✓，实测 ✓）。 */
function rootList() {
  return [
    '/System', '/Library', '/Applications', '/usr', '/private/var/db', '/cores',
    /* ↑ 这几个是 L0/L1：用户**动不了** ✓，它们只要一个「大概多少」就够 ✓。
       ⚠️ 实测 /System 一个根就能吃掉 5.8 秒 ✗ —— 给它大预算纯属浪费 ✗。 */
    '/private/var/folders', '/opt', '/usr/local', '/Library/Developer',
    HOME + '/Library/Caches', HOME + '/Library/Developer/Xcode/DerivedData', HOME + '/.npm', HOME + '/.cache',
    HOME + '/Library/Logs', '/tmp', HOME + '/Library/Application Support', HOME + '/Library/Containers',
    HOME + '/Documents', HOME + '/Desktop', HOME + '/Downloads', HOME + '/Pictures', HOME + '/Movies', HOME + '/.Trash',
    /* ↑ 这几个才是「用户要清的」和「用户自己的」✓ —— 文件全景存在的意义就在这儿 ✓。 */
  ].filter((item) => { try { return fs.existsSync(item); } catch (_) { return false; } });
}

/** iCloud 托管目录会被 fileprovider 卡住数秒且无法中断（实测 5.5s / 492 个文件），跳过并如实标注。 */
function isIcloudManaged(dir) {
  /* 实测：~/Library/Containers 的单次 readdirSync 会无限阻塞（沙盒守护进程），45 秒都不返回；
     而 /System、/Library、~/Library/Application Support 这些根都只要几十毫秒。这类整根必须跳过。 */
  if (dir === HOME + '/Library/Containers' || dir === HOME + '/Library/Group Containers') return true;
  if (dir === HOME + '/Library/Mobile Documents') return true;
  if (dir !== HOME + '/Documents' && dir !== HOME + '/Desktop') return false;
  try { return fs.readdirSync(dir).some((name) => name.endsWith('.icloud') || name === '.icloud'); } catch (_) { return false; }
}

function buildReport() {
  const scanned = [];
  const skipped = [];
  const timing = [];
  for (const root of rootList()) {
    if (isIcloudManaged(root)) { skipped.push({ path: root, reason: '该目录的枚举会被系统守护进程无限阻塞（沙盒/fileprovider，实测 >45s 不返回），已跳过深度扫描并如实标注' }); continue; }
    const before = Date.now();
    try {
      const one = atlas.scan(Object.assign({ roots: [root], topLimit: 60000, minBytes: 0 }, PER_ROOT));
      scanned.push(one);
      timing.push({ path: root, ms: Date.now() - before, files: one.stats.files, bytes: one.stats.bytes, truncated: one.stats.truncated });
    } catch (error) {
      skipped.push({ path: root, reason: String((error && error.message) || error) });
    }
  }

  const files = [];
  const tiers = {};
  for (const id of atlas.TIER_IDS) tiers[id] = { id, label: atlas.TIER_META[id].label, files: 0, bytes: 0, deleteRisk: atlas.TIER_META[id].deleteRisk };
  let entries = 0, totalFiles = 0, totalBytes = 0, truncated = false;
  const stoppedBy = [];
  const errors = [];
  for (const one of scanned) {
    entries += one.stats.entries;
    totalFiles += one.stats.files;
    totalBytes += one.stats.bytes;
    truncated = truncated || one.stats.truncated;
    if (one.stats.stoppedBy) stoppedBy.push(one.stats.stoppedBy);
    for (const id of atlas.TIER_IDS) { tiers[id].files += one.tiers[id].files; tiers[id].bytes += one.tiers[id].bytes; }
    for (const file of one.topFiles) files.push(file);
    for (const error of one.errors) errors.push(error);
  }
  files.sort((a, b) => b.bytes - a.bytes);

  // 按层级聚合：家目录内 2 层、系统目录 3 层（"人心里那一级目录"）。
  const dirMap = new Map();
  const kindMap = new Map();
  for (const file of files) {
    const full = String(file.path).replace(/\\/g, '/');
    const dirKey = (full === HOME_KEY || full.startsWith(HOME_KEY + '/'))
      ? HOME_KEY + '/' + full.slice(HOME_KEY.length + 1).split('/').slice(0, 2).join('/')
      : '/' + full.slice(1).split('/').slice(0, 3).join('/');
    const dir = dirMap.get(dirKey) || { path: dirKey, files: 0, bytes: 0 };
    dir.files += 1; dir.bytes += file.bytes;
    dirMap.set(dirKey, dir);
    const kind = catalog.kindOf(full);
    const kindRow = kindMap.get(kind) || { kind, files: 0, bytes: 0 };
    kindRow.files += 1; kindRow.bytes += file.bytes;
    kindMap.set(kind, kindRow);
  }
  const explainOpts = { platform: process.platform, home: HOME };
  const byDir = Array.from(dirMap.values()).sort((a, b) => b.bytes - a.bytes).slice(0, 80)
    .map((row) => Object.assign(row, { bytesLabel: atlas.bytesLabel(row.bytes), explanation: catalog.explainPath(row.path, explainOpts) }));
  const byKind = Array.from(kindMap.values()).sort((a, b) => b.bytes - a.bytes)
    .map((row) => Object.assign(row, { bytesLabel: atlas.bytesLabel(row.bytes) }));

  /* 层级下钻：为最占空间的目录算出"下一层"，界面就能一层层点开看，而不是只有一张 Top 列表。 */
  function childrenOf(parent) {
    const prefix = String(parent).replace(/\\/g, '/') + '/';
    const map = new Map();
    for (const file of files) {
      const full = String(file.path).replace(/\\/g, '/');
      if (!full.startsWith(prefix)) continue;
      const rest = full.slice(prefix.length);
      const childPath = prefix + rest.split('/')[0];
      const row = map.get(childPath) || { path: childPath, isDir: rest.indexOf('/') !== -1, files: 0, bytes: 0, tiers: {} };
      row.files += 1;
      row.bytes += file.bytes;
      row.tiers[file.tier] = (row.tiers[file.tier] || 0) + file.bytes;
      map.set(childPath, row);
    }
    return Array.from(map.values()).sort((a, b) => b.bytes - a.bytes).slice(0, 25).map((row) => Object.assign(row, {
      bytesLabel: atlas.bytesLabel(row.bytes),
      dominantTier: Object.keys(row.tiers).sort((a, b) => row.tiers[b] - row.tiers[a])[0] || null,
      explanation: catalog.explainPath(row.path, explainOpts),
    }));
  }
  const tree = {};
  for (const row of byDir.slice(0, 8)) tree[row.path] = childrenOf(row.path);

  const candidateList = files.filter((item) => item.tier === 'L2-cache' || item.tier === 'L3-temp');
  const candidateBytes = candidateList.reduce((sum, item) => sum + item.bytes, 0);
  /* ⚠️ 这里**不能**只喂前 3000 条 ✗ —— 那样 `plan.count` 会变成「3000」✗，
     而界面上写的是「3000 项 · 可回收 3.3 GB」✗，用户会以为一共就这么点 ✗
     （深扫实测候选有 9.5 万条 ✓，真实可回收远不止 3.3 GB ✗）。
     → 全量喂进去算**总数** ✓，只在**返回的清单**上截断 ✓（items 最多 200 条 ✓）。 */
  const plan = atlas.planCleanup(candidateList, {});

  /* ★★ 「最占空间的文件」不能把**动不了的**也塞进去 ✗✗ ——
     实测（这台机器 ✓）：Top 10 全是 /System/Volumes/VM/swapfile0…9（各 1 GB ✗），
     用户看完得到的信息量是**零** ✗（那是虚拟内存，动不了也不该动 ✗）。
     → 除了给全量的 topFiles（60 条 ✓，够前端自己筛 ✓），
       再单独给一份**排除 L0/L1 的** `topActionable` ✓ —— 这才是用户要看的 ✓。 */
  const actionable = files.filter((item) => item.tier === 'L2-cache' || item.tier === 'L3-temp' || item.tier === 'L4-user');
  const withLabel = (file) => Object.assign({}, file, {
    bytesLabel: atlas.bytesLabel(file.bytes), explanation: catalog.explainPath(file.path, explainOpts),
  });

  const glossaryRoots = [
    '/System', '/Library', '/Applications', '/usr', '/private/var/db',
    '/private/var/folders', '/opt', '/usr/local', '/Library/Developer',
    HOME + '/Library/Caches', HOME + '/Library/Logs', HOME + '/Library/Application Support',
    HOME + '/Library/Containers', HOME + '/Library/Mobile Documents', HOME + '/Library/Keychains',
    HOME + '/Documents', HOME + '/Desktop', HOME + '/Downloads', HOME + '/.Trash',
    HOME + '/.ssh', HOME + '/.codescope', '/tmp',
  ].filter((item) => { try { return fs.existsSync(item); } catch (_) { return false; } })
    .map((item) => Object.assign({ path: item }, catalog.explainPath(item, explainOpts)));

  return {
    ok: true,
    via: 'child-process',
    mode: MODE,
    budget: PER_ROOT,
    generatedAt: Date.now(),
    elapsedMs: scanned.reduce((sum, item) => sum + item.elapsedMs, 0),
    platform: process.platform,
    home: HOME,
    stats: {
      entries, files: totalFiles, bytes: totalBytes, bytesLabel: atlas.bytesLabel(totalBytes),
      truncated, stoppedBy, maxEntries: PER_ROOT.maxEntries, maxDepth: PER_ROOT.maxDepth,
      rootsScanned: scanned.length, rootTiming: timing, skippedRoots: skipped, slowestRootMs: timing.reduce((max, item) => Math.max(max, item.ms), 0),
    },
    tiers,
    tierMeta: atlas.TIER_META,
    tierOrder: atlas.TIER_IDS,
    topFiles: files.slice(0, 60).map(withLabel),
    topActionable: actionable.slice(0, 40).map(withLabel),
    candidates: { files: candidateList.length, bytes: candidateBytes, bytesLabel: atlas.bytesLabel(candidateBytes), capped: candidateList.length > 3000, limit: 3000 },
    byDir,
    byKind,
    tree,
    glossary: glossaryRoots,
    errors: errors.slice(0, 20),
    plan: Object.assign({}, plan, {
      items: plan.items.slice(0, 200).map((item) => Object.assign({}, item, { explanation: catalog.explainPath(item.path, explainOpts) })),
    }),
    planTruncated: plan.count > 200,
  };
}

const report = buildReport();
if (process.argv.includes('--pretty')) {
  console.log('[' + report.mode + '] 扫描 ' + report.elapsedMs + 'ms · ' + report.stats.files + ' 个文件 · ' + report.stats.bytesLabel
    + ' · 覆盖 ' + report.stats.rootsScanned + ' 个根目录 · 预算 ' + report.budget.maxEntries + '/' + report.budget.maxDepth + '/' + report.budget.deadlineMs + 'ms');
  for (const id of report.tierOrder) console.log('  ' + id.padEnd(10) + String(report.tiers[id].label).padEnd(7) + String(report.tiers[id].files).padStart(7) + ' 个 · ' + report.tiers[id].bytes + ' B');
  console.log('  预演 ' + report.plan.count + ' 项 · ' + report.plan.bytesLabel);
  console.log('  大文件 Top5（全量）: ' + report.topFiles.slice(0, 5).map((f) => (f.bytes / 1e9).toFixed(1) + 'G ' + f.path).join(' · '));
  console.log('  大文件 Top5（可动）: ' + report.topActionable.slice(0, 5).map((f) => (f.bytes / 1e9).toFixed(1) + 'G ' + f.path).join(' · '));
} else {
  process.stdout.write(JSON.stringify(report));
}
