import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const workerId = process.env.VITEST_POOL_ID || process.pid.toString()
const magpieHome = join(tmpdir(), `magpie-vitest-home-${workerId}`)

mkdirSync(magpieHome, { recursive: true })
process.env.MAGPIE_HOME = magpieHome

