import React from 'react'
import { Box, Text } from 'ink'
import { TASKS } from '../tasks.js'
import type { DashboardSessions, EnvironmentHealth, SessionCard } from '../types.js'
import { Section } from './common.js'

const MAX_VISIBLE_CONTINUE = 8
const MAX_VISIBLE_RECENT = 12
const TITLE_MAX_LENGTH = 52

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function formatCapability(capability: SessionCard['capability']): string {
  switch (capability) {
    case 'review':
      return 'Review'
    case 'discuss':
      return 'Discuss'
    case 'trd':
      return 'TRD'
    case 'loop':
      return 'Loop'
    case 'issue-fix':
      return 'Issue Fix'
    case 'harness':
      return 'Harness'
    case 'docs-sync':
      return 'Docs Sync'
    case 'post-merge-regression':
      return 'Regression'
  }
}

function getSectionWindow<T>(items: T[], selectedIndex: number | undefined, maxVisible: number) {
  if (items.length <= maxVisible) {
    return {
      visibleItems: items,
      hiddenAbove: 0,
      hiddenBelow: 0,
      total: items.length,
    }
  }

  let start = 0
  if (typeof selectedIndex === 'number' && selectedIndex >= 0) {
    const desiredStart = selectedIndex - Math.floor(maxVisible / 2)
    start = Math.max(0, Math.min(desiredStart, items.length - maxVisible))
  }

  const end = start + maxVisible
  return {
    visibleItems: items.slice(start, end),
    hiddenAbove: start,
    hiddenBelow: items.length - end,
    total: items.length,
  }
}

export function getVisibleSessionRows(cards: SessionCard[], selectedIndex: number | undefined, maxVisible: number): {
  hiddenAbove: number
  hiddenBelow: number
  total: number
  rows: Array<{
    absoluteIndex: number
    selected: boolean
    card: SessionCard
  }>
} {
  const window = getSectionWindow(cards, selectedIndex, maxVisible)

  return {
    hiddenAbove: window.hiddenAbove,
    hiddenBelow: window.hiddenBelow,
    total: window.total,
    rows: window.visibleItems.map((card, index) => ({
      absoluteIndex: window.hiddenAbove + index,
      selected: selectedIndex === window.hiddenAbove + index,
      card,
    })),
  }
}

function renderSessionRows(props: {
  cards: SessionCard[]
  selectedLocalIndex: number | undefined
  maxVisible: number
  emptyText: string
  summaryLabel: string
}) {
  if (props.cards.length === 0) {
    return <Text color="gray">{props.emptyText}</Text>
  }

  const visibleRows = getVisibleSessionRows(props.cards, props.selectedLocalIndex, props.maxVisible)

  return (
    <Box flexDirection="column">
      {visibleRows.total > visibleRows.rows.length ? (
        <Text color="gray">Showing {visibleRows.rows.length} of {visibleRows.total} {props.summaryLabel}</Text>
      ) : null}
      {visibleRows.hiddenAbove > 0 ? <Text color="gray">… {visibleRows.hiddenAbove} more above</Text> : null}
      {visibleRows.rows.map((row) => {
        return (
          <Box key={row.card.capability + row.card.id} flexDirection="column">
            <Text
              color={row.selected ? 'greenBright' : undefined}
            >
              {row.selected ? '› ' : '  '}
              {truncateText(row.card.title, TITLE_MAX_LENGTH)}
              <Text color="gray">  {formatCapability(row.card.capability)} · {row.card.id}</Text>
            </Text>
            {row.card.detail ? (
              <Text color="gray">
                {row.selected ? '  ' : '  '}
                {truncateText(row.card.detail, TITLE_MAX_LENGTH + 20)}
              </Text>
            ) : null}
          </Box>
        )
      })}
      {visibleRows.hiddenBelow > 0 ? <Text color="gray">… {visibleRows.hiddenBelow} more below</Text> : null}
    </Box>
  )
}

function getSelectedSessionCard(props: {
  selectedIndex: number
  sessions: DashboardSessions
}): SessionCard | undefined {
  if (props.selectedIndex < TASKS.length) {
    return undefined
  }

  const continueIndex = props.selectedIndex - TASKS.length
  if (continueIndex >= 0 && continueIndex < props.sessions.continue.length) {
    return props.sessions.continue[continueIndex]
  }

  const recentIndex = continueIndex - props.sessions.continue.length
  if (recentIndex >= 0 && recentIndex < props.sessions.recent.length) {
    return props.sessions.recent[recentIndex]
  }

  return undefined
}

