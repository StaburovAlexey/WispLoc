import type { KnowledgeExample, KnowledgeStage } from './types'

const now = '2026-01-01T00:00:00.000Z'
const taskCases: Array<[string, string, string[]]> = [
  ['Иван, исправь ошибку до пятницы.', '{"tasks":[{"title":"Исправить ошибку","assignee":"Иван","dueDate":"до пятницы","explicitAction":true}]}', ['explicit-task']],
  ['Я исправлю ошибку сегодня.', '{"tasks":[{"title":"Исправить ошибку","explicitAction":true}]}', ['explicit-task']],
  ['Давайте, возможно, перепишем модуль.', '{"tasks":[]}', ['not-a-task','proposal']],
  ['Может нам обновить React?', '{"tasks":[]}', ['not-a-task','question']],
  ['Вчера я обновил Prisma.', '{"tasks":[]}', ['not-a-task','historical-action']],
  ['Обновить API отменяется.', '{"tasks":[]}', ['not-a-task','cancelled-decision']],
  ['Сначала обновим API. Нет, оставляем как есть.', '{"tasks":[]}', ['not-a-task','rejected-plan']],
  ['Решили перенести релиз на понедельник.', '{"tasks":[]}', ['decision','not-a-task']],
  ['Нужно, чтобы система сохраняла логи.', '{"tasks":[]}', ['requirement','not-a-task']],
  ['Алексей берет на себя подготовку релиза.', '{"tasks":[{"title":"Подготовить релиз","assignee":"Алексей","explicitAction":true}]}', ['explicit-task']],
  ['Подготовьте README. Исполнитель не определен.', '{"tasks":[{"title":"Подготовить README","explicitAction":true}]}', ['explicit-task','missing-assignee']],
  ['Мария проверит сборку.', '{"tasks":[{"title":"Проверить сборку","assignee":"Мария","explicitAction":true}]}', ['explicit-task','missing-deadline']],
  ['Надо бы когда-нибудь почистить код.', '{"tasks":[]}', ['not-a-task','proposal']],
  ['Почему тесты падают?', '{"tasks":[]}', ['not-a-task','question']],
  ['Проблема: FFmpeg не установлен.', '{"tasks":[]}', ['problem','not-a-task']],
  ['Олег, установи FFmpeg и проверь ffprobe.', '{"tasks":[{"title":"Установить FFmpeg","assignee":"Олег","explicitAction":true},{"title":"Проверить ffprobe","assignee":"Олег","explicitAction":true}]}', ['explicit-task','multiple-actions']],
  ['Срок был пятница, теперь согласовали среду.', '{"tasks":[]}', ['decision','changed-deadline']],
  ['Сначала делает Иван, теперь задачу берет Ольга.', '{"tasks":[{"title":"Выполнить согласованную задачу","assignee":"Ольга","explicitAction":true}]}', ['explicit-task','changed-assignee']],
  ['Если будет время, можно добавить кеш.', '{"tasks":[]}', ['not-a-task','proposal']],
  ['Клиент просил добавить экспорт.', '{"tasks":[]}', ['not-a-task','historical-action']],
  ['Добавляем экспорт, договорились.', '{"tasks":[{"title":"Добавить экспорт","explicitAction":true}]}', ['explicit-task','decision']],
  ['Не добавляем экспорт в этот релиз.', '{"tasks":[]}', ['not-a-task','rejected-plan']],
  ['Пусть кто-нибудь посмотрит логи.', '{"tasks":[{"title":"Посмотреть логи","explicitAction":true}]}', ['explicit-task','missing-assignee']],
  ['Можно ли проверить Windows?', '{"tasks":[]}', ['not-a-task','question']],
  ['Проверяем Windows перед релизом.', '{"tasks":[{"title":"Проверить Windows перед релизом","explicitAction":true}]}', ['explicit-task']],
  ['Я бы хотел темную тему.', '{"tasks":[]}', ['not-a-task','proposal']],
  ['Сделай темную тему.', '{"tasks":[{"title":"Сделать темную тему","explicitAction":true}]}', ['explicit-task']],
  ['Сделал темную тему на прошлой неделе.', '{"tasks":[]}', ['not-a-task','historical-action']],
  ['Нам обязательно нужна локальная SQLite.', '{"tasks":[]}', ['requirement','not-a-task']],
  ['Переведи хранение на SQLite.', '{"tasks":[{"title":"Перевести хранение на SQLite","explicitAction":true}]}', ['explicit-task']],
  ['Задачу по OAuth больше не выполняем.', '{"tasks":[]}', ['not-a-task','cancelled-decision']],
  ['Саша проверит API, а Лена обновит документацию.', '{"tasks":[{"title":"Проверить API","assignee":"Саша","explicitAction":true},{"title":"Обновить документацию","assignee":"Лена","explicitAction":true}]}', ['explicit-task','multiple-actions']],
]

