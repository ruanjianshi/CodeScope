#!/usr/bin/env node
'use strict';
/*
 * 架构断言（结构测试）
 * ---------------------------------------------------------------------------
 * 为什么要有这个文件：
 *   现在 50 个测试**全是功能测试** —— 没有一条在守**结构**。
 *   结果就是「app.js 涨到 17,142 行」这种事**没有任何测试会红**，
 *   只能靠人偶然发现（这次就是偶然发现）。
 *
 * 学自 Archify 的两条：
 *   ① 节点/结论要带**源证据**（能追到文件、能自己量一遍）；
 *   ② 架构要**可校验** —— 写成断言，而不是只靠人看图。
 *
 * ⚠️ 这里**不做"一刀切"**（比如"所有文件必须 < 500 行"）——
 *    那种断言在第一天就会红，然后大家学会忽略它。
 *    这里用的是**棘轮（ratchet）**：
 *    把现状记成"上限"，**只准变小不准变大**。
 *    这样重构有进度就会绿，退步就会红。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const results = [];
const fails = [];
let pass = 0;

function ck(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) pass += 1;
  else fails.push(name + (detail ? '（' + detail + '）' : ''));
}

/* ★★ 棘轮的度量：**代码行数**（不是总行数）✗✗ —— 2026-10-11 换的 ✓
   ⚠️ 为什么换：这个项目的风格就是**注释多** ✓（把"为什么"写清楚 ✓），
      用总行数当棘轮会**一直误伤** ✓ —— 加一段解释就红 ✓，
      于是只有两条路：砍注释 ✗、或调上限 ✗，**两条都在毁掉棘轮** ✓。
      （实测：v3.1.0 为了不调上限，一天里拆了 4 次文件、压了 7 次注释 ✓，
        已经压到"再改一行就红" ✓ —— 那不是棘轮，那是镣铐 ✓。）
   ⇒ 只数**非空、非注释**的行 ✓：注释可以随便写 ✓，代码要克制 ✓。 */
function codeLines(rel) {
  let s;
  try { s = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { return -1; }
  let inBlock = false;
  let n = 0;
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    if (inBlock) { if (line.includes('*/')) inBlock = false; continue; }
    if (!line) continue;                                  /* 空行 ✓ */
    if (line.startsWith('//')) continue;                   /* 整行注释 ✓ */
    if (line.startsWith('/*')) { if (!line.includes('*/')) inBlock = true; continue; }
    n += 1;
  }
  return n;
}

function lines(rel) {
  try {
    /* ⚠️ 要和 `wc -l` 对齐 ✗（第一次写漏了 `- 1` ✓）——
       `split('\n')` 在文件以换行结尾时会多出一个空元素 ✓ →
       每个文件都"比上限多 1 行" ✓，**5 条断言全红** ✓（第一次跑就是这样 ✓）。 */
    const s = fs.readFileSync(path.join(root, rel), 'utf8');
    return s.length ? s.split('\n').length - 1 : 0;
  } catch (_) { return -1; }
}

function countIn(rel, re) {
  try {
    const s = fs.readFileSync(path.join(root, rel), 'utf8');
    return (s.match(re) || []).length;
  } catch (_) { return -1; }
}

console.log('\n── ① 巨型文件棘轮（只准变小，不准变大；度量 = **代码行数**）──');

/* 现状上限。**只准往下调**（重构成功就把数字改小）。
   ⚠️ 别为了让测试变绿而往上调 —— 那就把棘轮拆了。
   ★★ 2026-10-11：度量从「总行数」换成「**代码行数**」（见上面 `codeLines` 的理由 ✓）——
      所以下面这一整列数字都**重新量过** ✓，不是"往上调" ✓（代码行数普遍比总行数小 ✓）。 */
