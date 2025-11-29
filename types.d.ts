import { type SearchOptions } from 'flexsearch'

declare module 'react-highlight-words' {
  import { ComponentType } from 'react'
  interface HighlighterProps {
    autoEscape?: boolean
    highlightClassName?: string
    highlightTag?: string | ComponentType<{ children: React.ReactNode }>
    searchWords: string[]
    textToHighlight: string
    [key: string]: unknown
  }
  const Highlighter: ComponentType<HighlighterProps>
  export default Highlighter
}

declare module '@/markdoc/search.mjs' {
  export type Result = {
    url: string
    title: string
    pageTitle?: string
  }

  export function search(query: string, options?: SearchOptions): Array<Result>
}
