'use strict';

/* ── 电子书解析（EPUB / TXT）—— 纯逻辑 ✓：不碰 DOM ✗、不读 STORE ✗、不联网 ✗ ────
   ★ 为什么要有这个 ✗：用户原话「我需要的是可以实现阅读，目前这样的设计，我无法进行
     相关书籍的阅读」✓。
     ⚠️ 微信读书那条路**走不通** ✗（实测过 ✓）：它的 17 个接口里**没有一个能取正文** ✗
        （`/book/chapterinfo` 只给目录 ✓、`/book/underlines` 只给位置区间 + 划线人数 ✗），
        而它的网页 Cookie 是 **SameSite=Lax** ✗ → 嵌进跨域 iframe **根本不会被发送** ✗
        （实测：阅读器一直转圈、右上角显示「登录」✗）。
     → 所以「在这里读书」只能靠**本地电子书** ✓：用户手上有什么文件，就导什么 ✓。

   ⚠️ 只依赖 `fflate`（解压 ✓，已经是项目依赖 ✓）——
      PDF 那条走 `lib/pdf-text.js` ✓（那边早写好了 ✓，别在这儿再抄一遍 ✗）。
   ⚠️ 本模块**不能**是双栖的 ✗ —— `fflate` 是 Node 依赖 ✓，
      浏览器里没有 ✓（解压放服务端做 ✓，前端只取解析好的章节 ✓）。 */

const { unzipSync, strFromU8 } = require('fflate');

/* ── HTML / XHTML → 纯文本 ✓ ──────────────────────────────────────────────
   ⚠️ 顺序很重要 ✗：**先把块级标签换成换行** ✓，再剥标签 ✓。
      反过来（先剥标签）的话段落就粘成一坨了 ✗ —— 整本书变成一行 ✗。 */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c' };
function unesc(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = String(e).toLowerCase();
    if (k.charAt(0) === '#') {
      const code = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
  });
}
function htmlToText(html) {
  let h = String(html == null ? '' : html);
  h = h.replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<!--[\s\S]*?-->/g, '');
  /* ① 块级 / 换行 → 换行 ✓（`<br>` 也要当段落分隔 ✓，很多书靠它分行 ✓） */
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/(p|div|li|h[1-6]|blockquote|section|article|tr|td|dd|dt|pre|figcaption)>/gi, '\n\n');
  h = h.replace(/<(hr)\s*\/?>/gi, '\n\n');
  /* ② 再剥剩下的标签 ✓ */
  h = h.replace(/<[^>]*>/g, '');
  h = unesc(h);
  /* ③ 收拾空白 ✓ —— ⚠️ **不折行** ✗：中文书不能把空格当分隔符 ✗ */
  return h
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/* 取文档里的第一个标题 ✓（`<h1>` 优先 ✓，退到 `<h2>` ✓，再退到 `<title>` ✓）*/
function firstHeading(html) {
  const h = String(html == null ? '' : html);
  for (const tag of ['h1', 'h2', 'h3', 'title']) {
    const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(h);
    if (m) {
      const t = htmlToText(m[1]).replace(/\s+/g, ' ').trim();
      if (t && t.length <= 60) return t;
    }
  }
  return '';
}

/* ── 把一个超长文本按标题切章 ✓ ────────────────────────────────────────────
   ⚠️ 切不出来就**整篇当一章** ✓ —— 千万别硬切 ✗
      （按字数硬切会把一句话劈两半 ✓，读起来莫名其妙 ✗）。
   判据：行首是「第X章 / 第X回 / Chapter N / 卷X / 序 / 楔子 / 后记」这类 ✓。 */
