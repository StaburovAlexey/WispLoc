import type { EvaluationFixture } from './types'

export const EVIDENCE_EVALUATION_FIXTURES: EvaluationFixture[] = [
  {
    id: 'explicit-assignee-deadline',
    transcript: 'Иван, исправь ошибку авторизации до пятницы. Иван: беру задачу.',
    expectedFacts: [{ type: 'task_candidate', text: 'Иван исправит ошибку авторизации до пятницы.' }],
    expectedTasks: [{ title: 'Исправить ошибку авторизации', assignee: 'Иван', dueDate: 'до пятницы' }],
    forbiddenTasks: [], requiredSummaryTerms: ['ошибка авторизации'],
  },
  {
    id: 'proposal-without-commitment',
    transcript: 'Давайте, возможно, перепишем модуль авторизации. Решение пока не принимаем.',
    expectedFacts: [{ type: 'proposal', text: 'Предложено переписать модуль авторизации.' }],
    expectedTasks: [], forbiddenTasks: ['переписать модуль авторизации'], requiredSummaryTerms: ['решение пока не принято'],
  },
  {
    id: 'superseded-decision',
    transcript: 'Сначала решили выпустить релиз в пятницу. После проверки решение изменили: релиз переносим на среду.',
    expectedFacts: [{ type: 'decision', text: 'Релиз перенесён на среду.' }],
    expectedTasks: [], forbiddenTasks: ['выпустить релиз в пятницу'], requiredSummaryTerms: ['релиз', 'среду'],
  },
  {
    id: 'cancelled-task',
    transcript: 'Олег проверит Windows. Нет, проверку Windows в этом релизе отменяем.',
    expectedFacts: [{ type: 'decision', text: 'Проверка Windows в этом релизе отменена.' }],
    expectedTasks: [], forbiddenTasks: ['проверить Windows'], requiredSummaryTerms: ['отменена'],
  },
  {
    id: 'technical-asr-terms',
    transcript: 'В висп лок не находится эф эф проб. Нужно сохранить названия WispLoc, FFmpeg и ffprobe.',
    expectedFacts: [{ type: 'problem', text: 'WispLoc не находит ffprobe.' }],
    expectedTasks: [], forbiddenTasks: [], requiredSummaryTerms: ['WispLoc', 'ffprobe'],
  },
  {
    id: 'conflicting-assignees',
    transcript: 'Сначала задачу берёт Иван. Нет, договорились, что итоговую проверку выполнит Ольга.',
    expectedFacts: [{ type: 'task_candidate', text: 'Ольга выполнит итоговую проверку.' }],
    expectedTasks: [{ title: 'Выполнить итоговую проверку', assignee: 'Ольга' }],
    forbiddenTasks: ['Иван выполнит итоговую проверку'], requiredSummaryTerms: ['Ольга'],
  },
  {
    id: 'discussion-without-tasks',
    transcript: 'Обсудили скорость локальных моделей. Были разные мнения, конкретных действий не согласовали.',
    expectedFacts: [{ type: 'statement', text: 'Обсуждалась скорость локальных моделей.' }],
    expectedTasks: [], forbiddenTasks: ['ускорить модель', 'заменить модель'], requiredSummaryTerms: ['локальных моделей'],
  },
  {
    id: 'middle-information',
    transcript: 'Начали с интерфейса. Затем явно решили хранить evidenceQuote и sourceFactIds для каждого факта. После этого обсуждали цвета.',
    expectedFacts: [{ type: 'decision', text: 'Для каждого факта будут храниться evidenceQuote и sourceFactIds.' }],
    expectedTasks: [], forbiddenTasks: [], requiredSummaryTerms: ['evidenceQuote', 'sourceFactIds'],
  },
  {
    id: 'problem-without-action',
    transcript: 'На слабом устройстве Ollama отвечает медленно. Решений и поручений по этому вопросу пока нет.',
    expectedFacts: [{ type: 'problem', text: 'На слабом устройстве Ollama отвечает медленно.' }],
    expectedTasks: [], forbiddenTasks: ['ускорить Ollama'], requiredSummaryTerms: ['Ollama', 'медленно'],
  },
  {
    id: 'two-explicit-actions',
    transcript: 'Мария, обнови README и проверь production build до понедельника.',
    expectedFacts: [
      { type: 'task_candidate', text: 'Мария обновит README до понедельника.' },
      { type: 'task_candidate', text: 'Мария проверит production build до понедельника.' },
    ],
    expectedTasks: [
      { title: 'Обновить README', assignee: 'Мария', dueDate: 'до понедельника' },
      { title: 'Проверить production build', assignee: 'Мария', dueDate: 'до понедельника' },
    ],
    forbiddenTasks: [], requiredSummaryTerms: ['README', 'production build'],
  },
]
