#!/usr/bin/env node
'use strict';
/*
 * 路由：integrations（/api/integrations/*）
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
  const { send, DSH, readBody, server, codeServerStatus, VSCODE_PROXY, VSCODE, OPENCODE } = ctx;

    if (u.pathname === '/api/integrations/dsh') {
    if (req.method === 'GET') return send(res, 200, { ok:true, service:DSH.status() });
    if (req.method === 'POST') {
      const body = await readBody(req, 64 * 1024);
      const action = String(body && body.action || 'start');
      if (!['start', 'stop', 'restart'].includes(action)) return send(res, 400, { ok:false, error:'不支持的 DSH 操作' });
      const service = await DSH[action]();
      return send(res, service.available || action === 'stop' ? 200 : 503, { ok:service.available || action === 'stop', service });
    }
    return send(res, 405, { ok:false, error:'Method Not Allowed' });
    }
    if (u.pathname === '/api/integrations/code-server') {
    if (req.method === 'GET') return send(res, 200, { ok:true, service: codeServerStatus() });
    if (req.method === 'POST') {
      const body = await readBody(req, 64 * 1024);
      const action = String(body && body.action || 'open');
      if (action === 'stop') {
        VSCODE_PROXY.stop();
        return send(res, 200, { ok:true, service: codeServerStatus(await VSCODE.stop()) });
      }
      if (action !== 'open') return send(res, 400, { ok:false, error:'不支持的 VS Code 操作' });
      const service = await VSCODE.start();
      /* 代理按需启动：没用这个功能就不额外占端口。 */
      if (service.available) await VSCODE_PROXY.start();
      return send(res, service.available ? 200 : 503, { ok:service.available, service: codeServerStatus(service) });
    }
    return send(res, 405, { ok:false, error:'Method Not Allowed' });
    }
    if (u.pathname === '/api/integrations/opencode') {
    if (req.method === 'GET') return send(res, 200, { ok:true, service:OPENCODE.status() });
    if (req.method === 'POST') {
      const body = await readBody(req, 64 * 1024);
      const action = String(body && body.action || 'open');
      if (action === 'stop') {
        const service = await OPENCODE.stop();
        return send(res, 200, { ok:true, service });
      }
      if (action !== 'open') return send(res, 400, { ok:false, error:'不支持的 opencode 操作' });
      const service = await OPENCODE.start();
      return send(res, service.available ? 200 : 503, { ok:service.available, service });
    }
    return send(res, 405, { ok:false, error:'Method Not Allowed' });
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
