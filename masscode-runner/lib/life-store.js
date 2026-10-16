'use strict';
/* ── 个人数据（life-workbench.json）的读取缓存 ✓ ──────────────────────────────
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
     返回上一次的好数据 ✓；确实没有才回空对象 ✓。 */

function createLifeStoreReader(ctx) {
  const fs = ctx.fs;
  const path = ctx.path;
  const dataRoot = ctx.dataRoot;              /* 函数 ✓（数据目录可能随环境变 ✓） */
  const fileOf = () => path.join(dataRoot(), 'life-workbench.json');

  const cache = { mtimeMs: -1, data: null };
  const jsonCache = { mtimeMs: -1, body: '' };

  function mtime() {
    try { return fs.statSync(fileOf()).mtimeMs; } catch (_) { return -1; }
  }

  function read() {
    try {
      const t = fs.statSync(fileOf()).mtimeMs;      /* stat 很便宜 ✓（约 0.01 ms ✓） */
      if (cache.data && cache.mtimeMs === t) return cache.data;
      const data = JSON.parse(fs.readFileSync(fileOf(), 'utf8'));
      cache.mtimeMs = t;
      cache.data = data;
      return data;
    } catch (_) {
      return cache.data || {};
    }
  }

  /* → 已经序列化好的 `{ok:true,data:…}` 响应体 ✓（调用方直接当字符串发给 send ✓，
       记得显式声明 `application/json` ✗ —— 不然会被当成 text/plain ✓） */
  function json() {
    const t = mtime();
    if (jsonCache.body && jsonCache.mtimeMs === t) return jsonCache.body;
    const body = JSON.stringify({ ok: true, data: read() });
    jsonCache.mtimeMs = t;
    jsonCache.body = body;
    return body;
  }

  return { read, json, mtime, fileOf };
}

module.exports = { createLifeStoreReader };
