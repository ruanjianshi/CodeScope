'use strict';
/* 绘图文件夹的重命名 / 删除（/api/drawings/folder-*）
   ⚠️ 为什么单独一个文件：server.js 有「代码行数只准变小」的棘轮 ✓，
      这段逻辑塞进去会顶破上限 ✓（和 lib/static-compress.js 同一个理由 ✓）。
   ⚠️ 只允许**当前目录内**改名 ✓（不允许带 / 或 \ ），防止把文件夹搬出 drawings/ ✓。 */
const fs = require('fs');
const path = require('path');

const BAD = /[\\/]/;
function safeName(value) {
  const name = String(value == null ? '' : value).replace(/^\/+|\/+$/g, '').trim();
  if (!name || name === '.' || name === '..' || BAD.test(name)) return '';
  return name;
}

function folderPath(dir, name) {
  const target = path.join(dir, name);
  if (target !== dir && !target.startsWith(dir + path.sep)) return '';
  return target;
}

function renameFolder(dir, name, newName) {
  const from = safeName(name), to = safeName(newName);
  if (!from || !to) return { ok: false, error: '文件夹名不合法（不能含 / 或 \\）' };
  const src = folderPath(dir, from), dst = folderPath(dir, to);
  if (!src || !dst) return { ok: false, error: '路径不合法' };
  try {
    if (!fs.statSync(src).isDirectory()) return { ok: false, error: '目标不是文件夹' };
    if (fs.existsSync(dst)) return { ok: false, error: '同名文件夹已存在' };
    fs.renameSync(src, dst);
    return { ok: true, name: to };
  } catch (_) { return { ok: false, error: '重命名失败（文件夹不存在或已被占用）' }; }
}

function deleteFolder(dir, name) {
  const from = safeName(name);
  if (!from) return { ok: false, error: '文件夹名不合法' };
  const target = folderPath(dir, from);
  if (!target) return { ok: false, error: '路径不合法' };
  try {
    if (!fs.statSync(target).isDirectory()) return { ok: false, error: '目标不是文件夹' };
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, name: from };
  } catch (_) { return { ok: false, error: '删除失败（文件夹不存在或已被占用）' }; }
}

module.exports = { renameFolder, deleteFolder };
