'use strict';

/* ── code-server 的反向代理（HTTP + WebSocket） ──
   为什么需要一个独立端口，而不是挂在 CodeScope 的某个子路径下：
   VS Code Web 内部大量使用以 `/` 为根的绝对路径（/static、/out、/vscode-remote-resource、
   /proxy/<port>、WebSocket /ws…），挂在子路径下必然要重写一大片资源地址 ——
   code-server 官方 FAQ 说「有子路径托管能力」但没给任何 flag，实测也没验证成功。
   而**再开一个端口、让 VS Code 待在根路径**这条路完全不依赖子路径支持，是最稳的。

   为什么必须经代理、不能把 code-server 直接暴露出去：
   code-server 自己那套鉴权只有「一个密码」这一档，而 CodeScope 服务端目前没有任何鉴权、
   只有同源校验。如果直接把 4899 端口开到局域网上，等于绕开 CodeScope 直接给整台机器开门。
   所以 code-server 只绑 127.0.0.1，对外只经这个代理，并把 CodeScope 的同源校验照搬过来。 */

const http = require('http');
const net = require('net');

function copyHeaders(rawHeaders, targetHost) {
  const lines = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index], value = rawHeaders[index + 1];
    const lower = String(name).toLowerCase();
    /* Host 改写成目标地址：code-server 用它做同源判断，不改会被拒。
       Origin **保持原样**（浏览器看到的是代理地址）：
       VS Code 会用 Origin 生成 webview 的校验参数（pre/index.html?origin=...），
       如果这里改成上游地址，iframe 里的校验就会与浏览器实际的父窗口 origin 对不上，
       消息被丢弃 → webview 永远不回报就绪 → 图片/Markdown 预览无限转圈（踩过）。 */
    if (lower === 'host') { lines.push(`${name}: ${targetHost}`); continue; }
    if (lower === 'connection' || lower === 'upgrade') continue;
    lines.push(`${name}: ${value}`);
  }
  return lines;
}

function createCodeServerProxy(options = {}) {
  const listenHost = options.listenHost || '127.0.0.1';
  const listenPort = Number(options.listenPort) || 0;
  const targetHost = options.targetHost || '127.0.0.1';
  const isAllowed = typeof options.isAllowed === 'function' ? options.isAllowed : () => true;
  const onNotice = typeof options.onNotice === 'function' ? options.onNotice : () => {};
  let targetPort = Number(options.targetPort) || 0;
  let upstreamHost = `${targetHost}:${targetPort}`;
  let server = null;
  let listening = false;

  /* code-server 的内部端口可能被占（这台机器上 4899 就有个来路不明的反代在 502 重试），
     托管服务启动时会自动换空闲端口——代理的转发目标必须跟着切，否则整条链路静默断掉。 */
  function setTargetPort(next) {
    const port = Number(next) || 0;
    if (!port || port === targetPort) return;
    targetPort = port;
    upstreamHost = `${targetHost}:${targetPort}`;
    onNotice(`VS Code 代理目标已切换：${upstreamHost}`);
  }

  function forward(req, res) {
    if (!isAllowed(req)) return res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('已拒绝跨站请求');
    const upstream = http.request({ host: targetHost, port: targetPort, method: req.method, path: req.url, headers: Object.fromEntries(copyHeaders(req.rawHeaders, upstreamHost).map((line) => { const at = line.indexOf(':'); return [line.slice(0, at), line.slice(at + 1).trim()]; })) }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('VS Code 服务未就绪'); });
    req.pipe(upstream);
  }

  function onUpgrade(req, socket, head) {
    if (!isAllowed(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    const upstream = net.connect(targetPort, targetHost, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const line of copyHeaders(req.rawHeaders, upstreamHost)) lines.push(line);
      lines.push('Connection: Upgrade', 'Upgrade: websocket', '', '');
      upstream.write(lines.join('\r\n'));
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.setTimeout(8000, () => upstream.destroy());
    upstream.once('connect', () => upstream.setTimeout(0));
    upstream.on('error', () => { try { socket.destroy(); } catch (_) {} });
    socket.on('error', () => { try { upstream.destroy(); } catch (_) {} });
    socket.on('close', () => { try { upstream.destroy(); } catch (_) {} });
  }

  function start() {
    return new Promise((resolve) => {
      if (server) return resolve(listening);
      server = http.createServer(forward);
      server.on('upgrade', onUpgrade);
      server.on('error', (error) => {
        listening = false;
        onNotice(`VS Code 代理端口 ${listenHost}:${listenPort} 不可用：${error.code === 'EADDRINUSE' ? '端口已被占用' : (error.message || error)}`);
        try { server.close(); } catch (_) {}
        server = null;
        resolve(false);
      });
      server.listen(listenPort, listenHost, () => {
        listening = true;
        onNotice(`VS Code 代理已就绪：http://${listenHost}:${listenPort}/ → ${upstreamHost}`);
        resolve(true);
      });
    });
  }

  function stop() {
    if (!server) return;
    try { server.close(); } catch (_) {}
    server = null;
    listening = false;
  }

  return { start, stop, setTargetPort, isListening: () => listening, listenPort, listenHost };
}

module.exports = { createCodeServerProxy };
