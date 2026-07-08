import fs from 'node:fs'
import path from 'node:path'
import { PATHS } from '@wisploc/shared'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogFields = Record<string, unknown>

const MAX_LOG_BYTES = 5 * 1024 * 1024
const REDACTED = '[redacted]'
const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|key)/i

export interface WispLogger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

export function createLogger(scope: string, fileName = 'wisploc.log'): WispLogger {
  return {
    debug: (message, fields) => writeLog(fileName, 'debug', scope, message, fields),
    info: (message, fields) => writeLog(fileName, 'info', scope, message, fields),
    warn: (message, fields) => writeLog(fileName, 'warn', scope, message, fields),
    error: (message, fields) => writeLog(fileName, 'error', scope, message, fields),
  }
}

export function diagnosticsPaths(): string[] {
  return [
    path.join(PATHS.logs, 'wisploc.log'),
    path.join(PATHS.logs, 'setup.log'),
    path.join(PATHS.logs, 'worker.log'),
    path.join(PATHS.logs, 'maintenance.log'),
  ]
}

function writeLog(
  fileName: string,
  level: LogLevel,
  scope: string,
  message: string,
  fields: LogFields = {},
): void {
  try {
    fs.mkdirSync(PATHS.logs, { recursive: true })
    const filePath = path.join(PATHS.logs, fileName)
    rotateIfNeeded(filePath)

    const entry = {
      time: new Date().toISOString(),
      level,
      scope,
      message,
      ...(sanitize(fields) as LogFields),
    }

    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf-8')
  } catch {
    // Logging must never break user workflows.
  }
}

function rotateIfNeeded(filePath: string): void {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size < MAX_LOG_BYTES) return

    const rotatedPath = `${filePath}.1`
    fs.rmSync(rotatedPath, { force: true })
    fs.renameSync(filePath, rotatedPath)
  } catch {}
}

function sanitize(value: unknown): unknown {
  if (value instanceof Error) return serializeError(value)
  if (Array.isArray(value)) return value.map((item) => sanitize(item))
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(record)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitize(nestedValue)
  }
  return output
}

function serializeError(error: Error): LogFields {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 12).join('\n'),
  }
}
