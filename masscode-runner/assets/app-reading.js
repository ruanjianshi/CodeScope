/*
 * 阅读文库 + 知识库（2026-10-28 从 app.js 抽出来的独立经典脚本）
 * ---------------------------------------------------------------------------
 *   为什么抽：app.js 一个文件 17,466 行 / 15,323 行代码，改任何一处都要通读；
 *     棘轮（tests/architecture.js 的 SIZE_CAP）只准变小，所以这次是**按天然边界**拆 ✓。
 *   为什么是这一段：阅读区/知识库对编辑器那几个全局（CURRENT / CINDEX / EDITING /
 *     SNIPPETS / MONACO_EDITOR / SPLIT_EDITORS）**一次都不引用** ✓（AST 实测自由变量表
 *     里没有它们），依赖到的外面只有 api / setStatus / renderMd / saveNow / showContextMenu
 *     这些**函数声明** ✓，函数声明在脚本里是提升的全局，跨文件调用没有顺序问题 ✓。
 *   ⚠️ 必须是**经典脚本**，不加 IIFE、不改成 ESM ✗ —— 顶层 let/const 现在进的是
 *     **全局词法环境**（跨 classic script 共享）✓，包进 IIFE 就等于把它们关进盒子里，
 *     xmind-interaction.js 那些文件直接读 XMIND_* 的写法会全部失效 ✗。
 *   ⚠️ 调用了知识库入口的函数对象（openKnowledgeSplit 等）被 app.js 顶层 16754-16773
 *     行直接取引用（`$("knowledge-launch-split").onclick = openKnowledgeSplit`）✓ ——
 *     那些语句在 app.js **加载时**就求值，所以本文件必须排在 app.js **之前** ✓，
 *     否则 app.js 一加载就 ReferenceError: openKnowledgeSplit is not defined ✗。
 *   ⚠️ 本文件顶层不许出现「立即调用 app.js 的函数」✗ —— 现在只有顶层 let/const 初始化
 *     （纯字面量 / localStorage）和 addEventListener（回调延后）✓，这个性质要守住 ✓。
 *   
 */

