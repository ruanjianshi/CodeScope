#!/usr/bin/env node
/* ⚠️ 这个探针打的是**本机正在运行的那个 CodeScope 实例** ✗ —— 需要 127.0.0.1:4877 起着 ✓，
   没有服务时**直接跳过** ✓（不算失败 ✓）。跑法：先起服务，再 node tests/life-reliability.js ✓。

   ── 它在测什么（2026-10-18）────────────────────────────────────────────────
   两件**会丢数据**的事 ✓，都不是「界面不好看」✗：

   ① **读不到 store 不能当成空数据** ✗✗
      原来：`STORE = (store && store.data) || {}` ✓ ——
      服务没起 / 网断 / 500 时 `store` 是 null ✓ → STORE 变空对象 ✓ →
      界面上「0 条备忘录 · 0 个单词」✓，用户以为**数据全丢了** ✓，
      然后随手改一个字 ✓ → 拿空壳覆盖 ✗（服务端「键数不到一半就拒收」救了这一次 ✓，
      但拒收是**静默**的 ✗ → 用户以为存上了 ✓）。
      ⇒ 现在：红条横幅 + 明说「改动不会保存」+ 重试按钮 ✓，并且**拦住存盘** ✓。

   ② **保存失败必须能看见** ✗✗
      原来 `post()` 只有 `.catch(() => { })` ✓ —— 409 / 500 / 断网一个字都不说 ✓；
      备忘录右上角还照样写「✓ 已保存」✗（那是改完就写死的 ✓，跟真实结果无关 ✓）。
      ⇒ 现在：顶栏「✗ 没存上」+ 右下角浮层（**完整**显示服务端原话 ✓）+ 重试 ✓，
        备忘录状态改成由**真实结果**驱动 ✓。

   ⚠️ 全程**不写真实数据** ✗：保存那条用 route 拦成 409 ✓，读不到那条用 route abort ✓。
   ③ **词库文件不能被「改备忘录」连累**（2026-10-19 拆分之后）——
      拆之前每次保存都要重写 12.8MB（实测 66~72ms 同步阻塞 ✗）；
      拆之后「词库没变」就**根本不碰** `life-words.json` ✓（实测 2~4ms ✓）。
      断言用**文件的 mtime**（磁盘上真的没动 ✓），不是看请求体小不小 ——
      请求体小但服务端照样重写，那是白瘦 ✗（第一版就是这样 ✗）。
   ────────────────────────────────────────────────────────────────────────── */
'use strict';
const fs = require('fs');
require('./probe-guard.js').arm();
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = [];
const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';

