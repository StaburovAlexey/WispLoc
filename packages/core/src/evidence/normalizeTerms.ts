import type { DictionaryEntry, NormalizationReplacement, NormalizationResult } from '@wisploc/shared'

export function normalizeTerms(originalText: string, entries: DictionaryEntry[]): NormalizationResult {
  const aliases = buildUnambiguousAliases(entries)
  if (aliases.length === 0 || originalText.length === 0) {
    return { originalText, normalizedText: originalText, replacements: [] }
  }

  const pattern = aliases.map((item) => escapeRegex(item.alias)).join('|')
  const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(${pattern})(?![\\p{L}\\p{N}_])`, 'giu')
  const replacements: NormalizationReplacement[] = []
  let normalizedText = ''
  let cursor = 0

  for (const match of originalText.matchAll(regex)) {
    const startOffset = match.index ?? 0
    const original = match[0]
    const alias = aliases.find((item) => item.alias.toLocaleLowerCase() === original.toLocaleLowerCase())
    if (!alias) continue
    normalizedText += originalText.slice(cursor, startOffset) + alias.canonical
    replacements.push({
      original,
      canonical: alias.canonical,
      startOffset,
      endOffset: startOffset + original.length,
      dictionaryEntryId: alias.dictionaryEntryId,
    })
    cursor = startOffset + original.length
  }

  normalizedText += originalText.slice(cursor)
  return { originalText, normalizedText, replacements }
}

function buildUnambiguousAliases(entries: DictionaryEntry[]) {
  const candidates = new Map<string, Array<{ alias: string; canonical: string; dictionaryEntryId: string }>>()
  for (const entry of entries) {
    if (entry.status !== 'ACTIVE' || !entry.confirmedByUser) continue
    for (const alias of [...entry.aliases, entry.canonical].map((value) => value.trim()).filter(Boolean)) {
      const key = alias.toLocaleLowerCase()
      const values = candidates.get(key) ?? []
      values.push({ alias, canonical: entry.canonical, dictionaryEntryId: entry.id })
      candidates.set(key, values)
    }
  }

  return [...candidates.values()]
    .filter((values) => new Set(values.map((value) => value.canonical.toLocaleLowerCase())).size === 1)
    .map((values) => values[0])
    .sort((left, right) => right.alias.length - left.alias.length)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

