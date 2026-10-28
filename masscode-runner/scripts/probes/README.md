# scripts/probes · 一次性排查/测量脚本

这里放的是**临时排查与性能测量**用的脚本，不是产品的一部分，也不会被 `npm test` 调用。

## 判据：什么样的脚本该放这里

- 只在**查某个具体问题**时跑过一次或几次（例如「滚动位置为什么不保持」）；
- 为**一次性能测量**写的采样脚本（CDP Profiler / trace / 逐文件计时）；
- 需要人工看输出判断的脚本 —— 没有断言、没有退出码语义。

与之相对，**有断言、能自动判红绿**的脚本属于 `tests/`（它们在 `npm test` 里有位置）。

## 现状

| 脚本 | 用途 |
| --- | --- |
| `verify-scroll-keep.js` | 验证切视图后滚动位置是否保持 |
| `verify-search.js` | 验证搜索高亮与跳转 |
| `verify-word-pick.js` | 验证单词取词（划词选词）行为 |
| `perf-load.js` / `perf-trace.js` / `perf-profile.js` | 首屏加载与 CDP 采样（FCP/DCL/长任务） |
| `perf-article.js` / `perf-wordbook.js` / `perf-glyph.js` / `perf-paths.js` | 分模块耗时定位 |

## 怎么跑

```bash
cd masscode-runner
node scripts/probes/perf-load.js
```

实测它们的依赖只有两样：`playwright-core`（Node 会从 `scripts/probes/` 一路向上找到
`masscode-runner/node_modules` ✓，不用改路径）和 `fs`。**没有任何脚本用 `__dirname` 定位仓库**，
所以移动目录本身不会让它们失效。

⚠️ 但它们**按当前工作目录**决定两件事：去连哪个端口、把截图/报告写到哪里。
所以请**站在 `masscode-runner/` 目录里**跑（如上），不要从仓库根目录或别处调用 ——
那样跑出来的截图会散到别的目录里。

> 之所以集中到这里：根目录曾经同时躺着 10 个 `verify-*` / `perf-*`，
> 和产品代码平铺在一起，新人分不清哪个是入口、哪个是「上次查问题时随手写的」。