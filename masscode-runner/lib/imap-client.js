'use strict';

/* ── 极简 IMAP 客户端（只用 Node 内置 tls/net，零第三方依赖）──────────────
   为什么要自己写：和 SMTP 同理 —— 为一个「收信」功能引 imap 库不划算 ✗，
   而且项目一直是「vendor / 自研」的路子 ✓（mermaid、d3、SMTP 都是这样）。

   覆盖到的命令（够做一个收件箱 ✓）：
     CAPABILITY / ID / LOGIN / SELECT / STATUS / UID SEARCH / UID FETCH / UID STORE / LOGOUT

   ★★ 最大的坑：**IMAP 的字面量（literal）** ✗
   服务器会先发一行 `* 1 FETCH (BODY[HEADER] {342}`，**然后原样吐 342 个字节**，
   之后才接着发剩下的 `)` 和下一行 ✓。
   所以**不能按行读** ✗ —— 必须按 Buffer 累积、遇到 `{n}` 就精确取 n 字节 ✓。
   按 `\r\n` 切行的话，正文里只要有换行就会把一封信切成无数行 ✗（而且 base64 里没有换行更糟，
   会把后面的响应一起吞进正文 ✗）。这是自研 IMAP 最容易写错的地方。

   支持：993 隐式 TLS ✓ / 143 明文 + STARTTLS ✓
   不支持：OAuth2（XOAUTH2）✗ —— 用「授权码 / 应用专用密码」走 LOGIN 就够 ✓ */

const tls = require('tls');
const net = require('net');

const DEFAULT_TIMEOUT = 25000;
const CRLF = Buffer.from('\r\n');

class ImapError extends Error {
  constructor(message, step, response) {
    super(message);
    this.name = 'ImapError';
    this.step = step || '';
    this.response = response || '';
  }
}

/* ── 缓冲读取器：按「单元（行 / 字面量）」推进 ─────────────────────────── */
function makeReader(sock) {
  let buf = Buffer.alloc(0);
  let waiter = null;
  let closed = false;
  let failure = null;
  const wake = () => { const w = waiter; waiter = null; if (w) w(); };

  sock.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); wake(); });
  sock.on('error', (error) => { failure = error; closed = true; wake(); });
  sock.on('end', () => { closed = true; wake(); });
  sock.on('close', () => { closed = true; wake(); });

  /* 等到 pred() 为真（数据够了一个完整单元）才返回 ✓ */
  async function waitFor(pred, deadline) {
    while (true) {
      if (pred()) return;
      if (failure) throw new ImapError('连接出错：' + (failure.code || failure.message), 'socket');
      if (closed) throw new ImapError('连接被服务器关闭', 'socket');
      if (deadline && Date.now() > deadline) throw new ImapError('等待服务器响应超时', 'timeout');
      await new Promise((resolve) => {
        waiter = resolve;
        /* 兜底：万一漏了 wake，也靠这个定时器醒过来查 deadline ✓ */
        const t = setTimeout(resolve, 250);
        if (t.unref) t.unref();
      });
    }
  }

  return {
    get buf() { return buf; },
    set buf(v) { buf = v; },
    waitFor,
    get closed() { return closed; },
  };
}

/* 判断当前缓冲里是否已经有一个完整的「单元」✓ */
function peekUnit(reader) {
  const idx = reader.buf.indexOf(CRLF);
  if (idx < 0) return null;
  const line = reader.buf.slice(0, idx).toString('utf8');
  const lit = /\{(\d+)\}$/.exec(line);
  if (lit) {
    const n = Number(lit[1]);
    if (reader.buf.length < idx + 2 + n) return null;         /* 字面量还没收齐 ✓ */
    return { type: 'literal', line, size: n, head: idx + 2 };
  }
  return { type: 'line', text: line, size: idx + 2, head: 0 };
}

function takeUnit(reader, unit) {
  if (unit.type === 'literal') {
    const data = reader.buf.slice(unit.head, unit.head + unit.size);
    reader.buf = reader.buf.slice(unit.head + unit.size);
    return { type: 'literal', line: unit.line, data };
  }
  reader.buf = reader.buf.slice(unit.size);
  return { type: 'line', text: unit.text };
}

async function nextUnit(reader, deadline) {
  await reader.waitFor(() => peekUnit(reader) !== null, deadline);
  return takeUnit(reader, peekUnit(reader));
}

