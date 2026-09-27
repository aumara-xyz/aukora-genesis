/**
 * Whether an Escape press originated inside a text-entry control, where the
 * key edits that control (clear, cancel composition) rather than the shell.
 * Duck-typed so targets from same-origin iframe documents (a different realm,
 * where `instanceof HTMLElement` fails) classify identically.
 * @param target - the keyboard event's target.
 * @returns true when the target is an input, textarea, select, or
 *   contenteditable host.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null
  const tag = typeof el?.tagName === 'string' ? el.tagName : ''
  return el?.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
