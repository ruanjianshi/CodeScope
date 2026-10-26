/* ═══════════════════════════════════════════════════════════════════════════
   无限画布（tldraw）的**源码** —— 编译产物是 assets/vendor/tldraw.bundle.js
   ---------------------------------------------------------------------------
   为什么这份文件要放进仓库 ✗✗：
     原来它一直放在 `/tmp/tldraw-build/` ✓ —— 2026-10-26 被系统清理掉了 ✗，
     仓库里只剩压缩后的 bundle（2.2MB），源码不可还原 ✓。
     所以搬进仓库，和编译产物一起版本化 ✓。

   构建（在 masscode-runner/ 下执行）：
     npm i -D esbuild react react-dom tldraw marked katex
     npx esbuild tools/tldraw-canvas/entry.jsx \
       --bundle --format=iife --outfile=assets/vendor/tldraw.bundle.js \
       --loader:.jsx=jsx --jsx=automatic \
       --define:process.env.NODE_ENV="production" --minify --legal-comments=none
   （CSS 由 tldraw 自动注入，会生成同目录的 .css；见 build.sh）

   与外部代码的契约（assets/canvas/canvas-ext.js 依赖这些全局）：
     window.__tldraw            编辑器实例
     window.__tldrawSnapshot()  当前 store 快照
     window.__tldrawLoad(snap)  载入快照，**返回成败** ✓（上层靠它判断能不能保存）
     window.__csLib             { createShapeId, AssetRecordType, createShapesForAssets, uploadDataUrl }
   ═══════════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Tldraw, BaseBoxShapeUtil, HTMLContainer, T, createShapeId,
  createShapePropsMigrationSequence, DefaultColorStyle, stopEventPropagation,
  useEditor, useIsEditing, loadSnapshot, getSnapshot,
  AssetRecordType, createShapesForAssets,
} from 'tldraw';
import { marked } from 'marked';
import katex from 'katex';

/* ═══════════════════════════════════════════════════════════════════════════
   通用小工具
   ═══════════════════════════════════════════════════════════════════════════ */
const clamp = (v, lo, hi) => Math.min(Math.max(Number(v) || 0, lo), hi);

/* ── 把图片 dataURL 传成文件，返回可直接放进 <img src> 的地址 ──
   ⚠️ 不内联 base64 ✗ —— 一张 2MB 的图塞进 .canvas 会让画布文件胖到没法同步 ✓ */
async function uploadDataUrl(name, dataUrl) {
  const r = await fetch('/api/drawings/asset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, data: dataUrl }),
  }).then((x) => x.json());
  if (!r || !r.ok) throw new Error((r && r.error) || '上传失败');
  return r.url;
}

/* ── 极简 HTML 消毒：marked 的输出走一遍白名单 ──
   ⚠️ 卡片内容是**用户自己写的 markdown** ✓，但仍然不能放过 <script>/on* 属性 ✓
      —— 画布文件可能来自别处（同步、别人发过来的 .canvas）✓ */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'span', 'div', 'sup', 'sub',
]);
const ALLOWED_ATTR = new Set(['href', 'src', 'alt', 'title', 'class', 'colspan', 'rowspan']);

function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const walk = (node) => {
    for (const el of [...node.children]) {
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) { el.replaceWith(...el.childNodes); continue; }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        const bad = !ALLOWED_ATTR.has(name) || /^\s*(javascript|data:text\/html)/i.test(value);
        if (bad) el.removeAttribute(attr.name);
      }
      if (tag === 'a') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noreferrer'); }
      walk(el);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

/* ── 标题取正文第一个 `# 标题`（只维护一份内容 ✓） ── */
function cardTitleOf(md) {
  const m = /^\s{0,3}#\s+(.+)$/m.exec(String(md || ''));
  return m ? m[1].trim() : '未命名卡片';
}

