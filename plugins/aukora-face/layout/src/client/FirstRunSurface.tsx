/**
 * THE FIRST RUN — the screen a person sees before AUKORA knows anything about them.
 *
 * Peter wants people he gives repo access to to install AUKORA and **talk to their own Auma**. This is the moment
 * between those two things, and it is deliberately short: five steps, plain words, and nothing asked for that the app
 * does not need to let them talk to her.
 *
 * **WHAT IT ASKS FOR, AND WHY EACH ONE IS HERE**
 *   - a **name**, so she has something to call them;
 *   - their **own** OpenRouter key, kept as a local secret — never in a log, never in a prompt, and removable from
 *     this screen or from their state directory;
 *   - whether they want **voice**, with the honest note that the choice needing a one-time setup is the one that keeps
 *     audio on their machine.
 *
 * **WHAT IT DOES NOT DO**: it does not claim a key works (only the provider can say that, so the check is a shape
 * check and the screen says so), it does not print a key back in full, and it does not call anything "off" that it has
 * not been told about — the status line below reports unknown as unknown, in AUMA's own shape.
 *
 * The decisions live in `first-run.ts`, where a court can drive them; this file renders them.
 */

import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { FIRST_RUN_STEPS, keyLooksUsable, maskKey, statusRows, voiceSetupNote } from './first-run.ts'
import type { Fact, StatusTopic } from './first-run.ts'
import { FirstRunError, httpFirstRun } from './first-run-api.ts'
import type { FirstRunSource } from './first-run-api.ts'
import css from './FirstRun.module.css'

/** Full props for the first-run screen: the copy, and the way into talking with her. */
export type FirstRunSurfaceProps =
  PropsLocale<'layout'>
  & {
    /** Called when the person is ready to talk. The shell owns where that leads. */
    readonly onStart?: () => void
    /** What the machine has reported, in AUMA's shape. Anything missing is unknown, never off. */
    readonly facts?: Partial<Record<StatusTopic, Fact<string>>>
    /** Set when a key is already stored, so the screen can offer to remove it instead of asking again. */
    readonly storedKeyTail?: string | null
    /** Where the four calls go. A court passes its own; the app passes the live routes. */
    readonly source?: FirstRunSource
  }

/**
 * The status line: what is on, what is not, and what nobody has said.
 *
 * **THE THREE ANSWERS ARE THREE SENTENCES.** A topic with a known fact says what it is; a topic with no fact says
 * "not known yet" rather than "off", because the app has not been told and a guess about somebody's own settings is
 * the kind of quiet lie this screen exists to avoid.
 */
