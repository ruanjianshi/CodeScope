# 016 · 验证债清算：6 组「只确认了代码、没实测运行时」的数字补测

> 执行日期：2026-11-01 ｜ 范围：`masscode-runner/`
> 方式：`CODESCOPE_PORT=49xx` + 独立 `CODESCOPE_DATA_HOME` + 临时 vault + Playwright/curl 实测，跑完 SIGKILL
> 纪律：**只读**——未改任何源码 / CSS / 测试，未做任何 git 写操作；本报告文件不提交
> 标注：**【实测】** = 本次在本机跑出来的数字；**【推断】** = 由实测 + 读码推出、没有直接测到的因果

---

## 0. 一句话结论

| # | 组 | 结论 | 一句话 |
| --- | --- | --- | --- |
| 1 | 暗色主题层级（P-05 后续） | **部分 FAIL** | computed 值明暗都对（暗色 2 条 inset、浅色 1 条），但「暗色不再几乎读不出」**没做到**：抽屉 / 命令面板的内描边被各自的 1px 边框压住，实际像素差 ≤ 4/255 |
| 2 | brotli 收益 | **机制 PASS / 数字 FAIL** | `br`+`Vary` 三态全对、首屏最大 3 个 js 全部 br；index.html 实测 **36.7KB**，没到 31.6KB —— 因为 31.6KB 是 10-31 那一刻的数，之后两个 commit 把文件撑大了 |
| 3 | T-05 computeRev 反向验证 | **正确性 PASS / 目标 FAIL** | 改文件后 rev **立刻变**（缓存没吃变更）；但记忆化只省 **0.20ms（7%）**，派单的「热调用 <0.05ms」达不到 —— 缓存键是整份快照串，walk/stat 一步没省 |
| 4 | T-07 接口延后可用性 | **PASS（口径需修正）** | DCL 前只有 **8 个**接口请求；load 后 8 个被延后的接口全部在 **load+130ms 内** 200 返回；系统面板 / 个人管理面板（热榜·邮箱·工作流）在 **load+2s 后**都能打开 |
| 5 | P-06 状态点 | **PASS** | 静息 `animation-name=none` + 3 层内发光；整页 20 条 CSS 动画 **running=0**；5s 采样外观取值数 **1**；CDP 样式重算增量 **4** |
| 6 | P-09 按下态 | **部分 FAIL** | 1px 下沉**生效**且宽高不变；但按下内阴影**被 hover 规则压掉**（没生效），且菜单项按下会被全局 `button:active` 缩放 1.5%（**真 bug**） |

---

## 1. 方法与夹具（先说清楚，后面所有数字都基于它）

| 项 | 值 |
| --- | --- |
| 服务 | `node server.js`，`CODESCOPE_HOST=127.0.0.1`，`CODESCOPE_PORT=4931/4934/4935/4936/4937/4938/4939/4940/4941/4942/4943` |
| 数据 | `CODESCOPE_DATA_HOME=mktemp`、`CODESCOPE_VAULT=mktemp`（每支探针独立），`CODESCOPE_AUTO_OFFICE=0`、`CODESCOPE_AUTO_SYNC=0` |
| 浏览器 | 本机 Chrome（`/Applications/Google Chrome.app`）+ `playwright-core`，headless |
| 收尾 | 每支探针 finally `server.kill('SIGKILL')`，并回读端口确认释放 |
| 端口核对 | 10 支探针全部打印 `端口 49xx 释放：是`；末次 `lsof`：**没有 493x/494x 监听** |
| 4877 | **全程未触碰**（`lsof` 里 PID 1136 一直持有 `*:4877`，与本轮无关） |
| 探针源码 | `/tmp/cs-verify/probe-*.js`（**不在仓库里**）；原始 JSON：`/tmp/cs-verify/out-*.json` |

---

## 2. 第 1 组 · 暗色主题层级（P-05 后续）

### 2.1 三处面的 computed box-shadow（【实测】，同一台机同一次加载）

| 面 | 浅色 `data-theme="light"` | 暗色 `data-theme="ocean"` |
| --- | --- | --- |
| 抽屉 `#pane-git` | `rgba(0,0,0,.30) 0 8px 24px`, `rgba(0,0,0,.26) 0 24px 56px`, `rgba(255,255,255,.10) 0 1px 0 inset` | 前两层同左，另加 `color(srgb .153 .196 .255 / .7) 0 0 0 1px inset` + `rgba(255,255,255,.18) 0 1px 0 inset` |
| 命令面板 `#sym-modal-box` | 同抽屉（`--el-3`） | 同抽屉（`--el-3`） |
| 右键菜单 `.ctx-menu` | `rgba(0,0,0,.24) 0 4px 12px`, `rgba(0,0,0,.18) 0 12px 28px`, `rgba(255,255,255,.08) 0 1px 0 inset` | 前两层同左，另加 `color(srgb .153 .196 .255 / .7) 0 0 0 1px inset` + `rgba(255,255,255,.14) 0 1px 0 inset` |

- **改前（P-05 之前）**：抽屉 `rgba(0,0,0,.48) -14px 0 36px`；命令面板 `rgba(0,0,0,.34) 0 18px 50px`；右键菜单 `rgba(0,0,0,.70) 0 16px 40px + 0 2px 4px + 0 .5px inset`
- **内高光 / 描边是否齐**：浅色三处各 **1 条 inset**、**无 1px 描边环**；暗色三处各 **2 条 inset**（描边环 + 内高光）、**都有 1px 环** ✅（与改前的差别就是这三样）
- **三档单调（读 `--el-1/2/3` 源值）**：y-offset 1/2 → 4/12 → 8/24，blur 2/6 → 12/28 → 24/56，alpha .18/.10 → .24/.18 → .30/.26 —— 两轴严格单调 ✅

### 2.2 像素差

**(a) 整页像素差**（1600×1000，停掉动画/过渡后截图，同一套夹具；这是派单原文要的口径）

| 主题 | 当前 vs pre-P-05（层级总效果） | 当前 vs P-05（本轮暗色增量） | 自比 |
| --- | --- | --- | --- |
| 暗色 | **1.22%**（≥8:0.17%，≥32:0.01%） | **0.04%** | 0.0000% |
| 浅色 | **1.88%**（≥8:0.19%，≥32:0.01%） | 0.01% | 0.0000% |

> ⚠️ 上一轮报告公布的 8.84% / 1.31% 是**另一套夹具**（视口、页面状态、冻结方式都不同）跑出来的，绝对值**不可跨轮比较**。本文只做**同夹具内明暗对照**：暗色 1.22% **比浅色 1.88% 更小**。

