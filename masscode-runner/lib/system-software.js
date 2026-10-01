/*
 * 本机管家 · 软件管理
 *
 * 只做四件事，全部只读或「用户点一下才发生」：
 *   1. 读取本机已装的应用（/Applications、/System/Applications、~/Applications）
 *   2. 从 .app 里取出**真实图标**（.icns → sips 转 PNG，缓存到数据目录）
 *   3. 分类、搜索、标记常用、按启动次数排「常用」
 *   4. 点击启动（open -a）与在访达里显示（open -R）
 *
 * 安全边界：本模块**不会**删除、移动、改名任何应用；不带 shell，全部 execFile 直传参数。
 * 卸载能力只保留给 brew（在 system-panel 的 /software 里，且必须先预演）。
 */

/* 平台差异统一问 lib/platform.js。 */
const { HOST } = require('./platform');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const HOME = os.homedir();
const IS_MAC = process.platform === 'darwin';
const ICON_SIZE = 128;
const CACHE_TTL = 10 * 60 * 1000;
/* 缓存 schema 版本：算法/字段一变就 +1，让老的缓存自动失效。
   上一版把 appRoots().source 写成中文，老缓存里存着「系统自带也可卸载」的错误结论，
   只靠 TTL 会继续骗人 —— 版本号能让它立刻重扫。 */
const CACHE_VERSION = 2;

/* macOS 官方的 LSApplicationCategoryType → 中文分组。没写分类的按来源目录兜底。 */
const CATEGORY_LABELS = {
  'public.app-category.developer-tools': '开发工具',
  'public.app-category.graphics-design': '设计与图形',
  'public.app-category.productivity': '效率办公',
  'public.app-category.utilities': '实用工具',
  'public.app-category.video': '影音',
  'public.app-category.music': '影音',
  'public.app-category.photography': '设计与图形',
  'public.app-category.social-networking': '社交沟通',
  'public.app-category.business': '效率办公',
  'public.app-category.finance': '效率办公',
  'public.app-category.education': '学习',
  'public.app-category.entertainment': '影音',
  'public.app-category.games': '游戏',
  'public.app-category.news': '资讯',
  'public.app-category.medical': '其它',
  'public.app-category.reference': '学习',
  'public.app-category.travel': '其它',
  'public.app-category.sports': '其它',
  'public.app-category.weather': '其它',
  'public.app-category.magazines-newspapers': '资讯',
  'public.app-category.action-games': '游戏',
  'public.app-category.web-browsers': '网络',
  'public.app-category.network': '网络',
};

/* 图标和名字的启发式兜底：bundle id 里常常带着厂商名。 */
const KNOWN_VENDORS = [
  [/google/i, 'Google'], [/microsoft|msft/i, 'Microsoft'], [/adobe/i, 'Adobe'], [/jetbrains/i, 'JetBrains'],
  [/apple/i, 'Apple'], [/docker/i, 'Docker'], [/tencent|wechat|qq/i, '腾讯'], [/alibaba|taobao|aliyun/i, '阿里'],
  [/bytedance|lark|feishu/i, '字节跳动'], [/jetbrains/i, 'JetBrains'],
];

function sendJson(res, status, payload, extraHeaders) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  }, extraHeaders || {}));
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
  const buffer = await readBody(req, 256 * 1024);
  if (!buffer.length) return {};
  try { return JSON.parse(buffer.toString('utf8')); } catch (_) { throw Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 }); }
}

function trustedOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
  } catch (_) { return false; }
}

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeout || 10000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || '') });
    });
  });
}

function hash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 20);
}

/* ------------------------------- 应用扫描 ------------------------------- */

async function appDirs() {
  /* 平台差异：macOS 扫 .app、Linux 扫 .desktop、Windows 扫开始菜单 + Program Files。 */
    const roots = HOST.appRoots().map((item) => ({ dir: item.dir, source: item.source }));
  const out = [];
  for (const item of roots) {
    try {
      const stats = await fsp.stat(item.dir);
      if (stats.isDirectory()) out.push(item);
    } catch (_) { /* 目录不存在就跳过，属正常 */ }
  }
  return out;
}

