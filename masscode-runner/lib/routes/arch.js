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
  const { send, analyze, renderHTML } = ctx;

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

  return res.writableEnded === true;
}

module.exports = { handle };