**(b) 按面裁剪 + 隔离打开**（每个面单独一个页面，避免互相遮挡；1440×900，暗色）

| 面 | 顶边 4px 带（当前 vs P-05） | 左边 4px 带（当前 vs P-05） | 面内 40px 带 |
| --- | --- | --- | --- |
| 抽屉 `#pane-git` | **0 像素变化** | 25.8% 像素变化，**max Δ=4** | 0.5%，max Δ=3 |
| 命令面板 `#sym-modal-box` | **0 像素变化** | **0 像素变化** | 0.9%，max Δ=2 |
| 右键菜单 `.ctx-menu` | 25.6% 像素变化，max Δ=9 | 26.2%，max Δ=13 | 1.4%，max Δ=1 |

### 2.3 结论与归因

| 判据 | 目标 | 实测 | 结论 |
| --- | --- | --- | --- |
| 三档令牌可机器比对（两轴单调） | 严格单调 | 1/4/8 与 2/6·12/28·24/56、alpha 递增 | **PASS** |
| 三处面的 computed 值 | 面板=e3、菜单=e2、抽屉=e3 | 逐值吻合，明暗两套都对 | **PASS** |
| 暗色「不再几乎读不出」 | 暗色可见度明显上来 | 整页 1.22%（< 浅色 1.88%）；抽屉顶边 0 像素变化、左边 max Δ=4/255；面板顶边/左边 0 | **FAIL** |
| 明暗对照（三档 computed） | 暗色多出环 + 更强内高光 | 暗色 2 条 inset、浅色 1 条；.18/.14 vs .10/.08 | **PASS** |

**FAIL 归因：既不是「没生效」，也不只是「测法不对」，是「生效在 computed 层、死在绘制层」** ——

1. **【实测】抽屉与命令面板都有 1px 边框**：`#pane-git` `border-left:1px solid rgba(255,255,255,.09)`（ui-kit.css:385）、`#sym-modal-box` `border-top:1px`（app.css:3250 `border-color:#34465c`）。`inset` box-shadow 画在**内容盒内侧、边框之下**，1px 环正好被这 1px 边框盖住 —— 与「顶边 0 像素变化」完全吻合。
2. **【实测】环色本身也太淡**：抽屉左边那 25.8% 有变化的像素 **max Δ 只有 4/255**（≈1.6% 亮度），近黑底上读不出「立起来」。
3. **【实测】只有 `.ctx-menu` 例外**：它的顶边内侧命中元素就是它自己（`elementFromPoint` 返回 `.ctx-menu`，背景 `rgba(23,32,43,.82)` 半透明），环没被盖，max Δ=9~13，肉眼可辨。

**这不代表测量方式错**（computed 值与像素都测了，两者一致地指向「被盖住」）；但**「整页像素差」这个口径本身对边缘级修复不敏感**（本轮暗色增量只有 0.04%），拿它当「暗色读不读得出」的判据会系统性地低估/误判。**建议把它换成「面内裁剪 + 边缘 ΔL」**。

### 2.4 最小修复建议（**我没有改**）

1. 环改成不参与边框绘制层的写法：`outline: 1px solid <color>; outline-offset: -1px;`，或用一个 `::after { position:absolute; inset:0; border-radius:inherit; box-shadow: inset 0 0 0 1px …; pointer-events:none }`。
2. 提高对比：把 `color-mix(in srgb, var(--border) 70%, transparent)` 换成 `color-mix(in srgb, var(--text) 14%, transparent)`（ocean 主题下 #e8edf4 14% 在 `#121a24` 上约 Δ≈30，肉眼可辨）。
3. 验收判据改成：**面内裁剪后，顶边/左边 4px 带的 `max Δ ≥ 12`**（可机器判），而不是整页百分比。

---

## 3. 第 2 组 · brotli 收益

### 3.1 index.html 三态（【实测】`curl` 等价：`http.request` 取**线上原始字节**，不用 undici 以免自动解压）

| 请求头 | `Content-Encoding` | `Vary` | 字节数 | 内容校验 |
| --- | --- | --- | --- | --- |
| `Accept-Encoding: br, gzip, deflate` | **br** | **Accept-Encoding** | **37,604 B（36.7 KB）** | brotli 解压后与磁盘 `index.html` **逐字节相同** |
| `gzip, deflate` | gzip | Accept-Encoding | 52,051 B（50.8 KB） | gunzip 后逐字节相同 |
| `identity` | （无） | — | **151,850 B = 原文** | 与磁盘逐字节相同 |
| 不带 AE | （无） | — | 151,850 B = 原文 | 同上 |

### 3.2 首屏最大的 3 个 `.js`

| 资源 | 原文 | br | gzip | `Content-Encoding` | `Vary` | 解压一致 |
| --- | --- | --- | --- | --- | --- | --- |
| `/assets/app.js` | 983,710 B | **234,699 B**（23.9%） | 357,151 B | br | ✅ | ✅ |
| `/assets/xterm.js` | 283,404 B | **54,853 B**（19.4%） | 80,553 B | br | ✅ | ✅ |
| `/assets/app-reading.js` | 217,124 B | **53,390 B**（24.6%） | 77,366 B | br | ✅ | ✅ |

### 3.3 结论

| 判据 | 目标 | 实测 | 结论 |
| --- | --- | --- | --- |
| index.html 走 br + `Vary` | 是 | `CE: br` + `Vary: Accept-Encoding` | **PASS** |
| 首屏最大 3 个 js 走 br + `Vary` | 是 | 3/3 都是 br，解压后与磁盘逐字节一致 | **PASS** |
| `identity` 返回未压缩原文 | 是 | 151,850 B，无 CE，逐字节相同 | **PASS** |
| index.html 传输 ≤ 35,000 B（T-04 阈值） | ≤35,000 | **37,604** | **FAIL** |
| index.html 44.6KB → ~31.6KB | ~31.6KB | **36.7KB** | **FAIL** |

**FAIL 归因：目标值过时，不是 brotli 没生效。** 【实测】把 `index.html` 的历史版本逐个用 **brotli q11** 复算：

| commit | 日期 | raw | br11 | 备注 |
| --- | --- | --- | --- | --- |
| 5fa2b38（HEAD） | 11-01 | 151,850 | **37,604** | 与线上返回的字节数**逐字节吻合** ⇒ 服务端确实 q11 |
| 06a76e8 | 10-31 | 138,941 | 33,736（32.9KB） | T-06 脚本 defer |
| **7ff4a65** | 10-31 | 135,973 | **32,392（31.6KB）** | ← **「31.6KB」就是这一刻的数** |
| 9ad7efe | 10-30 | 135,202 | 32,128 | |

