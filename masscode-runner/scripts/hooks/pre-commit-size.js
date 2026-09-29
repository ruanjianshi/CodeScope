#!/usr/bin/env node
/**
 * CodeScope 单文件体积守卫（由同目录的 pre-commit 壳层调用）。
 *
 * 依据 GitHub 官方限制：单文件 >50 MiB 会告警，>100 MiB 会被 push 永久拒绝。
 * 检查对象是「本次提交实际入库的内容」——所以体积取自索引里的 blob，而不是工作区文件的当前大小，
 * 这样即使文件后来被改小，也不会漏掉一次已经把大文件写进历史的提交。
 *
 * 紧急放行：git commit --no-verify
 */
const { execFileSync } = require('node:child_process');

const WARN_BYTES = 50 * 1024 * 1024;
const BLOCK_BYTES = 100 * 1024 * 1024;

function stagedPaths() {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function stagedSize(file) {
  try {
    return Number(execFileSync('git', ['cat-file', '-s', ':' + file], { encoding: 'utf8' }).trim()) || 0;
  } catch (_) {
    return 0;
  }
}

function human(bytes) {
  return (bytes / 1048576).toFixed(1) + ' MiB';
}

const blocked = [];
const warned = [];
for (const file of stagedPaths()) {
  const size = stagedSize(file);
  if (size >= BLOCK_BYTES) blocked.push([file, size]);
  else if (size >= WARN_BYTES) warned.push([file, size]);
}

if (warned.length) {
  console.warn('  [体积守卫] 以下文件已达到 GitHub 的告警阈值（50 MiB），请确认是否应该入库：');
  for (const [file, size] of warned) console.warn('    · ' + human(size) + '  ' + file);
}

if (blocked.length) {
  console.error('');
  console.error('  ✖ [体积守卫] 提交被拒绝：以下文件超过 GitHub 单文件硬上限 100 MiB。');
  for (const [file, size] of blocked) console.error('    · ' + human(size) + '  ' + file);
  console.error('');
  console.error('  这类文件一旦进入历史，push 会被永久拒绝，清除它必须改写历史。');
  console.error('  可选处理：压缩或拆分该文件、移出仓库改用外部存储、git rm --cached 后写进 .gitignore。');
  console.error('  确认无碍时可临时跳过：git commit --no-verify');
  console.error('');
  process.exit(1);
}

process.exit(0);
