'use strict';
/**
 * CodeScope 本机管家（一站式电脑管理面板）后端
 * ---------------------------------------------------------------------------
 * 设计原则（依次优先，冲突时按顺序取舍）：
 *
 *   1. 绝不提供「任意命令执行」接口。全部能力都是下面几张白名单表里的固定
 *      条目；外部传入的只有「已注册的 id / 校验过格式的名字 / 数字 pid」，
 *      任何一项都不参与命令拼接，全部走 argv 数组。
 *   2. 读操作尽量廉价、带缓存、带超时；写（破坏性）操作一律先出方案再执行，
 *      dryRun 可预览，绝不静默删除任何东西。
 *   3. 只用 Node 内置模块（无新依赖），这样面板不会影响主程序的安装体积。
 *   4. 跨平台尽力而为：拿不到的平台信息返回 null 而不是抛错（Linux 上也能用）。
 *
 * 对外只有一个工厂：createSystemPanel({ dataRoot, log }) -> { handle, ... }
 * handle(req, res, u) 返回 true 表示这个请求已被本模块接管。
 */

const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const vm = require('vm');
const { execFile, spawn } = require('child_process');
/* 文件管理单独成模块：它是这里唯一会改动用户数据的部分，隔离出来便于单独审查与测试。 */
const { createFileManager } = require('./system-files');
const { createSoftwareManager } = require('./system-software');
const { createEnvManager } = require('./system-env');
const { createRemoteSync } = require('./remote-sync');
/* 平台差异（该用哪条命令 / 哪些目录）统一问 ./platform 的 HOST，别在本模块里再拼一套。 */
const { HOST } = require('./platform');

/* 让 brew 老实点：不自动更新、不报分析、不在安装后自动清理。
   实测（M4 + 满载）brew list 能跑到近 5 分钟，自动更新只会更慢。 */
const BREW_ENV = { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' };

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const HOME = os.homedir();
const PANEL_VERSION = '2.0.0';   // 2.0：信息架构重构 + 文件管理 + 历史采样

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

/** 执行命令，永不抛出：返回 { code, stdout, stderr, timedOut }。 */
/* docker 端点解析：macOS 上 colima 的 socket 不在 /var/run/docker.sock，
   而 docker CLI 的 default 上下文恰好指向那个不存在的路径 —— 于是「守护进程明明在跑（容器还好好的），
   面板却报未运行」。这里按优先级找出真正可用的 socket，交给所有 docker 调用。 */
function dockerEndpoint() {
  const fromEnv = String(process.env.DOCKER_HOST || '').trim();
  if (fromEnv) return { host: fromEnv, source: 'DOCKER_HOST' };
  const home = os.homedir();
  const sockets = [
    path.join(home, '.colima', process.env.COLIMA_PROFILE || 'default', 'docker.sock'),
    path.join(home, '.colima', 'default', 'docker.sock'),
    path.join(home, '.docker', 'run', 'docker.sock'),
    '/var/run/docker.sock',
    '/run/docker.sock',
  ];
  for (const socket of [...new Set(sockets)]) {
    try { if (fs.existsSync(socket)) return { host: 'unix://' + socket, socket, source: socket }; } catch (_) {}
  }
  return { host: '', socket: '', source: '' };
}

function dockerEnv() {
  const endpoint = dockerEndpoint();
  return endpoint.host ? { DOCKER_HOST: endpoint.host } : {};
}

function exec(cmd, args, options = {}) {
  const timeout = options.timeout || 8000;
  const maxBuffer = options.maxBuffer || 8 * 1024 * 1024;
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(cmd, args, {
        timeout,
        maxBuffer,
        windowsHide: true,
        cwd: options.cwd,
        /* 顺带注入 DOCKER_HOST：只对 docker 相关命令有意义，其它命令无副作用。 */
        env: Object.assign({}, process.env, dockerEnv(), options.env || {}),
        encoding: 'utf8',
      }, (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: stdout == null ? '' : String(stdout),
          stderr: stderr == null ? '' : String(stderr),
          timedOut: !!(error && (error.killed || error.signal === 'SIGTERM')),
          error: error ? String(error.message || error) : '',
        });
      });
    } catch (error) {
      return resolve({ code: 1, stdout: '', stderr: '', timedOut: false, error: String(error.message || error) });
    }
    if (child && child.stdin) { try { child.stdin.end(); } catch (_) {} }
  });
}

/** 只取 stdout 的便捷方法；失败返回空串。 */
async function text(cmd, args, timeout, options) {
  const result = await exec(cmd, args, Object.assign({ timeout }, options || {}));
  return result.code === 0 ? result.stdout : '';
}

/** 命令是否存在（带缓存）。 */
const WHICH_CACHE = new Map();
async function which(bin) {
  if (WHICH_CACHE.has(bin)) return WHICH_CACHE.get(bin);
  let found = null;
  const probe = IS_WIN ? ['where', [bin]] : ['sh', ['-c', 'command -v ' + bin.replace(/[^A-Za-z0-9_.-]/g, '')]];
  try {
    const result = await exec(probe[0], probe[1], { timeout: 4000 });
    if (result.code === 0 && result.stdout.trim()) found = result.stdout.trim().split(/\r?\n/)[0].trim();
  } catch (_) { /* 当作不存在 */ }
  WHICH_CACHE.set(bin, found);
  return found;
}

/** 进程内 TTL 缓存：避免前端每次刷新都去跑 ps / brew / du。 */
const CACHE = new Map();
async function remember(key, ttlMs, producer) {
  const hit = CACHE.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await producer();
  CACHE.set(key, { at: now, value });
  return value;
}
function forget(key) { CACHE.delete(key); }

/**
 * 「软缓存」：命中新鲜缓存就直接给；否则**立刻**返回 stale/loading 状态，
 * 同时在后台跑生产函数把缓存焐热。brew 这类几秒钟到几分钟的慢探测必须走这条路，
 * 否则接口会把前端卡死（实测 brew list --versions 满载时接近 5 分钟）。
 */
const WARMING = new Map();
function softCache(key, ttlMs, producer) {
  const hit = CACHE.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return { ready: true, loading: false, value: hit.value, at: hit.at };
  if (!WARMING.has(key)) {
    WARMING.set(key, now);
    Promise.resolve()
      .then(producer)
      .then((value) => { CACHE.set(key, { at: Date.now(), value }); })
      .catch(() => {})
      .finally(() => { WARMING.delete(key); });
  }
  return { ready: false, loading: true, value: hit ? hit.value : null, at: hit ? hit.at : 0 };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/* ------------------------------------------------------------------ *
 * 总览：CPU / 内存 / 交换 / 负载 / 磁盘 / 身份
 * ------------------------------------------------------------------ */

let cpuPrevious = null;

/** 用两次 os.cpus() 的差值算真实占用率；两次调用间隔太近就复用上次结果。 */
function cpuUsage() {
  const cpus = os.cpus();
  const snapshot = cpus.map((cpu) => {
    const times = cpu.times;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { total, idle: times.idle };
  });
  if (!cpuPrevious || snapshot.length !== cpuPrevious.length) {
    cpuPrevious = snapshot;
    return { usage: 0, perCore: snapshot.map(() => 0), ready: false };
  }
  let busyDelta = 0;
  let totalDelta = 0;
  const perCore = [];
  for (let i = 0; i < snapshot.length; i += 1) {
    const total = snapshot[i].total - cpuPrevious[i].total;
    const idle = snapshot[i].idle - cpuPrevious[i].idle;
    const busy = Math.max(0, total - idle);
    perCore.push(total > 0 ? Math.min(100, busy / total * 100) : 0);
    busyDelta += busy;
    totalDelta += total;
  }
  cpuPrevious = snapshot;
  return { usage: totalDelta > 0 ? busyDelta / totalDelta * 100 : 0, perCore, ready: true };
}

let memoryPrevious = null;
async function memoryInfo() {
  const total = os.totalmem();
  let free = os.freemem();
  let wired = 0;
  let compressed = 0;
  let cached = 0;
  if (IS_MAC) {
    try {
      const stat = await text('vm_stat', [], 3000);
      const pageMatch = /page size of\s+(\d+) bytes/i.exec(stat);
      const pageSize = pageMatch ? Number(pageMatch[1]) : 4096;
      const page = (label) => {
        const match = new RegExp('^' + label + ':\\s+(\\d+)', 'mi').exec(stat);
        return match ? Number(match[1]) : 0;
      };
      cached = (page('Pages inactive') + page('Pages speculative')) * pageSize;
      wired = page('Pages wired down') * pageSize;
      compressed = page('Pages occupied by compressor') * pageSize;
      free = (page('Pages free') + page('Pages inactive') + page('Pages speculative')) * pageSize;
    } catch (_) { /* 回退到 os.freemem() */ }
  } else if (process.platform === 'linux') {
    try {
      const info = fs.readFileSync('/proc/meminfo', 'utf8');
      const pick = (name) => {
        const match = new RegExp('^' + name + ':\\s+(\\d+)\\s+kB', 'mi').exec(info);
        return match ? Number(match[1]) * 1024 : 0;
      };
      const available = pick('MemAvailable');
      if (available) free = available;
      cached = pick('Cached');
    } catch (_) { /* 忽略 */ }
  }
  const clampedFree = Math.max(0, Math.min(total, free));
  const used = Math.max(0, total - clampedFree);
  const value = {
    total, free: clampedFree, used, cached, wired, compressed,
    usage: total ? used / total * 100 : 0,
  };
  memoryPrevious = value;
  return value;
}

async function swapInfo() {
  if (!IS_MAC) {
    try {
      const info = fs.readFileSync('/proc/meminfo', 'utf8');
      const pick = (name) => {
        const match = new RegExp('^' + name + ':\\s+(\\d+)\\s+kB', 'mi').exec(info);
        return match ? Number(match[1]) * 1024 : 0;
      };
      const total = pick('SwapTotal');
      const free = pick('SwapFree');
      return total ? { total, free, used: total - free } : null;
    } catch (_) { return null; }
  }
  const raw = await text('sysctl', ['-n', 'vm.swapusage'], 3000);
  const total = /total\s*=\s*([\d.]+)M/i.exec(raw);
  const used = /used\s*=\s*([\d.]+)M/i.exec(raw);
  if (!total) return null;
  const totalBytes = Number(total[1]) * 1024 * 1024;
  const usedBytes = used ? Number(used[1]) * 1024 * 1024 : 0;
  return { total: totalBytes, used: usedBytes, free: Math.max(0, totalBytes - usedBytes) };
}

/** df -Pk 解析：只保留有意义的本地卷，剔除虚拟文件系统。 */
const EXCLUDED_FS = /^(devfs|map|autofs|procfs|fdesc|vmhgfs|-hosts|none)$/;
/* macOS 的 df 会把挂载名里的非 ASCII 字符替换成 ?（实测这台机器输出 /Volumes/EAGET??），
   用户根本认不出这是哪个盘。用 /Volumes 目录里的真实名字按前缀补回来。 */
function realVolumeName(mount) {
  /* 系统盘的真名在 /Volumes 里是一个指向 / 的符号链接（这台机器叫 Macintosh HD）。 */
  if (mount === '/' || mount === '/System/Volumes/Data') {
    try {
      const boot = fs.readdirSync('/Volumes').find((name) => {
        try {
          const real = fs.realpathSync('/Volumes/' + name);
          return real === '/' || real === '/System/Volumes/Data';
        } catch (_) { return false; }
      });
      return boot || '';
    } catch (_) { return ''; }
  }
  if (!mount || !mount.startsWith('/Volumes/') || !mount.includes('?')) return '';
  const prefix = mount.slice('/Volumes/'.length).replace(/\?+$/, '');
  if (!prefix) return '';
  try {
    const hit = fs.readdirSync('/Volumes').find((name) => name.startsWith(prefix));
    return hit || '';
  } catch (_) { return ''; }
}

/* 磁盘排序权重：0 系统盘、1 内置其它卷、2 外接盘。 */
function diskRank(disk) {
  /* kind==='system' 是三平台通用的「系统盘」标记（macOS 只有 mount==='/' 会拿到它，
     Windows 由盘符与 %SystemRoot% 比对得到）。 */
  if (disk.kind === 'system' || disk.mount === '/System/Volumes/Data' || disk.mount === '/') return 0;
  if (disk.kind === 'external') return 2;
  return 1;
}

/* Windows 卷：命令来自平台层的 Win32_LogicalDisk（现有计划给的是 ConvertTo-Json -Compress；
   单盘是对象、多盘是数组）。这里**同时也认** ConvertTo-Csv -NoTypeInformation 的格式
   （"C:","511,574,536,704","123,456,789,012"）—— 命令若被换成 CSV 输出也不会静默变成空列表。
   数字里的千位逗号必须剥掉。格式取自 Windows 官方/常见输出样本，未经真机验证。 */

/* 单元格 → 数字。剥千位逗号；空值/非数字返回 null（没插盘的读卡器、无盘光驱的 Size 就是 null）。 */
function numFromCell(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/[,\s]/g, '');
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/* DriveType：2 可移动、3 本地磁盘、4 网络、5 光驱（取自 Win32_LogicalDisk 的官方取值）。 */
function windowsDriveKind(device, driveType) {
  const type = Number(driveType);
  if (type === 4) return 'network';
  if (type === 2 || type === 5) return 'external';
  const systemDrive = String(HOST.systemRoot || 'C:\\').slice(0, 2).toLowerCase();
  if (String(device).toLowerCase() === systemDrive) return 'system';
  return 'other';
}

/* Win32_LogicalDisk 的 JSON / CSV 输出 → 和 df 那路同形的卷行（纯函数）。
   解析失败一律返回空数组，绝不抛异常。 */
function parseWindowsVolumes(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const input = raw.trim();
  if (!input) return [];
  const parsedRows = [];
  if (input.startsWith('{') || input.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(input); } catch (_) { return []; }
    for (const item of (Array.isArray(parsed) ? parsed : [parsed])) {
      if (!item || typeof item !== 'object') continue;
      parsedRows.push({ device: item.DeviceID, total: numFromCell(item.Size), free: numFromCell(item.FreeSpace), driveType: item.DriveType });
    }
  } else {
    const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    /* 带表头就按列名找列，没有表头（或列名不认识）就按 Select-Object 的书写顺序兜底。 */
    let order = { device: 0, total: 1, free: 2 };
    let body = lines;
    const header = splitCsvLine(lines[0] || '');
    if (header.some((cell) => /^devic/i.test(cell.trim()))) {
      const indexOf = (pattern, fallback) => {
        const at = header.findIndex((cell) => pattern.test(cell.trim()));
        return at >= 0 ? at : fallback;
      };
      order = { device: indexOf(/^devic/i, 0), total: indexOf(/^size$/i, 1), free: indexOf(/^freespace$/i, 2) };
      body = lines.slice(1);
    }
    for (const line of body) {
      const fields = splitCsvLine(line);
      if (fields.length < 3) continue;
      parsedRows.push({ device: fields[order.device], total: numFromCell(fields[order.total]), free: numFromCell(fields[order.free]), driveType: undefined });
    }
  }
  const rows = [];
  for (const item of parsedRows) {
    const device = String(item.device == null ? '' : item.device).trim();
    if (!device) continue;
    const total = item.total || 0;
    const free = item.free || 0;
    /* 没插盘的读卡器/光驱总容量是 0 或 null —— 跟 df 那路一样跳过，不报一块 0 字节的盘。 */
    if (total <= 0) continue;
    const used = Math.max(0, total - free);
    const usage = total ? used / total * 100 : 0;
    rows.push({
      device,
      mount: /[\\/]$/.test(device) ? device : device + '\\',
      kind: windowsDriveKind(device, item.driveType),
      total, used, free,
      usage,
      /* Windows 这条命令不报百分比：按 used/total 算一个整数，语义与 df 的 capacity 一致（给人看的数）。 */
      capacity: Math.round(usage),
      readOnly: Number(item.driveType) === 5,
      label: '',
    });
  }
  return rows.sort((a, b) => diskRank(a) - diskRank(b) || b.total - a.total);
}