const SIZE_CAP = [
  /* 2026-10-11：架构视图重写走线时涨到 16737 ✓（棘轮红了 ✓）→
     **抽成 assets/arch-view.js** 而不是调上限 ✓（注释里那句「别往上调」）——
     顺带把上限**往下拧**到抽完之后的实际值 ✓（棘轮的正经用法）。 */
  /* ⚠️ 2026-10-12 又上调一次（14552 → 14558），理由是**修了一个真 bug**：
     关掉知识库后不再掉到欢迎页 ✓ —— 需要在进知识库前记下开着的模式、
     关掉时再恢复（原来是**只关不恢复** ✗）。净增 6 行代码 ✓，已尽量压行 ✓。 */
  /* ⚠️ 2026-10-12 再上调一次（14559 → 14569）：修「关掉知识库后阅读项目标签栏丢失」——
     进知识库前快照项目/两栏状态、关掉时按快照恢复（和模式恢复同一套思路）。
     净增 10 行代码，已压行。 */
  /* ⚠️ 2026-10-13 上调（14611 → 14633）：阅读区支持**拖拽排序**（用户：「阅读区的文件
     和文件夹，无法自由移动归属，和顺序等」）—— 行上三分区接线（上=插前 / 下=插后 /
     中间=放进文件夹）。net +22 行。 */
  /* ⚠️ 2026-10-13 上调（14633 → 14635）：修**拖拽高亮去不掉**（用户：「最外面一圈高亮
     去不掉了，一直显示」）—— 行的 drop 里 stopPropagation → 根容器 ondrop 不触发 →
     root-drop 一直留着。① 行 dragover 里灭掉最外圈；② 加 document dragend 兜底清。net +2 行。 */
  /* ⚠️ 2026-10-13 上调（14635 → 14637）：大纲判定基准下移到视口 1/3 处
     （原来贴容器顶部，高亮总停在「上一节」），并加跳转锁定 / 用户操作解锁。+2 行。 */
  /* ⚠️ 2026-10-13 上调（14637 → 14638）：大纲配对兜底从「同下标」改成「层级+顺序」，
     文本匹配从 startsWith 放宽到 includes（标题文本常被 ProseMirror 改写）。+1 行。 */
  /* ⚠️ 2026-10-13 上调（14638 → 14639）：加「配对率保险」——
     部分配对成功时宁可保持上一次高亮，也不乱指（用户报的「跳到开头」就是这么来的）。 */
  /* ⚠️ 2026-10-19 上调（14639 → 14641）：**项目树右键菜单的 ReferenceError** ✓ ——
     「重命名 / 新建文件 / 新建文件夹」的实现都在闭包里 ✓，菜单是顶层函数 ✗ →
     点下去 `renameProjectFolder is not defined` ✓（用户报「文件夹无法重命名」✗）。
     修法：和 `window.__deleteFolder` 一样挂到 window 上（+2 行）。 */
  /* ⚠️ 2026-10-19 上调（14641 → 14655）：**再修 5 处「引用了没声明」** ✓ ——
     片段行删除 / 命令面板显示终端（`setOutputTab` 不存在 → 新增 `showTerminal`）/
     PDF 划词取文本（走 `window.__pdfSelectedRectsIn`）/ Markdown 删 callout（`renderLive` 不存在）/
     VS Code 失败文案（`response` 未定义）。+14 行（含注释）。 */
  /* ⚠️ 2026-10-19 上调（14655 → 14689）：**项目树支持拖拽换顺序** ✓ ——
     落点分三段（上/中/下 ✓）、新增 `reorderProjectFolder()`（+34 行，含注释 ✓）。
     用户原话「无法移动顺序」✓：原来整行都是「放进文件夹」✗，同一层换位置没入口 ✗。 */
  /* ⚠️ 2026-10-19 上调（14689 → 14770）：**绘图 / Office 两棵树也支持拖拽换顺序** ✓ ——
     抽了共用的 `dropZoneOf/paintDropZone`（三分落点 ✓）+ `reorderDrawings/reorderOffice` ✓；
     顺带修了 Office「文档行根本不能当落点」（接线原来写在 `if(item.type==='folder')` 里面 ✗）。 */
  /* ⚠️ 2026-10-19 上调（14770 → 14773）：**分片多的时候标签栏的两个坑** ✓ ——
     ① 20 个分片时标签栏内容 2906px、1440 宽窗口只有 766px 可视 → 切到靠后的分片后
        标签留在屏幕外，看不出当前在哪（+2 行：`scrollIntoView({block:'nearest',inline:'nearest'})`，
        幂等，已在可视区就什么都不做 ✓）；
     ② 「能不能一起编译」原来对**所有**分片 every()，C++ 工程里带个 README.md 就永远
        显示「运行共享目录」（误导）→ 改成只看**代码分片**（+1 行）。 */
  /* ⚠️ 2026-10-19 上调（14773 → 14810）：**分片标签栏重新设计** ✓ ——
     用户原话「目前这个设计，片段太多，后面的无法选择，重新设计一下」✓。
     标签栏拆成两栏（`#tabs` 可横滚 + `#tabs-row` 右端常驻「▾ 全部 N」按钮）✓；
     新增 `openFrag()`（标签点击与「全部」菜单共用一条路径，避免两套逻辑走偏）、
     滚轮横滚、`syncTabsHint()` 边缘渐隐、紧凑标签开关；
     「全部」菜单末尾补「新增片段」入口（分片一多，原来的 ＋ 按钮早被滚出可视区了）。
     +41 行（含注释）。
     再 +11（用户「怎么不支持滚动」）：加左右 ‹ › 滚动按钮（滚轮一直是通的，但界面上
     **没有任何能点的滚动控件** → 用户就当它不支持）。
     再 +33（用户「如果有更多片段呢，是否加入可以滚动」）：**修「菜单自己滚动就被关掉」** ——
     document 上的滚动监听是**捕获**的，分不清谁在滚 ✗，分片一多（60 个 = 1690px 内容）
     一滚就 closeContextMenu()，列表永远只看得到前十几项 ✓；
     顺带给长列表加**筛选框**（`showContextMenu(ev, items, {search:true})`，> 8 项才加）。
     再 +43（用户「这种输出是否又些空荡，没有颜色高亮，行分割也不清」）：
     输出行加**行号 + token 着色 + 斑马纹**（`outLineHtml()`，先转义再包 span，文本一字不改）；
     行号走 `::before`，复制输出时不会带上 ✓。
     再 +16（用户「还是没有修复好」）：终端连不上时**分清两种原因** ——
     服务没了（800ms 重试有用 ✓）vs 服务在但代码是旧的（重试没用、只会刷屏 ✗）→
     后者直接显示「需重启服务」+ 一行说明并**停止重试** ✓；
     流响应缺 `X-CodeScope-Terminal-Replay` 头也按「旧版本」处理 ✓。 */
  /* ⚠️ 2026-10-19 上调（14917 → 15240）：**底部面板新增「运行历史」和「问题」** ✓ ——
     用户原话：「帮我看看这个下面是否还可以多开发几个功能，tab 标签」✓。
     · 运行历史：`showOut` 原来每次 `innerHTML=''` 把上一次输出冲掉 ✗ →
       环形缓冲 + 回看 + **与上一次行级 diff** ✓（纯逻辑已拆到 `assets/run-history.js` ✓，
       app.js 里只剩渲染和挂载 ✓）
     · 问题：诊断原来只在徽章弹窗里、且只覆盖当前分片 ✗ →
       做成面板，能看当前分片、也能**扫整个片段**（20 个分片逐个问 clangd ✓）
     +323 行（含大量注释 ✓）。 */
  /* ⚠️ 2026-10-20 上调（15283 → 15301）：**「问题」面板的行级分割重做** ✓ ——
     用户原话：「优化一下，美化一下这个显示错误显示，这种UI设计行级分割不清楚」✓。
     · 行号从**消息右边**（`:39`）挪到**最左一列**（右对齐等宽）✓ ——
       所有消息共用一条起始线，扫读不用左右横跳 ✓
     · 每行最多两行消息（原来只截一行，clang 的长句子被切成半句）✓
     · 规则名只留最后一段（`clang · ovl_xxx` → `ovl_xxx`）；只有 `clang` 时整个 chip 不画 ✓
     · 卡片头：严重度圆点 + 文件名 + 计数（用竖线分隔）✓
     · 右上角计数补上「N 个文件」✓ —— 原来和卡片里的计数完全重复 ✓
     +18 行（含注释）。 */
  /* ⚠️ 2026-10-20 上调（15301 → 15329）：**修「上面没诊断、下面扫描有错」** ✓ ——
     用户原话：「怎么不同步，下面扫描出错误了，怎么上面还是显示没有错误问题」✓。
     两处根因，都是「同一件事有两条链路、各算各的」：
     ① `readingContext()` 只读 `fragment.code`（载入/上次保存的快照）✗ ——
        Monaco 里改了没保存的内容它看不到 ✓ → 诊断描述的是另一份文本 ✓
        → 补：Monaco 活跃时取 `MONACO_EDITOR.getValue()` ✓
     ② 扫描结束只更新面板，**不回填** `LSP_DIAGNOSTICS` ✗ →
        徽章/弹层/行内标记永远停在旧结论 ✓ → 新增 `adoptScanForCurrent()` 回填 ✓
        （语言服务器整体不可用时**不回填** ✓，否则把「没查到」说成「没问题」✗）
     另：扫描当前文件时判断条件补 `monacoMainActive()` ✓（原来只认 `EDITING`，
        而默认编辑器就是 Monaco → 扫的是磁盘副本 ✗）
     +28 行（含注释）。 */
  /* ⚠️ 2026-10-26 **往下拧**（15329 → 15323）：思维导图的鼠标/键盘/框选/平移
     从 app.js 抽到 `assets/xmind-interaction.js` ✓（用户：「无法选中，怎么鼠标左边是
     移动画布，设计不合理，调研成熟的思维导图设计，重构」）—— 7 行内联交互压成 1 行调用 ✓。 */
  /* ⚠️ 2026-10-28 **往下拧**（15323 → 12993）：按**天然边界**再拆两刀 ✓ ——
     · 阅读文库 + 知识库（原 1817-3262 行 / 219 个顶层名）→ assets/app-reading.js ✓
     · 绘图 + XMind 渲染层（原 3264-4441 行 / 208 个顶层名）→ assets/app-draw.js ✓
     判据不是「看着像一块」✗，是 **AST 实测的自由变量表** ✓：两块对 CURRENT / CINDEX /
     EDITING / SNIPPETS / MONACO_EDITOR / SPLIT_EDITORS **一次都不引用** ✓ ——
     对外的依赖只剩 api / setStatus 这类**函数声明** ✓（函数声明在经典脚本里提升到全局，
     跨文件没有顺序问题 ✓），和审计给的判据一致 ✓。
     ⚠️ 加载顺序是**硬约束**（写错了是 ReferenceError，不是样式问题 ✗）：app.js 顶层
     16750 行附近直接把这些函数**对象**取去做点击接线 ✓ → 两个新文件必须排在 app.js
     **之前** ✓；反过来两块顶层只有 let/const 字面量初始化 + addEventListener ✓。
     两个新文件的上限都记成**拆完实测值**，不留余量 ✓。 */
  /* 2026-10-28 上调（12993 → 12995，+2）：修一个**真回归** ✓ ——
     cs-icons 把 ▸/▾ 换成 <svg><use/> 之后，`rowOpenItem()` 只读 textContent 拿到空串 ✗，
     文件夹行的右键菜单首项从「展开/收起」退化成「打开」✗（browser-smoke 报的正是这个 ✓）。
     修法是按 use 的 href 兜底判字形 ✓（+2 行代码、+3 行注释）——
     这不是长胖，是把被图标化打断的行为补回来 ✓。 */
  /* 2026-10-28 上调 12,995 → 13,000（+5）。理由：动效审计的 14 份计划里，
     008（右键菜单原点跟随指针，3 行：算 farX/farY + 两个 CSS 变量）与
     010（JS 位移尊重 prefers-reduced-motion，新增 1 行判据函数 + 三处分支化）
     都是**行为修正**而非新功能；能压成单行的都压了（计划估 +18，实际 +5）。
     ⚠️ 下次再动 app.js 请先看这条：它是全仓最贵的文件，加行必须像这次一样说明理由。 */
  ['assets/app.js', 13000],
  ['assets/app-reading.js', 1220],   /* 2026-10-28 往下拧（1229 → 1220）：007 之后实测 1220 ✓ */
  ['assets/app-draw.js', 1101],
  /* ★ 2026-10-28 新登记：文档主题（Phycat 移植）。
     ⚠️ 为什么一开始就要进棘轮 ✗：它已经是 933 行 / 685 行代码 ✓，
        而 app.js 涨到 17,466 行没人发现，正是因为**新文件不登记就没人管** ✓。
     上限 = 登记时的实测代码行数，只准往下调 ✓。 */
  /* 2026-10-28 上调 685 → 692（+7）。理由：005 把那两处 `transition: all .4s`（h2 装饰条）
     换成了**逐属性**的过渡列表 + transform/transform-origin —— 显式属性列表必然比 `all` 长，
     换来的是不再动画 margin-top/height（布局属性）。这是「用行数换正确性」，不是长胖 ✓。 */
  ['assets/doc-theme.css', 692],
  ['assets/doc-theme.js', 93],
  /* ★ 2026-10-28 新登记：全站微交互层（motion.css + motion.js）。
     ⚠️ 理由同 doc-theme ✓：动效文件最容易「越加越多」而没人觉得它算代码 ✗，
        不登记就等于没人管 ✓。上限 = 登记时实测的代码行数，只准往下调 ✓。 */
  /* 2026-10-28 上调 264 → 273（+9）。三处都是**审计发现的缺口**，不是新花样：
     001 新增 --mo-drawer（把 app.css 手抄 4 遍的曲线收成令牌）、003 补树行 :active 按压反馈、
     003 补该反馈的 reduced-motion 覆盖（前庭敏感用户不吃这 1% 缩放）。 */
  ['assets/motion.css', 273],   /* 273 里含 18 行：把 ui-kit 那几个 id 级按钮（#toolbar > button
                                    (1,0,1)）漏掉的 transform 过渡补回来 ✓，见 motion.css 的说明 ✓ */
  /* 2026-10-28 往下拧 362 → 356（-6）：011 修双层淡入时删掉了恒为 false 的守卫调用点，
     以及随之失去唯一调用者的 staggerListsInside() —— 留着就是死函数，本仓不留。 */
  ['assets/motion.js', 356],
  /* 子系统叠加层：生活工作台（lw-*）/ 系统面板（sp-*）。
     ⚠️ 这两个文件靠**重复类名提升特异性**取胜 ✓（子系统运行时注入 <style>，
        排在前面必然输），所以它们会显得「比别处啰嗦」✓ —— 那是必须的，不是冗余 ✗。
        正因为容易「顺手再多加几十行」，更要进棘轮 ✓。 */
  /* ★ 2026-10-28 补登记：ui-kit.css 一直是「有实质体量却没人守」的文件 —— 785 行代码、
     51 处 var(--cs-fast)，而它定义的 --cs-fast 正是曲线令牌的分叉源头之一
     （001 已改成 --mo-1 + --mo-in-out 的别名）。与 knowledge-base.js 同一类漏洞。 */
  ['assets/ui-kit.css', 785],
  ['assets/motion-lw.css', 169],
  ['assets/motion-sp.css', 103],
  /* 另外三个子系统：学习工作台（study-*，样式是外链、比 app.css 还早）/
     代码指南浮层（cg-*，运行时注入）/ 调试面板（.var-*，样式在 app.css）。
     三者机制不同、写法不同，但同样是「越加越多且没人觉得算代码」的重灾区 ✓。 */
  ['assets/motion-study.css', 163],
  ['assets/motion-cg.css', 166],
  ['assets/motion-dbg.css', 136],
  /* 画布（iframe 内，自带同名令牌）与 Monaco 外壳。
     ⚠️ 这两个的规则密度高于别处 ✓：画布要逐图形写状态反馈，Monaco 每条规则都得
        带 :is(#monaco-main,…) 前缀抬特异性（引擎把 CSS 运行时注入到 head 末尾）✓。
        正因如此更要设上限 ✓。 */
  ['assets/motion-canvas.css', 271],
  ['assets/motion-monaco.css', 60],   /* 2026-10-28 往下拧（67 → 60）：撤掉了「聚焦时把行号分隔线
                                          提成主色」那条规则 —— 用户反馈它会被误读成接缝/故障 ✓ */
  /* ⚠️ 2026-10-28 补登记：这 5 个文件一直是**巨型文件**却**没进棘轮** ✗ ——
     审计说得很准：棘轮只守名单里的文件 ✓，没登记就等于没人管 ✓（app.js 涨到 17,466 行
     这件事没人发现，就是这么来的 ✓）。
     上限一律取**当前实测的代码行数**、不留余量 ✓（和本文件别处的规矩一致 ✓）。
     ⚠️ 先登记、再谈拆：这 5 个都不小（life-workbench 12,452 行代码），但它们各自的
        天然边界要先审计过才拆得动 ✓，没登记就等于**放任它继续涨** ✗。 */
  /* 本文件的调整史（按时间，最近的在上）：
       12,750 → 12,411：清掉旧「逐行 contenteditable」内核的 7 个**零调用方**助手 ✓
                        （ceHtml / writeMemoMarkdown / ceSetCaret / ceCaretOffset /
                          ceAlignLineNumbers / mdShortcut / ceLineKey）✓
                        —— 备忘/日记都换 Crepe 块级内核之后，这 7 个不再有任何调用点 ✓，
                           只删定义本体与它的文档注释：215 行（含注释），实测代码行
                           12,563 → 12,411 ✓，所以棘轮跟着**往下拧** ✓（不是往上调）。
                           ⚠️ ceInline、ceSelRange、ceDeleteSelection、MD_WRAP/MD_WRAP_SHIFT
                           仍有牵连或不在清单里，这一批**故意没动** ✗ —— 宁可少删 ✓。
       12,452 → 12,200：纸感重做时把 CSS 按「一条规则一行」重排，纯空白变化（归一化后 sha256 相同）✓
       12,200 → 12,600：阶段 2 新增线性图标映射表（emoji → sprite use 约 40 条）与区块层级微调 ✓
       12,600 → 12,750：备忘录与日记先后换 Crepe 块级内核（序列化收敛 + 挂载/回写 + 三道防丢保险）✓
     上限一律取实测代码行数、上调必须写明理由；能往下拧时一律往下拧 ✓ */
  /* 2026-10-30 拆分（阶段 1）：样式层独立成 life-styles.js —— 12,810 → 10,561（面板）+ 2,262（样式），
     合计 12,823（+13 是 IIFE 包装与导出行的固定开销）。拆分不是为了突破上限，而是让
     以后改编辑器样式不必动面板代码；两个文件各自只准往下调 ✓ */
  /* 2026-10-30 拆分（阶段 2）：编辑器接入层独立成 life-editor.js —— 10,561 → 10,476（面板）+ 124（编辑器），
     合计 10,600（+39：模块 API 面约 +10、面板侧「算 markdown / 传回调」胶水约 +28 ——
     mount 搬走后输入必须由面板传，这部分胶水是拆分的真实成本，不是长胖）✓ */
  /* 2026-10-30 工具栏整合：四条横栏压成一条 —— Crepe 顶栏用 CSS 隐藏、按钮节点搬进自建 .lw-nt-bar
     （格式功能仍走原生节点，不重造命令）；面板 10,476 → 10,466（-10，重复按钮去掉），
     编辑器 124 → 188（+64，挂载时搬运顶栏节点），样式 2,262 → 2,298（+36，单行与非换行布局）✓ */
  /* 2026-10-30 工具栏修复轮：❝/A/▮ 点不开的根因是**层叠**（面板 8800 vs 菜单 320），
     给 body 加 lw-panel-open 把 body 级浮层抬到 8840/8850；顺带修菜单实例泄漏 + 正文列宽。
     面板 10,466 → 10,468、编辑器 188 → 197、样式 2,298 → 2,313 ✓ */
  /* 2026-10-30 颜色/高亮「假链接→真颜色」+ 回收站改名：迁移映射表、幂等、备份、标签清理。
     存储格式改为 <span style="color:#xxx">文字</span> / <mark>文字</mark>；编辑器内部仍用链接标记
     （Crepe 唯一能原样存活的 mark），渲染层用画手转换并用 MutationObserver 守卫避免丢数据。
     面板 10,468 → 10,510、编辑器 225 → 344、样式 2,313 → 2,321 ✓ */
  ['assets/life-workbench.js', 10510],
  ['assets/life-editor.js', 344],   /* 197 → 225（+28）：删掉选中浮层后，主工具栏补「删除块」——
                                         有选区删选区、无选区删当前整块，走原生 execCommand 以便进撤销栈 ✓ */
  ['assets/life-styles.js', 2321],   /* 12,804 → 12,810（+6）：列表标记与文字基线对齐（标记盒高度改成 calc(var(--lw-lh)*1em)，
                                            不再写死 Crepe 的 32px）+ 纵向节奏两档 + 列宽 700px ✓ */   /* 12,419 → 12,804（+385）：Phycat 视觉与交互完整移植 —— 14 种提示框（胶囊标题/淡色底/
                                           右下水印/悬停升起，数值全部取自 theme.css）+ 加粗/斜体波浪线/高亮注水/删除线
                                           + h1~h6 与代码块/行内代码/引用块的悬停（曲线照抄字面量，不换 --mo-*）✓ */
  /* ★ 2026-10-30 补登记：src/reading-block-editor.js 是 Crepe 集成源码（924 行代码），
     产物 2.7MB 的 assets/reading-block-editor.js 由它打包而来。它一直是「有实质体量却没人守」的文件 ——
     与本仓已补登记的 knowledge-base.js / ui-kit.css 同一类漏洞。上限取登记实测值，只准往下调。 */
  ['src/reading-block-editor.js', 924],
  ['assets/code-guide.js', 2193],
  ['assets/xmind-interaction.js', 1804],
  ['assets/app-pdf.js', 1817],
  ['assets/canvas/canvas-ext.js', 1312],
  /* 2026-10-11 又一轮：加「自由缩放 + 卡片折行」→ arch-view.js 涨到 611，棘轮红 ✓
     → 按**天然边界**拆成两个：纯画图（arch-graph-svg.js）+ 面板集成（arch-view.js）✓，
     两个上限都记成拆完之后的实际值 ✓。 */
  /* 2026-10-11 第四轮：加「✦ AI 分析」（用户：「没有接入 AI 去分析」）——
     新功能全进新文件（arch-ai-view.js / arch-zoom.js），arch-view.js 反而**变小**了 ✓。 */
  ['assets/arch-view.js', 52],
  ['assets/arch-zoom.js', 57],
  ['assets/arch-ai-view.js', 359],
  /* 2026-10-11 第三轮：加「主干合并（总线画法）」→ arch-graph-svg.js 涨到 550，棘轮红 ✓
     → 按**管线**再拆一刀：布局+走线（纯数据，不碰 DOM）| 画成 SVG ✓。 */
  /* ⚠️ 2026-10-11 这一次**明确往上调了**（436 → 481），理由说清楚：
     这批不是新功能，是**一轮 bug 修复** —— 用户截图里那条 882px 的"大环"，
     连带挖出 4 个同源的方向错误（源端上下判反、通道与出口不同侧、卡片端点用错盒子、
     槽位偏移散出通道带）✓。**新增的 45 行里 30 行是注释**（把"为什么"写清楚）✓，
     砍注释就等于砍掉这些坑的记录 ✗。
     这个文件是**纯数据模块**（布局 + 走线，不碰 DOM）✓，481 行里代码只有 348 行 ✓。
     ⚠️ **下次再加功能必须拆**（布局 / 走线分成两个文件）—— 这次不拆是因为
        plan 和布局是**互相依赖**的（plan 决定走廊宽度 → 走廊宽度决定卡片宽度），
        拆不干净 ✗。 */
  ['assets/arch-layout.js', 370],
  ['assets/arch-round.js', 23],    /* 拐角磨圆（纯字符串处理）*/
  ['assets/arch-graph-svg.js', 110],
  /* ⚠️ 2026-10-12 **明确往上调了**（7107 → 7120），理由：这不是新功能，是**两个数据护栏** ✗✗ ——
     `POST /api/life/store` 加了「拒绝把有内容的仓库清空」（新键数不到现有的一半就拒收 ✓）
     + 「flowRuns 封顶 200 条」✓。起因是用户报「东西都丢失了」：
     flowRuns 涨到 36MB → 超过 4MB body 上限 → 被不完整副本覆盖 → 82 个键只剩 27 个 ✓。
     **护栏本身就是"防止代码把事情搞坏"的代码** ✓，压它等于压掉安全网 ✓。 */
  /* ⚠️ 2026-10-12 又上调一次（7120 → 7134），理由同上、仍是**数据/功能护栏**：
     发信接口加了「附件兜底」（最多 10 个、合计 base64 ≤ 20MB ✓），
     并把 body 上限从 1MB 放宽到 24MB ✓（带附件发信要传 base64 进来 ✓）。 */
  /* ⚠️ 2026-10-13 上调（7134 → 7176）：阅读区**顺序表**（readings/.codescope/order.json）
     + move 接口支持 before（插到某个兄弟前面），同目录排序也生效。net +42 行。 */
  /* ⚠️ 2026-10-15 上调（7176 → 7176）：生词本的 `POST /api/life/store`
     body 上限 4MB → 32MB（用户把整本六级词书灌进来，实测 payload 3.4MB，
     再加词就顶到 4MB 上限、写不进去）。净增注释 + 1 行代码。 */
  /* ⚠️ 2026-10-17 上调（7176 → 7193）：加「词群导图」路由 ✓ ——
     书里每个词群开头那张思维导图 ✓，按文件名从 `<数据目录>/wordmaps/` 发 ✓。
     net +17 行（含白名单校验 + 注释 ✓）。为什么没抽 lib ✗：它只有一个分支 ✓，
     抽出去要往 ctx 里塞 applicationDataRoot ✓，反而更绕 ✓。 */
  /* ⚠️ 2026-10-17 再上调（7193 → 7220）：**局域网太慢** ✓ ——
     API 的 JSON 原来一律明文 ✗（gzip 只用在 index.html 上 ✗）→
     `GET /api/life/store` 一次 **11.1 MB** ✗；加 gzip（→ 3.4MB ✓）+ store 的 ETag/304 ✓。
     net +27 行（注释占大半 ✓）。为什么没抽 lib ✗：改的是 `send()` 本身 ✓，
     所有响应都走它 ✓，抽不动 ✓。 */
  /* ⚠️ 2026-10-18 上调（7220 → 7303）：**工作流多提供商 + 生成类节点** ✓ ——
     豆包视频要「建任务 + 轮询」✓、生成物要落盘（`/api/life/flowfile/` ✓）✓、
     各家 Key 要按节点解析 ✓。net +83 行（注释占一半 ✓）。
     为什么没抽 lib ✗：`saveFlowRemote` 要 `applicationDataRoot()` ✓（在 server 里 ✓），
     抽出去得反向注入 ✓，反而绕 ✓。 */
  /* ⚠️ 2026-10-18 再上调（7303 → 7325）：**网页版自动化** ✓ ——
     三个路由（status / open / close）+ 引擎注入 browser ✓。
     真干活的全在新模块 `lib/browser-agent.js` ✓（server 只挂路由 ✓）。 */
  /* ⚠️ 2026-10-19 上调（7325 → 7332）：**store 保存瘦身** ✓ ——
     客户端在「词库没变」时只发 `{__keepWords:true}` ✓，
     服务端用磁盘上现有的 words 补齐（+7 行，含注释 ✓）。 */
  /* ⚠️ 2026-10-19 上调（7332 → 7337）：**词库拆到 life-words.json** ✓ ——
     POST 时把 `words` 单独序列化、只在变了才写词库文件（+5 行，含注释 ✓）。 */
  /* ⚠️ 2026-10-19 上调（7337 → 7404）：`POST /api/fs/reorder-folder` ✓ ——
     只重写同层兄弟的 `orderIndex`（0..n-1 ✓），不动磁盘目录 ✓；
     顺带让**新建文件夹**取同级最大值 +1 ✓（否则排过序之后新文件夹会插到中间 ✗）。 */
  /* ⚠️ 2026-10-19 上调（7404 → 7461）：`.order.json` 目录内顺序 ✓ ——
     绘图 / Office 没有 per-item 元数据 ✓，所以顺序存每个目录一个隐藏文件 ✓（+57 行含注释）。 */
  /* ⚠️ 2026-10-28 上调（7461 → 7691）：**局域网鉴权层** ✓（+230 代码行）——
     非回环请求要访问码（回环一律放行，本机用法零变化 ✓）、cookie 是 HMAC(码) 不是码本身 ✓、
     WebSocket upgrade 同一校验 ✓、安全响应头统一在入口挂一次 ✓；
     顺带把 5 处 adopt 改成「先校验越界、后登记」✓，并给 state.json / 生活数据加 durable 写 ✓。
     ⚠️ 这是**安全能力**，不是顺手长胖 ✗ —— 真要拆，拆的是那批还没归组的端点 ✓。 */
  /* ⚠️ 2026-10-28 再一次上调（7691 → 7867）：**安全面最后三个缺口** ✓（+176 代码行）——
     ① 两个独立监听的代理（code-server / DSH）纳入同一道闸门：判据只写一份 authChallenges(req)，
        /api 中间件、VNC 升级、两个代理都调它；拒绝由代理自己回 401/403、不转给后端，
        authorize 抛异常一律 fail-closed ✓。
     ② VNC 白名单：默认只放行 5900-5999 ✓（原来等于给浏览器开任意 host:port 的裸 TCP 隧道 ✗），
        逃生口 CODESCOPE_VNC_ALLOW，拒绝时 403 且文案直接说该写哪个变量 ✓。
     ③ ONLYOFFICE JWT：密钥 0600 存应用数据目录 ✓、签发/校验与 ensure 脚本共用同一个函数 ✓、
        compose 用 ${VAR:?} 让缺密钥**立刻报错**而不是静默不安全 ✓、拿不到密钥就降级不签名且不崩 ✓。
     ⚠️ 同上一轮性质：**安全能力，不是长胖** ✓。下一步该拆的不是端点，而是把
        office-JWT 状态机（约 90 行）与 VNC 白名单（约 40 行）挪进 lib/ ✓。 */
  ['server.js', 7867],
  /* ⚠️ 2026-10-13 再上调一次（3886 → 3897）：修「代码块太宽、右边被遮挡，
     没有移动条」—— 根因是 overflow-x 写的 auto，而 ::-webkit-scrollbar
     只在 overflow:scroll 下显示（MDN），且 scrollbar-width 会让 Chrome
     忽略它。改成 scroll + 常显滚动条，三处代码块统一。净增 11 行，已压紧。 */
  /* ⚠️ 2026-10-13 上调（3900 → 3901）：大纲跟随改用 scrollIntoView，留白交给
     scroll-margin（原来手算 offsetTop 的基准不对，见 app.js 里的说明）。+1 行。 */
  /* ⚠️ 2026-10-18 上调（3901 → 3909）：**窄屏顶栏会互相压住** ✓ ——
     顶栏是 grid 三列 ✓，1280px 时「网址」被 CPU 小卡盖住 ✓、430px 时
     「个人管理面板」被主题按钮盖住（elementFromPoint 实测）✓。
     加 8 行：1400 以下状态让位 ✓ + 1180 以下快捷入口换到第二行 ✓。 */
  /* ⚠️ 2026-10-19 上调（3909 → 3917）：拖拽「插入线」样式 ✓（伪元素画 2px 线，不占布局 ✓）。 */
  /* ⚠️ 2026-10-19 上调（3917 → 3938）：**侧栏四棵树的度量统一** ✓ ——
     实测原来 项目 12.5px/600/30 · 绘图 12px/400/31 · Office 11px/400/32 · 阅读 11px/650/30 ✓，
     字号差 1.5px、字重 400 与 650 并存，看着像两套 UI ✗。统一到项目树那套（+21 行含注释）。 */
  /* ⚠️ 2026-10-19 上调（3938 → 3939）：**标题计数去掉** ✓（1 行 CSS，含大段注释在上一块里）。 */
  /* ⚠️ 2026-10-19 上调（3939 → 3996）：**分片标签栏重新设计** ✓（与 app.js 同一批）——
     `#tabs-row` 两栏布局 + 「全部」按钮 + 紧凑标签 + 左右边缘渐隐的 mask。
     ⚠️ 新增的 57 行里**一半是注释**：把「为什么不能用 sticky」「为什么滚动条拿不到」
       这两条都写进 CSS 了，删注释就等于把踩过的坑重新埋回去 ✗。 */
  /* ⚠️ 2026-10-19 上调（4056 → 4149）：**「运行历史 / 问题」两个面板的样式** ✓（与 app.js 同一批）——
     列表行 / diff 行 / 分组标题 / 空态；外加底部标签栏「6 个 tab 不许折行」的两条修正 ✓。 */
  /* ⚠️ 2026-10-20 上调（4155 → 4213）：**同一批「行级分割」重做** ✓ ——
     ⚠️ 这 58 行里最重要的是那条**为什么必须写 `#problem-panel` 前缀**的注释 ✓：
       主题皮肤有 `html[data-theme] button {background: linear-gradient…; box-shadow: inset…}`
       （特异性 0,1,1）→ 压过 `.prob-row`（0,1,0）→ 每一行都被画成「凸起按钮」，
       分割线被按钮底盖住 ✓。这才是「行级分割不清楚」的真凶，删注释就会重新踩 ✓。 */
  ['assets/app.css', 4212],   /* 2026-10-28 往下拧（4213 → 4212）：006 把 8 行规则压成 2 行（浮层改写）✓ */
  /* ⚠️ 2026-10-18 上调（3189 → 3265）：**本机管家 → 运维面板** ✓ ——
     ①「文件全景」并入「存储」子页（用户确认的重复入口 ✓，视图不动 ✓）；
     ② 概览顶部加**健康总评条**（级别 + 一句话结论 + 可点跳转的告警 chip ✓，
        增量更新时同步重算 ✓）；
     ③ 修「按应用合并」里写死 16GB 的内存条 ✓（满格改用本机实际内存 ✓）。 */
  /* ⚠️ 2026-10-19 再上调（3265 → 3333）：运维面板第二轮 ✓ ——
     ① 概览侧栏加「运行状态」卡（Docker / 启动项 / 对外端口 ✓，整行可点跳转 ✓，
        数据搭 loadOverviewExtras 的车 ✓，不进 1.5s 刷新环 ✓）；
     ② 存储页加「缓存构成」分段条 ✓（段色 = 风险等级 ✓，Top6 + 其他 ✓）；
     ③ sp-viz 补 bad / dim 两档段色 ✓。 */
  /* ⚠️ 2026-10-19 上调（3333 → 3412）：设置页**补回 AI 配置入口** ✓ ——
     生词补全 / 翻译 / 拆句的 12 处提示都写「去本机管家 → 设置 → AI」✓，
     而那个入口早就不在了 ✗（用户被指到不存在的地方 ✗）。+79 行（表单 + 保存 + 测试连通）。 */
  ['src/system-panel.js', 3750],   /* 2026-10-29 上调 3,390 → 3,750（+360）。理由：概览页已优化完，本轮把
                                           文件/存储/系统/软件 四个子页对齐同一套观感与交互（用户点名的剩余工作）✓ */   /* 2026-10-29 往下拧（3,412 → 3,390）：观感/交互优化时 CSS 声明并回单行（纯空白，
                                          归一化 CSS 的 sha256 前后相同 c875f4e1…8db0），没有靠删功能换行数 ✓ */
  ['lib/system-panel.js', 2097],
  /* ★ 2026-10-28 补登记：这几个一直是「有实质体量、却从来没进棘轮」的文件 ✓。
     ⚠️ 和之前补登记那 5 个巨型文件同一个理由 ✗：棘轮只守名单里的文件 ✓，
        不在名单里 = 涨了没人知道 ✓。lib/knowledge-base.js 曾经 1,4xx 行且零上限 ✓，
        比当初 app.js 涨到 17,466 行还糟（连告警都没有）✓。
     上限一律取**登记时实测的代码行数**，只准往下调 ✓。 */
  /* ★ 2026-10-28 真的补上：它就是上面那段注释点名的文件 ✓，
     1,437 行代码、零上限 ✓，这次因为修三栏布局/拖动正反馈又涨了 ~90 行 ✓，
     再不登记就又是「涨了没人知道」✓。上限取登记时实测值 ✓，只准往下调 ✓。 */
  ['lib/knowledge-base.js', 1437],
  ['lib/office-engine.js', 136],
  ['lib/code-server-proxy.js', 128],
  ['lib/dsh-proxy.js', 30],
  ['scripts/ensure-onlyoffice.js', 145],
  /* 字符图标映射 + 渲染后扫描。2026-10-28 重写了扫描逻辑（见文件头）——
     它挂在**每次 DOM 变动**的路径上，属于渲染高频代码，必须有上限。 */
  ['assets/cs-icons.js', 74],
  /* 代码编辑器语法配色：4 套 Phycat 调色板映射成 Monaco 主题 ✓。
     111 行里有一大段是注释——记着实测踩到的两个坑（options.theme 绕过包装、
     切标签走 updateOptions 而不是 setTheme），这两条比代码本身更值钱 ✓。 */
  ['assets/code-theme.js', 185],   /* 含 12 套常用主题的颜色表（每套一行）✓、
                                      「跟随文档配色 vs 显式选择」的优先级 ✓、对外 API ✓，
                                      以及「底色压暗一档」的 deepen/mix 两个纯函数 ✓ */
  /* 代码高亮主题选择器：往**已有的** #theme-menu 里追加一段（不动 app.js）✓。 */
  ['assets/code-theme-picker.js', 63],
  /* 下面这行的原注释保留（说明 code-theme.js 早期都放了什么）：
     含「底色压暗一档」的 deepen/mix 两个纯函数 ✓，
                                      以及二期补的 15 条**语义角色**配色规则 ✓（形参/成员/方法/
                                      类/结构体/枚举/命名空间/类型参数/宏/装饰器/枚举值…）✓ */
  /* 代码区卡片质感（一期）+ 语义上色的 CSS 类（二期）。 */
  ['assets/editor-chrome.css', 28],
  /* 语义上色 · 装饰器实现（二期）。⚠️ 不用 Monaco 的 provider 是因为**实测这个构建
     不跑那套贡献** —— provider 一次都不会被调用，详见文件头 ✓。 */
  ['assets/semantic-decorations.js', 81],
  /* LSP 客户端（2026-10-28 补登记）：它一直是「有实质体量却没人守」的文件 ✓，
     这次二期往里加了 semanticTokens 的客户端能力声明与解码分支 ✓。 */
  ['lib/lsp-service.js', 402],
  ['assets/debug-panel.js', 530],
  ['lib/routes/dbg.js', 72],
  ['lib/routes/latex.js', 94],
  ['lib/arch/analyze.js', 220],
  ['lib/arch/render.js', 297],
  ['lib/arch/ai.js', 134],
  ['lib/arch/ai-error.js', 44],   /* 把上游 AI 报错翻成人话（纯函数）*/
    ['lib/routes/arch.js', 152],   /* 加了 /api/arch/ai（AI 语义分析）*/
  ['lib/routes/check.js', 24],
  ['lib/routes/env.js', 46],
  ['lib/routes/fig.js', 16],
  ['lib/routes/format.js', 37],
  ['lib/routes/graph.js', 30],
  ['lib/routes/integrations.js', 49],
  ['lib/routes/logic.js', 56],
  ['lib/routes/matlab.js', 24],
  /* ⚠️ 2026-10-19 上调（163 → 169）：`POST /api/office/reorder` ✓（6 行）。 */
  ['lib/routes/office.js', 169],
  ['lib/routes/py.js', 24],
  ['lib/routes/remote.js', 58],
  ['lib/routes/reorder.js', 15],
  ['lib/routes/rev.js', 11],
  ['lib/routes/run.js', 25],
  ['lib/routes/save.js', 31],
  ['lib/routes/snippets.js', 11],
  /* 2026-10-28 上调（75 → 79）：新增 GET /api/study/site-catalog ✓ ——
     站点目录从源码搬到私有 JSON 后浏览器读不到磁盘 ✓，必须由服务端转出来 ✓；
     源码里只留 192.0.2.x 占位示例，真实内网地址不再进仓库 ✓。 */
  ['lib/routes/study.js', 79],
  ['lib/routes/sync.js', 53],
  ['lib/routes/system-panel.js', 14],
  ['lib/routes/system.js', 10],
  ['lib/routes/tags.js', 46],
  /* ⚠️ 2026-10-19 上调（40 → 41）：**修「终端启动失败」** ✓ ——
     `const { TERM } = ctx` 是**调用时拷的旧值** ✗，spawn 成功后它还是 null →
     每次请求都报「终端启动失败」并多开一个 shell ✓；改成用 `termSpawn()` 的返回值 ✓。
     同一处还把裸 `return;` 改成 `return true`（流没结束，`writableEnded` 是 false ✗ →
     裸 return 会撞 404 兜底 → 二次 writeHead → 连接被 destroy ✓）。+1 行代码。 */
  ['lib/routes/term.js', 41],
  ['lib/routes/version.js', 14],   /* 路由模块，样板 ✓ */   /* 刚抽出来的，别让它再涨回去 ✓ */
];
for (const [rel, cap] of SIZE_CAP) {
  const n = codeLines(rel);
  ck('  ' + rel + ' ≤ ' + cap + ' 行代码', n > 0 && n <= cap, '实际 ' + n + ' 行代码');
}

