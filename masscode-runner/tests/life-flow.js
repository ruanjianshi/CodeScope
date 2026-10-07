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
    /* ⚠️ **备忘录 / 文件夹也要清** ✗✗ —— 原来只清工作流 ✗，于是：
       上一轮探针要是被 Ctrl-C / 管道截断（SIGTERM）打断，`finally` 没跑成 ✓，
       它写的那条「__探针流__标题」备忘录就留下了 ✗；
       这一轮再写一条 → 第 ⑩ 段的 `made.length === 1` 变成 2 → **假失败** ✗
       （实测踩过：被 `| head -40` 截断后，下一轮就挂在「真的写进备忘录了」✓）。
       → 开跑前把带探针标记的**全部**清掉 ✓，探针要能**自愈** ✓。 */
    d0.memos = (d0.memos || []).filter((m) => !String(m.text).includes(MARK));
    d0.memoFolders = (d0.memoFolders || []).filter((f) => !String(f).includes(MARK));
    delete d0.flowSel;
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
    ck('节点库有 28 种节点', await p.locator('[data-fladd]').count() === 28, String(await p.locator('[data-fladd]').count()));
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
    ck('★ 节点库 28 项全都带「这节点干什么」说明', palSub.n === 28 && palSub.withSub === 28, JSON.stringify(palSub));
    /* 点开说明 */
    await p.click('#lw-fl-help'); await p.waitForTimeout(800);
    ck('★ 说明面板出来了', await p.locator('.lw-fl-help').count() === 1);
    ck('★ 说明和画布**互斥**（不叠在一起）', await p.locator('.lw-fl-cv').count() === 0);
    const hn = await p.locator('.lw-fl-hn').count();
    ck('★ 说明里 28 个节点逐个讲了作用', hn === 28, String(hn));
    const htxt = await txt('.lw-fl-helpin');
    for (const k of ['一分钟上手', '变量怎么传', '每个节点是干什么的', '常见问题', '照着搭一个']) ck('  说明里有「' + k + '」', htxt.includes(k));
    ck('★ 说明讲了 {{}} 怎么引用（新表达式写法）', htxt.includes('{{ $json.title }}') && htxt.includes('$node['), htxt.slice(0,60));
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

    /* ══════════════════════════════════════════════════════════════════
       ⑭~⑰：对齐 n8n 的那批新东西 ✓
       用户原话：「工作流的功能太少，参考 N8N 的完整设计」✓
       ══════════════════════════════════════════════════════════════════ */
    console.log('\n── ⑭ 节点库扩充 ──');
    const nAdd = await p.locator('[data-fladd]').count();
    ck('★ 节点数 = 28（原来 14）', nAdd === 28, String(nAdd));
    const grpNames = await p.locator('.lw-fl-side .lw-rd-hd').allInnerTexts();
    ck('★ 多了「列表」这一组', grpNames.indexOf('列表') >= 0, JSON.stringify(grpNames));
    for (const k of ['logic.switch', 'list.filter', 'list.sort', 'list.limit', 'list.unique',
      'list.aggregate', 'list.split', 'list.merge', 'data.set', 'data.code', 'data.date',
      'data.crypto', 'note.sticky', 'out.flow']) {
      ck('  有节点 ' + k, await p.locator('[data-fladd="' + k + '"]').count() === 1);
    }

    console.log('\n── ⑮ 画布：多路分支 4 个出口 / 便签 ──');
    /* ⚠️ 「＋ 新建」会弹一个 prompt 问名字 ✗ —— 不往 dialogs 里排队的话，
       会被空字符串 accept 掉 ✗ → flowNew 直接 return ✗ → **根本没建出工作流** ✗，
       后面「按 MARK 找这个流」就全是 null ✗（实测踩过 ✗）。 */
    dialogs.push(MARK + '工作流');
    await p.click('#lw-fl-new'); await p.waitForTimeout(900);
    await p.locator('[data-fladd="trigger.manual"]').click(); await p.waitForTimeout(400);
    await p.locator('[data-fladd="logic.switch"]').click(); await p.waitForTimeout(400);
    await p.locator('[data-fladd="note.sticky"]').click(); await p.waitForTimeout(400);
    const swInfo = await p.evaluate(() => {
      for (const el of document.querySelectorAll('.lw-fl-node')) {
        const bd = el.querySelector('.bd');
        if (bd && bd.innerText.indexOf('多路分支') >= 0) {
          const outs = Array.from(el.querySelectorAll('.lw-fl-port.out'));
          return { n: outs.length, tops: outs.map((x) => x.style.top) };
        }
      }
      return null;
    });
    ck('★ 多路分支有 4 个出口（原来最多 2 个）', !!swInfo && swInfo.n === 4, JSON.stringify(swInfo));
    ck('★ 4 个出口按数量均分、不重叠', !!swInfo && new Set(swInfo.tops).size === 4, JSON.stringify(swInfo && swInfo.tops));
    ck('★ 便签单独渲染（不参与执行）', await p.locator('.lw-fl-node.sticky').count() === 1);
    await p.locator('.lw-fl-node.sticky').click(); await p.waitForTimeout(600);
    await p.locator('[data-flcfg="text"]').fill('这里是说明文字'); await p.waitForTimeout(600);
    ck('★ 便签写文字立刻反映到画布',
      (await p.locator('.lw-fl-node.sticky .sticky-bd').first().innerText()).indexOf('这里是说明文字') >= 0,
      await p.locator('.lw-fl-node.sticky .sticky-bd').first().innerText());

    console.log('\n── ⑯ 画布交互：多选 / 复制粘贴 / 撤销重做 / 框选 / 整理 ──');
    /* ⚠️ 快捷键之前要先把焦点**从输入框挪开** ✗ ——
       上一步刚在便签的文本框里填过字 ✓，焦点还在里面 ✓；
       而快捷键处理器**故意**在输入框里不接管 ⌘A/⌘C/⌘V ✗
       （不然用户想全选输入框里的文字会被抢走 ✗）。
       → 点一下画布空白处再按 ✓。 */
    const cvBox0 = await p.locator('#lw-fl-cv').boundingBox();
    await p.mouse.click(cvBox0.x + cvBox0.width - 30, cvBox0.y + cvBox0.height - 30);
    await p.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await p.waitForTimeout(400);
    const n0 = await p.locator('.lw-fl-node').count();
    await p.keyboard.press('Meta+a'); await p.waitForTimeout(500);
    ck('⌘A 全选', await p.locator('.lw-fl-node.picked').count() === n0, String(await p.locator('.lw-fl-node.picked').count()));
    await p.keyboard.press('Meta+c'); await p.waitForTimeout(400);
    await p.keyboard.press('Meta+v'); await p.waitForTimeout(800);
    ck('★ ⌘C / ⌘V 粘贴（节点翻倍）', await p.locator('.lw-fl-node').count() === n0 * 2, n0 + ' → ' + await p.locator('.lw-fl-node').count());
    await p.keyboard.press('Meta+z'); await p.waitForTimeout(800);
    ck('★ ⌘Z 撤销', await p.locator('.lw-fl-node').count() === n0, String(await p.locator('.lw-fl-node').count()));
    await p.keyboard.press('Meta+Shift+z'); await p.waitForTimeout(800);
    ck('★ ⌘⇧Z 重做', await p.locator('.lw-fl-node').count() === n0 * 2, String(await p.locator('.lw-fl-node').count()));
    await p.keyboard.press('Meta+z'); await p.waitForTimeout(800);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    const cvBox = await p.locator('#lw-fl-cv').boundingBox();
    await p.mouse.move(cvBox.x + 20, cvBox.y + 20); await p.mouse.down();
    await p.mouse.move(cvBox.x + 760, cvBox.y + 460, { steps: 10 });
    ck('★ 拖拽时出现选框', await p.evaluate(() => {
      const m = document.getElementById('lw-fl-marquee');
      return !!m && getComputedStyle(m).display !== 'none';
    }));
    await p.mouse.up(); await p.waitForTimeout(700);
    ck('★ 框选能选中多个节点', await p.locator('.lw-fl-node.picked').count() >= 2, String(await p.locator('.lw-fl-node.picked').count()));
    const posBefore = await p.evaluate(() => Array.from(document.querySelectorAll('.lw-fl-node')).map((e) => e.style.left + ',' + e.style.top).join('|'));
    await p.click('#lw-fl-tidy'); await p.waitForTimeout(800);
    const posAfter = await p.evaluate(() => Array.from(document.querySelectorAll('.lw-fl-node')).map((e) => e.style.left + ',' + e.style.top).join('|'));
    ck('★ ▦ 整理真的重排了', posBefore !== posAfter);

    console.log('\n── ⑰ 节点高级设置（重试 / 出错继续 / 禁用 / 备注）──');
    await p.locator('.lw-fl-node').first().click(); await p.waitForTimeout(600);
    /* 从**右栏**读 id ✓（比从 DOM class 猜稳 ✗ —— 点节点可能正好点在端口上 ✗） */
    const editedId = await p.evaluate(() => {
      const el = document.querySelector('.lw-fl-cfg .fd .fid');
      return el ? el.textContent.trim() : '';
    });
    ck('  点节点后右栏认出了它的 id', !!editedId, editedId);
    ck('★ 右栏有「高级」那一栏', (await txt('.lw-fl-cfg')).indexOf('高级') >= 0, (await txt('.lw-fl-cfg')).slice(0, 60));
    ck('★ 四个设置项都在（出错时/重试/间隔/备注）', await p.locator('[data-flopt]').count() === 4, String(await p.locator('[data-flopt]').count()));
    await p.locator('[data-flopt="retry"]').fill('3'); await p.waitForTimeout(400);
    await p.locator('[data-flopt="onError"]').selectOption('continue'); await p.waitForTimeout(400);
    await p.locator('[data-flopt="note"]').fill('探针备注'); await p.waitForTimeout(500);
    /* ⚠️ 要**重新读一次 store** ✗ —— 之前拿的那个是快照 ✗，改了之后它不会变 ✗。 */
    const findNode = async () => {
      const d = await store();
      const fl = (d.flows || []).filter((x) => String(x.name).indexOf(MARK) >= 0).pop();
      return (fl && (fl.nodes || []).find((n) => n.id === editedId)) || null;
    };
    const savedNode = await findNode();
    ck('★ 重试次数落盘', !!(savedNode && Number(savedNode.retry) === 3), JSON.stringify(savedNode && savedNode.retry));
    ck('★ 出错继续落盘', !!(savedNode && savedNode.onError === 'continue'), String(savedNode && savedNode.onError));
    ck('★ 备注落盘', !!(savedNode && savedNode.note === '探针备注'), String(savedNode && savedNode.note));
    ck('有 禁用 / 复制 / 执行到此 三个按钮',
      await p.locator('#lw-fl-nodedis').count() === 1 && await p.locator('#lw-fl-nodecopy').count() === 1 && await p.locator('#lw-fl-noderun').count() === 1);
    await p.click('#lw-fl-nodedis'); await p.waitForTimeout(700);
    ck('★ 禁用后画布上变灰', await p.locator('.lw-fl-node.off').count() >= 1, String(await p.locator('.lw-fl-node.off').count()));
    ck('★ 禁用状态落盘', !!(await findNode() || {}).disabled, JSON.stringify((await findNode() || {}).disabled));
    await p.click('#lw-fl-nodedis'); await p.waitForTimeout(600);
    ck('  再点能启用回来', !(await findNode() || {}).disabled);

    console.log('\n── ⑱ 执行历史 ──');
    await p.click('#lw-fl-run'); await p.waitForTimeout(4000);
    await p.click('#lw-fl-runs'); await p.waitForTimeout(900);
    ck('★ 历史浮层打开（id 没和工具栏按钮撞）', await p.locator('#lw-fl-runbox').count() === 1);
    ck('★ 记下了一条执行', await p.locator('[data-flrun]').count() >= 1, String(await p.locator('[data-flrun]').count()));
    await p.locator('[data-flrun]').first().click(); await p.waitForTimeout(700);
    const runTxt = await txt('#lw-fl-runbox');
    ck('★ 点开能看到每一步 + 输出', /手动触发/.test(runTxt), runTxt.replace(/\n/g, ' ').slice(0, 80));
    await p.click('#lw-fl-runbox-x'); await p.waitForTimeout(600);
    ck('历史浮层能关掉', await p.locator('#lw-fl-runbox').count() === 0);

    /* ══════════════════════════════════════════════════════════════════
       ⑲ 连线箭头 + 实时执行进度
       ★ 用户原话：「怎么连线，没有箭头，执行，也没有执行到哪的显示」✓。
         两件事都要守住：
         ① 每条连线**有箭头** ✓（没箭头读不出方向 ✗）—— 而且只能画在**可见那条**上 ✗，
            画在那根 14px 宽的透明命中区上会叠出一个看不见但挡事的巨大箭头 ✗。
         ② 跑的时候**画布上看得见进度** ✓（哪个节点正在跑 ✓、跑到第几步 ✓）。
            ⚠️ 要放一个「等待 3 秒」节点 ✗ —— 否则 3 个节点 5 毫秒就跑完 ✗，
               DOM 采样根本采不到「正在跑」那个瞬间 ✗（实测：不 waiting 的话 60 次采样全是 0 ✗）。
       ══════════════════════════════════════════════════════════════════ */
    console.log('\n── ⑲ 连线箭头 + 实时执行进度 ──');
    dialogs.push(MARK + '箭头');
    await p.click('#lw-fl-new'); await p.waitForTimeout(900);
    await p.locator('[data-fladd="trigger.manual"]').click(); await p.waitForTimeout(500);
    await p.locator('[data-fladd="data.template"]').click(); await p.waitForTimeout(500);
    await p.locator('[data-fladd="out.notify"]').click(); await p.waitForTimeout(500);
    await p.locator('[data-fladd="util.delay"]').click(); await p.waitForTimeout(600);
    let aWf = ((await store()).flows || []).filter((x) => String(x.name).includes(MARK + '箭头')).pop();
    ck('  建好了 4 个节点（含「等待」）', !!aWf && aWf.nodes.length === 4, aWf ? String(aWf.nodes.length) : 'null');
    const aTrig = aWf.nodes.find((n) => n.type === 'trigger.manual');
    const aTpl = aWf.nodes.find((n) => n.type === 'data.template');
    const aDly = aWf.nodes.find((n) => n.type === 'util.delay');
    const aNtf = aWf.nodes.find((n) => n.type === 'out.notify');
    /* 把「等待」配成 3 秒（默认 1000ms 太短，采不到 ✗） */
    await p.locator('[data-flnode="' + aDly.id + '"]').click(); await p.waitForTimeout(600);
    await p.locator('[data-flcfg="ms"]').fill('3000'); await p.waitForTimeout(600);
    /* 连成 trigger → template → delay → notify */
    await p.locator('[data-flout="' + aTrig.id + '"][data-flport="0"]').click(); await p.waitForTimeout(250);
    await p.locator('[data-flin="' + aTpl.id + '"]').click(); await p.waitForTimeout(500);
    await p.locator('[data-flout="' + aTpl.id + '"][data-flport="0"]').click(); await p.waitForTimeout(250);
    await p.locator('[data-flin="' + aDly.id + '"]').click(); await p.waitForTimeout(500);
    await p.locator('[data-flout="' + aDly.id + '"][data-flport="0"]').click(); await p.waitForTimeout(250);
    await p.locator('[data-flin="' + aNtf.id + '"]').click(); await p.waitForTimeout(700);
    aWf = ((await store()).flows || []).filter((x) => String(x.name).includes(MARK + '箭头')).pop();
    ck('★ 三条连线落盘', aWf.edges.length === 3, JSON.stringify(aWf.edges.map((e) => e.from + '→' + e.to)));

    /* ── 箭头 ── */
    ck('★ SVG 里有箭头（marker）定义', await p.locator('.lw-fl-svg defs marker').count() >= 1);
    const arrowState = await p.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('.lw-fl-svg g[data-flowedge] path'));
      return {
        total: ps.length,
        hitWithArrow: ps.filter((x) => x.classList.contains('hit') && x.getAttribute('marker-end')).length,
        visWithArrow: ps.filter((x) => !x.classList.contains('hit') && x.getAttribute('marker-end')).length,
      };
    });
    console.log('    path 统计: ' + JSON.stringify(arrowState));
    ck('★ 每条连线都画了箭头', arrowState.visWithArrow === 3, JSON.stringify(arrowState));
    ck('★ 箭头**只**画在可见线上（透明命中区不画，否则会叠出巨大的隐形箭头）',
      arrowState.hitWithArrow === 0 && arrowState.total === 6, JSON.stringify(arrowState));
    /* ⚠️ 线要**提前 11px 收尾** ✗ —— 端口圆点在上面压着 ✓，
       线画到端口中心的话箭头尖会被盖住 ✗，等于没画 ✗。 */
    const byId = {}; aWf.nodes.forEach((n) => { byId[n.id] = n; });
    const geo = await p.evaluate(() => Array.from(document.querySelectorAll('.lw-fl-svg g[data-flowedge]'))
      .map((g) => { const m = /([\d.]+),([\d.]+)$/.exec(g.querySelector('path:not(.hit)').getAttribute('d')); return m ? Number(m[1]) : null; }));
    const wantEnd = aWf.edges.map((e) => byId[e.to].x - 11);
    ck('★ 可见线提前 11px 收尾（箭头尖不被端口圆点盖住）',
      geo.length === wantEnd.length && geo.every((x, i) => Math.abs(x - wantEnd[i]) < 0.6), JSON.stringify(geo) + ' vs ' + JSON.stringify(wantEnd));

    /* ── 颜色：连线要看得见，且箭头要跟线同色 ──
       ⚠️ 原来用 lineDim(#3a382f) 压在底色(#0b0b0b)上，对比度只有 **1.67:1** ✗
          （WCAG 非文本最低要 3:1 ✗）—— 连线基本看不见 ✗，这正是「怎么连线」的根因之一 ✓。
       ⚠️⚠️ 更要命的是：CSS 的「.lw-fl-svg path { stroke:… }」会**连带命中 <defs> 里的
          marker** ✗，而 CSS 优先级**高于** SVG 的 stroke 属性 ✗ →
          高亮态箭头写 stroke="accent" 被覆盖 ✗，**选中节点时线变黄、箭头不变** ✗。
          修法：用更具体的选择器按状态分别指定 ✓。 */
    const colors = await p.evaluate(() => {
      const g = (e) => (e ? getComputedStyle(e).stroke : null);
      return {
        vis: g(document.querySelector('.lw-fl-svg g[data-flowedge] path:not(.hit)')),
        mk: g(document.querySelector('#lw-fl-ah path')),
        mkHot: g(document.querySelector('#lw-fl-ah-hot path')),
      };
    });
    console.log('    颜色: ' + JSON.stringify(colors));
    const rgb = (s) => (String(s).match(/\d+/g) || []).map(Number);
    /* 相对亮度 → 对比度 ✓（WCAG ✓） */
    const lum = (s) => {
      const [r, g, b] = rgb(s).slice(0, 3).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bgLum = await p.evaluate(() => getComputedStyle(document.querySelector('.lw-fl-cv')).backgroundColor);
    const ratio = (a, b) => { const l1 = Math.max(lum(a), lum(b)), l2 = Math.min(lum(a), lum(b)); return (l1 + 0.05) / (l2 + 0.05); };
    const cr = ratio(colors.vis, bgLum);
    console.log('    连线对比度: ' + cr.toFixed(2) + ':1（底色 ' + bgLum + '）');
    ck('★ 连线对比度 ≥ 2.5:1（原来 1.67:1，基本看不见）', cr >= 2.5, cr.toFixed(2) + ':1');
    ck('★ 箭头和连线**同色**（不是两个颜色）', colors.vis === colors.mk, colors.vis + ' vs ' + colors.mk);
    ck('★ 高亮态的箭头**真的**是强调色（没被 CSS 覆盖成灰色）',
      colors.mkHot === colors.mkHot && colors.mkHot !== colors.mk, colors.mk + ' vs ' + colors.mkHot);
    /* 选中一个节点 → 它的边变 hot，而且用的是 **hot 那个 marker** ✓ */
    await p.locator('[data-flnode="' + aTrig.id + '"]').click(); await p.waitForTimeout(800);
    const hot = await p.evaluate(() => ({
      n: document.querySelectorAll('.lw-fl-svg path.hot').length,
      used: Array.from(document.querySelectorAll('.lw-fl-svg path[marker-end]')).map((x) => x.getAttribute('marker-end')),
    }));
    ck('★ 选中节点后它的边变高亮，且换用 hot 箭头', hot.n >= 1 && hot.used.some((u) => u.indexOf('-hot') > 0), JSON.stringify(hot));
    await p.locator('.lw-fl-cv').click({ position: { x: 8, y: 8 } }); await p.waitForTimeout(500);

    /* ── 实时进度：一边跑一边采 DOM ── */
    const seen = { running: 0, okSeq: [], hints: [] };
    let stopSample = false;
    const sampler = (async () => {
      while (!stopSample) {
        const s = await p.evaluate(() => ({
          running: document.querySelectorAll('.lw-fl-node.running').length,
          ok: document.querySelectorAll('.lw-fl-node.s-ok').length,
          hint: (document.querySelector('.lw-fl-tools .hint') || {}).textContent || '',
        })).catch(() => null);
        if (s) {
          if (s.running) seen.running++;
          seen.okSeq.push(s.ok);
          if (s.hint.trim() && seen.hints.indexOf(s.hint.trim()) < 0) seen.hints.push(s.hint.trim());
        }
        await p.waitForTimeout(100);
      }
    })();
    await p.click('#lw-fl-run');
    await p.waitForTimeout(6500);      /* 3 秒等待 + 余量 ✓ */
    stopSample = true;
    await sampler;
    await p.waitForTimeout(1200);
    console.log('    采样（出现过 .running 的次数）: ' + seen.running);
    console.log('    工具栏提示: ' + JSON.stringify(seen.hints.filter((h) => /正在跑/.test(h)).slice(0, 2)));
    ck('★★ 执行过程中画布上出现过「正在跑」的节点', seen.running > 0, 'running 采样 ' + seen.running);
    ck('★ 工具栏写着「正在跑… N / M 步（节点名）」',
      seen.hints.some((h) => /正在跑/.test(h) && /\d+ \/ \d+ 步/.test(h)), JSON.stringify(seen.hints.slice(0, 3)));
    ck('★ 提示里点了名（一眼看出卡在哪个节点）', seen.hints.some((h) => /正在跑/.test(h) && /（.+）/.test(h)), JSON.stringify(seen.hints.slice(0, 3)));
    ck('★ 状态是**逐步**亮起来的（不是一次全亮）', new Set(seen.okSeq).size > 1, JSON.stringify([...new Set(seen.okSeq)]));
    ck('★ 跑完 4 个节点都带 ✓', await p.locator('.lw-fl-node.s-ok').count() === 4, String(await p.locator('.lw-fl-node.s-ok').count()));
    ck('★ 「等待」节点真的等了 3 秒（说明确实是流式，不是一口气跑完）',
      /等待[\s\S]{0,20}3\d{3}ms/.test(await txt('.lw-fl-log')), (await txt('.lw-fl-log')).slice(0, 120));

    /* ══════════════════════════════════════════════════════════════════
       ⑳ 定时触发（服务端排期 + 前端收产出）
       ⚠️ 这一段要**真等一次调度**（服务端 30 秒一个 tick ✗，
          「每隔 1 分钟」最快也得等 ~90 秒 ✗）—— 所以它比别的段慢很多 ✓。
       ══════════════════════════════════════════════════════════════════ */
    console.log('\n── ⑳ 定时触发：服务端排期 ──');
    dialogs.push(MARK + '定时流');
    await p.click('#lw-fl-new'); await p.waitForTimeout(900);
    await p.locator('[data-fladd="trigger.timer"]').click(); await p.waitForTimeout(500);
    await p.locator('[data-fladd="out.memo"]').click(); await p.waitForTimeout(500);
    /* 配成「每隔 1 分钟」+ 备忘录 */
    await p.locator('.lw-fl-node').first().click(); await p.waitForTimeout(600);
    await p.locator('[data-flcfg="every"]').fill('1'); await p.waitForTimeout(500);
    await p.locator('.lw-fl-node').last().click(); await p.waitForTimeout(600);
    await p.locator('[data-flcfg="title"]').fill(MARK + '定时产出');
    await p.locator('[data-flcfg="text"]').fill('定时跑出来的'); await p.waitForTimeout(500);
    /* 连线 */
    const tNodes = ((await store()).flows || []).filter((x) => String(x.name) === MARK + '定时流').pop();
    ck('  定时工作流建好了（2 个节点）', !!tNodes && tNodes.nodes.length === 2, tNodes ? String(tNodes.nodes.length) : 'null');
    await p.locator('[data-flout="' + tNodes.nodes[0].id + '"][data-flport="0"]').click(); await p.waitForTimeout(400);
    await p.locator('[data-flin="' + tNodes.nodes[1].id + '"]').click(); await p.waitForTimeout(700);

    const sch0 = await (await fetch(BASE + '/api/life/flow/schedule')).json();
    const mine = (sch0.items || []).filter((x) => x.flowId === tNodes.id);
    ck('★ 服务端认出了这个定时触发器', mine.length === 1, JSON.stringify(mine.map((x) => x.flowName)));
    /* ⚠️ 「从没跑过的间隔任务」按设计是**立刻到期**的 ✓（见 lib/flow-schedule.js 那段注释 ✓），
       所以这里**不能**断言「下次在未来」✗ —— 第一版就是这么写的 ✓，
       结果它把「立刻到期」误判成失败 ✗（而那恰恰是修好的那个 bug 的行为 ✓）。 */
    ck('★ 算出了下次运行时间（从没跑过 → 立刻到期）', !!mine[0] && typeof mine[0].nextAt === 'number' && mine[0].nextAt <= sch0.now,
      mine[0] ? new Date(mine[0].nextAt).toISOString() + ' vs now' : 'null');
    /* ⚠️ 这一条是**关键** ✗ —— 上面两条就算 `every` 还是默认的 60 分钟也照样通过 ✗，
       于是「调度器没跑」会被误判成「调度器坏了」✗（实测踩过 ✗）。
       必须直接断言「间隔是 1 分钟、下次在 90 秒内」✓。 */
    console.log('    排期详情: ' + JSON.stringify(mine.map((x) => ({ every: x.cfg.every, mode: x.cfg.mode, 还有秒: Math.round((x.nextAt - sch0.now) / 1000) }))));
    ck('★ 间隔配成了 1 分钟（不是默认的 60）', !!mine[0] && String(mine[0].cfg.every) === '1', mine[0] ? String(mine[0].cfg.every) : 'null');
    ck('★ 下次在 90 秒内（所以等一下就能看到它自己跑）', !!mine[0] && (mine[0].nextAt - sch0.now) <= 90000, mine[0] ? Math.round((mine[0].nextAt - sch0.now) / 1000) + 's' : 'null');

    console.log('    ⏰ 打开定时面板');
    await p.click('#lw-fl-sched'); await p.waitForTimeout(1200);
    ck('★ 定时浮层开了', await p.locator('#lw-fl-schedbox').count() === 1);
    const stTxt = await txt('#lw-fl-schedbox');
    ck('★ 说清了「排期在服务端、面板关着也会跑」', /服务端/.test(stTxt) && /关了都会跑/.test(stTxt), stTxt.slice(0, 70));
    ck('★ 说清了「错过的班次不补跑」', /不补跑/.test(stTxt));
    ck('★ 列出了这个定时任务和它的下次时间', /下次/.test(stTxt) && stTxt.indexOf(MARK + '定时流') >= 0, stTxt.replace(/\n/g, ' ').slice(0, 140));
    await p.click('#lw-fl-schedbox-close'); await p.waitForTimeout(600);
    ck('  能关掉', await p.locator('#lw-fl-schedbox').count() === 0);

    console.log('    ⏳ 等调度器真的跑一次（最多 100 秒 —— 服务端 30 秒一个 tick，「每隔 1 分钟」最快也要 ~90 秒）');
    const memosBefore2 = ((await store()).memos || []).filter((m) => String(m.text).indexOf(MARK + '定时产出') >= 0).length;
    let fired = false;
    for (let i = 0; i < 20; i++) {
      await p.waitForTimeout(5000);
      const sch = await (await fetch(BASE + '/api/life/flow/schedule')).json();
      const it = (sch.items || []).filter((x) => x.flowId === tNodes.id)[0];
      const box = (sch.outbox || []).filter((x) => x.flowId === tNodes.id);
      const memoNow = ((await store()).memos || []).filter((m) => String(m.text).indexOf(MARK + '定时产出') >= 0).length;
      /* ★ 每一步都打出来 ✗ —— 不然「没跑」到底是「没到期」「tick 没转」「跑了但被前端收走了」
         三种情况**长得一模一样** ✗（实测就是靠这行才看出来的 ✗）。 */
      console.log('      +' + ((i + 1) * 5) + 's 还有 ' + (it && it.nextAt ? Math.round((it.nextAt - sch.now) / 1000) : '?') + 's'
        + ' · outbox ' + box.length + ' · 备忘录 ' + memoNow + ' · 上次 ' + (it && it.lastAt ? new Date(it.lastAt).toLocaleTimeString('zh-CN', { hour12: false }) : '无'));
      if (box.length) { fired = true; console.log('      → 调度器跑了（ok=' + box[0].ok + '）'); break; }
      /* ⚠️ 也可能「跑了、而且已经被前端收走并落地了」✗ ——
         那 outbox 就是空的 ✓，但备忘录已经多了一条 ✓。这也算成功 ✓。 */
      if (memoNow > memosBefore2) { fired = true; console.log('      → 产出已经落地（被前端收走了）'); break; }
    }
    ck('★★ 调度器真的自动跑了（没人点运行）', fired);
    if (fired) {
      /* 产出要等前端下一次轮询才会落地 ✓（最多 60 秒 ✓） */
      let landed = false;
      for (let i = 0; i < 14; i++) {
        await p.waitForTimeout(5000);
        const now = ((await store()).memos || []).filter((m) => String(m.text).indexOf(MARK + '定时产出') >= 0).length;
        if (now > memosBefore2) { landed = true; console.log('      → 第 ' + ((i + 1) * 5) + ' 秒：产出落进备忘录了'); break; }
      }
      ck('★★ 定时产出落进了备忘录（前端收 outbox）', landed, memosBefore2 + ' → ' + ((await store()).memos || []).filter((m) => String(m.text).indexOf(MARK + '定时产出') >= 0).length);
      const sch2 = await (await fetch(BASE + '/api/life/flow/schedule')).json();
      ck('★ outbox 被回执清空（不会重复落地）', (sch2.outbox || []).filter((x) => x.flowId === tNodes.id).length === 0);
    }

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
