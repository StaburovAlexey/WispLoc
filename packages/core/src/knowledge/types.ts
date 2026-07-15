export type KnowledgeStage =
  | 'fact-extraction'
  | 'fact-repair'
  | 'fact-deduplication'
  | 'task-extraction'
  | 'summary-batch'
  | 'summary-final'
  | 'term-discovery'

export type KnowledgeLanguage = 'ru' | 'en'
export type ExampleQuality = 'gold' | 'reviewed' | 'synthetic'

export interface KnowledgeRule {
  id: string
  stage: KnowledgeStage
  language: KnowledgeLanguage
  title: string
  content: string
  version: string
  enabled: boolean
  priority: number
}

export interface KnowledgeExample {
  id: string
  stage: KnowledgeStage
  language: KnowledgeLanguage
  inputText: string
  expectedOutputJson: string
  labels: string[]
  quality: ExampleQuality
  enabled: boolean
  source: 'builtin' | 'user-correction' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface RetrievalRequest {
  stage: KnowledgeStage
  language: KnowledgeLanguage
  text: string
  labels?: string[]
  maxExamples?: number
  maxRuleCharacters?: number
  maxExampleCharacters?: number
  maxGlossaryEntries?: number
}

export interface RetrievalContext {
  ruleIds: string[]
  rules: string[]
  exampleIds: string[]
  examples: KnowledgeExample[]
  glossaryEntryIds: string[]
  glossary: Array<{ canonical: string; aliases: string[] }>
  retrievalVersion: string
  estimatedPromptTokens: number
  manifestHash: string
}

export interface UserCorrectionInput {
  mediaFileId: string
  processingJobId: string
  stage: KnowledgeStage
  sourceInput: string
  generatedOutputJson: string
  correctedOutputJson: string
  evidenceJson: string
}
