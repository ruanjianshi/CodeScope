'use strict';
/*
 * 架构图的「语义层」—— 把片段清单交给 LLM，换回**结构化的架构描述**。
 * ---------------------------------------------------------------------------
 * ★ 为什么要有这一层（2026-10-11 用户原话）：
 *     「**缺少了很多 archify 该有的功能，没有接入 AI 去分析，解析出架构图等等**」
 *
 *   对照真正的 Archify 输出，它有两层，我一开始只做了第二层：
 *     ① **语义层**：节点标题 + 2~3 条自然语言要点 + 语义边界（"执行策略边界"这种）
 *        + 边上的理由 —— 这些**只能靠 AI 读代码得出来**，机械调用图给不出；
 *     ② **视觉层**：卡片（图标/标题/要点/徽章）+ 虚线边界框 + 网格 + 着色边。
 *
 *   这个文件只做 ①：**构 prompt** 和 **解析回复**，两个都是纯函数 ✓
 *   （所以 `tests/arch-ai.js` 能直接单测，不用起服务、不用真调 AI ✓）。
 *
 * ── 为什么坚持"只返回 JSON"──
 *   模型很爱写 ```json 围栏、爱在前后加解释 ✓。所以这里：
 *     · prompt 里**反复强调**不要围栏；
 *     · 解析时**兜底**：先剥围栏、再用括号配平抠出第一个完整 JSON ✓；
 *     · 拿到之后**逐字段校验 + 收敛**（长度、白名单、未知片段丢弃、漏掉的补上）✓。
 *   ⇒ 模型再怎么乱写，前端拿到的东西形状一定是稳的 ✓（不然渲染层会被它带崩）。
 */

/* 单个片段的代码截断 —— 别让一个超长片段把上下文吃光 ✓ */
const MAX_CODE_PER_FRAG = 3500;
const MAX_TOTAL_CODE = 60000;
const MAX_FRAGS = 40;

const TONES = ['flow', 'policy', 'config', 'data', 'io', 'other'];
const ICONS = ['flow', 'policy', 'config', 'data', 'io', 'code', 'other'];

/* ── 构 prompt（纯函数 ✓）────────────────────────────────────────────── */
function buildPrompt(doc) {
  const name = String((doc && doc.name) || '未命名文档');
  const frags = Array.isArray(doc && doc.fragments) ? doc.fragments.slice(0, MAX_FRAGS) : [];
  const parts = [];
  let budget = MAX_TOTAL_CODE;
  frags.forEach((f, i) => {
    const code = String((f && f.code) || '').slice(0, MAX_CODE_PER_FRAG);
    const taken = budget > 0 ? code.slice(0, budget) : '';
    budget -= taken.length;
    const fns = Array.isArray(f && f.functions) ? f.functions : [];
    parts.push('--- 片段 ' + (i + 1) + '：' + (f.label || ('片段' + (i + 1)))
      + '（' + (f.language || '未知语言') + '）---\n'
      + (fns.length ? '函数：' + fns.join('、') + '\n' : '')
      + '代码：\n' + (taken || '（略）'));
  });

  const system = [
    '你是资深软件架构分析师。用户会给你一个代码文档的片段清单。',
    '',
    '你的任务：把这个文档**讲清楚** —— 它由哪些模块组成、每个模块负责什么、',
    '模块之间是什么关系、有没有语义上的边界（例如"策略边界""运行时边界"）。',
    '',
    '只返回**一个 JSON 对象**。不要 Markdown 围栏，不要任何解释文字。字段：',
    '{',
    '  "title": "整个文档的架构名（中文，≤ 14 字）",',
    '  "tagline": "一句话说明它在做什么（中文，≤ 40 字）",',
    '  "groups": [ { "label": "分组名（中文，≤ 10 字）", "tone": "flow|policy|config|data|io|other",',
    '                "frags": ["片段标签", ...] } ],',
    '  "nodes": [ { "frag": "片段标签", "title": "这个模块的中文短名（≤ 10 字）",',
    '               "icon": "flow|policy|config|data|io|code|other",',
    '               "bullets": ["它负责什么（≤ 16 字）", "..."] } ],',
    '  "edges": [ { "from": "函数名", "to": "函数名", "label": "为什么调它（≤ 12 字）" } ]',
    '}',
    '',
    '规则（很重要）：',
    '1. `frags` 和 `nodes[].frag` 必须**原样**使用我给你们的片段标签，不要改写、不要漏、不要编。',
    '2. 每个片段都要有一个 node。',
    '3. groups 分 2~4 组；同一个片段只能属于一组；组的先后就是建议的阅读顺序。',
    '4. bullets 写 2~3 条，说「这个模块**做什么**」，不要复述函数名。',
    '5. edges 只写你能从代码里看出来的调用理由；看不出来就别写。',
    '6. 全部用中文。',
  ].join('\n');

  const user = '【文档】' + name + '\n【片段数】' + frags.length + '\n\n' + parts.join('\n\n');

  return { system, user };
}

