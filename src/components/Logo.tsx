import Image from 'next/image'

export function Logomark(props: React.ComponentPropsWithoutRef<'div'>) {
  const { className, ...rest } = props
  return (
    <div className={`relative h-9 w-9 shrink-0 ${className || ''}`} {...rest}>
      <Image
        src="/favicon.png"
        alt="Claude Code Hub"
        width={36}
        height={36}
        className="h-full w-full rounded-full object-contain"
        priority
      />
    </div>
  )
}

export function Logo(props: React.ComponentPropsWithoutRef<'div'>) {
  const { className, ...rest } = props
  return (
    <div
      className={`flex flex-row items-center gap-3 ${className || ''}`}
      {...rest}
    >
      <div className="relative h-9 w-9 shrink-0">
        <Image
          src="/favicon.png"
          alt="Claude Code Hub"
          width={36}
          height={36}
          className="h-full w-full rounded-full object-contain"
          priority
        />
      </div>
      <span
        className="whitespace-nowrap text-[var(--claude-ink)] dark:text-[var(--claude-ink)]"
        style={{
          fontFamily: 'var(--font-display), system-ui, sans-serif',
          fontSize: '16px',
          fontWeight: 600,
          letterSpacing: '-0.02em',
        }}
      >
        Claude Code Hub
      </span>
    </div>
  )
}