async function volumes() {
  if (IS_WIN) {
    /* Windows 没有 df：命令来自平台层（Win32_LogicalDisk）。PowerShell 可能带警告退非 0，
       所以按 stdout 解析、不拿退出码当门槛 —— 和下面 du/lsof 那两条一样的道理。 */
    const plan = HOST.commands.diskInfo();
    if (!plan) return [];
    const raw = (await exec(plan.file, plan.args, { timeout: 15000 })).stdout;
    return parseWindowsVolumes(raw);
  }
  /* 版式差异：macOS 的 df -k 带 iused/ifree/%iused 三列，Linux 不带，
     而 -P 又会把 macOS 的 inode 列去掉 —— 所以两种版式都要认，先 9 列再退 6 列。 */
  const raw = await text('df', ['-k'], 8000);
  const WITH_INODES = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/;
  const PLAIN = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/;
  const rows = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const withInodes = WITH_INODES.exec(line);
    const match = withInodes || PLAIN.exec(line);
    if (!match) continue;
    const device = match[1];
    if (EXCLUDED_FS.test(device)) continue;
    const total = Number(match[2]) * 1024;
    const used = Number(match[3]) * 1024;
    const free = Number(match[4]) * 1024;
    const mount = (withInodes ? match[9] : match[6]).trim();
    if (!mount || total <= 0) continue;
    let kind = 'other';
    if (mount === '/') kind = 'system';
    else if (/^\/System\/Volumes\/Data/.test(mount)) kind = 'data';
    else if (/^\/(Volumes|media|mnt)\//.test(mount) || /^[A-Z]:\\/.test(mount)) kind = 'external';
    else if (/^(afp|smb|nfs|\/\/)/.test(device)) kind = 'network';
    rows.push({
      device, mount, kind,
      total, used, free,
      /* usage = 已用/总量；capacity = df 自报百分比。
         APFS 上两者不同（容量按 used/(used+avail) 算），而「盘快满了」该看 capacity。 */
      usage: total ? used / total * 100 : 0,
      capacity: Number(match[5]) || 0,
      readOnly: /^\/System\/Volumes\/(Preboot|Update|xarts|iSCPreboot|Hardware|Recovery|VM)/.test(mount),
      label: realVolumeName(mount),
    });
  }
  /* / 与 /System/Volumes/Data 是同一个 APFS 容器的两面，只留数据卷免得数字看着重复。 */
  const hasData = rows.some((row) => row.kind === 'data');
  /* 只读伪卷（VM/Preboot/Update/xarts/iSCPreboot/Hardware）不是用户能管理的空间，
     系统快照与数据卷又是同一容器的两面，一起剔掉，列表才看得懂。 */
  const filtered = rows.filter((row) => !row.readOnly && !(hasData && row.kind === 'system'));
  /* 系统盘排最前，其次内置卷，最后外接盘：一屏之内先看到自己真正要管的那块盘。
     同类里再按容量从大到小。之前按容量排，500GB 的外接盘永远压着系统盘。 */
  return filtered.sort((a, b) => diskRank(a) - diskRank(b) || b.total - a.total);
}

async function machineIdentity() {
  return remember('identity', 10 * 60 * 1000, async () => {
    let model = '';
    let osName = `${os.type()} ${os.release()}`;
    let osVersion = '';
    if (IS_MAC) {
      model = (await text('sysctl', ['-n', 'hw.model'], 3000)).trim();
      const sw = await text('sw_vers', [], 3000);
      const product = /ProductName:\s*(.+)/.exec(sw);
      const version = /ProductVersion:\s*(.+)/.exec(sw);
      const build = /BuildVersion:\s*(.+)/.exec(sw);
      if (product) osName = product[1].trim();
      if (version) osVersion = version[1].trim() + (build ? ' (' + build[1].trim() + ')' : '');
    } else if (process.platform === 'linux') {
      try {
        const release = fs.readFileSync('/etc/os-release', 'utf8');
        const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(release);
        if (pretty) osName = pretty[1];
      } catch (_) { /* 忽略 */ }
      osVersion = os.release();
    } else {
      model = os.hostname();
      osVersion = os.release();
    }
    return {
      hostname: os.hostname(),
      user: os.userInfo().username,
      home: HOME,
      model,
      osName,
      osVersion,
      arch: os.arch(),
      platform: process.platform,
      node: process.version,
      cpuModel: (os.cpus()[0] || {}).model ? os.cpus()[0].model.trim() : 'Unknown CPU',
      cores: os.cpus().length,
      totalMemory: os.totalmem(),
      uptime: os.uptime(),
      bootAt: Date.now() - os.uptime() * 1000,
    };
  });
}

async function batteryInfo() {
  if (!IS_MAC) return null;
  return remember('battery', 30 * 1000, async () => {
    const raw = await text('pmset', ['-g', 'batt'], 3000);
    if (!raw) return null;
    const percent = /(\d+)%/.exec(raw);
    const state = /;\s*([a-z ]+);\s*(\d+:\d+)/i.exec(raw);
    if (!percent) return null;
    return {
      percent: Number(percent[1]),
      state: state ? state[1].trim() : '',
      remaining: state ? state[2] : '',
      charging: /AC Power|charging/i.test(raw),
    };
  });
}

/* ── 温度与热压力 ──
   macOS 上「不越权读温度」基本是不可能的：Apple Silicon 的
   `powermetrics --samplers thermal` 必须 root（实测报 "must be invoked as the superuser"），
   ioreg 也读不到 SMC 的温度键。所以按「能拿到什么就给什么」分三层，绝不编数字：
     ① pmset -g therm（无需特权）—— 热压力与 CPU 限速，永远可用；
     ② 用户自装的命令行工具（osx-cpu-temp / istats / smctemp）—— 有就给具体摄氏度；
     ③ 都没有 → available:false + 一条可执行的建议（前端照原样显示，不假装有数据）。 */
async function thermalInfo() {
  if (!IS_MAC) return null;
  return remember('thermal', 15 * 1000, async () => {
    const info = {
      available: false, celsius: null,
      pressure: 'unknown', speedLimit: null, availableCPUs: null,
      source: '', hint: '',
    };

    /* ① 热压力：pmset 的输出在没有热事件时是一句 Note，那也是有效信息（= 正常）。 */
    const therm = await text('pmset', ['-g', 'therm'], 3000);
    if (therm) {
      const speed = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(therm);
      const cpus = /CPU_Available_CPUs\s*=\s*(\d+)/.exec(therm);
      /* 注意措辞：无热事件时 pmset 输出的是「No thermal warning level has been recorded」——
         直接匹配 'thermal warning level has been recorded' 会把「没有」也当成「有」（踩过）。 */
      const warned = !/No thermal warning level/i.test(therm) && /thermal warning level/i.test(therm);
      const perfWarned = !/No performance warning level/i.test(therm) && /performance warning level/i.test(therm);
      const limit = speed ? Number(speed[1]) : null;
      info.speedLimit = limit;
      info.availableCPUs = cpus ? Number(cpus[1]) : null;
      info.pressure = (perfWarned || warned || (limit != null && limit < 100)) ? 'high' : 'normal';
      info.hasPressure = true;
    }

    /* ② 第三方温度工具：命令与输出格式各不相同，逐个试，取第一个能解析出数字的。 */
    const readers = [
      { bin: 'osx-cpu-temp', args: [], pick: (out) => /([\d.]+)\s*°?C/i.exec(out) },
      { bin: 'smctemp', args: ['-c'], pick: (out) => /([\d.]+)/.exec(out) },
      { bin: 'istats', args: ['cpu', 'temp', '--value-only'], pick: (out) => /([\d.]+)/.exec(out) },
    ];
    for (const reader of readers) {
      if (!(await which(reader.bin))) continue;
      const out = await text(reader.bin, reader.args, 4000);
      const match = out && reader.pick(out);
      const value = match ? Number(match[1]) : NaN;
      if (Number.isFinite(value) && value > 0 && value < 130) {
        info.celsius = Math.round(value * 10) / 10;
        info.source = reader.bin;
        info.available = true;
        break;
      }
    }

    /* ③ 拿不到具体温度：如实说明，并给一条能自己解决的路。 */
    if (!info.available) {
      info.hint = 'macOS 不允许普通权限读温度。装一个命令行工具即可：brew install osx-cpu-temp';
    }
    return info;
  });
}

/* 磁盘 IO（整机吞吐 MB/s）。
   用 iostat -c 2：**第一次输出是「自启动以来的平均」，第二次才是当前速率**，所以取最后一行。
   每块盘三列（KB/t、tps、MB/s），把各盘的 MB/s 相加得到整机吞吐。
   非 macOS 或拿不到数据就返回 null —— 曲线该断就断，不编数字。 */
async function diskIo() {
  if (!IS_MAC) return null;
  if (!(await which('iostat'))) return null;
  const out = await text('iostat', ['-d', '-c', '2', '-w', '1'], 5000);
  if (!out) return null;
  /* 只保留数据行（形如「15.41  319  4.80  ...」），跳过两行表头 */
  const rows = out.split(/\r?\n/).filter((line) => /^\s*[\d.]+(\s+[\d.]+){2,}\s*$/.test(line));
  if (!rows.length) return null;
  const nums = rows[rows.length - 1].trim().split(/\s+/).map(Number);
  let mbPerSec = 0;
  for (let i = 2; i < nums.length; i += 3) mbPerSec += Number(nums[i]) || 0;
  if (!Number.isFinite(mbPerSec)) return null;
  return { mbPerSec: Math.round(mbPerSec * 100) / 100, at: Date.now() };
}

/* 采样环：面板的实时曲线要有真历史 —— 只存在浏览器内存里的话，一刷新就断，
   用户永远看不到「过去十分钟发生了什么」。5 秒一采样，保留 60 分钟（720 点）。
   定时器 unref，绝不阻止进程退出；采样只读、幂等、失败不抛。 */
const HISTORY = { samples: [], interval: 5000, max: 720, timer: null, net: null };

async function swapInfo() {
  if (!IS_MAC) {
    try {
      const info = fs.readFileSync('/proc/meminfo', 'utf8');
      const pick = (name) => {
        const match = new RegExp('^' + name + ':\s+(\\d+)\\s+kB', 'mi').exec(info);
        return match ? Number(match[1]) * 1024 : 0;
      };
      const total = pick('SwapTotal');
      const free = pick('SwapFree');
      return total ? { total, free, used: total - free } : null;
    } catch (_) { return null; }
  }
  const raw = await text('sysctl', ['-n', 'vm.swapusage'], 3000);
  const total = /total\s*=\s*([\d.]+)M/i.exec(raw);
  const used = /used\s*=\s*([\d.]+)M/i.exec(raw);
  if (!total) return null;
  const totalBytes = Number(total[1]) * 1024 * 1024;
  const usedBytes = used ? Number(used[1]) * 1024 * 1024 : 0;
  return { total: totalBytes, used: usedBytes, free: Math.max(0, totalBytes - usedBytes) };
}

/* netstat -ib 的 Ibytes/Obytes 是 BSD/macOS 的列名，只有 macOS 的 netstat 有这套输出；
   其它平台上这条命令要么不存在、要么列名对不上，等于每次采样白跑一个子进程，所以先挡住。
   命中时按表头列名定位 Ibytes/Obytes：不同接口的列数不一样，靠位置硬猜会算错。 */
async function netCounters() {
  if (!HOST.isMac) return null;
  const result = await exec('netstat', ['-ib'], { timeout: 6000 });
  if (result.code !== 0 || !result.stdout) return null;
  const lines = result.stdout.split(/\r?\n/);
  const header = lines.find((line) => /^Name\s/.test(line));
  if (!header) return null;
  const cols = header.trim().split(/\s+/);
  const inIndex = cols.indexOf('Ibytes');
  const outIndex = cols.indexOf('Obytes');
  if (inIndex < 0 || outIndex < 0) return null;
  let bytesIn = 0;
  let bytesOut = 0;
  for (const line of lines) {
    if (/^Name\s/.test(line)) continue;          // 每个接口分组都会重复一次表头
    const parts = line.trim().split(/\s+/);
    if (parts.length <= outIndex) continue;
    if (parts[0] === 'lo0') continue;             // 回环不算真实流量
    bytesIn += Number(parts[inIndex]) || 0;
    bytesOut += Number(parts[outIndex]) || 0;
  }
  return { bytesIn, bytesOut, at: Date.now() };
}

async function sampleHistory() {
  const cpu = cpuUsage();
  const memory = await memoryInfo().catch(() => null);
  const swap = await swapInfo().catch(() => null);
  const net = await netCounters().catch(() => null);
  const disk = await diskIo().catch(() => null);
  const at = Date.now();
  let netIn = 0;
  let netOut = 0;
  if (net && HISTORY.net) {
    const seconds = Math.max(0.5, (net.at - HISTORY.net.at) / 1000);
    netIn = Math.max(0, (net.bytesIn - HISTORY.net.bytesIn) / seconds);
    netOut = Math.max(0, (net.bytesOut - HISTORY.net.bytesOut) / seconds);
  }
  if (net) HISTORY.net = net;
  const memTotal = Number(memory && memory.total) || os.totalmem();
  const memUsed = Number(memory && memory.used) || Math.max(0, os.totalmem() - os.freemem());
  HISTORY.samples.push({
    t: at,
    cpu: Number(cpu && cpu.usage) || 0,
    mem: memTotal ? memUsed / memTotal : 0,
    memUsed, memTotal,
    swap: swap && swap.total ? swap.used / swap.total : 0,
    swapUsed: swap ? swap.used : 0,
    swapTotal: swap ? swap.total : 0,
    load: Number(os.loadavg()[0]) || 0,
    netIn, netOut,
    disk: disk ? disk.mbPerSec : 0,
  });
  while (HISTORY.samples.length > HISTORY.max) HISTORY.samples.shift();
}

