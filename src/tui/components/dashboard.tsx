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

function renderSessionRows(props: {
  cards: SessionCard[]
  selectedBaseIndex: number
  selectedLocalIndex: number | undefined
  maxVisible: number
  emptyText: string
  summaryLabel: string
}) {
  if (props.cards.length === 0) {
    return <Text color="gray">{props.emptyText}</Text>
  }

  const window = getSectionWindow(props.cards, props.selectedLocalIndex, props.maxVisible)

  return (
    <Box flexDirection="column">
      {window.total > window.visibleItems.length ? (
        <Text color="gray">Showing {window.visibleItems.length} of {window.total} {props.summaryLabel}</Text>
      ) : null}
      {window.hiddenAbove > 0 ? <Text color="gray">… {window.hiddenAbove} more above</Text> : null}
      {window.visibleItems.map((card, index) => {
        const actualIndex = props.selectedBaseIndex + window.hiddenAbove + index
        return (
          <Text
            key={card.capability + card.id}
            color={actualIndex === props.selectedBaseIndex + props.selectedLocalIndex! ? 'greenBright' : undefined}
          >
            {actualIndex === props.selectedBaseIndex + props.selectedLocalIndex! ? '› ' : '  '}
            {truncateText(card.title, TITLE_MAX_LENGTH)}
            <Text color="gray">  {formatCapability(card.capability)} · {card.id}</Text>
          </Text>
        )
      })}
      {window.hiddenBelow > 0 ? <Text color="gray">… {window.hiddenBelow} more below</Text> : null}
    </Box>
  )
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
  const recentBaseIndex = TASKS.length + props.sessions.continue.length
  const recentSelectedIndex = props.selectedIndex >= recentBaseIndex
    && props.selectedIndex < recentBaseIndex + props.sessions.recent.length
    ? props.selectedIndex - recentBaseIndex
    : undefined

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
          selectedBaseIndex: TASKS.length,
          selectedLocalIndex: continueSelectedIndex,
          maxVisible: MAX_VISIBLE_CONTINUE,
          emptyText: 'No unfinished sessions.',
          summaryLabel: 'unfinished sessions',
        })}
      </Section>

      <Section title="Recent">
        {renderSessionRows({
          cards: props.sessions.recent,
          selectedBaseIndex: recentBaseIndex,
          selectedLocalIndex: recentSelectedIndex,
          maxVisible: MAX_VISIBLE_RECENT,
          emptyText: 'No completed sessions yet.',
          summaryLabel: 'recent sessions',
        })}
      </Section>

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
