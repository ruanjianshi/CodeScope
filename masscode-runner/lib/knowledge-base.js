'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const KNOWLEDGE_FOLDER = '知识库';
const KNOWLEDGE_PROJECT_META = '.codescope-project.json';
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function safeRelative(value, options = {}) {
  const rel = String(value || '').replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean).join('/');
  if (!rel || rel.startsWith('/') || /(^|\/)\.{1,2}(\/|$)/.test(rel) || /^[A-Za-z]:/.test(rel)) return null;
  if (!/^[A-Za-z0-9._\-\u00a0-\uffff ()\[\],+&/]+$/.test(rel)) return null;
  if (options.extension && !options.extension.has(path.extname(rel).toLowerCase())) return null;
  return rel;
}

function textTitle(file, fallback) {
  try {
    const source = fs.readFileSync(file, 'utf8').slice(0, 64 * 1024);
    const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(source);
    const fromMeta = frontmatter && /^title:\s*["']?(.+?)["']?\s*$/m.exec(frontmatter[1]);
    if (fromMeta) return fromMeta[1].trim();
    const heading = /^#\s+(.+)$/m.exec(source);
    if (heading) return heading[1].replace(/\s+#+\s*$/, '').trim();
  } catch (_) {}
  return fallback;
}

function writeIfMissing(file, content) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function writeManaged(file, content) {
  let current = ''; try { current = fs.readFileSync(file, 'utf8'); } catch (_) {}
  if (current === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function migrateKnowledgeHome(file) {
  if (!fs.existsSync(file)) return writeIfMissing(file, HOME_SOURCE);
  let current = '';
  try { current = fs.readFileSync(file, 'utf8'); } catch (_) { return false; }
  const next = current.replace(/(\blink:\s*)\/快速开始\/知识库使用指南(?=\s|$)/g, '$1/快速开始/使用指南/知识库使用指南');
  if (next === current) return false;
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

function configSource() {
  return `import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modulesRoot = fs.realpathSync(path.resolve(sourceRoot, '.vitepress/node_modules'))
const ignored = new Set(['.vitepress', 'public', 'node_modules'])
function pageTitle(file, fallback) {
  try {
    const source = fs.readFileSync(file, 'utf8').slice(0, 65536)
    const meta = /^---\\s*\\n([\\s\\S]*?)\\n---/.exec(source)
    const title = meta && /^title:\\s*["']?(.+?)["']?\\s*$/m.exec(meta[1])
    if (title) return title[1].trim()
    const heading = /^#\\s+(.+)$/m.exec(source)
    if (heading) return heading[1].replace(/\\s+#+\\s*$/, '').trim()
  } catch {}
  return fallback
}
function pageLink(relative) {
  const clean = relative.replace(/\\\\/g, '/').replace(/(?:^|\\/)index\\.md$/i, '').replace(/\\.md$/i, '')
  return '/' + clean.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}
function scan(directory, prefix = '') {
  let entries = []
  try { entries = fs.readdirSync(directory, { withFileTypes:true }).filter((entry) => !entry.name.startsWith('.') && !ignored.has(entry.name)) } catch { return [] }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN', { numeric:true }))
  const items = []
  for (const entry of entries) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const children = scan(full, relative)
      if (children.length) items.push({ text:entry.name, collapsed:false, items:children })
    } else if (/\\.md$/i.test(entry.name) && relative.toLowerCase() !== 'index.md') {
      items.push({ text:pageTitle(full, path.basename(entry.name, path.extname(entry.name))), link:pageLink(relative) })
    }
  }
  return items
}

export default defineConfig({
  lang: 'zh-CN',
  title: '我的知识库',
  description: '由 CodeScope 与 VitePress 自动生成的本地知识库',
  base: '/knowledge/',
  cleanUrls: false,
  lastUpdated: true,
  ignoreDeadLinks: 'localhostLinks',
  markdown: { lineNumbers:true, image:{ lazyLoading:true } },
  vite: {
    resolve:{ alias:{
      'vue/server-renderer':path.join(modulesRoot, 'vue/server-renderer/index.js'),
      'vue':path.join(modulesRoot, 'vue/dist/vue.runtime.esm-bundler.js')
    } },
    build:{ assetsInlineLimit:0, cssMinify:true }
  },
  themeConfig: {
    logo: { src:'/codescope.svg', alt:'CodeScope' },
    nav: [
      { text:'知识库首页', link:'/' }
    ],
    sidebar: scan(sourceRoot),
    outline: { level:[2, 4], label:'本页目录' },
    lastUpdated: { text:'最后更新', formatOptions:{ dateStyle:'medium', timeStyle:'short', forceLocale:true } },
    docFooter: { prev:'上一篇', next:'下一篇' },
    darkModeSwitchLabel:'主题',
    lightModeSwitchTitle:'切换浅色模式',
    darkModeSwitchTitle:'切换深色模式',
    sidebarMenuLabel:'目录',
    returnToTopLabel:'返回顶部',
    search: {
      provider:'local',
      options:{
        translations:{
          button:{ buttonText:'搜索知识库', buttonAriaLabel:'搜索知识库' },
          modal:{ noResultsText:'没有找到相关内容', resetButtonTitle:'清除查询', backButtonTitle:'关闭搜索', displayDetails:'显示详细结果', footer:{ selectText:'选择', navigateText:'切换', closeText:'关闭' } }
        },
        miniSearch:{ searchOptions:{ fuzzy:0.2, prefix:true, boost:{ title:6, titles:3, text:1 } } }
      }
    }
  }
})
`;
}

const THEME_SOURCE = `import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import './custom.css'

const PALETTES = [
  ['ocean', '海洋蓝'],
  ['forest', '森林绿'],
  ['violet', '暮光紫'],
  ['paper', '暖纸棕']
]
const WIDTHS = [
  ['standard', '标准'],
  ['compact', '紧凑'],
  ['wide', '宽屏']
]
const ReaderControls = defineComponent({
  setup() {
    const palette = ref('ocean')
    const width = ref('standard')
    const apply = () => {
      if (typeof document === 'undefined') return
      document.documentElement.dataset.kbTheme = palette.value
      document.documentElement.dataset.kbWidth = width.value
    }
    const save = () => {
      apply()
      try {
        localStorage.setItem('codescope-kb-theme', palette.value)
        localStorage.setItem('codescope-kb-width', width.value)
      } catch {}
    }
    onMounted(() => {
      try {
        const savedPalette = localStorage.getItem('codescope-kb-theme')
        const savedWidth = localStorage.getItem('codescope-kb-width')
        if (PALETTES.some(([value]) => value === savedPalette)) palette.value = savedPalette
        if (WIDTHS.some(([value]) => value === savedWidth)) width.value = savedWidth
      } catch {}
      apply()
    })
    const select = (label, model, options, onChange) => h('label', { class:'kb-reader-select', title:label }, [
      h('span', { class:'kb-reader-select-label' }, label),
      h('select', { 'aria-label':label, value:model.value, onChange }, options.map(([value, text]) => h('option', { value }, text)))
    ])
    return () => h('div', { class:'kb-reader-controls', 'aria-label':'阅读外观' }, [
      select('配色', palette, PALETTES, (event) => { palette.value = event.target.value; save() }),
      select('版心', width, WIDTHS, (event) => { width.value = event.target.value; save() })
    ])
  }
})

const ReadingProgress = defineComponent({
  setup() {
    const progress = ref(0)
    const update = () => {
      const available = document.documentElement.scrollHeight - window.innerHeight
      progress.value = available > 0 ? Math.min(100, Math.max(0, window.scrollY / available * 100)) : 0
    }
    onMounted(() => { update(); window.addEventListener('scroll', update, { passive:true }); window.addEventListener('resize', update) })
    onUnmounted(() => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update) })
    return () => h('div', { class:'kb-reading-progress', 'aria-hidden':'true' }, [
      h('span', { style:{ width:progress.value + '%' } })
    ])
  }
})

const AccurateOutline = defineComponent({
  setup() {
    const { page } = useData()
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => requestAnimationFrame(() => {
        const headings = [...document.querySelectorAll('.vp-doc h2[id],.vp-doc h3[id],.vp-doc h4[id]')]
        const links = [...document.querySelectorAll('.VPDocAsideOutline a.outline-link[href^="#"]')]
        if (!headings.length || !links.length) return
        const navBottom = document.querySelector('.VPNav')?.getBoundingClientRect().bottom || 64
        const readingLine = Math.min(window.innerHeight * .3, navBottom + 120)
        let current = headings[0]
        for (const heading of headings) {
          if (heading.getBoundingClientRect().top <= readingLine) current = heading
          else break
        }
        links.forEach((link) => {
          let target = link.getAttribute('href')?.slice(1) || ''
          try { target = decodeURIComponent(target) } catch {}
          link.classList.toggle('kb-current', target === current.id)
        })
      }))
    }
    onMounted(() => {
      sync()
      window.addEventListener('scroll', sync, { passive:true })
      window.addEventListener('resize', sync)
      window.addEventListener('hashchange', sync)
    })
    onUnmounted(() => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('hashchange', sync)
    })
    watch(() => page.value.relativePath, () => nextTick(sync))
    return () => null
  }
})

const DocContext = defineComponent({
  setup() {
    const { page } = useData()
    const readingMinutes = ref(1)
    const crumbs = computed(() => {
      const parts = String(page.value.relativePath || '')
        .replace(/\\\\/g, '/')
        .replace(/\\.(?:md|markdown)$/i, '')
        .split('/')
        .filter((part) => part && part !== '..' && part !== '.')
      const knowledgeRoot = parts.lastIndexOf('知识库')
      return (knowledgeRoot >= 0 ? parts.slice(knowledgeRoot + 1) : parts).slice(0, -1)
    })
    const updated = computed(() => page.value.lastUpdated
      ? new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'short', day:'numeric' }).format(page.value.lastUpdated)
      : '')
    const measure = () => nextTick(() => {
      const text = document.querySelector('.vp-doc')?.textContent || ''
      const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length
      const latin = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
      readingMinutes.value = Math.max(1, Math.ceil((chinese + latin * 1.6) / 420))
    })
    onMounted(measure)
    watch(() => page.value.relativePath, measure)
    return () => h('div', { class:'kb-doc-context' }, [
      h('nav', { class:'kb-breadcrumb', 'aria-label':'文档路径' }, [
        h('span', { class:'home' }, '知识库'),
        ...crumbs.value.flatMap((part) => [h('i', '›'), h('span', part)])
      ]),
      h('div', { class:'kb-doc-meta' }, [
        h('span', { class:'format' }, 'Markdown'),
        h('span', readingMinutes.value + ' 分钟阅读'),
        updated.value ? h('span', '更新于 ' + updated.value) : null
      ])
    ])
  }
})

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'layout-top': () => [h(ReadingProgress), h(AccurateOutline)],
    'doc-before': () => h(DocContext),
    'nav-bar-content-after': () => h('div', { class:'kb-nav-extras' }, [
      h(ReaderControls),
      h('a', { class:'codescope-return', href:'/' }, '返回 CodeScope')
    ])
  })
}
`;

const THEME_CSS = `:root {
  --vp-c-brand-1:#5b8cff;
  --vp-c-brand-2:#79a4ff;
  --vp-c-brand-3:#3d6fd6;
  --vp-c-brand-soft:rgba(91,140,255,.14);
  --vp-layout-max-width:1760px;
  --kb-content-width:900px;
  --kb-radius:16px;
  --kb-page-glow:rgba(91,140,255,.09);
  --kb-doc-surface:color-mix(in srgb,var(--vp-c-bg-soft) 54%,var(--vp-c-bg));
  --kb-doc-border:color-mix(in srgb,var(--vp-c-brand-1) 14%,var(--vp-c-divider));
  --kb-heading:color-mix(in srgb,var(--vp-c-text-1) 94%,var(--vp-c-brand-1));
  font-synthesis:none;
}
html[data-kb-width="compact"] { --kb-content-width:760px; }
html[data-kb-width="standard"] { --kb-content-width:900px; }
html[data-kb-width="wide"] { --kb-content-width:1080px; }
html[data-kb-theme="forest"] {
  --vp-c-brand-1:#49b889;--vp-c-brand-2:#6dcc9f;--vp-c-brand-3:#328464;
  --vp-c-brand-soft:rgba(73,184,137,.14);--kb-page-glow:rgba(73,184,137,.09);
}
html[data-kb-theme="violet"] {
  --vp-c-brand-1:#9a7cf5;--vp-c-brand-2:#b19afa;--vp-c-brand-3:#7055c5;
  --vp-c-brand-soft:rgba(154,124,245,.15);--kb-page-glow:rgba(154,124,245,.1);
}
html[data-kb-theme="paper"] {
  --vp-c-brand-1:#ba7b38;--vp-c-brand-2:#ce9658;--vp-c-brand-3:#8e5a25;
  --vp-c-brand-soft:rgba(186,123,56,.14);--kb-page-glow:rgba(186,123,56,.08);
}
html:not(.dark)[data-kb-theme="paper"] {
  --vp-c-bg:#fbf8f1;--vp-c-bg-alt:#f3eee4;--vp-c-bg-soft:#f5f0e7;--vp-c-bg-elv:#fffdf8;
  --vp-c-divider:#ded5c7;--vp-c-gutter:#e9e1d5;--vp-c-text-1:#332d27;--vp-c-text-2:#6b6055;
}
body {
  background:
    radial-gradient(900px 520px at 64% -10%,var(--kb-page-glow),transparent 68%),
    var(--vp-c-bg);
  font-family:Inter,"SF Pro Text","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
}
.VPNav { backdrop-filter:blur(18px) saturate(135%); }
.VPNavBar { border-bottom-color:color-mix(in srgb,var(--vp-c-brand-1) 12%,var(--vp-c-divider)); }
.VPNavBarTitle .title { font-weight:760;letter-spacing:-.015em; }
.VPNavBarTitle .logo { filter:drop-shadow(0 3px 7px color-mix(in srgb,var(--vp-c-brand-1) 28%,transparent)); }
.VPSidebar {
  background:color-mix(in srgb,var(--vp-c-bg-alt) 88%,transparent);
  border-right:1px solid color-mix(in srgb,var(--vp-c-brand-1) 10%,var(--vp-c-divider));
  scrollbar-width:thin;
}
.VPSidebarItem .text { transition:color .16s,transform .16s; }
.VPSidebarItem.level-0 { margin:0 0 14px; }
.VPSidebarItem.level-0 > .item { min-height:40px;padding:0 8px;border:1px solid color-mix(in srgb,var(--vp-c-brand-1) 10%,var(--vp-c-divider));border-radius:10px;background:color-mix(in srgb,var(--vp-c-bg-soft) 76%,transparent); }
.VPSidebarItem.level-0 > .item > .text { display:flex;align-items:center;gap:9px;color:var(--vp-c-text-1);font-size:14px;font-weight:760;letter-spacing:.01em; }
.VPSidebarItem.level-0 > .item > .text::before { content:'分类';display:inline-grid;place-items:center;min-width:30px;height:19px;padding:0 4px;border-radius:5px;background:color-mix(in srgb,var(--vp-c-brand-1) 15%,var(--vp-c-bg-soft));color:var(--vp-c-brand-1);font:720 10px/1 var(--vp-font-family-base);letter-spacing:.06em; }
.VPSidebarItem.level-0 > .items { position:relative;margin:8px 0 0 12px;padding-left:12px;border-left:1px solid color-mix(in srgb,var(--vp-c-brand-1) 23%,var(--vp-c-divider)); }
.VPSidebarItem.level-1 { margin:0 0 7px; }
.VPSidebarItem.level-1 > .item { min-height:35px;padding:0 7px;border-radius:8px; }
.VPSidebarItem.level-1 > .item:hover { background:color-mix(in srgb,var(--vp-c-brand-soft) 48%,transparent); }
.VPSidebarItem.level-1 > .item > .text { display:flex;align-items:center;gap:8px;color:var(--vp-c-text-2);font-size:13px;font-weight:700; }
.VPSidebarItem.level-1 > .item > .text::before { content:'项目';display:inline-grid;place-items:center;min-width:28px;height:18px;padding:0 3px;border:1px solid color-mix(in srgb,var(--vp-c-brand-1) 20%,var(--vp-c-divider));border-radius:5px;color:color-mix(in srgb,var(--vp-c-brand-1) 76%,var(--vp-c-text-2));font:680 9px/1 var(--vp-font-family-base);letter-spacing:.05em; }
.VPSidebarItem.level-1 > .items { position:relative;margin:1px 0 0 14px;padding-left:11px;border-left:1px dashed color-mix(in srgb,var(--vp-c-brand-1) 23%,var(--vp-c-divider)); }
.VPSidebarItem.level-2 > .item { min-height:34px;margin:2px 0; }
.VPSidebarItem.level-2 > .item > .link { display:flex;align-items:center;min-height:32px;padding:4px 9px;border:1px solid transparent;border-radius:8px; }
.VPSidebarItem.level-2 > .item > .link > .text { display:flex;align-items:center;gap:8px;color:var(--vp-c-text-3);font-size:12.5px;font-weight:540;line-height:1.35; }
.VPSidebarItem.level-2 > .item > .link > .text::before { content:'文';display:inline-grid;flex:0 0 auto;place-items:center;width:19px;height:19px;border:1px solid var(--vp-c-divider);border-radius:5px;background:color-mix(in srgb,var(--vp-c-bg-elv) 76%,transparent);color:var(--vp-c-text-3);font:700 9px/1 var(--vp-font-family-base); }
.VPSidebarItem.level-2 > .item > .link:hover { border-color:color-mix(in srgb,var(--vp-c-brand-1) 16%,var(--vp-c-divider));background:color-mix(in srgb,var(--vp-c-brand-soft) 44%,transparent); }
.VPSidebarItem.level-2.is-active > .item > .link { border-color:color-mix(in srgb,var(--vp-c-brand-1) 31%,var(--vp-c-divider));background:linear-gradient(90deg,var(--vp-c-brand-soft),color-mix(in srgb,var(--vp-c-brand-soft) 30%,transparent));box-shadow:0 7px 22px color-mix(in srgb,var(--vp-c-brand-1) 10%,transparent); }
.VPSidebarItem.level-2.is-active > .item > .link > .text { color:var(--vp-c-brand-1);font-weight:700;transform:none; }
.VPSidebarItem.level-2.is-active > .item > .link > .text::before { border-color:color-mix(in srgb,var(--vp-c-brand-1) 46%,var(--vp-c-divider));background:var(--vp-c-brand-1);color:#fff; }
.VPSidebarItem.is-active > .item > .indicator { left:-13px;width:3px;border-radius:99px;background:var(--vp-c-brand-1);box-shadow:0 0 14px var(--vp-c-brand-1); }
.VPDoc .content-container {
  max-width:var(--kb-content-width)!important;
  padding:clamp(18px,2.5vw,34px) clamp(18px,3.4vw,46px) clamp(210px,38vh,430px);
}
.VPDoc .container { max-width:calc(var(--kb-content-width) + 380px)!important; }
.VPDoc .main { padding-top:22px; }
.vp-doc { counter-reset:kb-h2;color:color-mix(in srgb,var(--vp-c-text-1) 89%,var(--vp-c-text-2));font-size:16px;line-height:1.82; }
.vp-doc > :first-child { margin-top:0; }
.vp-doc h1,.vp-doc h2,.vp-doc h3,.vp-doc h4 { color:var(--kb-heading);letter-spacing:-.025em;scroll-margin-top:90px; }
.vp-doc h1 { margin-bottom:.72em;font-size:2.35rem;line-height:1.16; }
.vp-doc h1::after { content:'';display:block;width:44px;height:3px;margin-top:16px;border-radius:99px;background:linear-gradient(90deg,var(--vp-c-brand-1),transparent); }
.vp-doc h1 + p { max-width:760px;margin:0 0 2.25em;color:var(--vp-c-text-2);font-size:1.06em;line-height:1.86; }
.vp-doc h2 { counter-increment:kb-h2;display:flex;align-items:center;gap:11px;margin-top:2.55em;padding-top:1.05em;border-top:1px solid color-mix(in srgb,var(--vp-c-brand-1) 16%,var(--vp-c-divider));font-size:1.5rem; }
.vp-doc h2::before { content:counter(kb-h2,decimal-leading-zero);display:inline-grid;place-items:center;min-width:30px;height:24px;padding:0 5px;border:1px solid color-mix(in srgb,var(--vp-c-brand-1) 34%,var(--vp-c-divider));border-radius:7px;background:var(--vp-c-brand-soft);color:var(--vp-c-brand-1);font:750 11px/1 var(--vp-font-family-mono);letter-spacing:0; }
.vp-doc h3 { position:relative;margin-top:1.85em;padding-left:14px;font-size:1.16rem; }
.vp-doc h3::before { content:'';position:absolute;left:0;top:.42em;width:4px;height:1em;border-radius:99px;background:var(--vp-c-brand-1);box-shadow:0 0 12px var(--vp-c-brand-soft); }
.vp-doc p,.vp-doc li { text-wrap:pretty; }
.vp-doc p { margin:14px 0; }
.vp-doc ul,.vp-doc ol { margin:12px 0;padding-left:1.55em; }
.vp-doc li { margin:5px 0;padding-left:.22em; }
.vp-doc li::marker { color:color-mix(in srgb,var(--vp-c-brand-1) 75%,var(--vp-c-text-3));font-weight:700; }
.vp-doc li > ul,.vp-doc li > ol { position:relative;margin:6px 0 7px;padding-left:1.45em; }
.vp-doc li > ul::before,.vp-doc li > ol::before { content:'';position:absolute;left:.2em;top:.25em;bottom:.25em;width:1px;background:color-mix(in srgb,var(--vp-c-brand-1) 24%,var(--vp-c-divider)); }
.vp-doc h3 + ul,.vp-doc h3 + ol { margin-top:11px;padding:13px 18px 13px 38px;border:1px solid color-mix(in srgb,var(--vp-c-brand-1) 12%,var(--vp-c-divider));border-radius:12px;background:color-mix(in srgb,var(--vp-c-bg-soft) 72%,transparent); }
.vp-doc a { text-decoration-color:color-mix(in srgb,var(--vp-c-brand-1) 44%,transparent);text-underline-offset:3px; }
.vp-doc a:hover { text-decoration-thickness:2px; }
.vp-doc strong { color:var(--vp-c-text-1);font-weight:720; }
.vp-doc :not(pre) > code { padding:.16em .42em;border:1px solid color-mix(in srgb,var(--vp-c-brand-1) 18%,var(--vp-c-divider));border-radius:6px;background:color-mix(in srgb,var(--vp-c-brand-soft) 72%,var(--vp-c-bg-soft));color:color-mix(in srgb,var(--vp-c-brand-1) 76%,var(--vp-c-text-1));font-size:.88em; }
.vp-doc div[class*="language-"] { overflow:hidden;border:1px solid color-mix(in srgb,var(--vp-c-brand-1) 14%,var(--vp-c-divider));border-radius:13px;background:color-mix(in srgb,var(--vp-code-block-bg) 97%,var(--vp-c-brand-1));box-shadow:0 14px 38px rgba(0,0,0,.12); }
.vp-doc div[class*="language-"]::before { content:'●  ●  ●';position:absolute;left:16px;top:10px;z-index:2;color:color-mix(in srgb,var(--vp-c-text-3) 66%,var(--vp-c-brand-1));font-size:9px;letter-spacing:2px; }
.vp-doc div[class*="language-"] pre { padding-top:34px; }
.vp-doc blockquote { margin:22px 0;padding:14px 18px;border-left:4px solid var(--vp-c-brand-1);border-radius:0 10px 10px 0;background:var(--vp-c-brand-soft);color:var(--vp-c-text-2); }
.vp-doc .custom-block { border-width:1px;border-radius:12px;box-shadow:0 8px 26px rgba(0,0,0,.07); }
.vp-doc table { display:table;width:100%;overflow:hidden;border-collapse:separate;border-spacing:0;border:1px solid var(--vp-c-divider);border-radius:11px; }
.vp-doc tr:nth-child(2n) { background:color-mix(in srgb,var(--vp-c-bg-soft) 72%,transparent); }
.vp-doc th { background:color-mix(in srgb,var(--vp-c-brand-soft) 54%,var(--vp-c-bg-soft));color:var(--vp-c-text-1); }
.vp-doc img { display:block;max-height:78vh;margin:26px auto;border:1px solid var(--vp-c-divider);border-radius:13px;box-shadow:0 16px 48px rgba(0,0,0,.16);object-fit:contain; }
.VPDocAsideOutline .outline-link { border-radius:6px;transition:color .15s,background .15s,transform .15s; }
.VPDocAsideOutline .outline-link.active:not(.kb-current) { color:var(--vp-c-text-2); }
.VPDocAsideOutline .outline-link.kb-current { padding-left:8px;background:var(--vp-c-brand-soft);color:var(--vp-c-brand-1);font-weight:650;transform:translateX(2px); }
.kb-reading-progress { position:fixed;z-index:1000;top:0;left:0;width:100%;height:2px;pointer-events:none; }
.kb-reading-progress span { display:block;height:100%;border-radius:0 99px 99px 0;background:linear-gradient(90deg,var(--vp-c-brand-3),var(--vp-c-brand-1),var(--vp-c-brand-2));box-shadow:0 0 10px var(--vp-c-brand-1);transition:width .08s linear; }
.kb-doc-context { display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 0 34px;padding:0 0 15px;border-bottom:1px solid color-mix(in srgb,var(--vp-c-brand-1) 12%,var(--vp-c-divider));color:var(--vp-c-text-3);font-size:12px; }
.kb-breadcrumb,.kb-doc-meta { display:flex;align-items:center;gap:7px;min-width:0; }
.kb-breadcrumb { overflow:hidden;white-space:nowrap; }
.kb-breadcrumb span { overflow:hidden;text-overflow:ellipsis; }
.kb-breadcrumb .home { color:var(--vp-c-brand-1);font-weight:700; }
.kb-breadcrumb i { color:color-mix(in srgb,var(--vp-c-brand-1) 58%,var(--vp-c-text-3));font-style:normal; }
.kb-doc-meta { flex:none; }
.kb-doc-meta span { display:inline-flex;align-items:center;min-height:23px;padding:0 8px;border:1px solid var(--vp-c-divider);border-radius:999px;background:color-mix(in srgb,var(--vp-c-bg-soft) 74%,transparent);white-space:nowrap; }
.kb-doc-meta .format { border-color:color-mix(in srgb,var(--vp-c-brand-1) 24%,var(--vp-c-divider));background:var(--vp-c-brand-soft);color:var(--vp-c-brand-1);font-weight:700; }
.VPDocFooter { border-top:1px solid color-mix(in srgb,var(--vp-c-brand-1) 13%,var(--vp-c-divider)); }
.pager-link { border-radius:12px!important;background:color-mix(in srgb,var(--vp-c-bg-soft) 70%,transparent);transition:transform .18s,border-color .18s,background .18s; }
.pager-link:hover { transform:translateY(-2px);border-color:color-mix(in srgb,var(--vp-c-brand-1) 42%,var(--vp-c-divider))!important;background:var(--vp-c-brand-soft); }
.VPHero .name { background:linear-gradient(118deg,var(--vp-c-brand-1) 15%,color-mix(in srgb,var(--vp-c-brand-1) 34%,#63d7a1));-webkit-background-clip:text;background-clip:text; }
.VPFeature { border-color:color-mix(in srgb,var(--vp-c-brand-1) 12%,var(--vp-c-divider));border-radius:15px;background:color-mix(in srgb,var(--vp-c-bg-soft) 84%,transparent);transition:transform .18s,border-color .18s,box-shadow .18s; }
.VPFeature:hover { transform:translateY(-3px);border-color:color-mix(in srgb,var(--vp-c-brand-1) 44%,var(--vp-c-divider));box-shadow:0 16px 44px rgba(0,0,0,.1); }
.kb-nav-extras,.kb-reader-controls { display:flex;align-items:center;gap:7px; }
.kb-reader-select { position:relative;display:flex;align-items:center;height:32px;padding-left:9px;border:1px solid var(--vp-c-divider);border-radius:9px;background:color-mix(in srgb,var(--vp-c-bg-soft) 86%,transparent);color:var(--vp-c-text-2);font-size:11px;font-weight:650; }
.kb-reader-select:focus-within { border-color:var(--vp-c-brand-1);box-shadow:0 0 0 3px var(--vp-c-brand-soft); }
.kb-reader-select select { height:30px;padding:0 24px 0 5px;border:0;outline:0;background:transparent;color:var(--vp-c-text-1);font:inherit;cursor:pointer; }
.codescope-return { display:inline-flex;align-items:center;height:32px;padding:0 12px;border:1px solid var(--vp-c-divider);border-radius:9px;background:color-mix(in srgb,var(--vp-c-bg-soft) 86%,transparent);color:var(--vp-c-text-2);font-size:12px;font-weight:650;text-decoration:none;white-space:nowrap; }
.codescope-return:hover { border-color:var(--vp-c-brand-1);background:var(--vp-c-brand-soft);color:var(--vp-c-brand-1); }
* { scrollbar-color:color-mix(in srgb,var(--vp-c-brand-1) 32%,var(--vp-c-divider)) transparent; }
@media (min-width:960px) {
  html .VPSidebar.VPSidebar { width:288px!important;padding-right:20px;padding-left:24px; }
  html .VPContent.has-sidebar.has-sidebar { padding-right:0!important;padding-left:288px!important; }
}
/* On ultra-wide screens, place category navigation, article and page outline
   in one centred, symmetric three-column reading frame. Keep this after the
   regular desktop rules so the wide layout cannot be overwritten. */
@media (min-width:1700px) {
  html .VPSidebar.VPSidebar {
    top:64px;
    left:calc(50vw - (var(--kb-content-width) / 2) - 256px);
    width:256px!important;
    height:calc(100vh - 64px);
    padding:38px 20px 72px 24px;
    border-right:0;
    background:transparent;
  }
  html .VPContent.has-sidebar.has-sidebar {
    padding-right:0!important;
    padding-left:0!important;
  }
  html .VPDoc.VPDoc > .container.container {
    display:grid;
    grid-template-columns:256px minmax(640px,var(--kb-content-width)) 256px;
    justify-content:center;
    align-items:start;
    max-width:none!important;
  }
  html .VPDoc.VPDoc > .container.container > .content.content {
    grid-column:2;
    grid-row:1;
    min-width:0;
    width:100%;
    margin:0;
  }
  html .VPDoc.VPDoc > .container.container > .aside.aside { display:none; }
  html .VPDoc.VPDoc:has(.VPDocAsideOutline.has-outline) > .container.container > .aside.aside {
    display:block;
    grid-column:3;
    grid-row:1;
    width:256px;
    max-width:256px;
    padding-left:32px;
  }
}
@media (max-width:1100px) {
  .kb-reader-select-label { display:none; }
  .kb-reader-select { padding-left:2px; }
  .kb-doc-meta span:last-child { display:none; }
}
@media (max-width:767px) {
  .kb-reader-controls { display:none; }
  .codescope-return { padding:0 9px;font-size:0; }
  .codescope-return::before { content:'↩';font-size:16px; }
  .VPDoc .content-container { padding:24px 20px; }
  .vp-doc { font-size:15px;line-height:1.82; }
  .vp-doc h1 { font-size:1.82rem; }
  .vp-doc h2 { font-size:1.32rem; }
  .kb-doc-context { align-items:flex-start;flex-direction:column;margin-bottom:28px; }
  .kb-doc-meta span:last-child { display:inline-flex; }
}
@media (prefers-reduced-motion:reduce) { .VPFeature,.VPSidebarItem .text,.VPDocAsideOutline .outline-link { transition:none; } }
`;

const HOME_SOURCE = `---
layout: home

hero:
  name: 我的知识库
  text: 长期积累，随写随读
  tagline: Markdown 原稿保存在 CodeScope Vault；目录、全文搜索和阅读站点自动生成。
  actions:
    - theme: brand
      text: 开始阅读
      link: /快速开始/使用指南/知识库使用指南

features:
  - icon: 📚
    title: 分层组织
    details: 按“分类 → 项目 → Markdown 片段”组织，侧边目录随内容自动更新。
  - icon: 🔎
    title: 本地全文搜索
    details: MiniSearch 在浏览器中完成模糊检索，不上传私人笔记。
  - icon: 🖼️
    title: 大量图片
    details: 图片独立存储、按需加载，构建产物带缓存指纹。
  - icon: ⚡
    title: 静态预构建
    details: 页面提前生成，文档量增大后仍保持稳定、快速的阅读体验。
---
`;

const GUIDE_SOURCE = `---
title: 知识库使用指南
---

# 知识库使用指南

这个目录是 CodeScope 的长期知识库。你只需要维护 Markdown 原稿，CodeScope 会调用 VitePress 自动生成阅读站点。

## 推荐的目录方式

按“分类 → 项目 → Markdown 片段”组织，例如：

\`\`\`text
知识库/
├── 嵌入式 Linux/                 # 分类
│   ├── Linux 驱动开发/            # 项目
│   │   ├── 项目概览.md          # Markdown 片段
│   │   ├── 设备树与平台驱动.md
│   │   └── 调试记录.md
│   └── Linux 网络编程/
└── MCU 与 RTOS/                  # 分类
    └── FreeRTOS 实践/             # 项目
        ├── 任务调度.md
        └── 中断与队列.md
\`\`\`

## 新建文档

1. 先创建分类，例如“嵌入式 Linux”。
2. 在分类中创建项目，例如“Linux 驱动开发”。
3. 打开项目，通过“＋ Markdown”新建任意数量的文档片段。
4. 在阅读模块中编辑 Markdown，保存后自动生成新站点。

## 图片

在知识库中心选择“导入图片”。上传后会得到可直接粘贴到 Markdown 的图片语法。生成站点为图片启用浏览器懒加载，长文不会一次解码全部图片。

## 搜索与定位

阅读站点顶部提供全文模糊搜索；左侧是分类目录，右侧是当前文档大纲。每个标题都有稳定锚点，可直接复制链接定位。

::: tip 数据安全
原始 Markdown 和图片位于 Vault 的 \`readings/知识库\`。\`.vitepress\` 是站点配置，生成结果在 CodeScope 缓存目录，可以随时删除并重新构建。
:::
`;

function createKnowledgeBase(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const dataRoot = path.resolve(options.dataRoot);
  const getVaultPath = options.getVaultPath;
  const sourceDir = () => path.join(getVaultPath(), 'readings', KNOWLEDGE_FOLDER);
  const distDir = () => path.join(dataRoot, 'knowledge', 'site');
  let state = { phase:'idle', message:'尚未生成', startedAt:0, finishedAt:0, durationMs:0, error:'', pending:false };
  let buildPromise = null, timer = null, watcher = null, poller = null, observedSourceTime = 0;

  function ensure() {
    const root = sourceDir();
    fs.mkdirSync(root, { recursive:true });
    writeIfMissing(path.join(root, '.codescope-folder.json'), JSON.stringify({ version:1, description:'VitePress 自动生成的长期 Markdown 知识库', updatedAt:Date.now() }, null, 2) + '\n');
    const legacyProjectMeta=path.join(root,'.codescope-project.json');
    if(fs.existsSync(legacyProjectMeta))try{const legacy=JSON.parse(fs.readFileSync(legacyProjectMeta,'utf8'));if(legacy&&legacy.description==='VitePress 自动生成的长期 Markdown 知识库')fs.unlinkSync(legacyProjectMeta);}catch(_){}
    migrateKnowledgeHome(path.join(root, 'index.md'));
    const legacyGuide = path.join(root, '快速开始', '知识库使用指南.md');
    const guideProject = path.join(root, '快速开始', '使用指南');
    const guideFile = path.join(guideProject, '知识库使用指南.md');
    fs.mkdirSync(guideProject, { recursive:true });
    if (fs.existsSync(legacyGuide) && !fs.existsSync(guideFile)) fs.renameSync(legacyGuide, guideFile);
    if (fs.existsSync(legacyGuide) && fs.existsSync(guideFile)) {
      try { if (fs.readFileSync(legacyGuide, 'utf8') === fs.readFileSync(guideFile, 'utf8')) fs.unlinkSync(legacyGuide); } catch (_) {}
    }
    writeManaged(guideFile, GUIDE_SOURCE);
    writeIfMissing(path.join(guideProject, KNOWLEDGE_PROJECT_META), JSON.stringify({ version:1, description:'CodeScope 知识库的结构与使用说明', tags:['指南'], updatedAt:Date.now() }, null, 2) + '\n');
    writeManaged(path.join(root, '.vitepress', 'config.mjs'), configSource());
    writeManaged(path.join(root, '.vitepress', 'theme', 'index.mjs'), THEME_SOURCE);
    writeManaged(path.join(root, '.vitepress', 'theme', 'custom.css'), THEME_CSS);
    writeManaged(path.join(root, '.gitignore'), '.vitepress/cache/\n.vitepress/node_modules\n');
    const modulesLink = path.join(root, '.vitepress', 'node_modules');
    const expectedModules = path.resolve(projectRoot, 'node_modules');
    let repairModules = !fs.existsSync(modulesLink);
    if (!repairModules) try { repairModules = fs.realpathSync(modulesLink) !== fs.realpathSync(expectedModules); } catch (_) { repairModules=true; }
    if (repairModules) {
      try { fs.rmSync(modulesLink, { recursive:true, force:true }); } catch (_) {}
      try { fs.symlinkSync(expectedModules, modulesLink, process.platform === 'win32' ? 'junction' : 'dir'); } catch (_) {}
    }
    const logo = path.join(projectRoot, 'assets', 'codescope.svg');
    if (fs.existsSync(logo) && !fs.existsSync(path.join(root, 'public', 'codescope.svg'))) {
      fs.mkdirSync(path.join(root, 'public'), { recursive:true });
      fs.copyFileSync(logo, path.join(root, 'public', 'codescope.svg'));
    }
    return root;
  }

  function pageRecords() {
    const root = ensure(), pages = [];
    const walk = (directory, prefix) => {
      let entries = []; try { entries = fs.readdirSync(directory, { withFileTypes:true }); } catch (_) { return; }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN', { numeric:true }));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'public' || entry.name === 'node_modules') continue;
        const rel = prefix ? prefix + '/' + entry.name : entry.name, full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full, rel);
        else if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const stat = fs.statSync(full);
          const fallback = rel.toLowerCase() === 'index.md' ? '知识库首页' : path.basename(entry.name, path.extname(entry.name));
          pages.push({ path:rel, readingPath:KNOWLEDGE_FOLDER + '/' + rel, title:textTitle(full, fallback), size:stat.size, updated:stat.mtimeMs });
        }
      }
    };
    walk(root, '');
    return pages;
  }

  function assetCount() {
    const root = path.join(ensure(), 'public', 'images'); let count = 0, bytes = 0;
    const walk = (directory) => { let entries=[]; try { entries=fs.readdirSync(directory,{withFileTypes:true}); } catch (_) { return; } for (const entry of entries) { const full=path.join(directory,entry.name); if(entry.isDirectory())walk(full); else { count += 1; try { bytes += fs.statSync(full).size; } catch (_) {} } } };
    walk(root); return { count, bytes };
  }

  function newestSourceModified() {
    let newest=0;
    const walk=(directory)=>{let entries=[];try{entries=fs.readdirSync(directory,{withFileTypes:true});}catch(_){return;}for(const entry of entries){if(entry.name==='node_modules'||entry.name==='cache'&&path.basename(directory)==='.vitepress')continue;const full=path.join(directory,entry.name);try{if(entry.isDirectory())walk(full);else newest=Math.max(newest,fs.statSync(full).mtimeMs);}catch(_){}}};
    walk(ensure()); return newest;
  }

  function status() {
    const pages = pageRecords(), assets = assetCount(), built = fs.existsSync(path.join(distDir(), 'index.html'));
    let displayState = state;
    if (built && state.phase === 'idle') {
      let finishedAt=0; try { finishedAt=fs.statSync(path.join(distDir(), 'index.html')).mtimeMs; } catch (_) {}
      displayState={ ...state, phase:'ready', message:'知识库已就绪', finishedAt };
    }
    return { ok:true, engine:'VitePress', engineVersion:require('vitepress/package.json').version, sourceDir:sourceDir(), distDir:distDir(), url:'/knowledge/', pages, pageCount:pages.length, assetCount:assets.count, assetBytes:assets.bytes, built, ...displayState };
  }

  function build(reason = 'manual') {
    ensure();
    if (buildPromise) { state.pending = true; return buildPromise; }
    clearTimeout(timer); timer = null;
    const startedAt = Date.now();
    state = { ...state, phase:'building', message:'正在生成知识库…', startedAt, error:'', pending:false, reason };
    const bin = path.join(projectRoot, 'node_modules', 'vitepress', 'bin', 'vitepress.js');
    fs.mkdirSync(path.dirname(distDir()), { recursive:true });
    buildPromise = new Promise((resolve) => {
      const child = spawn(process.execPath, [bin, 'build', sourceDir(), '--outDir', distDir()], { cwd:projectRoot, env:{ ...process.env, NO_COLOR:'1' }, stdio:['ignore','pipe','pipe'] });
      let output = '';
      const add = (chunk) => { output = (output + chunk.toString()).slice(-12000); };
      child.stdout.on('data', add); child.stderr.on('data', add);
      child.once('error', (error) => {
        const finishedAt=Date.now(); state={ ...state, phase:'error', message:'知识库生成失败', error:String(error.message||error), finishedAt, durationMs:finishedAt-startedAt }; buildPromise=null; resolve(status());
      });
      child.once('exit', (code) => {
        const finishedAt = Date.now(), ok = code === 0 && fs.existsSync(path.join(distDir(), 'index.html'));
        state = { ...state, phase:ok?'ready':'error', message:ok?'知识库已更新':'知识库生成失败', error:ok?'':output.trim().slice(-4000), finishedAt, durationMs:finishedAt-startedAt };
        buildPromise = null; const again = state.pending; state.pending = false; resolve(status()); if (again) schedule('pending');
      });
    });
    return buildPromise;
  }

  function schedule(reason = 'save', delay = 850) {
    clearTimeout(timer); state = { ...state, pending:true, message:state.phase === 'building' ? state.message : '内容已变更，等待生成…' };
    timer = setTimeout(() => { timer=null; build(reason); }, delay); timer.unref?.();
  }

  function start() {
    ensure();
    const entry=path.join(distDir(), 'index.html');let builtAt=0;try{builtAt=fs.statSync(entry).mtimeMs;}catch(_){}
    observedSourceTime=newestSourceModified();
    if (!builtAt || observedSourceTime > builtAt + 10) schedule('startup', 100);
    try {
      watcher = fs.watch(sourceDir(), { recursive:true }, (_event, file) => {
        const rel = String(file || '').replace(/\\/g, '/');
        if (!rel || rel === '.vitepress' || rel.startsWith('.vitepress/') || /(^|\/)\.DS_Store$/.test(rel)) return;
        schedule('watch');
      });
      watcher.on('error', () => { try { watcher.close(); } catch (_) {} watcher=null; });
    } catch (_) {}
    if (!watcher) {
      poller=setInterval(()=>{const next=newestSourceModified();if(next>observedSourceTime+1){observedSourceTime=next;schedule('watch-poll');}},2500);
      poller.unref?.();
    }
  }

  function stop() { clearTimeout(timer); timer=null;clearInterval(poller);poller=null;try { watcher?.close(); } catch (_) {} watcher=null; }

  function createPage(input) {
    ensure(); let rel = safeRelative(input && input.path, { extension:MARKDOWN_EXTENSIONS });
    if (!rel || rel.split('/').length < 3) throw new Error('文档路径不合法，请使用“分类/项目/文档名称.md”');
    const target = path.resolve(sourceDir(), rel), root = path.resolve(sourceDir());
    if (!target.startsWith(root + path.sep) || fs.existsSync(target)) throw new Error(fs.existsSync(target) ? '同名知识库文档已存在' : '文档路径不合法');
    if (!fs.existsSync(path.join(path.dirname(target), KNOWLEDGE_PROJECT_META))) throw new Error('请先创建知识项目，Markdown 片段只能建在项目中');
    const title = String(input && input.title || path.basename(rel, path.extname(rel))).trim().slice(0, 160) || '未命名文档';
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.writeFileSync(target, `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n\n开始记录……\n`, 'utf8');
    schedule('create-page'); return { ok:true, path:rel, readingPath:KNOWLEDGE_FOLDER + '/' + rel, title };
  }

  function createFolder(input) {
    ensure();
    const rel = safeRelative(input && input.path);
    if (!rel) throw new Error('分类路径不合法');
    const target = path.resolve(sourceDir(), rel), root = path.resolve(sourceDir());
    if (!target.startsWith(root + path.sep)) throw new Error('分类路径不合法');
    for (let cursor=target; cursor.startsWith(root + path.sep); cursor=path.dirname(cursor)) {
      if (fs.existsSync(path.join(cursor, KNOWLEDGE_PROJECT_META))) throw new Error('知识项目内不能创建分类');
    }
    fs.mkdirSync(target, { recursive:true });
    schedule('create-folder'); return { ok:true, path:rel };
  }

  function createProject(input) {
    ensure();
    const rel = safeRelative(input && input.path);
    if (!rel || rel.split('/').length < 2) throw new Error('项目路径不合法，请使用“分类/项目名称”');
    const target = path.resolve(sourceDir(), rel), root = path.resolve(sourceDir());
    if (!target.startsWith(root + path.sep)) throw new Error('项目路径不合法');
    if (fs.existsSync(path.join(target, KNOWLEDGE_PROJECT_META))) throw new Error('同名知识项目已存在');
    for (let cursor=path.dirname(target); cursor.startsWith(root + path.sep); cursor=path.dirname(cursor)) {
      if (fs.existsSync(path.join(cursor, KNOWLEDGE_PROJECT_META))) throw new Error('知识项目内不能再创建子项目');
    }
    fs.mkdirSync(target, { recursive:true });
    const name = path.basename(rel);
    const description = String(input && input.description || '').trim().slice(0, 1000);
    const rawTags = Array.isArray(input && input.tags) ? input.tags : String(input && input.tags || '').split(/[,，]/);
    const tags = rawTags.map(String).map((tag)=>tag.trim()).filter(Boolean).slice(0, 30);
    fs.writeFileSync(path.join(target, KNOWLEDGE_PROJECT_META), JSON.stringify({ version:1, description, tags, updatedAt:Date.now() }, null, 2) + '\n', 'utf8');
    writeIfMissing(path.join(target, '项目概览.md'), `---\ntitle: ${JSON.stringify(name + ' · 项目概览')}\n---\n\n# ${name}\n\n${description || '在这里记录项目概览、学习目标和文档索引。'}\n`);
    schedule('create-project');
    return { ok:true, path:rel, readingPath:KNOWLEDGE_FOLDER + '/' + rel + '/项目概览.md' };
  }

  function saveImage(relative, body, type) {
    const ext = path.extname(relative).toLowerCase(), rel = safeRelative(relative, { extension:IMAGE_EXTENSIONS });
    if (!rel || !IMAGE_EXTENSIONS.has(ext)) throw new Error('仅支持 PNG、JPG、GIF 和 WebP 图片');
    if (!Buffer.isBuffer(body) || !body.length || body.length > 50 * 1024 * 1024) throw new Error('图片为空或超过 50 MB');
    const signatures = {
      '.png': body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
      '.jpg': body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff,
      '.jpeg': body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff,
      '.gif': body.length >= 6 && ['GIF87a','GIF89a'].includes(body.subarray(0, 6).toString('ascii')),
      '.webp': body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP',
    };
    if (!signatures[ext]) throw new Error('图片内容与文件扩展名不匹配');
    const target = path.resolve(sourceDir(), 'public', 'images', rel), root = path.resolve(sourceDir(), 'public', 'images');
    if (!target.startsWith(root + path.sep)) throw new Error('图片路径不合法');
    fs.mkdirSync(path.dirname(target), { recursive:true }); fs.writeFileSync(target, body); schedule('upload-image');
    const url = '/images/' + rel.split('/').map(encodeURIComponent).join('/');
    return { ok:true, path:'images/' + rel, url, markdown:`![图片说明](${url})`, type };
  }

  return { folderName:KNOWLEDGE_FOLDER, sourceDir, distDir, ensure, status, build, schedule, start, stop, createPage, createFolder, createProject, saveImage };
}

module.exports = { createKnowledgeBase, KNOWLEDGE_FOLDER };
