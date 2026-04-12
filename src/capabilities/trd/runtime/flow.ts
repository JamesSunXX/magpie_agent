import chalk from 'chalk'
import ora from 'ora'
import { randomBytes } from 'crypto'
import { basename, join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { createInterface } from 'readline'
import { stringify as stringifyYaml } from 'yaml'
import type { MagpieConfigV2 } from '../../../platform/config/types.js'
import type { Reviewer } from '../../../core/debate/types.js'
import { StateManager } from '../../../core/state/index.js'
import type { TrdSession } from '../../../core/state/index.js'
import { loadConfig } from '../../../platform/config/loader.js'
import { getRepoSessionDir } from '../../../platform/paths.js'
import { createConfiguredProvider } from '../../../platform/providers/index.js'
import type { ChatImageInput } from '../../../platform/providers/index.js'
import { loadProjectContext } from '../../../utils/context-loader.js'
import { resolveContextReferences } from '../../../utils/context-references.js'
import { runDebateSession } from '../../../core/debate/runner.js'
import { parsePrdMarkdownContent } from '../domain/prd-parser.js'
import { collectChatImages } from '../../../trd/image-inputs.js'
import { buildPrdDigestText, mapRequirementsToDomains } from '../domain/digest.js'
import {
  TRD_ANALYZER_PROMPT,
  DOMAIN_REVIEWER_PROMPT,
  DOMAIN_SUMMARIZER_PROMPT,
  INTEGRATION_SUMMARIZER_PROMPT,
  buildDomainOverviewPrompt,
  buildDomainPrompt,
  buildIntegrationPrompt,
} from '../domain/prompts.js'
import {
  extractJsonBlock,
  parseConfirmedDomainsYaml,
  renderDomainDraftYaml,
  renderDomainOverviewMarkdown,
  renderOpenQuestionsMarkdown,
} from '../domain/renderer.js'
import type {
  DomainBoundary,
  DomainOverview,
  DomainRequirementBundle,
  ParsedPrd,
  TrdSynthesisResult,
} from '../../../trd/types.js'
import { CommandExitError, runInCommandContext } from '../../../core/capability/command-context.js'
import type { RunTrdFlowInput, TrdFlowResult, TrdOptions } from '../types.js'

interface OutputPaths {
  domainOverviewPath: string
  draftDomainsPath: string
  confirmedDomainsPath: string
  trdPath: string
  openQuestionsPath: string
  partialDir: string
}

const FALLBACK_DOMAIN: DomainBoundary = {
  id: 'domain-core',
  name: '核心领域',
  description: '默认核心领域（解析失败时回退）',
  owner: '待指定',
  inScope: ['PRD 中全部需求'],
  outOfScope: [],
  upstreams: [],
  downstreams: [],
  contracts: [],
}

function generateShortId(): string {
  return randomBytes(4).toString('hex')
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function resolveContextModel(tool?: string, model?: string): string {
  return model || tool || 'codex'
}

function withProjectContext(basePrompt: string, model: string, config: MagpieConfigV2): string {
  const includeContext = config.trd?.include_project_context !== false
  if (!includeContext) return basePrompt
  const context = loadProjectContext(model)
  if (!context) return basePrompt
  return `${basePrompt}\n\n---\nProject context:\n${context}`
}

function resolveTrdDefaults(config: MagpieConfigV2) {
  const trd = config.trd || {}
  return {
    defaultReviewers: trd.default_reviewers || Object.keys(config.reviewers).slice(0, 2),
    maxRounds: trd.max_rounds || config.defaults.max_rounds || 3,
    language: trd.language || 'zh',
    includeTraceability: trd.include_traceability !== false,
    chunkChars: trd.preprocess?.chunk_chars || 6000,
    maxChars: trd.preprocess?.max_chars || 120000,
    trdSuffix: trd.output?.trd_suffix || '.trd.md',
    openQuestionsSuffix: trd.output?.open_questions_suffix || '.open-questions.md',
    requireHumanConfirmation: trd.domain?.require_human_confirmation !== false,
  }
}

function getOutputPaths(prdPath: string, sessionId: string, options: TrdOptions, config: MagpieConfigV2, cwd: string): OutputPaths {
  const defaults = resolveTrdDefaults(config)
  const ext = prdPath.toLowerCase().endsWith('.md') ? '.md' : ''
  const base = ext ? prdPath.slice(0, -ext.length) : prdPath

  const domainOverviewPath = `${base}.domain-overview.md`
  const draftDomainsPath = `${base}.domains.draft.yaml`
  const confirmedDomainsPath = `${base}.domains.confirmed.yaml`
  const trdPath = options.output || `${base}${defaults.trdSuffix}`
  const openQuestionsPath = options.questionsOutput || `${base}${defaults.openQuestionsSuffix}`
  const partialDir = join(getRepoSessionDir(cwd, 'trd', sessionId), 'artifacts')

  return {
    domainOverviewPath,
    draftDomainsPath,
    confirmedDomainsPath,
    trdPath,
    openQuestionsPath,
    partialDir,
  }
}

function resolveReviewerIds(config: MagpieConfigV2, options: TrdOptions): string[] {
  const allReviewerIds = Object.keys(config.reviewers)
  if (options.reviewers) {
    const selected = options.reviewers.split(',').map(s => s.trim()).filter(Boolean)
    const invalid = selected.filter(id => !allReviewerIds.includes(id))
    if (invalid.length > 0) {
      throw new Error(`Unknown reviewer(s): ${invalid.join(', ')}`)
    }
    return selected
  }
  if (options.all) return allReviewerIds

  const defaults = resolveTrdDefaults(config).defaultReviewers
  const selected = defaults.filter(id => allReviewerIds.includes(id))
  if (selected.length > 0) return selected
  return allReviewerIds.slice(0, 2)
}

function parseDomainOverviewOrFallback(raw: string): DomainOverview {
  const parsed = extractJsonBlock<DomainOverview>(raw)
  if (!parsed || !Array.isArray(parsed.domains) || parsed.domains.length === 0) {
    return {
      summary: '领域总览解析失败，已使用默认核心领域回退。',
      principles: [],
      domains: [{ ...FALLBACK_DOMAIN }],
      crossDomainFlows: [],
      risks: ['AI 输出未返回可解析结构，请人工复核。'],
    }
  }

  const normalizedDomains = parsed.domains.map((d, idx) => ({
    id: d.id || `domain-${idx + 1}`,
    name: d.name || `领域-${idx + 1}`,
    description: d.description || '',
    owner: d.owner || '待指定',
    inScope: Array.isArray(d.inScope) ? d.inScope : [],
    outOfScope: Array.isArray(d.outOfScope) ? d.outOfScope : [],
    upstreams: Array.isArray(d.upstreams) ? d.upstreams : [],
    downstreams: Array.isArray(d.downstreams) ? d.downstreams : [],
    contracts: Array.isArray(d.contracts) ? d.contracts : [],
  }))

  return {
    summary: parsed.summary || '（无）',
    principles: Array.isArray(parsed.principles) ? parsed.principles : [],
    domains: normalizedDomains,
    crossDomainFlows: Array.isArray(parsed.crossDomainFlows) ? parsed.crossDomainFlows : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
  }
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

function normalizeDomainId(name: string, fallback: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || fallback
}

function mergeDomains(selected: DomainBoundary[], newName: string): DomainBoundary {
  const description = selected.map(d => d.description).filter(Boolean).join('；')
  return {
    id: normalizeDomainId(newName, `domain-${Date.now()}`),
    name: newName,
    description,
    owner: unique(selected.map(d => d.owner).filter(Boolean)).join(' / ') || '待指定',
    inScope: unique(selected.flatMap(d => d.inScope)),
    outOfScope: unique(selected.flatMap(d => d.outOfScope)),
    upstreams: unique(selected.flatMap(d => d.upstreams)),
    downstreams: unique(selected.flatMap(d => d.downstreams)),
    contracts: unique(selected.flatMap(d => d.contracts)),
  }
}

async function ask(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve))
}

function printDomainList(domains: DomainBoundary[]): void {
  console.log(chalk.cyan('\n当前领域边界：'))
  domains.forEach((d, idx) => {
    console.log(chalk.dim(`  [${idx + 1}] ${d.name} (${d.id}) owner=${d.owner || '待指定'}`))
  })
}

function extractOverviewSummaryFromMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('-')) continue
    if (trimmed.startsWith('|')) continue
    return trimmed
  }
  return '基于已确认领域重新生成 TRD。'
}

