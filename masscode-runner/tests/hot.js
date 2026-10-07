#!/usr/bin/env node
'use strict';

/* ── 热榜聚合的解析回归 ──────────────────────────────────────────────────
   ★ 用**录下来的真实响应形状**当夹具 ✓ —— 不联网 ✓、不依赖上游还活着 ✓。
     （真联网的验证放在 tests/life-trends.js 那个端到端探针里 ✓。）
   ★ 每个源的**字段路径**都是照着真实响应抄的 ✓（见 lib/hot.js 顶部注释 ✓）——
     上游改结构时，这个测试会**立刻**告诉你哪一条断了 ✓。
   ────────────────────────────────────────────────────────────────────── */

const H = require('../lib/hot.js');

let passed = 0, failed = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { console.log('  ✓ ' + name); passed++; }
  else { console.log('  ✗ ' + name + '\n      实际 ' + a + '\n      期望 ' + b); failed++; }
};
const ok = (name, cond, extra) => {
  if (cond) { console.log('  ✓ ' + name); passed++; }
  else { console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); failed++; }
};

/* ── 夹具：真实响应形状（截取到够验解析就行 ✓）── */
const FIX = {
  'api.bilibili.com/x/web-interface/popular': { code: 0, data: { list: [{ aid: 117388754290678, bvid: 'BV1xx', title: '反向旅游 陕西铜川！', tname: '出行', owner: { name: 'UP主A' }, stat: { view: 1234567, like: 9999 } }] } },
  'iesdouyin.com': { status_code: 0, word_list: [{ word: '国庆高速免费将在今日24时截止', hot_value: 12416461, label: 3 }] },
  'weibo.com/ajax/side/hotSearch': { ok: 1, data: { realtime: [{ word: '为什么学校不统一打印作业', note: '为什么学校不统一打印作业', word_scheme: '#为什么学校不统一打印作业#', num: 1132697, label_name: '新' }] } },
  'top.baidu.com': { success: true, data: { cards: [{ content: [{ content: [{ isTop: true, word: '总书记反复提及一位红军师长', url: 'https://m.baidu.com/s?word=x' }] }] }] } },
  'trending/ranking': { code: 0, data: { list: [{ position: 1, keyword: 'NRG T1', show_name: 'NRG vs T1 上海冠军赛', hot_id: 275960 }] } },
  'article_rank': { err_no: 0, data: [{ content: { content_id: '7692440533922971667', title: '副业搞起来' }, content_counter: { view: 52000, hot_rank: 100 }, author: { name: '作者A' } }] },
  'topstories.json': [101, 102],
  'hacker-news.firebaseio.com/v0/item/101.json': { id: 101, by: 'someone', title: 'Sharing AI progress in mathematics', url: 'https://example.test/a', score: 321, descendants: 88, time: 1790000000 },
  'hacker-news.firebaseio.com/v0/item/102.json': { id: 102, by: 'other', title: 'Ask HN: something', score: 12, descendants: 3 },
  'api.github.com/search/repositories': { total_count: 1, items: [{ full_name: 'openai/math', html_url: 'https://github.com/openai/math', description: 'A math repo', stargazers_count: 4567, language: 'Python' }] },
  'sspai.com': { error: 0, data: [{ id: 114845, title: '罗马：永恒之城，永恒于世', summary: '摘要……', like_count: 3, comment_count: 1 }] },
  'api.openalex.org/works': { results: [{ id: 'https://openalex.org/W4226369673', doi: 'https://doi.org/10.1/x', display_name: 'Hub genes in a pan-cancer network', publication_date: '2026-09-20', cited_by_count: 7, primary_location: { source: { display_name: 'Nature' } } }] },
};
const ARXIV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <id>http://arxiv.org/abs/2610.08789v1</id>
  <updated>2026-10-06T17:59:34Z</updated>
  <title>QF3: Fast Flow RL with Filtered Q-Gradients</title>
  <summary>Flow policies have become a standard...</summary>
  <author><name>Alice Zhang</name></author>
  <link href="https://arxiv.org/abs/2610.08789v1" rel="alternate" type="text/html"/>
