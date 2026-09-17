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
const packageJson = require(path.join(projectRoot, 'package.json'));
const readingEditorBundle = fs.readFileSync(path.join(projectRoot, 'assets', 'reading-block-editor.js'), 'utf8');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-test-'));
const vault = path.join(tempRoot, 'vault');
let child, officeStub;
let passed = 0;

assert(readingEditorBundle.includes('codescope-block-transform-menu'), '阅读编辑器产物应包含六点手柄转换菜单');
assert(readingEditorBundle.includes('\\u516C\\u5F0F'), '阅读编辑器产物应包含公式转换项，避免源码与构建产物失配');
assert(readingEditorBundle.includes('data-block-action="image"') && readingEditorBundle.includes('data-block-action="delete"'), '阅读编辑器产物应包含插入图片和删除区块操作');

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

function requestJsonWithHeaders(baseUrl, pathname, headers = {}) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(target, { headers }, (res) => {
      const parts = [];
      res.on('data', (chunk) => parts.push(chunk));
      res.on('end', () => {
        try { resolve({ status:res.statusCode, data:JSON.parse(Buffer.concat(parts).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end();
  });
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
  const desktopMain = fs.readFileSync(path.join(projectRoot, 'desktop', 'main.js'), 'utf8');
  const desktopPreload = fs.readFileSync(path.join(projectRoot, 'desktop', 'preload.js'), 'utf8');
  const officeSidecar = fs.readFileSync(path.join(projectRoot, 'desktop', 'office-sidecar.js'), 'utf8');
  const officeEngine = fs.readFileSync(path.join(projectRoot, 'lib', 'office-engine.js'), 'utf8');
  const forgeConfig = fs.readFileSync(path.join(projectRoot, 'forge.config.js'), 'utf8');
  assert(packageJson.main === 'desktop/main.js' && packageJson.scripts.start === 'node server.js' && packageJson.scripts.desktop, 'Web / Desktop 双入口配置不完整');
  assert(packageJson.scripts.prestart === 'node scripts/ensure-onlyoffice.js' && packageJson.scripts.preweb === 'node scripts/ensure-onlyoffice.js' && fs.existsSync(path.join(projectRoot, 'scripts', 'ensure-onlyoffice.js')), 'Web 启动流程未自动恢复本机 ONLYOFFICE');
  assert(/utilityProcess\.fork/.test(desktopMain) && /BrowserWindow/.test(desktopMain) && /contextIsolation:\s*true/.test(desktopMain), '桌面主进程未使用隔离窗口和独立服务进程');
  assert(/contextBridge\.exposeInMainWorld/.test(desktopPreload) && /codescopeDesktop/.test(desktopPreload), '桌面安全桥接配置不完整');
  assert(/maker-squirrel/.test(forgeConfig) && /maker-dmg/.test(forgeConfig) && /maker-deb/.test(forgeConfig), '桌面跨平台构建配置不完整');
  assert(/cloudManagedCheckout/.test(forgeConfig) && /Mobile Documents/.test(forgeConfig) && /outDir:\s*forgeOutDir/.test(forgeConfig), 'macOS 云盘工作区未隔离签名产物目录');
  assert(/discoverOfficeProvider/.test(desktopMain) && /startOfficeSidecar/.test(desktopMain) && /CODESCOPE_OFFICE_PROVIDER_MANIFEST/.test(desktopMain), '桌面端未接入可升级 Office Provider 管理器');
  assert(/sha256/.test(officeSidecar) && /apiRevision/.test(officeSidecar) && /healthUrl/.test(officeSidecar), 'Office Provider 缺少版本、摘要或健康检查约束');
  assert(!/id:'codescope-local'/.test(officeEngine) && /required:true/.test(officeEngine) && /updateContract/.test(officeEngine) && /onlyoffice-docs/.test(officeEngine), 'Office Provider API 未将 ONLYOFFICE 声明为唯一必选内核');
  assert(packageJson.scripts['verify:office'] && packageJson.scripts['prepackage:desktop'] && packageJson.scripts['premake:desktop'], 'Office 打包校验未接入桌面构建生命周期');
  const goplsBuildSource = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-bundled-gopls.js'), 'utf8');
  assert(/extraResource/.test(forgeConfig) && /\.bundled-tools/.test(forgeConfig) && /\(\?:\^\|\\\/\)out/.test(forgeConfig) && packageJson.scripts['prepare:gopls'], 'gopls 未纳入跨平台桌面安装包或旧构建产物未排除');
  assert(/crossCompiling/.test(goplsBuildSource) && /GOPATH/.test(goplsBuildSource) && /\$\{goos\}_\$\{goarch\}/.test(goplsBuildSource), 'gopls 构建脚本缺少跨架构产物处理');
  assert(/osxSign:\s*macSignConfig/.test(forgeConfig) && /identity:\s*macSigningIdentity\s*\|\|\s*['"]-['"]/.test(forgeConfig) && /continueOnError:\s*false/.test(forgeConfig) && /hardenedRuntime:\s*false/.test(forgeConfig), 'macOS 应用必须执行完整且可启动的代码签名');
  assert(/CODESCOPE_MAC_NOTARY_PROFILE/.test(forgeConfig) && /osxNotarize:\s*macNotarizeConfig/.test(forgeConfig) && /keychainProfile/.test(forgeConfig), 'macOS 正式发行缺少公证配置接口');
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
    env: { ...process.env, CODESCOPE_HOST: '127.0.0.1', CODESCOPE_PORT: String(port), CODESCOPE_VAULT: vault, CODESCOPE_DATA_HOME: path.join(tempRoot, 'data'), CODESCOPE_DSH_AUTOSTART:'0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));

  await waitForServer(baseUrl, output);

  const dshIntegration = await requestJson(baseUrl, '/api/integrations/dsh');
  assert(dshIntegration.ok && dshIntegration.service && dshIntegration.service.installed && dshIntegration.service.bundled, 'DeepSeek Harness 未作为 CodeScope 内置托管服务暴露');

  const knowledgeInitial = await requestJson(baseUrl, '/api/knowledge/status');
  assert(knowledgeInitial.ok && knowledgeInitial.engine === 'VitePress' && knowledgeInitial.pageCount >= 2 && knowledgeInitial.pages.some((item) => item.path === '快速开始/使用指南/知识库使用指南.md'), '知识库初始化、示例项目或状态接口异常');
  const knowledgeFolderCreated = await postJson(baseUrl, '/api/knowledge/folder', { path:'嵌入式 Linux' });
  const knowledgeProject = await postJson(baseUrl, '/api/knowledge/project', { path:'嵌入式 Linux/驱动开发', description:'Linux 驱动学习与调试' });
  assert(knowledgeFolderCreated.ok && knowledgeProject.ok && knowledgeProject.readingPath === '知识库/嵌入式 Linux/驱动开发/项目概览.md', '知识库分类或项目创建失败');
  const knowledgePage = await postJson(baseUrl, '/api/knowledge/page', { path:'嵌入式 Linux/驱动开发/设备驱动.md', title:'Linux 设备驱动' });
  assert(knowledgePage.ok && knowledgePage.readingPath === '知识库/嵌入式 Linux/驱动开发/设备驱动.md', '知识库项目内 Markdown 片段创建失败');
  const knowledgeImageInfo=Buffer.from(JSON.stringify({path:'设备驱动/示意图.png'})).toString('base64');
  const knowledgeImageResponse=await fetch(baseUrl+'/api/knowledge/image',{method:'POST',headers:{'Content-Type':'image/png','X-CodeScope-Knowledge':knowledgeImageInfo},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
  const knowledgeImage=await knowledgeImageResponse.json();
  assert(knowledgeImageResponse.ok && knowledgeImage.ok && knowledgeImage.markdown.includes('/images/') && fs.existsSync(path.join(vault,'readings','知识库','public','images','设备驱动','示意图.png')), '知识库图片导入、分类存储或 Markdown 语法生成失败');
  const knowledgeEditorImage=await fetch(baseUrl+knowledgeImage.url);
  assert(knowledgeEditorImage.ok && knowledgeEditorImage.headers.get('content-type')==='image/png' && (await knowledgeEditorImage.arrayBuffer()).byteLength>0, '知识库原始图片未通过 CodeScope /images 路由提供，区块编辑器会显示破图');
  const knowledgeBuild = await postJson(baseUrl, '/api/knowledge/build', {});
  assert(knowledgeBuild.phase === 'ready' && knowledgeBuild.built && !knowledgeBuild.pending && knowledgeBuild.pageCount >= 3 && knowledgeBuild.assetCount === 1, 'VitePress 知识库构建、待处理状态或图片统计失败：' + (knowledgeBuild.error || 'unknown'));
  const knowledgeSite = await fetch(baseUrl + '/knowledge/');
  const knowledgeSiteHtml = await knowledgeSite.text();
  assert(knowledgeSite.ok && knowledgeSiteHtml.includes('我的知识库'), '知识库静态站点未正确提供');
  const knowledgePageBeforeBlob = fs.readFileSync(path.join(vault,'readings','知识库','嵌入式 Linux','驱动开发','设备驱动.md'),'utf8');
  const rejectedBlob = await fetch(baseUrl+'/api/readings/text-fragment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'知识库/嵌入式 Linux/驱动开发/设备驱动.md',content:'# 错误图片\n\n![临时图片](blob:http://127.0.0.1:4877/expired)'})});
  const rejectedBlobBody = await rejectedBlob.json();
  assert(rejectedBlob.status === 400 && !rejectedBlobBody.ok && /blob/.test(rejectedBlobBody.error) && fs.readFileSync(path.join(vault,'readings','知识库','嵌入式 Linux','驱动开发','设备驱动.md'),'utf8') === knowledgePageBeforeBlob, '知识库未拒绝浏览器临时图片地址或覆盖了原文档');
  const brokenPage = path.join(vault,'readings','知识库','嵌入式 Linux','驱动开发','损坏图片.md');
  fs.writeFileSync(brokenPage,'# 损坏图片\n\n![临时图片](blob:http://127.0.0.1:4877/expired)\n');
  const failedKnowledgeBuild = await postJson(baseUrl, '/api/knowledge/build', {});
  const preservedKnowledgeSite = await fetch(baseUrl + '/knowledge/');
  assert(failedKnowledgeBuild.phase === 'error' && failedKnowledgeBuild.built && /保留上一版本/.test(failedKnowledgeBuild.message) && preservedKnowledgeSite.ok && await preservedKnowledgeSite.text() === knowledgeSiteHtml, '知识库构建失败后未完整保留上一版站点');
  fs.rmSync(brokenPage,{force:true});
  const restoredKnowledgeBuild = await postJson(baseUrl, '/api/knowledge/build', {});
  assert(restoredKnowledgeBuild.phase === 'ready' && restoredKnowledgeBuild.built, '移除无效临时图片后知识库未恢复构建');

  const unicodeSnippets = await requestJson(baseUrl, '/api/snippets');
  const unicodeFragment = unicodeSnippets.snippets.find((item) => item.name === 'Timeline Demo').fragments[0];
  assert(unicodeFragment.label === '中文片段', '片段中文名称解析或重新读取后丢失');

  const version = await requestJson(baseUrl, '/api/version');
  assert(version.ok && version.name === '码境 CodeScope' && version.version === packageJson.version && version.apiRevision >= 5 && version.releaseChannel === 'stable' && version.mode === 'web' && version.capabilities.web && !version.capabilities.desktop && version.features.includes('dual-mode-runtime') && version.features.includes('desktop-shell') && version.features.includes('unified-workbench-ui') && version.features.includes('environment-readiness') && version.features.includes('browser-capabilities') && version.features.includes('project-health') && version.features.includes('workspace-backlinks') && version.features.includes('markdown-note-links') && version.features.includes('xmind-markdown-export') && version.features.includes('xmind-native') && version.features.includes('xmind-official-viewer') && version.features.includes('xmind-simple-mind-map') && version.features.includes('xmind-advanced-layouts') && version.features.includes('xmind-node-reparent') && version.features.includes('opml-export') && version.features.includes('workspace-snapshots') && version.features.includes('live-web-search') && version.features.includes('search-history') && version.features.includes('editor-groups') && version.features.includes('monaco-editor') && version.features.includes('multi-cursor') && version.features.includes('editor-folding') && version.features.includes('editor-command-palette') && version.features.includes('editor-word-wrap') && version.features.includes('editor-wheel-zoom') && version.features.includes('editor-position') && version.features.includes('lsp-completion') && version.features.includes('lsp-rename') && version.features.includes('lsp-code-actions') && version.features.includes('project-tests') && version.features.includes('project-debug') && version.features.includes('drawio') && version.features.includes('drawio-xml') && version.features.includes('ai-drawio') && version.features.includes('full-text-search') && version.features.includes('quick-open') && version.features.includes('workspace-quick-open') && version.features.includes('workspace-recent') && version.features.includes('reading-full-text-search') && version.features.includes('pdf-text-cache') && version.features.includes('navigation-history') && version.features.includes('definition-peek') && version.features.includes('header-source-switch') && version.features.includes('lsp') && version.features.includes('pdf-library') && version.features.includes('pdf-translation') && version.features.includes('pdf-full-text-search') && version.features.includes('pdf-thumbnail-navigation') && version.features.includes('pdf-focus-mode') && version.features.includes('pdfjs-official-viewer') && version.features.includes('pdf-virtual-rendering') && version.features.includes('pdf-page-layouts') && version.features.includes('onlyoffice-pdf-editor') && version.features.includes('reading-fragments') && version.features.includes('reading-split-view') && version.features.includes('reading-projects') && version.features.includes('reading-code-notes') && version.features.includes('office-library') && version.features.includes('office-provider-api-v1') && version.features.includes('onlyoffice-docs') && version.features.includes('onlyoffice-required') && version.features.includes('onlyoffice-connection-settings') && version.features.includes('onlyoffice-jwt') && version.features.includes('onlyoffice-save-callback') && !version.features.includes('office-builtin-engine'), '版本接口返回异常');
  assert(version.study && version.study.available && version.study.webOnly && version.study.paneTypes.includes('browser') && version.features.includes('study-workspace') && version.features.includes('study-site-catalog') && version.features.includes('study-site-categories') && version.features.includes('study-layout-truth') && version.features.includes('study-readable-browser') && version.features.includes('study-video-timepoints') && version.features.includes('study-video-frame-capture') && !version.features.includes('study-screen-capture'), '学习工作台网页、布局或视频笔记能力未正确声明');
  assert(version.features.includes('docx-page-break-normalization') && version.features.includes('reading-web-site-navigation') && version.features.includes('reading-web-session') && version.features.includes('reading-web-whole-page-zoom') && version.features.includes('reading-web-annotations') && version.features.includes('reading-web-location'), 'Word 分页修复或网页站点阅读能力未声明');

  const initialStudy = await requestJson(baseUrl, '/api/study/config');
  assert(initialStudy.ok && initialStudy.config.bookmarks.some((item) => item.id === 'bilibili' && item.category === 'featured'), '学习工作台缺少默认常用网址或旧配置分类迁移异常');
  const savedStudy = await postJson(baseUrl, '/api/study/config', { title:'测试工作台', preset:'quad', categories:[{ id:'robotics',label:'机器人学习',icon:'🤖',color:'#70d6a3' }], hiddenSites:['https://example.com/hidden'], bookmarks:[...initialStudy.config.bookmarks,{ id:'freertos-doc',label:'FreeRTOS 文档',url:'https://www.freertos.org/',color:'#55c7d9',category:'robotics' }], layout:{ root:{ type:'stack', content:[] } } });
  assert(savedStudy.ok && savedStudy.config.version === 3 && savedStudy.config.title === '测试工作台' && savedStudy.config.preset === 'quad' && savedStudy.config.categories.some((item) => item.id === 'robotics' && item.label === '机器人学习') && savedStudy.config.hiddenSites.includes('https://example.com/hidden') && savedStudy.config.bookmarks.some((item) => item.id === 'freertos-doc' && item.category === 'robotics'), '学习工作台配置、自定义分类或网址移动未持久化');
  const savedStudyNote = await postJson(baseUrl, '/api/study/note?id=main', { content:'# 学习测试\n' });
  const loadedStudyNote = await requestJson(baseUrl, '/api/study/note?id=main');
  assert(savedStudyNote.ok && loadedStudyNote.content === '# 学习测试\n', '学习工作台 Markdown 笔记读写异常');
  const studyPng = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01,0x02,0x03]);
  const studyFrameResponse = await fetch(baseUrl + '/api/study/asset?title=' + encodeURIComponent('测试视频帧'), { method:'POST', headers:{ 'content-type':'image/png' }, body:studyPng });
  const studyFrame = await studyFrameResponse.json();
  assert(studyFrameResponse.ok && studyFrame.ok && /^frame-/.test(studyFrame.name) && /api\/study\/asset/.test(studyFrame.url), '学习工作台视频帧保存接口异常');
  const loadedStudyFrame = await fetch(baseUrl + studyFrame.url);
  assert(loadedStudyFrame.ok && Buffer.from(await loadedStudyFrame.arrayBuffer()).equals(studyPng), '学习工作台视频帧读取接口异常');
  const invalidStudyFrame = await fetch(baseUrl + '/api/study/asset', { method:'POST', headers:{ 'content-type':'image/png' }, body:Buffer.from('not-a-png') });
  assert(invalidStudyFrame.status === 415, '学习工作台应拒绝伪造的视频帧图片内容');

  const environment = await requestJson(baseUrl, '/api/env');
  const runtimeEntries = Object.values(environment.runtime || {});
  assert(environment.version === packageJson.version && environment.mode === 'web' && environment.node && environment.system && environment.summary && Number.isInteger(environment.summary.requiredMissing), '环境接口模式、版本、系统信息或汇总结构异常');
  assert(['node','vault','appData','temp','dependencies'].every((key) => environment.runtime && environment.runtime[key] && environment.runtime[key].available), '运行基础环境检测不完整');
  assert(runtimeEntries.every((item) => typeof item.required === 'boolean' && item.group), '运行环境条目结构不完整');
  assert(environment.summary.missing === environment.summary.requiredMissing && environment.summary.optionalUnavailable === environment.summary.optionalMissing, '环境汇总仍把按需扩展计为运行缺失');
  assert(environment.summary.externalUnavailable === 1, '外部服务没有从本机环境缺失中独立统计');
  assert(Object.values(environment.env || {}).every((item) => (item.key === 'onlyoffice' ? item.required === true : item.required === false) && typeof item.relevant === 'boolean'), 'ONLYOFFICE 必需状态或外部项目工具标记异常');
  const requiredBundledTools = ['black','npx','pyrightlsp','tslsp',...(process.env.CODESCOPE_REQUIRE_BUNDLED_GOPLS === '1' ? ['gopls'] : [])];
  assert(requiredBundledTools.every((key) => environment.env[key] && environment.env[key].available && environment.env[key].bundled), '跨平台格式化器或语言服务器没有作为内置环境提供');
  assert(requiredBundledTools.every((key) => /无需另行配置/.test(environment.env[key].hint)), '内置工具仍显示外部安装说明');
  assert(!environment.runtime.officeBuiltin, '已停用的内置 Office 仍出现在运行环境中');
  assert(environment.env.onlyoffice && environment.env.onlyoffice.external && environment.env.onlyoffice.required && /尚未配置|等待重新检测|服务未连接/.test(environment.env.onlyoffice.issue) && /连接设置/.test(environment.env.onlyoffice.hint), 'ONLYOFFICE 必选连接说明不完整');
  const officeProviders = await requestJson(baseUrl, '/api/office/providers/v1');
  assert(officeProviders.ok && officeProviders.apiRevision === 1 && officeProviders.active === null && officeProviders.providers.length === 1 && officeProviders.providers[0].id === 'onlyoffice-docs' && officeProviders.providers[0].required && !officeProviders.providers[0].available && officeProviders.updateContract.manifestVersion === 1, 'ONLYOFFICE Provider v1 契约异常');
  const officeConnection = await requestJson(baseUrl, '/api/office/connection');
  assert(officeConnection.ok && !officeConnection.connection.configured && !('jwtSecret' in officeConnection.connection), 'ONLYOFFICE 未配置状态或密钥脱敏异常');
  const weakOfficeSecret = await postJson(baseUrl, '/api/office/connection', { publicUrl:'http://127.0.0.1:8088', jwtSecret:'short' }, 400);
  assert(!weakOfficeSecret.ok && /16/.test(weakOfficeSecret.error), 'ONLYOFFICE 连接接口未拒绝过短 JWT 密钥');

  const bundledLspStatus = await requestJson(baseUrl, '/api/lsp/status');
  const requiredBundledServers = ['pyright-langserver','typescript-language-server',...(process.env.CODESCOPE_REQUIRE_BUNDLED_GOPLS === '1' ? ['gopls'] : [])];
  assert(bundledLspStatus.ok && requiredBundledServers.every((command) => bundledLspStatus.servers.some((item) => item.command === command && item.available && item.bundled)), '内置语言服务器运行时状态异常');

  const page = await fetch(baseUrl + '/');
  const html = await page.text();
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const blockEditorSource = fs.readFileSync(path.join(projectRoot, 'src', 'reading-block-editor.js'), 'utf8');
  const knowledgeSource = fs.readFileSync(path.join(projectRoot, 'lib', 'knowledge-base.js'), 'utf8');
  const preflightSource = fs.readFileSync(path.join(projectRoot, 'preflight.js'), 'utf8');
  const launchers = ['start.command', '../启动码境.command', '../启动码境.sh', '../启动码境.bat']
    .map((file) => fs.readFileSync(path.resolve(projectRoot, file), 'utf8')).join('\n');
  assert(page.ok && html.includes('码境 CodeScope · 工程代码工作台'), '主页品牌标题不正确');
  assert(/Content-Security-Policy/.test(html) && !/script-src[^;]*unsafe-eval/.test(html), '桌面/Web 共用页面缺少安全 CSP 或允许了 unsafe-eval');
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
  assert(html.includes('id="app-nav"') && html.includes('id="workspace-welcome"') && html.includes('id="welcome-search"') && html.includes("welcome.hidden = !!s"), '响应式全局导航或空白工作区快捷入口缺失');
  assert(html.includes('content-visibility:auto') && html.includes('@media (prefers-contrast:more)') && html.includes("$('welcome-study').onclick"), '长列表延迟绘制、增强对比度或快捷入口交互缺失');
  assert(['welcome-dsh','welcome-office','welcome-project','welcome-remote'].every(id=>html.includes(`id="${id}"`)) && html.includes("$('welcome-dsh').onclick") && html.includes("$('welcome-office').onclick") && html.includes("$('welcome-project').onclick") && html.includes("$('welcome-remote').onclick"), '空白工作区未覆盖 DSH、Office、工程与远程开发入口');
  assert(['tab-cases','tab-results','algo-cases','algo-results'].every(id=>html.includes(`id="${id}"`)) && html.includes('async function runAlgoTests') && html.includes("const ALGO_CASES_KEY = 'mc-algorithm-cases-v1'"), '算法测试用例、结果面板或按片段持久化能力缺失');
  assert(['office-service-state','office-service-start','office-service-stop'].every(id=>html.includes(`id="${id}"`)) && html.includes("'/api/office/service'") && serverSource.includes('controlOnlyOfficeService') && serverSource.includes("['start','stop'].includes(action)"), 'ONLYOFFICE 固定容器的启动/关闭控制缺失');
  assert(html.includes('id="btn-manual"') && html.includes('class="brand-github brand-manual"') && html.includes('href="/manual/"') && serverSource.includes("u.pathname === '/manual'") && fs.existsSync(path.join(__dirname, '..', 'docs', 'manual', 'index.html')), '内置使用手册左侧小图标入口或静态页面路由缺失');
  assert(packageJson.dependencies.vitepress && packageJson.scripts['build:knowledge'] && ['btn-knowledge-launch','knowledge-launch-menu','knowledge-workspace','knowledge-workspace-frame','knowledge-workspace-split'].every(id=>html.includes(`id="${id}"`)) && !html.includes('id="btn-knowledge"') && html.includes('openKnowledgeWorkspace') && html.includes('openKnowledgeSplit') && html.includes('id="knowledge-center"') && html.includes('document.body.appendChild(modal)') && html.includes('closeKnowledgeCenter') && html.includes('uploadKnowledgeImages') && html.includes('createKnowledgePageInProject') && html.includes('createKnowledgeProjectInFolder') && serverSource.includes('buildKnowledgeProject') && serverSource.includes("'/api/knowledge/project'") && serverSource.includes("u.pathname === '/knowledge'"), 'VitePress 知识库的唯一顶栏入口、内嵌/分栏阅读、顶层管理弹窗、分类、项目、Markdown 片段、图片导入或站点路由缺失');
  assert(knowledgeSource.includes('codescope-kb-theme') && knowledgeSource.includes('codescope-kb-width') && knowledgeSource.includes('海洋蓝') && knowledgeSource.includes('森林绿') && knowledgeSource.includes('暮光紫') && knowledgeSource.includes('暖纸棕') && knowledgeSource.includes('--kb-content-width'), 'VitePress 知识库缺少可记忆配色主题或阅读版心切换');
  assert(knowledgeSource.includes("content:'分类'") && knowledgeSource.includes("content:'项目'") && knowledgeSource.includes("content:'文'") && knowledgeSource.includes('.VPSidebarItem.level-2.is-active'), 'VitePress 知识库侧栏缺少分类、项目、文档三级视觉层级');
  assert(knowledgeSource.includes('const ReadingProgress') && knowledgeSource.includes('const AccurateOutline') && knowledgeSource.includes('kb-current') && knowledgeSource.includes('clamp(210px,38vh,430px)') && knowledgeSource.includes('const DocContext') && knowledgeSource.includes("'doc-before': () => h(DocContext)") && knowledgeSource.includes('.kb-breadcrumb') && knowledgeSource.includes('counter-increment:kb-h2') && knowledgeSource.includes('.vp-doc h3 + ul'), 'VitePress 知识库缺少阅读进度、精确大纲定位、文档上下文、章节编号或结构化列表排版');
  assert(html.includes('id="env-runtime-list"') && html.includes('id="env-client-list"') && html.includes('clientEnvironment') && html.includes('renderEnvironmentRows'), '环境面板缺少运行基础或浏览器能力检测');
  assert(packageJson.dependencies['@deepseek-ai/dsh'] && html.includes('id="btn-dsh"') && html.includes('id="dsh-workspace"') && html.includes('id="dsh-frame"') && html.includes("classList.add('dsh-mode')") && html.includes('id="btn-env-dsh-restart"') && serverSource.includes("'/api/integrations/dsh'"), 'DSH 依赖、内嵌工作区、环境控制或服务 API 缺失');
  assert(html.includes('#tree-head,#git-head,#tag-head,#draw-head,#office-head,#reading-head') && html.includes('#tree-head .side-head-actions button,#draw-head .side-head-actions button,#office-head .side-head-actions button,#reading-head .side-head-actions button'), 'Office 与其他一级模块未使用统一侧栏 UI');
  assert(serverSource.includes('function runtimeReadiness') && serverSource.includes("releaseChannel:'stable'") && launchers.includes('node preflight.js --quiet'), '跨平台运行预检或 v2 稳定版契约缺失');
  assert(preflightSource.includes("process.argv.includes('--json')") && preflightSource.includes('missingDependencies') && preflightSource.includes('fs.constants.R_OK | fs.constants.W_OK'), '启动预检缺少 JSON、依赖或目录权限诊断');
  assert(html.includes('id="editor-find"') && html.includes('replaceEditorFindAll') && html.includes("e.key==='F3'"), '编辑器快捷键查找替换功能缺失');
  assert(html.includes('/monaco/vs/loader.js') && html.includes('id="monaco-main"') && html.includes('syncMonacoMain') && html.includes('multiCursorModifier'), 'Monaco / VS Code 同源编辑内核缺失');
  assert(html.includes('<script src="/assets/xterm.js"></script>') && !html.includes('<script src="/assets/xterm.js" defer'), 'xterm 必须在 Monaco AMD loader 之前同步注册全局 Terminal');
  assert(!html.includes('id="btn-wrap"') && !html.includes('id="btn-indent"') && html.includes('toggleEditorWordWrap') && html.includes("key==='z'") && html.includes('id="editor-position"'), '低频缩进/换行按钮未移除，或快捷键与光标行列状态缺失');
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
  assert(html.includes('function xmindZoomAt') && html.includes('function xmindPanBy') && html.includes('function xmindContentBounds') && html.includes('function xmindFitEditor') && html.includes("mousewheelAction:'move'") && html.includes('xmindApplyViewport'), 'XMind 画布缺少指针缩放、联合边界居中、横纵平移或独立视口控制');
  assert(html.includes('id="pane-office"') && html.includes('id="office-workspace"') && html.includes('renderOnlyOffice') && html.includes('officeConnectionScreen') && html.includes('/api/office/onlyoffice/config') && html.includes('/api/office/connection') && html.includes('连接 ONLYOFFICE Docs') && !/if\(!embedded\)await renderOfficeFallback/.test(html), 'Office 一级模块、ONLYOFFICE 必选编辑或连接设置缺失');
  assert(html.includes('id="xmind-add-floating"') && html.includes('id="xmind-to-floating"') && html.includes('children.detached') && html.includes('xmindRenderFloatingTopics') && html.includes('xmindAttachFloating') && html.includes('xmindAddFloatingAt(event.clientX,event.clientY)') && html.includes('function xmindEngineTopicId') && html.includes('findNodeByUid'), 'XMind 缺少标准自由主题、任意位置拖放、节点标识映射或层级互转能力');
  assert(html.includes('function xmindDefaultFloatingPosition') && html.includes('function xmindFloatingItems') && html.includes('function xmindDetachFloatingAt') && html.includes("badge.textContent=item.root?'自由导图'"), 'XMind 自由主题缺少子树自动布局、独立分支拆分或层级标识');
  assert(html.includes('rootPreview=XMIND_FLOAT_DRAG') && html.includes('origin=rootPreview||stored||fallback') && html.includes('codescopeFreeLayoutVersion!==4') && html.includes("node.style.setProperty('--free-scale',String(origin.scale))") && html.includes('const XMIND_SMM_LAYOUTS='), 'XMind 自由导图缺少一次性碰撞修复、位置隔离、统一缩放或新版结构引擎适配');
  assert(html.includes('id="xmind-view-native"') && html.includes('id="xmind-native-image"') && html.includes('setXmindView') && html.includes('XMind 原始画布'), 'XMind 缺少原貌快照与可编辑视图切换');
  assert(html.includes('id="xmind-view-official"') && html.includes('id="xmind-official-consent"') && html.includes('id="xmind-official-host"') && html.includes('openXmindOfficialView') && html.includes('/xmind-viewer/xmind-embed-viewer.js') && html.includes('www.xmind.cn'), 'XMind 缺少带隐私确认和隔离挂载容器的官方全画布查看器');
  assert(html.includes('id="xmind-engine"') && html.includes('/simple-mind-map/simpleMindMap.esm.min.js') && html.includes('/simple-mind-map/simpleMindMap.esm.min.css') && html.includes('new MindMap({') && html.includes('enableFreeDrag:false') && html.includes('isDisableDrag:true') && html.includes("XMIND_MAP.on('data_change'") && html.includes('xmindSyncFromEditor') && html.includes("addEventListener('dblclick'"), 'XMind 编辑模式未接入 simple-mind-map 原生编辑、选择模式画布锁定、稳定结构拖拽或双向保存桥接');
  assert(html.includes("XMIND_OFFICIAL=new ViewerCtor({el:mount") && html.indexOf("XMIND_OFFICIAL.addEventListener('map-ready'") < html.indexOf('XMIND_OFFICIAL.load(file)') && html.includes("retry.onclick=openXmindOfficialView"), 'XMind 官方查看器未先注册事件再加载文件，或缺少失败重试');
  assert(html.includes('森林 · 圆角') && html.includes('海洋 · 通透蓝') && html.includes('石墨 · 专业灰') && html.includes('id="xmind-line-style"') && html.includes('id="xmind-node-shape"'), 'XMind 主题、节点形状或连线风格预设不足');
  assert(['organizationStructure','catalogOrganization','treeTable','timeline','verticalTimeline','fishbone','rightFishbone'].every(layout=>html.includes('value="'+layout+'"')), 'XMind 缺少组织结构、括号、树表、时间轴或鱼骨图布局');
  assert(html.includes("typeBadge.className = 'draw-type draw-type--' + kind") && html.includes("kind === 'xmind' ? 'XMind' : 'Excalidraw'"), '绘图列表缺少明确且隔离样式的类型标识');
  assert(html.includes('id="draw-ai-btn"') && html.includes('id="draw-xml-source"') && html.includes('generateDrawioWithAi') && html.includes('validateDrawioXmlLocal'), 'Draw.io AI 绘图或 XML 编辑器缺失');
  assert(html.includes('timeoutMs:300000') && html.includes('复杂图可能需要 1–5 分钟') && serverSource.includes('Math.min(600000') && serverSource.includes("e.name === 'TimeoutError'"), 'Draw.io AI 绘图长耗时请求或超时提示缺失');
  assert(html.includes('networkError:true') && html.includes('后端返回了无法解析的响应') && serverSource.includes("require('saxes')"), '全局 API 错误处理或服务端 XML 解析器缺失');
  assert((launchers.match(/Object\.keys\(p\.dependencies\|\|\{\}\)/g) || []).length === 4 && (launchers.match(/node preflight\.js --quiet/g) || []).length === 4, '三端启动脚本未对全部 package 依赖执行统一预检');
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
  assert((html.match(/ignoreLastRenderedPageBreak:true/g)||[]).length>=2 && html.includes('reading-web-nav-shell') && html.includes('/api/readings/web/page?url='), 'Word 阅读仍会重复分页，或网页阅读缺少站点目录与章节内导航');
  assert(html.includes('id="reading-new-library-folder"') && html.includes('createReadingFolder') && html.includes('editReadingProjectMeta') && html.includes('reading-project-tag'), '阅读项目缺少文件夹、说明或标签管理能力');
  assert(!html.includes('id="reading-one"') && !html.includes('id="reading-two"') && html.includes('id="reading-new-column-drop"') && html.includes('updateReadingColumnLayout') && html.includes('closeReadingColumn'), '阅读工作区仍依赖固定单/双栏按钮或缺少拖拽自动分栏');
  assert(html.includes('id="reading-new-dialog"') && html.includes('submitReadingNewFragment') && html.includes('<option value="latex">LaTeX') && html.includes('<option value="python">Python'), '阅读项目缺少统一的 PDF、文档与代码片段新建窗口');
  assert(serverSource.includes("'/api/readings/node/move'") && html.includes('application/x-codescope-reading-node'), '阅读文件夹或项目缺少拖拽调整层级能力');
  assert(html.includes('openPdfFind') && html.includes('buildPdfFindIndex') && html.includes('pdf-find-current') && html.includes('全文查找（⌘/Ctrl + F）'), 'PDF 阅读器缺少全文检索、结果定位或高亮能力');
  assert(html.includes('bindPdfReaderKeys') && html.includes("e.key === 'PageDown'") && html.includes("e.key === 'PageUp'") && html.includes('pdf-reader-focus'), 'PDF 阅读器缺少翻页快捷键或专注阅读模式');
  assert(html.includes('mc-pdf-view:') && html.includes('savePdfViewState') && html.includes('pdf-page-pill'), 'PDF 阅读器缺少视图记忆或页码快速跳转');
  assert(html.includes('togglePdfThumbnails') && html.includes('renderPdfThumbnails') && html.includes('pdf-thumb-panel') && html.includes('ResizeObserver'), 'PDF 阅读器缺少页面缩略图导航或容器尺寸自适应');
  assert(html.includes('loadPdfViewerLib') && html.includes('new lib.PDFViewer') && html.includes('IntersectionObserver') && html.includes('pdfjs-viewer-container'), 'PDF 阅读器未接入官方 Viewer 或可视区懒渲染');
  assert(html.includes('spread-cover') && html.includes('lib.ScrollMode.PAGE') && html.includes('lib.SpreadMode.ODD') && html.includes('ONLYOFFICE PDF Editor'), 'PDF 阅读器缺少单页、双页、封面双页或高级编辑入口');
  assert(html.includes('保存并返回 PDF.js') && html.includes('/api/readings/onlyoffice/forcesave') && html.includes('mix-blend-mode:multiply') && serverSource.includes("c:'forcesave'") && serverSource.includes("body.url, { root:readingsDir(), pdf:true }"), 'PDF 批注对比度或 ONLYOFFICE 确定性回写同步缺失');
  assert(html.includes('cleanPdfOutlineTitle') && html.includes('classifyPdfOutlineLine') && html.includes("source: 'auto-v2'") && html.includes("data.source === 'auto-v2' ? '智能识别'"), 'PDF 智能目录缺少分栏重建、标题清洗或层级分类能力');
  assert(html.includes('referencesReached') && html.includes('table\\s*(?:[.\\d]|[IVXLCDM]+\\b)'), 'PDF 智能目录缺少表格标题或参考文献正文过滤');
  assert(html.includes('saveToolbarSelection') && html.includes("cite.textContent = '引用笔记'") && html.includes('range.getClientRects()'), 'PDF 选区缺少逐行几何识别、快捷摘录或引用笔记能力');
  assert(html.includes('readingPdfRefMarkdown') && html.includes('appendReadingQuoteToNote') && html.includes('locateReadingMarkdownRef') && html.includes('reading-pdf-ref'), 'Markdown 阅读笔记缺少 Obsidian 风格 PDF 引用或原文回链定位');
  assert(html.includes('removeReadingLinkedPdfFragment') && html.includes('restoreReadingLinkedPdfFragment') && html.includes('syncRemovedReadingPdfRefs') && html.includes('readingPdfRefsInMarkdown') && html.includes('引用、PDF 摘录与页内标记已同步删除'), 'Markdown 按钮或直接编辑删除引用时，未与 PDF 摘录及页内标记保持事务同步');
  assert(html.includes('normalizePdfSelectionText') && html.includes('mergePdfSelectionRects') && !html.includes("replace(/scaleX\\([^)]*\\)/g, 'scaleX(1)')"), 'PDF 文本选择缺少精确文本拼接、逐行矩形合并或仍破坏 PDF.js 字形缩放');
  assert(html.includes('READING_SLASH_COMMANDS') && html.includes('applyReadingSlashCommand') && html.includes('readingSlashKeydown') && html.includes("id:'bullet'") && html.includes("id:'number'") && html.includes("id:'h1'"), 'Markdown 阅读笔记缺少斜杠命令或标题、列表块转换');
  assert(html.includes('callout-remove') && html.includes('引用已从 Markdown 笔记中移除') && html.includes("const ordered=tag==='ol'"), 'Markdown 引用缺少移除入口或有序列表持久化');
  assert(html.includes('reading-md-source') && html.includes('reading-md-block') && html.includes("['edit','live','preview']") && html.includes('loadReadingMarkdownMode') && html.includes('Markdown 阅读视图'), 'Markdown 阅读笔记缺少源码编辑、区块编辑、阅读模式或模式记忆');
  assert(html.includes('--md-measure:840px') && html.includes('--md-surface-hover') && html.includes('text-rendering:optimizeLegibility') && html.includes('@container (max-width:460px)') && html.includes('reading-md-property-tag') && html.includes('mdPropertyValue') && html.includes('reading-md-generated-title') && html.includes('orderedBlocks'), 'Markdown 阅读视图缺少主题化可读行宽、窄栏响应式属性标签或实时编辑回写兼容');
  assert(html.includes("blockquote.md-callout.warning") && html.includes('tbody tr:nth-child(even)') && html.includes("content:'●  ●  ●'") && html.includes('li > ul,.reading-md-editor li > ol'), 'Markdown 主题缺少提示块语义色、表格层次、代码块标题栏或嵌套列表引导线');
  assert(packageJson.dependencies['@milkdown/crepe'] && html.includes('/assets/reading-block-editor.js') && blockEditorSource.includes('new Crepe') && blockEditorSource.includes('[CrepeFeature.BlockEdit]'), 'Markdown 区块模式未接入本地打包的 Milkdown Crepe');
  assert(blockEditorSource.includes('listener.markdownUpdated') && blockEditorSource.includes('crepe.getMarkdown()') && html.includes('scheduleSave()'), 'Markdown 区块编辑器缺少 Markdown 原生回写或自动保存');
  assert(blockEditorSource.includes('splitFrontmatter') && blockEditorSource.includes('REFERENCE_RE') && blockEditorSource.includes('onReference') && html.includes('openBlockReference'), 'Markdown 区块编辑器未保护 frontmatter、PDF/代码引用或定位交互');
  assert(blockEditorSource.includes('[CrepeFeature.TopBar]: true') && blockEditorSource.includes('无序列表') && blockEditorSource.includes('代码块') && blockEditorSource.includes('表格'), 'Markdown 区块编辑器缺少格式工具栏、中文斜杠菜单或高级区块');
  assert(blockEditorSource.includes("blockCaptionPlaceholderText: '添加图片说明（可选）'") && blockEditorSource.includes("blockUploadButton: '选择图片'"), 'Markdown 图片区块仍显示英文说明或上传提示');
  assert(blockEditorSource.includes('looksLikeMarkdown') && blockEditorSource.includes("root.addEventListener('paste', onPaste, true)") && blockEditorSource.includes('crepe.editor.action(insert('), 'Markdown 区块编辑器缺少粘贴结构识别或原生 Markdown 解析插入');
  assert(blockEditorSource.includes('options.onImage') && blockEditorSource.includes("root.addEventListener('drop', onDrop, true)") && blockEditorSource.includes('codescope-image-inserted') && html.includes('uploadKnowledgeEditorImage'), '知识库 Markdown 区块编辑器缺少粘贴/拖入图片自动落盘能力');
  assert(blockEditorSource.includes('data-block-action="image"') && blockEditorSource.includes('data-block-action="delete"') && blockEditorSource.includes('deleteBlockAt') && blockEditorSource.includes('onInsertImages'), '六点手柄菜单缺少插入图片或删除区块操作');
  assert(blockEditorSource.includes("imageBlockSchema.type(ctx)") && blockEditorSource.includes("src:image.url") && html.includes('return result;'), '知识库图片仍通过 Markdown 字符串间接插入，可能在图片区块序列化时丢失地址');
  assert(html.includes('reading-md-zoom') && html.includes('loadReadingMarkdownZoom') && html.includes("e.deltaY<0?5:-5") && html.includes("e.key==='0'"), 'Markdown 区块编辑器缺少可记忆缩放、触控板缩放或键盘缩放');
  assert(html.includes('reading-md-outline') && html.includes('readingMarkdownHeadings') && html.includes('focusOutlineEntry') && html.includes('syncOutlineFromView') && html.includes('loadReadingMarkdownOutline'), 'Markdown 区块编辑器缺少可记忆大纲、标题层级、点击定位或滚动高亮');
  assert(!html.includes("setupReadingLiveBlocks(live,workbench,slot)"), '阅读模块仍在启用旧的自制区块拖拽层');
  assert(html.includes('reading-md-properties') && html.includes('笔记属性') && html.includes("data-md-source") && html.includes('font-size:2.08rem') && html.includes('grid-template-columns:minmax(125px,160px)'), 'Markdown 渲染缺少 Obsidian 风格属性面板或响应式阅读排版层级');
  assert(html.includes('readingSourceSlashContext') && html.includes("snippet:'> [!note] 笔记\\n> '") && html.includes("e.key==='Tab'") && html.includes("e.key.toLowerCase()==='s'"), 'Markdown 源码编辑器缺少斜杠命令、Tab 缩进或快捷保存');
  assert(html.includes('md-code-block') && html.includes('li class="md-task"') && html.includes('~~([^~]+)~~') && html.includes('data-md-start'), 'Markdown 渲染缺少代码围栏、任务列表、删除线或引用块定位');
  assert(html.includes('id="document-mode-tools"') && html.includes("['source','split','live','preview']") && html.includes('documentModeKey') && html.includes('wireProjectMarkdownLive') && html.includes('edit-preview-close'), '普通 Markdown 缺少源码、分栏、实时、阅读模式或可关闭预览');
  assert(html.includes("const show=!SPLIT_EDITORS.length&&['markdown','html'].includes(kind)") && !html.includes("const show=!SPLIT_EDITORS.length&&['markdown','html','latex'].includes(kind)"), 'LaTeX 工作区仍错误显示 Markdown/HTML 视图切换器');
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
  const pdfViewerCss = await fetch(baseUrl + '/assets/pdfjs/pdf_viewer.css');
  const pdfViewerModule = await fetch(baseUrl + '/assets/pdfjs/pdf_viewer.mjs');
  assert(pdfViewerCss.ok && (await pdfViewerCss.text()).includes('.pdfViewer') && pdfViewerModule.ok && (await pdfViewerModule.text()).includes('PDFViewer'), 'PDF.js 官方 Viewer 样式或模块资源无法加载');
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
  const officePort = await freePort();
  let onlyOfficePdfCallbackUrl = '';
  officeStub = http.createServer((req, res) => {
    if (req.url === '/healthcheck') { res.writeHead(200, { 'content-type':'text/plain' }); return res.end('true'); }
    if (req.url === '/web-apps/apps/api/documents/api.js') { res.writeHead(200, { 'content-type':'text/javascript' }); return res.end('window.DocsAPI = window.DocsAPI || {};'); }
    if (req.url === '/saved.pdf') { const bytes=samplePdf('Hello research paper updated by ONLYOFFICE');res.writeHead(200,{'content-type':'application/pdf','content-length':bytes.length});return res.end(bytes); }
    if (req.url.startsWith('/command') || req.url.startsWith('/coauthoring/CommandService.ashx')) { let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{let command={};try{command=JSON.parse(body);}catch(_){}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({error:0,key:command.key||''}));if(onlyOfficePdfCallbackUrl)setTimeout(()=>fetch(onlyOfficePdfCallbackUrl.replace('host.docker.internal','127.0.0.1'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:6,url:'http://127.0.0.1:'+officePort+'/saved.pdf'})}).catch(()=>{}),20);});return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { officeStub.once('error', reject); officeStub.listen(officePort, '127.0.0.1', resolve); });
  const connectedOffice = await postJson(baseUrl, '/api/office/connection', { publicUrl:'http://127.0.0.1:' + officePort, callbackBase:'http://host.docker.internal:' + port, jwtSecret:'codescope-test-secret-123456' });
  assert(connectedOffice.ok && connectedOffice.health.ok && connectedOffice.connection.jwtConfigured && !('jwtSecret' in connectedOffice.connection), 'ONLYOFFICE 连接保存、健康检查或密钥脱敏失败');
  const onlyOfficeEditorConfig = await requestJson(baseUrl, '/api/office/onlyoffice/config?path=' + encodeURIComponent(officeWord.path));
  assert(onlyOfficeEditorConfig.ok && onlyOfficeEditorConfig.config.token && onlyOfficeEditorConfig.config.token.split('.').length === 3 && onlyOfficeEditorConfig.config.document.url.includes('host.docker.internal'), 'ONLYOFFICE JWT 编辑配置或容器回访地址异常');
  const lanOfficeConfig = await requestJsonWithHeaders(baseUrl, '/api/office/onlyoffice/config?path=' + encodeURIComponent(officeWord.path), { Host:'192.0.2.25:' + port });
  assert(lanOfficeConfig.status === 200 && new URL(lanOfficeConfig.data.documentServerUrl).hostname === '192.0.2.25', '局域网浏览器仍会错误连接访问设备自身的 127.0.0.1');
  const connectedProviders = await requestJson(baseUrl, '/api/office/providers/v1');
  assert(connectedProviders.active === 'onlyoffice-docs' && connectedProviders.complete && connectedProviders.providers[0].available, 'ONLYOFFICE 连接后未成为活动编辑内核');
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
  const onlyOfficePdfConfig = await requestJson(baseUrl, '/api/readings/onlyoffice/config?path=' + encodeURIComponent(readingUpload.path));
  assert(onlyOfficePdfConfig.ok && onlyOfficePdfConfig.config.documentType === 'pdf' && onlyOfficePdfConfig.config.document.fileType === 'pdf' && onlyOfficePdfConfig.config.token && onlyOfficePdfConfig.config.editorConfig.callbackUrl.includes('/api/readings/onlyoffice-callback'), 'ONLYOFFICE PDF 编辑配置、JWT 或回写地址异常');
  onlyOfficePdfCallbackUrl = onlyOfficePdfConfig.config.editorConfig.callbackUrl;
  const deniedOnlyOfficePdfFile = await requestJson(baseUrl, '/api/readings/onlyoffice-file?path=' + encodeURIComponent(readingUpload.path) + '&token=invalid', 403);
  const deniedOnlyOfficePdfCallback = await postJson(baseUrl, '/api/readings/onlyoffice-callback?path=' + encodeURIComponent(readingUpload.path) + '&token=invalid', { status:2 }, 403);
  assert(!deniedOnlyOfficePdfFile.ok && deniedOnlyOfficePdfCallback.error === 1, 'ONLYOFFICE PDF 文档或回调接口未拒绝无效令牌');
  const forcedPdfSave = await postJson(baseUrl, '/api/readings/onlyoffice/forcesave', { path:readingUpload.path, key:onlyOfficePdfConfig.config.document.key });
  assert(forcedPdfSave.ok && forcedPdfSave.synced && forcedPdfSave.changed === true, 'ONLYOFFICE PDF 返回阅读器前未等待保存回调和文件回写：' + JSON.stringify(forcedPdfSave));
  const chineseInfo = Buffer.from(JSON.stringify({ name:'paper_中文.pdf', folder:'Research/Papers' })).toString('base64');
  const chineseResponse = await fetch(baseUrl + '/api/readings/upload-stream', { method:'POST', headers:{'Content-Type':'application/pdf','X-CodeScope-Reading':chineseInfo}, body:samplePdf('Chinese paper') });
  const chineseUpload = await chineseResponse.json();
  assert(chineseResponse.ok && chineseUpload.ok, '中文版 PDF 导入失败');
  const note = await postJson(baseUrl, '/api/readings/text/new', { project:'Research/Papers', name:'阅读笔记.md' });
  assert(note.ok && note.kind === 'markdown', '阅读项目 Markdown 片段创建失败');
  const savedNote = await postJson(baseUrl, '/api/readings/text-fragment', { path:note.path, content:'# 结论\n\n测试笔记\n\n[[pdf-ref:'+encodeURIComponent(readingUpload.path)+'#page=1&fragment=f1|定位原文]]' });
  const openedNote = await requestJson(baseUrl, '/api/readings/text-fragment?path=' + encodeURIComponent(note.path));
  assert(savedNote.ok && openedNote.ok && /测试笔记/.test(openedNote.content), '阅读项目文本片段读写失败');
  const readingWordInfo = Buffer.from(JSON.stringify({ name:'参考资料.docx', folder:'Research/Papers' })).toString('base64');
  const readingWordResponse = await fetch(baseUrl + '/api/readings/upload-stream', { method:'POST', headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','X-CodeScope-Reading':readingWordInfo}, body:wordBytes });
  const readingWord = await readingWordResponse.json();
  const readingSheetInfo = Buffer.from(JSON.stringify({ name:'实验数据.xlsx', folder:'Research/Papers' })).toString('base64');
  const readingSheetResponse = await fetch(baseUrl + '/api/readings/upload-stream', { method:'POST', headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','X-CodeScope-Reading':readingSheetInfo}, body:sheetBytes });
  const readingSheet = await readingSheetResponse.json();
  const readingWeb = await postJson(baseUrl, '/api/readings/web/new', { project:'Research/Papers', title:'CodeScope 官网资料', url:'https://example.com/docs?from=codescope' });
  const blockedReadingWebPage = await fetch(baseUrl + '/api/readings/web/page?url=' + encodeURIComponent('http://127.0.0.1/private'));
  assert(blockedReadingWebPage.status === 403, '网页章节导航接口没有阻止本机或私网 SSRF');
  assert(readingWordResponse.ok && readingWord.ok && readingWord.kind === 'docx' && readingSheetResponse.ok && readingSheet.ok && readingSheet.kind === 'sheet', '阅读项目未能导入 DOCX 或 XLSX 资料');
  assert(readingWeb.ok && readingWeb.kind === 'web' && readingWeb.path.endsWith('.url'), '阅读项目网页资料创建失败');
  const readingWebMeta = await postJson(baseUrl, '/api/readings/meta', { path:readingWeb.path, meta:{ page:1, fragments:[{ id:'web-1', page:1, source:'网页摘录', note:'网页笔记', url:'https://example.com/docs/chapter-1.html', webTitle:'第一章', anchor:'section-1', webStart:12, webEnd:16 }] } });
  const loadedReadingWebMeta = await requestJson(baseUrl, '/api/readings/meta?path=' + encodeURIComponent(readingWeb.path));
  assert(readingWebMeta.ok && loadedReadingWebMeta.ok && loadedReadingWebMeta.meta.fragments[0].url.endsWith('/chapter-1.html') && loadedReadingWebMeta.meta.fragments[0].webStart === 12 && loadedReadingWebMeta.meta.fragments[0].webEnd === 16 && loadedReadingWebMeta.meta.fragments[0].note === '网页笔记', '网页摘录、笔记或正文定位元数据未持久化');
  const readingWordFile = await fetch(baseUrl + '/api/readings/file?path=' + encodeURIComponent(readingWord.path));
  assert(readingWordFile.ok && readingWordFile.headers.get('content-type').includes('wordprocessingml') && Buffer.from(await readingWordFile.arrayBuffer()).subarray(0,2).toString() === 'PK', '阅读项目 DOCX 原文件读取或 MIME 类型错误');
  const readingTree = await requestJson(baseUrl, '/api/readings/tree');
  const researchFolder = readingTree.root.children.find((item) => item.path === 'Research');
  const paperProject = researchFolder && researchFolder.children.find((item) => item.path === 'Research/Papers');
  const knowledgeFolder = readingTree.root.children.find((item) => item.path === '知识库');
  const knowledgeCategory = knowledgeFolder && knowledgeFolder.children.find((item) => item.path === '知识库/嵌入式 Linux');
  const knowledgeReadingProject = knowledgeCategory && knowledgeCategory.children.find((item) => item.path === '知识库/嵌入式 Linux/驱动开发');
  assert(readingTree.ok && readingTree.total >= 6 && researchFolder && researchFolder.type === 'folder' && paperProject && paperProject.count === 6 && paperProject.description === '机器人与控制论文' && paperProject.tags.includes('控制') && paperProject.children.every((item) => item.project === 'Research/Papers') && paperProject.children.some((item) => item.role === 'original') && paperProject.children.some((item) => item.role === 'translation') && paperProject.children.some((item) => item.kind === 'markdown') && paperProject.children.some((item) => item.kind === 'docx') && paperProject.children.some((item) => item.kind === 'sheet') && paperProject.children.some((item) => item.kind === 'web'), '阅读文件夹、项目元数据或多类型资料聚合异常');
  assert(knowledgeFolder && knowledgeFolder.type === 'folder' && knowledgeFolder.knowledgeRoot && knowledgeCategory && knowledgeCategory.type === 'folder' && knowledgeReadingProject && knowledgeReadingProject.type === 'project' && knowledgeReadingProject.knowledge && knowledgeReadingProject.children.some((item) => item.type === 'fragment' && item.path === '知识库/嵌入式 Linux/驱动开发/设备驱动.md'), '知识库未按“根文件夹 / 分类 / 项目 / Markdown 片段”层级聚合');
  const readingText = await requestJson(baseUrl, '/api/readings/text?path=' + encodeURIComponent(readingUpload.path));
  assert(readingText.ok && readingText.pageCount === 1 && /Hello research paper/.test(readingText.pages[0]), 'PDF 页级文本提取失败');
  const readingMeta = await postJson(baseUrl, '/api/readings/meta', { path:readingUpload.path, meta:{ page:1, view:'bilingual', translations:{1:'你好，研究论文'}, fragments:[{id:'f1',page:1,source:'research paper',translation:'研究论文',note:'术语'}] } });
  assert(readingMeta.ok && readingMeta.meta.view === 'bilingual' && readingMeta.meta.fragments.length === 1, 'PDF 译文或片段记录保存失败');
  const readingSearch = await requestJson(baseUrl, '/api/readings/search?q=' + encodeURIComponent('测试笔记'));
  const readingWebSearch = await requestJson(baseUrl, '/api/readings/search?q=' + encodeURIComponent('example.com'));
  const pdfFragmentSearch = await requestJson(baseUrl, '/api/readings/search?q=' + encodeURIComponent('research paper'));
  assert(readingSearch.ok && readingSearch.hits.some((item) => item.path === note.path && item.kind === 'text'), '阅读全文搜索未找到 Markdown 笔记');
  assert(readingWebSearch.ok && readingWebSearch.hits.some((item) => item.path === readingWeb.path && item.kind === 'web'), '阅读全文搜索未找到网页资料地址');
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
  const toolchainFiles = [
    { name:'lsp-python.md', language:'python', label:'main.py', code:'value: int = 1\nprint(value)', line:2, column:7, server:'pyright-langserver', unformatted:'items={"a":1}\nprint(items)', formatted:'items = {"a": 1}' },
    { name:'lsp-typescript.md', language:'typescript', label:'main.ts', code:'const value: number = 1\nconsole.log(value)', line:2, column:15, server:'typescript-language-server', unformatted:'const value:number=1\nconsole.log(value)', formatted:'const value: number = 1' },
  ];
  for (const fixture of toolchainFiles) {
    const file = path.join(vault, 'code', fixture.name);
    fs.writeFileSync(file, `---\ncontents:\n  - id: 1\n    label: ${fixture.label}\n    language: ${fixture.language}\nname: ${fixture.name}\nisDeleted: 0\n---\n\n## Fragment: ${fixture.label}\n\`\`\`${fixture.language}\n${fixture.code}\n\`\`\`\n`);
    const hover = await postJson(baseUrl, '/api/lsp/query', { file, fragment:0, code:fixture.code, action:'hover', line:fixture.line, column:fixture.column });
    assert(hover.ok && hover.server === fixture.server && hover.hover, fixture.server + ' 内置运行时查询失败');
    const formatted = await postJson(baseUrl, '/api/format', { file, fragment:0, code:fixture.unformatted, writeBack:false });
    assert(formatted.ok && formatted.formatted.includes(fixture.formatted), fixture.language + ' 内置格式化器运行失败');
    fs.unlinkSync(file);
  }
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
  if (officeStub) officeStub.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