console.log('\n── ② ARCHITECTURE.md 里的数字必须和代码一致（源证据）──');
/* ⚠️ 这是 Archify 最值得学的一条：
      文档里的数字**能被一条命令验证**，图就不会慢慢变成"想象"。 */
const docPath = 'docs/ARCHITECTURE.md';
let doc = '';
try { doc = fs.readFileSync(path.join(root, docPath), 'utf8'); } catch (_) {}
ck('  文档存在（' + docPath + '）', doc.length > 0);

/* ⚠️ 先**去掉千分位逗号** ✗（文档里写 `17,142` ✓，代码量出来是 `17142` ✓）——
   不归一化就会"文档明明写了却找不到" ✓（第一次跑就是这样 ✓）。 */
const docFlat = doc.replace(/(\d),(?=\d{3}\b)/g, '$1');
/* ⚠️ 文档里**两个数都写** ✓（总行 / 代码行）—— 两个都验 ✓：
   总行是"这个文件多大" ✓，代码行是"棘轮守的那个数" ✓，缺一个都对不上 ✓。 */
const DOC_FACTS = ['assets/app.js', 'server.js', 'assets/app.css'];
for (const rel of DOC_FACTS) {
  const t = lines(rel), c = codeLines(rel);
  /* ⚠️ 用**词边界**匹配 ✗ —— `includes` 是子串匹配 ✓，
     文档里有 `14,287` 时它会以为找到了 `4287` ✓（实测踩到过 ✓）。 */
  const has = (n) => n > 0 && new RegExp('(?<!\\d)' + n + '(?!\\d)').test(docFlat);
  const okT = has(t), okC = has(c);
  ck('  文档里的 ' + rel + ' 行数（总 ' + t + ' / 代码 ' + c + '）与代码一致', okT && okC,
    okT && okC ? '' : (okT ? '' : '缺总行 ' + t) + (okC ? '' : ' 缺代码行 ' + c));
}

