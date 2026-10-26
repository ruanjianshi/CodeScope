'use strict';

/* ── 工作流执行引擎（参考 n8n）✓ ────────────────────────────────────────────
   纯逻辑、无 DOM ✓，可以在单测里直接跑 ✓。

   模型：
     graph = {
       nodes: [{ id, type, name, x, y, cfg: {…}, disabled, retry, retryDelay, onError, note }],
       edges: [{ from: <nodeId>, port: <0|1|2|3>, to: <nodeId> }],
     }
   · 按**拓扑序**执行 ✓（有环直接报错 ✗ —— 免得死循环把服务挂住 ✗）
   · 每个节点的输出写进 vars[nodeId] ✓，下游用表达式引用 ✓
   · 表达式走 lib/expr.js ✓（n8n 风格：`{{ $json.x }}` / `{{ $node["名字"].json.y }}` ✓）

   ★ 这一版相对上一版加了什么（对齐 n8n 的几件核心事）✗：
     ① **表达式**（原来只能 `{{节点id.字段}}` ✗）—— 见 lib/expr.js ✓
     ② **节点设置**：禁用 / 重试 / 出错继续 / 备注 ✓（原来一个都没有 ✗）
     ③ **列表节点**（filter / sort / limit / unique / aggregate / split / merge ✓）
        —— n8n 的「items」概念在这里的落地方式：上游给数组，列表节点逐条处理 ✓
     ④ **多路分支**（switch ✓）、**编辑字段**（set ✓）、**代码**（code ✓）、
        **日期时间**（date ✓）、**加解密/哈希**（crypto ✓）、**子工作流**（out.flow ✓）

   ★ 输出类节点（写备忘录 / 写日记 / 通知 / 发邮件 / 调子流程）**不在这里落地** ✗ ——
     引擎只产出 `effects` 数组 ✓，由**前端**应用 ✓（因为 STORE 归前端管 ✓）。
     这样引擎保持纯函数 ✓，可单测 ✓，也不会偷偷改用户数据 ✗。
   ══════════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const expr = require('./expr.js');

const getPath = expr.getPath;
const toText = expr.toText;

/* ── 取上游数组 ✓ ────────────────────────────────────────────────────────
   列表节点都要「一个数组」✓。这里尽量宽容 ✗：用户不该为了跑一个 filter
   先去接一个 JSON 取值节点 ✗。顺序：显式表达式 → 输入本身 → input.json →
   输入里**唯一**的那个数组字段 ✓。 */
function pickArray(cfgFrom, scope, input) {
  const from = String(cfgFrom == null ? '' : cfgFrom).trim();
  if (from) {
    const v = expr.evaluate(from, scope);
    if (Array.isArray(v)) return v;
    if (v == null) return [];
    return [v];                       /* 不是数组就当成「只有一个元素」✓，别报错 ✗ */
  }
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') {
    if (Array.isArray(input.json)) return input.json;
    if (Array.isArray(input.value)) return input.value;
    const arrays = Object.keys(input).filter((k) => Array.isArray(input[k]));
    if (arrays.length === 1) return input[arrays[0]];
    if (arrays.length > 1) {
      /* 多个数组 → 取**最长的那个** ✓（多半就是主角 ✓），但要说清楚 ✗ */
      const best = arrays.sort((a, b) => input[b].length - input[a].length)[0];
      return input[best];
    }
  }
  throw new Error('上游给的不是数组 ✗ —— 前面接一个「JSON 取值」把列表取出来 ✓，或在「来自」里写表达式 ✓');
}

/* ── 单条元素的 scope ✓（列表节点逐条跑表达式时用 ✓）───────────────────── */
function itemScope(base, item, i) {
  return Object.assign({}, base, {

    json: item,
    input: item,
    $index: i,
    index: i,
  });
}

/* ── 日期时间小工具 ✓ ──────────────────────────────────────────────────── */
function fmtDate(ts, fmt) {
  const d = new Date(Number(ts) || 0);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return String(fmt || 'YYYY-MM-DD HH:mm:ss')
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, p(d.getMonth() + 1))
    .replace(/DD/g, p(d.getDate()))
    .replace(/HH/g, p(d.getHours()))
    .replace(/mm/g, p(d.getMinutes()))
    .replace(/ss/g, p(d.getSeconds()))
    .replace(/SSS/g, p(d.getMilliseconds(), 3));
}

/* ── 单节点执行 ✓ ─────────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════
   多模型提供商 ✓（2026-10-18 新增）
   ──────────────────────────────────────────────────────────────────────────
   用户原话：「如果我要做视频生成工作流，用豆包来做，生成视频，deepseek 来做文本」✓。
   原来只有**一个**全局 AI 配置 ✗（`localStorage['mc-ai-cfg']` ✓，{url,key,model} ✓）——
   一张图里想「DeepSeek 写文案 + 豆包出视频」根本做不到 ✗。

   ⇒ 现在前端把**一整套提供商**随请求带上来 ✓（`providers` ✓），
     每个 AI 节点自己选 `provider` + `model` ✓，引擎按节点解析 ✓。

   ⚠️ Key 只在**这一次请求**里过一遍 ✗ —— 服务端不落盘、不打日志 ✓
      （和原来 `/api/ai/chat` 的做法一致 ✓）。
   ⚠️ 老配置必须还能跑 ✗ —— 没选 provider 时退回 `ctx.ai`（原来那套 ✓），
      不然用户已经搭好的图会一夜之间全红 ✗。
   ══════════════════════════════════════════════════════════════════════════ */

/* 把 baseUrl 和路径拼起来 ✓ —— 用户填的 baseUrl 常常已经带 `/v1` 或 `/api/v3` ✓，
   也可能结尾多个斜杠 ✓，这几种都得拼对 ✓（拼错就是 404 ✗，很难自查 ✗）。 */
function joinUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  if (!b) return '';
  if (b.endsWith('/' + p)) return b;      /* 用户直接把完整地址填进了 baseUrl ✓ */
  return b + '/' + p;
}

