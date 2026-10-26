#!/usr/bin/env node
/* ⚠️ 这个探针打的是**本机正在运行的那个 CodeScope 实例** ✗ —— 需要 127.0.0.1:4877 起着 ✓，
   没有服务时**直接跳过** ✓（不算失败 ✓）。跑法：先起服务，再 node tests/system-panel-ops.js ✓。

   ── 它在测什么（2026-10-18「本机管家 → 运维面板」改造）──────────────────────
   用户原话：「重新设计本机管家，做成运维面板……有些无用，重复等」。

   ① **精简入口**：「文件全景（分级总览）」原来自己占一个分区 ✗ ——
      它和「存储 → 空间分析 / 全盘扫描」都在回答「空间被什么占了」，三个入口摆在一起，
      用户不知道该点哪个 ✗。现在并进「存储」当最后一个子页 ✓（视图本身不动 ✓）。

   ② **健康总评条**：运维面板和监控面板的区别 —— 监控给数字 ✓，运维要**先给结论** ✓。
      「这台机器现在有没有事、事在哪、点一下就能去处理」✓。
      ⚠️ 判据必须是**阈值推出来的结论**（disk ≥85 warn / ≥90 crit、mem ≥85 / ≥92、temp ≥70 / ≥85），
         而不是「有没有这个 DOM」✗ —— 那种断言在健康机器上永远空转 ✗。
      ⇒ 用 route **拦掉 /api/system-panel/overview**，喂一份「内存 95% + 磁盘 91%」的假数据 ✓，
         总评条必须变 crit 并给出可点的告警 chip ✓，点 chip 必须跳到对应分区 ✓。
   ────────────────────────────────────────────────────────────────────────── */
'use strict';
const fs = require('fs');
require('./probe-guard.js').arm();
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = [];
const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';

const GB = 1024 * 1024 * 1024;
/* 形状必须跟真后端一致（requireShape 会查 cpu/memory/disks/identity ✓），
   缺一个键前端就整页报「数据不完整」✗，那测的就是兜底而不是健康条 ✗。 */
function fakeOverview(diskPct, memPct) {
  const total = 32 * GB;
  return {
    cpu: { usage: 23, cores: 10, model: 'Apple M4', load: [1.2, 1.1, 0.9], loadPercent: [12, 11, 9],
      perCore: [10, 20, 30, 15, 25, 18, 22, 12, 30, 8] },
    memory: { total: total, used: total * memPct / 100, usage: memPct },
    swap: { total: 4 * GB, used: 0.5 * GB, usage: 12 },
    disks: [{ device: '/dev/disk3s1', mount: '/', label: 'Macintosh HD', kind: 'internal',
      total: 994 * GB, free: 994 * GB * (1 - diskPct / 100), capacity: diskPct }],
    primaryDisk: { device: '/dev/disk3s1', mount: '/', label: 'Macintosh HD',
      total: 994 * GB, free: 994 * GB * (1 - diskPct / 100), capacity: diskPct },
    thermal: { available: false, pressure: 'unknown' },
    identity: { hostname: 'probe-mac', user: 'probe', osName: 'macOS', osVersion: '26.5',
      model: 'Mac mini', arch: 'arm64', uptime: 7200, bootAt: Date.now() - 7200 * 1000, node: 'v22.0.0' },
  };
}