/* ── 从模型回复里抠出 JSON（纯函数 ✓）──────────────────────────────────
   ⚠️ 顺序：先剥围栏 ✗ 再找第一个 `{` ✗ 都不是 —— 要**括号配平** ✓。
      模型常在 JSON 前后写解释 ✓，甚至解释里也有 `{}` ✓；
      只找第一个 `{` 会截到解释里的那个 ✓。配平能保证抠出的是**完整对象** ✓。 */
function extractJson(text) {
  let s = String(text || '');
  /* ① 剥 ``` 围栏（```json ... ``` / ``` ... ```）*/
  const fence = s.match(/```[a-zA-Z]*\s*\n([\s\S]*?)```/);
  if (fence) s = fence[1];
  /* ② 从**每一个** `{` 开始做括号配平，取**第一个能 JSON.parse 成功的** ✓
     ⚠️ 只取"第一个配平的"是不够的 ✗ —— 模型常在解释里也写花括号 ✓
        （「根据 {项目要求} 分析如下」✓），那一段也是配平的 ✓，
        会被当成结果抠出来 ✓（单测里就抓到了 ✓）。
     ⚠️ 但**全部**解析失败时要返回第一个候选 ✗ —— 这样上层能报
        「JSON 解析失败」而不是「找不到 JSON」✓（错误信息更有用 ✓）。 */
  let first = null;
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) continue;
    const cand = s.slice(start, end + 1);
    if (!first) first = cand;
    try { JSON.parse(cand); return cand; } catch (_) { /* 试下一个起点 */ }
  }
  return first;
}

function str(v, max) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}
function arr(v) { return Array.isArray(v) ? v : []; }

/* ── 解析 + 收敛（纯函数 ✓）────────────────────────────────────────────
   输入 `fragLabels` 是**服务端认得的片段标签** ✓ —— 一切以它为准：
   模型编出来的标签一律丢掉 ✓，模型漏掉的片段一律补上 ✓。
   这样前端拿到的 `nodes` 一定**一一对应**它的卡片 ✓（渲染层不用做防御 ✓）。 */
function parseReply(text, fragLabels, functionNames) {
  const raw = extractJson(text);
  if (!raw) throw new Error('AI 回复里找不到 JSON 对象');
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { throw new Error('AI 回复的 JSON 解析失败：' + String(e.message || e)); }
  if (!obj || typeof obj !== 'object') throw new Error('AI 回复的 JSON 不是对象');

  const labels = arr(fragLabels).map((x) => String(x));
  const known = new Set(labels);

  const byFrag = new Map();
  arr(obj.nodes).forEach((n) => {
    const frag = str(n && n.frag, 80);
    if (!known.has(frag) || byFrag.has(frag)) return;          /* 编的 / 重复的 → 丢 */
    const bullets = arr(n && n.bullets).map((b) => str(b, 24)).filter(Boolean).slice(0, 3);
    byFrag.set(frag, {
      frag,
      title: str(n && n.title, 14) || frag,
      icon: ICONS.indexOf(String(n && n.icon)) >= 0 ? String(n.icon) : 'code',
      bullets: bullets.length ? bullets : ['（AI 没给出要点）'],
    });
  });
  /* 模型漏掉的片段 → 补一条兜底（宁可难看，也不能少卡片 ✓）*/
  labels.forEach((f) => {
    if (!byFrag.has(f)) byFrag.set(f, { frag: f, title: f, icon: 'code', bullets: ['（AI 未分析）'] });
  });

  /* 分组：模型说的分组 → 收敛；没覆盖到的片段兜到一个「其它」组里 ✓ */
  const groups = [];
  const seen = new Set();
  arr(obj.groups).forEach((g) => {
    const members = arr(g && g.frags).map((x) => str(x, 80)).filter((x) => known.has(x) && !seen.has(x));
    if (!members.length) return;
    members.forEach((x) => seen.add(x));
    groups.push({
      label: str(g && g.label, 12) || '未命名边界',
      tone: TONES.indexOf(String(g && g.tone)) >= 0 ? String(g.tone) : 'other',
      frags: members,
    });
  });
  const rest = labels.filter((f) => !seen.has(f));
  if (rest.length) groups.push({ label: '其它', tone: 'other', frags: rest });

  /* 边：只保留两端都在**已知函数名**里的（函数名由服务端从代码里解析出来 ✓，
     模型编的函数名一律丢掉 —— 否则前端会拿它去配边、配不上就是一堆死标签 ✓）*/
  const known2 = new Set(arr(functionNames).map((x) => String(x)));
  const edges = arr(obj.edges).map((e) => ({
    from: str(e && e.from, 60), to: str(e && e.to, 60), label: str(e && e.label, 16),
  })).filter((e) => e.from && e.to && known2.has(e.from) && known2.has(e.to));

  return {
    title: str(obj.title, 16) || '架构图',
    tagline: str(obj.tagline, 48),
    groups,
    nodes: labels.map((f) => byFrag.get(f)),
    edges,
  };
}

module.exports = { buildPrompt, parseReply, extractJson, MAX_FRAGS };