/* 按节点配置解析出「这一次要用哪个服务 / 哪个模型」✓ */
function resolveAI(ctx, cfg) {
  const pid = String((cfg && cfg.provider) || '').trim();
  const provs = (ctx && ctx.providers) || {};
  const p = pid ? provs[pid] : null;
  if (p && p.baseUrl) {
    const model = String((cfg && cfg.model) || '').trim()
      || (Array.isArray(p.models) && p.models[0]) || '';
    return { kind: p.kind === 'ark' ? 'ark' : 'openai', baseUrl: p.baseUrl, key: p.key || '', model, name: p.name || pid };
  }
  /* ── 退回老的那一套 ✓（全局 AI 配置）── */
  const a = (ctx && ctx.ai) || {};
  if (a.url && (a.model || (cfg && cfg.model))) {
    return { kind: 'openai', baseUrl: a.url, key: a.key || '', model: String((cfg && cfg.model) || a.model), name: '默认模型' };
  }
  throw new Error('没配 AI ✗ —— 点工作流工具栏的「🔑 模型」加一个（DeepSeek / 豆包 / 任意 OpenAI 兼容）；'
    + '或者去 CodeScope 的 AI 面板配一次默认模型 ✓（老图会自动复用它 ✓）');
}

/* 发一个 JSON 请求 + 拿到 JSON 回来 ✓（生成类接口全是这个套路 ✓） */
async function postJson(ctx, url, key, body, timeoutMs) {
  const r = await ctx.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(5000, Math.min(300000, timeoutMs || 120000))),
  });
  const text = await r.text();
  if (!r.ok) throw new Error('接口返回 ' + r.status + '：' + text.slice(0, 300));
  try { return JSON.parse(text); } catch (_) { throw new Error('接口返回的不是 JSON：' + text.slice(0, 200)); }
}