即：31.6KB 的锚点在 `7ff4a65`；之后 T-06（+3.0KB br）、T-10（+3.9KB br）把 `index.html` 从 135,973 B 撑到 151,850 B。**T-10 报告自己写的「index.html 自身 +3.8KB」与此吻合**，不是压缩退化。
**最小建议**：把验收阈值改成**「相对同版本 raw 的压缩比」**（实测 24.8%，br11/gzip=0.72），或锁在 `git show <commit>:index.html` 上复算，别用绝对 KB 数。

---

## 4. 第 3 组 · T-05 computeRev 反向验证（最关键）

### 4.1 三个数字

**【实测】vault = 600 个 .js 文件，HTTP keep-alive（把建连开销摘掉），`/api/version` 作纯开销基线 0.15ms**

| 指标 | 实测 |
| --- | --- |
| 冷耗时（进程启动后第一次 `/api/rev`，**含 TCP 建连**） | **8.13 ms** |
| 热耗时（缓存命中，**净耗时** = 2.68ms − 0.15ms 基线） | **2.53 ms** |
| 未命中耗时（改文件后立刻请求，净） | 2.73 ms |
| **记忆化实际省下** | **0.20 ms / 次（≈7%）** |

**【实测】vault = 3 个小文件（同一支早期探针）**：冷 1.02ms（含建连）、热中位 0.25ms、基线 0.19ms ⇒ 净 **0.06ms**。

### 4.2 反向验证：改一个文件，rev 必须变

| 场景 | 改前 rev | 改后 rev | 结论 |
| --- | --- | --- | --- |
| 同尺寸内容替换（540 B → 540 B，`f0→g0`） | `n8qhz3` | **`1ly637j`** | **立刻变化**（无 TTL、无需等待）✅ |
| 大 vault（600 文件）改 `mod0.js` | `dx1wu1` | **`1u77smt`** | 变化 ✅ |
| 内容复原（再写回原文） | `1ly637j` | `1qn86d8` | 又变（说明它跟的是 mtime/size，不是内容） |
| **边界**：改内容 + `utimes` 把 mtime 复原成原值 + 同尺寸 | `n8qhz3` | **`n8qhz3`（未变化）** | ⚠️ 缓存键 = `path:mtime:size`，这种情况检测不到 |

### 4.3 结论

| 判据 | 目标 | 实测 | 结论 |
| --- | --- | --- | --- |
| 同一快照重复调用返回同一 rev | 一致 | 5 次连续全为 `n8qhz3` | **PASS** |
| 改文件后 rev 变化（缓存不吃变更） | 必须变 | `n8qhz3 → 1ly637j` 立刻变 | **PASS** |
| 热调用耗时 | ≥1.5s 窗口内重复调用 **0.7~1.1ms → <0.05ms** | 净 **2.53 ms**，只比未命中少 **0.20ms** | **FAIL** |

**FAIL 归因：目标值与实现口径冲突（不是没生效）。** 【实测】缓存命中时哈希确实跳过了（未命中 2.73 − 命中 2.53 = 0.20ms 就是哈希那一段），但 **walk + stat 一步都没省** —— 这是实现**故意**的：代码注释写明缓存键必须是「排序后的 path:mtime:size 全量串」，因为「原地改文件不会改父目录 mtime」，用目录聚合键会让「编辑器保存后 rev 不变」，正好吃掉前端 3s 一次的 change 检测。**换句话说：<0.05ms 这个数只有在牺牲正确性的前提下才拿得到。**
**最小建议**：把 T-05 的验收数字改成「命中路径省 ≥0.15ms 且 rev 语义不变」（可按 600 文件夹具复现），或者干脆把这条从「性能收益」降级为「零成本正确性收口」。**不建议**为了这个数字去换目录级缓存键。

---

## 5. 第 4 组 · T-07 接口延后可用性

### 5.1 首屏（DCL 前）接口请求数

【实测】用 `addInitScript` 包住 `fetch` 与 `XMLHttpRequest`，记录每次请求的 `performance.now()`，再与 navigation entry 的 DCL/load 对齐（1440×900，临时 vault）：

| 指标 | 实测 |
| --- | --- |
| DCL | 2,943 ms |
| load | 3,514 ms |
| **DCL 前发起的 `/api/*` 请求数** | **8** |
| 全部接口请求（到 load+2s） | 16 |
| load 之后才发出的 | 8 |

**DCL 前的 8 个（各 1 次，无重复）**：`/api/system/status`、`/api/version`、`/api/snippets`、`/api/env`、`/api/lan`、`/api/sync/status`、`/api/drawings/tree`、`/api/readings/tree`

### 5.2 被延后的接口（load 之后才发，全部 200）

| # | 接口 | 相对 load 的发出时刻 | 相对 load 的完成时刻 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | `/api/life/store` | +4 ms | +8 ms | 200 |
| 2 | `/api/remote/status` | +8 ms | +13 ms | 200 |
| 3 | `/api/ai/config` | +8 ms | +13 ms | 200 |
| 4 | `/api/git` | +8 ms | +14 ms | 200 |
| 5 | `/api/project/compile-db` | +8 ms | +15 ms | 200 |
| 6 | `/api/office/tree` | +9 ms | +15 ms | 200 |
| 7 | `/api/office/providers/v1` | +9 ms | +16 ms | 200 |
| 8 | `/api/office/service` | +9 ms | **+130 ms** | 200 |

全部落在 **load + 130ms** 内（派单要求 load+2s 内）✅。

### 5.3 被延后的功能，load+2s 时能不能用（逐项证据）

| 功能 | 证据 | 结论 |
| --- | --- | --- |
| **系统面板（本机管家）** | load+2s 时点 `#welcome-system` → **486 ms** 后 `body.system-mode=true`，`#system-body` 正文 **2,538 字符**（「一切正常 / CPU 21% · 内存 71% · 磁盘 81%」+ 仪表盘） | ✅ 可用 |
| **个人管理面板（热榜 / 邮箱 / 工作流）** | load+2s 时 `#btn-lifework` **已挂上**，点击后 **124 ms** 打开 `#lifework-view`，正文 **2,086 字符**；标签栏含 **热榜 H-01 / 邮箱 E-01 / 工作流 W-01**，三个标签均可点、无 pageerror | ✅ 可打开 |
| 热榜接口 | `/api/life/hot?q=code` → **200**，`ok:true`，带 `items` | ✅ |
| 邮箱接口 | `/api/life/mail/status` → **200**，`ok:true`（面板显示「邮箱未配置」：临时 data home 里没有账号，属环境态） | ✅ 接口/模块可达 |
| 工作流接口 | `/api/life/flow/schedule` → **200**，`ok:true` | ✅ |
| 系统面板接口 | `/api/system-panel/ping` → **200** | ✅ |
| pageerror | 0 | ✅ |