/* ------------------------- 阅读文库（PDF / AI 翻译 / 摘录） ------------------------- */
let READING_TREE = null;
let READING_CURRENT = '';
let READING_SLOTS = ['', ''];
let READING_DOCS = new Map();
let READING_OPEN = (() => { try { return localStorage.getItem('mc-reading-open') !== '0'; } catch (_) { return true; } })();
let READING_DIR_OPEN = (() => { try { return new Set(JSON.parse(localStorage.getItem('mc-reading-dirs') || '[]')); } catch (_) { return new Set(); } })();
let READING_ACTIVE_SLOT = 0;
let READING_TRANSLATING = false;
let READING_PROJECT_CURRENT = '';
let READING_IMPORT_PROJECT = '';
let READING_FRAGMENT_INDEX = new Map();
let READING_PROJECT_INDEX = new Map();
let READING_TEXT_DOCS = new Map();
let READING_TEXT_SAVE_TIMERS = new Map();
let KNOWLEDGE_STATE = null;
let KNOWLEDGE_RETURN_FOCUS = null;
function knowledgeBytes(value){const bytes=Number(value)||0;if(bytes<1024)return bytes+' B';if(bytes<1024*1024)return (bytes/1024).toFixed(bytes<10240?1:0)+' KB';return (bytes/1024/1024).toFixed(1)+' MB';}
function knowledgeTime(value){if(!value)return '尚未生成';try{return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}catch(_){return '—';}}
function renderKnowledgeCenter(state){
  KNOWLEDGE_STATE=state;if(!state||!state.ok)return;
  $('knowledge-page-count').textContent=String(state.pageCount||0);$('knowledge-asset-count').textContent=(state.assetCount||0)+' · '+knowledgeBytes(state.assetBytes);$('knowledge-engine').textContent=(state.engine||'VitePress')+' '+(state.engineVersion||'');$('knowledge-built-at').textContent=knowledgeTime(state.finishedAt);
  const status=$('knowledge-status');status.className='knowledge-status-line '+(state.phase||'idle');status.textContent=state.error?(state.message+'：'+state.error):(state.message||'等待生成');$('knowledge-open').disabled=!state.built;$('knowledge-build').disabled=state.phase==='building';
  const pages=$('knowledge-pages');pages.replaceChildren();if(!(state.pages||[]).length){const empty=document.createElement('div');empty.className='draw-empty';empty.textContent='还没有知识库文档';pages.appendChild(empty);}else for(const page of state.pages){const button=document.createElement('button');button.className='knowledge-page';button.style.paddingLeft=(8+Math.max(0,page.path.split('/').length-1)*14)+'px';const icon=document.createElement('span');icon.className='kp-icon';icon.textContent='▤';const copy=document.createElement('span');copy.className='kp-copy';const title=document.createElement('b');title.textContent=page.title;const detail=document.createElement('small');detail.textContent=page.path+' · '+knowledgeBytes(page.size);copy.append(title,detail);button.append(icon,copy);button.onclick=async()=>{closeKnowledgeCenter(false);await loadReadings(true);const fragment=READING_FRAGMENT_INDEX.get(page.readingPath);if(fragment)openReading(page.readingPath,0);};pages.appendChild(button);}
}
async function loadKnowledgeStatus(){const state=await api('/api/knowledge/status');if(!state.ok){$('knowledge-status').className='knowledge-status-line error';$('knowledge-status').textContent=state.error||'读取知识库失败';return state;}renderKnowledgeCenter(state);return state;}
async function openKnowledgeCenter(){const modal=$('knowledge-center');KNOWLEDGE_RETURN_FOCUS=document.activeElement instanceof HTMLElement?document.activeElement:null;if(modal.parentElement!==document.body)document.body.appendChild(modal);modal.classList.add('open');document.body.classList.add('knowledge-dialog-open');$('knowledge-result').textContent='Markdown 原稿保存在 Vault；站点生成结果可随时重建。';requestAnimationFrame(()=>$('knowledge-close').focus());await loadKnowledgeStatus();}
function closeKnowledgeCenter(restoreFocus=true){const modal=$('knowledge-center');modal.classList.remove('open');document.body.classList.remove('knowledge-dialog-open');if(restoreFocus&&KNOWLEDGE_RETURN_FOCUS&&KNOWLEDGE_RETURN_FOCUS.isConnected)KNOWLEDGE_RETURN_FOCUS.focus();KNOWLEDGE_RETURN_FOCUS=null;}
async function buildKnowledge(){const button=$('knowledge-build');button.disabled=true;$('knowledge-status').className='knowledge-status-line building';$('knowledge-status').textContent='正在生成静态页面、目录和搜索索引…';const state=await api('/api/knowledge/build',{});button.disabled=false;if(!state.ok){$('knowledge-status').className='knowledge-status-line error';$('knowledge-status').textContent=state.error||'知识库生成失败';return;}renderKnowledgeCenter(state);await loadReadings(true);}
async function createKnowledgePage(){let pagePath=$('knowledge-page-path').value.trim();const title=$('knowledge-page-title').value.trim();if(!pagePath)return $('knowledge-result').textContent='请填写“分类/项目/文档名称.md”。';if(!/\.md$/i.test(pagePath))pagePath+='.md';const result=await api('/api/knowledge/page',{path:pagePath,title});if(!result.ok)return $('knowledge-result').textContent=result.error||'新建失败';$('knowledge-page-path').value='';$('knowledge-page-title').value='';$('knowledge-result').textContent='已新建 '+result.path+'，正在后台更新阅读站点…';await loadReadings(true);await loadKnowledgeStatus();const fragment=READING_FRAGMENT_INDEX.get(result.readingPath);if(fragment){closeKnowledgeCenter(false);openReading(result.readingPath,0);}}
async function createKnowledgeFolder(){const folder=$('knowledge-folder-path').value.trim();if(!folder)return $('knowledge-result').textContent='请填写分类路径。';const result=await api('/api/knowledge/folder',{path:folder});if(!result.ok)return $('knowledge-result').textContent=result.error||'新建失败';$('knowledge-folder-path').value='';$('knowledge-result').textContent='分类已建立：'+result.path+'。下一步请在分类中新建项目。';await loadReadings(true);await loadKnowledgeStatus();}
async function createKnowledgeProject(){const projectPath=$('knowledge-project-path').value.trim(),description=$('knowledge-project-description').value.trim();if(!projectPath)return $('knowledge-result').textContent='请填写“分类/项目名称”。';const result=await api('/api/knowledge/project',{path:projectPath,description});if(!result.ok)return $('knowledge-result').textContent=result.error||'新建失败';$('knowledge-project-path').value='';$('knowledge-project-description').value='';$('knowledge-result').textContent='项目已建立：'+result.path+'。可在其中继续新建多个 Markdown 片段。';await loadReadings(true);await loadKnowledgeStatus();const project=READING_PROJECT_INDEX.get('知识库/'+result.path);if(project){closeKnowledgeCenter(false);openReadingProject(project);}}
async function uploadKnowledgeImages(files){if(!files||!files.length)return;const folder=$('knowledge-image-folder').value.trim().replace(/^\/+|\/+$/g,'')||'通用';let last='';for(const file of files){const header=btoa(unescape(encodeURIComponent(JSON.stringify({path:folder+'/'+file.name}))));const response=await fetch('/api/knowledge/image',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-CodeScope-Knowledge':header},body:file});const result=await response.json();if(!response.ok||!result.ok){$('knowledge-result').textContent=result.error||('导入 '+file.name+' 失败');return;}last=result.markdown;}await loadKnowledgeStatus();$('knowledge-result').textContent=(files.length===1?'图片语法已复制：':'最后一张图片语法已复制：')+last;try{await navigator.clipboard.writeText(last);}catch(_){}}
function knowledgeImageExtension(file){const type=String(file&&file.type||'').toLowerCase();if(type==='image/jpeg')return'.jpg';if(type==='image/gif')return'.gif';if(type==='image/webp')return'.webp';return'.png';}
async function uploadKnowledgeEditorImage(file,readingPath){
  if(!String(readingPath||'').startsWith('知识库/'))throw new Error('只有知识库 Markdown 支持自动保存粘贴图片');
  const parts=String(readingPath).split('/').slice(1,-1),ext=knowledgeImageExtension(file),raw=String(file&&file.name||'').replace(/\.[^.]+$/,'')||'粘贴图片',base=raw.replace(/[\\/:*?"<>|]+/g,'-').replace(/^\.+|\.+$/g,'').slice(0,80)||'粘贴图片';
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),id=(self.crypto&&self.crypto.randomUUID?self.crypto.randomUUID():Math.random().toString(36).slice(2)).slice(0,8),relative=[...parts,stamp+'-'+id+'-'+base+ext].join('/');
  const header=utf8Base64(JSON.stringify({path:relative})),response=await fetch('/api/knowledge/image',{method:'POST',headers:{'Content-Type':file.type||'image/png','X-CodeScope-Knowledge':header},body:file}),result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'知识库图片保存失败');
  readingStatus('图片已保存到知识库：'+result.path);
  return result;
}
function setKnowledgeLaunchMenu(open){
  const wrap=$('knowledge-launch'),menu=$('knowledge-launch-menu'),more=$('knowledge-launch-more');
  const next=typeof open==='boolean'?open:menu.hidden;
  menu.hidden=!next;wrap.classList.toggle('open',next);more.setAttribute('aria-expanded',String(next));
}
function syncKnowledgeWorkspaceButton(){
  const active=document.body.classList.contains('knowledge-mode');
  $('btn-knowledge-launch').classList.toggle('on',active);$('btn-knowledge-launch').setAttribute('aria-pressed',String(active));
}
async function ensureKnowledgeSite(force=false){
  let state=force?null:await api('/api/knowledge/status');
  if(force||!state||!state.ok||!state.built||state.phase==='building'||state.pending)state=await api('/api/knowledge/build',{});
  if(!state||!state.ok||!state.built)throw new Error(state&&state.error||'知识库生成失败');
  renderKnowledgeCenter(state);return state;
}
/* 进知识库前记下开着的模式 ✓：openKnowledgeWorkspace 会把它们全关掉 ✓（全屏覆盖层会打架 ✓），
   原来关知识库时**不恢复** ✗ → 落到欢迎页 ✗（用户报的 bug ✓）。
   这些模式的 close 只删 body class、不拆 DOM ✓，所以加回 class 即原样恢复 ✓。 */
let KB_PREV_MODES=[];
/* 进知识库前快照「阅读项目标签栏」的状态 ✓（项目路径 + 两栏打开的片段 ✓）。 */
let KB_PREV_READING=null;
function snapshotReading(){return {project:READING_PROJECT_CURRENT,slots:[...READING_SLOTS]};}
/* 索引里查不到就**原样不动** ✗ —— 宁可少恢复也不要清空标签栏 ✓。 */
function restoreReadingSnapshot(snap){
  if(!snap)return;
  if(snap.project&&READING_PROJECT_INDEX.get(snap.project))READING_PROJECT_CURRENT=snap.project;
  if(Array.isArray(snap.slots)&&snap.slots.length===READING_SLOTS.length)snap.slots.forEach((v,i)=>{if(v&&READING_FRAGMENT_INDEX.get(v))READING_SLOTS[i]=v;});
  renderReadingProjectTabs();
}
const KB_MODES=['study-mode','dsh-mode','opencode-mode','vscode-mode','office-mode','reading-mode','drawing-mode'];
async function leaveWorkspaceModesForKnowledge(){
  KB_PREV_MODES=KB_MODES.filter((m)=>document.body.classList.contains(m));
  KB_PREV_READING=snapshotReading();
  if(document.body.classList.contains('study-mode')&&window.CodeScopeStudy)window.CodeScopeStudy.close();
  if(document.body.classList.contains('dsh-mode'))closeDshWorkspace();if(document.body.classList.contains('opencode-mode'))closeOpencodeWorkspace();if(document.body.classList.contains('vscode-mode'))closeVSCodeWorkspace();
  if(document.body.classList.contains('office-mode')&&typeof window.closeOffice==='function')await window.closeOffice();
  if(document.body.classList.contains('reading-mode')&&typeof window.closeReading==='function')window.closeReading();
  if(document.body.classList.contains('drawing-mode')&&typeof window.closeDrawEditor==='function')await window.closeDrawEditor(true);
  document.body.classList.remove('study-mode','dsh-mode','opencode-mode','vscode-mode','office-mode','reading-mode','drawing-mode');
}
/* 知识库的入口地址。站点根 /knowledge/ 只是 VitePress 的落地页，对读者没有意义，
   所以直接落到具体文档：上次读过哪篇就回到哪篇，否则用第一篇。
   URL 规则和站点生成脚本里的 pageLink() 对齐（cleanUrls 为 false，所以要带 .html）。 */
const KB_LAST_PAGE_KEY='codescope-kb-last-page';
function knowledgePageUrl(state){
  const pages=(state&&state.pages)||[];
  let last='';
  try{last=localStorage.getItem(KB_LAST_PAGE_KEY)||'';}catch(_){}
  const target=(last&&pages.some((page)=>page.path===last))?last:((pages[0]&&pages[0].path)||'');
  if(!target)return '/knowledge/';
  const rel=target.replace(/\\/g,'/').replace(/\.(md|markdown)$/i,'');
  return '/knowledge/'+rel.split('/').filter(Boolean).map(encodeURIComponent).join('/')+'.html';
}
/* 从 iframe 当前地址反推「正在读哪篇」，存下来供下次直接回到这里。
   不能只在 iframe 的 load 事件里记：站点内部翻页是 SPA 路由，不会再触发 load，
   只在打开时记一次的话，翻到别的文章后关掉再开还是会回到上一篇。 */
let kbTrackTimer=null,kbLastSeenPath='';
function rememberKnowledgePage(){
  const frame=$('knowledge-workspace-frame');
  if(!frame)return;
  try{
    const pathname=frame.contentWindow.location.pathname||'';
    if(!pathname.startsWith('/knowledge/')||pathname===kbLastSeenPath)return;
    kbLastSeenPath=pathname;
    const rel=decodeURIComponent(pathname.slice('/knowledge/'.length)).replace(/\.html?$/i,'');
    if(rel)localStorage.setItem(KB_LAST_PAGE_KEY,rel+'.md');
  }catch(_){}
}
function startKnowledgePageTracking(){
  if(kbTrackTimer)return;
  kbTrackTimer=setInterval(()=>{if(document.body.classList.contains('knowledge-mode'))rememberKnowledgePage();},1500);
}
function stopKnowledgePageTracking(){
  if(kbTrackTimer){clearInterval(kbTrackTimer);kbTrackTimer=null;}
}
async function openKnowledgeWorkspace(forceBuild=false){
  setKnowledgeLaunchMenu(false);closeKnowledgeCenter(false);
  const loading=$('knowledge-workspace-loading');loading.textContent=forceBuild?'正在重新生成知识库…':'正在载入知识库…';loading.classList.remove('hidden');
  try{
    const site=await ensureKnowledgeSite(forceBuild);await leaveWorkspaceModesForKnowledge();
    document.body.classList.add('knowledge-mode');syncKnowledgeWorkspaceButton();
    const frame=$('knowledge-workspace-frame'),url=knowledgePageUrl(site)+'?embedded=1&view='+Date.now();
    frame.src=url;
    startKnowledgePageTracking();
    setTimeout(()=>window.dispatchEvent(new Event('resize')),20);
  }catch(error){loading.textContent='知识库打开失败：'+(error.message||error);setStatus('err', '知识库打开失败：'+(error.message||error));}
}
function closeKnowledgeWorkspace(){
  document.body.classList.remove('knowledge-mode');stopKnowledgePageTracking();syncKnowledgeWorkspaceButton();
  /* 恢复进知识库前的模式 ✓（不恢复会落到欢迎页 ✗）。
     ⚠️⚠️ study-mode 必须**先判断它原来开着**再 open ✗✗ ——
        上一版漏了这个判断 ✓，结果**不管原来开没开都去 open** ✗
        → 关掉知识库反而冒出「学习工作台」（用户报的正是这个 ✓）。 */
  const prev=KB_PREV_MODES;KB_PREV_MODES=[];
  prev.forEach((m)=>{if(m!=='study-mode')document.body.classList.add(m);});
  /* ★ 同时恢复「阅读项目标签栏」的状态 ✓（用户：「关闭知识库后这上面丢失了」）——
     标签栏显示空提示的条件是 READING_PROJECT_CURRENT 在索引里**找不到** ✓
     （见 renderReadingProjectTabs ✓）。进知识库前先快照 ✓，关掉时恢复 ✓。 */
  if(KB_PREV_READING){try{restoreReadingSnapshot(KB_PREV_READING);}catch(_){}KB_PREV_READING=null;}
  if(prev.includes('study-mode')&&window.CodeScopeStudy&&typeof window.CodeScopeStudy.open==='function'){try{window.CodeScopeStudy.open();}catch(_){}}
  setTimeout(()=>window.dispatchEvent(new Event('resize')),20);
}
async function openKnowledgeSplit(){
  setKnowledgeLaunchMenu(false);closeKnowledgeWorkspace();
  if(document.body.classList.contains('dsh-mode'))closeDshWorkspace();if(document.body.classList.contains('opencode-mode'))closeOpencodeWorkspace();if(document.body.classList.contains('vscode-mode'))closeVSCodeWorkspace();
  try{const site=await ensureKnowledgeSite(false);if(!window.CodeScopeStudy)throw new Error('学习工作台尚未加载');await window.CodeScopeStudy.open(new URL(knowledgePageUrl(site),window.location.href).href);}
  catch(error){setStatus('err', '知识库分栏打开失败：'+(error.message||error));}
}
async function openKnowledgeExternal(){
  setKnowledgeLaunchMenu(false);
  let site=null;try{site=await api('/api/knowledge/status');}catch(_){}
  window.open(knowledgePageUrl(site),'codescope-knowledge','noopener');
}
function readingStatus(text, error) { const el=$('reading-status');el.textContent=text||'';el.style.color=error?'var(--err)':'var(--dim)'; }
function readingBase(path) { return String(path||'').split('/').pop().replace(/\.[^.]+$/,''); }
function readingFragment(path) { return READING_FRAGMENT_INDEX.get(path)||null; }
function readingRoleLabel(item){return item.role==='original'?'原版':item.role==='translation'?'中文版':item.role==='bilingual'?'双语版':item.kind==='markdown'?'Markdown':item.kind==='docx'?'Word':item.kind==='sheet'?'表格':item.kind==='slides'?'演示文稿':item.kind==='web'?'网页':item.kind==='html'?'HTML 网页':'代码';}
function readingKindIcon(item){return item.kind==='pdf'?'▤':item.kind==='markdown'?'M↓':item.kind==='docx'?'W':item.kind==='sheet'?'X':item.kind==='slides'?'P':item.kind==='web'?'↗':item.kind==='html'?'H':'</>';}
function hideReadingPagination(els){els.view.style.display='none';els.page.style.display='none';els.pages.style.display='none';els.col.querySelector('.reading-prev').style.display='none';els.col.querySelector('.reading-next').style.display='none';}
function readingAssetShell(els,fragment){
  const shell=document.createElement('div');shell.className='reading-asset-shell '+fragment.kind;const toolbar=document.createElement('div');toolbar.className='reading-asset-toolbar';const kind=document.createElement('span');kind.className='kind';kind.textContent=readingRoleLabel(fragment);const title=document.createElement('span');title.className='title';title.textContent=readingBase(fragment.name);const minus=document.createElement('button'),value=document.createElement('button'),plus=document.createElement('button');minus.type=value.type=plus.type='button';minus.innerHTML=csGlyphIcon('−');plus.innerHTML=csGlyphIcon('＋');value.className='zoom-value';const minZoom=fragment.kind==='web'||fragment.kind==='html'?40:60,maxZoom=fragment.kind==='web'||fragment.kind==='html'?240:180,zoomListeners=new Set();let zoom=100;try{zoom=Math.max(minZoom,Math.min(maxZoom,Number(localStorage.getItem('mc-reading-asset-zoom:'+fragment.path))||100));}catch(_){}const setZoom=(next,persist=true)=>{zoom=Math.max(minZoom,Math.min(maxZoom,Math.round(Number(next)||100)));shell.style.setProperty('--reading-asset-zoom',String(zoom/100));value.textContent=zoom+'%';for(const listener of zoomListeners)listener(zoom);if(persist)try{localStorage.setItem('mc-reading-asset-zoom:'+fragment.path,String(zoom));}catch(_){}};minus.title='缩小';plus.title='放大';value.title='恢复 100%';minus.onclick=()=>setZoom(zoom-10);plus.onclick=()=>setZoom(zoom+10);value.onclick=()=>setZoom(100);const download=document.createElement('a');download.href='/api/readings/file?download=1&path='+encodeURIComponent(fragment.path);download.textContent='下载原文件';download.title='下载原始资料文件';const stage=document.createElement('div');stage.className='reading-asset-stage';toolbar.append(kind,title,minus,value,plus);if(fragment.kind!=='web')toolbar.append(download);shell.append(toolbar,stage);stage.addEventListener('wheel',(event)=>{if(!(event.ctrlKey||event.metaKey))return;event.preventDefault();setZoom(zoom+(event.deltaY<0?10:-10));},{passive:false});setZoom(zoom,false);els.body.appendChild(shell);return{shell,toolbar,stage,title,setZoom,getZoom:()=>zoom,onZoom:(listener)=>{zoomListeners.add(listener);listener(zoom);return()=>zoomListeners.delete(listener);}};
}
const READING_WEB_READERS=new Map();
function readingWebUrlKey(value){try{const url=new URL(value);return url.origin+url.pathname.replace(/(?:index)?\.html$/i,'').replace(/\/$/,'')+url.search;}catch(_){return String(value||'');}}
function readingWebTextRange(article,start,end){
  const from=Math.max(0,Number(start)||0),to=Math.max(from,Number(end)||0),walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT);let offset=0,startNode=null,startOffset=0,endNode=null,endOffset=0,node;
  while((node=walker.nextNode())){const next=offset+node.data.length;if(startNode===null&&from<=next){startNode=node;startOffset=Math.max(0,Math.min(node.data.length,from-offset));}if(to<=next){endNode=node;endOffset=Math.max(0,Math.min(node.data.length,to-offset));break;}offset=next;}
  if(!startNode)return null;if(!endNode){endNode=startNode;endOffset=startNode.data.length;}const range=document.createRange();try{range.setStart(startNode,startOffset);range.setEnd(endNode,endOffset);}catch(_){return null;}return range;
}
function readingWebSelection(article,url,title,cached){
  const selection=window.getSelection(),range=selection&&!selection.isCollapsed&&selection.rangeCount?selection.getRangeAt(0):null;
  if(!range||!article.contains(range.commonAncestorContainer))return cached||null;
  const source=String(selection.toString()||'').trim();if(!source)return cached||null;
  const prefix=document.createRange();prefix.selectNodeContents(article);prefix.setEnd(range.startContainer,range.startOffset);let webStart=prefix.toString().length,webEnd=webStart+selection.toString().length;
  while(webStart<webEnd&&/\s/.test(article.textContent[webStart]||''))webStart+=1;while(webEnd>webStart&&/\s/.test(article.textContent[webEnd-1]||''))webEnd-=1;
  const headings=[...article.querySelectorAll('h1,h2,h3,h4,h5,h6')],anchorNode=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;let heading=anchorNode&&anchorNode.closest&&anchorNode.closest('h1,h2,h3,h4,h5,h6');if(!heading)for(const candidate of headings){if(candidate.compareDocumentPosition(range.startContainer)&Node.DOCUMENT_POSITION_FOLLOWING)heading=candidate;else break;}
  return{source,url,webTitle:title||'',anchor:heading&&(heading.id||heading.textContent.trim())||'',webStart,webEnd};
}
function sanitizeReadingWebHtml(html,baseUrl,internalLinks=false){
  const parsed=new DOMParser().parseFromString('<body>'+String(html||'')+'</body>','text/html');parsed.querySelectorAll('script,style,noscript,iframe,object,embed,form,input,button,textarea,select,meta,link,base,svg,canvas').forEach((node)=>node.remove());
  parsed.querySelectorAll('*').forEach((node)=>{for(const attr of [...node.attributes]){const name=attr.name.toLowerCase();if(name.startsWith('on')||['style','srcdoc','formaction','action','integrity'].includes(name))node.removeAttribute(attr.name);}for(const name of ['href','src','poster']){const raw=node.getAttribute(name);if(!raw)continue;try{const resolved=new URL(raw,baseUrl);if(!['http:','https:'].includes(resolved.protocol))throw new Error();node.setAttribute(name,resolved.toString());}catch(_){node.removeAttribute(name);}}node.removeAttribute('srcset');if(node.tagName==='A'&&node.hasAttribute('href')){if(internalLinks){node.removeAttribute('target');node.removeAttribute('rel');}else{node.target='_blank';node.rel='noopener noreferrer';}}if(node.tagName==='IMG'){node.loading='lazy';node.decoding='async';}});
  return parsed.body.innerHTML;
}
async function renderReadingAsset(slot,els,fragment){
  hideReadingPagination(els);const ui=readingAssetShell(els,fragment),loading=document.createElement('div');loading.className='reading-asset-loading';loading.textContent=fragment.kind==='web'?'正在提取网页正文…':'正在解析 '+readingRoleLabel(fragment)+'…';ui.stage.appendChild(loading);
  try{
    if(fragment.kind==='web'){
      ui.stage.classList.add('reading-web-stage');
      const doc=await ensureReadingDoc(fragment.path);
      const first=await api('/api/readings/web?path='+encodeURIComponent(fragment.path));if(!first.ok)throw new Error(first.error||'网页加载失败');
      const back=document.createElement('button'),forward=document.createElement('button'),navToggle=document.createElement('button'),chapterPrev=document.createElement('button'),chapterNext=document.createElement('button'),chapterPos=document.createElement('span'),fit=document.createElement('button'),zoomRange=document.createElement('input'),clip=document.createElement('button'),note=document.createElement('button'),open=document.createElement('a');
      back.type=forward.type=navToggle.type=chapterPrev.type=chapterNext.type=fit.type=clip.type=note.type='button';back.textContent='←';back.title='后退';forward.textContent='→';forward.title='前进';navToggle.textContent='☰ 目录';navToggle.title='显示或收起整站章节目录';chapterPrev.innerHTML=csGlyphIcon('‹') + ' 上一章';chapterNext.textContent='下一章 ›';chapterPos.className='reading-web-chapter-pos';fit.textContent='适宽';fit.title='让整张网页适合当前阅读栏宽度';zoomRange.className='reading-web-zoom-range';zoomRange.type='range';zoomRange.min='40';zoomRange.max='240';zoomRange.step='5';zoomRange.title='自由缩放整张网页（40%–240%）';clip.className='reading-web-action';clip.textContent='✂ 摘录';clip.title='选择网页文字后保存高亮摘录';note.className='reading-web-action';note.innerHTML=csGlyphIcon('＋') + ' 笔记';note.title='选择网页文字后创建可编辑笔记';open.target='_blank';open.rel='noopener noreferrer';open.textContent='打开原网页';ui.toolbar.append(back,forward,navToggle,chapterPrev,chapterPos,chapterNext,fit,zoomRange,clip,note,open);
      const layout=document.createElement('div'),navShell=document.createElement('aside'),navHead=document.createElement('div'),navTitle=document.createElement('strong'),navProgress=document.createElement('span'),navFilter=document.createElement('input'),navTree=document.createElement('nav'),content=document.createElement('div'),article=document.createElement('article');
      layout.className='reading-web-layout';navShell.className='reading-web-nav-shell';navHead.className='reading-web-nav-head';navTitle.textContent='网站目录';navProgress.className='reading-web-nav-progress';navProgress.textContent='正在建立站点目录…';navFilter.type='search';navFilter.placeholder='筛选章节…';navFilter.setAttribute('aria-label','筛选网站目录');navTree.className='reading-web-nav';content.className='reading-web-content';article.className='reading-web-article';navHead.append(navTitle,navProgress,navFilter);navShell.append(navHead,navTree);content.appendChild(article);layout.append(navShell,content);ui.stage.replaceChildren(layout);
      const history=[],pageCache=new Map(),webRanges=new Map(),markName='codescope-web-marks-'+slot;let historyIndex=-1,currentUrl='',lastSelection=null,prefetchToken=0;const sizePage=()=>article.style.setProperty('--reading-web-page-width',Math.max(320,Math.min(920,content.clientWidth-56))+'px'),pageResize=typeof ResizeObserver==='function'?new ResizeObserver(sizePage):null;if(pageResize)pageResize.observe(content);sizePage();
      const clearMarks=()=>{webRanges.clear();if(window.CSS&&CSS.highlights)CSS.highlights.delete(markName);};
      const refreshMarks=()=>{clearMarks();const ranges=[];for(const item of doc.meta.fragments||[]){if(!item.url||readingWebUrlKey(item.url)!==readingWebUrlKey(currentUrl)||item.webEnd<=item.webStart)continue;const range=readingWebTextRange(article,item.webStart,item.webEnd);if(!range)continue;webRanges.set(String(item.id),range);ranges.push(range);}if(ranges.length&&window.CSS&&CSS.highlights&&typeof Highlight==='function')CSS.highlights.set(markName,new Highlight(...ranges));};
      const chapterLinks=()=>{const seen=new Set(),base=currentUrl?new URL(currentUrl):null;return[...navTree.querySelectorAll('a[href]')].filter((anchor)=>{try{const target=new URL(anchor.href,currentUrl);const key=readingWebUrlKey(target);if(base&&target.origin!==base.origin||seen.has(key))return false;seen.add(key);return true;}catch(_){return false;}});};
      const syncHistory=()=>{back.disabled=historyIndex<=0;forward.disabled=historyIndex+1>=history.length;};
      const syncChapters=()=>{const links=chapterLinks(),index=links.findIndex((anchor)=>readingWebUrlKey(anchor.href)===readingWebUrlKey(currentUrl));chapterPrev.disabled=index<=0;chapterNext.disabled=index<0||index+1>=links.length;chapterPrev.dataset.url=index>0?links[index-1].href:'';chapterNext.dataset.url=index>=0&&index+1<links.length?links[index+1].href:'';chapterPos.textContent=index>=0?(index+1)+' / '+links.length:(links.length?'- / '+links.length:'');navProgress.textContent=links.length?links.length+' 个章节 · 当前页按需加载':'当前网页大纲';};
      const rememberScroll=()=>{if(!currentUrl)return;try{localStorage.setItem('mc-reading-web-scroll:'+fragment.path+':'+readingWebUrlKey(currentUrl),String(Math.round(content.scrollTop)));}catch(_){}};
      const restoreScroll=()=>{let top=0;try{top=Number(localStorage.getItem('mc-reading-web-scroll:'+fragment.path+':'+readingWebUrlKey(currentUrl)))||0;}catch(_){}requestAnimationFrame(()=>{content.scrollTop=top;});};
      const wireLinks=(host,baseUrl)=>host.querySelectorAll('a[href]').forEach((anchor)=>{let target;try{target=new URL(anchor.href,baseUrl);}catch(_){return;}let base;try{base=new URL(baseUrl);}catch(_){return;}if(target.origin!==base.origin){anchor.target='_blank';anchor.rel='noopener noreferrer';return;}anchor.removeAttribute('target');anchor.removeAttribute('rel');anchor.onclick=(event)=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;if(readingWebUrlKey(target)===readingWebUrlKey(currentUrl)&&target.hash){event.preventDefault();let id='';try{id=decodeURIComponent(target.hash.slice(1));}catch(_){id=target.hash.slice(1);}const escaped=window.CSS&&CSS.escape?CSS.escape(id):id.replace(/[^A-Za-z0-9_-]/g,'');if(!escaped)return;let hit=null;try{hit=article.querySelector('#'+escaped)||article.querySelector('[name="'+escaped+'"]');}catch(_){}if(hit){hit.scrollIntoView({block:'start'});readingStatus('已定位网页小节 · '+String(hit.textContent||'').trim().slice(0,80));}else readingStatus('当前章节中没有找到该定位点',true);return;}event.preventDefault();loadPage(target.toString(),true);};});
      const prefetchAdjacent=()=>{const token=++prefetchToken,links=chapterLinks(),index=links.findIndex((anchor)=>readingWebUrlKey(anchor.href)===readingWebUrlKey(currentUrl));if(index<0)return;for(const anchor of [links[index-1],links[index+1]].filter(Boolean)){const url=anchor.href,key=readingWebUrlKey(url);if(pageCache.has(key))continue;api('/api/readings/web/page?url='+encodeURIComponent(url)).then((result)=>{if(token===prefetchToken&&result.ok)pageCache.set(readingWebUrlKey(result.url||url),result);}).catch(()=>{});}};
      const renderPage=(result,push)=>{rememberScroll();currentUrl=result.url;pageCache.set(readingWebUrlKey(currentUrl),result);open.href=currentUrl;ui.title.textContent=result.title||readingBase(fragment.name);article.innerHTML=sanitizeReadingWebHtml(result.html,currentUrl);if(result.title&&!article.querySelector('h1')){const heading=document.createElement('h1');heading.textContent=result.title;article.prepend(heading);}sizePage();if(result.navigationHtml){const temp=document.createElement('div');temp.innerHTML=sanitizeReadingWebHtml(result.navigationHtml,result.navigationUrl||currentUrl,true);const incoming=temp.querySelectorAll('a[href]').length,existing=navTree.querySelectorAll('a[href]').length;if((!existing&&incoming)||incoming>existing){navTree.replaceChildren(...temp.childNodes);navShell.hidden=false;navToggle.hidden=false;layout.classList.remove('nav-hidden');}}if(!navTree.querySelector('a[href]')){navShell.hidden=true;navToggle.hidden=true;layout.classList.add('nav-hidden');}if(push&&history[historyIndex]!==currentUrl){history.splice(historyIndex+1);history.push(currentUrl);historyIndex=history.length-1;}wireLinks(navTree,result.navigationUrl||currentUrl);wireLinks(article,currentUrl);navTree.querySelectorAll('a[href]').forEach((anchor)=>anchor.classList.toggle('active',readingWebUrlKey(anchor.href)===readingWebUrlKey(currentUrl)));syncHistory();syncChapters();lastSelection=null;refreshMarks();restoreScroll();setTimeout(prefetchAdjacent,120);};
      const loadPage=async(url,push)=>{try{readingStatus('正在载入网页章节…');const cached=pageCache.get(readingWebUrlKey(url)),result=cached||await api('/api/readings/web/page?url='+encodeURIComponent(url));if(!result.ok)throw new Error(result.error||'网页加载失败');renderPage(result,push);readingStatus('站点章节已载入 · 可选择文字摘录、标注和写笔记');}catch(error){readingStatus('网页章节加载失败：'+String(error.message||error),true);}};
      const saveSelection=async(withNote)=>{const payload=readingWebSelection(article,currentUrl,ui.title.textContent,lastSelection);if(!payload||!payload.source){readingStatus('请先在网页正文中选择需要摘录或记笔记的文字',true);return;}const item={id:cryptoRandomId(),page:1,translation:'',note:'',createdAt:Date.now(),...payload};doc.meta.fragments.unshift(item);await saveReadingDoc(doc);renderReadingFragments();refreshMarks();lastSelection=null;readingStatus(withNote?'网页摘录已建立 · 请在右侧输入笔记':'网页摘录与定位已保存');if(withNote)setTimeout(()=>{const card=document.querySelector('.reading-frag[data-fragment-id="'+item.id+'"]');if(card)startFragNoteEdit(card,doc,item);},0);};
      const locate=async(item)=>{if(item.url&&readingWebUrlKey(item.url)!==readingWebUrlKey(currentUrl))await loadPage(item.url,true);refreshMarks();const range=webRanges.get(String(item.id));if(!range)return false;const rect=range.getBoundingClientRect(),box=content.getBoundingClientRect();content.scrollTo({top:Math.max(0,content.scrollTop+rect.top-box.top-90),behavior:'smooth'});const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range.cloneRange());setTimeout(()=>{if(selection.rangeCount&&selection.toString()===item.source)selection.removeAllRanges();},1100);return true;};
      const reader={path:fragment.path,locate,refreshMarks,saveSelection,currentUrl:()=>currentUrl};READING_WEB_READERS.set(fragment.path,reader);els.body.__readingBlockDestroy=async()=>{rememberScroll();clearMarks();if(pageResize)pageResize.disconnect();if(READING_WEB_READERS.get(fragment.path)===reader)READING_WEB_READERS.delete(fragment.path);};
      content.addEventListener('scroll',()=>{clearTimeout(content._readingScrollTimer);content._readingScrollTimer=setTimeout(rememberScroll,120);},{passive:true});content.addEventListener('mouseup',()=>{lastSelection=readingWebSelection(article,currentUrl,ui.title.textContent,lastSelection);clip.classList.toggle('on',!!lastSelection);note.classList.toggle('on',!!lastSelection);});
      back.onclick=()=>{if(historyIndex<=0)return;historyIndex-=1;loadPage(history[historyIndex],false);};forward.onclick=()=>{if(historyIndex+1>=history.length)return;historyIndex+=1;loadPage(history[historyIndex],false);};chapterPrev.onclick=()=>chapterPrev.dataset.url&&loadPage(chapterPrev.dataset.url,true);chapterNext.onclick=()=>chapterNext.dataset.url&&loadPage(chapterNext.dataset.url,true);navToggle.onclick=()=>{layout.classList.toggle('nav-hidden');navToggle.classList.toggle('on',!layout.classList.contains('nav-hidden'));};navFilter.oninput=()=>{const query=navFilter.value.trim().toLowerCase();navTree.querySelectorAll('li').forEach((item)=>{item.hidden=!!query&&!item.textContent.toLowerCase().includes(query);});};clip.onclick=()=>saveSelection(false);note.onclick=()=>saveSelection(true);zoomRange.oninput=()=>ui.setZoom(zoomRange.value);ui.onZoom((value)=>{zoomRange.value=String(value);});fit.onclick=()=>{const scale=ui.getZoom()/100,baseWidth=article.getBoundingClientRect().width/scale,available=Math.max(240,content.clientWidth-44);ui.setZoom(Math.max(40,Math.min(240,Math.floor(available/baseWidth*100))));};
      renderPage(first,true);navToggle.classList.add('on');readingStatus('整站阅读已就绪 · 目录切换章节，选中文字可摘录或写笔记');return;
    }
    const response=await fetch('/api/readings/file?path='+encodeURIComponent(fragment.path),{cache:'no-store'});if(!response.ok)throw new Error('资料文件读取失败（HTTP '+response.status+'）');const buffer=await response.arrayBuffer();
    if(fragment.kind==='docx'){
      await ensureOfficeWord();const host=document.createElement('div');host.className='reading-docx-host';ui.stage.replaceChildren(host);await window.docx.renderAsync(buffer,host,null,{className:'docx',inWrapper:true,breakPages:true,ignoreLastRenderedPageBreak:true,renderHeaders:true,renderFooters:true,renderFootnotes:true,useBase64URL:true});return;
    }
    if(fragment.kind==='sheet'){
      await ensureOfficeSheet();const workbook=XLSX.read(buffer,{type:'array',cellStyles:true,cellDates:true}),wrap=document.createElement('div'),tabs=document.createElement('div'),table=document.createElement('div');wrap.className='reading-sheet-wrap';tabs.className='reading-sheet-tabs';table.className='reading-sheet-table';const renderSheet=(name)=>{tabs.querySelectorAll('button').forEach((button)=>button.classList.toggle('on',button.dataset.sheet===name));table.innerHTML=XLSX.utils.sheet_to_html(workbook.Sheets[name],{id:'',editable:false});};for(const name of workbook.SheetNames){const button=document.createElement('button');button.type='button';button.dataset.sheet=name;button.textContent=name;button.onclick=()=>renderSheet(name);tabs.appendChild(button);}wrap.append(tabs,table);ui.stage.replaceChildren(wrap);if(workbook.SheetNames.length)renderSheet(workbook.SheetNames[0]);return;
    }
    if(fragment.kind==='slides'){
      const frame=document.createElement('iframe');frame.className='reading-slides-frame';frame.setAttribute('sandbox','allow-scripts');frame.title='PowerPoint 阅读预览';const width=Math.max(640,Math.min(1120,ui.stage.clientWidth-36)),height=Math.round(width*9/16);frame.style.minHeight=Math.max(560,ui.stage.clientHeight-44)+'px';frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;background:#0c1118;color:#dce5f3;font-family:-apple-system,sans-serif}#host{min-height:100vh;padding:24px;box-sizing:border-box}.pptx-preview-wrapper{border-radius:8px;overflow:hidden;box-shadow:0 18px 56px rgba(0,0,0,.55)}</style><script src="/office-pptx/pptx-preview.umd.js"><\/script></head><body><div id="host"></div><script>addEventListener("message",async e=>{if(!e.data||e.data.type!=="codescope-reading-pptx")return;try{const viewer=pptxPreview.init(document.getElementById("host"),{width:e.data.width,height:e.data.height,mode:"slide"});await viewer.preview(e.data.buffer);parent.postMessage({type:"codescope-reading-pptx-rendered"},"*")}catch(error){parent.postMessage({type:"codescope-reading-pptx-error",error:String(error&&error.message||error)},"*")}});parent.postMessage({type:"codescope-reading-pptx-ready"},"*")<\/script></body></html>';ui.stage.replaceChildren(frame);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('演示文稿预览组件加载超时'));},20000);const receive=(event)=>{if(event.source!==frame.contentWindow||!event.data)return;if(event.data.type==='codescope-reading-pptx-ready')frame.contentWindow.postMessage({type:'codescope-reading-pptx',buffer,width,height},'*',[buffer]);else if(event.data.type==='codescope-reading-pptx-rendered'){clearTimeout(timer);window.removeEventListener('message',receive);resolve();}else if(event.data.type==='codescope-reading-pptx-error'){clearTimeout(timer);window.removeEventListener('message',receive);reject(new Error(event.data.error||'演示文稿渲染失败'));}};window.addEventListener('message',receive);});return;
    }
  }catch(error){const failed=document.createElement('div');failed.className='reading-asset-error';failed.textContent=String(error.message||error);ui.stage.replaceChildren(failed);readingStatus('资料加载失败：'+failed.textContent,true);}
}
function readingPdfRefPath(path){return encodeURIComponent(String(path||'')).replace(/'/g,'%27');}
function readingPdfRefDecode(value){try{return decodeURIComponent(String(value||''));}catch(_){return String(value||'');}}
function readingPdfRefMarkdown(doc,item){
  const title=readingBase(doc.path),page=Math.max(1,Number(item.page)||1),source=String(item.source||'').trim();
  const quote=source.split(/\r?\n/).map((line)=>'> '+line).join('\n');
  return '> [!quote] '+title+' · P.'+page+'\n'+quote+'\n>\n> [[pdf-ref:'+readingPdfRefPath(doc.path)+'#page='+page+'&fragment='+encodeURIComponent(item.id||'')+'|↩ P.'+page+' · 定位 PDF 原文]]';
}
function readingWebRefMarkdown(doc,item){
  const title=String(item.webTitle||readingBase(doc.path)),source=String(item.source||'').trim(),quote=source.split(/\r?\n/).map((line)=>'> '+line).join('\n');let target=String(item.url||'');
  if(target&&item.anchor)try{const url=new URL(target);url.hash=item.anchor;target=url.toString();}catch(_){}
  return '> [!quote] '+title+' · 网页\n'+quote+'\n>\n> [↗ 打开网页原文]('+target+')';
}
async function ensureReadingMarkdownNote(projectPath){
  let project=READING_PROJECT_INDEX.get(projectPath),note=project&&project.children&&project.children.find((item)=>item.kind==='markdown');
  if(note)return note;
  const result=await api('/api/readings/text/new',{project:projectPath,name:'阅读笔记.md'});
  if(!result.ok)throw new Error(result.error||'无法创建阅读笔记');
  await loadReadings(true);project=READING_PROJECT_INDEX.get(projectPath);
  return (project&&project.children&&project.children.find((item)=>item.path===result.path))||readingFragment(result.path)||{path:result.path,kind:'markdown',project:projectPath,name:'阅读笔记.md'};
}
async function appendReadingQuoteToNote(doc,item){
  const projectPath=readingProjectFor(doc.path)||READING_PROJECT_CURRENT;if(!projectPath)throw new Error('当前资料不属于阅读项目');
  const note=await ensureReadingMarkdownNote(projectPath);
  let record=READING_TEXT_DOCS.get(note.path);
  if(!record){const result=await api('/api/readings/text-fragment?path='+encodeURIComponent(note.path));if(!result.ok)throw new Error(result.error||'无法读取阅读笔记');record={content:result.content||'',error:''};READING_TEXT_DOCS.set(note.path,record);}
  const isWeb=!!item.url,isMarkdown=item.kind==='markdown';
  const block=isMarkdown?readingMarkdownRefMarkdown(doc,item):isWeb?readingWebRefMarkdown(doc,item):readingPdfRefMarkdown(doc,item),before=String(record.content||'').trimEnd();
  /* 去重标记：PDF 靠 fragment=ID，网页靠 URL+正文开头，Markdown 没有 ID 落在引用块里，就用摘录开头比对。 */
  const marker=isMarkdown?'> '+String(item.source||'').slice(0,80):isWeb?String(item.url||'')+'\n> '+String(item.source||'').slice(0,80):'fragment='+encodeURIComponent(item.id||'');
  const existed=before.includes(marker);
  if(!existed){const next=(before?before+'\n\n':'')+block+'\n';record.content=next;const saved=await api('/api/readings/text-fragment',{path:note.path,content:next});if(!saved.ok){record.content=before;throw new Error(saved.error||'引用写入失败');}record.savedContent=next;}
  const pdfSlot=Math.max(0,READING_SLOTS.findIndex((value)=>value===doc.path)),noteSlot=pdfSlot===0?1:0,previousSlot=READING_ACTIVE_SLOT;
  await openReading(note.path,noteSlot);
  /* 引用只是把笔记开在另一栏给你看，不该顺手把右侧摘录面板从「你正在摘录的那份原文」上抢走 ——
     否则一引用，面板就切到笔记自己的（空的）摘录列表，看起来像是摘录丢了。 */
  if(READING_ACTIVE_SLOT!==previousSlot&&READING_SLOTS[previousSlot]===doc.path){READING_ACTIVE_SLOT=previousSlot;READING_CURRENT=doc.path;renderReadingProjectTabs();renderReadingFragments();syncReadingTools();}
  setTimeout(()=>{const col=document.querySelector('.reading-col[data-slot="'+noteSlot+'"]');const links=col?[...col.querySelectorAll('.reading-pdf-ref')]:[];const link=links.find((el)=>readingPdfRefDecode(el.dataset.fragment)===String(item.id||''));if(link){link.scrollIntoView({block:'center'});link.classList.add('flash');setTimeout(()=>link.classList.remove('flash'),1700);}},80);
  readingStatus((existed?'该引用已存在于':'已引用到')+'「'+readingBase(note.name)+'」'+(isMarkdown?' · 点击来源可回到原文标题':isWeb?' · 网页来源链接已保留':' · 点击来源可返回 PDF'));
  return note;
}
/* Markdown 摘录引用到笔记：来源用 [[md-ref:路径#锚点|标签]] 承载 —— 这条 token 本来就受 mdInline 支持
   （大纲的「复制引用链接」用的就是它），点击会打开原文并滚到对应标题，不需要新增解析分支。 */
function readingMarkdownRefMarkdown(doc,item){
  const title=readingBase(doc.path),source=String(item.source||'').trim();
  const quote=source.split(/\r?\n/).map((line)=>'> '+line).join('\n');
  const anchorText=String(item.anchorText||'').trim();
  const anchor=String(item.anchor||readingMarkdownSlug(anchorText)||'').trim();
  /* 标签里出现 ] 或 | 会截断 token 本身，先清掉。 */
  const label=('↩ 回到《'+title+'》'+(anchorText?' · '+anchorText:'')).replace(/[\]|]/g,' ');
  const head='> [!quote] '+title+(anchorText?' · '+anchorText:'');
  return anchor?head+'\n'+quote+'\n>\n> [[md-ref:'+readingPdfRefPath(doc.path)+'#'+encodeURIComponent(anchor)+'|'+label+']]':head+'\n'+quote;
}
async function savePdfSelectionPayload(payload,cite){
  if(!payload||!payload.path||!payload.text)return null;
  const doc=await ensureReadingDoc(payload.path),item={id:cryptoRandomId(),page:Math.max(1,Number(payload.page)||1),source:String(payload.text).trim(),translation:'',note:'',createdAt:Date.now()};
  if(Array.isArray(payload.rects)&&payload.rects.length){item.rects=payload.rects;item.scale=Number(payload.scale)||1;}
  doc.meta.fragments.unshift(item);await saveReadingDoc(doc);renderReadingFragments();if(window.refreshFragmentMarksAll)window.refreshFragmentMarksAll();
  if(cite)await appendReadingQuoteToNote(doc,item);else readingStatus('摘录已保存 · 可随时引用到 Markdown 笔记');
  return item;
}
async function locateReadingMarkdownRef(link,fromSlot){
  const path=readingPdfRefDecode(link.dataset.pdfPath),page=Math.max(1,Number(link.dataset.page)||1),id=readingPdfRefDecode(link.dataset.fragment);if(!path)return;
  const targetSlot=fromSlot===0?1:0;
  if(READING_SLOTS[targetSlot]!==path)await openReading(path,targetSlot);else{READING_ACTIVE_SLOT=targetSlot;READING_CURRENT=path;renderReadingProjectTabs();}
  const doc=await ensureReadingDoc(path),item=(doc.meta.fragments||[]).find((frag)=>String(frag.id)===id)||{id,page,source:'',rects:[]};
  READING_ACTIVE_SLOT=targetSlot;READING_CURRENT=path;
  const viewer=window.__readingPdfViewer;
  if(viewer&&viewer.alive&&viewer.alive()&&viewer.path===path){viewer.goToPage(page);if(window.flashFragmentMark)setTimeout(()=>window.flashFragmentMark(viewer,item),180);}
  else if(window.locateReadingFragment)await window.locateReadingFragment(doc,item);else await setReadingPage(targetSlot,page);
  readingStatus('已定位引用来源 · P.'+page);
}
async function removeReadingPdfFragment(path,id){
  if(!path||!id)return{ok:true,removed:false};
  const doc=await ensureReadingDoc(path),before=Array.isArray(doc.meta.fragments)?doc.meta.fragments:[],after=before.filter((item)=>String(item&&item.id)!==String(id));
  if(after.length===before.length)return{ok:true,removed:false};
  doc.meta.fragments=after;
  const result=await api('/api/readings/meta',{path:doc.path,meta:doc.meta});
  if(!result.ok){doc.meta.fragments=before;return result;}
  renderReadingFragments();
  if(window.refreshFragmentMarksAll)window.refreshFragmentMarksAll();
  return{ok:true,removed:true,doc,before};
}
async function removeReadingLinkedPdfFragment(link){
  if(!link)return{ok:true,removed:false};
  return removeReadingPdfFragment(readingPdfRefDecode(link.dataset.pdfPath),readingPdfRefDecode(link.dataset.fragment));
}
async function restoreReadingLinkedPdfFragment(change){
  if(!change||!change.removed||!change.doc||!Array.isArray(change.before))return{ok:true};
  change.doc.meta.fragments=change.before;
  const result=await api('/api/readings/meta',{path:change.doc.path,meta:change.doc.meta});
  renderReadingFragments();if(window.refreshFragmentMarksAll)window.refreshFragmentMarksAll();
  return result;
}
function readingPdfRefsInMarkdown(content){
  const refs=new Map(),pattern=/\[\[pdf-ref:([^#\]|]+)#page=\d+&fragment=([^|\]]+)/g;let match;
  while((match=pattern.exec(String(content||'')))){const path=readingPdfRefDecode(match[1]),id=readingPdfRefDecode(match[2]);if(path&&id)refs.set(path+'\n'+id,{path,id});}
  return refs;
}
async function syncRemovedReadingPdfRefs(beforeContent,nextContent){
  const before=readingPdfRefsInMarkdown(beforeContent),after=readingPdfRefsInMarkdown(nextContent),changes=[];
  for(const [key,ref] of before){
    if(after.has(key))continue;
    const change=await removeReadingPdfFragment(ref.path,ref.id);
    if(!change.ok){for(const done of changes.reverse())await restoreReadingLinkedPdfFragment(done);return{ok:false,error:change.error||'PDF 摘录删除失败',changes:[]};}
    if(change.removed)changes.push(change);
  }
  return{ok:true,changes};
}
async function restoreReadingPdfRefChanges(changes){
  let ok=true;for(const change of [...(changes||[])].reverse()){const result=await restoreReadingLinkedPdfFragment(change);if(!result.ok)ok=false;}return ok;
}
let READING_SLASH_MENU=null,READING_SLASH_STATE=null;
const READING_SLASH_COMMANDS=[
  {id:'paragraph',icon:'¶',label:'正文',desc:'普通文本段落',key:'/text',snippet:'',words:'正文 段落 text paragraph'},
  {id:'h1',icon:'H1',label:'一级标题',desc:'页面主标题',key:'/h1',snippet:'# ',words:'一级 标题 h1 heading'},
  {id:'h2',icon:'H2',label:'二级标题',desc:'章节标题',key:'/h2',snippet:'## ',words:'二级 标题 h2 heading'},
  {id:'h3',icon:'H3',label:'三级标题',desc:'小节标题',key:'/h3',snippet:'### ',words:'三级 标题 h3 heading'},
  {id:'bullet',icon:'•',label:'无序列表',desc:'创建项目符号列表',key:'/bullet',snippet:'- ',words:'无序 列表 bullet ul list'},
  {id:'number',icon:'1.',label:'有序列表',desc:'创建编号列表',key:'/number',snippet:'1. ',words:'有序 编号 列表 number ol list'},
  {id:'task',icon:'☐',label:'待办列表',desc:'创建可继续编辑的任务项',key:'/todo',snippet:'- [ ] ',words:'待办 任务 清单 todo task'},
  {id:'quote',icon:'❝',label:'普通引用',desc:'插入 Markdown 引用段落',key:'/quote',snippet:'> ',words:'引用 引文 quote'},
  {id:'callout',icon:'!',label:'提示块',desc:'插入 Obsidian 风格提示块',key:'/note',snippet:'> [!note] 笔记\n> ',words:'提示 标注 笔记 note callout'},
  {id:'code',icon:'</>',label:'代码块',desc:'插入 Markdown 围栏代码',key:'/code',snippet:'```\n\n```',words:'代码 围栏 code fence'},
  {id:'divider',icon:'—',label:'分隔线',desc:'分隔不同笔记章节',key:'/divider',snippet:'---\n\n',words:'分隔线 横线 divider hr'},
];
function hideReadingSlashMenu(){if(READING_SLASH_MENU)READING_SLASH_MENU.hidden=true;READING_SLASH_STATE=null;}
function ensureReadingSlashMenu(){
  if(READING_SLASH_MENU)return READING_SLASH_MENU;
  const menu=document.createElement('div');menu.className='reading-slash-menu';menu.hidden=true;menu.addEventListener('mousedown',(e)=>e.preventDefault());document.body.appendChild(menu);
  document.addEventListener('pointerdown',(e)=>{if(READING_SLASH_STATE&&!menu.contains(e.target))hideReadingSlashMenu();});
  document.addEventListener('scroll',(e)=>{if(READING_SLASH_STATE&&!menu.contains(e.target))hideReadingSlashMenu();},true);
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&READING_SLASH_STATE)hideReadingSlashMenu();});
  window.addEventListener('resize',hideReadingSlashMenu);window.addEventListener('blur',hideReadingSlashMenu);READING_SLASH_MENU=menu;return menu;
}
function readingSlashContext(editor){
  const sel=window.getSelection();if(!sel||!sel.rangeCount||sel.isCollapsed===undefined)return null;
  const range=sel.getRangeAt(0),anchor=range.startContainer,node=anchor.nodeType===3?anchor.parentElement:anchor;if(!node||!editor.contains(node))return null;
  let block=node.closest&&node.closest('p,div,h1,h2,h3,h4,h5,h6,li,blockquote');if(!block||!editor.contains(block))block=editor;
  const value=String(block.textContent||'').replace(/\u200b/g,'').trim(),match=value.match(/^\/([^\s/]*)$/);if(!match)return null;
  const rect=range.getBoundingClientRect(),fallback=editor.getBoundingClientRect();return{editor,block,query:match[1].toLowerCase(),rect:rect.width||rect.height?rect:{left:fallback.left+18,right:fallback.left+18,top:fallback.top+18,bottom:fallback.top+36}};
}
function readingSourceSlashContext(editor){
  const caret=editor.selectionStart;if(caret==null||editor.selectionEnd!==caret)return null;const before=editor.value.slice(0,caret),lineStart=before.lastIndexOf('\n')+1,line=before.slice(lineStart),match=line.match(/^\s*\/([^\s/]*)$/);if(!match)return null;
  const box=editor.getBoundingClientRect(),lineHeight=parseFloat(getComputedStyle(editor).lineHeight)||20,visibleLine=Math.max(0,before.slice(0,lineStart).split('\n').length-1-Math.floor(editor.scrollTop/lineHeight));const top=Math.min(box.bottom-24,box.top+20+visibleLine*lineHeight);return{editor,source:true,start:lineStart,end:caret,query:match[1].toLowerCase(),rect:{left:box.left+24,right:box.left+24,top,bottom:top+lineHeight}};
}
function renderReadingSlashMenu(){
  const state=READING_SLASH_STATE,menu=ensureReadingSlashMenu();if(!state||!state.editor||!state.editor.isConnected||(state.block&&!state.block.isConnected)){hideReadingSlashMenu();return;}
  const query=state.query,items=READING_SLASH_COMMANDS.filter((cmd)=>!query||cmd.words.toLowerCase().includes(query)||cmd.id.includes(query));state.items=items;if(state.index>=items.length)state.index=0;
  menu.replaceChildren();const head=document.createElement('div');head.className='reading-slash-head';head.textContent=state.transform?'转换区块':query?'筛选命令 · '+query:'基础块';menu.appendChild(head);
  for(const [index,cmd] of items.entries()){const button=document.createElement('button');button.type='button';button.className='reading-slash-item'+(index===state.index?' on':'');button.dataset.command=cmd.id;const icon=document.createElement('span');icon.className='icon';icon.textContent=cmd.icon;const copy=document.createElement('span');copy.className='copy';const label=document.createElement('span');label.className='label';label.textContent=cmd.label;const desc=document.createElement('span');desc.className='desc';desc.textContent=cmd.desc;copy.append(label,desc);const key=document.createElement('span');key.className='key';key.textContent=cmd.key;button.append(icon,copy,key);button.onclick=()=>applyReadingSlashCommand(cmd);menu.appendChild(button);}
  if(!items.length){const empty=document.createElement('div');empty.className='reading-slash-head';empty.textContent='没有匹配命令';menu.appendChild(empty);}
  menu.hidden=false;const width=menu.offsetWidth||310,height=menu.offsetHeight||250,left=Math.max(8,Math.min(state.rect.left,innerWidth-width-8));let top=state.rect.bottom+7;if(top+height>innerHeight-8)top=Math.max(8,state.rect.top-height-7);menu.style.left=left+'px';menu.style.top=top+'px';
}
function updateReadingSlashMenu(editor,slot){const context=editor.tagName==='TEXTAREA'?readingSourceSlashContext(editor):readingSlashContext(editor);if(!context){if(READING_SLASH_STATE&&READING_SLASH_STATE.editor===editor)hideReadingSlashMenu();return;}READING_SLASH_STATE={...context,slot,index:(READING_SLASH_STATE&&READING_SLASH_STATE.editor===editor?READING_SLASH_STATE.index:0),items:[]};renderReadingSlashMenu();}
function focusReadingBlock(node){
  const target=node&&node.nodeType===1?node:null;if(!target)return;target.focus&&target.focus();const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(target);range.collapse(true);sel.removeAllRanges();sel.addRange(range);
}
function applyReadingSlashCommand(command){
  const state=READING_SLASH_STATE;if(!state||!command)return;const editor=state.editor;
  if(state.transform){const focus=transformReadingLiveBlock(state.block,command);hideReadingSlashMenu();if(focus)focusReadingBlock(focus);editor.dispatchEvent(new Event('input',{bubbles:true}));return;}
  if(state.source){const snippet=command.snippet==null?'':command.snippet;editor.setRangeText(snippet,state.start,state.end,'end');hideReadingSlashMenu();editor.focus();editor.dispatchEvent(new Event('input',{bubbles:true}));return;}
  const block=state.block,fragment=document.createDocumentFragment();let first=null;
  const element=(tag)=>{const el=document.createElement(tag);el.appendChild(document.createElement('br'));first=first||el;return el;};
  if(command.id==='bullet'||command.id==='number'||command.id==='task'){const list=document.createElement(command.id==='number'?'ol':'ul'),li=document.createElement('li');if(command.id==='task'){li.className='md-task';const check=document.createElement('input');check.type='checkbox';check.disabled=true;const text=document.createElement('span');text.appendChild(document.createElement('br'));li.append(check,text);first=text;}else{li.appendChild(document.createElement('br'));first=li;}list.appendChild(li);fragment.appendChild(list);}
  else if(command.id==='quote'){const quote=document.createElement('blockquote');quote.appendChild(document.createElement('br'));fragment.appendChild(quote);first=quote;}
  else if(command.id==='callout'){const quote=document.createElement('blockquote');quote.className='md-callout note';quote.dataset.callout='note';const remove=document.createElement('button');remove.type='button';remove.className='callout-remove';remove.contentEditable='false';remove.title='移除这个提示块';remove.textContent='×';const title=document.createElement('strong');title.className='callout-title';title.textContent='❝ 笔记';const body=document.createElement('div');body.className='callout-body';body.appendChild(document.createElement('br'));quote.append(remove,title,body);fragment.appendChild(quote);first=body;}
  else if(command.id==='code'){const pre=document.createElement('pre');pre.className='md-code-block';const code=document.createElement('code');code.appendChild(document.createElement('br'));pre.appendChild(code);fragment.appendChild(pre);first=code;}
  else if(command.id==='divider'){fragment.appendChild(document.createElement('hr'));fragment.appendChild(element('p'));}
  else fragment.appendChild(element(command.id==='paragraph'?'p':command.id));
  if(block===editor)editor.replaceChildren(fragment);else block.replaceWith(fragment);hideReadingSlashMenu();editor.__keepEmptyBlockOnce=true;focusReadingBlock(first);editor.dispatchEvent(new Event('input',{bubbles:true}));
}
function readingSlashKeydown(event,editor){
  const state=READING_SLASH_STATE;if(!state||state.editor!==editor||!READING_SLASH_MENU||READING_SLASH_MENU.hidden)return false;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const size=Math.max(1,state.items.length);state.index=(state.index+(event.key==='ArrowDown'?1:-1)+size)%size;renderReadingSlashMenu();return true;}
  if(event.key==='Enter'&&state.items.length){event.preventDefault();applyReadingSlashCommand(state.items[state.index]);return true;}
  if(event.key==='Escape'){event.preventDefault();hideReadingSlashMenu();return true;}return false;
}
function readingMarkdownModeKey(path){return 'mc-reading-markdown-mode:'+String(path||'');}
function loadReadingMarkdownMode(path){try{const value=localStorage.getItem(readingMarkdownModeKey(path));if(value==='split')return 'live';return ['edit','live','preview'].includes(value)?value:'live';}catch(_){return 'live';}}
function saveReadingMarkdownMode(path,mode){try{localStorage.setItem(readingMarkdownModeKey(path),mode);}catch(_){}}
function readingMarkdownZoomKey(path){return 'mc-reading-md-zoom:'+String(path||'');}
function loadReadingMarkdownZoom(path){try{const value=Number(localStorage.getItem(readingMarkdownZoomKey(path)));return Number.isFinite(value)&&value>=60&&value<=180?Math.round(value):100;}catch(_){return 100;}}
function saveReadingMarkdownZoom(path,value){try{localStorage.setItem(readingMarkdownZoomKey(path),String(value));}catch(_){} }
function readingMarkdownOutlineKey(path){return 'mc-reading-md-outline:'+String(path||'');}
function loadReadingMarkdownOutline(path){try{return localStorage.getItem(readingMarkdownOutlineKey(path))!=='0';}catch(_){return true;}}
function saveReadingMarkdownOutline(path,value){try{localStorage.setItem(readingMarkdownOutlineKey(path),value?'1':'0');}catch(_){} }
function readingMarkdownHeadings(content){const result=[],lines=String(content||'').split('\n');let fenced=false;for(let line=0;line<lines.length;line++){if(/^\s*```/.test(lines[line])){fenced=!fenced;continue;}if(fenced)continue;const match=lines[line].match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);if(!match)continue;const text=match[2].replace(/!?(\[([^\]]*)\])\([^)]*\)/g,'$2').replace(/[*_~`]/g,'').trim();if(text)result.push({level:match[1].length,text,line});}return result;}
/* 大纲层级归属：展开祖先链 → 标记祖先链 → 更新「当前章节路径」。
   独立成函数，不侵入原有的滚动与高亮逻辑。 */
