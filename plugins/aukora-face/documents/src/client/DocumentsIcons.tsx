/** 16px glyphs for the Documents portals, drawn to the lane's icon language. */

interface DocumentsIconProps {
  size?: number
  className?: string
}

/** Plain document sheet with a folded corner. */
export function DocumentIcon({ size = 16, className }: DocumentsIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 1.8h5.2l3.8 3.8v8.6H3.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8.7 1.8v3.8h3.8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

/** Search glass for the lane's search seat. */
export function SearchIcon({ size = 16, className }: DocumentsIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.2 10.2 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Back chevron for the open-document return, top-left as in the thread view. */
export function BackIcon({ size = 16, className }: DocumentsIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Folder mark beside the DOCUMENTS brand name. */
export function FolderMarkIcon({ size = 22, className }: DocumentsIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.9 4.2a1 1 0 0 1 1-1h3l1.3 1.6h6.9a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}
