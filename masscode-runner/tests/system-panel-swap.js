#!/usr/bin/env node
'use strict';
/**
 * system-panel 的 Linux swap 解析测试（新增，2026-10-11）
 *
 * ⚠️ 为什么要写 ✗✗：
 *   `lib/system-panel.js` 里 `swapInfo` 曾经**定义了两遍**（同文件重复定义）✓ ——
 *   JS 函数声明提升后**后写的那份静默覆盖前一份** ✓，而那份的正则写成了
 *   new RegExp('^' + name + ':\s+(\\d+)\\s+kB', 'mi')（单引号）✗
 *   → \s 在字符串里退化成字母 s → 实际正则 SwapTotal:s+(\d+)s+kB → 永远匹配不到 ✓
 *   → **Linux 上 swap 恒为 null** ✓，不抛错、不打日志，面板只是安静地显示没有交换区 ✓。
 *
 *   ⚠️ 根本问题不是正则，是**这段代码本机跑不到** ✓：本机是 macOS，
 *   `if (!IS_MAC)` 的 Linux 分支一行都不执行 → 错了也照样"通过" ✓。
 *   ⇒ 所以这里把解析抽成纯函数 `parseLinuxSwapMeminfo(text)` ✓，
 *     用**构造的样本**在 macOS 上也能验收 ✓；再用**真实 macOS 内容**证明
 *     它在该返回 null 的地方确实返回 null ✓（不该把 mac 当 linux 解析）。
 *
 * 覆盖：
 *   · 构造的 Linux /proc/meminfo → 正确的 total / free / used（字节）
 *   · 真实 macOS 内容（vm_stat / sysctl 输出）→ null（没有 SwapTotal 行）
 *   · SwapTotal: 0（未启用 swap）→ null（与旧代码语义一致，✗ 不能变成 { total: 0 }）
 *   · 空值 / undefined → null（不抛）
 *   · 回归锁：单反斜杠那版正则在同一份样本上**必须匹配不到**（还原原始 bug）
 *   · macOS 路径行为不变：overview().swap 与 `sysctl -n vm.swapusage` 的实时输出自洽
 *
 * 运行：node tests/system-panel-swap.js
 */
const { execFileSync } = require('child_process');
const { _parsers, createSystemPanel } = require('../lib/system-panel.js');

const parse = _parsers.parseLinuxSwapMeminfo;

