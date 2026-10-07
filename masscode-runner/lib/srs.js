'use strict';

/* ── 记忆复习调度：艾宾浩斯遗忘曲线 → 简化 SM-2 ✓ ──────────────────────────
   纯逻辑 ✓：不碰 DOM ✗、不读 STORE ✗、不联网 ✗、不看时钟 ✗（now 一律由调用方传 ✓）。
   → 好处：单测里能**把时间推着走** ✓，验「第 3 次复习排到几天后」这种断言 ✓。

   ★ 为什么是这个算法 ✓
     艾宾浩斯的原始曲线是「5 分钟 → 30 分钟 → 12 小时 → 1 天 → 2 天 → 4 天 …」✓；
     现代背单词软件（Anki / SuperMemo）把它做成了**按人调整**的版本 ✓。
     这里用**简化 SM-2 + 学习步** ✓，两段式：

       ① **学习步**（step 0→1→2 ✓）：新词答对 → 10 分钟后 ✓；再答对 → 1 天后 ✓。
          这两步对应艾宾浩斯曲线**最陡**的那一段 ✓（刚记住最容易忘 ✓），
          也是「今天学的词当天要再见一次」的由来 ✓。
       ② **毕业之后**（step >= 2 ✓）：按 SM-2 的长间隔 ✓ 1 天 → 6 天 → 15 天 → 38 天 …
          每次按**难度因子 ef** 放大 ✓ —— 记得越轻松（q 越高 ✓）ef 越大 ✓、间隔涨得越快 ✓；
          忘了（q < 3 ✓）→ **打回学习步** ✗ + ef 扣 0.2 ✓（这个词以后会复习得更勤 ✓）。

   ★ 卡片形状（存在 STORE.words 里 ✓）
       { ef, step, reps, lapses, ivl, due, at, hist: [{ q, at }] }
         ef      难度因子 1.3 ~ 2.8（初始 2.5 ✓）
         step    学习步 0 / 1 / 2（2 = 已毕业 ✓）
         reps    累计答对次数 ✓
         lapses  累计「忘了」次数 ✓
         ivl     当前间隔（天 ✓；毕业前是 0 ✓）
         due     下次该复习的时间戳 ✓
         hist    最近几次的评级（只留 20 条 ✓，UI 画小方块用 ✓）
   ══════════════════════════════════════════════════════════════════════ */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const STEP_MS = [10 * MIN, DAY];      /* 学习步：10 分钟 → 1 天 ✓ */
const EF0 = 2.5, EF_MIN = 1.3, EF_MAX = 2.8;
const IVL_MAX = 365;                  /* 最长一年 ✓（再长也没意义 ✗）*/
const HIST_MAX = 20;

