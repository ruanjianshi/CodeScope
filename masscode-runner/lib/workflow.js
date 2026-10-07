'use strict';

/* ── 工作流执行引擎（参考 n8n 的节点图模型）────────────────────────────────
   纯逻辑、无 DOM ✓，可以在单测里直接跑 ✓。

   模型（和 n8n 一样）：
     graph = {
       nodes: [{ id, type, x, y, cfg: {…} }],
       edges: [{ from: <nodeId>, port: <0|1>, to: <nodeId> }],
     }
   · 按**拓扑序**执行 ✓（有环直接报错 ✗ —— 免得死循环把服务挂住 ✗）
   · 每个节点的输出写进 vars[nodeId] ✓，下游用 `{{nodeId}}` / `{{nodeId.字段}}` 引用 ✓
   · `{{input}}` = 所有上游输出的合并 ✓（只有一个上游时就是它的输出 ✓）

   ★ 输出类节点（写备忘录 / 写日记 / 通知 / 发邮件）**不在这里落地** ✗ ——
     引擎只产出 `effects` 数组 ✓，由**前端**应用 ✓（因为 STORE 归前端管 ✓）。
     这样引擎保持纯函数 ✓，可单测 ✓，也不会偷偷改用户数据 ✗。
   ══════════════════════════════════════════════════════════════════════ */

/* ── 变量解析：把 {{a.b[0]}} 换成实际值 ✓ ─────────────────────────────── */
function getPath(obj, path) {
  const parts = String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v, null, 2); } catch (_) { return String(v); }
}
function renderTpl(tpl, vars, input) {
  return String(tpl == null ? '' : tpl).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr) => {
    const key = String(expr).trim();
    if (key === 'input') return toText(input);
    if (Object.prototype.hasOwnProperty.call(vars, key)) return toText(vars[key]);
    const dot = key.indexOf('.');
    if (dot > 0) {
      const head = key.slice(0, dot);
      if (Object.prototype.hasOwnProperty.call(vars, head)) {
        const v = getPath(vars[head], key.slice(dot + 1));
        return v === undefined ? '' : toText(v);
      }
    }
    return '';
  });
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

