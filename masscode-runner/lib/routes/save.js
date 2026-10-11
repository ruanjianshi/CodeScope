#!/usr/bin/env node
'use strict';
/*
 * 路由：save（/api/save/*）
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
  const { readBody, walkSnippets, send, writeBackFragment, recordTimeline } = ctx;

    if (req.method === 'POST' && u.pathname === '/api/save') {
    const b = await readBody(req);
    const snips = walkSnippets();
    const snip = snips.find((s) => s.file === b.file);
    if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
    const frag = snip.fragments[b.fragment];
    if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
    if (typeof b.code !== 'string') return send(res, 400, { ok: false, error: '缺少 code' });
    const nextCode = b.code.replace(/\n+$/, '');
    if (nextCode === String(frag.code || '').replace(/\n+$/, '')) {
      return send(res, 200, { ok: true, written: false, unchanged: true, message: '内容未变化' });
    }
    const written = writeBackFragment(b.file, frag, nextCode);
    // 保存成功后记录“覆盖前”的内容，保证时间线第一项就能真正撤回本次编辑。
    if (written) recordTimeline(b.file, b.fragment, frag.code, '自动保存');
    return send(res, 200, { ok: written, written, message: written ? '已保存到 vault（massCode 会实时同步）' : '保存失败：未能定位片段代码块' });
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
