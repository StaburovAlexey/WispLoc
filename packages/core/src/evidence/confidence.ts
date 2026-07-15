export interface TaskConfidenceInput {
  quoteValidated: boolean
  timecodeValidated: boolean
  explicitAction: boolean
  explicitAssignee: boolean
  explicitDueDate: boolean
  multipleEvidenceItems: boolean
  contradiction?: boolean
  ambiguousQuote?: boolean
  repairUsed?: boolean
  segmentMatch?: boolean
  conflictingAssignees?: boolean
  conflictingDeadlines?: boolean
}

export function calculateTaskConfidence(input: TaskConfidenceInput): number {
  let confidence = 0
  if (input.quoteValidated) confidence += 0.35
  if (input.timecodeValidated) confidence += 0.15
  if (input.explicitAction) confidence += 0.2
  if (input.explicitAssignee) confidence += 0.1
  if (input.explicitDueDate) confidence += 0.1
  if (input.multipleEvidenceItems) confidence += 0.1
  if (input.contradiction) confidence -= 0.25
  if (input.ambiguousQuote) confidence -= 0.15
  if (input.repairUsed) confidence -= 0.1
  if (input.segmentMatch === false) confidence -= 0.15
  if (input.conflictingAssignees) confidence -= 0.2
  if (input.conflictingDeadlines) confidence -= 0.2
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100
}

