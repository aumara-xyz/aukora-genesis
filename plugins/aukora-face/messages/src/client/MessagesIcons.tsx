/** 16px glyphs copied from the thread lane so both lanes share one icon language. */

interface MessagesIconProps {
  size?: number
  className?: string
}

/** Pin outline, identical to the thread lane's pin glyph. */
export function PinIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 1.5 14.5 6.5 11 8l-1.5 4.5L4 7 8.5 5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 11l-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Unread ring, identical to the thread lane's unread glyph. */
export function UnreadIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** Archive outline, identical to the thread lane's archive glyph. */
export function ArchiveIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="3.4" rx="0.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.4 6.4V13h9.2V6.4M6.4 9h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The check is reserved for a host-confirmed identity. */
export function ShieldIcon({ size = 16, className, verified = true }: MessagesIconProps & { readonly verified?: boolean }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.6 13 3.4v4.3c0 3.1-2.1 5.4-5 6.7-2.9-1.3-5-3.6-5-6.7V3.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      {verified
        ? <path d="M5.9 8.1 7.4 9.6l2.9-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M5.9 5.9 10.1 10.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  )
}

/** Close: the one way out of a sheet, beside Escape and a tap on the backdrop. */
export function CloseIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Info: the one button that opens the details sheet, from a row, the list or a conversation. */
export function InfoIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
    </svg>
  )
}

/*
 * Send-state glyphs for the receipt mark. A receipt is a MARK beside the message it is about, never a
 * sentence: the four outcomes this face can report keep four distinct shapes, so "kept yours, theirs
 * refused" cannot be read as a clean send by someone who cannot separate green from gold. The sentences
 * themselves are one tap away in the details sheet.
 */

/** One clock: the send is in flight and nothing has been claimed about it yet. */
export function SendPendingIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.6V8l2.4 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Two checks: every copy this send reported was accepted. */
export function SendDeliveredIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.4 8.4 4.2 11.2 9.8 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 8.4 9.8 11.2 14.6 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** One check, and it is one on purpose: a copy was refused, so this is not the two-check state. */
export function SendPartialIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.6 8.4 5.4 11.2 11 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.4 11.4 14.6 11.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 2" />
    </svg>
  )
}

/** A broken bar: no relay took this message, so it never left. */
export function SendRefusedIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 5.6h10M3 10.4h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9.4 3.2 6.6 12.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Plus for new-conversation, matching the lane's new-chat control weight. */
export function PlusIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.8v10.4M2.8 8h10.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Search glass for the lane's search seat. */
export function SearchIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.2 10.2 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Back chevron for the open-conversation return, top-left as in the thread view. */
export function BackIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Send arrow, white on the composer's info-fill circle like the AI composer. */
export function SendIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 13V3.8M4 7.5 8 3.5l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Chat mark beside the MESSAGES brand name. */
export function ChatMarkIcon({ size = 22, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8a5.5 5.5 0 1 1 2.2 4.4L2 13.5l.8-2.6A5.5 5.5 0 0 1 2.5 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

/*
 * Contact-state glyphs. Each of the four states carries its own shape as well as its own
 * colour and its own word, because the badge has to survive a reader who cannot separate
 * the four colours: a double check for a binding that verified, a flask for one that is
 * structurally sound and not yet a claim about a person, an open break for an npub nothing
 * vouches for, and a warning for something that was presented and did not verify.
 */

/** Two checks: the binding verified and is not TEST-labelled. */
export function VerifiedStateIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.8 8.4 4.6 11.2 10.2 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.4 8.4 10.2 11.2 15 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A flask: valid, and TEST-labelled rather than a claim about a person. */
export function TestStateIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.2 1.9h3.6M7 1.9v3.6L3.4 12a1.4 1.4 0 0 0 1.2 2.1h6.8A1.4 1.4 0 0 0 12.6 12L9 5.5V1.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.6 10.4h6.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** An open, broken link: held here and vouched for by nothing. */
export function UnboundStateIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.7.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.7-.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A warning: something was presented and it did not verify. */
export function ForeignStateIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.2 14.6 13.4H1.4L8 2.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.4v3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
    </svg>
  )
}

/** A keyed lock: the seat the SAS occupies when a binding verified. */
export function SasIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5.6" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.2 8H14M11.6 8v2.4M13.4 8v1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** A slash: the seat is deliberately not a code, so it must not look like one. */
export function SasAbsentIcon({ size = 14, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.4 11.6 11.6 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** A circular arrow for re-reading the listing, so the refresh verb is not an unread dot. */
export function RefreshIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13.4 2.4v2.9h-2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CameraIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4.5h2.5L6 2.5h4l1.5 2H14v9H2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

export function ImageIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
      <path d="m2 12 4-4 2.5 2.5L11 7l3 4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

export function KeyIcon({ size = 16, className }: MessagesIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5" cy="6" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="m7.5 7.5 6 6m-3-3 2-2m0 4 2-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
