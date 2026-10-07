#!/usr/bin/env node
/**
 * 码境 CodeScope —— 工程代码工作台
 * 兼容读取 massCode Markdown Vault，为代码与文档提供阅读、编辑、运行和远程开发能力。
 * Node 本地服务；代码运行/格式化调用系统工具，VNC 使用 noVNC + ws。
 */
'use strict';

const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');
const { Transform } = require('stream');
const { spawn, exec, execFile, execFileSync } = require('child_process');
const { pipeline } = require('stream/promises');
const { WebSocketServer } = require('ws');
const { Client: SshClient } = require('ssh2');
const { SaxesParser } = require('saxes');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const htmlToDocx = require('@turbodocx/html-to-docx');
const { createLspService } = require('./lib/lsp-service');
const { applyPortableToolPath, bundledGopls, nodeTool, packageVersion } = require('./lib/tool-runtime');
const { createOfficeEngine } = require('./lib/office-engine');
const { createDshService } = require('./lib/dsh-service');
const { createOpencodeService } = require('./lib/opencode-service');
const { createCodeServerService } = require('./lib/code-server-service');
const { createCodeServerProxy } = require('./lib/code-server-proxy');
const { createKnowledgeBase } = require('./lib/knowledge-base');
/* 极简 SMTP 客户端（只依赖 Node 内置 tls/net）—— 用于「邮箱」页的测试连接与发信 ✓ */
const MAIL_CLIENT = require('./lib/mail-client');
const MAIL_IMAP = require('./lib/imap-client');
const MAIL_MIME = require('./lib/mime');
const MAIL_LIST = require('./lib/mail-list');
const WORKFLOW = require('./lib/workflow');
const HOT = require('./lib/hot');
const EN_TEXT = require('./lib/en-text.js');   /* 外刊精读：抽正文 / 分句 / 取词（纯逻辑 ✓） */
const SRS = require('./lib/srs.js');           /* 外刊精读：遗忘曲线复习调度（纯逻辑 ✓） */
const EN_SOURCES = require('./lib/en-sources.js');   /* 外刊精读：推荐外刊源（RSS ✓ 实测过的 ✓） */
const FLOW_SCHED = require('./lib/flow-schedule.js');   /* 工作流定时排期（纯逻辑 ✓） */
/* ★ 只把**这几个**纯逻辑模块暴露给浏览器 ✓（**白名单** ✓，不是把整个 lib/ 敞开 ✗）。
   它们都是「双栖」的 ✓：Node 里 require 拿到 ✓、浏览器里挂 window.LW_xxx ✓ ——
   目的是让**前后端用同一份逻辑** ✗：分句规则、复习间隔这种东西抄两遍必然走偏 ✗，
   而且走偏了用户根本查不出来 ✗（只会觉得「这软件不准」✗）。 */
const SHARED_LIB_FILES = ['en-text.js', 'srs.js', 'expr.js', 'flow-schedule.js', 'en-sources.js'];
/* 收信的缓存 ✓ —— 每次请求都新建一条 TLS 连接要 1~3 秒 ✗，
   而顶栏的未读数还会定时轮询 ✗，不缓存等于反复重连邮箱服务器 ✗。
   `status` 缓存久一点（未读数不需要秒级实时 ✓），`list` 短一点（用户在看列表时要新鲜 ✓）。
   读信 / 改标记后会 `clear()` 掉 ✓，保证「点开一封 → 列表里那封变已读」是立刻生效的 ✓。 */
const MAIL_STATUS_CACHE = new Map();
const MAIL_LIST_CACHE = new Map();
const MAIL_STATUS_TTL = 60e3;
const MAIL_LIST_TTL = 20e3;
/* ★ 失败账号的**负缓存** ✓ —— 本机到 imap.gmail.com 是不通的（TCP 超时），
   而顶栏每次刷新未读数都会去连它 ✗ → 整个 /status 被拖到 5~15 秒 ✗。
   连不上就记下来，5 分钟内不再重试（直接返回上次的错误）✓，
   这样「一个坏账号」不会把「其他好账号」的未读数一起拖慢 ✓。 */
const MAIL_FAIL_CACHE = new Map();
const MAIL_FAIL_TTL = 5 * 60e3;
const { createSystemPanel } = require('./lib/system-panel');
const { buildCodeGraph, buildDocumentGraph, buildSnippetIndex, resolveDefinition } = require('./lib/code-graph');
const { buildLogicGraph, logicToDrawio, logicToSkeleton } = require('./lib/logic-graph');
const Ruff = require('@astral-sh/ruff-wasm-nodejs');
applyPortableToolPath();
const APP_VERSION = require('./package.json').version;
const APP_MODE = process.env.CODESCOPE_APP_MODE === 'desktop' ? 'desktop' : 'web';

function applicationDataRoot() {
  if (process.env.CODESCOPE_DATA_HOME) return path.resolve(process.env.CODESCOPE_DATA_HOME);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support', 'CodeScope');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'CodeScope');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'CodeScope');
}
/* ── 工作台数据的轮转备份 ✓ ────────────────────────────────────────────────
   为什么需要：备忘录曾经被写串过（bug 已修），而当时**没有任何历史版本可恢复** ✗ ——
   用户的备忘录内容就这么没了 ✗。留一层安全网：写盘前轮转快照 ✓。
   · 最多 5 分钟一份（打字时每 300ms 就写一次，不设间隔会把备份全冲掉 ✗）
   · 保留 6 份 ≈ 半小时窗口 ✓
   · 只存本机同目录，不上传 ✓ */
const STORE_BAK_MAX = 6;
const STORE_BAK_MIN_GAP = 5 * 60e3;
function rotateStoreBackup(file) {
  if (!fs.existsSync(file)) return;
  const dir = path.dirname(file);
  const bakOf = (i) => path.join(dir, 'life-workbench.bak.' + i + '.json');
  let newest = 0;
  for (let i = 0; i < STORE_BAK_MAX; i++) {
    try { newest = Math.max(newest, fs.statSync(bakOf(i)).mtimeMs); } catch (_) { }
  }
  if (newest && Date.now() - newest < STORE_BAK_MIN_GAP) return;
  for (let i = STORE_BAK_MAX - 1; i > 0; i--) {
    try { fs.renameSync(bakOf(i - 1), bakOf(i)); } catch (_) { }
  }
  fs.copyFileSync(file, bakOf(0));
}
const ONLYOFFICE_CONNECTION_FILE = path.join(applicationDataRoot(), 'office-connection.json');

/* ══════════════════════════════════════════════════════════════════════════
   工作流「定时触发」的服务端排期 ✓
   ══════════════════════════════════════════════════════════════════════════
   ★ 为什么单独一个文件存状态 ✗（不写进 life-workbench.json ✗）
     前端保存是**整份覆盖**的（`saveStore()` 直接 POST 整个 STORE ✓）——
     服务端要是也往那个文件里写 ✗，两边会互相盖 ✗：
     09:00 定时跑了、写了一条备忘录 ✓，09:01 用户点了下收藏 → 整份旧数据覆盖回去 ✗，
     那条备忘录就**无声无息没了** ✗✗。
   → 所以服务端**只写自己的文件** ✓，跑完把「产出」放进 **outbox** ✓；
     前端下次打开面板（或每 60 秒）来取 ✓、应用 ✓、回执清掉 ✓。
     **谁的数据谁写** ✗ —— 这条比「省一次网络往返」重要得多 ✓。

   ⚠️ 另一个刻意的取舍：**同一时刻只跑一个** ✗（`FLOW_TICK_BUSY` ✓）——
      定时工作流要是很慢（比如 AI 要 30 秒 ✓），30 秒的 tick 会叠上去 ✗，
      越叠越多最后把机器拖死 ✗。
   ══════════════════════════════════════════════════════════════════════════ */
const FLOW_SCHED_FILE = path.join(applicationDataRoot(), 'life-flow-schedule.json');
const FLOW_TICK_MS = 30000;
const FLOW_OUTBOX_MAX = 50;
let FLOW_TICK_BUSY = false;
let FLOW_TICK_TIMER = null;

function readFlowSched() {
  try {
    const raw = JSON.parse(fs.readFileSync(FLOW_SCHED_FILE, 'utf8'));
    return {
      last: (raw && raw.last) || {},
      ai: (raw && raw.ai) || null,
      seq: Number(raw && raw.seq) || 0,
      outbox: Array.isArray(raw && raw.outbox) ? raw.outbox : [],
    };
  } catch (_) { return { last: {}, ai: null, seq: 0, outbox: [] }; }
}
function writeFlowSched(st) {
  try {
    fs.mkdirSync(path.dirname(FLOW_SCHED_FILE), { recursive: true });
    fs.writeFileSync(FLOW_SCHED_FILE, JSON.stringify(st, null, 2));
  } catch (error) { console.log('[flow-sched] 写状态失败：' + String((error && error.message) || error)); }
}
function readLifeStore() {
  try { return JSON.parse(fs.readFileSync(path.join(applicationDataRoot(), 'life-workbench.json'), 'utf8')); } catch (_) { return {}; }
}
/* ★★ 外刊源的 feed 走「curl 优先、fetch 兜底」✗✗ —— 为什么 ✗：
   本机实测（同一台机器、同一个地址、同一时间）：
     · `feeds.npr.org/1004/rss.xml` —— Node 的 fetch **7~30 秒，而且经常直接超时** ✗；
       `curl` 同一个地址 **0.9 秒** ✓（加 `--noproxy '*'` 也是 1.6 秒 ✓，所以不是代理的事 ✗）。
     · 其余 22 个源 fetch 都正常 ✓（0.4~4.3 秒 ✓）—— 就 NPR 这一家这样 ✗。
   而 NPR 正好是**列表里第一个源** ✗（打开面板会自动拉它 ✗）→ 一超时就是
   「点了没反应」✗，用户根本不知道是这家的 feed 慢 ✗。
   → 和上面天气那条同一个思路 ✓（那边是 fetch 失败用 curl 兜底 ✓），
     这里干脆**把 curl 放前面** ✓：它更快也更稳 ✓，fetch 只在没有 curl 的环境兜底 ✓。
   ⚠️ 这段**只能待在 server.js** ✗ —— lib/en-sources.js 是**双栖**的 ✓
      （浏览器里也加载 ✓），不能 require child_process ✗。
      所以那边只负责「解析 + 缓存 + 报错」✓，IO 策略留在这一层 ✓。
   ⚠️ 用 execFile（不走 shell ✓）—— URL 里的 & 之类不会被当命令执行 ✓。 */
const FEED_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function feedFetch(url, opt) {
  const want = {
    'User-Agent': FEED_UA,
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  /* ① curl（首选 ✓） */
  try {
    const out = await new Promise((resolve, reject) => {
      require('child_process').execFile(
        'curl',
        ['-sS', '-m', '25', '-L', '-A', want['User-Agent'], '-H', 'Accept: ' + want.Accept, url],
        { maxBuffer: 8e6, timeout: 30000 },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout)))
      );
    });
    if (out && out.length > 40) return { ok: true, status: 200, text: async () => out };
    throw new Error('curl 返回空');
  } catch (_) { /* 落到 fetch ✓ */ }
  /* ② fetch 兜底 ✓（没有 curl 的环境 / curl 被限制时 ✓） */
  const r = await fetch(url, Object.assign({}, opt, { headers: want }));
  const t = await r.text();
  return { ok: r.ok, status: r.status, text: async () => t };
}
/* ── 微信读书：**官方 Agent API** ✓（比扒 Cookie 靠谱得多 ✓）──────────────────
   ★ 用户给了官方 Key 之后才接上的 ✓（原来只有「扒网页 Cookie」一条路 ✗）。
   官方文档：https://github.com/Tencent/WeChatReading（`skills/SKILL.md` ✓）。
     · 统一入口：`POST https://i.weread.qq.com/api/agent/gateway`
     · 鉴权：`Authorization: Bearer wrk-xxxx` ✓（绑定用户身份 ✓，不用再传 vid ✓）
     · Body：`{ api_name, skill_version, ...业务参数**平铺在顶层** }`
       ⚠️⚠️ **不能包在 `params` 里** ✗✗ —— 包了的话参数**不会被转发** ✗，
          后端按默认值返回第一页 ✗ → 看起来像「分页失效」✗（官方文档专门点名了这个 ✗）。
     · 回包：**顶层直接是业务字段** ✓（没有 `data` 包裹 ✓），`errcode` 非 0 即错误 ✓。
   ⚠️ 每次请求都要带 `skill_version` ✗ —— 它是**官方用来提示升级**的 ✓。
      回包里出现 `upgrade_info` 时按官方要求应当**暂停并升级** ✓；
      我们是个长期在跑的服务 ✗，没法自动装 skill ✗ →
      **把它透传给前端提示用户** ✓（比静默忽略强 ✓，也比假装没事强 ✓）。
   ⚠️ 和 Cookie 那条路的**区别**（实测）：
      · Key 路径：稳定 ✓、字段全 ✓（deepLink / category / finishReading / albums ✓）
      · Cookie 路径：网页版一登出就失效 ✗（用户这次就是撞上这个 ✗）
      → 所以**Key 优先** ✓，Cookie 留着当兜底 ✓。 */
const WEREAD_GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
const WEREAD_SKILL_VERSION = '1.0.4';   /* ⚠️ 官方 skill 升级后这个值要跟着改 ✗（见上面 upgrade_info ✓） */
async function wereadGateway(key, apiName, params) {
  const body = Object.assign({ api_name: apiName, skill_version: WEREAD_SKILL_VERSION }, params || {});
  const r = await fetch(WEREAD_GATEWAY, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch (_) {}
  if (!j) throw new Error('微信读书官方接口返回的不是 JSON（HTTP ' + r.status + '）：' + String(text).slice(0, 120));
  return j;
}
/* ⚠️ `progress` 的口径**踩过一次** ✗：官方文档写明是 **0~100 的整数** ✓，
   而且专门点了一句「**1 表示 1%，不是 100%**」✓ ——
   而网页版 Cookie 那条路（`shelf/sync` 的 `bookProgress`）给的是 **0~1 的小数** ✗。
   两条路**口径不一样** ✗，所以归一化必须**分开写** ✗（统一 `*100` 会把 1% 变成 100% ✗，
   也就是「刚翻了两页的书」显示成「已读完」✗ —— 用户一眼就看出来了 ✗）。 */
const wereadPct = (v, isWebApi) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(isWebApi ? n * 100 : n)));
};
/* 官方回包里出现 `upgrade_info` 就说明 skill 版本旧了 ✓ ——
   官方要求「暂停并升级」✗，但我们是个常驻服务 ✗、装不了 skill ✗ →
   至少**别装作没看见** ✓：透传给前端提示一句 ✓。 */
function wereadUpgradeNote(j) {
  const u = j && j.upgrade_info;
  if (!u) return '';
  const m = String(u.message || u.msg || u.version || '').replace(/\s+/g, ' ').trim();
  return '官方 skill 提示要升级' + (m ? '：' + m.slice(0, 200) : '') + '（当前上报版本 ' + WEREAD_SKILL_VERSION + '）';
}
/* 进度要**逐本**问 ✓ —— `/shelf/sync` 不返回进度 ✗（网页版那条路才带 `bookProgress` ✗）。
   ⚠️ 但**不能无上限** ✗✗：书架 200 本 = 200 个请求 ✗，会把同步拖到几十秒 ✗，
      用户以为卡死了 ✗。→ 封顶 40 本 + 并发 6 ✓；
      ⚠️ 单本失败**不影响整次同步** ✓（当它没进度 ✓，不抛 ✗）。 */
async function wereadProgressMap(apiKey, books) {
  const map = new Map();
  const ids = (books || []).map((b) => String((b && b.bookId) || '')).filter(Boolean).slice(0, 40);
  const CONC = 6;
  for (let i = 0; i < ids.length; i += CONC) {
    const got = await Promise.all(ids.slice(i, i + CONC).map((id) => wereadGateway(apiKey, '/book/getprogress', { bookId: id })
      .then((r) => ({ id, p: Number((r && r.book && r.book.progress)) }))
      .catch(() => null)));
    got.forEach((x) => { if (x && Number.isFinite(x.p)) map.set(x.id, wereadPct(x.p, false)); });
  }
  return map;
}
/* ★ 官方 Key 通道 ✓（**优先** ✓） */
async function wereadByKey(apiKey) {
  if (!/^wrk-/.test(apiKey)) {
    return { ok: false, error: 'API Key 应该以 wrk- 开头 —— 去官方「快速配置」页把整串复制过来（别只复制一半）' };
  }
  if (apiKey.length > 200) return { ok: false, error: 'API Key 太长（不该超过 200 个字符）' };
  try {
    const j = await wereadGateway(apiKey, '/shelf/sync');
    const code = Number(j.errcode || 0);
    if (code) {
      const msg = String(j.errmsg || j.errMsg || '');
      let why = '';
      /* ★★ 错误码是**实测**出来的 ✗（不是猜的 ✓）：
         `-2013 鉴权失败` = Key 无效 / 过期 ✓（用假 Key 打出来的 ✓）；
         `-2010 用户不存在` = **压根没带** Key ✓（空 Authorization 打出来的 ✓）；
         `-2003 参数格式错误` = 多半 `skill_version` 和官方对不上 ✓。
         ⚠️ 而且**每条都要带「下一步做什么」** ✗✗ ——
            只说「鉴权失败」的话用户根本不知道是「Key 错了」还是「微信读书挂了」✗
            （实测：探针里假 Key 只回一句「鉴权失败」，用户看了等于没说 ✗）。 */
      if (code === -2013 || /鉴权失败/.test(msg)) {
        why = '这个 API Key 无效或已过期 —— 去官方「快速配置」页重新复制一串 ✓'
          + '（如果那一页显示「已使用过」，点「重置 Key」再复制新的 ✓）';
      } else if (code === -2010 || /用户不存在/.test(msg)) {
        why = '官方接口说「用户不存在」—— 多半是 Key 没带上（复制的时候少了一截？）✓ 重新复制一次试试';
      } else if (code === -2003) {
        why = '官方接口说参数不对（errcode -2003）—— 多半是官方 skill 升级了，'
          + '去 github.com/Tencent/WeChatReading 看看有没有新版本（当前上报 ' + WEREAD_SKILL_VERSION + '）';
      } else if (/过期|expire/i.test(msg)) {
        why = '这个 API Key 过期了 —— 去官方页重新生成一串 ✓';
      } else {
        why = '微信读书返回：' + (msg || ('errcode ' + code))
          + '（errlog ' + String(j.errlog || '-') + '）—— 复制错误码去官方仓库问问，'
          + '或者换回 Cookie 那条路试试 ✓';
      }
      return { ok: false, error: why };
    }
    const rawBooks = Array.isArray(j.books) ? j.books : [];
    const rawAlbums = Array.isArray(j.albums) ? j.albums : [];
    if (!rawBooks.length && !rawAlbums.length && !j.mp) {
      return { ok: false, error: '连上了，但书架是空的 —— 确认一下这个 Key 对应的账号里有没有书' };
    }
    const prog = await wereadProgressMap(apiKey, rawBooks);
    const out = rawBooks.map((b) => {
      if (!b) return null;
      const title = String(b.title || '').trim();
      if (!title) return null;
      return {
        title,
        author: String(b.author || '').trim(),
        cover: /^https:\/\//.test(String(b.cover || '')) ? String(b.cover) : '',
        prog: prog.get(String(b.bookId)) || 0,
        /* ★ 官方多给了这些 ✓ —— 顺手带上 ✓（前端能显示「最近读过」「分类」「跳转原文」✓） */
        deepLink: String(b.deepLink || ''),
        category: String(b.category || ''),
        done: Number(b.finishReading) === 1,
        at: Number(b.readUpdateTime || 0) * 1000,
        bookId: String(b.bookId || ''),
      };
    }).filter(Boolean);
    /* 专辑 = 有声书 ✓（官方文档专门强调：它和 `books` **完全独立** ✗，
       算「书架里有多少本」时必须一起算 ✓，否则用户会觉得「少了好几本」✗）。 */
    const albums = rawAlbums.map((a) => {
      const info = (a && a.albumInfo) || {};
      const name = String(info.name || '').trim();
      if (!name) return null;
      return {
        title: name,
        author: String(info.authorName || '').trim(),
        cover: /^https:\/\//.test(String(info.cover || '')) ? String(info.cover) : '',
        prog: 0, kind: 'album',
        note: String(info.trackCount ? info.trackCount + ' 集' : '') + (Number(info.finish) === 1 ? ' · 已完结' : ''),
        category: '有声书',
        bookId: String(info.albumId || ''),
      };
    }).filter(Boolean);
    return {
      ok: true, via: 'key',
      /* ⚠️ 「书架有多少本」的口径按官方文档来 ✗：
         `books + albums + (mp 非空 ? 1 : 0)` ✓ —— 少算 mp 会差一个「文章收藏」✓。 */
      count: out.length + albums.length + (j.mp ? 1 : 0),
      books: out, albums,
      hasMp: !!j.mp,
      warning: wereadUpgradeNote(j),
    };
  } catch (error) {
    const why = String((error && error.message) || error);
    return { ok: false, error: /abort|timeout/i.test(why) ? '连微信读书官方接口超时（网络不通？）' : ('连不上微信读书官方接口：' + why) };
  }
}
/* Cookie 通道 ✓（**兜底** ✓ —— 网页版一登出就失效 ✗，但有些账号可能没申请 Key ✓）*/
async function wereadByCookie(cookie) {
  /* ⚠️ 微信读书的网页登录态靠 wr_vid + wr_skey ✓，少了这两个**一定**失败 ✗，
     而它只会回一句含糊的「用户不存在」✗。
     ★ 但**不能在这里直接拦掉** ✗ —— 万一它以后改了名字 ✗，
       我们就白白挡住了本来能用的 Cookie ✗。
       所以只**记下来** ✓，等真失败了再拿这句话去点破 ✓。 */
  const missing = [];
  if (!/(^|;\s*)wr_vid=/.test(cookie)) missing.push('wr_vid');
  if (!/(^|;\s*)wr_skey=/.test(cookie)) missing.push('wr_skey');
  const hint = missing.length
    ? '（这段 Cookie 里没有 ' + missing.join(' / ') + ' —— 多半是网页版还没登录，或者没复制全）'
    : '';
  try {
    const up = await fetch('https://i.weread.qq.com/shelf/sync?synckey=0&lectureSynckey=0&teenmode=0&album=1&onlyBookid=0', {
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://weread.qq.com/',
      },
      signal: AbortSignal.timeout(12000),
    });
    const text = await up.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    /* ⚠️⚠️ 微信读书把错误也塞在 body 里、状态码却是 **401** ✗ ——
       所以**不能**先判 `!up.ok` 就把原始 JSON 甩给用户 ✗
       （第一版就是这么写的 ✗，实测用户会看到
         `接口返回异常（HTTP 401）：{"errcode":-2010,...}` ✗，等于没说 ✗）。
       正解：**先解析 body** ✓，认得出 errcode 就翻译成人话 ✓。 */
    if (!data) {
      return { ok: false, error: '微信读书接口返回异常（HTTP ' + up.status + '）：' + String(text).slice(0, 160) };
    }
    /* 它的错误形状不固定 ✗ —— 大小写两种字段名都试 ✓（i.weread 用 errmsg，web 用 errMsg ✗） */
    const code = Number(data.errCode != null ? data.errCode : data.errcode);
    const msg = String(data.errMsg || data.errmsg || data.msg || data.error || '');
    const books = Array.isArray(data.books) ? data.books : null;
    if (!books) {
      let why = '没拿到书架';
      /* ★ -2010 / 「用户不存在」= **最常见**的失败 ✗（Cookie 没带上登录态 ✓），
         必须翻译成人话 ✓，而且**要指路** ✓：
         用户这次就是撞上这个 ✗ —— 最省事的解法是改用官方 Key ✓。 */
      if (code === -2010 || /用户不存在/.test(msg)) {
        why = '微信读书说「用户不存在」—— 这段 Cookie 没带上登录身份（网页版登录已过期，或者没复制全）。'
          + '**更省事的办法：改用官方 API Key** —— 它不会因为网页登出而失效';
      } else if (msg) why = '微信读书返回：' + msg;
      return { ok: false, error: why + hint };
    }
    /* ⚠️ 网页版这条路给的是 **0~1 的小数** ✗（和官方那条 0~100 不一样 ✗，见 wereadPct ✓） */
    const prog = new Map();
    (Array.isArray(data.bookProgress) ? data.bookProgress : []).forEach((x) => {
      if (x && x.bookId) prog.set(String(x.bookId), wereadPct(x.progress, true));
    });
    const out = books.map((b) => {
      if (!b) return null;
      const title = String(b.title || '').trim();
      if (!title) return null;
      const cover = Array.isArray(b.cover) ? String(b.cover[b.cover.length - 1] || '') : String(b.cover || '');
      return {
        title,
        author: String(b.author || '').trim(),
        cover: /^https:\/\//.test(cover) ? cover : '',
        prog: prog.get(String(b.bookId)) || 0,
        bookId: String(b.bookId || ''),
      };
    }).filter(Boolean);
    return { ok: true, via: 'cookie', count: out.length, books: out, albums: [] };
  } catch (error) {
    const why = String((error && error.message) || error);
    return { ok: false, error: /abort|timeout/i.test(why) ? '连微信读书超时（网络不通？）' : ('连不上微信读书：' + why) };
  }
}
/* 每个节点输出截断 ✓ —— outbox 是要给前端看的 ✓，塞几十 MB 进去会把面板卡住 ✗ */
function trimFlowOut(v) {
  if (v === undefined) return undefined;
  try {
    const s = JSON.stringify(v);
    if (s && s.length > 20000) return { _truncated: true, _size: s.length, preview: s.slice(0, 4000) };
  } catch (_) { return String(v).slice(0, 2000); }
  return v;
}
async function flowScheduleTick() {
  if (FLOW_TICK_BUSY) return;                 /* ★ 上一轮还没跑完就跳过 ✓（别叠 ✗） */
  FLOW_TICK_BUSY = true;
  try {
    const store = readLifeStore();
    const flows = Array.isArray(store.flows) ? store.flows : [];
    if (!flows.length) return;
    const st = readFlowSched();
    const now = Date.now();
    const due = FLOW_SCHED.dueList(flows, st.last, now);
    if (!due.length) return;
    for (const d of due) {
      /* ★ 先记时间**再跑** ✗ —— 反过来的话，这一轮跑失败（或超时被 kill ✗）时
         时间没更新 ✓ → 30 秒后又来一次 ✗ → 一直重试 ✗（实测那种会刷屏 ✗）。 */
      st.last[d.key] = now;
      const flow = flows.find((f) => f && f.id === d.flowId);
      if (!flow) continue;
      const at = Date.now();
      let run = null;
      let err = '';
      try {
        run = await WORKFLOW.runFlow({ nodes: flow.nodes, edges: flow.edges }, {
          fetch: fetch, now: at,
          workflowName: flow.name || '', workflowId: flow.id || '',
          executionId: 's' + at.toString(36),
          ai: st.ai && st.ai.url && st.ai.model ? st.ai : null,
          aiChat: st.ai && st.ai.url && st.ai.model ? makeAiChat(st.ai) : null,
        });
      } catch (error) { err = String((error && error.message) || error); }
      st.seq += 1;
      st.outbox.push({
        id: 'r' + st.seq,
        seq: st.seq,
        flowId: flow.id,
        flowName: flow.name || '',
        at,
        ok: !err,
        err,
        ms: (run && run.ms) || (Date.now() - at),
        steps: ((run && run.steps) || []).map((s) => ({
          id: s.id, type: s.type, name: s.name || '', status: s.status,
          ms: s.ms || 0, attempts: s.attempts || 1, error: s.error || '',
        })),
        effects: (run && run.effects) || [],
      });
      if (st.outbox.length > FLOW_OUTBOX_MAX) st.outbox = st.outbox.slice(-FLOW_OUTBOX_MAX);
      console.log('[flow-sched] 跑了「' + (flow.name || flow.id) + '」' + (err ? '失败：' + err : '成功') + '（' + d.key + '）');
    }
    writeFlowSched(st);
  } catch (error) {
    console.log('[flow-sched] 出错：' + String((error && error.message) || error));
  } finally { FLOW_TICK_BUSY = false; }
}
/* 前端推过来的 AI 配置 ✓ —— 它存在浏览器 localStorage 里 ✗，服务端读不到 ✗，
   所以让前端顺手推一份过来 ✓（定时跑的时候要用 ✓）。 */
function makeAiChat(cfg) {
  return async (c, messages) => {
    const resp = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: 'Bearer ' + c.key } : {}) },
      body: JSON.stringify({ model: c.model, messages, stream: false, temperature: 0.3 }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error('AI 返回 ' + resp.status + '：' + text.slice(0, 240));
    let data = null;
    try { data = JSON.parse(text); } catch (_) { throw new Error('AI 返回的不是 JSON'); }
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string') throw new Error('AI 响应里没有 choices[0].message.content');
    return content;
  };
}

/* 「个人管理面板」的缓存：本机扫描贵（1~3s）✗、天气要出外网（2~5s）✗，
   都不需要每次刷新 —— 加缓存后二次打开是**瞬间** ✓。 */
let LIFE_INDEX_CACHE = null;          /* { at, depth, data } */
const LIFE_WX_CACHE = Object.create(null);   /* city → { at, data } */
function cleanServiceUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  let url;
  try { url = new URL(text); } catch (_) { throw new Error('ONLYOFFICE 地址必须是完整的 http:// 或 https:// URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('ONLYOFFICE 地址必须使用 http/https，且不能包含账号密码');
  return url.toString().replace(/\/$/, '');
}
function readOnlyOfficeConnection() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(ONLYOFFICE_CONNECTION_FILE, 'utf8')); } catch (_) {}
  const rawPublic = process.env.CODESCOPE_ONLYOFFICE_URL || saved.publicUrl || '';
  const rawCallback = process.env.CODESCOPE_ONLYOFFICE_CALLBACK_BASE || saved.callbackBase || '';
  let publicUrl = '', callbackBase = '';
  try { publicUrl = cleanServiceUrl(rawPublic); } catch (_) {}
  try { callbackBase = cleanServiceUrl(rawCallback); } catch (_) {}
  return {
    publicUrl,
    callbackBase,
    jwtSecret:String(process.env.CODESCOPE_ONLYOFFICE_JWT_SECRET || saved.jwtSecret || ''),
    source:process.env.CODESCOPE_ONLYOFFICE_URL ? 'environment' : (saved.publicUrl ? 'saved' : 'none'),
  };
}
let ONLYOFFICE_CONNECTION = readOnlyOfficeConnection();
let OFFICE_ENGINE = createOfficeEngine({
  appVersion:APP_VERSION,
  onlyOfficeUrl:ONLYOFFICE_CONNECTION.publicUrl,
  managedManifest:process.env.CODESCOPE_OFFICE_PROVIDER_MANIFEST,
});
function refreshOfficeEngine() {
  OFFICE_ENGINE = createOfficeEngine({
    appVersion:APP_VERSION,
    onlyOfficeUrl:ONLYOFFICE_CONNECTION.publicUrl,
    managedManifest:process.env.CODESCOPE_OFFICE_PROVIDER_MANIFEST,
  });
}
function publicOnlyOfficeConnection() {
  return {
    publicUrl:ONLYOFFICE_CONNECTION.publicUrl,
    callbackBase:ONLYOFFICE_CONNECTION.callbackBase,
    configured:!!ONLYOFFICE_CONNECTION.publicUrl,
    jwtConfigured:!!ONLYOFFICE_CONNECTION.jwtSecret,
    source:ONLYOFFICE_CONNECTION.source,
  };
}
function saveOnlyOfficeConnection(input) {
  const publicUrl = cleanServiceUrl(input && input.publicUrl);
  if (!publicUrl) throw new Error('请填写 ONLYOFFICE Document Server 地址');
  const callbackBase = cleanServiceUrl(input && input.callbackBase);
  const serviceHost = new URL(publicUrl).hostname;
  if (!callbackBase && !['127.0.0.1', 'localhost', '::1'].includes(serviceHost)) {
    throw new Error('远程 ONLYOFFICE 服务必须填写它能够访问的 CodeScope 回调地址');
  }
  const jwtSecret = String(input && input.jwtSecret || '').trim();
  if (jwtSecret && jwtSecret.length < 16) throw new Error('JWT 密钥至少需要 16 个字符');
  const currentSecret = ONLYOFFICE_CONNECTION.jwtSecret;
  ONLYOFFICE_CONNECTION = {
    publicUrl,
    callbackBase,
    jwtSecret:jwtSecret || (input && input.keepJwtSecret ? currentSecret : ''),
    source:'saved',
  };
  fs.mkdirSync(path.dirname(ONLYOFFICE_CONNECTION_FILE), { recursive:true });
  writeFileAtomicSync(ONLYOFFICE_CONNECTION_FILE, JSON.stringify({
    publicUrl:ONLYOFFICE_CONNECTION.publicUrl,
    callbackBase:ONLYOFFICE_CONNECTION.callbackBase,
    jwtSecret:ONLYOFFICE_CONNECTION.jwtSecret,
  }, null, 2) + '\n', { encoding:'utf8', mode:0o600 });
  try { fs.chmodSync(ONLYOFFICE_CONNECTION_FILE, 0o600); } catch (_) {}
  refreshOfficeEngine();
  return publicOnlyOfficeConnection();
}

const PORT_VALUE = Number(process.env.CODESCOPE_PORT || process.env.MASSCODE_RUNNER_PORT || 4877);
const PORT = Number.isInteger(PORT_VALUE) && PORT_VALUE > 0 && PORT_VALUE <= 65535 ? PORT_VALUE : 4877;
const ONLYOFFICE_CONTAINER_NAME = /^[A-Za-z0-9_.-]+$/.test(String(process.env.CODESCOPE_ONLYOFFICE_CONTAINER || ''))
  ? String(process.env.CODESCOPE_ONLYOFFICE_CONTAINER)
  : 'codescope-onlyoffice';
// 默认仅监听本机，避免终端、文件编辑与代码执行接口意外暴露到局域网。
// 确实需要跨设备访问时，可显式设置 CODESCOPE_HOST=0.0.0.0，并配合受信网络使用。
const HOST = process.env.CODESCOPE_HOST || process.env.MASSCODE_RUNNER_HOST || '127.0.0.1';
const DSH = createDshService({ projectRoot:__dirname, dataRoot:applicationDataRoot() });
const OPENCODE = createOpencodeService({});

/* ── 浏览器版 VS Code（code-server）──
   code-server 只绑回环，对外只经 CodeScope 的代理端口 —— 它的鉴权只有「一个密码」这一档，
   直接开到局域网上等于绕开 CodeScope 给整台机器开门。代理跟着主服务的 HOST 走：
   主服务只监听回环时代理也只监听回环。 */
const VSCODE_INTERNAL_PORT = Number(process.env.CODESCOPE_VSCODE_INTERNAL_PORT) || 4899;
const VSCODE_PROXY_PORT = Number(process.env.CODESCOPE_VSCODE_PORT) || 4878;
const VSCODE = createCodeServerService({
  port: VSCODE_INTERNAL_PORT,
  dataRoot: applicationDataRoot(),
  /* 把托管服务的日志接进主日志：界面语言、端口切换这类问题全靠它定位。 */
  log: (message) => console.log(String(message)),
  /* 内部端口被占时服务会自动换空闲端口——代理的转发目标必须同步切换，
     否则代理还指向旧端口，整条链路静默断掉（iframe 一直 502）。 */
  onPortChange: (nextPort) => { try { VSCODE_PROXY.setTargetPort(nextPort); } catch (_) {} },
});
const VSCODE_PROXY = createCodeServerProxy({
  listenHost: HOST,
  listenPort: VSCODE_PROXY_PORT,
  targetHost: '127.0.0.1',
  targetPort: VSCODE_INTERNAL_PORT,
  isAllowed: trustedHttpOrigin,
  onNotice: (message) => console.log('[VS Code] ' + message),
});
/* 代理状态要合进 service：前端得知道 iframe 该指向哪个端口，以及代理是否已就绪。 */
function codeServerStatus(base) {
  const service = base || VSCODE.status();
  return { ...service, proxyListening: VSCODE_PROXY.isListening(), proxyPort: VSCODE_PROXY_PORT, internalPort: VSCODE_INTERNAL_PORT };
}

/* ---------------------------------- 路径发现 ---------------------------------- */

function defaultVaultPath() {
  // 0) 最通用：工具目录上一级的 markdown-vault（整个 massCode 文件夹一起放在云盘/本地时一定成立，跨系统通用）
  const relVault = path.join(__dirname, '..', 'markdown-vault');
  if (fs.existsSync(relVault)) return relVault;
  // 1) 从 massCode 偏好设置读取（各系统路径不同）
  const prefCands = [];
  if (process.platform === 'darwin') {
    prefCands.push(
      path.join(os.homedir(), 'Library/Application Support/massCode/v2/preferences.json'),
      path.join(os.homedir(), 'Library/Application Support/masscode/v2/preferences.json'));
  } else if (process.platform === 'win32') {
    const ap = process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming');
    prefCands.push(
      path.join(ap, 'massCode/v2/preferences.json'),
      path.join(ap, 'masscode/v2/preferences.json'));
  } else { // linux 等
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    prefCands.push(
      path.join(xdg, 'massCode/v2/preferences.json'),
      path.join(xdg, 'masscode/v2/preferences.json'));
  }
  for (const p of prefCands) {
    try {
      const pref = JSON.parse(fs.readFileSync(p, 'utf8'));
      const root = pref && pref.storage && pref.storage.rootPath;
      if (root) return path.join(root, 'markdown-vault');
    } catch (_) { /* ignore */ }
  }
  // 2) 常见默认位置兜底
  const defaults = [
    path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault'),
    path.join(os.homedir(), 'massCode/markdown-vault'),
    path.join(os.homedir(), 'Documents/massCode/markdown-vault'),
  ];
  for (const p of defaults) if (fs.existsSync(p)) return p;
  return defaults[0];
}

function vaultPath() {
  const v = process.env.CODESCOPE_VAULT || process.env.MASSCODE_VAULT;
  if (v) {
    if (!fs.existsSync(v)) throw new Error('CODESCOPE_VAULT 指向的目录不存在: ' + v);
    return v;
  }
  return defaultVaultPath();
}

const KNOWLEDGE = createKnowledgeBase({ projectRoot:__dirname, dataRoot:applicationDataRoot(), getVaultPath:vaultPath });
const SYSTEM_PANEL = createSystemPanel({ dataRoot: applicationDataRoot(), log: (line) => console.log(line) });

/* -------------------------------- 实时系统状态 -------------------------------- */

function cpuTimes() {
  let idle = 0, total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}
let CPU_LAST = cpuTimes(), CPU_USAGE = 0;
const CPU_SAMPLE_TIMER = setInterval(() => {
  const next = cpuTimes(), total = next.total - CPU_LAST.total, idle = next.idle - CPU_LAST.idle;
  if (total > 0) CPU_USAGE = Math.max(0, Math.min(100, (1 - idle / total) * 100));
  CPU_LAST = next;
}, 1000);
CPU_SAMPLE_TIMER.unref();

let DISK_CACHE = { at: 0, value: null };
let MEMORY_CACHE = { at: 0, value: null };
function execFileText(command, args, timeout) {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: 'utf8', timeout: timeout || 5000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message))) : resolve(String(stdout || ''))));
}
async function onlyOfficeServiceStatus() {
  const base = { managed:true, container:ONLYOFFICE_CONTAINER_NAME, dockerAvailable:false, installed:false, running:false, status:'unavailable', health:'none', memory:'', cpu:'' };
  try {
    await execFileText('docker', ['info', '--format', '{{json .ServerVersion}}'], 5000);
    base.dockerAvailable = true;
  } catch (error) {
    return { ...base, error:'Docker 未运行或不可用：' + String(error.message || error).trim().slice(0, 240) };
  }
  try {
    const state = JSON.parse((await execFileText('docker', ['inspect', '--format', '{{json .State}}', ONLYOFFICE_CONTAINER_NAME], 5000)).trim());
    base.installed = true;
    base.running = !!state.Running;
    base.status = String(state.Status || (state.Running ? 'running' : 'stopped'));
    base.health = state.Health && state.Health.Status ? String(state.Health.Status) : (state.Running ? 'running' : 'none');
    base.startedAt = state.StartedAt || '';
    if (state.Running) {
      try {
        const stats = (await execFileText('docker', ['stats', '--no-stream', '--format', '{{json .}}', ONLYOFFICE_CONTAINER_NAME], 8000)).trim();
        if (stats) { const parsed = JSON.parse(stats); base.memory = String(parsed.MemUsage || ''); base.cpu = String(parsed.CPUPerc || ''); }
      } catch (_) { /* 状态仍可用，统计信息是可选项 */ }
    }
    return base;
  } catch (error) {
    const message = String(error.message || error).trim();
    return { ...base, error:/No such (?:object|container)/i.test(message) ? '未找到本机 ONLYOFFICE 容器' : message.slice(0, 240) };
  }
}
async function controlOnlyOfficeService(action) {
  if (!['start','stop'].includes(action)) throw Object.assign(new Error('不支持的 ONLYOFFICE 服务操作'), { statusCode:400 });
  const before = await onlyOfficeServiceStatus();
  if (!before.dockerAvailable) throw Object.assign(new Error(before.error || 'Docker 未运行'), { statusCode:503 });
  if (!before.installed) throw Object.assign(new Error('未找到固定容器 '+ONLYOFFICE_CONTAINER_NAME+'；请先完成 ONLYOFFICE 安装'), { statusCode:404 });
  if (action === 'start' && !before.running) await execFileText('docker', ['start', ONLYOFFICE_CONTAINER_NAME], 60000);
  if (action === 'stop' && before.running) await execFileText('docker', ['stop', '--time', '10', ONLYOFFICE_CONTAINER_NAME], 30000);
  return onlyOfficeServiceStatus();
}
// ===================== 云同步：Tailscale 组网 · Syncthing 数据面 · restic 历史层 =====================
// 设计原则：① 只读聚合优先，任何工具缺失/未配置/不可达都只降级不报错；
//          ② 外部命令一律带超时且不 reject，绝不阻塞主界面；③ 写操作少而可回滚。
const SYNC_CONFIG_FILE = path.join(applicationDataRoot(), 'sync.json');
const SYNC_STATUS_CACHE = { at: 0, value: null };
const SYNC_VAULT_CACHE = { at: 0, value: null };
const SYNC_SCAN_LIMIT = 60000;
const SYNC_SNAPSHOT = { running: false, startedAt: 0, finishedAt: 0, targets: [], results: [], message: '' };

// 不抛错的命令执行：状态聚合里任何一条命令失败都只是「这一项不可用」。
function syncRun(command, args, options) {
  const opts = Object.assign({ encoding: 'utf8', timeout: 8000, maxBuffer: 16 * 1024 * 1024, env: process.env }, options || {});
  return new Promise((resolve) => {
    execFile(command, args, opts, (error, stdout, stderr) => {
      const text = String(stderr || '').trim();
      resolve({
        ok: !error,
        stdout: String(stdout || ''),
        stderr: text,
        error: error ? (text || String(error.message || error)).slice(0, 400) : '',
      });
    });
  });
}

function syncBinary(name, extra) {
  const found = executablePath(name);
  if (found) return found;
  return (extra || []).find((candidate) => { try { return fs.existsSync(candidate); } catch (_) { return false; } }) || '';
}
function syncthingBinary() {
  return syncBinary('syncthing', process.platform === 'darwin'
    ? ['/opt/homebrew/bin/syncthing', '/usr/local/bin/syncthing']
    : ['/usr/bin/syncthing', '/usr/local/bin/syncthing', '/snap/bin/syncthing']);
}
function resticBinary() {
  return syncBinary('restic', process.platform === 'darwin'
    ? ['/opt/homebrew/bin/restic', '/usr/local/bin/restic']
    : ['/usr/bin/restic', '/usr/local/bin/restic']);
}
// macOS 上 Tailscale 的命令行在应用包内，which 找不到。
function tailscaleBinary() {
  return syncBinary('tailscale', process.platform === 'darwin'
    ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale']
    : ['/usr/bin/tailscale', '/usr/sbin/tailscale', '/usr/local/bin/tailscale']);
}

function syncConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(SYNC_CONFIG_FILE, 'utf8')); } catch (_) {}
  const st = saved && typeof saved.syncthing === 'object' && saved.syncthing ? saved.syncthing : {};
  let url = 'http://127.0.0.1:8384';
  try { url = cleanServiceUrl(st.url || url) || url; } catch (_) {}
  const targets = (Array.isArray(saved.resticTargets) ? saved.resticTargets : []).map((item) => {
    const target = item && typeof item === 'object' ? item : { repository: String(item || '') };
    return {
      name: String(target.name || target.repository || '').trim(),
      repository: String(target.repository || '').trim(),
      passwordFile: String(target.passwordFile || '').trim(),
      passwordCommand: String(target.passwordCommand || '').trim(),
      paths: Array.isArray(target.paths) ? target.paths.map((p2) => String(p2)).filter(Boolean) : [],
      tag: String(target.tag || '').trim(),
    };
  }).filter((target) => target.repository);
  return {
    file: SYNC_CONFIG_FILE,
    syncthing: {
      url,
      apiKey: typeof st.apiKey === 'string' ? st.apiKey.trim() : '',
      folder: typeof st.folder === 'string' && st.folder.trim() ? st.folder.trim() : 'vault',
    },
    resticTargets: targets,
    largeFileMiB: Number(saved.largeFileMiB) > 0 ? Number(saved.largeFileMiB) : 95,
  };
}

function saveSyncConfig(patch) {
  const body = patch && typeof patch === 'object' ? patch : {};
  const current = syncConfig();
  const next = { syncthing: Object.assign({}, current.syncthing), resticTargets: current.resticTargets, largeFileMiB: current.largeFileMiB };
  if (body.syncthing && typeof body.syncthing === 'object') {
    const st = body.syncthing;
    if (st.url !== undefined) next.syncthing.url = String(st.url || '').trim() ? cleanServiceUrl(st.url) : 'http://127.0.0.1:8384';
    if (st.apiKey !== undefined) next.syncthing.apiKey = String(st.apiKey || '').trim();
    if (st.folder !== undefined) next.syncthing.folder = String(st.folder || '').trim() || 'vault';
  }
  if (body.resticTargets !== undefined) {
    if (!Array.isArray(body.resticTargets)) throw requestError('resticTargets 必须是数组', 400);
    next.resticTargets = body.resticTargets.map((item) => {
      const target = item && typeof item === 'object' ? item : {};
      const repository = String(target.repository || '').trim();
      if (!repository) throw requestError('每个 restic 仓库都必须填写 repository', 400);
      return {
        name: String(target.name || repository).trim(), repository,
        passwordFile: String(target.passwordFile || '').trim(),
        passwordCommand: String(target.passwordCommand || '').trim(),
        paths: Array.isArray(target.paths) ? target.paths.map((p2) => String(p2)).filter(Boolean) : [],
        tag: String(target.tag || '').trim(),
      };
    });
  }
  if (body.largeFileMiB !== undefined) {
    const value = Number(body.largeFileMiB);
    if (!Number.isFinite(value) || value < 1 || value > 100) throw requestError('largeFileMiB 必须在 1 到 100 之间（GitHub 单文件硬上限为 100 MiB）', 400);
    next.largeFileMiB = value;
  }
  fs.mkdirSync(path.dirname(SYNC_CONFIG_FILE), { recursive: true });
  writeFileAtomicSync(SYNC_CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  return syncConfig();
}

// Syncthing 的 API Key 写在各自平台的 config.xml 里，找不到就让用户手填。
function syncthingConfigPaths() {
  const home = os.homedir();
  const list = [];
  if (process.platform === 'darwin') list.push(path.join(home, 'Library/Application Support/Syncthing/config.xml'));
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'Syncthing/config.xml'));
  list.push(path.join(home, '.local/state/syncthing/config.xml'));
  list.push(path.join(home, '.config/syncthing/config.xml'));
  list.push(path.join(home, '.local/share/syncthing/config.xml'));
  return list;
}
function discoverSyncthingApiKey() {
  for (const file of syncthingConfigPaths()) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const match = /<apikey>([^<]+)<\/apikey>/i.exec(text);
      if (match && match[1].trim()) return { key: match[1].trim(), file };
    } catch (_) {}
  }
  return { key: '', file: '' };
}

function syncFetchHeaders(config) {
  const key = config.syncthing.apiKey || discoverSyncthingApiKey().key;
  return key ? { 'X-API-Key': key } : {};
}
async function syncthingRequest(config, apiPath, options) {
  const url = String(config.syncthing.url || '').replace(/\/+$/, '') + apiPath;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (options && options.timeout) || 5000);
  try {
    const response = await fetch(url, Object.assign({ headers: syncFetchHeaders(config), signal: controller.signal }, options || {}));
    if (!response.ok) {
      // 必须把 Syncthing 的原始原因带出来：否则面板上只剩「HTTP 500」这种无法排查的提示。
      let detail = '';
      try {
        const raw = String((await response.text()) || '').trim();
        if (raw) {
          try { const parsed = JSON.parse(raw); detail = String(parsed.error || parsed.message || raw); }
          catch (_) { detail = raw; }
        }
      } catch (_) { /* 响应体读不到时只报状态码 */ }
      detail = detail.replace(/\s+/g, ' ').slice(0, 200);
      throw new Error('Syncthing 返回 HTTP ' + response.status + (response.status === 403 ? '（API Key 无效）' : '') + (detail ? '：' + detail : ''));
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(timer); }
}

async function tailscaleStatus() {
  const binary = tailscaleBinary();
  const base = { key: 'tailscale', available: false, binary, backendState: '', self: {}, peers: [], onlinePeers: 0, directPeers: 0, issue: '' };
  if (!binary) return Object.assign(base, { issue: '未找到 tailscale 命令行（macOS 可装 App Store 版，或用 brew install tailscale）' });
  const run = await syncRun(binary, ['status', '--json'], { timeout: 6000 });
  if (!run.ok) return Object.assign(base, { issue: 'tailscale status 失败：' + (run.error || '未知错误') });
  let data;
  try { data = JSON.parse(run.stdout || '{}'); }
  catch (_) { return Object.assign(base, { issue: '无法解析 tailscale status 输出' }); }
  const peers = Object.values(data.Peer || {}).map((peer) => {
    const ips = Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : [];
    const direct = !!peer.CurAddr;
    const dnsName = String(peer.DNSName || '').replace(/\.$/, '');
    return {
      // MagicDNS 短名是稳定身份（换机沿用同名即零改动）；HostName 在不同平台大小写不一致，仅作展示。
      name: dnsName.split('.')[0] || String(peer.HostName || '') || 'peer',
      hostName: String(peer.HostName || ''),
      dnsName,
      ip: ips.find((ip) => ip.includes('.')) || ips[0] || '',
      os: String(peer.OS || ''),
      online: !!peer.Online,
      active: !!peer.Active,
      direct,
      path: direct ? String(peer.CurAddr) : (peer.Relay ? 'DERP ' + peer.Relay : '中继'),
      lastSeen: String(peer.LastSeen || ''),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const selfIps = Array.isArray(data.Self && data.Self.TailscaleIPs) ? data.Self.TailscaleIPs : [];
  return Object.assign(base, {
    available: true,
    backendState: String(data.BackendState || ''),
    self: {
      name: String((data.Self && data.Self.DNSName) || '').replace(/\.$/, '').split('.')[0] || String((data.Self && data.Self.HostName) || ''),
      hostName: String((data.Self && data.Self.HostName) || ''),
      dnsName: String((data.Self && data.Self.DNSName) || '').replace(/\.$/, ''),
      ip: selfIps.find((ip) => ip.includes('.')) || selfIps[0] || '',
      os: String((data.Self && data.Self.OS) || ''),
    },
    peers,
    onlinePeers: peers.filter((peer) => peer.online).length,
    directPeers: peers.filter((peer) => peer.direct).length,
  });
}

async function syncthingStatus(config) {
  const base = {
    key: 'syncthing', available: false, binary: syncthingBinary(), url: config.syncthing.url,
    folder: config.syncthing.folder, apiKeySource: '', version: '', devices: [], folders: [], folderState: null, issue: '',
  };
  let status = null;
  try { status = await syncthingRequest(config, '/rest/system/status'); }
  catch (error) {
    return Object.assign(base, { issue: '无法连接 Syncthing（' + config.syncthing.url + '）：' + String(error.message || error).slice(0, 160) + '。请确认 Syncthing 正在运行。' });
  }
  // Syncthing 2.x 起 /rest/system/status 不再带 version，改从 /rest/system/version 取（旧版回落到 status）。
  let version = String(status.version || '');
  if (!version) {
    try { version = String((await syncthingRequest(config, '/rest/system/version')).version || ''); } catch (_) {}
  }
  const stored = config.syncthing.apiKey ? { file: '（应用设置）' } : discoverSyncthingApiKey();
  let devicesCfg = [], foldersCfg = [], conns = {};
  try { devicesCfg = await syncthingRequest(config, '/rest/config/devices'); } catch (_) {}
  try { foldersCfg = await syncthingRequest(config, '/rest/config/folders'); } catch (_) {}
  try { conns = (await syncthingRequest(config, '/rest/system/connections')).connections || {}; } catch (_) {}
  const devices = (Array.isArray(devicesCfg) ? devicesCfg : []).map((device) => {
    const conn = conns[device.deviceID] || {};
    return {
      id: String(device.deviceID || ''),
      name: String(device.name || String(device.deviceID || '').slice(0, 7)),
      paused: !!device.paused,
      connected: !!conn.connected,
      address: String(conn.address || ''),
      type: String(conn.type || ''),
      direct: !!conn.address && !/relay/i.test(String(conn.address)),
      inBytes: Number(conn.inBytesTotal || 0),
      outBytes: Number(conn.outBytesTotal || 0),
      lastSeen: String(conn.at || ''),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const folders = (Array.isArray(foldersCfg) ? foldersCfg : []).map((folder) => ({
    id: String(folder.id || ''), label: String(folder.label || folder.id || ''),
    path: String(folder.path || ''), type: String(folder.type || ''), paused: !!folder.paused,
    devices: Array.isArray(folder.devices) ? folder.devices.length : 0,
  }));
  const wanted = folders.find((folder) => folder.id === config.syncthing.folder) || folders[0] || null;
  let folderState = null;
  if (wanted) {
    try {
      const raw = await syncthingRequest(config, '/rest/db/status?folder=' + encodeURIComponent(wanted.id));
      folderState = {
        id: wanted.id, label: wanted.label, path: wanted.path, type: wanted.type, paused: wanted.paused,
        state: String(raw.state || ''), stateChanged: String(raw.stateChanged || ''),
        globalFiles: Number(raw.globalFiles || 0), globalBytes: Number(raw.globalBytes || 0),
        localFiles: Number(raw.localFiles || 0), localBytes: Number(raw.localBytes || 0),
        needFiles: Number(raw.needFiles || 0), needBytes: Number(raw.needBytes || 0),
        inSyncFiles: Number(raw.inSyncFiles || 0), errors: Number(raw.errors || 0),
      };
    } catch (_) {}
  }
  return Object.assign(base, {
    available: true, version, apiKeySource: stored.file || '', devices, folders, folderState,
    connectedDevices: devices.filter((device) => device.connected).length,
  });
}

// Syncthing 没运行/不可达时给出明确原因，而不是把失败伪装成"设备不存在"。
async function syncthingEnsure(config) {
  try { await syncthingRequest(config, '/rest/system/status', { timeout: 4000 }); }
  catch (error) {
    throw requestError('无法连接 Syncthing（' + config.syncthing.url + '）：' + String(error.message || error).slice(0, 160) + '。请确认 Syncthing 已启动，必要时在设置里填写 API Key。', 503);
  }
}

async function syncthingAction(body) {
  const config = syncConfig();
  // 先校验参数、再探测环境：非法参数在任何环境下都应稳定返回 400，而不是随工具状态变成 503。
  const action = String((body && body.action) || '').toLowerCase();
  if (!['pause', 'resume', 'scan'].includes(action)) throw requestError('action 必须是 pause、resume 或 scan', 400);
  const device = String((body && body.device) || '').trim();
  const folder = String((body && body.folder) || '').trim() || config.syncthing.folder;
  await syncthingEnsure(config);
  if (action === 'scan') {
    await syncthingRequest(config, '/rest/db/scan?folder=' + encodeURIComponent(folder), { method: 'POST', timeout: 20000 });
    SYNC_STATUS_CACHE.at = 0;
    return { ok: true, action, folder };
  }
  if (!device) throw requestError('暂停/恢复设备时必须提供 device（Syncthing Device ID）', 400);
  const devices = await syncthingRequest(config, '/rest/config/devices').catch(() => []);
  if (!Array.isArray(devices) || !devices.some((item) => String(item.deviceID) === device)) {
    throw requestError('未在本机 Syncthing 配置中找到该设备：' + device, 404);
  }
  await syncthingRequest(config, '/rest/system/' + action + '?device=' + encodeURIComponent(device), { method: 'POST', timeout: 8000 });
  SYNC_STATUS_CACHE.at = 0;
  return { ok: true, action, device };
}

async function resticTargetStatus(target) {
  const base = { name: target.name, repository: target.repository, available: false, snapshots: 0, last: null, issue: '' };
  const binary = resticBinary();
  if (!binary) return Object.assign(base, { issue: '未找到 restic 命令（macOS: brew install restic；Linux: apt install restic）' });
  const env = Object.assign({}, process.env);
  if (target.passwordFile) env.RESTIC_PASSWORD_FILE = target.passwordFile;
  if (target.passwordCommand) env.RESTIC_PASSWORD_COMMAND = target.passwordCommand;
  const run = await syncRun(binary, ['-r', target.repository, 'snapshots', '--json'], { timeout: 20000, env });
  if (!run.ok) return Object.assign(base, { issue: run.error || 'restic snapshots 失败' });
  let list;
  try { list = JSON.parse(run.stdout || '[]'); }
  catch (_) { return Object.assign(base, { issue: '无法解析 restic snapshots 输出' }); }
  const snapshots = Array.isArray(list) ? list : [];
  const last = snapshots.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || ''))).pop() || null;
  return Object.assign(base, {
    available: true, snapshots: snapshots.length,
    last: last ? {
      time: String(last.time || ''), hostname: String(last.hostname || ''), paths: last.paths || [],
      tags: last.tags || [], shortId: String(last.short_id || '').slice(0, 8),
    } : null,
  });
}

async function startSyncSnapshot(names) {
  if (SYNC_SNAPSHOT.running) throw requestError('已有快照任务正在执行', 409);
  const config = syncConfig();
  const wanted = Array.isArray(names) ? names.map((name) => String(name)) : [];
  const targets = config.resticTargets.filter((target) => !wanted.length || wanted.includes(target.name));
  if (!targets.length) throw requestError(config.resticTargets.length ? '没有匹配的 restic 仓库' : '尚未配置 restic 仓库：请在云同步设置里填写仓库地址与密码文件', 400);
  const binary = resticBinary();
  if (!binary) throw requestError('未找到 restic 命令：请先安装 restic', 503);
  let vault = '';
  try { vault = vaultPath(); } catch (_) {}
  SYNC_SNAPSHOT.running = true; SYNC_SNAPSHOT.startedAt = Date.now(); SYNC_SNAPSHOT.finishedAt = 0;
  SYNC_SNAPSHOT.targets = targets.map((target) => target.name);
  SYNC_SNAPSHOT.results = []; SYNC_SNAPSHOT.message = '正在创建快照…';
  (async () => {
    for (const target of targets) {
      const env = Object.assign({}, process.env);
      if (target.passwordFile) env.RESTIC_PASSWORD_FILE = target.passwordFile;
      if (target.passwordCommand) env.RESTIC_PASSWORD_COMMAND = target.passwordCommand;
      const paths = target.paths.length ? target.paths : (vault ? [vault] : []);
      if (!paths.length) { SYNC_SNAPSHOT.results.push({ name: target.name, ok: false, error: '没有可备份的路径（vault 不可用且未配置 paths）' }); continue; }
      const args = ['-r', target.repository, 'backup', '--exclude', '.stversions', '--tag', 'host=' + os.hostname()];
      if (target.tag) args.push('--tag', target.tag);
      args.push(...paths);
      const run = await syncRun(binary, args, { timeout: 6 * 60 * 60 * 1000, env, maxBuffer: 32 * 1024 * 1024 });
      SYNC_SNAPSHOT.results.push({
        name: target.name, ok: run.ok, error: run.ok ? '' : run.error,
        summary: run.ok ? (run.stdout.trim().split('\n').pop() || '') : '',
      });
    }
    SYNC_SNAPSHOT.running = false; SYNC_SNAPSHOT.finishedAt = Date.now();
    SYNC_SNAPSHOT.message = SYNC_SNAPSHOT.results.every((item) => item.ok) ? '快照完成' : '部分仓库快照失败';
    SYNC_STATUS_CACHE.at = 0;
  })().catch((error) => {
    SYNC_SNAPSHOT.running = false; SYNC_SNAPSHOT.finishedAt = Date.now();
    SYNC_SNAPSHOT.message = String(error.message || error);
  });
  return { ok: true, running: true, targets: SYNC_SNAPSHOT.targets, startedAt: SYNC_SNAPSHOT.startedAt };
}

const SYNC_SKIP_DIRS = new Set(['.git', 'node_modules', '.stversions', 'out', 'tmp', '.next', 'dist', '.cache']);
function syncWalk(root, visit, limit) {
  const stack = [root];
  let seen = 0, truncated = false;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SYNC_SKIP_DIRS.has(entry.name)) stack.push(full); continue; }
      if (!entry.isFile()) continue;
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      seen++;
      if (visit(full, entry.name, stat) === false || seen >= limit) { truncated = true; return truncated; }
    }
  }
  return truncated;
}
function directoryBytes(root, limit) {
  let total = 0;
  syncWalk(root, (full, name, stat) => { total += stat.size; }, limit || 40000);
  return total;
}
function largestRepoFiles(root, thresholdMiB, limit) {
  const threshold = Math.max(1, Number(thresholdMiB) || 95) * 1024 * 1024;
  const found = [];
  syncWalk(root, (full, name, stat) => {
    if (stat.size >= threshold / 4) found.push({ path: path.relative(root, full), bytes: stat.size });
  }, SYNC_SCAN_LIMIT);
  return found.filter((item) => item.bytes >= threshold).sort((a, b) => b.bytes - a.bytes).slice(0, limit || 8);
}
function vaultStats() {
  if (SYNC_VAULT_CACHE.value && Date.now() - SYNC_VAULT_CACHE.at < 30000) return SYNC_VAULT_CACHE.value;
  let root = '';
  try { root = vaultPath(); } catch (error) { root = ''; }
  const value = {
    root, files: 0, bytes: 0, pdfFiles: 0, pdfBytes: 0, textFiles: 0, textBytes: 0,
    pdfBackupFiles: 0, pdfBackupBytes: 0, conflicts: 0, truncated: false,
  };
  if (!root) {
    SYNC_VAULT_CACHE.at = Date.now();
    SYNC_VAULT_CACHE.value = Object.assign(value, { error: 'vault 路径不可用' });
    return SYNC_VAULT_CACHE.value;
  }
  value.truncated = syncWalk(root, (full, name, stat) => {
    value.files++; value.bytes += stat.size;
    const relative = path.relative(root, full);
    if (/\.pdf$/i.test(name)) {
      value.pdfFiles++; value.pdfBytes += stat.size;
      if (/\.codescope\/pdf-backups\//.test(relative)) { value.pdfBackupFiles++; value.pdfBackupBytes += stat.size; }
    }
    if (/\.(md|markdown|txt|json|ya?ml|tex|bib|csv)$/i.test(name)) { value.textFiles++; value.textBytes += stat.size; }
    if (/\.sync-conflict-/i.test(name)) value.conflicts++;
  }, SYNC_SCAN_LIMIT);
  SYNC_VAULT_CACHE.at = Date.now();
  SYNC_VAULT_CACHE.value = value;
  return value;
}

async function syncGithubStatus(config) {
  const root = path.join(__dirname, '..');
  const base = {
    available: false, root, branch: '', head: '', subject: '', remote: '', dirty: 0, ahead: 0, behind: 0,
    gitDirBytes: 0, thresholdMiB: config.largeFileMiB, largeFiles: [], issue: '',
  };
  const inside = await syncRun('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, timeout: 5000 });
  if (!inside.ok || !/true/.test(inside.stdout)) return Object.assign(base, { issue: '当前目录不是 git 仓库（桌面安装包场景下正常）' });
  const [branch, head, remote, status, gitdir] = await Promise.all([
    syncRun('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: 5000 }),
    syncRun('git', ['log', '-1', '--pretty=%h%x09%s'], { cwd: root, timeout: 5000 }),
    syncRun('git', ['remote', 'get-url', 'origin'], { cwd: root, timeout: 5000 }),
    syncRun('git', ['status', '--porcelain'], { cwd: root, timeout: 10000 }),
    syncRun('git', ['rev-parse', '--git-dir'], { cwd: root, timeout: 5000 }),
  ]);
  const logLine = head.stdout.trim().split('\t');
  const gitDir = gitdir.ok ? path.resolve(root, gitdir.stdout.trim()) : '';
  const ahead = await syncRun('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { cwd: root, timeout: 8000 });
  return Object.assign(base, {
    available: true,
    branch: branch.stdout.trim(),
    head: logLine[0] || '',
    subject: logLine[1] || '',
    remote: remote.stdout.trim(),
    dirty: status.ok ? status.stdout.split('\n').filter((line) => line.trim()).length : 0,
    ahead: ahead.ok ? (Number(ahead.stdout.trim().split(/\s+/)[0]) || 0) : 0,
    behind: ahead.ok ? (Number(ahead.stdout.trim().split(/\s+/)[1]) || 0) : 0,
    gitDirBytes: gitDir ? directoryBytes(gitDir) : 0,
    largeFiles: largestRepoFiles(root, config.largeFileMiB, 8),
  });
}

async function syncStatus(force) {
  if (!force && SYNC_STATUS_CACHE.value && Date.now() - SYNC_STATUS_CACHE.at < 8000) {
    return Object.assign({}, SYNC_STATUS_CACHE.value, { cached: true });
  }
  const config = syncConfig();
  const vault = vaultStats();
  const safe = (promise, fallback) => promise.catch((error) => Object.assign({}, fallback, { issue: String(error.message || error).slice(0, 200) }));
  const [tailscale, syncthing, github] = await Promise.all([
    safe(tailscaleStatus(), { key: 'tailscale', available: false, binary: tailscaleBinary(), peers: [] }),
    safe(syncthingStatus(config), { key: 'syncthing', available: false, binary: syncthingBinary(), url: config.syncthing.url, devices: [], folders: [] }),
    safe(syncGithubStatus(config), { available: false, largeFiles: [] }),
  ]);
  const resticTargets = [];
  for (const target of config.resticTargets) resticTargets.push(await resticTargetStatus(target));
  const value = {
    ok: true,
    timestamp: Date.now(),
    configFile: config.file,
    installed: {
      tailscale: !!tailscaleBinary(), syncthing: !!syncthingBinary(), restic: !!resticBinary(),
    },
    tailscale, syncthing, github,
    restic: { binary: resticBinary(), configured: config.resticTargets.length > 0, targets: resticTargets },
    vault,
    snapshot: Object.assign({}, SYNC_SNAPSHOT),
    settings: {
      syncthingUrl: config.syncthing.url,
      syncthingFolder: config.syncthing.folder,
      apiKeyConfigured: !!(config.syncthing.apiKey || discoverSyncthingApiKey().key),
      resticTargets: config.resticTargets.length,
      largeFileMiB: config.largeFileMiB,
    },
  };
  SYNC_STATUS_CACHE.at = Date.now();
  SYNC_STATUS_CACHE.value = value;
  return value;
}

async function memoryStatus() {
  if (MEMORY_CACHE.value && Date.now() - MEMORY_CACHE.at < 1800) return MEMORY_CACHE.value;
  const total = os.totalmem(); let free = os.freemem();
  try {
    if (process.platform === 'linux') {
      const info = fs.readFileSync('/proc/meminfo', 'utf8');
      const available = /^MemAvailable:\s+(\d+)\s+kB/im.exec(info);
      if (available) free = Number(available[1]) * 1024;
    } else if (process.platform === 'darwin') {
      const stat = await execFileText('vm_stat', [], 3000);
      const pageMatch = /page size of\s+(\d+) bytes/i.exec(stat);
      const pageSize = pageMatch ? Number(pageMatch[1]) : 4096;
      const pages = (label) => { const m = new RegExp('^' + label + ':\\s+(\\d+)', 'mi').exec(stat); return m ? Number(m[1]) : 0; };
      // inactive/speculative 是可快速回收的文件缓存；比 os.freemem 更符合活动监视器的“可用内存”。
      free = (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * pageSize;
    }
  } catch (_) { /* 回退到 os.freemem */ }
  free = Math.max(0, Math.min(total, free));
  const used = Math.max(0, total - free);
  const value = { total, used, free, usage: total ? used / total * 100 : 0 };
  MEMORY_CACHE = { at: Date.now(), value };
  return value;
}
async function diskStatus() {
  if (DISK_CACHE.value && Date.now() - DISK_CACHE.at < 5000) return DISK_CACHE.value;
  let value;
  try {
    if (process.platform === 'win32') {
      const drive = path.parse(vaultPath()).root.replace(/[\\/]+$/, '') || 'C:';
      const script = "$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='" + drive.replace(/'/g, "''") + "'\"; $d | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress";
      const parsed = JSON.parse(await execFileText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 6000));
      const total = Number(parsed.Size || 0), free = Number(parsed.FreeSpace || 0);
      value = { total, free, used: Math.max(0, total - free), usage: total ? (total - free) / total * 100 : 0, mount: parsed.DeviceID || drive };
    } else {
      const lines = (await execFileText('df', ['-Pk', vaultPath()], 5000)).trim().split(/\r?\n/);
      const fields = (lines[lines.length - 1] || '').trim().split(/\s+/);
      if (fields.length < 6) throw new Error('无法解析 df 输出');
      const total = Number(fields[1]) * 1024, free = Number(fields[3]) * 1024, used = Math.max(0, total - free);
      value = { total, used, free, usage: total ? used / total * 100 : 0, mount: fields.slice(5).join(' ') };
    }
  } catch (e) {
    value = { total: 0, used: 0, free: 0, usage: 0, mount: '', error: e.message };
  }
  DISK_CACHE = { at: Date.now(), value };
  return value;
}

async function systemStatus() {
  const cpus = os.cpus(), memory = await memoryStatus();
  return {
    ok: true,
    timestamp: Date.now(),
    cpu: {
      usage: CPU_USAGE,
      cores: cpus.length,
      model: cpus[0] ? cpus[0].model.trim() : 'Unknown CPU',
      speedMHz: cpus.length ? Math.round(cpus.reduce((sum, cpu) => sum + Number(cpu.speed || 0), 0) / cpus.length) : 0,
      load: process.platform === 'win32' ? [] : os.loadavg(),
    },
    memory,
    disk: await diskStatus(),
    system: { hostname: os.hostname(), platform: platformInfo().label, arch: os.arch(), uptime: os.uptime() },
  };
}

/* --------------------------------- 环境检测 ---------------------------------- */

// Windows 上通常没有 python3，只有 python / py；跨平台解析可用的 Python 命令
let _pyCmd = null;
function pythonCmd() {
  if (_pyCmd) return _pyCmd;
  const cands = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const c of cands) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 }); return _pyCmd = c; } catch (_) {}
  }
  return _pyCmd = cands[0];
}

// LaTeX 优先使用 XeLaTeX（Unicode/中文文档体验更好），不可用时回退到 pdfLaTeX。
let _latexCmd = null;
function latexCmd() {
  if (_latexCmd) return _latexCmd;
  for (const c of ['xelatex', 'pdflatex']) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 }); return _latexCmd = c; } catch (_) {}
  }
  return _latexCmd = 'xelatex';
}
function latexStarter() {
  let hasCtex = false;
  try { hasCtex = !!execFileSync('kpsewhich', ['ctexart.cls'], { encoding: 'utf8', timeout: 5000 }).trim(); } catch (_) {}
  return hasCtex
    ? '\\documentclass[UTF8,11pt]{ctexart}\n\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{amsmath}\n\n\\title{LaTeX 文档}\n\\author{}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{开始}\n在这里编写内容。\n\n\\end{document}'
    : '\\documentclass[11pt]{article}\n\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{amsmath}\n\n\\title{LaTeX Document}\n\\author{}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nStart writing here.\n\n\\end{document}';
}
function latexProjectStarter() {
  return '\\documentclass[UTF8,11pt]{ctexart}\n' +
    '\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\usepackage{fontspec}\n' +
    '\\graphicspath{{figures/}}\n\n' +
    '% 字体文件放入 fonts/ 后可启用，例如：\n% \\setmainfont[Path=fonts/]{YourFont.ttf}\n\n' +
    '\\newif\\ifhasreferences\n\\IfFileExists{data/references.bib}{%\n  \\hasreferencestrue\n  \\usepackage[backend=biber]{biblatex}\n  \\addbibresource{data/references.bib}\n}{}\n\n' +
    '\\title{LaTeX 工程}\n\\author{}\n\\date{\\today}\n\n' +
    '\\begin{document}\n\\maketitle\n\n\\section{开始}\n在左侧编辑源码，右侧会实时生成 PDF。\n\n' +
    '\\section{图片}\n% 图片放入 figures/ 后取消下面一行注释：\n% \\includegraphics[width=0.7\\linewidth]{example.png}\n\n' +
    '\\ifhasreferences\n\\nocite{*}\n\\printbibliography\n\\fi\n\n\\end{document}';
}

const TOOLS = [
  { key: 'node',       probe: ['node', '--version'],            label: 'Node.js',              for: 'Runner / JS / TS', group: '基础环境', minMajor: 18 },
  { key: 'python3',    probe: () => [pythonCmd(), '--version'], label: 'Python 3',             for: 'Python 运行/检查与交互终端', group: '运行环境', minMajor: 3 },
  { key: 'bash',       probe: ['bash', '--version'],            label: 'Bash',                 for: 'Shell 运行/部署脚本', group: '运行环境' },
  { key: 'gcc',        probe: ['gcc', '--version'],             label: 'GCC（C 编译）',         for: 'C 运行/检查', group: '编译工具链' },
  { key: 'gpp',        probe: ['g++', '--version'],             label: 'G++（C++ 编译）',       for: 'C++ 运行/检查', group: '编译工具链' },
  { key: 'java',       probe: ['javac', '--version'],           label: 'Java JDK',             for: 'Java 运行/检查', group: '运行环境', minMajor: 11 },
  { key: 'ruby',       probe: ['ruby', '--version'],            label: 'Ruby',                 for: 'Ruby 运行/检查', group: '运行环境' },
  { key: 'swift',      probe: ['swift', '--version'],           label: 'Swift',                for: 'Swift 运行/检查', group: '运行环境' },
  { key: 'go',         probe: ['go', 'version'],                label: 'Go',                   for: 'Go 运行/检查', group: '运行环境' },
  { key: 'clangformat', probe: ['clang-format', '--version'],   label: 'clang-format',         for: 'C/C++ 格式化', group: '格式化工具' },
  { key: 'gofmt',      probe: ['gofmt', '-h'],                  label: 'gofmt',                for: 'Go 格式化', group: '格式化工具' },
  { key: 'black',      builtin: { version: 'Ruff ' + packageVersion('@astral-sh/ruff-wasm-nodejs'), path: '应用内置 · WASM' }, label: 'Python 格式化（Ruff）', for: 'Python 格式化（Black 兼容）', group: '格式化工具', installable: false },
  { key: 'npx',        builtin: { version: 'Prettier ' + packageVersion('prettier'), path: require.resolve('prettier/bin/prettier.cjs') }, label: 'Prettier', for: '前端/文档/Shell 格式化', group: '格式化工具', installable: false },
  { key: 'latex',      probe: () => [latexCmd(), '--version'],  label: 'LaTeX 引擎',            for: 'LaTeX 实时 PDF 编译', group: '文档工具' },
  { key: 'biber',      probe: ['biber', '--version'],           label: 'Biber',                for: 'LaTeX 参考文献', group: '文档工具' },
  { key: 'ctex',       probe: ['kpsewhich', 'ctexart.cls'],     label: 'CTeX 中文宏包',          for: 'LaTeX 中文文档', group: '文档工具' },
  { key: 'clangd',     probe: ['clangd', '--version'],          label: 'clangd',               for: 'C/C++ 精确跳转、悬停与诊断', group: '语言服务器', installable: false },
  { key: 'pyrightlsp', builtin: { version: 'Pyright ' + packageVersion('pyright'), path: require.resolve('pyright/langserver.index.js') }, label: 'Pyright LSP', for: 'Python 精确跳转、悬停与诊断', group: '语言服务器', installable: false },
  { key: 'tslsp',      builtin: { version: 'TypeScript LSP ' + packageVersion('typescript-language-server'), path: require.resolve('typescript-language-server/lib/cli.mjs') }, label: 'TypeScript LSP', for: 'JS/TS 精确跳转、悬停与诊断', group: '语言服务器', installable: false },
  { key: 'gopls',      probe: () => { const runtime = bundledGopls(['version']); return runtime ? [runtime.command, ...runtime.args] : ['gopls', 'version']; }, label: 'gopls', for: 'Go 精确跳转、悬停与诊断', group: '语言服务器', installable: false },
  { key: 'ssh',        probe: ['ssh', '-V'],                    label: 'OpenSSH 客户端',          for: 'SSH 远程开发', group: '远程开发' },
  { key: 'drawio',     probeUrl: 'https://embed.diagrams.net/?embed=1&proto=json', label: 'Draw.io 在线编辑器', for: 'Draw.io 编辑与 AI XML 绘图', group: '绘图工具', installable: false },
];

const TOOLS_BY_LANGUAGE = {
  javascript: ['node', 'npx'], typescript: ['node', 'npx'],
  python: ['python3', 'black'], bash: ['bash', 'npx'], shell: ['bash', 'npx'],
  c: ['gcc', 'clangformat'], c_cpp: ['gcc', 'gpp', 'clangformat'],
  java: ['java'], ruby: ['ruby'], swift: ['swift'], go: ['go', 'gofmt'],
  json: ['npx'], json5: ['npx'], html: ['npx'], css: ['npx'], scss: ['npx'],
  less: ['npx'], yaml: ['npx'], markdown: ['npx'],
  latex: ['latex', 'biber', 'ctex'],
};

function projectToolKeys() {
  const keys = new Set(['node']);
  const languages = new Set();
  try {
    for (const s of walkSnippets()) for (const f of (s.fragments || [])) {
      const lang = String(f.language || '').toLowerCase();
      if (!lang || lang === 'plain_text') continue;
      languages.add(lang);
      for (const key of (TOOLS_BY_LANGUAGE[lang] || [])) keys.add(key);
    }
  } catch (_) { /* vault 尚未就绪时至少检测 Node */ }
  try {
    const pending = [path.join(vaultPath(), 'drawings')];
    while (pending.length) {
      const dir = pending.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) pending.push(path.join(dir, entry.name));
        else if (/\.drawio$/i.test(entry.name)) { keys.add('drawio'); pending.length = 0; break; }
      }
    }
  } catch (_) { /* 绘图目录可能尚未创建 */ }
  return { keys, languages: [...languages].sort() };
}

function executablePath(cmd) {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(finder, [cmd], { encoding: 'utf8', timeout: 3000 }).split(/\r?\n/)[0].trim();
  } catch (_) { return ''; }
}

function readLinuxRelease() {
  if (process.platform !== 'linux') return {};
  try {
    const text = fs.readFileSync('/etc/os-release', 'utf8');
    const data = {};
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m) data[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return data;
  } catch (_) { return {}; }
}

function platformInfo() {
  const rel = readLinuxRelease();
  const packageManager = ['apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk'].find(executablePath) || '';
  let variant = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : (rel.PRETTY_NAME || rel.NAME || 'Linux');
  let isWsl = false;
  if (process.platform === 'linux') {
    try { isWsl = /microsoft/i.test(os.release() + ' ' + fs.readFileSync('/proc/version', 'utf8')); } catch (_) {}
    if (isWsl) variant += '（WSL）';
  }
  return {
    id: process.platform, arch: process.arch, label: variant,
    release: os.release(), distro: rel.ID || '', distroLike: rel.ID_LIKE || '',
    packageManager, isWsl,
  };
}

function runtimeCheck(key, label, target, options = {}) {
  const required = options.required !== false;
  let available = false, issue = '', version = options.version || '', resolved = target || '';
  try {
    if (options.kind === 'dependency') {
      resolved = require.resolve(target);
      available = true;
    } else if (options.kind === 'node') {
      const major = Number(process.versions.node.split('.')[0]);
      available = Number.isInteger(major) && major >= 18;
      version = process.version;
      resolved = process.execPath;
      if (!available) issue = '需要 Node.js 18 或更高版本';
    } else {
      fs.mkdirSync(target, { recursive:true });
      fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK);
      available = fs.statSync(target).isDirectory();
      if (!available) issue = '路径不是目录';
    }
  } catch (error) {
    issue = String(error && error.message || error).slice(0, 180);
  }
  return {
    key, label, for:options.for || '', group:'运行基础', available, installed:available,
    required, version:version || (available ? '可用' : ''), path:resolved, issue,
    hint:options.hint || '', installable:false,
  };
}

function runtimeReadiness() {
  let vault = '';
  try { vault = vaultPath(); } catch (error) {
    return {
      vault:{ key:'vault', label:'Vault 数据目录', for:'代码、文档、论文和绘图数据', group:'运行基础', available:false, installed:false, required:true, version:'', path:'', issue:String(error.message || error), hint:'设置 CODESCOPE_VAULT 指向可读写的 markdown-vault 目录', installable:false },
    };
  }
  const dataRoot = path.dirname(timelineRoot());
  const dependencies = Object.keys(require('./package.json').dependencies || {});
  const unresolved = dependencies.filter((name) => !fs.existsSync(path.join(__dirname, 'node_modules', ...name.split('/'), 'package.json')));
  const dependency = {
    key:'dependencies', label:'前端与服务依赖', for:'编辑器、PDF、XMind、Office、SSH 与实时通信', group:'运行基础',
    available:unresolved.length === 0, installed:unresolved.length === 0, required:true,
    version:unresolved.length ? '' : dependencies.length + ' 个依赖完整', path:path.join(__dirname, 'node_modules'),
    issue:unresolved.length ? '缺少：' + unresolved.join('、') : '', hint:'在 masscode-runner 目录运行 npm ci', installable:false,
  };
  return {
    node:runtimeCheck('runtimeNode', 'Node.js 运行时', process.execPath, { kind:'node', for:'CodeScope 本地服务', hint:'安装 Node.js 18 或更高版本' }),
    vault:runtimeCheck('vault', 'Vault 数据目录', vault, { for:'代码、文档、论文和绘图数据', hint:'确认目录存在且当前用户有读写权限' }),
    appData:runtimeCheck('appData', '应用数据目录', dataRoot, { for:'时间线、恢复点和本地状态', hint:'确认系统应用数据目录可读写' }),
    temp:runtimeCheck('temp', '系统临时目录', os.tmpdir(), { for:'LaTeX 编译、导入和安全转换', hint:'确认系统临时目录可读写' }),
    dependencies:dependency,
  };
}

function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }

function deploymentInfo(env, requiredKeys) {
  const missing = [...requiredKeys].filter((key) => {
    const tool = TOOLS.find((item) => item.key === key);
    return env[key] && !env[key].available && (!tool || tool.installable !== false);
  });
  const script = process.platform === 'win32' ? path.join(__dirname, 'deploy-env.ps1') : path.join(__dirname, 'deploy-env.sh');
  const supported = fs.existsSync(script) && (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32');
  let command = '';
  if (supported && missing.length) {
    command = process.platform === 'win32'
      ? '& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + script.replace(/"/g, '""') + '" ' + missing.join(' ') + '; Write-Output ("__MASSCODE_DEPLOY_DONE__:" + $LASTEXITCODE)'
      : 'bash ' + shellQuote(script) + ' ' + missing.map(shellQuote).join(' ') + '; masscode_deploy_status=$?; printf "\\n__MASSCODE_DEPLOY_DONE__:%s\\n" "$masscode_deploy_status"';
  }
  return { supported, command, missing, script, needsTerminal: true };
}

let envCache = null;
const NET_PROBE_FAIL = {};   // 网络型工具（Draw.io 等）探测失败时间戳，短缓存避免反复等待超时
async function detectEnv({ skipNet } = {}) {
  const project = projectToolKeys();
  const results = await Promise.all(TOOLS.map(async (t) => {
    const started = Date.now();
    if (t.builtin) {
      return {
        key:t.key, label:t.label, for:t.for, group:t.group, available:true, installed:true,
        required:false, relevant:project.keys.has(t.key), version:t.builtin.version, minVersion:'',
        issue:'', path:t.builtin.path, elapsedMs:Date.now()-started, installable:false, bundled:true,
        hint:'已随 CodeScope 安装，无需另行配置',
      };
    }
    if (t.probeUrl) {
      if (skipNet) {
        // 本地模式下不访问网络：在线编辑器状态按需在刷新时探测
        return { key:t.key, label:t.label, for:t.for, group:t.group, available:true, installed:true,
          required:false, relevant:project.keys.has(t.key), version:'在线编辑（按需检测）', minVersion:'',
          issue:'', path:t.probeUrl, elapsedMs:0, installable:false };
      }
      if (NET_PROBE_FAIL[t.key] && Date.now() - NET_PROBE_FAIL[t.key] < 120000) {
        return { key:t.key, label:t.label, for:t.for, group:t.group, available:false, installed:false,
          required:false, relevant:project.keys.has(t.key), version:'', minVersion:'',
          issue:'无法连接 embed.diagrams.net（' + (t.probeUrl||'').replace(/^https?:\/\//, '') + '，2 分钟内不再重试）',
          path:t.probeUrl, elapsedMs:0, installable:false };
      }
      try {
        const response = await fetch(t.probeUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(3000) });
        try { if (response.body) await response.body.cancel(); } catch (_) {}
        const available = response.ok;
        return {
          key:t.key, label:t.label, for:t.for, group:t.group, available, installed:available,
          required:false, relevant:project.keys.has(t.key), version:available ? '在线 · HTTP ' + response.status : 'HTTP ' + response.status,
          minVersion:'', issue:available ? '' : '在线服务返回 HTTP ' + response.status,
          path:t.probeUrl, elapsedMs:Date.now()-started, installable:false,
        };
      } catch (error) {
        NET_PROBE_FAIL[t.key] = Date.now();
        return {
          key:t.key, label:t.label, for:t.for, group:t.group, available:false, installed:false,
          required:false, relevant:project.keys.has(t.key), version:'', minVersion:'',
          issue:'无法连接 embed.diagrams.net：' + String((error && error.message) || error).slice(0, 100),
          path:t.probeUrl, elapsedMs:Date.now()-started, installable:false,
        };
      }
    }
    return new Promise((resolve) => {
    const cmd = typeof t.probe === 'function' ? t.probe() : t.probe;
    execFile(cmd[0], cmd.slice(1), { timeout: 15000 }, (err, stdout, stderr) => {
      const rawVersion = !err ? String(stdout || stderr || '').split(/\r?\n/)[0].trim().slice(0, 80) : '';
      const majorMatch = rawVersion.match(/\d+/);
      const major = majorMatch ? Number(majorMatch[0]) : null;
      const versionOk = !t.minMajor || (major != null && major >= t.minMajor);
      resolve({
        key: t.key, label: t.label, for: t.for, group: t.group,
        available: !err && versionOk,
        installed: !err,
        // 桌面安装包自身的运行条件由 runtimeReadiness 检查。解释器、编译器、
        // 格式化器和 LSP 都是用户按项目启用的增强能力，不能被表述成应用缺失环境。
        required: false,
        relevant: project.keys.has(t.key),
        version: rawVersion,
        minVersion: t.minMajor ? String(t.minMajor) + '+' : '',
        issue: !err && !versionOk ? '版本过低，需要 ' + t.minMajor + '+' : (!err ? '' : '未安装或不在 PATH'),
        path: !err ? executablePath(cmd[0]) : '',
        elapsedMs: Date.now() - started,
        bundled: !err && path.isAbsolute(cmd[0]) && (cmd[0].includes(path.sep + '.bundled-tools' + path.sep) || (process.resourcesPath && cmd[0].startsWith(process.resourcesPath + path.sep))),
        hint: !err && path.isAbsolute(cmd[0]) && (cmd[0].includes(path.sep + '.bundled-tools' + path.sep) || (process.resourcesPath && cmd[0].startsWith(process.resourcesPath + path.sep))) ? '已随 CodeScope 安装，无需另行配置' : '',
      });
    });
    });
  }));
  const map = {};
  for (const r of results) map[r.key] = r;
  return { tools: map, project };
}
async function getEnv(force) {
  // 默认只做本地工具探测（无网络请求）：运行/编译各入口调用频繁，绝不能被 drawio 等
  // 在线探测的网络超时拖慢。网络型工具仅在 force（环境检测界面点刷新）时探测。
  if (force || !envCache) envCache = await detectEnv({ skipNet: !force });
  return envCache;
}

// 给某工具缺失时的安装提示（按平台给不同命令）
function linuxInstallHint(key) {
  if (key === 'ctex') key = 'latex';
  const pm = platformInfo().packageManager || 'apt-get';
  const packages = {
    'apt-get': { node:'nodejs npm', python3:'python3 python3-pip', bash:'bash', gcc:'build-essential', gpp:'build-essential', java:'default-jdk', ruby:'ruby', go:'golang-go', clangformat:'clang-format', gofmt:'golang-go', npx:'npm', latex:'texlive-xetex texlive-latex-extra texlive-fonts-recommended texlive-lang-chinese', biber:'biber', ssh:'openssh-client' },
    dnf: { node:'nodejs npm', python3:'python3 python3-pip', bash:'bash', gcc:'gcc make', gpp:'gcc-c++ make', java:'java-21-openjdk-devel', ruby:'ruby', go:'golang', clangformat:'clang-tools-extra', gofmt:'golang', npx:'npm', latex:'texlive-xetex texlive-collection-latexextra texlive-ctex', biber:'biber', ssh:'openssh-clients' },
    yum: { node:'nodejs npm', python3:'python3 python3-pip', bash:'bash', gcc:'gcc make', gpp:'gcc-c++ make', java:'java-17-openjdk-devel', ruby:'ruby', go:'golang', clangformat:'clang', gofmt:'golang', npx:'npm', latex:'texlive-xetex texlive-collection-latexextra texlive-ctex', biber:'biber', ssh:'openssh-clients' },
    pacman: { node:'nodejs npm', python3:'python python-pip', bash:'bash', gcc:'base-devel', gpp:'base-devel', java:'jdk-openjdk', ruby:'ruby', go:'go', clangformat:'clang', gofmt:'go', npx:'npm', latex:'texlive-bin texlive-latexextra texlive-fontsrecommended texlive-langchinese', biber:'biber', ssh:'openssh' },
    zypper: { node:'nodejs npm', python3:'python3 python3-pip', bash:'bash', gcc:'gcc make', gpp:'gcc-c++ make', java:'java-17-openjdk-devel', ruby:'ruby', go:'go', clangformat:'clang-tools', gofmt:'go', npx:'npm', latex:'texlive-xetex texlive-latexextra texlive-ctex', biber:'biber', ssh:'openssh-clients' },
    apk: { node:'nodejs npm', python3:'python3 py3-pip', bash:'bash', gcc:'build-base', gpp:'build-base', java:'openjdk17', ruby:'ruby', go:'go', clangformat:'clang-extra-tools', gofmt:'go', npx:'npm', latex:'texlive-xetex texmf-dist-latexextra texmf-dist-langchinese', biber:'biber', ssh:'openssh-client-default' },
  };
  if (key === 'swift') return '从 swift.org 安装对应 Linux 工具链';
  if (key === 'black') return 'python3 -m pip install --user black';
  const pkg = (packages[pm] || packages['apt-get'])[key];
  if (!pkg) return '请使用系统包管理器安装 ' + key;
  if (pm === 'pacman') return 'sudo pacman -S --needed ' + pkg;
  if (pm === 'apk') return 'sudo apk add ' + pkg;
  return 'sudo ' + pm + ' install -y ' + pkg;
}

function installHint(key) {
  const win = process.platform === 'win32';
  const lin = process.platform === 'linux';
  const mac = !win && !lin;
  const H = {
    node: mac ? 'brew install node' : win ? 'winget install OpenJS.NodeJS.LTS（或 nodejs.org 下载）' : linuxInstallHint(key),
    python3: mac ? 'brew install python' : win ? 'winget install Python.Python.3.12（自带 python 命令）' : linuxInstallHint(key),
    bash: mac ? '系统自带' : win ? '安装 Git Bash 或启用 WSL（Windows 默认无 bash）' : linuxInstallHint(key),
    gcc: mac ? 'xcode-select --install' : win ? '安装 MinGW-w64 或 Visual Studio 的 C/C++ 工具' : linuxInstallHint(key),
    gpp: mac ? 'xcode-select --install' : win ? '安装 MinGW-w64 或 Visual Studio 的 C/C++ 工具' : linuxInstallHint(key),
    java: mac ? 'brew install --cask temurin' : win ? 'winget install EclipseAdoptium.Temurin.21.JDK' : linuxInstallHint(key),
    ruby: mac ? 'brew install ruby' : win ? '安装 RubyInstaller（rubyinstaller.org）' : linuxInstallHint(key),
    swift: mac ? 'xcode-select --install' : win ? 'Swift 官方 Windows 工具链（实验性）' : 'swift.org 工具链',
    go: mac ? 'brew install go' : win ? 'winget install GoLang.Go' : linuxInstallHint(key),
    clangformat: mac ? 'xcode-select --install 或 brew install clang-format' : win ? '安装 LLVM（releases.llvm.org）' : linuxInstallHint(key),
    gofmt: mac ? 'brew install go（自带 gofmt）' : win ? '安装 Go（自带 gofmt）' : linuxInstallHint(key),
    black: mac ? 'pip3 install --user black' : win ? (pythonCmd() === 'py' ? 'py -m pip install black' : 'python -m pip install black') : linuxInstallHint(key),
    npx: mac ? 'brew install node（自带 npx）' : win ? '安装 Node.js（自带 npx）' : linuxInstallHint(key),
    latex: mac ? 'brew install --cask mactex-no-gui' : win ? 'winget install MiKTeX.MiKTeX' : linuxInstallHint(key),
    clangd: mac ? 'xcode-select --install 或 brew install llvm' : win ? 'winget install LLVM.LLVM' : '使用系统包管理器安装 clangd',
    pyrightlsp: 'npm install -g pyright',
    tslsp: 'npm install -g typescript typescript-language-server',
    gopls: 'go install golang.org/x/tools/gopls@latest',
    ssh: mac ? 'macOS 系统自带；缺失时安装 Xcode Command Line Tools' : win ? '设置 → 可选功能 → OpenSSH 客户端' : linuxInstallHint(key),
    drawio: '无需安装；请检查网络、代理或防火墙能否访问 embed.diagrams.net',
  };
  if (key === 'biber' || key === 'ctex') return H.latex;
  return H[key] || '';
}

function missingReason(key, detected) {
  const t = TOOLS.find((x) => x.key === key);
  const issue = detected && detected.issue ? detected.issue : '未安装或不在 PATH';
  return (t ? t.label : key) + '不可用：' + issue + '（用于 ' + (t ? t.for : '') + '）。安装/升级: ' + installHint(key);
}

/* --------------------------------- frontmatter 解析 -------------------------------- */

function parseFrontmatter(text) {
  // 解析 massCode 片段 .md 的 frontmatter（YAML 子集），返回 { meta, body }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const yaml = m[1];
  const body = text.slice(m[0].length);
  const meta = {};
  const contents = [];
  let cur = null;      // 当前 contents 列表项
  let listKey = null;  // 正在收集的列表：'contents' | 'tags'
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const listItem = /^(\s*)-\s+(.+)$/.exec(line);
    if (listItem && listItem[1].length === 2) {
      if (listKey === 'tags') {
        const n = parseInt(listItem[2], 10);
        if (Number.isFinite(n)) meta.tags.push(n);
        continue;
      }
      cur = {};
      contents.push(cur);
      const kv = splitKV(listItem[2]);
      if (kv) cur[kv[0]] = kv[1];
      continue;
    }
    const itemField = /^\s{4,}(.+)$/.exec(line);
    if (itemField && cur) {
      const kv = splitKV(itemField[1]);
      if (kv) cur[kv[0]] = kv[1];
      continue;
    }
    const kv = splitKV(line);
    if (kv) {
      if (kv[0] === 'contents') { listKey = 'contents'; continue; }
      if (kv[0] === 'tags') { listKey = 'tags'; meta.tags = meta.tags || []; continue; }
      listKey = null;
      meta[kv[0]] = kv[1];
    }
  }
  if (contents.length) meta.contents = contents;
  if (!meta.tags) meta.tags = [];
  return { meta, body };
}

function splitKV(s) {
  const idx = s.indexOf(':');
  if (idx < 0) return null;
  const key = s.slice(0, idx).trim();
  let val = s.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return [key, val];
}

/* --------------------------------- 片段解析 ---------------------------------- */

// 每个片段推一个"文件名"：标签长得像文件名（如 main.cpp / calc.hpp）就直接用，
// 否则按语言给默认名（单文件 main.xxx，多文件 fileN.xxx）。
const EXT_FOR_LANG = {
  javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', shell: 'sh',
  c_cpp: 'cpp', c: 'c', java: 'java', ruby: 'rb', swift: 'swift', go: 'go',
  json: 'json', html: 'html', css: 'css', markdown: 'md', plain_text: 'txt',
  latex: 'tex',
  draw: 'draw', drawing: 'draw',
};
const KNOWN_EXT = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|py|js|mjs|cjs|ts|sh|go|java|rb|swift|json|html|css|yml|yaml|md|tex|txt|draw)$/i;
function computeFilename(label, language, index, total) {
  const lbl = (label || '').trim();
  // 仅当 label 本身就是一个「纯文件名」时才直接使用：含路径分隔符、上跳或隐藏前缀的一律回落到默认名，
  // 否则片段名可以控制写入路径（例如 ../../x.py 写出临时目录）。
  if (lbl && !/[/\\]/.test(lbl) && !lbl.startsWith('.') && KNOWN_EXT.test(lbl)) return lbl;
  const ext = EXT_FOR_LANG[(language || '').toLowerCase()] || 'txt';
  return total === 1 ? 'main.' + ext : 'file' + (index + 1) + '.' + ext;
}

function extractFragments(meta, body) {
  // 按 "## Fragment: xxx" 标题 + 后面的围栏代码块切分
  const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
  const fragments = [];
  const heads = [];
  let m;
  while ((m = headingRe.exec(body))) heads.push({ label: m[1].trim(), index: m.index });
  if (!heads.length) {
    // 没有 Fragment 标题：整段按 frontmatter 的 contents[0] 处理
    const first = (meta.contents || [])[0];
    const code = extractFirstFence(body);
    if (first || code) {
      const label = first && first.label ? first.label : '片段';
      const language = first && first.language ? first.language : 'plain_text';
      fragments.push({
        id: first ? String(first.id) : '0',
        label,
        language,
        filename: computeFilename(label, language, 0, 1),
        code: code || '',
      });
    }
    return fragments;
  }
  const total = heads.length;
  for (let i = 0; i < heads.length; i++) {
    const segStart = heads[i].index + body.slice(heads[i].index).indexOf('\n') + 1;
    const segEnd = i + 1 < heads.length ? heads[i + 1].index : body.length;
    const seg = body.slice(segStart, segEnd);
    const info = (meta.contents && meta.contents[i]) || {};
    const label = heads[i].label || (info.label || '片段 ' + (i + 1));
    const language = info.language || guessLanguage(heads[i].label) || 'plain_text';
    fragments.push({
      index: i,
      id: String(info.id != null ? info.id : i),
      label,
      language,
      filename: computeFilename(label, language, i, total),
      code: extractFirstFence(seg) || '',
    });
  }
  return fragments;
}

function extractFirstFence(seg) {
  // 片段 = 段内【第一个】``` 围栏（开）到【最后一个】``` 围栏（关）；
  // 必须取首↔末，不能用非贪婪匹配——markdown 片段内容自带围栏代码块时，非贪婪会在内层 ``` 处错误截断
  const lines = String(seg).split('\n');
  let first = -1, last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) { if (first < 0) first = i; last = i; }
  }
  if (first < 0 || last <= first) return '';
  return lines.slice(first + 1, last).join('\n').replace(/\n$/, '');
}

function guessLanguage(label) {
  const map = {
    'js': 'javascript', 'javascript': 'javascript', 'ts': 'typescript',
    'python': 'python', 'py': 'python', 'bash': 'bash', 'sh': 'bash',
    'c': 'c_cpp', 'cpp': 'c_cpp', 'c++': 'c_cpp', 'json': 'json',
    'html': 'html', 'css': 'css',
  };
  const k = label.toLowerCase();
  return map[k] || null;
}

/* 读取 massCode 标签注册表（id -> name），片段 frontmatter 里 tags 存的是 id */
function readTagRegistry() {
  try {
    const p = path.join(vaultPath(), 'code/.masscode/state.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const list = Array.isArray(d.tags) ? d.tags.map((t) => ({ id: t.id, name: t.name })) : [];
    const map = {};
    for (const t of list) map[String(t.id)] = t.name;
    return { map, list };
  } catch (_) { return { map: {}, list: [] }; }
}

/* 把 parseFrontmatter 的 {meta, body} 序列化回 massCode 格式 frontmatter + body */
function stringifyFrontmatter(fm) {
  const m = fm.meta || {};
  const lines = ['---'];
  if (Array.isArray(m.contents) && m.contents.length) {
    lines.push('contents:');
    for (const c of m.contents) {
      lines.push('  - id: ' + (c.id !== undefined ? c.id : ''));
      if (c.label !== undefined) lines.push('    label: ' + c.label);
      if (c.language !== undefined) lines.push('    language: ' + c.language);
    }
  }
  for (const k of ['createdAt', 'description', 'folderId', 'id', 'isDeleted', 'isFavorites', 'name', 'updatedAt']) {
    if (m[k] === undefined) continue;
    if (k === 'description') lines.push('description: ' + (m[k] ? JSON.stringify(m[k]) : '""'));
    else lines.push(k + ': ' + m[k]);
  }
  lines.push('tags:');
  for (const t of (Array.isArray(m.tags) ? m.tags : [])) lines.push('  - ' + t);
  return lines.join('\n') + '\n---\n' + (fm.body || '');
}

/* 片段解析缓存：walkSnippets() 被 13 个接口调用（运行/检查/格式化/保存/LSP/时间线…），
   原实现每次都把整个 vault 的 .md 全部读盘 + 解析 frontmatter + 抽取片段，1000 片段规模下
   单次操作要同步读十几 MB。这里按「文件 mtimeMs + size」缓存解析结果（写入必然改 mtime，
   且应用本来就以同一指纹判定数据变化），返回时对片段对象做浅拷贝，避免调用方改到缓存。 */
const SNIPPET_FILE_CACHE = new Map();
const SNIPPET_FILE_CACHE_MAX = 2000;
function walkSnippets() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const out = [];
  if (!fs.existsSync(codeRoot)) return out;
  const tagReg = readTagRegistry();
  const alive = new Set();
  const walk = (dir, folder) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.masscode') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, path.join(folder, e.name));
      else if (e.name.endsWith('.md')) {
        alive.add(full);
        try {
          const stat = fs.statSync(full), cacheKey = stat.mtimeMs + ':' + stat.size;
          const hit = SNIPPET_FILE_CACHE.get(full);
          let parsed = hit && hit.key === cacheKey ? hit.value : undefined;
          if (parsed === undefined) {
            const text = fs.readFileSync(full, 'utf8');
            const { meta, body } = parseFrontmatter(text);
            parsed = meta.isDeleted === '1' ? null : {
              name: meta.name || path.basename(e.name, '.md'),
              description: (meta.description && meta.description !== 'null') ? meta.description : '',
              isFavorites: meta.isFavorites === '1',
              updatedAt: Number(meta.updatedAt) || 0,
              tagIds: Array.isArray(meta.tags) ? meta.tags.map(Number).filter(Number.isFinite) : [],
              fragments: extractFragments(meta, body),
            };
            SNIPPET_FILE_CACHE.set(full, { key: cacheKey, value: parsed });
          }
          if (!parsed) continue;
          out.push({
            file: full,
            name: parsed.name,
            description: parsed.description,
            isFavorites: parsed.isFavorites,
            folder: folder.replace(/^\/+/, ''),
            updatedAt: parsed.updatedAt,
            tagIds: parsed.tagIds.slice(),
            tags: parsed.tagIds.map((id) => tagReg.map[String(id)]).filter(Boolean),
            fragments: parsed.fragments.map((f) => ({ ...f })),
          });
        } catch (_) { /* skip unreadable */ }
      }
    }
  };
  walk(codeRoot, '');
  if (SNIPPET_FILE_CACHE.size > SNIPPET_FILE_CACHE_MAX) SNIPPET_FILE_CACHE.clear();
  else for (const key of [...SNIPPET_FILE_CACHE.keys()]) if (!alive.has(key)) SNIPPET_FILE_CACHE.delete(key);
  out.sort((a, b) => a.folder.localeCompare(b.folder) || b.updatedAt - a.updatedAt);
  return out;
}

// 完整文件夹结构（含空文件夹），用于前端目录树按真实结构渲染
function walkFolders() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const out = [];
  if (!fs.existsSync(codeRoot)) return out;
  const readMeta = (full) => {
    let name = path.basename(full), id = null, orderIndex = null;
    try {
      const m = fs.readFileSync(path.join(full, '.meta.yaml'), 'utf8');
      let mm = /^name:\s*(.+)$/m.exec(m); if (mm && mm[1].trim() !== '') name = mm[1].trim();
      mm = /^id:\s*(.+)$/m.exec(m); if (mm) id = String(mm[1]).trim();
      mm = /^orderIndex:\s*(.+)$/m.exec(m); if (mm) orderIndex = Number(mm[1]) || 0;
    } catch (_) {}
    return { name, id, orderIndex };
  };
  const walk = (dir, parentPath) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue; // 跳过 .masscode 等隐藏元数据目录
      const full = path.join(dir, e.name);
      const rel = parentPath ? parentPath + '/' + e.name : e.name;
      const meta = readMeta(full);
      out.push({ path: rel, name: meta.name, id: meta.id, orderIndex: meta.orderIndex, parent: parentPath || '' });
      walk(full, rel);
    }
  };
  walk(codeRoot, '');
  out.sort((a, b) => (a.parent === b.parent ? (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || a.name.localeCompare(b.name, 'zh') : a.parent.localeCompare(b.parent)));
  return out;
}

const LATEX_RESOURCE_DIRS = new Set(['data', 'figures', 'fonts']);
const LATEX_TEXT_EXTS = new Set(['.bib', '.tex', '.sty', '.cls', '.csv', '.json', '.yaml', '.yml', '.txt']);
const LATEX_RESOURCE_EXTS = new Set([...LATEX_TEXT_EXTS, '.bst', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.eps', '.otf', '.ttf', '.ttc', '.woff', '.woff2']);

function latexResourceKind(rel) {
  const parts = String(rel || '').split('/');
  return parts.find((part) => LATEX_RESOURCE_DIRS.has(part)) || '';
}
function resolveLatexResource(rel, allowMissing) {
  rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('资源路径不合法');
  const kind = latexResourceKind(rel), ext = path.extname(rel).toLowerCase();
  if (!kind || !LATEX_RESOURCE_EXTS.has(ext)) throw new Error('只允许访问 LaTeX 的 data / figures / fonts 资源');
  const root = path.resolve(path.join(vaultPath(), 'code'));
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error('资源路径越界');
  if (!allowMissing && !fs.existsSync(full)) throw new Error('资源不存在');
  return { rel, full, root, kind, ext };
}
function walkLatexResources() {
  const root = path.join(vaultPath(), 'code'), out = [];
  const walk = (dir, rel) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, childRel); continue; }
      const kind = latexResourceKind(childRel), ext = path.extname(entry.name).toLowerCase();
      if (!kind || !LATEX_RESOURCE_EXTS.has(ext)) continue;
      let size = 0, updatedAt = 0; try { const st = fs.statSync(full); size = st.size; updatedAt = st.mtimeMs; } catch (_) {}
      out.push({ path: childRel, folder: path.posix.dirname(childRel) === '.' ? '' : path.posix.dirname(childRel), name: entry.name, kind, ext, size, updatedAt, text: LATEX_TEXT_EXTS.has(ext) });
    }
  };
  walk(root, '');
  return out.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
}

/* 原子写：同目录临时文件 + rename。
   裸 writeFileSync 在磁盘满/进程被强杀/iCloud 同步中断时会留下“半截文件”，而片段 .md 与
   .masscode/state.json 一旦被截断，用户代码与整个片段索引都会损坏（本仓库此前只有
   Office/XMind 少数几处用了 temp+rename 的写法）。 */
function writeFileAtomicSync(file, data, options) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp-' + process.pid + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  let mode;
  try { mode = fs.statSync(file).mode; } catch (_) {}
  fs.writeFileSync(tmp, data, options);
  if (mode !== undefined) { try { fs.chmodSync(tmp, mode); } catch (_) {} }
  fs.renameSync(tmp, file);
  return file;
}

/* massCode 元数据库 .masscode/state.json：新建/移动片段与文件夹时需要登记，保证 massCode 识别 */
const STATE_EMPTY = () => ({ version: 3, counters: { contentId: 1, folderId: 1, snippetId: 1, tagId: 1 }, folderIdByPath: {}, folderUi: {}, snippets: [], tags: [] });
/* 把「磁盘上确实存在、但状态库里没有」的片段补登记后再继续。
   state.json 只由 massCode 与本站的新建接口维护，所以另一台机器通过 iCloud 同步进来的
   .md（本项目的 vault 就放在 iCloud 里）、手工复制进来的文件、或 massCode 尚未同步的改动，
   都会「列表里看得到、一移动 / 重命名 / 删除就报片段不在状态库中」。
   调用它的 5 个接口（move / update / addfragment / delfragment / delete）本来就要写 state，
   因此补登记不会引入额外的写入路径。 */
function adoptSnippetFromDisk(st, file) {
  const codeRoot = path.join(vaultPath(), 'code');
  const full = path.resolve(codeRoot, String(file || ''));
  if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return null;
  const hit = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === full);
  if (hit) return hit;
  let stat;
  try { stat = fs.statSync(full); } catch (_) { return null; }
  if (!stat.isFile()) return null;
  let meta = {};
  try { meta = parseFrontmatter(fs.readFileSync(full, 'utf8')).meta || {}; } catch (_) { return null; }
  const rel = path.relative(codeRoot, full).split(path.sep).join('/');
  const now = Date.now();
  const entry = {
    filePath: rel,
    id: Number(meta.id) || ++st.counters.contentId,
    meta: {
      contents: Array.isArray(meta.contents) ? meta.contents : [],
      createdAt: meta.createdAt || now,
      description: meta.description || null,
      folderId: meta.folderId || 0,
      isDeleted: 0,
      isFavorites: Number(meta.isFavorites) || 0,
      mtimeMs: stat.mtimeMs,
      name: String(meta.name || path.basename(full).replace(/\.md$/i, '')),
      size: stat.size,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      updatedAt: meta.updatedAt || now,
    },
  };
  st.snippets.push(entry);
  writeState(st);
  console.log('[codescope] 片段未登记，已从磁盘补登记：' + rel);
  return entry;
}

function readState() {
  const file = path.join(vaultPath(), 'code', '.masscode', 'state.json');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    // 只有“确实不存在”才算空库；其它读取失败要留痕，不能装作没事。
    if (error && error.code !== 'ENOENT') console.error('读取 massCode 状态库失败：' + String(error.message || error));
    return STATE_EMPTY();
  }
  try { return JSON.parse(text); }
  catch (error) {
    // 状态库损坏时原来会静默当作空库，用户看到的是“整个片段库消失”，而且下次写入会直接
    // 覆盖掉损坏文件、把唯一的恢复线索也销毁。这里改为：保留损坏文件 + 尽力抢救 id 计数器
    // （计数器归零会导致新片段 id 与既有 .md 冲突），并明确报错。
    const kept = file + '.corrupt-' + Date.now();
    try { fs.renameSync(file, kept); } catch (_) {}
    const empty = STATE_EMPTY();
    for (const key of Object.keys(empty.counters)) {
      const found = new RegExp('"' + key + '"\\s*:\\s*(\\d+)').exec(text);
      if (found) empty.counters[key] = Number(found[1]);
    }
    console.error('massCode 状态库无法解析，已保留为 ' + kept + '、并按 id 计数器 ' + JSON.stringify(empty.counters) + ' 继续运行（原始错误：' + String(error.message || error) + '）');
    return empty;
  }
}
function writeState(st) {
  const p = path.join(vaultPath(), 'code', '.masscode', 'state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeFileAtomicSync(p, JSON.stringify(st, null, 2), 'utf8');
}

/* 按标签名解析为 id，不存在的自动新建（massCode 标签注册表） */
function syncTags(st, names) {
  const ids = [];
  const byName = new Map();
  for (const t of st.tags) byName.set(t.name, t.id);
  for (const raw of names || []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    let id = byName.get(name);
    if (id === undefined) {
      id = ++st.counters.tagId;
      const now = Date.now();
      st.tags.push({ createdAt: now, id, name, updatedAt: now });
      byName.set(name, id);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/* 重写所有片段 frontmatter 里的 tags 列表（只动 tags 那几行，其余内容原样保留）。
   fromId 换成 toId；toId 为 null 表示删除该标签。返回被改动的片段数。 */
function retagSnippets(fromId, toId) {
  const codeRoot = path.join(vaultPath(), 'code');
  let changed = 0;
  const rewriteFile = (full) => {
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch (_) { return; }
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return;
    const lines = m[1].split('\n');
    const out = [];
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^\s*tags\s*:/.test(line)) { out.push(line); continue; }
      const indent = (line.match(/^\s*/) || [''])[0];
      const ids = [];
      const inline = line.match(/\[([^\]]*)\]/);
      if (inline) for (const piece of inline[1].split(',')) { const n = Number(String(piece).trim()); if (Number.isFinite(n)) ids.push(n); }
      let j = i + 1;
      while (j < lines.length && /^\s*-\s*\d+\s*$/.test(lines[j])) { ids.push(Number(lines[j].trim().replace(/^-\s*/, ''))); j++; }
      const next = [];
      for (const value of ids) {
        const mapped = value === fromId ? toId : value;
        if (mapped === null || mapped === undefined) { touched = true; continue; }
        if (!next.includes(mapped)) next.push(mapped);
      }
      if (ids.includes(fromId)) touched = true;
      out.push(indent + 'tags:');
      for (const value of next) out.push(indent + '  - ' + value);
      i = j - 1;
    }
    if (!touched) return;
    const nextText = text.slice(0, m.index) + '---\n' + out.join('\n') + '\n---' + text.slice(m.index + m[0].length);
    const tmp = full + '.tags-tmp';
    try { fs.writeFileSync(tmp, nextText, 'utf8'); fs.renameSync(tmp, full); changed++; }
    catch (_) { try { fs.unlinkSync(tmp); } catch (__) {} }
  };
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.toLowerCase().endsWith('.md')) rewriteFile(full);
    }
  };
  walk(codeRoot);
  return changed;
}

/* 版本指纹：所有片段文件的 路径+mtime+大小 的哈希，用于前端实时同步检测。
   也纳入 state.json（标签/计数）与 .meta.yaml（文件夹元数据），保证新增/改名标签也能触发同步 */
function computeRev() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const parts = [];
  const addFile = (p) => {
    try {
      const st = fs.statSync(p);
      parts.push(p + ':' + st.mtimeMs + ':' + st.size);
    } catch (_) {}
  };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.masscode') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else addFile(full);
    }
  };
  walk(codeRoot);
  addFile(path.join(codeRoot, '.masscode/state.json'));
  const s = parts.sort().join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* --------------------------------- 执行引擎 ---------------------------------- */

const RUN_OUTPUT_LIMIT = 2 * 1024 * 1024;   // 单流输出上限 2 MB（超出截断并标记）
// 运行/检查产生的临时目录保留时长：到期自动回收（可用环境变量覆盖，便于测试）
const TMP_TTL_MS = Math.max(1000, Number(process.env.CODESCOPE_TMP_TTL_MS) || 30 * 60 * 1000);

// 到期回收临时目录（unref，不阻塞进程退出）；服务每次运行都会新建目录，必须回收
function scheduleTempCleanup(dir) {
  const timer = setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }, TMP_TTL_MS);
  if (timer.unref) timer.unref();
}

// 启动时清扫历史残留（例如服务被强杀时留下的目录）
function sweepTempDirs() {
  try {
    const root = os.tmpdir();
    const now = Date.now();
    let removed = 0;
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith('mscr-')) continue;
      const full = path.join(root, name);
      try {
        if (now - fs.statSync(full).mtimeMs > TMP_TTL_MS) { fs.rmSync(full, { recursive: true, force: true }); removed++; }
      } catch (_) {}
    }
    return removed;
  } catch (_) { return 0; }
}

function run(interp, args, opts = {}) {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs || 10000;
    const cwd = opts.cwd;
    const child = spawn(interp, args, {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', truncated = false;
    // 输出上限：单流最多保留 OUTPUT_LIMIT，避免用户打印海量内容时把服务内存吃满
    const collect = (chunk, isErr) => {
      const text = String(chunk);
      const current = isErr ? stderr : stdout;
      if (current.length >= RUN_OUTPUT_LIMIT) { truncated = true; return; }
      const room = RUN_OUTPUT_LIMIT - current.length;
      const next = text.length > room ? text.slice(0, room) : text;
      if (text.length > room) truncated = true;
      if (isErr) stderr = current + next; else stdout = current + next;
    };
    const tail = () => truncated ? '\n…（输出超过 ' + Math.round(RUN_OUTPUT_LIMIT / 1048576) + ' MB 已截断）' : '';
    const timer = setTimeout(() => {
      // 超时终止：POSIX 用进程组(负 pid)，Windows 无进程组概念，退回 child.kill()
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, timedOut: true, stdout: stdout + tail(), stderr, code: null, truncated });
    }, timeoutMs);
    child.stdout.on('data', (d) => collect(d, false));
    child.stderr.on('data', (d) => collect(d, true));
    // 写入 stdin（无输入时也立即关闭，避免 `while(cin>>x)` 挂起）
    try {
      if (opts.input) child.stdin.write(opts.input);
    } catch (_) {}
    try { child.stdin.end(); } catch (_) {}
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err.message || err), stdout: stdout + tail(), stderr, code: null, truncated });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, signal, stdout: stdout + tail(), stderr, truncated });
    });
  });
}

function writeTemp(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mscr-'));
  const f = path.join(dir, name);
  writeFileAtomicSync(f, content);
  scheduleTempCleanup(dir);
  return { dir, file: f };
}

// 库文件/驱动模块没有 main() 时，编译器会在链接阶段输出平台相关的晦涩错误。
// 统一识别 macOS/Linux/Windows 的“缺少程序入口”，交给前端显示为仅编译结果。
function normalizeMissingEntry(result) {
  if (!result || result.ok) return result;
  const message = String(result.stderr || result.error || '');
  const missingMain = /(?:undefined symbols?[\s\S]*["'`]_main["'`]|undefined reference to\s*["'`](?:main|WinMain)["'`]|unresolved external symbol\s+(?:_?main|WinMain)|entry point[^\n]*(?:main|WinMain))/i.test(message);
  if (!missingMain) return result;
  return {
    ...result,
    noEntry: true,
    stderr: '',
    reason: '当前代码没有 main() 入口函数，已完成编译检查，但不会生成或运行可执行程序。若这是驱动、库或接口模块，可直接使用“语法检查”；需要运行时请新增 main.c / main.cpp 并定义 int main(void)。',
  };
}

// CJK OpenType 字体常见为 10–25 MB；原来的单文件 10 MB 限制会把字体静默跳过，
// 最终只留下难以理解的 fontspec Error。允许常见字体通过，同时保留总量上限。
const LATEX_RESOURCE_FILE_LIMIT = 32 * 1024 * 1024;
const LATEX_RESOURCE_TOTAL_LIMIT = 96 * 1024 * 1024;

// 在独立临时目录编译 LaTeX，并禁用 shell escape。额外拦截显式绝对路径/上级目录引用。
async function copyLatexResources(sourceFile, targetDir) {
  const result = { copied: 0, bytes: 0, skipped: [] };
  if (!sourceFile) return result;
  const codeRoot = path.resolve(path.join(vaultPath(), 'code'));
  const resolved = path.resolve(String(sourceFile));
  if (!resolved.startsWith(codeRoot + path.sep) || path.extname(resolved).toLowerCase() !== '.md') return result;
  const sourceDir = path.dirname(resolved);
  const allowed = new Set(['.tex', '.sty', '.cls', '.bib', '.bst', '.csv', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.otf', '.ttf', '.ttc']);
  let total = 0;
  // 全程异步 fs：云盘（iCloud 等）目录枚举/stat 也可能同步挂起主线程从而卡死整个服务，
  // 一律交给 libuv 线程池执行，任何文件系统卡顿只影响当前请求（由外层超时兜底）。
  const copyDir = async (from, to, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = await fs.promises.readdir(from, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const src = path.join(from, entry.name), dst = path.join(to, entry.name);
      if (entry.isDirectory()) { try { await fs.promises.mkdir(dst, { recursive: true }); } catch (_) {} await copyDir(src, dst, depth + 1); continue; }
      if (!entry.isFile() || !allowed.has(path.extname(entry.name).toLowerCase())) continue;
      let size = 0; try { size = (await fs.promises.stat(src)).size; } catch (_) { continue; }
      const relative = path.relative(sourceDir, src).split(path.sep).join('/');
      if (size > LATEX_RESOURCE_FILE_LIMIT) { result.skipped.push(relative + '（单文件超过 32 MB）'); continue; }
      if (total + size > LATEX_RESOURCE_TOTAL_LIMIT) { result.skipped.push(relative + '（工程资源总量超过 96 MB）'); continue; }
      // 异步复制：云盘文件若未下载到本地，pread 会挂起——挂在 libuv 线程池线程上，
      // 而不是主线程，服务其余请求不受影响。同时给单文件复制加 10 秒硬超时：
      // 云盘资源长期拉不下来就直接跳过该资源继续编译，编译请求必须会结束，
      // 绝不会无限等待（前端请求因此不会再被拖到超时）。
      try {
        await Promise.race([
          fs.promises.copyFile(src, dst),
          new Promise((_, reject) => setTimeout(() => reject(new Error('copy timeout')), 10000)),
        ]);
        total += size; result.copied++;
      }
      catch (_) { result.skipped.push(relative + '（复制超时或失败）'); }
    }
  };
  await copyDir(sourceDir, targetDir, 0);
  result.bytes = total;
  return result;
}

const LATEX_BIB_CACHE = new Map();
async function latexBibliographyKey(dir, sourceFile, code) {
  const parts = [String(sourceFile || '')];
  const commands = String(code || '').match(/\\(?:addbibresource|bibliography|bibliographystyle|nocite|[A-Za-z]*cite[A-Za-z]*)\*?(?:\[[^\]]*\])?\{[^}]*\}/g) || [];
  parts.push(commands.join('|'));
  const walk = async (folder) => {
    let entries = [];
    try { entries = await fs.promises.readdir(folder, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.bib') {
        // 资源每次都会复制进新的临时目录，mtime 会随复制而变化；按内容计算才能稳定命中缓存。
        try { parts.push(path.relative(dir, full) + ':' + await fs.promises.readFile(full, 'utf8')); } catch (_) {}
      }
    }
  };
  await walk(dir);
  let hash = 5381, joined = parts.sort().join('|');
  for (let i = 0; i < joined.length; i++) hash = ((hash * 33) ^ joined.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

async function compileLatex(code, sourceFile) {
  const { tools: env } = await getEnv();
  if (!env.latex || !env.latex.available) {
    return { ok: false, unsupported: true, reason: missingReason('latex', env.latex) };
  }
  const unsafeFileRef = /\\(?:input|include|includegraphics|bibliography|addbibresource|lstinputlisting|verbatiminput|inputminted|openin)\b[^\r\n{=]*(?:\{|=)\s*(?:\/|[A-Za-z]:[\\/]|\.\.[\\/])/i;
  if (unsafeFileRef.test(code)) {
    return { ok: false, error: '为安全起见，实时预览不允许读取绝对路径或上级目录中的文件', log: '当前实时预览仅编译片段内的自包含 LaTeX 文档。' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mscr-latex-'));
  const source = path.join(dir, 'main.tex');
  const pdf = path.join(dir, 'main.pdf');
  const cmd = latexCmd();
  const copiedResources = await copyLatexResources(sourceFile, dir);
  const bibKey = await latexBibliographyKey(dir, sourceFile, code), cachedBbl = LATEX_BIB_CACHE.get(bibKey);
  if (cachedBbl) writeFileAtomicSync(path.join(dir, 'main.bbl'), cachedBbl);
  writeFileAtomicSync(source, code, 'utf8');
  const started = Date.now();
  try {
    const runFile = (program, args, timeout = 30000) => new Promise((resolve) => {
      execFile(program, args, {
        cwd: dir, timeout, maxBuffer: 6 * 1024 * 1024,
        env: { ...process.env, openin_any: 'p', openout_any: 'p', TEXMFOUTPUT: dir },
      }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
    });
    const texArgs = [
        '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error',
        '-cnf-line=openin_any=p', '-cnf-line=openout_any=p',
        '-file-line-error', '-synctex=0', '-output-directory=.', 'main.tex',
    ];
    let result = await runFile(cmd, texArgs), pipeline = cmd, texPasses = 1;
    const clean = (s) => String(s || '').split(dir).join('[临时目录]');
    const resourceWarning = copiedResources.skipped.length
      ? '[CodeScope] 以下 LaTeX 资源因大小限制未复制：\n- ' + copiedResources.skipped.join('\n- ') + '\n'
      : '';
    let log = resourceWarning + clean(result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim();
    if (!result.err && fs.existsSync(path.join(dir, 'main.bcf')) && cachedBbl) {
      pipeline += ' + biber缓存';
    } else if (!result.err && fs.existsSync(path.join(dir, 'main.bcf')) && executablePath('biber')) {
      const bib = await runFile('biber', ['--input-directory', dir, '--output-directory', dir, 'main'], 30000);
      log += '\n' + clean(bib.stdout + (bib.stderr ? '\n' + bib.stderr : ''));
      if (bib.err) result = bib;
      else {
        pipeline += ' + biber';
        for (let pass = 0; pass < 2; pass++) {
          const again = await runFile(cmd, texArgs);
          texPasses++;
          log += '\n' + clean(again.stdout + (again.stderr ? '\n' + again.stderr : ''));
          if (again.err) { result = again; break; }
        }
        if (!result.err && fs.existsSync(path.join(dir, 'main.bbl'))) {
          LATEX_BIB_CACHE.set(bibKey, fs.readFileSync(path.join(dir, 'main.bbl')));
          if (LATEX_BIB_CACHE.size > 20) LATEX_BIB_CACHE.delete(LATEX_BIB_CACHE.keys().next().value);
        }
      }
    } else if (!result.err && fs.existsSync(path.join(dir, 'main.aux')) && /\\bibdata\{/.test(fs.readFileSync(path.join(dir, 'main.aux'), 'utf8')) && executablePath('bibtex')) {
      const bib = await runFile('bibtex', ['main'], 30000);
      log += '\n' + clean(bib.stdout + (bib.stderr ? '\n' + bib.stderr : ''));
      if (bib.err) result = bib;
      else {
        pipeline += ' + bibtex';
        for (let pass = 0; pass < 2; pass++) { const again = await runFile(cmd, texArgs); texPasses++; log += '\n' + clean(again.stdout + (again.stderr ? '\n' + again.stderr : '')); if (again.err) { result = again; break; } }
      }
    }
    // 交叉引用、目录以及 TikZ remember picture 的页面坐标至少需要两遍编译。
    // 本地编辑器通常会自动重跑；实时预览也保持相同行为，避免首遍页眉/页脚错位。
    if (!result.err && texPasses < 2) {
      const again = await runFile(cmd, texArgs);
      texPasses++;
      log += '\n' + clean(again.stdout + (again.stderr ? '\n' + again.stderr : ''));
      result = again;
    }
    if (texPasses > 1) pipeline += ' × ' + texPasses + ' 遍';
    if (result.err || !fs.existsSync(pdf)) {
      const timedOut = result.err && (result.err.killed || result.err.code === 'ETIMEDOUT');
      return {
        ok: false,
        timedOut: !!timedOut,
        engine: cmd,
        elapsedMs: Date.now() - started,
        error: timedOut ? 'LaTeX 编译超过 30 秒，已停止' : 'LaTeX 编译失败',
        log: log.slice(-12000),
      };
    }
    const pageMatch = log.match(/Output written on .*?\((\d+) pages?/i);
    return {
      ok: true,
      engine: pipeline,
      elapsedMs: Date.now() - started,
      pages: pageMatch ? Number(pageMatch[1]) : null,
      pdf: fs.readFileSync(pdf).toString('base64'),
      log: log.slice(-4000),
    };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

// 把多个片段（含文件名）写入同一个临时目录，支持跨文件引用 / 一起编译
function writeFragments(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mscr-'));
  for (const f of files || []) {
    if (!f.filename) continue;
    // 兜底：文件名只取 basename，任何情况下都不得写出临时目录之外
    const safeName = path.basename(String(f.filename));
    if (!safeName || safeName === '.' || safeName === '..') continue;
    writeFileAtomicSync(path.join(dir, safeName), f.code || '');
  }
  scheduleTempCleanup(dir);
  return dir;
}

// 环境守卫：缺工具时返回明确提示，而不是晦涩的 spawn 报错
async function guard(key, fn) {
  const { tools: env } = await getEnv();
  if (!env[key] || !env[key].available) return { ok: false, unsupported: true, reason: missingReason(key, env[key]) };
  return fn();
}

function runnerFor(language) {
  const key = (language || '').toLowerCase();
  switch (key) {
    case 'javascript':
      return {
        supported: true,
        check: (code) => guard('node', () => run('node', ['--check', writeTemp('check.js', code).file])),
        run: (code, opts) => guard('node', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.mjs', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('node', [entry], { cwd: dir, timeoutMs: 10000, input: opts.input });
        }),
      };
    case 'typescript':
      return {
        supported: true,
        check: (code) => guard('node', () => run('node', ['--check', writeTemp('check.ts', code).file])),
        run: (code, opts) => guard('node', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.ts', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('node', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'python':
      return {
        supported: true,
        check: (code) => guard('python3', () => run(pythonCmd(), ['-m', 'py_compile', writeTemp('check.py', code).file])),
        run: (code, opts) => guard('python3', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.py', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run(pythonCmd(), [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'bash':
    case 'shell':
      return {
        supported: true,
        check: (code) => guard('bash', () => run('bash', ['-n', writeTemp('check.sh', code).file])),
        run: (code, opts) => guard('bash', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.sh', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('bash', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'c_cpp':
      return {
        supported: true,
        // 按文件扩展名决定 C/C++：.c → gcc(C17)，其余 → g++(C++17)，避免 clang++ 的 "treating 'c' input as 'c++'" 告警
        check: (code, opts) => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'check.cpp', code }];
          const dir = writeFragments(files);
          const sel = files[(opts.selIndex || 0)] || files[0];
          const entry = path.join(dir, sel.filename);
          const isC = /\.c$/i.test(sel.filename);
          return guard(isC ? 'gcc' : 'gpp', () => run(isC ? 'gcc' : 'g++', [isC ? '-std=c17' : '-std=c++17', '-I', dir, '-fsyntax-only', entry], { timeoutMs: 30000 }));
        },
        run: (code, opts) => guard('gpp', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.cpp', code }];
          const dir = writeFragments(files);
          const srcs = files.filter((f) => /\.(c|cc|cpp|cxx)$/i.test(f.filename)).map((f) => f.filename);
          if (!srcs.length) return { ok: false, code: 1, stdout: '', stderr: '没有可编译的 C/C++ 源文件' };
          const bin = path.join(dir, 'a.out');
          // 逐个 .c 用 gcc(C)、.cpp 用 g++(C++) 编译成 .o，再统一链接
          const steps = srcs.map((fn) => {
            const isC = /\.c$/i.test(fn);
            const tool = isC ? 'gcc' : 'g++';
            const std = isC ? '-std=c17' : '-std=c++17';
            return guard(isC ? 'gcc' : 'gpp', () => run(tool, [std, '-I', dir, '-c', path.join(dir, fn), '-o', path.join(dir, fn + '.o')], { timeoutMs: 40000 }));
          });
          return Promise.all(steps).then((results) => {
            const bad = results.find((r) => !r.ok);
            if (bad) return bad;
            const objs = srcs.map((fn) => path.join(dir, fn + '.o'));
            return run('g++', ['-I', dir, ...objs, '-o', bin], { timeoutMs: 40000 })
              .then((r) => r.ok ? run(bin, [], { cwd: dir, timeoutMs: 15000, input: opts.input }) : normalizeMissingEntry(r));
          });
        }),
      };
    case 'c':
      return {
        supported: true,
        check: (code, opts) => guard('gcc', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'check.c', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('gcc', ['-std=c17', '-I', dir, '-fsyntax-only', entry], { timeoutMs: 30000 });
        }),
        run: (code, opts) => guard('gcc', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.c', code }];
          const dir = writeFragments(files);
          const srcs = files.filter((f) => /\.c$/i.test(f.filename)).map((f) => path.join(dir, f.filename));
          const bin = path.join(dir, 'a.out');
          const gargs = ['-std=c17', '-I', dir, ...srcs, '-o', bin];
          return run('gcc', gargs, { timeoutMs: 40000 })
            .then((r) => r.ok ? run(bin, [], { cwd: dir, timeoutMs: 15000, input: opts.input }) : normalizeMissingEntry(r));
        }),
      };
    case 'java': {
      const javaFile = (code, name) => {
        const m = /(?:public\s+)?(?:final\s+)?class\s+(\w+)/.exec(code);
        return writeTemp((m ? m[1] : name) + '.java', code);
      };
      return {
        supported: true,
        check: (code) => guard('java', () => {
          const { dir, file } = javaFile(code, 'Check');
          return run('javac', ['-d', dir, file], { timeoutMs: 30000 });
        }),
        run: (code, opts) => guard('java', () => {
          const { dir, file } = javaFile(code, 'Main');
          // 注意：第二参数是 { input, selIndex, files }，之前误把整个对象当 input 写入 stdin
          return run('java', [file], { cwd: dir, timeoutMs: 20000, input: opts && opts.input }); // Java 11+ 单文件源码运行
        }),
      };
    }
    case 'ruby':
      return {
        supported: true,
        check: (code) => guard('ruby', () => run('ruby', ['-c', writeTemp('check.rb', code).file])),
        run: (code, opts) => guard('ruby', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.rb', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('ruby', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'swift':
      return {
        supported: true,
        check: (code) => guard('swift', () => run('swiftc', ['-typecheck', writeTemp('check.swift', code).file], { timeoutMs: 40000 })),
        run: (code, opts) => guard('swift', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.swift', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('swift', [entry], { cwd: dir, timeoutMs: 30000, input: opts.input });
        }),
      };
    case 'go':
      return {
        supported: true,
        check: (code) => guard('go', () => {
          const { dir, file } = writeTemp('main.go', code);
          return run('go', ['vet', file], { timeoutMs: 30000 }).then((r) => ({ ...r, ok: r.code === 0 }));
        }),
        run: (code, opts) => guard('go', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.go', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('go', ['run', entry], { cwd: dir, timeoutMs: 30000, input: opts.input });
        }),
      };
    case 'json': {
      return {
        supported: true,
        check: (code) => {
          try { JSON.parse(code); return Promise.resolve({ ok: true, stdout: 'JSON 有效', stderr: '', code: 0 }); }
          catch (e) { return Promise.resolve({ ok: false, stdout: '', stderr: 'JSON 解析错误: ' + e.message, code: 1 }); }
        },
        run: (code) => Promise.resolve({ ok: true, stdout: 'JSON 无需运行（可用右侧“格式化/校验”查看结构）', stderr: '', code: 0 }),
      };
    }
    case 'html': {
      return {
        supported: true,
        check: (code) => Promise.resolve({ ok: true, stdout: 'HTML 使用“预览”在浏览器中渲染', stderr: '', code: 0 }),
        run: (code) => Promise.resolve({ ok: true, stdout: 'HTML 已生成预览，请点击下方“预览”按钮。', stderr: '', code: 0 }),
      };
    }
    default:
      return { supported: false, reason: '暂不支持运行 "' + (language || '未知') + '"（可运行: JavaScript / TypeScript / Python / Bash / C / C++ / Java / Ruby / Swift / Go / JSON / HTML）' };
  }
}

/* --------------------------------- 格式化 ---------------------------------- */

/* 各语言对应的格式化工具：
   - Prettier：通过 npx 按需下载（JS/TS/JSON/HTML/CSS/YAML/Markdown/Bash）
   - clang-format：C/C++（本机自带，无需下载）
   - gofmt：Go（本机自带） */
const FORMATTERS = {
  javascript:  { name: 'Prettier', key: 'npx', prettier: 'babel' },
  typescript:  { name: 'Prettier', key: 'npx', prettier: 'typescript' },
  json:        { name: 'Prettier', key: 'npx', prettier: 'json' },
  json5:       { name: 'Prettier', key: 'npx', prettier: 'json5' },
  html:        { name: 'Prettier', key: 'npx', prettier: 'html' },
  css:         { name: 'Prettier', key: 'npx', prettier: 'css' },
  scss:        { name: 'Prettier', key: 'npx', prettier: 'scss' },
  less:        { name: 'Prettier', key: 'npx', prettier: 'less' },
  yaml:        { name: 'Prettier', key: 'npx', prettier: 'yaml' },
  markdown:    { name: 'Prettier', key: 'npx', prettier: 'markdown' },
  bash:        { name: 'Prettier', key: 'npx', prettier: 'bash' },
  shell:       { name: 'Prettier', key: 'npx', prettier: 'bash' },
  c_cpp:       { name: 'clang-format', key: 'clangformat', format: formatWithClangFormat },
  c:           { name: 'clang-format', key: 'clangformat', format: formatWithClangFormat },
  go:          { name: 'gofmt', key: 'gofmt', format: formatWithGofmt },
  python:      { name: 'black', key: 'black', format: formatWithBlack },
};

function formatWithClangFormat(code) {
  // 空样式 + 缩进 2，避免依赖用户机器上可能不存在的 .clang-format
  const { dir, file } = writeTemp('format.cpp', code);
  return new Promise((resolve) => {
    const args = ['-style={BasedOnStyle: LLVM, IndentWidth: 2, TabWidth: 2, UseTab: Never, ColumnLimit: 100}', file];
    execFile('clang-format', args, { timeout: 20000 }, (err, stdout, stderr) => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      if (err) resolve({ ok: false, reason: 'clang-format 失败: ' + (stderr || err.message).slice(0, 500) });
      else resolve({ ok: true, formatted: stdout });
    });
  });
}

function formatWithGofmt(code) {
  const { dir, file } = writeTemp('format.go', code);
  return new Promise((resolve) => {
    execFile('gofmt', [file], { timeout: 20000 }, (err, stdout, stderr) => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      if (err) resolve({ ok: false, reason: 'gofmt 失败: ' + (stderr || err.message).slice(0, 500) });
      else resolve({ ok: true, formatted: stdout });
    });
  });
}

function formatWithBlack(code) {
  // Ruff 的格式化器与 Black 兼容，并以 WASM 随 CodeScope 离线分发。
  try {
    const workspace = new Ruff.Workspace({
      'line-length': 100,
      'indent-width': 4,
      format: { 'indent-style': 'space', 'quote-style': 'double' },
    }, Ruff.PositionEncoding.UTF16);
    return Promise.resolve({ ok: true, formatted: workspace.format(String(code || '')) });
  } catch (error) {
    return Promise.resolve({ ok: false, reason: 'Python 格式化失败: ' + String(error && error.message || error).slice(0, 500) });
  }
}

function prettierArgs(parser, tmpFile) {
  // 与 massCode 编辑器偏好保持一致
  let tabWidth = 2, semi = false, singleQuote = false, trailing = 'all';
  try {
    const pref = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/massCode/v2/preferences.json'), 'utf8'));
    const e = pref.editor && pref.editor.code;
    if (e) { tabWidth = e.tabSize ?? 2; semi = e.semi ?? false; singleQuote = e.singleQuote ?? false; trailing = e.trailingComma ?? 'all'; }
  } catch (_) {}
  return ['--write', '--parser', parser, '--tab-width', String(tabWidth),
    semi ? '--semi' : '--no-semi', singleQuote ? '--single-quote' : '--no-single-quote',
    '--trailing-comma', trailing, tmpFile];
}

function formatWithPrettier(parser, code) {
  const ext = { babel: '.js', typescript: '.ts', json: '.json', json5: '.json5', html: '.html', css: '.css', scss: '.scss', less: '.less', yaml: '.yaml', markdown: '.md', bash: '.sh', sh: '.sh' }[parser] || '.txt';
  const { dir, file } = writeTemp('format' + ext, code);
  return new Promise((resolve) => {
    const runtime = nodeTool('prettier/bin/prettier.cjs', [
      ...(parser === 'bash' || parser === 'sh' ? ['--plugin=prettier-plugin-sh'] : []),
      ...prettierArgs(parser === 'bash' ? 'sh' : parser, file),
    ]);
    if (!runtime) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      resolve({ ok: false, reason: '应用内置 Prettier 不完整，请重新安装 CodeScope' });
      return;
    }
    execFile(runtime.command, runtime.args, { timeout: 60000, env:runtime.env, cwd:__dirname }, (err, stdout, stderr) => {
      if (err) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        resolve({ ok: false, reason: '应用内置 Prettier 执行失败: ' + (stderr || err.message).slice(0, 500) });
        return;
      }
      try { resolve({ ok: true, formatted: fs.readFileSync(file, 'utf8') }); }
      catch (e) { resolve({ ok: false, reason: String(e.message) }); }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    });
  });
}

/* 把格式化结果写回 vault 文件中对应片段 */
function writeBackFragment(file, fragment, newCode) {
  const text = fs.readFileSync(file, 'utf8');
  const { body } = parseFrontmatter(text);
  const bodyOffset = text.length - body.length; // body 在 text 中的绝对起点
  // 定位该片段对应的 fence
  const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
  const heads = [];
  let m;
  while ((m = headingRe.exec(body))) heads.push({ label: m[1].trim(), start: m.index });
  const target = heads[fragment.index];
  if (!target) return false;
  const segStart = target.start + body.slice(target.start).indexOf('\n') + 1;
  const segEnd = heads[fragment.index + 1] ? heads[fragment.index + 1].start : body.length;
  const seg = body.slice(segStart, segEnd);
  // 定位片段自己的围栏：段内【第一个】```（开）到【最后一个】```（关）。
  // 不能用非贪婪匹配：markdown 片段内容自带围栏代码块时会在内层 ``` 处截断，把片段后半截全删掉
  const segLines = seg.split('\n');
  let firstIdx = -1, lastIdx = -1;
  for (let i = 0; i < segLines.length; i++) {
    if (/^```/.test(segLines[i])) { if (firstIdx < 0) firstIdx = i; lastIdx = i; }
  }
  if (firstIdx < 0 || lastIdx <= firstIdx) return false;
  let pos = 0;
  const lineOffsets = [];
  for (const ln of segLines) { lineOffsets.push(pos); pos += ln.length + 1; } // +1 换行
  const openLine = segLines[firstIdx];
  const absStart = bodyOffset + segStart + lineOffsets[firstIdx];
  const absEnd = bodyOffset + segStart + lineOffsets[lastIdx] + segLines[lastIdx].length;
  const replacement = openLine + '\n' + newCode + '\n' + segLines[lastIdx];
  writeFileAtomicSync(file, text.slice(0, absStart) + replacement + text.slice(absEnd), 'utf8');
  return true;
}

/* 重排片段顺序：同时重排 frontmatter 的 contents 列表与 body 的 ## Fragment 段。
   order = 新顺序（原索引的排列，如 [2,0,1] 表示原第 2/0/1 段依次放到最前）。
   按原始文本切片重排，不改任何片段内容与格式。 */
function reorderFragments(file, order) {
  const text = fs.readFileSync(file, 'utf8');
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = fmRe.exec(text);
  if (!m) return { ok: false, error: '文件缺少 frontmatter' };
  const yamlRaw = m[1];
  const body = text.slice(m[0].length);
  const nl = yamlRaw.includes('\r\n') ? '\r\n' : '\n';
  const yamlLines = yamlRaw.split(/\r?\n/);

  // 1) 定位 contents 列表项的原始行块（2空格 "- " 项 + 4空格字段）
  const ci = yamlLines.findIndex((l) => /^contents:\s*$/.test(l));
  if (ci < 0) return { ok: false, error: 'frontmatter 缺少 contents' };
  const items = [];
  let cur = null;
  for (let i = ci + 1; i < yamlLines.length; i++) {
    const l = yamlLines[i];
    if (/^ {2}- /.test(l)) {
      if (cur) cur.end = i - 1;
      cur = { start: i, end: i };
      items.push(cur);
    } else if (/^ {4}/.test(l) && cur) {
      cur.end = i;
    } else if (cur && /^\s*$/.test(l)) {
      continue;
    } else if (cur && !/^\s/.test(l)) {
      break;
    } else if (cur) {
      cur.end = i;
    }
  }
  if (items.length === 0) return { ok: false, error: 'contents 为空，无法重排' };

  // 2) 定位 body 的 Fragment 段
  const heads = [];
  const hre = /^##\s*Fragment:\s*(.*)$/gm;
  let mm;
  while ((mm = hre.exec(body))) heads.push({ label: mm[1].trim(), start: mm.index });
  if (heads.length !== items.length) return { ok: false, error: 'contents 与 ## Fragment 段数量不一致，已取消重排' };

  // 3) 校验 order 是 0..n-1 的排列
  const n = items.length;
  if (!Array.isArray(order) || order.length !== n) return { ok: false, error: 'order 长度不符' };
  const seen = new Set();
  for (const o of order) {
    if (!Number.isInteger(o) || o < 0 || o >= n || seen.has(o)) return { ok: false, error: 'order 非法' };
    seen.add(o);
  }
  if (n === 1) return { ok: true };

  // 4) 重排 body 段（原始切片，完整保留）
  const segs = heads.map((h, i) => {
    const segStart = h.start + body.slice(h.start).indexOf('\n') + 1;
    const segEnd = i + 1 < heads.length ? heads[i + 1].start : body.length;
    return body.slice(segStart, segEnd);
  });
  const bodyHead = body.slice(0, heads[0].start);
  const newBody = bodyHead + order.map((oi) => '## Fragment: ' + heads[oi].label + '\n' + segs[oi]).join('');

  // 5) 重排 contents 原始行块
  const itemBlocks = items.map((it) => yamlLines.slice(it.start, it.end + 1));
  const before = yamlLines.slice(0, items[0].start);
  const after = yamlLines.slice(items[items.length - 1].end + 1);
  const newYaml = [].concat(before, order.map((oi) => itemBlocks[oi]).flat(), after).join(nl);

  // 6) 组装写回
  const out = '---' + nl + newYaml + nl + '---' + nl + newBody;
  writeFileAtomicSync(file, out, 'utf8');
  return { ok: true };
}

/* --------------------------------- Git 面板 ---------------------------------- */

/* ------------------------------- 底部终端（PTY）------------------------------- */

let TERM = null;   // 当前终端会话 { child, clients:Set<Response>, buffer:Buffer, mode, label }
function stopTerm() {
  const session = TERM;
  TERM = null;
  if (!session) return;
  for (const client of (session.clients || [])) { try { client.end(); } catch (_) {} }
  if (session.clients) session.clients.clear();
  if (session.child) { try { session.child.kill(); } catch (_) {} }
}
function writeTermChunk(session, data) {
  if (TERM !== session) return;
  const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
  session.buffer = Buffer.concat([session.buffer, chunk]);
  if (session.buffer.length > 256 * 1024) session.buffer = session.buffer.subarray(session.buffer.length - 256 * 1024);
  for (const client of session.clients) {
    try { client.write(chunk); } catch (_) { session.clients.delete(client); }
  }
}
function termSpawn(spec = {}) {
  try {
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const py = process.platform === 'win32' ? '' : executablePath(pythonCmd());
    // Unix 优先用 ptybridge 获得真实交互终端（sudo 可输入密码）；缺 Python 时回退普通交互 shell。
    // Windows 使用 PowerShell 管道模式，至少保证环境部署命令和常规命令可执行。
    const bridge = path.join(__dirname, 'ptybridge.py');
    const targetCommand = spec.command || shell;
    const targetArgs = Array.isArray(spec.args) ? spec.args : (process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-i']);
    const command = py ? py : targetCommand;
    const args = py ? ['-u', bridge, '--', targetCommand, ...targetArgs] : targetArgs;
    const child = spawn(command, args, { cwd: __dirname, env: { ...process.env, SHELL: shell }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    const session = {
      child, clients: new Set(), buffer: Buffer.alloc(0),
      mode: spec.mode || 'local', label: spec.label || '本地 shell',
      host: spec.host || '', port: spec.port || 0,
    };
    TERM = session;
    child.stdout.on('data', (d) => writeTermChunk(session, d));
    child.stderr.on('data', (d) => writeTermChunk(session, d));
    child.on('error', () => { if (TERM === session) TERM = null; });
    child.on('exit', () => {
      if (TERM !== session) return;
      TERM = null;
      for (const client of session.clients) { try { client.end(); } catch (_) {} }
      session.clients.clear();
    });
    return true;
  } catch (e) {
    TERM = null;
    return false;
  }
}

function remoteHost(value) {
  const host = String(value || '').trim();
  if (!host || host.length > 253 || host.startsWith('-') || !/^[A-Za-z0-9._:\[\]-]+$/.test(host)) return '';
  return host;
}
function remotePort(value, fallback) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}
function measureNetworkLatency(host, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const target = host.replace(/^\[|\]$/g, '');
    const ipv6 = target.includes(':');
    let command = executablePath('ping');
    let args;
    if (process.platform === 'win32') {
      args = [...(ipv6 ? ['-6'] : []), '-n', '1', '-w', '2000', target];
    } else {
      if (ipv6) command = executablePath('ping6') || command;
      args = process.platform === 'darwin'
        ? ['-n', '-c', '1', '-W', '2000', target]
        : ['-n', '-c', '1', '-W', '2', target];
    }
    if (!command) { resolve({ ok: false, error: '系统未安装 ping' }); return; }
    execFile(command, args, { encoding: 'utf8', timeout: timeoutMs }, (error, stdout, stderr) => {
      const output = String(stdout || '') + '\n' + String(stderr || '');
      const match = /time\s*[=<]\s*([0-9.]+)\s*ms/i.exec(output);
      if (!error && match) {
        resolve({ ok: true, latencyMs: Math.max(1, Math.round(Number(match[1]))) });
        return;
      }
      resolve({ ok: false, error: error && error.killed ? '检测超时' : '远端未响应 ping' });
    });
  });
}
function sshSessionSpec(body) {
  const ssh = executablePath('ssh');
  if (!ssh) return { error: '未检测到 OpenSSH 客户端，请先在“环境检测”中安装。' };
  const host = remoteHost(body && body.host);
  const port = remotePort(body && body.port, 22);
  const user = String((body && body.user) || '').trim();
  if (!host) return { error: 'SSH 主机地址不合法' };
  if (!port) return { error: 'SSH 端口必须在 1–65535 之间' };
  if (user && !/^[A-Za-z0-9._-]+$/.test(user)) return { error: 'SSH 用户名仅支持字母、数字、点、下划线和连字符' };
  const args = ['-tt', '-p', String(port), '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3'];
  const keyInput = String((body && body.identityFile) || '').trim();
  if (keyInput) {
    const keyFile = path.resolve(keyInput.startsWith('~/') ? path.join(os.homedir(), keyInput.slice(2)) : keyInput);
    try { if (!fs.statSync(keyFile).isFile()) throw new Error('not file'); }
    catch (_) { return { error: 'SSH 私钥文件不存在或不可读取' }; }
    args.push('-i', keyFile);
  }
  const target = (user ? user + '@' : '') + host;
  args.push(target);
  return { command: ssh, args, mode: 'ssh', label: 'SSH · ' + target + ':' + port, host, port, user };
}

function sshFileConfig(body) {
  const host = remoteHost(body && body.host);
  const port = remotePort(body && body.port, 22);
  const username = String((body && body.user) || '').trim();
  if (!host) throw new Error('SSH 主机地址不合法');
  if (!port) throw new Error('SSH 端口必须在 1–65535 之间');
  if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new Error('请填写有效的 SSH 用户名');
  const config = { host: host.replace(/^\[|\]$/g, ''), port, username, readyTimeout: 12000, keepaliveInterval: 8000, keepaliveCountMax: 2 };
  if (process.env.SSH_AUTH_SOCK) config.agent = process.env.SSH_AUTH_SOCK;
  const password = String((body && body.password) || '');
  if (password) {
    config.password = password.slice(0, 4096);
    // 部分 Linux SSH 服务关闭 password 方法，只通过 keyboard-interactive 询问密码。
    // 系统 ssh 会自动处理该流程；ssh2 需要显式开启并在连接事件中作答。
    config.tryKeyboard = true;
  }
  const keyInput = String((body && body.identityFile) || '').trim();
  if (keyInput) {
    const keyFile = path.resolve(keyInput.startsWith('~/') ? path.join(os.homedir(), keyInput.slice(2)) : keyInput);
    try { config.privateKey = fs.readFileSync(keyFile); }
    catch (_) { throw new Error('SSH 私钥文件不存在或不可读取'); }
  }
  if (!config.password && !config.privateKey) {
    const candidates = ['id_ed25519', 'id_rsa', 'id_ecdsa'].map((name) => path.join(os.homedir(), '.ssh', name));
    const found = candidates.find((file) => fs.existsSync(file));
    if (found) config.privateKey = fs.readFileSync(found);
  }
  return config;
}

function remoteFilePath(value, fallback = '.') {
  const raw = String(value == null ? fallback : value).trim() || fallback;
  if (raw.includes('\0') || raw.length > 4096) throw new Error('远程路径不合法');
  return path.posix.normalize(raw.replace(/\\/g, '/'));
}

function withSftp(body, work) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = new SshClient();
    const keyboardPassword = String((body && body.password) || '').slice(0, 4096);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch (_) {}
      error ? reject(error) : resolve(value);
    };
    client.once('ready', () => client.sftp((error, sftp) => {
      if (error) return finish(error);
      Promise.resolve().then(() => work(sftp)).then((value) => finish(null, value), finish);
    }));
    client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
      if (!keyboardPassword) return finish([]);
      finish((prompts || []).map(() => keyboardPassword));
    });
    client.once('error', (error) => finish(new Error('SSH 连接失败: ' + String(error.message || error))));
    try { client.connect(sshFileConfig(body)); } catch (error) { finish(error); }
  });
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => sftp[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}

async function remoteList(body) {
  const target = remoteFilePath(body && body.path);
  return withSftp(body, async (sftp) => {
    const rows = await sftpCall(sftp, 'readdir', target);
    const entries = rows.map((row) => {
      const attrs = row.attrs || {};
      const name = String(row.filename || '');
      const fullPath = path.posix.join(target === '.' ? '' : target, name) || '.';
      return { name, path: fullPath, directory: !!(attrs.isDirectory && attrs.isDirectory()), symlink: !!(attrs.isSymbolicLink && attrs.isSymbolicLink()), size: Number(attrs.size || 0), mtime: Number(attrs.mtime || 0) };
    }).filter((row) => row.name !== '.' && row.name !== '..')
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN'));
    return { ok: true, path: target, parent: target === '/' ? '/' : (path.posix.dirname(target) || '.'), entries };
  });
}

async function remoteRead(body) {
  const target = remoteFilePath(body && body.path, '');
  if (!target || target === '.') throw new Error('请选择远程文件');
  return withSftp(body, async (sftp) => {
    const attrs = await sftpCall(sftp, 'stat', target);
    if (attrs.isDirectory && attrs.isDirectory()) throw new Error('目标是文件夹');
    if (Number(attrs.size || 0) > 2 * 1024 * 1024) throw new Error('远程文件超过 2 MB，暂不在编辑器中打开');
    const data = await sftpCall(sftp, 'readFile', target);
    if (data.includes(0)) throw new Error('二进制文件不支持文本编辑');
    return { ok: true, path: target, content: data.toString('utf8'), size: data.length, mtime: Number(attrs.mtime || 0) };
  });
}

async function remoteWrite(body) {
  const target = remoteFilePath(body && body.path, '');
  const content = String((body && body.content) == null ? '' : body.content);
  if (!target || target === '.') throw new Error('请选择远程文件');
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('远程文件超过 2 MB，无法保存');
  return withSftp(body, async (sftp) => {
    await sftpCall(sftp, 'writeFile', target, Buffer.from(content, 'utf8'));
    return { ok: true, path: target, bytes: Buffer.byteLength(content), savedAt: Date.now() };
  });
}

function remoteTransferMeta(req) {
  const encoded = String(req.headers['x-codescope-remote'] || '');
  if (!encoded || encoded.length > 32768) throw new Error('缺少远程传输参数');
  try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
  catch (_) { throw new Error('远程传输参数不正确'); }
}

function safeRemoteRelative(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const normalized = path.posix.normalize(raw);
  if (!raw || raw.includes('\0') || raw.length > 4096 || raw.startsWith('/') || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('上传相对路径不合法');
  }
  return normalized;
}

function connectSshClient(body) {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;
    const password = String((body && body.password) || '').slice(0, 4096);
    client.once('ready', () => { if (!settled) { settled = true; resolve(client); } });
    client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
      finish(password ? (prompts || []).map(() => password) : []);
    });
    client.once('error', (error) => {
      if (!settled) { settled = true; reject(new Error('SSH 连接失败: ' + String(error.message || error))); }
    });
    try { client.connect(sshFileConfig(body)); }
    catch (error) { settled = true; reject(error); }
  });
}

function clientSftp(client) {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
}

async function sftpMkdirp(sftp, target) {
  const normalized = path.posix.normalize(target || '.');
  if (normalized === '.' || normalized === '/') return;
  const absolute = normalized.startsWith('/');
  let current = absolute ? '/' : '';
  for (const part of normalized.split('/').filter(Boolean)) {
    current = current === '/' ? '/' + part : (current ? current + '/' + part : part);
    try { await sftpCall(sftp, 'mkdir', current); }
    catch (_) {
      const attrs = await sftpCall(sftp, 'stat', current);
      if (!(attrs.isDirectory && attrs.isDirectory())) throw new Error('远端路径中存在同名文件: ' + current);
    }
  }
}

async function streamRemoteUpload(req, res) {
  let body;
  try { body = remoteTransferMeta(req); }
  catch (error) { req.resume(); send(res, 400, { ok:false, error:String(error.message || error) }); return; }
  let client;
  try {
    const dir = remoteFilePath(body.path);
    const relativePath = safeRemoteRelative(body.relativePath || body.name);
    const target = path.posix.join(dir === '.' ? '' : dir, relativePath) || relativePath;
    client = await connectSshClient(body);
    const sftp = await clientSftp(client);
    await sftpMkdirp(sftp, path.posix.dirname(target));
    let exists = false;
    try {
      const attrs = await sftpCall(sftp, 'stat', target);
      if (attrs.isDirectory && attrs.isDirectory()) throw new Error('远端已存在同名目录');
      exists = true;
    } catch (error) {
      if (/同名目录/.test(String(error.message || error))) throw error;
    }
    if (exists && !body.overwrite) {
      req.resume();
      send(res, 409, { ok:false, exists:true, path:target, error:'远端已存在同名文件' });
      return;
    }
    let bytes = 0;
    req.on('data', (chunk) => { bytes += chunk.length; });
    await pipeline(req, sftp.createWriteStream(target, { flags:'w' }));
    send(res, 200, { ok:true, path:target, name:path.posix.basename(target), bytes, overwritten:exists, savedAt:Date.now() });
  } catch (error) {
    req.resume();
    if (!res.headersSent) send(res, 200, { ok:false, error:String(error.message || error) });
    else res.destroy(error);
  } finally {
    if (client) { try { client.end(); } catch (_) {} }
  }
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}

function downloadHeaders(res, name, contentType, size) {
  const safeName = String(name || 'download').replace(/[\r\n]/g, '_');
  const headers = {
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    'X-CodeScope-Filename': encodeURIComponent(safeName),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (Number.isFinite(size) && size >= 0) headers['Content-Length'] = String(size);
  res.writeHead(200, headers);
}

async function streamRemoteDownload(res, body) {
  const target = remoteFilePath(body && body.path, '');
  if (!target) throw new Error('请选择远程文件或文件夹');
  let client;
  try {
    client = await connectSshClient(body);
    const sftp = await clientSftp(client);
    const attrs = await sftpCall(sftp, 'stat', target);
    if (!(attrs.isDirectory && attrs.isDirectory())) {
      const name = path.posix.basename(target) || 'download';
      downloadHeaders(res, name, 'application/octet-stream', Number(attrs.size || 0));
      await pipeline(sftp.createReadStream(target), res);
      return;
    }
    const normalized = target === '.' ? '.' : target.replace(/\/$/, '');
    const parent = normalized === '/' ? '/' : path.posix.dirname(normalized);
    const base = normalized === '/' || normalized === '.' ? '.' : path.posix.basename(normalized);
    const archiveName = (normalized === '/' ? 'root' : normalized === '.' ? 'remote-folder' : path.posix.basename(normalized)) + '.tar.gz';
    const command = `tar -czf - -C ${shellQuote(parent)} -- ${shellQuote(base)}`;
    const stream = await new Promise((resolve, reject) => client.exec(command, (error, channel) => error ? reject(error) : resolve(channel)));
    downloadHeaders(res, archiveName, 'application/gzip');
    await pipeline(stream, res);
  } finally {
    if (client) { try { client.end(); } catch (_) {} }
  }
}

/* --------------------------------- Git 面板 ---------------------------------- */

let GIT_ROOT = null;   // 缓存仓库根（vault 所在 git 仓库，通常在其上级目录）
function gitRoot() {
  if (GIT_ROOT) return GIT_ROOT;
  // 纯文件系统探测：向上查找 .git（目录或 worktree 指针文件），不执行任何 git 命令，
  // 避免同步命令在云盘大仓库上卡住拖死整个服务。
  let dir = vaultPath();
  for (let i = 0; i < 8; i++) {
    try { if (fs.existsSync(path.join(dir, '.git'))) return (GIT_ROOT = dir); } catch (_) {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function gitRun(args, timeout) {
  const root = gitRoot();
  if (!root) return Promise.resolve({ ok: false, error: '未找到 Git 仓库（vault 上级无 .git）' });
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, timeout: timeout || 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(stderr || err.message).trim().slice(0, 600) : '' });
    });
  });
}
// git 命令执行器：spawn 异步执行 + 硬超时。子进程即使卡死（例如云盘文件 IO 不可中断），
// 超时一到也立即 resolve 返回，绝不阻塞 Node 事件循环（同步 execFileSync 无法做到这一点）。
function runGit(args, opts = {}) {
  const { cwd, timeout = 15000 } = opts;
  return new Promise((resolve) => {
    let cp;
    try { cp = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ err: e, stdout: '', stderr: '' }); }
    let stdout = '', stderr = '', done = false;
    const finish = (err) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { cp.kill('SIGKILL'); } catch (_) {}
      resolve({ err, stdout, stderr });
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('git 命令超时（' + timeout + 'ms）'), { code: 'ETIMEDOUT', killed: true })), timeout);
    cp.stdout.on('data', (d) => { stdout += String(d); });
    cp.stderr.on('data', (d) => { stderr += String(d); });
    cp.on('error', (e) => finish(e));
    cp.on('close', (code, signal) => {
      if (done) return;
      finish(code === 0 ? null : Object.assign(new Error('git 退出码 ' + code + (signal ? '（信号 ' + signal + '）' : '')), { code }));
    });
  });
}
async function gitStatus() {
  const root = gitRoot();
  if (!root) return { ok: false, error: '未找到 Git 仓库（vault 上级无 .git）' };
  try {
    // -z + core.quotepath=false：路径按 UTF-8 原样输出、NUL 分隔，避免中文被转义
    const g = await runGit(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b', '-z'], { cwd: root, timeout: 15000 });
    if (g.err) throw g.err;
    const out = g.stdout;
    const recs = out.split('\0').filter(Boolean);
    const changes = [];
    let branch = '', ahead = 0, behind = 0, upstream = '', remote = '', hasRemote = false;
    for (const r of recs) {
      if (r.startsWith('## ')) {
        const m = /^##\s+([^\s]+)(?:\s+\[(.*)\])?/.exec(r);
        branch = m ? m[1].split('...')[0] : '';
        const br = (m && m[2]) || '';
        const am = /ahead (\d+)/.exec(br); if (am) ahead = +am[1];
        const bm = /behind (\d+)/.exec(br); if (bm) behind = +bm[1];
        continue;
      }
      if (r.length < 3) continue;
      const xy = r.slice(0, 2);
      const path = r.slice(3);
      let kind = 'modified';
      if (xy === '??') kind = 'untracked';
      else if (xy[0] === 'A') kind = 'added';
      else if (xy[1] === 'D' || xy[0] === 'D') kind = 'deleted';
      else if (xy[0] === 'R') kind = 'renamed';
      changes.push({ status: xy.trim() || '?', idx: xy[0], wt: xy[1], path, kind });
    }
    { const r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: 10000 }); if (!r.err) branch = r.stdout.trim() || branch; }
    { const r = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: root, timeout: 10000 }); if (!r.err) upstream = r.stdout.trim(); }
    { const r = await runGit(['remote'], { cwd: root, timeout: 10000 }); if (!r.err) { const remotes = r.stdout.trim().split(/\s+/).filter(Boolean); hasRemote = remotes.length > 0; remote = upstream.includes('/') ? upstream.split('/')[0] : (remotes[0] || ''); } }
    if (upstream) { const r = await runGit(['rev-list', '--left-right', '--count', 'HEAD...' + upstream], { cwd: root, timeout: 10000 }); if (!r.err) { const counts = r.stdout.trim().split(/\s+/); ahead = Number(counts[0]) || 0; behind = Number(counts[1]) || 0; } }
    let lastCommit = null;
    let commits = [];
    { const r = await runGit(['log', '-1', '--format=%h%x09%s'], { cwd: root, timeout: 10000 }); if (!r.err) { const lg = r.stdout.trim(); const sp = lg.indexOf('\t'); lastCommit = sp >= 0 ? { hash: lg.slice(0, sp), subject: lg.slice(sp + 1) } : { hash: lg }; } }
    {
      // 最近 10 条提交记录：短hash|主题|时间戳
      let unpushed = new Set();
      if (upstream) { const u = await runGit(['rev-list', '--left-only', 'HEAD...' + upstream], { cwd: root, timeout: 15000 }); if (!u.err) unpushed = new Set(u.stdout.trim().split('\n').filter(Boolean)); }
      const l = await runGit(['log', '--pretty=format:%H%x09%h%x09%s%x09%at', '-n', '10'], { cwd: root, timeout: 10000 });
      if (!l.err && l.stdout.trim()) { const lout = l.stdout.trim(); commits = lout.split('\n').map(line => { const p = line.split('\t'); return { hash:p[0]||'', short:p[1]||'', subject:p[2]||'', ts:+(p[3]||0), pushed:upstream?!unpushed.has(p[0]):null }; }); }
    }
    return { ok: true, root, branch, upstream, remote, hasRemote, ahead, behind, changes, lastCommit, commits };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function safeGitPath(input) {
  const root = gitRoot();
  if (!root) throw new Error('未找到 Git 仓库');
  const value = String(input || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!value || value.includes('\0') || path.isAbsolute(value)) throw new Error('文件路径不合法');
  const full = path.resolve(root, value);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('文件路径越界');
  return { root, full, relative: path.relative(root, full).split(path.sep).join('/') };
}

function fallbackTextDiff(before, after, beforeLabel, afterLabel) {
  const oldText = String(before || '');
  const newText = String(after || '');
  if (oldText === newText) return '';
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  return [
    '--- ' + (beforeLabel || '旧版本'),
    '+++ ' + (afterLabel || '当前版本'),
    '@@ -1,' + oldLines.length + ' +1,' + newLines.length + ' @@',
    ...oldLines.map((line) => '-' + line),
    ...newLines.map((line) => '+' + line),
  ].join('\n').slice(0, 2 * 1024 * 1024);
}

async function unifiedTextDiff(before, after, beforeLabel, afterLabel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-diff-'));
  const left = path.join(dir, 'before.txt'), right = path.join(dir, 'after.txt');
  try {
    writeFileAtomicSync(left, String(before || ''), 'utf8');
    writeFileAtomicSync(right, String(after || ''), 'utf8');
    const raw = await new Promise((resolve) => {
      let out = '';
      const cp = spawn('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--unified=3', '--', left, right], { stdio: ['ignore', 'pipe', 'pipe'] });
      const t = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (_) {} }, 15000);
      cp.stdout.on('data', (d) => { out += String(d); });
      cp.stderr.on('data', () => {});
      cp.on('error', (e) => { clearTimeout(t); resolve({ out, code: null, err: e }); });
      cp.on('close', (code) => { clearTimeout(t); resolve({ out, code, err: null }); });
    });
    // git diff 用退出码 1 表示“存在差异”，并非执行失败。
    const rendered = (raw.out || '')
      .split(left).join(beforeLabel || '旧版本')
      .split(right).join(afterLabel || '当前版本')
      .slice(0, 2 * 1024 * 1024);
    if ((raw.err && raw.code !== 1) || (!rendered && String(before || '') !== String(after || ''))) {
      return fallbackTextDiff(before, after, beforeLabel, afterLabel);
    }
    return rendered;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function gitFileDiff(input) {
  const item = safeGitPath(input);
  let tracked = false;
  {
    const code = await new Promise((resolve) => {
      const cp = spawn('git', ['ls-files', '--error-unmatch', '--', item.relative], { cwd: item.root, stdio: ['ignore', 'ignore', 'ignore'] });
      const t = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (_) {} }, 10000);
      cp.on('error', () => { clearTimeout(t); resolve(null); });
      cp.on('close', (c) => { clearTimeout(t); resolve(c); });
    });
    tracked = code === 0;
  }
  let diff = '', binary = false;
  if (tracked) {
    const r = await new Promise((resolve) => {
      let out = '';
      const cp = spawn('git', ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', item.relative], { cwd: item.root, stdio: ['ignore', 'pipe', 'pipe'] });
      const t = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (_) {} }, 20000);
      cp.stdout.on('data', (d) => { out += String(d); });
      cp.stderr.on('data', (d) => { out += String(d); });
      cp.on('error', (e) => { clearTimeout(t); resolve({ out, code: null, err: e }); });
      cp.on('close', (c) => { clearTimeout(t); resolve({ out, code: c, err: null }); });
    });
    if (r.err && r.code !== 1) throw new Error(String((r.err && r.err.message) || 'git diff 失败').slice(0, 600));
    diff = r.out || '';
    binary = /^(?:Binary files .* differ|GIT binary patch)$/m.test(diff);
  } else if (fs.existsSync(item.full) && fs.statSync(item.full).isFile()) {
    let data = Buffer.alloc(0);
    try { data = await fs.promises.readFile(item.full); } catch (_) { data = Buffer.alloc(0); }
    binary = data.includes(0);
    if (!binary && data.length <= 2 * 1024 * 1024) diff = await unifiedTextDiff('', data.toString('utf8'), '/dev/null', 'b/' + item.relative);
  }
  const lines = diff.split('\n');
  const additions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const deletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
  return { ok: true, path: item.relative, tracked, binary, additions, deletions, diff };
}

function shortHash(text) {
  let h = 2166136261;
  const value = String(text || '');
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function timelineRoot() {
  let base;
  if (process.env.CODESCOPE_DATA_HOME) base = path.resolve(process.env.CODESCOPE_DATA_HOME);
  else if (process.platform === 'darwin') base = path.join(os.homedir(), 'Library/Application Support');
  else if (process.platform === 'win32') base = process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming');
  else base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
  return path.join(base, 'CodeScope', 'timeline', shortHash(path.resolve(vaultPath())));
}

function timelineTarget(file, fragment) {
  const codeRoot = path.resolve(path.join(vaultPath(), 'code'));
  const full = path.resolve(String(file || ''));
  if (!full.startsWith(codeRoot + path.sep) || path.extname(full).toLowerCase() !== '.md') throw new Error('时间线文件不合法');
  const index = Number(fragment);
  if (!Number.isInteger(index) || index < 0 || index > 10000) throw new Error('片段索引不合法');
  const relative = path.relative(codeRoot, full).split(path.sep).join('/');
  const dir = path.join(timelineRoot(), shortHash(relative + '#' + index));
  return { full, relative, fragment: index, dir };
}

const TIMELINE_SESSION_GAP_MS = 2 * 60 * 1000;

function rawTimelineEntries(target) {
  let names = [];
  try { names = fs.readdirSync(target.dir).filter((name) => /^\d+-[a-z0-9]+\.json$/i.test(name)).sort().reverse(); } catch (_) { return []; }
  return names.slice(0, 120).flatMap((name) => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(target.dir, name), 'utf8'));
      return [{ id: name.slice(0, -5), timestamp: Number(value.timestamp || 0), size: Number(value.size || Buffer.byteLength(String(value.code || ''))), reason: String(value.reason || '自动保存'), preview: String(value.preview || '').slice(0, 120) }];
    } catch (_) { return []; }
  });
}

function timelineEntries(target) {
  const entries = rawTimelineEntries(target);
  // 连续自动保存属于同一次编辑会话：只展示会话开始前的那个可恢复版本。
  // 从旧到新合并，保留组内最旧快照，避免“只改一行却出现很多条时间线”。
  const compact = []; let previousEntry = null;
  for (const entry of entries.slice().reverse()) {
    const sameSession = previousEntry && previousEntry.reason === '自动保存' && entry.reason === '自动保存' && entry.timestamp - previousEntry.timestamp < TIMELINE_SESSION_GAP_MS;
    if (!sameSession) compact.push(entry);
    previousEntry = entry;
  }
  return compact.reverse().slice(0, 60);
}

function recordTimeline(file, fragment, code, reason, force) {
  try {
    const target = timelineTarget(file, fragment);
    const value = String(code == null ? '' : code);
    if (Buffer.byteLength(value, 'utf8') > 1024 * 1024) return;
    fs.mkdirSync(target.dir, { recursive: true });
    const entries = rawTimelineEntries(target);
    if (entries.length) {
      try {
        const latest = JSON.parse(fs.readFileSync(path.join(target.dir, entries[0].id + '.json'), 'utf8'));
        if (String(latest.code || '') === value) return;
      } catch (_) {}
    }
    const now = Date.now();
    // 两分钟内的连续自动保存视为同一次编辑会话；第一条已经保存了会话开始前的内容。
    // 后续保存不再产生中间快照，恢复时可以直接回到真正开始修改之前。
    if (!force && entries.length && entries[0].reason === '自动保存' && now - entries[0].timestamp < TIMELINE_SESSION_GAP_MS) return;
    const bucket = now;
    const id = bucket + '-' + shortHash(target.relative + '#' + target.fragment);
    const firstLine = value.split(/\r?\n/).find((line) => line.trim()) || '空内容';
    writeFileAtomicSync(path.join(target.dir, id + '.json'), JSON.stringify({
      timestamp: now, file: target.relative, fragment: target.fragment, reason: reason || '自动保存',
      size: Buffer.byteLength(value, 'utf8'), preview: firstLine.trim().slice(0, 120), code: value,
    }), 'utf8');
    const stale = fs.readdirSync(target.dir).filter((name) => /^\d+-[a-z0-9]+\.json$/i.test(name)).sort().reverse().slice(60);
    for (const name of stale) { try { fs.unlinkSync(path.join(target.dir, name)); } catch (_) {} }
  } catch (_) { /* 时间线失败不能阻断正常保存 */ }
}

async function timelineItem(file, fragment, id, currentCode) {
  const target = timelineTarget(file, fragment);
  if (!/^\d+-[a-z0-9]+$/i.test(String(id || ''))) throw new Error('时间线版本标识不合法');
  const value = JSON.parse(fs.readFileSync(path.join(target.dir, id + '.json'), 'utf8'));
  const code = String(value.code || '');
  return {
    ok: true, id, timestamp: Number(value.timestamp || 0), reason: String(value.reason || '自动保存'),
    size: Buffer.byteLength(code, 'utf8'), code,
    diff: await unifiedTextDiff(code, String(currentCode || ''), '历史版本', '当前版本'),
  };
}

/* -------------------------- 通用工程：任务 / 编译数据库 / 健康 -------------------------- */

function projectRoot() { return gitRoot() || path.resolve(vaultPath(), '..'); }
const LSP = createLspService();
process.once('exit', () => LSP.close());
function safeProjectDir(value) {
  const root = projectRoot();
  const full = path.resolve(root, String(value || '.'));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('工作目录超出当前工程');
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw new Error('工作目录不存在');
  return full;
}
function walkProject(limit = 6000) {
  const root = projectRoot(), out = [], ignored = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', 'out', 'coverage', '__pycache__', '.idea', '.vscode']);
  const visit = (dir, depth) => {
    if (out.length >= limit || depth > 12) return;
    let rows = []; try { rows = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const row of rows) {
      if (out.length >= limit || ignored.has(row.name)) continue;
      const full = path.join(dir, row.name);
      if (row.isDirectory()) visit(full, depth + 1);
      else if (row.isFile()) out.push({ full, relative: path.relative(root, full).split(path.sep).join('/'), ext: path.extname(row.name).toLowerCase(), name: row.name });
    }
  };
  visit(root, 0);
  return out;
}
function taskCatalog(projectFiles) {
  const root = projectRoot(), tasks = [];
  const add = (id, name, command, cwd = '.') => tasks.push({ id:id + '@' + cwd, name, command, cwd, detected:true });
  const markers = (projectFiles || walkProject(4000)).filter((f) => ['CMakeLists.txt','Makefile','makefile','build.ninja','package.json','pyproject.toml','requirements.txt'].includes(f.name)).slice(0,100);
  for (const file of markers) {
    const cwd = path.posix.dirname(file.relative) === '.' ? '.' : path.posix.dirname(file.relative), suffix = cwd === '.' ? '' : ` · ${cwd}`;
    if (file.name === 'CMakeLists.txt') { add('cmake-configure','CMake 配置'+suffix,'cmake -S . -B build',cwd); add('cmake-build','CMake 构建'+suffix,'cmake --build build',cwd); }
    else if (file.name === 'Makefile' || file.name === 'makefile') add('make','Make 构建'+suffix,'make',cwd);
    else if (file.name === 'build.ninja') add('ninja','Ninja 构建'+suffix,'ninja',cwd);
    else if (file.name === 'package.json') {
      try { const pkg=JSON.parse(fs.readFileSync(file.full,'utf8')); for(const name of Object.keys(pkg.scripts||{})) add('npm:'+name,'npm · '+name+suffix,'npm run '+name,cwd); } catch (_) {}
    } else if (file.name === 'pyproject.toml') add('python-build','Python 构建'+suffix,'python -m build',cwd);
    else if (file.name === 'requirements.txt') add('python-install','Python 安装依赖'+suffix,'python -m pip install -r requirements.txt',cwd);
  }
  return { ok: true, root, tasks };
}
function testCatalog() {
  const catalog = taskCatalog(), tests = catalog.tasks.filter((task) => /(?:^|\b)(test|pytest|ctest|jest|vitest|mocha)(?:\b|:)/i.test(task.name + ' ' + task.command));
  const root = projectRoot(), files = walkProject(4000), seen = new Set(tests.map((item) => item.command + '@' + item.cwd));
  const add = (id, name, command, cwd='.') => { const key=command+'@'+cwd;if(!seen.has(key)){seen.add(key);tests.push({id,name,command,cwd,detected:true});} };
  if (files.some((file) => /^(?:pytest\.ini|tox\.ini)$/.test(file.name) || file.name === 'conftest.py')) add('pytest','Python · pytest','python -m pytest');
  if (files.some((file) => file.name === 'CTestTestfile.cmake' || file.name === 'CTestConfig.cmake')) add('ctest','CMake · CTest','ctest --test-dir build --output-on-failure');
  if (files.some((file) => file.name === 'go.mod')) add('go-test','Go · 全部测试','go test ./...');
  if (files.some((file) => file.name === 'Cargo.toml')) add('cargo-test','Rust · cargo test','cargo test');
  return {ok:true,root,tests};
}
function debugCatalog() {
  const commands=[['node','Node.js','node inspect'],['python','Python','python -m pdb'],['lldb','LLDB','lldb'],['gdb','GDB','gdb']].map(([id,name,command])=>({id,name,command,available:!!executablePath(command.split(' ')[0])}));
  return {ok:true,root:projectRoot(),adapters:commands};
}
function runProjectCommand(command, cwd) {
  const value = String(command || '').trim();
  if (!value || value.length > 4000 || /[\0\r\n]/.test(value)) return Promise.resolve({ ok: false, error: '命令不合法' });
  let dir; try { dir = safeProjectDir(cwd); } catch (error) { return Promise.resolve({ ok:false, error:String(error.message || error) }); }
  const shell = process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
  const started = Date.now();
  return new Promise((resolve) => exec(value, { cwd: dir, shell, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({
    ok: !error, command: value, cwd: path.relative(projectRoot(), dir) || '.', durationMs: Date.now() - started,
    exitCode: error && Number.isInteger(error.code) ? error.code : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: error ? String(error.killed ? '任务超时（120 秒）' : error.message || error).slice(0, 500) : '',
  })));
}
function findCompileDatabase(projectFiles) {
  const root = projectRoot();
  const direct = [path.join(root, 'compile_commands.json'), path.join(root, 'build', 'compile_commands.json')].find((file) => fs.existsSync(file));
  if (direct) return direct;
  return ((projectFiles || walkProject(3000)).find((item) => item.name === 'compile_commands.json') || {}).full || '';
}
function shellWords(command) {
  return String(command || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((v) => v.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2')) || [];
}
function compileDatabaseInfo(projectFiles) {
  const file = findCompileDatabase(projectFiles);
  if (!file) return { ok: true, found: false, entries: 0, path: '', includePaths: [], defines: [], languages: {} };
  const st = fs.statSync(file); if (st.size > 20 * 1024 * 1024) throw new Error('compile_commands.json 超过 20 MB');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('compile_commands.json 格式不正确');
  const includes = new Set(), defines = new Set(), languages = {};
  for (const row of rows.slice(0, 20000)) {
    const args = Array.isArray(row.arguments) ? row.arguments.map(String) : shellWords(row.command);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-I' || arg === '-isystem') { if (args[i + 1]) includes.add(path.resolve(row.directory || projectRoot(), args[++i])); }
      else if (arg.startsWith('-I') && arg.length > 2) includes.add(path.resolve(row.directory || projectRoot(), arg.slice(2)));
      else if (arg === '-D') { if (args[i + 1]) defines.add(args[++i]); }
      else if (arg.startsWith('-D') && arg.length > 2) defines.add(arg.slice(2));
    }
    const ext = path.extname(String(row.file || '')).toLowerCase() || 'unknown'; languages[ext] = (languages[ext] || 0) + 1;
  }
  return { ok: true, found: true, entries: rows.length, path: path.relative(projectRoot(), file).split(path.sep).join('/'), includePaths: [...includes].slice(0, 300), defines: [...defines].slice(0, 1000), languages };
}
const LANGUAGE_BY_EXT = { '.js':'JavaScript','.mjs':'JavaScript','.cjs':'JavaScript','.ts':'TypeScript','.tsx':'TypeScript','.jsx':'JavaScript','.py':'Python','.c':'C','.h':'C/C++','.cc':'C++','.cpp':'C++','.cxx':'C++','.hpp':'C++','.java':'Java','.go':'Go','.rs':'Rust','.rb':'Ruby','.php':'PHP','.swift':'Swift','.kt':'Kotlin','.sh':'Shell','.md':'Markdown','.tex':'LaTeX','.html':'HTML','.css':'CSS','.json':'JSON','.yaml':'YAML','.yml':'YAML' };
async function projectHealth() {
  const scannedFiles = walkProject();
  const generatedPath = /(?:^|\/)(?:vendor|assets\/pdfjs|mscdex-ssh2-[^/]+)(?:\/|$)|^markdown-vault\/(?:readings|libraries|drawings|office|\.timeline)(?:\/|$)/;
  const files = scannedFiles.filter((file) => !generatedPath.test(file.relative));
  const languages = {}, issues = [], includeGraph = new Map();
  let lines = 0, bytes = 0, todos = 0;
  const byBase = new Map(files.map((f) => [f.name, f.relative]));
  for (const file of files) {
    let st; try { st = fs.statSync(file.full); } catch (_) { continue; }
    const lang = LANGUAGE_BY_EXT[file.ext] || 'Other'; languages[lang] = (languages[lang] || 0) + 1;
    if (st.size > 1024 * 1024 || (!LANGUAGE_BY_EXT[file.ext] && !['.txt','.cmake'].includes(file.ext))) continue;
    bytes += st.size;
    let text = ''; try { text = fs.readFileSync(file.full, 'utf8'); } catch (_) { continue; }
    lines += text.split(/\r?\n/).length;
    todos += (text.match(/\b(?:TODO|FIXME|XXX)\b/g) || []).length;
    const unfinished = text.split(/\r?\n/).some((line) => /^\s*(?:throw\s+new\s+Error\s*\(\s*['"]not implemented|raise\s+NotImplementedError\b|TODO\s*\(\s*\)\s*[;{])/i.test(line));
    if (unfinished) issues.push({ level:'warn', file:file.relative, message:'发现可能未实现的代码' });
    if (['.c','.h','.cc','.cpp','.cxx','.hpp'].includes(file.ext)) {
      const deps = [...text.matchAll(/^\s*#\s*include\s*["<]([^">]+)[">]/gm)].map((m) => byBase.get(path.basename(m[1]))).filter(Boolean);
      includeGraph.set(file.relative, [...new Set(deps)]);
    }
  }
  const cycles = [], visiting = new Set(), visited = new Set();
  const dfs = (node, stack) => {
    if (visiting.has(node)) { const at = stack.indexOf(node); cycles.push(stack.slice(at).concat(node)); return; }
    if (visited.has(node) || cycles.length >= 20) return;
    visiting.add(node); stack.push(node); for (const dep of includeGraph.get(node) || []) dfs(dep, stack); stack.pop(); visiting.delete(node); visited.add(node);
  };
  for (const node of includeGraph.keys()) dfs(node, []);
  let compileDb; try { compileDb = compileDatabaseInfo(scannedFiles); } catch (error) { compileDb = { ok:false, found:true, error:String(error.message || error) }; }
  const tasks = taskCatalog(scannedFiles);
  if (!tasks.tasks.length) issues.push({ level:'info', message:'未检测到常见构建入口，可使用自定义命令' });
  if (cycles.length) issues.push({ level:'warn', message:`检测到 ${cycles.length} 条 C/C++ 头文件循环依赖` });
  return { ok:true, root:projectRoot(), generatedAt:Date.now(), summary:{ files:files.length, ignoredFiles:scannedFiles.length-files.length, lines, bytes, todos, cycles:cycles.length }, languages, issues:issues.slice(0,100), cycles, compileDb, tasks:tasks.tasks.length };
}

/* --------------------------------- HTTP 服务 ---------------------------------- */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.xmind': 'application/vnd.xmind.workbook', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt': 'application/vnd.ms-powerpoint', '.otf': 'font/otf', '.ttf': 'font/ttf', '.ttc': 'font/collection', '.woff': 'font/woff', '.woff2': 'font/woff2', '.bib': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8' };

let INDEX_CACHE = null;
function indexAsset() {
  const file = path.join(__dirname, 'index.html');
  const stat = fs.statSync(file);
  if (!INDEX_CACHE || INDEX_CACHE.mtimeMs !== stat.mtimeMs || INDEX_CACHE.size !== stat.size) {
    const raw = fs.readFileSync(file);
    INDEX_CACHE = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      raw,
      gzip: zlib.gzipSync(raw, { level: zlib.constants.Z_BEST_SPEED }),
      etag: `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`,
    };
  }
  return INDEX_CACHE;
}
function sendIndex(req, res) {
  const asset = indexAsset();
  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304, { ETag: asset.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' });
    return res.end();
  }
  const gzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(req.headers['accept-encoding'] || ''));
  const body = gzip ? asset.gzip : asset.raw;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    ETag: asset.etag,
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  res.end(body);
}
/* 静态资源 gzip 缓存：/assets 下的 JS/CSS 未压缩合计约 4.8MB（reading-block-editor.js 2.7MB、
   xterm.js 277KB、highlight 119KB…），原先这些一律原样发送。按 文件+大小+mtime 缓存压缩结果，
   用 Z_BEST_SPEED（本地回环场景下省下的传输时间远大于多花的一点 CPU）。 */
const STATIC_GZIP_CACHE = new Map();
const STATIC_GZIP_CACHE_MAX = 40;
const STATIC_GZIP_MIN_BYTES = 1024;
const STATIC_GZIP_TYPES = /^(?:text\/|application\/(?:javascript|json|xml|manifest\+json)|image\/svg\+xml)/;
function gzipStaticFile(file, stat, callback) {
  const key = file + ':' + stat.size + ':' + Math.floor(stat.mtimeMs);
  const hit = STATIC_GZIP_CACHE.get(key);
  if (hit) {
    STATIC_GZIP_CACHE.delete(key); STATIC_GZIP_CACHE.set(key, hit);
    return callback(hit);
  }
  fs.readFile(file, (error, raw) => {
    if (error) return callback(null);
    zlib.gzip(raw, { level: zlib.constants.Z_BEST_SPEED }, (gzipError, gz) => {
      // 压不动（已经很小的资源、已压缩过的二进制）就照常流式发送，避免白费 CPU 反而变大。
      if (gzipError || !gz || gz.length >= raw.length) return callback(null);
      STATIC_GZIP_CACHE.set(key, gz);
      while (STATIC_GZIP_CACHE.size > STATIC_GZIP_CACHE_MAX) STATIC_GZIP_CACHE.delete(STATIC_GZIP_CACHE.keys().next().value);
      callback(gz);
    });
  });
}
function streamStatic(req, res, root, relative, options = {}) {
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, { ok:false, error:'forbidden' });
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return send(res, 404, { ok:false, error:options.notFound || 'not found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const cacheControl = options.cacheControl || 'no-cache';
    const canGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(req.headers['accept-encoding'] || ''))
      && stat.size >= STATIC_GZIP_MIN_BYTES && STATIC_GZIP_TYPES.test(type);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag:etag, 'Cache-Control':cacheControl, ...(canGzip ? { Vary:'Accept-Encoding' } : {}) });
      return res.end();
    }
    const finish = (compressed) => {
      if (compressed) {
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': compressed.length,
          'Content-Encoding': 'gzip',
          'Cache-Control': cacheControl,
          ETag: etag,
          Vary: 'Accept-Encoding',
          'X-Content-Type-Options': 'nosniff',
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(compressed);
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': cacheControl,
        ETag: etag,
        ...(canGzip ? { Vary: 'Accept-Encoding' } : {}),
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      const input = fs.createReadStream(file);
      input.on('error', () => { if (!res.headersSent) send(res, 500, { ok:false, error:'读取静态资源失败' }); else res.destroy(); });
      input.pipe(res);
    };
    if (canGzip) gzipStaticFile(file, stat, finish); else finish(null);
  });
}
function pipeReadingFile(res, input) {
  // 必须挂 error 监听：否则 iCloud 未落地/权限变化时未捕获的 'error' 事件会直接终止整个进程。
  input.on('error', () => {
    if (!res.headersSent) send(res, 500, { ok:false, error:'读取资料文件失败' });
    else if (!res.destroyed) res.destroy();
  });
  return input.pipe(res);
}
function trustedHttpOrigin(req) {
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true; // 保留本机 CLI、测试脚本和桌面壳调用。
  try { return new URL(origin).host === String(req.headers.host || ''); }
  catch (_) { return false; }
}

/* ------------------------------- 统一资料阅读库 ------------------------------- */

function readingsDir() { return path.join(vaultPath(), 'readings'); }

/* ------------------------------- 学习工作台 ------------------------------- */

function studyDir() { return path.join(vaultPath(), '.codescope', 'study'); }
function studyConfigFile() { return path.join(studyDir(), 'workspace.json'); }
function studySafeName(value, fallback) {
  const name = String(value || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 96);
  return name || fallback || '';
}
function defaultStudyConfig() {
  return {
    version:3,
    title:'学习工作台',
    preset:'study',
    bookmarks:[
      { id:'bilibili', label:'B站', url:'https://www.bilibili.com', color:'#fb7299', category:'featured' },
      { id:'github', label:'GitHub', url:'https://github.com', color:'#8b949e', category:'featured' },
      { id:'arxiv', label:'arXiv', url:'https://arxiv.org', color:'#b31b1b', category:'featured' },
      { id:'mdn', label:'MDN', url:'https://developer.mozilla.org', color:'#62a0ea', category:'featured' },
    ],
    categories:[],
    hiddenSites:[],
    layout:null,
    updatedAt:0,
  };
}
function cleanStudyConfig(value) {
  const fallback = defaultStudyConfig(), parsed = value && typeof value === 'object' ? value : {};
  const bookmarks = Array.isArray(parsed.bookmarks) ? parsed.bookmarks.slice(0, 512).map((item, index) => {
    const id = studySafeName(item && item.id, 'site-' + index);
    return {
      id,
      label:String(item && item.label || '网址').trim().slice(0, 24) || '网址',
      url:String(item && item.url || '').trim().slice(0, 2048),
      color:/^#[0-9a-f]{6}$/i.test(String(item && item.color || '')) ? item.color : '#4f8cff',
      category:studySafeName(item && item.category, '') || (['bilibili','github','arxiv','mdn'].includes(id) ? 'featured' : 'custom'),
      openMode:item && item.openMode === 'external' ? 'external' : 'internal',
    };
  }).filter((item) => /^https?:\/\//i.test(item.url)) : fallback.bookmarks;
  const categoryIds = new Set();
  const categories = Array.isArray(parsed.categories) ? parsed.categories.slice(0, 64).map((item, index) => ({
    id:studySafeName(item && item.id, 'category-' + index),
    label:String(item && item.label || '自定义分类').trim().slice(0, 24) || '自定义分类',
    icon:String(item && item.icon || '◆').trim().slice(0, 8) || '◆',
    color:/^#[0-9a-f]{6}$/i.test(String(item && item.color || '')) ? item.color : '#70d6a3',
  })).filter((item) => !categoryIds.has(item.id) && categoryIds.add(item.id)) : [];
  const hiddenSites = Array.isArray(parsed.hiddenSites) ? [...new Set(parsed.hiddenSites.map((item) => String(item || '').trim().slice(0, 2048)).filter((item) => /^https?:\/\//i.test(item)))].slice(0, 512) : [];
  let layout = parsed.layout && typeof parsed.layout === 'object' ? parsed.layout : null;
  if (layout && Buffer.byteLength(JSON.stringify(layout)) > 1024 * 1024) layout = null;
  return {
    version:3,
    title:String(parsed.title || fallback.title).trim().slice(0, 80) || fallback.title,
    preset:String(parsed.preset || fallback.preset).slice(0, 24),
    bookmarks,
    categories,
    hiddenSites,
    layout,
    updatedAt:Number(parsed.updatedAt) || Date.now(),
  };
}
function readStudyConfig() {
  try { return cleanStudyConfig(JSON.parse(fs.readFileSync(studyConfigFile(), 'utf8'))); }
  catch (_) { return defaultStudyConfig(); }
}
function saveStudyConfig(input) {
  const next = cleanStudyConfig({ ...readStudyConfig(), ...(input && typeof input === 'object' ? input : {}), updatedAt:Date.now() });
  fs.mkdirSync(studyDir(), { recursive:true });
  writeFileAtomicSync(studyConfigFile(), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}
function studyNoteFile(id) {
  const safe = studySafeName(id);
  return safe ? path.join(studyDir(), 'notes', safe + '.md') : '';
}
function studyAssetFile(name) {
  const safe = studySafeName(name);
  return safe && /\.(?:png|jpe?g|webp)$/i.test(safe) ? path.join(studyDir(), 'assets', safe) : '';
}
function isStudyImage(body, type) {
  if (!Buffer.isBuffer(body)) return false;
  if (type === 'image/png') return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (type === 'image/jpeg') return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (type === 'image/webp') return body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

const READING_TEXT_EXTS = new Set(['.md','.markdown','.txt','.c','.h','.cpp','.hpp','.cc','.py','.js','.ts','.json','.yaml','.yml','.tex','.html','.htm']);
const READING_DOCUMENT_EXTS = new Set(['.docx','.xlsx','.xls','.csv','.pptx']);
const READING_WEB_EXTS = new Set(['.url']);
const READING_ASSET_EXTS = new Set(['.pdf', ...READING_TEXT_EXTS, ...READING_DOCUMENT_EXTS, ...READING_WEB_EXTS]);
const READING_PROJECT_META = '.codescope-project.json';
const READING_FOLDER_META = '.codescope-folder.json';
function readingPath(value, allowFolder) {
  if (typeof value !== 'string') return null;
  const rel = value.replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean).join('/');
  if (!rel || /(^|\/)\.{1,2}(\/|$)|^\/|\/\//.test(rel) || /^[A-Za-z]:/.test(rel)) return null;
  if (!/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&/]+$/.test(rel)) return null;
  if (!allowFolder && !/\.pdf$/i.test(rel)) return null;
  return rel;
}
function readingAssetPath(value) {
  const rel = readingPath(value, true);
  if (!rel) return null;
  const ext = path.extname(rel).toLowerCase();
  return READING_ASSET_EXTS.has(ext) ? rel : null;
}
function readingFragmentInfo(rel, stat, project) {
  const ext = path.extname(rel).toLowerCase(), base = path.basename(rel);
  const kind = ext === '.pdf' ? 'pdf'
    : (['.md','.markdown'].includes(ext) ? 'markdown'
      : (ext === '.docx' ? 'docx'
        : (['.xlsx','.xls','.csv'].includes(ext) ? 'sheet'
          : (ext === '.pptx' ? 'slides' : (['.html','.htm'].includes(ext) ? 'html' : (ext === '.url' ? 'web' : 'code'))))));
  let role = kind;
  if (kind === 'pdf') {
    if (/双语|bilingual|parallel/i.test(base)) role = 'bilingual';
    else if (/中文|汉化|chinese|[_-](?:zh|cn)(?:[_.-]|$)/i.test(base)) role = 'translation';
    else role = 'original';
  }
  return { type:'fragment', kind, role, name:base, path:rel, project:project||'', size:stat.size, updated:stat.mtimeMs };
}
function readingWebShortcut(rel) {
  const file = path.join(readingsDir(), rel);
  const content = fs.readFileSync(file, 'utf8').slice(0, 16384);
  const match = /(?:^|\n)URL\s*=\s*(https?:\/\/[^\r\n]+)/i.exec(content);
  if (!match) throw new Error('网页地址文件无效');
  return match[1].trim();
}
function privateNetworkAddress(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (net.isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] >= 224;
  }
  if (net.isIP(value) === 6) {
    if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    return mapped ? privateNetworkAddress(mapped[1]) : false;
  }
  return true;
}
function parsedReadingWebUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw requestError('网页地址必须是完整的 http:// 或 https:// URL', 400); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw requestError('网页地址仅支持不含账号密码的 http/https URL', 400);
  return url;
}
async function validatedReadingWebUrl(value) {
  const url = parsedReadingWebUrl(value);
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw requestError('出于安全原因，网页阅读不能访问本机地址', 403);
  let addresses;
  try { addresses = await dns.lookup(hostname, { all:true }); } catch (_) { throw requestError('无法解析网页地址', 400); }
  if (!addresses.length || addresses.some((item) => privateNetworkAddress(item.address))) throw requestError('出于安全原因，网页阅读不能访问局域网或保留地址', 403);
  return url;
}
/* 有界 HTML 扫描。
   原实现 /<(nav|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi 在“大量未闭合开标签”输入下退化为 O(n²)：
   实测 30KB→20ms、100KB→241ms、300KB→2137ms、600KB→8569ms，而本模块允许 8MB 输入
   （见 fetchReadableWebPage 的 8MB 上限），外推可冻结事件循环数分钟；且入口是无 CSRF 校验的 GET，
   外部网页用 <img src="http://127.0.0.1:4877/api/readings/web/page?url=..."> 即可触发。
   下面全部改为线性扫描（正则只匹配单个开标签，闭合位置用 indexOf 定位，并限制扫描量）。 */
const READING_WEB_SCAN_LIMIT = 512 * 1024;
const READING_WEB_MAX_CANDIDATES = 200;
function readableWebNavigation(html) {
  const full = String(html || '');
  const source = full.length > READING_WEB_SCAN_LIMIT ? full.slice(0, READING_WEB_SCAN_LIMIT) : full;
  const lower = source.toLowerCase();
  const chapterOpen = /<ol\b[^>]*class=["'][^"']*\bchapter\b[^"']*["'][^>]*>/i.exec(source);
  if (chapterOpen) {
    const closeIndex = lower.indexOf('</ol', chapterOpen.index + chapterOpen[0].length);
    const chunk = closeIndex === -1 ? '' : source.slice(chapterOpen.index, closeIndex + 5);
    if ((chunk.match(/<a\b/gi) || []).length >= 2) return chunk.slice(0, 2 * 1024 * 1024);
  }
  const candidates = [], openRe = /<(nav|aside)\b[^>]*>/gi;
  let open, scanned = 0;
  while ((open = openRe.exec(source)) && scanned < READING_WEB_MAX_CANDIDATES) {
    scanned += 1;
    const tag = open[1].toLowerCase();
    const closeIndex = lower.indexOf('</' + tag, openRe.lastIndex);
    if (closeIndex === -1) continue;
    const chunk = source.slice(open.index, closeIndex + tag.length + 3);
    const links = (chunk.match(/<a\b/gi) || []).length;
    if (links >= 2) candidates.push({ html:chunk, score:links * 1000 + Math.min(chunk.length, 100000) });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? candidates[0].html.slice(0, 2 * 1024 * 1024) : '';
}
function stripHtmlCommentsBounded(source, maxBlocks = 2000) {
  let out = '', cursor = 0, guard = 0, index;
  while ((index = source.indexOf('<!--', cursor)) !== -1 && guard < maxBlocks) {
    guard += 1;
    const end = source.indexOf('-->', index + 4);
    out += source.slice(cursor, index);
    if (end === -1) return out + source.slice(index);
    cursor = end + 3;
  }
  return out + source.slice(cursor);
}
function stripTagBlocksBounded(source, tags, maxBlocks = 2000) {
  const lower = source.toLowerCase(), openRe = new RegExp('<(?:' + tags + ')\\b[^>]*>', 'gi');
  let out = '', cursor = 0, guard = 0, open;
  while ((open = openRe.exec(source)) && guard < maxBlocks) {
    if (open.index < cursor) continue;
    guard += 1;
    const tag = (open[0].match(/^<([a-z0-9]+)/i) || [])[1];
    if (!tag) continue;
    const closeIndex = lower.indexOf('</' + tag.toLowerCase(), openRe.lastIndex);
    if (closeIndex === -1) continue;
    out += source.slice(cursor, open.index);
    cursor = closeIndex + tag.length + 3;
    openRe.lastIndex = cursor;
  }
  return cursor === 0 ? source : out + source.slice(cursor);
}
function boundedTagInner(source, tag) {
  const open = new RegExp('<' + tag + '\\b[^>]*>', 'i').exec(source);
  if (!open) return '';
  const closeIndex = source.toLowerCase().indexOf('</' + tag, open.index + open[0].length);
  if (closeIndex === -1) return source.slice(open.index + open[0].length);
  return source.slice(open.index + open[0].length, closeIndex);
}
function readableWebNavigationLinkCount(html) { return (String(html || '').match(/<a\b/gi) || []).length; }
const READING_WEB_NAV_CACHE = new Map(), READING_WEB_NAV_CACHE_LIMIT = 32;
function rememberReadingWebNav(key, value) {
  // 每条最多 2MB HTML：原来只写不淘汰，长期使用 RSS 会持续上涨。
  READING_WEB_NAV_CACHE.set(key, value);
  while (READING_WEB_NAV_CACHE.size > READING_WEB_NAV_CACHE_LIMIT) {
    const oldest = READING_WEB_NAV_CACHE.keys().next().value;
    if (oldest === undefined) break;
    READING_WEB_NAV_CACHE.delete(oldest);
  }
}
async function readableWebCompanionNavigation(html, pageUrl) {
  const source = String(html || '');
  const match = /<iframe\b[^>]*\bsrc=["']([^"']*(?:toc|sidebar)[^"']*\.html(?:[?#][^"']*)?)["'][^>]*>/i.exec(source);
  if (!match) return '';
  let target;
  try { target = await validatedReadingWebUrl(new URL(match[1].replace(/&amp;/g, '&'), pageUrl).toString()); }
  catch (_) { return ''; }
  if (target.origin !== pageUrl.origin) return '';
  const cacheKey = target.toString(), cached = READING_WEB_NAV_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.html;
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(target, { redirect:'manual', signal:controller.signal, headers:{ 'User-Agent':'CodeScope/2.4 Reading Navigation', Accept:'text/html,application/xhtml+xml' } });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        if (redirect === 2) return '';
        const next = await validatedReadingWebUrl(new URL(response.headers.get('location'), target).toString());
        if (next.origin !== pageUrl.origin) return '';
        target = next;
        continue;
      }
      if (!response.ok) return '';
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 2 * 1024 * 1024) return '';
      const navigation = readableWebNavigation(data.toString('utf8'));
      if (navigation) rememberReadingWebNav(cacheKey, { at:Date.now(), html:navigation });
      return navigation;
    } catch (_) { return ''; }
    finally { clearTimeout(timer); }
  }
  return '';
}
const READING_WEB_SECTION_LIMIT = 4 * 1024 * 1024;
const READING_WEB_STRIP_TAGS = 'script|style|noscript|svg|canvas|form|nav|footer|aside';
function readableWebSection(html) {
  const full = String(html || '');
  const raw = full.length > READING_WEB_SECTION_LIMIT ? full.slice(0, READING_WEB_SECTION_LIMIT) : full;
  const navigationHtml = readableWebNavigation(raw);
  const source = stripTagBlocksBounded(stripTagBlocksBounded(stripHtmlCommentsBounded(raw), READING_WEB_STRIP_TAGS), READING_WEB_STRIP_TAGS)
    .replace(/<(script|style|noscript|svg|canvas|form|nav|footer|aside)\b[^>]*\/?>/gi, '');
  const title = boundedTagInner(source, 'title').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const article = boundedTagInner(source, 'article');
  const main = boundedTagInner(source, 'main');
  const body = boundedTagInner(source, 'body');
  return { title, html:String(article || main || body || source).slice(0, 6 * 1024 * 1024), navigationHtml };
}
async function fetchReadableWebPage(input) {
  let url = await validatedReadingWebUrl(input);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try { response = await fetch(url, { redirect:'manual', signal:controller.signal, headers:{ 'User-Agent':'CodeScope/2.4 Reading Mode', Accept:'text/html,application/xhtml+xml,text/plain;q=0.8' } }); }
    catch (error) { clearTimeout(timer); throw requestError(error && error.name === 'AbortError' ? '网页加载超时' : '网页加载失败：' + String(error.message || error), 502); }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      clearTimeout(timer);
      if (redirect === 5) throw requestError('网页重定向次数过多', 502);
      url = await validatedReadingWebUrl(new URL(response.headers.get('location'), url).toString());
      continue;
    }
    if (!response.ok) { clearTimeout(timer); throw requestError('网页返回 HTTP ' + response.status, 502); }
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type && !type.includes('text/html') && !type.includes('application/xhtml') && !type.includes('text/plain')) { clearTimeout(timer); throw requestError('该地址不是可阅读网页', 415); }
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    const chunks = []; let bytes = 0;
    try {
      if (reader) {
        for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 8 * 1024 * 1024) throw requestError('网页内容超过 8 MB', 413); chunks.push(Buffer.from(part.value)); }
      } else { const data = Buffer.from(await response.arrayBuffer()); bytes = data.length; if (bytes > 8 * 1024 * 1024) throw requestError('网页内容超过 8 MB', 413); chunks.push(data); }
    } finally { clearTimeout(timer); }
    const raw = Buffer.concat(chunks).toString('utf8'), readable = readableWebSection(raw), companionNavigation = await readableWebCompanionNavigation(raw, url);
    let navigationUrl = url.toString();
    if (readableWebNavigationLinkCount(companionNavigation) > readableWebNavigationLinkCount(readable.navigationHtml)) {
      readable.navigationHtml = companionNavigation;
      const navigationSource = /<iframe\b[^>]*\bsrc=["']([^"']*(?:toc|sidebar)[^"']*\.html(?:[?#][^"']*)?)["'][^>]*>/i.exec(raw);
      if (navigationSource) try { navigationUrl = new URL(navigationSource[1].replace(/&amp;/g, '&'), url).toString(); } catch (_) {}
    }
    return { ...readable, url:url.toString(), navigationUrl };
  }
  throw requestError('网页加载失败', 502);
}
function readingProjectMetaFile(rel){return path.join(readingsDir(),rel,READING_PROJECT_META);}
function loadReadingProjectMeta(rel){try{const value=JSON.parse(fs.readFileSync(readingProjectMetaFile(rel),'utf8'));return{description:String(value.description||'').slice(0,1000),tags:Array.isArray(value.tags)?value.tags.map(String).filter(Boolean).slice(0,30):[]};}catch(_){return{description:'',tags:[]};}}
function saveReadingProjectMeta(rel,value){const clean={version:1,description:String(value&&value.description||'').trim().slice(0,1000),tags:[...new Set((Array.isArray(value&&value.tags)?value.tags:String(value&&value.tags||'').split(/[,，]/)).map((tag)=>String(tag).trim()).filter(Boolean))].slice(0,30),updatedAt:Date.now()};fs.mkdirSync(path.join(readingsDir(),rel),{recursive:true});writeFileAtomicSync(readingProjectMetaFile(rel),JSON.stringify(clean,null,2),'utf8');return clean;}
function readingMetaFile(rel) {
  const id = crypto.createHash('sha256').update(rel).digest('hex');
  return path.join(readingsDir(), '.codescope', id + '.json');
}
function readingHasMeta(rel) { return /\.(?:pdf|url)$/i.test(String(rel || '')); }
function defaultReadingMeta(rel) {
  return { version:1, path:rel, page:1, view:'original', translations:{}, fragments:[], updatedAt:0 };
}
function loadReadingMeta(rel) {
  try {
    const parsed = JSON.parse(fs.readFileSync(readingMetaFile(rel), 'utf8'));
    return { ...defaultReadingMeta(rel), ...parsed, path:rel,
      translations:parsed && typeof parsed.translations === 'object' ? parsed.translations : {},
      fragments:Array.isArray(parsed && parsed.fragments) ? parsed.fragments : [] };
  } catch (_) { return defaultReadingMeta(rel); }
}
function saveReadingMeta(rel, value) {
  const clean = defaultReadingMeta(rel);
  clean.page = Math.max(1, Number(value && value.page) || 1);
  clean.view = ['original', 'source', 'translation', 'bilingual'].includes(value && value.view) ? value.view : 'original';
  clean.translations = value && typeof value.translations === 'object' ? value.translations : {};
  clean.fragments = Array.isArray(value && value.fragments) ? value.fragments.slice(0, 2000).map((item) => ({
    id:String(item.id || crypto.randomUUID()), page:Math.max(1, Number(item.page) || 1),
    source:String(item.source || '').slice(0, 30000), translation:String(item.translation || '').slice(0, 30000),
    note:String(item.note || '').slice(0, 10000), createdAt:Number(item.createdAt) || Date.now(),
    rects:Array.isArray(item && item.rects) ? item.rects.slice(0, 200).map((r) => ({ x:Number(r && r.x) || 0, y:Number(r && r.y) || 0, width:Number(r && r.width) || 0, height:Number(r && r.height) || 0 })) : [],
    scale:Number(item && item.scale) || 1,
    url:String(item && item.url || '').slice(0, 4096),
    webTitle:String(item && item.webTitle || '').slice(0, 500),
    anchor:String(item && item.anchor || '').slice(0, 1000),
    webStart:Math.max(0, Number(item && item.webStart) || 0),
    webEnd:Math.max(0, Number(item && item.webEnd) || 0),
    /* Markdown 摘录：没有页码和矩形，只记来源标题（anchorText 给人看，anchor 用来定位）。
       这里必须显式列进来 —— 白名单之外的字段会在落盘时被整条丢掉。 */
    kind:item && item.kind === 'markdown' ? 'markdown' : '',
    anchorText:String(item && item.anchorText || '').slice(0, 500),
  })) : [];
  clean.updatedAt = Date.now();
  const target = readingMetaFile(rel);
  fs.mkdirSync(path.dirname(target), { recursive:true });
  writeFileAtomicSync(target, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
/* ---- 阅读标注（高亮/标记/摘要），存项目内 .codescope-annotations/<pdf名>.json ---- */
function readingAnnotationsFile(rel) {
  const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
  const stem = path.basename(rel, path.extname(rel));
  return path.join(readingsDir(), dir, '.codescope-annotations', stem + '.json');
}
function cleanAnnotation(item) {
  return {
    id: String(item && item.id || crypto.randomUUID()),
    page: Math.max(1, Number(item && item.page) || 1),
    type: (item && item.type === 'mark') ? 'mark' : 'highlight',
    color: String(item && item.color || '#ffd54a'),
    text: String(item && item.text || '').slice(0, 20000),
    rects: Array.isArray(item && item.rects) ? item.rects.slice(0, 500).map((r) => ({
      x: Number(r && r.x) || 0, y: Number(r && r.y) || 0, width: Number(r && r.width) || 0, height: Number(r && r.height) || 0,
    })) : [],
    note: String(item && item.note || '').slice(0, 20000),
    scale: Number(item && item.scale) || 1,
    createdAt: Number(item && item.createdAt) || Date.now(),
  };
}
function loadReadingAnnotations(rel) {
  try {
    const parsed = JSON.parse(fs.readFileSync(readingAnnotationsFile(rel), 'utf8'));
    return {
      annotations: Array.isArray(parsed && parsed.annotations) ? parsed.annotations.map(cleanAnnotation) : [],
      summary: parsed && parsed.summary && typeof parsed.summary === 'object' ? {
        status: ['done', 'pending', 'error'].includes(parsed.summary.status) ? parsed.summary.status : 'done',
        content: String(parsed.summary.content || ''),
        model: String(parsed.summary.model || ''),
        updatedAt: Number(parsed.summary.updatedAt) || 0,
      } : null,
    };
  } catch (_) { return { annotations: [], summary: null }; }
}
function saveReadingAnnotations(rel, value) {
  const current = loadReadingAnnotations(rel);
  const annotations = Array.isArray(value.annotations) ? value.annotations.slice(0, 5000).map(cleanAnnotation) : current.annotations;
  let summary = current.summary;
  if (value.summary && typeof value.summary === 'object' && ('content' in value.summary || 'status' in value.summary)) {
    summary = {
      status: ['done', 'pending', 'error'].includes(value.summary.status) ? value.summary.status : 'done',
      content: String(value.summary.content || ''),
      model: String(value.summary.model || (current.summary && current.summary.model) || ''),
      updatedAt: Date.now(),
    };
  }
  const data = { version: 1, updatedAt: Date.now(), annotations, summary };
  const target = readingAnnotationsFile(rel);
  fs.mkdirSync(path.dirname(target), { recursive:true });
  writeFileAtomicSync(target, JSON.stringify(data, null, 2), 'utf8');
  return { annotations, summary };
}
function moveReadingMeta(from, to) {
  const oldFile = readingMetaFile(from), nextFile = readingMetaFile(to);
  if (!fs.existsSync(oldFile)) return;
  try {
    const meta = loadReadingMeta(from); meta.path = to;
    fs.mkdirSync(path.dirname(nextFile), { recursive:true });
    writeFileAtomicSync(nextFile, JSON.stringify(meta, null, 2), 'utf8');
    fs.unlinkSync(oldFile);
  } catch (_) {}
}
function readingTree() {
  const rootDir = readingsDir();
  const root = { type:'folder', name:'', path:'', children:[], count:0 };
  const walkProject = (node, dir, prefix, projectPath) => {
    let rows = [];
    try { rows = fs.readdirSync(dir, { withFileTypes:true }).filter((entry) => ![READING_PROJECT_META,READING_FOLDER_META,'.codescope','.vitepress','node_modules','public'].includes(entry.name)); } catch (_) {}
    rows.sort((a, b) => a.name.localeCompare(b.name));
    let count = 0;
    for (const entry of rows) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        count += walkProject(node, path.join(dir, entry.name), rel, projectPath);
      } else if (readingAssetPath(rel)) {
        let stat = { size:0, mtimeMs:0 }; try { stat = fs.statSync(path.join(dir, entry.name)); } catch (_) {}
        const fragment = readingFragmentInfo(rel, stat, projectPath);
        if (fragment.kind === 'pdf') {
          const meta = loadReadingMeta(rel);
          fragment.progress = { page:meta.page, translated:Object.keys(meta.translations || {}).length, fragments:meta.fragments.length };
        }
        node.children.push(fragment);
        count += 1;
      }
    }
    return count;
  };
  const directoryHasDirectAssets=(dir)=>{try{return fs.readdirSync(dir,{withFileTypes:true}).some((entry)=>entry.isFile()&&![READING_PROJECT_META,READING_FOLDER_META].includes(entry.name)&&readingAssetPath(entry.name));}catch(_){return false;}};
  const buildKnowledgeProject=(dir,rel)=>{const meta=loadReadingProjectMeta(rel),project={type:'project',knowledge:true,name:path.basename(rel),path:rel,description:meta.description,tags:meta.tags,children:[],count:0};let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true}).filter((entry)=>entry.isFile()&&!entry.name.startsWith('.')&&['.md','.markdown'].includes(path.extname(entry.name).toLowerCase()));}catch(_){}entries.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));for(const entry of entries){const childRel=rel+'/'+entry.name,full=path.join(dir,entry.name);let stat={size:0,mtimeMs:0};try{stat=fs.statSync(full);}catch(_){}const fragment=readingFragmentInfo(childRel,stat,rel);fragment.knowledge=true;project.children.push(fragment);project.count+=1;}return project;};
  const buildKnowledgeFolder=(dir,rel,isRoot=false)=>{let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true}).filter((entry)=>entry.isDirectory()&&!entry.name.startsWith('.')&&!['.codescope','.vitepress','node_modules','public'].includes(entry.name));}catch(_){}entries.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));const folder={type:'folder',knowledge:true,knowledgeRoot:isRoot,name:path.basename(rel),path:rel,children:[],count:0};for(const entry of entries){const childRel=rel+'/'+entry.name,full=path.join(dir,entry.name);if(fs.existsSync(path.join(full,READING_PROJECT_META))){const project=buildKnowledgeProject(full,childRel);folder.children.push(project);folder.count+=1;}else{const child=buildKnowledgeFolder(full,childRel,false);folder.children.push(child);folder.count+=child.count;}}return folder;};
  const walkFolders=(dir,prefix,depth)=>{let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true}).filter((entry)=>entry.name!=='.codescope'&&![READING_PROJECT_META,READING_FOLDER_META].includes(entry.name));}catch(_){}entries.sort((a,b)=>a.name.localeCompare(b.name));const children=[];
    for(const entry of entries){if(!entry.isDirectory())continue;const rel=prefix?prefix+'/'+entry.name:entry.name,full=path.join(dir,entry.name);const explicitFolder=fs.existsSync(path.join(full,READING_FOLDER_META)),explicitProject=fs.existsSync(path.join(full,READING_PROJECT_META));
      if(rel===KNOWLEDGE.folderName){const folder=buildKnowledgeFolder(full,rel,true);children.push(folder);root.count+=folder.count;continue;}
      if(explicitFolder){const folder={type:'folder',name:entry.name,path:rel,children:walkFolders(full,rel,depth+1)};folder.count=folder.children.reduce((sum,item)=>sum+(item.type==='project'?1:item.count||0),0);children.push(folder);continue;}
      if(explicitProject||directoryHasDirectAssets(full)||depth===0){const meta=loadReadingProjectMeta(rel),project={type:'project',name:entry.name,path:rel,description:meta.description,tags:meta.tags,children:[],count:0};project.count=walkProject(project,full,rel,rel);children.push(project);root.count+=project.count;continue;}
      const folder={type:'folder',name:entry.name,path:rel,children:walkFolders(full,rel,depth+1)};folder.count=folder.children.reduce((sum,item)=>sum+(item.type==='project'?1:item.count||0),0);children.push(folder);
    }return children;};
  root.children=walkFolders(rootDir,'',0);
  return root;
}
const PDF_TEXT_CACHE = new Map();
const PDF_TEXT_CACHE_LIMIT = 10;
const PDF_TEXT_CACHE_BYTES_LIMIT = 64 * 1024 * 1024;
let PDF_PARSE_CHAIN = Promise.resolve();
function trimPdfTextCache() {
  let total = 0;
  for (const entry of PDF_TEXT_CACHE.values()) total += entry.bytes || 0;
  while (PDF_TEXT_CACHE.size > PDF_TEXT_CACHE_LIMIT || total > PDF_TEXT_CACHE_BYTES_LIMIT) {
    const oldest = PDF_TEXT_CACHE.keys().next().value;
    if (oldest === undefined) break;
    total -= (PDF_TEXT_CACHE.get(oldest).bytes || 0);
    PDF_TEXT_CACHE.delete(oldest);
  }
}
/* pdf.js 的文本抽取是纯 CPU 的同步循环（服务端还禁用了它自带的 worker），
   放在主线程上会让整本大 PDF 的解析时间把事件循环一起冻住：终端输出、自动保存、
   其他 HTTP 请求都得等它。因此解析改到 worker 线程执行，主线程只负责收发。
   线程复用（pdf.js 的加载不便宜），空闲一段时间后终止以释放其内存；
   线程起不来或超时时退回进程内解析，功能不降级，只是退回到会短暂占用主线程的老行为。
   解析逻辑只有一份，在 lib/pdf-text.js。 */
const PDF_WORKER_IDLE_MS = Math.max(5000, Number(process.env.CODESCOPE_PDF_WORKER_IDLE_MS) || 60000);
const PDF_WORKER_TIMEOUT_MS = Math.max(30000, Number(process.env.CODESCOPE_PDF_TIMEOUT_MS) || 180000);
let PDF_WORKER = null;
let PDF_WORKER_IDLE_TIMER = null;
let PDF_WORKER_SEQ = 0;
const PDF_WORKER_PENDING = new Map();

function armPdfWorkerIdle() {
  if (PDF_WORKER_IDLE_TIMER) clearTimeout(PDF_WORKER_IDLE_TIMER);
  PDF_WORKER_IDLE_TIMER = setTimeout(() => {
    if (PDF_WORKER_PENDING.size) return armPdfWorkerIdle();
    stopPdfWorker('空闲');
  }, PDF_WORKER_IDLE_MS);
  if (PDF_WORKER_IDLE_TIMER.unref) PDF_WORKER_IDLE_TIMER.unref();
}
function stopPdfWorker(reason) {
  if (PDF_WORKER_IDLE_TIMER) { clearTimeout(PDF_WORKER_IDLE_TIMER); PDF_WORKER_IDLE_TIMER = null; }
  const worker = PDF_WORKER;
  PDF_WORKER = null;
  if (worker) { try { worker.terminate(); } catch (_) {} }
  if (PDF_WORKER_PENDING.size) {
    const waiting = [...PDF_WORKER_PENDING.values()];
    PDF_WORKER_PENDING.clear();
    for (const item of waiting) { clearTimeout(item.timer); item.reject(new Error(reason === '空闲' ? 'PDF 解析线程已空闲回收' : String(reason || 'PDF 解析线程已停止'))); }
  }
}
function ensurePdfWorker() {
  if (PDF_WORKER) return PDF_WORKER;
  const { Worker } = require('worker_threads');
  const worker = new Worker(path.join(__dirname, 'lib', 'pdf-text-worker.js'));
  worker.on('message', (message) => {
    const id = message && message.id, item = PDF_WORKER_PENDING.get(id);
    if (!item) return;
    PDF_WORKER_PENDING.delete(id);
    clearTimeout(item.timer);
    if (message.ok) item.resolve({ pages: message.pages, bytes: message.bytes });
    else { const parseError = new Error(message.error || 'PDF 解析失败'); parseError.pdfReported = true; item.reject(parseError); }
    armPdfWorkerIdle();
  });
  worker.on('error', (error) => stopPdfWorker('PDF 解析线程出错：' + String((error && error.message) || error)));
  worker.on('exit', (code) => { if (PDF_WORKER === worker) stopPdfWorker('PDF 解析线程退出（code ' + code + '）'); });
  if (worker.unref) worker.unref();
  PDF_WORKER = worker;
  return worker;
}
function parsePdfPagesInWorker(file) {
  const worker = ensurePdfWorker();
  const id = ++PDF_WORKER_SEQ;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      PDF_WORKER_PENDING.delete(id);
      reject(new Error('PDF 解析超时（' + PDF_WORKER_TIMEOUT_MS + 'ms）'));
      stopPdfWorker('PDF 解析超时');
    }, PDF_WORKER_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    PDF_WORKER_PENDING.set(id, { resolve, reject, timer });
    worker.postMessage({ id, file });
  });
}
async function parsePdfPagesInline(file) {
  // pdf.js 的模块加载也交给 lib/pdf-text.js 缓存，这里不再重复 import。
  const { parsePdfText } = require('./lib/pdf-text.js');
  return parsePdfText(file);
}
async function parsePdfPages(file) {
  try {
    return await parsePdfPagesInWorker(file);
  } catch (error) {
    // 线程报告的解析失败（文件损坏、加密等）就是最终结论，不再重试一遍。
    if (error && error.pdfReported) throw error;
    console.warn('[codescope] PDF 解析线程不可用，退回进程内解析：' + String((error && error.message) || error));
    return parsePdfPagesInline(file);
  }
}
async function extractPdfPages(file) {
  const stat = await fs.promises.stat(file), cacheKey = stat.mtimeMs + ':' + stat.size;
  const cached = PDF_TEXT_CACHE.get(file);
  if (cached && cached.key === cacheKey) {
    PDF_TEXT_CACHE.delete(file); PDF_TEXT_CACHE.set(file, cached);
    return cached.pages;
  }
  // 串行解析：并发打开多本 PDF 时不要在内存里同时摊开多份解析结果。
  const run = () => parsePdfPages(file);
  const queued = PDF_PARSE_CHAIN.then(run, run);
  PDF_PARSE_CHAIN = queued.then(() => {}, () => {});
  const result = await queued;
  PDF_TEXT_CACHE.delete(file);
  PDF_TEXT_CACHE.set(file, { key:cacheKey, pages:result.pages, bytes:result.bytes });
  trimPdfTextCache();
  return result.pages;
}

function searchReadingLibrary(query, sensitive) {
  const needle = sensitive ? String(query || '') : String(query || '').toLocaleLowerCase();
  if (!needle || needle.length > 240) return [];
  const root = readingsDir(), hits = [];
  const addLines = (rel, content, extra) => {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    for (let index = 0; index < lines.length && hits.length < 200; index += 1) {
      const line = lines[index], haystack = sensitive ? line : line.toLocaleLowerCase(), start = haystack.indexOf(needle);
      if (start >= 0) hits.push({ path:rel, line:index + 1, text:line.trim().slice(0, 600), start, length:String(query).length, ...(extra || {}) });
    }
  };
  const walk = (dir, prefix) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch (_) { return; }
    for (const entry of entries) {
      if (hits.length >= 200 || entry.name === '.codescope' || entry.name.startsWith('.')) continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name, full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, rel); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (READING_TEXT_EXTS.has(ext)) {
        try { const stat = fs.statSync(full); if (stat.size <= 2 * 1024 * 1024) addLines(rel, fs.readFileSync(full, 'utf8'), { kind:'text' }); } catch (_) {}
      } else if (ext === '.url') {
        try { addLines(rel, path.basename(rel, ext) + '\n' + readingWebShortcut(rel), { kind:'web' }); } catch (_) {}
      } else if (ext === '.pdf') {
        const meta = loadReadingMeta(rel);
        for (const fragment of meta.fragments || []) {
          const value = [fragment.source, fragment.translation, fragment.note].filter(Boolean).join(' · '), haystack = sensitive ? value : value.toLocaleLowerCase(), start = haystack.indexOf(needle);
          if (start >= 0) hits.push({ path:rel, page:Number(fragment.page) || 1, line:0, text:value.slice(0, 600), start, length:String(query).length, kind:'pdf' });
          if (hits.length >= 200) break;
        }
      }
    }
  };
  walk(root, '');
  return hits;
}

function decodeWorkspaceRef(value) {
  try { return decodeURIComponent(String(value || '')); } catch (_) { return String(value || ''); }
}
function workspaceBacklinks(kind, targetPath, targetFragment) {
  const hits = [], wanted = String(targetPath || ''), wantedFragment = Number(targetFragment);
  const addMatches = (content, source) => {
    const text = String(content || ''), lines = text.replace(/\r\n/g, '\n').split('\n');
    const patterns = kind === 'code'
      ? [/\[\[code-ref:([^#|\]]+)#fragment=(\d+)(?:&amp;|&)line=(\d+)(?:(?:&amp;|&)end=(\d+))?\|([^\]]+)\]\]/g]
      : kind === 'pdf'
        ? [/\[\[pdf-ref:([^#|\]]+)#page=(\d+)(?:&amp;|&)fragment=([^|\]]*)\|([^\]]+)\]\]/g]
        : [/\[\[note-ref:([^|\]]+)\|([^\]]+)\]\]/g];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) && hits.length < 300) {
        const refPath = decodeWorkspaceRef(match[1]);
        const fragment = kind === 'code' ? Number(match[2]) : null;
        if (refPath !== wanted || (kind === 'code' && Number.isFinite(wantedFragment) && fragment !== wantedFragment)) continue;
        const line = text.slice(0, match.index).split('\n').length;
        hits.push({ ...source, line, label:match[match.length - 1], preview:(lines[line - 1] || '').trim().slice(0, 600) });
      }
    }
  };
  for (const snippet of walkSnippets()) {
    (snippet.fragments || []).forEach((fragment, index) => {
      if (fragment.language === 'markdown') addMatches(fragment.code, { sourceKind:'code-note', file:snippet.file, fragment:index, name:(fragment.label || snippet.name), project:snippet.name });
    });
  }
  const root = readingsDir();
  const walk = (dir, prefix) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || hits.length >= 300) continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name, full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, rel); continue; }
      if (!['.md','.markdown'].includes(path.extname(entry.name).toLowerCase())) continue;
      try { const stat = fs.statSync(full); if (stat.size <= 8 * 1024 * 1024) addMatches(fs.readFileSync(full, 'utf8'), { sourceKind:'reading-note', path:rel, name:path.basename(rel), project:path.posix.dirname(rel) }); } catch (_) {}
    }
  };
  walk(root, '');
  return hits;
}

/* ------------------------------- Office 文档库 ------------------------------- */

function officeDir() { return path.join(vaultPath(), 'office'); }
const OFFICE_EXTS = new Set(['.docx', '.xlsx', '.xls', '.csv', '.pptx']);
const ONLYOFFICE_CONTAINER_HOST = String(process.env.CODESCOPE_ONLYOFFICE_CONTAINER_HOST || 'host.docker.internal').trim();
const ONLYOFFICE_ACCESS_SECRET = crypto.randomBytes(32);
const ONLYOFFICE_READING_SESSIONS = new Map();
function onlyOfficeToken(rel, purpose) {
  return crypto.createHmac('sha256', ONLYOFFICE_ACCESS_SECRET).update(String(purpose || '') + '\0' + String(rel || '')).digest('hex');
}
function onlyOfficeTokenValid(rel, purpose, token) {
  const expected = Buffer.from(onlyOfficeToken(rel, purpose)), actual = Buffer.from(String(token || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function onlyOfficeContainerBase() {
  const explicit = ONLYOFFICE_CONNECTION.callbackBase;
  if (explicit) return explicit;
  return 'http://' + ONLYOFFICE_CONTAINER_HOST + ':' + PORT;
}
function onlyOfficeBrowserUrl(req) {
  const configured = ONLYOFFICE_CONNECTION.publicUrl;
  if (!configured) return '';
  let service;
  try { service = new URL(configured); } catch (_) { return configured; }
  if (!['127.0.0.1', 'localhost', '::1'].includes(service.hostname)) return configured;
  let requestHost = '';
  try { requestHost = new URL('http://' + String(req && req.headers && req.headers.host || '')).hostname; } catch (_) {}
  if (!requestHost || ['127.0.0.1', 'localhost', '::1'].includes(requestHost)) return configured;
  service.hostname = requestHost;
  return service.toString().replace(/\/$/, '');
}
async function onlyOfficeHealth() {
  return OFFICE_ENGINE.probeOnlyOffice();
}
/* ONLYOFFICE 自动准备：npm 的 prestart/preweb 只在 `npm start` 时执行，
   直接 `node server.js`、start.command 或桌面端启动都会跳过，因此服务端启动时自行补一次。
   设置 CODESCOPE_AUTO_OFFICE=0（测试/CI）或在 CODESCOPE_ONLYOFFICE_URL 显式指定地址时不代管。 */
let OFFICE_ENSURE_RUNNING = false;
function runOfficeEnsure(reason) {
  if (OFFICE_ENSURE_RUNNING) return;
  try {
    if (String(process.env.CODESCOPE_AUTO_OFFICE || '') === '0') return;
    if (process.env.CODESCOPE_ONLYOFFICE_URL) return;
    const script = path.join(__dirname, 'scripts', 'ensure-onlyoffice.js');
    if (!fs.existsSync(script)) return;
    OFFICE_ENSURE_RUNNING = true;
    console.log('ONLYOFFICE 未就绪，正在后台自动准备（' + reason + '）…');
    const child = spawn(process.execPath, [script], { cwd: __dirname, env: process.env, stdio: 'ignore' });
    child.on('exit', (code) => {
      try { ONLYOFFICE_CONNECTION = readOnlyOfficeConnection(); } catch (_) {}
      // 代管流程刚写好配置时必须重建引擎：否则探测用的仍是启动时那个空地址，
      // 面板会一直显示「尚未配置」，只能靠重启应用才恢复。
      try { refreshOfficeEngine(); } catch (_) {}
      console.log('ONLYOFFICE 自动准备结束（退出码 ' + code + '）：' + (ONLYOFFICE_CONNECTION.publicUrl || '仍未配置服务地址'));
      OFFICE_ENSURE_RUNNING = false;
    });
    child.on('error', () => { OFFICE_ENSURE_RUNNING = false; });
  } catch (_) { OFFICE_ENSURE_RUNNING = false; }
}
function ensureOnlyOfficeWhenNeeded() {
  if (String(process.env.CODESCOPE_AUTO_OFFICE || '') === '0') return;
  if (!ONLYOFFICE_CONNECTION.publicUrl) return runOfficeEnsure('尚未配置服务地址');
  onlyOfficeHealth()
    .then((health) => { if (!health || !health.ok) runOfficeEnsure('健康检查未通过：' + ((health && health.error) || '无响应')); })
    .catch(() => runOfficeEnsure('健康检查异常'));
}

async function onlyOfficeCommand(command) {
  if (!ONLYOFFICE_CONNECTION.publicUrl) throw requestError('ONLYOFFICE Docs 尚未配置', 503);
  const payload = { ...command };
  const token = signOnlyOfficeConfig(command);
  if (token) payload.token = token;
  const base = ONLYOFFICE_CONNECTION.publicUrl.replace(/\/+$/, '');
  const paths = ['/command?shardkey=' + encodeURIComponent(command.key || ''), '/coauthoring/CommandService.ashx?shardkey=' + encodeURIComponent(command.key || '')];
  let lastError;
  for (const suffix of paths) {
    try {
      const response = await fetch(base + suffix, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(payload), signal:AbortSignal.timeout(20000) });
      if (response.status === 404 && suffix.startsWith('/command')) continue;
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const result = await response.json();
      return result;
    } catch (error) { lastError = error; }
  }
  throw requestError('ONLYOFFICE 命令服务不可用：' + String(lastError && lastError.message || lastError || '未知错误'), 502);
}
function onlyOfficeDocumentType(kind) {
  return kind === 'word' ? 'word' : kind === 'sheet' ? 'cell' : kind === 'slides' ? 'slide' : '';
}
function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signOnlyOfficeConfig(payload) {
  const secret = ONLYOFFICE_CONNECTION.jwtSecret;
  if (!secret) return '';
  const header = base64Url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(header + '.' + body).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return header + '.' + body + '.' + signature;
}
function onlyOfficeConfig(rel, file) {
  const stat = fs.statSync(file), ext = path.extname(rel).slice(1).toLowerCase(), kind = officeKind(rel);
  const internal = onlyOfficeContainerBase(), documentToken = onlyOfficeToken(rel, 'document'), callbackToken = onlyOfficeToken(rel, 'callback');
  const key = crypto.createHash('sha256').update('codescope\0' + rel + '\0' + stat.size + '\0' + stat.mtimeMs).digest('hex').slice(0, 48);
  const config = {
    type:'desktop', width:'100%', height:'100%', documentType:onlyOfficeDocumentType(kind),
    document:{
      fileType:ext, key, title:path.basename(rel),
      url:internal + '/api/office/onlyoffice-file?path=' + encodeURIComponent(rel) + '&token=' + documentToken,
      info:{ owner:'CodeScope', folder:path.posix.dirname(rel) === '.' ? 'Office 根目录' : path.posix.dirname(rel), uploaded:new Date(stat.mtimeMs).toISOString() },
      permissions:{ edit:true, download:true, print:true, copy:true, comment:true, review:true, fillForms:true, modifyFilter:true, protect:true },
    },
    editorConfig:{
      callbackUrl:internal + '/api/office/onlyoffice-callback?path=' + encodeURIComponent(rel) + '&token=' + callbackToken,
      lang:'zh-CN', region:'zh-CN', mode:'edit',
      user:{ id:'codescope-local', name:'CodeScope 本地用户' },
      coEditing:{ mode:'fast', change:true },
      customization:{ autosave:true, forcesave:true, compactHeader:false, compactToolbar:false, hideRightMenu:false, toolbarHideFileName:true, about:false, feedback:false },
    },
  };
  const token = signOnlyOfficeConfig(config);
  if (token) config.token = token;
  return config;
}
function onlyOfficeReadingConfig(rel, file) {
  const stat = fs.statSync(file), internal = onlyOfficeContainerBase();
  const documentToken = onlyOfficeToken(rel, 'reading-document'), callbackToken = onlyOfficeToken(rel, 'reading-callback');
  const key = crypto.createHash('sha256').update('codescope-reading\0' + rel + '\0' + stat.size + '\0' + stat.mtimeMs).digest('hex').slice(0, 48);
  const config = {
    type:'desktop', width:'100%', height:'100%', documentType:'pdf',
    document:{
      fileType:'pdf', key, title:path.basename(rel),
      url:internal + '/api/readings/onlyoffice-file?path=' + encodeURIComponent(rel) + '&token=' + documentToken,
      info:{ owner:'CodeScope', folder:path.posix.dirname(rel) === '.' ? '阅读根目录' : path.posix.dirname(rel), uploaded:new Date(stat.mtimeMs).toISOString() },
      permissions:{ edit:true, download:true, print:true, copy:true, comment:true, review:true, fillForms:true, protect:true },
    },
    editorConfig:{
      callbackUrl:internal + '/api/readings/onlyoffice-callback?path=' + encodeURIComponent(rel) + '&token=' + callbackToken,
      lang:'zh-CN', region:'zh-CN', mode:'edit',
      user:{ id:'codescope-local', name:'CodeScope 本地用户' },
      coEditing:{ mode:'fast', change:true },
      customization:{ autosave:true, forcesave:true, compactHeader:false, compactToolbar:false, hideRightMenu:false, toolbarHideFileName:true, about:false, feedback:false },
    },
  };
  const token = signOnlyOfficeConfig(config);
  if (token) config.token = token;
  ONLYOFFICE_READING_SESSIONS.set(rel, { key, openedAt:Date.now(), savedAt:0 });
  if (ONLYOFFICE_READING_SESSIONS.size > 100) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [sessionPath, session] of ONLYOFFICE_READING_SESSIONS) if (session.openedAt < cutoff) ONLYOFFICE_READING_SESSIONS.delete(sessionPath);
  }
  return config;
}
function backupOfficeFile(file, rel) {
  const ext = path.extname(rel), relDir = path.dirname(rel), stem = path.basename(rel, ext);
  const backupDir = path.join(officeDir(), '.codescope-backups', relDir === '.' ? '' : relDir);
  fs.mkdirSync(backupDir, { recursive:true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(backupDir, stem + '.' + stamp + ext));
  const backups = fs.readdirSync(backupDir).filter((name) => name.startsWith(stem + '.') && name.endsWith(ext)).sort().reverse();
  for (const old of backups.slice(5)) { try { fs.unlinkSync(path.join(backupDir, old)); } catch (_) {} }
}
function backupReadingPdf(file, rel) {
  const id = crypto.createHash('sha256').update(rel).digest('hex').slice(0, 24);
  const backupDir = path.join(readingsDir(), '.codescope', 'pdf-backups', id);
  fs.mkdirSync(backupDir, { recursive:true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(backupDir, stamp + '.pdf'));
  const backups = fs.readdirSync(backupDir).filter((name) => name.endsWith('.pdf')).sort().reverse();
  for (const old of backups.slice(5)) { try { fs.unlinkSync(path.join(backupDir, old)); } catch (_) {} }
}
async function saveOnlyOfficeResult(rel, sourceUrl, options) {
  const opts = options || {}, root = opts.root || officeDir();
  const file = path.join(root, rel), ext = path.extname(rel).toLowerCase();
  if (!fs.existsSync(file)) throw requestError(opts.pdf ? '要保存的 PDF 不存在' : '要保存的 Office 文档不存在', 404);
  let source;
  try { source = new URL(String(sourceUrl || '')); } catch (_) { throw requestError('ONLYOFFICE 返回了无效的保存地址', 400); }
  if (!ONLYOFFICE_CONNECTION.publicUrl) throw requestError('ONLYOFFICE Docs 尚未配置', 503);
  const allowed = new URL(ONLYOFFICE_CONNECTION.publicUrl);
  if (!['http:', 'https:'].includes(source.protocol)) throw requestError('ONLYOFFICE 保存地址协议不受支持', 400);
  const localNames = new Set(['127.0.0.1', 'localhost', '::1', 'codescope-onlyoffice', 'documentserver', allowed.hostname]);
  if (!localNames.has(source.hostname)) throw requestError('已拒绝非本机 ONLYOFFICE 保存地址', 403);
  if (source.origin !== allowed.origin) {
    source = new URL(source.pathname + source.search, ONLYOFFICE_CONNECTION.publicUrl + '/');
  }
  let response;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetch(source, { signal:AbortSignal.timeout(60000), redirect:'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw requestError('ONLYOFFICE 保存重定向缺少地址', 502);
    let next; try { next = new URL(location, source); } catch (_) { throw requestError('ONLYOFFICE 保存重定向地址无效', 502); }
    if (!['http:', 'https:'].includes(next.protocol) || !localNames.has(next.hostname)) throw requestError('已拒绝非本机 ONLYOFFICE 保存重定向', 403);
    if (next.origin !== allowed.origin) next = new URL(next.pathname + next.search, ONLYOFFICE_CONNECTION.publicUrl + '/');
    source = next;
  }
  if (!response) throw requestError('ONLYOFFICE 文件下载失败', 502);
  if (!response.ok) throw requestError('ONLYOFFICE 文件下载失败（HTTP ' + response.status + '）', 502);
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > 200 * 1024 * 1024) throw requestError('ONLYOFFICE 返回的文件超过 200 MB', 413);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 200 * 1024 * 1024) throw requestError('ONLYOFFICE 返回的文件超过 200 MB', 413);
  const temp = path.join(path.dirname(file), '.' + crypto.randomUUID() + ext + '.onlyoffice-saving');
  try {
    fs.writeFileSync(temp, buffer);
    if (opts.pdf) {
      if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw requestError('ONLYOFFICE 返回的文件不是有效 PDF', 400);
      backupReadingPdf(file, rel);
    } else { validateOfficeFile(temp, ext); backupOfficeFile(file, rel); }
    fs.renameSync(temp, file);
  } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} throw error; }
  return fs.statSync(file);
}
function officePath(value, allowFolder = false) {
  if (typeof value !== 'string') return null;
  const rel = value.replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean).join('/');
  if (!rel || /(^|\/)\.{1,2}(\/|$)|^\/|\/\//.test(rel) || /^[A-Za-z]:/.test(rel)) return null;
  if (!/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&/]+$/.test(rel)) return null;
  if (!allowFolder && !OFFICE_EXTS.has(path.extname(rel).toLowerCase())) return null;
  return rel;
}
function officeKind(value) {
  const ext = path.extname(String(value || '')).toLowerCase();
  if (ext === '.docx') return 'word';
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'sheet';
  if (ext === '.pptx') return 'slides';
  return 'unknown';
}
function officeTree() {
  const root = { type:'folder', name:'', path:'', children:[], count:0 };
  const walk = (node, absolute) => {
    let entries = [];
    try { entries = fs.readdirSync(absolute, { withFileTypes:true }); } catch (_) {}
    entries = entries.filter((entry) => !entry.name.startsWith('.')).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN', { numeric:true });
    });
    let count = 0;
    for (const entry of entries) {
      const rel = node.path ? node.path + '/' + entry.name : entry.name;
      const full = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        const child = { type:'folder', name:entry.name, path:rel, children:[], count:0 };
        node.children.push(child); child.count = walk(child, full); count += child.count;
      } else if (OFFICE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        let stat; try { stat = fs.statSync(full); } catch (_) { continue; }
        node.children.push({ type:'document', name:entry.name, path:rel, kind:officeKind(entry.name), ext:path.extname(entry.name).toLowerCase(), size:stat.size, updated:stat.mtimeMs });
        count += 1;
      }
    }
    node.count = count; return count;
  };
  fs.mkdirSync(officeDir(), { recursive:true }); walk(root, officeDir()); return root;
}
function uniqueOfficeTarget(folder, base) {
  const ext = path.extname(base), stem = path.basename(base, ext), dir = path.join(officeDir(), folder || '.');
  fs.mkdirSync(dir, { recursive:true });
  let name = base, index = 2;
  while (fs.existsSync(path.join(dir, name))) { name = stem + '-' + index + ext; index += 1; }
  return { name, file:path.join(dir, name), path:folder ? folder + '/' + name : name };
}
function officeSafeFolder(value) {
  if (value == null || value === '') return '';
  const rel = officePath(String(value), true);
  return rel && !OFFICE_EXTS.has(path.extname(rel).toLowerCase()) ? rel : null;
}
function officeStreamToFile(req, target, maxBytes = 200 * 1024 * 1024) {
  let bytes = 0;
  const limiter = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(requestError('Office 文件超过 200 MB', 413));
    callback(null, chunk);
  }});
  return pipeline(req, limiter, fs.createWriteStream(target, { flags:'wx' })).then(() => bytes);
}
function validateOfficeFile(file, ext) {
  const fd = fs.openSync(file, 'r'), head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
  if (['.docx', '.xlsx', '.pptx'].includes(ext) && head.slice(0, 2).toString('ascii') !== 'PK') throw new Error('文件内容不是有效的 Office Open XML 文档');
  if (ext === '.xls' && !head.equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) throw new Error('文件内容不是有效的 Excel 工作簿');
}
async function createOfficeDocument(kind, file, title) {
  if (kind === 'word') {
    const doc = new Document({ sections:[{ children:[new Paragraph({ text:title || '新建文档', heading:HeadingLevel.TITLE }), new Paragraph('开始编写内容…')] }] });
    writeFileAtomicSync(file, await Packer.toBuffer(doc)); return;
  }
  if (kind === 'sheet') {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['项目', '内容'], ['标题', title || '新建表格']]);
    sheet['!cols'] = [{ wch:18 }, { wch:36 }]; XLSX.utils.book_append_sheet(workbook, sheet, '工作表1'); XLSX.writeFile(workbook, file); return;
  }
  if (kind === 'slides') {
    const escape = (value) => String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const deckTitle = escape(title || '新建演示文稿'), entries = {};
    entries['[Content_Types].xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
    entries['_rels/.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
    entries['docProps/core.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>'+deckTitle+'</dc:title><dc:creator>CodeScope</dc:creator><cp:lastModifiedBy>CodeScope</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">'+new Date().toISOString()+'</dcterms:created></cp:coreProperties>');
    entries['docProps/app.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CodeScope</Application><PresentationFormat>宽屏</PresentationFormat><Slides>1</Slides><Notes>0</Notes></Properties>');
    entries['ppt/presentation.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>');
    entries['ppt/_rels/presentation.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
    entries['ppt/slides/slide1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F7F9FC"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="2286000"/><a:ext cx="10363200" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="3000" b="1"><a:solidFill><a:srgbClr val="243247"/></a:solidFill></a:rPr><a:t>'+deckTitle+'</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
    entries['ppt/slides/_rels/slide1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
    entries['ppt/slideLayouts/slideLayout1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="空白"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
    entries['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
    entries['ppt/slideMasters/slideMaster1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="4472C4" accent2="ED7D31" accent3="A5A5A5" accent4="FFC000" accent5="5B9BD5" accent6="70AD47" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>');
    entries['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>');
    entries['ppt/theme/theme1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="CodeScope"><a:themeElements><a:clrScheme name="CodeScope"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="243247"/></a:dk2><a:lt2><a:srgbClr val="F7F9FC"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="CodeScope"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="等线"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="等线"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="CodeScope"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:solidFill><a:schemeClr val="lt2"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>');
    writeFileAtomicSync(file, Buffer.from(zipSync(entries, { level:6 }))); return;
  }
  throw new Error('不支持的 Office 文档类型');
}

function sanitizeOfficeWordHtml(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|meta|link)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|meta|link)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '');
}

async function officeWordToHtml(file) {
  const result = await mammoth.convertToHtml({ buffer:fs.readFileSync(file) }, {
    styleMap:[
      "p[style-name='Title'] => h1.office-document-title:fresh",
      "p[style-name='Subtitle'] => p.office-document-subtitle:fresh",
      "p[style-name='Quote'] => blockquote:fresh",
    ],
    includeDefaultStyleMap:true,
  });
  return { html:sanitizeOfficeWordHtml(result.value), messages:(result.messages || []).slice(0, 30).map((item) => ({ type:item.type, message:item.message })) };
}

async function saveOfficeWordHtml(file, value) {
  const html = sanitizeOfficeWordHtml(value);
  if (!html.trim()) throw requestError('Word 文档内容不能为空', 400);
  if (Buffer.byteLength(html, 'utf8') > 20 * 1024 * 1024) throw requestError('Word 编辑内容超过 20 MB', 413);
  const page = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,"Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.6;color:#111}h1{font-size:24pt}h2{font-size:18pt}h3{font-size:14pt}blockquote{border-left:3px solid #888;padding-left:12px;color:#555}table{border-collapse:collapse}td,th{border:1px solid #888;padding:5px 8px}' +
    '</style></head><body>' + html + '</body></html>';
  const output = await htmlToDocx(page, null, { table:{ row:{ cantSplit:true } }, footer:false, pageNumber:false });
  const temp = path.join(path.dirname(file), '.' + crypto.randomUUID() + '.docx-saving');
  try {
    fs.writeFileSync(temp, Buffer.from(output));
    validateOfficeFile(temp, '.docx');
    const rel = path.relative(officeDir(), file), relDir = path.dirname(rel), stem = path.basename(rel, '.docx');
    const backupDir = path.join(officeDir(), '.codescope-backups', relDir === '.' ? '' : relDir);
    fs.mkdirSync(backupDir, { recursive:true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(backupDir, stem + '.' + stamp + '.docx'));
    const backups = fs.readdirSync(backupDir).filter((name) => name.startsWith(stem + '.') && name.endsWith('.docx')).sort().reverse();
    for (const old of backups.slice(5)) { try { fs.unlinkSync(path.join(backupDir, old)); } catch (_) {} }
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
  return fs.statSync(file);
}

function send(res, code, obj) {
  if (res.writableEnded || res.destroyed) return false;
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
  return true;
}

function requestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode || 400;
  return error;
}

function readBody(req, maxBytes = 45e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    let tooLarge = false;
    const decoder = new StringDecoder('utf8');
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { tooLarge = true; data = ''; return; }
      if (!tooLarge) data += decoder.write(chunk);
    });
    req.once('end', () => {
      if (tooLarge) return reject(requestError('请求内容超过 ' + Math.round(maxBytes / 1e6) + ' MB', 413));
      data += decoder.end();
      if (!data.trim()) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (_) { reject(requestError('请求 JSON 格式错误', 400)); }
    });
    req.once('aborted', () => reject(requestError('请求在传输完成前已中止', 400)));
    req.once('error', reject);
  });
}

function readRawBody(req, maxBytes = 12e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes <= maxBytes) chunks.push(chunk);
    });
    req.once('end', () => bytes > maxBytes
      ? reject(requestError('请求内容超过 ' + Math.round(maxBytes / 1e6) + ' MB', 413))
      : resolve(Buffer.concat(chunks)));
    req.once('aborted', () => reject(requestError('请求在传输完成前已中止', 400)));
    req.once('error', reject);
  });
}

function searchPlainText(value, maxLength) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, maxLength || 1200);
}
function normalizeWebResults(items) {
  const out = [], seen = new Set();
  for (const item of items || []) {
    const rawUrl = String(item.url || '').trim();
    let parsed;
    try { parsed = new URL(rawUrl); } catch (_) { continue; }
    if (!['http:', 'https:'].includes(parsed.protocol) || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    out.push({
      title:searchPlainText(item.title || parsed.hostname, 240),url:parsed.href,
      snippet:searchPlainText(item.snippet || item.content || item.description, 1800),
      publishedAt:searchPlainText(item.publishedAt || item.published_date || item.age || '', 80),
    });
    if (out.length >= 6) break;
  }
  return out;
}
async function liveWebSearch(provider, key, query) {
  const searchedAt = new Date().toISOString();
  if (provider === 'tavily') {
    const response = await fetch('https://api.tavily.com/search', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify({query,topic:'general',search_depth:'advanced',max_results:6,include_answer:false,include_raw_content:false}),
      signal:AbortSignal.timeout(25000),
    });
    const text=await response.text();
    if(!response.ok) throw new Error('Tavily API '+response.status+': '+text.slice(0,300));
    let data;try{data=JSON.parse(text);}catch(_){throw new Error('Tavily 返回了无法解析的内容');}
    return {ok:true,provider,searchedAt,results:normalizeWebResults(data.results)};
  }
  if (provider === 'brave') {
    const url=new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q',query);url.searchParams.set('count','6');url.searchParams.set('safesearch','moderate');url.searchParams.set('text_decorations','false');url.searchParams.set('extra_snippets','true');
    const response=await fetch(url,{headers:{'Accept':'application/json','Accept-Encoding':'gzip','X-Subscription-Token':key},signal:AbortSignal.timeout(25000)});
    const text=await response.text();
    if(!response.ok) throw new Error('Brave Search API '+response.status+': '+text.slice(0,300));
    let data;try{data=JSON.parse(text);}catch(_){throw new Error('Brave Search 返回了无法解析的内容');}
    const rows=((data.web&&data.web.results)||[]).map((item)=>({title:item.title,url:item.url,description:[item.description].concat(item.extra_snippets||[]).filter(Boolean).join(' '),age:item.age||item.page_age||''}));
    return {ok:true,provider,searchedAt,results:normalizeWebResults(rows)};
  }
  throw new Error('不支持的联网搜索服务');
}

/* 请求级熔断：从“总时长 90 秒”改为“无输出 N 秒”。
   原实现无条件 90 秒销毁连接，导致终端/SSH 会话满 90 秒必被静默断开、长文 AI 翻译必然失败
   （前端对 /api/ai/chat 传的是 timeoutMs:300000）。现在只要还在产出数据就不掐断，
   仍然覆盖“云盘 git 卡死”这类真正无输出的挂起场景。 */
const REQUEST_IDLE_TIMEOUT_MS = Math.max(10000, Number(process.env.CODESCOPE_REQUEST_TIMEOUT_MS) || 150000);
const REQUEST_NO_TIMEOUT = new Set(['/api/term/stream', '/api/ai/chat']);
function armRequestGuard(req, res, pathname) {
  if (REQUEST_NO_TIMEOUT.has(pathname)) return;
  let timer = null;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { try { res.destroy(); } catch (_) {} }, REQUEST_IDLE_TIMEOUT_MS); };
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  const write = res.write.bind(res);
  res.write = function guardedWrite(...args) { arm(); return write(...args); };
  arm();
}

const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, 'http://' + HOST + ':' + PORT); }
  catch (_) { return send(res, 400, { ok:false, error:'请求地址不合法' }); }
  armRequestGuard(req, res, u.pathname);
  try {
    if (req.method !== 'GET' && u.pathname.startsWith('/api/') && !trustedHttpOrigin(req)) {
      return send(res, 403, { ok:false, error:'已拒绝跨站写入请求' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/') {
      return sendIndex(req, res);
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/assets/')) {
      const assetsRoot = path.join(__dirname, 'assets');
      const rel = u.pathname.slice('/assets/'.length);
      return streamStatic(req, res, assetsRoot, rel, { cacheControl:'no-cache' });
    }
    /* ★ 把**共享的纯逻辑**暴露给浏览器 ✓ —— 只开白名单里那几个文件 ✗（不是把整个 lib/ 敞开 ✗）。
       它们是**双栖**的 ✓（Node 里 require ✓ / 浏览器里挂 window.LW_xxx ✓），
       于是「服务端抽正文」和「前端逐句渲染」用的是**同一份**分句器 ✓、
       「按钮上写的下次间隔」和「实际排到的间隔」用的是**同一份**算法 ✓。
       ⚠️ 前端再抄一遍是不行的 ✗ —— 抄两遍必然走偏 ✗，
          会出现「服务端说 15 句、前端画出 17 句」这种没法查的鬼问题 ✗。 */
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/lib/')) {
      const rel = decodeURIComponent(u.pathname.slice('/lib/'.length));
      if (SHARED_LIB_FILES.indexOf(rel) < 0) return send(res, 404, { ok: false, error: 'not found' });
      return streamStatic(req, res, path.join(__dirname, 'lib'), rel, { cacheControl:'no-cache' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/images/')) {
      const imagesRoot = path.join(KNOWLEDGE.sourceDir(), 'public', 'images');
      const rel = decodeURIComponent(u.pathname.slice('/images/'.length));
      return streamStatic(req, res, imagesRoot, rel, { cacheControl:'no-cache', notFound:'知识库图片不存在' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (u.pathname === '/manual' || u.pathname.startsWith('/manual/'))) {
      const manualRoot = path.join(__dirname, 'docs', 'manual');
      const rel = u.pathname === '/manual' || u.pathname === '/manual/' ? 'index.html' : u.pathname.slice('/manual/'.length);
      return streamStatic(req, res, manualRoot, rel, { cacheControl:'no-cache', notFound:'CodeScope 使用手册页面不存在' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (u.pathname === '/knowledge' || u.pathname.startsWith('/knowledge/'))) {
      const root = KNOWLEDGE.distDir();
      const rel = u.pathname === '/knowledge' || u.pathname === '/knowledge/' ? 'index.html' : decodeURIComponent(u.pathname.slice('/knowledge/'.length));
      return streamStatic(req, res, root, rel, { cacheControl:rel.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache', notFound:'知识库尚未生成，请返回 CodeScope 点击“立即生成”' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/vendor/')) {
      const assetsRoot = path.join(__dirname, 'vendor');
      const rel = u.pathname.slice('/vendor/'.length);
      return streamStatic(req, res, assetsRoot, rel, { cacheControl:'public, max-age=86400' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/novnc/')) {
      const novncRoot = path.join(__dirname, 'node_modules', '@novnc', 'novnc');
      const rel = u.pathname.slice('/novnc/'.length);
      return streamStatic(req, res, novncRoot, rel, { cacheControl:'public, max-age=86400', notFound:'noVNC asset not found；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/monaco/')) {
      const monacoRoot = path.join(__dirname, 'node_modules', 'monaco-editor', 'min');
      const rel = u.pathname.slice('/monaco/'.length);
      return streamStatic(req, res, monacoRoot, rel, { cacheControl:'public, max-age=86400', notFound:'Monaco asset not found；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/golden-layout/')) {
      const root = path.join(__dirname, 'node_modules', 'golden-layout', 'dist');
      return streamStatic(req, res, root, u.pathname.slice('/golden-layout/'.length), { cacheControl:'public, max-age=86400', notFound:'学习工作台布局组件不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/xmind-viewer/')) {
      const viewerRoot = path.join(__dirname, 'node_modules', 'xmind-embed-viewer', 'dist', 'umd');
      const rel = u.pathname.slice('/xmind-viewer/'.length);
      return streamStatic(req, res, viewerRoot, rel, { cacheControl:'public, max-age=86400', notFound:'XMind 官方查看器资源不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/mind-elixir/')) {
      const editorRoot = path.join(__dirname, 'node_modules', 'mind-elixir', 'dist');
      const rel = u.pathname.slice('/mind-elixir/'.length);
      return streamStatic(req, res, editorRoot, rel, { cacheControl:'public, max-age=86400', notFound:'Mind Elixir 编辑器资源不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/simple-mind-map/')) {
      const editorRoot = path.join(__dirname, 'node_modules', 'simple-mind-map', 'dist');
      const rel = u.pathname.slice('/simple-mind-map/'.length);
      return streamStatic(req, res, editorRoot, rel, { cacheControl:'public, max-age=86400', notFound:'SimpleMindMap 编辑器资源不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/office-docx/')) {
      const root = path.join(__dirname, 'node_modules', 'docx-preview', 'dist');
      return streamStatic(req, res, root, u.pathname.slice('/office-docx/'.length), { cacheControl:'public, max-age=86400', notFound:'Word 预览组件不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/office-jszip/')) {
      const root = path.join(__dirname, 'node_modules', 'jszip', 'dist');
      return streamStatic(req, res, root, u.pathname.slice('/office-jszip/'.length), { cacheControl:'public, max-age=86400', notFound:'Office ZIP 组件不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/office-xlsx/')) {
      const root = path.join(__dirname, 'node_modules', 'xlsx');
      return streamStatic(req, res, root, u.pathname.slice('/office-xlsx/'.length), { cacheControl:'public, max-age=86400', notFound:'表格组件不存在；请先运行 npm install' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname.startsWith('/office-pptx/')) {
      const root = path.join(__dirname, 'node_modules', 'pptx-preview', 'dist');
      return streamStatic(req, res, root, u.pathname.slice('/office-pptx/'.length), { cacheControl:'public, max-age=86400', notFound:'演示文稿预览组件不存在；请先运行 npm install' });
    }
    if (req.method === 'GET' && u.pathname === '/api/system/status') {
      return send(res, 200, await systemStatus());
    }
    /* 本机管家（一站式本机管理面板）。接口全部收在 /api/system-panel/ 下，
       和上面 /api/system/status 那套健康检查互不干扰；非 GET 请求已经由前面的
       trustedHttpOrigin 网关拦过一道，所以这里只做参数校验与执行。 */
    /* 「我的工作台」—— 本机文件按研究方向归类后的数据。
       GET /api/life/index?depth=3  扫一次返回全量。
       ⚠️ 加 60 秒缓存：面板每次打开都重扫一遍太慢 ✗（用户反馈"启动很慢"）。
       刷新按钮带 ?fresh=1 可以绕过缓存。 */
    if (u.pathname === '/api/life/index') {
      try {
        const depth = Math.min(4, Math.max(1, Number(u.searchParams.get('depth')) || 3));
        const fresh = u.searchParams.get('fresh') === '1';
        const now = Date.now();
        if (!fresh && LIFE_INDEX_CACHE && LIFE_INDEX_CACHE.depth === depth && now - LIFE_INDEX_CACHE.at < 60000) {
          return send(res, 200, LIFE_INDEX_CACHE.data);
        }
        const idx = require('./lib/life-index').buildIndex({ maxDepth: depth });
        LIFE_INDEX_CACHE = { at: now, depth, data: idx };
        return send(res, 200, idx);
      } catch (error) {
        return send(res, 500, { ok: false, error: String((error && error.message) || error) });
      }
    }
    /* 天气：代理 open-meteo（免费、无需 key）。按城市名查坐标再查实况 + 当日预报。
       ⚠️ 不能只用 Node 的 fetch —— 本机环境里配了 HTTP_PROXY 时，
       undici 默认**不读**这个变量 ✗（实测 `fetch failed`，而 curl 同一个地址 200 ✓）。
       所以先试 fetch，失败就用 curl 兜底（curl 会读 HTTP_PROXY/HTTPS_PROXY）。
       ⚠️ 加 10 分钟缓存：这个请求要出外网、慢 ✗，而天气不需要秒级新鲜 ✓。 */
    if (u.pathname === '/api/life/weather') {
      try {
        const city = String(u.searchParams.get('city') || '广州').slice(0, 40);
        const now = Date.now();
        if (LIFE_WX_CACHE[city] && now - LIFE_WX_CACHE[city].at < 600000) {
          return send(res, 200, LIFE_WX_CACHE[city].data);
        }
        const j = async (url) => {
          try {
            const r = await fetch(url);
            if (r.ok) return await r.json();
          } catch (_) {}
          const out = await new Promise((resolve, reject) => {
            require('child_process').execFile('curl', ['-s', '-m', '12', '-L', url], { maxBuffer: 4e6 },
              (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
          });
          return JSON.parse(out);
        };
        const geo = await j('https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=' + encodeURIComponent(city));
        const hit = (geo.results || [])[0];
        if (!hit) return send(res, 200, { ok: false, error: '没找到城市：' + city });
        const w = await j('https://api.open-meteo.com/v1/forecast?latitude=' + hit.latitude + '&longitude=' + hit.longitude +
          '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
          '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max' +
          '&timezone=auto&forecast_days=3');
        const cur = w.current || {}, day = w.daily || {};
        const payload = {
          ok: true, city: hit.name, admin: hit.admin1 || '', country: hit.country || '',
          temp: cur.temperature_2m, feels: cur.apparent_temperature, hum: cur.relative_humidity_2m,
          wind: cur.wind_speed_10m, code: cur.weather_code,
          days: (day.time || []).map((t, i) => ({ date: t, max: day.temperature_2m_max[i], min: day.temperature_2m_min[i],
            code: day.weather_code[i], pop: day.precipitation_probability_max[i] })),
        };
        LIFE_WX_CACHE[city] = { at: Date.now(), data: payload };
        return send(res, 200, payload);
      } catch (error) {
        return send(res, 200, { ok: false, error: '天气读取失败：' + String((error && error.message) || error) });
      }
    }
    /* ── 工作流定时排期 ✓ ────────────────────────────────────────────────
       GET  → 每个定时触发器什么时候跑 + 有没有「已经跑完、等前端来取」的产出 ✓
       POST → 前端推 AI 配置过来 ✓ / 取完产出回执（清 outbox ✓）
       ⚠️ 这两个接口**不碰** life-workbench.json ✗ —— 见上面那段注释 ✓。 */
    if (u.pathname === '/api/life/flow/schedule') {
      if (req.method === 'GET') {
        const store = readLifeStore();
        const st = readFlowSched();
        const now = Date.now();
        return send(res, 200, {
          ok: true,
          now,
          items: FLOW_SCHED.scan(Array.isArray(store.flows) ? store.flows : [], st.last, now),
          outbox: st.outbox,
          seq: st.seq,
          aiReady: !!(st.ai && st.ai.url && st.ai.model),
          tickMs: FLOW_TICK_MS,
        });
      }
      if (req.method === 'POST') {
        try {
          const body = await readBody(req, 1e6);
          const st = readFlowSched();
          if (body && body.ai && typeof body.ai === 'object') {
            st.ai = { url: String(body.ai.url || '').slice(0, 2048), key: String(body.ai.key || '').slice(0, 10000), model: String(body.ai.model || '').slice(0, 200) };
          }
          if (body && body.ackUpTo != null) {
            const upTo = Number(body.ackUpTo) || 0;
            st.outbox = st.outbox.filter((x) => Number(x.seq) > upTo);
          }
          writeFlowSched(st);
          return send(res, 200, { ok: true, left: st.outbox.length });
        } catch (error) {
          return send(res, 400, { ok: false, error: String((error && error.message) || error) });
        }
      }
      return send(res, 405, { ok: false, error: 'Method Not Allowed' });
    }
    /* 工作台本地数据（待办 / 笔记 / 设置）—— 存 JSON 文件，纯本地 */
    if (u.pathname === '/api/life/store') {
      const file = path.join(applicationDataRoot(), 'life-workbench.json');
      const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; } };
      if (req.method === 'GET') return send(res, 200, { ok: true, data: read() });
      if (req.method === 'POST' || req.method === 'PUT') {
        try {
          const body = await readBody(req, 4 * 1024 * 1024);
          const next = body && typeof body === 'object' ? body : {};
          try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (_) {}
          /* ★★ 写盘前先轮转一份快照 ✓ ——
             教训：备忘录内容被写串（bug 已修）时，**一个历史版本都没有** ✗，
             只能眼睁睁看着用户数据丢 ✗。所以留一层安全网：
             最多 5 分钟一份、保留 6 份（≈ 半小时窗口）✓，
             只存本机同目录（life-workbench.bak.0..5.json）✓，不外传 ✓。 */
          try { rotateStoreBackup(file); } catch (_) {}
          fs.writeFileSync(file, JSON.stringify(next, null, 2));
          return send(res, 200, { ok: true });
        } catch (error) {
          return send(res, 400, { ok: false, error: String((error && error.message) || error) });
        }
      }
    }
    /* 论文检索：arXiv API（免费、无需 key）。
       ⚠️ 和天气一样，不能只靠 Node 的 fetch —— 环境里配了 HTTP_PROXY 时 undici 不读 ✗，
       所以走同一个 curl 兜底。 */
    if (u.pathname === '/api/life/papers') {
      try {
        const q = String(u.searchParams.get('q') || '').slice(0, 200) || 'robot locomotion control';
        const max = Math.min(30, Math.max(3, Number(u.searchParams.get('max')) || 12));
        const url = 'http://export.arxiv.org/api/query?search_query=all:' + encodeURIComponent(q) +
          '&start=0&max_results=' + max + '&sortBy=submittedDate&sortOrder=descending';
        const xml = await new Promise((resolve, reject) => {
          require('child_process').execFile('curl', ['-s', '-m', '25', '-L', url], { maxBuffer: 8e6 },
            (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
        });
        /* 极简 Atom 解析：只取我们需要的字段，不引依赖 */
        const items = [];
        const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
        const pick = (s, tag) => {
          const m = s.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>'));
          return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
        };
        let m;
        while ((m = entryRe.exec(xml)) !== null) {
          const e = m[1];
          const authors = [];
          const auRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
          let a;
          while ((a = auRe.exec(e)) !== null) authors.push(a[1].trim());
          const linkM = e.match(/<link[^>]*href="([^"]+)"[^>]*rel="alternate"/) || e.match(/<id>([^<]+)<\/id>/);
          items.push({
            title: pick(e, 'title'),
            summary: pick(e, 'summary').slice(0, 420),
            published: pick(e, 'published').slice(0, 10),
            updated: pick(e, 'updated').slice(0, 10),
            authors: authors.slice(0, 6),
            url: linkM ? linkM[1] : '',
            id: pick(e, 'id'),
          });
        }
        return send(res, 200, { ok: true, q, count: items.length, items });
      } catch (error) {
        return send(res, 200, { ok: false, error: '论文检索失败：' + String((error && error.message) || error) });
      }
    }
    /* 网上热点：Hacker News（Algolia API，免费、无需 key ✓）。
       ⚠️ 同 arXiv/天气 —— Node 的 fetch 不读 HTTP_PROXY ✗，统一走 curl 兜底 ✓。 */
    if (u.pathname === '/api/life/hot') {
      try {
        const q = String(u.searchParams.get('q') || 'robotics').slice(0, 120);
        const url = 'https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=12&query=' + encodeURIComponent(q);
        const txt = await new Promise((resolve, reject) => {
          require('child_process').execFile('curl', ['-s', '-m', '20', '-L', url], { maxBuffer: 8e6 },
            (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
        });
        const j = JSON.parse(txt);
        const items = (j.hits || []).map((h) => ({
          title: h.title || h.story_title || '',
          url: h.url || h.story_url || ('https://news.ycombinator.com/item?id=' + h.objectID),
          points: h.points || 0,
          comments: h.num_comments || 0,
          author: h.author || '',
          at: h.created_at || '',
        })).filter((x) => x.title);
        return send(res, 200, { ok: true, q, count: items.length, items });
      } catch (error) {
        return send(res, 200, { ok: false, error: '热点获取失败：' + String((error && error.message) || error) });
      }
    }
    /* 邮箱配置（SMTP / IMAP）：只存本机，不回传密码明文 */
    if (u.pathname === '/api/life/mail') {
      const file = path.join(applicationDataRoot(), 'life-mail.json');
      const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; } };
      if (req.method === 'GET') {
        const cfg = read();
        const safe = {};
        Object.keys(cfg || {}).forEach((k) => {
          const v = cfg[k] || {};
          safe[k] = { host: v.host || '', port: v.port || '', user: v.user || '', hasPass: !!v.pass, imapHost: v.imapHost || '', imapPort: v.imapPort || '' };
        });
        return send(res, 200, { ok: true, accounts: safe });
      }
      if (req.method === 'POST') {
        try {
          const body = await readBody(req, 1e6);
          const cur = read();
          const next = Object.assign({}, cur);
          const accounts = (body && body.accounts) || {};
          /* ⚠️ 字段**没提供**就沿用旧值，提供了才覆盖 ——
             以前一律 `String(inc.x || '')` ✗，只对密码做了保护，
             所以一个「只改 host」的部分 POST 会把 user / imapHost 全清空 ✗（真踩过：把用户邮箱账号清掉了）。
             现在用 pick：undefined = 没提供（沿用旧值）；给了空串 = 用户主动清空 ✓。 */
          const pick = (v, fallback) => (v === undefined || v === null ? String(fallback || '') : String(v));
          Object.keys(accounts).forEach((k) => {
            const inc = accounts[k] || {};
            const old = cur[k] || {};
            next[k] = {
              host: pick(inc.host, old.host).slice(0, 120),
              port: pick(inc.port, old.port).slice(0, 8),
              user: pick(inc.user, old.user).slice(0, 200),
              /* 密码留空 = 不改（避免前端拿不到明文又被清掉） */
              pass: inc.pass ? String(inc.pass).slice(0, 200) : (old.pass || ''),
              imapHost: pick(inc.imapHost, old.imapHost).slice(0, 120),
              imapPort: pick(inc.imapPort, old.imapPort).slice(0, 8),
            };
          });
          try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (_) {}
          fs.writeFileSync(file, JSON.stringify(next, null, 2));
          return send(res, 200, { ok: true });
        } catch (error) {
          return send(res, 400, { ok: false, error: String((error && error.message) || error) });
        }
      }
    }
    /* 邮箱：测试连接 / 发信。
       ⚠️ 密码**不回传前端**，所以这里由服务端从 life-mail.json 里取 ✓；
          请求里带了 account 就用它覆盖（前端刚改还没保存时用得上 ✓），
          但它没有 pass 时仍然回落到已存的密码 ✓。 */
    if (u.pathname === '/api/life/mail/test' || u.pathname === '/api/life/mail/send') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
      try {
        const body = await readBody(req, 1e6);
        const key = String((body && body.key) || '').trim();
        const file = path.join(applicationDataRoot(), 'life-mail.json');
        let stored = {};
        try { stored = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
        const base = (key && stored[key]) || {};
        const inc = (body && body.account) || {};
        const account = {
          host: String(inc.host || base.host || '').trim(),
          port: String(inc.port || base.port || '').trim(),
          user: String(inc.user || base.user || '').trim(),
          pass: inc.pass ? String(inc.pass) : String(base.pass || ''),
          imapHost: String(inc.imapHost || base.imapHost || '').trim(),
          imapPort: String(inc.imapPort || base.imapPort || '').trim(),
        };
        if (u.pathname === '/api/life/mail/test') {
          return send(res, 200, await MAIL_CLIENT.testConnection(account));
        }
        const to = String((body && body.to) || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
        return send(res, 200, await MAIL_CLIENT.sendMail(account, {
          to,
          subject: String((body && body.subject) || ''),
          body: String((body && body.body) || ''),
          fromName: String((body && body.fromName) || ''),
        }));
      } catch (error) {
        return send(res, 400, { ok: false, error: String((error && error.message) || error) });
      }
    }
    /* ══ 邮箱收信（IMAP）：查阅 / 管理 ══════════════════════════════════
       ⚠️ 密码只在服务端（life-mail.json）里读 ✓，前端只传账号 key ✓。
       为什么要缓存：每次请求都新建一条 TLS 连接要 1~3 秒 ✗，
       顶栏那个未读数还会定时轮询 ✗ —— 不缓存会把邮箱服务器打爆 ✗。 */
    if (u.pathname === '/api/life/mail/status' || u.pathname === '/api/life/mail/boxes' ||
        u.pathname === '/api/life/mail/list' || u.pathname === '/api/life/mail/read' ||
        u.pathname === '/api/life/mail/part' || u.pathname === '/api/life/mail/flag' ||
        u.pathname === '/api/life/mail/move' || u.pathname === '/api/life/mail/newbox' ||
        u.pathname === '/api/life/mail/delbox' || u.pathname === '/api/life/weread/shelf' ||
        u.pathname === '/api/life/en/fetch' || u.pathname === '/api/life/en/sources' ||
        u.pathname === '/api/life/flow/run' || u.pathname === '/api/life/trends') {
      const readCfg = () => {
        try { return JSON.parse(fs.readFileSync(path.join(applicationDataRoot(), 'life-mail.json'), 'utf8')) || {}; } catch (_) { return {}; }
      };
      const accountOf = (key) => {
        const raw = readCfg()[key];
        if (!raw) return null;
        return {
          host: String(raw.host || '').trim(), port: String(raw.port || '').trim(),
          user: String(raw.user || '').trim(), pass: String(raw.pass || ''),
          imapHost: String(raw.imapHost || '').trim(), imapPort: String(raw.imapPort || '').trim(),
        };
      };
      const cacheGet = (map, cacheKey, ttl) => {
        const hit = map.get(cacheKey);
        if (hit && Date.now() - hit.at < ttl) return hit.data;
        return null;
      };
      const cacheSet = (map, cacheKey, data) => {
        map.set(cacheKey, { at: Date.now(), data });
        if (map.size > 40) map.delete(map.keys().next().value);
        return data;
      };
      const needKey = () => String(u.searchParams.get('key') || '').trim();
      /* ⚠️ `/flag` 是 POST，账号 key 在**请求体**里 ✗ 不在 query ✗ ——
         以前只从 query 取 → 永远取不到 key → 报「没有这个邮箱账号」✗（实测踩过）。
         所以先把 body 读出来，key / box 都允许从 body 覆盖 ✓。 */
      let postBody = null;
      if (u.pathname === '/api/life/mail/flag' || u.pathname === '/api/life/mail/move'
        || u.pathname === '/api/life/mail/newbox' || u.pathname === '/api/life/mail/delbox'
        || u.pathname === '/api/life/weread/shelf' || u.pathname === '/api/life/en/fetch'
        || u.pathname === '/api/life/flow/run') {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
        try { postBody = await readBody(req, 1e5); } catch (_) { postBody = {}; }
      }

      try {
        /* ── 未读数（顶栏用）── */
        if (u.pathname === '/api/life/mail/status') {
          const force = u.searchParams.get('force') === '1';
          if (!force) {
            const cached = cacheGet(MAIL_STATUS_CACHE, 'all', MAIL_STATUS_TTL);
            if (cached) return send(res, 200, cached);
          }
          const cfg = readCfg();
          const keys = Object.keys(cfg).filter((k) => {
            const a = cfg[k] || {};
            return String(a.imapHost || '').trim() && String(a.user || '').trim() && String(a.pass || '').trim();
          });
          const results = await Promise.all(keys.map(async (k) => {
            const account = accountOf(k);
            /* ★ 负缓存：最近失败过的账号直接返回上次的错误 ✓ ——
               不再每次刷新都去撞一次（本机连 gmail 要等 TCP 超时 5~15 秒 ✗），
               否则一个坏账号会把整个 /status 拖垮 ✗。force=1 时仍然真去试一次 ✓。 */
            const failed = MAIL_FAIL_CACHE.get(k);
            if (!force && failed && Date.now() - failed.at < MAIL_FAIL_TTL) {
              return { key: k, user: account.user, ok: false, unseen: 0, messages: 0, latest: null, error: failed.error, cached: true };
            }
            const r = await MAIL_IMAP.withSession(account, async (s) => {
              const st = await s.status('INBOX');
              let latest = null;
              if (st.unseen > 0) {
                await s.select('INBOX');
                const unseen = await s.search('UNSEEN');
                if (unseen.length) {
                  const hs = await s.fetchHeaders([unseen[unseen.length - 1]], ['FROM', 'SUBJECT', 'DATE']);
                  if (hs.length) {
                    const H = MAIL_MIME.parseHeaders(hs[0].headerRaw);
                    latest = {
                      uid: hs[0].uid,
                      subject: MAIL_MIME.decodeHeader(H.subject) || '(无主题)',
                      from: MAIL_MIME.decodeHeader(H.from),
                      date: MAIL_MIME.parseMessage(hs[0].headerRaw).date || 0,
                    };
                  }
                }
              }
              return { unseen: st.unseen, messages: st.messages, latest };
            }, { timeout: 10000 });
            /* 同上：只有连接级失败才记 ✗（status 里失败基本都是连接问题 ✓，
               但也可能是命令级，所以一样要判一下 ✓）*/
            if (r.ok) MAIL_FAIL_CACHE.delete(k);
            else if (/^(connect|socket|timeout|auth|greeting|starttls)$/.test(String(r.step || ''))) {
              MAIL_FAIL_CACHE.set(k, { at: Date.now(), error: r.error || '连接失败' });
            }
            return {
              key: k, user: account.user,
              ok: !!r.ok,
              unseen: r.ok ? r.unseen : 0,
              messages: r.ok ? r.messages : 0,
              latest: r.ok ? r.latest : null,
              error: r.ok ? '' : (r.error || '连接失败'),
            };
          }));
          const total = results.reduce((n, x) => n + (x.unseen || 0), 0);
          return send(res, 200, cacheSet(MAIL_STATUS_CACHE, 'all', { ok: true, total, accounts: results, at: Date.now() }));
        }

        /* 后面几条都要指定账号 ✓ */
        const key = needKey() || String((postBody && postBody.key) || '').trim();
    /* ★ 微信读书同步**不需要邮箱账号** ✗ —— 必须放在账号解析**之前** ✓，
       否则会被那句「没有这个邮箱账号」直接挡掉 ✗（实测踩过 ✗）。 */
        if (u.pathname === '/api/life/weread/shelf') {
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
          /* ⚠️ 变量名**不能叫 key** ✗✗ —— 外面那个 `key` 是**邮箱账号**的 key ✗
             （见上面 `const key = needKey() || …` ✗），
             重名会把「邮箱」和「微信读书」两条路搅在一起 ✗。 */
          const apiKey = String((postBody && postBody.key) || '')
            .replace(/^\s*authorization\s*[:：]\s*/i, '')
            .replace(/^\s*bearer\s+/i, '')
            .replace(/[\r\n\t]+/g, '')
            .replace(/^\s*["'`]+|["'`]+\s*$/g, '')
            .replace(/\s+/g, '')
            .trim();
          /* ★ 用户十有八九会把 DevTools 里那一整行「Cookie: xxx」原样粘进来 ✓ ——
             那就**替他把前缀剥掉** ✓，别直接甩一句「格式不对」✗（那是我们该干的活 ✗）。 */
          const cookie = String((postBody && postBody.cookie) || '')
            .replace(/^\s*cookie\s*[:：]\s*/i, '')
            .replace(/[\r\n]+/g, ' ')
            .replace(/^\s*["']+|["']+\s*$/g, '')
            .trim();
          /* ★★ 官方 Key **优先** ✓ —— 它稳定 ✓、字段全 ✓、
             而且**不会因为网页版登出而失效** ✗（用户这次就是撞上网页登录过期 ✗，
             拿 Cookie 这条路怎么重试都没用 ✗）。Cookie 留着当兜底 ✓。 */
          if (apiKey) return send(res, 200, await wereadByKey(apiKey));
          if (!cookie) {
            return send(res, 200, { ok: false, error: '没有填 API Key（也没有 Cookie）—— 推荐用官方 API Key ✓' });
          }
          if (cookie.length > 8000) return send(res, 200, { ok: false, error: 'Cookie 太长（超过 8000 字符）—— 只要「Cookie:」那一行' });
          if (cookie.indexOf('=') < 0) return send(res, 200, { ok: false, error: '看起来不是 Cookie（里面没有 = ）—— 应该像 wr_vid=123; wr_skey=abc' });
          return send(res, 200, await wereadByCookie(cookie));
        }

        /* ── 外刊精读：从链接抽正文 ✓ ─────────────────────────────────────────
           ⚠️ 只抓**用户自己给的那一个 URL** ✗ —— 不做爬虫 ✗、不批量抓 ✗、不落盘 ✗。
           ⚠️ 「抽正文」是**纯函数** ✓（`lib/en-text.js` 的 extractArticle ✓）——
              所以它能拿**真实网页**当样本单测 ✓（`tests/en-text.js` ✓），
              也能在这里只当个薄薄的 IO 壳 ✓。
           ⚠️ 实测过（这台机器上 ✓）：
              ✓ NPR / Aeon 抓得到、而且抽得干净 ✓
              ✗ BBC / Guardian / VOA Learning English / The Conversation **连不通** ✗
              → 所以**别做「一键订阅外刊」** ✗，让用户自己贴链接 / 贴正文 ✓
                （贴正文这条路**一定可用** ✓，永远留着 ✓）。 */
        /* ── 外刊精读：推荐外刊源 ✓ ────────────────────────────────────────
           ★ 为什么要有这个 ✗：用户原话「自行帮我抓取热门的，和别人开源的外刊资源等等」✓ ——
             外刊精读**一进来是空的** ✗（要用户自己找链接、自己贴 ✗），
             等于「功能做完了但用不起来」✗。
           ⚠️ 只做**只读**拉取 ✗：不登录 ✓、不带用户 Cookie ✓、不写任何东西 ✓。
           ⚠️ 源是**实测过的** ✓（feed 通 ✓ **并且**文章正文抽得出来 ✓ ——
              只测 feed 不够 ✗，Phys.org / Ars Technica / Knowable 就是 feed 正常但文章 403/405 ✗）。
           ⚠️ 每源有 TTL 缓存 ✓（15~60 分钟 ✓）—— 不然用户点几下就把人家打一遍 ✗。
           ⚠️ **一次只拉用户点的那一个源** ✓（不像热榜那样一次全拉 ✗）——
              20 多个源并发会把首屏拖到十几秒 ✗，而用户一次只看一个 ✓。 */
        if (u.pathname === '/api/life/en/sources') {
          const srcParam = String(u.searchParams.get('sources') || '').trim();
          const keys = srcParam ? srcParam.split(',').map((x) => x.trim()).filter(Boolean) : null;
          if (keys && keys.length > 8) return send(res, 200, { ok: false, error: '一次最多拉 8 个源' });
          /* 不带 sources → 只回目录 ✓（前端自己也有这份 ✓，但留一个服务端口子方便排查 ✓） */
          if (!keys) {
            return send(res, 200, {
              ok: true, at: Date.now(),
              sources: EN_SOURCES.catalog(), groups: EN_SOURCES.GROUPS,
              osResources: EN_SOURCES.OS_RESOURCES, results: [],
            });
          }
          try {
            const r = await EN_SOURCES.fetchMany(keys, { fetch: feedFetch, timeoutMs: 25000, force: u.searchParams.get('force') === '1' });
            return send(res, 200, r);
          } catch (error) {
            return send(res, 200, { ok: false, error: String((error && error.message) || error) });
          }
        }

        if (u.pathname === '/api/life/en/fetch') {
          const url = String((postBody && postBody.url) || '').trim();
          if (!/^https?:\/\//i.test(url)) return send(res, 200, { ok: false, error: '链接要 http:// 或 https:// 开头' });
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 15000);
            let up;
            try {
              up = await fetch(url, {
                redirect: 'follow',
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
                  'Accept': 'text/html,application/xhtml+xml',
                  'Accept-Language': 'en-US,en;q=0.9',
                },
                signal: ctrl.signal,
              });
            } finally { clearTimeout(timer); }
            if (!up.ok) {
              return send(res, 200, {
                ok: false,
                error: '这一页抓不动（HTTP ' + up.status + '）—— 可能要登录、或者有付费墙。直接复制正文粘进来更快 ✓',
              });
            }
            /* 限一下大小 ✓ —— 有些页面是整站渲染的几 MB ✗，白读一遍没意义 ✗ */
            const html = (await up.text()).slice(0, 2e6);
            return send(res, 200, EN_TEXT.extractArticle(html, url));
          } catch (error) {
            const why = String((error && error.message) || error);
            if (/abort/i.test(why)) return send(res, 200, { ok: false, error: '抓这一页超时（网络不通？）' });
            /* ⚠️ 裸的「fetch failed」对用户毫无信息量 ✗ —— 翻译一句人话 ✓ */
            if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|socket hang up|certificate|self.signed/i.test(why)) {
              return send(res, 200, { ok: false, error: '连不上这个站（网络不通，或者它挡了本机）—— 直接复制正文粘进来更快 ✓' });
            }
            return send(res, 200, { ok: false, error: '抓不到这一页：' + why });
          }
        }

        /* ── 热榜聚合 ✓（参考 TrendRadar 那类开源项目的思路）────────────────
           ⚠️ 只做**只读**拉取 ✗：不登录 ✓、不带用户 Cookie ✓、不写任何东西 ✓。
           ⚠️ 下面每个源都在本机**逐个实测过** ✓（见 lib/hot.js 顶部注释 ✓）——
              拿不到的（知乎 403 / V2EX、vvhan 连不通 / 36氪 500 ✗）**一个都没塞进来** ✗。
           ⚠️ 单源失败**不影响别的源** ✓（前端会逐源显示错误 ✓）。
           ⚠️ 有 TTL 缓存 ✓（各源 10~30 分钟不等 ✓）—— 不然每次刷新都把人家打一遍 ✗。 */
        /* ⚠️ 路径**不能叫 /api/life/hot** ✗ —— 那个已经被「研究方向」页的
           科研热点搜索占了 ✗（HN Algolia 按关键词搜 ✓）。撞名的话我这条永远进不来 ✗
           （实测：返回了老接口的 `{ok:true,count:…}` ✗，白折腾一轮 ✗）。 */
        if (u.pathname === '/api/life/trends') {
          const srcParam = String(u.searchParams.get('sources') || '').trim();
          const keys = srcParam ? srcParam.split(',').map((x) => x.trim()).filter(Boolean) : null;
          const force = u.searchParams.get('force') === '1';
          if (keys && keys.length > 30) return send(res, 200, { ok: false, error: '源太多' });
          try {
            const r = await HOT.fetchMany(keys, { fetch, force, timeoutMs: 20000 });
            return send(res, 200, r);
          } catch (error) {
            return send(res, 200, { ok: false, error: String((error && error.message) || error) });
          }
        }

        /* ── 工作流执行 ✓（参考 n8n 的节点图）──────────────────────────────
           ⚠️ **输出类节点不在这里落地** ✗ —— 引擎只回 `effects` ✓，
              由前端去写 STORE ✓（STORE 归前端管 ✓）。这样引擎是纯的 ✓，
              可单测 ✓，也不会偷偷改用户数据 ✗。
           ⚠️ AI 节点的配置由**前端随请求带上来** ✓（和 /api/ai/chat 一样 ✓），
              服务端不存 Key ✓、不打日志 ✓。
           ⚠️ 节点数 / 单次运行时长都要有上限 ✗ —— 不然一张大图能把服务挂住 ✗。 */
        if (u.pathname === '/api/life/flow/run') {
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
          const graph = (postBody && postBody.graph) || null;
          const ai = (postBody && postBody.ai) || null;
          if (!graph || !Array.isArray(graph.nodes)) return send(res, 200, { ok: false, error: '没有拿到工作流图' });
          if (graph.nodes.length > 200) return send(res, 200, { ok: false, error: '节点太多（上限 200 个）' });
          if (Array.isArray(graph.edges) && graph.edges.length > 600) return send(res, 200, { ok: false, error: '连线太多（上限 600 条）' });
          const aiCfg = ai && ai.url && ai.model ? {
            url: String(ai.url).trim().slice(0, 2048),
            key: String(ai.key || '').slice(0, 10000),
            model: String(ai.model).trim().slice(0, 200),
          } : null;
          const aiChat = async (cfg, messages) => {
            const resp = await fetch(cfg.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
              body: JSON.stringify({ model: cfg.model, messages, stream: false, temperature: 0.3 }),
              signal: AbortSignal.timeout(120000),
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error('AI 返回 ' + resp.status + '：' + text.slice(0, 240));
            let data = null;
            try { data = JSON.parse(text); } catch (_) { throw new Error('AI 返回的不是 JSON'); }
            const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (typeof content !== 'string') throw new Error('AI 响应里没有 choices[0].message.content');
            return content;
          };
          /* ★★ 流式返回 ✓（`?stream=1`）—— 用户原话：「执行，也没有执行到哪的显示」✓。
             一次跑十几秒（AI 节点 30 秒 ✗）而界面一动不动 ✗，用户只能干等 ✗。
             → 边跑边用 **NDJSON**（一行一个 JSON ✓）往前推 ✓：
                 {"t":"start","id":"n3"}      轮到哪个节点了 ✓
                 {"t":"step","step":{…}}      这个节点跑完了（成功/失败/跳过 ✓）
                 {"t":"done","ok":true,…}     整张图跑完了 ✓
             为什么不用 SSE ✗：`EventSource` 只能发 GET ✗，而图是 POST 上来的 ✓；
             `fetch` + `ReadableStream` 读 NDJSON 一样简单 ✓，还不用多开一个接口 ✓。 */
          const wantStream = String(u.searchParams.get('stream') || '') === '1';
          let streamed = false;
          const writeLine = wantStream ? (o) => {
            if (!streamed) {
              streamed = true;
              res.writeHead(200, {
                'content-type': 'application/x-ndjson; charset=utf-8',
                'cache-control': 'no-cache',
                'connection': 'keep-alive',
                'x-accel-buffering': 'no',     /* ⚠️ 有反向代理时**必须**加这个 ✗，不然会被攒着不发 ✗ */
              });
            }
            try { res.write(JSON.stringify(o) + '\n'); } catch (_) {}
          } : null;
          try {
            const r = await WORKFLOW.runFlow(graph, {
              ai: aiCfg, aiChat, fetch: fetch, now: Date.now(),
              /* ★ 表达式里要用到这几个 ✓（`$workflow.name` / `$execution.id` ✓）——
                 不传的话用户写 `{{ $workflow.name }}` 会得到空串 ✗。 */
              workflowName: String((postBody && postBody.flowName) || '').slice(0, 120),
              workflowId: String((postBody && postBody.flowId) || '').slice(0, 60),
              executionId: 'e' + Date.now().toString(36),
              onNodeStart: writeLine ? ((node) => writeLine({ t: 'start', id: node.id, type: node.type })) : null,
              /* ⚠️ 每一步的输出也要截断 ✗ —— 推流里塞几十 MB 会把前端卡死 ✗ */
              onStep: writeLine ? ((st) => writeLine({ t: 'step', step: Object.assign({}, st, { out: trimFlowOut(st.out) }) })) : null,
            });
            /* ⚠️ `vars` 可能是几十 MB ✗（比如 HTTP 抓了一大坨 ✓）——
               全塞回前端会把面板卡住 ✗。这里按**每个节点**截断 ✓，
               够前端显示「这一步输出长什么样」就行 ✓。 */
            const vars = {};
            Object.keys(r.vars || {}).forEach((k) => { vars[k] = trimFlowOut(r.vars[k]); });
            const payload = {
              ok: true, steps: r.steps, effects: r.effects, vars,
              ms: r.ms, startedAt: r.startedAt, finishedAt: r.finishedAt,
            };
            if (writeLine) { writeLine(Object.assign({ t: 'done' }, payload)); return res.end(); }
            return send(res, 200, payload);
          } catch (error) {
            const fail = {
              ok: false,
              error: String((error && error.message) || error),
              nodeId: (error && error.nodeId) || '',
              steps: (error && error.steps) || [],
              effects: [],
            };
            if (writeLine) { writeLine(Object.assign({ t: 'done' }, fail)); return res.end(); }
            return send(res, 200, fail);
          }
        }

        const account = key ? accountOf(key) : null;
        if (!account) return send(res, 200, { ok: false, error: '没有这个邮箱账号（先去「配置」里保存一个）' });
        if (!account.imapHost) return send(res, 200, { ok: false, error: '这个账号没填 IMAP 服务器，收信需要它' });
        if (!account.pass) return send(res, 200, { ok: false, error: '这个账号没存授权码 / 密码' });
        const box = String(u.searchParams.get('box') || (postBody && postBody.box) || 'INBOX').trim() || 'INBOX';
        /* ★ 已知连不上的账号**快速失败** ✓ ——
           负缓存原来只加在 /status 上 ✗，于是点一个连不上的账号（比如本机到 gmail）
           还要为「看一条错误提示」等 2 秒 ✗。现在所有邮件接口都快速返回同样的错误 ✓；
           显式带 force=1（点「重新收信」）时才真的去试一次 ✓。 */
        const wantForce = u.searchParams.get('force') === '1' || !!(postBody && postBody.force);
        const knownBad = MAIL_FAIL_CACHE.get(key);
        if (!wantForce && knownBad && Date.now() - knownBad.at < MAIL_FAIL_TTL) {
          return send(res, 200, { ok: false, error: knownBad.error, cached: true });
        }
        /* ★★ 只有**连接 / 认证**级别的失败才记进负缓存 ✗✗ ——
           命令级失败（「文件夹不存在」「邮件不存在」「文件夹非空」…）是**正常的业务错误** ✓，
           记进去会让整个账号在 5 分钟内**所有**请求都返回那句陈旧错误 ✗✗
           （实测踩过：删一个不存在的文件夹之后，后面建文件夹、移邮件、删文件夹
            全都报「IMAP DELETE 失败：Folder not exist」✗，看起来像整个邮箱坏了 ✗）。
           成功就清掉负缓存 ✓（用户修好网络后立刻恢复 ✓）。 */
        const CONN_STEP = /^(connect|socket|timeout|auth|greeting|starttls)$/;
        const markFail = (r) => {
          if (!r) return r;
          if (r.ok) { MAIL_FAIL_CACHE.delete(key); return r; }
          if (CONN_STEP.test(String(r.step || ''))) MAIL_FAIL_CACHE.set(key, { at: Date.now(), error: r.error || '连接失败' });
          return r;
        };

        /* ── 文件夹列表 ── */
        if (u.pathname === '/api/life/mail/boxes') {
          const cacheKey = 'boxes:' + key;
          const cached = cacheGet(MAIL_LIST_CACHE, cacheKey, MAIL_LIST_TTL);
          if (cached) return send(res, 200, cached);
          const r = markFail(await MAIL_IMAP.withSession(account, async (s) => {
            const boxes = await s.listBoxes();
            const inbox = await s.status('INBOX');
            return { boxes, inbox };
          }, { timeout: 20000 }));
          if (!r.ok) return send(res, 200, { ok: false, error: r.error });
          return send(res, 200, cacheSet(MAIL_LIST_CACHE, cacheKey, { ok: true, boxes: r.boxes, inbox: r.inbox }));
        }

        /* ── 邮件列表 ── */
        if (u.pathname === '/api/life/mail/list') {
          const limit = Math.min(80, Math.max(5, Number(u.searchParams.get('limit')) || 30));
          const onlyUnread = u.searchParams.get('unread') === '1';
          const onlyFlagged = u.searchParams.get('flagged') === '1';
          const cacheKey = ['list', key, box, limit, onlyUnread ? 1 : 0, onlyFlagged ? 1 : 0].join(':');
          const cached = cacheGet(MAIL_LIST_CACHE, cacheKey, MAIL_LIST_TTL);
          if (cached) return send(res, 200, cached);
          const r = markFail(await MAIL_IMAP.withSession(account, async (s) => {
            await s.select(box);
            const uids = await s.search(onlyUnread ? 'UNSEEN' : (onlyFlagged ? 'FLAGGED' : 'ALL'));
            const st = await s.status(box);
            /* 取最新的 limit 封 → 倒序（新的在前）✓ */
            const pick = uids.slice(-limit).reverse();
            /* ⚠️ 只取列表**真正要显示**的字段 ✗（TO / MESSAGE-ID 列表里用不到 ✓）；
               不过实测瓶颈是服务端**每封**的处理成本（INBOX ~10ms/封、Sent ~53ms/封 ✗），
               所以真正的解法是前端分批取（见 MAIL_UI.limit）✓。 */
            const heads = await s.fetchHeaders(pick, ['FROM', 'SUBJECT', 'DATE']);
            /* ⚠️ 区间检索（`1:*`）会把**已经删掉的旧 UID** 也带回来 ✗ ——
               实测 2925：`UID SEARCH 1:*` 回 **85** 个，而 `STATUS` 说只有 **71** 封 ✗。
               这些 UID 去 FETCH 是**没有响应**的 ✓，以前会给它们各生成一行
               「(无主题)」的空邮件 ✗，列表里看着像坏掉了 ✗。
               组装逻辑（含「不能无条件丢」那条）抽到 `lib/mail-list.js` 了 ✓ ——
               留在路由里根本单测不到 ✗。 */
            const mails = MAIL_LIST.buildMailRows(pick, heads, MAIL_MIME);
            return { box, total: st.messages, unseen: st.unseen, mails };
          }, { timeout: 30000 }));
          if (!r.ok) return send(res, 200, { ok: false, error: r.error });
          return send(res, 200, cacheSet(MAIL_LIST_CACHE, cacheKey, {
            ok: true, box: r.box, total: r.total, unseen: r.unseen, mails: r.mails,
          }));
        }

        /* ── 读一封（默认顺手标记已读 ✓，和所有邮件客户端一致）── */
        if (u.pathname === '/api/life/mail/read') {
          const uid = Number(u.searchParams.get('uid'));
          if (!uid) return send(res, 200, { ok: false, error: '缺少 uid' });
          const markRead = u.searchParams.get('markRead') !== '0';
          const r = markFail(await MAIL_IMAP.withSession(account, async (s) => {
            await s.select(box);
            const full = await s.fetchFull(uid);
            const msg = MAIL_MIME.parseMessage(full.raw);
            let seen = full.flags.includes('\\Seen');
            if (markRead && !seen) {
              try { await s.store(uid, 'add', ['\\Seen']); seen = true; } catch (_) { }
            }
            /* ★ 内嵌图片（正文里 `cid:xxx` 引用的）要转成 data URL 一起回传 ✓ ——
               不然邮件里所有插图都是破图 ✗（浏览器不认 `cid:` 协议 ✗）。
               ⚠️ 必须有**总量上限** ✗：有些营销邮件内嵌几十张图，
                  不限的话一次响应能到几十 MB ✗，面板直接卡死 ✗。
                  超过上限的就不带，前端会显示成「图片未加载」✓。 */
            const attIndex = new Set(msg.attachments.map((a) => a.index));
            const inline = [];
            let inlineBytes = 0;
            for (const p of msg.parts) {
              if (!p.cid || attIndex.has(p.index)) continue;
              if (!/^image\//i.test(p.type)) continue;
              if (inlineBytes + p.size > 3e6) continue;
              inlineBytes += p.size;
              inline.push({ cid: p.cid, type: p.type, dataUrl: 'data:' + p.type + ';base64,' + p.data.toString('base64') });
            }
            return {
              uid, box, seen,
              flagged: full.flags.includes('\\Flagged'),
              subject: msg.subject, from: msg.from, to: msg.to, cc: msg.cc,
              date: msg.date, text: msg.text, html: msg.html,
              attachments: msg.attachments, inline, size: full.raw.length,
            };
          }, { timeout: 30000 }));
          if (!r.ok) return send(res, 200, { ok: false, error: r.error });
          MAIL_LIST_CACHE.clear();          /* 已读状态变了 → 列表缓存作废 ✓ */
          MAIL_STATUS_CACHE.clear();
          return send(res, 200, r);
        }

        /* ── 附件下载：重新取整封，按**和阅读页完全一致**的叶子序号切 ✓
           （不用 `BODY[n]` —— IMAP 的部件编号（1.2 这种）和我们 DFS 得到的序号
             在嵌套 multipart 下不一定对得上 ✗，取错了会静默给一个错文件 ✗）*/
        if (u.pathname === '/api/life/mail/part') {
          const uid = Number(u.searchParams.get('uid'));
          const n = Number(u.searchParams.get('n'));
          if (!uid || !Number.isInteger(n) || n < 0) return send(res, 200, { ok: false, error: '参数不对' });
          const r = markFail(await MAIL_IMAP.withSession(account, async (s) => {
            await s.select(box);
            const full = await s.fetchFull(uid);
            const msg = MAIL_MIME.parseMessage(full.raw);
            const att = msg.attachments[n];
            if (!att) return { missing: true };
            const leaf = msg.parts[att.index];
            return { name: att.name, type: att.type, data: leaf ? leaf.data : Buffer.alloc(0) };
          }, { timeout: 40000 }));
          if (!r.ok) return send(res, 200, { ok: false, error: r.error });
          if (r.missing || !r.data) return send(res, 200, { ok: false, error: '这封邮件里没有这个附件' });
          /* ⚠️ 附件名可能含中文/引号 ✗ —— 用 RFC 5987 的 `filename*=UTF-8''…` ✓，
             直接塞进 filename= 会被浏览器截断或乱码 ✗ */
          const asciiName = String(r.name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
          res.writeHead(200, {
            'Content-Type': r.type || 'application/octet-stream',
            'Content-Length': r.data.length,
            'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(r.name)}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(r.data);
          return true;
        }

        /* ── 标记已读 / 未读 / 删除 ── */
        if (u.pathname === '/api/life/mail/flag') {
          const uid = Number(postBody && postBody.uid);
          const action = String((postBody && postBody.action) || '').trim();
          /* `readall` 是整箱操作，不需要 uid ✓ */
          if (!uid && action !== 'readall') return send(res, 200, { ok: false, error: '缺少 uid' });
          const r = markFail(await MAIL_IMAP.withSession(account, async (s) => {
            await s.select(box);
            /* ⚠️ `UID STORE 1:*` 是「全部」的意思 ✓（不是 UID=1）——
               用来做「整个文件夹标为已读」✓。 */
            if (action === 'readall') { await s.store('1:*', 'add', ['\\Seen']); return { action, all: true }; }
            if (action === 'delete') await s.remove(uid);
            else if (action === 'read') await s.store(uid, 'add', ['\\Seen']);
            else if (action === 'unread') await s.store(uid, 'remove', ['\\Seen']);
            /* ⭐ 重要 = IMAP 的 \Flagged ✓（所有客户端通用，Outlook/Apple Mail 都能看见 ✓）*/
            else if (action === 'flag') await s.store(uid, 'add', ['\\Flagged']);
            else if (action === 'unflag') await s.store(uid, 'remove', ['\\Flagged']);
            else throw new Error('不认识的操作：' + action);
            return { uid, action };
          }, { timeout: 25000 }));
          if (!r.ok) return send(res, 200, { ok: false, error: r.error });
          MAIL_LIST_CACHE.clear();
          MAIL_STATUS_CACHE.clear();
          return send(res, 200, r);
        }

        /* ── 分类管理：把邮件移到另一个文件夹 ✓ ──────────────────────────
           用 **UID MOVE**（原子 ✓）—— 不会出现「复制成功、删除失败」导致邮件重复 ✗。
           移动是**可撤销**的 ✓（移回去就行 ✓），前端会记住原文件夹 ✓。 */
        if (u.pathname === '/api/life/mail/move') {
          const uid = Number(postBody && postBody.uid);
          const to = String((postBody && postBody.to) || '').trim();
          if (!uid) return send(res, 200, { ok: false, error: '缺少 uid' });
          if (!to) return send(res, 200, { ok: false, error: '没有指定目标文件夹' });
          if (to === box) return send(res, 200, { ok: false, error: '已经在这个文件夹里了' });
          const r = markFail(await MAIL_IMAP.withSession(account, async (s) => {
            await s.select(box);
            /* ★ 移动后邮件在**目标文件夹里是一个新 UID** ✗（UID 是按文件夹分配的 ✓），
               而「撤销」要用新 UID 才能移回来 ✗。
               RFC 6851 说服务器应当回 `[COPYUID ...]` 给出新 UID，
               但**实测 QQ 不回** ✗（只回 `OK MOVE Done` ✗）→
               退而求其次：先记下 Message-ID，移完到目标文件夹里按它回查 ✓
               （`UID SEARCH HEADER Message-ID` ✓ 精确可靠 ✓）。 */
            /* 先记下源邮件的主题（兜底匹配用 ✓）和**目标文件夹的 UID 快照** ✓ */
            const heads = await s.fetchHeaders([uid], ['SUBJECT', 'MESSAGE-ID']).catch(() => []);
            const H = heads.length ? MAIL_MIME.parseHeaders(heads[0].headerRaw) : {};
            const subj = MAIL_MIME.decodeHeader(H.subject) || '';
            let before = [];
            try { await s.select(to); before = await s.search('ALL'); } catch (_) { }
            await s.select(box);
            const res2 = await s.move(uid, to);
            /* ① 服务器给了 COPYUID 就直接用 ✓（RFC 6851 ✓，最省事）*/
            const m = /\[COPYUID\s+\d+\s+[\d,:]+\s+([\d,:]+)\]/i.exec(String(res2 && res2.text || ''));
            let newUid = m ? Number(String(m[1]).split(',')[0]) : 0;
            /* ② ★ 实测 QQ **不回 COPYUID** ✗，而且**不支持 `HEADER` 搜索** ✗
                  （对一封确实存在的邮件 `UID SEARCH HEADER Message-ID "..."` 返回空 ✗）。
                  所以改用**快照比对** ✓：移动前后目标文件夹的 UID 差集，
                  就是这封邮件的新 UID ✓ —— 确定可靠 ✓。
                  （「撤销」必须用它 ✗，因为 UID 是**按文件夹分配**的：
                    移过去之后原 UID 就失效了 ✗）*/
            if (!newUid) {
              try {
                await s.select(to);
                const after = await s.search('ALL');
                const seen = new Set(before);
                let added = after.filter((x) => !seen.has(x));
                if (added.length > 1 && subj) {
                  /* 极少数：期间又来了新邮件 ✗ → 按主题挑 ✓ */
                  const hs = await s.fetchHeaders(added, ['SUBJECT']).catch(() => []);
                  const hit = hs.find((h) => (MAIL_MIME.decodeHeader(MAIL_MIME.parseHeaders(h.headerRaw).subject) || '') === subj);
                  added = hit ? [hit.uid] : added.slice(-1);
                }
                if (added.length === 1) newUid = added[0];
              } catch (_) { }
            }
            return { uid, from: box, to, newUid, subject: subj };
          }, { timeout: 30000 }));
          if (!r.ok) return send(res, 200, { ok: false, error: r.error });
          MAIL_LIST_CACHE.clear();
          MAIL_STATUS_CACHE.clear();
          return send(res, 200, r);
        }

        /* ── 新建文件夹（分类）✓ ────────────────────────────────────────
           ⚠️ 名字要走 modified UTF-7 ✗ —— 直接传 UTF-8 会被 QQ 拒 ✗
           （实测 `CREATE "中文名"` → `NO Invalid folder name` ✗）。 */
        if (u.pathname === '/api/life/mail/newbox') {
          const name = String((postBody && postBody.name) || '').trim().slice(0, 40);
          if (!name) return send(res, 200, { ok: false, error: '文件夹名不能为空' });
          const r = markFail(await MAIL_IMAP.withSession(account, async (s) => {
            await s.createBox(name);
            return { name };
          }, { timeout: 25000 }));
          if (!r.ok) {
            const hint = /already exists/i.test(String(r.error)) ? '（已经有同名的了）' : '';
            return send(res, 200, { ok: false, error: r.error + hint });
          }
          MAIL_LIST_CACHE.clear();
          return send(res, 200, r);
        }

        /* ── 删除文件夹 ✓ ──────────────────────────────────────────────
           IMAP 的 DELETE 只删**空文件夹** ✓，非空时服务器会拒绝 ✓
           —— 这个行为正好，能挡住误删 ✗。 */
        if (u.pathname === '/api/life/mail/delbox') {
          const name = String((postBody && postBody.name) || '').trim();
          if (!name) return send(res, 200, { ok: false, error: '缺少文件夹名' });
          const r = markFail(await MAIL_IMAP.withSession(account, async (s) => {
            await s.deleteBox(name);
            return { name };
          }, { timeout: 25000 }));
          if (!r.ok) {
            const msg = String(r.error || '');
            let hint = '';
            if (/not empty|NONEXISTENT|no such/i.test(msg)) hint = '（文件夹里还有邮件，先清空再删）';
            /* ★ 有些服务商**根本不支持用 IMAP 删文件夹** ✗✗ ——
               实测 2925（无限邮）：`DELETE` 永远回 `NO Server Error` ✗，
               连**刚建好的空文件夹**也删不掉 ✗（`RENAME` 同样失败 ✗，
               换引号 / 换编码 / 先 SELECT 别的箱 / 不带 UID 全试过 ✗）。
               原来的报错只有一句「IMAP DELETE 失败：a3 NO Server Error」✗，
               用户完全不知道该怎么办 ✗（会以为是本工具坏了 ✗）。 */
            else if (/server error|not support|not implement|unknown command|\bBAD\b/i.test(msg)) {
              hint = '（这个邮箱服务商可能不支持用 IMAP 删文件夹 —— 实测 2925/无限邮就是这样 ✗，'
                + '请到它的**网页版**里删）';
            }
            return send(res, 200, { ok: false, error: msg + hint });
          }
          MAIL_LIST_CACHE.clear();
          return send(res, 200, r);
        }

      } catch (error) {
        return send(res, 200, { ok: false, error: String((error && error.message) || error) });
      }
    }
    if (u.pathname === '/api/system-panel' || u.pathname.startsWith('/api/system-panel/')) {
      try {
        if (await SYSTEM_PANEL.handle(req, res, u)) return;
      } catch (error) {
        return send(res, 500, { ok:false, error:String((error && error.message) || error) });
      }
    }
    if (u.pathname === '/api/study/config') {
      if (req.method === 'GET') return send(res, 200, { ok:true, config:readStudyConfig() });
      if (req.method === 'POST') {
        try { return send(res, 200, { ok:true, config:saveStudyConfig(await readBody(req, 2 * 1024 * 1024)) }); }
        catch (error) { return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) }); }
      }
    }
    if (u.pathname === '/api/study/note') {
      const id = studySafeName(u.searchParams.get('id'));
      const file = studyNoteFile(id);
      if (!file) return send(res, 400, { ok:false, error:'笔记标识不合法' });
      if (req.method === 'GET') {
        try { return send(res, 200, { ok:true, id, content:fs.readFileSync(file, 'utf8') }); }
        catch (_) { return send(res, 200, { ok:true, id, content:'# 学习笔记\n\n' }); }
      }
      if (req.method === 'POST') {
        try {
          const body = await readBody(req, 9 * 1024 * 1024), content = String(body && body.content != null ? body.content : '');
          if (Buffer.byteLength(content) > 8 * 1024 * 1024) return send(res, 413, { ok:false, error:'笔记超过 8 MB' });
          fs.mkdirSync(path.dirname(file), { recursive:true });
          writeFileAtomicSync(file, content, 'utf8');
          return send(res, 200, { ok:true, id, size:Buffer.byteLength(content) });
        } catch (error) { return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) }); }
      }
    }
    if (u.pathname === '/api/study/asset') {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const name = studySafeName(u.searchParams.get('name')), file = studyAssetFile(name);
        if (!file) return send(res, 400, { ok:false, error:'学习图片路径不合法' });
        return streamStatic(req, res, path.dirname(file), path.basename(file), { cacheControl:'private, no-cache', notFound:'学习图片不存在' });
      }
      if (req.method === 'POST') {
        try {
          const type = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
          if (!['image/png','image/jpeg','image/webp'].includes(type)) return send(res, 415, { ok:false, error:'仅支持 PNG、JPEG 或 WebP 学习图片' });
          const body = await readRawBody(req, 12 * 1024 * 1024), ext = type === 'image/png' ? '.png' : (type === 'image/webp' ? '.webp' : '.jpg');
          if (!body.length) return send(res, 400, { ok:false, error:'学习图片内容为空' });
          if (!isStudyImage(body, type)) return send(res, 415, { ok:false, error:'学习图片内容与图片格式不匹配' });
          const name = 'frame-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + ext, file = studyAssetFile(name);
          fs.mkdirSync(path.dirname(file), { recursive:true });
          writeFileAtomicSync(file, body);
          const url = '/api/study/asset?name=' + encodeURIComponent(name), title = String(u.searchParams.get('title') || '视频帧').replace(/[\[\]]/g, '').slice(0, 80);
          return send(res, 200, { ok:true, name, url, markdown:'![' + title + '](' + url + ')' });
        } catch (error) { return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) }); }
      }
    }
    if (req.method === 'GET' && u.pathname === '/api/study/resolve-url') {
      const raw = String(u.searchParams.get('url') || '').trim();
      let parsed;
      try { parsed = new URL(raw); }
      catch (_) { return send(res, 400, { ok:false, error:'网址格式不正确' }); }
      const allowed = new Set(['b23.tv','www.bilibili.com','bilibili.com','m.bilibili.com','player.bilibili.com']);
      if (!allowed.has(parsed.hostname.toLowerCase())) return send(res, 200, { ok:true, url:parsed.toString() });
      try {
        if (parsed.hostname.toLowerCase() === 'b23.tv') {
          const response = await fetch(parsed, { method:'HEAD', redirect:'follow', signal:AbortSignal.timeout(8000) });
          const resolved = new URL(response.url);
          if (allowed.has(resolved.hostname.toLowerCase())) parsed = resolved;
        }
      } catch (_) {}
      return send(res, 200, { ok:true, url:parsed.toString() });
    }
    if (req.method === 'GET' && u.pathname === '/api/study/readable') {
      try {
        const target = parsedReadingWebUrl(String(u.searchParams.get('url') || ''));
        return send(res, 200, { ok:true, ...(await fetchReadableWebPage(target)) });
      } catch (error) { return send(res, error.statusCode || 502, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/snippets') {
      send(res, 200, { vault: vaultPath(), rev: computeRev(), tags: readTagRegistry().list, folders: walkFolders(), resources: walkLatexResources(), snippets: walkSnippets() });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/rev') {
      send(res, 200, { rev: computeRev(), version: APP_VERSION });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/version') {
      return send(res, 200, { ok: true, name: '码境 CodeScope', version: APP_VERSION, apiRevision: 6, releaseChannel:'stable', mode:APP_MODE,
        capabilities:{ web:true, desktop:APP_MODE === 'desktop', nativeBridge:APP_MODE === 'desktop' },
        study:{ available:true, webOnly:true, layoutEngine:'Golden Layout', paneTypes:['browser','code','notes','pdf'], presets:['study','dual','notes','quad'] },
        knowledge:{ available:true, engine:'VitePress', url:'/knowledge/', source:'readings/知识库', autoBuild:true, localSearch:true },
        features: ['study-workspace', 'study-bookmarks', 'study-site-catalog', 'study-site-categories', 'study-layout-presets', 'study-layout-truth', 'study-readable-browser', 'study-video-timepoints', 'study-video-frame-capture', 'dual-mode-runtime', 'desktop-shell', 'unified-workbench-ui', 'environment-readiness', 'browser-capabilities', 'cross-platform-preflight', 'git-diff', 'timeline', 'remote-files', 'remote-folder-transfer', 'stream-transfer', 'project-tasks', 'project-tests', 'project-debug', 'compile-database', 'project-health', 'markdown-code-links', 'workspace-backlinks', 'markdown-note-links', 'xmind-markdown-export', 'xmind-native', 'xmind-official-viewer', 'xmind-mind-elixir', 'xmind-simple-mind-map', 'xmind-advanced-layouts', 'xmind-node-reparent', 'opml-export', 'workspace-snapshots', 'live-web-search', 'search-history', 'editor-groups', 'monaco-editor', 'multi-cursor', 'editor-folding', 'editor-command-palette', 'editor-line-actions', 'editor-word-wrap', 'editor-wheel-zoom', 'editor-position', 'lsp-completion', 'lsp-signature-help', 'lsp-code-actions', 'lsp-rename', 'lsp-problems', 'drawio', 'drawio-xml', 'ai-drawio', 'full-text-search', 'quick-open', 'workspace-quick-open', 'workspace-recent', 'reading-full-text-search', 'pdf-text-cache', 'navigation-history', 'definition-peek', 'header-source-switch', 'lsp', 'pdf-library', 'pdf-translation', 'pdf-full-text-search', 'pdf-thumbnail-navigation', 'pdf-focus-mode', 'pdfjs-official-viewer', 'pdf-virtual-rendering', 'pdf-page-layouts', 'onlyoffice-pdf-editor', 'reading-fragments', 'reading-split-view', 'reading-projects', 'reading-code-notes', 'reading-folders', 'reading-project-metadata', 'reading-docx', 'docx-page-break-normalization', 'reading-spreadsheets', 'reading-presentations', 'reading-web-pages', 'reading-web-site-navigation', 'reading-web-session', 'reading-web-whole-page-zoom', 'reading-web-annotations', 'reading-web-location', 'office-library', 'office-folders', 'office-provider-api-v1', 'office-responsive-layout', 'onlyoffice-docs', 'onlyoffice-required', 'onlyoffice-connection-settings', 'onlyoffice-service-control', 'onlyoffice-jwt', 'onlyoffice-save-callback'] });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/tree') {
      const root = officeTree(); return send(res, 200, { ok:true, dir:officeDir(), root, total:root.count });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/office/file') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'Office 文件路径不合法' });
      if (u.searchParams.get('download') === '1') res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(rel)));
      return streamStatic(req, res, officeDir(), rel, { cacheControl:'private, no-cache', notFound:'Office 文件不存在' });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/connection') {
      const health = await onlyOfficeHealth();
      return send(res, 200, { ok:true, connection:publicOnlyOfficeConnection(), health });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/service') {
      return send(res, 200, { ok:true, service:await onlyOfficeServiceStatus() });
    }
    if (req.method === 'POST' && u.pathname === '/api/office/service') {
      try {
        const body = await readBody(req, 16 * 1024), action = String(body && body.action || '');
        const service = await controlOnlyOfficeService(action);
        return send(res, 200, { ok:true, action, service });
      } catch (error) {
        return send(res, error.statusCode || 500, { ok:false, error:String(error.message || error) });
      }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/connection') {
      try {
        const body = await readBody(req, 128 * 1024);
        const connection = saveOnlyOfficeConnection(body);
        const health = await onlyOfficeHealth();
        return send(res, health.ok ? 200 : 202, { ok:true, connection, health });
      } catch (error) {
        return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) });
      }
    }
    if (req.method === 'GET' && u.pathname === '/api/office/onlyoffice/status') {
      const health = await onlyOfficeHealth();
      return send(res, health.ok ? 200 : 503, { ...health, engine:'ONLYOFFICE Docs', connection:publicOnlyOfficeConnection(), editable:['docx','xlsx','xls','csv','pptx','pdf'] });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/providers/v1') {
      return send(res, 200, await OFFICE_ENGINE.status({ probe:u.searchParams.get('refresh') !== '0' }));
    }
    if (req.method === 'GET' && u.pathname === '/api/office/onlyoffice/config') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'Office 文件路径不合法' });
      const file = path.join(officeDir(), rel), kind = officeKind(rel);
      if (!fs.existsSync(file) || !onlyOfficeDocumentType(kind)) return send(res, 404, { ok:false, error:'Office 文件不存在或类型不受支持' });
      const health = await onlyOfficeHealth();
      if (!health.ok) return send(res, 503, { ok:false, error:health.error || 'ONLYOFFICE Docs 尚未连接', documentServerUrl:ONLYOFFICE_CONNECTION.publicUrl, connection:publicOnlyOfficeConnection() });
      return send(res, 200, { ok:true, engine:'ONLYOFFICE Docs', documentServerUrl:onlyOfficeBrowserUrl(req), connection:publicOnlyOfficeConnection(), config:onlyOfficeConfig(rel, file) });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/office/onlyoffice-file') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel || !onlyOfficeTokenValid(rel, 'document', u.searchParams.get('token'))) return send(res, 403, { ok:false, error:'Office 文件访问令牌无效' });
      return streamStatic(req, res, officeDir(), rel, { cacheControl:'private, no-store', notFound:'Office 文件不存在' });
    }
    if (req.method === 'POST' && u.pathname === '/api/office/onlyoffice-callback') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel || !onlyOfficeTokenValid(rel, 'callback', u.searchParams.get('token'))) return send(res, 403, { error:1 });
      const body = await readBody(req, 4 * 1024 * 1024), status = Number(body && body.status);
      if ((status === 2 || status === 6) && body.url) {
        try { await saveOnlyOfficeResult(rel, body.url); }
        catch (error) { console.error('ONLYOFFICE 保存失败:', rel, error); return send(res, 500, { error:1 }); }
      }
      if (status === 3 || status === 7) console.error('ONLYOFFICE 编辑服务报告保存错误:', rel, body && body.error);
      return send(res, 200, { error:0 });
    }
    if (req.method === 'GET' && u.pathname === '/api/office/word-html') {
      const rel = officePath(u.searchParams.get('path'));
      if (!rel || path.extname(rel).toLowerCase() !== '.docx') return send(res, 400, { ok:false, error:'Word 文件路径不合法' });
      const file = path.join(officeDir(), rel);
      if (!fs.existsSync(file)) return send(res, 404, { ok:false, error:'Word 文件不存在' });
      try { const result = await officeWordToHtml(file); return send(res, 200, { ok:true, path:rel, ...result }); }
      catch (error) { return send(res, 400, { ok:false, error:'Word 内容解析失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/word-save') {
      const b = await readBody(req, 24 * 1024 * 1024), rel = officePath(b && b.path);
      if (!rel || path.extname(rel).toLowerCase() !== '.docx') return send(res, 400, { ok:false, error:'Word 文件路径不合法' });
      const file = path.join(officeDir(), rel);
      if (!fs.existsSync(file)) return send(res, 404, { ok:false, error:'要保存的 Word 文档不存在' });
      try { const stat = await saveOfficeWordHtml(file, b && b.html); return send(res, 200, { ok:true, path:rel, size:stat.size, updated:stat.mtimeMs }); }
      catch (error) { return send(res, error.statusCode || 400, { ok:false, error:'Word 保存失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/folder') {
      const b = await readBody(req), parent = officeSafeFolder(b && b.parent), name = officeSafeFolder(b && b.name);
      if (parent === null || !name || name.includes('/')) return send(res, 400, { ok:false, error:'文件夹名称或位置不合法' });
      const rel = parent ? parent + '/' + name : name, target = path.join(officeDir(), rel);
      if (fs.existsSync(target)) return send(res, 409, { ok:false, error:'同名文件夹已存在' });
      fs.mkdirSync(target, { recursive:true }); return send(res, 200, { ok:true, path:rel });
    }
    if (req.method === 'POST' && u.pathname === '/api/office/new') {
      const b = await readBody(req), folder = officeSafeFolder(b && b.folder), kind = String(b && b.kind || '');
      if (folder === null || !['word', 'sheet', 'slides'].includes(kind)) return send(res, 400, { ok:false, error:'新建文档参数不合法' });
      const raw = String(b && b.name || '').trim().replace(/\.(?:docx|xlsx|pptx)$/i, '');
      if (!raw || !/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&]+$/.test(raw) || ['.', '..'].includes(raw)) return send(res, 400, { ok:false, error:'文档名称不合法' });
      const ext = kind === 'word' ? '.docx' : (kind === 'sheet' ? '.xlsx' : '.pptx'), target = uniqueOfficeTarget(folder, raw + ext);
      try { await createOfficeDocument(kind, target.file, raw); return send(res, 200, { ok:true, path:target.path, name:target.name, kind, size:fs.statSync(target.file).size }); }
      catch (error) { try { fs.unlinkSync(target.file); } catch (_) {} return send(res, 500, { ok:false, error:'创建 Office 文档失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/upload-stream') {
      let info;
      try { info = JSON.parse(Buffer.from(String(req.headers['x-codescope-office'] || ''), 'base64').toString('utf8')); }
      catch (_) { return send(res, 400, { ok:false, error:'上传信息格式错误' }); }
      const folder = officeSafeFolder(info && info.folder), base = path.basename(String(info && info.name || '')).trim(), ext = path.extname(base).toLowerCase();
      if (folder === null || !officePath(base) || !OFFICE_EXTS.has(ext)) return send(res, 400, { ok:false, error:'仅支持 DOCX、XLSX、XLS、CSV 和 PPTX 文件' });
      const target = uniqueOfficeTarget(folder, base), temp = path.join(path.dirname(target.file), '.' + crypto.randomUUID() + '.upload');
      try {
        const bytes = await officeStreamToFile(req, temp); validateOfficeFile(temp, ext); fs.renameSync(temp, target.file);
        return send(res, 200, { ok:true, path:target.path, name:target.name, kind:officeKind(target.name), size:bytes });
      } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} return send(res, error.statusCode || 400, { ok:false, error:'导入失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/save-stream') {
      let info;
      try { info = JSON.parse(Buffer.from(String(req.headers['x-codescope-office'] || ''), 'base64').toString('utf8')); }
      catch (_) { return send(res, 400, { ok:false, error:'保存信息格式错误' }); }
      const rel = officePath(info && info.path), ext = path.extname(String(rel || '')).toLowerCase();
      if (!rel || !['.xlsx', '.xls', '.csv'].includes(ext)) return send(res, 400, { ok:false, error:'当前只允许在 CodeScope 内保存表格文件' });
      const target = path.join(officeDir(), rel), temp = path.join(path.dirname(target), '.' + crypto.randomUUID() + '.saving');
      if (!fs.existsSync(target)) return send(res, 404, { ok:false, error:'要保存的表格不存在' });
      try {
        const bytes = await officeStreamToFile(req, temp); validateOfficeFile(temp, ext); fs.renameSync(temp, target);
        return send(res, 200, { ok:true, path:rel, size:bytes, updated:fs.statSync(target).mtimeMs });
      } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} return send(res, error.statusCode || 400, { ok:false, error:'保存失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/rename') {
      const b = await readBody(req), rel = officePath(b && b.path, true), rawName = String(b && b.name || '').trim();
      if (!rel || !rawName || /[\\/]/.test(rawName) || !/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&]+$/.test(rawName) || ['.', '..'].includes(rawName)) return send(res, 400, { ok:false, error:'名称不合法' });
      const source = path.join(officeDir(), rel); let stat; try { stat = fs.statSync(source); } catch (_) { return send(res, 404, { ok:false, error:'文件或文件夹不存在' }); }
      const parent = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
      let name = rawName;
      if (stat.isFile()) { const ext = path.extname(rel).toLowerCase(); name = rawName.replace(/\.(?:docx|xlsx|xls|csv|pptx)$/i, '') + ext; }
      const targetRel = parent ? parent + '/' + name : name, target = path.join(officeDir(), targetRel);
      if (targetRel === rel) return send(res, 200, { ok:true, path:rel, unchanged:true });
      if (fs.existsSync(target)) return send(res, 409, { ok:false, error:'同名文件或文件夹已存在' });
      try { fs.renameSync(source, target); return send(res, 200, { ok:true, path:targetRel }); }
      catch (error) { return send(res, 500, { ok:false, error:'重命名失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/move') {
      const b = await readBody(req), rel = officePath(b && b.path, true), toFolder = officeSafeFolder(b && b.toFolder);
      if (!rel || toFolder === null || toFolder === rel || toFolder.startsWith(rel + '/')) return send(res, 400, { ok:false, error:'移动路径不合法' });
      const source = path.join(officeDir(), rel), name = path.basename(rel); let stat; try { stat = fs.statSync(source); } catch (_) { return send(res, 404, { ok:false, error:'文件或文件夹不存在' }); }
      const dir = path.join(officeDir(), toFolder || '.'); fs.mkdirSync(dir, { recursive:true });
      let targetName = name, index = 2, ext = stat.isFile() ? path.extname(name) : '', stem = ext ? path.basename(name, ext) : name;
      while (fs.existsSync(path.join(dir, targetName))) { targetName = stem + '-' + index + ext; index += 1; }
      const targetRel = toFolder ? toFolder + '/' + targetName : targetName;
      if (targetRel === rel) return send(res, 200, { ok:true, path:rel, unchanged:true });
      try { fs.renameSync(source, path.join(dir, targetName)); return send(res, 200, { ok:true, path:targetRel }); }
      catch (error) { return send(res, 500, { ok:false, error:'移动失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/office/delete') {
      const b = await readBody(req), rel = officePath(b && b.path, true);
      if (!rel) return send(res, 400, { ok:false, error:'删除路径不合法' });
      const target = path.join(officeDir(), rel);
      try { const stat = fs.statSync(target); stat.isDirectory() ? fs.rmSync(target, { recursive:true }) : fs.unlinkSync(target); return send(res, 200, { ok:true, path:rel }); }
      catch (error) { return send(res, 404, { ok:false, error:'删除失败：文件不存在或已被占用' }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/tree') {
      fs.mkdirSync(readingsDir(), { recursive:true });
      const root = readingTree();
      return send(res, 200, { ok:true, dir:readingsDir(), root, total:root.count });
    }
    if (req.method === 'GET' && u.pathname === '/api/knowledge/status') {
      return send(res, 200, KNOWLEDGE.status());
    }
    if (req.method === 'POST' && u.pathname === '/api/knowledge/build') {
      return send(res, 200, await KNOWLEDGE.build('manual'));
    }
    if (req.method === 'POST' && u.pathname === '/api/knowledge/page') {
      try { return send(res, 200, KNOWLEDGE.createPage(await readBody(req, 256 * 1024))); }
      catch (error) { return send(res, 400, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/knowledge/folder') {
      try { return send(res, 200, KNOWLEDGE.createFolder(await readBody(req, 256 * 1024))); }
      catch (error) { return send(res, 400, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/knowledge/project') {
      try { return send(res, 200, KNOWLEDGE.createProject(await readBody(req, 256 * 1024))); }
      catch (error) { return send(res, 400, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/knowledge/image') {
      try {
        const info = JSON.parse(Buffer.from(String(req.headers['x-codescope-knowledge'] || ''), 'base64').toString('utf8'));
        const body = await readRawBody(req, 50 * 1024 * 1024);
        return send(res, 200, KNOWLEDGE.saveImage(String(info.path || info.name || ''), body, String(req.headers['content-type'] || 'application/octet-stream')));
      } catch (error) { return send(res, 400, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/search') {
      const query = String(u.searchParams.get('q') || '').trim();
      if (!query) return send(res, 200, { ok:true, hits:[] });
      if (query.length > 240) return send(res, 400, { ok:false, error:'搜索内容不能超过 240 个字符' });
      return send(res, 200, { ok:true, hits:searchReadingLibrary(query, u.searchParams.get('case') === '1') });
    }
    if (req.method === 'GET' && u.pathname === '/api/workspace/backlinks') {
      const kind = String(u.searchParams.get('kind') || ''), targetPath = String(u.searchParams.get('path') || '');
      if (!['code','pdf','note'].includes(kind) || !targetPath || targetPath.length > 4096) return send(res, 400, { ok:false, error:'反向链接目标不合法' });
      const fragmentRaw = u.searchParams.get('fragment'), fragment = fragmentRaw == null ? NaN : Number(fragmentRaw);
      return send(res, 200, { ok:true, kind, path:targetPath, fragment:Number.isFinite(fragment) ? fragment : null, hits:workspaceBacklinks(kind, targetPath, fragment) });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/folder') {
      const b = await readBody(req);
      const parent = b.parent ? readingPath(String(b.parent), true) : '';
      const name = readingPath(String(b.name || ''), true);
      if ((b.parent && !parent) || !name || name.includes('/')) return send(res, 400, { ok:false, error:'文件夹名称或位置不合法' });
      const rel = parent ? parent + '/' + name : name;
      fs.mkdirSync(path.join(readingsDir(), rel), { recursive:true });
      writeFileAtomicSync(path.join(readingsDir(),rel,READING_FOLDER_META),JSON.stringify({version:1,updatedAt:Date.now()},null,2),'utf8');
      return send(res, 200, { ok:true, path:rel });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/project/new') {
      const b=await readBody(req),parent=b.parent?readingPath(String(b.parent),true):'',name=readingPath(String(b.name||''),true);
      if((b.parent&&!parent)||!name||name.includes('/'))return send(res,400,{ok:false,error:'阅读项目名称或位置不合法'});const rel=parent?parent+'/'+name:name,target=path.join(readingsDir(),rel);if(fs.existsSync(target))return send(res,409,{ok:false,error:'同名阅读项目已存在'});
      fs.mkdirSync(target,{recursive:true});const meta=saveReadingProjectMeta(rel,{description:b.description,tags:b.tags});return send(res,200,{ok:true,path:rel,meta});
    }
    if (u.pathname === '/api/readings/project/meta') {
      if(req.method==='GET'){const project=readingPath(u.searchParams.get('project'),true);if(!project)return send(res,400,{ok:false,error:'阅读项目路径不合法'});return send(res,200,{ok:true,project,meta:loadReadingProjectMeta(project)});}
      if(req.method==='POST'){const b=await readBody(req),project=readingPath(String(b.project||''),true);if(!project)return send(res,400,{ok:false,error:'阅读项目路径不合法'});return send(res,200,{ok:true,project,meta:saveReadingProjectMeta(project,b)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/folder/rename') {
      const b=await readBody(req),from=readingPath(String(b.folder||''),true),name=readingPath(String(b.name||''),true);if(!from||!name||name.includes('/'))return send(res,400,{ok:false,error:'阅读文件夹名称不合法'});const parent=path.posix.dirname(from)==='.'?'':path.posix.dirname(from),to=parent?parent+'/'+name:name,source=path.join(readingsDir(),from),target=path.join(readingsDir(),to);if(fs.existsSync(target))return send(res,409,{ok:false,error:'同名文件夹已存在'});
      const metaAssets=[];const scan=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(dir,e.name),rel);else if(readingHasMeta(e.name))metaAssets.push(rel);}};try{scan(source,from);fs.renameSync(source,target);for(const oldRel of metaAssets)moveReadingMeta(oldRel,to+oldRel.slice(from.length));return send(res,200,{ok:true,path:to});}catch(error){return send(res,500,{ok:false,error:'阅读文件夹重命名失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/folder/delete') {
      const b=await readBody(req),folder=readingPath(String(b.folder||''),true);if(!folder)return send(res,400,{ok:false,error:'阅读文件夹路径不合法'});const dir=path.join(readingsDir(),folder),metaAssets=[];const scan=(current,prefix)=>{for(const e of fs.readdirSync(current,{withFileTypes:true})){const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(current,e.name),rel);else if(readingHasMeta(e.name))metaAssets.push(rel);}};try{scan(dir,folder);fs.rmSync(dir,{recursive:true,force:false});for(const rel of metaAssets)try{fs.unlinkSync(readingMetaFile(rel));}catch(_){}return send(res,200,{ok:true});}catch(error){return send(res,500,{ok:false,error:'删除阅读文件夹失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/node/move') {
      const b=await readBody(req),type=String(b.type||''),from=readingPath(String(b.path||''),true),toFolder=b.toFolder?readingPath(String(b.toFolder),true):'';
      if(!['folder','project'].includes(type)||!from||(b.toFolder&&!toFolder))return send(res,400,{ok:false,error:'阅读节点或目标文件夹路径不合法'});if(type==='folder'&&toFolder&&(toFolder===from||toFolder.startsWith(from+'/')))return send(res,400,{ok:false,error:'不能把文件夹移动到自身或子文件夹中'});
      const source=path.join(readingsDir(),from);if(!fs.existsSync(source)||!fs.statSync(source).isDirectory())return send(res,404,{ok:false,error:'待移动的阅读项目或文件夹不存在'});if(toFolder){const parent=path.join(readingsDir(),toFolder);if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())return send(res,404,{ok:false,error:'目标阅读文件夹不存在'});}
      const base=path.posix.basename(from),to=toFolder?toFolder+'/'+base:base;if(to===from)return send(res,200,{ok:true,path:from,unchanged:true});const target=path.join(readingsDir(),to);if(fs.existsSync(target))return send(res,409,{ok:false,error:'目标位置已有同名项目或文件夹'});
      const metaAssets=[];const scan=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(dir,e.name),rel);else if(readingHasMeta(e.name))metaAssets.push(rel);}};try{scan(source,from);fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(source,target);for(const oldRel of metaAssets)moveReadingMeta(oldRel,to+oldRel.slice(from.length));return send(res,200,{ok:true,path:to});}catch(error){return send(res,500,{ok:false,error:'移动失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/text/new') {
      const b=await readBody(req), project=readingPath(String(b.project||''),true), name=path.basename(String(b.name||'')).trim();
      if(!project||!name||!READING_TEXT_EXTS.has(path.extname(name).toLowerCase())||!readingAssetPath(project+'/'+name))return send(res,400,{ok:false,error:'阅读项目或片段文件名不合法'});
      const dir=path.join(readingsDir(),project);fs.mkdirSync(dir,{recursive:true});let target=path.join(dir,name);
      if(fs.existsSync(target))return send(res,409,{ok:false,error:'同名片段已存在'});
      const ext=path.extname(name).toLowerCase();const content=['.md','.markdown'].includes(ext)?'# '+name.replace(/\.[^.]+$/,'')+'\n\n':'// '+name+'\n';
      writeFileAtomicSync(target,content,'utf8');return send(res,200,{ok:true,path:project+'/'+name,kind:['.md','.markdown'].includes(ext)?'markdown':'code',content});
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/web/new') {
      const b = await readBody(req, 128 * 1024), project = readingPath(String(b.project || ''), true);
      if (!project) return send(res, 400, { ok:false, error:'阅读项目路径不合法' });
      let url;
      try { url = parsedReadingWebUrl(b.url); } catch (error) { return send(res, error.statusCode || 400, { ok:false, error:String(error.message || error) }); }
      const rawTitle = String(b.title || url.hostname || '网页资料').trim().replace(/\.url$/i, '');
      if (!rawTitle || !/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&]+$/.test(rawTitle) || ['.', '..'].includes(rawTitle)) return send(res, 400, { ok:false, error:'网页资料名称不合法' });
      const dir = path.join(readingsDir(), project);
      try { if (!fs.statSync(dir).isDirectory()) throw new Error(); } catch (_) { return send(res, 404, { ok:false, error:'阅读项目不存在' }); }
      let name = rawTitle + '.url', index = 2;
      while (fs.existsSync(path.join(dir, name))) { name = rawTitle + '-' + index + '.url'; index += 1; }
      writeFileAtomicSync(path.join(dir, name), '[InternetShortcut]\nURL=' + url.toString() + '\n', 'utf8');
      return send(res, 200, { ok:true, path:project + '/' + name, name, kind:'web', url:url.toString() });
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/web') {
      const rel = readingAssetPath(u.searchParams.get('path'));
      if (!rel || path.extname(rel).toLowerCase() !== '.url') return send(res, 400, { ok:false, error:'网页资料路径不合法' });
      try { const result = await fetchReadableWebPage(readingWebShortcut(rel)); return send(res, 200, { ok:true, path:rel, ...result }); }
      catch (error) { return send(res, error.statusCode || 502, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/web/page') {
      try { return send(res, 200, { ok:true, ...(await fetchReadableWebPage(u.searchParams.get('url'))) }); }
      catch (error) { return send(res, error.statusCode || 502, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/project/rename') {
      const b=await readBody(req),from=readingPath(String(b.project||''),true),name=readingPath(String(b.name||''),true);const parent=from&&(path.posix.dirname(from)==='.'?'':path.posix.dirname(from)),to=parent?parent+'/'+name:name;
      if(!from||!name||name.includes('/'))return send(res,400,{ok:false,error:'阅读项目名称不合法'});
      const source=path.join(readingsDir(),from),target=path.join(readingsDir(),to);if(fs.existsSync(target))return send(res,409,{ok:false,error:'同名阅读项目已存在'});
      const metaAssets=[];const scan=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='.codescope')continue;const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(dir,e.name),rel);else if(readingHasMeta(e.name))metaAssets.push(rel);}};
      try{scan(source,from);fs.renameSync(source,target);for(const oldRel of metaAssets)moveReadingMeta(oldRel,to+oldRel.slice(from.length));return send(res,200,{ok:true,project:to});}catch(error){return send(res,500,{ok:false,error:'阅读项目重命名失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/project/delete') {
      const b=await readBody(req),project=readingPath(String(b.project||''),true);if(!project)return send(res,400,{ok:false,error:'阅读项目名称不合法'});
      const dir=path.join(readingsDir(),project),metaAssets=[];const scan=(folder,prefix)=>{for(const e of fs.readdirSync(folder,{withFileTypes:true})){const rel=prefix+'/'+e.name;if(e.isDirectory())scan(path.join(folder,e.name),rel);else if(readingHasMeta(e.name))metaAssets.push(rel);}};
      try{scan(dir,project);fs.rmSync(dir,{recursive:true,force:false});for(const rel of metaAssets)try{fs.unlinkSync(readingMetaFile(rel));}catch(_){}return send(res,200,{ok:true});}catch(error){return send(res,500,{ok:false,error:'删除阅读项目失败：'+String(error.message||error)});}
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/text-fragment') {
      const rel=readingAssetPath(u.searchParams.get('path'));
      if(!rel||!READING_TEXT_EXTS.has(path.extname(rel).toLowerCase()))return send(res,400,{ok:false,error:'文本片段路径不合法'});
      try{const stat=fs.statSync(path.join(readingsDir(),rel));if(stat.size>8*1024*1024)return send(res,413,{ok:false,error:'文本片段超过 8 MB'});return send(res,200,{ok:true,path:rel,content:fs.readFileSync(path.join(readingsDir(),rel),'utf8')});}
      catch(_){return send(res,404,{ok:false,error:'文本片段不存在'});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/text-fragment') {
      const b=await readBody(req,12e6),rel=readingAssetPath(b.path);
      if(!rel||!READING_TEXT_EXTS.has(path.extname(rel).toLowerCase()))return send(res,400,{ok:false,error:'文本片段路径不合法'});
      const content=String(b.content==null?'':b.content);if(Buffer.byteLength(content)>8*1024*1024)return send(res,413,{ok:false,error:'文本片段超过 8 MB'});
      if((rel===KNOWLEDGE.folderName||rel.startsWith(KNOWLEDGE.folderName+'/'))&&/!?\[[^\]]*\]\(\s*blob:/i.test(content))return send(res,400,{ok:false,error:'知识库图片不能使用浏览器临时 blob 地址，请在区块编辑器中重新粘贴或拖入图片'});
      try{writeFileAtomicSync(path.join(readingsDir(),rel),content,'utf8');if(rel===KNOWLEDGE.folderName||rel.startsWith(KNOWLEDGE.folderName+'/'))KNOWLEDGE.schedule('markdown-save');return send(res,200,{ok:true,size:Buffer.byteLength(content)});}catch(error){return send(res,500,{ok:false,error:'保存失败：'+String(error.message||error)});}
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/upload-stream') {
      let info;
      try { info = JSON.parse(Buffer.from(String(req.headers['x-codescope-reading'] || ''), 'base64').toString('utf8')); }
      catch (_) { return send(res, 400, { ok:false, error:'上传信息格式错误' }); }
      const folder = info.folder ? readingPath(String(info.folder), true) : '';
      let base = path.basename(String(info.name || '')).trim(); const ext = path.extname(base).toLowerCase();
      if ((info.folder && !folder) || !readingAssetPath((folder ? folder + '/' : '') + base) || (!READING_DOCUMENT_EXTS.has(ext) && ext !== '.pdf' && !['.html','.htm'].includes(ext))) return send(res, 400, { ok:false, error:'仅支持 PDF、DOCX、XLSX、XLS、CSV、PPTX 和 HTML 文件' });
      const dir = path.join(readingsDir(), folder || '.'); fs.mkdirSync(dir, { recursive:true });
      const stem = path.basename(base, ext); let target = path.join(dir, base), index = 2;
      while (fs.existsSync(target)) { base = stem + '-' + index + ext; target = path.join(dir, base); index += 1; }
      const temp = path.join(dir, '.' + crypto.randomUUID() + '.upload');
      try {
        await officeStreamToFile(req, temp);
        if (ext === '.pdf') { const head = Buffer.alloc(5); const fd = fs.openSync(temp, 'r'); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd); if (head.toString('ascii') !== '%PDF-') throw new Error('文件不是有效的 PDF'); }
        else if (['.html','.htm'].includes(ext)) { const head = fs.readFileSync(temp, 'utf8').slice(0, 512).trimStart(); if (!head.startsWith('<')) throw new Error('文件不是有效的 HTML'); }
        else validateOfficeFile(temp, ext);
        fs.renameSync(temp, target);
        const rel = (folder ? folder + '/' : '') + base;
        return send(res, 200, { ok:true, path:rel, size:fs.statSync(target).size, kind:readingFragmentInfo(rel, fs.statSync(target), folder || '').kind });
      } catch (error) {
        try { fs.unlinkSync(temp); } catch (_) {}
        return send(res, 400, { ok:false, error:'导入失败：' + String(error.message || error) });
      }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/onlyoffice/config') {
      const rel = readingPath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      const file = path.join(readingsDir(), rel);
      if (!fs.existsSync(file)) return send(res, 404, { ok:false, error:'PDF 不存在' });
      const health = await onlyOfficeHealth();
      if (!health.ok) return send(res, 503, { ok:false, error:health.error || 'ONLYOFFICE Docs 尚未连接', documentServerUrl:ONLYOFFICE_CONNECTION.publicUrl, connection:publicOnlyOfficeConnection() });
      return send(res, 200, { ok:true, engine:'ONLYOFFICE Docs', documentServerUrl:onlyOfficeBrowserUrl(req), connection:publicOnlyOfficeConnection(), config:onlyOfficeReadingConfig(rel, file) });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/readings/onlyoffice-file') {
      const rel = readingPath(u.searchParams.get('path'));
      if (!rel || !onlyOfficeTokenValid(rel, 'reading-document', u.searchParams.get('token'))) return send(res, 403, { ok:false, error:'PDF 文件访问令牌无效' });
      return streamStatic(req, res, readingsDir(), rel, { cacheControl:'private, no-store', notFound:'PDF 不存在' });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/onlyoffice-callback') {
      const rel = readingPath(u.searchParams.get('path'));
      if (!rel || !onlyOfficeTokenValid(rel, 'reading-callback', u.searchParams.get('token'))) return send(res, 403, { error:1 });
      const body = await readBody(req, 4 * 1024 * 1024), status = Number(body && body.status);
      if ((status === 2 || status === 6) && body.url) {
        try {
          const saved = await saveOnlyOfficeResult(rel, body.url, { root:readingsDir(), pdf:true });
          const session = ONLYOFFICE_READING_SESSIONS.get(rel);
          if (session) { session.savedAt = Date.now(); session.size = saved.size; session.mtimeMs = saved.mtimeMs; }
        }
        catch (error) { console.error('ONLYOFFICE PDF 保存失败:', rel, error); return send(res, 500, { error:1 }); }
      }
      if (status === 3 || status === 7) console.error('ONLYOFFICE PDF 编辑服务报告保存错误:', rel, body && body.error);
      return send(res, 200, { error:0 });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/onlyoffice/forcesave') {
      const body = await readBody(req, 1024 * 1024), rel = readingPath(body && body.path), key = String(body && body.key || '');
      if (!rel) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      const session = ONLYOFFICE_READING_SESSIONS.get(rel);
      if (!session || !key || session.key !== key) return send(res, 409, { ok:false, error:'ONLYOFFICE PDF 编辑会话已失效，请重新打开编辑器' });
      const file = path.join(readingsDir(), rel);
      let before; try { before = fs.statSync(file); } catch (_) { return send(res, 404, { ok:false, error:'PDF 不存在' }); }
      let command;
      try { command = await onlyOfficeCommand({ c:'forcesave', key, userdata:'codescope-pdf-sync-' + Date.now() }); }
      catch (error) { return send(res, error.statusCode || 502, { ok:false, error:String(error.message || error) }); }
      if (![0, 4].includes(Number(command && command.error))) return send(res, 502, { ok:false, error:'ONLYOFFICE 强制保存失败（错误码 ' + String(command && command.error) + '）' });
      if (Number(command.error) === 4) return send(res, 200, { ok:true, changed:false, synced:true, version:before.size + '-' + before.mtimeMs });
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        let current; try { current = fs.statSync(file); } catch (_) { continue; }
        if (current.size !== before.size || current.mtimeMs !== before.mtimeMs) return send(res, 200, { ok:true, changed:true, synced:true, version:current.size + '-' + current.mtimeMs });
      }
      return send(res, 202, { ok:true, pending:true, synced:false, error:'ONLYOFFICE 已接收保存命令，但回写超过 15 秒；编辑器已保留，请稍后重试' });
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/file') {
      const rel = readingAssetPath(u.searchParams.get('path'));
      if (!rel || path.extname(rel).toLowerCase() === '.url') return send(res, 400, { ok:false, error:'资料文件路径不合法' });
      const file = path.join(readingsDir(), rel);
      let stat; try { stat = fs.statSync(file); } catch (_) { return send(res, 404, { ok:false, error:'资料文件不存在' }); }
      const range = req.headers.range;
      res.setHeader('Content-Type', MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream'); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'private, no-cache');
      if (u.searchParams.get('download') === '1') res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(rel)));
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) { res.writeHead(416, { 'Content-Range':'bytes */' + stat.size }); return res.end(); }
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range':'bytes */' + stat.size }); return res.end(); }
        res.writeHead(206, { 'Content-Range':`bytes ${start}-${end}/${stat.size}`, 'Content-Length':end-start+1 });
        return pipeReadingFile(res, fs.createReadStream(file, { start, end }));
      }
      res.writeHead(200, { 'Content-Length':stat.size });
      return pipeReadingFile(res, fs.createReadStream(file));
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/text') {
      const rel = readingPath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      try {
        const pages = await extractPdfPages(path.join(readingsDir(), rel));
        return send(res, 200, { ok:true, path:rel, pages, pageCount:pages.length });
      } catch (error) { return send(res, 500, { ok:false, error:'PDF 文本解析失败：' + String(error.message || error).slice(0, 300) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/annotations') {
      const rel = readingAssetPath(u.searchParams.get('path'));
      if (!rel || !/\.pdf$/i.test(rel)) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      return send(res, 200, { ok:true, ...loadReadingAnnotations(rel) });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/annotations') {
      const b = await readBody(req, 25e6); const rel = readingAssetPath(b && b.path);
      if (!rel || !/\.pdf$/i.test(rel)) return send(res, 400, { ok:false, error:'PDF 路径不合法' });
      try { return send(res, 200, { ok:true, ...saveReadingAnnotations(rel, b) }); }
      catch (error) { return send(res, 500, { ok:false, error:'标注保存失败：' + String(error.message || error).slice(0, 300) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/readings/meta') {
      const rel = readingAssetPath(u.searchParams.get('path'));
      if (!rel) return send(res, 400, { ok:false, error:'阅读资料路径不合法' });
      return send(res, 200, { ok:true, meta:loadReadingMeta(rel) });
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/meta') {
      const b = await readBody(req, 25e6); const rel = readingAssetPath(b.path);
      if (!rel) return send(res, 400, { ok:false, error:'阅读资料路径不合法' });
      try { return send(res, 200, { ok:true, meta:saveReadingMeta(rel, b.meta) }); }
      catch (error) { return send(res, 500, { ok:false, error:'阅读记录保存失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/rename') {
      const b = await readBody(req); const rel = readingAssetPath(b.path);
      const nextBase = path.basename(String(b.name || '')).trim();
      if (!rel || !readingAssetPath((path.dirname(rel)==='.'?'':path.dirname(rel)+'/')+nextBase)) return send(res, 400, { ok:false, error:'文件名或类型不合法' });
      const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel).split(path.sep).join('/');
      const next = dir ? dir + '/' + nextBase : nextBase;
      if (next !== rel && fs.existsSync(path.join(readingsDir(), next))) return send(res, 409, { ok:false, error:'目标文件已存在' });
      try { fs.renameSync(path.join(readingsDir(), rel), path.join(readingsDir(), next)); if(readingHasMeta(rel))moveReadingMeta(rel, next); return send(res, 200, { ok:true, path:next }); }
      catch (error) { return send(res, 500, { ok:false, error:'重命名失败：' + String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/readings/delete') {
      const b = await readBody(req); const rel = readingAssetPath(b.path);
      if (!rel) return send(res, 400, { ok:false, error:'片段路径不合法' });
      try { fs.unlinkSync(path.join(readingsDir(), rel)); if(readingHasMeta(rel))try { fs.unlinkSync(readingMetaFile(rel)); } catch (_) {} return send(res, 200, { ok:true }); }
      catch (error) { return send(res, 500, { ok:false, error:'删除失败：' + String(error.message || error) }); }
    }
    if (u.pathname === '/api/integrations/dsh') {
      if (req.method === 'GET') return send(res, 200, { ok:true, service:DSH.status() });
      if (req.method === 'POST') {
        const body = await readBody(req, 64 * 1024);
        const action = String(body && body.action || 'start');
        if (!['start', 'stop', 'restart'].includes(action)) return send(res, 400, { ok:false, error:'不支持的 DSH 操作' });
        const service = await DSH[action]();
        return send(res, service.available || action === 'stop' ? 200 : 503, { ok:service.available || action === 'stop', service });
      }
      return send(res, 405, { ok:false, error:'Method Not Allowed' });
    }
    if (u.pathname === '/api/integrations/code-server') {
      if (req.method === 'GET') return send(res, 200, { ok:true, service: codeServerStatus() });
      if (req.method === 'POST') {
        const body = await readBody(req, 64 * 1024);
        const action = String(body && body.action || 'open');
        if (action === 'stop') {
          VSCODE_PROXY.stop();
          return send(res, 200, { ok:true, service: codeServerStatus(await VSCODE.stop()) });
        }
        if (action !== 'open') return send(res, 400, { ok:false, error:'不支持的 VS Code 操作' });
        const service = await VSCODE.start();
        /* 代理按需启动：没用这个功能就不额外占端口。 */
        if (service.available) await VSCODE_PROXY.start();
        return send(res, service.available ? 200 : 503, { ok:service.available, service: codeServerStatus(service) });
      }
      return send(res, 405, { ok:false, error:'Method Not Allowed' });
    }
    if (u.pathname === '/api/integrations/opencode') {
      if (req.method === 'GET') return send(res, 200, { ok:true, service:OPENCODE.status() });
      if (req.method === 'POST') {
        const body = await readBody(req, 64 * 1024);
        const action = String(body && body.action || 'open');
        if (action === 'stop') {
          const service = await OPENCODE.stop();
          return send(res, 200, { ok:true, service });
        }
        if (action !== 'open') return send(res, 400, { ok:false, error:'不支持的 opencode 操作' });
        const service = await OPENCODE.start();
        return send(res, service.available ? 200 : 503, { ok:service.available, service });
      }
      return send(res, 405, { ok:false, error:'Method Not Allowed' });
    }
    if (req.method === 'GET' && u.pathname === '/api/env') {
      const force = u.searchParams.get('refresh') === '1';
      // 自动准备完成或用户在“连接设置”里改了地址后，重新检测时同步读取，避免必须重启
      if (force) { try { ONLYOFFICE_CONNECTION = readOnlyOfficeConnection(); } catch (_) {} }
      const detected = await getEnv(force);
      const env = detected.tools;
      const runtime = runtimeReadiness();
      const onlyOffice = await onlyOfficeHealth();
      env.onlyoffice = {
        key:'onlyoffice', label:'ONLYOFFICE Docs', for:'DOCX、XLSX 与 PPTX 完整编辑和多人协作', group:'Office 运行服务',
        available:!!(onlyOffice && onlyOffice.ok), installed:!!(onlyOffice && onlyOffice.ok), required:true,
        version:onlyOffice && onlyOffice.ok ? '已连接' : '', path:ONLYOFFICE_CONNECTION.publicUrl,
        issue:onlyOffice ? (onlyOffice.ok ? '' : (onlyOffice.error || '服务未连接')) : (ONLYOFFICE_CONNECTION.publicUrl ? '等待重新检测服务' : '尚未配置 Document Server 地址'),
        hint:'在 Office 工作区点击“连接设置”，填写 ONLYOFFICE Document Server 地址、回调地址和 JWT 密钥', installable:false, relevant:true, external:true, scope:'Office 必需',
      };
      env.dsh = DSH.status();
      const all = [...Object.values(runtime), ...Object.values(env)];
      const required = all.filter((e) => e.required);
      const unavailable = all.filter((e) => !e.available).length;
      const requiredMissing = required.filter((e) => !e.available).length;
      const optionalUnavailable = all.filter((e) => !e.available && !e.required && !e.external).length;
      const externalUnavailable = all.filter((e) => !e.available && e.external).length;
      const total = all.length;
      // 保留条目自己提供的说明，只为没有说明的外部工具补充平台提示。
      for (const e of all) e.hint = e.hint || installHint(e.key);
      const system = platformInfo();
      send(res, 200, {
        env, runtime, version:APP_VERSION, mode:APP_MODE, node:process.version,
        summary: {
          total, unavailable, missing: requiredMissing, ready: total - unavailable, ok: requiredMissing === 0,
          required: required.length, requiredMissing, requiredReady: required.length - requiredMissing,
          optionalMissing: optionalUnavailable, optionalUnavailable, externalUnavailable,
        },
        project: { languages: detected.project.languages, tools: [...detected.project.keys] },
        deployment: deploymentInfo(env, detected.project.keys),
        vault: (() => { try { return vaultPath(); } catch (e) { return String(e.message); } })(),
        platform: system.label + ' · ' + system.arch,
        system,
      });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/latex/resource/raw') {
      let resource;
      try { resource = resolveLatexResource(u.searchParams.get('path')); }
      catch (e) { return send(res, 404, { ok: false, error: e.message }); }
      const data = fs.readFileSync(resource.full);
      const displayName = path.basename(resource.full).replace(/["\r\n]/g, '');
      const asciiName = ('resource' + resource.ext).replace(/[^\x20-\x7e]/g, '');
      const encodedName = encodeURIComponent(displayName).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      res.writeHead(200, { 'Content-Type': MIME[resource.ext] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodedName });
      res.end(data); return;
    }
    if (req.method === 'GET' && u.pathname === '/api/latex/resource') {
      let resource;
      try { resource = resolveLatexResource(u.searchParams.get('path')); }
      catch (e) { return send(res, 404, { ok: false, error: e.message }); }
      const stat = fs.statSync(resource.full);
      if (!LATEX_TEXT_EXTS.has(resource.ext)) return send(res, 200, { ok: true, path: resource.rel, kind: resource.kind, ext: resource.ext, size: stat.size, text: false });
      if (stat.size > 2 * 1024 * 1024) return send(res, 413, { ok: false, error: '文本资源超过 2 MB，无法在线编辑' });
      return send(res, 200, { ok: true, path: resource.rel, kind: resource.kind, ext: resource.ext, size: stat.size, text: true, content: fs.readFileSync(resource.full, 'utf8') });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/save') {
      const b = await readBody(req); let resource;
      try { resource = resolveLatexResource(b.path, true); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      if (!LATEX_TEXT_EXTS.has(resource.ext)) return send(res, 400, { ok: false, error: '该资源不是可编辑文本' });
      const content = String(b.content == null ? '' : b.content);
      if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) return send(res, 413, { ok: false, error: '文本资源超过 2 MB' });
      fs.mkdirSync(path.dirname(resource.full), { recursive: true });
      writeFileAtomicSync(resource.full, content, 'utf8');
      return send(res, 200, { ok: true, path: resource.rel, size: Buffer.byteLength(content, 'utf8') });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/upload') {
      const b = await readBody(req);
      const folder = String(b.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const name = path.basename(String(b.name || '')).replace(/[\x00-\x1f]/g, '');
      if (!folder || !name || name === '.' || name === '..') return send(res, 400, { ok: false, error: '上传路径不合法' });
      let resource;
      try { resource = resolveLatexResource(folder + '/' + name, true); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      const encoded = String(b.data || '').replace(/^data:[^,]*,/, '');
      let data; try { data = Buffer.from(encoded, 'base64'); } catch (_) { return send(res, 400, { ok: false, error: '文件数据无效' }); }
      if (!data.length || data.length > 30 * 1024 * 1024) return send(res, 413, { ok: false, error: '资源文件必须在 30 MB 以内' });
      fs.mkdirSync(path.dirname(resource.full), { recursive: true });
      writeFileAtomicSync(resource.full, data);
      return send(res, 200, { ok: true, path: resource.rel, size: data.length, replaced: !!b.replace });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/rename') {
      const b = await readBody(req); let source;
      try { source = resolveLatexResource(b.path); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      let name = path.basename(String(b.name || '').trim()).replace(/[\x00-\x1f]/g, '');
      if (!name || name === '.' || name === '..' || name !== String(b.name || '').trim()) return send(res, 400, { ok: false, error: '文件名不合法' });
      // 只输入主文件名时保留原扩展名，避免图片重命名后意外失去格式。
      if (!path.extname(name)) name += source.ext;
      if (path.extname(name).toLowerCase() !== source.ext) return send(res, 400, { ok: false, error: '重命名不能改变文件格式，请保留 ' + source.ext + ' 扩展名' });
      let target;
      try { target = resolveLatexResource(path.posix.dirname(source.rel) + '/' + name, true); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      if (path.resolve(source.full) === path.resolve(target.full)) return send(res, 200, { ok: true, path: source.rel, name: path.basename(source.rel) });
      if (fs.existsSync(target.full)) return send(res, 409, { ok: false, error: '同一目录已存在同名资源' });
      try { fs.renameSync(source.full, target.full); }
      catch (e) { return send(res, 500, { ok: false, error: '重命名失败: ' + e.message }); }
      return send(res, 200, { ok: true, path: target.rel, name });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/resource/move') {
      const b = await readBody(req); let source;
      try { source = resolveLatexResource(b.path); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      const toFolder = String(b.toFolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      let target;
      try { target = resolveLatexResource(toFolder + '/' + path.basename(source.rel), true); }
      catch (e) { return send(res, 400, { ok: false, error: e.message }); }
      if (target.kind !== source.kind) return send(res, 400, { ok: false, error: '资源只能移动到同类型目录（' + source.kind + '）' });
      if (path.resolve(source.full) === path.resolve(target.full)) return send(res, 200, { ok: true, path: source.rel });
      if (fs.existsSync(target.full)) return send(res, 409, { ok: false, error: '目标目录已存在同名资源' });
      fs.mkdirSync(path.dirname(target.full), { recursive: true });
      try { fs.renameSync(source.full, target.full); }
      catch (e) { return send(res, 500, { ok: false, error: '移动失败: ' + e.message }); }
      return send(res, 200, { ok: true, path: target.rel });
    }
    if (req.method === 'POST' && u.pathname === '/api/latex/compile') {
      const b = await readBody(req);
      if (typeof b.code !== 'string') return send(res, 400, { ok: false, error: '缺少 LaTeX 源码' });
      if (Buffer.byteLength(b.code, 'utf8') > 1024 * 1024) return send(res, 413, { ok: false, error: 'LaTeX 文档超过 1 MB，无法实时编译' });
      return send(res, 200, await compileLatex(b.code, b.file));
    }
    if (req.method === 'POST' && u.pathname === '/api/run') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      const runner = runnerFor(frag.language);
      if (!runner.supported) return send(res, 200, { ok: false, unsupported: true, reason: runner.reason });
      // 编辑模式：用前端传来的 code 覆盖磁盘内容（无需先保存）
      const code = b.code != null ? b.code : frag.code;
      const files = snip.fragments.map((f, i) => ({ filename: f.filename, code: (i === b.fragment && b.code != null) ? b.code : f.code }));
      const r = await runner.run(code, {
        input: b.input || '',
        selIndex: b.fragment,
        files,
      });
      return send(res, 200, { ok: true, ...r });
    }
    if (req.method === 'POST' && u.pathname === '/api/check') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      const runner = runnerFor(frag.language);
      if (!runner.supported) return send(res, 200, { ok: false, unsupported: true, reason: runner.reason });
      const code = b.code != null ? b.code : frag.code;
      const files = snip.fragments.map((f, i) => ({ filename: f.filename, code: (i === b.fragment && b.code != null) ? b.code : f.code }));
      const r = await runner.check(code, {
        selIndex: b.fragment,
        files,
      });
      return send(res, 200, { ok: true, ...r });
    }
    if (req.method === 'POST' && u.pathname === '/api/format') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      const fspec = FORMATTERS[(frag.language || '').toLowerCase()];
      if (!fspec) {
        const supported = Object.keys(FORMATTERS).join(' / ');
        return send(res, 200, { ok: false, reason: '该语言暂不支持格式化：' + frag.language + '（支持: ' + supported + '）' });
      }
      const { tools: env } = await getEnv();
      if (!env[fspec.key] || !env[fspec.key].available) {
        return send(res, 200, { ok: false, formatter: fspec.name, reason: missingReason(fspec.key, env[fspec.key]) });
      }
      const code = b.code != null ? b.code : frag.code;
      const fr = fspec.format ? await fspec.format(code) : await formatWithPrettier(fspec.prettier, code);
      if (!fr.ok) return send(res, 200, { ok: false, formatter: fspec.name, reason: fr.reason });
      // 编辑模式（writeBack:false）：只返回格式化结果，由前端更新编辑框，不写盘
      if (b.writeBack === false) {
        return send(res, 200, { ok: true, formatter: fspec.name, formatted: fr.formatted, written: false, message: '已格式化（编辑模式，自动保存会立即写回 vault）' });
      }
      const written = writeBackFragment(b.file, frag, fr.formatted.replace(/\n+$/, ''));
      return send(res, 200, {
        ok: true, formatter: fspec.name, formatted: fr.formatted, written,
        message: written
          ? '已用 ' + fspec.name + ' 格式化并写回 vault（massCode 会实时同步）'
          : fspec.name + ' 格式化完成（未能自动写回，请手动复制）',
      });
    }
    if (req.method === 'POST' && u.pathname === '/api/save') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      if (typeof b.code !== 'string') return send(res, 400, { ok: false, error: '缺少 code' });
      const nextCode = b.code.replace(/\n+$/, '');
      if (nextCode === String(frag.code || '').replace(/\n+$/, '')) {
        return send(res, 200, { ok: true, written: false, unchanged: true, message: '内容未变化' });
      }
      const written = writeBackFragment(b.file, frag, nextCode);
      // 保存成功后记录“覆盖前”的内容，保证时间线第一项就能真正撤回本次编辑。
      if (written) recordTimeline(b.file, b.fragment, frag.code, '自动保存');
      return send(res, 200, { ok: written, written, message: written ? '已保存到 vault（massCode 会实时同步）' : '保存失败：未能定位片段代码块' });
    }
    /* 标签管理：重命名（只改注册表）/ 删除 / 合并（重写片段 frontmatter 的 tags） */
    if (req.method === 'POST' && u.pathname === '/api/tags/update') {
      const b = await readBody(req);
      const st = readState();
      if (!Array.isArray(st.tags)) st.tags = [];
      const id = Number(b.id);
      const tag = st.tags.find((t) => Number(t.id) === id);
      if (!tag) return send(res, 200, { ok: false, error: '标签不存在（vault 可能已变动）' });
      const action = String(b.action || '').trim();
      if (action === 'rename') {
        const name = String(b.name || '').trim();
        if (!name) return send(res, 200, { ok: false, error: '标签名不能为空' });
        if (name.length > 60) return send(res, 200, { ok: false, error: '标签名过长' });
        if (st.tags.some((t) => Number(t.id) !== id && t.name === name)) return send(res, 200, { ok: false, error: '已存在同名标签「' + name + '」' });
        const before = tag.name;
        tag.name = name;
        tag.updatedAt = Date.now();
        writeState(st);
        return send(res, 200, { ok: true, message: '标签「' + before + '」已重命名为「' + name + '」（片段保存的是标签 id，无需改动片段）' });
      }
      if (action === 'delete' || action === 'merge') {
        let targetId = null;
        if (action === 'merge') {
          targetId = Number(b.targetId);
          if (targetId === id) return send(res, 200, { ok: false, error: '不能合并到自己' });
          if (!st.tags.some((t) => Number(t.id) === targetId)) return send(res, 200, { ok: false, error: '目标标签不存在' });
        }
        const changed = retagSnippets(id, targetId);
        st.tags = st.tags.filter((t) => Number(t.id) !== id);
        writeState(st);
        return send(res, 200, {
          ok: true,
          changed,
          message: action === 'delete'
            ? '已删除标签「' + tag.name + '」，并从 ' + changed + ' 个片段移除'
            : '已把「' + tag.name + '」合并，' + changed + ' 个片段改用目标标签',
        });
      }
      return send(res, 200, { ok: false, error: '未知标签操作：' + action });
    }
    if (req.method === 'POST' && u.pathname === '/api/reorder') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const r = reorderFragments(b.file, b.order);
      return send(res, 200, { ok: r.ok, error: r.error, message: r.ok ? '片段顺序已调整（massCode 会实时同步）' : undefined });
    }
    /* ------------------------------ 文件系统：新建/移动 ------------------------------ */
    if (req.method === 'POST' && u.pathname === '/api/fs/mkdir') {
      const b = await readBody(req);
      const rel = String(b.path || '').replace(/^\/+|\/+$/g, '');
      if (!rel || rel.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return send(res, 200, { ok: false, error: '文件夹路径不合法' });
      const defaultLanguage = String(b.defaultLanguage || 'plain_text').trim() || 'plain_text';
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = path.join(codeRoot, rel);
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      if (fs.existsSync(dir)) return send(res, 200, { ok: false, error: '文件夹已存在' });
      fs.mkdirSync(dir, { recursive: true });
      const st = readState();
      const now = Date.now();
      // 每层新建目录都写 .meta.yaml 并注册（父层级联创建时也必须有元数据，否则 id 为 null）
      const segs = rel.split('/');
      for (let i = 0; i < segs.length; i++) {
        const subRel = segs.slice(0, i + 1).join('/');
        const metaPath = path.join(codeRoot, subRel, '.meta.yaml');
        if (fs.existsSync(metaPath)) continue;   // 已有元数据的层跳过（保留原 orderIndex 等）
        let fid = st.folderIdByPath[subRel];
        if (!fid) {
          fid = ++st.counters.folderId;
          st.folderIdByPath[subRel] = fid;
          st.folderUi[fid] = { isOpen: 1 };
        }
        writeFileAtomicSync(metaPath,
          `id: ${fid}\ncreatedAt: ${now}\ndefaultLanguage: ${i === segs.length - 1 ? defaultLanguage : 'plain_text'}\nicon: null\nname: ${segs[i]}\norderIndex: 0\nupdatedAt: ${now}\n`, 'utf8');
      }
      writeState(st);
      return send(res, 200, { ok: true, folder: rel, id: st.folderIdByPath[rel] });
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/newfile') {
      const b = await readBody(req);
      const folder = String(b.folder || '').replace(/^\/+|\/+$/g, '');
      const name = String(b.name || '').trim().replace(/\.md$/i, '').replace(/[:]/g, '：');   // 冒号会破坏 frontmatter
      if (!name || name.includes('/') || name.includes('\\')) return send(res, 200, { ok: false, error: '文件名不合法' });
      const language = String(b.language || 'plain_text').trim() || 'plain_text';
      const description = (b.description === undefined || b.description === null) ? '' : String(b.description).trim();
      const tagNames = Array.isArray(b.tags) ? b.tags.map(String) : [];
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = folder ? path.join(codeRoot, folder) : codeRoot;
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      fs.mkdirSync(dir, { recursive: true });
      const full = path.join(dir, name + '.md');
      if (fs.existsSync(full)) return send(res, 200, { ok: false, error: '文件已存在' });
      const st = readState();
      let fid = st.folderIdByPath[folder] || 0;
      if (folder && !fid) {
        fid = ++st.counters.folderId;
        st.folderIdByPath[folder] = fid;
        st.folderUi[fid] = { isOpen: 1 };
      }
      const tagIds = syncTags(st, tagNames);
      const sid = ++st.counters.snippetId;
      const cid = ++st.counters.contentId;
      const now = Date.now();
      const filePath = folder ? folder + '/' + name + '.md' : name + '.md';
      const contentLabel = language === 'latex' ? name + '.tex' : name;
      const initialCode = language === 'latex' ? (b.latexProject ? latexProjectStarter() : latexStarter()) : '';
      const md = '---\n' +
        'contents:\n' +
        '  - id: ' + cid + '\n' +
        '    label: ' + contentLabel + '\n' +
        '    language: ' + language + '\n' +
        'createdAt: ' + now + '\n' +
        'description: ' + (description ? JSON.stringify(description) : '""') + '\n' +
        'folderId: ' + (fid || 0) + '\n' +
        'id: ' + sid + '\n' +
        'isDeleted: 0\n' +
        'isFavorites: 0\n' +
        'name: ' + name + '\n' +
        (tagIds.length ? 'tags:\n' + tagIds.map((t) => '  - ' + t).join('\n') + '\n' : 'tags:\n') +
        'updatedAt: ' + now + '\n' +
        '---\n' +
        '\n## Fragment: ' + contentLabel + '\n' +
        '```' + language + '\n' +
        initialCode + '\n```\n';
      writeFileAtomicSync(full, md, 'utf8');
      st.snippets.push({
        filePath, id: sid,
        meta: {
          contents: [{ id: cid, label: contentLabel, language }],
          createdAt: now, description: description || null, folderId: fid || 0, isDeleted: 0, isFavorites: 0,
          mtimeMs: now, name, size: Buffer.byteLength(md), tags: tagIds, updatedAt: now,
        },
      });
      writeState(st);
      return send(res, 200, { ok: true, file: full, snippetId: sid, folder, tags: tagIds, language });
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/move') {
      const b = await readBody(req);
      const file = String(b.file || '');
      const toFolder = String(b.toFolder || '').replace(/^\/+|\/+$/g, '');
      if (!file || toFolder.split('/').some((seg) => seg === '.' || seg === '..')) return send(res, 200, { ok: false, error: '参数不合法' });
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = adoptSnippetFromDisk(st, file);
      if (!snip) return send(res, 200, { ok: false, error: '片段不存在或未登记（磁盘上没有该文件）' });
      const destDir = toFolder ? path.join(codeRoot, toFolder) : codeRoot;
      if (destDir !== codeRoot && !destDir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      const fname = path.basename(snip.filePath);
      const destFull = path.join(destDir, fname);
      if (path.resolve(file) === path.resolve(destFull)) return send(res, 200, { ok: true, file, folder: toFolder }); // 没动
      if (fs.existsSync(destFull)) return send(res, 200, { ok: false, error: '目标位置已存在同名文件' });
      fs.mkdirSync(destDir, { recursive: true });
      try { fs.renameSync(file, destFull); } catch (e) { return send(res, 200, { ok: false, error: '移动失败: ' + e.message }); }
      let fid = st.folderIdByPath[toFolder] || 0;
      if (toFolder && !fid) {
        fid = ++st.counters.folderId;
        st.folderIdByPath[toFolder] = fid;
        st.folderUi[fid] = { isOpen: 1 };
      }
      snip.filePath = toFolder ? toFolder + '/' + fname : fname;
      snip.meta.folderId = fid || 0;
      writeState(st);
      // 同步 .md frontmatter 的 folderId
      try {
        const text = fs.readFileSync(destFull, 'utf8');
        const updated = text.replace(/^folderId:\s*.*$/m, 'folderId: ' + (fid || 0));
        if (updated !== text) writeFileAtomicSync(destFull, updated, 'utf8');
      } catch (_) {}
      return send(res, 200, { ok: true, file: destFull, folder: toFolder });
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/move-folder') {
      const b = await readBody(req);
      const folder = String(b.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const toFolder = String(b.toFolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const renameName = String(b.name || '').replace(/[\\/]/g, '').trim();
      const invalid = (value, allowEmpty) => !value ? !allowEmpty : value.split('/').some((seg) => !seg || seg === '.' || seg === '..');
      if (invalid(folder, false) || invalid(toFolder, true) || (renameName && (renameName === '.' || renameName === '..'))) return send(res, 400, { ok: false, error: '文件夹路径不合法' });
      if (toFolder === folder || toFolder.startsWith(folder + '/')) return send(res, 400, { ok: false, error: '不能把文件夹移动到自身内部' });
      const codeRoot = path.resolve(path.join(vaultPath(), 'code'));
      const source = path.resolve(codeRoot, folder);
      const destParent = toFolder ? path.resolve(codeRoot, toFolder) : codeRoot;
      const baseName = renameName || path.posix.basename(folder);
      const targetRel = (toFolder ? toFolder + '/' : '') + baseName;
      const target = path.resolve(codeRoot, targetRel);
      if (!source.startsWith(codeRoot + path.sep) || (destParent !== codeRoot && !destParent.startsWith(codeRoot + path.sep)) || !target.startsWith(codeRoot + path.sep)) return send(res, 400, { ok: false, error: '路径越界' });
      if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return send(res, 404, { ok: false, error: '文件夹不存在' });
      if (!fs.existsSync(destParent) || !fs.statSync(destParent).isDirectory()) return send(res, 404, { ok: false, error: '目标文件夹不存在' });
      if (source === target) return send(res, 200, { ok: true, folder: targetRel });
      if (fs.existsSync(target)) return send(res, 409, { ok: false, error: '目标位置已存在同名文件夹' });
      try { fs.renameSync(source, target); }
      catch (e) { return send(res, 500, { ok: false, error: '移动文件夹失败: ' + e.message }); }
      // 目录树的名字来自 .meta.yaml 的 name 字段（walkFolders 读它），改名后不同步就会出现
      // “提示已重命名、刷新后仍是旧名”的假象（massCode 启动后同样是旧名）。
      try {
        const metaPath = path.join(target, '.meta.yaml');
        if (fs.existsSync(metaPath)) {
          const metaText = fs.readFileSync(metaPath, 'utf8');
          const yamlName = /^[\w\u4e00-\u9fa5. /-]+$/.test(baseName) ? baseName : JSON.stringify(baseName);
          const nextMeta = /^\s*name\s*:/m.test(metaText)
            ? metaText.replace(/^\s*name\s*:.*$/m, 'name: ' + yamlName)
            : metaText.replace(/\s*$/, '\n') + 'name: ' + yamlName + '\n';
          if (nextMeta !== metaText) writeFileAtomicSync(metaPath, nextMeta, 'utf8');
        }
      } catch (_) {}
      const st = readState(), prefix = folder + '/';
      for (const snip of (st.snippets || [])) {
        if (snip.filePath && snip.filePath.startsWith(prefix)) snip.filePath = targetRel + '/' + snip.filePath.slice(prefix.length);
      }
      const mapped = {};
      for (const [key, id] of Object.entries(st.folderIdByPath || {})) {
        const next = key === folder ? targetRel : key.startsWith(prefix) ? targetRel + '/' + key.slice(prefix.length) : key;
        mapped[next] = id;
      }
      st.folderIdByPath = mapped;
      writeState(st);
      return send(res, 200, { ok: true, folder: targetRel, from: folder });
    }
    // 编辑片段信息：名称/类型(语言)/标签/说明（fragmentId 指定要改语言的分片，默认第一个）
    if (req.method === 'POST' && u.pathname === '/api/fs/update') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = adoptSnippetFromDisk(st, b.file);
      if (!snip) return send(res, 200, { ok: false, error: '片段不存在或未登记（磁盘上没有该文件）' });
      let full = path.resolve(codeRoot, snip.filePath);
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      let text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.meta || !Array.isArray(fm.meta.contents) || !fm.meta.contents.length) return send(res, 200, { ok: false, error: 'frontmatter 解析失败' });
      const fragId = Number(b.fragmentId);
      const tgt = (fm.meta.contents.find((c) => String(c.id) === String(fragId)) || fm.meta.contents[0]);
      const folderPath = path.dirname(snip.filePath) === '.' ? '' : path.dirname(snip.filePath).split(path.sep).join('/');
      const now = Date.now();
      // 名称（重命名）
      if (b.name !== undefined) {
        const newName = String(b.name).trim().replace(/\.md$/i, '').replace(/[:]/g, '：');
        if (!newName) return send(res, 200, { ok: false, error: '文件名不能为空' });
        const oldName = fm.meta.name || path.basename(full, '.md');
        if (newName !== oldName) {
          if (newName.includes('/') || newName.includes('\\')) return send(res, 200, { ok: false, error: '文件名不合法' });
          const newFull = path.join(path.dirname(full), newName + '.md');
          if (newFull !== full && fs.existsSync(newFull)) return send(res, 200, { ok: false, error: '目标文件已存在' });
          if (newFull !== full) {
            try { fs.renameSync(full, newFull); } catch (e) { return send(res, 200, { ok: false, error: '重命名失败: ' + e.message }); }
          }
          full = newFull;
          snip.filePath = (folderPath ? folderPath + '/' : '') + newName + '.md';
          fm.meta.name = newName;
          tgt.label = newName;
        }
      }
      // 片段名（label）：只重命名【目标片段】，不改文件名、不影响其它片段
      if (b.label !== undefined) {
        const newLabel = String(b.label).trim();
        if (!newLabel) return send(res, 200, { ok: false, error: '片段名不能为空' });
        tgt.label = newLabel;
      }
      // 类型（语言）
      if (b.language !== undefined) {
        const lang = String(b.language).trim() || 'plain_text';
        tgt.language = lang;
      }
      // 说明
      if (b.description !== undefined) fm.meta.description = b.description === null ? '' : String(b.description).trim();
      // 标签（按名称，自动建新）
      if (Array.isArray(b.tags)) fm.meta.tags = syncTags(st, b.tags.map(String));
      // 同步正文：目标片段标题 label 与围栏语言（massCode 片段结构一致性）
      const tgtIdx = fm.meta.contents.indexOf(tgt);
      if (tgtIdx >= 0) {
        const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
        const headsPos = [];
        let hm;
        while ((hm = headingRe.exec(fm.body))) headsPos.push({ label: hm[1].trim(), start: hm.index, len: hm[0].length });
        if (headsPos[tgtIdx]) {
          const h = headsPos[tgtIdx];
          const changedHead = (b.name !== undefined || b.label !== undefined) && tgt.label !== h.label;
          let delta = 0;
          if (changedHead) {
            const newHead = '## Fragment: ' + tgt.label;
            fm.body = fm.body.slice(0, h.start) + newHead + fm.body.slice(h.start + h.len);
            delta = newHead.length - h.len;
          }
          if (b.language !== undefined) {
            const segStart0 = h.start + h.len + fm.body.slice(h.start + h.len).indexOf('\n') + 1;
            const segStart = segStart0 + delta;
            const segEnd = headsPos[tgtIdx + 1] ? headsPos[tgtIdx + 1].start + delta : fm.body.length;
            const seg = fm.body.slice(segStart, segEnd);
            const fence = /^```[^\n]*/m.exec(seg);
            if (fence) {
              const abs = segStart + fence.index;
              fm.body = fm.body.slice(0, abs) + '```' + tgt.language + fm.body.slice(abs + fence[0].length);
            }
          }
        }
      }
      // 写回 .md
      const newMd = stringifyFrontmatter(fm);
      writeFileAtomicSync(full, newMd, 'utf8');
      // 同步 state.json
      const sm = snip.meta;
      if (b.name !== undefined && fm.meta.name) sm.name = fm.meta.name;
      if (b.language !== undefined) { sm.language = tgt.language; }
      const sic = sm.contents.find((c) => String(c.id) === String(fragId)) || sm.contents[0];
      if (b.language !== undefined) sic.language = tgt.language;
      if (b.name !== undefined && tgt.label) sic.label = tgt.label;
      if (b.label !== undefined && tgt.label) sic.label = tgt.label;
      if (b.description !== undefined) sm.description = fm.meta.description ? fm.meta.description : null;
      if (Array.isArray(b.tags)) sm.tags = fm.meta.tags;
      sm.mtimeMs = now; sm.updatedAt = now; sm.size = Buffer.byteLength(newMd);
      writeState(st);
      return send(res, 200, { ok: true, file: full, name: fm.meta.name, label: tgt.label, language: tgt.language, tags: fm.meta.tags, description: fm.meta.description });
    }
    // 新增片段：在当前文件末尾追加一个 Fragment（正文 + frontmatter contents + state.json 同步）
    if (req.method === 'POST' && u.pathname === '/api/fs/addfragment') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = adoptSnippetFromDisk(st, b.file);
      if (!snip) return send(res, 200, { ok: false, error: '片段不存在或未登记（磁盘上没有该文件）' });
      const full = path.resolve(codeRoot, snip.filePath);
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      const language = String(b.language || 'plain_text').trim() || 'plain_text';
      const label = String(b.label || '').trim() || ('片段 ' + ((snip.meta.contents || []).length + 1));
      const text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.meta || !Array.isArray(fm.meta.contents)) return send(res, 200, { ok: false, error: 'frontmatter 解析失败' });
      const cid = ++st.counters.contentId;
      const now = Date.now();
      const newItem = { id: cid, label, language };
      fm.meta.contents.push(newItem);
      const bodyEnd = fm.body.replace(/\s+$/, '');
      fm.body = bodyEnd + '\n\n## Fragment: ' + label + '\n```' + language + '\n\n```\n';
      const newMd = stringifyFrontmatter(fm);
      writeFileAtomicSync(full, newMd, 'utf8');
      snip.meta.contents.push(newItem);
      snip.meta.mtimeMs = now; snip.meta.updatedAt = now; snip.meta.size = Buffer.byteLength(newMd);
      writeState(st);
      return send(res, 200, { ok: true, file: full, fragment: newItem, index: fm.meta.contents.length - 1 });
    }
    // 删除片段：从正文移除对应 "## Fragment: xxx" 段 + frontmatter contents 移除 + state.json 同步
    if (req.method === 'POST' && u.pathname === '/api/fs/delfragment') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = adoptSnippetFromDisk(st, b.file);
      if (!snip) return send(res, 200, { ok: false, error: '片段不存在或未登记（磁盘上没有该文件）' });
      const full = path.resolve(codeRoot, snip.filePath);
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      const fragId = Number(b.fragmentId);
      const text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.meta || !Array.isArray(fm.meta.contents) || !fm.meta.contents.length) return send(res, 200, { ok: false, error: 'frontmatter 解析失败' });
      const idx = fm.meta.contents.findIndex((c) => String(c.id) === String(fragId));
      if (idx < 0) return send(res, 200, { ok: false, error: '片段不存在' });
      if (fm.meta.contents.length <= 1) return send(res, 200, { ok: false, error: '文件至少保留一个片段（可删除整个文件）' });
      const removed = fm.meta.contents[idx];
      fm.meta.contents.splice(idx, 1);
      // 删除正文对应段：从 "## Fragment:" 标题行首 到 下一个标题行首（内容随标题一并移除）
      const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
      const headsPos = [];
      let hm;
      while ((hm = headingRe.exec(fm.body))) headsPos.push({ start: hm.index });
      if (headsPos[idx]) {
        const h = headsPos[idx];
        const segEnd = headsPos[idx + 1] ? headsPos[idx + 1].start : fm.body.length;
        fm.body = fm.body.slice(0, h.start) + fm.body.slice(segEnd);
        fm.body = fm.body.replace(/\n{3,}/g, '\n\n');
      }
      const newMd = stringifyFrontmatter(fm);
      writeFileAtomicSync(full, newMd, 'utf8');
      const now = Date.now();
      snip.meta.contents = snip.meta.contents.filter((c) => String(c.id) !== String(fragId));
      snip.meta.mtimeMs = now; snip.meta.updatedAt = now; snip.meta.size = Buffer.byteLength(newMd);
      writeState(st);
      return send(res, 200, { ok: true, file: full, removed: removed, remaining: fm.meta.contents.length });
    }
    if (req.method === 'GET' && u.pathname === '/api/git') {
      return send(res, 200, await gitStatus());
    }
    if (req.method === 'GET' && u.pathname === '/api/git/diff') {
      try { return send(res, 200, await gitFileDiff(u.searchParams.get('path'))); }
      catch (e) { return send(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/timeline') {
      try {
        const file = u.searchParams.get('file'), fragment = Number(u.searchParams.get('fragment'));
        const snip = walkSnippets().find((item) => item.file === file);
        if (!snip || !snip.fragments[fragment]) return send(res, 404, { ok: false, error: '片段不存在' });
        const target = timelineTarget(file, fragment);
        return send(res, 200, { ok: true, file: target.relative, fragment, entries: timelineEntries(target) });
      } catch (e) { return send(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/timeline/item') {
      try {
        const file = u.searchParams.get('file'), fragment = Number(u.searchParams.get('fragment'));
        const snip = walkSnippets().find((item) => item.file === file);
        if (!snip || !snip.fragments[fragment]) return send(res, 404, { ok: false, error: '片段不存在' });
        return send(res, 200, await timelineItem(file, fragment, u.searchParams.get('id'), snip.fragments[fragment].code));
      } catch (e) { return send(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/timeline/restore') {
      const b = await readBody(req);
      try {
        const fragment = Number(b.fragment), snip = walkSnippets().find((item) => item.file === b.file);
        if (!snip || !snip.fragments[fragment]) return send(res, 404, { ok: false, error: '片段不存在' });
        const saved = await timelineItem(b.file, fragment, b.id, snip.fragments[fragment].code);
        recordTimeline(b.file, fragment, snip.fragments[fragment].code, '恢复前版本', true);
        const written = writeBackFragment(b.file, snip.fragments[fragment], saved.code.replace(/\n+$/, ''));
        if (!written) return send(res, 500, { ok: false, error: '恢复失败：未能定位片段代码块' });
        return send(res, 200, { ok: true, message: '已恢复历史版本', code: saved.code });
      } catch (e) { return send(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/delete') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const full = path.resolve(codeRoot, String(b.file || ''));
      const snip = adoptSnippetFromDisk(st, full);
      if (!snip) return send(res, 200, { ok: false, error: '片段不存在或未登记（磁盘上没有该文件）' });
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      // 从状态库移除
      st.snippets = st.snippets.filter((s) => s !== snip);
      // 清理不再被引用的标签
      const used = new Set();
      st.snippets.forEach((s) => (s.meta.tags || []).forEach((t) => used.add(t)));
      if (Array.isArray(st.tags)) st.tags = st.tags.filter((t) => used.has(t.id));
      writeState(st);
      // 删除磁盘上的 .md
      try { fs.unlinkSync(full); } catch (_) {}
      // 若所在叶子目录已空，清理该目录的 .meta.yaml 与空目录（保留根与上层）
      const dir = path.dirname(full);
      if (dir !== codeRoot && fs.existsSync(dir)) {
        const rest = fs.readdirSync(dir).filter((n) => n !== '.meta.yaml');
        if (rest.length === 0) {
          try { fs.unlinkSync(path.join(dir, '.meta.yaml')); } catch (_) {}
          try { fs.rmdirSync(dir); } catch (_) {}
          const st2 = readState();
          const rel = path.relative(codeRoot, dir).split(path.sep).join('/');
          const fid = st2.folderIdByPath[rel];
          if (fid !== undefined) {
            delete st2.folderIdByPath[rel];
            delete st2.folderUi[fid];
          }
          writeState(st2);
        }
      }
      return send(res, 200, { ok: true, file: full });
    }
    // 删除文件夹（含其下所有片段与子文件夹，双清：状态库 + 磁盘）
    if (req.method === 'POST' && u.pathname === '/api/fs/delete-folder') {
      const b = await readBody(req);
      const rel = String(b.folder || '').replace(/^\/+|\/+$/g, '');
      const segs = rel.split('/');
      if (!rel || segs.some((s) => !s || s === '.' || s === '..')) return send(res, 200, { ok: false, error: '文件夹路径不合法' });
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = path.join(codeRoot, rel);
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      if (!fs.existsSync(dir)) return send(res, 200, { ok: false, error: '文件夹不存在' });
      const prefix = rel + '/';
      const st = readState();
      const removed = st.snippets.filter((s) => s.filePath === rel || s.filePath.startsWith(prefix));
      st.snippets = st.snippets.filter((s) => !(s.filePath === rel || s.filePath.startsWith(prefix)));
      const delKeys = Object.keys(st.folderIdByPath || {}).filter((k) => k === rel || k.startsWith(prefix));
      for (const k of delKeys) {
        const fid = st.folderIdByPath[k];
        delete st.folderIdByPath[k];
        if (fid !== undefined && st.folderUi) delete st.folderUi[fid];
      }
      const used = new Set();
      st.snippets.forEach((s) => (s.meta.tags || []).forEach((t) => used.add(t)));
      if (Array.isArray(st.tags)) st.tags = st.tags.filter((t) => used.has(t.id));
      writeState(st);
      let disk = false;
      try { fs.rmSync(dir, { recursive: true, force: true }); disk = true; } catch (_) {}
      return send(res, 200, { ok: true, folder: rel, deletedSnippets: removed.length, removedFolders: delKeys.length, disk });
    }
    /* ------------------------------ 绘图（Excalidraw / Draw.io / XMind） ------------------------------ */
    function drawingsDir() { return path.join(vaultPath(), 'drawings'); }
    function drawingName(n) {
      if (typeof n !== 'string') return null;
      const base = n.split(/[\\/]/).map((s) => s.trim()).filter(Boolean).join('/');
      if (!base) return null;
      if (base.indexOf('\\') >= 0) return null;
      if (/(^|\/)\.{1,2}(\/|$)|^\/|\/\/|^[A-Za-z]:/.test(base)) return null;   // 防穿越：拒绝 ..、前导 /、//、盘符
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff /]+$/.test(base)) return null;          // 每段仅合法字符（保留中文/空格，分隔符允许 /）
      if (!/\.(?:excalidraw|drawio|xmind)$/i.test(base)) return null;
      return base;
    }
    function drawingKind(name) {
      const value = String(name || '');
      return /\.drawio$/i.test(value) ? 'drawio' : (/\.xmind$/i.test(value) ? 'xmind' : 'excalidraw');
    }
    function xmindId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 26); }
    function newXmindWorkbook(title) {
      return [{ id:xmindId(), class:'sheet', title:'画布 1', rootTopic:{ id:xmindId(), class:'topic', title:String(title || '中心主题'), structureClass:'org.xmind.ui.logic.right', children:{ attached:[] } } }];
    }
    function inspectXmindWorkbook(workbook) {
      if (!Array.isArray(workbook) || !workbook.length || workbook.length > 100) return { ok:false, error:'XMind 必须包含 1–100 个画布' };
      let nodes = 0;
      const walk = (topic, depth) => {
        if (!topic || typeof topic !== 'object' || Array.isArray(topic)) throw new Error('主题结构无效');
        if (depth > 128) throw new Error('主题层级超过 128 层');
        nodes += 1; if (nodes > 20000) throw new Error('主题数量超过 20000');
        if (topic.title != null && (typeof topic.title !== 'string' || topic.title.length > 20000)) throw new Error('主题标题无效');
        const children = topic.children && typeof topic.children === 'object' ? topic.children : {};
        for (const group of ['attached', 'detached', 'summary']) {
          const list = children[group];
          if (list != null && !Array.isArray(list)) throw new Error(group + ' 主题结构无效');
          for (const child of list || []) walk(child, depth + 1);
        }
      };
      try {
        for (const sheet of workbook) {
          if (!sheet || typeof sheet !== 'object' || !sheet.rootTopic) throw new Error('画布缺少根主题');
          walk(sheet.rootTopic, 1);
        }
      } catch (error) { return { ok:false, error:'XMind 结构错误：' + String(error.message || error) }; }
      return { ok:true, sheets:workbook.length, nodes };
    }
    function readXmindFile(file) {
      const entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
      if (!entries['content.json']) throw new Error('缺少 content.json，可能是旧版或加密 XMind 文件');
      const workbook = JSON.parse(strFromU8(entries['content.json']));
      const checked = inspectXmindWorkbook(workbook);
      if (!checked.ok) throw new Error(checked.error);
      const thumbnailBytes = entries['Thumbnails/thumbnail.png'];
      const thumbnail = thumbnailBytes && thumbnailBytes.length <= 15 * 1024 * 1024
        ? 'data:image/png;base64,' + Buffer.from(thumbnailBytes).toString('base64')
        : '';
      return { workbook, thumbnail, hasThumbnail:!!thumbnailBytes, ...checked };
    }
    function writeXmindFile(file, workbook) {
      const checked = inspectXmindWorkbook(workbook);
      if (!checked.ok) throw new Error(checked.error);
      let entries = {};
      try { if (fs.existsSync(file)) entries = unzipSync(new Uint8Array(fs.readFileSync(file))); } catch (_) { entries = {}; }
      entries['content.json'] = strToU8(JSON.stringify(workbook));
      if (!entries['metadata.json']) entries['metadata.json'] = strToU8(JSON.stringify({ creator:{ name:'CodeScope', version:APP_VERSION }, dataStructureVersion:'3' }));
      if (!entries['manifest.json']) entries['manifest.json'] = strToU8(JSON.stringify({ 'file-entries':{ 'content.json':{}, 'metadata.json':{} } }));
      const zipped = Buffer.from(zipSync(entries, { level:6 }));
      const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
      fs.writeFileSync(tmp, zipped);
      fs.renameSync(tmp, file);
      return { bytes:zipped.length, ...checked };
    }
    function inspectDrawioXml(value) {
      const xml = String(value || '').trim();
      if (!xml || xml.length > 40e6) return { ok:false, error:'Draw.io XML 为空或超过 40 MB' };
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { ok:false, error:'Draw.io XML 不允许包含 DOCTYPE 或外部实体' };
      if (xml[0] !== '<') return { ok:false, error:'不是 XML 文档' };
      let rootName = '', pages = 0;
      const ids = [], idSet = new Set(), refs = [];
      const parser = new SaxesParser({ xmlns:false });
      parser.on('opentag', (node) => {
        if (!rootName) rootName = node.name;
        if (node.name === 'diagram') pages += 1;
        if (node.name !== 'mxCell') return;
        const id = String(node.attributes.id || '');
        if (!id) throw new Error('存在缺少 id 的 mxCell');
        if (idSet.has(id)) throw new Error('存在重复的 mxCell id：' + id);
        idSet.add(id); ids.push(id);
        for (const name of ['parent', 'source', 'target']) {
          const ref = node.attributes[name];
          if (ref != null && String(ref)) refs.push({ id, name, value:String(ref) });
        }
      });
      try { parser.write(xml).close(); }
      catch (error) { return { ok:false, error:'Draw.io XML 语法错误：' + String(error.message || error).replace(/^\d+:\d+:\s*/, '').slice(0, 220) }; }
      if (!['mxfile', 'mxGraphModel'].includes(rootName)) return { ok:false, error:'根节点必须是 mxfile 或 mxGraphModel' };
      if (ids.length) {
        if (!idSet.has('0') || !idSet.has('1')) return { ok:false, error:'未找到 Draw.io 必需的根单元 id=0 和默认层 id=1' };
        for (const ref of refs) if (!idSet.has(ref.value)) return { ok:false, error:'mxCell ' + ref.id + ' 的 ' + ref.name + ' 引用了不存在的 id：' + ref.value };
      }
      return { ok:true, format:ids.length ? 'uncompressed' : 'compressed', cells:ids.length, pages:rootName === 'mxGraphModel' ? 1 : pages, bytes:Buffer.byteLength(xml, 'utf8') };
    }
    function drawingDir2(n) {   // 目录路径校验：允许 ''（根）或 'a/b'（防穿越）
      if (typeof n !== 'string') return '';
      const base = n.split(/[\\/]/).map((s) => s.trim()).filter(Boolean).join('/');
      if (!base) return '';
      if (base.indexOf('\\') >= 0) return null;
      if (/(^|\/)\.{1,2}(\/|$)|^\/|\/\/|^[A-Za-z]:/.test(base)) return null;
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff /]+$/.test(base)) return null;
      return base;
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/list') {
      const dir = drawingsDir();
      let out = [];
      try {
        if (fs.existsSync(dir)) {
          out = fs.readdirSync(dir)
            .filter((n) => drawingName(n))
            .map((n) => {
              try {
                const st = fs.statSync(path.join(dir, n));
                return { name: n, size: st.size, updated: st.mtimeMs };
              } catch (_) { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.updated - a.updated);
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, drawings: out });
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/tree') {
      const dir = drawingsDir();
      const root = { type: 'folder', name: '', path: '', children: [], count: 0 };
      const walk = (node, abs) => {
        let entries = [];
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) {}
        entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        let n = 0;
        for (const ent of entries) {
          if (ent.isDirectory()) {
            const rel = node.path ? node.path + '/' + ent.name : ent.name;
            const fnode = { type: 'folder', name: ent.name, path: rel, children: [], count: 0 };
            node.children.push(fnode);
            fnode.count = walk(fnode, path.join(abs, ent.name));
            n += fnode.count;
          } else if (drawingName(ent.name)) {
            const rel = node.path ? node.path + '/' + ent.name : ent.name;
            let size = 0, updated = 0;
            try { const st = fs.statSync(path.join(abs, ent.name)); size = st.size; updated = st.mtimeMs; } catch (_) {}
            node.children.push({ type: 'drawing', name: ent.name, path: rel, size, updated });
            n += 1;
          }
        }
        node.count = n;
        return n;
      };
      walk(root, dir);
      return send(res, 200, { ok: true, dir, root, total: root.count });
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/get') {
      const name = drawingName(u.searchParams.get('name'));
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        const target = path.join(drawingsDir(), name);
        if (drawingKind(name) === 'xmind') return send(res, 200, { ok:true, name, kind:'xmind', ...readXmindFile(target) });
        const raw = fs.readFileSync(target, 'utf8');
        if (drawingKind(name) === 'drawio') return send(res, 200, { ok: true, name, kind: 'drawio', xml: raw });
        const scene = JSON.parse(raw);
        return send(res, 200, { ok: true, name, kind: 'excalidraw', ...scene });
      } catch (error) { return send(res, 200, { ok: false, error: '读取失败（文件不存在或绘图格式无效）：' + String(error && error.message || error).slice(0, 220) }); }
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && u.pathname === '/api/drawings/file') {
      const name = drawingName(u.searchParams.get('name'));
      if (!name || drawingKind(name) !== 'xmind') return send(res, 400, { ok:false, error:'仅支持读取 XMind 原文件' });
      return streamStatic(req, res, drawingsDir(), name, { cacheControl:'no-cache', notFound:'XMind 文件不存在' });
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/save') {
      const b = await readBody(req);
      const name = drawingName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const data = b.data;
      const dir = drawingsDir();
      const target = path.join(dir, name);          // name 可含 '/' 子路径，防穿越已校验
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch (_) {}
      let body, result;
      if (drawingKind(name) === 'xmind') {
        try { result = writeXmindFile(target, data && data.workbook); }
        catch (error) { return send(res, 200, { ok:false, error:'XMind 写入失败：' + String(error.message || error) }); }
        return send(res, 200, { ok:true, name, ...result });
      } else if (drawingKind(name) === 'drawio') {
        body = data && typeof data.xml === 'string' ? data.xml : '';
        const inspection = inspectDrawioXml(body);
        if (!inspection.ok) return send(res, 200, inspection);
      } else {
        if (!data || typeof data !== 'object' || !Array.isArray(data.elements)) return send(res, 200, { ok: false, error: '缺少 Excalidraw 场景数据' });
        body = JSON.stringify({ type: 'excalidraw', version: 2, source: 'file://', elements: data.elements, appState: data.appState || {}, files: data.files || {} });
      }
      try { writeFileAtomicSync(target, body); return send(res, 200, { ok: true, name, bytes: body.length }); }
      catch (e) { return send(res, 200, { ok: false, error: '写入失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/validate') {
      const b = await readBody(req);
      return send(res, 200, inspectDrawioXml(b && b.xml));
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/new') {
      const b = await readBody(req);
      const sub = drawingDir2(b && b.dir);          // 目标目录（'' = 根）
      if (sub === null) return send(res, 200, { ok: false, error: '目录不合法' });
      const kind = b && ['drawio', 'xmind'].includes(b.kind) ? b.kind : 'excalidraw';
      const ext = kind === 'drawio' ? '.drawio' : (kind === 'xmind' ? '.xmind' : '.excalidraw');
      const baseRaw = String((b && b.name) || '').replace(/\.(?:excalidraw|drawio|xmind)$/i, '').trim();
      const base = baseRaw || 'Untitled';
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+$/.test(base) || base === '.' || base === '..') return send(res, 200, { ok: false, error: '名称不合法' });
      const dirAbs = path.join(drawingsDir(), sub || '.');
      try { fs.mkdirSync(dirAbs, { recursive: true }); } catch (_) {}
      let name = base + ext, i = 2;
      while (true) {
        if (!fs.existsSync(path.join(dirAbs, name))) break;
        name = base + '-' + i + ext; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      const full = sub ? sub + '/' + name : name;
      const scene = kind === 'drawio'
        ? '<mxfile host="CodeScope"><diagram id="page-1" name="Page-1"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
        : (kind === 'xmind' ? newXmindWorkbook(base) : { type: 'excalidraw', version: 2, source: 'file://', elements: [], appState: {}, files: {} });
      try {
        if (kind === 'xmind') {
          const info = writeXmindFile(path.join(dirAbs, name), scene);
          return send(res, 200, { ok:true, name:full, dir:sub, kind, workbook:scene, ...info });
        }
        writeFileAtomicSync(path.join(dirAbs, name), kind === 'drawio' ? scene : JSON.stringify(scene));
        return send(res, 200, kind === 'drawio' ? { ok: true, name: full, dir: sub, kind, xml: scene } : { ok: true, name: full, dir: sub, kind, ...scene });
      } catch (e) { return send(res, 200, { ok: false, error: '创建失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/new-folder') {
      const b = await readBody(req);
      const parent = drawingDir2(b && b.dir);       // 父目录（'' = 根）
      if (parent === null) return send(res, 200, { ok: false, error: '目录不合法' });
      const sub = drawingDir2(b && b.name);         // 新建目录名（可含 / 嵌套）
      if (!sub || sub === '.') return send(res, 200, { ok: false, error: '文件夹名称不合法' });
      const full = parent ? parent + '/' + sub : sub;
      try {
        fs.mkdirSync(path.join(drawingsDir(), full), { recursive: true });
        return send(res, 200, { ok: true, path: full });
      } catch (e) { return send(res, 200, { ok: false, error: '创建失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/delete') {
      const b = await readBody(req);
      const name = drawingName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        fs.unlinkSync(path.join(drawingsDir(), name));
        return send(res, 200, { ok: true, name });
      } catch (_) { return send(res, 200, { ok: false, error: '删除失败（文件不存在或已被占用）' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/rename') {
      const b = await readBody(req);
      const name = drawingName(b && b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const kind = drawingKind(name);
      const ext = kind === 'drawio' ? '.drawio' : (kind === 'xmind' ? '.xmind' : '.excalidraw');
      const baseRaw = String((b && b.newName) || '').replace(/\.(?:excalidraw|drawio|xmind)$/i, '').trim();
      if (!baseRaw) return send(res, 200, { ok: false, error: '名称不合法' });
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+$/.test(baseRaw) || baseRaw === '.' || baseRaw === '..' || /[\\/]/.test(baseRaw)) return send(res, 200, { ok: false, error: '名称不合法（仅当前文件夹内命名）' });
      const parts = name.split('/');
      const dir = parts.slice(0, -1).join('/');
      const dirAbs = dir ? path.join(drawingsDir(), dir) : drawingsDir();
      const oldFile = parts[parts.length - 1];
      const oldAbs = path.join(dirAbs, oldFile);
      let target = baseRaw + ext, i = 2;
      while (fs.existsSync(path.join(dirAbs, target)) && path.basename(target).toLowerCase() !== oldFile.toLowerCase()) {
        target = baseRaw + '-' + i + ext; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      try {
        if (target === oldFile) return send(res, 200, { ok: true, name, unchanged: true });
        const newAbs = path.join(dirAbs, target);
        if (target.toLowerCase() === oldFile.toLowerCase()) {
          // 仅大小写不同（macOS 不区分大小写）：先经临时名绕行，再改回目标大小写
          const tmp = path.join(dirAbs, '.' + Date.now() + '.tmp' + ext);
          fs.renameSync(oldAbs, tmp);
          fs.renameSync(tmp, newAbs);
        } else {
          fs.renameSync(oldAbs, newAbs);
        }
        const full = dir ? dir + '/' + target : target;
        return send(res, 200, { ok: true, name: full });
      } catch (_) { return send(res, 200, { ok: false, error: '重命名失败（文件不存在或已被占用）' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/move') {
      const b = await readBody(req);
      const name = drawingName(b && b.name);
      const toDir = drawingDir2(b && b.toDir);
      if (!name || toDir === null) return send(res, 200, { ok: false, error: '路径不合法' });
      const fromFile = name.split('/').pop();
      const full = toDir ? toDir + '/' + fromFile : fromFile;
      if (full === name) return send(res, 200, { ok: true, name, unchanged: true });
      const dirAbs = path.join(drawingsDir(), toDir || '.');
      try { fs.mkdirSync(dirAbs, { recursive: true }); } catch (_) {}
      // 目标文件夹已有同名文件 → 自动 -2、-3 避冲突（移动不改文件名）
      let target = fromFile, i = 2;
      while (fs.existsSync(path.join(dirAbs, target)) && (toDir ? toDir + '/' + target : target) !== name) {
        const kind = drawingKind(fromFile);
        const ext = kind === 'drawio' ? '.drawio' : (kind === 'xmind' ? '.xmind' : '.excalidraw');
        target = fromFile.replace(/\.(?:excalidraw|drawio|xmind)$/i, '') + '-' + i + ext; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      try {
        fs.renameSync(path.join(drawingsDir(), name), path.join(dirAbs, target));
        return send(res, 200, { ok: true, name: (toDir ? toDir + '/' : '') + target });
      } catch (_) { return send(res, 200, { ok: false, error: '移动失败（文件不存在或已被占用）' }); }
    }
    // ---- Libraries（Excalidraw 库：vault/libraries/*.excalidrawLibrary，文件夹管理 + 自动加载） ----
    function libsDir() { return path.join(vaultPath(), 'libraries'); }
    function libName(n) {
      if (typeof n !== 'string') return null;
      const base = n.split(/[\\/]/).pop();
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+\.excalidraw(library|lib)$/i.test(base)) return null;
      return base;
    }
    function readLibItems(file) {
      try {
        const p = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (p && Array.isArray(p.libraryItems)) return p.libraryItems;
      } catch (_) {}
      return null;
    }
    function mergeLibItems(lists) {
      const out = [], seen = new Set();
      for (const items of lists) {
        if (!Array.isArray(items)) continue;
        for (const it of items) {
          if (it && typeof it === 'object' && it.id && !seen.has(it.id) && Array.isArray(it.elements)) { seen.add(it.id); out.push(it); }
        }
      }
      return out;
    }
    if (req.method === 'GET' && u.pathname === '/api/libraries/list') {
      const dir = libsDir();
      let out = [];
      try {
        if (fs.existsSync(dir)) {
          out = fs.readdirSync(dir)
            .filter((n) => libName(n))
            .map((n) => {
              try { const st = fs.statSync(path.join(dir, n)); return { name: n, size: st.size, updated: st.mtimeMs }; }
              catch (_) { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.updated - a.updated);
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, libraries: out });
    }
    if (req.method === 'GET' && u.pathname === '/api/libraries/all') {
      const dir = libsDir();
      const lists = [], files = [];
      try {
        if (fs.existsSync(dir)) {
          for (const n of fs.readdirSync(dir).filter((fn) => libName(fn))) {
            const items = readLibItems(path.join(dir, n));
            if (items !== null) { lists.push(items); files.push(n); }
          }
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, files, items: mergeLibItems(lists) });
    }
    if (req.method === 'POST' && u.pathname === '/api/libraries/save') {
      const b = await readBody(req);
      const name = libName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const data = b.data;
      if (!data || typeof data !== 'object' || !Array.isArray(data.libraryItems)) return send(res, 200, { ok: false, error: '缺少库数据（libraryItems 数组）' });
      const dir = libsDir();
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      const body = JSON.stringify({ type: 'excalidrawLibrary', version: 2, source: 'file://', libraryItems: data.libraryItems });
      try { writeFileAtomicSync(path.join(dir, name), body); return send(res, 200, { ok: true, name, bytes: body.length }); }
      catch (e) { return send(res, 200, { ok: false, error: '写入失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/libraries/delete') {
      const b = await readBody(req);
      const name = libName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        fs.unlinkSync(path.join(libsDir(), name));
        return send(res, 200, { ok: true, name });
      } catch (_) { return send(res, 200, { ok: false, error: '删除失败（文件不存在或已被占用）' }); }
    }
    // ---- 实时联网搜索（仅访问固定的 Tavily / Brave 官方 API；密钥不落盘） ----
    if (req.method === 'POST' && u.pathname === '/api/ai/web-search') {
      const b=await readBody(req);
      const provider=String((b&&b.provider)||'').trim().toLowerCase();
      const key=String((b&&b.key)||'').trim();
      const query=String((b&&b.query)||'').trim();
      if(!['tavily','brave'].includes(provider)) return send(res,400,{ok:false,error:'请选择 Tavily 或 Brave Search'});
      if(!key||key.length>500) return send(res,400,{ok:false,error:'联网搜索 API Key 缺失或不合法'});
      if(!query||query.length>800) return send(res,400,{ok:false,error:'搜索问题不能为空且不能超过 800 字'});
      try {
        const result=await liveWebSearch(provider,key,query);
        if(!result.results.length) return send(res,200,{ok:false,error:'搜索服务没有返回可用网页',provider,searchedAt:result.searchedAt,results:[]});
        return send(res,200,result);
      } catch (error) {
        return send(res,200,{ok:false,error:'联网搜索失败: '+String((error&&error.message)||error).slice(0,400),provider,searchedAt:new Date().toISOString(),results:[]});
      }
    }
    // ---- AI 助手（OpenAI 兼容代理：URL/Key/模型由前端配置，服务器只做转发） ----
    if (req.method === 'POST' && u.pathname === '/api/ai/chat') {
      const b = await readBody(req);
      const url = String((b && b.url) || '').trim();
      const key = String((b && b.key) || '').trim();
      const model = String((b && b.model) || '').trim();
      const rawMessages = b && Array.isArray(b.messages) ? b.messages : null;
      const requestedTimeoutMs = Number(b && b.timeoutMs);
      const timeoutMs = Number.isFinite(requestedTimeoutMs)
        ? Math.max(30000, Math.min(600000, Math.round(requestedTimeoutMs)))
        : 120000;
      let endpoint;
      try { endpoint = new URL(url); } catch (_) { return send(res, 400, { ok:false, error:'API URL 不合法（需 http/https 开头）' }); }
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || url.length > 2048) return send(res, 400, { ok:false, error:'API URL 不合法（仅支持不含账号密码的 http/https 地址）' });
      if (!model || model.length > 200) return send(res, 400, { ok:false, error:'请填写有效的模型名称' });
      if (key.length > 10000) return send(res, 400, { ok:false, error:'API Key 长度不合法' });
      if (!rawMessages || !rawMessages.length || rawMessages.length > 100) return send(res, 400, { ok:false, error:'消息数量必须在 1–100 条之间' });
      const messages = [];
      let messageBytes = 0;
      for (const item of rawMessages) {
        const role = String(item && item.role || '');
        const content = item && typeof item.content === 'string' ? item.content : '';
        if (!['system', 'user', 'assistant'].includes(role) || !content) return send(res, 400, { ok:false, error:'消息格式不正确' });
        messageBytes += Buffer.byteLength(content, 'utf8');
        messages.push({ role, content });
      }
      if (messageBytes > 600000) return send(res, 413, { ok:false, error:'AI 上下文超过 600 KB，请缩小项目或当前图上下文' });
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
          body: JSON.stringify({ model, messages, stream: false, temperature: 0.3 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const responseBytes = Number(resp.headers.get('content-length') || 0);
        if (Number.isFinite(responseBytes) && responseBytes > 12 * 1024 * 1024) {
          try { if (resp.body) await resp.body.cancel(); } catch (_) {}
          return send(res, 200, { ok:false, error:'AI 返回内容超过 12 MB，已停止读取' });
        }
        const text = await resp.text();
        if (Buffer.byteLength(text, 'utf8') > 12 * 1024 * 1024) return send(res, 200, { ok:false, error:'AI 返回内容超过 12 MB' });
        if (!resp.ok) return send(res, 200, { ok: false, error: 'API 错误 ' + resp.status + ': ' + text.slice(0, 400) });
        let data;
        try { data = JSON.parse(text); } catch (_) { return send(res, 200, { ok: false, error: 'API 返回非 JSON 内容' }); }
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (typeof content !== 'string') return send(res, 200, { ok: false, error: '无法解析响应（缺少 choices[0].message.content）' });
        return send(res, 200, { ok: true, content, model, usage: (data && data.usage) || null });
      } catch (e) {
        const detail = String((e && e.message) || e);
        const timedOut = (e && e.name === 'TimeoutError') || /aborted due to timeout|timed?\s*out/i.test(detail);
        return send(res, 200, { ok: false, timeout: timedOut, error: timedOut
          ? `请求超时：AI 服务在 ${Math.round(timeoutMs / 1000)} 秒内未完成响应。请重试，或改用响应更快的模型。`
          : '请求失败: ' + detail.slice(0, 300) });
      }
    }
    if (req.method === 'POST' && u.pathname === '/api/git/commit') {
      const b = await readBody(req);
      const msg = String(b.message || '').trim();
      if (!msg) return send(res, 200, { ok: false, error: '提交信息不能为空' });
      const add = await gitRun(['add', '-A']);
      if (!add.ok) return send(res, 200, { ok: false, error: 'git add 失败: ' + add.error });
      const cm = await gitRun(['commit', '-m', msg]);
      if (!cm.ok) return send(res, 200, { ok: false, error: 'git commit 失败: ' + cm.error, output: (cm.stdout + cm.stderr).trim() });
      return send(res, 200, { ok: true, message: '已提交', output: (cm.stdout + cm.stderr).trim(), status: await gitStatus() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/push') {
      const r = await gitRun(['push'], 120000);
      return send(res, 200, r.ok
        ? { ok: true, message: '推送成功', output: (r.stdout + r.stderr).trim(), status: await gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/pull') {
      const r = await gitRun(['pull'], 120000);
      return send(res, 200, r.ok
        ? { ok: true, message: '拉取成功', output: (r.stdout + r.stderr).trim(), status: await gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/reset') {
      const b = await readBody(req);
      const hash = String(b.hash || '').trim();
      if (!/^[0-9a-f]{4,40}$/i.test(hash)) return send(res, 200, { ok: false, error: '提交标识不合法' });
      const r = await gitRun(['reset', '--hard', hash], 60000);
      return send(res, 200, r.ok
        ? { ok: true, message: '已回退到 ' + hash, output: (r.stdout + r.stderr).trim(), status: await gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    // ===== 通用工程能力 =====
    if (req.method === 'GET' && u.pathname === '/api/project/tasks') return send(res, 200, taskCatalog());
    if (req.method === 'GET' && u.pathname === '/api/project/tests') return send(res, 200, testCatalog());
    if (req.method === 'POST' && u.pathname === '/api/project/tests/run') {
      const b=await readBody(req),catalog=testCatalog(),test=catalog.tests.find((item)=>item.id===String(b.id||''));
      if(!test)return send(res,400,{ok:false,error:'测试任务不存在，请刷新后重试'});
      return send(res,200,await runProjectCommand(test.command,test.cwd));
    }
    if (req.method === 'GET' && u.pathname === '/api/project/debug') return send(res, 200, debugCatalog());
    if (req.method === 'POST' && u.pathname === '/api/project/tasks/run') {
      const b = await readBody(req), catalog = taskCatalog();
      let command = String(b.command || '').trim(), cwd = String(b.cwd || '.');
      if (b.id) {
        const task = catalog.tasks.find((item) => item.id === String(b.id));
        if (!task) return send(res, 400, { ok:false, error:'构建任务不存在，请刷新后重试' });
        command = task.command; cwd = task.cwd;
      }
      return send(res, 200, await runProjectCommand(command, cwd));
    }
    if (req.method === 'GET' && u.pathname === '/api/project/compile-db') {
      try { return send(res, 200, compileDatabaseInfo()); }
      catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/project/health') return send(res, 200, await projectHealth());
    if (req.method === 'GET' && u.pathname === '/api/lsp/status') return send(res, 200, LSP.status());
    if (req.method === 'POST' && u.pathname === '/api/lsp/query') {
      const b = await readBody(req), snippets = walkSnippets();
      const snippet = snippets.find((item) => item.file === String(b.file || ''));
      if (!snippet) return send(res, 404, { ok:false, error:'片段不存在（vault 可能已变动）' });
      const fragment = Number(b.fragment);
      if (!Number.isInteger(fragment) || fragment < 0 || fragment >= snippet.fragments.length) return send(res, 400, { ok:false, error:'片段索引无效' });
      const source = snippet.fragments[fragment];
      const action = String(b.action || 'hover');
      if (!['hover', 'definition', 'references', 'diagnostics', 'completion', 'signature', 'highlights', 'rename', 'codeAction'].includes(action)) return send(res, 400, { ok:false, error:'不支持的 LSP 操作' });
      const code = typeof b.code === 'string' ? b.code : source.code;
      if (Buffer.byteLength(code, 'utf8') > 2 * 1024 * 1024) return send(res, 413, { ok:false, error:'LSP 文件内容超过 2 MB' });
      return send(res, 200, await LSP.query({ snippet, fragment, language:source.language, code, action, line:b.line, column:b.column, newName:b.newName, triggerKind:b.triggerKind, triggerCharacter:b.triggerCharacter, range:b.range, only:b.only }));
    }
    // ===== 代码图谱：单文件多片段 → 符号索引 → 函数/文件子图（薄路由，计算在 lib/code-graph.js） =====
    if (req.method === 'GET' && u.pathname === '/api/graph') {
      try {
        /* file 必须真的用来收窄范围。原来直接 walkSnippets() 拿全库，
           file 参数被忽略 —— 传一个不存在的路径也会返回全库 230 个符号，
           ok 还是 true。前端拿它当某个文件的索引就会串味
           （实测：把临时项目的文件塞满全库符号，Sticky Scope 直接失灵）。 */
        const wanted = String(u.searchParams.get('file') || '').trim();
        const all = walkSnippets();
        const snippets = wanted ? all.filter((item) => item.file === wanted) : all;
        if (wanted && !snippets.length) return send(res, 404, { ok:false, error:'片段不存在（vault 可能已变动）' });
        /* 文档级图谱：把一个文档里所有片段/函数摊平（不需要 root）。
           前端那个「代码图谱」按钮走这条。 */
        if (String(u.searchParams.get('scope') || '') === 'document') {
          const doc = buildDocumentGraph(snippets);
          return send(res, 200, { ok:true, rev:computeRev(), scope:'document', ...doc });
        }
        const depth = Math.max(1, Math.min(5, Number(u.searchParams.get('depth')) || 3));
        const direction = String(u.searchParams.get('direction') || 'both');
        if (!['up', 'down', 'both'].includes(direction)) return send(res, 400, { ok:false, error:'direction 仅支持 up/down/both' });
        const result = buildCodeGraph(snippets, {
          rootFunction: String(u.searchParams.get('rootFunction') || '').slice(0, 500),
          rootFile: String(u.searchParams.get('rootFile') || '').slice(0, 1000),
          depth, direction,
        });
        if (!result.functionGraph.ok) return send(res, 404, result.functionGraph);
        if (!result.fileGraph.ok) return send(res, 404, result.fileGraph);
        return send(res, 200, { ok:true, rev:computeRev(), depth, direction, ...result });
      } catch (error) { return send(res, 500, { ok:false, error:String(error.message || error).slice(0, 300) }); }
    }
    // ===== 逻辑图：函数实现 ↔ 语句级控制流（薄路由，计算在 lib/logic-graph.js） =====
    if (req.method === 'POST' && u.pathname === '/api/logic/graph') {
      try {
        const b = await readBody(req, 3 * 1024 * 1024);
        const snippets = walkSnippets();
        let code = typeof b.code === 'string' ? b.code : '';
        let language = String(b.language || ''), name = String(b.name || 'fn').slice(0, 120);
        /* 函数体是**切片**出来再解析的，所以图里的行号是「函数内相对行」。
           这里记下偏移量，返回前加回去 —— 否则前端点节点跳转会整体错位
           （用户报过：图上写 L2，实际在编辑器第 27 行）。 */
        let lineOffset = 0;
        if (!code) {
          const snippet = snippets.find((item) => item.file === String(b.file || ''));
          if (!snippet) return send(res, 404, { ok:false, error:'片段不存在（vault 可能已变动）' });
          const fragment = Number(b.fragment);
          if (!Number.isInteger(fragment) || fragment < 0 || fragment >= snippet.fragments.length) return send(res, 400, { ok:false, error:'片段索引无效' });
          const source = snippet.fragments[fragment];
          language = language || source.language;
          const full = String(source.code || '');
          const line = Number(b.line);
          if (Number.isInteger(line) && line >= 1) {
            const idx = buildSnippetIndex(snippet);
            const hit = idx.find((s) => s.kind === 'fn' && s.frag === fragment && line >= s.line && line <= (s.endLine || s.line));
            const target = hit ? (resolveDefinition(hit, idx) || hit) : null;
            if (target && target.endLine) {
              code = full.replace(/\r\n/g, '\n').split('\n').slice(target.line - 1, target.endLine).join('\n');
              name = target.name || name;
              lineOffset = Math.max(0, target.line - 1);
            } else code = full;
          } else code = full;
        }
        if (Buffer.byteLength(code, 'utf8') > 2 * 1024 * 1024) return send(res, 413, { ok:false, error:'函数内容超过 2 MB' });
        const graph = buildLogicGraph(code, { language: language || 'c_cpp', name });
        /* 相对行号 → 片段绝对行号（前端 goToLocation 用的是后者） */
        if (lineOffset) {
          graph.nodes.forEach((n) => {
            n.line = (Number(n.line) || 1) + lineOffset;
            n.endLine = (Number(n.endLine) || Number(n.line) || 1) + lineOffset;
          });
        }
        if (String(b.format) === 'drawio') return send(res, 200, { ok:true, ...graph, xml:logicToDrawio(graph, { title:name }) });
        return send(res, 200, { ok:true, ...graph });
      } catch (error) { return send(res, error.statusCode || 500, { ok:false, error:String(error.message || error).slice(0, 300) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/logic/skeleton') {
      try {
        const b = await readBody(req, 2 * 1024 * 1024);
        const graph = b && b.graph;
        if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length > 2000) return send(res, 400, { ok:false, error:'逻辑图节点不合法（1–2000 个）' });
        return send(res, 200, { ok:true, ...logicToSkeleton(graph, {
          language:String(b.language || 'c_cpp'), fnName:String(b.fnName || b.name || 'generated').slice(0, 120),
        }) });
      } catch (error) { return send(res, error.statusCode || 500, { ok:false, error:String(error.message || error).slice(0, 300) }); }
    }
    // ===== 云同步：Tailscale 组网 / Syncthing 数据面 / restic 历史层 =====
    if (req.method === 'GET' && u.pathname === '/api/sync/status') {
      return send(res, 200, await syncStatus(u.searchParams.get('refresh') === '1'));
    }
    if (u.pathname === '/api/sync/config') {
      if (req.method === 'GET') {
        const discovered = discoverSyncthingApiKey();
        return send(res, 200, {
          ok: true, config: syncConfig(),
          discovered: { syncthingApiKey: discovered.key ? '已在本机 config.xml 中发现' : '', file: discovered.file },
          configXmlCandidates: syncthingConfigPaths(),
        });
      }
      if (req.method === 'POST') {
        try { return send(res, 200, { ok: true, config: saveSyncConfig(await readBody(req)) }); }
        catch (error) { return send(res, error.statusCode || 400, { ok: false, error: String(error.message || error) }); }
      }
    }
    if (req.method === 'POST' && u.pathname === '/api/sync/device') {
      try { return send(res, 200, await syncthingAction(await readBody(req))); }
      catch (error) { return send(res, error.statusCode || 400, { ok: false, error: String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/sync/scan') {
      try {
        const body = await readBody(req);
        return send(res, 200, await syncthingAction({ action: 'scan', folder: body.folder }));
      } catch (error) { return send(res, error.statusCode || 400, { ok: false, error: String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/sync/snapshot') {
      try { return send(res, 200, await startSyncSnapshot((await readBody(req)).targets)); }
      catch (error) { return send(res, error.statusCode || 400, { ok: false, error: String(error.message || error) }); }
    }
    // GitHub 体积预检：单文件 ≥100 MiB 一旦进历史，push 会被永久拒绝，必须在入库前拦住。
    if (req.method === 'GET' && u.pathname === '/api/sync/github/precheck') {
      const config = syncConfig();
      const repo = await syncGithubStatus(config).catch(() => ({ largeFiles: [] }));
      const vault = vaultStats();
      const largeFiles = repo.largeFiles || [];
      const blocking = largeFiles.filter((item) => item.bytes >= 100 * 1024 * 1024);
      return send(res, 200, {
        ok: true, thresholdMiB: config.largeFileMiB, githubLimitMiB: 100,
        largeFiles, blocking,
        pdfBackups: { files: vault.pdfBackupFiles, bytes: vault.pdfBackupBytes },
        advice: blocking.length
          ? '存在 ≥100 MiB 的文件：一旦提交，git push 会被永久拒绝，请先压缩或移出仓库'
          : (largeFiles.length ? '存在接近上限的文件（≥' + config.largeFileMiB + ' MiB），提交前请确认' : '未发现超限文件'),
      });
    }
    // ===== 远程开发：SSH 复用底部 PTY 终端；SFTP 浏览文件；VNC 由 WebSocket 代理 =====
    if (req.method === 'GET' && u.pathname === '/api/remote/status') {
      return send(res, 200, {
        ok: true,
        ssh: { available: !!executablePath('ssh'), path: executablePath('ssh'), files: true },
        vnc: { available: fs.existsSync(path.join(__dirname, 'node_modules', '@novnc', 'novnc', 'core', 'rfb.js')) },
        terminal: TERM ? { active: true, mode: TERM.mode, label: TERM.label, host: TERM.host || '', port: TERM.port || 0 } : { active: false, mode: '', label: '', host: '', port: 0 },
      });
    }
    if (req.method === 'GET' && u.pathname === '/api/remote/latency') {
      const host = remoteHost(u.searchParams.get('host'));
      const port = remotePort(u.searchParams.get('port'), 0);
      if (!host || !port) return send(res, 400, { ok: false, error: '主机或端口不合法' });
      const result = await measureNetworkLatency(host);
      return send(res, result.ok ? 200 : 504, result);
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/ssh/connect') {
      const b = await readBody(req);
      const spec = sshSessionSpec(b);
      if (spec.error) return send(res, 400, { ok: false, error: spec.error });
      stopTerm();
      if (!termSpawn(spec)) return send(res, 500, { ok: false, error: 'SSH 终端启动失败' });
      return send(res, 200, { ok: true, mode: 'ssh', label: spec.label, host: spec.host, port: spec.port, user: spec.user });
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/ssh/disconnect') {
      stopTerm();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/list') {
      try { return send(res, 200, await remoteList(await readBody(req))); }
      catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/read') {
      try { return send(res, 200, await remoteRead(await readBody(req))); }
      catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/write') {
      try { return send(res, 200, await remoteWrite(await readBody(req))); }
      catch (error) { return send(res, 200, { ok:false, error:String(error.message || error) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/upload-stream') {
      await streamRemoteUpload(req, res);
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/remote/files/download-stream') {
      try { await streamRemoteDownload(res, await readBody(req)); }
      catch (error) {
        if (!res.headersSent) send(res, 200, { ok:false, error:String(error.message || error) });
        else res.destroy(error);
      }
      return;
    }
    // ===== 底部终端（PTY shell，script 命令分配伪终端）=====
    if (req.method === 'GET' && u.pathname === '/api/term/stream') {
      if (!TERM || !TERM.child) termSpawn();
      if (!TERM) { res.end('终端启动失败'); return; }
      const session = TERM;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-CodeScope-Terminal-Replay': '1' });
      session.clients.add(res);
      if (session.buffer.length) { try { res.write(session.buffer); } catch (_) {} }
      req.on('close', () => {
        // 页面刷新/多标签切换只移除自己的订阅，不再杀掉共享 SSH 会话。
        session.clients.delete(res);
      });
      return;   // 保持连接，输出由 termSpawn 的 stdout/stderr 回调实时推送
    }
    if (req.method === 'POST' && u.pathname === '/api/term/input') {
      const b = await readBody(req);
      const data = String((b && b.data) || '');
      if (!TERM || !TERM.child) return send(res, 409, { ok: false, error: '终端尚未连接' });
      try { TERM.child.stdin.write(data); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/term/resize') {
      const b = await readBody(req);
      const cols = Math.max(20, Math.min(1000, Math.floor(Number(b.cols) || 0)));
      const rows = Math.max(5, Math.min(500, Math.floor(Number(b.rows) || 0)));
      if (!TERM || !TERM.child) return send(res, 409, { ok: false, error: '终端尚未连接' });
      const control = TERM.child.stdio && TERM.child.stdio[3];
      if (!control || !control.writable) return send(res, 200, { ok: true, forwarded: false });
      try { control.write(JSON.stringify({ cols, rows }) + '\n'); return send(res, 200, { ok: true, forwarded: true }); }
      catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/term/stop') {
      stopTerm();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { ok: false, error: 'Not Found: ' + u.pathname });
  } catch (e) {
    const statusCode = Number(e && e.statusCode);
    const code = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
    if (!res.headersSent) send(res, code, { ok: false, error: String((e && e.message) || e) });
    else if (!res.writableEnded && !res.destroyed) res.destroy(e);
  }
});

const VNC_WSS = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  let u;
  try { u = new URL(req.url, 'http://' + (req.headers.host || HOST + ':' + PORT)); }
  catch (_) { socket.destroy(); return; }
  if (u.pathname !== '/api/vnc/ws') { socket.destroy(); return; }
  const origin = String(req.headers.origin || '');
  if (origin) {
    try {
      if (new URL(origin).host !== String(req.headers.host || '')) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
    } catch (_) { socket.destroy(); return; }
  }
  const host = remoteHost(u.searchParams.get('host'));
  const port = remotePort(u.searchParams.get('port'), 5900);
  if (!host || !port) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  VNC_WSS.handleUpgrade(req, socket, head, (ws) => VNC_WSS.emit('connection', ws, req, { host, port }));
});
VNC_WSS.on('connection', (ws, _req, target) => {
  const tcp = net.createConnection({ host: target.host.replace(/^\[|\]$/g, ''), port: target.port });
  tcp.setNoDelay(true);
  tcp.setTimeout(10000, () => tcp.destroy());
  tcp.once('connect', () => tcp.setTimeout(0));
  ws.on('message', (data) => { if (!tcp.destroyed && tcp.writable) tcp.write(data); });
  tcp.on('data', (data) => { if (ws.readyState === 1) ws.send(data, { binary: true }); });
  const closeWs = () => { if (ws.readyState === 0 || ws.readyState === 1) ws.close(); };
  tcp.on('error', closeWs);
  tcp.on('close', closeWs);
  ws.on('error', () => { try { tcp.destroy(); } catch (_) {} });
  ws.on('close', () => { try { tcp.destroy(); } catch (_) {} });
});

server.listen(PORT, HOST, () => {
  console.log('码境 CodeScope 已启动 [' + APP_MODE + ']: http://' + HOST + ':' + PORT);
  /* ★ 工作流定时排期：启动后**等 20 秒**再开始 tick ✓ ——
     刚起来那会儿磁盘 / CPU 都在忙（扫索引、建知识库 ✗），
     这时候插一个可能跑 30 秒的工作流进去，会让启动更慢 ✗。
     ⚠️ `unref()` ✗：定时器不该阻止进程正常退出 ✓。 */
  if (!FLOW_TICK_TIMER) {
    FLOW_TICK_TIMER = setTimeout(() => {
      flowScheduleTick();
      FLOW_TICK_TIMER = setInterval(flowScheduleTick, FLOW_TICK_MS);
      if (FLOW_TICK_TIMER && FLOW_TICK_TIMER.unref) FLOW_TICK_TIMER.unref();
    }, 20000);
    if (FLOW_TICK_TIMER && FLOW_TICK_TIMER.unref) FLOW_TICK_TIMER.unref();
  }
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    const addresses = [];
    for (const rows of Object.values(os.networkInterfaces())) for (const row of (rows || [])) {
      if (row.family === 'IPv4' && !row.internal) addresses.push('http://' + row.address + ':' + PORT);
    }
    if (addresses.length) console.log('局域网访问: ' + addresses.join('  '));
    console.log('⚠ 当前为局域网模式：终端、代码运行和文件修改接口可被同网段设备访问。');
  }
  try { console.log('Vault: ' + vaultPath()); } catch (e) { console.log('Vault: ' + e.message); }
  // 启动后台自动准备 ONLYOFFICE（不阻塞服务；测试用 CODESCOPE_AUTO_OFFICE=0 关闭）
  setTimeout(() => { try { ensureOnlyOfficeWhenNeeded(); } catch (_) {} }, 1500);
  try { KNOWLEDGE.start(); console.log('知识库: VitePress 自动生成已启用'); } catch (e) { console.log('知识库初始化失败: ' + e.message); }
  // 清扫上次服务留下的运行临时目录（正常退出会由 TTL 回收，强杀则依赖这里）
  try { const swept = sweepTempDirs(); if (swept) console.log('已清理运行临时目录: ' + swept + ' 个'); } catch (_) {}
  console.log('正在检测本机环境…');
  DSH.start().then((service) => {
    const suffix = service.available ? (service.managed ? '（由 CodeScope 托管）' : '（连接现有服务）') : '：' + service.message;
    console.log('DeepSeek Harness ' + (service.available ? '已就绪' : '未就绪') + suffix);
  }).catch((error) => console.log('DeepSeek Harness 启动失败：' + String(error.message || error)));
  getEnv(false).then(({ tools: env, project }) => {
    const all = Object.values(env);
    const relevant = all.filter((e) => e.relevant);
    const inactive = relevant.filter((e) => !e.available);
    console.log('核心运行环境已就绪；项目扩展 ' + (relevant.length - inactive.length) + '/' + relevant.length + ' 项可用');
    if (project.languages.length) console.log('检测到语言：' + project.languages.join(', '));
    if (inactive.length) {
      console.log('按需扩展未启用（不影响 CodeScope 基础功能）：');
      for (const item of inactive) console.log('  - ' + item.label + '（' + item.for + '）' + (installHint(item.key) ? ' → ' + installHint(item.key) : ''));
    }
  });
  console.log('按 Ctrl+C 停止');
});

/* 最后一道安全网。历史上「未捕获异常 / 未处理的 Promise 拒绝」会让整个工作台进程直接退出
   （Node 15+ 对 unhandledRejection 默认终止进程），而进程退出前是没有任何提示的。
   已知来源已在请求路径上修掉，这里只负责记录并尽量存活，同时对异常持续出现做熔断，避免刷屏空转。 */
let unexpectedErrorCount = 0;
const UNEXPECTED_ERROR_LIMIT = 30;
function reportUnexpectedError(label, error) {
  unexpectedErrorCount += 1;
  console.error('[' + label + '] ' + String((error && error.stack) || error).slice(0, 2000));
  if (unexpectedErrorCount === UNEXPECTED_ERROR_LIMIT) {
    console.error('异常已连续出现 ' + UNEXPECTED_ERROR_LIMIT + ' 次，为避免继续空转将退出；请把以上日志反馈给开发者。');
    try { shutdown(label); } catch (_) { process.exit(1); }
  }
}
process.on('unhandledRejection', (reason) => reportUnexpectedError('未处理的 Promise 拒绝', reason));
process.on('uncaughtException', (error) => reportUnexpectedError('未捕获异常', error));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { LSP.close(); } catch (_) {}
  try { stopPdfWorker('进程退出'); } catch (_) {}
  try { KNOWLEDGE.stop(); } catch (_) {}
  try { stopTerm(); } catch (_) {}
  try { VSCODE_PROXY.stop(); } catch (_) {}
  try { await VSCODE.stop(); } catch (_) {}
  try { await OPENCODE.stop(); } catch (_) {}
  try { await DSH.stop(); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 2500).unref();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
