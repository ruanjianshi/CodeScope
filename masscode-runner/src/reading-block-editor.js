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
  linkSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark'
import { TextSelection } from '@milkdown/kit/prose/state'
import { Fragment } from '@milkdown/kit/prose/model'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import { insert } from '@milkdown/kit/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'

const REFERENCE_RE = /\[\[(pdf-ref|code-ref|note-ref):([^\]]+)\]\]/g
const REFERENCE_LINK_RE = /\[([^\]]*)\]\(#codescope-ref-([A-Za-z0-9_-]+)\)/g
const TABLE_LAYOUT_RE = /(?:\r?\n)*<!--\s*codescope-table-layout:([A-Za-z0-9_-]+)\s*-->\s*$/

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

const splitTableLayout = (markdown) => {
  const value = String(markdown || '')
  const match = value.match(TABLE_LAYOUT_RE)
  if (!match) return { body:value, widths:[] }
  try {
    const decoded = JSON.parse(base64UrlToUtf8(match[1]))
    const widths = Array.isArray(decoded) ? decoded.map((row) => Array.isArray(row)
      ? row.map(Number).filter((width) => Number.isFinite(width) && width > 0)
      : []) : []
    return { body:value.slice(0, match.index).replace(/\s+$/, ''), widths }
  } catch (_) {
    return { body:value.slice(0, match.index).replace(/\s+$/, ''), widths:[] }
  }
}

const withTableLayout = (markdown, widths) => {
  const body = String(markdown || '').replace(TABLE_LAYOUT_RE, '').replace(/\s+$/, '')
  const hasWidths = widths.some((row) => Array.isArray(row) && row.length > 1)
  if (!hasWidths) return body
  return `${body}\n\n<!-- codescope-table-layout:${utf8ToBase64Url(JSON.stringify(widths))} -->\n`
}

const attachTableColumnResizers = (root, getWidths, onWidthsChange) => {
  let frame = 0
  let destroyed = false
  let active = null

  const normalize = (values) => {
    const total = values.reduce((sum, value) => sum + value, 0) || 1
    return values.map((value) => Math.round((value / total) * 10000) / 10000)
  }

  const renderColumns = (block, table, widths) => {
    let colgroup = table.querySelector(':scope > colgroup[data-codescope-columns]')
    if (!colgroup) {
      colgroup = document.createElement('colgroup')
      colgroup.dataset.codescopeColumns = 'true'
      table.insertBefore(colgroup, table.firstChild)
    }
    while (colgroup.children.length < widths.length) colgroup.appendChild(document.createElement('col'))
    while (colgroup.children.length > widths.length) colgroup.lastElementChild?.remove()
    ;[...colgroup.children].forEach((column, index) => { column.style.width = `${widths[index] * 100}%` })
    table.classList.add('codescope-table-fixed')
    block.dataset.codescopeWidths = widths.join(',')
  }

  const positionHandles = (block, table, handles) => {
    const row = table.rows[0]
    if (!row) return
    const blockRect = block.getBoundingClientRect()
    const tableRect = table.getBoundingClientRect()
    handles.forEach((handle, index) => {
      const cell = row.cells[index]
      if (!cell) return
      const cellRect = cell.getBoundingClientRect()
      handle.style.left = `${cellRect.right - blockRect.left + block.scrollLeft}px`
      handle.style.top = `${tableRect.top - blockRect.top + block.scrollTop + 10}px`
      handle.style.height = `${Math.max(24, tableRect.height - 20)}px`
    })
  }

  const install = (block, table, tableIndex) => {
    const count = table.rows[0]?.cells.length || 0
    if (count < 2) return
    const stored = getWidths()[tableIndex]
    const measured = [...table.rows[0].cells].map((cell) => Math.max(1, cell.getBoundingClientRect().width))
    const widths = normalize(stored?.length === count ? stored : measured)
    renderColumns(block, table, widths)

    let layer = block.querySelector(':scope > .codescope-table-resizers')
    if (!layer) {
      layer = document.createElement('div')
      layer.className = 'codescope-table-resizers'
      layer.setAttribute('aria-hidden', 'true')
      block.appendChild(layer)
    }
    while (layer.children.length < count - 1) {
      const handle = document.createElement('div')
      handle.className = 'codescope-table-resizer'
      handle.title = '拖动调整列宽'
      layer.appendChild(handle)
    }
    while (layer.children.length > count - 1) layer.lastElementChild?.remove()
    const handles = [...layer.children]
    handles.forEach((handle, index) => {
      handle.dataset.column = String(index)
      handle.onpointerdown = (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const current = normalize(String(block.dataset.codescopeWidths || '').split(',').map(Number))
        const tableWidth = Math.max(1, table.getBoundingClientRect().width)
        active = { block, table, tableIndex, index, startX:event.clientX, tableWidth, widths:current }
        handle.setPointerCapture?.(event.pointerId)
        block.classList.add('is-resizing-columns')
      }
    })
    positionHandles(block, table, handles)
  }

  const refresh = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (destroyed) return
      const live = new Set()
      root.querySelectorAll('.milkdown-table-block').forEach((block, tableIndex) => {
        // Crepe keeps a second, empty table for its drag preview. Only the
        // `.children` table owns the editable rows and column boundaries.
        const table = block.querySelector('.table-wrapper > table.children')
        if (!table) return
        live.add(block)
        install(block, table, tableIndex)
      })
      root.querySelectorAll('.codescope-table-resizers').forEach((layer) => {
        if (!live.has(layer.parentElement)) layer.remove()
      })
    })
  }

  const onPointerMove = (event) => {
    if (!active) return
    event.preventDefault()
    const { block, table, index, startX, tableWidth } = active
    const next = [...active.widths]
    const minimum = Math.min(.22, 72 / tableWidth)
    const delta = (event.clientX - startX) / tableWidth
    const pairTotal = next[index] + next[index + 1]
    next[index] = Math.max(minimum, Math.min(pairTotal - minimum, active.widths[index] + delta))
    next[index + 1] = pairTotal - next[index]
    active.next = normalize(next)
    renderColumns(block, table, active.next)
    positionHandles(block, table, [...block.querySelectorAll('.codescope-table-resizer')])
  }

  const onPointerUp = () => {
    if (!active) return
    const { block, tableIndex } = active
    block.classList.remove('is-resizing-columns')
    if (active.next) {
      const widths = getWidths().map((row) => [...row])
      widths[tableIndex] = active.next
      onWidthsChange(widths)
    }
    active = null
  }

  const resizeObserver = new ResizeObserver(refresh)
  resizeObserver.observe(root)
  root.addEventListener('scroll', refresh, true)
  window.addEventListener('pointermove', onPointerMove, { passive:false })
  window.addEventListener('pointerup', onPointerUp)
  refresh()
  return {
    refresh,
    destroy: () => {
      destroyed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      root.removeEventListener('scroll', refresh, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    },
  }
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

const deleteBlockAt = (crepe, targetPos) => {
  if (typeof targetPos !== 'number') return
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const node = view.state.doc.nodeAt(targetPos)
    if (!node?.isBlock) return
    let transaction = view.state.tr.delete(targetPos, Math.min(view.state.doc.content.size, targetPos + node.nodeSize))
    if (!transaction.doc.childCount) transaction = transaction.insert(0, paragraphSchema.type(ctx).create())
    const nextPos = Math.max(0, Math.min(transaction.doc.content.size, targetPos))
    transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(nextPos)))
    view.dispatch(transaction)
    view.focus()
  })
}

