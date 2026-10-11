#!/usr/bin/env node
'use strict';
/*
 * 路由：fig（/api/fig/*）
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
  const { handleFigEdit, send } = ctx;

    if (req.method === 'POST' && u.pathname === '/api/fig/edit') {
    /* ⚠️⚠️ 一定要包 try/catch ✗✗（2026-10-10）——
       实测：这个接口一被调用，**服务端进程直接消失** ✓，
       而日志里**一个字都没有** ✓（静默崩溃 ✓）。
       原因：异步链里抛的异常没人接 ✓ → Node 15+ **直接结束进程** ✓✓。
       ⚠️ 现象极具误导性 ✗：请求方看到 `fetch failed / other side closed` ✓，
          服务端日志**干干净净** ✓ —— 看着像「网络问题」✓，
          其实是**自己崩了** ✓（而且监管进程会立刻重启 ✓，PID 一直变 ✓）。
       ✅ 教训：**HTTP 处理函数里的异步必须有兜底** ✓✓，
          否则这类 bug 能查掉一整轮 ✓（这次就是 ✓）。 */
    try {
      return await handleFigEdit(req, res);
    } catch (e) {
      console.error('[fig/edit] 失败: ' + String((e && e.stack) || e));
      try { return send(res, 200, { ok: false, error: String((e && e.message) || e) }); } catch (_) {}
      return;
    }
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
