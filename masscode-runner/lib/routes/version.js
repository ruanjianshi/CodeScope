#!/usr/bin/env node
'use strict';
/*
 * 路由：version（/api/version/*）
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
  const { send, APP_VERSION, APP_MODE } = ctx;

    if (req.method === 'GET' && u.pathname === '/api/version') {
    return send(res, 200, { ok: true, name: '码境 CodeScope', version: APP_VERSION, apiRevision: 6, releaseChannel:'stable', mode:APP_MODE,
      capabilities:{ web:true, desktop:APP_MODE === 'desktop', nativeBridge:APP_MODE === 'desktop' },
      study:{ available:true, webOnly:true, layoutEngine:'Golden Layout', paneTypes:['browser','code','notes','pdf'], presets:['study','dual','notes','quad'] },
      knowledge:{ available:true, engine:'VitePress', url:'/knowledge/', source:'readings/知识库', autoBuild:true, localSearch:true },
      features: ['study-workspace', 'study-bookmarks', 'study-site-catalog', 'study-site-categories', 'study-layout-presets', 'study-layout-truth', 'study-readable-browser', 'study-video-timepoints', 'study-video-frame-capture', 'dual-mode-runtime', 'desktop-shell', 'unified-workbench-ui', 'environment-readiness', 'browser-capabilities', 'cross-platform-preflight', 'git-diff', 'timeline', 'remote-files', 'remote-folder-transfer', 'stream-transfer', 'project-tasks', 'project-tests', 'project-debug', 'compile-database', 'project-health', 'markdown-code-links', 'workspace-backlinks', 'markdown-note-links', 'xmind-markdown-export', 'xmind-native', 'xmind-official-viewer', 'xmind-mind-elixir', 'xmind-simple-mind-map', 'xmind-advanced-layouts', 'xmind-node-reparent', 'opml-export', 'workspace-snapshots', 'live-web-search', 'search-history', 'editor-groups', 'monaco-editor', 'multi-cursor', 'editor-folding', 'editor-command-palette', 'editor-line-actions', 'editor-word-wrap', 'editor-wheel-zoom', 'editor-position', 'lsp-completion', 'lsp-signature-help', 'lsp-code-actions', 'lsp-rename', 'lsp-problems', 'drawio', 'drawio-xml', 'ai-drawio', 'full-text-search', 'quick-open', 'workspace-quick-open', 'workspace-recent', 'reading-full-text-search', 'pdf-text-cache', 'navigation-history', 'definition-peek', 'header-source-switch', 'lsp', 'pdf-library', 'pdf-translation', 'pdf-full-text-search', 'pdf-thumbnail-navigation', 'pdf-focus-mode', 'pdfjs-official-viewer', 'pdf-virtual-rendering', 'pdf-page-layouts', 'onlyoffice-pdf-editor', 'reading-fragments', 'reading-split-view', 'reading-projects', 'reading-code-notes', 'reading-folders', 'reading-project-metadata', 'reading-docx', 'docx-page-break-normalization', 'reading-spreadsheets', 'reading-presentations', 'reading-web-pages', 'reading-web-site-navigation', 'reading-web-session', 'reading-web-whole-page-zoom', 'reading-web-annotations', 'reading-web-location', 'office-library', 'office-folders', 'office-provider-api-v1', 'office-responsive-layout', 'onlyoffice-docs', 'onlyoffice-required', 'onlyoffice-connection-settings', 'onlyoffice-service-control', 'onlyoffice-jwt', 'onlyoffice-save-callback'] });
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
