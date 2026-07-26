// Why: these limits must match desktop cache/fetch behavior, but mobile cannot
// import root shared modules at runtime because Metro resolves from mobile/.
export const PER_REPO_FETCH_LIMIT = 36
export const CROSS_REPO_DISPLAY_LIMIT = 100

export type Dev10xWorkItem = {
  id: string
  identifier: string
  title: string
  description?: string
  projectSlug: string
  projectName: string
  status: string
  updatedAt: string
  agent?: string | null
  agentState: string
  blockedBy: string[]
  subtaskCount: number
  pendingApproval: boolean
  pendingQuestion: boolean
  url?: string | null
}

export type Dev10xWorkItemsResult = {
  items: Dev10xWorkItem[]
  totalCount: number
}

type TaskRequestClient = {
  sendRequest(
    method: string,
    params: unknown
  ): Promise<
    { ok: true; result: unknown } | { ok: false; error?: { code?: string; message?: string } }
  >
}

export async function fetchDev10xWorkItems(
  client: TaskRequestClient,
  input: { query?: string; projectSlugs?: string[]; limit?: number }
): Promise<Dev10xWorkItemsResult> {
  const params = {
    ...(input.query?.trim() ? { query: input.query.trim() } : {}),
    ...(input.projectSlugs?.length ? { projectSlugs: input.projectSlugs } : {}),
    ...(input.limit ? { limit: input.limit } : {})
  }
  const response = await client.sendRequest('symphony.tasks.list', params)
  if (!response.ok) {
    throw new Error(response.error?.message || 'Failed to load Dev10x tasks')
  }
  if (!isDev10xWorkItemsEnvelope(response.result)) {
    throw new Error('Unexpected Symphony task response')
  }
  return {
    items: response.result.items,
    totalCount: response.result.totalCount
  }
}

function isDev10xWorkItemsEnvelope(
  value: unknown
): value is Dev10xWorkItemsResult & { provider: 'symphony' } {
  if (!value || typeof value !== 'object') {
    return false
  }
  const envelope = value as Record<string, unknown>
  if (
    envelope.provider !== 'symphony' ||
    !Array.isArray(envelope.items) ||
    typeof envelope.totalCount !== 'number'
  ) {
    return false
  }
  return envelope.items.every((item) => {
    if (!item || typeof item !== 'object') {
      return false
    }
    const record = item as Record<string, unknown>
    return (
      typeof record.id === 'string' &&
      typeof record.identifier === 'string' &&
      typeof record.title === 'string' &&
      typeof record.projectSlug === 'string' &&
      typeof record.projectName === 'string' &&
      typeof record.status === 'string' &&
      typeof record.updatedAt === 'string' &&
      typeof record.agentState === 'string' &&
      Array.isArray(record.blockedBy) &&
      typeof record.subtaskCount === 'number' &&
      typeof record.pendingApproval === 'boolean' &&
      typeof record.pendingQuestion === 'boolean'
    )
  })
}

const GITHUB_WORK_ITEMS_SSH_REMOTE_REQUIRED_MESSAGE =
  'GitHub work items require a GitHub remote for SSH repositories'

export function isGitHubWorkItemsSshRemoteRequiredError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
      ? error.message
      : typeof error === 'string'
      ? error
      : ''

  return message.includes(GITHUB_WORK_ITEMS_SSH_REMOTE_REQUIRED_MESSAGE)
}
