'use strict';

/* ── 热点聚合（参考 TrendRadar 那类开源项目的思路）────────────────────────
   ★ 设计原则：**每个源都是「实测能拿到真数据」的** ✓ ——
     下面这些 URL 全都在这台机器上**逐个 curl 验过** ✓（见 CHANGELOG 里的探测表 ✓）。
     拿不到的（知乎 403 ✗、V2EX / vvhan / HuggingFace 连不通 ✗、36氪 500 ✗）
     **一个都没往里塞** ✗ —— 宁可少几个源，也不要「点了没反应」✗。
   ★ 纯逻辑、无 DOM ✓，fetch 由调用方注入 ✓ → 可单测 ✓。
   ★ 只做**只读**拉取 ✓：不登录、不带用户 Cookie、不写任何东西 ✓。
   ══════════════════════════════════════════════════════════════════════ */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/* 归一化：所有源都产出 [{ id, title, url, hot, extra, at }] ✓ */
const clean = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; };
const hotText = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n || ''));

const SOURCES = {
  /* ── 视频 ──────────────────────────────────────────────────────────── */
  bili: {
    n: 'B站热门', g: '视频', e: '📺', ttl: 10 * 60,
    async run(ctx) {
      const j = await ctx.json('https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1', 'https://www.bilibili.com/');
      const list = (j && j.data && j.data.list) || [];
      return list.map((x) => ({
        id: 'bili-' + x.aid,
        title: clean(x.title),
        url: 'https://www.bilibili.com/video/' + (x.bvid || ('av' + x.aid)),
        hot: num(x.stat && (x.stat.view || x.stat.like)),
        hotText: hotText(num(x.stat && x.stat.view)) + ' 播放',
        extra: clean((x.owner && x.owner.name) || '') + (x.tname ? ' · ' + clean(x.tname) : ''),
      }));
    },
  },
  douyin: {
    n: '抖音热榜', g: '视频', e: '🎵', ttl: 10 * 60,
    async run(ctx) {
      const j = await ctx.json('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', 'https://www.douyin.com/');
      const list = (j && j.word_list) || [];
      return list.map((x, i) => ({
        id: 'douyin-' + (x.word || i),
        title: clean(x.word),
        url: 'https://www.douyin.com/search/' + encodeURIComponent(String(x.word || '')),
        hot: num(x.hot_value),
        hotText: hotText(num(x.hot_value)),
        extra: x.label ? ('标签 ' + x.label) : '',
      }));
    },
  },
  /* ── 搜索 / 社交 ───────────────────────────────────────────────────── */
  weibo: {
    n: '微博热搜', g: '社交', e: '🔥', ttl: 10 * 60,
    async run(ctx) {
      /* ⚠️ 必须带 `Referer: https://weibo.com/` ✗ —— 不带直接 403 ✗（实测 ✓）*/
      const j = await ctx.json('https://weibo.com/ajax/side/hotSearch', 'https://weibo.com/');
      const list = (j && j.data && j.data.realtime) || [];
      return list.map((x, i) => ({
        id: 'weibo-' + (x.word_scheme || x.word || i),
        title: clean(x.note || x.word),
        url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(String(x.word_scheme || x.word || '')),
        hot: num(x.num),
        hotText: hotText(num(x.num)),
        extra: clean(x.label_name || ''),
      }));
    },
  },
  baidu: {
    n: '百度热搜', g: '搜索', e: '🔎', ttl: 10 * 60,
    async run(ctx) {
      const j = await ctx.json('https://top.baidu.com/api/board?platform=wise&tab=realtime', 'https://top.baidu.com/');
      const cards = (j && j.data && j.data.cards) || [];
      const out = [];
      cards.forEach((c) => {
        (c.content || []).forEach((blk) => (blk.content || []).forEach((x) => {
          if (!x || !x.word) return;
          out.push({
            id: 'baidu-' + x.word,
            title: clean(x.word),
            url: x.url || ('https://www.baidu.com/s?wd=' + encodeURIComponent(x.word)),
            hot: 0,
            hotText: x.isTop ? '置顶' : '',
            extra: clean(x.desc || ''),
          });
        }));
      });
      return out;
    },
  },
  biliSearch: {
    n: 'B站热搜词', g: '搜索', e: '🔍', ttl: 10 * 60,
    async run(ctx) {
      const j = await ctx.json('https://app.bilibili.com/x/v2/search/trending/ranking?limit=20', 'https://www.bilibili.com/');
      const list = (j && j.data && j.data.list) || [];
      return list.map((x, i) => ({
        id: 'bilis-' + (x.hot_id || x.keyword || i),
        title: clean(x.show_name || x.keyword),
        url: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(String(x.keyword || '')),
        hot: 0,
        hotText: '第 ' + (x.position || (i + 1)) + ' 位',
        extra: clean(x.keyword || ''),
      }));
    },
  },
  /* ── 技术 / 开源 ───────────────────────────────────────────────────── */
  juejin: {
    n: '掘金热榜', g: '技术', e: '💎', ttl: 15 * 60,
    async run(ctx) {
      const j = await ctx.json('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot', 'https://juejin.cn/');
      const list = (j && j.data) || [];
      return list.map((x, i) => {
        const c = x.content || {}, cc = x.content_counter || {}, a = x.author || {};
        return {
          id: 'juejin-' + (c.content_id || i),
          title: clean(c.title),
          url: c.content_id ? ('https://juejin.cn/post/' + c.content_id) : 'https://juejin.cn/',
          hot: num(cc.hot_rank || cc.view),
          hotText: cc.view ? (hotText(num(cc.view)) + ' 阅读') : '',
          extra: clean(a.name || ''),
        };
      });
    },
  },
  hn: {
    n: 'Hacker News', g: '技术', e: '🧡', ttl: 15 * 60,
    async run(ctx) {
      const ids = await ctx.json('https://hacker-news.firebaseio.com/v0/topstories.json');
      const top = (Array.isArray(ids) ? ids : []).slice(0, 24);
      /* ⚠️ 每一条都要单独请求 ✗ —— 所以只取前 24 条 ✓（再多就慢得没意义了 ✗）*/
      const items = await Promise.all(top.map((id) => ctx.json('https://hacker-news.firebaseio.com/v0/item/' + id + '.json').catch(() => null)));
      return items.filter(Boolean).map((x) => ({
        id: 'hn-' + x.id,
        title: clean(x.title),
        url: x.url || ('https://news.ycombinator.com/item?id=' + x.id),
        hot: num(x.score),
        hotText: (x.score || 0) + ' 分 · ' + (x.descendants || 0) + ' 评论',
        extra: clean(x.by || ''),
      }));
    },
  },
  github: {
    n: 'GitHub 趋势', g: '开源', e: '🐙', ttl: 30 * 60,
    async run(ctx) {
      const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const j = await ctx.json('https://api.github.com/search/repositories?q=created:%3E' + since + '&sort=stars&order=desc&per_page=25', 'https://github.com/');
      const list = (j && j.items) || [];
      return list.map((x) => ({
        id: 'gh-' + x.full_name,
        title: clean(x.full_name) + (x.description ? ' — ' + clean(x.description) : ''),
        url: x.html_url,
        hot: num(x.stargazers_count),
        hotText: '★ ' + num(x.stargazers_count),
        extra: clean(x.language || ''),
      }));
    },
  },
  /* ── 学术 / 前沿 ───────────────────────────────────────────────────── */
  arxiv: {
    n: 'arXiv 论文', g: '学术', e: '📄', ttl: 30 * 60,
    async run(ctx) {
      /* 一次请求覆盖几个最前沿的分类 ✓（arXiv 支持 OR ✓）*/
      const q = ['cs.RO', 'cs.AI', 'cs.LG', 'cs.CL'].map((c) => 'cat:' + c).join('+OR+');
      const xml = await ctx.text('https://export.arxiv.org/api/query?search_query=' + q + '&sortBy=submittedDate&sortOrder=descending&max_results=30', 'https://arxiv.org/');
      const out = [];
      xml.split('<entry>').slice(1).forEach((raw) => {
        const e = raw.split('</entry>')[0];
        const g = (tag) => { const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>').exec(e); return m ? clean(m[1]) : ''; };
        const link = (/<link[^>]*href="([^"]+)"[^>]*rel="alternate"/.exec(e) || [])[1] || '';
        const id = (/<id>([\s\S]*?)<\/id>/.exec(e) || [])[1] || link;
        const title = g('title');
        if (!title) return;
        out.push({
          id: 'arxiv-' + String(id).trim(),
          title,
          url: link || String(id).trim(),
          hot: 0,
          hotText: g('updated').slice(0, 10),
          extra: g('name'),
        });
      });
      return out;
    },
  },
  openalex: {
    n: 'OpenAlex 论文', g: '学术', e: '🎓', ttl: 30 * 60,
    async run(ctx) {
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const j = await ctx.json('https://api.openalex.org/works?sort=publication_date:desc&per-page=25&filter=from_publication_date:' + from, 'https://openalex.org/');
      const list = (j && j.results) || [];
      return list.map((x) => ({
        id: 'oa-' + String(x.id || '').replace('https://openalex.org/', ''),
        title: clean(x.display_name || x.title),
        url: x.doi || x.id || '',
        hot: num(x.cited_by_count),
        hotText: (x.publication_date || '') + (x.cited_by_count ? ' · 被引 ' + x.cited_by_count : ''),
        extra: clean((((x.primary_location || {}).source || {}).display_name) || ''),
      }));
    },
  },
  /* ── 资讯 ──────────────────────────────────────────────────────────── */
  sspai: {
    n: '少数派', g: '资讯', e: '📰', ttl: 30 * 60,
    async run(ctx) {
      const j = await ctx.json('https://sspai.com/api/v1/article/index/page/get?limit=20&offset=0', 'https://sspai.com/');
      const list = (j && j.data) || [];
      return list.map((x) => ({
        id: 'sspai-' + x.id,
        title: clean(x.title),
        url: 'https://sspai.com/post/' + x.id,
        hot: num(x.like_count),
        hotText: (x.like_count || 0) + ' 赞 · ' + (x.comment_count || 0) + ' 评论',
        extra: clean(String(x.summary || '').slice(0, 60)),
      }));
    },
  },
};

