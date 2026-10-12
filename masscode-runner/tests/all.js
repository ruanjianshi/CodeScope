#!/usr/bin/env node
'use strict';
/**
 * 跑**全部**测试（2026-10-11 加）
 *
 * ⚠️ 为什么要有这个 ✗✗：
 *   全项目自检时发现 `tests/` 下有 **51 个测试** ✓，但**只有约 30 个接进了 npm 脚本** ✗ ——
 *   剩下 20 来个（`life-*` / `shortcut-docs` / `syntax` / `system-files-guards` …）
 *   **没有任何入口** ✓ → 等于**没人跑** ✓ → 会烂掉 ✓。
 *   （这次一跑，果然扫出 3 个真 bug：`logicToSkeleton` / `run` / `MIME`
 *     三个依赖在抽路由时漏了 ✓，一调就 `ReferenceError` → HTTP 500 ✓。）
 *
 * ⚠️ 为什么不并进 `npm test` ✗：
 *   `npm test` 要**快** ✓（提交前随手跑 ✓）。这里有几个是浏览器测试、单个要 1~2 分钟 ✓
 *   （`life-flow` 126s ✓）→ 全跑一遍 ~15 分钟 ✓，不适合塞进默认链路 ✓。
 *   ⇒ 定位是「**发版前 / 大改动后**跑一遍」✓，不是每次提交都跑 ✓。
 *
 * 用法：
 *   npm run test:all              跑全部
 *   npm run test:all -- arch      只跑文件名含 arch 的
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
/* ⚠️⚠️ **先装数据保护罩** ✗✗ —— `tests/` 下有 15+ 个「探针」是**打真实实例**的 ✓
   （开头都写着「打本机真实实例 127.0.0.1:4877」✓），它们会**写你的真实数据** ✓。
   实测：跑一次这里，`life-workbench.json` 82 键掉到 77 键 ✓。
   ⇒ 跑之前快照，跑完（哪怕崩了）恢复 ✓。详见 tests/probe-guard.js ✓。 */
const probeGuard = require('./probe-guard.js');
probeGuard.arm();

const root = path.resolve(__dirname, '..');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
/* ⚠️ 这几个是**命令行工具**不是自跑测试 ✗ —— 它们要传参（比如一个文档路径）✓，
   直接跑会打印「用法: …」然后退出 ✓（不是失败 ✓，但也不该算进"通过" ✓）。 */
const CLI_ONLY = new Set(['blockly-roundtrip.js']);
const TIMEOUT_MS = 180000;

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && f !== 'all.js')
  .filter((f) => !CLI_ONLY.has(f))
  .filter((f) => !only.length || only.some((k) => f.includes(k)))
  .sort();

console.log('\n跑 ' + files.length + ' 个测试（超时 ' + (TIMEOUT_MS / 1000) + 's / 个）\n');
const rows = [];
files.forEach((f) => {
  const t0 = Date.now();
  /* ⚠️ macOS 没有 timeout ✓ → 自己实现（`SIGKILL` 兜底，防止浏览器测试挂住 ✓） */
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], {
    cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, killSignal: 'SIGKILL',
    env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') },
  });
  const ms = Date.now() - t0;
  const out = String(r.stdout || '') + String(r.stderr || '');
  const timedOut = r.signal === 'SIGKILL' || ms >= TIMEOUT_MS - 500;
  const ok = !timedOut && r.status === 0;
  const tail = (out.match(/(?:全部通过|失败 \d+ 项|\d+\/\d+ 项通过)/g) || []).pop() || '';
  rows.push({ f, ok, timedOut, ms, tail });
  console.log('  ' + (ok ? '✅' : (timedOut ? '⏱超时' : '❌')) + '  ' + String(Math.round(ms / 1000)).padStart(4) + 's  '
    + f.padEnd(26) + tail);
});

const bad = rows.filter((x) => !x.ok);
console.log('\n── 汇总 ──');
console.log('  通过 ' + (rows.length - bad.length) + ' / ' + rows.length
  + '   总耗时 ' + Math.round(rows.reduce((s, x) => s + x.ms, 0) / 1000) + 's');
if (bad.length) {
  console.log('  ✗ 没过的：');
  bad.forEach((x) => console.log('      ' + x.f + (x.timedOut ? '（超时）' : '')));
  process.exit(1);
}
console.log('  全部通过 ✅');
