import { createHash } from 'node:crypto'
import { listActiveDictionaryEntries } from '../dictionary'
import { createLogger } from '../logger'
import { inferRetrievalLabels, rankExamples, tokenizeKnowledgeText } from './lexicalSearch'
import { applyPromptBudget } from './promptBudget'
import { listKnowledgeExamples } from './repository'
import { rulesFor } from './rules'
import type { RetrievalContext, RetrievalRequest } from './types'
import { RETRIEVAL_VERSION } from './versions'

const ragLog = createLogger('local-rag', 'worker.log')

export async function buildRetrievalContext(request: RetrievalRequest, requestId?: string): Promise<RetrievalContext> {
  if (process.env.WISPLOC_RAG_ENABLED?.toLowerCase() === 'false') {
    const retrievalVersion = `${RETRIEVAL_VERSION}-disabled`
    const context: RetrievalContext = {
      ruleIds: [], rules: [], exampleIds: [], examples: [], glossaryEntryIds: [], glossary: [],
      retrievalVersion, estimatedPromptTokens: 0,
      manifestHash: createHash('sha256').update(retrievalVersion).digest('hex'),
    }
    ragLog.info('retrieval disabled for evaluation', { requestId, stage: request.stage, retrievalVersion })
    return context
  }
  const labels = [...new Set([...(request.labels ?? []), ...inferRetrievalLabels(request.text)])]
  const candidates = await listKnowledgeExamples(request.stage, request.language)
  const ranked = rankExamples({
    text: request.text,
    labels,
    examples: candidates,
    maxExamples: Math.min(4, Math.max(0, request.maxExamples ?? 3)),
  })
  const budget = applyPromptBudget({
    rules: rulesFor(request.stage, request.language),
    examples: ranked,
    maxRuleCharacters: request.maxRuleCharacters ?? 2_500,
    maxExampleCharacters: request.maxExampleCharacters ?? 4_000,
  })
  const glossary = await retrieveGlossary(request.text, request.maxGlossaryEntries ?? 8)
  const manifest = {
    retrievalVersion: RETRIEVAL_VERSION,
    rules: budget.rules.map((rule) => ({ id: rule.id, version: rule.version })),
    examples: budget.examples.map((example) => ({ id: example.id, updatedAt: example.updatedAt })),
    glossary: glossary.map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt })),
  }
  const context: RetrievalContext = {
    ruleIds: budget.rules.map((rule) => rule.id),
    rules: budget.rules.map((rule) => rule.content),
    exampleIds: budget.examples.map((example) => example.id),
    examples: budget.examples,
    glossaryEntryIds: glossary.map((entry) => entry.id),
    glossary: glossary.map(({ canonical, aliases }) => ({ canonical, aliases })),
    retrievalVersion: RETRIEVAL_VERSION,
    estimatedPromptTokens: budget.estimatedTokens + Math.ceil(JSON.stringify(glossary).length / 3.5),
    manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  }
  ragLog.info('retrieval context built', {
    requestId,
    stage: request.stage,
    retrievalVersion: context.retrievalVersion,
    ruleIds: context.ruleIds,
    exampleIds: context.exampleIds,
    glossaryEntryIds: context.glossaryEntryIds,
    estimatedPromptTokens: context.estimatedPromptTokens,
  })
  return context
}

export function formatRetrievalContext(context: RetrievalContext): string {
  const blocks: string[] = []
  if (context.rules.length > 0) blocks.push(`Relevant rules:\n${context.rules.map((rule) => `- ${rule}`).join('\n')}`)
  if (context.examples.length > 0) blocks.push(`Reviewed examples:\n${context.examples.map((example) => (
    `Input: ${example.inputText}\nExpected JSON: ${example.expectedOutputJson}`
  )).join('\n---\n')}`)
  if (context.glossary.length > 0) blocks.push(`Relevant confirmed terminology:\n${context.glossary.map((entry) => (
    `- ${entry.aliases.map((alias) => `"${alias}"`).join(', ')} -> ${entry.canonical}`
  )).join('\n')}`)
  return blocks.join('\n\n')
}

async function retrieveGlossary(text: string, limit: number) {
  const tokens = new Set(tokenizeKnowledgeText(text))
  const entries = await listActiveDictionaryEntries()
  return entries.filter((entry) => {
    const candidates = [entry.canonical, ...entry.aliases]
    return candidates.some((candidate) => {
      const normalized = candidate.toLocaleLowerCase()
      return text.toLocaleLowerCase().includes(normalized) || tokenizeKnowledgeText(candidate).some((token) => tokens.has(token))
    })
  }).slice(0, limit)
}