### 5.4 结论（含**口径修正**）

| 判据 | 目标 | 实测 | 结论 |
| --- | --- | --- | --- |
| 首屏（DCL 前）接口请求数 | 从 81 降到 ≤72（派单原文是**总请求数**口径） | **接口** 8 个（总资源请求另一个口径，本轮未重复测） | **PASS（★口径需注明）** |
| 延后接口 load 后可用 | load+2s 内 | 8/8 在 **+130ms** 内 200 | **PASS** |
| 被延后功能可用 | 各截图一次 | 系统面板 486ms/2538 字；个人管理面板 124ms/2086 字；4 个接口全 200 | **PASS** |

**★口径修正（重要）**：派单把「热榜 / 邮箱 / 工作流 / 系统面板」列成 T-07 的被延后对象，但【读码 + 实测】**T-07 代码里真正延后的是 5 组 8 个请求**（office 三个、git、compile-db、remote、ai 配置）；**热榜/邮箱/工作流属于「生活工作台」的独立懒加载**（`index.html:113-150`：`setTimeout(1500)` → `requestIdleCallback` 依次注入 `life-styles → life-editor → life-workbench`），系统面板是 T-10 的按需注入。两者都不是 `afterLoad()` 包的。所以本节实际测了两条独立链路，结论都成立，但**汇报时不能把「热榜/邮箱/工作流」说成 T-07 的产物**。

---

## 6. 第 5 组 · P-06 状态点

| 判据 | 改前目标值 | 实测 | 结论 |
| --- | --- | --- | --- |
| 静息态 `#autosave-hint::before` 的 `animation-name` | `none`（改前是 `asave-pulse 2.2s infinite`） | **`none`**（`animation-duration: 0s`） | **PASS** |
| 静息态 `box-shadow` 有内发光 | 含 `inset` | **3 层**：`inset 0 0 0 1px rgba(255,255,255,.26)` + `inset 0 0 4px 0 color(srgb .373 .820 .482/.78)` + `0 0 5px -1px …/.45` | **PASS** |
| 1px 内描边环 | 有 | 有 | **PASS** |
| 整页是否还有静息永动动画 | 0 条 | `document.getAnimations()` 共 20 条，**playState=running 的 0 条**；挂在 `autosave` 上的 running 动画 **0** | **PASS** |
| 5s 采样内外观是否恒定 | 无持续变化 | 50 次 × 100ms 采样 `box-shadow` / `opacity` / `background`：**不同取值 1 种** | **PASS** |
| 5s 内是否无持续重绘 | 无 | CDP `Performance.getMetrics` 5s 增量：**LayoutCount=1**、**RecalcStyleCount=4**、LayoutDuration=0.0002s、RecalcStyleDuration=0.009s | **PASS** |
| `.dirty` 态动起来 | `saveModePulse 1.5s infinite` | `animation-name=saveModePulse`、`1.5s`、`infinite`，内发光同时加强 | **PASS** |

> 「无持续重绘」的口径说明：纯 opacity/box-shadow 动画跑在合成器上，`RecalcStyleCount` 抓不到它；所以**真正硬的证据是前两行**（`animation-name=none` + 整页 running 动画 = 0 + 5s 采样恒值）。CDP 计数是补强，不是主证。

---

## 7. 第 6 组 · P-09 按下态

【实测】每类元素**单独开一个页面**测，按下用真实 `mouse.down()`（按住 260–300ms，> 120ms 过渡），松开前先把指针移开以免触发 click：

| 元素 | transform 按下前→中→后 | 按下时 box-shadow | 按下前后 `getBoundingClientRect` | 结论 |
| --- | --- | --- | --- | --- |
| `.office-row`（办公行） | `none` → **`matrix(1,0,0,1,0,1)`** → `none` | `rgba(255,255,255,.043) 0 0 0 1px inset` | 269.3 × 26.6 → **269.3 × 26.6**（不变） | 下沉 ✅ / 内阴影 ⚠️ |
| `.draw-row`（绘图行） | `none` → **`matrix(1,0,0,1,0,1)`** → `none` | 同上（`rgba(255,255,255,.043)` 单层环） | 269.3 × 25.5 → **269.3 × 25.5**（不变） | 下沉 ✅ / 内阴影 ⚠️ |
| `.ctx-menu .ctx-item`（右键菜单项） | `none` → **`matrix(0.985,0,0,0.985,0,0.5)`** → `none` | `rgba(0,0,0,.44) 0 2px 5px 0 inset` | 151.1 × 24.6 → **148.8 × 24.2（变了）** | **FAIL** |

判据对照：

| 判据 | 目标 | 实测 | 结论 |
| --- | --- | --- | --- |
| 行类按下 `transform === matrix(0.99…)` 等价的下沉 | 1px 下沉 | `matrix(1,0,0,1,0,1)`（= `translateY(1px)`） | **PASS** |
| 松开 200ms 内回到 `none` | 是 | 400ms 后读：`none` | **PASS** |
| 行类按下有内阴影（`inset 0 1px 3px rgba(0,0,0,.32)` + accent 环） | 是 | **只有 `rgba(255,255,255,.043) 0 0 0 1px inset`** —— 这是 **hover 规则**（app.css:3355 `inset 0 0 0 1px rgba(255,255,255,.045)`） | **FAIL** |
| `.symr` / `.ctx-item` 按下 `transform` 必须 `none`（反例判据） | `none` | `.ctx-item` 被缩放成 `0.985`（`.symr` 本轮未取到可见实例） | **FAIL** |
| 按下前后宽高不变 | 全部不变 | 行类不变 ✅；**菜单项缩小约 1.5%** ❌ | **FAIL（部分）** |

### 7.1 根因（【实测】computed 值 +【推断】特异性推论）

