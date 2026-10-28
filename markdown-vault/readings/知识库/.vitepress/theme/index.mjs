import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import './custom.css'

const PALETTES = [
  ['ocean', '海洋蓝'],
  ['forest', '森林绿'],
  ['violet', '暮光紫'],
  ['paper', '暖纸棕'],
  ['everforest', '暖绿森林']
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
    const palette = ref('everforest')   /* 默认暖绿森林；用户在右上角「配色」里改过则以本地存储为准 */
    const width = ref('standard')
    const size = ref('normal')
    let darkBefore = null   /* 选「暖绿森林」前的明暗状态，切走时还原（见 apply） */
    const apply = () => {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      root.dataset.kbTheme = palette.value
      root.dataset.kbWidth = width.value
      root.dataset.kbSize = size.value
      /* ★「暖绿森林」是**固定的深色主题**（背景 #2D353B），必须同时挂 .dark ——
         否则 VitePress 会按亮色渲染导航栏、搜索框、侧栏这些原生组件，
         深色正文配亮色边框，比不做还难看。
         但不能简单 classList.add('dark')：那样用户切回海洋蓝时会一直停在暗色。
         所以先记下切换前的状态，离开时还原。 */
      if (palette.value === 'everforest') {
        if (darkBefore === null) darkBefore = root.classList.contains('dark')
        root.classList.add('dark')
      } else if (darkBefore !== null) {
        root.classList.toggle('dark', darkBefore)
        darkBefore = null
      }
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
    /* ⚠️ 光给 <select> 传 value 不够 ✗ —— 选项是同时渲染的，DOM 建好后
       浏览器按「第一个 option 没写 selected」就选它，下拉框会一直显示「海洋蓝」，
       而实际生效的是 default（暖绿森林），用户看着以为没生效。所以每个 option
       也要显式写 selected。 */
    const select = (label, model, options, onChange) => h('label', { class:'kb-reader-select', title:label }, [
      h('span', { class:'kb-reader-select-label' }, label),
      h('select', { 'aria-label':label, value:model.value, onChange },
        options.map(([value, text]) => h('option', { value, selected: value === model.value }, text)))
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
/* 侧栏宽度手柄 ✓（2026-10-12 加，用户：「左侧大纲和正文之间需要可以自由左右拖动」）
   ⚠️ 为什么做成**独立组件**而不是改 VitePress 布局 ✗：
     默认主题的侧栏是 position:fixed + --vp-sidebar-width ✓，
     动它的结构风险大 ✗；只改**一个 CSS 变量**最稳 ✓（见 custom.css 的覆盖 ✓）。
   ⚠️ 拖拽用 **pointer 事件 + setPointerCapture** ✓ —— 鼠标划出窗口也不会丢 ✓
     （用 mousemove 挂在 window 上，快速拖到屏幕外就会断 ✓）。
   ⚠️ 宽度**落盘** ✓（localStorage ✓）—— 用户调一次就该记住 ✓。 */
const SidebarResizer = defineComponent({
  setup() {
    const KEY = 'codescope-kb-sidebar-w'
    const MIN = 200, MAX = 560, DEFAULT = 272
    /* 拖到多宽算「离谱」✓（2026-10-28 加）——
       超宽屏（≥1320px）里侧栏是 grid 的第一列 ✓，左右两列各占侧栏宽、
       中间正文最小 640、两侧余量共 88 ⇒ 侧栏再宽就会把正文挤没 / 把三栏框挤出视口 ✗。
       另外不允许超过视口 40% ✓（用户一拖就把正文挤没，同样是破版 ✗）。
       ⚠️ 非三栏区间（<1320px）不套这个上限 ✓ —— 那里是 padding 让位，
          侧栏宽一点只是正文窄一点，不会破版 ✓。 */
    const widthCap = () => {
      if (typeof window === 'undefined') return MAX
      if (window.innerWidth < 1320) return MAX
      return Math.max(MIN, Math.min(MAX, Math.floor(window.innerWidth * 0.4), Math.floor((window.innerWidth - 640 - 88) / 2)))
    }
    const el = ref(null)
    let dragging = false
    const setW = (w) => {
      const v = Math.max(MIN, Math.min(widthCap(), Math.round(w)))
      if (typeof document === 'undefined') return v
      document.documentElement.style.setProperty('--kb-sidebar-w', v + 'px')
      /* ⚠️⚠️ **行内 + !important** ✗✗ —— VitePress 的侧栏样式是 scoped 的
         （.VPSidebar[data-v-xxxx] ✓），和我们的规则**同为 !important** 时它靠优先级赢 ✗
         （实测：规则明明在 CSS 里、变量也改了，侧栏宽度纹丝不动 ✗）。
         行内 important 是**唯一一定赢**的写法 ✓。 */
      document.querySelectorAll('.VPSidebar').forEach((el) => {
        try { el.style.setProperty('width', v + 'px', 'important') } catch (_) {}
      })
      document.querySelectorAll('.VPContent.has-sidebar').forEach((el) => {
        try {
          /* ⚠️ 三栏区间（≥1320px）里正文靠 grid 居中 ✓ —— 行内 padding-left 会把三栏框顶偏 ✗
             （实测：留着 272px 行内 padding，正文中心偏 136px ✓）。
             所以那里必须**移除**行内 padding，交给
             @media(max-width:1319.98px) 那条 CSS 在窄屏负责让位 ✓。 */
          if (typeof window !== 'undefined' && window.innerWidth >= 1320) el.style.removeProperty('padding-left')
          else el.style.setProperty('padding-left', v + 'px', 'important')
        } catch (_) {}
      })
      place()
      return v
    }
    /* 把拖拽条摆到侧栏**真实右边缘** ✓ —— 侧栏起点不一定在 0（实测偏 44px ✓），
       所以要用 getBoundingClientRect 实测 ✓，不能靠 left:var(--kb-sidebar-w) ✗。 */
    const place = () => {
      if (typeof document === 'undefined') return
      const sb = document.querySelector('.VPSidebar')
      const h = document.querySelector('.kb-sidebar-resizer')
      if (!sb || !h) return
      const r = sb.getBoundingClientRect()
      if (r.width < 1) return
      h.style.setProperty('left', Math.round(r.right) + 'px', 'important')
    }
    /* ⚠️ 宽度必须按**位移增量**算，不能按「指针位置 − 侧栏左边缘」算 ✗✗（2026-10-28 修）——
       超宽屏（≥1320px）里侧栏左边缘本身是「框左 = 50vw − 正文/2 − 侧栏宽」（会随宽度反向移动 ✓），
       用绝对位置算就成了正反馈：每动一次宽度涨一次偏差量 ✗
       （实测：在 4500px 上想把 272 拖到 332，松手变成 552 ✗）。
       增量映射则与布局无关、无反馈 ✓：按下时记住起点宽度，之后 w = 起点宽度 + 指针位移 ✓。 */
    let startW = 0, startX = 0
    const onDown = (e) => {
      /* 窄屏（侧栏是抽屉）不参与 ✓ */
      if (typeof window === 'undefined' || window.innerWidth < 960) return
      startX = e.clientX
      startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--kb-sidebar-w'), 10) || DEFAULT
      dragging = true
      if (el.value && el.value.setPointerCapture) { try { el.value.setPointerCapture(e.pointerId) } catch {} }
      if (el.value) el.value.classList.add('kb-dragging')
      document.body.classList.add('kb-resizing')
      e.preventDefault()
    }
    const onMove = (e) => {
      if (!dragging) return
      /* 宽度 = 按下时的宽度 + 指针位移 ✓（增量映射，和侧栏左边缘怎么动无关 ✓） */
      setW(startW + (e.clientX - startX))
      e.preventDefault()
    }
    const onUp = (e) => {
      if (!dragging) return
      dragging = false
      if (el.value) el.value.classList.remove('kb-dragging')
      document.body.classList.remove('kb-resizing')
      try { localStorage.setItem(KEY, String(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--kb-sidebar-w'), 10) || DEFAULT)) } catch {}
      if (el.value && el.value.releasePointerCapture) { try { el.value.releasePointerCapture(e.pointerId) } catch {} }
    }
    const onReset = () => { setW(DEFAULT); try { localStorage.setItem(KEY, String(DEFAULT)) } catch {} }
    onMounted(() => {
      try {
        const saved = parseInt(localStorage.getItem(KEY) || '', 10)
        setW(saved >= MIN && saved <= MAX ? saved : DEFAULT)
      } catch (_) { setW(DEFAULT) }
      setTimeout(place, 60); setTimeout(place, 600)
      /* 视口变窄时（比如 4500 拖到 1300）之前存下的宽度可能已超出新的 widthCap ✓
         → 必须重新钳一次，否则三栏框会被挤出屏幕 ✗（CSS 那边等宽变量也不会自己收 ✓） */
      window.addEventListener('resize', () => {
        setW(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--kb-sidebar-w'), 10) || DEFAULT)
        place()
      })
    })
    return () => h('div', {
      ref: el,
      class: 'kb-sidebar-resizer',
      title: '拖动调整左侧栏宽度（双击复位）',
      onPointerdown: onDown,
      onPointermove: onMove,
      onPointerup: onUp,
      onPointercancel: onUp,
      onDblclick: onReset
    })
  }
})

/* 左侧目录**默认折叠** ✓（用户：「左侧的目录需要默认是折叠的，不要全部展开」）
   ⚠️ VitePress 的侧栏折叠是 **Vue 状态** ✗ —— 光写 CSS 藏起来的话
      「展开」按钮就点不动了 ✗。所以这里**模拟一次点击** ✓：
      进入页面后把**顶层**（.level-0）的可折叠项点一下 → 收起来 ✓。
   ⚠️ 只在**首次进入**做 ✓（用 sessionStorage 记 ✓）——
      用户自己展开过之后，翻页不该再给他收回去 ✗。 */
const SidebarCollapse = defineComponent({
  setup() {
    const KEY = 'codescope-kb-sidebar-collapsed'
    const run = () => {
      if (typeof document === 'undefined') return
      try { if (sessionStorage.getItem(KEY) === '1') return; sessionStorage.setItem(KEY, '1') } catch (_) {}
      document.querySelectorAll('.VPSidebarItem.level-0.collapsible > .item').forEach((el) => {
        /* aria-expanded=true 才需要收 ✓（VitePress 默认是展开的 ✓） */
        const item = el.closest('.VPSidebarItem')
        if (item && item.querySelector(':scope > .items') && el.getAttribute('aria-expanded') !== 'false') {
          try { el.click() } catch (_) {}
        }
      })
    }
    onMounted(() => { setTimeout(run, 120); setTimeout(run, 900) })
    return () => null
  }
})

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
    'layout-bottom': () => [h(SidebarResizer), h(SidebarCollapse), h(ReadingHud), h(MiniOutline), h(ImageZoom), h(ReadingPosition)],
    'doc-before': () => h(DocContext),
    'nav-bar-content-after': () => h('div', { class:'kb-nav-extras' }, [
      h(ReaderControls),
      h('a', { class:'codescope-return', href:'/' }, '返回 CodeScope')
    ])
  })
}
