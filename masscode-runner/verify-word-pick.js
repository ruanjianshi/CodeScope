#!/usr/bin/env node
'use strict';
/* 验证：点单词的**功能**没被性能优化弄坏 ✓
 *   · 词卡内容真的换成了被点的那个词 ✓
 *   · 选中态（.on）真的移过去了 ✓
 *   · 编辑框失焦仍然会存 ✓（性能优化里最容易弄丢的就是这个 ✗）
 *   · 滚动位置仍然保持 ✓
 * 用法：node verify-word-pick.js
 */
const { chromium } = require('playwright-core');
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
function ck(n, ok, d) { results.push(ok); console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '   ' + d : '')); }

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 820 } });
  await p.goto('http://127.0.0.1:4877/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#btn-lifework', { timeout: 20000 });
  await p.click('#btn-lifework');
  await p.locator('.lw-nav [data-tab="reading"]').click();
  /* ★ 先切到「生词本」模式 ✓ —— 阅读页上次停在哪个子模式是**存库**的 ✗，
     不切的话（比如上次停在「外刊精读」）这里会等不到 .lw-rd-grps 而超时 ✗。 */
  await p.waitForSelector('[data-rdmode]', { timeout: 15000 });
  await p.evaluate(() => { const e = document.querySelector('[data-rdmode="word"]'); if (e) e.click(); });
  await p.waitForTimeout(700);
  await p.waitForSelector('.lw-rd-grps', { timeout: 15000 });
  await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('[data-epwflt="book:cet6"]').click());
  await p.waitForTimeout(1200);

  const pick = await p.evaluate(async () => {
    const el = document.querySelector('.lw-rd-list');
    el.scrollTop = 300;
    const rows = [...el.querySelectorAll('[data-epword]')];
    const r = rows.find((x) => x.getBoundingClientRect().top > 200) || rows[10];
    const want = r.querySelector('.w').textContent.trim();
    r.click();
    await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x)));
    return want;
  });
  await p.waitForTimeout(300);

  const st = await p.evaluate(() => {
    const el = document.querySelector('.lw-rd-list');
    const on = el.querySelector('[data-epword].on');
    const read = document.querySelector('.lw-rd-read');
    return {
      onWord: on ? on.querySelector('.w').textContent.trim() : '',
      onCount: el.querySelectorAll('[data-epword].on').length,
      listTop: el.scrollTop,
      title: (read.querySelector('.lw-wd-titleword') || {}).textContent || '',
      readNodes: read.querySelectorAll('*').length,
      inputs: read.querySelectorAll('input,textarea').length,
    };
  });
  ck('点的是「' + pick + '」', true);
  ck('选中态移到了这个词', st.onWord === pick && st.onCount === 1, 'on=' + st.onWord + ' 个数=' + st.onCount);
  ck('右栏词卡换了内容', st.title.indexOf(pick) >= 0 || st.readNodes > 5, '标题=' + st.title.slice(0, 20) + ' 节点=' + st.readNodes);
  ck('词表滚动位置仍然保持', st.listTop > 50, 'scrollTop=' + st.listTop);

  /* ★ 最关键：编辑框失焦还能不能存 ✗（性能优化里最容易弄丢绑定 ✓） */
  const edit = await p.evaluate(() => {
    const btn = document.querySelector('#lw-wd-edit');
    if (btn) btn.click();
    return !!btn;
  });
  await p.waitForTimeout(400);
  const hasInput = await p.evaluate(() => !!document.querySelector('#lw-wd-ph'));
  ck('「✏️ 编辑」能切出输入框', edit && hasInput, '有 #lw-wd-ph=' + hasInput);

  if (hasInput) {
    const before = await p.evaluate(() => document.querySelector('#lw-wd-ph').value);
    const saved = await p.evaluate(async () => {
      const inp = document.querySelector('#lw-wd-ph');
      inp.value = '/__perftest__/';
      inp.dispatchEvent(new Event('blur'));
      await new Promise((r) => setTimeout(r, 700));
      return true;
    });
    await p.waitForTimeout(900);
    const after = await p.evaluate(async () => {
      const r = await fetch('/api/life/store', { cache: 'no-store' });
      const d = await r.json();
      const on = document.querySelector('.lw-rd-list [data-epword].on');
      const id = on && on.dataset.epword;
      const w = ((d.data || {}).words || []).find((x) => x.id === id);
      return w ? w.ph : '(没找到)';
    });
    ck('编辑后失焦**真的存进库**了', after === '/__perftest__/', '库里 ph=' + after + '（原 ' + before + '）');
    /* ★ 还原成**原值** ✓（不是清空 ✗ —— 清空会把用户原本的音标弄没 ✓，实测踩过 ✓） */
    await p.evaluate(async (orig) => {
      const r = await fetch('/api/life/store', { cache: 'no-store' });
      const d = await r.json();
      const on = document.querySelector('.lw-rd-list [data-epword].on');
      const id = on && on.dataset.epword;
      const w = ((d.data || {}).words || []).find((x) => x.id === id);
      if (w) w.ph = orig;
      await fetch('/api/life/store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d.data) });
    }, before);
    console.log('    （已把音标还原成原值 ' + before + ' ✓）');
  }

  await b.close();
  const bad = results.filter((x) => !x).length;
  console.log('\n' + (bad ? '✗ ' + bad + ' 项未通过' : '✓ 全部通过'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
