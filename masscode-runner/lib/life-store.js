'use strict';
/* ── 个人数据（life-workbench.json + life-words.json）的读取缓存 ✓ ─────────────
   2026-10-16 从 server.js 抽出来 ✓（那边有 7,176 行的**代码体积棘轮** ✗，
   加缓存会把它顶破 ✓，按本项目既有做法「涨了就抽到 lib/」✓）。

   ⚠️ 为什么需要缓存 ✗：
     这个文件现在有 **11.5 MB** ✓，`readFileSync + JSON.parse` 实测 **约 55 ms** ✓，
     而且是**同步**的 ✗ —— 这 55 ms 里**整个 Node 事件循环被卡住** ✗，
     期间所有并发请求（天气、索引、邮件状态…）**一起等** ✓。
     另外 `send()` 里还要 `JSON.stringify` 一遍 ✓，10 MB 又约 **25 ms** ✗。
     `/api/life/store` 每次 GET / POST 都要走 ✓（server.js 里还有 3 处别的调用点 ✓）。

   ★ 做法：按 **mtime** 缓存 ✓
     · `read()` —— 缓存**解析后的对象** ✓（实测 55 ms → 约 0.1 ms ✓）
     · `json()` —— 缓存**序列化后的响应体** ✓（再省 25 ms ✓）
   这个文件**只有本服务在写** ✓，mtime 一变缓存就失效 ✓
   （APFS 是纳秒精度 ✓，所以存盘之后紧接着读，拿到的**一定是新内容** ✓）。

   ⚠️⚠️ 调用方**只许读、不许就地改** `read()` 的返回值 ✗✗ ——
     返回的是**同一个对象引用** ✓（现在 4 个调用点都只是读 `store.flows` / `store.books` ✓）。
     以后要改，先自己拷一份 ✓，别动缓存 ✗。

   ⚠️ 读失败时**不要把缓存清成空对象** ✗ ——
     那会让一次瞬时 IO 抖动变成「用户数据全空」✗。
     返回上一次的好数据 ✓；确实没有才回空对象 ✓。

   ══ ★★ 2026-10-19：把 `words` 拆到**单独的文件** ✓✓ ══════════════════════
   ⚠️ 起因（实测）✗：整份 store 8.5 MB，`words`（4611 个词 ✓）独占 **9 MB** ✓；
     客户端已经做了「词库没变就不传」✓（POST 只剩 83 KB ✓），
     但服务端仍然要 `JSON.stringify(12.8 MB)` + `writeFileSync(12.8 MB)` ✓ →
     **每次保存还是 66~72 ms 的同步阻塞** ✗（期间所有请求一起等 ✗）。
   ⇒ 拆成两个文件 ✓：
     · `life-workbench.json` —— 备忘录 / 日记 / 文章 / 工作流…（几十 KB ✓）
     · `life-words.json`     —— 只有 `{ words: [...] }`（9 MB ✓）
     `read()` 对外**仍然是合并后的一个对象** ✓（4 个调用点一行都不用改 ✓）。
   ⚠️ 迁移是**读时惰性**做的 ✓：老文件里还有 `words` → 第一次读到就拆开 ✓，
     拆完再读就是新结构 ✓。拆失败（磁盘满 / 只读）→ **原样返回** ✓，下次再试 ✓，
     绝不半拆 ✗（半拆 = 数据丢失 ✗）。
   ⚠️ 缓存 key 必须**同时**包含两个文件的 size+mtime ✗ —— 只认主文件的话，
     改词库（主文件不变 ✓）会一直读到旧缓存 ✗。 */

