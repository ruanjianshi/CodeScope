#!/usr/bin/env node
/* ⚠️ 这个探针打的是**本机正在运行的那个 CodeScope 实例** ✗ —— 需要 127.0.0.1:4877 起着 ✓，
   所以**故意不进 npm test** ✗（没有服务时会自动跳过 ✓，不会误报失败 ✓）。
   跑法：先起服务，再 node tests/life-drag.js ✓。
   ★ 它只改 STORE 里的宽度字段 ✓，finally 里会删掉恢复默认 ✓。

   ── 它在测什么 ────────────────────────────────────────────────────────────
   用户报的 bug：「我鼠标点击后拖动，后续重新鼠标移动到这，自动莫名的拖动了，
   没有点击去要拖动，他还是拖动了」。

   根因：拖动会话是「按下时往 document 挂 mousemove / mouseup」✗，
   而**松手如果没落在 document 上**（窗口外 / 浏览器边框 / 系统菜单 ✗），
   `mouseup` 永远到不了 ✗ → `move` 一直挂着 ✗ → 之后鼠标**经过**就在拖 ✗✗。

   这个探针就复现这条路径 ✓：
     ① pointerdown（按下）
     ② pointermove（拖）
     ③ ⚠️ **不派发 pointerup** ✗ —— 改派一个 `buttons: 0` 的 pointermove ✓
        （真实鼠标松手之后，下一个 move 必然是这个 ✗）
     ④ 再派几个「没按键的移动」✓
     ⑤ ★ 断言：宽度**一点都不能变** ✗✗（修好之前，这里会一路跟着鼠标跑 ✗）
   ──────────────────────────────────────────────────────────────────────── */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = []; const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';
const store = async () => ((await (await fetch(BASE + '/api/life/store', { cache: 'no-store' })).json()).data) || {};

/* 页面里装一个通用的「抓握探针」✓ */
const INSTALL = () => {
  window.__grab = (g, pane, axis) => {
    const grip = document.querySelector(g), el = document.querySelector(pane);
    if (!grip || !el) return { err: '找不到 ' + g + ' 或 ' + pane };
    const size = () => Math.round(axis === 'y' ? el.getBoundingClientRect().height : el.getBoundingClientRect().width);
    const mk = (type, x, y, buttons, button) => new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, buttons,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: button === undefined ? (type === 'pointerdown' ? 0 : -1) : button,
    });
    const r = grip.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const out = { before: size() };
    /* ① 按下 + 拖 ✓ */
    grip.dispatchEvent(mk('pointerdown', x0, y0, 1));
    document.dispatchEvent(mk('pointermove', x0 + 60, y0 + 40, 1));
    out.afterDrag = size();
    /* ② ★ 关键：**不派 pointerup** ✗，改派 buttons:0 的 move（= 真实松手后的下一帧 ✓）*/
    document.dispatchEvent(mk('pointermove', x0 + 60, y0 + 40, 0));
    out.afterRelease = size();
    /* ③ 之后乱移（还是没按键）→ 必须纹丝不动 ✗✗ */
    document.dispatchEvent(mk('pointermove', x0 + 200, y0 + 40, 0));
    document.dispatchEvent(mk('pointermove', x0 + 340, y0 + 40, 0));
    out.afterStray = size();
    /* 清干净 ✓（免得污染后面的用例 ✓）*/
    document.dispatchEvent(mk('pointerup', x0, y0, 0));
    return out;
  };
};

