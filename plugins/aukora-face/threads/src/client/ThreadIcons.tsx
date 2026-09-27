/** Exact 16px thread-action glyphs shared across filters, rows, and Session actions. */

interface ThreadIconProps {
  size?: number
  className?: string
}

/** Pin outline used for both filtering and per-Session state. */
export function ThreadPinIcon({ size = 16, className }: ThreadIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 1.5 14.5 6.5 11 8l-1.5 4.5L4 7 8.5 5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 11l-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Unread ring used for both filtering and per-Session reminders. */
export function ThreadUnreadIcon({ size = 16, className }: ThreadIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** Archive outline used for the filter, row marker/menu, and Session action. */
export function ThreadArchiveIcon({ size = 16, className }: ThreadIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="3.4" rx="0.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.4 6.4V13h9.2V6.4M6.4 9h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
