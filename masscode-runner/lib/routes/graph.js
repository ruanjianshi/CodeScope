#!/usr/bin/env node
'use strict';
/*
 * 路由：graph（/api/graph/*）
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
  const { walkSnippets, send, buildDocumentGraph, computeRev, buildCodeGraph } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/graph') {
    try {
      /* file 必须真的用来收窄范围。原来直接 walkSnippets() 拿全库，
         file 参数被忽略 —— 传一个不存在的路径也会返回全库 230 个符号，
         ok 还是 true。前端拿它当某个文件的索引就会串味
         （实测：把临时项目的文件塞满全库符号，Sticky Scope 直接失灵）。 */
      const wanted = String(u.searchParams.get('file') || '').trim();
      const all = walkSnippets();
      const snippets = wanted ? all.filter((item) => item.file === wanted) : all;
      if (wanted && !snippets.length) return send(res, 404, { ok:false, error:'片段不存在（vault 可能已变动）' });
      /* 文档级图谱：把一个文档里所有片段/函数摊平（不需要 root）。
         前端那个「代码图谱」按钮走这条。 */
      if (String(u.searchParams.get('scope') || '') === 'document') {
        const doc = buildDocumentGraph(snippets);
        return send(res, 200, { ok:true, rev:computeRev(), scope:'document', ...doc });
      }
      const depth = Math.max(1, Math.min(5, Number(u.searchParams.get('depth')) || 3));
      const direction = String(u.searchParams.get('direction') || 'both');
      if (!['up', 'down', 'both'].includes(direction)) return send(res, 400, { ok:false, error:'direction 仅支持 up/down/both' });
      const result = buildCodeGraph(snippets, {
        rootFunction: String(u.searchParams.get('rootFunction') || '').slice(0, 500),
        rootFile: String(u.searchParams.get('rootFile') || '').slice(0, 1000),
        depth, direction,
      });
      if (!result.functionGraph.ok) return send(res, 404, result.functionGraph);
      if (!result.fileGraph.ok) return send(res, 404, result.fileGraph);
      return send(res, 200, { ok:true, rev:computeRev(), depth, direction, ...result });
    } catch (error) { return send(res, 500, { ok:false, error:String(error.message || error).slice(0, 300) }); }
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
