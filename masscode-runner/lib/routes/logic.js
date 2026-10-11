#!/usr/bin/env node
'use strict';
/*
 * 路由：logic（/api/logic/*）
 * ---------------------------------------------------------------------------
 * ★ 从 server.js 抽出来的（2026-10-11），用 tools/extract-routes-all.js ✓
 *
 * ── 约定（每个 lib/routes/*.js 都一样）──
 *   ① 导出 `async function handle(req, res, u, ctx) → boolean`；
 *   ② **处理了就返回 true**，没处理返回 false，让调用方继续往下走
 *      （路由是**顺序 if**，不返回的话会继续往下撞别的分支）；
 *   ③ **依赖用 ctx 显式传**，不用全局 ——
 *      显式传看起来啰嗦，但**看得见依赖**；全局看不见，拆到第三个文件就没人敢动了。
 *
 * ⚠️ 下面的 ctx 解构是**工具扫出来**的（扫 server.js 的顶层名字 ✓），
 *    不是人写的 —— 所以它应该刚好等于"这组真正用到的外部符号" ✓。
 *    如果手工改了这里，记得同步 server.js 的调用点 ✓。
 */

async function handle(req, res, u, ctx) {
  const { readBody, walkSnippets, send, buildSnippetIndex, resolveDefinition, buildLogicGraph, logicToDrawio, logicToSkeleton } = ctx;

    if (req.method === 'POST' && u.pathname === '/api/logic/graph') {
    try {
      const b = await readBody(req, 3 * 1024 * 1024);
      const snippets = walkSnippets();
      let code = typeof b.code === 'string' ? b.code : '';
      let language = String(b.language || ''), name = String(b.name || 'fn').slice(0, 120);
      /* 函数体是**切片**出来再解析的，所以图里的行号是「函数内相对行」。
         这里记下偏移量，返回前加回去 —— 否则前端点节点跳转会整体错位
         （用户报过：图上写 L2，实际在编辑器第 27 行）。 */
      let lineOffset = 0;
      if (!code) {
        const snippet = snippets.find((item) => item.file === String(b.file || ''));
        if (!snippet) return send(res, 404, { ok:false, error:'片段不存在（vault 可能已变动）' });
        const fragment = Number(b.fragment);
        if (!Number.isInteger(fragment) || fragment < 0 || fragment >= snippet.fragments.length) return send(res, 400, { ok:false, error:'片段索引无效' });
        const source = snippet.fragments[fragment];
        language = language || source.language;
        const full = String(source.code || '');
        const line = Number(b.line);
        if (Number.isInteger(line) && line >= 1) {
          const idx = buildSnippetIndex(snippet);
          const hit = idx.find((s) => s.kind === 'fn' && s.frag === fragment && line >= s.line && line <= (s.endLine || s.line));
          const target = hit ? (resolveDefinition(hit, idx) || hit) : null;
          if (target && target.endLine) {
            code = full.replace(/\r\n/g, '\n').split('\n').slice(target.line - 1, target.endLine).join('\n');
            name = target.name || name;
            lineOffset = Math.max(0, target.line - 1);
          } else code = full;
        } else code = full;
      }
      if (Buffer.byteLength(code, 'utf8') > 2 * 1024 * 1024) return send(res, 413, { ok:false, error:'函数内容超过 2 MB' });
      const graph = buildLogicGraph(code, { language: language || 'c_cpp', name });
      /* 相对行号 → 片段绝对行号（前端 goToLocation 用的是后者） */
      if (lineOffset) {
        graph.nodes.forEach((n) => {
          n.line = (Number(n.line) || 1) + lineOffset;
          n.endLine = (Number(n.endLine) || Number(n.line) || 1) + lineOffset;
        });
      }
      if (String(b.format) === 'drawio') return send(res, 200, { ok:true, ...graph, xml:logicToDrawio(graph, { title:name }) });
      return send(res, 200, { ok:true, ...graph });
    } catch (error) { return send(res, error.statusCode || 500, { ok:false, error:String(error.message || error).slice(0, 300) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/logic/skeleton') {
    try {
      const b = await readBody(req, 2 * 1024 * 1024);
      const graph = b && b.graph;
      if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length > 2000) return send(res, 400, { ok:false, error:'逻辑图节点不合法（1–2000 个）' });
      return send(res, 200, { ok:true, ...logicToSkeleton(graph, {
        language:String(b.language || 'c_cpp'), fnName:String(b.fnName || b.name || 'generated').slice(0, 120),
      }) });
    } catch (error) { return send(res, error.statusCode || 500, { ok:false, error:String(error.message || error).slice(0, 300) }); }
    }
  /* ★★ 判断标准不是「我 return 了吗」，而是「响应发出去了吗」（2026-10-11 实测修）——
     ⚠️ 根因：原来这里写 `return false`，但**分支里那些 `return streamStatic(...)`
        和 `return send(...)`**，在原始 router 里 `return` 退出的是**整个 router**；
        抽到 handle 里之后，它只退出 handle ——
        而 `streamStatic` 返回 `undefined` → handle 返回 `undefined` →
        调用方当成「没处理」→ 继续往下走 → 撞到 404 兜底。
        （实测：POST /api/study/asset 正常，GET 同一个地址却 404。）
     → 用 `res.writableEnded` 判断：**响应发了就算吃掉**，
       不管中间是 `return send(...)` 还是 `return streamStatic(...)`。 */
  return res.writableEnded === true;
}

module.exports = { handle };
