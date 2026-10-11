#!/usr/bin/env node
'use strict';
/*
 * 路由：latex（/api/latex/*）
 * ---------------------------------------------------------------------------
 * ★ 从 server.js 抽出来的（2026-10-11）——
 *   用 tools/extract-route.js 切的，边界是**算出来**的，不是手抄的。
 *
 * ── 约定（每个 lib/routes/*.js 都一样）──
 *   ① 导出 `async function handle(req, res, u, ctx) → boolean`；
 *   ② **处理了就返回 true**，没处理返回 false，让调用方继续往下走
 *      （路由是**顺序 if**，不返回的话会继续往下撞别的分支）；
 *   ③ **依赖用 ctx 显式传**，不用全局 ——
 *      显式传看起来啰嗦，但**看得见依赖**；全局看不见，拆到第三个文件就没人敢动了。
 *
 * ⚠️ 改完要验：node --check 两个文件 + 跑一遍这个功能 + npm test。
 */

const fs = require('fs');
const path = require('path');

async function handle(req, res, u, ctx) {
  /* ctx 里约定要有的东西，按需解构（调用方保证传）*/
  /* ⚠️ 这几个都是**从 server.js 传进来**的 ✓（不是我瞎猜的 ✓）——
     用 tools/extract-route.js 抽完之后，**必须回看这一段** ✓：
     漏一个，运行时才炸 ✓。 */
  const { readBody, send, resolveLatexResource, compileLatex, LATEX_TEXT_EXTS, writeFileAtomicSync } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/latex/resource/raw') {
    let resource;
    try { resource = resolveLatexResource(u.searchParams.get('path')); }
    catch (e) { return send(res, 404, { ok: false, error: e.message }); }
    const data = fs.readFileSync(resource.full);
    const displayName = path.basename(resource.full).replace(/["\r\n]/g, '');
    const asciiName = ('resource' + resource.ext).replace(/[^\x20-\x7e]/g, '');
    const encodedName = encodeURIComponent(displayName).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    res.writeHead(200, { 'Content-Type': MIME[resource.ext] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodedName });
    res.end(data); return;
    }
    if (req.method === 'GET' && u.pathname === '/api/latex/resource') {
    let resource;
    try { resource = resolveLatexResource(u.searchParams.get('path')); }
    catch (e) { return send(res, 404, { ok: false, error: e.message }); }
    const stat = fs.statSync(resource.full);
    if (!LATEX_TEXT_EXTS.has(resource.ext)) return send(res, 200, { ok: true, path: resource.rel, kind: resource.kind, ext: resource.ext, size: stat.size, text: false });
    if (stat.size > 2 * 1024 * 1024) return send(res, 413, { ok: false, error: '文本资源超过 2 MB，无法在线编辑' });
    return send(res, 200, { ok: true, path: resource.rel, kind: resource.kind, ext: resource.ext, size: stat.size, text: true, content: fs.readFileSync(resource.full, 'utf8') });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/save') {
    const b = await readBody(req); let resource;
    try { resource = resolveLatexResource(b.path, true); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    if (!LATEX_TEXT_EXTS.has(resource.ext)) return send(res, 400, { ok: false, error: '该资源不是可编辑文本' });
    const content = String(b.content == null ? '' : b.content);
    if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) return send(res, 413, { ok: false, error: '文本资源超过 2 MB' });
    fs.mkdirSync(path.dirname(resource.full), { recursive: true });
    writeFileAtomicSync(resource.full, content, 'utf8');
    return send(res, 200, { ok: true, path: resource.rel, size: Buffer.byteLength(content, 'utf8') });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/upload') {
    const b = await readBody(req);
    const folder = String(b.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const name = path.basename(String(b.name || '')).replace(/[\x00-\x1f]/g, '');
    if (!folder || !name || name === '.' || name === '..') return send(res, 400, { ok: false, error: '上传路径不合法' });
    let resource;
    try { resource = resolveLatexResource(folder + '/' + name, true); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    const encoded = String(b.data || '').replace(/^data:[^,]*,/, '');
    let data; try { data = Buffer.from(encoded, 'base64'); } catch (_) { return send(res, 400, { ok: false, error: '文件数据无效' }); }
    if (!data.length || data.length > 30 * 1024 * 1024) return send(res, 413, { ok: false, error: '资源文件必须在 30 MB 以内' });
    fs.mkdirSync(path.dirname(resource.full), { recursive: true });
    writeFileAtomicSync(resource.full, data);
    return send(res, 200, { ok: true, path: resource.rel, size: data.length, replaced: !!b.replace });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/rename') {
    const b = await readBody(req); let source;
    try { source = resolveLatexResource(b.path); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    let name = path.basename(String(b.name || '').trim()).replace(/[\x00-\x1f]/g, '');
    if (!name || name === '.' || name === '..' || name !== String(b.name || '').trim()) return send(res, 400, { ok: false, error: '文件名不合法' });
    // 只输入主文件名时保留原扩展名，避免图片重命名后意外失去格式。
    if (!path.extname(name)) name += source.ext;
    if (path.extname(name).toLowerCase() !== source.ext) return send(res, 400, { ok: false, error: '重命名不能改变文件格式，请保留 ' + source.ext + ' 扩展名' });
    let target;
    try { target = resolveLatexResource(path.posix.dirname(source.rel) + '/' + name, true); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    if (path.resolve(source.full) === path.resolve(target.full)) return send(res, 200, { ok: true, path: source.rel, name: path.basename(source.rel) });
    if (fs.existsSync(target.full)) return send(res, 409, { ok: false, error: '同一目录已存在同名资源' });
    try { fs.renameSync(source.full, target.full); }
    catch (e) { return send(res, 500, { ok: false, error: '重命名失败: ' + e.message }); }
    return send(res, 200, { ok: true, path: target.rel, name });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/move') {
    const b = await readBody(req); let source;
    try { source = resolveLatexResource(b.path); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    const toFolder = String(b.toFolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    let target;
    try { target = resolveLatexResource(toFolder + '/' + path.basename(source.rel), true); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    if (target.kind !== source.kind) return send(res, 400, { ok: false, error: '资源只能移动到同类型目录（' + source.kind + '）' });
    if (path.resolve(source.full) === path.resolve(target.full)) return send(res, 200, { ok: true, path: source.rel });
    if (fs.existsSync(target.full)) return send(res, 409, { ok: false, error: '目标目录已存在同名资源' });
    fs.mkdirSync(path.dirname(target.full), { recursive: true });
    try { fs.renameSync(source.full, target.full); }
    catch (e) { return send(res, 500, { ok: false, error: '移动失败: ' + e.message }); }
    return send(res, 200, { ok: true, path: target.rel });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/compile') {
    const b = await readBody(req);
    if (typeof b.code !== 'string') return send(res, 400, { ok: false, error: '缺少 LaTeX 源码' });
    if (Buffer.byteLength(b.code, 'utf8') > 1024 * 1024) return send(res, 413, { ok: false, error: 'LaTeX 文档超过 1 MB，无法实时编译' });
    return send(res, 200, await compileLatex(b.code, b.file));
    }
  return false;   /* 这一组没吃掉，调用方继续往下走 */
}

module.exports = { handle };
