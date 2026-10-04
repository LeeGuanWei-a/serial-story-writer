/**
 * 一个**很小**的 Markdown 解析器:只覆盖这一领域真正会写的东西。
 *
 * ## 为什么不引第三方
 *
 * 面板是只读渲染一部长篇手稿,不是通用 Markdown 阅读器。自写一个受控子集有三个好处:
 * 解析是**纯函数**(因此可以在没有浏览器的环境里被完整测住)、不会引入新的打包依赖、
 * 也**不会把 HTML 直接透传**(正文里出现 `<script>` 只会原样显示成文字)。
 *
 * ## 支持的子集
 *
 * 块级:标题(`#`~`######`)、段落、无序/有序列表、引用、围栏代码块、分隔线。
 * 行内:`**粗**`、`*斜*`/`_斜_`、`` `代码` ``、`[文字](链接)`。
 *
 * **刻意不支持**:原始 HTML、表格、脚注、嵌套列表。这些要么不安全,要么在中文小说
 * 正文里几乎不会出现;不实现比实现一半更诚实。
 */

/** 一个块级节点。 */
export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'rule' }

/** 一段行内内容。 */
export type MarkdownSpan =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }

const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const UNORDERED = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const FENCE = /^\s*```/

/**
 * 把正文拆成块级节点。
 *
 * @param text 正文文本。
 * @returns 块级节点序列。
 */
export function parseMarkdown(text: string): readonly MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = text.split('\n')
  /** 段落/列表/引用用同一个缓冲区累积,遇到空行或换类型时冲刷。 */
  let buffer: string[] = []
  let mode: 'paragraph' | 'list' | 'quote' = 'paragraph'
  let ordered = false

  const flush = (): void => {
    if (buffer.length === 0) return
    if (mode === 'list') {
      blocks.push({ kind: 'list', ordered, items: buffer })
    } else if (mode === 'quote') {
      blocks.push({ kind: 'quote', text: buffer.join('\n') })
    } else {
      // 段落内的换行**原样保留**:中文正文里把换行折成空格会凭空插入空格。
      blocks.push({ kind: 'paragraph', text: buffer.join('\n') })
    }
    buffer = []
    mode = 'paragraph'
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    // 围栏代码块:整段原样收,不做行内解析。
    if (FENCE.test(line)) {
      flush()
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      // 未闭合的围栏吃到文件末尾也可以 —— 写作中途的稿子很常见。
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    if (line.trim() === '') { flush(); continue }

    if (RULE.test(line)) { flush(); blocks.push({ kind: 'rule' }); continue }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote !== null) {
      if (mode !== 'quote') flush()
      mode = 'quote'
      buffer.push(quote[1])
      continue
    }

    const unordered = UNORDERED.exec(line)
    const orderedMatch = ORDERED.exec(line)
    if (unordered !== null || orderedMatch !== null) {
      const isOrdered = orderedMatch !== null
      // 有序与无序相邻时不合并成一个列表。
      if (mode !== 'list' || ordered !== isOrdered) flush()
      mode = 'list'
      ordered = isOrdered
      buffer.push((unordered ?? orderedMatch)?.[1] ?? '')
      continue
    }

    if (mode !== 'paragraph') flush()
    mode = 'paragraph'
    buffer.push(line)
  }
  flush()
  return blocks
}

/** 行内标记的匹配顺序即优先级:代码最先(它内部不做任何解析),链接其次。 */
const INLINE = /(`[^`]+`)|(\[[^\]]*\]\([^)\s]*\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g

/**
 * 把一段文字拆成行内片段。
 *
 * @param text 一段行内文字。
 * @returns 行内片段序列;没有标记时是单个 `text` 片段。
 */
export function parseInline(text: string): readonly MarkdownSpan[] {
  const spans: MarkdownSpan[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index
    if (at > cursor) spans.push({ kind: 'text', text: text.slice(cursor, at) })
    const token = match[0]
    if (match[1] !== undefined) {
      spans.push({ kind: 'code', text: token.slice(1, -1) })
    } else if (match[2] !== undefined) {
      const split = token.indexOf('](')
      spans.push({ kind: 'link', text: token.slice(1, split), href: token.slice(split + 2, -1) })
    } else if (match[3] !== undefined) {
      spans.push({ kind: 'strong', text: token.slice(2, -2) })
    } else {
      spans.push({ kind: 'em', text: token.slice(1, -1) })
    }
    cursor = at + token.length
  }
  if (cursor < text.length) spans.push({ kind: 'text', text: text.slice(cursor) })
  return spans
}
