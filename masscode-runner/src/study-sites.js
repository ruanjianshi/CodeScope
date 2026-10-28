// 学习工作台网址目录。
// ---------------------------------------------------------------------------
// ⚠️ 这份目录里有一批内网 / NAT 地址与端口表（形如 http://192.0.2.x:端口）——
//    本仓库是公开的（README 链到 github.com/ruanjianshi/massCode），写进源码
//    ✗ 等于把家里的服务端口表一起公开 ✗（2026-10 收口时从源码挪走了）。
//
// ✓ 现在数据只放本机私有目录：<应用数据目录>/site-catalog.json
//    · 应用数据根目录的取法与 server.js 的 applicationDataRoot() 完全一致
//      （macOS 是 ~/Library/Application Support/CodeScope；设了 CODESCOPE_DATA_HOME 就用它）
//    · 浏览器侧读不到磁盘，所以由服务端 GET /api/study/site-catalog 转出来
//      （见 lib/routes/study.js + server.js 的 readSiteCatalog）
//    · ✓ 跟着应用数据一起备份、换机器一起搬走；✗ 不进版本库
//
// ✓ 源码只留一份占位示例：192.0.2.0/24 与 example.com 都是 RFC 2606 / RFC 5737
//    的保留地址，永远不会指向任何真实主机。读不到私有 JSON 时用它兜底，
//    保证 UI 不空 ✓（只是条目少，功能都在）。
//
// ✓ 一次性迁移：node scripts/migrate-site-catalog.js
//    （从 git HEAD 里的旧 src/study-sites.js 把真实条目原样搬进私有 JSON）

const CATALOG_URL = '/api/study/site-catalog';
// 手写 JSON 写崩 UI 的成本很低（几百条就翻不动了 ✓ 实测），服务端和浏览器侧各挡一道 ✓
const MAX_SITES_PER_CATEGORY = 200;

/* 占位示例：只用保留地址 ✓ —— 这些条目**不是**用户的真实数据，别往里填内网地址 ✗。
   ✗ 为什么不用空数组：读不到私有 JSON 时站点菜单会整块空掉，用户会以为功能坏了 ✗。 */
const PLACEHOLDER_CATALOG = {
  featured: [
    { id:'bilibili', label:'B站', url:'https://www.bilibili.com/', color:'#fb7299' },
    { id:'github', label:'GitHub', url:'https://github.com/', color:'#8b949e' },
    { id:'arxiv', label:'arXiv', url:'https://arxiv.org/', color:'#b31b1b' },
    { id:'mdn', label:'MDN', url:'https://developer.mozilla.org/', color:'#62a0ea' },
  ],
  categories: [
    { id:'placeholder-nat', label:'NAT 服务器（占位）', icon:'🖥️', color:'#6aa2ff', sites:[
      { label:'1Panel', url:'http://192.0.2.10:10231/', description:'占位示例 · 面板' },
      { label:'青龙面板', url:'http://192.0.2.10:57000/', description:'占位示例 · 定时任务' },
      { label:'Open WebUI', url:'http://192.0.2.10:30000/', description:'占位示例 · 在线 AI' },
    ] },
    { id:'placeholder-nas', label:'NAS（占位）', icon:'🗄️', color:'#70d6a3', sites:[
      { label:'导航站', url:'http://192.0.2.11:8090/', description:'占位示例 · 导航' },
      { label:'笔记库', url:'http://192.0.2.11:6806/', description:'占位示例 · 笔记', stars:'★★★' },
      { label:'网盘', url:'http://192.0.2.11:5244/', description:'占位示例 · 网盘' },
    ] },
    { id:'placeholder-docs', label:'示例站点', icon:'📚', color:'#55c7d9', sites:[
      { label:'Example 官网', url:'https://example.com/', description:'占位示例 · 保留域名' },
      { label:'Example 文档', url:'https://example.org/docs', description:'占位示例 · 保留域名' },
    ] },
  ],
};

/* ⚠️ 三个导出都必须是**同址可变**的（const 数组 / let 计数）——
   study-workspace.js 在模块求值阶段就抓了引用（`const DEFAULT_BOOKMARKS = FEATURED_SITES`）✓，
   所以私有目录读回来之后只能**原地增删** ✓；重新赋值一个新数组的话，
   早就被抓走的那份引用还停在占位数据上 ✗（这类 bug 在 UI 上表现为「菜单有数据、常用栏没数据」）。 */
export const SITE_CATEGORIES = [];
export const FEATURED_SITES = [];
export let SITE_COUNT = 0;