1. **内阴影被 hover 规则压掉**：`html[data-theme] .office-row:hover`（app.css:3353-3355）特异性 **(0,3,1)**，而 P-09 的 `.office-row:active`（motion-batch1.css:570）只有 **(0,2,0)**。鼠标按住时元素**同时处于 `:hover`**，所以赢的是 hover 那条 —— 实测拿到的正好是 `rgba(255,255,255,.043)`（hover 的 `.045` 在过渡中），不是 P-09 写的两条 inset。
2. **菜单项被全局按钮按下规则抢走**：`html[data-theme] button:active:not(:disabled)`（app.css:3305）特异性 **(0,3,2)**，P-09 的 `.ctx-menu .ctx-item:active`（motion-batch1.css:603）是 **(0,3,0)** —— 输。实测 `matrix(0.985,…)` 正是 `--mo-press: .985` + `translateY(.5px)`，也就把 `getBoundingClientRect` 缩小了 1.5%，与 P-09 注释里「缩放会让高亮框跟着跳」的初衷正好相反。
3. 行类 `transform` 之所以能生效：没有任何 hover 规则写 `transform`，所以 P-09 那条是唯一声明 —— 这也反证了「不是选择器写错，是被更高特异性的规则覆盖」。

### 7.2 最小修复建议（**我没有改**）

1. 把按下规则的选择器写成和抢权者同前缀（只加前缀，**不改行数**）：
   `html[data-theme] .office-row:active, html[data-theme] .draw-row:active, …` → (0,3,1)，与 hover 同特异性 + `motion-batch1.css` 后加载 ⇒ 反超。
2. 菜单项反向判据：补一条 `html[data-theme] .ctx-menu .ctx-item:active { transform: none; }`（(0,4,1) > (0,3,2)），让「只补颜色不缩放」真的成立。
3. 验收补充：按下态除了比对 `transform` 字符串，**必须同时断言 `getBoundingClientRect().width/height` 与按下前逐值相同**（本轮正是这条抓到了菜单项的问题）。

---

## 8. 汇总：数字目标 vs 实测

| 组 | 判据 | 目标 | 实测 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | 三档令牌单调 | 严格单调 | 1/4/8 · 2/6-12/28-24/56 · alpha 递增 | PASS |
| 1 | 三面 computed 值 | 抽屉/面板=e3、菜单=e2 | 逐值吻合（明暗两套） | PASS |
| 1 | 暗色可见度 | 「不再几乎读不出」 | 整页 1.22%（< 浅 1.88%）；抽屉顶边 0 变化、左边 maxΔ=4 | **FAIL** |
| 2 | index.html br + Vary | 是 | 37,604 B，CE=br，Vary ✅ | PASS |
| 2 | 首屏最大 3 js br + Vary | 3/3 | 3/3 ✅ 且解压一致 | PASS |
| 2 | identity 返回原文 | 是 | 151,850 B 逐字节一致 | PASS |
| 2 | 传输 ≤ 35,000 B / ~31.6KB | ≤35,000 | **37,604** | **FAIL（目标过时）** |
| 3 | 改文件 rev 变化 | 必须变 | `n8qhz3→1ly637j` 立刻变 | PASS |
| 3 | 热调用 < 0.05ms | <0.05ms | **2.53 ms**（只省 0.20ms） | **FAIL（目标不可达）** |
| 4 | DCL 前接口数 | ≤72 | **8** | PASS |
| 4 | 延后接口 load+2s 可用 | 是 | 8/8 在 +130ms 内 200 | PASS |
| 4 | 四功能 load+2s 可用 | 是 | 486ms / 124ms / 4 个接口 200 | PASS |
| 5 | 静息 animation-name | none | none | PASS |
| 5 | 内发光 / 1px 环 | 有 | 3 层 inset + 1px 环 | PASS |
| 5 | 5s 无持续重绘 | 是 | running 动画 0；采样恒值；RecalcStyle +4 | PASS |
| 6 | 1px 下沉 + 宽高不变 | 是 | `matrix(1,0,0,1,0,1)`，rect 不变 | PASS |
| 6 | 按下内阴影（作者值） | 两条 inset | 被 hover 规则覆盖 | **FAIL** |
| 6 | 菜单项 transform 必须 none | none | `scale(.985)`，rect 缩小 1.5% | **FAIL** |

**总计：18 条判据 → 13 PASS / 5 FAIL**（其中第 2 组的 FAIL 与第 3 组的 FAIL 属于「目标值本身有问题」，第 4 组属「口径需注明」，第 1、6 组是真实缺陷）

---

## 9. 附带发现（本轮顺手量到，不属于原 6 组）

1. **孤儿进程**：`127.0.0.1:4951` 上有一个 **00:17:18 就启动**的 `node server.js`（cwd=`masscode-runner`，PID 93241，父进程已退出）。它**不是本轮起的**（本轮所有 49xx 端口都已释放），我没动它 —— 提醒下一轮：这可能是上一次验证残留的实例。
2. **上一轮 8.84% / 1.31% 这两个像素差数**跨夹具不可比，建议以后所有像素差都附「视口 + 页面状态 + 冻结方式」三要素。
3. `/api/life/store` 在 load 后 **+4ms** 就发了 —— 生活工作台的三段脚本链（styles→editor→panel）在 load 前就已完成注入，属于「本该 1.5s 后」的提前量，不是问题但有解释价值。

---

## 10. 没做到的 / 已知限制

1. **暗色只测了 `ocean` 一套**：另外三套暗色（graphite / midnight / forest）共用同一条 `html[data-theme]:not([data-theme="light"])` 令牌覆盖，机制相同；但各自 `--border` 不同（#2b3747 / #382d4d / #294238），边缘 Δ 会有差异，未逐个测。
2. **像素差绝对值不可跨轮比较**（见 §9.2）；本文所有结论都是**同夹具内**的明暗对照或「有无某条规则」的 A/B。
3. **邮箱只验到「面板与接口可达」**：临时 `CODESCOPE_DATA_HOME` 里没有邮箱账号，面板显示「邮箱未配置」，未验证收件/发件/附件链路。
4. **热榜只验到「接口 200 且带 items」**，没逐条校验内容质量（依赖外部网络）。
5. **`.symr`（符号结果行）没取到可见实例**：`openSymModal` 后结果区高度为 0（需要真实符号索引），本轮用 `.office-row` / `.draw-row` / `.ctx-item` 三类替代；`.symr` 的按下态**未实测**，其反例判据（transform 必须 none）与 `.ctx-item` 同源风险（同样是 `button`），建议一并按 §7.2 修复后复测。
6. **T-05 的「两个标签页 × 3s」场景未测**（派单验收第 1 条），只测了单连接冷/热与服务端缓存语义。
7. **4877 未被触碰**、无任何 git 写操作、未修改任何源码/测试；本文件不提交。

---

## 附录 · 探针与原始数据

