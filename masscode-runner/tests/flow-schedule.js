/* 工作流定时排期（lib/flow-schedule.js）—— 纯单测 ✓，把时间推着走 ✓，不起服务 ✓。
   ⚠️ 这里打的全是**时间边界** ✗ —— 跨天 / 补跑 / 重启 / 配置写错 ✓，
      这些在服务端「等 30 秒看一眼」的循环里根本测不出来 ✗。 */
const S = require('../lib/flow-schedule.js');

let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; } else { fails.push(n + (x ? '  → ' + x : '')); console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
const eq = (n, a, b) => ck(n, JSON.stringify(a) === JSON.stringify(b), '得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));

const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
/* 固定一个基准时刻：2026-10-07 是周三 ✓；用**本地时间**构造 ✓（排期本来就是本地时间语义 ✓） */
const T = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0, 0, 0).getTime();

console.log('── ① 解析时间字符串 ──');
eq('09:00', S.parseAt('09:00'), { h: 9, mi: 0 });
eq('9:5 也认', S.parseAt('9:5'), { h: 9, mi: 5 });
eq('全角冒号也认', S.parseAt('9：30'), { h: 9, mi: 30 });
eq('两边有空格也认', S.parseAt('  08:15  '), { h: 8, mi: 15 });
ck('25:00 不合法', S.parseAt('25:00') === null, String(S.parseAt('25:00')));
ck('9:60 不合法', S.parseAt('9:60') === null, String(S.parseAt('9:60')));
ck('空 / 乱写 → null', S.parseAt('') === null && S.parseAt('早上九点') === null && S.parseAt(null) === null);

console.log('\n── ② 间隔模式 ──');
const iv = (every) => ({ mode: 'interval', every: String(every) });
ck('★ 从没跑过 → **立刻到期**（刚配好就让它先跑一次，用户马上知道通了）',
  S.nextAt(iv(60), 0, T(2026, 10, 7, 10, 0)) === T(2026, 10, 7, 10, 0));
/* ★★ 回归：第一版写的是「从现在起算一个间隔」✗ ——
   每次扫描都重算 ✗ → 永远差一个间隔 ✗ → **永远不到期** ✗（实测等 100 秒没动静 ✗）。
   ⚠️ 要钉死的**不是**「答案不变」✗（返回 `now` 当然会变 ✓），
      而是**「它一定是 due」** ✓ —— 这才是被那个 bug 弄坏的性质 ✓。 */
ck('★★ 回归：从没跑过的间隔任务，一定是「该跑了」（第一版永远不到期 ✗）',
  S.nextAt(iv(60), 0, T(2026, 10, 7, 10, 0)) <= T(2026, 10, 7, 10, 0)
  && S.nextAt(iv(60), 0, T(2026, 10, 7, 10, 0) + 30000) <= T(2026, 10, 7, 10, 0) + 30000
  && S.nextAt(iv(60), 0, T(2026, 10, 7, 10, 0) + 3600000) <= T(2026, 10, 7, 10, 0) + 3600000,
  '三个不同时刻问，都要 <= 当时刻');
ck('★ 而且它一上来就是「该跑了」', S.dueList([{ id: 'w', nodes: [{ id: 't', type: 'trigger.timer', cfg: { every: '60' } }] }], {}, T(2026, 10, 7, 10, 0)).length === 1);
ck('跑过一次之后 → 上次 + 间隔', S.nextAt(iv(30), T(2026, 10, 7, 10, 0), T(2026, 10, 7, 10, 5)) === T(2026, 10, 7, 10, 30));
ck('★ 错过很久也只差一个间隔（不补跑）',
  S.nextAt(iv(60), T(2026, 10, 1, 10, 0), T(2026, 10, 7, 10, 0)) === T(2026, 10, 1, 11, 0));
/* ⚠️ `Number(c.every) || 60` 里 `0` 会被当成「没填」→ 走 60 ✓（故意的 ✗：
   间隔填 0 没意义 ✓，给个能跑的默认值比「1 分钟一次刷爆机器」友好 ✓）。
   要验这个得给一个**非 0 的 last** ✗，不然走的是「立刻到期」那条 ✓。 */
ck('间隔填 0 → 当「没填」，走默认 60 分钟（不是 1 分钟一次刷爆机器）',
  S.nextAt(iv(0), T(2026, 10, 7, 10, 0), T(2026, 10, 7, 10, 0)) === T(2026, 10, 7, 11, 0),
  new Date(S.nextAt(iv(0), T(2026, 10, 7, 10, 0), T(2026, 10, 7, 10, 0))).toString());
ck('间隔填负数 → 夹到最小 1 分钟', S.nextAt(iv(-5), T(2026, 10, 7, 10, 0), T(2026, 10, 7, 10, 0)) === T(2026, 10, 7, 10, 1));
ck('间隔最大一周（写 99999 也夹到 7 天）', S.nextAt(iv(99999), T(2026, 10, 7, 10, 0), T(2026, 10, 7, 10, 0)) === T(2026, 10, 14, 10, 0));
ck('没写 every → 默认 60 分钟', S.nextAt({ mode: 'interval' }, T(2026, 10, 7, 10, 0), T(2026, 10, 7, 10, 0)) === T(2026, 10, 7, 11, 0));
ck('没写 mode → 当间隔模式', S.nextAt({ every: '30' }, T(2026, 10, 7, 10, 0), T(2026, 10, 7, 10, 0)) === T(2026, 10, 7, 10, 30));

console.log('\n── ③ 每天模式 ──');
const dy = (at) => ({ mode: 'daily', at });
ck('★ 今天还没到点 → 今天那个点', S.nextAt(dy('09:00'), 0, T(2026, 10, 7, 8, 0)) === T(2026, 10, 7, 9, 0));
ck('★ 今天已经过点了、但**从没跑过** → 明天（不立刻补一条出来）',
  S.nextAt(dy('09:00'), 0, T(2026, 10, 7, 10, 0)) === T(2026, 10, 8, 9, 0),
  new Date(S.nextAt(dy('09:00'), 0, T(2026, 10, 7, 10, 0))).toString());
ck('★ 今天这一班跑过了 → 明天', S.nextAt(dy('09:00'), T(2026, 10, 7, 9, 0), T(2026, 10, 7, 10, 0)) === T(2026, 10, 8, 9, 0));
ck('★ 昨天跑过、今天还没到点 → 今天', S.nextAt(dy('09:00'), T(2026, 10, 6, 9, 0), T(2026, 10, 7, 8, 0)) === T(2026, 10, 7, 9, 0));
ck('★ 机器睡了三天 → 仍然是「今天那个点」（只补一次，不是三次）',
  S.nextAt(dy('09:00'), T(2026, 10, 4, 9, 0), T(2026, 10, 7, 8, 0)) === T(2026, 10, 7, 9, 0));
ck('时间写错 → 不排（给 null）', S.nextAt(dy('乱写'), 0, T(2026, 10, 7, 8, 0)) === null);
ck('跨天要落在明天同一时刻', S.nextAt(dy('23:30'), T(2026, 10, 7, 23, 30), T(2026, 10, 8, 1, 0)) === T(2026, 10, 8, 23, 30));
/* ⚠️ 前端那个 select 的**选项文字就是值** ✓，中文界面下传过来的是「每天定时」✗ ——
   只认 'daily' 的话，用户选「每天」会静默按间隔模式跑 ✗（最难查的那种 ✗）。 */
ck('★ 中文选项「每天定时」也要认', S.nextAt({ mode: '每天定时', at: '09:00' }, 0, T(2026, 10, 7, 8, 0)) === T(2026, 10, 7, 9, 0));
ck('★ 中文选项「每天」也要认', S.nextAt({ mode: '每天', at: '09:00' }, 0, T(2026, 10, 7, 8, 0)) === T(2026, 10, 7, 9, 0));
ck('  大小写也不挑（DAILY）', S.nextAt({ mode: 'DAILY', at: '09:00' }, 0, T(2026, 10, 7, 8, 0)) === T(2026, 10, 7, 9, 0));
ck('  描述也跟着认', S.describe({ mode: '每天定时', at: '09:00' }) === '每天 09:00');

console.log('\n── ④ scan / dueList ──');
const flows = [
  { id: 'w1', name: '每日早报', nodes: [{ id: 't1', type: 'trigger.timer', cfg: { mode: 'daily', at: '09:00' } }, { id: 'a', type: 'out.memo', cfg: {} }] },
  { id: 'w2', name: '每半小时', nodes: [{ id: 't2', type: 'trigger.timer', cfg: { every: '30' } }] },
  { id: 'w3', name: '手动的', nodes: [{ id: 't3', type: 'trigger.manual', cfg: {} }] },
  { id: 'w4', name: '禁用的定时', nodes: [{ id: 't4', type: 'trigger.timer', disabled: true, cfg: { every: '5' } }] },
];
const sc = S.scan(flows, {}, T(2026, 10, 7, 8, 0));
eq('★ 只认 trigger.timer（手动触发不算）', sc.length, 2);
eq('  禁用掉的那个也不算', sc.map((x) => x.key), ['w1/t1', 'w2/t2']);
ck('  都能算出下次时间', sc.every((x) => typeof x.nextAt === 'number'), JSON.stringify(sc.map((x) => x.nextAt)));
/* ⚠️ 每条断言用**各自的**种子时间 ✗ ——
   给「每半小时」塞 8:00 的话，到 9:00 时它已经过期两轮了 ✓ → 也该跑 ✓，
   于是「只该跑每日早报」这条会多出它一个 ✗（不是 bug ✓，是我种子选得不对 ✗）。 */
const seed = (t) => ({ 'w2/t2': t });
eq('  没到点 → 一个都不该跑', S.dueList(flows, seed(T(2026, 10, 7, 8, 0)), T(2026, 10, 7, 8, 0)).length, 0);
eq('★ 到了 9:00 → 该跑「每日早报」', S.dueList(flows, seed(T(2026, 10, 7, 8, 50)), T(2026, 10, 7, 9, 0)).map((x) => x.flowName), ['每日早报']);
eq('★ 跑完记下时间 → 明天才再跑',
  S.dueList(flows, { 'w1/t1': T(2026, 10, 7, 9, 0), 'w2/t2': T(2026, 10, 7, 8, 50) }, T(2026, 10, 7, 9, 1)).length, 0);
eq('  半小时那个：跑过 40 分钟 → 该跑了',
  S.dueList(flows, seed(T(2026, 10, 7, 8, 0)), T(2026, 10, 7, 8, 40)).map((x) => x.flowName), ['每半小时']);
eq('  跑完记下 → 又不该跑了',
  S.dueList(flows, seed(T(2026, 10, 7, 8, 40)), T(2026, 10, 7, 8, 41)).length, 0);
ck('★ 时间写错的那个：due=false，而且带一句能看懂的错',
  S.scan([{ id: 'w9', name: 'x', nodes: [{ id: 't9', type: 'trigger.timer', cfg: { mode: 'daily', at: '乱写' } }] }], {}, T(2026, 10, 7, 8, 0))[0].bad.length > 0);
ck('空 / null 不炸', S.scan(null, null, T(2026, 10, 7, 8, 0)).length === 0 && S.scan([], {}, Date.now()).length === 0);
ck('节点里没有 cfg 也不炸', S.scan([{ id: 'w', nodes: [{ id: 't', type: 'trigger.timer' }] }], {}, T(2026, 10, 7, 8, 0)).length === 1);

console.log('\n── ⑤ 人话描述 ──');
eq('每 60 分钟 → 每 1 小时', S.describe({ every: '60' }), '每 1 小时');
eq('每 30 分钟', S.describe({ every: '30' }), '每 30 分钟');
eq('每 1440 分钟 → 每天', S.describe({ every: '1440' }), '每 1 天');
eq('每天 09:00', S.describe({ mode: 'daily', at: '09:00' }), '每天 09:00');
eq('每天 9:5 → 补零', S.describe({ mode: 'daily', at: '9:5' }), '每天 09:05');
eq('时间写错时说得清', S.describe({ mode: 'daily', at: 'x' }), '每天（时间没填对）');

console.log('\n── ⑥ 「还有多久」 ──');
eq('50 分钟后', S.untilText(50 * MIN), '50 分钟后');
eq('2 小时', S.untilText(2 * 60 * MIN), '2 小时 0 分后');
eq('3 天', S.untilText(3 * DAY + 5 * 60 * MIN), '3 天 5 小时后');
eq('已经过了 → 马上', S.untilText(-1), '马上');
eq('NaN → 破折号', S.untilText(NaN), '—');

console.log('\n工作流排期：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败 ✗' : ' ✓'));
if (fails.length) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
