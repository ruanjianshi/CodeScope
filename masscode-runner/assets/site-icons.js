/* 码境 CodeScope · 网址导航卡片的「真图标」层
   ═══════════════════════════════════════════════════════════════════════════
   用户反馈：「缺乏对应网址的相应图标」。

   为什么需要这一层：卡片左侧的图标位是 study-workspace.js（打包产物，不改）渲染的
   一个 <i>，里面只有一颗 7px 的 --site-color 彩点 —— 站点数据里没有 icon 字段
   （证据：server.js 的 readSiteCatalog() / cleanStudyConfig() 只清洗
     label / url / description / stars / color；icon 只存在于「分类」上）。
   所以真图标只能由前端补：本文件监听 #quick-sites，把 <i> 里换成 <img>。

   ★ 三条不能破的底线
     ① 拿不到就保持彩点（onerror 移除 img）——任何情况下都不出现破图，也不改布局；
     ② 同一 host 不重复请求（localStorage 记 302 之后的最终 URL，下次直接用）；
     ③ 一次弹窗最多 6 个图标并发（分类里 20+ 站时排队，不会一次开几十个连接）。

   ★ 图标源选型（2026-11-01 实测，脚本见交付报告）
     · https://www.google.com/s2/favicons?sz=64&domain=<host> —— 本机整域不可达
       （curl 返回 000，大陆网络无 Google 出口）⇒ 不可用；
     · t3.gstatic.com/faviconV2 —— 同样 000（12/12 全灭）；
     · 站点自身 https://<host>/favicon.ico —— 11 站里只成 6 站：npm / StackOverflow
       返回 403、wikipedia / youtube / reddit 在本地网络直接 000；
     · https://favicon.im/<host>（本次选它）—— 23/23 全成，返回 ICO / PNG / SVG 真图。
       它是服务端回源：连本机访问不到的站点也能拿到图标，这正是本应用要的效果。
     代价（写进报告，不藏）：多一个第三方依赖，且会把访问的域名泄漏给 favicon.im。
     ⇒ 所以内网 / 回环 / 保留地址（192.0.2.0/24、*.local、IP 字面量等）一律不发请求，
       直接留彩点（见 isPublicHost）。目录里那些内网端口表不会被送出去。

   ★ 图标从哪来、为什么现在快了（2026-11-01 改成本机代理）
     现在的链路是「浏览器 → 本机 /api/favicon?host=<host> → （首次）favicon.im → 磁盘」✓：
       · 首次：本机没缓存 → 服务端回源一次 ✓（3s 超时 ✓）→ 写进
         <数据目录>/favicons/<host>.<ext> ✓ → 再把字节发给浏览器 ✓；
       · 之后：服务端直接读盘 ✓（毫秒级 ✓、**零外部请求** ✓），响应还带
         Cache-Control: public, max-age=2592000（30 天 ✓）⇒ 浏览器连本机都不用问 ✓；
       · 断网：盘上有缓存就照样出图 ✓（这条以前做不到 ✗ —— 字节在第三方手里，
         断网必回落彩点 ✓）；盘上没有 → 服务端回源失败回 404 ✓ → 回落彩点 ✓。
     ⇒ localStorage 里那条 URL 仍然留着 ✓（同 host 不重复拼地址 ✓），但它**不再是**缓存主体：
       主体是「服务端磁盘」（跨浏览器 ✓、断网可用 ✓）+「浏览器 HTTP 缓存」（零网络 ✓）。
     ⚠️ 以前那套「缓存 302 之后的最终 URL」为什么放弃 ✗（试过，做不到 ✓）：
        img.currentSrc / performance 都只报**重定向之前**的地址 ✗（跨域重定向不暴露时间线 ✓），
        也拿不到图片字节 ✗（favicon.im 不回 access-control-allow-origin ✓，fetch 过不了 CORS ✓）。
        改成本机代理之后两个限制同时消失 ✓ —— 字节由本机服务端返回 ✓，
        对浏览器而言 URL 只有一条（/api/favicon?host=… ✓），302 在服务端内部发生 ✓。
     ⚠️ 淡入（120ms opacity）为什么值得写 ✓：图标是**加载成功之后**才挂上去的 ✓，
        「彩点 → 图标」只有一帧交接 ✓ —— 直接 append 是硬切 ✓（用户说的「先白框后图标」
        的跳动就是硬切那一帧 ✓）；淡入把它拉成 120ms ✓，彩点在底下透出来 ✓
        （img 有 z-index:1 盖在 ::after 之上 ✓，过渡结束才收彩点 ✓），
        prefers-reduced-motion 下 CSS 直接 opacity:1 ✓（JS 也不排帧 ✓）。
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 常量 ──────────────────────────────────────────────────────────────── */
  var CONTAINER_ID = 'quick-sites';        /* 结果区（右栏网格），卡片都在这里面 */
  var CARD_SELECTOR = '.quick-site';       /* study-workspace.js 渲染的卡片类名 */
  var SERVICE = '/api/favicon?host=';      /* ② 本机代理端点（磁盘缓存 + 30 天长缓存头，见文件头） */
  var CONCURRENCY = 6;                     /* ③ 同时最多 6 个图标请求 */
  var CACHE_PREFIX = 'codescope.site-icons.v1:';  /* localStorage 键前缀，按 host 一条 */
  var CACHE_TTL = 30 * 24 * 3600 * 1000;   /* 30 天；过期的条目下次走一遍 302 回源 */
  var NEGATIVE_TTL = 60 * 1000;            /* 失败不进 localStorage，只在内存里记 60s */
  var LOAD_TIMEOUT = 12000;                /* 兜底：网络卡住时别把 6 个坑位占死 */
  var FADE_MS = 120;                       /* 淡入时长（真值在 motion-batch1.css，这里只用于兜底收彩点）*/

  /* 代理 URL 只有一个形状：/api/favicon?host=<host> ✓ —— 一律 encodeURIComponent：
     以后即使目录里出现 punycode / 带 _ 的主机名，不编码就会拼出**另一个** query ✓；
     服务端拿到后解码再严格校验 ✓（见 server.js 的 handleFavicon / FAVICON_HOST）。 */
  function iconUrl(host) { return SERVICE + encodeURIComponent(host); }

  /* ── ① 项目内已有映射（今天是空的，入口留着）──────────────────────────────
     仓库里没有站点级 icon 数据，所以这张表为空 —— 不是没做，是无数据可映射：
     study-workspace.js 的卡片只 set --site-color，DOM 上拿不到 icon。
     一旦数据层加了站点 icon（site-catalog.json 透传到 DOM / 别的脚本挂
     window.CODESCOPE_SITE_ICONS），下面的查找会优先命中且不联网。 */
  var PROJECT_ICONS = Object.create(null);

  /* ── 运行时状态 ────────────────────────────────────────────────────────── */
  var memory = Object.create(null);   /* host 到 { src, ok, at, img }：页面内一级缓存（img = 已解码元素）*/
  var boundImgs = new WeakSet();      /* 已经绑过 error 监听的图片元素（复用时不重复绑）*/
  var queue = [];                     /* 待发请求 */
  var active = 0;                     /* 在飞的图标请求数 */
  var bound = false;
  var stats = {
    opens: 0,        /* 弹窗重渲染次数（观察器触发且真的处理了卡片的次数）*/
    cards: 0,        /* 处理过的卡片数 */
    attempts: 0,     /* img src 被赋值次数（= 一次「图标请求」）*/
    serviceHits: 0,  /* 走 favicon.im/<host>（会吃一次 302）*/
    cachedHits: 0,   /* 直接用缓存里的最终 URL（无 302）*/
    localHits: 0,    /* ① 项目内映射命中，不联网 */
    cached: 0,       /* 从 memory / localStorage 拿到图标的次数 */
    reused: 0,       /* 直接复用已解码 <img> 元素（0 请求）的次数 */
    loaded: 0,       /* 真加载成功 */
    faded: 0,        /* 真跑过淡入的次数（reduceMotion / 复用已淡入元素时不加）*/
    failed: 0,       /* 加载失败（回落彩点）*/
    skipped: 0,      /* 非公网 host，直接不请求 */
    peak: 0          /* 在飞峰值的观察值（不超过 6 才算守住并发）*/
  };

  var reduceMotion = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = !!(mq && mq.matches);
  } catch (e) { /* 老浏览器没有 matchMedia，当 false 处理 */ }

  /* ═══ 小工具 ═══════════════════════════════════════════════════════════ */

  /* 卡片的 URL 从 title 里取（study-workspace.js 真的把它写进去了：
     「在学习工作台打开 https://github.com（右键可改打开方式）」）——
     卡片上没有 data-url，这是唯一可靠来源，不改打包产物就只能读它。 */
  var URL_RE = /https?:\/\/[^\s（）()]+/i;
  function hostOf(card) {
    var title = card.getAttribute('title') || '';
    var m = URL_RE.exec(title);
    if (m) {
      try { return new URL(m[0]).hostname.toLowerCase(); } catch (e) { /* 落到下面的兜底 */ }
    }
    /* 兜底：<small> 里的域名（description 为空时 study-workspace.js 会写 hostname）*/
    var small = card.querySelector('small');
    var text = small ? String(small.textContent || '').trim() : '';
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text) ? text.toLowerCase() : '';
  }

  /* 内网 / 回环 / 保留地址不发请求：favicon.im 也回不了源，还会把域名送出去。
     （这个应用的网址目录里有内网端口表 —— 别把它交给第三方。） */
  var PRIVATE_SUFFIX = /(?:^|\.)(?:localhost|local|internal|lan|home|test|example|invalid)$/i;
  function isPublicHost(host) {
    if (!host || host.length > 253) return false;
    if (PRIVATE_SUFFIX.test(host)) return false;
    /* IPv4 字面量（含 192.0.2.0/24 这类保留网段）*/
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
    /* IPv6 字面量（URL.hostname 会带方括号）*/
    if (host.charAt(0) === '[' || host.indexOf(':') !== -1) return false;
    var parts = host.split('.');
    if (parts.length < 2) return false;                     /* 单标签主机名 */
    var tld = parts[parts.length - 1];
    if (!/^[a-z]{2,24}$/i.test(tld)) return false;           /* 数字/异常 TLD */
    if (parts.some(function (p) { return !p.length; })) return false;
    return true;
  }

  /* ═══ localStorage 缓存（按 host 一条）═════════════════════════════════ */

  function readCache(host) {
    try {
      var raw = window.localStorage.getItem(CACHE_PREFIX + host);
      if (!raw) return '';
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.src !== 'string' || !obj.src) return '';
      if (obj.at && Date.now() - obj.at > CACHE_TTL) {       /* 过期就丢掉，下次重新回源 */
        window.localStorage.removeItem(CACHE_PREFIX + host);
        return '';
      }
      return obj.src;
    } catch (e) { return ''; }   /* 隐私模式 / 存储被禁：当没有缓存，功能照跑 */
  }

  function writeCache(host, src) {
    if (!host || !src || !/^https?:\/\//i.test(src)) return;
    try {
      window.localStorage.setItem(CACHE_PREFIX + host, JSON.stringify({ src: src, at: Date.now() }));
    } catch (e) { /* 配额满 / 被禁：不影响出图 */ }
  }

  function dropCache(host) {
    try { window.localStorage.removeItem(CACHE_PREFIX + host); } catch (e) {}
    delete memory[host];
  }

  function cacheSize() {
    var n = 0;
    try {
      for (var i = 0; i < window.localStorage.length; i += 1) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) n += 1;
      }
    } catch (e) {}
    return n;
  }

  /* ═══ ③ 并发闸门：最多 6 个在飞，其余排队 ═══════════════════════════════ */

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      var job = queue.shift();
      active += 1;
      if (active > stats.peak) stats.peak = active;
      job(done);
    }
  }

  function done() {
    active -= 1;
    if (active < 0) active = 0;
    pump();
  }

  function enqueue(job) {
    queue.push(job);
    pump();
  }

  /* ═══ 图标位：<i> 换成 <img> ═══════════════════════════════════════════ */

  function iconSlot(card) {
    var first = card.firstElementChild;
    if (first && first.tagName === 'I') return first;
    return card.querySelector('i');
  }

  function mark(slot, value) {
    try { slot.setAttribute('data-site-icon', value); } catch (e) {}
  }

  function state(slot) { return slot.getAttribute('data-site-icon') || ''; }

  /* 成功才挂 <img>：先 new Image() 预加载，load 之后才 append 进 DOM ——
     这样挂上去的一定是已经解码好的图，不存在「破图闪一下」的中间态；
     而且同一个元素 append 不会触发第二次请求。
     挂上去之后做一次 120ms 淡入（样式在 motion-batch1.css 的 10.7b）：
       · 起始 opacity:0（img 规则里的默认值）→ 下一帧加 .is-in 才变 1 ✓；
       · 这 120ms 里彩点**还在**（::after 未收 ✓，img 用 z-index:1 盖在它上面 ✓）
         ⇒ 「彩点 → 图标」是渐变换替，不是硬切 ✓；
       · 过渡走完（或 FADE_MS + 60 兜底）再加 .is-loaded ⇒ CSS 这时才收掉彩点 ✓。 */
  function attach(slot, img) {
    img.className = 'quick-site-favicon';
    img.alt = '';                     /* 装饰性：卡片本身有站名文字，读屏器别重复念 */
    img.width = 20;
    img.height = 20;
    img.decoding = 'async';
    img.loading = 'eager';
    img.referrerPolicy = 'no-referrer';
    /* ⚠️ 卡片本身 draggable=true（study-workspace.js 用它做拖拽排序）——
       图片默认也会被拖，从图标位置按下去会变成「拖图片」而不是「拖卡片」。
       draggable=false + CSS 的 pointer-events:none 把拖动权交还卡片。 */
    img.draggable = false;
    /* 万一挂上去之后浏览器又换源失败，自己摘掉，绝不留在 DOM 里当破图
       （同一个元素会被复用，监听只绑一次）*/
    if (!boundImgs.has(img)) {
      boundImgs.add(img);
      img.addEventListener('error', function () {
        if (img.parentNode === slot) slot.removeChild(img);
        mark(slot, 'failed');
      });
    }
    slot.appendChild(img);
    slot.classList.add('quick-site-icon');
    mark(slot, 'ok');
    /* 复用 memory 里那个**已经淡入过**的元素（同一个 host 再挂一次）：它本来就已不透明 ✓，
       直接给终态、不重放 ✓ —— 否则每开一次弹窗图标都要先暗一下 ✗。
       reduceMotion 同理：CSS 里 opacity 恒为 1 ✓，这里也不必排帧 ✓。 */
    if (reduceMotion || img.classList.contains('is-in')) {
      img.classList.add('is-in');
      slot.classList.add('is-loaded');
      return;
    }
    requestAnimationFrame(function () {
      /* 双 rAF ✗✓：同一帧里 append + 改类会被合成一次 ✓，浏览器看不到 opacity:0 这个起点 ✓
         ⇒ 直接跳终态、没有过渡 ✓（CSS transition 的经典坑 ✓）。 */
      requestAnimationFrame(function () {
        if (!img.isConnected) return;
        stats.faded += 1;
        img.classList.add('is-in');
        setTimeout(function () { slot.classList.add('is-loaded'); }, FADE_MS + 60);
      });
    });
  }

  /* ① 项目内映射（本地、不联网）：优先于任何网络源 */
  function localIcon(host) {
    var own = PROJECT_ICONS[host];
    if (own) return own;
    var ext = window.CODESCOPE_SITE_ICONS;
    return ext && typeof ext === 'object' && typeof ext[host] === 'string' ? ext[host] : '';
  }

  /* 真正发一次图标请求（走闸门）。cached=true 表示 src 来自 localStorage 里该 host 的条目 */
  function request(slot, host, src, cached) {
    stats.attempts += 1;
    if (cached) stats.cachedHits += 1; else stats.serviceHits += 1;
    enqueue(function run(next) {
      var img = new Image();
      var settled = false;
      var timer = setTimeout(function () {   /* 网络卡住：摘掉，别占坑位 */
        if (settled) return;
        settled = true;
        img.onload = img.onerror = null;
        stats.failed += 1;
        mark(slot, 'failed');
        next();
      }, LOAD_TIMEOUT);

      img.onload = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        /* 记「这次真正用的 URL」（跨域 302 拿不到最终地址，见文件头缓存那节）*/
        var resolved = img.currentSrc || img.src || src;
        if (host) writeCache(host, resolved);
        memory[host] = { src: resolved, ok: true, at: Date.now(), img: img };
        stats.loaded += 1;
        if (slot.isConnected) attach(slot, img);
        next();
      };

      img.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stats.failed += 1;
        /* 服务端已经把回源那一跳试过了 ✓（3s 超时 + 404 ✓）—— 它说拿不到就是真拿不到 ✓，
           **不再重试** ✗：以前缓存的是第三方 URL ✓，「缓存失效 → 用服务地址再问一次」有意义 ✓；
           现在缓存的就是同一个本机 URL ✓，重试只会把 404 再问一遍 ✓，白多一次请求 ✗。
           只把本地那条记录清掉（服务端将来补上盘上缓存后还能再试 ✓），然后回落彩点 ✓。 */
        if (host) {
          dropCache(host);
          memory[host] = { src: '', ok: false, at: Date.now() };
        }
        mark(slot, 'failed');      /* 回落：<i> 里那颗彩点原样留着 */
        next();
      };

      img.src = src;
    });
  }

  function processCard(card) {
    var slot = iconSlot(card);
    if (!slot) return false;
    var current = state(slot);
    if (current === 'ok' || current === 'loading') return false;   /* 已处理 / 正在处理 */

    var host = hostOf(card);
    if (!isPublicHost(host)) {
      /* 内网 / 保留地址 / 取不到域名：不请求，彩点原样保留（也不外泄域名）*/
      stats.skipped += 1;
      mark(slot, 'skipped');
      return false;
    }

    if (current === 'failed') {
      var memoFail = memory[host];
      if (memoFail && memoFail.at && Date.now() - memoFail.at < NEGATIVE_TTL) return false;  /* 60s 内不重试 */
    }

    stats.cards += 1;

    /* ① 项目内已有映射 → 本地直接出图，不排队、不联网 */
    var local = localIcon(host);
    if (local) {
      stats.localHits += 1;
      var localImg = new Image();
      localImg.onload = function () { attach(slot, localImg); };
      localImg.src = local;
      mark(slot, 'ok');
      return true;
    }

    /* ③ 缓存：内存（同一次会话）再到 localStorage（跨会话）*/
    var memo = memory[host];
    if (memo && memo.ok && memo.src) {
      stats.cached += 1;
      /* ★ 页面内缓存的最强形态：**复用那个已经解码好的 <img> 元素**。
         弹窗每次打开都是 replaceChildren 重渲染，旧卡片被摘掉但图片元素还在
         （memory 持有引用）—— 把它 append 到新槽位是「移动节点」，浏览器
         不会重新解码、也不会发请求（实测清空浏览器 HTTP 缓存后仍是 0 个请求）。
         只在旧位置已经脱离文档时复用，避免同一 host 出现两张卡片时把图抢走。*/
      if (memo.img && memo.img.complete && memo.img.naturalWidth > 0 &&
          !(memo.img.parentNode && memo.img.parentNode.isConnected)) {
        stats.reused += 1;
        attach(slot, memo.img);
        return true;
      }
      mark(slot, 'loading');
      request(slot, host, memo.src, true);
      return true;
    }
    var stored = readCache(host);
    if (stored) {
      stats.cached += 1;
      memory[host] = { src: stored, ok: true, at: Date.now() };
      mark(slot, 'loading');
      request(slot, host, stored, true);
      return true;
    }

    /* ② 冷启动：走本机代理 ✓（首次它替我们回源一次 ✓ 并写盘 ✓；之后就是纯读盘 ✓）*/
    mark(slot, 'loading');
    request(slot, host, iconUrl(host), false);
    return true;
  }

  function scan(container) {
    var cards = container.querySelectorAll(CARD_SELECTOR);
    var touched = 0;
    for (var i = 0; i < cards.length; i += 1) {
      if (processCard(cards[i])) touched += 1;
    }
    if (touched) stats.opens += 1;
    return touched;
  }

  /* ═══ 观察 #quick-sites ════════════════════════════════════════════════ */

  function bind(container) {
    if (bound) return true;
    bound = true;
    scan(container);                       /* 首次（脚本 defer，容器已在 DOM 里）*/
    var observer = new MutationObserver(function (records) {
      var dirty = false;
      for (var i = 0; i < records.length; i += 1) {
        if (records[i].addedNodes && records[i].addedNodes.length) { dirty = true; break; }
        if (records[i].removedNodes && records[i].removedNodes.length) { dirty = true; break; }
      }
      if (dirty) scan(container);          /* 弹窗每次打开都会 replaceChildren，这里接手 */
    });
    observer.observe(container, { childList: true, subtree: true });
    window.__siteIcons.observer = observer;
    return true;
  }

  function start() {
    var container = document.getElementById(CONTAINER_ID);
    if (container) { bind(container); return; }
    /* 容器还没渲染：等 DOM 就绪再试一次（正常情况下 defer 已经够用）*/
    document.addEventListener('DOMContentLoaded', function () {
      var again = document.getElementById(CONTAINER_ID);
      if (again) bind(again);
    }, { once: true });
  }

  /* ── 调试 / 取证接口（验收用：DOM 证据、请求计数、并发峰值）────────────── */
  window.__siteIcons = {
    version: 2,                       /* 2 = 走本机 /api/favicon 代理（磁盘缓存）*/
    source: SERVICE,
    endpoint: function (host) { return iconUrl(host); },
    fadeMs: FADE_MS,
    concurrency: CONCURRENCY,
    reduceMotion: reduceMotion,
    stats: function () {
      return {
        opens: stats.opens, cards: stats.cards, attempts: stats.attempts,
        serviceHits: stats.serviceHits, cachedHits: stats.cachedHits,
        localHits: stats.localHits, cached: stats.cached, reused: stats.reused, loaded: stats.loaded,
        failed: stats.failed, skipped: stats.skipped, faded: stats.faded,
        peak: stats.peak, inflight: active, queued: queue.length,
        cacheSize: cacheSize()
      };
    },
    reset: function () {
      for (var k in stats) if (Object.prototype.hasOwnProperty.call(stats, k)) stats[k] = 0;
      memory = Object.create(null);
      boundImgs = new WeakSet();
    },
    /* 只清计数、保留页面内缓存（验收要能区分「计数归零」与「缓存失效」两件事）*/
    resetStats: function () {
      for (var k in stats) if (Object.prototype.hasOwnProperty.call(stats, k)) stats[k] = 0;
    },
    clearCache: function () {
      try {
        var keys = [];
        for (var i = 0; i < window.localStorage.length; i += 1) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
        }
        keys.forEach(function (k) { window.localStorage.removeItem(k); });
      } catch (e) {}
      memory = Object.create(null);
    },
    scan: function () {
      var c = document.getElementById(CONTAINER_ID);
      return c ? scan(c) : 0;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