| 探针 | 端口 | 覆盖 | 原始输出 |
| --- | --- | --- | --- |
| `probe-http.js` | 4931 | brotli 三态、首屏最大 3 js、rev 冷/热/改文件/边界 | `out-http.json` |
| `probe-http2.js` | 4934 | 600 文件 vault 的命中/未命中 A/B + index.html br11 历史轨迹 | `out-rev.json` |
| `probe-visual.js` | 4935 | 三面 computed + 整页像素差（明/暗 × pre-P-05/P-05/当前） | `out-visual.json` |
| `probe-visual2.js` | 4937 | 按面裁剪的像素差 | `out-visual2.json`、`shots2/` |
| `probe-isolated.js` | 4942 | 每面隔离打开后的顶边/左边 4px 带像素变化 | `out-isolated.json` |
| `probe-dot-press.js` | 4936 | P-06 全量 + P-09 首轮 | `out-dot-press.json` |
| `probe-press2.js` | 4939 | P-09 三类元素（独立页面 + elementFromPoint 归因） | `out-press2.json` |
| `probe-draw.js` | 4943 | 绘图行按下态（关掉新建对话框后重测） | `log-draw.txt` |
| `probe-defer.js` | 4938 | DCL 前接口数、延后接口时序、系统面板可用性 | `out-defer.json` |
| `probe-life.js` | 4940 | 个人管理面板（热榜/邮箱/工作流）load+2s 可用性 | `out-life.json` |

---

# 11. 修复回合（2026-11-01 02:00 前后）· 三条缺陷的处置

> **本节取代 §0 表里第 1 组、第 6 组以及 §2.3 / §7 的 FAIL 判定。**§2 / §7 的原始实测**保留作历史**（那些数字当时是对的，只是判据和归因需要修正）。
> **纪律**：只改 `assets/motion-batch1.css` **一个文件**（CSS 棘轮：新规则一律写进这里）；`src/*`、`lib/*`、`server.js`、`tests/*`、`assets/app.css`、`assets/ui-kit.css`、`assets/motion.css`、`assets/life-*.js`、`index.html` **一个字节没动**（`git status --porcelain` 只显示 `M masscode-runner/assets/motion-batch1.css`）；**无任何 git 写操作**；**4877 未触碰**。
> **自测**：`CODESCOPE_PORT=4961/4962/4965/4966/4968/4969` + 独立 `CODESCOPE_DATA_HOME` + 临时 vault，每支探针 finally `SIGKILL` 并回读端口（全部打印「端口 49xx 释放：是」）。
> **回归**：架构断言 **91/91**、`tests/undefined-refs.js` **0 条**、pageerror **0**。

## 11.1 缺陷 1（P-09 按下态）——已修，实测 PASS

### 11.1.1 先纠正 §7.1 的归因：抢权者是 **ID 级**规则，不是 (0,3,1)

§7.1 把行类被压归到 `html[data-theme] .office-row:hover`(0,3,1)。本轮读码发现**真正赢的是 app.css:3661 的 `#office-list .office-row:hover:not(.dragging)` = (1,3,0)** —— ID 数 1 > 0，所以 `html[data-theme] .office-row:active`(0,3,1) **照样输**，§7.2 建议 1「只加 html[data-theme] 前缀」**不够**。本轮照此重算了一遍，改法与实测如下。

### 11.1.2 改了哪些选择器 / 特异性（全部在 `assets/motion-batch1.css` 第 8 节）

| 目标 | 改前 | 改后 | 抢权者（实测确认） |
| --- | --- | --- | --- |
| 办公行 | `.office-row:active` (0,2,0) | `html[data-theme] #office-list .office-row:active` **(1,3,1)** | `#office-list .office-row:hover:not(.dragging)` (1,3,0) |
| 绘图行 | `.draw-row:active` (0,2,0) | `html[data-theme] #draw-list .draw-row:active` **(1,3,1)** | `#draw-list .draw-row:hover:not(.dragging)` (1,3,0) |
| 阅读行 | `#reading-list .reading-row:active` (1,1,0) | `html[data-theme] #reading-list .reading-row:active` **(1,2,1)** | `#reading-list .reading-row:hover` (1,2,0) |
| 阅读项目 | `.reading-project:active` (0,2,0) | `html[data-theme] .reading-project:active` (0,3,1) | hover 侧不写 box-shadow，无竞争 |
| 热榜行 | `.lw-hotrow:active` (0,2,0) | `html[data-theme] .lw-hotrow:active` (0,3,1) | life-styles.js 注入的 `.lw-hotrow:hover` (0,1,1) |
| **菜单项** | `.ctx-menu .ctx-item:active` (0,3,0) | `html[data-theme] .ctx-menu .ctx-item:active` **(0,4,1)** | `html[data-theme] button:active:not(:disabled)` **(0,3,2)** |
| **符号行** | `.symr:active` (0,2,0) | `html[data-theme] .symr:active` (0,3,1) + `:active:not(:disabled)` **(0,4,1)** | 见 11.1.5（其实没有 button 规则参与） |
| 选中行 | `.office-row.on:active` (0,3,0) | `html[data-theme] #office-list .office-row.on:active` **(1,4,1)** | **自家基态按下规则** (1,3,1) —— 不抬这一档，强调条会被自己刚修好的规则顶掉 |

三条附加约束都落到了规则里：

- 行类只写 `transform: translateY(1px)` + 两道 inset（`inset 0 1px 3px rgb(0 0 0 / .32)` + `inset 0 0 0 1px color-mix(--accent 22%)`），**没有 scale**；
- 菜单项/符号行**显式 `transform: none`**（把全局按钮 `translateY(.5px) scale(.985)` 反向声明掉）；
- 选中行那条**把强调条原样抄回来再加内压痕**，避免按住时选中条消失。

### 11.1.3 实测（真实 `mouse.down()` 按住 300 ms > 120 ms 过渡，1600×1000，ocean 暗色）

| 元素 | 标签 | rect 按下前 → 按下中 | Δw / Δh | 按下 transform | 按下 box-shadow |
| --- | --- | --- | --- | --- | --- |
| `.office-row` | div | 269.28×26.63 → **269.28×26.63** | **0.000 / 0.000** | `matrix(1, 0, 0, 1, 0, 1)` | `rgba(0,0,0,.32) 0px 1px 3px 0px inset, color(srgb .470588 .662745 1 / .22) 0px 0px 0px 1px inset` |
| `.draw-row` | div | 269.28×25.52 → **269.28×25.52** | **0.000 / 0.000** | `matrix(1, 0, 0, 1, 0, 1)` | 同上（两道 inset） |
| `.ctx-menu .ctx-item` | **button** | 151.13×24.63 → **151.13×24.63** | **0.000 / 0.000** | **`none`** | 同上（两道 inset） |
| `.symr` | div | 668.58×31.38 → **668.58×31.38** | **0.000 / 0.000** | **`none`** | 同上（两道 inset） |

