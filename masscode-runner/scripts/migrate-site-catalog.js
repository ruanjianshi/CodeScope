#!/usr/bin/env node
'use strict';
/*
 * 一次性迁移：把「学习工作台」的网址目录从源码搬进私有文件 ✓
 * ---------------------------------------------------------------------------
 * 背景（2026-10 收口）：src/study-sites.js 里原本硬编码了一批内网 / NAT 地址与端口表，
 * 而本仓库是公开的 ✗ —— 等于把家里的服务端口表一起公开 ✗。
 * 现在数据只放应用数据目录的 site-catalog.json（见 server.js 的 readSiteCatalog），
 * 源码里只留 192.0.2.x / example.com 的占位示例 ✓。
 *
 * ⚠️ 顺序很重要：**先跑这个脚本，再让新源码生效**。
 *    改动生效后源码里就只剩占位示例了，真实条目只存在于 git 历史里 ✓ ——
 *    所以脚本默认会去 `git show HEAD:.../src/study-sites.js` 把旧数据捞回来 ✓。
 *
 * 用法：
 *   node scripts/migrate-site-catalog.js                # 从 git HEAD 的旧源码迁移
 *   node scripts/migrate-site-catalog.js --from <文件>  # 指定 .js（旧版 study-sites）或 .json
 *   node scripts/migrate-site-catalog.js --dry-run      # 只看会写什么，不落盘
 *   node scripts/migrate-site-catalog.js --force        # 覆盖已存在的 site-catalog.json
 *
 * 规矩：
 *   ✓ 真实条目**原样**写入（不改 url、不删字段）—— 迁移不是清洗，清洗在服务端读的时候做 ✓
 *   ✗ 绝不把私有数据写回源码（那就又泄漏了 ✗）—— 本脚本只写数据目录
 *   ✓ 已经存在 site-catalog.json 时默认**不覆盖**（用户可能手改过 ✗）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');                 // masscode-runner
const SOURCE_REL = path.join('src', 'study-sites.js');      // 旧数据所在（git 里那份）
const CATALOG_NAME = 'site-catalog.json';

/* 应用数据根目录：与 server.js 的 applicationDataRoot() 逐行一致 ✓
   （两处必须同源 ✗ 否则脚本写 A、服务读 B，用户会看到「迁移成功但菜单没变」✗） */
function applicationDataRoot() {
  if (process.env.CODESCOPE_DATA_HOME) return path.resolve(process.env.CODESCOPE_DATA_HOME);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support', 'CodeScope');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'CodeScope');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'CodeScope');
}

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : '';
};
const DRY_RUN = hasFlag('--dry-run');
const FORCE = hasFlag('--force');
const FROM = flagValue('--from');

/* 占位数据识别 ✓ —— 全是保留地址就说明这份源码已经被替换过了，
   直接迁移等于把占位示例当真实数据写进私有文件 ✗（用户会以为数据还在） */
const PLACEHOLDER_HOST = /^(?:(?:192\.0\.2)\.\d{1,3}|(?:[\w-]+\.)?example\.(?:com|org))$/i;
function hostOf(url) {
  try { return new URL(String(url)).hostname; } catch (_) { return ''; }
}
function looksLikePlaceholder(catalog) {
  const urls = [];
  for (const item of catalog.featured || []) urls.push(item && item.url);
  for (const category of catalog.categories || []) for (const site of (category && category.sites) || []) urls.push(site && site.url);
  if (!urls.length) return true;                     // 空目录也算「没有真实数据」
  return urls.every((url) => PLACEHOLDER_HOST.test(hostOf(url)));
}

/* 报告里只出现掩码地址 ✓ —— 终端日志会被贴进 issue / 聊天窗口 ✗ */
function maskUrl(url) {
  return String(url || '')
    .replace(/(\/\/)(?:\d{1,3}\.){3}\d{1,3}/g, '$1' + '192.0.2.x')
    .replace(/([?&](?:token|key|code|password|secret)=)[^&]*/gi, '$1***');
}

/* 源码 → 目录对象：直接当 ES 模块执行 ✓（不写临时文件、不用正则抠数据 ✗） */
async function catalogFromSource(code) {
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'));
  const categories = Array.isArray(mod.SITE_CATEGORIES) ? mod.SITE_CATEGORIES : [];
  const featured = Array.isArray(mod.FEATURED_SITES) ? mod.FEATURED_SITES : [];
  // 原样保留 ✓：只补上 JSON 需要的容器字段，条目本身一个字段都不动 ✓
  return {
    version: 1,
    migratedAt: new Date().toISOString(),
    featured: featured.map((item) => ({ id:String(item.id || ''), label:String(item.label || ''), url:String(item.url || ''), color:String(item.color || '') })),
    categories: categories.map((item) => ({
      id:String(item.id || ''),
      label:String(item.label || ''),
      icon:String(item.icon || ''),
      color:String(item.color || ''),
      sites: (Array.isArray(item.sites) ? item.sites : []).map((site) => ({
        label:String(site.label || ''),
        url:String(site.url || ''),
        description:String(site.description || ''),
        stars:String(site.stars || ''),
      })),
    })),
  };
}