(async () => {
  /* 服务没起 → 跳过 ✓（别的探针也这么约定 ✓） */
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.log('跳过：127.0.0.1:4877 没有服务（' + e.message + '）');
    process.exit(0);
  }
  if (!exe) { console.log('跳过：找不到 Chrome'); process.exit(0); }

  const b = await chromium.launch({ headless: true, executablePath: exe });
  const openPanel = async (opt) => {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    if (opt && opt.abortStore) await p.route('**/api/life/store', (route) => route.abort('failed'));
    if (opt && opt.failSave) {
      await p.route('**/api/life/store', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        return route.fulfill({
          status: 409, contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: '拒绝保存：这次只提交了 3 个键，而现有数据有 40 个' }),
        });
      });
    }
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 25000 });
    await p.click('#btn-lifework');
    await p.waitForSelector('#lifework-view', { timeout: 25000 });
    await p.waitForTimeout(2200);
    return { p, errs };
  };

  try {
    /* ① 正常加载：不该出现任何失败横幅 ✓（不然下面的断言等于白过 ✓） */
    {
      const { p, errs } = await openPanel({});
      ck('正常加载时**没有**失败横幅', (await p.locator('.lw-storebar').count()) === 0);
      ck('正常加载无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
      await p.close();
    }

    /* ② 读不到 store：红条 + 明说不会保存 + 重试 */
    {
      const { p } = await openPanel({ abortStore: true });
      const info = await p.evaluate(() => {
        const el = document.querySelector('.lw-storebar');
        return el ? { cls: el.className, txt: el.innerText.replace(/\n/g, ' '), retry: !!el.querySelector('#lw-store-retry') } : null;
      });
      ck('★★ 读不到数据 → 出现**红色**横幅', !!info && /\bbad\b/.test(info.cls), info && info.cls);
      ck('★★ 横幅明说「改动不会保存」（不是只显示 0 条）', !!info && /不会保存/.test(info.txt), info && info.txt.slice(0, 90));
      ck('横幅上有「重试」', !!info && info.retry);
      await p.close();
    }

    /* ③ 保存被服务端拒绝：顶栏 + 浮层（完整原因）+ 备忘录状态不许谎报 */
    {
      const { p } = await openPanel({ failSave: true });
      await p.locator('.lw-nav [data-tab="memo"]').dispatchEvent('click');
      await p.waitForTimeout(900);
      const nb = p.locator('#lw-memo-new');
      if (await nb.count()) await nb.click();
      else await p.evaluate(() => { const t = document.querySelector('#lw-memo-title'); if (t) t.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.waitForTimeout(2600);
      const st = await p.evaluate(() => {
        const s = document.getElementById('lw-sub');
        const t = document.getElementById('lw-savetoast');
        const m = document.getElementById('lw-memo-status');
        return {
          sub: s ? s.innerText.replace(/\n/g, ' ') : '',
          subRetry: !!document.getElementById('lw-save-retry'),
          toast: t ? { on: t.classList.contains('on'), txt: t.innerText.replace(/\n/g, ' '), retry: !!t.querySelector('#lw-savetoast-retry') } : null,
          memo: m ? { txt: m.textContent.trim(), cls: m.className } : null,
        };
      });
      ck('★ 顶栏报「没存上」', /没存上/.test(st.sub), st.sub.slice(0, 60));
      ck('顶栏有「重试」', st.subRetry);
      ck('★★ 浮层**完整**显示服务端原话（顶栏会被 ellipsis 截断）', !!st.toast && st.toast.on && /拒绝保存/.test(st.toast.txt), st.toast && st.toast.txt.slice(0, 90));
      ck('浮层有「重试」', !!st.toast && st.toast.retry);
      ck('★★ 备忘录右上角**不再谎报「已保存」**', !!st.memo && /没存上/.test(st.memo.txt) && !/已保存/.test(st.memo.txt), st.memo && (st.memo.txt + ' / ' + st.memo.cls));
      await p.close();
    }
    /* ④ 全局错误兜底：一个没被 catch 的异步错误必须**看得见** ✓
       ⚠️ 这个项目有 54 处 `.catch(() => {})` ✓ —— 真正的问题会被一起吞掉 ✗，
          表现就是「点了没反应」而控制台以外毫无信号 ✗（今天连踩两次）。 */
    {
      const { p } = await openPanel({});
      const before = await p.evaluate(() => (window.__CS_ERRORS || []).length);
      await p.evaluate(() => { Promise.reject(new Error('探针故意炸一下')); });
      await p.waitForTimeout(700);
      const after = await p.evaluate(() => ({
        n: (window.__CS_ERRORS || []).length,
        last: (window.__CS_ERRORS || []).slice(-1)[0] || null,
        toast: (() => { const t = document.getElementById('lw-savetoast'); return t && t.classList.contains('on') ? t.innerText.replace(/\n/g, ' ') : ''; })(),
      }));
      ck('★★ 未处理的异步错误被记进 __CS_ERRORS', after.n === before + 1 && /探针故意炸一下/.test((after.last && after.last.msg) || ''),
        JSON.stringify(after.last));
      ck('★★ 同时**弹一次**提示（不是只在控制台）', /有个功能出错了/.test(after.toast) && /探针故意炸一下/.test(after.toast),
        after.toast.slice(0, 80));
      await p.close();
    }

    /* ⑤ 生词列表**不能一次性建完** ✓（4611 个词时那是 2.26MB / 32100 节点 / 838ms ✗） */
    {
      const { p } = await openPanel({});
      const r = await p.evaluate(() => {
        const el = document.querySelector('.lw-nav [data-tab="reading"]');
        if (!el) return null;
        const t0 = performance.now();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { ms: Math.round(performance.now() - t0), rows: document.querySelectorAll('.lw-wd-row').length };
      });
      ck('★★ 切到「阅读」的同步阻塞 < 400ms（原来 838ms）', !!r && r.ms < 400, r && (r.ms + 'ms'));
      ck('★★ 首屏只建前 150 行（剩下的分片补）', !!r && r.rows > 0 && r.rows <= 300, r && (r.rows + ' 行'));
      /* 等分片补完 → 列表必须是**完整的** ✓（分片不能丢词 ✗） */
      await p.waitForTimeout(4000);
      const after = await p.evaluate(() => document.querySelectorAll('.lw-wd-row').length);
      ck('★ 分片补完之后列表是完整的（不丢词）', after >= (r ? r.rows : 0) && after > 300, after + ' 行');
      await p.close();
    }
    /* ⑥ 拆文件之后：改备忘录**不许动** life-words.json ✓，改词才动 ✓ */
    {
      const os = require('os');
      const pathMod = require('path');
      const fsMod = require('fs');
      const wordsFile = pathMod.join(os.homedir(), 'Library/Application Support/CodeScope/life-words.json');
      if (!fsMod.existsSync(wordsFile)) {
        console.log('  · 跳过：这台机器上还没有 life-words.json（旧结构 / 非 macOS）');
      } else {
        const { p } = await openPanel({});
        const posts = [];
        p.on('request', (r) => { if (r.url().includes('/api/life/store') && r.method() === 'POST') posts.push(r.postData() || ''); });
        const t0 = fsMod.statSync(wordsFile).mtimeMs;
        /* ① 改备忘录（词库没变）→ 只发小包，词库文件**一个字节都不动** */
        await p.locator('.lw-nav [data-tab="memo"]').dispatchEvent('click');
        await p.waitForTimeout(800);
        const nb = p.locator('#lw-memo-new');
        if (await nb.count()) await nb.click();
        await p.waitForTimeout(500);
        await p.evaluate(() => { const t = document.querySelector('#lw-memo-title'); if (t) { t.value = '探针 拆分校验'; t.dispatchEvent(new Event('input', { bubbles: true })); } });
        await p.waitForTimeout(1800);
        const small = posts.length ? posts[posts.length - 1] : '';
        const t1 = fsMod.statSync(wordsFile).mtimeMs;
        ck('★★ 改备忘录时请求体很小（词库没跟着传）', small.length > 0 && small.length < 500 * 1024,
          Math.round(small.length / 1024) + 'KB');
        ck('★★ 而且 life-words.json **完全没被重写**（mtime 不变）', t0 === t1,
          t0 + ' → ' + t1);
        await p.close();
      }
    }
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
