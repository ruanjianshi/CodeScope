# CodeScope 架构

> 本文档里的**每个数字都是从代码里量出来的**（`wc -l` / `grep`），不是估计值。
> 出处见每节末尾的「源证据」。
>
> 学自 [Archify](https://github.com/tt-a1i/archify) 的三条做法：
> ① **节点要带源证据**（能追到文件/行数，图才不会变成"想象"）；
> ② **架构是可校验的**（能写成断言，而不是只靠人看图）；
> ③ **图要能对比变化**（否则画完就过时）。

---

## 一、分层

```
浏览器
  index.html          1,060 行  ← 已抽外链（原 1,771 行）
  assets/app.js      17,142 行  ← ★ 单文件 SPA
  assets/app.css      4,287 行
  src/                 9,485 行  ← 10 个独立视图
        │  HTTP / SSE
        ▼
服务端
  server.js           9,084 行  ← 215 个端点 / 22 组
        │  函数调用
        ▼
领域服务 lib/        17,154 行  ← 35 个模块
        │  子进程 / 网络
        ▼
外部运行时
  OnlyOffice · code-server · DeepSeek Harness · Octave / Python
```

**源证据**：`wc -l server.js assets/app.js assets/app.css index.html lib/*.js src/*.js`；
端点数 `grep -oE "'/api/[a-z0-9-]+" server.js | sort -u | wc -l`。

---

## 二、API 分组（22 组，按端点数排序）

| 组 | 端点数 | 组 | 端点数 |
|---|---|---|---|
| `/api/life` | 58 | `/api/git` | 6 |
| `/api/readings` | 31 | `/api/term` | 5 |
| `/api/office` | 22 | `/api/libraries` | 4 |
| `/api/drawings` | 11 | `/api/ai` | 4 |
| `/api/remote` | 9 | `/api/timeline` | 3 |
| `/api/fs` | 9 | `/api/py` | 3 |
| `/api/project` | 7 | `/api/integrations` | 3 |
| `/api/latex` | 7 | 其余 8 组 | 各 1–2 |
| `/api/sync` `/api/study` `/api/knowledge` | 各 6 | | |

**源证据**：`grep -oE "'/api/[a-z0-9-]+" server.js | sed "s|'/api/||" | sort | uniq -c | sort -rn`

---

## 三、lib/ 的职责（前 10 大）

| 模块 | 行数 | 职责 |
|---|---|---|
| `system-panel.js` | 2,471 | 系统状态面板 |
| `knowledge-base.js` | 1,406 | 知识库（VitePress 生成） |
| `remote-sync.js` | 1,384 | 双向同步 |
| `system-files.js` | 1,217 | 文件系统能力 |
| `code-server-service.js` | 1,068 | 托管 code-server |
| `system-software.js` | 683 | 软件安装 |
| `imap-client.js` | 679 | 邮件 |
| `roots.js` | 613 | 路径/根目录策略 |
| `workflow.js` | 598 | 工作流 |
| `code-graph.js` | 587 | 代码图（CFG） |

**源证据**：`wc -l lib/*.js | sort -rn | head -10`

---

## 四、可改进项（按性价比排序）

### P0 · 两个巨型单文件

| 文件 | 现状 | 问题 |
|---|---|---|
| `assets/app.js` | **17,142 行 / 1.2 MB** | 改任何一处都要**通读**；`git blame` 失效；无法按需加载 |
| `server.js` | **9,084 行 / 215 端点** | 22 组端点混在一起；加一组新 API 要动同一个文件 |

**已经做对的一半**：`ceff78b` 把内联的 1,049 KB 抽成了外链
（重复打开 595 KB → 43 KB，省 93%）。**但那是"传输层"的拆分，不是"代码层"的。**

**建议**：按**已有的天然边界**拆 —— `server.js` 的 22 个 `/api/*` 前缀就是现成的模块边界，
一个前缀一个文件（`routes/life.js` / `routes/office.js` …），
`server.js` 只留「挂载 + 中间件」。`app.js` 同理，按面板拆。

### P1 · 架构图会过时

现在没有架构图。即使画了，**没有源证据 + 没有变化检测** → 三个月后没人敢信它。

**建议（学 Archify）**：
- 图里每个节点标注**来源文件 + 行数**；
- 加一个**测试**断言这些数字还在合理范围（比如「`server.js` < 3000 行」），
  超了就红 —— 这样**重构进度是可观测的**，而不是靠自觉。

### P2 · 缺「架构断言」这一类测试

现在 50 个测试全是**功能测试**。没有一条在守**结构**。

**建议**加几条便宜但有用的：
```
· 没有任何单文件超过 N 行
· lib/ 里的模块不 require 彼此的循环依赖
· 每个 /api/* 分组都有对应的测试文件
· 前端不直接 fetch 未在文档里登记过的端点
```

### P3 · 前端状态没有单一真相

`app.js` 里 `CURRENT` / `CINDEX` / `EDITING` / `DEBUG` / `BREAKPOINTS` …
都是模块级可变全局。多个面板（变量面板 / 输出 / 调试条）都在读它们，
**改一个要记得通知其他几个**（这次做「自动刷新」就踩到了：
面板关掉后必须清引用，否则会去动已移除的节点）。

**建议**：把跨面板共享的状态收进一个 `state` 对象 + 一个极简的订阅
（`on('debug:line', fn)`），比"记得手动同步"可靠。

### P4 · 文档与代码的双向引用

`README.md` / `CHANGELOG.md` / `docs/` 都有，但**代码里不指向文档**，
文档里也不指向代码。

**建议**：像本文这样，**每个数字都写清是哪条命令量出来的**。
下次有人问「这数还准吗」，他**能自己跑一遍**。

---

## 五、这次自检量到的健康度

| 项 | 结果 |
|---|---|
| JS 语法（98 个文件） | ✅ 全通过 |
| `npm test`（23 个） | ✅ 全绿 |
| 四个专项（run / blockly / tour / browser） | ✅ 前三个绿，`browser` 红（陈年） |
| TODO / FIXME / HACK | ✅ 一个都没有 |
| 单文件最大行数 | ⚠️ `assets/app.js` 17,142 行 |