function startHistory() {
  if (HISTORY.timer) return;
  sampleHistory().catch(() => {});
  HISTORY.timer = setInterval(() => { sampleHistory().catch(() => {}); }, HISTORY.interval);
  if (HISTORY.timer.unref) HISTORY.timer.unref();
}

function historySeries(params) {
  const minutes = Math.min(Math.max(Number(params.get('minutes')) || 60, 1), 180);
  const since = Date.now() - minutes * 60000;
  const samples = HISTORY.samples.filter((item) => item.t >= since);
  return {
    ok: true,
    interval: HISTORY.interval,
    minutes,
    count: samples.length,
    capacity: HISTORY.max,
    latest: HISTORY.samples[HISTORY.samples.length - 1] || null,
    samples,
  };
}

async function overview() {
  const [identity, memory, swap, disks, battery, thermal] = await Promise.all([
    machineIdentity(), memoryInfo(), swapInfo(), volumes(), batteryInfo(), thermalInfo(),
  ]);
  const cpu = cpuUsage();
  const topMemory = os.loadavg();
  return {
    ok: true,
    ts: Date.now(),
    panelVersion: PANEL_VERSION,
    identity,
    cpu: {
      usage: cpu.usage,
      ready: cpu.ready,
      perCore: cpu.perCore,
      cores: identity.cores,
      model: identity.cpuModel,
      load: topMemory,
      // 单核机器上 load 本身就是相对值，这里给出「每核负载」更直观
      loadPercent: topMemory.map((value) => (identity.cores ? value / identity.cores * 100 : 0)),
    },
    memory,
    swap,
    disks,
    /* HOME 在哪个卷里，那个卷才是「系统盘」。以前参数写反了（拿挂载点去比 HOME），
       结果永远匹配不上、回退到 disks[0]，首页就把外接硬盘当成了系统盘。 */
    primaryDisk: disks.find((disk) => isInside(HOME, disk.mount))
      || disks.find((disk) => disk.mount === '/System/Volumes/Data')
      || disks.find((disk) => disk.mount === '/')
      || disks[0] || null,
    battery,
    thermal,
  };
}

/* ------------------------------------------------------------------ *
 * 进程
 * ------------------------------------------------------------------ */

const PS_FIELDS = 'pid=,ppid=,user=,%cpu=,%mem=,rss=,etime=,stat=,args=';
const PS_PATTERN = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+|-)\s+([\d.]+|-)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/;

function appNameOf(command) {
  if (!command) return '?';
  const first = command.trim().split(/\s+/)[0] || '?';
  if (/\.app\/Contents\/MacOS\//i.test(first)) return path.basename(first);
  if (first.startsWith('-')) return first.replace(/^-+/, '') || '?';
  return path.basename(first);
}

/* ps -Ao 输出 → 进程行（纯函数：吃字符串、吐数组，本机就能拿真 ps 输出验收）。 */
function parsePsOutput(raw) {
  const list = [];
  if (!raw || typeof raw !== 'string') return list;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = PS_PATTERN.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isFinite(pid)) continue;
    list.push({
      pid,
      ppid: Number(match[2]),
      user: match[3],
      cpu: Number(match[4]) || 0,
      mem: Number(match[5]) || 0,
      rss: Number(match[6]) * 1024,
      elapsed: match[7],
      state: match[8],
      command: (match[9] || '').trim(),
      app: appNameOf(match[9]),
      mine: match[3] === os.userInfo().username,
    });
  }
  return list;
}

/* 一行 CSV → 字段数组（认 "" 转义）。tasklist 的每个字段都带引号，用 split(',') 会把
   带千位逗号的 "1,234,567 K" 当场切碎，所以必须按引号状态走一遍。 */
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else { quoted = false; }
      } else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

/* "123,456 K" → 字节数。千位逗号必须剥掉；K/M/G 按 1024 进位；认不出来返回 null。 */
function parseKbLabel(value) {
  const match = /^\s*([\d,]+)\s*([KMG])?B?\s*$/i.exec(String(value == null ? '' : value));
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  const unit = (match[2] || 'K').toUpperCase();
  const factor = unit === 'G' ? 1024 * 1024 * 1024 : unit === 'M' ? 1024 * 1024 : 1024;
  return number * factor;
}

/* tasklist /FO CSV /NH 输出 → 进程行（纯函数）。
   格式取自 Windows 官方文档与常见输出样本（"chrome.exe","1234","Console","1","123,456 K"），
   未经真机验证。
   只有 5 列：映像名称 / PID / 会话名 / 会话# / 内存使用 —— 没有 CPU%、父进程、用户、运行时长，
   所以 cpu/ppid/elapsed 给 0 或空（前端会对 cpu 直接 .toFixed(1)，给 null 会当场炸）。
   会话名不是用户名，不塞进 user 冒充；放 state 里保留信息，user 留空。 */
function parseTasklistCsv(raw) {
  const rows = [];
  if (!raw || typeof raw !== 'string') return rows;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line);
    if (fields.length < 5) continue;
    const name = fields[0].trim();
    const pid = Number(fields[1].trim());
    /* PID 列不是数字的行一律跳过：表头（"映像名称","PID",…）和空行都会在这一步落掉。 */
    if (!name || !Number.isInteger(pid) || pid < 0) continue;
    const memory = parseKbLabel(fields[4]);
    rows.push({
      pid,
      ppid: null,
      user: '',
      cpu: 0,
      mem: 0,
      rss: memory == null ? 0 : memory,
      elapsed: '',
      state: fields[2].trim(),
      command: name,
      app: name,
      mine: false,
    });
  }
  return rows;
}

async function processes(options = {}) {
  const sort = options.sort === 'mem' ? 'mem' : 'cpu';
  const limit = clampNumber(options.limit, 10, 400, 60);
  /* 命令问平台层：Windows → tasklist（没有 ps），posix → null，沿用下面的 ps -Ao。
     两条路的解析都是纯函数（parsePsOutput / parseTasklistCsv），样本测试可直接喂字符串。 */
  const plan = HOST.commands.processList();
  const raw = plan ? await text(plan.file, plan.args, 10000) : await text('ps', ['-Ao', PS_FIELDS], 8000);
  const list = plan ? parseTasklistCsv(raw) : parsePsOutput(raw);
  /* 按应用聚合：Chrome/Electron 一个进程组几十条，聚合后才看得懂谁在吃 CPU。 */
  const groups = new Map();
  for (const item of list) {
    const entry = groups.get(item.app) || { app: item.app, count: 0, cpu: 0, mem: 0, rss: 0, pids: [] };
    entry.count += 1;
    entry.cpu += item.cpu;
    entry.mem += item.mem;
    entry.rss += item.rss;
    if (entry.pids.length < 24) entry.pids.push(item.pid);
    groups.set(item.app, entry);
  }
  const sorted = list.sort((a, b) => (sort === 'mem' ? b.rss - a.rss : b.cpu - a.cpu));
  return {
    ok: true,
    ts: Date.now(),
    sort,
    total: list.length,
    list: sorted.slice(0, limit),
    groups: [...groups.values()].sort((a, b) => (sort === 'mem' ? b.rss - a.rss : b.cpu - a.cpu)).slice(0, 24),
    self: { pid: process.pid, cpu: list.find((item) => item.pid === process.pid) || null },
  };
}

/** 只允许结束「当前用户自己的、非关键」进程。 */
async function killProcess(pidValue, signalValue) {
  const pid = Number(pidValue);
  const signal = String(signalValue || 'SIGTERM').toUpperCase();
  const allowedSignals = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGSTOP', 'SIGCONT'];
  if (!Number.isInteger(pid) || pid <= 1) throw Object.assign(new Error('无效的进程号'), { statusCode: 400 });
  if (pid === process.pid) throw Object.assign(new Error('不能结束 CodeScope 自身的进程'), { statusCode: 400 });
  if (!allowedSignals.includes(signal)) throw Object.assign(new Error('不支持的信号：' + signal), { statusCode: 400 });
  let owner = '';
  try {
    const raw = await text('ps', ['-o', 'user=', '-p', String(pid)], 4000);
    owner = raw.trim();
  } catch (_) { /* 忽略 */ }
  if (!owner) throw Object.assign(new Error('进程 ' + pid + ' 不存在或已结束'), { statusCode: 404 });
  const me = os.userInfo().username;
  if (owner !== me) throw Object.assign(new Error('进程 ' + pid + ' 属于用户 ' + owner + '，本机管家只管理当前用户（' + me + '）的进程'), { statusCode: 403 });
  try {
    process.kill(pid, signal);
  } catch (error) {
    throw Object.assign(new Error('结束进程失败：' + (error.message || error)), { statusCode: 500 });
  }
  return { ok: true, pid, signal, owner };
}

/* ------------------------------------------------------------------ *
 * 目录占用 / 大文件
 * ------------------------------------------------------------------ */

/* 目录占用的数量解析（纯函数）：du -sk 给 KB，Windows 的 PowerShell 计划给字节 ——
   单位由平台计划带着走（plan.unit）。解析不出来返回 null（调用方据此显示「无法统计」），不抛异常。 */
function parseDirSizeOutput(raw, unit) {
  if (!raw || typeof raw !== 'string') return null;
  const match = /^\s*(\d+)/.exec(raw);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  return unit === 'bytes' ? number : number * 1024;
}

async function dirSize(target, timeout = 20000) {
  try {
    const stat = await fsp.stat(target);
    if (stat.isFile()) return stat.size;
  } catch (_) {
    return null;
  }
  /* 命令问平台层：posix → du -sk，Windows → PowerShell 递归求和（没有 du）。 */
  const plan = HOST.commands.dirUsage(target);
  const result = await exec(plan.file, plan.args, { timeout, maxBuffer: 2 * 1024 * 1024 });
  /* 重要：du 只要碰到一个读不了的子目录就返回非 0，但 stdout 里已经有总数了 ——
     所以这里不能以退出码为准，否则整个目录都统计不出来（Windows 的 PowerShell 计划同理）。 */
  return parseDirSizeOutput(result.stdout, plan.unit);
}

