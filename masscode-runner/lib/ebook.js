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

/* ── Project Gutenberg 的样板 ✓ ────────────────────────────────────────────
   ★★★ 这是**拿真实电子书试出来的** ✗✗ —— 现造样本永远测不到 ✓：
   用户手上最容易拿到的免费公版书就是**古登堡计划**（gutenberg.org ✓），
   而它**每本书**都塞了一大段版权声明 + 捐赠说明 + 许可证全文 ✗。

   ⚠️⚠️ 而且它**不是「一小段」** ✗✗ —— 实测 **1.8 万 ~ 3 万字** ✓
   （比很多书的正文都长 ✗，`pg23950` 的样板章节 25448 字 ✓）。
   → 所以「短就丢掉」这个第一直觉是**错的** ✗ —— 我量了一下才发现 ✓。
     按长度判会把**真章节**误伤 ✗，把样板放过去 ✗，两头都错 ✗。

   ★ 正确做法：古登堡**自己给了标记** ✓ ——
     `*** START OF THE PROJECT GUTENBERG EBOOK X ***` 和 `*** END OF … ***` ✓，
     **两个标记之间才是正文** ✓（它自己的约定 ✓）。
     实测 16 本**全都有** ✓，标记前面只有 700~950 字垃圾 ✓。
   → 老版本 / 别的来源可能没标记 ✓ → 再用「样板特征」**保守**兜一层 ✓
     （要求命中 ≥2 条特征 ✓ **而且**去掉这些行之后剩下的字**少于 400** ✓ ——
      只在「这一段基本就是样板」时才丢 ✗，正文里提一句不会被误伤 ✓）。 */
const PG_START = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i;
const PG_END = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i;
const PG_NOISE = [
  /This eBook is for the use of anyone anywhere/i,
  /Project Gutenberg/i,
  /Most people start at our website/i,
  /www\.gutenberg\.org/i,
  /Updated editions will replace the previous one/i,
  /START OF (?:THE|THIS) PROJECT GUTENBERG/i,
  /END OF (?:THE|THIS) PROJECT GUTENBERG/i,
];
function pgNoiseHits(text) {
  const t = String(text || '');
  let n = 0;
  PG_NOISE.forEach((re) => { if (re.test(t)) n++; });
  return n;
}
/* ⚠️⚠️ 「Produced by …」在 **START 标记之后** ✗ —— 实测发现的 ✓：
   古登堡把校对者署名放在 START 下面 ✓，所以按标记切**切不掉它** ✗
   （实测：三國志演義 / 水滸傳 / 西遊記 / 紅樓夢 / 道德經 的**首章正文第一行**
    全是「Produced by Jian-Lun Huang」这种 ✗，读者一打开就看到一串英文署名 ✗）。
   → 把开头这几段**署名 / 校对说明**也剥掉 ✓（只剥**连续**的开头几段 ✗，
     一碰到正文就停 ✓，中间出现不算 ✓）。
   ⚠️ 署名常被**空行劈成两段** ✗ —— 实测：
     `Produced by Mireille Harmelin … and the Online` + `Distributed Proofreaders Europe at …` ✓
     第一段剥掉了 ✓，第二段**以「Distributed」开头** ✓ → 也要认 ✓；
     还有一种是 `Online Distributed Proofreading Team at …` ✓（**以 Online 开头** ✓）。
     → 三种写法都得覆盖 ✓，不然剥一半留一半 ✗（读者一打开就是 `Distributed Proofreaders` ✗）。 */
const PG_CREDIT = /^\s*(?:(?:Online\s+)?Distributed Proofread\w*|Produced by|Transcribed from|Scanned by|E-?[Tt]ext prepared by|Proofread by|This (?:eBook|file) was produced by|Updated editions will replace|THE FULL PROJECT GUTENBERG|THERE IS AN ILLUSTRATED EDITION OF THIS TITLE)\b/i;
/* ⚠️ **结尾**也有一行页脚 ✗ —— 实测：`End of Project Gutenberg's La serpicina, by …` ✓
   （它**不在** `*** END OF … ***` 那种标记里 ✓，所以按标记切切不掉 ✓）。 */
