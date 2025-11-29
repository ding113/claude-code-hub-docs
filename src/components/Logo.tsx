function LogomarkPaths() {
  return (
    <g fill="none" strokeLinejoin="round" strokeWidth={2}>
      {/* 路由/代理概念的抽象图标 - 三个节点通过中心连接 */}
      <circle
        cx="18"
        cy="18"
        r="6"
        className="fill-[var(--claude-terracotta)] stroke-[var(--claude-rust)]"
      />
      <circle
        cx="6"
        cy="10"
        r="3"
        className="fill-[var(--claude-ember)] stroke-[var(--claude-terracotta)]"
      />
      <circle
        cx="30"
        cy="10"
        r="3"
        className="fill-[var(--claude-ember)] stroke-[var(--claude-terracotta)]"
      />
      <circle
        cx="6"
        cy="26"
        r="3"
        className="fill-[var(--claude-ember)] stroke-[var(--claude-terracotta)]"
      />
      <circle
        cx="30"
        cy="26"
        r="3"
        className="fill-[var(--claude-ember)] stroke-[var(--claude-terracotta)]"
      />
      {/* 连接线 */}
      <path
        d="M9 12 L14 16"
        className="stroke-[var(--claude-terracotta)]"
        strokeWidth={1.5}
      />
      <path
        d="M27 12 L22 16"
        className="stroke-[var(--claude-terracotta)]"
        strokeWidth={1.5}
      />
      <path
        d="M9 24 L14 20"
        className="stroke-[var(--claude-terracotta)]"
        strokeWidth={1.5}
      />
      <path
        d="M27 24 L22 20"
        className="stroke-[var(--claude-terracotta)]"
        strokeWidth={1.5}
      />
    </g>
  )
}

export function Logomark(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" fill="none" {...props}>
      <LogomarkPaths />
    </svg>
  )
}

export function Logo(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 220 36" fill="none" {...props}>
      <LogomarkPaths />
      {/* Claude Code Hub 文字 */}
      <text
        x="44"
        y="24"
        className="fill-[var(--claude-ink)] dark:fill-[var(--claude-ink)]"
        style={{
          fontFamily: 'var(--font-display), system-ui, sans-serif',
          fontSize: '16px',
          fontWeight: 600,
          letterSpacing: '-0.02em',
        }}
      >
        Claude Code Hub
      </text>
    </svg>
  )
}
