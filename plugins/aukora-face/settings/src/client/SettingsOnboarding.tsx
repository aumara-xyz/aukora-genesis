/** Always-mounted coordinator for feature-owned settings onboarding steps. */
import { useCallback, useEffect, useState } from 'react'
import type { SettingsOnboardingComponentProps } from './shell-contract.ts'

/**
 * Mount the first incomplete onboarding step while the blank-session hero is
 * active. Visible chrome and readiness remain owned by the selected step.
 *
 * Every step completes itself once it decides not to appear, so no selected
 * step means onboarding can no longer take the application root inert.
 * `data-onboarding` reports that difference because the rendered tree hides it:
 * a step still resolving its durable state renders nothing, exactly like a step
 * that will never appear.
 *
 * `settled` additionally requires the session phase to have decided the hero,
 * because no step can be selected before it and the resulting quiet would
 * otherwise be reported as the end of onboarding rather than its start.
 *
 * `data-onboarding-blocker` names which of those two conditions is unmet.
 * Both render nothing, so a reader of the tree cannot tell an undecided
 * session phase from a selected step that is still resolving its durable
 * state, and the two are opposite defects: the first is a session that never
 * became ready, the second a step that never completed. The attribute is the
 * only place that difference is observable.
 * @param props - composed shell-overlay props.
 * @returns the onboarding-state marker beside the selected contribution.
 */
export function SettingsOnboarding(props: SettingsOnboardingComponentProps) {
  const {
    useOnboardingSteps, useSessions, renderSlot, openSection,
  } = props
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set())
  const steps = useOnboardingSteps(snapshot => snapshot)
  const hero = useSessions((state) => {
    if (state.phase !== 'ready') return 'undecided'
    return state.current === undefined || state.byId[state.current]?.blank === true
      ? 'active'
      : 'inactive'
  })
  const active = hero === 'active'
  const step = active ? steps.find(entry => !completed.has(entry.id)) : undefined

  useEffect(() => {
    if (active) return
    setCompleted(new Set())
  }, [active])

  const complete = useCallback((id: string) => {
    setCompleted((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  return (
    <>
      <div
        hidden
        data-onboarding={hero !== 'undecided' && step === undefined ? 'settled' : 'pending'}
        data-onboarding-blocker={
          hero === 'undecided'
            ? 'session-phase-undecided'
            : step === undefined ? 'none' : `step:${step.id}`
        }
      />
      {step === undefined ? null : renderSlot('settings.onboarding', {
        stepId: step.id,
        complete: () => { complete(step.id) },
        openSection,
      }, { only: step.id })}
    </>
  )
}