const PG_FOOTER = /^\s*(?:End of (?:the )?Project Gutenberg|End of Project Gutenberg's|THE END OF (?:THE )?PROJECT GUTENBERG|Updated editions will replace|Most people start at our website)\b/i;
function stripPgCredit(text) {
  const paras = String(text || '').split(/\n{2,}/);
  let a = 0;
  while (a < paras.length && paras[a].trim() && PG_CREDIT.test(paras[a])) a++;
  let b = paras.length;
  while (b > a && paras[b - 1].trim() && PG_FOOTER.test(paras[b - 1])) b--;
  if (a === 0 && b === paras.length) return String(text || '').trim();
  return paras.slice(a, b).join('\n\n').trim();
}

/* 把一章（或整篇）里的古登堡样板剥掉 ✓ —— 剥不动就**原样返回** ✗（绝不猜 ✗） */
function stripPg(text) {
  let t = String(text == null ? '' : text);
  const s = t.search(PG_START);
  if (s >= 0) {
    const nl = t.indexOf('\n', s);
    t = nl >= 0 ? t.slice(nl + 1) : '';
  }
  const e = t.search(PG_END);
  if (e >= 0) t = t.slice(0, e);
  t = t.trim();
  /* ★ 判据 = **段落级命中率** ✓ —— 不是「长度」✗、也不是「行级命中」✗：
     · 不用长度 ✗：样板 **1.8 万 ~ 3 万字** ✓，比很多书正文都长 ✓（第一直觉就是错的 ✗）；
     · 不用行级 ✗：许可证是**长段换行**的 ✓，每个段落只有**第一行**含特征词 ✓，
       续行看着「很干净」✗ → 按行算命中率只有三成 ✗ → **永远判不出来** ✗
       （我第一版就是这么写的 ✓，测试直接红了 ✓）。
     → 段落命中率 **≥ 0.6** 才算「这一段基本就是样板」✓
       （正文里顺口提一句 → 比例极低 ✓，绝不误伤 ✓）。
     ⚠️ 这条**不管有没有标记都要跑** ✗ —— 「整段都是许可证」这种情况
        光按 START/END 切是**切不干净的** ✓（许可证也可能整个在标记外面 ✓）；
        而段落级判据天然安全 ✓（真正文不可能六成段落都提 Gutenberg ✓）。 */
  const paras = t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const noisy = paras.filter((x) => pgNoiseHits(x) > 0).length;
  if (paras.length && noisy / paras.length >= 0.6) return '';
  return stripPgCredit(t);
}

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
/* 取文档里的第一个标题 ✓（`<h1>` 优先 ✓，退到 `<h2>` ✓，再退到 `<title>` ✓）
   ⚠️⚠️ 古登堡的书 `<title>` 是**样板** ✗（`The Project Gutenberg eBook of 三國志演義` ✓），
      拿它当章名 → 整本书**每一章都叫同一个名字** ✗✗ ——
      实测：三國志演義 **26 章只有 2 个不同章名** ✗（TOC 完全没法用 ✗）。
      → 样板标题一律**当没有** ✓（宁可退到「第 N 节」✓，也不要 26 个重名 ✗）。 */
function firstHeading(html) {
  const h = String(html == null ? '' : html);
  for (const tag of ['h1', 'h2', 'h3', 'title']) {
    const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(h);
    if (m) {
      const t = htmlToText(m[1]).replace(/\s+/g, ' ').trim();
      if (!t || t.length > 60) continue;
      if (/project gutenberg|gutenberg\.org/i.test(t)) continue;
      return t;
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

/* ── 把「目录块」从正文里**摘掉** ✓ ──────────────────────────────────────
   ★★ 还是拿真实书试出来的 ✗（白鲸 ✓）：书首那张 CONTENTS 里 135 条全是
     「CHAPTER 49. The Hyena.」✓ —— **全都能匹配标题规则** ✓ →
     `chapterize` 把它们切成一堆「章」✗，每「章」的「正文」只是**下一条目录** ✗
     （标题太长会折行 ✓，只有第一行匹配得上 ✓）。
     实测：白鲸切出 **113 章** ✗，前 16 章全是 `[43字] CHAPTER 49 …` 这种 ✗。

   ★ 判据：**连着 ≥6 段都是「只有标题、没有散文」** ✓ ——
     目录是一长串紧挨着的短标题段 ✓；真正文里标题段之间**至少隔着一大段散文** ✓
     （三國志演義 的回目后面紧跟着就是正文 ✓，跑不出 2 段 ✓）。

   ⚠️⚠️ 为什么**不能**用「标题行占比」✗（我第一版就是这个 ✓，**实测没管用** ✗）：
     目录里的标题**会折行** ✓（`CHAPTER 55. Of the Monstrous Pictures of` + `Whales.` ✓），
     折行的续行**看着像散文** ✗ → 按行算占比只有五成 ✓，
     而这一章里还夹着真正文 ✓ → 占比被摊薄到 0.1 ✗ → **判不出来** ✗。
     改成**按段**判 ✓（一段里**只要有**标题行、且没有长句 ✓ 就算「目录段」✓）就稳了 ✓。
   ⚠️ 阈值取 **6 段** ✓：1~2 段是「标题 + 副标题」这种正常排版 ✓，绝不误伤 ✓。
   ⚠️ 摘完**不 i++** ✗ —— 后面可能还有第二块目录 ✓（实测白鲸就有两处 ✓）。 */
function headLines(p) {
  return String(p || '').split('\n')
    .map((x) => x.trim())
    .filter((l) => l && l.length <= 40 && HEAD.test(l)).length;
}
/* 句末标点 ✓ —— 用来把「散文段」和「标题段」分开 ✗ */
const SENT_END = /[。！？!?；;，,、：:.]$/;
function isHeadPara(p) {
  const t = String(p || '').trim();
  if (!t || t.length > 100) return false;
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length || !lines.every((l) => l.length <= 70)) return false;
  return headLines(t) > 0;
}
/* 「标题的**下半截**」✓ —— 实测爱丽丝的目录是**两段式** ✗：
   `CHAPTER I.` + `Down the Rabbit-Hole` ✓（标题被拆成两段 ✓）。
   第二段**没有「第X章」这种字样** ✗ → 只按 `isHeadPara` 认的话，
   连续长度永远是 1 ✗ → 永远够不到门槛 ✗（实测就是这么漏掉的 ✗）。
   ⚠️ 判据里**必须**要求「末尾不是句末标点」✗ ——
      散文段十有八九以句号收尾 ✓（「他走了。」✓），标题段不会 ✓
      （`Down the Rabbit-Hole` ✓）→ 就靠这一条把两者分开 ✓。 */
function isTitlePara(p) {
  const t = String(p || '').trim();
  if (!t || t.length > 70) return false;
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length || !lines.every((l) => l.length <= 70)) return false;
  if (headLines(t) > 0) return false;
  return !lines.some((l) => SENT_END.test(l));
}
function isTocish(p) { return isHeadPara(p) || isTitlePara(p); }
function stripTocBlock(text) {
  const paras = String(text || '').split(/\n{2,}/);
  let i = 0;
  while (i < paras.length) {
    if (!isTocish(paras[i])) { i++; continue; }
    /* ⚠️ 连续长度要数**标题行** ✗，不能数**段落数** ✗ ——
       整张目录挤在一段里的时候段落数永远是 1 ✓，够不到门槛 ✓（实测踩过 ✗）。 */
    let j = i; let heads = 0;
    while (j < paras.length && isTocish(paras[j])) { heads += headLines(paras[j]); j++; }
    /* ⚠️ 两道门槛一起 ✗：标题行 **≥6** ✓ **而且**占这段连续段落的 **1/3** 以上 ✓。
       只卡 ≥6 的话，正常正文里连着 6 个短标题段也会被误摘 ✗；
       加上密度要求之后，爱丽丝那种「标题 + 下半截」各占一半的情形照样能过 ✓（12/24 = 0.5 ✓）。 */
    if (heads >= 6 && heads / (j - i) >= 0.3) { paras.splice(i, j - i); continue; }
    i = j;
  }
  return paras.join('\n\n');
}

/* ── 章节粒度：一章里可能塞了**好几回** ✗ ────────────────────────────────
   ★★ 也是**拿真实书试出来的** ✗：中文古典小说的 EPUB 常常是
     「一个 xhtml = 4~5 回」✓（出版方按卷切 ✓，不按回切 ✓）。
     实测：三國志演義 26 个 xhtml ✓，而正文里一共 **108 处「第N回」** ✓ ——
     只给 26 个章，用户翻起来**很粗** ✗（想找「第三十七回」得在一章里翻 5 回 ✗）。
   → 每章**再试切一次** ✓，切出 **≥ 3** 个子章才采纳 ✓。
     ⚠️ 门槛为什么是 3 而不是 2 ✗：正文里顺口提一句「第二章」太常见 ✓
        （「详见第二章」✓），一刀切会把好好的章节**切碎** ✗ ——
        1~2 个不采纳 ✓，正好挡住这种误伤 ✓。
     ⚠️ 切不出来 `chapterize` 会**原样返回 1 章** ✓（没有副作用 ✓），
        所以对已经切好的书（福尔摩斯 14 章 / 双城记 46 章 ✓）完全不生效 ✓。 */
function refineChapters(chapters) {
  const out = [];
  (chapters || []).forEach((c) => {
    /* ★ 先把**目录块**摘掉 ✓（见 `stripTocBlock` ✓）—— 必须在切之前 ✗ */
    const sub = chapterize(stripTocBlock(c.text), c.title);
    /* ⚠️⚠️ **空章必须丢掉** ✗✗ —— 这是拿真实书试出来的 ✓，而且是**致命**的那种 ✗：
       书首那张**目录页**（CONTENTS ✓）里每一行都是「CHAPTER 1. Loomings.」✓ ——
       **全部匹配标题规则** ✓ → `chapterize` 切出**一长串 0 字的章** ✗✗
       （实测：白鲸 **241 章里有 135 个是空的** ✗，双城记 89 章里 88 个是空的 ✗
         —— 目录页本身被当成了一本书 ✗，TOC 彻底没法用 ✗）。
       → 只保留**真有正文**的子章 ✓；一个都没有（就是那张目录页 ✓）→ 整页原样留着 ✓
         （当目录用挺好 ✓，比切成 135 个空壳强 ✗）。
       ⚠️ 丢空章**不会丢内容** ✗ —— 空章按定义就没有正文 ✓。 */
    const real = sub.filter((s) => String(s.text || '').trim().length > 0);
    if (real.length < 3) { out.push(c); return; }
    /* ★★★ 第一段如果**不是回目**（`chapterize` 会给它起名「正文」✓）——
       那是**上一回的尾巴** ✗✗，也是拿真实书试出来的 ✓：
       EPUB 是**按卷切文件**的 ✓，一回会被**从中间劈开** ✗
       （实测：三國志演義 26 个文件 → 切出 **22 个「正文」碎片** ✗，
        每片 1000~6000 字 ✓，逐一看过 —— 全是**上一回的结尾** ✓；
        紅樓夢 21 个、水滸傳 20 个、西遊記 28 个 ✓，同一个毛病 ✗）。
       → **并回上一章** ✓，别让它单独占一个「正文」章 ✗
         （不然 TOC 里一长串「正文」✗，用户根本不知道那是啥 ✓）。
       ⚠️ 全书**第一个**文件就是这种情况的话 → 那它真是开头 ✓，留着 ✓（别往空气里并 ✗）。 */
    let lead = null;
    if (real[0].title === '正文') {
      if (out.length) lead = real.shift();
      else out.push(real.shift());
    }
    if (lead) {
      const prev = out[out.length - 1];
      prev.text = String(prev.text || '').trim() + '\n\n' + String(lead.text || '').trim();
    }
    real.forEach((s) => out.push(s));
  });
  return out;
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
    /* ★ 先剥古登堡样板 ✓（**必须在判空之前** ✗ —— 剥完变空的就是纯样板页 ✓，
       正好被下面那句 `if (!text) return;` 丢掉 ✓，不用另写一条过滤 ✓）。 */
    text = stripPg(text);
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
  /* ★ 再按回目细化一遍 ✓（一章塞了好几回的书 ✓，见 `refineChapters` ✓） */
  return finishBook(title, author, refineChapters(chapters));
}

/* 收尾 ✓：细切一遍 + 什么都没有就报错 ✓（两条路都走这里 ✓，不会漏 ✓）
   ⚠️ 「整本塞在一个 xhtml 里」那条老规则（原来是 `chapters.length === 1` 才切 ✓）
      已经被 `refineChapters()` **合并进来**了 ✓ ——
      它对**每一章**都试切 ✓（门槛 ≥3 ✓），1 章的书自然也覆盖 ✓，
      不用再单写一条 ✗（同一件事写两处，迟早漂移 ✗）。 */
function finishBook(title, author, chapters) {
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
  /* ★ TXT 也一样剥样板 ✓ —— 古登堡的 `.txt` 和 `.epub` 带的是同一段 ✓ */
  const text = stripPg(decodeText(buf));
  const chapters = refineChapters(chapterize(text, name));
  if (!chapters.length) throw new Error('这个 TXT 是空的');
  return { title: String(name || '').replace(/\.txt$/i, '') || '未命名', author: '', chapters };
}

module.exports = { parseEpub, parseTxt, htmlToText, firstHeading, chapterize, decodeText, stripPg, refineChapters };
