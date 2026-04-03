import { inspectEnvironmentHealth } from './environment-health.js'
import { loadSessionDashboard } from './session-dashboard.js'
import type { DashboardSessions, EnvironmentHealth } from './types.js'

interface DashboardLoaderOptions {
  cwd: string
  configPath?: string
}

interface DashboardLoaderDependencies {
  loadSessions: (options: { cwd: string }) => Promise<DashboardSessions>
  inspectHealth: (options: { cwd: string; configPath?: string }) => Promise<EnvironmentHealth>
}

const defaultDependencies: DashboardLoaderDependencies = {
  loadSessions: loadSessionDashboard,
  inspectHealth: inspectEnvironmentHealth,
}

export async function refreshDashboardData(
  options: DashboardLoaderOptions,
  dependencies: DashboardLoaderDependencies = defaultDependencies
): Promise<{ sessions: DashboardSessions; health: EnvironmentHealth }> {
  const [sessions, health] = await Promise.all([
    dependencies.loadSessions({ cwd: options.cwd }),
    dependencies.inspectHealth({
      cwd: options.cwd,
      configPath: options.configPath,
    }),
  ])

  return {
    sessions,
    health,
  }
}
