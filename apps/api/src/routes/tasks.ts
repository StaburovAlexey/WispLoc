import type { FastifyInstance } from 'fastify'
import {
  listTasks,
  getTask,
  updateTask,
  approveTask,
  rejectTask,
} from '@wisploc/core'

export async function tasksRoutes(app: FastifyInstance) {
  // GET /api/media/:mediaId/tasks
  app.get('/api/media/:mediaId/tasks', async (req) => {
    const { mediaId } = req.params as { mediaId: string }
    return listTasks(mediaId)
  })

  // GET /api/tasks/:id
  app.get('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const task = await getTask(id)
    if (!task) return reply.status(404).send({ error: 'Task not found' })
    return task
  })

  // PATCH /api/tasks/:id
  app.patch('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as any
    const updated = await updateTask(id, {
      title: body.title,
      description: body.description,
      priority: body.priority,
      labels: body.labels,
      assigneeHint: body.assigneeHint,
      dueDateHint: body.dueDateHint,
    })
    return updated
  })

  // POST /api/tasks/:id/approve
  app.post('/api/tasks/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string }
    await approveTask(id)
    return { ok: true }
  })

  // POST /api/tasks/:id/reject
  app.post('/api/tasks/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string }
    await rejectTask(id)
    return { ok: true }
  })
}
