#!/usr/bin/env node
'use strict';
/*
 * 路由：system-panel（/api/system-panel/*）
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
  const { SYSTEM_PANEL, send } = ctx;

    if (u.pathname === '/api/system-panel' || u.pathname.startsWith('/api/system-panel/')) {
    try {
      /* ★★ 这里必须 `return true` ✗✗（2026-10-19）——
         ⚠️ 原来是 `if (await ...) return;` ✓ —— 裸 `return` 返回的是 **undefined** ✓，
            而调用方写的是 `if (await route.handle(...) || res.writableEnded) return;` ✓
            → undefined 是**假值** ✓ → 当成「没处理」→ 继续往下走 ✓ →
            撞到 404 兜底 → 对**已经写了响应头**的 res 再 writeHead ✗ → 抛错 → 连接被销毁 ✗✗。
         ⚠️ 为什么平时看不出来 ✗：普通接口 `send()` 已经把响应**结束**了 ✓，
            调用方的 `|| res.writableEnded` 兜住了 ✓ —— 只有**流式**响应（SSE）没结束 ✓，
            于是只有「本机管家的任务进度流」会挂 ✗：
            浏览器里 `ERR_EMPTY_RESPONSE` ✓、进度日志一条都不显示 ✓、任务结果靠 onerror 兜底补查 ✓。
            （实测：统计缓存占用 / 清理 / 软件升级 / Docker 操作全受影响 ✓） */
      if (await SYSTEM_PANEL.handle(req, res, u)) return true;
    } catch (error) {
      return send(res, 500, { ok:false, error:String((error && error.message) || error) });
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