/** 并列出一级子项占用（宝塔那种目录占用图的基础数据）。 */
async function dirBreakdown(root, options = {}) {
  const limit = clampNumber(options.limit, 4, 60, 24);
  const minBytes = Number(options.minBytes) || 0;
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (error) {
    throw Object.assign(new Error('无法读取目录：' + (error.message || error)), { statusCode: 400 });
  }
  const candidates = entries
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      path: path.join(root, entry.name),
      hidden: entry.name.startsWith('.'),
      dir: entry.isDirectory(),
    }))
    .slice(0, 200);
  const results = [];
  /* 并发 3：du 本身吃 IO，开太大反而更慢。 */
  const queue = candidates.slice();
  const workers = new Array(3).fill(0).map(async () => {
    while (queue.length) {
      const item = queue.shift();
      const size = await dirSize(item.path, 15000);
      if (size == null) continue;
      if (size < minBytes) continue;
      results.push(Object.assign({ size }, item));
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => b.size - a.size);
  const total = results.reduce((sum, item) => sum + item.size, 0);
  return { ok: true, root, total, count: results.length, items: results.slice(0, limit) };
}

async function largeFiles(root, options = {}) {
  const minMiB = clampNumber(options.minMiB, 1, 1024 * 1024, 200);
  const limit = clampNumber(options.limit, 5, 200, 40);
  const depth = clampNumber(options.depth, 1, 8, 3);
  const found = [];
  const stack = [{ dir: root, level: 0 }];
  const deadline = Date.now() + (options.budgetMs || 12000);
  let visited = 0;
  while (stack.length && Date.now() < deadline && found.length < 4000) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch (_) { continue; }
    for (const entry of entries) {
      visited += 1;
      const full = path.join(current.dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.level + 1 < depth && !/^\.(git|Trash|npm|pnpm-store|cache)$/i.test(entry.name)) {
          stack.push({ dir: full, level: current.level + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fsp.stat(full);
        if (stat.size >= minMiB * 1024 * 1024) {
          found.push({ path: full, name: entry.name, size: stat.size, mtime: stat.mtimeMs });
        }
      } catch (_) { /* 忽略无权限项 */ }
    }
    if (visited > 40000) break;
  }
  found.sort((a, b) => b.size - a.size);
  return { ok: true, root, minMiB, scanned: visited, truncated: Date.now() >= deadline, total: found.length, items: found.slice(0, limit) };
}

/* ------------------------------------------------------------------ *
 * 缓存与清理目标表（白名单）
 * ------------------------------------------------------------------ */

/**
 * 每个条目是「能力」而不是「路径」：
 *   kind=dir   -> 只删 path（表里写死的绝对路径，外部无法构造）
 *   kind=exec  -> 跑官方自带的清理命令（比直接删目录安全）
 * risk：low 可放心清；medium 会让某些软件重新生成缓存/丢日志；
 *       high 属于用户数据（比如 iOS 备份），默认不勾、只做展示。
 */
/* 做请求校验用的静态 id 集合。它必须是 cacheTargets() 实际产出的超集 ——
   cacheTargets() 结尾有自检，改表忘了同步会当场抛错，而不是悄悄把校验放宽。
   之所以不直接拿 cacheTargets() 来校验：它会去问 brew/npm/pnpm/yarn，
   实测满载时光 brew --cache 就能等好几分钟，不能挂在每次清理请求的路径上。 */
const CACHE_TARGET_IDS = new Set(['brew-cache', 'npm-cache', 'pnpm-store', 'yarn-cache', 'homebrew-downloads', 'xcode-derived', 'simulator-caches', 'go-build', 'pip-cache', 'cargo-cache', 'diagnostic-reports', 'user-caches', 'user-logs', 'trash', 'ios-backups', 'huggingface']);

async function cacheTargets() {
  /* 先问 brew 在不在：没有 Homebrew 的机器（Windows / 多数 Linux）上这条命令必然 ENOENT，
     白跑一次还会在清理请求的路径上拖时间。 */
  const brewCacheDir = (await which('brew')) ? (await text('brew', ['--cache'], 8000, { env: BREW_ENV })).trim() : '';
  const npmCacheDir = (await text('npm', ['config', 'get', 'cache'], 5000)).trim();
  const pnpmStore = (await text('pnpm', ['store', 'path'], 6000)).trim();
  const yarnCache = (await text('yarn', ['cache', 'dir'], 6000)).trim();
  const libraryCaches = path.join(HOME, 'Library', 'Caches');
  const linuxCache = path.join(HOME, '.cache');
  const list = [
    { id: 'brew-cache', category: '包管理器', label: 'Homebrew 下载缓存', kind: 'exec', risk: 'low', defaultSelected: true,
      path: brewCacheDir || '', cmd: ['brew', ['cleanup', '-s', '--prune=all']],
      note: '用 brew cleanup -s 清理，过期的安装包和旧版本会被移除；不会动已安装的软件。' },
    { id: 'npm-cache', category: '包管理器', label: 'npm 缓存', kind: 'exec', risk: 'low', defaultSelected: true,
      path: npmCacheDir || path.join(HOME, '.npm'), cmd: ['npm', ['cache', 'clean', '--force']],
      note: '下次安装依赖会重新下载，不影响已安装的项目。' },
    { id: 'pnpm-store', category: '包管理器', label: 'pnpm 内容寻址仓库', kind: 'exec', risk: 'low', defaultSelected: false,
      path: pnpmStore || '', cmd: ['pnpm', ['store', 'prune']],
      note: '只移除没有被任何项目引用的包，安全。' },
    { id: 'yarn-cache', category: '包管理器', label: 'Yarn 缓存', kind: 'exec', risk: 'low', defaultSelected: false,
      path: yarnCache || '', cmd: ['yarn', ['cache', 'clean']],
      note: '清空 Yarn 下载缓存，后续安装会重新下载。' },
    { id: 'homebrew-downloads', category: '包管理器', label: 'Homebrew 下载目录', kind: 'dir', risk: 'low', defaultSelected: false,
      path: path.join(libraryCaches, 'Homebrew'),
      note: '安装包缓存目录，删掉后重新安装会重新下载。' },
    { id: 'xcode-derived', category: '构建产物', label: 'Xcode DerivedData', kind: 'dir', risk: 'low', defaultSelected: true,
      path: path.join(HOME, 'Library', 'Developer', 'Xcode', 'DerivedData'),
      note: 'Xcode 的中间产物，删掉只会让下次编译变慢一点，是 macOS 上最常见的空间黑洞之一。' },
    { id: 'simulator-caches', category: '开发工具', label: 'iOS 模拟器缓存', kind: 'dir', risk: 'low', defaultSelected: false,
      path: path.join(HOME, 'Library', 'Developer', 'CoreSimulator', 'Caches'),
      note: '模拟器运行时缓存，可安全删除。' },
    { id: 'go-build', category: '构建产物', label: 'Go 构建缓存', kind: 'dir', risk: 'low', defaultSelected: false,
      path: path.join(libraryCaches, 'go-build'),
      note: '删除后首次构建会重新编译，其余无影响。' },
    { id: 'pip-cache', category: '包管理器', label: 'pip 下载缓存', kind: 'dir', risk: 'low', defaultSelected: false,
      path: path.join(libraryCaches, 'pip'),
      note: 'Python 包下载缓存，可安全删除。' },
    { id: 'cargo-cache', category: '包管理器', label: 'Cargo 下载缓存', kind: 'dir', risk: 'low', defaultSelected: false,
      path: path.join(HOME, '.cargo', 'registry', 'cache'),
      note: 'Rust crate 源码缓存，删除后重新拉取。' },
    { id: 'diagnostic-reports', category: '系统与日志', label: '崩溃诊断报告', kind: 'dir', risk: 'low', defaultSelected: true,
      path: path.join(HOME, 'Library', 'Logs', 'DiagnosticReports'),
      note: '系统和应用的崩溃日志，排查问题时才需要；删除不影响任何功能。' },
    { id: 'user-caches', category: '系统与日志', label: '用户级缓存目录（全部）', kind: 'dir', risk: 'medium', defaultSelected: false,
      path: IS_MAC ? libraryCaches : linuxCache,
      note: '这里面是各应用的缓存（浏览器缓存、缩略图、Electron 应用的数据缓存）。清理常见于「清理工具」，但少数应用会因此需要重新登录，请按需选择。' },
    { id: 'user-logs', category: '系统与日志', label: '用户日志目录', kind: 'dir', risk: 'medium', defaultSelected: false,
      path: path.join(HOME, 'Library', 'Logs'),
      note: '应用日志。删掉只是失去历史日志，但个别应用会重新建目录。' },
    { id: 'trash', category: '废纸篓', label: '废纸篓', kind: 'dir', risk: 'medium', defaultSelected: false,
      path: path.join(HOME, '.Trash'),
      note: '会永久删除废纸篓里的内容，无法恢复。' },
    { id: 'ios-backups', category: '设备备份', label: 'iOS 设备备份', kind: 'dir', risk: 'high', defaultSelected: false,
      path: path.join(HOME, 'Library', 'Application Support', 'MobileSync', 'Backup'),
      note: 'iPhone/iPad 的本地备份，属于重要用户数据，请先确认不需要再用。' },
    { id: 'huggingface', category: '模型与数据', label: 'HuggingFace 模型缓存', kind: 'dir', risk: 'high', defaultSelected: false,
      path: path.join(HOME, '.cache', 'huggingface'),
      note: '本地模型权重，删掉后需要重新下载（可能几十 GB）。' },
  ];
  for (const item of list) {
    if (!CACHE_TARGET_IDS.has(item.id)) throw new Error('清理目标表与校验 id 集合不一致：' + item.id);
  }
  return list;
}

/* ------------------------------------------------------------------ 服务自重启
 * 目标：不依赖任何进程守护（supervisor），也能把这台机器上的 CodeScope 换一个新进程。
 * 做法：先把一个「引导脚本」以脱离终端的身份拉起来 —— 它会等旧的 HTTP 响应发完、收掉旧进程、
 *      再启动新的 node server.js，并把新进程的 stdout/stderr 落到日志文件里（比挂在终端里更好查）。
 * 关键顺序：**先成功拉起引导脚本，再让旧进程退出**，这样即使新进程起不来也留有日志。
 * 明确拒绝的场景：Electron 桌面壳（它自己管进程）、pm2 等守护（它们有自己的重启命令）。
 */
const RESTART = { inFlight: false, at: 0, lastResult: null };

function SERVER_PORT_VALUE() {
  const raw = Number(process.env.CODESCOPE_PORT || process.env.MASSCODE_RUNNER_PORT || 4877);
  return Number.isInteger(raw) && raw > 0 && raw <= 65535 ? raw : 4877;
}
const SERVER_PORT = SERVER_PORT_VALUE();

/* 日志位置：优先沿用上一次重启定下的路径；否则沿用**当前进程正在写的那份**日志
   （例如从启动脚本拉起时是 ~/Library/Logs/codescope-web.log）—— 重启后日志应该还在同一个地方，
   而不是突然改道到临时目录让用户找不到。 */
function serverLogPath() {
  if (process.env.CODESCOPE_SERVER_LOG) return process.env.CODESCOPE_SERVER_LOG;
  try {
    const current = fs.realpathSync('/dev/fd/1');
    if (current && !/^\/dev\/|^\/private\/dev\//.test(current) && fs.statSync(current).isFile()) return current;
  } catch (_) { /* 终端或管道，退回到临时目录 */ }
  return path.join(os.tmpdir(), 'codescope-server.log');
}

function restartBlockReason() {
  if (process.versions.electron) return '当前跑在 Electron 桌面壳里，请用桌面应用自己的重启入口';
  if (process.env.pm_id || process.env.PM2_HOME) return '当前由 pm2 托管，请用 pm2 restart 重启';
  if (!process.argv[1] || !fs.existsSync(process.argv[1])) return '找不到启动脚本路径，无法自动重启';
  return '';
}

async function performRestart() {
  if (RESTART.inFlight) throw Object.assign(new Error('已经有一个重启在进行中，请稍候'), { statusCode: 409 });
  const reason = restartBlockReason();
  if (reason) throw Object.assign(new Error(reason), { statusCode: 400 });

  const log = serverLogPath();
  const configPath = path.join(os.tmpdir(), 'codescope-restart-' + Date.now() + '.json');
  const starterPath = path.join(os.tmpdir(), 'codescope-restart-starter.js');
  const config = {
    pid: process.pid,
    port: SERVER_PORT,
    execPath: process.execPath,
    script: path.resolve(process.argv[1]),
    cwd: process.cwd(),
    log,
    graceMs: 1500,
    /* 把当前环境原样带过去，并记住这次定下的日志路径。 */
    env: Object.assign({}, process.env, { CODESCOPE_SERVER_LOG: log }),
  };

  const starter = [
    "/* CodeScope 自重启引导脚本：由码境滑块管家按需生成，完成一次换进程后自行退出。 */",
    "'use strict';",
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const http = require('http');",
    "const raw = fs.readFileSync(process.argv[2], 'utf8');",
    "const cfg = JSON.parse(raw);",
    "try { fs.unlinkSync(process.argv[2]); } catch (_) {}   /* 该文件带着完整环境变量，读完立刻销毁 */",
    "const log = fs.openSync(cfg.log, 'a');",
    "const LF = String.fromCharCode(10);",
    "const note = (line) => { try { fs.writeSync(log, '[' + new Date().toISOString() + '] [restart] ' + line + LF); } catch (_) {} };",
    "const wait = (ms) => new Promise((r) => setTimeout(r, ms));",
    "const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };",
    "function probe() {",
    "  return new Promise((resolve) => {",
    "    const req = http.get({ host: '127.0.0.1', port: cfg.port, path: '/api/version', timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });",
    "    req.on('error', () => resolve(false));",
    "    req.on('timeout', () => { req.destroy(); resolve(false); });",
    "  });",
    "}",
    "(async () => {",
    "  note('准备重启：旧 PID ' + cfg.pid + '，端口 ' + cfg.port + '，脚本 ' + cfg.script);",
    "  await wait(cfg.graceMs || 1500);",
    "  if (alive(cfg.pid)) { try { process.kill(cfg.pid, 'SIGTERM'); note('已请求旧进程退出（SIGTERM）'); } catch (e) { note('SIGTERM 失败：' + e.message); } }",
    "  for (let i = 0; i < 24 && alive(cfg.pid); i += 1) await wait(250);",
    "  if (alive(cfg.pid)) { try { process.kill(cfg.pid, 'SIGKILL'); note('旧进程未按时退出，已强制结束'); } catch (_) {} await wait(600); }",
    "  for (let i = 0; i < 40 && (await probe()); i += 1) await wait(250);",
    "  for (let attempt = 1; attempt <= 3; attempt += 1) {",
    "    note('第 ' + attempt + ' 次启动新进程');",
    "    let child;",
    "    try { child = spawn(cfg.execPath, [cfg.script], { cwd: cfg.cwd, env: cfg.env, detached: true, stdio: ['ignore', log, log] }); }",
    "    catch (error) { note('启动失败：' + error.message); continue; }",
    "    child.unref();",
    "    note('新进程 PID ' + child.pid);",
    "    for (let i = 0; i < 80; i += 1) {",
    "      await wait(500);",
    "      if (await probe()) { note('服务已就绪（PID ' + child.pid + '）'); try { fs.closeSync(log); } catch (_) {} process.exit(0); }",
    "      if (!alive(child.pid)) { note('新进程已退出，稍后重试'); break; }",
    "    }",
    "  }",
    "  note('重启失败：服务没能起来，请查看本日志');",
    "  try { fs.closeSync(log); } catch (_) {}",
    "  process.exit(1);",
    "})();",
  ].join('\n');

  /* 生成的引导脚本必须先自己能解析 —— 语法不过就抛错，绝不去碰旧进程。
     （这里吃过一次亏：生成时一个 \n 转义被解析成真换行，脚本语法错误，
       旧进程却已经被兜底逻辑退出了，结果服务直接空窗。） */
  try { new vm.Script(starter, { filename: 'codescope-restart-starter.js' }); }
  catch (error) { throw Object.assign(new Error('重启引导脚本生成失败（已中止，服务未受影响）：' + error.message), { statusCode: 500 }); }

  await fsp.writeFile(configPath, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
  await fsp.writeFile(starterPath, starter, 'utf8');
  const child = spawnLauncher(starterPath, configPath);
  RESTART.inFlight = true;
  RESTART.at = Date.now();
  RESTART.lastResult = { pid: process.pid, newLauncher: child.pid, port: SERVER_PORT, log, at: RESTART.at };
  /* 退出一律交给引导脚本。这里**故意不设**「到点自己退出」的兜底 ——
     万一引导脚本没干活，旧进程继续跑着才是最安全的结果（用户重试即可），
     而不是服务空窗、还得靠人肉去终端救。 */
  return { oldPid: process.pid, launcherPid: child.pid, port: SERVER_PORT, log, execPath: process.execPath, script: config.script };
}

function spawnLauncher(starterPath, configPath) {
  const child = spawn(process.execPath, [starterPath, configPath], { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

/** 目录存在与否、当前占用多少。 */
async function scanTargets(ids, onLine) {
  const all = await cacheTargets();
  const wanted = ids && ids.length ? all.filter((item) => ids.includes(item.id)) : all;
  const results = [];
  for (const target of wanted) {
    let size = null;
    let timedOut = false;
    if (target.path) {
      /* 大目录（用户级缓存动辄几十 GB）du 很慢，给足 3 分钟；超时要能区分出来。
         命令同样问平台层（Windows 没有 du，走 PowerShell 递归求和，单位字节）。 */
      const plan = HOST.commands.dirUsage(target.path);
      const measured = await exec(plan.file, plan.args, { timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
      size = parseDirSizeOutput(measured.stdout, plan.unit);
      if (size == null) timedOut = !!measured.timedOut;
    }
    const exists = target.path ? await fsp.access(target.path).then(() => true).catch(() => false) : null;
    const row = { id: target.id, category: target.category, label: target.label, risk: target.risk, kind: target.kind, path: target.path, size, exists, timedOut, note: target.note, defaultSelected: !!target.defaultSelected };
    results.push(row);
    if (onLine) onLine(`${row.label}: ${size == null ? (timedOut ? '统计超时（目录过大）' : (exists === false ? '不存在' : '无法统计')) : bytesLabel(size)}`);
  }
  return results;
}

function bytesLabel(value) {
  const number = Number(value) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = number;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return (index === 0 ? size : size.toFixed(size >= 100 ? 0 : 1)) + ' ' + units[index];
}

/* ------------------------------------------------------------------ *
 * 服务与端口
 * ------------------------------------------------------------------ */

async function brewServices() {
  if (!(await which('brew'))) return [];
  return remember('brew-services', 15 * 1000, async () => {
    const raw = await text('brew', ['services', 'list'], 60000, { env: BREW_ENV });
    const rows = [];
    for (const line of raw.split(/\r?\n/).slice(1)) {
      const match = /^(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      if (/^Name\s+Status/i.test(line)) continue;
      rows.push({ name: match[1], status: match[2], user: match[3], plist: (match[4] || '').trim(), running: match[2] === 'started' });
    }
    return rows;
  });
}

async function launchAgents() {
  if (IS_MAC) {
    return remember('launch-agents', 20 * 1000, async () => {
      const raw = await text('launchctl', ['list'], 10000);
      const rows = [];
      for (const line of raw.split(/\r?\n/).slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        const label = parts.slice(2).join(' ');
        if (/^com\.apple\./i.test(label)) continue;
        rows.push({
          label,
          pid: parts[0] === '-' ? null : Number(parts[0]),
          lastExit: parts[1] === '-' ? null : Number(parts[1]),
          failed: parts[1] !== '-' && Number(parts[1]) !== 0,
        });
      }
      return rows.sort((a, b) => Number(b.failed) - Number(a.failed) || a.label.localeCompare(b.label));
    });
  }
  if (process.platform === 'linux') {
    return remember('systemd-units', 20 * 1000, async () => {
      const raw = await text('systemctl', ['list-units', '--type=service', '--state=running', '--no-pager', '--no-legend'], 12000);
      const rows = [];
      for (const line of raw.split(/\r?\n/)) {
        const match = /^(\S+\.service)\s+\S+\s+\S+\s+\S+\s+(.*)$/.exec(line.trim());
        if (match) rows.push({ label: match[1], description: match[2], pid: null, lastExit: null, failed: false });
      }
      return rows;
    });
  }
  return [];
}

/* netstat -ano -p TCP 输出 → 监听行（纯函数）。
   格式取自 Windows 官方文档与常见输出样本，未经真机验证：
     协议  本地地址          外部地址        状态           PID
     TCP   0.0.0.0:135       0.0.0.0:0       LISTENING      1304
     TCP   [::]:445          [::]:0          LISTENING      4
   只认「状态列恰好在 PID 前一列、且为 LISTENING」的行 —— 表头、UDP 行、ESTABLISHED 行
   都会在这一步自然滤掉，不需要认识本地化标题。 */
function parseNetstatListen(raw) {
  const rows = [];
  if (!raw || typeof raw !== 'string') return rows;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 5) continue;
    if (!/^LISTENING$/i.test(tokens[tokens.length - 2])) continue;
    const pid = Number(tokens[tokens.length - 1]);
    if (!Number.isInteger(pid) || pid < 0) continue;
    /* 本地地址固定是第 2 列（第 1 列是协议）；IPv6 写成 [::]:445 这种带方括号的形式。 */
    const address = tokens[1] || '';
    const portMatch = /:(\d+)$/.exec(address);
    if (!portMatch) continue;
    rows.push({
      command: '', pid, user: '',
      address, port: Number(portMatch[1]),
      bind: address.replace(/:\d+$/, ''),
      ipv6: address.startsWith('['),
    });
  }
  return rows;
}

/* PID → 进程名：Windows 的 netstat 只给 PID，名字要再问一次 tasklist。
   端口列表 8 秒刷一次，tasklist 没必要跟着刷 —— 这里缓存 60 秒。
   非 Windows（processList() 返回 null）给空表，调用方自然留空。 */
async function processNames() {
  const plan = HOST.commands.processList();
  if (!plan) return new Map();
  return remember('process-names', 60 * 1000, async () => {
    const raw = await text(plan.file, plan.args, 10000);
    const map = new Map();
    for (const row of parseTasklistCsv(raw)) map.set(row.pid, row.command);
    return map;
  });
}

/** 监听中的端口：拿去和「哪个服务、哪个项目」对上号。 */
async function listeningPorts() {
  return remember('ports', 8 * 1000, async () => {
    const rows = [];
    /* 「先试哪个」交给 HOST 决定：macOS → lsof；Linux → ss 优先，ss 不在时才退回 lsof；
       Windows → netstat -ano -p TCP（它只给 PID，进程名由 processNames() 用 tasklist 补齐）。 */
    const firstPlan = HOST.commands.listenerPlans('')[0] || {};
    if (firstPlan.via === 'netstat') {
      const raw = await text(firstPlan.file, firstPlan.args, 12000);
      const names = await processNames();
      for (const item of parseNetstatListen(raw)) {
        rows.push(Object.assign({}, item, { command: names.get(item.pid) || '' }));
      }
    }
    /* 下面这套只走 posix。Windows 上 which('ss')/which('lsof') 本来也都会落空，
       但显式闸住更安全：万一用户的 PATH 里真有 Git 版 lsof，别在两套输出上叠床架屋。 */
    const posixChain = firstPlan.via !== 'netstat';
    const lsofFirst = firstPlan.via === 'lsof';
    const useLsof = posixChain && (lsofFirst ? !!(await which('lsof')) : (!(await which('ss')) && !!(await which('lsof'))));
    if (useLsof) {
      /* lsof 只要有进程看不了就以非 0 退出，stdout 依旧是有效的 —— 用 exec 不用 text。 */
      const raw = (await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { timeout: 12000 })).stdout;
      for (const line of raw.split(/\r?\n/)) {
        /* lsof 列数随版本变（COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME），
           但监听地址永远在最后一列 —— 按「最后一个 token」取最稳。 */
        const tokens = line.trim().split(/\s+/);
        if (tokens.length < 9 || tokens[0] === 'COMMAND' || !/^\d+$/.test(tokens[1])) continue;
        /* 地址不一定是最后一列：macOS 的 NAME 之后还会跟一个 "(LISTEN)"，
           所以从后往前扫，取第一个长得像地址的 token。 */
        let address = '';
        for (let i = tokens.length - 1; i >= 3; i -= 1) {
          if (/:(\d+)$/.test(tokens[i])) { address = tokens[i]; break; }
        }
        const portMatch = /:(\d+)$/.exec(address);
        if (!portMatch) continue;
        rows.push({
          command: tokens[0], pid: Number(tokens[1]), user: tokens[2],
          address, port: Number(portMatch[1]), bind: address.replace(/:\d+$/, ''),
          ipv6: /\[/.test(address),
        });
      }
    } else if (posixChain && await which('ss')) {
      const raw = await text('ss', ['-lntp'], 10000);
      for (const line of raw.split(/\r?\n/)) {
        if (!/^LISTEN/.test(line)) continue;
        const tokens = line.trim().split(/\s+/);
        const address = tokens[3] || '';
        const portMatch = /:(\d+)$/.exec(address);
        const pidMatch = /pid=(\d+)/.exec(line);
        const nameMatch = /users:\(\("([^"]+)"/.exec(line);
        if (!portMatch) continue;
        rows.push({
          command: nameMatch ? nameMatch[1] : '', pid: pidMatch ? Number(pidMatch[1]) : null, user: '',
          address, port: Number(portMatch[1]), bind: tokens[4] || '', ipv6: /\[/.test(address),
        });
      }
    }
    const seen = new Set();
    return rows
      .filter((row) => {
        const key = row.port + '/' + row.pid + '/' + row.bind;
        if (seen.has(key)) return false;
        seen.add(key);
        return row.port > 0;
      })
      .sort((a, b) => a.port - b.port);
  });
}

/* ------------------------------------------------------------------ *
 * 软件（Homebrew）
 * ------------------------------------------------------------------ */

async function brewInstalled() {
  if (!(await which('brew'))) return { available: false, formulae: [], casks: [] };
  return remember('brew-installed', 60 * 1000, async () => {
    const [formulae, casks] = await Promise.all([
      text('brew', ['list', '--formula', '--versions'], 300000, { env: BREW_ENV }),
      text('brew', ['list', '--cask', '--versions'], 300000, { env: BREW_ENV }),
    ]);
    const parse = (raw) => raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/\s+/);
      return { name: parts[0], versions: parts.slice(1).join(' ') };
    });
    return { available: true, formulae: parse(formulae), casks: parse(casks) };
  });
}

async function brewOutdated() {
  if (!(await which('brew'))) return [];
  return remember('brew-outdated', 5 * 60 * 1000, async () => {
    /* 优先 JSON（带版本号/版本状态），老版本 brew 回退纯文本。 */
    const json = await text('brew', ['outdated', '--json=v2'], 300000, { env: BREW_ENV });
    if (json.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(json);
        const formulae = (parsed.formulae || []).map((item) => ({
          name: item.name, installed: (item.installed_versions || []).join(','),
          current: item.current_version, pinned: !!item.pinned,
        }));
        const casks = (parsed.casks || []).map((item) => ({
          name: item.name, installed: (item.installed_versions || []).join(','),
          current: item.current_version, pinned: false,
        }));
        return formulae.concat(casks);
      } catch (_) { /* 落到文本解析 */ }
    }
    return json.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = /^(\S+)\s+\(([^)]+)\)\s*<*\s*(\S+)/.exec(line);
      return match ? { name: match[1], installed: match[2], current: match[3], pinned: false } : { name: line, installed: '', current: '', pinned: false };
    });
  });
}

async function brewInfo(name) {
  if (!name) return null;
  const raw = await text('brew', ['info', '--json=v2', name], 60000, { env: BREW_ENV });
  try {
    const parsed = JSON.parse(raw);
    const item = (parsed.formulae && parsed.formulae[0]) || (parsed.casks && parsed.casks[0]);
    if (!item) return null;
    return {
      name: item.name || item.token,
      desc: item.desc || item.name || '',
      homepage: item.homepage || '',
      version: item.versions ? (item.versions.stable || '') : '',
      installed: !!((item.installed && item.installed.length) || item.installed),
      deps: item.dependencies || [],
    };
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Docker
 * ------------------------------------------------------------------ */

async function dockerState() {
  const cli = await which('docker');
  if (!cli) return { cli: null, available: false, daemon: 'missing', message: '没有检测到 docker 命令' };
  const endpoint = dockerEndpoint();
  const info = await exec('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 8000 });
  const client = await text('docker', ['version', '--format', '{{.Client.Version}}'], 6000);
  const context = (await text('docker', ['context', 'show'], 6000)).trim();
  const contextHost = (await text('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], 6000)).trim();
  const running = info.code === 0 && !!info.stdout.trim();
  /* 守护进程在跑、但命令行当前指向一个不存在的 socket —— 这是 macOS + colima 上最常见的假故障，
     其它工具（终端里的 docker、CI 脚本、别的面板）都会一起报错，所以要把修法直接说出来。 */
  const contextSocket = contextHost.startsWith('unix://') ? contextHost.slice(7) : '';
  const cliMismatch = running && !!contextSocket && !fs.existsSync(contextSocket);
  let manager = '';
  if (await which('colima')) {
    const status = await exec('colima', ['status', '-j'], { timeout: 8000 });
    if (status.code === 0 && status.stdout.trim()) manager = 'colima';
  }
  if (!manager && IS_MAC) {
    const apps = await exec('ls', ['/Applications'], { timeout: 4000 });
    if (/\bDocker\.app\b/.test(apps.stdout)) manager = 'docker-desktop';
  }
  return {
    cli: cli.split('/').pop() || 'docker',
    client: (client || '').trim(),
    available: running,
    daemon: running ? 'running' : 'stopped',
    serverVersion: (info.stdout || '').trim(),
    context,
    manager,
    endpoint: endpoint.host,
    endpointSource: endpoint.source,
    contextHost,
    contextHint: cliMismatch
      ? '守护进程在 ' + endpoint.host + ' 上正常运行，但 docker 命令当前指向 ' + contextHost + '（该文件不存在），所以命令行会报连接失败。修法：docker context create colima --docker host=' + endpoint.host + ' && docker context use colima'
      : '',
    message: running ? '' : (info.stderr || info.error || '').split('\n')[0] || 'Docker 守护进程未运行',
  };
}

async function dockerList() {
  const state = await dockerState();
  if (!state.available) return { state, containers: [], images: [], volumes: [], usage: [] };
  const [containers, images, volumes, systemDf] = await Promise.all([
    text('docker', ['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}'], 15000),
    text('docker', ['images', '--format', '{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedSince}}'], 15000),
    text('docker', ['volume', 'ls', '--format', '{{.Name}}\t{{.Driver}}'], 15000),
    text('docker', ['system', 'df'], 15000),
  ]);
  const rows = containers.split(/\r?\n/).filter(Boolean).map((line) => {
    const [id, name, image, stateText, status, ports] = line.split('\t');
    return { id, name, image, state: stateText, status, ports: ports || '', running: stateText === 'running' };
  });
  const imageRows = images.split(/\r?\n/).filter(Boolean).map((line) => {
    const [repository, tag, id, size, created] = line.split('\t');
    return { repository, tag, id, size, created };
  });
  const volumeRows = volumes.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, driver] = line.split('\t');
    return { name, driver };
  });
  const usage = systemDf.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const parts = line.trim().split(/\s{2,}/);
    return { type: parts[0] || '', count: parts[1] || '', active: parts[2] || '', size: parts[3] || '', reclaimable: parts[4] || '' };
  });
  return { state, containers: rows, images: imageRows, volumes: volumeRows, usage };
}

async function dockerAction(action, id, onLine) {
  const state = await dockerState();
  const clean = String(id || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(clean) && clean) {
    throw Object.assign(new Error('非法的容器/镜像标识'), { statusCode: 400 });
  }
  switch (action) {
    case 'daemon-start':
      if (!state.manager) throw Object.assign(new Error('没有找到 Docker 运行时（colima 或 Docker Desktop）'), { statusCode: 400 });
      if (state.manager === 'colima') { onLine('colima start …'); await runForeground('colima', ['start'], 240000, onLine); }
      else { await runForeground('open', ['-a', 'Docker'], 20000, onLine); }
      return { ok: true, action };
    case 'daemon-stop':
      if (state.manager === 'colima') { onLine('colima stop …'); await runForeground('colima', ['stop'], 120000, onLine); }
      else if (state.manager === 'docker-desktop') { await runForeground('osascript', ['-e', 'quit app "Docker"'], 30000, onLine); }
      else throw Object.assign(new Error('没有找到可停止的 Docker 运行时'), { statusCode: 400 });
      return { ok: true, action };
    case 'start': case 'stop': case 'restart':
      if (!clean) throw Object.assign(new Error('缺少容器 id'), { statusCode: 400 });
      await runForeground('docker', [action, clean], 90000, onLine);
      return { ok: true, action, id: clean };
    case 'rm':
      if (!clean) throw Object.assign(new Error('缺少容器 id'), { statusCode: 400 });
      await runForeground('docker', ['rm', '-f', clean], 90000, onLine);
      return { ok: true, action, id: clean };
    case 'rmi':
      if (!clean) throw Object.assign(new Error('缺少镜像 id'), { statusCode: 400 });
      await runForeground('docker', ['rmi', clean], 90000, onLine);
      return { ok: true, action, id: clean };
    case 'rm-volume':
      if (!clean) throw Object.assign(new Error('缺少卷名'), { statusCode: 400 });
      await runForeground('docker', ['volume', 'rm', clean], 60000, onLine);
      return { ok: true, action, id: clean };
    case 'prune':
      await runForeground('docker', ['system', 'prune', '-a', '-f'], 300000, onLine);
      return { ok: true, action };
    case 'prune-volumes':
      await runForeground('docker', ['volume', 'prune', '-f'], 200000, onLine);
      return { ok: true, action };
    default:
      throw Object.assign(new Error('不支持的 Docker 操作：' + action), { statusCode: 400 });
  }
}

/** 需要等待结果的前台命令（短任务直接用，长任务走 task）。 */
async function runForeground(cmd, args, timeout, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: Object.assign({}, process.env) });
    const feed = (stream) => (chunk) => {
      String(chunk).split(/\r?\n/).filter((line) => line.trim()).forEach((line) => onLine && onLine(line.slice(0, 400)));
    };
    child.stdout.on('data', feed('out'));
    child.stderr.on('data', feed('err'));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, timeout);
    child.on('error', (error) => { clearTimeout(timer); reject(Object.assign(new Error(String(error.message || error)), { statusCode: 500 })); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ code });
      else reject(Object.assign(new Error(cmd + ' 退出码 ' + code), { statusCode: 500 }));
    });
  });
}

