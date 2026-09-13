#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const projectRoot = path.resolve(__dirname, '..');
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

async function main() {
  const executablePath=browserExecutable();
  if(!executablePath){console.log('CodeScope browser smoke: skipped（未找到 Chrome/Chromium，可用 CODESCOPE_BROWSER 指定）');return;}
 fs.mkdirSync(path.join(vault,'code'),{recursive:true});
  fs.writeFileSync(path.join(tempRoot,'package.json'),JSON.stringify({name:'codescope-browser-fixture',private:true,scripts:{test:'node -e "process.exit(0)"'}},null,2));
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
  fs.writeFileSync(readingNotePath,'# Block Drag Demo\n\n## Section A\n\nParagraph A.\n\n## Section B\n\n- alpha\n- beta\n- gamma\n','utf8');
  const port=await freePort(),baseUrl='http://127.0.0.1:'+port;
  server=spawn(process.execPath,['server.js'],{cwd:projectRoot,env:{...process.env,CODESCOPE_HOST:'127.0.0.1',CODESCOPE_PORT:String(port),CODESCOPE_VAULT:vault,CODESCOPE_DATA_HOME:path.join(tempRoot,'data')},stdio:'ignore'});
  await waitForServer(baseUrl);
  browser=await chromium.launch({headless:true,executablePath,args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error.message||error)));
  await page.goto(baseUrl+'/?legacy-editor=1',{waitUntil:'domcontentloaded'});
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
  await page.locator('#code-ref-bar').waitFor({state:'visible'});
  if(await page.locator('#document-mode-tools').getByText('引用代码',{exact:false}).count())throw new Error('Markdown 顶部仍残留旧的引用代码按钮');
  await page.locator('#code-ref-add').click();
  /* ---- 普通 Markdown / HTML：片段级视图模式、可关闭预览与代码回链 ---- */
  await page.locator('#tabs .tab').filter({hasText:'README.md'}).locator('span').first().click();
  try{await page.locator('#document-mode-tools.show.markdown').waitFor({state:'visible',timeout:5000});}catch(error){const state=await page.evaluate(()=>({current:CURRENT&&CURRENT.fragments&&CURRENT.fragments[CINDEX],index:CINDEX,editing:EDITING,splits:SPLIT_EDITORS.length,tools:document.getElementById('document-mode-tools').outerHTML,display:getComputedStyle(document.getElementById('document-mode-tools')).display,pageErrors:[] }));throw new Error('Markdown 模式工具条未显示：'+JSON.stringify(state)+'\n'+error.message);}
  const markdownSourceState=await page.evaluate(()=>({
    markdownClass:document.getElementById('code-wrap').classList.contains('markdown-code'),
    liveHighlight:document.getElementById('code-edit').classList.contains('live-hl'),
    headingTokens:document.querySelectorAll('#code .hljs-section').length,
    lineNumbers:document.getElementById('ln').textContent.trim()
  }));
  if(!markdownSourceState.markdownClass||!markdownSourceState.liveHighlight||markdownSourceState.headingTokens<1||!markdownSourceState.lineNumbers)throw new Error('兼容编辑器 Markdown 高亮或行号不完整：'+JSON.stringify(markdownSourceState));
  if(!await page.locator('[data-doc-mode="split"]').evaluate(node=>node.classList.contains('on')))throw new Error('Markdown 默认没有保留源码/渲染分栏');
  await page.locator('#edit-preview .md-code-ref').waitFor({state:'visible'});
  const referenceSource=await page.locator('#code-edit').inputValue();
  if(!/\[\[code-ref:.*#fragment=0&line=\d+&end=\d+\|led\.h:\d+/.test(referenceSource))throw new Error('Markdown 未写入可持久化的代码位置引用');
  await page.locator('[data-doc-mode="source"]').click();
  if(await page.locator('#edit-preview').isVisible())throw new Error('Markdown 源码模式没有关闭右侧预览');
  await page.locator('[data-doc-mode="split"]').click();
  await page.locator('#edit-preview .edit-preview-close').click();
  if(!await page.locator('[data-doc-mode="source"]').evaluate(node=>node.classList.contains('on')))throw new Error('Markdown 预览关闭后未回到源码模式');
  await page.locator('[data-doc-mode="live"]').click();
  const liveMode=page.locator('#md-view.project-md-live');await liveMode.waitFor({state:'visible'});
  if((await liveMode.getAttribute('contenteditable'))!=='true')throw new Error('Markdown 实时模式不可原位编辑');
  const liveLayout=await page.evaluate(()=>{const view=document.getElementById('md-view'),host=document.getElementById('edit-split'),vr=view.getBoundingClientRect(),hr=host.getBoundingClientRect();return{full:view.classList.contains('project-md-full'),maxWidth:getComputedStyle(view).maxWidth,width:vr.width,hostWidth:hr.width,left:vr.left,hostLeft:hr.left};});
  if(!liveLayout.full||liveLayout.maxWidth!=='none'||liveLayout.width<liveLayout.hostWidth-2||Math.abs(liveLayout.left-liveLayout.hostLeft)>2)throw new Error('Markdown 实时模式没有占满工作区：'+JSON.stringify(liveLayout));
  const projectMdBefore=await page.locator('#code-edit').inputValue();
  await liveMode.locator('p').last().click();await liveMode.press('End');await liveMode.pressSequentially(' undo-smoke');
  await page.waitForFunction((before)=>document.getElementById('code-edit').value!==before,projectMdBefore);
  await page.keyboard.press('Meta+z');
  await page.waitForFunction((before)=>document.getElementById('code-edit').value===before,projectMdBefore);
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForFunction((before)=>document.getElementById('code-edit').value!==before,projectMdBefore);
  await page.keyboard.press('Meta+z');
  await page.waitForFunction((before)=>document.getElementById('code-edit').value===before,projectMdBefore);
  await page.locator('[data-doc-mode="preview"]').click();
  if((await page.locator('#md-view').getAttribute('contenteditable'))!=='false')throw new Error('Markdown 阅读模式仍处于编辑状态');
  if(!await page.locator('#md-view').evaluate(node=>node.classList.contains('project-md-full')))throw new Error('Markdown 阅读模式没有使用全宽阅读布局');
  await page.locator('[data-doc-mode="split"]').click();
  await page.locator('#edit-preview .md-code-ref').click();
  if(!(await page.locator('#tabs .tab.active').innerText()).includes('led.h')){const jumpState=await page.evaluate(()=>({current:CURRENT&&CURRENT.file,index:CINDEX,active:document.querySelector('#tabs .tab.active')&&document.querySelector('#tabs .tab.active').textContent,status:document.getElementById('status').textContent,refs:[...document.querySelectorAll('.md-code-ref')].map(node=>({...node.dataset,text:node.textContent}))}));throw new Error('Markdown 代码引用无法回跳到原代码片段：'+JSON.stringify(jumpState));}
  await page.locator('#btn-backlinks').click();
  await page.locator('#backlink-dialog.on').waitFor({state:'visible'});
  await page.locator('#backlink-list .backlink-row').filter({hasText:'README.md'}).waitFor({state:'visible'});
  await page.locator('#backlink-close').click();
  const workspaceInterop=await page.evaluate(()=>({codeLink:workspaceLinkMarkdown(currentWorkspaceTarget()),outline:mmMarkdownOutline('# Root\n\n## Child\n\n- Leaf'),snapshotKey:WORKSPACE_SNAPSHOT_KEY}));
  if(!workspaceInterop.codeLink.startsWith('[[code-ref:')||workspaceInterop.outline.length!==3||workspaceInterop.snapshotKey!=='mc-workspace-snapshot-v1')throw new Error('内部链接、XMind 大纲或工作台快照基础能力异常：'+JSON.stringify(workspaceInterop));
  await page.locator('#tabs .tab').filter({hasText:'demo.html'}).locator('span').first().click();
  await page.locator('#html-preview-frame').waitFor({state:'visible'});
  await page.locator('#edit-preview .edit-preview-close').click();
  if(await page.locator('#edit-preview').isVisible())throw new Error('HTML 右侧预览无法关闭');
  await page.locator('[data-doc-mode="preview"]').click();
  await page.locator('#html-preview-frame').waitFor({state:'visible'});
  if(await page.locator('#code-wrap').isVisible())throw new Error('HTML 全宽预览仍残留源码栏');
  await page.locator('#edit-preview .edit-preview-close').click();
  await page.locator('#tabs .tab').filter({hasText:'led.h'}).locator('span').first().click();
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
  // 缩进宽度可切换：点「⇥ 缩进」切到 4 空格，再切回
  const widthBefore=await page.evaluate(()=>currentIndentWidth());
  await page.locator('#btn-indent').click();
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
  await page.locator('#btn-indent').click();
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
  await idePage.locator('#btn-wrap').click();
  const wrapState=await idePage.evaluate(()=>({wordWrap:MONACO_EDITOR.getRawOptions().wordWrap,pressed:document.getElementById('btn-wrap').getAttribute('aria-pressed'),saved:localStorage.getItem('mc-editor-word-wrap')}));
  if(wrapState.wordWrap!=='on'||wrapState.pressed!=='true'||wrapState.saved!=='1')throw new Error('自动换行状态未同步：'+JSON.stringify(wrapState));
  await idePage.evaluate(()=>MONACO_EDITOR.setPosition({lineNumber:2,column:3}));
  await idePage.waitForFunction(()=>document.getElementById('editor-position').textContent==='Ln 2, Col 3');
  const proxySync=await idePage.evaluate(()=>{MONACO_EDITOR.setValue('int main(void) {\n  return 0;\n}');return document.getElementById('code-edit').value;});
  if(!proxySync.includes('return 0'))throw new Error('Monaco 内容未同步到自动保存代理');
  await idePage.waitForTimeout(900); // 等待本次语言服务请求结束，避免切换模型时产生预期取消信号
  await idePage.locator('#tabs .tab').filter({hasText:'README.md'}).locator('span').first().click();
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
  await idePage.locator('#tabs .tab').filter({hasText:'led.h'}).locator('span').first().click();
  await idePage.waitForFunction(()=>MONACO_EDITOR&&MONACO_EDITOR.getModel()&&MONACO_EDITOR.getModel().getLanguageId()!=='markdown');
 await idePage.evaluate(()=>setEditorSlot(1,{file:CURRENT.file,fragment:1}));
 await idePage.locator('.split-editor-group.monaco-active .monaco-editor').waitFor({state:'visible',timeout:10000});
  const splitTitles=await idePage.evaluate(()=>({primary:document.getElementById('primary-group-name').textContent,secondary:document.querySelector('.split-editor-head .name').textContent}));
  if(splitTitles.primary!=='led.h'||splitTitles.secondary!=='led.c')throw new Error('多栏编辑器未优先显示片段名：'+JSON.stringify(splitTitles));
  await idePage.evaluate(()=>{localStorage.setItem('mc-editor-groups',JSON.stringify([{file:CURRENT.file,fragment:1}]));localStorage.setItem('mc-editor-group-ratios','[50,50]');});
  await idePage.reload({waitUntil:'domcontentloaded'});
  await idePage.locator('.item').filter({hasText:'Reading Demo'}).click();
  await idePage.locator('#code-wrap.monaco-active .monaco-editor').waitFor({state:'visible',timeout:15000});
  const restoredSplit=await idePage.evaluate(()=>({groups:document.querySelectorAll('.split-editor-group').length,saved:localStorage.getItem('mc-editor-groups')}));
  if(restoredSplit.groups!==0||restoredSplit.saved!==null)throw new Error('刷新后仍恢复了临时编辑分栏：'+JSON.stringify(restoredSplit));
 if(ideErrors.length)throw new Error('Monaco 浏览器运行错误：'+ideErrors.join('；'));
  await idePage.close();

  /* ---- Markdown 块编辑器：真实指针拖拽、列表项独立移动与落盘 ---- */
  const readingPage=await browser.newPage({viewport:{width:1440,height:900}}),readingErrors=[];
  readingPage.on('pageerror',error=>readingErrors.push(String(error.message||error)));
  await readingPage.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await readingPage.locator('.reading-project').filter({hasText:'Block Drag Demo'}).click();
  await readingPage.locator('.reading-project-tab').filter({hasText:'note'}).click();
  const live=readingPage.locator('.reading-md-live');await live.waitFor({state:'visible',timeout:10000});
  if(await readingPage.locator('.reading-block-tail-add').count())throw new Error('Markdown 实时预览仍显示文末“添加区块”按钮');
  const readingMdBefore=await readingPage.evaluate(()=>READING_TEXT_DOCS.get(READING_CURRENT).content);
  await live.locator('p').first().click();await live.press('End');await live.pressSequentially(' undo-smoke');
  await readingPage.waitForFunction((before)=>READING_TEXT_DOCS.get(READING_CURRENT).content!==before,readingMdBefore);
  await readingPage.waitForTimeout(140);
  await readingPage.keyboard.press('Meta+z');
  await readingPage.waitForFunction((before)=>READING_TEXT_DOCS.get(READING_CURRENT).content===before,readingMdBefore);
  await readingPage.keyboard.press('Meta+Shift+z');
  await readingPage.waitForFunction((before)=>READING_TEXT_DOCS.get(READING_CURRENT).content!==before,readingMdBefore);
  await readingPage.keyboard.press('Meta+z');
  await readingPage.waitForFunction((before)=>READING_TEXT_DOCS.get(READING_CURRENT).content===before,readingMdBefore);
  const dragHandle=readingPage.locator('.reading-block-tool.handle');
  const firstParagraph=live.locator('p').first();await firstParagraph.hover();await dragHandle.waitFor({state:'visible'});
  const blockToolAlignment=await readingPage.evaluate(()=>{const block=document.querySelector('.reading-md-live p'),tools=document.querySelector('.reading-block-tools.on');if(!block||!tools)return null;const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(String(node.textContent||'').trim())break;if(!node)return null;const text=String(node.textContent||''),start=Math.max(0,text.search(/\S/)),range=document.createRange();range.setStart(node,start);range.setEnd(node,Math.min(text.length,start+1));const line=range.getClientRects()[0],tool=tools.getBoundingClientRect();return{centerDelta:Math.abs((line.top+line.height/2)-(tool.top+tool.height/2)),gap:line.left-tool.right};});
  if(!blockToolAlignment||blockToolAlignment.centerDelta>2.5||blockToolAlignment.gap<5)throw new Error('Markdown 区块控件未与首行对齐或侵入正文：'+JSON.stringify(blockToolAlignment));
  const firstListItem=live.locator('li').first();await firstListItem.hover();await dragHandle.waitFor({state:'visible'});
  const listToolAlignment=await readingPage.evaluate(()=>{const block=document.querySelector('.reading-md-live li'),tools=document.querySelector('.reading-block-tools.on');if(!block||!tools)return null;const item=block.getBoundingClientRect(),tool=tools.getBoundingClientRect();return{gap:item.left-tool.right,centerInside:tool.top<item.bottom&&tool.bottom>item.top};});
  if(!listToolAlignment||listToolAlignment.gap<24||!listToolAlignment.centerInside)throw new Error('Markdown 列表区块控件侵入项目符号或纵向错位：'+JSON.stringify(listToolAlignment));
  const dragBlock=async(source,target,after=true)=>{
    await source.hover();await dragHandle.waitFor({state:'visible'});const from=await dragHandle.boundingBox(),to=await target.boundingBox();
    if(!from||!to)throw new Error('Markdown 区块拖拽目标不可见');
    await readingPage.mouse.move(from.x+from.width/2,from.y+from.height/2);await readingPage.mouse.down();
    await readingPage.mouse.move(to.x+Math.min(90,to.width/2),to.y+(after?to.height*.8:to.height*.2),{steps:12});await readingPage.mouse.up();await readingPage.waitForTimeout(180);
  };
  const sectionA=live.getByRole('heading',{name:'Section A'}),sectionB=live.getByRole('heading',{name:'Section B'});
  await dragBlock(sectionA,sectionB,true);
  let headings=await live.locator('h2').allTextContents();if(headings.join('|')!=='Section B|Section A')throw new Error('Markdown 标题区块拖拽排序失败：'+JSON.stringify(headings));
  const alpha=live.locator('li').filter({hasText:'alpha'}),gamma=live.locator('li').filter({hasText:'gamma'});
  await dragBlock(alpha,gamma,true);
  const items=await live.locator('li').allTextContents();if(items.join('|')!=='beta|gamma|alpha')throw new Error('Markdown 列表项未作为独立区块拖拽：'+JSON.stringify(items));
  await readingPage.waitForTimeout(850);const savedNote=fs.readFileSync(readingNotePath,'utf8');
  if(savedNote.indexOf('## Section B')>savedNote.indexOf('## Section A')||!/- beta\n- gamma\n- alpha/.test(savedNote))throw new Error('Markdown 区块拖拽结果未持久化：'+savedNote);
  if(readingErrors.length)throw new Error('Markdown 区块浏览器运行错误：'+readingErrors.join('；'));
  await readingPage.close();

  if(errors.length)throw new Error('浏览器运行错误：'+errors.join('；'));
  console.log('CodeScope browser smoke: passed');
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close().catch(()=>{});
  if(server&&server.exitCode===null)server.kill();
  fs.rmSync(tempRoot,{recursive:true,force:true});
});
