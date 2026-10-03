'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const KNOWLEDGE_FOLDER = '知识库';
const KNOWLEDGE_PROJECT_META = '.codescope-project.json';
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
/* 单次构建的硬上限：vitepress 卡死时必须能自救，否则状态永远停在“正在生成知识库…”。 */
const KNOWLEDGE_BUILD_TIMEOUT_MS = Math.max(60000, Number(process.env.CODESCOPE_KNOWLEDGE_BUILD_TIMEOUT_MS) || 180000);

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

/* 原子写：知识库文档是用户内容，半截文件会直接出现在站点里。 */
function writeFileAtomicSync(file, data, options) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp-' + process.pid + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  let mode;
  try { mode = fs.statSync(file).mode; } catch (_) {}
  fs.writeFileSync(tmp, data, options);
  if (mode !== undefined) { try { fs.chmodSync(tmp, mode); } catch (_) {} }
  fs.renameSync(tmp, file);
  return file;
}

function writeIfMissing(file, content) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  writeFileAtomicSync(file, content, 'utf8');
  return true;
}

function writeManaged(file, content) {
  let current = ''; try { current = fs.readFileSync(file, 'utf8'); } catch (_) {}
  if (current === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  writeFileAtomicSync(file, content, 'utf8');
  return true;
}

/* 返回站点内路径（不含 base，也不带 .html）——
   markdown 链接必须用这种形式：VitePress 的链接是相对 base 解析的，
   写成 /knowledge/xxx 会被再拼一次 base 变成 /knowledge/knowledge/xxx（死链），
   带 .html 也会被判死链（它期望无扩展名，渲染时自己补）。 */
function firstPagePath(root) {
  const walk = (directory, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes:true }); } catch (_) { return null; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN', { numeric:true }));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'public' || entry.name === 'node_modules') continue;
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        const hit = walk(path.join(directory, entry.name), relative);
        if (hit) return hit;
      } else if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && relative.toLowerCase() !== 'index.md') {
        return '/' + relative.replace(/\.[^.]+$/, '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
      }
    }
    return null;
  };
  return walk(root, '');
}

function homeSource(root) {
  const first = firstPagePath(root);
  if (!first) {
    return '---\ntitle: 我的知识库\n---\n\n# 我的知识库\n\n这个知识库还是空的。在 CodeScope 里新建分类和 Markdown 片段后，这里会自动出现内容。\n';
  }
  const link = first + '.html';
  /* 用 location.replace 整页跳转，而不是 router.replace：
     试过 router.replace('/快速开始/…/xxx.html')（解码后的路径也试过），
     vue-router 匹配不上、静默失败，页面就停在「正在打开知识库…」。
     这里跳的是真实静态文件 URL，服务端确实能提供，最稳。
     代价是一次整页加载 —— 对一个「跳过落地页」的跳板来说完全值得。 */
  const target = '/knowledge' + link;
  return [
    '---',
    'title: 我的知识库',
    '---',
    '',
    '<script setup>',
    "import { onMounted } from 'vue'",
    'onMounted(() => { window.location.replace(' + JSON.stringify(target) + ') })',
    '</script>',
    '',
    '# 正在打开知识库…',
    '',
    '如果没有自动跳转，点[这里](' + link + ')。',
    '',
  ].join('\n');
}

