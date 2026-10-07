'use strict';

/* ── 英文文本处理（纯逻辑：没有 DOM ✗、没有网络 ✗、没有 STORE ✗）──────────────
   给「外刊精读」用 ✓：
     · extractArticle(html, url)  从网页 HTML 里抽出正文（Readability 的极简版 ✓）
     · splitSentences(text)       把正文切成句子 —— 精读的最小单位 ✓
     · splitParagraphs(text)      切段落（正文显示要保留分段 ✓）
     · tokenizeWords(text)        取词（词频 / 难度估计 ✓）
     · cleanWord(raw)             把 "Word," / "don’t" / "U.S." 洗成查词用的形式 ✓
     · countWords / readingMinutes / levelOf  词数 / 阅读时长 / 难度估算 ✓

   ⚠️ 这里是**纯函数** ✗ —— 不碰 DOM ✗、不读 STORE ✗、不联网 ✗。
      好处：能直接单测 ✓（`tests/en-text.js` ✓），而且抓取逻辑能拿**真实网页**当样本验 ✓。
   ══════════════════════════════════════════════════════════════════════ */

/* ── HTML 小工具 ✓ ─────────────────────────────────────────────────────── */
const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×', middot: '·', bull: '•',
};
function unescapeEntities(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = String(e).toLowerCase();
    if (k.charAt(0) === '#') {
      const code = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
  });
}
/* 去掉标签 + 解实体 + 收空白 ✓ —— 全模块统一走这一个 ✓（别各处自己 replace ✗） */
function textOf(frag) {
  return unescapeEntities(String(frag == null ? '' : frag).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
/* 取一段 HTML 里**所有 <a> 的文字总长** ✓ —— 这是判断「是不是导航」的关键指标 ✓：
   导航条几乎全是链接 ✓（链接文字占比高 ✗），正文段落几乎没有链接 ✓。 */
function linkTextLen(frag) {
  let n = 0;
  const re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(frag))) n += textOf(m[1]).length;
  return n;
}

/* ── 按标签名做「配对切片」✓（不能用非贪婪正则 ✗ —— 嵌套的 </div> 会提前截断 ✗）── */
function sliceTag(html, afterOpen, tag) {
  const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi');
  re.lastIndex = afterOpen;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { depth--; if (depth === 0) return html.slice(afterOpen, m.index); }
    else depth++;
  }
  return null;
}
/* 找第一个「属性匹配 attrRe」的 <tag>，返回它**内部**的 HTML ✓ */
function findScope(html, tag, attrRe) {
  const re = new RegExp('<' + tag + '\\b[^>]*>', 'gi');
  let m;
  while ((m = re.exec(html))) {
    if (!attrRe || attrRe.test(m[0])) {
      const inner = sliceTag(html, m.index + m[0].length, tag);
      if (inner) return inner;
    }
  }
  return null;
}

/* ── 段落抽取 + 过滤 ✓ ──────────────────────────────────────────────────
   两道过滤，缺一不可 ✓：
     ① **太短** 的不要 ✗（导航项、按钮、图注 ✓）；
     ② **链接文字占比高** 的不要 ✗（导航条几乎全是链接 ✓ —— 这是 Readability 的核心判据 ✓）。
   实测（NPR 正文页 ✓）：只靠 ① 会把
     「Accessibility links Skip to main content Keyboard shortcuts for audio player」
     当成正文 ✗；加上 ② 就干净了 ✓。 */