/* 只认一层 + 一层嵌套（Adobe/ 这类厂商目录），不做无界递归。 */
async function collectBundles(root) {
  const found = [];
  let entries = [];
  try { entries = await fsp.readdir(root.dir, { withFileTypes: true }); } catch (_) { return found; }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root.dir, entry.name);
    if (entry.name.endsWith('.app')) { found.push(full); continue; }
    /* 厂商目录：只往下一层，且要求确实是目录。 */
    let children = [];
    try { children = await fsp.readdir(full, { withFileTypes: true }); } catch (_) { continue; }
    for (const child of children) {
      if (child.isDirectory() && child.name.endsWith('.app')) found.push(path.join(full, child.name));
    }
  }
  return found;
}

/* Linux：扫 .desktop（XDG 桌面条目）。只读一层，不递归。 */
async function collectDesktopEntries(root) {
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(root.dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.name.endsWith('.desktop') || entry.name.startsWith('.')) continue;
    const full = path.join(root.dir, entry.name);
    let text = '';
    try { text = await fsp.readFile(full, 'utf8'); } catch (_) { continue; }
    const parsed = HOST.parseDesktopEntry(text);
    if (!parsed) continue;
    out.push({ appPath: full, source: root.source, entry: parsed });
  }
  return out;
}

function desktopRecord(item) {
  const entry = item.entry || {};
  return {
    id: hash(item.appPath),
    name: entry.name || path.basename(item.appPath, '.desktop'),
    path: item.appPath,
    bundleId: '',
    version: '',
    category: entry.categories || '',
    vendor: '',
    source: item.source,
    system: item.source !== 'user',
    icon: !!entry.icon,
    /* Linux 上没有「卸载一个 app」这回事（.desktop 只是入口，包还在），
       所以这里明说不可卸载，而不是把 .desktop 丢进废纸篓冒充卸载。 */
    uninstallable: false,
    exec: entry.exec || '',
    /* Icon= 的**原值**要留着：可能是绝对路径（/usr/share/pixmaps/x.png），
       也可能是主题名（firefox）。图标路由按它去允许的目录里找。 */
    iconPath: entry.icon || '',
    hidden: !!entry.noDisplay,
  };
}

/* Windows：开始菜单 .lnk 给「用户看见的应用」，Program Files 目录给「装了什么」。 */
async function collectShortcuts(root) {
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(root.dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root.dir, entry.name);
    if (entry.isFile() && /\.lnk$/i.test(entry.name)) out.push({ appPath: full, source: root.source, via: 'lnk' });
    else if (entry.isDirectory() && /Program Files/i.test(String(root.label || ''))) out.push({ appPath: full, source: root.source, via: 'dir' });
  }
  return out;
}

function shortcutRecord(item) {
  const base = path.basename(item.appPath).replace(/\.lnk$/i, '');
  return {
    id: hash(item.appPath),
    name: base,
    path: item.appPath,
    bundleId: '',
    version: '',
    category: '',
    vendor: '',
    source: item.source,
    system: item.source !== 'user',
    icon: false,
    uninstallable: false,
    exec: '',
    hidden: false,
  };
}

/* 读 Info.plist：优先 plutil 转 JSON（二进制 plist 也能读），失败再按 XML 文本兜底。 */
async function readPlist(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const json = await run('plutil', ['-convert', 'json', '-o', '-', plist], 8000);
  if (json.ok && json.stdout.trim()) {
    try { return JSON.parse(json.stdout); } catch (_) { /* 落到文本兜底 */ }
  }
  try {
    const text = await fsp.readFile(plist, 'utf8');
    const grab = (key) => {
      const match = new RegExp('<key>' + key + '</key>\\s*<string>([^<]*)</string>').exec(text);
      return match ? match[1] : '';
    };
    return {
      CFBundleName: grab('CFBundleName'),
      CFBundleDisplayName: grab('CFBundleDisplayName'),
      CFBundleShortVersionString: grab('CFBundleShortVersionString'),
      CFBundleIdentifier: grab('CFBundleIdentifier'),
      LSApplicationCategoryType: grab('LSApplicationCategoryType'),
      CFBundleIconFile: grab('CFBundleIconFile'),
    };
  } catch (_) { return {}; }
}