function syncReadingMarkdownOutlinePath(outlineList,index,autoUnfold){
  const buttons=[...outlineList.querySelectorAll('.reading-md-outline-item')];
  const levelOf=(node)=>Number((node&&node.dataset&&node.dataset.level)||0);
  const labelOf=(node)=>{const label=node&&node.querySelector('.label');return label?label.textContent:'';};
  const chain=[];let need=levelOf(buttons[index]);
  for(let i=index-1;i>=0;i--){const level=levelOf(buttons[i]);if(level&&level<need){chain.push(i);need=level;}}
  buttons.forEach((button,itemIndex)=>button.classList.toggle('in-path',chain.indexOf(itemIndex)>=0));
  let unfolded=false;
  if(autoUnfold)chain.forEach((i)=>{if(buttons[i].dataset.folded==='1'){buttons[i].dataset.folded='0';buttons[i].setAttribute('aria-expanded','true');unfolded=true;}});
  if(unfolded&&typeof outlineList.__refreshFold==='function')outlineList.__refreshFold();
  const path=outlineList.__path;
  if(!path)return;
  const current=buttons[index];
  if(!current||!chain.length){path.box.classList.remove('on');return;}
  const parentText=labelOf(buttons[chain[0]]),currentText=labelOf(current);
  if(path.parent.textContent!==parentText)path.parent.textContent=parentText;
  if(path.current.textContent!==currentText)path.current.textContent=currentText;
  path.box.classList.add('on');
}
/* 正文滚动比例 → 大纲头部下沿的阅读进度条 */
function updateReadingMarkdownOutlineProgress(container,outlineList){
  const outline=outlineList&&outlineList.closest?outlineList.closest('.reading-md-outline'):null;
  if(!outline)return;
  const max=Math.max(0,(container.scrollHeight||0)-(container.clientHeight||0));
  const ratio=max>8?Math.min(1,Math.max(0,(container.scrollTop||0)/max)):0;
  outline.style.setProperty('--outline-progress',ratio.toFixed(4));
}
/* ⚠️ autoUnfold 只给「用户主动定位」用（点大纲条目 / 编辑时同步）——
   滚动跟随**绝不能**展开 ✗：用户手动折叠了章节，一滚到它下面就又被展开，
   而且展开会触发 __refreshFold() 重排大纲 DOM，offsetTop 一变又影响跟随滚动，
   来回就是「乱跳」。 */
function setReadingMarkdownOutlineActive(outlineList,index,keepVisible=true,autoUnfold=false){
  syncReadingMarkdownOutlinePath(outlineList,index,autoUnfold);
  const buttons=[...outlineList.querySelectorAll('.reading-md-outline-item')];
  buttons.forEach((button,itemIndex)=>button.classList.toggle('active',itemIndex===index));
  const active=buttons[index];
  /* ★ 这里必须用**瞬时**滚动（直接写 scrollTop）✗✗ —— 原来写的是 behavior:'smooth'，
     而滚动正文时**每一帧**都会走到这里：上一帧的平滑滚动还没结束、下一帧又发起新的，
     目标互相打断；更糟的是平滑滚动期间 scrollTop 是**渐变的**，于是 viewTop/viewBottom
     的判断在帧与帧之间反复翻转，形成反馈循环 → 大纲就会「乱跳」（用户报的正是这个）。
     跟随高亮本来就该「跟」而不是「滑」；直接写 scrollTop 是**幂等**的，重复调用无副作用。 */
  /* ★ 交给浏览器算滚动位置 ✓✓ —— 原来手算 active.offsetTop 再写 scroller.scrollTop，
     但 offsetTop 是相对「**最近的定位祖先**」的，而 .reading-md-outline-list 正好是
     position:relative ✗ → 基准比滚动容器（aside）少了一个头部高度 →
     滚过去总是偏（用户：「没有滚动到合适位置」）。
     scrollIntoView 由浏览器自己找**正确的滚动祖先** ✓；block:'nearest' 是**幂等**的 ✓
     （已经在视口里就什么都不做），也不会像 behavior:'smooth' 那样每帧重启动画、互相打断 ✓。
     留白交给 CSS 的 scroll-margin（见 .reading-md-outline-item）。 */
  if(keepVisible&&active){try{active.scrollIntoView({block:'nearest',inline:'nearest'});}catch(_){}}
}
function readingMarkdownViewHeadings(container,isPreview){return isPreview?[...container.querySelectorAll('[data-outline-index]')]:[...container.querySelectorAll('.ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6')];}
/* 大纲条目由源码解析而来，DOM 里的标题常常更多（setext 标题、引用块内标题、HTML 标题…），
   按下标硬取会点错标题。这里按「层级 + 文本」按顺序配对，配不上再退回同下标。 */
function readingMarkdownHeadingElement(node){if(!node)return null;if(node.matches&&node.matches('h1,h2,h3,h4,h5,h6'))return node;return node.querySelector?node.querySelector('h1,h2,h3,h4,h5,h6'):null;}
function readingMarkdownPairOutline(entries,nodes){
  /* ⚠️⚠️ 必须去掉零宽字符 ✗✗ —— ProseMirror/Milkdown 会在标题文本里插 \u200b
     （项目里别处已有两处在清它，见第 2080 行的 replace(/\u200b/g,'')），
     而 \u200b **不属于 \s** ✗ → 两边文本永远不相等 → 配对全部失败 → 退回「同下标」，
     再叠加 DOM 里存在大纲没有的标题（引用块内标题等）→ **整个映射错位**
     （用户报的正是这个：鼠标在「里程计」，大纲却高亮到章节末尾的「七、一览速查」）。 */
  const norm=(v)=>String(v==null?'':v).replace(/[\u200b\u200c\u200d\u2060\ufeff]/g,'').replace(/\s+/g,' ').trim();
  const used=new Array(nodes.length).fill(false),byEntry=new Array(entries.length).fill(-1);
  let cursor=0;
  for(let i=0;i<entries.length;i++){
    const want=norm(entries[i].text),level=Number(entries[i].level)||0;
    let exact=-1,partial=-1;
    /* ★ 精确匹配只在 cursor 之后的**窗口内**找 ✓ —— 原来一直扫到末尾 ✗：
       某个条目的文本若恰好等于很后面某个标题，就会「跳跃式」命中 → cursor 前移 →
       中间那些条目全部错位。窗口内匹配既能跳过「引用块内标题」这类多余节点，
       又不会跳到远处（窗口外找不到就退回顺序/同下标，和原来一样安全）。 */
    const limit=Math.min(nodes.length,cursor+8);
    for(let k=cursor;k<limit;k++){
      if(used[k])continue;
      const el=readingMarkdownHeadingElement(nodes[k])||nodes[k];
      if((Number((el.tagName||'').slice(1))||0)!==level)continue;
      const text=norm(el.textContent);
      if(text===want){exact=k;break;}
      /* ★ 用 includes 而不是 startsWith ✗✗ —— 标题文本经常被 ProseMirror 改写
         （前面挂序号、后面加锚点标记、插入零宽字符…），startsWith 太严会全部落空 →
         配对整体失败 → 高亮长期停在开头。includes 宽松得多，且标题本身够长、仍有区分度。 */
      if(partial<0&&want&&want.length>1&&(text.includes(want)||want.includes(text)))partial=k;
    }
    let found=exact>=0?exact:partial;
    /* ★★ 文本没匹配上时，**按「层级 + 顺序」兜底** ✗✗ —— 原来是退到「同下标 i」：
       DOM 里一旦有大纲没有的标题（引用块内标题、HTML 标题、表格里的标题…），
       下标就整体错位、越往后越配不上 → 结果只有最前面几个能配上 →
       高亮长期停在开头（用户报的正是这个：「在里程计下面输入内容，大纲跳到开头」）。
       大纲条目和 DOM 标题**都是源码顺序**，所以「从 cursor 起第一个同层级的」最稳 ✓。 */
    if(found<0){for(let k=cursor;k<nodes.length;k++){if(used[k])continue;const el=readingMarkdownHeadingElement(nodes[k])||nodes[k];if((Number((el.tagName||'').slice(1))||0)!==level)continue;found=k;break;}}
    if(found<0&&i<nodes.length&&!used[i])found=i;
    if(found<0){for(let k=0;k<nodes.length;k++){if(!used[k]){found=k;break;}}}
    if(found<0)break;
    used[found]=true;cursor=found+1;byEntry[i]=found;
  }
  return byEntry;
}
function readingMarkdownOutlineNodes(entries,container,isPreview){const nodes=readingMarkdownViewHeadings(container,isPreview);return readingMarkdownPairOutline(entries,nodes).map((k)=>(k>=0?nodes[k]:null));}
/* 跳转后在文内闪一下，让眼睛知道落点在哪 */
/* 全应用范围内动画时长被压成 0（任何 animationend 都会立刻触发），
   所以闪烁不能用 CSS 动画实现：改为「加类 → 去掉 → 再加类」的静态高亮切换。 */
function flashReadingMarkdownHeading(resolve){
  /* 不能用「给标题加类名」做高亮：ProseMirror 的 DOMObserver 会监听自身 DOM 上的外部改动
     并立刻重绘该节点，加上的类名/属性马上被抹掉（实测直接调用命中 0/12）。
     因此在 body 上放一个 position:fixed 浮层圈覆盖目标标题，并每帧重新解析目标，
     节点被重绘也能跟上。全程不修改编辑器 DOM。 */
  const getEl=(typeof resolve==='function')?resolve:()=>resolve;
  let ring=document.getElementById('reading-md-focus-ring');
  if(!ring){ring=document.createElement('div');ring.id='reading-md-focus-ring';document.body.appendChild(ring);}
  const start=performance.now(),DURATION=1600;
  if(ring.__raf)cancelAnimationFrame(ring.__raf);
  const tick=()=>{
    const elapsed=performance.now()-start;
    if(elapsed>DURATION){ring.style.opacity='0';ring.__raf=0;return;}
    const el=getEl();
    if(el&&el.getBoundingClientRect){const r=el.getBoundingClientRect();
      ring.style.left=r.left+'px';ring.style.top=r.top+'px';ring.style.width=r.width+'px';ring.style.height=r.height+'px';}
    ring.style.opacity=(elapsed>300&&elapsed<400)?'0':'1';
    ring.__raf=requestAnimationFrame(tick);
  };
  ring.__raf=requestAnimationFrame(tick);
}
/* ── 已摘录文字的正文标记 ──
   和落点高亮同一个理由：不能给正文节点加类名/属性，ProseMirror 的 DOMObserver 会立刻重绘掉，
   所以在 body 上放一层浮层，按摘录文字在 DOM 里的真实矩形画标记。
   但落点高亮只闪 1.6 秒可以每帧重算，这层要长期存在，每帧重算太贵 ——
   改成由「会让文字移动的事件」驱动：编辑器重绘（MutationObserver）、滚动、尺寸变化、模式切换、摘录增删。
   重算时把矩形夹进正文容器可视区，免得标记画到顶栏、大纲抽屉或右侧面板上。 */
let READING_MARK_LAYER=null,READING_MARK_FRAME=0,READING_MARK_OBSERVER=null,READING_MARK_HOSTS=new Set();
function readingMarkLayer(){
  if(READING_MARK_LAYER&&READING_MARK_LAYER.isConnected)return READING_MARK_LAYER;
  READING_MARK_LAYER=document.createElement('div');READING_MARK_LAYER.id='reading-md-excerpt-marks';
  document.body.appendChild(READING_MARK_LAYER);return READING_MARK_LAYER;
}
/* 两栏都可能开着 Markdown，所以是「每个可见的 Markdown 栏各一份」，而不是只看活动栏 ——
   否则点一下 PDF 那栏，Markdown 栏的标记就会整片消失。 */
function readingMarkTargets(){
  const targets=[];
  for(const path of READING_SLOTS){
    if(!path)continue;
    const view=readingMarkdownView(path);if(!view||!view.container||view.mode==='edit')continue;
    const doc=READING_DOCS.get(path);if(!doc)continue;
    const items=((doc.meta&&doc.meta.fragments)||[]).filter((item)=>item.kind==='markdown'&&item.source);
    if(items.length)targets.push({view,items});
  }
  return targets;
}
/* 一个观察器盯多个容器；容器集合变了就整组重挂（disconnect 会清掉全部目标，所以只能重来）。 */
function syncReadingMarkObservers(containers){
  if(typeof MutationObserver!=='function')return;
  const same=containers.length===READING_MARK_HOSTS.size&&containers.every((node)=>READING_MARK_HOSTS.has(node));
  if(same)return;
  if(READING_MARK_OBSERVER)READING_MARK_OBSERVER.disconnect();
  READING_MARK_HOSTS=new Set(containers);
  if(!containers.length)return;
  if(!READING_MARK_OBSERVER)READING_MARK_OBSERVER=new MutationObserver(()=>scheduleReadingExcerptMarks());
  for(const node of containers)READING_MARK_OBSERVER.observe(node,{childList:true,subtree:true,characterData:true});
}
function refreshReadingExcerptMarks(){
  READING_MARK_FRAME=0;
  const layer=readingMarkLayer(),targets=readingMarkTargets();
  /* 观察器要「一拿到容器就挂上」，不能等算出矩形再挂：区块编辑器是异步挂载的，
     第一次重算时正文可能还没渲染出来，若那时才决定挂不挂，就永远等不到后续的重绘事件。
     观察器只动浮层、不动容器，所以不会自己触发自己。 */
  syncReadingMarkObservers(targets.map((target)=>target.view.container));
  if(!targets.length){layer.replaceChildren();layer.hidden=true;return;}
  const boxes=[];
  for(const target of targets){
    const container=target.view.container,clip=container.getBoundingClientRect();
    for(const item of target.items){
      const range=readingFindTextRange(container,item.source);if(!range)continue;
      for(const box of range.getClientRects()){
        /* 夹进正文可视区：正文会滚动，不夹的话标记会画到顶栏、大纲抽屉或右侧面板上。 */
        const left=Math.max(box.left,clip.left),right=Math.min(box.right,clip.right);
        const top=Math.max(box.top,clip.top),bottom=Math.min(box.bottom,clip.bottom);
        if(right-left<1||bottom-top<1)continue;
        boxes.push({left,top,width:right-left,height:bottom-top,id:String(item.id||'')});
      }
    }
  }
  if(!boxes.length){layer.replaceChildren();layer.hidden=true;return;}
  layer.hidden=false;
  while(layer.children.length>boxes.length)layer.lastElementChild.remove();
  boxes.forEach((box,index)=>{
    let node=layer.children[index];
    if(!node){node=document.createElement('div');layer.appendChild(node);}
    node.dataset.fragmentId=box.id;
    node.style.cssText='left:'+box.left+'px;top:'+box.top+'px;width:'+box.width+'px;height:'+box.height+'px;';
  });
}
function scheduleReadingExcerptMarks(){if(!READING_MARK_FRAME)READING_MARK_FRAME=requestAnimationFrame(refreshReadingExcerptMarks);}
/* 尺寸变化会让正文换行、矩形全变，跟着重算一次。 */
window.addEventListener('resize',()=>scheduleReadingExcerptMarks());
function readingMarkdownViewportOffset(container,isPreview){if(isPreview)return 24;const bar=container.querySelector('.milkdown-top-bar');return Math.max(24,(bar&&bar.getBoundingClientRect().height||0)+18);}
function syncReadingMarkdownOutlineView(container,outlineList,isPreview){
  const nodes=readingMarkdownViewHeadings(container,isPreview);if(!nodes.length)return setReadingMarkdownOutlineActive(outlineList,-1,false);
  if(Number.isInteger(container.__outlineTargetIndex))return setReadingMarkdownOutlineActive(outlineList,container.__outlineTargetIndex);
  /* DOM 标题数与大纲条目数可能不等，先配对出「第 k 个 DOM 标题对应第几条大纲」再算高亮，
     否则滚动时会高亮到错误的条目（跳转后尤其明显）。 */
  const buttons=[...outlineList.querySelectorAll('.reading-md-outline-item')];
  const entryOfNode=new Array(nodes.length).fill(-1);
  readingMarkdownPairOutline(buttons.map((b)=>({level:Number(b.dataset.level)||0,text:(b.querySelector('.label')||b).textContent})),nodes).forEach((nodeIndex,entryIndex)=>{if(nodeIndex>=0)entryOfNode[nodeIndex]=entryIndex;});
  /* ★ 判定基准**不能贴在容器顶部** ✗✗ —— 用户看的是**视口中间那块**：
     正文顶部常常还是上一节的尾巴（代码块、表格、图），基准贴顶就会一直高亮「上一节」，
     表现出来就是「我明明在看『里程计』，大纲却指着别处」（用户报的正是这个）。
     往下放到约 1/3 高度处，才和人的视觉焦点对齐。 */
  const bounds=container.getBoundingClientRect(),anchor=bounds.top+readingMarkdownViewportOffset(container,isPreview)+bounds.height*0.28;
  /* ★ 初值必须是 -1 ✗✗ —— 原来是 0：一旦**所有条目都没配上**（entryOfNode 全 -1，
     例如标题文本刚被 ProseMirror 重绘、或大纲刚重建还没配对），active 就停在 0 →
     大纲「跳到开头」。用户报的正是这个（在「里程计」下面打字时，输入会让编辑器
     自动滚动保持光标可见，从而触发一次同步）。
     改成：一个都没配上就**什么都不做**，保持上一次的高亮，别乱跳。 */
  let active=-1,last=-1;
  /* 跳转后标题正好停在 anchor 处，亚像素误差会让 top<=anchor 落空，高亮就慢一拍；
     给 10px 容差（相邻标题间距远大于 10px，不会误判）。 */
  const slack=anchor+10;
  for(let index=0;index<nodes.length;index++){
    if(nodes[index].getBoundingClientRect().top<=slack){if(entryOfNode[index]>=0)last=entryOfNode[index];active=last;}else break;
  }
  /* ⚠️ 这里**不能**再加「配对率阈值」✗✗ —— 试过一版「配上的不到一半就不更新」，
     结果风险更大：配对率只要偏低，大纲就**完全不动**，比「指到错误位置」更糟
     （用户会以为彻底坏了）。配对不完美时，让它按现有信息更新即可，至少还在跟。 */
  if(active>=0)setReadingMarkdownOutlineActive(outlineList,active);
}
/* ── 颜色 / 高亮 ──
   预览侧由 mdInline 直接把语法渲染成锚点；区块编辑侧则不同：编辑器只保留 markdown 原生结构，
   自定义标签会被丢掉（实测 <mark>、<span> 都留不住），而「链接」是它原生的 mark、能原样保留。
   所以把 ==文字== 编码成 [文字](#cc-hl)、把 {红|文字} 编码成 [文字](#cc-fg-red) 再交给编辑器，
   由纯 CSS 按 href 上色 —— 不写内联样式（内联样式同样会被 ProseMirror 重绘抹掉）。
   内容进出编辑器时做正反两次转换，所以磁盘上的文档永远是用户敲的那套语法，而不是编码后的链接。 */
