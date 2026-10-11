#!/usr/bin/env node
'use strict';
/*
 * 代码 → 架构 IR
 * ---------------------------------------------------------------------------
 * 学 Archify 最核心的一点：**先出"带源证据的 IR"，再渲染**。
 *   ① 不直接画图 —— 中间那层 IR 可以**被断言、被 diff、被别的前端消费**；
 *   ② 每个节点都带**源证据**（文件 / 行数 / 导出符号），
 *      所以图不是"想象"，随时能回代码核对；
 *   ③ 渲染器只管画，不管"理解代码" —— 两件事分开，各自可以变。
 *
 * 用法：
 *   node analyze.js <目录> [--out ir.json] [--depth 2] [--max-files 4000]
 *
 * ⚠️ 刻意**不依赖任何第三方包**（只用 node 内置）——
 *    这样它能在任何项目里直接跑，不用先装东西。
 */

const fs = require('fs');
const path = require('path');

/* 这些目录一律不看（不是"代码"，看了只会把图撑爆） */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'out', 'output', 'dist', 'build',
  'tmp', 'temp', '.cache', 'coverage', 'vendor', '__pycache__', '.venv',
  'venv', '.idea', '.vscode', '.DS_Store', 'bower_components',
]);

/* 语言识别（只认这几类；认不出就不统计为"代码"） */
const LANGS = [
  ['.js', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.jsx', 'javascript'],
  ['.py', 'python'], ['.rs', 'rust'], ['.go', 'go'],
  ['.java', 'java'], ['.c', 'c'], ['.h', 'c'], ['.cpp', 'cpp'], ['.hpp', 'cpp'],
  ['.m', 'matlab'], ['.swift', 'swift'], ['.kt', 'kotlin'], ['.rb', 'ruby'],
  ['.css', 'css'], ['.scss', 'css'], ['.html', 'html'], ['.vue', 'vue'],
  ['.sh', 'shell'], ['.ps1', 'powershell'], ['.sql', 'sql'],
];

function langOf(file) {
  const ext = path.extname(file).toLowerCase();
  const hit = LANGS.find(([e]) => e === ext);
  return hit ? hit[1] : null;
}

/* ── 收集文件 ─────────────────────────────────────────────────────────── */
function walk(root, maxFiles) {
  const files = [];
  const dirs = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      const childRel = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        dirs.push(childRel);
        stack.push(childRel);
      } else if (e.isFile()) {
        files.push(childRel);
        if (files.length > maxFiles) return { files, dirs, truncated: true };
      }
    }
  }
  return { files, dirs, truncated: false };
}

/* ── 从源码里抽"导出符号"和"依赖" ─────────────────────────────────────── */
/* ⚠️ 刻意用**保守的正则**而不是 AST ✗ ——
      AST 需要每种语言的 parser（装一堆东西），
      而这个工具的定位是"**任何项目直接能跑**"。
      正则会有漏，但**不会假装精确**：抽不到就空着，图上就不显示。 */
function extractExports(src, lang) {
  const out = new Set();
  if (lang === 'javascript' || lang === 'typescript' || lang === 'vue') {
    let m;
    const re1 = /(?:^|\n)\s*(?:module\.exports\s*=\s*\{|exports\.)([\s\S]{0,400}?)(?:\n\s*\}|\n)/g;
    while ((m = re1.exec(src))) {
      (m[1].match(/\b([A-Za-z_$][\w$]*)\s*(?::|,|\}|$)/g) || []).forEach((x) => {
        const n = x.replace(/[\s:,}]+$/, '').trim();
        if (n) out.add(n);
      });
    }
    const re2 = /(?:^|\n)\s*exports\.([A-Za-z_$][\w$]*)\s*=/g;
    while ((m = re2.exec(src))) out.add(m[1]);
    const re3 = /(?:^|\n)\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
    while ((m = re3.exec(src))) out.add(m[1]);
  } else if (lang === 'python') {
    let m;
    const re = /(?:^|\n)\s*(?:def|class)\s+([A-Za-z_]\w*)/g;
    while ((m = re.exec(src))) out.add(m[1]);
  }
  return [...out].slice(0, 24);
}

