import type { DictionaryEntry } from '@wisploc/shared'
import { createHash } from 'node:crypto'
import { getPrisma } from '../database'

const prisma = getPrisma()

export async function listDictionaryEntries(): Promise<DictionaryEntry[]> {
  const records = await prisma.dictionaryEntry.findMany({ orderBy: { canonical: 'asc' } })
  return records.map(toDictionaryEntry)
}

export async function listActiveDictionaryEntries(): Promise<DictionaryEntry[]> {
  const records = await prisma.dictionaryEntry.findMany({
    where: { status: 'ACTIVE', confirmedByUser: true },
    orderBy: { canonical: 'asc' },
  })
  return records.map(toDictionaryEntry)
}

export function calculateDictionaryHash(entries: DictionaryEntry[]): string {
  const stable = entries
    .filter((entry) => entry.status === 'ACTIVE' && entry.confirmedByUser)
    .map((entry) => ({
      canonical: entry.canonical.trim(),
      aliases: [...entry.aliases].map((alias) => alias.trim()).sort((a, b) => a.localeCompare(b)),
      status: entry.status,
      version: 'normalization-v1',
    }))
    .sort((a, b) => a.canonical.localeCompare(b.canonical))
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

export async function createDictionaryEntry(input: { canonical: string; aliases: string[] }): Promise<DictionaryEntry> {
  const aliases = uniqueAliases(input.aliases, input.canonical)
  const record = await prisma.dictionaryEntry.create({
    data: { canonical: input.canonical.trim(), aliasesJson: JSON.stringify(aliases), confirmedByUser: true },
  })
  return toDictionaryEntry(record)
}

export async function updateDictionaryEntry(id: string, input: { canonical: string; aliases: string[] }): Promise<DictionaryEntry> {
  const aliases = uniqueAliases(input.aliases, input.canonical)
  const record = await prisma.dictionaryEntry.update({
    where: { id },
    data: { canonical: input.canonical.trim(), aliasesJson: JSON.stringify(aliases), confirmedByUser: true },
  })
  return toDictionaryEntry(record)
}

export async function setDictionaryEntryStatus(id: string, enabled: boolean): Promise<DictionaryEntry> {
  const record = await prisma.dictionaryEntry.update({
    where: { id },
    data: { status: enabled ? 'ACTIVE' : 'DISABLED' },
  })
  return toDictionaryEntry(record)
}

export async function deleteDictionaryEntry(id: string): Promise<void> {
  await prisma.dictionaryEntry.delete({ where: { id } })
}

function uniqueAliases(aliases: string[], canonical: string): string[] {
  const canonicalKey = canonical.trim().toLocaleLowerCase()
  const seen = new Set<string>()
  return aliases.map((value) => value.trim()).filter((value) => {
    const key = value.toLocaleLowerCase()
    if (!key || key === canonicalKey || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function toDictionaryEntry(record: {
  id: string
  canonical: string
  aliasesJson: string
  status: string
  confirmedByUser: boolean
  usageCount: number
  createdAt: Date
  updatedAt: Date
}): DictionaryEntry {
  return {
    id: record.id,
    canonical: record.canonical,
    aliases: parseStringArray(record.aliasesJson),
    status: record.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    confirmedByUser: record.confirmedByUser,
    usageCount: record.usageCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
