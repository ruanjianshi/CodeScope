'use strict';
/*
 * 探针的数据保护罩（tests/probe-guard.js）
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 背景（2026-10-12 挖出来的**丢数据真因**）：
 *
 *   `tests/` 下有 **15+ 个「探针」** ✗ —— 它们的开头都写着
 *   「打本机真实实例（127.0.0.1:4877），没起就跳过」✓。
 *   也就是说：**它们操作的是你正在用的那个 CodeScope、写的是你的真实数据** ✗✗。
 *
 *   实测后果：跑一次 `npm run test:all`，`life-workbench.json`
 *   **82 个键掉到 77 个、11 个单词掉到 8 个** ✓（探针加词失败时留下了半截状态 ✓）。
 *   更早那次「东西都丢失了」也是这么来的 ✓ —— 不是产品代码在丢数据 ✓，
 *   是**测试在动真实数据** ✓。
 *
 * ⇒ 这个模块就干一件事：**跑探针之前快照，跑完（哪怕崩了）恢复** ✓。
 *
 * 用法（探针里加两行 ✓）：
 *   const guard = require('./probe-guard.js');
 *   guard.arm();          // 一开始就装好
 *   ... 探针正文 ...
 *   guard.disarm();       // 收尾（不调也行，退出钩子会兜底）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function storeFile() {
  const dataRoot = process.env.CODESCOPE_DATA_HOME
    || path.join(os.homedir(), 'Library', 'Application Support', 'CodeScope');
  return path.join(dataRoot, 'life-workbench.json');
}

let snapshot = null;
let armed = false;
let filePath = '';

function arm() {
  if (armed) return true;
  filePath = storeFile();
  try {
    snapshot = fs.readFileSync(filePath, 'utf8');
    armed = true;
    return true;
  } catch (_) {
    /* 没有这个文件（探针用的临时 data home ✓）→ 不需要保护 ✓ */
    snapshot = null;
    armed = false;
    return false;
  }
}

function disarm() {
  if (!armed || snapshot == null) return false;
  armed = false;
  try {
    const now = fs.readFileSync(filePath, 'utf8');
    if (now === snapshot) return false;                 /* 没被动过 ✓ */
    fs.writeFileSync(filePath, snapshot);               /* 原样放回 ✓ */
    console.log('  🔒 探针动过真实数据 —— 已按快照还原（life-workbench.json）');
    return true;
  } catch (_) { return false; }
}

/* 兜底：探针崩了 / 被 Ctrl-C 也要还原 ✓ —— 不然"跑一次测试丢一次数据" ✓。 */
function installExitHooks() {
  for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
    process.on(sig, () => { try { disarm(); } catch (_) {} });
  }
}
installExitHooks();

module.exports = { arm, disarm, storeFile };
