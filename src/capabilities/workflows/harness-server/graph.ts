import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

import { getRepoSessionDir } from '../../../platform/paths.js'

export type HarnessGraphStatus =
  | 'pending'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'failed'

export type HarnessGraphNodeState =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting_retry'
  | 'waiting_approval'
  | 'blocked'
  | 'completed'
  | 'failed'

export type HarnessGraphNodeType =
  | 'feature'
  | 'integration'
  | 'migration'
  | 'validation'
  | 'approval'

export type HarnessGraphApprovalScope =
  | 'graph_confirmation'
  | 'before_dispatch'
  | 'before_completion'

export interface HarnessGraphApprovalGate {
  gateId: string
  label: string
  scope: HarnessGraphApprovalScope
  status: 'pending' | 'approved' | 'rejected'
  decidedAt?: string
  decidedBy?: string
  note?: string
}

export interface HarnessGraphExecutionLink {
  capability: 'loop' | 'harness'
  sessionId: string
}

export interface HarnessGraphNodeInput {
  id: string
  title: string
  goal: string
  type: HarnessGraphNodeType
  stageDocumentPath?: string
  dependencies?: string[]
  state?: HarnessGraphNodeState
  conflictScope?: string
  riskMarkers?: string[]
  approvalGates?: HarnessGraphApprovalGate[]
  execution?: HarnessGraphExecutionLink
  statusReason?: string
}

export interface HarnessGraphArtifactInput {
  graphId: string
  title: string
  goal: string
  sourceRequirementPath?: string
  createdAt?: string
  updatedAt?: string
  nodes: HarnessGraphNodeInput[]
  approvalGates?: HarnessGraphApprovalGate[]
}

export interface HarnessGraphNode extends Omit<HarnessGraphNodeInput, 'dependencies' | 'state' | 'riskMarkers' | 'approvalGates'> {
  dependencies: string[]
  state: HarnessGraphNodeState
  riskMarkers: string[]
  approvalGates: HarnessGraphApprovalGate[]
}

export interface HarnessGraphRollup {
  total: number
  pending: number
  ready: number
  running: number
  waitingRetry: number
  waitingApproval: number
  blocked: number
  completed: number
  failed: number
}

export interface HarnessGraphArtifact {
  version: 1
  graphId: string
  title: string
  goal: string
  sourceRequirementPath?: string
  createdAt: string
  updatedAt: string
  status: HarnessGraphStatus
  approvalGates: HarnessGraphApprovalGate[]
  rollup: HarnessGraphRollup
  nodes: HarnessGraphNode[]
}

export interface HarnessGraphReadiness {
  readyNodeIds: string[]
}

export interface HarnessGraphApprovalDecisionInput {
  nodeId?: string
  gateId?: string
  decision: 'approved' | 'rejected'
  decidedAt?: string
  decidedBy?: string
  note?: string
}

function getHarnessGraphArtifactPath(cwd: string, sessionId: string): string {
  return join(getRepoSessionDir(cwd, 'harness', sessionId), 'graph.json')
}

function normalizeNode(input: HarnessGraphNodeInput): HarnessGraphNode {
  return {
    ...input,
    dependencies: [...new Set(input.dependencies || [])],
    state: input.state || 'pending',
    riskMarkers: [...new Set(input.riskMarkers || [])],
    approvalGates: [...(input.approvalGates || [])],
  }
}

function validateGraphId(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`Harness graph ${label} must not be empty`)
  }
}

