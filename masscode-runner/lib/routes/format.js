#!/usr/bin/env node
'use strict';
/*
 * 路由：format（/api/format/*）
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
  const { readBody, walkSnippets, send, FORMATTERS, getEnv, missingReason, formatWithPrettier, writeBackFragment } = ctx;

    if (req.method === 'POST' && u.pathname === '/api/format') {
    const b = await readBody(req);
    const snips = walkSnippets();
    const snip = snips.find((s) => s.file === b.file);
    if (!snip) return send(res, 404, { ok: false, error: '片段不存在' });
    const frag = snip.fragments[b.fragment];
    if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
    const fspec = FORMATTERS[(frag.language || '').toLowerCase()];
    if (!fspec) {
      const supported = Object.keys(FORMATTERS).join(' / ');
      return send(res, 200, { ok: false, reason: '该语言暂不支持格式化：' + frag.language + '（支持: ' + supported + '）' });
    }
    const { tools: env } = await getEnv();
    if (!env[fspec.key] || !env[fspec.key].available) {
      return send(res, 200, { ok: false, formatter: fspec.name, reason: missingReason(fspec.key, env[fspec.key]) });
    }
    const code = b.code != null ? b.code : frag.code;
    const fr = fspec.format ? await fspec.format(code) : await formatWithPrettier(fspec.prettier, code);
    if (!fr.ok) return send(res, 200, { ok: false, formatter: fspec.name, reason: fr.reason });
    // 编辑模式（writeBack:false）：只返回格式化结果，由前端更新编辑框，不写盘
    if (b.writeBack === false) {
      return send(res, 200, { ok: true, formatter: fspec.name, formatted: fr.formatted, written: false, message: '已格式化（编辑模式，自动保存会立即写回 vault）' });
    }
    const written = writeBackFragment(b.file, frag, fr.formatted.replace(/\n+$/, ''));
    return send(res, 200, {
      ok: true, formatter: fspec.name, formatted: fr.formatted, written,
      message: written
        ? '已用 ' + fspec.name + ' 格式化并写回 vault（massCode 会实时同步）'
        : fspec.name + ' 格式化完成（未能自动写回，请手动复制）',
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
