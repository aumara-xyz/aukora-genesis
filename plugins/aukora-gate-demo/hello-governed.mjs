// A harmless governed plugin, for demonstrating that admission actually applies.
//
// WHY IT EXISTS. A gate with an empty governed list installs a hook and refuses nothing, so
// "the hook is installed" is not evidence of governed behaviour. This module is the smallest
// thing that can be ADMITTED or REFUSED, so the demonstration has a real effect to observe:
// its one line prints only if the module's body actually ran.
//
// IT DOES NOTHING ELSE. No filesystem writes, no network, no process, no state. It is not
// mounted in the live profile — it is named in the release policy as the governed entry and is
// loaded only by the demonstration profile.
export const name = 'hello-governed';

export function apply(ctx, config) {
  console.log('[hello-governed] APPLIED — the governed module body executed');
}
