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
    'doc-before': () => h(DocContext),
    'nav-bar-content-after': () => h('div', { class:'kb-nav-extras' }, [
      h(ReaderControls),
      h('a', { class:'codescope-return', href:'/' }, '返回 CodeScope')
    ])
  })
}
