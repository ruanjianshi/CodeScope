/* 运行历史 + 行级差异（纯逻辑，不碰 DOM）
 * ---------------------------------------------------------------------------
 * ★ 为什么单独一个文件（2026-10-19）——
 *   `assets/app.js` 有**代码行数棘轮**（只准变小 ✗），而这批逻辑是**纯数据** ✓：
 *   环形缓冲、按 id 取、两段输出的行级 diff ✓。和 DOM 一点关系都没有 ✓ →
 *   放独立文件既能被单测直接 require ✓，也不用为了它去抬 app.js 的上限 ✓。
 *
 * ★ 为什么需要它 ——
 *   原来每次点「运行」，`showOut()` 第一行就是 `b.innerHTML = ''` ✓ →
 *   **上一次的输出直接没了** ✗。改一行代码想看「输出变了没」，只能靠记忆 ✓。
 *
 * ★ 铁律：**只存不解析** ✓ —— 这里保存的 stdout/stderr 是**程序原样输出** ✓，
 *   不做 trim、不合并空白 ✓（diff 是按行比，动了就比不准了 ✓）。
 */
(function () {
  'use strict';
  const MAX = 40;            // 留 40 次够回看；再多也没人翻 ✓
  const DIFF_MAX_LINES = 800; // LCS 是 O(n·m)，800×800 已是 64 万格 ✓ 再大就退化成逐行比 ✓
  const items = [];
  let seq = 0;

  function push(entry) {
    const e = entry || {};
    const record = {
      id: ++seq,
      at: Number(e.at) || Date.now(),
      ms: Math.max(0, Number(e.ms) || 0),
      code: e.code == null ? null : e.code,
      ok: !!e.ok,
      timedOut: !!e.timedOut,
      unsupported: !!e.unsupported,
      file: String(e.file || ''),
      fragment: Number(e.fragment) || 0,
      label: String(e.label || ''),
      language: String(e.language || ''),
      input: String(e.input || ''),
      stdout: String(e.stdout == null ? '' : e.stdout),
      stderr: String(e.stderr == null ? '' : e.stderr),
      imageCount: Number(e.imageCount) || 0,
    };
    items.unshift(record);
    if (items.length > MAX) items.length = MAX;
    return record;
  }

  const list = () => items.slice();
  const get = (id) => items.find((x) => x.id === Number(id)) || null;
  const clear = () => { items.length = 0; };
  /** 上一次 = 比 id 小的那条里最新的 ✓（列表是倒序的，不能直接取下标 ✗） */
  function previousOf(id) {
    const i = items.findIndex((x) => x.id === Number(id));
    return i >= 0 && i + 1 < items.length ? items[i + 1] : null;
  }

  /** 取第一行有内容的输出，做列表里的摘要 ✓ */
  function summarize(text, max) {
    const lines = String(text || '').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (t) return t.length > (max || 80) ? t.slice(0, max || 80) + '…' : t;
    }
    return '';
  }

  /**
   * 行级 diff（LCS）→ 统一格式的行数组
   *   [{ type:'same'|'add'|'del', text, a, b }]   a/b = 各自的行号（1 起，没有则 null）
   * ⚠️ 用 LCS 而不是「按行号对齐」✗ —— 中间插了一行，按行号比会把后面**全部**标成改动 ✓。
   */
  function diffLines(aText, bText) {
    let a = String(aText == null ? '' : aText).split('\n');
    let b = String(bText == null ? '' : bText).split('\n');
    /* 末尾那个空行是 split 的副产物 ✓（两段都以 \n 结尾时会各多一行 ""） */
    if (a.length && a[a.length - 1] === '') a.pop();
    if (b.length && b[b.length - 1] === '') b.pop();
    const truncated = a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES;
    if (truncated) { a = a.slice(0, DIFF_MAX_LINES); b = b.slice(0, DIFF_MAX_LINES); }

    const n = a.length, m = b.length;
    /* 先砍掉公共前后缀 —— 绝大多数「改一行」的情况在这里就结束了 ✓，不用建 DP 表 ✓ */
    let head = 0;
    while (head < n && head < m && a[head] === b[head]) head += 1;
    let tailA = n, tailB = m;
    while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) { tailA -= 1; tailB -= 1; }

    const out = [];
    for (let i = 0; i < head; i += 1) out.push({ type: 'same', text: a[i], a: i + 1, b: i + 1 });

    const midA = a.slice(head, tailA), midB = b.slice(head, tailB);
    const rows = midA.length, cols = midB.length;
    if (rows && cols && rows * cols <= DIFF_MAX_LINES * DIFF_MAX_LINES) {
      const dp = new Uint32Array((rows + 1) * (cols + 1));
      const at = (i, j) => i * (cols + 1) + j;
      for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = cols - 1; j >= 0; j -= 1) {
          dp[at(i, j)] = midA[i] === midB[j]
            ? dp[at(i + 1, j + 1)] + 1
            : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
        }
      }
      let i = 0, j = 0;
      while (i < rows && j < cols) {
        if (midA[i] === midB[j]) { out.push({ type: 'same', text: midA[i], a: head + i + 1, b: head + j + 1 }); i += 1; j += 1; }
        else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) { out.push({ type: 'del', text: midA[i], a: head + i + 1, b: null }); i += 1; }
        else { out.push({ type: 'add', text: midB[j], a: null, b: head + j + 1 }); j += 1; }
      }
      for (; i < rows; i += 1) out.push({ type: 'del', text: midA[i], a: head + i + 1, b: null });
      for (; j < cols; j += 1) out.push({ type: 'add', text: midB[j], a: null, b: head + j + 1 });
    } else {
      /* 退化：不建表，逐行比 ✓（只是"哪几行不一样"，不做最优对齐 ✓） */
      const len = Math.max(rows, cols);
      for (let k = 0; k < len; k += 1) {
        const la = k < rows ? midA[k] : null;
        const lb = k < cols ? midB[k] : null;
        if (la === lb) out.push({ type: 'same', text: la, a: head + k + 1, b: head + k + 1 });
        else {
          if (la != null) out.push({ type: 'del', text: la, a: head + k + 1, b: null });
          if (lb != null) out.push({ type: 'add', text: lb, a: null, b: head + k + 1 });
        }
      }
    }
    for (let k = 0; k < n - tailA; k += 1) out.push({ type: 'same', text: a[tailA + k], a: tailA + k + 1, b: tailB + k + 1 });

    const added = out.filter((x) => x.type === 'add').length;
    const removed = out.filter((x) => x.type === 'del').length;
    return { rows: out, added, removed, truncated, same: !added && !removed };
  }

  const API = { push, list, get, previousOf, clear, summarize, diffLines, MAX };
  /* ⚠️ 两边都要挂 ✓：浏览器走 `window.CS_RUNS` ✓，Node 单测走 `module.exports` ✓ ——
     直接写 `window.CS_RUNS = …` 在 Node 里是 ReferenceError ✗（第一次跑单测就炸了 ✓）。 */
  if (typeof window !== 'undefined') window.CS_RUNS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
