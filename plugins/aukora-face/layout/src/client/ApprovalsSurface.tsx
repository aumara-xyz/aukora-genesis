/**
 * THE APPROVAL HISTORY — what was asked, what he decided, and how long he looked.
 *
 * Peter clicks real approvals in the real window, and this is the record of it. Three things are deliberately visible
 * and one is deliberately not:
 *
 *  - **WHAT WAS ASKED, IN PLAIN WORDS**: the operation's kind and its subject, which is what a person can read. The
 *    raw text he was shown is **not** printed — it is behind a click, because a history that dumps every prompt is a
 *    history nobody reads.
 *  - **THE DECISION AND THE DWELL, EXACTLY AS LOGGED**: the token the log carries and the number of milliseconds it
 *    recorded, with no rounding and no paraphrase, so the screen can be checked against the log.
 *  - **THE BADGE FILLS ONLY FROM A REAL VERIFY**, and until signing requires Touch ID the screen says the true thing:
 *    someone at this Mac clicked Approve, and the app cannot yet prove it was you.
 *
 * The decisions live in `approvals-model.ts`, where a court drives them; this file renders them.
 */

import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { approvalRowsOf, noProofApplies, openedTextOf } from './approvals-model.ts'
import type { ApprovalEntry, ApprovalRow } from './approvals-model.ts'
import { ApprovalsError, approvePending, httpApprovals } from './approvals-api.ts'
import type { ApprovalsSource, PendingMemory } from './approvals-api.ts'
import css from './Approvals.module.css'

/** Full props for the Approvals view. */
export type ApprovalsSurfaceProps =
  PropsLocale<'layout'>
  & {
    /** Where the history is read from. A court passes the fixture; the app passes the route. */
    readonly source?: ApprovalsSource
    /** Whether signing requires Touch ID yet. Until it does, the no-proof line is the truth. */
    readonly signingRequiresTouchId?: boolean
  }

/**
 * *** WHAT AN APPROVAL CLICK CAME BACK WITH. ***
 *
 * *`ok` means "THE OWNER WILL BE ASKED", never "it is written" — this end cannot settle, by design. The fields are spelled
 * `string | undefined` rather than optional because this project compiles with `exactOptionalPropertyTypes`, and an
 * optional field refuses an explicit `undefined`.*
 */
export type ApproveOutcome = { ok: boolean; code: string | undefined; because: string | undefined }

/** The dwell, exactly as the log carried it — a number of milliseconds, or nothing at all. */
function dwellText(row: ApprovalRow, t: ApprovalsSurfaceProps['t']): string {
  return row.dwellMs === null ? t('approvals.dwell.none') : `${String(row.dwellMs)} ms`
}

/** One row. */
function Row({ row, t, entry }: { readonly row: ApprovalRow; readonly t: ApprovalsSurfaceProps['t']; readonly entry: ApprovalEntry | undefined }): JSX.Element {
  const [open, setOpen] = useState(false)
  const raw = open && entry !== undefined ? openedTextOf(entry) : null
  return (
    <li className={css.approvalRow} data-approval-row={row.kind} data-approval-decision={row.decision}>
      <div className={css.approvalHead}>
        <span className={css.approvalKind} data-approval-kind>{row.kind}</span>
        <span className={css.approvalWhen} data-approval-when>{row.at}</span>
      </div>
      {row.subject === ''
        ? <p className={css.approvalSubject} data-approval-subject="">{t('approvals.subject.none')}</p>
        : <p className={css.approvalSubject} data-approval-subject>{row.subject}</p>}
      <div className={css.approvalFacts}>
        <span className={css.approvalBadge} data-approval-badge={row.badge.state}>{row.badge.glyph}</span>
        <span data-approval-decision-text>{row.decision}</span>
        <span data-approval-dwell={row.dwellMs === null ? 'none' : String(row.dwellMs)}>{dwellText(row, t)}</span>
        {row.spoken === null ? null : <span data-approval-spoken>{row.spoken}</span>}
        {row.wordsCheck === 'mismatch'
          ? <span data-approval-words="mismatch">{t('approvals.words.mismatch')}</span>
          : null}
      </div>
      {/* THE RAW TEXT IS BEHIND A CLICK, AND ONLY WHEN THERE IS SOME. */}
      {row.openable ? (
        <button type="button" className={css.approvalOpen} data-approval-open={open ? 'yes' : 'no'} onClick={() => { setOpen(!open) }}>
          {open ? t('approvals.open.hide') : t('approvals.open.show')}
        </button>
      ) : null}
      {raw === null ? null : <p className={css.approvalRaw} data-approval-raw>{raw}</p>}
    </li>
  )
}