function validateNodes(nodes: HarnessGraphNode[]): void {
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    validateGraphId(node.id, 'node ID')
    validateGraphId(node.title, 'node title')
    validateGraphId(node.goal, 'node goal')
    if (nodeIds.has(node.id)) {
      throw new Error(`Harness graph node IDs must be unique: ${node.id}`)
    }
    nodeIds.add(node.id)
  }

  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!nodeIds.has(dependency)) {
        throw new Error(`Harness graph dependency refers to unknown node: ${node.id} -> ${dependency}`)
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  const walk = (nodeId: string, trail: string[]): void => {
    if (visiting.has(nodeId)) {
      const cycleStart = trail.indexOf(nodeId)
      const cycleTrail = trail.slice(cycleStart).concat(nodeId)
      throw new Error(`Harness graph contains a dependency cycle: ${cycleTrail.join(' -> ')}`)
    }
    if (visited.has(nodeId)) {
      return
    }

    visiting.add(nodeId)
    const node = nodes.find((entry) => entry.id === nodeId)
    for (const dependency of node?.dependencies || []) {
      walk(dependency, [...trail, nodeId])
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
  }

  for (const node of nodes) {
    walk(node.id, [])
  }
}

export function summarizeHarnessGraphNodes(nodes: HarnessGraphNode[]): HarnessGraphRollup {
  return nodes.reduce<HarnessGraphRollup>((acc, node) => {
    acc.total += 1
    if (node.state === 'pending') {
      acc.pending += 1
    } else if (node.state === 'ready') {
      acc.ready += 1
    } else if (node.state === 'running') {
      acc.running += 1
    } else if (node.state === 'waiting_retry') {
      acc.waitingRetry += 1
    } else if (node.state === 'waiting_approval') {
      acc.waitingApproval += 1
    } else if (node.state === 'blocked') {
      acc.blocked += 1
    } else if (node.state === 'completed') {
      acc.completed += 1
    } else if (node.state === 'failed') {
      acc.failed += 1
    }
    return acc
  }, {
    total: 0,
    pending: 0,
    ready: 0,
    running: 0,
    waitingRetry: 0,
    waitingApproval: 0,
    blocked: 0,
    completed: 0,
    failed: 0,
  })
}

export function deriveHarnessGraphStatus(rollup: HarnessGraphRollup): HarnessGraphStatus {
  if (rollup.failed > 0) {
    return 'failed'
  }
  if (rollup.total > 0 && rollup.completed === rollup.total) {
    return 'completed'
  }
  if (rollup.blocked > 0 && rollup.ready === 0 && rollup.running === 0 && rollup.waitingRetry === 0) {
    return 'blocked'
  }
  if (
    rollup.ready > 0
    || rollup.running > 0
    || rollup.waitingRetry > 0
    || rollup.waitingApproval > 0
    || rollup.completed > 0
  ) {
    return 'active'
  }
  return 'pending'
}

export function createHarnessGraphArtifact(input: HarnessGraphArtifactInput): HarnessGraphArtifact {
  validateGraphId(input.graphId, 'ID')
  validateGraphId(input.title, 'title')
  validateGraphId(input.goal, 'goal')

  const createdAt = input.createdAt || new Date().toISOString()
  const updatedAt = input.updatedAt || createdAt
  const nodes = input.nodes.map((node) => normalizeNode(node))

  validateNodes(nodes)

  const rollup = summarizeHarnessGraphNodes(nodes)
  return {
    version: 1,
    graphId: input.graphId,
    title: input.title,
    goal: input.goal,
    ...(input.sourceRequirementPath ? { sourceRequirementPath: input.sourceRequirementPath } : {}),
    createdAt,
    updatedAt,
    status: deriveHarnessGraphStatus(rollup),
    approvalGates: [...(input.approvalGates || [])],
    rollup,
    nodes,
  }
}

function findDecisionGateIndex(gates: HarnessGraphApprovalGate[], gateId?: string): number {
  if (gates.length === 0) {
    throw new Error('Harness graph approval target has no gates to decide')
  }

  if (gateId) {
    const gateIndex = gates.findIndex((gate) => gate.gateId === gateId)
    if (gateIndex === -1) {
      throw new Error(`Harness graph approval gate not found: ${gateId}`)
    }
    return gateIndex
  }

  const pendingGateIndexes = gates
    .map((gate, index) => ({ gate, index }))
    .filter(({ gate }) => gate.status === 'pending')

  if (pendingGateIndexes.length === 0) {
    throw new Error('Harness graph approval target has no pending gates')
  }
  if (pendingGateIndexes.length > 1) {
    throw new Error('Harness graph approval target has multiple pending gates; specify --gate')
  }
  return pendingGateIndexes[0]!.index
}

function applyDecisionToGate(
  gate: HarnessGraphApprovalGate,
  input: HarnessGraphApprovalDecisionInput
): HarnessGraphApprovalGate {
  if (gate.status !== 'pending') {
    throw new Error(`Harness graph approval gate is not pending: ${gate.gateId}`)
  }

  return {
    ...gate,
    status: input.decision,
    decidedAt: input.decidedAt || new Date().toISOString(),
    ...(input.decidedBy ? { decidedBy: input.decidedBy } : {}),
    ...(input.note ? { note: input.note } : {}),
  }
}

export function recordHarnessGraphApprovalDecision(
  artifact: HarnessGraphArtifact,
  input: HarnessGraphApprovalDecisionInput
): HarnessGraphArtifact {
  const updatedArtifact: HarnessGraphArtifact = {
    ...artifact,
    approvalGates: artifact.approvalGates.map((gate) => ({ ...gate })),
    nodes: artifact.nodes.map((node) => ({
      ...node,
      dependencies: [...node.dependencies],
      riskMarkers: [...node.riskMarkers],
      approvalGates: node.approvalGates.map((gate) => ({ ...gate })),
      ...(node.execution ? { execution: { ...node.execution } } : {}),
    })),
  }

  if (input.nodeId) {
    const node = updatedArtifact.nodes.find((entry) => entry.id === input.nodeId)
    if (!node) {
      throw new Error(`Harness graph node not found: ${input.nodeId}`)
    }
    const gateIndex = findDecisionGateIndex(node.approvalGates, input.gateId)
    node.approvalGates[gateIndex] = applyDecisionToGate(node.approvalGates[gateIndex]!, input)
    return reconcileHarnessGraphArtifact(updatedArtifact)
  }

  const gateIndex = findDecisionGateIndex(updatedArtifact.approvalGates, input.gateId)
  updatedArtifact.approvalGates[gateIndex] = applyDecisionToGate(updatedArtifact.approvalGates[gateIndex]!, input)
  return reconcileHarnessGraphArtifact(updatedArtifact)
}

function withStatusReason(
  node: HarnessGraphNode,
  state: HarnessGraphNodeState,
  statusReason?: string
): HarnessGraphNode {
  const { statusReason: _previousStatusReason, ...rest } = node
  return {
    ...rest,
    state,
    ...(statusReason ? { statusReason } : {}),
  }
}

function pendingGraphGate(artifact: HarnessGraphArtifact): HarnessGraphApprovalGate | undefined {
  return artifact.approvalGates.find((gate) =>
    gate.scope === 'graph_confirmation'
    && (gate.status === 'pending' || gate.status === 'rejected')
  )
}

function blockedDependencyStates(): HarnessGraphNodeState[] {
  return ['blocked', 'failed', 'waiting_approval']
}

export function reconcileHarnessGraphArtifact(artifact: HarnessGraphArtifact): HarnessGraphArtifact {
  const graphGate = pendingGraphGate(artifact)
  const terminalStates = new Set<HarnessGraphNodeState>(['completed', 'failed'])
  const stickyStates = new Set<HarnessGraphNodeState>(['running', 'waiting_retry'])
  const blockedStates = new Set<HarnessGraphNodeState>(blockedDependencyStates())
  const originalById = new Map(artifact.nodes.map((node) => [node.id, node]))
  const runningConflictScopes = new Set(
    artifact.nodes
      .filter((node) => node.state === 'running' && node.conflictScope)
      .map((node) => node.conflictScope as string)
  )

  const nodes = artifact.nodes.map((node) => {
    if (terminalStates.has(node.state) || stickyStates.has(node.state)) {
      return node
    }

    if (graphGate?.status === 'rejected') {
      return withStatusReason(node, 'blocked', `Graph approval rejected: ${graphGate.label}`)
    }
    if (graphGate?.status === 'pending') {
      return withStatusReason(node, 'waiting_approval', `Waiting for graph approval: ${graphGate.label}`)
    }

    const nodeGate = node.approvalGates.find((gate) => gate.status === 'pending' || gate.status === 'rejected')
    if (nodeGate?.status === 'rejected') {
      return withStatusReason(node, 'blocked', `Node approval rejected: ${nodeGate.label}`)
    }
    if (nodeGate?.status === 'pending') {
      return withStatusReason(node, 'waiting_approval', `Waiting for node approval: ${nodeGate.label}`)
    }

    const dependencies = node.dependencies
      .map((dependencyId) => originalById.get(dependencyId))
      .filter((dependency): dependency is HarnessGraphNode => dependency !== undefined)

    const blockingDependency = dependencies.find((dependency) => blockedStates.has(dependency.state))
    if (blockingDependency) {
      return withStatusReason(node, 'blocked', `Blocked by dependency: ${blockingDependency.id}`)
    }

    const incompleteDependencies = dependencies.filter((dependency) => dependency.state !== 'completed')
    if (incompleteDependencies.length > 0) {
      return withStatusReason(
        node,
        'pending',
        `Waiting for dependencies: ${incompleteDependencies.map((dependency) => dependency.id).join(', ')}`
      )
    }

    if (node.conflictScope && runningConflictScopes.has(node.conflictScope)) {
      return withStatusReason(node, 'blocked', `Waiting for conflict scope: ${node.conflictScope}`)
    }

    return withStatusReason(node, 'ready')
  })

  const rollup = summarizeHarnessGraphNodes(nodes)
  return {
    ...artifact,
    updatedAt: new Date().toISOString(),
    nodes,
    rollup,
    status: deriveHarnessGraphStatus(rollup),
  }
}

export function summarizeHarnessGraphReadiness(artifact: HarnessGraphArtifact): HarnessGraphReadiness {
  return {
    readyNodeIds: artifact.nodes.filter((node) => node.state === 'ready').map((node) => node.id),
  }
}

export async function persistHarnessGraphArtifact(
  cwd: string,
  sessionId: string,
  artifact: HarnessGraphArtifact
): Promise<string> {
  const path = getHarnessGraphArtifactPath(cwd, sessionId)
  await mkdir(join(getRepoSessionDir(cwd, 'harness', sessionId)), { recursive: true })
  await writeFile(path, JSON.stringify(artifact, null, 2), 'utf-8')
  return path
}

export async function loadHarnessGraphArtifact(cwd: string, sessionId: string): Promise<HarnessGraphArtifact | null> {
  try {
    const raw = await readFile(getHarnessGraphArtifactPath(cwd, sessionId), 'utf-8')
    return JSON.parse(raw) as HarnessGraphArtifact
  } catch {
    return null
  }
}