function printImageWarnings(warnings: string[]): void {
  if (warnings.length === 0) return
  console.log(chalk.yellow('\n图片输入告警:'))
  for (const warning of warnings) {
    console.log(chalk.yellow(`- ${warning}`))
  }
}

async function confirmDomains(
  options: TrdOptions,
  defaults: ReturnType<typeof resolveTrdDefaults>,
  draftDomains: DomainBoundary[],
  paths: OutputPaths
): Promise<DomainBoundary[] | null> {
  if (options.domainsFile) {
    const raw = readFileSync(options.domainsFile, 'utf-8')
    return parseConfirmedDomainsYaml(raw)
  }

  if (options.autoAcceptDomains || !defaults.requireHumanConfirmation) {
    writeFileSync(paths.confirmedDomainsPath, stringifyYaml({ domains: draftDomains }), 'utf-8')
    return draftDomains
  }

  if (!process.stdout.isTTY) {
    return null
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let domains = draftDomains.map(d => ({ ...d }))

  console.log(chalk.cyan('\n进入领域边界人工确认。可用操作：'))
  console.log(chalk.dim('  a=accept  r=rename  m=merge  s=split  d=delete  q=quit'))

  while (true) {
    printDomainList(domains)
    const action = (await ask(rl, chalk.yellow('选择操作 [a/r/m/s/d/q]: '))).trim().toLowerCase()

    if (action === 'a') {
      if (domains.length === 0) {
        console.log(chalk.red('至少保留一个领域后才能确认。'))
        continue
      }
      writeFileSync(paths.confirmedDomainsPath, stringifyYaml({ domains }), 'utf-8')
      rl.close()
      return domains
    }

    if (action === 'q') {
      rl.close()
      return null
    }

    if (action === 'r') {
      const idx = parseInt(await ask(rl, '输入要重命名的领域编号: '), 10) - 1
      if (!domains[idx]) {
        console.log(chalk.red('编号无效。'))
        continue
      }
      const newName = (await ask(rl, '输入新领域名称: ')).trim()
      if (!newName) {
        console.log(chalk.red('名称不能为空。'))
        continue
      }
      domains[idx].name = newName
      domains[idx].id = normalizeDomainId(newName, domains[idx].id)
      continue
    }

    if (action === 'd') {
      const idx = parseInt(await ask(rl, '输入要删除的领域编号: '), 10) - 1
      if (!domains[idx]) {
        console.log(chalk.red('编号无效。'))
        continue
      }
      domains.splice(idx, 1)
      continue
    }

    if (action === 'm') {
      const raw = (await ask(rl, '输入要合并的领域编号（逗号分隔，如 1,3）: ')).trim()
      const indexes = raw.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < domains.length)
      const uniqueIdx = unique(indexes).sort((a, b) => a - b)
      if (uniqueIdx.length < 2) {
        console.log(chalk.red('至少选择两个有效领域。'))
        continue
      }
      const selected = uniqueIdx.map(i => domains[i])
      const defaultName = selected.map(d => d.name).join('-')
      const newName = (await ask(rl, `新领域名称（默认 ${defaultName}）: `)).trim() || defaultName
      const merged = mergeDomains(selected, newName)
      domains = domains.filter((_, i) => !uniqueIdx.includes(i))
      domains.push(merged)
      continue
    }

    if (action === 's') {
      const idx = parseInt(await ask(rl, '输入要拆分的领域编号: '), 10) - 1
      if (!domains[idx]) {
        console.log(chalk.red('编号无效。'))
        continue
      }
      const namesRaw = (await ask(rl, '输入子领域名称（逗号分隔，如 checkout,payment）: ')).trim()
      const names = namesRaw.split(',').map(s => s.trim()).filter(Boolean)
      if (names.length < 2) {
        console.log(chalk.red('至少提供两个子领域名称。'))
        continue
      }
      const target = domains[idx]
      const splitDomains: DomainBoundary[] = names.map((name, i) => ({
        ...target,
        id: normalizeDomainId(name, `${target.id}-${i + 1}`),
        name,
        description: `${target.description}${target.description ? '；' : ''}子域 ${name}`,
      }))
      domains.splice(idx, 1, ...splitDomains)
      continue
    }

    console.log(chalk.red('无效操作，请重试。'))
  }
}

