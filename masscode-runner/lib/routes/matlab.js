#!/usr/bin/env node
'use strict';
/*
 * 路由：matlab（/api/matlab/*）
 * ---------------------------------------------------------------------------
 * ★ 从 server.js 抽出来的（2026-10-11），用 tools/extract-routes-all.js ✓
 *
 * ── 约定（每个 lib/routes/*.js 都一样）──
 *   ① 导出 `async function handle(req, res, u, ctx) → boolean`；
 *   ② **处理了就返回 true**，没处理返回 false，让调用方继续往下走
 *      （路由是**顺序 if**，不返回的话会继续往下撞别的分支）；
 *   ③ **依赖用 ctx 显式传**，不用全局 ——
 *      显式传看起来啰嗦，但**看得见依赖**；全局看不见，拆到第三个文件就没人敢动了。
 *
 * ⚠️ 下面的 ctx 解构是**工具扫出来**的（扫 server.js 的顶层名字 ✓），
 *    不是人写的 —— 所以它应该刚好等于"这组真正用到的外部符号" ✓。
 *    如果手工改了这里，记得同步 server.js 的调用点 ✓。
 */

async function handle(req, res, u, ctx) {
  const { matlabCmd, send, installHint, isOctaveCmd } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/matlab/console') {
    /* ★ MATLAB / Octave 命令窗口 ✓✓（2026-10-09）
       用户原话：「matlab/octave 那种命令窗口也需要给我完成复刻过来，
                 就是那种可以输入指令的」✓。
       ✅ 做法：**不另造 REPL** ✗ —— 直接用现有的底部终端（真 PTY ✓），
          这里只负责告诉前端「该敲哪条命令」✓。
          MATLAB 用 `-nodesktop -nosplash`（不带界面、留在终端里 ✓），
          Octave 用 `--no-gui --quiet` ✓ —— 都是**留在前台交互**的参数 ✓，
          和「跑脚本」用的 `-batch` 不一样 ✗（那个跑完就退出 ✓）。
       ⚠️ 两个都没装时返回 ok:false + 安装提示 ✓，
          前端据此给出可操作的下一步 ✓（而不是静默失败 ✓）。 */
    const cmd = matlabCmd();
    if (!cmd) {
      return send(res, 200, {
        ok: false,
        error: '这台机器上 MATLAB 和 Octave 都没装',
        hint: installHint('octave'),
      });
    }
    const octave = isOctaveCmd(cmd);
    return send(res, 200, {
      ok: true,
      engine: octave ? 'octave' : 'matlab',
      label: octave ? 'GNU Octave' : 'MATLAB',
      argv: octave ? [cmd, '--no-gui', '--quiet'] : [cmd, '-nodesktop', '-nosplash'],
    });
    }
  /* ★★ 判断标准不是「我 return 了吗」，而是「响应发出去了吗」（2026-10-11 实测修）——
     ⚠️ 根因：原来这里写 `return false`，但**分支里那些 `return streamStatic(...)`
        和 `return send(...)`**，在原始 router 里 `return` 退出的是**整个 router**；
        抽到 handle 里之后，它只退出 handle ——
        而 `streamStatic` 返回 `undefined` → handle 返回 `undefined` →
        调用方当成「没处理」→ 继续往下走 → 撞到 404 兜底。
        （实测：POST /api/study/asset 正常，GET 同一个地址却 404。）
     → 用 `res.writableEnded` 判断：**响应发了就算吃掉**，
       不管中间是 `return send(...)` 还是 `return streamStatic(...)`。 */
  return res.writableEnded === true;
}

module.exports = { handle };