/* ── 连接 ──────────────────────────────────────────────────────────────── */
function openTls(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host });
    const timer = setTimeout(() => { sock.destroy(); reject(new ImapError(`连接 ${host}:${port} 超时`, 'connect')); }, timeout);
    sock.once('secureConnect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', (error) => { clearTimeout(timer); reject(new ImapError(`连接 ${host}:${port} 失败：${error.code || error.message}`, 'connect')); });
  });
}
function openPlain(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => { sock.destroy(); reject(new ImapError(`连接 ${host}:${port} 超时`, 'connect')); }, timeout);
    sock.once('connect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', (error) => { clearTimeout(timer); reject(new ImapError(`连接 ${host}:${port} 失败：${error.code || error.message}`, 'connect')); });
  });
}
function upgradeTls(plain, host, timeout) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ socket: plain, servername: host });
    const timer = setTimeout(() => { sock.destroy(); reject(new ImapError('STARTTLS 握手超时', 'starttls')); }, timeout);
    sock.once('secureConnect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', (error) => { clearTimeout(timer); reject(new ImapError(`STARTTLS 失败：${error.message}`, 'starttls')); });
  });
}

/* IMAP 的 quoted string：反斜杠和双引号要转义 ✓（密码里可能有 ✗） */
function q(value) {
  return '"' + String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/* ── 文件夹名的 modified UTF-7（RFC 3501 §5.1.3）─────────────────────────
   ⚠️ IMAP 的文件夹名**不是 UTF-8** ✗ —— 非 ASCII 字符要编成
      `&` + base64(UTF-16BE) + `-`，`&` 本身写成 `&-` ✗。
      不转的话「已发送」「垃圾邮件」这类中文文件夹名选不出来 ✗，
      更坑的是**不报错** ✗ —— 服务器只会回一个空/错的邮箱 ✗。 */
function decodeModifiedUtf7(value) {
  return String(value == null ? '' : value).replace(/&([^-]*)-/g, (whole, b64) => {
    if (!b64) return '&';
    try {
      const buf = Buffer.from(b64.replace(/,/g, '/'), 'base64');
      let out = '';
      for (let i = 0; i + 1 < buf.length; i += 2) out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
      return out;
    } catch (_) { return whole; }
  });
}

function encodeModifiedUtf7(value) {
  const s = String(value == null ? '' : value);
  let out = '';
  let pending = '';
  const flush = () => {
    if (!pending) return;
    const buf = Buffer.alloc(pending.length * 2);
    for (let i = 0; i < pending.length; i++) buf.writeUInt16BE(pending.charCodeAt(i), i * 2);
    out += '&' + buf.toString('base64').replace(/\//g, ',').replace(/=+$/, '') + '-';
    pending = '';
  };
  for (const ch of s) {
    if (ch === '&') { flush(); out += '&-'; }
    else if (ch >= '\u0020' && ch <= '\u007e') { flush(); out += ch; }
    else pending += ch;
  }
  flush();
  return out;
}

/* ── 会话 ──────────────────────────────────────────────────────────────── */
class ImapSession {
  constructor(sock, timeout) {
    this.sock = sock;
    this.reader = makeReader(sock);
    this.timeout = timeout;
    this.seq = 0;
    this.steps = [];
    this.capability = [];
  }

  static async connect(account, options) {
    const timeout = (options && options.timeout) || DEFAULT_TIMEOUT;
    const host = String(account.imapHost || '').trim();
    const port = Number(account.imapPort || 993);
    if (!host) throw new ImapError('没有填 IMAP 服务器', 'config');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ImapError('IMAP 端口不合法', 'config');

    let sock, upgraded = false;
    if (port === 993 || port === 995) {
      sock = await openTls(host, port, timeout);
    } else {
      const plain = await openPlain(host, port, timeout);
      /* ⚠️ reader 只能建**一次** ✗ —— 每建一次都会往 socket 上挂一组 data/error 监听，
         建两次的话同一批数据会被两个 reader 各自消费一遍，响应直接错乱 ✗（自己踩过）。 */
      const reader = makeReader(plain);
      const greet = await nextUnit(reader, Date.now() + timeout).catch(() => null);
      if (!greet || greet.type !== 'line' || !/^\*\s+(OK|PREAUTH)/i.test(greet.text)) {
        plain.destroy();
        throw new ImapError(`${host}:${port} 不是 IMAP 服务（问候异常）`, 'greeting', greet ? greet.text : '');
      }
      plain.write('a0 STARTTLS\r\n');
      const t = await nextUnit(reader, Date.now() + timeout).catch(() => null);
      if (!t || !/^a0\s+OK/i.test(t.text || '')) {
        plain.destroy();
        throw new ImapError(`${host}:${port} 不支持 STARTTLS，也没有用 993 —— 换 993 试试`, 'starttls', t ? t.text : '');
      }
      /* 升级后 reader 里可能还残留升级前多读到的字节 —— 清掉 ✓（TLS 握手前的都是明文协议垃圾）*/
      reader.buf = Buffer.alloc(0);
      sock = await upgradeTls(plain, host, timeout);
      upgraded = true;
    }

    const session = new ImapSession(sock, timeout);
    const greeting = await nextUnit(session.reader, Date.now() + timeout);
    if (greeting.type !== 'line' || !/^\*\s+(OK|PREAUTH)/i.test(greeting.text)) {
      sock.destroy();
      throw new ImapError(`服务器问候异常：${greeting.text || ''}`, 'greeting');
    }
    /* 问候里常带 CAPABILITY（如 `* OK [CAPABILITY ...]`）—— 先记下来省一次往返 ✓ */
    const cap = /\[CAPABILITY\s+([^\]]+)\]/i.exec(greeting.text);
    if (cap) session.capability = cap[1].trim().split(/\s+/);
    session.steps.push(`IMAP 已连接 ${host}:${port}${upgraded ? '（STARTTLS）' : '（TLS）'}`);
    return session;
  }

  /* 发一条命令，读到带这个 tag 的 OK/NO/BAD 为止 ✓ */
  async command(text, options) {
    const tag = 'a' + (++this.seq);
    const timeout = (options && options.timeout) || this.timeout;
    const deadline = Date.now() + timeout;
    this.sock.write(tag + ' ' + text + '\r\n');
    const units = [];
    const re = new RegExp('^' + tag + '\\s+(OK|NO|BAD)\\b', 'i');
    while (true) {
      const unit = await nextUnit(this.reader, deadline);
      units.push(unit);
      if (unit.type === 'line' && re.test(unit.text)) {
        const status = re.exec(unit.text)[1].toUpperCase();
        const result = { status, text: unit.text, units, tag };
        if (status !== 'OK' && !(options && options.allowFail)) {
          throw new ImapError(`IMAP ${text.split(' ')[0]} 失败：${unit.text}`, 'command', unit.text);
        }
        return result;
      }
    }
  }

  lines(units) { return units.filter((u) => u.type === 'line').map((u) => u.text); }

  /* ⚠️ 方法名不能叫 `capability` ✗ —— 实例上已经有 `this.capability`（字符串数组）✓，
     同名的原型方法会被**实例属性遮蔽** ✗，调用时报 `s.capability is not a function` ✗（踩过）。 */
  async fetchCapability() {
    const res = await this.command('CAPABILITY');
    const cap = /^\*\s+CAPABILITY\s+(.+)$/im.exec(res.text);
    if (cap) this.capability = cap[1].trim().split(/\s+/);
    else {
      const any = this.lines(res.units).find((l) => /^\*\s+CAPABILITY/i.test(l));
      if (any) this.capability = any.replace(/^\*\s+CAPABILITY\s+/i, '').trim().split(/\s+/);
    }
    return this.capability;
  }

  async login(user, pass) {
    const u = String(user || '').trim();
    const p = String(pass || '');
    if (!u) throw new ImapError('没有填邮箱账号', 'config');
    if (!p) throw new ImapError('没有填授权码 / 密码', 'config');
    /* ⚠️ 返回的必须是**本次新增**的步骤 ✗ —— `this.steps` 里已经有「已连接」了，
       直接 `return this.steps` 会让调用方再 push 一遍 → 步骤里「已连接」出现两次 ✗
       （实测：接口返回的 steps 里同一句出现两遍）。 */
    const from = this.steps.length;
    const res = await this.command('LOGIN ' + q(u) + ' ' + q(p), { allowFail: true });
    if (res.status !== 'OK') {
      const hint = /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|auth/i.test(res.text)
        ? '（授权码/密码不对：QQ/网易要用「授权码」，Gmail 要用「应用专用密码」，不能用登录密码；另外要确认邮箱设置里已开启 IMAP 服务）'
        : '';
      throw new ImapError(`登录失败：${res.text}${hint}`, 'auth', res.text);
    }
    this.steps.push('已登录');
    /* ⚠️ 163 / QQ 这类服务器**要求客户端先报身份**（ID 命令）✗，
       不发的话后续命令会被拒（163 会直接 `Unsafe Login` ✗）。 */
    if (this.capability.some((c) => /^ID$/i.test(c))) {
      try {
        await this.command('ID ("name" "CodeScope" "version" "3.0" "vendor" "codescope" "support" "local")', { allowFail: true, timeout: 8000 });
        this.steps.push('已发送客户端标识（ID）');
      } catch (_) { }
    }
    return this.steps.slice(from);
  }

  async select(box) {
    const res = await this.command('SELECT ' + q(encodeModifiedUtf7(box || 'INBOX')));
    const text = this.lines(res.units).join('\n');
    const exists = Number((/^\*\s+(\d+)\s+EXISTS/im.exec(text) || [])[1] || 0);
    const recent = Number((/^\*\s+(\d+)\s+RECENT/im.exec(text) || [])[1] || 0);
    const uidNext = Number((/\[UIDNEXT\s+(\d+)\]/i.exec(text) || [])[1] || 0);
    return { exists, recent, uidNext, readOnly: /\[READ-ONLY\]/i.test(text) };
  }

  /* ★ 未读**数量**要用 STATUS，不能用 SELECT 的 `[UNSEEN n]` ✗ ——
     后者是「第一封未读邮件的序号」✗，不是条数 ✗（很容易看错）。
     而且 STATUS 不需要 SELECT，没有副作用、也更快 ✓。 */
  async status(box) {
    const res = await this.command('STATUS ' + q(encodeModifiedUtf7(box || 'INBOX')) + ' (MESSAGES UNSEEN UIDNEXT)');
    const text = this.lines(res.units).join('\n');
    const m = /^\*\s+STATUS\s+[^\s(]+\s+\(([^)]*)\)/im.exec(text);
    const out = { messages: 0, unseen: 0, uidNext: 0 };
    if (m) {
      const pairs = m[1].match(/(MESSAGES|UNSEEN|UIDNEXT)\s+(\d+)/gi) || [];
      for (const pair of pairs) {
        const [k, v] = pair.split(/\s+/);
        const key = k.toUpperCase();
        if (key === 'MESSAGES') out.messages = Number(v);
        else if (key === 'UNSEEN') out.unseen = Number(v);
        else if (key === 'UIDNEXT') out.uidNext = Number(v);
      }
    }
    return out;
  }

  /* 返回 UID 数组 ✓（UID SEARCH，不是序号 SEARCH ✓ —— 序号会随删除变动 ✗） */
  async search(criteria, box) {
    if (box) await this.select(box);
    const res = await this.command('UID SEARCH ' + (criteria || 'ALL'));
    const line = this.lines(res.units).find((l) => /^\*\s+SEARCH\b/i.test(l));
    if (!line) return [];
    return line.replace(/^\*\s+SEARCH\s*/i, '').trim().split(/\s+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  }

  /* ── 解析 FETCH 响应 ────────────────────────────────────────────────
     ⚠️ **不能假设「元数据在一行、字面量在下一行」** ✗ ——
       服务器实际发的是**同一行**：
         `* 1 FETCH (UID 1559 FLAGS (\Seen) RFC822.SIZE 44459 BODY[...] {52}` ← 以 {n} 结尾
         `<52 字节的头部>`
         `)`
       而我的读取器把「以 {n} 结尾的那一行」和它的字面量**打包成一个 unit** ✓
       （`unit.type === 'literal'` 时 `unit.line` 才是那行元数据 ✗ 不是 `unit.text`）。
       以前只在 `type === 'line'` 的分支里解析元数据 ✗ → 单封 FETCH 时一条都解析不出来 ✗
       （实测：`fetchHeaders([1559])` 返回 `[]`）。
       现在**按序号（seq）用 Map 合并** ✓：元数据可能在行上、也可能在字面量那一行上，
       两种排布都认得 ✓，而且不会因为两处都出现而重复计数 ✓。 */
  fetchMeta(units) {
    const bySeq = new Map();
    const absorb = (text) => {
      const m = /^\*\s+(\d+)\s+FETCH\s+\(/i.exec(text);
      if (!m) return null;
      const seq = Number(m[1]);
      let entry = bySeq.get(seq);
      if (!entry) {
        /* `literal` = 这条 FETCH 附带的**字面量字节** ✓
           （取头部时是头部原文，取全文时是整封 RFC822 ✓ —— 同一套解析，调用方自己解释 ✓）*/
        entry = { seq, uid: 0, flags: [], size: 0, literal: Buffer.alloc(0) };
        bySeq.set(seq, entry);
      }
      const uid = /\bUID\s+(\d+)/i.exec(text); if (uid) entry.uid = Number(uid[1]);
      const size = /\bRFC822\.SIZE\s+(\d+)/i.exec(text); if (size) entry.size = Number(size[1]);
      const flags = /\bFLAGS\s+\(([^)]*)\)/i.exec(text);
      if (flags) entry.flags = flags[1].trim().split(/\s+/).filter(Boolean);
      return entry;
    };
    for (const unit of units) {
      if (unit.type === 'literal') {
        const entry = absorb(unit.line);
        if (entry) entry.literal = Buffer.concat([entry.literal, unit.data]);
      } else {
        absorb(unit.text);
      }
    }
    return [...bySeq.values()];
  }

  /* 取一批邮件的**头部**（BODY.PEEK 不会把邮件标记成已读 ✓）*/
  async fetchHeaders(uids, fields) {
    if (!uids.length) return [];
    const list = (fields && fields.length ? fields : ['FROM', 'TO', 'SUBJECT', 'DATE', 'MESSAGE-ID']);
    const set = uids.join(',');
    const res = await this.command(`UID FETCH ${set} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (${list.join(' ')})])`, { timeout: this.timeout * 2 });
    return this.fetchMeta(res.units).map((e) => ({
      seq: e.seq, uid: e.uid, flags: e.flags, size: e.size, headerRaw: e.literal,
    }));
  }

  /* 取一整封（含正文）—— 用 PEEK，是否标记已读由调用方显式决定 ✓ */
  async fetchFull(uid) {
    const res = await this.command(`UID FETCH ${Number(uid)} (UID FLAGS BODY.PEEK[])`, { timeout: this.timeout * 2 });
    const entries = this.fetchMeta(res.units);
    const hit = entries.find((e) => e.uid === Number(uid)) || entries[0] || null;
    return { raw: hit ? hit.literal : Buffer.alloc(0), flags: hit ? hit.flags : [] };
  }

  /* 列文件夹 ✓
     `* LIST (\HasNoChildren) "/" "INBOX"` —— 属性里 \Noselect 的是纯容器（不能 SELECT ✗）*/
  async listBoxes() {
    const res = await this.command('LIST "" "*"');
    const out = [];
    for (const line of this.lines(res.units)) {
      const m = /^\*\s+LIST\s+\(([^)]*)\)\s+("([^"]*)"|NIL)\s+(.+)$/i.exec(line);
      if (!m) continue;
      const attrs = m[1].trim().split(/\s+/).filter(Boolean);
      let name = m[4].trim();
      /* 名字可能是 quoted 或 literal ✓（QQ 的中文文件夹名会走 literal ✗ 这里兜一下）*/
      if (/^".*"$/.test(name)) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
      else if (/^\{/.test(name)) continue;
      if (!name) continue;
      out.push({
        name: decodeModifiedUtf7(name),
        selectable: !attrs.some((a) => /\\Noselect/i.test(a)),
        hasChildren: attrs.some((a) => /\\HasChildren/i.test(a)),
      });
    }
    return out;
  }

  /* 改标记：action = 'add' | 'remove'，flags 如 ['\\Seen'] ✓ */
  async store(uid, action, flags) {
    const op = action === 'remove' ? '-FLAGS' : '+FLAGS';
    return this.command(`UID STORE ${Number(uid)} ${op} (${flags.join(' ')})`);
  }

  /* 删除：先打 \Deleted，再 EXPUNGE ✓（有些服务器要 SELECT 后才能 EXPUNGE ✓）*/
  async remove(uid) {
    await this.store(uid, 'add', ['\\Deleted']);
    try { await this.command('EXPUNGE', { allowFail: true }); } catch (_) { }
    return true;
  }

  async logout() {
    try { await this.command('LOGOUT', { timeout: 5000, allowFail: true }); } catch (_) { }
    this.close();
  }

  close() {
    try { this.sock.destroy(); } catch (_) { }
  }

  /* 会话还活着吗？✓ —— 连接池要靠它决定「复用还是重连」
     （reader 在 socket 收到 end/close/error 时会置 closed ✓）*/
  get alive() {
    try { return !this.reader.closed && !this.sock.destroyed; } catch (_) { return false; }
  }
}

/* ══ 连接池 ══════════════════════════════════════════════════════════════
   ★★ 为什么要池子：每条请求都 `TLS 握手 + LOGIN` 要 **1~3 秒** ✗，
      而切个文件夹、点封邮件都要发请求 —— 用户感觉到的「点击很卡」就是它 ✓。
      复用一条会话后，同样的操作只要 **100~300ms** ✓（少两次往返 + 省掉握手）。
   ★ 两条硬约束：
     ① **同一账号不能并发共用一条会话** ✗ —— IMAP 是单命令流，
        两条命令交叉发出去，响应会互相错位（而且**不报错**，数据会串）✗✗。
        所以每个账号配一个**串行队列** ✓，请求排队、独占会话。
     ② 池子里的会话可能被服务器单方面关掉（QQ 有空闲超时）✗ ——
        所以①复用失败时**丢弃 + 重连 + 重试一次** ✓，②空闲一段时间主动登出回收 ✓。 */
const POOL = new Map();            /* poolKey -> { session, idleTimer } */
const QUEUE = new Map();           /* poolKey -> Promise（串行队列的队尾）*/
const POOL_IDLE_MS = 45000;
const POOL_MAX = 6;

function poolKeyOf(account) {
  return [String(account.imapHost || ''), String(account.imapPort || ''), String(account.user || '')].join('|');
}

function dropPooled(key) {
  const entry = POOL.get(key);
  if (!entry) return;
  POOL.delete(key);
  clearTimeout(entry.idleTimer);
  try { entry.session.close(); } catch (_) { }
}

function putPooled(key, session) {
  const old = POOL.get(key);
  if (old && old.session !== session) { clearTimeout(old.idleTimer); try { old.session.close(); } catch (_) { } }
  const entry = { session, idleTimer: 0 };
  entry.idleTimer = setTimeout(() => {
    const cur = POOL.get(key);
    if (cur && cur.session === session) { POOL.delete(key); try { session.logout(); } catch (_) { } }
  }, POOL_IDLE_MS);
  if (entry.idleTimer.unref) entry.idleTimer.unref();
  POOL.set(key, entry);
  if (POOL.size > POOL_MAX) {
    const first = POOL.keys().next().value;
    if (first !== key) dropPooled(first);
  }
}

async function openFresh(account, timeout) {
  const session = await ImapSession.connect(account, { timeout });
  const steps = session.steps.slice();
  await session.fetchCapability();
  steps.push(...(await session.login(account.user, account.pass)));
  return { session, steps };
}

/* 一把梭：连上（或复用）→ 干活 → 归还 ✓
   `fn(session)` 里做具体的事 ✓；异常统一转成 `{ ok:false, error }` ✓ */
async function withSession(account, fn, options) {
  const timeout = (options && options.timeout) || DEFAULT_TIMEOUT;
  const key = poolKeyOf(account);
  /* ① 排队：同一账号串行 ✓ */
  const prev = QUEUE.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  QUEUE.set(key, prev.then(() => gate));
  try { await prev; } catch (_) { }

  const steps = [];
  let session = null;
  let reused = false;
  try {
    const entry = POOL.get(key);
    if (entry && entry.session && entry.session.alive) {
      session = entry.session;
      reused = true;
      steps.push('复用已有连接（省掉握手与登录）');
    } else {
      dropPooled(key);
      const fresh = await openFresh(account, timeout);
      session = fresh.session; steps.push(...fresh.steps);
    }

    let result;
    try {
      result = await fn(session, steps);
    } catch (error) {
      /* ② 复用的会话坏了（服务器单方面关掉 / 空闲超时）→ 换一条**重试一次** ✓ */
      if (!reused) throw error;
      dropPooled(key);
      steps.push('旧连接已失效，重连重试');
      const fresh = await openFresh(account, timeout);
      session = fresh.session; steps.push(...fresh.steps);
      result = await fn(session, steps);
    }

    if (session.alive) putPooled(key, session); else dropPooled(key);
    return Object.assign({ ok: true, steps, reused }, result || {});
  } catch (error) {
    dropPooled(key);
    return { ok: false, steps, error: error.message, step: error.step || '', response: error.response || '', reused };
  } finally {
    release();
    if (QUEUE.get(key) === gate) QUEUE.delete(key);   /* 队尾自己清掉，别攒内存 ✓ */
  }
}

module.exports = { ImapSession, ImapError, withSession, decodeModifiedUtf7, encodeModifiedUtf7, DEFAULT_TIMEOUT, POOL_SIZE: () => POOL.size };
