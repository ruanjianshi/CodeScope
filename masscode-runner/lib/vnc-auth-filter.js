'use strict';

/* ── 让 noVNC 能连 macOS 的屏幕共享：摘掉 Apple 专有的安全类型 ────────────────
   现象（2026-10-26 实测）：CodeScope 里连 macOS 的 5900，界面**一直停在「正在连接…」**
   既不报错也不超时 ✓ —— 但同一台机器用 nc 连 5900 能拿到 `RFB 003.889` ✓，
   隧道本身也通（用假 VNC 服务端验证过）✓。

   根因：Apple 广播的安全类型是
     `30(ARD), 33, 36, 31, 32, 2(VNC 密码), 35`
   ARD(30) **排在前面** ✓，而 noVNC 1.7 的 `securityTypeARD` 只有**不完整实现** ✗ ——
   它按顺序挑中 30 之后就卡在 Apple 的 ARD 认证握手里，永远等不到结果 ✓。
   （把列表改成只剩 `2` 之后，noVNC 立刻变成正常的「密码错误」提示 ✓ —— 已验证）

   做法：**只改安全类型列表这一帧**（版本横幅之后的第一次下行），
   把 30/31/32/33/35/36 摘掉，留标准的 1(无认证)/2(VNC 密码) ✓；
   其余字节**原样透传** ✓，不影响后续协议。 */

const { Transform } = require('stream');

const APPLE_ONLY = new Set([30, 31, 32, 33, 35, 36]);

function createVncAuthFilter() {
  let stage = 0;              // 0=等版本横幅 1=等安全类型列表 2=已处理完，纯透传
  let buf = Buffer.alloc(0);

  return new Transform({
    transform(chunk, _enc, cb) {
      if (stage >= 2) return cb(null, chunk);
      buf = Buffer.concat([buf, chunk]);

      /* ① 服务器版本横幅：`RFB 003.889\n`，按换行切 */
      if (stage === 0) {
        const nl = buf.indexOf(10);
        if (nl < 0) return cb();
        this.push(buf.slice(0, nl + 1));
        buf = buf.slice(nl + 1);
        stage = 1;
        if (!buf.length) return cb();
      }

      /* ② 安全类型列表：`[数量, 类型…]` */
      if (stage === 1) {
        if (!buf.length) return cb();
        const n = buf[0];
        if (buf.length < 1 + n) return cb();          // 还没收齐，继续等
        const types = [...buf.slice(1, 1 + n)];
        const kept = types.filter((t) => !APPLE_ONLY.has(t));
        /* 一个都不剩就别动（宁可原样，也别把连接搞坏） */
        const head = kept.length ? Buffer.from([kept.length, ...kept]) : buf.slice(0, 1 + n);
        const rest = buf.slice(1 + n);
        stage = 2;
        buf = Buffer.alloc(0);
        this.push(head);
        if (rest.length) this.push(rest);
        return cb();
      }

      return cb();
    },
  });
}

module.exports = { createVncAuthFilter, APPLE_ONLY };
