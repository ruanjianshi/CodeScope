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
      /* ⚠️⚠️ **护栏：拒绝"把有内容的片段写成空"** ✗✗（2026-10-11 加 ✓）
         ⚠️ 为什么要加：当天出过一次**真实的数据丢失** ✓ ——
            浏览器里开着**旧页面**（内存里是空片段 ✓），
            它按 700ms 的防抖**持续把空内容往回写** ✓ →
            `接口化最小代码实现.md` 的四个片段被清空 ✓，
            而且**恢复之后又被写空了一次** ✓✓（因为那个页面还开着 ✓）。

         ⚠️ 为什么护栏放**服务端** ✗：客户端护栏（`EDITOR_OWNER` ✓）
            只能保护**新代码** ✓ —— 已经打开的旧页面**跑的还是旧 JS** ✓，
            它照样会写 ✓。**只有服务端拦得住所有客户端** ✓✓。

         ⚠️ 为什么允许显式清空 ✗：用户**确实可能想清空一个片段** ✓，
            所以留一个逃生口 ✓：请求里带 `allowEmpty: true` 就放行 ✓。
            （前端以后要加"清空"按钮时记得带上它 ✓。） */
      const prevCode = String(frag.code || '').replace(/\n+$/, '');
      if (nextCode === '' && prevCode !== '' && b.allowEmpty !== true) {
        return send(res, 409, {
          ok: false,
          error: '拒绝把有内容的片段清空（' + frag.label + '）：这通常是旧页面在覆盖。'
            + '确实要清空的话，请求里带 allowEmpty: true',
        });
      }
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