/* 目录当前来源 ✓ —— 'file' = 读到私有 JSON，'placeholder' = 兜底。
   排障时不用猜「菜单里为什么是 192.0.2.x」✓。 */
export const SITE_CATALOG_STATE = { mode:'placeholder', sites:0 };

const cleanText = (value, limit, fallback) => String(value == null ? '' : value).trim().slice(0, limit) || fallback;
const cleanColor = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback);

function normalizeSite(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim();
  // ✓ 只收浏览器打得开的 http(s) 地址（老规矩 ✓，写在注释里的那条规则现在落到代码里）
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    label: cleanText(raw.label, 24, '网址'),
    url,
    description: cleanText(raw.description, 80, ''),
    stars: cleanText(raw.stars, 12, ''),
  };
}

function normalizeFeatured(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    id: cleanText(raw.id, 32, ''),
    label: cleanText(raw.label, 24, '常用网址'),
    url,
    color: cleanColor(raw.color, '#4f8cff'),
  };
}

function normalizeCatalog(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const categories = [];
  for (const item of Array.isArray(source.categories) ? source.categories : []) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 48) || 'category-' + categories.length;
    if (seen.has(id)) continue;  // 重复分类 id 会让站点被渲染两遍 ✗
    seen.add(id);
    categories.push({
      id,
      label: cleanText(item.label, 24, '网址分类'),
      icon: cleanText(item.icon, 4, '◆'),
      color: cleanColor(item.color, '#70d6a3'),
      sites: (Array.isArray(item.sites) ? item.sites : []).map(normalizeSite).filter(Boolean).slice(0, MAX_SITES_PER_CATEGORY),
    });
  }
  return {
    featured: (Array.isArray(source.featured) ? source.featured : []).map(normalizeFeatured).filter(Boolean),
    categories,
  };
}

function applyCatalog(raw) {
  const next = normalizeCatalog(raw);
  // ✗ 空目录不要：宁可留着现有内容，也不要让菜单整块空掉 ✗
  if (!next.categories.length && !next.featured.length) return false;
  SITE_CATEGORIES.splice(0, SITE_CATEGORIES.length, ...next.categories);
  FEATURED_SITES.splice(0, FEATURED_SITES.length, ...next.featured);
  SITE_COUNT = SITE_CATEGORIES.reduce((total, item) => total + item.sites.length, 0);
  SITE_CATALOG_STATE.sites = SITE_COUNT;
  return true;
}

/* 为什么用**同步** XHR：study-workspace.js 在模块求值阶段就把 FEATURED_SITES 抓进
   DEFAULT_BOOKMARKS 了 ✓，异步拿回来只能改到「以后新建的」引用 ✗。
   同步读发生在 import 阶段、任何渲染之前 ✓，代价是本地一次往返（同源、毫秒级）✓。
   ✗ 换成异步 fetch 的代价：常用栏第一次渲染永远是占位数据 ✗。 */
function loadCatalogSync() {
  if (typeof XMLHttpRequest !== 'function') return null;  // Node 里 import 这个模块时不该炸 ✗
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', CATALOG_URL, false);
    xhr.send(null);
    if (xhr.status !== 200) return null;
    const parsed = JSON.parse(xhr.responseText);
    return parsed && parsed.catalog ? parsed.catalog : null;
  } catch (_) { return null; }  // 读不到就走占位 ✓（离线 / 旧服务端 / JSON 写坏）
}

/* 兜底路径：某些环境会禁掉主线程同步 XHR ✓ —— 这时异步补一次，
   下一次渲染（打开站点菜单 / 重开工作台）就能看到私有目录 ✓。 */
function loadCatalogAsync() {
  if (typeof fetch !== 'function') return;
  fetch(CATALOG_URL, { cache:'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((parsed) => { if (parsed && parsed.catalog && applyCatalog(parsed.catalog)) SITE_CATALOG_STATE.mode = 'file'; })
    .catch(() => {});
}

applyCatalog(PLACEHOLDER_CATALOG);
const privateCatalog = loadCatalogSync();
if (privateCatalog && applyCatalog(privateCatalog)) SITE_CATALOG_STATE.mode = 'file';
else if (!privateCatalog) loadCatalogAsync();

/* 排障 / 自测用句柄 ✓（不参与业务逻辑）：window.CodeScopeSiteCatalog.state.mode */
try {
  if (typeof window !== 'undefined') {
    window.CodeScopeSiteCatalog = {
      state: SITE_CATALOG_STATE,
      reload() { const raw = loadCatalogSync(); if (raw && applyCatalog(raw)) SITE_CATALOG_STATE.mode = 'file'; return SITE_CATALOG_STATE; },
    };
  }
} catch (_) { }