let pass = 0;
let fail = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  fails.push(label + (detail === undefined ? '' : '   → ' + String(detail).slice(0, 160)));
}
function num(label, actual, expected) {
  ok(label, actual === expected, '得到 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected));
}

/* Ubuntu/Debian 的 /proc/meminfo 真实形状（字段顺序、空格对齐、kB 后缀都照抄真机）✓
   这里造 2 GiB swap、用了 256 MiB ✓ —— 数字选得能一眼验算：
   2097152 - 1835008 = 262144 kB = 268435456 B ✓ */
const LINUX_MEMINFO = [
  'MemTotal:       16336892 kB',
  'MemFree:          912344 kB',
  'MemAvailable:    4021360 kB',
  'Buffers:          182736 kB',
  'Cached:          6284336 kB',
  'SwapCached:        12345 kB',
  'SwapTotal:       2097152 kB',
  'SwapFree:        1835008 kB',
  'Dirty:               412 kB',
  'Writeback:             0 kB',
  '',
].join('\n');

/* 另一份更贴近「迷你 VPS」的样本：swap 开得很小，验一下不依赖固定位数 ✓ */
const LINUX_MEMINFO_SMALL = 'MemTotal:         501392 kB\nSwapTotal:        131068 kB\nSwapFree:         131068 kB\n';

/* swap 未启用的机器（Docker 容器里很常见）：SwapTotal 是 0 ✓ */
const LINUX_NO_SWAP = 'MemTotal:       16336892 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n';

const KB = 1024;

(async () => {
  console.log('  ── 构造的 Linux /proc/meminfo ──');
  const v = parse(LINUX_MEMINFO);
  ok('能解析出结果（非 null）', v !== null, v);
  num('total = 2 GiB(字节)', v && v.total, 2097152 * KB);
  num('free = 1792 MiB(字节)', v && v.free, 1835008 * KB);
  num('used = total - free = 256 MiB(字节)', v && v.used, 262144 * KB);

  const v2 = parse(LINUX_MEMINFO_SMALL);
  num('迷你 VPS：total', v2 && v2.total, 131068 * KB);
  num('迷你 VPS：used 应为 0（free == total）', v2 && v2.used, 0);

  console.log('  ── 该返回 null 的分支 ──');
  ok('★ SwapTotal: 0（未启用 swap）→ null', parse(LINUX_NO_SWAP) === null, parse(LINUX_NO_SWAP));
  ok('空字符串 → null', parse('') === null);
  ok('undefined → null', parse(undefined) === null);
  ok('null → null', parse(null) === null);
  ok('★ 没有任何 Swap* 行的文本 → null', parse('MemTotal:  1024 kB\n') === null);

  console.log('  ── 真实 macOS 内容（本机现取）──');
  /* 真实内容才有说服力 ✓：macOS 的 vm_stat / sysctl 里根本没有 SwapTotal 行 ✓，
     把 mac 的文本喂进 Linux 解析器必须**拿不到东西** ✓，而不是解析出一堆 0 或 NaN ✗。 */
  let vmStat = '';
  let swapUsage = '';
  try { vmStat = execFileSync('vm_stat', [], { encoding: 'utf8', timeout: 5000 }); } catch (_) {}
  try { swapUsage = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8', timeout: 5000 }); } catch (_) {}
  console.log('    vm_stat 首行: ' + (vmStat.split('\n')[0] || '(取不到)'));
  console.log('    vm.swapusage: ' + (swapUsage.trim() || '(取不到)'));
  ok('★ 真实 vm_stat 内容 → null', parse(vmStat) === null, parse(vmStat));
  ok('★ 真实 sysctl vm.swapusage 内容 → null', parse(swapUsage) === null, parse(swapUsage));

  console.log('  ── 回归锁：还原原始 bug ──');
  /* ✗ 这就是当时写错的那一行（单引号 → \s 退化成字母 s）✓：
     把它原样复现出来，锁住「它在真实样本上匹配不到」这个事实 ✓ ——
     以后谁再写出单反斜杠的版本，这个用例会立刻提醒他为什么错 ✓。 */
  const buggyPick = (name) => {
    const match = new RegExp('^' + name + ':\s+(\\d+)\\s+kB', 'mi').exec(LINUX_MEMINFO);
    return match ? Number(match[1]) : 0;
  };
  num('★★ 单反斜杠版取 SwapTotal 得到 0（＝当年的 bug）', buggyPick('SwapTotal'), 0);
  ok('★★ 同一份样本，修好的版本取得到 2097152', /^SwapTotal:\s+(\d+)\s+kB/mi.exec(LINUX_MEMINFO)[1] === '2097152');

  console.log('  ── macOS 路径行为不变（真实 overview）──');
  if (process.platform === 'darwin') {
    /* swapInfo 没导出 ✓，但 overview() 会调它 ✓ —— 用它做端到端确认：
       macOS 分支解析 sysctl 输出的逻辑必须**一点没变** ✓（这次只删了重复定义、抽了 Linux 解析）。 */
    const overview = await createSystemPanel({}).overview();
    const swap = overview.swap;
    ok('overview().swap 不是 null（macOS 分支仍然走通）', swap !== null, swap);
    const totalM = /total\s*=\s*([\d.]+)M/i.exec(swapUsage);
    const usedM = /used\s*=\s*([\d.]+)M/i.exec(swapUsage);
    const expectTotal = totalM ? Number(totalM[1]) * 1024 * 1024 : null;
    const expectUsed = usedM ? Number(usedM[1]) * 1024 * 1024 : 0;
    console.log('    overview().swap = ' + JSON.stringify(swap) + '  （由 sysctl 现算：total=' + expectTotal + ' used=' + expectUsed + '）');
    num('total 与 sysctl 实时值一致', swap && swap.total, expectTotal);
    num('used 与 sysctl 实时值一致', swap && swap.used, expectUsed);
    num('free = max(0, total - used)（公式不变）', swap && swap.free, Math.max(0, expectTotal - expectUsed));
  } else {
    console.log('    （非 macOS，跳过 overview 端到端用例）');
  }

  console.log('');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail) {
    console.log('');
    console.log('  失败明细:');
    fails.forEach((f) => console.log('    ✗ ' + f));
    process.exitCode = 1;
  } else {
    console.log('  ✓ Linux swap 解析（含真实 macOS 内容、原始 bug 回归锁）全部符合预期');
  }
})().catch((error) => {
  console.error('  测试自身崩了：' + ((error && error.stack) || error));
  process.exitCode = 1;
});
