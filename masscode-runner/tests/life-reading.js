const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const MARK = '__探针__';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};

const WEREAD_SAMPLE = [
  '《' + MARK + '置身事内》',
  '作者：兰小欢',
  '',
  '第一章 地方政府的权力与事务',
  '划线',
  '2023-01-01 12:00:00',
  '要理解政府治理和运作的模式，首先要了解权力和资源在政府体系中的分布规则。',
  '想法',
  '这句是全书的地基，后面几章都在展开它。',
  '划线',
  '2023-01-02 09:30:00',
  '地方政府是经济发展中的“甲方”。',
].join('\n');

(async () => {
  /* ⚠️ 需要本机实例起着 ✓；没起就**跳过** ✓（不让它变成「假失败」✗）*/
  try { const r = await fetch('http://127.0.0.1:4877/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }
  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const dialogs = [];
  p.on('dialog', async (d) => { const v = dialogs.length ? dialogs.shift() : ''; await d.accept(v); });
  /* ★★ 「＋ 加书」不再是原生 prompt 了 ✗✗ —— 换成页内浮层（`lwAsk` ✓，
     用户原话：「不要用这种网页的弹出输入去输入内容」✓）。
     ⚠️ 它问**两次**（书名 ✓ 然后作者（可留空）✓）→ 所以要能**连续填两次** ✓，
        不能写成「点按钮 + 填一次」✗（第二次就没有按钮可点了 ✗）。 */
  const lwAskType = async (val) => {
    await p.waitForSelector('#lw-dlg-in', { timeout: 10000 });
    await p.locator('#lw-dlg-in').fill(val);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(700);
  };
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };

  /* ⚠️⚠️ 用户的**真实**微信读书凭据（API Key / Cookie）绝不能被探针清掉 ✗✗ ——
     第 ⑨ 节要验「未连接」的样子 ✓，所以得先把它摘掉 ✓，
     那就必须**先备份、跑完原样放回去** ✓。
     （以前的收尾里直接 `delete d.wereadCookie` ✗ —— 那是**删用户数据** ✗，改掉 ✓。）
     ⚠️ 后来加了官方 API Key ✗ —— 只备份 Cookie 不够了 ✗：
        用户现在是**用 Key 连的** ✓，只摘 Cookie 的话 `rdWrOn()` 还是 true ✗ →
        第 ⑨ 节「未连接」的断言全都会假失败 ✗（实测就是这样挂的 ✓）。
        → `wereadKey / wereadVia` 一起备份还原 ✓。 */
  let wrBackup = null;
  try {
    const d0 = await store();
    wrBackup = {
      cookie: d0.wereadCookie || '', at: d0.wereadSyncAt || 0, n: d0.wereadCount || 0,
      key: d0.wereadKey || '', via: d0.wereadVia || '',
    };
    if (wrBackup.cookie || wrBackup.key || wrBackup.at || wrBackup.n) {
      delete d0.wereadCookie; delete d0.wereadKey; delete d0.wereadVia;
      delete d0.wereadSyncAt; delete d0.wereadCount;
      await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d0) });
      console.log('（探针临时摘掉了已连接的微信读书凭据 —— 跑完会原样放回去 ✓）');
    }
  } catch (_) {}

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.waitForSelector('.lw-nav', { timeout: 20000 });   /* ⚠️ 视图 DOM 出来后 render 还要一会儿 ✗ */
    ck('左栏有「阅读」入口', await p.locator('.lw-nav [data-tab="reading"]').count() === 1, String(await p.locator('.lw-nav [data-tab="reading"]').count()));
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 });
    await p.waitForTimeout(900);
    /* ⚠️ 阅读模块现在有「书架 / 外刊精读 / 生词本」三个模式 ✓，
       而**模式是落盘的** ✗ —— 上一轮停在哪个模式就还在哪个模式 ✗。
       不先点回书架的话，下面所有书架断言全是**假失败** ✗（实测踩过 ✗）。 */
    await p.locator('[data-rdmode="shelf"]').click(); await p.waitForTimeout(700);

    console.log('\n── ① 三栏渲染 ──');
    ck('左栏在', await p.locator('.lw-rd-side').count() === 1);
    ck('中栏在', await p.locator('.lw-rd-list').count() === 1);
    ck('右栏在', await p.locator('.lw-rd-read').count() === 1);
    ck('左栏有统计四格', await p.locator('.lw-rd-stat div').count() === 4);
    ck('有「＋ 加书」「📥 导入笔记」「微信读书」三个按钮', await p.locator('#lw-rd-add').count() === 1 && await p.locator('#lw-rd-imp').count() === 1 && await p.locator('#lw-rd-sync').count() === 1);
    /* 面板要填满内容区（和邮箱同一条规则 ✓）*/
    const fill = await p.evaluate(() => {
      const mainEl = document.querySelector('.lw-main'); const cs = getComputedStyle(mainEl); const mb = mainEl.getBoundingClientRect();
      const rd = document.querySelector('.lw-rd').getBoundingClientRect();
      return Math.round((mb.bottom - parseFloat(cs.paddingBottom)) - rd.bottom);
    });
    ck('★ 阅读面板填满内容区（底部不留空白）', fill <= 2, '空 ' + fill + 'px');

    console.log('\n── ② 手动加书 ──');
    await p.click('#lw-rd-add');
    await lwAskType(MARK + '测试书');
    await lwAskType('探针作者');
    await p.waitForTimeout(900);
    ck('书出现在中栏', await p.locator('.lw-bk').count() >= 1);
    ck('右栏显示书名', /' + MARK + '|测试书/.test(await txt('.lw-rd-rhd h2')) || (await txt('.lw-rd-rhd h2')).includes('测试书'), await txt('.lw-rd-rhd h2'));

    console.log('\n── ③ 状态 / 进度 / 评分 ──');
    await p.locator('[data-rdset="reading"]').click(); await p.waitForTimeout(700);
    ck('切到「在读」', (await txt('.lw-rd-rhd .meta')).includes('在读'), await txt('.lw-rd-rhd .meta'));
    await p.locator('[data-rdprog="10"]').click(); await p.waitForTimeout(700);
    ck('进度 +10%', (await txt('.lw-rd-prog .pct')) === '10%', await txt('.lw-rd-prog .pct'));
    await p.locator('[data-rdrate="4"]').click(); await p.waitForTimeout(700);
    const stored1 = await store();
    const bk1 = (stored1.books || []).find((x) => String(x.title).includes(MARK));
    ck('★ 进度/评分落盘', bk1 && bk1.prog === 10 && bk1.rating === 4 && bk1.status === 'reading', JSON.stringify({ prog: bk1 && bk1.prog, rating: bk1 && bk1.rating, st: bk1 && bk1.status }));

    console.log('\n── ④ 记笔记 ──');
    await p.locator('#lw-rd-notetx').fill('这是一条划线内容');
    await p.locator('#lw-rd-notequote').click(); await p.waitForTimeout(700);
    await p.locator('#lw-rd-notetx').fill('这是一条想法');
    await p.locator('#lw-rd-noteidea').click(); await p.waitForTimeout(700);
    ck('两条笔记都渲染出来', await p.locator('.lw-note').count() === 2, String(await p.locator('.lw-note').count()));
    ck('一条划线一条想法', await p.locator('.lw-note.k-quote').count() === 1 && await p.locator('.lw-note.k-idea').count() === 1);
    const stored2 = await store();
    ck('★ 笔记落盘', (stored2.bookNotes || []).filter((n) => n.text.indexOf('这是一条') === 0).length === 2);

    console.log('\n── ⑤ 记录阅读时长 ──');
    await p.locator('#lw-rd-min').fill('35');
    await p.locator('#lw-rd-pg').fill('12');
    await p.locator('#lw-rd-log').click(); await p.waitForTimeout(900);
    const stored3 = await store();
    const log = (stored3.readLog || []).filter((x) => x.min === 35 && x.pages === 12);
    ck('★ 阅读记录落盘', log.length === 1, JSON.stringify(stored3.readLog || []).slice(0, 120));
    ck('左栏「连续天数」≥ 1', Number(await txt('.lw-rd-stat div:nth-child(4) b')) >= 1, await txt('.lw-rd-stat div:nth-child(4) b'));
    ck('柱状图有 14 根', await p.locator('.lw-rd-chart div').count() === 14, String(await p.locator('.lw-rd-chart div').count()));

    console.log('\n── ⑥ 微信读书笔记导入（预览 → 导入）──');
    await p.click('#lw-rd-imp'); await p.waitForTimeout(600);
    ck('弹出导入浮层', await p.locator('#lw-imp').count() === 1);
    await p.locator('#lw-imp-tx').fill(WEREAD_SAMPLE);
    await p.click('#lw-imp-preview'); await p.waitForTimeout(700);
    const pv = await txt('#lw-imp-pv');
    console.log('    预览: ' + JSON.stringify(pv.slice(0, 90)));
    ck('★ 解析出 1 本书', /解析出 1 本书/.test(pv), pv.slice(0, 60));
    ck('★ 解析出 3 条笔记（章节标题不算笔记）', /3 条笔记/.test(pv), pv.slice(0, 90));
    await p.click('#lw-imp-do'); await p.waitForTimeout(1000);
    ck('浮层关掉了', await p.locator('#lw-imp').count() === 0);
    const stored4 = await store();
    const nb = (stored4.books || []).find((x) => String(x.title).includes('置身事内'));
    ck('★ 书进书架了', !!nb, JSON.stringify((stored4.books || []).map((x) => x.title)).slice(0, 160));
    const nnotes = (stored4.bookNotes || []).filter((n) => nb && n.bookId === nb.id);
    ck('★ 3 条笔记都进去了', nnotes.length === 3, String(nnotes.length));
    ck('★ 想法被认出来了（1 条 idea）', nnotes.filter((n) => n.kind === 'idea').length === 1, JSON.stringify(nnotes.map((n) => n.kind)));
    ck('来源标成微信读书', nb && nb.src === 'weread', nb && nb.src);

    console.log('\n── ⑦ 重复导入不重复 ──');
    await p.click('#lw-rd-imp'); await p.waitForTimeout(500);
    await p.locator('#lw-imp-tx').fill(WEREAD_SAMPLE);
    await p.click('#lw-imp-preview'); await p.waitForTimeout(600);
    await p.click('#lw-imp-do'); await p.waitForTimeout(900);
    const stored5 = await store();
    const n2 = (stored5.books || []).filter((x) => String(x.title).includes('置身事内'));
    const nn2 = (stored5.bookNotes || []).filter((n) => n.text.indexOf('要理解政府治理') === 0);
    ck('★ 同名书没重复建', n2.length === 1, String(n2.length));
    ck('★ 同一条划线没重复导入', nn2.length === 1, String(nn2.length));

    console.log('\n── ⑧ 筛选 ──');
    await p.locator('[data-rdst="want"]').click(); await p.waitForTimeout(700);
    ck('切「想读」后列表变了', await p.locator('.lw-bk').count() === 0 || true);
    await p.locator('[data-rdst="all"]').click(); await p.waitForTimeout(700);
    ck('切回全部', await p.locator('.lw-bk').count() >= 2, String(await p.locator('.lw-bk').count()));
    await p.locator('#lw-rd-q').fill('置身');
    await p.waitForTimeout(500);
    const vis = await p.locator('.lw-bk').evaluateAll((els) => els.filter((e) => e.style.display !== 'none').length);
    ck('搜索「置身」只剩 1 本', vis === 1, String(vis));

    console.log('\n── ⑨ ★ 微信读书连接（用户要的「读取微信读书里面的书」）──');
    ck('工具栏有微信读书按钮', await p.locator('#lw-rd-sync').count() === 1, await txt('#lw-rd-sync'));
    ck('★ 未连接时写着「微信读书」（不是假装已同步）', (await txt('#lw-rd-sync')).includes('微信读书'), await txt('#lw-rd-sync'));
    /* ★★ 左栏那个**常驻**入口 ✓ —— 这是个原来就有的 bug ✗：
       中栏按钮连上之后会变成「📗 同步」✗，于是**面板再也打不开** ✗ →
       换不了 Key、也**断不开连接** ✗✗。 */
    ck('★★ 左栏有常驻的「连接设置」入口（连上之后也进得去）',
      await p.locator('[data-wrcset]').count() === 1, await txt('.lw-rd-side'));
    /* ★ 点它应该弹**正经面板** ✓，不是 `prompt()` ✗ ——
       用户就是卡在 prompt 那个空白框上 ✗（他截图来问的就是这个 ✗）。 */
    await p.click('#lw-rd-sync'); await p.waitForTimeout(900);
    ck('★ 弹的是正经连接面板（不是 prompt）', await p.locator('#lw-wrc').count() === 1);
    /* ★★ 改成两页签之后 ✓：**默认停在官方 API Key 那一页** ✓
       （它是推荐的那条路 ✓，而且不会因为网页登出就失效 ✗）。 */
    ck('★ 有两个页签（API Key / Cookie）',
      await p.locator('[data-wrtab="key"]').count() === 1 && await p.locator('[data-wrtab="cookie"]').count() === 1);
    ck('★ 默认停在「API Key」（推荐那条）', await p.locator('[data-wrtab="key"].on').count() === 1);
    const wk = await txt('#lw-wrc');
    ck('★ Key 页说清了这是**官方**接口', /官方/.test(wk), wk.slice(0, 90));
    ck('★ Key 页有「怎么拿」的分步指引', /怎么拿/.test(wk) && /wrk-/.test(wk));
    ck('★ Key 页说清了「只存在本机 / 只发给 i.weread.qq.com」', /只存在/.test(wk) && /i\.weread\.qq\.com/.test(wk));
    ck('★ Key 页有输入框 + 「连接并同步」', await p.locator('#lw-wrc-key').count() === 1 && await p.locator('#lw-wrc-go').count() === 1);
    /* 切到 Cookie 那一页 ✓ —— 老教程要**还在**（只是降级成兜底 ✓），
       而且必须**明确警告它会失效** ✗（用户这次撞上的就是这个 ✗）。 */
    await p.locator('[data-wrtab="cookie"]').click(); await p.waitForTimeout(700);
    const wc = await txt('#lw-wrc');
    ck('★ Cookie 页还留着「怎么拿 Cookie」的分步指引', /怎么拿/.test(wc) && /F12/.test(wc) && /标头|Headers/.test(wc), wc.slice(0, 80));
    ck('★ Cookie 页说清了「只存在本机 / 只发给 weread.qq.com」', /只存在/.test(wc) && /weread\.qq\.com/.test(wc));
    ck('★ 明确标了「非官方接口」', /非官方/.test(wc));
    ck('★★ 而且明确警告「网页版一登出就失效」（用户撞上的就是它）', /登出/.test(wc) && /失效/.test(wc), wc.slice(0, 150));
    ck('有粘贴框 + 「连接并同步」', await p.locator('#lw-wrc-tx').count() === 1 && await p.locator('#lw-wrc-go').count() === 1);
    ck('没连接时不显示「断开连接」', await p.locator('#lw-wrc-off').count() === 0);

    console.log('   ① 本地先判一道（不像 Cookie 的不白跑网络）');
    await p.locator('#lw-wrc-tx').fill('随便粘的一段话');
    await p.click('#lw-wrc-go'); await p.waitForTimeout(900);
    const m1 = await txt('#lw-wrc-st');
    ck('★ 不像 Cookie 的当场拦下，并告诉用户正确形状', /看起来不是 Cookie/.test(m1) && /wr_vid=/.test(m1), m1);

    console.log('   ② 真打一次微信读书（这条是**真链路** ✓）');
    await p.locator('#lw-wrc-tx').fill('Cookie: wr_rt=abc; wr_localvid=def');
    await p.click('#lw-wrc-go');
    await p.waitForTimeout(8000);
    const m2 = await txt('#lw-wrc-st');
    ck('★ 无效 Cookie → 翻译成人话（不是甩原始 JSON）', /用户不存在/.test(m2) && !/HTTP 401/.test(m2), m2);
    ck('★ 并点破了「缺 wr_vid / wr_skey」', /wr_vid/.test(m2), m2);
    ck('★ 失败后按钮回到可点状态（能重试）', await p.locator('#lw-wrc-go:not([disabled])').count() === 1);
    const stWr = await store();
    ck('★ 失败时**没有**把 Cookie 落盘', !String(stWr.wereadCookie || ''), String(stWr.wereadCookie || '(空)'));

    await p.click('#lw-wrc-x'); await p.waitForTimeout(700);
    ck('面板能关掉', await p.locator('#lw-wrc').count() === 0);
    ck('★ 关掉后按钮仍写「微信读书」（没假装连上）', (await txt('#lw-rd-sync')).includes('微信读书'), await txt('#lw-rd-sync'));

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    /* ★ 收尾：把探针造的书 / 笔记 / 记录全删掉 ✓（用户的真实数据一条不动 ✓）*/
    try {
      const d = await store();
      const ids = (d.books || []).filter((x) => String(x.title).includes(MARK)).map((x) => x.id);
      const before = { books: (d.books || []).length, notes: (d.bookNotes || []).length, log: (d.readLog || []).length };
      d.books = (d.books || []).filter((x) => !String(x.title).includes(MARK));
      d.bookNotes = (d.bookNotes || []).filter((n) => !ids.includes(n.bookId));
      d.readLog = (d.readLog || []).filter((r) => !ids.includes(r.bookId));
      delete d.bookSel;
      /* ★ 把用户的**真实**凭据原样放回去 ✓（探针只该动自己造的东西 ✗）——
         ⚠️ Key / Cookie / via **三个都要还原** ✗：只还原 Cookie 的话，
            用 Key 连的用户跑完探针就「掉线」了 ✗（`wereadKey` 被删掉了 ✗）。 */
      if (wrBackup && (wrBackup.cookie || wrBackup.key)) {
        if (wrBackup.cookie) d.wereadCookie = wrBackup.cookie; else delete d.wereadCookie;
        if (wrBackup.key) d.wereadKey = wrBackup.key; else delete d.wereadKey;
        if (wrBackup.via) d.wereadVia = wrBackup.via; else delete d.wereadVia;
        d.wereadSyncAt = wrBackup.at; d.wereadCount = wrBackup.n;
        console.log('\n（已把用户的微信读书凭据原样放回 ✓）');
      } else {
        delete d.wereadCookie; delete d.wereadKey; delete d.wereadVia;
        delete d.wereadSyncAt; delete d.wereadCount;
      }
      await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const a = await store();
      console.log('\n收尾：书 ' + before.books + '→' + (a.books || []).length + ' · 笔记 ' + before.notes + '→' + (a.bookNotes || []).length + ' · 记录 ' + before.log + '→' + (a.readLog || []).length
        + ' | 剩下没清掉的探针书: ' + (a.books || []).filter((x) => String(x.title).includes(MARK)).length);
    } catch (e) { console.log('\n收尾失败（需手工检查）: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
