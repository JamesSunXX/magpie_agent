import type { RoleOpenIssue, RoleRoundResult } from './types.js'

export function dedupeOpenIssues(issues: RoleOpenIssue[]): RoleOpenIssue[] {
  const deduped = new Map<string, RoleOpenIssue>()

  for (const issue of issues) {
    if (!deduped.has(issue.id)) {
      deduped.set(issue.id, issue)
    }
  }

  return Array.from(deduped.values())
}

export function createRoleRoundResult(input: RoleRoundResult): RoleRoundResult {
  return {
    ...input,
    openIssues: dedupeOpenIssues(input.openIssues),
    nextRoundBrief: input.nextRoundBrief.trim(),
  }
}
