'use strict';

/* ── 邮件列表「行」的组装 —— 纯逻辑、无 IO，可单测 ✓ ────────────────────────
   为什么单独拎出来：这里有一个**只在特定服务器上才暴露**的坑 ✗，
   留在 server.js 的路由里根本测不到 ✗（那个文件是个大 if 链，没法单测 ✗）。 */

/* ⚠️⚠️ `UID SEARCH 1:*` 会把**已经删掉的旧 UID** 也带回来 ✗✗ ——
   实测 2925（无限邮）：`UID SEARCH 1:*` 回 **85** 个 UID，而同一时刻
   `STATUS` 说收件箱只有 **71** 封 ✗（差 14 个是已删除、UID 还没被回收的 ✗）。
   这些 UID 拿去 `UID FETCH` 是**不会有任何响应**的 ✓ ——
   以前照样给它们各生成一行 ✗ → 列表里冒出若干「(无主题)」的空邮件 ✗，
   用户看着就像坏了 ✗。
   → **丢掉没有 FETCH 响应的那些** ✓。

   ⚠️ 但**不能无条件丢** ✗：万一服务器一封都没响应（异常 / 被限流），
      无条件丢会把整列清空 ✗ —— 那比几行空邮件更糟 ✗。
      所以只在「至少回来了一部分」时才丢 ✓。 */
function buildMailRows(pick, heads, mime) {
  const list = Array.isArray(pick) ? pick : [];
  const rows = Array.isArray(heads) ? heads : [];
  const byUid = new Map(rows.map((h) => [h.uid, h]));
  const keep = rows.length ? list.filter((uid) => byUid.has(uid)) : list;
  return keep.map((uid) => {
    const h = byUid.get(uid);
    const H = h ? mime.parseHeaders(h.headerRaw) : {};
    const from = mime.parseAddress(mime.decodeHeader(H.from));
    return {
      uid,
      subject: mime.decodeHeader(H.subject) || '(无主题)',
      fromName: from.name || from.address,
      fromAddress: from.address,
      date: mime.parseMessage(h ? h.headerRaw : Buffer.alloc(0)).date || 0,
      size: h ? h.size : 0,
      seen: !!(h && h.flags.includes('\\Seen')),
      flagged: !!(h && h.flags.includes('\\Flagged')),
    };
  });
}

module.exports = { buildMailRows };