/* ── 单节点执行 ✓ ─────────────────────────────────────────────────────── */
async function execNode(node, vars, input, ctx) {
  const cfg = node.cfg || {};
  const t = String(node.type || '');
  switch (t) {
    case 'trigger.manual':
    case 'trigger.timer':
    case 'trigger.webhook':
      return { out: { at: ctx.now, fired: true }, port: 0 };

    case 'http.request': {
      const url = renderTpl(cfg.url, vars, input).trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('HTTP 请求的 URL 不合法（要 http/https 开头）');
      const method = String(cfg.method || 'GET').toUpperCase();
      const opt = { method, headers: { 'content-type': 'application/json' } };
      if (method !== 'GET' && method !== 'HEAD' && String(cfg.body || '').trim()) {
        opt.body = renderTpl(cfg.body, vars, input);
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
      return { out: renderTpl(cfg.text, vars, input), port: 0 };

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

    case 'logic.if': {
      const l = renderTpl(cfg.left, vars, input);
      const r = renderTpl(cfg.right, vars, input);
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

    case 'logic.merge':
      return { out: input, port: 0 };

    case 'util.delay': {
      const ms = Math.max(0, Math.min(30000, Number(renderTpl(cfg.ms, vars, input)) || 0));
      await new Promise((r) => setTimeout(r, ms));
      return { out: { waited: ms }, port: 0 };
    }

    case 'ai.chat': {
      const ai = ctx.ai || {};
      if (!ai.url || !ai.model) throw new Error('没配 AI ✗ —— 先去「邮箱 / 设置」里配好大模型，或在工作流设置里填');
      const sys = renderTpl(cfg.system, vars, input).trim();
      const user = renderTpl(cfg.prompt, vars, input);
      const messages = [];
      if (sys) messages.push({ role: 'system', content: sys });
      messages.push({ role: 'user', content: user || toText(input) });
      const text = await ctx.aiChat(ai, messages);
      return { out: { text }, port: 0 };
    }

    /* 输出类：**不落地** ✓，只产出 effect ✓（前端去应用 ✓）*/
    case 'out.memo':
      return { out: { queued: 'memo' }, port: 0, effect: { kind: 'memo', folder: String(cfg.folder || '工作流'), title: renderTpl(cfg.title, vars, input), text: renderTpl(cfg.text, vars, input) } };
    case 'out.journal':
      return { out: { queued: 'journal' }, port: 0, effect: { kind: 'journal', text: renderTpl(cfg.text, vars, input) } };
    case 'out.notify':
      return { out: { queued: 'notify' }, port: 0, effect: { kind: 'notify', text: renderTpl(cfg.text, vars, input) } };
    case 'out.mail':
      return { out: { queued: 'mail' }, port: 0, effect: { kind: 'mail', to: renderTpl(cfg.to, vars, input), subject: renderTpl(cfg.subject, vars, input), body: renderTpl(cfg.body, vars, input) } };

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

  const vars = {};
  const steps = [];
  const effects = [];
  /* 每个节点的「入口输入」= 所有指向它的边的上游输出合并 ✓ */
  const inbound = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => { if (inbound.has(e.to)) inbound.get(e.to).push(e); });
  /* ★ 「走不到」要按**边**记 ✗，不能按节点记 ✗ ——
     第一版只记「哪些节点被跳过了」✗，于是条件分支的另一条路上，
     节点自己的入边**没有**被标死 → 照样执行 ✗（实测：假分支也被跑了 ✗）。
     正确做法：条件节点没走的那个口 → 那条**边**死掉 ✓；
     节点被跳过时 → 它所有的**出边**也一起死掉 ✓（往下游传播 ✓）。 */
  const deadEdge = new Set();     /* "from|port" */
  const edgeKey = (e) => e.from + '|' + Number(e.port || 0);
  const killOut = (id) => edges.forEach((e) => { if (e.from === id) deadEdge.add(edgeKey(e)); });

  for (const id of order) {
    const node = byId.get(id);
    const ins = inbound.get(id) || [];
    /* 入边**全都**是死的 → 这个节点也走不到 ✓（没有入边的触发器不在此列 ✓）*/
    if (ins.length && ins.every((e) => deadEdge.has(edgeKey(e)))) {
      killOut(id);
      steps.push({ id, type: node.type, status: 'skipped' });
      continue;
    }
    let input = {};
    const live = ins.filter((e) => !deadEdge.has(edgeKey(e)));
    live.forEach((e) => {
      const v = vars[e.from];
      if (v && typeof v === 'object' && !Array.isArray(v)) input = Object.assign(input, v);
      else input = Object.assign(input, { value: v });
    });
    if (live.length === 1) {
      const only = vars[live[0].from];
      input = (only && typeof only === 'object' && !Array.isArray(only)) ? Object.assign({}, only) : { value: only };
    }
    const t0 = Date.now();
    try {
      const r = await execNode(node, vars, input, ctx);
      vars[id] = r.out;
      if (r.effect) effects.push(Object.assign({ nodeId: id }, r.effect));
      steps.push({ id, type: node.type, status: 'ok', out: r.out, port: r.port, ms: Date.now() - t0 });
      /* 条件分支：没走的那个口 → 那条边死掉 ✓（下游会因此被跳过 ✓）*/
      if (node.type === 'logic.if') {
        const dead = r.port === 0 ? 1 : 0;
        edges.filter((e) => e.from === id && Number(e.port || 0) === dead).forEach((e) => deadEdge.add(edgeKey(e)));
      }
    } catch (error) {
      steps.push({ id, type: node.type, status: 'error', error: String((error && error.message) || error), ms: Date.now() - t0 });
      throw Object.assign(new Error(String((error && error.message) || error)), { steps, vars, nodeId: id });
    }
  }
  return { ok: true, steps, vars, effects };
}

module.exports = { runFlow, topoSort, renderTpl, getPath, toText };
