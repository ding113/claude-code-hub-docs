import clsx from 'clsx'

export function Prose<T extends React.ElementType = 'div'>({
  as,
  className,
  ...props
}: React.ComponentPropsWithoutRef<T> & {
  as?: T
}) {
  const Component = as ?? 'div'

  return (
    <Component
      className={clsx(
        className,
        'prose max-w-none dark:prose-invert',
        'prose-headings:text-[var(--claude-ink)] prose-p:text-[var(--claude-walnut)] prose-strong:text-[var(--claude-ink)]',
        // headings
        'prose-headings:scroll-mt-28 prose-headings:font-display prose-headings:font-normal lg:prose-headings:scroll-mt-34',
        // lead
        'prose-lead:text-[var(--claude-walnut)]/80',
        // links - use darker rust for text
        'prose-a:font-semibold prose-a:text-[var(--claude-rust)] dark:prose-a:text-[var(--claude-ember)]',
        // link underline - semi-transparent light amber/yellow
        '[--tw-prose-background:var(--claude-paper)] prose-a:no-underline prose-a:shadow-[inset_0_-2px_0_0_var(--tw-prose-background),inset_0_calc(-1*(var(--tw-prose-underline-size,4px)+2px))_0_0_rgba(238,192,125,0.4)] prose-a:hover:[--tw-prose-underline-size:6px] dark:[--tw-prose-background:var(--claude-paper)] dark:prose-a:shadow-[inset_0_-2px_0_0_var(--tw-prose-background),inset_0_calc(-1*(var(--tw-prose-underline-size,4px)+2px))_0_0_rgba(245,212,160,0.35)]',
        // pre
        'prose-pre:rounded-xl prose-pre:bg-[var(--claude-sand)] prose-pre:shadow-lg dark:prose-pre:bg-[var(--claude-cloud)]/60 dark:prose-pre:shadow-none dark:prose-pre:ring-1 dark:prose-pre:ring-[var(--claude-smoke)]/20',
        // hr
        'prose-hr:border-[var(--claude-smoke)]/30',
        // code
        'prose-code:text-[var(--claude-rust)] dark:prose-code:text-[var(--claude-ember)]',
        // lists
        'prose-li:text-[var(--claude-walnut)] marker:text-[var(--claude-terracotta)]',
      )}
      {...props}
    />
  )
}