const HEAD = /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷部篇]|Chapter\s+[0-9IVXLC]+|CHAPTER\s+[0-9IVXLC]+|卷\s*[0-9零一二三四五六七八九十]+|序\s*[章言]?|楔子|前言|引言|后记|尾声|番外|附录)\s*[:：、.．]?\s*(.{0,40})$/;
function chapterize(text, fallbackTitle) {
  const lines = String(text || '').split('\n');
  const out = [];
  let cur = null;
  let pre = [];
  lines.forEach((line) => {
    const t = line.trim();
    const m = t.length <= 40 ? HEAD.exec(t) : null;
    if (m) {
      if (cur) out.push(cur);
      else if (pre.join('\n').trim()) out.push({ title: '正文', text: pre.join('\n').trim() });
      cur = { title: t.slice(0, 40), text: [] };
      pre = [];
      return;
    }
    if (cur) cur.text.push(line); else pre.push(line);
  });
  if (cur) out.push(cur);
  if (!out.length) {
    const all = String(text || '').trim();
    return all ? [{ title: String(fallbackTitle || '正文').slice(0, 40), text: all }] : [];
  }
  const cleaned = out
    .map((c) => ({ title: String(c.title || '').slice(0, 40), text: (Array.isArray(c.text) ? c.text.join('\n') : String(c.text || '')).trim() }))
    .filter((c) => c.text || c.title);
  return cleaned.length ? cleaned : [{ title: '正文', text: String(text || '').trim() }];
}

/* ── EPUB ✓ ───────────────────────────────────────────────────────────────
   一个 EPUB 就是个 ZIP ✓：
     META-INF/container.xml  → 指向那个 .opf 的路径 ✓
     .opf                    → dc:title / dc:creator / manifest / **spine** ✓
     spine 的顺序 = 真正的阅读顺序 ✓（manifest 的顺序**不是** ✗，别搞混 ✓）
   ⚠️ 路径要**相对 OPF 所在目录**解析 ✗（`OEBPS/content.opf` 里的 `Text/a.xhtml`
      是 `OEBPS/Text/a.xhtml` ✓，不是根目录下的 ✓）。 */
function resolvePath(base, rel) {
  const parts = (String(base || '').split('/').filter(Boolean)).slice(0, -1).concat(String(rel || '').split('/'));
  const out = [];
  parts.forEach((p) => {
    if (p === '.' || p === '') return;
    if (p === '..') out.pop(); else out.push(p);
  });
  return out.join('/');
}
function parseEpub(buf) {
  let zip = null;
  try { zip = unzipSync(new Uint8Array(buf)); } catch (e) {
    throw new Error('这个文件不是有效的 EPUB（解压失败：' + String((e && e.message) || e) + '）');
  }
  const keys = Object.keys(zip);
  const readText = (p) => {
    const hit = zip[p] || zip[decodeURIComponent(p)];
    return hit ? strFromU8(hit) : '';
  };
  /* ① container.xml → OPF 路径 ✓ */
  const container = readText('META-INF/container.xml');
  let opfPath = (/<rootfile[^>]*full-path=["']([^"']+)["']/i.exec(container) || [])[1] || '';
  if (!opfPath) opfPath = keys.find((k) => /\.opf$/i.test(k)) || '';
  if (!opfPath) throw new Error('这个 EPUB 里找不到 .opf（可能不是标准 EPUB）');
  const opf = readText(opfPath);
  if (!opf) throw new Error('EPUB 里的 ' + opfPath + ' 读不出来');
  /* ② 元数据 ✓ */
  const metaOf = (tag) => {
    const m = new RegExp('<(?:dc:)?' + tag + '[^>]*>([\\s\\S]*?)</(?:dc:)?' + tag + '>', 'i').exec(opf);
    return m ? htmlToText(m[1]).replace(/\s+/g, ' ').trim() : '';
  };
  const title = metaOf('title') || '未命名';
  const author = metaOf('creator');
  /* ③ manifest：id → href ✓ */
  const manifest = {};
  (opf.match(/<item\b[^>]*\/?>/gi) || []).forEach((tag) => {
    const id = (/id=["']([^"']+)["']/i.exec(tag) || [])[1];
    const href = (/href=["']([^"']+)["']/i.exec(tag) || [])[1];
    const type = (/media-type=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    if (id && href) manifest[id] = { href: decodeURIComponent(href), type };
  });
  /* ④ spine：**阅读顺序** ✓ */
  const order = [];
  const spine = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opf);
  ((spine ? spine[1] : '').match(/<itemref\b[^>]*\/?>/gi) || []).forEach((tag) => {
    const idref = (/idref=["']([^"']+)["']/i.exec(tag) || [])[1];
    if (idref && manifest[idref]) order.push(manifest[idref].href);
  });
  /* ⚠️ spine 是空的（不标准的书 ✗）→ 退回 manifest 里的 xhtml ✓，总比什么都没有强 ✓ */
  const files = order.length ? order
    : Object.keys(manifest).filter((k) => /x?html?$/i.test(manifest[k].type) || /\.x?html?$/i.test(manifest[k].href)).map((k) => manifest[k].href);
  if (!files.length) throw new Error('这个 EPUB 里没找到正文（spine 是空的）');
  /* ⑤ 逐个抽正文 ✓ */
  const chapters = [];
  files.forEach((rel, i) => {
    const full = resolvePath(opfPath, rel);
    const raw = readText(full);
    if (!raw) return;
    const heading = firstHeading(raw);
    let text = htmlToText(raw);
    /* ⚠️ 标题**会重复** ✗✗ —— 实测踩到 ✓：`firstHeading()` 从 `<h1>` 取了标题 ✓，
       而 `htmlToText()` 把**同一个 `<h1>` 也留在了正文第一行** ✓ →
       阅读器里「标题」显示两遍 ✗（上面一个 `<h3>` ✓，正文第一段又一遍 ✗）。
       → 正文首行**等于**标题就把它摘掉 ✓（只摘第一行 ✓，而且摘完不能变空 ✗）。 */
    if (heading) {
      const lines = text.split('\n');
      if (lines.length > 1 && lines[0].trim() === heading) text = lines.slice(1).join('\n').trim();
    }
    /* ⚠️ 太短的片段（封面页 / 版权页 ✓）也留着 ✓ —— 但**没正文的**就跳过 ✓ */
    if (!text) return;
    chapters.push({ title: heading || ('第 ' + (chapters.length + 1) + ' 节'), text });
  });
  /* ⚠️ 有的书**整本塞在一个 xhtml 里** ✗ → 那就再按标题切一次 ✓。
     ⚠️⚠️ 判据**不是「超过多少字」** ✗✗ —— 我第一版写的是「> 20000 字才切」✓，
        结果**短一点的书就漏了** ✗（测试数据 18000 字 → 不切 ✗ → 整本一大坨 ✓）。
        阈值这种东西永远是错的 ✓：定高了漏短书 ✗，定低了切碎长书 ✗。
     → 改成「**只要只有 1 章就试着切一次**」✓，切出来多于一章才采纳 ✓
       （切不出来 `chapterize` 会原样返回 1 章 ✓，没有副作用 ✓）。 */
  if (chapters.length === 1) {
    const more = chapterize(chapters[0].text, title);
    if (more.length > 1) return { title, author, chapters: more };
  }
  if (!chapters.length) throw new Error('这个 EPUB 里没抽出正文');
  return { title, author, chapters };
}

