#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');

const projectRoot = path.resolve(__dirname, '..');
// 版本号只有 package.json 一个来源：测试里硬编码 2.5.0 会让每次发版都误报失败。
const packageVersion = require(path.join(projectRoot, 'package.json')).version;
/* 本机不一定装了 noVNC，但「远程面板 · VNC 会话保持」这条路要测得到 ——
   注入一个假的 RFB 模块（构造后立刻触发 connect），把它当真的用。
   ⚠️ 路由在页面加载**之后**注册也没问题：noVNC 是点「打开 VNC 桌面」时才动态 import 的 ✓。 */
const FAKE_RFB_SRC = `
export default class RFB {
  constructor(target, url, opts) {
    this.target = target; this.url = url; this.opts = opts; this._h = {};
    window.__lastRfb = this;
    setTimeout(() => this.fire('connect', {}), 30);
  }
  addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); }
  removeEventListener(t, fn) { this._h[t] = (this._h[t] || []).filter((x) => x !== fn); }
  disconnect() { this.disconnected = true; }
  sendCredentials() {}
  fire(t, detail) { (this._h[t] || []).forEach((fn) => fn({ detail })); }
}
`;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-browser-'));
const vault = path.join(tempRoot, 'vault');
let server, browser;

function browserExecutable() {
  if (process.env.CODESCOPE_BROWSER && fs.existsSync(process.env.CODESCOPE_BROWSER)) return process.env.CODESCOPE_BROWSER;
  const fixed = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? [path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')]
      : [];
  for (const candidate of fixed) if (fs.existsSync(candidate)) return candidate;
  if (process.platform !== 'win32') for (const command of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try { return execFileSync('which', [command], { encoding:'utf8', timeout:1500 }).trim(); } catch (_) {}
  }
  return '';
}

function freePort() {
  return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(error=>error?reject(error):resolve(port));});});
}

