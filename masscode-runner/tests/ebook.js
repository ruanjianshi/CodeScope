/* 电子书解析（lib/ebook.js）—— 纯单测 ✓，不联网 ✓、不起服务 ✓。
   ⚠️ 样本是**现造的** ✗ —— 这台机器上**一个 epub 都没有** ✓（find 出来 0 个 ✓），
      所以用 fflate 现场压一个最小的合法 EPUB ✓。
   ⚠️ 重点打这几个坑 ✗：① 块级标签要换成换行（不然整本书变一行 ✗）
      ② spine 顺序 ≠ manifest 顺序 ✗ ③ 路径要相对 OPF 所在目录解析 ✗
      ④ 中文 TXT 十有八九是 GBK ✗ ⑤ 切不出章节时**别硬切** ✗ */
const { zipSync, strToU8 } = require('fflate');
const E = require('../lib/ebook.js');

let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; } else { fails.push(n + (x ? '  → ' + x : '')); console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
const eq = (n, a, b) => ck(n, JSON.stringify(a) === JSON.stringify(b), '得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));

console.log('── ① HTML → 纯文本 ──');
ck('块级标签换成换行（不是粘成一坨）',
  E.htmlToText('<p>第一段</p><p>第二段</p>') === '第一段\n\n第二段',
  JSON.stringify(E.htmlToText('<p>第一段</p><p>第二段</p>')));
ck('★ `<br>` 也当换行（很多书靠它分行）',
  E.htmlToText('第一行<br/>第二行') === '第一行\n第二行',
  JSON.stringify(E.htmlToText('第一行<br/>第二行')));
ck('标题标签也断行', /一\n\n二/.test(E.htmlToText('<h1>一</h1><h2>二</h2>')));
ck('script / style 整块丢掉（不留里面的代码）',
  E.htmlToText('<p>正文</p><script>var a=1;</script><style>p{color:red}</style>') === '正文',
  JSON.stringify(E.htmlToText('<p>正文</p><script>var a=1;</script><style>p{color:red}</style>')));
ck('注释丢掉', E.htmlToText('前<!-- 这是注释 -->后').indexOf('注释') < 0);
ck('实体解码（&amp; &lt; &#39; &hellip;）',
  E.htmlToText('a &amp; b &lt;c&gt; &#39;d&#39; &hellip;') === "a & b <c> 'd' …",
  JSON.stringify(E.htmlToText('a &amp; b &lt;c&gt; &#39;d&#39; &hellip;')));
ck('数字实体 &#8212;', E.htmlToText('a&#8212;b') === 'a—b');
ck('⚠️ 不把空格当段落分隔（中文书会散架）',
  E.htmlToText('<p>中文 一段</p><p>中文 二段</p>') === '中文 一段\n\n中文 二段',
  JSON.stringify(E.htmlToText('<p>中文 一段</p><p>中文 二段</p>')));
ck('空输入不炸', E.htmlToText('') === '' && E.htmlToText(null) === '');
ck('三个以上连续换行收成两个', E.htmlToText('a</p></p></p><p>b') === 'a\n\nb', JSON.stringify(E.htmlToText('a</p></p></p><p>b')));

console.log('\n── ② 取标题 ──');
eq('h1 优先', E.firstHeading('<h1>第一章</h1><h2>小节</h2>'), '第一章');
eq('没有 h1 退到 h2', E.firstHeading('<h2>小节</h2>'), '小节');
eq('再退到 title', E.firstHeading('<head><title>书名</title></head>'), '书名');
eq('都没有 → 空串', E.firstHeading('<p>正文</p>'), '');
ck('⚠️ 超长的「标题」不要（多半是正文被当成标题了）',
  E.firstHeading('<h1>' + '很'.repeat(80) + '</h1>') === '',
  E.firstHeading('<h1>' + '很'.repeat(80) + '</h1>').slice(0, 20));

console.log('\n── ③ 切章 ──');
const TXT = ['第一章 起风了', '他站在门口。', '', '第二章 雨', '雨下了一夜。', '', '第三章 晴', '天亮了。'].join('\n');
const ch = E.chapterize(TXT, '测试书');
eq('切出 3 章', ch.length, 3);
eq('第一章的标题', ch[0].title, '第一章 起风了');
ck('第一章的正文对', /他站在门口/.test(ch[0].text) && !/雨下了一夜/.test(ch[0].text), ch[0].text);
const en = E.chapterize(['Chapter 1 Dawn', 'It was dawn.', '', 'Chapter 2 Dusk', 'It was dusk.'].join('\n'), 'x');
eq('英文 Chapter N 也认', en.length, 2);
eq('序 / 楔子 也认', E.chapterize(['楔子', '很久以前。', '第一章 开始', '正文。'].join('\n'), 'x').length, 2);
ck('★★ 切不出来时**整篇当一章**（绝不硬切）',
  E.chapterize('就是一段普通的话，没有任何标题。', '我的书').length === 1,
  String(E.chapterize('就是一段普通的话，没有任何标题。', '我的书').length));
eq('  而且标题用了传进来的书名', E.chapterize('普通文本', '我的书')[0].title, '我的书');
ck('标题前的内容归到「正文」那一章',
  E.chapterize(['前面的话', '第一章 开始', '正文'].join('\n'), 'x')[0].title === '正文',
  E.chapterize(['前面的话', '第一章 开始', '正文'].join('\n'), 'x')[0].title);
ck('空文本 → 0 章（不炸）', E.chapterize('', 'x').length === 0 && E.chapterize(null, 'x').length === 0);
ck('★ 一行超长的不算标题（正文里出现「第一章」三个字也不该切）',
  E.chapterize('他说：' + '第一章' + '这件事很长很长很长很长很长很长很长很长很长很长很长很长。', 'x').length === 1);

console.log('\n── ④ EPUB：现造一个最小的合法样本 ──');
function makeEpub(opts) {
  const o = opts || {};
  const opfDir = o.opfDir || 'OEBPS';
  const files = {};
  files['mimetype'] = strToU8('application/epub+zip');
  files['META-INF/container.xml'] = strToU8(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    + '<rootfiles><rootfile full-path="' + opfDir + '/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  files[opfDir + '/content.opf'] = strToU8(
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0">'
    + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + '<dc:title>' + (o.title || '测试书') + '</dc:title><dc:creator>' + (o.author || '某作者') + '</dc:creator>'
    + '</metadata><manifest>'
    /* ⚠️ manifest 顺序**故意打乱** ✗（c3 排在最前面 ✓）—— spine 才是阅读顺序 ✓ */
    + '<item id="c3" href="Text/ch3.xhtml" media-type="application/xhtml+xml"/>'
    + '<item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>'
    + '<item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>'
    + '</manifest><spine toc="ncx">'
    + '<itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>'
    + '</spine></package>');
  ['1', '2', '3'].forEach((n) => {
    files[opfDir + '/Text/ch' + n + '.xhtml'] = strToU8(
      '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第' + n + '章</title></head>'
      + '<body><h1>第' + n + '章 标题' + n + '</h1><p>这是第 ' + n + ' 章的正文。</p><p>第二段。</p></body></html>');
  });
  return Buffer.from(zipSync(files));
}
{
  const r = E.parseEpub(makeEpub({}));
  eq('书名读出来了', r.title, '测试书');
  eq('作者读出来了', r.author, '某作者');
  eq('切出 3 章', r.chapters.length, 3);
  eq('★★ 按 **spine 顺序**（不是 manifest 顺序 ✗）', r.chapters.map((c) => c.title), ['第1章 标题1', '第2章 标题2', '第3章 标题3']);
  ck('★ 章节标题取自 `<h1>`（不是「第 N 节」这种兜底）', /标题1/.test(r.chapters[0].title), r.chapters[0].title);
  ck('正文抽出来了（有段落分隔）', /第 1 章的正文。\n\n第二段。/.test(r.chapters[0].text), JSON.stringify(r.chapters[0].text));
  ck('⚠️ `<title>` 没混进正文里', r.chapters[0].text.indexOf('第1章') < 0 || !/^第1章\s*$/m.test(r.chapters[0].text), r.chapters[0].text.slice(0, 40));
  /* ⚠️ 实测踩到 ✗：`firstHeading()` 从 `<h1>` 取了标题 ✓，而 `htmlToText()` 把**同一个 `<h1>`
     也留在正文第一行** ✗ → 阅读器里标题**显示两遍** ✗（上面 `<h3>` 一个 ✓，正文第一段又一遍 ✗）。 */
  ck('★★ 正文首行**不重复标题**（不然阅读器里标题显示两遍）',
    !/^第1章 标题1\s*$/m.test(r.chapters[0].text) && r.chapters[0].text.indexOf('第1章 标题1') < 0,
    JSON.stringify(r.chapters[0].text.slice(0, 40)));
  ck('  而且正文**没被摘空**（摘完还得有内容）', /这是第 1 章的正文/.test(r.chapters[0].text), JSON.stringify(r.chapters[0].text.slice(0, 40)));
}
{
  /* ⚠️ OPF 在子目录里 ✗ → 正文路径要相对它解析 ✓ */
  const r = E.parseEpub(makeEpub({ opfDir: 'EPUB/pkg', title: '嵌套书' }));
  eq('★ OPF 在子目录时路径也解析对', r.chapters.length, 3);
  ck('  书名也对', r.title === '嵌套书', r.title);
}
{
  /* 整本塞在一个 xhtml 里 ✓ → 要再按标题切 ✓ */
  const files = {};
  files['mimetype'] = strToU8('application/epub+zip');
  files['META-INF/container.xml'] = strToU8('<container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>');
  files['a.opf'] = strToU8('<package><metadata><dc:title>整本一本</dc:title></metadata><manifest>'
    + '<item id="x" href="all.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="x"/></spine></package>');
  const big = [];
  for (let i = 1; i <= 6; i++) big.push('第' + i + '章 标题', '这是第 ' + i + ' 章的正文，'.repeat(300));
  files['all.xhtml'] = strToU8('<html><body><p>' + big.join('</p><p>') + '</p></body></html>');
  const r = E.parseEpub(Buffer.from(zipSync(files)));
  ck('★★ 整本塞一个 xhtml 里 → 会再按标题切（不是一大坨）', r.chapters.length > 1, r.chapters.length + ' 章');
  ck('  切出来的标题是「第N章」那种', /^第\d章/.test(r.chapters[0].title), r.chapters[0].title);
}
console.log('  错误路径要**说人话**（不是抛一个看不懂的栈）');
{
  const bad = () => { try { E.parseEpub(Buffer.from('这根本不是 zip')); return ''; } catch (e) { return e.message; } };
  ck('★ 不是 zip → 明说「不是有效的 EPUB」', /不是有效的 EPUB/.test(bad()), bad());
  const noOpf = () => { try { E.parseEpub(Buffer.from(zipSync({ 'a.txt': strToU8('x') }))); return ''; } catch (e) { return e.message; } };
  ck('★ 没有 opf → 明说找不到 .opf', /找不到 \.opf/.test(noOpf()), noOpf());
  const emptySpine = () => {
    const f = {};
    f['META-INF/container.xml'] = strToU8('<container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>');
    f['a.opf'] = strToU8('<package><metadata><dc:title>x</dc:title></metadata><manifest></manifest><spine></spine></package>');
    try { E.parseEpub(Buffer.from(zipSync(f))); return ''; } catch (e) { return e.message; }
  };
  ck('★ spine 空的 → 明说没找到正文', /没找到正文/.test(emptySpine()), emptySpine());
}

console.log('\n── ⑤ TXT：编码 ──');
{
  const utf8 = Buffer.from('第一章 起\n正文内容。', 'utf8');
  eq('UTF-8 正常读', E.decodeText(utf8).slice(0, 3), '第一章');
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]);
  ck('★ 带 BOM 的 UTF-8（BOM 不能留在正文里）', E.decodeText(bom).charAt(0) === '第', JSON.stringify(E.decodeText(bom).slice(0, 5)));
  /* ⚠️ 中文 TXT 十有八九是 GBK ✗ */
  let gbkOk = true;
  try {
    const gbk = Buffer.from('第一章 起风了\n他站在门口。', 'utf8');
    /* 手工造 GBK 字节：用 iconv 不可用时退回已知字节 ✓ */
    const known = Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]);   /* 「第一章」的 GBK */
    const t = E.decodeText(known);
    ck('★★ GBK 字节解得出来（中文 TXT 十有八九是 GBK）', /第一章/.test(t), JSON.stringify(t));
  } catch (e) { gbkOk = false; ck('★★ GBK 字节解得出来', false, e.message); }
  ck('  这个 Node 带完整 ICU（不带的话上面那条会退化成乱码）',
    (() => { try { new TextDecoder('gb18030'); return true; } catch (_) { return false; } })());
  const r = E.parseTxt(Buffer.from(TXT, 'utf8'), '我的小说.txt');
  eq('★ parseTxt 用文件名当书名（去掉 .txt）', r.title, '我的小说');
  eq('  切出 3 章', r.chapters.length, 3);
  const empty = () => { try { E.parseTxt(Buffer.from('', 'utf8'), 'x.txt'); return ''; } catch (e) { return e.message; } };
  ck('★ 空文件 → 明说「是空的」', /是空的/.test(empty()), empty());
}

