/**
 * AUKORA browser presentation: the sidebar brand slots and the AUKORA palette.
 *
 * Both slots are `kind: 'single'` cells that the sidebar declares with its own
 * `FishLogo` / "DSH Local Build" fallbacks. The shipped `ui-brand-official`
 * occupant is build-profile gated, and a same-priority second registration is
 * a hard boot error, so both keys are registered at `priority: -1`: that is the
 * documented shadowing rank (lowest renders), which replaces the occupant in an
 * official build and the fallback in every other build without a collision.
 *
 * Registrations are wrapped in `ctx.slots.inject`, because the declaring
 * package activates in an order this plugin does not control. Every client
 * entry activates before `mountClient`, so the fallback never paints.
 *
 * @module @aukora/dsh-plugin-foundation/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'

/** The brand image, inlined at build time from the tracked PNG (base64 data URI). */
declare const __AUKORA_ICON_DATA_URI__: string

/** Services required by this presentation plugin. */
export const inject = ['slots', 'theme']

/** Owner props the sidebar passes to the mark occupant. */
interface BrandMarkProps {
  readonly size?: number
}

/** Stable layer id for this plugin's token overrides. */
const THEME_SOURCE = '@aukora/dsh-plugin-foundation'

/**
 * The AUKORA palette.
 *
 * Dark values are the AUKORA colours; `--dsw-alias-bg-base`, `-layer-1/2/3`
 * are the same semantics the old 5173 theme used (`--dsw-alias-bg-base`,
 * `--dsw-alias-bg-layer-1/2/3`). `overrideTokens` requires one value per
 * scheme, so the light column reproduces the shipped light palette exactly
 * rather than leaving light mode undefined. Text, border, input and
 * active-state tokens are deliberately left to the theme owner: the shipped
 * dark text/active values are tuned for a near-black canvas and the AUKORA
 * canvas keeps the same contrast class, which the contrast check in
 * `scripts/verify-aukora-render.mjs` checks in the rendered application.
 */
const AUKORA_TOKENS = {
  '--dsw-alias-bg-base': { light: 'rgb(255, 255, 255)', dark: '#111520' },
  '--dsw-alias-bg-layer-1': { light: 'rgb(255, 255, 255)', dark: '#1B1F2A' },
  '--dsw-alias-bg-layer-2': { light: 'rgb(255, 255, 255)', dark: '#1F232E' },
  '--dsw-alias-bg-layer-3': { light: 'rgb(255, 255, 255)', dark: '#252834' },
  '--dsw-specific-menu': { light: 'rgb(255, 255, 255)', dark: '#252834' },
  '--dsw-specific-sidebar-fill': { light: 'rgb(249, 250, 251)', dark: '#141824' },
  '--dsw-specific-input-major': { light: 'rgb(255, 255, 255)', dark: '#1B1F2A' },
  '--dsw-specific-login-input': { light: 'rgb(249, 250, 251)', dark: '#1B1F2A' },
} as const

/**
 * The sidebar brand mark: the tracked AUKORA icon at the size the sidebar asks
 * for, square-preserved and transparent.
 * @param props - owner props from the sidebar.
 */
function AukoraBrandMark({ size = 24 }: BrandMarkProps) {
  return (
    <img
      src={__AUKORA_ICON_DATA_URI__}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ display: 'block', width: `${String(size)}px`, height: `${String(size)}px`, objectFit: 'contain' }}
    />
  )
}

/** The sidebar brand name: AUKORA in semibold, moderately spaced text. */
function AukoraBrandName() {
  return <span style={{ fontWeight: 600, letterSpacing: '0.06em' }}>AUKORA</span>
}

/**
 * Fill both sidebar brand cells and apply the AUKORA palette.
 * @param ctx - client root context carrying the slot registry and theme runtime.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, AukoraBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, AukoraBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -1 }, AukoraBrandMark)
  })
  ctx.effect(() => {
    if (typeof document === 'undefined') return
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!icon) return
    const previous = { href: icon.href, type: icon.type }
    icon.href = __AUKORA_ICON_DATA_URI__
    icon.type = 'image/png'
    return () => { icon.href = previous.href; icon.type = previous.type }
  }, 'aukora-foundation.favicon')
  ctx.effect(
    () => ctx.theme.overrideTokens(THEME_SOURCE, AUKORA_TOKENS),
    'aukora-foundation.theme-override',
  )
}
