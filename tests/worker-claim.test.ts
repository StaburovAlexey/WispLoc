import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)
const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const originalDatabaseUrl = process.env.DATABASE_URL

afterEach(() => {
  process.env.HOME = originalHome
  process.env.USERPROFILE = originalUserProfile
  process.env.DATABASE_URL = originalDatabaseUrl
  vi.resetModules()
})

describe('worker job claiming', () => {
  it('claims pending jobs atomically and does not return the same job twice', async () => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wisploc-worker-'))
    const databasePath = path.join(home, '.wisploc/data/wisploc.db')
    const databaseUrl = `file:${databasePath}`
    process.env.HOME = home
    delete process.env.USERPROFILE
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()

    await execFileAsync('pnpm', ['db:push'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 120_000,
    })

    vi.resetModules()
    const { getPrisma } = await import('../packages/core/src/database/index')
    const { claimNextPendingJob } = await import('../apps/worker/src/main')
    const prisma = getPrisma()

    try {
      const media = await prisma.mediaFile.create({
        data: {
          originalName: 'meeting.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 1024,
          sourcePath: path.join(home, '.wisploc/data/uploads/meeting.mp4'),
          status: 'UPLOADED',
        },
      })

      const first = await prisma.processingJob.create({
        data: { mediaFileId: media.id, type: 'full', status: 'PENDING', progress: 0 },
      })
      const second = await prisma.processingJob.create({
        data: { mediaFileId: media.id, type: 'full', status: 'PENDING', progress: 0 },
      })

      const claimed = await Promise.all([claimNextPendingJob(), claimNextPendingJob()])
      const ids = claimed.map((job) => job?.id).filter(Boolean)

      expect(new Set(ids).size).toBe(2)
      expect(ids).toEqual(expect.arrayContaining([first.id, second.id]))
      expect(await claimNextPendingJob()).toBeNull()

      const records = await prisma.processingJob.findMany({ orderBy: { createdAt: 'asc' } })
      expect(records.map((job) => job.status)).toEqual(['PROCESSING', 'PROCESSING'])
      expect(records.map((job) => job.attempts)).toEqual([1, 1])
    } finally {
      await prisma.$disconnect()
    }
  })
})