function categoryOf(plist, source) {
  const raw = String(plist.LSApplicationCategoryType || '').trim();
  if (CATEGORY_LABELS[raw]) return CATEGORY_LABELS[raw];
  if (/^public\.app-category\./.test(raw)) {
    const tail = raw.replace('public.app-category.', '').replace(/-/g, ' ');
    return tail || '其它';
  }
  if (source === 'apple') return '系统自带';
  const id = String(plist.CFBundleIdentifier || '');
  if (/\.(chrome|safari|firefox|edge|brave|arc)(\.|$)/i.test(id) || /browser/i.test(id)) return '网络';
  if (/xcode|terminal|iterm|code|sublime|jetbrains|nova|tower|postman|docker/i.test(id + ' ' + plist.CFBundleName)) return '开发工具';
  return '其它';
}

function vendorOf(plist) {
  const text = String(plist.CFBundleIdentifier || '') + ' ' + String(plist.CFBundleName || '');
  for (const [pattern, name] of KNOWN_VENDORS) if (pattern.test(text)) return name;
  return '';
}

function appRecord(appPath, plist, source) {
  const name = String(plist.CFBundleDisplayName || plist.CFBundleName || path.basename(appPath, '.app')).trim();
  const bundleId = String(plist.CFBundleIdentifier || '').trim();
  const version = String(plist.CFBundleShortVersionString || '').trim();
  return {
    id: hash(appPath),
    name: name || path.basename(appPath, '.app'),
    path: appPath,
    bundleId,
    version,
    category: categoryOf(plist, source),
    vendor: vendorOf(plist),
    source,
    system: source === 'apple',
    icon: iconCandidates(appPath, plist).length > 0,
    uninstallable: source !== 'apple',
  };
}

