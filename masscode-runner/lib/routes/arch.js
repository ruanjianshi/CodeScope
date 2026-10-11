#!/usr/bin/env node
'use strict';
/*
 * 路由：架构图（/api/arch/*）
 * ---------------------------------------------------------------------------
 * ★ 这是把 tools/archify（命令行工具）接成**应用内功能**的一层 ✓（2026-10-11）——
 *   用户原话：「我给他一个项目，他可以给我分析，给出可以交互的架构图等，
 *              我需要给 codescope 添加这个功能」。
 *
 * 为什么分析器在 lib/arch/ 而不是直接 require tools/：
 *   tools/ 是**开发时**用的命令行工具 ✓；lib/ 是**运行时**用的能力 ✓。
 *   两者共用同一份代码（搬过来的 ✓），但 tools/ 那边是 CLI 入口、
 *   lib/ 这边只导出函数 ✓ —— 这样应用不会因为"加载一个工具"而跑 CLI 的副作用 ✓。
 *
 * ── 约定（每个 lib/routes/*.js 都一样）──
 *   ① 导出 `async function handle(req, res, u, ctx) → boolean`；
 *   ② **处理了就返回 true**，没处理返回 false，让调用方继续往下走；
 *   ③ **依赖用 ctx 显式传**，不用全局。
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archAI = require('../arch/ai'), archAIError = require('../arch/ai-error');

/* ⚠️ 安全：只允许分析**白名单根目录**下的路径 ✗✓ ——
   这个接口能读任意目录的结构 ✓，不限制的话等于给了一个"目录扫描器" ✓。
   允许的根：应用自己的目录 / vault / 用户家目录 ✓（够用了 ✓）。
   ⚠️ 用 realpath 再比一次 ✗ —— 防 `..` 和软链穿越 ✓。 */
function allowedRoots(ctx) {
  const roots = [];
  const push = (p) => {
    if (!p) return;
    try { roots.push(fs.realpathSync(p)); } catch (_) {}
  };
  push(path.resolve(__dirname, '..', '..'));            /* 应用目录 ✓ */
  push(ctx.vaultPath && ctx.vaultPath());                /* vault ✓ */
  push(require('os').homedir());                         /* 家目录 ✓ */
  return [...new Set(roots)];
}

function resolveSafe(input, roots) {
  if (!input) return null;
  let real;
  try { real = fs.realpathSync(path.resolve(String(input))); } catch (_) { return null; }
  const ok = roots.some((r) => real === r || real.startsWith(r + path.sep));
  return ok ? real : null;
}

