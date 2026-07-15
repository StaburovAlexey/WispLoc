import type { FactEvidence } from '@wisploc/shared'

export function validateTaskFieldsAgainstEvidence<T extends {
  assignee?: string
  dueDate?: string
  priority?: 'low' | 'medium' | 'high'
  explicitAssignee: boolean
  explicitDueDate: boolean
}>(task: T, evidence: FactEvidence[]): T {
  const evidenceText = evidence.map((item) => item.quote).join(' ').toLocaleLowerCase()
  const explicitAssignee = Boolean(task.explicitAssignee && task.assignee && evidenceText.includes(task.assignee.toLocaleLowerCase()))
  const explicitDueDate = Boolean(task.explicitDueDate && task.dueDate && evidenceText.includes(task.dueDate.toLocaleLowerCase()))
  const priority = task.priority && evidenceText.includes(task.priority.toLocaleLowerCase()) ? task.priority : undefined
  return {
    ...task,
    assignee: explicitAssignee ? task.assignee : undefined,
    dueDate: explicitDueDate ? task.dueDate : undefined,
    priority,
    explicitAssignee,
    explicitDueDate,
  }
}

