import { Command } from 'commander'

export const imServerCommand = new Command('im-server')
  .description('Run the inbound IM control server')

imServerCommand
  .command('start')
  .description('Start the IM callback server')
  .option('-c, --config <path>', 'Path to config file')
  .action(() => {
    console.log('IM server start is not implemented yet.')
  })

imServerCommand
  .command('status')
  .description('Show IM callback server status')
  .action(() => {
    console.log('IM server status is not implemented yet.')
  })

imServerCommand
  .command('stop')
  .description('Stop the IM callback server')
  .action(() => {
    console.log('IM server stop is not implemented yet.')
  })

imServerCommand
  .command('run')
  .description('Internal foreground callback loop')
  .option('-c, --config <path>', 'Path to config file')
  .action(() => {
    console.log('IM server run is not implemented yet.')
  })
