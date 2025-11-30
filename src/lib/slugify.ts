import { slugifyWithCounter as originalSlugifyWithCounter } from '@sindresorhus/slugify'

/**
 * Creates a slugify function that handles Unicode characters (including Chinese).
 * Falls back to a Unicode-safe slug when @sindresorhus/slugify returns empty.
 */
export function slugifyWithCounter() {
  const latinSlugify = originalSlugifyWithCounter()
  const seenSlugs = new Map<string, number>()

  return function slugify(text: string): string {
    // First try the original slugify (works well for Latin characters)
    let slug = latinSlugify(text)

    // If empty (e.g., Chinese text), create a Unicode-friendly slug
    if (!slug) {
      slug = text
        .toLowerCase()
        .trim()
        // Replace whitespace with hyphens
        .replace(/\s+/g, '-')
        // Remove characters that are problematic in URLs/IDs but keep Unicode letters/numbers
        .replace(/[^\p{L}\p{N}\-_]/gu, '')
        // Collapse multiple hyphens
        .replace(/-+/g, '-')
        // Remove leading/trailing hyphens
        .replace(/^-+|-+$/g, '')
    }

    // Handle duplicates by appending a counter
    if (!slug) {
      slug = 'heading'
    }

    const count = seenSlugs.get(slug) ?? 0
    seenSlugs.set(slug, count + 1)

    if (count > 0) {
      return `${slug}-${count}`
    }

    return slug
  }
}
