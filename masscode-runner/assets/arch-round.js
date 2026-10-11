/* 把正交折线的**拐角磨圆**（assets/arch-round.js）
 * ---------------------------------------------------------------------------
 * 用户原话：「**这有些箭头很怪，我需要美化，优化一下**」✓
 * 放大看：线全是**硬直角** ✓（正交走线就是这样 ✓），一段一段像电路板 ✓；
 * 加上箭头挤在一起 ✓，整体显得"硬" ✓。
 *
 * ★ 为什么单独一个文件 ✗：
 *   `arch-layout.js`（481/481）和 `arch-graph-svg.js`（132/132）**都顶到棘轮了** ✓；
 *   而"磨圆"是**纯字符串处理** ✓ —— 和布局、渲染都无关 ✓，还能单独测 ✓。
 *
 * ── 怎么磨 ──
 *   拐角 `L b` 前后各取 `r`，改成 `L p1  Q b  p2` ✓（二次贝塞尔，控制点就是原拐角 ✓）。
 *   ⚠️ `r` 要**同时**受两段长度的一半约束 ✓ —— 不然短线会被磨过头 ✓（磨成反向 ✓）。
 *
 * ⚠️⚠️ 为什么测试还能验：`tests/arch-geom.js` 的 `pointsOf` 是**按成对数字**取的 ✓，
 *    `Q cx cy x y` 正好解析成 `(cx,cy)` 和 `(x,y)` ✓ ——
 *    而 `(cx,cy)` **就是原来的拐角** ✓ → 断言验的仍然是**原折线** ✓
 *    （比磨圆后的更"外扩" ✓ → 只会更严格 ✓，不会误报 ✓）。
 */

function archRoundPath(d, r) {
  const radius = Number.isFinite(r) ? r : 6;
  const nums = String(d || '').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 6) return String(d || '');       /* 少于 3 个点 → 没拐角 ✓ */
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([+nums[i], +nums[i + 1]]);
  let out = 'M' + pts[0][0] + ' ' + pts[0][1];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1x = a[0] - b[0], v1y = a[1] - b[1];
    const v2x = c[0] - b[0], v2y = c[1] - b[1];
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (!l1 || !l2) { out += ' L' + b[0] + ' ' + b[1]; continue; }   /* 重合点 → 原样 ✓ */
    const rr = Math.min(radius, l1 / 2, l2 / 2);
    const x1 = b[0] + v1x / l1 * rr, y1 = b[1] + v1y / l1 * rr;
    const x2 = b[0] + v2x / l2 * rr, y2 = b[1] + v2y / l2 * rr;
    out += ' L' + x1.toFixed(1) + ' ' + y1.toFixed(1)
      + ' Q' + b[0] + ' ' + b[1] + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
  }
  const last = pts[pts.length - 1];
  return out + ' L' + last[0] + ' ' + last[1];
}

if (typeof module !== 'undefined' && module.exports) module.exports = { archRoundPath };
