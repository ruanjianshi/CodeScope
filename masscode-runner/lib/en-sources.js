'use strict';

/* ── 外刊精读的「推荐源」（纯逻辑：无 DOM ✗、无 STORE ✗，fetch 由调用方注入 ✓）────
   ★ 设计原则和 lib/hot.js 一样 ✓：**每个源都是在这台机器上实测过的** ✓ ——
     「feed 拿得到条目」**并且**「点进去正文抽得出来」两条都过才算 ✓
     （只测 feed 不够 ✗ —— 实测 Phys.org / Ars Technica / Knowable 的 feed 正常 ✓，
       但文章页 403/405 反爬 ✗，抽不出正文 ✗，用户点进去只会看到「抓不到」✗）。
   ★ 另外这些**本机根本连不上**（DNS 被污染 / 连接超时 ✗），一个都没塞：
     Guardian · BBC · NYT · 大西洋月刊 · 纽约客 · The Conversation · MIT News ·
     NASA · The Economist · VOA · ProPublica · Big Think · Noema · Reuters(404) ·
     Works in Progress(404) · Marginal Revolution(403) · Kottke · Hakai · Wellcome ·
     Al Jazeera · DW · ABC Australia · CBC · CS Monitor · PBS · Japan Times · SCMP ·
     Straits Times · The Hindu · Global Voices · Rest of World · Time · Vox · Axios ·
     Politico EU · The Diplomat · Nikkei Asia · Euronews · Independent · USA Today。
     （不是它们不好 ✗，是这台机器访问不了 ✗ —— 塞进来就是「点了没反应」✗。）
   ★ 还有三个是**feed 通、但文章页反爬**（403/405 ✗），也拿掉了：
     Phys.org · Ars Technica · Knowable Magazine。
     ⚠️ 这一类**只测 feed 是发现不了的** ✗ —— 要点进去抓正文才知道 ✗。
   ⚠️ 只做**只读**拉取 ✗：不登录 ✓、不带用户 Cookie ✓、不写任何东西 ✓。
   ══════════════════════════════════════════════════════════════════════ */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/* ── 文本清洗 ✓ ─────────────────────────────────────────────────────────── */
function stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}
function unesc(s) {
  return String(s == null ? '' : s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#8217;|&rsquo;/g, '\u2019')
    .replace(/&#8216;|&lsquo;/g, '\u2018').replace(/&#8220;|&ldquo;/g, '\u201c').replace(/&#8221;|&rdquo;/g, '\u201d')
    .replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013').replace(/&hellip;/g, '\u2026')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; });
}
function clean(s) {
  return unesc(stripTags(s)).replace(/\s+/g, ' ').trim();
}

/* ── 源目录 ✓ ─────────────────────────────────────────────────────────────
   ttl  = 缓存多久（秒）✓ —— 免得每点一次都把人家打一遍 ✗
   lv   = 大致难度（给用户一个预期 ✓，真正的难度还是按正文算 ✓）
   d    = 一句话：这是什么 / 适合谁 ✓
   ──────────────────────────────────────────────────────────────────────── */
const READ_SOURCES = {
  /* ── 新闻 ───────────────────────────────────────────────────────────── */
  npr: {
    n: 'NPR World', g: '新闻', e: '📻', ttl: 900, lv: 'B2~C1',
    home: 'https://www.npr.org/', d: '美国公共广播的国际新闻。句子短、结构清楚，是最适合「读得下去」的新闻英语。',
    /* ⚠️⚠️ 这里**必须是 1004** ✗✗，不能写 1001 ✗ ——
       同一个站，`feeds.npr.org/1001/rss.xml`（News）在这台机器上要 **30 秒然后超时** ✗，
       而 `/1004/rss.xml`（World）**只要 0.2 秒** ✗（实测：连测 3 次 2254/844/123ms ✓）。
       我一开始就是按「NPR 新闻」想当然写了 1001 ✗，结果用户点开只会看到「超时」✗。
       ⚠️ 所以「换个栏目 id」也可能从「不可用」变「可用」✗ —— 一条路径不通别急着下结论 ✓。 */
    feed: 'https://feeds.npr.org/1004/rss.xml',
  },
  usnews: {
    n: 'US News', g: '新闻', e: '🗽', ttl: 900, lv: 'B2~C1',
    home: 'https://www.usnews.com/', d: '美国新闻与世界报道。条目多、更新快，适合每天扫一遍标题挑着读。',
    feed: 'https://www.usnews.com/rss/news',
  },
  /* ── 科学 ───────────────────────────────────────────────────────────── */
  sciencedaily: {
    n: 'ScienceDaily', g: '科学', e: '🔬', ttl: 1800, lv: 'B2~C1',
    home: 'https://www.sciencedaily.com/', d: '各大学和期刊的新闻稿改写。同一件事换着说法讲，特别适合积累学术词汇。',
    feed: 'https://www.sciencedaily.com/rss/all.xml',
  },
  nature: {
    n: 'Nature', g: '科学', e: '🧬', ttl: 1800, lv: 'C1+',
    home: 'https://www.nature.com/', d: '顶刊的新闻与评论（不是论文正文）。难度偏高，适合想啃硬材料的时候。',
    feed: 'https://www.nature.com/nature.rss',
  },
  quanta: {
    n: 'Quanta Magazine', g: '科学', e: '➗', ttl: 3600, lv: 'C1',
    home: 'https://www.quantamagazine.org/', d: '数学 / 物理 / 生物的深度科普。写得像故事，长句多但逻辑很顺。',
    feed: 'https://api.quantamagazine.org/feed/',
  },
  nautilus: {
    n: 'Nautilus', g: '科学', e: '🐚', ttl: 3600, lv: 'C1',
    home: 'https://nautil.us/', d: '科学和人文交叉的随笔。文笔好，适合当范文读。',
    feed: 'https://nautil.us/feed/',
  },
  eos: {
    n: 'Eos（AGU）', g: '科学', e: '🌍', ttl: 3600, lv: 'C1',
    home: 'https://eos.org/', d: '地球与空间科学的行业新闻。气候 / 海洋 / 地质词汇的集中地。',
    feed: 'https://eos.org/feed',
  },
  undark: {
    n: 'Undark', g: '科学', e: '🕯', ttl: 3600, lv: 'C1',
    home: 'https://undark.org/', d: '科学与社会议题的调查报道。篇幅长，适合练「一次读一篇完整的」。',
    feed: 'https://undark.org/feed/',
  },
  owid: {
    n: 'Our World in Data', g: '科学', e: '📈', ttl: 3600, lv: 'B2~C1',
    home: 'https://ourworldindata.org/', d: '全球议题的长文（贫困 / 能源 / 健康）。数据多、句式规整，很适合精读。',
    feed: 'https://ourworldindata.org/atom.xml',
  },
  /* ── 思想 / 人文 ─────────────────────────────────────────────────────── */
  aeon: {
    n: 'Aeon', g: '思想', e: '💡', ttl: 3600, lv: 'C1',
    home: 'https://aeon.co/', d: '哲学与社会议题的长文。公认的高质量英文写作，很适合当精读主粮。',
    feed: 'https://aeon.co/feed.rss',
  },
  psyche: {
    n: 'Psyche', g: '思想', e: '🧠', ttl: 3600, lv: 'B2~C1',
    home: 'https://psyche.co/', d: 'Aeon 的姊妹刊，讲心理与生活。篇幅比 Aeon 短，读起来轻松些。',
    feed: 'https://psyche.co/feed.rss',
  },
  aldaily: {
    n: 'Arts & Letters Daily', g: '思想', e: '🗞', ttl: 3600, lv: 'C1',
    home: 'https://www.aldaily.com/', d: '老牌人文聚合站：每条都是一句点评 + 一个外链。用来发现好文章。',
    feed: 'https://www.aldaily.com/feed/',
  },
  threequarks: {
    n: '3 Quarks Daily', g: '思想', e: '⚛', ttl: 3600, lv: 'C1',
    home: 'https://3quarksdaily.com/', d: '科学 / 哲学 / 艺术的策展博客。选题杂，适合不想被单一领域困住的时候。',
    feed: 'https://3quarksdaily.com/feed',
  },
  marginalian: {
    n: 'The Marginalian', g: '思想', e: '🕊', ttl: 3600, lv: 'C1+',
    home: 'https://www.themarginalian.org/', d: '（前 Brain Pickings）读书随笔。长句多、修辞多，难度高但很美。',
    feed: 'https://www.themarginalian.org/feed/',
  },
  fsblog: {
    n: 'Farnam Street', g: '思想', e: '🧩', ttl: 3600, lv: 'B2~C1',
    home: 'https://fs.blog/', d: '思维模型与决策。段落短、要点清楚，适合边读边记。',
    feed: 'https://fs.blog/feed/',
  },
  act: {
    n: 'Astral Codex Ten', g: '思想', e: '📐', ttl: 3600, lv: 'C1+',
    home: 'https://www.astralcodexten.com/', d: '理性主义长文。口语化但密度大，适合练「读懂论证结构」。',
    feed: 'https://www.astralcodexten.com/feed',
  },
  amscholar: {
    n: 'The American Scholar', g: '思想', e: '🎓', ttl: 3600, lv: 'C1',
    home: 'https://theamericanscholar.org/', d: '文学与公共议题的季刊。散文质量高，适合当写作范本。',
    feed: 'https://theamericanscholar.org/feed/',
  },
  /* ── 技术 ───────────────────────────────────────────────────────────── */
  mittr: {
    n: 'MIT Technology Review', g: '技术', e: '⚙', ttl: 1800, lv: 'B2~C1',
    home: 'https://www.technologyreview.com/', d: '技术评论与产业观察。AI / 生物 / 气候的英文表达都在这里。',
    feed: 'https://www.technologyreview.com/feed/',
  },
  wired: {
    n: 'WIRED', g: '技术', e: '🔌', ttl: 1800, lv: 'B2~C1',
    home: 'https://www.wired.com/', d: '科技文化报道。写法活泼，俚语和口语表达多。',
    feed: 'https://www.wired.com/feed/rss',
  },
  /* ── 纪实 / 长篇 ─────────────────────────────────────────────────────── */
  longreads: {
    n: 'Longreads', g: '纪实', e: '📖', ttl: 3600, lv: 'B2~C1',
    home: 'https://longreads.com/', d: '全网长报道的推荐站。想找「一篇能读半小时」的，从这里挑。',
    feed: 'https://longreads.com/feed/',
  },
  lithub: {
    n: 'Literary Hub', g: '纪实', e: '📚', ttl: 3600, lv: 'C1',
    home: 'https://lithub.com/', d: '文学圈的日常：书评、访谈、随笔。文学词汇多。',
    feed: 'https://lithub.com/feed/',
  },
  narratively: {
    n: 'Narratively', g: '纪实', e: '🎙', ttl: 3600, lv: 'B1~B2',
    home: 'https://narratively.com/', d: '普通人的真实故事。叙事性强、用词平实，入门首选。',
    feed: 'https://narratively.com/feed/',
  },
  /* ── 历史 / 文化 ─────────────────────────────────────────────────────── */
  smithsonian: {
    n: 'Smithsonian Magazine', g: '文化', e: '🏛', ttl: 3600, lv: 'B2~C1',
    home: 'https://www.smithsonianmag.com/', d: '历史 / 科学 / 艺术的博物馆视角。故事性强，冷知识多。',
    feed: 'https://www.smithsonianmag.com/rss/latest_articles/',
  },
  /* ── 环境 ───────────────────────────────────────────────────────────── */
  grist: {
    n: 'Grist', g: '环境', e: '🌱', ttl: 3600, lv: 'B2~C1',
    home: 'https://grist.org/', d: '气候与环境报道。气候议题的词汇和说法很集中。',
    feed: 'https://grist.org/feed/',
  },
};

const GROUPS = ['新闻', '科学', '思想', '技术', '纪实', '文化', '环境'];

/* ── 开源外刊 / 英语资源（静态数据 ✓，不联网 ✓）────────────────────────────
   ★ 这些是**别人维护的公开仓库** ✓ —— 我**只放链接** ✗，不抓取、不镜像、不代下 ✗。
   ⚠️ 版权各归各的 ✓：像 awesome-english-ebooks 收的是**杂志归档** ✓，
      版权在原刊 ✗ —— 仓库页自己也写了「仅供个人学习」✓。
      这里如实标注 ✓，用不用、怎么用由用户自己判断 ✓（我不替他决定 ✗，
      但也不装作没这回事 ✗）。
   ⚠️ 星数是**实测那一刻**的值（GitHub API ✓），会变 ✓，只当个「有多活跃」的参考 ✓。
   ⚠️ `repo` 是**真实仓库路径** ✓（`作者/仓库名` ✓），`n` 是**给人看的名字** ✓ ——
      两者**故意分开** ✗：像 NCE 我想显示成「NCE（新概念英语）」✗，
      但仓库就叫 `iChochy/NCE` ✗。混用的话链接拼不出来 ✓
      （而且拼错了用户点开是 404 ✗，自己还看不出来 ✗）。
   ──────────────────────────────────────────────────────────────────────── */
const OS_RESOURCES = [
  {
    key: 'aee', repo: 'hehonghui/awesome-english-ebooks', n: 'awesome-english-ebooks', by: 'hehonghui', stars: 37600,
    tag: '杂志归档', lv: 'C1+',
    what: '经济学人（含音频）、纽约客、卫报、连线、大西洋月刊等，epub / mobi / pdf，每周更新。',
    warn: '社区分享的杂志归档，版权归原刊，仓库写明「仅供个人学习」。要不要用、怎么用，你自己判断。',
  },
  {
    key: 'eco', repo: 'nailperry-zd/The-Economist', n: 'The-Economist', by: 'nailperry-zd', stars: 4000,
    tag: '杂志归档', lv: 'C1+',
    what: '经济学人的历史归档（更新停在 2023）。',
    warn: '同上：归档性质，版权在原刊。',
  },
  {
    key: 'nce', repo: 'iChochy/NCE', n: 'NCE（新概念英语）', by: 'iChochy', stars: 3900,
    tag: '教材', lv: 'A2~B2',
    what: '《新概念英语》全四册在线课文朗读、单句点读、中英对照。',
    warn: '',
  },
  {
    key: 'ae', repo: 'yvoronoy/awesome-english', n: 'awesome-english', by: 'yvoronoy', stars: 4100,
    tag: '资源清单', lv: '全阶段',
    what: '英文写的一份「学英语有哪些好资源」清单：词典、听力、阅读、语法、考试，分类很全。',
    warn: '',
  },
  {
    key: 'le', repo: 'knowledgefxg/learning-english', n: 'learning-english', by: 'knowledgefxg', stars: 4500,
    tag: '资源清单', lv: '全阶段',
    what: '中文整理的英语学习资源合集，按听说读写分，含语法、词汇、媒体资源。',
    warn: '',
  },
  {
    key: 'ql', repo: 'RealKai42/qwerty-learner', n: 'qwerty-learner', by: 'RealKai42', stars: 23300,
    tag: '背单词', lv: '全阶段',
    what: '键盘流的单词记忆软件：一边敲一边记，词库覆盖四六级 / 考研 / 雅思 / 托福 / GRE。',
    warn: '',
  },
  {
    key: 'bai', repo: 'CapeAga/bai-it', n: '掰 it', by: 'CapeAga', stars: 600,
    tag: '阅读辅助', lv: 'B1+',
    what: '浏览器扩展：把英文长句拆开给你看结构，正好补「读长句读不动」这一环。',
    warn: '',
  },
  {
    key: 'readinghb', repo: 'xiaolai/a-new-english-reading-handbook', n: '新编英语阅读手册', by: 'xiaolai', stars: 500,
    tag: '阅读方法', lv: '全阶段',
    what: '叶永昌主编的《新编英语阅读手册》—— 讲怎么读，不是题库。',
    warn: '',
  },
  {
    key: 'ielts', repo: 'shah0150/awesome-IELTS', n: 'awesome-IELTS', by: 'shah0150', stars: 1700,
    tag: '考试', lv: 'B2+',
    what: '雅思备考资料清单。',
    warn: '',
  },
  {
    key: 'openielts', repo: 'mcxiaoxiao/openIELTS', n: 'openIELTS', by: 'mcxiaoxiao', stars: 600,
    tag: '考试', lv: 'B2+',
    what: '0 成本雅思备考日程计划：课程视频、笔记、文档、刷题网站、作文批改、口语串题 prompt。',
    warn: '',
  },
  {
    key: 'interam', repo: 'interaminense/learning-english', n: 'learning-english（链接集）', by: 'interaminense', stars: 780,
    tag: '资源清单', lv: '全阶段',
    what: '一份英文的「学英语有用的链接」清单，偏工具和站点。',
    warn: '',
  },
].map((x) => Object.assign(x, { url: 'https://github.com/' + x.repo }));

/* ── Feed 解析 ✓（RSS 2.0 + Atom 都认 ✓）──────────────────────────────────
   ⚠️⚠️ **必须按条目切** ✗✗ —— 我第一版写的是「在整份 XML 里找第一个 <link>」✗，
      而 Atom 的 <feed> 顶上就有个指向**首页**的 <link> ✗ →
      于是「最新文章」全是站点首页 ✗（实测：Aeon / WIRED / Quanta / MIT TR /
      OWID / American Scholar … 抓回来的标题统统是站名 ✗），
      而且首页文字多 ✗ → 抽取「成功」✗ → **假通过** ✗✗，非常难发现 ✗。
   → 正确做法：先切出 <item>…</item> / <entry>…</entry> ✓，再在**条目内部**找链接 ✓。
   ──────────────────────────────────────────────────────────────────────── */
function parseFeed(xml) {
  const src = String(xml == null ? '' : xml);
  const blocks = []
    .concat(Array.from(src.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)).map((m) => m[0]))
    .concat(Array.from(src.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)).map((m) => m[0]));
  const out = [];
  const seen = new Set();
  for (const b of blocks) {
    const rawTitle = (() => {
      const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(b);
      return m ? m[1] : '';
    })();
    /* 链接：RSS 是 <link>URL</link> ✓；Atom 是 <link rel="alternate" href="…"/> ✓ */
    let url = '';
    const plain = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(b);
    if (plain && /https?:\/\//i.test(plain[1])) url = clean(plain[1]);
    if (!url) {
      const rel = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b)
        || /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i.exec(b)
        || /<link[^>]*href=["']([^"']+)["']/i.exec(b);
      if (rel) url = unesc(rel[1]).trim();
    }
    if (!/^https?:\/\//i.test(url)) continue;
    /* ⚠️ 首页 / 栏目页 / 标签页**不是文章** ✗ —— 混进来用户点开就是整站首页 ✗ */
    if (/\/(tag|tags|category|categories|author|authors|topics?|section|sections)\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const desc = (() => {
      const m = /<(?:description|summary|content:encoded|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content:encoded|content)>/i.exec(b);
      return m ? clean(m[1]).slice(0, 220) : '';
    })();
    const dateRaw = (() => {
      const m = /<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i.exec(b);
      return m ? clean(m[1]) : '';
    })();
    const ts = dateRaw ? Date.parse(dateRaw) : NaN;
    const title = clean(rawTitle);
    if (!title) continue;
    out.push({ url, title, desc, date: dateRaw, ts: Number.isFinite(ts) ? ts : 0 });
  }
  /* 有日期的按日期倒序 ✓（没有的就保持原顺序 ✓ —— feed 本来就是按时间排的 ✓）*/
  if (out.some((x) => x.ts)) out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

/* ── 拉取 ✓（每源 TTL 缓存 ✓；单源失败**不影响别的** ✓）────────────────── */
const CACHE = new Map();

function makeCtx(fetchImpl, timeoutMs) {
  const to = Math.max(3000, Math.min(60000, timeoutMs || 15000));
  return {
    async text(url) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), to);
      try {
        const r = await fetchImpl(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': UA,
            'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: ctrl.signal,
        });
        const t = await r.text();
        if (!r.ok) throw new Error('HTTP ' + r.status + '：' + t.slice(0, 100));
        return t;
      } finally { clearTimeout(timer); }
    },
  };
}

