import { Command } from 'commander'
import { startTuiApp } from '../../tui/index.js'

export const tuiCommand = new Command('tui')
  .description('Open the Magpie task workbench')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options: { config?: string }) => {
    await startTuiApp({
      cwd: process.cwd(),
      configPath: options.config,
    })
  })
