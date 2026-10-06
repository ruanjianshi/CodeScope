'use strict';

/* ── 极简 MIME 解码（只依赖 Node 内置能力，零第三方依赖）────────────────────
   为什么要自己写：收信要把「服务器原样吐出来的 RFC822 字节」变成人能看的东西 ✗，
   这一步全是标准里的细活（RFC 2045/2046/2047/5322）：
     · RFC 2047 编码词（`=?GBK?B?xxxx?=`）—— 中文主题/发件人全在这里
     · Content-Transfer-Encoding：base64 / quoted-printable
     · multipart/* 递归 + boundary 切分
     · charset：GBK / GB18030 / BIG5 都要认（国内邮件大量是 GBK ✗ 不是 UTF-8）
   Node 22 自带完整 ICU ✓，所以 `new TextDecoder('gbk')` 可用 ✓（实测已确认）。

   对外只有两个函数：`decodeHeader()` 和 `parseMessage()` ✓ */

/* ── charset 名字归一 + 解码 ──────────────────────────────────────────────
   ⚠️ 邮件里的 charset 名五花八门 ✗：`gb2312` / `GB_2312` / `"gbk"`（带引号）/
      `ks_c_5601-1987` / `us-ascii` / `ansi_x3.4-1968` …
   别名不归一的话 TextDecoder 会抛错 → 整封信变乱码 ✗（这是最容易被忽略的一环）。 */
const CHARSET_ALIAS = {
  'gb2312': 'gbk', 'gb_2312': 'gbk', 'gb_2312-80': 'gbk', 'csgb2312': 'gbk',
  'chinese': 'gbk', 'x-gbk': 'gbk', 'gbk': 'gbk',
  'gb18030': 'gb18030',
  'utf8': 'utf-8', 'utf-8': 'utf-8',
  'us-ascii': 'utf-8', 'ascii': 'utf-8', 'ansi_x3.4-1968': 'windows-1252',
  'iso-8859-1': 'windows-1252', 'latin1': 'windows-1252', 'latin-1': 'windows-1252',
  'ks_c_5601-1987': 'euc-kr', 'ksc5601': 'euc-kr',
  'big5': 'big5', 'big-5': 'big5', 'cp950': 'big5',
  'shift_jis': 'shift_jis', 'shift-jis': 'shift_jis', 'sjis': 'shift_jis',
  'iso-2022-jp': 'iso-2022-jp',
};

function decodeCharset(buf, charset) {
  if (!buf || !buf.length) return '';
  const raw = String(charset || 'utf-8').trim().toLowerCase().replace(/^["']|["']$/g, '');
  const name = CHARSET_ALIAS[raw] || raw;
  /* 先按声明的 charset 解 ✓；解不了再退 utf-8 ✓；再不行 latin1（至少不抛错 ✓） */
  try { return new TextDecoder(name).decode(buf); } catch (_) { }
  try { return new TextDecoder('utf-8').decode(buf); } catch (_) { }
  return buf.toString('latin1');
}

/* ── quoted-printable ────────────────────────────────────────────────────
   `=XX` 是字节转义；行尾 `=` 是「软换行」（要删掉，不产生换行 ✓）。
   ⚠️ 必须是**字节级**处理 ✗ —— 先按字符串解会把多字节字符切坏 ✗（中文必踩）。 */
function decodeQuotedPrintable(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c !== 0x3d) { out.push(c); continue; }
    const n1 = buf[i + 1], n2 = buf[i + 2];
    if (n1 === 0x0d && n2 === 0x0a) { i += 2; continue; }   /* 软换行 CRLF */
    if (n1 === 0x0a) { i += 1; continue; }                   /* 软换行 LF */
    const hex = String.fromCharCode(n1, n2);
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; continue; }
    out.push(c);                                            /* 孤立的 = 原样保留 ✓ */
  }
  return Buffer.from(out);
}

function decodeTransferEncoding(buf, encoding) {
  const enc = String(encoding || '').trim().toLowerCase();
  if (enc === 'base64') {
    /* base64 正文里可能夹换行/空白 → 先清掉再解 ✓，否则 Buffer 会截断 ✗ */
    const clean = buf.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, '');
    try { return Buffer.from(clean, 'base64'); } catch (_) { return buf; }
  }
  if (enc === 'quoted-printable') return decodeQuotedPrintable(buf);
  return buf;                                                /* 7bit / 8bit / binary 原样 ✓ */
}

/* ── RFC 2047 编码词解码 ─────────────────────────────────────────────────
   `=?charset?B?base64?=` 或 `=?charset?Q?quoted?=`（Q 里 `_` 代表空格 ✓）。
   ⚠️ 两个相邻编码词之间的空白要**删掉** ✗（那是折行用的，不是内容 ✗），
      不删的话主题里会多出空格 ✗。先合并再解码。 */
