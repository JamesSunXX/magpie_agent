import React from 'react'
import { Box, Text } from 'ink'
import type { BuiltCommand } from '../types.js'
import { Section } from './common.js'

export function CommandPreview(props: { command: BuiltCommand }) {
  return (
    <Box flexDirection="column">
      <Text bold>Command Preview</Text>
      <Text color="gray">Enter: run  Esc: back  q: quit</Text>

      <Section title="Summary">
        <Text>{props.command.summary}</Text>
      </Section>

      <Section title="Command">
        <Text>{props.command.display}</Text>
      </Section>
    </Box>
  )
}
