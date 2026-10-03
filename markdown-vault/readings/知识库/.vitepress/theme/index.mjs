import DefaultTheme from 'vitepress/theme'
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
    /* 注意 \s 要写两个反斜杠：这段代码住在 JS 模板字符串里，
       单个 s 是无效转义、反斜杠会被吃掉，正则就变成 [s…] —— 结果是
       「任何含字母 s 的术语都被过滤掉」（sizeof…、static… 就是这么丢的）。 */
    if (!/[\s。，,；;、]/.test(head)) return head
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
        .replace(/\\/g, '/')
        .replace(/\.(?:md|markdown)$/i, '')
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
      const chinese = (text.match(/[㐀-鿿]/g) || []).length
      const latin = (text.replace(/[㐀-鿿]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
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