const attachBlockTransformMenu = (crepe, root, options = {}) => {
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
    `).join('')}</div></section>`).join('')}
    <section><h6>媒体</h6><div class="items">
      <button type="button" role="menuitem" data-block-action="image" ${typeof options.onInsertImages === 'function' ? '' : 'disabled'} title="${typeof options.onInsertImages === 'function' ? '从电脑选择并插入图片' : '此文档暂不支持图片上传'}"><span class="icon">▧</span><span>插入图片</span></button>
    </div></section>
    <section class="block-actions"><h6>区块操作</h6><div class="items">
      <button type="button" role="menuitem" class="danger" data-block-action="delete"><span class="icon">⌫</span><span>删除区块</span></button>
    </div></section>`
  const imageInput = document.createElement('input')
  imageInput.type = 'file'
  imageInput.accept = 'image/png,image/jpeg,image/gif,image/webp'
  imageInput.multiple = true
  imageInput.hidden = true
  menu.appendChild(imageInput)
  document.body.appendChild(menu)

  const hide = () => { menu.hidden = true; delete menu.dataset.show }
  const show = (handle) => {
    crepe.editor.action((ctx) => { targetPos = selectBlockAtHandle(ctx, root, handle, activeBlock) })
    const rect = handle.getBoundingClientRect()
    const width = 292
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right + 8))
    menu.hidden = false
    menu.dataset.show = 'true'
    const menuHeight = Math.min(menu.offsetHeight, window.innerHeight - 24)
    const top = Math.min(window.innerHeight - menuHeight - 12, Math.max(12, rect.top - 8))
    Object.assign(menu.style, { left: `${left}px`, top: `${Math.max(12, top)}px` })
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
    const button = event.target instanceof Element ? event.target.closest('[data-block-type],[data-block-action]') : null
    if (!button) return
    if (button.dataset.blockType) runBlockTransform(crepe, button.dataset.blockType, targetPos)
    if (button.dataset.blockAction === 'image' && !button.disabled) imageInput.click()
    if (button.dataset.blockAction === 'delete') deleteBlockAt(crepe, targetPos)
    hide()
  }
  const onImageChange = () => {
    const files = [...(imageInput.files || [])]
    imageInput.value = ''
    if (!files.length || typeof options.onInsertImages !== 'function') return
    void options.onInsertImages(files, targetPos)
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
  imageInput.addEventListener('change', onImageChange)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    root.removeEventListener('pointerup', onPointerUp, true)
    root.removeEventListener('pointermove', rememberActiveBlock, true)
    root.removeEventListener('mouseover', rememberActiveBlock, true)
    menu.removeEventListener('pointerdown', onMenuPointerDown)
    menu.removeEventListener('click', onMenuClick)
    imageInput.removeEventListener('change', onImageChange)
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    menu.remove()
  }
}

/* ── 文字颜色 / 背景高亮 ──
   编辑器里留不住自定义标签（实测 <mark>、<span> 都会被 ProseMirror 重绘抹掉），能原样保留的只有「链接」。
   所以颜色统一编码成 [文字](#cc-fg-red)、高亮编码成 [文字](#cc-hl)，由 index.html 里那套 CSS 按 href 上色；
   进出编辑器时再由 mdSyntaxToEditor / mdSyntaxFromEditor 正反转换，磁盘上落盘的仍然是 {红|文字} 和 ==文字==。
   这里只负责「把选区包上正确的链接 mark」，语法本身一个字都不动。 */
const COLOR_ITEMS = [
  { key:'red', label:'红', value:'#f2555a' },
  { key:'orange', label:'橙', value:'#f0883e' },
  { key:'yellow', label:'黄', value:'#dcb13c' },
  { key:'green', label:'绿', value:'#4bbd7a' },
  { key:'cyan', label:'青', value:'#3fb6c4' },
  { key:'blue', label:'蓝', value:'#5b9cf5' },
  { key:'purple', label:'紫', value:'#a97bf0' },
  { key:'pink', label:'粉', value:'#ef7bb0' },
  { key:'gray', label:'灰', value:'#95a0ae' },
]
const COLOR_HREF_PREFIX = '#cc-'
const HIGHLIGHT_HREF = '#cc-hl'
const HIGHLIGHT_VALUE = '#f2c14e'

/* 只认 #cc- 开头的链接 mark：用户自己写的真链接必须原样留着，绝不能被一次上色顺手拆掉。 */
const isColorMark = (mark) => mark.type.name === 'link' && String(mark.attrs.href || '').startsWith(COLOR_HREF_PREFIX)

const colorHrefAtSelection = (crepe) => crepe.editor.action((ctx) => {
  const { state } = ctx.get(editorViewCtx)
  const { from, to, empty, $from } = state.selection
  if (empty) {
    const mark = $from.marks().find(isColorMark)
    return mark ? mark.attrs.href : null
  }
  let found = null
  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false
    const mark = node.marks.find(isColorMark)
    if (mark) found = mark.attrs.href
    return undefined
  })
  return found
})

/* 上色前先把范围内已有的颜色 mark 清掉：否则反复上色会叠成
   [[文字](#cc-fg-red)](#cc-fg-blue) 这种谁都解析不了的 markdown。
   文字色与背景高亮共用同一条链接，所以两者互斥 —— 选一个会替换掉另一个，「清除」则两个都去掉。 */
const applyColorHref = (crepe, href) => {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const { from, to, empty } = state.selection
    if (empty) return
    const markType = linkSchema.type(ctx)
    const stale = new Set()
    state.doc.nodesBetween(from, to, (node) => {
      for (const mark of node.marks) {
        if (mark.type === markType && String(mark.attrs.href || '').startsWith(COLOR_HREF_PREFIX)) stale.add(mark)
      }
    })
    let transaction = state.tr
    for (const mark of stale) transaction = transaction.removeMark(from, to, mark)
    if (href) transaction = transaction.addMark(from, to, markType.create({ href }))
    view.dispatch(transaction)
    view.focus()
  })
}

const attachColorControls = (crepe, root, options = {}) => {
  const topBar = root.querySelector('.milkdown-top-bar')
  if (!topBar) return () => {}
  /* 摘录是宿主（阅读模块）的能力，知识库的区块编辑器不传就没有这个按钮 —— 浮条本身不知道摘录是什么。 */
  const canExcerpt = typeof options.onExcerpt === 'function'
  const swatch = (item) => `<button type="button" data-href="#cc-fg-${item.key}" title="${item.label}色文字" aria-label="${item.label}色文字"><i style="background:${item.value}"></i></button>`

  const group = document.createElement('div')
  group.className = 'codescope-color-group'
  const textButton = document.createElement('button')
  textButton.type = 'button'
  textButton.className = 'top-bar-item codescope-color-trigger'
  textButton.title = '文字颜色'
  textButton.setAttribute('aria-label', '文字颜色')
  textButton.setAttribute('aria-haspopup', 'true')
  textButton.setAttribute('aria-expanded', 'false')
  textButton.innerHTML = '<span class="codescope-color-glyph">A<i class="bar"></i></span>'
  const markButton = document.createElement('button')
  markButton.type = 'button'
  markButton.className = 'top-bar-item codescope-color-trigger'
  markButton.title = '背景高亮（==文字==）'
  markButton.setAttribute('aria-label', '背景高亮')
  markButton.innerHTML = '<span class="codescope-color-glyph is-mark">▮</span>'
  group.append(textButton, markButton)
  /* 挂在 .milkdown-top-bar 下、而不是 Vue 渲染的 .top-bar-inner 里：inner 由 Crepe 的 Vue 组件托管，
     每次顶栏刷新都可能被 diff 掉；挂在容器下则完全在我们的控制里。
     先清掉同层的旧色板：连续切换模式时旧实例可能把自己的色板挂进了这一份顶栏，
     不去重就会出现两排一模一样的按钮。 */
  for (const stale of topBar.querySelectorAll(':scope > .codescope-color-group')) stale.remove()
  topBar.appendChild(group)

  const panel = document.createElement('div')
  panel.className = 'codescope-color-menu'
  panel.hidden = true
  panel.setAttribute('role', 'menu')
  panel.setAttribute('aria-label', '文字颜色与背景高亮')
  panel.innerHTML = `<div class="title">文字颜色</div><div class="swatches">${COLOR_ITEMS.map(swatch).join('')}</div>
    <div class="title">背景</div><div class="swatches"><button type="button" data-href="${HIGHLIGHT_HREF}" title="背景高亮" aria-label="背景高亮"><i class="hl"></i></button></div>
    <button type="button" class="clear" data-href="">清除颜色与高亮</button>`
  document.body.appendChild(panel)

  /* 选中文字后浮出的快捷色板：不占顶栏位置，改色时眼睛不用来回跳。 */
  const bar = document.createElement('div')
  bar.className = 'codescope-color-bar'
  bar.hidden = true
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', '文字颜色与背景高亮')
  bar.innerHTML = `${COLOR_ITEMS.map(swatch).join('')}<span class="sep"></span>
    <button type="button" data-href="${HIGHLIGHT_HREF}" title="背景高亮" aria-label="背景高亮"><i class="hl"></i></button>
    <button type="button" class="clear" data-href="" title="清除颜色与高亮" aria-label="清除颜色与高亮">⌫</button>${canExcerpt ? '<span class="sep"></span><button type="button" class="excerpt" title="把选中的正文保存为摘录（写进标注文件，不改原文）" aria-label="摘录">✂ 摘录</button>' : ''}`
  document.body.appendChild(bar)

  let frame = 0
  const syncActive = () => {
    const href = colorHrefAtSelection(crepe)
    for (const host of [panel, bar]) {
      for (const button of host.querySelectorAll('button[data-href]')) button.classList.toggle('active', !!href && button.dataset.href === href)
    }
    const item = href && href.startsWith('#cc-fg-') ? COLOR_ITEMS.find((entry) => href === '#cc-fg-' + entry.key) : null
    textButton.classList.toggle('is-on', !!item)
    textButton.style.setProperty('--cc-swatch', item ? item.value : 'transparent')
    markButton.classList.toggle('is-on', href === HIGHLIGHT_HREF)
  }
  const hidePanel = () => { panel.hidden = true; delete panel.dataset.show; textButton.setAttribute('aria-expanded', 'false') }
  const hideBar = () => { bar.hidden = true; delete bar.dataset.show }
  const hideAll = () => { hidePanel(); hideBar() }
  const openPanel = () => {
    hideBar()
    panel.hidden = false
    panel.dataset.show = 'true'
    textButton.setAttribute('aria-expanded', 'true')
    syncActive()
    const rect = textButton.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight
    const left = Math.min(window.innerWidth - width - 10, Math.max(10, rect.left - 8))
    const top = Math.min(window.innerHeight - height - 10, Math.max(10, rect.bottom + 8))
    Object.assign(panel.style, { left: `${left}px`, top: `${top}px` })
  }
  const crepeToolbar = root.querySelector('.milkdown-toolbar')
  /* 点过「摘录」之后要把浮条收起来。但选区还在编辑器里，下一轮 positionBar 会立刻把它弹回来，
     所以需要一个只由「选区真的变了」来解除的压制标记。 */
  let suppressBar = false
  const positionBar = () => {
    frame = 0
    if (suppressBar) return hideBar()
    if (!root.isConnected) return hideBar()
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return hideBar()
    const range = selection.getRangeAt(0), editor = root.querySelector('.ProseMirror')
    if (!editor || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return hideBar()
    const rects = range.getClientRects()
    const rect = rects.length ? rects[0] : range.getBoundingClientRect()
    if (!rect || (!rect.width && !rect.height)) return hideBar()
    bar.hidden = false
    bar.dataset.show = 'true'
    syncActive()
    const width = bar.offsetWidth, height = bar.offsetHeight
    /* Crepe 自己也有一条 .milkdown-toolbar（粗体 / 斜体 / 删除线 / 行内代码 / 行内公式 / 链接）浮在选区上方。
       它 z-index 180、我们 265，若照原样浮到同一个位置就会把它整条盖住 ——
       用户看到的就是「怎么只剩颜色工具条了」。所以它出现时我们让到它正上方（同一中轴），
       它不在（源码模式、代码块等）时再回到选区上方。 */
    const crepeBox = crepeToolbar && crepeToolbar.dataset.show === 'true' ? crepeToolbar.getBoundingClientRect() : null
    const anchor = crepeBox && crepeBox.height ? crepeBox : rect
    const left = Math.min(window.innerWidth - width - 10, Math.max(10, anchor.left + anchor.width / 2 - width / 2))
    let top = anchor.top - height - 8
    if (top < 10) top = Math.min(window.innerHeight - height - 10, anchor.bottom + 8)
    Object.assign(bar.style, { left: `${left}px`, top: `${Math.max(10, top)}px` })
  }
  const scheduleBar = () => { if (!frame) frame = requestAnimationFrame(positionBar) }
  /* Crepe 的位置是它自己算的，可能落在我们的 rAF 之后。跟着它动，别让它跑回来压住我们、也别被我们压住。 */
  let toolbarObserver = null
  if (crepeToolbar && typeof MutationObserver === 'function') {
    toolbarObserver = new MutationObserver(() => { if (!bar.hidden) scheduleBar() })
    toolbarObserver.observe(crepeToolbar, { attributes: true, attributeFilter: ['style', 'data-show'] })
  }

  /* pointerdown 一律 preventDefault：否则点色板会先把编辑器里的选区弄丢，等于没得可上色。 */
  const onSwatchPointerDown = (event) => event.preventDefault()
  const onSwatchClick = (host) => (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-href]') : null
    if (!button) return
    applyColorHref(crepe, button.dataset.href || '')
    if (host === panel) hidePanel()
    syncActive()
  }
  const onTextButton = () => { if (panel.hidden) openPanel(); else hidePanel() }
  const onMarkButton = () => {
    applyColorHref(crepe, colorHrefAtSelection(crepe) === HIGHLIGHT_HREF ? '' : HIGHLIGHT_HREF)
    hideAll()
    syncActive()
  }
  const onDocumentPointerDown = (event) => {
    if (panel.hidden) return
    const target = event.target
    if (target instanceof Element && (panel.contains(target) || group.contains(target))) return
    hidePanel()
  }
  const onExcerptButton = () => {
    if (!canExcerpt) return
    suppressBar = true
    hideBar()
    Promise.resolve(options.onExcerpt()).catch(() => {})
  }
  const onSelectionChange = () => { suppressBar = false; if (!panel.hidden) syncActive(); scheduleBar() }
  const onKeyDown = (event) => { if (event.key === 'Escape') hideAll() }
  const onScroll = () => hideBar()

  panel.addEventListener('pointerdown', onSwatchPointerDown)
  panel.addEventListener('click', onSwatchClick(panel))
  bar.addEventListener('pointerdown', onSwatchPointerDown)
  bar.addEventListener('click', onSwatchClick(bar))
  textButton.addEventListener('pointerdown', onSwatchPointerDown)
  textButton.addEventListener('click', onTextButton)
  markButton.addEventListener('pointerdown', onSwatchPointerDown)
  markButton.addEventListener('click', onMarkButton)
  /* 注意 pointerdown 已被整条 bar 的 onSwatchPointerDown preventDefault 兜住，
     所以点「摘录」不会先把编辑器里的选区弄丢。 */
  const excerptButton = bar.querySelector('button.excerpt')
  if (excerptButton) excerptButton.addEventListener('click', onExcerptButton)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('keydown', onKeyDown, true)
  root.addEventListener('scroll', onScroll, true)

  return () => {
    if (frame) cancelAnimationFrame(frame)
    if (toolbarObserver) { toolbarObserver.disconnect(); toolbarObserver = null }
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('keydown', onKeyDown, true)
    root.removeEventListener('scroll', onScroll, true)
    /* 只摘掉仍挂在自己身上的色板：竞态里被淘汰的那次挂载，它的色板可能已经被新实例去重掉了，
       这时再 remove() 只会误伤新实例（同层只有一个色板，但归属已经换人）。 */
    if (group.parentElement) group.remove()
    panel.remove()
    bar.remove()
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
  const tableLayout = splitTableLayout(frontmatter.body)
  frontmatter.body = tableLayout.body
  let tableWidths = tableLayout.widths
  const composeMarkdown = (markdown) => frontmatter.prefix + withTableLayout(fromEditorMarkdown(markdown), tableWidths)
  const crepe = new Crepe({
    root,
    defaultValue: toEditorMarkdown(tableLayout.body),
    features: { [CrepeFeature.TopBar]: true },
    featureConfigs: {
      [CrepeFeature.Placeholder]: { text: '输入 / 插入区块；拖动左侧手柄调整顺序…', mode: 'block' },
      [CrepeFeature.BlockEdit]: blockEditConfig,
      [CrepeFeature.ImageBlock]: {
        blockCaptionPlaceholderText: '添加图片说明（可选）',
        blockUploadButton: '选择图片',
        blockUploadPlaceholderText: '或粘贴图片链接',
        inlineUploadButton: '选择图片',
        inlineUploadPlaceholderText: '或粘贴图片链接',
      },
    },
  })
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      if (!ready || destroyed) return
      tableResizers?.refresh()
      const next = composeMarkdown(markdown)
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
  const imageFiles = (transfer) => {
    const files = [...(transfer?.files || [])]
    for (const item of [...(transfer?.items || [])]) {
      const file = item.kind === 'file' ? item.getAsFile?.() : null
      if (file && !files.includes(file)) files.push(file)
    }
    return files.filter((file) => String(file.type || '').startsWith('image/'))
  }
  const insertImages = async (files, targetPos) => {
    root.dataset.imageUploading = 'true'
    try {
      const images = []
      for (const file of files) {
        const uploaded = await options.onImage?.(file)
        const value = typeof uploaded === 'string' ? uploaded : uploaded?.markdown
        const url = typeof uploaded === 'object' && uploaded?.url
          ? uploaded.url
          : String(value || '').match(/!\[[^\]]*\]\(([^\s)]+)(?:\s+['"][^'"]*['"])?\)/)?.[1]
        if (value && url) images.push({ markdown:value, url })
      }
      if (!images.length) throw new Error('图片上传后没有返回可用地址')
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const doc = view.state.doc
        let anchor = typeof targetPos === 'number' ? targetPos : null
        if (anchor === null) {
          const { $from, from } = view.state.selection
          anchor = $from.depth > 0 ? $from.before(1) : from
        }
        const anchorNode = doc.nodeAt(anchor)
        let insertPos = anchorNode?.isBlock ? anchor + anchorNode.nodeSize : doc.content.size
        let transaction = view.state.tr
        if (anchorNode?.type === paragraphSchema.type(ctx) && anchorNode.content.size === 0) {
          transaction = transaction.delete(anchor, anchor + anchorNode.nodeSize)
          insertPos = anchor
        }
        const imageType = imageBlockSchema.type(ctx)
        const nodes = images.map((image) => imageType.create({ src:image.url, caption:'', ratio:1 }))
        transaction = transaction.insert(insertPos, Fragment.fromArray(nodes))
        const nextPos = Math.min(transaction.doc.content.size, insertPos + nodes.reduce((size, node) => size + node.nodeSize, 0))
        transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(nextPos)))
        view.dispatch(transaction)
        view.focus()
      })
      const markdown = images.map((image) => image.markdown)
      root.dispatchEvent(new CustomEvent('codescope-image-inserted', {
        bubbles: true,
        detail: { count:markdown.length, markdown:markdown.join('\n\n') },
      }))
    } catch (error) {
      options.onError?.(error)
      root.dispatchEvent(new CustomEvent('codescope-image-error', {
        bubbles: true,
        detail: { error:String(error?.message || error) },
      }))
    } finally {
      delete root.dataset.imageUploading
    }
  }
  const onPaste = (event) => {
    if (!ready || destroyed || !(event.target instanceof Element) || !event.target.closest('.ProseMirror')) return
    const clipboard = event.clipboardData
    const images = imageFiles(clipboard)
    if (images.length && typeof options.onImage === 'function') {
      event.preventDefault()
      event.stopPropagation()
      void insertImages(images)
      return
    }
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
  const onDrop = (event) => {
    if (!ready || destroyed || !(event.target instanceof Element) || !event.target.closest('.ProseMirror') || typeof options.onImage !== 'function') return
    const images = imageFiles(event.dataTransfer)
    if (!images.length) return
    event.preventDefault()
    event.stopPropagation()
    void insertImages(images)
  }
  root.addEventListener('click', onClick)
  root.addEventListener('paste', onPaste, true)
  root.addEventListener('drop', onDrop, true)
  let tableResizers = null
  await crepe.create()
  tableResizers = attachTableColumnResizers(root, () => tableWidths, (nextWidths) => {
    tableWidths = nextWidths
    if (!ready || destroyed) return
    const next = composeMarkdown(crepe.getMarkdown())
    if (next === lastMarkdown) return
    lastMarkdown = next
    options.onChange?.(next)
  })
  const detachBlockTransformMenu = attachBlockTransformMenu(crepe, root, {
    onInsertImages: typeof options.onImage === 'function' ? insertImages : null,
  })
  const detachColorControls = attachColorControls(crepe, root, options)
  ready = true
  root.dataset.editorReady = 'true'
  return {
    getMarkdown: () => composeMarkdown(crepe.getMarkdown()),
    focus: () => root.querySelector('.ProseMirror')?.focus(),
    destroy: async () => {
      if (destroyed) return
      destroyed = true
      tableResizers?.destroy()
      root.removeEventListener('click', onClick)
      root.removeEventListener('paste', onPaste, true)
      root.removeEventListener('drop', onDrop, true)
      detachBlockTransformMenu()
      detachColorControls()
      delete root.dataset.editorReady
      await crepe.destroy()
      /* 这里刻意不调用 root.replaceChildren()。root 是所有挂载实例共用的节点，而连续切换模式时
         旧实例的清理完全可能晚于新实例的挂载 —— blockMountId 只淘汰旧实例「自己创建的实例」，
         拦不住它顺手清 DOM，一清就会把新实例刚渲染好的编辑器整片抹掉，表现为区块编辑区空白、
         且不报任何错。清空交给下一次挂载开头的 replaceChildren() 就够了。 */
    },
  }
}

window.CodeScopeBlockEditor = { create, toEditorMarkdown, fromEditorMarkdown, looksLikeMarkdown }