const otherCases: Array<[KnowledgeStage, string, string, string[]]> = [
  ['fact-extraction','{"segments":[{"id":"s1","text":"Решили использовать SQLite."}]}','{"facts":[{"type":"decision","text":"Решили использовать SQLite","sourceSegmentIds":["s1"],"explicit":true}]}',['decision']],
  ['fact-extraction','{"segments":[{"id":"s1","text":"Может использовать SQLite?"}]}','{"facts":[{"type":"question","text":"Обсуждается возможность использовать SQLite","sourceSegmentIds":["s1"],"explicit":true}]}',['question']],
  ['fact-extraction','{"segments":[{"id":"s1","text":"FFmpeg не найден."}]}','{"facts":[{"type":"problem","text":"FFmpeg не найден","sourceSegmentIds":["s1"],"explicit":true}]}',['problem','technical-term']],
  ['fact-extraction','{"segments":[{"id":"s1","text":"Нужно поддержать Windows."}]}','{"facts":[{"type":"requirement","text":"Нужна поддержка Windows","sourceSegmentIds":["s1"],"explicit":true}]}',['requirement']],
  ['fact-extraction','{"segments":[{"id":"s1","text":"Давайте добавим RAG."}]}','{"facts":[{"type":"proposal","text":"Предложено добавить RAG","sourceSegmentIds":["s1"],"explicit":true}]}',['proposal']],
  ['fact-extraction','{"segments":[{"id":"s1","text":"Алексей исправит parser."}]}','{"facts":[{"type":"task_candidate","text":"Алексей исправит parser","sourceSegmentIds":["s1"],"explicit":true}]}',['explicit-task']],
  ['fact-extraction','{"segments":[{"id":"s1","text":"[тишина]"}]}','{"facts":[]}',['not-a-task']],
  ['fact-extraction','{"segments":[{"id":"s1","text":"Продолжим позже, конкретных решений нет."}]}','{"facts":[]}',['not-a-task']],
  ['fact-repair','Цитата отсутствует в исходном фрагменте.','{"facts":[]}',['invalid-quote']],
  ['fact-deduplication','FFmpeg не найден. || FFmpeg отсутствует.','{"relation":"duplicate"}',['duplicate']],
  ['fact-deduplication','Добавить Windows. || Не добавлять Windows.','{"relation":"contradiction"}',['contradiction']],
  ['fact-deduplication','Исправить API. || Исправить UI.','{"relation":"different"}',['different']],
  ['summary-batch','decision: выбрали SQLite','{"decisions":[{"text":"Выбрали SQLite","sourceFactIds":["f1"]}]}',['decision']],
  ['summary-batch','proposal: попробовать RAG','{"proposals":[{"text":"Предложено попробовать RAG","sourceFactIds":["f1"]}]}',['proposal']],
  ['summary-final','partial summaries with duplicate decisions','{"decisions":[{"text":"Выбрали SQLite","sourceFactIds":["f1"]}]}',['duplicate']],
  ['term-discovery','висп лок использует эф эф эмпег','{"suggestions":[{"observedForm":"висп лок","proposedCanonical":"WispLoc"},{"observedForm":"эф эф эмпег","proposedCanonical":"FFmpeg"}]}',['asr-error','technical-term']],
  ['term-discovery','обычный разговор без терминов','{"suggestions":[]}',['not-a-task']],
  ['term-discovery','прайзма и фастифай','{"suggestions":[{"observedForm":"прайзма","proposedCanonical":"Prisma"},{"observedForm":"фастифай","proposedCanonical":"Fastify"}]}',['asr-error','technical-term']],
  ['summary-batch','problem: Ollama недоступна','{"problems":[{"text":"Ollama недоступна","sourceFactIds":["f1"]}]}',['problem']],
  ['summary-final','question remains unresolved','{"openQuestions":[{"text":"Как поддержать Windows?","sourceFactIds":["f1"]}]}',['question']],
]

export const BUILTIN_EXAMPLES: KnowledgeExample[] = [
  ...taskCases.map(([inputText, expectedOutputJson, labels], index) => makeExample(
    `task-${index + 1}`,
    'task-extraction',
    JSON.stringify({ facts: [{ id: 'f1', type: labels.includes('explicit-task') ? 'task_candidate' : 'statement', text: inputText }] }),
    normalizeTaskExample(expectedOutputJson),
    labels,
  )),
  ...otherCases.map(([stage, inputText, expectedOutputJson, labels], index) => makeExample(`other-${index + 1}`, stage, inputText, expectedOutputJson, labels)),
]

function normalizeTaskExample(value: string): string {
  const parsed = JSON.parse(value) as { tasks?: Array<Record<string, unknown>> }
  return JSON.stringify({
    tasks: (parsed.tasks ?? []).map((task) => ({
      ...task,
      description: typeof task.description === 'string' ? task.description : '',
      sourceFactIds: ['f1'],
      explicitAssignee: typeof task.assignee === 'string',
      explicitDueDate: typeof task.dueDate === 'string',
    })),
  })
}

function makeExample(id: string, stage: KnowledgeStage, inputText: string, expectedOutputJson: string, labels: string[]): KnowledgeExample {
  return { id: `builtin:${id}`, stage, language: 'ru', inputText, expectedOutputJson, labels, quality: 'gold', enabled: true, source: 'builtin', createdAt: now, updatedAt: now }
}
