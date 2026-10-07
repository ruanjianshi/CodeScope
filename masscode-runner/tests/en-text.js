/* 英文文本处理（lib/en-text.js）—— 纯单测 ✓，不联网 ✓、不起服务 ✓。
   ⚠️ 分句那个函数的坑**全在缩写和小数上** ✗ —— 所以这里一半的断言都在打这些 ✗。 */
const E = require('../lib/en-text.js');

let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; } else { fails.push(n + (x ? '  → ' + x : '')); console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
const eq = (n, a, b) => ck(n, JSON.stringify(a) === JSON.stringify(b), '得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));

console.log('── ① 实体 / 取文本 ──');
ck('解实体 &amp; &lt; &#39;', E.unescapeEntities('a &amp; b &lt;c&gt; &#39;d&#39;') === "a & b <c> 'd'", E.unescapeEntities('a &amp; b &lt;c&gt; &#39;d&#39;'));
ck('数字实体 &#8212;', E.unescapeEntities('a&#8212;b') === 'a—b', E.unescapeEntities('a&#8212;b'));
ck('十六进制实体', E.unescapeEntities('a&#x2014;b') === 'a—b', E.unescapeEntities('a&#x2014;b'));
ck('textOf 去标签 + 收空白', E.textOf('<p>a   <b>b</b>\n c</p>') === 'a b c', E.textOf('<p>a   <b>b</b>\n c</p>'));
ck('不认识的实体原样留着', E.unescapeEntities('&foo;') === '&foo;', E.unescapeEntities('&foo;'));

console.log('\n── ② 分句：基本 ──');
eq('两句', E.splitSentences('Hello world. This is a test.').map((s) => s.text), ['Hello world.', 'This is a test.']);
eq('问号 + 感叹号', E.splitSentences('Who? Me! Yes.').map((s) => s.text), ['Who?', 'Me!', 'Yes.']);
eq('末尾没标点也要成句', E.splitSentences('First one. And a tail without period').map((s) => s.text), ['First one.', 'And a tail without period']);
ck('空串 → 空数组', E.splitSentences('').length === 0);
ck('null 不炸', E.splitSentences(null).length === 0);

console.log('\n── ③ 分句：缩写**不能**切开（这是最容易错的地方）──');
eq('Mr.', E.splitSentences('Mr. Smith went to Washington. He liked it.').map((s) => s.text),
  ['Mr. Smith went to Washington.', 'He liked it.']);
eq('Dr. + U.S.', E.splitSentences('Dr. Jane Smith works at the U.S. Geological Survey. She is busy.').map((s) => s.text),
  ['Dr. Jane Smith works at the U.S. Geological Survey.', 'She is busy.']);
eq('e.g. / i.e.', E.splitSentences('Use a tool, e.g. a hammer. It helps.').map((s) => s.text),
  ['Use a tool, e.g. a hammer.', 'It helps.']);
eq('a.m. / p.m.', E.splitSentences('The meeting is at 9 a.m. tomorrow. Do not be late.').map((s) => s.text),
  ['The meeting is at 9 a.m. tomorrow.', 'Do not be late.']);
eq('人名首字母 J. Smith', E.splitSentences('The author, J. Smith, wrote it. It sold well.').map((s) => s.text),
  ['The author, J. Smith, wrote it.', 'It sold well.']);
eq('月份缩写 Oct.', E.splitSentences('It happened on Oct. 7, 2026. Nobody knew.').map((s) => s.text),
  ['It happened on Oct. 7, 2026.', 'Nobody knew.']);

console.log('\n── ④ 分句：小数点**不能**切开 ──');
eq('$3.5 million', E.splitSentences('He paid $3.5 million for it. That is a lot.').map((s) => s.text),
  ['He paid $3.5 million for it.', 'That is a lot.']);
eq('3.5 没美元符号', E.splitSentences('About 3.5 million people came. It was crowded.').map((s) => s.text),
  ['About 3.5 million people came.', 'It was crowded.']);

console.log('\n── ⑤ 分句：引号 / 段落 ──');
eq('句末引号要跟着', E.splitSentences('"We are seeing it now," she said. Then she left.').map((s) => s.text),
  ['"We are seeing it now," she said.', 'Then she left.']);
const multi = E.splitSentences('First para one. First para two.\n\nSecond para one.');
eq('段落索引', multi.map((s) => s.para), [0, 0, 2]);
ck('空行不产生句子', multi.length === 3, String(multi.length));
eq('splitParagraphs', E.splitParagraphs('a\n\n  b  \nc'), ['a', 'b', 'c']);

console.log('\n── ⑥ 洗词 / 取词 ──');
eq('去逗号', E.cleanWord('Word,'), 'word');
eq('弯引号统一成直引号', E.cleanWord('don\u2019t'), "don't");
eq('去首尾引号', E.cleanWord('"quoted"'), 'quoted');
eq('U.S. → u.s', E.cleanWord('U.S.'), 'u.s');
eq('保留连字符', E.cleanWord('well-known'), 'well-known');
eq('空 → 空', E.cleanWord('...'), '');
eq('取词', E.tokenizeWords('The quick, brown fox!'), ['the', 'quick', 'brown', 'fox']);
eq('取词可去停用词', E.tokenizeWords('The quick brown fox', { dropStop: true }), ['quick', 'brown', 'fox']);
ck('countWords', E.countWords('one two three') === 3, String(E.countWords('one two three')));
ck('readingMinutes 最少 1 分钟', E.readingMinutes(10) === 1, String(E.readingMinutes(10)));
ck('readingMinutes 400 词 → 2 分钟', E.readingMinutes(400) === 2, String(E.readingMinutes(400)));

console.log('\n── ⑦ 难度估算 ──');
ck('太短 → 不给级（别硬猜）', E.levelOf('Too short.') === '', E.levelOf('Too short.'));
const easy = 'I like my cat. The cat is big. It sits on the mat. We play all day. The sun is warm. I am happy. We go home. It is fun. '.repeat(3);
const hard = 'Notwithstanding the ostensibly heterogeneous methodological underpinnings, the epistemological ramifications necessitate a comprehensive reconsideration of prevailing assumptions. '.repeat(4);
const lvEasy = E.levelOf(easy), lvHard = E.levelOf(hard);
ck('简单文本 → A2/B1', lvEasy === 'A2' || lvEasy === 'B1', lvEasy);
ck('难文本 → B2/C1', lvHard === 'B2' || lvHard === 'C1', lvHard);
ck('难的级 >= 易的级', 'A2 B1 B2 C1'.split(' ').indexOf(lvHard) >= 'A2 B1 B2 C1'.split(' ').indexOf(lvEasy), lvEasy + ' → ' + lvHard);

console.log('\n── ⑧ 抽正文：合成页（导航 / 图注 / 链接堆 / 页脚都要挡掉）──');
const PAGE = [
  '<!doctype html><html><head>',
  '<title>How the seas rose | Example News</title>',
  '<meta property="og:title" content="How the seas rose"/>',
  '<script>var x = "<p>FAKE PARAGRAPH FROM SCRIPT THAT MUST NEVER APPEAR</p>";</script>',
  '<style>p{color:red}</style>',
  '</head><body>',
  '<nav><p><a href="/a">Home</a> <a href="/b">World</a> <a href="/c">Business</a> <a href="/d">Sport</a> <a href="/e">Culture</a></p></nav>',
  '<header><p>Skip to main content</p></header>',
  '<article>',
  '<p>Photo by Jane Doe/Reuters</p>',
  '<p>The world oceans rose faster in the past decade than at any time since records began, according to a study published on Wednesday.</p>',
  '<p>Researchers said the acceleration was driven mainly by melting ice in Greenland and Antarctica.</p>',
  '<p>Read more</p>',
  '<p><a href="/1">Related</a>: <a href="/2">Sea levels</a> <a href="/3">Climate</a> <a href="/4">Greenland</a> <a href="/5">Antarctica</a> <a href="/6">Oceans</a></p>',
  '<p>"We are seeing the consequences now," said one of the authors, Dr. Jane Smith, who works at the U.S. Geological Survey.</p>',
  '<p>The team used satellite measurements going back to 1993, covering about 3.5 million observations.</p>',
  '</article>',
  '<footer><p><a href="/x">Privacy policy</a> <a href="/y">Terms of use</a> <a href="/z">Contact us</a></p></footer>',
  '</body></html>',
].join('\n');
const art = E.extractArticle(PAGE, 'https://www.example.com/news/how-the-seas-rose');
ck('抽出来了', art.ok === true, art.error);
ck('★ script 里的假段落没混进来', art.text.indexOf('FAKE PARAGRAPH') < 0, art.text.slice(0, 80));
ck('★ 导航段没混进来', art.text.indexOf('Skip to main content') < 0);
ck('★ 图注（Photo by）没混进来', art.text.indexOf('Photo by') < 0, art.text.slice(0, 80));
ck('★ 链接堆（Related: …）没混进来', art.text.indexOf('Related') < 0, art.text.slice(0, 120));
ck('★ 页脚没混进来', art.text.indexOf('Privacy policy') < 0);
ck('★ 正文段落都在', art.text.indexOf('oceans rose faster') > 0 && art.text.indexOf('satellite measurements') > 0);
ck('段数 = 4（图注和链接堆都被挡了）', art.paras === 4, String(art.paras) + ' · ' + JSON.stringify(art.text.split('\n\n').map((s) => s.slice(0, 26))));
ck('★ 用了 <article> 这条级联', art.via === 'article', art.via);
eq('标题去掉了站名尾巴', art.title, 'How the seas rose');
eq('站点名', art.site, 'example.com');
ck('词数算出来了', art.words > 60, String(art.words));
ck('难度给了级', !!art.level, art.level);
ck('分句后能拿到句子', E.splitSentences(art.text).length >= 4, String(E.splitSentences(art.text).length));

console.log('\n── ⑨ 抽正文：级联与兜底 ──');
const NO_ARTICLE = '<html><head><title>Fallback Page</title></head><body><div id="content">'
  + '<p>This paragraph is long enough to count as body text for the extractor to keep it around safely.</p>'
  + '<p>A second paragraph also long enough, so the fallback rule with three paragraphs can trigger properly.</p>'
  + '<p>And a third one, which is what makes the container worth choosing over the rest of the document.</p>'
  + '</div></body></html>';
const fb = E.extractArticle(NO_ARTICLE, 'https://x.test/p');
ck('★ 没有 article/main 时走 id=content 兜底', fb.ok && fb.paras === 3, JSON.stringify({ ok: fb.ok, n: fb.paras, via: fb.via }));
const DYN = '<html><head><title>App</title></head><body><div id="root"></div><script>render()</script></body></html>';
const dy = E.extractArticle(DYN, 'https://app.test/');
ck('★ 动态页抽不出 → ok:false', dy.ok === false, String(dy.ok));
ck('★ 并且给了一句能照着做的话', /复制正文粘进来/.test(dy.error), dy.error);
ck('空 HTML 不炸', E.extractArticle('', 'https://x.test/').ok === false);
ck('null 不炸', E.extractArticle(null, '').ok === false);
const notUrl = E.extractArticle(PAGE, 'not-a-url');
ck('URL 不合法时 site 留空、不炸', notUrl.site === '' && notUrl.ok === true, notUrl.site);

console.log('\n英文文本处理：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败 ✗' : ' ✓'));
if (fails.length) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
