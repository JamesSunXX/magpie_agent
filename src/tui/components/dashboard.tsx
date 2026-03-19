import React from 'react'
import { Box, Text } from 'ink'
import { TASKS } from '../tasks.js'
import type { DashboardSessions, EnvironmentHealth } from '../types.js'
import { Section } from './common.js'

export function Dashboard(props: {
  selectedIndex: number
  sessions: DashboardSessions
  health?: EnvironmentHealth
}) {
  const items = [
    ...TASKS.map((task) => ({ kind: 'task' as const, label: task.title, detail: task.description })),
    ...props.sessions.continue.map((card) => ({
      kind: 'continue' as const,
      label: `${card.title} (${card.status})`,
      detail: card.id,
    })),
    ...props.sessions.recent.map((card) => ({
      kind: 'recent' as const,
      label: `${card.title} (${card.status})`,
      detail: card.id,
    })),
  ]

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
        {props.sessions.continue.length === 0 ? (
          <Text color="gray">No unfinished sessions.</Text>
        ) : (
          props.sessions.continue.map((card, index) => {
            const itemIndex = TASKS.length + index
            return (
              <Text
                key={card.capability + card.id}
                color={props.selectedIndex === itemIndex ? 'greenBright' : undefined}
              >
                {props.selectedIndex === itemIndex ? '› ' : '  '}
                {card.title}
                <Text color="gray">  {card.id}</Text>
              </Text>
            )
          })
        )}
      </Section>

      <Section title="Recent">
        {props.sessions.recent.length === 0 ? (
          <Text color="gray">No completed sessions yet.</Text>
        ) : (
          props.sessions.recent.map((card, index) => {
            const itemIndex = TASKS.length + props.sessions.continue.length + index
            return (
              <Text
                key={card.capability + card.id}
                color={props.selectedIndex === itemIndex ? 'greenBright' : undefined}
              >
                {props.selectedIndex === itemIndex ? '› ' : '  '}
                {card.title}
                <Text color="gray">  {card.id}</Text>
              </Text>
            )
          })
        )}
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

      <Text color="gray">Selected items available: {items.length}</Text>
    </Box>
  )
}
