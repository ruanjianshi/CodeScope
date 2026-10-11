#!/usr/bin/env node
'use strict';
/*
 * archify-lite · 代码 → 架构图
 * ---------------------------------------------------------------------------
 * 一条命令：扫描代码 → 出 IR → 渲染成一个自包含 HTML。
 *
 * 用法：
 *   node tools/archify/index.js [目录] [选项]
 *
 * 选项：
 *   --out <路径>       HTML 输出路径（默认 <目录>/architecture.html）
 *   --ir <路径>        顺便把中间 IR 也写出来（可被断言 / diff / 别的前端消费）
 *   --title <名字>     图上的标题（默认取目录名）
 *   --depth <n>        模块粒度：按几层目录归组（默认 2）
 *   --max-files <n>    文件数上限，防止在大仓库上跑飞（默认 4000）
 *
 * 为什么要有中间 IR（学 Archify）：
 *   图是**产物**，IR 才是**事实**。IR 能：
 *     · 被测试断言（"这个模块不许超过 N 行"）；
 *     · 被 git diff（架构变化看得见）；
 *     · 被别的前端消费（今天出 HTML，明天可以出 Mermaid / PNG）。
 */

const fs = require('fs');
const path = require('path');
const { analyze } = require('./analyze');
const { renderHTML } = require('./render');

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*|\s*\*\s?/g, '').trim());
    return;
  }
  const root = args.find((a) => !a.startsWith('--')) || '.';
  const get = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };

  if (!fs.existsSync(root)) {
    console.error('目录不存在：' + root);
    process.exit(1);
  }

  const depth = Number(get('--depth', 2)) || 2;
  const maxFiles = Number(get('--max-files', 4000)) || 4000;
  const absRoot = path.resolve(root);
  const out = get('--out', path.join(absRoot, 'architecture.html'));
  const irOut = get('--ir', null);
  const title = get('--title', path.basename(absRoot));

  const t0 = Date.now();
  const ir = analyze(absRoot, { depth, maxFiles });
  if (irOut) fs.writeFileSync(irOut, JSON.stringify(ir, null, 2));
  fs.writeFileSync(out, renderHTML(ir, { title }));

  const big = ir.bigFiles.filter((f) => f.lines >= 3000);
  console.log('✓ 扫描完成（' + (Date.now() - t0) + ' ms）');
  console.log('  ' + ir.summary.files + ' 个文件 · ' + ir.summary.totalLines.toLocaleString('en-US')
    + ' 行 · ' + ir.summary.modules + ' 个模块');
  if (ir.truncated) console.log('  ⚠️ 文件数达到上限，结果可能不完整（用 --max-files 调大）');
  if (big.length) {
    console.log('  ⚠️ 巨型文件 ' + big.length + ' 个（最该拆的地方）：');
    big.slice(0, 5).forEach((f) => console.log('      ' + String(f.lines).padStart(7) + ' 行  ' + f.rel));
  }
  console.log('  架构图：' + out);
  if (irOut) console.log('  中间 IR：' + irOut);
}

if (require.main === module) main();
