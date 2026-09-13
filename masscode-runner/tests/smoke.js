#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-test-'));
const vault = path.join(tempRoot, 'vault');
let child;
let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

function xmindCloneForTest(value) { return JSON.parse(JSON.stringify(value)); }

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseUrl, output) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(baseUrl + '/api/rev');
      if (response.ok) return;
    } catch (_) {}
    if (child.exitCode !== null) throw new Error('服务提前退出：\n' + output.join(''));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('等待服务启动超时：\n' + output.join(''));
}

async function requestJson(baseUrl, pathname, expectedStatus = 200) {
  const response = await fetch(baseUrl + pathname);
  assert(response.status === expectedStatus, `${pathname} 状态码应为 ${expectedStatus}，实际为 ${response.status}`);
  return response.json();
}

function postChunkedJson(baseUrl, pathname, chunks) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(target, { method:'POST', headers:{'Content-Type':'application/json'} }, (res) => {
      const parts = [];
      res.on('data', (chunk) => parts.push(chunk));
      res.on('end', () => {
        try { resolve({ status:res.statusCode, data:JSON.parse(Buffer.concat(parts).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

async function postJson(baseUrl, pathname, body, expectedStatus = 200) {
  const response = await fetch(baseUrl + pathname, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.status === expectedStatus, `${pathname} 状态码应为 ${expectedStatus}，实际为 ${response.status}`);
  return response.json();
}

async function postStream(baseUrl, pathname, body, info, expectedStatus = 200) {
  const response = await fetch(baseUrl + pathname, { method:'POST', headers:{ 'content-type':'application/octet-stream', 'x-codescope-office':Buffer.from(JSON.stringify(info)).toString('base64') }, body });
  assert(response.status === expectedStatus, `${pathname} 状态码应为 ${expectedStatus}，实际为 ${response.status}`);
  return response.json();
}

function samplePdf(text) {
  const escaped = String(text).replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) pdf += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function main() {
  fs.mkdirSync(path.join(vault, 'code'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'drawings'), { recursive: true });
  const snippetFile = path.join(vault, 'code', 'timeline-demo.md');
  fs.writeFileSync(snippetFile, `---
contents:
  - id: 1
    label: 中文片段
    language: c
createdAt: 1
description: timeline test
folderId: null
id: 1
isDeleted: 0
isFavorites: 0
name: Timeline Demo
tags:
updatedAt: 1
---

## Fragment: 中文片段
\`\`\`c
int main(void) { return 0; }
\`\`\`
`);
  const cppHeaderFile = path.join(vault, 'code', 'cpp-header.md');
  fs.writeFileSync(cppHeaderFile, `---
contents:
  - id: 1
    label: Sort.cpp
    language: c_cpp
  - id: 2
    label: Sort.h
    language: c_cpp
name: C++ Header Demo
isDeleted: 0
tags:
---

## Fragment: Sort.cpp
\`\`\`c_cpp
#include "Sort.h"
\`\`\`

## Fragment: Sort.h
\`\`\`c_cpp
#pragma once
#include <vector>
using Array = std::vector<int>;
void bubbleSort(Array& values);
\`\`\`
`);
  fs.mkdirSync(path.join(tempRoot, 'sample'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'sample', 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.stdout.write(\'task-ok\')"', test: 'node -e "process.stdout.write(\'test-ok\')"' } }));
  fs.writeFileSync(path.join(tempRoot, 'compile_commands.json'), JSON.stringify([{
    directory: tempRoot, file: path.join(tempRoot, 'sample.c'), arguments: ['cc', '-I', 'include', '-DDEMO_FEATURE=1', '-c', 'sample.c'],
  }]));
  fs.writeFileSync(path.join(tempRoot, 'sample.c'), '#include "sample.h"\n// TODO: cover\nint sample(void) { return DEMO_FEATURE; }\n');
  fs.writeFileSync(path.join(tempRoot, 'sample.h'), 'int sample(void);\n');
  execFileSync('git', ['init', '-q', tempRoot]);
  execFileSync('git', ['-C', tempRoot, 'config', 'user.email', 'codescope-test@example.invalid']);
  execFileSync('git', ['-C', tempRoot, 'config', 'user.name', 'CodeScope Test']);
  execFileSync('git', ['-C', tempRoot, 'add', '.']);
  execFileSync('git', ['-C', tempRoot, 'commit', '-qm', 'test fixture']);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, CODESCOPE_HOST: '127.0.0.1', CODESCOPE_PORT: String(port), CODESCOPE_VAULT: vault, CODESCOPE_DATA_HOME: path.join(tempRoot, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));

  await waitForServer(baseUrl, output);

  const unicodeSnippets = await requestJson(baseUrl, '/api/snippets');
  const unicodeFragment = unicodeSnippets.snippets.find((item) => item.name === 'Timeline Demo').fragments[0];
  assert(unicodeFragment.label === '中文片段', '片段中文名称解析或重新读取后丢失');

  const version = await requestJson(baseUrl, '/api/version');
  assert(version.ok && version.name === '码境 CodeScope' && version.version === '1.2.0' && version.apiRevision >= 2 && version.features.includes('project-health') && version.features.includes('workspace-backlinks') && version.features.includes('markdown-note-links') && version.features.includes('xmind-markdown-export') && version.features.includes('xmind-native') && version.features.includes('xmind-official-viewer') && version.features.includes('xmind-simple-mind-map') && version.features.includes('xmind-advanced-layouts') && version.features.includes('xmind-node-reparent') && version.features.includes('opml-export') && version.features.includes('workspace-snapshots') && version.features.includes('live-web-search') && version.features.includes('search-history') && version.features.includes('editor-groups') && version.features.includes('monaco-editor') && version.features.includes('multi-cursor') && version.features.includes('editor-folding') && version.features.includes('editor-command-palette') && version.features.includes('editor-word-wrap') && version.features.includes('editor-wheel-zoom') && version.features.includes('editor-position') && version.features.includes('lsp-completion') && version.features.includes('lsp-rename') && version.features.includes('lsp-code-actions') && version.features.includes('project-tests') && version.features.includes('project-debug') && version.features.includes('drawio') && version.features.includes('drawio-xml') && version.features.includes('ai-drawio') && version.features.includes('full-text-search') && version.features.includes('quick-open') && version.features.includes('workspace-quick-open') && version.features.includes('workspace-recent') && version.features.includes('reading-full-text-search') && version.features.includes('pdf-text-cache') && version.features.includes('navigation-history') && version.features.includes('definition-peek') && version.features.includes('header-source-switch') && version.features.includes('lsp') && version.features.includes('pdf-library') && version.features.includes('pdf-translation') && version.features.includes('pdf-full-text-search') && version.features.includes('pdf-thumbnail-navigation') && version.features.includes('pdf-focus-mode') && version.features.includes('reading-fragments') && version.features.includes('reading-split-view') && version.features.includes('reading-projects') && version.features.includes('reading-code-notes') && version.features.includes('office-library') && version.features.includes('onlyoffice-docs') && version.features.includes('onlyoffice-save-callback') && version.features.includes('docx-preview') && version.features.includes('word-editing') && version.features.includes('word-autosave') && version.features.includes('spreadsheet-editing') && version.features.includes('pptx-preview'), '版本接口返回异常');

  const page = await fetch(baseUrl + '/');
  const html = await page.text();
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const launchers = ['start.command', '../启动码境.command', '../启动码境.sh', '../启动码境.bat']
    .map((file) => fs.readFileSync(path.resolve(projectRoot, file), 'utf8')).join('\n');
  assert(page.ok && html.includes('码境 CodeScope · 工程代码工作台'), '主页品牌标题不正确');
  assert(page.headers.get('etag') && page.headers.get('cache-control') === 'no-cache', '主页缺少协商缓存');
  const compressedPage = await fetch(baseUrl + '/', { headers:{ 'accept-encoding':'gzip' } });
  await compressedPage.arrayBuffer();
  assert(compressedPage.headers.get('content-encoding') === 'gzip', '主页未启用 gzip 压缩');
  const notModified = await fetch(baseUrl + '/', { headers:{ 'if-none-match':page.headers.get('etag') } });
  assert(notModified.status === 304, '主页 ETag 协商缓存无效');
  const headPage = await fetch(baseUrl + '/', { method:'HEAD' });
  assert(headPage.ok && Number(headPage.headers.get('content-length')) > 0 && (await headPage.text()) === '', '主页 HEAD 请求语义异常');
  assert(html.includes('href="https://github.com/ruanjianshi/massCode"'), 'GitHub 远程仓库入口缺失');
  assert(html.includes('id="theme-switcher"') && html.includes('data-app-theme="light"') && html.includes('codescope-theme'), '界面主题切换功能缺失');
  assert(html.includes('id="editor-find"') && html.includes('replaceEditorFindAll') && html.includes("e.key==='F3'"), '编辑器快捷键查找替换功能缺失');
 assert(html.includes('/monaco/vs/loader.js') && html.includes('id="monaco-main"') && html.includes('syncMonacoMain') && html.includes('multiCursorModifier'), 'Monaco / VS Code 同源编辑内核缺失');
  assert(html.includes('id="btn-wrap"') && html.includes('toggleEditorWordWrap') && html.includes("key==='z'") && html.includes('id="editor-position"'), '自动换行或光标行列状态缺失');
  assert(html.includes("localStorage.getItem('mc-editor-font-size')") && html.includes('applyEditorFontSize') && html.includes("event.addEventListener('wheel'") === false && html.includes("document.addEventListener('wheel'") && html.includes('EDITOR_FONT_MAX=28'), 'Ctrl/Command + 鼠标滚轮缩放编辑器功能缺失');
  assert(!html.includes('allow-popups allow-same-origin'), 'HTML 预览沙箱不应同时允许脚本与同源访问');
  assert(serverSource.includes("|| '127.0.0.1'") && serverSource.includes('trustedHttpOrigin') && serverSource.includes('fs.createReadStream') && serverSource.includes("'Content-Encoding': 'gzip'"), '默认本机监听、跨站写保护或流式静态资源优化缺失');
  assert(html.includes("localStorage.removeItem('mc-editor-groups')") && !html.includes("localStorage.setItem('mc-editor-groups'"), '临时编辑分栏不应在刷新后恢复');
  assert(html.includes("e.code === 'Space'") && html.includes('requestLspCompletion') && html.includes('requestSignatureHelp') && html.includes('EDITOR_SNIPPETS'), 'LSP 自动补全、参数提示或代码片段缺失');
  assert(html.includes('renameFocusedSymbol') && html.includes('requestCodeActions') && html.includes("e.key==='F2'") && html.includes("key==='.'"), '重命名或快速修复快捷键缺失');
  assert(html.includes('data-search-mode="command"') && html.includes('renderCommandResults') && html.includes("key==='p'") && html.includes("e.key==='F1'"), '命令面板缺失');
  assert(html.includes('handleCommonEditorShortcut') && html.includes("command==='move-up'") && html.includes("command==='duplicate-down'"), '常用行编辑快捷键缺失');
  assert(html.includes('id="sym-ai-submit"') && html.includes('submitAiSearch') && html.includes('data-search-mode="symbol"'), 'AI 搜索或原项目符号检索入口缺失');
  assert(html.includes('id="ai-search-provider"') && html.includes('id="ai-search-key"') && html.includes('/api/ai/web-search'), '实时联网搜索配置缺失');
  assert(html.includes('data-search-mode="history"') && html.includes('AI_SEARCH_HISTORY_KEY') && html.includes('renderAiSearchHistory') && html.includes('清空记录'), 'AI 搜索记录功能缺失');
  assert(html.includes('id="draw-nd-type"') && html.includes('id="drawio-root"') && html.includes('DRAWIO_ORIGIN') && html.includes('onDrawioMessage'), 'Draw.io 新建入口或嵌入编辑器缺失');
  assert(html.includes('value="xmind"') && html.includes('id="xmind-root"') && html.includes('renderXmindOutline') && html.includes('xmindMove'), 'XMind 新建入口、大纲编辑或拖拽功能缺失');
  assert(html.includes('id="xmind-theme-menu"') && html.includes('data-theme="spectrum"') && html.includes('setXmindTheme') && html.includes('xmindThemeStorageKey'), 'XMind 缺少多主题或主题持久化能力');
  assert(html.includes('class="codescope-xmind-toolbar"') && html.includes('id="xmind-more"') && !html.includes('class="xmind-toolbar"'), 'XMind 工具栏未隔离第三方样式或缺少低频操作收纳');
  assert(html.includes('function xmindPlainText') && html.includes('richText:false') && html.includes('topic.title=xmindPlainText'), 'XMind 节点标题未阻止富文本 HTML 污染');
  assert(html.includes('id="xmind-shortcuts"') && html.includes('xmindAddParent') && html.includes('xmindDeleteSingle') && html.includes('xmindReorder') && html.includes('xmindToggleFold'), 'XMind 缺少快捷键面板或高级主题操作');
  assert(html.includes("event.key==='Tab'") && html.includes("event.key==='Enter'") && html.includes("event.key==='ArrowUp'") && html.includes("key==='/'"), 'XMind 键盘新建、导航、重排或折叠快捷键缺失');
  assert(html.includes('xmindStartPreviewEdit') && html.includes('decorateXmindPreview') && html.includes('contentEditable=\'true\'') && html.includes('可单击选择、双击或空格编辑'), 'XMind 画布节点缺少直接选择或原位编辑能力');
  assert(html.includes('id="xmind-pan-mode"') && html.includes('id="xmind-zoom-value"') && html.includes('id="xmind-layout-select"') && html.includes('xmindSetToolMode') && html.includes('XMIND_CANVAS_PAN') && html.includes('xmindSetAllExpanded') && html.includes('xmindToggleEditorFocus'), 'XMind 缺少画布平移、缩放、布局、折叠或专注浏览能力');
  assert(html.includes('id="xmind-outline-resizer"') && html.includes('xmindSetOutlineWidth') && html.includes('mc-xmind-outline-width') && html.includes('xmind-tree-children'), 'XMind 大纲缺少清晰树线、可拖拽宽度或持久化');
  assert(html.includes('function xmindZoomAt') && html.includes('function xmindPanBy') && html.includes("mousewheelAction:'move'") && html.includes('xmindApplyViewport'), 'XMind 画布缺少指针缩放、横纵平移或独立视口控制');
  assert(html.includes('id="pane-office"') && html.includes('id="office-workspace"') && html.includes('renderOnlyOffice') && html.includes('/api/office/onlyoffice/config') && html.includes('ONLYOFFICE Docs') && html.includes('renderOfficeWord') && html.includes('saveOfficeWord') && html.includes('officeWordToolbar') && html.includes('contentEditable=\'true\'') && html.includes('renderOfficeSheetBook') && html.includes('renderOfficeSlides') && html.includes('/office-docx/docx-preview.min.js') && html.includes('/office-xlsx/dist/xlsx.full.min.js') && html.includes('/office-pptx/pptx-preview.umd.js'), 'Office 一级模块、ONLYOFFICE 完整编辑或本地降级能力缺失');
  assert(html.includes('id="xmind-add-floating"') && html.includes('id="xmind-to-floating"') && html.includes('children.detached') && html.includes('xmindRenderFloatingTopics') && html.includes('xmindAttachFloating') && html.includes('xmindAddFloatingAt(event.clientX,event.clientY)') && html.includes('function xmindEngineTopicId') && html.includes('findNodeByUid'), 'XMind 缺少标准自由主题、任意位置拖放、节点标识映射或层级互转能力');
  assert(html.includes('function xmindDefaultFloatingPosition') && html.includes('function xmindFloatingItems') && html.includes('function xmindDetachFloatingAt') && html.includes("badge.textContent=item.root?'自由导图'"), 'XMind 自由主题缺少子树自动布局、独立分支拆分或层级标识');
  assert(html.includes('rootPreview=XMIND_FLOAT_DRAG') && html.includes('origin=rootPreview||stored') && html.includes('const XMIND_SMM_LAYOUTS='), 'XMind 自由导图缺少位置隔离或新版结构引擎适配');
  assert(html.includes('id="xmind-view-native"') && html.includes('id="xmind-native-image"') && html.includes('setXmindView') && html.includes('XMind 原始画布'), 'XMind 缺少原貌快照与可编辑视图切换');
  assert(html.includes('id="xmind-view-official"') && html.includes('id="xmind-official-consent"') && html.includes('id="xmind-official-host"') && html.includes('openXmindOfficialView') && html.includes('/xmind-viewer/xmind-embed-viewer.js') && html.includes('www.xmind.cn'), 'XMind 缺少带隐私确认和隔离挂载容器的官方全画布查看器');
  assert(html.includes('id="xmind-engine"') && html.includes('/simple-mind-map/simpleMindMap.esm.min.js') && html.includes('/simple-mind-map/simpleMindMap.esm.min.css') && html.includes('new MindMap({') && html.includes('enableFreeDrag:true') && html.includes("XMIND_MAP.on('data_change'") && html.includes('xmindSyncFromEditor') && html.includes("addEventListener('dblclick'"), 'XMind 编辑模式未接入 simple-mind-map 原生编辑、自由拖拽或双向保存桥接');
  assert(html.includes("XMIND_OFFICIAL=new ViewerCtor({el:mount") && html.indexOf("XMIND_OFFICIAL.addEventListener('map-ready'") < html.indexOf('XMIND_OFFICIAL.load(file)') && html.includes("retry.onclick=openXmindOfficialView"), 'XMind 官方查看器未先注册事件再加载文件，或缺少失败重试');
  assert(html.includes('森林 · 圆角') && html.includes('海洋 · 通透蓝') && html.includes('石墨 · 专业灰') && html.includes('id="xmind-line-style"') && html.includes('id="xmind-node-shape"'), 'XMind 主题、节点形状或连线风格预设不足');
  assert(['organizationStructure','catalogOrganization','treeTable','timeline','verticalTimeline','fishbone','rightFishbone'].every(layout=>html.includes('value="'+layout+'"')), 'XMind 缺少组织结构、括号、树表、时间轴或鱼骨图布局');
  assert(html.includes("typeBadge.className = 'draw-type draw-type--' + kind") && html.includes("kind === 'xmind' ? 'XMind' : 'Excalidraw'"), '绘图列表缺少明确且隔离样式的类型标识');
  assert(html.includes('id="draw-ai-btn"') && html.includes('id="draw-xml-source"') && html.includes('generateDrawioWithAi') && html.includes('validateDrawioXmlLocal'), 'Draw.io AI 绘图或 XML 编辑器缺失');
  assert(html.includes('timeoutMs:300000') && html.includes('复杂图可能需要 1–5 分钟') && serverSource.includes('Math.min(600000') && serverSource.includes("e.name === 'TimeoutError'"), 'Draw.io AI 绘图长耗时请求或超时提示缺失');
  assert(html.includes('networkError:true') && html.includes('后端返回了无法解析的响应') && serverSource.includes("require('saxes')"), '全局 API 错误处理或服务端 XML 解析器缺失');
  assert((launchers.match(/node_modules[\\/]saxes/g) || []).length === 4, '启动脚本未完整检测新增运行依赖');
  assert((launchers.match(/node_modules[\\/]pdfjs-dist/g) || []).length === 4, '启动脚本未完整检测 PDF 文本解析依赖');
  assert((launchers.match(/node_modules[\\/]monaco-editor/g) || []).length === 4, '启动脚本未完整检测 Monaco 编辑器依赖');
  assert((launchers.match(/node_modules[\\/]fflate/g) || []).length === 4, '启动脚本未完整检测 XMind 压缩包依赖');
  assert((launchers.match(/node_modules[\\/]xmind-embed-viewer/g) || []).length === 4, '启动脚本未完整检测 XMind 官方查看器依赖');
  assert((launchers.match(/node_modules[\\/]simple-mind-map/g) || []).length === 4, '启动脚本未完整检测 simple-mind-map 编辑器依赖');
  assert((launchers.match(/node_modules[\\/]docx-preview/g) || []).length === 4 && (launchers.match(/node_modules[\\/]pptx-preview/g) || []).length === 4 && (launchers.match(/node_modules[\\/]xlsx/g) || []).length === 4, '启动脚本未完整检测 Office 本地组件依赖');
  assert(html.includes('id="editor-drop-overlay"') && html.includes('split-editor-group') && html.includes('initEditorGroups') && html.includes('application/x-codescope-editor'), '2 至 4 栏拖拽编辑功能缺失');
  assert(html.includes('data-search-mode="text"') && html.includes('renderTextResults') && html.includes('id="text-regex"'), '全文搜索或正则检索功能缺失');
  assert(html.includes('workspaceQuickEntries') && html.includes('WORKSPACE_RECENT_KEY') && html.includes('Office 文档') && html.includes('workspaceRecent'), '快速打开未覆盖代码、阅读、Office 与绘图，或缺少最近访问排序');
  assert(html.includes('id="btn-backlinks"') && html.includes('showBacklinks') && html.includes('workspaceLinkMarkdown') && html.includes('md-note-ref') && serverSource.includes('workspaceBacklinks'), '统一内部链接或反向链接功能缺失');
  assert(html.includes('id="mm-export-md"') && html.includes('id="mm-export-opml"') && html.includes('mmExportMarkdown') && html.includes('mmExportOpml'), '思维导图缺少 XMind Markdown 或 OPML 互通');
  assert(html.includes('WORKSPACE_SNAPSHOT_KEY') && html.includes('saveWorkspaceSnapshot') && html.includes('restoreWorkspaceSnapshot'), '显式工作台快照保存或恢复功能缺失');
  assert(html.includes('data-search-mode="file"') && html.includes('renderFileResults') && html.includes("key==='p'"), '快速打开文件功能缺失');
  assert(html.includes('id="btn-nav-back"') && html.includes('navigateHistory') && html.includes('NAV_BACK_STACK'), '代码位置导航历史功能缺失');
  assert(html.includes('id="definition-peek"') && html.includes('openDefinitionPeek') && html.includes('if(e.altKey)openDefinitionPeek'), '定义预览功能缺失');
  assert(html.includes('definitionModifier') && html.includes('goToFocusedDefinition') && html.includes('updateDefinitionHover') && html.includes('未找到 “'), 'VS Code 式跳转定义交互缺失');
  assert(html.includes('DEFINITION_HOVER_TIMER') && html.includes('editorTokenAtPoint') && html.includes('definition-hover-signature') && html.includes('},550)'), '函数与类型的延迟悬停定义卡片缺失');
  assert(html.includes('DEFINITION_HOVER_INTERACTING') && html.includes('scheduleDefinitionHoverHide') && html.includes('overscroll-behavior:contain') && html.includes('from+120'), '悬停定义卡片缺少鼠标移入、滚动或长定义查看能力');
  assert(html.includes('/api/lsp/query') && html.includes('enrichDefinitionHover') && serverSource.includes("require('./lib/lsp-service')"), '通用 LSP 服务或悬停信息接入缺失');
  assert(html.includes('id="btn-pair-switch"') && html.includes('pairedCodeFile') && html.includes("key==='o'"), '头文件与源文件快速切换功能缺失');
  assert(html.includes('#pane-git, #pane-tags, #pane-draw, #pane-office, #pane-reading { flex:0 1 auto; min-height:37px; }') && html.includes('#pane-tree { min-height:96px; }') && html.includes('#pane-draw, #pane-office, #pane-reading { min-height:108px; }'), '左侧多面板在低高度窗口中缺少自适应收缩');
  assert(html.includes('id="pane-reading"') && html.includes('id="reading-workspace"') && html.includes('application/x-codescope-reading') && html.includes('拖到阅读区右侧新建一栏'), 'PDF 阅读项目或拖拽片段组合入口缺失');
  assert(html.includes('translateReadingSelection') && html.includes('translateReadingPage') && html.includes('translateReadingAll') && html.includes('renderReadingFragments'), 'PDF AI 翻译或片段管理功能缺失');
  assert(html.includes('openReadingProject') && html.includes('addReadingProjectFragment') && html.includes('/api/readings/text-fragment') && html.includes('已匹配中文 PDF'), '阅读项目、多类型片段或中文版 PDF 自动配对功能缺失');
  assert(html.includes('<option value="source">可选文本</option>') && html.includes('requireSelectableReadingText') && html.includes('已切换到“可选文本”'), 'PDF 选段翻译或摘录缺少可读取文本模式');
  assert(html.includes('readingPdfVersions') && html.includes("versions.translation?'中文 PDF':'AI 中文译文'") && html.includes("versions.bilingual?'双语 PDF':'双语对照'") && html.includes('translatedDoc.pages'), 'PDF 视图切换未优先使用项目内已有中文或双语版本');
  assert(html.includes('id="reading-fragments-resizer"') && html.includes('mc-reading-fragments-width') && html.includes('finishFragmentResize'), '阅读片段面板缺少横向拖拽调整宽度能力');
  assert(html.includes('id="reading-project-tabs"') && html.includes('reading-project-tab') && html.includes('renderReadingProjectTabs') && html.includes('＋ 片段'), '阅读项目缺少代码式片段标签、新建入口或拖拽组合能力');
  assert(html.includes('id="reading-new-library-folder"') && html.includes('createReadingFolder') && html.includes('editReadingProjectMeta') && html.includes('reading-project-tag'), '阅读项目缺少文件夹、说明或标签管理能力');
  assert(!html.includes('id="reading-one"') && !html.includes('id="reading-two"') && html.includes('id="reading-new-column-drop"') && html.includes('updateReadingColumnLayout') && html.includes('closeReadingColumn'), '阅读工作区仍依赖固定单/双栏按钮或缺少拖拽自动分栏');
  assert(html.includes('id="reading-new-dialog"') && html.includes('submitReadingNewFragment') && html.includes('<option value="latex">LaTeX') && html.includes('<option value="python">Python'), '阅读项目缺少统一的 PDF、文档与代码片段新建窗口');
  assert(serverSource.includes("'/api/readings/node/move'") && html.includes('application/x-codescope-reading-node'), '阅读文件夹或项目缺少拖拽调整层级能力');
  assert(html.includes('openPdfFind') && html.includes('buildPdfFindIndex') && html.includes('pdf-find-current') && html.includes('全文查找（⌘/Ctrl + F）'), 'PDF 阅读器缺少全文检索、结果定位或高亮能力');
  assert(html.includes('bindPdfReaderKeys') && html.includes("e.key === 'PageDown'") && html.includes("e.key === 'PageUp'") && html.includes('pdf-reader-focus'), 'PDF 阅读器缺少翻页快捷键或专注阅读模式');
  assert(html.includes('mc-pdf-view:') && html.includes('savePdfViewState') && html.includes('pdf-page-pill'), 'PDF 阅读器缺少视图记忆或页码快速跳转');
  assert(html.includes('togglePdfThumbnails') && html.includes('renderPdfThumbnails') && html.includes('pdf-thumb-panel') && html.includes('ResizeObserver'), 'PDF 阅读器缺少页面缩略图导航或容器尺寸自适应');
  assert(html.includes('cleanPdfOutlineTitle') && html.includes('classifyPdfOutlineLine') && html.includes("source: 'auto-v2'") && html.includes("data.source === 'auto-v2' ? '智能识别'"), 'PDF 智能目录缺少分栏重建、标题清洗或层级分类能力');
  assert(html.includes('referencesReached') && html.includes('table\\s*(?:[.\\d]|[IVXLCDM]+\\b)'), 'PDF 智能目录缺少表格标题或参考文献正文过滤');
  assert(html.includes('saveToolbarSelection') && html.includes("cite.textContent = '引用笔记'") && html.includes('range.getClientRects()'), 'PDF 选区缺少逐行几何识别、快捷摘录或引用笔记能力');
  assert(html.includes('readingPdfRefMarkdown') && html.includes('appendReadingQuoteToNote') && html.includes('locateReadingMarkdownRef') && html.includes('reading-pdf-ref'), 'Markdown 阅读笔记缺少 Obsidian 风格 PDF 引用或原文回链定位');
  assert(html.includes('removeReadingLinkedPdfFragment') && html.includes('restoreReadingLinkedPdfFragment') && html.includes('syncRemovedReadingPdfRefs') && html.includes('readingPdfRefsInMarkdown') && html.includes('引用、PDF 摘录与页内标记已同步删除'), 'Markdown 按钮或直接编辑删除引用时，未与 PDF 摘录及页内标记保持事务同步');
  assert(html.includes('normalizePdfSelectionText') && html.includes('mergePdfSelectionRects') && !html.includes("replace(/scaleX\\([^)]*\\)/g, 'scaleX(1)')"), 'PDF 文本选择缺少精确文本拼接、逐行矩形合并或仍破坏 PDF.js 字形缩放');
  assert(html.includes('READING_SLASH_COMMANDS') && html.includes('applyReadingSlashCommand') && html.includes('readingSlashKeydown') && html.includes("id:'bullet'") && html.includes("id:'number'") && html.includes("id:'h1'"), 'Markdown 阅读笔记缺少斜杠命令或标题、列表块转换');
  assert(html.includes('callout-remove') && html.includes('引用已从 Markdown 笔记中移除') && html.includes("const ordered=tag==='ol'"), 'Markdown 引用缺少移除入口或有序列表持久化');
  assert(html.includes('reading-md-source') && html.includes('reading-md-live') && html.includes("['edit','live','preview']") && html.includes('loadReadingMarkdownMode') && html.includes('Markdown 阅读视图'), 'Markdown 阅读笔记缺少源码编辑、同屏实时预览、阅读模式或模式记忆');
  assert(html.includes('--md-measure:840px') && html.includes('--md-surface-hover') && html.includes('text-rendering:optimizeLegibility') && html.includes('@container (max-width:460px)') && html.includes('reading-md-property-tag') && html.includes('mdPropertyValue') && html.includes('reading-md-generated-title') && html.includes('orderedBlocks'), 'Markdown 阅读视图缺少主题化可读行宽、窄栏响应式属性标签或实时编辑回写兼容');
  assert(html.includes("blockquote.md-callout.warning") && html.includes('tbody tr:nth-child(even)') && html.includes("content:'●  ●  ●'") && html.includes('li > ul,.reading-md-editor li > ol'), 'Markdown 主题缺少提示块语义色、表格层次、代码块标题栏或嵌套列表引导线');
  assert(html.includes('readingLiveCaret') && html.includes('restoreReadingLiveCaret') && html.includes('readingLiveCanRender') && html.includes('readingLiveEnter') && html.includes("live.contentEditable='true'"), 'Markdown 实时预览缺少同位置渲染、光标恢复、块级换行或富文本编辑能力');
  assert(html.includes('setupReadingLiveBlocks') && html.includes('reading-block-tools') && !html.includes('reading-block-tail-add') && html.includes('readingBlockFirstLineRect') && html.includes("block.tagName==='LI'?30:14") && html.includes('padding-left:max(68px') && html.includes('transformReadingLiveBlock') && html.includes('reading-block-drop-marker') && html.includes('scheduleHide') && html.includes('moveReadingLiveBlock') && html.includes('readingOrderedBlocks'), 'Markdown 实时预览缺少贴合首行的区块控制、窄栏操作槽、列表避让或拖拽排序能力');
  assert(html.includes('MARKDOWN_LIVE_HISTORIES') && html.includes('recordMarkdownLiveHistory') && html.includes('stepMarkdownLiveHistory') && html.includes('markdownHistoryShortcut') && html.includes("event.inputType!=='historyUndo'") && html.includes("'reading:'+path") && html.includes("'project:'+markdownCaretKey"), 'Markdown 实时编辑缺少跨 DOM 重绘的撤销/重做历史或 beforeinput 兼容处理');
  assert(html.includes("handle.addEventListener('pointerdown'") && html.includes("handle.addEventListener('pointermove'") && html.includes('document.elementFromPoint') && html.includes('requestAnimationFrame(autoScroll)') && html.includes("e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')"), 'Markdown 区块拖拽缺少指针手势、边缘自动滚动、精确落点或键盘移动能力');
  assert(html.includes("const item=node.closest&&node.closest('li')") && html.includes('readingMergeAdjacentLists') && html.includes("source.tagName==='LI'") && html.includes("target.tagName==='LI'"), 'Markdown 列表项未作为独立区块，或缺少跨列表与正文重排能力');
  assert(html.includes('.reading-md-live > ul > li:hover') && html.includes('.reading-md-live > ol > li:hover'), 'Markdown 列表项拖拽缺少独立悬停命中反馈');
  assert(html.includes("document.addEventListener('pointerdown'") && html.includes("document.addEventListener('scroll'") && html.includes("window.addEventListener('resize',hideReadingSlashMenu)") && html.includes("READING_SLASH_STATE.slot===slot") && html.includes("READING_SLASH_STATE.editor===live"), 'Markdown 区块转换菜单缺少点击外部、滚动、切换内容或失焦收起行为');
  assert(html.includes('reading-md-properties') && html.includes('笔记属性') && html.includes("data-md-source") && html.includes('font-size:2.08rem') && html.includes('grid-template-columns:minmax(125px,160px)'), 'Markdown 渲染缺少 Obsidian 风格属性面板或响应式阅读排版层级');
  assert(html.includes('readingSourceSlashContext') && html.includes("snippet:'> [!note] 笔记\\n> '") && html.includes("e.key==='Tab'") && html.includes("e.key.toLowerCase()==='s'"), 'Markdown 源码编辑器缺少斜杠命令、Tab 缩进或快捷保存');
  assert(html.includes('md-code-block') && html.includes('li class="md-task"') && html.includes('~~([^~]+)~~') && html.includes('data-md-start'), 'Markdown 渲染缺少代码围栏、任务列表、删除线或引用块定位');
  assert(html.includes('id="document-mode-tools"') && html.includes("['source','split','live','preview']") && html.includes('documentModeKey') && html.includes('wireProjectMarkdownLive') && html.includes('edit-preview-close'), '普通 Markdown 缺少源码、分栏、实时、阅读模式或可关闭预览');
  assert(html.includes("classList.toggle('markdown-code'") && html.includes('#code-wrap.markdown-code #code .hljs-section') && !html.includes("f.language === 'markdown') return") && html.includes("$('code-edit').classList.add('live-hl')"), 'Markdown 源码编辑缺少兼容编辑器语法高亮、行号或主题样式');
  assert(html.includes('#md-view.project-md-full') && html.includes("classList.toggle('project-md-full'") && html.includes('width:min(100%,1120px)'), 'Markdown 实时或阅读模式仍受旧的半宽 max-width 布局限制');
  assert(html.includes('codeReferenceMarkdown') && html.includes('currentCodeReferenceSelection') && html.includes('chooseCodeReferenceTarget') && html.includes('id="code-ref-add"') && !html.includes('id="btn-code-reference"') && html.includes('md-code-ref') && html.includes('data-code-line') && html.includes('goToLocation({snippet,frag:'), '代码选区引用、Markdown 目标选择、行号定位或回跳能力缺失');
  assert(html.includes('fragmentDisplayName') && html.includes('return label||filename||fallback') && html.includes("primaryName.textContent=primaryLabel") && !html.includes("function splitName(ref) { return (ref.frag.filename||ref.frag.label"), '编辑栏标题、面包屑或引用目标仍错误地优先显示底层文件名');
  assert(html.includes("fragment.language==='html'?['source','split','preview']") && html.includes('HTML 预览') && html.includes("setDocumentMode('source')"), 'HTML 缺少源码、分栏、全宽预览或关闭入口');
  assert(html.includes('html[data-theme] .split-editor-input') && html.includes("classList.toggle('plain',!exact)"), '多栏编辑器高亮层遮挡修复或纯文本降级缺失');
  assert(html.includes('withActiveSplitContext') && html.includes('activateSplitReading') && html.includes('activateOpenSplitLocation'), '右侧阅读面板未跟随多栏编辑器焦点');
  assert(html.includes('if(multi)applySplitRatios()') && /applyMdView\(\);\s*if\(multi\)applySplitRatios/.test(html), '多栏退出后 Markdown/LaTeX 预览恢复逻辑缺失');
  assert(html.includes('rel-link-halo') && html.includes('node-icon') && html.includes('rel-map-summary') && html.includes('no-upstream') && html.includes('wireSide') && html.includes('markerUnits="userSpaceOnUse"') && html.includes('M.65,.55 L4.6,2.5 L.65,4.45 Z') && html.includes('fill="var(--ok)"') && html.includes(" C'+"), '关系图自适应拓扑、视觉层级或小型实心箭头优化缺失');
  assert(html.includes('id="remote-resizer-y"') && html.includes('id="remote-folder-upload"') && html.includes('id="remote-folder-download"'), '远程窗口高度拖拽或文件夹传输入口缺失');

  const icon = await fetch(baseUrl + '/assets/codescope.svg');
  assert(icon.ok && (icon.headers.get('content-type') || '').includes('image/svg+xml'), '品牌图标无法加载');
  const monacoLoader = await fetch(baseUrl + '/monaco/vs/loader.js');
  assert(monacoLoader.ok && (monacoLoader.headers.get('content-type') || '').includes('javascript'), 'Monaco 编辑器资源无法加载');
  const simpleMindMap = await fetch(baseUrl + '/simple-mind-map/simpleMindMap.esm.min.js');
  assert(simpleMindMap.ok && (simpleMindMap.headers.get('content-type') || '').includes('javascript') && (await simpleMindMap.text()).includes('simpleMindMap'), 'simple-mind-map 编辑器资源无法加载');
  for (const [asset, marker] of [['/office-jszip/jszip.min.js','JSZip'],['/office-docx/docx-preview.min.js','renderAsync'],['/office-xlsx/dist/xlsx.full.min.js','XLSX'],['/office-pptx/pptx-preview.umd.js','pptxPreview']]) {
    const response = await fetch(baseUrl + asset), source = await response.text();
    assert(response.ok && (response.headers.get('content-type') || '').includes('javascript') && source.includes(marker), 'Office 本地组件无法加载：' + asset);
  }
  const crossSite = await fetch(baseUrl + '/api/readings/folder', { method:'POST', headers:{'content-type':'application/json',origin:'https://evil.example','sec-fetch-site':'cross-site'}, body:'{"name":"Blocked"}' });
  assert(crossSite.status === 403, '跨站写入请求未被阻止');

  const officeFolder = await postJson(baseUrl, '/api/office/folder', { parent:'', name:'项目资料' });
  assert(officeFolder.ok && officeFolder.path === '项目资料', 'Office 文件夹创建失败');
  const officeWord = await postJson(baseUrl, '/api/office/new', { folder:'项目资料', name:'设计说明', kind:'word' });
  const officeSheet = await postJson(baseUrl, '/api/office/new', { folder:'', name:'测试数据', kind:'sheet' });
  const officeSlides = await postJson(baseUrl, '/api/office/new', { folder:'', name:'项目汇报', kind:'slides' });
  assert(officeWord.ok && officeWord.path.endsWith('.docx') && officeSheet.ok && officeSheet.path.endsWith('.xlsx') && officeSlides.ok && officeSlides.path.endsWith('.pptx'), 'Office 标准文档创建失败');
  const officeTree = await requestJson(baseUrl, '/api/office/tree');
  assert(officeTree.ok && officeTree.total === 3 && officeTree.root.children.some((item) => item.name === '项目资料' && item.count === 1), 'Office 文档树或数量统计错误');
  const wordResponse = await fetch(baseUrl + '/api/office/file?path=' + encodeURIComponent(officeWord.path));
  const wordBytes = Buffer.from(await wordResponse.arrayBuffer());
  assert(wordResponse.ok && wordResponse.headers.get('content-type').includes('wordprocessingml') && wordBytes.subarray(0,2).toString() === 'PK', 'DOCX 原文件读取或 MIME 类型错误');
  const deniedOnlyOfficeFile = await requestJson(baseUrl, '/api/office/onlyoffice-file?path=' + encodeURIComponent(officeWord.path) + '&token=invalid', 403);
  const deniedOnlyOfficeCallback = await postJson(baseUrl, '/api/office/onlyoffice-callback?path=' + encodeURIComponent(officeWord.path) + '&token=invalid', { status:2 }, 403);
  assert(!deniedOnlyOfficeFile.ok && deniedOnlyOfficeCallback.error === 1, 'ONLYOFFICE 文档或回调接口未拒绝无效令牌');
  const wordHtml = await requestJson(baseUrl, '/api/office/word-html?path=' + encodeURIComponent(officeWord.path));
  assert(wordHtml.ok && wordHtml.html.includes('设计说明'), 'DOCX 转换为可编辑内容失败');
  const savedWord = await postJson(baseUrl, '/api/office/word-save', { path:officeWord.path, html:'<h1>架构设计</h1><p>可编辑 Word 正文 <strong>已保存</strong></p><table><tbody><tr><td>模块</td><td>状态</td></tr></tbody></table>' });
  const editedWordHtml = await requestJson(baseUrl, '/api/office/word-html?path=' + encodeURIComponent(officeWord.path));
  assert(savedWord.ok && editedWordHtml.ok && editedWordHtml.html.includes('可编辑 Word 正文') && editedWordHtml.html.includes('<table>'), 'Word 编辑内容未持久化为 DOCX');
  const sheetResponse = await fetch(baseUrl + '/api/office/file?path=' + encodeURIComponent(officeSheet.path));
  const sheetBytes = Buffer.from(await sheetResponse.arrayBuffer());
  const savedSheet = await postStream(baseUrl, '/api/office/save-stream', sheetBytes, { path:officeSheet.path });
  assert(savedSheet.ok && savedSheet.size === sheetBytes.length, 'Excel 流式保存失败');
  const renamedWord = await postJson(baseUrl, '/api/office/rename', { path:officeWord.path, name:'架构说明' });
  assert(renamedWord.ok && renamedWord.path === '项目资料/架构说明.docx', 'Office 文档重命名失败或扩展名丢失');
  const movedSlides = await postJson(baseUrl, '/api/office/move', { path:officeSlides.path, toFolder:'项目资料' });
  assert(movedSlides.ok && movedSlides.path === '项目资料/项目汇报.pptx', 'Office 文档拖拽移动后端失败');
  const importedWord = await postStream(baseUrl, '/api/office/upload-stream', wordBytes, { folder:'', name:'导入文档.docx' });
  assert(importedWord.ok && importedWord.path === '导入文档.docx', 'Office 流式导入失败');
  const invalidOffice = await requestJson(baseUrl, '/api/office/file?path=' + encodeURIComponent('../escape.docx'), 400);
  assert(!invalidOffice.ok, 'Office 文件接口未拒绝越界路径');
  assert((await postJson(baseUrl, '/api/office/delete', { path:'项目资料' })).ok, 'Office 文件夹递归删除失败');
  assert((await postJson(baseUrl, '/api/office/delete', { path:officeSheet.path })).ok && (await postJson(baseUrl, '/api/office/delete', { path:importedWord.path })).ok, 'Office 测试文档清理失败');

  const snippets = await requestJson(baseUrl, '/api/snippets');
  assert(snippets.vault === vault && snippets.snippets.length === 2, '片段接口返回异常');

  const readingFolder = await postJson(baseUrl, '/api/readings/folder', { name:'Research', parent:'' });
  assert(readingFolder.ok && readingFolder.path === 'Research', '阅读文库文件夹创建失败');
  const readingProject = await postJson(baseUrl, '/api/readings/project/new', { name:'Papers', parent:'Research', description:'机器人论文资料', tags:'机器人，强化学习' });
  assert(readingProject.ok && readingProject.path === 'Research/Papers' && readingProject.meta.tags.length === 2, '嵌套阅读项目、说明或标签创建失败');
  const updatedProjectMeta = await postJson(baseUrl, '/api/readings/project/meta', { project:'Research/Papers', description:'机器人与控制论文', tags:['机器人','控制'] });
  assert(updatedProjectMeta.ok && updatedProjectMeta.meta.description === '机器人与控制论文' && updatedProjectMeta.meta.tags.includes('控制'), '阅读项目说明或标签更新失败');
  const archiveFolder = await postJson(baseUrl, '/api/readings/folder', { name:'Archive', parent:'' });
  const movedProject = await postJson(baseUrl, '/api/readings/node/move', { type:'project', path:'Research/Papers', toFolder:'Archive' });
  const restoredProject = await postJson(baseUrl, '/api/readings/node/move', { type:'project', path:'Archive/Papers', toFolder:'Research' });
  const deletedArchive = await postJson(baseUrl, '/api/readings/folder/delete', { folder:'Archive' });
  assert(archiveFolder.ok && movedProject.ok && movedProject.path === 'Archive/Papers' && restoredProject.ok && restoredProject.path === 'Research/Papers' && deletedArchive.ok, '阅读项目拖拽调整文件夹层级失败');
  const nestedReadingFolder = await postJson(baseUrl, '/api/readings/folder', { name:'归档', parent:'Research' });
  const renamedReadingFolder = await postJson(baseUrl, '/api/readings/folder/rename', { folder:nestedReadingFolder.path, name:'已读' });
  const deletedReadingFolder = await postJson(baseUrl, '/api/readings/folder/delete', { folder:renamedReadingFolder.path });
  assert(nestedReadingFolder.ok && renamedReadingFolder.ok && renamedReadingFolder.path === 'Research/已读' && deletedReadingFolder.ok, '嵌套阅读文件夹创建、重命名或删除失败');
  const readingInfo = Buffer.from(JSON.stringify({ name:'paper.pdf', folder:'Research/Papers' })).toString('base64');
  const readingUploadResponse = await fetch(baseUrl + '/api/readings/upload-stream', { method:'POST', headers:{'Content-Type':'application/pdf','X-CodeScope-Reading':readingInfo}, body:samplePdf('Hello research paper') });
  const readingUpload = await readingUploadResponse.json();
  assert(readingUploadResponse.ok && readingUpload.ok && readingUpload.path === 'Research/Papers/paper.pdf', 'PDF 流式导入失败');
  const chineseInfo = Buffer.from(JSON.stringify({ name:'paper_中文.pdf', folder:'Research/Papers' })).toString('base64');
  const chineseResponse = await fetch(baseUrl + '/api/readings/upload-stream', { method:'POST', headers:{'Content-Type':'application/pdf','X-CodeScope-Reading':chineseInfo}, body:samplePdf('Chinese paper') });
  const chineseUpload = await chineseResponse.json();
  assert(chineseResponse.ok && chineseUpload.ok, '中文版 PDF 导入失败');
  const note = await postJson(baseUrl, '/api/readings/text/new', { project:'Research/Papers', name:'阅读笔记.md' });
  assert(note.ok && note.kind === 'markdown', '阅读项目 Markdown 片段创建失败');
  const savedNote = await postJson(baseUrl, '/api/readings/text-fragment', { path:note.path, content:'# 结论\n\n测试笔记\n\n[[pdf-ref:'+encodeURIComponent(readingUpload.path)+'#page=1&fragment=f1|定位原文]]' });
  const openedNote = await requestJson(baseUrl, '/api/readings/text-fragment?path=' + encodeURIComponent(note.path));
  assert(savedNote.ok && openedNote.ok && /测试笔记/.test(openedNote.content), '阅读项目文本片段读写失败');
  const readingTree = await requestJson(baseUrl, '/api/readings/tree');
  const researchFolder = readingTree.root.children.find((item) => item.path === 'Research');
  const paperProject = researchFolder && researchFolder.children.find((item) => item.path === 'Research/Papers');
  assert(readingTree.ok && readingTree.total === 3 && researchFolder && researchFolder.type === 'folder' && paperProject && paperProject.count === 3 && paperProject.description === '机器人与控制论文' && paperProject.tags.includes('控制') && paperProject.children.every((item) => item.project === 'Research/Papers') && paperProject.children.some((item) => item.role === 'original') && paperProject.children.some((item) => item.role === 'translation') && paperProject.children.some((item) => item.kind === 'markdown'), '阅读文件夹、项目元数据或多类型片段聚合异常');
  const readingText = await requestJson(baseUrl, '/api/readings/text?path=' + encodeURIComponent(readingUpload.path));
  assert(readingText.ok && readingText.pageCount === 1 && /Hello research paper/.test(readingText.pages[0]), 'PDF 页级文本提取失败');
  const readingMeta = await postJson(baseUrl, '/api/readings/meta', { path:readingUpload.path, meta:{ page:1, view:'bilingual', translations:{1:'你好，研究论文'}, fragments:[{id:'f1',page:1,source:'research paper',translation:'研究论文',note:'术语'}] } });
  assert(readingMeta.ok && readingMeta.meta.view === 'bilingual' && readingMeta.meta.fragments.length === 1, 'PDF 译文或片段记录保存失败');
  const readingSearch = await requestJson(baseUrl, '/api/readings/search?q=' + encodeURIComponent('测试笔记'));
  const pdfFragmentSearch = await requestJson(baseUrl, '/api/readings/search?q=' + encodeURIComponent('research paper'));
  assert(readingSearch.ok && readingSearch.hits.some((item) => item.path === note.path && item.kind === 'text'), '阅读全文搜索未找到 Markdown 笔记');
  assert(pdfFragmentSearch.ok && pdfFragmentSearch.hits.some((item) => item.path === readingUpload.path && item.kind === 'pdf' && item.page === 1), '阅读全文搜索未找到 PDF 摘录');
  const pdfBacklinks = await requestJson(baseUrl, '/api/workspace/backlinks?kind=pdf&path=' + encodeURIComponent(readingUpload.path));
  assert(pdfBacklinks.ok && pdfBacklinks.hits.some((item) => item.sourceKind === 'reading-note' && item.path === note.path && item.line === 5), 'PDF 到 Markdown 的反向链接索引失败');
  const readingRange = await fetch(baseUrl + '/api/readings/file?path=' + encodeURIComponent(readingUpload.path), { headers:{Range:'bytes=0-4'} });
  assert(readingRange.status === 206 && await readingRange.text() === '%PDF-', 'PDF Range 分段读取失败');
  const readingRename = await postJson(baseUrl, '/api/readings/rename', { path:readingUpload.path, name:'renamed.pdf' });
  assert(readingRename.ok && readingRename.path === 'Research/Papers/renamed.pdf', 'PDF 重命名失败');
  const readingMetaAfterRename = await requestJson(baseUrl, '/api/readings/meta?path=' + encodeURIComponent(readingRename.path));
  assert(readingMetaAfterRename.ok && readingMetaAfterRename.meta.translations['1'] === '你好，研究论文', 'PDF 重命名后译文记录丢失');

  const newDrawio = await postJson(baseUrl, '/api/drawings/new', { name: 'Smoke Drawio', dir: '', kind: 'drawio' });
  assert(newDrawio.ok && newDrawio.kind === 'drawio' && newDrawio.name.endsWith('.drawio') && newDrawio.xml.includes('<mxfile'), 'Draw.io 文件创建失败');
  const openedDrawio = await requestJson(baseUrl, '/api/drawings/get?name=' + encodeURIComponent(newDrawio.name));
  assert(openedDrawio.ok && openedDrawio.kind === 'drawio' && openedDrawio.xml.includes('<mxGraphModel'), 'Draw.io 文件读取失败');
  const changedDrawioXml = '<mxfile host="CodeScope"><diagram id="smoke" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="smoke" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>';
  const validatedDrawio = await postJson(baseUrl, '/api/drawings/validate', { xml: changedDrawioXml });
  assert(validatedDrawio.ok && validatedDrawio.format === 'uncompressed' && validatedDrawio.cells === 3, 'Draw.io XML 结构校验失败');
  const invalidReferenceDrawio = await postJson(baseUrl, '/api/drawings/validate', { xml:'<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" edge="1" parent="1" source="missing"/></root></mxGraphModel>' });
  assert(!invalidReferenceDrawio.ok && /不存在/.test(invalidReferenceDrawio.error), 'Draw.io XML 校验未识别失效引用');
  const savedDrawio = await postJson(baseUrl, '/api/drawings/save', { name: newDrawio.name, data: { xml: changedDrawioXml } });
  assert(savedDrawio.ok && savedDrawio.bytes === changedDrawioXml.length, 'Draw.io XML 保存失败');
  const reopenedDrawio = await requestJson(baseUrl, '/api/drawings/get?name=' + encodeURIComponent(newDrawio.name));
  assert(reopenedDrawio.ok && reopenedDrawio.xml === changedDrawioXml, 'Draw.io XML 保存后读取不一致');
  const drawingTree = await requestJson(baseUrl, '/api/drawings/tree');
  assert(drawingTree.ok && drawingTree.total === 1 && drawingTree.root.children.some((item) => item.path === newDrawio.name), '绘图树未包含 Draw.io 文件');
  const newXmind = await postJson(baseUrl, '/api/drawings/new', { name:'设计导图', dir:'', kind:'xmind' });
  assert(newXmind.ok && newXmind.kind === 'xmind' && newXmind.name.endsWith('.xmind') && newXmind.workbook[0].rootTopic.title === '设计导图', 'XMind 文件创建失败');
  const xmindFile = path.join(vault, 'drawings', newXmind.name);
  assert(fs.readFileSync(xmindFile).subarray(0, 2).toString('hex') === '504b', 'XMind 未写入标准 ZIP 容器');
  const xmindEntries = unzipSync(new Uint8Array(fs.readFileSync(xmindFile)));
  xmindEntries['resources/smoke.txt'] = strToU8('preserve me');
  xmindEntries['Thumbnails/thumbnail.png'] = Uint8Array.from([137,80,78,71,13,10,26,10]);
  fs.writeFileSync(xmindFile, Buffer.from(zipSync(xmindEntries)));
  const xmindWorkbook = xmindCloneForTest(newXmind.workbook);
  xmindWorkbook[0].rootTopic.children.attached.push({ id:'smoke-child', class:'topic', title:'子主题', children:{ attached:[] } });
  const savedXmind = await postJson(baseUrl, '/api/drawings/save', { name:newXmind.name, data:{ workbook:xmindWorkbook } });
  assert(savedXmind.ok && savedXmind.nodes === 2, 'XMind 编辑结果保存失败');
  const reopenedXmind = await requestJson(baseUrl, '/api/drawings/get?name=' + encodeURIComponent(newXmind.name));
  assert(reopenedXmind.ok && reopenedXmind.kind === 'xmind' && reopenedXmind.workbook[0].rootTopic.children.attached[0].title === '子主题' && reopenedXmind.hasThumbnail && reopenedXmind.thumbnail.startsWith('data:image/png;base64,'), 'XMind 保存后读取或原貌快照恢复不一致');
  const rawXmind = await fetch(baseUrl + '/api/drawings/file?name=' + encodeURIComponent(newXmind.name));
  const rawXmindBytes = Buffer.from(await rawXmind.arrayBuffer());
  assert(rawXmind.ok && rawXmind.headers.get('content-type') === 'application/vnd.xmind.workbook' && rawXmindBytes.subarray(0,2).toString('hex') === '504b', 'XMind 官方查看器原文件接口异常');
  const preservedXmind = unzipSync(new Uint8Array(fs.readFileSync(xmindFile)));
  assert(strFromU8(preservedXmind['resources/smoke.txt']) === 'preserve me', 'XMind 保存时丢失原有附件资源');
  const badXmind = await postJson(baseUrl, '/api/drawings/save', { name:newXmind.name, data:{ workbook:[] } });
  assert(!badXmind.ok && /XMind/.test(badXmind.error), 'XMind 保存接口未拒绝无效工作簿');
  const badDrawio = await postJson(baseUrl, '/api/drawings/save', { name: newDrawio.name, data: { xml: '<invalid/>' } });
  assert(!badDrawio.ok, 'Draw.io 保存接口未拒绝无效 XML');
  const malformedDrawio = await postJson(baseUrl, '/api/drawings/validate', { xml:'<mxfile><diagram><mxGraphModel></diagram></mxfile>' });
  assert(!malformedDrawio.ok && /语法错误/.test(malformedDrawio.error), 'Draw.io XML 校验未拒绝标签结构损坏的文档');
  const nestedRootDrawio = await postJson(baseUrl, '/api/drawings/validate', { xml:'<wrapper><mxfile><diagram/></mxfile></wrapper>' });
  assert(!nestedRootDrawio.ok && /根节点/.test(nestedRootDrawio.error), 'Draw.io XML 校验未拒绝错误根节点');
  const deletedDrawio = await postJson(baseUrl, '/api/drawings/delete', { name: newDrawio.name });
  assert(deletedDrawio.ok, 'Draw.io 文件删除失败');
  const deletedXmind = await postJson(baseUrl, '/api/drawings/delete', { name:newXmind.name });
  assert(deletedXmind.ok, 'XMind 文件删除失败');

  const changedCode = 'int main(void) { return 1; }';
  const saved = await postJson(baseUrl, '/api/save', { file: snippetFile, fragment: 0, code: changedCode });
  assert(saved.ok, '自动保存接口失败');
  const timeline = await requestJson(baseUrl, '/api/timeline?file=' + encodeURIComponent(snippetFile) + '&fragment=0');
  assert(timeline.ok && timeline.entries.length === 1, '本地时间线未记录覆盖前版本');
  const timelineItem = await requestJson(baseUrl, '/api/timeline/item?file=' + encodeURIComponent(snippetFile) + '&fragment=0&id=' + encodeURIComponent(timeline.entries[0].id));
  assert(timelineItem.ok && timelineItem.diff.includes('return 0') && timelineItem.diff.includes('return 1'), '时间线差异内容不正确');
  const unchanged = await postJson(baseUrl, '/api/save', { file: snippetFile, fragment: 0, code: changedCode });
  assert(unchanged.ok && unchanged.unchanged, '相同内容保存不应重复写入时间线');
  const changedAgain = 'int main(void) { /* one edit session */ return 2; }';
  const savedAgain = await postJson(baseUrl, '/api/save', { file: snippetFile, fragment: 0, code: changedAgain });
  assert(savedAgain.ok, '连续自动保存失败');
  const compactTimeline = await requestJson(baseUrl, '/api/timeline?file=' + encodeURIComponent(snippetFile) + '&fragment=0');
  assert(compactTimeline.entries.length === 1 && compactTimeline.entries[0].id === timeline.entries[0].id, '一次连续编辑被错误拆成多个时间线版本');
  const compactItem = await requestJson(baseUrl, '/api/timeline/item?file=' + encodeURIComponent(snippetFile) + '&fragment=0&id=' + encodeURIComponent(compactTimeline.entries[0].id));
  assert(compactItem.diff.includes('return 0') && compactItem.diff.includes('return 2'), '合并后的时间线没有保留编辑会话起点');

  const git = await requestJson(baseUrl, '/api/git');
  const changedPath = path.relative(tempRoot, snippetFile).split(path.sep).join('/');
  assert(git.ok && git.changes.some((item) => item.path === changedPath), 'Git 状态未识别保存后的文件变化');
  const diff = await requestJson(baseUrl, '/api/git/diff?path=' + encodeURIComponent(changedPath));
  assert(diff.ok && diff.additions === 1 && diff.deletions === 1 && diff.diff.includes('return 2'), 'Git Diff 内容不正确');

  const restored = await postJson(baseUrl, '/api/timeline/restore', { file: snippetFile, fragment: 0, id: timeline.entries[0].id });
  assert(restored.ok && restored.code.includes('return 0'), '时间线恢复失败');
  const protectedTimeline = await requestJson(baseUrl, '/api/timeline?file=' + encodeURIComponent(snippetFile) + '&fragment=0');
  assert(protectedTimeline.entries.length === 2, '恢复前未创建保护检查点');
  const invalidDiff = await requestJson(baseUrl, '/api/git/diff?path=' + encodeURIComponent('../escape.txt'), 400);
  assert(invalidDiff.ok === false, 'Git Diff 未拒绝越界路径');

  const status = await requestJson(baseUrl, '/api/system/status');
  assert(status.ok && status.cpu && status.memory && status.disk, '系统状态接口返回异常');

  const remote = await requestJson(baseUrl, '/api/remote/status');
  assert(remote.ok && remote.ssh && remote.ssh.files && remote.vnc && remote.terminal, '远程开发状态接口返回异常');

  const tasks = await requestJson(baseUrl, '/api/project/tasks');
  const checkTask = tasks.tasks.find((item) => item.name.startsWith('npm · check'));
  assert(tasks.ok && checkTask && checkTask.cwd === 'sample', '未发现子目录 npm 构建任务');
  const taskResult = await postJson(baseUrl, '/api/project/tasks/run', { id: checkTask.id });
  assert(taskResult.ok && taskResult.stdout.includes('task-ok'), '构建任务执行失败');
  const customTask = await postJson(baseUrl, '/api/project/tasks/run', { command: 'node -e "process.stdout.write(\'custom-ok\')"', cwd: 'sample' });
  assert(customTask.ok && customTask.stdout === 'custom-ok', '自定义任务执行失败');
  const escapedTask = await postJson(baseUrl, '/api/project/tasks/run', { command: 'pwd', cwd: '../escape' });
  assert(!escapedTask.ok, '构建任务未拒绝越界工作目录');
  const tests = await requestJson(baseUrl, '/api/project/tests');
  const npmTest = tests.tests.find((item) => item.command === 'npm run test');
  assert(tests.ok && npmTest && npmTest.cwd === 'sample', '未检测到 npm 测试任务');
  const testResult = await postJson(baseUrl, '/api/project/tests/run', { id:npmTest.id });
  assert(testResult.ok && testResult.stdout.includes('test-ok'), '测试任务执行失败');
  const debug = await requestJson(baseUrl, '/api/project/debug');
  assert(debug.ok && debug.adapters.some((item) => item.id === 'node' && item.available) && debug.adapters.some((item) => item.id === 'lldb'), '统一调试适配器检测异常');

  const compileDb = await requestJson(baseUrl, '/api/project/compile-db');
  assert(compileDb.ok && compileDb.found && compileDb.entries === 1 && compileDb.defines.includes('DEMO_FEATURE=1'), '编译数据库解析失败');
  const health = await requestJson(baseUrl, '/api/project/health');
  assert(health.ok && health.summary.files >= 4 && Number.isInteger(health.summary.ignoredFiles) && health.summary.todos === 1 && health.languages.C === 1 && health.languages['C/C++'] === 1, '工程健康报告统计异常');
  const lspStatus = await requestJson(baseUrl, '/api/lsp/status');
  assert(lspStatus.ok && lspStatus.servers.some((item) => item.command === 'clangd' && item.languages.includes('c_cpp')), 'LSP 环境状态接口异常');
  if (lspStatus.servers.some((item) => item.command === 'clangd' && item.available)) {
    const lspHover = await postJson(baseUrl, '/api/lsp/query', { file:snippetFile, fragment:0, code:'int main(void) { return 0; }', action:'hover', line:1, column:5 });
    assert(lspHover.ok && lspHover.server === 'clangd' && lspHover.hover && /main/.test(lspHover.hover.markdown), 'clangd 悬停信息查询失败');
    const lspCompletion = await postJson(baseUrl, '/api/lsp/query', { file:snippetFile, fragment:0, code:'int main(void) { ret }', action:'completion', line:1, column:21 });
    assert(lspCompletion.ok && Array.isArray(lspCompletion.items), 'clangd 自动补全查询失败');
    const lspActions = await postJson(baseUrl, '/api/lsp/query', { file:snippetFile, fragment:0, code:'int main(void) { return 0; }', action:'codeAction', line:1, column:5 });
    assert(lspActions.ok && Array.isArray(lspActions.actions), 'clangd 快速修复查询失败');
    const cppHeaderDiagnostics = await postJson(baseUrl, '/api/lsp/query', { file:cppHeaderFile, fragment:1, action:'diagnostics', line:1, column:1 });
    assert(cppHeaderDiagnostics.ok && cppHeaderDiagnostics.diagnostics.length === 0, 'C++ .h 头文件被错误地按 C 语言诊断');
  }

  const invalidRemoteFiles = await postJson(baseUrl, '/api/remote/files/list', { host:'bad host', port:22, user:'robot', path:'.' });
  assert(!invalidRemoteFiles.ok && /主机/.test(invalidRemoteFiles.error), '远程文件接口未拒绝非法主机');
  const invalidTransferMeta = Buffer.from(JSON.stringify({ host:'127.0.0.1', port:22, user:'robot', path:'.', relativePath:'../escape.txt' })).toString('base64');
  const invalidUploadResponse = await fetch(baseUrl + '/api/remote/files/upload-stream', { method:'POST', headers:{ 'X-CodeScope-Remote':invalidTransferMeta }, body:'test' });
  const invalidUpload = await invalidUploadResponse.json();
  assert(!invalidUpload.ok && /相对路径/.test(invalidUpload.error), '流式远程上传接口未拒绝越界路径');

  const invalidLatency = await requestJson(baseUrl, '/api/remote/latency?host=bad%20host&port=5900', 400);
  assert(invalidLatency.ok === false, '延迟接口未拒绝非法主机');

  const invalidWebSearch = await postJson(baseUrl, '/api/ai/web-search', { provider:'tavily', key:'', query:'test' }, 400);
  assert(invalidWebSearch.ok === false && /Key/.test(invalidWebSearch.error), '联网搜索接口未拒绝缺失的 API Key');
  const malformedJsonResponse = await fetch(baseUrl + '/api/ai/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{' });
  const malformedJson = await malformedJsonResponse.json();
  assert(malformedJsonResponse.status === 400 && !malformedJson.ok && /JSON/.test(malformedJson.error), '服务端未明确拒绝损坏的 JSON 请求');
  const unicodeBody = Buffer.from(JSON.stringify({ provider:'tavily', key:'', query:'中文检索' }));
  const unicodeAt = unicodeBody.indexOf(Buffer.from('中'));
  const chunkedJson = await postChunkedJson(baseUrl, '/api/ai/web-search', [unicodeBody.subarray(0, unicodeAt + 1), unicodeBody.subarray(unicodeAt + 1)]);
  assert(chunkedJson.status === 400 && /Key/.test(chunkedJson.data.error), '服务端无法正确解析跨网络分片的 UTF-8 JSON');

  console.log(`CodeScope smoke tests: ${passed} passed`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}).finally(() => {
  if (child && child.exitCode === null) child.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
