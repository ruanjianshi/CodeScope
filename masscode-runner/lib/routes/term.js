#!/usr/bin/env node
'use strict';
/*
 * 路由：term（/api/term/*）
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
  const { TERM, termSpawn, readBody, send, stopTerm } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/term/stream') {
    /* ★★ 必须用 termSpawn() 的**返回值**，不能再看 ctx 里的 TERM ✗✗（2026-10-19 实测修）——
       `const { TERM } = ctx` 是**调用那一刻拷过来的值** ✓，而 termSpawn() 改的是
       server.js 的模块级变量 ✓ → spawn 成功后这里的 TERM **仍然是 null** ✗ →
       每次都 `res.end('终端启动失败')` ✓，同时还**每请求多开一个 shell**（泄漏）✓。
       用户截图「终端启动失败 / 连接断开」就是这么来的 ✓。 */
    let session = TERM;
    if (!session || !session.child) session = termSpawn();
    if (!session) { res.end('终端启动失败'); return true; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-CodeScope-Terminal-Replay': '1' });
    /* ⚠️ 必须 `flushHeaders()` ✗✗（2026-10-19 实测）——
       `writeHead()` 只是**记下**状态行 ✓，Node 要等到**第一次 write/end** 才真正发出去 ✓。
       而这里的第一次 write 取决于 **shell 什么时候吐第一段输出** ✓ ——
       shell 启动慢 / 首屏还没出来时，客户端连 200 都收不到 ✓ →
       前端的 `await fetch(...)` 一直挂着 ✓ → 状态条卡在「连接中…」✓（实测就是卡住）。
       ⇒ 先把头冲出去，客户端立刻知道「连上了」✓，正文随后到 ✓。 */
    try { res.flushHeaders(); } catch (_) {}
    session.clients.add(res);
    if (session.buffer.length) { try { res.write(session.buffer); } catch (_) {} }
    req.on('close', () => {
      // 页面刷新/多标签切换只移除自己的订阅，不再杀掉共享 SSH 会话。
      session.clients.delete(res);
    });
    /* ⚠️ 必须 `return true` ✗✗ —— 这里是**流**，`res.writableEnded` 是 false ✓，
       写裸 `return;`（undefined）会让调用方当成「没处理」→ 继续往下走 → 撞 404 兜底 →
       对已 writeHead 的响应再写头 → 抛 ERR_HTTP_HEADERS_SENT → 外层 catch 里
       `res.destroy()` → **连接直接断开** ✓（curl 看到的就是 Empty reply）✓。
       和 2026-10-11 system-panel 那次是**同一个坑** ✓。 */
    return true;
    }
    if (req.method === 'POST' && u.pathname === '/api/term/input') {
    const b = await readBody(req);
    const data = String((b && b.data) || '');
    if (!TERM || !TERM.child) return send(res, 409, { ok: false, error: '终端尚未连接' });
    try { TERM.child.stdin.write(data); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/term/resize') {
    const b = await readBody(req);
    const cols = Math.max(20, Math.min(1000, Math.floor(Number(b.cols) || 0)));
    const rows = Math.max(5, Math.min(500, Math.floor(Number(b.rows) || 0)));
    if (!TERM || !TERM.child) return send(res, 409, { ok: false, error: '终端尚未连接' });
    const control = TERM.child.stdio && TERM.child.stdio[3];
    if (!control || !control.writable) return send(res, 200, { ok: true, forwarded: false });
    try { control.write(JSON.stringify({ cols, rows }) + '\n'); return send(res, 200, { ok: true, forwarded: true }); }
    catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/term/stop') {
    stopTerm();
    return send(res, 200, { ok: true });
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
