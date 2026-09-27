/**
 * A small markdown reader for the full-page document view, with no dependency behind it.
 *
 * WHY IT IS NOT A LIBRARY. The face renders markdown the operator wrote on his own
 * machine. Pulling in a full CommonMark implementation would add a dependency to the
 * browser bundle to render a known subset, and the subset is the point: headings, lists,
 * emphasis, inline code, fenced code, links, blockquotes and tables. Anything outside it
 * is shown as the text it is rather than dropped.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Raw HTML is never interpreted: `<script>` in a
 * document renders as those characters, because a document is data, not program. Only
 * `http:`, `https:` and `mailto:` targets become links; anything else — `javascript:`, a
 * relative path, an anchor — keeps its label as plain text, since this face has no route
 * that could resolve it. Setext headings (`===` underlines) are not recognised, and
 * nesting inside a list item or a blockquote is flattened into one line, because both are
 * ceilings this screen can state rather than hide.
 *
 * The parser is pure: no DOM, no React, no imports. `MarkdownView.tsx` turns the tree it
 * returns into elements, and the court can drive it directly.
 *
 * @module @aukora/face-documents/markdown
 */

/** Inline content: text, emphasis, code, or a link this screen is willing to follow. */
export type MarkdownInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'emphasis'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly MarkdownInline[] }

/** One block of a document. */
export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'paragraph'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'code'; readonly language: string; readonly text: string }
  | { readonly kind: 'quote'; readonly children: readonly MarkdownInline[] }
  | {
    readonly kind: 'list'
    readonly ordered: boolean
    readonly items: readonly (readonly MarkdownInline[])[]
  }
  | {
    readonly kind: 'table'
    readonly header: readonly (readonly MarkdownInline[])[]
    readonly rows: readonly (readonly (readonly MarkdownInline[])[])[]
  }
  | { readonly kind: 'rule' }

/** How deep inline nesting is followed before the rest is kept as text. */
const INLINE_DEPTH_LIMIT = 4

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/u
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u
const QUOTE = /^ {0,3}> ?(.*)$/u
const BULLET = /^ {0,3}[-*+] +(.*)$/u
const ORDERED = /^ {0,3}\d{1,9}[.)] +(.*)$/u
const TABLE_ROW = /^ {0,3}\|.*\|[ \t]*$/u
const TABLE_DIVIDER = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/u

/** Whether a target is one this screen will turn into a link. */
export function isSafeHref(href: string): boolean {
  return /^(?:https?:|mailto:)/iu.test(href)
}

/** The plain text of inline content, for a target this screen will not link. */
function inlineText(nodes: readonly MarkdownInline[]): string {
  return nodes
    .map(node => (node.kind === 'text' || node.kind === 'code' ? node.text : inlineText(node.children)))
    .join('')
}

/**
 * Parse one line's inline content.
 * @param source - the line, without its block marker.
 * @param depth - current nesting depth; past the limit, markers stay as text.
 * @returns the inline nodes, in order.
 */
export function parseInline(source: string, depth = 0): readonly MarkdownInline[] {
  const nodes: MarkdownInline[] = []
  let text = ''
  const flush = (): void => {
    if (text === '') return
    nodes.push({ kind: 'text', text })
    text = ''
  }
  let at = 0
  while (at < source.length) {
    const character = source[at] ?? ''
    if (character === '`') {
      const end = source.indexOf('`', at + 1)
      if (end > at + 1) {
        flush()
        nodes.push({ kind: 'code', text: source.slice(at + 1, end) })
        at = end + 1
        continue
      }
    }
    if (character === '*' || character === '_') {
      const marker = source.startsWith(character + character, at) ? character + character : character
      const end = source.indexOf(marker, at + marker.length)
      if (end > at + marker.length && depth < INLINE_DEPTH_LIMIT) {
        flush()
        const children = parseInline(source.slice(at + marker.length, end), depth + 1)
        nodes.push(marker.length === 2 ? { kind: 'strong', children } : { kind: 'emphasis', children })
        at = end + marker.length
        continue
      }
    }
    if (character === '[') {
      const close = source.indexOf(']', at + 1)
      if (close > at + 1 && source[close + 1] === '(') {
        const end = source.indexOf(')', close + 2)
        if (end > close + 2) {
          flush()
          const children = parseInline(source.slice(at + 1, close), depth + 1)
          const href = source.slice(close + 2, end).trim()
          // A target this screen will not follow keeps its label as text: rendering it as
          // a link would offer a navigation this face cannot honour.
          nodes.push(isSafeHref(href) ? { kind: 'link', href, children } : { kind: 'text', text: inlineText(children) })
          at = end + 1
          continue
        }
      }
    }
    text += character
    at += 1
  }
  flush()
  return nodes
}

