#!/usr/bin/env node
/* 微信读书「连接」的端到端探针 ✓ —— 打本机真实实例（127.0.0.1:4877 ✓），没起就跳过 ✓。
   ★★ API Key **从环境变量读** ✗✗（`WEREAD_KEY=wrk-xxx node tests/life-weread.js`）——
      绝不写进仓库 ✗：这是个**凭据** ✓，提交上去等于泄露 ✓。
      没给就只跑「不依赖真 Key」的那几段 ✓（面板结构 / 错误提示 / Cookie 兜底 ✓），
      不假装通过 ✗。
   ⚠️ 探针会**改用户的 STORE** ✗（连接状态 + 书架）—— 所以 finally 里
      把 `wereadKey / wereadCookie / wereadVia / wereadSyncAt / wereadCount / books`
      全部**原样还原** ✓（按值备份 ✓，不是「删掉」✗）。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const KEY = String(process.env.WEREAD_KEY || '').trim();
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};
const put = async (d) => fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  /* 备份 ✓（按值备份 ✗ —— 只记「有没有」的话还原不回去 ✗） */
  const snap = await store();
  const backup = {
    wereadKey: snap.wereadKey, wereadCookie: snap.wereadCookie, wereadVia: snap.wereadVia,
    wereadSyncAt: snap.wereadSyncAt, wereadCount: snap.wereadCount, books: snap.books,
    bookSel: snap.bookSel, readMode: snap.readMode,
  };
  const booksBefore = JSON.stringify(snap.books || []);

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const txt = async (s) => { const l = p.locator(s); return (await l.count()) ? (await l.first().innerText()).replace(/\n/g, ' ').trim() : '(没有)'; };
  /* ⚠️ 「重置连接状态」和「打开面板」要**分开** ✗ ——
     合在一起的话，第一次调用时页面还没导航过去 ✗，
     `waitForSelector('#lw-wrc')` 会白等 15 秒然后超时 ✗（实测踩过 ✗）。 */
  const resetConn = async () => {
    const d = await store();
    /* ⚠️ 这里是**显式置空**（不是 `delete`）✗ —— 服务端会保住「整份覆盖里没带的」
       凭据字段 ✓（`GUARDED_STORE_KEYS`，见 server.js ✓）；
       `delete` 会被当成「这个客户端不知道有它」✗ → 原样保住 ✗ → 探针假失败 ✓。
       带字段 + 空串 = 「我就是要清掉」✓，服务端认这个 ✓。 */
    d.wereadKey = ''; d.wereadCookie = ''; d.wereadVia = '';
    await put(d);
  };
  const openPanel = async () => {
    /* ⚠️⚠️ 先切回**书架**模式 ✗✗ —— 「🔗 微信读书」按钮在**书架**那一栏里 ✓，
       而阅读模块的当前模式是**落盘的** ✗（`STORE.readMode` ✓）——
       上一轮探针停在「外刊精读 / 生词本」的话，这个按钮**根本没渲染** ✗ →
       `waitForSelector('#lw-wrc')` 白等 15 秒超时 ✗（实测踩过 ✓）。
       这类「模式是落盘的」假失败在这个项目里踩过不止一次了 ✓。 */
    await p.evaluate(() => {
      const el = document.querySelector('[data-rdmode="shelf"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await p.waitForTimeout(1200);
    await p.evaluate(() => {
      const el = document.querySelector('#lw-rd-sync');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await p.waitForSelector('#lw-wrc', { timeout: 15000 });
    await p.waitForTimeout(600);
  };

  try {
    /* 先断开，保证「点按钮 = 打开面板」而不是直接同步 ✓ */
    await resetConn();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.locator('.lw-nav [data-tab="reading"]').dispatchEvent('click');
    await p.waitForSelector('.lw-rd', { timeout: 20000 }); await p.waitForTimeout(1200);

    console.log('\n── ① 连接面板：两条路都在 ──');
    await openPanel();
    ck('面板开了', await p.locator('#lw-wrc').count() === 1);
    ck('★ 有两个页签（API Key / Cookie）',
      await p.locator('[data-wrtab="key"]').count() === 1 && await p.locator('[data-wrtab="cookie"]').count() === 1);
    ck('★ 默认停在「API Key」（推荐的那条）',
      await p.locator('[data-wrtab="key"].on').count() === 1, await txt('.lw-imp .hd'));
    const keyTxt = await txt('.lw-imp .bd');
    console.log('    Key 页文案: ' + JSON.stringify(keyTxt.slice(0, 110)));
    ck('★ 说清了这是**官方**接口', /官方/.test(keyTxt));
    ck('★ 说了去哪拿 Key（快速配置页 / 官方仓库）', /快速配置|Tencent\/WeChatReading/.test(keyTxt));
    ck('★ 有 Key 输入框', await p.locator('#lw-wrc-key').count() === 1);
    ck('★ 说清了「不会因为网页登出就失效」', /登出/.test(keyTxt), keyTxt.slice(0, 140));

    console.log('\n── ② Cookie 那一页（兜底）也还在 ──');
    await p.locator('[data-wrtab="cookie"]').click(); await p.waitForTimeout(700);
    const ckTxt = await txt('.lw-imp .bd');
    ck('★ 切得过去', await p.locator('#lw-wrc-tx').count() === 1);
    ck('★ 老的四步教程还在（没被删掉）', /F12/.test(ckTxt) && /Cookie:/.test(ckTxt));
    ck('★★ 明确警告「网页版一登出就失效」（就是用户撞上的那个）', /登出/.test(ckTxt) && /失效/.test(ckTxt), ckTxt.slice(0, 160));
    ck('★ 页脚说清了这条是非官方、可能失效', /非官方/.test(await txt('.lw-imp .ft')));

    console.log('\n── ③ 错误提示要能照着修（不依赖真 Key）──');
    await p.locator('[data-wrtab="key"]').click(); await p.waitForTimeout(500);
    await p.locator('#lw-wrc-key').fill('abc-not-a-key'); await p.waitForTimeout(400);
    await p.click('#lw-wrc-go'); await p.waitForTimeout(1500);
    const err1 = await txt('#lw-wrc-st');
    console.log('    填错格式 → ' + JSON.stringify(err1.slice(0, 90)));
    ck('★ 格式不对时**本地就拦掉**（没白跑网络）+ 说清要 wrk- 开头', /wrk-/.test(err1), err1.slice(0, 90));
    await p.locator('#lw-wrc-key').fill('wrk-thisIsDefinitelyNotARealKey000'); await p.waitForTimeout(400);
    await p.click('#lw-wrc-go');
    await p.waitForFunction(() => {
      const e = document.getElementById('lw-wrc-st');
      return e && e.textContent && !/正在连/.test(e.textContent);
    }, null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(800);
    const err2 = await txt('#lw-wrc-st');
    console.log('    假 Key → ' + JSON.stringify(err2.slice(0, 110)));
    ck('★★ 假 Key 给的是**人话 + 下一步**（不是原始 JSON）',
      /Key/.test(err2) && !/errcode.*\{/.test(err2), err2.slice(0, 110));
    ck('  错误提示里带着「怎么办」', /重新|重置|复制|快速配置/.test(err2), err2.slice(0, 110));

    if (!KEY) {
      console.log('\n── ④ 真 Key 那一段：**跳过**（没给 WEREAD_KEY 环境变量）──');
      console.log('    ⚠️ 没给就**不假装通过** ✗ —— 要跑真 Key 就：');
      console.log('       WEREAD_KEY=wrk-xxx node tests/life-weread.js');
    } else {
      console.log('\n── ④ 真 Key：连上并同步 ──');
      await p.locator('#lw-wrc-key').fill(KEY); await p.waitForTimeout(400);
      await p.click('#lw-wrc-go');
      await p.waitForFunction(() => {
        const e = document.getElementById('lw-wrc-st');
        return e && e.textContent && /同步成功|✗|失败/.test(e.textContent);
      }, null, { timeout: 90000 }).catch(() => {});
      await p.waitForTimeout(1200);
      const okTxt = await txt('#lw-wrc-st');
      console.log('    结果: ' + JSON.stringify(okTxt.slice(0, 140)));
      ck('★★ 用官方 Key 同步成功', /同步成功/.test(okTxt), okTxt.slice(0, 140));
      ck('★ 状态里写明走的是「官方 API Key」', /官方 API Key/.test(await txt('.lw-imp .bd')), await txt('#lw-wrc-st'));
      /* 服务端确认 ✓ */
      const d = await store();
      ck('★ Key 落盘了（下次不用再填）', !!String(d.wereadKey || '').trim());
      ck('★ 记下了走的是哪条路', d.wereadVia === 'key', String(d.wereadVia));
      const wb = (d.books || []).filter((x) => x && x.src === 'weread');
      console.log('    同步进来 ' + wb.length + ' 本：' + wb.map((x) => x.title + '(' + x.prog + '%)').join(' · '));
      ck('★★ 书真的进了书架', wb.length > 0, String(wb.length));
      /* ★ 进度口径：官方是 0~100 整数，1 就是 1% ✗（不是 100% ✗）——
         这条以前在 Cookie 那条路上会算成 10000% ✗ / 显示成「已读完」✗。 */
      const odd = wb.filter((x) => Number(x.prog) > 100 || (Number(x.prog) === 0 && x.status === 'done'));
      ck('★★ 进度口径没算错（没有 >100% 或「0% 却已读完」）', odd.length === 0, JSON.stringify(odd.map((x) => x.title + ':' + x.prog)));
      const low = wb.filter((x) => Number(x.prog) > 0 && Number(x.prog) < 100);
      ck('★ 部分阅读的书**没有**被误标成「已读完」',
        low.every((x) => x.status !== 'done'), JSON.stringify(low.map((x) => x.title + ':' + x.prog + '/' + x.status)));
      ck('★ 带回了官方多给的字段（分类 / 跳转链接）',
        wb.some((x) => x.category) && wb.some((x) => /^https:\/\//.test(x.deepLink || '')),
        JSON.stringify(wb.map((x) => x.category).slice(0, 3)));

      /* 断开要能断干净 ✓ */
      console.log('\n── ⑤ 断开连接 ──');
      p.on('dialog', async (dl) => { await dl.accept(); });
      await openPanel();
      await p.click('#lw-wrc-off'); await p.waitForTimeout(1200);
      const d2 = await store();
      ck('★★ 断开把**两条路**都清了（只清 Cookie 会「怎么还连着」）',
        !String(d2.wereadKey || '').trim() && !String(d2.wereadCookie || '').trim(),
        'key=' + JSON.stringify(d2.wereadKey) + ' cookie=' + JSON.stringify(d2.wereadCookie));
    }

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      /* 原样还原 ✓（按值 ✗） */
      ['wereadKey', 'wereadCookie', 'wereadVia', 'wereadSyncAt', 'wereadCount', 'books', 'bookSel', 'readMode']
        .forEach((k) => { if (backup[k] === undefined) delete d[k]; else d[k] = backup[k]; });
      await put(d);
      const a = await store();
      const same = JSON.stringify(a.books || []) === booksBefore;
      console.log('\n收尾：连接状态已还原 ✓ · 书架' + (same ? '也原样还原 ✓' : '**和原来不一样** ✗'));
      if (!same) fails.push('书架没还原');
    } catch (e) { console.log('\n收尾失败: ' + e.message); fails.push('收尾失败'); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
