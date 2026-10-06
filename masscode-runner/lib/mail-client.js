'use strict';

/* ── 极简 SMTP 客户端（只用 Node 内置 tls/net，不引第三方库）──────────────
   为什么自己写：项目一直避免为一个小功能引入依赖 ✗（参考 mermaid / d3 都是 vendor 进来的）。
   SMTP 发信本身只要几十行：TLS 连接 → EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA ✓。

   支持的形态：
   · 隐式 TLS（465，smtp.gmail.com / smtp.qq.com / smtp.2925.com 都是这种）✓
   · 明文 + STARTTLS（587 / 25）✓ —— 很多服务器只在这个端口上开 STARTTLS
   不支持：OAuth2（Gmail 的 XOAUTH2）✗ —— 用「应用专用密码」走 AUTH LOGIN 就够 ✓。 */

const tls = require('tls');
const net = require('net');

const DEFAULT_TIMEOUT = 20000;

class SmtpError extends Error {
  constructor(message, step, response) {
    super(message);
    this.name = 'SmtpError';
    this.step = step;
    this.response = response || '';
  }
}

/* 读一条 SMTP 响应：多行响应用 "250-xxx" 续行、最后一行是 "250 xxx" ✓ */
function readResponse(sock, timeout) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const finish = (fn, arg) => {
      sock.off('data', onData); sock.off('error', onError); clearTimeout(timer);
      fn(arg);
    };
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\r\n').filter((line) => line.length > 0);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3}([ ]|$)/.test(last)) {
        const code = Number(last.slice(0, 3));
        finish(resolve, { code, text: buf.replace(/\r\n$/, '') });
      }
    };
    const onError = (error) => finish(reject, error);
    const timer = setTimeout(() => finish(reject, new SmtpError('等待服务器响应超时', 'timeout', buf)), timeout);
    sock.on('data', onData);
    sock.on('error', onError);
  });
}

async function command(sock, line, timeout) {
  sock.write(line + '\r\n');
  return readResponse(sock, timeout);
}

async function expect(sock, line, okCodes, step, timeout) {
  const res = await command(sock, line, timeout);
  if (!okCodes.includes(res.code)) {
    throw new SmtpError(`SMTP ${step} 失败：${res.code} ${res.text.split('\n').pop()}`, step, res.text);
  }
  return res;
}

/* 建立连接（隐式 TLS 或 明文+STARTTLS）*/
async function connect(account, timeout) {
  const host = String(account.host || '').trim();
  const port = Number(account.port || 465);
  if (!host) throw new SmtpError('没有填 SMTP 服务器', 'config');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SmtpError('SMTP 端口不合法', 'config');
  const steps = [];

  if (port === 465) {
    const sock = await openTls(host, port, timeout);
    steps.push(`TLS 已连接 ${host}:${port}`);
    const greeting = await readResponse(sock, timeout);
    if (greeting.code !== 220) throw new SmtpError(`服务器问候异常：${greeting.code}`, 'greeting', greeting.text);
    steps.push('服务器就绪（220）');
    return { sock, steps, tls: true };
  }

  /* 25 / 587：明文连上，EHLO 后 STARTTLS 升级 ✓ */
  const plain = await openPlain(host, port, timeout);
  const greeting = await readResponse(plain, timeout);
  if (greeting.code !== 220) { plain.destroy(); throw new SmtpError(`服务器问候异常：${greeting.code}`, 'greeting', greeting.text); }
  const ehlo1 = await command(plain, 'EHLO codescope.local', timeout);
  if (!/STARTTLS/i.test(ehlo1.text)) {
    plain.destroy();
    throw new SmtpError(`${host}:${port} 不支持 STARTTLS，也没有用 465 —— 换 465 试试`, 'starttls', ehlo1.text);
  }
  await expect(plain, 'STARTTLS', [220], 'STARTTLS', timeout);
  steps.push(`STARTTLS 升级 ${host}:${port}`);
  const sock = await upgradeTls(plain, host, timeout);
  return { sock, steps, tls: true };
}

function openTls(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host });
    const timer = setTimeout(() => { sock.destroy(); reject(new SmtpError(`连接 ${host}:${port} 超时`, 'connect')); }, timeout);
    sock.once('secureConnect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', (error) => { clearTimeout(timer); reject(new SmtpError(`连接 ${host}:${port} 失败：${error.code || error.message}`, 'connect')); });
  });
}
function openPlain(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => { sock.destroy(); reject(new SmtpError(`连接 ${host}:${port} 超时`, 'connect')); }, timeout);
    sock.once('connect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', (error) => { clearTimeout(timer); reject(new SmtpError(`连接 ${host}:${port} 失败：${error.code || error.message}`, 'connect')); });
  });
}
function upgradeTls(plain, host, timeout) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ socket: plain, servername: host });
    const timer = setTimeout(() => { sock.destroy(); reject(new SmtpError('STARTTLS 握手超时', 'starttls')); }, timeout);
    sock.once('secureConnect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', (error) => { clearTimeout(timer); reject(new SmtpError(`STARTTLS 失败：${error.message}`, 'starttls')); });
  });
}

