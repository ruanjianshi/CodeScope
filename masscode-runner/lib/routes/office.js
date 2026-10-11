#!/usr/bin/env node
'use strict';
/*
 * 路由：office（/api/office/*）
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
  const { officeTree, send, officeDir, officePath, path, streamStatic, onlyOfficeHealth, publicOnlyOfficeConnection, onlyOfficeServiceStatus, readBody, controlOnlyOfficeService, saveOnlyOfficeConnection, OFFICE_ENGINE, officeKind, fs, onlyOfficeDocumentType, ONLYOFFICE_CONNECTION, onlyOfficeBrowserUrl, onlyOfficeConfig, onlyOfficeTokenValid, saveOnlyOfficeResult, officeWordToHtml, saveOfficeWordHtml, officeSafeFolder, uniqueOfficeTarget, createOfficeDocument, OFFICE_EXTS, XLSX, crypto, officeStreamToFile, validateOfficeFile } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/office/tree') {
    const root = officeTree(); return send(res, 200, { ok:true, dir:officeDir(), root, total:root.count });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/office/file') {
    const rel = officePath(u.searchParams.get('path'));
    if (!rel) return send(res, 400, { ok:false, error:'Office 文件路径不合法' });
    if (u.searchParams.get('download') === '1') res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(rel)));
    return streamStatic(req, res, officeDir(), rel, { cacheControl:'private, no-cache', notFound:'Office 文件不存在' });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/connection') {
    const health = await onlyOfficeHealth();
    return send(res, 200, { ok:true, connection:publicOnlyOfficeConnection(), health });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/service') {
    /* ⚠️ 默认走缓存 ✓；`?refresh=1` 才真去问 docker ✓（见上面那段注释 ✓）*/
    return send(res, 200, { ok:true, service:await onlyOfficeServiceStatus(u.searchParams.get('refresh') === '1') });
    }
    if (req.method === 'POST' && u.pathname === '/api/office/service') {
    try {
      const body = await readBody(req, 16 * 1024), action = String(body && body.action || '');
      const service = await controlOnlyOfficeService(action);
      return send(res, 200, { ok:true, action, service });
    } catch (error) {
      return send(res, error.statusCode || 500, { ok:false, error:String(error.message || error) });
    }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/connection') {
    try {
      const body = await readBody(req, 128 * 1024);
      const connection = saveOnlyOfficeConnection(body);
      const health = await onlyOfficeHealth();
      return send(res, health.ok ? 200 : 202, { ok:true, connection, health });
    } catch (error) {
      return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) });
    }
    }
    if (req.method === 'GET' && u.pathname === '/api/office/onlyoffice/status') {
    const health = await onlyOfficeHealth();
    return send(res, health.ok ? 200 : 503, { ...health, engine:'ONLYOFFICE Docs', connection:publicOnlyOfficeConnection(), editable:['docx','xlsx','xls','csv','pptx','pdf'] });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/providers/v1') {
    return send(res, 200, await OFFICE_ENGINE.status({ probe:u.searchParams.get('refresh') !== '0' }));
    }
    if (req.method === 'GET' && u.pathname === '/api/office/onlyoffice/config') {
    const rel = officePath(u.searchParams.get('path'));
    if (!rel) return send(res, 400, { ok:false, error:'Office 文件路径不合法' });
    const file = path.join(officeDir(), rel), kind = officeKind(rel);
    if (!fs.existsSync(file) || !onlyOfficeDocumentType(kind)) return send(res, 404, { ok:false, error:'Office 文件不存在或类型不受支持' });
    const health = await onlyOfficeHealth();
    if (!health.ok) return send(res, 503, { ok:false, error:health.error || 'ONLYOFFICE Docs 尚未连接', documentServerUrl:ONLYOFFICE_CONNECTION.publicUrl, connection:publicOnlyOfficeConnection() });
    return send(res, 200, { ok:true, engine:'ONLYOFFICE Docs', documentServerUrl:onlyOfficeBrowserUrl(req), connection:publicOnlyOfficeConnection(), config:onlyOfficeConfig(rel, file) });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/office/onlyoffice-file') {
    const rel = officePath(u.searchParams.get('path'));
    if (!rel || !onlyOfficeTokenValid(rel, 'document', u.searchParams.get('token'))) return send(res, 403, { ok:false, error:'Office 文件访问令牌无效' });
    return streamStatic(req, res, officeDir(), rel, { cacheControl:'private, no-store', notFound:'Office 文件不存在' });
    }
    if (req.method === 'POST' && u.pathname === '/api/office/onlyoffice-callback') {
    const rel = officePath(u.searchParams.get('path'));
    if (!rel || !onlyOfficeTokenValid(rel, 'callback', u.searchParams.get('token'))) return send(res, 403, { error:1 });
    const body = await readBody(req, 4 * 1024 * 1024), status = Number(body && body.status);
    if ((status === 2 || status === 6) && body.url) {
      try { await saveOnlyOfficeResult(rel, body.url); }
      catch (error) { console.error('ONLYOFFICE 保存失败:', rel, error); return send(res, 500, { error:1 }); }
    }
    if (status === 3 || status === 7) console.error('ONLYOFFICE 编辑服务报告保存错误:', rel, body && body.error);
    return send(res, 200, { error:0 });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/word-html') {
    const rel = officePath(u.searchParams.get('path'));
    if (!rel || path.extname(rel).toLowerCase() !== '.docx') return send(res, 400, { ok:false, error:'Word 文件路径不合法' });
    const file = path.join(officeDir(), rel);
    if (!fs.existsSync(file)) return send(res, 404, { ok:false, error:'Word 文件不存在' });
    try { const result = await officeWordToHtml(file); return send(res, 200, { ok:true, path:rel, ...result }); }
    catch (error) { return send(res, 400, { ok:false, error:'Word 内容解析失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/word-save') {
    const b = await readBody(req, 24 * 1024 * 1024), rel = officePath(b && b.path);
    if (!rel || path.extname(rel).toLowerCase() !== '.docx') return send(res, 400, { ok:false, error:'Word 文件路径不合法' });
    const file = path.join(officeDir(), rel);
    if (!fs.existsSync(file)) return send(res, 404, { ok:false, error:'要保存的 Word 文档不存在' });
    try { const stat = await saveOfficeWordHtml(file, b && b.html); return send(res, 200, { ok:true, path:rel, size:stat.size, updated:stat.mtimeMs }); }
    catch (error) { return send(res, error.statusCode || 400, { ok:false, error:'Word 保存失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/folder') {
    const b = await readBody(req), parent = officeSafeFolder(b && b.parent), name = officeSafeFolder(b && b.name);
    if (parent === null || !name || name.includes('/')) return send(res, 400, { ok:false, error:'文件夹名称或位置不合法' });
    const rel = parent ? parent + '/' + name : name, target = path.join(officeDir(), rel);
    if (fs.existsSync(target)) return send(res, 409, { ok:false, error:'同名文件夹已存在' });
    fs.mkdirSync(target, { recursive:true }); return send(res, 200, { ok:true, path:rel });
    }
    if (req.method === 'POST' && u.pathname === '/api/office/new') {
    const b = await readBody(req), folder = officeSafeFolder(b && b.folder), kind = String(b && b.kind || '');
    if (folder === null || !['word', 'sheet', 'slides'].includes(kind)) return send(res, 400, { ok:false, error:'新建文档参数不合法' });
    const raw = String(b && b.name || '').trim().replace(/\.(?:docx|xlsx|pptx)$/i, '');
    if (!raw || !/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&]+$/.test(raw) || ['.', '..'].includes(raw)) return send(res, 400, { ok:false, error:'文档名称不合法' });
    const ext = kind === 'word' ? '.docx' : (kind === 'sheet' ? '.xlsx' : '.pptx'), target = uniqueOfficeTarget(folder, raw + ext);
    try { await createOfficeDocument(kind, target.file, raw); return send(res, 200, { ok:true, path:target.path, name:target.name, kind, size:fs.statSync(target.file).size }); }
    catch (error) { try { fs.unlinkSync(target.file); } catch (_) {} return send(res, 500, { ok:false, error:'创建 Office 文档失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/upload-stream') {
    let info;
    try { info = JSON.parse(Buffer.from(String(req.headers['x-codescope-office'] || ''), 'base64').toString('utf8')); }
    catch (_) { return send(res, 400, { ok:false, error:'上传信息格式错误' }); }
    const folder = officeSafeFolder(info && info.folder), base = path.basename(String(info && info.name || '')).trim(), ext = path.extname(base).toLowerCase();
    if (folder === null || !officePath(base) || !OFFICE_EXTS.has(ext)) return send(res, 400, { ok:false, error:'仅支持 DOCX、XLSX、XLS、CSV 和 PPTX 文件' });
    const target = uniqueOfficeTarget(folder, base), temp = path.join(path.dirname(target.file), '.' + crypto.randomUUID() + '.upload');
    try {
      const bytes = await officeStreamToFile(req, temp); validateOfficeFile(temp, ext); fs.renameSync(temp, target.file);
      return send(res, 200, { ok:true, path:target.path, name:target.name, kind:officeKind(target.name), size:bytes });
    } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} return send(res, error.statusCode || 400, { ok:false, error:'导入失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/save-stream') {
    let info;
    try { info = JSON.parse(Buffer.from(String(req.headers['x-codescope-office'] || ''), 'base64').toString('utf8')); }
    catch (_) { return send(res, 400, { ok:false, error:'保存信息格式错误' }); }
    const rel = officePath(info && info.path), ext = path.extname(String(rel || '')).toLowerCase();
    if (!rel || !['.xlsx', '.xls', '.csv'].includes(ext)) return send(res, 400, { ok:false, error:'当前只允许在 CodeScope 内保存表格文件' });
    const target = path.join(officeDir(), rel), temp = path.join(path.dirname(target), '.' + crypto.randomUUID() + '.saving');
    if (!fs.existsSync(target)) return send(res, 404, { ok:false, error:'要保存的表格不存在' });
    try {
      const bytes = await officeStreamToFile(req, temp); validateOfficeFile(temp, ext); fs.renameSync(temp, target);
      return send(res, 200, { ok:true, path:rel, size:bytes, updated:fs.statSync(target).mtimeMs });
    } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} return send(res, error.statusCode || 400, { ok:false, error:'保存失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/rename') {
    const b = await readBody(req), rel = officePath(b && b.path, true), rawName = String(b && b.name || '').trim();
    if (!rel || !rawName || /[\\/]/.test(rawName) || !/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&]+$/.test(rawName) || ['.', '..'].includes(rawName)) return send(res, 400, { ok:false, error:'名称不合法' });
    const source = path.join(officeDir(), rel); let stat; try { stat = fs.statSync(source); } catch (_) { return send(res, 404, { ok:false, error:'文件或文件夹不存在' }); }
    const parent = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    let name = rawName;
    if (stat.isFile()) { const ext = path.extname(rel).toLowerCase(); name = rawName.replace(/\.(?:docx|xlsx|xls|csv|pptx)$/i, '') + ext; }
    const targetRel = parent ? parent + '/' + name : name, target = path.join(officeDir(), targetRel);
    if (targetRel === rel) return send(res, 200, { ok:true, path:rel, unchanged:true });
    if (fs.existsSync(target)) return send(res, 409, { ok:false, error:'同名文件或文件夹已存在' });
    try { fs.renameSync(source, target); return send(res, 200, { ok:true, path:targetRel }); }
    catch (error) { return send(res, 500, { ok:false, error:'重命名失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/move') {
    const b = await readBody(req), rel = officePath(b && b.path, true), toFolder = officeSafeFolder(b && b.toFolder);
    if (!rel || toFolder === null || toFolder === rel || toFolder.startsWith(rel + '/')) return send(res, 400, { ok:false, error:'移动路径不合法' });
    const source = path.join(officeDir(), rel), name = path.basename(rel); let stat; try { stat = fs.statSync(source); } catch (_) { return send(res, 404, { ok:false, error:'文件或文件夹不存在' }); }
    const dir = path.join(officeDir(), toFolder || '.'); fs.mkdirSync(dir, { recursive:true });
    let targetName = name, index = 2, ext = stat.isFile() ? path.extname(name) : '', stem = ext ? path.basename(name, ext) : name;
    while (fs.existsSync(path.join(dir, targetName))) { targetName = stem + '-' + index + ext; index += 1; }
    const targetRel = toFolder ? toFolder + '/' + targetName : targetName;
    if (targetRel === rel) return send(res, 200, { ok:true, path:rel, unchanged:true });
    try { fs.renameSync(source, path.join(dir, targetName)); return send(res, 200, { ok:true, path:targetRel }); }
    catch (error) { return send(res, 500, { ok:false, error:'移动失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/delete') {
    const b = await readBody(req), rel = officePath(b && b.path, true);
    if (!rel) return send(res, 400, { ok:false, error:'删除路径不合法' });
    const target = path.join(officeDir(), rel);
    try { const stat = fs.statSync(target); stat.isDirectory() ? fs.rmSync(target, { recursive:true }) : fs.unlinkSync(target); return send(res, 200, { ok:true, path:rel }); }
    catch (error) { return send(res, 404, { ok:false, error:'删除失败：文件不存在或已被占用' }); }
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