/* 从各种「图片生成」响应里挖 URL ✓ —— 各家字段不太一样 ✗，能挖的都挖一遍 ✓ */
function imageUrls(data) {
  const out = [];
  const arr = (data && (data.data || data.images || data.result)) || [];
  (Array.isArray(arr) ? arr : []).forEach((x) => {
    if (typeof x === 'string') out.push(x);
    else if (x && x.url) out.push(String(x.url));
    else if (x && x.b64_json) out.push('data:image/png;base64,' + x.b64_json);
  });
  if (data && typeof data.url === 'string') out.push(data.url);
  return out.filter(Boolean);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/* ── 跑一个节点 ✓ ────────────────────────────────────────────────────────
   `ctx` 里有：fetch / now / ai / aiChat / providers / saveRemote（可选 ✓） */
async function execNode(node, vars, input, ctx, scope) {
  const cfg = node.cfg || {};
  const t = String(node.type || '');
  const R = (v) => expr.renderTpl(v, scope);          /* 渲染模板 ✓ */
  const V = (v) => expr.evaluate(v, scope);           /* 求值表达式 ✓ */
  /* ★ 「先当表达式算，算不动就当**原样字符串**」✓ ——
     有些字段用户十有八九会填**字面量** ✗（日期 `2026-10-07T12:34:56` ✓、
     一串要哈希的文本 ✓）。硬按表达式算的话 `2026-10-07T12:34:56`
     会被解析成 `2026-10-07` 这个减法 ✓，然后卡在 `T12` 上报错 ✗
     （实测单测里就是这么挂的 ✗）。软求值两头都照顾得到 ✓。 */
  const SV = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    try { return expr.evaluate(s, scope); } catch (_) { return s; }
  };
  switch (t) {
    /* ══ 触发 ══════════════════════════════════════════════════════════ */
    case 'trigger.manual':
    case 'trigger.timer':
    case 'trigger.webhook':
      return { out: { at: ctx.now, fired: true }, port: 0 };

    /* ══ 数据 ══════════════════════════════════════════════════════════ */
    case 'http.request': {
      const url = R(cfg.url).trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('HTTP 请求的 URL 不合法（要 http/https 开头）');
      const method = String(cfg.method || 'GET').toUpperCase();
      const headers = { 'content-type': 'application/json' };
      /* 自定义请求头 ✓（一行一个 `名字: 值` ✓）—— n8n 里这是最基本的 ✓ */
      String(cfg.headers || '').split('\n').forEach((line) => {
        const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
        if (m) headers[m[1].trim()] = R(m[2]).trim();
      });
      const opt = { method, headers };
      if (method !== 'GET' && method !== 'HEAD' && String(cfg.body || '').trim()) {
        opt.body = R(cfg.body);
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(60000, Number(cfg.timeout) || 15000)));
      let r;
      try { r = await ctx.fetch(url, Object.assign(opt, { signal: ctrl.signal })); }
      finally { clearTimeout(timer); }
      const text = await r.text();
      /* ★ 顺手把 body 解析成 JSON ✓ —— 像 n8n 那样 ✓。
         不解析的话，下游想取值就得先接一个「JSON 解析」节点 ✗，很啰嗦 ✗。
         解析失败**不报错** ✓（有些接口就是返回纯文本 ✓），json 给 null ✓。 */
      let json = null;
      try { json = JSON.parse(text); } catch (_) { json = null; }
      return { out: { status: r.status, ok: r.ok, body: text.slice(0, 200000), json }, port: 0 };
    }

    case 'data.template':
      return { out: R(cfg.text), port: 0 };

    case 'data.json': {
      const path = String(cfg.path || '').trim();
      /* ⚠️ 输入里带 json（HTTP 节点给的 ✓）就以它为根 ✓ ——
         这样「取 data.list[0].title」这种路径能直接用 ✓，
         不用让用户写 json.data.list[0].title ✗。 */
      let obj = input;
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.json !== undefined) obj = obj.json;
      /* ★ 从一段文本里抠 JSON ✓（2026-10-18）——
         AI 节点的输出是 `{ text: '…' }` ✓，而模型常常**直接吐一个 JSON 字符串** ✓
         （尤其开了「只回 JSON」✓）。不认的话用户还得先接个「文本模板」再回来 ✗，白折腾一步 ✓。
         ⚠️ 模型爱把 JSON 包在 ```json 围栏里 ✗ —— 顺手剥掉 ✓。 */
      const parseMaybe = (v) => {
        if (typeof v !== 'string') return null;
        let t = v.trim();
        const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
        if (fence) t = fence[1].trim();
        if (!/^[[{]/.test(t)) return null;
        try { return JSON.parse(t); } catch (_) { return null; }
      };
      if (typeof obj === 'string') {
        const p = parseMaybe(obj);
        if (p) obj = p;
      } else if (obj && typeof obj === 'object' && !Array.isArray(obj) && typeof obj.text === 'string') {
        const p = parseMaybe(obj.text);
        /* ⚠️ 只在「原对象上取不到这个路径」时才换根 ✗ ——
           不然 `{{x.text}}` 这种**本来就该取 text** 的会突然变成别的 ✗。 */
        if (p && path && getPath(obj, path) === undefined) obj = p;
      }
      const v = path ? getPath(obj, path) : obj;
      return { out: v === undefined ? null : v, port: 0 };
    }

    /* 编辑字段 ✓（n8n 的 Set / Edit Fields ✓）——
       多行 `名字 = 表达式` ✓ + 要删掉的字段 ✓。
       ★ 上游是**数组**时，逐条改 ✓（n8n 的 items 也是这么干的 ✓）——
         否则用户只能先拆再合 ✗，很啰嗦 ✗。 */
    case 'data.set': {
      const one = (item) => {
        const out = (item && typeof item === 'object' && !Array.isArray(item)) ? Object.assign({}, item) : { value: item };
        String(cfg.remove || '').split(/[,，\s]+/).filter(Boolean).forEach((k) => { delete out[k]; });
        const sc = Object.assign({}, scope, { json: item, input: item });
        String(cfg.assign || '').split('\n').forEach((line) => {
          const m = /^\s*([^\s=]+)\s*=\s*(.+)$/.exec(line);
          if (!m) return;
          out[m[1].trim()] = expr.evaluate(m[2], sc);
          /* ★ 让后面的行能引用**刚赋的值** ✓（n8n 里 Set 也是这样的 ✓）——
             不累积的话 `甲 = …` 下一行写 `乙 = $json.甲` 会是 undefined ✗，
             用户会以为「同一个节点里的赋值互相看不见」✗。 */
          sc.json = out;
          sc.input = out;
        });
        return out;
      };
      return { out: Array.isArray(input) ? input.map(one) : one(input), port: 0 };
    }

    /* 代码 ✓（n8n 的 Code 节点的**安全版** ✗）——
       一行一句 `名字 = 表达式` ✓，用同一套表达式引擎跑 ✓，
       **不执行任意 JS** ✗（那等于把「谁改一下工作流 json 就能在你机器上跑代码」的门打开 ✗）。
       输出 = 所有赋值组成的对象 ✓，下游用 `$json.名字` 取 ✓。 */
    case 'data.code': {
      const out = {};
      const lines = String(cfg.code || '').split('\n');
      const localScope = Object.assign({}, scope, { json: input, input });
      for (const line of lines) {
        const s = line.trim();
        if (!s || s.charAt(0) === '/' || s.charAt(0) === '#') continue;
        const m = /^([^\s=]+)\s*=\s*([\s\S]+)$/.exec(s);
        if (!m) throw new Error('第 ' + (lines.indexOf(line) + 1) + ' 行看不懂 ✗ —— 要写成「名字 = 表达式」✓：' + s.slice(0, 40));
        const name = m[1].trim();
        let val;
        try { val = expr.evaluate(m[2], localScope); }
        catch (err) { throw new Error('第 ' + (lines.indexOf(line) + 1) + ' 行「' + name + '」出错：' + err.message); }
        out[name] = val;
        localScope[name] = val;
        localScope.json = Object.assign({}, localScope.json, { [name]: val });
      }
      return { out, port: 0 };
    }

    /* 日期时间 ✓ */
    case 'data.date': {
      const raw = String(cfg.value || '').trim() ? SV(cfg.value) : ctx.now;
      const ts = typeof raw === 'number' ? raw : (Date.parse(String(raw)) || ctx.now);
      const mode = String(cfg.mode || 'format');
      if (mode === 'add' || mode === 'sub') {
        const n = Number(V(cfg.amount)) || 0;
        const unit = String(cfg.unit || 'day');
        const mul = unit === 'minute' ? 60000 : unit === 'hour' ? 3600000 : unit === 'week' ? 604800000 : 86400000;
        const next = ts + (mode === 'sub' ? -1 : 1) * n * mul;
        return { out: { at: next, text: fmtDate(next, cfg.format), iso: new Date(next).toISOString() }, port: 0 };
      }
      if (mode === 'diff') {
        const other = Number(V(cfg.amount)) || ctx.now;
        return { out: { days: Math.round((ts - other) / 86400000), hours: Math.round((ts - other) / 3600000), ms: ts - other }, port: 0 };
      }
      return { out: { at: ts, text: fmtDate(ts, cfg.format), iso: new Date(ts).toISOString() }, port: 0 };
    }

    /* 哈希 / Base64 / 随机 ✓ */
    case 'data.crypto': {
      const op = String(cfg.op || 'sha256');
      const v = String(SV(cfg.value) == null ? '' : SV(cfg.value));
      if (op === 'uuid') return { out: { text: crypto.randomUUID() }, port: 0 };
      if (op === 'random') {
        const n = Math.max(1, Math.min(64, Number(SV(cfg.amount)) || 16));
        return { out: { text: crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n) }, port: 0 };
      }
      if (op === 'base64') return { out: { text: Buffer.from(v, 'utf8').toString('base64') }, port: 0 };
      if (op === 'base64decode') return { out: { text: Buffer.from(v, 'base64').toString('utf8') }, port: 0 };
      if (op === 'md5' || op === 'sha1' || op === 'sha256' || op === 'sha512') {
        return { out: { text: crypto.createHash(op).update(v, 'utf8').digest('hex') }, port: 0 };
      }
      throw new Error('不认识的算法：' + op);
    }

    /* ══ 列表（n8n 的 items 思路 ✓）══════════════════════════════════════ */
    case 'list.filter': {
      const list = pickArray(cfg.from, scope, input);
      const op = String(cfg.op || '包含');
      const out = list.filter((item, i) => {
        const sc = itemScope(scope, item, i);
        const l = expr.renderTpl(cfg.left == null ? '' : cfg.left, sc);
        const r = expr.renderTpl(cfg.right == null ? '' : cfg.right, sc);
        if (op === '包含') return l.indexOf(r) >= 0;
        if (op === '等于') return l === r;
        if (op === '不等于') return l !== r;
        if (op === '大于') return Number(l) > Number(r);
        if (op === '小于') return Number(l) < Number(r);
        if (op === '为空') return !String(l).trim();
        if (op === '非空') return !!String(l).trim();
        if (op === '正则匹配') { try { return new RegExp(r).test(l); } catch (_) { return false; } }
        return false;
      });
      return { out: out, port: 0 };
    }
    case 'list.sort': {
      const list = pickArray(cfg.from, scope, input).slice();
      const desc = String(cfg.dir || 'asc') === 'desc';
      const by = String(cfg.by || '').trim();
      const keyOf = (item, i) => (by ? expr.evaluate(by, itemScope(scope, item, i)) : item);
      list.sort((a, b) => {
        const ka = keyOf(a, 0); const kb = keyOf(b, 0);
        const bothNum = !Number.isNaN(Number(ka)) && !Number.isNaN(Number(kb)) && ka !== '' && kb !== '';
        const r = bothNum ? Number(ka) - Number(kb) : (String(ka) < String(kb) ? -1 : String(ka) > String(kb) ? 1 : 0);
        return desc ? -r : r;
      });
      return { out: list, port: 0 };
    }
    case 'list.limit': {
      const list = pickArray(cfg.from, scope, input);
      const skip = Math.max(0, Number(V(cfg.skip)) || 0);
      const n = Number(V(cfg.n));
      const size = Number.isFinite(n) && n >= 0 ? n : list.length;
      return { out: list.slice(skip, skip + size), port: 0 };
    }
    case 'list.unique': {
      const list = pickArray(cfg.from, scope, input);
      const by = String(cfg.by || '').trim();
      const seen = new Set();
      const out = [];
      list.forEach((item, i) => {
        const k = by ? toText(expr.evaluate(by, itemScope(scope, item, i))) : toText(item);
        if (seen.has(k)) return;
        seen.add(k);
        out.push(item);
      });
      return { out, port: 0 };
    }
    case 'list.aggregate': {
      const list = pickArray(cfg.from, scope, input);
      const op = String(cfg.op || '计数');
      const by = String(cfg.field || '').trim();
      const vals = by ? list.map((item, i) => expr.evaluate(by, itemScope(scope, item, i))) : list;
      const nums = vals.map((x) => Number(x)).filter((x) => !Number.isNaN(x));
      let v;
      if (op === '计数') v = list.length;
      else if (op === '求和') v = nums.reduce((a, b) => a + b, 0);
      else if (op === '平均') v = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      else if (op === '最大') v = nums.length ? Math.max(...nums) : null;
      else if (op === '最小') v = nums.length ? Math.min(...nums) : null;
      else if (op === '拼接') v = vals.map((x) => toText(x)).join(String(cfg.sep == null ? '' : cfg.sep));
      else throw new Error('不认识的聚合方式：' + op);
      return { out: { value: v, count: list.length, text: toText(v) }, port: 0 };
    }
    case 'list.split': {
      const list = pickArray(cfg.from, scope, input);
      const size = Math.max(1, Number(V(cfg.size)) || 10);
      const out = [];
      for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
      return { out, port: 0 };
    }
    case 'list.merge': {
      let lists = [];
      const from = String(cfg.from || '').trim();
      if (from) {
        const v = expr.evaluate(from, scope);
        lists = Array.isArray(v) && v.length && Array.isArray(v[0]) ? v : [v];
      } else if (Array.isArray(input) && input.length && Array.isArray(input[0])) {
        lists = input;                       /* 多个入口全是数组时给的「数组的数组」✓ */
      } else if (input && typeof input === 'object') {
        lists = Object.keys(input).map((k) => input[k]).filter(Array.isArray);
      }
      lists = lists.filter(Array.isArray);
      if (!lists.length) throw new Error('没有可合并的数组 ✗ —— 前面接两个列表，或在「来自」里写一个「数组的数组」✓');
      return { out: lists.reduce((acc, x) => acc.concat(x), []), port: 0 };
    }

    /* ══ 逻辑 ══════════════════════════════════════════════════════════ */
    case 'logic.if': {
      const l = R(cfg.left);
      const r = R(cfg.right);
      const op = String(cfg.op || '包含');
      let hit = false;
      if (op === '包含') hit = l.indexOf(r) >= 0;
      else if (op === '等于') hit = l === r;
      else if (op === '不等于') hit = l !== r;
      else if (op === '大于') hit = Number(l) > Number(r);
      else if (op === '小于') hit = Number(l) < Number(r);
      else if (op === '为空') hit = !String(l).trim();
      else if (op === '非空') hit = !!String(l).trim();
      else if (op === '正则匹配') { try { hit = new RegExp(r).test(l); } catch (_) { hit = false; } }
      return { out: { ok: hit, left: l, right: r }, port: hit ? 0 : 1 };
    }

    /* 多路分支 ✓（n8n 的 Switch ✓）——
       出端口 0/1/2 对应 case1/2/3 ✓，端口 3 = 都不匹配（else ✓）。 */
    case 'logic.switch': {
      const value = R(cfg.value);
      const cases = [cfg.case1, cfg.case2, cfg.case3].map((x) => R(x == null ? '' : x));
      let port = 3;
      for (let i = 0; i < cases.length; i++) {
        if (cases[i] !== '' && value === cases[i]) { port = i; break; }
      }
      return { out: { value, matched: port === 3 ? null : cases[port], port }, port };
    }

    case 'logic.merge':
      return { out: input, port: 0 };

    /* ══ AI ════════════════════════════════════════════════════════════ */
    case 'ai.chat': {
      /* ★ 每个 AI 节点**自己选服务** ✓（2026-10-18）—— 一张图里可以
         「DeepSeek 写文案 → 豆包出图 → 豆包出视频」✓。
         ⚠️ 没选 provider 时 `resolveAI` 会退回老的全局配置 ✓（老图不会红 ✗）。 */
      const sys = R(cfg.system).trim();
      const user = R(cfg.prompt);
      const messages = [];
      if (sys) messages.push({ role: 'system', content: sys });
      messages.push({ role: 'user', content: user || toText(input) });
      /* ⚠️ **老路先走** ✗ —— 没选 provider、且调用方给了 `aiChat` 回调时，
         仍然走原来那套 ✓（服务端那条路把 Key 留在服务端 ✓，老图 / 老单测都不受影响 ✓）。 */
      if (!String(cfg.provider || '').trim() && typeof ctx.aiChat === 'function'
        && ctx.ai && ctx.ai.url && ctx.ai.model) {
        const text = await ctx.aiChat({ url: ctx.ai.url, key: ctx.ai.key || '', model: ctx.ai.model }, messages);
        return { out: { text, model: ctx.ai.model, provider: '默认模型' }, port: 0 };
      }
      const ai = resolveAI(ctx, cfg);
      const temp = Number(cfg.temperature);
      const body = {
        model: ai.model,
        messages,
        stream: false,
        temperature: Number.isFinite(temp) ? Math.max(0, Math.min(2, temp)) : 0.3,
      };
      /* JSON 模式 ✓ —— 让模型只回一个 JSON ✓，下游接「JSON 取值」就不用跟格式搏斗 ✓。
         ⚠️ 各家叫法一致（OpenAI 的 `response_format` ✓，DeepSeek / 豆包都兼容 ✓），
            但**不是所有模型都支持** ✗ —— 不支持时接口会 400 ✓，报错里能看出来 ✓。 */
      if (String(cfg.json || '') === 'on') body.response_format = { type: 'json_object' };
      const data = await postJson(ctx, joinUrl(ai.baseUrl, 'chat/completions'), ai.key, body,
        Math.max(10000, Math.min(180000, Number(cfg.timeout) || 120000)));
      const content = data && data.choices && data.choices[0] && data.choices[0].message
        && data.choices[0].message.content;
      if (typeof content !== 'string') throw new Error('AI 响应里没有 choices[0].message.content');
      return {
        out: {
          text: content, model: ai.model, provider: ai.name,
          usage: (data && data.usage) || null,
        },
        port: 0,
      };
    }

    /* ══ 图像生成 ✓（同步：一次请求直接回图 ✓）════════════════════════════
       豆包 Seedream / OpenAI Images 都是 `POST {base}/images/generations` ✓，
       响应里 `data[].url` ✓（要 base64 就给 `b64_json` ✓）。 */
    case 'ai.image': {
      const ai = resolveAI(ctx, cfg);
      const prompt = (R(cfg.prompt) || '').trim() || toText(input);
      if (!prompt) throw new Error('提示词是空的 ✗');
      const body = { model: ai.model, prompt, response_format: 'url' };
      const size = String(cfg.size || '').trim();
      if (size) body.size = size;
      const n = Math.max(1, Math.min(4, Number(V(cfg.n)) || 1));
      body.n = n;
      if (String(cfg.watermark || '') === 'on') body.watermark = true;
      /* 图生图 / 参考图 ✓ —— 豆包用 `image`（URL 或 base64 ✓），OpenAI 用 `image`（多张时是数组 ✓） */
      const ref = String(R(cfg.image) || '').trim();
      if (ref) body.image = ref;
      const data = await postJson(ctx, joinUrl(ai.baseUrl, 'images/generations'), ai.key, body,
        Math.max(15000, Math.min(300000, Number(cfg.timeout) || 180000)));
      const urls = imageUrls(data);
      if (!urls.length) throw new Error('接口没回图片地址 ✗：' + JSON.stringify(data).slice(0, 240));
      return { out: { url: urls[0], urls, count: urls.length, model: ai.model, provider: ai.name }, port: 0 };
    }

    /* ══ 视频生成 ✓（异步：建任务 → 轮询 ✓）════════════════════════════════
       豆包 Seedance：`POST {base}/contents/generations/tasks` 拿 id ✓，
       再 `GET {base}/contents/generations/tasks/{id}` 轮询 ✓。
       ⚠️ 视频要跑几十秒到几分钟 ✗ —— 所以节点里**自带轮询** ✓，
          不让用户自己拼「HTTP + 等待 + 条件分支」那七八步 ✗。
       ⚠️ 出来的 URL **24 小时失效** ✗ —— 要留档就再接一个「下载文件」节点 ✓
          （提示里也写了 ✓）。 */
    case 'ai.video': {
      const ai = resolveAI(ctx, cfg);
      const prompt = (R(cfg.prompt) || '').trim() || toText(input);
      if (!prompt) throw new Error('提示词是空的 ✗');
      /* ⚠️ 豆包视频的参数是**顶层字段** ✗ —— 不是塞进 prompt 的 `--ratio 16:9` ✗
         （那是老写法 ✓，新接口走顶层 ✓，塞进去反而不生效 ✗）。 */
      const body = { model: ai.model, content: [{ type: 'text', text: prompt }] };
      const ref = String(R(cfg.image) || '').trim();
      if (ref) body.content.push({ type: 'image_url', image_url: { url: ref } });
      const ratio = String(cfg.ratio || '').trim();
      if (ratio) body.ratio = ratio;
      const dur = Number(V(cfg.duration)) || 0;
      if (dur > 0) body.duration = Math.max(1, Math.min(20, Math.round(dur)));
      const res = String(cfg.resolution || '').trim();
      if (res) body.resolution = res;
      if (String(cfg.audio || '') === 'on') body.generate_audio = true;
      if (String(cfg.watermark || '') === 'on') body.watermark = true;
      const seed = Number(V(cfg.seed));
      if (Number.isFinite(seed) && seed > 0) body.seed = Math.round(seed);

      const created = await postJson(ctx, joinUrl(ai.baseUrl, 'contents/generations/tasks'), ai.key, body, 60000);
      const taskId = String((created && (created.id || created.task_id)) || '').trim();
      if (!taskId) throw new Error('没拿到任务 id ✗：' + JSON.stringify(created).slice(0, 240));

      /* 轮询 ✓ —— 上限默认 5 分钟（`timeout` 秒 ✓，封顶 15 分钟 ✓） */
      const budget = Math.max(30, Math.min(900, Number(cfg.timeout) || 300)) * 1000;
      const t0 = Date.now();
      let last = null;
      let state = 'queued';
      while (Date.now() - t0 < budget) {
        await sleep(ctx.pollMs);
        const r = await ctx.fetch(joinUrl(ai.baseUrl, 'contents/generations/tasks/' + encodeURIComponent(taskId)), {
          method: 'GET',
          headers: ai.key ? { Authorization: 'Bearer ' + ai.key } : {},
          signal: AbortSignal.timeout(30000),
        });
        const text = await r.text();
        if (!r.ok) throw new Error('查任务失败 ' + r.status + '：' + text.slice(0, 240));
        try { last = JSON.parse(text); } catch (_) { throw new Error('查任务返回的不是 JSON'); }
        state = String((last && last.status) || '').toLowerCase();
        if (state === 'succeeded' || state === 'success') break;
        if (state === 'failed' || state === 'cancelled' || state === 'canceled') {
          const why = (last && (last.error && (last.error.message || last.error.code))) || state;
          throw new Error('生成失败 ✗：' + String(why).slice(0, 240));
        }
      }
      if (state !== 'succeeded' && state !== 'success') {
        throw new Error('等超时了 ✗（' + Math.round(budget / 1000) + ' 秒还没出片 ✓）—— 任务 id 是 ' + taskId
          + '，可以稍后去控制台看；也可以把「最长等多久」调大 ✓');
      }
      const content = (last && last.content) || {};
      const videoUrl = String(content.video_url || content.url || (last && last.video_url) || '').trim();
      if (!videoUrl) throw new Error('任务成功了但没给视频地址 ✗：' + JSON.stringify(last).slice(0, 240));
      return {
        out: {
          url: videoUrl, video_url: videoUrl, task_id: taskId, status: state,
          ms: Date.now() - t0, model: ai.model, provider: ai.name,
          /* 顺手把封面 / 时长带上 ✓（有就带 ✓，没有也不影响 ✓） */
          cover_url: String(content.cover_url || '') || undefined,
          duration: Number(content.duration) || undefined,
        },
        port: 0,
      };
    }

    /* ══ 下载文件 ✓ —— 把 URL 存成本地文件 ✓ ══════════════════════════════
       ⚠️ 生成类接口给的地址**会过期** ✗（豆包视频 24 小时 ✓），
          要长期留就得落盘 ✓。存到 `<数据目录>/flow-files/` ✓，
          返回的 `url` 是**本机可访问**的地址 ✓（`/api/life/flowfile/...` ✓），
          面板里能直接点开看 ✓。 */
    case 'media.download': {
      const url = String(R(cfg.url) || '').trim();
      if (!url) throw new Error('没填要下载的地址 ✗（比如 {{n5.video_url}} ✓）');
      if (!/^https?:\/\//i.test(url)) throw new Error('只认 http/https 地址 ✗');
      if (typeof ctx.saveRemote !== 'function') throw new Error('这个运行环境不支持存文件 ✗');
      const name = String(R(cfg.name) || '').trim();
      const r = await ctx.saveRemote(url, name);
      return {
        out: {
          url: r.url, path: r.path, name: r.name, bytes: r.bytes, type: r.type || '',
          /* 方便下游判断是图还是视频 ✓ */
          kind: /^image\//.test(r.type || '') ? 'image' : (/^video\//.test(r.type || '') ? 'video' : 'file'),
        },
        port: 0,
      };
    }

    /* ══ 网页版 ✓（2026-10-18）════════════════════════════════════════════
       用户原话：「我说的是，打开网页版的 deepseek，和豆包进行文本，视频生成等那种」✓
       —— 他要的不是 API ✓，是**让工作流去点网页** ✓（用已登录的账号 ✓、不花 Key ✓）。

       ⚠️ 这两条**跑在本机的真浏览器里** ✗（服务端注入 `ctx.browser` ✓）——
          所以它们**只能在这台机器上跑** ✓，云端部署那种跑不了 ✗。
       ⚠️ 网页版**比 API 脆** ✗ —— 人家改版就可能失效 ✓，
          所以每个节点都留了「选择器」两个高级项 ✓，改版了用户自己能救 ✓。
       ⚠️ 登录是**人做的** ✗ —— 没登录会报「还没登录…」✓，并告诉他在哪登录 ✓。 */
    case 'web.chat': {
      if (!ctx.browser || typeof ctx.browser.chat !== 'function') {
        throw new Error('这个运行环境不支持网页版 ✗（要跑在本机服务上）');
      }
      const prompt = (R(cfg.prompt) || '').trim() || toText(input);
      if (!prompt) throw new Error('提示词是空的 ✗');
      const r = await ctx.browser.chat({
        site: String(cfg.site || 'deepseek'),
        prompt,
        inputSel: String(cfg.inputSel || ''),
        replySel: String(cfg.replySel || ''),
        sendMode: String(cfg.sendMode || 'enter'),
        timeoutMs: Math.max(10000, Math.min(900000, (Number(cfg.timeout) || 180) * 1000)),
      });
      return { out: { text: r.text, site: r.site, url: r.url }, port: 0 };
    }
    case 'web.video': {
      if (!ctx.browser || typeof ctx.browser.video !== 'function') {
        throw new Error('这个运行环境不支持网页版 ✗（要跑在本机服务上）');
      }
      const prompt = (R(cfg.prompt) || '').trim() || toText(input);
      if (!prompt) throw new Error('提示词是空的 ✗');
      const r = await ctx.browser.video({
        site: String(cfg.site || 'jimeng'),
        prompt,
        inputSel: String(cfg.inputSel || ''),
        videoSel: String(cfg.videoSel || ''),
        sendMode: String(cfg.sendMode || 'button'),
        timeoutMs: Math.max(30000, Math.min(1800000, (Number(cfg.timeout) || 600) * 1000)),
      });
      return { out: { url: r.url, video_url: r.url, site: r.site, ms: r.ms }, port: 0 };
    }

    /* ══ 工具 ══════════════════════════════════════════════════════════ */
    case 'util.delay': {
      const ms = Math.max(0, Math.min(30000, Number(V(cfg.ms)) || 0));
      await new Promise((r) => setTimeout(r, ms));
      return { out: { waited: ms }, port: 0 };
    }

    /* 便签 ✓（n8n 的 Sticky Note ✓）—— 只是画布上的一块注释 ✓，不参与数据流 ✓。
       引擎里给个「原样透传」✓ 就够了（它没有端口，接不到东西也传不出去 ✓）。 */
    case 'note.sticky':
      return { out: input, port: 0 };

    /* ══ 输出（只产出 effect ✓，落地交给前端 ✓）════════════════════════ */
    case 'out.memo':
      return { out: { queued: 'memo' }, port: 0, effect: { kind: 'memo', folder: String(cfg.folder || '工作流'), title: R(cfg.title), text: R(cfg.text) } };
    case 'out.journal':
      return { out: { queued: 'journal' }, port: 0, effect: { kind: 'journal', text: R(cfg.text) } };
    case 'out.notify':
      return { out: { queued: 'notify' }, port: 0, effect: { kind: 'notify', text: R(cfg.text) } };
    case 'out.mail':
      return { out: { queued: 'mail' }, port: 0, effect: { kind: 'mail', to: R(cfg.to), subject: R(cfg.subject), body: R(cfg.body) } };
    /* 调用子工作流 ✓（n8n 的 Execute Workflow ✓）——
       子流程存在 STORE 里（前端管 ✓），所以这里只产出 effect ✓，
       由前端递归执行 ✓（并带**深度上限**防互相调用 ✗）。 */
    case 'out.flow':
      return {
        out: { queued: 'flow', flow: String(cfg.flow || '').trim() },
        port: 0,
        effect: { kind: 'flow', flow: String(cfg.flow || '').trim(), input: String(cfg.input || '').trim() ? V(cfg.input) : input },
      };

    default:
      throw new Error('不认识的节点类型：' + t);
  }
}