对照 §7 的旧实测：`.office-row` 的按下内阴影从 **hover 的 `rgba(255,255,255,.043) 0 0 0 1px inset`** 变成了作者写的两道 inset；`.ctx-item` 的 transform 从 **`matrix(0.985,…)`（rect 151.1×24.6 → 148.8×24.2）** 变成了 **`none` 且 rect 一位不差**。

**附加回归（选中行）**：给第一行加 `.on` 后按住 —— `transform=matrix(1,0,0,1,0,1)`，shadow = `rgb(120,169,255) 3px 0px 0px 0px inset, color(srgb .47 .66 1 / .32) 0px 0px 0px 1px inset, rgba(0,0,0,.32) 0px 1px 3px 0px inset` ⇒ **左侧强调条仍在**、内压痕也加了、rect 不变。

### 11.1.4 收尾自检

最后一次改动只动了注释，仍复测：CSS 花括号 **67 { / 67 }** 配平、末尾 outline 规则仍生效、`.office-row` 按下仍拿两道 inset、rect Δw=0.000、pageerror=0。

### 11.1.5 顺手纠正 §10.5 的一处事实错误

§10.5 写「`.symr` 与 `.ctx-item` 同源（同为 button）」。**实测 `.symr` 是 `div`**（app.js:8689 `document.createElement('div')`），**从来不受 `html[data-theme] button:active:not(:disabled)` 影响**，也就从来没有被缩放过；真正中招的只有 `.ctx-item`（app.js:934 建的是 `button`）。本轮仍给 `.symr` 显式补了 `transform: none` 作兜底（成本一行，语义明确），实测 `none`。

## 11.2 缺陷 2（暗色层级 1px 内描边）——已修，实测 PASS

### 11.2.1 改法

- `assets/motion-batch1.css` 第 6 节：暗色令牌 `--el-1/2/3` 里**删掉** `inset 0 0 0 1px color-mix(--border 70%)`（只留外阴影 + 顶部内高光，inset 条数 2 → 1）；
- 新增一条（第 6 节 ④）：

```css
html[data-theme]:not([data-theme="light"]) #pane-git,
html[data-theme]:not([data-theme="light"]) #sym-modal-box,
html[data-theme]:not([data-theme="light"]) .ctx-menu {
  outline: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  outline-offset: -1px;
}
```

特异性 **(1,2,1)**（html + [data-theme] + :not([data-theme=light]) + #id），高于项目里任何一条 outline 规则（ui-kit.css:185 的 `:focus-visible` 只有 (0,1,0)）。outline 画在**边框之后**、`offset:-1px` 让它落在边框那 1px 里 ⇒ 不被盖住，且**不参与布局**（盒模型、getBoundingClientRect 全不变）。

### 11.2.2 computed（暗色 ocean，1440×900）

| 面 | outline-width | outline-style | outline-offset | outline-color | box-shadow inset 条数 |
| --- | --- | --- | --- | --- | --- |
| `#pane-git` | **1px** | **solid** | **-1px** | `color(srgb 0.909804 0.929412 0.956863 / 0.14)` | 2 → **1** |
| `#sym-modal-box` | **1px** | **solid** | **-1px** | 同上 | 2 → **1** |
| `.ctx-menu` | **1px** | **solid** | **-1px** | 同上 | 2 → **1** |

### 11.2.3 「面内裁剪 + 边缘 maxΔ」（三态显式注入 A/B，不是整页像素差）

口径：`elementHandle.screenshot()` 拿元素**自身盒**（400×844 / 780×702 / 184×96），取**顶边 4px 带**与**左边 4px 带**，三种状态各自注入后截图对比：
`old` = 改前的 inset 环（--border 70%）；`new` = 现在的 outline 环（--text 14%）；`none` = 两样都不要（maxΔ 的分母）。

| 面 | 顶边 maxΔ：改前 → **改后** | 左边 maxΔ（改后） |
| --- | --- | --- |
| 抽屉 `#pane-git` | **1/255** → **29/255** | **31/255** |
| 命令面板 `#sym-modal-box` | **15/255** → **26/255** | **26/255** |
| 右键菜单 `.ctx-menu` | **9~16/255**（两轮，随半透明背景内容浮动） → **27/255** | **27/255** |

三面全部 **≥ 12/255** ✅（要求 ≥12）。

### 11.2.4 机制修正：不是「整块被盖住」，是「画在了别人后面」

【实测】改前的环**并不是一个像素都不剩**，而是被不同的东西占住最外那 1 行：

