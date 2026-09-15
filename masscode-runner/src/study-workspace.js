import { GoldenLayout } from 'golden-layout';
import { FEATURED_SITES, SITE_CATEGORIES } from './study-sites.js';

const $ = (id) => document.getElementById(id);
const TYPE_TITLES = { browser:'网页 / 视频', code:'代码', notes:'Markdown 笔记', pdf:'PDF / 文档' };
const DEFAULT_BOOKMARKS = FEATURED_SITES;

let layout = null;
let appConfig = { title:'学习工作台', preset:'study', bookmarks:DEFAULT_BOOKMARKS, categories:[], hiddenSites:[], layout:null };
let saveTimer = 0;
let resizeObserver = null;
let activePane = null;
let activeNote = null;
let opened = false;
let siteMenuCategory = 'featured';
let siteMenuQuery = '';
let editingSiteUrl = '';
let editingCategoryId = '';
let draggingSite = null;
const paneRecords = new Set();

function status(message, kind = '') {
  const node = $('study-status');
  if (!node) return;
  node.textContent = message;
  node.className = kind;
}

async function json(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({ ok:false, error:'服务返回格式不正确' }));
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function markdownHtml(source) {
  const videos = [];
  const prepared = String(source || '').replace(/\[\[video:(https?:\/\/[^\]|]+)(?:\|([^\]]+))?\]\]/gi, (token, rawUrl, rawLabel) => {
    try {
      const target = cleanUrl(rawUrl), embed = biliEmbedUrl(target);
      if (!embed) return token;
      const key = `CODESCOPE_VIDEO_NODE_${videos.length}_END`;
      videos.push({ key, target, embed, label:String(rawLabel || 'B站视频').trim().slice(0, 80) || 'B站视频' });
      return key;
    } catch (_) { return token; }
  });
  let html = typeof window.renderMd === 'function'
    ? window.renderMd(prepared)
    : escapeHtml(prepared).replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/\n/g, '<br>');
  videos.forEach((video) => {
    const node = `<figure class="study-note-video"><iframe src="${escapeHtml(video.embed)}" title="${escapeHtml(video.label)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe><figcaption><span>▶ ${escapeHtml(video.label)}</span><a href="${escapeHtml(video.target)}" target="_blank" rel="noopener noreferrer">在 B站打开 ↗</a></figcaption></figure>`;
    html = html.replace(video.key, node);
  });
  return html;
}

function component(type, state = {}, title = TYPE_TITLES[type]) {
  return { type:'component', componentType:type, componentState:state, title, isClosable:true };
}

function stack(child) { return { type:'stack', content:[child] }; }

function presetConfig(name, browserUrl = 'https://www.bilibili.com') {
  const browser = stack(component('browser', { url:browserUrl }, '网页 / B站'));
  const notes = stack(component('notes', { noteId:'main', mode:'edit' }, '学习笔记'));
  const code = stack(component('code', {}, '代码'));
  const pdf = stack(component('pdf', {}, 'PDF / 文档'));
  let root;
  if (name === 'dual') root = { type:'row', content:[browser, code] };
  else if (name === 'notes') root = { type:'row', content:[browser, notes] };
  else if (name === 'quad') root = { type:'row', content:[{ type:'column', content:[browser, pdf] }, { type:'column', content:[code, notes] }] };
  else root = { type:'row', content:[browser, { type:'column', content:[code, notes] }] };
  return {
    root,
    settings:{ constrainDragToContainer:true, reorderEnabled:true, popoutWholeStack:false, blockedPopoutsThrowError:false, closePopoutsOnUnload:true, responsiveMode:'always', tabOverlapAllowance:0, reorderOnTabMenuClick:true, tabControlOffset:10 },
    dimensions:{ borderWidth:7, borderGrabWidth:11, minItemHeight:150, minItemWidth:260, headerHeight:32, dragProxyWidth:320, dragProxyHeight:200 },
    header:{ show:'top', popout:false, maximise:'专注窗格', close:'关闭窗格', minimise:'恢复窗格', tabDropdown:'更多标签' },
  };
}

function layoutShape(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'component') return String(node.componentType || '');
  const children = Array.isArray(node.content) ? node.content.map(layoutShape).filter(Boolean) : [];
  if (node.type === 'stack') return children.length === 1 ? children[0] : `stack(${children.join(',')})`;
  return `${node.type || 'root'}(${children.join(',')})`;
}

function matchingPreset(config) {
  const shape = layoutShape(config && config.root);
  return ['study','dual','notes','quad'].find((name) => layoutShape(presetConfig(name).root) === shape) || 'custom';
}

function syncPresetToLayout(config) {
  const preset = matchingPreset(config); appConfig.preset = preset;
  if ($('study-preset')) $('study-preset').value = preset;
  return preset;
}

function paneRoot(container, kind) {
  const root = document.createElement('section');
  root.className = `study-pane study-${kind}`;
  root.dataset.kind = kind;
  container.element.appendChild(root);
  const record = { root, kind, container, api:null };
  paneRecords.add(record);
  const activate = () => {
    if (activePane && activePane.root !== root) activePane.root.classList.remove('active');
    activePane = record;
    root.classList.add('active');
    if (kind === 'notes') activeNote = record.api;
  };
  root.addEventListener('pointerdown', activate, true);
  root.addEventListener('focusin', activate);
  container.on('destroy', () => {
    paneRecords.delete(record);
    if (activePane === record) activePane = null;
    if (activeNote === record.api) activeNote = null;
  });
  setTimeout(activate, 0);
  return record;
}

function button(label, title, click) {
  const node = document.createElement('button');
  node.type = 'button'; node.textContent = label; node.title = title || label; node.onclick = click;
  return node;
}

function input(className, value, placeholder) {
  const node = document.createElement('input');
  node.className = className; node.value = value || ''; node.placeholder = placeholder || ''; node.spellcheck = false;
  return node;
}

function cleanUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (/^BV[0-9A-Za-z]+$/i.test(value)) value = `https://www.bilibili.com/video/${value}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http 或 https 网页');
  return parsed.toString();
}

function biliEmbedUrl(source) {
  let url;
  try { url = new URL(source); } catch (_) { return ''; }
  const match = /\/(?:video\/)?(BV[0-9A-Za-z]+)/i.exec(url.pathname) || /[?&]bvid=(BV[0-9A-Za-z]+)/i.exec(url.search);
  if (!match) return '';
  const page = Math.max(1, Number(url.searchParams.get('p')) || 1);
  const rawTime = url.searchParams.get('t') || '0';
  const time = /^\d+$/.test(rawTime) ? Number(rawTime) : 0;
  const embed = new URL('https://player.bilibili.com/player.html');
  embed.searchParams.set('bvid', match[1]);
  embed.searchParams.set('p', String(page));
  embed.searchParams.set('autoplay', '0');
  embed.searchParams.set('danmaku', '1');
  if (time) embed.searchParams.set('t', String(time));
  return embed.toString();
}

function biliVideoInfo(source) {
  let url;
  try { url = new URL(source); } catch (_) { return null; }
  const match = /\/(?:video\/)?(BV[0-9A-Za-z]+)/i.exec(url.pathname) || /[?&]bvid=(BV[0-9A-Za-z]+)/i.exec(url.search);
  if (!match) return null;
  return { bvid:match[1], page:Math.max(1, Number(url.searchParams.get('p')) || 1), time:Math.max(0, Number(url.searchParams.get('t')) || 0), url };
}

function parseVideoTime(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Math.floor(Number(text)));
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) throw new Error('时间点请使用秒数、mm:ss 或 hh:mm:ss');
  return Math.floor(parts.reduce((total, part) => total * 60 + part, 0));
}

function videoUrlAt(source, seconds) {
  const url = new URL(source); url.searchParams.set('t', String(Math.max(0, Math.floor(seconds || 0)))); return url.toString();
}

function safeReadableHtml(html, baseUrl) {
  const parsed = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
  parsed.querySelectorAll('script,style,noscript,iframe,object,embed,form,input,button,textarea,select,meta,link,base,svg,canvas').forEach((node) => node.remove());
  parsed.querySelectorAll('*').forEach((node) => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || ['style','srcdoc','formaction','action','integrity'].includes(name)) node.removeAttribute(attr.name);
    }
    for (const name of ['href','src','poster']) {
      const raw = node.getAttribute(name); if (!raw) continue;
      try { const resolved = new URL(raw, baseUrl); if (!['http:','https:'].includes(resolved.protocol)) throw new Error(); node.setAttribute(name, resolved.toString()); }
      catch (_) { node.removeAttribute(name); }
    }
    node.removeAttribute('srcset');
    if (node.tagName === 'IMG') { node.loading = 'lazy'; node.decoding = 'async'; }
  });
  return parsed.body.innerHTML;
}

function browserDirectPreferred(source) {
  try {
    const host = new URL(source).hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^(?:127\.|10\.|192\.168\.)/.test(host)) return true;
    const match = /^(172|100)\.(\d+)\./.exec(host);
    return !!match && ((match[1] === '172' && Number(match[2]) >= 16 && Number(match[2]) <= 31) || (match[1] === '100' && Number(match[2]) >= 64 && Number(match[2]) <= 127));
  } catch (_) { return false; }
}

function externalOpen(url) {
  const target = cleanUrl(url);
  window.open(target, '_blank', 'noopener,noreferrer');
}

function openBiliBrowser(url = 'https://www.bilibili.com/') {
  const target = cleanUrl(url || 'https://www.bilibili.com/');
  const width = Math.max(760, Math.floor((window.screen?.availWidth || 1440) * .62));
  const height = Math.max(640, Math.floor((window.screen?.availHeight || 900) * .9));
  const popup = window.open(target, 'codescope-bilibili-browser', `popup=yes,width=${width},height=${height},left=24,top=24,resizable=yes,scrollbars=yes`);
  if (!popup) { status('浏览器阻止了 B站学习窗口，请允许 CodeScope 打开弹窗', 'err'); return null; }
  try { popup.focus(); } catch (_) {}
  status('完整 B站已打开：登录并选择视频，复制链接后回到 CodeScope 载入', 'ok');
  return popup;
}

async function pasteBiliVideo(navigate) {
  let raw = '';
  try { raw = await navigator.clipboard?.readText?.(); } catch (_) {}
  if (!raw) raw = window.prompt('粘贴从 B站复制的视频链接或 BV 号') || '';
  if (!raw) return;
  try {
    const target = cleanUrl(raw); if (!biliEmbedUrl(target) && !/\/\/(?:b23\.tv)(?:\/|$)/i.test(target)) throw new Error('剪贴板中不是 B站视频链接或 BV 号');
    await navigate(target);
  } catch (error) { status(error.message, 'err'); }
}

function browserStart(root, navigate) {
  const host = document.createElement('div');
  host.className = 'study-code-empty';
  const box = document.createElement('div');
  box.innerHTML = '<div style="font-size:34px;margin-bottom:12px">▶</div><strong style="font-size:17px;color:#f1f5fb">B站视频学习</strong><p style="max-width:520px;color:#8392a7">先在完整 B站窗口登录、搜索并选择视频，复制视频链接后回到这里一键载入。账号与登录 Cookie 只留在 B站，不经过 CodeScope。</p>';
  const row = document.createElement('div'); row.className = 'study-bili-start-actions';
  const url = input('study-url', '', 'BV号或 B站视频链接');
  const go = button('载入视频', '在当前窗格播放', () => navigate(url.value));
  const paste = button('从剪贴板载入', '读取刚从 B站复制的视频链接', () => pasteBiliVideo(navigate));
  const open = button('打开完整 B站', '在第一方 B站窗口登录、搜索和选择视频', () => openBiliBrowser());
  url.onkeydown = (event) => { if (event.key === 'Enter') go.click(); };
  row.append(url, go, paste, open); box.appendChild(row); host.appendChild(box); root.replaceChildren(host);
}

function createBrowser(container, initialState) {
  const state = { url:'https://www.bilibili.com', history:[], index:-1, mode:'start', videoTime:0, ...(initialState || {}) };
  const record = paneRoot(container, 'browser'), root = record.root;
  const toolbar = document.createElement('div'); toolbar.className = 'study-pane-toolbar';
  const back = button('←', '后退', () => { if (state.index > 0) show(state.history[--state.index], false); });
  const forward = button('→', '前进', () => { if (state.index + 1 < state.history.length) show(state.history[++state.index], false); });
  const reload = button('↻', '重新加载', () => show(state.url, false, true, state.mode));
  const urlInput = input('study-url', state.url, '粘贴网页、B站视频或资料地址');
  const go = button('打开', '在当前窗格打开；公网网页默认使用可导航阅读视图', () => navigate(urlInput.value));
  const readable = button('阅读', '使用站内阅读视图加载网页', () => show(state.url, false, true, 'readable'));
  const embedded = button('嵌入', '直接嵌入动态网页；目标网站可能拒绝显示', () => show(state.url, false, true, 'embedded'));
  const quote = button('＋引用', '把当前网页地址插入活动笔记', () => insertReference());
  const videoTools = document.createElement('div'); videoTools.className = 'study-video-tools'; videoTools.hidden = true;
  const timeInput = input('study-video-time', '', '00:00'); timeInput.setAttribute('aria-label', '视频时间点'); timeInput.title = '输入播放器当前时间：秒数、mm:ss 或 hh:mm:ss';
  const moment = button('＋时间点', '把当前填写的视频时间点插入笔记', () => insertMoment()); moment.className = 'study-video-moment';
  const video = button('＋视频节点', '把当前 B站视频和时间点作为可播放节点插入笔记', () => insertVideo());
  const frameButton = button('▣ 视频帧', '只截取当前播放器画面并与时间点一起插入笔记', () => captureVideoFrame()); frameButton.className = 'study-video-frame';
  const chooseVideo = button('◫ B站浏览', '打开可登录、搜索和自由选视频的完整 B站窗口', () => openBiliBrowser(state.url)); chooseVideo.className = 'study-bili-browser';
  const pasteVideo = button('粘贴载入', '读取从 B站复制的视频链接并切换播放器', () => pasteBiliVideo(navigate)); pasteVideo.className = 'study-bili-paste';
  videoTools.append(chooseVideo, pasteVideo, timeInput, moment, video, frameButton);
  const outside = button('↗ 原网页', '在浏览器新标签页打开', () => externalOpen(state.url));
  toolbar.append(back, forward, reload, urlInput, go, readable, embedded, quote, videoTools, outside);
  const body = document.createElement('div'); body.className = 'study-pane-body';
  root.append(toolbar, body);
  let readableToken = 0, currentFrame = null;

  function syncButtons() { back.disabled = state.index <= 0; forward.disabled = state.index + 1 >= state.history.length; }
  async function navigate(raw) {
    try {
      let target = cleanUrl(raw);
      if (/\/\/(?:b23\.tv)(?:\/|$)/i.test(target)) {
        status('正在解析 B站短链接…');
        target = (await json('/api/study/resolve-url?url=' + encodeURIComponent(target))).url;
      }
      show(target, true);
    } catch (error) { status(error.message, 'err'); }
  }
  function updateState(target, push) {
    state.url = target; urlInput.value = target;
    if (push && state.history[state.index] !== target) {
      state.history = state.history.slice(0, state.index + 1); state.history.push(target); state.index = state.history.length - 1;
    }
    syncButtons(); scheduleSave();
  }
  function setVideoTools(info) {
    videoTools.hidden = !info;
    quote.hidden = !!info;
    if (info) { state.videoTime = info.time || state.videoTime || 0; timeInput.value = formatTime(state.videoTime); }
  }
  function show(target, push = true, force = false, requestedMode = '') {
    updateState(target, push);
    const embed = biliEmbedUrl(target);
    const info = biliVideoInfo(target); setVideoTools(info);
    if (!embed && /^https?:\/\/(?:www\.)?bilibili\.com\/?(?:[?#].*)?$/i.test(target)) { state.mode = 'start'; root.classList.remove('study-bili'); browserStart(body, navigate); status('粘贴 B站视频链接或 BV 号即可开始学习', 'ok'); return; }
    if (embed) return showVideo(embed, info, force);
    root.classList.remove('study-bili'); currentFrame = null;
    if (requestedMode === 'embedded' || (!requestedMode && browserDirectPreferred(target))) return showEmbedded(target, force);
    showReadable(target, force);
  }
  function showVideo(embed, info, force) {
    const frame = document.createElement('iframe');
    frame.title = 'B站视频播放器';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-read; clipboard-write');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation');
    frame.src = embed; currentFrame = frame; state.mode = 'video';
    const hint = document.createElement('div'); hint.className = 'study-video-hint'; hint.textContent = '在时间框填写播放器当前时间，可记录时间点或截取这一帧';
    body.replaceChildren(frame, hint); root.classList.add('study-bili');
    status(force ? 'B站播放器已刷新' : `B站视频已载入${info && info.time ? ` · ${formatTime(info.time)}` : ''}`, 'ok');
  }
  function showEmbedded(target, force) {
    state.mode = 'embedded';
    const frame = document.createElement('iframe'); frame.title = '嵌入网页'; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-read; clipboard-write');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation'); frame.src = target;
    const help = document.createElement('div'); help.className = 'study-web-help'; help.innerHTML = '网站拒绝嵌入或显示空白？ <a href="#">切换阅读视图</a> · <a href="#">原网页打开</a>';
    const links = help.querySelectorAll('a'); links[0].onclick = (event) => { event.preventDefault(); show(state.url, false, true, 'readable'); }; links[1].onclick = (event) => { event.preventDefault(); externalOpen(state.url); };
    body.replaceChildren(frame, help); status(force ? '嵌入网页已刷新' : '已使用网页嵌入模式', 'ok');
  }
  function wireReadableLinks(host, baseUrl) {
    host.querySelectorAll('a[href]').forEach((anchor) => {
      let target; try { target = new URL(anchor.getAttribute('href'), baseUrl); } catch (_) { return; }
      if (!['http:','https:'].includes(target.protocol)) return;
      anchor.href = target.toString(); anchor.removeAttribute('target'); anchor.removeAttribute('rel');
      anchor.onclick = (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (target.hash && target.origin + target.pathname + target.search === new URL(state.url).origin + new URL(state.url).pathname + new URL(state.url).search) {
          const id = decodeURIComponent(target.hash.slice(1)); const hit = host.querySelector('#' + (window.CSS?.escape ? CSS.escape(id) : id.replace(/[^A-Za-z0-9_-]/g, '')));
          if (hit) { hit.scrollIntoView({ block:'start' }); return; }
        }
        navigate(target.toString());
      };
    });
  }
  async function showReadable(target, force) {
    const token = ++readableToken; state.mode = 'readable'; currentFrame = null;
    try {
      status('正在提取网页正文…');
      const result = await json('/api/study/readable?url=' + encodeURIComponent(target) + (force ? '&refresh=1' : '')); if (token !== readableToken) return;
      if (result.url && result.url !== state.url) updateState(result.url, false);
      const shell = document.createElement('div'); shell.className = 'study-readable-view';
      const nav = document.createElement('nav'); nav.className = 'study-readable-nav';
      const article = document.createElement('article'); article.className = 'study-readable-article'; article.innerHTML = safeReadableHtml(result.html, result.url || target);
      if (result.title && !article.querySelector('h1')) { const heading = document.createElement('h1'); heading.textContent = result.title; article.prepend(heading); }
      if (result.navigationHtml) nav.innerHTML = safeReadableHtml(result.navigationHtml, result.navigationUrl || result.url || target);
      if (nav.querySelector('a[href]')) { const filter = input('study-readable-filter', '', '筛选目录…'); filter.oninput = () => { const query = filter.value.trim().toLowerCase(); nav.querySelectorAll('li').forEach((item) => { item.hidden = !!query && !item.textContent.toLowerCase().includes(query); }); }; const side = document.createElement('aside'); const label = document.createElement('strong'); label.textContent = '网页目录'; side.append(label, filter, nav); shell.append(side, article); wireReadableLinks(nav, result.navigationUrl || result.url || target); }
      else shell.appendChild(article);
      wireReadableLinks(article, result.url || target); body.replaceChildren(shell); status(force ? '网页阅读视图已刷新' : '网页已在工作台载入，可继续点击页面链接', 'ok');
    } catch (error) {
      if (token !== readableToken) return;
      const failed = document.createElement('div'); failed.className = 'study-web-failed'; failed.innerHTML = `<strong>当前网址无法在工作台读取</strong><p>${escapeHtml(error.message)}</p>`;
      const direct = button('尝试嵌入', '尝试直接加载动态网页', () => show(state.url, false, true, 'embedded')), outsideButton = button('原网页打开', '在新标签打开', () => externalOpen(state.url)); failed.append(direct, outsideButton); body.replaceChildren(failed); status('阅读视图失败：' + error.message, 'err');
    }
  }
  function insertReference() {
    insertIntoNote(`[网页资料 · ${new URL(state.url).hostname}](${state.url})\n`);
  }
  function selectedTime() {
    const seconds = parseVideoTime(timeInput.value); state.videoTime = seconds; timeInput.value = formatTime(seconds); return seconds;
  }
  function insertMoment() {
    if (!biliVideoInfo(state.url)) { status('请先打开一个 B站视频', 'err'); return; }
    try { const seconds = selectedTime(), target = videoUrlAt(state.url, seconds); insertIntoNote(`- [▶ ${formatTime(seconds)} · B站视频时间点](${target})\n`); }
    catch (error) { status(error.message, 'err'); }
  }
  function insertVideo() {
    if (!biliEmbedUrl(state.url)) { status('视频节点目前支持 B站视频链接或 BV 号', 'err'); return; }
    try { const seconds = selectedTime(), target = videoUrlAt(state.url, seconds); insertIntoNote(`[[video:${target}|B站视频 · ${formatTime(seconds)}]]\n`); }
    catch (error) { status(error.message, 'err'); }
  }
  async function captureVideoFrame() {
    if (!currentFrame || !biliVideoInfo(state.url)) { status('请先打开一个 B站视频', 'err'); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) { status('视频帧提取需要 localhost/HTTPS 和浏览器标签页捕获权限', 'err'); return; }
    let stream;
    try {
      const seconds = selectedTime(); status('请选择“当前 CodeScope 标签页”，只会保留播放器区域…');
      stream = await navigator.mediaDevices.getDisplayMedia({ video:{ displaySurface:'browser' }, audio:false, preferCurrentTab:true, selfBrowserSurface:'include' });
      const track = stream.getVideoTracks()[0], surface = track?.getSettings?.().displaySurface;
      if (surface && surface !== 'browser') throw new Error('请共享当前浏览器标签页，而不是整个屏幕或窗口');
      const capture = document.createElement('video'); capture.srcObject = stream; capture.muted = true; await capture.play();
      if (!capture.videoWidth) await new Promise((resolve) => { capture.onloadedmetadata = resolve; setTimeout(resolve, 1200); });
      const rect = currentFrame.getBoundingClientRect(), scaleX = capture.videoWidth / Math.max(1, window.innerWidth), scaleY = capture.videoHeight / Math.max(1, window.innerHeight);
      const sx = Math.max(0, Math.round(rect.left * scaleX)), sy = Math.max(0, Math.round(rect.top * scaleY));
      const sw = Math.max(1, Math.min(capture.videoWidth - sx, Math.round(rect.width * scaleX))), sh = Math.max(1, Math.min(capture.videoHeight - sy, Math.round(rect.height * scaleY)));
      if (sw < 120 || sh < 80) throw new Error('当前播放器区域太小，无法生成清晰视频帧');
      const maxWidth = 1600, ratio = Math.min(1, maxWidth / sw), canvas = document.createElement('canvas'); canvas.width = Math.round(sw * ratio); canvas.height = Math.round(sh * ratio);
      canvas.getContext('2d').drawImage(capture, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9)); if (!blob) throw new Error('无法生成视频帧');
      const result = await json('/api/study/asset?title=' + encodeURIComponent(`B站视频帧 ${formatTime(seconds)}`), { method:'POST', headers:{ 'Content-Type':'image/jpeg' }, body:blob });
      const target = videoUrlAt(state.url, seconds); insertIntoNote(`[${result.markdown}](${target})\n\n> 视频时间点：[${formatTime(seconds)}](${target})\n`); status(`视频帧 ${formatTime(seconds)} 已插入活动笔记`, 'ok');
    } catch (error) { if (error?.name === 'NotAllowedError') status('已取消视频帧提取'); else status('视频帧提取失败：' + error.message, 'err'); }
    finally { stream?.getTracks().forEach((track) => track.stop()); }
  }
  urlInput.onkeydown = (event) => { if (event.key === 'Enter') navigate(urlInput.value); };
  timeInput.onkeydown = (event) => { if (event.key === 'Enter') insertMoment(); };
  record.api = { navigate, state, insertMoment, captureVideoFrame };
  container.stateRequestEvent = () => ({ url:state.url, history:state.history.slice(-20), index:Math.min(state.index, 19), mode:state.mode, videoTime:state.videoTime });
  if (Array.isArray(state.history) && state.history.length) { state.index = Math.max(0, Math.min(Number(state.index) || 0, state.history.length - 1)); show(state.history[state.index], false, false, state.mode); }
  else navigate(state.url);
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function createNotes(container, initialState) {
  const state = { noteId:'main', mode:'edit', ...(initialState || {}) };
  const record = paneRoot(container, 'notes'), root = record.root;
  const head = document.createElement('div'); head.className = 'study-note-head';
  const title = document.createElement('strong'); title.textContent = 'Markdown 学习笔记';
  const noteStatus = document.createElement('span'); noteStatus.className = 'study-note-status'; noteStatus.textContent = '正在载入…';
  const spacer = document.createElement('span'); spacer.className = 'sp';
  const edit = button('编辑', 'Markdown 源码编辑', () => setMode('edit'));
  const previewButton = button('阅读', '渲染 Markdown', () => setMode('preview'));
  const addVideo = button('＋视频', '粘贴 B站链接并插入可播放视频节点', () => {
    const raw = window.prompt('粘贴 B站视频链接或 BV 号');
    if (!raw) return;
    try {
      const target = cleanUrl(raw);
      if (!biliEmbedUrl(target)) throw new Error('目前仅支持 B站视频链接或 BV 号');
      insert(`[[video:${target}|B站视频]]\n`);
    } catch (error) { status(error.message, 'err'); }
  });
  head.append(title, noteStatus, spacer, addVideo, edit, previewButton);
  const editor = document.createElement('textarea'); editor.className = 'study-note-editor'; editor.placeholder = '记录学习笔记…'; editor.spellcheck = false;
  const preview = document.createElement('article'); preview.className = 'study-note-preview';
  root.append(head, editor, preview);
  let timer = 0;
  function setMode(mode) {
    state.mode = mode === 'preview' ? 'preview' : 'edit';
    editor.hidden = state.mode !== 'edit'; preview.hidden = state.mode !== 'preview';
    edit.classList.toggle('on', state.mode === 'edit'); previewButton.classList.toggle('on', state.mode === 'preview');
    if (state.mode === 'preview') preview.innerHTML = markdownHtml(editor.value);
    scheduleSave();
  }
  async function save() {
    clearTimeout(timer); noteStatus.textContent = '保存中…';
    try {
      await json('/api/study/note?id=' + encodeURIComponent(state.noteId), { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ content:editor.value }) });
      noteStatus.textContent = '已保存';
    } catch (error) { noteStatus.textContent = '保存失败'; status(error.message, 'err'); }
  }
  function insert(markdown) {
    const start = editor.selectionStart == null ? editor.value.length : editor.selectionStart;
    const before = editor.value.slice(0, start), after = editor.value.slice(editor.selectionEnd == null ? start : editor.selectionEnd);
    const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
    editor.value = before + prefix + markdown + (markdown.endsWith('\n') ? '\n' : '\n\n') + after;
    const caret = (before + prefix + markdown).length; editor.setSelectionRange(caret, caret); editor.focus();
    editor.dispatchEvent(new Event('input'));
  }
  editor.addEventListener('input', () => { noteStatus.textContent = '未保存'; clearTimeout(timer); timer = setTimeout(save, 650); if (state.mode === 'preview') preview.innerHTML = markdownHtml(editor.value); });
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') { event.preventDefault(); const start = editor.selectionStart; editor.setRangeText('  ', start, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
  });
  record.api = { insert, save, editor, state };
  activeNote = record.api;
  container.stateRequestEvent = () => ({ noteId:state.noteId, mode:state.mode });
  json('/api/study/note?id=' + encodeURIComponent(state.noteId)).then((result) => { editor.value = result.content || ''; noteStatus.textContent = '已保存'; setMode(state.mode); }).catch((error) => { noteStatus.textContent = '载入失败'; status(error.message, 'err'); });
}

function insertIntoNote(markdown) {
  const note = activeNote || [...paneRecords].find((item) => item.kind === 'notes' && item.api)?.api;
  if (!note) { status('请先新增或选中 Markdown 笔记窗格', 'err'); return false; }
  note.insert(markdown); status('已插入活动笔记', 'ok'); return true;
}

function createCode(container, initialState) {
  const state = { file:'', fragment:0, ...(initialState || {}) };
  const record = paneRoot(container, 'code'), root = record.root;
  const toolbar = document.createElement('div'); toolbar.className = 'study-pane-toolbar';
  const picker = document.createElement('select'); picker.className = 'study-code-picker'; picker.title = '选择代码片段';
  const codeStatus = document.createElement('span'); codeStatus.className = 'study-note-status';
  const openMain = button('主编辑器', '在 CodeScope 主代码区打开', () => openInMain());
  toolbar.append(picker, codeStatus, openMain);
  const editor = document.createElement('textarea'); editor.className = 'study-code-editor'; editor.spellcheck = false; editor.placeholder = '选择一个代码片段…';
  root.append(toolbar, editor);
  let snippets = [], current = null, timer = 0;
  function selectCurrent() {
    const [file, fragmentText] = picker.value.split('\u0000');
    const snippet = snippets.find((item) => item.file === file), fragment = Number(fragmentText) || 0;
    if (!snippet || !snippet.fragments[fragment]) return;
    state.file = file; state.fragment = fragment; current = { snippet, fragment, source:snippet.fragments[fragment] };
    editor.value = current.source.code || ''; editor.disabled = false; codeStatus.textContent = '已载入'; scheduleSave();
  }
  async function save() {
    clearTimeout(timer); if (!current) return;
    codeStatus.textContent = '保存中…';
    try {
      const result = await json('/api/save', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ file:state.file, fragment:state.fragment, code:editor.value }) });
      current.source.code = editor.value; codeStatus.textContent = result.unchanged ? '无变化' : '已保存';
    } catch (error) { codeStatus.textContent = '保存失败'; status(error.message, 'err'); }
  }
  function openInMain() {
    if (!current) return;
    closeStudy();
    if (typeof window.goToLocation === 'function') window.goToLocation({ snippet:current.snippet, frag:state.fragment, line:1 });
  }
  editor.addEventListener('input', () => { codeStatus.textContent = '未保存'; clearTimeout(timer); timer = setTimeout(save, 650); });
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') { event.preventDefault(); const start = editor.selectionStart; editor.setRangeText('  ', start, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
  });
  picker.onchange = selectCurrent;
  record.api = { save, editor, state };
  container.stateRequestEvent = () => ({ file:state.file, fragment:state.fragment });
  json('/api/snippets').then((data) => {
    snippets = data.snippets || []; picker.replaceChildren();
    for (const snippet of snippets) for (let index = 0; index < (snippet.fragments || []).length; index += 1) {
      const fragment = snippet.fragments[index], option = document.createElement('option'); option.value = `${snippet.file}\u0000${index}`; option.textContent = `${snippet.name} / ${fragment.label || `片段 ${index + 1}`}`; picker.appendChild(option);
    }
    if (!picker.options.length) { editor.disabled = true; codeStatus.textContent = '暂无代码片段'; return; }
    const wanted = `${state.file}\u0000${Number(state.fragment) || 0}`; picker.value = [...picker.options].some((option) => option.value === wanted) ? wanted : picker.options[0].value; selectCurrent();
  }).catch((error) => { editor.disabled = true; codeStatus.textContent = '载入失败'; status(error.message, 'err'); });
}

function flattenReading(node, out = []) {
  for (const child of (node && node.children) || []) {
    if (child.type === 'fragment' && ['pdf','docx','sheet','slides'].includes(child.kind)) out.push(child);
    if (child.children) flattenReading(child, out);
  }
  return out;
}

function createPdf(container, initialState) {
  const state = { path:'', ...(initialState || {}) };
  const record = paneRoot(container, 'pdf'), root = record.root;
  const toolbar = document.createElement('div'); toolbar.className = 'study-pane-toolbar';
  const picker = document.createElement('select'); picker.className = 'study-pdf-select';
  const openReading = button('阅读模块', '在完整阅读模块打开', () => {
    if (!state.path) return; closeStudy(); if (typeof window.openReading === 'function') window.openReading(state.path, 0);
  });
  toolbar.append(picker, openReading);
  const body = document.createElement('div'); body.className = 'study-pane-body';
  root.append(toolbar, body);
  function show() {
    state.path = picker.value;
    if (!state.path) { body.innerHTML = '<div class="study-pdf-empty">阅读库中还没有 PDF 或 Office 文档</div>'; return; }
    const item = picker.selectedOptions[0], kind = item && item.dataset.kind;
    if (kind !== 'pdf') { body.innerHTML = '<div class="study-pdf-empty">该文档可在完整阅读模块中高保真打开<br>点击上方“阅读模块”</div>'; scheduleSave(); return; }
    const frame = document.createElement('iframe'); frame.className = 'study-pdf-frame'; frame.title = item.textContent; frame.src = '/api/readings/file?path=' + encodeURIComponent(state.path) + '#page=1&zoom=page-width'; body.replaceChildren(frame); scheduleSave();
  }
  picker.onchange = show;
  record.api = { state };
  container.stateRequestEvent = () => ({ path:state.path });
  json('/api/readings/tree').then((data) => {
    const items = flattenReading(data.root), placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '选择阅读库中的 PDF / 文档'; picker.appendChild(placeholder);
    for (const item of items) { const option = document.createElement('option'); option.value = item.path; option.dataset.kind = item.kind; option.textContent = `${item.kind === 'pdf' ? 'PDF' : item.kind.toUpperCase()} · ${item.name}`; picker.appendChild(option); }
    picker.value = items.some((item) => item.path === state.path) ? state.path : ''; show();
  }).catch((error) => { body.innerHTML = `<div class="study-pdf-empty">${escapeHtml(error.message)}</div>`; });
}

function registerComponents() {
  layout.registerComponentFactoryFunction('browser', createBrowser);
  layout.registerComponentFactoryFunction('notes', createNotes);
  layout.registerComponentFactoryFunction('code', createCode);
  layout.registerComponentFactoryFunction('pdf', createPdf);
}

function createLayout(config) {
  if (layout) { try { layout.destroy(); } catch (_) {} }
  paneRecords.clear(); activePane = null; activeNote = null;
  layout = new GoldenLayout($('study-layout'));
  registerComponents();
  layout.on('stateChanged', () => { try { syncPresetToLayout(layout.saveLayout()); } catch (_) {} scheduleSave(); });
  layout.loadLayout(config);
  syncPresetToLayout(layout.saveLayout());
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = new ResizeObserver(() => {
    const host = $('study-layout'); if (layout && host.clientWidth && host.clientHeight) layout.setSize(host.clientWidth, host.clientHeight);
  });
  resizeObserver.observe($('study-layout'));
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWorkspace, 700);
}

async function saveWorkspace() {
  try {
    if ($('study-title')) appConfig.title = $('study-title').value.trim() || '学习工作台';
    if (layout) appConfig.layout = layout.saveLayout();
    await json('/api/study/config', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ title:appConfig.title, preset:appConfig.preset, bookmarks:appConfig.bookmarks, categories:appConfig.categories, hiddenSites:appConfig.hiddenSites, layout:appConfig.layout }) });
    status('工作区已保存', 'ok');
  } catch (error) { status('保存失败：' + error.message, 'err'); }
}

function syncStudyToggle() {
  const active = document.body.classList.contains('study-mode'), trigger = $('btn-study');
  if (!trigger) return;
  trigger.classList.toggle('on', active);
  trigger.setAttribute('aria-pressed', String(active));
  trigger.title = active ? '返回代码工作区' : '打开学习工作台：网页、视频、代码和笔记自由分屏';
}

async function openStudy(url = '') {
  try {
    if (document.body.classList.contains('office-mode') && typeof window.closeOffice === 'function') await window.closeOffice();
    if (document.body.classList.contains('reading-mode') && typeof window.closeReading === 'function') window.closeReading();
    if (document.body.classList.contains('drawing-mode') && typeof window.closeDrawEditor === 'function') await window.closeDrawEditor(true);
  } catch (_) {}
  document.body.classList.add('study-mode'); opened = true; syncStudyToggle();
  if (!layout) {
    const result = await json('/api/study/config').catch(() => ({ config:appConfig }));
    appConfig = { ...appConfig, ...(result.config || {}) };
    $('study-title').value = appConfig.title || '学习工作台';
    $('study-preset').value = appConfig.preset || 'study'; renderBookmarks();
    try { createLayout(appConfig.layout || presetConfig(appConfig.preset || 'study', url || 'https://www.bilibili.com')); }
    catch (_) { createLayout(presetConfig('study', url || 'https://www.bilibili.com')); }
  }
  if (url) openUrl(url);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 20);
}

function closeStudy() {
  saveWorkspace(); opened = false; document.body.classList.remove('study-mode'); syncStudyToggle();
}

function openUrl(url) {
  if (!layout) return openStudy(url);
  const browser = activePane && activePane.kind === 'browser' ? activePane : [...paneRecords].find((item) => item.kind === 'browser');
  if (browser && browser.api) browser.api.navigate(url);
  else layout.addComponent('browser', { url }, '网页 / 视频');
}

function normalizedUrl(value) {
  try { const url = new URL(value); url.hash = ''; return url.toString().replace(/\/$/, ''); }
  catch (_) { return String(value || '').replace(/\/$/, ''); }
}

function uniqueSites(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizedUrl(item.url);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function savedBookmarks() {
  return Array.isArray(appConfig.bookmarks) ? appConfig.bookmarks : [];
}

function savedCategories() {
  return Array.isArray(appConfig.categories) ? appConfig.categories : [];
}

function builtinSites() {
  return uniqueSites([...FEATURED_SITES, ...SITE_CATEGORIES.flatMap((category) => category.sites)]);
}

function builtinSite(url) {
  const key = normalizedUrl(url);
  return builtinSites().find((item) => normalizedUrl(item.url) === key) || null;
}

function siteCategories() {
  const hidden = new Set((appConfig.hiddenSites || []).map(normalizedUrl));
  const overrides = new Map(savedBookmarks().map((item) => [normalizedUrl(item.url), item]));
  const available = (items) => items.filter((item) => !hidden.has(normalizedUrl(item.url)) && !overrides.has(normalizedUrl(item.url)));
  const categories = [
    { id:'featured', label:'常用', icon:'★', color:'#78a9ff', builtin:true, sites:available(FEATURED_SITES) },
    { id:'custom', label:'我的收藏', icon:'◆', color:'#70d6a3', builtin:true, sites:[] },
    ...SITE_CATEGORIES.map((category) => ({ ...category, builtin:true, sites:available(category.sites) })),
    ...savedCategories().map((category) => ({ ...category, builtin:false, sites:[] })),
  ];
  for (const item of savedBookmarks()) {
    if (hidden.has(normalizedUrl(item.url))) continue;
    const target = categories.find((category) => category.id === item.category) || categories[1];
    target.sites.push(item);
  }
  categories.forEach((category) => { category.sites = uniqueSites(category.sites); });
  return categories;
}

function makeBookmarkButton(item, className) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = className;
  node.style.setProperty('--site-color', item.color || '#4f8cff');
  node.title = `在学习工作台打开 ${item.url}`;
  const dot = document.createElement('i');
  const label = document.createElement('span'); label.textContent = item.label;
  node.append(dot, label);
  node.onclick = () => openStudySite(item);
  return node;
}

function isBiliHome(item) {
  try {
    const url = new URL(item?.url || '');
    return (item?.id === 'bilibili' || /(^|\.)bilibili\.com$/i.test(url.hostname)) && !/^\/video\//i.test(url.pathname);
  } catch (_) { return item?.id === 'bilibili'; }
}

function openStudySite(item) {
  setSiteMenu(false);
  if (isBiliHome(item)) {
    openBiliBrowser(item.url);
    openStudy(item.url);
    return;
  }
  openStudy(item.url);
}

function categoryOptions(selected = 'custom') {
  const select = $('study-bookmark-category');
  if (!select) return;
  select.replaceChildren();
  for (const category of siteCategories()) {
    const option = document.createElement('option');
    option.value = category.id; option.textContent = `${category.icon || '◆'} ${category.label}`;
    select.appendChild(option);
  }
  select.value = [...select.options].some((option) => option.value === selected) ? selected : 'custom';
}

function upsertBookmark(item, category) {
  const key = normalizedUrl(item.url), existing = savedBookmarks().find((entry) => normalizedUrl(entry.url) === key);
  const record = {
    id:existing?.id || item.id || `site-${Date.now()}`,
    label:String(item.label || existing?.label || '常用网址').trim().slice(0, 24) || '常用网址',
    url:cleanUrl(item.url),
    color:item.color || existing?.color || '#4f8cff',
    category:category || item.category || existing?.category || 'custom',
  };
  appConfig.bookmarks = [...savedBookmarks().filter((entry) => normalizedUrl(entry.url) !== key), record];
  appConfig.hiddenSites = (appConfig.hiddenSites || []).filter((url) => normalizedUrl(url) !== key);
  return record;
}

function moveSiteToCategory(item, category) {
  const record = upsertBookmark(item, category);
  siteMenuCategory = record.category;
  renderBookmarks(); scheduleSave();
  status(`“${record.label}”已移动到“${siteCategories().find((entry) => entry.id === record.category)?.label || '我的收藏'}”`, 'ok');
}

function removeSite(item) {
  const key = normalizedUrl(item.url);
  appConfig.bookmarks = savedBookmarks().filter((entry) => normalizedUrl(entry.url) !== key);
  if (builtinSite(item.url)) appConfig.hiddenSites = uniqueSites([...(appConfig.hiddenSites || []).map((url) => ({ url })), { url:item.url }]).map((entry) => entry.url);
  else appConfig.hiddenSites = (appConfig.hiddenSites || []).filter((url) => normalizedUrl(url) !== key);
  renderBookmarks(); scheduleSave();
}

function renderSiteMenu() {
  const categoriesNode = $('site-menu-categories'), results = $('quick-sites');
  if (!categoriesNode || !results) return;
  const categories = siteCategories();
  if (!categories.some((item) => item.id === siteMenuCategory)) siteMenuCategory = 'featured';
  categoriesNode.replaceChildren();
  for (const category of categories) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'site-category' + (category.id === siteMenuCategory ? ' on' : '');
    node.dataset.category = category.id;
    const icon = document.createElement('span'); icon.className = 'site-category-icon'; icon.textContent = category.icon;
    const label = document.createElement('span'); label.textContent = category.label;
    const count = document.createElement('small'); count.textContent = String(category.sites.length);
    const manage = document.createElement('span'); manage.className = 'site-category-manage'; manage.textContent = category.builtin ? '' : '⋯'; manage.title = category.builtin ? '' : `编辑分类“${category.label}”`;
    if (!category.builtin) manage.onclick = (event) => { event.stopPropagation(); openCategoryDialog(category); };
    node.append(icon, label, count, manage);
    node.onclick = () => { siteMenuCategory = category.id; siteMenuQuery = ''; if ($('site-menu-search')) $('site-menu-search').value = ''; renderSiteMenu(); };
    node.ondragover = (event) => { if (!draggingSite) return; event.preventDefault(); node.classList.add('drag-target'); };
    node.ondragleave = () => node.classList.remove('drag-target');
    node.ondrop = (event) => { event.preventDefault(); node.classList.remove('drag-target'); if (draggingSite) moveSiteToCategory(draggingSite, category.id); draggingSite = null; };
    categoriesNode.appendChild(node);
  }

  const query = siteMenuQuery.trim().toLocaleLowerCase('zh-CN');
  const active = categories.find((item) => item.id === siteMenuCategory) || categories[0];
  const source = query ? categories.flatMap((category) => category.sites.map((item) => ({ ...item, categoryId:category.id, categoryLabel:category.label, categoryColor:category.color }))) : active.sites.map((item) => ({ ...item, categoryId:active.id, categoryLabel:active.label, categoryColor:active.color }));
  const visible = uniqueSites(source).filter((item) => !query || `${item.label} ${item.description || ''} ${item.url} ${item.categoryLabel || ''}`.toLocaleLowerCase('zh-CN').includes(query));
  results.replaceChildren();
  $('site-menu-result-summary').textContent = query ? `搜索到 ${visible.length} 个网址` : `${active.icon} ${active.label} · ${visible.length} 个网址`;
  for (const item of visible) {
    const node = document.createElement('div'); node.className = 'quick-site'; node.setAttribute('role', 'button'); node.tabIndex = 0;
    node.style.setProperty('--site-color', item.color || item.categoryColor || active.color || '#4f8cff');
    node.title = `在学习工作台打开 ${item.url}`;
    const dot = document.createElement('i');
    const copy = document.createElement('span'); copy.className = 'quick-site-copy';
    const title = document.createElement('strong'); title.textContent = item.label;
    const meta = document.createElement('small'); meta.textContent = item.description || item.categoryLabel || new URL(item.url).hostname;
    copy.append(title, meta);
    if (item.stars) { const stars = document.createElement('em'); stars.textContent = item.stars; copy.appendChild(stars); }
    const manage = document.createElement('button'); manage.type = 'button'; manage.className = 'quick-site-manage'; manage.textContent = '⋯'; manage.title = `编辑或移动“${item.label}”`;
    manage.onclick = (event) => { event.stopPropagation(); openBookmarkDialog(item); };
    node.append(dot, copy, manage);
    node.onclick = () => openStudySite(item);
    node.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openStudySite(item); } };
    node.draggable = true;
    node.ondragstart = (event) => { draggingSite = item; node.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.url); };
    node.ondragend = () => { draggingSite = null; node.classList.remove('dragging'); categoriesNode.querySelectorAll('.drag-target').forEach((entry) => entry.classList.remove('drag-target')); };
    results.appendChild(node);
  }
  if (!visible.length) {
    const empty = document.createElement('div'); empty.className = 'site-menu-empty';
    empty.innerHTML = '<b>没有找到网址</b><span>换一个名称、分类或域名试试</span>';
    results.appendChild(empty);
  }
}

function setSiteMenu(force) {
  const trigger = $('site-menu-trigger'), panel = $('site-menu-panel');
  if (!trigger || !panel) return;
  const shouldOpen = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
  trigger.classList.toggle('on', shouldOpen);
  trigger.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) { renderSiteMenu(); setTimeout(() => $('site-menu-search')?.focus(), 0); }
}

function renderBookmarks() {
  const categories = siteCategories();
  const local = $('study-bookmarks');
  if (local) {
    local.replaceChildren();
    const featured = (categories.find((category) => category.id === 'featured')?.sites || []).slice(0, 6);
    for (const item of featured) local.appendChild(makeBookmarkButton(item, 'study-bookmark'));
  }
  const count = $('site-menu-count');
  if (count) count.textContent = String(uniqueSites(categories.flatMap((category) => category.sites)).length);
  renderSiteMenu();
}

function applyPreset(name) {
  if (!['study','dual','notes','quad'].includes(name)) return;
  appConfig.preset = name; appConfig.layout = null; createLayout(presetConfig(name)); scheduleSave(); status('布局已切换，可继续拖动标签和分隔线', 'ok');
}

function focusActive() {
  if (!activePane) { status('请先点击要专注的窗格', 'err'); return; }
  if (document.fullscreenElement) document.exitFullscreen();
  else activePane.root.requestFullscreen().catch((error) => status('无法进入专注模式：' + error.message, 'err'));
}

function openBookmarkDialog(item = null) {
  editingSiteUrl = item?.url || '';
  $('study-bookmark-title').textContent = item ? '编辑常用网址' : '新增常用网址';
  $('study-bookmark-label').value = item?.label || '';
  $('study-bookmark-url').value = item?.url || '';
  $('study-bookmark-color').value = /^#[0-9a-f]{6}$/i.test(item?.color || '') ? item.color : '#4f8cff';
  categoryOptions(item?.categoryId || item?.category || (siteMenuCategory === 'featured' ? 'custom' : siteMenuCategory));
  $('study-bookmark-delete').hidden = !item;
  $('study-bookmark-dialog').classList.add('open');
  setTimeout(() => $('study-bookmark-label').focus(), 0);
}
function closeBookmarkDialog() { editingSiteUrl = ''; $('study-bookmark-dialog').classList.remove('open'); }
async function saveBookmark() {
  try {
    const label = $('study-bookmark-label').value.trim() || '常用网址', url = cleanUrl($('study-bookmark-url').value), color = $('study-bookmark-color').value, category = $('study-bookmark-category').value || 'custom';
    if (editingSiteUrl && normalizedUrl(editingSiteUrl) !== normalizedUrl(url)) removeSite({ url:editingSiteUrl });
    upsertBookmark({ label, url, color }, category);
    siteMenuCategory = category; renderBookmarks(); closeBookmarkDialog(); scheduleSave();
  } catch (error) { status(error.message, 'err'); }
}

function deleteBookmark() {
  if (!editingSiteUrl) return;
  const label = $('study-bookmark-label').value.trim() || '该网址';
  if (!window.confirm(`确定从导航中删除“${label}”吗？`)) return;
  removeSite({ url:editingSiteUrl }); closeBookmarkDialog();
}

function openCategoryDialog(category = null) {
  editingCategoryId = category?.builtin ? '' : (category?.id || '');
  $('study-category-title').textContent = editingCategoryId ? '编辑网址分类' : '新建网址分类';
  $('study-category-label').value = category?.label || '';
  $('study-category-icon').value = category?.icon || '';
  $('study-category-color').value = /^#[0-9a-f]{6}$/i.test(category?.color || '') ? category.color : '#70d6a3';
  $('study-category-delete').hidden = !editingCategoryId;
  $('study-category-dialog').classList.add('open');
  setTimeout(() => $('study-category-label').focus(), 0);
}

function closeCategoryDialog() { editingCategoryId = ''; $('study-category-dialog').classList.remove('open'); }

function saveCategory() {
  const label = $('study-category-label').value.trim();
  if (!label) { status('请输入分类名称', 'err'); return; }
  const icon = $('study-category-icon').value.trim().slice(0, 4) || '◆', color = $('study-category-color').value;
  const id = editingCategoryId || `category-${Date.now()}`;
  const next = { id, label:label.slice(0, 24), icon, color };
  appConfig.categories = [...savedCategories().filter((category) => category.id !== id), next];
  siteMenuCategory = id; renderBookmarks(); closeCategoryDialog(); scheduleSave();
}

function deleteCategory() {
  if (!editingCategoryId) return;
  const category = savedCategories().find((entry) => entry.id === editingCategoryId);
  if (!category || !window.confirm(`删除分类“${category.label}”？其中的网址将移动到“我的收藏”。`)) return;
  appConfig.categories = savedCategories().filter((entry) => entry.id !== editingCategoryId);
  appConfig.bookmarks = savedBookmarks().map((item) => item.category === editingCategoryId ? { ...item, category:'custom' } : item);
  siteMenuCategory = 'custom'; renderBookmarks(); closeCategoryDialog(); scheduleSave();
}

function init() {
  if (!$('study-workspace')) return;
  renderBookmarks();
  $('btn-study').setAttribute('aria-pressed', 'false');
  $('btn-study').onclick = () => document.body.classList.contains('study-mode') ? closeStudy() : openStudy(); $('study-back').onclick = closeStudy;
  $('site-menu-trigger').onclick = () => setSiteMenu();
  $('site-menu-close').onclick = () => setSiteMenu(false);
  $('site-menu-add-category').onclick = () => openCategoryDialog();
  $('site-menu-add-site').onclick = () => openBookmarkDialog();
  $('site-menu-enter').onclick = () => { setSiteMenu(false); openStudy(); };
  $('site-menu-search').addEventListener('input', (event) => { siteMenuQuery = event.target.value; renderSiteMenu(); });
  document.addEventListener('pointerdown', (event) => {
    if ($('site-menu')?.contains(event.target) || $('study-bookmark-dialog')?.contains(event.target) || $('study-category-dialog')?.contains(event.target)) return;
    setSiteMenu(false);
  });
  $('study-title').addEventListener('change', scheduleSave);
  $('study-preset').onchange = (event) => applyPreset(event.target.value);
  $('study-add-pane').onchange = (event) => { const type = event.target.value; event.target.value = ''; if (type && layout) layout.addComponent(type, type === 'notes' ? { noteId:`note-${Date.now()}` } : {}, TYPE_TITLES[type]); };
  $('study-focus').onclick = focusActive;
  $('study-add-bookmark').onclick = () => openBookmarkDialog(); $('study-bookmark-cancel').onclick = closeBookmarkDialog; $('study-bookmark-save').onclick = saveBookmark; $('study-bookmark-delete').onclick = deleteBookmark;
  $('study-bookmark-dialog').addEventListener('pointerdown', (event) => { if (event.target === $('study-bookmark-dialog')) closeBookmarkDialog(); });
  $('study-bookmark-url').onkeydown = (event) => { if (event.key === 'Enter') saveBookmark(); };
  $('study-category-cancel').onclick = closeCategoryDialog; $('study-category-save').onclick = saveCategory; $('study-category-delete').onclick = deleteCategory;
  $('study-category-dialog').addEventListener('pointerdown', (event) => { if (event.target === $('study-category-dialog')) closeCategoryDialog(); });
  $('study-category-label').onkeydown = (event) => { if (event.key === 'Enter') saveCategory(); };
  new MutationObserver(syncStudyToggle).observe(document.body, { attributes:true, attributeFilter:['class'] }); syncStudyToggle();
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('site-menu-panel').classList.contains('hidden')) { setSiteMenu(false); return; }
    if (!document.body.classList.contains('study-mode')) return;
    if (event.key === 'Escape' && !document.fullscreenElement) { closeBookmarkDialog(); closeCategoryDialog(); }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && ['1','2','3','4'].includes(event.key)) { event.preventDefault(); applyPreset(({ '1':'dual', '2':'notes', '3':'study', '4':'quad' })[event.key]); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); focusActive(); }
  });
  window.CodeScopeStudy = { open:openStudy, close:closeStudy, openUrl, insertIntoNote };
  json('/api/study/config').then((result) => { appConfig = { ...appConfig, ...(result.config || {}) }; renderBookmarks(); }).catch(() => {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