function buildFallbackTrdMarkdown(
  overview: DomainOverview,
  partials: Array<{ domainId: string; content: string }>,
  includeTraceability: boolean,
  bundles: DomainRequirementBundle[]
): string {
  const lines: string[] = []
  lines.push('# 技术方案设计（TRD）')
  lines.push('')
  lines.push('## 背景与目标')
  lines.push(overview.summary)
  lines.push('')
  lines.push('## 范围与非范围')
  for (const d of overview.domains) {
    lines.push(`- ${d.name}: 范围(${d.inScope.join('；') || '无'})；非范围(${d.outOfScope.join('；') || '无'})`)
  }
  lines.push('')
  lines.push('## 现状与约束')
  for (const r of overview.risks) lines.push(`- ${r}`)
  lines.push('')
  lines.push('## 总体技术方案')
  for (const p of partials) {
    lines.push(`### ${p.domainId}`)
    lines.push(p.content)
    lines.push('')
  }
  lines.push('## 数据与接口设计')
  lines.push('- 详见各领域方案中的契约定义。')
  lines.push('')
  lines.push('## 关键流程与时序')
  for (const flow of overview.crossDomainFlows) lines.push(`- ${flow}`)
  lines.push('')
  lines.push('## 风险与取舍')
  for (const r of overview.risks) lines.push(`- ${r}`)
  lines.push('')
  lines.push('## 测试验收与上线回滚')
  lines.push('- 领域内功能验收 + 跨域集成回归 + 回滚演练。')
  lines.push('')

  if (includeTraceability) {
    lines.push('## 附录：PRD 需求追踪')
    lines.push('| Requirement | Domain | Decision |')
    lines.push('|---|---|---|')
    for (const bundle of bundles) {
      for (const req of bundle.requirements) {
        lines.push(`| ${req.id} | ${bundle.domain.id} | 见 ${bundle.domain.name} 方案 |`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function generateDomainOverview(
  parsedPrd: ParsedPrd,
  config: MagpieConfigV2,
  defaults: ReturnType<typeof resolveTrdDefaults>,
  images: ChatImageInput[],
): Promise<DomainOverview> {
  const analyzerModel = config.analyzer.model
  const analyzerContextModel = resolveContextModel(config.analyzer.tool, config.analyzer.model)
  const analyzer = createConfiguredProvider({
    logicalName: 'analyzer',
    tool: config.analyzer.tool,
    model: analyzerModel,
    agent: config.analyzer.agent,
  }, config)
  const digest = buildPrdDigestText(parsedPrd, defaults.maxChars)
  const prompt = buildDomainOverviewPrompt(digest)
  const response = await analyzer.chat(
    [{ role: 'user', content: prompt }],
    withProjectContext(TRD_ANALYZER_PROMPT, analyzerContextModel, config),
    images.length > 0 ? { images } : undefined
  )
  return parseDomainOverviewOrFallback(response)
}

async function generateDomainPartials(
  bundles: DomainRequirementBundle[],
  overview: DomainOverview,
  reviewerIds: string[],
  images: ChatImageInput[],
  config: MagpieConfigV2,
  options: TrdOptions,
  defaults: ReturnType<typeof resolveTrdDefaults>,
  paths: OutputPaths,
  followUp?: string
): Promise<Array<{ domainId: string; content: string }>> {
  const partials: Array<{ domainId: string; content: string }> = []
  ensureDir(paths.partialDir)

  const maxRounds = parseInt(options.rounds || '', 10) || defaults.maxRounds
  for (const bundle of bundles) {
    const spinner = ora(`生成领域方案: ${bundle.domain.name}`).start()
    try {
      const reviewers: Reviewer[] = reviewerIds.map((id) => ({
        id,
        provider: createConfiguredProvider({
          logicalName: `reviewers.${id}`,
          tool: config.reviewers[id].tool,
          model: config.reviewers[id].model,
          agent: config.reviewers[id].agent,
        }, config),
        systemPrompt: withProjectContext(
          DOMAIN_REVIEWER_PROMPT,
          resolveContextModel(config.reviewers[id].tool, config.reviewers[id].model),
          config
        ),
      }))

      const analyzer: Reviewer = {
        id: 'analyzer',
        provider: createConfiguredProvider({
          logicalName: 'analyzer',
          tool: config.analyzer.tool,
          model: config.analyzer.model,
          agent: config.analyzer.agent,
        }, config),
        systemPrompt: withProjectContext(
          DOMAIN_REVIEWER_PROMPT,
          resolveContextModel(config.analyzer.tool, config.analyzer.model),
          config
        ),
      }

      const summarizer: Reviewer = {
        id: 'summarizer',
        provider: createConfiguredProvider({
          logicalName: 'summarizer',
          tool: config.summarizer.tool,
          model: config.summarizer.model,
          agent: config.summarizer.agent,
        }, config),
        systemPrompt: withProjectContext(
          DOMAIN_SUMMARIZER_PROMPT,
          resolveContextModel(config.summarizer.tool, config.summarizer.model),
          config
        ),
      }

      const result = await runDebateSession({
        reviewers,
        analyzer,
        summarizer,
        label: `TRD-${bundle.domain.id}`,
        prompt: `${buildDomainPrompt(bundle, overview)}${followUp ? `\n\n补充修订要求：${followUp}` : ''}`,
        options: {
          maxRounds,
          interactive: !!options.interactive,
          language: defaults.language,
          checkConvergence: options.converge !== false,
          chatOptions: images.length > 0
            ? {
              analyzer: { images },
              reviewer: { images },
              summarizer: { images },
            }
            : undefined,
        },
        streaming: false,
      })

      const partial = result.finalConclusion || result.analysis
      partials.push({ domainId: bundle.domain.id, content: partial })
      const filePath = join(paths.partialDir, `domain-${bundle.domain.id}.trd.partial.md`)
      writeFileSync(filePath, partial, 'utf-8')
      spinner.succeed(`完成领域: ${bundle.domain.name}`)
    } catch (error) {
      spinner.fail(`领域生成失败: ${bundle.domain.name}`)
      partials.push({
        domainId: bundle.domain.id,
        content: `## ${bundle.domain.name}\n\n生成失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return partials
}

function buildInitialOpenQuestions(): TrdSynthesisResult['openQuestions'] {
  return []
}

async function synthesizeTrd(
  overview: DomainOverview,
  bundles: DomainRequirementBundle[],
  partials: Array<{ domainId: string; content: string }>,
  images: ChatImageInput[],
  config: MagpieConfigV2,
  defaults: ReturnType<typeof resolveTrdDefaults>,
  followUp?: string
): Promise<TrdSynthesisResult> {
  const traceabilityRows = bundles
    .flatMap(bundle => bundle.requirements.map(req => `${req.id} -> ${bundle.domain.id}`))
    .join('\n')
  const prompt = `${buildIntegrationPrompt(overview, partials, traceabilityRows)}${followUp ? `\n\n补充修订要求：${followUp}` : ''}`
  const summarizer = createConfiguredProvider({
    logicalName: 'summarizer',
    tool: config.summarizer.tool,
    model: config.summarizer.model,
    agent: config.summarizer.agent,
  }, config)
  const response = await summarizer.chat(
    [{ role: 'user', content: prompt }],
    withProjectContext(
      INTEGRATION_SUMMARIZER_PROMPT,
      resolveContextModel(config.summarizer.tool, config.summarizer.model),
      config
    ),
    images.length > 0 ? { images } : undefined
  )

  const parsed = extractJsonBlock<TrdSynthesisResult>(response)
  if (parsed && typeof parsed.trdMarkdown === 'string') {
    return {
      trdMarkdown: parsed.trdMarkdown,
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
      traceability: Array.isArray(parsed.traceability) ? parsed.traceability : [],
    }
  }

  return {
    trdMarkdown: buildFallbackTrdMarkdown(
      overview,
      partials,
      defaults.includeTraceability,
      bundles
    ),
    openQuestions: buildInitialOpenQuestions(),
    traceability: bundles.flatMap(bundle =>
      bundle.requirements.map(req => ({
        requirementId: req.id,
        domainId: bundle.domain.id,
        decision: `见 ${bundle.domain.name} 方案`,
      }))
    ),
  }
}

async function runNewTrd(
  prdPath: string,
  options: TrdOptions,
  config: MagpieConfigV2,
  stateManager: StateManager
): Promise<void> {
  if (!existsSync(prdPath)) {
    throw new Error(`PRD file not found: ${prdPath}`)
  }

  const sessionId = generateShortId()
  const defaults = resolveTrdDefaults(config)
  const reviewerIds = resolveReviewerIds(config, options)
  const paths = getOutputPaths(prdPath, sessionId, options, config, process.cwd())
  ensureDir(paths.partialDir)

  const rawPrd = readFileSync(prdPath, 'utf-8')
  const resolvedPrd = await resolveContextReferences(rawPrd, { cwd: process.cwd() })
  const parsedPrd = parsePrdMarkdownContent(prdPath, resolvedPrd)
  const { images: chatImages, warnings } = collectChatImages(parsedPrd.images, prdPath)
  printImageWarnings(warnings)

  const overview = await generateDomainOverview(parsedPrd, config, defaults, chatImages)
  writeFileSync(paths.domainOverviewPath, renderDomainOverviewMarkdown(overview), 'utf-8')
  writeFileSync(paths.draftDomainsPath, renderDomainDraftYaml(overview), 'utf-8')

  const session: TrdSession = {
    id: sessionId,
    title: parsedPrd.title,
    prdPath,
    createdAt: new Date(),
    updatedAt: new Date(),
    stage: 'overview_drafted',
    reviewerIds,
    domains: overview.domains,
    artifacts: {
      ...paths,
    },
    rounds: [],
  }
  await stateManager.saveTrdSession(session)

  const confirmedDomains = await confirmDomains(options, defaults, overview.domains, paths)
  if (!confirmedDomains) {
    console.log(chalk.yellow(`已输出领域草稿：${paths.draftDomainsPath}`))
    console.log(chalk.yellow('请人工确认后通过 --domains-file 继续，或使用 --auto-accept-domains 跳过确认。'))
    return
  }

  session.domains = confirmedDomains
  session.stage = 'boundaries_confirmed'
  session.updatedAt = new Date()
  await stateManager.saveTrdSession(session)

  if (options.domainOverviewOnly) {
    console.log(chalk.green(`领域总览已生成：${paths.domainOverviewPath}`))
    console.log(chalk.green(`领域边界草稿：${paths.draftDomainsPath}`))
    console.log(chalk.green(`领域边界确认稿：${paths.confirmedDomainsPath}`))
    console.log(chalk.dim(`Session: ${session.id}`))
    return
  }

  const bundles = mapRequirementsToDomains(parsedPrd.requirements, {
    ...overview,
    domains: confirmedDomains,
  })
  const partials = await generateDomainPartials(
    bundles,
    { ...overview, domains: confirmedDomains },
    reviewerIds,
    chatImages,
    config,
    options,
    defaults,
    paths
  )

  session.stage = 'domain_trd_generated'
  session.updatedAt = new Date()
  await stateManager.saveTrdSession(session)

  const synthesis = await synthesizeTrd(
    { ...overview, domains: confirmedDomains },
    bundles,
    partials,
    chatImages,
    config,
    defaults
  )

  writeFileSync(paths.trdPath, synthesis.trdMarkdown, 'utf-8')
  writeFileSync(paths.openQuestionsPath, renderOpenQuestionsMarkdown(synthesis), 'utf-8')

  session.stage = 'integration_generated'
  session.updatedAt = new Date()
  await stateManager.saveTrdSession(session)

  session.stage = 'completed'
  session.updatedAt = new Date()
  session.rounds.push({
    roundNumber: session.rounds.length + 1,
    prompt: `生成 TRD: ${basename(prdPath)}`,
    summary: `TRD 输出: ${paths.trdPath}`,
    timestamp: new Date(),
  })
  await stateManager.saveTrdSession(session)

  console.log(chalk.green(`TRD: ${paths.trdPath}`))
  console.log(chalk.green(`待确认清单: ${paths.openQuestionsPath}`))
  console.log(chalk.dim(`Session: ${session.id}`))
}

async function handleResume(
  resumeId: string,
  followUp: string | undefined,
  options: TrdOptions,
  config: MagpieConfigV2,
  stateManager: StateManager
): Promise<void> {
  const all = await stateManager.listTrdSessions()
  const matching = all.filter(s => s.id === resumeId || s.id.startsWith(resumeId))
  if (matching.length === 0) {
    throw new Error(`No trd session found matching "${resumeId}"`)
  }
  if (matching.length > 1) {
    throw new Error(`Multiple trd sessions match "${resumeId}", please use full ID`)
  }

  const session = matching[0]
  if (!followUp) {
    console.log(chalk.cyan(`Session: ${session.id}`))
    console.log(chalk.dim(`PRD: ${session.prdPath}`))
    console.log(chalk.dim(`Stage: ${session.stage}`))
    console.log(chalk.dim(`TRD: ${session.artifacts.trdPath}`))
    return
  }

  const defaults = resolveTrdDefaults(config)
  const rawPrd = readFileSync(session.prdPath, 'utf-8')
  const resolvedPrd = await resolveContextReferences(rawPrd, { cwd: process.cwd() })
  const parsedPrd = parsePrdMarkdownContent(session.prdPath, resolvedPrd)
  const { images: chatImages, warnings } = collectChatImages(parsedPrd.images, session.prdPath)
  printImageWarnings(warnings)
  const overviewMd = readFileSync(session.artifacts.domainOverviewPath, 'utf-8')
  const domainsYaml = readFileSync(session.artifacts.confirmedDomainsPath, 'utf-8')
  const confirmedDomains = parseConfirmedDomainsYaml(domainsYaml)
  const overview: DomainOverview = {
    summary: extractOverviewSummaryFromMarkdown(overviewMd),
    principles: [],
    domains: confirmedDomains,
    crossDomainFlows: [],
    risks: [],
  }
  const bundles = mapRequirementsToDomains(parsedPrd.requirements, {
    ...overview,
  })

  const reviewerIds = session.reviewerIds.length > 0 ? session.reviewerIds : resolveReviewerIds(config, options)
  const partials = await generateDomainPartials(
    bundles,
    overview,
    reviewerIds,
    chatImages,
    config,
    options,
    defaults,
    session.artifacts,
    followUp
  )

  session.stage = 'domain_trd_generated'
  session.updatedAt = new Date()
  await stateManager.saveTrdSession(session)

  const synthesis = await synthesizeTrd(
    overview,
    bundles,
    partials,
    chatImages,
    config,
    defaults,
    followUp
  )

  writeFileSync(session.artifacts.trdPath, synthesis.trdMarkdown, 'utf-8')
  writeFileSync(session.artifacts.openQuestionsPath, renderOpenQuestionsMarkdown(synthesis), 'utf-8')

  session.stage = 'integration_generated'
  session.updatedAt = new Date()
  await stateManager.saveTrdSession(session)

  session.stage = 'completed'
  session.updatedAt = new Date()
  session.rounds.push({
    roundNumber: session.rounds.length + 1,
    prompt: followUp,
    summary: '根据追问更新 TRD',
    timestamp: new Date(),
  })
  await stateManager.saveTrdSession(session)

  console.log(chalk.green(`已更新 TRD: ${session.artifacts.trdPath}`))
  console.log(chalk.green(`已更新待确认清单: ${session.artifacts.openQuestionsPath}`))
}

async function handleList(stateManager: StateManager): Promise<void> {
  const sessions = await stateManager.listTrdSessions()
  if (sessions.length === 0) {
    console.log(chalk.yellow('No TRD sessions found.'))
    return
  }

  console.log(chalk.bgBlue.white.bold(' TRD Sessions '))
  console.log(chalk.dim('─'.repeat(90)))
  console.log(chalk.dim(`  ${'ID'.padEnd(10)} ${'Stage'.padEnd(22)} ${'Title'.padEnd(30)} Updated`))
  console.log(chalk.dim('─'.repeat(90)))
  for (const s of sessions) {
    const title = s.title.length > 28 ? `${s.title.slice(0, 27)}…` : s.title
    console.log(`  ${chalk.cyan(s.id.padEnd(8))} ${s.stage.padEnd(22)} ${title.padEnd(30)} ${s.updatedAt.toISOString()}`)
  }
  console.log(chalk.dim('─'.repeat(90)))
}

export async function runTrdFlow(input: RunTrdFlowInput): Promise<TrdFlowResult> {
  return runInCommandContext(input.cwd, async () => {
    const prdArg = input.prdPath
    const options = input.options
    const spinner = ora('Loading configuration...').start()
    try {
      const config = loadConfig(options.config) as MagpieConfigV2
      spinner.succeed('Configuration loaded')

      const stateManager = new StateManager(process.cwd())
      await stateManager.initTrdSessions()

      if (options.list) {
        await handleList(stateManager)
        return { exitCode: 0, summary: 'TRD sessions listed.' }
      }

      if (options.resume) {
        await handleResume(options.resume, prdArg, options, config, stateManager)
        return { exitCode: 0, summary: 'TRD session resumed.' }
      }

      if (!prdArg) {
        throw new Error('Please provide a PRD markdown file path')
      }

      await runNewTrd(prdArg, options, config, stateManager)
      return { exitCode: 0, summary: `TRD completed for ${prdArg}.` }
    } catch (error) {
      if (error instanceof CommandExitError) {
        return {
          exitCode: error.code,
          summary: error.code === 130 ? 'TRD interrupted.' : 'TRD failed.',
        }
      }
      spinner.stop()
      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`))
      } else {
        console.error(chalk.red(String(error)))
      }
      return { exitCode: 1, summary: 'TRD failed.' }
    }
  })
}
