export type StageNotificationEventType =
  | 'stage_entered'
  | 'stage_completed'
  | 'stage_failed'
  | 'stage_paused'
  | 'stage_resumed'

export interface StageAiActor {
  id: string
  role: string
}

export interface StageNotificationSummaryInput {
  eventType: StageNotificationEventType
  sessionId: string
  capability: 'loop' | 'harness'
  runTitle: string
  projectName?: string
  projectPath?: string
  stage: string
  occurrence: number
  summary: string
  nextAction?: string
  blocker?: string
  aiRoster: StageAiActor[]
}

export interface StageNotificationMessage {
  title: string
  body: string
}

function eventLabel(eventType: StageNotificationEventType): string {
  switch (eventType) {
    case 'stage_entered':
      return '进入'
    case 'stage_completed':
      return '完成'
    case 'stage_failed':
      return '失败'
    case 'stage_paused':
      return '暂停'
    case 'stage_resumed':
      return '恢复'
  }
}

export function buildFallbackStageNotificationMessage(
  input: StageNotificationSummaryInput,
  maxChars?: number
): StageNotificationMessage {
  const titleParts = [
    'Magpie',
    input.projectName,
    input.capability,
    input.sessionId,
    input.stage,
    eventLabel(input.eventType),
  ].filter(Boolean)
  const title = titleParts.join(' | ')
  const lines = [
    `任务: ${input.runTitle}`,
    `项目: ${input.projectName || 'unknown'}`,
    `路径: ${input.projectPath || 'unknown'}`,
    `状态: ${eventLabel(input.eventType)}`,
    `阶段: ${input.stage}`,
    `次数: 第 ${input.occurrence} 次`,
    `摘要: ${input.summary}`,
    `AI: ${input.aiRoster.map((item) => item.id).join(' / ') || 'unknown'}`,
    `分工: ${input.aiRoster.map((item) => `${item.id}: ${item.role}`).join('；') || 'unknown'}`,
    `阻塞: ${input.blocker || '无'}`,
    `下一步: ${input.nextAction || '待定'}`,
  ]
  const body = lines.join('\n')
  return {
    title,
    body: typeof maxChars === 'number' && maxChars > 0 ? body.slice(0, maxChars) : body,
  }
}

export function buildStageSummaryPrompt(input: StageNotificationSummaryInput): string {
  return [
    '请把下面的阶段事件整理成适合飞书发送的简短中文通知。',
    '要求：',
    '1. 返回 JSON。',
    '2. 字段只有 title 和 body。',
    '3. title 必须包含项目名和 session 信息。',
    '4. body 必须包含任务、项目名、项目路径、状态、阶段、AI 列表、AI 分工、下一步。',
    '5. 如果是失败或暂停，要明确原因。',
    '',
    '```json',
    '{"title":"...","body":"..."}',
    '```',
    '',
    `sessionId: ${input.sessionId}`,
    `capability: ${input.capability}`,
    `eventType: ${input.eventType}`,
    `runTitle: ${input.runTitle}`,
    `projectName: ${input.projectName || 'unknown'}`,
    `projectPath: ${input.projectPath || 'unknown'}`,
    `stage: ${input.stage}`,
    `occurrence: ${input.occurrence}`,
    `summary: ${input.summary}`,
    `blocker: ${input.blocker || '无'}`,
    `nextAction: ${input.nextAction || '待定'}`,
    `aiRoster: ${input.aiRoster.map((item) => `${item.id} => ${item.role}`).join(' | ') || 'unknown'}`,
  ].join('\n')
}
