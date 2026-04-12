import { join } from 'path'

export interface RoleArtifactPaths {
  rolesPath: string
  messagesPath: string
  roundsDir: string
}

export function getRoleArtifactPaths(sessionDir: string): RoleArtifactPaths {
  return {
    rolesPath: join(sessionDir, 'roles.json'),
    messagesPath: join(sessionDir, 'messages.jsonl'),
    roundsDir: join(sessionDir, 'rounds'),
  }
}
