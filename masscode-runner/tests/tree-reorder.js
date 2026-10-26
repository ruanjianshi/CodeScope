#!/usr/bin/env node
/* ⚠️ 这个探针打的是**本机正在运行的那个 CodeScope 实例** ✗ —— 需要 127.0.0.1:4877 起着 ✓，
   没有服务时**直接跳过** ✓（不算失败 ✓）。跑法：先起服务，再 node tests/tree-reorder.js ✓。

   ── 它在测什么（2026-10-19，用户报「无法移动顺序」）────────────────────────────
   ⚠️ 原来项目树只有「拖进另一个文件夹」✗ —— **同一层里换位置根本没有入口** ✓：
      树按 `.meta.yaml` 的 `orderIndex` 排 ✓，而新建文件夹一律写 0 ✓ →
      全 0 时退回按名字排 ✓ → 怎么拖都不会变 ✗（用户截图就是项目树 ✓）。

   现在落点分三段 ✓：
     · 行的上 28%  → 插到这一行**前面** ✓
     · 下 28%      → 插到**后面** ✓
     · 中间        → 放进这个文件夹（原来的行为 ✓，没动 ✓）

   这个探针只做一件事：**真的拖一次**（上边缘 → 前面），断言
     ① 拖拽时目标行带 `drop-before` 类（指示线要出现 ✓）
     ② 顺序真的变了（从 `/api/snippets` 的 orderIndex 读 ✓，不只看界面 ✓）
     ③ 状态栏说人话 ✓
     ④ **最后一定还原成原来的顺序** ✓（绝不留用户的树被动过 ✗）

   ⚠️ 只动**根层**的两个文件夹 ✓，只改 `orderIndex` ✓，不动任何文件内容 ✓。

   ★ 2026-10-19 扩到**绘图 / Office 两棵树** ✓（用户：「还有其他模块的文件、文件夹操作，
     也需要可以自由移动、移动顺序，等等和项目的对齐」）。
     它们没有 per-item 元数据 ✓，顺序存在每个目录的 `.order.json` 里 ✓ →
     探针会先**快照**这两个文件（可能不存在 ✓），跑完**原样写回 / 删掉** ✓。
   ────────────────────────────────────────────────────────────────────────── */
'use strict';
require('./probe-guard.js').arm();
const fs = require('fs');
const { chromium } = require('playwright-core');
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => fs.existsSync(f));
const fails = [];
const ck = (n, ok, x) => { if (ok) console.log('  ✅ ' + n); else { console.log('  ❌ ' + n + (x ? '  → ' + x : '')); fails.push(n); } };
const BASE = 'http://127.0.0.1:4877';

