import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type PackageJson = {
  name: string
  version: string
  type?: string
  main?: string
  types?: string
  exports?: unknown
  bin?: Record<string, string>
  dependencies?: Record<string, string>
}

const rootDir = path.resolve(import.meta.dirname, '..')
const outDir = path.join(rootDir, 'dist-pack')
const packageDir = path.join(outDir, 'package')

const bundledPackages = [
  { source: 'apps/api', name: '@wisploc/api', include: ['dist', 'src', 'package.json'] },
  { source: 'apps/worker', name: '@wisploc/worker', include: ['dist', 'src', 'package.json'] },
  { source: 'apps/web', name: '@wisploc/web', include: ['dist', 'package.json'] },
  { source: 'packages/core', name: '@wisploc/core', include: ['dist', 'src', 'prisma', 'package.json'] },
  { source: 'packages/shared', name: '@wisploc/shared', include: ['dist', 'src', 'package.json'] },
  { source: 'packages/integrations', name: '@wisploc/integrations', include: ['dist', 'src', 'package.json'] },
]

const launcher = readPackageJson(path.join(rootDir, 'apps/launcher/package.json'))
const dependencies = collectRuntimeDependencies()

resetDir(outDir)
fs.mkdirSync(packageDir, { recursive: true })

copyPath(path.join(rootDir, 'apps/launcher/dist'), path.join(packageDir, 'dist'))
copyOptional(path.join(rootDir, 'README.md'), path.join(packageDir, 'README.md'))
copyOptional(path.join(rootDir, 'README.ru.md'), path.join(packageDir, 'README.ru.md'))

for (const bundledPackage of bundledPackages) {
  const targetDir = path.join(packageDir, 'node_modules', ...bundledPackage.name.split('/'))
  fs.mkdirSync(targetDir, { recursive: true })

  for (const entry of bundledPackage.include) {
    if (entry === 'package.json') {
      writeBundledPackageJson(path.join(rootDir, bundledPackage.source, entry), path.join(targetDir, entry))
    } else {
      copyPath(path.join(rootDir, bundledPackage.source, entry), path.join(targetDir, entry))
    }
  }
}

patchEsmImports(packageDir)

const packageJson = {
  name: '@gilbertfrost/wisploc',
  version: launcher.version,
  description: 'Local web UI for processing long audio/video files',
  type: 'module',
  main: './dist/main.js',
  bin: {
    wisploc: './dist/main.js',
  },
  scripts: {
    postinstall: 'prisma generate --schema node_modules/@wisploc/core/prisma/schema.prisma',
  },
  engines: {
    node: '>=22.0.0',
  },
  publishConfig: {
    access: 'public',
  },
  dependencies,
  bundledDependencies: bundledPackages.map((item) => item.name),
}

fs.writeFileSync(path.join(packageDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)

run('npm', ['pack', packageDir, '--pack-destination', outDir])

function collectRuntimeDependencies(): Record<string, string> {
  const packagePaths = [
    'apps/launcher/package.json',
    ...bundledPackages
      .filter((item) => item.name !== '@wisploc/web')
      .map((item) => path.join(item.source, 'package.json')),
  ]
  const output: Record<string, string> = {}
  const rootPackage = readPackageJson(path.join(rootDir, 'package.json'))

  output.prisma = rootPackage.devDependencies?.prisma ?? '^6.3.0'

  for (const packagePath of packagePaths) {
    const manifest = readPackageJson(path.join(rootDir, packagePath))
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith('@wisploc/')) {
        output[name] = launcher.version
        continue
      }
      output[name] = version
    }
  }

  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

function readPackageJson(filePath: string): PackageJson {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PackageJson
}

function writeBundledPackageJson(source: string, target: string): void {
  const manifest = readPackageJson(source)
  const output = {
    name: manifest.name,
    version: launcher.version,
    type: manifest.type,
    main: manifest.main,
    types: manifest.types,
    exports: manifest.exports,
  }

  fs.writeFileSync(target, `${JSON.stringify(removeUndefined(output), null, 2)}\n`)
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, nestedValue]) => nestedValue !== undefined))
}

function resetDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

function copyOptional(source: string, target: string): void {
  if (fs.existsSync(source)) copyPath(source, target)
}

function copyPath(source: string, target: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`Required package artifact is missing: ${path.relative(rootDir, source)}`)
  }
  fs.cpSync(source, target, { recursive: true, dereference: true })
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

function patchEsmImports(dir: string): void {
  for (const filePath of listFiles(dir)) {
    if (!filePath.endsWith('.js')) continue
    const original = fs.readFileSync(filePath, 'utf-8')
    const patched = original
      .replace(/(\bfrom\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, prefix, specifier, suffix) => {
        return `${prefix}${resolveEsmSpecifier(filePath, specifier)}${suffix}`
      })
      .replace(/(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g, (_match, prefix, specifier, suffix) => {
        return `${prefix}${resolveEsmSpecifier(filePath, specifier)}${suffix}`
      })
      .replace(/(\bimport\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, prefix, specifier, suffix) => {
        return `${prefix}${resolveEsmSpecifier(filePath, specifier)}${suffix}`
      })

    if (patched !== original) {
      fs.writeFileSync(filePath, patched)
    }
  }
}

function resolveEsmSpecifier(importer: string, specifier: string): string {
  if (path.extname(specifier)) return specifier

  const absoluteTarget = path.resolve(path.dirname(importer), specifier)
  if (fs.existsSync(`${absoluteTarget}.js`)) return `${specifier}.js`
  if (fs.existsSync(path.join(absoluteTarget, 'index.js'))) return `${specifier}/index.js`
  return specifier
}

function listFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}