/* ------------------------------------------------------------------ *
 * 开发环境
 * ------------------------------------------------------------------ */

const VERSION_PROBES = [
  { key: 'node', label: 'Node.js', cmd: ['node', ['-v']] },
  { key: 'npm', label: 'npm', cmd: ['npm', ['-v']] },
  { key: 'pnpm', label: 'pnpm', cmd: ['pnpm', ['-v']] },
  { key: 'yarn', label: 'yarn', cmd: ['yarn', ['-v']] },
  { key: 'bun', label: 'bun', cmd: ['bun', ['-v']] },
  { key: 'python3', label: 'Python', cmd: [IS_WIN ? 'python' : 'python3', ['-V']] },
  { key: 'git', label: 'Git', cmd: ['git', ['--version']] },
  { key: 'go', label: 'Go', cmd: ['go', ['version']] },
  { key: 'rustc', label: 'Rust', cmd: ['rustc', ['--version']] },
  { key: 'java', label: 'Java', cmd: ['java', ['-version']] },
  { key: 'docker', label: 'Docker', cmd: ['docker', ['-v']] },
  { key: 'brew', label: 'Homebrew', cmd: ['brew', ['--version']] },
  { key: 'code', label: 'VS Code', cmd: ['code', ['--version']] },
];

async function devVersions() {
  return remember('dev-versions', 60 * 1000, async () => {
    const rows = [];
    for (const probe of VERSION_PROBES) {
      const found = await which(probe.cmd[0]);
      if (!found) { rows.push({ key: probe.key, label: probe.label, available: false, version: '', path: '' }); continue; }
      const result = await exec(probe.cmd[0], probe.cmd[1], { timeout: 8000 });
      const first = (result.stdout || result.stderr || '').split(/\r?\n/).find((line) => line.trim()) || '';
      rows.push({ key: probe.key, label: probe.label, available: true, version: first.trim().slice(0, 120), path: found });
    }
    return rows;
  });
}