</entry>
<entry>
  <id>http://arxiv.org/abs/2610.08790v1</id>
  <updated>2026-10-06T18:01:00Z</updated>
  <title>Another Robot Paper</title>
  <author><name>Bob Li</name></author>
  <link href="https://arxiv.org/abs/2610.08790v1" rel="alternate" type="text/html"/>
</entry>
</feed>`;

/* 假 fetch：按 URL 片段挑夹具 ✓；没录到的就 404 ✓（好发现「偷偷加了新源却没录夹具」✗）*/
function fakeFetch(url) {
  const u = String(url);
  if (u.indexOf('export.arxiv.org') >= 0) {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ARXIV_XML) });
  }
  const keys = Object.keys(FIX).sort((a, b) => b.length - a.length);
  const hit = keys.find((k) => u.indexOf(k) >= 0);
  if (!hit) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('没录到夹具：' + u.slice(0, 80)) });
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(FIX[hit])) });
}

(async () => {
  console.log('热榜聚合\n');

  console.log('── ① 工具函数 ──');
  eq('去标签 + 解码实体', H.clean('<b>a</b> &amp; b'), 'a & b');
  eq('空白折叠', H.clean('  a\n\n  b  '), 'a b');
  eq('万位缩写', H.hotText(12416461), '1241.6万');
  eq('万位以下原样', H.hotText(999), '999');
  eq('整数不拖小数', H.hotText(20000), '2万');

  console.log('\n── ② 源目录 ──');
  const cat = H.catalog();
  eq('11 个源', cat.length, 11);
  ok('每个源都有 name/group/icon', cat.every((c) => c.name && c.group && c.icon));
  ok('覆盖了视频 / 社交 / 搜索 / 技术 / 开源 / 学术 / 资讯',
    ['视频', '社交', '搜索', '技术', '开源', '学术', '资讯'].every((g) => cat.some((c) => c.group === g)),
    JSON.stringify([...new Set(cat.map((c) => c.group))]));
  ok('★ 有抖音（用户点名要的）', cat.some((c) => c.key === 'douyin'));
  ok('★ 有前沿论文源（arXiv + OpenAlex）', cat.some((c) => c.key === 'arxiv') && cat.some((c) => c.key === 'openalex'));

  console.log('\n── ③ 逐源解析（用真实响应形状的夹具）──');
  H.clearCache();
  const r = await H.fetchMany(null, { fetch: fakeFetch, force: true });
  const by = Object.fromEntries(r.results.map((x) => [x.key, x]));
  for (const x of r.results) {
    ok(x.name + ' 解析出条目', x.ok && x.items.length > 0, x.error || '0 条');
  }
  eq('★ 11 个源全部成功', r.results.filter((x) => x.ok && x.items.length).length, 11);

  console.log('\n── ④ 字段抽查（最容易写错的那几个）──');
  eq('B站：标题 / 播放量', [by.bili.items[0].title, by.bili.items[0].hot], ['反向旅游 陕西铜川！', 1234567]);
  eq('B站：链接用的是 bvid', by.bili.items[0].url, 'https://www.bilibili.com/video/BV1xx');
  eq('抖音：词 / 热度', [by.douyin.items[0].title, by.douyin.items[0].hot], ['国庆高速免费将在今日24时截止', 12416461]);
  eq('微博：用 note 兜底 word', by.weibo.items[0].title, '为什么学校不统一打印作业');
  eq('微博：热度缩写', by.weibo.items[0].hotText, '113.3万');
  eq('百度：从 cards.content.content 里挖出来', by.baidu.items[0].title, '总书记反复提及一位红军师长');
  eq('百度：置顶标出来', by.baidu.items[0].hotText, '置顶');
  eq('B站热搜：显示名优先', by.biliSearch.items[0].title, 'NRG vs T1 上海冠军赛');
  eq('B站热搜：排名', by.biliSearch.items[0].hotText, '第 1 位');
  eq('掘金：标题 / 阅读', [by.juejin.items[0].title, by.juejin.items[0].hotText], ['副业搞起来', '5.2万 阅读']);
  eq('HN：标题 / 分数 / 作者', [by.hn.items[0].title, by.hn.items[0].hot, by.hn.items[0].extra], ['Sharing AI progress in mathematics', 321, 'someone']);
  eq('HN：没 url 的自动补 discussion 链接', by.hn.items[1].url, 'https://news.ycombinator.com/item?id=102');
  eq('GitHub：名字 + 描述拼一起', by.github.items[0].title, 'openai/math — A math repo');
  eq('GitHub：星数', by.github.items[0].hotText, '★ 4567');
  eq('arXiv：XML 解出标题', by.arxiv.items[0].title, 'QF3: Fast Flow RL with Filtered Q-Gradients');
  eq('arXiv：作者进 extra', by.arxiv.items[0].extra, 'Alice Zhang');
  eq('arXiv：日期进 hotText', by.arxiv.items[0].hotText, '2026-10-06');
  eq('arXiv：解出 2 条', by.arxiv.items.length, 2);
  eq('OpenAlex：标题 / 被引 / 期刊', [by.openalex.items[0].title, by.openalex.items[0].hot, by.openalex.items[0].extra], ['Hub genes in a pan-cancer network', 7, 'Nature']);
  eq('少数派：标题 / 赞评', [by.sspai.items[0].title, by.sspai.items[0].hotText], ['罗马：永恒之城，永恒于世', '3 赞 · 1 评论']);

  console.log('\n── ⑤ 每个条目都要有 id / title / url（去重和跳转都靠它们）──');
  const all = r.results.flatMap((x) => x.items);
  ok('★ 全都有非空 id', all.every((x) => x.id && String(x.id).trim()), JSON.stringify(all.filter((x) => !x.id).slice(0, 2)));
  ok('★ 全都有非空 title', all.every((x) => x.title && String(x.title).trim()));
  ok('★ 全都有 url', all.every((x) => typeof x.url === 'string'), JSON.stringify(all.filter((x) => typeof x.url !== 'string').slice(0, 2)));
  ok('★ id 在源内不重复', r.results.every((x) => new Set(x.items.map((i) => i.id)).size === x.items.length), JSON.stringify(r.results.filter((x) => new Set(x.items.map((i) => i.id)).size !== x.items.length).map((x) => x.key)));

  console.log('\n── ⑥ 缓存与单源失败隔离 ──');
  H.clearCache();
  let calls = 0;
  const counting = (url) => { calls++; return fakeFetch(url); };
  await H.fetchMany(['douyin'], { fetch: counting, force: true });
  const afterFirst = calls;
  await H.fetchMany(['douyin'], { fetch: counting });      /* 不带 force → 走缓存 ✓ */
  eq('★ 第二次走缓存（不再打上游）', calls, afterFirst);
  await H.fetchMany(['douyin'], { fetch: counting, force: true });
  eq('force=1 会真的再拉', calls, afterFirst + 1);

  const boom = () => Promise.reject(new Error('连不上'));
  const r2 = await H.fetchMany(['douyin', 'hn'], { fetch: boom, force: true });
  ok('★ 单源失败不影响整批', r2.ok === true && r2.results.length === 2);
  ok('失败的源给出**明确错误**（不是静默空）', r2.results.every((x) => !x.ok && x.error), JSON.stringify(r2.results.map((x) => x.error)));
  eq('失败的源 items 是空数组（前端好处理）', r2.results[0].items, []);

  const r3 = await H.fetchMany(['nope'], { fetch: fakeFetch });
  ok('不认识的源给明确错误', !r3.results[0].ok && /不认识的源/.test(r3.results[0].error), r3.results[0].error);

  console.log('\n── ⑦ 坏响应不能把整个模块搞崩 ──');
  const junk = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('这不是 JSON') });
  const r4 = await H.fetchMany(['douyin'], { fetch: junk, force: true });
  ok('★ 返回非 JSON → 报错而不是抛异常', !r4.results[0].ok && /不是 JSON/.test(r4.results[0].error), r4.results[0].error);
  const empty = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
  const r5 = await H.fetchMany(['douyin'], { fetch: empty, force: true });
  ok('★ 结构变了（没有 word_list）→ 0 条，不崩', r5.results[0].ok === true && r5.results[0].items.length === 0);

  console.log('\n' + (failed ? '失败 ' + failed + ' 项 / 共 ' + (passed + failed) : '热榜聚合：' + passed + ' 项通过 ✓'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('✗ 异常: ' + e.message); process.exit(1); });