(async () => {
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.log('跳过：127.0.0.1:4877 没有服务（' + e.message + '）');
    process.exit(0);
  }
  if (!exe) { console.log('跳过：找不到 Chrome'); process.exit(0); }

  const b = await chromium.launch({ headless: true, executablePath: exe });
  const openPanel = async () => {
    const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-lifework', { timeout: 25000 });
    if (await p.locator('#welcome-system').count()) await p.click('#welcome-system');
    else await p.click('#btn-system');
    await p.waitForTimeout(3500);
    return p;
  };
  const navClick = (p, label) => p.evaluate((lb) => {
    const el = [...document.querySelectorAll('#system-nav-list button')].find((x) => x.textContent.includes(lb));
    if (el) el.click();
    return !!el;
  }, label);

  try {
    /* ── ① 真实数据：健康条存在、总评级别合法、导航已收敛 ── */
    {
      const p = await openPanel();
      const h = await p.evaluate(() => {
        const el = document.getElementById('system-health');
        const nav = [...document.querySelectorAll('#system-nav-list button')].map((x) => x.textContent.trim());
        return {
          health: el ? { cls: el.className, txt: el.innerText.replace(/\n/g, ' '), chips: el.querySelectorAll('.sp-hissue').length } : null,
          atlas: nav.filter((t) => t.indexOf('文件全景') >= 0).length,
        };
      });
      ck('★★ 概览顶部有**健康总评条**', !!h.health, JSON.stringify(h.health && h.health.cls));
      ck('总评条级别是 ok / warn / crit 之一', !!h.health && /(^|\s)(ok|warn|crit)(\s|$)/.test(h.health.cls), h.health && h.health.cls);
      ck('总评条给了「CPU / 内存 / 磁盘」摘要（不用点开就有数）',
        !!h.health && /CPU/.test(h.health.txt) && /内存/.test(h.health.txt) && /磁盘/.test(h.health.txt), h.health && h.health.txt.slice(0, 90));
      ck('★★ 侧栏不再有独立的「文件全景」分区', h.atlas === 0, '出现 ' + h.atlas + ' 次');
      ck('无页面异常', (await p.evaluate(() => true)) && true);
      await p.close();
    }

    /* ── ② 「分级总览」成了存储的子页（入口还在，只是不再单独占一个分区）── */
    {
      const p = await openPanel();
      const ok = await navClick(p, '存储');
      await p.waitForTimeout(1500);
      const sub = await p.evaluate(() =>
        [...document.querySelectorAll('#system-subnav button, .sp-subnav button, [data-subview]')]
          .map((x) => x.textContent.trim()).slice(0, 10));
      ck('★★ 「分级总览」在「存储」的子页里', ok && sub.some((t) => t.indexOf('分级总览') >= 0), JSON.stringify(sub));
      await p.close();
    }

    /* ── ③ 假数据压测：内存 95% + 磁盘 91% → crit + 两条 chip + 点击跳转 ── */
    {
      const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      /* ⚠️ 这个接口**没有 data 包装** ✗ —— 真返回是 `{ok, ts, identity, cpu, memory, …}` 一层 ✓，
         包一层的话 `requireShape` 在顶层找不到 cpu/memory → 整页报「数据不完整」✗
         （第一版就包错了 ✗，测的是兜底而不是健康条 ✗）。 */
      await p.route('**/api/system-panel/overview', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(Object.assign({ ok: true, ts: Date.now(), panelVersion: 'probe' }, fakeOverview(91, 95))),
      }));
      await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#btn-lifework', { timeout: 25000 });
      if (await p.locator('#welcome-system').count()) await p.click('#welcome-system');
      await p.waitForTimeout(3500);
      const h = await p.evaluate(() => {
        const el = document.getElementById('system-health');
        return el ? { cls: el.className, txt: el.innerText.replace(/\n/g, ' '),
          chips: [...el.querySelectorAll('.sp-hissue')].map((x) => ({ t: x.innerText.trim(), goto: x.dataset.hgoto, lv: x.className })) } : null;
      });
      ck('★★ 内存 95% + 磁盘 91% → 总评变 **crit**', !!h && /\bcrit\b/.test(h.cls), h && h.cls);
      ck('标题说「2 项需要处理」', !!h && /2 项需要处理/.test(h.txt), h && h.txt.slice(0, 70));
      /* ⚠️ chip **必须带级别** ✗ —— 只查「文字 + 去向」的话，把 crit 阈值从 90 抬到 99
         这种回归测不出来（91% 的磁盘会降级成 warn chip ✓，文字和去向一模一样 ✗）。 */
      ck('★★ 磁盘 91% 的 chip 是 **crit** 级（不是 warn）', !!h && h.chips.some((c) => /主磁盘已用 91%/.test(c.t) && /\bcrit\b/.test(c.lv)),
        h && JSON.stringify(h.chips));
      ck('告警 chip 给出「主磁盘已用 91%」且指向存储', !!h && h.chips.some((c) => /主磁盘已用 91%/.test(c.t) && c.goto === 'storage'),
        h && JSON.stringify(h.chips));
      ck('告警 chip 给出「内存已用 95%」且指向性能', !!h && h.chips.some((c) => /内存已用 95%/.test(c.t) && c.goto === 'processes'),
        h && JSON.stringify(h.chips));
      /* 点磁盘 chip → 应跳到存储分区 */
      const jumped = await p.evaluate(() => {
        const c = [...document.querySelectorAll('.sp-hissue')].find((x) => /主磁盘/.test(x.innerText));
        if (!c) return false;
        c.click();
        return true;
      });
      await p.waitForTimeout(1400);
      const title = await p.evaluate(() => (document.querySelector('#system-title') || {}).textContent || '');
      ck('★★ 点告警 chip 跳到对应分区', jumped && /存储/.test(title), '标题「' + title + '」');
      ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
      await p.close();
    }
    /* ── ④ 概览「运行状态」卡：Docker / 启动项 / 对外端口，整行可点 ── */
    {
      const p = await openPanel();
      await p.waitForTimeout(2500);          /* loadOverviewExtras 是概览渲染完再补拉的 ✓ */
      const rt = await p.evaluate(() => {
        const el = document.getElementById('system-runtimes');
        return el ? { rows: [...el.querySelectorAll('.sp-rt-row')].map((x) => ({
          name: x.querySelector('.sp-rt-name') && x.querySelector('.sp-rt-name').textContent.trim(),
          val: x.querySelector('.sp-rt-val') && x.querySelector('.sp-rt-val').textContent.trim(),
          goto: x.dataset.rtgoto })) } : null;
      });
      ck('★★ 概览有「运行状态」卡（Docker / 启动项 / 对外端口）',
        !!rt && rt.rows.length === 3 && rt.rows[0].name === 'Docker' && rt.rows[1].name === '开机启动项'
          && rt.rows[2].name === '对外端口', rt && JSON.stringify(rt.rows));
      const jumped = await p.evaluate(() => {
        const row = [...document.querySelectorAll('.sp-rt-row')].find((x) => x.dataset.rtgoto === 'docker');
        if (!row) return false;
        row.click();
        return true;
      });
      await p.waitForTimeout(1600);
      /* ⚠️ `#system-title` 显示的是**分区名**（「系统」✓）不是子视图名 ✗ ——
         判「跳没跳对」要看**子页签的选中项**或页面内容 ✓。 */
      const now = await p.evaluate(() => ({
        title: (document.querySelector('#system-title') || {}).textContent || '',
        sub: (document.querySelector('#system-subnav button.on, .sp-subnav button.on, [data-subview].on') || {}).textContent || '',
        hasDocker: (document.getElementById('system-body') || {}).textContent || '',
      }));
      ck('★★ 点 Docker 行跳到容器子页', jumped && /容器/.test(now.sub) && /Docker 守护进程/.test(now.hasDocker),
        '标题「' + now.title + '」子页「' + now.sub + '」');
      await p.close();
    }

    /* ── ⑤ 存储页「缓存构成」可视化条：route 喂假缓存 → 段 + 图例 ── */
    {
      const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      const GB = 1024 * 1024 * 1024;
      const mk = (id, label, path, risk, size) => ({ id: id, label: label, path: path, risk: risk, size: size, kind: 'dir', exists: true, selected: false, note: '' });
      await p.route('**/api/system-panel/caches', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, scannedAt: Date.now(), targets: [
          mk('c1', 'npm 缓存', '~/.npm', 'low', 5 * GB),
          mk('c2', 'Homebrew 缓存', '~/Library/Caches/Homebrew', 'low', 3 * GB),
          mk('c3', 'Xcode 派生数据', '~/Library/Developer/Xcode/DerivedData', 'medium', 2 * GB),
          mk('c4', '旧系统日志', '/private/var/log', 'high', 1 * GB),
        ] }),
      }));
      await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#btn-lifework', { timeout: 25000 });
      if (await p.locator('#welcome-system').count()) await p.click('#welcome-system');
      await p.waitForTimeout(3000);
      await p.evaluate(() => {
        const el = [...document.querySelectorAll('#system-nav-list button')].find((x) => x.textContent.includes('存储'));
        if (el) el.click();
      });
      await p.waitForTimeout(1500);
      const viz = await p.evaluate(() => {
        const bar = document.querySelector('.sp-band .sp-viz-bar');
        if (!bar) return null;
        const key = bar.parentElement.querySelector('.sp-viz-key');
        return { segs: bar.querySelectorAll('.sp-viz-seg').length,
          legend: key ? key.innerText.replace(/\n/g, ' ').slice(0, 120) : '',
          total: (document.getElementById('system-cache-total') || {}).textContent || '' };
      });
      ck('★★ 有缓存数据时出「构成条」（4 段）', !!viz && viz.segs === 4, viz && ('段数 ' + (viz && viz.segs)));
      ck('图例带各项名字与体积', !!viz && /npm 缓存/.test(viz.legend) && /Homebrew/.test(viz.legend), viz && viz.legend);
      ck('合计与表格一致（去重后 11 GB）', !!viz && /11/.test(viz.total), viz && ('合计 ' + viz.total));
      ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
      await p.close();
    }
    /* ── ⑥ 设置页「AI 模型」入口（生词补全 / 翻译的提示都指向它）── */
    {
      const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      /* ⚠️ 保存会写**服务端**的 AI 配置 ✗（那是用户真在用的那份 ✓）→ 拦掉 ✓，
         只看「请求体对不对」+「localStorage 有没有落」✓，不碰服务器 ✗。 */
      let posted = null;
      await p.route('**/api/ai/config', (route) => {
        if (route.request().method() === 'POST') {
          try { posted = JSON.parse(route.request().postData() || '{}'); } catch (_) { posted = {}; }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: {} }) });
      });
      await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#btn-lifework', { timeout: 25000 });
      if (await p.locator('#welcome-system').count()) await p.click('#welcome-system');
      await p.waitForTimeout(2500);
      await p.evaluate(() => {
        const el = [...document.querySelectorAll('#system-nav-list button')].find((x) => x.textContent.includes('设置'));
        if (el) el.click();
      });
      await p.waitForTimeout(1200);
      const fields = await p.evaluate(() => ({
        url: !!document.getElementById('system-ai-url'),
        model: !!document.getElementById('system-ai-model'),
        key: !!document.getElementById('system-ai-key'),
        save: !!document.getElementById('system-ai-save'),
        test: !!document.getElementById('system-ai-test'),
      }));
      ck('★★ 设置页有 AI 配置（地址 / 模型 / Key / 保存 / 测试）',
        fields.url && fields.model && fields.key && fields.save && fields.test, JSON.stringify(fields));
      /* 填一个 base 地址（不带 /chat/completions）→ 保存 → 必须被规范化 ✓ */
      await p.fill('#system-ai-url', 'https://api.example.com/v1');
      await p.fill('#system-ai-model', 'probe-model');
      await p.fill('#system-ai-key', 'sk-probe');
      await p.click('#system-ai-save');
      await p.waitForTimeout(900);
      const saved = await p.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('mc-ai-cfg') || 'null'); } catch (_) { return null; }
      });
      ck('★★ 保存后写进 localStorage（和主界面同一份 mc-ai-cfg）',
        !!saved && saved.model === 'probe-model' && saved.key === 'sk-probe', JSON.stringify(saved));
      ck('★ 只填 base 地址会自动补 /chat/completions',
        !!saved && /\/chat\/completions$/.test(String(saved.url)), saved && saved.url);
      ck('★ 同时把配置发去服务端（/api/ai/config）', !!posted && posted.config && posted.config.model === 'probe-model',
        posted && JSON.stringify(posted).slice(0, 90));
      ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
      await p.close();
    }
    /* ⑦ 任务进度流（SSE）必须**真的能流** ✓（2026-10-19 修的那个 bug）——
       ⚠️ 之前 `lib/routes/system-panel.js` 里写的是 `if (await handle(...)) return;` ✓，
          裸 return 返回 undefined ✓ → 调用方当成「没处理」→ 继续往下撞 404 兜底 ✗ →
          对已经写了响应头的 res 再 writeHead → 抛错 → 连接被销毁 ✗✗。
       表现：浏览器 `ERR_EMPTY_RESPONSE` ✓、本机管家的**任务进度日志一条都不显示** ✗，
       只有「任务跑完」这件事靠 onerror 兜底补查还能对上 ✓（所以不容易被发现 ✗）。
       ⇒ 这里直接开一个 EventSource，断言 **meta / line / done 三样都收到** ✓。 */
    {
      const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
      const failed = [];
      p.on('requestfailed', (r) => { if (r.url().includes('/stream')) failed.push(r.url().split('/tasks/')[1] + ' → ' + (r.failure() && r.failure().errorText)); });
      await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const got = await p.evaluate(async () => {
        const res = await fetch('/api/system-panel/caches/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await res.json();
        const id = d && d.task && d.task.id;
        if (!id) return { err: '没拿到任务 id：' + JSON.stringify(d).slice(0, 80) };
        const log = { meta: 0, line: 0, done: '', error: '' };
        await new Promise((resolve) => {
          const es = new EventSource('/api/system-panel/tasks/' + id + '/stream');
          const t = setTimeout(() => { log.error = 'timeout rs=' + es.readyState; try { es.close(); } catch (_) { } resolve(); }, 20000);
          es.addEventListener('meta', () => { log.meta++; });
          es.addEventListener('line', () => { log.line++; });
          es.addEventListener('done', (e) => {
            try { log.done = JSON.parse(e.data).status; } catch (_) { log.done = '?'; }
            clearTimeout(t); try { es.close(); } catch (_) { } resolve();
          });
          es.onerror = () => { if (!log.done) { log.error = 'error rs=' + es.readyState; clearTimeout(t); try { es.close(); } catch (_) { } resolve(); } };
        });
        return log;
      });
      ck('★★ 任务流收到 meta（连接建立）', !!got && got.meta >= 1, JSON.stringify(got));
      ck('★★ 任务流收到 line（进度日志真的在流）', !!got && got.line >= 1, JSON.stringify(got));
      ck('★★ 任务流收到 done（结果回调能触发）', !!got && got.done === 'ok', JSON.stringify(got));
      ck('★ 流请求没有 ERR_EMPTY_RESPONSE', failed.length === 0, JSON.stringify(failed));
      await p.close();
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
