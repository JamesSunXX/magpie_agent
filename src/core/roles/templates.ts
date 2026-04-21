import type { RoleType } from './types.js'

export type CollaborationTemplateId = 'small_task' | 'formal_requirement' | 'issue_fix' | 'docs_sync'

export interface CollaborationTemplateRole {
  roleType: RoleType
  responsibility: string
}

export interface CollaborationTemplate {
  id: CollaborationTemplateId
  title: string
  whenToUse: string
  roles: CollaborationTemplateRole[]
}

export const COLLABORATION_TEMPLATES: CollaborationTemplate[] = [
  {
    id: 'small_task',
    title: 'Small task',
    whenToUse: 'Use for narrow local changes that can move through loop without a full delivery review.',
    roles: [
      { roleType: 'architect', responsibility: 'Clarify the minimum change and checks.' },
      { roleType: 'developer', responsibility: 'Implement the change.' },
      { roleType: 'tester', responsibility: 'Run focused verification.' },
    ],
  },
  {
    id: 'formal_requirement',
    title: 'Formal requirement',
    whenToUse: 'Use for harness delivery from PRD to implementation and review closure.',
    roles: [
      { roleType: 'architect', responsibility: 'Plan the delivery path and constraints.' },
      { roleType: 'developer', responsibility: 'Make the implementation change.' },
      { roleType: 'tester', responsibility: 'Check tests and evidence.' },
      { roleType: 'reviewer', responsibility: 'Review correctness, risk, and gaps.' },
      { roleType: 'arbitrator', responsibility: 'Decide whether to approve, revise, or block.' },
    ],
  },
  {
    id: 'issue_fix',
    title: 'Issue fix',
    whenToUse: 'Use for diagnosis-first bug or failure remediation.',
    roles: [
      { roleType: 'architect', responsibility: 'Identify likely cause and repair boundary.' },
      { roleType: 'developer', responsibility: 'Apply the repair.' },
      { roleType: 'tester', responsibility: 'Prove the original failure no longer reproduces.' },
      { roleType: 'reviewer', responsibility: 'Check regression risk.' },
    ],
  },
  {
    id: 'docs_sync',
    title: 'Docs sync',
    whenToUse: 'Use for documentation drift and project knowledge updates.',
    roles: [
      { roleType: 'architect', responsibility: 'Identify source of truth and affected docs.' },
      { roleType: 'developer', responsibility: 'Update the documentation.' },
      { roleType: 'reviewer', responsibility: 'Check accuracy and reader readiness.' },
    ],
  },
]

export function getCollaborationTemplate(id: CollaborationTemplateId): CollaborationTemplate {
  const template = COLLABORATION_TEMPLATES.find((candidate) => candidate.id === id)
  if (!template) {
    throw new Error(`Unknown collaboration template: ${id}`)
  }
  return template
}