/* 四档评级 ✓ —— q 值按 SM-2 的约定 ✓（q < 3 算「没记住」✗）*/
const GRADES = [
  { q: 1, key: 'again', label: '忘了', tip: '打回学习步，10 分钟后再来' },
  { q: 3, key: 'hard', label: '模糊', tip: '算记得，但间隔只涨一点点' },
  { q: 4, key: 'good', label: '记得', tip: '按难度因子正常放大' },
  { q: 5, key: 'easy', label: '太简单', tip: '间隔涨得更快' },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function newSrs(now) {
  const t = Number(now) || Date.now();
  return { ef: EF0, step: 0, reps: 0, lapses: 0, ivl: 0, due: t, at: t, hist: [] };
}

/* ── 复习一次 ✓（**纯函数**：返回新卡片 ✓，不改传进来的那张 ✗）──────────── */
function review(card, q, now) {
  const t = Number(now) || Date.now();
  const c = Object.assign({ ef: EF0, step: 0, reps: 0, lapses: 0, ivl: 0 }, card || {});
  let ef = Number(c.ef) || EF0;
  let step = Math.max(0, Number(c.step) || 0);
  let reps = Math.max(0, Number(c.reps) || 0);
  let lapses = Math.max(0, Number(c.lapses) || 0);
  let ivl = Math.max(0, Number(c.ivl) || 0);
  const grade = q >= 3 ? Math.min(5, Math.round(q)) : 1;
  let due;

  if (grade < 3) {
    /* 忘了 ✗：打回学习步 ✓ + 难度因子扣一点 ✓ */
    lapses++; step = 0; reps = 0; ivl = 0;
    ef = clamp(ef - 0.20, EF_MIN, EF_MAX);
    due = t + STEP_MS[0];
  } else {
    reps++;
    /* SM-2 的 ef 更新公式 ✓（q=4 时不变 ✓，q=5 加 0.1 ✓，q=3 减 0.14 ✓）*/
    ef = clamp(ef + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)), EF_MIN, EF_MAX);
    if (step < STEP_MS.length) {
      if (grade === 5) {
        /* ★★ 「太简单」= 这个词我**本来就会** ✗ ——
           那就别再让我 10 分钟后再看一遍 ✗（那是在浪费用户的时间 ✗）。
           直接毕业 ✓，给 4 天 ✓（Anki 的 Easy 在新卡上也是这个行为 ✓）。
           ⚠️ 没有这一条的话，新卡的四档会全部显示「10 分钟」✗，
              用户会觉得「这四个按钮有啥区别」✗（实测截图里就是这样 ✗）。 */
        step = STEP_MS.length; ivl = 4; due = t + 4 * DAY;
      } else {
        step++;
        due = t + STEP_MS[step - 1];
        if (step >= STEP_MS.length) ivl = 1;        /* 毕业 ✓，下次进长间隔 ✓ */
      }
    } else {
      /* 已毕业 ✓：1 天 → 6 天 → 按 ef 放大 ✓ */
      if (ivl <= 1) ivl = 6;
      else if (grade === 3) ivl = Math.max(2, Math.round(ivl * 1.2));
      else if (grade === 5) ivl = Math.max(3, Math.round(ivl * ef * 1.3));
      else ivl = Math.round(ivl * ef);
      ivl = clamp(ivl, 1, IVL_MAX);
      due = t + ivl * DAY;
    }
  }
  const hist = (Array.isArray(c.hist) ? c.hist : []).concat([{ q: grade, at: t }]).slice(-HIST_MAX);
  return { ef, step, reps, lapses, ivl, due, at: t, hist };
}

/* ── 给按钮上写「下次什么时候见」✓ ───────────────────────────────────────
   ★ 这一条**必须**有 ✗ —— 遗忘曲线是看不见的 ✗，
     但「忘了 → 10 分钟」「记得 → 3 天」写出来 ✓，
     用户**一眼就懂这套系统在干什么** ✓（比任何说明文字都管用 ✓）。 */
function fmtGap(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < MIN) return Math.max(1, Math.round(v / 1000)) + ' 秒';
  if (v < HOUR) return Math.round(v / MIN) + ' 分钟';
  if (v < DAY) return Math.round(v / HOUR) + ' 小时';
  const d = Math.round(v / DAY);
  if (d < 30) return d + ' 天';
  if (d < 365) return trimZero((d / 30).toFixed(1)) + ' 个月';
  return trimZero((d / 365).toFixed(1)) + ' 年';
}
const trimZero = (s) => String(s).replace(/\.0$/, '');
function nextIntervalText(card, q, now) {
  const t = Number(now) || Date.now();
  return fmtGap(review(card, q, t).due - t);
}
/* 四档一起算 ✓ —— UI 上四个按钮一次画完 ✓ */
function gradePreviews(card, now) {
  const t = Number(now) || Date.now();
  return GRADES.map((g) => Object.assign({}, g, { next: nextIntervalText(card, g.q, t) }));
}