/**
 * *** ONE MEMORY WAITING FOR THE OWNER, WITH THE EXACT WORDS AN APPROVAL WOULD BIND. ***
 *
 * *The bytes are rendered rather than summarised, because the settle binds BYTES: a card built from a summary would show
 * Peter one sentence and hand the settle a different document, which is the failure this whole surface exists to make
 * impossible.*
 *
 * *** AND THE BUTTON DOES NOT CLAIM TO SETTLE. *** *`settleAuthorized` refuses a store belonging to another uid, so the
 * click becomes a FROZEN PROPOSAL and the owner still answers in person. The label and the answer line both say so —
 * a button that said "Approved" here would be the app taking credit for a decision it cannot make.*
 */
function PendingRow({ entry, t, outcome, asking, onApprove }: {
  readonly entry: PendingMemory
  readonly t: ApprovalsSurfaceProps['t']
  readonly outcome: ApproveOutcome | undefined
  readonly asking: boolean
  readonly onApprove: (recordId: string) => void
}): JSX.Element {
  return (
    <li className={css.approvalRow} data-pending-row={entry.recordId}>
      <div className={css.approvalHead}>
        <span className={css.approvalKind} data-pending-kind>{entry.kind ?? ''}</span>
        <span className={css.approvalWhen} data-pending-when>{entry.createdAt ?? ''}</span>
      </div>
      {entry.subject === null || entry.subject === ''
        ? null
        : <p className={css.approvalSubject} data-pending-subject>{entry.subject}</p>}
      {/* *** THE EXACT BYTES. *** Not truncated, not paraphrased — this is the document the settle binds. */}
      <p className={css.approvalSubject} data-pending-bytes-label>{t('approvals.pending.bytes')}</p>
      <pre className={css.approvalRaw} data-pending-bytes>{entry.bytes}</pre>
      <button
        type="button"
        className={css.approvalOpen}
        data-pending-approve={asking ? 'asking' : 'ready'}
        disabled={asking}
        onClick={() => { onApprove(entry.recordId) }}
      >
        {asking ? t('approvals.pending.asking') : t('approvals.pending.approve')}
      </button>
      {outcome === undefined
        ? null
        : (
          <p className={css.approvalsTrouble} data-pending-outcome={outcome.ok ? 'asked' : 'refused'}>
            {outcome.ok
              ? t('approvals.pending.asked')
              : `${t('approvals.pending.refused')}${String(outcome.code ?? '')}${outcome.because === undefined ? '' : ` — ${outcome.because}`}`}
          </p>
          )}
    </li>
  )
}

