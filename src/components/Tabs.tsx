'use client'

import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import clsx from 'clsx'
import { Children, isValidElement, type ReactNode } from 'react'

interface TabItemProps {
  label: string
  children: ReactNode
}

// Individual Tab component - just passes through props for parent to extract
export function TabItem({ children }: TabItemProps) {
  return <>{children}</>
}

interface TabsProps {
  children: ReactNode
}

// Container component that builds the actual tabs UI
export function Tabs({ children }: TabsProps) {
  // Extract labels and content from TabItem children
  const tabs: { label: string; content: ReactNode }[] = []

  Children.forEach(children, (child) => {
    if (isValidElement<TabItemProps>(child) && child.props.label) {
      tabs.push({
        label: child.props.label,
        content: child.props.children,
      })
    }
  })

  if (tabs.length === 0) {
    return <>{children}</>
  }

  return (
    <div className="my-6">
      <TabGroup>
        <TabList className="not-prose flex gap-1 rounded-xl bg-[var(--claude-cloud)] p-1 dark:bg-[var(--claude-smoke)]/30">
          {tabs.map((tab, index) => (
            <Tab
              key={index}
              className={clsx(
                'rounded-lg px-3 py-2 text-sm font-medium outline-none transition-all',
                'text-[var(--claude-walnut)]/70 hover:text-[var(--claude-walnut)]',
                'data-[selected]:bg-white data-[selected]:text-[var(--claude-ink)] data-[selected]:shadow-sm',
                'dark:data-[selected]:bg-[var(--claude-cloud)] dark:data-[selected]:text-[var(--claude-parchment)]',
                'focus-visible:ring-2 focus-visible:ring-[var(--claude-sage)] focus-visible:ring-offset-2',
              )}
            >
              {tab.label}
            </Tab>
          ))}
        </TabList>
        <TabPanels className="mt-4">
          {tabs.map((tab, index) => (
            <TabPanel
              key={index}
              className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--claude-sage)] focus-visible:ring-offset-2"
            >
              {tab.content}
            </TabPanel>
          ))}
        </TabPanels>
      </TabGroup>
    </div>
  )
}