/* ── ⑥ 古登堡样板 ★★★ ─────────────────────────────────────────────────────
   ⚠️⚠️ 这一整节都是**拿真实电子书试出来的** ✗ —— 上面那些现造样本
      永远测不到 ✓（`tests/ebook.js` 第一版就是只有现造样本 ✓）。
   做法：从 gutenberg.org 下 16 本公版书 ✓（EPUB ✓）逐本跑一遍 ✓，看输出哪里不对 ✓。
   实测撞出来的三件事，每一件都**推翻了我原本的直觉** ✗：
     ① 样板**不是一小段** —— **1.8 万 ~ 3 万字** ✗（比很多书正文都长 ✓）
        → 「短就丢」是**错的** ✗
     ② 目录页每一行都是「CHAPTER N」→ 被切成**一长串 0 字的空章** ✗
        （白鲸 241 章里 **135 个是空的** ✗）
     ③ 署名 `Produced by …` 在 **START 标记之后** ✗ → 按标记切**切不掉** ✗
        （中文那几本的首章第一行全是英文署名 ✗） */
console.log('\n── ⑥ 古登堡样板（真实电子书才试得出来）──');
{
  const BOOK = '書名';
  const START = '*** START OF THE PROJECT GUTENBERG EBOOK ' + BOOK + ' ***';
  const END = '*** END OF THE PROJECT GUTENBERG EBOOK ' + BOOK + ' ***';
  const LICENSE = 'This eBook is for the use of anyone anywhere in the United States and most other parts of '
    + 'the world at no cost and with almost no restrictions whatsoever.\n\n'
    + 'Updated editions will replace the previous one—the old editions will be renamed.\n\n'
    + 'Most people start at our website which has the main PG search facility: www.gutenberg.org\n\n'
    + '1.E.1. The following sentence, with active links to, or other immediate access to, the full Project '
    + 'Gutenberg™ License must appear prominently whenever any copy of a Project Gutenberg™ work is accessed.\n\n';
  /* 样板比正文长 —— 故意造得夸张一点，防止有人以后又拿长度当判据 ✗ */
  const NOISE = LICENSE.repeat(40);

  ck('★ 样板本身够长（故意造得比正文长，防止有人用「短就丢」）', NOISE.length > 8000, String(NOISE.length));
  const s1 = E.stripPg(NOISE + START + '\nProduced by 某某\n\n' + '正文内容。'.repeat(200) + '\n\n' + END + '\n' + LICENSE);
  ck('★★ 只留 START / END 之间（前后都切掉）', s1.indexOf('gutenberg.org') < 0 && /正文内容/.test(s1), JSON.stringify(s1.slice(0, 40)));
  ck('★★ 连 START 后面那行「Produced by …」署名也剥掉', s1.indexOf('Produced by') < 0, JSON.stringify(s1.slice(0, 40)));
  ck('  剥完是从正文开始的', s1.indexOf('正文内容') === 0, JSON.stringify(s1.slice(0, 30)));
  ck('★ 纯样板页剥完变成空（调用方据此丢掉它）', E.stripPg(NOISE + START + '\n' + LICENSE) === '', JSON.stringify(E.stripPg(NOISE + START + '\n' + LICENSE).slice(0, 30)));
  ck('★ 结尾那行页脚也剥（`End of Project Gutenberg\'s …`）',
    E.stripPg('正文。\n\nEnd of Project Gutenberg\'s 書名, by 作者') === '正文。',
    JSON.stringify(E.stripPg('正文。\n\nEnd of Project Gutenberg\'s 書名, by 作者')));
  /* ⚠️ 没有标记的老书 → 保守兜底：只在「这一段基本就是样板」时才丢 ✗ */
  ck('★ 没标记 + 整段是样板 → 丢掉', E.stripPg(NOISE) === '', String(E.stripPg(NOISE).length));
  ck('★★ 没标记 + 正文里**提了一句** Gutenberg → **不丢**（不能误伤正文）',
    /这是正文/.test(E.stripPg('这是正文。\n\n' + '他写了很多字。'.repeat(60) + '\n\n参见 www.gutenberg.org 上的说明。\n\n又写了很多字。'.repeat(20))),
    '');
  /* ⚠️ 样板 `<title>` 不能当章名 ✗（不然整本书每章都同名 ✗） */
  ck('★ 样板 `<title>` 不当章名（不然 26 章全同名）',
    E.firstHeading('<html><head><title>The Project Gutenberg eBook of 三國志演義</title></head><body></body></html>') === '',
    JSON.stringify(E.firstHeading('<html><head><title>The Project Gutenberg eBook of 三國志演義</title></head><body></body></html>')));
  ck('  正常 `<title>` 照样能用', E.firstHeading('<head><title>一本书</title></head>') === '一本书');

  /* ★★ 目录页：每一行都是「CHAPTER N」→ **绝不能切成 135 个空章** ✗✗ */
  const toc = [];
  for (let i = 1; i <= 60; i++) toc.push('CHAPTER ' + i + '. 标题' + i + '.');
  const tocBook = E.chapterize(toc.join('\n'), '书');
  ck('  目录页本身确实会被切成 60 个「章」（这就是那个坑的成因）', tocBook.length === 60, String(tocBook.length));
  ck('★★ 但它们**全是空章** → 一个都不该留下', E.refineChapters([{ title: '正文', text: toc.join('\n') }]).length === 1,
    String(E.refineChapters([{ title: '正文', text: toc.join('\n') }]).length));

  /* ★ 一章里塞了 5 回 → 要切开 ✓ */
  const wu = [];
  for (let i = 1; i <= 5; i++) wu.push('第' + i + '回 标题' + i, '这一回的正文。'.repeat(30));
  const split = E.refineChapters([{ title: '卷之一', text: wu.join('\n\n') }]);
  eq('★★ 一章塞 5 回 → 切成 5 章', split.length, 5);
  ck('  切出来的章名是回目', /^第1回/.test(split[0].title), split[0].title);
  ck('  而且**没丢内容**（每回都有正文）', split.every((c) => /这一回的正文/.test(c.text)), '');
  /* ⚠️ 只提一句「第二章」**不能**切 ✗（门槛 ≥3 就是为这个） */
  eq('★★ 正文里只顺口提一句「第二章」→ 不切（门槛 ≥3 挡住误伤）',
    E.refineChapters([{ title: '一章', text: '正文。\n\n详见第二章。\n\n又一段正文。' }]).length, 1);
}

console.log('\n电子书解析：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败 ✗' : ' ✓'));
if (fails.length) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
