'use strict';

/* ── 局域网相关：地址查询 + 文件下载 ────────────────────────────────────────
   ① `GET /api/lan`            当前这台机器的局域网访问地址
   ② `GET /api/lan/download`   把 vault 里的文件**下载到访问者的电脑**上

   为什么这两个放同一个文件 ✗：
   `/api/lan` 里其实有 `server.lanUrls` ✓，但那个接口要跑一遍完整的环境探测
   （工具版本、code-server、依赖…几十到几百毫秒）✓。
   而顶栏那个「局域网地址」标签需要**经常刷新** —— 换网络、重启电脑后 IP 会变 ✓，
   用户就是要靠它知道 Windows 该输什么地址 ✓ → 这里只查网卡，几毫秒 ✓。

   为什么下载也放这里 ✓：
   用户原话「如果在局域网访问，需要有下载到本地电脑功能」✓ ——
   **从别的机器打开 CodeScope 时，文件在 Mac 上，没法直接另存** ✗，
   所以得有一个"把 vault 里的文件推给访问者"的出口 ✓。放这个文件里刚好同属"局域网"这一块 ✓。

   ⚠️ 下载必须**限制在 vault 目录内** ✗ —— 传 `path` 参数进来，先 resolve 再比对前缀，
      否则等于给整个磁盘开了个下载口 ✓。 */

const os = require('os');
const fs = require('fs');
const path = require('path');

/* 网卡排序：有线/Wi-Fi 优先，虚拟网卡（Tailscale 的 utun、虚拟机的 bridge、AirDrop 的 awdl）排后面
   —— 用户要的是"同一局域网里另一台机器能打开的那个地址"✓ */
function ifaceRank(name) {
  if (/^(en\d|eth\d+|wlan\d+|wlp\w+)$/i.test(name)) return 0;
  if (/^(utun|bridge|awdl|llw|ap\d|vmnet|vboxnet|docker|br-)/i.test(name)) return 2;
  return 1;
}

function lanUrls(port) {
  const list = [];
  try {
    for (const [name, rows] of Object.entries(os.networkInterfaces())) {
      for (const row of rows || []) {
        if (row.internal || row.family !== 'IPv4') continue;
        if (/^169\.254\./.test(row.address)) continue;          // 自动私有地址 = 没连上 DHCP，别推给用户
        list.push({ iface: name, address: row.address, url: 'http://' + row.address + ':' + port });
      }
    }
  } catch (_) { /* 拿不到网卡就当没有 */ }
  list.sort((a, b) => ifaceRank(a.iface) - ifaceRank(b.iface) || a.address.localeCompare(b.address));
  return list;
}

function vaultRootOf(ctx) {
  try {
    const fn = ctx && ctx.vaultPath;
    const root = typeof fn === 'function' ? fn() : String(fn || '');
    return root ? path.resolve(root) : '';
  } catch (_) { return ''; }
}

/* 把文件推给访问者（浏览器会弹「另存为」）✓ */
function sendDownload(res, abs) {
  let st;
  try { st = fs.statSync(abs); } catch (_) { return false; }
  if (!st.isFile()) return false;
  const name = path.basename(abs);
  const enc = encodeURIComponent(name);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': st.size,
    /* 中文文件名必须走 RFC 5987 的 `filename*` ✓ —— 只写 filename= 会变成乱码或 .bin ✓ */
    'content-disposition': 'attachment; filename="' + enc + '"; filename*=UTF-8\'\'' + enc,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  fs.createReadStream(abs).on('error', () => { try { res.end(); } catch (_) {} }).pipe(res);
  return true;
}

async function handle(req, res, u, ctx) {
  const { send } = ctx;
  if (req.method !== 'GET') return false;

  if (u.pathname === '/api/lan') {
    /* 端口取**真实监听端口** ✓ —— 用户可能用 CODESCOPE_PORT 改过，写死 4877 会给出错地址 */
    const port = Number(req.socket && req.socket.localPort) || 4877;
    const urls = lanUrls(port);
    send(res, 200, { ok: true, port, urls, primary: urls[0] || null, vaultRoot: vaultRootOf(ctx), at: Date.now() });
    return true;
  }

  if (u.pathname === '/api/lan/download') {
    const root = vaultRootOf(ctx);
    const raw = String(u.searchParams.get('path') || '');
    if (!root || !raw) { send(res, 400, { ok: false, error: '缺少文件路径' }); return true; }
    const abs = path.resolve(raw);
    if (abs !== root && !abs.startsWith(root + path.sep)) { send(res, 403, { ok: false, error: '只能下载 vault 目录内的文件' }); return true; }
    if (!sendDownload(res, abs)) { send(res, 404, { ok: false, error: '文件不存在或不是普通文件' }); return true; }
    return true;
  }

  return false;
}

module.exports = { handle, lanUrls };
