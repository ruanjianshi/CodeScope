const COLORS = { 红:'red', 橙:'orange', 黄:'yellow', 绿:'green', 青:'cyan', 蓝:'blue', 紫:'purple', 粉:'pink', 灰:'gray' }
const KEYS = Object.keys(COLORS).join('')

function kbColorPlugin(md) {
  function rule(state, silent) {
    const src = state.src
    const start = state.pos
    const ch = src.charCodeAt(start)

    /* {红|文字} —— 0x7b 是 {，写成码点免得和外层模板字符串的花括号混淆 */
    if (ch === 0x7b) {
      const key = src[start + 1]
      if (!key || KEYS.indexOf(key) < 0) return false
      /* 分隔符接受 | 也接受 | —— 在 Markdown 表格里，裸的 | 会被当成列分隔符把整行切开
         （表格先按 | 切列，再解析行内语法），所以表格里必须写 |。这里两种都认，
         用户就不用记「正文用 |、表格用 |」这条规矩了。 */
      const barLen = src[start + 2] === '|' ? 1 : (src[start + 2] === '\\' && src[start + 3] === '|' ? 2 : 0)
      if (!barLen) return false
      const end = src.indexOf('}', start + 2 + barLen)
      if (end < 0) return false
      const body = src.slice(start + 2 + barLen, end)
      if (!body || body.indexOf('\n') >= 0) return false
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
      if (!body || body.indexOf('\n') >= 0 || body.indexOf('=') >= 0) return false
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
