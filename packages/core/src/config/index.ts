import fs from 'node:fs'
import path from 'node:path'
import type { WispLocConfig } from '@wisploc/shared'
import { DEFAULT_CONFIG, PATHS } from '@wisploc/shared'

let cachedConfig: WispLocConfig | null = null

/** Load config from ~/.wisploc/config.json, falling back to defaults. */
export function loadConfig(): WispLocConfig {
  if (cachedConfig) return cachedConfig

  const configPath = PATHS.config
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const config: WispLocConfig = { ...DEFAULT_CONFIG, ...raw }
      cachedConfig = config
      return config
    } catch {
      // corrupted config → use defaults
    }
  }

  const config: WispLocConfig = { ...DEFAULT_CONFIG }
  cachedConfig = config
  return config
}

/** Save config to ~/.wisploc/config.json. */
export function saveConfig(config: WispLocConfig): void {
  const configPath = PATHS.config
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  cachedConfig = config
}

/** Get the Prisma datasource URL for the SQLite database. */
export function getDatabaseUrl(): string {
  return `file:${PATHS.database}`
}

/** Reload config (clears cache). */
export function reloadConfig(): WispLocConfig {
  cachedConfig = null
  return loadConfig()
}
