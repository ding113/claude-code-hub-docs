export interface Result {
  url: string
  title: string
  pageTitle?: string
  [key: string]: unknown
}

export interface SearchOptions {
  limit?: number
}

export declare function search(query: string, options?: SearchOptions): Result[]