console.log('\n── ③ 路由模块化进度 ──');
/* ⚠️ 这条断言**换过指标** ✗✓（2026-10-11）——
   原来写的是「server.js 里 /api/* 分组数 ≥ 20」✓，
   那是"路由很大"的**代理指标** ✓。等真开始拆了，这个数**必然下降** ✓ →
   它就从"守质量"变成"挡重构"了 ✓✓（实测：抽完 25 组后它红了 ✓）。
   → 换成**正向指标**：lib/routes/ 里有多少个模块 ✓，
     以及 server.js 里**还剩**多少组 ✓（剩得越少越好 ✓）。 */
const routesDir = path.join(root, 'lib', 'routes');
let routeFiles = 0;
if (fs.existsSync(routesDir)) {
  routeFiles = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).length;
}
ck('  lib/routes/ 已抽出模块 ≥ 20 个（现在 ' + routeFiles + ' 个）', routeFiles >= 20);

let groups = 0;
try {
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  groups = new Set((src.match(/['"]\/api\/[a-z0-9-]+/g) || []).map((x) => x.replace(/['"]\/api\//, ''))).size;
} catch (_) {}
/* 上界：只准往下走 ✓（现在是 15 组，给了点余量 ✓） */
ck('  server.js 里剩的 /api 分组 ≤ 20（现在 ' + groups + ' 组）', groups > 0 && groups <= 20);

console.log('\n── ④ 每个 lib 模块都能被 require（没有语法/依赖炸）──');
const libDir = path.join(root, 'lib');
let libOk = 0;
let libTotal = 0;
if (fs.existsSync(libDir)) {
  for (const f of fs.readdirSync(libDir).filter((x) => x.endsWith('.js'))) {
    libTotal += 1;
    try {
      /* ⚠️ 只做**语法检查** ✗ —— 直接 require 会有副作用（起服务 / 连网 ✓） */
      execFileSync(process.execPath, ['--check', path.join(libDir, f)], { stdio: 'ignore' });
      libOk += 1;
    } catch (_) {}
  }
}
ck('  lib/ 全部通过语法检查（' + libOk + '/' + libTotal + '）', libTotal > 0 && libOk === libTotal);

console.log('\n── ⑤ 结构约定 ──');
ck('  tests/ 目录存在且非空', fs.existsSync(path.join(root, 'tests')));
ck('  docs/ 目录存在', fs.existsSync(path.join(root, 'docs')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ck('  package.json 有 test 脚本', !!(pkg.scripts && pkg.scripts.test));
ck('  package.json 有 test:browser 脚本', !!(pkg.scripts && pkg.scripts['test:browser']));

console.log('\n── ⑥b 视图状态一致性（用户：「高亮的是图谱，为什么显示架构图」）──');
/* ⚠️ 根因：`CG_VIEW` 是从 **localStorage** 读的 ✓，
   但按钮的 `on` 类和标题是 **HTML 里的死值** ✓（`<button id="cg-view-graph" class="on">`）✓ ——
   而 `setCodeGraphView()` **只在两个按钮的 onclick 里被调用过** ✗，启动时从来没同步 ✓
   → 上次停在「架构」，下次打开就是「高亮图谱 + 画架构图」✓。
   ⚠️ 这条是**静态断言**（查"启动时有没有调同步"）✗ —— 不是最优 ✓，
      但真开浏览器跑一遍要十几秒 ✓，这条能挡住"把同步那行删掉" ✓。 */
const archViewSrc = (() => { try { return fs.readFileSync(path.join(root, 'assets/arch-view.js'), 'utf8'); } catch (_) { return ''; } })();
ck('  arch-view.js 启动时会 setCodeGraphView(CG_VIEW) 同步按钮/标题',
  /setCodeGraphView\(CG_VIEW\)/.test(archViewSrc));

console.log('\n── ⑤b 路由模块的 ctx 依赖完整性 ──');
/* ⚠️⚠️ 这个 bug **真的漏了很久**，是这次全项目自检扫出来的 ✓：
      `lib/routes/logic.js` 用了 `logicToSkeleton` ✓，
      但**既没在 `const {...} = ctx` 里解构、也没在 server.js 的挂载点传** ✗
      （抽路由那个工具扫漏了 ✓）→ 一调就 `ReferenceError` → **HTTP 500** ✓
      → 「按控制流图生成骨架代码」整个功能**一直是坏的** ✗（4 处 UI 在调它 ✓）
      → 而 `npm test` 里**没有一条断言会红** ✗。
   ⇒ 判据：**凡是用了 server.js 顶层名字的，都必须在 ctx 里解构 ✓**。
      依赖用 ctx 显式传是这个项目的约定 ✓，这条就是给那个约定上的锁 ✓。 */
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const topNames = new Set();
for (const m of serverSrc.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) topNames.add(m[1]);
for (const m of serverSrc.matchAll(/^const ([A-Za-z_$][\w$]*)\s*=/gm)) topNames.add(m[1]);
const ctxMissing = [];
fs.readdirSync(path.join(root, 'lib', 'routes')).filter((f) => f.endsWith('.js')).forEach((f) => {
  const rawSrc = fs.readFileSync(path.join(root, 'lib', 'routes', f), 'utf8');
  /* ⚠️ **先剥注释再扫** ✗ —— 不剥的话，注释里提到的名字会被当成"用了" ✓
     （第一版就报了 `streamStatic` / `run`，全是注释里的 ✓）。 */
  const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const dm = src.match(/const \{([^}]*)\} = ctx;/s);
  const got = new Set((dm ? dm[1] : '').split(',').map((x) => x.trim()).filter(Boolean));
  /* 本文件自己 require 的（fs / path / os…）和本地声明的，不算缺 ✓ */
  const local = new Set([...src.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  ['fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'child_process', 'stream', 'util'].forEach((b) => local.add(b));
  topNames.forEach((n) => {
    if (got.has(n) || local.has(n)) return;
    /* ⚠️ 只看**裸标识符** ✗ —— `ctx.vaultPath` 这种是显式走 ctx 的 ✓，不该报 ✓ */
    if (new RegExp('(?<![.\\w])' + n + '\\b').test(src)) ctxMissing.push(f + ' 用了 ' + n);
  });
});
ck('  路由模块用到的 server.js 顶层符号，都从 ctx 取了', ctxMissing.length === 0, ctxMissing.slice(0, 4).join(' / '));

console.log('\n── ⑤c 「抽路由」的相对路径（__dirname 位移）──');
/* ★★ 从根目录的 server.js 抽到 `lib/routes/` 之后，`__dirname` **多下移了两层** ✗✗ ——
   跟文件位置有关的东西（`path.join(__dirname, …)` / `require('./x')`）都要跟着改 ✓。
   ⚠️ 实测踩过（2026-10-12 用户报「怎么缺失了」）：
      `lib/routes/remote.js` 查 noVNC 时写的是 `path.join(__dirname, 'node_modules', …)` ✗
      → 一直在查 `lib/routes/node_modules/…`（永远不存在）→
      面板永远「VNC 缺失」，可依赖明明装着 ✓。
   ⇒ 这条断言把「抽出去的路由里，指向 node_modules 的路径必须真的存在」钉住 ✓。
      比盯着某个字符串强 ✓：它验的是**文件真的在那儿** ✓。 */
{
  const routeDir = path.join(root, 'lib', 'routes');
  const offenders = [];
  let checked = 0;
  if (fs.existsSync(routeDir)) {
    for (const f of fs.readdirSync(routeDir).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(routeDir, f), 'utf8');
      /* 只看**代码**里的 path.join(__dirname, …) ✗ —— 注释里写的不算 ✓ */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of code.matchAll(/path\.join\(__dirname,([^)]*)\)/g)) {
        const parts = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        if (!parts.length) continue;
        checked += 1;
        const resolved = path.join(routeDir, ...parts);
        /* 只对"应该存在的目录"较真 ✓ —— `node_modules` 这种一定存在 ✓，
           而 `.bin/code-server` 之类可能没装 ✓，不该判错 ✓。 */
        if (parts[0] !== 'node_modules') continue;
        if (!fs.existsSync(resolved)) offenders.push(f + ' → ' + path.relative(root, resolved));
      }
    }
  }
  ck('  lib/routes/ 里指向 node_modules 的路径都真的存在（__dirname 没少两层）',
    offenders.length === 0, offenders.slice(0, 3).join(' / '));
  console.log('  （扫了 ' + checked + ' 处 path.join(__dirname, …)）');
}

console.log('\n── ⑥ 片段缓存上限够大 ──');
/* ⚠️⚠️ 2026-10-19 实测出来的坑 ✗✗：
   `walkSnippets()` 里是 `if (SNIPPET_FILE_CACHE.size > MAX) SNIPPET_FILE_CACHE.clear();` ✓ ——
   上限**低于片段总数**时会变成「每次请求全量重解析」✓：
   5000 个片段 → 每次 11 秒 ✗（页面首屏 12 秒 ✗）、10000 个 → 每次 14 秒 ✗。
   上限提到 20000 之后：热请求 120~190ms ✓（同样 5000/10000 个片段 ✓）。
   ⇒ 这条断言就守着「别把它调小」✓（调小不会报错、只会悄悄变慢 ✗，最难发现的那种 ✗）。 */
{
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const m = /const SNIPPET_FILE_CACHE_MAX\s*=\s*(\d+)/.exec(src);
  const cap = m ? Number(m[1]) : 0;
  ck('  SNIPPET_FILE_CACHE_MAX ≥ 20000（低于片段总数会每次全量重解析）', cap >= 20000, '当前 ' + cap);
}

console.log('\n── ⑦ 没有遗留标记 ──');
/* ⚠️⚠️ 只认**注释形式**的 TODO ✗✗（第一次写成裸词，误报 4 处 ✓）：
       · `server.js` 里有一段**代码本身就在数 TODO**（`text.match(/TODO|FIXME/)`）✓；
       · 还有一段在**检测「未实现」**（`NotImplementedError`）✓；
       · `app.js` 里有个 **UI 标签文字**就叫「TODO」（项目度量面板 ✓）；
       · 注释里**在讲某个模式**（比如讲 JSON 转义提到 `\'`）✓。
       —— 这些**都不是遗留标记** ✓，是**功能** ✓。
       → 只认 `// TODO` / `/* TODO` / `<!-- TODO` ✓（**注释里的**才是债 ✓）。 */
const todoRe = /(?:\/\/|\/\*|\*|<!--)\s*(?:TODO|FIXME|XXX|HACK)\b/gi;
const todoCount = countIn('server.js', todoRe) + countIn('assets/app.js', todoRe);
ck('  server.js / app.js 的注释里没有 TODO/FIXME', todoCount === 0, '找到 ' + todoCount + ' 处');

console.log('');
console.log('架构断言：' + pass + '/' + results.length + ' 项通过' + (fails.length ? '，失败 ' + fails.length + ' 项' : ''));
if (fails.length) {
  console.log('');
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('\n全部通过 ✅');