const MD_COLOR_KEYS={红:'red',橙:'orange',黄:'yellow',绿:'green',青:'cyan',蓝:'blue',紫:'purple',粉:'pink',灰:'gray'};
const MD_COLOR_NAMES={red:'红',orange:'橙',yellow:'黄',green:'绿',cyan:'青',blue:'蓝',purple:'紫',pink:'粉',gray:'灰'};
/* 围栏代码块与行内代码先抽成占位符，免得代码里的 == 或 {红|…} 被颜色规则误伤 */
function mdColorGuard(text,transform){
  const holes=[],source=String(text==null?'':text);
  const keep=(match)=>{holes.push(match);return '\u0002'+(holes.length-1)+'\u0002';};
  const guarded=source.replace(/```[\s\S]*?```/g,keep).replace(/~~~[\s\S]*?~~~/g,keep).replace(/`[^`\n]*`/g,keep);
  return transform(guarded).replace(/\u0002(\d+)\u0002/g,(m,index)=>holes[Number(index)]===undefined?m:holes[Number(index)]);
}
/* 文档内/跨文档引用也用同一套编码：[[md-ref:路径#锚点|标题]] → [标题](#cc-mdref-<base64url>)。
   用 base64url 是因为 href 里放原文会撞上转义/大小写归一化，而编辑器只把它当普通链接，
   只要两端自己认得出来就够了。 */
function mdRefB64(value){
  try{const bytes=new TextEncoder().encode(String(value==null?'':value));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}catch(_){return '';}
}
function mdRefUnb64(value){
  try{const raw=atob(String(value||'').replace(/-/g,'+').replace(/_/g,'/'));const bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new TextDecoder().decode(bytes);}catch(_){return '';}
}
function mdSyntaxToEditor(text){
  return mdColorGuard(text,(t)=>t
    .replace(/\[\[md-ref:([^#|\]]+)#([^|\]]+)\|([^\]]+)\]\]/g,(m,target,anchor,label)=>'['+label+'](#cc-mdref-'+mdRefB64(readingPdfRefDecode(target)+'#'+readingPdfRefDecode(anchor))+')')
    .replace(/==([^=\n]+)==/g,'[$1](#cc-hl)')
    .replace(/\{([红橙黄绿青蓝紫粉灰])\|([^}\n]+)\}/g,(m,key,body)=>'['+body+'](#cc-fg-'+(MD_COLOR_KEYS[key]||'red')+')'));
}
function mdSyntaxFromEditor(text){
  return mdColorGuard(text,(t)=>t
    .replace(/\[([^\]\n]+)\]\(#cc-mdref-([A-Za-z0-9_-]+)(?:\s+"[^"]*")?\)/g,(m,label,encoded)=>{
      const payload=mdRefUnb64(encoded),cut=payload.indexOf('#'),target=cut<0?payload:payload.slice(0,cut),anchor=cut<0?'':payload.slice(cut+1);
      return target?'[[md-ref:'+encodeURIComponent(target)+'#'+encodeURIComponent(anchor)+'|'+label.replace(/\\([\\\[\]])/g,'$1')+']]':m;})
    .replace(/\[([^\]\n]+)\]\(#cc-hl(?:\s+"[^"]*")?\)/g,'==$1==')
    .replace(/\[([^\]\n]+)\]\(#cc-fg-([a-z]+)(?:\s+"[^"]*")?\)/g,(m,body,key)=>'{'+(MD_COLOR_NAMES[key]||'红')+'|'+body.replace(/\\([\\\[\]])/g,'$1')+'}'));
}
/* 标题 → 锚点 id。与 Crepe 给编辑区标题生成的 id 规则保持一致（空格转连字符，保留中日韩，去掉标点）。 */
function readingMarkdownSlug(text){return String(text==null?'':text).trim().toLowerCase()
  .replace(/[\s\u3000]+/g,'-')
  .replace(/[!"#$%&'()*+,.\/:;<=>?@\[\\\]^_`{|}~]/g,'')
  .replace(/[。，、；：？！“”‘’（）《》【】〔〕…—～·「」『』]/g,'')
  .replace(/-{2,}/g,'-').replace(/^-+|-+$/g,'');}
/* 把 #锚点 解析成工作区里真实的标题节点：先按 id，再按标题文本，最后按 slug 兜底。
   预览模式的标题原本没有 id，两者都靠文本匹配兜住，所以用户手写的锚点不必和生成规则完全一致。 */