/** The history. */
export function ApprovalsSurface({ t, source: given, signingRequiresTouchId }: ApprovalsSurfaceProps): JSX.Element {
  const source = given ?? httpApprovals()
  const [entries, setEntries] = useState<readonly ApprovalEntry[]>([])
  const [from, setFrom] = useState<'log' | 'fixture' | 'none'>('none')
  /** No log at all, as the host reported it — a different fact from a log with nothing in it. */
  const [absent, setAbsent] = useState(false)
  /** Lines that were there and could not be read. */
  const [skipped, setSkipped] = useState(0)
  const [trouble, setTrouble] = useState<string | null>(null)
  /** *** WHAT IS WAITING FOR HIM. *** Empty is only honest when the route answered; see `pendingAbsent`. */
  const [pending, setPending] = useState<readonly PendingMemory[]>([])
  const [pendingAbsent, setPendingAbsent] = useState(false)
  const [pendingUnreadable, setPendingUnreadable] = useState(0)
  /** Which record is mid-submission, so a second click cannot double-propose. */
  const [asking, setAsking] = useState<string | null>(null)
  /** What came back, per record. *** `ok` MEANS "THE OWNER WILL BE ASKED", NEVER "IT IS WRITTEN". *** */
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, ApproveOutcome>>>({})

  useEffect(() => {
    let cancelled = false
    void source.read()
      .then(answer => {
        if (cancelled) return
        setEntries(answer.entries)
        setFrom(answer.from)
        setAbsent(answer.absent)
        setSkipped(answer.skipped)
        setPending(answer.pending)
        setPendingAbsent(answer.pendingAbsent)
        setPendingUnreadable(answer.pendingUnreadable)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // **NOTHING IS SERVING IS NOT AN EMPTY HISTORY.** A failure says so; an empty list would read as "you never
        // approved anything", which is a different and false statement about the person's own past.
        setTrouble(cause instanceof ApprovalsError ? cause.problem : 'failed')
      })
    return () => { cancelled = true }
  }, [source])

  // **`rowsOfAnswer` NEVER EXISTED, AND `approvalRowsOf` TAKES THE ARRAY.** `entries` is the `readonly ApprovalEntry[]`
  // in state at `:77`, fed by `answer.entries` at `:90` — **so the answer has already been unwrapped by the time this
  // runs, and the name was left over from a shape where it had not been.** The existing function also filters and
  // sorts, which is what the renderer below expects; `rowsOfAnswer` would have had to do the same.
  //
  // **AND THIS IS WHY I DID NOT MAKE THIS EDIT YESTERDAY.** I recorded it as needing the owner's intent because the
  // call passes `{ entries }` where the model takes a list — **a rename that kept the braces would have compiled into
  // a different error, or into a runtime failure in the panel that shows Peter what he has approved.** The intent is
  // now established rather than guessed: the array is in scope two lines up.
  const rows = approvalRowsOf(entries)

  return (
    <section className={css.approvals} data-approvals-surface>
      <h1 className={css.approvalsTitle}>{t('approvals.title')}</h1>
      {/* THE LINE THE GOAL ASKS FOR, AND IT IS NOT A FOOTNOTE: until signing requires Touch ID, a click at this Mac
          proves nothing about who made it, and saying so is the honest state of the world. */}
      {noProofApplies(signingRequiresTouchId === true) ? (
        <p className={css.approvalsNoProof} data-approvals-no-proof>{t('approvals.noProof')}</p>
      ) : null}
      {trouble === null
        ? null
        : <p className={css.approvalsTrouble} data-approvals-trouble={trouble}>{t(trouble === 'absent' ? 'approvals.trouble.absent' : 'approvals.trouble.failed')}</p>}
      {/* **AN EMPTY LIST IS ONLY "NOTHING APPROVED" WHEN THERE IS A LOG.** With no log at all the same empty list
          means something else, and saying "nothing has been approved yet" about a machine that has not started
          logging would be a false statement about the person's own past. */}
      {rows.length === 0 && trouble === null
        ? <p className={css.approvalsEmpty} data-approvals-empty={absent ? 'absent' : 'none'}>
            {t(absent ? 'approvals.absent' : 'approvals.empty')}
          </p>
        : null}
      {skipped === 0 || trouble !== null
        ? null
        : <p className={css.approvalsTrouble} data-approvals-skipped={String(skipped)}>{t('approvals.skipped')}</p>}
      {/* *** WHAT IS WAITING, ABOVE THE HISTORY, BECAUSE IT IS THE THING THAT NEEDS HIM. *** */}
      <h2 className={css.approvalsTitle} data-pending-title>{t('approvals.pending.title')}</h2>
      {pendingAbsent
        // *** UNREADABLE IS NOT EMPTY. *** *Saying "nothing is waiting" when the queue could not be read tells Peter
        // there is nothing to do, when in truth nobody looked.*
        ? <p className={css.approvalsTrouble} data-pending-absent>{t('approvals.pending.absent')}</p>
        : (pending.length === 0
          ? <p className={css.approvalsEmpty} data-pending-empty>{t('approvals.pending.empty')}</p>
          : (
            <ul className={css.approvalsRows}>
              {pending.map(entry => (
                <PendingRow
                  key={entry.recordId}
                  entry={entry}
                  t={t}
                  outcome={outcomes[entry.recordId]}
                  asking={asking === entry.recordId}
                  onApprove={(recordId) => {
                    setAsking(recordId)
                    void approvePending(recordId)
                      .then(result => {
                        setOutcomes(was => ({ ...was, [recordId]: result }))
                        // *** AND IT LEAVES THE WAITING LIST ONLY WHEN THE PROPOSAL WAS ACCEPTED. *** *Dropping it on a
                        // refusal would hide a memory he still has to deal with behind a message that scrolled away.*
                        if (result.ok) setPending(was => was.filter(one => one.recordId !== recordId))
                      })
                      .finally(() => { setAsking(null) })
                  }}
                />
              ))}
            </ul>
            ))}
      {pendingUnreadable === 0 || pendingAbsent
        ? null
        : (
          <p className={css.approvalsTrouble} data-pending-unreadable={String(pendingUnreadable)}>
            {t('approvals.pending.unreadable').replace('{n}', String(pendingUnreadable))}
          </p>
          )}

      <ul className={css.approvalsRows}>
        {rows.map(row => (
          <Row key={`${row.at}-${row.kind}`} row={row} t={t} entry={entries.find(entry => entry.at === row.at && entry.kind === row.kind)} />
        ))}
      </ul>
      {/* WHICH SOURCE THIS IS. A fixture is not history, and a view that shows one without saying so is lying by
          omission — the same rule as the memory app's stub notice. */}
      <p className={css.approvalsSource} data-approvals-source={from}>
        {t(from === 'fixture' ? 'approvals.source.fixture' : from === 'none' ? 'approvals.source.none' : 'approvals.source.log')}
      </p>
    </section>
  )
}
