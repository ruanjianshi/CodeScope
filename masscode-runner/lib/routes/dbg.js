#!/usr/bin/env node
'use strict';
/*
 * 路由：调试（/api/dbg/*）
 * ---------------------------------------------------------------------------
 * ★ 从 server.js 抽出来的（2026-10-11）——
 *   server.js 当时 9,084 行，里面有一个 **3,623 行的 http.createServer 回调**
 *   （`armRequestGuard` 隔壁那个），215 个端点全挤在里面。
 *
 * 抽这一组先做样板，因为它**最短、最自包含**：
 *   · 只有 85 行；
 *   · 只用到 9 个外部符号（readBody / writeFragments / pythonCmd /
 *     matlabCmd / isOctaveCmd / CS_VARS_M / send / writeFileAtomicSync / path）；
 *   · 它是我自己写的，行为我最清楚。
 *
 * ── 后面每抽一组，照这个形状做就行 ──
 *   ① 新建 lib/routes/<组名>.js；
 *   ② 导出 `async function handle(req, res, u, ctx) → boolean`
 *      （**处理了就返回 true**，没处理返回 false，让调用方继续往下走）；
 *   ③ 把 server.js 里那段 `if (…pathname === …)` 换成三行调用；
 *   ④ **依赖用 ctx 显式传进来**，不要用全局 ——
 *      显式传看起来啰嗦，但**看得见依赖**；全局看不见，拆到第三个文件就没人敢动了。
 *   ⑤ 跑 npm test + 手动过一遍这个功能；
 *   ⑥ **把棘轮调小**（tests/architecture.js 的 SIZE_CAP）。
 *
 * ⚠️ 为什么返回 boolean 而不是直接 return ✓ ——
 *   路由是**顺序 if** ✓，抽出去之后调用方需要知道「这一条吃掉了吗」✓，
 *   否则会继续往下走、撞到别的分支 ✓。
 */

const path = require('path');

/* ctx 里约定要有的东西（调用方保证 ✓）：
     readBody / writeFragments / pythonCmd / matlabCmd / isOctaveCmd /
     CS_VARS_M / send / writeFileAtomicSync */
