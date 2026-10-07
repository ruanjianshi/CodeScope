'use strict';

/* ── 工作流「定时触发」的排期算法 ✓ ────────────────────────────────────────
   纯逻辑 ✓：不碰 DOM ✗、不读文件 ✗、不看时钟 ✗（`now` 一律由调用方传 ✓）。
   → 好处：单测里能把时间推着走 ✓，验「明天 9 点」「错过了一次补不补」这种断言 ✓。

   ★ 为什么单独一个模块 ✗
     排期逻辑最容易写错的地方**全是时间边界** ✗（跨天 / 夏令时 / 补跑 / 重启），
     而这些在服务端「等 30 秒看一眼」的循环里根本测不出来 ✗。
     抽成纯函数就能一条条打 ✓。

   ★★ 一个刻意的取舍：**不补跑** ✗
     机器睡了三天、回来时发现错过了 3 次「每天 9 点」——
     不能连跑 3 次 ✗（那会突然冒出 3 条备忘录 ✗，用户一脸问号 ✗）。
     → 一次 tick 最多跑**一次** ✓，跑完把 lastAt 记成现在 ✓，下一次自然顺延 ✓。
     代价是「错过的那几次就真的没了」✓ —— 对「每日早报」这类场景这是对的行为 ✓。

   ★★ 两种模式「第一次什么时候跑」是**不一样**的 ✓，各有各的道理 ✓：
     · **每隔一段**：从没跑过 → **立刻跑一次** ✓
       （刚配好就能看到它通了 ✓；而且「从现在起算一个间隔」那种写法
        会**永远跑不起来** ✗ —— 每次扫描都重算 ✗，永远差一个间隔 ✗，实测踩过 ✗）
     · **每天定时**：从没跑过 → **等下一个到点** ✓
       （下午 3 点配了个「每天 9 点」✗，不该立刻弹一条出来 ✗）
   ══════════════════════════════════════════════════════════════════════════ */

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const MAX_EVERY_MIN = 7 * 24 * 60;      /* 最长一周一次 ✓（再长就别用定时了 ✗） */

/* "9:00" / "09:00" / "9：00"（全角冒号 ✓）→ { h, mi } ✓；不合法给 null ✓ */
function parseAt(s) {
  const m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(mi >= 0 && mi <= 59)) return null;
  return { h, mi };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ⚠️ 模式值要**两种写法都认** ✗ ——
   前端那个 select 的选项文字就是「值」本身 ✓（见 FLOW_NODES 里 select 的渲染 ✓），
   所以中文界面下传过来的是「每天定时」✗，而不是 'daily' ✗。
   只认英文的话，用户选「每天」会**静默地按间隔模式跑** ✗（最难查的那种 ✗）。 */
const isDaily = (mode) => {
  const m = String(mode == null ? '' : mode).trim().toLowerCase();
  return m === 'daily' || m === '每天' || m === '每天定时';
};

/* 触发器配置 → 下一次该跑的时间戳 ✓（算不出来给 null ✓） */
function nextAt(cfg, lastAt, now) {
  const c = cfg || {};
  const last = Number(lastAt) || 0;
  const t = Number(now) || Date.now();

  if (isDaily(c.mode)) {
    const at = parseAt(c.at);
    if (!at) return null;                       /* at 写错了 → 不排（界面上会提示 ✓） */
    const d = new Date(t);
    d.setHours(at.h, at.mi, 0, 0);
    let next = d.getTime();
    /* 今天这一班已经跑过了 → 明天 ✓ */
    if (next <= last) next += DAY;
    /* ★ 从没跑过、而今天的点也已经过了 → **明天**，不是「现在补一次」✗
       （用户 10 点才把「每天 9 点」配好，不该立刻弹一条出来 ✗） */
    else if (!last && next < t) next += DAY;
    return next;
  }

  /* ⚠️⚠️ 从没跑过时**必须给一个不随时间漂移的答案** ✗✗ ——
     第一版写的是「从现在起算一个间隔」（`t + every` ✗），看着很合理 ✓，
     实际是**永远跑不起来** ✗✗：每次扫描都重新算一遍 ✗ → 永远差 60 秒 ✗ → 永远不到期 ✗。
     实测：探针等了 100 秒，「还有 60s」一个字都没变过 ✗。
     （单测也没抓到 ✗ —— 因为只测了「有 last」的情况 ✗。）
     → 正解：**从没跑过 = 立刻到期** ✓，跑完记下时间 ✓，之后就走 `last + every` ✓。
     副作用正好是好的 ✓：刚配好一个定时任务，它会在 30 秒内先跑一次 ✓ ——
     用户马上就知道「通了 ✓」，而不是干等一小时 ✓。 */
  const every = clamp(Number(c.every) || 60, 1, MAX_EVERY_MIN) * MIN;
  return last ? last + every : t;
}

/* 一个工作流里所有的定时触发器 ✓ */
function triggersOf(flow) {
  return ((flow && flow.nodes) || []).filter((n) => n && n.type === 'trigger.timer' && !n.disabled);
}

/* 扫一遍：每个定时触发器现在什么状态 ✓（due = 该跑了 ✓） */
function scan(flows, state, now) {
  const t = Number(now) || Date.now();
  const st = state || {};
  const out = [];
  (flows || []).forEach((f) => {
    if (!f || !f.id) return;
    triggersOf(f).forEach((n) => {
      const key = f.id + '/' + n.id;
      const last = Number(st[key]) || 0;
      const at = nextAt(n.cfg || {}, last, t);
      if (at == null) {
        out.push({ key, flowId: f.id, flowName: f.name || '', nodeId: n.id, cfg: n.cfg || {}, lastAt: last, nextAt: null, due: false, bad: '时间写错了（要像 09:00 这样）' });
        return;
      }
      out.push({ key, flowId: f.id, flowName: f.name || '', nodeId: n.id, cfg: n.cfg || {}, lastAt: last, nextAt: at, due: at <= t, bad: '' });
    });
  });
  return out;
}
const dueList = (flows, state, now) => scan(flows, state, now).filter((x) => x.due);

/* 人话描述 ✓（界面 / 日志都用它 ✓，省得两边各写一套 ✗） */
function describe(cfg) {
  const c = cfg || {};
  if (isDaily(c.mode)) {
    const at = parseAt(c.at);
    return at ? ('每天 ' + pad(at.h) + ':' + pad(at.mi)) : '每天（时间没填对）';
  }
  const n = clamp(Number(c.every) || 60, 1, MAX_EVERY_MIN);
  if (n % (24 * 60) === 0) return '每 ' + (n / (24 * 60)) + ' 天';
  if (n % 60 === 0) return '每 ' + (n / 60) + ' 小时';
  return '每 ' + n + ' 分钟';
}
const pad = (n) => String(n).padStart(2, '0');

/* 「还有多久」✓ */
function untilText(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v)) return '—';
  if (v <= 0) return '马上';
  const m = Math.round(v / MIN);
  if (m < 60) return m + ' 分钟后';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时 ' + (m % 60) + ' 分后';
  return Math.floor(h / 24) + ' 天 ' + (h % 24) + ' 小时后';
}

const API = { MIN, DAY, MAX_EVERY_MIN, parseAt, nextAt, isDaily, triggersOf, scan, dueList, describe, untilText };
/* 双栖 ✓（和 lib/en-text.js / lib/srs.js / lib/expr.js 同一套路 ✓）——
   ⚠️ 顶层 const 名字必须唯一 ✗；浏览器里用 type="module" 加载 ✓。 */
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.LW_FLOW_SCHED = API;
