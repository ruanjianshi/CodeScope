#!/usr/bin/env node
'use strict';
/*
 * 路由：env（/api/env/*）
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
  const { ONLYOFFICE_CONNECTION, readOnlyOfficeConnection, getEnv, runtimeReadiness, onlyOfficeHealth, XLSX, path, Document, DSH, installHint, platformInfo, send, APP_VERSION, APP_MODE, deploymentInfo, vaultPath } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/env') {
    const force = u.searchParams.get('refresh') === '1';
    // 自动准备完成或用户在“连接设置”里改了地址后，重新检测时同步读取，避免必须重启
    if (force) { try { ONLYOFFICE_CONNECTION = readOnlyOfficeConnection(); } catch (_) {} }
    const detected = await getEnv(force);
    const env = detected.tools;
    const runtime = runtimeReadiness();
    const onlyOffice = await onlyOfficeHealth();
    env.onlyoffice = {
      key:'onlyoffice', label:'ONLYOFFICE Docs', for:'DOCX、XLSX 与 PPTX 完整编辑和多人协作', group:'Office 运行服务',
      available:!!(onlyOffice && onlyOffice.ok), installed:!!(onlyOffice && onlyOffice.ok), required:true,
      version:onlyOffice && onlyOffice.ok ? '已连接' : '', path:ONLYOFFICE_CONNECTION.publicUrl,
      issue:onlyOffice ? (onlyOffice.ok ? '' : (onlyOffice.error || '服务未连接')) : (ONLYOFFICE_CONNECTION.publicUrl ? '等待重新检测服务' : '尚未配置 Document Server 地址'),
      hint:'在 Office 工作区点击“连接设置”，填写 ONLYOFFICE Document Server 地址、回调地址和 JWT 密钥', installable:false, relevant:true, external:true, scope:'Office 必需',
    };
    env.dsh = DSH.status();
    const all = [...Object.values(runtime), ...Object.values(env)];
    const required = all.filter((e) => e.required);
    const unavailable = all.filter((e) => !e.available).length;
    const requiredMissing = required.filter((e) => !e.available).length;
    const optionalUnavailable = all.filter((e) => !e.available && !e.required && !e.external).length;
    const externalUnavailable = all.filter((e) => !e.available && e.external).length;
    const total = all.length;
    // 保留条目自己提供的说明，只为没有说明的外部工具补充平台提示。
    for (const e of all) e.hint = e.hint || installHint(e.key);
    const system = platformInfo();
    send(res, 200, {
      env, runtime, version:APP_VERSION, mode:APP_MODE, node:process.version,
      summary: {
        total, unavailable, missing: requiredMissing, ready: total - unavailable, ok: requiredMissing === 0,
        required: required.length, requiredMissing, requiredReady: required.length - requiredMissing,
        optionalMissing: optionalUnavailable, optionalUnavailable, externalUnavailable,
      },
      project: { languages: detected.project.languages, tools: [...detected.project.keys] },
      deployment: deploymentInfo(env, detected.project.keys),
      vault: (() => { try { return vaultPath(); } catch (e) { return String(e.message); } })(),
      platform: system.label + ' · ' + system.arch,
      system,
    });
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
