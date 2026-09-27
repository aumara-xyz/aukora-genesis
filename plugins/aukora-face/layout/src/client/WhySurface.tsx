/**
 * "WHY DID SHE SAY THAT?" — one reply's attention, in plain words.
 *
 * AUMA's per-reply manifest says what was in her prompt: the ids and hashes of every block and memory, whether each
 * counts as outside words, and each one's source. This shows a person the parts of that he can use — **grouped by what
 * she was holding, with outside words labelled every time, and a check mark only where a rebuild really matched.**
 *
 * **WHAT IT DELIBERATELY DOES NOT SHOW**: the ids and the hashes. They are the evidence the rebuild was checked
 * against; a person asking why she said something wants the source and the date. And **integrity, authority and
 * opinion never share a badge** — there is no "probably fine" here, only a rebuild that matched, one that ran and did
 * not, or a plain statement that no rebuild was recorded.
 *
 * The decisions live in `why-model.ts`, where a court drives them; this file renders them.
 */

import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { manifestFactOf, rebuildCheckOf, whyGroupsOf } from './why-model.ts'
import type { ManifestFact, RebuildCheck } from './why-model.ts'
import { WhyError, httpWhy } from './why-api.ts'
import type { WhySource } from './why-api.ts'
import css from './Why.module.css'

/** Full props for the attention view. */
export type WhySurfaceProps =
  PropsLocale<'layout'>
  & {
    /** Which reply to explain. The "why?" link under a reply passes its own id. */
    readonly replyId?: string
    /** Where the receipt comes from. A court passes its own; the app passes the route. */
    readonly source?: WhySource
  }

/** One group of what she was holding: its block, and the items with their sources and dates. */
function Group({ block, rows, allOutside, t }: {
  readonly block: string
  readonly rows: readonly { readonly source: string; readonly at: string | null; readonly outsideWords: boolean }[]
  readonly allOutside: boolean
  readonly t: WhySurfaceProps['t']
}): JSX.Element {
  return (
    <li className={css.whyGroup} data-why-block={block}>
      <div className={css.whyGroupHead}>
        <span className={css.whyBlock}>{block}</span>
        {/* A WHOLE BLOCK OF OUTSIDE WORDS IS WORTH NOTICING, so the group says it as well as its items. */}
        {allOutside ? <span className={css.whyOutside} data-why-group-outside>{t('why.group.outside')}</span> : null}
      </div>
      <ul className={css.whyItems}>
        {rows.map((row, index) => (
          <li className={css.whyItem} key={`${block}-${String(index)}`} data-why-item data-why-item-outside={row.outsideWords ? 'yes' : 'no'}>
            <span className={css.whySource}>{row.source}</span>
            {row.at === null ? null : <span className={css.whyWhen}>{row.at}</span>}
            {/* **EVERY OUTSIDE-WORD ITEM IS LABELLED, WITHOUT EXCEPTION** — and the label says what it means. */}
            {row.outsideWords ? <span className={css.whyOutside} data-why-outside>{t('why.outside')}</span> : null}
          </li>
        ))}
      </ul>
    </li>
  )
}

/** The view. */
export function WhySurface({ t, replyId, source: given }: WhySurfaceProps): JSX.Element {
  const source = given ?? httpWhy()
  const [fact, setFact] = useState<ManifestFact | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (replyId === undefined || replyId === '') {
      // **NO REPLY NAMED IS NOT "SHE HELD NOTHING".** It is a different sentence, and the view says which.
      setFact({ known: false, why: 'no reply was chosen to explain' })
      return () => { cancelled = true }
    }
    void source.read(replyId)
      .then(read => { if (!cancelled) setFact(manifestFactOf(read.manifest)) })
      .catch((cause: unknown) => { if (!cancelled) setTrouble(cause instanceof WhyError ? cause.problem : 'failed') })
    return () => { cancelled = true }
  }, [source, replyId])

  const groups = fact !== null && fact.known ? whyGroupsOf(fact.manifest) : []
  const check: RebuildCheck | null = fact !== null && fact.known ? rebuildCheckOf(fact.manifest) : null

  return (
    <section className={css.why} data-why-surface>
      <h1 className={css.whyTitle}>{t('why.title')}</h1>
      <p className={css.whyLead}>{t('why.lead')}</p>
      {trouble === null
        ? null
        : <p className={css.whyTrouble} data-why-trouble={trouble}>{t(trouble === 'absent' ? 'why.trouble.absent' : 'why.trouble.failed')}</p>}
      {/* **AN ABSENT RECEIPT IS SAID IN WORDS.** An empty list would read as "she was holding nothing in mind". */}
      {fact === null || fact.known ? null : (
        <p className={css.whyAbsent} data-why-absent>{fact.why}</p>
      )}
      {/* **A RECEIPT WITH NOTHING IN IT IS SAID, NOT LEFT BLANK.** The absent case above covers a reply with no
          receipt; this covers the other one — a receipt that exists and records nothing that was in her prompt. A blank
          page would read as a view that had not loaded, which is the class this lane keeps finding. */}
      {fact !== null && fact.known && groups.length === 0
        ? <p className={css.whyAbsent} data-why-empty>{t('why.receipt.empty')}</p>
        : null}
      {groups.length === 0 ? null : (
        <ul className={css.whyGroups}>
          {groups.map(group => (
            <Group key={group.block} block={group.block} rows={group.rows} allOutside={group.allOutsideWords} t={t} />
          ))}
        </ul>
      )}
      {/* **THE CHECK MARK ONLY FROM A REAL REBUILD, AND THE TWO CHANNELS NEVER SHARE A BADGE.** A rebuild that ran and
          did not match is a failure, not a tick; one that was never recorded is a sentence, not a blank. */}
      {check === null ? null : check.known
        ? (
            <p className={check.matches ? css.whyChecked : css.whyMismatch} data-why-rebuild={check.matches ? 'matches' : 'differs'}>
              {t(check.matches ? 'why.rebuild.matches' : 'why.rebuild.differs')}
            </p>
          )
        : <p className={css.whyUnchecked} data-why-rebuild="unchecked">{`${t('why.rebuild.unchecked')} ${check.why}`}</p>}
    </section>
  )
}