function StatusLine({ t, facts }: { readonly t: FirstRunSurfaceProps['t']; readonly facts: FirstRunSurfaceProps['facts'] }): JSX.Element {
  return (
    <ul className={css.firstRunStatus} data-first-run-status>
      {statusRows(facts).map(row => (
        <li key={row.topic} data-first-run-topic={row.topic} data-first-run-known={row.fact.known ? 'yes' : 'no'}>
          <span className={css.firstRunTopic}>{t(`firstRun.topic.${row.topic}` as 'firstRun.topic.voice')}</span>
          {' — '}
          <span className={css.firstRunFact}>
            {row.fact.known
              ? t(row.fact.value === 'on' ? 'firstRun.status.on' : 'firstRun.status.off')
              : t('firstRun.status.unknown')}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The first run, in one screen. */
export function FirstRunSurface({ t, onStart, facts, storedKeyTail, source: given }: FirstRunSurfaceProps): JSX.Element {
  const source = given ?? httpFirstRun()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [voice, setVoice] = useState<'on' | 'off'>('off')
  const [stored, setStored] = useState<string | null>(storedKeyTail ?? null)
  /** Why the screen cannot do its job, when it cannot: nothing serving, a refusal by name, or a failed call. */
  const [trouble, setTrouble] = useState<{ readonly problem: string; readonly code: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  /** What the four routes said, or nothing at all when they could not be asked. */
  // **THE STATE IS THE FACT SHAPE, BECAUSE THAT IS WHAT THE PORT RETURNS.** It was `Record<string, unknown>`, which
  // is why the spread below needed `as never` to compile — **and a cast that does not work is the compiler saying the
  // narrowing never existed rather than that it was needed.**
  const [asked, setAsked] = useState<FirstRunSurfaceProps['facts']>({})

  // WHAT THE STATE ALREADY KNOWS, ASKED ONCE WHEN THE SCREEN APPEARS. A stored key is offered for removal rather than
  // asked for again, and a state that cannot be reached says so instead of showing a form that would not save.
  useEffect(() => {
    let cancelled = false
    void source.answer()
      .then(state => { if (!cancelled) setStored(state.keyTail) })
      .catch((cause: unknown) => {
        if (cancelled) return
        const named = cause instanceof FirstRunError ? { problem: cause.problem, code: cause.code } : { problem: 'failed', code: null }
        setTrouble(named)
      })
    // AND WHAT IS ON AND WHAT IS NOT, ASKED OF THE ROUTES THAT OWN EACH ANSWER. An unreachable route reports
    // unknown, never off — the same rule as a failed memory read never reading as an empty memory.
    //
    // **THE PROBE SITS BEFORE THE CLEANUP, AND THAT IS NOT COSMETIC.** My first version left a `return` above it, so
    // the whole probe was unreachable code: TypeScript permits that, a `.tsx` cannot be parse-checked in this
    // repository, and no court would have gone red — the status line would simply have said "not known yet" forever.
    // It was found by reading the effect back, which is the only instrument that covers this class here.
    void source.status()
      // **`asked as typeof asked` WAS A CAST TO THE VALUE'S OWN TYPE** — it asserted nothing, and it was the shape of
      // an assertion written to silence something rather than to state something. The state's type is now the port's,
      // so the value assigns directly.
      .then(asked => { if (!cancelled) setAsked(asked) })
      .catch(() => { if (!cancelled) setAsked({}) })
    return () => { cancelled = true }
  }, [source])

  /** Store what has been given, then hand over. **THE KEY IS SENT, NEVER SHOWN, AND NEVER PUT IN A MESSAGE.** */
  const start = async (): Promise<void> => {
    setSaving(true)
    try {
      if (name.trim() !== '') await source.remember(name.trim(), voice)
      if (key.trim() !== '') await source.rememberKey(key)
      setKey('')
      if (onStart !== undefined) onStart()
    } catch (cause: unknown) {
      const named = cause instanceof FirstRunError ? { problem: cause.problem, code: cause.code } : { problem: 'failed', code: null }
      setTrouble(named)
    } finally {
      setSaving(false)
    }
  }

  const shape = keyLooksUsable(key)
  const note = voiceSetupNote(voice)

  return (
    <section className={css.firstRun} data-first-run data-first-run-step={FIRST_RUN_STEPS[0]}>
      <h1 className={css.firstRunTitle}>{t('firstRun.title')}</h1>
      {/* THE LAB LINE COMES FIRST, BEFORE ANYTHING IS ASKED FOR. A person deciding what to type deserves to know
          what they are typing into before they type it. */}
      <p className={css.firstRunLead} data-first-run-lab>{t('firstRun.lab')}</p>

      <label className={css.firstRunField}>
        <span>{t('firstRun.name.label')}</span>
        <input
          type="text"
          value={name}
          data-first-run-name
          placeholder={t('firstRun.name.placeholder')}
          onChange={event => { setName(event.target.value) }}
        />
      </label>

      <div className={css.firstRunField}>
        <span>{t('firstRun.key.label')}</span>
        {stored === null ? (
          <>
            <input
              type="password"
              value={key}
              data-first-run-key
              autoComplete="off"
              spellCheck={false}
              placeholder={t('firstRun.key.placeholder')}
              onChange={event => { setKey(event.target.value) }}
            />
            {/* WHAT THE SHAPE CHECK SAID, IN WORDS THAT DO NOT CLAIM MORE THAN IT KNOWS. */}
            {key !== '' && !shape.usable ? (
              <span className={css.firstRunTrouble} data-first-run-key-trouble={shape.because ?? 'shape'}>
                {t(shape.because === 'prefix' ? 'firstRun.key.prefix' : shape.because === 'too-short' ? 'firstRun.key.short' : 'firstRun.key.empty')}
              </span>
            ) : null}
            <span className={css.firstRunQuiet} data-first-run-key-promise>{t('firstRun.key.promise')}</span>
          </>
        ) : (
          <>
            {/* A STORED KEY IS SHOWN AS ITS TAIL AND NOTHING ELSE, and it can be removed from here. */}
            <span className={css.firstRunStored} data-first-run-key-stored>{maskKey(`xxxx${stored}`)}</span>
            <button type="button" data-first-run-key-remove onClick={() => {
              // **REMOVAL IS A CALL, NOT A LOCAL FORGETTING.** Clearing the field would look identical and leave the
              // key on disk, which is the one thing the person asked not to happen.
              setStored(null); setKey('')
              void source.forgetKey().catch((cause: unknown) => {
                const named = cause instanceof FirstRunError ? { problem: cause.problem, code: cause.code } : { problem: 'failed', code: null }
                setTrouble(named)
              })
            }}>
              {t('firstRun.key.remove')}
            </button>
            <span className={css.firstRunQuiet}>{t('firstRun.key.promise')}</span>
          </>
        )}
      </div>

      <fieldset className={css.firstRunVoice} data-first-run-voice={voice}>
        <legend>{t('firstRun.voice.label')}</legend>
        <label>
          <input type="radio" name="voice" checked={voice === 'on'} data-first-run-voice-on onChange={() => { setVoice('on') }} />
          <span>{t('firstRun.voice.on')}</span>
        </label>
        <label>
          <input type="radio" name="voice" checked={voice === 'off'} data-first-run-voice-off onChange={() => { setVoice('off') }} />
          <span>{t('firstRun.voice.off')}</span>
        </label>
        {/* THE NOTE THE GOAL ASKS FOR: the setup is named when the choice needs it, not after it fails. */}
        <p className={css.firstRunNote} data-first-run-voice-note={note.needsSetup ? 'setup' : 'none'}>
          {t(note.key as 'firstRun.voice.onNote')}
        </p>
      </fieldset>

      {/* **NO CAST: `asked` IS `Partial<Record<StatusTopic, Fact<string>>>` AND `facts` IS THE SAME SHAPE.**
          The spread is a plain merge of what the props carry and what the probe answered — which is what it always
          meant, and what `as never` was preventing the compiler from confirming. */}
      <StatusLine t={t} facts={{ ...facts, ...asked }} />

      {/* WHY THE SCREEN CANNOT SAVE, IN THE PERSON'S OWN WORDS RATHER THAN A DEAD BUTTON. */}
      {trouble === null ? null : (
        <p className={css.firstRunTrouble} data-first-run-trouble={trouble.problem}>
          {t(trouble.code === 'first-run:no-thread'
            ? 'firstRun.trouble.noThread'
            : trouble.problem === 'absent' ? 'firstRun.trouble.absent' : 'firstRun.trouble.failed')}
        </p>
      )}

      <div className={css.firstRunGo}>
        <button
          type="button"
          data-first-run-start
          disabled={(!shape.usable && stored === null) || saving || trouble !== null}
          data-first-run-saving={saving ? 'yes' : 'no'}
          onClick={() => { void start() }}
        >
          {t('firstRun.start')}
        </button>
        {/* WHY THE BUTTON IS NOT READY, SAID PLAINLY RATHER THAN LEFT AS A GREY BOX. */}
        {!shape.usable && stored === null ? <span className={css.firstRunQuiet}>{t('firstRun.start.needsKey')}</span> : null}
      </div>
    </section>
  )
}
