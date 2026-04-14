import React from 'react'
import { Box, Text } from 'ink'
import type { GraphWorkbenchData, GraphWorkbenchState } from '../types.js'
import { buildCommandDisplay } from '../command-builder.js'
import { Section } from './common.js'

function renderNodeLine(
  node: GraphWorkbenchData['nodes'][number],
  selectedNodeId: string | undefined,
  focusedPanel: GraphWorkbenchState['focusedPanel']
) {
  const selected = node.id === selectedNodeId
  const prefix = selected ? '› ' : '  '
  const color = selected && focusedPanel === 'overview' ? 'greenBright' : undefined
  const reason = node.statusReason ? ` - ${node.statusReason}` : ''
  const pending = node.approvalPending ? ' [approval pending]' : ''

  return (
    <Text key={node.id} color={color}>
      {prefix}
      {node.id}
      <Text color="gray">  {node.title} · {node.type} · {node.state}{pending}{reason}</Text>
    </Text>
  )
}

export function GraphWorkbench(props: {
  workbench: GraphWorkbenchData
  focusedPanel: GraphWorkbenchState['focusedPanel']
  selectedActionIndex: number
  message?: string
}) {
  const selectedNode = props.workbench.selectedNode
  const overviewSection = Section({
    title: 'Graph Overview',
    children: (
      <>
        <Text>
          {props.workbench.graph.title}
          <Text color="gray">  {props.workbench.graph.graphId} · {props.workbench.graph.status}</Text>
        </Text>
        <Text color="gray">
          ready {props.workbench.graph.rollup.ready} · waiting approval {props.workbench.graph.rollup.waitingApproval} · blocked {props.workbench.graph.rollup.blocked}
        </Text>
        {props.workbench.error ? <Text color="red">{props.workbench.error}</Text> : null}
        {props.workbench.nodes.map((node) => renderNodeLine(node, props.workbench.selectedNodeId, props.focusedPanel))}
      </>
    ),
  })
  const detailSection = Section({
    title: 'Selected Node Detail',
    children: selectedNode ? (
      <>
        <Text>
          {selectedNode.title}
          <Text color="gray">  {selectedNode.id} · {selectedNode.type} · {selectedNode.state}</Text>
        </Text>
        {selectedNode.statusReason ? <Text>Status: {selectedNode.statusReason}</Text> : null}
        <Text>Dependencies: {selectedNode.dependencies.join(', ') || 'None.'}</Text>
        <Text>Approval pending: {selectedNode.approvalPending ? 'yes' : 'no'}</Text>
        {selectedNode.latestSummary ? <Text>Latest summary: {selectedNode.latestSummary}</Text> : null}
        {selectedNode.nextStep ? <Text>Next: {selectedNode.nextStep}</Text> : null}
        {selectedNode.linkedExecution ? (
          <>
            <Text>
              Linked session: {selectedNode.linkedExecution.capability} {selectedNode.linkedExecution.sessionId} {selectedNode.linkedExecution.status}
            </Text>
            <Text>Linked summary: {selectedNode.linkedExecution.summary}</Text>
          </>
        ) : null}
        {selectedNode.unresolvedIssues.length > 0
          ? selectedNode.unresolvedIssues.map((issue) => <Text key={issue}>Issue: {issue}</Text>)
          : <Text color="gray">No unresolved issues.</Text>}
      </>
    ) : (
      <Text color="gray">Select a node to inspect it.</Text>
    ),
  })
  const actionsSection = Section({
    title: 'Actions',
    children: props.workbench.actions.length > 0 ? props.workbench.actions.map((action, index) => {
      const selected = index === props.selectedActionIndex
      const prefix = selected ? '› ' : '  '
      const color = selected && props.focusedPanel === 'actions' ? 'greenBright' : undefined

      return (
        <Box key={action.id} flexDirection="column">
          <Text color={color}>
            {prefix}
            {action.label}
            <Text color="gray">  {action.kind}</Text>
          </Text>
          <Text color="gray">
            {action.description} Command: {buildCommandDisplay(action.command)}
          </Text>
        </Box>
      )
    }) : <Text color="gray">No direct actions for the selected node.</Text>,
  })
  const attentionSection = Section({
    title: 'Attention and Events',
    children: (
      <>
        {props.workbench.attention.length > 0 ? props.workbench.attention.map((item) => (
          <Text key={item}>{item}</Text>
        )) : <Text color="gray">No active attention items.</Text>}
        {props.workbench.events.length > 0 ? props.workbench.events.map((event) => (
          <Text key={event.id} color="gray">
            {event.timestamp}  {event.summary}
          </Text>
        )) : <Text color="gray">No recent events.</Text>}
      </>
    ),
  })

  return (
    <Box flexDirection="column">
      <Text bold>Graph Workbench</Text>
      <Text color="gray">Left/Right: switch panel  Up/Down: move  Enter: run action  Escape: back  r: refresh</Text>
      {props.message ? <Text color="yellow">{props.message}</Text> : null}
      {overviewSection}
      {detailSection}
      {actionsSection}
      {attentionSection}
    </Box>
  )
}