function iconCandidates(appPath, plist) {
  const dir = path.join(appPath, 'Contents', 'Resources');
  const out = [];
  const declared = String(plist.CFBundleIconFile || '').trim();
  if (declared) {
    out.push(path.join(dir, declared));
    if (!/\.icns$/i.test(declared)) out.push(path.join(dir, declared + '.icns'));
  }
  try {
    for (const file of fs.readdirSync(dir)) if (/\.icns$/i.test(file)) out.push(path.join(dir, file));
  } catch (_) { /* 没有 Resources 就只剩占位图标 */ }
  return out.filter((item) => { try { return fs.statSync(item).isFile(); } catch (_) { return false; } });
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

/* ------------------------------- 管理器 ------------------------------- */

function createSoftwareManager(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const dataRoot = options.dataRoot || path.join(HOME, '.codescope');
  const cacheFile = path.join(dataRoot, 'system-panel-apps.json');
  const iconDir = path.join(dataRoot, 'system-panel-icons');

  let cache = { version: CACHE_VERSION, scannedAt: 0, apps: [], favorites: [], runs: {} };
  try {
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (saved && Array.isArray(saved.apps)) {
      cache = {
        version: 1,
        scannedAt: Number(saved.scannedAt) || 0,
        apps: saved.apps.filter((item) => item && item.id && item.path),
        favorites: Array.isArray(saved.favorites) ? saved.favorites.slice(0, 200) : [],
        runs: saved.runs && typeof saved.runs === 'object' ? saved.runs : {},
        icons: saved.icons && typeof saved.icons === 'object' ? saved.icons : {},
      };
    }
  } catch (_) { /* 首次运行 */ }

  let saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(dataRoot, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({
          version: CACHE_VERSION, scannedAt: cache.scannedAt, apps: cache.apps, linuxIcons: cache.linuxIcons || {},
          favorites: cache.favorites, runs: cache.runs, icons: cache.icons || {},
        }), { mode: 0o600 });
      } catch (error) { log('[software] 缓存写入失败：' + error.message); }
    }, 500);
    if (saveTimer.unref) saveTimer.unref();
  }

  function byId(id) {
    return cache.apps.find((item) => item.id === id) || null;
  }

  function decorate(app) {
    return Object.assign({}, app, {
      favorite: cache.favorites.includes(app.id),
      runs: Number(cache.runs[app.id] || 0),
    });
  }

  async function scan() {
    const started = Date.now();
    const roots = await appDirs();
    /* 三平台三套「应用」的概念：macOS 是 .app 包，Linux 是 .desktop 文件，
       Windows 是开始菜单 .lnk 与 Program Files 目录。之前这里只有 macOS 一条路，
       所以在 Linux/Windows 上软件页永远是空的。 */
    const bundles = [];
    for (const root of roots) {
      if (HOST.isMac) {
        for (const item of await collectBundles(root)) bundles.push({ appPath: item, source: root.source });
      } else if (HOST.isLinux) {
        for (const item of await collectDesktopEntries(root)) bundles.push(item);
      } else {
        for (const item of await collectShortcuts(root)) bundles.push(item);
      }
    }
    /* 去重：/System/Applications 与 Utilities 可能同时在两个根里出现。 */
    const unique = new Map();
    for (const item of bundles) if (!unique.has(item.appPath)) unique.set(item.appPath, item);
    const list = [...unique.values()];
    const apps = (await mapLimit(list, 8, async (item) => {
      if (HOST.isMac) return appRecord(item.appPath, await readPlist(item.appPath), item.source);
      if (HOST.isLinux) return desktopRecord(item);
      return shortcutRecord(item);
    })).filter(Boolean);
    /* 同名去重：用户目录的版本优先（/Applications 优先于 /System/Applications）。 */
    const rank = { system: 0, user: 1, apple: 2, flatpak: 3, snap: 3 };
    apps.sort((a, b) => (rank[a.source] - rank[b.source]) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    const seen = new Set();
    const final = [];
    for (const app of apps) {
      const key = (app.bundleId || app.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      final.push(app);
    }
    /* 保留图标缓存映射（id → 文件名），避免重复转换。 */
    cache.icons = cache.icons || {};
    cache.apps = final;
    cache.scannedAt = Date.now();
    cache.version = CACHE_VERSION;
    for (const id of Object.keys(cache.icons)) if (!final.some((item) => item.id === id)) delete cache.icons[id];
    save();
    log('[software] 扫描到 ' + final.length + ' 个应用，用时 ' + (Date.now() - started) + 'ms');
    return final;
  }

  async function ensureFresh(force) {
    const stale = cache.version !== CACHE_VERSION || !cache.apps.length || (Date.now() - cache.scannedAt > CACHE_TTL);
    if (force || stale) await scan();
    return cache.apps;
  }

  /* 主题名净化：Icon= 里只取文件名，任何路径分隔符与 .. 都丢掉。
     这是个纯函数，专门给「不许路径穿越」这条安全线做可测的边界。 */
  function safeIconName(declared) {
    const raw = String(declared || '').trim();
    if (!raw) return '';
    const name = raw.split(/[\\/]/).pop() || '';
    if (!name || name === '.' || name === '..') return '';
    return /\.png$/i.test(name) ? name.slice(0, -4) : name;
  }

  function linuxIconRoots() {
    const home = os.homedir();
    return [
      '/usr/share/pixmaps',
      '/usr/local/share/pixmaps',
      path.join(home, '.local/share/pixmaps'),
      '/usr/share/icons',
      path.join(home, '.local/share/icons'),
    ];
  }

  function linuxIconFile(app) {
    cache.linuxIcons = cache.linuxIcons || {};
    const cached = cache.linuxIcons[app.id];
    if (cached) {
      return fsp.access(cached).then(() => cached, () => { delete cache.linuxIcons[app.id]; return resolveLinuxIcon(app); });
    }
    return resolveLinuxIcon(app).then((found) => {
      if (!found) return null;
      cache.linuxIcons[app.id] = found;
      save();
      return found;
    });
  }

  /* 只回 png：xpm 浏览器不认，svg 能带脚本、贴着面板同源跑风险太高，宁可不显示。
     所有候选都限制在固定的图标目录里，且文件名经过 safeIconName 净化。 */
  async function resolveLinuxIcon(app) {
    const declared = String(app.iconPath || '').trim();
    if (!declared) return null;
    const roots = linuxIconRoots();
    const acceptable = async (candidate) => {
      if (!/\.png$/i.test(candidate)) return false;
      if (!roots.some((root) => candidate === root || candidate.startsWith(root + path.sep))) return false;
      try {
        const stat = await fsp.stat(candidate);
        return stat.isFile() && stat.size > 0 && stat.size <= 4 * 1024 * 1024;
      } catch (_) { return false; }
    };
    if (declared.startsWith('/')) {
      const direct = path.resolve(declared);
      return (await acceptable(direct)) ? direct : null;
    }
    const name = safeIconName(declared);
    if (!name) return null;
    for (const dir of ['/usr/share/pixmaps', '/usr/local/share/pixmaps', path.join(os.homedir(), '.local/share/pixmaps')]) {
      const candidate = path.join(dir, name + '.png');
      if (await acceptable(candidate)) return candidate;
    }
    const sizes = ['512x512', '256x256', '128x128', '96x96', '64x64', '48x48', '32x32'];
    for (const root of ['/usr/share/icons', path.join(os.homedir(), '.local/share/icons')]) {
      for (const size of sizes) {
        const candidate = path.join(root, 'hicolor', size, 'apps', name + '.png');
        if (await acceptable(candidate)) return candidate;
      }
      let themes = [];
      try {
        themes = (await fsp.readdir(root, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).slice(0, 8);
      } catch (_) { /* 目录不存在就跳过 */ }
      for (const theme of themes) {
        for (const candidate of [
          path.join(root, theme, 'apps', name + '.png'),
          ...sizes.map((size) => path.join(root, theme, size, 'apps', name + '.png')),
        ]) {
          if (await acceptable(candidate)) return candidate;
        }
      }
    }
    return null;
  }

  /* 图标按需转换并缓存：只有界面上真正请求过的应用才会消耗一次 sips。 */
  async function iconFile(app) {
    cache.icons = cache.icons || {};
    const cached = cache.icons[app.id];
    if (cached) {
      const target = path.join(iconDir, cached);
      try { await fsp.access(target); return target; } catch (_) { delete cache.icons[app.id]; }
    }
    /* Linux：图标不是「从 .app 里提取」，而是 .desktop 里指向的现成文件。 */
    if (HOST.isLinux) return linuxIconFile(app);
    /* Windows：需要用 PowerShell 的 ExtractAssociatedIcon 生成 png，这一轮还没接。 */
    if (!IS_MAC) return null;
    const candidates = iconCandidates(app.path, (await readPlist(app.path)) || {});
    if (!candidates.length) return null;
    await fsp.mkdir(iconDir, { recursive: true });
    const name = app.id + '.png';
    const out = path.join(iconDir, name);
    for (const source of candidates.slice(0, 4)) {
      const done = await run('sips', ['-s', 'format', 'png', '-Z', String(ICON_SIZE), source, '--out', out], 12000);
      if (done.ok) {
        try { await fsp.access(out); } catch (_) { continue; }
        cache.icons[app.id] = name;
        save();
        return out;
      }
    }
    return null;
  }

  function summary() {
    const groups = new Map();
    for (const app of cache.apps) {
      const item = decorate(app);
      const bucket = groups.get(app.category) || { category: app.category, count: 0 };
      bucket.count += 1;
      groups.set(app.category, bucket);
    }
    const favorites = cache.favorites.map((id) => byId(id)).filter(Boolean);
    return {
      ok: true,
      scannedAt: cache.scannedAt,
      stale: !cache.apps.length || (Date.now() - cache.scannedAt > CACHE_TTL),
      total: cache.apps.length,
      groups: [...groups.values()].sort((a, b) => b.count - a.count),
      favorites: favorites.map(decorate),
      apps: cache.apps.map(decorate),
    };
  }

  async function handle(req, res, u, rest) {
    const method = req.method || 'GET';
    const query = u.searchParams;

    if (rest === '/apps' && method === 'GET') {
      const force = query.get('refresh') === '1';
      if (force && !trustedOrigin(req)) {
        sendJson(res, 403, { ok: false, error: '非本机来源，拒绝重新扫描' });
        return true;
      }
      await ensureFresh(force);
      sendJson(res, 200, summary());
      return true;
    }

    if (rest === '/apps/icon' && method === 'GET') {
      const app = byId(String(query.get('id') || ''));
      if (!app) { sendJson(res, 404, { ok: false, error: '应用不存在' }); return true; }
      const file = await iconFile(app).catch(() => null);
      if (!file) { sendJson(res, 404, { ok: false, error: '这个应用没有可提取的图标' }); return true; }
      try {
        const body = await fsp.readFile(file);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': body.length,
          'Cache-Control': 'private, max-age=86400',
        });
        res.end(body);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: '图标读取失败：' + error.message });
      }
      return true;
    }

    if (rest === '/apps/detail' && method === 'GET') {
      const app = byId(String(query.get('id') || ''));
      if (!app) { sendJson(res, 404, { ok: false, error: '应用不存在' }); return true; }
      const plist = await readPlist(app.path);
      let size = null;
      const measured = await run('/usr/bin/du', ['-sk', app.path], 15000);
      if (measured.ok) {
        const kb = parseInt(measured.stdout.trim().split(/\s+/)[0], 10);
        if (Number.isFinite(kb)) size = kb * 1024;
      }
      let createdAt = null;
      try { createdAt = (await fsp.stat(app.path)).birthtimeMs || null; } catch (_) { /* 忽略 */ }
      sendJson(res, 200, {
        ok: true,
        app: decorate(app),
        size,
        createdAt,
        info: {
          bundleId: app.bundleId,
          version: app.version,
          shortVersion: String(plist.CFBundleShortVersionString || ''),
          build: String(plist.CFBundleVersion || ''),
          minSystem: String(plist.LSMinimumSystemVersion || ''),
          category: String(plist.LSApplicationCategoryType || ''),
          executable: String(plist.CFBundleExecutable || ''),
          copyright: String(plist.NSHumanReadableCopyright || ''),
        },
      });
      return true;
    }

    if (rest === '/apps/favorite' && method === 'POST') {
      if (!trustedOrigin(req)) { sendJson(res, 403, { ok: false, error: '非本机来源' }); return true; }
      const body = await readJson(req);
      const app = byId(String(body.id || ''));
      if (!app) { sendJson(res, 404, { ok: false, error: '应用不存在' }); return true; }
      const on = body.on !== false;
      cache.favorites = cache.favorites.filter((item) => item !== app.id);
      if (on) cache.favorites.unshift(app.id);
      cache.favorites = cache.favorites.slice(0, 200);
      save();
      sendJson(res, 200, { ok: true, app: decorate(app), favorites: cache.favorites });
      return true;
    }

    if (rest === '/apps/launch' && method === 'POST') {
      if (!trustedOrigin(req)) { sendJson(res, 403, { ok: false, error: '非本机来源' }); return true; }
      const body = await readJson(req);
      const app = byId(String(body.id || ''));
      if (!app) { sendJson(res, 404, { ok: false, error: '应用不存在' }); return true; }
      try { await fsp.access(app.path); } catch (_) { sendJson(res, 410, { ok: false, error: '应用已经不在了：' + app.path }); return true; }
      /* 只启动这一个 bundle，永远不走 shell，也不接受任意命令行。 */
      /* 启动交给平台层：macOS `open -a`、Linux `gtk-launch`（.desktop 才是正确入口，
         xdg-open 对 .desktop 在不少桌面上是「用文本编辑器打开」）、Windows `start`。 */
      const launchSpec = HOST.commands.launchApp(app.path);
      const opened = await run(launchSpec.file, launchSpec.args, 15000);
      if (!opened.ok) { sendJson(res, 500, { ok: false, error: '启动失败，可能被系统安全策略拦下' }); return true; }
      cache.runs[app.id] = Number(cache.runs[app.id] || 0) + 1;
      cache.lastRunAt = cache.lastRunAt || {};
      cache.lastRunAt[app.id] = Date.now();
      save();
      log('[software] 启动 ' + app.name);
      sendJson(res, 200, { ok: true, app: decorate(app) });
      return true;
    }

    if (rest === '/apps/reveal' && method === 'POST') {
      if (!trustedOrigin(req)) { sendJson(res, 403, { ok: false, error: '非本机来源' }); return true; }
      const body = await readJson(req);
      const app = byId(String(body.id || ''));
      if (!app) { sendJson(res, 404, { ok: false, error: '应用不存在' }); return true; }
      const revealSpec = HOST.commands.revealInFileManager(app.path);
      const done = await run(revealSpec.file, revealSpec.args, 15000);
      sendJson(res, done.ok ? 200 : 500, done.ok ? { ok: true } : { ok: false, error: '无法在文件管理器里显示' });
      return true;
    }

    return false;
  }

  return { handle, scan, summary, iconFile, byId, cache };
}

module.exports = { createSoftwareManager, CATEGORY_LABELS };
