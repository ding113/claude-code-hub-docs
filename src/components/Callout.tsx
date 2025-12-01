import clsx from 'clsx'

import { Icon } from '@/components/Icon'

const styles = {
  note: {
    container:
      'bg-[var(--claude-sage)]/10 dark:bg-[var(--claude-sage)]/20 dark:ring-1 dark:ring-[var(--claude-sage)]/30',
    title: 'text-[var(--claude-sage)] dark:text-[var(--claude-sage)]',
    body: 'text-[var(--claude-walnut)] [--tw-prose-background:var(--claude-sage)/10] prose-a:text-[var(--claude-sage)] prose-code:text-[var(--claude-sage)] dark:text-[var(--claude-walnut)] dark:prose-code:text-[var(--claude-sage)]',
  },
  warning: {
    container:
      'bg-[var(--claude-amber)]/20 dark:bg-[var(--claude-amber)]/10 dark:ring-1 dark:ring-[var(--claude-amber)]/30',
    title: 'text-[var(--claude-ember-dark)] dark:text-[var(--claude-amber)]',
    body: 'text-[var(--claude-walnut)] [--tw-prose-underline:var(--claude-amber)] [--tw-prose-background:var(--claude-amber)/20] prose-a:text-[var(--claude-ember-dark)] prose-code:text-[var(--claude-ember-dark)] dark:text-[var(--claude-walnut)] dark:prose-code:text-[var(--claude-amber)]',
  },
}

const icons = {
  note: (props: { className?: string }) => <Icon icon="lightbulb" {...props} />,
  warning: (props: { className?: string }) => (
    <Icon icon="warning" color="amber" {...props} />
  ),
}

export function Callout({
  title,
  children,
  type = 'note',
}: {
  title: string
  children: React.ReactNode
  type?: keyof typeof styles
}) {
  const IconComponent = icons[type]

  return (
    <div className={clsx('my-8 flex rounded-3xl p-6', styles[type].container)}>
      <IconComponent className="h-8 w-8 flex-none" />
      <div className="ml-4 flex-auto">
        <p
          className={clsx('not-prose font-display text-xl', styles[type].title)}
        >
          {title}
        </p>
        <div className={clsx('prose mt-2.5', styles[type].body)}>
          {children}
        </div>
      </div>
    </div>
  )
}