export function Dashboard(props: {
  selectedIndex: number
  sessions: DashboardSessions
  health?: EnvironmentHealth
}) {
  const continueSelectedIndex = props.selectedIndex >= TASKS.length
    && props.selectedIndex < TASKS.length + props.sessions.continue.length
    ? props.selectedIndex - TASKS.length
    : undefined
  const recentStartIndex = TASKS.length + props.sessions.continue.length
  const recentSelectedIndex = props.selectedIndex >= recentStartIndex
    && props.selectedIndex < recentStartIndex + props.sessions.recent.length
    ? props.selectedIndex - recentStartIndex
    : undefined
  const selectedCard = getSelectedSessionCard(props)
  const selectedHarnessDetail = selectedCard?.capability === 'harness' ? selectedCard.selectedDetail : undefined

  return (
    <Box flexDirection="column">
      <Text bold>Magpie Workbench</Text>
      <Text color="gray">Enter: open/preview  Up/Down: move  r: refresh  q: quit</Text>

      <Section title="New Task">
        {TASKS.map((task, index) => (
          <Text key={task.id} color={props.selectedIndex === index ? 'greenBright' : undefined}>
            {props.selectedIndex === index ? '› ' : '  '}
            {task.title}
            <Text color="gray">  {task.description}</Text>
          </Text>
        ))}
      </Section>

      <Section title="Continue">
        {renderSessionRows({
          cards: props.sessions.continue,
          selectedLocalIndex: continueSelectedIndex,
          maxVisible: MAX_VISIBLE_CONTINUE,
          emptyText: 'No unfinished sessions.',
          summaryLabel: 'unfinished sessions',
        })}
      </Section>

      <Section title="Recent">
        {renderSessionRows({
          cards: props.sessions.recent,
          selectedLocalIndex: recentSelectedIndex,
          maxVisible: MAX_VISIBLE_RECENT,
          emptyText: 'No completed sessions yet.',
          summaryLabel: 'recent sessions',
        })}
      </Section>

      {selectedHarnessDetail ? (
        <Section title="Selected Harness Summary">
          {selectedHarnessDetail.collaborationTemplate ? (
            <Text>Template: {selectedHarnessDetail.collaborationTemplate}</Text>
          ) : null}
          {(selectedHarnessDetail.collaborationRoles || []).map((line, index) => (
            <Text key={`${selectedCard?.id || 'harness'}-collaboration-${index}`}>
              {line}
            </Text>
          ))}
          {selectedHarnessDetail.participants ? (
            <Text>Participants: {selectedHarnessDetail.participants}</Text>
          ) : null}
          {selectedHarnessDetail.reviewerSummaries.map((summary, index) => (
            <Text key={`${selectedCard?.id || 'harness'}-reviewer-${index}`}>
              {summary}
            </Text>
          ))}
          {selectedHarnessDetail.arbitration ? (
            <Text>{selectedHarnessDetail.arbitration}</Text>
          ) : null}
          {selectedHarnessDetail.nextStep ? (
            <Text>Next: {selectedHarnessDetail.nextStep}</Text>
          ) : null}
          {selectedHarnessDetail.graphSummary ? (
            <Text>Graph: {selectedHarnessDetail.graphSummary}</Text>
          ) : null}
          {(selectedHarnessDetail.attention || []).map((line, index) => (
            <Text key={`${selectedCard?.id || 'harness'}-attention-${index}`}>
              {line}
            </Text>
          ))}
          {selectedHarnessDetail.readyNow ? (
            <Text>Ready now: {selectedHarnessDetail.readyNow}</Text>
          ) : null}
          {selectedHarnessDetail.recommendedAction ? (
            <Text>Recommend: {selectedHarnessDetail.recommendedAction}</Text>
          ) : null}
          {selectedHarnessDetail.recommendedCommand ? (
            <Text>Command: {selectedHarnessDetail.recommendedCommand}</Text>
          ) : null}
        </Section>
      ) : null}

      <Section title="Environment Health">
        {props.health ? (
          props.health.items.map((item) => (
            <Text key={item.key}>
              {item.label}:{' '}
              <Text color={item.status === 'ok' ? 'green' : item.status === 'warning' ? 'yellow' : 'gray'}>
                {item.detail}
              </Text>
            </Text>
          ))
        ) : (
          <Text color="gray">Loading environment checks...</Text>
        )}
      </Section>

      <Text color="gray">Session lists stay compact while you browse with the arrow keys.</Text>
    </Box>
  )
}
