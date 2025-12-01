import clsx from 'clsx'
import Link from 'next/link'

const variantStyles = {
  primary:
    'rounded-full bg-[var(--claude-terracotta)] py-2 px-4 text-sm font-semibold text-white hover:bg-[var(--claude-rust)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--claude-terracotta)]/50 active:bg-[var(--claude-ember-dark)]',
  secondary:
    'rounded-full bg-[var(--claude-cloud)] py-2 px-4 text-sm font-medium text-[var(--claude-walnut)] hover:bg-[var(--claude-smoke)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--claude-smoke)]/50 active:text-[var(--claude-ink)] dark:bg-[var(--claude-sand)] dark:text-[var(--claude-walnut)] dark:hover:bg-[var(--claude-cloud)]',
}

type ButtonProps = {
  variant?: keyof typeof variantStyles
} & (
  | React.ComponentPropsWithoutRef<typeof Link>
  | (React.ComponentPropsWithoutRef<'button'> & { href?: undefined })
)

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonProps) {
  className = clsx(variantStyles[variant], className)

  return typeof props.href === 'undefined' ? (
    <button className={className} {...props} />
  ) : (
    <Link className={className} {...props} />
  )
}
