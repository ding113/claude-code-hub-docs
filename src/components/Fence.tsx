'use client'

import clsx from 'clsx'
import { Highlight } from 'prism-react-renderer'
import { Fragment, useState } from 'react'

function CopyIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
      />
    </svg>
  )
}

function CheckIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75l6 6 9-13.5"
      />
    </svg>
  )
}

export function Fence({
  children,
  language,
}: {
  children: string
  language?: string
}) {
  const [copied, setCopied] = useState(false)
  const lang = language || 'text'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children.trimEnd())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={handleCopy}
        className={clsx(
          'absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md transition-all',
          'opacity-0 group-hover:opacity-100 focus:opacity-100',
          'bg-[var(--claude-cloud)]/80 hover:bg-[var(--claude-smoke)]/80',
          'dark:bg-[var(--claude-smoke)]/50 dark:hover:bg-[var(--claude-smoke)]/80',
          'ring-1 ring-[var(--claude-smoke)]/30',
          copied && 'text-[var(--claude-sage)]',
        )}
        aria-label={copied ? '已复制' : '复制代码'}
      >
        {copied ? (
          <CheckIcon className="h-4 w-4" />
        ) : (
          <CopyIcon className="h-4 w-4 text-[var(--claude-walnut)]/70 dark:text-[var(--claude-walnut)]/70" />
        )}
      </button>
      <Highlight
        code={children.trimEnd()}
        language={lang}
        theme={{ plain: {}, styles: [] }}
      >
        {({ className, style, tokens, getTokenProps }) => (
          <pre
            className={clsx(
              className,
              'rounded-xl bg-[var(--claude-sand)] p-4 text-sm shadow-lg overflow-x-auto',
              'dark:bg-[var(--claude-cloud)]/60 dark:shadow-none dark:ring-1 dark:ring-[var(--claude-smoke)]/20',
            )}
            style={style}
          >
            <code>
              {tokens.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {line
                    .filter((token) => !token.empty)
                    .map((token, tokenIndex) => (
                      <span key={tokenIndex} {...getTokenProps({ token })} />
                    ))}
                  {'\n'}
                </Fragment>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    </div>
  )
}
