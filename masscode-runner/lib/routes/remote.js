#!/usr/bin/env node
'use strict';
/*
 * 路由：remote（/api/remote/*）
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
  const { send, executablePath, path, fs, TERM, remoteHost, remotePort, measureNetworkLatency, readBody, sshSessionSpec, stopTerm, termSpawn, remoteList, remoteRead, remoteWrite, streamRemoteUpload, streamRemoteDownload } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/remote/status') {
    return send(res, 200, {
      ok: true,
      ssh: { available: !!executablePath('ssh'), path: executablePath('ssh'), files: true },
      /* ⚠️⚠️ `__dirname` 是 **`lib/routes/`** ✗ —— 这个路由是从根目录的 server.js 抽出来的 ✓，
         抽出来之后相对路径就**多下移了两层** ✓，而这里忘了补 `'..','..'` ✗ →
         一直在查 `lib/routes/node_modules/@novnc/...` ✓（**永远不存在** ✓）→
         面板永远显示「VNC 缺失 / noVNC 前端资源未安装」✗（用户报「怎么缺失了」✓），
         可 `node_modules/@novnc/novnc` **明明装着** ✓。
         ⇒ 同一目录的 `arch.js` 就是正确写法：`path.resolve(__dirname, '..', '..')` ✓。 */
      vnc: { available: fs.existsSync(path.join(__dirname, '..', '..', 'node_modules', '@novnc', 'novnc', 'core', 'rfb.js')) },
      terminal: TERM ? { active: true, mode: TERM.mode, label: TERM.label, host: TERM.host || '', port: TERM.port || 0 } : { active: false, mode: '', label: '', host: '', port: 0 },
    });
    }
    if (req.method === 'GET' && u.pathname === '/api/remote/latency') {
    const host = remoteHost(u.searchParams.get('host'));
    const port = remotePort(u.searchParams.get('port'), 0);
    if (!host || !port) return send(res, 400, { ok: false, error: '主机或端口不合法' });
    const result = await measureNetworkLatency(host);
    return send(res, result.ok ? 200 : 504, result);
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/ssh/connect') {
    const b = await readBody(req);
    const spec = sshSessionSpec(b);
    if (spec.error) return send(res, 400, { ok: false, error: spec.error });
    stopTerm();
    if (!termSpawn(spec)) return send(res, 500, { ok: false, error: 'SSH 终端启动失败' });
    return send(res, 200, { ok: true, mode: 'ssh', label: spec.label, host: spec.host, port: spec.port, user: spec.user });
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/ssh/disconnect') {
    stopTerm();
    return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/list') {
    try { return send(res, 200, await remoteList(await readBody(req))); }
    catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/read') {
    try { return send(res, 200, await remoteRead(await readBody(req))); }
    catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/write') {
    try { return send(res, 200, await remoteWrite(await readBody(req))); }
    catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/upload-stream') {
    await streamRemoteUpload(req, res);
    return;
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/download-stream') {
    try { await streamRemoteDownload(res, await readBody(req)); }
    catch (error) {
      if (!res.headersSent) send(res, 200, { ok:false, error:String(error.message || error) });
      else res.destroy(error);
    }
    return;
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