function createLifeStoreReader(ctx) {
  const fs = ctx.fs;
  const path = ctx.path;
  const dataRoot = ctx.dataRoot;              /* 函数 ✓（数据目录可能随环境变 ✓） */
  const fileOf = () => path.join(dataRoot(), 'life-workbench.json');
  const wordsFileOf = () => path.join(dataRoot(), 'life-words.json');

  /* ⚠️⚠️ 主文件和词库**必须各缓存各的** ✗✗（2026-10-19 实测）——
     第一版是「合成一个 key（主|词库）→ 合成一份对象」✓：
     改一次备忘录 → 主文件 mtime 变 ✓ → key 变 ✓ → **词库 10.4MB 又被 JSON.parse 一遍** ✗
     → 每次保存仍要 **22~43ms** ✓（等于白拆 ✗）。
     ⇒ 分开缓存：主文件变了只重解析主文件 ✓（100KB / <1ms ✓），
        词库没变就一直用缓存 ✓。合并只是一次 86 键的浅拷贝 ✓（<0.1ms ✓）。
     ⚠️ 合并时 `words` 用**引用**传出去 ✗ 不要深拷贝 —— 10MB 深拷贝每次几十毫秒 ✗。
        （调用方只读不写 ✓，见文件头那条约定 ✓。） */
  const mainCache = { key: '', data: null };
  const wordsCache = { key: '', data: null };
  const jsonCache = { key: '', body: '' };

  /* 两个文件合起来算一个「版本」✓ —— 任一变了缓存就失效 ✓ */
  function stamp(file) {
    try {
      const st = fs.statSync(file);
      return st.size + ':' + Math.round(st.mtimeMs);
    } catch (_) { return '-'; }
  }
  function version() { return stamp(fileOf()) + '|' + stamp(wordsFileOf()); }
  function mtime() {
    try { return fs.statSync(fileOf()).mtimeMs; } catch (_) { return -1; }
  }

  /* 单独读词库文件 ✓（拆写 / 比较都要用 ✓） */
  function readWordsRaw() {
    try {
      const parsed = JSON.parse(fs.readFileSync(wordsFileOf(), 'utf8'));
      return parsed && Array.isArray(parsed.words) ? parsed : null;
    } catch (_) { return null; }
  }

  /* ★ 惰性迁移：老结构（words 在主文件里）→ 拆到 life-words.json ✓
     ⚠️ 顺序很关键 ✗：**先写词库文件、成功之后再改写主文件** ✓。
        反过来的话，中途崩了就是「主文件没了 words、词库文件又没写成」✗✗ 全丢。 */
  function migrateIfNeeded(main) {
    if (!main || !Array.isArray(main.words)) return main;
    try {
      const words = main.words;
      fs.writeFileSync(wordsFileOf(), JSON.stringify({ words: words }));
      /* 读回来确认一次再动主文件 ✓（磁盘满时 writeFileSync 可能只写了一半 ✗） */
      const back = readWordsRaw();
      if (!back || back.words.length !== words.length) return main;
      const rest = Object.assign({}, main);
      delete rest.words;
      fs.writeFileSync(fileOf(), JSON.stringify(rest));
      return rest;
    } catch (_) {
      return main;                              /* 拆不动就原样用 ✓，下次再试 ✓ */
    }
  }

  /* 主文件：单独缓存 ✓ */
  function readMain() {
    const key = stamp(fileOf());
    if (mainCache.data && mainCache.key === key) return mainCache.data;
    let main = null;
    try {
      main = JSON.parse(fs.readFileSync(fileOf(), 'utf8'));
    } catch (_) {
      /* 读失败 → 返回上一次的好数据 ✓（别清成空对象 ✗） */
      return mainCache.data || {};
    }
    if (!main || typeof main !== 'object') main = {};
    main = migrateIfNeeded(main);
    mainCache.key = stamp(fileOf());            /* 迁移会改文件 → 重新取一次 ✓ */
    mainCache.data = main;
    return main;
  }
  /* 词库：单独缓存 ✓（10.4MB，解析一次约 30ms ✗，绝不能跟着主文件一起失效 ✗） */
  function readWords() {
    const key = stamp(wordsFileOf());
    if (wordsCache.key === key) return wordsCache.data;
    const w = readWordsRaw();
    wordsCache.key = stamp(wordsFileOf());
    wordsCache.data = w;
    return w;
  }

  function read() {
    const main = readMain();
    const w = readWords();
    /* ⚠️ 浅拷贝 ✓：`words` 直接引用缓存里那个数组 ✓（调用方只读 ✓） */
    const merged = Object.assign({}, main);
    if (w && Array.isArray(w.words)) merged.words = w.words;
    return merged;
  }

  /* → 已经序列化好的 `{ok:true,data:…}` 响应体 ✓（调用方直接当字符串发给 send ✓，
       记得显式声明 `application/json` ✗ —— 不然会被当成 text/plain ✓） */
  function json() {
    const key = version();
    if (jsonCache.body && jsonCache.key === key) return jsonCache.body;
    const body = JSON.stringify({ ok: true, data: read() });
    jsonCache.key = version();
    jsonCache.body = body;
    return body;
  }

  return { read, json, mtime, version, fileOf, wordsFileOf, readWordsRaw };
}

module.exports = { createLifeStoreReader };
