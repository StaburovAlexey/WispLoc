import type { FastifyInstance } from 'fastify'
import {
  getLatestSummary,
  getChunkSummaries,
} from '@wisploc/core'

export async function summaryRoutes(app: FastifyInstance) {
  // GET /api/media/:mediaId/summary — latest final summary
  app.get('/api/media/:mediaId/summary', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    const summary = await getLatestSummary(mediaId)
    if (!summary) {
      return reply.status(404).send({ error: 'No summary found' })
    }
    return summary
  })

  // GET /api/media/:mediaId/summary/chunks — all chunk summaries
  app.get('/api/media/:mediaId/summary/chunks', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    return getChunkSummaries(mediaId)
  })

  // GET /api/media/:mediaId/export/summary.md
  app.get('/api/media/:mediaId/export/summary.md', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    const summary = await getLatestSummary(mediaId)
    if (!summary) {
      return reply.status(404).send({ error: 'No summary found' })
    }

    const md = buildMarkdown(summary)
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="summary-${mediaId}.md"`)
    return md
  })

  // GET /api/media/:mediaId/export/result.json
  app.get('/api/media/:mediaId/export/result.json', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    const summary = await getLatestSummary(mediaId)
    if (!summary) {
      return reply.status(404).send({ error: 'No summary found' })
    }

    reply.header('Content-Type', 'application/json')
    reply.header('Content-Disposition', `attachment; filename="result-${mediaId}.json"`)
    return summary
  })
}

function buildMarkdown(summary: any): string {
  const lines: string[] = []
  lines.push(`# Summary`)
  lines.push('')
  lines.push(summary.shortSummary ?? '')
  lines.push('')
  if (summary.detailedSummary) {
    lines.push('## Detailed Summary')
    lines.push('')
    lines.push(summary.detailedSummary)
    lines.push('')
  }
  if (summary.keyPoints?.length) {
    lines.push('## Key Points')
    lines.push('')
    for (const p of summary.keyPoints) lines.push(`- ${p}`)
    lines.push('')
  }
  if (summary.decisions?.length) {
    lines.push('## Decisions')
    lines.push('')
    for (const d of summary.decisions) lines.push(`- ${d}`)
    lines.push('')
  }
  if (summary.risks?.length) {
    lines.push('## Risks')
    lines.push('')
    for (const r of summary.risks) lines.push(`- ${r}`)
    lines.push('')
  }
  if (summary.openQuestions?.length) {
    lines.push('## Open Questions')
    lines.push('')
    for (const q of summary.openQuestions) lines.push(`- ${q}`)
    lines.push('')
  }
  if (summary.actionItems?.length) {
    lines.push('## Action Items')
    lines.push('')
    for (const a of summary.actionItems) lines.push(`- [ ] **${a.title}** — ${a.description}`)
    lines.push('')
  }
  return lines.join('\n')
}
