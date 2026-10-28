/*
 * 绘图 + XMind 渲染层（2026-10-28 从 app.js 抽出来的独立经典脚本）
 * ---------------------------------------------------------------------------
 *   为什么抽：同批拆分。这一段是 Excalidraw / Draw.io / 库 / XMind 工作簿的渲染与
 *     交互，对编辑器全局（CURRENT / CINDEX / EDITING / SNIPPETS / MONACO_EDITOR /
 *     SPLIT_EDITORS）同样**零引用** ✓，外部只用到 api / setStatus / csGlyphIcon 这些
 *     **函数声明** ✓。
 *   ⚠️ 加载顺序：本文件必须在 app.js **之前**、app-reading.js 之前/之后都行 ✓ ——
 *     顶层只有 let/const 字面量初始化 + window.__LIB_COUNT 赋值 + DOMContentLoaded 注册 ✓；
 *     而 app.js 顶层要直接取本文件的函数对象（比如别的面板接线）✓，所以 app.js 在后 ✓。
 *   ⚠️ 本文件里的 DRAW_* / XMIND_* / LIB_* 是**顶层 let/const** ✗（不是 window 属性 ✓）——
 *     xmind-interaction.js / app.js 都在运行时读它们 ✓，只要它们已初始化就不会 TDZ；
 *     所以别把本文件挪到 app.js 后面 ✗，那会让 app.js 顶层的立即执行代码踩 TDZ ✗。
 *   ⚠️ 必须是经典脚本（无 IIFE / 无 ESM）：理由同 app-reading.js ✓。
 *   
 */

/* ------------------------- 绘图（Excalidraw / Draw.io，文件存于 vault/drawings/） ------------------------- */
let DRAWINGS = [];            // [{name,size,updated}]
let DRAW_API = null;          // 绘图引擎实例（原来只赋值没声明 ✗：非严格模式静默建全局，严格模式直接抛）
let DRAW_FILE = null;         // 当前打开的绘图文件名
let DRAW_KIND = null;         // excalidraw | drawio | xmind
let DRAW_PENDING = null;      // 待保存的最新 Excalidraw 场景、{xml} 或 {workbook}
let DRAW_SAVE_T = 0;          // 防抖定时器
let DRAW_ROOT = null;         // React 根（Excalidraw）
let DRAW_DIRTY = false;
let EXCAL_PROMISE = null;     // loader 懒加载 promise
let DRAWIO_FRAME = null;
let DRAWIO_XML = '';
const DRAWIO_ORIGIN = 'https://embed.diagrams.net';
let DRAW_OPEN = (() => { try { return localStorage.getItem('mc-draw-open') !== '0'; } catch (_) { return true; } })();
let DRAW_DIR_OPEN = (() => { try { return new Set(JSON.parse(localStorage.getItem('mc-draw-open-dirs') || '[]')); } catch (_) { return new Set(); } })();
let DRAW_ND_KIND = 'drawing';
function saveDrawDirs() { try { localStorage.setItem('mc-draw-open-dirs', JSON.stringify([...DRAW_DIR_OPEN])); } catch (_) {} }
function drawKind(n) { const value=String(n||'');return /\.drawio$/i.test(value)?'drawio':(/\.xmind$/i.test(value)?'xmind':(/\.canvas$/i.test(value)?'canvas':'excalidraw')); }
function drawBase(n) { return String(n).split('/').pop().replace(/\.(?:excalidraw|drawio|xmind|canvas)$/i, ''); }   // 显示名：路径 → 文件名（不含扩展）
/* ---- 库（Library）：与本绘图共享同一套编辑器，库文件存于 vault/libraries/*.excalidrawLibrary ---- */
let LIB_SAVE_T = 0;            // 库改动防抖定时器
let LIB_POLL_T = 0;            // 文件夹轮询定时器
let LIB_POLL_SIG = '';         // 上次轮询快照（排除本地自写文件）
let LIB_LAST_IDS = '';         // 上次已加载 item id 快照（用于判断是否需要 updateLibrary）
window.__LIB_COUNT = 0;        // 测试/调试：当前库 item 数
const LIB_APP_FILE = 'local.excalidrawLibrary';   // 应用内改动的自写文件名（轮询忽略它，避免写读循环）

function drawName(n) { return String(n).replace(/\.(?:excalidraw|drawio|xmind)$/i, ''); }

function loadExcalLoader() {
  if (window.ExcalLoader) return Promise.resolve(window.ExcalLoader);
  if (EXCAL_PROMISE) return EXCAL_PROMISE;
  EXCAL_PROMISE = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/excal-loader.min.js';
    const fail = (message) => { EXCAL_PROMISE = null; reject(new Error(message)); };
    // 关键：任何失败路径都要清空缓存的 Promise，否则一次失败会被永久缓存，之后每次点击都静默失败
    s.onload = () => (window.ExcalLoader ? resolve(window.ExcalLoader) : fail('Excalidraw 未正确加载'));
    s.onerror = () => fail('Excalidraw 资源加载失败');
    setTimeout(() => { if (!window.ExcalLoader) fail('Excalidraw 加载超时（请检查 /vendor/excal-loader.min.js 是否可访问）'); }, 20000);
    document.head.appendChild(s);
  });
  return EXCAL_PROMISE;
}

/* 绘图编辑器加载失败时，在主区给出可见说明与重试入口 */
function showDrawLoadError(message) {
  DRAW_LOAD_FAILED = true;
  const host = $('excal-root');
  if (!host) return;
  host.style.display = 'block';
  host.innerHTML = '<div class="draw-load-error">'
    + '<b>绘图编辑器未能加载</b>'
    + '<p>' + String(message || '未知原因') + '</p>'
    + '<p class="draw-load-hint">编辑器依赖本地资源 <code>/vendor/excal-loader.min.js</code>。可先点重试；仍失败请刷新页面（⌘R）。</p>'
    + '<button id="draw-load-retry">重试</button></div>';
  const retry = $('draw-load-retry');
  if (retry) retry.onclick = () => { host.innerHTML = ''; if (DRAW_FILE) openDrawing(DRAW_FILE); };
}

function setDrawStatus(txt, cls) {
  const el = $('draw-ed-status');
  if (el) { el.textContent = txt; el.className = 'draw-status ' + (cls || ''); }
}

// 归一化待持久化/加载的 appState：live 状态里的 collaborators 是 Map 态对象，回灌会崩 Excalidraw；
// massCode 的 .excalidraw 文件本就无该字段，落盘时剔除（与官方格式一致）
function sanitizeScene(scene) {
  const as = scene && scene.appState && typeof scene.appState === 'object' ? JSON.parse(JSON.stringify(scene.appState)) : {};
  delete as.collaborators; delete as.collaboratorCount;
  return { elements: (scene && Array.isArray(scene.elements) ? scene.elements : []), appState: as, files: (scene && scene.files) || {} };
}

async function saveDrawing() {
  clearTimeout(DRAW_SAVE_T); DRAW_SAVE_T = 0;
  if (!DRAW_FILE || !DRAW_PENDING) return;
  const data = DRAW_PENDING; DRAW_PENDING = null;
  const body = DRAW_KIND === 'drawio' ? { xml: data.xml || '' } : (DRAW_KIND === 'xmind' ? { workbook:data.workbook } : sanitizeScene(data));
  const r = await api('/api/drawings/save', { name: DRAW_FILE, data: body });
  if (r.ok) {
    DRAW_DIRTY = !!DRAW_PENDING;
    setDrawStatus(DRAW_PENDING ? '仍有改动待保存…' : '已保存 ' + new Date().toTimeString().slice(0, 8), DRAW_PENDING ? 'dirty' : 'ok');
  } else {
    DRAW_DIRTY = true;
    if (!DRAW_PENDING) DRAW_PENDING = data; // 不用较旧请求覆盖请求期间产生的新内容
    setDrawStatus('保存失败：' + (r.error || '未知错误'), 'err');
  }
}

function sendDrawio(message) {
  if (!DRAWIO_FRAME || !DRAWIO_FRAME.contentWindow) return;
  DRAWIO_FRAME.contentWindow.postMessage(JSON.stringify(message), DRAWIO_ORIGIN);
}

function openDrawioEditor(xml) {
  const root=$('drawio-root');root.innerHTML='';root.style.display='block';$('excal-root').style.display='none';
  const frame=document.createElement('iframe');
  frame.title='Draw.io · '+drawBase(DRAW_FILE);
  frame.referrerPolicy='no-referrer';
  frame.allow='clipboard-read; clipboard-write; fullscreen';
  const dark=document.documentElement.dataset.theme==='light'?0:1;
  frame.src=DRAWIO_ORIGIN+'/?embed=1&proto=json&spin=1&libraries=1&themes=1&noExitBtn=1&saveAndExit=0&modified=0&ui=kennedy&dark='+dark;
  frame.addEventListener('error',()=>setDrawStatus('Draw.io 加载失败，请检查网络', 'err'));
  DRAWIO_FRAME=frame;DRAWIO_XML=String(xml||'');DRAW_PENDING=null;DRAW_DIRTY=false;root.appendChild(frame);
  setDrawStatus('正在连接 Draw.io…','');
  setTimeout(()=>{
    const status=$('draw-ed-status');
    if(DRAWIO_FRAME===frame&&status&&status.textContent==='正在连接 Draw.io…')setDrawStatus('Draw.io 连接超时，请检查网络后重开','err');
  },12000);
}