const JUNK_P = /^(advertisement|skip to|accessibility|keyboard shortcuts|sign up|subscribe|newsletter|share (this|on)|read more|related (stories|articles)|comments?$|most (read|viewed|shared)|follow us|download|listen to|support (npr|the guardian|us)|donate|cookie|privacy policy|terms of use|©)/i;
/* ★ 图注要单独挡一道 ✗ —— 它**够长**（> 40 ✓）、**没链接**（链接占比 0 ✓），
   两道过滤都拦不住它 ✗，但它明显不是正文 ✗。
   实测（真网页 ✓）：NPR 的第一段是「Portraits of … hide caption」✗、
   Aeon 的第一段是「… Photo by Stefan Wermuth/Reuters」✗ ——
   只靠长度 + 链接密度的话，精读的第一句就是图注 ✗，很难看 ✗。
   ⚠️ 加长度上限 ✗：正文里也可能合法地出现「Reuters 报道」✓，
      所以只在**短段**（< 320 字 ✓）上按图注处理 ✓。 */
const CAPTION_P = /(hide caption\s*$|photo by |photograph(?:ed)? by |image: |illustration by |getty images|shutterstock|tt news agency|\/\s*(?:ap|reuters|afp)\s*$|\breuters\s*$)/i;
function parasFrom(scope) {
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(scope))) {
    const raw = m[1];
    const t = textOf(raw);
    if (t.length < 40) continue;
    if (JUNK_P.test(t)) continue;
    if (t.length < 320 && CAPTION_P.test(t)) continue;
    if (linkTextLen(raw) / Math.max(1, t.length) > 0.35) continue;
    if (out.length && out[out.length - 1] === t) continue;   /* 连续重复的去掉 ✓ */
    out.push(t);
  }
  return out;
}

/* 正文容器的**优先级级联** ✓ —— 从上往下试，第一个给出 >= 3 段的就用它 ✓。
   ⚠️ 实测过 ✓：NPR 有 <article> ✓、Aeon 只有 <main> ✓ ——
      所以不能只认一个选择器 ✗，得级联 ✓，最后还有兜底 ✓。 */
