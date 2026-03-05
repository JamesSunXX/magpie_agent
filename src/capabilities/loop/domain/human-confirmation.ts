import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { HumanConfirmationItem } from '../../../state/types.js'

const START_MARKER = '<!-- MAGPIE_HUMAN_CONFIRMATION_START -->'
const END_MARKER = '<!-- MAGPIE_HUMAN_CONFIRMATION_END -->'
const CODE_FENCE = '```'

interface RawHumanConfirmationItem {
  id: string
  session_id: string
  stage: string
  status: string
  decision: string
  rationale?: string
  reason: string
  artifacts?: string[]
  next_action: string
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
    rationale: item.rationale,
    reason: item.reason,
    artifacts: item.artifacts,
    next_action: item.nextAction,
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
    rationale: raw.rationale,
    reason: raw.reason,
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    nextAction: raw.next_action,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
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
