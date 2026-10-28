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
   所以 code-server 只绑 127.0.0.1，对外只经这个代理，并把 CodeScope 的同源校验照搬过来。

   ★★ 光有同源校验不够 ✗✗（2026-10-28）——
   这个代理**自己 createServer** ✓，请求**根本不过** CodeScope 的 `/api/*` 鉴权中间件 ✗。
   主服务加了访问码之后，局域网里随便一台设备直连这个端口 ✓ 就能拿到整台机器的终端 ✗，
   等于把刚装上的锁从旁边那扇门绕过去了 ✗。
   ⇒ 复用**同一份**判据 ✓（`authorize` 回调，形态照 `isAllowed` ✓，实现见 server.js 的 proxyAuthGate ✓）：
     ① 回环放行 ✓（本机那套用法零变化 ✓）；
     ② 非回环要有效 cookie / X-CS-Auth ✓，否则 **401** ✓；
     ③ ⚠️ 拒绝由**代理自己**写回 ✗ 不转给后端 ✓ —— 后端是 code-server / DSH ✓，
        它们不认识这个 401 ✓，真转过去只会变成一个看不懂的 502 或白屏 ✗。 */

const http = require('http');
const net = require('net');
const zlib = require('zlib');

/* ── 边转发边压缩 ✓✓ ──
   ⚠️⚠️ 为什么必须做 ✗✗：实测（2026-10-09）从云服务器加载编辑工作台，
      首屏 **27 MB / 72 个请求 / 60 秒以上** ✗ —— 而这 27 MB 是**未压缩**的 ✗：
      code-server 自带的资源里**一个 `.js.gz` 都没有** ✓，代理又是裸 `pipe` ✓，
      于是 1~2 MB 的 JS 原样裸传 ✓。VPS 出口只有 ~0.7 MB/s ✓ → 自然卡死 ✓。
   → 对**文本类**资源做 gzip ✓（JS/CSS/HTML/JSON/SVG ✓），实测能省 3~4 倍 ✓。
   ⚠️ 不压的 ✗：图片 / 字体 / 音视频（本来就压过了 ✓）、
      已经带 `Content-Encoding` 的 ✗、以及太小的（< 1KB，压了反而更大 ✓）。
   ⚠️ 压了以后 `Content-Length` 就不对了 ✗ → 必须删掉 ✓（改用 chunked ✓）。 */
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|xhtml\+xml|manifest\+json)|image\/svg\+xml)/i;
const MIN_COMPRESS_BYTES = 1024;

function wantsGzip(req) {
  const raw = req.headers['accept-encoding'];
  return typeof raw === 'string' && /\bgzip\b/i.test(raw);
}

function copyHeaders(rawHeaders, targetHost) {
  const lines = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index], value = rawHeaders[index + 1];
    const lower = String(name).toLowerCase();
    /* Host / Origin 一律改写成目标地址：让 code-server 看到的是一个自洽的同源请求。 */
    if (lower === 'host') { lines.push(`${name}: ${targetHost}`); continue; }
    if (lower === 'origin') { lines.push(`${name}: http://${targetHost}`); continue; }
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
  /* 鉴权回调（可选）✓：返回 null = 放行 ✓，返回 { status, message } = 拦住 ✓（见文件头那段）。
     ⚠️ 和 isAllowed 分开 ✗：那个是「同源校验」（防跨站 ✓），这个是「你是谁」（防局域网 ✓）——
        两件事混进一个回调，以后想单独关掉其中一个就没法关了 ✓。 */
  const authorize = typeof options.authorize === 'function' ? options.authorize : null;
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

  /* ★ 拒绝判据**只此一处** ✓（HTTP 路径与 WS 升级共用 ✓）——
     原来两处各内联一句 `if (!isAllowed(req)) → 403` ✗，再叠一层鉴权就会变成「改一处漏一处」✗。
     ⚠️ authorize 抛异常时**一律拒绝** ✗（fail closed ✓）——
        启动早期鉴权常量还没初始化、或配置读失败时，「放行」= 门开着且没人知道 ✗。 */
  function denialOf(req) {
    if (!isAllowed(req)) return { status: 403, message: '已拒绝跨站请求' };
    if (!authorize) return null;
    try {
      const denied = authorize(req);
      if (!denied) return null;
      return { status: Number(denied.status) || 401, message: String(denied.message || denied.error || '需要访问码') };
    } catch (_) {
      return { status: 401, message: '鉴权状态尚未就绪，请稍后重试' };
    }
  }

  function forward(req, res) {
    const denied = denialOf(req);
    if (denied) return res.writeHead(denied.status, { 'content-type': 'text/plain; charset=utf-8' }).end(denied.message);
    const upstream = http.request({ host: targetHost, port: targetPort, method: req.method, path: req.url, headers: Object.fromEntries(copyHeaders(req.rawHeaders, upstreamHost).map((line) => { const at = line.indexOf(':'); return [line.slice(0, at), line.slice(at + 1).trim()]; })) }, (upstreamRes) => {
      const headers = upstreamRes.headers;
      const type = String(headers['content-type'] || '');
      const already = !!headers['content-encoding'];
      const size = Number(headers['content-length'] || 0);
      /* ★ 该压的才压 ✓（详见文件头那段注释 ✓）*/
      const shouldGzip = wantsGzip(req) && !already && COMPRESSIBLE.test(type)
        && (size === 0 || size >= MIN_COMPRESS_BYTES);
      if (shouldGzip) {
        delete headers['content-length'];          /* 压缩后长度变了 ✗，必须删 ✓ */
        headers['content-encoding'] = 'gzip';
        /* `Vary` 要带上 ✓：不然中间有缓存时会拿压缩版喂给不支持 gzip 的客户端 ✗ */
        headers['vary'] = headers['vary'] ? headers['vary'] + ', Accept-Encoding' : 'Accept-Encoding';
        res.writeHead(upstreamRes.statusCode || 502, headers);
        const gz = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
        gz.on('error', () => { try { res.end(); } catch (_) {} });
        upstreamRes.on('error', () => { try { gz.end(); } catch (_) {} });
        upstreamRes.pipe(gz).pipe(res);
        return;
      }
      res.writeHead(upstreamRes.statusCode || 502, headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('VS Code 服务未就绪'); });
    req.pipe(upstream);
  }

  function onUpgrade(req, socket, head) {
    /* ⚠️ WS 升级走 'upgrade' 事件 ✗ —— 它**不经过** forward ✓，必须再判一次 ✓
       （但判据仍是同一个 denialOf ✓，不是第二份逻辑 ✓）。
       浏览器建 WS **不能自定义请求头** ✗ → 远端只能靠 cookie ✓（cookie 不按端口隔离 ✓）。 */
    const denied = denialOf(req);
    if (denied) {
      const text = denied.status === 401 ? 'Unauthorized' : denied.status === 403 ? 'Forbidden' : 'Error';
      socket.write('HTTP/1.1 ' + denied.status + ' ' + text + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy(); return;
    }
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
