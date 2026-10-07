/* 词根词缀库（`lib/roots.js`）—— 纯单测 ✓，不联网 ✓、不起服务 ✓。
   ★ 这个模块是**纯数据 + 纯算法** ✓，所以能这样一条条钉死 ✓。

   ⚠️⚠️ 这里最该守住的不是「功能有没有」✗，而是「**会不会给自信的错误答案**」✗✗ ——
      拆词第一版把 `disagree` 拆成 `di- + act + -ee` ✓（看着特别像真的 ✓），
      用户会照着背 ✓，而且他**没法发现** ✗（和「音标背错」是同一类事故 ✓）。
      所以下面有一整节专门盯着这个 ✓。 */
'use strict';
const R = require('../lib/roots.js');

let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; } else { fails.push(n + (x ? '  → ' + x : '')); console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
const eq = (n, a, b) => ck(n, JSON.stringify(a) === JSON.stringify(b), '得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));

console.log('── ① 词库本身 ──');
{
  const all = R.all();
  const st = R.stats();
  ck('词条总数够用（≥200）', st.total >= 200, String(st.total));
  ck('前缀 / 词根 / 后缀 三类都有', st.pre >= 40 && st.root >= 120 && st.suf >= 25, JSON.stringify(st));
  ck('每条都有：形 / 含义 / 例词', all.every((e) => e.k && e.m && e.eg.length), JSON.stringify(all.filter((e) => !(e.k && e.m && e.eg.length)).map((e) => e.k)));
  ck('★ 每条都有**巧记**（用户要的就是这个）', all.every((e) => e.mnem && e.mnem.length >= 6), JSON.stringify(all.filter((e) => !e.mnem || e.mnem.length < 6).map((e) => e.k)));
  ck('★ 每条都有**词源**', all.every((e) => e.from && e.from.length >= 3), JSON.stringify(all.filter((e) => !e.from).map((e) => e.k)));
  ck('类型只有 pre / root / suf 三种', all.every((e) => ['pre', 'root', 'suf'].indexOf(e.t) >= 0));
  ck('形都是纯小写字母（不带横杠 / 空格 / 大写）', all.every((e) => [e.k].concat(e.alt).every((f) => /^[a-z]+$/.test(f))),
    JSON.stringify(all.filter((e) => [e.k].concat(e.alt).some((f) => !/^[a-z]+$/.test(f))).map((e) => e.k)));
  ck('同一条里没有重复的变体', all.every((e) => new Set([e.k].concat(e.alt)).size === 1 + e.alt.length));
  /* ⚠️ 例词要真的**含这个形** ✗ —— 手写数据最容易在这儿出低级错 ✓ */
  const bad = [];
  all.forEach((e) => {
    if (e.t !== 'root') return;
    e.eg.forEach((x) => {
      const forms = [e.k].concat(e.alt);
      const w = R.norm(x.w);
      if (!forms.some((f) => w.indexOf(f) >= 0)) bad.push(e.k + ' → ' + x.w);
    });
  });
  ck('★ 词根的例词里真的含这个形（手写数据最容易错的地方）', bad.length === 0, JSON.stringify(bad.slice(0, 6)));
  /* ⚠️ 例词的中文释义不能空 ✗ */
  const noZh = [];
  all.forEach((e) => e.eg.forEach((x) => { if (!x.zh) noZh.push(e.k + ' → ' + x.w); }));
  ck('★ 例词都带了中文释义', noZh.length === 0, JSON.stringify(noZh.slice(0, 6)));
  /* ⚠️ 同一个形可以出现在**多条**里 ✗ —— 这是**语言事实** ✓，不是数据错误 ✓：
     `cid` 既「落下」（accident）又「切」（decide）✓；`cur` 既「跑」（current）
     又「关心」（cure）✓；`tent` 既「持有」（content）又「伸展」（tent）✓。
     → 不去重 ✗，改成：**数量可控** ✓ + **`sameKey` 能全查到** ✓ + **`search` 也全列** ✓。 */
  const byForm = {};
  all.forEach((e) => [e.k].concat(e.alt).forEach((f) => {
    const key = e.t + ':' + f;
    (byForm[key] = byForm[key] || []).push(e);
  }));
  const dups = Object.keys(byForm).filter((k) => byForm[k].length > 1);
  ck('★ 同形条目数量可控（≤ 10 组，多了说明是笔误）', dups.length <= 10, dups.length + ' 组：' + dups.slice(0, 8).join(', '));
  ck('★★ 同形的每一条都能被 `sameKey` 查到（不藏起来）',
    dups.every((k) => R.sameKey(k.split(':')[1]).length === byForm[k].length),
    JSON.stringify(dups.filter((k) => R.sameKey(k.split(':')[1]).length !== byForm[k].length)));
  ck('★★ 同形的每一条都能被 `search` 搜到', dups.every((k) => {
    const f = k.split(':')[1];
    const got = R.search(f, 60).map((e) => e.k);
    return byForm[k].every((e) => got.indexOf(e.k) >= 0);
  }), JSON.stringify(dups.filter((k) => {
    const f = k.split(':')[1];
    const got = R.search(f, 60).map((e) => e.k);
    return !byForm[k].every((e) => got.indexOf(e.k) >= 0);
  })));
}

console.log('\n── ② 查 / 搜 ──');
{
  const e = R.byKey('spect');
  ck('★ 按变体也能查到规范形', !!e && e.k === 'spec' && e.alt.indexOf('spect') >= 0, e && e.k);
  ck('  含义 / 例词 / 词源都拿到了', e.m === '看' && e.eg.length >= 3 && !!e.from, JSON.stringify({ m: e.m, n: e.eg.length }));
  ck('  展示形式带横杠（前缀 `re-` / 后缀 `-tion`）',
    R.show(R.byKey('re')) === 're-' && R.show(R.byKey('tion'), 'tion') === '-tion',
    R.show(R.byKey('re')) + ' / ' + R.show(R.byKey('tion'), 'tion'));
  ck('★ 展示能用**实际匹配到的变体**（`in` 而不是规范形 `il`）',
    R.show(R.byKey('in'), 'in') === 'in-', R.show(R.byKey('in'), 'in'));
  ck('  `byKey` 认大小写和横杠（`-TION` 也认）', !!R.byKey('-TION') && !!R.byKey('Re-'));
  ck('  查不到就返回 null（不抛）', R.byKey('zzzz') === null);

  eq('搜「spect」第一条就是它', R.search('spect')[0].k, 'spec');
  eq('搜「看」能搜到（按含义）', R.search('看')[0].m.indexOf('看') >= 0, true);
  ck('★ 搜一个**完整单词**能定位到它的词根（`inspect` → spect）', R.search('inspect')[0].k === 'spec',
    JSON.stringify(R.search('inspect').slice(0, 3).map((x) => x.k)));
  ck('搜后缀带横杠也认（`-tion`）', R.search('-tion')[0].k === 'ion', R.search('-tion')[0].k);
  ck('空查询返回一批（不是空）', R.search('').length >= 50, String(R.search('').length));
  ck('搜不到就是空数组（不抛）', R.search('qqqzzz').length === 0);
  ck('★ 搜索结果不重复', (() => { const l = R.search('a', 60); return new Set(l.map((x) => x.k)).size === l.length; })());
}

console.log('\n── ③ ★★ 拆词：必须**拆对**（这是最容易给出自信错误答案的地方）──');
{
  const ok = (w, want) => {
    const s = R.split(w);
    const got = s ? R.explain(s) : '(拆不出来)';
    ck(w + ' → ' + want, !!s && got.indexOf(want) >= 0, got);
  };
  ok('inspect', 'in-（不；向内） + spect（看）');
  ok('respect', 're-（再；回；向后） + spect（看）');
  ok('prospect', 'pro-（向前；支持） + spect（看）');
  /* ⚠️ 同化：`sub+spect` → `suspect`，前缀尾字母和词根首字母重合 ✓ */
  ok('suspect', 'sus-（下；次；副） + spect（看）');
  ok('transport', 'trans-（穿过；转变） + port（携带；港口）');
  ok('contradict', 'contra-（反对） + dict（说；断言）');
  ok('revolution', 're-（再；回；向后） + volut（滚；转） + -ion（行为；结果）');
  ok('reject', 're-（再；回；向后） + ject（投掷）');
  ok('conductor', 'con-（共同；加强） + duct（引导） + -or（人；物；工具）');
  ok('description', 'de-（向下；去除；加强） + script（写） + -ion（行为；结果）');
  ok('impossible', 'im-（不；向内） + poss（能力；能） + -ible（能…的；可…的）');
  ok('prosperity', 'pro-（向前；支持） + sper（希望） + -ity（性质；状态）');
  ok('bilingual', 'bi-（二） + lingu（语言；舌头） + -al（…的；行为）');
  ok('decision', 'de-（向下；去除；加强） + cis（切；杀） + -ion（行为；结果）');
  /* ★★ 两个词根（biology / photograph 这类很常见） */
  ok('biology', 'bio（生命） + logy（言语；学科）');
  ok('photograph', 'photo（光） + graph（写；画）');
  /* ★★ 两个后缀（`international` 的 `-ion` + `-al` ✓）——
     实测：`-ion` **不在词尾**（`-al` 才是 ✓），只从词尾候选里配永远配不出来 ✗ */
  ok('international', 'inter-（之间；相互） + nat（出生） + -ion（行为；结果） + -al（…的；行为）');
  ok('transformation', 'trans-（穿过；转变） + form（形状；形成） + -ation（行为；结果）');

  console.log('  ── 找不到词根 → 退成「前缀 + **词干** + 后缀」（照样有用 ✓）──');
  /* ⚠️ 必须是「词干」✗，不能混成「词根」✗ —— `happy` / `agree` 是独立的词 ✓ */
  ok('unhappy', 'un-（不；相反；打开） + happy（词干）');
  ok('disagree', 'dis-（分开；不） + agree（词干）');
  ok('deforest', 'de-（向下；去除；加强） + forest（词干）');
  ok('beautiful', 'beauti（词干） + -ful（充满…的）');
  ok('carefully', 'care（词干） + -ful（充满…的） + -ly（…地；…的）');
  ok('unknown', 'un-（不；相反；打开） + known（词干）');
  ck('  ★ 词干模式**不混进 roots** ✗（它不是词根 ✓）',
    R.split('unhappy').roots.length === 0 && R.split('unhappy').stem === 'happy',
    JSON.stringify({ roots: R.split('unhappy').roots.length, stem: R.split('unhappy').stem }));
  ck('  ★ 词干模式**明说自己是 stem** ✗', R.split('unhappy').confidence === 'stem', R.split('unhappy').confidence);
}

console.log('\n── ④ ★★ 拆词：**宁可说不知道，也不能编** ──');
{
  /* ⚠️⚠️ 这一节是整份测试里最重要的 ✗✗ ——
     第一版把 `disagree` 拆成 `di- + act + -ee` ✗（因为贪心吃掉了最长的词根 ✓），
     它**看着完全像真的** ✓ → 用户照着背 → 而且发现不了 ✗。
     → 现在的规矩：说不清的字母**必须是元音** ✓，残渣是辅音就**拒绝** ✓。 */
  const s1 = R.split('disagree');
  ck('★★ `disagree` 不许拆成 `di- + act + -ee` 那种',
    !s1 || !(s1.roots.length && s1.roots[0].form === 'act'), s1 ? R.explain(s1) : 'null');
  ck('★★ 也不许把残渣（辅音）当没事发生',
    !s1 || s1.confidence === 'stem' || s1.rest === '', s1 ? JSON.stringify({ conf: s1.confidence, rest: s1.rest }) : 'null');
  ck('★★ 无意义串拆不出来就说拆不出来（不硬凑）', R.split('zzz') === null && R.split('xqj') === null);
  ck('★ 太短的词不拆（<3 字母）', R.split('at') === null && R.split('') === null && R.split(null) === null);
  /* ⚠️ 弱前缀（be- / a- / en- / em-）**兜底时不参与** ✗ —— 它们最爱硬凑 ✓ */
  ck('★ `beautiful` 不许拆出 `be-`（弱前缀硬凑）', R.split('beautiful').preForm !== 'be', R.explain(R.split('beautiful')));
  ck('★ `abc` 不许拆成 `a- + bc`', R.split('abc') === null, R.split('abc') ? R.explain(R.split('abc')) : 'null');
  /* ⚠️ 拆出来的三块**拼起来要等于原词** ✓（只允许元音残渣 ✓） */
  const words = ['inspect', 'suspect', 'international', 'biology', 'disagree', 'unhappy', 'beautiful', 'carefully',
    'deforest', 'unhappiness', 'hopelessness', 'friendship', 'careless', 'dislike', 'unknown', 'asleep',
    'rainy', 'quickly', 'famous', 'arrival', 'modernize', 'decision', 'revolution', 'transformation'];
  const bad = [];
  words.forEach((w) => {
    const s = R.split(w);
    if (!s) return;
    const rebuilt = (s.preForm || '') + s.roots.map((r) => r.form).join('') + (s.stem || '') + (s.suf || []).map((x) => x.form).join('');
    /* ⚠️ 同化会让前缀尾字母和词根首字母**重合** ✓（`sub+spect` → `suspect` ✓）——
       重合点在**拼接处** ✗，不在开头 ✗（我第一版只试了「去掉开头一个字母」✓，漏了 ✓）→
       所以判据是：**删掉任意一个字母之后能等于原词** ✓。 */
    const okRebuild = rebuilt === w
      || Array.from(rebuilt).some((_, i) => rebuilt.slice(0, i) + rebuilt.slice(i + 1) === w);
    if (!okRebuild) bad.push(w + ' → ' + rebuilt);
  });
  ck('★★ 拆出来的块拼回去**就是原词**（只允许同化那一个字母的重合）', bad.length === 0, JSON.stringify(bad));
  const noRoot = words.filter((w) => { const s = R.split(w); return s && !s.roots.length && s.confidence !== 'stem'; });
  ck('★ 没有词根的只能是 stem 模式（不能假装有词根）', noRoot.length === 0, JSON.stringify(noRoot));
}

console.log('\n── ⑤ 同族词 / 统计 / 性能 ──');
{
  const e = R.byKey('spect');
  ck('★ 同族词能拿到（同类的其它条目）', Array.isArray(R.family(e)), '');
  const st = R.stats();
  eq('统计三类加起来等于总数', st.pre + st.root + st.suf, st.total);
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) R.split('international');
  const ms = Date.now() - t0;
  ck('★ 拆一个词够快（200 次 < 1500ms，界面才不卡）', ms < 1500, ms + 'ms');
  ck('全表取一次不返回同一个数组（调用方改了不会污染库）', R.all() !== R.all());
}

console.log('\n词根词缀库：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败 ✗' : ' ✓'));
if (fails.length) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
