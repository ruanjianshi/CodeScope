'use strict';
/* 静态资源的 Brotli 压缩缓存（server.js 用）
   ⚠️ 为什么单独一个文件：server.js 有「代码行数只准变小」的棘轮 ✓，
      这段逻辑塞进去会顶破上限 ✓（实测 +19 行就红了 ✓）。
   质量用 5：体积和 CPU 的平衡点 ✓ —— 本地服务不需要 11 档那种压缩比 ✓。 */
const fs = require('fs');
const zlib = require('zlib');

const CACHE = new Map();
const MAX_ENTRIES = 80;

function brotliStaticFile(file, stat, done) {
  const key = file + ':' + stat.mtimeMs;
  const hit = CACHE.get(key);
  if (hit) return done(hit);
  fs.readFile(file, (error, raw) => {
    if (error) return done(null);
    try {
      const out = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
      if (CACHE.size > MAX_ENTRIES) CACHE.clear();
      CACHE.set(key, out);
      done(out);
    } catch (_) { done(null); }
  });
}

module.exports = { brotliStaticFile };