/** 在配置的开发目录里找 git 仓库（深度受限，避免把整块盘扫一遍）。 */
async function findGitRepos(roots, maxDepth = 3, maxRepos = 60) {
  const repos = [];
  const seen = new Set();
  const walk = async (dir, level) => {
    if (repos.length >= maxRepos || level > maxDepth) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    if (entries.some((entry) => entry.name === '.git' && (entry.isDirectory() || entry.isFile()))) {
      if (!seen.has(dir)) { seen.add(dir); repos.push(dir); }
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (/^(node_modules|\.git|Library|Applications|\.Trash|dist|build|\.next|vendor)$/.test(entry.name)) continue;
      await walk(path.join(dir, entry.name), level + 1);
      if (repos.length >= maxRepos) return;
    }
  };
  for (const root of roots) {
    try {
      const stat = await fsp.stat(root);
      if (stat.isDirectory()) await walk(root, 1);
    } catch (_) { /* 目录不存在就跳过 */ }
  }
  return repos;
}

async function gitStatus(repo) {
  const result = await exec('git', ['-C', repo, 'status', '--porcelain=v2', '--branch', '--untracked-files=no'], { timeout: 12000 });
  if (result.code !== 0) return { path: repo, name: path.basename(repo), error: (result.stderr || '').split('\n')[0] || '不是 git 仓库' };
  let branch = '';
  let upstream = '';
  let ahead = 0;
  let behind = 0;
  let changed = 0;
  let staged = 0;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18).trim();
    else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line);
      if (match) { ahead = Number(match[1]); behind = Number(match[2]); }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      changed += 1;
      if (line.split(' ')[1] && line.split(' ')[1][0] !== '.') staged += 1;
    } else if (line.startsWith('u ')) changed += 1;
  }
  const lastCommit = await text('git', ['-C', repo, 'log', '-1', '--format=%h\t%ct\t%s'], 8000);
  const [hash, at, subject] = lastCommit.trim().split('\t');
  return {
    path: repo, name: path.basename(repo), branch, upstream, ahead, behind, changed, staged,
    dirty: changed > 0, commit: hash || '', commitAt: at ? Number(at) * 1000 : 0, subject: subject || '',
  };
}

async function devRepos(config) {
  const roots = (config && config.devRoots || []).slice(0, 12);
  const repos = await findGitRepos(roots, clampNumber(config && config.maxDepth, 1, 5, 3), 60);
  const results = [];
  const queue = repos.slice();
  const workers = new Array(4).fill(0).map(async () => {
    while (queue.length) {
      const repo = queue.shift();
      results.push(await gitStatus(repo));
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => (b.dirty ? 1 : 0) - (a.dirty ? 1 : 0) || (b.commitAt || 0) - (a.commitAt || 0));
}

/* ------------------------------------------------------------------ *
 * 任务（长操作）：流式输出 + 可取消
 * ------------------------------------------------------------------ */

const TASKS = new Map();
let taskSeq = 1;

function createTaskRecord(kind, label) {
  const task = {
    id: 't' + (taskSeq += 1).toString(36) + Date.now().toString(36).slice(-4),
    kind, label,
    status: 'running',
    lines: [],
    startedAt: Date.now(),
    endedAt: 0,
    exit: null,
    error: '',
    child: null,
    cancelled: false,
    listeners: new Set(),
  };
  TASKS.set(task.id, task);
  /* 只保留最近 40 个任务，避免长驻进程里无限增长。 */
  if (TASKS.size > 40) {
    const stale = [...TASKS.values()].filter((item) => item.status !== 'running').sort((a, b) => a.startedAt - b.startedAt);
    while (TASKS.size > 40 && stale.length) TASKS.delete(stale.shift().id);
  }
  return task;
}

function taskEmit(task, stream, textValue) {
  const text = String(textValue == null ? '' : textValue).replace(/\s+$/, '');
  if (!text) return;
  const entry = { t: Date.now(), stream, text: text.slice(0, 2000) };
  task.lines.push(entry);
  if (task.lines.length > 4000) task.lines.splice(0, 1000);
  for (const listener of task.listeners) {
    try { listener(entry); } catch (_) { /* 忽略断开的连接 */ }
  }
}

function taskFinish(task, status, exitCode, errorText) {
  task.status = status;
  task.exit = exitCode == null ? null : exitCode;
  task.endedAt = Date.now();
  if (errorText) task.error = String(errorText).slice(0, 500);
  for (const listener of task.listeners) {
    try { listener(null); } catch (_) {}
  }
  task.listeners.clear();
  task.child = null;
}

/* 环境管理器是模块级单例：TASK_KINDS 在模块级定义，函数里的局部变量它看不见。
   由 createSystemPanel 在启动时赋值，取值一律走 envManager() 以免出现「未定义」的裸错。 */
let ENV = null;
function envManager() {
  if (!ENV) throw Object.assign(new Error('环境管理器尚未初始化'), { statusCode: 503 });
  return ENV;
}

/* VPS 远程同步同理：任务类型定义在模块级，只能看见模块级引用。 */
let SYNC = null;
function syncManager() {
  if (!SYNC) throw Object.assign(new Error('远程同步管理器尚未初始化'), { statusCode: 503 });
  return SYNC;
}

/* 任务输出统一走 taskEmit：环境更新要把 npm 的实时输出流到任务控制台。 */
function withEmit(task, helpers) {
  return Object.assign({}, helpers, { emit: (stream, text) => taskEmit(task, stream, text) });
}

const TASK_KINDS = {
  'caches.scan': {
    label: () => '统计缓存占用',
    run: async (task, params) => {
      taskEmit(task, 'out', '开始统计缓存占用…');
      const rows = await scanTargets(params.ids, (line) => taskEmit(task, 'out', line));
      const total = rows.reduce((sum, row) => sum + (row.size || 0), 0);
      taskEmit(task, 'out', '已统计 ' + rows.length + ' 项，合计 ' + bytesLabel(total));
      task.result = { targets: rows, total };
      return 0;
    },
  },
  'caches.clean': {
    label: (params) => '清理' + (params && params.ids ? params.ids.length : 0) + ' 项缓存',
    run: async (task, params, helpers) => {
      const dryRun = !!params.dryRun;
      const all = await cacheTargets();
      const selected = all.filter((item) => (params.ids || []).includes(item.id));
      if (!selected.length) throw Object.assign(new Error('没有选中任何可清理项'), { statusCode: 400 });
      const before = await volumes();
      const beforeFree = (before.find((disk) => isInside(disk.mount, HOME)) || before[0] || {}).free || 0;
      taskEmit(task, 'out', dryRun ? '预览模式：不会真的删除任何东西。' : '开始清理 ' + selected.length + ' 项…');
      const done = [];
      for (const target of selected) {
        const size = target.path ? await dirSize(target.path, 25000) : null;
        if (dryRun) {
          taskEmit(task, 'out', '[预览] ' + target.label + '（' + (size == null ? '未知大小' : bytesLabel(size)) + '）→ ' +
            (target.kind === 'exec' ? helpers.describe(target.cmd) : '删除 ' + target.path));
          continue;
        }
        if (target.kind === 'exec') {
          taskEmit(task, 'out', target.label + '：' + helpers.describe(target.cmd));
          const code = await helpers.spawnStep(task, target.cmd[0], target.cmd[1], 600000);
          done.push({ id: target.id, label: target.label, size, code });
          taskEmit(task, code === 0 ? 'out' : 'err', target.label + ' 完成（退出码 ' + code + '）');
        } else {
          const resolved = target.path;
          /* 双保险：只允许删除表里写死的绝对路径，且不是家目录/根目录本身。 */
          const allowed = all.some((item) => item.kind === 'dir' && item.path === resolved);
          if (!allowed || resolved === HOME || resolved === '/' || resolved.length < 8) {
            taskEmit(task, 'err', '跳过可疑路径：' + resolved);
            continue;
          }
          taskEmit(task, 'out', '正在删除 ' + resolved + '（' + (size == null ? '未知' : bytesLabel(size)) + '）');
          try {
            await fsp.rm(resolved, { recursive: true, force: true, maxRetries: 1 });
            done.push({ id: target.id, label: target.label, size, code: 0 });
          } catch (error) {
            taskEmit(task, 'err', '删除失败：' + (error.message || error));
            done.push({ id: target.id, label: target.label, size, code: 1, error: String(error.message || error) });
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      const after = await volumes();
      const afterFree = (after.find((disk) => isInside(disk.mount, HOME)) || after[0] || {}).free || 0;
      const freed = Math.max(0, afterFree - beforeFree);
      const estimated = done.reduce((sum, item) => sum + (item.size || 0), 0);
      taskEmit(task, 'out', dryRun
        ? '预览结束：预计可释放 ' + bytesLabel(selected.reduce((sum, item) => sum + (item.size || 0), 0))
        : '清理完成：磁盘可用空间增加 ' + bytesLabel(freed) + '（选中项统计约 ' + bytesLabel(estimated) + '）');
      task.result = { freed, estimated, dryRun, items: done };
      forget('brew-services');
      return 0;
    },
  },
  'brew.upgrade': {
    label: (params) => '升级 ' + (params && params.name ? params.name : '全部软件包'),
    run: async (task, params, helpers) => {
      const name = params.name ? assertBrewName(params.name) : '';
      const args = name ? ['upgrade', name] : ['upgrade'];
      taskEmit(task, 'out', 'brew ' + args.join(' '));
      const code = await helpers.spawnStep(task, 'brew', args, 3600000, { HOMEBREW_NO_AUTO_UPDATE: '1' });
      if (code === 0) { forget('brew-installed'); forget('brew-outdated'); forget('brew-cache-size'); }
      return code;
    },
  },
  'brew.install': {
    label: (params) => '安装 ' + (params && params.name),
    run: async (task, params, helpers) => {
      const name = assertBrewName(params.name);
      const code = await helpers.spawnStep(task, 'brew', ['install', name], 1800000);
      if (code === 0) forget('brew-installed');
      return code;
    },
  },
  'brew.uninstall': {
    label: (params) => '卸载 ' + (params && params.name),
    run: async (task, params, helpers) => {
      const name = assertBrewName(params.name);
      const code = await helpers.spawnStep(task, 'brew', ['uninstall', name], 600000);
      if (code === 0) { forget('brew-installed'); forget('brew-outdated'); }
      return code;
    },
  },
  'brew.cleanup': {
    label: () => 'brew cleanup -s --prune=all',
    run: async (task, params, helpers) => {
      const code = await helpers.spawnStep(task, 'brew', ['cleanup', '-s', '--prune=all'], 900000);
      if (code === 0) forget('brew-installed');
      return code;
    },
  },
  'brew.autoremove': {
    label: () => 'brew autoremove',
    run: async (task, params, helpers) => helpers.spawnStep(task, 'brew', ['autoremove'], 600000),
  },
  'brew.services': {
    label: (params) => 'brew services ' + (params && params.action) + ' ' + (params && params.name),
    run: async (task, params, helpers) => {
      const action = String(params.action || '');
      if (!['start', 'stop', 'restart', 'run'].includes(action)) throw Object.assign(new Error('不支持的服务操作'), { statusCode: 400 });
      const name = assertBrewName(params.name);
      const code = await helpers.spawnStep(task, 'brew', ['services', action, name], 180000);
      forget('brew-services');
      return code;
    },
  },
  'docker.action': {
    label: (params) => 'Docker ' + (params && params.action),
    run: async (task, params, helpers) => {
      const outcome = await dockerAction(params.action, params.id, (line) => taskEmit(task, 'out', line));
      return outcome && outcome.ok ? 0 : 1;
    },
  },
  'dev.fetch': {
    label: () => '拉取所有仓库的远端信息',
    run: async (task, params, helpers) => {
      const repos = await devRepos(params.config || {});
      taskEmit(task, 'out', '共 ' + repos.length + ' 个仓库，开始 git fetch…');
      let failed = 0;
      for (const repo of repos) {
        if (task.cancelled) break;
        taskEmit(task, 'out', '→ ' + repo.name);
        const code = await helpers.spawnStep(task, 'git', ['-C', repo.path, 'fetch', '--all', '--prune'], 180000);
        if (code !== 0) failed += 1;
      }
      taskEmit(task, failed ? 'err' : 'out', '完成：' + (repos.length - failed) + ' 成功 / ' + failed + ' 失败');
      return failed ? 1 : 0;
    },
  },
  /* ── 环境更新：装/更新 code-server、重建前端产物、装依赖 ──
     全部走任务系统：能预演、能流式、能取消，且只写该写的地方（code-server 只进 ~/.codescope）。 */
  'env.code-server': {
    label: (params) => (params && params.dryRun ? '预演：' : '') + '安装 / 更新 code-server',
    run: async (task, params, helpers) => envManager().runAction('code-server', params, withEmit(task, helpers), task),
  },
  'env.assets': {
    label: (params) => (params && params.dryRun ? '预演：' : '') + '重建前端产物',
    run: async (task, params, helpers) => envManager().runAction('assets', params, withEmit(task, helpers), task),
  },
  'env.deps': {
    label: (params) => (params && params.dryRun ? '预演：' : '') + '安装项目依赖',
    run: async (task, params, helpers) => envManager().runAction('deps', params, withEmit(task, helpers), task),
  },
  /* ── VPS 远程同步：预演/同步/部署/自检，四件事都走任务系统 ──
     预演不写远端，同步只写 <remoteDir>/<projectName>，部署多一步远端装依赖与白名单重启。 */
  'sync.vps-preview': {
    label: (params) => '预演：同步到 VPS（不写远端）',
    run: async (task, params, helpers) => syncManager().runAction('vps-preview', params, withEmit(task, helpers), task),
  },
  'sync.vps-sync': {
    label: (params) => (params && params.dryRun ? '预演：' : '') + '同步到 VPS',
    run: async (task, params, helpers) => syncManager().runAction('vps-sync', params, withEmit(task, helpers), task),
  },
  'sync.vps-deploy': {
    label: (params) => (params && params.dryRun ? '预演：' : '') + '部署到 VPS（同步 + 装依赖 + 重启）',
    run: async (task, params, helpers) => syncManager().runAction('vps-deploy', params, withEmit(task, helpers), task),
  },
  'sync.vps-check': {
    label: (params) => (params && params.dryRun ? '预演：' : '') + 'VPS 自检（只探测）',
    run: async (task, params, helpers) => syncManager().runAction('vps-check', params, withEmit(task, helpers), task),
  },
};

function assertKnownCacheIds(ids) {
  const unknown = ids.filter((id) => !CACHE_TARGET_IDS.has(id));
  if (unknown.length) throw Object.assign(new Error('不认识这些清理项：' + unknown.join('、')), { statusCode: 400 });
  return ids;
}

function assertBrewName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9@+._/-]{0,120}$/.test(name)) {
    throw Object.assign(new Error('非法的软件包名：' + name), { statusCode: 400 });
  }
  return name;
}

function startTask(kind, params, options = {}) {
  const spec = TASK_KINDS[kind];
  if (!spec) throw Object.assign(new Error('未知任务类型：' + kind), { statusCode: 400 });
  const task = createTaskRecord(kind, spec.label(params || {}));
  const childRef = { current: null };
  const helpers = {
    describe: (cmd) => (cmd ? cmd[0] + ' ' + cmd[1].join(' ') : ''),
    spawnStep: (record, cmd, args, timeout, env) => new Promise((resolve) => {
      if (record.cancelled) return resolve(130);
      let child;
      try {
        child = spawn(cmd, args, { env: Object.assign({}, process.env, env || {}) });
      } catch (error) {
        taskEmit(record, 'err', '无法启动 ' + cmd + '：' + (error.message || error));
        return resolve(127);
      }
      childRef.current = child;
      record.child = child;
      const feed = (stream) => (chunk) => String(chunk).split(/\r?\n/).forEach((line) => taskEmit(record, stream, line));
      child.stdout.on('data', feed('out'));
      child.stderr.on('data', feed('err'));
      const timer = setTimeout(() => {
        taskEmit(record, 'err', cmd + ' 超时（' + Math.round(timeout / 1000) + 's），已终止');
        try { child.kill('SIGKILL'); } catch (_) {}
      }, timeout);
      const done = (code) => { clearTimeout(timer); if (childRef.current === child) { childRef.current = null; record.child = null; } resolve(code == null ? 1 : code); };
      child.on('error', (error) => { taskEmit(record, 'err', String(error.message || error)); done(127); });
      child.on('close', (code) => done(code));
    }),
  };
  Promise.resolve()
    .then(() => spec.run(task, params || {}, helpers))
    .then((code) => taskFinish(task, code === 0 ? 'ok' : 'failed', typeof code === 'number' ? code : 0, ''))
    .catch((error) => {
      taskEmit(task, 'err', String((error && error.message) || error));
      taskFinish(task, 'failed', null, (error && error.message) || error);
    });
  if (options.onTask) { try { options.onTask(task); } catch (_) {} }
  return task;
}

function cancelTask(id) {
  const task = TASKS.get(id);
  if (!task) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });
  if (task.status !== 'running') return { ok: true, status: task.status };
  task.cancelled = true;
  if (task.child) {
    try { task.child.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => { try { if (task.child) task.child.kill('SIGKILL'); } catch (_) {} }, 4000);
  } else {
    taskFinish(task, 'cancelled', 130, '用户取消');
  }
  return { ok: true, status: 'cancelling' };
}