function decodeHeader(value) {
  const s = String(value == null ? '' : value);
  /* 折行（\r\n + 空白）先摊平成一个空格 ✓ */
  const unfolded = s.replace(/\r?\n[ \t]+/g, ' ');
  /* 相邻编码词之间的空白删掉 ✓ */
  const merged = unfolded.replace(/(\?=)[ \t]+(=\?)/g, '$1$2');
  return merged.replace(/=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, enc, text) => {
    try {
      if (enc.toUpperCase() === 'B') {
        return decodeCharset(Buffer.from(text.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'), charset);
      }
      const bytes = Buffer.from(text.replace(/_/g, ' '), 'latin1');
      return decodeCharset(decodeQuotedPrintable(bytes), charset);
    } catch (_) { return whole; }
  });
}

/* ── 头部解析：折行（continuation）要并到上一行 ✓ ──────────────────────── */
function parseHeaders(headBuf) {
  const text = headBuf.toString('utf8');
  const out = {};
  let key = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(rawLine) && key) { out[key] += ' ' + rawLine.trim(); continue; }
    const idx = rawLine.indexOf(':');
    if (idx < 0) continue;
    key = rawLine.slice(0, idx).trim().toLowerCase();
    out[key] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

/* 在 Buffer 上找「头 / 体」的分界 ✓（不能先转字符串 ✗ —— 体会被破坏 ✗） */
function splitHeadBody(buf) {
  const crlf = buf.indexOf('\r\n\r\n');
  if (crlf >= 0) return { head: buf.slice(0, crlf), body: buf.slice(crlf + 4) };
  const lf = buf.indexOf('\n\n');
  if (lf >= 0) return { head: buf.slice(0, lf), body: buf.slice(lf + 2) };
  return { head: buf, body: Buffer.alloc(0) };
}

function parseContentType(value) {
  const s = String(value || '');
  const semi = s.indexOf(';');
  const type = (semi < 0 ? s : s.slice(0, semi)).trim().toLowerCase() || 'text/plain';
  const params = {};
  if (semi >= 0) {
    s.slice(semi + 1).replace(/([^=;\s]+)\s*=\s*("([^"]*)"|[^;]*)/g, (m, k, v, quoted) => {
      params[k.trim().toLowerCase()] = (quoted == null ? v : quoted).trim();
      return '';
    });
  }
  return { type, params };
}

