import { Command } from 'commander'

export const tuiCommand = new Command('tui')
  .description('Open the Magpie task workbench')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options: { config?: string }) => {
    const { startTuiApp } = await import('../../tui/index.js')

    await startTuiApp({
      cwd: process.cwd(),
      configPath: options.config,
    })
  })
