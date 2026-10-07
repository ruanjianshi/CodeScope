/* 文件全景（本机管家 → 文件全景）—— 打**真实实例**的端到端探针
   ⚠️ 需要本机 127.0.0.1:4877 起着；没起就跳过（绝不变成假失败）。
   ⚠️ 只读：本探针**不删任何文件**，也不改服务端数据（只读接口）。
   运行：node tests/file-atlas-view.js */
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const BASE = 'http://127.0.0.1:4877';
let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; console.log('  ✅ ' + n); } else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例）'); process.exit(0); }

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('dialog', async (d) => { await d.accept(); });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };

  try {
    /* ── ① 接口层（快扫 / 缓存 / 深扫）───────────────────────────────── */
    console.log('\n── ① 接口：快扫 + 缓存 ──');
    const t0 = Date.now();
    const fast = await (await fetch(BASE + '/api/system-panel/atlas', { signal: AbortSignal.timeout(60000) })).json();
    const fastMs = Date.now() - t0;
    ck('快扫返回 ok', fast.ok === true, JSON.stringify(fast).slice(0, 120));
    ck('★ 标了 mode=fast', fast.mode === 'fast', String(fast.mode));
    ck('★ 覆盖到 20+ 个根目录（老版本只有 19 个，且漏掉最大的几块）', (fast.stats.rootsScanned || 0) >= 20, String(fast.stats.rootsScanned));
    ck('★ 统计里带上了新补的根（/opt 或 /private/var/folders）',
      (fast.stats.rootTiming || []).some((r) => /\/opt$|\/private\/var\/folders$|\/usr\/local$/.test(r.path)),
      JSON.stringify((fast.stats.rootTiming || []).map((r) => r.path)).slice(0, 200));
    ck('有 topActionable（排除动不了的）', Array.isArray(fast.topActionable) && fast.topActionable.length > 0, String((fast.topActionable || []).length));
    ck('★ topActionable 里没有 L0/L1（那是「看了也没用」的）',
      (fast.topActionable || []).every((f) => f.tier === 'L2-cache' || f.tier === 'L3-temp' || f.tier === 'L4-user'),
      JSON.stringify([...new Set((fast.topActionable || []).map((f) => f.tier))]));
    ck('★ topFiles 里确实有 L0（swapfile 那种），所以两个榜才有意义',
      (fast.topFiles || []).some((f) => f.tier === 'L0-system'),
      JSON.stringify([...new Set((fast.topFiles || []).map((f) => f.tier))]));
    ck('★ 预演总数不是「被截断的 3000」', (fast.plan.count || 0) !== 3000 || fast.candidates.files === 3000,
      'plan.count=' + fast.plan.count + ' · 候选 ' + fast.candidates.files);
    ck('预演里有安全边界说明', (fast.plan.items || []).every((i) => i.tier === 'L2-cache' || i.tier === 'L3-temp'),
      JSON.stringify([...new Set((fast.plan.items || []).map((i) => i.tier))]));
    console.log('    快扫耗时 ' + fastMs + 'ms · ' + fast.stats.bytesLabel + ' · ' + fast.stats.files + ' 个文件');

    const t1 = Date.now();
    const again = await (await fetch(BASE + '/api/system-panel/atlas', { signal: AbortSignal.timeout(20000) })).json();
    ck('★ 第二次走缓存（不再重扫）', again.cached === true, 'cached=' + again.cached);
    ck('★ 缓存命中是毫秒级的', Date.now() - t1 < 1500, (Date.now() - t1) + 'ms');

    const t2 = Date.now();
    const forced = await (await fetch(BASE + '/api/system-panel/atlas?refresh=1', { signal: AbortSignal.timeout(60000) })).json();
    ck('★ refresh=1 真的绕过缓存', !forced.cached, 'cached=' + forced.cached);
    console.log('    refresh=1 重扫耗时 ' + (Date.now() - t2) + 'ms');

    console.log('\n── ② 接口：深扫（覆盖高得多）──');
    const t3 = Date.now();
    const deep = await (await fetch(BASE + '/api/system-panel/atlas?mode=deep', { signal: AbortSignal.timeout(120000) })).json();
    const deepMs = Date.now() - t3;
    ck('深扫返回 ok', deep.ok === true, JSON.stringify(deep).slice(0, 120));
    ck('★ 标了 mode=deep', deep.mode === 'deep', String(deep.mode));
    ck('★ 深扫覆盖明显大于快扫（这是它存在的理由）', (deep.stats.bytes || 0) > (fast.stats.bytes || 0) * 1.5,
      fast.stats.bytesLabel + ' → ' + deep.stats.bytesLabel);
    ck('★ 深扫根数不少于快扫', (deep.stats.rootsScanned || 0) >= (fast.stats.rootsScanned || 0),
      fast.stats.rootsScanned + ' → ' + deep.stats.rootsScanned);
    console.log('    深扫耗时 ' + deepMs + 'ms · ' + deep.stats.bytesLabel + ' · ' + deep.stats.files + ' 个文件'
      + (deep.cached ? '（命中缓存）' : ''));

    /* ── ③ 界面 ──────────────────────────────────────────────────── */
    console.log('\n── ③ 界面：打开本机管家 → 文件全景 ──');
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-system', { timeout: 20000 });
    await p.click('#btn-system'); await p.waitForTimeout(900);
    ck('本机管家打开了', await p.locator('#system-workspace').count() === 1);
    await p.locator('[data-section="atlas"]').click();
    await p.waitForTimeout(4000);
    ck('文件全景挂上了', await p.locator('.atlas-wrap').count() === 1);

    /* ★ 这一条是这次接手修掉的 bug —— 以前 mount() 只 append 不清容器，
       于是 setView() 塞进去的 4 张空骨架卡片永远留在顶上。 */
    const skel = await p.evaluate(() => {
      const body = document.getElementById('system-body');
      return { skel: !!body.querySelector(':scope > .sp-cards'), first: String(body.firstElementChild && body.firstElementChild.className) };
    });
    ck('★★ 容器里没有残留的加载骨架（那 4 个空白卡片）', skel.skel === false, JSON.stringify(skel));
    ck('★ 第一个子节点就是 atlas-wrap', skel.first === 'atlas-wrap', skel.first);

    ck('五级卡片都在', await p.locator('.atlas-card').count() === 5, String(await p.locator('.atlas-card').count()));
    ck('扫描状态条有内容', /扫描 \d+ms/.test(await txt('.atlas-bar .atlas-sub')), (await txt('.atlas-bar .atlas-sub')).slice(0, 80));

    console.log('\n── ④ 界面：大文件榜的筛选 ──');
    const topBand = p.locator('.atlas-band').first();
    ck('有「只看能动的 / 全部」两个筛选', await p.locator('.atlas-seg button').count() === 2);
    const onlyActionable = await topBand.innerText();
    ck('★ 默认「只看能动的」—— 不该出现 swapfile', !/swapfile/i.test(onlyActionable), onlyActionable.split('\n').slice(0, 3).join(' / '));
    await p.locator('.atlas-seg button').nth(1).click(); await p.waitForTimeout(800);
    const all = await topBand.innerText();
    ck('★ 切「全部」之后能看到系统级的（swapfile / Preboot）', /swapfile|Preboot|System\/Volumes/i.test(all), all.split('\n').slice(0, 3).join(' / '));
    await p.locator('.atlas-seg button').nth(0).click(); await p.waitForTimeout(800);
    ck('能切回来', !/swapfile/i.test(await topBand.innerText()));

    console.log('\n── ⑤ 界面：目录下钻 ──');
    const eb = await p.locator('.atlas-expand').count();
    ck('有「展开」按钮（服务端返回的 tree 终于用上了）', eb > 0, String(eb));
    const c0 = await p.locator('.atlas-child').count();
    await p.locator('.atlas-expand').first().click(); await p.waitForTimeout(800);
    const c1 = await p.locator('.atlas-child').count();
    ck('★ 点展开真的出现下一层', c1 === c0 + 1, c0 + ' → ' + c1);
    ck('  子项里有大小和路径', (await txt('.atlas-child')).length > 10, (await txt('.atlas-child')).slice(0, 70));
    await p.locator('.atlas-expand').first().click(); await p.waitForTimeout(800);
    ck('再点能收起', await p.locator('.atlas-child').count() === c0);

    console.log('\n── ⑥ 界面：清理预演展开 ──');
    ck('有「展开全部」', await p.locator('.atlas-more').count() === 1);
    const r0 = await p.locator('.atlas-row').count();
    await p.locator('.atlas-more').click(); await p.waitForTimeout(1000);
    const r1 = await p.locator('.atlas-row').count();
    ck('★ 展开后条目明显变多', r1 > r0 + 50, r0 + ' → ' + r1);
    ck('  文字变成「收起」', (await txt('.atlas-more')).includes('收起'), await txt('.atlas-more'));
    await p.locator('.atlas-more').click(); await p.waitForTimeout(800);
    ck('能收起来', await p.locator('.atlas-row').count() === r0);

    console.log('\n── ⑦ 界面：模式徽章与按钮 ──');
    const btns = await p.locator('.atlas-bar button').allInnerTexts();
    ck('有「快速扫描」和「深度扫描」两个按钮', btns.some((t) => /快速扫描/.test(t)) && btns.some((t) => /深度扫描/.test(t)), JSON.stringify(btns));
    ck('★ 徽章如实标着当前模式（fast）', /快速扫描/.test(await txt('.atlas-bar .atlas-pill')), await txt('.atlas-bar .atlas-pill'));

    ck('无页面异常', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅（' + pass + ' 项）');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