function onDrawioMessage(event) {
  const frame=DRAWIO_FRAME;
  if (!frame || DRAW_KIND!=='drawio' || event.source!==frame.contentWindow || event.origin!==DRAWIO_ORIGIN) return;
  let msg;try{msg=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch(_){return;}
  if(!msg||typeof msg!=='object')return;
  if(msg.event==='init'){
    sendDrawio({action:'load',xml:DRAWIO_XML,autosave:1,modified:'未保存',title:drawBase(DRAW_FILE)});
    setDrawStatus('Draw.io 已连接','ok');
  } else if((msg.event==='autosave'||msg.event==='save')&&typeof msg.xml==='string'){
    DRAWIO_XML=msg.xml;DRAW_PENDING={xml:msg.xml};scheduleDrawSave();
    if(msg.event==='save')saveDrawing();
  } else if(msg.event==='load') {
    setDrawStatus('已加载 · 自动保存','ok');
  } else if(msg.event==='exit') {
    closeDrawEditor(true);
  } else if(msg.event==='openLink'&&typeof msg.href==='string') {
    try{const url=new URL(msg.href);if(['http:','https:'].includes(url.protocol))window.open(url.href,'_blank','noopener');}catch(_){}
  }
}

let DRAW_AI_BUSY=false;
const DRAW_TEST_PROMPT='绘制“基于扩展 SLIP 与强化学习的两轮足机器人控制框架”。画布横向 1600×950。左上用蓝色虚线圆角容器表示“1. 扩展SLIP模型（前馈生成）”，内部包含六状态有限状态机、状态转换条件、扩展SLIP动力学、飞行期前馈波形提升、前馈参考轨迹生成和SLIP到关节角/轮速映射。右上用绿色虚线圆角容器表示“2. 强化学习模块（反馈修正）”，内部包含观测向量、PPO Actor-Critic 网络、反馈动作修正、奖励函数和分阶段奖励权重。底部居中依次放置加权融合、PD控制器和两轮足机器人仿真环境。蓝色箭头表示前馈信号流，绿色表示反馈修正，紫色表示融合与控制，黑色表示环境交互，红色虚线表示奖励与反重置流。布局整齐、文字清晰、所有节点可编辑。';

function setDrawToolStatus(message,cls){const el=$('draw-tool-status');el.textContent=message||'';el.className=cls||'';}
function drawioExtractXml(value){
  let text=String(value||'').trim().replace(/^```(?:xml|drawio)?\s*/i,'').replace(/```\s*$/,'').trim();
  const fileStart=text.indexOf('<mxfile'), fileEnd=text.lastIndexOf('</mxfile>');
  if(fileStart>=0&&fileEnd>fileStart) return text.slice(fileStart,fileEnd+9);
  const modelStart=text.indexOf('<mxGraphModel'), modelEnd=text.lastIndexOf('</mxGraphModel>');
  if(modelStart>=0&&modelEnd>modelStart) return text.slice(modelStart,modelEnd+15);
  return text;
}
function validateDrawioXmlLocal(value){
  let xml=drawioExtractXml(value);
  if(!xml||xml.length>40000000) return {ok:false,error:'XML 为空或超过 40 MB'};
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)) return {ok:false,error:'不允许 DOCTYPE 或外部实体'};
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const parseError=doc.querySelector('parsererror');
  if(parseError) return {ok:false,error:'XML 语法错误：'+parseError.textContent.replace(/\s+/g,' ').trim().slice(0,180)};
  const root=doc.documentElement;
  if(!root||!['mxfile','mxGraphModel'].includes(root.nodeName)) return {ok:false,error:'根节点必须是 mxfile 或 mxGraphModel'};
  const models=root.nodeName==='mxGraphModel'?[root]:[...doc.querySelectorAll('mxGraphModel')];
  if(root.nodeName==='mxfile'&&!models.length) return {ok:true,xml,format:'compressed',cells:0,pages:doc.querySelectorAll('diagram').length};
  const cells=[...doc.querySelectorAll('mxCell')], ids=new Set();
  for(const cell of cells){const id=cell.getAttribute('id');if(!id)return {ok:false,error:'存在缺少 id 的 mxCell'};if(ids.has(id))return {ok:false,error:'mxCell id 重复：'+id};ids.add(id);}
  if(!ids.has('0')||!ids.has('1')) return {ok:false,error:'必须包含根单元 id=0 和默认层 id=1'};
  for(const cell of cells)for(const attr of ['parent','source','target']){const ref=cell.getAttribute(attr);if(ref&&!ids.has(ref))return {ok:false,error:'单元 '+cell.id+' 的 '+attr+' 引用了不存在的 id：'+ref};}
  if(root.nodeName==='mxGraphModel') xml='<mxfile host="CodeScope"><diagram id="page-1" name="Page-1">'+new XMLSerializer().serializeToString(root)+'</diagram></mxfile>';
  return {ok:true,xml,format:'uncompressed',cells:cells.length,pages:models.length};
}
function prettyDrawioXml(value){
  const checked=validateDrawioXmlLocal(value);if(!checked.ok)throw new Error(checked.error);
  const compact=checked.xml.replace(/>\s*</g,'><').trim();let depth=0,out=[];
  for(const token of compact.replace(/</g,'\n<').trim().split('\n')){
    if(/^<\//.test(token))depth=Math.max(0,depth-1);
    out.push('  '.repeat(depth)+token);
    if(/^<[^!?/][^>]*[^/]?>$/.test(token)&&!/^<(?:mxCell|mxGeometry)\b[^>]*\/>$/.test(token))depth++;
  }
  return out.join('\n');
}
function applyDrawioXml(value,label){
  const checked=validateDrawioXmlLocal(value);
  if(!checked.ok){setDrawToolStatus('❌ '+checked.error,'err');return false;}
  DRAWIO_XML=checked.xml;DRAW_PENDING={xml:checked.xml};scheduleDrawSave();
  sendDrawio({action:'load',xml:checked.xml,autosave:1,modified:'未保存',title:drawBase(DRAW_FILE)});
  $('draw-xml-source').value=checked.xml;
  setDrawToolStatus('✅ '+(label||'XML 已应用')+' · '+checked.pages+' 页 · '+checked.cells+' 个单元','ok');
  return true;
}
function showDrawTool(mode){
  if(DRAW_KIND!=='drawio')return;
  const dialog=$('draw-tool-dialog');dialog.classList.add('open');dialog.classList.toggle('xml-mode',mode==='xml');
  $('draw-tool-ai-tab').classList.toggle('on',mode!=='xml');$('draw-tool-xml-tab').classList.toggle('on',mode==='xml');
  $('draw-tool-title').textContent=mode==='xml'?'Draw.io XML 编辑器':'Draw.io 智能绘图';setDrawToolStatus('','');
  if(mode==='xml'){$('draw-xml-source').value=DRAWIO_XML;requestAnimationFrame(()=>$('draw-xml-source').focus());}
  else requestAnimationFrame(()=>$('draw-ai-prompt').focus());
}
function hideDrawTool(){if(!DRAW_AI_BUSY)$('draw-tool-dialog').classList.remove('open');}
function renderDrawToolSources(results){
  const box=$('draw-tool-sources');box.innerHTML='';
  for(const item of results||[]){const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=item.title||item.url;a.title=item.snippet||item.url;box.appendChild(a);}
}
async function generateDrawioWithAi(){
  const prompt=$('draw-ai-prompt').value.trim();if(!prompt||DRAW_AI_BUSY)return;
  const cfg=aiCfg();cfg.url=aiNormalizeUrl(cfg.url);
  if(!cfg.url||!cfg.model){setDrawToolStatus('❌ 请先在右侧 AI 面板的“设置”中配置 API URL 和模型','err');return;}
  DRAW_AI_BUSY=true;$('draw-ai-generate').disabled=true;setDrawToolStatus('正在准备绘图上下文…','');renderDrawToolSources([]);
  let generationTimer=0;
  try{
    let webContext='未启用联网检索。';
    if($('draw-ai-web').checked){
      if(!cfg.searchKey)throw new Error('已勾选联网检索，但尚未配置 Tavily/Brave Search API Key');
      setDrawToolStatus('正在联网检索相关架构图与表达经验…','');
      const web=await api('/api/ai/web-search',{provider:cfg.searchProvider||'tavily',key:cfg.searchKey,query:prompt+' draw.io 架构图 可视化 最佳实践'});
      if(!web.ok)throw new Error(web.error||'联网检索失败');
      renderDrawToolSources(web.results);
      webContext=(web.results||[]).map((item,i)=>'['+(i+1)+'] '+item.title+'\n'+item.snippet).join('\n\n').slice(0,10000);
    }
    const current=$('draw-ai-current').checked?DRAWIO_XML.slice(0,160000):'';
    const system='你是专业的 Draw.io 架构图生成器。只返回一个完整、未压缩、格式良好的 mxfile XML，不要 Markdown 围栏或解释。必须使用 mxGraphModel/root/mxCell/mxGeometry；包含 id=0 和 id=1，所有 id 唯一，parent/source/target 必须引用已有 id。节点使用明确坐标和尺寸，避免重叠；连接线使用 edge=1、edgeStyle=orthogonalEdgeStyle、rounded=1，标签中的 & < > 必须 XML 转义。优先使用统一圆角矩形、分组虚线容器、克制配色和清晰层级，保证在 1600×950 画布内完整可读。输出应能在 diagrams.net 中继续编辑。';
    const user='【绘图要求】\n'+prompt+'\n\n【联网经验摘要】\n'+webContext+(current?'\n\n【当前图 XML；请在其基础上修改并返回完整 XML】\n'+current:'');
    const generationStarted=Date.now();
    const updateGenerationStatus=()=>setDrawToolStatus('AI 正在生成可编辑 mxGraph XML… 已等待 '+Math.max(1,Math.round((Date.now()-generationStarted)/1000))+' 秒（复杂图可能需要 1–5 分钟）','');
    updateGenerationStatus();generationTimer=setInterval(updateGenerationStatus,1000);
    const result=await api('/api/ai/chat',{url:cfg.url,key:cfg.key,model:cfg.model,timeoutMs:300000,messages:[{role:'system',content:system},{role:'user',content:user}]});
    clearInterval(generationTimer);generationTimer=0;
    if(!result.ok)throw new Error(result.error||'AI 生成失败');
    const checked=validateDrawioXmlLocal(result.content);
    if(!checked.ok){$('draw-xml-source').value=drawioExtractXml(result.content);showDrawTool('xml');setDrawToolStatus('❌ AI 已返回内容，但结构校验失败：'+checked.error+'。可在 XML 页修正后应用。','err');return;}
    applyDrawioXml(checked.xml,'AI 图稿已生成并载入');
  }catch(error){setDrawToolStatus('❌ '+String((error&&error.message)||error),'err');}
  finally{if(generationTimer)clearInterval(generationTimer);DRAW_AI_BUSY=false;$('draw-ai-generate').disabled=false;}
}

/* ---- XMind：标准 .xmind 工作簿 + 可拖拽大纲 + Mind Elixir 编辑器 ---- */
let XMIND_WORKBOOK=null,XMIND_SHEET_INDEX=0,XMIND_SELECTED=null,XMIND_HISTORY=[],XMIND_HISTORY_INDEX=-1,XMIND_HISTORY_T=0,XMIND_RENDER_T=0,XMIND_MAP=null,XMIND_DRAG=null,XMIND_FOCUS=null,XMIND_COLLAPSED=new Set(),XMIND_THUMBNAIL='',XMIND_VIEW='edit',XMIND_SNAPSHOT_DIRTY=false,XMIND_NATIVE_SCALE=1,XMIND_NATIVE_X=0,XMIND_NATIVE_Y=0,XMIND_NATIVE_DRAG=null,XMIND_OFFICIAL=null,XMIND_OFFICIAL_LIB=null,XMIND_OFFICIAL_APPROVED=false,XMIND_EDITOR_LIB=null,XMIND_ENGINE_SYNCING=false,XMIND_TOOL_MODE='select',XMIND_CANVAS_PAN=null,XMIND_FLOAT_DRAG=null,XMIND_MULTI=new Set(),XMIND_FLOAT_RETRY=0,XMIND_OUTLINE_SIG='';
const XMIND_THEMES={zen:'XMind 极简',midnight:'深海下划线',classic:'经典卡片',forest:'森林圆角',sunset:'日落便签',violet:'紫罗兰胶囊',paper:'纸张手绘',spectrum:'彩虹分支',ocean:'海洋通透蓝',mint:'薄荷清新绿',rose:'蔷薇柔和粉',graphite:'石墨专业灰',solar:'日光暖金'};
function xmindClone(value){return JSON.parse(JSON.stringify(value));}
function xmindId(){return 'cs'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);}
function xmindThemeStorageKey(){return 'mc-xmind-theme:'+(DRAW_FILE||'default');}
function loadXmindTheme(){let theme='midnight';try{theme=localStorage.getItem(xmindThemeStorageKey())||localStorage.getItem('mc-xmind-theme:default')||'midnight';}catch(_){}setXmindTheme(theme);}
function renderXmindNativeTransform(){const stage=$('xmind-native-stage');if(stage)stage.style.transform='translate('+XMIND_NATIVE_X+'px,'+XMIND_NATIVE_Y+'px) scale('+XMIND_NATIVE_SCALE+')';}
function resetXmindNativeView(){XMIND_NATIVE_SCALE=1;XMIND_NATIVE_X=0;XMIND_NATIVE_Y=0;renderXmindNativeTransform();xmindUpdateViewportTools();}
function xmindMarkSnapshotDirty(){if(!XMIND_THUMBNAIL||XMIND_SNAPSHOT_DIRTY)return;XMIND_SNAPSHOT_DIRTY=true;const note=$('xmind-native-note');if(note){note.textContent='原貌为导入时快照';note.classList.add('warn');}}
function setXmindView(mode){
  const canNative=!!XMIND_THUMBNAIL&&XMIND_SHEET_INDEX===0;XMIND_VIEW=mode==='official'?'official':(mode==='native'&&canNative?'native':'edit');const nativeView=$('xmind-native-view'),officialView=$('xmind-official-view'),engine=$('xmind-engine'),svg=$('xmind-svg'),empty=$('xmind-empty');
  $('xmind-root').classList.toggle('native-mode',XMIND_VIEW==='native'||XMIND_VIEW==='official');
  $('xmind-view-native').disabled=!canNative;$('xmind-view-native').classList.toggle('on',XMIND_VIEW==='native');$('xmind-view-edit').classList.toggle('on',XMIND_VIEW==='edit');
  $('xmind-view-official').classList.toggle('on',XMIND_VIEW==='official');nativeView.style.display=XMIND_VIEW==='native'?'block':'none';officialView.style.display=XMIND_VIEW==='official'?'block':'none';engine.style.display=XMIND_VIEW==='edit'?'block':'none';svg.style.display='none';if(empty&&XMIND_VIEW!=='edit')empty.style.display='none';
  const note=$('xmind-native-note');if(note){note.textContent=XMIND_VIEW==='official'?'官方渲染 · 全部画布':(!XMIND_THUMBNAIL?'文件无原貌快照':(XMIND_SHEET_INDEX!==0?'原貌仅对应首张画布':(XMIND_SNAPSHOT_DIRTY?'原貌为导入时快照':'XMind 原始画布')));note.classList.toggle('warn',XMIND_VIEW!=='official'&&(XMIND_SNAPSHOT_DIRTY||XMIND_SHEET_INDEX!==0));}
  if(XMIND_VIEW==='native')resetXmindNativeView();else requestAnimationFrame(renderXmindPreview);requestAnimationFrame(xmindUpdateViewportTools);
}
async function openXmindOfficialView(){
  if(!DRAW_FILE||DRAW_KIND!=='xmind')return;if(!XMIND_OFFICIAL_APPROVED){$('xmind-official-consent').classList.remove('hidden');return;}
  setXmindView('official');const mount=$('xmind-official-host'),loading=$('xmind-official-loading');loading.style.display='grid';loading.textContent='正在连接 XMind 官方查看器…';setDrawStatus('正在加载 XMind 官方视图…','');
  try{
    if(!window.XMindEmbedViewer){if(!XMIND_OFFICIAL_LIB)XMIND_OFFICIAL_LIB=loadOptionalScript('/xmind-viewer/xmind-embed-viewer.js').catch(error=>{XMIND_OFFICIAL_LIB=null;throw error;});await XMIND_OFFICIAL_LIB;}if(!window.XMindEmbedViewer)throw new Error('官方查看器未正确加载');
    const response=await fetch('/api/drawings/file?name='+encodeURIComponent(DRAW_FILE),{cache:'no-store'});if(!response.ok)throw new Error('无法读取 XMind 原文件');const file=await response.arrayBuffer();
    const exported=window.XMindEmbedViewer,ViewerCtor=typeof exported==='function'?exported:(exported&&(exported.XMindEmbedViewer||exported.default));if(typeof ViewerCtor!=='function')throw new Error('官方查看器版本不兼容');
    mount.replaceChildren();XMIND_OFFICIAL=new ViewerCtor({el:mount,region:'cn',isPitchModeDisabled:true,styles:{width:'100%',height:'100%',border:'0'}});
    XMIND_OFFICIAL.addEventListener('map-ready',()=>{loading.style.display='none';setDrawStatus('XMind 官方视图已加载','ok');setTimeout(()=>{try{XMIND_OFFICIAL&&XMIND_OFFICIAL.setFitMap();}catch(_){}},80);});
    XMIND_OFFICIAL.addEventListener('sheet-switch',sheetId=>{const index=XMIND_WORKBOOK.findIndex(sheet=>sheet.id===sheetId);if(index>=0&&index!==XMIND_SHEET_INDEX){XMIND_SHEET_INDEX=index;XMIND_SELECTED=xmindRootTopic().id;renderXmindSheets();renderXmindOutline();}});
    XMIND_OFFICIAL.load(file);
    setTimeout(()=>{if(XMIND_VIEW==='official'&&loading.style.display!=='none')loading.textContent='正在等待 XMind 官方渲染引擎…';},3500);
  }catch(error){
    const detail=String(error&&error.message||error||'未知错误');console.error('[CodeScope] XMind 官方视图加载失败',error);loading.replaceChildren();const card=document.createElement('div');card.className='xmind-official-error';const title=document.createElement('strong');title.textContent='XMind 官方视图加载失败';const message=document.createElement('span');message.textContent=detail;const actions=document.createElement('div');actions.className='xmind-official-actions';const back=document.createElement('button');back.textContent=XMIND_THUMBNAIL?'返回原貌':'返回编辑';back.onclick=()=>setXmindView(XMIND_THUMBNAIL?'native':'edit');const retry=document.createElement('button');retry.textContent='重试';retry.className='primary';retry.onclick=openXmindOfficialView;actions.append(back,retry);card.append(title,message,actions);loading.append(card);setDrawStatus('官方视图加载失败：'+detail,'err');
  }
}
function xmindSheet(){return XMIND_WORKBOOK&&XMIND_WORKBOOK[XMIND_SHEET_INDEX];}
function xmindRootTopic(){const sheet=xmindSheet();return sheet&&sheet.rootTopic;}
function xmindChildren(topic,create=false){
  if(!topic)return[];
  if(create){if(!topic.children||typeof topic.children!=='object')topic.children={};if(!Array.isArray(topic.children.attached))topic.children.attached=[];}
  return topic.children&&Array.isArray(topic.children.attached)?topic.children.attached:[];
}
function xmindDetached(create=false){const root=xmindRootTopic();if(!root)return[];if(create){if(!root.children||typeof root.children!=='object')root.children={};if(!Array.isArray(root.children.detached))root.children.detached=[];}return root.children&&Array.isArray(root.children.detached)?root.children.detached:[];}
function xmindFind(id){
  let found=null;
  const walk=(topic,parent,depth,container,isDetached)=>{if(!topic||found)return;if(topic.id===id){found={topic,parent,depth,container,isDetached};return;}const children=xmindChildren(topic);for(const child of children)walk(child,topic,depth+1,children,isDetached);};
  const root=xmindRootTopic();walk(root,null,0,null,false);const detached=xmindDetached();for(const topic of detached)walk(topic,null,0,detached,true);return found;
}
function xmindContains(topic,id){if(!topic)return false;if(topic.id===id)return true;return xmindChildren(topic).some(child=>xmindContains(child,id));}
function xmindNormalize(){
  if(!XMIND_WORKBOOK)return;const seen=new Set();const walk=(topic)=>{if(!topic.id||seen.has(topic.id))topic.id=xmindId();seen.add(topic.id);topic.class=topic.class||'topic';topic.title=xmindPlainText(topic.title||'未命名主题');delete topic.codescopePosition;xmindChildren(topic,true).forEach(walk);};XMIND_WORKBOOK.forEach((sheet,index)=>{if(!sheet.id||seen.has(sheet.id))sheet.id=xmindId();seen.add(sheet.id);sheet.class=sheet.class||'sheet';sheet.title=xmindPlainText(sheet.title||('画布 '+(index+1)));if(sheet.rootTopic){walk(sheet.rootTopic);const detached=sheet.rootTopic.children&&Array.isArray(sheet.rootTopic.children.detached)?sheet.rootTopic.children.detached:[];detached.forEach(walk);}});
}
function xmindRecord(){
  if(!XMIND_WORKBOOK)return;const snapshot=JSON.stringify(XMIND_WORKBOOK);
  if(XMIND_HISTORY[XMIND_HISTORY_INDEX]===snapshot){xmindUpdateUndo();return;}
  XMIND_HISTORY=XMIND_HISTORY.slice(0,XMIND_HISTORY_INDEX+1);XMIND_HISTORY.push(snapshot);if(XMIND_HISTORY.length>100)XMIND_HISTORY.shift();XMIND_HISTORY_INDEX=XMIND_HISTORY.length-1;xmindUpdateUndo();
}
function xmindQueueRecord(){clearTimeout(XMIND_HISTORY_T);XMIND_HISTORY_T=setTimeout(xmindRecord,450);}
function xmindUpdateUndo(){const undo=$('xmind-undo'),redo=$('xmind-redo'),edit=XMIND_VIEW==='edit'&&!!XMIND_MAP;if(undo)undo.disabled=!edit||XMIND_HISTORY_INDEX<=0;if(redo)redo.disabled=!edit||XMIND_HISTORY_INDEX<0||XMIND_HISTORY_INDEX>=XMIND_HISTORY.length-1;const hit=xmindFind(XMIND_SELECTED),movable=!!(hit&&hit.container);['xmind-delete','xmind-delete-single','xmind-add-sibling','xmind-add-parent','xmind-to-floating'].forEach(id=>{if($(id))$(id).disabled=!edit||!movable;});if($('xmind-to-floating')&&hit&&hit.isDetached)$('xmind-to-floating').disabled=true;if($('xmind-add-child'))$('xmind-add-child').disabled=!edit;if($('xmind-add-floating'))$('xmind-add-floating').disabled=!edit;}
function renderXmindSheets(){
  const select=$('xmind-sheet-select');if(!select||!XMIND_WORKBOOK)return;select.innerHTML='';XMIND_WORKBOOK.forEach((sheet,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=sheet.title||('画布 '+(index+1));select.appendChild(option);});XMIND_SHEET_INDEX=Math.max(0,Math.min(XMIND_SHEET_INDEX,XMIND_WORKBOOK.length-1));select.value=String(XMIND_SHEET_INDEX);$('xmind-sheet-title').value=xmindSheet().title||('画布 '+(XMIND_SHEET_INDEX+1));$('xmind-delete-sheet').disabled=XMIND_WORKBOOK.length<=1;
}
function xmindChanged(record=true){
  xmindNormalize();if(record)xmindRecord();else xmindQueueRecord();
  xmindMarkSnapshotDirty();
  DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();renderXmindSheets();renderXmindOutline();scheduleXmindPreview();
}
function xmindUndo(direction){
  clearTimeout(XMIND_HISTORY_T);xmindRecord();const next=XMIND_HISTORY_INDEX+direction;if(next<0||next>=XMIND_HISTORY.length)return;
  XMIND_HISTORY_INDEX=next;XMIND_WORKBOOK=JSON.parse(XMIND_HISTORY[next]);XMIND_SHEET_INDEX=Math.min(XMIND_SHEET_INDEX,XMIND_WORKBOOK.length-1);if(!xmindFind(XMIND_SELECTED))XMIND_SELECTED=xmindRootTopic().id;xmindMarkSnapshotDirty();
  DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();renderXmindSheets();renderXmindOutline();scheduleXmindPreview();xmindUpdateUndo();
}
function xmindEditorTheme(id){
  const themes={
    midnight:{type:'dark',palette:['#7dd3fc','#a78bfa','#34d399','#fbbf24','#fb7185'],root:'#315f9b',rootBorder:'#78a9ff',main:'#182536',bg:'#0b1017',color:'#d9e3ef'},
    classic:{type:'light',palette:['#316fc5','#6f42c1','#0f8a68','#d97706','#c2415d'],root:'#316fc5',rootBorder:'#22599f',main:'#ffffff',bg:'#f4f7fb',color:'#243248'},
    forest:{type:'dark',palette:['#52d6a4','#81c784','#7dd3fc','#d5e86c','#f4b860'],root:'#176b50',rootBorder:'#52d6a4',main:'#10271e',bg:'#09140f',color:'#dcf7eb'},
    sunset:{type:'dark',palette:['#ff9e64','#ff7b72','#e0af68','#bb9af7','#7dcfff'],root:'#9a4f2c',rootBorder:'#ff9e64',main:'#2b1b15',bg:'#17100d',color:'#fff0e5'},
    violet:{type:'dark',palette:['#bb9af7','#7aa2f7','#9ece6a','#e0af68','#f7768e'],root:'#5d4892',rootBorder:'#bb9af7',main:'#211a31',bg:'#120f1c',color:'#f0e9ff'},
    paper:{type:'light',palette:['#9b6d32','#607d3b','#517792','#985b68','#8064a2'],root:'#f0dfbf',rootBorder:'#9b6d32',main:'#fffaf0',bg:'#f5f0e5',color:'#382e24'},
    spectrum:{type:'dark',palette:['#ff7b72','#7ee787','#7dd3fc','#d2a8ff','#ffa657'],root:'#405d91',rootBorder:'#7dd3fc',main:'#171f2e',bg:'#0c1018',color:'#eef4ff'}
  },t=themes[id]||themes.midnight;
  return{name:'CodeScope '+id,type:t.type,palette:t.palette,cssVar:{'--node-gap-x':'32px','--node-gap-y':'10px','--main-gap-x':'62px','--main-gap-y':'24px','--root-radius':'14px','--main-radius':'11px','--root-color':t.type==='light'?'#29231c':'#ffffff','--root-bgcolor':t.root,'--root-border-color':t.rootBorder,'--main-color':t.color,'--main-bgcolor':t.main,'--main-bgcolor-transparent':t.main,'--topic-padding':'7px 12px','--color':t.color,'--bgcolor':t.bg,'--selected':t.rootBorder,'--accent-color':t.rootBorder,'--panel-color':t.color,'--panel-bgcolor':t.main,'--panel-border-color':t.rootBorder,'--map-padding':'48px 64px'}};
}
function xmindEditorDirection(ME){const structure=String(xmindRootTopic()?.structureClass||'');return /org-chart|org\.xmind\.ui\.org/i.test(structure)?ME.DOWN:/logic\.left/i.test(structure)?ME.LEFT:/logic\.right/i.test(structure)?ME.RIGHT:ME.SIDE;}
function xmindDefaultFloatingPosition(index,total){const order=index===0?0:(index%2?Math.ceil(index/2):-Math.ceil(index/2));return{x:330+Math.floor(index/6)*90,y:order*190-(total>1?0:20)};}
function xmindRenderFloatingTopics(){
  const engine=$('xmind-engine');if(!engine||!XMIND_MAP||XMIND_VIEW!=='edit')return;const items=xmindFloatingItems(),origin=xmindFloatingOrigin();if(!origin){if(items.length&&XMIND_FLOAT_RETRY<15){XMIND_FLOAT_RETRY++;setTimeout(xmindRenderFloatingTopics,60);}return;}XMIND_FLOAT_RETRY=0;document.getElementById('xmind-floating-layer')?.remove();if(!items.length)return;const layer=document.createElement('div');layer.id='xmind-floating-layer';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='xmind-floating-links';layer.appendChild(svg);const points=new Map(),palette=xmindThemePalette().palette;
  // ⚠️ 图层必须挂在 engine **外面** ✗ 挂在里面会被引擎重渲染清掉、还会在 blur 回调里抛 NotFoundError ✓
  items.forEach(item=>{const x=origin.x+item.position.x*origin.scale,y=origin.y+item.position.y*origin.scale,color=palette[item.colorIndex%palette.length];points.set(item.topic.id,{x,y,parent:item.parent&&item.parent.id,color,direction:item.direction});const node=document.createElement('div');node.className='xmind-floating-node'+(item.root?' root':'')+((item.topic.id===XMIND_SELECTED||(XMIND_MULTI instanceof Set&&XMIND_MULTI.has(String(item.topic.id))))?' selected':'');node.dataset.topicId=item.topic.id;node.style.left=x+'px';node.style.top=y+'px';node.style.setProperty('--free-scale',String(origin.scale));node.style.setProperty('--branch-color',color);const label=document.createElement('span');label.className='xmind-floating-title';label.textContent=item.topic.title||'自由主题';const badge=document.createElement('span');badge.className='xmind-floating-badge';badge.textContent=item.root?'自由导图':'L'+item.depth;node.append(label,badge);node.onclick=event=>{event.stopPropagation();engine.focus({preventScroll:true});};node.ondblclick=event=>{event.preventDefault();event.stopPropagation();xmindBeginFloatingEdit(item.topic.id);};layer.appendChild(node);});(document.getElementById('xmind-float-overlay')||engine.parentElement.appendChild(Object.assign(document.createElement('div'),{id:'xmind-float-overlay'}))).appendChild(layer);
  points.forEach((point,id)=>{if(!point.parent||!points.has(point.parent))return;const parent=points.get(point.parent),parentNode=layer.querySelector('.xmind-floating-node[data-topic-id="'+CSS.escape(String(point.parent))+'"]'),childNode=layer.querySelector('.xmind-floating-node[data-topic-id="'+CSS.escape(String(id))+'"]'),direction=point.direction||1,startX=parent.x+direction*(parentNode?.offsetWidth||80)*origin.scale*.5,endX=point.x-direction*(childNode?.offsetWidth||80)*origin.scale*.5,path=document.createElementNS('http://www.w3.org/2000/svg','path'),curve=Math.max(36,Math.abs(endX-startX)*.5),c1=startX+direction*curve,c2=endX-direction*curve;path.setAttribute('d','M '+startX+' '+parent.y+' C '+c1+' '+parent.y+', '+c2+' '+point.y+', '+endX+' '+point.y);path.setAttribute('stroke',point.color);path.dataset.parent=point.parent;path.dataset.child=id;svg.appendChild(path);});
}
function xmindBeginFloatingEdit(id=XMIND_SELECTED){const hit=xmindFind(id),node=$('xmind-floating-layer')?.querySelector('.xmind-floating-node[data-topic-id="'+CSS.escape(String(id||''))+'"]'),label=node&&node.querySelector('.xmind-floating-title');if(!hit||!hit.isDetached||!label)return false;XMIND_SELECTED=hit.topic.id;const original=hit.topic.title||'';label.contentEditable='true';label.spellcheck=false;label.focus({preventScroll:true});const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(label);selection.removeAllRanges();selection.addRange(range);let done=false;const finish=save=>{if(done)return;done=true;label.onkeydown=null;label.onblur=null;label.contentEditable='false';const next=save?(label.innerText.replace(/\r/g,'').replace(/\n+$/,'')||'自由主题'):null;setTimeout(()=>{if(save&&next!==original){hit.topic.title=next;xmindChanged();}else xmindRenderFloatingTopics();const ae=document.activeElement;if(!ae||ae===document.body||ae===label)$('xmind-engine')?.focus({preventScroll:true});},0);};label.onkeydown=event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish(false);}else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();finish(true);}};label.onblur=()=>finish(true);return true;}
function xmindAddFloatingAt(clientX,clientY){if(!XMIND_MAP||XMIND_VIEW!=='edit')return;const origin=xmindFloatingOrigin(),engine=$('xmind-engine'),rect=engine.getBoundingClientRect(),scale=origin?.scale||1,fromPointer=Number.isFinite(clientX)&&Number.isFinite(clientY),fallback=xmindDefaultFloatingPosition(xmindDetached().length,xmindDetached().length+1),x=fromPointer?(clientX-rect.left-(origin?.x||rect.width/2))/scale:fallback.x,y=fromPointer?(clientY-rect.top-(origin?.y||rect.height/2))/scale:fallback.y,topic=xmindNewTopic('自由主题');topic.position={x,y};topic.structureClass='org.xmind.ui.logic.right';xmindDetached(true).push(topic);xmindSheet().floatingTopicFlexible=true;XMIND_SELECTED=topic.id;xmindChanged();setTimeout(()=>{xmindRenderFloatingTopics();xmindBeginFloatingEdit(topic.id);},180);}
function xmindDetachFloatingAt(id,position){const hit=xmindFind(id);if(!hit||!hit.isDetached||!hit.parent||!hit.container)return false;const index=hit.container.indexOf(hit.topic);if(index<0)return false;hit.container.splice(index,1);hit.topic.position={x:Number(position.x)||0,y:Number(position.y)||0};hit.topic.structureClass=hit.topic.structureClass||'org.xmind.ui.logic.right';xmindDetached(true).push(hit.topic);XMIND_SELECTED=hit.topic.id;xmindChanged();return true;}
function xmindAttachFloating(sourceId,targetId){const source=xmindFind(sourceId),target=xmindFind(targetId);if(!source||!source.isDetached||!source.container||!target||sourceId===targetId||xmindContains(source.topic,targetId))return false;const index=source.container.indexOf(source.topic);if(index<0)return false;source.container.splice(index,1);delete source.topic.position;xmindChildren(target.topic,true).push(source.topic);XMIND_SELECTED=source.topic.id;xmindChanged();return true;}
function xmindMarkdown(){
  const lines=[];const clean=(value)=>String(value||'未命名主题').split(/\r?\n/).map(line=>line.replace(/([\\`*_{}\[\]<>])/g,'\\$1').trim()).filter(Boolean).join('<br>')||'未命名主题';
  const walk=(topic,depth)=>{if(depth<=6)lines.push('#'.repeat(Math.max(1,depth))+' '+clean(topic.title));else lines.push('  '.repeat(depth-7)+'- '+clean(topic.title));for(const child of xmindChildren(topic))walk(child,depth+1);};
  const root=xmindRootTopic();if(root)walk(root,1);return lines.join('\n');
}
function scheduleXmindPreview(){clearTimeout(XMIND_RENDER_T);XMIND_RENDER_T=setTimeout(renderXmindPreview,120);}
function xmindPreorderTopics(){const topics=[];(function walk(topic){if(!topic)return;topics.push(topic);xmindChildren(topic).forEach(walk);})(xmindRootTopic());return topics;}
function xmindPreviewOrdinal(node){const path=String(node.dataset.path||'').split('.');return Math.max(0,(Number(path[path.length-1])||1)-1);}
function decorateXmindPreview(){
  const svg=$('xmind-svg'),preview=$('xmind-preview');if(!svg||!preview||DRAW_KIND!=='xmind')return;const topics=xmindPreorderTopics(),nodes=[...svg.querySelectorAll('.markmap-node')];
  nodes.forEach((node,index)=>{const topic=topics[xmindPreviewOrdinal(node)]||topics[index];if(!topic)return;node.dataset.topicId=topic.id;node.setAttribute('role','button');node.setAttribute('aria-label','主题：'+(topic.title||'未命名主题'));node.classList.toggle('xmind-node-selected',topic.id===XMIND_SELECTED);
    if(node.dataset.xmindWired)return;node.dataset.xmindWired='1';
    node.addEventListener('click',(event)=>{const editable=event.target.closest('[contenteditable="true"]');if(editable)return;event.preventDefault();event.stopPropagation();XMIND_SELECTED=node.dataset.topicId;renderXmindOutlineSelection();preview.focus({preventScroll:true});},true);
    node.addEventListener('dblclick',(event)=>{event.preventDefault();event.stopPropagation();XMIND_SELECTED=node.dataset.topicId;renderXmindOutlineSelection();xmindStartPreviewEdit(node.dataset.topicId);},true);
  });
}
function xmindStartPreviewEdit(id=XMIND_SELECTED){
  const hit=xmindFind(id);if(!hit)return xmindFocusTitle();XMIND_SELECTED=hit.topic.id;renderXmindOutlineSelection();const node=$('xmind-svg').querySelector('.markmap-node[data-topic-id="'+CSS.escape(hit.topic.id)+'"]'),text=node&&node.querySelector('.markmap-foreign > div > div');if(!text)return xmindFocusTitle();
  const original=hit.topic.title||'';let finished=false;node.classList.add('xmind-node-editing');text.contentEditable='true';text.spellcheck=false;text.focus({preventScroll:true});const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(text);selection.removeAllRanges();selection.addRange(range);
  const finish=(save,action='')=>{if(finished)return;finished=true;text.onkeydown=null;text.onblur=null;text.contentEditable='false';node.classList.remove('xmind-node-editing');if(save){const next=text.innerText.replace(/\r/g,'').replace(/\n+$/,'')||'未命名主题';if(next!==original){hit.topic.title=next;xmindNormalize();xmindRecord();DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();renderXmindOutline();}}if(action==='sibling')xmindAddSibling();else if(action==='child')xmindAddChild();else if(action==='unindent')xmindUnindent();else renderXmindPreview();};
  text.onkeydown=(event)=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish(false);return;}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();finish(true,'sibling');return;}if(event.key==='Tab'){event.preventDefault();finish(true,event.shiftKey?'unindent':'child');}};text.onblur=()=>finish(true);
}
function xmindResizeTitle(input){input.style.height='26px';input.style.height=Math.min(112,Math.max(26,input.scrollHeight))+'px';input.style.overflowY=input.scrollHeight>112?'auto':'hidden';}
function renderXmindOutline(){
  const box=$('xmind-outline');if(!box||DRAW_KIND!=='xmind')return;const root=xmindRootTopic();if(!root)return;const outlineSig=(()=>{const out=[String(XMIND_SHEET_INDEX)],walk=t=>{if(!t)return;out.push(t.id,t.title||'',XMIND_COLLAPSED.has(t.id)?'0':'1');(xmindChildren(t)||[]).forEach(walk);};walk(root);(xmindDetached()||[]).forEach(walk);return out.join('~');})();if(outlineSig===XMIND_OUTLINE_SIG)return;XMIND_OUTLINE_SIG=outlineSig;box.innerHTML='';
  const walk=(topic,parent,depth,isDetached=false,host=box)=>{
    const group=document.createElement('div');group.className='xmind-tree-group';group.dataset.topicId=topic.id;const row=document.createElement('div');row.className='xmind-row'+(isDetached?' floating':'')+(topic.id===XMIND_SELECTED?' selected':'');row.dataset.id=topic.id;row.dataset.depth=String(depth);row.style.setProperty('--cs-depth',String(depth));row.draggable=topic!==root;
    const toggle=document.createElement('button');toggle.className='xmind-toggle'+(xmindChildren(topic).length?'':' empty');toggle.innerHTML=XMIND_COLLAPSED.has(topic.id)? csGlyphIcon('▸') : csGlyphIcon('▾');toggle.title=XMIND_COLLAPSED.has(topic.id)?'展开子主题':'收起子主题';toggle.onclick=(event)=>{event.stopPropagation();if(XMIND_COLLAPSED.has(topic.id))XMIND_COLLAPSED.delete(topic.id);else XMIND_COLLAPSED.add(topic.id);renderXmindOutline();};
    const grip=document.createElement('button');grip.className='xmind-grip';grip.textContent='⠇';grip.title=topic===root?'中心主题':(isDetached&&!parent?'拖动自由导图':'拖拽调整层级或顺序');grip.disabled=topic===root;
    const input=document.createElement('textarea');input.rows=1;input.className='xmind-title';input.value=topic.title||'';input.setAttribute('aria-label','主题名称');input.onfocus=()=>{XMIND_SELECTED=topic.id;renderXmindOutlineSelection();};input.oninput=()=>{topic.title=input.value;xmindResizeTitle(input);DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();scheduleXmindPreview();xmindQueueRecord();};input.onblur=xmindRecord;
    const level=document.createElement('span');level.className='xmind-depth';level.textContent=isDetached?(depth===0?'自由':'F'+depth):(depth===0?'中心':'L'+depth);
    row.append(toggle,grip,input,level);requestAnimationFrame(()=>xmindResizeTitle(input));row.onclick=(event)=>{if(event.target!==input){XMIND_SELECTED=topic.id;renderXmindOutlineSelection();}};
    row.addEventListener('dragstart',(event)=>{if(topic===root){event.preventDefault();return;}XMIND_DRAG=topic.id;row.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-codescope-xmind',topic.id);});
    row.addEventListener('dragend',()=>{XMIND_DRAG=null;document.querySelectorAll('.xmind-row').forEach(node=>node.classList.remove('dragging','drop-before','drop-after','drop-child'));});
    row.addEventListener('dragover',(event)=>{const source=XMIND_DRAG||event.dataTransfer.getData('application/x-codescope-xmind');if(!source||source===topic.id||xmindContains(xmindFind(source)?.topic,topic.id))return;event.preventDefault();const rect=row.getBoundingClientRect(),ratio=(event.clientY-rect.top)/Math.max(1,rect.height),mode=ratio<.27?'before':(ratio>.73?'after':'child');row.classList.remove('drop-before','drop-after','drop-child');row.classList.add('drop-'+mode);row.dataset.dropMode=mode;});
    row.addEventListener('dragleave',()=>row.classList.remove('drop-before','drop-after','drop-child'));
    row.addEventListener('drop',(event)=>{event.preventDefault();event.stopPropagation();const source=XMIND_DRAG||event.dataTransfer.getData('application/x-codescope-xmind'),mode=row.dataset.dropMode||'child';xmindMove(source,topic.id,mode);});
    group.appendChild(row);host.appendChild(group);if(!XMIND_COLLAPSED.has(topic.id)&&xmindChildren(topic).length){const children=document.createElement('div');children.className='xmind-tree-children';group.appendChild(children);for(const child of xmindChildren(topic))walk(child,topic,depth+1,isDetached,children);}
  };walk(root,null,0,false,box);const detached=xmindDetached();if(detached.length){const section=document.createElement('div');section.className='xmind-outline-section';section.textContent='自由导图 · '+detached.length;box.appendChild(section);detached.forEach(topic=>walk(topic,null,0,true,box));}xmindUpdateUndo();
  if(XMIND_FOCUS){const target=box.querySelector('.xmind-row[data-id="'+CSS.escape(XMIND_FOCUS)+'"] .xmind-title');XMIND_FOCUS=null;if(target)requestAnimationFrame(()=>{target.focus();target.select();});}
}
function xmindSetOutlineWidth(value,persist=true){const workspace=$('xmind-root')?.querySelector('.xmind-workspace');if(!workspace)return;const max=Math.max(300,workspace.clientWidth*.62),width=Math.max(238,Math.min(max,Number(value)||340));workspace.style.setProperty('--xmind-outline-width',Math.round(width)+'px');$('xmind-outline-resizer')?.setAttribute('aria-valuenow',String(Math.round(width)));if(persist)try{localStorage.setItem('mc-xmind-outline-width',String(Math.round(width)));}catch(_){} }
function xmindRestoreOutlineWidth(){let width=340;try{width=Number(localStorage.getItem('mc-xmind-outline-width'))||340;}catch(_){}xmindSetOutlineWidth(width,false);}
function xmindNewTopic(title='新主题'){return{id:xmindId(),class:'topic',title,children:{attached:[]}};}
function xmindAddSheet(){const number=XMIND_WORKBOOK.length+1;XMIND_WORKBOOK.push({id:xmindId(),class:'sheet',title:'画布 '+number,rootTopic:{...xmindNewTopic('中心主题'),structureClass:'org.xmind.ui.logic.right'}});XMIND_SHEET_INDEX=XMIND_WORKBOOK.length-1;XMIND_SELECTED=xmindRootTopic().id;xmindChanged();}
function xmindDeleteSheet(){if(!XMIND_WORKBOOK||XMIND_WORKBOOK.length<=1)return;XMIND_WORKBOOK.splice(XMIND_SHEET_INDEX,1);XMIND_SHEET_INDEX=Math.max(0,Math.min(XMIND_SHEET_INDEX,XMIND_WORKBOOK.length-1));XMIND_SELECTED=xmindRootTopic().id;xmindChanged();}
function xmindAddChild(){if(xmindEditorAction('child'))return;const hit=xmindFind(XMIND_SELECTED)||xmindFind(xmindRootTopic()?.id);if(!hit)return;const topic=xmindNewTopic();xmindChildren(hit.topic,true).push(topic);XMIND_COLLAPSED.delete(hit.topic.id);XMIND_SELECTED=topic.id;XMIND_FOCUS=topic.id;xmindChanged();if(hit.isDetached)setTimeout(()=>{xmindRenderFloatingTopics();xmindBeginFloatingEdit(topic.id);},180);}
function xmindAddSibling(before=false){if(!before&&xmindEditorAction('sibling'))return;const hit=xmindFind(XMIND_SELECTED);if(!hit||!hit.container)return xmindAddChild();const list=hit.container,topic=xmindNewTopic(hit.isDetached&& !hit.parent?'自由主题':'新主题'),index=list.indexOf(hit.topic);if(hit.isDetached&&!hit.parent){const next=xmindDefaultFloatingPosition(xmindDetached().length,xmindDetached().length+1);topic.position=next;topic.structureClass='org.xmind.ui.logic.right';}list.splice(index+(before?0:1),0,topic);XMIND_SELECTED=topic.id;XMIND_FOCUS=topic.id;xmindChanged();if(hit.isDetached)setTimeout(()=>{xmindRenderFloatingTopics();xmindBeginFloatingEdit(topic.id);},180);}
function xmindAddParent(){if(xmindEditorAction('parent'))return;const hit=xmindFind(XMIND_SELECTED);if(!hit||!hit.container)return;const list=hit.container,index=list.indexOf(hit.topic),topic=xmindNewTopic(hit.isDetached&&!hit.parent?'自由父主题':'新父主题');topic.children.attached.push(hit.topic);if(hit.isDetached&&!hit.parent){topic.position={...(hit.topic.position||{x:260,y:0})};delete hit.topic.position;topic.structureClass='org.xmind.ui.logic.right';}list.splice(index,1,topic);XMIND_SELECTED=topic.id;XMIND_FOCUS=topic.id;xmindChanged();}
function xmindDelete(){if(window.__csXmindDeleteMulti&&window.__csXmindDeleteMulti())return;if(xmindEditorAction('delete'))return;const hit=xmindFind(XMIND_SELECTED);if(!hit||!hit.container)return;const index=hit.container.indexOf(hit.topic);if(index>=0)hit.container.splice(index,1);XMIND_SELECTED=hit.parent?.id||xmindRootTopic().id;xmindChanged();}
function xmindDeleteSingle(){const hit=xmindFind(XMIND_SELECTED);if(!hit||!hit.container)return;const index=hit.container.indexOf(hit.topic);if(index<0)return;const children=xmindChildren(hit.topic);if(hit.isDetached&&!hit.parent)children.forEach((child,i)=>{if(!child.position){const p=hit.topic.position||{x:0,y:0};child.position={x:Number(p.x||0)+150,y:Number(p.y||0)+(i-(children.length-1)/2)*70};}child.structureClass=child.structureClass||'org.xmind.ui.logic.right';});hit.container.splice(index,1,...children);XMIND_SELECTED=hit.parent?.id||xmindRootTopic().id;xmindChanged();}
function xmindReorder(delta){const hit=xmindFind(XMIND_SELECTED);if(!hit||!hit.container)return;const list=hit.container,index=list.indexOf(hit.topic),next=index+delta;if(index<0||next<0||next>=list.length)return;[list[index],list[next]]=[list[next],list[index]];xmindChanged();}
function xmindUnindent(){const hit=xmindFind(XMIND_SELECTED);if(!hit||!hit.parent||!hit.container)return;const parentHit=xmindFind(hit.parent.id);if(!parentHit||!parentHit.container)return;const index=hit.container.indexOf(hit.topic);if(index<0)return;hit.container.splice(index,1);const parentIndex=parentHit.container.indexOf(hit.parent);parentHit.container.splice(parentIndex+1,0,hit.topic);if(parentHit.isDetached&&!parentHit.parent&&!hit.topic.position){const p=hit.parent.position||{x:0,y:0};hit.topic.position={x:Number(p.x||0)+24,y:Number(p.y||0)+74};}xmindChanged();}
function xmindToggleFold(all=false){
  if(all){const foldable=[];(function walk(topic){if(xmindChildren(topic).length)foldable.push(topic.id);xmindChildren(topic).forEach(walk);})(xmindRootTopic());const shouldFold=foldable.some(id=>!XMIND_COLLAPSED.has(id));XMIND_COLLAPSED=shouldFold?new Set(foldable):new Set();}
  else{const hit=xmindFind(XMIND_SELECTED);if(!hit||!xmindChildren(hit.topic).length)return;if(XMIND_COLLAPSED.has(hit.topic.id))XMIND_COLLAPSED.delete(hit.topic.id);else XMIND_COLLAPSED.add(hit.topic.id);}
  renderXmindOutline();
}
function xmindSelectVisible(delta){const rows=[...document.querySelectorAll('#xmind-outline .xmind-row')],index=rows.findIndex(row=>row.dataset.id===XMIND_SELECTED),next=rows[Math.max(0,Math.min(rows.length-1,(index<0?0:index)+delta))];if(!next)return;XMIND_SELECTED=next.dataset.id;renderXmindOutlineSelection();next.scrollIntoView({block:'nearest'});}
function xmindSelectParent(){const hit=xmindFind(XMIND_SELECTED);if(!hit)return;if(xmindChildren(hit.topic).length&&!XMIND_COLLAPSED.has(hit.topic.id)){XMIND_COLLAPSED.add(hit.topic.id);renderXmindOutline();return;}if(hit.parent){XMIND_SELECTED=hit.parent.id;renderXmindOutlineSelection();}}
function xmindSelectChild(){const hit=xmindFind(XMIND_SELECTED);if(!hit)return;if(XMIND_COLLAPSED.has(hit.topic.id)){XMIND_COLLAPSED.delete(hit.topic.id);renderXmindOutline();return;}const child=xmindChildren(hit.topic)[0];if(child){XMIND_SELECTED=child.id;renderXmindOutlineSelection();}}
function xmindFocusTitle(){if(xmindEditorAction('edit'))return;const row=document.querySelector('.xmind-row[data-id="'+CSS.escape(XMIND_SELECTED||'')+'"]'),input=row&&row.querySelector('.xmind-title');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}
function xmindMove(sourceId,targetId,mode){
  const source=xmindFind(sourceId),target=xmindFind(targetId);if(!source||!source.container||!target||sourceId===targetId||xmindContains(source.topic,targetId))return;
  const old=source.container,oldIndex=old.indexOf(source.topic);if(oldIndex<0)return;old.splice(oldIndex,1);
  if(mode==='child'){xmindChildren(target.topic,true).push(source.topic);XMIND_COLLAPSED.delete(target.topic.id);}
  else{const refreshed=xmindFind(targetId);if(!refreshed||!refreshed.container){old.splice(oldIndex,0,source.topic);return;}const list=refreshed.container,index=list.indexOf(refreshed.topic);list.splice(index+(mode==='after'?1:0),0,source.topic);}
  XMIND_SELECTED=sourceId;xmindChanged();
}
function openXmindEditor(workbook,thumbnail=''){
  if(XMIND_MAP&&typeof XMIND_MAP.destroy==='function'){try{XMIND_MAP.destroy();}catch(_){}}XMIND_WORKBOOK=xmindClone(workbook);XMIND_SHEET_INDEX=0;xmindNormalize();XMIND_SELECTED=xmindRootTopic().id;XMIND_HISTORY=[JSON.stringify(XMIND_WORKBOOK)];XMIND_HISTORY_INDEX=0;XMIND_MAP=null;XMIND_COLLAPSED=new Set();XMIND_THUMBNAIL=String(thumbnail||'');XMIND_SNAPSHOT_DIRTY=false;XMIND_TOOL_MODE='select';XMIND_CANVAS_PAN=null;XMIND_FLOAT_DRAG=null;
  $('xmind-root').style.display='flex';$('drawio-root').style.display='none';$('excal-root').style.display='none';$('draw-ai-btn').style.display='none';$('draw-xml-btn').style.display='none';
  $('xmind-native-image').src=XMIND_THUMBNAIL;loadXmindTheme();xmindRestoreOutlineWidth();renderXmindSheets();renderXmindOutline();setXmindView(XMIND_THUMBNAIL?'native':'edit');setDrawStatus(XMIND_THUMBNAIL?'XMind 原貌已加载 · 可切换编辑':'XMind 已加载 · 自动保存','ok');
}
function closeXmindEditor(){clearTimeout(XMIND_HISTORY_T);clearTimeout(XMIND_RENDER_T);if(XMIND_MAP&&typeof XMIND_MAP.destroy==='function'){try{XMIND_MAP.destroy();}catch(_){}}XMIND_WORKBOOK=null;XMIND_SHEET_INDEX=0;XMIND_SELECTED=null;XMIND_HISTORY=[];XMIND_HISTORY_INDEX=-1;XMIND_MAP=null;XMIND_DRAG=null;XMIND_COLLAPSED=new Set();XMIND_THUMBNAIL='';XMIND_VIEW='edit';XMIND_SNAPSHOT_DIRTY=false;XMIND_NATIVE_DRAG=null;XMIND_OFFICIAL=null;XMIND_OFFICIAL_APPROVED=false;XMIND_TOOL_MODE='select';XMIND_CANVAS_PAN=null;XMIND_FLOAT_DRAG=null;$('xmind-outline').innerHTML='';$('xmind-engine').replaceChildren();$('xmind-svg').innerHTML='';$('xmind-native-image').removeAttribute('src');$('xmind-official-host').replaceChildren();$('xmind-official-loading').style.display='grid';$('xmind-official-loading').textContent='正在连接 XMind 官方查看器…';$('xmind-official-consent').classList.add('hidden');$('xmind-theme-menu').classList.add('hidden');$('xmind-shortcuts').classList.add('hidden');$('xmind-more')?.removeAttribute('open');$('xmind-root').style.display='none';}

function scheduleDrawSave() {
  DRAW_DIRTY = true; setDrawStatus('未保存…', 'dirty');
  clearTimeout(DRAW_SAVE_T);
  DRAW_SAVE_T = setTimeout(() => saveDrawing(), 900);
}

let DRAW_OPEN_SEQ = 0;      // 打开绘图的操作序号：连点/快速切换时以最后一次为准
let DRAW_LOAD_FAILED = false;   // 上一次加载失败：此时点同一绘图必须重试而不是快速返回
async function openDrawing(name) {
  const seq = ++DRAW_OPEN_SEQ;
  const stale = () => seq !== DRAW_OPEN_SEQ;   // 已有更新的打开操作，本次流程应放弃
  if(document.body.classList.contains('office-mode'))await closeOffice();
  if (stale()) return;
  rememberWorkspaceRecent('drawing',name);
  const r = await api('/api/drawings/get?name=' + encodeURIComponent(name));
  if (stale()) return;
  if (!r.ok) { setStatus('err', '打开绘图失败：' + (r.error || '')); return; }
  // 已经是当前打开的绘图：只刷新列表（避免重复销毁/重建，点它不会有反应才怪）
  if (!DRAW_LOAD_FAILED && DRAW_FILE === name && document.body.classList.contains('drawing-mode') && $('draw-editor').style.display !== 'none') { renderDrawList(); return; }
  // 先落盘 / 销毁上一个绘图：加超时上限，避免落盘卡住时「点了没反应」
  await Promise.race([closeDrawEditor(true), new Promise((done) => setTimeout(done, 4000))]);
  if (stale()) return;
  DRAW_FILE = name;
  DRAW_KIND = drawKind(name);
  document.body.classList.add('drawing-mode');
  $('draw-editor').style.display = 'flex';
  $('draw-ed-name').textContent = drawBase(name);
  setDrawStatus('加载中…', '');
  if (DRAW_KIND === 'xmind') {
    DRAW_LOAD_FAILED = false;
    $('draw-lib-note').textContent='XMind · 本地编辑';
    $('draw-lib-note').title='标准 .xmind 文件，可在 XMind 桌面端继续编辑';
    openXmindEditor(r.workbook,r.thumbnail||'');
    renderDrawList();
    return;
  }
  if (DRAW_KIND === 'drawio') {
    DRAW_LOAD_FAILED = false;
    $('draw-lib-note').textContent='Draw.io · 在线编辑';
    $('draw-lib-note').title='使用 diagrams.net 官方嵌入编辑器，文件自动保存到 vault/drawings';
    $('draw-ai-btn').style.display='inline-block';$('draw-xml-btn').style.display='inline-block';
    openDrawioEditor(r.xml);
    renderDrawList();
    return;
  }
  if (DRAW_KIND === 'canvas') { DRAW_LOAD_FAILED=false; $('draw-lib-note').textContent='canvas · tldraw 白板'; $('draw-lib-note').title='无限画布，基于 tldraw（开源白板）'; $('draw-ai-btn').style.display='none'; $('draw-xml-btn').style.display='none'; window.__openCanvasEditor(name); setDrawStatus('就绪',''); renderDrawList(); return; }
  $('drawio-root').style.display='none';
  $('excal-root').style.display='block';
  $('draw-ai-btn').style.display='none';$('draw-xml-btn').style.display='none';
  try { await loadExcalLoader(); }
  catch (e2) {
    if (stale()) return;                   // 旧流程失败时不要干扰当前绘图
    setStatus('err', e2.message);
    showDrawLoadError(e2.message);         // 保持绘图视图并说明原因（原先直接静默退回代码区）
    return;
  }
  if (stale()) return;
  DRAW_LOAD_FAILED = false;
  const L = window.ExcalLoader;
  const { React, ReactDOM, Excalidraw } = L;
  const rootEl = $('excal-root');
  rootEl.innerHTML = '';
  const root = ReactDOM.createRoot(rootEl);
  DRAW_ROOT = root;
  const safe = sanitizeScene(r);
  // 自动加载 vault/libraries/ 文件夹里的所有库文件（按 item id 去重）
  const libR = await libFetchAll();
  if (stale()) return;
  const libItems = (libR && libR.items) || [];
  window.__LIB_COUNT = libItems.length;
  LIB_LAST_IDS = libIdsKey(libItems);
  renderLibNote((libR && libR.files ? libR.files.length : 0), libR && libR.dir);
  root.render(React.createElement(Excalidraw, {
    initialData: { type: 'excalidraw', version: 2, source: 'file://', elements: safe.elements, appState: safe.appState, files: safe.files, libraryItems: libItems },
    excalidrawAPI: (api2) => { window.__EX = api2; },
    onChange: (els, appState, files) => {
      DRAW_PENDING = { elements: els, appState, files };
      scheduleDrawSave();
    },
    onLibraryChange: (items) => {
      LIB_ITEMS = (items || []).slice();
      window.__LIB_COUNT = LIB_ITEMS.length;
      scheduleLibSave(LIB_ITEMS);
    },
    theme: 'dark',
  }));
  renderDrawList();
  startLibFolderPoll();         // 文件夹里新放进库文件 → 自动加载
}

async function closeDrawEditor(flush) {
  clearTimeout(DRAW_SAVE_T); DRAW_SAVE_T = 0;
  stopLibFolderPoll();
  if (flush && DRAW_FILE && DRAW_PENDING) await saveDrawing();
  flushLibSave(LIB_ITEMS);       // 库改动落盘（vault/libraries/local.excalidrawLibrary）
  LIB_ITEMS = []; window.__LIB_COUNT = 0; LIB_LAST_IDS = '';
  if (DRAW_ROOT) { try { DRAW_ROOT.unmount(); } catch (_) {} DRAW_ROOT = null; }
  if (DRAWIO_FRAME) { try { DRAWIO_FRAME.remove(); } catch (_) {} DRAWIO_FRAME = null; }
  closeXmindEditor();
  DRAWIO_XML = '';
  DRAW_API = null;
  window.__EX = null;          // 清除旧实例引用（防止重开时误判/读旧场景）
  DRAW_FILE = null; DRAW_KIND = null; DRAW_PENDING = null; DRAW_DIRTY = false;
  document.body.classList.remove('drawing-mode');
  $('draw-editor').style.display = 'none';
  $('excal-root').innerHTML = '';
  $('excal-root').style.display = 'block';
  $('drawio-root').innerHTML = '';
  $('drawio-root').style.display = 'none';
  $('xmind-root').style.display = 'none';
  if (window.__closeCanvasEditor) window.__closeCanvasEditor();   // canvas 白板 iframe 也要拆（内部先 flush 再销毁）
  $('draw-ai-btn').style.display='none';$('draw-xml-btn').style.display='none';
  $('draw-tool-dialog').classList.remove('open');
  renderDrawList();
}

/* ---- 库：文件合并 / 保存 / 文件夹轮询 / 下载拦截 ----
   文件存放于 vault/libraries/*.excalidrawLibrary（文件夹管理）；
   打开时合并自动加载；文件夹内容变化自动更新；应用内改动防抖写回 LIB_APP_FILE。 */
let LIB_ITEMS = [];            // 当前编辑器已知库 item
let LIB_SELF_LAST = '';        // 自写文件落盘前的 id 快照（抑制自身导致的 updateLibrary）
function libIdsKey(items) { return items.map(i => i.id).join('|'); }

async function libFetchAll() {
  try { const r = await api('/api/libraries/all'); return r && r.ok ? r : null; }
  catch (_) { return null; }
}

function scheduleLibSave(items) {
  clearTimeout(LIB_SAVE_T);
  LIB_SAVE_T = setTimeout(async () => {
    try { await api('/api/libraries/save', { name: LIB_APP_FILE, data: { libraryItems: items || [] } }); } catch (_) {}
  }, 900);
}

function flushLibSave(items) {
  clearTimeout(LIB_SAVE_T); LIB_SAVE_T = 0;
  const arr = items || [];
  if (arr.length) {
    try {
      fetch('/api/libraries/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: LIB_APP_FILE, data: { libraryItems: arr } }), keepalive: true }).catch(() => {});
    } catch (_) {}
  }
}

async function refreshLibraryFromFolder() {
  const r = await libFetchAll();
  if (!r || !window.__EX) return;
  const items = r.items || [];
  window.__LIB_COUNT = items.length;
  renderLibNote(r.files ? r.files.length : 0, r.dir);
  const key = libIdsKey(items);
  if (key === LIB_LAST_IDS) return;
  LIB_LAST_IDS = key;
  try { window.__EX.updateLibrary({ libraryItems: items, prompt: false, merge: false, openLibraryMenu: false }); } catch (_) {}
}

function folderPollSignature(names) { return names.filter(n => n !== LIB_APP_FILE).sort().join('|'); }

async function pollLibraryFolder() {
  if(document.hidden)return;
  try {
    const r = await api('/api/libraries/list');
    if (!r || !r.ok) return;
    const sig = folderPollSignature(r.libraries.map(l => l.name));
    if (sig !== LIB_POLL_SIG) { LIB_POLL_SIG = sig; refreshLibraryFromFolder(); }
  } catch (_) {}
}

function startLibFolderPoll() {
  stopLibFolderPoll();
  LIB_POLL_SIG = '';
  LIB_POLL_T = setInterval(pollLibraryFolder, 5000);
}
function stopLibFolderPoll() { clearInterval(LIB_POLL_T); LIB_POLL_T = 0; }

function renderLibNote(count, dir) {
  const el = $('draw-lib-note');
  if (!el) return;
  el.textContent = '库 ' + (count || 0) + ' 个' + (dir ? ' · ' + dir.split('/').slice(-1)[0] + '/' : '');
  el.title = dir ? ('库文件目录：' + dir) : '库文件存放于 vault/libraries/ 文件夹';
}

/* 捕获 Excalidraw「下载库」：拦截 a[download] 的 .excalidrawLibrary 下载，改存到 vault/libraries/ 并立即合并 */
function wireLibDownloadCapture() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const a = t && t.closest ? t.closest('a[download]') : null;
    if (!a) return;
    const fn = a.getAttribute('download') || '';
    if (!/\.excalidraw(library|lib)$/i.test(fn)) return;
    const href = a.href || '';
    if (href.indexOf('blob:') !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (async () => {
      try {
        const text = await fetch(href).then(r => r.blob()).then(b => b.text());
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.libraryItems)) return;   // 不是合法库文件 → 放行浏览器默认下载
        const saveName = fn.replace(/\.excalidrawlib$/i, '.excalidrawLibrary');
        const r = await api('/api/libraries/save', { name: saveName, data: data });
        if (r.ok) {
          setDrawStatus('库已保存：libraries/' + saveName, 'ok');
          LIB_POLL_SIG = '';
          pollLibraryFolder();          // 立即合并到当前编辑器
        }
      } catch (_) {}
    })();
  }, true);
}

function openDrawNewDialog(kind) {
  DRAW_ND_KIND = kind === 'folder' ? 'folder' : 'drawing';
  $('draw-ndialog').style.display = 'flex';
  $('draw-nd-title').textContent = DRAW_ND_KIND === 'folder' ? '新建绘图文件夹' : '新建绘图';
  $('draw-nd-hint').textContent = DRAW_ND_KIND === 'folder'
    ? '名称可含 / 嵌套创建（如 工作/架构图），可放在任意层级下'
    : 'Excalidraw 适合草图；Draw.io 适合流程图与 UML；XMind 适合层级思维导图；canvas 适合自由白板（便签、连接线、图片）';
  $('draw-nd-name').value = '';
  $('draw-nd-name').placeholder = DRAW_ND_KIND === 'folder' ? '我的文件夹' : 'Untitled';
  $('draw-nd-name-label').textContent = DRAW_ND_KIND === 'folder' ? '文件夹名称' : '绘图名称';
  $('draw-nd-dir-label').style.display = '';
  const typeLabel = $('draw-nd-type-label');
  const typeSelect = $('draw-nd-type');
  const choosingType = DRAW_ND_KIND === 'drawing';
  typeLabel.style.display = choosingType ? '' : 'none';
  typeSelect.style.display = choosingType ? '' : 'none';
  if (choosingType) {
    try { const saved=localStorage.getItem('mc-draw-new-kind');typeSelect.value=['excalidraw','drawio','xmind','canvas'].includes(saved)?saved:'excalidraw'; }
    catch (_) { typeSelect.value = 'excalidraw'; }
  }
  // 位置下拉：递归收集绘图文件夹
  (async () => {
    const r = await api('/api/drawings/tree');
    const dirs = [];
    const collect = (node, depth) => {
      for (const c of node.children || []) {
        if (c.type === 'folder') { dirs.push({ path: c.path, label: '　'.repeat(depth) + c.name }); collect(c, depth + 1); }
      }
    };
    if (r && r.ok && r.root) collect(r.root, 0);
    const sel = $('draw-nd-dir');
    sel.innerHTML = '';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '根目录'; sel.appendChild(o0);
    for (const d of dirs) { const o = document.createElement('option'); o.value = d.path; o.textContent = d.label; sel.appendChild(o); }
    try { sel.value = window.__DRAW_ND_CUR || ''; } catch (_) {}
    $('draw-nd-name').focus();
  })();
}

function closeDrawNewDialog() { $('draw-ndialog').style.display = 'none'; }

let DRAW_ND_RENAME = null;   // 重命名目标（完整绘图路径）

function openDrawRenameDialog(path) {
  DRAW_ND_KIND = 'rename';
  DRAW_ND_RENAME = path;
  $('draw-ndialog').style.display = 'flex';
  $('draw-nd-title').textContent = '重命名绘图';
  $('draw-nd-hint').textContent = '仅修改文件名，保持所在文件夹；同目录重名自动加 -2、-3';
  $('draw-nd-name').value = drawBase(path);
  $('draw-nd-name').placeholder = '新名称';
  $('draw-nd-name-label').textContent = '新名称';
  $('draw-nd-dir-label').style.display = 'none';
  $('draw-nd-type-label').style.display = 'none';
  $('draw-nd-type').style.display = 'none';
  const sel = $('draw-nd-dir');
  sel.innerHTML = '';
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '（保持当前文件夹）'; sel.appendChild(o0);
  $('draw-nd-name').focus();
  $('draw-nd-name').select();
}

async function submitDrawNewDialog() {
  const name = $('draw-nd-name').value.trim();
  const dir = $('draw-nd-dir').value;
  if (!name) { setStatus('err', DRAW_ND_KIND === 'rename' ? '请填写新名称' : (DRAW_ND_KIND === 'folder' ? '请填写文件夹名称' : '请填写绘图名称')); return; }
  closeDrawNewDialog();
  if (DRAW_ND_KIND === 'rename') {
    const oldPath = DRAW_ND_RENAME;
    const r = await api('/api/drawings/rename', { name: oldPath, newName: name });
    DRAW_ND_RENAME = null;
    if (!r.ok) { setStatus('err', '重命名失败：' + (r.error || '')); await renderDrawList(); return; }
    if (!r.unchanged && DRAW_FILE === oldPath) {
      // 当前打开的文件被改名：更新引用，后续自动保存落到新路径
      DRAW_FILE = r.name;
      const en = $('draw-ed-name'); if (en) en.textContent = drawBase(r.name);
    }
    setStatus('ok', '已重命名：' + r.name);
  } else if (DRAW_ND_KIND === 'folder') {
    const r = await api('/api/drawings/new-folder', { dir, name });
    if (!r.ok) { setStatus('err', '新建文件夹失败：' + (r.error || '')); await renderDrawList(); return; }
    DRAW_DIR_OPEN.add(r.path); saveDrawDirs();
    // 展开父链，让新文件夹立即可见（含嵌套新建）
    const spr = r.path.split('/');
    for (let i = 1; i < spr.length; i++) DRAW_DIR_OPEN.add(spr.slice(0, i).join('/'));
    saveDrawDirs();
    setStatus('ok', '已创建文件夹：' + r.path);
  } else {
    if (DRAW_FILE || DRAW_ROOT) await closeDrawEditor(true);
    const selectedKind=$('draw-nd-type').value;
    const kind = ['drawio','xmind','canvas'].includes(selectedKind) ? selectedKind : 'excalidraw';
    try { localStorage.setItem('mc-draw-new-kind', kind); } catch (_) {}
    const r = await api('/api/drawings/new', { dir, name, kind });
    if (!r.ok) { setStatus('err', '新建绘图失败：' + (r.error || '')); await renderDrawList(); return; }
    setStatus('ok', '已新建绘图：' + r.name);
    await renderDrawList();
    await openDrawing(r.name);
  }
  await renderDrawList();
}

function deleteDrawing(name) {
  openConfirm({
    title: '删除绘图',
    message: '确定删除绘图「' + drawBase(name) + '」吗？\n删除后不可恢复（将从 vault 的 drawings/ 目录移除）。',
    requireInput: drawBase(name),
    onOk: async () => {
      const r = await api('/api/drawings/delete', { name });
      if (!r.ok) { setStatus('err', '删除失败：' + (r.error || '')); return; }
      if (DRAW_FILE === name) closeDrawEditor(false);
      await renderDrawList();
      setStatus('ok', '绘图已删除：' + drawBase(name));
    },
  });
}

/* ★★ 拖拽落点三分 ✓（2026-10-19，和项目树对齐）——
   上 28% = 插到前面 ✓ / 下 28% = 插到后面 ✓ / 中间 = 放进这个文件夹 ✓。
   ⚠️ 绘图、Office 两棵树共用这一个判定 ✗（别再各写一份，改一处漏一处 ✗）。 */
function dropZoneOf(el, event) {
  const r = el.getBoundingClientRect();
  const y = event.clientY - r.top;
  if (y < r.height * 0.28) return 'before';
  if (y > r.height * 0.72) return 'after';
  return 'inside';
}
function paintDropZone(el, zone) {
  el.classList.toggle('drop-before', zone === 'before');
  el.classList.toggle('drop-after', zone === 'after');
  el.classList.toggle('drop-target', zone === 'inside');
}
async function reorderDrawings(name, target, position) {
  if (!name || !target || name === target) return;
  const parentOf = (v) => (v.includes('/') ? v.slice(0, v.lastIndexOf('/')) : '');
  if (parentOf(name) !== parentOf(target)) {
    setStatus('err', '只能在同一层里调整顺序；要换到别的文件夹，请拖到那一行中间');
    return;
  }
  const r = await api('/api/drawings/reorder', { name, target, position });
  if (!r || !r.ok) { setStatus('err', (r && r.error) || '调整顺序失败'); return; }
  await renderDrawList();          /* ⚠️ 绘图树的加载函数叫 renderDrawList（它自己会重新拉树 ✓），不是 loadDrawings ✗ */
  setStatus('ok', '已把「' + drawBase(name) + '」移到「' + drawBase(target) + '」' + (position === 'after' ? '后面' : '前面'));
}
async function reorderOffice(path, target, position) {
  if (!path || !target || path === target) return;
  const parentOf = (v) => (v.includes('/') ? v.slice(0, v.lastIndexOf('/')) : '');
  if (parentOf(path) !== parentOf(target)) {
    officeStatus('只能在同一层里调整顺序；要换到别的文件夹，请拖到那一行中间', true);
    return;
  }
  const r = await api('/api/office/reorder', { path, target, position });
  if (!r || !r.ok) { officeStatus((r && r.error) || '调整顺序失败', true); return; }
  await loadOffice(true);
  officeStatus('已把「' + officeBase(path) + '」移到「' + officeBase(target) + '」' + (position === 'after' ? '后面' : '前面'));
}
async function moveDrawing(name, toDir) {
  const r = await api('/api/drawings/move', { name, toDir });
  if (!r.ok) { setStatus('err', '移动失败：' + (r.error || '')); await renderDrawList(); return; }
  if (!r.unchanged) {
    if (DRAW_FILE === name) {
      // 当前打开的绘图被移动：更新引用，后续自动保存落新路径
      DRAW_FILE = r.name;
      const en = $('draw-ed-name'); if (en) en.textContent = drawBase(r.name);
    }
    // 展开目标文件夹及其父链，让移动结果立即可见
    if (toDir) {
      const tparts = toDir.split('/');
      for (let i = 1; i <= tparts.length; i++) DRAW_DIR_OPEN.add(tparts.slice(0, i).join('/'));
      saveDrawDirs();
    }
    setStatus('ok', '已移动：' + r.name + ' → ' + (toDir || '根目录'));
  }
  await renderDrawList();
}

async function renderDrawList() {
  const r = await api('/api/drawings/tree');
  const root = (r.ok && r.root) || { type: 'folder', name: '', path: '', children: [] };
  DRAWINGS=[];const collectDrawings=(node)=>{for(const child of node.children||[]){if(child.type==='folder')collectDrawings(child);else DRAWINGS.push({path:child.path,name:child.name||child.path,size:child.size||0,updated:child.updated||0});}};collectDrawings(root);
  const box = $('draw-list');
  box.innerHTML = '';
  const cnt = $('draw-count'); if (cnt) cnt.textContent = String(r.total || 0);
  if (!root.children.length) {
    const e = document.createElement('div');
    e.className = 'draw-empty';
    e.textContent = '还没有绘图：＋ 新建（📁 可建文件夹，支持多级与重名）';
    box.appendChild(e);
    return;
  }
  const build = (node, container) => {
    for (const c of node.children) {
      if (c.type === 'folder') {
        const open = DRAW_DIR_OPEN.has(c.path);
        const f = document.createElement('div');
        f.className = 'draw-frow' + (open ? ' open' : '');
        f.title = c.path + '（' + c.count + ' 个绘图）　点击展开/收起';
        const ar = document.createElement('span'); ar.className = 'draw-arrow'; ar.innerHTML = open ? csGlyphIcon('▾') : csGlyphIcon('▸');
        const ic = document.createElement('span'); ic.className = 'draw-ic side-glyph'; ic.innerHTML = sideGlyphMarkup(open ? 'folderOpen' : 'folder');
        const nm = document.createElement('span'); nm.className = 'draw-fname'; nm.textContent = c.name;
        const n = document.createElement('span'); n.className = 'draw-fcount'; n.textContent = String(c.count || 0); n.title = (c.count || 0) + ' 个绘图';
        f.appendChild(ar); f.appendChild(ic); f.appendChild(nm); f.appendChild(n);
        f.dataset.path = c.path;   // 右键菜单需要用它预选「在此新建」的目标位置
        f.onclick = () => { if (open) DRAW_DIR_OPEN.delete(c.path); else DRAW_DIR_OPEN.add(c.path); saveDrawDirs(); renderDrawList(); };
        /* ★ 拖放三分 ✓（2026-10-19）——
           上/下边缘 = 插到这一行前/后（同一层换顺序 ✓），中间 = 放进这个文件夹 ✓（原行为）。 */
        f.addEventListener('dragover', (e) => {
          if (!e.dataTransfer || !e.dataTransfer.types.includes('application/x-drawing')) return;
          e.preventDefault(); e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          paintDropZone(f, dropZoneOf(f, e));
        });
        f.addEventListener('dragleave', () => f.classList.remove('drop-target', 'drop-before', 'drop-after'));
        f.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation();
          const zone = dropZoneOf(f, e);
          f.classList.remove('drop-target', 'drop-before', 'drop-after');
          const df = e.dataTransfer.getData('application/x-drawing');
          if (!df) return;
          if (zone === 'inside') return moveDrawing(df, c.path);
          reorderDrawings(df, c.path, zone);
        });
        container.appendChild(f);
        if (open) {
          const children = document.createElement('div');
          children.className = 'draw-children';
          build(c, children);
          if (children.children.length) container.appendChild(children);
        }
      } else {
        const row = document.createElement('div');
        row.className = 'draw-row' + (DRAW_FILE === c.path ? ' on' : '');
        const kind = drawKind(c.path);
        const kindLabel=kind==='drawio'?'Draw.io 在线编辑器':(kind==='xmind'?'XMind 本地思维导图编辑器':(kind==='canvas'?'canvas 白板':'Excalidraw 编辑器'));
        row.title = c.path + '　点击打开（' + kindLabel + '，改动自动保存）；拖到文件夹行可移动';
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          if (e.target.closest('button')) { e.preventDefault(); return; }
          try { e.dataTransfer.setData('application/x-drawing', c.path); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        /* ★ 文件行也是落点 ✓（只有前/后，没有「放进去」）—— 同一层换顺序 ✓ */
        row.addEventListener('dragover', (e) => {
          if (!e.dataTransfer || !e.dataTransfer.types.includes('application/x-drawing')) return;
          e.preventDefault(); e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          paintDropZone(row, dropZoneOf(row, e) === 'inside' ? 'before' : dropZoneOf(row, e));
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
        row.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation();
          const zone = dropZoneOf(row, e) === 'after' ? 'after' : 'before';
          row.classList.remove('drop-before', 'drop-after');
          const df = e.dataTransfer.getData('application/x-drawing');
          if (df) reorderDrawings(df, c.path, zone);
        });
        const nm = document.createElement('span');
        nm.className = 'draw-name';
        nm.textContent = drawBase(c.path);
        const fileIcon = document.createElement('span');
        fileIcon.className = 'draw-file-ic';
        fileIcon.innerHTML = `<svg class="cs-ico" aria-hidden="true"><use href="#i-${kind}"/></svg>`;
        fileIcon.title = kind === 'drawio' ? 'Draw.io' : (kind === 'xmind' ? 'XMind' : (kind === 'canvas' ? 'canvas' : 'Excalidraw'));
        const typeBadge = document.createElement('span');
        // 不直接使用 `.excalidraw` 类名，避免与编辑器自带的全局样式冲突。
        typeBadge.className = 'draw-type draw-type--' + kind;
        typeBadge.dataset.kind = kind;
        typeBadge.textContent = kind === 'drawio' ? 'Draw.io' : (kind === 'xmind' ? 'XMind' : (kind === 'canvas' ? 'canvas' : 'Excalidraw'));
        typeBadge.title = kind === 'drawio'
          ? '类型：Draw.io（流程图、架构图、UML）'
          : (kind === 'xmind' ? '类型：XMind（层级思维导图）'
            : (kind === 'canvas' ? '类型：canvas（无限白板 · 便签 / 连线 / 手绘）' : '类型：Excalidraw（手绘草图）'));
        const ren = document.createElement('button');
        ren.className = 'draw-ren';
        ren.innerHTML = csGlyphIcon('✎');
        ren.title = '重命名绘图';
        ren.onclick = (e) => { e.stopPropagation(); openDrawRenameDialog(c.path); };
        const del = document.createElement('button');
        del.className = 'draw-del';
        del.innerHTML = csGlyphIcon('✕');
        del.title = '删除绘图';
        del.onclick = (e) => { e.stopPropagation(); deleteDrawing(c.path); };
        row.appendChild(fileIcon); row.appendChild(nm); row.appendChild(typeBadge); row.appendChild(ren); row.appendChild(del);
        row.onclick = () => openDrawing(c.path);
        container.appendChild(row);
      }
    }
  };
  build(root, box);
}

/* ---- 左侧面板拖拽重排（项目 / Git / 标签 / 绘图 可自由换位，顺序持久化） ---- */
const PANEL_DEFAULT = ['pane-tree', 'pane-git', 'pane-tags', 'pane-draw', 'pane-office', 'pane-reading'];
let PANEL_ORDER = (() => {
  try {
    const o = JSON.parse(localStorage.getItem('mc-panel-order') || '');
    if (Array.isArray(o) && o.length && o.every(id => PANEL_DEFAULT.includes(id))) return [...o,...PANEL_DEFAULT.filter(id=>!o.includes(id))];
  } catch (_) {}
  return PANEL_DEFAULT.slice();
})();

function applyPanelOrder() {
  const side = $('side');
  const units = [];
  for (const id of PANEL_ORDER) {
    const el = $(id); if (!el) continue;
    let split = null;
    const prev = el.previousElementSibling;
    if (prev && prev.classList.contains('hsplit')) split = prev;
    units.push({ el, split });
  }
  const frag = document.createDocumentFragment();
  for (const u of units) { if (u.split) frag.appendChild(u.split); frag.appendChild(u.el); }
  side.appendChild(frag);   // 把节点按目标顺序移到 #side 末尾即完成重排
}

function wirePanelReorder() {
  applyPanelOrder();
  const LINE = document.createElement('div');
  LINE.id = 'panel-drop-line';
  document.body.appendChild(LINE);
  let drag = null;
  const suppressClick = (e) => { e.stopPropagation(); e.preventDefault(); };
  const panelRects = () => PANEL_ORDER.map((id) => { const el = $(id); return el && el.offsetParent !== null ? el : null; }).filter(Boolean).map(el => el.getBoundingClientRect());
  const dropIndex = (y, rects) => {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (y < r.top) return i;
      if (y < r.bottom) return (y < (r.top + r.bottom) / 2) ? i : i + 1;
    }
    return rects.length;
  };
  const onMove = (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < 6) return;
      drag.active = true;
      drag.el.classList.add('pane-dragging');
      document.body.style.cursor = 'grabbing';
    }
    const rects = panelRects();
    drag.idx = dropIndex(e.clientY, rects);
    const anchor = drag.idx < rects.length ? rects[drag.idx].top : rects[rects.length - 1].bottom;
    LINE.style.display = 'block';
    LINE.style.top = (anchor - 1) + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!drag) return;
    const wasActive = drag.active;
    if (wasActive) {
      let to = (drag.idx != null && PANEL_ORDER.length) ? drag.idx : PANEL_ORDER.length;
      const from = PANEL_ORDER.indexOf(drag.id);
      const n = PANEL_ORDER.length;
      to = Math.max(0, Math.min(n - 1, to > from ? to - 1 : to));
      PANEL_ORDER.splice(from, 1);
      PANEL_ORDER.splice(to, 0, drag.id);
      try { localStorage.setItem('mc-panel-order', JSON.stringify(PANEL_ORDER)); } catch (_) {}
      applyPanelOrder();
      // 拖拽结束抑制标题栏随后的 click（否则会触发面板折叠切换）
      document.addEventListener('click', suppressClick, { capture: true, once: true });
    }
    LINE.style.display = 'none';
    drag.el.classList.remove('pane-dragging');
    document.body.style.cursor = '';
    drag = null;
  };
  const onDown = (e, id) => {
    if (e.button !== 0 || e.target.closest('button, input, select, a')) return;
    const el = $(id); if (!el) return;
    drag = { id, el, startY: e.clientY, startX: e.clientX, active: false, idx: null };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  for (const [pid, hid] of [['pane-tree', 'tree-head'], ['pane-git', 'git-head'], ['pane-tags', 'tag-head'], ['pane-draw', 'draw-head'], ['pane-office', 'office-head'], ['pane-reading', 'reading-head']]) {
    const head = $(hid); if (!head) continue;
    head.addEventListener('mousedown', (e) => onDown(e, pid));
  }
}
window.addEventListener('DOMContentLoaded', wirePanelReorder);

function toggleDrawPanel() {
  DRAW_OPEN = !DRAW_OPEN;
  try { localStorage.setItem('mc-draw-open', DRAW_OPEN ? '1' : '0'); } catch (_) {}
  $('pane-draw').classList.toggle('collapsed', !DRAW_OPEN);
}

/* ---- XMind 结构编辑器：simple-mind-map 适配层 ----
   保留标准 XMind 工作簿为唯一数据源；编辑器只负责交互和布局。 */
const XMIND_SMM_LAYOUTS=new Set(['logicalStructure','logicalStructureLeft','mindMap','organizationStructure','catalogOrganization','timeline','timeline2','verticalTimeline','verticalTimeline2','verticalTimeline3','fishbone','fishbone2','rightFishbone','rightFishbone2']);
function xmindPlainText(value){
  const source=String(value??'').replace(/\r/g,'');
  if(!/<(?:p|div|span|br|strong|em|b|i|ul|ol|li|h[1-6])(?:\s|>|\/)/i.test(source))return source||'未命名主题';
  const holder=document.createElement('div');holder.innerHTML=source;
  return(holder.textContent||'').replace(/\u00a0/g,' ').trim()||'未命名主题';
}
function xmindEditorModule(){const mod=window.simpleMindMap;return mod&&(mod.default||mod);}
function ensureXmindEditorLib(){
  if(xmindEditorModule())return Promise.resolve();
  if(!XMIND_EDITOR_LIB){
    const style=document.querySelector('link[data-codescope-simple-mind-map]')||document.createElement('link');
    if(!style.parentNode){style.rel='stylesheet';style.href='/simple-mind-map/simpleMindMap.esm.min.css';style.dataset.codescopeSimpleMindMap='1';document.head.appendChild(style);}
    XMIND_EDITOR_LIB=import('/simple-mind-map/simpleMindMap.esm.min.js').then(module=>{window.simpleMindMap=module.default||module;if(!xmindEditorModule())throw new Error('simple-mind-map 编辑器未正确加载');}).catch(error=>{XMIND_EDITOR_LIB=null;throw error;});
  }
  return XMIND_EDITOR_LIB;
}
function xmindCurrentTheme(){return $('xmind-root')?.dataset.xmindTheme||'midnight';}
function xmindThemePalette(id=xmindCurrentTheme()){
  const themes={
    midnight:{bg:'#0b1017',root:'#315f9b',rootBorder:'#78a9ff',card:'#182536',text:'#e4ebf4',muted:'#9eafc3',palette:['#78a9ff','#a78bfa','#34d399','#fbbf24','#fb7185']},
    classic:{bg:'#f4f7fb',root:'#316fc5',rootBorder:'#22599f',card:'#ffffff',text:'#243248',muted:'#62738b',palette:['#316fc5','#6f42c1','#0f8a68','#d97706','#c2415d']},
    forest:{bg:'#09140f',root:'#176b50',rootBorder:'#52d6a4',card:'#10271e',text:'#dcf7eb',muted:'#75a591',palette:['#52d6a4','#81c784','#7dd3fc','#d5e86c','#f4b860']},
    sunset:{bg:'#17100d',root:'#9a4f2c',rootBorder:'#ff9e64',card:'#2b1b15',text:'#fff0e5',muted:'#bd9076',palette:['#ff9e64','#ff7b72','#e0af68','#bb9af7','#7dcfff']},
    violet:{bg:'#120f1c',root:'#5d4892',rootBorder:'#bb9af7',card:'#211a31',text:'#f0e9ff',muted:'#9585af',palette:['#bb9af7','#7aa2f7','#9ece6a','#e0af68','#f7768e']},
    paper:{bg:'#f5f0e5',root:'#f0dfbf',rootBorder:'#9b6d32',card:'#fffaf0',text:'#382e24',muted:'#766957',palette:['#9b6d32','#607d3b','#517792','#985b68','#8064a2']},
    spectrum:{bg:'#0c1018',root:'#405d91',rootBorder:'#7dd3fc',card:'#171f2e',text:'#eef4ff',muted:'#8290a9',palette:['#ff7b72','#7ee787','#7dd3fc','#d2a8ff','#ffa657']},
    ocean:{bg:'#06131e',root:'#116f91',rootBorder:'#47d7f4',card:'#102a3b',text:'#e4f9ff',muted:'#79aabb',palette:['#47d7f4','#32b6e8','#6a9cff','#65dbc5','#a88cff']},
    mint:{bg:'#061512',root:'#176b58',rootBorder:'#66e6bc',card:'#112e26',text:'#e6fff7',muted:'#79ab9c',palette:['#66e6bc','#4fc3a1','#81c784','#7dd3fc','#d5e86c']},
    rose:{bg:'#1b0c12',root:'#8d3d5a',rootBorder:'#ff8faf',card:'#381825',text:'#fff0f5',muted:'#c08b9e',palette:['#ff8faf','#f7768e','#bb9af7','#ffb86c','#7dcfff']},
    graphite:{bg:'#101217',root:'#3d4654',rootBorder:'#bbc4d2',card:'#222731',text:'#edf1f6',muted:'#8d97a7',palette:['#bbc4d2','#8ea0b8','#6f87a6','#9a8fab','#7e9c97']},
    solar:{bg:'#171105',root:'#876716',rootBorder:'#ffd86f',card:'#33260b',text:'#fff8df',muted:'#bea86d',palette:['#ffd86f','#f9a826','#f47c48','#9ece6a','#7dcfff']},zen:{bg:'#1e1e20',root:'#f5f7fa',rootBorder:'#7f97bd',rootText:'#1b2430',card:'#e6e6e6',text:'#2b3138',muted:'#9aa3ad',palette:['#c9a227','#c25b6a','#4e8f57','#3f6fa8','#7a7a7a','#b8792e'],fills:['#f7e3a1','#f4c6ce','#c9e6c9','#cfe2f8','#e0e0e0','#f8d2a6']}
  };return themes[id]||themes.midnight;
}
function xmindStyleState(){return{lineStyle:'curve',linePattern:'solid',nodeShape:'roundedRectangle',...(xmindSheet()?.codescopeStyle||{})};}
function xmindSmmThemeConfig(id=xmindCurrentTheme(),style=xmindStyleState(),layout=xmindCurrentLayout()){
  const t=xmindThemePalette(id),light=id==='classic'||id==='paper',shape=style.nodeShape==='underline'?'roundedRectangle':style.nodeShape,table=layout==='treeTable',underline=style.nodeShape==='underline',dash=style.linePattern==='dash'?'8,5':(style.linePattern==='dot'?'2,5':'none');
  const nodeBase={shape,fillColor:underline?'transparent':t.card,color:t.text,borderColor:underline?'transparent':t.rootBorder,borderWidth:underline?0:1,borderRadius:shape==='roundedRectangle'?9:3,fontFamily:'Inter, PingFang SC, Microsoft YaHei, sans-serif',fontSize:14,fontWeight:'normal',paddingX:table?12:14,paddingY:table?6:7};
  return{palette:t.palette,backgroundColor:t.bg,lineColor:t.rootBorder,lineWidth:2,lineStyle:table?'straight':style.lineStyle,lineDasharray:dash,lineRadius:id==='zen'?26:(table?0:8),rootLineKeepSameInCurve:true,nodeUseLineStyle:underline,hoverRectColor:t.rootBorder,hoverRectRadius:8,root:{...nodeBase,shape:shape==='diamond'?'diamond':'roundedRectangle',fillColor:t.root,color:t.rootText||'#fff',borderColor:t.rootBorder,borderWidth:2,borderRadius:12,fontSize:20,fontWeight:'bold',paddingX:20,paddingY:12,marginX:table?70:96,marginY:table?18:34},second:{...nodeBase,fillColor:underline?'transparent':t.card,fontSize:16,fontWeight:'600',marginX:table?64:82,marginY:table?14:26},node:{...nodeBase,fillColor:underline?'transparent':(table?t.card:'transparent'),borderColor:underline||!table?'transparent':t.rootBorder,borderWidth:table?1:0,marginX:table?56:66,marginY:table?10:16},generalization:{fillColor:t.card,color:t.text,borderColor:t.rootBorder},associativeLineColor:t.muted,associativeLineActiveColor:t.rootBorder,associativeLineDasharray:'7,4'};
}
function xmindCurrentLayout(){
  const saved=xmindSheet()?.codescopeLayout;if(saved)return saved;
  const structure=String(xmindRootTopic()?.structureClass||'');
  if(/org-chart|org\.xmind\.ui\.org/i.test(structure))return'organizationStructure';
  if(/logic\.left/i.test(structure))return'logicalStructureLeft';if(/logic\.right/i.test(structure))return'logicalStructure';return'mindMap';
}
function xmindSmmLayout(layout){return XMIND_SMM_LAYOUTS.has(layout)?layout:(layout==='treeTable'?'catalogOrganization':'mindMap');}
function xmindUpdateStyleControls(){const style=xmindStyleState();if($('xmind-line-style'))$('xmind-line-style').value=style.lineStyle;if($('xmind-line-pattern'))$('xmind-line-pattern').value=style.linePattern;if($('xmind-node-shape'))$('xmind-node-shape').value=style.nodeShape;if($('xmind-layout-select'))$('xmind-layout-select').value=xmindCurrentLayout();}
function xmindToEditorData(){
  const theme=xmindThemePalette(),palette=theme.palette,fills=theme.fills||null,walk=(topic,depth,color,fill)=>({data:{uid:String(topic.id||xmindId()),text:xmindPlainText(topic.title||'未命名主题'),richText:false,expand:depth===0||!XMIND_COLLAPSED.has(topic.id),...(depth?{lineColor:color}:{}),...(fills&&depth?{fillColor:fill,color:theme.text,borderColor:fill}:{}),...(topic.note?{note:topic.note}:{}),...(topic.hyperlink?{hyperlink:topic.hyperlink}:{}),...(Array.isArray(topic.tag)&&topic.tag.length?{tag:topic.tag}:{}),...(Array.isArray(topic.icon)&&topic.icon.length?{icon:topic.icon}:{}),...(topic.image?{image:topic.image}:{}),...(topic.outerFrame?{outerFrame:topic.outerFrame}:{}),...(topic.marker?{marker:topic.marker}:{}),...(topic.summary?{summary:topic.summary}:{})},children:xmindChildren(topic).map((child,index)=>walk(child,depth+1,depth?color:palette[index%palette.length],depth?fill:(fills?fills[index%fills.length]:null)))});
  return walk(xmindRootTopic(),0,palette[0],fills?fills[0]:null);
}
function xmindSyncFromEditor(record=false,data=null){
  if(!XMIND_MAP||XMIND_ENGINE_SYNCING)return;data=data||XMIND_MAP.getData();if(data?.root)data=data.root;if(!data?.data)return;
  const previous=new Map();(function collect(topic){if(!topic)return;previous.set(String(topic.id),topic);xmindChildren(topic).forEach(collect);})(xmindRootTopic());
  const collapsed=new Set([...XMIND_COLLAPSED].filter(id=>xmindFind(id)?.isDetached));
  const walk=node=>{const raw=node.data||{},id=String(raw.uid||xmindId()),topic=xmindClone(previous.get(id)||{id,class:'topic',children:{attached:[]}});topic.id=id;topic.class=topic.class||'topic';topic.title=xmindPlainText(raw.text??topic.title??'未命名主题');['note','hyperlink','tag','icon','image','outerFrame','marker','summary'].forEach(key=>{if(raw[key]===undefined)delete topic[key];else topic[key]=xmindClone(raw[key]);});delete topic.codescopePosition;xmindChildren(topic,true);topic.children.attached=(node.children||[]).map(walk);if(raw.expand===false)collapsed.add(id);return topic;};
  const oldRoot=xmindRootTopic(),nextRoot=walk(data),detached=oldRoot?.children?.detached;if(detached?.length){nextRoot.children=nextRoot.children||{};nextRoot.children.detached=detached;}
  xmindSheet().rootTopic=nextRoot;XMIND_COLLAPSED=collapsed;XMIND_SELECTED=xmindFind(XMIND_SELECTED)?XMIND_SELECTED:nextRoot.id;xmindNormalize();if(record)xmindQueueRecord();xmindMarkSnapshotDirty();DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();renderXmindOutline();xmindUpdateViewportTools();requestAnimationFrame(xmindRenderFloatingTopics);
}
function xmindSmmNode(id){return XMIND_MAP?.renderer?.findNodeByUid?.(String(id||''))||null;}
function xmindEngineTopicId(node){return String(node?.getData?.('uid')||node?.nodeData?.data?.uid||'');}
function xmindEngineTopic(target){
  if(!target||!XMIND_MAP?.renderer?.root)return null;let found=null;
  (function walk(node){if(!node||found)return;const el=node.group?.node;if(el&&(el===target||el.contains?.(target))){found=node;(node.children||[]).forEach(child=>{const childEl=child.group?.node;if(childEl&&(childEl===target||childEl.contains?.(target)))found=child;});}if(!found)(node.children||[]).forEach(walk);})(XMIND_MAP.renderer.root);return found;
}
function xmindMapTranslation(){const state=XMIND_MAP?.view?.getTransformData?.()?.state;return{x:Number(state?.x)||0,y:Number(state?.y)||0,scale:Number(state?.scale)||1};}
function xmindApplyViewport(x,y,scale){if(!XMIND_MAP?.view||!XMIND_MAP?.draw)return;const view=XMIND_MAP.view,nextX=Number(x)||0,nextY=Number(y)||0,nextScale=Number(scale)||1;view.x=nextX;view.y=nextY;view.scale=nextScale;view.sx=nextX;view.sy=nextY;XMIND_MAP.draw.transform({origin:[0,0],scale:nextScale,translate:[nextX,nextY]});XMIND_MAP.emit('view_data_change',view.getTransformData());view.emitEvent('scale');xmindUpdateViewportTools();}
function xmindPanBy(dx,dy){if(!XMIND_MAP||XMIND_VIEW!=='edit')return;const view=xmindMapTranslation();xmindApplyViewport(view.x+(Number(dx)||0),view.y+(Number(dy)||0),view.scale);}
function xmindZoomAt(delta,clientX,clientY){if(!XMIND_MAP?.view||XMIND_VIEW!=='edit')return;const rect=$('xmind-engine').getBoundingClientRect(),next=Math.max(.2,Math.min(4,(XMIND_MAP.view.scale||1)+Number(delta||0))),cx=Number.isFinite(clientX)?clientX-rect.left:rect.width/2,cy=Number.isFinite(clientY)?clientY-rect.top:rect.height/2;XMIND_MAP.view.setScale(next,cx,cy);xmindUpdateViewportTools();}
function xmindZoom(delta){if(XMIND_VIEW==='native'){XMIND_NATIVE_SCALE=Math.max(.2,Math.min(5,XMIND_NATIVE_SCALE+delta));renderXmindNativeTransform();xmindUpdateViewportTools();return;}xmindZoomAt(delta);}
function xmindResetZoom(){if(XMIND_VIEW==='native'){XMIND_NATIVE_SCALE=1;renderXmindNativeTransform();}else XMIND_MAP?.view?.setScale?.(1);xmindUpdateViewportTools();}
function xmindContentBounds(){const engine=$('xmind-engine');if(!engine||!XMIND_MAP)return null;const er=engine.getBoundingClientRect(),elements=[...engine.querySelectorAll('g.smm-node'),...document.querySelectorAll('#xmind-floating-layer .xmind-floating-node')],rects=elements.map(element=>element.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0);if(!rects.length)return null;return{left:Math.min(...rects.map(rect=>rect.left))-er.left,top:Math.min(...rects.map(rect=>rect.top))-er.top,right:Math.max(...rects.map(rect=>rect.right))-er.left,bottom:Math.max(...rects.map(rect=>rect.bottom))-er.top,width:er.width,height:er.height};}
function xmindPlaceAll(fit=false){if(!XMIND_MAP?.view||XMIND_VIEW!=='edit')return;let bounds=xmindContentBounds();if(!bounds)return;const padding=56;if(fit){const contentWidth=Math.max(1,bounds.right-bounds.left),contentHeight=Math.max(1,bounds.bottom-bounds.top),ratio=Math.min((bounds.width-padding*2)/contentWidth,(bounds.height-padding*2)/contentHeight),next=Math.max(.2,Math.min(1,(XMIND_MAP.view.scale||1)*ratio));XMIND_MAP.view.setScale(next,(bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2);xmindRenderFloatingTopics();bounds=xmindContentBounds()||bounds;}const view=xmindMapTranslation(),dx=bounds.width/2-(bounds.left+bounds.right)/2,dy=bounds.height/2-(bounds.top+bounds.bottom)/2;xmindApplyViewport(view.x+dx,view.y+dy,view.scale);requestAnimationFrame(xmindRenderFloatingTopics);}
function xmindCenterEditor(){xmindPlaceAll(false);xmindUpdateViewportTools();}
function xmindFitEditor(){xmindPlaceAll(true);xmindUpdateViewportTools();}
function xmindSetToolMode(mode){XMIND_TOOL_MODE=mode==='pan'?'pan':'select';XMIND_CANVAS_PAN=null;if(XMIND_MAP)XMIND_MAP.updateConfig({isDisableDrag:true});xmindUpdateViewportTools();$('xmind-engine')?.focus({preventScroll:true});}
function xmindSetLayout(layout){if(!XMIND_MAP||XMIND_VIEW!=='edit')return;const requested=layout||'mindMap';xmindSheet().codescopeLayout=requested;XMIND_MAP.setLayout(xmindSmmLayout(requested));XMIND_MAP.setThemeConfig(xmindSmmThemeConfig(xmindCurrentTheme(),xmindStyleState(),requested));xmindRecord();xmindMarkSnapshotDirty();DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();xmindUpdateViewportTools();setTimeout(()=>{xmindRenderFloatingTopics();xmindFitEditor();},80);}
function xmindSetStyle(){if(!xmindSheet())return;xmindSheet().codescopeStyle={lineStyle:$('xmind-line-style').value,linePattern:$('xmind-line-pattern').value,nodeShape:$('xmind-node-shape').value};XMIND_MAP?.setThemeConfig?.(xmindSmmThemeConfig());xmindRecord();xmindMarkSnapshotDirty();DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();}
function xmindSetAllExpanded(expanded){if(!XMIND_MAP||XMIND_VIEW!=='edit')return;XMIND_MAP.execCommand(expanded?'EXPAND_ALL':'UNEXPAND_ALL');setTimeout(()=>{xmindSyncFromEditor(true);expanded?xmindFitEditor():xmindCenterEditor();},0);}
function xmindToggleEditorFocus(){if(!XMIND_MAP||XMIND_VIEW!=='edit')return;const node=xmindSmmNode(XMIND_SELECTED);if(node)XMIND_MAP.view.fit(()=>node.group.rbox(),false,70);}
function xmindUpdateViewportTools(){
  const edit=XMIND_VIEW==='edit'&&!!XMIND_MAP,native=XMIND_VIEW==='native',scale=edit?(XMIND_MAP.view?.scale||1):XMIND_NATIVE_SCALE,percent=$('xmind-zoom-value'),engine=$('xmind-engine');if(percent)percent.textContent=Math.round((Number(scale)||1)*100)+'%';if(engine){engine.classList.toggle('pan-mode',XMIND_TOOL_MODE==='pan');engine.classList.toggle('panning',!!XMIND_CANVAS_PAN);}
  $('xmind-select-mode')?.classList.toggle('on',XMIND_TOOL_MODE!=='pan');$('xmind-pan-mode')?.classList.toggle('on',XMIND_TOOL_MODE==='pan');if($('xmind-focus')){$('xmind-focus').classList.remove('on');$('xmind-focus').textContent='定位分支';}
  xmindUpdateStyleControls();['xmind-outer-frame','xmind-summary','xmind-marker','xmind-select-branch','xmind-select-siblings','xmind-select-mode','xmind-pan-mode','xmind-layout-select','xmind-line-style','xmind-line-pattern','xmind-node-shape','xmind-collapse-all','xmind-expand-all','xmind-focus','xmind-center'].forEach(id=>{if($(id))$(id).disabled=!edit;});['xmind-zoom-out','xmind-zoom-in','xmind-zoom-value'].forEach(id=>{if($(id))$(id).disabled=!(edit||native);});xmindUpdateUndo();if(edit&&window.__csXmindToolbarState)window.__csXmindToolbarState();if(edit)requestAnimationFrame(xmindRenderFloatingTopics);
}
function xmindFloatingItems(){
  const items=[],roots=xmindDetached(),gapY=92,gapX=260,spanMemo=new Map(),titleSpan=topic=>Math.max(1,Math.ceil([...String(topic?.title||'')].reduce((sum,char)=>sum+(/[\u2e80-\uffff]/.test(char)?1:.55),0)/24)*.58);
  const span=topic=>{if(spanMemo.has(topic.id))return spanMemo.get(topic.id);const children=xmindChildren(topic),value=Math.max(titleSpan(topic),children.length?children.reduce((sum,child)=>sum+span(child),0)+Math.max(0,children.length-1)*.14:1);spanMemo.set(topic.id,value);return value;};
  const sheet=xmindSheet();if(!XMIND_FLOAT_DRAG&&sheet&&sheet.codescopeFreeLayoutVersion!==4){const placed=[],entries=roots.map((root,index)=>{const fallback=xmindDefaultFloatingPosition(index,roots.length),position=root.position&&Number.isFinite(Number(root.position.x))&&Number.isFinite(Number(root.position.y))?root.position:fallback;return{root,index,x:Number(position.x),y:Number(position.y),half:Math.max(gapY*.55,span(root)*gapY*.5)};}).sort((a,b)=>a.y-b.y||a.index-b.index);let changed=false;for(const entry of entries){const conflicts=placed.filter(bound=>Math.abs(bound.x-entry.x)<gapX*3),minimum=conflicts.length?Math.max(...conflicts.map(bound=>bound.y+bound.half+entry.half+42)):-Infinity,y=Math.max(entry.y,minimum);if(Math.abs(y-entry.y)>.5){entry.root.position={x:entry.x,y};changed=true;}placed.push({...entry,y});}sheet.codescopeFreeLayoutVersion=4;if(changed){DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();}}
  const occupiedBounds=roots.flatMap(root=>root.position&&Number.isFinite(Number(root.position.x))&&Number.isFinite(Number(root.position.y))?[{x:Number(root.position.x),y:Number(root.position.y),half:Math.max(gapY*.55,span(root)*gapY*.5)}]:[]);
  roots.forEach((root,rootIndex)=>{const fallback=xmindDefaultFloatingPosition(rootIndex,roots.length),hasStored=!!(root.position&&Number.isFinite(Number(root.position.x))&&Number.isFinite(Number(root.position.y))),stored=hasStored?{x:Number(root.position.x),y:Number(root.position.y)}:null,rootPreview=XMIND_FLOAT_DRAG?.id===root.id&&XMIND_FLOAT_DRAG.preview;let origin=rootPreview||stored||fallback;const rootHalf=Math.max(gapY*.55,span(root)*gapY*.5);if(!rootPreview&&!stored){let guard=0;while(guard++<roots.length*3){const conflict=occupiedBounds.find(bound=>Math.abs(bound.x-origin.x)<gapX*1.4&&Math.abs(bound.y-origin.y)<bound.half+rootHalf+48);if(!conflict)break;origin={x:origin.x,y:conflict.y+conflict.half+rootHalf+48};}root.position={x:origin.x,y:origin.y};occupiedBounds.push({x:origin.x,y:origin.y,half:rootHalf});}const direction=/logic\.left/i.test(String(root.structureClass||''))?-1:1;
    const walk=(topic,parent,depth,position)=>{const off=topic.codescopeOffset,pinned=depth>0&&topic.position&&topic.position.fixed?{x:Number(topic.position.x)+(Number.isFinite(Number(topic.position.anchorX))?position.x-Number(topic.position.anchorX):0),y:Number(topic.position.y)+(Number.isFinite(Number(topic.position.anchorY))?position.y-Number(topic.position.anchorY):0)}:null,shifted=pinned||(off&&Number.isFinite(Number(off.dx))&&Number.isFinite(Number(off.dy))?{x:position.x+Number(off.dx),y:position.y+Number(off.dy)}:position);const current=XMIND_FLOAT_DRAG?.id===topic.id&&XMIND_FLOAT_DRAG.preview?XMIND_FLOAT_DRAG.preview:shifted;items.push({topic,parent,depth,position:current,root:!parent,colorIndex:rootIndex,direction});const children=xmindChildren(topic);if(!children.length)return;const total=children.reduce((sum,child)=>sum+span(child),0)+Math.max(0,children.length-1)*.14;let cursor=current.y-total*gapY*.5;children.forEach(child=>{const childSpan=span(child),y=cursor+childSpan*gapY*.5;cursor+=childSpan*gapY+gapY*.14;walk(child,topic,depth+1,{x:current.x+direction*gapX,y});});};walk(root,null,0,origin);
  });return items;
}
function xmindFloatingOrigin(){if(!XMIND_MAP)return null;const engine=$('xmind-engine'),node=XMIND_MAP.renderer?.root,element=node?.group?.node;if(!engine||!element)return null;const er=engine.getBoundingClientRect(),rr=element.getBoundingClientRect();return{x:rr.left-er.left+rr.width/2,y:rr.top-er.top+rr.height/2,scale:XMIND_MAP.view?.scale||1};}
function xmindToFloating(){const hit=xmindFind(XMIND_SELECTED);if(!hit||!hit.container||hit.isDetached)return;const engine=$('xmind-engine'),origin=xmindFloatingOrigin(),element=xmindSmmNode(hit.topic.id)?.group?.node,rect=element?.getBoundingClientRect(),er=engine.getBoundingClientRect(),scale=origin?.scale||1,index=hit.container.indexOf(hit.topic);if(index<0)return;hit.container.splice(index,1);hit.topic.position={x:rect?(rect.left-er.left+rect.width/2-origin.x)/scale:280,y:rect?(rect.top-er.top+rect.height/2-origin.y)/scale:0};delete hit.topic.codescopePosition;xmindDetached(true).push(hit.topic);xmindSheet().floatingTopicFlexible=true;xmindChanged();}
function xmindPositionEditor(id,scale){if(!XMIND_MAP)return;const node=xmindSmmNode(id)||XMIND_MAP.renderer?.root;if(Number.isFinite(scale))XMIND_MAP.view?.setScale?.(scale);if(node)XMIND_MAP.execCommand('GO_TARGET_NODE',node);}
function setXmindTheme(theme){const id=XMIND_THEMES[theme]?theme:'midnight',root=$('xmind-root');root.dataset.xmindTheme=id;$('xmind-theme-btn').textContent='外观 · '+XMIND_THEMES[id];$('xmind-theme-menu').querySelectorAll('button').forEach(button=>button.classList.toggle('on',button.dataset.theme===id));try{localStorage.setItem(xmindThemeStorageKey(),id);}catch(_){}if(XMIND_MAP){XMIND_ENGINE_SYNCING=true;XMIND_MAP.setThemeConfig(xmindSmmThemeConfig(id));XMIND_MAP.updateData(xmindToEditorData());XMIND_ENGINE_SYNCING=false;requestAnimationFrame(xmindRenderFloatingTopics);}}
function renderXmindOutlineSelection(syncEditor=true){
  if(XMIND_SELECTED&&!(XMIND_MULTI instanceof Set&&XMIND_MULTI.has(XMIND_SELECTED))&&!(window.__csXmindMerging&&window.__csXmindMerging()))XMIND_MULTI=new Set([XMIND_SELECTED]);document.querySelectorAll('.xmind-row').forEach(row=>row.classList.toggle('selected',row.dataset.id===XMIND_SELECTED||(XMIND_MULTI instanceof Set&&XMIND_MULTI.has(row.dataset.id))));if(syncEditor&&XMIND_VIEW==='edit'&&XMIND_MAP&&XMIND_SELECTED&&!xmindFind(XMIND_SELECTED)?.isDetached){const target=xmindSmmNode(XMIND_SELECTED);if(target){try{XMIND_MAP.execCommand('CLEAR_ACTIVE_NODE');XMIND_MAP.execCommand('SET_NODE_ACTIVE',target,true);}catch(_){}}}xmindUpdateUndo();
}
function xmindEditorAction(action){
  if(XMIND_VIEW!=='edit'||!XMIND_MAP||xmindFind(XMIND_SELECTED)?.isDetached)return false;const current=xmindSmmNode(XMIND_SELECTED)||XMIND_MAP.renderer?.activeNodeList?.[0];if(!current)return false;const before=xmindPreorderTopics().length;
  try{XMIND_MAP.execCommand('CLEAR_ACTIVE_NODE');XMIND_MAP.execCommand('SET_NODE_ACTIVE',current,true);if(action==='child')XMIND_MAP.execCommand('INSERT_CHILD_NODE');else if(action==='sibling')XMIND_MAP.execCommand('INSERT_NODE');else if(action==='parent')XMIND_MAP.execCommand('INSERT_PARENT_NODE');else if(action==='delete'){if(xmindFind(XMIND_SELECTED)?.container)XMIND_MAP.execCommand('REMOVE_NODE',[current]);}else if(action==='edit')XMIND_MAP.emit('node_dblclick',current,null);else return false;return action==='edit'||xmindPreorderTopics().length>before;}catch(error){console.error('[CodeScope] simple-mind-map 操作失败',error);setDrawStatus('导图操作失败：'+error.message,'err');return false;}
}
function xmindBeginEngineEdit(node){if(!XMIND_MAP||!node)return false;XMIND_MAP.execCommand('CLEAR_ACTIVE_NODE');XMIND_MAP.execCommand('SET_NODE_ACTIVE',node,true);XMIND_MAP.emit('node_dblclick',node,null);return true;}
async function renderXmindPreview(){
  const engine=$('xmind-engine'),empty=$('xmind-empty');if(!engine||!XMIND_WORKBOOK||!xmindRootTopic()||XMIND_VIEW!=='edit')return;empty.style.display='grid';empty.textContent='正在加载结构编辑器…';
  try{
    await ensureXmindEditorLib();if(!XMIND_WORKBOOK||XMIND_VIEW!=='edit')return;const MindMap=xmindEditorModule(),layout=xmindCurrentLayout(),data=xmindToEditorData(),themeConfig=xmindSmmThemeConfig(xmindCurrentTheme(),xmindStyleState(),layout);
    if(XMIND_MAP){XMIND_ENGINE_SYNCING=true;if(XMIND_MAP.getLayout()!==xmindSmmLayout(layout))XMIND_MAP.setLayout(xmindSmmLayout(layout),true);XMIND_MAP.setThemeConfig(themeConfig,true);XMIND_MAP.updateConfig({enableFreeDrag:false,isDisableDrag:true,useLeftKeySelectionRightKeyDrag:true,readonly:false,mousewheelAction:'move',enableAutoEnterTextEditWhenKeydown:true});const keepView=xmindMapTranslation();XMIND_MAP.updateData(data);xmindApplyViewport(keepView.x,keepView.y,keepView.scale);XMIND_ENGINE_SYNCING=false;empty.style.display='none';xmindUpdateViewportTools();requestAnimationFrame(xmindRenderFloatingTopics);return;}
    engine.replaceChildren();engine.classList.add('smm-engine');engine.tabIndex=0;XMIND_ENGINE_SYNCING=true;XMIND_MAP=new MindMap({el:engine,data,layout:xmindSmmLayout(layout),themeConfig,readonly:false,enableFreeDrag:false,isDisableDrag:true,useLeftKeySelectionRightKeyDrag:true,enableAutoEnterTextEditWhenKeydown:true,mousewheelAction:'move',mousewheelMoveStep:80,mousewheelZoomActionReverse:true,mouseScaleCenterUseMousePosition:true,minZoomRatio:20,maxZoomRatio:400,fit:true,fitPadding:72,resetScaleOnMoveNodeToCenter:false,defaultInsertSecondLevelNodeText:'新主题',defaultInsertBelowSecondLevelNodeText:'新主题'});XMIND_ENGINE_SYNCING=false;empty.style.display='none';
    /* ⚠️ 自由主题的图层是 append 到 #xmind-engine 里的 ✗ —— 地图每次重渲染（加子节点/切布局/撤销）
   都会把它一起清掉，而这里原来只同步数据、不重画图层 → 表现就是「新建子节点后自由主题全消失」✓
   ⇒ 数据变更后补一次重画（下一帧，等引擎渲染完）✓ */
    XMIND_MAP.on('data_change',next=>{xmindSyncFromEditor(true,next);requestAnimationFrame(xmindRenderFloatingTopics);});XMIND_MAP.on('node_active',(node,list)=>{const active=node||list?.[0]||XMIND_MAP.renderer?.activeNodeList?.[0],id=xmindEngineTopicId(active);if(id){XMIND_SELECTED=id;renderXmindOutlineSelection(false);}});XMIND_MAP.on('node_dragend',()=>{xmindSyncFromEditor(true);setDrawStatus('主题已移动；拖到目标主题可换父级，拖到兄弟间可调整顺序','ok');});XMIND_MAP.on('scale',xmindUpdateViewportTools);XMIND_MAP.on('translate',()=>{xmindUpdateViewportTools();requestAnimationFrame(xmindRenderFloatingTopics);});XMIND_MAP.on('back_forward',()=>xmindSyncFromEditor(true));
    /* 鼠标 / 键盘 / 框选 / 平移全部交给 assets/xmind-interaction.js ✓
       ⚠️ 原来写在这里 ✗：左键按在空白处就抢去平移画布 → 引擎的框选永远起不来（用户「无法选中」）✓
       重构后：左键 = 选（拖空白 = 框选）、右键 / 中键 / ✋ = 移，和 XMind / ProcessOn 一致 ✓ */
    if(window.__csXmindInteraction)window.__csXmindInteraction.bind(engine,XMIND_MAP);
    setDrawStatus('左键拖动空白框选；右键 / 中键拖动平移；双击空白新建自由主题','ok');const fitWhenVisible=(tries=0)=>{if(!XMIND_MAP||XMIND_VIEW!=='edit')return;const el=$('xmind-engine');if(!el||el.clientWidth<2||el.clientHeight<2){if(tries<60)setTimeout(()=>fitWhenVisible(tries+1),60);return;}xmindPlaceAll(true);xmindUpdateViewportTools();requestAnimationFrame(xmindRenderFloatingTopics);};setTimeout(()=>fitWhenVisible(),100);
  }catch(error){XMIND_ENGINE_SYNCING=false;empty.style.display='grid';empty.textContent='导图编辑器初始化失败：'+error.message;console.error('[CodeScope] simple-mind-map 初始化失败',error);setDrawStatus('导图引擎加载失败：'+error.message,'err');}
}

function wireDrawingPanel() {
  $('draw-head').onclick = toggleDrawPanel;
  $('draw-new-manual').onclick = (e) => { e.stopPropagation(); openDrawNewDialog('drawing'); };
  $('draw-new-folder').onclick = (e) => { e.stopPropagation(); openDrawNewDialog('folder'); };
  $('draw-nd-ok').onclick = submitDrawNewDialog;
  $('draw-nd-cancel').onclick = closeDrawNewDialog;
  $('draw-nd-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitDrawNewDialog(); });
  $('draw-back').onclick = () => closeDrawEditor(true);
  $('draw-ai-btn').onclick=()=>showDrawTool('ai');
  $('draw-xml-btn').onclick=()=>showDrawTool('xml');
  $('draw-tool-ai-tab').onclick=()=>showDrawTool('ai');
  $('draw-tool-xml-tab').onclick=()=>showDrawTool('xml');
  $('draw-tool-close').onclick=hideDrawTool;
  $('draw-ai-example').onclick=()=>{$('draw-ai-prompt').value=DRAW_TEST_PROMPT;$('draw-ai-prompt').focus();};
  $('draw-ai-generate').onclick=generateDrawioWithAi;
  $('draw-xml-validate').onclick=()=>{const checked=validateDrawioXmlLocal($('draw-xml-source').value);setDrawToolStatus(checked.ok?'✅ XML 有效 · '+checked.pages+' 页 · '+checked.cells+' 个单元':'❌ '+checked.error,checked.ok?'ok':'err');};
  $('draw-xml-format').onclick=()=>{try{$('draw-xml-source').value=prettyDrawioXml($('draw-xml-source').value);setDrawToolStatus('✅ 已格式化','ok');}catch(error){setDrawToolStatus('❌ '+error.message,'err');}};
  $('draw-xml-apply').onclick=()=>applyDrawioXml($('draw-xml-source').value,'XML 已校验并载入');
  $('xmind-add-child').onclick=xmindAddChild;$('xmind-add-sibling').onclick=xmindAddSibling;$('xmind-add-parent').onclick=xmindAddParent;$('xmind-add-floating').onclick=()=>xmindAddFloatingAt();$('xmind-to-floating').onclick=xmindToFloating;$('xmind-delete').onclick=xmindDelete;$('xmind-delete-single').onclick=xmindDeleteSingle;$('xmind-add-sheet').onclick=xmindAddSheet;$('xmind-delete-sheet').onclick=xmindDeleteSheet;$('xmind-undo').onclick=()=>xmindUndo(-1);$('xmind-redo').onclick=()=>xmindUndo(1);
  $('xmind-select-branch').onclick=()=>window.__csXmindSelectBranch&&window.__csXmindSelectBranch();$('xmind-select-siblings').onclick=()=>window.__csXmindSelectSiblings&&window.__csXmindSelectSiblings();$('xmind-outer-frame').onclick=()=>window.__csXmindAddFrame&&window.__csXmindAddFrame();$('xmind-summary').onclick=()=>window.__csXmindAddSummary&&window.__csXmindAddSummary();$('xmind-marker').onclick=(e)=>window.__csXmindMarkerMenu&&window.__csXmindMarkerMenu(e,XMIND_SELECTED);$('xmind-select-mode').onclick=()=>xmindSetToolMode('select');$('xmind-pan-mode').onclick=()=>xmindSetToolMode('pan');$('xmind-layout-select').onchange=()=>xmindSetLayout($('xmind-layout-select').value);$('xmind-line-style').onchange=xmindSetStyle;$('xmind-line-pattern').onchange=xmindSetStyle;$('xmind-node-shape').onchange=xmindSetStyle;$('xmind-zoom-out').onclick=()=>xmindZoom(-.12);$('xmind-zoom-in').onclick=()=>xmindZoom(.12);$('xmind-zoom-value').onclick=xmindResetZoom;$('xmind-center').onclick=xmindCenterEditor;$('xmind-collapse-all').onclick=()=>xmindSetAllExpanded(false);$('xmind-expand-all').onclick=()=>xmindSetAllExpanded(true);$('xmind-focus').onclick=xmindToggleEditorFocus;$('xmind-fit').onclick=()=>{if(XMIND_VIEW==='native')resetXmindNativeView();else if(XMIND_VIEW==='official'&&XMIND_OFFICIAL)XMIND_OFFICIAL.setFitMap();else xmindFitEditor();setTimeout(xmindUpdateViewportTools,0);};
  $('xmind-view-native').onclick=()=>setXmindView('native');$('xmind-view-official').onclick=openXmindOfficialView;$('xmind-view-edit').onclick=()=>setXmindView('edit');
  $('xmind-consent-cancel').onclick=()=>$('xmind-official-consent').classList.add('hidden');$('xmind-consent-ok').onclick=()=>{XMIND_OFFICIAL_APPROVED=true;$('xmind-official-consent').classList.add('hidden');openXmindOfficialView();};$('xmind-official-consent').onmousedown=event=>{if(event.target===$('xmind-official-consent'))$('xmind-official-consent').classList.add('hidden');};
  $('xmind-sheet-select').onchange=()=>{if(XMIND_MAP&&typeof XMIND_MAP.destroy==='function'){try{XMIND_MAP.destroy();}catch(_){}}XMIND_MAP=null;$('xmind-engine').replaceChildren();XMIND_SHEET_INDEX=Math.max(0,Number($('xmind-sheet-select').value)||0);XMIND_SELECTED=xmindRootTopic().id;renderXmindSheets();renderXmindOutline();if(XMIND_VIEW==='official'&&XMIND_OFFICIAL){XMIND_OFFICIAL.switchSheet(xmindSheet().id);setXmindView('official');}else setXmindView(XMIND_SHEET_INDEX===0&&XMIND_THUMBNAIL?'native':'edit');};
  $('xmind-sheet-title').oninput=()=>{const sheet=xmindSheet();if(!sheet)return;sheet.title=$('xmind-sheet-title').value;xmindMarkSnapshotDirty();DRAW_PENDING={workbook:xmindClone(XMIND_WORKBOOK)};scheduleDrawSave();xmindQueueRecord();};$('xmind-sheet-title').onblur=()=>{xmindRecord();renderXmindSheets();};
  const nativeView=$('xmind-native-view');nativeView.addEventListener('wheel',(event)=>{if(DRAW_KIND!=='xmind'||XMIND_VIEW!=='native')return;event.preventDefault();if(event.ctrlKey||event.metaKey){XMIND_NATIVE_SCALE=Math.max(.2,Math.min(5,XMIND_NATIVE_SCALE*Math.exp(-event.deltaY*.002)));}else{XMIND_NATIVE_X-=event.deltaX;XMIND_NATIVE_Y-=event.deltaY;}renderXmindNativeTransform();xmindUpdateViewportTools();},{passive:false});nativeView.addEventListener('pointerdown',(event)=>{if(event.button!==0)return;XMIND_NATIVE_DRAG={x:event.clientX,y:event.clientY,ox:XMIND_NATIVE_X,oy:XMIND_NATIVE_Y};nativeView.setPointerCapture(event.pointerId);nativeView.classList.add('dragging');});nativeView.addEventListener('pointermove',(event)=>{if(!XMIND_NATIVE_DRAG)return;XMIND_NATIVE_X=XMIND_NATIVE_DRAG.ox+event.clientX-XMIND_NATIVE_DRAG.x;XMIND_NATIVE_Y=XMIND_NATIVE_DRAG.oy+event.clientY-XMIND_NATIVE_DRAG.y;renderXmindNativeTransform();});nativeView.addEventListener('pointerup',(event)=>{XMIND_NATIVE_DRAG=null;nativeView.classList.remove('dragging');try{nativeView.releasePointerCapture(event.pointerId);}catch(_){}});nativeView.addEventListener('pointercancel',()=>{XMIND_NATIVE_DRAG=null;nativeView.classList.remove('dragging');});nativeView.ondblclick=resetXmindNativeView;
  const outlineResizer=$('xmind-outline-resizer');let outlineResize=null;outlineResizer.addEventListener('pointerdown',event=>{if(event.button!==0)return;const workspace=outlineResizer.parentElement,current=$('xmind-outline').getBoundingClientRect().width;outlineResize={pointerId:event.pointerId,start:event.clientX,width:current,workspace};outlineResizer.classList.add('dragging');try{outlineResizer.setPointerCapture(event.pointerId);}catch(_){}event.preventDefault();event.stopPropagation();});outlineResizer.addEventListener('pointermove',event=>{if(!outlineResize||outlineResize.pointerId!==event.pointerId)return;xmindSetOutlineWidth(outlineResize.width+event.clientX-outlineResize.start,false);event.preventDefault();});const finishOutlineResize=event=>{if(!outlineResize||outlineResize.pointerId!==event.pointerId)return;const width=$('xmind-outline').getBoundingClientRect().width;outlineResize=null;outlineResizer.classList.remove('dragging');try{outlineResizer.releasePointerCapture(event.pointerId);}catch(_){}xmindSetOutlineWidth(width,true);};outlineResizer.addEventListener('pointerup',finishOutlineResize);outlineResizer.addEventListener('pointercancel',finishOutlineResize);outlineResizer.addEventListener('dblclick',()=>xmindSetOutlineWidth(340,true));outlineResizer.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();const current=$('xmind-outline').getBoundingClientRect().width;xmindSetOutlineWidth(event.key==='Home'?340:current+(event.key==='ArrowRight'?16:-16),true);});
  const themeMenu=$('xmind-theme-menu');$('xmind-theme-btn').onclick=(event)=>{event.stopPropagation();themeMenu.classList.toggle('hidden');$('xmind-shortcuts').classList.add('hidden');};themeMenu.querySelectorAll('button').forEach(button=>button.onclick=(event)=>{event.stopPropagation();setXmindTheme(button.dataset.theme);themeMenu.classList.add('hidden');});
  const moreMenu=$('xmind-more'),closeXmindPopovers=(event)=>{if(!event.target.closest('.xmind-theme-wrap'))themeMenu.classList.add('hidden');if(!event.target.closest('#xmind-shortcuts')&&!event.target.closest('#xmind-shortcuts-btn'))$('xmind-shortcuts').classList.add('hidden');if(!event.target.closest('#xmind-more'))moreMenu.removeAttribute('open');};$('xmind-shortcuts-btn').onclick=(event)=>{event.stopPropagation();moreMenu.removeAttribute('open');$('xmind-shortcuts').classList.toggle('hidden');themeMenu.classList.add('hidden');};$('xmind-shortcuts-close').onclick=()=>$('xmind-shortcuts').classList.add('hidden');moreMenu.querySelectorAll('button').forEach(button=>{if(button.id!=='xmind-shortcuts-btn')button.addEventListener('click',()=>moreMenu.removeAttribute('open'));});window.addEventListener('pointerdown',closeXmindPopovers,{capture:true});document.addEventListener('click',closeXmindPopovers,{capture:true});
  $('xmind-root').addEventListener('keydown',(event)=>{
    if(DRAW_KIND!=='xmind'||event.target.closest('#xmind-engine'))return;const mod=event.metaKey||event.ctrlKey,key=event.key.toLowerCase(),editing=event.target.classList.contains('xmind-title');
    if(mod&&key==='z'){event.preventDefault();xmindUndo(event.shiftKey?1:-1);return;}if(mod&&key==='y'){event.preventDefault();xmindUndo(1);return;}
    if(mod&&(key==='+'||key==='='||key==='-'||key==='0')){event.preventDefault();if(key==='+'||key==='=')xmindZoom(.12);else if(key==='-')xmindZoom(-.12);else xmindResetZoom();return;}
    if(mod&&event.key==='Enter'){event.preventDefault();xmindAddParent();return;}if(event.altKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();xmindReorder(event.key==='ArrowUp'?-1:1);return;}
    if(mod&&key==='/'){event.preventDefault();xmindToggleFold(event.altKey||event.shiftKey);return;}if(mod&&key==='r'){event.preventDefault();XMIND_SELECTED=xmindRootTopic().id;XMIND_COLLAPSED.delete(XMIND_SELECTED);renderXmindOutline();xmindFocusTitle();return;}
    if(mod&&(event.key==='Delete'||event.key==='Backspace')){event.preventDefault();xmindDeleteSingle();return;}
    if(editing){if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();xmindAddSibling();}else if(event.key==='Tab'){event.preventDefault();if(event.shiftKey)xmindUnindent();else xmindAddChild();}else if(event.key==='Escape'){event.preventDefault();event.target.blur();}else if(event.key==='Enter'&&event.shiftKey)setTimeout(()=>xmindResizeTitle(event.target),0);return;}
    if(event.key==='Enter'){event.preventDefault();xmindAddSibling();}else if(event.key==='Tab'){event.preventDefault();event.shiftKey?xmindUnindent():xmindAddChild();}else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();xmindDelete();}else if(event.key===' '||event.key==='F2'){event.preventDefault();event.target.closest('#xmind-preview')?xmindStartPreviewEdit():xmindFocusTitle();}else if(event.key==='ArrowUp'){event.preventDefault();xmindSelectVisible(-1);}else if(event.key==='ArrowDown'){event.preventDefault();xmindSelectVisible(1);}else if(event.key==='ArrowLeft'){event.preventDefault();xmindSelectParent();}else if(event.key==='ArrowRight'){event.preventDefault();xmindSelectChild();}else if(event.key==='Escape'){$('xmind-shortcuts').classList.add('hidden');themeMenu.classList.add('hidden');moreMenu.removeAttribute('open');}
  });
  $('draw-tool-dialog').addEventListener('mousedown',(event)=>{if(event.target===$('draw-tool-dialog'))hideDrawTool();});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&$('draw-tool-dialog').classList.contains('open'))hideDrawTool();});
  $('pane-draw').classList.toggle('collapsed', !DRAW_OPEN);
  window.addEventListener('message', onDrawioMessage);
  wireLibDownloadCapture();   // 一次性：拦截「下载库」→ 存到 vault/libraries/
  // 离开页面前把未保存改动写盘（keepalive 尽力而为）
  window.addEventListener('beforeunload', () => {
    if (DRAW_FILE && DRAW_PENDING) {
      clearTimeout(DRAW_SAVE_T);
      const data = DRAW_KIND === 'drawio' ? { xml: DRAW_PENDING.xml || '' } : (DRAW_KIND === 'xmind' ? { workbook:DRAW_PENDING.workbook } : sanitizeScene(DRAW_PENDING));
      try { fetch('/api/drawings/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: DRAW_FILE, data }), keepalive: true }); } catch (_) {}
    }
    flushLibSave(LIB_ITEMS);
  });
  renderDrawList();
}
window.addEventListener('DOMContentLoaded', wireDrawingPanel);
