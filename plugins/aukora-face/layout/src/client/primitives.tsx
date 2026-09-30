import { forwardRef, useId, useState } from 'react'
import type {
  AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactElement, ReactNode, Ref, RefAttributes,
} from 'react'
import css from './Primitives.module.css'

export type Accent = 'blue' | 'green' | 'purple' | 'gold' | 'red-warning'
const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(' ')

type ActionStyle = { variant?: Accent; className?: string | undefined }
type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ActionStyle & { href?: never }
type ActionLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & ActionStyle & { href: string }

/** Native action or navigation, sharing the same outline and keyboard focus treatment. */
export const ActionButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, ActionButtonProps | ActionLinkProps>(
  function ActionButton({ variant = 'blue', className, ...props }, ref) {
    const style = classes(css.action, css[variant], className)
    if (typeof props.href === 'string') {
      return <a {...props as ActionLinkProps} ref={ref as Ref<HTMLAnchorElement>} className={style} data-aukora-action />
    }
    return <button type="button" {...props as ActionButtonProps} ref={ref as Ref<HTMLButtonElement>} className={style} data-aukora-action />
  },
) as {
  (props: ActionButtonProps & RefAttributes<HTMLButtonElement>): ReactElement
  (props: ActionLinkProps & RefAttributes<HTMLAnchorElement>): ReactElement
}

/** One dark-glass surface; consumers supply their own content and geometry. */
export const Panel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Panel({ className, ...props }, ref) {
    return <div {...props} ref={ref} className={classes(css.panel, className)} />
  },
)
export const Card = Panel

/** Keeps the caller's heading level, copy and controls intact. */
export const SectionHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function SectionHeader({ className, ...props }, ref) {
    return <header {...props} ref={ref} className={classes(css.sectionHeader, className)} />
  },
)

export interface PortalButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'children' | 'aria-expanded' | 'aria-controls'> {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  trailing?: ReactNode
  children?: ReactNode
  variant?: Accent
  expanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  buttonClassName?: string | undefined
  contentClassName?: string | undefined
  containerProps?: HTMLAttributes<HTMLDivElement> & { [name: `data-${string}`]: string | number | boolean | undefined }
  contentProps?: HTMLAttributes<HTMLDivElement>
  showIndicator?: boolean
}

/** A native disclosure: content opens directly below its button, never in an overlay. */
export const PortalButton = forwardRef<HTMLButtonElement, PortalButtonProps>(
  function PortalButton({
    title, subtitle, icon, trailing, children, variant = 'blue', expanded, defaultExpanded = false,
    onExpandedChange, onClick, className, buttonClassName, contentClassName, containerProps,
    contentProps, showIndicator = true, ...props
  }, ref) {
    const [localExpanded, setLocalExpanded] = useState(defaultExpanded)
    const open = expanded ?? localExpanded
    const contentId = useId()
    return (
      <Card {...containerProps} className={classes(css.portal, css[variant], className, containerProps?.className)} data-open={open ? 'yes' : 'no'}>
        <button {...props} type={props.type ?? 'button'} ref={ref} className={classes(css.portalButton, buttonClassName)}
          aria-expanded={open} aria-controls={contentId} onClick={event => {
            onClick?.(event)
            if (event.defaultPrevented) return
            if (expanded === undefined) setLocalExpanded(!open)
            onExpandedChange?.(!open)
          }}>
          {icon != null && <span className={css.portalIcon}>{icon}</span>}
          <span className={css.portalCopy}>
            <span className={css.portalTitle}>{title}</span>
            {subtitle != null && <span className={css.portalSubtitle}>{subtitle}</span>}
          </span>
          {trailing}
          {showIndicator && <span className={css.portalChevron} aria-hidden="true">{open ? '−' : '+'}</span>}
        </button>
        <div {...contentProps} id={contentId} hidden={!open} className={classes(css.portalContent, contentClassName, contentProps?.className)}>
          {open ? children : null}
        </div>
      </Card>
    )
  },
)