async function waitForServer(url) {
  for(let i=0;i<60;i++){try{if((await fetch(url+'/api/version')).ok)return;}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('浏览器测试服务启动超时');
}

function samplePdfPages(count) {
  const pageCount=Math.max(1,Number(count)||1),fontRef=3+pageCount*2,objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({length:pageCount},(_,index)=>`${3+index*2} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  ];
  for(let index=0;index<pageCount;index++){
    const pageRef=3+index*2,contentRef=pageRef+1,text=`PDF Viewer page ${index+1}`,stream=`BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let index=1;index<=objects.length;index++)pdf+=String(offsets[index]).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function main() {
  const executablePath=browserExecutable();
  if(!executablePath){console.log('CodeScope browser smoke: skipped（未找到 Chrome/Chromium，可用 CODESCOPE_BROWSER 指定）');return;}
 fs.mkdirSync(path.join(vault,'code'),{recursive:true});
  // 标签注册表夹具：9 个标签（>8 会触发筛选框与「显示全部」折叠），供标签面板回归断言使用
  const tagRegDir = path.join(vault, 'code', '.masscode');
  fs.mkdirSync(tagRegDir, { recursive: true });
  fs.writeFileSync(path.join(tagRegDir, 'state.json'), JSON.stringify({
    version: 3, counters: { contentId: 1, folderId: 1, snippetId: 1, tagId: 10 },
    folderIdByPath: {}, folderUi: {}, snippets: [],
    tags: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota'].map((name, i) => ({ createdAt: 1, id: i + 1, name, updatedAt: 1 })),
  }, null, 2));
  const longMarkdown=['# Anchor Sync Guide','',...Array.from({length:36},(_,index)=>`## Section ${index+1}\n\n第 ${index+1} 节包含用于校验源码与预览双向同步的正文。\n\n| 项目 | 值 |\n| --- | --- |\n| 行号 | ${index+1} |`).join('\n\n')].join('\n');
  fs.writeFileSync(path.join(tempRoot,'package.json'),JSON.stringify({name:'codescope-browser-fixture',private:true,scripts:{test:'node -e "process.exit(0)"'}},null,2));
  /* 个人管理面板 · 日记夹具：预置**今天**这一篇，分类「工作」。
     为什么要在起浏览器**之前**写：工作台启动时读一次 store ✓，
     之后再改文件它内存里也不会知道 ✗（要么重开面板、要么走界面 ✓）。
     ⚠️ 正文里放一个**唯一标记** —— 断言「改分类后标记还在」比断言字数可靠得多 ✓。 */
  const jPad = (n) => String(n).padStart(2, '0');
  const jNow = new Date();
  const jToday = jNow.getFullYear() + '-' + jPad(jNow.getMonth() + 1) + '-' + jPad(jNow.getDate());
  const JOURNAL_MARK = '绝对不能被模板覆盖 ABCDEFG';
  fs.mkdirSync(path.join(tempRoot, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'data', 'life-workbench.json'), JSON.stringify({
    version: 1,
    journalCats: ['学习', '工作', '生活', '科研'],
    journal: [{ date: jToday, text: '# 日记夹具\n\n- [ ] 这一行必须活下来\n\n' + JOURNAL_MARK, cat: '工作', at: Date.now() }],
    journalSel: jToday, journalMonth: jToday.slice(0, 7),
  }, null, 2));
 fs.writeFileSync(path.join(vault,'code','reading.md'),`---
contents:
  - id: 1
    label: led.h
    filename: file1.h
    language: c_cpp
  - id: 2
    label: led.c
    filename: file2.c
    language: c_cpp
  - id: 3
    label: README.md
    filename: file3.md
    language: markdown
  - id: 4
    label: demo.html
    language: html
  - id: 5
    label: main.tex
    filename: file5.tex
    language: latex
name: Reading Demo
description: browser regression
isDeleted: 0
tags:
---

## Fragment: led.h
\`\`\`c_cpp
typedef struct led led_t;
led_t *led_create(int pin);
\`\`\`

## Fragment: led.c
\`\`\`c_cpp
#include "led.h"
struct led { int pin; };
led_t *led_create(int pin) {
  static led_t value;
  value.pin = pin;
  return &value;
}
\`\`\`

## Fragment: README.md
\`\`\`markdown
# Reading Demo

在这里维护代码说明。
\`\`\`

## Fragment: demo.html
\`\`\`html
<!doctype html><html><body><h1>Preview Demo</h1></body></html>
\`\`\`

## Fragment: main.tex
\`\`\`latex
\\documentclass{article}
\\begin{document}
CodeScope LaTeX preview
\\end{document}
\`\`\`

`);
  fs.writeFileSync(path.join(vault,'code','markdown-sync.md'),`---
contents:
  - id: 1
    label: README.md
    filename: readme.md
    language: markdown
  - id: 2
    label: Guide.md
    filename: guide.md
    language: markdown
name: Markdown Sync Demo
description: preview identity and scroll regression
isDeleted: 0
tags:
---

## Fragment: README.md
\`\`\`markdown
# First Markdown Document

只允许显示在第一个片段中。
\`\`\`

## Fragment: Guide.md
\`\`\`markdown
${longMarkdown}
\`\`\`
`);
  fs.writeFileSync(path.join(vault,'code','indent.md'),`---
contents:
  - id: 2
    label: main.py
    language: python
name: Indent Demo
description: indent and code hierarchy regression
isDeleted: 0
tags:
---

## Fragment: main.py
\`\`\`python
class Robot:
    def __init__(self, name):
        self.name = name
        self.speed = 0
    def run(self):
        if self.speed > 0:
            print("running")
        return self.speed

r = Robot("x")
print(r.run())
\`\`\`
`);
  const readingProjectDir=path.join(vault,'readings','Block Drag Demo'),readingNotePath=path.join(readingProjectDir,'note.md');
  fs.mkdirSync(readingProjectDir,{recursive:true});
  fs.writeFileSync(path.join(readingProjectDir,'.codescope-project.json'),JSON.stringify({version:1,description:'Markdown block drag regression',tags:['markdown','drag']},null,2));
  const readingReference='[[code-ref:demo.cpp#fragment=0&line=1&end=2|demo.cpp:1–2]]';
  fs.writeFileSync(readingNotePath,'---\ntitle: Block Drag Demo\ntags: [markdown, drag]\n---\n# Block Drag Demo\n\n## Section A\n\nParagraph A.\n\n'+readingReference+'\n\n## Section B\n\n- alpha\n- beta\n- gamma\n\n| 维度 | 堆 | 自由存储区 |\n| --- | --- | --- |\n| 分配 | malloc | new |\n| 释放 | free | delete |\n','utf8');
  const knowledgeImageProjectDir=path.join(vault,'readings','知识库','浏览器测试','图片项目'),knowledgeImageNotePath=path.join(knowledgeImageProjectDir,'图片插入.md');
  fs.mkdirSync(knowledgeImageProjectDir,{recursive:true});
  fs.writeFileSync(path.join(knowledgeImageProjectDir,'.codescope-project.json'),JSON.stringify({version:1,description:'Knowledge image insertion regression',tags:['image']},null,2));
  fs.writeFileSync(knowledgeImageNotePath,'# 图片插入测试\n\n在此区块后插入图片。\n','utf8');
  const pdfProjectDir=path.join(vault,'readings','PDF Viewer Demo');
  fs.mkdirSync(pdfProjectDir,{recursive:true});
  fs.writeFileSync(path.join(pdfProjectDir,'.codescope-project.json'),JSON.stringify({version:1,description:'Official PDF.js viewer regression',tags:['pdf','viewer']},null,2));
  fs.writeFileSync(path.join(pdfProjectDir,'manual.pdf'),samplePdfPages(40));
  const universalProjectDir=path.join(vault,'readings','Universal Reading Demo');
  fs.mkdirSync(universalProjectDir,{recursive:true});
  fs.writeFileSync(path.join(universalProjectDir,'.codescope-project.json'),JSON.stringify({version:1,description:'DOCX and web reader regression',tags:['docx','web']},null,2));
  const readingDocx=new Document({sections:[{children:[new Paragraph({text:'统一资料阅读测试',heading:HeadingLevel.TITLE}),new Paragraph('DOCX 正文可以直接在阅读项目中渲染。')]}]});
  fs.writeFileSync(path.join(universalProjectDir,'guide.docx'),await Packer.toBuffer(readingDocx));
  fs.writeFileSync(path.join(universalProjectDir,'官方文档.url'),'[InternetShortcut]\nURL=https://example.com/guide\n','utf8');
  const readingHtmlPath=path.join(universalProjectDir,'导图.html');
  fs.writeFileSync(readingHtmlPath,'// 导图.html\n','utf8');
  const port=await freePort(),baseUrl='http://127.0.0.1:'+port;
  server=spawn(process.execPath,['server.js'],{cwd:projectRoot,env:{...process.env,CODESCOPE_HOST:'127.0.0.1',CODESCOPE_PORT:String(port),CODESCOPE_VAULT:vault,CODESCOPE_DATA_HOME:path.join(tempRoot,'data'),CODESCOPE_ONLYOFFICE_URL:'http://127.0.0.1:1',CODESCOPE_DSH_AUTOSTART:'0',CODESCOPE_AUTO_OFFICE:'0'},stdio:'ignore'});
  await waitForServer(baseUrl);
  const officeFixtures=[['word','Browser Word'],['sheet','Browser Sheet'],['slides','Browser Slides']];
  for(const [kind,name] of officeFixtures){
    const response=await fetch(baseUrl+'/api/office/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,name,folder:''})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error('Office 测试文档创建失败：'+JSON.stringify(result));
  }
  const officeFolders=await fetch(baseUrl+'/api/office/folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parent:'',name:'Browser Office Folder'})}).then(response=>response.json());
  if(!officeFolders.ok)throw new Error('Office 测试文件夹创建失败：'+JSON.stringify(officeFolders));
  const drawFolderCreated=await fetch(baseUrl+'/api/drawings/new-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dir:'',name:'Browser Draw Folder'})}).then(response=>response.json());
  if(!drawFolderCreated.ok)throw new Error('绘图测试文件夹创建失败：'+JSON.stringify(drawFolderCreated));
  const xmindCreated=await fetch(baseUrl+'/api/drawings/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'xmind',name:'Browser Mind',dir:''})}).then(response=>response.json());
  if(!xmindCreated.ok)throw new Error('XMind 测试文件创建失败：'+JSON.stringify(xmindCreated));
  const detachedRoot={id:'browser-free-root',class:'topic',title:'自由导图',position:{x:310,y:20},structureClass:'org.xmind.ui.logic.right',children:{attached:[{id:'browser-free-a',class:'topic',title:'分支 A',children:{attached:[{id:'browser-free-a1',class:'topic',title:'A.1',children:{attached:[]}}]}},{id:'browser-free-b',class:'topic',title:'分支 B',children:{attached:[]}}]}};
  const detachedRoot2={id:'browser-free-root-2',class:'topic',title:'第二棵自由导图',position:{x:320,y:340},structureClass:'org.xmind.ui.logic.right',children:{attached:[{id:'browser-free-c',class:'topic',title:'很长的多行主题，用于验证节点实际高度不会互相覆盖',children:{attached:[]}},{id:'browser-free-d',class:'topic',title:'分支 D',children:{attached:[]}}]}};
  const detachedRoot3={id:'browser-free-root-3',class:'topic',title:'第三棵自由导图',position:{x:315,y:-270},structureClass:'org.xmind.ui.logic.right',children:{attached:[{id:'browser-free-e',class:'topic',title:'分支 E',children:{attached:[]}}]}};
  xmindCreated.workbook[0].rootTopic.children.attached=[{id:'browser-parent-a',class:'topic',title:'父节点 A',children:{attached:[{id:'browser-movable',class:'topic',title:'可换父级节点',children:{attached:[]}}]}},{id:'browser-parent-b',class:'topic',title:'父节点 B',children:{attached:[]}}];
  xmindCreated.workbook[0].rootTopic.children.detached=[detachedRoot,detachedRoot2,detachedRoot3];
  const xmindSaved=await fetch(baseUrl+'/api/drawings/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:xmindCreated.name,data:{workbook:xmindCreated.workbook}})}).then(response=>response.json());
  if(!xmindSaved.ok)throw new Error('XMind 测试分支保存失败：'+JSON.stringify(xmindSaved));
  browser=await chromium.launch({headless:true,executablePath,args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error.message||error)));
  await page.goto(baseUrl+'/?legacy-editor=1',{waitUntil:'domcontentloaded'});
  await page.route('**/api/study/readable?*',route=>{const requestUrl=new URL(route.request().url()),target=requestUrl.searchParams.get('url')||'';const chapter=target.includes('chapter-2');route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,url:chapter?'https://docs.example.test/chapter-2.html':'https://docs.example.test/start.html',title:chapter?'第二章':'学习网页',html:chapter?'<main><h1>第二章内容</h1><p>阅读视图内导航成功。</p></main>':'<main><h1>学习网页正文</h1><p>公网网址已通过站内阅读视图载入。</p></main>',navigationHtml:'<ol><li><a href="start.html">首页</a></li><li><a href="chapter-2.html">第二章</a></li></ol>',navigationUrl:'https://docs.example.test/toc.html'})});});
  // 注意：传给 waitForFunction 的函数会被序列化到页面里执行，外部变量必须用参数传入。
  await page.waitForFunction((expected)=>{const el=document.querySelector('.brand-version');return !!el&&el.textContent===expected;},'v'+packageVersion+' · Web');
  const versionContract=await page.evaluate(()=>fetch('/api/version').then(response=>response.json()));
  if(versionContract.version!==packageVersion||versionContract.apiRevision<5||versionContract.releaseChannel!=='stable'||versionContract.mode!=='web'||!versionContract.capabilities?.web||versionContract.capabilities?.desktop)throw new Error('v2.4 Web 版本契约异常：'+JSON.stringify(versionContract));
  await page.getByRole('heading',{name:'从一个目标开始'}).waitFor({state:'visible'});
  await page.locator('#knowledge-launch-more').click();
  await page.locator('#knowledge-launch-manage').click();
  await page.locator('#knowledge-center.open').waitFor({state:'visible'});
  const knowledgePanel=await page.evaluate(()=>({engine:document.querySelector('#knowledge-engine').textContent,status:document.querySelector('#knowledge-status').textContent,pageCount:Number(document.querySelector('#knowledge-page-count').textContent),scrollWidth:document.querySelector('.knowledge-panel').scrollWidth,clientWidth:document.querySelector('.knowledge-panel').clientWidth}));
  if(!knowledgePanel.engine.includes('VitePress')||knowledgePanel.pageCount<2||knowledgePanel.scrollWidth>knowledgePanel.clientWidth+1)throw new Error('知识库中心状态、示例文档或布局异常：'+JSON.stringify(knowledgePanel));
  await page.locator('#knowledge-close').click();
  const knowledgeBuild=await fetch(baseUrl+'/api/knowledge/build',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(response=>response.json());
  if(knowledgeBuild.phase!=='ready')throw new Error('浏览器回归中的知识库构建失败：'+JSON.stringify(knowledgeBuild));
  /* 标签面板：标签多时显示筛选框、默认只列 8 个 + 「显示全部」，右键可管理 */
  {
    const tagCounts = await page.evaluate(() => {
      const tagChips = [...document.querySelectorAll('#tagbar .tchip')];
      return {
        filterVisible: !document.getElementById('tag-filter-wrap').classList.contains('hidden'),
        tags: tagChips.filter((node) => !node.classList.contains('tchip-all') && !node.classList.contains('tchip-more')).length,
        total: tagChips.length,
        more: (document.querySelector('#tagbar .tchip-more') || {}).textContent || '',
      };
    });
    if (!tagCounts.filterVisible) throw new Error('标签超过 8 个时应显示筛选框：' + JSON.stringify(tagCounts));
    if (tagCounts.tags !== 8 || tagCounts.total !== 10 || tagCounts.more !== '显示全部（9）') throw new Error('标签栏未折叠为 8 个 + 「显示全部」：' + JSON.stringify(tagCounts));
    await page.locator('#tagbar .tchip-more').click();
    const expandedTags = await page.evaluate(() => ({
      tags: [...document.querySelectorAll('#tagbar .tchip')].filter((node) => !node.classList.contains('tchip-all') && !node.classList.contains('tchip-more')).length,
      more: (document.querySelector('#tagbar .tchip-more') || {}).textContent || '',
    }));
    if (expandedTags.tags !== 9 || expandedTags.more !== '收起') throw new Error('「显示全部」未展开全部标签：' + JSON.stringify(expandedTags));
    await page.locator('#tag-filter').fill('Theta');
    const filteredTags = await page.evaluate(() => [...document.querySelectorAll('#tagbar .tchip')].map((node) => node.textContent.trim()));
    if (filteredTags.length !== 2 || !filteredTags.some((text) => text.startsWith('Theta'))) throw new Error('标签筛选框未按名称过滤：' + JSON.stringify(filteredTags));
    await page.locator('#tag-filter').fill('');
    // 应用里任何滚动都会关闭右键菜单，而实时同步会周期性重渲染；被抢关闭时补点一次再断言
    const openTagMenu = async () => {
      await page.locator('#tagbar .tchip').nth(1).click({ button: 'right' });
      try {
        await page.waitForFunction(() => document.querySelectorAll('#ctx-menu .ctx-item').length > 0, null, { timeout: 2500 });
      } catch (_) {
        await page.locator('#tagbar .tchip').nth(1).click({ button: 'right' });
        await page.waitForFunction(() => document.querySelectorAll('#ctx-menu .ctx-item').length > 0, null, { timeout: 2500 }).catch(() => {});
      }
    };
    await openTagMenu();
    const tagMenu = await page.evaluate(() => [...document.querySelectorAll('#ctx-menu .ctx-item .ctx-label')].map((node) => node.textContent));
    if (!['重命名标签…', '合并到其他标签…', '删除标签'].every((text) => tagMenu.includes(text))) throw new Error('标签右键菜单缺少管理项：' + JSON.stringify(tagMenu));
    await page.keyboard.press('Escape');
  }
  const knowledgePage=await browser.newPage({viewport:{width:1280,height:800}});
  /* 站点根不再有落地页：/knowledge/ 直接跳到一篇文档，不该再看到 hero 和「开始阅读」。 */
  await knowledgePage.goto(baseUrl+'/knowledge/',{waitUntil:'domcontentloaded'});
  await knowledgePage.locator('main h1').first().waitFor({state:'visible'});
  if(await knowledgePage.locator('.VPHero').count())throw new Error('知识库站点根仍是落地页（VPHero 还在）');
  if(/开始阅读|长期积累/.test(await knowledgePage.content()))throw new Error('知识库站点根仍带旧落地页内容');
  if(!await knowledgePage.locator('a.codescope-return[href="/"]').count()||!await knowledgePage.getByRole('button',{name:'搜索知识库'}).count())throw new Error('知识库阅读站缺少返回入口或本地全文搜索');
  const kbPalette=knowledgePage.getByLabel('配色',{exact:true}),kbWidth=knowledgePage.getByLabel('版心',{exact:true}),kbSize=knowledgePage.getByLabel('字号',{exact:true});
  if(!await kbPalette.count()||!await kbWidth.count()||!await kbSize.count())throw new Error('知识库阅读站缺少配色、版心或字号切换器');
  await kbPalette.selectOption('forest');await kbWidth.selectOption('wide');await kbSize.selectOption('large');
  await knowledgePage.waitForFunction(()=>document.documentElement.dataset.kbTheme==='forest'&&document.documentElement.dataset.kbWidth==='wide'&&document.documentElement.dataset.kbSize==='large');
  /* 字号档位必须同时放大正文和标题（标题走 rem，只改 .vp-doc 的 font-size 是不生效的）。 */
  const kbSized=await knowledgePage.evaluate(()=>{
    const doc=document.querySelector('.vp-doc'),h1=document.querySelector('.vp-doc h1');
    return { doc:parseFloat(getComputedStyle(doc).fontSize), h1:parseFloat(getComputedStyle(h1).fontSize) };
  });
  if(!(kbSized.doc>16.5&&kbSized.h1>39))throw new Error('字号档位未同时放大正文与标题：'+JSON.stringify(kbSized));
  await kbSize.selectOption('normal');
  const kbAppearance=await knowledgePage.evaluate(()=>({brand:getComputedStyle(document.documentElement).getPropertyValue('--vp-c-brand-1').trim(),contentWidth:getComputedStyle(document.documentElement).getPropertyValue('--kb-content-width').trim(),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
  if(kbAppearance.brand!=='#49b889'||kbAppearance.contentWidth!=='1080px'||kbAppearance.overflow>1)throw new Error('知识库主题、宽屏版心或响应式布局未生效：'+JSON.stringify(kbAppearance));
  await kbPalette.selectOption('ocean');await kbWidth.selectOption('standard');
  /* 下面这些断言检查的是「一篇具体文档」的版式，所以显式打开指南页，
     不依赖站点根恰好跳到哪一篇。 */
  const kbGuideUrl=baseUrl+'/knowledge/'+['快速开始','使用指南','知识库使用指南'].map(encodeURIComponent).join('/')+'.html';
  await knowledgePage.goto(kbGuideUrl,{waitUntil:'domcontentloaded'});
  await knowledgePage.locator('main h1').filter({hasText:'知识库使用指南'}).waitFor({state:'visible'});
  const kbDocLayout=await knowledgePage.evaluate(()=>{const h2=document.querySelector('.vp-doc h2'),list=document.querySelector('.vp-doc h3 + ul,.vp-doc h3 + ol'),context=document.querySelector('.kb-doc-context');return{context:!!context,progress:!!document.querySelector('.kb-reading-progress'),crumbs:context?.querySelector('.kb-breadcrumb')?.textContent||'',meta:context?.querySelector('.kb-doc-meta')?.textContent||'',section:getComputedStyle(h2,'::before').content,listBorder:list?getComputedStyle(list).borderTopWidth:''};});
  if(!kbDocLayout.context||!kbDocLayout.progress||!kbDocLayout.crumbs.includes('使用指南')||kbDocLayout.crumbs.includes('private›var')||!kbDocLayout.meta.includes('分钟阅读'))throw new Error('知识库正文缺少面包屑、阅读进度、预计阅读时间或路径清理：'+JSON.stringify(kbDocLayout));
  const kbSidebarHierarchy=await knowledgePage.evaluate(()=>{const category=document.querySelector('.VPSidebarItem.level-0 > .item > .text'),project=document.querySelector('.VPSidebarItem.level-1 > .item > .text'),documentText=document.querySelector('.VPSidebarItem.level-2 > .item > .link > .text'),sidebar=document.querySelector('.VPSidebar');return{category:getComputedStyle(category,'::before').content,project:getComputedStyle(project,'::before').content,document:getComputedStyle(documentText,'::before').content,categoryLeft:category.getBoundingClientRect().left,projectLeft:project.getBoundingClientRect().left,documentLeft:documentText.getBoundingClientRect().left,sidebarWidth:sidebar.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};});
  if(!kbSidebarHierarchy.category.includes('分类')||!kbSidebarHierarchy.project.includes('项目')||!kbSidebarHierarchy.document.includes('文')||!(kbSidebarHierarchy.categoryLeft<kbSidebarHierarchy.projectLeft&&kbSidebarHierarchy.projectLeft<kbSidebarHierarchy.documentLeft)||kbSidebarHierarchy.sidebarWidth<280||kbSidebarHierarchy.overflow>1)throw new Error('知识库侧栏分类、项目、文档层级不清晰或桌面宽度不足：'+JSON.stringify(kbSidebarHierarchy));
  await knowledgePage.setViewportSize({width:4500,height:1200});await knowledgePage.waitForTimeout(150);
  const kbWideSidebar=await knowledgePage.evaluate(()=>{const sidebar=document.querySelector('.VPSidebar').getBoundingClientRect(),category=document.querySelector('.VPSidebarItem.level-0 > .item').getBoundingClientRect(),content=document.querySelector('.VPSidebar .nav').getBoundingClientRect();return{sidebar:sidebar.toJSON(),category:category.toJSON(),content:content.toJSON(),paddingLeft:getComputedStyle(document.querySelector('.VPSidebar')).paddingLeft,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};});
  if(kbWideSidebar.paddingLeft!=='24px'||kbWideSidebar.category.left<kbWideSidebar.sidebar.left||kbWideSidebar.category.right>kbWideSidebar.sidebar.right||kbWideSidebar.content.left<kbWideSidebar.sidebar.left||kbWideSidebar.overflow>1)throw new Error('知识库在 4500px 超宽屏下分类树被推出侧栏：'+JSON.stringify(kbWideSidebar));
  const kbWideGroup=await knowledgePage.evaluate(()=>{const sidebar=document.querySelector('.VPSidebar').getBoundingClientRect(),category=document.querySelector('.VPSidebarItem.level-0 > .item').getBoundingClientRect(),article=document.querySelector('.VPDoc > .container > .content').getBoundingClientRect(),aside=document.querySelector('.VPDoc > .container > .aside').getBoundingClientRect(),outline=document.querySelector('.VPDocAsideOutline').getBoundingClientRect();return{canvasCenter:window.innerWidth/2,articleCenter:(article.left+article.right)/2,sidebar:sidebar.toJSON(),category:category.toJSON(),article:article.toJSON(),aside:aside.toJSON(),outline:outline.toJSON(),contentPaddingLeft:getComputedStyle(document.querySelector('.VPContent')).paddingLeft};});
  if(Math.abs(kbWideGroup.canvasCenter-kbWideGroup.articleCenter)>2||Math.abs(kbWideGroup.sidebar.right-kbWideGroup.article.left)>2||Math.abs(kbWideGroup.aside.left-kbWideGroup.article.right)>2||Math.abs(kbWideGroup.category.top-kbWideGroup.outline.top)>2||kbWideGroup.contentPaddingLeft!=='0px')throw new Error('知识库在 4500px 超宽屏下左侧分类、正文与右侧大纲未形成对称三栏：'+JSON.stringify(kbWideGroup));
  /* 超宽屏下正文必须随屏幕放宽：固定 900px 在 4500 的屏上只占五分之一，长句和代码都会折行。 */
  const kbWideContent=await knowledgePage.evaluate(()=>Math.round(document.querySelector('.vp-doc').getBoundingClientRect().width));
  if(!(kbWideContent>1000))throw new Error('知识库在 4500px 超宽屏下正文仍然过窄（未随屏幕放宽）：'+kbWideContent+'px');
  /* 三栏框必须整体居中：正文左右留白要对称。 */
  const kbWideBalance=await knowledgePage.evaluate(()=>{
    const doc=document.querySelector('.vp-doc').getBoundingClientRect();
    return { left:Math.round(doc.x), right:Math.round(window.innerWidth-doc.right) };
  });
  if(Math.abs(kbWideBalance.left-kbWideBalance.right)>4)throw new Error('知识库三栏框没有整体居中（正文左右留白不对称）：'+JSON.stringify(kbWideBalance));
  await knowledgePage.setViewportSize({width:1280,height:800});await knowledgePage.waitForTimeout(100);
  const lastOutline=knowledgePage.locator('.VPDocAsideOutline a.outline-link').filter({hasText:'搜索与定位'});
  await lastOutline.click();
  await knowledgePage.waitForTimeout(350);
  const kbOutlinePosition=await knowledgePage.evaluate(()=>{const target=document.getElementById('搜索与定位'),nav=document.querySelector('.VPNav');return{top:target?.getBoundingClientRect().top??-1,navBottom:nav?.getBoundingClientRect().bottom??0,current:[...document.querySelectorAll('.VPDocAsideOutline a.kb-current')].map(node=>node.textContent.trim()),scrollY:window.scrollY,maxScroll:document.documentElement.scrollHeight-window.innerHeight};});
  if(!kbOutlinePosition.current.includes('搜索与定位')||kbOutlinePosition.top<kbOutlinePosition.navBottom||kbOutlinePosition.top>kbOutlinePosition.navBottom+150)throw new Error('知识库末尾标题点击后未准确定位或大纲高亮错误：'+JSON.stringify(kbOutlinePosition));
  await knowledgePage.close();
  await page.locator('#btn-knowledge-launch').click();
  await page.locator('#knowledge-workspace').waitFor({state:'visible'});
  await page.frameLocator('#knowledge-workspace-frame').locator('main h1').first().waitFor({state:'visible'});
  if(!await page.locator('#btn-knowledge-launch').evaluate(node=>node.classList.contains('on')&&node.getAttribute('aria-pressed')==='true'))throw new Error('知识库内嵌阅读打开后顶栏入口未进入活动状态');
  await page.locator('#knowledge-workspace-back').click();
  await page.locator('#btn-knowledge-launch').click();
  await page.frameLocator('#knowledge-workspace-frame').locator('main h1').first().waitFor({state:'visible'});
  if(!await page.locator('#knowledge-workspace-loading').evaluate(node=>node.classList.contains('hidden')))throw new Error('知识库重复打开后加载遮罩未关闭');
  await page.locator('#knowledge-workspace-manage').click();
  await page.locator('#knowledge-center.open').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.activeElement?.id==='knowledge-close');
  const knowledgeManagerOverlay=await page.evaluate(()=>{const modal=document.querySelector('#knowledge-center'),rect=modal.getBoundingClientRect();return{parent:modal.parentElement?.tagName,width:Math.round(rect.width),height:Math.round(rect.height),viewportWidth:innerWidth,viewportHeight:innerHeight,knowledgeMode:document.body.classList.contains('knowledge-mode'),active:document.activeElement?.id};});
  if(knowledgeManagerOverlay.parent!=='BODY'||knowledgeManagerOverlay.width!==knowledgeManagerOverlay.viewportWidth||knowledgeManagerOverlay.height!==knowledgeManagerOverlay.viewportHeight||!knowledgeManagerOverlay.knowledgeMode||knowledgeManagerOverlay.active!=='knowledge-close')throw new Error('知识库管理窗口没有在当前阅读工作区顶层弹出：'+JSON.stringify(knowledgeManagerOverlay));
  await page.keyboard.press('Escape');
  await page.locator('#knowledge-center').waitFor({state:'hidden'});
  if(await page.evaluate(()=>document.activeElement?.id)!=='knowledge-workspace-manage')throw new Error('关闭知识库管理窗口后焦点未返回管理按钮');
  await page.locator('#knowledge-launch-more').click();
  await page.locator('#knowledge-launch-menu').waitFor({state:'visible'});
  if(await page.locator('#knowledge-launch-menu [role="menuitem"]').count()!==4)throw new Error('知识库打开方式菜单不完整');
  await page.locator('#knowledge-launch-split').click();
  await page.locator('#study-workspace').waitFor({state:'visible'});
  await page.locator('#knowledge-workspace').waitFor({state:'hidden'});
  // 学习工作台的栏位是异步渲染的：等知识库地址真的出现（最多 15s）再断言，避免读到空列表
  await page.waitForFunction(base=>[...document.querySelectorAll('#study-workspace .study-url')].some(node=>node.value.startsWith(base+'/knowledge/')),baseUrl,{timeout:15000}).catch(()=>{});
  const knowledgeSplitUrls=await page.locator('#study-workspace .study-url').evaluateAll(nodes=>nodes.map(node=>node.value));
  if(!knowledgeSplitUrls.some(url=>url.startsWith(baseUrl+'/knowledge/')))throw new Error('知识库分栏未载入同源 VitePress 站点：'+JSON.stringify(knowledgeSplitUrls));
  /* 学习工作台已收进顶栏「编辑工作台」右边的 ⌄ 次级菜单，走真实路径点它。 */
  await page.locator('#workspace-launch-more').click();
  await page.locator('#workspace-launch-study').click();
  await page.waitForTimeout(300);   // 等按压缩放动画结束再量几何（断言不变，只是量稳定态）
  const shellGeometry=await page.evaluate(()=>{const centerNode=document.querySelector('#header-center'),center=centerNode?.getBoundingClientRect(),monitor=document.querySelector('#sysmon')?.getBoundingClientRect(),centerControls=['#btn-vscode','#btn-dsh','#btn-knowledge-launch','#site-menu-trigger'].map(selector=>{const node=document.querySelector(selector),rect=node?.getBoundingClientRect(),style=node&&getComputedStyle(node),label=node?.querySelector('span'),labelRect=label?.getBoundingClientRect();return{selector,height:rect?.height,width:rect?.width,whiteSpace:style?.whiteSpace,display:style?.display,lines:label?.getClientRects().length,labelCenterOffset:labelRect?Math.abs((labelRect.top+labelRect.bottom)/2-(rect.top+rect.bottom)/2):0};});return{viewport:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,nav:document.querySelector('#app-nav')?.getBoundingClientRect().toJSON(),actions:[...document.querySelectorAll('#app-nav .header-action')].map(node=>node.getBoundingClientRect().width),center:center?center.left+center.width/2:null,centerRight:center?.right??null,centerHeight:center?.height,centerControls,monitorLeft:monitor?.left??null,contentVisibility:getComputedStyle(document.querySelector('#list')).contentVisibility};});
  if(shellGeometry.scrollWidth>shellGeometry.viewport+1||!shellGeometry.nav||shellGeometry.actions.some(width=>width<30)||Math.abs(shellGeometry.center-shellGeometry.viewport/2)>1||shellGeometry.monitorLeft<shellGeometry.centerRight||Math.abs(shellGeometry.centerHeight-34)>.1||shellGeometry.centerControls.some(item=>Math.abs(item.height-34)>.1||item.whiteSpace!=='nowrap'||item.lines!==1||item.labelCenterOffset>1)||shellGeometry.centerControls.find(item=>item.selector==='#btn-dsh').width<96)throw new Error('响应式顶栏溢出、DSH 文本未垂直居中、按钮规格不统一、学习入口未居中或状态区未归位：'+JSON.stringify(shellGeometry));
  /* 学习工作台已收进次级菜单：按钮本体必须真的看不见 —— .header-action 自带 display，
     比 UA 对 [hidden] 的 display:none 优先级高，不显式写 CSS 就会「属性是 hidden 但照样显示」。 */
  const studyButtonVisible=await page.evaluate(()=>{const node=document.getElementById('btn-study');return !!node&&node.getBoundingClientRect().width>0&&getComputedStyle(node).display!=='none';});
  if(studyButtonVisible)throw new Error('学习工作台按钮仍显示在顶栏上（应已收进次级菜单）');
  await page.locator('#site-menu-trigger').click();
  await page.locator('#site-menu-panel').waitFor({state:'visible'});
  const siteMenuState=await page.evaluate(()=>{const panel=document.querySelector('#site-menu-panel');const body=document.querySelector('.site-menu-body');const footer=panel.querySelector(':scope>footer');const categories=document.querySelector('#site-menu-categories');return{categories:document.querySelectorAll('#site-menu-categories .site-category').length,count:Number(document.querySelector('#site-menu-count').textContent),panel:panel.getBoundingClientRect().toJSON(),bodyBottom:body.getBoundingClientRect().bottom,footerTop:footer.getBoundingClientRect().top,footerBackground:getComputedStyle(footer).backgroundColor,categoryClient:categories.clientHeight,categoryScroll:categories.scrollHeight};});
  if(siteMenuState.categories<15||siteMenuState.count<120||siteMenuState.panel.left<0||siteMenuState.panel.right>shellGeometry.viewport+1||siteMenuState.bodyBottom>siteMenuState.footerTop+1||siteMenuState.footerBackground.includes('rgba')||siteMenuState.categoryScroll<siteMenuState.categoryClient)throw new Error('网址分类菜单数量、定位、滚动层或底栏遮挡异常：'+JSON.stringify(siteMenuState));
  await page.locator('#site-menu-search').fill('FreeRTOS');
  await page.waitForTimeout(60);
  const siteSearch=await page.locator('#quick-sites .quick-site strong').allTextContents();
  if(siteSearch.length!==1||siteSearch[0]!=='FreeRTOS')throw new Error('网址分类搜索异常：'+JSON.stringify(siteSearch));
  await page.locator('#site-menu-search').fill('');
  await page.locator('#site-menu-add-category').click();
  await page.locator('#study-category-label').fill('机器人学习');
  await page.locator('#study-category-icon').fill('🤖');
  await page.locator('#study-category-save').click();
  await page.locator('#site-menu-categories .site-category').filter({hasText:'机器人学习'}).waitFor({state:'visible'});
  await page.locator('#site-menu-add-site').click();
  await page.locator('#study-bookmark-label').fill('机器人课程');
  await page.locator('#study-bookmark-url').fill('https://robot.example.test/course');
  const customCategory=await page.locator('#study-bookmark-category option').filter({hasText:'机器人学习'}).getAttribute('value');
  await page.locator('#study-bookmark-category').selectOption(customCategory);
  await page.locator('#study-bookmark-save').click();
  await page.locator('#quick-sites .quick-site').filter({hasText:'机器人课程'}).waitFor({state:'visible'});
  await page.locator('#quick-sites .quick-site').filter({hasText:'机器人课程'}).locator('.quick-site-manage').click();
  await page.locator('#study-bookmark-category').selectOption('docs');
  await page.locator('#study-bookmark-save').click();
  await page.locator('#site-menu-categories .site-category[data-category="docs"]').click();
  await page.locator('#quick-sites .quick-site').filter({hasText:'机器人课程'}).waitFor({state:'visible'});
  await page.locator('#quick-sites .quick-site').filter({hasText:'机器人课程'}).dragTo(page.locator(`#site-menu-categories .site-category[data-category="${customCategory}"]`));
  await page.locator('#quick-sites .quick-site').filter({hasText:'机器人课程'}).waitFor({state:'visible'});
  await page.waitForTimeout(850);
  const managedSites=await page.evaluate(()=>fetch('/api/study/config').then((response)=>response.json()));
  if(!managedSites.config.categories.some(category=>category.label==='机器人学习')||!managedSites.config.bookmarks.some(site=>site.label==='机器人课程'&&site.category===customCategory))throw new Error('自定义网址分类、新增网址或拖拽移动未持久化：'+JSON.stringify(managedSites.config));
  await page.locator('#site-menu-close').click();
  await page.setViewportSize({width:760,height:720});await page.waitForTimeout(100);
  const compactGeometry=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,side:document.querySelector('#side').getBoundingClientRect().width,outline:document.querySelector('#outline-panel').getBoundingClientRect().width,welcomeClient:document.querySelector('#workspace-welcome').clientWidth,welcomeScroll:document.querySelector('#workspace-welcome').scrollWidth,outlineLabels:[...document.querySelectorAll('#outline-actions button')].filter(node=>getComputedStyle(node).display!=='none').map(node=>node.textContent.trim())}));
  if(compactGeometry.scrollWidth>compactGeometry.viewport+1||compactGeometry.side>221||compactGeometry.outline>53||compactGeometry.welcomeScroll>compactGeometry.welcomeClient+1||compactGeometry.outlineLabels.some(label=>!label))throw new Error('760px 紧凑布局溢出、快捷页裁切或按钮标签丢失：'+JSON.stringify(compactGeometry));
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#welcome-search').click();
  if(!await page.locator('#search').evaluate(node=>document.activeElement===node))throw new Error('空白工作区搜索快捷入口未聚焦搜索框');
  await page.locator('#welcome-study').click();
  await page.locator('#study-workspace').waitFor({state:'visible'});
  await page.waitForTimeout(300);
  if(!await page.locator('#btn-study').evaluate(node=>node.classList.contains('on')&&node.getAttribute('aria-pressed')==='true'))throw new Error('学习工作台打开后顶栏按钮未进入活动状态');
  /* 学习工作台入口已收进次级菜单：走真实路径（⌄ → 学习工作台）来开关它。 */
  await page.locator('#workspace-launch-more').click();await page.locator('#workspace-launch-study').click();await page.locator('#study-workspace').waitFor({state:'hidden'});
  if(await page.locator('#btn-study').evaluate(node=>node.classList.contains('on')||node.getAttribute('aria-pressed')!=='false'))throw new Error('学习工作台关闭后顶栏按钮仍保持高亮');
  await page.locator('#workspace-launch-more').click();await page.locator('#workspace-launch-study').click();await page.locator('#study-workspace').waitFor({state:'visible'});
  const studyKinds=await page.locator('#study-layout .study-pane').evaluateAll((nodes)=>nodes.map((node)=>node.dataset.kind));
  if(!['browser','code','notes'].every((kind)=>studyKinds.includes(kind)))throw new Error('学习工作台默认三栏未完整创建：'+JSON.stringify(studyKinds));
  if(await page.locator('#study-capture').count())throw new Error('学习工作台仍保留错误的全屏截图按钮');
  const studyBrowser=page.locator('.study-browser').first();
  await page.evaluate(()=>{window.__studyOpened=[];window.open=(url,name,features)=>{window.__studyOpened.push({url,name,features});return{focus(){}};};});
  await page.locator('#study-bookmarks .study-bookmark').filter({hasText:'B站'}).click();
  await studyBrowser.getByText('B站视频学习').waitFor({state:'visible'});
  const biliPopup=await page.evaluate(()=>window.__studyOpened.at(-1));
  if(!biliPopup||!/bilibili\.com/i.test(biliPopup.url)||biliPopup.name!=='codescope-bilibili-browser')throw new Error('顶部 B站入口未打开可登录的一方站点窗口：'+JSON.stringify(biliPopup));
  await studyBrowser.locator('.study-url').first().fill('https://docs.example.test/start.html');await studyBrowser.getByRole('button',{name:'打开',exact:true}).click();
  await studyBrowser.getByText('公网网址已通过站内阅读视图载入。').waitFor({state:'visible'});
  await studyBrowser.locator('.study-readable-nav').getByText('第二章',{exact:true}).click();
  await studyBrowser.getByText('阅读视图内导航成功。').waitFor({state:'visible'});
  await page.locator('#study-preset').selectOption('quad');
  await page.waitForTimeout(250);
  const quadState=await page.evaluate(()=>{const panes=[...document.querySelectorAll('#study-layout .study-pane')].map(node=>({kind:node.dataset.kind,rect:node.getBoundingClientRect().toJSON()}));return{value:document.querySelector('#study-preset').value,panes};});
  const quadXs=new Set(quadState.panes.map(item=>Math.round(item.rect.left/20))),quadYs=new Set(quadState.panes.map(item=>Math.round(item.rect.top/20)));
  if(quadState.value!=='quad'||quadState.panes.length!==4||quadXs.size!==2||quadYs.size!==2||!['browser','code','notes','pdf'].every(kind=>quadState.panes.some(item=>item.kind===kind)))throw new Error('学习工作台四宫格名称、内容或真实几何结构不一致：'+JSON.stringify(quadState));
  const quadBrowser=page.locator('.study-browser').first();await quadBrowser.locator('.study-url').first().fill('https://www.bilibili.com/video/BV1xx411c7mD');await quadBrowser.getByRole('button',{name:'打开',exact:true}).click();await quadBrowser.locator('iframe[title="B站视频播放器"]').waitFor({state:'attached'});
  await quadBrowser.locator('.study-video-time').fill('01:23');await quadBrowser.locator('.study-video-moment').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.study-note-editor')].some(node=>node.value.includes('1:23')&&node.value.includes('t=83')));
  if(!await quadBrowser.locator('.study-video-frame').isVisible())throw new Error('B站播放器未提供定向视频帧记录功能');
  await quadBrowser.locator('.study-bili-browser').click();
  const videoPopup=await page.evaluate(()=>window.__studyOpened.at(-1));
  if(!videoPopup||!/bilibili\.com\/video\/BV1xx411c7mD/i.test(videoPopup.url)||videoPopup.name!=='codescope-bilibili-browser')throw new Error('播放器的 B站浏览按钮未复用第一方视频窗口：'+JSON.stringify(videoPopup));
  const studyNote=page.locator('.study-note-editor').first();
  await studyNote.fill('# Browser Study Note\n\n- video\n- code\n\n[[video:https://www.bilibili.com/video/BV1xx411c7mD|Browser Video]]');
  await page.waitForTimeout(900);
  await page.locator('.study-notes .study-note-head button', { hasText:'阅读' }).first().click();
  await page.locator('.study-note-video iframe').waitFor({ state:'attached' });
  const studyVideoSrc=await page.locator('.study-note-video iframe').getAttribute('src');
  if(!/player\.bilibili\.com\/.+bvid=BV1xx411c7mD/i.test(studyVideoSrc||''))throw new Error('学习工作台视频节点未使用 B站播放器：'+studyVideoSrc);
  const persistedStudyNote=await page.evaluate(()=>fetch('/api/study/note?id=main').then((response)=>response.json()));
  if(!persistedStudyNote.ok||!persistedStudyNote.content.includes('Browser Study Note'))throw new Error('学习工作台 Markdown 笔记未持久化');
  const persistedStudyLayout=await page.evaluate(()=>fetch('/api/study/config').then((response)=>response.json()));
  if(!persistedStudyLayout.ok||!persistedStudyLayout.config.layout)throw new Error('学习工作台布局未持久化');
  await page.locator('#study-back').click();
  await page.locator('#study-workspace').waitFor({state:'hidden'});
  const sidebarMetrics=await page.evaluate(()=>{
    const ids=['tree-head','draw-head','office-head','reading-head'];
    return Object.fromEntries(ids.map(id=>{const node=document.getElementById(id),style=getComputedStyle(node);return[id,{height:node.getBoundingClientRect().height,padding:style.padding,background:style.backgroundImage||style.backgroundColor}];}));
  });
  const sidebarHeights=Object.values(sidebarMetrics).map(item=>item.height);
  if(Math.max(...sidebarHeights)-Math.min(...sidebarHeights)>1)throw new Error('一级侧栏标题高度未统一：'+JSON.stringify(sidebarMetrics));
  if(new Set(Object.values(sidebarMetrics).map(item=>item.padding)).size!==1)throw new Error('一级侧栏标题内边距未统一：'+JSON.stringify(sidebarMetrics));
  await page.locator('#btn-env').click();
  await page.locator('#env-panel.open').waitFor({state:'visible'});
  await page.locator('#env-runtime-list .tool-row').first().waitFor({state:'visible',timeout:10000});
  if(await page.locator('#env-runtime-list .tool-row').count()<5)throw new Error('运行基础检测条目不完整');
  if(await page.locator('#env-client-list .tool-row').count()<8)throw new Error('浏览器能力检测条目不完整');
  /* 元信息现在是键值网格（label 与值分属两个元素），只断言「版本号有显示」这件事本身 */
  if(!(await page.locator('#env-meta').innerText()).includes('v'+packageVersion))throw new Error('环境元信息未显示 v'+packageVersion);
  /* DSH 四个操作按钮（打开 / 启动 / 关闭 / 重启）必须都在，且启动/关闭按状态互斥。
     ⚠️ 先等它脱离 data-state="busy"（启动中）—— 那是瞬态，四个按钮全灰是**正常**的，
     直接断言会把「正在启动」误判成错（实测踩过）。 */
  await page.waitForFunction(()=>{const c=document.getElementById('env-dsh-card');return c&&c.dataset.state!=='busy';},null,{timeout:25000}).catch(()=>{});
  const dshButtons=await page.evaluate(()=>{
    const ids=['btn-env-dsh-open','btn-env-dsh-start','btn-env-dsh-stop','btn-env-dsh-restart'];
    const found=ids.map((id)=>document.getElementById(id));
    if(found.some((node)=>!node))return {missing:ids.filter((id)=>!document.getElementById(id))};
    return {打开:found[0].disabled,启动:found[1].disabled,关闭:found[2].disabled,重启:found[3].disabled,状态:document.getElementById('env-dsh-card').dataset.state};
  });
  if(dshButtons.missing)throw new Error('DSH 操作按钮缺失：'+dshButtons.missing.join(', '));
  if(dshButtons.状态==='busy')throw new Error('DSH 一直停在「启动中」，没能收敛：'+JSON.stringify(dshButtons));
  if(dshButtons.状态==='ok'&&(dshButtons.启动===false||dshButtons.关闭===true))throw new Error('DSH 运行中时按钮状态不对：'+JSON.stringify(dshButtons));
  if(dshButtons.状态!=='ok'&&(dshButtons.启动===true||dshButtons.关闭===false))throw new Error('DSH 未运行时按钮状态不对：'+JSON.stringify(dshButtons));
  if((await page.locator('#env-missing').innerText())!=='1')throw new Error('未连接的 ONLYOFFICE 没有被计为 Office 运行问题');
  if(await page.locator('.env-extensions').getAttribute('open')!==null)throw new Error('按需扩展列表默认未折叠');
  if(!(await page.locator('.env-package-note').innerText()).includes('基础环境')||!(await page.locator('.env-package-note').innerText()).includes('gopls')||!(await page.locator('.env-package-note').innerText()).includes('只使用 ONLYOFFICE'))throw new Error('桌面安装包工具链或 ONLYOFFICE 必选说明缺失');
  /* ---- 云同步面板：校验渲染与降级，不假设本机装了哪些工具 ---- */
  await page.locator('#env-sync-summary').waitFor({state:'visible',timeout:15000});
  await page.waitForFunction(()=>{const node=document.getElementById('env-sync-summary');return node&&!/读取中/.test(node.textContent);},null,{timeout:20000});
  const syncSummary=await page.locator('#env-sync-summary').innerText();
  if(!/云同步/.test(syncSummary))throw new Error('云同步面板标题缺失：'+syncSummary);
  const syncToolRows=await page.locator('#env-sync-tools .tool-row').count();
  if(syncToolRows<3)throw new Error('云同步工具行不完整（Tailscale/Syncthing/restic 应为 3 行）：'+syncToolRows);
  const syncPeerRows=await page.locator('#env-sync-peers .sync-row, #env-sync-peers .env-sync-empty').count();
  if(syncPeerRows<1)throw new Error('云同步对端区域没有任何内容');
  if(!/GitHub/.test(await page.locator('#env-sync-github').innerText()))throw new Error('云同步未显示 GitHub 状态');
  if(!/vault/.test(await page.locator('#env-sync-note').innerText()))throw new Error('云同步未显示 vault 统计');
  if((await page.locator('#btn-env-sync-refresh').count())!==1||(await page.locator('#btn-env-sync-scan').count())!==1||(await page.locator('#btn-env-sync-snapshot').count())!==1)throw new Error('云同步三个操作按钮不完整');
  await page.locator('#btn-env-close').click();
  /* ---- 远程面板：记住上次标签页 + VNC 会话在「收起」后保持 ----
     用户反馈：连上 VNC → 回代码工作区 → 再点「远程」必须重新连 ✗。
     现在「收起」只隐藏画面、不断开；顶栏「远程」直接回到画面 ✓。 */
  await page.route('**/novnc/core/rfb.js',(route)=>route.fulfill({contentType:'application/javascript',body:FAKE_RFB_SRC}));
  await page.route('**/novnc/core/input/keysymdef.js',(route)=>route.fulfill({contentType:'application/javascript',body:'export default {};'}));
  const remoteState=()=>page.evaluate(()=>({
    面板开:document.getElementById('remote-panel').classList.contains('open'),
    画面开:document.getElementById('vnc-workspace').classList.contains('open'),
    标签:['ssh','files','vnc'].find((k)=>document.getElementById('remote-tab-'+k).classList.contains('on')),
    顶栏亮:document.getElementById('btn-remote').classList.contains('remote-on'),
    连接文案:document.getElementById('vnc-connect').textContent,
    VNC状态:document.getElementById('vnc-state').textContent,
    断开:!!(window.__lastRfb&&window.__lastRfb.disconnected),
  }));
  await page.locator('#btn-remote').click();
  await page.locator('#remote-panel.open').waitFor({state:'visible',timeout:10000});
  await page.locator('#remote-tab-vnc').click();
  await page.waitForTimeout(400);
  await page.locator('#btn-remote-close').click();
  await page.waitForTimeout(400);
  await page.locator('#btn-remote').click();
  await page.waitForTimeout(900);
  let rs=await remoteState();
  if(rs.标签!=='vnc')throw new Error('远程面板没记住上次的标签页，重开回到了：'+rs.标签);
  /* 连接（假 RFB 会立刻触发 connect）*/
  await page.locator('#vnc-host').fill('127.0.0.1');
  await page.locator('#vnc-connect').click();
  await page.waitForTimeout(1300);
  rs=await remoteState();
  if(!rs.画面开||rs.VNC状态!=='已连接')throw new Error('VNC 连接后没进入画面：'+JSON.stringify(rs));
  /* ★ 核心一：「收起」只隐藏画面，**不能断开连接** */
  await page.locator('#vnc-close').click();
  await page.waitForTimeout(700);
  rs=await remoteState();
  if(rs.画面开)throw new Error('「收起」没把 VNC 画面藏起来');
  if(rs.断开||!rs.顶栏亮)throw new Error('「收起」把 VNC 连接断开了（应当保持）：'+JSON.stringify(rs));
  /* ★ 核心二：再点顶栏「远程」直接回画面，不重连 */
  await page.locator('#btn-remote').click();
  await page.waitForTimeout(900);
  rs=await remoteState();
  if(!rs.画面开||rs.面板开||rs.VNC状态!=='已连接')throw new Error('再点「远程」没直接回到 VNC 画面：'+JSON.stringify(rs));
  /* 画面里的「远程面板」入口 + 按钮变「回到桌面」；最后用「断开」收尾 */
  await page.locator('#vnc-panel').click();
  await page.waitForTimeout(800);
  rs=await remoteState();
  if(!rs.面板开||rs.标签!=='vnc')throw new Error('画面里的「远程面板」没停在 VNC 页：'+JSON.stringify(rs));
  if(rs.连接文案!=='回到桌面')throw new Error('已连接时按钮应显示「回到桌面」，实际：'+rs.连接文案);
  await page.locator('#vnc-disconnect').click();
  await page.waitForTimeout(1100);
  rs=await remoteState();
  if(!rs.断开)throw new Error('面板里的「断开」没有真正断开 VNC');
  await page.locator('#btn-remote-close').click();
  await page.waitForTimeout(400);
  /* ---- 个人管理面板 · 邮箱收件箱（IMAP 收信）的打桩 ----
     ⚠️ 收信要连真实 IMAP ✗ —— 测试里**绝不能**依赖用户的邮箱和授权码 ✗。
        所以把 /api/life/mail/* 全部打桩 ✓，只验**前端行为**：
        顶栏胶囊未读数、三栏布局、列表、阅读器、sandbox、CSP、附件 ✓。
        IMAP 协议层和 MIME 解码由 tests/mime.js + 真实账号手工验证覆盖 ✓。
     ⚠️ 必须在**面板第一次渲染之前**注册 ✓ —— 顶栏胶囊在面板打开时就要拉账号，
        注册晚了会先显示「未配置」再跳变（断言会不稳）✗。 */
  /* 桩数据：18 封邮件（前 3 封未读、第 1 封标了重要）✓
     —— 18 > 首屏的 15，正好用来验「分批加载」✓ */
  const MAIL_TOTAL = 18;
  const MAIL_UNREAD = 3;
  const mailStubRows = Array.from({ length: MAIL_TOTAL }, (_, i) => {
    const uid = MAIL_TOTAL - i;                       /* 18,17,16…1（新的在前）*/
    return {
      uid,
      subject: uid === MAIL_TOTAL ? '桩主题未读' : ('桩主题 ' + uid),
      fromName: uid === MAIL_TOTAL ? '张三' : ('发件人' + uid),
      fromAddress: (uid === MAIL_TOTAL ? 'z' : ('a' + uid)) + '@qq.com',
      date: Date.now() - i * 3600000,
      size: 1000 + i,
      seen: i >= MAIL_UNREAD,
      flagged: i === 0,
    };
  });
  const MAIL_STUB = {
    accounts: { qq: { host: 'smtp.qq.com', port: '465', user: 'tester@qq.com', hasPass: true, imapHost: 'imap.qq.com', imapPort: '993' } },
    /* `total` 可变 ✓ —— 测试里改它来模拟「来新邮件」，验提醒功能 ✓ */
    total: MAIL_UNREAD,
    /* 故意**中英文系统名都放** ✓ —— 用来验前端的中文化映射 + 「系统文件夹不给删」✓
       ★ 中文那几个是真实账号返回的名字 ✓（163：草稿箱/已发送/已删除/垃圾邮件/病毒文件夹/广告邮件；
         2925：垃圾箱/已发送/已删除/草稿箱）—— 只放英文名的话，中文名的 bug 测不出来 ✗ */
    boxes: { ok: true, boxes: [{ name: 'INBOX', selectable: true }, { name: 'Sent Messages', selectable: true }, { name: 'Drafts', selectable: true }, { name: 'Deleted Messages', selectable: true }, { name: 'Junk', selectable: true }, { name: '草稿箱', selectable: true }, { name: '已发送', selectable: true }, { name: '已删除', selectable: true }, { name: '病毒文件夹', selectable: true }, { name: '广告邮件', selectable: true }, { name: '未识别的文件夹', selectable: true }], inbox: { messages: MAIL_TOTAL, unseen: MAIL_UNREAD } },
    /* ★ 分类管理的桩 ✓ —— 记下每次 move / newbox / delbox 的请求体 ✓
       「一次拖放只发一个 move 请求」这条断言靠它守（曾经发 3 个 ✗，见 bindMail 的注释）✓ */
    moves: [], newboxes: [], delboxes: [],
    /* move 之后「撤销」要用**目标文件夹里的新 UID** ✓（真实服务端会算 ✓）*/
    nextUid: 90000,
    read: { ok: true, uid: MAIL_TOTAL, box: 'INBOX', seen: true, flagged: false, subject: '桩主题未读', from: '张三 <z@qq.com>',
      to: 'tester@qq.com', cc: '', date: Date.now(), size: 2048,
      /* ★ 桩的纯文本故意做成「**空格排版**」✗ —— 这正是真实邮件的情况 ✓
         （实测一封 987 字的纯文本里有 623 个空格、占 63% ✗）。
         它应当被判为**不可用** ✓，从而回退到 HTML 分支 ✓
         —— 也就是同时验到「判据有效」和「HTML 切段正确」两件事 ✓。 */
      text: ' '.repeat(200) + '桩纯文本·空格排版·不该被采用。' + ' '.repeat(200),
      /* 这份 HTML 专门覆盖三段「容易切错」的情况 ✓：
         ① 数字实体 `&#19987;`（=「专」）—— 不解码就会把 `&#19987;` 原样喂给模型 ✗
         ② 表格：同一行的 `<td>` 应连成一行 ✓（以前每格单独成段 ✗，一封邮件切出 44 段 ✗）
         ③ `<br>` 分行：应各自成段 ✓（以前被合并成一大段 ✗） */
      html: '<p>&#19987;&#19994;测试 &amp; 转义</p>'
        + '<table><tr><td>期刊名字</td><td>最新IF</td><td>链接</td></tr>'
        + '<tr><td>ROBOTICA</td><td>2.900</td><td>查看</td></tr></table>'
        + '<div>第一行<br>第二行<br>第三行</div>'
        + '<script>window.__mailPwned = 1;<\/script><img src="https://tracker.invalid/px.gif">',
      attachments: [{ n: 0, index: 2, name: '报告.pdf', type: 'application/pdf', size: 1234 }], inline: [] },
    flagCalls: [],
  };
  await page.route('**/api/life/mail**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/life/mail') {
      if (req.method() === 'POST') {
        try {
          const body = JSON.parse(req.postData() || '{}');
          Object.keys(body.accounts || {}).forEach((k) => {
            const inc = body.accounts[k] || {};
            const old = MAIL_STUB.accounts[k] || {};
            MAIL_STUB.accounts[k] = Object.assign({}, old, inc, { hasPass: !!(inc.pass || old.hasPass) });
          });
        } catch (_) {}
        return json({ ok: true });
      }
      /* ★ 必须**回源**再合并 ✓ —— 下面「邮箱配置从服务端读回」那条用例是从
         **Node 侧**直接 POST 到真实服务的 ✗，不经过 page.route ✗，
         桩看不到它 ✗ → 那条老用例会读回空值 ✗（实测踩过）。
         用 route.fetch() 拿真实响应，再把桩账号并进去 ✓，两边都满足 ✓。 */
      let realAccounts = {};
      try {
        const resp = await route.fetch();
        const j = await resp.json();
        realAccounts = (j && j.accounts) || {};
      } catch (_) {}
      return json({ ok: true, accounts: Object.assign({}, realAccounts, MAIL_STUB.accounts) });
    }
    if (p === '/api/life/mail/status') {
      return json({ ok: true, total: MAIL_STUB.total, accounts: [{ key: 'qq', user: 'tester@qq.com', ok: true, unseen: MAIL_STUB.total, messages: MAIL_TOTAL, latest: { uid: MAIL_TOTAL, subject: '桩新邮件主题', from: '桩发件人 <new@qq.com>', date: Date.now() } }] });
    }
    if (p === '/api/life/mail/boxes') return json(MAIL_STUB.boxes);
    if (p === '/api/life/mail/list') {
      /* ★ 按 limit 截断 ✓（和真实服务端一致）—— 这样才能验「加载更多」真的多拿了 ✓ */
      const q = new URL(req.url()).searchParams;
      const limit = Math.min(120, Math.max(5, Number(q.get('limit')) || 15));
      const onlyUnread = q.get('unread') === '1';
      const onlyFlagged = q.get('flagged') === '1';
      let rows = mailStubRows;
      if (onlyUnread) rows = rows.filter((m) => !m.seen);
      if (onlyFlagged) rows = rows.filter((m) => m.flagged);
      return json({ ok: true, box: 'INBOX', total: MAIL_TOTAL, unseen: MAIL_UNREAD, mails: rows.slice(0, limit) });
    }
    if (p === '/api/life/mail/read') return json(Object.assign({}, MAIL_STUB.read, { uid: Number(new URL(req.url()).searchParams.get('uid')) || MAIL_STUB.read.uid }));
    if (p === '/api/life/mail/flag') {
      try { MAIL_STUB.flagCalls.push(JSON.parse(req.postData() || '{}')); } catch (_) {}
      return json({ ok: true });
    }
    /* ★ 分类管理（移动 / 新建 / 删文件夹）—— 请求体都记下来，供断言用 ✓ */
    if (p === '/api/life/mail/move') {
      let b = {};
      try { b = JSON.parse(req.postData() || '{}'); } catch (_) {}
      /* 真实服务端会算「目标文件夹里的新 UID」✓（撤销要用它 ✗）—— 桩直接发一个 ✓
         ⚠️ 要把 newUid **记进请求记录**里 ✓ —— 断言「撤销用的是新 UID」需要它 ✗
            （只记请求体的话，newUid 是**响应**里的，断言拿不到 ✗）。 */
      const newUid = (MAIL_STUB.nextUid += 2);
      MAIL_STUB.moves.push(Object.assign({}, b, { newUid }));
      return json({ ok: true, uid: b.uid, from: b.box, to: b.to, newUid, subject: '桩主题' });
    }
    if (p === '/api/life/mail/newbox') {
      let b = {};
      try { b = JSON.parse(req.postData() || '{}'); } catch (_) {}
      MAIL_STUB.newboxes.push(b);
      if (b.name && !MAIL_STUB.boxes.boxes.some((x) => x.name === b.name)) {
        MAIL_STUB.boxes.boxes.push({ name: b.name, selectable: true });
      }
      return json({ ok: true, name: b.name });
    }
    if (p === '/api/life/mail/delbox') {
      let b = {};
      try { b = JSON.parse(req.postData() || '{}'); } catch (_) {}
      MAIL_STUB.delboxes.push(b);
      MAIL_STUB.boxes.boxes = MAIL_STUB.boxes.boxes.filter((x) => x.name !== b.name);
      return json({ ok: true, name: b.name });
    }
    return json({ ok: false, error: '测试里没打桩的邮件接口：' + p });
  });
  /* 对照翻译的打桩 ✓ —— 真实实现要连用户自己的模型 ✗（测试里不能依赖它）。
     按输入里的 `[n]` 编号回同样条数的译文 ✓，用来验「编号对齐 + 左右对照渲染」✓。 */
  await page.route('**/api/ai/chat', (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (_) {}
    const user = (body.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const n = (user.match(/^\[\d+\]/gm) || []).length;
    /* 把「发给模型的原文」记到页面上 ✓ —— 断言切段质量要用它 ✓ */
    page.evaluate((u) => { window.__lastAiUser = u; }, user).catch(() => {});
    const content = Array.from({ length: n }, (_, i) => '[' + (i + 1) + ']桩译文第' + (i + 1) + '段').join('\n');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content }) });
  });
  /* ---- 个人管理面板 · 备忘录：逐行实时渲染 + 撤销 + 图片导出 ----
     测试跑在临时 CODESCOPE_DATA_HOME 上，不碰真实数据 ✓
     正文现在和日记一样是「整篇一个 contenteditable、每行一个 div」：
     光标行 = 源码（可编辑），其余行 = 渲染结果（contenteditable=false + data-src）。 */
  await page.locator('#btn-lifework').click();
  await page.locator('#lifework-view').waitFor({state:'visible',timeout:20000});
  await page.locator('[data-tab="memo"]').click();
  /* ⚠️ 临时库里一条备忘录都没有 → 先进的是空态。必须先点「新建」把编辑器叫出来。 */
  await page.locator('#lw-memo-new').click();
  await page.locator('#lw-memo-ce').waitFor({state:'visible',timeout:20000});
  await page.locator('#lw-memo-title').fill('浏览器回归 · 备忘录');
  /* 正文是 contenteditable → 用键盘打字，走真实输入路径 ✓ */
  await page.locator('#lw-memo-ce > .ln').first().click();
  /* 首行用标题语法：行高和普通行不同（27px vs 23.75px），正好用来验行号对齐 ✓ */
  await page.keyboard.type('# 标题行');
  await page.keyboard.press('Enter');
  await page.keyboard.type('同步探针');
  await page.waitForTimeout(800);
  const memoState=()=>page.evaluate(()=>{
    const ce=document.getElementById('lw-memo-ce');
    const lines=ce?[...ce.querySelectorAll(':scope > .ln')]:[];
    return {
      正文:lines.map((e)=>e.getAttribute('contenteditable')==='false'?String(e.dataset.src||''):String(e.textContent||'')).join('\n'),
      可编辑行数:lines.filter((e)=>e.getAttribute('contenteditable')!=='false').length,
      渲染行数:lines.filter((e)=>e.getAttribute('contenteditable')==='false').length,
      列表:[...document.querySelectorAll('[data-memo]')].map((e)=>e.innerText.replace(/\s+/g,' ')),
      撤销可用:!(document.getElementById('lw-memo-undo')||{}).disabled,
      重做可用:!(document.getElementById('lw-memo-redo')||{}).disabled,
      行数:document.querySelectorAll('[data-memo]').length,
    };
  });
  const afterType=await memoState();
  if(!afterType.正文.includes('同步探针'))throw new Error('正文没记下刚打的字：'+JSON.stringify(afterType.正文));
  /* ★ 实时渲染的核心：只有光标所在行可编辑，其余行是渲染结果 */
  if(afterType.可编辑行数!==1)throw new Error('应当只有「光标所在行」可编辑，实际 '+afterType.可编辑行数+' 行可编辑：'+JSON.stringify(afterType.正文));
  if(afterType.渲染行数<1)throw new Error('除光标行外的行应当是渲染结果，实际渲染行数 '+afterType.渲染行数);
  /* 渲染行必须带 data-src —— 读回源码全靠它，丢了就会静默吞内容 */
  const renderedLine=await page.evaluate(()=>{const e=document.querySelector('#lw-memo-ce > .ln[contenteditable="false"]');return e?{cls:e.className,src:e.dataset.src}:null;});
  if(!renderedLine||!renderedLine.src)throw new Error('渲染行没有 data-src，读回源码会丢内容：'+JSON.stringify(renderedLine));
  /* 左栏列表摘要跟着更新（以前要等整屏渲染才追上）*/
  if(!afterType.列表.some((r)=>r.includes('同步探针')))throw new Error('打字后左栏列表摘要没跟上：'+JSON.stringify(afterType.列表));
  if(!afterType.撤销可用)throw new Error('打字后「撤销」仍是灰的（没有可撤销状态）');
  await page.locator('#lw-memo-undo').click();
  await page.waitForTimeout(800);
  const afterUndo=await memoState();
  if(afterUndo.正文.includes('同步探针'))throw new Error('点撤销后内容没回退：'+JSON.stringify(afterUndo.正文));
  if(!afterUndo.重做可用)throw new Error('撤销后「重做」不可用');
  await page.locator('#lw-memo-redo').click();
  await page.waitForTimeout(800);
  if(!(await memoState()).正文.includes('同步探针'))throw new Error('点重做后内容没回来');
  /* 分栏结构必须已经拆掉（改成逐行实时渲染了）*/
  if(await page.locator('#lw-nt-livebody, .lw-nt-split, #lw-md-grip, #lw-memo-body').count())throw new Error('备忘录的「左编辑 / 右预览」分栏结构还在，没换成逐行实时渲染');
  /* 「◫ 源码」开关：打开后整篇都变源码（每行都可编辑）*/
  await page.locator('#lw-nt-live').click();
  await page.waitForTimeout(700);
  const srcMode=await memoState();
  if(srcMode.可编辑行数!==srcMode.正文.split('\n').length)throw new Error('源码模式下所有行都应可编辑：'+JSON.stringify(srcMode));
  await page.locator('#lw-nt-live').click();
  await page.waitForTimeout(700);
  /* 行号：CSS 计数器（伪元素，不进 DOM → 不影响读回源码）*/
  const lineNums=await page.evaluate(()=>[...document.querySelectorAll('#lw-memo-ce > .ln')].map((e)=>getComputedStyle(e,'::before').content));
  if(!lineNums.length||lineNums.some((c)=>!/counter|"\d+"/.test(String(c))))throw new Error('备忘录正文没有渲染出行号：'+JSON.stringify(lineNums));
  /* ★ 行号要和所在行的**首行文字**垂直对齐 —— 不同 markdown 语法行高不同
     （标题 27px / 代码 21.85px / 普通 23.75px）。以前用 line-height:inherit ✗，
     无单位行高会按伪元素**自己的** font-size（10px）重算 → 行号行盒 15px、
     正文行盒 27px，标题行的行号明显偏高 ✗。现在由 ceAlignLineNumbers() 量出来写进 --ln-lh ✓。 */
  /* 先把光标挪到最后一行 —— 否则标题行会以「当前行=源码」的形态出现，量不到它的渲染样式 ✗ */
  await page.locator('#lw-memo-ce > .ln').last().click();
  await page.waitForTimeout(500);
  const lnOffsets=await page.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll('#lw-memo-ce > .ln')){
      const cs=getComputedStyle(el),ps=getComputedStyle(el,'::before');
      const padTop=parseFloat(cs.paddingTop)||0,lineH=parseFloat(cs.lineHeight)||0;
      const top=parseFloat(ps.top)||0,h=parseFloat(ps.height)||0;
      out.push({cls:el.className,off:Math.abs((top+h/2)-(padTop+lineH/2))});
    }
    return out;
  });
  const worstLn=lnOffsets.reduce((m,r)=>Math.max(m,r.off),0);
  if(lnOffsets.length<2||worstLn>1)throw new Error('行号和正文没对齐（最大偏差 '+worstLn.toFixed(1)+'px）：'+JSON.stringify(lnOffsets.map((r)=>[r.cls,Math.round(r.off*10)/10])));
  if(!lnOffsets.some((r)=>/r-h\d/.test(r.cls)))throw new Error('测试正文里应当有标题行，才能验出「不同语法行高不同」的对齐问题');
  /* ★ 行号的**横向**位置也必须一致 —— 绝对定位的 left 是相对 padding box 的，
     而 border-left 在 padding box **之外** ✗：标题 / 引用 / 代码块带 3px 左边框，
     不补偿的话它们的行号会被整体**右移 3px**，和普通行对不齐（用户反馈的就是这个）。
     现在由 ceAlignLineNumbers() 量出边框宽度写进 --ln-bl 做补偿 ✓。 */
  const lnLefts=await page.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll('#lw-memo-ce > .ln')){
      const cs=getComputedStyle(el),ps=getComputedStyle(el,'::before');
      const box=el.getBoundingClientRect();
      const bl=parseFloat(cs.borderLeftWidth)||0,left=parseFloat(ps.left)||0;
      out.push({cls:el.className,bl,left:Math.round((box.left+bl+left)*10)/10});
    }
    return out;
  });
  const lmin=Math.min(...lnLefts.map((r)=>r.left)),lmax=Math.max(...lnLefts.map((r)=>r.left));
  if(lnLefts.length<2||lmax-lmin>0.5)throw new Error('行号横向没对齐（相差 '+(lmax-lmin).toFixed(1)+'px）：'+JSON.stringify(lnLefts));
  if(!lnLefts.some((r)=>r.bl>0))throw new Error('测试正文里应当有带左边框的行（标题/引用），才能验出横向补偿问题');
  /* ★ 行首退格必须「并入上一行」，**绝不能**把内容删光 ——
     contenteditable 里行首退格会让浏览器去合并上一个 contenteditable=false 的渲染行，
     实测按一次就把 4 行变 0 行、空内容还被存进服务端 ✗（数据丢失）。 */
  const beforeBs=await page.evaluate(()=>[...document.querySelectorAll('#lw-memo-ce > .ln')].length);
  if(beforeBs<2)throw new Error('退格回归需要至少两行正文，实际 '+beforeBs);
  const textBeforeBs=(await memoState()).正文;
  /* ⚠️ 光标只能落在「当前行」上；先点最后一行把它变成当前行 ——
     如果当前行本来就是第一行，行首退格**本来就该什么都不做** ✓（别把这条测成 bug ✗）。 */
  await page.locator('#lw-memo-ce > .ln').last().click();
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
    const ce=document.getElementById('lw-memo-ce');
    const el=[...ce.querySelectorAll(':scope > .ln')].find((e)=>e.classList.contains('cur'));
    el.focus();
    const r=document.createRange(); r.selectNodeContents(el); r.collapse(true);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(800);
  const afterBs=await page.evaluate(()=>[...document.querySelectorAll('#lw-memo-ce > .ln')].length);
  if(afterBs===0)throw new Error('行首退格把正文整个清空了（严重数据丢失）');
  if(afterBs!==beforeBs-1)throw new Error('行首退格应当并入上一行（行数 -1），实际 '+beforeBs+' → '+afterBs);
  const textAfterBs=(await memoState()).正文;
  if(textAfterBs.replace(/\s/g,'').length < textBeforeBs.replace(/\s/g,'').length*0.5)throw new Error('行首退格丢了大量内容：'+JSON.stringify(textBeforeBs)+' → '+JSON.stringify(textAfterBs));
  /* ★ 回车必须在**光标处**把当前行切成两半（后半段跟着换行），
     而不是在下面插一个空行 ✗（用户反馈「光标放到文字前面按回车，文字不跟着换行」）。 */
  const beforeEnter=(await memoState()).正文;
  await page.evaluate(()=>{
    const ce=document.getElementById('lw-memo-ce');
    const el=[...ce.querySelectorAll(':scope > .ln')].find((e)=>e.classList.contains('cur'));
    el.focus();
    const tn=el.firstChild;
    const r=document.createRange();
    if(tn&&tn.nodeType===3)r.setStart(tn,Math.min(2,tn.nodeValue.length)); else r.selectNodeContents(el);
    r.collapse(true);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const enterLines=(await memoState()).正文.split('\n');
  if(enterLines.length!==2)throw new Error('光标在行中间按回车应当把该行切成两行，实际 '+enterLines.length+' 行：'+JSON.stringify(enterLines));
  if(enterLines.join('')!==beforeEnter.replace(/\n/g,''))throw new Error('回车切分前后内容对不上（丢字或多字）：'+JSON.stringify(beforeEnter)+' → '+JSON.stringify(enterLines));
  if(enterLines[0]!==beforeEnter.replace(/\n/g,'').slice(0,2))throw new Error('回车没有切在光标处：前半段='+JSON.stringify(enterLines[0])+'，期望='+JSON.stringify(beforeEnter.replace(/\n/g,'').slice(0,2)));
  /* 光标应当落在新行开头：接着打字应插到后半段前面 */
  await page.keyboard.type('插');
  await page.waitForTimeout(600);
  const afterSplitType=(await memoState()).正文.split('\n');
  if(afterSplitType.length!==2||!afterSplitType[1].startsWith('插'))throw new Error('回车后光标没落在新行开头：'+JSON.stringify(afterSplitType));
  /* ★ 拖拽把备忘录移进文件夹 —— 以前只能靠右键菜单里的 prompt ✗，
     用户反馈「无法自由移动到文件夹中归属」。 */
  const folderCount = (name) => page.evaluate((n) => {
    const f = [...document.querySelectorAll('[data-mfolder]')].find((e) => e.dataset.mfolder === n);
    return f ? (Number((f.querySelector('.n') || {}).textContent) || 0) : -1;
  }, name);
  const studyBefore = await folderCount('Study note');
  if (studyBefore < 0) throw new Error('没找到「Study note」文件夹，无法验证拖拽归属');
  await page.locator('[data-memo]').first().dragTo(page.locator('[data-mfolder="Study note"]'));
  await page.waitForTimeout(1200);
  const studyAfter = await folderCount('Study note');
  if (studyAfter !== studyBefore + 1) throw new Error('拖拽后文件夹计数没变：' + studyBefore + ' → ' + studyAfter);
  /* ★★★ 备忘录「依次点开」绝不能写串数据 —— 这条是**数据损坏**级，必须守死 ✗✗
     根因：两条 flush 路径都写成 `memoById(memoSel) || memos.filter(!trash)[0]` ✗ ——
     `memoSel` 为空时（刚进备忘录页、还没点过任何一条）会回落到**列表第一条** ✗，
     而编辑器显示的是另一条 → 把 A 的正文写成 C 的 ✗。
     实测：只要「依次点开三条」，第一条就被第三条覆盖 ✗（用户真实数据就是这么坏的 ✗）。
     现在写盘目标收敛成 memoWriteTarget()：**编辑器显示谁就只能写谁** ✓。
     顺带：**只「打开」不再刷新 edit 时间戳** ✓ → 列表顺序不会因为点一下就变 ✗。 */
  const memoTexts = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.lw-nt-row').forEach((el) => { out[el.dataset.memo] = el.querySelector('.tt').innerText.trim(); });
    return out;
  });
  const listOrder = () => page.locator('.lw-nt-row').evaluateAll((es) => es.map((e) => e.dataset.memo));
  /* ⚠️ 原有 id 要在**创建之前**记 ✗ ——
     创建之后再取的话，`beforeOrder` 里已经有新的三条了，
     `newIds` 会算成空数组 → 清理什么都没删掉 ✗（实测踩过）。 */
  const originalIds = await listOrder();
  /* 造三条内容各不相同的备忘录（用「新建 + 打字」的真实路径 ✓）*/
  const mk = async (text) => {
    await page.locator('#lw-memo-new').click();
    await page.waitForTimeout(900);
    await page.locator('#lw-memo-title').fill(text);
    await page.waitForTimeout(1400);
  };
  await mk('甲甲甲');
  await mk('乙乙乙');
  await mk('丙丙丙');
  await page.waitForTimeout(1500);
  /* ★★★ 关键前置：把 `memoSel` 清空再重新加载 ✗ ——
     写串数据的 bug **只在 memoSel 为空时触发**（那时写盘目标会回落到列表第一条 ✗），
     也就是「刚打开备忘录页、还没点过任何一条」的状态 ✓。
     不造这个前置条件的话，断言会**假通过** ✗（第一版就是这样，回退修复也照样过 ✗，实测踩过）。 */
  await page.evaluate(async (origIds) => {
    const d = (await (await fetch('/api/life/store', { cache: 'no-store' })).json()).data || {};
    d.memoSel = '';
    /* ★★ 还必须让「**插入顺序**的第一条」和「按时间排序的第一条」**不是同一条** ✗✗ ——
       写串的 bug 只在两者不一致时才暴露：
       一致时「回落到 memos[0]」歪打正着正好是对的那条 → 测不出来 ✗
       （我第一版就是这么**假通过**的，回退修复也照样过 ✗，实测踩过）。
       做法：把**原有那条**（插入顺序里的老条目）的 edit 顶到最新 ✓，
       它就排到了列表最上面，而 memos[0] 仍是新建的那条 ✗ → 两者不一致 ✓。 */
    const first = (d.memos || []).find((m) => origIds.includes(m.id));
    if (first) first.edit = Date.now() + 1000;
    await fetch('/api/life/store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
  }, originalIds);
  await page.click('#lw-refresh');
  await page.waitForTimeout(2500);
  await page.click('[data-tab="memo"]');
  await page.waitForTimeout(1500);

  const beforeTexts = await memoTexts();
  const beforeOrder = await listOrder();
  if (Object.keys(beforeTexts).length !== 4) {
    throw new Error('备忘录条数不对（原有 1 条 + 新建 3 条 = 4），实际 ' + Object.keys(beforeTexts).length);
  }
  /* 依次点开每一条（只打开、不改内容）→ 内容和顺序都必须**完全不变** ✗ */
  for (let i = 0; i < 4; i++) {
    await page.locator('.lw-nt-row').nth(i).click();
    await page.waitForSelector('#lw-memo-ce', { timeout: 15000 });
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(1500);
  const afterTexts = await memoTexts();
  for (const id of Object.keys(beforeTexts)) {
    if (afterTexts[id] !== beforeTexts[id]) {
      throw new Error('★ 依次点开备忘录时内容被写串了：' + id + ' 从 ' + JSON.stringify(beforeTexts[id]) + ' 变成 ' + JSON.stringify(afterTexts[id]));
    }
  }
  const afterOrder = await listOrder();
  if (JSON.stringify(afterOrder) !== JSON.stringify(beforeOrder)) {
    throw new Error('★ 只是「打开」备忘录就改变了列表顺序（不该按最新打开排序）');
  }
  /* 清理：把**新建的**三条去掉，回到原有 1 条 ✓
     ⚠️ 判据别写反 ✗ —— `originalIds` 里的是**原有**的，要删的是**不在**里面的 ✓。
     ⚠️ 也**别在 UI 上点右键删** ✗ —— 菜单项选择器、时机都要对，太脆（试了两版都没删掉 ✗）。
        测试环境是隔离的 ✓，**直接改 store + 点「↻ 刷新」强制重读**最确定 ✓。
     ⚠️ 关掉再打开面板**不会**重读（openInPanel 里有 `if (!DATA) load(false)` ✗），
        必须走 `#lw-refresh`（`load(true)`）✓。 */
  const newIds = Object.keys(beforeTexts).filter((id) => !originalIds.includes(id));
  await page.evaluate(async (ids) => {
    const r = await fetch('/api/life/store', { cache: 'no-store' });
    const d = (await r.json()).data || {};
    d.memos = (d.memos || []).filter((m) => !ids.includes(m.id));
    await fetch('/api/life/store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
  }, newIds);
  await page.click('#lw-refresh');
  await page.waitForTimeout(2500);
  await page.click('[data-tab="memo"]');
  await page.waitForTimeout(1500);
  if (Object.keys(await memoTexts()).length !== 1) {
    throw new Error('清理失败：测试结束后应只剩原有的 1 条，实际 ' + Object.keys(await memoTexts()).length);
  }

  /* ★★ 点左栏文件夹必须**真的按文件夹过滤** ——
     用户原话：「我点击测试文件夹没有一个备忘录，怎么左边还是有三个，显示在，没有变」。
     根因：`▦ 全部列表` 模式下 viewMemo 里 `view === "all" || ...` 直接跳过文件夹过滤 ✗，
     而点文件夹只改 `STORE.memoFolder`、没切回文件夹视图 ✗ → 左栏高亮了、列表纹丝不动 ✗。
     现在「点文件夹 = 我要看这个文件夹」→ 顺带切回文件夹视图 ✓。
     ⚠️ 文件夹名不要写死 ✗（测试环境的 STORE.memoFolders 不一定有哪几个），
        直接新建一个空文件夹来当靶子 ✓ 最确定。 */
  page.once('dialog', (d) => d.accept('空文件夹'));
  await page.locator('#lw-nt-addfol').click();
  await page.waitForTimeout(900);
  const emptyFol = '空文件夹';
  if (await folderCount(emptyFol) !== 0) throw new Error('新建的空文件夹计数应为 0，实际 ' + (await folderCount(emptyFol)));
  /* 新建后应当自动跳到这个新文件夹（也是文件夹视图） */
  if ((await page.locator('.lw-nt-list .t1').innerText()).trim() !== emptyFol) throw new Error('新建文件夹后没有跳过去');
  /* 切到「▦ 全部列表」→ 跨文件夹看到全部 */
  await page.locator('[data-mview="all"]').click();
  await page.waitForTimeout(700);
  const allTitle = await page.locator('.lw-nt-list .t1').innerText();
  if (!/全部列表/.test(allTitle)) throw new Error('切到全部列表后标题不对：' + allTitle);
  const allRows = await page.locator('.lw-nt-row').count();
  if (allRows !== 1) throw new Error('全部列表应显示跨文件夹的全部备忘录（此处应为 1 条），实际 ' + allRows + ' 条');
  /* 全部列表视图下每行要显示所属文件夹，否则和文件夹视图看不出区别 */
  if (!/Study note/.test(await page.locator('.lw-nt-row').first().innerText())) {
    throw new Error('全部列表视图下行里没显示所属文件夹：' + (await page.locator('.lw-nt-row').first().innerText()).replace(/\n/g, ' | '));
  }
  /* ★ 就在这个「全部列表」模式下点空文件夹 —— 这正是用户踩的路径：
     必须切回文件夹视图 + 列表变空，而不是继续显示全部 ✗ */
  await page.locator('[data-mfolder="' + emptyFol + '"]').click();
  await page.waitForTimeout(900);
  const folTitle = (await page.locator('.lw-nt-list .t1').innerText()).trim();
  if (folTitle !== emptyFol) throw new Error('点文件夹后标题应变成该文件夹名，实际：' + JSON.stringify(folTitle));
  const folRows = await page.locator('.lw-nt-row').count();
  if (folRows !== 0) throw new Error('点空文件夹后列表应为空（该文件夹 0 条），实际 ' + folRows + ' 条 —— 说明点文件夹没有真的过滤');
  if (await page.locator('.lw-nt-list .lw-nt-empty').count() !== 1) throw new Error('空文件夹没有显示空状态');
  if (!/on/.test(await page.locator('[data-mview="folder"]').getAttribute('class') || '')) {
    throw new Error('点文件夹后没有切回「文件夹视图」（▤ 按钮未选中）');
  }
  /* ★★ 右栏编辑器也必须跟着换 ✗ ——
     以前筛选类操作用 renderMemoList()（只换左栏+中栏、**故意不碰编辑器**），
     于是点了空文件夹、列表空了，右栏**还停在上一条备忘录**上 ✗：
       · 用户看到的是「点了文件夹没反应」
       · 更糟：memoSel 已被清空 → 此时一打字就会写进 STORE.memos[0]（**另一条**）✗✗
     所以这里断言编辑器被清掉（`#lw-memo-ce` 不再存在），而不是还显示着别条的内容 ✓。 */
  if (await page.locator('#lw-memo-ce').count() !== 0) {
    throw new Error('点空文件夹后右栏编辑器还停在上一条备忘录上（应显示空状态）—— 切筛选时必须整屏重建');
  }
  /* 点「iCloud 全部」→ 又能看到全部（1 条） */
  await page.locator('[data-mfolder=""]').click();
  await page.waitForTimeout(700);
  if (await page.locator('.lw-nt-row').count() !== 1) throw new Error('点「iCloud 全部」没有显示全部备忘录');
  /* 回到拖拽后的文件夹，确认那条还在（点文件夹不该动数据） */
  await page.locator('[data-mfolder="Study note"]').click();
  await page.waitForTimeout(700);
  if (await page.locator('.lw-nt-row').count() !== 1) throw new Error('回到「Study note」看不到那条备忘录');
  /* ★ 三栏之间可以左右拖拽调宽（双击竖条恢复默认） */
  const sideWidth = () => page.evaluate(() => Math.round(document.querySelector('.lw-nt-side').getBoundingClientRect().width));
  const sideBefore = await sideWidth();
  const gripBox = await page.locator('[data-mgrip="side"]').boundingBox();
  if (!gripBox) throw new Error('没找到三栏之间的拖拽竖条');
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + 110, gripBox.y + gripBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const sideAfter = await sideWidth();
  if (!(sideAfter > sideBefore + 50)) throw new Error('左栏拖不宽：' + sideBefore + 'px → ' + sideAfter + 'px');
  await page.locator('[data-mgrip="side"]').dblclick();
  await page.waitForTimeout(500);
  const sideReset = await sideWidth();
  if (sideReset !== 172) throw new Error('双击竖条没恢复默认宽度（应为 172px）：' + sideReset + 'px');
  /* 导出为图片：点「图片」**先出分栏预览**，确认后再下载 ✓（不再一点就直接落盘）。
     这条路径踩过 foreignObject 污染画布的坑，所以预览图和下载的 PNG 都要验。 */
  let downloads=0;
  page.on('download',()=>{downloads++;});
  await page.locator('#lw-memo-image').click();
  await page.locator('.lw-img-split').waitFor({state:'visible',timeout:15000});
  await page.waitForFunction(()=>{const i=document.getElementById('lw-memo-img');return i&&i.complete&&i.naturalWidth>0;},null,{timeout:20000});
  const imgPrev=await page.evaluate(()=>{
    const i=document.getElementById('lw-memo-img');
    return {分栏:!!document.querySelector('.lw-img-split'),编辑器还在:!!document.getElementById('lw-memo-ce'),
      宽:i.naturalWidth,高:i.naturalHeight,提示:(document.getElementById('lw-memo-img-note')||{}).textContent,
      下载可用:!(document.getElementById('lw-memo-img-save')||{}).disabled};
  });
  if(!imgPrev.分栏||!imgPrev.编辑器还在)throw new Error('点「图片」没出现「左编辑 / 右预览」分栏：'+JSON.stringify(imgPrev));
  if(imgPrev.宽<400||imgPrev.高<150)throw new Error('预览图尺寸异常：'+imgPrev.宽+'×'+imgPrev.高);
  if(!imgPrev.下载可用)throw new Error('预览出来了但「下载 PNG」不可用');
  if(downloads!==0)throw new Error('点「图片」就直接下载了（应当先出预览）：downloads='+downloads);
  /* 下载 PNG（只有点「下载 PNG」才落盘）*/
  const imgDownload=page.waitForEvent('download',{timeout:30000});
  await page.locator('#lw-memo-img-save').click();
  const imgFile=await imgDownload;
  if(!/\.png$/i.test(imgFile.suggestedFilename()))throw new Error('导出图片的文件名不是 PNG：'+imgFile.suggestedFilename());
  const imgPath=await imgFile.path();
  if(!imgPath)throw new Error('导出图片没有落盘');
  const imgBuf=fs.readFileSync(imgPath);
  if(imgBuf.slice(1,4).toString('latin1')!=='PNG')throw new Error('导出的不是合法 PNG 文件');
  const imgW=imgBuf.readUInt32BE(16),imgH=imgBuf.readUInt32BE(20);
  if(imgBuf.length<3000)throw new Error('导出的 PNG 太小，疑似空白：'+imgBuf.length+' 字节');
  if(imgW<400||imgH<150)throw new Error('导出的 PNG 尺寸异常：'+imgW+'×'+imgH);
  /* 「关闭」回到纯编辑 */
  await page.locator('#lw-memo-img-close').click();
  await page.waitForTimeout(700);
  if(await page.locator('.lw-img-split').count())throw new Error('点「关闭」没回到纯编辑，分栏还在');
  if(!(await page.locator('#lw-memo-ce').count()))throw new Error('关掉图片预览后编辑器不见了');
  /* 删除 → ⌘Z 撤销回来 */
  const beforeDel=(await memoState()).行数;
  await page.locator('#lw-memo-del').click();
  await page.waitForTimeout(1000);
  const afterDel=await memoState();
  if(afterDel.行数!==beforeDel-1)throw new Error('删除后列表条数没变：'+beforeDel+' → '+afterDel.行数);
  await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
  await page.waitForTimeout(1000);
  if((await memoState()).行数!==beforeDel)throw new Error('⌘Z 没能把删除撤销回来');
  /* 工作台开着时打开环境检测 —— 右侧抽屉必须浮在工作台之上。
     （三个抽屉的入口都是**始终可见的顶栏按钮**，面板开着时顶栏还在；
       抽屉 z-index 若低于工作台的全屏浮层，用户点了按钮什么都看不见 ✗ —— 用户反馈过。） */
  await page.locator('#btn-env').click();
  await page.locator('#env-panel.open').waitFor({state:'visible',timeout:10000});
  await page.waitForTimeout(700);
  const drawerAbove=await page.evaluate(()=>{
    const env=document.getElementById('env-panel');
    const r=env.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+80);
    const close=document.getElementById('btn-env-close');
    const cr=close.getBoundingClientRect();
    const chit=document.elementFromPoint(cr.left+cr.width/2,cr.top+cr.height/2);
    return {面板内:!!(hit&&env.contains(hit)),命中:hit?(hit.id||hit.className||hit.tagName):null,关闭可点:!!(chit&&chit.id==='btn-env-close')};
  });
  if(!drawerAbove.面板内)throw new Error('个人管理面板把环境检测挡住了（面板中心命中 '+drawerAbove.命中+'）');
  if(!drawerAbove.关闭可点)throw new Error('环境检测的关闭按钮被个人管理面板挡住，点不到');
  await page.locator('#btn-env-close').click();
  await page.waitForTimeout(500);
  /* ---- 邮箱配置：**从服务端读取** + 按地址自动识别服务商 ----
     ⚠️ 以前前端只 POST 不 GET ✗ —— 保存后一刷新就全变「未配置」，
        用户之前填好的邮箱（服务端 life-mail.json 里明明存着）也读不出来。
     另一条：填了邮箱地址要自动补 SMTP / IMAP（用户要求「自行获取我的谷歌邮箱SMTP」）。 */
  const mailSeed = await fetch(baseUrl + '/api/life/mail', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accounts: { gmail: { user: 'browser-test@gmail.com', host: 'smtp.gmail.com', port: '465', imapHost: 'imap.gmail.com', imapPort: '993', pass: 'app-password' } } }),
  });
  if (!mailSeed.ok) throw new Error('准备邮箱测试配置失败：HTTP ' + mailSeed.status);
  await page.locator('[data-tab="mail"]').click();
  await page.waitForTimeout(2000);
  /* ⚠️ 邮箱页现在默认是**收件箱** ✓，配置字段收在可折叠的「⚙ 账号配置」里 ✓ ——
     要读配置字段就得先展开 ✗（以前配置就是页面主体，所以老用例没这一步 ✗）。 */
  if (await page.locator('[data-mail="gmail"][data-f="user"]').count() === 0) {
    await page.locator('[data-mcfg]').click();
    await page.waitForTimeout(800);
  }
  const mailState = () => page.evaluate(() => {
    const g = (k, f) => { const el = document.querySelector('[data-mail="' + k + '"][data-f="' + f + '"]'); return el ? el.value : null; };
    return {
      gmail: { user: g('gmail', 'user'), host: g('gmail', 'host'), port: g('gmail', 'port'), imapHost: g('gmail', 'imapHost'), imapPort: g('gmail', 'imapPort') },
      密码占位: (document.querySelector('[data-mail="gmail"][data-f="pass"]') || {}).placeholder || '',
    };
  });
  const mailAfter = await mailState();
  if (mailAfter.gmail.user !== 'browser-test@gmail.com') throw new Error('邮箱配置没从服务端读回来（刷新后变「未配置」）：' + JSON.stringify(mailAfter.gmail));
  if (mailAfter.gmail.host !== 'smtp.gmail.com' || mailAfter.gmail.imapHost !== 'imap.gmail.com') throw new Error('邮箱配置的服务器没读回来：' + JSON.stringify(mailAfter.gmail));
  if (!/已保存/.test(mailAfter.密码占位)) throw new Error('服务端已存密码，占位应提示「已保存（留空不改）」：' + mailAfter.密码占位);
  /* 在空卡片里填一个 QQ 地址 → 应自动补 smtp.qq.com / imap.qq.com */
  await page.locator('[data-mail="qq"][data-f="user"]').fill('someone@qq.com');
  await page.waitForTimeout(600);
  const qqAuto = await page.evaluate(() => {
    const g = (f) => { const el = document.querySelector('[data-mail="qq"][data-f="' + f + '"]'); return el ? el.value : null; };
    return { host: g('host'), port: g('port'), imapHost: g('imapHost'), imapPort: g('imapPort') };
  });
  if (qqAuto.host !== 'smtp.qq.com' || qqAuto.port !== '465' || qqAuto.imapHost !== 'imap.qq.com') throw new Error('填地址后没有自动识别服务商：' + JSON.stringify(qqAuto));
  /* ---- 个人管理面板 · 日记：「改分类丢内容」回归 ----
     用户原话：「日记这里有问题，改变分类怎么就丢失了内容」。
     根因有**两个**，缺一不可：
       ① 编辑器取的当前条目 `cur` 是从**分类筛选后**的集合里拿的 ✗ ——
          把这篇改成别的分类后它不再匹配筛选 → cur 变 null → 编辑器渲染**模板** ✗。
       ② 自动保存是 **600ms 防抖** ✗，而改分类会 `render()` 重建整个 DOM ✓ →
          防抖还没触发，刚敲的字就被冲掉 ✗。
     所以这里必须验到「屏幕上」和「落盘里」两个层面 ✓。 */
  await page.locator('[data-tab="journal"]').click();
  await page.locator('#lw-j-ce').waitFor({state:'visible',timeout:20000});
  await page.waitForTimeout(400);
  const journalCeText=()=>page.evaluate(()=>{
    const ce=document.getElementById('lw-j-ce');
    if(!ce)return '';
    return [...ce.querySelectorAll(':scope > .ln')]
      .map((e)=>e.classList.contains('cur')?String(e.textContent||''):String(e.dataset.src||'')).join('\n');
  });
  const journalStore=async()=>{
    const r=await page.evaluate(async()=>{const x=await fetch('/api/life/store',{cache:'no-store'});return x.json();});
    return (r&&r.data)||{};
  };
  const jEntry=(s)=>((s.journal||[]).find((x)=>x.date===jToday))||{};
  /* ① 打开时编辑器必须是**真正文**，不是模板 */
  if(!(await journalCeText()).includes(JOURNAL_MARK)) throw new Error('日记夹具没被读进编辑器（可能显示成了模板）');
  /* ② 改分类 → 正文在屏幕上、在库里都必须还在，且 cat 真的变了 */
  await page.locator('#lw-j-catsel').selectOption('生活');
  await page.waitForTimeout(400);
  if(!(await journalCeText()).includes(JOURNAL_MARK)) throw new Error('改分类后编辑器里的正文丢了（屏幕上）');
  const jS1=await journalStore();
  if(!String(jEntry(jS1).text||'').includes(JOURNAL_MARK)) throw new Error('改分类后落盘的正文丢了（被模板覆盖了？）');
  if(jEntry(jS1).cat!=='生活') throw new Error('改分类没生效，cat='+jEntry(jS1).cat);
  /* ③ 打字后**在同一个同步任务里**立刻改分类（防抖必然没跑完）→ 刚敲的字不能丢
     ⚠️ 别用 page.keyboard.type + selectOption ✗ —— Playwright 的可操作性检查本身耗时 >600ms ✗，
        防抖早跑完了，这条会**假通过** ✗（实测踩过）。 */
  await page.evaluate(()=>{
    const cur=document.querySelector('#lw-j-ce > .ln.cur');
    cur.textContent=String(cur.textContent||'')+' 刚敲的字ZZZ';
    cur.dispatchEvent(new Event('input',{bubbles:true}));
    const sel=document.querySelector('#lw-j-catsel');
    sel.value='科研';
    sel.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(400);
  if(!(await journalCeText()).includes('刚敲的字ZZZ')) throw new Error('防抖未落盘时改分类，刚敲的字在屏幕上丢了');
  const jS2=await journalStore();
  if(!String(jEntry(jS2).text||'').includes('刚敲的字ZZZ')) throw new Error('防抖未落盘时改分类，刚敲的字没落盘');
  if(!String(jEntry(jS2).text||'').includes(JOURNAL_MARK)) throw new Error('第③步把正文覆盖掉了');
  /* ④ 筛选**别的**分类时，编辑器仍显示这一天的真内容（不是模板）*/
  await page.locator('.lw-cats .row[data-jcat="学习"]').click();
  await page.waitForTimeout(400);
  if(!(await journalCeText()).includes(JOURNAL_MARK)) throw new Error('筛选其他分类时编辑器显示成了模板（cur 又受筛选影响了）');
  if(!/不在/.test(await page.locator('#lw-jr-edit h3').innerText())) throw new Error('标题没提示「不在当前筛选内」');
  await page.locator('.lw-cats .row[data-jcat=""]').click();
  await page.waitForTimeout(400);
  if(!(await journalCeText()).includes(JOURNAL_MARK)) throw new Error('取消筛选后正文丢了');
  const jS3=await journalStore();
  if((jS3.journal||[]).filter((x)=>x.date===jToday).length!==1) throw new Error('改分类过程中把这一天写成了多条日记');
  if(jEntry(jS3).cat!=='科研') throw new Error('最终分类不对，cat='+jEntry(jS3).cat);
  /* ---- 个人管理面板 · 邮箱收件箱 ----
     用户要求：「邮箱不是配置放着，我需要的是通过SMTP来进行邮箱的管理和查阅」
     所以这里验的是**真的能查阅**（列表 / 正文 / 附件），不是只有配置卡片 ✓。
     ⚠️ 邮件 HTML 是**不可信内容** ✗ —— sandbox 和 CSP 这两条是安全底线，必须守死 ✓。 */
  await page.locator('[data-tab="mail"]').click();
  await page.waitForTimeout(600);
  /* 上一段用例把配置区展开了 → 这里先收回去，才能验收件箱 ✓ */
  if (await page.locator('.lw-ml-list').count() === 0) {
    await page.locator('[data-mcfg]').click();
    await page.waitForTimeout(600);
  }
  await page.waitForSelector('.lw-ml', { timeout: 20000 });
  if (await page.locator('.lw-ml-side').count() !== 1) throw new Error('邮箱页不是三栏布局（缺左栏账号）');
  if (await page.locator('.lw-ml-list').count() !== 1) throw new Error('邮箱页不是三栏布局（缺邮件列表）');
  if (await page.locator('.lw-ml-read').count() !== 1) throw new Error('邮箱页不是三栏布局（缺阅读区）');
  await page.locator('.lw-ml-item').first().waitFor({ state: 'visible', timeout: 15000 });
  /* ★ 首屏**只取 15 封** ✓ —— 一次取 40 封头部在 QQ 上要 0.4~2.1 秒 ✗
     （瓶颈是服务端**每封**的处理成本），分批取才不卡 ✓ */
  if (await page.locator('.lw-ml-item').count() !== 15) {
    throw new Error('首屏邮件条数不对（桩有 18 封，首屏应取 15 封，实际 ' + await page.locator('.lw-ml-item').count() + '）');
  }
  if (await page.locator('.lw-ml-item.unread').count() !== 3) throw new Error('未读标记不对（应有 3 封未读）');
  /* ★ 文件夹名要**中文化** ✓（桩里全是英文系统名）*/
  const boxLabels = await page.locator('.lw-ml-box').evaluateAll((els) => els.map((e) => ({ label: e.innerText.replace(/\n/g, ' ').trim(), title: e.getAttribute('title') || '' })));
  const hasBox = (cn) => boxLabels.some((b) => b.label.startsWith(cn));
  if (!hasBox('收件箱')) throw new Error('文件夹名没中文化：没有「收件箱」');
  if (!hasBox('已发送')) throw new Error('Sent Messages 没映射成「已发送」：' + boxLabels.map((b) => b.label).join(' / '));
  if (!hasBox('草稿箱')) throw new Error('Drafts 没映射成「草稿箱」');
  if (!hasBox('已删除')) throw new Error('Deleted Messages 没映射成「已删除」');
  if (!hasBox('垃圾邮件')) throw new Error('Junk 没映射成「垃圾邮件」');
  if (!boxLabels.some((b) => b.label.startsWith('未识别的文件夹'))) throw new Error('认不出的文件夹名不该被改写（应原样显示）');
  const sentBox = boxLabels.find((b) => b.label.startsWith('已发送'));
  if (!/Sent Messages/.test(sentBox.title)) throw new Error('中文名上应保留原文（title）：' + sentBox.title);
  /* ★★★ 分类管理：系统文件夹**不给删** ✗，自建的才给 ✕ ✓
     —— 上一版只认**英文**系统名 ✗，而真实账号（163 / 2925）返回的是中文 ✗
        （草稿箱 / 已发送 / 已删除 / 垃圾邮件 / 病毒文件夹 / 广告邮件 / 垃圾箱）✗
        → 系统文件夹上也被画了 ✕ ✗（用户报的「系统文件夹不给删」没生效）✗
     桩里中英文都放了 ✓，所以两种名字都必须判成系统文件夹 ✓。 */
  for (const n of ['Sent Messages', 'Drafts', 'Deleted Messages', 'Junk', '草稿箱', '已发送', '已删除', '病毒文件夹', '广告邮件']) {
    if (await page.locator('[data-mbox="' + n + '"]').count() !== 1) throw new Error('文件夹没显示出来：' + n);
    if (await page.locator('[data-mbox="' + n + '"] [data-mboxdel]').count() !== 0) {
      throw new Error('系统文件夹不该有删除 ✕：' + n);
    }
  }
  if (await page.locator('[data-mbox="INBOX"] [data-mboxdel]').count() !== 0) throw new Error('收件箱不该有删除 ✕');
  /* ★ 同名不能撞 ✗ —— 163 同时有「垃圾邮件」和「广告邮件」，
     都映射成「垃圾邮件」的话左栏会出现**两行同名** ✗，用户分不清哪个是哪个 ✗。 */
  const advLabel = (await page.locator('[data-mbox="广告邮件"] .nm').innerText()).trim();
  if (advLabel !== '广告邮件') throw new Error('广告邮件被映射成了别的名字（和垃圾邮件撞名）：' + advLabel);
  const junkRows = await page.locator('.lw-ml-box[data-mbox] .nm').evaluateAll((els) => els.map((e) => e.innerText.trim()).filter((t) => t === '垃圾邮件').length);
  if (junkRows !== 1) throw new Error('左栏出现 ' + junkRows + ' 行「垃圾邮件」（应只有 1 行）');
  /* 用户自己建的分类**可以**删 ✓（否则「分类管理」根本没法用 ✗）*/
  if (await page.locator('[data-mboxdel="未识别的文件夹"]').count() !== 1) throw new Error('自建文件夹应该有删除 ✕');
  /* ＋ 新建文件夹入口 ✓ */
  if (await page.locator('#lw-ml-newbox').count() !== 1) throw new Error('左栏没有「＋ 新建文件夹」入口');
  /* 文件夹行要能当**拖放目标** ✓（提示里写明「可把邮件拖到这里」）*/
  if (!/拖/.test((await page.locator('[data-mbox="INBOX"]').getAttribute('title')) || '')) {
    throw new Error('文件夹行没有提示「可把邮件拖到这里」');
  }
  /* 邮件行要能拖 ✓（拖到文件夹 = 移动分类）*/
  if (!(await page.locator('.lw-ml-item').first().evaluate((el) => el.draggable === true))) {
    throw new Error('邮件行不可拖动（分类管理的主路径）');
  }
  /* ★ 「加载更多」—— 18 封，首屏 15，点一次应到 18 ✓ */
  if (await page.locator('#lw-ml-more').count() !== 1) throw new Error('没有「加载更多」');
  await page.locator('#lw-ml-more').click();
  await page.waitForFunction(() => document.querySelectorAll('.lw-ml-item').length > 15, null, { timeout: 15000 });
  if (await page.locator('.lw-ml-item').count() !== 18) {
    throw new Error('「加载更多」没有多取邮件（应到 18，实际 ' + await page.locator('.lw-ml-item').count() + '）');
  }
  /* ★ ⭐ 重要筛选（\Flagged）*/
  if (await page.locator('#lw-ml-star').count() !== 1) throw new Error('工具栏没有 ⭐ 重要筛选');
  await page.locator('#lw-ml-star').click();
  await page.waitForTimeout(800);
  const starItems = await page.locator('.lw-ml-item').count();
  const starMarks = await page.locator('.lw-ml-item .star').count();
  if (starItems !== 1 || starMarks !== 1) throw new Error('⭐ 筛选结果不对（应只有 1 封重要、且带星标，实际 ' + starItems + '/' + starMarks + '）');
  await page.locator('#lw-ml-star').click();
  await page.waitForTimeout(800);
  if (await page.locator('.lw-ml-item').count() !== 18) throw new Error('取消 ⭐ 筛选后没恢复全部列表');
  /* 打开一封 → 阅读器 */
  /* ★ 打开邮件前先记下顶栏未读数 —— 打开后应当**立刻减 1** ✓
     （以前是打开后去 force 刷新 status ✗：那会对每个账号各开一条 IMAP 连接，
      本机到 gmail 还要等 15 秒超时 ✗，只为把数字减 1，完全不值 ✗；
      现在是本地改 + 重画胶囊 ✓，服务端缓存到期后会自然校正 ✓）*/
  const badgeNum = async () => {
    const t = await page.locator('#lw-mb').innerText();
    const m = /(\d+)/.exec(t);
    return m ? Number(m[1]) : -1;
  };
  const unreadBefore = await badgeNum();
  if (unreadBefore !== 3) throw new Error('顶栏未读数应为桩里的 3，实际 ' + unreadBefore);
  await page.locator('.lw-ml-item').first().click();
  await page.locator('.lw-ml-rhd .subj').waitFor({ state: 'visible', timeout: 15000 });
  /* ★ 立刻验一次 ✗ —— 别拖到几百行之后再验 ✗（那样会被后面的步骤干扰，查不清是谁弄的 ✗）*/
  if (await badgeNum() !== unreadBefore - 1) {
    throw new Error('打开一封未读邮件后顶栏未读数应立刻减 1（' + unreadBefore + ' → ' + await badgeNum() + '）');
  }
  /* ★★★ 再点一下「邮箱」页签**不能**把它冲回去 ✗✗ ——
     用户原话：「窗口无法拖拽，下面一大半都是空白」（这个是自检时顺带抓出来的 ✗）。
     根因链：切页签 → `loadMailAccounts(true)`（强制）→ 账号没变 →
     `else mailLoadStatus(false)` 重新拉 → 服务端**缓存还是 60 秒内的旧值** ✗
     → `MAIL_STATUS = d` 把**本地刚减掉的数冲回去** ✗。
     修法：只有「一次都还没拿到未读数」时才顺手拉 ✓。
     ⚠️ 页签按钮要限定在 `.lw-nav` 里 ✗（主程序那边也有 [data-tab] ✗）。 */
  await page.locator('.lw-nav [data-tab="mail"]').dispatchEvent('click');
  await page.waitForTimeout(2500);
  if (await badgeNum() !== unreadBefore - 1) {
    throw new Error('★ 再点一次「邮箱」页签后未读数被冲回去了（应还是 ' + (unreadBefore - 1) + '，实际 ' + await badgeNum() + '）');
  }
  if (!(await page.locator('.lw-ml-rhd .subj').innerText()).includes('桩主题未读')) throw new Error('阅读区主题不对');
  if (!(await page.locator('.lw-ml-rhd .meta').innerText()).includes('tester@qq.com')) throw new Error('阅读区没显示收件人');
  if (await page.locator('.lw-ml-att').count() !== 1) throw new Error('附件清单没显示');
  if (!(await page.locator('.lw-ml-att').first().innerText()).includes('报告.pdf')) throw new Error('附件名不对');
  /* ★ 安全底线一：正文走 sandbox iframe，且不带 allow-scripts */
  const mailFrame = page.locator('iframe.lw-ml-frame');
  if (await mailFrame.count() !== 1) throw new Error('HTML 正文没有用 iframe 隔离');
  const mailSandbox = await mailFrame.getAttribute('sandbox');
  if (mailSandbox === null || /allow-scripts/.test(mailSandbox)) throw new Error('正文 iframe 的 sandbox 不安全：' + mailSandbox);
  /* ★ 安全底线二：<script> 被剥掉、远程图片被 CSP 挡住 */
  const mailDoc = await mailFrame.getAttribute('srcdoc');
  if (/<script/i.test(String(mailDoc))) throw new Error('正文里的 <script> 没有被剥掉');
  if (/img-src[^;]*https?:/i.test(String(mailDoc))) throw new Error('默认没有屏蔽远程图片（追踪像素会回传）');
  const mailBodyText = await page.frameLocator('iframe.lw-ml-frame').locator('body').innerText();
  if (!mailBodyText.includes('专业测试')) throw new Error('iframe 里没渲染出正文：' + JSON.stringify(mailBodyText.slice(0, 80)));
  /* 桩里的 script 若真跑了会留下全局标记 ✓（双保险） */
  if (await page.evaluate(() => window.__mailPwned === 1)) throw new Error('邮件里的脚本真的执行了');
  if (await page.locator('[data-mimg]').count() !== 1) throw new Error('没有「显示图片」按钮');
  /* ★ 对照翻译 ✓ —— 原文 / 译文左右并排，段落按编号一一对应 ✓
     ⚠️ 翻译读的是 localStorage['mc-ai-cfg']（=「本机管家 → AI」那份配置）✗，
        测试浏览器里是空的 → 只会提示「还没配置 AI」✗，看起来像「翻译没实现」✗。
        所以要先注入一份假配置 ✓（url 指向死地址没关系，/api/ai/chat 已经打桩了 ✓）。 */
  await page.evaluate(() => {
    try { localStorage.setItem('mc-ai-cfg', JSON.stringify({ url: 'http://127.0.0.1:9/dead', key: 'k', model: 'm' })); } catch (_) {}
  });
  if (await page.locator('#lw-ml-tr').count() !== 1) throw new Error('阅读区没有「对照翻译」按钮');
  await page.locator('#lw-ml-tr').click();
  await page.locator('.lw-ml-tr .pane.trans .p').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(500);
  /* ★ 左边必须**保持邮件原本的样子** ✗ —— 用户原话「应该保持原本邮箱的样子」。
     以前左列是把正文剥成纯文本再逐段列出来 ✗（等于重新排版，标题/表格全没了、
     行还会被粘在一起 ✗）。现在左边直接原样渲染整封邮件 ✓，右边才是译文 ✓。 */
  if (await page.locator('.lw-ml-tr .pane.origin iframe').count() !== 1) {
    throw new Error('对照视图左边不是「原样渲染的邮件」（应该是 sandbox iframe）');
  }
  const srcSandbox = await page.locator('.lw-ml-tr .pane.origin iframe').getAttribute('sandbox');
  if (srcSandbox === null || /allow-scripts/.test(srcSandbox)) throw new Error('原文 iframe 的 sandbox 不安全：' + srcSandbox);
  const trRows = await page.locator('.lw-ml-tr .pane.trans .p').count();
  if (trRows < 2) throw new Error('译文没有按段落切开（桩正文有 2 段，实际 ' + trRows + ' 段）');
  const trFirst = await page.locator('.lw-ml-tr .pane.trans .p').first().innerText();
  if (!/桩译文第1段/.test(trFirst)) throw new Error('译文列内容不对：' + trFirst);
  if (await page.locator('.lw-ml-tr .pane.trans .pending').count() !== 0) throw new Error('还有段落没译完（占位省略号还在）');
  /* ★ 切段质量也要验 ✗ —— 这三条都是实测踩过的坑 ✓。
     模型收到的 user 消息就是切好的原文 ✓，AI 桩把它回显到 window.__lastAiUser 上 ✓ */
  const sentUser = await page.evaluate(() => window.__lastAiUser || '');
  if (/&#\d+;|&#x[0-9a-fA-F]+;/i.test(sentUser)) {
    throw new Error('★ 发给模型的原文里还有**未解码的 HTML 实体**：' + sentUser.slice(0, 120));
  }
  if (!/专业测试/.test(sentUser)) throw new Error('★ 数字实体没解码成中文：' + sentUser.slice(0, 120));
  if (/桩纯文本/.test(sentUser)) {
    throw new Error('★ 采用了「空格排版的纯文本」✗（应判定不可用、回退到 HTML）：' + sentUser.slice(0, 120));
  }
  if (!/ROBOTICA \| 2\.900 \| 查看/.test(sentUser)) {
    throw new Error('★ 表格没按行合并（应「ROBOTICA | 2.900 | 查看」一行）：' + sentUser.slice(0, 200));
  }
  if (!/期刊名字 \| 最新IF \| 链接/.test(sentUser)) {
    throw new Error('★ 表头没合并成一行：' + sentUser.slice(0, 200));
  }
  const brParas = (sentUser.match(/^\[\d+\]\s*(第一行|第二行|第三行)\s*$/gm) || []).length;
  if (brParas < 3) throw new Error('★ `<br>` 分行的内容没各自成段（只找到 ' + brParas + ' 段）：' + sentUser.slice(0, 200));
  /* ★ 左边不能是「被重新排版的纯文本段落」✗ —— 那是以前的问题 */
  if (await page.locator('.lw-ml-tr .row').count() !== 0) throw new Error('对照视图里还有旧的「逐段纯文本」结构（应该已改成左边原样渲染）');
  /* 再点一次收起 → 回到原文 ✓（缓存，不重新请求 ✓）*/
  await page.locator('#lw-ml-tr').click();
  await page.waitForTimeout(400);
  if (await page.locator('.lw-ml-tr').count() !== 0) throw new Error('再点「对照中」没有收起回原文');
  /* ★ 邮箱三栏要能**左右拖动调宽** ✗ —— 用户报「怎么没有左右自由拖动功能」。
     和备忘录那套一致：拖动改宽度、松手存 STORE、双击恢复默认 ✓ */
  if (await page.locator('[data-mlgrip]').count() !== 2) {
    throw new Error('邮箱页没有两条拖拽条（账号栏后 / 列表后），实际 ' + await page.locator('[data-mlgrip]').count());
  }
  const mlWidth = async (sel) => Math.round((await page.locator(sel).boundingBox()).width);
  /* ⚠️ 这里**不能**用 `page.mouse.down/move/up` 做真实拖动 ✗ ——
     实测：跑到这一段时 Playwright 的鼠标移动**不会投递 mousemove 事件** ✗
     （计数只有 1 次而不是 10 次 ✗），拖不动 ✗；
     而同一个 handler 用**合成事件**调是好的 ✓（330 → 440 ✓）。
     所以这是测试环境的投递问题，不是产品问题 ✗ ——
     真实鼠标拖动的验证放在独立探针里做（那个是好的 ✓）。
     这里改成派发真实的 mousedown/mousemove/mouseup ✓：
     走的是**同一套 handler** ✓，一样能守住「拖拽条没了 / 目标找错 / 上下限写错」这些回归 ✓。 */
  const mlDrag = async (which, dx) => page.evaluate(({ w, d }) => {
    const grip = document.querySelector('[data-mlgrip="' + w + '"]');
    const pane = w === 'side' ? document.querySelector('.lw-ml-side') : document.querySelector('.lw-ml-list');
    const b = grip.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const before = Math.round(pane.getBoundingClientRect().width);
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + d, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx + d, clientY: cy }));
    return { before, after: Math.round(pane.getBoundingClientRect().width) };
  }, { w: which, d: dx });
  const mlList0 = await mlWidth('.lw-ml-list');
  const mlListDrag = await mlDrag('list', 110);
  if (!(mlListDrag.after > mlList0 + 60)) {
    throw new Error('邮箱邮件列表拖不宽：' + mlList0 + ' → ' + mlListDrag.after);
  }
  const mlSide0 = await mlWidth('.lw-ml-side');
  const mlSideDrag = await mlDrag('side', 90);
  if (!(mlSideDrag.after > mlSide0 + 50)) {
    throw new Error('邮箱账号栏拖不宽：' + mlSide0 + ' → ' + mlSideDrag.after);
  }
  if (!(await mlWidth('.lw-ml-read') > 240)) throw new Error('拖动后阅读区被挤没了');
  /* ═══ ★★★ 「全高面板」必须真正填满内容区 ═══════════════════════════════
     用户原话：「窗口无法拖拽，下面一大半都是空白」。
     根因：邮箱面板 `.lw-ml` 只写了 `flex:1` ✗，而它的父级 `.lw-main` 是
     **display:block** ✗ → `flex:1` 完全不起作用 ✗ → 面板高度由**内容**决定 ✗
     （实测只有 545px，而内容区 846px ✗）→ 底下留 **301px 空白** ✗，
     窗口越高越夸张 ✗（1600×1200 时是 **501px** ✗）。
     而且**两条拖拽条也只有 545px 高** ✗ → 用户在空白那一段里抓不到它 ✗，
     看着就像「拖不动」✗（其实是那儿根本没东西可抓 ✗）。
     备忘录 / 日记是另一套毛病：`calc(100vh - 250px)` 这种**魔数** ✗，差 46~61px ✗。
     ⚠️ 量的时候**必须减掉 `.lw-main` 的上下 padding** ✗ ——
        那是**有意的留白** ✓（16 + 28），不减的话会误报 ✗（第一版就误报了一次 ✗）。 */
  const fillGap = async (tab, paneSel) => {
    /* ⚠️ 要限定在**工作台的左栏**里 ✗ —— 主程序那边也有 [data-tab] ✗，
       不加限定可能点到别的元素上 ✗（实测 [data-tab] 能匹配到 11 个 ✗）。 */
    await page.locator('.lw-nav [data-tab="' + tab + '"]').dispatchEvent('click');
    await page.waitForTimeout(1200);
    return page.evaluate((sel) => {
      const mainEl = document.querySelector('.lw-main');
      if (!mainEl) return { err: '没有 .lw-main' };
      const cs = getComputedStyle(mainEl);
      const mb = mainEl.getBoundingClientRect();
      const contentH = mb.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const contentBottom = mb.bottom - parseFloat(cs.paddingBottom);
      const pane = document.querySelector(sel);
      if (!pane) return { err: '找不到面板 ' + sel };
      const pb = pane.getBoundingClientRect();
      return {
        fill: mainEl.className.split(/\s+/).includes('fill'),
        面板高: Math.round(pb.height),
        底部空白: Math.round(contentBottom - pb.bottom),
      };
    }, paneSel);
  };
  /* ⚠️⚠️ 量之前必须先把窗口**撑高** ✗✗ ——
     桩里的文件夹（11 个）和邮件（18 封）比真机多 ✗，
     窗口只有 900 高时，**面板内容本身就超过容器** ✗ → 根本没有留白 ✗ →
     回退修复也照样过 ✗（这条断言会变成废的 ✗，实测踩过一次 ✗）。
     撑到 1600 高，容器一定比内容高 ✓，「底部留白」才暴露得出来 ✓。 */
  const VP_ORIG = { width: 1440, height: 900 };
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(600);
  const mlFill = await fillGap('mail', '.lw-ml');
  if (mlFill.err) throw new Error('邮箱高度检查失败：' + mlFill.err);
  if (!mlFill.fill) throw new Error('邮箱页的 .lw-main 没加 fill（面板又会被内容撑高）');
  if (mlFill.底部空白 > 2) {
    throw new Error('★ 邮箱面板没填满内容区，底部留了 ' + mlFill.底部空白 + 'px 空白（面板只有 '
      + mlFill.面板高 + 'px）—— 拖拽条也只有那么高，用户在空白区抓不到它');
  }
  /* 拖拽条要跟面板一样高 ✓（不然空白那一段「拖不动」✗）*/
  const gripVsPane = await page.evaluate(() => {
    const g = document.querySelector('[data-mlgrip="side"]');
    const ml = document.querySelector('.lw-ml');
    return g && ml ? { grip: Math.round(g.getBoundingClientRect().height), ml: Math.round(ml.getBoundingClientRect().height) } : null;
  });
  if (!gripVsPane) throw new Error('找不到邮箱拖拽条');
  if (Math.abs(gripVsPane.grip - gripVsPane.ml) > 2) {
    throw new Error('★ 拖拽条没跟面板等高（' + gripVsPane.grip + ' vs ' + gripVsPane.ml + '）—— 空白区抓不到它');
  }
  const memoFill = await fillGap('memo', '.lw-nt');
  if (memoFill.err) throw new Error('备忘录高度检查失败：' + memoFill.err);
  if (memoFill.底部空白 > 2) {
    throw new Error('★ 备忘录面板底部留了 ' + memoFill.底部空白 + 'px 空白（面板高 ' + memoFill.面板高 + '）');
  }
  const jrFill = await fillGap('journal', '.lw-jr');
  if (jrFill.err) throw new Error('日记高度检查失败：' + jrFill.err);
  if (jrFill.底部空白 > 2) {
    throw new Error('★ 日记面板底部留了 ' + jrFill.底部空白 + 'px 空白（面板高 ' + jrFill.面板高 + '）');
  }
  await page.setViewportSize(VP_ORIG);
  await page.waitForTimeout(500);
  /* ★ 反过来：**长列表**页签**不能**加 fill ✗ ——
     给它们 flex:1 会把内容裁掉 ✗（它们本来就该撑高页面让 .lw-main 自己滚 ✓）。 */
  await page.locator('.lw-nav [data-tab="files"]').dispatchEvent('click');
  await page.waitForTimeout(1200);
  const filesFill = await page.evaluate(() => (document.querySelector('.lw-main') || { className: '' }).className);
  if (filesFill.split(/\s+/).includes('fill')) throw new Error('长列表页签（文件）不该加 fill —— 会把内容裁掉');
  /* 回到邮箱页，后面的用例还要用 */
  await page.locator('.lw-nav [data-tab="mail"]').dispatchEvent('click');
  await page.waitForSelector('.lw-ml-item', { timeout: 20000 });
  await page.waitForTimeout(800);
  /* 宽度要存进 STORE ✓ */
  const mlStore = (await (await fetch(baseUrl + '/api/life/store', { cache: 'no-store' })).json()).data || {};
  if (Math.abs(Number(mlStore.mailListW) - mlListDrag.after) > 2) {
    throw new Error('邮箱列表宽度没存进 STORE：' + mlStore.mailListW + ' vs ' + mlListDrag.after);
  }
  /* 切文件夹后宽度要保持（局部重绘不能把 inline 宽度冲掉 ✗）*/
  await page.locator('[data-mbox="Sent Messages"]').click();
  await page.waitForTimeout(700);
  if (Math.abs(await mlWidth('.lw-ml-side') - mlSideDrag.after) > 2) throw new Error('切文件夹后账号栏宽度丢了');
  await page.locator('[data-mbox="INBOX"]').click();
  await page.waitForTimeout(700);
  /* 双击恢复默认 ✓ */
  await page.locator('[data-mlgrip="list"]').dblclick();
  await page.waitForTimeout(400);
  if (Math.abs(await mlWidth('.lw-ml-list') - 330) > 2) throw new Error('双击没恢复列表默认宽度（应 330px）：' + await mlWidth('.lw-ml-list'));
  await page.locator('[data-mlgrip="side"]').dblclick();
  await page.waitForTimeout(400);
  if (Math.abs(await mlWidth('.lw-ml-side') - 196) > 2) throw new Error('双击没恢复账号栏默认宽度（应 196px）：' + await mlWidth('.lw-ml-side'));

  /* 未读筛选 */
  await page.locator('#lw-ml-unread').click();
  await page.waitForTimeout(400);
  if (!(await page.locator('#lw-ml-unread').getAttribute('class') || '').includes('on')) throw new Error('未读筛选没有切到选中态');
  /* 配置收进可折叠区（不再是页面主体） */
  await page.locator('[data-mcfg]').click();
  await page.waitForTimeout(300);
  if (await page.locator('[data-mail="qq"][data-f="user"]').count() !== 1) throw new Error('账号配置区打不开');
  if (await page.locator('.lw-ml-list').count() !== 0) throw new Error('配置区应该取代收件箱主体');
  await page.locator('[data-mcfg]').click();
  await page.waitForTimeout(300);
  if (await page.locator('.lw-ml-list').count() !== 1) throw new Error('关掉配置后没回到收件箱');
  /* 顶栏胶囊（面板打开时就在） */
  if (await page.locator('#lw-mb').count() !== 1) throw new Error('顶栏没有邮箱状态胶囊');
  const unreadAfter = await badgeNum();
  if (unreadAfter !== unreadBefore - 1) {
    throw new Error('打开一封未读邮件后顶栏未读数应减 1（' + unreadBefore + ' → ' + unreadAfter + '）');
  }
  /* ★★ 天气胶囊和邮箱胶囊必须**等高** ✗ ——
     用户原话：「这个天气和邮箱的框，怎么高度不一致」。
     根因：天气那边是两行（地区 + 体感/湿度）自然撑到 38.6px，
     邮箱那边只有一行只有 28px，并排时高低不齐 ✗。
     现在两个都固定 height:40px + 垂直居中 ✓。 */
  const boxOf = async (sel) => page.locator(sel).boundingBox();
  const bWx = await boxOf('.lw-wx');
  const bMb = await boxOf('#lw-mb');
  if (!bWx || !bMb) throw new Error('顶栏找不到天气或邮箱胶囊');
  if (Math.abs(bWx.height - bMb.height) > 0.5) {
    throw new Error('天气胶囊和邮箱胶囊不等高：' + bWx.height.toFixed(1) + 'px vs ' + bMb.height.toFixed(1) + 'px');
  }
  if (Math.abs(bWx.y - bMb.y) > 0.5) {
    throw new Error('天气胶囊和邮箱胶囊顶边没对齐：' + bWx.y.toFixed(1) + ' vs ' + bMb.y.toFixed(1));
  }
  /* ★ 新邮件提醒 —— 未读数**变多**时右下角弹提醒 ✓
     三条都要验：① 首次只当基线不弹 ✗ ② 变多才弹 ✓ ③ 点 ✕ 能关 ✓ */
  if (await page.locator('#lw-toast').count() !== 0) throw new Error('还没来新邮件就弹了提醒（首次应只当基线）');
  /* ⚠️ 基线要**按当前值算** ✗ —— 上面打开过一封邮件，未读数已经从 3 降到 2，
     写死 5 的话提醒里会显示「3 封」而不是「2 封」✗（实测踩过）。 */
  const curBadge = await badgeNum();
  MAIL_STUB.total = curBadge + 2;                       /* 模拟来 2 封 */
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#lw-toast').waitFor({ state: 'visible', timeout: 15000 });
  const toastText = await page.locator('#lw-toast').innerText();
  if (!/新邮件 · 2 封/.test(toastText)) throw new Error('提醒里没写对新增封数（应 2 封）：' + toastText.replace(/\n/g, ' | '));
  if (!/桩发件人/.test(toastText)) throw new Error('提醒里没写发件人：' + toastText.replace(/\n/g, ' | '));
  if (!/桩新邮件主题/.test(toastText)) throw new Error('提醒里没写主题：' + toastText.replace(/\n/g, ' | '));
  /* ★ 提醒浮层挂在 body 上 ✓ —— 面板关着的时候也要能提醒 ✓ */
  if (await page.locator('body > .lw-toast').count() !== 1) throw new Error('提醒浮层不在 body 上（面板关着就收不到提醒）');
  /* 顶栏胶囊要闪一下 ✓ */
  if (!/fresh/.test(await page.locator('#lw-mb').getAttribute('class') || '')) throw new Error('新邮件时顶栏胶囊没有闪动提示');
  await page.locator('#lw-toast .x').click();
  await page.waitForTimeout(300);
  if (await page.locator('#lw-toast').count() !== 0) throw new Error('点 ✕ 关不掉提醒');
  /* 未读数**没变多**时不该弹 ✓ */
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1500);
  if (await page.locator('#lw-toast').count() !== 0) throw new Error('未读数没变多也弹了提醒');

  /* ═══════════ 邮箱 · 分类管理（新建 / 拖入 / 撤销 / 删除）═══════════════
     ★★ 拖放用**派发合成 DragEvent** ✓，不用 page.mouse / dragTo ✗ ——
     这个环境里 Playwright 的鼠标拖动有时**不投递 mousemove/dragover** ✗
     （备忘录分栏拖拽那条用例也踩过，最后同样改成合成事件 ✓）。 */
  await page.locator('[data-mbox="INBOX"]').click();
  await page.waitForTimeout(900);
  MAIL_STUB.moves.length = 0; MAIL_STUB.newboxes.length = 0; MAIL_STUB.delboxes.length = 0;
  /* ① 新建分类（走真实 prompt ✓）*/
  page.once('dialog', (d) => d.accept('桩分类'));
  await page.locator('#lw-ml-newbox').click();
  await page.waitForTimeout(1000);
  if (MAIL_STUB.newboxes.length !== 1) throw new Error('「＋ 新建文件夹」没发 newbox 请求（发了 ' + MAIL_STUB.newboxes.length + ' 个）');
  if (MAIL_STUB.newboxes[0].name !== '桩分类') throw new Error('新建的文件夹名不对：' + MAIL_STUB.newboxes[0].name);
  if (await page.locator('[data-mbox="桩分类"]').count() !== 1) throw new Error('新建的分类没出现在左栏');
  if (await page.locator('[data-mboxdel="桩分类"]').count() !== 1) throw new Error('自建分类没有删除 ✕');
  /* ★★ 必须先**复现「监听器叠加」的触发条件** ✗✗ ——
     光进一次邮箱页是测不出来的（实测：那样只有 1 个监听器，回退修复也照样过 ✗）。
     条件就是「`bindMail()` 又跑了一遍，但左栏 `[data-mbox]` 元素**没被重建**」✗ ——
     `bindMail()` 在**每次局部重绘**后都会跑（`renderMailPane` 里 ✓），
     而左栏只有 `renderMailPane('side')` 才会重建 ✗。
     切「未读」筛选走的是 `renderMailPane('list')` ✓ → 左栏原样保留 ✓ → 正好制造这个场景 ✓
     （切两次 = 偶数次，筛选状态回到原样 ✓）。
     实测真实环境里这么一来，拖一次会发出 **3 个相同请求** ✗。 */
  for (let i = 0; i < 2; i++) {
    await page.locator('#lw-ml-unread').click();
    await page.waitForTimeout(450);
  }
  /* ② 拖一封邮件到分类 —— ★★ 一次拖放**只能发一个** move 请求 ✗✗
        `bindMail()` 每次局部重绘都会跑一遍（renderMailPane 里 ✓），
        而左栏 DOM **未必**被替换 ✗ → `addEventListener` 会**叠加** ✗ →
        实测**一次拖放发 3 个相同请求** ✗：第一个成功（拿到 newUid ✓），
        后两个是空操作（邮件已不在源文件夹 → newUid = 0 ✗），
        前端用**最后一个响应** → 「↩ 撤销」时有时无 ✗。 */
  const dragRes = await page.evaluate(() => {
    const item = document.querySelector('.lw-ml-item');
    const box = document.querySelector('[data-mbox="桩分类"]');
    if (!item || !box) return { err: '找不到邮件行或分类行' };
    const dt = new DataTransfer();
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    fire(item, 'dragstart'); fire(box, 'dragover'); fire(box, 'drop'); fire(item, 'dragend');
    return { uid: Number(item.dataset.muid) };
  });
  if (dragRes.err) throw new Error(dragRes.err);
  await page.waitForTimeout(1400);
  if (MAIL_STUB.moves.length !== 1) {
    throw new Error('一次拖放应只发 1 个 move 请求，实际 ' + MAIL_STUB.moves.length + ' 个（drop 监听器叠加了？）');
  }
  const mvReq = MAIL_STUB.moves[0];
  if (mvReq.box !== 'INBOX' || mvReq.to !== '桩分类' || mvReq.uid !== dragRes.uid) {
    throw new Error('move 请求参数不对：' + JSON.stringify(mvReq));
  }
  /* ③ 状态栏要有「已移到 … ↩ 撤销」*/
  if (!/已移到/.test(await page.locator('#lw-sub').innerText())) {
    throw new Error('状态栏没提示「已移到」：' + await page.locator('#lw-sub').innerText());
  }
  if (await page.locator('#lw-ml-undo').count() !== 1) throw new Error('状态栏没有「↩ 撤销」');
  /* ④ ★★ 整屏 render() 之后撤销必须**还在** ✗✗ ——
        `#lw-sub` 是 `headHtml()` 渲染的，**每次 render 都会被重建** ✗；
        而面板打开时天气是**异步补渲染**的（`weather.then(() => render())` ✓）→
        「已移到… ↩ 撤销」刚显示就被「日期 · 项目数」盖掉 ✗（实测拖完 7 秒就没了 ✗）。
        切页签能触发一次真正的整屏 render() ✓。 */
  await page.locator('[data-tab="today"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-tab="mail"]').click();
  await page.locator('.lw-ml-item').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(700);
  if (!/已移到/.test(await page.locator('#lw-sub').innerText())) {
    throw new Error('整屏 render() 之后状态栏被默认文案盖掉了：' + await page.locator('#lw-sub').innerText());
  }
  if (await page.locator('#lw-ml-undo').count() !== 1) throw new Error('整屏 render() 之后「↩ 撤销」没了');
  /* ⑤ 点撤销 → 必须**真的移回去** ✓
        （曾经被 `to === from` 守卫挡住 ✗：界面停在收件箱、`MAIL_UI.box` 就是收件箱，
          而撤销的目标也是收件箱 → 直接 return、连请求都不发 ✗，点了毫无反应 ✗）*/
  await page.locator('#lw-ml-undo').click();
  await page.waitForTimeout(1800);
  const undoReq = MAIL_STUB.moves[1];
  if (!undoReq) throw new Error('点「撤销」没发 move 请求（被 to===from 守卫挡住了？）');
  if (undoReq.uid !== mvReq.newUid) {
    throw new Error('撤销没有用**目标文件夹里的新 UID**（用旧 UID 会报 Mails not exist）：' + JSON.stringify(undoReq));
  }
  if (undoReq.box !== '桩分类' || undoReq.to !== 'INBOX') {
    throw new Error('撤销方向不对（应从分类搬回收件箱）：' + JSON.stringify(undoReq));
  }
  if (!/已移回/.test(await page.locator('#lw-sub').innerText())) {
    throw new Error('撤销后状态栏没提示「已移回」：' + await page.locator('#lw-sub').innerText());
  }
  /* ⑥ 删掉这个空分类 ✓ */
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-mboxdel="桩分类"]').click({ force: true });
  await page.waitForTimeout(1000);
  if (MAIL_STUB.delboxes.length !== 1 || MAIL_STUB.delboxes[0].name !== '桩分类') {
    throw new Error('删文件夹请求不对：' + JSON.stringify(MAIL_STUB.delboxes));
  }
  if (await page.locator('[data-mbox="桩分类"]').count() !== 0) throw new Error('分类删了还留在左栏');
  MAIL_STUB.total = MAIL_UNREAD;
  /* 回到备忘录页，后面的收尾流程还要用 */
  await page.locator('[data-tab="memo"]').click();
  await page.waitForTimeout(1500);
  /* 收尾：把测试备忘录移走。**趁工作台还开着**验证命令面板在最上层 ——
     工作台是全屏浮层（.lw-inpanel 的 z-index 是 8800），命令面板必须高过它，
     否则按 ⌘⇧P 之后屏幕上什么都看不见、连关闭按钮都点不到（实测踩过）。 */
  await page.locator('#lw-memo-del').click();
  await page.waitForTimeout(700);
  await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+P':'Control+Shift+P');
  await page.locator('#sym-modal.open').waitFor({state:'visible',timeout:10000});
  const paletteHit=await page.evaluate(()=>{
    const close=document.getElementById('sym-modal-close');
    if(!close)return {命中:'(没有关闭按钮)'};
    const r=close.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {命中:hit?(hit.id||hit.className||hit.tagName):null};
  });
  if(paletteHit.命中!=='sym-modal-close')throw new Error('工作台打开时命令面板被盖住，关闭按钮点不到（命中：'+paletteHit.命中+'）');
  await page.locator('#sym-modal-close').click();
  await page.waitForTimeout(400);
  await page.locator('#btn-lifework').click();
  await page.locator('#lifework-view').waitFor({state:'detached',timeout:10000}).catch(()=>{});
  await page.waitForTimeout(400);
  /* ---- 命令面板与工程测试/调试入口 ---- */
  await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+P':'Control+Shift+P');
  await page.locator('#sym-modal.open').waitFor({state:'visible'});
  if(await page.locator('[data-search-mode="command"].on').count()!==1)throw new Error('命令面板快捷键未切换到命令模式');
  if(await page.locator('#sym-modal-res .command-result').count()<10)throw new Error('命令面板未显示完整命令列表');
  await page.locator('#sym-modal-close').click();
  await page.keyboard.press(process.platform==='darwin'?'Meta+P':'Control+P');
  await page.locator('#sym-modal.open').waitFor({state:'visible'});
  if(await page.locator('[data-search-mode="file"].on').count()!==1)throw new Error('快速打开快捷键未切换到全工作台模式');
  await page.locator('#sym-q').fill('Block Drag');
  await page.locator('#sym-modal-res .quick-reading').first().waitFor({state:'visible'});
  if(!(await page.locator('#sym-modal-status').innerText()).includes('阅读'))throw new Error('快速打开未统计阅读资料');
  await page.locator('#sym-modal-close').click();
  await page.locator('#btn-project').click();
 await page.locator('[data-project-tab="tests"]').click();
 await page.locator('#project-tests:not(.hidden)').waitFor({state:'visible'});
  await page.locator('#test-list .task-row').first().waitFor({state:'visible',timeout:10000});
  if(await page.locator('#test-list .task-row').count()<1)throw new Error('测试入口未识别 package.json 测试脚本');
 await page.locator('[data-project-tab="debug"]').click();
 await page.locator('#project-debug:not(.hidden)').waitFor({state:'visible'});
  await page.locator('#debug-list .task-row').first().waitFor({state:'visible',timeout:10000});
  if(await page.locator('#debug-list .task-row').count()<3)throw new Error('调试适配器环境检测未显示');
  const parsedDebugArgs=await page.evaluate(()=>parseDebugArgs('--name "hello world" --flag'));
  if(JSON.stringify(parsedDebugArgs)!==JSON.stringify(['--name','hello world','--flag']))throw new Error('调试参数解析异常：'+JSON.stringify(parsedDebugArgs));
  await page.locator('#btn-project-close').click();
  await page.locator('.item').filter({hasText:'Reading Demo'}).click();
  await page.locator('#code-context-bar').waitFor({state:'visible'});
  if(!(await page.locator('#code-context-bar').innerText()).includes('led.h'))throw new Error('代码面包屑未显示当前文件');
  await page.locator('#outline-body .ol-item').filter({hasText:'led_create'}).first().click();
  if(!(await page.locator('#code-context-bar').innerText()).includes('ƒ led_create'))throw new Error('Sticky Scope 未跟随当前函数');
  if(await page.locator('#code-edit').isVisible())await page.locator('#btn-edit').click();
  const token=page.locator('#code span').filter({hasText:/^led_create$/}).first();
  await token.scrollIntoViewIfNeeded();await token.hover();await page.waitForTimeout(800);
  const card=page.locator('#definition-hover');await card.waitFor({state:'visible'});
  await card.hover();await page.waitForTimeout(350);
  if(!await card.isVisible())throw new Error('鼠标移入定义卡片后卡片消失');
  const pre=card.locator('pre');const before=await pre.evaluate(element=>element.scrollTop);await pre.hover();await page.mouse.wheel(0,120);const after=await pre.evaluate(element=>element.scrollTop);
  if((await pre.evaluate(element=>element.scrollHeight>element.clientHeight))&&after<=before)throw new Error('定义卡片无法使用滚轮滚动');
  await page.evaluate(()=>{hideDefinitionHover();const root=document.getElementById('code'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,index=-1;while((node=walker.nextNode())){index=node.textContent.indexOf('led_create');if(index>=0)break;}if(!node||index<0)throw new Error('找不到用于引用的代码');const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+'led_create'.length);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  /* 引用浮条不再自动弹出：选中代码后不该自己冒出来（以前会挡住正文）。 */
  await page.waitForTimeout(250);
  if(await page.locator('#code-ref-bar').isVisible())throw new Error('选中代码后引用浮条仍会自动弹出，遮挡正文');
  /* 入口改成编辑器的右键菜单动作（同一动作也绑了 ⌘⌥R）。 */
  const refAction=await page.evaluate(()=>{
    if(typeof MONACO_EDITOR==='undefined'||!MONACO_EDITOR)return 'no-monaco';
    const action=MONACO_EDITOR.getAction('codescope.referenceSelection');
    return action?String(action.label||''):'missing';
  });
  if(refAction!=='no-monaco'&&!refAction.includes('引用'))throw new Error('代码编辑器右键菜单缺少「引用选中的代码」动作：'+refAction);
  /* 没有选区时入口要给出提示、且不弹浮条（右键菜单可能被误点）。
     注意必须先把浏览器选区也清掉：openCodeReferenceMenu 是实时取选区的，
     只清 CODE_REF_SELECTION 的话它会拿旧选区真的插一次引用。 */
  const guard=await page.evaluate(()=>{
    hideCodeReferenceBar();CODE_REF_SELECTION=null;
    const selection=window.getSelection&&window.getSelection();if(selection)selection.removeAllRanges();
    openCodeReferenceMenu();
    return document.getElementById('code-ref-bar').classList.contains('hidden');
  });
  if(!guard)throw new Error('没有选中代码时引用浮条不应弹出');
  /* 后续验证的是「选目标 Markdown → 写入引用」这条链路，直接喂一份选区进去，
     不再依赖浏览器选区（跨 evaluate 等待后容易失效）。 */
  await page.evaluate(()=>{
    const frag=CURRENT.fragments[CINDEX];
    CODE_REF_SELECTION={file:CURRENT.file,frag:CINDEX,line:2,endLine:2,label:fragmentDisplayName(frag,CURRENT.name),language:frag.language,selection:'led_create'};
    $('code-ref-selection-label').textContent='已选 1 行';
    $('code-ref-bar').classList.remove('hidden');$('code-ref-targets').classList.add('hidden');positionCodeReferenceBar();
  });
  await page.locator('#code-ref-bar').waitFor({state:'visible'});
  if(await page.locator('#document-mode-tools').getByText('引用代码',{exact:false}).count())throw new Error('Markdown 顶部仍残留旧的引用代码按钮');
  await page.locator('#code-ref-add').click();
  /* 区块编辑器挂载很重（Crepe 初始化），locator 的可操作性判定容易与重排冲突：这里用真实坐标点击。 */
  const clickFragmentTab=async(targetPage,label)=>{
    const box=await targetPage.evaluate((text)=>{const span=[...document.querySelectorAll('#tabs .tab .frag-label')].find(node=>node.textContent.includes(text))||[...document.querySelectorAll('#tabs .tab')].find(node=>node.textContent.includes(text));const r=span.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},label);
    await targetPage.mouse.click(box.x,box.y);
  };
  /* ---- 普通 Markdown：统一为区块编辑（不再有 源码/分栏/实时/阅读 切换）；HTML 保留自己的源码/分栏/预览 ---- */
  await clickFragmentTab(page,'README.md');
  await page.locator('#md-view.project-md-block .reading-md-block .ProseMirror').waitFor({state:'visible',timeout:60000});
  const markdownBlock=await page.evaluate(()=>({
    toolsShown:document.getElementById('document-mode-tools').classList.contains('show'),
    visibleModeButtons:[...document.querySelectorAll('#document-mode-tools [data-doc-mode]')].filter(button=>button.offsetParent!==null).length,
    mode:documentMode(CURRENT.fragments[CINDEX]),
    ready:document.querySelector('#md-view .reading-md-block').dataset.editorReady==='true',
    crepe:!!document.querySelector('#md-view .reading-md-block .milkdown'),
    sourceHidden:getComputedStyle(document.getElementById('code-wrap')).display==='none',
    hostWidth:Math.round(document.querySelector('#md-view .reading-md-block').getBoundingClientRect().width),
    splitWidth:Math.round(document.getElementById('edit-split').getBoundingClientRect().width)
  }));
  if(markdownBlock.toolsShown||markdownBlock.visibleModeButtons!==0)throw new Error('Markdown 仍显示源码/分栏/实时/阅读切换器：'+JSON.stringify(markdownBlock));
  if(markdownBlock.mode!=='block'||!markdownBlock.ready||!markdownBlock.crepe||!markdownBlock.sourceHidden||markdownBlock.hostWidth<markdownBlock.splitWidth-2)throw new Error('Markdown 区块编辑器未接管编辑区：'+JSON.stringify(markdownBlock));
  // 编辑页必须铺满工作区并水平居中（历史回归：残留 max-width:980px 会让它靠左）
  const blockLayout=await page.evaluate(()=>{
    const view=document.getElementById('md-view'),split=document.getElementById('edit-split'),prose=document.querySelector('#md-view .ProseMirror');
    const vr=view.getBoundingClientRect(),sr=split.getBoundingClientRect(),pr=prose.getBoundingClientRect();
    return {viewWidth:Math.round(vr.width),hostWidth:Math.round(sr.width),maxWidth:getComputedStyle(view).maxWidth,leftGap:Math.round(pr.left-vr.left),rightGap:Math.round(vr.right-pr.right)};
  });
  if(blockLayout.viewWidth<blockLayout.hostWidth-2||blockLayout.maxWidth!=='none'||Math.abs(blockLayout.leftGap-blockLayout.rightGap)>4)throw new Error('Markdown 区块编辑器未铺满或未居中：'+JSON.stringify(blockLayout));

  const referenceSource=await page.locator('#code-edit').inputValue();
  if(!/\[\[code-ref:.*#fragment=0&line=\d+&end=\d+\|led\.h:\d+/.test(referenceSource))throw new Error('Markdown 未写入可持久化的代码位置引用');
  // 区块编辑器里真实输入：文本代理同步，且 ⌘Z 在编辑器内撤销（不落盘残留）
  const blockPane=page.locator('#md-view .reading-md-block .ProseMirror');
  await blockPane.click();await blockPane.press('Control+End');await blockPane.press('Enter');
  await blockPane.pressSequentially(' markdown-block-smoke');
  await page.waitForFunction(()=>document.getElementById('code-edit').value.includes('markdown-block-smoke'),null,{timeout:30000});
  await page.keyboard.press('Meta+z');
  await page.waitForFunction(()=>!document.getElementById('code-edit').value.includes('markdown-block-smoke'),null,{timeout:30000});
  await page.locator('#md-view .reading-md-block a[href^="#codescope-ref-"]').first().click();
  if(!(await page.locator('#tabs .tab.active').innerText()).includes('led.h')){const jumpState=await page.evaluate(()=>({current:CURRENT&&CURRENT.file,index:CINDEX,active:document.querySelector('#tabs .tab.active')&&document.querySelector('#tabs .tab.active').textContent,status:document.getElementById('status').textContent,refs:[...document.querySelectorAll('.md-code-ref')].map(node=>({...node.dataset,text:node.textContent}))}));throw new Error('Markdown 代码引用无法回跳到原代码片段：'+JSON.stringify(jumpState));}
  await page.locator('#btn-backlinks').click();
  await page.locator('#backlink-dialog.on').waitFor({state:'visible'});
  await page.locator('#backlink-list .backlink-row').filter({hasText:'README.md'}).waitFor({state:'visible'});
  await page.locator('#backlink-close').click();
  const workspaceInterop=await page.evaluate(()=>({codeLink:workspaceLinkMarkdown(currentWorkspaceTarget()),outline:mmMarkdownOutline('# Root\n\n## Child\n\n- Leaf'),snapshotKey:WORKSPACE_SNAPSHOT_KEY}));
  if(!workspaceInterop.codeLink.startsWith('[[code-ref:')||workspaceInterop.outline.length!==3||workspaceInterop.snapshotKey!=='mc-workspace-snapshot-v1')throw new Error('内部链接、XMind 大纲或工作台快照基础能力异常：'+JSON.stringify(workspaceInterop));
  // 分栏里的 Markdown 同样要用区块编辑器（不能退化成源码/Monaco）
  const splitMarkdownTarget=await page.evaluate(()=>{
    // 当前文件里唯一的 Markdown 片段可能正被主栏占用，所以跨文件挑一个 Markdown 片段拖进分栏
    for(const snippet of SNIPPETS||[]){
      for(let index=0;index<(snippet.fragments||[]).length;index++){
        const fragment=snippet.fragments[index];
        if(fragment.language!=='markdown')continue;
        if(snippet.file===CURRENT.file&&index===CINDEX)continue;
        const dt=new DataTransfer();
        dt.setData('application/x-codescope-editor',JSON.stringify({file:snippet.file,fragment:index}));
        document.getElementById('edit-split').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
        return {file:snippet.file,index};
      }
    }
    return null;
  });
  if(!splitMarkdownTarget)throw new Error('测试夹具里找不到可拖入分栏的 Markdown 片段');
  // 两个编辑器都是异步挂载的（Crepe 初始化较慢），等区块编辑器真正出现再断言
  await page.waitForSelector('.split-editor-group.block-active .split-md-block', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600);
  const splitMarkdownPane=await page.evaluate(()=>({
    groups:document.querySelectorAll('.split-editor-group').length,
    blockHost:!!document.querySelector('.split-editor-group .split-md-block'),
    blockActive:!!document.querySelector('.split-editor-group.block-active'),
    monacoHost:!!document.querySelector('.split-editor-group .split-monaco-host'),
  }));
  if(splitMarkdownPane.groups<1)throw new Error('未能建立分栏以验证 Markdown 区块编辑器：'+JSON.stringify(splitMarkdownPane));
  if(!splitMarkdownPane.blockHost||!splitMarkdownPane.blockActive||splitMarkdownPane.monacoHost)throw new Error('分栏里的 Markdown 未使用区块编辑器：'+JSON.stringify(splitMarkdownPane));
  await page.evaluate(()=>{try{closeSplitEditor(0);}catch(_){}});
  await page.waitForSelector('#md-view.project-md-block .reading-md-block',{timeout:45000}).catch(()=>{});
  await page.waitForTimeout(400);
  await clickFragmentTab(page,'demo.html');
  await page.locator('#html-preview-frame').waitFor({state:'visible'});
  await page.locator('#edit-preview .edit-preview-close').click();
  if(await page.locator('#edit-preview').isVisible())throw new Error('HTML 右侧预览无法关闭');
  await page.locator('[data-doc-mode="preview"]').click();
  await page.locator('#html-preview-frame').waitFor({state:'visible'});
  if(await page.locator('#code-wrap').isVisible())throw new Error('HTML 全宽预览仍残留源码栏');
  await page.locator('#edit-preview .edit-preview-close').click();
  await clickFragmentTab(page,'main.tex');
  await page.locator('#edit-preview.latex-preview').waitFor({state:'visible'});
  if(await page.locator('#document-mode-tools').isVisible())throw new Error('LaTeX 工作区错误显示 Markdown/HTML 的源码、分栏或阅读切换器');
  await page.locator('#latex-preview-close').click();
  if(await page.locator('#document-mode-tools').isVisible())throw new Error('关闭 LaTeX 预览后文档模式切换器再次出现');
  await page.locator('#btn-run').click();
  await page.locator('#edit-preview.latex-preview').waitFor({state:'visible'});
  /* ---- 区块编辑器：片段快速切换不得串页 ---- */
  const markdownPage=await browser.newPage({viewport:{width:1440,height:760}}),markdownErrors=[];
  markdownPage.on('pageerror',error=>markdownErrors.push(String(error.message||error)));
  await markdownPage.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await markdownPage.locator('.item').filter({hasText:'Markdown Sync Demo'}).click();
  await clickFragmentTab(markdownPage,'README.md');
  await markdownPage.waitForSelector('#md-view.project-md-block .reading-md-block[data-editor-ready="true"] .ProseMirror',{timeout:60000});
  const firstMarkdownPane=await markdownPage.evaluate(()=>document.querySelector('#md-view .reading-md-block .ProseMirror').innerText);
  if(!firstMarkdownPane.includes('First Markdown Document'))throw new Error('Markdown 区块编辑器未载入当前片段：'+firstMarkdownPane.slice(0,80));
  await clickFragmentTab(markdownPage,'Guide.md');
  await markdownPage.waitForFunction(()=>{const pane=document.querySelector('#md-view .reading-md-block .ProseMirror');return !!pane&&pane.innerText.includes('Anchor Sync Guide');},null,{timeout:60000});
  const switchedMarkdown=await markdownPage.evaluate(()=>({source:document.getElementById('code-edit').value,pane:document.querySelector('#md-view .reading-md-block .ProseMirror').innerText}));
  if(!switchedMarkdown.source.includes('Anchor Sync Guide')||switchedMarkdown.pane.includes('First Markdown Document'))throw new Error('Markdown 快速切换后区块编辑器串页：'+JSON.stringify(switchedMarkdown).slice(0,200));
  if(markdownErrors.length)throw new Error('Markdown 区块编辑器浏览器运行错误：'+markdownErrors.join('；'));
  await markdownPage.close();
  await clickFragmentTab(page,'led.h');
  await page.waitForTimeout(1400);
  const lspStatus=await page.locator('#lsp-diagnostics').innerText();
  if(executablePath&&fs.existsSync('/usr/bin/clangd')&&!/clangd|错误|警告/.test(lspStatus))throw new Error('clangd 状态未显示');
  if(await page.evaluate(()=>!!window.MarkmapLib))throw new Error('思维导图库不应在启动时加载');
  /* ---- 编辑器缩进（Tab / Shift+Tab）---- */
  await page.locator('.item').filter({hasText:'Indent Demo'}).click();
  await page.waitForTimeout(900);
  // 只读模式不刷新 textarea，先切到编辑模式再校验片段内容
  if(!(await page.locator('#code-edit').isVisible()))await page.locator('#btn-edit').click();
  await page.waitForTimeout(600);
  const indentCols=await page.evaluate(()=>document.getElementById('code-edit').value.split('\n').map((line)=>line.match(/^[ \t]*/)[0].length));
  if(Math.max(...indentCols)<8)throw new Error('测试片段未成功打开或缺少多级缩进：'+JSON.stringify(indentCols));
  const selectAll=process.platform==='darwin'?'Meta+a':'Control+a';
  await page.locator('#code-edit').click();
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Shift+Tab');            // 整体反缩进（python → 4 空格一级）
  await page.keyboard.press('Tab');                  // 再整体缩进
  const indentUnit=await page.evaluate(()=>indentUnit());
  const indented=await page.locator('#code-edit').evaluate((el)=>el.value);
  const bodyLines=indented.split('\n').filter((line)=>line.trim());
  if(!bodyLines.every((line)=>line.startsWith(indentUnit)))throw new Error('多行 Tab 缩进未按每级 '+indentUnit.length+' 空格整体缩进');
  await page.keyboard.press('Shift+Tab');
  const dedented=await page.locator('#code-edit').evaluate((el)=>el.value);
  if(new RegExp('^ {'+indentUnit.length+'}class Robot').test(dedented))throw new Error('Shift+Tab 反缩进无效');
  // 缩进宽度仍可由内部设置切换；低频工具栏按钮不再占用空间
  const widthBefore=await page.evaluate(()=>currentIndentWidth());
  await page.evaluate(()=>{const next=currentIndentWidth()===2?4:2;INDENT_WIDTH=next;INDENT_OVERRIDE=next;applyIndentWidth();refreshCodeHierarchy();});
  await page.waitForTimeout(300);
  const widthAfter=await page.evaluate(()=>currentIndentWidth());
  if(widthAfter===widthBefore)throw new Error('缩进宽度按钮未切换宽度');
  await page.locator('#code-edit').click();   // 点击工具栏按钮后焦点已离开编辑器，需重新聚焦
  await page.waitForTimeout(200);
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Tab');
  const wideIndent=await page.locator('#code-edit').evaluate((el)=>el.value);
  const wideUnit=await page.evaluate(()=>indentUnit());
  if(!wideIndent.split('\n').filter((l)=>l.trim()).every((line)=>line.startsWith(wideUnit)))throw new Error('切换后的缩进宽度未生效');
  await page.evaluate((width)=>{INDENT_WIDTH=width;INDENT_OVERRIDE=width;applyIndentWidth();refreshCodeHierarchy();},widthBefore);
  await page.waitForTimeout(300);
  if(await page.evaluate(()=>currentIndentWidth())!==widthBefore)throw new Error('缩进宽度未切回原值');

  /* ---- 代码层级：缩进参考线 + 折叠装订线 ---- */
  const guides=await page.evaluate(()=>{
    const canvas=document.getElementById('indent-guides');
    if(!canvas||!canvas.width)return 0;
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let painted=0;
    for(let i=3;i<data.length;i+=4)if(data[i]>0)painted++;
    return painted;
  });
  if(guides<=100)throw new Error('缩进参考线未绘制（painted='+guides+'）');
  // 竖线位置：第 k 级画在 (k-1)*缩进宽 处（首个缩进层紧贴代码区左内边距）
  const guideXs=await page.evaluate(()=>{
    const canvas=document.getElementById('indent-guides'),m=editorMetrics(),dpr=window.devicePixelRatio||1;
    const ctx=canvas.getContext('2d'),unit=indentUnitWidth()*m.charWidth;
    const lines=document.getElementById('code-edit').value.split('\n');
    // 取缩进最深的一行，按其真实深度逐条校验竖线（与缩进宽度设置无关）
    let idx=-1,depth=0;
    lines.forEach((l,i)=>{const c=(l.match(/^[ \t]*/)||[''])[0];const d=Math.floor(c.length/indentUnitWidth());if(d>depth){depth=d;idx=i;}});
    if(idx<0||depth<1)return null;
    const y=Math.round((m.paddingTop+idx*m.lineHeight+m.lineHeight/2)*dpr);
    const row=ctx.getImageData(0,y,canvas.width,1).data;
    const xs=[];
    for(let x=0;x<canvas.width;x++)if(row[x*4+3]>0)xs.push(Math.round(x/dpr));
    // 亚像素线可能占相邻 2 个像素，先按相邻关系分组，取每组的起点作为线位置
    const groups=[];
    for(const x of xs){ if(!groups.length||x-groups[groups.length-1][groups[groups.length-1].length-1]>1)groups.push([x]); else groups[groups.length-1].push(x); }
    const starts=groups.map((g)=>g[0]);
    return {starts,expect:Array.from({length:depth},(_,k)=>Math.round(m.paddingLeft+k*unit)),depth,line:lines[idx].slice(0,20)};
  });
  if(!guideXs)throw new Error('未找到带缩进的行用于校验缩进线位置');
  if(guideXs.starts.length!==guideXs.expect.length||!guideXs.expect.every((e,i)=>Math.abs(guideXs.starts[i]-e)<=2))throw new Error('缩进竖线位置异常（深度 '+guideXs.depth+'，行 '+JSON.stringify(guideXs.line)+'）：实际 '+JSON.stringify(guideXs.starts)+' 期望 '+JSON.stringify(guideXs.expect));
  const foldButtons=await page.locator('#fold-gutter .fg-btn').count();
  if(foldButtons<1)throw new Error('折叠装订线未显示可折叠箭头');
  // 折叠箭头必须与其所在代码行垂直对齐（曾因缺少 padding-top 整体偏移）
  const alignDevs=await page.evaluate(()=>{
    const code=document.getElementById('code'),gutter=document.getElementById('fold-gutter'),m=editorMetrics();
    const codeTop=code.getBoundingClientRect().top;
    return [...gutter.children].map((row,i)=>{
      const btn=row.querySelector('.fg-btn');
      if(!btn)return null;
      const r=btn.getBoundingClientRect();
      const ideal=m.paddingTop+i*m.lineHeight+(m.lineHeight-r.height)/2;
      return Math.abs((r.top-codeTop)-ideal);
    }).filter((v)=>v!=null);
  });
  if(alignDevs.length&&Math.max(...alignDevs)>1.5)throw new Error('折叠箭头与代码行未对齐，最大偏差 '+Math.max(...alignDevs).toFixed(2)+'px');
  const editHint=await page.evaluate(()=>{document.querySelector('#fold-gutter .fg-btn').click();return document.getElementById('status').textContent;});
  if(!/只读/.test(editHint))throw new Error('编辑模式点击折叠箭头未给出提示');

  /* ---- 只读模式真折叠与展开 ---- */
  await page.waitForTimeout(1800);   // 等自动保存落盘
  await page.locator('#btn-edit').click();
  await page.waitForTimeout(700);
  const linesBefore=await page.locator('#ln').evaluate((el)=>el.textContent.split('\n').length);
  await page.evaluate(()=>{const btns=[...document.querySelectorAll('#fold-gutter .fg-btn')];(btns[2]||btns[0]).click();});
  await page.waitForTimeout(700);
  const folded=await page.evaluate(()=>({text:document.getElementById('code').textContent,lines:document.getElementById('ln').textContent.split('\n').length,folded:document.querySelectorAll('#fold-gutter .fg-btn.folded').length}));
  if(folded.lines>=linesBefore)throw new Error('只读模式折叠未隐藏代码行');
  if(!/行已折叠/.test(folded.text))throw new Error('折叠处未显示占位提示');
  if(folded.folded<1)throw new Error('折叠箭头未切换为已折叠状态');
  await page.evaluate(()=>document.querySelector('#fold-gutter .fg-btn.folded').click());
  await page.waitForTimeout(700);
  const linesAfter=await page.locator('#ln').evaluate((el)=>el.textContent.split('\n').length);
  if(linesAfter!==linesBefore)throw new Error('再次点击未能展开恢复');



  /* ---- 括号 / 引号自动配对 ---- */
  if(!(await page.locator('#code-edit').isVisible()))await page.locator('#btn-edit').click();
  await page.waitForTimeout(400);
  const setText=async(text,selStart,selEnd)=>{
    await page.evaluate(({text,selStart,selEnd})=>{const t=document.getElementById('code-edit');t.focus();t.value=text;t.dispatchEvent(new Event('input',{bubbles:true}));t.setSelectionRange(selStart,selEnd==null?selStart:selEnd);},{text,selStart,selEnd});
    await page.waitForTimeout(120);
  };
  const editorState=()=>page.evaluate(()=>{const t=document.getElementById('code-edit');return {v:t.value,s:t.selectionStart,e:t.selectionEnd};});

  await setText('',0,0);
  await page.keyboard.press('(');
  let es=await editorState();
  if(es.v!=='()'||es.s!==1)throw new Error('输入 ( 未自动补全右括号，实际 '+JSON.stringify(es));
  await setText('',0,0);
  await page.keyboard.press('{');
  es=await editorState();
  if(es.v!=='{}'||es.s!==1)throw new Error('输入 { 未自动补全右花括号，实际 '+JSON.stringify(es));
  await setText('abc',0,3);
  await page.keyboard.press('(');
  es=await editorState();
  if(es.v!=='(abc)'||es.s!==1||es.e!==4)throw new Error('选中内容后用括号包裹失败，实际 '+JSON.stringify(es));
  await setText('',0,0);
  await page.keyboard.press('"');
  es=await editorState();
  if(es.v!=='""'||es.s!==1)throw new Error('输入 " 未自动补全引号，实际 '+JSON.stringify(es));
  await page.keyboard.press('"');
  es=await editorState();
  if(es.v!=='""'||es.s!==2)throw new Error('成对引号内重复输入未跳过，实际 '+JSON.stringify(es));
  await setText('()',1,1);
  await page.keyboard.press('Backspace');
  es=await editorState();
  if(es.v!==''||es.s!==0)throw new Error('空括号内 Backspace 未整对删除，实际 '+JSON.stringify(es));
  await setText('don',3,3);
  await page.keyboard.type("'");
  await page.keyboard.type('t');
  es=await editorState();
  if(es.v!=="don't")throw new Error('单词后撇号被错误补全，实际 '+JSON.stringify(es));

  /* ---- VS Code 风格行编辑快捷键 ---- */
  await setText('one\ntwo\nthree',4,7);
  await page.keyboard.press('Alt+ArrowUp');
  es=await editorState();
  if(es.v!=='two\none\nthree')throw new Error('Alt+↑ 移动行失败，实际 '+JSON.stringify(es));
  await page.keyboard.press('Shift+Alt+ArrowDown');
  es=await editorState();
  if(es.v!=='two\ntwo\none\nthree')throw new Error('Shift+Alt+↓ 复制行失败，实际 '+JSON.stringify(es));
  await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+K':'Control+Shift+K');
  es=await editorState();
  if(es.v!=='two\none\nthree')throw new Error('Ctrl/⌘+Shift+K 删除行失败，实际 '+JSON.stringify(es));

  /* ---- Monaco / VS Code 同源编辑内核 ---- */
  const idePage=await browser.newPage({viewport:{width:1440,height:900}}),ideErrors=[];
  idePage.on('pageerror',error=>ideErrors.push(String(error.message||error)));
  await idePage.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await idePage.locator('.item').filter({hasText:'Reading Demo'}).click();
  await idePage.locator('#code-wrap.monaco-active .monaco-editor').waitFor({state:'visible',timeout:15000});
  if(await idePage.locator('#monaco-main .minimap').count()<1)throw new Error('Monaco 小地图未启用');
  const ideState=await idePage.evaluate(()=>({model:!!MONACO_EDITOR&&!!MONACO_EDITOR.getModel(),fold:!!MONACO_EDITOR.getAction('editor.fold'),multi:MONACO_EDITOR.getRawOptions().multiCursorModifier}));
  if(!ideState.model||!ideState.fold||ideState.multi!=='alt')throw new Error('Monaco 编辑能力不完整：'+JSON.stringify(ideState));
  await idePage.evaluate(()=>{localStorage.removeItem('mc-editor-font-size');applyEditorFontSize(14,false);});
  await idePage.locator('#monaco-main .monaco-editor').evaluate(node=>node.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,ctrlKey:true,bubbles:true,cancelable:true})));
  await idePage.waitForFunction(()=>MONACO_EDITOR.getRawOptions().fontSize===15&&localStorage.getItem('mc-editor-font-size')==='15');
  const zoomState=await idePage.evaluate(()=>({fontSize:MONACO_EDITOR.getRawOptions().fontSize,saved:localStorage.getItem('mc-editor-font-size')}));
  if(zoomState.fontSize!==15||zoomState.saved!=='15')throw new Error('Ctrl + 鼠标滚轮缩放未生效：'+JSON.stringify(zoomState));
  await idePage.locator('#monaco-main .monaco-editor').evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,bubbles:true,cancelable:true})));
  await idePage.waitForFunction(()=>MONACO_EDITOR.getRawOptions().fontSize===14&&localStorage.getItem('mc-editor-font-size')==='14');
  await idePage.evaluate(()=>toggleEditorWordWrap());
  const wrapState=await idePage.evaluate(()=>({wordWrap:MONACO_EDITOR.getRawOptions().wordWrap,saved:localStorage.getItem('mc-editor-word-wrap')}));
  if(wrapState.wordWrap!=='on'||wrapState.saved!=='1')throw new Error('自动换行状态未同步：'+JSON.stringify(wrapState));

  /* 保存状态必须待在底部状态栏的固定槽位里：
     回归 1：它原本在 #toolbar 内，自动保存时多出的约 90px 会把工具栏挤成两行
     （实测视口 1647：内容 1056px / 容器 977px，工具栏 46→79px），编辑器随之上下抖动；
     回归 2：改成工具栏内浮层后会盖住「信息」等右侧按钮（文字重叠成“12:信息3 已保存”）。 */
  const saveStatusLayout=await idePage.evaluate(()=>{
    const bar=document.getElementById('toolbar'),tick=document.getElementById('save-tick'),split=document.getElementById('edit-split'),status=document.getElementById('status'),elapsed=document.getElementById('elapsed');
    const toolbarButtons=[...document.querySelectorAll('#toolbar button')].filter((b)=>b.getBoundingClientRect().width>0);
    const probe=toolbarButtons[toolbarButtons.length-1];
    const read=()=>({
      barH:bar.getBoundingClientRect().height,
      splitTop:split.getBoundingClientRect().top,
      statusLeft:status.getBoundingClientRect().left,
      elapsedLeft:elapsed.getBoundingClientRect().left,
      tickW:Math.round(tick.getBoundingClientRect().width*100)/100,
    });
    tick.classList.remove('show');
    const idle=read();
    tick.textContent='12:00:00 已保存';
    tick.className='pill ok show';
    const shown=read();
    // 「信息」按钮中心必须命中按钮本身，说明没有被任何提示层遮挡
    const probeBox=probe.getBoundingClientRect();
    const probeHit=document.elementFromPoint(probeBox.left+probeBox.width/2,probeBox.top+probeBox.height/2);
    tick.classList.remove('show');
    return {idle,shown,inToolbar:!!tick.closest('#toolbar'),inStatusBar:!!tick.closest('#status')?.parentElement||tick.parentElement.contains(status),position:getComputedStyle(tick).position,idleVisibility:getComputedStyle(tick).visibility,probeHitId:probeHit?probeHit.id:'',probeId:probe.id,probeText:(probe.textContent||'').trim()};
  });
  if(saveStatusLayout.inToolbar)throw new Error('保存状态仍放在工具栏内，会挤压按钮：'+JSON.stringify(saveStatusLayout));
  if(saveStatusLayout.idle.tickW<=0)throw new Error('保存状态槽位宽度为 0：'+JSON.stringify(saveStatusLayout));
  if(Math.abs(saveStatusLayout.shown.tickW-saveStatusLayout.idle.tickW)>0.5)throw new Error('保存状态显示与隐藏的槽位宽度不一致：'+JSON.stringify(saveStatusLayout));
  if(saveStatusLayout.idleVisibility!=='hidden')throw new Error('保存状态空闲时应隐藏（保留槽位）: '+JSON.stringify(saveStatusLayout));
  if(saveStatusLayout.shown.barH!==saveStatusLayout.idle.barH)throw new Error('保存状态出现会改变工具栏高度，导致编辑器上下跳动：'+JSON.stringify(saveStatusLayout));
  if(saveStatusLayout.shown.splitTop!==saveStatusLayout.idle.splitTop)throw new Error('保存状态出现会推动代码编辑器：'+JSON.stringify(saveStatusLayout));
  if(saveStatusLayout.shown.statusLeft!==saveStatusLayout.idle.statusLeft||saveStatusLayout.shown.elapsedLeft!==saveStatusLayout.idle.elapsedLeft)throw new Error('保存状态出现会挤动底部状态栏：'+JSON.stringify(saveStatusLayout));
  if(saveStatusLayout.probeHitId!==saveStatusLayout.probeId)throw new Error('工具栏按钮被提示层遮挡：'+JSON.stringify(saveStatusLayout));
  await idePage.evaluate(()=>MONACO_EDITOR.setPosition({lineNumber:2,column:3}));
  await idePage.waitForFunction(()=>document.getElementById('editor-position').textContent==='Ln 2, Col 3');
  const proxySync=await idePage.evaluate(()=>{MONACO_EDITOR.setValue('int main(void) {\n  return 0;\n}');return document.getElementById('code-edit').value;});
  if(!proxySync.includes('return 0'))throw new Error('Monaco 内容未同步到自动保存代理');
  await idePage.waitForTimeout(900); // 等待本次语言服务请求结束，避免切换模型时产生预期取消信号
  await clickFragmentTab(idePage,'README.md');
  await idePage.waitForFunction(()=>MONACO_EDITOR&&MONACO_EDITOR.getModel()&&MONACO_EDITOR.getModel().getLanguageId()==='markdown');
  const markdownTitle=await idePage.locator('#primary-group-name').innerText();
  if(markdownTitle!=='README.md')throw new Error('Markdown 编辑栏错误显示底层文件名，实际：'+markdownTitle);
  const markdownMonacoState=await idePage.evaluate(()=>({
    language:MONACO_EDITOR.getModel().getLanguageId(),
    lineNumbers:MONACO_EDITOR.getRawOptions().lineNumbers,
    folding:MONACO_EDITOR.getRawOptions().folding,
    glyphMargin:MONACO_EDITOR.getRawOptions().glyphMargin
  }));
  if(markdownMonacoState.language!=='markdown'||markdownMonacoState.lineNumbers!=='on'||!markdownMonacoState.folding)throw new Error('Monaco Markdown 语言服务或导航能力不完整：'+JSON.stringify(markdownMonacoState));
  await clickFragmentTab(idePage,'led.h');
  await idePage.waitForFunction(()=>MONACO_EDITOR&&MONACO_EDITOR.getModel()&&MONACO_EDITOR.getModel().getLanguageId()!=='markdown');
 // 分栏里不能放主栏正在显示的那个分片（renderSplitEditors 会按设计把它过滤掉），
 // 所以这里要按标签取 led.c 的下标，而不是照抄主栏的 fragment:1 —— 下面第 834 行期望的
 // 正是「主栏 led.h / 分栏 led.c」。传错下标时这一步只能靠主栏尚未切换的竞态偶发通过。
 const splitFragmentIndex=await idePage.evaluate(()=>{const i=(CURRENT.fragments||[]).findIndex((fragment)=>String(fragment.label||'').includes('led.c'));return i;});
 if(splitFragmentIndex<0)throw new Error('夹具里找不到 led.c 分片，无法验证分栏');
 await idePage.evaluate((index)=>setEditorSlot(1,{file:CURRENT.file,fragment:index}),splitFragmentIndex);
 // 分栏里的 Monaco 是异步挂载的，实测（空闲机器）约 4.8 秒；挂载前显示的是普通代码视图，
 // 所以慢不是缺陷。这里的 10 秒比套件其他等待（45~60 秒）低一个量级，负载下必然偶发超时。
 await idePage.locator('.split-editor-group.monaco-active .monaco-editor').waitFor({state:'visible',timeout:45000});
  const splitTitles=await idePage.evaluate(()=>({primary:document.getElementById('primary-group-name').textContent,secondary:document.querySelector('.split-editor-head .name').textContent}));
  if(splitTitles.primary!=='led.h'||splitTitles.secondary!=='led.c')throw new Error('多栏编辑器未优先显示片段名：'+JSON.stringify(splitTitles));
  await idePage.evaluate(()=>{localStorage.setItem('mc-editor-groups',JSON.stringify([{file:CURRENT.file,fragment:1}]));localStorage.setItem('mc-editor-group-ratios','[50,50]');});
  await idePage.reload({waitUntil:'domcontentloaded'});
  await idePage.locator('.item').filter({hasText:'Reading Demo'}).click();
  await idePage.locator('#code-wrap.monaco-active .monaco-editor').waitFor({state:'visible',timeout:15000});
  const restoredSplit=await idePage.evaluate(()=>({groups:document.querySelectorAll('.split-editor-group').length,saved:localStorage.getItem('mc-editor-groups')}));
  if(restoredSplit.groups!==0||restoredSplit.saved!==null)throw new Error('刷新后仍恢复了临时编辑分栏：'+JSON.stringify(restoredSplit));

  /* 项目树改用 VS Code 风格的右键菜单：
     回归 1：行内悬停按钮会把「嵌入式常考手撕代码」这类长文件夹名挤成两行；
     回归 2：增删改入口必须能在右键菜单里找到，且点击后真正生效。 */
  const snippetMenu=await idePage.evaluate(()=>{
    const menu=document.getElementById('ctx-menu');
    if(!menu)return {missingMenu:true};
    const row=document.querySelector('#list .item');
    if(!row)return {missing:true};
    row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:140,clientY:220}));
    return {visible:!menu.hidden,labels:[...menu.querySelectorAll('.ctx-item .ctx-label')].map(n=>n.textContent),inlineButtons:row.querySelectorAll('.factions, .fa').length};
  });
  if(snippetMenu.missingMenu)throw new Error('项目树没有右键菜单容器 #ctx-menu（增删改将无处可开）');
  if(snippetMenu.missing)throw new Error('项目树中没有片段行，无法校验右键菜单');
  if(snippetMenu.inlineButtons)throw new Error('片段行仍保留行内操作按钮：'+JSON.stringify(snippetMenu));
  if(!snippetMenu.visible||snippetMenu.labels.join('|')!=='打开|编辑信息 / 重命名|删除片段')throw new Error('片段行右键菜单异常：'+JSON.stringify(snippetMenu));
  await idePage.keyboard.press('Escape');
  await idePage.waitForFunction(()=>document.getElementById('ctx-menu').hidden);
  const listMenu=await idePage.evaluate(()=>{
    const list=document.getElementById('list'),box=list.getBoundingClientRect();
    const rows=[...list.querySelectorAll('.item, .fnode')];
    const bottom=rows.length?Math.max(...rows.map(n=>n.getBoundingClientRect().bottom)):box.top;
    const y=Math.round(Math.min(box.bottom-10,bottom+24));
    list.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:Math.round(box.left+box.width/2),clientY:y}));
    return [...document.querySelectorAll('#ctx-menu .ctx-item .ctx-label')].map(n=>n.textContent);
  });
  if(listMenu.join('|')!=='新建文件|新建文件夹')throw new Error('列表空白处右键菜单异常：'+JSON.stringify(listMenu));
  await idePage.locator('#ctx-menu .ctx-item').filter({hasText:'新建文件夹'}).first().click();
  await idePage.waitForFunction(()=>document.getElementById('new-dialog').classList.contains('open'));
  if((await idePage.locator('#nd-title').innerText())!=='新建文件夹')throw new Error('右键「新建文件夹」未打开新建对话框');
  await idePage.fill('#nd-name','右键菜单回归');
  await idePage.click('#nd-submit');
  await idePage.waitForFunction(()=>[...document.querySelectorAll('#list .fnode')].some(n=>n.textContent.includes('右键菜单回归')),null,{timeout:15000});
  const folderMenu=await idePage.evaluate(()=>{
    const row=[...document.querySelectorAll('#list .fnode')].find(n=>n.textContent.includes('右键菜单回归'));
    const name=row.querySelector('.fname');
    row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:150,clientY:280}));
    const menu=document.getElementById('ctx-menu');
    return {labels:[...menu.querySelectorAll('.ctx-item .ctx-label')].map(n=>n.textContent),inlineButtons:row.querySelectorAll('.factions, .fa').length,nameWrap:name?getComputedStyle(name).whiteSpace:'',nameH:name?Math.round(name.getBoundingClientRect().height):0};
  });
  if(folderMenu.inlineButtons)throw new Error('文件夹行仍保留行内操作按钮：'+JSON.stringify(folderMenu));
  if(folderMenu.labels.join('|')!=='新建文件|新建文件夹|重命名|删除文件夹')throw new Error('文件夹行右键菜单异常：'+JSON.stringify(folderMenu));
  if(folderMenu.nameWrap!=='nowrap'||folderMenu.nameH>26)throw new Error('文件夹名未按单行省略显示（会被长名称撑成两行）：'+JSON.stringify(folderMenu));
  await idePage.keyboard.press('Escape');
  await idePage.waitForFunction(()=>document.getElementById('ctx-menu').hidden);

  /* 阅读 / Office / 绘图三个列表同样改为右键菜单：行内按钮隐藏、菜单由按钮派生，
     并且文件夹行与列表空白处都要有「新建」入口（回归：绘图文件夹行曾漏绑，右键会弹出浏览器原生菜单）。 */
  const otherTrees=await idePage.evaluate(()=>{
    const readMenu=()=>[...document.querySelectorAll('#ctx-menu .ctx-item .ctx-label')].map(n=>n.textContent);
    const inspect=(key,hostId,rowSelector,buttonSelector,rowFilter)=>{
      const host=document.getElementById(hostId);
      const row=host&&[...host.querySelectorAll(rowSelector)].find(n=>{
        if(n.getBoundingClientRect().width<=0)return false;
        if(!rowFilter)return true;
        return rowFilter==='folder'?n.dataset.type==='folder':n.dataset.type!=='folder';
      });
      if(!row)return {key,missing:true};
      const buttons=buttonSelector?[...row.querySelectorAll(buttonSelector)]:[];
      row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:150,clientY:340}));
      const labels=readMenu();
      const open=labels.length>0;
      closeContextMenu();
      // 用渲染宽度判断：getComputedStyle 在子元素上不会反映父级 display:none
      return {key,missing:false,open,inlineHidden:buttons.length?buttons.every(b=>b.getBoundingClientRect().width===0):null,labels};
    };
    const blank=(key,hostId)=>{
      const host=document.getElementById(hostId);
      host.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:400}));
      const labels=readMenu();
      closeContextMenu();
      return {key,missing:false,open:labels.length>0,inlineHidden:null,labels};
    };
    return [
      inspect('阅读·项目','reading-list','.reading-project','.reading-row-actions button'),
      inspect('阅读·资料文件夹','reading-list','.reading-library-folder','.reading-row-actions button'),
      inspect('Office·文档','office-list','.office-row','.office-action','file'),
      inspect('Office·文件夹','office-list','.office-row','.office-action','folder'),
      inspect('绘图·绘图','draw-list','.draw-row','.draw-ren, .draw-del'),
      inspect('绘图·文件夹','draw-list','.draw-frow',null),
      blank('阅读·空白','reading-list'),
      blank('Office·空白','office-list'),
      blank('绘图·空白','draw-list'),
    ];
  });
  const expectTree=(key,texts)=>{
    const tree=otherTrees.find(t=>t.key===key);
    if(!tree)throw new Error('未检查列表 '+key);
    if(tree.missing)throw new Error('列表 '+key+' 没有可测的行：'+JSON.stringify(tree));
    if(!tree.open)throw new Error('列表 '+key+' 右键没有弹出应用菜单（会落到浏览器原生菜单）：'+JSON.stringify(tree));
    if(tree.inlineHidden===false)throw new Error('列表 '+key+' 仍在行内显示操作按钮：'+JSON.stringify(tree));
    for(const text of texts)if(!tree.labels.some(l=>l.includes(text)))throw new Error('列表 '+key+' 右键菜单缺少「'+text+'」：'+JSON.stringify(tree));
  };
  expectTree('阅读·项目',['打开','重命名阅读项目','删除整个阅读项目']);
  expectTree('阅读·资料文件夹',['新建']);
  const readingFolderTree=otherTrees.find(t=>t.key==='阅读·资料文件夹');
  if(!readingFolderTree.labels.some(l=>l==='展开'||l==='收起'))throw new Error('阅读资料文件夹行缺少展开/收起项：'+JSON.stringify(readingFolderTree));
  expectTree('Office·文档',['打开','重命名','删除']);
  expectTree('Office·文件夹',['在此文件夹新建文档','在此文件夹新建文件夹']);
  expectTree('绘图·绘图',['打开','重命名绘图','删除绘图']);
  expectTree('绘图·文件夹',['在此新建绘图','在此新建文件夹']);
  expectTree('阅读·空白',['新建阅读项目','新建阅读文件夹']);
  expectTree('Office·空白',['新建文档','新建文件夹']);
  expectTree('绘图·空白',['新建绘图','新建文件夹']);

  /* 片段标签：改类型 / 重命名 / 删除收进右键菜单，行内不再有悬停 ✎ / × 按钮 */
  const tabMenu=await idePage.evaluate(()=>{
    const tab=document.querySelector('#tabs .tab');
    if(!tab)return {missing:true};
    const hoverButtons=document.querySelectorAll('#tabs .frag-ren, #tabs .frag-del').length;
    const lang=tab.querySelector('.frag-lang');
    tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:160,clientY:150}));
    const items=[...document.querySelectorAll('#ctx-menu .ctx-item')];
    const textOf=(node,selector)=>{const n=node.querySelector(selector);return n?n.textContent:'';};
    const open=!document.getElementById('ctx-menu').hidden;
    const labels=items.map(node=>textOf(node,'.ctx-label'));
    const hints=items.map(node=>textOf(node,'.ctx-hint'));
    closeContextMenu();
    return {missing:false,open,hoverButtons,lang:lang?lang.textContent:'',labels,hints};
  });
  if(tabMenu.missing)throw new Error('片段标签缺失，无法验证标签右键菜单');
  if(!tabMenu.open)throw new Error('片段标签右键没有弹出菜单：'+JSON.stringify(tabMenu));
  if(tabMenu.hoverButtons)throw new Error('片段标签仍在行内显示悬停按钮：'+JSON.stringify(tabMenu));
  for(const text of ['修改片段类型','重命名片段','删除片段'])if(!tabMenu.labels.some(label=>label.includes(text)))throw new Error('片段标签右键菜单缺少「'+text+'」：'+JSON.stringify(tabMenu));
  if(!tabMenu.hints.some(hint=>hint&&hint===tabMenu.lang))throw new Error('片段标签右键菜单未显示当前片段类型：'+JSON.stringify(tabMenu));
  // 菜单项必须真的接到原有动作上：重命名会弹出应用内输入弹窗（原来是原生 prompt）
  await idePage.evaluate(()=>{const tab=document.querySelector('#tabs .tab');tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:160,clientY:150}));});
  await idePage.waitForFunction(()=>!document.getElementById('ctx-menu').hidden,null,{timeout:5000});
  await idePage.locator('#ctx-menu .ctx-item').filter({hasText:'重命名片段'}).first().click();
  await idePage.locator('#confirm-dialog.open').waitFor({state:'visible',timeout:5000});
  const tabPromptTitle=String((await idePage.locator('#cd-title').textContent())||'');
  const tabPromptValue=await idePage.locator('#cd-input').inputValue();
  if(!tabPromptTitle.includes('重命名'))throw new Error('片段标签右键「重命名片段」没有触发重命名弹窗：'+tabPromptTitle);
  if(!tabPromptValue)throw new Error('重命名弹窗没有带出当前片段名');
  await idePage.locator('#cd-cancel').click();
  await idePage.waitForTimeout(300);
  if(await idePage.locator('#confirm-dialog.open').count())throw new Error('取消后重命名弹窗没有关闭');
  if(await idePage.locator('#ctx-menu .ctx-item:visible').count())await idePage.keyboard.press('Escape');
  if(await idePage.locator('#ctx-menu .ctx-item:visible').count())throw new Error('Esc 之后右键菜单仍然可见');

 // 切换模型时语言服务会主动取消在途请求，Monaco 抛出 "Canceled" 属预期信号（见上文等待语言服务结束的注释）；
 // 这里只过滤这一条已知信息，其他运行错误照旧失败。
 const ideUnexpectedErrors=ideErrors.filter(message=>!/^canceled$/i.test(String(message||'').trim()));
 // 只对“过滤后仍然存在”的错误失败。原来这里后面还跟了一句 `if(ideErrors.length) throw`，
 // 于是只要语言服务取消过一次在途请求，断言就必然失败（与被过滤掉的 Canceled 自相矛盾），
 // 表现为约三成概率的偶发失败。
 if(ideUnexpectedErrors.length)throw new Error('Monaco 浏览器运行错误：'+ideUnexpectedErrors.join('；'));
  await idePage.close();

  /* ---- Office 工作区：左侧同级入口与 ONLYOFFICE 必选连接页 ---- */
  const officePage=await browser.newPage({viewport:{width:1440,height:900}}),officeErrors=[];
  officePage.on('pageerror',error=>officeErrors.push(String(error.message||error)));
  await officePage.goto(baseUrl,{waitUntil:'domcontentloaded'});
  // count 是递归「文档」数（空文件夹不计），因此仍为 3；渲染行数则含文件夹行，为 4
  await officePage.waitForFunction(()=>OFFICE_TREE&&OFFICE_TREE.count===3);
  const panelOrder=await officePage.evaluate(()=>[...document.getElementById('side').children].map(node=>node.id).filter(Boolean));
  const drawPos=panelOrder.indexOf('pane-draw'),officePos=panelOrder.indexOf('pane-office'),readingPos=panelOrder.indexOf('pane-reading');
  if(drawPos<0||officePos!==drawPos+2||readingPos!==officePos+2)throw new Error('Office 未作为绘图与阅读之间的左侧同级模块：'+JSON.stringify(panelOrder));
  const officeRows=officePage.locator('#office-list .office-row');await officeRows.first().waitFor({state:'visible'});
  if(await officeRows.count()!==4)throw new Error('Office 文档树数量错误');

  await officePage.evaluate(()=>document.getElementById('document-mode-tools').classList.add('show','markdown'));
  await officeRows.filter({hasText:'Browser Word'}).click();
  const connectCard=officePage.locator('.office-connect-card');await connectCard.waitFor({state:'visible',timeout:15000});
  if(await officePage.locator('#document-mode-tools').isVisible())throw new Error('Office 工作区错误显示了代码文档模式切换器');
  if(!(await connectCard.innerText()).includes('连接 ONLYOFFICE Docs'))throw new Error('ONLYOFFICE 未连接时没有显示明确的连接页');
  if(await officePage.locator('#office-word-editor,.office-sheet,.office-pptx-frame').count())throw new Error('ONLYOFFICE 未连接时错误启用了内置 Office 编辑器');
  if(!(await officePage.locator('#office-engine').innerText()).includes('ONLYOFFICE'))throw new Error('Office 引擎状态没有标识 ONLYOFFICE');
  const connection=await officePage.evaluate(()=>fetch('/api/office/connection').then(response=>response.json()));
  if(!connection.ok||connection.connection.publicUrl!=='http://127.0.0.1:1'||connection.connection.jwtSecret)throw new Error('ONLYOFFICE 连接配置接口异常：'+JSON.stringify(connection));
  if(officeErrors.length)throw new Error('Office 浏览器运行错误：'+officeErrors.join('；'));
  await officePage.close();

  /* ---- XMind：自由拖拽、换父级、高级布局、平移与指针缩放 ---- */
  const xmindPage=await browser.newPage({viewport:{width:1440,height:900}}),xmindErrors=[];
  xmindPage.on('pageerror',error=>xmindErrors.push(String(error.message||error)));
  await xmindPage.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await xmindPage.evaluate(()=>document.getElementById('document-mode-tools').classList.add('show','markdown'));
  await xmindPage.evaluate(async name=>{await openDrawing(name);setXmindView('edit');},xmindCreated.name);
  if(await xmindPage.locator('#document-mode-tools').isVisible())throw new Error('绘图工作区错误显示了代码文档模式切换器');
  try{await xmindPage.locator('#xmind-engine.smm-mind-map-container .smm-node').first().waitFor({state:'visible',timeout:20000});}catch(error){const state=await xmindPage.evaluate(()=>({kind:DRAW_KIND,file:DRAW_FILE,view:XMIND_VIEW,root:getComputedStyle(document.getElementById('xmind-root')).display,engine:getComputedStyle(document.getElementById('xmind-engine')).display,empty:document.getElementById('xmind-empty').textContent,status:document.getElementById('draw-ed-status').textContent,html:document.getElementById('xmind-engine').innerHTML.slice(0,240)}));throw new Error('XMind 编辑引擎未启动：'+JSON.stringify(state)+' / '+xmindErrors.join('；')+' / '+error.message);}
  const toolbarState=await xmindPage.evaluate(()=>({height:document.querySelector('.codescope-xmind-toolbar').getBoundingClientRect().height,polluted:[...document.querySelectorAll('#xmind-outline .xmind-title')].some(el=>/<\/?p>/i.test(el.value))}));if(toolbarState.height>48||toolbarState.polluted)throw new Error('XMind 工具栏高度或节点纯文本清理异常：'+JSON.stringify(toolbarState));await xmindPage.locator('#xmind-more').evaluate(el=>el.open=true);await xmindPage.locator('#xmind-preview').click({position:{x:16,y:16}});if(await xmindPage.locator('#xmind-more').evaluate(el=>el.open))throw new Error('XMind 更多菜单点击画布后未关闭');
  await xmindPage.locator('#xmind-floating-layer .xmind-floating-node').first().waitFor({state:'visible',timeout:10000});
  await xmindPage.waitForFunction(()=>{const node=document.querySelector('.xmind-floating-node');return !!node&&Math.abs((XMIND_MAP?.view?.scale||1)-Number(node.style.getPropertyValue('--free-scale')||1))<.001;},null,{timeout:3000});
  const floatingScale=await xmindPage.evaluate(()=>({map:XMIND_MAP.view.scale,node:Number(document.querySelector('.xmind-floating-node').style.getPropertyValue('--free-scale'))}));
  if(Math.abs(floatingScale.map-floatingScale.node)>.001)throw new Error('XMind 自由分支与主画布缩放不一致：'+JSON.stringify(floatingScale));
  const floatingLayout=await xmindPage.evaluate(()=>{const get=id=>{const el=document.querySelector('.xmind-floating-node[data-topic-id="'+id+'"]'),r=el&&el.getBoundingClientRect();return r&&{left:r.left,right:r.right,top:r.top,bottom:r.bottom,cx:r.left+r.width/2,cy:r.top+r.height/2};},bounds=ids=>{const rects=ids.map(get).filter(Boolean);return{top:Math.min(...rects.map(r=>r.top)),bottom:Math.max(...rects.map(r=>r.bottom))};},root=get('browser-free-root'),a=get('browser-free-a'),a1=get('browser-free-a1'),b=get('browser-free-b'),groups=[bounds(['browser-free-root','browser-free-a','browser-free-a1','browser-free-b']),bounds(['browser-free-root-2','browser-free-c','browser-free-d']),bounds(['browser-free-root-3','browser-free-e'])].sort((x,y)=>x.top-y.top);return{root,a,a1,b,groups,nodes:document.querySelectorAll('.xmind-floating-node').length,links:document.querySelectorAll('#xmind-floating-links path').length};});
  if(!floatingLayout.root||floatingLayout.nodes!==9||floatingLayout.links!==6)throw new Error('XMind 自由导图节点或连线缺失：'+JSON.stringify(floatingLayout));
  if(!(floatingLayout.a.left>floatingLayout.root.right&&floatingLayout.b.left>floatingLayout.root.right&&floatingLayout.a1.left>floatingLayout.a.right))throw new Error('XMind 自由导图未按父子层级向外排布：'+JSON.stringify(floatingLayout));
  if(!(floatingLayout.a.bottom<floatingLayout.b.top||floatingLayout.b.bottom<floatingLayout.a.top))throw new Error('XMind 自由导图同级节点仍然重叠：'+JSON.stringify(floatingLayout));
  for(let index=1;index<floatingLayout.groups.length;index++)if(floatingLayout.groups[index-1].bottom+10>floatingLayout.groups[index].top)throw new Error('XMind 测试自由导图初始位置互相覆盖：'+JSON.stringify(floatingLayout.groups));
  await xmindPage.waitForTimeout(160);const centeredAll=await xmindPage.evaluate(async()=>{const measure=()=>{const engine=document.getElementById('xmind-engine'),er=engine.getBoundingClientRect(),rects=[...engine.querySelectorAll('g.smm-node'),...engine.querySelectorAll('#xmind-floating-layer .xmind-floating-node')].map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height),left=Math.min(...rects.map(r=>r.left)),right=Math.max(...rects.map(r=>r.right)),top=Math.min(...rects.map(r=>r.top)),bottom=Math.max(...rects.map(r=>r.bottom));return{dx:(left+right)/2-(er.left+er.right)/2,dy:(top+bottom)/2-(er.top+er.bottom)/2,left,right,top,bottom,engine:{left:er.left,right:er.right,top:er.top,bottom:er.bottom}};};xmindCenterEditor();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const centered=measure();xmindFitEditor();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return{centered,fitted:measure()};});
  if(Math.abs(centeredAll.centered.dx)>4||Math.abs(centeredAll.centered.dy)>4)throw new Error('XMind 中心按钮未按主导图与自由分支联合边界居中：'+JSON.stringify(centeredAll.centered));
  if(centeredAll.fitted.left<centeredAll.fitted.engine.left-3||centeredAll.fitted.right>centeredAll.fitted.engine.right+3||centeredAll.fitted.top<centeredAll.fitted.engine.top-3||centeredAll.fitted.bottom>centeredAll.fitted.engine.bottom+3)throw new Error('XMind 适应按钮未完整显示全部内容：'+JSON.stringify(centeredAll.fitted));
  const repairedOverlap=await xmindPage.evaluate(()=>{const root2=xmindFind('browser-free-root-2').topic,root3=xmindFind('browser-free-root-3').topic;root2.position={x:320,y:20};root3.position={x:315,y:20};delete xmindSheet().codescopeFreeLayoutVersion;xmindRenderFloatingTopics();const boxes=['browser-free-root','browser-free-a','browser-free-a1','browser-free-b','browser-free-root-2','browser-free-c','browser-free-d','browser-free-root-3','browser-free-e'].map(id=>{const el=document.querySelector('.xmind-floating-node[data-topic-id="'+id+'"]'),r=el.getBoundingClientRect();return{id,top:r.top,bottom:r.bottom}}),group=ids=>{const rows=boxes.filter(row=>ids.includes(row.id));return{top:Math.min(...rows.map(row=>row.top)),bottom:Math.max(...rows.map(row=>row.bottom))}},groups=[group(['browser-free-root','browser-free-a','browser-free-a1','browser-free-b']),group(['browser-free-root-2','browser-free-c','browser-free-d']),group(['browser-free-root-3','browser-free-e'])].sort((a,b)=>a.top-b.top);return{groups,version:xmindSheet().codescopeFreeLayoutVersion};});
  if(repairedOverlap.version!==4||repairedOverlap.groups.some((group,index)=>index&&repairedOverlap.groups[index-1].bottom+8>group.top))throw new Error('XMind 已保存的重叠自由分支未被一次性修复：'+JSON.stringify(repairedOverlap));
  const freePositionStable=await xmindPage.evaluate(()=>{const before=xmindFloatingItems().find(item=>item.topic.id==='browser-free-root-2').position;xmindFind('browser-free-root').topic.position.x+=140;xmindRenderFloatingTopics();const after=xmindFloatingItems().find(item=>item.topic.id==='browser-free-root-2').position;return{before,after};});
  if(freePositionStable.before.x!==freePositionStable.after.x||freePositionStable.before.y!==freePositionStable.after.y)throw new Error('拖动一棵自由导图仍会破坏其他导图的位置：'+JSON.stringify(freePositionStable));
  const reparented=await xmindPage.evaluate(async()=>{const source=xmindSmmNode('browser-movable'),target=xmindSmmNode('browser-parent-b');XMIND_MAP.execCommand('MOVE_NODE_TO',[source],target);await new Promise(resolve=>setTimeout(resolve,100));const hit=xmindFind('browser-movable');return{parent:hit?.parent?.id,layout:XMIND_MAP.getLayout(),free:XMIND_MAP.getConfig('enableFreeDrag')};});
  if(reparented.parent!=='browser-parent-b'||reparented.free)throw new Error('画布结构节点无法稳定拖放换父级：'+JSON.stringify(reparented));
  await xmindPage.locator('#xmind-layout-select').selectOption('fishbone');await xmindPage.waitForFunction(()=>XMIND_MAP.getLayout()==='fishbone');await xmindPage.locator('#xmind-layout-select').selectOption('organizationStructure');await xmindPage.waitForFunction(()=>XMIND_MAP.getLayout()==='organizationStructure');await xmindPage.locator('#xmind-layout-select').selectOption('treeTable');await xmindPage.waitForFunction(()=>XMIND_MAP.getLayout()==='catalogOrganization');
  await xmindPage.locator('#xmind-theme-menu').evaluate(el=>el.classList.remove('hidden'));await xmindPage.locator('#xmind-line-style').selectOption('direct');await xmindPage.locator('#xmind-line-pattern').selectOption('dash');await xmindPage.locator('#xmind-node-shape').selectOption('ellipse');const styling=await xmindPage.evaluate(()=>({layout:xmindSheet().codescopeLayout,style:xmindSheet().codescopeStyle,engineLayout:XMIND_MAP.getLayout()}));if(styling.layout!=='treeTable'||styling.engineLayout!=='catalogOrganization'||styling.style.lineStyle!=='direct'||styling.style.linePattern!=='dash'||styling.style.nodeShape!=='ellipse')throw new Error('树形表格或节点/连线样式未生效：'+JSON.stringify(styling));
  await xmindPage.waitForTimeout(160);
  if(await xmindPage.locator('#xmind-outline .xmind-tree-children').count()<2)throw new Error('XMind 大纲未按嵌套树线显示层级');
  const outlineBefore=await xmindPage.locator('#xmind-outline').evaluate(el=>el.getBoundingClientRect().width),resizerBox=await xmindPage.locator('#xmind-outline-resizer').boundingBox();
  if(!resizerBox)throw new Error('XMind 大纲宽度调整柄不可见');
  await xmindPage.mouse.move(resizerBox.x+resizerBox.width/2,resizerBox.y+80);await xmindPage.mouse.down();await xmindPage.mouse.move(resizerBox.x+resizerBox.width/2+72,resizerBox.y+80,{steps:8});await xmindPage.mouse.up();
  const outlineAfter=await xmindPage.locator('#xmind-outline').evaluate(el=>el.getBoundingClientRect().width);if(outlineAfter<outlineBefore+55)throw new Error('XMind 大纲无法水平拖拽调整宽度');
  const engineBox=await xmindPage.locator('#xmind-engine').boundingBox();
  await xmindPage.evaluate(()=>xmindSetToolMode('select'));const selectDragBefore=await xmindPage.evaluate(()=>xmindMapTranslation(true));await xmindPage.mouse.move(engineBox.x+24,engineBox.y+engineBox.height-24);await xmindPage.mouse.down();await xmindPage.mouse.move(engineBox.x+124,engineBox.y+engineBox.height-64,{steps:10});await xmindPage.mouse.up();const selectDragAfter=await xmindPage.evaluate(()=>xmindMapTranslation(true));if(selectDragAfter.x<selectDragBefore.x+80||selectDragAfter.y>selectDragBefore.y-25)throw new Error('选择模式无法从画布空白处自由平移整张导图：'+JSON.stringify({selectDragBefore,selectDragAfter}));
  const viewportBefore=await xmindPage.evaluate(()=>xmindMapTranslation(true));
  await xmindPage.locator('#xmind-engine').evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,ctrlKey:true,clientX:900,clientY:450,bubbles:true,cancelable:true})));
  await xmindPage.waitForFunction(scale=>XMIND_MAP.view.scale>scale,viewportBefore.scale);
  const zoomed=await xmindPage.evaluate(()=>xmindMapTranslation(true));if(zoomed.scale<=viewportBefore.scale)throw new Error('XMind Ctrl/Meta+滚轮未以指针缩放');
  await xmindPage.locator('#xmind-engine').evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaX:96,deltaY:0,bubbles:true,cancelable:true})));
  const panned=await xmindPage.evaluate(()=>xmindMapTranslation(true));if(Math.abs(panned.x-zoomed.x)<70)throw new Error('XMind 触控板/滚轮无法横向平移画布');
  await xmindPage.locator('#xmind-more').evaluate(el=>el.open=true);await xmindPage.locator('#xmind-pan-mode').click();const dragStart=await xmindPage.evaluate(()=>xmindMapTranslation(true));await xmindPage.mouse.move(engineBox.x+engineBox.width*.82,engineBox.y+engineBox.height*.82);await xmindPage.mouse.down();await xmindPage.mouse.move(engineBox.x+engineBox.width*.82+90,engineBox.y+engineBox.height*.82+24,{steps:10});await xmindPage.mouse.up();const dragEnd=await xmindPage.evaluate(()=>xmindMapTranslation(true));if(dragEnd.x<dragStart.x+70)throw new Error('XMind 移动画布模式无法自由拖拽画布');
  if(xmindErrors.length)throw new Error('XMind 浏览器运行错误：'+xmindErrors.join('；'));
  await xmindPage.close();

  /* ---- Markdown 块编辑器：Milkdown Crepe 输入、撤销、斜杠菜单、拖拽与落盘 ---- */
  const readingPage=await browser.newPage({viewport:{width:1440,height:900}}),readingErrors=[];
  readingPage.on('pageerror',error=>readingErrors.push(String(error.message||error)));
  await readingPage.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await readingPage.locator('.reading-project').filter({hasText:'Block Drag Demo'}).click();
  await readingPage.locator('.reading-project-tab').filter({hasText:'note'}).click();
  /* 阅读片段标签与代码工作区一致：不再有悬停才出现的行内 ✎/×，一律走右键菜单 */
  const readingTabInline=await readingPage.evaluate(()=>({
    inlineButtons:document.querySelectorAll('.reading-project-tab button, .reading-project-tab .tab-action').length,
  }));
  if(readingTabInline.inlineButtons!==0)throw new Error('阅读片段标签仍存在行内 ✎/× 按钮：'+JSON.stringify(readingTabInline));
  await readingPage.locator('.reading-project-tab').first().hover();
  await readingPage.waitForTimeout(350);
  const readingTabHovered=await readingPage.evaluate(()=>[...document.querySelectorAll('.reading-project-tab button')].filter(button=>button.offsetParent!==null).length);
  if(readingTabHovered!==0)throw new Error('阅读片段标签悬停仍显示行内按钮：'+readingTabHovered);
  await readingPage.locator('.reading-project-tab').first().click({button:'right'});
  await readingPage.waitForTimeout(300);
  const readingTabMenu=await readingPage.evaluate(()=>[...document.querySelectorAll('#ctx-menu .ctx-item .ctx-label')].map(node=>node.textContent));
  for(const text of ['打开此片段','在另一栏打开','重命名片段','删除片段'])if(!readingTabMenu.includes(text))throw new Error('阅读片段标签右键菜单缺少「'+text+'」：'+JSON.stringify(readingTabMenu));
  await readingPage.keyboard.press('Escape');
  const readingTabStyle=await readingPage.evaluate(()=>{const tab=document.querySelector('.reading-project-tab'),cs=getComputedStyle(tab),role=tab.querySelector('.tab-role');return{height:Math.round(tab.getBoundingClientRect().height),radius:parseFloat(cs.borderTopLeftRadius),border:cs.borderTopWidth,roleChip:role?getComputedStyle(role).borderTopWidth!=='0px':false};});
  if(readingTabStyle.height!==34||readingTabStyle.radius!==6||readingTabStyle.border!=='0px'||!readingTabStyle.roleChip)throw new Error('阅读片段标签外观未与代码工作区统一：'+JSON.stringify(readingTabStyle));
  const live=readingPage.locator('.reading-md-block');await live.waitFor({state:'visible',timeout:10000});
  await live.locator('.ProseMirror').waitFor({state:'visible',timeout:15000});
  if(!await live.evaluate(el=>el.dataset.editorReady==='true'))throw new Error('Milkdown Crepe 区块编辑器未完成挂载');
  if(await live.locator('.reading-md-block-loading').count())throw new Error('Milkdown Crepe 挂载后仍残留加载占位层');
  /* Markdown 模式会隐藏整行栏头，栏头里的「关闭此栏」也跟着没了，所以工具栏必须另有一个，
     否则 Markdown 栏关不掉（双栏并排时想关掉右边那栏会找不到入口）。 */
  const readingColClose=await readingPage.evaluate(()=>{const b=document.querySelector('.reading-col[data-slot="0"] .reading-md-close-col');return{exists:!!b,visible:!!b&&b.offsetParent!==null,title:b?b.title:''}});
  if(!readingColClose.exists||!readingColClose.visible)throw new Error('Markdown 阅读栏缺少可用的「关闭此栏」入口：'+JSON.stringify(readingColClose));
  const liveBox=await live.boundingBox(),editorBox=await live.locator('.ProseMirror').boundingBox(),editorTopGap=liveBox&&editorBox?editorBox.y-liveBox.y:Infinity;if(editorTopGap>150)throw new Error('Milkdown Crepe 编辑正文被异常挤到工作区下方：'+editorTopGap+'px');
  const zoomTools=readingPage.locator('.reading-md-zoom');if(await zoomTools.locator('.value').innerText()!=='100%')throw new Error('Markdown 缩放工具未显示默认比例');await zoomTools.locator('button').last().click();const readingZoomState=await readingPage.evaluate(()=>{const editor=document.querySelector('.reading-md-block .ProseMirror');return{value:document.querySelector('.reading-md-zoom .value')?.textContent,fontSize:getComputedStyle(editor).fontSize,inlineFontSize:editor?.style.fontSize}});if(parseFloat(readingZoomState.fontSize)<=17.4)throw new Error('Markdown 字体级缩放未生效：'+JSON.stringify(readingZoomState));await live.dispatchEvent('wheel',{ctrlKey:true,deltaY:-100});await readingPage.waitForFunction(()=>document.querySelector('.reading-md-zoom .value').textContent==='115%');await zoomTools.locator('.value').click();await readingPage.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.querySelector('.reading-md-block .ProseMirror')).fontSize)-16)<.1);
  /* 窄栏（栏宽 < 900px）下大纲是覆盖层，默认收起以免一进来就盖住正文，所以先展开它才能测。 */
  const outlineOpenState=()=>readingPage.locator('.reading-md-workbench').evaluate(el=>el.classList.contains('outline-open'));
  const outlineToggle=readingPage.locator('.reading-md-outline-toggle');
  if(!await outlineOpenState())await outlineToggle.click();
  const mdOutline=readingPage.locator('.reading-md-outline');await mdOutline.waitFor({state:'visible'});const outlinePosition=await readingPage.evaluate(()=>{const outline=document.querySelector('.reading-md-outline').getBoundingClientRect(),workbench=document.querySelector('.reading-md-workbench').getBoundingClientRect();return{outlineLeft:outline.left,workbenchLeft:workbench.left}});if(Math.abs(outlinePosition.outlineLeft-outlinePosition.workbenchLeft)>4)throw new Error('Markdown 大纲未放在工作区左侧：'+JSON.stringify(outlinePosition));const outlineItems=mdOutline.locator('.reading-md-outline-item');if(await outlineItems.count()!==3||!await outlineItems.filter({hasText:'Section A'}).count())throw new Error('Markdown 大纲未按标题层级生成');await outlineItems.filter({hasText:'Section B'}).click();await readingPage.waitForTimeout(350);if(!await mdOutline.locator('.reading-md-outline-item.active').filter({hasText:'Section B'}).count())throw new Error('Markdown 大纲点击定位后未高亮当前章节');/* 覆盖层模式下跳转完要自动收起，别让正文一直半遮着；宽栏的并排侧栏则保持不动。 */
  const outlineIsOverlay=await readingPage.locator('.reading-md-workbench').evaluate(el=>getComputedStyle(el.querySelector('.reading-md-outline')).position==='absolute');
  if(outlineIsOverlay&&await outlineOpenState())throw new Error('Markdown 大纲在覆盖层模式下跳转后没有自动收起');
  await outlineToggle.click();if(!await outlineOpenState())throw new Error('Markdown 大纲无法展开');
  await outlineToggle.click();if(await outlineOpenState())throw new Error('Markdown 大纲无法关闭');
  await outlineToggle.click();
  const tableBlock=live.locator('.milkdown-table-block').first(),columnResizer=tableBlock.locator('.codescope-table-resizer').first();await readingPage.waitForTimeout(1000);if(!await columnResizer.count())throw new Error('Markdown 表格列宽拖拽柄未生成：'+JSON.stringify({errors:readingErrors,html:(await tableBlock.evaluate(el=>el.outerHTML)).slice(0,4000)}));await columnResizer.waitFor({state:'visible'});await columnResizer.hover();const resizeBox=await columnResizer.boundingBox();if(!resizeBox)throw new Error('Markdown 表格列宽拖拽柄不可见');const widthsBefore=await tableBlock.locator('th').evaluateAll(cells=>cells.map(cell=>cell.getBoundingClientRect().width));await readingPage.mouse.move(resizeBox.x+resizeBox.width/2,resizeBox.y+36);await readingPage.mouse.down();await readingPage.mouse.move(resizeBox.x+resizeBox.width/2+74,resizeBox.y+36,{steps:8});await readingPage.mouse.up();const widthsAfter=await tableBlock.locator('th').evaluateAll(cells=>cells.map(cell=>cell.getBoundingClientRect().width));if(widthsAfter[0]<widthsBefore[0]+55||widthsAfter[1]>widthsBefore[1]-55)throw new Error('Markdown 表格列之间无法自由拖拽调整：'+JSON.stringify({widthsBefore,widthsAfter}));await readingPage.waitForFunction(()=>READING_TEXT_DOCS.get(READING_CURRENT).content.includes('codescope-table-layout:'));
  if(await readingPage.locator('.reading-block-tools').count())throw new Error('阅读模块仍显示旧的自制区块工具');
  const readingMdBefore=await readingPage.evaluate(()=>READING_TEXT_DOCS.get(READING_CURRENT).content);
  await live.locator('p').first().click();await readingPage.keyboard.press('End');await readingPage.keyboard.type(' undo-smoke');
  await readingPage.waitForFunction((before)=>READING_TEXT_DOCS.get(READING_CURRENT).content!==before,readingMdBefore);
  await readingPage.waitForTimeout(140);
  await readingPage.keyboard.press('Meta+z');
  await readingPage.waitForFunction(()=>!READING_TEXT_DOCS.get(READING_CURRENT).content.includes('undo-smoke'));
  await readingPage.keyboard.press('Meta+Shift+z');
  await readingPage.waitForFunction(()=>READING_TEXT_DOCS.get(READING_CURRENT).content.includes('undo-smoke'));
  await readingPage.keyboard.press('Meta+z');
  await readingPage.waitForFunction(()=>!READING_TEXT_DOCS.get(READING_CURRENT).content.includes('undo-smoke'));
  await live.locator('p').first().click();await readingPage.keyboard.press('End');
  await live.locator('.ProseMirror').evaluate((editor)=>{const clipboard=new DataTransfer();clipboard.setData('text/plain','## Paste Render Smoke\n\n- pasted alpha\n- pasted beta');editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));});
  await live.getByRole('heading',{name:'Paste Render Smoke'}).waitFor({state:'visible'});
  await readingPage.waitForFunction(()=>READING_TEXT_DOCS.get(READING_CURRENT).content.includes('## Paste Render Smoke'));
  const pastedMarkdownState=await readingPage.evaluate(()=>({markdown:READING_TEXT_DOCS.get(READING_CURRENT).content,heading:[...document.querySelectorAll('.reading-md-block .ProseMirror h2')].find(node=>node.textContent==='Paste Render Smoke')?.textContent,items:[...document.querySelectorAll('.reading-md-block .ProseMirror li')].map(node=>node.textContent.trim())}));
  if(!pastedMarkdownState.markdown.includes('## Paste Render Smoke')||!pastedMarkdownState.items.includes('pasted alpha')||!pastedMarkdownState.items.includes('pasted beta'))throw new Error('粘贴 Markdown 未自动解析为标题与列表：'+JSON.stringify(pastedMarkdownState));
  await readingPage.keyboard.press('Meta+z');await readingPage.waitForFunction(()=>!READING_TEXT_DOCS.get(READING_CURRENT).content.includes('Paste Render Smoke'));
  const paragraph=live.locator('p').first();await paragraph.click();await readingPage.keyboard.press('End');await readingPage.keyboard.press('Enter');await readingPage.keyboard.type('/');
  const slash=readingPage.locator('.milkdown-slash-menu[data-show="true"]');await slash.waitFor({state:'visible'});if(!await slash.getByText('基础区块').count()||!await slash.getByText('表格').count())throw new Error('Milkdown 中文斜杠菜单缺少基础或高级区块');await readingPage.keyboard.press('Escape');await readingPage.keyboard.press('Backspace');await readingPage.keyboard.press('Backspace');
  const dragHandle=readingPage.locator('.milkdown-block-handle');
  const sectionA=live.getByRole('heading',{name:'Section A'}),sectionB=live.getByRole('heading',{name:'Section B'});
  await zoomTools.locator('button').first().click();await zoomTools.locator('button').first().click();
  const listBaseline=await readingPage.evaluate(()=>{const block=document.querySelector('.reading-md-block .milkdown-list-item-block'),item=block?.querySelector('.list-item'),labelElement=item?.querySelector('.label-wrapper'),paragraphElement=item?.querySelector('.children p'),label=labelElement?.getBoundingClientRect(),paragraph=paragraphElement?.getBoundingClientRect();return label&&paragraph?{labelCenter:label.top+label.height/2,textCenter:paragraph.top+Math.min(paragraph.height,parseFloat(getComputedStyle(paragraphElement).lineHeight))/2}:{html:block?.outerHTML?.slice(0,1200)||null};});if(!listBaseline||listBaseline.html||Math.abs(listBaseline.labelCenter-listBaseline.textCenter)>2)throw new Error('Markdown 列表标记未与首行文字对齐：'+JSON.stringify(listBaseline));
  const paragraphAtZoom=live.locator('p').first();await paragraphAtZoom.click();await readingPage.keyboard.press('End');const caretAlignment=await readingPage.evaluate(()=>{const paragraph=document.querySelector('.reading-md-block .ProseMirror p'),selection=getSelection(),range=selection&&selection.rangeCount?selection.getRangeAt(0):null,caret=range?.getBoundingClientRect(),box=paragraph?.getBoundingClientRect();return caret&&box?{caret:caret.toJSON(),paragraph:box.toJSON(),anchorInside:paragraph.contains(selection.anchorNode)}:null;});if(!caretAlignment||!caretAlignment.anchorInside||caretAlignment.caret.top<caretAlignment.paragraph.top-2||caretAlignment.caret.bottom>caretAlignment.paragraph.bottom+2)throw new Error('Markdown 缩放后光标未落在当前文本行：'+JSON.stringify(caretAlignment));
  await sectionA.hover();await readingPage.waitForFunction(()=>document.querySelector('.milkdown-block-handle')?.dataset.show==='true');await readingPage.waitForTimeout(250);
  const handleAlignment=await readingPage.evaluate(()=>{const handle=document.querySelector('.milkdown-block-handle').getBoundingClientRect(),heading=[...document.querySelectorAll('.reading-md-block .ProseMirror h2')].find(node=>node.textContent.includes('Section A')).getBoundingClientRect();return{horizontalGap:heading.left-handle.right,verticalGap:Math.abs((heading.top+heading.height/2)-(handle.top+handle.height/2)),handle:handle.toJSON(),heading:heading.toJSON()}});if(handleAlignment.horizontalGap<0||handleAlignment.horizontalGap>48||handleAlignment.verticalGap>28)throw new Error('Markdown 区块手柄在 80% 缩放下未对齐正文块：'+JSON.stringify(handleAlignment));await zoomTools.locator('.value').click();await sectionA.hover();await readingPage.waitForTimeout(300);
  const transformHandle=dragHandle.locator('.operation-item').nth(1),transformMenu=readingPage.locator('.codescope-block-transform-menu[data-show="true"]');
  await transformHandle.click();await transformMenu.waitFor({state:'visible'});if(!await transformMenu.getByText('转换为',{exact:true}).count()||!await transformMenu.getByText('正文',{exact:true}).count()||!await transformMenu.getByText('一级标题',{exact:true}).count()||!await transformMenu.getByText('公式',{exact:true}).count()||!await transformMenu.getByText('插入图片',{exact:true}).count()||!await transformMenu.getByText('删除区块',{exact:true}).count())throw new Error('六点手柄未显示完整的 Notion 式区块操作菜单');
  await transformMenu.getByText('一级标题',{exact:true}).click();await live.getByRole('heading',{name:'Section A',level:1}).waitFor({state:'visible'});await readingPage.waitForFunction(()=>READING_TEXT_DOCS.get(READING_CURRENT).content.includes('# Section A'));
  await live.getByRole('heading',{name:'Section A',level:1}).hover();await readingPage.waitForFunction(()=>document.querySelector('.milkdown-block-handle')?.dataset.show==='true');await transformHandle.click();await transformMenu.getByText('公式',{exact:true}).click();await readingPage.waitForFunction(()=>READING_TEXT_DOCS.get(READING_CURRENT).content.includes('$$\nSection A\n$$'));
  const formulaBlock=live.locator('.milkdown-code-block');await formulaBlock.hover();await readingPage.waitForFunction(()=>document.querySelector('.milkdown-block-handle')?.dataset.show==='true');await transformHandle.click();await transformMenu.getByText('正文',{exact:true}).click();await live.locator('p').filter({hasText:'Section A'}).waitFor({state:'visible'});
  await live.locator('p').filter({hasText:'Section A'}).hover();await readingPage.waitForFunction(()=>document.querySelector('.milkdown-block-handle')?.dataset.show==='true');await transformHandle.click();await transformMenu.getByText('二级标题',{exact:true}).click();await live.getByRole('heading',{name:'Section A',level:2}).waitFor({state:'visible'});
  if(await dragHandle.getAttribute('draggable')!=='true')throw new Error('Milkdown 区块手柄不可拖拽');
  await dragHandle.dragTo(sectionB);await readingPage.waitForTimeout(250);
  const headings=await live.locator('h2').allTextContents();if(headings.join('|')!=='Section B|Section A')throw new Error('Milkdown 标题区块拖拽排序失败：'+JSON.stringify(headings));
  await readingPage.waitForTimeout(850);const savedNote=fs.readFileSync(readingNotePath,'utf8');
  if(!savedNote.startsWith('---\ntitle: Block Drag Demo')||savedNote.indexOf('## Section B')>savedNote.indexOf('## Section A')||!savedNote.includes(readingReference)||!savedNote.includes('codescope-table-layout:'))throw new Error('Markdown frontmatter、引用、表格列宽或区块拖拽结果未持久化：'+savedNote);
  const paragraphA=live.locator('p').filter({hasText:'Paragraph A.'});await paragraphA.hover();await readingPage.waitForFunction(()=>document.querySelector('.milkdown-block-handle')?.dataset.show==='true');await transformHandle.click();await transformMenu.getByText('删除区块',{exact:true}).click();await paragraphA.waitFor({state:'detached'});await readingPage.waitForFunction(()=>!READING_TEXT_DOCS.get(READING_CURRENT).content.includes('Paragraph A.'));
  await readingPage.evaluate(async()=>{await loadReadings(true);await openReading('知识库/浏览器测试/图片项目/图片插入.md',0);});await live.locator('.ProseMirror').waitFor({state:'visible',timeout:15000});await readingPage.waitForFunction(()=>document.querySelector('.reading-md-block')?.dataset.editorReady==='true');
  const imageAnchor=live.locator('p').filter({hasText:'在此区块后插入图片。'});await imageAnchor.hover();await readingPage.waitForFunction(()=>document.querySelector('.milkdown-block-handle')?.dataset.show==='true');const chooserPromise=readingPage.waitForEvent('filechooser');await transformHandle.click();await transformMenu.getByText('插入图片',{exact:true}).click();const chooser=await chooserPromise;await chooser.setFiles({name:'像素.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
  const insertedImage=live.locator('.milkdown-image-block img').first();await insertedImage.waitFor({state:'visible',timeout:15000});await readingPage.waitForFunction(()=>{const image=document.querySelector('.reading-md-block .milkdown-image-block img');return image&&image.naturalWidth>0&&image.getAttribute('src')?.startsWith('/images/');});await readingPage.waitForTimeout(850);const savedImageNote=fs.readFileSync(knowledgeImageNotePath,'utf8');if(!/!\[1\.00\]\(\/images\/.+\.png\)/.test(savedImageNote)||savedImageNote.includes(']()'))throw new Error('图片区块保存后丢失地址：'+savedImageNote);
  if(readingErrors.length)throw new Error('Markdown 区块浏览器运行错误：'+readingErrors.join('；'));

  /* ---- 统一资料阅读：DOCX 原貌渲染、网页正文提取与缩放 ---- */
  await readingPage.route('**/api/readings/web/page?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,url:'https://example.com/book/chapter-1.html',title:'第一章',html:'<main><h1>第一章正文</h1><p>目录内跳转保持在阅读模块。</p></main>',navigationHtml:'<nav><a href="index.html">上一页</a><a href="chapter-2.html">下一页</a></nav>',navigationUrl:'https://example.com/book/chapter-1.html'})}));
  await readingPage.route('**/api/readings/web?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,url:'https://example.com/book/index.html',title:'网页阅读测试',html:'<article><h2 id="web-intro">网页正文</h2><p id="web-quote">网页地址也可以保存为阅读资料。</p><table><tbody><tr><td>整张页面缩放测试</td></tr></tbody></table><script>window.__unsafe=true</script></article>',navigationHtml:'<ol class="chapter"><li><a href="index.html">首页</a></li><li><a href="chapter-1.html">第一章</a></li></ol>',navigationUrl:'https://example.com/book/toc.html'})}));
  await readingPage.evaluate(async()=>{closeReading();await loadReadings(true);const project=[...READING_PROJECT_INDEX.values()].find(item=>item.name==='Universal Reading Demo');if(!project)throw new Error('找不到统一资料阅读项目');await openReadingProject(project);const doc=project.children.find(item=>item.kind==='docx');await openReading(doc.path,0);});
  await readingPage.locator('.reading-docx-host').waitFor({state:'visible',timeout:15000});
  if(!await readingPage.locator('.reading-docx-host').getByText('DOCX 正文可以直接在阅读项目中渲染。').count())throw new Error('DOCX 未在阅读项目中完成原貌渲染');
  const assetZoom=readingPage.locator('.reading-asset-toolbar .zoom-value');if(await assetZoom.innerText()!=='100%')throw new Error('Office 阅读缩放未显示默认比例');await readingPage.locator('.reading-asset-toolbar button').last().click();if(await assetZoom.innerText()!=='110%')throw new Error('Office 阅读缩放按钮未生效');
  await readingPage.evaluate(async()=>{const project=[...READING_PROJECT_INDEX.values()].find(item=>item.name==='Universal Reading Demo'),web=project.children.find(item=>item.kind==='web');await openReading(web.path,0);});
  await readingPage.locator('.reading-web-article').waitFor({state:'visible',timeout:10000});
  if(!await readingPage.locator('.reading-web-article').getByText('网页地址也可以保存为阅读资料。').count()||await readingPage.locator('.reading-web-article script').count())throw new Error('网页阅读正文未渲染或危险脚本未清理');
  const webNav=readingPage.locator('.reading-web-nav');if(!await webNav.getByText('第一章',{exact:true}).count())throw new Error('网页阅读未显示网站章节目录');
  const webScaleBefore=await readingPage.locator('.reading-web-article').evaluate(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,fontSize:getComputedStyle(element).fontSize}));
  await readingPage.locator('.reading-web-zoom-range').fill('150');
  const webScaleAfter=await readingPage.locator('.reading-web-article').evaluate(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,fontSize:getComputedStyle(element).fontSize}));
  if(webScaleAfter.width<webScaleBefore.width*1.4||webScaleAfter.height<webScaleBefore.height*1.4||webScaleAfter.fontSize!==webScaleBefore.fontSize)throw new Error('网页缩放仍只改变字体，未缩放整张页面：'+JSON.stringify({webScaleBefore,webScaleAfter}));
  await readingPage.locator('#web-quote').evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await readingPage.locator('.reading-web-action').filter({hasText:'摘录'}).click();await readingPage.waitForFunction(()=>Number(document.querySelector('#reading-frag-count').textContent)===1);
  const webFragment=await readingPage.evaluate(()=>{const project=[...READING_PROJECT_INDEX.values()].find(item=>item.name==='Universal Reading Demo'),web=project.children.find(item=>item.kind==='web'),doc=READING_DOCS.get(web.path),item=doc?.meta?.fragments?.[0];return item&&{url:item.url,webStart:item.webStart,webEnd:item.webEnd,source:item.source};});
  if(!webFragment||webFragment.url!=='https://example.com/book/index.html'||webFragment.webEnd<=webFragment.webStart||!webFragment.source.includes('网页地址'))throw new Error('网页摘录没有保存章节与正文定位：'+JSON.stringify(webFragment));
  await webNav.getByText('第一章',{exact:true}).click();await readingPage.getByText('目录内跳转保持在阅读模块。').waitFor({state:'visible'});
  if(!await webNav.locator('a.active').getByText('第一章',{exact:true}).count()||!await webNav.getByText('首页',{exact:true}).count()||await readingPage.locator('.reading-web-chapter-pos').innerText()!=='2 / 2')throw new Error('切换章节后整站目录被当前页导航覆盖或高亮未同步');
  await readingPage.locator('.reading-frag').filter({hasText:'网页地址也可以保存为阅读资料。'}).getByRole('button',{name:'定位'}).click();await readingPage.locator('#web-quote').waitFor({state:'visible'});await readingPage.waitForFunction(()=>getSelection()?.toString().includes('网页地址也可以保存为阅读资料。'));

  /* ---- 阅读 HTML 源码：编辑后右侧必须自动渲染并自动落盘 ---- */
  /* 回归：编辑器实例没有 isDisposed()，getSource() 抛错会让 onChange 后半段（自动保存、预览刷新）整体静默失效，
     表现为“左侧粘进了代码，右侧仍显示旧内容、磁盘也不更新”。 */
  await readingPage.evaluate(async()=>{closeReading();await loadReadings(true);const project=[...READING_PROJECT_INDEX.values()].find(item=>item.name==='Universal Reading Demo');if(!project)throw new Error('找不到统一资料阅读项目');const html=project.children.find(item=>item.kind==='html');if(!html)throw new Error('统一资料阅读项目缺少 HTML 片段');await openReading(html.path,0);});
  await readingPage.locator('.reading-html-source .monaco-editor').waitFor({state:'visible',timeout:60000});
  if(!(await readingPage.locator('.reading-html-preview').getAttribute('srcdoc')).includes('导图.html'))throw new Error('阅读 HTML 预览未绑定当前片段的初始内容');
  const readingHtmlSource='<!doctype html>\n<html><body><div id="reading-html-probe">阅读 HTML 预览联动</div><script>document.getElementById("reading-html-probe").dataset.ran="1";<\/script></body></html>\n';
  await readingPage.locator('.reading-html-source .monaco-editor .view-lines').click();
  await readingPage.keyboard.press('Meta+A');
  await readingPage.keyboard.insertText(readingHtmlSource);
  await readingPage.waitForFunction(()=>document.querySelector('.reading-html-preview')?.getAttribute('srcdoc')?.includes('阅读 HTML 预览联动'),null,{timeout:15000});
  const readingHtmlFrame=readingPage.frameLocator('.reading-html-preview');
  await readingHtmlFrame.locator('#reading-html-probe').waitFor({state:'visible',timeout:15000});
  if(await readingHtmlFrame.locator('#reading-html-probe').getAttribute('data-ran')!=='1')throw new Error('阅读 HTML 预览未执行片段脚本');
  let readingHtmlDisk='';
  for(let attempt=0;attempt<60;attempt+=1){readingHtmlDisk=fs.readFileSync(readingHtmlPath,'utf8');if(readingHtmlDisk.includes('阅读 HTML 预览联动')&&readingHtmlDisk.includes('dataset.ran'))break;await readingPage.waitForTimeout(200);}
  if(!readingHtmlDisk.includes('阅读 HTML 预览联动')||!readingHtmlDisk.includes('dataset.ran'))throw new Error('阅读 HTML 源码编辑未自动保存到磁盘：'+readingHtmlDisk.slice(0,200));
  if((await readingPage.locator('.reading-text-foot').innerText()).includes('读取编辑器内容失败'))throw new Error('阅读 HTML 源码编辑器读取内容失败');

  /* HTML 片段不该占用右侧摘录面板，也不该显示不可用的摘录/翻译按钮，但引用与复制链接要保留；
     源码默认软换行（长行不被横向截断），源码与预览之间必须有可见的分栏线。 */
  const readingHtmlChrome=await readingPage.evaluate(()=>{
    const hidden=(sel)=>{const el=document.querySelector(sel);return !el||getComputedStyle(el).display==='none';};
    const split=document.querySelector('.reading-html-split');
    const editor=window.monaco&&window.monaco.editor.getEditors().find((item)=>item.getContainerDomNode().closest('.reading-html-source'));
    return {
      fragmentsHidden:hidden('#reading-fragments'),resizerHidden:hidden('#reading-fragments-resizer'),toggleHidden:hidden('#reading-frag-toggle'),
      addFragmentHidden:hidden('#reading-add-fragment'),translateAllHidden:hidden('#reading-translate-all'),
      backlinksVisible:!hidden('#reading-backlinks'),copyLinkVisible:!hidden('#reading-copy-link'),
      splitColor:split?getComputedStyle(split,'::after').backgroundColor:'',
      wordWrap:editor?editor.getOption(window.monaco.editor.EditorOption.wordWrap):'',
    };
  });
  if(!readingHtmlChrome.fragmentsHidden||!readingHtmlChrome.resizerHidden||!readingHtmlChrome.toggleHidden)throw new Error('HTML 片段仍占用右侧摘录面板宽度：'+JSON.stringify(readingHtmlChrome));
  if(!readingHtmlChrome.addFragmentHidden||!readingHtmlChrome.translateAllHidden)throw new Error('HTML 片段仍显示不可用的摘录/翻译按钮：'+JSON.stringify(readingHtmlChrome));
  if(!readingHtmlChrome.backlinksVisible||!readingHtmlChrome.copyLinkVisible)throw new Error('HTML 片段误隐藏了仍可用的引用/复制链接按钮：'+JSON.stringify(readingHtmlChrome));
  if(!readingHtmlChrome.splitColor||/rgba?\(0,\s*0,\s*0,\s*0\)/.test(readingHtmlChrome.splitColor))throw new Error('阅读 HTML 源码与预览之间没有可见的分栏线：'+JSON.stringify(readingHtmlChrome));
  if(readingHtmlChrome.wordWrap!=='on')throw new Error('阅读 HTML 源码未启用自动换行，长行会被横向截断：'+String(readingHtmlChrome.wordWrap));
  /* 切到 Markdown 片段后，摘录面板与其开关必须恢复：HTML 的隐藏不能是永久性的 */
  await readingPage.evaluate(async()=>{await openReading('Block Drag Demo/note.md',0);});
  await readingPage.waitForFunction(()=>{const panel=document.getElementById('reading-fragments');return !!panel&&!panel.classList.contains('hidden');},null,{timeout:15000});
  if(await readingPage.evaluate(()=>getComputedStyle(document.getElementById('reading-frag-toggle')).display==='none'))throw new Error('切回 Markdown 后摘录面板开关未恢复');
  if(readingErrors.length)throw new Error('阅读 HTML 浏览器运行错误：'+readingErrors.join('；'));

  /* ---- PDF.js 官方 Viewer：虚拟渲染、自由缩放、单页/双页与懒加载缩略图 ---- */
  await readingPage.evaluate(async()=>{closeReading();document.getElementById('document-mode-tools').classList.add('show','markdown');await loadReadings(true);const project=[...READING_PROJECT_INDEX.values()].find(item=>item.name==='PDF Viewer Demo');if(!project)throw new Error('找不到 PDF Viewer Demo');await openReadingProject(project);});
  const pdfHost=readingPage.locator('.reading-pdf-host');await pdfHost.waitFor({state:'visible',timeout:15000});
  if(await readingPage.locator('#document-mode-tools').isVisible())throw new Error('PDF 阅读工作区错误显示了代码文档模式切换器');
  await readingPage.waitForFunction(()=>window.__readingPdfViewer?.pdfViewer?.pagesCount===40&&document.querySelectorAll('.reading-pdf-host .pdfViewer .page').length===40,null,{timeout:15000});
  const initialPdf=await readingPage.evaluate(()=>({pages:document.querySelectorAll('.reading-pdf-host .pdfViewer .page').length,canvases:document.querySelectorAll('.reading-pdf-host .pdfViewer .page canvas').length,badge:document.querySelector('.pdf-official-badge')?.textContent,edit:document.querySelector('.pdf-tool-primary')?.textContent}));
  if(initialPdf.pages!==40||initialPdf.canvases>=initialPdf.pages||initialPdf.badge!=='PDF.js Viewer'||!initialPdf.edit.includes('ONLYOFFICE'))throw new Error('PDF.js 官方 Viewer 或虚拟渲染异常：'+JSON.stringify(initialPdf));
  const zoomBefore=Number((await readingPage.locator('.pdf-zoom-pct').innerText()).replace('%',''));await readingPage.locator('.pdf-toolbar button[title="放大"]').click();await readingPage.waitForFunction(before=>Number(document.querySelector('.pdf-zoom-pct').textContent.replace('%',''))>before,zoomBefore);
  await readingPage.locator('.pdf-layout-select').selectOption('single');await readingPage.waitForFunction(()=>document.querySelectorAll('.reading-pdf-host .pdfViewer .page').length===1);
  await readingPage.locator('.pdf-layout-select').selectOption('spread');await readingPage.waitForFunction(()=>document.querySelectorAll('.reading-pdf-host .pdfViewer .spread').length>1&&document.querySelectorAll('.reading-pdf-host .pdfViewer .page').length===40);
  const spreadInitial=await readingPage.evaluate(()=>({spreads:document.querySelectorAll('.reading-pdf-host .pdfViewer .spread').length,pages:document.querySelectorAll('.reading-pdf-host .pdfViewer .page').length,canvases:document.querySelectorAll('.reading-pdf-host .pdfViewer .page canvas').length,scrollHeight:document.querySelector('.pdf-scroll').scrollHeight,clientHeight:document.querySelector('.pdf-scroll').clientHeight}));
  if(spreadInitial.spreads<20||spreadInitial.pages!==40||spreadInitial.canvases>=spreadInitial.pages||spreadInitial.scrollHeight<=spreadInitial.clientHeight)throw new Error('PDF 双页未形成可滚动的连续懒加载布局：'+JSON.stringify(spreadInitial));
  await readingPage.locator('.pdf-scroll').evaluate(element=>{element.scrollTop=element.scrollHeight;});await readingPage.waitForFunction(()=>window.__readingPdfViewer.currentPage>2&&Number(document.querySelector('.reading-col .reading-page-input').value)>2,null,{timeout:8000});
  await readingPage.locator('.pdf-toolbar button[title="页面缩略图导航"]').click();await readingPage.locator('.pdf-thumb-panel').waitFor({state:'visible'});await readingPage.waitForTimeout(300);
  const thumbs=await readingPage.evaluate(()=>({items:document.querySelectorAll('.pdf-thumb-item').length,canvases:document.querySelectorAll('.pdf-thumb-item canvas').length,pending:document.querySelectorAll('.pdf-thumb-item .loading').length}));
  if(thumbs.items!==40||thumbs.canvases>=thumbs.items||thumbs.pending<1)throw new Error('PDF 缩略图未按可见区域懒加载：'+JSON.stringify(thumbs));
  await readingPage.close();

  if(errors.length)throw new Error('浏览器运行错误：'+errors.join('；'));
  console.log('CodeScope browser smoke: passed');
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close().catch(()=>{});
  if(server&&server.exitCode===null)server.kill();
  /* ⚠️ 知识库构建是**异步**的，测试跑完它可能还在往临时目录里写 ✗ →
     rmdir 抛 ENOTEMPTY，把「测试通过」变成非 0 退出码 ✗（实测踩过）。
     maxRetries 会让 rmSync 对 ENOTEMPTY/EBUSY 这类错误自动重试；
     最后再兜一层 try —— 清理失败不该判定测试失败 ✓。 */
  try { fs.rmSync(tempRoot,{recursive:true,force:true,maxRetries:20,retryDelay:150}); }
  catch(_) { /* 临时目录交给系统清理即可，不影响测试结论 */ }
});
