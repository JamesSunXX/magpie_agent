import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { HumanConfirmationItem } from '../../../core/state/index.js'

const START_MARKER = '<!-- MAGPIE_HUMAN_CONFIRMATION_START -->'
const END_MARKER = '<!-- MAGPIE_HUMAN_CONFIRMATION_END -->'
const CODE_FENCE = '```'

interface RawHumanConfirmationItem {
  id: string
  session_id: string
  stage: string
  status: string
  decision: string
  summary?: string
  recommendation?: string
  rationale?: string
  reason: string
  artifacts?: string[]
  next_action: string
  parent_id?: string
  discussion_session_id?: string
  discussion_output_path?: string
  created_at: string
  updated_at: string
}

function toRaw(item: HumanConfirmationItem): RawHumanConfirmationItem {
  return {
    id: item.id,
    session_id: item.sessionId,
    stage: item.stage,
    status: item.status,
    decision: item.decision,
    summary: item.summary,
    recommendation: item.recommendation,
    rationale: item.rationale,
    reason: item.reason,
    artifacts: item.artifacts,
    next_action: item.nextAction,
    parent_id: item.parentId,
    discussion_session_id: item.discussionSessionId,
    discussion_output_path: item.discussionOutputPath,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  }
}

function toItem(raw: RawHumanConfirmationItem): HumanConfirmationItem {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    stage: raw.stage as HumanConfirmationItem['stage'],
    status: raw.status as HumanConfirmationItem['status'],
    decision: raw.decision as HumanConfirmationItem['decision'],
    summary: raw.summary,
    recommendation: raw.recommendation as HumanConfirmationItem['recommendation'] | undefined,
    rationale: raw.rationale,
    reason: raw.reason,
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    nextAction: raw.next_action,
    parentId: raw.parent_id,
    discussionSessionId: raw.discussion_session_id,
    discussionOutputPath: raw.discussion_output_path,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  }
}

function renderHumanConfirmationFile(items: HumanConfirmationItem[]): string {
  if (items.length === 0) {
    return '# Human Confirmation Queue\n'
  }

  return `# Human Confirmation Queue\n\n${items.map((item) => renderHumanConfirmationBlock(item)).join('\n\n')}\n`
}

async function rewriteHumanConfirmationItems(filePath: string, items: HumanConfirmationItem[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, renderHumanConfirmationFile(items), 'utf-8')
}

function findItemLineNumber(content: string, itemId: string): number {
  const blocks = content.split(START_MARKER)
  if (blocks.length <= 1) {
    return content.split('\n').length
  }

  let consumed = blocks[0]
  for (let index = 1; index < blocks.length; index += 1) {
    const block = `${START_MARKER}${blocks[index]}`
    if (block.includes(`id: ${itemId}`)) {
      return consumed.split('\n').length
    }
    consumed += block
  }

  return content.split('\n').length
}

export function summarizeHumanConfirmationReason(reason: string): {
  summary: string
  reason: string
  recommendation: 'approve' | 'reject'
} {
  const parts = reason
    .split(/[\n;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const limited = parts.slice(0, 3)

  return {
    summary: `${parts.length} items need a decision before continuing.`,
    reason: limited.join('; '),
    recommendation: 'reject',
  }
}

export function renderHumanConfirmationBlock(item: HumanConfirmationItem): string {
  const yaml = stringifyYaml(toRaw(item)).trimEnd()
  return [
    START_MARKER,
    '',
    `${CODE_FENCE}yaml`,
    yaml,
    CODE_FENCE,
    END_MARKER,
  ].join('\n')
}

export function parseHumanConfirmationBlocks(content: string): HumanConfirmationItem[] {
  const blocks: HumanConfirmationItem[] = []
  const markerPattern = `${START_MARKER}[\\s\\S]*?${CODE_FENCE}yaml\\s*([\\s\\S]*?)${CODE_FENCE}[\\s\\S]*?${END_MARKER}`
  const regex = new RegExp(markerPattern, 'g')

  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const yamlText = match[1]
    const parsed = parseYaml(yamlText) as RawHumanConfirmationItem | null
    if (parsed?.id && parsed?.session_id) {
      blocks.push(toItem(parsed))
    }
  }

  return blocks
}

export async function appendHumanConfirmationItem(filePath: string, item: HumanConfirmationItem): Promise<number> {
  await mkdir(dirname(filePath), { recursive: true })

  let existing = ''
  try {
    existing = await readFile(filePath, 'utf-8')
  } catch {
    existing = '# Human Confirmation Queue\n\n'
  }

  const block = renderHumanConfirmationBlock(item)
  const next = `${existing.trimEnd()}\n\n${block}\n`
  await writeFile(filePath, next, 'utf-8')

  const markerIndex = next.lastIndexOf(START_MARKER)
  if (markerIndex < 0) {
    return next.split('\n').length
  }

  // 1-based line number for the newly appended marker
  return next.slice(0, markerIndex).split('\n').length
}

export async function loadHumanConfirmationItems(filePath: string): Promise<HumanConfirmationItem[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return parseHumanConfirmationBlocks(content)
  } catch {
    return []
  }
}

export async function findHumanConfirmationDecision(
  filePath: string,
  itemId: string
): Promise<HumanConfirmationItem | null> {
  const items = await loadHumanConfirmationItems(filePath)
  return items.find((item) => item.id === itemId) || null
}

export async function findLatestPendingHumanConfirmationForSession(
  filePath: string,
  sessionId: string
): Promise<HumanConfirmationItem | null> {
  const items = await loadHumanConfirmationItems(filePath)
  return findLatestPendingHumanConfirmationInQueue(items, sessionId)
}

export function findLatestPendingHumanConfirmationInQueue(
  items: HumanConfirmationItem[],
  sessionId: string
): HumanConfirmationItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.sessionId === sessionId && item.decision === 'pending' && item.status === 'pending') {
      return item
    }
  }
  return null
}

export async function syncSessionHumanConfirmationProjection(
  filePath: string,
  sessionId: string,
  sessionItems: HumanConfirmationItem[]
): Promise<number | null> {
  const existingItems = await loadHumanConfirmationItems(filePath)
  const otherSessions = existingItems.filter((item) => item.sessionId !== sessionId)
  const nextItems = [...otherSessions, ...sessionItems]
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())

  await rewriteHumanConfirmationItems(filePath, nextItems)
  if (sessionItems.length === 0) {
    return null
  }

  const focusItem = sessionItems[sessionItems.length - 1]
  const content = await readFile(filePath, 'utf-8')
  return findItemLineNumber(content, focusItem.id)
}

export async function updateHumanConfirmationItem(
  filePath: string,
  itemId: string,
  patch: Partial<HumanConfirmationItem>
): Promise<number | null> {
  const items = await loadHumanConfirmationItems(filePath)
  const index = items.findIndex((item) => item.id === itemId)
  if (index < 0) {
    return null
  }

  items[index] = {
    ...items[index],
    ...patch,
  }
  await rewriteHumanConfirmationItems(filePath, items)
  const content = await readFile(filePath, 'utf-8')
  return findItemLineNumber(content, itemId)
}