/* ── 正文渲染前把开头那个 `# 标题` 摘掉 ✗ 它已经在彩色标题栏里了 ✓ ── */
function bodyMarkdownOf(md) {
  const text = String(md || '');
  const m = /^\s{0,3}#\s+[^\n]*(?:\n+|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/* ── 公式：只处理**文本节点** ✗ 直接对 HTML 正则替换会把代码块里的 `$` 也当公式 ✓ ── */
function renderMathInHtml(html) {
  if (!html || html.indexOf('$') < 0) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (p && p.closest && p.closest('code, pre, .katex')) return NodeFilter.FILTER_REJECT;
      return n.nodeValue && n.nodeValue.indexOf('$') >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const out = text.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (m, block, inline) => {
      try {
        return katex.renderToString(block != null ? block : inline, {
          displayMode: block != null, throwOnError: false, output: 'html',
        });
      } catch (_) { return m; }
    });
    if (out !== text) {
      const span = document.createElement('span');
      span.innerHTML = out;
      node.parentNode.replaceChild(span, node);
    }
  }
  return tpl.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ① 笔记卡片（card）—— 彩色标题栏 + Markdown 正文（公式 / 代码高亮 / 图片）
   ═══════════════════════════════════════════════════════════════════════════ */
function CardFace({ shape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const { w, h, markdown } = shape.props;
  const color = shape.props.color || 'orange';
  const taRef = useRef(null);
  const innerRef = useRef(null);
  const [draft, setDraft] = useState(markdown);

  const html = useMemo(
    () => renderMathInHtml(sanitizeHtml(marked.parse(bodyMarkdownOf(markdown)))),
    [markdown],
  );
  const title = useMemo(() => cardTitleOf(markdown), [markdown]);

  useEffect(() => {
    if (!isEditing) return;
    setDraft(shape.props.markdown);
    const raf = requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
    return () => cancelAnimationFrame(raf);
  }, [isEditing, shape.id]);

  /* 代码高亮：HTML 换掉之后跑一遍（highlight.min.js 由宿主页以全局方式加载 ✓） */
  useEffect(() => {
    if (isEditing) return;
    const el = innerRef.current;
    if (!el || !window.hljs) return;
    el.querySelectorAll('pre code').forEach((b) => {
      if (b.dataset.hl) return;
      try { window.hljs.highlightElement(b); b.dataset.hl = '1'; } catch (_) {}
    });
  }, [html, isEditing]);

  /* 正文只增不减地自动长高 ✓（量**内层内容** ✗ 不能量 flex:1 的容器） */
  useEffect(() => {
    if (isEditing) return;
    const el = innerRef.current;
    if (!el) return;
    const fit = () => {
      const need = Math.round(el.scrollHeight + 56);   // 32 标题栏 + 24 正文上下 padding
      if (need > h + 2) editor.updateShape({ id: shape.id, type: 'card', props: { h: need } });
    };
    fit();
    const t = setTimeout(fit, 120);                    // 图片/公式加载完再量一次
    return () => clearTimeout(t);
  }, [html, h, isEditing, editor, shape.id]);

  const onEdit = (v) => {
    setDraft(v);
    editor.updateShape({ id: shape.id, type: 'card', props: { markdown: v } });
  };

  /* 标题栏的「插入图片」：选文件 → 传成资源 → 追加到 markdown 末尾 ✓ */
  const insertImage = async (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || ''));
        fr.readAsDataURL(file);
      });
      if (!dataUrl) return;
      try {
        const url = await uploadDataUrl(file.name, dataUrl);
        const md = String(shape.props.markdown || '').replace(/\s+$/, '');
        editor.updateShape({ id: shape.id, type: 'card', props: { markdown: md + '\n\n![](' + url + ')\n' } });
      } catch (_) {}
    };
    input.click();
  };

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div className={'cs-card cs-card--' + color}>
        <div className="cs-card__head">
          <span className="cs-card__title">{title}</span>
          {!isEditing && (
            <button type="button" className="cs-card__act" title="插入图片"
              onPointerDown={stopEventPropagation} onClick={insertImage}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="m5 18 5-5 3.5 3.5L17 13l2 2" />
              </svg>
            </button>
          )}
        </div>
        <div className="cs-card__body">
          {isEditing ? (
            <textarea
              ref={taRef}
              className="cs-card__edit"
              value={draft}
              spellCheck={false}
              onChange={(e) => onEdit(e.target.value)}
              onPointerDown={stopEventPropagation}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') editor.setEditingShape(null); }}
            />
          ) : (
            <div ref={innerRef} className="cs-card__md" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}

class CardShape extends BaseBoxShapeUtil {
  static type = 'card';
  static props = { w: T.number, h: T.number, markdown: T.string, color: DefaultColorStyle };
  static migrations = createShapePropsMigrationSequence({ sequence: [] });
  getDefaultProps() {
    return { w: 300, h: 240, markdown: '# 新卡片\n\n双击开始写。支持 **加粗**、`代码`、列表和图片。', color: 'orange' };
  }
  canResize() { return true; }
  canEdit() { return true; }
  component(shape) { return <CardFace shape={shape} />; }
  indicator(shape) { return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />; }
  getIndicatorPath(shape) {
    const p = new Path2D();
    if (p.roundRect) p.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    else p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
  getAriaDescriptor() { return '笔记卡片'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ② 网页卡片（webcard）—— iframe 里嵌网页；不编辑时不吃鼠标（让卡片能拖）✓
   ═══════════════════════════════════════════════════════════════════════════ */
function WebFace({ shape }) {
  const { w, h, url, title } = shape.props;
  const isEditing = useIsEditing(shape.id);
  const host = useMemo(() => {
    try { return new URL(url).host; } catch (_) { return url || '未设置网址'; }
  }, [url]);
  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div className="cs-web">
        <div className="cs-web__bar">
          <svg className="cs-web__ico" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" />
          </svg>
          <span className="cs-web__host" title={url}>{title || host}</span>
          <a className="cs-web__btn" href={url || '#'} target="_blank" rel="noreferrer"
            title="在浏览器打开" onPointerDown={stopEventPropagation}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 4h6v6M20 4 10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </div>
        <div className="cs-web__body">
          <iframe className="cs-web__frame" src={url || 'about:blank'} title={title || host}
            style={{ pointerEvents: isEditing ? 'auto' : 'none' }} />
          {!isEditing && <div className="cs-web__mask" />}
        </div>
      </div>
    </HTMLContainer>
  );
}

class WebCardShape extends BaseBoxShapeUtil {
  static type = 'webcard';
  static props = { w: T.number, h: T.number, url: T.string, title: T.string };
  static migrations = createShapePropsMigrationSequence({ sequence: [] });
  getDefaultProps() { return { w: 900, h: 620, url: '', title: '' }; }
  canResize() { return true; }
  canEdit() { return true; }
  component(shape) { return <WebFace shape={shape} />; }
  indicator(shape) { return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />; }
  getIndicatorPath(shape) {
    const p = new Path2D();
    if (p.roundRect) p.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    else p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
  getAriaDescriptor() { return '网页卡片'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ③ 子白板（subboard）—— 双指进入另一页；双击由 canvas-ext 监听 cs-enter-page ✓
   ═══════════════════════════════════════════════════════════════════════════ */
function SubBoardFace({ shape }) {
  const editor = useEditor();
  const { w, h, title, pageId } = shape.props;
  const count = useMemo(() => {
    if (!pageId) return 0;
    try {
      return editor.getPages().find((p) => p.id === pageId)
        ? editor.getSortedChildIdsForParent(pageId).length
        : 0;
    } catch (_) { return 0; }
  }, [editor, pageId]);

  const enter = (e) => {
    e.stopPropagation();
    if (!pageId) return;
    window.dispatchEvent(new CustomEvent('cs-enter-page', { detail: pageId }));
  };

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div className="cs-card cs-card--blue" style={{ borderRadius: 12 }}
        onDoubleClick={enter} title={pageId ? '双击进入这块子白板' : '还没关联页面'}>
        <div className="cs-card__head">
          <span className="cs-card__title">{title || '子白板'}</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>{count ? count + ' 个图形' : '空'}</span>
        </div>
        <div className="cs-card__body" style={{ display: 'grid', placeItems: 'center' }}>
          <div style={{ fontSize: 12, opacity: 0.55, textAlign: 'center', lineHeight: 1.6 }}>
            双击进入<br />在这里放一块独立的画布
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

class SubBoardShape extends BaseBoxShapeUtil {
  static type = 'subboard';
  static props = { w: T.number, h: T.number, title: T.string, pageId: T.string };
  static migrations = createShapePropsMigrationSequence({ sequence: [] });
  getDefaultProps() { return { w: 340, h: 220, title: '子白板', pageId: '' }; }
  canResize() { return true; }
  /* 不设 canEdit ✗ —— 双击留给「进入子白板」✓ */
  canEdit() { return false; }
  component(shape) { return <SubBoardFace shape={shape} />; }
  indicator(shape) { return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />; }
  getIndicatorPath(shape) {
    const p = new Path2D();
    if (p.roundRect) p.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    else p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
  getAriaDescriptor() { return '子白板'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ④ 便签（sticky）—— 真正能自由拖拽大小的便利贴
   ⚠️ 不用 tldraw 自带的 note ✗：它的 props 里**没有 w/h**（只有 size/growY），
      尺寸自动算、`hideResizeHandles()` 恒为 true → 拖不出缩放把手 ✓
   ═══════════════════════════════════════════════════════════════════════════ */
function StickyFace({ shape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const { w, h, text } = shape.props;
  const taRef = useRef(null);
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    if (!isEditing) return;
    setDraft(shape.props.text);
    const raf = requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
    return () => cancelAnimationFrame(raf);
  }, [isEditing, shape.id]);

  const onEdit = (v) => {
    setDraft(v);
    editor.updateShape({ id: shape.id, type: 'sticky', props: { text: v } });
  };

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div className={'cs-sticky cs-sticky--' + (shape.props.color || 'yellow')}>
        {isEditing ? (
          <textarea ref={taRef} className="cs-sticky__edit" value={draft} spellCheck={false}
            onChange={(e) => onEdit(e.target.value)}
            onPointerDown={stopEventPropagation}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') editor.setEditingShape(null); }} />
        ) : (
          <div className="cs-sticky__text">{text}</div>
        )}
      </div>
    </HTMLContainer>
  );
}

class StickyShape extends BaseBoxShapeUtil {
  static type = 'sticky';
  static props = { w: T.number, h: T.number, text: T.string, color: DefaultColorStyle };
  static migrations = createShapePropsMigrationSequence({ sequence: [] });
  getDefaultProps() { return { w: 200, h: 200, text: '', color: 'yellow' }; }
  canResize() { return true; }
  canEdit() { return true; }
  component(shape) { return <StickyFace shape={shape} />; }
  indicator(shape) { return <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />; }
  getIndicatorPath(shape) {
    const p = new Path2D();
    if (p.roundRect) p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    else p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
  getAriaDescriptor() { return '便签'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ⑤ PDF 卡片（pdfcard）—— 一张卡里**连续滚动**所有页（不是一页页翻 ✓）
   ═══════════════════════════════════════════════════════════════════════════ */
function PdfFace({ shape }) {
  const editor = useEditor();
  const { w, h, title, pages, zoom } = shape.props;
  const urls = useMemo(() => String(pages || '').split('\n').filter(Boolean), [pages]);
  const z = clamp(zoom || 1, 0.5, 5);
  const bodyRef = useRef(null);
  const [cur, setCur] = useState(1);

  /* 页码跟着滚动走 ✓ —— 用每页的 offsetTop 判断当前在第几页 */
  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight * 0.35;
    let idx = 1;
    const imgs = el.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) if (imgs[i].offsetTop <= mid) idx = i + 1;
    if (idx !== cur) setCur(idx);
  };

  const setZoom = (v) => editor.updateShape({ id: shape.id, type: 'pdfcard', props: { zoom: clamp(v, 0.5, 5) } });

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div className="cs-pdf">
        <div className="cs-pdf__bar">
          <svg className="cs-pdf__ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5M9 13h6M9 17h4" />
          </svg>
          <span className="cs-pdf__title" title={title}>{title || 'PDF'}</span>
          <span className="cs-pdf__num">{urls.length ? cur + '/' + urls.length : '0/0'}</span>
          <a className="cs-pdf__btn" href={urls[cur - 1] || '#'} target="_blank" rel="noreferrer"
            title="在浏览器打开当前页" onPointerDown={stopEventPropagation}>↗</a>
        </div>
        <div className="cs-pdf__body" ref={bodyRef} onScroll={onScroll}>
          {urls.length ? urls.map((u, i) => (
            <img key={i} className="cs-pdf__page" src={u} alt="" draggable={false}
              loading="lazy" style={{ width: (z * 100) + '%' }} />
          )) : <div className="cs-pdf__empty">没有页面</div>}
        </div>
        <div className="cs-pdf__zoom" onPointerDown={stopEventPropagation}>
          <button type="button" onClick={() => setZoom(z / 1.25)} title="缩小">−</button>
          <button type="button" className="cs-pdf__pct" onClick={() => setZoom(1)} title="回到适应宽度">
            {Math.round(z * 100)}%
          </button>
          <button type="button" onClick={() => setZoom(z * 1.25)} title="放大">+</button>
        </div>
      </div>
    </HTMLContainer>
  );
}

class PdfCardShape extends BaseBoxShapeUtil {
  static type = 'pdfcard';
  static props = { w: T.number, h: T.number, title: T.string, pages: T.string, page: T.number, zoom: T.number };
  static migrations = createShapePropsMigrationSequence({ sequence: [] });
  getDefaultProps() { return { w: 440, h: 620, title: 'PDF', pages: '', page: 0, zoom: 1 }; }
  canResize() { return true; }
  canEdit() { return false; }
  component(shape) { return <PdfFace shape={shape} />; }
  indicator(shape) { return <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />; }
  getIndicatorPath(shape) {
    const p = new Path2D();
    if (p.roundRect) p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    else p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
  getAriaDescriptor() { return 'PDF 卡片'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ⑥ 思维导图节点（mnode）—— 早期版本，父子关系存在 meta.mmParent
   ⚠️ 已被 mindcard（窗口版）取代 ✓ 但旧画布上还有 ✓ 所以保留
   ═══════════════════════════════════════════════════════════════════════════ */
function MNodeFace({ shape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const { w, h, text } = shape.props;
  const taRef = useRef(null);
  const txtRef = useRef(null);
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    if (!isEditing) return;
    setDraft(shape.props.text);
    const raf = requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
    return () => cancelAnimationFrame(raf);
  }, [isEditing, shape.id]);

  /* 宽度跟着文字走（96 ~ 280），高度固定 40 */
  useEffect(() => {
    if (isEditing) return;
    const el = txtRef.current;
    if (!el) return;
    const need = Math.ceil(el.scrollWidth + 30);
    const w2 = clamp(need, 96, 280);
    if (Math.abs(w2 - w) > 2) editor.updateShape({ id: shape.id, type: 'mnode', props: { w: w2 } });
  }, [text, w, isEditing, editor, shape.id]);

  const onEdit = (v) => {
    setDraft(v);
    editor.updateShape({ id: shape.id, type: 'mnode', props: { text: v } });
  };

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div className={'cs-mn cs-mn--' + (shape.props.color || 'black')}>
        {isEditing ? (
          <textarea ref={taRef} className="cs-mn__edit" value={draft} spellCheck={false}
            onChange={(e) => onEdit(e.target.value)}
            onPointerDown={stopEventPropagation}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); editor.setEditingShape(null); }
            }} />
        ) : (
          <span className={'cs-mn__text' + (text ? '' : ' cs-mn__text--ph')} ref={txtRef}>{text || '新主题'}</span>
        )}
      </div>
    </HTMLContainer>
  );
}

class MNodeShape extends BaseBoxShapeUtil {
  static type = 'mnode';
  static props = { w: T.number, h: T.number, text: T.string, color: DefaultColorStyle };
  static migrations = createShapePropsMigrationSequence({ sequence: [] });
  /* ⚠️ 默认文本必须空 ✗ 带默认文字的话进编辑态光标在末尾，打字会**追加** ✓ */
  getDefaultProps() { return { w: 130, h: 40, text: '', color: 'violet' }; }
  canResize() { return true; }
  canEdit() { return true; }
  component(shape) { return <MNodeFace shape={shape} />; }
  indicator(shape) { return <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />; }
  getIndicatorPath(shape) {
    const p = new Path2D();
    if (p.roundRect) p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    else p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
  getAriaDescriptor() { return '思维导图节点'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ⑦ 思维导图窗口（mindcard）—— 卡片里嵌 Mind Elixir（assets/canvas/mind.html）
   · 不编辑：iframe 不吃鼠标 → 卡片能拖能选，图**自动缩放显示全图** ✓
   · 双击进编辑：iframe 可交互，随便加节点/拖节点 ✓
   · 退出编辑：回传数据 + 重新自适应 ✓
   ═══════════════════════════════════════════════════════════════════════════ */
function MindCardFace({ shape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const { w, h, title, data } = shape.props;
  const frameRef = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const post = (msg) => {
    const f = frameRef.current;
    if (!f || !f.contentWindow) return;
    f.contentWindow.postMessage(msg, '*');
  };

  /* ⚠️ 光靠 iframe 发 ready 会**竞态** ✗ —— 它加载完就 post，而监听是 useEffect 里才挂的 ✓
     ⇒ iframe 的 onLoad 里也主动推一次 ✓ */
  const pushData = () => {
    let parsed = null;
    try { parsed = JSON.parse(dataRef.current || 'null'); } catch (_) {}
    post({ type: 'cs-mind-set', data: parsed });
  };

  useEffect(() => {
    const onMsg = (e) => {
      const f = frameRef.current;
      if (!f || e.source !== f.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'cs-mind-ready') { pushData(); return; }
      if (d.type === 'cs-mind-change' && d.data) {
        const text = JSON.stringify(d.data);
        if (text === dataRef.current) return;
        editor.updateShape({ id: shape.id, type: 'mindcard', props: { data: text } });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [shape.id, editor]);

  useEffect(() => { post({ type: 'cs-mind-edit', on: isEditing }); }, [isEditing]);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div className="cs-mindw">
        <div className="cs-mindw__bar">
          <svg className="cs-mindw__ico" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2.6" y="9" width="6.2" height="6" rx="1.6" />
            <circle cx="18" cy="5.4" r="1.9" /><circle cx="18" cy="12" r="1.9" /><circle cx="18" cy="18.6" r="1.9" />
            <path d="M8.8 12h2.7M11.5 12l4.6-6.6M11.5 12h4.6M11.5 12l4.6 6.6" />
          </svg>
          <span className="cs-mindw__title">{title || '思维导图'}</span>
          <button type="button" className="cs-mindw__btn" title="缩放到整张图"
            onPointerDown={stopEventPropagation} onClick={() => post({ type: 'cs-mind-fit' })}>适应</button>
        </div>
        <div className="cs-mindw__body">
          <iframe ref={frameRef} className="cs-mindw__frame" src="/assets/canvas/mind.html" title="思维导图"
            style={{ pointerEvents: isEditing ? 'auto' : 'none' }} onLoad={pushData} />
          {!isEditing && <div className="cs-mindw__hint">双击编辑 · 拖动移动</div>}
        </div>
      </div>
    </HTMLContainer>
  );
}

class MindCardShape extends BaseBoxShapeUtil {
  static type = 'mindcard';
  static props = { w: T.number, h: T.number, title: T.string, data: T.string };
  static migrations = createShapePropsMigrationSequence({ sequence: [] });
  getDefaultProps() { return { w: 620, h: 420, title: '思维导图', data: '' }; }
  canResize() { return true; }
  canEdit() { return true; }
  component(shape) { return <MindCardFace shape={shape} />; }
  indicator(shape) { return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />; }
  getIndicatorPath(shape) {
    const p = new Path2D();
    if (p.roundRect) p.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    else p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
  getAriaDescriptor() { return '思维导图窗口'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   挂载
   ═══════════════════════════════════════════════════════════════════════════ */
function App() {
  return (
    <Tldraw
      shapeUtils={[CardShape, WebCardShape, SubBoardShape, StickyShape, PdfCardShape, MNodeShape, MindCardShape]}
      onMount={(editor) => {
        window.__tldraw = editor;
        window.__csLib = { createShapeId, AssetRecordType, createShapesForAssets, uploadDataUrl };
        window.__tldrawSnapshot = () => getSnapshot(editor.store);
        /* ⚠️ 必须把成败**返回出去** ✗ —— 上层靠它判断"载入成功没有"，
           吞掉异常会让它把"载入失败"当成"载入成功（空画布）"→ 拿空画布覆盖文件 ✓ */
        window.__tldrawLoad = (snap) => {
          try { loadSnapshot(editor.store, snap); return true; }
          catch (e) { console.warn('[canvas] 载入失败', e); return false; }
        };
        /* 深色 + 中文 + 吸附 + 网格
           ⚠️ v5 里 `editor.updateUserPreferences` **不存在** ✗ —— 在 `editor.user` 上 ✓
              写成 editor.updateUserPreferences 会抛错，后面的 updateInstanceState 也跟着被跳过 ✓ */
        try { editor.user.updateUserPreferences({ colorScheme: 'dark', locale: 'zh-cn', isSnapMode: true }); } catch (_) {}
        try { editor.updateInstanceState({ isGridMode: true }); } catch (_) {}
        window.dispatchEvent(new CustomEvent('tldraw-ready'));
      }}
    />
  );
}

createRoot(document.getElementById('tldraw-host')).render(<App />);