/* ── 跑一整张图 ✓ ─────────────────────────────────────────────────────── */
async function runFlow(graph, options) {
  const opts = options || {};
  const ctx = {
    now: opts.now || Date.now(),
    fetch: opts.fetch || (typeof fetch === 'function' ? fetch : null),
    ai: opts.ai || null,
    aiChat: opts.aiChat || null,
    /* ★ 多提供商 ✓（2026-10-18）—— 形如 { deepseek: {baseUrl,key,models:[…],kind} } ✓ */
    providers: opts.providers || null,
    /* ★ 存远程文件 ✓（可选 ✓）—— 服务端注进来 ✓；单测里不注也能跑（只是「下载文件」节点会报错 ✓） */
    saveRemote: typeof opts.saveRemote === 'function' ? opts.saveRemote : null,
    /* ★ 轮询间隔 ✓ —— 只为**单测**能跑快 ✓（不注入就是 3 秒 ✓，用户看到的行为不变 ✓） */
    pollMs: Number(opts.pollMs) > 0 ? Math.max(0, Number(opts.pollMs)) : 3000,
    /* ★ 网页版自动化 ✓（可选 ✓）—— 服务端注入 { chat, video } ✓；
       没注入时那两个节点会**明确报错** ✓（不是静默返回空 ✗） */
    browser: opts.browser || null,
  };
  /* ★ 进度回调 ✓ —— 用户原话：「执行，也没有执行到哪的显示」✓。
     一次跑十几秒（AI 节点 30 秒 ✗）而界面**一动不动** ✗，用户只能干等 ✗。
     有了这两个回调，服务端就能**边跑边往前端推** ✓（NDJSON 流 ✓），
     画布上的节点会一个个亮起来 ✓ —— 和 n8n 一样 ✓。
     ⚠️ 回调里**不许抛** ✗ —— 推流断了不该把工作流也带崩 ✗，
        所以下面都是 `try { … } catch (_) {}` ✓。 */
  const onStart = typeof opts.onNodeStart === 'function' ? opts.onNodeStart : null;
  const onStep = typeof opts.onStep === 'function' ? opts.onStep : null;
  const emitStart = (node) => { if (onStart) { try { onStart(node); } catch (_) {} } };
  const emitStep = (step) => { if (onStep) { try { onStep(step); } catch (_) {} } };
  if (!ctx.fetch) throw new Error('这个运行环境没有 fetch ✗');
  const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
  if (!nodes.length) throw new Error('图里一个节点都没有');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = topoSort(nodes, edges);

  const startedAt = Date.now();
  const vars = {};
  const steps = [];
  const effects = [];
  /* 每个节点的「入口输入」= 所有指向它的边的上游输出合并 ✓ */
  const inbound = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => { if (inbound.has(e.to)) inbound.get(e.to).push(e); });
  /* ★ 「走不到」要按**边**记 ✗，不能按节点记 ✗ ——
     第一版只记「哪些节点被跳过了」✗，于是条件分支的另一条路上，
     节点自己的入边**没有**被标死 → 照样执行 ✗（实测：假分支也被跑了 ✗）。
     正确做法：分支节点没走的那些口 → 那些**边**死掉 ✓；
     节点被跳过时 → 它所有的**出边**也一起死掉 ✓（往下游传播 ✓）。 */
  const deadEdge = new Set();     /* "from|port" */
  const edgeKey = (e) => e.from + '|' + Number(e.port || 0);
  const killOut = (id) => edges.forEach((e) => { if (e.from === id) deadEdge.add(edgeKey(e)); });
  /* 多口节点的「出口数」✓ —— 没走的那些口都要标死 ✓ */
  const OUT_PORTS = { 'logic.if': 2, 'logic.switch': 4 };

  const mkScope = (input) => expr.makeScope({
    input, vars, nodes, now: ctx.now,
    workflow: { name: opts.workflowName || '', id: opts.workflowId || '' },
    execution: { id: opts.executionId || '', startedAt },
    env: opts.env || process.env,
  });

  for (const id of order) {
    const node = byId.get(id);
    const ins = inbound.get(id) || [];
    /* 入边**全都**是死的 → 这个节点也走不到 ✓（没有入边的触发器不在此列 ✓）*/
    if (ins.length && ins.every((e) => deadEdge.has(edgeKey(e)))) {
      killOut(id);
      const sk = { id, type: node.type, name: node.name || '', status: 'skipped' };
      steps.push(sk); emitStep(sk);
      continue;
    }
    let input = {};
    const live = ins.filter((e) => !deadEdge.has(edgeKey(e)));
    /* ★ 多入口时：**全是数组** → 给一个「数组的数组」✓（list.merge 要的就是它 ✓）；
       否则按对象合并 ✓（老行为 ✓）。 */
    const allArrays = live.length > 1 && live.every((e) => Array.isArray(vars[e.from]));
    if (allArrays) {
      input = live.map((e) => vars[e.from]);
    } else {
      live.forEach((e) => {
        const v = vars[e.from];
        if (v && typeof v === 'object' && !Array.isArray(v)) input = Object.assign(input, v);
        else input = Object.assign(input, { value: v });
      });
    }
    if (live.length === 1) {
      /* ★ 单个上游 → **原样传** ✗（n8n 里 `$json` 就是上游输出本身 ✓）。
         上一版会包成 `{ value: … }` ✗，于是下游写 `$json[0]` / `$json.length`
         全都取不到 ✗（实测：列表节点和数据节点都因此报错 ✗）。
         数组 / 字符串 / 数字现在都保持原形 ✓。 */
      input = vars[live[0].from];
    }
    const scope = mkScope(input);

    /* ★ 禁用节点 ✓（n8n 的 disabled ✓）—— **直通** ✓：
       输出 = 输入 ✓，下游照常能跑 ✓。
       ⚠️ 不能「跳过并把出边标死」✗ —— 那样一禁用中间某个节点，
          后面整条链全不跑了 ✗，用户只是想临时绕开它 ✗。 */
    if (node.disabled) {
      vars[id] = input;
      const dis = { id, type: node.type, name: node.name || '', status: 'disabled', ms: 0, out: input };
      steps.push(dis); emitStep(dis);
      continue;
    }

    /* ★ 重试 ✓（n8n 的 Retry On Fail ✓）—— 只对**抛错**重试 ✓，
       不重试「返回了错误状态码」那种（那是节点自己的语义 ✓）。 */
    const tries = 1 + Math.max(0, Math.min(5, Number(node.retry) || 0));
    const gap = Math.max(0, Math.min(30000, Number(node.retryDelay) || 0));
    const t0 = Date.now();
    let r = null;
    let lastErr = null;
    let attempt = 0;
    /* ★ 告诉前端「现在轮到它了」✓ —— 画布上这个节点会亮起来 ✓（n8n 也是这样 ✓）。 */
    emitStart(node);
    for (attempt = 1; attempt <= tries; attempt++) {
      try { r = await execNode(node, vars, input, ctx, scope); lastErr = null; break; }
      catch (error) {
        lastErr = error;
        if (attempt < tries && gap) await new Promise((res) => setTimeout(res, gap));
      }
    }
    /* ⚠️ 全失败时 `attempt` 会比实际次数**多 1** ✗（for 循环退出时自增了一次 ✓）——
       不夹一下的话日志会写「试了 4 次」而实际是 3 次 ✗（实测单测抓到过 ✗）。 */
    const used = Math.min(attempt, tries);
    const ms = Date.now() - t0;

    if (lastErr) {
      const msg = String((lastErr && lastErr.message) || lastErr);
      /* ★ 出错继续 ✓（n8n 的 Continue On Fail / onError: continue ✓）——
         给一个 `{ error }` 当输出 ✓，下游能拿到「上一步失败了」✓，
         还能用「条件分支」判断 `$json.error` ✓ 走补救路径 ✓。
         ⚠️ 不能「出错就当成功」✗ —— 那会把失败藏起来 ✗。 */
      if (String(node.onError || 'stop') === 'continue') {
        vars[id] = { error: msg, failed: true };
        const errStep = { id, type: node.type, name: node.name || '', status: 'error', error: msg, ms, attempts: used, continued: true, out: vars[id] };
        steps.push(errStep); emitStep(errStep);
        continue;
      }
      const errStep = { id, type: node.type, name: node.name || '', status: 'error', error: msg, ms, attempts: used };
      steps.push(errStep); emitStep(errStep);
      throw Object.assign(new Error(msg), { steps, vars, nodeId: id });
    }

    vars[id] = r.out;
    if (r.effect) effects.push(Object.assign({ nodeId: id, nodeName: node.name || '' }, r.effect));
    const okStep = { id, type: node.type, name: node.name || '', status: 'ok', out: r.out, port: r.port, ms, attempts: used };
    steps.push(okStep); emitStep(okStep);
    /* 分支节点：没走的那些口 → 对应的边全死掉 ✓ */
    const ports = OUT_PORTS[node.type];
    if (ports) {
      for (let p = 0; p < ports; p++) {
        if (Number(r.port) === p) continue;
        edges.filter((e) => e.from === id && Number(e.port || 0) === p).forEach((e) => deadEdge.add(edgeKey(e)));
      }
    }
  }
  return { ok: true, steps, vars, effects, startedAt, finishedAt: Date.now(), ms: Date.now() - startedAt };
}

