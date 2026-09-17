import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