async function fetchSource(key, options) {
  const opts = options || {};
  const src = READ_SOURCES[key];
  if (!src) return { ok: false, key, error: '不认识的源：' + key, items: [] };
  const hit = CACHE.get(key);
  if (hit && !opts.force && (Date.now() - hit.at) < src.ttl * 1000) {
    return { ok: true, key, name: src.n, group: src.g, icon: src.e, d: src.d, lv: src.lv, home: src.home, items: hit.items, at: hit.at, cached: true };
  }
  try {
    const xml = await makeCtx(opts.fetch, opts.timeoutMs).text(src.feed);
    const items = parseFeed(xml).slice(0, 40);
    if (!items.length) throw new Error('这个 feed 里没解析出条目（可能改版了）');
    CACHE.set(key, { at: Date.now(), items });
    return { ok: true, key, name: src.n, group: src.g, icon: src.e, d: src.d, lv: src.lv, home: src.home, items, at: Date.now(), cached: false };
  } catch (error) {
    const msg = String((error && error.message) || error);
    return {
      ok: false, key, name: src.n, group: src.g, icon: src.e, items: [],
      error: /abort/i.test(msg) ? '超时（这台机器连不上它）' : msg,
    };
  }
}

async function fetchMany(keys, options) {
  const list = keys && keys.length ? keys : Object.keys(READ_SOURCES);
  const results = await Promise.all(list.map((k) => fetchSource(k, options)));
  return { ok: true, at: Date.now(), results, sources: catalog(), osResources: OS_RESOURCES };
}

