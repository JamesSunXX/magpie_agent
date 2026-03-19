import React from 'react'
import { Box, Text } from 'ink'
import type { RunState } from '../types.js'
import { Section } from './common.js'

export function RunView(props: { run: RunState }) {
  return (
    <Box flexDirection="column">
      <Text bold>Run View</Text>
      <Text color="gray">q: quit  Esc: back to dashboard after the run ends</Text>

      <Section title="Status">
        <Text>
          {props.run.status}
          {typeof props.run.exitCode === 'number' ? ` (exit ${props.run.exitCode})` : ''}
        </Text>
      </Section>

      <Section title="Artifacts">
        {Object.keys(props.run.artifacts).length === 0 ? (
          <Text color="gray">No markers yet.</Text>
        ) : (
          Object.entries(props.run.artifacts).map(([key, value]) => (
            <Text key={key}>
              {key}: {value}
            </Text>
          ))
        )}
      </Section>

      <Section title="Logs">
        {props.run.logs.length === 0 ? (
          <Text color="gray">Waiting for output...</Text>
        ) : (
          props.run.logs.slice(-20).map((line, index) => <Text key={index}>{line.trimEnd()}</Text>)
        )}
      </Section>
    </Box>
  )
}
