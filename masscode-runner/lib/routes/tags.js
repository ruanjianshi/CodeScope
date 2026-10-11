#!/usr/bin/env node
'use strict';
/*
 * 路由：tags（/api/tags/*）
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
  const { readBody, readState, send, writeState, retagSnippets } = ctx;

    if (req.method === 'POST' && u.pathname === '/api/tags/update') {
    const b = await readBody(req);
    const st = readState();
    if (!Array.isArray(st.tags)) st.tags = [];
    const id = Number(b.id);
    const tag = st.tags.find((t) => Number(t.id) === id);
    if (!tag) return send(res, 200, { ok: false, error: '标签不存在（vault 可能已变动）' });
    const action = String(b.action || '').trim();
    if (action === 'rename') {
      const name = String(b.name || '').trim();
      if (!name) return send(res, 200, { ok: false, error: '标签名不能为空' });
      if (name.length > 60) return send(res, 200, { ok: false, error: '标签名过长' });
      if (st.tags.some((t) => Number(t.id) !== id && t.name === name)) return send(res, 200, { ok: false, error: '已存在同名标签「' + name + '」' });
      const before = tag.name;
      tag.name = name;
      tag.updatedAt = Date.now();
      writeState(st);
      return send(res, 200, { ok: true, message: '标签「' + before + '」已重命名为「' + name + '」（片段保存的是标签 id，无需改动片段）' });
    }
    if (action === 'delete' || action === 'merge') {
      let targetId = null;
      if (action === 'merge') {
        targetId = Number(b.targetId);
        if (targetId === id) return send(res, 200, { ok: false, error: '不能合并到自己' });
        if (!st.tags.some((t) => Number(t.id) === targetId)) return send(res, 200, { ok: false, error: '目标标签不存在' });
      }
      const changed = retagSnippets(id, targetId);
      st.tags = st.tags.filter((t) => Number(t.id) !== id);
      writeState(st);
      return send(res, 200, {
        ok: true,
        changed,
        message: action === 'delete'
          ? '已删除标签「' + tag.name + '」，并从 ' + changed + ' 个片段移除'
          : '已把「' + tag.name + '」合并，' + changed + ' 个片段改用目标标签',
      });
    }
    return send(res, 200, { ok: false, error: '未知标签操作：' + action });
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
