#!/usr/bin/env node
'use strict';
/*
 * 路由：sync（/api/sync/*）
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
  const { send, syncStatus, discoverSyncthingApiKey, syncConfig, syncthingConfigPaths, saveSyncConfig, readBody, syncthingAction, startSyncSnapshot, syncGithubStatus, vaultStats } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/sync/status') {
    return send(res, 200, await syncStatus(u.searchParams.get('refresh') === '1'));
    }
    if (u.pathname === '/api/sync/config') {
    if (req.method === 'GET') {
      const discovered = discoverSyncthingApiKey();
      return send(res, 200, {
        ok: true, config: syncConfig(),
        discovered: { syncthingApiKey: discovered.key ? '已在本机 config.xml 中发现' : '', file: discovered.file },
        configXmlCandidates: syncthingConfigPaths(),
      });
    }
    if (req.method === 'POST') {
      try { return send(res, 200, { ok: true, config: saveSyncConfig(await readBody(req)) }); }
      catch (error) { return send(res, error.statusCode || 400, { ok: false, error: String(error.message || error) }); }
    }
    }
    if (req.method === 'POST' && u.pathname === '/api/sync/device') {
    try { return send(res, 200, await syncthingAction(await readBody(req))); }
    catch (error) { return send(res, error.statusCode || 400, { ok: false, error: String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/sync/scan') {
    try {
      const body = await readBody(req);
      return send(res, 200, await syncthingAction({ action: 'scan', folder: body.folder }));
    } catch (error) { return send(res, error.statusCode || 400, { ok: false, error: String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/sync/snapshot') {
    try { return send(res, 200, await startSyncSnapshot((await readBody(req)).targets)); }
    catch (error) { return send(res, error.statusCode || 400, { ok: false, error: String(error.message || error) }); }
    }
    // GitHub 体积预检：单文件 ≥100 MiB 一旦进历史，push 会被永久拒绝，必须在入库前拦住。
    if (req.method === 'GET' && u.pathname === '/api/sync/github/precheck') {
    const config = syncConfig();
    const repo = await syncGithubStatus(config).catch(() => ({ largeFiles: [] }));
    const vault = vaultStats();
    const largeFiles = repo.largeFiles || [];
    const blocking = largeFiles.filter((item) => item.bytes >= 100 * 1024 * 1024);
    return send(res, 200, {
      ok: true, thresholdMiB: config.largeFileMiB, githubLimitMiB: 100,
      largeFiles, blocking,
      pdfBackups: { files: vault.pdfBackupFiles, bytes: vault.pdfBackupBytes },
      advice: blocking.length
        ? '存在 ≥100 MiB 的文件：一旦提交，git push 会被永久拒绝，请先压缩或移出仓库'
        : (largeFiles.length ? '存在接近上限的文件（≥' + config.largeFileMiB + ' MiB），提交前请确认' : '未发现超限文件'),
    });
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
