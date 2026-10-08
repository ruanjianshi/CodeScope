
/* ================= 阅读 PDF（PDF.js 官方 Viewer + CodeScope 标注/笔记/AI） ================= */
(function () {
  'use strict';
  let PDFJS_PROMISE = null, PDF_VIEWER_PROMISE = null;
  function loadPdfJs() {
    if (PDFJS_PROMISE) return PDFJS_PROMISE;
    PDFJS_PROMISE = import('/assets/pdfjs/pdf.min.mjs').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.mjs';
      globalThis.pdfjsLib = mod;
      return mod;
    });
    return PDFJS_PROMISE;
  }
  function loadPdfViewerLib() {
    if (PDF_VIEWER_PROMISE) return PDF_VIEWER_PROMISE;
    PDF_VIEWER_PROMISE = loadPdfJs().then(() => import('/assets/pdfjs/pdf_viewer.mjs'));
    return PDF_VIEWER_PROMISE;
  }
  const ANNO_COLORS = { yellow: '#ffe14d', green: '#7ee787', blue: '#79c0ff', pink: '#ff9ecf', orange: '#ffab70' };
  window.__pdfSelectedRectsIn = window.__pdfSelectedRectsIn || ((tl) => (tl ? selectedRectsIn(tl) : null));
  let pdfToolbar = null;      // 划选工具条
  let pdfPopover = null;      // 标注气泡
  let pdfToolbarState = null; // {viewer, page, text, rects}

  function rgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  async function loadAnnotations(path) {
    const res = await api('/api/readings/annotations?path=' + encodeURIComponent(path));
    return { annotations: (res && res.annotations) || [], summary: (res && res.summary) || null };
  }
  async function saveAnnotations(path, viewer) {
    await persistAnnotations(path, viewer);
  }
  async function persistAnnotations(path, viewer) {
    // 标注承载着全部高亮与摘要，保存失败必须让用户看见（原来静默丢弃返回值）。
    const result = await api('/api/readings/annotations', { path, annotations: viewer.ann.annotations, summary: viewer.ann.summary });
    if (result && result.ok === false) { try { setStatus('err', '标注保存失败：' + String(result.error || '未知错误')); } catch (_) {} }
    return result;
  }
  function pushUndo(viewer) {
    (viewer._undoStack = viewer._undoStack || []).push(JSON.parse(JSON.stringify(viewer.ann.annotations)));
    if (viewer._undoStack.length > 30) viewer._undoStack.shift();
  }
  function undoLastAnnotation(viewer) {
    if (!viewer || !viewer._alive) return;
    const prev = (viewer._undoStack || []).pop();
    if (!prev) { readingStatus('没有可撤回的标注操作', true); return; }
    viewer.ann.annotations = prev;
    persistAnnotations(viewer.path, viewer);
    viewer.refreshAnnotations();
    readingStatus('↶ 已撤回上一条标注操作');
  }

  /* ---------- 划选工具条 ---------- */
  function buildPdfToolbar() {
    if (pdfToolbar) return pdfToolbar;
    const bar = document.createElement('div'); bar.className = 'pdf-sel-toolbar'; bar.style.display = 'none';
    Object.keys(ANNO_COLORS).forEach((name) => {
      const hex = ANNO_COLORS[name];
      const b = document.createElement('button'); b.style.background = hex; b.title = '高亮（' + name + '）';
      b.onclick = (e) => { e.stopPropagation(); pdfToolbarAction('highlight', hex); };
      bar.appendChild(b);
    });
    const sep = document.createElement('div'); sep.className = 'sep'; bar.appendChild(sep);
    const excerpt = document.createElement('button'); excerpt.className = 'act primary'; excerpt.textContent = '摘录'; excerpt.title = '保存到右侧摘录面板';
    excerpt.onclick = (e) => { e.stopPropagation(); saveToolbarSelection(false); };
    const cite = document.createElement('button'); cite.className = 'act cite'; cite.textContent = '引用笔记'; cite.title = '写入项目 Markdown 阅读笔记，并建立可定位回链';
    cite.onclick = (e) => { e.stopPropagation(); saveToolbarSelection(true); };
    const askAi = document.createElement('button'); askAi.className = 'act'; askAi.textContent = '问 AI'; askAi.title = '针对选中文字向 AI 提问（输入框无需填写）';
    askAi.onclick = (e) => { e.stopPropagation(); askAboutSelected(); };
    const mark = document.createElement('button'); mark.className = 'act'; mark.textContent = '标记'; mark.title = '保存为标记（可附笔记）';
    mark.onclick = (e) => { e.stopPropagation(); pdfToolbarAction('mark', null); };
    const cancel = document.createElement('button'); cancel.className = 'act'; cancel.textContent = '取消';
    cancel.onclick = (e) => { e.stopPropagation(); hidePdfToolbar(); };
    bar.append(excerpt, cite, askAi, mark, cancel);
    document.body.appendChild(bar);
    pdfToolbar = bar;
    return bar;
  }
  function hidePdfToolbar() {
    if (pdfToolbar) pdfToolbar.style.display = 'none';
    pdfToolbarState = null;
    try { window.getSelection().removeAllRanges(); } catch (_) {}
  }
  function showPdfToolbar(x, y, anchorRect) {
    const bar = buildPdfToolbar();
    bar.style.display = 'flex';
    const width=bar.offsetWidth||430,height=bar.offsetHeight||36,anchor=anchorRect||{left:x,right:x,top:y,bottom:y};
    bar.style.left = Math.max(8, Math.min((anchor.left+anchor.right-width)/2, innerWidth-width-8)) + 'px';
    const above=anchor.top-height-9,below=anchor.bottom+9;
    bar.style.top = Math.max(8, above>=8?above:Math.min(below,innerHeight-height-8)) + 'px';
  }
  async function saveToolbarSelection(cite) {
    const t=pdfToolbarState;if(!t||!t.viewer||!t.text)return;
    const viewer=t.viewer,f=(viewer._previewF&&viewer._previewF!==1)?viewer._previewF:1;
    const rects=f===1?t.rects:t.rects.map((r)=>({x:r.x/f,y:r.y/f,width:r.width/f,height:r.height/f}));
    const payload={path:viewer.path,page:t.page,text:t.text,rects,scale:pdfAnnotationScale(viewer,t.page)};
    hidePdfToolbar();
    try{await savePdfSelectionPayload(payload,!!cite);}catch(error){readingStatus(error.message||'保存选区失败',true);}
  }
  function askAboutSelected() {
    const t = pdfToolbarState; if (!t || !t.viewer || !t.text) return;
    const viewer = t.viewer;
    hidePdfToolbar();
    const tab = document.getElementById('rf-tab-chat');
    if (tab && !tab.classList.contains('on')) tab.click();
    sendReadingChat('📎 引用选中内容（P.' + t.page + '）：「' + t.text.slice(0, 200) + (t.text.length > 200 ? '…' : '') + '」\n\n请结合论文上下文，解释这段原文的含义、作用与要点。');
    if (viewer && viewer._alive) readingStatus('已向 AI 提问选中内容');
  }
  async function pdfToolbarAction(kind, color) {
    const t = pdfToolbarState; if (!t) return;
    if (!t.rects || !t.rects.length) { hidePdfToolbar(); return; }
    const viewer = t.viewer;
    const f = (viewer._previewF && viewer._previewF !== 1) ? viewer._previewF : 1;
    const rects = f === 1 ? t.rects : t.rects.map((r) => ({ x: r.x / f, y: r.y / f, width: r.width / f, height: r.height / f }));
    const anno = {
      id: 'a' + Math.random().toString(36).slice(2, 10),
      page: t.page, type: kind, color: color || '#ffe14d', text: t.text, rects,
      note: '', scale: pdfAnnotationScale(viewer,t.page), createdAt: Date.now(),
    };
    if (kind === 'mark') {
      const note = await askText({ title:'标记笔记', message:'为这条标记添加笔记（可留空）', value:'', okLabel:'保存' });
      if (note === null) return;
      anno.note = note || '';
    }
    pushUndo(viewer);
    viewer.ann.annotations.push(anno);
    renderPdfOverlay(viewer, t.page);
    saveAnnotations(viewer.path, viewer);
    window.renderReadingAnnotationsList && renderReadingAnnotationsList();
    updatePdfAnnoCount(viewer);
    hidePdfToolbar();
  }

  /* ---------- 高亮 overlay ---------- */
  function pdfAnnotationScale(viewer, pageNum) {
    const rec = viewer && viewer.pages && viewer.pages.find((item) => item.pageNum === Number(pageNum));
    return Number(rec && rec.viewport && rec.viewport.scale) || Number(viewer && viewer.scale) || 1;
  }
  function renderPdfOverlay(viewer, pageNum) {
    const rec = viewer.pages.find((p) => p.pageNum === pageNum);
    if (!rec) return;
    if (!viewer._annoClickBound && viewer.scroll) {
      viewer._annoClickBound = true;
      viewer.scroll.addEventListener('click', (ev) => pdfAnnoScrollClick(ev, viewer));
    }
    const ov = rec.ov; ov.replaceChildren();
    for (const a of viewer.ann.annotations) {
      if (a.page !== pageNum) continue;
      const currentScale = pdfAnnotationScale(viewer, pageNum);
      const sf = currentScale / (Number(a.scale) || currentScale);
      for (const r of (a.rects || [])) {
        const d = document.createElement('div');
        d.className = 'pdf-anno-hl';
        d.style.cssText = 'left:' + (r.x * sf) + 'px;top:' + (r.y * sf) + 'px;width:' + Math.max(2, r.width * sf) + 'px;height:' + Math.max(2, r.height * sf) + 'px;background:' + rgba(a.color, a.type === 'mark' ? 0.62 : 0.42) + ';mix-blend-mode:multiply;' + (a.type === 'mark' ? 'outline:1px solid ' + rgba(a.color, 0.92) + ';' : '');
        d.dataset.id = a.id;
        d.title = (a.text || '').slice(0, 100);
        ov.appendChild(d);
      }
    }
    renderFragmentMarks(viewer, pageNum);
  }
  function renderFragmentMarks(viewer, pageNum) {
    if (!viewer || !viewer._alive) return;
    const doc = window.activeReadingDoc ? activeReadingDoc() : null;
    const frags = (doc && doc.meta && doc.meta.fragments) || [];
    const rec = viewer.pages.find((p) => p.pageNum === pageNum);
    if (!rec || !rec.ov) return;
    rec.ov.querySelectorAll('.pdf-frag-mark').forEach((el) => el.remove());
    if (viewer._previewF && viewer._previewF !== 1) return;
    const sfBase = pdfAnnotationScale(viewer, pageNum);
    for (const f of frags) {
      if (!f || Number(f.page) !== pageNum || !Array.isArray(f.rects) || !f.rects.length) continue;
      const sf = sfBase / (Number(f.scale) || 1);
      const g = document.createElement('div');
      g.className = 'pdf-frag-mark'; g.dataset.id = f.id;
      g.title = (f.source || '').slice(0, 120);
      for (const r of f.rects) {
        const d = document.createElement('div');
        d.style.left = (r.x * sf) + 'px'; d.style.top = (r.y * sf) + 'px';
        d.style.width = Math.max(2, r.width * sf) + 'px'; d.style.height = Math.max(2, r.height * sf) + 'px';
        g.appendChild(d);
      }
      rec.ov.appendChild(g);
    }
  }
  function refreshFragmentMarksAll() {
    const v = window.__readingPdfViewer;
    if (!v || !v.alive || !v.alive()) return;
    v.pages.forEach((p) => renderFragmentMarks(v, p.pageNum));
  }
  function fragSegmentsFromLoc(viewer, loc) {
    const rec = viewer.pages.find((x) => x.pageNum === loc.page);
    if (!rec) return [];
    const hostRect = rec.textLayer.getBoundingClientRect();
    const segs = []; let acc = 0;
    for (const sp of loc.spans) { const t = (sp.textContent || '').replace(/\s+/g, ' '); segs.push({ sp, s: acc, e: acc + t.length }); acc += t.length; }
    const rects = [];
    for (const seg of segs) {
      if (seg.e <= loc.start || seg.s >= loc.end) continue;
      const sr = seg.sp.getBoundingClientRect();
      if (sr.width < 1 || sr.height < 1) continue;
      const spanLen = seg.e - seg.s;
      const cutS = Math.max(0, loc.start - seg.s), cutE = Math.min(spanLen, loc.end - seg.s);
      const f0 = spanLen ? cutS / spanLen : 0, f1 = spanLen ? cutE / spanLen : 1;
      const x0 = sr.left + sr.width * f0, x1 = sr.left + sr.width * f1;
      if (x1 - x0 < 1) continue;
      rects.push({ x: x0 - hostRect.left, y: sr.top - hostRect.top, width: x1 - x0, height: sr.height });
    }
    return rects;
  }
  function flashFragmentMark(viewer, frag) {
    if (!viewer || !viewer._alive) return;
    const page = Number(frag.page) || 1;
    const rec = viewer.pages.find((p) => p.pageNum === page);
    if (!rec || !rec.ov) return;
    let els = [];
    if (Array.isArray(frag.rects) && frag.rects.length) {
      els = [...rec.ov.querySelectorAll('.pdf-frag-mark[data-id="' + frag.id + '"]')];
    } else {
      const loc = locateQuoteInViewer(viewer, frag.source || '');
      if (loc) {
        const rects = fragSegmentsFromLoc(viewer, loc);
        const g = document.createElement('div'); g.className = 'pdf-frag-mark';
        for (const r of rects) {
          const d = document.createElement('div');
          d.style.left = r.x + 'px'; d.style.top = r.y + 'px';
          d.style.width = Math.max(2, r.width) + 'px'; d.style.height = Math.max(2, r.height) + 'px';
          g.appendChild(d);
        }
        rec.ov.appendChild(g);
        els = [g];
      }
    }
    if (!els.length) { if (rec.canvas) rec.canvas.scrollIntoView({ block: 'center' }); return; }
    for (const el of els) el.classList.add('flash');
    setTimeout(() => {
      for (const el of els) {
        el.classList.remove('flash');
        if (!Array.isArray(frag.rects) || !frag.rects.length) el.remove();
      }
    }, 2800);
    if (rec.canvas) rec.canvas.scrollIntoView({ block: 'center' });
  }
  async function locateReadingFragment(doc, frag) {
    const v0 = window.__readingPdfViewer;
    if (!v0 || !v0.alive || !v0.alive()) return false;
    const page = Math.max(1, Number(frag.page) || 1);
    await setReadingPage(READING_ACTIVE_SLOT, page);
    let v = window.__readingPdfViewer;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 120));
      v = window.__readingPdfViewer;
      if (v && v.pages.length === v.numPages && v.currentPage === page) break;
    }
    if (v) flashFragmentMark(v, frag);
    return true;
  }
  window.refreshFragmentMarksAll = refreshFragmentMarksAll;
  window.locateReadingFragment = locateReadingFragment;
  window.flashFragmentMark = flashFragmentMark;
  window.hidePdfToolbar = () => { try { hidePdfToolbar(); } catch (_) {} };
  function cleanPdfOutlineTitle(text) {
    let value = String(text || '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 4; i++) value = value.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, '$1$2');
    return value.replace(/\s+([,.;:!?])/g, '$1').replace(/([([])\s+/g, '$1').trim();
  }
  function classifyPdfOutlineLine(line, page, base, threshold) {
    let title = cleanPdfOutlineTitle(line.t);
    if (!title || title.length < 2 || title.length > 180) return null;
    if (/^(?:fig(?:ure)?\s*[.\d]|table\s*(?:[.\d]|[IVXLCDM]+\b))/i.test(title) || /^\(?[a-z]\)?(?:\s+\(?[a-z]\)?){1,8}$/i.test(title)) return null;
    if (/^(?:index terms|keywords?)\b/i.test(title) || /^\[[0-9,\s-]+\]/.test(title)) return null;
    if (/^[0-9.,]+\s*[a-zA-Z*()°\-·]*$/.test(title) || /^(19|20)\d{2,}/.test(title)) return null;
    if (/^(?:abstract|摘要)\b/i.test(title)) return { title: /^摘要/i.test(title) ? '摘要' : 'Abstract', depth: 0, kind: 'abstract' };
    if (/^(?:references|bibliography|参考文献|acknowledg(?:e)?ments?|致谢)$/i.test(title)) return { title, depth: 0, kind: 'major' };
    if (/^(?:appendix|附录)\b/i.test(title)) return { title, depth: 0, kind: 'major' };
    if (/^[IVXLCDM]+\.\s*\S/i.test(title)) return { title, depth: 0, kind: 'major' };
    if (/^[A-Z]\.\s+\S/.test(title)) return { title, depth: 1, kind: 'section' };
    const sub = title.match(/^([a-z]\)\s+[^:]{2,90}:)/);
    if (sub) return { title: sub[1], depth: 2, kind: 'subsection' };
    const numbered = title.match(/^(\d+(?:\.\d+)+)[.)]?\s+\S/);
    if (numbered) return { title, depth: Math.min(3, numbered[1].split('.').length - 1), kind: 'numbered' };
    const wordCount = title.split(/\s+/).length;
    const hasCjk = /[\u3400-\u9fff]/.test(title);
    const looksSentence = /[.;!?]$/.test(title) || wordCount > 13;
    if (page === 1 && line.fs >= base * 1.62 && !looksSentence) return { title, depth: 0, kind: 'title' };
    const strongVisualHeading = line.fs >= Math.max(threshold, base * 1.28) && (line.bold || line.fs >= base * 1.48);
    if (strongVisualHeading && !looksSentence && (wordCount >= 2 || hasCjk) && title.length <= 100) return { title, depth: 1, kind: 'visual' };
    const letters = title.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 4 && letters.length <= 44 && title === title.toUpperCase() && !looksSentence) return { title, depth: 0, kind: 'major' };
    return null;
  }
  async function buildAutoOutline(pdf) {
    const rows = [];
    if (!pdf || !pdf.numPages) return { rows, source: 'none' };
    const sizes = []; const perPage = [];
    for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 300); pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const middle = viewport.width / 2;
        const textContent = await page.getTextContent();
        const bands = [[], []];
        for (const item of textContent.items || []) {
          const text = String(item.str || '').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const fs = Math.abs(item.transform ? item.transform[3] : 0) || 0;
          const x = item.transform ? item.transform[4] : 0;
          const y = item.transform ? item.transform[5] : 0;
          if (fs > 1) sizes.push(fs);
          let bold = false;
          if (item.fontName && textContent.styles) {
            const style = textContent.styles.get ? textContent.styles.get(item.fontName) : textContent.styles[item.fontName];
            if (style && style.fontFamily) bold = /bold|black|heavy|semibold/i.test(style.fontFamily);
          }
          const band = x >= middle ? 1 : 0;
          let line = bands[band].find((candidate) => Math.abs(candidate.y - y) <= Math.max(2.5, Math.min(4.5, fs * 0.38)));
          if (!line) { line = { y, parts: [] }; bands[band].push(line); }
          line.parts.push({ text, x, fs, bold });
        }
        const lines = [];
        for (const band of bands) {
          band.sort((a, b) => b.y - a.y);
          for (const line of band) {
            line.parts.sort((a, b) => a.x - b.x);
            let text = '';
            for (const part of line.parts) text += (!text || /^[,.;:!?)]/.test(part.text) ? '' : ' ') + part.text;
            lines.push({ t: text, y: line.y, fs: Math.max(...line.parts.map((part) => part.fs)), bold: line.parts.some((part) => part.bold) });
          }
        }
        perPage.push(lines);
      } catch (_) { perPage.push([]); }
    }
    if (!sizes.length) return { rows, source: 'none' };
    const sorted = sizes.sort((a, b) => a - b);
    const base = sorted[Math.floor(sorted.length / 2)] || 10;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || base * 1.3;
    const threshold = Math.max(base * 1.16, p95 * 0.9);
    const candidates = [];
    perPage.forEach((lines, pageIndex) => {
      for (const line of lines) {
        const found = classifyPdfOutlineLine(line, pageIndex + 1, base, threshold);
        if (!found) continue;
        const row = { ...found, page: pageIndex + 1, fs: line.fs, y: line.y };
        const previous = candidates[candidates.length - 1];
        if (row.kind === 'title' && previous && previous.kind === 'title' && previous.page === row.page && Math.abs(previous.fs - row.fs) <= base * 0.35) {
          previous.title = cleanPdfOutlineTitle(previous.title + ' ' + row.title);
          continue;
        }
        candidates.push(row);
      }
    });
    const seen = new Set(); let referencesReached = false;
    for (const candidate of candidates) {
      if (referencesReached) continue;
      const key = cleanPdfOutlineTitle(candidate.title).toLocaleLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({ title: candidate.title, page: candidate.page, depth: candidate.depth });
      if (/^(?:references|bibliography|参考文献)$/i.test(candidate.title)) referencesReached = true;
      if (rows.length >= 300) break;
    }
    return { rows, source: 'auto-v2' };
  }
  async function loadPdfOutline(viewer) {
    if (viewer._tocCache) return viewer._tocCache;
    if (!viewer.pdf) return { rows: [], source: 'none' };
    const rows = [];
    try {
      const outline = await viewer.pdf.getOutline();
      const walk = async (items, depth) => {
        for (const it of items || []) {
          let page = 0;
          try {
            let dest = Array.isArray(it.dest) ? it.dest : null;
            if (!dest && typeof it.dest === 'string') dest = await viewer.pdf.getDestination(it.dest);
            if (dest && Array.isArray(dest) && dest[0]) page = (await viewer.pdf.getPageIndex(dest[0])) + 1;
          } catch (_) {}
          const title = ((it.title || '').replace(/\s+/g, ' ').trim() || '').slice(0, 120);
          if (page >= 1 && title) rows.push({ title, page, depth });
          if (it.items && it.items.length) await walk(it.items, depth + 1);
        }
      };
      await walk(outline || [], 0);
    } catch (_) {}
    if (rows.length) { viewer._tocCache = { rows, source: 'bookmark' }; return viewer._tocCache; }
    const auto = await buildAutoOutline(viewer.pdf);
    viewer._tocCache = auto;
    return auto;
  }
  function togglePdfOutline(viewer) {
    if (!viewer || !viewer._alive) return;
    if (viewer._tocPanel) { viewer._tocPanel.remove(); viewer._tocPanel = null; viewer._tocBtn && viewer._tocBtn.classList.remove('on'); return; }
    const panel = document.createElement('div'); panel.className = 'pdf-outline-panel';
    const head = document.createElement('div'); head.className = 'pdf-outline-head';
    const title = document.createElement('span'); title.textContent = '大纲';
    const tag = document.createElement('span'); tag.className = 'tag';
    const sp = document.createElement('span'); sp.className = 'sp';
    const close = document.createElement('button'); close.textContent = '关闭';
    close.onclick = () => togglePdfOutline(viewer);
    head.append(title, tag, sp, close);
    const body = document.createElement('div'); body.className = 'pdf-outline-body';
    body.textContent = '正在识别大纲…';
    panel.append(head, body);
    viewer.host.appendChild(panel);
    viewer._tocPanel = panel; viewer._tocBtn && viewer._tocBtn.classList.add('on');
    panel.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault ? e.preventDefault() : 0; });
    const onDoc = (e) => { if (viewer._tocPanel && !viewer._tocPanel.contains(e.target) && !(viewer._tocBtn && viewer._tocBtn.contains(e.target))) togglePdfOutline(viewer); };
    document.addEventListener('mousedown', onDoc);
    const onKey = (e) => { if (e.key === 'Escape') togglePdfOutline(viewer); };
    document.addEventListener('keydown', onKey);
    loadPdfOutline(viewer).then((data) => {
      if (!viewer._tocPanel || !viewer._alive) return;
      body.replaceChildren();
      tag.textContent = data.source === 'bookmark' ? 'PDF 书签' : data.source === 'auto-v2' ? '智能识别' : data.source === 'auto' ? '自动识别' : '';
      if (!data.rows.length) {
        const e = document.createElement('div'); e.className = 'pdf-toc-empty';
        e.textContent = '该 PDF 没有书签，也未识别到明显的章节标题。';
        body.appendChild(e); return;
      }
      let activeRow = null;
      for (const r of data.rows) {
        const row = document.createElement('div'); row.className = 'pdf-toc-row';
        row.style.paddingLeft = (6 + (r.depth || 0) * 14) + 'px';
        const t = document.createElement('span'); t.className = 't'; t.textContent = r.title;
        const pg = document.createElement('span'); pg.className = 'pg'; pg.textContent = 'P.' + r.page;
        row.append(t, pg);
        row.onclick = () => {
          if (activeRow) activeRow.classList.remove('active');
          row.classList.add('active'); activeRow = row;
          const rec = viewer.pages.find((x) => x.pageNum === r.page);
          if (rec) viewer.goToPage(r.page);
          else if (viewer.slotEls) setReadingPage(viewer.slotEls === readingSlotElements(READING_ACTIVE_SLOT) ? READING_ACTIVE_SLOT : Number(viewer.slotEls.closest('.reading-col') && viewer.slotEls.closest('.reading-col').dataset.slot), r.page);
        };
        body.appendChild(row);
      }
    }).catch(() => {
      if (!viewer._tocPanel) return;
      body.replaceChildren();
      const e = document.createElement('div'); e.className = 'pdf-toc-empty'; e.textContent = '大纲识别失败，可重试或手动翻页。'; body.appendChild(e);
    });
    const cleanup = () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    const origRemove = panel.remove.bind(panel);
    panel.remove = () => { cleanup(); origRemove(); };
  }
  function syncPdfThumbnailActive(viewer) {
    if (!viewer || !viewer._thumbPanel) return;
    let active = null;
    viewer._thumbPanel.querySelectorAll('.pdf-thumb-item').forEach((item) => {
      const on = Number(item.dataset.page) === viewer.currentPage;
      item.classList.toggle('active', on);
      if (on) active = item;
    });
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
  async function renderPdfThumbnails(viewer, panel, list) {
    const renderOne = async (item, pageNum) => {
      if (!viewer._alive || viewer._thumbPanel !== panel || item.dataset.loaded) return;
      item.dataset.loaded = '1'; const loading = item.querySelector('.loading');
      try {
        const page = await viewer.pdf.getPage(pageNum);
        const raw = page.getViewport({ scale: 1 });
        const scale = Math.min(0.28, 124 / Math.max(1, raw.width));
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas'); const density = Math.min(2, window.devicePixelRatio || 1.5);
        canvas.width = Math.max(1, Math.floor(vp.width * density)); canvas.height = Math.max(1, Math.floor(vp.height * density));
        canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: density === 1 ? null : [density, 0, 0, density, 0, 0] }).promise;
        if (viewer._thumbPanel === panel && loading && loading.isConnected) loading.replaceWith(canvas);
      } catch (_) { if (loading) loading.textContent = '无法预览'; }
    };
    if (viewer._thumbObserver) viewer._thumbObserver.disconnect();
    viewer._thumbObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { viewer._thumbObserver.unobserve(entry.target); renderOne(entry.target, Number(entry.target.dataset.page)); }
    }, { root:list, rootMargin:'320px 0px', threshold:0.01 }) : null;
    for (let pageNum = 1; pageNum <= viewer.numPages; pageNum++) {
      if (!viewer._alive || viewer._thumbPanel !== panel) return;
      const item = document.createElement('button'); item.className = 'pdf-thumb-item'; item.dataset.page = pageNum;
      item.title = '跳转到第 ' + pageNum + ' 页'; item.setAttribute('aria-label', '跳转到第 ' + pageNum + ' 页');
      const loading = document.createElement('span'); loading.className = 'loading'; loading.textContent = 'P.' + pageNum;
      const label = document.createElement('span'); label.className = 'label'; label.textContent = pageNum + ' / ' + viewer.numPages;
      item.append(loading, label); item.onclick = () => viewer.goToPage(pageNum); list.appendChild(item);
      if (pageNum === viewer.currentPage) item.classList.add('active');
      if (viewer._thumbObserver) viewer._thumbObserver.observe(item);
      else if (pageNum <= 20) renderOne(item, pageNum);
    }
    syncPdfThumbnailActive(viewer);
  }
  function togglePdfThumbnails(viewer) {
    if (!viewer || !viewer._alive) return;
    if (viewer._thumbPanel) {
      if (viewer._thumbObserver) { viewer._thumbObserver.disconnect(); viewer._thumbObserver = null; }
      viewer._thumbPanel.remove(); viewer._thumbPanel = null;
      viewer._thumbBtn && viewer._thumbBtn.classList.remove('on'); return;
    }
    const panel = document.createElement('aside'); panel.className = 'pdf-thumb-panel';
    const head = document.createElement('div'); head.className = 'pdf-thumb-head';
    const title = document.createElement('span'); title.textContent = '页面缩略图';
    const spacer = document.createElement('span'); spacer.className = 'sp';
    const close = document.createElement('button'); close.textContent = '×'; close.title = '关闭缩略图'; close.onclick = () => togglePdfThumbnails(viewer);
    head.append(title, spacer, close);
    const list = document.createElement('div'); list.className = 'pdf-thumb-list';
    panel.append(head, list); viewer.host.appendChild(panel);
    viewer._thumbPanel = panel; viewer._thumbBtn && viewer._thumbBtn.classList.add('on');
    renderPdfThumbnails(viewer, panel, list);
  }
  window.__buildPdfOutline = buildAutoOutline;
  function updatePdfAnnoCount(viewer) {
    const el = viewer.host && viewer.host.querySelector('.pdf-anno-count');
    if (el) el.textContent = '标注 ' + viewer.ann.annotations.length;
  }
  function pdfAnnoScrollClick(ev, viewer) {
    if (!ev.target || ev.target.closest('.pdf-toolbar') || ev.target.closest('.pdf-sel-toolbar') || ev.target.closest('.pdf-anno-pop')) return;
    if (ev.button !== 0) return;
    // 坐标命中高亮（hl 为 pointer-events:none，须手动判定）
    for (const rec of viewer.pages) {
      const ovr = rec.ov.getBoundingClientRect();
      if (ev.clientX < ovr.left || ev.clientX > ovr.right || ev.clientY < ovr.top || ev.clientY > ovr.bottom) continue;
      for (const a of viewer.ann.annotations) {
        if (a.page !== rec.pageNum) continue;
        const currentScale = pdfAnnotationScale(viewer, rec.pageNum);
        const sf = currentScale / (Number(a.scale) || currentScale);
        for (const r of (a.rects || [])) {
          const l = ovr.left + r.x * sf, t = ovr.top + r.y * sf;
          const w = Math.max(2, r.width * sf), h = Math.max(2, r.height * sf);
          if (ev.clientX >= l && ev.clientX <= l + w && ev.clientY >= t && ev.clientY <= t + h) {
            ev.stopPropagation();
            showAnnoPopover(ev, viewer, a, rec.pageNum);
            return;
          }
        }
      }
    }
  }
  function showAnnoPopover(ev, viewer, anno, pageNum) {
    if (pdfPopover) pdfPopover.remove();
    const pop = document.createElement('div'); pop.className = 'pdf-anno-pop';
    const txt = document.createElement('div'); txt.className = 'txt'; txt.textContent = anno.text || '';
    const note = document.createElement('div'); note.className = 'note'; note.innerHTML = anno.note ? (renderMd(anno.note) || '') : '';
    const row = document.createElement('div'); row.className = 'row';
    const edit = document.createElement('button'); edit.textContent = '✎ 笔记'; edit.onclick = () => startAnnoNoteEdit(pop, viewer, anno, pageNum, note, edit);
    const del = document.createElement('button'); del.className = 'danger'; del.textContent = '删除'; del.onclick = async () => {
      pushUndo(viewer); viewer.ann.annotations = viewer.ann.annotations.filter((x) => x.id !== anno.id);
      await saveAnnotations(viewer.path, viewer); renderPdfOverlay(viewer, pageNum); window.renderReadingAnnotationsList && renderReadingAnnotationsList(); updatePdfAnnoCount(viewer); pop.remove();
    };
    const cls = document.createElement('button'); cls.textContent = '关闭'; cls.onclick = () => pop.remove();
    row.append(edit, del, cls);
    pop.append(txt, note, row);
    document.body.appendChild(pop);
    const rr = ev && ev.target && ev.target.getBoundingClientRect ? ev.target.getBoundingClientRect() : { right: ev.clientX, top: ev.clientY };
    pop.style.left = Math.max(4, Math.min(rr.right + 8, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(4, Math.min(rr.bottom + 4, innerHeight - pop.offsetHeight - 4)) + 'px';
    pdfPopover = pop;
    setTimeout(() => {
      const dismiss = (e2) => { if (pop.querySelector('textarea')) return; if (!pop.contains(e2.target)) { pop.remove(); document.removeEventListener('mousedown', dismiss); } };
      document.addEventListener('mousedown', dismiss);
    }, 0);
  }

  function startAnnoNoteEdit(pop, viewer, anno, pageNum, noteDiv, editBtn) {
    if (pop.querySelector('textarea')) { pop.querySelector('textarea').focus(); return; }
    const ta = document.createElement('textarea'); ta.className = 'pop-edit'; ta.value = anno.note || ''; ta.placeholder = '直接在此处输入笔记…（回车保存，Esc 取消）';
    const row = document.createElement('div'); row.className = 'pop-edit-row';
    const save = document.createElement('button'); save.className = 'primary'; save.textContent = '保存';
    const cancel = document.createElement('button'); cancel.textContent = '取消';
    row.append(save, cancel);
    const commit = async () => { const v = ta.value.trim(); pushUndo(viewer); anno.note = v; await saveAnnotations(viewer.path, viewer); renderPdfOverlay(viewer, pageNum); window.renderReadingAnnotationsList && window.renderReadingAnnotationsList(); pop.remove(); };
    save.onclick = (e) => { e.stopPropagation(); commit(); };
    cancel.onclick = (e) => { e.stopPropagation(); ta.remove(); row.remove(); noteDiv.innerHTML = anno.note ? (renderMd(anno.note) || '') : ''; editBtn.style.display = ''; };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save.click(); }
      else if (e.key === 'Escape') { e.stopPropagation(); cancel.click(); }
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (!pop.contains(document.activeElement)) cancel.click(); }, 150));
    noteDiv.textContent = '';
    editBtn.style.display = 'none';
    const btnRow = pop.querySelector('.row');
    pop.insertBefore(ta, btnRow); pop.insertBefore(row, btnRow);
    ta.focus();
  }

  /* ---------- 选区 → 矩形 ---------- */
  function pdfRangeOffsetInSpan(span,node,offset) {
    if(!span||!node||!span.contains(node))return null;
    try{const probe=document.createRange();probe.selectNodeContents(span);probe.setEnd(node,offset);return probe.toString().length;}catch(_){return null;}
  }
  function normalizePdfSelectionText(range,textLayer,fallback) {
    const parts=[];
    for(const span of textLayer.querySelectorAll('span')){
      try{if(!range.intersectsNode(span))continue;}catch(_){continue;}
      const full=String(span.textContent||'');if(!full)continue;
      let start=0,end=full.length;
      const localStart=pdfRangeOffsetInSpan(span,range.startContainer,range.startOffset),localEnd=pdfRangeOffsetInSpan(span,range.endContainer,range.endOffset);
      if(localStart!==null)start=Math.max(0,Math.min(full.length,localStart));
      if(localEnd!==null)end=Math.max(start,Math.min(full.length,localEnd));
      const text=full.slice(start,end).replace(/\u00ad/g,'');if(!text)continue;
      const rect=span.getBoundingClientRect();parts.push({text,left:rect.left,right:rect.right,top:rect.top,height:rect.height,eol:span.dataset.pdfEol==='1'});
    }
    if(!parts.length)return String(fallback||'').replace(/\u00ad/g,'').replace(/\s+/g,' ').trim();
    let out='',prev=null;
    for(const part of parts){
      let text=part.text.replace(/\s+/g,' ');if(!text)continue;
      if(prev){
        const sameLine=Math.abs((part.top+part.height/2)-(prev.top+prev.height/2))<=Math.max(2,Math.min(part.height,prev.height)*.42);
        if(sameLine){
          const gap=part.left-prev.right,wordBoundary=/[A-Za-z0-9)]$/.test(out)&&/^[A-Za-z0-9([]/.test(text);
          if(wordBoundary&&gap>Math.max(1.5,Math.min(part.height,prev.height)*.12)&&!out.endsWith(' '))out+=' ';
        }else if(/[A-Za-z]-$/.test(out)&&/^[a-z]/.test(text))out=out.slice(0,-1);
        else if(!/\s$/.test(out)){const verticalGap=part.top-(prev.top+prev.height);out+=prev.eol&&verticalGap>Math.max(3,prev.height*.65)?'\n':' ';}
      }
      out+=text;prev=part;
    }
    return out.replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/[ \t]{2,}/g,' ').replace(/\s+([,.;:!?])/g,'$1').trim();
  }
  function mergePdfSelectionRects(raw,hostRect) {
    const clean=[];
    for(const r of raw){
      const left=Math.max(r.left,hostRect.left),right=Math.min(r.right,hostRect.right),top=Math.max(r.top,hostRect.top),bottom=Math.min(r.bottom,hostRect.bottom);
      if(right-left<1||bottom-top<1)continue;
      clean.push({x:left-hostRect.left,y:top-hostRect.top,width:right-left,height:bottom-top});
    }
    clean.sort((a,b)=>a.y+a.height/2-(b.y+b.height/2)||a.x-b.x);
    const merged=[];
    for(const next of clean){
      const old=merged[merged.length-1],sameLine=old&&Math.abs((old.y+old.height/2)-(next.y+next.height/2))<=Math.max(2,Math.min(old.height,next.height)*.42),gap=old?next.x-(old.x+old.width):Infinity;
      if(sameLine&&gap>=-2&&gap<=Math.max(6,Math.min(old.height,next.height)*.7)){
        const right=Math.max(old.x+old.width,next.x+next.width),bottom=Math.max(old.y+old.height,next.y+next.height);old.y=Math.min(old.y,next.y);old.width=right-old.x;old.height=bottom-old.y;
      }else if(!old||Math.abs(old.x-next.x)>1||Math.abs(old.y-next.y)>1||Math.abs(old.width-next.width)>1||Math.abs(old.height-next.height)>1)merged.push(next);
    }
    return merged;
  }
  function selectedRectsIn(textLayer) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    let inside = false;
    try {
      const start=range.startContainer.nodeType===3?range.startContainer.parentElement:range.startContainer;
      const end=range.endContainer.nodeType===3?range.endContainer.parentElement:range.endContainer;
      inside = !!start&&!!end&&textLayer.contains(start)&&textLayer.contains(end);
    } catch (_) { inside = false; }
    if (!inside) return null;
    const text=normalizePdfSelectionText(range,textLayer,sel.toString());if(!text)return null;
    // 保留逐行矩形，只合并同一视觉行内相邻的小片段，避免跨栏或跨段生成大块误选区域。
    const hostRect = textLayer.getBoundingClientRect();
    const raw=[...range.getClientRects()].filter((r)=>r.width>1&&r.height>1&&r.right>hostRect.left&&r.left<hostRect.right&&r.bottom>hostRect.top&&r.top<hostRect.bottom);
    const rects=mergePdfSelectionRects(raw,hostRect);
    const anchor=raw.length?raw[raw.length-1]:range.getBoundingClientRect();
    return { text, rects, anchor };
  }

  function attachPageInteractions(viewer, rec) {
    const tl = rec.textLayer;
    tl.addEventListener('mouseup', (e) => {
      setTimeout(() => {
        const r = selectedRectsIn(tl);
        if (r&&r.rects.length) {
          pdfToolbarState = { viewer, page: rec.pageNum, text: r.text, rects: r.rects };
          showPdfToolbar(e.clientX, e.clientY, r.anchor);
        }
      }, 10);
    });
    tl.addEventListener('mousedown', () => { tl.classList.add('selecting');hidePdfToolbar(); if (pdfPopover) pdfPopover.remove(); });
    tl.addEventListener('mouseup',()=>tl.classList.remove('selecting'));
  }

  /* ---------- 准备 PDF.js 文本层（保留其原生 transform，确保划选坐标与画布一致） ---------- */
  async function applyRealFonts(page, textLayer, textContent) {
    try {
      // 只预加载 PDF.js 已解析的字体，不覆盖 span 的 font-family/scaleX。
      // scaleX 是 PDF.js 按字形宽度计算的关键校正，移除它会导致鼠标选区横向错位。
      const fontNames = new Set();
      for (const it of textContent.items) if (it.fontName) fontNames.add(it.fontName);
      const loads = [];
      for (const fn of fontNames) {
        let fo = null;
        try { fo = page.commonObjs.get(fn); } catch (_) {}
        if (!fo) continue;
        let family = null;
        if (fo.cssFontInfo && fo.cssFontInfo.fontFamily) family = String(fo.cssFontInfo.fontFamily);
        else if (fo.systemFontInfo && fo.systemFontInfo.baseFontName) family = String(fo.systemFontInfo.baseFontName).replace(/[",]/g, '');
        else family = fo.loadedName;
        if (!family) continue;
        if (fo.createNativeFontFace && ![...document.fonts].some(f => f.family === family)) {
          try {
            const ff = fo.createNativeFontFace();
            if (ff && ff.family) { document.fonts.add(ff); loads.push(ff.loaded ? ff.loaded.catch(() => {}) : Promise.resolve()); }
          } catch (_) {}
        }
      }
      const spans=[...textLayer.querySelectorAll('span')],items=(textContent.items||[]).filter((item)=>String(item.str||'').length);
      for(let i=0;i<Math.min(spans.length,items.length);i++){spans[i].dataset.pdfTextIndex=String(i);spans[i].dataset.pdfEol=items[i].hasEOL?'1':'0';}
      if (loads.length) await Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, 3000))]);
    } catch (_) { /* 字体修正失败不影响画布渲染 */ }
  }

  /* ---------- PDF.js 官方 Viewer 页面桥接：只登记已经进入渲染队列的可见页 ---------- */
  function registerOfficialPdfPage(viewer, pageNum) {
    if (!viewer || !viewer.pdfViewer) return null;
    const pageView = viewer.pdfViewer.getPageView(pageNum - 1);
    if (!pageView || !pageView.div) return null;
    const textLayer = (pageView.textLayer && pageView.textLayer.div) || pageView.div.querySelector('.textLayer');
    if (!textLayer) return null;
    let rec = viewer.pages.find((item) => item.pageNum === pageNum);
    let ov = pageView.div.querySelector(':scope > .pdf-anno-overlay');
    if (!ov) { ov = document.createElement('div'); ov.className = 'pdf-anno-overlay'; pageView.div.appendChild(ov); }
    if (!rec) {
      rec = { pageNum, wrap:pageView.div, canvas:pageView.canvas || pageView.div.querySelector('canvas'), textLayer, ov, page:pageView.pdfPage, viewport:pageView.viewport, plainText:'' };
      viewer.pages.push(rec); viewer.pages.sort((a,b) => a.pageNum - b.pageNum);
    } else Object.assign(rec, { wrap:pageView.div, canvas:pageView.canvas || pageView.div.querySelector('canvas'), textLayer, ov, page:pageView.pdfPage, viewport:pageView.viewport });
    if (!textLayer.dataset.codescopeBound) { textLayer.dataset.codescopeBound = '1'; attachPageInteractions(viewer, rec); }
    if (!rec.plainText && pageView.pdfPage && !rec._textPromise) rec._textPromise = pageView.pdfPage.getTextContent().then((content) => {
      rec.plainText = (content.items || []).map((item) => item.str || '').join(' '); applyRealFonts(pageView.pdfPage, textLayer, content); return rec.plainText;
    }).catch(() => '').finally(() => { rec._textPromise = null; });
    renderPdfOverlay(viewer, pageNum); applyPdfFindMarksToPage(viewer, rec);
    return rec;
  }
  async function ensureOfficialPdfPage(viewer, pageNum) {
    let rec = registerOfficialPdfPage(viewer, pageNum);
    if (rec && rec.textLayer && rec.textLayer.isConnected) return rec;
    viewer.pdfViewer.currentPageNumber = Math.max(1, Math.min(viewer.numPages, pageNum));
    viewer.pdfViewer.update(); viewer.pdfViewer.forceRendering();
    const started = Date.now();
    while (viewer._alive && Date.now() - started < 7000) {
      await new Promise((resolve) => setTimeout(resolve, 45));
      rec = registerOfficialPdfPage(viewer, pageNum);
      if (rec && rec.textLayer && rec.textLayer.isConnected) return rec;
    }
    return rec;
  }

  /* ---------- 旧渲染器仅作为不支持官方 Viewer 时的兼容降级 ---------- */
  async function renderLegacyPdfPage(viewer, pageNum) {
    const pdf = viewer.pdf;
    const page = await pdf.getPage(pageNum);
    const vp = page.getViewport({ scale: viewer.scale });
    const wrap = document.createElement('div'); wrap.className = 'pdf-page-wrap'; wrap.dataset.page = pageNum;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * 2); canvas.height = Math.floor(vp.height * 2);
    canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
    const ctx = canvas.getContext('2d');
    wrap.appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport: vp, transform: [2, 0, 0, 2, 0, 0] }).promise;
    const textLayer = document.createElement('div'); textLayer.className = 'pdf-text-layer';
    wrap.appendChild(textLayer);
    const textContent = await page.getTextContent();
    const pdfjs = await loadPdfJs();
    try {
      textLayer.style.setProperty('--scale-factor', vp.scale);
      const tl = new pdfjs.TextLayer({ textContentSource: textContent, container: textLayer, viewport: vp });
      await tl.render();
      await applyRealFonts(page, textLayer, textContent);
    } catch (_) { /* 文本层失败不影响画布 */ }
    const ov = document.createElement('div'); ov.className = 'pdf-anno-overlay';
    wrap.appendChild(ov);
    const rec = { pageNum, wrap, canvas, textLayer, ov, page, viewport: vp, plainText: (textContent.items || []).map((it) => it.str || '').join(' ') };
    viewer.pages.push(rec);
    viewer.pages.sort((a, b) => a.pageNum - b.pageNum);
    insertPdfPageWrap(viewer, wrap, pageNum);
    attachPageInteractions(viewer, rec);
    renderPdfOverlay(viewer, pageNum);
    applyPdfFindMarksToPage(viewer, rec);
    return rec;
  }
  async function renderPdfPage(viewer, pageNum) {
    return viewer && viewer.pdfViewer ? ensureOfficialPdfPage(viewer, pageNum) : renderLegacyPdfPage(viewer, pageNum);
  }
  /* 按页码顺序把渲染完成的页面插入滚动容器 —— 并发渲染完成顺序与页码无关，直接 appendChild 会把页面顺序打乱 */
  function insertPdfPageWrap(viewer, wrap, pageNum) {
    const kids = viewer.scroll.children;
    for (let i = 0; i < kids.length; i++) {
      const dp = Number(kids[i].dataset.page);
      if (dp > pageNum) { viewer.scroll.insertBefore(wrap, kids[i]); return; }
    }
    viewer.scroll.appendChild(wrap);
  }

  /* ---------- 页码 / 缩放 ---------- */
  function currentVisiblePage(viewer) {
    if (viewer.pdfViewer) return viewer.pdfViewer.currentPageNumber || viewer.currentPage;
    const top = viewer.scroll.scrollTop + 16;
    for (const p of [...viewer.pages].sort((a, b) => a.pageNum - b.pageNum)) {
      if (p.wrap.offsetTop <= top && p.wrap.offsetTop + p.wrap.offsetHeight >= top) return p.pageNum;
    }
    return viewer.currentPage;
  }
  function updatePageDisplay(viewer) {
    if (viewer._pagePill) viewer._pagePill.textContent = viewer.currentPage + ' / ' + (viewer.numPages || '—');
    syncPdfThumbnailActive(viewer);
    const els = viewer.slotEls;
    if (!els) return;
    els.page.value = viewer.currentPage;
    els.pages.textContent = '/ ' + viewer.numPages;
    const doc = READING_DOCS.get(viewer.path);
    if (doc) { doc.meta.page = viewer.currentPage; saveReadingDoc(doc); }
  }
  const clampZoom = (s) => Math.max(0.2, Math.min(4, s));
  function updateZoomUI(viewer) {
    const zl = viewer._zoomPct;
    if (zl) zl.textContent = Math.round(viewer.scale * 100) + '%';
    const rng = viewer._zoomRange;
    if (rng && document.activeElement !== rng) rng.value = String(Math.round(viewer.scale * 100));
    const fw = viewer._fitWBtn, fp = viewer._fitPBtn;
    if (fw) fw.classList.toggle('on', viewer.fitMode === 'width');
    if (fp) fp.classList.toggle('on', viewer.fitMode === 'page');
  }
  function setPdfLayout(viewer, mode, persist) {
    if (!viewer || !viewer.pdfViewer || !viewer._pdfViewerLib) return;
    const lib = viewer._pdfViewerLib, current = viewer.pdfViewer.currentPageNumber || viewer.currentPage;
    mode = ['continuous','single','spread','spread-cover'].includes(mode) ? mode : 'continuous';
    if (mode === 'continuous') { viewer.pdfViewer.spreadMode = lib.SpreadMode.NONE; viewer.pdfViewer.scrollMode = lib.ScrollMode.VERTICAL; }
    else if (mode === 'single') { viewer.pdfViewer.spreadMode = lib.SpreadMode.NONE; viewer.pdfViewer.scrollMode = lib.ScrollMode.PAGE; }
    else if (mode === 'spread') { viewer.pdfViewer.scrollMode = lib.ScrollMode.VERTICAL; viewer.pdfViewer.spreadMode = lib.SpreadMode.ODD; }
    else { viewer.pdfViewer.scrollMode = lib.ScrollMode.VERTICAL; viewer.pdfViewer.spreadMode = lib.SpreadMode.EVEN; }
    viewer.layoutMode = mode; if (viewer._layoutSelect) viewer._layoutSelect.value = mode;
    viewer.pdfViewer.currentPageNumber = current;
    viewer.pdfViewer.update(); viewer.pdfViewer.forceRendering();
    if (persist !== false) savePdfViewState(viewer);
  }
  function setPdfHandMode(viewer, enabled) {
    viewer.handMode = !!enabled; viewer.host.classList.toggle('pdf-hand-mode', viewer.handMode);
    if (viewer._handBtn) viewer._handBtn.classList.toggle('on', viewer.handMode);
  }
  function bindPdfHandPan(viewer) {
    const scroll = viewer.scroll; let drag = null;
    const finish = (event) => { if (!drag) return; try { scroll.releasePointerCapture(event.pointerId); } catch (_) {} drag = null; viewer.host.classList.remove('pdf-hand-dragging'); };
    scroll.addEventListener('pointerdown', (event) => {
      if (!viewer.handMode || event.button !== 0 || event.target.closest('button,input,select,textarea,a')) return;
      drag = { x:event.clientX, y:event.clientY, left:scroll.scrollLeft, top:scroll.scrollTop }; scroll.setPointerCapture(event.pointerId); viewer.host.classList.add('pdf-hand-dragging'); event.preventDefault();
    });
    scroll.addEventListener('pointermove', (event) => { if (!drag) return; scroll.scrollLeft = drag.left - (event.clientX - drag.x); scroll.scrollTop = drag.top - (event.clientY - drag.y); event.preventDefault(); });
    scroll.addEventListener('pointerup', finish); scroll.addEventListener('pointercancel', finish);
  }
  function applyPdfTransform(viewer, s) {
    const f = s / viewer.baseScale;
    viewer._previewF = f;
    for (const rec of viewer.pages) rec.wrap.style.transform = f === 1 ? '' : 'scale(' + f + ')';
  }
  function wrapTopAt(viewer, docY) {
    let best = 0;
    for (const p of viewer.pages) {
      if (p.wrap.offsetTop <= docY && docY <= p.wrap.offsetTop + p.wrap.offsetHeight) return p.wrap.offsetTop;
      if (p.wrap.offsetTop <= docY) best = p.wrap.offsetTop;
    }
    return best;
  }
  function previewPdfZoomAt(viewer, s, clientX, clientY, opts) {
    if (!viewer._alive) return;
    s = clampZoom(s);
    const o = opts || {};
    if (viewer.pdfViewer) {
      viewer.fitMode = o.fitMode !== undefined ? o.fitMode : null;
      viewer.pdfViewer.currentScale = s; viewer.scale = viewer.pdfViewer.currentScale; viewer.baseScale = viewer.scale;
      updateZoomUI(viewer); savePdfViewState(viewer); return;
    }
    const rect = viewer.scroll.getBoundingClientRect();
    const vpTop = viewer.scroll.scrollTop;
    const oldScale = viewer.scale || viewer.baseScale;
    const vpOff = clientY - rect.top;
    const docY = (vpTop + vpOff) / oldScale;                       // 锚点（scale=1 文档坐标）
    const p = docY * oldScale;                                     // 锚点布局坐标
    const T = wrapTopAt(viewer, p);
    const f = s / oldScale;
    applyPdfTransform(viewer, s);                                  // 即时 CSS 缩放
    viewer.scroll.scrollTop = Math.max(0, vpTop + (p - T) * (f - 1)); // 光标锚定
    viewer._pendingZoom = { s, anchorDocY: docY, vpOff, mode: o.fitMode !== undefined ? o.fitMode : undefined };
    if (o.fitMode !== undefined) viewer.fitMode = o.fitMode;
    updateZoomUI(viewer);
    clearTimeout(viewer._zoomTimer);
    viewer._zoomTimer = setTimeout(() => commitPdfZoom(viewer), 320); // 防抖精确重建
  }
  function commitPdfZoom(viewer) {
    if (!viewer._alive) return;
    if (viewer.pdfViewer) { viewer.scale = viewer.pdfViewer.currentScale; viewer.baseScale = viewer.scale; updateZoomUI(viewer); savePdfViewState(viewer); return; }
    const z = viewer._pendingZoom; viewer._pendingZoom = null;
    applyPdfTransform(viewer, 1);                                  // 还原 transform
    viewer._previewF = 1;
    const s = z ? clampZoom(z.s) : viewer.scale;
    viewer.baseScale = s; viewer.scale = s;
    if (z && z.mode !== undefined) viewer.fitMode = z.mode;
    updateZoomUI(viewer);
    savePdfViewState(viewer);
    const docY = z ? z.anchorDocY : null, vpOff = z ? z.vpOff : 8;
    const topPage = viewer.currentPage;
    viewer.scroll.replaceChildren();
    viewer.pages = [];
    renderPdfPage(viewer, 1).then(() => {
      for (let i = 2; i <= viewer.numPages; i++) renderPdfPage(viewer, i).catch(() => {});
      setTimeout(() => {
        if (docY !== null) viewer.scroll.scrollTop = Math.max(0, docY * viewer.scale - vpOff);
        else {
          const rec = viewer.pages.find((p) => p.pageNum === topPage);
          if (rec) viewer.scroll.scrollTop = rec.wrap.offsetTop - 8;
        }
      }, 60);
    });
  }
  function fitPdfMode(viewer, mode) {
    if (!viewer._alive || !viewer._pageW) return;
    if (viewer.pdfViewer) {
      viewer.fitMode = mode; viewer.pdfViewer.currentScaleValue = mode === 'page' ? 'page-fit' : 'page-width';
      viewer.scale = viewer.pdfViewer.currentScale; viewer.baseScale = viewer.scale; updateZoomUI(viewer); savePdfViewState(viewer); return;
    }
    const w = Math.max(120, viewer.scroll.clientWidth - 26);
    const h = Math.max(120, viewer.scroll.clientHeight - 14);
    const s = mode === 'page' ? Math.min(w / viewer._pageW, h / viewer._pageH) : w / viewer._pageW;
    const rect = viewer.scroll.getBoundingClientRect();
    previewPdfZoomAt(viewer, s, rect.left + 12, rect.top + 8, { fitMode: mode });
    commitPdfZoom(viewer);                                        // fit 立即精确重建
  }
  function quickZoom(viewer, s) {
    const rect = viewer.scroll.getBoundingClientRect();
    viewer.fitMode = null;
    previewPdfZoomAt(viewer, s, rect.left + 12, rect.top + viewer.scroll.clientHeight / 2, { fitMode: null });
  }

  /* ---------- 阅读体验：全文查找 / 快捷键 / 视图记忆 / 专注模式 ---------- */
  function pdfViewStateKey(path) { return 'mc-pdf-view:' + path; }
  function loadPdfViewState(path) {
    try { const raw = localStorage.getItem(pdfViewStateKey(path)); return raw ? JSON.parse(raw) : null; }
    catch (_) { return null; }
  }
  function savePdfViewState(viewer) {
    if (!viewer || !viewer.path) return;
    try { localStorage.setItem(pdfViewStateKey(viewer.path), JSON.stringify({ scale: viewer.scale, fitMode: viewer.fitMode, layoutMode:viewer.layoutMode || 'continuous', rotation:viewer.pdfViewer ? viewer.pdfViewer.pagesRotation : 0, handMode:!!viewer.handMode, updatedAt: Date.now() })); }
    catch (_) {}
  }
  function normalizePdfFindText(text) {
    return String(text || '').normalize('NFKC').replace(/\u00ad/g, '').replace(/-\s+/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  }
  function pdfFindCount(text, query) {
    if (!query) return 0;
    let count = 0, pos = 0;
    while ((pos = text.indexOf(query, pos)) !== -1) { count++; pos += Math.max(1, query.length); }
    if (count) return count;
    const words = query.split(/\s+/).filter((w) => w.length >= 2);
    return words.length > 1 && words.every((w) => text.includes(w)) ? 1 : 0;
  }
  async function buildPdfFindIndex(viewer) {
    if (viewer._findIndex) return viewer._findIndex;
    if (viewer._findIndexPromise) return viewer._findIndexPromise;
    viewer._findIndexPromise = (async () => {
      const rows = [];
      for (let pageNum = 1; pageNum <= viewer.numPages; pageNum++) {
        if (!viewer._alive) break;
        const rendered = viewer.pages.find((p) => p.pageNum === pageNum);
        let text = rendered && rendered.plainText;
        if (!text) {
          try {
            const page = await viewer.pdf.getPage(pageNum);
            const tc = await page.getTextContent();
            text = (tc.items || []).map((it) => it.str || '').join(' ');
          } catch (_) { text = ''; }
        }
        rows.push({ page: pageNum, text: normalizePdfFindText(text) });
        if (viewer._find && viewer._find.open && pageNum % 3 === 0) {
          viewer._find.status.textContent = '索引 ' + pageNum + '/' + viewer.numPages;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      viewer._findIndex = rows;
      return rows;
    })();
    try { return await viewer._findIndexPromise; }
    finally { viewer._findIndexPromise = null; }
  }
  function pdfFindWords(query) {
    const q = normalizePdfFindText(query);
    const words = q.split(/\s+/).filter((w) => w.length >= 2);
    return { q, words: words.length ? words : (q ? [q] : []) };
  }
  function applyPdfFindMarksToPage(viewer, rec) {
    if (!rec || !rec.textLayer) return;
    const spans = rec.textLayer.querySelectorAll('span');
    spans.forEach((sp) => sp.classList.remove('pdf-find-hit', 'pdf-find-current'));
    const find = viewer && viewer._find;
    if (!find || !find.query || !find.resultPages || !find.resultPages.has(rec.pageNum)) return;
    const parts = pdfFindWords(find.query);
    const currentPage = find.results[find.current] && find.results[find.current].page;
    spans.forEach((sp) => {
      const text = normalizePdfFindText(sp.textContent);
      if (!text) return;
      const hit = text.includes(parts.q) || parts.words.some((word) => text.includes(word));
      if (!hit) return;
      sp.classList.add('pdf-find-hit');
      if (rec.pageNum === currentPage) sp.classList.add('pdf-find-current');
    });
  }
  function refreshPdfFindMarks(viewer) {
    if (!viewer) return;
    viewer.pages.forEach((rec) => applyPdfFindMarksToPage(viewer, rec));
  }
  function syncPdfFindStatus(viewer) {
    const find = viewer && viewer._find;
    if (!find) return;
    const totalPages = find.results.length;
    const totalHits = find.results.reduce((sum, row) => sum + row.count, 0);
    find.status.textContent = totalPages ? ((find.current + 1) + '/' + totalPages + ' 页 · ' + totalHits + ' 处') : (find.query ? '无结果' : '输入关键词');
    find.prev.disabled = find.next.disabled = !totalPages;
  }
  function showPdfFindResult(viewer, index) {
    const find = viewer && viewer._find;
    if (!find || !find.results.length) { syncPdfFindStatus(viewer); refreshPdfFindMarks(viewer); return; }
    find.current = (index + find.results.length) % find.results.length;
    const page = find.results[find.current].page;
    viewer.goToPage(page);
    refreshPdfFindMarks(viewer);
    syncPdfFindStatus(viewer);
    setTimeout(() => {
      if (!viewer._alive) return;
      const rec = viewer.pages.find((p) => p.pageNum === page);
      const hit = rec && rec.textLayer.querySelector('.pdf-find-current');
      if (hit) hit.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, 80);
  }
  async function runPdfFind(viewer, query, keepPage) {
    const find = viewer && viewer._find;
    if (!find) return;
    const request = ++find.request;
    find.query = String(query || '').trim();
    if (!find.query) {
      find.results = []; find.resultPages = new Set(); find.current = -1;
      refreshPdfFindMarks(viewer); syncPdfFindStatus(viewer); return;
    }
    find.status.textContent = '正在检索…'; find.prev.disabled = find.next.disabled = true;
    const rows = await buildPdfFindIndex(viewer);
    if (!viewer._alive || request !== find.request) return;
    const q = normalizePdfFindText(find.query);
    find.results = rows.map((row) => ({ page: row.page, count: pdfFindCount(row.text, q) })).filter((row) => row.count > 0);
    find.resultPages = new Set(find.results.map((row) => row.page));
    find.current = find.results.findIndex((row) => row.page >= (keepPage || viewer.currentPage));
    if (find.current < 0 && find.results.length) find.current = 0;
    if (find.results.length) showPdfFindResult(viewer, find.current);
    else { refreshPdfFindMarks(viewer); syncPdfFindStatus(viewer); }
  }
  function openPdfFind(viewer) {
    const find = viewer && viewer._find;
    if (!find) return;
    find.open = true; find.bar.hidden = false; find.button.classList.add('on');
    requestAnimationFrame(() => { find.input.focus(); find.input.select(); });
  }
  function closePdfFind(viewer, clear) {
    const find = viewer && viewer._find;
    if (!find) return;
    find.open = false; find.bar.hidden = true; find.button.classList.remove('on');
    if (clear) { find.input.value = ''; runPdfFind(viewer, ''); }
    viewer.host.focus({ preventScroll: true });
  }
  function togglePdfFocus(viewer) {
    if (!viewer || !viewer._alive) return;
    const on = !viewer.host.classList.contains('pdf-reader-focus');
    viewer.host.classList.toggle('pdf-reader-focus', on);
    document.body.classList.toggle('pdf-reader-focus', on);
    if (viewer._focusBtn) { viewer._focusBtn.classList.toggle('on', on); viewer._focusBtn.textContent = on ? '⤢ 退出' : '⛶ 专注'; }
    requestAnimationFrame(() => requestAnimationFrame(() => { if (viewer._alive && viewer.fitMode) fitPdfMode(viewer, viewer.fitMode); }));
  }
  function bindPdfReaderKeys(viewer) {
    const onKey = (e) => {
      if (!viewer._alive || !viewer.host.contains(e.target)) return;
      const editable = e.target && (e.target.matches('input,textarea,select') || e.target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openPdfFind(viewer); return; }
      if (e.key === 'Escape') {
        if (viewer._find && viewer._find.open) { e.preventDefault(); closePdfFind(viewer, true); return; }
        if (viewer._tocPanel) { e.preventDefault(); togglePdfOutline(viewer); return; }
        if (viewer.host.classList.contains('pdf-reader-focus')) { e.preventDefault(); togglePdfFocus(viewer); }
        return;
      }
      if (editable) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      if (e.key === 'PageDown' || (e.altKey && e.key === 'ArrowRight')) { e.preventDefault(); viewer.goToPage(viewer.currentPage + 1); }
      else if (e.key === 'PageUp' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); viewer.goToPage(viewer.currentPage - 1); }
      else if (e.key === 'Home') { e.preventDefault(); viewer.goToPage(1); }
      else if (e.key === 'End') { e.preventDefault(); viewer.goToPage(viewer.numPages); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); quickZoom(viewer, viewer.scale * 1.15); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '-') { e.preventDefault(); quickZoom(viewer, viewer.scale / 1.15); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '0') { e.preventDefault(); fitPdfMode(viewer, 'width'); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '1') { e.preventDefault(); fitPdfMode(viewer, 'page'); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '2' && viewer.pdfViewer) { e.preventDefault(); setPdfLayout(viewer, viewer.layoutMode === 'spread' ? 'continuous' : 'spread'); }
    };
    viewer._keyHandler = onKey;
    viewer.host.addEventListener('keydown', onKey);
  }

  async function openReadingPdfInOnlyOffice(viewer) {
    if (!viewer || !viewer._alive || viewer._onlyOfficeOverlay) return;
    readingStatus('正在连接 ONLYOFFICE PDF Editor…');
    try {
      const response = await fetch('/api/readings/onlyoffice/config?path=' + encodeURIComponent(viewer.path), { cache:'no-store' });
      let result = {}; try { result = await response.json(); } catch (_) {}
      if (!response.ok || !result.ok) throw new Error(result.error || 'ONLYOFFICE Docs 服务不可用');
      await ensureOnlyOfficeApi(result.documentServerUrl);
      const overlay = document.createElement('section'); overlay.className = 'reading-onlyoffice-overlay';
      const bar = document.createElement('div'); bar.className = 'reading-onlyoffice-bar';
      const title = document.createElement('span'); title.className = 'title'; title.textContent = 'ONLYOFFICE PDF Editor';
      const status = document.createElement('span'); status.className = 'status'; status.textContent = '正在载入编辑器…';
      const close = document.createElement('button'); close.textContent = '保存并返回 PDF.js'; close.title = '强制保存 ONLYOFFICE 当前版本，确认回写后再返回 PDF.js';
      const editorHost = document.createElement('div'); editorHost.className = 'reading-onlyoffice-editor'; editorHost.id = 'reading-onlyoffice-' + Date.now();
      bar.append(title, status, close); overlay.append(bar, editorHost); viewer.host.appendChild(overlay);
      viewer._onlyOfficeOverlay = overlay;
      let closing = false;
      const closeEditor = async () => {
        if (closing) return;
        closing = true; close.disabled = true; close.textContent = '正在同步…'; status.textContent = '正在强制保存并等待 PDF 回写…';
        const synced = await api('/api/readings/onlyoffice/forcesave', { path:viewer.path, key:result.config.document.key });
        if (!synced.ok || synced.pending) {
          closing = false; close.disabled = false; close.textContent = '重试保存并返回';
          status.textContent = synced.error || '保存回调尚未完成，请稍后重试';
          readingStatus('ONLYOFFICE 与 PDF.js 同步失败：' + status.textContent, true);
          return;
        }
        status.textContent = synced.changed ? '文件已回写，正在刷新 PDF.js…' : '没有待保存更改，正在返回…';
        if (viewer._onlyOfficeEditor && typeof viewer._onlyOfficeEditor.destroyEditor === 'function') { try { viewer._onlyOfficeEditor.destroyEditor(); } catch (_) {} }
        viewer._onlyOfficeEditor = null; viewer._onlyOfficeOverlay = null; overlay.remove();
        const slot = Number.isFinite(viewer.slot) ? viewer.slot : READING_ACTIVE_SLOT;
        await renderReadingSlot(slot);
        readingStatus(synced.changed ? 'ONLYOFFICE 更改已同步，PDF.js 已加载最新版本' : '已返回 PDF.js 阅读视图');
      };
      close.onclick = closeEditor; viewer._closeOnlyOffice = closeEditor;
      const config = { ...result.config, events:{
        onDocumentReady:() => { status.textContent = '完整 PDF 编辑 · 自动保存已开启'; readingStatus('ONLYOFFICE PDF Editor 已就绪'); },
        onDocumentStateChange:(event) => { status.textContent = event && event.data ? '正在编辑 · 尚未回写 PDF.js' : '更改已收集 · 返回时将强制同步'; },
        onRequestClose:() => closeEditor(),
        onError:(event) => { status.textContent = '编辑器错误 ' + String(event && event.data || ''); readingStatus(status.textContent, true); },
        onWarning:(event) => { status.textContent = '编辑器提示 ' + String(event && event.data || ''); },
      } };
      viewer._onlyOfficeEditor = new window.DocsAPI.DocEditor(editorHost.id, config);
    } catch (error) {
      if (viewer._onlyOfficeOverlay) { viewer._onlyOfficeOverlay.remove(); viewer._onlyOfficeOverlay = null; }
      viewer._onlyOfficeEditor = null;
      readingStatus('ONLYOFFICE PDF 编辑不可用：' + String(error.message || error), true);
      setStatus('err', '无法打开 ONLYOFFICE PDF Editor：\n' + String(error.message || error) + '\n\n请在 Office 模块的“连接设置”中检查 Document Server 地址、回调地址与 JWT 密钥。');
    }
  }

  async function mountOfficialPdfViewer(viewer, pdf, root, remembered) {
    const lib = await loadPdfViewerLib(), eventBus = new lib.EventBus(), linkService = new lib.PDFLinkService({ eventBus });
    const findController = new lib.PDFFindController({ eventBus, linkService });
    const pdfViewer = new lib.PDFViewer({
      container:viewer.scroll, viewer:root, eventBus, linkService, findController,
      imageResourcesPath:'/assets/pdfjs/images/', textLayerMode:1, annotationMode:2,
      removePageBorders:true, maxCanvasPixels:16777216, enableHWA:true,
    });
    viewer.pdfViewer = pdfViewer; viewer._pdfViewerLib = lib; viewer._officialEventBus = eventBus;
    linkService.setViewer(pdfViewer); linkService.setDocument(pdf, null); findController.setDocument(pdf);
    eventBus._on('pagechanging', ({ pageNumber }) => {
      if (!viewer._alive) return; viewer.currentPage = pageNumber; updatePageDisplay(viewer);
      requestAnimationFrame(() => registerOfficialPdfPage(viewer, pageNumber));
    });
    eventBus._on('scalechanging', ({ scale, presetValue }) => {
      if (!viewer._alive) return; viewer.scale = scale || pdfViewer.currentScale; viewer.baseScale = viewer.scale;
      if (presetValue === 'page-width') viewer.fitMode = 'width'; else if (presetValue === 'page-fit') viewer.fitMode = 'page'; else if (presetValue) viewer.fitMode = null;
      updateZoomUI(viewer); requestAnimationFrame(() => viewer.pages.forEach((rec) => registerOfficialPdfPage(viewer, rec.pageNum)));
    });
    eventBus._on('textlayerrendered', ({ pageNumber }) => { if (viewer._alive) registerOfficialPdfPage(viewer, pageNumber); });
    eventBus._on('pagerendered', ({ pageNumber }) => { if (viewer._alive) requestAnimationFrame(() => registerOfficialPdfPage(viewer, pageNumber)); });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PDF.js Viewer 初始化超时')), 12000);
      eventBus._on('pagesinit', () => { clearTimeout(timer); resolve(); }, { once:true });
    });
    pdfViewer.setDocument(pdf); await ready;
    viewer.layoutMode = remembered && remembered.layoutMode || 'continuous'; setPdfLayout(viewer, viewer.layoutMode, false);
    if (remembered && Number.isFinite(Number(remembered.rotation))) pdfViewer.pagesRotation = Number(remembered.rotation);
    if (viewer.fitMode === 'page') pdfViewer.currentScaleValue = 'page-fit';
    else if (viewer.fitMode === 'width') pdfViewer.currentScaleValue = 'page-width';
    else pdfViewer.currentScale = clampZoom(Number(remembered && remembered.scale) || 1);
    viewer.scale = pdfViewer.currentScale; viewer.baseScale = viewer.scale;
    setPdfHandMode(viewer, !!(remembered && remembered.handMode)); updateZoomUI(viewer);
    pdfViewer.currentPageNumber = viewer.currentPage; pdfViewer.update(); pdfViewer.forceRendering();
    return pdfViewer;
  }

  /* ---------- 主入口：渲染 PDF 查看器 ---------- */
  async function renderPdfViewer(body, physicalPath, startPage) {
    const oldHost = body.querySelector('.reading-pdf-host');
    if (oldHost) { const v = window.__readingPdfViewer; if (v && v.alive && v.alive()) v.destroy(); }
    body.replaceChildren();
    hidePdfToolbar();
    ensureReadingPanelTabs();
    const host = document.createElement('div'); host.className = 'reading-pdf-host'; host.tabIndex = 0;
    const toolbar = document.createElement('div'); toolbar.className = 'pdf-toolbar';
    const zo = document.createElement('button'); zo.textContent = '−'; zo.title = '缩小（或 ⌘/Ctrl + 滚轮）';
    const zl = document.createElement('span'); zl.className = 'pdf-zoom-pct'; zl.textContent = '100%'; zl.title = '点击输入缩放百分比';
    const range = document.createElement('input'); range.type = 'range'; range.className = 'pdf-zoom-range'; range.min = 20; range.max = 300; range.step = 1; range.value = 100; range.title = '缩放';
    const zi = document.createElement('button'); zi.textContent = '＋'; zi.title = '放大';
    const fitW = document.createElement('button'); fitW.className = 'fit-btn'; fitW.textContent = '宽度'; fitW.title = '适配宽度：页面宽度铺满容器（快捷键 0）';
    const fitP = document.createElement('button'); fitP.className = 'fit-btn'; fitP.textContent = '整页'; fitP.title = '适配页面：整页完整显示（快捷键 1）';
    const actual = document.createElement('button'); actual.className = 'fit-btn'; actual.textContent = '100%'; actual.title = '实际大小';
    const layout = document.createElement('select'); layout.className = 'pdf-layout-select'; layout.title = '页面排版（快捷键 2 切换双页）';
    layout.innerHTML = '<option value="continuous">连续滚动</option><option value="single">单页</option><option value="spread">双页</option><option value="spread-cover">封面双页</option>';
    const handBtn = document.createElement('button'); handBtn.textContent = '✋ 拖动'; handBtn.title = '手型工具：按住页面自由拖动';
    const rotateBtn = document.createElement('button'); rotateBtn.textContent = '↻ 旋转'; rotateBtn.title = '顺时针旋转 90°';
    const pagePill = document.createElement('span'); pagePill.className = 'pdf-page-pill'; pagePill.textContent = '1 / —'; pagePill.title = '当前页 / 总页数；点击跳转';
    const sep = document.createElement('span'); sep.className = 'pdf-toolbar-sep';
    const thumbBtn = document.createElement('button'); thumbBtn.textContent = '▦ 页面'; thumbBtn.title = '页面缩略图导航'; thumbBtn.disabled = true;
    const findBtn = document.createElement('button'); findBtn.textContent = '⌕ 查找'; findBtn.title = '全文查找（⌘/Ctrl + F）'; findBtn.disabled = true;
    const ac = document.createElement('span'); ac.className = 'pdf-anno-count'; ac.textContent = '标注 0';
    const undoBtn = document.createElement('button'); undoBtn.textContent = '↶ 撤回'; undoBtn.title = '撤销上一条标注操作（高亮 / 标记 / AI 重点 / 删除）';
    undoBtn.onclick = () => undoLastAnnotation(viewer);
    const tocBtn = document.createElement('button'); tocBtn.textContent = '☰ 目录'; tocBtn.title = '章节目录（优先 PDF 自带书签，无书签时自动识别章节标题）';
    const focusBtn = document.createElement('button'); focusBtn.textContent = '⛶ 专注'; focusBtn.title = '专注阅读（Esc 退出）';
    const editBtn = document.createElement('button'); editBtn.className = 'pdf-tool-primary'; editBtn.textContent = 'ONLYOFFICE 编辑'; editBtn.title = '使用 ONLYOFFICE PDF Editor 高级编辑并自动保存';
    const badge = document.createElement('span'); badge.className = 'pdf-official-badge'; badge.textContent = 'PDF.js Viewer';
    toolbar.append(zo, zl, range, zi, fitW, fitP, actual, layout, editBtn, handBtn, rotateBtn, pagePill, sep, thumbBtn, findBtn, tocBtn, undoBtn, ac, focusBtn, badge);
    tocBtn.onclick = () => togglePdfOutline(viewer);
    const findBar = document.createElement('div'); findBar.className = 'pdf-find-bar'; findBar.hidden = true;
    const findInput = document.createElement('input'); findInput.type = 'search'; findInput.placeholder = '查找正文、术语、公式说明…'; findInput.setAttribute('aria-label', '在 PDF 中查找');
    const findStatus = document.createElement('span'); findStatus.className = 'pdf-find-status'; findStatus.textContent = '输入关键词';
    const findPrev = document.createElement('button'); findPrev.textContent = '↑'; findPrev.title = '上一个匹配（Shift + Enter）'; findPrev.disabled = true;
    const findNext = document.createElement('button'); findNext.textContent = '↓'; findNext.title = '下一个匹配（Enter）'; findNext.disabled = true;
    const findClose = document.createElement('button'); findClose.textContent = '×'; findClose.title = '关闭查找（Esc）';
    findBar.append(findInput, findStatus, findPrev, findNext, findClose);
    const stage = document.createElement('div'); stage.className = 'pdf-reader-stage';
    const scroll = document.createElement('div'); scroll.className = 'pdf-scroll pdfjs-viewer-container';
    const officialRoot = document.createElement('div'); officialRoot.className = 'pdfViewer'; scroll.appendChild(officialRoot); stage.appendChild(scroll);
    host.append(toolbar, findBar, stage);
    body.appendChild(host);
    const slot = Number((body.closest('.reading-col') || {}).dataset && body.closest('.reading-col').dataset.slot);
    let onWinResize = null;
    const viewer = {
      _alive: true, path: physicalPath, host, scroll, slotEls: readingSlotElements(slot),
      scale: 1.25, baseScale: 1.25, pages: [], numPages: 0,
      currentPage: Math.max(1, Number(startPage) || 1),
      ann: { annotations: [], summary: null }, pdf: null,
      fitMode: 'width', layoutMode:'continuous', handMode:false, _pageW: 600, _pageH: 800, _previewF: 1, _pendingZoom: null, _zoomTimer: null,
      _zoomPct: zl, _zoomRange: range, _fitWBtn: fitW, _fitPBtn: fitP, _pagePill: pagePill, _findBtn: findBtn, _focusBtn: focusBtn,
      _undoBtn: undoBtn, _tocBtn: tocBtn, _thumbBtn: thumbBtn, _layoutSelect:layout, _handBtn:handBtn, _editBtn:editBtn, _thumbPanel: null, _tocPanel: null, _tocCache: null, _undoStack: [], _findIndex: null, _findIndexPromise: null,
      alive() { return this._alive; },
      goToPage(n) {
        if (!this._alive) return;
        const maxPage = Math.max(1, Number(this.numPages) || 1);
        const target = Math.max(1, Math.min(maxPage, Number(n) || 1));
        const scrollToTarget = (attempt) => {
          if (!this._alive || this.currentPage !== target) return;
          if (this.pdfViewer) { this.pdfViewer.currentPageNumber = target; this.pdfViewer.update(); this.pdfViewer.forceRendering(); return; }
          const rec = this.pages.find((p) => p.pageNum === target);
          if (rec) this.scroll.scrollTop = rec.wrap.offsetTop - 8;
          else if (attempt < 30) setTimeout(() => scrollToTarget(attempt + 1), 80);
        };
        this.currentPage = target;
        updatePageDisplay(this);
        scrollToTarget(0);
      },
      refreshAnnotations() {
        this.pages.forEach((p) => renderPdfOverlay(this, p.pageNum));
        updatePdfAnnoCount(this);
        window.renderReadingAnnotationsList && renderReadingAnnotationsList();
      },
      destroy() {
        this._alive = false;
        if (window.__readingPdfViewer === this) window.__readingPdfViewer = null;
        this.scroll.onmouseup = null;
        clearTimeout(this._zoomTimer);
        clearTimeout(this._find && this._find.timer);
        if (this._thumbObserver) { this._thumbObserver.disconnect(); this._thumbObserver = null; }
        if (this._onlyOfficeEditor && typeof this._onlyOfficeEditor.destroyEditor === 'function') { try { this._onlyOfficeEditor.destroyEditor(); } catch (_) {} }
        this._onlyOfficeEditor = null; this._onlyOfficeOverlay = null;
        if (this.pdfViewer) { try { this.pdfViewer.setDocument(null); } catch (_) {} this.pdfViewer = null; }
        if (this.pdf && typeof this.pdf.destroy === 'function') { try { this.pdf.destroy(); } catch (_) {} this.pdf = null; }
        if (this._keyHandler) this.host.removeEventListener('keydown', this._keyHandler);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this.host.classList.contains('pdf-reader-focus')) document.body.classList.remove('pdf-reader-focus');
        if (typeof onWinResize === 'function') window.removeEventListener('resize', onWinResize);
      },
    };
    viewer._find = { open: false, bar: findBar, input: findInput, status: findStatus, prev: findPrev, next: findNext, button: findBtn, query: '', results: [], resultPages: new Set(), current: -1, request: 0, timer: null };
    thumbBtn.onclick = () => togglePdfThumbnails(viewer);
    findBtn.onclick = () => viewer._find.open ? closePdfFind(viewer, true) : openPdfFind(viewer);
    findClose.onclick = () => closePdfFind(viewer, true);
    findPrev.onclick = () => showPdfFindResult(viewer, viewer._find.current - 1);
    findNext.onclick = () => showPdfFindResult(viewer, viewer._find.current + 1);
    findInput.oninput = () => {
      clearTimeout(viewer._find.timer);
      viewer._find.timer = setTimeout(() => runPdfFind(viewer, findInput.value, viewer.currentPage), 180);
    };
    findInput.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); showPdfFindResult(viewer, viewer._find.current + (e.shiftKey ? -1 : 1)); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePdfFind(viewer, true); }
    };
    focusBtn.onclick = () => togglePdfFocus(viewer);
    actual.onclick = () => { viewer.fitMode = null; if (viewer.pdfViewer) { viewer.pdfViewer.currentScale = 1; viewer.scale = viewer.pdfViewer.currentScale; updateZoomUI(viewer); savePdfViewState(viewer); } else quickZoom(viewer, 1); };
    layout.onchange = () => setPdfLayout(viewer, layout.value);
    handBtn.onclick = () => { setPdfHandMode(viewer, !viewer.handMode); savePdfViewState(viewer); };
    rotateBtn.onclick = () => { if (!viewer.pdfViewer) return; viewer.pdfViewer.pagesRotation = (viewer.pdfViewer.pagesRotation + 90) % 360; savePdfViewState(viewer); };
    editBtn.onclick = () => openReadingPdfInOnlyOffice(viewer);
    pagePill.onclick = async () => {
      const value = await askText({ title:'跳转到页码', message:'跳转到页码（1–' + (viewer.numPages || 1) + '）', value:String(viewer.currentPage), okLabel:'跳转' });
      if (value !== null) viewer.goToPage(value);
    };
    host.addEventListener('pointerdown', (e) => { if (!e.target.closest('input,textarea,select,button')) host.focus({ preventScroll: true }); });
    bindPdfReaderKeys(viewer);
    bindPdfHandPan(viewer);
    window.__readingPdfViewer = viewer;
    try {
      const pdfjs = await loadPdfJs();
      const pdf = await pdfjs.getDocument('/api/readings/file?path=' + encodeURIComponent(physicalPath) + '&revision=' + Date.now()).promise;
      viewer.pdf = pdf; viewer.numPages = pdf.numPages;
      const page1 = await pdf.getPage(1);
      const vp1 = page1.getViewport({ scale: 1 });
      viewer._pageW = vp1.width; viewer._pageH = vp1.height;
      const remembered = loadPdfViewState(physicalPath);
      const rememberedMode = remembered && (remembered.fitMode === 'width' || remembered.fitMode === 'page' || remembered.fitMode === null) ? remembered.fitMode : 'width';
      viewer.fitMode = rememberedMode;
      findBtn.disabled = false; thumbBtn.disabled = false;
      viewer.ann = await loadAnnotations(physicalPath);
      await mountOfficialPdfViewer(viewer, pdf, officialRoot, remembered);
      updatePdfAnnoCount(viewer);
      const els = viewer.slotEls;
      if (els) {
        els.page.max = pdf.numPages;
        els.page.onchange = () => viewer.goToPage(els.page.value);
        els.col.querySelector('.reading-prev').onclick = () => viewer.goToPage(Number(els.page.value || 1) - 1);
        els.col.querySelector('.reading-next').onclick = () => viewer.goToPage(Number(els.page.value || 1) + 1);
        viewer.goToPage(viewer.currentPage);
      }
      scroll.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const steps = Math.max(1, Math.round(Math.abs(e.deltaY) / 60));
        const s2 = viewer.scale * Math.pow(1.12, (e.deltaY < 0 ? 1 : -1) * steps);
        viewer.fitMode = null;
        previewPdfZoomAt(viewer, s2, e.clientX, e.clientY, {});
      }, { passive: false });
      scroll.addEventListener('dblclick', (e) => {
        if (!viewer._alive) return;
        if (e.target.closest('.pdf-toolbar') || e.target.closest('.pdf-sel-toolbar') || e.target.closest('.pdf-anno-pop')) return;
        if (e.target.closest('.pdf-text-layer span')) { quickZoom(viewer, viewer.scale * 1.5); return; }
        fitPdfMode(viewer, viewer.fitMode === 'page' ? 'width' : 'page');
      });
      let scrollTimer = null;
      scroll.addEventListener('scroll', () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          const p = currentVisiblePage(viewer);
          if (p && p !== viewer.currentPage) { viewer.currentPage = p; updatePageDisplay(viewer); }
        }, 130);
      });
      let winResizeTimer = null;
      onWinResize = () => {
        clearTimeout(winResizeTimer);
        winResizeTimer = setTimeout(() => {
          if (viewer._alive && viewer.fitMode) fitPdfMode(viewer, viewer.fitMode);
        }, 350);
      };
      window.addEventListener('resize', onWinResize);
      if (typeof ResizeObserver !== 'undefined') {
        let lastWidth = host.clientWidth, lastHeight = host.clientHeight;
        viewer._resizeObserver = new ResizeObserver(() => {
          const width = host.clientWidth, height = host.clientHeight;
          if (!viewer._alive || !viewer.fitMode || (Math.abs(width - lastWidth) < 3 && Math.abs(height - lastHeight) < 3)) return;
          lastWidth = width; lastHeight = height;
          clearTimeout(winResizeTimer);
          winResizeTimer = setTimeout(() => { if (viewer._alive && viewer.fitMode) fitPdfMode(viewer, viewer.fitMode); }, 120);
        });
        viewer._resizeObserver.observe(host);
      }
      zo.onclick = () => quickZoom(viewer, viewer.scale / 1.15);
      zi.onclick = () => quickZoom(viewer, viewer.scale * 1.15);
      zl.onclick = async () => {
        const v = await askText({ title:'缩放比例', message:'输入缩放百分比（20–300）', value:String(Math.round(viewer.scale * 100)), okLabel:'应用' });
        if (v === null) return;
        const val = Number(v); if (!isFinite(val)) return;
        const rect = viewer.scroll.getBoundingClientRect();
        previewPdfZoomAt(viewer, clampZoom(val / 100), rect.left + 12, rect.top + viewer.scroll.clientHeight / 2, {});
      };
      range.oninput = () => {
        viewer.fitMode = null;
        const rect = viewer.scroll.getBoundingClientRect();
        previewPdfZoomAt(viewer, Number(range.value) / 100, rect.left + 12, rect.top + viewer.scroll.clientHeight / 2, {});
      };
      range.onchange = () => commitPdfZoom(viewer);
      fitW.onclick = () => fitPdfMode(viewer, 'width');
      fitP.onclick = () => fitPdfMode(viewer, 'page');
      window.renderReadingAnnotationsList && renderReadingAnnotationsList();
      return viewer;
    } catch (err) {
      viewer.destroy();
      const iframe = document.createElement('iframe');
      iframe.className = 'reading-pdf-fallback';
      iframe.src = '/api/readings/file?path=' + encodeURIComponent(physicalPath) + '#page=' + viewer.currentPage + '&zoom=page-width';
      body.appendChild(iframe);
      return null;
    }
  }

  /* ---------- 摘录面板 tab：摘录 / 标注 / 摘要 ---------- */
  let _chatRenderedKey = null;          // 当前已在 #chat-msgs 中渲染的 PDF 标识
  function readingChatKey(path) { return 'mc-reading-chat:' + path; }
  function loadReadingChat(path) {
    try { const raw = localStorage.getItem(readingChatKey(path)); const d = raw ? JSON.parse(raw) : null; return (d && Array.isArray(d.messages)) ? d.messages : []; }
    catch (_) { return []; }
  }
  function saveReadingChat(path, messages) {
    try { const list = Array.isArray(messages) ? messages.slice(-100) : []; localStorage.setItem(readingChatKey(path), JSON.stringify({ messages: list, updatedAt: Date.now() })); } catch (_) {}
  }
  function chatClearMsgs() {
    const msgs = document.getElementById('chat-msgs'); if (!msgs) return;
    const hint = msgs.querySelector('#chat-sel-hint');
    msgs.replaceChildren(); if (hint) msgs.appendChild(hint);
    _chatRenderedKey = null;
  }
  function ensureChatRestored() {
    const v = window.__readingPdfViewer;
    const msgs = document.getElementById('chat-msgs');
    if (!v || !v.path || !msgs) return;
    if (_chatRenderedKey === v.path && msgs.children.length > 1) return;
    _chatRenderedKey = v.path;
    const hint = msgs.querySelector('#chat-sel-hint');
    msgs.replaceChildren(); if (hint) msgs.appendChild(hint);
    loadReadingChat(v.path).forEach((m) => {
      const d = document.createElement('div'); d.className = 'chat-msg ' + (m.role === 'user' ? 'user' : 'ai');
      const b = document.createElement('div'); b.className = 'chat-bubble';
      b.innerHTML = chatRender(m.content || '');
      d.appendChild(b); msgs.appendChild(d);
    });
    msgs.scrollTop = msgs.scrollHeight;
  }
  function ensureReadingPanelTabs() {
    const head = document.querySelector('#reading-fragments .reading-frag-head');
    if (!head || head.querySelector('.rf-tabs')) return;
    const tabs = document.createElement('div'); tabs.className = 'rf-tabs';
    const mk = (label, id) => { const b = document.createElement('button'); b.textContent = label; b.id = 'rf-tab-' + id; b.onclick = () => setReadingPanelTab(id); tabs.appendChild(b); return b; };
    mk('摘录', 'frag'); mk('标注', 'anno'); mk('AI 对话', 'chat');
    head.insertBefore(tabs, head.querySelector('.sp'));
    const fragList = document.getElementById('reading-frag-list');
    const annoList = document.createElement('div'); annoList.id = 'reading-anno-list'; annoList.className = 'rf-pane'; annoList.style.display = 'none';
    const chatBox = document.createElement('div'); chatBox.id = 'reading-chat-box'; chatBox.className = 'rf-pane'; chatBox.style.display = 'none';
    const actions = document.createElement('div'); actions.className = 'chat-actions';
    const bSum = document.createElement('button'); bSum.className = 'c-quick'; bSum.dataset.act = 'sum'; bSum.textContent = '📌 总结论文';
    const bPt = document.createElement('button'); bPt.className = 'c-quick'; bPt.dataset.act = 'points'; bPt.textContent = '🎯 提取重点并高亮';
    const bClear = document.createElement('button'); bClear.textContent = '🗑'; bClear.title = '清空该论文的 AI 对话记录'; bClear.className = 'c-clear';
    bClear.onclick = async () => {
      if (!await askConfirm({ title:'清空论文对话', message:'清空该论文的 AI 对话记录？（不可恢复）', okLabel:'清空' })) return;
      const vv = window.__readingPdfViewer;
      if (vv && vv.path) { try { localStorage.removeItem(readingChatKey(vv.path)); } catch (_) {} }
      chatClearMsgs();
    };
    actions.append(bSum, bPt, bClear);
    const msgs = document.createElement('div'); msgs.id = 'chat-msgs';
    const hint = document.createElement('div'); hint.id = 'chat-sel-hint'; hint.className = 'chat-hint';
    hint.textContent = '在 PDF 上划选文字，点浮出工具条上的“问 AI”即可针对该段提问；输入框可随时直接提问。';
    msgs.appendChild(hint);
    const irow = document.createElement('div'); irow.className = 'chat-input-row';
    const inp = document.createElement('textarea'); inp.id = 'chat-input'; inp.placeholder = '针对这篇论文提问 · 回车发送 · 划选文字可点“问 AI”';
    const send = document.createElement('button'); send.id = 'chat-send'; send.className = 'primary'; send.textContent = '发送';
    irow.append(inp, send);
    chatBox.append(actions, msgs, irow);
    fragList.insertAdjacentElement('afterend', annoList);
    annoList.insertAdjacentElement('afterend', chatBox);
    const st = document.createElement('style');
    st.textContent = '#reading-fragments .rf-tabs{display:flex;gap:4px;margin-right:6px}.rf-tabs button{padding:1px 8px;border:1px solid var(--border);border-radius:5px;background:var(--panel);color:var(--dim);font-size:10px;cursor:pointer}.rf-tabs button.on{color:#cfe0ff;border-color:var(--accent);background:rgba(79,140,255,.15)}#reading-anno-list{overflow:auto;max-height:100%;padding-bottom:8px}#reading-anno-list .rf-anno{position:relative;display:flex;flex-direction:column;gap:4px;margin:6px 8px;padding:7px 10px 7px 12px;border:1px solid var(--border);border-left:3px solid var(--ac,#8ab4ff);border-radius:8px;background:var(--panel);cursor:pointer;transition:border-color .15s,background .15s,transform .1s}#reading-anno-list .rf-anno:hover{border-color:var(--ac,#8ab4ff);background:var(--panel2);transform:translateY(-1px)}#reading-anno-list .rf-anno .a-h{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10px;color:var(--dim)}#reading-anno-list .rf-anno .a-pg{flex:none;padding:1px 6px;border-radius:4px;background:rgba(79,140,255,.13);color:#b9d0ff;font-weight:600}#reading-anno-list .rf-anno .a-tm{font-size:9.5px;color:var(--dim);flex:none}#reading-anno-list .rf-anno .a-t{font-size:11.5px;line-height:1.55;color:var(--text);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;white-space:pre-wrap}#reading-anno-list .rf-anno .a-t.empty{color:var(--muted);font-style:italic}#reading-anno-list .rf-anno .a-n{margin-top:2px;padding:4px 7px;border-radius:5px;background:rgba(127,127,127,.09);font-size:10.5px;line-height:1.6;color:var(--text);overflow-wrap:anywhere;border-top:1px dashed rgba(127,127,127,.2)}#reading-anno-list .rf-anno .a-n p{margin:2px 0}#reading-anno-list .rf-anno .a-n h1,#reading-anno-list .rf-anno .a-n h2,#reading-anno-list .rf-anno .a-n h3,#reading-anno-list .rf-anno .a-n h4,#reading-anno-list .rf-anno .a-n h5{font-size:11px;margin:3px 0 2px}#reading-anno-list .rf-anno .a-n ul,#reading-anno-list .rf-anno .a-n ol{margin:2px 0;padding-left:16px}#reading-anno-list .rf-anno .a-n code{background:rgba(127,127,127,.16);padding:0 3px;border-radius:3px;font:9.5px var(--mono)}#reading-chat-box{display:flex;flex-direction:column;overflow:hidden;height:100%}.chat-actions{display:flex;gap:5px;padding:6px 7px;border-bottom:1px solid var(--border);flex:none}.chat-actions button{padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel2);color:var(--text);font-size:10px;cursor:pointer}.chat-actions button:hover{border-color:var(--accent);color:#cfe0ff}#chat-msgs{flex:1;overflow-y:auto;padding:7px;display:flex;flex-direction:column;gap:6px}.chat-msg{display:flex}.chat-msg.user{justify-content:flex-end}.chat-bubble{max-width:94%;padding:5px 8px;border-radius:8px;font-size:10.5px;line-height:1.65;white-space:normal;overflow-wrap:anywhere;background:var(--panel2);color:var(--text);border:1px solid var(--border)}.chat-msg.user .chat-bubble{background:rgba(79,140,255,.16);border-color:var(--accent)}.chat-bubble .c-h2{font-weight:700;color:var(--accent);margin:4px 0 1px}.chat-bubble .c-b{font-weight:700;margin:4px 0 1px}.chat-bubble .c-li{margin:1px 0}.chat-input-row{display:flex;gap:5px;padding:6px 7px;border-top:1px solid var(--border);flex:none;align-items:center}#chat-input{flex:1;min-height:32px;max-height:90px;resize:vertical;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:10.5px;font-family:inherit}#chat-input:disabled{opacity:.55}#chat-send{padding:4px 9px;border:1px solid var(--border);border-radius:6px;background:var(--panel2);color:var(--text);font-size:10px;cursor:pointer;flex:none}#chat-send.primary{border-color:var(--accent);color:#cfe0ff;background:rgba(79,140,255,.15)}#chat-send:disabled{opacity:.55;cursor:default}.chat-hint{color:var(--dim);font-size:9.5px;padding:5px 7px;text-align:center}';
    document.head.appendChild(st);
  }
  function setReadingPanelTab(id) {
    ensureReadingPanelTabs();
    const fragList = document.getElementById('reading-frag-list');
    const annoList = document.getElementById('reading-anno-list');
    const chatBox = document.getElementById('reading-chat-box');
    if (fragList) fragList.style.display = id === 'frag' ? '' : 'none';
    if (annoList) annoList.style.display = id === 'anno' ? '' : 'none';
    if (chatBox) chatBox.style.display = id === 'chat' ? '' : 'none';
    ['frag', 'anno', 'chat'].forEach((x) => { const b = document.getElementById('rf-tab-' + x); if (b) b.classList.toggle('on', x === id); });
    if (id === 'anno') window.renderReadingAnnotationsList && renderReadingAnnotationsList();
    if (id === 'chat') { initReadingChatPanel(); ensureChatRestored(); }
  }
  function renderReadingAnnotationsList() {
    const box = document.getElementById('reading-anno-list'); if (!box) return;
    const v = window.__readingPdfViewer;
    const anns = (v && v.ann && v.ann.annotations) || [];
    box.replaceChildren();
    const count = document.createElement('div');
    count.style.cssText = 'padding:6px 8px;color:var(--dim);font-size:10px';
    count.textContent = '共 ' + anns.length + ' 条标注 · 在 PDF 页面上划选文字即可高亮/标记';
    box.appendChild(count);
    [...anns].sort((a, b) => (a.page - b.page) || (a.createdAt - b.createdAt)).forEach((a) => {
      const card = document.createElement('div'); card.className = 'rf-anno'; card.style.setProperty('--ac', a.color || '#8ab4ff');
      const head = document.createElement('div'); head.className = 'a-h';
      const pg = document.createElement('span'); pg.className = 'a-pg'; pg.textContent = 'P.' + a.page + ' · ' + (a.type === 'mark' ? '标记' : '高亮');
      const tm = document.createElement('span'); tm.className = 'a-tm';
      const d = new Date(a.createdAt || Date.now());
      tm.textContent = (d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      head.append(pg, tm);
      const t = document.createElement('div'); t.className = 'a-t' + (a.text ? '' : ' empty'); t.textContent = a.text || '(无文字)'; t.title = a.text || '';
      card.append(head, t);
      if (a.note) { const n = document.createElement('div'); n.className = 'a-n'; n.innerHTML = renderMd(a.note) || ''; card.appendChild(n); }
      card.onclick = () => { const v2 = window.__readingPdfViewer; if (v2 && v2.alive && v2.alive()) v2.goToPage(a.page); };
      box.appendChild(card);
    });
  }
  /* ---------- 基于当前论文的 AI 对话（提问 / 选中咨询 / 总结 / 提取重点并高亮） ---------- */
  const CHAT_STOPWORDS = new Set(['the','a','an','and','of','to','in','for','on','with','is','are','was','were','this','that','how','what','why','请','帮我','一下','请问','论文','pdf','问题','什么','怎么','如何','可以','不能','的','了','是','在','和','与','吗','呢','吧','啊','这篇','这篇论文']);
  let _chatInited = false;
  function initReadingChatPanel() {
    if (_chatInited) return; _chatInited = true;
    const box = document.getElementById('reading-chat-box'); if (!box) return;
    box.addEventListener('click', (e) => {
      const q = e.target.closest('.c-quick');
      if (q) { if (q.dataset.act === 'sum') readingChatSummary(); else if (q.dataset.act === 'points') readingChatExtractPoints(); }
    });
    const send = document.getElementById('chat-send');
    if (send) send.onclick = () => sendReadingChat();
    const inp = document.getElementById('chat-input');
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReadingChat(); } });
  }
  function chatRender(text) {
    const esc = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
      .replace(/^### (.*)$/gm, '<div class="c-h3">$1</div>')
      .replace(/^## (.*)$/gm, '<div class="c-h2">$1</div>')
      .replace(/^\*\*(.+?)\*\*$/gm, '<div class="c-b">$1</div>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^[-*] (.*)$/gm, '<div class="c-li">• $1</div>')
      .replace(/\n/g, '<br>');
  }
  function chatPushMsg(role, text) {
    const msgs = document.getElementById('chat-msgs'); if (!msgs) return;
    ensureChatRestored();
    const d = document.createElement('div'); d.className = 'chat-msg ' + role;
    const b = document.createElement('div'); b.className = 'chat-bubble';
    b.innerHTML = chatRender(text);
    d.appendChild(b);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    const v = window.__readingPdfViewer;
    if (v && v.path && text && !text.startsWith('⚠️')) {
      const entry = { role: role === 'user' ? 'user' : 'assistant', content: text, at: Date.now() };
      v._chatHistory = [...(v._chatHistory || []), entry];
      saveReadingChat(v.path, v._chatHistory);
    }
  }
  function chatSetBusy(busy) {
    const send = document.getElementById('chat-send');
    if (send) { send.disabled = busy; send.textContent = busy ? '…' : '发送'; }
    const inp = document.getElementById('chat-input');
    if (inp) inp.disabled = busy;
  }
  function extractJson(text) {
    text = String(text || '').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (_) {
      try { return JSON.parse(m[0].replace(/,\s*}/g, '}')); } catch (_2) { return null; }
    }
  }
  async function readingChatCtx() {
    const v = window.__readingPdfViewer;
    if (!v || !v.alive()) return null;
    if (v._chatCtx && v._chatCtx.path === v.path) return v._chatCtx;
    const textRes = await api('/api/readings/text?path=' + encodeURIComponent(v.path));
    if (!textRes.ok || !textRes.pages) return null;
    const pages = textRes.pages;
    const chunks = [];
    let cur = '', curPage = 1;
    for (let i = 0; i < pages.length; i++) {
      cur += pages[i] + '\n';
      curPage = i + 1;
      while (cur.length >= 2400) { chunks.push({ text: cur.slice(0, 2400), page: curPage }); cur = cur.slice(2400); }
    }
    if (cur.trim()) chunks.push({ text: cur, page: curPage });
    v._chatCtx = { path: v.path, pages, full: pages.join('\n'), chunks };
    return v._chatCtx;
  }
  function chatRank(query, chunkText) {
    const words = (String(query).toLowerCase().match(/[a-z]{3,}|\p{Script=Han}{1,3}/gu) || []).filter(w => !CHAT_STOPWORDS.has(w));
    const t = chunkText.toLowerCase();
    let score = 0;
    for (const w of words) { const n = t.split(w).length - 1; if (n > 0) score += 1 + n; }
    return score;
  }
  function pickChatContext(query, ctx, selText) {
    const ranked = ctx.chunks.map((c, i) => ({ c, i, s: chatRank(query, c.text) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    const picked = ranked.slice(0, 3);
    const lines = [];
    for (const p of picked) lines.push('【第 ' + p.c.page + ' 页附近】\n' + p.c.text.trim());
    if (selText) {
      lines.push('【用户选中的原文】\n' + selText);
      const i2 = ctx.chunks.findIndex(c => c.text.includes(selText.slice(0, 60)));
      if (i2 >= 0) lines.push('【选中内容的上下文】\n' + ctx.chunks[Math.max(0, i2 - 1)].text.trim().slice(-1300));
    }
    if (!lines.length) lines.push('【论文开头】\n' + ctx.chunks[0].text.trim().slice(0, 1600));
    return lines.join('\n\n').slice(0, 13000);
  }
  async function sendReadingChat(forcedText) {
    const v = window.__readingPdfViewer;
    if (!v || !v.alive()) { readingStatus('请先打开 PDF', true); return; }
    if (v._chatBusy) return;
    const inp = document.getElementById('chat-input');
    const text = (forcedText !== undefined ? forcedText : inp ? inp.value : '').trim();
    if (!text) return;
    if (inp) inp.value = '';
    chatPushMsg('user', text);
    v._chatBusy = true; chatSetBusy(true);
    try {
      const cfg = aiCfg();
      if (!cfg.url || !cfg.model) throw new Error('请先在右侧 AI 助手设置 API URL 与模型');
      const ctx = await readingChatCtx();
      if (!ctx) throw new Error('无法提取论文文本（扫描版不支持对话）');
      const ctxText = pickChatContext(text, ctx, '');
      const histFull = (v._chatHistory) || [];
      const history = (histFull.length && histFull[histFull.length - 1].role === 'user') ? histFull.slice(-6, -1) : histFull.slice(-6);
      const messages = [
        { role: 'system', content: '你是论文阅读助手。基于给出的论文上下文回答。要求：用中文；优先引用原文原句；可标注页码（如 P.3）；不确定就说不确定。' },
        { role: 'user', content: '论文上下文（分块，已标注页码）：\n\n' + ctxText },
      ];
      messages.push(...history);
      messages.push({ role: 'user', content: text });
      readingStatus('AI 思考中…');
      const r = await api('/api/ai/chat', { url: cfg.url, key: cfg.key, model: cfg.model, timeoutMs: 300000, messages });
      if (!r.ok) throw new Error(r.error || 'AI 响应失败');
      chatPushMsg('ai', r.content.trim());
      readingStatus('AI 已回复');
    } catch (error) {
      chatPushMsg('ai', '⚠️ ' + (error && error.message || error));
      readingStatus('对话失败：' + (error && error.message || error), true);
    } finally { v._chatBusy = false; chatSetBusy(false); }
  }
  async function readingChatSummary() {
    const v = window.__readingPdfViewer;
    if (!v || !v.alive()) return;
    if (v._chatBusy) return;
    chatPushMsg('user', '📌 请总结这篇论文（结构化：一句话概括 / 研究目标 / 方法 / 主要结果 / 创新点 / 可借鉴之处）');
    v._chatBusy = true; chatSetBusy(true);
    try {
      const cfg = aiCfg(); if (!cfg.url || !cfg.model) throw new Error('请先在右侧 AI 助手设置 AI 配置');
      const textRes = await api('/api/readings/text?path=' + encodeURIComponent(v.path));
      if (!textRes.ok) throw new Error(textRes.error || '无法提取 PDF 文本');
      const full = (textRes.pages || []).join('\n\n');
      if (!full.trim()) throw new Error('该 PDF 无可选文字（可能是扫描版）');
      const chunks = [];
      let rest = full.trim();
      while (rest) { let at = Math.min(5000, rest.length); if (at < rest.length) { const b = Math.max(rest.lastIndexOf('\n', at), rest.lastIndexOf('. ', at)); if (b > 1500) at = b + 1; } chunks.push(rest.slice(0, at)); rest = rest.slice(at).trim(); }
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        readingStatus('AI 总结 ' + (i + 1) + '/' + chunks.length + '…');
        const r = await api('/api/ai/chat', { url: cfg.url, key: cfg.key, model: cfg.model, timeoutMs: 300000, messages: [{ role: 'system', content: '你是科研论文阅读助手。提炼论文片段核心信息，中文要点，不超过 250 字。' }, { role: 'user', content: chunks[i] }] });
        if (!r.ok) throw new Error(r.error || 'AI 总结失败');
        parts.push(r.content.trim());
      }
      readingStatus('正在汇总生成结构化总结…');
      const merged = await api('/api/ai/chat', { url: cfg.url, key: cfg.key, model: cfg.model, timeoutMs: 300000, messages: [{ role: 'system', content: '基于分段摘要生成整篇论文的结构化中文总结，严格用：\n## 📌 一句话概括\n## 🎯 研究目标\n## 🛠 方法\n## 📊 主要结果\n## 💡 创新点\n## 🔗 可借鉴之处\n直接输出。' }, { role: 'user', content: parts.join('\n\n') }] });
      if (!merged.ok) throw new Error(merged.error || '总结汇总失败');
      v.ann.summary = { status: 'done', content: merged.content.trim(), model: cfg.model, updatedAt: Date.now() };
      await saveAnnotations(v.path, v);
      chatPushMsg('ai', merged.content.trim());
      readingStatus('结构化总结已生成并保存');
    } catch (error) {
      chatPushMsg('ai', '⚠️ ' + (error && error.message || error));
    } finally { v._chatBusy = false; chatSetBusy(false); }
  }
  async function readingChatExtractPoints() {
    const v = window.__readingPdfViewer;
    if (!v || !v.alive()) return;
    if (v._chatBusy) return;
    chatPushMsg('user', '🎯 请提取这篇论文的重点（核心方法、关键结果、重要结论），定位原文并自动高亮 + 笔记');
    v._chatBusy = true; chatSetBusy(true);
    try {
      const cfg = aiCfg(); if (!cfg.url || !cfg.model) throw new Error('请先在右侧 AI 助手设置 AI 配置');
      const ctx = await readingChatCtx();
      if (!ctx) throw new Error('无法提取论文文本（扫描版不支持）');
      const picks = [];
      // 剔除参考文献列表节（否则 AI 会把文献条目误当重点），只从正文提取
      let bodyText = (ctx.full || '');
      const refMatch = bodyText.search(/\n\s*(References|REFERENCES)\s*\n|\n\s*References\s*\(?\s*\[\d+\]/);
      if (refMatch > 0) bodyText = bodyText.slice(0, refMatch);
      const big = []; let cur = '';
      for (const seg of bodyText.split(/(?<=\n)/)) { cur += seg; if (cur.length >= 15000) { big.push(cur); cur = ''; } }
      if (cur && cur.trim()) big.push(cur);
      if (!big.length) throw new Error('无法获取可提取的正文文本');
      const runPick = async (txt) => {
        const r = await api('/api/ai/chat', { url: cfg.url, key: cfg.key, model: cfg.model, timeoutMs: 300000, messages: [{ role: 'system', content: '你是论文阅读助手。只从给定论文片段的正文（不含参考文献列表、致谢、页眉页脚、作者单位）中找出最重要的 1-2 个要点（核心方法、关键结果、重要结论）。严格只输出 JSON：{"points":[{"quote":"原文原句（必须逐字取自该片段，不改写、不缩写、不翻译、不省略；若原文有多处相近表述，取最完整的一句）","note":"中文要点说明","color":"yellow|green|blue|pink|orange"}]}。禁止选择参考文献条目、致谢、表格、图注、作者与单位信息。没有重要句子输出 {"points":[]}。' }, { role: 'user', content: txt }] });
        if (!r.ok) throw new Error(r.error || 'AI 提取失败');
        const js = extractJson(r.content);
        const out = [];
        if (js && Array.isArray(js.points)) {
          for (const p of js.points) {
            if (p && p.quote && String(p.quote).trim()) {
              out.push({ quote: repairQuoteAgainstText(String(p.quote).trim(), txt), note: String(p.note || '').trim(), color: ANNO_COLORS[p.color] ? String(p.color) : 'yellow' });
            }
          }
        }
        return out;
      };
      let extracted = 0;
      for (let i = 0; i < big.length; i += 3) {
        const batch = big.slice(i, i + 3);
        const results = await Promise.all(batch.map(async (txt, j) => {
          readingStatus('提取重点 ' + Math.min(i + j + 1, big.length) + '/' + big.length + '…');
          const out = await runPick(txt);
          extracted += out.length;
          readingStatus('提取重点 ' + Math.min(i + j + 1, big.length) + '/' + big.length + '（已得 ' + extracted + ' 条）…');
          return out;
        }));
        for (const rs of results) picks.push(...rs);
      }
      const seen = new Set(); const uniq = [];
      for (const p of picks) { const k = p.quote.slice(0, 50); if (!seen.has(k)) { seen.add(k); uniq.push(p); } }
      if (!uniq.length) { chatPushMsg('ai', '⚠️ AI 未能提取出可定位的重点。可重新点击“提取重点”，或手动划选后“问选中”。'); readingStatus('未提取到重点'); return; }
      pushUndo(v);
      const statuses = [];
      let located = 0;
      const originalPage = v.currentPage;
      for (const p of uniq) {
        const candidatePage = locateQuotePage(ctx.pages, p.quote);
        if (candidatePage) await renderPdfPage(v, candidatePage).catch(() => null);
        const loc = locateQuoteInViewer(v, p.quote);
        if (loc) { createAutoHighlights(v, loc, p); located++; statuses.push(true); }
        else statuses.push(false);
      }
      if (originalPage) v.goToPage(originalPage);
      await saveAnnotations(v.path, v);
      v.pages.forEach(rec => renderPdfOverlay(v, rec.pageNum));
      updatePdfAnnoCount(v);
      window.renderReadingAnnotationsList && renderReadingAnnotationsList();
      const lines = ['🎯 共提取 ' + uniq.length + ' 条重点，成功定位并高亮 ' + located + ' 条：'];
      uniq.forEach((p, i) => { lines.push((i + 1) + '. ' + (p.note || p.quote.slice(0, 70)) + ' ——「' + p.quote.slice(0, 70) + (p.quote.length > 70 ? '…' : '') + '」' + (statuses[i] ? '' : '（未定位原文）')); });
      if (located < uniq.length) lines.push('⚠️ 有 ' + (uniq.length - located) + ' 条未能定位原文，可手动划选后“问选中”高亮。');
      chatPushMsg('ai', lines.join('\n'));
      readingStatus('已高亮 ' + located + ' 条重点');
    } catch (error) {
      chatPushMsg('ai', '⚠️ ' + (error && error.message || error));
      readingStatus('提取失败：' + (error && error.message || error), true);
    } finally { v._chatBusy = false; chatSetBusy(false); }
  }
  function normQuoteText(s) {
    return String(s).replace(/[\u201c\u201d"'“”‘’]/g, ' ').replace(/[—–‐‒-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /* AI 常把原句改写：在给定片段里找与 quote 最相似的完整句，用原文替换，保证能定位 */
  function repairQuoteAgainstText(quote, chunkText) {
    const qn = normQuoteText(quote);
    if (!qn || !chunkText) return qn;
    const qToks = tokenize(qn).toks;
    if (!qToks.length) return qn;
    const qArr = [...new Set(qToks)];
    const sentences = String(chunkText).split(/\n+|(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 8);
    let best = null, bestScore = 0;
    for (const s of sentences) {
      const sToks = [...new Set(tokenize(s).toks)];
      if (!sToks.length) continue;
      const sSet = new Set(sToks);
      let hit = 0;
      for (const t of qArr) if (sSet.has(t)) hit++;
      const denom = new Set([...qArr, ...sToks]).size;
      const score = denom ? hit / denom : 0;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (best && bestScore >= 0.45) return best;
    return qn;
  }
  function tokenize(text) {
    const toks = [], map = [];
    const re = /[A-Za-z0-9]+|[\u4e00-\u9fff]/g;
    let m;
    while ((m = re.exec(text))) { toks.push(m[0].toLowerCase()); map.push({ s: m.index, e: m.index + m[0].length }); }
    return { toks, map };
  }
  function locateQuotePage(pages, quote) {
    const qn = normQuoteText(quote).toLowerCase();
    if (!qn || !Array.isArray(pages)) return 0;
    const qTokens = [...new Set(tokenize(qn).toks.filter((token) => token.length > 1))];
    let bestPage = 0, bestScore = 0;
    for (let index = 0; index < pages.length; index++) {
      const text = normQuoteText(pages[index] || '').toLowerCase();
      if (!text) continue;
      if (text.includes(qn)) return index + 1;
      if (!qTokens.length) continue;
      const pageTokens = new Set(tokenize(text).toks);
      let hits = 0;
      for (const token of qTokens) if (pageTokens.has(token)) hits++;
      const score = hits / qTokens.length;
      if (score > bestScore) { bestScore = score; bestPage = index + 1; }
    }
    return bestScore >= 0.45 ? bestPage : 0;
  }
  function locateQuoteInViewer(v, quote) {
    const qn = normQuoteText(quote);
    const qt = tokenize(qn);
    if (!qt.toks.length) return null;
    for (const rec of v.pages) {
      if (!rec.textLayer || !rec.textLayer.isConnected) continue;
      const spans = [...rec.textLayer.querySelectorAll('span')];
      const joinedN = normQuoteText(spans.map(x => x.textContent || '').join(''));
      if (!joinedN) continue;
      const at = joinedN.indexOf(qn);
      if (at >= 0) return { page: rec.pageNum, spans, start: at, end: at + qn.length };
      // 词序模糊定位：逐个 quote 词在 joinedN 中按位置单调查找，
      // 容忍粘连词（Controlthrough）、标点/空白差异（Li 1 , vs Li1,）
      const jn = joinedN.toLowerCase();
      const seq = [];
      let lastEnd = -1, skip = 0;
      for (let i = 0; i < qt.toks.length; i++) {
        const t = qt.toks[i];
        if (t.length === 1 && i > 0 && qt.toks[i - 1].length === 1) continue; // 连续单字符（编号噪声）跳过
        const from = Math.max(0, (lastEnd >= 0 ? lastEnd - 24 : 0));
        let p = jn.indexOf(t, from);
        if (p < 0 && seq.length) p = jn.indexOf(t, 0);
        if (p < 0) { skip++; if (skip > 3) break; continue; }
        if (seq.length && (p - (seq[seq.length - 1].p + seq[seq.length - 1].len)) > 130) { skip++; if (skip > 3) break; continue; }
        seq.push({ p, len: t.length });
        lastEnd = p + t.length;
      }
      if (seq.length >= Math.max(5, Math.ceil(qt.toks.length * 0.6))) {
        const start = Math.min.apply(null, seq.map(x => x.p));
        const end = Math.max.apply(null, seq.map(x => x.p + x.len));
        if (end - start > 3) return { page: rec.pageNum, spans, start, end };
      }
    }
    return null;
  }
  function createAutoHighlights(v, loc, p) {
    const rec = v.pages.find(x => x.pageNum === loc.page);
    if (!rec) return;
    const hostRect = rec.textLayer.getBoundingClientRect();
    const segs = [];
    let acc = 0;
    for (const sp of loc.spans) {
      const t = (sp.textContent || '').replace(/\s+/g, ' ');
      segs.push({ sp, s: acc, e: acc + t.length }); acc += t.length;
    }
    const rects = [];
    for (const seg of segs) {
      if (seg.e <= loc.start || seg.s >= loc.end) continue;
      const sr = seg.sp.getBoundingClientRect();
      if (sr.width < 1 || sr.height < 1) continue;
      const spanLen = seg.e - seg.s;
      const cutS = Math.max(0, loc.start - seg.s), cutE = Math.min(spanLen, loc.end - seg.s);
      const f0 = spanLen ? cutS / spanLen : 0, f1 = spanLen ? cutE / spanLen : 1;
      const x0 = sr.left + sr.width * f0, x1 = sr.left + sr.width * f1;
      if (x1 - x0 < 1) continue;
      rects.push({ x: x0 - hostRect.left, y: sr.top - hostRect.top, width: x1 - x0, height: sr.height });
    }
    if (!rects.length) return;
    const pageText = (v._chatCtx && v._chatCtx.pages[loc.page - 1]) || '';
    v.ann.annotations.push({
      id: 'a' + Math.random().toString(36).slice(2, 10) + 'x',
      page: loc.page, type: 'highlight', color: ANNO_COLORS[p.color] || '#ffe14d',
      text: (pageText.slice(loc.start, loc.end).replace(/\s+/g, ' ').trim() || p.quote).slice(0, 500),
      rects, note: p.note, scale: pdfAnnotationScale(v,loc.page), createdAt: Date.now(), auto: true,
    });
  }
  function openAIChatPanel() {
    ensureReadingPanelTabs();
    setReadingPanelTab('chat');
    const inp = document.getElementById('chat-input');
    if (inp) setTimeout(() => inp.focus(), 60);
  }

  window.renderPdfViewer = renderPdfViewer;
  window.renderReadingAnnotationsList = renderReadingAnnotationsList;
  window.ensureReadingPanelTabs = ensureReadingPanelTabs;
  window.__readingChatExtractPoints = readingChatExtractPoints;
  window.__openAIChatPanel = openAIChatPanel;
  window.__pdfViewerReady = true;
})();
