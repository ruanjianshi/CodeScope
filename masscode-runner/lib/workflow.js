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
      /* ⚠️ 输入里带 json（HTTP 节点给的 ✓）就以它为根 ✓ ——
         这样「取 data.list[0].title」这种路径能直接用 ✓，
         不用让用户写 json.data.list[0].title ✗。 */
      let obj = input;
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.json !== undefined) obj = obj.json;
      if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (_) { /* 不是 JSON 就按原样 ✓ */ } }
      const path = String(cfg.path || '').trim();
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
      const ai = ctx.ai || {};
      if (!ai.url || !ai.model) throw new Error('没配 AI ✗ —— 先去 CodeScope 的 AI 面板配一次模型（工作流会自动复用 ✓）');
      const sys = R(cfg.system).trim();
      const user = R(cfg.prompt);
      const messages = [];
      if (sys) messages.push({ role: 'system', content: sys });
      messages.push({ role: 'user', content: user || toText(input) });
      const text = await ctx.aiChat(ai, messages);
      return { out: { text }, port: 0 };
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
  };
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
      steps.push({ id, type: node.type, name: node.name || '', status: 'skipped' });
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
      steps.push({ id, type: node.type, name: node.name || '', status: 'disabled', ms: 0, out: input });
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
        steps.push({ id, type: node.type, name: node.name || '', status: 'error', error: msg, ms, attempts: used, continued: true, out: vars[id] });
        continue;
      }
      steps.push({ id, type: node.type, name: node.name || '', status: 'error', error: msg, ms, attempts: used });
      throw Object.assign(new Error(msg), { steps, vars, nodeId: id });
    }

    vars[id] = r.out;
    if (r.effect) effects.push(Object.assign({ nodeId: id, nodeName: node.name || '' }, r.effect));
    steps.push({ id, type: node.type, name: node.name || '', status: 'ok', out: r.out, port: r.port, ms, attempts: used });
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