function catalogFromJson(text) {
  const parsed = JSON.parse(text);
  return {
    version: 1,
    migratedAt: new Date().toISOString(),
    featured: Array.isArray(parsed.featured) ? parsed.featured : [],
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
  };
}

/* 候选来源，按优先级排 ✓ ——
   ① 显式 --from（用户最清楚哪份是全的 ✓）
   ② git HEAD 里的旧源码（源码一旦被替换，真实条目只剩这一份 ✓）
   ③ 工作区当前源码（还没替换、或还没提交的情况下就在这儿 ✓） */
async function candidateSources() {
  const list = [];
  if (FROM) {
    const file = path.resolve(FROM);
    if (!fs.existsSync(file)) {
      console.error('✗ --from 指定的文件不存在：' + file);
      process.exit(2);
    }
    const text = fs.readFileSync(file, 'utf8');
    list.push({ label:file, catalog: file.endsWith('.json') ? catalogFromJson(text) : await catalogFromSource(text) });
    return list;
  }
  let gitRoot = '';
  try { gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd:ROOT, encoding:'utf8' }).trim(); } catch (_) { }
  if (gitRoot) {
    const rel = path.relative(gitRoot, path.join(ROOT, SOURCE_REL)).split(path.sep).join('/');
    try {
      const text = execFileSync('git', ['show', 'HEAD:' + rel], { cwd:ROOT, encoding:'utf8', maxBuffer:32 * 1024 * 1024 });
      list.push({ label:'git HEAD:' + rel, catalog:await catalogFromSource(text) });
    } catch (_) { }
  }
  const local = path.join(ROOT, SOURCE_REL);
  if (fs.existsSync(local)) {
    try { list.push({ label:local, catalog:await catalogFromSource(fs.readFileSync(local, 'utf8')) }); }
    catch (error) { console.error('… 读不了当前源码（' + error.message + '），跳过'); }
  }
  return list;
}

function summarize(catalog) {
  const sites = (catalog.categories || []).reduce((total, item) => total + ((item.sites || []).length), 0);
  return { categories:(catalog.categories || []).length, sites, featured:(catalog.featured || []).length };
}

(async () => {
  const target = path.join(applicationDataRoot(), CATALOG_NAME);
  console.log('应用数据目录：' + applicationDataRoot());
  console.log('目标文件　　：' + target);

  if (fs.existsSync(target) && !FORCE) {
    console.log('\n✓ 已经存在 ' + CATALOG_NAME + '，不覆盖（用户可能手改过 ✗）。');
    console.log('  确实要重新迁移：加 --force。');
    return;
  }

  const candidates = await candidateSources();
  if (!candidates.length) {
    console.error('\n✗ 找不到可迁移的数据源。用 --from 指定旧版 src/study-sites.js 或一份 .json。');
    process.exit(2);
  }

  let picked = null;
  for (const item of candidates) {
    if (!looksLikePlaceholder(item.catalog)) { picked = item; break; }
    console.log('… 跳过 ' + item.label + '：只有占位示例（192.0.2.x / example.com），没有真实条目');
  }
  if (!picked) {
    console.error('\n✗ 所有来源都只有占位示例 —— 真实条目可能已经被替换掉了。');
    console.error('  从 git 历史里取旧版本再迁移，例如：');
    console.error('    git show <旧提交>:masscode-runner/src/study-sites.js > /tmp/sites-old.js');
    console.error('    node scripts/migrate-site-catalog.js --from /tmp/sites-old.js');
    process.exit(3);
  }

  const catalog = picked.catalog;
  const counts = summarize(catalog);
  console.log('\n数据源　　　：' + picked.label);
  console.log('分类 ' + counts.categories + ' · 站点 ' + counts.sites + ' · 常用 ' + counts.featured);
  const sample = [];
  for (const category of catalog.categories.slice(0, 2)) for (const site of category.sites.slice(0, 2)) sample.push(maskUrl(site.url));
  if (sample.length) console.log('样例（已掩码）：' + sample.join('  '));

  if (DRY_RUN) {
    console.log('\n--dry-run：没有落盘 ✓');
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive:true });
  // 先写临时文件再 rename ✓：写一半崩掉时不会留下半份 JSON ✗（服务会读到就解析失败 ✗）
  const tmp = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2) + '\n', { encoding:'utf8', mode:0o600 });
  fs.renameSync(tmp, target);
  console.log('\n✓ 已写入 ' + target + '（权限 600，仅本人可读 ✓）');
  console.log('\n下一步：重启码境（或刷新页面）即可 —— 站点菜单会从这份文件读 ✓。');
  console.log('⚠️ 这份 JSON 含内网地址与端口表：不要提交进仓库 ✗，不要贴到公开的地方 ✗。');
})().catch((error) => {
  console.error('✗ 迁移失败：' + (error && error.stack || error));
  process.exit(1);
});