function readingMarkdownAnchorTarget(container,raw,isPreview){
  if(!container||!raw)return null;
  const scope=container.querySelector(isPreview?'.reading-md-preview-content':'.milkdown .ProseMirror')||container;
  const want=String(raw).trim();
  let node=null;try{node=scope.querySelector('[id="'+want.replace(/["\\]/g,'\\$&')+'"]');}catch(_){node=null;}
  if(!node){try{node=scope.querySelector('[id="md-'+want.replace(/["\\]/g,'')+'"]');}catch(_){node=null;}}
  if(node)return node;
  const heads=[...scope.querySelectorAll('h1,h2,h3,h4,h5,h6')],norm=(t)=>String(t==null?'':t).replace(/\s+/g,' ').trim();
  const wantSlug=readingMarkdownSlug(want),wantText=norm(want);
  return heads.find((h)=>norm(h.textContent)===wantText)||heads.find((h)=>h.id&&(h.id===want||readingMarkdownSlug(h.id)===wantSlug))||heads.find((h)=>readingMarkdownSlug(h.textContent)===wantSlug)||null;
}
function scrollReadingMarkdownHeading(container,node,isPreview){if(!node)return;const bounds=container.getBoundingClientRect(),target=container.scrollTop+node.getBoundingClientRect().top-bounds.top-readingMarkdownViewportOffset(container,isPreview);container.scrollTo({top:Math.max(0,target),behavior:'smooth'});}
function removeReadingMarkdownBlock(content,start,end){const lines=String(content||'').split('\n');lines.splice(Math.max(0,start),Math.max(0,end-start));return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();}
function readingLiveCaret(editor){const selection=window.getSelection();if(!selection||!selection.rangeCount||!selection.isCollapsed)return null;const range=selection.getRangeAt(0);if(!editor.contains(range.startContainer))return null;let block=range.startContainer;while(block.parentNode&&block.parentNode!==editor)block=block.parentNode;let index=[...editor.childNodes].indexOf(block);if(index<0)index=Math.max(0,editor.childNodes.length-1);const before=document.createRange();try{before.selectNodeContents(block);before.setEnd(range.startContainer,range.startOffset);return{index,offset:before.toString().length};}catch(_){return{index,offset:0};}}
function restoreReadingLiveCaret(editor,bookmark){if(!bookmark||!editor.childNodes.length)return;const block=editor.childNodes[Math.min(bookmark.index,editor.childNodes.length-1)],walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let left=bookmark.offset,node=walker.nextNode();while(node&&left>node.textContent.length){left-=node.textContent.length;node=walker.nextNode();}const range=document.createRange(),selection=window.getSelection();if(node)range.setStart(node,Math.min(left,node.textContent.length));else{range.selectNodeContents(block);range.collapse(false);}range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
function readingLiveCanRender(content){const text=String(content||'');if(/[ \t\n]$/.test(text))return false;for(const token of ['```','**','~~'])if(((text.split(token).length-1)%2)!==0)return false;const ticks=(text.replace(/```/g,'').match(/`/g)||[]).length;return ticks%2===0;}
function renderReadingLive(editor,content,keepCaret){const bookmark=keepCaret?readingLiveCaret(editor):null,tools=editor.parentElement&&editor.parentElement.querySelector('.reading-block-tools');if(tools)tools.classList.remove('on');editor.innerHTML=renderMd(content||'');decorateMarkdownLinks(editor);if(bookmark)restoreReadingLiveCaret(editor,bookmark);}
const MARKDOWN_LIVE_HISTORIES=new Map(),MARKDOWN_LIVE_HISTORY_LIMIT=120;
function markdownLiveHistory(key,content){const value=String(content||'');let state=MARKDOWN_LIVE_HISTORIES.get(key);if(!state||state.entries[state.index].content!==value){state={entries:[{content:value,caret:null}],index:0,lastAt:0,lastKind:''};MARKDOWN_LIVE_HISTORIES.set(key,state);}return state;}
function recordMarkdownLiveHistory(key,content,caret,kind){const value=String(content||''),state=MARKDOWN_LIVE_HISTORIES.get(key)||markdownLiveHistory(key,value),current=state.entries[state.index];if(current&&current.content===value){if(caret)current.caret=caret;return state;}const now=Date.now(),merge=kind==='typing'&&state.lastKind==='typing'&&now-state.lastAt<700&&state.index>0&&state.index===state.entries.length-1;state.entries.splice(state.index+1);const entry={content:value,caret:caret||null};if(merge)state.entries[state.index]=entry;else{state.entries.push(entry);state.index++;if(state.entries.length>MARKDOWN_LIVE_HISTORY_LIMIT){state.entries.shift();state.index--;}}state.lastAt=now;state.lastKind=kind||'command';return state;}
function stepMarkdownLiveHistory(key,delta){const state=MARKDOWN_LIVE_HISTORIES.get(key);if(!state)return null;const next=state.index+delta;if(next<0||next>=state.entries.length)return null;state.index=next;state.lastAt=0;state.lastKind='';return state.entries[state.index];}
function markdownHistoryShortcut(event){if(!(event.metaKey||event.ctrlKey)||event.altKey)return 0;const key=String(event.key||'').toLowerCase();if(key==='z')return event.shiftKey?1:-1;if(key==='y'&&!event.shiftKey)return 1;return 0;}
function restoreReadingHistoryCaret(editor,caret){editor.focus({preventScroll:true});if(caret&&Number.isFinite(caret.index)){restoreReadingLiveCaret(editor,caret);return;}const block=editor.lastElementChild;if(block){const range=document.createRange(),selection=window.getSelection();range.selectNodeContents(block);range.collapse(false);selection.removeAllRanges();selection.addRange(range);}}
function readingLiveEnter(editor,event){if(event.shiftKey)return false;const selection=window.getSelection();if(!selection||!selection.rangeCount)return false;let node=selection.anchorNode&&selection.anchorNode.nodeType===3?selection.anchorNode.parentElement:selection.anchorNode;if(!node||!editor.contains(node))return false;const pre=node.closest&&node.closest('pre');if(pre&&editor.contains(pre))return false;const li=node.closest&&node.closest('li');if(li&&editor.contains(li)){const list=li.parentElement;if(!String(li.textContent||'').trim()){const paragraph=document.createElement('p');paragraph.appendChild(document.createElement('br'));list.after(paragraph);li.remove();if(!list.children.length)list.remove();focusReadingBlock(paragraph);}else{const next=document.createElement('li');if(li.classList.contains('md-task')){next.className='md-task';const check=document.createElement('input');check.type='checkbox';check.disabled=true;const text=document.createElement('span');text.appendChild(document.createElement('br'));next.append(check,text);li.after(next);focusReadingBlock(text);}else{next.appendChild(document.createElement('br'));li.after(next);focusReadingBlock(next);}}return true;}let block=node;while(block.parentNode&&block.parentNode!==editor)block=block.parentNode;const paragraph=document.createElement('p');paragraph.appendChild(document.createElement('br'));if(block===editor)editor.appendChild(paragraph);else block.after(paragraph);focusReadingBlock(paragraph);return true;}
function readingLiveBlock(target,editor){if(!target)return null;let node=target.nodeType===3?target.parentElement:target;if(!node||!editor.contains(node))return null;const item=node.closest&&node.closest('li');if(item&&editor.contains(item)){const list=item.parentElement;if(list&&/^(UL|OL)$/.test(list.tagName)&&list.parentElement===editor)return item;}let block=node;while(block&&block.parentElement!==editor)block=block.parentElement;if(!block||block.parentElement!==editor||block.classList.contains('reading-md-properties'))return null;return /^(H[1-6]|P|BLOCKQUOTE|PRE|UL|OL|TABLE|HR)$/.test(block.tagName)?block:null;}
function readingOrderedBlocks(editor){const blocks=[];for(const node of editor.children){if(node.classList.contains('reading-md-properties'))continue;if(/^(UL|OL)$/.test(node.tagName)){const items=[...node.children].filter((item)=>item.tagName==='LI');if(items.length)blocks.push(...items);else blocks.push(node);}else blocks.push(node);}return blocks;}
function readingBlockKind(block){if(!block)return'block';if(block.tagName==='LI'){if(block.classList.contains('md-task'))return'task';return block.parentElement&&block.parentElement.tagName==='OL'?'number':'bullet';}return({H1:'h1',H2:'h2',H3:'h3',H4:'h4',H5:'h5',H6:'h6',P:'text',BLOCKQUOTE:'quote',PRE:'code',UL:'list',OL:'list',TABLE:'table',HR:'divider'})[block.tagName]||'block';}
function readingMergeAdjacentLists(editor){for(const list of [...editor.children]){if(!/^(UL|OL)$/.test(list.tagName))continue;if(!list.children.length){list.remove();continue;}let next=list.nextElementSibling;while(next&&next.tagName===list.tagName){const following=next.nextElementSibling;while(next.firstElementChild)list.appendChild(next.firstElementChild);next.remove();next=following;}}}
function moveReadingLiveBlock(editor,source,target,after){if(!source||!target||source===target||!source.isConnected||!target.isConnected)return false;const sourceList=source.tagName==='LI'?source.parentElement:null,targetList=target.tagName==='LI'?target.parentElement:null;if(source.tagName==='LI'){
  if(target.tagName==='LI'){after?target.after(source):target.before(source);}
  else{const wrapper=sourceList.cloneNode(false);wrapper.appendChild(source);after?target.after(wrapper):target.before(wrapper);}
  if(sourceList&&!sourceList.children.length)sourceList.remove();
}else if(target.tagName==='LI'){
  const items=[...targetList.children],cut=Math.max(0,items.indexOf(target)+(after?1:0)),before=targetList.cloneNode(false),afterList=targetList.cloneNode(false);for(const item of items.slice(0,cut))before.appendChild(item);for(const item of items.slice(cut))afterList.appendChild(item);if(before.children.length)targetList.before(before);targetList.before(source);if(afterList.children.length)targetList.before(afterList);targetList.remove();
}else after?target.after(source):target.before(source);
  readingMergeAdjacentLists(editor);editor.dispatchEvent(new Event('input',{bubbles:true}));return true;}
function moveReadingLiveBlockBy(editor,block,delta){const blocks=readingOrderedBlocks(editor),index=blocks.indexOf(block),target=blocks[index+delta];if(index<0||!target)return false;const moved=moveReadingLiveBlock(editor,block,target,delta>0);if(moved)focusReadingBlock(block.tagName==='LI'&&block.querySelector('span')||block);return moved;}
function readingBlockText(block){const clone=block.cloneNode(true);clone.querySelectorAll&&clone.querySelectorAll('.callout-remove,input[type="checkbox"]').forEach((node)=>node.remove());const title=clone.querySelector&&clone.querySelector('.callout-title');if(title)title.remove();return String(clone.textContent||'').replace(/\s+/g,' ').trim();}
function createReadingLiveBlock(command,text){text=String(text||'');let node,focus;if(command.id==='bullet'||command.id==='number'||command.id==='task'){node=document.createElement(command.id==='number'?'ol':'ul');const li=document.createElement('li');if(command.id==='task'){li.className='md-task';const check=document.createElement('input');check.type='checkbox';check.disabled=true;const span=document.createElement('span');span.textContent=text;li.append(check,span);focus=span;}else{li.textContent=text;focus=li;}node.appendChild(li);return{node,focus};}if(command.id==='quote'){node=document.createElement('blockquote');node.textContent=text;return{node,focus:node};}if(command.id==='callout'){node=document.createElement('blockquote');node.className='md-callout note';node.dataset.callout='note';const remove=document.createElement('button');remove.type='button';remove.className='callout-remove';remove.contentEditable='false';remove.title='移除这个提示块';remove.textContent='×';const title=document.createElement('strong');title.className='callout-title';title.textContent='❝ 笔记';const body=document.createElement('div');body.className='callout-body';body.textContent=text;node.append(remove,title,body);return{node,focus:body};}if(command.id==='code'){node=document.createElement('pre');node.className='md-code-block';const code=document.createElement('code');code.textContent=text;node.appendChild(code);return{node,focus:code};}if(command.id==='divider'){node=document.createElement('hr');return{node,focus:null,appendParagraph:true};}node=document.createElement(command.id==='paragraph'?'p':command.id);node.textContent=text;return{node,focus:node};}
function replaceReadingLiveBlock(block,replacement){if(block.tagName!=='LI'){block.replaceWith(replacement);return;}const list=block.parentElement,items=[...list.children],index=items.indexOf(block),before=list.cloneNode(false),after=list.cloneNode(false);for(const item of items.slice(0,index))before.appendChild(item);for(const item of items.slice(index+1))after.appendChild(item);if(before.children.length)list.before(before);list.before(replacement);if(after.children.length)list.before(after);list.remove();}
function transformReadingLiveBlock(block,command){if(!block||!command)return null;const text=readingBlockText(block),made=createReadingLiveBlock(command,text);replaceReadingLiveBlock(block,made.node);if(made.appendParagraph){const paragraph=document.createElement('p');paragraph.appendChild(document.createElement('br'));made.node.after(paragraph);return paragraph;}return made.focus;}
function insertReadingLiveBlockAfter(editor,block){const paragraph=document.createElement('p');paragraph.appendChild(document.createElement('br'));if(!block){editor.appendChild(paragraph);focusReadingBlock(paragraph);return paragraph;}const list=block.tagName==='LI'?block.parentElement:/^(UL|OL)$/.test(block.tagName)?block:null;if(list){const next=document.createElement('li'),task=block.tagName==='LI'?block.classList.contains('md-task'):!!list.querySelector('li.md-task');if(task){next.className='md-task';const check=document.createElement('input');check.type='checkbox';check.disabled=true;const text=document.createElement('span');text.appendChild(document.createElement('br'));next.append(check,text);block.tagName==='LI'?block.after(next):list.appendChild(next);focusReadingBlock(text);}else{next.appendChild(document.createElement('br'));block.tagName==='LI'?block.after(next):list.appendChild(next);focusReadingBlock(next);}return next;}block.after(paragraph);focusReadingBlock(paragraph);return paragraph;}
function readingBlockFirstLineRect(block){if(!block)return null;const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const text=String(node.textContent||''),start=text.search(/\S/);if(start<0)continue;const parent=node.parentElement;if(parent&&parent.closest('.callout-remove'))continue;try{const range=document.createRange();range.setStart(node,start);range.setEnd(node,Math.min(text.length,start+1));const rect=range.getClientRects()[0]||range.getBoundingClientRect();if(rect&&(rect.width||rect.height))return rect;}catch(_){}}return block.getBoundingClientRect();}
function setupReadingLiveBlocks(editor,workbench,slot){let current=null,dragBlock=null,dropTarget=null,dropAfter=false,hideTimer=0,overTools=false,pointerId=null,startX=0,startY=0,lastX=0,lastY=0,dragging=false,suppressClick=false,ghost=null,scrollFrame=0;const tools=document.createElement('div');tools.className='reading-block-tools';tools.contentEditable='false';const add=document.createElement('button');add.type='button';add.className='reading-block-tool';add.innerHTML=csGlyphIcon('＋');add.title='在下方添加区块';add.setAttribute('aria-label',add.title);const handle=document.createElement('button');handle.type='button';handle.className='reading-block-tool handle';handle.textContent='⠿';handle.title='拖动区块；点击转换；Alt+↑/↓ 移动';handle.setAttribute('aria-label',handle.title);const marker=document.createElement('div');marker.className='reading-block-drop-marker';tools.append(add,handle);workbench.append(tools,marker);
  const clearDrop=()=>{dropTarget=null;marker.classList.remove('on');};const hide=()=>{clearTimeout(hideTimer);tools.classList.remove('on');};const scheduleHide=()=>{clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!overTools&&!tools.matches(':hover')&&!dragging)hide();},320);};const show=(block)=>{clearTimeout(hideTimer);if(!block)return scheduleHide();current=block;const rect=block.getBoundingClientRect(),host=workbench.getBoundingClientRect(),lineRect=readingBlockFirstLineRect(block)||rect;if(rect.bottom<host.top||rect.top>host.bottom)return hide();tools.classList.add('on');const toolWidth=tools.offsetWidth||50,toolHeight=tools.offsetHeight||26,gap=block.tagName==='LI'?30:14;tools.style.left=Math.max(6,rect.left-host.left-toolWidth-gap)+'px';tools.style.top=Math.max(3,lineRect.top-host.top+(lineRect.height-toolHeight)/2)+'px';};
  const targetAt=(x,y)=>{let target=readingLiveBlock(document.elementFromPoint(x,y),editor);if(target===dragBlock)target=null;if(!target){const rect=editor.getBoundingClientRect();if(x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom){const blocks=readingOrderedBlocks(editor).filter((block)=>block!==dragBlock);if(blocks.length){target=y<blocks[0].getBoundingClientRect().top?blocks[0]:blocks[blocks.length-1];}}}return target;};
  const placeMarker=(target,after)=>{if(!target)return clearDrop();dropTarget=target;dropAfter=after;const rect=target.getBoundingClientRect(),host=workbench.getBoundingClientRect(),editorRect=editor.getBoundingClientRect();marker.style.left=Math.max(14,editorRect.left-host.left+10)+'px';marker.style.width=Math.max(30,editorRect.right-editorRect.left-20)+'px';marker.style.top=Math.max(2,(after?rect.bottom:rect.top)-host.top-1)+'px';marker.classList.add('on');};
  const updateDrag=(x,y)=>{lastX=x;lastY=y;if(ghost){ghost.style.left=x+'px';ghost.style.top=y+'px';}const target=targetAt(x,y);if(target){const rect=target.getBoundingClientRect();placeMarker(target,y>rect.top+rect.height/2);}else clearDrop();};
  const autoScroll=()=>{if(!dragging)return;const rect=editor.getBoundingClientRect(),edge=Math.min(64,rect.height*.18);let delta=0;if(lastY<rect.top+edge)delta=-Math.ceil((rect.top+edge-lastY)/5);else if(lastY>rect.bottom-edge)delta=Math.ceil((lastY-(rect.bottom-edge))/5);if(delta){editor.scrollTop+=Math.max(-18,Math.min(18,delta));updateDrag(lastX,lastY);}scrollFrame=requestAnimationFrame(autoScroll);};
  const beginDrag=()=>{if(dragging||!dragBlock)return;dragging=true;suppressClick=true;hideReadingSlashMenu();editor.classList.add('block-dragging');dragBlock.classList.add('reading-block-drag-source');ghost=document.createElement('div');ghost.className='reading-block-drag-ghost';const kind=document.createElement('span');kind.className='kind';kind.textContent=readingBlockKind(dragBlock);ghost.append(kind,document.createTextNode(readingBlockText(dragBlock)||'空区块'));document.body.appendChild(ghost);updateDrag(lastX,lastY);scrollFrame=requestAnimationFrame(autoScroll);};
  const finishDrag=(commit)=>{if(!dragBlock)return;cancelAnimationFrame(scrollFrame);if(commit&&dragging&&dropTarget)moveReadingLiveBlock(editor,dragBlock,dropTarget,dropAfter);dragBlock.classList.remove('reading-block-drag-source');if(ghost)ghost.remove();ghost=null;dragBlock=null;dragging=false;pointerId=null;clearDrop();editor.classList.remove('block-dragging');hide();setTimeout(()=>{suppressClick=false;},0);};
  editor.addEventListener('mousemove',(e)=>{if(!dragBlock){const block=readingLiveBlock(e.target,editor);if(block!==current||!tools.classList.contains('on'))show(block);}});editor.addEventListener('mouseleave',scheduleHide);editor.addEventListener('scroll',()=>{if(!dragging)hide();if(READING_SLASH_STATE&&READING_SLASH_STATE.editor===editor)hideReadingSlashMenu();});tools.addEventListener('mouseenter',()=>{overTools=true;clearTimeout(hideTimer);tools.classList.add('on');});tools.addEventListener('mouseleave',()=>{overTools=false;scheduleHide();});add.addEventListener('mousedown',(e)=>e.preventDefault());
  add.onclick=(e)=>{e.preventDefault();e.stopPropagation();if(!current||!current.isConnected)return;insertReadingLiveBlockAfter(editor,current);editor.dispatchEvent(new Event('input',{bubbles:true}));hide();};handle.onclick=(e)=>{e.preventDefault();e.stopPropagation();if(suppressClick||!current||!current.isConnected)return;const rect=handle.getBoundingClientRect();READING_SLASH_STATE={editor,block:current,transform:true,query:'',index:0,items:[],slot,rect};renderReadingSlashMenu();};
  handle.addEventListener('keydown',(e)=>{if(!current||!(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')))return;e.preventDefault();e.stopPropagation();moveReadingLiveBlockBy(editor,current,e.key==='ArrowUp'?-1:1);});
  handle.addEventListener('pointerdown',(e)=>{if(e.button!==0||!current||!current.isConnected)return;pointerId=e.pointerId;dragBlock=current;startX=lastX=e.clientX;startY=lastY=e.clientY;handle.setPointerCapture&&handle.setPointerCapture(pointerId);});
  handle.addEventListener('pointermove',(e)=>{if(pointerId!==e.pointerId||!dragBlock)return;lastX=e.clientX;lastY=e.clientY;if(!dragging&&Math.hypot(lastX-startX,lastY-startY)>=5)beginDrag();if(dragging){e.preventDefault();updateDrag(lastX,lastY);}});
  handle.addEventListener('pointerup',(e)=>{if(pointerId!==e.pointerId)return;finishDrag(true);});handle.addEventListener('pointercancel',()=>finishDrag(false));window.addEventListener('blur',()=>finishDrag(false));
  return{tools,marker,hide};}
function readingProjectFor(path){const fragment=readingFragment(path);return fragment&&fragment.project||'';}
function readingSize(bytes) { if(bytes<1024*1024)return Math.max(1,Math.round(bytes/1024))+' KB';return (bytes/1024/1024).toFixed(1)+' MB'; }
function saveReadingDirs() { try { localStorage.setItem('mc-reading-dirs',JSON.stringify([...READING_DIR_OPEN])); } catch (_) {} }
function readingNodePayload(event){try{return JSON.parse(event.dataTransfer.getData('application/x-codescope-reading-node')||'null');}catch(_){return null;}}
/* ★ 拖拽结束**兜底**清掉所有拖放高亮（含阅读区最外面那圈 root-drop）——
   行的 drop 里 stopPropagation → 根容器的 ondrop 不会触发 → root-drop 会一直留着（用户：「最外面一圈高亮去不掉了」）；
   从子行直接拖出面板时 dragleave 的 target 是子行 → 也不会清。dragend 一定触发，用它兜底 ✓。 */
document.addEventListener('dragend',()=>document.querySelectorAll('.root-drop,.drop-before,.drop-after,.drop-target').forEach((el)=>el.classList.remove('root-drop','drop-before','drop-after','drop-target')));
/* ★ 阅读区行的放置接线：上 25%=插到前面 / 下 25%=插到后面 / 文件夹中间=放进文件夹。必须 stopPropagation，否则冒泡到根容器 ✓。 */
function wireReadingRowDrop(row,node,next){
  row.addEventListener('dragover',(e)=>{
    if(!e.dataTransfer||!e.dataTransfer.types.includes('application/x-codescope-reading-node'))return;
    e.preventDefault();e.stopPropagation();
    const rlist=document.getElementById('reading-list');if(rlist)rlist.classList.remove('root-drop');   /* ★ 行上要显示插入线了 → 把最外圈那圈灭掉 ✓ */
    const rect=row.getBoundingClientRect(),ratio=(e.clientY-rect.top)/Math.max(1,rect.height);
    const isFolder=row.classList.contains('reading-library-folder');
    const zone=ratio<0.25?'before':ratio>0.75?'after':(isFolder?'inside':'after');
    row.classList.remove('drop-before','drop-after','drop-target');
    row.classList.add(zone==='before'?'drop-before':zone==='after'?'drop-after':'drop-target');
  });
  row.addEventListener('dragleave',()=>row.classList.remove('drop-before','drop-after','drop-target'));
  row.addEventListener('drop',(e)=>{
    e.preventDefault();e.stopPropagation();
    const zone=row.classList.contains('drop-before')?'before':row.classList.contains('drop-after')?'after':'inside';
    row.classList.remove('drop-before','drop-after','drop-target');
    const payload=readingNodePayload(e);if(!payload||!payload.path)return;
    const parentPath=node.path.includes('/')?node.path.slice(0,node.path.lastIndexOf('/')):'';
    if(zone==='inside')return moveReadingNode(payload,node.path);
    const before=zone==='before'?node.name:(next?next.name:'');
    moveReadingNode(payload,parentPath,before);
  });
}
async function moveReadingNode(payload,toFolder,before){if(!payload||!payload.path)return;const result=await api('/api/readings/node/move',{type:payload.type,path:payload.path,toFolder:toFolder||'',before:before||'',autoRename:true});if(!result.ok){setStatus('err', result.error);if(/同名/.test(String(result.error||'')))await askConfirm({title:'无法移动',message:'目标位置里已经有一个同名的项目或文件夹了，所以移不过去。\n\n请先给其中一个改个名字（右键 → 重命名），再拖一次。',danger:false,okLabel:'知道了'});return;}if(result.unchanged)return;const prefix=payload.path+'/';READING_SLOTS=READING_SLOTS.map((value)=>value===payload.path?result.path:value.startsWith(prefix)?result.path+'/'+value.slice(prefix.length):value);if(READING_PROJECT_CURRENT===payload.path)READING_PROJECT_CURRENT=result.path;else if(READING_PROJECT_CURRENT.startsWith(prefix))READING_PROJECT_CURRENT=result.path+'/'+READING_PROJECT_CURRENT.slice(prefix.length);if(toFolder)READING_DIR_OPEN.add(toFolder);saveReadingDirs();await loadReadings();await Promise.all([renderReadingSlot(0),renderReadingSlot(1)]);}
async function loadReadings(silent) {
  const result=await api('/api/readings/tree');
  if(!result.ok){if(!silent)setStatus('err',result.error||'读取文库失败');return;}
  READING_TREE=result.root;READING_FRAGMENT_INDEX=new Map();READING_PROJECT_INDEX=new Map();let projects=0;const index=(nodes)=>{for(const node of nodes||[]){if(node.type==='project'){projects++;READING_PROJECT_INDEX.set(node.path,node);for(const item of node.children||[])READING_FRAGMENT_INDEX.set(item.path,item);}else if(node.type==='fragment'){READING_FRAGMENT_INDEX.set(node.path,node);}else{if(node.knowledgeRoot){projects++;READING_DIR_OPEN.add(node.path);}index(node.children);}}};index(result.root.children);
  $('reading-count').textContent=projects?String(projects):'';$('reading-count').title=projects?projects+' 个阅读项目':'';renderReadingList();renderReadingProjectTabs();
}
function renderReadingList() {
  const host=$('reading-list');host.replaceChildren();
  host.ondragover=(e)=>{if(e.dataTransfer.types.includes('application/x-codescope-reading-node')){e.preventDefault();host.classList.add('root-drop');}};host.ondragleave=(e)=>{if(e.target===host)host.classList.remove('root-drop');};host.ondrop=(e)=>{e.preventDefault();host.classList.remove('root-drop');moveReadingNode(readingNodePayload(e),'');};
  if(!READING_TREE||!READING_TREE.children.length){const empty=document.createElement('div');empty.className='draw-empty';empty.textContent='还没有阅读项目：点击 ＋ 创建项目';host.appendChild(empty);return;}
  const action=(text,title,handler,danger=false)=>{const button=document.createElement('button');button.dataset.glyph=text;button.textContent=text;button.title=title;button.setAttribute('aria-label',title);if(danger)button.className='danger';button.onclick=(event)=>{event.stopPropagation();handler();};return button;};
  const drawNodes=(nodes,parent)=>{const __list=nodes||[];for(let __i=0;__i<__list.length;__i++){const node=__list[__i],__next=__list[__i+1]||null;
    if(node.type==='folder'){
      const open=READING_DIR_OPEN.has(node.path),knowledge=!!node.knowledge,row=document.createElement('div');row.className='reading-folder reading-library-folder'+(knowledge?' knowledge-folder':'');row.dataset.path=node.path;row.draggable=!node.knowledgeRoot;const arrow=document.createElement('span');arrow.innerHTML=open? csGlyphIcon('▾') : csGlyphIcon('▸');const icon=document.createElement('span');icon.className='side-glyph';icon.innerHTML=sideGlyphMarkup(open?'folderOpen':'folder');const name=document.createElement('span');name.className='name';name.textContent=node.name;const count=document.createElement('span');count.className='meta';count.textContent=String(node.count||0);count.title=(node.count||0)+(knowledge?' 篇文档':' 个项目');count.setAttribute('aria-label',count.title);const actions=document.createElement('span');actions.className='reading-row-actions';
      if(knowledge){if(node.knowledgeRoot)actions.append(action('▣+','新建知识分类',()=>createKnowledgeCategoryInFolder(node.path)));else actions.append(action('P+','新建知识项目',()=>createKnowledgeProjectInFolder(node.path)),action('▣+','新建子分类',()=>createKnowledgeCategoryInFolder(node.path)),action('✎','重命名',()=>renameReadingFolder(node)),action('×','删除',()=>deleteReadingFolder(node),true));}
      else actions.append(action('＋','新建阅读项目',()=>createReadingProject(node.path)),action('▣+','新建文件夹',()=>createReadingFolder(node.path)),action('✎','重命名',()=>renameReadingFolder(node)),action('×','删除',()=>deleteReadingFolder(node),true));
      row.append(arrow,icon,name,count,actions);row.onclick=()=>{open?READING_DIR_OPEN.delete(node.path):READING_DIR_OPEN.add(node.path);saveReadingDirs();renderReadingList();};
      if(!node.knowledgeRoot){row.addEventListener('dragstart',(e)=>{if(e.target.closest('button'))return e.preventDefault();e.dataTransfer.setData('application/x-codescope-reading-node',JSON.stringify({type:'folder',path:node.path}));e.dataTransfer.effectAllowed='move';row.classList.add('dragging');});row.addEventListener('dragend',()=>row.classList.remove('dragging'));wireReadingRowDrop(row,node,__next);   /* ★ 统一接线。知识库**根**不能移（VitePress 配置指向它），里面的分类可以 ✓ */}
      parent.appendChild(row);if(open){const children=document.createElement('div');children.className='reading-library-children';parent.appendChild(children);drawNodes(node.children,children);}continue;
    }
    if(node.type==='fragment'&&node.knowledge){const row=document.createElement('div');row.className='reading-folder reading-knowledge-page'+(node.path===READING_CURRENT?' on':'');row.dataset.path=node.path;const icon=document.createElement('span');icon.className='side-glyph';icon.textContent='M↓';const name=document.createElement('span');name.className='name';name.textContent=node.path==='知识库/index.md'?'知识库首页':readingBase(node.name);const meta=document.createElement('span');meta.className='meta';meta.textContent=readingSize(node.size);const actions=document.createElement('span');actions.className='reading-row-actions';if(node.path!=='知识库/index.md')actions.append(action('✎','重命名',()=>renameReadingFragment(node)),action('×','删除',()=>deleteReadingFragment(node),true));row.append(icon,name,meta,actions);row.onclick=()=>openReading(node.path,0);parent.appendChild(row);continue;}
    const project=node,row=document.createElement('div');row.className='reading-folder reading-project'+(project.path===READING_PROJECT_CURRENT?' on':'');row.dataset.path=project.path;row.draggable=true;const icon=document.createElement('span');icon.className='side-glyph';icon.innerHTML=sideGlyphMarkup('book');const copy=document.createElement('div');copy.className='reading-project-copy';const name=document.createElement('span');name.className='name';name.textContent=project.name;copy.appendChild(name);const desc=document.createElement('span');desc.className='reading-project-desc'+(project.description?'':' empty');desc.textContent=project.description||'暂无说明 · 点击 ⓘ 完善';copy.appendChild(desc);const tags=document.createElement('span');tags.className='reading-project-tags';if(project.tags&&project.tags.length){for(const value of project.tags.slice(0,3)){const tag=document.createElement('span');tag.className='reading-project-tag';tag.textContent=value;tags.appendChild(tag);}}else{const tag=document.createElement('span');tag.className='reading-project-tag empty';tag.innerHTML=csGlyphIcon('＋') + ' 标签';tag.onclick=(e)=>{e.stopPropagation();editReadingProjectMeta(project);};tags.appendChild(tag);}copy.appendChild(tags);const count=document.createElement('span');count.className='meta';count.textContent=String(project.count||0);count.title=(project.count||0)+(project.knowledge?' 篇 Markdown':' 个片段');count.setAttribute('aria-label',count.title);const actions=document.createElement('span');actions.className='reading-row-actions';actions.append(action(project.knowledge?'M+':'＋',project.knowledge?'新建 Markdown 片段':'添加项目片段',project.knowledge?()=>createKnowledgePageInProject(project.path):()=>addReadingProjectFragment(project)),action('ⓘ','项目说明与标签',()=>editReadingProjectMeta(project)),action('✎','重命名',()=>renameReadingProject(project)),action('×','删除项目',()=>deleteReadingProject(project),true));row.append(icon,copy,count,actions);row.onclick=()=>openReadingProject(project);if(!project.knowledge){row.addEventListener('dragstart',(e)=>{if(e.target.closest('button'))return e.preventDefault();e.dataTransfer.setData('application/x-codescope-reading-node',JSON.stringify({type:'project',path:project.path}));e.dataTransfer.effectAllowed='move';row.classList.add('dragging');});row.addEventListener('dragend',()=>row.classList.remove('dragging'));wireReadingRowDrop(row,node,__next);}parent.appendChild(row);
  }};drawNodes(READING_TREE.children,host);
}
async function createKnowledgePageInProject(projectPath){const name=await askText({ title:'新建 Markdown 片段', message:'Markdown 片段名称', value:'新文档.md', okLabel:'新建' });if(!name)return;const base=String(projectPath||'').replace(/^知识库\/?/,'');let rel=base+'/'+name.trim();if(!/\.md$/i.test(rel))rel+='.md';const result=await api('/api/knowledge/page',{path:rel,title:name.replace(/\.md$/i,'')});if(!result.ok)return setStatus('err', result.error);await loadReadings();READING_PROJECT_CURRENT=projectPath;openReading(result.readingPath,READING_ACTIVE_SLOT);}
async function createKnowledgeProjectInFolder(folderPath){const name=await askText({ title:'新建知识项目', message:'知识项目名称', value:'', okLabel:'新建' });if(!name)return;const description=await askText({ title:'项目说明', message:'项目说明（可留空）', value:'', okLabel:'确定' })??'';const base=String(folderPath||'').replace(/^知识库\/?/,'');const result=await api('/api/knowledge/project',{path:base+'/'+name.trim(),description});if(!result.ok)return setStatus('err', result.error);READING_DIR_OPEN.add(folderPath);saveReadingDirs();await loadReadings();const project=READING_PROJECT_INDEX.get('知识库/'+result.path);if(project)openReadingProject(project);}
async function createKnowledgeCategoryInFolder(folderPath){const name=await askText({ title:'新建知识分类', message:'知识分类名称', value:'', okLabel:'新建' });if(!name)return;const base=String(folderPath||'').replace(/^知识库\/?/,'');const rel=(base?base+'/':'')+name.trim();const result=await api('/api/knowledge/folder',{path:rel});if(!result.ok)return setStatus('err', result.error);READING_DIR_OPEN.add(folderPath);READING_DIR_OPEN.add('知识库/'+result.path);saveReadingDirs();await loadReadings();}
async function createReadingProject(parent){const name=await askText({ title:'新建阅读项目', message:'阅读项目名称', value:'', okLabel:'新建' });if(!name)return;const description=await askText({ title:'项目说明', message:'项目说明（可留空）', value:'', okLabel:'确定' })??'';const tags=await askText({ title:'标签', message:'标签（使用逗号分隔）', value:'', okLabel:'确定' })??'';const result=await api('/api/readings/project/new',{parent:parent||'',name,description,tags});if(!result.ok)return setStatus('err', result.error);if(parent)READING_DIR_OPEN.add(parent);READING_PROJECT_CURRENT=result.path;saveReadingDirs();await loadReadings();const project=READING_PROJECT_INDEX.get(result.path);if(project)openReadingProject(project);}
async function createReadingFolder(parent){const name=await askText({ title:'新建阅读文件夹', message:'阅读文件夹名称', value:'', okLabel:'新建' });if(!name)return;const result=await api('/api/readings/folder',{parent:parent||'',name});if(!result.ok)return setStatus('err', result.error);READING_DIR_OPEN.add(result.path);if(parent)READING_DIR_OPEN.add(parent);saveReadingDirs();await loadReadings();}
async function editReadingProjectMeta(project){const description=await askText({ title:'项目说明', message:'项目说明', value:project.description||'', okLabel:'确定' });if(description===null)return;const tags=await askText({ title:'标签', message:'标签（使用逗号分隔）', value:(project.tags||[]).join('，'), okLabel:'确定' });if(tags===null)return;const result=await api('/api/readings/project/meta',{project:project.path,description,tags});if(!result.ok)return setStatus('err', result.error);await loadReadings();}
async function renameReadingProject(project){const next=await askText({ title:'重命名阅读项目', message:'阅读项目名称', value:project.name, okLabel:'重命名' });if(!next||next===project.name)return;const r=await api('/api/readings/project/rename',{project:project.path,name:next});if(!r.ok)return setStatus('err', r.error);const prefix=project.path+'/';READING_SLOTS=READING_SLOTS.map((value)=>value.startsWith(prefix)?r.project+'/'+value.slice(prefix.length):value);READING_PROJECT_CURRENT=r.project;await loadReadings();await Promise.all([renderReadingSlot(0),renderReadingSlot(1)]);}
async function deleteReadingProject(project){if(!await askConfirm({ title:'删除阅读项目', message:'删除阅读项目「'+project.name+'」及其中 '+project.count+' 个片段？', okLabel:'删除' }))return;const r=await api('/api/readings/project/delete',{project:project.path});if(!r.ok)return setStatus('err', r.error);if(READING_PROJECT_CURRENT===project.path)closeReading();await loadReadings();}
async function renameReadingFolder(folder){const next=await askText({ title:'重命名阅读文件夹', message:'阅读文件夹名称', value:folder.name, okLabel:'重命名' });if(!next||next===folder.name)return;const r=await api('/api/readings/folder/rename',{folder:folder.path,name:next});if(!r.ok){setStatus('err', r.error);if(/同名|已存在/.test(String(r.error||'')))await askConfirm({title:'无法重命名',message:'这个位置已经有一个叫「'+next+'」的文件夹或项目了，所以改不过去。\n\n换一个名字，或者先把同名的那个改名/删掉。',danger:false,okLabel:'知道了'});return;}const prefix=folder.path+'/';READING_SLOTS=READING_SLOTS.map((value)=>value.startsWith(prefix)?r.path+'/'+value.slice(prefix.length):value);if(READING_PROJECT_CURRENT.startsWith(prefix))READING_PROJECT_CURRENT=r.path+'/'+READING_PROJECT_CURRENT.slice(prefix.length);READING_DIR_OPEN.delete(folder.path);READING_DIR_OPEN.add(r.path);saveReadingDirs();await loadReadings();}
async function deleteReadingFolder(folder){if(!await askConfirm({ title:'删除阅读文件夹', message:'删除文件夹「'+folder.name+'」及其中 '+(folder.count||0)+' 个阅读项目？', okLabel:'删除' }))return;const r=await api('/api/readings/folder/delete',{folder:folder.path});if(!r.ok)return setStatus('err', r.error);if(READING_PROJECT_CURRENT===folder.path||READING_PROJECT_CURRENT.startsWith(folder.path+'/'))closeReading();await loadReadings();}
function sortedReadingFragments(project){const order={original:0,translation:1,bilingual:2,markdown:3,code:4};return [...(project&&project.children||[])].sort((a,b)=>(order[a.role]??9)-(order[b.role]??9)||a.name.localeCompare(b.name));}
async function renameReadingFragment(item){const next=await askText({ title:'重命名片段', message:'片段文件名', value:item.name, okLabel:'重命名' });if(!next)return;const r=await api('/api/readings/rename',{path:item.path,name:next});if(!r.ok)return setStatus('err', r.error);READING_DOCS.delete(item.path);READING_TEXT_DOCS.delete(item.path);READING_SLOTS=READING_SLOTS.map(v=>v===item.path?r.path:v);if(READING_CURRENT===item.path)READING_CURRENT=r.path;await loadReadings();await Promise.all([renderReadingSlot(0),renderReadingSlot(1)]);}
async function deleteReadingFragment(item){if(!await askConfirm({ title:'删除片段', message:'删除片段「'+item.name+'」？', okLabel:'删除' }))return;const r=await api('/api/readings/delete',{path:item.path});if(!r.ok)return setStatus('err', r.error);READING_DOCS.delete(item.path);READING_TEXT_DOCS.delete(item.path);READING_SLOTS=READING_SLOTS.map(v=>v===item.path?'':v);if(!READING_SLOTS[0]&&READING_SLOTS[1])READING_SLOTS=[READING_SLOTS[1],''];READING_ACTIVE_SLOT=READING_SLOTS[READING_ACTIVE_SLOT]?READING_ACTIVE_SLOT:0;if(READING_CURRENT===item.path)READING_CURRENT=READING_SLOTS[READING_ACTIVE_SLOT]||'';updateReadingColumnLayout();await loadReadings();await Promise.all([renderReadingSlot(0),renderReadingSlot(1)]);renderReadingFragments();}
function renderReadingProjectTabs(){
  const host=$('reading-project-tabs');if(!host)return;host.replaceChildren();const project=READING_PROJECT_INDEX.get(READING_PROJECT_CURRENT);
  if(!project){const hint=document.createElement('span');hint.className='draw-empty';hint.textContent='打开左侧阅读项目后，在这里管理和组合片段';host.appendChild(hint);return;}
  for(const item of sortedReadingFragments(project)){const tab=document.createElement('div');tab.className='reading-project-tab'+(item.path===READING_CURRENT?' on':'');tab.draggable=true;tab.title='点击在当前栏打开\n右键：打开 / 在另一栏打开 / 重命名 / 删除\n拖到阅读区右侧新建一栏';
    const kind=document.createElement('span');kind.className='tab-kind';kind.textContent=readingKindIcon(item);const name=document.createElement('span');name.className='tab-name';name.textContent=readingBase(item.name);const role=document.createElement('span');role.className='tab-role';role.textContent=readingRoleLabel(item);
    // 行内 ✎/× 收进右键菜单（与代码工作区的片段标签同一套操作习惯）
    tab.append(kind,name,role);
    tab.addEventListener('contextmenu',(event)=>showContextMenu(event,[
      {icon:'▸',label:'打开此片段',run:()=>openReading(item.path,READING_ACTIVE_SLOT)},
      {icon:'⇉',label:'在另一栏打开',hint:'分屏对照阅读',run:()=>openReading(item.path,READING_ACTIVE_SLOT?0:1)},
      {type:'separator'},
      {icon:'✎',label:'重命名片段',run:()=>renameReadingFragment(item)},
      {icon:'×',label:'删除片段',danger:true,run:()=>deleteReadingFragment(item)},
    ]));
    tab.onclick=()=>openReading(item.path,READING_ACTIVE_SLOT);tab.addEventListener('dragstart',(e)=>{tab.classList.add('dragging');$('reading-columns').classList.add('fragment-dragging');e.dataTransfer.setData('application/x-codescope-reading',item.path);e.dataTransfer.effectAllowed='copy';});tab.addEventListener('dragend',()=>{tab.classList.remove('dragging');$('reading-columns').classList.remove('fragment-dragging');});host.appendChild(tab);
  }
  const add=document.createElement('button');add.id='reading-project-add';add.innerHTML=csGlyphText(project.knowledge?'＋ Markdown':'＋ 片段');add.title=project.knowledge?'在当前知识项目中新建 Markdown 片段':'新建或导入 PDF、Markdown、代码片段';add.onclick=project.knowledge?()=>createKnowledgePageInProject(project.path):()=>addReadingProjectFragment(project);host.appendChild(add);
}
async function ensureReadingDoc(path) {
  let doc=READING_DOCS.get(path);if(doc)return doc;
  doc={path,pages:null,pageCount:0,meta:{path,page:1,view:'original',translations:{},fragments:[]},loading:true};READING_DOCS.set(path,doc);
  /* 只有 PDF 才需要抽取分页文本。Markdown / 代码 / HTML / 网页走这个函数只是为了拿标注元数据
     （摘录、笔记都存在同一份 .codescope 标注里），再去请求 PDF 文本只会白写一个 doc.error，
     把状态栏染红、还会让「本页未提取到可选择文字」之类的 PDF 文案漏到 Markdown 上。 */
  const fragment=readingFragment(path),pdf=!fragment||fragment.kind==='pdf';
  const [meta,text]=await Promise.all([api('/api/readings/meta?path='+encodeURIComponent(path)),pdf?api('/api/readings/text?path='+encodeURIComponent(path)):Promise.resolve({ok:true,pages:[],pageCount:0})]);
  if(meta.ok)doc.meta=meta.meta;
  if(text.ok){doc.pages=text.pages;doc.pageCount=text.pageCount;}else{doc.pages=[];doc.error=text.error||'无法提取文本';}
  doc.loading=false;return doc;
}
async function saveReadingDoc(doc) {
  if(!doc)return;
  // 原来直接丢弃返回值：保存失败时界面看上去已经保存，重开文档改动就没了。
  const result=await api('/api/readings/meta',{path:doc.path,meta:doc.meta});
  if(result&&result.ok===false)setStatus('err','阅读元数据保存失败：'+String(result.error||'未知错误'));
  return result;
}
function readingSlotElements(slot) { const col=document.querySelector('.reading-col[data-slot="'+slot+'"]');return {col,body:col.querySelector('.reading-col-body'),name:col.querySelector('.doc'),view:col.querySelector('.reading-view'),page:col.querySelector('.reading-page-input'),pages:col.querySelector('.reading-pages')}; }
function updateReadingColumnLayout(){$('reading-columns').classList.toggle('single',!READING_SLOTS[1]);}
async function closeReadingColumn(slot){
  if(slot===0&&READING_SLOTS[1])READING_SLOTS=[READING_SLOTS[1],''];else READING_SLOTS[slot]='';
  if(!READING_SLOTS[0]&&READING_SLOTS[1])READING_SLOTS=[READING_SLOTS[1],''];
  READING_ACTIVE_SLOT=0;READING_CURRENT=READING_SLOTS[0]||'';updateReadingColumnLayout();renderReadingProjectTabs();await Promise.all([renderReadingSlot(0),renderReadingSlot(1)]);syncReadingTools();renderReadingFragments();
}
let READING_FRAGMENTS_COLLAPSED=false; /* 用户是否手动收起了右侧摘录面板 */
function syncReadingFragmentsPanel(){
  const fragment=readingFragment(READING_SLOTS[READING_ACTIVE_SLOT]),html=!!(fragment&&fragment.kind==='html');
  /* HTML 网页没有“原文摘录”概念（摘录按钮本身也不可用），整块面板对它是纯占宽 */
  const toggle=$('reading-frag-toggle');if(toggle){toggle.hidden=html;toggle.classList.toggle('on',!READING_FRAGMENTS_COLLAPSED);}
  const collapsed=html||READING_FRAGMENTS_COLLAPSED;
  const panel=$('reading-fragments'),resizer=$('reading-fragments-resizer');
  if(panel)panel.classList.toggle('hidden',collapsed);
  if(resizer)resizer.classList.toggle('hidden',collapsed);
}
function syncReadingTools(){
  const fragment=readingFragment(READING_SLOTS[READING_ACTIVE_SLOT]),pdf=!fragment||fragment.kind==='pdf',web=fragment&&fragment.kind==='web',markdown=fragment&&fragment.kind==='markdown';
  const gate=(id,enabled)=>{const el=$(id);if(!el)return;el.disabled=!enabled;el.hidden=!enabled;};
  /* Markdown 正文同样能划选摘录：摘录写进它自己的 .codescope 标注文件，不改 .md 原文。 */
  gate('reading-add-fragment',pdf||web||markdown);
  gate('reading-translate-selection',pdf);
  gate('reading-translate-page',pdf);
  gate('reading-translate-all',pdf);
  syncReadingFragmentsPanel();
}
function readingPdfVersions(fragment){const project=fragment&&READING_PROJECT_INDEX.get(fragment.project),pdfs=(project&&project.children||[]).filter((item)=>item.kind==='pdf');return {original:pdfs.find((item)=>item.role==='original')||null,translation:pdfs.find((item)=>item.role==='translation')||null,bilingual:pdfs.find((item)=>item.role==='bilingual')||null};}
function syncReadingViewOptions(els,versions){const options=els.view.options;options[0].textContent=versions.original?'PDF 原版':'当前 PDF';options[1].textContent='可选文本';options[2].textContent=versions.translation?'中文 PDF':'AI 中文译文';options[3].textContent=versions.bilingual?'双语 PDF':'双语对照';}
/* 每栏每次渲染领一个令牌，只有最新那一次渲染才准往 DOM 里落东西。
   renderReadingSlot 是「开头清空、结尾追加」，中间隔着一到多个 await（正文拉取、Milkdown 初始化、PDF 解析）。
   于是点阅读项目与点片段标签几乎同时触发时，两次渲染会各自走到结尾 appendChild ——
   开头那次 replaceChildren 谁也清不掉谁，同一个栏里就挂出两份区块编辑器：
   DOM 重复、自动保存翻倍、querySelector('.reading-md-block') 一次命中两个。
   令牌保证后发的那次赢，先发的在任意 await 之后就地放弃。 */
const READING_SLOT_RENDER_TOKENS=new Map();
function readingSlotRenderToken(slot){const token=(READING_SLOT_RENDER_TOKENS.get(slot)||0)+1;READING_SLOT_RENDER_TOKENS.set(slot,token);return token;}
function readingSlotRenderCurrent(slot,token){return READING_SLOT_RENDER_TOKENS.get(slot)===token;}
async function renderReadingSlot(slot) {
  if(READING_SLASH_STATE&&READING_SLASH_STATE.slot===slot)hideReadingSlashMenu();
  const renderToken=readingSlotRenderToken(slot),superseded=()=>!readingSlotRenderCurrent(slot,renderToken);
  const els=readingSlotElements(slot),path=READING_SLOTS[slot],fragment=readingFragment(path);
  /* markdown 渲染会把文档名挪进工具栏；而本函数开头会 body.replaceChildren()，
     若不先搬回头部，名字节点会随旧内容一起被清掉。所以每次渲染前先复位。 */
  {const head=els.col.querySelector('.reading-col-head'),nameEl=els.col.querySelector('.doc'),viewEl=els.col.querySelector('.reading-view');
   if(head&&nameEl&&nameEl.parentElement!==head)head.insertBefore(nameEl,viewEl&&viewEl.parentElement===head?viewEl:head.firstChild);
   els.col.classList.remove('reading-col-md');}
  if(els.body.__readingBlockDestroy)await els.body.__readingBlockDestroy();
  if(superseded())return;
  delete els.body.__readingBlockDestroy;els.body.replaceChildren();els.name.textContent=path?readingBase(path):'拖入项目片段';
  els.view.style.display='';els.page.style.display='';els.pages.style.display='';els.col.querySelector('.reading-prev').style.display='';els.col.querySelector('.reading-next').style.display='';
  if(!path){const empty=document.createElement('div');empty.className='reading-paper';empty.innerHTML='<div class="empty">从左侧阅读项目拖入 PDF、Office 文档、网页、Markdown 或代码片段<br>可与另一份资料并排阅读</div>';els.body.appendChild(empty);els.page.disabled=true;return;}
  if(fragment&&['docx','sheet','slides','web'].includes(fragment.kind)){await renderReadingAsset(slot,els,fragment);if(slot===READING_ACTIVE_SLOT)syncReadingTools();return;}
  if(fragment&&['markdown','code','html'].includes(fragment.kind)){
    hideReadingPagination(els);
    let record=READING_TEXT_DOCS.get(path);if(!record){const result=await api('/api/readings/text-fragment?path='+encodeURIComponent(path));record={content:result.ok?result.content:'',savedContent:result.ok?result.content:'',error:result.ok?'':result.error};READING_TEXT_DOCS.set(path,record);}else if(record.savedContent===undefined)record.savedContent=record.content||'';
    /* 正文拉取是本分支唯一的 await：在这里核对令牌，过期的那次就地放弃，连 DOM 都不建。 */
    if(superseded())return;
    const shell=document.createElement('div');shell.className='reading-text-shell '+fragment.kind;const editor=document.createElement('textarea');editor.className='reading-text-editor '+fragment.kind;editor.spellcheck=false;editor.value=record.content||'';editor.placeholder=fragment.kind==='markdown'?'在这里记录论文笔记、结论与引用…（输入 / 插入内容块）':'在这里添加与论文相关的代码…';
    const foot=document.createElement('div');foot.className='reading-text-foot';foot.textContent=record.error||((record.content||'').length+' 字符 · 自动保存');
    const saveNow=async()=>{clearTimeout(READING_TEXT_SAVE_TIMERS.get(path));READING_TEXT_SAVE_TIMERS.delete(path);const content=record.content,linked=fragment.kind==='markdown'?await syncRemovedReadingPdfRefs(record.savedContent,content):{ok:true,changes:[]};if(!linked.ok){foot.textContent='同步失败：'+linked.error;readingStatus(foot.textContent,true);return linked;}const result=await api('/api/readings/text-fragment',{path,content});if(!result.ok&&linked.changes.length)await restoreReadingPdfRefChanges(linked.changes);if(result.ok)record.savedContent=content;foot.textContent=result.ok?'已保存 · '+content.length+' 字符':'保存失败：'+(result.error||'未知错误');if(result.ok){if(linked.changes.length)readingStatus('Markdown 引用、PDF 摘录与页内标记已同步删除');loadReadings(true);}return result;};
    const scheduleSave=()=>{clearTimeout(READING_TEXT_SAVE_TIMERS.get(path));READING_TEXT_SAVE_TIMERS.set(path,setTimeout(saveNow,500));};
    if(fragment.kind==='markdown'){
      const toolbar=document.createElement('div');toolbar.className='reading-md-toolbar';const kind=document.createElement('span');kind.className='kind';kind.textContent='Markdown';const modes=document.createElement('div');modes.className='reading-md-modes';modes.setAttribute('role','tablist');
      /* 文档名并入工具栏最左侧，整行头部隐藏（含关闭按钮） */
      els.col.classList.add('reading-col-md');els.name.title=els.name.textContent||'';if(els.name.parentElement!==toolbar)toolbar.insertBefore(els.name,toolbar.firstChild);
      const modeDefs=[['edit','✎ 源码'],['live','▦ 区块编辑'],['preview','▤ 阅读']],modeButtons=new Map();
      for(const [mode,label] of modeDefs){const button=document.createElement('button');button.type='button';button.className='reading-md-mode';button.dataset.mode=mode;button.textContent=label;button.setAttribute('role','tab');button.onclick=()=>applyMode(mode,true);modeButtons.set(mode,button);modes.appendChild(button);}
      const zoomTools=document.createElement('div');zoomTools.className='reading-md-zoom';zoomTools.setAttribute('aria-label','Markdown 缩放');const zoomOut=document.createElement('button'),zoomValueButton=document.createElement('button'),zoomIn=document.createElement('button');zoomOut.type=zoomValueButton.type=zoomIn.type='button';zoomOut.innerHTML=csGlyphIcon('−');zoomOut.title='缩小（⌘/Ctrl+-）';zoomValueButton.className='value';zoomValueButton.title='恢复 100%（⌘/Ctrl+0）';zoomIn.innerHTML=csGlyphIcon('＋');zoomIn.title='放大（⌘/Ctrl++）';zoomTools.append(zoomOut,zoomValueButton,zoomIn);const outlineToggle=document.createElement('button');outlineToggle.type='button';outlineToggle.className='reading-md-outline-toggle';outlineToggle.textContent='☷ 大纲';outlineToggle.title='显示或隐藏文档大纲';toolbar.append(kind,zoomTools,outlineToggle,modes);
      /* Markdown 模式把整行栏头隐藏了（文档名并进工具栏），栏头里那个「关闭此栏」的 × 也跟着没了 ——
         于是 Markdown 栏根本关不掉：双栏并排时想关掉右边那栏，找不到任何入口。
         这里把关闭入口补到工具栏最右侧，和栏头那个 × 走同一个 closeReadingColumn。 */
      const closeColumn=document.createElement('button');closeColumn.type='button';closeColumn.className='reading-md-close-col';closeColumn.title='关闭此栏';closeColumn.setAttribute('aria-label','关闭此栏');closeColumn.textContent='×';closeColumn.onclick=(event)=>{event.stopPropagation();closeReadingColumn(slot);};toolbar.appendChild(closeColumn);
      const workbench=document.createElement('div');workbench.className='reading-md-workbench';const source=document.createElement('textarea');source.className='reading-md-source';source.spellcheck=false;source.value=record.content||'';source.placeholder='# 从这里开始写 Markdown…\n\n输入 / 可插入标题、列表、引用与提示块';source.setAttribute('aria-label','Markdown 源码编辑器');
      const live=document.createElement('div');live.className='reading-md-block';live.dataset.readingPath=path;live.setAttribute('aria-label','Markdown 区块编辑器');
      const preview=document.createElement('div');preview.className='reading-md-editor reading-md-preview';preview.dataset.readingPath=path;preview.setAttribute('aria-label','Markdown 阅读视图');
      const outline=document.createElement('aside');outline.className='reading-md-outline';outline.setAttribute('aria-label','Markdown 文档大纲');const outlineHead=document.createElement('div');outlineHead.className='reading-md-outline-head';const outlineTitle=document.createElement('span');outlineTitle.className='reading-md-outline-title';outlineTitle.textContent='文档大纲';const outlineCount=document.createElement('span');outlineCount.className='reading-md-outline-count';const outlinePath=document.createElement('div');outlinePath.className='reading-md-outline-path';const outlinePathParent=document.createElement('span');outlinePathParent.className='seg parent';const outlinePathSep=document.createElement('span');outlinePathSep.className='sep';outlinePathSep.innerHTML=csGlyphIcon('›');const outlinePathCurrent=document.createElement('span');outlinePathCurrent.className='seg current';outlinePath.append(outlinePathParent,outlinePathSep,outlinePathCurrent);const outlineProgress=document.createElement('div');outlineProgress.className='reading-md-outline-progress';const outlineList=document.createElement('nav');outlineList.className='reading-md-outline-list';outlineList.__path={box:outlinePath,parent:outlinePathParent,current:outlinePathCurrent};/* ③ 正文宽度切换：**已按用户要求移除**（试了五版都没能让它稳定生效，用户说「算了去掉这个」）。
   教训见 .workbuddy-ai/memory 2026-10-12：不要赌 DOM 类名，够不着的界面早点要 class。 */outline.append(outlineHead,outlineList);
/* ★ ② 大纲拖拽条 ✓（用户：「大纲无法自由左右拖动」）——
   大纲宽度原来是**写死的 252px** ✗，现在走 CSS 变量 ✓。
   拖拽用 pointer 事件 + setPointerCapture ✓（划出窗口也不丢 ✓），宽度落盘 ✓。 */
{const rz=document.createElement('div');rz.className='reading-md-outline-resizer';rz.title='拖动调整大纲宽度（双击复位）';
const setW=(w)=>{const v=Math.max(160,Math.min(560,Math.round(w)));workbench.style.setProperty('--reading-md-outline-w',v+'px');return v;};
let dragging=false;
rz.onpointerdown=(e)=>{dragging=true;try{rz.setPointerCapture(e.pointerId);}catch(_){}rz.classList.add('dragging');e.preventDefault();};
rz.onpointermove=(e)=>{if(!dragging)return;const box=workbench.getBoundingClientRect();setW(e.clientX-box.left);e.preventDefault();};
const save=()=>{try{localStorage.setItem('codescope-md-outline-w',String(parseInt(getComputedStyle(workbench).getPropertyValue('--reading-md-outline-w'),10)||252));}catch(_){}};
rz.onpointerup=(e)=>{if(!dragging)return;dragging=false;rz.classList.remove('dragging');try{rz.releasePointerCapture(e.pointerId);}catch(_){}save();};rz.onpointercancel=rz.onpointerup;
rz.ondblclick=()=>{setW(252);save();};
try{const sv=parseInt(localStorage.getItem('codescope-md-outline-w')||'',10);if(sv>=160&&sv<=560)setW(sv);}catch(_){}
workbench.append(rz);}
      const historyKey='reading:'+path;markdownLiveHistory(historyKey,record.content||'');
      let markdownZoom=loadReadingMarkdownZoom(path),outlineOpen=loadReadingMarkdownOutline(path),outlineEntries=[],blockEditor=null,blockMountId=0;const setMarkdownZoom=(value,persist=true)=>{markdownZoom=Math.max(60,Math.min(180,Math.round(Number(value)||100)));const ratio=markdownZoom/100,fontSize=(16*ratio).toFixed(2)+'px';shell.style.setProperty('--reading-md-zoom',ratio.toFixed(2));shell.style.setProperty('--reading-md-font-size',fontSize);shell.style.setProperty('--reading-md-source-font-size',(12*ratio).toFixed(2)+'px');live.querySelector('.ProseMirror')?.style.setProperty('font-size',fontSize);zoomValueButton.textContent=markdownZoom+'%';zoomValueButton.setAttribute('aria-label','当前缩放 '+markdownZoom+'%，点击恢复 100%');if(persist)saveReadingMarkdownZoom(path,markdownZoom);};const setOutlineOpen=(value,persist=true)=>{outlineOpen=!!value;workbench.classList.toggle('outline-open',outlineOpen);outlineToggle.classList.toggle('active',outlineOpen);outlineToggle.setAttribute('aria-expanded',String(outlineOpen));if(persist)saveReadingMarkdownOutline(path,outlineOpen);};
      /* 窄栏时大纲是覆盖层（absolute），会压住正文 —— 所以跳转完就该自己收起来，别让正文一直半遮着。
         宽栏时它是并排的一列侧栏，点正文当然不该把它关掉，所以先看计算样式里的 position 再决定。
         收起时一并持久化：否则下次打开这份文档又是「正文被盖住」的状态。 */
      const closeOverlayOutline=()=>{if(!outlineOpen)return;if(getComputedStyle(outline).position!=='absolute')return;setOutlineOpen(false,true);};
      /* 跳转时**锁定**高亮 ✗✗ —— 基准在视口 1/3 处，而跳转把标题停在顶部，
   不锁的话跳完立刻又被判成「上一个标题」。锁定由**用户主动操作**解除（见下面）。 */
      /* ⚠️⚠️ **不能**在 setOutlineActive 里顺手写 live.__outlineTargetIndex ✗✗
   （上一轮就是在这里写的，结果把大纲锁死在了第 0 项 —— 见下面 jumpOutlineActive 的说明）。
   初始化（refreshFold(); setOutlineActive(0);）和源码模式同步都会走这个函数，
   只要它写锁定，滚动同步就永远读到 0 → **大纲永远高亮第一项、看起来"跳到开头"**
   （用户在「里程计」下面写东西时看到的正是这个）。 */
const setOutlineActive=(index)=>setReadingMarkdownOutlineActive(outlineList,index,true,true);
/* 只有「用户点大纲条目」这种**主动跳转**才写锁定 —— 因为基准在视口 1/3 处，
   而跳转把标题停在顶部，不锁的话跳完立刻又被判成「上一个标题」。 */
const jumpOutlineActive=(index)=>{live.__outlineTargetIndex=index;setReadingMarkdownOutlineActive(outlineList,index,true,true);};const sourceLine=()=>source.value.slice(0,source.selectionStart).split('\n').length-1;const syncOutlineFromSource=()=>{const line=sourceLine();let active=-1;outlineEntries.forEach((entry,index)=>{if(entry.line<=line)active=index;});setOutlineActive(active);};const syncOutlineFromView=(container)=>{const nodes=container===preview?[...preview.querySelectorAll('[data-outline-index]')]:[...live.querySelectorAll('.ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6')];if(!nodes.length)return setOutlineActive(-1);const top=container.getBoundingClientRect().top+88;let active=0;nodes.forEach((node,index)=>{if(node.getBoundingClientRect().top<=top)active=container===preview?Number(node.dataset.outlineIndex):index;});if(container.scrollTop+container.clientHeight>=container.scrollHeight-4)active=container===preview?Number(nodes[nodes.length-1].dataset.outlineIndex):nodes.length-1;setOutlineActive(active);};const focusOutlineEntry=(entry,index)=>{const mode=shell.dataset.mdMode;if(mode==='edit'){const offset=record.content.split('\n').slice(0,entry.line).reduce((sum,line)=>sum+line.length+1,0);source.focus();source.setSelectionRange(offset,offset);const lineHeight=parseFloat(getComputedStyle(source).lineHeight)||20;source.scrollTop=Math.max(0,entry.line*lineHeight-source.clientHeight*.24);}else if(mode==='preview'){preview.querySelector('[data-outline-index="'+index+'"]')?.scrollIntoView({behavior:'smooth',block:'start'});}else{live.querySelectorAll('.ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6')[index]?.scrollIntoView({behavior:'smooth',block:'start'});}jumpOutlineActive(index);closeOverlayOutline();};const renderOutline=()=>{outlineEntries=readingMarkdownHeadings(record.content);outlineCount.textContent=String(outlineEntries.length);outlineList.replaceChildren();if(!outlineEntries.length){const empty=document.createElement('div');empty.className='reading-md-outline-empty';empty.textContent='使用 #、##、### 标题后，这里会自动生成导航。';outlineList.appendChild(empty);delete outlineList.__refreshFold;return;}const base=Math.min(...outlineEntries.map((entry)=>entry.level));
      /* 折叠可见性：从头扫一遍，遇到 data-folded=1 就把它后面更深的层级全部隐藏（天然支持嵌套折叠） */
      const refreshFold=()=>{const nodes=[...outlineList.querySelectorAll('.reading-md-outline-item')];let hideDeeperThan=Infinity;nodes.forEach((node)=>{const level=Number(node.dataset.level||0);if(level>hideDeeperThan){node.classList.add('hidden-by-fold');return;}node.classList.remove('hidden-by-fold');hideDeeperThan=Infinity;if(node.dataset.folded==='1')hideDeeperThan=level;});};
      outlineList.__refreshFold=refreshFold;
      /* 相对层级：作者漏写中间层（例如 h2 直接跳 h4）时把跳级收敛成一级，
         否则会出现空轨道 + 大幅缩进，白白吃掉横向空间。 */
      let runningDepth=0;
      outlineEntries.forEach((entry,index)=>{const hasChildren=index+1<outlineEntries.length&&outlineEntries[index+1].level>entry.level;const button=document.createElement('button');button.type='button';button.className='reading-md-outline-item'+(hasChildren?' has-children':'');{const relative=Math.max(0,entry.level-base),depth=index===0?relative:Math.min(relative,runningDepth+1);runningDepth=depth;button.style.setProperty('--outline-depth',String(depth));}button.dataset.level=String(entry.level);button.title=entry.text;const label=document.createElement('span');label.className='label';label.textContent=entry.text;button.appendChild(label);{const copyRef=document.createElement('span');copyRef.className='reading-md-outline-ref';copyRef.setAttribute('role','button');copyRef.tabIndex=0;copyRef.title='复制引用链接 [[md-ref:…]]（可粘到任意笔记里跳转）';copyRef.setAttribute('aria-label','复制引用链接');copyRef.textContent='↗';button.appendChild(copyRef);}{const copy=document.createElement('span');copy.className='reading-md-outline-copy';copy.setAttribute('role','button');copy.tabIndex=0;copy.title='复制指向此标题的链接';copy.setAttribute('aria-label','复制链接');copy.textContent='⧉';button.appendChild(copy);}if(hasChildren){const more=document.createElement('span');more.className='reading-md-outline-more';more.setAttribute('role','button');more.tabIndex=0;more.title='折叠 / 展开这一节';more.innerHTML=csGlyphIcon('▾');
  /* ★ 折叠：CSS 和「按 data-folded 隐藏更深层级」的逻辑早就有了 ✓，
     但触发按钮被设成 pointer-events:none ✗ —— 点不动 ✓，所以一直折不了 ✓。
     这里把点击接上 ✓：只切自己的 data-folded ✓，不动别人的 ✓（默认展开 ✓）。 */
  const toggle=(e)=>{e.preventDefault();e.stopPropagation();const f=button.getAttribute('data-folded')==='1';button.setAttribute('data-folded',f?'0':'1');more.innerHTML=f? csGlyphIcon('▾') : csGlyphIcon('▸');button.setAttribute('aria-expanded',f?'true':'false');};
  more.onclick=toggle;more.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' ')toggle(e);};
  button.appendChild(more);button.setAttribute('aria-expanded','true');}button.onclick=()=>focusOutlineEntry(entry,index);outlineList.appendChild(button);});
      refreshFold();setOutlineActive(0);};setMarkdownZoom(markdownZoom,false);setOutlineOpen(outlineOpen,false);outlineToggle.onclick=()=>setOutlineOpen(!outlineOpen);
      /* 覆盖层模式下点正文任意处就收起抽屉（点抽屉本身、点「大纲」按钮都不算）。
         pointerdown 而不是 click：拖选文字时也应该先把挡路的抽屉收掉。 */
      workbench.addEventListener('pointerdown',(event)=>{if(!outlineOpen)return;if(getComputedStyle(outline).position!=='absolute')return;const target=event.target;if(!(target instanceof Element))return;if(outline.contains(target)||outlineToggle.contains(target))return;setOutlineOpen(false,true);},true);zoomOut.onclick=()=>setMarkdownZoom(markdownZoom-10);zoomIn.onclick=()=>setMarkdownZoom(markdownZoom+10);zoomValueButton.onclick=()=>setMarkdownZoom(100);const renderPreview=()=>{preview.innerHTML='<div class="reading-md-preview-content">'+renderMd(record.content||'')+'</div>';decorateMarkdownLinks(preview);/* 预览的标题原来完全没有 id，补上后 #锚点 既能被解析也能被高亮定位 */{[...preview.querySelectorAll('.reading-md-preview-content h1,.reading-md-preview-content h2,.reading-md-preview-content h3,.reading-md-preview-content h4,.reading-md-preview-content h5,.reading-md-preview-content h6')].forEach((head)=>{if(head.id)return;const slug=readingMarkdownSlug(head.textContent);if(!slug)return;
  /* 区块编辑器那份 DOM 常驻在页面上（只是被隐藏），它的标题已经占用了纯 slug，直接同名会产生重复 id，
     所以预览侧统一加 md- 前缀，两个容器互不干扰；锚点解析两种写法都认。 */
  const scoped='md-'+slug;if(preview.querySelector('[id="'+scoped.replace(/"/g,'')+'"]'))return;head.id=scoped;});}const nodes=[...preview.querySelectorAll('.reading-md-preview-content h1,.reading-md-preview-content h2,.reading-md-preview-content h3,.reading-md-preview-content h4,.reading-md-preview-content h5,.reading-md-preview-content h6')];let cursor=0;outlineEntries=readingMarkdownHeadings(record.content);outlineEntries.forEach((entry,index)=>{for(;cursor<nodes.length;cursor++){const node=nodes[cursor],level=Number(node.tagName.slice(1));if(level===entry.level&&node.textContent.trim()===entry.text){node.dataset.outlineIndex=String(index);cursor++;break;}}});renderOutline();};
      const openBlockReference=(token)=>{const host=document.createElement('div');host.innerHTML=mdInline(token);const pdf=host.querySelector('.reading-pdf-ref');if(pdf){locateReadingMarkdownRef(pdf,slot);return;}const linked=host.querySelector('.md-code-ref,.md-note-ref');if(linked){decorateMarkdownLinks(host);linked.click();}};
      const destroyBlockEditor=async()=>{blockMountId++;const current=blockEditor;blockEditor=null;if(current)try{await current.destroy();}catch(_){}};
      const mountBlockEditor=async(focus)=>{await destroyBlockEditor();const id=++blockMountId;live.replaceChildren();const loading=document.createElement('div');loading.className='reading-md-block-loading';loading.textContent='正在加载区块编辑器…';live.appendChild(loading);try{await loadBlockEditor();const controller=await window.CodeScopeBlockEditor.create({root:live,markdown:mdSyntaxToEditor(record.content||''),onChange:(rawContent)=>{const content=mdSyntaxFromEditor(rawContent);record.content=content;source.value=content;recordMarkdownLiveHistory(historyKey,content,{source:false},'typing');renderPreview();foot.textContent='正在编辑… · '+content.length+' 字符';scheduleSave();},onFocus:()=>{READING_ACTIVE_SLOT=slot;READING_CURRENT=path;},onExcerpt:()=>{READING_ACTIVE_SLOT=slot;READING_CURRENT=path;return addReadingFragment();},onReference:openBlockReference,onImage:path.startsWith('知识库/')?(file)=>uploadKnowledgeEditorImage(file,path):null,onError:(error)=>{const message=String(error&&error.message||error);foot.textContent='图片插入失败：'+message;readingStatus(foot.textContent,true);}});if(id!==blockMountId){await controller.destroy();return;}loading.remove();blockEditor=controller;setMarkdownZoom(markdownZoom,false);if(focus)setTimeout(()=>controller.focus(),0);}catch(error){if(id!==blockMountId)return;const failed=document.createElement('div');failed.className='reading-md-block-error';failed.textContent='区块编辑器加载失败：'+(error&&error.message||error);live.replaceChildren(failed);}};
      const applyMode=(mode,persist)=>{hideReadingSlashMenu();if(!['edit','live','preview'].includes(mode))mode='live';shell.dataset.mdMode=mode;for(const [name,button] of modeButtons){const active=name===mode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));}if(persist)saveReadingMarkdownMode(path,mode);if(mode==='edit'){destroyBlockEditor();source.value=record.content||'';setTimeout(()=>source.focus(),0);}if(mode==='live')mountBlockEditor(true);if(mode==='preview'){destroyBlockEditor();renderPreview();}scheduleReadingExcerptMarks();};
      const contentChanged=(event)=>{record.content=source.value;recordMarkdownLiveHistory(historyKey,record.content,{source:true,start:source.selectionStart,end:source.selectionEnd},event&&event.isTrusted?'typing':'command');renderPreview();foot.textContent='正在编辑… · '+record.content.length+' 字符';scheduleSave();updateReadingSlashMenu(source,slot);};
      source.addEventListener('input',contentChanged);
      source.addEventListener('click',()=>updateReadingSlashMenu(source,slot));
      source.addEventListener('blur',()=>setTimeout(()=>{if(READING_SLASH_STATE&&READING_SLASH_STATE.editor===source&&(!READING_SLASH_MENU||!READING_SLASH_MENU.contains(document.activeElement)))hideReadingSlashMenu();},0));
      source.addEventListener('keyup',(e)=>{if(!['ArrowDown','ArrowUp','Enter','Escape'].includes(e.key))updateReadingSlashMenu(source,slot);});
      source.addEventListener('select',syncOutlineFromSource);source.addEventListener('click',syncOutlineFromSource);source.addEventListener('keyup',syncOutlineFromSource);
      /* ★ 只有**用户主动**操作才解除锁定 ✗ —— 不能用 scroll 事件：
         跳转本身就会触发滚动 ✗，那样锁一设上就被自己清掉、等于没锁。
         wheel / touchstart / keydown / pointerdown 只在真人操作时才有。 */
      ['wheel','touchstart','keydown','pointerdown'].forEach((type)=>live.addEventListener(type,()=>{delete live.__outlineTargetIndex;},{passive:true}));
      live.addEventListener('scroll',()=>requestAnimationFrame(()=>{syncReadingMarkdownOutlineView(live,outlineList,false);updateReadingMarkdownOutlineProgress(live,outlineList);scheduleReadingExcerptMarks();}));preview.addEventListener('scroll',()=>requestAnimationFrame(()=>{syncReadingMarkdownOutlineView(preview,outlineList,true);updateReadingMarkdownOutlineProgress(preview,outlineList);scheduleReadingExcerptMarks();}));
      outlineList.addEventListener('click',(event)=>{const refHit=event.target.closest('.reading-md-outline-ref');
        if(refHit){event.preventDefault();event.stopImmediatePropagation();const refItem=refHit.closest('.reading-md-outline-item');
          const refIndex=refItem?[...outlineList.querySelectorAll('.reading-md-outline-item')].indexOf(refItem):-1;const refEntry=refIndex>=0?outlineEntries[refIndex]:null;
          if(refEntry){const token='[[md-ref:'+encodeURIComponent(path)+'#'+encodeURIComponent(readingMarkdownSlug(refEntry.text))+'|'+refEntry.text+']]';
            const settle=(ok)=>{refHit.textContent=ok?'✓':'✗';refHit.dataset.copied='1';setTimeout(()=>{refHit.textContent='↗';delete refHit.dataset.copied;},1300);
              try{readingStatus(ok?'已复制引用：'+token:'复制失败，请手动复制：'+token,!ok);}catch(_){}};
            try{Promise.resolve(copyTextValue(token)).then(settle,()=>settle(false));}catch(_){settle(false);}}
          return;}
        const copyHit=event.target.closest('.reading-md-outline-copy');if(copyHit){event.preventDefault();event.stopImmediatePropagation();const copyItem=copyHit.closest('.reading-md-outline-item');const copyIndex=copyItem?[...outlineList.querySelectorAll('.reading-md-outline-item')].indexOf(copyItem):-1;const copyEntry=copyIndex>=0?outlineEntries[copyIndex]:null;if(copyEntry){const linkText='['+copyEntry.text+'](#'+readingMarkdownSlug(copyEntry.text)+')';const settle=(ok)=>{copyHit.textContent=ok?'✓':'✗';copyHit.dataset.copied='1';setTimeout(()=>{copyHit.textContent='⧉';delete copyHit.dataset.copied;},1300);try{readingStatus(ok?'已复制链接：'+linkText:'复制失败，请手动复制：'+linkText,!ok);}catch(_){}};try{Promise.resolve(copyTextValue(linkText)).then(settle,()=>settle(false));}catch(_){settle(false);}}return;}const more=event.target.closest('.reading-md-outline-more');if(more){event.preventDefault();event.stopImmediatePropagation();const foldButton=more.closest('.reading-md-outline-item');if(foldButton){const folded=foldButton.dataset.folded==='1';foldButton.dataset.folded=folded?'0':'1';foldButton.setAttribute('aria-expanded',String(folded));if(typeof outlineList.__refreshFold==='function')outlineList.__refreshFold();}return;}const button=event.target.closest('.reading-md-outline-item');if(!button||shell.dataset.mdMode==='edit')return;event.preventDefault();event.stopImmediatePropagation();const index=[...outlineList.querySelectorAll('.reading-md-outline-item')].indexOf(button),isPreview=shell.dataset.mdMode==='preview',container=isPreview?preview:live,node=readingMarkdownOutlineNodes(outlineEntries,container,isPreview)[index]||null;clearTimeout(container.__outlineTargetTimer);container.__outlineTargetIndex=index;container.__outlineTargetTimer=setTimeout(()=>{delete container.__outlineTargetIndex;syncReadingMarkdownOutlineView(container,outlineList,isPreview);},1000);setReadingMarkdownOutlineActive(outlineList,index,false);scrollReadingMarkdownHeading(container,node,isPreview);/* 点大纲会连带触发编辑器重挂载（异步），DOM 节点会被连续替换好几次，把动画类加在同步取到的节点上，加完就被丢弃、等于没闪。所以这里跟踪 1.2 秒：只有解析出来的节点和上次不是同一个（说明被换过了）才重新闪一次；节点没变就绝不重启动画，避免闪个不停。 */flashReadingMarkdownHeading(()=>readingMarkdownOutlineNodes(outlineEntries,container,isPreview)[index]||null);
        /* 这个委托处理器注册在捕获阶段、又会 stopImmediatePropagation，所以按钮自己的 onclick
           （focusOutlineEntry）在真实点击里根本轮不到执行 —— 覆盖层模式下「跳完自动收起」得在这里补一刀。
           ⚠️⚠️ 原来**只补了"收起"，没补"跳转"** ✗✗ ——
              结果覆盖层里点大纲：面板收起了，正文**不动** ✓
              （用户：「项目里面的 markdown，右侧的大纲，怎么无法定位」✓）。
           ⇒ 这里必须**自己调一次 focusOutlineEntry** ✗ ——
             点的是条目本身（ref/copy 两种小按钮上面已经 return 掉了 ✓）。 */
        {const hit=event.target.closest?event.target.closest('.reading-md-outline-item'):null;
         if(hit){const idx=[...outlineList.querySelectorAll('.reading-md-outline-item')].indexOf(hit);
           if(idx>=0&&outlineEntries[idx])try{focusOutlineEntry(outlineEntries[idx],idx);}catch(_){}}}
        closeOverlayOutline();},true);
      source.addEventListener('keydown',(e)=>{if(readingSlashKeydown(e,source))return;if(e.key==='Tab'){e.preventDefault();source.setRangeText('  ',source.selectionStart,source.selectionEnd,'end');source.dispatchEvent(new Event('input',{bubbles:true}));return;}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveNow();}});
      workbench.addEventListener('wheel',(e)=>{if(!(e.metaKey||e.ctrlKey))return;e.preventDefault();setMarkdownZoom(markdownZoom+(e.deltaY<0?5:-5));},{passive:false});
      /* 文档内锚点跳转：区块编辑与阅读两种模式共用一套逻辑（滚动 + 落点闪烁）。
         用 capture 阶段抢在 Crepe 的链接编辑弹层之前；只处理真正能解析到的锚点，其余全部放行。
         不写 location.hash：应用自己的引用胶囊也用 # 开头，改 hash 会污染地址栏历史。 */
      workbench.addEventListener('click',(event)=>{
        const link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
        if(!link||!workbench.contains(link))return;
        const href=link.getAttribute('href')||'';
        if(href.charAt(0)!=='#'||href.length<2)return;
        if(href.indexOf('#codescope-ref-')===0)return;
        /* 引用跳转：同文档直接滚到标题；跨文档先打开目标笔记再滚。
           openReading 会重建该栏 DOM，所以必须重新查询容器，不能用上面闭包里的旧引用。 */
        if(href.indexOf('#cc-mdref-')===0){
          event.preventDefault();event.stopPropagation();
          const payload=mdRefUnb64(href.slice('#cc-mdref-'.length)),cut=payload.indexOf('#');
          const rawTarget=cut<0?payload:payload.slice(0,cut),anchor=cut<0?'':payload.slice(cut+1);
          const target=rawTarget.startsWith('reading:')?rawTarget.slice(8):rawTarget;
          const jumpIn=(container,isPreview)=>{const node=readingMarkdownAnchorTarget(container,anchor,isPreview);if(!node)return false;
            scrollReadingMarkdownHeading(container,node,isPreview);
            flashReadingMarkdownHeading(()=>readingMarkdownAnchorTarget(container,anchor,isPreview));
            try{const index=readingMarkdownOutlineNodes(outlineEntries,container,isPreview).indexOf(node);if(index>=0)setReadingMarkdownOutlineActive(outlineList,index,false);}catch(_){}
            return true;};
          if(!target||target===path){const currentPreview=shell.dataset.mdMode==='preview';
            if(!jumpIn(currentPreview?preview:live,currentPreview)){try{readingStatus('引用的标题没找到，可能已经被改名了',true);}catch(_){}}
            return;}
          (async()=>{
            try{readingStatus('正在打开引用的笔记…');}catch(_){}
            await openReading(target,slot);
            let tries=0;
            const settle=()=>{
              const column=document.querySelector('.reading-col[data-slot="'+slot+'"]');
              const workbench=column?column.querySelector('.reading-md-workbench'):null;
              const isPreview=!!workbench&&workbench.dataset.mdMode==='preview';
              const container=column?(isPreview?column.querySelector('.reading-md-preview'):column.querySelector('.reading-md-block')):null;
              if(container&&jumpIn(container,isPreview)){try{readingStatus('已跳到引用的标题');}catch(_){}return;}
              if(++tries>60){try{readingStatus('引用的标题没找到，可能已被改名',true);}catch(_){}return;}
              setTimeout(settle,120);
            };
            setTimeout(settle,150);
          })();
          return;
        }
        if(href.indexOf('#cc-')===0){event.preventDefault();event.stopPropagation();return;}   /* 颜色/高亮用假链接承载，点击不该跳转，也不该弹出编辑器的链接弹层 */
        /* 应用自己的三类引用胶囊（PDF 片段 / 关联笔记 / 代码引用）各有各的跳转处理，绝不截胡 */
        if(link.classList.contains('reading-pdf-ref')||link.classList.contains('md-note-ref')||link.classList.contains('md-code-ref'))return;
        if(link.dataset&&(link.dataset.pdfPath||link.dataset.notePath||link.dataset.codeFile))return;
        const mode=shell.dataset.mdMode||'live';
        if(mode==='edit')return;
        const isPreview=mode==='preview',container=isPreview?preview:live;
        let raw=href.slice(1);try{raw=decodeURIComponent(raw);}catch(_){raw=href.slice(1);}
        if(!readingMarkdownAnchorTarget(container,raw,isPreview))return;
        event.preventDefault();event.stopPropagation();
        scrollReadingMarkdownHeading(container,readingMarkdownAnchorTarget(container,raw,isPreview),isPreview);
        flashReadingMarkdownHeading(()=>readingMarkdownAnchorTarget(container,raw,isPreview));
      },true);
      workbench.addEventListener('keydown',(e)=>{if(!(e.metaKey||e.ctrlKey))return;if(e.key==='0'){e.preventDefault();setMarkdownZoom(100);return;}if(e.key==='+'||e.key==='='){e.preventDefault();setMarkdownZoom(markdownZoom+10);return;}if(e.key==='-'||e.key==='_'){e.preventDefault();setMarkdownZoom(markdownZoom-10);} },true);
      const previewClick=async(e)=>{const remove=e.target.closest&&e.target.closest('.callout-remove');if(remove){e.preventDefault();e.stopPropagation();const quote=remove.closest('blockquote'),ref=quote&&quote.querySelector('.reading-pdf-ref'),start=Number(quote&&quote.dataset.mdStart),end=Number(quote&&quote.dataset.mdEnd);if(quote&&Number.isFinite(start)&&Number.isFinite(end)){remove.disabled=true;const nextContent=removeReadingMarkdownBlock(record.content,start,end),linked=await removeReadingLinkedPdfFragment(ref);if(!linked.ok){remove.disabled=false;readingStatus('PDF 摘录删除失败：'+(linked.error||'未知错误'),true);return;}const saved=await api('/api/readings/text-fragment',{path,content:nextContent});if(!saved.ok){await restoreReadingLinkedPdfFragment(linked);remove.disabled=false;readingStatus('Markdown 引用删除失败，PDF 摘录已恢复：'+(saved.error||'未知错误'),true);return;}clearTimeout(READING_TEXT_SAVE_TIMERS.get(path));READING_TEXT_SAVE_TIMERS.delete(path);record.content=nextContent;record.savedContent=nextContent;source.value=record.content;/* ⚠️ 原来是 `renderLive(false)` ✗ —— 那个函数**全项目不存在** ✓ → 删 callout 引用时
   抛 `ReferenceError` ✓，后面的 `renderPreview()` / 状态更新全被跳过 ✗。
   live 面板现在是**块编辑器** ✓，重挂载走 `applyMode('live')` ✓（见 applyMode 定义 ✓）。 */
if(shell.dataset.mdMode==='live')applyMode('live',false);renderPreview();foot.textContent='已保存 · '+record.content.length+' 字符';loadReadings(true);readingStatus(linked.removed?'引用、PDF 摘录与页内标记已同步删除':'引用已从 Markdown 笔记中移除');}return;}const ref=e.target.closest&&e.target.closest('.reading-pdf-ref');if(!ref)return;e.preventDefault();e.stopPropagation();locateReadingMarkdownRef(ref,slot);};live.addEventListener('click',previewClick);preview.addEventListener('click',previewClick);
      renderPreview();workbench.append(source,live,preview,outline);shell.append(toolbar,workbench,foot);els.body.__readingBlockDestroy=destroyBlockEditor;applyMode(loadReadingMarkdownMode(path),false);
      /* 窄栏里大纲是覆盖层（absolute），会压住正文 —— 两种时刻要主动收起：
         ① 挂载时：这份「展开」偏好往往是在宽栏时留下的，一进来就把正文盖住；
         ② 从并排侧栏变窄成覆盖层时：例如把同一篇拖到第二栏并排阅读，栏宽掉到 900px 以下。
         两种都不写回偏好 —— 宽栏下次照样是并排侧栏，窄栏里按「大纲」按钮也照样能展开，只是用完会自己收。
         只在「首次观察」和「并排 → 覆盖」的跃迁上收，用户自己展开后就不再插手，免得打架。
         rAF 那一次是必需的：shell 要等这一轮渲染结束才真正进 DOM，那时容器宽度与容器查询才算得出来；
         rAF 回调跑在绘制之前，所以不会闪一下展开态。 */
      let outlineOverlay=null;
      const syncOutlineOverlay=()=>{
        const overlay=getComputedStyle(outline).position==='absolute',was=outlineOverlay;outlineOverlay=overlay;
        if(overlay&&outlineOpen&&(was===null||was===false))setOutlineOpen(false,false);
      };
      requestAnimationFrame(syncOutlineOverlay);
      if(typeof ResizeObserver==='function'){shell.__outlineOverlayObserver=new ResizeObserver(syncOutlineOverlay);shell.__outlineOverlayObserver.observe(workbench);}
    }else if(fragment.kind==='html'){
      const workbench=document.createElement('div');workbench.className='reading-html-workbench';
      const sourceWrap=document.createElement('div');sourceWrap.className='reading-html-source';
      const divider=document.createElement('div');divider.className='reading-html-split';divider.title='拖动调整源码 / 预览宽度';
      const previewWrap=document.createElement('div');previewWrap.className='reading-html-preview-wrap';
      const preview=document.createElement('iframe');preview.className='reading-html-preview';
      preview.setAttribute('sandbox','allow-scripts allow-modals allow-forms allow-popups');preview.setAttribute('referrerpolicy','no-referrer');
      preview.title='HTML 渲染预览';preview.srcdoc=record.content||'';
      previewWrap.appendChild(preview);
      /* ★ markdown 源码模式：**行号栏** ✓（用户：「markdown 文档缺少行号」）——
         textarea 自己画不了行号 ✓，所以加一个**同步滚动的行号栏** ✓：
         · 行号栏放源码框左边 ✓，行高/字号与 textarea 对齐 ✓（CSS 用同一套 ✓）
         · 输入时重算行数 ✓，滚动时同步 scrollTop ✓
         · pointer-events:none ✓，不挡选中文字 ✓ */
      (function(){const gutter=document.createElement('div');gutter.className='reading-md-gutter';gutter.setAttribute('aria-hidden','true');
       sourceWrap.insertBefore(gutter,source);
       let lastCount=-1;
       const paint=()=>{const n=source.value.split('\n').length;
         if(n!==lastCount){lastCount=n;const frag=document.createDocumentFragment();
           for(let i=1;i<=n;i++){const d=document.createElement('div');d.textContent=String(i);frag.appendChild(d);}
           gutter.replaceChildren(frag);}
         gutter.scrollTop=source.scrollTop;};
       source.addEventListener('input',paint);
       source.addEventListener('scroll',()=>{gutter.scrollTop=source.scrollTop;},{passive:true});
       paint();})();
      workbench.append(sourceWrap,divider,previewWrap);
      let monacoEditor=null,renderTimer=0,editorDisposed=false,resizeHandler=null;
      const getSource=()=>monacoEditor&&!editorDisposed?monacoEditor.getValue():record.content||'';
      const syncPreview=()=>{if(editorDisposed)return;const src=getSource();if(preview.__src===src)return;preview.__src=src;preview.srcdoc=src;};
      const schedulePreview=()=>{clearTimeout(renderTimer);renderTimer=setTimeout(syncPreview,150);};
      // getSource 一旦抛错，旧的写法会让后面的自动保存与预览刷新一起静默失效（表现为“左侧有内容、右侧不渲染”），
      // 因此这里把失败暴露到状态栏，便于定位而不是无声无息。
      const onChange=()=>{try{record.content=getSource();}catch(error){foot.textContent='读取编辑器内容失败：'+String(error&&error.message||error);return;}foot.textContent='正在编辑…';scheduleSave();schedulePreview();};
      els.body.__readingBlockDestroy=()=>{editorDisposed=true;if(READING_HTML_EDITOR===monacoEditor)READING_HTML_EDITOR=null;clearTimeout(renderTimer);if(resizeHandler)window.removeEventListener('resize',resizeHandler);if(monacoEditor){try{monacoEditor.dispose();}catch(_){}}};
      let splitWidth=parseInt(localStorage.getItem('mc-reading-html-split-w'))||0;
      /* 分栏按像素记忆，但必须给右侧预览留最小宽度：容器变窄时若不收敛，预览会被压成 0px，
         视觉上就变成“只有源码、没有分栏”。 */
      const applySplit=(px)=>{const total=workbench.clientWidth||0;const width=total?Math.max(200,Math.min(Math.round(px),Math.max(240,total-247))):Math.max(200,Math.round(px));workbench.style.gridTemplateColumns=width+'px 7px minmax(0,1fr)';return width;};
      const clampSplit=()=>{if(splitWidth>=200&&workbench.clientWidth)applySplit(splitWidth);};
      if(splitWidth>=200)workbench.style.gridTemplateColumns=splitWidth+'px 7px minmax(0,1fr)';
      makeResizer(divider,'v',
        ()=>sourceWrap.getBoundingClientRect().width,
        (v)=>{splitWidth=Math.round(v);const width=applySplit(v);try{localStorage.setItem('mc-reading-html-split-w',String(width));}catch(_){}});
      const createMonaco=async()=>{
        try{
          const monaco=await ensureMonaco();
          if(editorDisposed)return;
          /* 这里是“文档源码”而非工程代码：默认软换行，长行不会被横向截断（Alt+Z 可关闭） */
          monacoEditor=window.monaco.editor.create(sourceWrap,Object.assign({},monacoOptions(false),{language:'html',value:record.content||'',wordWrap:'on',automaticLayout:true,minimap:{enabled:false},stickyScroll:{enabled:false},scrollBeyondLastLine:false,padding:{top:12,bottom:16}}));
          READING_HTML_EDITOR=monacoEditor;
          clampSplit();
          monacoEditor.onDidChangeModelContent(()=>onChange());
          monacoEditor.addCommand(window.monaco.KeyMod.CtrlCmd|window.monaco.KeyCode.KeyS,()=>{saveNow();});
          resizeHandler=()=>{if(monacoEditor&&!editorDisposed)monacoEditor.layout();clampSplit();};
          window.addEventListener('resize',resizeHandler);
        }catch(_){
          if(editorDisposed)return;
          const ta=document.createElement('textarea');ta.className='reading-html-fallback';ta.spellcheck=false;ta.value=record.content||'';ta.placeholder='<!doctype html>\n<html>\n  <head><meta charset="utf-8"><title>我的页面</title></head>\n  <body>…</body>\n</html>';ta.setAttribute('aria-label','HTML 源码编辑器');
          ta.addEventListener('input',()=>{record.content=ta.value;foot.textContent='正在编辑…';scheduleSave();schedulePreview();});
          ta.addEventListener('keydown',(e)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveNow();}});
          sourceWrap.replaceChildren(ta);
        }
      };
      createMonaco();
      shell.append(workbench,foot);
    }else{
      editor.addEventListener('input',()=>{record.content=editor.value;foot.textContent='正在编辑…';scheduleSave();});editor.addEventListener('keydown',(e)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveNow();}});
      shell.append(editor,foot);
    }
    if(superseded())return;els.body.appendChild(shell);if(slot===READING_ACTIVE_SLOT)syncReadingTools();return;
  }
  const doc=await ensureReadingDoc(path),versions=readingPdfVersions(fragment),view=els.view.value;syncReadingViewOptions(els,versions);let page=Math.max(1,Math.min(doc.pageCount||9999,Number(els.page.value)||doc.meta.page||1));els.page.value=page;els.page.disabled=false;els.page.max=doc.pageCount||9999;els.pages.textContent='/ '+(doc.pageCount||'?');
  if(slot===READING_ACTIVE_SLOT){doc.meta.page=page;doc.meta.view=view;saveReadingDoc(doc);}
  if(slot===READING_ACTIVE_SLOT)syncReadingTools();
  const physical=view==='original'?(fragment&&fragment.kind==='pdf'?fragment:(versions.original||fragment)):view==='translation'?versions.translation:view==='bilingual'?versions.bilingual:null;
  if(physical){
    const physicalDoc=physical.path===path?doc:await ensureReadingDoc(physical.path);page=Math.max(1,Math.min(physicalDoc.pageCount||9999,page));els.page.value=page;els.page.max=physicalDoc.pageCount||9999;els.pages.textContent='/ '+(physicalDoc.pageCount||'?');els.name.textContent=readingBase(physical.name)+(physical.path===path?'':' · '+readingRoleLabel(physical));
    if(superseded())return;
    if (window.__pdfViewerReady) { await renderPdfViewer(els.body, physical.path, page); return; }
    const frame=document.createElement('iframe');frame.className='reading-pdf';frame.title=readingBase(physical.path);frame.src='/api/readings/file?path='+encodeURIComponent(physical.path)+'#page='+page+'&zoom=page-width';if(superseded())return;els.body.appendChild(frame);return;
  }
  const sourceFragment=versions.original||fragment,sourceDoc=sourceFragment.path===path?doc:await ensureReadingDoc(sourceFragment.path);const translatedDoc=view==='bilingual'&&versions.translation?await ensureReadingDoc(versions.translation.path):null;
  const paper=document.createElement('div');paper.className='reading-paper '+view;const source=(sourceDoc.pages&&sourceDoc.pages[page-1])||'';const translation=translatedDoc?((translatedDoc.pages&&translatedDoc.pages[page-1])||''):String((sourceDoc.meta.translations||{})[page]||(doc.meta.translations||{})[page]||'');
  const title=document.createElement('h3');title.textContent='第 '+page+' 页 · '+(view==='source'?'可选择原文':view==='bilingual'?'原文 / 中文对照':'中文译文');paper.appendChild(title);
  if(view==='source'||view==='bilingual'){const src=document.createElement('div');src.className='source';src.textContent=source||'本页未提取到可选择文字（可能是扫描版 PDF）';paper.appendChild(src);}
  if(view!=='source'){const zh=document.createElement('div');zh.className='translation';zh.textContent=translation||'本页尚未生成 AI 译文。';paper.appendChild(zh);}if(superseded())return;els.body.appendChild(paper);
}
async function openReadingProject(project) {
  if(document.body.classList.contains('office-mode'))await closeOffice();
  if(!project)return;
  rememberWorkspaceRecent('reading','project:'+project.path);
  if(DRAW_FILE||DRAW_ROOT)await closeDrawEditor(true);
  READING_PROJECT_CURRENT=project.path;READING_DIR_OPEN.add(project.path);saveReadingDirs();
  document.body.classList.add('reading-mode');$('reading-title').textContent=project.name;$('reading-project-context').textContent=[project.description,(project.tags||[]).map((tag)=>'#'+tag).join(' ')].filter(Boolean).join(' · ');renderReadingList();renderReadingProjectTabs();
  if(!project.children||!project.children.length){READING_SLOTS=['',''];READING_CURRENT='';updateReadingColumnLayout();await Promise.all([renderReadingSlot(0),renderReadingSlot(1)]);renderReadingFragments();readingStatus('空阅读项目 · 点击“＋ 片段”添加 PDF、Office 文档、网页、Markdown 或代码');return;}
  const original=project.children.find((item)=>item.kind==='pdf'&&item.role==='original');
  const translated=project.children.find((item)=>item.kind==='pdf'&&item.role==='translation');
  const bilingual=project.children.find((item)=>item.kind==='pdf'&&item.role==='bilingual');
  const first=original||translated||bilingual||project.children[0],second=null;
  READING_SLOTS=[first.path,second?second.path:''];READING_CURRENT=first.path;READING_ACTIVE_SLOT=0;updateReadingColumnLayout();
  readingSlotElements(0).view.value='original';readingSlotElements(1).view.value='original';
  renderReadingList();renderReadingProjectTabs();readingStatus('正在打开项目片段…');
  /* 两侧都要有标注文档：PDF 拿分页文本，Markdown 拿摘录列表（面板的数据源）。 */
  const docs=[first,second].filter(Boolean).filter((item,index,all)=>['pdf','markdown'].includes(item.kind)&&all.findIndex((v)=>v.path===item.path)===index);await Promise.all(docs.map((item)=>ensureReadingDoc(item.path)));
  for(let slot=0;slot<2;slot++){const doc=READING_DOCS.get(READING_SLOTS[slot]);if(doc){readingSlotElements(slot).page.value=doc.meta.page||1;readingSlotElements(slot).view.value=['original','source','translation','bilingual'].includes(doc.meta.view)?doc.meta.view:'original';}}
  await Promise.all([renderReadingSlot(0),renderReadingSlot(1)]);renderReadingFragments();
  readingStatus(first&&first.kind==='html'?'HTML 网页 · 左侧编辑源码，右侧自动渲染并自动保存':project.count+' 个片段 · 拖动上方片段到右侧可并排阅读'+(translated?' · 已匹配中文 PDF':bilingual?' · 已匹配双语 PDF':' · 可使用 AI 生成译文'));
}
async function openReading(path,slot) {
  if(document.body.classList.contains('office-mode'))await closeOffice();
  rememberWorkspaceRecent('reading',path);
  if(DRAW_FILE||DRAW_ROOT)await closeDrawEditor(true);
  const fragment=readingFragment(path);READING_PROJECT_CURRENT=readingProjectFor(path);READING_CURRENT=path;READING_ACTIVE_SLOT=slot==null?0:slot;READING_SLOTS[READING_ACTIVE_SLOT]=path;
  updateReadingColumnLayout();
  const project=READING_PROJECT_INDEX.get(READING_PROJECT_CURRENT);document.body.classList.add('reading-mode');$('reading-title').textContent=project?project.name:(READING_PROJECT_CURRENT||readingBase(path));$('reading-project-context').textContent=project?[project.description,(project.tags||[]).map((tag)=>'#'+tag).join(' ')].filter(Boolean).join(' · '):'';renderReadingList();renderReadingProjectTabs();readingStatus(fragment&&fragment.kind!=='pdf'?'正在打开项目片段…':'正在解析 PDF…');
  if(fragment&&fragment.kind!=='pdf'){
    /* Markdown 的摘录挂在它自己的标注文档上，渲染右侧面板前必须先把这份文档取回来；
       代码 / HTML 没有可摘录的正文，保持原样。 */
    if(fragment.kind==='markdown')await ensureReadingDoc(path);
    await renderReadingSlot(READING_ACTIVE_SLOT);renderReadingFragments();readingStatus(['markdown','code','html'].includes(fragment.kind)?readingRoleLabel(fragment)+' · 编辑内容会自动保存':readingRoleLabel(fragment)+' · 阅读模式');return;}
  const doc=await ensureReadingDoc(path);const primary=readingSlotElements(READING_ACTIVE_SLOT);primary.page.value=doc.meta.page||1;const roleView=fragment&&fragment.kind==='pdf'?(fragment.role==='translation'?'translation':fragment.role==='bilingual'?'bilingual':'original'):'original';primary.view.value=doc.meta.view&&doc.meta.view!=='original'?doc.meta.view:roleView;
  await renderReadingSlot(READING_ACTIVE_SLOT);renderReadingFragments();readingStatus(doc.error?doc.error:(doc.pageCount+' 页 · 可选择文字保存摘录'),!!doc.error);
}
function closeReading(){document.body.classList.remove('reading-mode');READING_CURRENT='';READING_PROJECT_CURRENT='';$('reading-project-context').textContent='';renderReadingList();renderReadingProjectTabs();}
function activeReadingDoc(){const path=READING_SLOTS[READING_ACTIVE_SLOT]||READING_CURRENT,direct=READING_DOCS.get(path);if(direct)return direct;const project=readingProjectFor(path)||READING_PROJECT_CURRENT;for(const slotPath of READING_SLOTS){const doc=READING_DOCS.get(slotPath);if(doc&&(!project||readingProjectFor(slotPath)===project))return doc;}const node=READING_PROJECT_INDEX.get(project),pdf=node&&node.children&&node.children.find((item)=>item.kind==='pdf'&&item.role==='original');return pdf?READING_DOCS.get(pdf.path):null;}
function currentReadingPage(){return Number(readingSlotElements(READING_ACTIVE_SLOT).page.value)||1;}
async function setReadingPage(slot,value){const doc=READING_DOCS.get(READING_SLOTS[slot]);const max=(doc&&doc.pageCount)||9999;readingSlotElements(slot).page.value=Math.max(1,Math.min(max,Number(value)||1));READING_ACTIVE_SLOT=slot;await renderReadingSlot(slot);renderReadingFragments();}
async function translateReadingText(text,label) {
  const cfg=aiCfg();if(!cfg.url||!cfg.model)throw new Error('请先在右侧 AI 助手设置 API URL 与模型');
  const chunks=[];let rest=String(text||'').trim();while(rest){let at=Math.min(6000,rest.length);if(at<rest.length){const boundary=Math.max(rest.lastIndexOf('\n',at),rest.lastIndexOf('. ',at));if(boundary>2000)at=boundary+1;}chunks.push(rest.slice(0,at));rest=rest.slice(at).trim();}
  const out=[];for(let i=0;i<chunks.length;i++){readingStatus((label||'AI 翻译')+' '+(i+1)+'/'+chunks.length+'…');const r=await api('/api/ai/chat',{url:cfg.url,key:cfg.key,model:cfg.model,timeoutMs:300000,messages:[{role:'system',content:'你是专业技术文献翻译。把英文准确翻译为简体中文，保留标题层级、公式编号、变量、API、代码、引用编号和专业术语；只输出译文，不解释。'},{role:'user',content:chunks[i]}]});if(!r.ok)throw new Error(r.error||'AI 翻译失败');out.push(r.content.trim());}
  return out.join('\n\n');
}
function selectedReadingText(){
  /* 源码模式是 textarea：window.getSelection() 拿不到里面的选区，只能读它自己的 selectionStart/End。 */
  const active=document.activeElement;
  if(active&&active.tagName==='TEXTAREA'&&active.classList.contains('reading-md-source')){const start=active.selectionStart,end=active.selectionEnd;return start!=null&&end!=null&&end>start?String(active.value.slice(start,end)).trim():'';}
  const sel=window.getSelection();if(!sel||sel.isCollapsed)return '';const node=sel.anchorNode&&(sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode);if(!node)return '';
  /* .reading-md-preview-content / .reading-md-block 分别是 Markdown 的阅读视图与区块编辑器 */
  if(node.closest&&node.closest('.reading-paper,.reading-web-article,.reading-md-preview-content,.reading-md-block'))return String(sel.toString()).trim();
  const layer=node.closest&&node.closest('.pdf-text-layer');if(layer){const v=window.__readingPdfViewer;if(!v||!v.alive||!v.alive())return '';/* ⚠️ 原来是裸调 `selectedRectsIn(layer)` ✗ —— 那个函数在 app-pdf.js 的 **IIFE 里** ✓，
   根本没暴露成全局 ✓ → PDF 里划词取文本时抛 ReferenceError ✗
   （「加生词 / 翻译 / 摘录」在 PDF 上就全断了 ✗，而且报错在控制台，界面只说「请先划选」✗）。
   app-pdf.js 第 21 行**专门**导出了 `window.__pdfSelectedRectsIn` ✓，用它 ✓。 */
const selected=window.__pdfSelectedRectsIn?window.__pdfSelectedRectsIn(layer):null;return selected?selected.text:'';}return '';}
async function requireSelectableReadingText(action){
  const text=selectedReadingText();if(text)return text;const els=readingSlotElements(READING_ACTIVE_SLOT),fragment=readingFragment(READING_SLOTS[READING_ACTIVE_SLOT]);
  if(fragment&&fragment.kind==='markdown'){readingStatus('请先在 Markdown 正文（区块编辑或阅读视图）里划选要'+action+'的文字',true);return '';}
  if(fragment&&fragment.kind==='pdf'){
    const viewer=window.__readingPdfViewer;
    if(window.__pdfViewerReady&&viewer&&viewer.alive&&viewer.alive()){readingStatus('请在 PDF 页面上直接划选文字后再点击“'+action+'”',true);return '';}
    if(els.view.value==='original'){els.view.value='source';await renderReadingSlot(READING_ACTIVE_SLOT);readingStatus('已切换到“可选文本”：请重新划选文字，再点击“'+action+'”',true);return '';}
  }
  readingStatus('请先在“可选文本”或“双语对照”区域划选文字',true);return '';
}
async function translateReadingPage() {
  if(READING_TRANSLATING)return;const doc=activeReadingDoc(),page=currentReadingPage();if(!doc||!doc.pages||!doc.pages[page-1])return readingStatus('本页没有可翻译文字',true);
  READING_TRANSLATING=true;try{doc.meta.translations[page]=await translateReadingText(doc.pages[page-1],'翻译第 '+page+' 页');await saveReadingDoc(doc);await renderReadingSlot(READING_ACTIVE_SLOT);if(READING_SLOTS[1-READING_ACTIVE_SLOT]===doc.path)await renderReadingSlot(1-READING_ACTIVE_SLOT);renderReadingFragments();readingStatus('第 '+page+' 页译文已保存');loadReadings(true);}catch(error){readingStatus(error.message,true);}finally{READING_TRANSLATING=false;}
}
async function translateReadingSelection() {
  if(READING_TRANSLATING)return;const text=await requireSelectableReadingText('译选中');if(!text)return;const doc=activeReadingDoc(),page=currentReadingPage();
  READING_TRANSLATING=true;try{const translation=await translateReadingText(text,'翻译选中片段');doc.meta.fragments.unshift({id:cryptoRandomId(),page,source:text,translation,note:'',createdAt:Date.now()});await saveReadingDoc(doc);renderReadingFragments();readingStatus('选中片段已翻译并保存');}catch(error){readingStatus(error.message,true);}finally{READING_TRANSLATING=false;}
}
function cryptoRandomId(){return (self.crypto&&self.crypto.randomUUID)?self.crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);}
async function translateReadingAll() {
  if(READING_TRANSLATING)return;const doc=activeReadingDoc();if(!doc||!doc.pages||!doc.pages.length)return;if(!await askConfirm({ title:'逐页 AI 翻译', message:'将逐页调用 AI 翻译 '+doc.pages.length+' 页并保存，可随时保留已完成进度。继续吗？', okLabel:'继续' }))return;
  READING_TRANSLATING=true;try{for(let page=1;page<=doc.pages.length;page++){if(doc.meta.translations[page]||!doc.pages[page-1])continue;doc.meta.translations[page]=await translateReadingText(doc.pages[page-1],'全文翻译 '+page+'/'+doc.pages.length);await saveReadingDoc(doc);}await Promise.all([renderReadingSlot(0),renderReadingSlot(1)]);readingStatus('全文翻译完成 · 可切换中文版或双语版');loadReadings(true);}catch(error){readingStatus('已保存完成部分 · '+error.message,true);}finally{READING_TRANSLATING=false;}
}
async function addReadingFragment() {
  const fragment=readingFragment(READING_SLOTS[READING_ACTIVE_SLOT]);if(fragment&&fragment.kind==='web'){const reader=READING_WEB_READERS.get(fragment.path);if(reader)return reader.saveSelection(false);}
  if(fragment&&fragment.kind==='markdown'){const text=await requireSelectableReadingText('摘录');if(!text)return;return saveReadingMarkdownExcerpt(fragment.path,text);}
  const doc=activeReadingDoc(),text=await requireSelectableReadingText('摘录'),page=currentReadingPage();if(!doc||!text)return;
  let rects=[],scale=1;
  const v=window.__readingPdfViewer;
  if(v&&v.alive&&v.alive()){
    const rec=v.pages.find(p=>p.pageNum===page);
    const srf=window.__pdfSelectedRectsIn;
    if(rec&&rec.textLayer&&srf){
      const sr=srf(rec.textLayer);
      if(sr&&sr.rects&&sr.rects.length){rects=sr.rects;scale=v.scale;}
    }
  }
  await savePdfSelectionPayload({path:doc.path,page,text,rects,scale},false);if(window.hidePdfToolbar)window.hidePdfToolbar();
}
/* ── Markdown 摘录 ──
   Markdown 片段没有 PDF 那套「页码 + 矩形」坐标，所以只记两样东西：摘录文本本身，以及选区之前
   最近的那个标题。定位时按文本在渲染结果里查找，命中就滚动并把焦点环圈上去；找不到就如实说
   「原文已被改写」，不假装成功。摘录统一写进该 Markdown 自己的 .codescope 标注文件，.md 原文不动。 */
/* 摘录卡片第一行原来只写「§ 最近的那一级标题」。同一个 H1 下面往往挂着好几条摘录，
   于是每张卡片看起来一模一样，分不清谁是谁。这里改成标题层级链（H1 › H2 › H3）。
   刻意不靠 DOM 定位：面板经常在区块编辑器挂载完成之前就渲染了，那时正文 DOM 还不存在，
   靠 DOM 算出来的层级链会整批退化成「§ 最近一级标题」。改为按「保存时记下的锚点」在
   markdown 源码的标题列表里定位，纯字符串计算，任何时刻都算得出来。 */
function readingMarkdownExcerptTrail(doc,item){
  const record=doc&&doc.path?READING_TEXT_DOCS.get(doc.path):null,content=record&&record.content;
  if(!content)return [];
  const entries=readingMarkdownHeadings(content);if(!entries.length)return [];
  let index=-1;
  if(item.anchor){const slug=String(item.anchor);index=entries.findIndex((entry)=>readingMarkdownSlug(entry.text)===slug);}
  if(index<0){
    const at=content.indexOf(String(item.source||''));
    if(at>=0){const line=content.slice(0,at).split('\n').length-1;entries.forEach((entry,position)=>{if(entry.line<=line)index=position;});}
  }
  if(index<0){const text=String(item.anchorText||'');index=entries.findIndex((entry)=>entry.text===text);}
  if(index<0)return [];
  const stack=[];
  for(let position=0;position<=index;position++){
    const level=Number(entries[position].level)||0,text=String(entries[position].text||'').replace(/\s+/g,' ').trim();
    if(!level||!text)continue;
    while(stack.length&&stack[stack.length-1].level>=level)stack.pop();
    stack.push({level,text});
  }
  return stack;
}
function readingMarkdownView(path){  const slot=Math.max(0,READING_SLOTS.findIndex((value)=>value===path));
  const col=document.querySelector('.reading-col[data-slot="'+slot+'"]'),shell=col&&col.querySelector('.reading-text-shell.markdown');
  if(!col||!shell)return null;
  const mode=shell.dataset.mdMode||'live';
  const source=col.querySelector('.reading-md-source'),preview=col.querySelector('.reading-md-preview'),block=col.querySelector('.reading-md-block');
  return {col,shell,mode,source,preview,block,isPreview:mode==='preview',container:mode==='preview'?preview:block};
}
function readingMarkdownSelectionAnchor(path){
  const view=readingMarkdownView(path);if(!view)return null;
  /* 源码模式：选区之前最后一个 ATX 标题 */
  if(view.mode==='edit'){
    const start=view.source&&view.source.selectionStart;if(start==null)return null;
    let found='';
    for(const match of String(view.source.value||'').slice(0,start).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm))found=match[1].replace(/[`*_~]/g,'').trim();
    return found?{text:found,slug:readingMarkdownSlug(found)}:null;
  }
  if(!view.container)return null;
  const sel=window.getSelection();if(!sel||!sel.rangeCount||sel.isCollapsed)return null;
  const start=sel.getRangeAt(0).startContainer;
  const heads=[...view.container.querySelectorAll(view.isPreview?'.reading-md-preview-content h1,.reading-md-preview-content h2,.reading-md-preview-content h3,.reading-md-preview-content h4,.reading-md-preview-content h5,.reading-md-preview-content h6':'.ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6')];
  /* 标题按文档顺序排列，取最后一个「排在选区起点之前（或正好包住它）」的 */
  let found=null;
  for(const head of heads){if(head===start||head.contains(start)||(head.compareDocumentPosition(start)&Node.DOCUMENT_POSITION_FOLLOWING))found=head;else break;}
  const text=found?String(found.textContent||'').trim():'';
  return text?{text,slug:readingMarkdownSlug(text)}:null;
}
async function saveReadingMarkdownExcerpt(path,text){
  const doc=await ensureReadingDoc(path),anchor=readingMarkdownSelectionAnchor(path);
  const item={id:cryptoRandomId(),kind:'markdown',page:1,source:String(text).trim(),translation:'',note:'',createdAt:Date.now()};
  if(anchor){item.anchor=anchor.slug;item.anchorText=anchor.text;}
  if(!Array.isArray(doc.meta.fragments))doc.meta.fragments=[];
  doc.meta.fragments.unshift(item);await saveReadingDoc(doc);renderReadingFragments();
  readingStatus('摘录已保存 · 可随时引用到 Markdown 笔记');
  return item;
}
/* 在渲染结果里按文本查找：先把所有文本节点拼成一条长串做一次 indexOf，再映射回 DOM 范围。
   这样即使摘录跨了加粗/链接等行内元素（DOM 里被拆成多个文本节点）也照样命中。 */
function readingFindTextRange(container,text){
  if(!container||!text)return null;
  const nodes=[],offsets=[];let joined='';
  const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT,null);
  for(let node=walker.nextNode();node;node=walker.nextNode()){nodes.push(node);offsets.push(joined.length);joined+=node.nodeValue||'';}
  const index=joined.indexOf(text);if(index<0)return null;
  const locate=(offset)=>{for(let i=nodes.length-1;i>=0;i--)if(offsets[i]<=offset)return {node:nodes[i],offset:offset-offsets[i]};return null;};
  const start=locate(index),stop=locate(index+text.length);if(!start||!stop)return null;
  const range=document.createRange();
  try{range.setStart(start.node,start.offset);range.setEnd(stop.node,stop.offset);}catch(_){return null;}
  return range;
}
function locateReadingMarkdownExcerpt(doc,item){
  const view=readingMarkdownView(doc.path),source=String(item.source||'');if(!view||!source)return false;
  /* 源码模式是纯文本域，没法在里面圈出一段高亮，只能把光标与选区落到那段文字上。 */
  if(view.mode==='edit'){
    const value=String(view.source&&view.source.value||''),at=value.indexOf(source);if(at<0)return false;
    view.source.focus();view.source.setSelectionRange(at,at+source.length);
    const lines=value.slice(0,at).split('\n').length-1;
    view.source.scrollTop=Math.max(0,lines*18-view.source.clientHeight/2);
    return true;
  }
  const range=readingFindTextRange(view.container,source);if(!range)return false;
  scrollReadingMarkdownHeading(view.container,range,view.isPreview);
  /* 焦点环每帧重新解析目标，编辑器重绘也跟得上；传 Range 即可，它同样有 getBoundingClientRect。 */
  flashReadingMarkdownHeading(()=>readingFindTextRange(view.container,source));
  return true;
}
function renderReadingFragments() {
  const host=$('reading-frag-list'),doc=activeReadingDoc(),items=(doc&&doc.meta.fragments)||[];host.replaceChildren();$('reading-frag-count').textContent=items.length;
  /* 稳定序号：按创建先后编号。列表是新摘录在最前，若按下标编号，每加一条旧卡片都会集体改名。 */
  const order=new Map([...items].sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0)).map((entry,index)=>[String(entry.id),index+1]));
  if(!items.length){const e=document.createElement('div');e.className='draw-empty';e.textContent='在 PDF、网页或 Markdown 正文里划选文字后点击“摘录”，集中管理重要定义、结论和引用。';host.appendChild(e);scheduleReadingExcerptMarks();return;}
  for(const item of items){
    const web=!!item.url,markdown=item.kind==='markdown',card=document.createElement('div');card.className='reading-frag';card.dataset.fragmentId=String(item.id||'');
    const page=document.createElement('span');page.className='page';
    if(markdown){
      const trail=readingMarkdownExcerptTrail(doc,item).slice(-3).map((entry)=>entry.text);
      const label=trail.length?trail.join(' › '):String(item.anchorText||'Markdown 摘录');
      const no=document.createElement('span');no.className='frag-no';no.textContent='#'+(order.get(String(item.id))||'?');
      page.append(no,document.createTextNode(' § '+label.slice(0,72)));
    }else page.textContent=web?'网页 · '+String(item.webTitle||'原文').slice(0,38):'P.'+item.page;
    const src=document.createElement('div');src.className='src';src.textContent=item.source;card.append(page,src);
    if(item.translation){const zh=document.createElement('div');zh.className='zh';zh.textContent=item.translation;card.appendChild(zh);}
    const actions=document.createElement('div');actions.className='actions';const go=document.createElement('button');go.textContent='定位';go.onclick=async()=>{if(web){const reader=READING_WEB_READERS.get(doc.path);if(reader&&await reader.locate(item))return;readingStatus('网页定位信息已失效，可重新选择原文建立定位',true);return;}if(markdown){if(locateReadingMarkdownExcerpt(doc,item)){readingStatus('已定位到摘录位置');return;}readingStatus('原文里已经找不到这段摘录，可能已被改写',true);return;}if(!window.locateReadingFragment||!(await window.locateReadingFragment(doc,item)))setReadingPage(READING_ACTIVE_SLOT,item.page);};
    const cite=document.createElement('button');cite.textContent='↗ 引用';cite.title='引用到项目 Markdown 阅读笔记，并保留原文来源';cite.onclick=async()=>{try{await appendReadingQuoteToNote(doc,item);}catch(error){readingStatus(error.message,true);}};
    const note=document.createElement('button');note.innerHTML=csGlyphText(item.note?'✎ 笔记':'＋ 笔记');note.onclick=()=>startFragNoteEdit(card,doc,item);
    const del=document.createElement('button');del.textContent='删除';del.onclick=async()=>{doc.meta.fragments=items.filter(v=>v.id!==item.id);await saveReadingDoc(doc);renderReadingFragments();if(web)READING_WEB_READERS.get(doc.path)?.refreshMarks();if(window.refreshFragmentMarksAll)window.refreshFragmentMarksAll();};actions.append(go,cite,note,del);
    if(item.note){const n=document.createElement('div');n.className='frag-note zh md';n.title='点击编辑笔记（支持 Markdown 排版）';const pre=document.createElement('span');pre.className='fn-pre';pre.textContent='✎ ';const box=document.createElement('div');box.className='fn-md';box.innerHTML=renderMd(item.note)||'';n.append(pre,box);n.onclick=()=>startFragNoteEdit(card,doc,item);card.appendChild(n);}card.appendChild(actions);host.appendChild(card);
  }
  if(window.refreshFragmentMarksAll)window.refreshFragmentMarksAll();
  /* PDF 的页内标记由 refreshFragmentMarksAll 管；Markdown 的正文标记走这一条。 */
  scheduleReadingExcerptMarks();
}
function startFragNoteEdit(card, doc, item) {
  if (!card || !doc || !item) return;
  if (card.querySelector('textarea')) { card.querySelector('textarea').focus(); return; }
  const oldNote = card.querySelector('.frag-note'); if (oldNote) oldNote.remove();
  const ta = document.createElement('textarea'); ta.className = 'note-editor'; ta.placeholder = '直接在此处输入笔记…（回车保存，Esc 取消）'; ta.value = item.note || '';
  const row = document.createElement('div'); row.className = 'note-editor-row';
  const save = document.createElement('button'); save.className = 'primary'; save.textContent = '保存';
  const cancel = document.createElement('button'); cancel.textContent = '取消';
  row.append(save, cancel);
  const commit = async () => { const v = ta.value.trim(); item.note = v; await saveReadingDoc(doc); renderReadingFragments(); };
  save.onclick = (e) => { e.stopPropagation(); commit(); };
  cancel.onclick = (e) => { e.stopPropagation(); renderReadingFragments(); };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save.click(); }
    else if (e.key === 'Escape') { e.stopPropagation(); cancel.click(); }
  });
  ta.addEventListener('blur', () => setTimeout(() => { if (!card.contains(document.activeElement)) cancel.click(); }, 150));
  const actions = card.querySelector('.actions');
  card.insertBefore(ta, actions); card.insertBefore(row, actions);
  window.__fragNoteEditorActive = true;
  ta.focus();
}
async function importReadingFiles(files) {
  if(!files||!files.length)return;let folder=READING_IMPORT_PROJECT||READING_PROJECT_CURRENT;READING_IMPORT_PROJECT='';const projects=[...READING_PROJECT_INDEX.keys()];if(!folder){if(!projects.length)return readingStatus('请先创建一个阅读项目',true);const choice=await askText({ title:'选择阅读项目', message:'导入到哪个阅读项目？\n可选：'+projects.join('、'), value:projects[0], okLabel:'导入' });if(choice===null)return;folder=choice.trim();}if(!projects.includes(folder))return readingStatus('阅读项目不存在：'+folder,true);
  const supported=/\.(?:pdf|docx|xlsx|xls|csv|pptx|html|htm)$/i;let imported=0,lastPath='';for(let i=0;i<files.length;i++){const file=files[i];if(!supported.test(file.name)){readingStatus('已跳过不支持的文件：'+file.name,true);continue;}readingStatus('正在导入 '+(i+1)+'/'+files.length+' · '+file.name);const info=btoa(unescape(encodeURIComponent(JSON.stringify({name:file.name,folder}))));let response;try{response=await fetch('/api/readings/upload-stream',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-CodeScope-Reading':info},body:file});const result=await response.json();if(!result.ok)throw new Error(result.error);imported++;lastPath=result.path;}catch(error){readingStatus(error.message,true);return;}}
  if(!imported)return;READING_PROJECT_CURRENT=folder;READING_CURRENT=lastPath;saveReadingDirs();await loadReadings();readingStatus(imported+' 份资料已加入阅读项目');const project=READING_PROJECT_INDEX.get(folder);if(project){await openReadingProject(project);if(lastPath)await openReading(lastPath,READING_ACTIVE_SLOT);}
}
const READING_NEW_DEFAULTS={file:'',web:'网页资料',markdown:'阅读笔记.md',html:'阅读页面.html',c:'示例代码.c',h:'接口定义.h',cpp:'示例代码.cpp',python:'示例代码.py',javascript:'示例代码.js',typescript:'示例代码.ts',latex:'公式笔记.tex',text:'阅读记录.txt'};
function syncReadingNewFields(){const kind=$('reading-new-kind').value,file=kind==='file',web=kind==='web';$('reading-new-name').value=READING_NEW_DEFAULTS[kind]||'';$('reading-new-name').disabled=file;$('reading-new-name-label').textContent=web?'资料名称':'文件名';$('reading-new-url-label').classList.toggle('hidden',!web);$('reading-new-url').classList.toggle('hidden',!web);$('reading-new-url').disabled=!web;}
function addReadingProjectFragment(project){const dialog=$('reading-new-dialog'),select=$('reading-new-project');select.replaceChildren();for(const item of READING_PROJECT_INDEX.values()){const option=document.createElement('option');option.value=item.path;option.textContent=item.path;select.appendChild(option);}select.value=project&&project.path||READING_PROJECT_CURRENT||select.value;$('reading-new-kind').value='markdown';syncReadingNewFields();$('reading-new-url').value='';dialog.classList.add('open');$('reading-new-name').focus();$('reading-new-name').select();}
function closeReadingNewDialog(){$('reading-new-dialog').classList.remove('open');}
async function submitReadingNewFragment(){const project=$('reading-new-project').value,kind=$('reading-new-kind').value,name=$('reading-new-name').value.trim();if(!project)return readingStatus('请先创建阅读项目',true);if(kind==='file'){closeReadingNewDialog();READING_IMPORT_PROJECT=project;$('reading-file-input').click();return;}if(!name)return $('reading-new-name').focus();let result;if(kind==='web'){const url=$('reading-new-url').value.trim();if(!url)return $('reading-new-url').focus();result=await api('/api/readings/web/new',{project,title:name,url});}else result=await api('/api/readings/text/new',{project,name});if(!result.ok)return setStatus('err', result.error);closeReadingNewDialog();READING_PROJECT_CURRENT=project;await loadReadings();openReading(result.path,READING_ACTIVE_SLOT);}
function wireReadingPanel() {
  try{const saved=Number(localStorage.getItem('mc-reading-fragments-width'));if(saved>=240)$('reading-stage').style.setProperty('--reading-fragments-width',saved+'px');}catch(_){}
  $('pane-reading').classList.toggle('collapsed',!READING_OPEN);$('reading-head').onclick=()=>{READING_OPEN=!READING_OPEN;$('pane-reading').classList.toggle('collapsed',!READING_OPEN);try{localStorage.setItem('mc-reading-open',READING_OPEN?'1':'0');}catch(_){}};
  $('reading-import').onclick=(e)=>{e.stopPropagation();READING_IMPORT_PROJECT='';$('reading-file-input').click();};$('reading-file-input').onchange=(e)=>{importReadingFiles([...e.target.files]);e.target.value='';};
  $('reading-new-folder').onclick=(e)=>{e.stopPropagation();createReadingProject('');};$('reading-new-library-folder').onclick=(e)=>{e.stopPropagation();createReadingFolder('');};
  $('reading-new-kind').onchange=syncReadingNewFields;$('reading-new-cancel').onclick=closeReadingNewDialog;$('reading-new-submit').onclick=submitReadingNewFragment;$('reading-new-name').onkeydown=(e)=>{if(e.key==='Enter')submitReadingNewFragment();};$('reading-new-url').onkeydown=(e)=>{if(e.key==='Enter')submitReadingNewFragment();};$('reading-new-dialog').addEventListener('mousedown',(e)=>{if(e.target===$('reading-new-dialog'))closeReadingNewDialog();});
  $('reading-back').onclick=closeReading;
  $('reading-backlinks').onclick=showBacklinks;$('reading-copy-link').onclick=copyCurrentWorkspaceLink;
  $('reading-add-fragment').onclick=addReadingFragment;$('reading-translate-selection').onclick=translateReadingSelection;$('reading-translate-page').onclick=translateReadingPage;$('reading-translate-all').onclick=translateReadingAll;
  $('reading-frag-toggle').onclick=()=>{READING_FRAGMENTS_COLLAPSED=!READING_FRAGMENTS_COLLAPSED;syncReadingFragmentsPanel();};
  document.querySelectorAll('.reading-col').forEach((col)=>{const slot=Number(col.dataset.slot),els=readingSlotElements(slot);col.addEventListener('mousedown',()=>{READING_ACTIVE_SLOT=slot;READING_CURRENT=READING_SLOTS[slot]||READING_CURRENT;renderReadingProjectTabs();syncReadingTools();renderReadingFragments();});els.view.onchange=()=>renderReadingSlot(slot);els.page.onchange=()=>setReadingPage(slot,els.page.value);col.querySelector('.reading-prev').onclick=()=>setReadingPage(slot,Number(els.page.value)-1);col.querySelector('.reading-next').onclick=()=>setReadingPage(slot,Number(els.page.value)+1);col.querySelector('.reading-close-col').onclick=(e)=>{e.stopPropagation();closeReadingColumn(slot);};col.addEventListener('dragover',(e)=>{if(e.dataTransfer.types.includes('application/x-codescope-reading')){e.preventDefault();col.classList.add('drag-over');}});col.addEventListener('dragleave',()=>col.classList.remove('drag-over'));col.addEventListener('drop',(e)=>{e.preventDefault();col.classList.remove('drag-over');$('reading-columns').classList.remove('fragment-dragging');const path=e.dataTransfer.getData('application/x-codescope-reading');if(path)openReading(path,slot);});});
  const newColumnDrop=$('reading-new-column-drop');newColumnDrop.addEventListener('dragover',(e)=>{if(e.dataTransfer.types.includes('application/x-codescope-reading')){e.preventDefault();e.stopPropagation();}});newColumnDrop.addEventListener('drop',(e)=>{e.preventDefault();e.stopPropagation();$('reading-columns').classList.remove('fragment-dragging');const path=e.dataTransfer.getData('application/x-codescope-reading');if(path)openReading(path,1);});
  let resize=null;$('reading-divider').addEventListener('pointerdown',(e)=>{resize={x:e.clientX,left:$('reading-columns').getBoundingClientRect().left,width:$('reading-columns').getBoundingClientRect().width};$('reading-divider').setPointerCapture(e.pointerId);});$('reading-divider').addEventListener('pointermove',(e)=>{if(!resize)return;const pct=Math.max(22,Math.min(78,(e.clientX-resize.left)/resize.width*100));$('reading-stage').style.setProperty('--reading-left',pct+'%');});$('reading-divider').addEventListener('pointerup',()=>{resize=null;});
  let fragmentResize=null;const fragmentResizer=$('reading-fragments-resizer');fragmentResizer.tabIndex=0;fragmentResizer.addEventListener('pointerdown',(e)=>{const stageWidth=$('reading-stage').getBoundingClientRect().width;fragmentResize={x:e.clientX,width:$('reading-fragments').getBoundingClientRect().width,max:Math.max(240,Math.min(640,stageWidth-480))};fragmentResizer.classList.add('dragging');document.body.style.cursor='col-resize';document.body.style.userSelect='none';try{fragmentResizer.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();});window.addEventListener('pointermove',(e)=>{if(!fragmentResize)return;const width=Math.max(240,Math.min(fragmentResize.max,fragmentResize.width+fragmentResize.x-e.clientX));$('reading-stage').style.setProperty('--reading-fragments-width',Math.round(width)+'px');});const finishFragmentResize=()=>{if(!fragmentResize)return;const width=Math.round($('reading-fragments').getBoundingClientRect().width);fragmentResize=null;fragmentResizer.classList.remove('dragging');document.body.style.cursor='';document.body.style.userSelect='';try{localStorage.setItem('mc-reading-fragments-width',String(width));}catch(_){}};window.addEventListener('pointerup',finishFragmentResize);window.addEventListener('pointercancel',finishFragmentResize);window.addEventListener('blur',finishFragmentResize);fragmentResizer.addEventListener('keydown',(e)=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const current=$('reading-fragments').getBoundingClientRect().width,delta=e.key==='ArrowLeft'?24:-24,width=Math.max(240,Math.min(640,current+delta));$('reading-stage').style.setProperty('--reading-fragments-width',Math.round(width)+'px');try{localStorage.setItem('mc-reading-fragments-width',String(Math.round(width)));}catch(_){}e.preventDefault();});
  loadReadings(true);
}
window.addEventListener('DOMContentLoaded',wireReadingPanel);