1. **抽屉顶边**：最外 1 行是不透明子元素 `#git-head`（背景 `var(--theme-elevated)`）⇒ 改前 `maxΔ=1`、只有 0.4% 像素变化，**等于完全看不见**；
2. **命令面板 / 菜单顶边**：最外 1 行是 1px 边框（app.css:3250 `border-color:#34465c`），环被挤到内侧第二行，只剩 `maxΔ=15`/`16` 的淡线（**只有 25% 的像素 = 恰好 1 行**有变化，这也是「看起来没生效」的原因）；
3. **环色本身太淡**：`--border`(#273241) 与面底(#121a24) 只差十几级，再乘 .7 就是 15/16 这个量级。

⚠️ **§2.2 里「命令面板顶边/左边 0 像素变化」本轮没复现**：同一切法下改前是 15/255。差异来自当时那一列比的是「当前 vs P-05 提交」而不是「有环 vs 无环」的显式注入。**结论方向不变，但数字请以 §11.2.3 的三态 A/B 为准。**

### 11.2.5 一个踩过的坑（写下来免得下一轮再踩）

第一遍测暗色边缘时得到「面板 0/255」，差点被当成「outline 没生效」。真实原因：**探针在 `openSymModal()` 之后立刻注入 `animation-play-state:paused`**，把 `#sym-modal` 的入场动画暂停在 **0%（opacity:0）**，于是元素截图是一张透明图 —— 任何状态都 0 像素差。**修正：先等入场动画播完（本轮 1200ms）再冻结**，之后三项都出正常数字（同一次运行里 drawer 29、modal 26、ctx 27）。
诊断手法记一笔：对同一元素强制 `outline: 3px solid red !important`，若截图变化 8856 像素、maxΔ=244 说明 outline 画得出来；若仍 0，才该怀疑绘制层。

## 11.3 缺陷 3 · 目标值修正建议（**不改实现**，只改验收数字）

> 两条都**没有动实现**：`index.html`、`server.js`、brotli 路径、computeRev 缓存键**一个字节没改**。

### 11.3.1 brotli：「index.html 44.6KB → ~31.6KB」/「≤35,000 B」两个阈值都作废

**现状（§3 实测，本轮未复测、沿用）**：`index.html` raw **151,850 B**，`br`(q11) **37,604 B（36.7 KB）**，`gzip` 52,051 B。

**为什么原目标不成立（不是压缩退化，是分子变了）**：31.6 KB 是 **commit `7ff4a65`（10-31）那一刻**的数（raw 135,973 B → br 32,392 B）。之后 T-06（脚本 defer，+3.0 KB br）与 T-10（按需注入，+3.9 KB br）把 raw 从 135,973 B 撑到 151,850 B（**+11.7%**）。压缩能力没变：`br/raw = 37,604 / 151,850 = **24.8%**`（7ff4a65 那刻是 23.8%，同级）；`br/gzip = 37,604 / 52,051 = **0.72**`（q11 相对 gzip 的常规优势）。

**应该改用这三个数字**：

1. **主判据（跟版本走，不会随功能增长误红）**：`br / raw ≤ 26%`，且 `br < gzip`（实测 24.8%、0.72）。
2. **绝对字节数只在「锁 commit」时使用**：`git show <commit>:masscode-runner/index.html | brotli -q 11 | wc -c` 的结果与线上 `Content-Encoding: br` 返回的字节数**逐字节相等**才算 PASS（本轮 HEAD `5fa2b38` 复算 37,604 = 线上 37,604 ✅）。这条才是「服务端真的用 q11」的证据。
3. **T-04 的 `≤ 35,000 B` 一并作废**，或改写成公式 `budget = ceil(raw × 0.26)`（当前 raw 下 = 39,481 B）。若一定要一个整数，就用 **≤ 38,000 B**，但要接受「每加一个特性就红一次」的维护代价 —— **不建议**。

### 11.3.2 T-05：「热调用 < 0.05ms」这个目标与实现口径冲突，应降级为「省 ≥0.15ms」

**现状（§4 实测，本轮未复测）**：缓存命中只省 **0.20 ms/次（2.73 → 2.53，≈7%）**，离 0.05 ms 差两个数量级。

**为什么原目标不成立**：缓存键**必须是**「排序后的 `path:mtime:size` 全量快照串」—— 因为**原地改文件不会改父目录 mtime**，用目录聚合键会让「编辑器保存后 rev 不变」，正好吃掉前端 3s 一次的 change 检测（§4.2 的边界行就是这条约束的证据）。所以命中路径能省的只有 **hash 那一段**，`walk + stat` 一步都省不掉。<0.05 ms 只有在**牺牲 rev 正确性**时才能拿到 —— 两个目标互斥，不是没优化。

**应该改用这三个数字**：

1. **主判据（可复现）**：600 文件 vault 下，**命中路径比未命中路径省 ≥ 0.15 ms**（本轮 0.20 ms），且 §4.2「改一个文件 rev 立刻变」保持 PASS。
2. **防退化判据（方向相反的一条）**：命中时**不得**跳过 stat/mtime；`改内容 + utimes 复原 mtime + 同尺寸` 这个边界**允许**检测不到 —— 它已经是记录在案的已知边界，不该反过来当回归失败。
3. **定性**：T-05 从「性能收益」降级为「**零成本正确性收口**（O(1) 哈希，不为它换缓存键）」，不设绝对耗时阈值。若确实要优化的 KPI，另立一条功能判据：「改文件后 rev 变化在 ≤1 次前端轮询（3 s）内可见」。

## 11.4 没做到的 / 已知限制

1. **暗色只测 `ocean` 一套**：另三套（graphite / midnight / forest）的 `--border` 不同，但改后的环色**只取 `--text`**（四套暗色的 `--text` 都接近 #e8edf4）⇒ 机制一致、强度同级；未逐套实测。
2. **outline 会压住 `:focus-visible`**：这三个面都**不可聚焦**（div、无 tabindex），所以没有可达性损失；**将来若给它们加 `tabindex`，必须补一条 `:focus-visible` 例外**。
3. **`.reading-project` / `.lw-hotrow` 的按下态未单独实测**：与行类同一条规则、同类元素（div），本轮没取到稳定可见实例；`.office-row` / `.draw-row` / `.ctx-item` / `.symr` 四类是实测过的。
4. **`.symr` 只在「命令面板有结果行」时可测**：本轮真实实例（668.58×31.38，`div`），未用合成元素。
5. **只测鼠标按下**：键盘 focus 态、触摸/长按未测。
6. **像素差口径**：§11.2 全部是**元素内裁剪 + 三态显式注入**，不是整页像素差（整页口径对边缘级修复不敏感，见 §2.3 结尾）。
7. **本回合未做 git 提交**（按要求禁止 git 写操作），改动只存在于工作区。

## 11.5 取证文件

| 探针 / 产物 | 端口 | 覆盖 |
| --- | --- | --- |
| `/tmp/cs-fix/probe-fix.js` | 4961 | 按下态 4 类第一遍 + 暗色三面第一遍（暗色因动画冻结时机错，得 0/255，已作废） |
| `/tmp/cs-fix/probe-fix2.js` | 4965 | `.draw-row` 补测（先关 `#draw-ndialog`）+ 暗色三面重测（**修正冻结时机**） |
| `/tmp/cs-fix/probe-dark3.js` | 4966 | 暗色三面复测 + 生成验收图 `/tmp/fix-dark-edge.png` |
| `/tmp/cs-fix/probe-modal-dbg.js` / `probe-modal-micro.js` | 4963 / 4964 | 「outline 为什么看不见」的归因（含强制红环实验） |
| `/tmp/cs-fix/probe-selected2.js` | 4968 | 选中行 `.on` 按下时强调条不回退 |
| `/tmp/cs-fix/probe-final.js` | 4969 | 最后只改注释后的收尾自检 |
| 原始 JSON | — | `out-fix.json`、`out-fix2.json`、`out-selected.json` |
| 验收图 | — | `/tmp/fix-active.png`（按下态 4 类）、`/tmp/fix-dark-edge.png`（暗色三面 × 改前/改后/无环） |

> 本节结论：**缺陷 1、缺陷 2 已修并实测通过**（四类按下态 rect 零变化、三面边缘 maxΔ 26~31 ≥ 12）；**缺陷 3 按「目标值过时」处理，未改实现**，验收数字改用 §11.3 的相对判据。