/** Whether a line opens a block, which ends the paragraph above it. */
function startsBlock(line: string): boolean {
  return FENCE.test(line)
    || HEADING.test(line)
    || RULE.test(line)
    || QUOTE.test(line)
    || BULLET.test(line)
    || ORDERED.test(line)
    || TABLE_ROW.test(line)
}

/** Consume one fenced code block, and return it with the line after its closing fence. */
function takeFence(lines: readonly string[], at: number, opening: RegExpExecArray): [MarkdownBlock, number] {
  const marker = opening[1] ?? '```'
  const character = marker.slice(0, 1) === '`' ? '`' : '~'
  const closing = new RegExp(`^ {0,3}${character}{${String(marker.length)},}[ \\t]*$`, 'u')
  const body: string[] = []
  let cursor = at + 1
  while (cursor < lines.length && !closing.test(lines[cursor] ?? '')) {
    body.push(lines[cursor] ?? '')
    cursor += 1
  }
  const next = cursor < lines.length ? cursor + 1 : cursor
  return [{ kind: 'code', language: (opening[2] ?? '').trim(), text: body.join('\n') }, next]
}

/** Split one table row into its cells. */
function splitTableRow(line: string): readonly (readonly MarkdownInline[])[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '')
  return trimmed.split('|').map(cell => parseInline(cell.trim()))
}

/**
 * Parse a markdown document into blocks.
 * @param source - the document's bytes, as text.
 * @returns the blocks, in document order.
 */
export function parseMarkdown(source: string): readonly MarkdownBlock[] {
  const lines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at] ?? ''
    if (line.trim() === '') {
      at += 1
      continue
    }
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const [block, next] = takeFence(lines, at, fence)
      blocks.push(block)
      at = next
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        children: parseInline(heading[2] ?? ''),
      })
      at += 1
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      at += 1
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote !== null) {
      const quoted: string[] = []
      while (at < lines.length) {
        const inner = QUOTE.exec(lines[at] ?? '')
        if (inner === null) break
        quoted.push(inner[1] ?? '')
        at += 1
      }
      blocks.push({ kind: 'quote', children: parseInline(quoted.join(' ').trim()) })
      continue
    }
    const bullet = BULLET.exec(line)
    const ordered = bullet === null ? ORDERED.exec(line) : null
    if (bullet !== null || ordered !== null) {
      const isOrdered = bullet === null
      const items: (readonly MarkdownInline[])[] = []
      while (at < lines.length) {
        const match = isOrdered ? ORDERED.exec(lines[at] ?? '') : BULLET.exec(lines[at] ?? '')
        if (match === null) break
        items.push(parseInline((match[1] ?? '').trim()))
        at += 1
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items })
      continue
    }
    if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[at + 1] ?? '')) {
      const header = splitTableRow(line)
      at += 2
      const rows: (readonly (readonly MarkdownInline[])[])[] = []
      while (at < lines.length && TABLE_ROW.test(lines[at] ?? '')) {
        rows.push(splitTableRow(lines[at] ?? ''))
        at += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    // A paragraph takes its first line unconditionally, so a line that merely looks like
    // a block marker cannot stall the scan on itself.
    const paragraph: string[] = []
    while (at < lines.length) {
      const next = lines[at] ?? ''
      if (next.trim() === '') break
      if (paragraph.length > 0 && startsBlock(next)) break
      paragraph.push(next.trim())
      at += 1
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) })
  }
  return blocks
}
