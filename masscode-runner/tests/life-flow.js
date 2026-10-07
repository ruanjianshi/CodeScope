const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const MARK = '__探针流__';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};

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
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  /* ⚠️ 「✨ 示例」建出来的工作流**名字里没有 MARK** ✗（那是给用户看的名字 ✓），
     所以收尾那条「按名字过滤」抓不到它 ✗ → 这里记下它的 id ✓，收尾按 id 删 ✓。 */
  const madeIds = [];

  /* ⚠️ 先把上次跑崩残留的同名工作流清掉 ✗ ——
     不清的话 `find(name.includes(MARK))` 会拿到**旧的那个**（0 个节点 ✗）→ 断言假失败 ✗
     （实测踩过：上一轮服务被重启打断、收尾没跑成 ✗）。 */
  try {
    const d0 = await store();
    d0.flows = (d0.flows || []).filter((x) => !String(x.name).includes(MARK));
    await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d0) });
  } catch (_) {}

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.waitForSelector('.lw-nav', { timeout: 20000 });
    ck('左栏有「工作流」入口', await p.locator('.lw-nav [data-tab="flow"]').count() === 1);
    await p.locator('.lw-nav [data-tab="flow"]').dispatchEvent('click');
    await p.waitForSelector('.lw-fl', { timeout: 20000 });
    await p.waitForTimeout(800);

    console.log('\n── ① 三栏 ──');
    ck('左栏（工作流 + 节点库）', await p.locator('.lw-fl-side').count() === 1);
    ck('画布', await p.locator('.lw-fl-cv').count() === 1);
    ck('右栏（属性）', await p.locator('.lw-fl-cfg').count() === 1);
    ck('节点库有 14 种节点', await p.locator('[data-fladd]').count() === 14, String(await p.locator('[data-fladd]').count()));
    const fill = await p.evaluate(() => {
      const m = document.querySelector('.lw-main'), cs = getComputedStyle(m), mb = m.getBoundingClientRect();
      const fl = document.querySelector('.lw-fl').getBoundingClientRect();
      return Math.round((mb.bottom - parseFloat(cs.paddingBottom)) - fl.bottom);
    });
    ck('★ 工作流面板填满内容区', fill <= 2, '空 ' + fill + 'px');

    console.log('\n── ② 新建工作流 ──');
    dialogs.push(MARK + '演示');
    await p.click('#lw-fl-new'); await p.waitForTimeout(800);
    ck('出现在左栏', (await txt('.lw-fl-side')).includes(MARK), await txt('.lw-fl-side'));
    ck('画布空态提示在', await p.locator('.lw-fl-empty').count() === 1);

    console.log('\n── ③ 加节点 ──');
    await p.locator('[data-fladd="trigger.manual"]').click(); await p.waitForTimeout(700);
    await p.locator('[data-fladd="data.template"]').click(); await p.waitForTimeout(700);
    await p.locator('[data-fladd="out.notify"]').click(); await p.waitForTimeout(700);
    ck('画布上 3 个节点', await p.locator('.lw-fl-node').count() === 3, String(await p.locator('.lw-fl-node').count()));
    const st1 = await store();
    const wf1 = (st1.flows || []).filter((x) => String(x.name).includes(MARK)).pop();
    ck('★ 节点落盘', wf1 && wf1.nodes.length === 3, JSON.stringify(wf1 && wf1.nodes.length));

    console.log('\n── ④ 改节点配置 ──');
    /* 选第二个节点（文本模板）→ 右栏出现配置 */
    await p.locator('.lw-fl-node').nth(1).click(); await p.waitForTimeout(700);
    ck('右栏出现「文本模板」', (await txt('.lw-fl-cfg')).includes('文本模板'), (await txt('.lw-fl-cfg')).slice(0, 40));
    await p.locator('[data-flcfg="text"]').fill('上游说：{{input}}');
    await p.waitForTimeout(600);
    const st2 = await store();
    const wf2 = (st2.flows || []).filter((x) => String(x.name).includes(MARK)).pop();
    const tp = wf2.nodes.find((n) => n.type === 'data.template');
    ck('★ 配置落盘', tp && tp.cfg.text === '上游说：{{input}}', JSON.stringify(tp && tp.cfg));

    console.log('\n── ⑤ 连线 ──');
    const nodeIds = wf2.nodes.map((n) => n.id);
    await p.locator('[data-flout="' + nodeIds[0] + '"][data-flport="0"]').click(); await p.waitForTimeout(400);
    ck('端口进入待连状态', await p.locator('.lw-fl-port.armed').count() === 1);
    await p.locator('[data-flin="' + nodeIds[1] + '"]').click(); await p.waitForTimeout(700);
    await p.locator('[data-flout="' + nodeIds[1] + '"][data-flport="0"]').click(); await p.waitForTimeout(400);
    await p.locator('[data-flin="' + nodeIds[2] + '"]').click(); await p.waitForTimeout(700);
    const st3 = await store();
    const wf3 = (st3.flows || []).filter((x) => String(x.name).includes(MARK)).pop();
    ck('★ 两条连线落盘', wf3.edges.length === 2, JSON.stringify(wf3.edges));
    ck('画布上有 2 条线', await p.locator('.lw-fl-svg g[data-flowedge]').count() === 2, String(await p.locator('.lw-fl-svg g[data-flowedge]').count()));

    console.log('\n── ⑥ 运行 ──');
    await p.click('#lw-fl-run');
    await p.waitForFunction(() => document.querySelectorAll('.lw-fl-log div').length > 0, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const log = await txt('.lw-fl-log');
    console.log('    日志: ' + JSON.stringify(log.slice(0, 110)));
    ck('★ 三个节点都跑了', (log.match(/✓/g) || []).length >= 3, log.slice(0, 80));
    ck('状态栏有「跑完了」', /跑完了/.test(await txt('#lw-sub')), await txt('#lw-sub'));
    ck('画布节点带状态', await p.locator('.lw-fl-node.s-ok').count() >= 3, String(await p.locator('.lw-fl-node.s-ok').count()));

    console.log('\n── ⑦ 条件分支：没走的那条要跳过 ──');
    await p.locator('[data-fladd="logic.if"]').click(); await p.waitForTimeout(600);
    /* 先把条件设成**假** ✗ —— 默认是「包含 空」= 永远为真 ✗，那样永远没有分支被跳过 ✗ */
    await p.locator('.lw-fl-node').last().click(); await p.waitForTimeout(500);
    await p.locator('[data-flcfg="left"]').fill('abc');
    await p.locator('[data-flcfg="op"]').selectOption('等于');
    await p.locator('[data-flcfg="right"]').fill('xyz');
    await p.waitForTimeout(600);
    await p.locator('[data-fladd="out.notify"]').click(); await p.waitForTimeout(600);
    const st4 = await store();
    const wf4 = (st4.flows || []).filter((x) => String(x.name).includes(MARK)).pop();
    const ifN = wf4.nodes.find((n) => n.type === 'logic.if');
    const lastN = wf4.nodes[wf4.nodes.length - 1];
    await p.locator('[data-flout="' + ifN.id + '"][data-flport="0"]').click(); await p.waitForTimeout(300);
    await p.locator('[data-flin="' + lastN.id + '"]').click(); await p.waitForTimeout(600);
    await p.locator('[data-flout="' + wf4.nodes[1].id + '"][data-flport="0"]').click(); await p.waitForTimeout(300);
    await p.locator('[data-flin="' + ifN.id + '"]').click(); await p.waitForTimeout(700);
    await p.click('#lw-fl-run');
    await p.waitForFunction(() => document.querySelectorAll('.lw-fl-log div').length > 0, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const st7 = await store();
    const wf7 = (st7.flows || []).filter((x) => String(x.name).includes(MARK)).pop();
    console.log('    图: 节点 ' + JSON.stringify(wf7.nodes.map((n) => n.type)));
    console.log('    边: ' + JSON.stringify(wf7.edges));
    console.log('    if 的配置: ' + JSON.stringify((wf7.nodes.find((n) => n.type === 'logic.if') || {}).cfg));
    console.log('    日志: ' + JSON.stringify((await txt('.lw-fl-log')).slice(0, 200)));
    ck('★ 有节点被跳过（条件分支没走的那条）', await p.locator('.lw-fl-node.s-skipped').count() >= 1, String(await p.locator('.lw-fl-node.s-skipped').count()));

    console.log('\n── ⑧ 删节点 / 删连线 ──');
    const before = await p.locator('.lw-fl-node').count();
    await p.locator('.lw-fl-node').last().click(); await p.waitForTimeout(500);
    await p.click('#lw-fl-nodedel'); await p.waitForTimeout(700);
    ck('节点被删掉', await p.locator('.lw-fl-node').count() === before - 1, before + ' → ' + await p.locator('.lw-fl-node').count());
    const eBefore = await p.locator('.lw-fl-svg g[data-flowedge]').count();
    /* ⚠️ SVG 的 <g> 在 Playwright 眼里「不可见」✗（里面只有透明命中区 ✗）→ 用派发事件 ✓ */
    await p.locator('.lw-fl-svg g[data-flowedge]').first().dispatchEvent('click'); await p.waitForTimeout(700);
    ck('连线被删掉', await p.locator('.lw-fl-svg g[data-flowedge]').count() === eBefore - 1, eBefore + ' → ' + await p.locator('.lw-fl-svg g[data-flowedge]').count());

    console.log('\n── ⑨ 拖动节点 ──');
    const nb = await p.locator('.lw-fl-node').first().boundingBox();
    await p.mouse.move(nb.x + 60, nb.y + 12);
    await p.mouse.down();
    await p.mouse.move(nb.x + 60 + 80, nb.y + 12 + 50, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(800);
    const st5 = await store();
    const wf5 = (st5.flows || []).filter((x) => String(x.name).includes(MARK)).pop();
    ck('★ 拖动后坐标落盘了', wf5.nodes.some((n) => n.x > 60), JSON.stringify(wf5.nodes.map((n) => [n.x, n.y])));

    console.log('\n── ⑩ 输出节点真的落地（写备忘录）──');
    const memoBefore = ((await store()).memos || []).length;
    await p.locator('[data-fladd="trigger.manual"]').click(); await p.waitForTimeout(500);
    await p.locator('[data-fladd="out.memo"]').click(); await p.waitForTimeout(600);
    const st6 = await store();
    const wf6 = (st6.flows || []).filter((x) => String(x.name).includes(MARK)).pop();
    await p.locator('[data-flout="' + wf6.nodes[0].id + '"][data-flport="0"]').click(); await p.waitForTimeout(300);
    await p.locator('[data-flin="' + wf6.nodes[1].id + '"]').click(); await p.waitForTimeout(600);
    await p.locator('.lw-fl-node').last().click(); await p.waitForTimeout(800);
    console.log('    选中后右栏: ' + JSON.stringify((await txt('.lw-fl-cfg')).slice(0, 60)));
    console.log('    画布节点数: ' + await p.locator('.lw-fl-node').count());
    await p.locator('[data-flcfg="folder"]').fill(MARK + '文件夹');
    await p.locator('[data-flcfg="title"]').fill(MARK + '标题');
    await p.locator('[data-flcfg="text"]').fill('正文内容');
    await p.waitForTimeout(600);
    await p.click('#lw-fl-run');
    await p.waitForTimeout(4000);
    const memoAfter = (await store()).memos || [];
    const made = memoAfter.filter((m) => String(m.text).includes(MARK + '标题'));
    ck('★ 真的写进备忘录了', made.length === 1, '备忘录 ' + memoBefore + ' → ' + memoAfter.length);
    ck('★ 文件夹也对', made[0] && made[0].folder === MARK + '文件夹', made[0] && made[0].folder);

    console.log('\n── ⑪ 说明面板 + 示例（用户要的「每个节点的作用 / 提示怎么用」）──');
    ck('工具栏有「📖 说明」', await p.locator('#lw-fl-help').count() === 1);
    ck('工具栏有「✨ 示例」', await p.locator('#lw-fl-example').count() === 1);
    /* ★ 节点库每一项都得有**第二行说明** ✓ —— 用户不想点开才知道是干什么的 ✗ */
    const palSub = await p.evaluate(() => {
      const it = Array.from(document.querySelectorAll('[data-fladd]'));
      return {
        n: it.length,
        withSub: it.filter((e) => { const i = e.querySelector('.tx i'); return i && i.textContent.trim().length > 4; }).length,
      };
    });
    ck('★ 节点库 14 项全都带「这节点干什么」说明', palSub.n === 14 && palSub.withSub === 14, JSON.stringify(palSub));
    /* 点开说明 */
    await p.click('#lw-fl-help'); await p.waitForTimeout(800);
    ck('★ 说明面板出来了', await p.locator('.lw-fl-help').count() === 1);
    ck('★ 说明和画布**互斥**（不叠在一起）', await p.locator('.lw-fl-cv').count() === 0);
    const hn = await p.locator('.lw-fl-hn').count();
    ck('★ 说明里 14 个节点逐个讲了作用', hn === 14, String(hn));
    const htxt = await txt('.lw-fl-helpin');
    for (const k of ['一分钟上手', '变量怎么传', '每个节点是干什么的', '常见问题', '照着搭一个']) ck('  说明里有「' + k + '」', htxt.includes(k));
    ck('★ 说明讲了 {{}} 怎么引用', htxt.includes('{{n3}}') && htxt.includes('{{input}}'));
    /* ⚠️ 面板**不渲染 markdown** ✗ —— 说明里写了星号就会原样显示 ✗（我前面已经踩过一次 ✗）。 */
    ck('★ 说明里没有漏出来的 markdown 星号', !/\*\*/.test(htxt), (htxt.match(/\*\*[^*]{0,24}\*\*/) || [''])[0]);
    await p.click('#lw-fl-help'); await p.waitForTimeout(800);
    ck('再点一下收起来，画布回来', await p.locator('.lw-fl-cv').count() === 1 && await p.locator('.lw-fl-help').count() === 0);

    console.log('\n── ⑫ 选中节点：属性栏要说清「我是谁 / 干什么 / 输出什么」──');
    await p.locator('.lw-fl-node').first().click(); await p.waitForTimeout(700);
    ck('★ 画布节点右上角标了 id（写 {{}} 要用）', await p.locator('.lw-fl-node .hd .fid').count() >= 1);
    ck('★ 属性栏显示节点 id', await p.locator('.lw-fl-cfg .fd .fid').count() === 1, await txt('.lw-fl-cfg .fd'));
    ck('★ 属性栏有「这个节点是干什么的」', (await txt('.lw-fl-cfg .fd')).length > 8, (await txt('.lw-fl-cfg .fd')).slice(0, 60));
    ck('★ 属性栏有「输出什么」（下游引用要用）', (await txt('.lw-fl-cfg .fout')).includes('输出'), (await txt('.lw-fl-cfg .fout')).slice(0, 60));

    console.log('\n── ⑬ ✨ 示例：一键搭一张真能跑的图 ──');
    const beforeIds = ((await store()).flows || []).map((x) => x.id);
    await p.click('#lw-fl-example'); await p.waitForTimeout(1400);
    const fresh = ((await store()).flows || []).filter((x) => !beforeIds.includes(x.id));
    madeIds.push(...fresh.map((x) => x.id));
    ck('★ 示例建出了一个新工作流', fresh.length === 1, JSON.stringify(fresh.map((x) => x.name)));
    ck('★ 示例有 6 个节点 5 条线', !!fresh[0] && fresh[0].nodes.length === 6 && fresh[0].edges.length === 5,
      fresh[0] ? (fresh[0].nodes.length + ' 节点 / ' + fresh[0].edges.length + ' 线') : '');
    ck('★ 示例真画到画布上了', await p.locator('.lw-fl-node').count() === 6, String(await p.locator('.lw-fl-node').count()));
    const aiN = fresh[0] && fresh[0].nodes.find((n) => n.type === 'ai.chat');
    const memoN = fresh[0] && fresh[0].nodes.find((n) => n.type === 'out.memo');
    ck('★ 示例里「AI 的结果」被下游正确引用（{{id.text}}）',
      !!(aiN && memoN && String(memoN.cfg.text).includes('{{' + aiN.id + '.text}}')), memoN && memoN.cfg.text);
    const httpN = fresh[0] && fresh[0].nodes.find((n) => n.type === 'http.request');
    const jsonN = fresh[0] && fresh[0].nodes.find((n) => n.type === 'data.json');
    ck('★ 示例的 JSON 路径直接从 data 开始（不用写 json.data）', !!(jsonN && String(jsonN.cfg.path) === 'data.list'), jsonN && jsonN.cfg.path);
    ck('示例的 HTTP URL 是真的', !!(httpN && /^https:\/\//.test(httpN.cfg.url)), httpN && httpN.cfg.url);

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      const before = { flows: (d.flows || []).length, memos: (d.memos || []).length };
      d.flows = (d.flows || []).filter((x) => !String(x.name).includes(MARK) && !madeIds.includes(x.id));
      d.memos = (d.memos || []).filter((m) => !String(m.text).includes(MARK));
      d.memoFolders = (d.memoFolders || []).filter((f) => !String(f).includes(MARK));
      delete d.flowSel;
      await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const a = await store();
      console.log('\n收尾：工作流 ' + before.flows + '→' + (a.flows || []).length + ' · 备忘录 ' + before.memos + '→' + (a.memos || []).length
        + ' | 残留探针: ' + (a.flows || []).filter((x) => String(x.name).includes(MARK)).length + ' / ' + (a.memos || []).filter((m) => String(m.text).includes(MARK)).length);
    } catch (e) { console.log('\n收尾失败: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
