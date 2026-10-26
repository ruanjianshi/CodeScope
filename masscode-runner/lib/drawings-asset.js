/* ═══════════════════════════════════════════════════════════════════════
   画布资源落盘 —— 图片 / PDF 页 / 视频
   -----------------------------------------------------------------------
   为什么不让 tldraw 内联 base64 ✗：
     一页 A4 简历渲染成 PNG ≈ 880KB（base64 后），24 页 PDF 会把 .canvas
     撑到 20MB+ ✓，而且每次防抖保存都要 JSON.stringify 一遍整张画布 ✗。
   所以这里把二进制存到磁盘 ✓，.canvas 里只留一个 URL ✓。

   存放位置：<vault>/.canvas-assets/<sha1>.<ext>
     ⚠️ 放在 vault 根而不是 drawings/ 里面 —— 否则会作为文件夹出现在绘图树里 ✗
   ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
  'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
};
const MAX_BYTES = { image: 24 * 1024 * 1024, video: 80 * 1024 * 1024 };

function assetsDir(drawingsDir) {
  const dir = path.join(path.dirname(drawingsDir), '.canvas-assets');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isAssetName(name) {
  return typeof name === 'string' && /^[a-f0-9]{16,40}\.(png|jpg|webp|gif|svg|mp4|webm|mov)$/i.test(name);
}

/* 收 data URL → 存盘 → 回一个可直接放进 <img src> 的地址 */
function saveDataUrl(drawingsDir, originalName, dataUrl) {
  const m = /^data:([a-z0-9.+/-]+);base64,([\s\S]+)$/i.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: '只接受 base64 data URL' };
  const mime = m[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) return { ok: false, error: '不支持的类型：' + mime };
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (_) { return { ok: false, error: 'base64 解码失败' }; }
  if (!buf.length) return { ok: false, error: '空文件' };
  const kind = ext === '.mp4' || ext === '.webm' || ext === '.mov' ? 'video' : 'image';
  if (buf.length > MAX_BYTES[kind]) return { ok: false, error: `${kind === 'video' ? '视频' : '图片'}超过 ${Math.round(MAX_BYTES[kind] / 1048576)}MB` };
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 24);
  const name = hash + ext;
  const full = path.join(assetsDir(drawingsDir), name);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
  return { ok: true, name, url: '/api/drawings/asset?f=' + name, bytes: buf.length, original: String(originalName || '') };
}

/* ★ 最后一道保险：不许用「空画布」覆盖有内容的文件 ✓
   为什么要放在服务端：浏览器可能还跑着旧版前端（没刷新），
   客户端闸门拦不住它 —— 这里拦得住 ✓ */
function canSaveCanvas(target, body) {
  try {
    const count = (o) => Object.values((o && o.document && o.document.store) || {}).filter((r) => r && r.typeName === 'shape').length;
    const next = JSON.parse(body);
    if (count(next) > 0) return true;                       // 有内容 → 放行
    if (!fs.existsSync(target)) return true;                // 新文件 → 放行
    return count(JSON.parse(fs.readFileSync(target, 'utf8'))) === 0;
  } catch (_) { return true; }                              // 解析不了就放行，别把正常保存堵了
}

module.exports = { assetsDir, isAssetName, saveDataUrl, canSaveCanvas };
