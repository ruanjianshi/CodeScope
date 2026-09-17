import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark'
import { TextSelection } from '@milkdown/kit/prose/state'
import { insert } from '@milkdown/kit/utils'
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

const looksLikeMarkdown = (value) => {
  const text = String(value || '').replace(/\r\n?/g, '\n')
  if (!text.includes('\n')) return false
  return [
    /^#{1,6}[ \t]+\S/m,
    /^ {0,3}(?:[-*+]\s+|\d+[.)]\s+|>\s+|```|~~~)/m,
    /^ {0,3}[-*+]\s+\[[ xX]\]\s+/m,
    /^\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/m,
    /!\[[^\]]*\]\([^\n)]+\)|\[[^\]]+\]\([^\n)]+\)/,
  ].some((pattern) => pattern.test(text))
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

const BLOCK_TRANSFORM_GROUPS = [
  {
    label: '基础区块',
    items: [
      ['text', '正文', 'T'], ['h1', '一级标题', 'H1'], ['h2', '二级标题', 'H2'],
      ['h3', '三级标题', 'H3'], ['h4', '四级标题', 'H4'], ['h5', '五级标题', 'H5'],
      ['h6', '六级标题', 'H6'], ['quote', '引用', '❝'], ['divider', '分割线', '―'],
    ],
  },
  {
    label: '列表',
    items: [
      ['bullet-list', '无序列表', '•'], ['ordered-list', '有序列表', '1.'], ['task-list', '任务列表', '☑'],
    ],
  },
  {
    label: '高级区块',
    items: [['code', '代码块', '</>'], ['math', '公式', '∑']],
  },
]

const selectBlockAtHandle = (ctx, root, handle, preferredBlock) => {
  const view = ctx.get(editorViewCtx)
  const editor = root.querySelector('.ProseMirror')
  if (!editor) return false
  const centerY = handle.getBoundingClientRect().top + handle.getBoundingClientRect().height / 2
  const blocks = [...editor.children].filter((node) => {
    const rect = node.getBoundingClientRect()
    return centerY >= rect.top - 2 && centerY <= rect.bottom + 2
  })
  const block = (preferredBlock?.isConnected && editor.contains(preferredBlock) ? preferredBlock : null) || blocks.sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect()
    return Math.abs((ar.top + ar.bottom) / 2 - centerY) - Math.abs((br.top + br.bottom) / 2 - centerY)
  })[0]
  if (!block) return false
  let contentPos
  try { contentPos = view.posAtDOM(block, 0) } catch (_) { return false }
  const candidates = [contentPos - 1, contentPos].filter((pos) => pos >= 0 && pos <= view.state.doc.content.size)
  const pos = candidates.find((candidate) => view.state.doc.nodeAt(candidate)?.isBlock)
  if (typeof pos !== 'number') return false
  const near = Math.max(0, Math.min(view.state.doc.content.size, pos + 1))
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(near))))
  view.focus()
  return pos
}

const runBlockTransform = (crepe, type, targetPos) => {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const node = typeof targetPos === 'number' ? view.state.doc.nodeAt(targetPos) : null
    if (node && ['text', 'code', 'math'].includes(type)) {
      const nodeType = type === 'text' ? paragraphSchema.type(ctx) : codeBlockSchema.type(ctx)
      view.dispatch(view.state.tr.setNodeMarkup(targetPos, nodeType, type === 'math' ? { language: 'LaTeX' } : {}))
      return
    }
    if (node && /^h[1-6]$/.test(type)) {
      view.dispatch(view.state.tr.setNodeMarkup(targetPos, headingSchema.type(ctx), { level: Number(type.slice(1)) }))
      return
    }
    const commands = ctx.get(commandsCtx)
    commands.call(clearTextInCurrentBlockCommand.key)
    if (type === 'text') return commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) })
    if (/^h[1-6]$/.test(type)) return commands.call(setBlockTypeCommand.key, {
      nodeType: headingSchema.type(ctx), attrs: { level: Number(type.slice(1)) },
    })
    if (type === 'quote') return commands.call(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) })
    if (type === 'bullet-list') return commands.call(wrapInBlockTypeCommand.key, { nodeType: bulletListSchema.type(ctx) })
    if (type === 'ordered-list') return commands.call(wrapInBlockTypeCommand.key, { nodeType: orderedListSchema.type(ctx) })
    if (type === 'task-list') return commands.call(wrapInBlockTypeCommand.key, {
      nodeType: listItemSchema.type(ctx), attrs: { checked: false },
    })
    if (type === 'code' || type === 'math') return commands.call(setBlockTypeCommand.key, {
      nodeType: codeBlockSchema.type(ctx), attrs: type === 'math' ? { language: 'LaTeX' } : {},
    })
    if (type === 'divider') return commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) })
  })
}

const attachBlockTransformMenu = (crepe, root) => {
  let activeBlock = null
  let targetPos = null
  const menu = document.createElement('div')
  menu.className = 'codescope-block-transform-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', '转换区块类型')
  menu.hidden = true
  menu.innerHTML = `<div class="title">转换为</div>${BLOCK_TRANSFORM_GROUPS.map((group) => `
    <section><h6>${group.label}</h6><div class="items">${group.items.map(([type, label, icon]) => `
      <button type="button" role="menuitem" data-block-type="${type}"><span class="icon">${icon}</span><span>${label}</span></button>
    `).join('')}</div></section>`).join('')}`
  document.body.appendChild(menu)

  const hide = () => { menu.hidden = true; delete menu.dataset.show }
  const show = (handle) => {
    crepe.editor.action((ctx) => { targetPos = selectBlockAtHandle(ctx, root, handle, activeBlock) })
    const rect = handle.getBoundingClientRect()
    const width = 292
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right + 8))
    const top = Math.min(window.innerHeight - 520, Math.max(12, rect.top - 8))
    Object.assign(menu.style, { left: `${left}px`, top: `${Math.max(12, top)}px` })
    menu.hidden = false
    menu.dataset.show = 'true'
  }
  const onPointerUp = (event) => {
    const item = event.target instanceof Element ? event.target.closest('.milkdown-block-handle .operation-item:nth-child(2)') : null
    if (!item || !root.contains(item)) return
    event.preventDefault()
    event.stopPropagation()
    show(item.closest('.milkdown-block-handle'))
  }
  const onMenuPointerDown = (event) => event.preventDefault()
  const onMenuClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-block-type]') : null
    if (!button) return
    runBlockTransform(crepe, button.dataset.blockType, targetPos)
    hide()
  }
  const rememberActiveBlock = (event) => {
    const editor = root.querySelector('.ProseMirror')
    if (!editor || !(event.target instanceof Element) || !editor.contains(event.target)) return
    let block = event.target
    while (block && block.parentElement !== editor) block = block.parentElement
    if (block?.parentElement === editor) activeBlock = block
  }
  const onDocumentPointerDown = (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !(event.target instanceof Element && event.target.closest('.milkdown-block-handle'))) hide()
  }
  const onKeyDown = (event) => { if (event.key === 'Escape') hide() }
  root.addEventListener('pointerup', onPointerUp, true)
  root.addEventListener('pointermove', rememberActiveBlock, true)
  root.addEventListener('mouseover', rememberActiveBlock, true)
  menu.addEventListener('pointerdown', onMenuPointerDown)
  menu.addEventListener('click', onMenuClick)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    root.removeEventListener('pointerup', onPointerUp, true)
    root.removeEventListener('pointermove', rememberActiveBlock, true)
    root.removeEventListener('mouseover', rememberActiveBlock, true)
    menu.removeEventListener('pointerdown', onMenuPointerDown)
    menu.removeEventListener('click', onMenuClick)
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    menu.remove()
  }
}

async function create(options = {}) {
  const root = options.root
  if (!root) throw new Error('缺少区块编辑器挂载节点')
  root.classList.add('codescope-crepe-host')
  let ready = false
  let destroyed = false
  let lastMarkdown = String(options.markdown || '')
  let frontmatter = splitFrontmatter(lastMarkdown)
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
  const onPaste = (event) => {
    if (!ready || destroyed || !(event.target instanceof Element) || !event.target.closest('.ProseMirror')) return
    const clipboard = event.clipboardData
    const text = clipboard?.getData('text/plain') || ''
    if (!looksLikeMarkdown(text)) return
    event.preventDefault()
    event.stopPropagation()
    const pasted = splitFrontmatter(text.replace(/\r\n?/g, '\n'))
    const editorIsEmpty = !crepe.getMarkdown().trim()
    if (editorIsEmpty && pasted.prefix) frontmatter = pasted
    crepe.editor.action(insert(toEditorMarkdown(pasted.body)))
    root.dispatchEvent(new CustomEvent('codescope-markdown-paste', {
      bubbles: true,
      detail: { markdown: pasted.body },
    }))
  }
  root.addEventListener('click', onClick)
  root.addEventListener('paste', onPaste, true)
  await crepe.create()
  const detachBlockTransformMenu = attachBlockTransformMenu(crepe, root)
  ready = true
  root.dataset.editorReady = 'true'
  return {
    getMarkdown: () => frontmatter.prefix + fromEditorMarkdown(crepe.getMarkdown()),
    focus: () => root.querySelector('.ProseMirror')?.focus(),
    destroy: async () => {
      if (destroyed) return
      destroyed = true
      root.removeEventListener('click', onClick)
      root.removeEventListener('paste', onPaste, true)
      detachBlockTransformMenu()
      delete root.dataset.editorReady
      await crepe.destroy()
      root.replaceChildren()
    },
  }
}

window.CodeScopeBlockEditor = { create, toEditorMarkdown, fromEditorMarkdown, looksLikeMarkdown }