async function handle(req, res, u, ctx) {
  const { readBody, writeFragments, pythonCmd, matlabCmd, isOctaveCmd, CS_VARS_M, send, writeFileAtomicSync } = ctx;

    if (req.method === 'POST' && u.pathname === '/api/dbg/prepare') {
    try {
      const b = await readBody(req);
      const code = String((b && b.code) || '');
      const lang = String((b && b.language) || 'c_cpp').toLowerCase();
      const files = Array.isArray(b && b.files) && b.files.length
        ? b.files.map((f) => ({ filename: path.basename(String(f.filename || 'main.c')), code: String(f.code || '') }))
        : [{ filename: lang === 'c' ? 'main.c' : 'main.cpp', code }];
      /* ── Python ✓：写文件，起 `python3 -m pdb <脚本>` ✓（标准库自带 ✓） */
      if (lang === 'python') {
        const pFiles = files.map((f, i) => ({
          filename: /\.py$/i.test(f.filename) ? f.filename : (i === 0 ? 'main.py' : ('file' + (i + 1) + '.py')),
          code: f.code,
        }));
        const pdir = writeFragments(pFiles);
        const pEntry = pFiles.find((f) => /main\.py$/i.test(f.filename)) || pFiles[0];
        const py = pythonCmd();
        if (!py) return send(res, 200, { ok: false, error: '这台机器上没有 python3', dir: '' });
        return send(res, 200, {
          ok: true, dir: pdir, bin: '', engine: 'python',
          entry: pEntry.filename,
          launch: JSON.stringify(py) + ' -m pdb ' + JSON.stringify(pEntry.filename),
          hint: '在终端里： cd ' + pdir + ' && ' + py + ' -m pdb ' + pEntry.filename,
        });
      }
      /* ── MATLAB / Octave ✓：只写文件，不编译 ✓（脚本语言 ✓） */
      if (lang === 'matlab' || lang === 'octave') {
        const mFiles = files.map((f, i) => ({
          filename: /\.m$/i.test(f.filename) ? f.filename : (i === 0 ? 'main.m' : ('file' + (i + 1) + '.m')),
          code: f.code,
        }));
        const mdir = writeFragments(mFiles);
        /* ★ 顺带写一个「取变量」小脚本 ✓✓（2026-10-10）——
           ⚠️ 为什么不在终端里直接发一长串 ✗：**352 字符的命令在真 PTY 里
              会被 readline 的换行重绘搞乱** ✓（实测：只看到回显、没有输出 ✓）。
           → 写成 `.m` 文件 ✓，终端里只要发 `cs_vars` 四个字母 ✓，
              短、稳、也好调试 ✓。
           ⚠️ 文件名带 `cs_` 前缀 ✗ —— 避免和用户的脚本撞名 ✓。 */
        try { writeFileAtomicSync(path.join(mdir, 'cs_vars.m'), CS_VARS_M); } catch (_) {}
        const mEntry = mFiles.find((f) => /main\.m$/i.test(f.filename)) || mFiles[0];
        const cmd = matlabCmd();
        if (!cmd) return send(res, 200, { ok: false, error: '这台机器上没有 MATLAB / Octave', dir: '' });
        return send(res, 200, {
          ok: true, dir: mdir, bin: '', engine: isOctaveCmd(cmd) ? 'octave' : 'matlab',
          entry: mEntry.filename.replace(/\.m$/i, ''),   /* dbstop/run 用的是**不带扩展名**的名字 ✓ */
          launch: (isOctaveCmd(cmd) ? 'octave --no-gui --quiet' : 'matlab'),
          hint: '在终端里： cd ' + mdir + ' && ' + (isOctaveCmd(cmd) ? 'octave --no-gui --quiet' : 'matlab'),
        });
      }
      /* ⚠️⚠️ 两个坑，都是实测踩出来的 ✗✗（2026-10-10）：
         ① **头文件不能进编译命令** ✗ ——
            `g++ -o a.out led.h led.c uart.c uart.h main.c` 会直接报
            `error: cannot specify -o when generating multiple output files`
            （编译器把每个 .h 也当成一个要产出的翻译单元了 ✓）
            → 只把**源文件**（.c/.cc/.cpp/.cxx）列进去 ✓。
         ② **`.c` 要用 gcc，不能用 g++** ✗ ——
            用 g++ 编 .c 会按 C++ 处理 ✓，刷一屏
            `treating 'c' input as 'c++' when in C++ mode, this behavior is deprecated` ✓，
            而且不少合法 C 代码在 C++ 下**直接编不过** ✓。
            → 按**入口文件**的后缀选 gcc / g++ ✓。
         ⚠️ 入口文件怎么认 ✗：优先找名字里带 `main` 的源文件 ✓
            （多文件片段的惯例 ✓），找不到就用第一个源文件 ✓。 */
      const srcFiles = files.filter((f) => /\.(c|cc|cpp|cxx)$/i.test(f.filename));
      if (!srcFiles.length) {
        return send(res, 200, { ok: false, error: '没有可编译的源文件（需要 .c / .cpp）', dir: '' });
      }
      const entry = srcFiles.find((f) => /main\./i.test(f.filename)) || srcFiles[0];
      const isC = /\.c$/i.test(entry.filename);
      const cc = isC ? 'gcc' : 'g++';
      const binName = 'a.out';
      const dir = writeFragments(files);
      const args = ['-g', '-O0', '-o', binName, ...srcFiles.map((f) => f.filename)];
      const built = await run(cc, args, { cwd: dir, timeoutMs: 120000 });
      if (!built.ok) {
        return send(res, 200, { ok: false, error: (built.stderr || built.stdout || '编译失败').trim(), dir: '' });
      }
      return send(res, 200, {
        ok: true, dir, bin: binName, cc,
        gdb: (() => { try { execFileSync('gdb', ['--version'], { stdio: 'ignore', timeout: 5000 }); return true; } catch (_) { return false; } })(),
        hint: '在终端里： cd ' + dir + ' && gdb ./' + binName,
      });
    } catch (e) {
      return send(res, 200, { ok: false, error: String((e && e.message) || e) });
    }
    }
  return false;   /* 这一组没吃掉，调用方继续往下走 */
}

module.exports = { handle };
