import { Crepe, CrepeFeature } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'

const REFERENCE_RE = /\[\[(pdf-ref|code-ref|note-ref):([^\]]+)\]\]/g
const REFERENCE_LINK_RE = /\[([^\]]*)\]\(#codescope-ref-([A-Za-z0-9_-]+)\)/g

const utf8ToBase64Url = (value) => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlToUtf8 = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const referenceLabel = (token) => {
  const separator = token.lastIndexOf('|')
  return separator >= 0 ? token.slice(separator + 1, -2) : '打开引用'
}

const toEditorMarkdown = (markdown) => String(markdown || '').replace(REFERENCE_RE, (token) => {
  const label = referenceLabel(token).replace(/([\\\[\]])/g, '\\$1')
  return `[${label}](#codescope-ref-${utf8ToBase64Url(token)})`
})

const fromEditorMarkdown = (markdown) => String(markdown || '').replace(REFERENCE_LINK_RE, (_link, _label, encoded) => {
  try { return base64UrlToUtf8(encoded) } catch (_) { return _link }
})

const splitFrontmatter = (markdown) => {
  const value = String(markdown || '')
  const match = value.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  return match ? { prefix: match[0], body: value.slice(match[0].length) } : { prefix: '', body: value }
}

const blockEditConfig = {
  textGroup: {
    label: '基础区块',
    text: { label: '正文' },
    h1: { label: '一级标题' },
    h2: { label: '二级标题' },
    h3: { label: '三级标题' },
    h4: { label: '四级标题' },
    h5: { label: '五级标题' },
    h6: { label: '六级标题' },
    quote: { label: '引用' },
    divider: { label: '分割线' },
  },
  listGroup: {
    label: '列表',
    bulletList: { label: '无序列表' },
    orderedList: { label: '有序列表' },
    taskList: { label: '任务列表' },
  },
  advancedGroup: {
    label: '高级区块',
    image: { label: '图片' },
    codeBlock: { label: '代码块' },
    table: { label: '表格' },
    math: { label: '公式' },
  },
}

async function create(options = {}) {
  const root = options.root
  if (!root) throw new Error('缺少区块编辑器挂载节点')
  root.classList.add('codescope-crepe-host')
  let ready = false
  let destroyed = false
  let lastMarkdown = String(options.markdown || '')
  const frontmatter = splitFrontmatter(lastMarkdown)
  const crepe = new Crepe({
    root,
    defaultValue: toEditorMarkdown(frontmatter.body),
    features: { [CrepeFeature.TopBar]: true },
    featureConfigs: {
      [CrepeFeature.Placeholder]: { text: '输入 / 插入区块；拖动左侧手柄调整顺序…', mode: 'block' },
      [CrepeFeature.BlockEdit]: blockEditConfig,
    },
  })
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      if (!ready || destroyed) return
      const next = frontmatter.prefix + fromEditorMarkdown(markdown)
      if (next === lastMarkdown) return
      lastMarkdown = next
      options.onChange?.(next)
    })
    listener.focus(() => options.onFocus?.())
    listener.blur(() => options.onBlur?.())
  })
  const onClick = (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href^="#codescope-ref-"]') : null
    if (!anchor) return
    event.preventDefault()
    event.stopPropagation()
    const encoded = anchor.getAttribute('href')?.slice('#codescope-ref-'.length) || ''
    try { options.onReference?.(base64UrlToUtf8(encoded), anchor) } catch (_) {}
  }
  root.addEventListener('click', onClick)
  await crepe.create()
  ready = true
  root.dataset.editorReady = 'true'
  return {
    getMarkdown: () => frontmatter.prefix + fromEditorMarkdown(crepe.getMarkdown()),
    focus: () => root.querySelector('.ProseMirror')?.focus(),
    destroy: async () => {
      if (destroyed) return
      destroyed = true
      root.removeEventListener('click', onClick)
      delete root.dataset.editorReady
      await crepe.destroy()
      root.replaceChildren()
    },
  }
}

window.CodeScopeBlockEditor = { create, toEditorMarkdown, fromEditorMarkdown }