(async () => {
  try { const r = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('x'); }
  catch (_) { console.log('（跳过：本机 127.0.0.1:4877 没在跑 —— 这个探针需要真实实例 ✓）'); process.exit(0); }

  const b = await chromium.launch({ executablePath: exe, headless: true });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const grab = (g, pane, axis) => p.evaluate(({ g, pane, axis }) => window.__grab(g, pane, axis), { g, pane, axis: axis || 'x' });

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 20000 });
    await p.click('#btn-lifework'); await p.waitForSelector('#lifework-view', { timeout: 20000 });
    await p.waitForSelector('.lw-nav', { timeout: 20000 });
    await p.evaluate(INSTALL);

    const check = async (title, gripSel, paneSel, axis) => {
      const r = await grab(gripSel, paneSel, axis);
      if (r.err) { ck(title, false, r.err); return; }
      console.log('    ' + title + ' → ' + JSON.stringify(r));
      ck(title + '：能拖动', r.afterDrag !== r.before, '拖了却没变（' + r.before + ' → ' + r.afterDrag + '）');
      ck(title + '：★ 丢 up 之后乱移**不再拖**', r.afterStray === r.afterRelease,
        '松手后还在跟着跑：' + r.afterRelease + ' → ' + r.afterStray);
    };

    console.log('── ① 邮箱三栏的两条拖拽条 ──');
    await p.locator('.lw-nav [data-tab="mail"]').dispatchEvent('click');
    await p.waitForSelector('.lw-ml-item', { timeout: 60000 });
    await p.waitForTimeout(1500);
    await check('邮箱·账号栏', '[data-mlgrip="side"]', '.lw-ml-side');
    await check('邮箱·邮件列表', '[data-mlgrip="list"]', '.lw-ml-list');

    console.log('\n── ② 备忘录三栏 ──');
    await p.locator('.lw-nav [data-tab="memo"]').dispatchEvent('click');
    await p.waitForTimeout(2000);
    await check('备忘录·左栏', '[data-mgrip="side"]', '.lw-nt-side');
    await check('备忘录·列表', '[data-mgrip="list"]', '.lw-nt-list');

    console.log('\n── ③ 工作流画布上的节点 ──');
    await p.locator('.lw-nav [data-tab="flow"]').dispatchEvent('click');
    await p.waitForTimeout(1500);
    if (!(await p.locator('.lw-fl-node').count())) {
      p.once('dialog', (d) => d.accept('__拖动探针__'));
      await p.locator('#lw-fl-new').click().catch(() => {});
      await p.waitForTimeout(1500);
      await p.locator('[data-fladd="trigger.manual"]').click().catch(() => {});
      await p.waitForTimeout(1500);
    }
    if (await p.locator('.lw-fl-node').count()) {
      const r = await p.evaluate(() => {
        const el = document.querySelector('.lw-fl-node');
        const mk = (type, x, y, buttons) => new PointerEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, buttons,
          pointerId: 2, pointerType: 'mouse', isPrimary: true, button: type === 'pointerdown' ? 0 : -1,
        });
        /* ⚠️ 每次**重新查** ✗ —— up 里会 render()，旧元素会被换成新的 ✗，
           抓着旧引用量的话，松手后量到的是**已脱离文档的 0** ✗，断言就白测了 ✗（实测踩过 ✗）。 */
        const left = () => Math.round((document.querySelector('.lw-fl-node') || el).getBoundingClientRect().left);
        const r0 = el.getBoundingClientRect();
        const out = { before: left() };
        el.dispatchEvent(mk('pointerdown', r0.left + 60, r0.top + 10, 1));
        document.dispatchEvent(mk('pointermove', r0.left + 140, r0.top + 60, 1));
        out.afterDrag = left();
        document.dispatchEvent(mk('pointermove', r0.left + 140, r0.top + 60, 0));
        out.afterRelease = left();
        document.dispatchEvent(mk('pointermove', r0.left + 300, r0.top + 60, 0));
        out.afterStray = left();
        document.dispatchEvent(mk('pointerup', r0.left, r0.top, 0));
        return out;
      });
      console.log('    工作流·节点 → ' + JSON.stringify(r));
      ck('工作流·节点：能拖动', r.afterDrag !== r.before, JSON.stringify(r));
      ck('工作流·节点：★ 丢 up 之后乱移**不再拖**', r.afterStray === r.afterRelease, r.afterRelease + ' → ' + r.afterStray);
    } else {
      ck('工作流·节点：能建出节点来测', false, '一个节点都没有');
    }

    console.log('\n── ④ 正常路径（有 up）不能被误伤 ──');
    await p.locator('.lw-nav [data-tab="mail"]').dispatchEvent('click');
    await p.waitForSelector('.lw-ml-item', { timeout: 60000 });
    await p.waitForTimeout(1500);
    const normal = await p.evaluate(() => {
      const grip = document.querySelector('[data-mlgrip="side"]'), el = document.querySelector('.lw-ml-side');
      const w = () => Math.round(el.getBoundingClientRect().width);
      const mk = (type, x, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: 300, buttons,
        pointerId: 3, pointerType: 'mouse', isPrimary: true, button: type === 'pointerdown' ? 0 : -1,
      });
      const r = grip.getBoundingClientRect(), x0 = r.left + r.width / 2;
      const out = { before: w() };
      grip.dispatchEvent(mk('pointerdown', x0, 1));
      document.dispatchEvent(mk('pointermove', x0 + 50, 1));
      out.afterDrag = w();
      document.dispatchEvent(mk('pointerup', x0 + 50, 0));
      out.afterUp = w();
      document.dispatchEvent(mk('pointermove', x0 + 250, 0));
      out.afterStray = w();
      return out;
    });
    console.log('    邮箱·账号栏（正常路径）→ ' + JSON.stringify(normal));
    ck('正常拖动生效', normal.afterDrag !== normal.before, JSON.stringify(normal));
    ck('★ 松手（有 up）之后乱移也不动', normal.afterStray === normal.afterUp, normal.afterUp + ' → ' + normal.afterStray);

    console.log('\n── ⑤ 右键按下不该开始拖动 ──');
    const rmb = await p.evaluate(() => {
      const grip = document.querySelector('[data-mlgrip="side"]'), el = document.querySelector('.lw-ml-side');
      const w = () => Math.round(el.getBoundingClientRect().width);
      const mk = (type, x, buttons, button) => new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: 300, buttons,
        pointerId: 4, pointerType: 'mouse', isPrimary: true, button,
      });
      const r = grip.getBoundingClientRect(), x0 = r.left + r.width / 2;
      const out = { before: w() };
      grip.dispatchEvent(mk('pointerdown', x0, 2, 2));
      document.dispatchEvent(mk('pointermove', x0 + 90, 2, -1));
      out.afterRmbDrag = w();
      document.dispatchEvent(mk('pointerup', x0 + 90, 0, 2));
      return out;
    });
    ck('★ 右键按下不开始拖动', rmb.afterRmbDrag === rmb.before, rmb.before + ' → ' + rmb.afterRmbDrag);

    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    console.log('✗ 异常: ' + e.message); fails.push('异常:' + e.message);
  } finally {
    try {
      const d = await store();
      delete d.mailSideW; delete d.mailListW; delete d.memoSideW; delete d.memoListW;
      delete d.journalLeftW; delete d.journalEditH; delete d.flowSel;
      d.flows = (d.flows || []).filter((x) => !String(x.name).includes('__拖动探针__'));
      await fetch(BASE + '/api/life/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const a = await store();
      console.log('\n收尾：宽度字段已清 ✓ | 工作流 ' + (a.flows || []).length + ' 个 · 备忘录 ' + (a.memos || []).length + ' 条');
    } catch (e) { console.log('\n收尾失败: ' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