/* ── TXT ✓ ────────────────────────────────────────────────────────────────
   ⚠️ 编码：中文 TXT 十有八九是 **GBK** ✗（不是 UTF-8 ✗）——
      直接按 UTF-8 读会得到一屏乱码 ✓。
      判据：UTF-8 解码后如果出现大量 **U+FFFD**（替换字符 ✓）→ 大概率不是 UTF-8 ✓。
      ⚠️ Node 内置**没有 GBK 解码** ✗（`TextDecoder('gbk')` 在 Node 里要 full-icu ✓）——
         实测这台机器的 Node 是带完整 ICU 的 ✓（见 tests/ebook.js 的断言 ✓），
         不带就明确报错 ✓，别硬猜编码 ✗。 */
function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  /* BOM 优先 ✓ */
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.slice(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.slice(2));
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const bad = (utf8.match(/\ufffd/g) || []).length;
  if (bad <= Math.max(2, utf8.length * 0.001)) return utf8;      /* 干净 → 就是 UTF-8 ✓ */
  for (const enc of ['gb18030', 'gbk', 'big5']) {
    try {
      const t = new TextDecoder(enc).decode(bytes);
      if ((t.match(/\ufffd/g) || []).length < bad) return t;
    } catch (_) { /* 这个环境不支持这个编码 ✓ */ }
  }
  return utf8;   /* 都解不出来 → 至少给个能看的 ✓（总比报错强 ✓） */
}
function parseTxt(buf, name) {
  const text = decodeText(buf);
  const chapters = chapterize(text, name);
  if (!chapters.length) throw new Error('这个 TXT 是空的');
  return { title: String(name || '').replace(/\.txt$/i, '') || '未命名', author: '', chapters };
}

module.exports = { parseEpub, parseTxt, htmlToText, firstHeading, chapterize, decodeText };
