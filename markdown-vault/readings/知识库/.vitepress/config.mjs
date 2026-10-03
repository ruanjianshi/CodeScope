import { defineConfig } from 'vitepress'
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
    const meta = /^---\s*\n([\s\S]*?)\n---/.exec(source)
    const title = meta && /^title:\s*["']?(.+?)["']?\s*$/m.exec(meta[1])
    if (title) return title[1].trim()
    const heading = /^#\s+(.+)$/m.exec(source)
    if (heading) return heading[1].replace(/\s+#+\s*$/, '').trim()
  } catch {}
  return fallback
}
function pageLink(relative) {
  const clean = relative.replace(/\\/g, '/').replace(/(?:^|\/)index\.md$/i, '').replace(/\.md$/i, '')
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
    } else if (/\.md$/i.test(entry.name) && relative.toLowerCase() !== 'index.md') {
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
      else if (/\.md$/i.test(entry.name) && relative.toLowerCase() !== 'index.md') {
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
