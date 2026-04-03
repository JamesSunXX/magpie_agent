import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CapabilityContext } from '../../../../core/capability/context.js'
import { RepoScanner } from '../../../../core/repo/index.js'
import { collectDocs } from '../../../../core/context/collectors/docs-collector.js'
import { loadConfig } from '../../../../platform/config/loader.js'
import { createConfiguredProvider } from '../../../../platform/providers/index.js'
import { generateWorkflowId, persistWorkflowSession, sessionDirFor } from '../../shared/runtime.js'
import type { DocsSyncPreparedInput, DocsSyncResult } from '../types.js'

export async function executeDocsSync(
  prepared: DocsSyncPreparedInput,
  ctx: CapabilityContext
): Promise<DocsSyncResult> {
  const config = loadConfig(ctx.configPath)
  const runtime = config.capabilities.docs_sync || {}
  const sessionId = generateWorkflowId('docs-sync')
  const sessionDir = sessionDirFor('docs-sync', sessionId)
  const reportPath = join(sessionDir, 'docs-sync-report.md')
  await mkdir(sessionDir, { recursive: true })

  const docs = collectDocs({
    cwd: ctx.cwd,
    patterns: runtime.docs_patterns,
  })
  const scanner = new RepoScanner(ctx.cwd, { ignore: ['node_modules', 'dist', '.git'] })
  const files = await scanner.scanFiles()
  const stats = scanner.getStats()

  const reviewer = createConfiguredProvider({
    logicalName: 'capabilities.docs_sync.reviewer',
    model: runtime.reviewer_model || config.analyzer.model,
    agent: runtime.reviewer_agent,
  }, config)
  reviewer.setCwd?.(ctx.cwd)
  const prompt = `You are performing a repo-aware documentation sync review.\n\nDocumentation files:\n${docs.map((doc) => `- ${doc.path}`).join('\n') || '(none found)'}\n\nRepository stats:\n- files: ${stats.totalFiles}\n- lines: ${stats.totalLines}\n- top source files: ${files.slice(0, 10).map((file) => file.relativePath).join(', ')}\n\n${prepared.apply === false ? 'Do not edit files. Produce a markdown brief listing stale docs, missing docs, and concrete update recommendations.' : 'Update the relevant docs in the repository, then summarize the changes in markdown.'}`
  const report = await reviewer.chat([{ role: 'user', content: prompt }])
  await writeFile(reportPath, report, 'utf-8')

  const session = {
    id: sessionId,
    capability: 'docs-sync' as const,
    title: 'Repo-aware docs sync',
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'completed' as const,
    summary: 'Documentation sync workflow completed.',
    artifacts: {
      reportPath,
    },
  }
  await persistWorkflowSession(session)

  return {
    status: 'completed',
    session,
  }
}
