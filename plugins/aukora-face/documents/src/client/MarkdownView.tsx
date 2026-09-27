/**
 * The full-page document body: markdown blocks as React elements.
 *
 * NOTHING HERE INTERPRETS HTML. The block tree comes from `markdown.ts`, which never
 * emits raw markup, so a document cannot inject an element this screen did not choose.
 * A link is only rendered as an anchor when the parser already decided its target is one
 * this screen will follow, and it opens away from the app rather than navigating it: a
 * click on a link inside a private document must not replace the surface.
 */
import type { ReactNode } from 'react'
import type { MarkdownBlock, MarkdownInline } from './markdown.ts'
import css from './Documents.module.css'

/** The heading element for a level, clamped to the six that exist. */
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

/**
 * Render inline content.
 * @param nodes - the inline nodes.
 * @param keyPrefix - a stable prefix so siblings keep identity across renders.
 * @returns the rendered nodes.
 */
function renderInline(nodes: readonly MarkdownInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}.${String(index)}`
    switch (node.kind) {
      case 'text':
        return node.text
      case 'code':
        return <code key={key} className={css.markdownInlineCode}>{node.text}</code>
      case 'strong':
        return <strong key={key}>{renderInline(node.children, key)}</strong>
      case 'emphasis':
        return <em key={key}>{renderInline(node.children, key)}</em>
      case 'link':
        return (
          <a
            key={key}
            className={css.markdownLink}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {renderInline(node.children, key)}
          </a>
        )
    }
  })
}

/**
 * Render one document's markdown.
 * @param props - the parsed blocks.
 * @returns the rendered document body.
 */
export function MarkdownView({ blocks }: { readonly blocks: readonly MarkdownBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        const key = `block.${String(index)}`
        switch (block.kind) {
          case 'heading': {
            const Tag = HEADINGS[block.level - 1] ?? 'h6'
            return <Tag key={key} className={css.markdownHeading}>{renderInline(block.children, key)}</Tag>
          }
          case 'paragraph':
            return <p key={key} className={css.markdownParagraph}>{renderInline(block.children, key)}</p>
          case 'code':
            return (
              <figure key={key} className={css.markdownFigure}>
                {block.language === ''
                  ? null
                  : <figcaption className={css.markdownCaption}>{block.language}</figcaption>}
                <pre className={css.markdownPre}><code>{block.text}</code></pre>
              </figure>
            )
          case 'quote':
            return <blockquote key={key} className={css.markdownQuote}>{renderInline(block.children, key)}</blockquote>
          case 'list':
            return block.ordered
              ? (
                  <ol key={key} className={css.markdownList}>
                    {block.items.map((item, at) => (
                      <li key={`${key}.${String(at)}`}>{renderInline(item, `${key}.${String(at)}`)}</li>
                    ))}
                  </ol>
                )
              : (
                  <ul key={key} className={css.markdownList}>
                    {block.items.map((item, at) => (
                      <li key={`${key}.${String(at)}`}>{renderInline(item, `${key}.${String(at)}`)}</li>
                    ))}
                  </ul>
                )
          case 'table':
            return (
              <table key={key} className={css.markdownTable}>
                <thead>
                  <tr>
                    {block.header.map((cell, at) => (
                      <th key={`${key}.h${String(at)}`}>{renderInline(cell, `${key}.h${String(at)}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowAt) => (
                    <tr key={`${key}.r${String(rowAt)}`}>
                      {row.map((cell, at) => (
                        <td key={`${key}.r${String(rowAt)}c${String(at)}`}>
                          {renderInline(cell, `${key}.r${String(rowAt)}c${String(at)}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          case 'rule':
            return <hr key={key} className={css.markdownRule} />
        }
      })}
    </>
  )
}