function catalog() {
  return Object.keys(READ_SOURCES).map((k) => ({
    key: k, name: READ_SOURCES[k].n, group: READ_SOURCES[k].g, icon: READ_SOURCES[k].e,
    lv: READ_SOURCES[k].lv, d: READ_SOURCES[k].d, home: READ_SOURCES[k].home, ttl: READ_SOURCES[k].ttl,
  }));
}

function clearCache() { CACHE.clear(); }

/* ★★ 双栖 ✓ —— 服务端 `require` 拿到 ✓，浏览器里挂 `window.LW_EN_SOURCES` ✓。
   前端为什么也要这份 ✗：源目录（名字 / 分组 / 难度 / 一句话说明）和
   「开源资源清单」都是**静态数据** ✓ —— 从服务端多绕一圈没必要 ✗，
   而且面板一打开就能画出来 ✓（不用等网络 ✓）。
   真正的拉取还是在服务端做 ✓（浏览器直接抓第三方会被 CORS 挡 ✗）。
   ⚠️ 本文件**不能有任何顶层副作用** ✗、**不能 require 别的东西** ✗
      （它在浏览器里是被 `<script type="module">` 直接加载的 ✓）。
   ⚠️ 顶层 const 名字**带前缀** ✗ —— 见 skills 里那条
      「经典脚本的顶层 const 共享全局词法作用域」✗（两个文件都写 `const API` 会整个不执行 ✗）。 */
const LW_EN_SOURCES_API = {
  READ_SOURCES, OS_RESOURCES, GROUPS, catalog, parseFeed, fetchSource, fetchMany, clearCache, clean, stripTags, unesc,
};
if (typeof module !== 'undefined' && module.exports) module.exports = LW_EN_SOURCES_API;
if (typeof window !== 'undefined') window.LW_EN_SOURCES = LW_EN_SOURCES_API;
