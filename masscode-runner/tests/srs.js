/* 记忆复习调度（lib/srs.js）—— 纯单测 ✓，把时间推着走 ✓，不起服务 ✓。
   ⚠️ 这里验的是「艾宾浩斯曲线到底有没有真的生效」✗ ——
      所以重点是**间隔序列**（10 分钟 → 1 天 → 6 天 → 15 天 → 38 天 ✗），
      以及「忘了要打回学习步」✗ 这两件事 ✓。 */
const S = require('../lib/srs.js');

let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; } else { fails.push(n + (x ? '  → ' + x : '')); console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
const eq = (n, a, b) => ck(n, JSON.stringify(a) === JSON.stringify(b), '得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));

const T0 = 1760000000000;                     /* 固定时间戳 ✓（不依赖真实时钟 ✗）*/
const MIN = 60 * 1000, DAY = 24 * 3600 * 1000;
const gap = (due, from) => Math.round((due - from) / MIN) + 'min';   /* 用分钟比，避免毫秒误差 ✗ */

console.log('── ① 新卡片 ──');
const c0 = S.newSrs(T0);
eq('初始 ef = 2.5', c0.ef, 2.5);
eq('初始 step = 0', c0.step, 0);
eq('初始 ivl = 0', c0.ivl, 0);
ck('初始立刻到期（今天就能学）', c0.due === T0, String(c0.due));
eq('初始阶段 = fresh', S.stageOf(c0), 'fresh');

console.log('\n── ② 学习步：10 分钟 → 1 天（艾宾浩斯最陡的那一段）──');
const a1 = S.review(c0, 4, T0);
eq('第 1 次答对 → step 1', a1.step, 1);
eq('★ 第 1 次答对 → 10 分钟后', gap(a1.due, T0), '10min');
ck('★ 这时还没毕业（ivl 还是 0）', a1.ivl === 0, String(a1.ivl));
const a2 = S.review(a1, 4, T0 + 10 * MIN);
eq('第 2 次答对 → step 2（毕业）', a2.step, 2);
eq('★ 第 2 次答对 → 1 天后', gap(a2.due, T0 + 10 * MIN), String(24 * 60) + 'min');
eq('★ 毕业时 ivl 设成 1 天', a2.ivl, 1);
eq('阶段 → young', S.stageOf(a2), 'young');

console.log('\n── ③ 毕业后的长间隔：1 → 6 → 15 → 38 …（经典 SM-2 序列）──');
let cur = a2, t = T0 + 10 * MIN + DAY;
const seq = [cur.ivl];
for (let i = 0; i < 5; i++) { cur = S.review(cur, 4, t); seq.push(cur.ivl); t = cur.due; }
eq('★ ivl 序列', seq, [1, 6, 15, 38, 95, 238]);
ck('★ 间隔确实在变长', seq.every((v, i) => i === 0 || v > seq[i - 1]), JSON.stringify(seq));

console.log('\n── ③b 「太简单」在新卡上**直接毕业**（别再让我 10 分钟后再看一遍）──');
const easyNew = S.review(S.newSrs(T0), 5, T0);
eq('★ 直接毕业（step = 2）', easyNew.step, 2);
eq('★ 而且给 4 天，不是 10 分钟', easyNew.ivl, 4);
eq('★ due 落在 4 天后', gap(easyNew.due, T0), String(4 * 24 * 60) + 'min');
const pvNew = S.gradePreviews(S.newSrs(T0), T0).map((g) => g.next);
ck('★ 新卡四档不再全是「10 分钟」（那四个按钮就没区别了）', pvNew[3] === '4 天' && pvNew[0] === '10 分钟', JSON.stringify(pvNew));

console.log('\n── ④ 难度因子：记得越轻松，涨得越快 ──');
const base = { ef: 2.5, step: 2, reps: 3, ivl: 6, due: T0 };
const hard = S.review(base, 3, T0);
const good = S.review(base, 4, T0);
const easy = S.review(base, 5, T0);
ck('★ 模糊 < 记得 < 太简单', hard.ivl < good.ivl && good.ivl < easy.ivl,
  JSON.stringify({ 模糊: hard.ivl, 记得: good.ivl, 太简单: easy.ivl }));
eq('模糊 = round(6 × 1.2) = 7', hard.ivl, 7);
eq('记得 = round(6 × 2.5) = 15', good.ivl, 15);
eq('太简单 = round(6 × 2.5 × 1.3) = 20', easy.ivl, 20);
ck('★ 太简单会抬高 ef（2.5 → 2.6）', Math.abs(easy.ef - 2.6) < 1e-9, String(easy.ef));
ck('★ 模糊会压低 ef（2.5 → 2.36）', Math.abs(hard.ef - 2.36) < 1e-9, String(hard.ef));
ck('记得不动 ef（还是 2.5）', Math.abs(good.ef - 2.5) < 1e-9, String(good.ef));

console.log('\n── ⑤ 忘了：打回学习步（这才是遗忘曲线的核心）──');
const grad = { ef: 2.5, step: 2, reps: 8, ivl: 38, due: T0, hist: [] };
const forgot = S.review(grad, 1, T0);
eq('★ 打回 step 0', forgot.step, 0);
eq('★ ivl 清零', forgot.ivl, 0);
eq('★ 答对次数清零', forgot.reps, 0);
eq('★ 忘了次数 +1', forgot.lapses, 1);
eq('★ 10 分钟后就再见它', gap(forgot.due, T0), '10min');
ck('★ ef 扣 0.2（2.5 → 2.3）', Math.abs(forgot.ef - 2.3) < 1e-9, String(forgot.ef));
eq('★ 阶段回到 learning', S.stageOf(forgot), 'learning');
const again = S.review(forgot, 4, T0 + 10 * MIN);
eq('再答对 → step 1', again.step, 1);
eq('★ 而且 ivl 从 0 重新爬（不是回到 38）', again.ivl, 0);

console.log('\n── ⑥ ef 的上下限（不能被刷爆）──');
let up = S.newSrs(T0); for (let i = 0; i < 12; i++) up = S.review(up, 5, T0 + i * DAY);
ck('★ 一直「太简单」→ ef 封顶 2.8', up.ef <= S.EF_MAX + 1e-9 && up.ef > 2.7, String(up.ef));
let dn = { ef: 2.5, step: 2, reps: 3, ivl: 6, due: T0 }; for (let i = 0; i < 12; i++) dn = S.review(dn, 1, T0 + i * DAY);
ck('★ 一直「忘了」→ ef 托底 1.3', dn.ef >= S.EF_MIN - 1e-9 && dn.ef < 1.5, String(dn.ef));
let long = { ef: 2.5, step: 2, reps: 9, ivl: 300, due: T0 };
for (let i = 0; i < 4; i++) long = S.review(long, 4, long.due);
ck('★ 间隔封顶 365 天', long.ivl === S.IVL_MAX, String(long.ivl));

console.log('\n── ⑦ 纯函数：不许改传进来的卡片 ──');
const orig = S.newSrs(T0);
const snapshot = JSON.stringify(orig);
S.review(orig, 1, T0 + DAY);
S.review(orig, 5, T0 + DAY);
eq('原卡片一个字节都没变', JSON.stringify(orig), snapshot);

console.log('\n── ⑧ 历史记录 ──');
let h = S.newSrs(T0);
for (let i = 0; i < 25; i++) h = S.review(h, i % 4 === 0 ? 1 : 4, T0 + i * DAY);
ck('★ hist 只留最近 20 条（不会无限长）', h.hist.length === S.HIST_MAX, String(h.hist.length));
ck('★ 记下了评级和时间', h.hist[0] && typeof h.hist[0].q === 'number' && h.hist[0].at > 0, JSON.stringify(h.hist[0]));

console.log('\n── ⑨ 到期排序 ──');
const cards = [
  { id: 'a', due: T0 + 5 * DAY }, { id: 'b', due: T0 - DAY }, { id: 'c', due: T0 - 3 * DAY }, { id: 'd', due: T0 + DAY },
];
eq('★ 只拿到期的', S.dueCards(cards, T0).map((x) => x.id), ['c', 'b']);
eq('★ 按到期时间排序（越早越先）', S.dueCards(cards, T0).map((x) => x.id), ['c', 'b']);
eq('limit 生效', S.dueCards(cards, T0, 1).map((x) => x.id), ['c']);
eq('没有到期的 → 空', S.dueCards([{ due: T0 + DAY }], T0).length, 0);

console.log('\n── ⑩ 阶段统计 ──');
const mixed = [
  S.newSrs(T0),                                                    /* fresh */
  S.review(S.newSrs(T0), 4, T0),                                   /* learning */
  { step: 2, ivl: 6, reps: 3, lapses: 0, due: T0 - 1 },            /* young */
  { step: 2, ivl: 30, reps: 6, lapses: 0, due: T0 + DAY },         /* mature */
];
const st = S.stats(mixed, T0);
eq('总数', st.total, 4);
eq('新词', st.fresh, 1);
eq('学习中', st.learning, 1);
eq('年轻', st.young, 1);
eq('成熟', st.mature, 1);
eq('★ 到期数 = 2（新卡立刻到期 + 那张 young）', st.due, 2);
ck('★ 记住率只在复习过的卡上算（没复习过的不算 0 分）', st.retentionN >= 1 && st.retention === 100, JSON.stringify({ n: st.retentionN, r: st.retention }));
const st2 = S.stats([S.review(S.review(S.newSrs(T0), 4, T0), 1, T0)], T0);
ck('★ 忘过一次 → 记住率 50%', st2.retention === 50, String(st2.retention));
eq('空列表不炸', S.stats([], T0).total, 0);
eq('null 不炸', S.stats(null, T0).total, 0);

console.log('\n── ⑪ 「下次什么时候见」的文案（遗忘曲线要**看得见**）──');
eq('10 分钟', S.fmtGap(10 * MIN), '10 分钟');
eq('3 小时', S.fmtGap(3 * 60 * MIN), '3 小时');
eq('1 天', S.fmtGap(DAY), '1 天');
eq('29 天', S.fmtGap(29 * DAY), '29 天');
eq('30 天 → 1 个月', S.fmtGap(30 * DAY), '1 个月');
eq('90 天 → 3 个月', S.fmtGap(90 * DAY), '3 个月');
eq('365 天 → 1 年', S.fmtGap(365 * DAY), '1 年');
eq('45 秒', S.fmtGap(45 * 1000), '45 秒');
const grad2 = { ef: 2.5, step: 2, reps: 3, ivl: 6, due: T0 };
const pv = S.gradePreviews(grad2, T0);
eq('★ 四档都给出了「下次间隔」', pv.map((g) => g.next), ['10 分钟', '7 天', '15 天', '20 天']);
eq('★ 四档文案', pv.map((g) => g.label), ['忘了', '模糊', '记得', '太简单']);
ck('★ 四档的间隔是单调递增的（除了「忘了」）', pv[1].next !== pv[0].next && pv[3].next !== pv[2].next, JSON.stringify(pv.map((g) => g.next)));
eq('nextIntervalText 和 gradePreviews 一致', S.nextIntervalText(grad2, 4, T0), '15 天');

console.log('\n── ⑫ 输入脏数据不许炸 ──');
ck('review(null)', !!S.review(null, 4, T0).due);
ck('review({}, 4)', !!S.review({}, 4, T0).due);
ck('q 传 0 当「忘了」', S.review(S.newSrs(T0), 0, T0).lapses === 1);
ck('q 传 99 被夹住', S.review({ step: 2, ivl: 6, ef: 2.5 }, 99, T0).ivl >= 6);
ck('now 不传时，按当前时间算 10 分钟后', Math.abs((S.review(S.newSrs(), 4).due - Date.now()) - 10 * MIN) < 5000);
ck('stageOf(null)', S.stageOf(null) === 'fresh');
ck('ef 是字符串也不炸', !!S.review({ ef: '2.5', step: 2, ivl: 6 }, 4, T0).due);

console.log('\n记忆复习调度：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败 ✗' : ' ✓'));
if (fails.length) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
