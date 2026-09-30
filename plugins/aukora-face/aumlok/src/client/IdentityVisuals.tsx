import { useId } from 'react'
import css from './Aumlok.module.css'

export type IdentityIconName = 'copy' | 'share' | 'rotate' | 'check' | 'error' | 'key' | 'person' | 'network' | 'camera' | 'lock'

export function IdentityIcon({ name }: { name: IdentityIconName }) {
  const paths = {
    copy: 'M9 9h11v11H9z M15 5V2H2v13h3',
    share: 'M12 16V2 M7 7l5-5 5 5 M4 12v9h16v-9',
    rotate: 'M20 7a9 9 0 1 0 1 9 M20 2v6h-6',
    check: 'm4 12 5 5L20 6',
    error: 'm6 6 12 12 M6 18 18 6',
    key: 'M14 3a7 7 0 0 0-6.3 10L2 19v3h4v-3h3v-3l2-2A7 7 0 1 0 14 3Z M16 7h.01',
    person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
    network: 'M8 12h8 M12 8v8 M8 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M8 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M7 7l10 10 M17 7 7 17',
    lock: 'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
    camera: 'M3 7h4l2-3h6l2 3h4v14H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

/** Pure JS, stable for an npub, with no remote avatar request or cryptographic identity claim. */
export function IdentityAvatar({ npub, photo }: { npub?: string; photo?: string | null }) {
  const gradient = useId()
  let seed = 2166136261
  for (const character of npub ?? '') seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0
  const hue = 208 + seed % 19
  const cells = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
      if ((seed >>> 0) % 2 === 0) continue
      cells.push(<rect key={`${x}-${y}`} x={14 + x * 8} y={14 + y * 8} width="7" height="7" rx="2" />)
      if (x < 2) cells.push(<rect key={`${4 - x}-${y}`} x={14 + (4 - x) * 8} y={14 + y * 8} width="7" height="7" rx="2" />)
    }
  }
  return <span className={css.identityAvatar}>
    {photo ? <img src={photo} alt="" /> : npub ? <svg viewBox="0 0 68 68" aria-hidden="true">
      <defs><linearGradient id={gradient} x2="1" y2="1">
        <stop stopColor={`hsl(${hue} 64% 34%)`} /><stop offset="1" stopColor={`hsl(${hue + 5} 66% 17%)`} />
      </linearGradient></defs>
      <rect width="68" height="68" rx="20" fill={`url(#${gradient})`} />
      <g fill={`hsl(${hue - 5} 82% 80%)`}>{cells}</g>
    </svg> : <IdentityIcon name="person" />}
  </span>
}