const rootOrder = async () => {
  const d = await (await fetch(BASE + '/api/snippets', { cache: 'no-store' })).json();
  return (d.folders || []).filter((f) => f.parent === '')
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || String(a.name).localeCompare(String(b.name), 'zh'))
    .map((f) => f.path);
};

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
  let original = [];
  try {
    original = await rootOrder();
    if (original.length < 2) {
      console.log('跳过：根层文件夹不足 2 个（' + original.length + '）');
      await b.close();
      process.exit(0);
    }
    const last = original[original.length - 1];
    const first = original[0];

    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);

    /* 把「最后一个」拖到「第一个」的上边缘 → 应该变成第一 */
    const r = await p.evaluate(({ srcName, dstName }) => {
      const rows = [...document.querySelectorAll('#side .fnode')];
      const byName = (n) => rows.find((x) => (x.querySelector('.fname') || {}).textContent === n);
      const src = byName(srcName), dst = byName(dstName);
      if (!src || !dst) return { err: '界面上找不到这两个文件夹' };
      const dt = new DataTransfer();
      const fire = (el, type, y) => {
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt,
          clientX: rect.left + 40, clientY: y == null ? rect.top + rect.height / 2 : y }));
      };
      fire(src, 'dragstart');
      const dr = dst.getBoundingClientRect();
      fire(dst, 'dragover', dr.top + 2);           /* 上边缘 → before */
      const cls = dst.className;
      fire(dst, 'drop', dr.top + 2);
      fire(src, 'dragend');
      return { cls };
    }, { srcName: last, dstName: first });

    ck('拖到上边缘时目标行出现「插入线」类', !!r && /\bdrop-before\b/.test(r.cls || ''), r && r.cls);
    await p.waitForTimeout(2500);

    const after = await rootOrder();
    ck('★★ 顺序真的变了（被拖的那个排到第一）', after[0] === last, JSON.stringify(after));
    ck('★ 其余文件夹的相对顺序没被打乱',
      JSON.stringify(after.slice(1)) === JSON.stringify(original.slice(0, -1)), JSON.stringify(after));
    const st = await p.evaluate(() => (document.getElementById('status') || {}).textContent || '');
    ck('★ 状态栏说清了「移到谁前面」', /移到/.test(st) && st.indexOf(last) >= 0, st);
    ck('无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
    await p.close();
    /* ── 绘图 / Office：同一层换顺序 ✓（2026-10-19 新加）── */
    {
      const vault = await (async () => {
        const d = await (await fetch(BASE + '/api/snippets', { cache: 'no-store' })).json();
        return d && d.vault;
      })();
      const pathMod = require('path');
      const cases = [
        { label: '绘图', tree: '/api/drawings/tree', dir: 'drawings', rowSel: '#side .draw-row', folderSel: '#side .draw-frow', open: (el) => el.classList.contains('open') },
        { label: 'Office', tree: '/api/office/tree', dir: 'office', rowSel: '#side .office-row', folderSel: '#side .office-row', open: (el) => el.classList.contains('open') },
      ];
      for (const c of cases) {
        const tree = await (await fetch(BASE + c.tree, { cache: 'no-store' })).json();
        const top = (tree.root && tree.root.children || []).find((x) => x.type === 'folder');
        if (!top || !(top.children || []).filter((x) => x.type !== 'folder').length) {
          console.log('  · 跳过 ' + c.label + '：没有可拖的同层文件');
          continue;
        }
        const docs = top.children.filter((x) => x.type !== 'folder').map((x) => x.name);
        const orderFile = pathMod.join(vault, c.dir, top.path, '.order.json');
        const snap = fs.existsSync(orderFile) ? fs.readFileSync(orderFile, 'utf8') : null;

        const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
        const errs = [];
        p.on('pageerror', (e) => errs.push(e.message));
        await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(2600);
        /* 展开这个文件夹 */
        await p.evaluate(({ folderSel, name }) => {
          const el = [...document.querySelectorAll(folderSel)].find((x) => (x.querySelector('.fname,.name') || x).textContent.includes(name));
          if (el && !el.classList.contains('open')) el.click();
        }, { folderSel: c.folderSel, name: top.name });
        await p.waitForTimeout(800);

        /* 把最后一个拖到第一个的上边缘 */
        const r = await p.evaluate(({ rowSel }) => {
          /* ⚠️ 绘图行**没有** `dataset.path`（只有文件夹行有 ✓）→ 不能拿它当条件 ✗，
             否则永远「同层文件不足 2 个」✓（实测踩过 ✗）。只认「有名字、且不是文件夹行」✓。 */
          const rows = [...document.querySelectorAll(rowSel)].filter((x) => {
            if (x.classList.contains('draw-frow') || x.classList.contains('office-folder')) return false;
            const n = x.querySelector('.name,.draw-name');
            if (!n) return false;
            if (x.dataset.path) return x.dataset.path.includes('/');   /* Office 有 path → 只认文件 ✓ */
            return true;                                              /* 绘图没有 path → 靠类名排除文件夹 ✓ */
          });
          if (rows.length < 2) return { err: '同层文件不足 2 个' };
          const src = rows[rows.length - 1], dst = rows[0];
          const dt = new DataTransfer();
          const fire = (el, type, y) => {
            const rect = el.getBoundingClientRect();
            el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt,
              clientX: rect.left + 30, clientY: y == null ? rect.top + rect.height / 2 : y }));
          };
          fire(src, 'dragstart');
          const dr = dst.getBoundingClientRect();
          fire(dst, 'dragover', dr.top + 2);
          const cls = dst.className;
          fire(dst, 'drop', dr.top + 2);
          fire(src, 'dragend');
          return { cls };
        }, { rowSel: c.rowSel });
        ck(c.label + '：拖到上边缘出现插入线', !!r && /\bdrop-before\b/.test(r.cls || ''), r && (r.cls || r.err));
        await p.waitForTimeout(1800);
        const after = await (await fetch(BASE + c.tree, { cache: 'no-store' })).json();
        const afterDocs = ((after.root.children || []).find((x) => x.type === 'folder') || {}).children
          .filter((x) => x.type !== 'folder').map((x) => x.name);
        ck(c.label + '：顺序真的变了（最后一个排到第一）', afterDocs[0] === docs[docs.length - 1], JSON.stringify(afterDocs));
        /* ⚠️ 只断言「一条没少」✓ —— 「其余相对顺序」要拿**拖之前的实时顺序**比才准 ✓，
           而那是 UI 渲染时的快照 ✓，跟接口读到的可能差一拍 ✓（实测会假红 ✗）。 */
        ck(c.label + '：一条都没少（集合不变）',
          afterDocs.length === docs.length && JSON.stringify([...afterDocs].sort()) === JSON.stringify([...docs].sort()),
          JSON.stringify(afterDocs));
        ck(c.label + '：无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));
        await p.close();

        /* 立刻还原（写回快照 / 没有就删掉 ✓） */
        try {
          if (snap === null) { if (fs.existsSync(orderFile)) fs.unlinkSync(orderFile); }
          else fs.writeFileSync(orderFile, snap);
        } catch (_) { }
      }
    }
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    fails.push('异常:' + e.message);
  } finally {
    /* ★ 无论如何都把顺序还原 ✓ —— 用户的树不能被测试改掉 ✗ */
    try {
      /* ⚠️⚠️ 先检查「被拖的那个有没有被塞进别的文件夹」✗✗ ——
         功能回退（落点全当 into）时，它会被**移进**目标文件夹 ✓，
         这时它已经不在根层了 ✓，后面按兄弟关系还原顺序会全部失败 ✗
         （实测踩过：变异测试把「数据结构算法」塞进了「嵌入式开发」✗，
           而 finally 只还原顺序、没还原层级 ✗ → 用户的树被改了 ✗）。
         ⇒ 先按「路径结尾」找回来，移回根层，再还原顺序 ✓。 */
      try {
        const all = ((await (await fetch(BASE + '/api/snippets', { cache: 'no-store' })).json()).folders) || [];
        for (const name of original) {
          const hit = all.find((f) => f.path === name || f.path.endsWith('/' + name));
          if (hit && hit.path !== name) {
            await fetch(BASE + '/api/fs/move-folder', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folder: hit.path, toFolder: '' }),
            });
            console.log('  🔧 先把「' + hit.path + '」移回根层（测试把它塞进去了）');
          }
        }
      } catch (_) { }
      if (original.length >= 2) {
        const now = await rootOrder();
        if (JSON.stringify(now) !== JSON.stringify(original)) {
          /* 逐个还原：从第二个开始，依次插到前一个后面 ✓ */
          for (let i = 1; i < original.length; i++) {
            await fetch(BASE + '/api/fs/reorder-folder', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folder: original[i], target: original[i - 1], position: 'after' }),
            });
          }
          const back = await rootOrder();
          console.log(JSON.stringify(back) === JSON.stringify(original)
            ? '  🔒 顺序已还原：' + back.join(' / ')
            : '  ⚠ 顺序没还原干净：' + back.join(' / '));
        }
      }
    } catch (e) { console.log('  ⚠ 还原顺序失败：' + e.message); }
    await b.close();
    console.log(fails.length ? '\n失败 ' + fails.length + ' 项：' + fails.join(' / ') : '\n全部通过 ✅');
    process.exit(fails.length ? 1 : 0);
  }
})().catch((e) => { console.log('✗', e.message); process.exit(1); });