/* 从 Content-Disposition / Content-Type 里取文件名（RFC 2231 的 `name*=` 也兜一下 ✓）*/
function pickFilename(headers, ctParams) {
  const cd = parseContentType(headers['content-disposition']);
  const candidates = [
    cd.params['filename*'], ctParams['name*'],
    cd.params.filename, ctParams.name,
  ];
  for (const c of candidates) {
    if (!c) continue;
    /* RFC 2231: `utf-8''%E6%8A%A5%E5%91%8A.pdf` → 先摘 charset，再解百分号 ✓
       ⚠️ **不能** `Buffer.from(decodeURIComponent(x), 'latin1')` ✗ ——
          `decodeURIComponent` 返回的是 JS 字符串，再按 latin1 转回字节时
          **每个字符只留低 8 位** ✗ → 中文文件名直接变成 `?J.pdf` 这种乱码 ✗（实测踩过）。
          正确做法：把 `%XX` 当**字节**直接收集进 Buffer，再按声明的 charset 解码 ✓。 */
    const m = /^([\w-]+)'([\w-]*)'(.*)$/.exec(c);
    if (m) {
      const bytes = [];
      const enc = m[3];
      for (let i = 0; i < enc.length; i++) {
        if (enc[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(enc.slice(i + 1, i + 3))) {
          bytes.push(parseInt(enc.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          bytes.push(enc.charCodeAt(i) & 0xff);
        }
      }
      const name = decodeCharset(Buffer.from(bytes), m[1]);
      if (name) return name;
    }
    const decoded = decodeHeader(c);
    if (decoded) return decoded;
  }
  return '';
}

/* ── multipart 切分 ──────────────────────────────────────────────────────
   格式：preamble `--boundary\r\n` part `\r\n--boundary\r\n` part `\r\n--boundary--`
   ⚠️ 每一段尾部那个 CRLF 是**分隔符的一部分** ✗，不属于内容 ✗ —— 不剪掉的话
      正文末尾会多一个空行、base64 尾部会多两个字符 ✗。 */
function splitMultipart(body, boundary) {
  const delim = Buffer.from('--' + boundary);
  const parts = [];
  let pos = body.indexOf(delim);
  if (pos < 0) return parts;
  pos += delim.length;
  while (pos < body.length) {
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;   /* `--` 收尾 */
    const nl = body.indexOf(0x0a, pos);
    if (nl < 0) break;
    const start = nl + 1;
    const next = body.indexOf(delim, start);
    if (next < 0) { parts.push(body.slice(start)); break; }
    let end = next;
    if (end >= 2 && body[end - 2] === 0x0d && body[end - 1] === 0x0a) end -= 2;
    else if (end >= 1 && body[end - 1] === 0x0a) end -= 1;
    parts.push(body.slice(start, end));
    pos = next + delim.length;
  }
  return parts;
}

/* ── 递归收集所有叶子部分 ──────────────────────────────────────────────── */
function collectParts(buf, out, depth) {
  if (depth > 20) return;                                     /* 防畸形邮件递归爆栈 ✓ */
  const { head, body } = splitHeadBody(buf);
  const headers = parseHeaders(head);
  const ct = parseContentType(headers['content-type']);
  const cte = headers['content-transfer-encoding'];
  if (ct.type.startsWith('multipart/')) {
    const boundary = ct.params.boundary;
    if (!boundary) return;
    for (const child of splitMultipart(body, boundary)) collectParts(child, out, depth + 1);
    return;
  }
  const cd = parseContentType(headers['content-disposition']);
  out.push({
    headers,
    type: ct.type,
    charset: ct.params.charset || '',
    disposition: cd.type || '',
    filename: pickFilename(headers, ct.params),
    cid: String(headers['content-id'] || '').replace(/^<|>$/g, ''),
    data: decodeTransferEncoding(body, cte),
  });
}

/* ── 对外：把一整封 RFC822 变成结构化对象 ──────────────────────────────── */
function parseMessage(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
  const parts = [];
  collectParts(buf, parts, 0);

  const headBuf = splitHeadBody(buf).head;
  const top = parseHeaders(headBuf);

  const textParts = parts.filter((p) => p.type === 'text/plain' && !isAttachment(p));
  const htmlParts = parts.filter((p) => p.type === 'text/html' && !isAttachment(p));

  /* 优先 HTML ✓（保留排版）；没有就退纯文本 ✓。两个都留一份，前端可以切换 ✓ */
  const html = htmlParts.length ? decodeCharset(htmlParts[0].data, htmlParts[0].charset) : '';
  const text = textParts.length ? decodeCharset(textParts[0].data, textParts[0].charset) : '';
  const fallback = (!html && !text && parts.length === 1) ? decodeCharset(parts[0].data, parts[0].charset) : '';

  const attachments = parts.filter(isAttachment).map((p, i) => ({
    index: parts.indexOf(p),
    n: i,
    name: p.filename || ('附件-' + (i + 1)),
    type: p.type,
    size: p.data.length,
  }));

  return {
    subject: decodeHeader(top.subject) || '(无主题)',
    from: decodeHeader(top.from),
    to: decodeHeader(top.to),
    cc: decodeHeader(top.cc),
    date: parseDate(top.date),
    messageId: String(top['message-id'] || '').trim(),
    text: text || (html ? '' : fallback),
    html,
    attachments,
    /* 给附件下载用的原始叶子部分索引 → 与 parseMessage 的 parts 顺序一致 ✓
       `cid` 也要带上 ✓ —— 正文里 `cid:xxx` 引用的内嵌图片要靠它配对 ✓ */
    parts: parts.map((p, i) => ({
      index: i, type: p.type, filename: p.filename, size: p.data.length, data: p.data,
      cid: p.cid, disposition: p.disposition,
    })),
  };
}

/* 判断一个叶子部分算不算「附件」✓
   ⚠️ 只看「有没有 filename」是不够的 ✗ ——
      `multipart/related` 里的内嵌图片（正文用 `cid:` 引用）也带 name= ✗，
      照这个判会把签名图、邮件里的插图全列成附件 ✗（实测踩过）。
   判定顺序（从严到宽）：
     ① 明确 `Content-Disposition: attachment` → 附件 ✓
     ② 有 Content-ID → 是被正文 cid: 引用的内嵌资源，不是附件 ✓
     ③ text/plain · text/html · multipart/* → 正文/容器，不是附件 ✓
     ④ 其余：有 filename 或不是 text/* → 附件 ✓ */
function isAttachment(p) {
  if (p.disposition === 'attachment') return true;
  if (p.cid) return false;
  if (p.type === 'text/plain' || p.type === 'text/html') return false;
  if (p.type.startsWith('multipart/')) return false;
  if (p.disposition === 'inline' && !p.filename) return false;
  return !!p.filename || !p.type.startsWith('text/');
}

function parseDate(value) {
  const s = String(value || '').trim();
  if (!s) return 0;
  /* 去掉注释尾巴 `(CST)` 之类 ✓，Date 解析器对它们不稳 */
  const cleaned = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const t = Date.parse(cleaned);
  return Number.isFinite(t) ? t : 0;
}

/* 从 `名字 <a@b.c>` 里摘出邮箱和显示名 ✓（收件箱列表要显示名 ✓） */
function parseAddress(value) {
  const s = String(value || '').trim();
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1].replace(/^["']|["']$/g, '').trim(), address: m[2].trim() };
  return { name: '', address: s };
}

module.exports = {
  decodeHeader,
  decodeCharset,
  decodeTransferEncoding,
  decodeQuotedPrintable,
  parseHeaders,
  parseContentType,
  parseMessage,
  parseAddress,
  splitMultipart,
  splitHeadBody,
};