const SCOPES = [
  ['div', /itemprop=["']articleBody["']/i],
  ['div', /class=["'][^"']*\b(article-?body|story-?text|story-?body|entry-content|post-content|article__body|content-?body)\b[^"']*["']/i],
  ['section', /class=["'][^"']*\b(article-?body|story-?text|entry-content|post-content)\b[^"']*["']/i],
  ['article', null],
  ['main', null],
  ['div', /id=["'](content|main|article|story)["']/i],
];

function extractTitle(html) {
  const meta = (name) => {
    const a = new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*>', 'i').exec(html);
    if (!a) return '';
    const c = /content=["']([\s\S]*?)["']/i.exec(a[0]);
    return c ? textOf(c[1]) : '';
  };
  let t = meta('og:title') || meta('twitter:title');
  if (!t) {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1) t = textOf(h1[1]);
  }
  if (!t) {
    const ti = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (ti) t = textOf(ti[1]);
  }
  /* 去掉标题尾巴上的站名 ✓（「xxx | NPR」「xxx - The Guardian」✓） */
  return t.replace(/\s*[|｜\-–—·]\s*[^|｜\-–—·]{2,28}$/, '').trim() || t.trim();
}

/* ── 主函数：从 HTML 抽正文 ✓ ───────────────────────────────────────────── */
function extractArticle(html, url) {
  let h = String(html == null ? '' : html);
  /* ① 去注释 ✓ + 去**整块**噪音 ✓（这些标签里面基本不可能是正文 ✗）*/
  h = h.replace(/<!--[\s\S]*?-->/g, ' ');
  h = h.replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|template|button|select|figure|figcaption)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  const title = extractTitle(h);
  let paras = [];
  let via = '';
  for (const [tag, attrRe] of SCOPES) {
    const scope = findScope(h, tag, attrRe);
    if (!scope) continue;
    const got = parasFrom(scope);
    if (got.length >= 3) { paras = got; via = tag + (attrRe ? '[属性]' : ''); break; }
    if (!paras.length && got.length) { paras = got; via = tag + '[弱]'; }   /* 先记着当兜底 ✓ */
  }
  if (paras.length < 3) {                     /* 级联全没命中 → 整篇扫一遍 ✓ */
    const all = parasFrom(h);
    if (all.length > paras.length) { paras = all; via = '全文兜底'; }
  }
  let host = '';
  try { host = new URL(String(url || '')).hostname.replace(/^www\./i, ''); } catch (_) { host = ''; }
  const text = paras.join('\n\n');
  const words = countWords(text);
  return {
    ok: paras.length > 0,
    title: title || '(没抓到标题)',
    site: host,
    text,
    paras: paras.length,
    words,
    minutes: readingMinutes(words),
    level: levelOf(text),
    via,
    error: paras.length ? '' : '这一页没能抽出正文（多半是动态加载的，或者结构太特别）—— 直接复制正文粘进来更快',
  };
}

/* ── 分句 ✓ ─────────────────────────────────────────────────────────────
   ⚠️ 难点是**缩写** ✗：Mr. / Dr. / U.S. / e.g. / a.m. / J. Smith / 3.14 ✗ ——
      天真地按 `.` 切会碎成一片 ✗。这里用**两条**判据一起挡 ✓：
        ① 句末那个词是缩写 / 首字母 → 不断 ✓；
        ② 点后面**必须**像新句子的开头（大写 / 数字 / 引号 ✓）→ 否则不断 ✓。 */
const ABBR = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'no', 'fig', 'inc', 'ltd',
  'co', 'corp', 'dept', 'univ', 'gen', 'sen', 'rep', 'gov', 'col', 'capt', 'lt', 'sgt', 'mt',
  'ft', 'ave', 'blvd', 'rd', 'approx', 'est', 'cf', 'al', 'ed', 'eds', 'vol', 'pp', 'p',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'pres', 'hon', 'supt', 'mgr', 'min', 'max',
]);
function isAbbrevToken(tok) {
  const t = String(tok || '');
  const low = t.toLowerCase();
  if (/^(?:[a-z]\.){2,}$/.test(low)) return true;        /* u.s. / e.g. / i.e. / a.m. ✓ */
  if (/^[A-Z]\.$/.test(t)) return true;                  /* 人名的首字母：J. Smith ✓ */
  return ABBR.has(low.replace(/\.+$/, ''));              /* Mr. / etc. / Dec. ✓ */
}
function splitSentences(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const out = [];
  const lines = src.split('\n');
  for (let pi = 0; pi < lines.length; pi++) {
    const line = lines[pi].replace(/[ \t]+/g, ' ').trim();
    if (!line) continue;
    let start = 0;
    const re = /([.!?…]+)(["'”’)\]]*)(\s+|$)/g;
    let m;
    while ((m = re.exec(line))) {
      const end = m.index + m[1].length + m[2].length;
      /* ★ 小数点先挡掉 ✓ —— "$3.5 million" / "3.5 million" 里的点**两边都是数字** ✓，
         按「点后面是大写/数字」那条判据会被切碎 ✗（$3. / 5 million ✗）。 */
      if (/[0-9]/.test(line.charAt(m.index - 1)) && /[0-9]/.test(line.charAt(end))) continue;
      const head = line.slice(0, m.index + m[1].length);
      const tok = (head.match(/[A-Za-z][A-Za-z.]*$/) || [''])[0];
      if (tok && isAbbrevToken(tok)) continue;           /* 判据 ① */
      const rest = line.slice(end + m[3].length);
      if (m[3] !== '' && rest && !/^["'“”‘’(\[]?[A-Z0-9]/.test(rest)) continue;  /* 判据 ② */
      const chunk = line.slice(start, end).trim();
      if (chunk) out.push({ text: chunk, para: pi });
      start = end + m[3].length;
    }
    const tail = line.slice(start).trim();
    if (tail) out.push({ text: tail, para: pi });
  }
  return out;
}
function splitParagraphs(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
    .map((x) => x.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}

/* ── 取词 / 洗词 ✓ ─────────────────────────────────────────────────────── */
const STOP = new Set(('a an the and or but if while of to in on at by for with from as is are was were be been being ' +
  'it its this that these those he she they we you i his her their our your my me him them us not no nor so than then ' +
  'there here when where which who whom what how why all any both each few more most other some such only own same too ' +
  'very can will just should now do does did done have has had having would could may might must shall about into over ' +
  'after before between during through under above again further once because until against out off up down').split(' '));
/* 把划出来的片段洗成「查词用的词形」✓：
   "Word," → word ✓；"don’t" → don't ✓（弯引号统一成直的 ✓）；"U.S." → u.s ✓。 */
function cleanWord(raw) {
  let w = String(raw == null ? '' : raw).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  w = w.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z'’\-]+$/, '').replace(/'+$/, '');
  return w.toLowerCase();
}
function tokenizeWords(text, opts) {
  const o = opts || {};
  const minLen = o.minLen == null ? 2 : o.minLen;
  const out = [];
  const re = /[A-Za-z][A-Za-z'’\-]*/g;
  let m;
  while ((m = re.exec(String(text == null ? '' : text)))) {
    const w = cleanWord(m[0]);
    if (w.length < minLen) continue;
    if (o.dropStop && STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}
function countWords(text) {
  return tokenizeWords(text, { minLen: 1 }).length;
}
function readingMinutes(n) {
  return Math.max(1, Math.round((Number(n) || 0) / 200));   /* 英文精读约 200 词/分钟 ✓ */
}

/* ── 难度估算 ✓ ─────────────────────────────────────────────────────────
   ⚠️ 这是**估算** ✗，不是 CEFR 官方定级 ✗ —— UI 上必须标「估算」✓。
   两个指标：平均句长 ✓ + 长词（>= 8 字母）占比 ✓（这是可读性公式的老套路 ✓）。 */
function levelOf(text) {
  const t = String(text == null ? '' : text);
  const words = tokenizeWords(t, { minLen: 1 });
  if (words.length < 40) return '';
  const sents = splitSentences(t);
  const avgSent = words.length / Math.max(1, sents.length);
  const longRatio = words.filter((w) => w.length >= 8).length / words.length;
  const score = avgSent * 0.55 + longRatio * 100 * 0.45;
  if (score < 11) return 'A2';
  if (score < 15) return 'B1';
  if (score < 19) return 'B2';
  return 'C1';
}

/* ⚠️⚠️ 顶层 const 的名字必须**全局唯一** ✗✗ —— 见 srs.js 末尾那段注释：
   两个共享模块都叫 `const API` 的话，第二个脚本会**整个不执行** ✗
   （报 `Identifier 'API' has already been declared` ✗，实测踩过 ✗）。 */
const LW_EN_TEXT_API = {
  extractArticle, extractTitle, splitSentences, splitParagraphs,
  tokenizeWords, cleanWord, countWords, readingMinutes, levelOf,
  textOf, unescapeEntities, isAbbrevToken,
};
/* ★★ 这个模块是**双栖**的 ✓ —— 服务端 `require` 拿到 ✓，浏览器里挂到 `window.LW_EN_TEXT` ✓。
   为什么必须共享同一份 ✗：分句那套缩写规则（Mr. / U.S. / 3.14 ✗）在前端再抄一遍，
   两边迟早走偏 ✗，而且「服务端抽正文」和「前端逐句渲染」用的**必须**是同一个分句器 ✗，
   否则会出现「服务端说有 15 句、前端画出 17 句」这种鬼问题 ✗。
   ⚠️ 所以本文件**不能**有任何顶层副作用 ✗、**不能** require 别的东西 ✗
      （它在浏览器里是被 `<script type="module">` 直接加载的 ✓）。
   服务端只把**白名单里那几个**文件暴露给浏览器 ✓（见 server.js 的 SHARED_LIB_FILES ✓）。 */
if (typeof module !== 'undefined' && module.exports) module.exports = LW_EN_TEXT_API;
if (typeof window !== 'undefined') window.LW_EN_TEXT = LW_EN_TEXT_API;