function extractDeps(src, lang) {
  const out = new Set();
  if (lang === 'javascript' || lang === 'typescript' || lang === 'vue') {
    let m;
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]/g;
    while ((m = re.exec(src))) out.add(m[1] || m[2]);
  } else if (lang === 'python') {
    let m;
    const re = /(?:^|\n)\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g;
    while ((m = re.exec(src))) out.add(m[1] || m[2]);
  }
  return [...out];
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */
function analyze(root, opts) {
  const maxFiles = opts.maxFiles || 4000;
  const { files, dirs, truncated } = walk(root, maxFiles);

  const codeFiles = [];
  let totalBytes = 0;
  let totalLines = 0;
  const langStats = {};

  for (const rel of files) {
    const lang = langOf(rel);
    if (!lang) continue;
    let src = '';
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(root, rel)).size;
      src = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (_) { continue; }
    const lines = src ? src.split('\n').length - 1 : 0;
    totalBytes += bytes;
    totalLines += lines;
    langStats[lang] = (langStats[lang] || { files: 0, lines: 0 });
    langStats[lang].files += 1;
    langStats[lang].lines += lines;
    codeFiles.push({ rel, lang, lines, bytes, src });
  }

  /* ── 按"目录"归组成模块（目录就是天然的模块边界）── */
  const depth = opts.depth || 2;
  const modules = new Map();
  for (const f of codeFiles) {
    const parts = f.rel.split('/');
    const dir = parts.length > 1
      ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/')
      : '(根目录)';
    if (!modules.has(dir)) {
      modules.set(dir, { id: dir, files: [], lines: 0, bytes: 0, langs: {}, exports: [], deps: new Set() });
    }
    const mod = modules.get(dir);
    mod.files.push(f.rel);
    mod.lines += f.lines;
    mod.bytes += f.bytes;
    mod.langs[f.lang] = (mod.langs[f.lang] || 0) + 1;
  }

  /* ── 每个模块：抽导出 + 抽依赖（取前几个大文件，够代表性了）── */
  for (const f of codeFiles) {
    const parts = f.rel.split('/');
    const dir = parts.length > 1
      ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/')
      : '(根目录)';
    const mod = modules.get(dir);
    if (!mod) continue;
    const ex = extractExports(f.src, f.lang);
    if (ex.length && mod.exports.length < 20) mod.exports.push(...ex.slice(0, 8));
    for (const d of extractDeps(f.src, f.lang)) {
      if (d.startsWith('.')) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(f.rel), d));
        mod.deps.add(resolved.split('/').slice(0, depth).join('/'));
      } else {
        mod.deps.add(d.split('/')[0]);
      }
    }
  }

  /* ── 分层：用"目录深度 + 名字"做启发式（图上会标"启发式"）── */
  const layerOf = (id) => {
    if (/^(assets|public|static|web|ui|views?|pages?)$/i.test(id) || /^(assets|src)\b/.test(id)) {
      if (/^src\//.test(id)) return 'ui';
      return 'ui';
    }
    if (/^(lib|core|services?|domain|engine|kernel)\b/.test(id)) return 'domain';
    if (/^(server|api|routes?|controllers?|handlers?|middleware)\b/.test(id)) return 'server';
    if (/^(tests?|spec|__tests__)\b/.test(id)) return 'test';
    if (/^(tools?|scripts?|bin)\b/.test(id)) return 'tool';
    if (/^(docs?|examples?|samples?)\b/.test(id)) return 'doc';
    return 'other';
  };

  const modList = [...modules.values()].map((m) => ({
    id: m.id,
    layer: layerOf(m.id),
    fileCount: m.files.length,
    lines: m.lines,
    bytes: m.bytes,
    langs: m.langs,
    exports: [...new Set(m.exports)].slice(0, 16),
    deps: [...m.deps].filter((d) => d && d !== m.id).slice(0, 24),
    /* ★ 源证据：给出最大的 3 个文件，点开就能去看 ✓ */
    evidence: m.files
      .map((rel) => ({ rel, lines: (codeFiles.find((c) => c.rel === rel) || {}).lines || 0 }))
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 3),
  })).sort((a, b) => b.lines - a.lines);

  /* ── 巨型文件（图上要显眼，因为它们是最该拆的）── */
  const bigFiles = codeFiles
    .map((f) => ({ rel: f.rel, lines: f.lines, bytes: f.bytes, lang: f.lang }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 15);

  return {
    irVersion: 1,
    generatedBy: 'archify-lite (analyze.js)',
    root: path.resolve(root),
    generatedAt: new Date().toISOString(),
    truncated,
    summary: {
      files: codeFiles.length,
      totalLines,
      totalBytes,
      modules: modList.length,
      langs: Object.entries(langStats).sort((a, b) => b[1].lines - a[1].lines),
      skippedDirs: [...SKIP_DIRS],
    },
    layers: ['ui', 'server', 'domain', 'tool', 'test', 'doc', 'other'],
    modules: modList,
    bigFiles,
    notes: [
      '模块边界 = 目录（depth 可调）',
      '分层 = 按目录名启发式推断，不是精确结论',
      '导出符号 / 依赖 = 正则抽取，会漏，但不会假装精确',
      '每个模块都带 evidence（最大的几个文件），可回代码核对',
    ],
  };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */
function main() {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--')) || '.';
  const get = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };
  const out = get('--out', null);
  const depth = Number(get('--depth', 2)) || 2;
  const maxFiles = Number(get('--max-files', 4000)) || 4000;

  if (!fs.existsSync(root)) {
    console.error('目录不存在：' + root);
    process.exit(1);
  }
  const ir = analyze(root, { depth, maxFiles });
  const json = JSON.stringify(ir, null, 2);
  if (out) {
    fs.writeFileSync(out, json);
    console.error('✓ IR 已写出：' + out
      + '（' + ir.summary.files + ' 个文件 · ' + ir.summary.totalLines + ' 行 · '
      + ir.summary.modules + ' 个模块）');
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) main();
module.exports = { analyze, langOf, SKIP_DIRS };