const GROUPS = ['视频', '社交', '搜索', '技术', '开源', '学术', '资讯'];
const CACHE = new Map();   /* key -> { at, items } */

function makeCtx(fetchImpl, timeoutMs) {
  const to = Math.max(3000, Math.min(60000, timeoutMs || 15000));
  const req = (url, ref, kind) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), to);
    return fetchImpl(url, {
      headers: { 'User-Agent': UA, 'Referer': ref || url, 'Accept': kind === 'text' ? 'application/atom+xml, application/xml, text/xml, */*' : 'application/json, text/plain, */*' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  };
  return {
    async json(url, ref) {
      const r = await req(url, ref, 'json');
      const t = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status + '：' + t.slice(0, 120));
      try { return JSON.parse(t); } catch (_) { throw new Error('返回的不是 JSON（' + t.slice(0, 80) + '）'); }
    },
    async text(url, ref) {
      const r = await req(url, ref, 'text');
      const t = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status + '：' + t.slice(0, 120));
      return t;
    },
  };
}

/* 拉一个源 ✓（带缓存 ✓，单个源失败**不影响别的源** ✓）*/
async function fetchSource(key, options) {
  const opts = options || {};
  const src = SOURCES[key];
  if (!src) return { ok: false, key, error: '不认识的源：' + key, items: [] };
  const hit = CACHE.get(key);
  const fresh = hit && (Date.now() - hit.at) < src.ttl * 1000;
  if (fresh && !opts.force) return { ok: true, key, name: src.n, group: src.g, icon: src.e, items: hit.items, at: hit.at, cached: true };
  try {
    const items = await src.run(makeCtx(opts.fetch, opts.timeoutMs));
    const out = (items || []).filter((x) => x && x.title);
    CACHE.set(key, { at: Date.now(), items: out });
    return { ok: true, key, name: src.n, group: src.g, icon: src.e, items: out, at: Date.now(), cached: false };
  } catch (error) {
    const msg = String((error && error.message) || error);
    return {
      ok: false, key, name: src.n, group: src.g, icon: src.e, items: [],
      error: /abort/i.test(msg) ? '超时（网络不通？）' : msg,
    };
  }
}

/* 拉一批 ✓（并发 ✓，逐个兜底 ✓）*/
async function fetchMany(keys, options) {
  /* ⚠️ 不认识的 key **不能静默过滤掉** ✗ —— 那样调用方会以为「0 个源」✗，
     而不是「你给的 key 不对」✗（实测踩过：results 直接变成空数组 ✗）。
     交给 fetchSource 去报明确错误 ✓。 */
  const list = keys && keys.length ? keys : Object.keys(SOURCES);
  const results = await Promise.all(list.map((k) => fetchSource(k, options)));
  return {
    ok: true,
    at: Date.now(),
    results,
    sources: catalog(),
  };
}

function catalog() {
  return Object.keys(SOURCES).map((k) => ({ key: k, name: SOURCES[k].n, group: SOURCES[k].g, icon: SOURCES[k].e, ttl: SOURCES[k].ttl }));
}

function clearCache() { CACHE.clear(); }

module.exports = { SOURCES, GROUPS, catalog, fetchSource, fetchMany, clearCache, clean, hotText };