/* ── 到期 / 统计 ✓ ─────────────────────────────────────────────────────── */
function dueCards(cards, now, limit) {
  const t = Number(now) || Date.now();
  const out = (cards || []).filter((c) => c && Number(c.due || 0) <= t)
    .sort((a, b) => (Number(a.due) || 0) - (Number(b.due) || 0));
  return limit ? out.slice(0, limit) : out;
}
/* 卡片阶段 ✓（和 Anki 的口径一致 ✓：新词 / 学习中 / 年轻 / 成熟 ✓）*/
function stageOf(card) {
  const c = card || {};
  if (!Number(c.reps) && !Number(c.lapses) && !Number(c.step)) return 'fresh';
  if ((Number(c.step) || 0) < STEP_MS.length) return 'learning';
  return (Number(c.ivl) || 0) >= 21 ? 'mature' : 'young';
}
function stats(cards, now) {
  const t = Number(now) || Date.now();
  const list = (cards || []).filter(Boolean);
  const s = { total: list.length, due: 0, fresh: 0, learning: 0, young: 0, mature: 0, reviewed: 0, lapses: 0, todayNew: 0 };
  const dayStart = new Date(t); dayStart.setHours(0, 0, 0, 0);
  list.forEach((c) => {
    if (Number(c.due || 0) <= t) s.due++;
    s[stageOf(c)]++;
    const h = Array.isArray(c.hist) ? c.hist : [];
    s.reviewed += h.length;
    s.lapses += Number(c.lapses) || 0;
    if ((Number(c.at) || 0) >= dayStart.getTime() && stageOf(c) === 'fresh') s.todayNew++;
  });
  /* 记住率 ✓：评级 >= 3 的比例 ✓（只在复习过的卡上算 ✓，没复习过的不算 0 分 ✗）*/
  let ok = 0, tot = 0;
  list.forEach((c) => (Array.isArray(c.hist) ? c.hist : []).forEach((h) => { tot++; if (Number(h.q) >= 3) ok++; }));
  s.retention = tot ? Math.round((ok / tot) * 100) : 0;
  s.retentionN = tot;
  return s;
}

/* ⚠️⚠️ 顶层 const 的名字必须**全局唯一** ✗✗ —— 见下面那段注释。 */
const LW_SRS_API = {
  MIN, HOUR, DAY, STEP_MS, EF0, EF_MIN, EF_MAX, IVL_MAX, HIST_MAX, GRADES,
  newSrs, review, dueCards, stageOf, stats, fmtGap, nextIntervalText, gradePreviews,
};
/* ★★ 双栖模块 ✓（和 lib/en-text.js 同一套路 ✓）——
   服务端 require ✓、浏览器里挂 window.LW_SRS ✓。
   为什么必须共享 ✗：复习算法**只能有一份** ✗ —— 前端自己算一套间隔的话，
   「按钮上写的 15 天」和「实际排到的 15 天」迟早对不上 ✗，
   而这种错用户根本查不出来 ✗（他只会觉得「这软件不准」✗）。

   ⚠️⚠️ 踩过的坑 ✗✗：这类文件是当**经典脚本**加载的 ✓，
      它们的**顶层 const 共享同一个全局词法作用域** ✗ ——
      所以两个文件都写 `const API = {...}` 时 ✗，
      第二个脚本会**整个不执行** ✗，报 `Identifier 'API' has already been declared` ✗，
      表现是「en-text 好好的、srs 是 undefined」✗，特别像加载失败 ✗（实测踩过 ✗）。
      → 两条一起做 ✓：① 顶层 const 名字带前缀（LW_xxx_API ✓）；
        ② index.html 里用 `type="module"` 加载 ✓（模块有自己的作用域 ✓，
           连 MIN / DAY / clamp 这种常见名字也不会和别的脚本撞 ✗）。 */
if (typeof module !== 'undefined' && module.exports) module.exports = LW_SRS_API;
if (typeof window !== 'undefined') window.LW_SRS = LW_SRS_API;
