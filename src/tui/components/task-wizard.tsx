import React from 'react'
import { Box, Text } from 'ink'
import type { TaskDefinition, TaskDraft, TaskField } from '../types.js'
import { Section } from './common.js'

function formatFieldValue(field: TaskField, value: string | boolean | undefined): string {
  if (field.type === 'toggle') {
    return value ? 'yes' : 'no'
  }

  if (field.type === 'select') {
    const selected = field.options?.find((option) => option.value === value)
    return selected?.label || String(value || '')
  }

  return typeof value === 'string' ? value : ''
}

export function TaskWizard(props: {
  task: TaskDefinition
  draft: TaskDraft
  fields: TaskField[]
  selectedIndex: number
  canSubmit: boolean
}) {
  return (
    <Box flexDirection="column">
      <Text bold>{props.task.title}</Text>
      <Text color="gray">
        Type to edit text. Left/Right changes selects. Space toggles booleans. a toggles advanced. Enter opens preview.
      </Text>

      <Section title="Fields">
        {props.fields.map((field, index) => (
          <Text key={field.id} color={props.selectedIndex === index ? 'greenBright' : undefined}>
            {props.selectedIndex === index ? '› ' : '  '}
            {field.label}: {formatFieldValue(field, props.draft.values[field.id]) || field.placeholder || ''}
          </Text>
        ))}
      </Section>

      <Text color="gray">
        Advanced: {props.draft.showAdvanced ? 'shown' : 'hidden'}  Submit: {props.canSubmit ? 'ready' : 'missing required fields'}
      </Text>
    </Box>
  )
}
