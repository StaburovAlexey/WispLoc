import type { IntegrationAccountDto } from '@wisploc/shared'
import { getPrisma } from '../database'

const prisma = getPrisma()

export interface CreateIntegrationInput {
  provider: string
  displayName: string
  baseUrl?: string
  authType: string
  token: string
  organizationId?: string
  settingsJson?: string
}

export async function createIntegration(input: CreateIntegrationInput): Promise<IntegrationAccountDto> {
  const record = await prisma.integrationAccount.create({
    data: {
      provider: input.provider,
      displayName: input.displayName,
      baseUrl: input.baseUrl ?? null,
      authType: input.authType,
      encryptedToken: input.token, // TODO: encrypt before storing
      organizationId: input.organizationId ?? null,
      settingsJson: input.settingsJson ?? null,
    },
  })
  return toDto(record)
}

export async function listIntegrations(): Promise<IntegrationAccountDto[]> {
  const records = await prisma.integrationAccount.findMany({
    where: { provider: 'github' },
    orderBy: { createdAt: 'desc' },
  })
  return records.map(toDto)
}

export async function getIntegration(id: string) {
  const record = await prisma.integrationAccount.findUnique({ where: { id } })
  if (!record) return null
  return {
    ...toDto(record),
    token: record.encryptedToken, // include token for API calls
    organizationId: record.organizationId,
    settingsJson: record.settingsJson,
    baseUrl: record.baseUrl,
  }
}

export async function updateIntegration(
  id: string,
  input: Partial<CreateIntegrationInput>,
): Promise<IntegrationAccountDto> {
  const data: any = {}
  if (input.displayName !== undefined) data.displayName = input.displayName
  if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl
  if (input.token !== undefined) data.encryptedToken = input.token
  if (input.organizationId !== undefined) data.organizationId = input.organizationId
  if (input.settingsJson !== undefined) data.settingsJson = input.settingsJson

  const record = await prisma.integrationAccount.update({ where: { id }, data })
  return toDto(record)
}

export async function deleteIntegration(id: string): Promise<void> {
  await prisma.integrationAccount.delete({ where: { id } })
}

// ── Targets (cached queues/repos/projects) ─────────────
export async function saveTargets(
  integrationId: string,
  targets: Array<{ externalId: string; key?: string; name: string; type: string }>,
) {
  // Clear existing
  await prisma.integrationTarget.deleteMany({ where: { integrationId } })
  // Insert new
  for (const t of targets) {
    await prisma.integrationTarget.create({
      data: {
        integrationId,
        externalId: t.externalId,
        key: t.key ?? null,
        name: t.name,
        type: t.type,
      },
    })
  }
}

export async function getTargets(integrationId: string) {
  return prisma.integrationTarget.findMany({
    where: { integrationId },
    orderBy: { name: 'asc' },
  })
}

// ── External task creation ─────────────────────────────
export async function createExternalTaskRecord(input: {
  extractedTaskId: string
  provider: string
  integrationId: string
  externalId: string
  externalKey?: string
  externalUrl: string
  status: string
}) {
  return prisma.createdExternalTask.create({
    data: {
      extractedTaskId: input.extractedTaskId,
      provider: input.provider,
      integrationId: input.integrationId,
      externalId: input.externalId,
      externalKey: input.externalKey ?? null,
      externalUrl: input.externalUrl,
      status: input.status,
    },
  })
}

export async function getExternalTasksForExtracted(extractedTaskId: string) {
  return prisma.createdExternalTask.findMany({
    where: { extractedTaskId },
    orderBy: { createdAt: 'desc' },
  })
}

// ── internal ───────────────────────────────────────────
function toDto(record: any): IntegrationAccountDto {
  return {
    id: record.id,
    provider: record.provider,
    displayName: record.displayName,
    baseUrl: record.baseUrl,
    authType: record.authType,
    isEnabled: record.isEnabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}
