'use strict';

/* ── DSH（DeepSeek Harness）的反向代理 ─────────────────────────────────────
   为什么要单独一个端口，而不是挂在 CodeScope 的子路径下：
   DSH 前端和 code-server 一样，大量使用以 `/` 为根的绝对路径（/assets、/api、WebSocket…），
   挂子路径就得重写一大片资源地址 ✗ —— 再开一个端口、让它待在根路径最稳 ✓
   （和 lib/code-server-proxy.js 是同一套做法，直接复用那个实现 ✓）

   为什么必须经代理：
   DSH 由 lib/dsh-service.js 以 `--host 127.0.0.1` 启动 ✓（**只绑回环**）——
   这是有意的：不想因为 CodeScope 开了局域网就把智能体 API 直接暴露出去 ✓。
   但前端 `dshLaunchUrl()` 在非本机访问时返回的是 `service.url`（= http://127.0.0.1:3080/?token=…）
   → 局域网设备打开会**指到它自己身上** ✓ 必然打不开 ✗
   ⇒ 由这里转发到 127.0.0.1:3080，前端改指 `http://<当前主机名>:<代理端口>/?token=…` ✓
   ⚠️ 同源校验（isAllowed）照搬 CodeScope 的 trustedHttpOrigin，不额外开门 ✓ */

const { createCodeServerProxy } = require('./code-server-proxy');

const DEFAULT_PROXY_PORT = 3081;
const DEFAULT_DSH_PORT = 3080;

function createDshProxy(options = {}) {
  const getPort = typeof options.getPort === 'function' ? options.getPort : () => DEFAULT_DSH_PORT;
  const initial = Number(getPort()) || DEFAULT_DSH_PORT;

  const proxy = createCodeServerProxy({
    listenHost: options.listenHost || '127.0.0.1',
    listenPort: Number(options.listenPort) || Number(process.env.CODESCOPE_DSH_PROXY_PORT) || DEFAULT_PROXY_PORT,
    targetHost: '127.0.0.1',
    targetPort: initial,
    isAllowed: options.isAllowed,
    onNotice: options.onNotice || ((message) => console.log('[DSH 代理] ' + message)),
  });

  /* DSH 的端口可能被占用后自动换（CODESCOPE_DSH_PORT / 启动时挑空闲端口）✓
     每 5 秒对一次，变了就跟着切 —— 不然代理还指着旧端口，iframe 一直 502 ✓ */
  let current = initial;
  const sync = () => {
    let next = 0;
    try { next = Number(getPort()) || 0; } catch (_) { next = 0; }
    if (!next || next === current) return;
    current = next;
    try { proxy.setTargetPort(next); } catch (_) {}
  };
  setInterval(sync, 5000).unref?.();
  sync();

  /* 自启动：server.js 那边只 require 一行，不用再写 start() ✓（守 server.js 行数棘轮） */
  try { proxy.start(); } catch (_) {}

  return proxy;
}

module.exports = { createDshProxy, DEFAULT_PROXY_PORT };
