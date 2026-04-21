import { readFileSync, writeFileSync } from 'fs'
import { Command } from 'commander'
import YAML from 'yaml'
import { getConfigPath, loadConfig } from '../../platform/config/loader.js'
import { BUILT_IN_SKILLS, listResolvedSkills, type ResolvedSkill } from '../../core/skills/catalog.js'

function loadRawConfig(configPath: string): Record<string, unknown> {
  return YAML.parse(readFileSync(configPath, 'utf-8')) || {}
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key]
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}

function writeSkillOverride(configPath: string, skillId: string, enabled: boolean): void {
  if (!BUILT_IN_SKILLS.some((skill) => skill.id === skillId)) {
    throw new Error(`Unknown skill: ${skillId}`)
  }
  const raw = loadRawConfig(configPath)
  const capabilities = ensureObject(raw, 'capabilities')
  const skills = ensureObject(capabilities, 'skills')
  const overrides = ensureObject(skills, 'overrides')
  const skill = ensureObject(overrides, skillId)
  skill.enabled = enabled
  writeFileSync(configPath, YAML.stringify(raw), 'utf-8')
}

function printSkill(skill: ResolvedSkill): void {
  const state = skill.enabled ? 'enabled' : 'disabled'
  const readiness = skill.ready ? 'ready' : `missing ${skill.missingRequiredTools.join(',')}`
  console.log(`${skill.id} - ${state}, ${readiness}`)
  console.log(`  ${skill.purpose}`)
}

interface SkillsCommandOptions {
  config?: string
}

export const skillsCommand = new Command('skills')
  .description('List and manage Magpie task skills')

skillsCommand
  .command('list')
  .description('List available skills')
  .option('-c, --config <path>', 'Path to config file')
  .action((options: SkillsCommandOptions) => {
    const config = loadConfig(options.config)
    listResolvedSkills(config).forEach(printSkill)
  })

skillsCommand
  .command('inspect')
  .description('Show one skill')
  .argument('<name>', 'Skill name')
  .option('-c, --config <path>', 'Path to config file')
  .action((name: string, options: SkillsCommandOptions) => {
    const config = loadConfig(options.config)
    const skill = listResolvedSkills(config).find((candidate) => candidate.id === name)
    if (!skill) {
      console.error(`Unknown skill: ${name}`)
      process.exitCode = 1
      return
    }
    printSkill(skill)
    console.log(`  Capabilities: ${skill.capabilities.join(', ')}`)
    console.log(`  Required tools: ${skill.requiredTools.join(', ') || '-'}`)
  })

skillsCommand
  .command('enable')
  .description('Enable a skill in the config')
  .argument('<name>', 'Skill name')
  .option('-c, --config <path>', 'Path to config file')
  .action((name: string, options: SkillsCommandOptions) => {
    const configPath = getConfigPath(options.config)
    writeSkillOverride(configPath, name, true)
    console.log(`Enabled skill: ${name}`)
  })

skillsCommand
  .command('disable')
  .description('Disable a skill in the config')
  .argument('<name>', 'Skill name')
  .option('-c, --config <path>', 'Path to config file')
  .action((name: string, options: SkillsCommandOptions) => {
    const configPath = getConfigPath(options.config)
    writeSkillOverride(configPath, name, false)
    console.log(`Disabled skill: ${name}`)
  })