/* ── 拓扑排序 ✓（有环报错 ✗）───────────────────────────────────────────── */
function topoSort(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  edges.forEach((e) => {
    if (!adj.has(e.from) || !indeg.has(e.to)) return;
    adj.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  });
  const q = ids.filter((id) => indeg.get(id) === 0);
  const out = [];
  while (q.length) {
    const id = q.shift();
    out.push(id);
    adj.get(id).forEach((nx) => {
      indeg.set(nx, indeg.get(nx) - 1);
      if (indeg.get(nx) === 0) q.push(nx);
    });
  }
  if (out.length !== ids.length) throw new Error('图里有**环** ✗ —— 工作流不能绕回自己（会死循环）');
  return out;
}

/* ── 对外保留的 renderTpl ✓ ─────────────────────────────────────────────
   ⚠️ **老签名是 `renderTpl(tpl, vars, input)`（三个参数）** ✗ ——
      这次换成 n8n 风格的 `renderTpl(tpl, scope)` ✓（一个 scope 里啥都有 ✓），
      但**不能把老调用方直接弄挂** ✗（实测单测里就有一条老写法挂了 ✗）。
   → 这里做个兼容壳 ✓：认得出是 scope 就走新路 ✓，否则按老三参拼一个 scope ✓。 */
function renderTpl(tpl, a, b) {
  const looksLikeScope = a && typeof a === 'object' && a.nodes && Object.prototype.hasOwnProperty.call(a, 'json');
  if (looksLikeScope) return expr.renderTpl(tpl, a);
  return expr.renderTpl(tpl, expr.makeScope({ vars: a || {}, input: b === undefined ? {} : b }));
}

module.exports = {
  runFlow, topoSort, execNode, pickArray, fmtDate, renderTpl,
  getPath, toText,
  OUT_PORTS: { 'logic.if': 2, 'logic.switch': 4 },
};