function taskSummary(task) {
  return {
    id: task.id, kind: task.kind, label: task.label, status: task.status,
    startedAt: task.startedAt, endedAt: task.endedAt, exit: task.exit,
    error: task.error, lines: task.lines.length, result: task.result || null,
  };
}

/* ------------------------------------------------------------------ *
 * HTTP 层：只处理 /api/system-panel/*
 * ------------------------------------------------------------------ */

function sendJson(res, code, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('请求体过大'), { statusCode: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function createSystemPanel(options = {}) {
  const dataRoot = options.dataRoot || path.join(os.homedir(), '.codescope');
  const log = typeof options.log === 'function' ? options.log : () => {};
  const configPath = path.join(dataRoot, 'system-panel.json');
  /* 接管 /api/system-panel/files/*：本模块自己转发，server.js 不需要新增派发点。 */
  const FILES = createFileManager({ log, dataRoot });
  /* 软件管理：读本机已装应用 + 真实图标 + 分类/常用/启动，同样自己接管 /apps* 路由。 */
  const SOFTWARE = createSoftwareManager({ log, dataRoot });
  /* 环境检测与更新：赋给模块级引用（任务类型定义在模块级，必须能看见它）。 */
  ENV = createEnvManager({ log, dataRoot, projectRoot: path.join(__dirname, '..') });
  SYNC = createRemoteSync({ log, dataRoot, projectRoot: path.join(__dirname, '..') });
  /* 实时曲线的历史采样：进程一起来就开始，用户打开面板时已经有过去几分钟的数据。 */
  startHistory();

  const readConfig = () => {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        devRoots: Array.isArray(parsed.devRoots) ? parsed.devRoots.filter((item) => typeof item === 'string').slice(0, 12) : defaultRoots(),
        maxDepth: clampNumber(parsed.maxDepth, 1, 5, 3),
      };
    } catch (_) {
      return { devRoots: defaultRoots(), maxDepth: 3 };
    }
  };
  const defaultRoots = () => {
    const candidates = [path.join(HOME, 'Desktop'), path.join(HOME, 'Documents'), path.join(HOME, 'code'), path.join(HOME, 'Projects'), path.join(HOME, 'dev')];
    return candidates.filter((item) => { try { return fs.statSync(item).isDirectory(); } catch (_) { return false; } });
  };
  const writeConfig = (input) => {
    const roots = (Array.isArray(input.devRoots) ? input.devRoots : [])
      .map((item) => String(item || '').trim())
      .filter((item) => item.startsWith('/') || /^[A-Za-z]:[\\/]/.test(item))
      .slice(0, 12);
    const next = { devRoots: roots, maxDepth: clampNumber(input.maxDepth, 1, 5, 3) };
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
    forget('dev-repos');
    return next;
  };

  async function handle(req, res, u) {
    const prefix = '/api/system-panel';
    if (!u.pathname.startsWith(prefix)) return false;
    const rest = u.pathname.slice(prefix.length).replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';
        if (await FILES.handle(req, res, u, rest)) return true;
    if (await SOFTWARE.handle(req, res, u, rest)) return true;

    // 文件全景（只读）：GET /api/system-panel/atlas[?mode=fast|deep][&refresh=1]
    //   分级汇总 + 大文件 Top + 目录下钻 + 清理预演。
    // 只读、有界（maxEntries/maxDepth/deadlineMs 硬上限），绝不删除或移动任何文件。
    if (rest === '/atlas' || rest === '/atlas/scan') {
      if (method !== 'GET') return sendJson(res, 405, { ok: false, error: '文件全景只提供只读 GET' });
      const mode = u.searchParams.get('mode') === 'deep' ? 'deep' : 'fast';
      const force = u.searchParams.get('refresh') === '1';
      /* ★ 落盘缓存 ✓ —— 「扫得慢」的正解是**别重复扫** ✗，不是把参数调小 ✗。
         fast 10 分钟（够快，也够新 ✓）、deep 6 小时（它要 25 秒 ✗，用户不会想重跑 ✓）。
         内存缓存挡不住重启，所以放**磁盘** ✓（重启后第一次打开还是秒开 ✓）。 */
      const TTL = { fast: 10 * 60 * 1000, deep: 6 * 60 * 60 * 1000 };
      const cacheFile = path.join(dataRoot, 'file-atlas-cache-' + mode + '.json');
      const readCache = () => {
        try {
          const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          if (!raw || !raw.data || !raw.at) return null;
          if (Date.now() - raw.at > TTL[mode]) return null;
          return raw;
        } catch (_) { return null; }
      };
      const hit = force ? null : readCache();
      if (hit) return sendJson(res, 200, Object.assign({}, hit.data, { cached: true, cacheAgeMs: Date.now() - hit.at }));
      /* 扫描跑在**子进程**里：目录枚举用的是同步 fs，跑在主进程会把面板整个卡住
         （实测 ~/Library/Containers 的单次 readdirSync 无限阻塞，45 秒都不返回）。
         子进程带硬超时；**超时绝不回退到进程内扫描**，否则面板会再被卡死一次 —— 只如实报错。
         ⚠️ 超时必须按模式给 ✗：深扫实测 24.6 秒 ✓，还按 30 秒卡的话一抖动就被杀掉 ✗。 */
      const childProcess = require('child_process');
      const scriptPath = require('path').join(__dirname, '..', 'scripts', 'file-atlas-scan.js');
      const timeoutMs = mode === 'deep' ? 90000 : 30000;
      const scanned = await new Promise((resolve) => {
        childProcess.execFile(process.execPath, [scriptPath, '--mode=' + mode], { timeout: timeoutMs, maxBuffer: 128 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout) => {
          if (error) return resolve({ ok: false, code: error.code || null, killed: !!error.killed, error: String(error.message || error) });
          try { resolve(JSON.parse(String(stdout))); } catch (parseError) { resolve({ ok: false, error: '扫描结果解析失败：' + parseError.message }); }
        });
      });
      if (scanned && scanned.ok) {
        try { fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), data: scanned })); } catch (_) {}
        return sendJson(res, 200, scanned);
      }
      /* ★★ 这里**故意不再有**「进程内兜底扫描」✗✗ ——
         原来脚本缺失时会退回主进程里同步遍历 ✗，而那正是本文件上面刚警告过的
         「会把面板整个卡死」✗（实测 ~/Library/Containers 的 readdirSync 45 秒不返回 ✗）。
         为了一份降级数据把整个面板冻住，不划算 ✗；脚本就在仓库里 ✓，缺了说明装坏了 ✓，
         如实报错、让用户去修，比假装有数据更诚实 ✓。
         ⚠️ 顺带删掉了那 130 行内联兜底 ✓ —— 它是 scripts/file-atlas-scan.js 的**副本** ✗，
            而且预算硬编码成 4000/3/320 ✗，早就和脚本里的不一致了 ✗（两份必然走偏 ✗）。 */
      if (scanned && scanned.code === 'ENOENT') {
        return sendJson(res, 500, {
          ok: false,
          error: '扫描脚本不存在：' + scriptPath + '（安装不完整？没有回退到进程内扫描 —— 那会把面板卡死）',
        });
      }
      return sendJson(res, 504, {
        ok: false,
        error: '扫描未完成：' + String((scanned && scanned.error) || '无输出') +
          (scanned && scanned.killed ? '（超过 ' + Math.round(timeoutMs / 1000) + ' 秒硬超时，已终止子进程）' : ''),
      });
    }

    try {
      if (rest === '/ping') {
        return sendJson(res, 200, {
          ok: true, panel: PANEL_VERSION, ts: Date.now(),
          pid: process.pid,
          port: SERVER_PORT,
          node: process.version,
          uptime: Math.round(process.uptime()),
          startedAt: Date.now() - Math.round(process.uptime() * 1000),
          logPath: serverLogPath(),
          restartable: restartBlockReason() === '',
          restartBlockReason: restartBlockReason(),
        }), true;
      }

      if (rest === '/overview' && method === 'GET') return sendJson(res, 200, await overview()), true;

      if (rest === '/history' && method === 'GET') return sendJson(res, 200, historySeries(u.searchParams)), true;

      if (rest === '/processes' && method === 'GET') {
        return sendJson(res, 200, await processes({ sort: u.searchParams.get('sort'), limit: u.searchParams.get('limit') })), true;
      }
      if (rest === '/process/kill' && method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, await killProcess(body.pid, body.signal)), true;
      }

      if (rest === '/disks' && method === 'GET') {
        return sendJson(res, 200, { ok: true, volumes: await volumes() }), true;
      }
      if (rest === '/usage' && method === 'GET') {
        const root = String(u.searchParams.get('path') || HOME);
        if (!path.isAbsolute(root)) throw Object.assign(new Error('需要绝对路径'), { statusCode: 400 });
        return sendJson(res, 200, await dirBreakdown(root, { limit: u.searchParams.get('limit'), minBytes: u.searchParams.get('minBytes') })), true;
      }
      if (rest === '/large-files' && method === 'GET') {
        const root = String(u.searchParams.get('path') || HOME);
        if (!path.isAbsolute(root)) throw Object.assign(new Error('需要绝对路径'), { statusCode: 400 });
        return sendJson(res, 200, await largeFiles(root, {
          minMiB: u.searchParams.get('minMiB'), limit: u.searchParams.get('limit'), depth: u.searchParams.get('depth'),
        })), true;
      }
      if (rest === '/caches' && method === 'GET') {
        const cached = CACHE.get('cache-scan');
        const targets = cached && cached.value ? cached.value : [];
        /* 按域分组：清理向导要按「包管理器 / 构建产物 / 系统与日志 …」分块给用户看，
           16 个目标平铺在一起，用户不知道该先处理哪个。 */
        const buckets = new Map();
        for (const target of targets) {
          const name = target.category || '其它';
          const bucket = buckets.get(name) || { category: name, count: 0, bytes: 0, ids: [] };
          bucket.count += 1;
          bucket.bytes += Number(target.size) || 0;
          bucket.ids.push(target.id);
          buckets.set(name, bucket);
        }
        const groups = [...buckets.values()].sort((a, b) => b.bytes - a.bytes);
        return sendJson(res, 200, { ok: true, scannedAt: cached ? cached.at : 0, targets, groups }), true;
      }
      if (rest === '/caches/scan' && method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}));
        const ids = Array.isArray(body.ids) && body.ids.length ? body.ids.map(String) : null;
        if (ids) assertKnownCacheIds(ids);
        const task = startTask('caches.scan', { ids });
        /* 任务结束后把结果落到缓存，前端下次直接秒开。 */
        const timer = setInterval(() => {
          const record = TASKS.get(task.id);
          if (!record || record.status === 'running') return;
          clearInterval(timer);
          if (record.result && record.result.targets) CACHE.set('cache-scan', { at: Date.now(), value: record.result.targets });
        }, 500);
        return sendJson(res, 202, { ok: true, task: taskSummary(task) }), true;
      }
      if (rest === '/clean' && method === 'POST') {
        const body = await readJsonBody(req);
        const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 40) : [];
        if (!ids.length) throw Object.assign(new Error('请先选择要清理的项目'), { statusCode: 400 });
        /* 只可能清理死名单里的条目：前端传什么都越不过这张表。 */
        assertKnownCacheIds(ids);
        const task = startTask('caches.clean', { ids, dryRun: !!body.dryRun });
        return sendJson(res, 202, { ok: true, task: taskSummary(task) }), true;
      }

      if (rest === '/services' && method === 'GET') {
        const [brew, agents, ports] = await Promise.all([brewServices(), launchAgents(), listeningPorts()]);
        return sendJson(res, 200, { ok: true, brew, agents, ports }), true;
      }

      if (rest === '/software' && method === 'GET') {
        const brewAvailable = !!(await which('brew'));
        if (!brewAvailable) return sendJson(res, 200, { ok: true, brew: { available: false, formulae: [], casks: [] }, outdated: [], loading: { installed: false, outdated: false } }), true;
        /* 这两个探测都可能跑很久，所以「有缓存先给缓存 + 后台焐热」，绝不阻塞接口。 */
        const installed = softCache('brew-installed', 5 * 60 * 1000, brewInstalled);
        const outdated = softCache('brew-outdated', 10 * 60 * 1000, brewOutdated);
        return sendJson(res, 200, {
          ok: true,
          brew: { available: true, ready: installed.ready, formulae: (installed.value && installed.value.formulae) || [], casks: (installed.value && installed.value.casks) || [] },
          outdated: outdated.value || [],
          outdatedReady: outdated.ready,
          loadedAt: installed.at,
          loading: { installed: installed.loading, outdated: outdated.loading },
        }), true;
      }
      if (rest === '/software/info' && method === 'GET') {
        return sendJson(res, 200, { ok: true, info: await brewInfo(u.searchParams.get('name')) }), true;
      }
      if (rest === '/software' && method === 'POST') {
        const body = await readJsonBody(req);
        const action = String(body.action || '');
        const map = {
          upgrade: 'brew.upgrade', install: 'brew.install', uninstall: 'brew.uninstall',
          cleanup: 'brew.cleanup', autoremove: 'brew.autoremove', service: 'brew.services',
        };
        const kind = map[action];
        if (!kind) throw Object.assign(new Error('不支持的软件管理操作：' + action), { statusCode: 400 });
        if (action === 'service') {
          const serviceAction = String(body.serviceAction || '');
          if (!['start', 'stop', 'restart'].includes(serviceAction)) {
            throw Object.assign(new Error('服务操作只能是 start / stop / restart'), { statusCode: 400 });
          }
          const serviceTask = startTask(kind, { action: serviceAction, name: assertBrewName(body.name) });
          return sendJson(res, 202, { ok: true, task: taskSummary(serviceTask) }), true;
        }
        if (action === 'install' || action === 'uninstall') {
          if (!String(body.name || '').trim()) throw Object.assign(new Error('请填写软件包名'), { statusCode: 400 });
          const namedTask = startTask(kind, { name: assertBrewName(body.name), cask: !!body.cask });
          return sendJson(res, 202, { ok: true, task: taskSummary(namedTask) }), true;
        }
        const task = startTask(kind, { name: body.name ? assertBrewName(body.name) : undefined });
        return sendJson(res, 202, { ok: true, task: taskSummary(task) }), true;
      }

      if (rest === '/docker' && method === 'GET') {
        return sendJson(res, 200, Object.assign({ ok: true }, await dockerList())), true;
      }
      if (rest === '/docker' && method === 'POST') {
        const body = await readJsonBody(req);
        const action = String(body.action || '');
        const DOCKER_ACTIONS = ['daemon-start', 'daemon-stop', 'start', 'stop', 'restart', 'rm', 'rmi', 'rm-volume', 'prune', 'prune-volumes'];
        if (!DOCKER_ACTIONS.includes(action)) throw Object.assign(new Error('不支持的 Docker 操作：' + action), { statusCode: 400 });
        const dockerId = body.id == null ? '' : String(body.id).trim();
        if (['start', 'stop', 'restart', 'rm', 'rmi', 'rm-volume'].includes(action) && !dockerId) {
          throw Object.assign(new Error('缺少容器 / 镜像 / 数据卷标识'), { statusCode: 400 });
        }
        if (dockerId && !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,200}$/.test(dockerId)) {
          throw Object.assign(new Error('标识里含有非法字符'), { statusCode: 400 });
        }
        const task = startTask('docker.action', { action, id: dockerId });
        return sendJson(res, 202, { ok: true, task: taskSummary(task) }), true;
      }

      if (rest === '/dev' && method === 'GET') {
        const config = readConfig();
        const [versions, repos] = await Promise.all([
          devVersions(),
          remember('dev-repos', 20 * 1000, () => devRepos(config)),
        ]);
        return sendJson(res, 200, { ok: true, config, versions, repos }), true;
      }
      if (rest === '/dev' && method === 'POST') {
        const body = await readJsonBody(req);
        if (body.action === 'config') {
          const incoming = (body.config && body.config.devRoots) || body.devRoots || [];
          const devRoots = [];
          for (const raw of [].concat(incoming).slice(0, 12)) {
            const root = String(raw == null ? '' : raw).trim();
            if (!root) continue;
            if (!path.isAbsolute(root)) throw Object.assign(new Error('开发目录必须是绝对路径：' + root), { statusCode: 400 });
            devRoots.push(root);
          }
          const next = Object.assign({}, body.config || body, { devRoots });
          return sendJson(res, 200, { ok: true, config: writeConfig(next) }), true;
        }
        if (body.action === 'fetch') {
          const task = startTask('dev.fetch', { config: readConfig() });
          return sendJson(res, 202, { ok: true, task: taskSummary(task) }), true;
        }
        throw Object.assign(new Error('不支持的开发管理操作'), { statusCode: 400 });
      }

      if (rest === '/restart' && method === 'POST') {
        const info = await performRestart();
        /* 先回包再退出：前端拿到 202 后去轮询 /api/version 与 /ping，就能自己判断换好了没有。 */
        return sendJson(res, 202, { ok: true, restarting: true, ...info, hint: '服务正在换进程，约 3-10 秒；期间刷新会短暂不可用。' }), true;
      }

      if (rest === '/reveal' && method === 'POST') {
        const body = await readJsonBody(req);
        const target = String(body.path || '');
        if (!path.isAbsolute(target)) throw Object.assign(new Error('需要绝对路径'), { statusCode: 400 });
        try { await fsp.access(target); } catch (_) { throw Object.assign(new Error('路径不存在：' + target), { statusCode: 404 }); }
        if (IS_MAC) await runForeground('open', ['-R', target], 15000, () => {});
        else if (IS_WIN) await runForeground('explorer', ['/select,' + target], 15000, () => {});
        else await runForeground('xdg-open', [path.dirname(target)], 15000, () => {});
        return sendJson(res, 200, { ok: true }), true;
      }
      if (rest === '/open' && method === 'POST') {
        const body = await readJsonBody(req);
        const target = String(body.path || '');
        /* 只允许打开网页链接。以前这里也允许绝对路径，但 `open <文件>` 等于
           启动任意程序 / 打开任意文件，「本机管家」不需要这个能力，直接砍掉。 */
        if (!/^https?:\/\//i.test(target)) throw Object.assign(new Error('只允许打开 http(s) 链接'), { statusCode: 400 });
        if (IS_MAC) await runForeground('open', [target], 15000, () => {});
        else if (IS_WIN) await runForeground('cmd', ['/c', 'start', '', target], 15000, () => {});
        else await runForeground('xdg-open', [target], 15000, () => {});
        return sendJson(res, 200, { ok: true }), true;
      }

      if (rest === '/tasks' && method === 'GET') {
        return sendJson(res, 200, { ok: true, tasks: [...TASKS.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20).map(taskSummary) }), true;
      }
      const streamMatch = /^\/tasks\/([A-Za-z0-9]+)\/stream$/.exec(rest);
      if (streamMatch && method === 'GET') {
        const task = TASKS.get(streamMatch[1]);
        if (!task) return sendJson(res, 404, { ok: false, error: '任务不存在' }), true;
        return streamTask(req, res, task), true;
      }
      const cancelMatch = /^\/tasks\/([A-Za-z0-9]+)\/cancel$/.exec(rest);
      if (cancelMatch && method === 'POST') {
        return sendJson(res, 200, cancelTask(cancelMatch[1])), true;
      }

      /* ── 环境检测与更新 ── */
      if (rest === '/env' && method === 'GET') {
        const force = u.searchParams && u.searchParams.get('refresh') === '1';
        return sendJson(res, 200, { ok: true, env: await envManager().report(force) }), true;
      }
      /* ── VPS 远程同步：配置读写 + 起任务。target 校验由 setConfig 负责，非法值 400 不落盘 ── */
      if (rest === '/sync/vps' && method === 'GET') {
        const force = !!u.searchParams.get('refresh');
        return sendJson(res, 200, { ok: true, config: syncManager().getConfig(), report: await syncManager().report(force) }), true;
      }
      if (rest === '/sync/vps' && method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, { ok: true, config: syncManager().setConfig(body || {}) }), true;
      }
      if (rest === '/sync/vps/update' && method === 'POST') {
        const body = await readJsonBody(req);
        const action = String((body && body.action) || '').trim();
        if (!syncManager().actionSpecs().some((item) => item.id === action)) {
          const error = new Error('未知的同步动作：' + action);
          error.statusCode = 400;
          throw error;
        }
        const task = startTask('sync.' + action, { dryRun: !!(body && body.dryRun) });
        return sendJson(res, 202, { ok: true, task: taskSummary(task) }), true;
      }
      if (rest === '/env/update' && method === 'POST') {
        const body = await readJsonBody(req);
        const action = String((body && body.action) || '').trim();
        if (!envManager().actionSpecs().some((item) => item.id === action)) {
          throw Object.assign(new Error('未知的环境更新动作：' + action), { statusCode: 400 });
        }
        const task = startTask('env.' + action, { dryRun: !!(body && body.dryRun) });
        return sendJson(res, 202, { ok: true, task: taskSummary(task) }), true;
      }

      return sendJson(res, 404, { ok: false, error: '本机管家没有这个接口：' + rest }), true;
    } catch (error) {
      const code = error && error.statusCode ? error.statusCode : 500;
      if (code >= 500) log('[本机管家] ' + rest + ' 失败：' + ((error && error.stack) || error));
      return sendJson(res, code, { ok: false, error: String((error && error.message) || error) }), true;
    }
  }

  /** SSE：先补发已有输出，再订阅后续；断线自动清理。 */
  function streamTask(req, res, task) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const write = (event, data) => {
      try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (_) {}
    };
    write('meta', { id: task.id, kind: task.kind, label: task.label, status: task.status });
    for (const line of task.lines) write('line', line);
    if (task.status !== 'running') {
      write('done', { status: task.status, exit: task.exit, ms: task.endedAt - task.startedAt, error: task.error, result: task.result || null });
      try { res.end(); } catch (_) {}
      return true;
    }
    const listener = (entry) => {
      if (entry) return write('line', entry);
      write('done', { status: task.status, exit: task.exit, ms: task.endedAt - task.startedAt, error: task.error, result: task.result || null });
      try { res.end(); } catch (_) {}
    };
    task.listeners.add(listener);
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
    const cleanup = () => { clearInterval(heartbeat); task.listeners.delete(listener); };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
    return true;
  }

  return {
    handle,
    panelVersion: PANEL_VERSION,
    overview, processes, volumes, cacheTargets, dockerList, devRepos,
    startTask, cancelTask, tasks: TASKS, configPath,
    _internal: { exec, dirSize, dirBreakdown, largeFiles, volumes, listeningPorts, brewServices, launchAgents, brewInstalled, brewOutdated, brewInfo, devVersions, dockerState, dockerList, scanTargets },
  };
}

module.exports = {
  createSystemPanel, cacheTargets, TASK_KINDS, PANEL_VERSION,
  /* 纯解析函数单独导出给测试用：输入「命令输出的字符串」、输出结构化数组/数字，
     不碰进程、不碰文件系统 —— 本机是 macOS，Windows 分支只能靠样本测试验收。 */
  _parsers: {
    parsePsOutput, parseTasklistCsv, parseNetstatListen, parseWindowsVolumes, parseDirSizeOutput, parseKbLabel, splitCsvLine,
  },
};
