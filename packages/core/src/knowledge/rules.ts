import type { KnowledgeRule, KnowledgeStage } from './types'
import { KNOWLEDGE_RULE_VERSION } from './versions'

const RU_RULES: Record<KnowledgeStage, string> = {
  'fact-extraction': 'Извлекай только явно сказанные атомарные факты. Точная цитата обязательна. Предложение, вопрос и историческое действие не являются подтвержденной задачей или решением.',
  'fact-repair': 'Исправляй только структуру и привязку к дословной цитате из текущего фрагмента. Если подтверждения нет, не создавай замену.',
  'fact-deduplication': 'duplicate означает один смысл и одно утверждение. Уточнение, развитие, противоречие и похожая тема не являются duplicate.',
  'task-extraction': 'Задача требует явного обязательства выполнить действие: прямого поручения, принятой ответственности или согласованного действия. Не создавай задачу из пожелания, предложения, вопроса, гипотезы, прошлого или отмененного действия. Не выдумывай исполнителя и срок.',
  'summary-batch': 'Сжимай только подтвержденные факты. Решение должно быть явно принято; proposal и question сохраняй в своих разделах. Каждый пункт обязан сохранить sourceFactIds.',
  'summary-final': 'Объединяй частичные evidence-summary, удаляй повторы и не добавляй новые факты. Каждый структурированный пункт обязан сохранить sourceFactIds.',
  'term-discovery': 'Предлагай только технические термины, команды, библиотеки и имена с вероятной ASR-ошибкой. Обычные слова не являются терминами; предложения требуют ручного подтверждения.',
}

const EN_RULES: Record<KnowledgeStage, string> = {
  'fact-extraction': 'Extract only explicit atomic facts with an exact quote. A proposal, question, or historical action is not a confirmed task or decision.',
  'fact-repair': 'Repair only structure and exact evidence alignment. If the current chunk has no supporting quote, do not create a replacement.',
  'fact-deduplication': 'duplicate means the same assertion. Clarifications, developments, contradictions, and merely similar topics are not duplicates.',
  'task-extraction': 'A task requires an explicit action commitment. Exclude wishes, proposals, questions, hypotheticals, historical work, rejected plans, and cancelled actions. Never invent assignees or dates.',
  'summary-batch': 'Condense validated facts only. Keep decisions, proposals, and questions separate and preserve sourceFactIds for every item.',
  'summary-final': 'Merge partial evidence summaries without adding facts. Deduplicate and preserve sourceFactIds for every structured item.',
  'term-discovery': 'Suggest only technical terms, commands, libraries, and names likely corrupted by ASR. Suggestions always require user review.',
}

export const BUILTIN_RULES: KnowledgeRule[] = (Object.keys(RU_RULES) as KnowledgeStage[]).flatMap((stage) => ([
  { id: `builtin:${stage}:ru:v1`, stage, language: 'ru', title: stage, content: RU_RULES[stage], version: KNOWLEDGE_RULE_VERSION, enabled: true, priority: 100 },
  { id: `builtin:${stage}:en:v1`, stage, language: 'en', title: stage, content: EN_RULES[stage], version: KNOWLEDGE_RULE_VERSION, enabled: true, priority: 100 },
]))

export function rulesFor(stage: KnowledgeStage, language: 'ru' | 'en'): KnowledgeRule[] {
  return BUILTIN_RULES.filter((rule) => rule.enabled && rule.stage === stage && rule.language === language)
    .sort((a, b) => b.priority - a.priority)
}
