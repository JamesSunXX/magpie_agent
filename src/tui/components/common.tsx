import React from 'react'
import { Box, Text } from 'ink'

export function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyanBright">{props.title}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {props.children}
      </Box>
    </Box>
  )
}
