#!/usr/bin/env node
'use strict';
/*
 * 路由：study（/api/study/*）
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
  const { send, readStudyConfig, saveStudyConfig, readBody, studySafeName, studyNoteFile, fs, path, writeFileAtomicSync, studyAssetFile, streamStatic, readRawBody, isStudyImage, crypto, parsedReadingWebUrl, fetchReadableWebPage } = ctx;

    if (u.pathname === '/api/study/config') {
    if (req.method === 'GET') return send(res, 200, { ok:true, config:readStudyConfig() });
    if (req.method === 'POST') {
      try { return send(res, 200, { ok:true, config:saveStudyConfig(await readBody(req, 2 * 1024 * 1024)) }); }
      catch (error) { return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) }); }
    }
    }
    if (u.pathname === '/api/study/note') {
    const id = studySafeName(u.searchParams.get('id'));
    const file = studyNoteFile(id);
    if (!file) return send(res, 400, { ok:false, error:'笔记标识不合法' });
    if (req.method === 'GET') {
      try { return send(res, 200, { ok:true, id, content:fs.readFileSync(file, 'utf8') }); }
      catch (_) { return send(res, 200, { ok:true, id, content:'# 学习笔记\n\n' }); }
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req, 9 * 1024 * 1024), content = String(body && body.content != null ? body.content : '');
        if (Buffer.byteLength(content) > 8 * 1024 * 1024) return send(res, 413, { ok:false, error:'笔记超过 8 MB' });
        fs.mkdirSync(path.dirname(file), { recursive:true });
        writeFileAtomicSync(file, content, 'utf8');
        return send(res, 200, { ok:true, id, size:Buffer.byteLength(content) });
      } catch (error) { return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) }); }
    }
    }
    if (u.pathname === '/api/study/asset') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const name = studySafeName(u.searchParams.get('name')), file = studyAssetFile(name);
      if (!file) return send(res, 400, { ok:false, error:'学习图片路径不合法' });
      return streamStatic(req, res, path.dirname(file), path.basename(file), { cacheControl:'private, no-cache', notFound:'学习图片不存在' });
    }
    if (req.method === 'POST') {
      try {
        const type = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
        if (!['image/png','image/jpeg','image/webp'].includes(type)) return send(res, 415, { ok:false, error:'仅支持 PNG、JPEG 或 WebP 学习图片' });
        const body = await readRawBody(req, 12 * 1024 * 1024), ext = type === 'image/png' ? '.png' : (type === 'image/webp' ? '.webp' : '.jpg');
        if (!body.length) return send(res, 400, { ok:false, error:'学习图片内容为空' });
        if (!isStudyImage(body, type)) return send(res, 415, { ok:false, error:'学习图片内容与图片格式不匹配' });
        const name = 'frame-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + ext, file = studyAssetFile(name);
        fs.mkdirSync(path.dirname(file), { recursive:true });
        writeFileAtomicSync(file, body);
        const url = '/api/study/asset?name=' + encodeURIComponent(name), title = String(u.searchParams.get('title') || '视频帧').replace(/[\[\]]/g, '').slice(0, 80);
        return send(res, 200, { ok:true, name, url, markdown:'![' + title + '](' + url + ')' });
      } catch (error) { return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) }); }
    }
    }
    if (req.method === 'GET' && u.pathname === '/api/study/resolve-url') {
    const raw = String(u.searchParams.get('url') || '').trim();
    let parsed;
    try { parsed = new URL(raw); }
    catch (_) { return send(res, 400, { ok:false, error:'网址格式不正确' }); }
    const allowed = new Set(['b23.tv','www.bilibili.com','bilibili.com','m.bilibili.com','player.bilibili.com']);
    if (!allowed.has(parsed.hostname.toLowerCase())) return send(res, 200, { ok:true, url:parsed.toString() });
    try {
      if (parsed.hostname.toLowerCase() === 'b23.tv') {
        const response = await fetch(parsed, { method:'HEAD', redirect:'follow', signal:AbortSignal.timeout(8000) });
        const resolved = new URL(response.url);
        if (allowed.has(resolved.hostname.toLowerCase())) parsed = resolved;
      }
    } catch (_) {}
    return send(res, 200, { ok:true, url:parsed.toString() });
    }
    if (req.method === 'GET' && u.pathname === '/api/study/readable') {
    try {
      const target = parsedReadingWebUrl(String(u.searchParams.get('url') || ''));
      return send(res, 200, { ok:true, ...(await fetchReadableWebPage(target)) });
    } catch (error) { return send(res, error.statusCode || 502, { ok:false, error:String(error.message || error) }); }
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