function configSource() {
  return `import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import kbColor from './kb-color.mjs'

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
/* 「最近更新」入口：内容一多就找不到刚写的东西。构建期扫一遍 mtime 取前几条，
   做成导航栏下拉 —— 纯静态，不耗运行时、也不怕离线。 */
function recentPages(limit) {
  const out = []
  const walk = (directory, prefix) => {
    let entries = []
    try { entries = fs.readdirSync(directory, { withFileTypes:true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue
      const relative = prefix ? prefix + '/' + entry.name : entry.name
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full, relative)
      else if (/\\.md$/i.test(entry.name) && relative.toLowerCase() !== 'index.md') {
        let mtime = 0
        try { mtime = fs.statSync(full).mtimeMs } catch {}
        out.push({ text: pageTitle(full, path.basename(entry.name, path.extname(entry.name))), link: pageLink(relative), mtime })
      }
    }
  }
  walk(sourceRoot, '')
  return out.filter((item) => item.mtime > 0).sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

export default defineConfig({
  lang: 'zh-CN',
  title: '我的知识库',
  description: '由 CodeScope 与 VitePress 自动生成的本地知识库',
  /* 在首屏绘制之前把用户选过的配色/版心写到 <html> 上。
     主题里的 apply() 是在组件 onMounted 时才执行的 —— 那已经在首屏之后了，
     于是每次打开都会先按默认的海洋蓝渲染一遍，再跳成你选的配色（森林绿等），
     看起来就是「打开时颜色不对、闪一下」。这段内联脚本在 CSS 生效前就跑完了。 */
  head: [
    ['script', {}, "(function(){try{var d=document.documentElement;var p=localStorage.getItem('codescope-kb-theme');var w=localStorage.getItem('codescope-kb-width');var s=localStorage.getItem('codescope-kb-size');if(p&&['ocean','forest','violet','paper'].indexOf(p)>=0){d.dataset.kbTheme=p}if(w&&['standard','compact','wide'].indexOf(w)>=0){d.dataset.kbWidth=w}if(s&&['small','normal','large','huge'].indexOf(s)>=0){d.dataset.kbSize=s}}catch(e){}})()"]
  ],
  base: '/knowledge/',
  cleanUrls: false,
  lastUpdated: true,
  ignoreDeadLinks: 'localhostLinks',
  markdown: { lineNumbers:true, image:{ lazyLoading:true }, config:(md) => md.use(kbColor) },
  vite: {
    resolve:{ alias:{
      'vue/server-renderer':path.join(modulesRoot, 'vue/server-renderer/index.js'),
      'vue':path.join(modulesRoot, 'vue/dist/vue.runtime.esm-bundler.js')
    } },
    build:{ assetsInlineLimit:0, cssMinify:true }
  },
  themeConfig: {
    logo: { src:'/codescope.svg', alt:'CodeScope' },
    /* 没有「首页」了：站点根 index.md 会直接跳到第一篇文档，
       所以这里不再放「知识库首页」入口，免得点了又被弹回同一篇。
       「最近更新」是构建期算出来的静态下拉，不耗运行时。 */
    nav: (() => {
      const recent = recentPages(6)
      if (!recent.length) return []
      return [{
        text: '最近更新',
        items: recent.map((page) => ({
          text: page.text + ' · ' + new Date(page.mtime).toLocaleDateString('zh-CN', { month:'2-digit', day:'2-digit' }),
          link: page.link
        }))
      }]
    })(),
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
const SIZES = [
  ['small', '小'],
  ['normal', '标准'],
  ['large', '大'],
  ['huge', '特大']
]
const ReaderControls = defineComponent({
  setup() {
    const palette = ref('ocean')
    const width = ref('standard')
    const size = ref('normal')
    const apply = () => {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      root.dataset.kbTheme = palette.value
      root.dataset.kbWidth = width.value
      root.dataset.kbSize = size.value
    }
    const save = () => {
      apply()
      try {
        localStorage.setItem('codescope-kb-theme', palette.value)
        localStorage.setItem('codescope-kb-width', width.value)
        localStorage.setItem('codescope-kb-size', size.value)
      } catch {}
    }
    onMounted(() => {
      try {
        const savedPalette = localStorage.getItem('codescope-kb-theme')
        const savedWidth = localStorage.getItem('codescope-kb-width')
        const savedSize = localStorage.getItem('codescope-kb-size')
        if (PALETTES.some(([value]) => value === savedPalette)) palette.value = savedPalette
        if (WIDTHS.some(([value]) => value === savedWidth)) width.value = savedWidth
        if (SIZES.some(([value]) => value === savedSize)) size.value = savedSize
      } catch {}
      apply()
    })
    const select = (label, model, options, onChange) => h('label', { class:'kb-reader-select', title:label }, [
      h('span', { class:'kb-reader-select-label' }, label),
      h('select', { 'aria-label':label, value:model.value, onChange }, options.map(([value, text]) => h('option', { value }, text)))
    ])
    return () => h('div', { class:'kb-reader-controls', 'aria-label':'阅读外观' }, [
      select('配色', palette, PALETTES, (event) => { palette.value = event.target.value; save() }),
      select('版心', width, WIDTHS, (event) => { width.value = event.target.value; save() }),
      select('字号', size, SIZES, (event) => { size.value = event.target.value; save() })
    ])
  }
})

/* 右下角的阅读浮标：阅读进度百分比 + 回到顶部。
   知识库里的文档动辄几千像素高（实测一篇 5300px），滚到一半想回顶部得一路划回去；
   顶部那条 2px 的进度线只能看个大概，给个准确数字更有用。 */
const ReadingHud = defineComponent({
  setup() {
    const progress = ref(0)
    const show = ref(false)
    const sync = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      progress.value = max > 40 ? Math.min(100, Math.max(0, Math.round(window.scrollY / max * 100))) : 0
      show.value = window.scrollY > 320
    }
    onMounted(() => { sync(); window.addEventListener('scroll', sync, { passive:true }); window.addEventListener('resize', sync) })
    onUnmounted(() => { window.removeEventListener('scroll', sync); window.removeEventListener('resize', sync) })
    return () => h('div', { class:'kb-hud' + (show.value ? ' on' : '') }, [
      h('span', { class:'kb-hud-pct', 'aria-hidden':'true' }, progress.value + '%'),
      h('button', {
        class:'kb-hud-top', type:'button', title:'回到顶部', 'aria-label':'回到顶部',
        onClick: () => window.scrollTo({ top:0, behavior:'smooth' })
      }, '↑')
    ])
  }
})

/* 从一段正文里认出「术语」。这类清单式笔记的写法是「术语：说明」，
   真正的结构写在这里，比看加粗可靠得多 —— 加粗有时候整句都加粗
   （**malloc 是 C 语言的库函数，只负责…**），有时候只加粗句子中间一个词
   （DFS 的核心是**递归**，它沿着…）。
   注意这里必须用 firstChild 而不是 firstElementChild：后者会跳过文本节点，
   于是「DFS 的核心是**递归**」这种段落的首个元素正好是那个 <strong>，
   会被误判成「以术语开头」。 */
function termLabel(paragraph) {
  const text = (paragraph.textContent || '').trim()
  const colon = text.search(/[：:]/)
  if (colon >= 2 && colon <= 20) {
    const head = text.slice(0, colon).trim()
    /* 注意 \\s 要写两个反斜杠：这段代码住在 JS 模板字符串里，
       单个 \s 是无效转义、反斜杠会被吃掉，正则就变成 [s…] —— 结果是
       「任何含字母 s 的术语都被过滤掉」（sizeof…、static… 就是这么丢的）。 */
    if (!/[\\s。，,；;、]/.test(head)) return head
  }
  /* 整句加粗的写法：取加粗开头的行内代码（开头是行内代码的加粗整句 → 那个代码名）或短词 */
  const first = paragraph.firstChild
  if (first && first.nodeType === 1 && first.tagName === 'STRONG') {
    const code = first.firstElementChild
    if (code && code.tagName === 'CODE') {
      const name = (code.textContent || '').trim()
      if (name.length >= 2 && name.length <= 20) return name
    }
    const bold = (first.textContent || '').trim()
    if (bold.length >= 2 && bold.length <= 16) return bold
  }
  return ''
}

/* 图片点击放大：笔记里的截图/示意图往往分辨率很高，正文里只有几百像素宽，
   看不清细节。点一下铺满全屏，再点一下或按 Esc 关掉。
   自己写而不是引 medium-zoom —— 只有这一件事要做，不值得为它加一个依赖。 */
const ImageZoom = defineComponent({
  setup() {
    const src = ref('')
    const alt = ref('')
    const close = () => { src.value = '' }
    const onKey = (event) => { if (event.key === 'Escape') close() }
    const bind = () => {
      for (const img of document.querySelectorAll('.vp-doc img')) {
        if (img.dataset.kbZoom) continue
        img.dataset.kbZoom = '1'
        img.classList.add('kb-zoomable')
        img.addEventListener('click', () => { src.value = img.currentSrc || img.src; alt.value = img.alt || '' })
      }
    }
    const schedule = () => { nextTick(bind); setTimeout(bind, 400) }
    onMounted(() => { schedule(); window.addEventListener('keydown', onKey) })
    onUnmounted(() => window.removeEventListener('keydown', onKey))
    const { page } = useData()
    watch(() => page.value.relativePath, schedule)
    return () => src.value
      ? h('div', { class:'kb-lightbox', onClick: close, role:'dialog', 'aria-label':'图片预览' }, [
          h('img', { src: src.value, alt: alt.value }),
          h('button', { class:'kb-lightbox-close', type:'button', title:'关闭（Esc）', 'aria-label':'关闭' }, '×')
        ])
      : null
  }
})

/* 阅读位置记忆：长文（实测一篇 5300px）关掉再开又要从头翻。
   按「滚动比例」而不是绝对像素存 —— 换字号/换窗口宽度后比例仍然对得上。
   只在没有 #锚点、且上次读到 5% 以上时才恢复，避免干扰正常跳转。 */
const ReadingPosition = defineComponent({
  setup() {
    const { page } = useData()
    const KEY = 'codescope-kb-scroll'
    let timer = 0
    const readMap = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch (_) { return {} } }
    const save = (immediate) => {
      clearTimeout(timer)
      const run = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        if (max <= 200) return
        const ratio = Math.max(0, Math.min(1, window.scrollY / max))
        try {
          const all = readMap()
          if (ratio > 0.02) all[location.pathname] = ratio; else delete all[location.pathname]
          localStorage.setItem(KEY, JSON.stringify(all))
        } catch (_) {}
      }
      if (immediate) run(); else timer = setTimeout(run, 400)
    }
    const restore = () => {
      if (location.hash) return
      const ratio = readMap()[location.pathname]
      if (!(ratio > 0.05)) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (max <= 200) return
      window.scrollTo({ top: Math.round(max * ratio) })
    }
    const onScroll = () => save(false)
    onMounted(() => {
      /* 正文异步挂上来，太早恢复时 scrollHeight 还是 0 */
      setTimeout(restore, 300)
      window.addEventListener('scroll', onScroll, { passive:true })
      window.addEventListener('beforeunload', () => save(true))
    })
    onUnmounted(() => { clearTimeout(timer); window.removeEventListener('scroll', onScroll) })
    watch(() => page.value.relativePath, () => { save(true); setTimeout(restore, 300) })
    return () => null
  }
})

/* 右栏兜底：文档整篇没有 h2/h3 时，VitePress 的大纲是空的，右栏就空着一条 ——
   三栏框看着就歪（用户报的「没在中间」其实是这个）。这类清单式笔记的结构其实
   写在正文里：每段都是「术语：说明」。把这些术语抽出来当「本页速览」，
   点一下滚到对应段落，右栏就有了和大纲等价的作用。
   有真大纲时整块隐藏，交给 VitePress 自己那份。 */
const MiniOutline = defineComponent({
  setup() {
    const { page } = useData()
    const items = ref([])
    let observer = null, timer = 0
    const collect = () => {
      if (document.querySelectorAll('.VPDocAsideOutline .outline-link').length) { items.value = []; return }
      const doc = document.querySelector('.vp-doc')
      if (!doc) { items.value = []; return }
      const found = [], seen = new Set()
      for (const paragraph of doc.querySelectorAll('p')) {
        const label = termLabel(paragraph)
        if (!label || seen.has(label)) continue
        seen.add(label)
        if (!paragraph.id) paragraph.id = 'kb-term-' + found.length
        found.push({ id: paragraph.id, label })
        if (found.length >= 60) break
      }
      /* 少于 4 条就不值得占一栏，宁可空着 */
      items.value = found.length >= 4 ? found : []
    }
    /* 正文是异步挂上来的，而且是长文：nextTick 或固定延时都可能只读到一半，
       结果就是靠后的术语漏掉（实测少了 2 条）。改成盯着 .vp-doc 的 DOM 变化重算。
       只观察 childList —— collect 里给段落补 id 属于属性变更，不会触发自己。 */
    const watchDoc = (attempt) => {
      const doc = document.querySelector('.vp-doc')
      if (!doc) { if (attempt < 20) setTimeout(() => watchDoc(attempt + 1), 120); return }
      if (observer) observer.disconnect()
      observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(collect, 100) })
      observer.observe(doc, { childList:true, subtree:true })
      collect()
    }
    const build = () => nextTick(() => watchDoc(0))
    onMounted(build)
    onUnmounted(() => { if (observer) observer.disconnect(); clearTimeout(timer) })
    watch(() => page.value.relativePath, build)
    return () => {
      if (!items.value.length) return null
      return h('nav', { class:'kb-mini-outline', 'aria-label':'本页速览' }, [
        h('div', { class:'kb-mini-title' }, '本页速览'),
        h('ul', null, items.value.map((item) => h('li', null, h('a', {
          href: '#' + item.id,
          onClick: (event) => {
            event.preventDefault()
            const target = document.getElementById(item.id)
            if (target) target.scrollIntoView({ behavior:'smooth', block:'start' })
          }
        }, item.label))))
      ])
    }
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
    'layout-bottom': () => [h(ReadingHud), h(MiniOutline), h(ImageZoom), h(ReadingPosition)],
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
  /* 正文实际用的宽度。桌面下就等于用户选的版心；超宽屏下会被放宽（见文件末尾的
     @media (min-width:1700px)）—— 900px 放在 2560 的屏幕上只占三分之一，
     长句和代码都会折行。所有跟正文宽度相关的规则都走这个变量，别直接用 --kb-content-width，
     否则侧栏定位、正文容器、网格列宽三处会各算各的、对不齐。 */
  --kb-content-max:var(--kb-content-width);
  --kb-radius:16px;
  --kb-page-glow:rgba(91,140,255,.09);
  --kb-doc-surface:color-mix(in srgb,var(--vp-c-bg-soft) 54%,var(--vp-c-bg));
  --kb-doc-border:color-mix(in srgb,var(--vp-c-brand-1) 14%,var(--vp-c-divider));
  --kb-heading:color-mix(in srgb,var(--vp-c-text-1) 94%,var(--vp-c-brand-1));
  font-synthesis:none;
}
/* CodeScope 阅读模块的行内标注：{红|文字} / ==文字==。
   色值直接抄自 index.html 里阅读器的定义，两处必须一致 —— 不然同一篇笔记
   在阅读器和站点里颜色不一样，等于又制造了一种「渲染不一致」。 */
.kb-fg-red { color:#f2555a; }
.kb-fg-orange { color:#f0883e; }
.kb-fg-yellow { color:#dcb13c; }
.kb-fg-green { color:#4bbd7a; }
.kb-fg-cyan { color:#3fb6c4; }
.kb-fg-blue { color:#5b9cf5; }
.kb-fg-purple { color:#a97bf0; }
.kb-fg-pink { color:#ef7bb0; }
.kb-fg-gray { color:#95a0ae; }
.kb-hl { padding:.02em .3em; border-radius:3px; color:inherit; background:color-mix(in srgb,#f2c14e 30%,transparent);
  box-shadow:inset 0 -.09em 0 color-mix(in srgb,#f2c14e 52%,transparent); }
html[data-kb-width="compact"] { --kb-content-width:760px; }
html[data-kb-width="standard"] { --kb-content-width:900px; }
html[data-kb-width="wide"] { --kb-content-width:1080px; }
/* 字号档位：正文和标题一起缩放（只放大正文会让标题显得越来越小） */
html[data-kb-size="small"] { --kb-font-scale:.93; }
html[data-kb-size="normal"] { --kb-font-scale:1; }
html[data-kb-size="large"] { --kb-font-scale:1.12; }
html[data-kb-size="huge"] { --kb-font-scale:1.26; }
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
  max-width:var(--kb-content-max)!important;
  padding:clamp(18px,2.5vw,34px) clamp(18px,3.4vw,46px) clamp(210px,38vh,430px);
}
.VPDoc .container { max-width:calc(var(--kb-content-max) + 380px)!important; }
.VPDoc .main { padding-top:22px; }
/* 文档里没有 h2/h3 时，右侧大纲栏会空着一条 200+px 的白条 —— 既浪费宽度又显得没做完。
   没有大纲就整条收掉，并把容器收窄让正文居中（有大纲时行为完全不变）。 */
html .VPDoc.VPDoc:not(:has(.VPDocAsideOutline.has-outline)) > .container.container > .aside.aside { display:none; }
html .VPDoc.VPDoc:not(:has(.VPDocAsideOutline.has-outline)) > .container.container { max-width:calc(var(--kb-content-max) + 80px)!important; }
.vp-doc { counter-reset:kb-h2;color:color-mix(in srgb,var(--vp-c-text-1) 89%,var(--vp-c-text-2));font-size:16px;line-height:1.82; }
.vp-doc > :first-child { margin-top:0; }
.vp-doc h1,.vp-doc h2,.vp-doc h3,.vp-doc h4 { color:var(--kb-heading);letter-spacing:-.025em;scroll-margin-top:90px; }
/* 标题文字用品牌色，和 CodeScope 阅读器对齐：那边 h1 = 品牌色 84% + 正文色、
   h2 = 纯品牌色、h3 = 品牌色 58% + 正文色（见 index.html 的 .ProseMirror h1/h2/h3）。
   站点原来各级标题一律近白色，同一篇笔记在阅读器和站点里标题颜色不一样，
   看起来就是「渲染不一致」。各级原有的装饰（h1 的渐变条、h2 的编号徽章、h3 的竖线）保留。 */
.vp-doc h1 { color:color-mix(in srgb,var(--vp-c-brand-1) 84%,var(--vp-c-text-1)); }
.vp-doc h2 { color:var(--vp-c-brand-1); }
.vp-doc h3 { color:color-mix(in srgb,var(--vp-c-brand-1) 58%,var(--vp-c-text-1)); }
.vp-doc h1 { margin-bottom:.72em;font-size:2.35rem;line-height:1.16; }
.vp-doc h1::after { content:'';display:block;width:44px;height:3px;margin-top:16px;border-radius:99px;background:linear-gradient(90deg,var(--vp-c-brand-1),transparent); }
/* 标题后第一段原来额外留 2.25em 下边距（所谓「导语」），结果全篇就它后面空一大截 ——
   用户看到的「行间距变了」就是这个：同一篇里段间距不均匀。
   现在统一成和普通段落一样的间距，整篇节奏一致（阅读器那边也是均匀的）。 */
.vp-doc h1 + p { max-width:760px;margin:0 0 14px;color:var(--vp-c-text-2);font-size:1.06em;line-height:1.86; }
.vp-doc h2 { counter-increment:kb-h2;display:flex;align-items:center;gap:11px;margin-top:2.55em;padding-top:1.05em;border-top:1px solid color-mix(in srgb,var(--vp-c-brand-1) 16%,var(--vp-c-divider));font-size:1.5rem; }
.vp-doc h2::before { content:counter(kb-h2,decimal-leading-zero);display:inline-grid;place-items:center;min-width:30px;height:24px;padding:0 5px;border:1px solid color-mix(in srgb,var(--vp-c-brand-1) 34%,var(--vp-c-divider));border-radius:7px;background:var(--vp-c-brand-soft);color:var(--vp-c-brand-1);font:750 11px/1 var(--vp-font-family-mono);letter-spacing:0; }
.vp-doc h3 { position:relative;margin-top:1.85em;padding-left:14px;font-size:1.16rem; }
.vp-doc h3::before { content:'';position:absolute;left:0;top:.42em;width:4px;height:1em;border-radius:99px;background:var(--vp-c-brand-1);box-shadow:0 0 12px var(--vp-c-brand-soft); }
/* 字号档位：标题用的是 rem（跟根字号走），所以只改 .vp-doc 的 font-size 标题不会跟着变，
   这里把正文和各级标题一起乘上 --kb-font-scale。 */
.vp-doc { font-size:calc(16px * var(--kb-font-scale,1)); }
.vp-doc h1 { font-size:calc(2.35rem * var(--kb-font-scale,1)); }
.vp-doc h2 { font-size:calc(1.5rem * var(--kb-font-scale,1)); }
.vp-doc h3 { font-size:calc(1.16rem * var(--kb-font-scale,1)); }
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
.vp-doc strong { color:color-mix(in srgb,var(--vp-c-brand-1) 56%,var(--vp-c-text-1));font-weight:720; }
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
/* 右下角阅读浮标：进度百分比 + 回到顶部（滚动 320px 后才出现，不打扰开头） */
.kb-hud { position:fixed;z-index:1001;right:26px;bottom:26px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;
  opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .22s var(--sp-ease,ease),transform .22s ease,visibility .22s; }
.kb-hud.on { opacity:1;visibility:visible;transform:none; }
.kb-hud-pct { padding:3px 10px;border:1px solid var(--vp-c-divider);border-radius:999px;color:var(--vp-c-text-2);
  background:color-mix(in srgb,var(--vp-c-bg-elv) 86%,transparent);font:650 11px/1.5 var(--vp-font-family-mono);
  font-variant-numeric:tabular-nums;backdrop-filter:blur(10px); }
.kb-hud-top { width:38px;height:38px;display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--vp-c-brand-1) 34%,var(--vp-c-divider));
  border-radius:50%;color:var(--vp-c-brand-1);background:color-mix(in srgb,var(--vp-c-bg-elv) 90%,transparent);
  font-size:16px;line-height:1;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,.22);backdrop-filter:blur(10px);
  transition:transform .16s,border-color .16s,background .16s; }
.kb-hud-top:hover { transform:translateY(-2px);border-color:var(--vp-c-brand-1);background:var(--vp-c-brand-soft); }
/* 右栏兜底「本页速览」：位置和三栏框的第三列对齐（左边缘 = 视口中心 + 正文半宽）。
   只在 ≥1320px 的三栏布局里出现，和侧栏一样是 fixed。 */
.kb-mini-outline { display:none; }
@media (min-width:1320px) {
  .kb-mini-outline {
    display:block;position:fixed;z-index:20;top:112px;
    left:calc(50vw + (var(--kb-content-max) / 2) + 32px);
    width:224px;max-height:calc(100vh - 180px);overflow:auto;
    padding-left:0;border-left:1px solid var(--vp-c-divider);
    scrollbar-width:thin;
  }
  .kb-mini-title { padding:0 0 10px 14px;color:var(--vp-c-text-1);font-size:12px;font-weight:700;letter-spacing:.02em; }
  .kb-mini-outline ul { margin:0;padding:0;list-style:none; }
  .kb-mini-outline li { margin:0; }
  .kb-mini-outline a {
    display:block;padding:5px 8px 5px 14px;border-radius:6px;
    color:var(--vp-c-text-2);font-size:12px;line-height:1.5;text-decoration:none;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    transition:color .15s,background .15s;
  }
  .kb-mini-outline a:hover { color:var(--vp-c-brand-1);background:var(--vp-c-brand-soft); }
}
/* 图片灯箱：正文里的图点一下铺满全屏 */
.vp-doc img.kb-zoomable { cursor:zoom-in; transition:opacity .15s; }
.vp-doc img.kb-zoomable:hover { opacity:.9; }
.kb-lightbox { position:fixed;z-index:2000;inset:0;display:flex;align-items:center;justify-content:center;
  padding:34px;cursor:zoom-out;background:color-mix(in srgb,var(--vp-c-bg) 88%,transparent);backdrop-filter:blur(6px); }
.kb-lightbox img { max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 30px 80px rgba(0,0,0,.5);cursor:default; }
.kb-lightbox-close { position:absolute;top:20px;right:24px;width:38px;height:38px;display:grid;place-items:center;
  border:1px solid var(--vp-c-divider);border-radius:50%;background:var(--vp-c-bg-elv);color:var(--vp-c-text-1);
  font-size:20px;line-height:1;cursor:pointer;transition:border-color .16s,color .16s; }
.kb-lightbox-close:hover { border-color:var(--vp-c-brand-1);color:var(--vp-c-brand-1); }
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
@media (min-width:1320px) {
  /* 三栏阅读框：左分类 / 中正文 / 右大纲，整体在页面里居中。
     正文宽度自适应 —— 把两侧栏（256×2）和一点边距让出来，剩下的给正文，
     上限跟版心设置成比例（再宽一行就太长）。
     注意必须写 :root 而不是 html：:root 的特异性比 html 高，
     写 html 的话这条会被上面 :root 里的基础定义压住、完全不生效。 */
  :root { --kb-content-max:clamp(560px, calc(100vw - 600px), min(calc(var(--kb-content-width) * 1.35), 1400px)); }
  /* 「无大纲收栏」那条规则的特异性比上面的网格规则高（:not(:has(...)) 会被算进特异性），
     不在这里再压一次的话，容器会被它卡在 content+80px，三列网格拿不到该有的宽度。 */
  html .VPDoc.VPDoc:not(:has(.VPDocAsideOutline.has-outline)) > .container.container { max-width:none!important; }
  html .VPSidebar.VPSidebar {
    top:64px;
    left:calc(50vw - (var(--kb-content-max) / 2) - 256px);
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
    grid-template-columns:256px minmax(640px,var(--kb-content-max)) 256px;
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
  .vp-doc { font-size:calc(15px * var(--kb-font-scale,1));line-height:1.82; }
  .vp-doc h1 { font-size:calc(1.82rem * var(--kb-font-scale,1)); }
  .vp-doc h2 { font-size:calc(1.32rem * var(--kb-font-scale,1)); }
  .kb-doc-context { align-items:flex-start;flex-direction:column;margin-bottom:28px; }
  .kb-doc-meta span:last-child { display:inline-flex; }
}
@media (prefers-reduced-motion:reduce) { .VPFeature,.VPSidebarItem .text,.VPDocAsideOutline .outline-link { transition:none; } }
`;

/* CodeScope 阅读模块有一套自己的行内标注语法，磁盘上原样落盘（见 index.html 的 MD_COLOR_KEYS）：
     {红|文字}  → 指定颜色文字，九色：红橙黄绿青蓝紫粉灰
     ==文字==   → 高亮
   以前只有 CodeScope 的阅读器认识它，生成的知识库站点会把 {红|…} 连花括号一起原样打出来 ——
   同一篇笔记两处渲染不一致。这里给 VitePress 补一个 markdown-it 插件，让站点用同一套语法、
   同一套配色。
   规则注册在 backticks 之后：行内代码先被吃掉，代码里的 {红|…} 或 == 不会被误伤。
   （markdown-it 的 text 规则本来就以 { 和 = 作为终止符，所以扫到这两个字符时一定会轮到本规则。） */
const KB_COLOR_SOURCE = `const COLORS = { 红:'red', 橙:'orange', 黄:'yellow', 绿:'green', 青:'cyan', 蓝:'blue', 紫:'purple', 粉:'pink', 灰:'gray' }
const KEYS = Object.keys(COLORS).join('')

function kbColorPlugin(md) {
  function rule(state, silent) {
    const src = state.src
    const start = state.pos
    const ch = src.charCodeAt(start)

    /* {红|文字} —— 0x7b 是 {，写成码点免得和外层模板字符串的花括号混淆 */
    if (ch === 0x7b) {
      const key = src[start + 1]
      if (!key || KEYS.indexOf(key) < 0 || src[start + 2] !== '|') return false
      const end = src.indexOf('}', start + 3)
      if (end < 0) return false
      const body = src.slice(start + 3, end)
      if (!body || body.indexOf('\\n') >= 0) return false
      if (!silent) {
        state.push('html_inline', '', 0).content =
          '<span class="kb-fg kb-fg-' + COLORS[key] + '">' + md.utils.escapeHtml(body) + '</span>'
      }
      state.pos = end + 1
      return true
    }

    /* ==文字== */
    if (ch === 0x3d && src.charCodeAt(start + 1) === 0x3d) {
      const end = src.indexOf('==', start + 2)
      if (end < 0) return false
      const body = src.slice(start + 2, end)
      if (!body || body.indexOf('\\n') >= 0 || body.indexOf('=') >= 0) return false
      if (!silent) {
        state.push('html_inline', '', 0).content = '<mark class="kb-hl">' + md.utils.escapeHtml(body) + '</mark>'
      }
      state.pos = end + 2
      return true
    }

    return false
  }
  md.inline.ruler.after('backticks', 'kb_color', rule)
}

export default kbColorPlugin
`;

/* 笔记写法示例：把知识库「已经支持」的写法列全。
   这份文档由生成器写出，和站点实际支持的能力绑在一起 ——
   改了主题/插件就顺手改这里，不会出现「文档说支持、其实早废了」。
   里面所有代码围栏都要写成 \`\`\`（外层是 JS 模板字符串，不转义会被截断）。 */
const SYNTAX_SOURCE = `---
title: 笔记写法示例
---

# 笔记写法示例

这份文档列出知识库里**已经支持**的写法。照着写，页面立刻就有「内容感」——
纯文字堆在一起是最容易显得空洞的。

## 一、文字标注

| 写法 | 效果 |
| --- | --- |
| \`{红|文字}\` | 指定颜色文字，九色：红 橙 黄 绿 青 蓝 紫 粉 灰 |
| \`==文字==\` | 黄底高亮 |

效果示例：函数指针 {红|指向函数的指针}，而 ==指针函数== 是「返回指针的函数」，别混。

## 二、提示框

用三个冒号包起来，适合写「补充说明 / 坑点 / 危险操作 / 可折叠的长内容」。

::: tip 小技巧
\`::: tip\` 用来写补充说明、经验之谈。
:::

::: warning 注意
\`::: warning\` 用来写容易踩的坑。
:::

::: danger 危险
\`::: danger\` 用来写「这么做会出事」的地方。
:::

::: details 点开看展开内容
\`::: details 标题\` 写可折叠内容，默认收起 —— 长代码、大段日志用它，正文就不会被撑得很长。
:::

## 三、代码块

**带文件名**：围栏后面用方括号写文件名。

**指定行高亮**：大括号里写行号，支持 \`2\`、\`2,5\`、\`2,5-7\`。

\`\`\`c{2,5-6} [main.c]
int main(void) {
    int *p = NULL;          // 这一行被高亮
    p = (int *)malloc(4);
    if (!p) return -1;
    *p = 42;                // 这两行也被高亮
    free(p);
    return 0;
}
\`\`\`

## 四、代码组（多语言 / 多方案对照）

同一件事的不同写法并排放，点标签切换：

::: code-group
\`\`\`c [指针常量]
int *const p = &a;   /* 指向不可改，值可改 */
\`\`\`
\`\`\`c [常量指针]
const int *p = &a;   /* 值不可改，指向可改 */
\`\`\`
:::

## 五、表格

| 概念 | 含义 |
| --- | --- |
| 指针常量 | 指针本身是常量，不能改指向 |
| 常量指针 | 指向的内容是常量，不能改值 |

## 六、徽章

给标题或条目加状态标记：<Badge type="tip" text="已验证" /> <Badge type="warning" text="待补充" /> <Badge type="danger" text="有坑" />

## 七、引用与分割线

> 引用一段原文、标准里的描述，或者别人的说法 —— 和自己的想法区分开。

---

## 八、暂时**不要**用的写法

这两条会让构建失败或渲染成乱码，等装了插件再说：

- **脚注**：写成 \`[^1]\` 会**直接报死链、整个站点构建失败**（不是静默忽略，很坑）。
- **任务列表**：写成 \`- [ ]\` 会原样渲染成字面的 \`[ ]\`，不会变成勾选框。

## 九、写笔记的一点建议

1. **术语用加粗或标注**：正文里 \`**术语**\` 会被自动收进右侧「本页速览」，长文才有导航。
2. **一段一个点**：每段以「术语：说明」开头，右侧速览就会自动成目录。
3. **能画就别写**：内存布局、继承关系、调用链，一张图胜过十行字。
4. **代码块带文件名和行高亮**：回头再看时，一眼知道在说哪一行。
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
  let buildPromise = null, timer = null, watcher = null, poller = null, observedSourceTime = 0, observedSourceCount = -1, buildChild = null;

  function ensure() {
    const root = sourceDir();
    fs.mkdirSync(root, { recursive:true });
    writeIfMissing(path.join(root, '.codescope-folder.json'), JSON.stringify({ version:1, description:'VitePress 自动生成的长期 Markdown 知识库', updatedAt:Date.now() }, null, 2) + '\n');
    const legacyProjectMeta=path.join(root,'.codescope-project.json');
    if(fs.existsSync(legacyProjectMeta))try{const legacy=JSON.parse(fs.readFileSync(legacyProjectMeta,'utf8'));if(legacy&&legacy.description==='VitePress 自动生成的长期 Markdown 知识库')fs.unlinkSync(legacyProjectMeta);}catch(_){}
    const legacyGuide = path.join(root, '快速开始', '知识库使用指南.md');
    const guideProject = path.join(root, '快速开始', '使用指南');
    const guideFile = path.join(guideProject, '知识库使用指南.md');
    fs.mkdirSync(guideProject, { recursive:true });
    if (fs.existsSync(legacyGuide) && !fs.existsSync(guideFile)) fs.renameSync(legacyGuide, guideFile);
    if (fs.existsSync(legacyGuide) && fs.existsSync(guideFile)) {
      try { if (fs.readFileSync(legacyGuide, 'utf8') === fs.readFileSync(guideFile, 'utf8')) fs.unlinkSync(legacyGuide); } catch (_) {}
    }
    writeManaged(guideFile, GUIDE_SOURCE);
    writeManaged(path.join(guideProject, '笔记写法示例.md'), SYNTAX_SOURCE);
    writeIfMissing(path.join(guideProject, KNOWLEDGE_PROJECT_META), JSON.stringify({ version:1, description:'CodeScope 知识库的结构与使用说明', tags:['指南'], updatedAt:Date.now() }, null, 2) + '\n');
    /* index.md 必须在指南写完之后再生成：它要扫一遍站点内容挑第一篇文档 */
    writeManaged(path.join(root, 'index.md'), homeSource(root));
    /* 这两个文件必须叫 .mjs，不能改名成 .js —— 实测过：
       · VitePress 找配置的顺序是 ["js","ts","mjs","mts"]，所以 .vitepress/config.js 会
         盖住 config.mjs；但 .js 在 Node 里默认按 CommonJS 处理，而 vitepress 是 ESM-only，
         结果是构建直接失败（"vitepress resolved to an ESM file, cannot be loaded by require"）。
         也就是说 config.js 不是「优先级更高」，是「一加就崩」。
       · 主题入口走 Vite 的模块解析（@theme 指向 theme/ 目录），Vite 默认扩展名顺序
         .mjs 在前，所以 theme/index.js 永远输给 theme/index.mjs（实测两个都在时用的是 .mjs，
         只留 .js 时才生效）。
       结论：这里生成的文件就是唯一入口，任何改动都要改这个生成器，不要去 .vitepress 里手改 ——
       那些文件每次构建都会被 writeManaged 重写。 */
    writeManaged(path.join(root, '.vitepress', 'config.mjs'), configSource());
    writeManaged(path.join(root, '.vitepress', 'kb-color.mjs'), KB_COLOR_SOURCE);
    writeManaged(path.join(root, '.vitepress', 'theme', 'index.mjs'), THEME_SOURCE);
    writeManaged(path.join(root, '.vitepress', 'theme', 'custom.css'), THEME_CSS);
    /* *.sync-conflict-* 是 iCloud 的冲突副本：生成器每次构建都会重写这几个文件，
       而 vault 又在 iCloud 里，同步和写入撞上就会生出一份 config.sync-conflict-…。
       它们是垃圾，但会污染 git status，直接忽略掉。 */
    writeManaged(path.join(root, '.gitignore'), '.vitepress/cache/\n.vitepress/node_modules\n*.sync-conflict-*\n');
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

  /* 统一的源目录遍历：跳过依赖目录，符号链接不计入（构建用的 node_modules 软链是每台机器自己的）。 */
  function knowledgeWalk(directory, visit, prefix = '') {
    let entries = []; try { entries = fs.readdirSync(directory, { withFileTypes:true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || (entry.name === 'cache' && path.basename(directory) === '.vitepress')) continue;
      const full = path.join(directory, entry.name), rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) knowledgeWalk(full, visit, rel);
      else visit(rel, full, entry);
    }
  }
  /* Syncthing 会保留文件原始 mtime：一个新文件完全可能"很久以前被修改过"。
     只用 mtime 判断"要不要重建"会整批漏掉这类新文件，所以签名里必须带上文件集合与大小。 */
  function sourceSignature() {
    const rows = [];
    knowledgeWalk(ensure(), (rel, full, entry) => {
      if (entry.isSymbolicLink()) return;
      try { const stat = fs.statSync(full); rows.push(rel + '\0' + stat.size + '\0' + Math.round(stat.mtimeMs)); } catch (_) {}
    });
    rows.sort();
    return require('crypto').createHash('sha1').update(rows.join('\n')).digest('hex');
  }
  function sourceFileCount() {
    let count = 0;
    knowledgeWalk(ensure(), (_rel, _full, entry) => { if (!entry.isSymbolicLink()) count += 1; });
    return count;
  }
  function buildStateFile() { return path.join(dataRoot, 'knowledge', 'build-state.json'); }
  function readBuildState() { try { const value = JSON.parse(fs.readFileSync(buildStateFile(), 'utf8')); return value && typeof value === 'object' ? value : {}; } catch (_) { return {}; } }
  function writeBuildState(value) { try { fs.mkdirSync(path.dirname(buildStateFile()), { recursive:true }); fs.writeFileSync(buildStateFile(), JSON.stringify(value, null, 2) + '\n', 'utf8'); } catch (_) {} }

  function status() {
    const pages = pageRecords(), assets = assetCount(), built = fs.existsSync(path.join(distDir(), 'index.html'));
    let displayState = state;
    if (built && state.phase === 'idle') {
      let finishedAt=0; try { finishedAt=fs.statSync(path.join(distDir(), 'index.html')).mtimeMs; } catch (_) {}
      displayState={ ...state, phase:'ready', message:'知识库已就绪', finishedAt };
    }
    return { ok:true, engine:'VitePress', engineVersion:require('vitepress/package.json').version, sourceDir:sourceDir(), distDir:distDir(), url:'/knowledge/', pages, pageCount:pages.length, assetCount:assets.count, assetBytes:assets.bytes, built, ...displayState };
  }

  /* status() 会做 statSync / require 版本号 / 目录遍历，任何一步抛错都不该让
     构建结束回调里的未捕获异常把整个工作台带崩；所有回调统一走这个安全包装。 */
  function statusSafe() {
    try { return status(); }
    catch (error) { return { ok:false, error:String((error && error.message) || error) }; }
  }

  function build(reason = 'manual') {
    ensure();
    if (buildPromise) { state.pending = true; return buildPromise; }
    clearTimeout(timer); timer = null;
    const startedAt = Date.now();
    state = { ...state, phase:'building', message:'正在生成知识库…', startedAt, error:'', pending:false, reason };
    const bin = path.join(projectRoot, 'node_modules', 'vitepress', 'bin', 'vitepress.js');
    const targetDir=distDir(),parentDir=path.dirname(targetDir),stagingDir=path.join(parentDir,'.site-build-'+process.pid+'-'+startedAt),backupDir=path.join(parentDir,'.site-previous-'+process.pid);
    fs.mkdirSync(parentDir, { recursive:true });
    try { fs.rmSync(stagingDir, { recursive:true, force:true }); } catch (_) {}
    buildPromise = new Promise((resolve) => {
      const child = spawn(process.execPath, [bin, 'build', sourceDir(), '--outDir', stagingDir], { cwd:projectRoot, env:{ ...process.env, NO_COLOR:'1' }, stdio:['ignore','pipe','pipe'] });
      buildChild = child;
      // 看门狗：vitepress 遇到坏 Markdown/循环引用会挂住不退出，原实现没有任何超时，
      // 于是一直停留在“正在生成知识库…”且 buildPromise 永不结算（之后每次保存都只是排队）。
      const watchdog = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
      }, KNOWLEDGE_BUILD_TIMEOUT_MS);
      watchdog.unref?.();
      const clearWatchdog = () => { clearTimeout(watchdog); if (buildChild === child) buildChild = null; };
      let output = '';
      const add = (chunk) => { output = (output + chunk.toString()).slice(-12000); };
      child.stdout.on('data', add); child.stderr.on('data', add);
      child.once('error', (error) => {
        clearWatchdog();
        try { fs.rmSync(stagingDir, { recursive:true, force:true }); } catch (_) {}
        const finishedAt=Date.now(); state={ ...state, phase:'error', message:'知识库生成失败', error:String(error.message||error), finishedAt, durationMs:finishedAt-startedAt }; buildPromise=null; resolve(statusSafe());
      });
      child.once('exit', (code) => {
        clearWatchdog();
        const finishedAt = Date.now();let ok = code === 0 && fs.existsSync(path.join(stagingDir, 'index.html')),swapError='';
        if(ok){
          let movedCurrent=false;
          try{
            fs.rmSync(backupDir,{recursive:true,force:true});
            if(fs.existsSync(targetDir)){fs.renameSync(targetDir,backupDir);movedCurrent=true;}
            fs.renameSync(stagingDir,targetDir);
          }catch(error){
            ok=false;swapError='发布新站点失败：'+String(error.message||error);
            try{if(movedCurrent&&!fs.existsSync(targetDir)&&fs.existsSync(backupDir))fs.renameSync(backupDir,targetDir);}catch(restoreError){swapError+='；恢复上一版本失败：'+String(restoreError.message||restoreError);}
            try{fs.rmSync(stagingDir,{recursive:true,force:true});}catch(_){}
          }
          if(ok)try{fs.rmSync(backupDir,{recursive:true,force:true});}catch(_){}
        }else try{fs.rmSync(stagingDir,{recursive:true,force:true});}catch(_){}
        state = { ...state, phase:ok?'ready':'error', message:ok?'知识库已更新':'知识库生成失败（已保留上一版本）', error:ok?'':(swapError||output.trim().slice(-4000)), finishedAt, durationMs:finishedAt-startedAt };
        // 持久化构建签名：进程重启后依然能发现「产物与源不一致」，并让失败可以自动重试。
        if (ok) writeBuildState({ signature:sourceSignature(), builtAt:finishedAt, finishedAt, ok:true });
        else { const previous=readBuildState(); writeBuildState({ signature:previous.signature||'', builtAt:previous.builtAt||0, finishedAt, ok:false, error:String(state.error||'').slice(0,500) }); }
        buildPromise = null; const again = state.pending; state.pending = false; resolve(statusSafe()); if (again) schedule('pending');
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
    observedSourceCount=sourceFileCount();
    const savedState=readBuildState(), signature=sourceSignature();
    // 除了 mtime，还要比「内容签名」和「上次构建是否失败」：
    // 前者捕捉 Syncthing 送来的、保留旧 mtime 的新文件；后者让失败能自动重试而不是永久卡在旧产物上。
    if (!builtAt || observedSourceTime > builtAt + 10 || savedState.signature !== signature || savedState.ok === false) schedule('startup', 100);
    try {
      watcher = fs.watch(sourceDir(), { recursive:true }, (_event, file) => {
        const rel = String(file || '').replace(/\\/g, '/');
        if (!rel || rel === '.vitepress' || rel.startsWith('.vitepress/') || /(^|\/)\.DS_Store$/.test(rel)) return;
        schedule('watch');
      });
      watcher.on('error', () => { try { watcher.close(); } catch (_) {} watcher=null; });
    } catch (_) {}
    // 轮询常开（不再只在 fs.watch 建立失败时才开）：15 秒看一次「最新 mtime + 文件数」，
    // 任一变化即重建；上次构建失败则每 2 分钟自动重试，直至成功——避免失败后永久停在旧产物上。
    poller=setInterval(()=>{
      try {
        const next=newestSourceModified(), count=sourceFileCount();
        if (next>observedSourceTime+1 || count!==observedSourceCount){ observedSourceTime=next; observedSourceCount=count; schedule('watch-poll'); return; }
        const last=readBuildState();
        if (last.ok === false && Date.now() - Number(last.finishedAt || 0) > 120000) schedule('retry-after-error');
      } catch (_) {}
    },15000);
    poller.unref?.();
  }

  function stop() {
    clearTimeout(timer); timer=null; clearInterval(poller); poller=null;
    try { watcher?.close(); } catch (_) {} watcher=null;
    // 退出时必须带走正在跑的构建子进程，否则它会变成孤儿继续占用 CPU 与 node_modules。
    try { buildChild?.kill('SIGKILL'); } catch (_) {} buildChild=null;
  }

  function createPage(input) {
    ensure(); let rel = safeRelative(input && input.path, { extension:MARKDOWN_EXTENSIONS });
    if (!rel || rel.split('/').length < 3) throw new Error('文档路径不合法，请使用“分类/项目/文档名称.md”');
    const target = path.resolve(sourceDir(), rel), root = path.resolve(sourceDir());
    if (!target.startsWith(root + path.sep) || fs.existsSync(target)) throw new Error(fs.existsSync(target) ? '同名知识库文档已存在' : '文档路径不合法');
    if (!fs.existsSync(path.join(path.dirname(target), KNOWLEDGE_PROJECT_META))) throw new Error('请先创建知识项目，Markdown 片段只能建在项目中');
    const title = String(input && input.title || path.basename(rel, path.extname(rel))).trim().slice(0, 160) || '未命名文档';
    fs.mkdirSync(path.dirname(target), { recursive:true });
    writeFileAtomicSync(target, `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n\n开始记录……\n`, 'utf8');
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
    writeFileAtomicSync(path.join(target, KNOWLEDGE_PROJECT_META), JSON.stringify({ version:1, description, tags, updatedAt:Date.now() }, null, 2) + '\n', 'utf8');
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
    fs.mkdirSync(path.dirname(target), { recursive:true }); writeFileAtomicSync(target, body); schedule('upload-image');
    const url = '/images/' + rel.split('/').map(encodeURIComponent).join('/');
    return { ok:true, path:'images/' + rel, url, markdown:`![图片说明](${url})`, type };
  }

  return { folderName:KNOWLEDGE_FOLDER, sourceDir, distDir, ensure, status, build, schedule, start, stop, createPage, createFolder, createProject, saveImage };
}

module.exports = { createKnowledgeBase, KNOWLEDGE_FOLDER };
