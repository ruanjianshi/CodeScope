/* 外刊源目录 + Feed 解析（lib/en-sources.js）—— 纯单测 ✓，不联网 ✓、不起服务 ✓。
   ⚠️ 这里一半的断言在打**同一个坑** ✗：
       「Atom 的 <feed> 顶上有个指向**首页**的 <link>」✗ ——
       按「整份 XML 里找第一个 <link>」写 ✗ → 抓回来的「最新文章」全是站点首页 ✗，
       而且首页文字多 → 正文抽取还会「成功」✗ → **假通过** ✗✗（我第一版就栽了 ✗）。
   另一半在打**目录数据本身**的完整性 ✓（漏了字段 UI 会画出一片空白 ✗）。 */
const S = require('../lib/en-sources.js');

let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; } else { fails.push(n + (x ? '  → ' + x : '')); console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
const eq = (n, a, b) => ck(n, JSON.stringify(a) === JSON.stringify(b), '得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));

console.log('── ① 源目录：结构完整性 ──');
const cat = S.catalog();
ck('目录不是空的', cat.length >= 15, cat.length + ' 个');
ck('每个源都有 key / 名字 / 分组 / 图标', cat.every((x) => x.key && x.name && x.group && x.icon));
ck('每个源都有难度标注', cat.every((x) => x.lv), cat.filter((x) => !x.lv).map((x) => x.key).join(','));
ck('每个源都有「一句话说明」', cat.every((x) => x.d && x.d.length > 10), cat.filter((x) => !x.d || x.d.length <= 10).map((x) => x.key).join(','));
ck('每个源都有主页链接', cat.every((x) => /^https:\/\//.test(x.home || '')), cat.filter((x) => !/^https:\/\//.test(x.home || '')).map((x) => x.key).join(','));
ck('key 没有重复', new Set(cat.map((x) => x.key)).size === cat.length);
ck('每个源的分组都在 GROUPS 里（不然 UI 上会「查不到这个组」）',
  cat.every((x) => S.GROUPS.indexOf(x.group) >= 0),
  cat.filter((x) => S.GROUPS.indexOf(x.group) < 0).map((x) => x.key + ':' + x.group).join(','));
ck('每个分组的 ttl 都是正数', Object.keys(S.READ_SOURCES).every((k) => S.READ_SOURCES[k].ttl > 0));
/* ⚠️ 源地址**必须是 https** ✗ —— 明文 http 会被中间人改内容 ✗，而且不少站会 301 掉 ✗ */
ck('每个 feed 都是 https', Object.keys(S.READ_SOURCES).every((k) => /^https:\/\//.test(S.READ_SOURCES[k].feed)),
  Object.keys(S.READ_SOURCES).filter((k) => !/^https:\/\//.test(S.READ_SOURCES[k].feed)).join(','));
/* ⚠️ 每个分组**至少有一个源** ✗ —— 空分组会在 UI 上留一个点不开的标题 ✗ */
ck('每个分组都有源（没有空分组）',
  S.GROUPS.every((g) => cat.some((x) => x.group === g)),
  S.GROUPS.filter((g) => !cat.some((x) => x.group === g)).join(','));

console.log('\n── ② Feed 解析：RSS 2.0 ──');
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Example Site</title>
<link>https://example.com/</link>
<description>the site</description>
<item>
  <title>First real article</title>
  <link>https://example.com/first</link>
  <description><![CDATA[<p>Some <b>html</b> summary</p>]]></description>
  <pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate>
</item>
<item>
  <title>Second &amp; newer</title>
  <link>https://example.com/second</link>
  <pubDate>Wed, 07 Oct 2026 10:00:00 GMT</pubDate>
</item>
</channel></rss>`;
const r1 = S.parseFeed(RSS);
eq('解析出 2 条', r1.length, 2);
eq('★ 取的是**条目**里的链接，不是 channel 的首页', r1.map((x) => x.url), ['https://example.com/second', 'https://example.com/first']);
ck('★ 结果里**没有**站点首页（这是那个坑的正面断言）', r1.every((x) => x.url !== 'https://example.com/'), JSON.stringify(r1.map((x) => x.url)));
eq('标题解了实体', r1[0].title, 'Second & newer');
eq('description 去了标签 + CDATA', r1[1].desc, 'Some html summary');
ck('按日期倒序（新的在前）', r1[0].ts > r1[1].ts);

console.log('\n── ③ Feed 解析：Atom（**最容易栽的那种**）──');
/* ⚠️ 这个样本是照 Aeon / WIRED / Quanta 的真实结构造的 ✗：
   <feed> 顶上先来一个 rel="alternate" 指向**首页** ✗，然后才是各 <entry> ✗。 */
const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Aeon</title>
  <link rel="alternate" type="text/html" href="https://aeon.co/"/>
  <link rel="self" type="application/atom+xml" href="https://aeon.co/feed.rss"/>
  <entry>
    <title>A real Aeon essay</title>
    <link rel="alternate" type="text/html" href="https://aeon.co/essays/a-real-essay"/>
    <updated>2026-10-07T08:00:00Z</updated>
    <summary>An essay about something.</summary>
  </entry>
  <entry>
    <title>Another one</title>
    <link rel="alternate" type="text/html" href="https://aeon.co/essays/another"/>
    <updated>2026-10-06T08:00:00Z</updated>
  </entry>
</feed>`;
const r2 = S.parseFeed(ATOM);
eq('解析出 2 条（**不是** 3 条 —— feed 自己那个 link 不算条目）', r2.length, 2);
eq('★★ 拿的是 entry 里的链接，不是 feed 的首页', r2.map((x) => x.url), ['https://aeon.co/essays/a-real-essay', 'https://aeon.co/essays/another']);
ck('★★ 首页 https://aeon.co/ **不在**结果里（第一版就是全抓成它 ✗）', r2.every((x) => x.url !== 'https://aeon.co/'), JSON.stringify(r2.map((x) => x.url)));
ck('★ self 那条（指向 feed 自己的）也没混进来', r2.every((x) => x.url.indexOf('feed.rss') < 0));
eq('Atom 的 title 也解出来了', r2[0].title, 'A real Aeon essay');
ck('Atom 的 updated 解析成时间了', r2[0].ts > 0, String(r2[0].ts));

console.log('\n── ④ 过滤：栏目页 / 标签页 / 作者页**不是文章** ──');
const MIX = `<rss><channel>
<item><title>Good</title><link>https://x.com/posts/good</link></item>
<item><title>Tag page</title><link>https://x.com/tag/ai</link></item>
<item><title>Category</title><link>https://x.com/category/news</link></item>
<item><title>Author</title><link>https://x.com/author/bob</link></item>
<item><title>Topic</title><link>https://x.com/topics/energy</link></item>
<item><title>Also good</title><link>https://x.com/posts/also</link></item>
</channel></rss>`;
const r3 = S.parseFeed(MIX);
eq('栏目/标签/作者/主题页被滤掉了，只剩真文章', r3.map((x) => x.title), ['Good', 'Also good']);
ck('（这些页点开是「一列文章」，不是文章本身 ✗）', r3.every((x) => /\/posts\//.test(x.url)));

console.log('\n── ⑤ 去重 / 脏数据 ──');
const DUP = `<rss><channel>
<item><title>A</title><link>https://x.com/a</link></item>
<item><title>A 又发了一遍</title><link>https://x.com/a</link></item>
<item><title>没链接</title></item>
<item><title></title><link>https://x.com/b</link></item>
<item><title>相对链接</title><link>/relative/path</link></item>
</channel></rss>`;
const r4 = S.parseFeed(DUP);
eq('同链接只留一条；没链接/没标题/相对链接全丢', r4.length, 1);
eq('留下的是第一条', r4[0].title, 'A');
ck('空输入不炸', S.parseFeed('').length === 0 && S.parseFeed(null).length === 0 && S.parseFeed(undefined).length === 0);
ck('不是 feed 的 HTML 也不炸', S.parseFeed('<html><body><p>hi</p></body></html>').length === 0);
ck('超大垃圾输入不炸（不会卡死）', S.parseFeed('<item>'.repeat(2000)).length === 0);

console.log('\n── ⑥ 文本清洗 ──');
eq('stripTags 去标签', S.stripTags('<p>a <b>b</b></p>').replace(/\s+/g, ' ').trim(), 'a b');
eq('clean 解实体 + 收空白', S.clean('  a &amp;  b  '), 'a & b');
eq('clean 去掉 CDATA 包裹', S.clean('<![CDATA[hello]]>'), 'hello');
eq('clean 处理 &#8217;（撇号）', S.clean('don&#8217;t'), 'don\u2019t');
eq('clean 处理 &hellip;', S.clean('a &hellip; b'), 'a \u2026 b');
ck('clean(null) 不炸', S.clean(null) === '');

console.log('\n── ⑦ 开源资源清单 ──');
const os = S.OS_RESOURCES;
ck('清单不是空的', os.length >= 6, os.length + ' 个');
ck('每项都有仓库名 / 作者 / 链接 / 分类 / 说明',
  os.every((x) => x.repo && x.n && x.by && x.url && x.tag && x.what && x.what.length > 8),
  os.filter((x) => !(x.repo && x.n && x.by && x.url && x.tag && x.what)).map((x) => x.n || '?').join(','));
ck('链接都是 GitHub 仓库页', os.every((x) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(x.url)),
  os.filter((x) => !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(x.url)).map((x) => x.url).join(','));
/* ⚠️ url **必须**由 repo 拼出来 ✗ —— 手写 url 的话，改仓库名时会漏改一处 ✗，
   用户点开就是 404 ✗ 而自己看不出来 ✗（实测：显示名和仓库名不一样时就露馅了 ✓）。 */
ck('url 和 repo 对得上（防手抖写串）',
  os.every((x) => x.url.toLowerCase() === ('https://github.com/' + x.repo).toLowerCase()),
  os.filter((x) => x.url.toLowerCase() !== ('https://github.com/' + x.repo).toLowerCase()).map((x) => x.url).join(','));
ck('repo 的「作者」段和 by 一致',
  os.every((x) => x.repo.split('/')[0].toLowerCase() === String(x.by).toLowerCase()),
  os.filter((x) => x.repo.split('/')[0].toLowerCase() !== String(x.by).toLowerCase()).map((x) => x.repo).join(','));
ck('key 没有重复', new Set(os.map((x) => x.key)).size === os.length);
ck('★ 收了归档类资源就必须带版权提示（不能装作没这回事）',
  os.filter((x) => x.tag === '杂志归档').every((x) => x.warn && /版权/.test(x.warn)),
  os.filter((x) => x.tag === '杂志归档' && !(x.warn && /版权/.test(x.warn))).map((x) => x.n).join(','));
ck('★ 非归档项不硬塞提示（warn 可以为空）', os.filter((x) => x.tag !== '杂志归档').every((x) => x.warn === undefined || x.warn === ''));

/* ⚠️⚠️ 面板**不渲染 markdown** ✗✗ —— 文案里写 **粗体** 会**原样显示**成
   「**版权归原刊**」✗（实测：截图上就是这么显示的 ✗，我写的时候完全没意识到 ✗）。
   这条项目里早就写过 ✗，但一直没有强制 ✗ → 这里补上闸门 ✓。 */
console.log('\n── ⑦b 用户可见文案里不能有 markdown 粗体 ──');
const mdBad = [];
S.catalog().forEach((x) => { ['name', 'd', 'lv'].forEach((k) => { if (/\*\*/.test(String(x[k] || ''))) mdBad.push(x.key + '.' + k); }); });
os.forEach((x) => { ['n', 'what', 'warn', 'tag', 'lv'].forEach((k) => { if (/\*\*/.test(String(x[k] || ''))) mdBad.push(x.key + '.' + k); }); });
ck('★ 源目录 + 开源资源里没有 ** 粗体', mdBad.length === 0, mdBad.join(', '));
/* ⚠️ 顺手守一下别的「看着像 markdown 但渲染不出来」的写法 ✗ */
const mdBad2 = [];
S.catalog().forEach((x) => { if (/`/.test(String(x.d || ''))) mdBad2.push('d:' + x.key); });
os.forEach((x) => { if (/`/.test(String(x.what || '') + String(x.warn || ''))) mdBad2.push(x.key); });
ck('★ 也没有反引号（同样是原样显示）', mdBad2.length === 0, mdBad2.join(', '));

console.log('\n── ⑧ 不认识的源要**明确报错**，不能静默返回空 ──');
(async () => {
  const bad = await S.fetchSource('不存在的源', { fetch: async () => ({ ok: true, text: async () => '<rss/>' }) });
  ck('ok=false 且给出原因', bad.ok === false && /不认识的源/.test(bad.error || ''), JSON.stringify(bad.error));
  eq('items 是空数组（不是 undefined）', bad.items, []);

  /* 注入一个假 fetch：验证「feed 拿到但没条目」也会报错，而不是静默成功 ✗ */
  const empty = await S.fetchSource('aeon', { fetch: async () => ({ ok: true, text: async () => '<rss><channel></channel></rss>' }) });
  ck('★ feed 里没条目 → 报错（不是 ok=true + 空列表）', empty.ok === false && /没解析出条目/.test(empty.error || ''), JSON.stringify(empty.error));

  const http500 = await S.fetchSource('aeon', { fetch: async () => ({ ok: false, status: 500, text: async () => 'boom' }) });
  ck('HTTP 非 2xx → 报错里带状态码', http500.ok === false && /500/.test(http500.error || ''), JSON.stringify(http500.error));

  /* 正常路径：假 fetch 给一份真样本 → 要能出条目 + 走缓存 */
  let calls = 0;
  const fake = async () => { calls++; return { ok: true, text: async () => ATOM }; };
  const a = await S.fetchSource('aeon', { fetch: fake, force: true });
  ck('假 fetch 能拿到条目', a.ok === true && a.items.length === 2, JSON.stringify(a.items && a.items.length));
  ck('带上源的名字/分组/难度（前端要显示）', a.name === 'Aeon' && a.group === '思想' && !!a.lv);
  const b = await S.fetchSource('aeon', { fetch: fake });
  ck('★ 第二次走缓存（没再打一次网络）', calls === 1 && b.cached === true, 'calls=' + calls + ' cached=' + b.cached);
  const c = await S.fetchSource('aeon', { fetch: fake, force: true });
  ck('force=1 会绕过缓存', calls === 2 && c.cached === false, 'calls=' + calls);

  console.log('\n外刊源：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败 ✗' : ' ✓'));
  if (fails.length) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
})();