/* EHLO + AUTH LOGIN（base64 用户名 / 密码）*/
async function authenticate(sock, account, timeout) {
  const user = String(account.user || '').trim();
  const pass = String(account.pass || '');
  const steps = [];
  const ehlo = await command(sock, 'EHLO codescope.local', timeout);
  if (ehlo.code !== 250) throw new SmtpError(`EHLO 失败：${ehlo.code}`, 'ehlo', ehlo.text);
  steps.push('EHLO 成功');
  if (!user) throw new SmtpError('没有填邮箱账号', 'config');
  if (!pass) throw new SmtpError('没有填授权码 / 密码', 'config');

  if (!/AUTH/i.test(ehlo.text)) throw new SmtpError('服务器没有声明 AUTH 支持', 'auth', ehlo.text);
  const auth = await command(sock, 'AUTH LOGIN', timeout);
  if (auth.code !== 334) throw new SmtpError(`服务器不接受 AUTH LOGIN：${auth.code}`, 'auth', auth.text);
  const u = await command(sock, Buffer.from(user, 'utf8').toString('base64'), timeout);
  if (u.code !== 334) throw new SmtpError(`用户名步骤异常：${u.code}`, 'auth', u.text);
  const p = await command(sock, Buffer.from(pass, 'utf8').toString('base64'), timeout);
  if (p.code !== 235) {
    /* 535 = 认证失败，最常见的原因是「用了登录密码」而不是授权码 / 应用专用密码 ✓ */
    const hint = p.code === 535 ? '（授权码/密码不对：QQ/网易要用「授权码」，Gmail 要用「应用专用密码」，不能用登录密码）' : '';
    throw new SmtpError(`认证失败：${p.code} ${p.text.split('\n').pop()}${hint}`, 'auth', p.text);
  }
  steps.push('认证通过（235）');
  return steps;
}

function encodeHeader(value) {
  /* 非 ASCII 的主题 / 发件人名字要按 RFC 2047 编码，否则会乱码 ✓ */
  const text = String(value == null ? '' : value);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return '=?UTF-8?B?' + Buffer.from(text, 'utf8').toString('base64') + '?=';
}
function buildMessage(from, to, subject, body) {
  const lines = [];
  lines.push('From: ' + encodeHeader(from.name ? from.name + ' <' + from.address + '>' : from.address));
  lines.push('To: ' + to.join(', '));
  lines.push('Subject: ' + encodeHeader(subject || '(无主题)'));
  lines.push('Date: ' + new Date().toUTCString());
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  /* 正文按 76 列折行的 base64（避免长行被中间服务器截断 ✓）*/
  const b64 = Buffer.from(String(body || ''), 'utf8').toString('base64');
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

/* 测试连接 + 认证（不发信）→ { ok, steps, error } */
async function testConnection(account, options) {
  const timeout = (options && options.timeout) || DEFAULT_TIMEOUT;
  const steps = [];
  let sock = null;
  try {
    const conn = await connect(account, timeout);
    sock = conn.sock;
    steps.push(...conn.steps);
    steps.push(...(await authenticate(sock, account, timeout)));
    try { await command(sock, 'QUIT', 3000); } catch (_) {}
    return { ok: true, steps };
  } catch (error) {
    return { ok: false, steps, error: error.message, step: error.step || '', response: error.response || '' };
  } finally {
    if (sock) { try { sock.destroy(); } catch (_) {} }
  }
}

/* 发一封信 → { ok, steps, error } */
async function sendMail(account, message, options) {
  const timeout = (options && options.timeout) || DEFAULT_TIMEOUT;
  const steps = [];
  let sock = null;
  const from = String(account.user || '').trim();
  try {
    const to = (message.to || []).map((x) => String(x).trim()).filter(Boolean);
    if (!from) throw new SmtpError('没有填发件邮箱', 'config');
    if (!to.length) throw new SmtpError('没有填收件人', 'config');

    const conn = await connect(account, timeout);
    sock = conn.sock;
    steps.push(...conn.steps);
    steps.push(...(await authenticate(sock, account, timeout)));

    await expect(sock, 'MAIL FROM:<' + from + '>', [250], 'MAIL FROM', timeout);
    steps.push('发件人已受理');
    for (const addr of to) await expect(sock, 'RCPT TO:<' + addr + '>', [250, 251], 'RCPT TO', timeout);
    steps.push(`收件人已受理（${to.length} 个）`);

    await expect(sock, 'DATA', [354], 'DATA', timeout);
    const data = buildMessage({ address: from, name: message.fromName || '' }, to, message.subject, message.body);
    /* DATA 结束标记必须是单独一行的 "." ✓ */
    sock.write(data + '\r\n.\r\n');
    const done = await readResponse(sock, timeout);
    if (done.code !== 250) throw new SmtpError(`发送被拒：${done.code} ${done.text.split('\n').pop()}`, 'data', done.text);
    steps.push('服务器已接收（250）');
    try { await command(sock, 'QUIT', 3000); } catch (_) {}
    return { ok: true, steps, messageId: (done.text.match(/id=([^\s]+)/i) || [])[1] || '' };
  } catch (error) {
    return { ok: false, steps, error: error.message, step: error.step || '', response: error.response || '' };
  } finally {
    if (sock) { try { sock.destroy(); } catch (_) {} }
  }
}

module.exports = { testConnection, sendMail, SmtpError };
