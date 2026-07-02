import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PATHS } from '@wisploc/shared'

let prisma: PrismaClient | null = null

export function ensureDatabaseEnv(): string {
  fs.mkdirSync(path.dirname(PATHS.database), { recursive: true })
  const databaseUrl = `file:${PATHS.database}`
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL === 'file:./dev.db') {
    process.env.DATABASE_URL = databaseUrl
  }
  return process.env.DATABASE_URL
}

export function getPrisma(): PrismaClient {
  ensureDatabaseEnv()
  prisma ??= new PrismaClient()
  return prisma
}