async function handle(req, res, u, ctx) {
  const { send, analyze, renderHTML, walkSnippets, buildDocumentGraph, readBody, applicationDataRoot, computeRev } = ctx;

  /* ── 有哪些可以分析的根（给前端做下拉 ✓）───────────────────────────── */
  if (req.method === 'GET' && u.pathname === '/api/arch/roots') {
    const roots = allowedRoots(ctx);
    const items = roots.map((r) => {
      let entries = 0;
      try { entries = fs.readdirSync(r).length; } catch (_) {}
      return { path: r, name: path.basename(r) || r, entries };
    });
    return send(res, 200, { ok: true, roots: items });
  }

  /* ── 出 IR（JSON ✓ —— 给前端自己画，也给别的消费方用 ✓）────────────── */
  if (req.method === 'GET' && u.pathname === '/api/arch/analyze') {
    const roots = allowedRoots(ctx);
    const target = resolveSafe(u.searchParams.get('path'), roots);
    if (!target) return send(res, 400, { ok: false, error: '这个路径不在允许分析的范围内' });
    const depth = Math.max(1, Math.min(4, Number(u.searchParams.get('depth')) || 2));
    const maxFiles = Math.max(50, Math.min(20000, Number(u.searchParams.get('maxFiles')) || 4000));
    try {
      const t0 = Date.now();
      const ir = analyze(target, { depth, maxFiles });
      return send(res, 200, { ok: true, ms: Date.now() - t0, ir });
    } catch (error) {
      return send(res, 500, { ok: false, error: String((error && error.message) || error) });
    }
  }

  /* ── 出图（自包含 HTML ✓ —— 前端直接塞 iframe ✓）────────────────────── */
  if (req.method === 'GET' && u.pathname === '/api/arch/map') {
    const roots = allowedRoots(ctx);
    const target = resolveSafe(u.searchParams.get('path'), roots);
    if (!target) return send(res, 400, { ok: false, error: '这个路径不在允许分析的范围内' });
    const depth = Math.max(1, Math.min(4, Number(u.searchParams.get('depth')) || 2));
    const title = String(u.searchParams.get('title') || path.basename(target) || '项目');
    try {
      const ir = analyze(target, { depth, maxFiles: 4000 });
      const html = renderHTML(ir, { title });
      /* ⚠️ 这里**直接返回 HTML**（不是 JSON）✗✓ ——
         因为前端要把它塞进 iframe.srcdoc ✓，
         走 JSON 的话要多一层转义、还要多传几 MB 的字符串 ✓。 */
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return true;
    } catch (error) {
      return send(res, 500, { ok: false, error: String((error && error.message) || error) });
    }
  }


  /* ── AI 语义分析（★ 2026-10-11 新功能）────────────────────────────────
     用户原话：「**缺少了很多 archify 该有的功能，没有接入 AI 去分析，解析出架构图等等**」。

     机械调用图只能给出「谁调谁」✗ —— 而真正的架构图还要「这个模块**负责什么**」
     「这几块之间有**什么边界**」✓，那些只能让模型读代码 ✓（见 lib/arch/ai.js）。

     ⚠️ AI 配置（url / key / model）由**前端随请求带上来** ✓（和 /api/ai/chat 一样 ✓）——
        服务端**不存 key** ✓。
     ⚠️ 结果按 (文件, rev, 模型) **缓存到磁盘** ✓ —— 同一个文件反复打开不该反复烧 token ✓。
     ⚠️ 没配 AI 时给**明确的**报错 ✓（不是静默返回空图 ✗）。 */
  if (req.method === 'POST' && u.pathname === '/api/arch/ai') {
    let b;
    try { b = await readBody(req, 4 * 1024 * 1024); }
    catch (error) { return send(res, 400, { ok: false, error: '请求体读取失败：' + String((error && error.message) || error) }); }
    const file = String((b && b.file) || '').trim();
    const url = String((b && b.url) || '').trim();
    const key = String((b && b.key) || '').trim();
    const model = String((b && b.model) || '').trim();
    const force = !!(b && b.force);
    if (!file) return send(res, 400, { ok: false, error: '缺少 file 参数' });
    if (!url || !model) return send(res, 400, { ok: false, error: '还没配置 AI（右上角 AI 面板里填 API URL 和模型）' });

    let snippets;
    try { snippets = walkSnippets().filter((x) => x.file === file); }
    catch (error) { return send(res, 500, { ok: false, error: '读取片段失败：' + String((error && error.message) || error) }); }
    if (!snippets.length) return send(res, 404, { ok: false, error: '这个文件里没有代码片段' });
    const doc = snippets[0];

    /* 函数名从**代码本身**解析出来 ✓（不让模型编）—— 边标签要用它对上 ✓ */
    let graph = { nodes: [], edges: [] };
    try { graph = buildDocumentGraph(snippets); } catch (_) {}
    const fnByFrag = new Map();
    const fnNames = [];
    (graph.nodes || []).filter((n) => n.kind === 'fn').forEach((n) => {
      let fi = n.frag;
      if (fi == null) {
        const m = String(n.id || '').split('|');
        fi = m.length > 1 ? Number(m[1]) : 0;
      }
      fi = Number(fi) || 0;
      if (!fnByFrag.has(fi)) fnByFrag.set(fi, []);
      fnByFrag.get(fi).push(n.label);
      fnNames.push(n.label);
    });

    const fragments = (doc.fragments || []).map((f, i) => ({
      label: f.label || ('片段' + (i + 1)),
      language: f.language || '',
      code: String(f.code || ''),
      functions: fnByFrag.get(i) || [],
    }));
    const fragLabels = fragments.map((f) => f.label);

    /* 缓存：同 (文件, rev, 模型) 直接命中 ✓ */
    const rev = String((computeRev && computeRev()) || '');
    const hash = crypto.createHash('sha1').update(file + '|' + rev + '|' + model).digest('hex').slice(0, 24);
    let cacheDir = '';
    try { cacheDir = path.join(applicationDataRoot(), 'arch-ai'); } catch (_) {}
    const cacheFile = cacheDir ? path.join(cacheDir, hash + '.json') : '';
    if (!force && cacheFile) {
      try {
        const hit = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (hit && hit.ai && hit.model === model) return send(res, 200, { ok: true, cached: true, rev, ai: hit.ai, ms: 0 });
      } catch (_) { /* 缓存坏了就当没有 ✓ */ }
    }

    const prompt = archAI.buildPrompt({ name: doc.name || path.basename(file), fragments });
    let content = '';
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          stream: false, temperature: 0.2,
        }),
        signal: AbortSignal.timeout(180000),
      });
      const text = await resp.text();
      if (!resp.ok) return send(res, 200, { ok: false, error: archAIError.describeApiError(resp.status, text) });  /* 翻成人话，别甩 JSON */
      let data;
      try { data = JSON.parse(text); } catch (_) { return send(res, 200, { ok: false, error: 'AI 返回非 JSON 内容' }); }
      content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      if (!content) return send(res, 200, { ok: false, error: 'AI 没返回内容（缺 choices[0].message.content）' });
    } catch (error) {
      const detail = String((error && error.message) || error);
      const timedOut = (error && error.name === 'TimeoutError') || /timeout/i.test(detail);
      return send(res, 200, { ok: false, timeout: timedOut, error: timedOut ? 'AI 分析超时（180 秒），可以换个更快的模型再试' : 'AI 请求失败：' + detail.slice(0, 300) });
    }

    let ai;
    try { ai = archAI.parseReply(content, fragLabels, fnNames); }
    catch (error) { return send(res, 200, { ok: false, error: String((error && error.message) || error), raw: String(content).slice(0, 800) }); }

    if (cacheFile) {
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ model, rev, at: new Date().toISOString(), ai }), 'utf8');
      } catch (_) { /* 缓存写不进去不影响结果 ✓ */ }
    }
    return send(res, 200, { ok: true, cached: false, rev, ai });
  }

  return res.writableEnded === true;
}

module.exports = { handle };
