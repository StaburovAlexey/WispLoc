import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type PublishTag = 'beta' | 'latest'

const [tagArg = 'beta', ...extraPublishArgs] = process.argv.slice(2)
const tag = parseTag(tagArg)
const rootDir = path.resolve(import.meta.dirname, '..')
const manifestPath = path.join(rootDir, 'apps/launcher/package.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version: string }
const tarballPath = path.join(rootDir, 'dist-pack', `gilbertfrost-wisploc-${manifest.version}.tgz`)
const otp = process.env.NPM_OTP?.trim()
const npmToken = process.env.NPM_TOKEN?.trim() ?? readSavedNpmToken()
const tempDirs: string[] = []

if (!fs.existsSync(tarballPath)) {
  throw new Error(`Publish tarball is missing: ${path.relative(rootDir, tarballPath)}. Run pnpm pack:app first.`)
}

const publishArgs = [
  'publish',
  tarballPath,
  '--access',
  'public',
  '--tag',
  tag,
  ...extraPublishArgs,
]

if (otp && !extraPublishArgs.includes('--otp')) {
  publishArgs.push('--otp', otp)
}

if (npmToken && !hasArg(extraPublishArgs, '--userconfig')) {
  const tokenConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wisploc-npm-'))
  const tokenConfigPath = path.join(tokenConfigDir, '.npmrc')
  tempDirs.push(tokenConfigDir)
  fs.writeFileSync(tokenConfigPath, `//registry.npmjs.org/:_authToken=${npmToken}\n`, { mode: 0o600 })
  publishArgs.push('--userconfig', tokenConfigPath)
}

try {
  run('npm', publishArgs)
} finally {
  for (const tempDir of tempDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function parseTag(value: string): PublishTag {
  if (value === 'beta' || value === 'latest') return value
  throw new Error(`Unsupported publish tag "${value}". Use "beta" or "latest".`)
}

function hasArg(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

function readSavedNpmToken(): string | undefined {
  const userNpmrc = path.join(os.homedir(), '.npmrc')
  if (!fs.existsSync(userNpmrc)) return undefined

  const tokenMatch = fs
    .readFileSync(userNpmrc, 'utf-8')
    .match(/(?:^|\n)\s*(?:(?:\/\/registry\.npmjs\.org\/:)?_authToken)\s*=\s*([^\s]+)/)

  return tokenMatch?.[1]?.trim() || undefined
}

function run(command: string, args: string[]): void {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command
  const result = spawnSync(executable, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
}
