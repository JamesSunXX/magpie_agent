import type { TrdConstraintsArtifact, TrdConstraintRule } from '../types.js'

interface BuildConstraintsArtifactInput {
  sourcePrdPath: string
  sourceTrdPath: string
  generatedAt: Date
  texts: string[]
}

function pushRuleIfMissing(rules: TrdConstraintRule[], rule: TrdConstraintRule): void {
  if (rules.some((existing) => existing.id === rule.id)) {
    return
  }
  rules.push(rule)
}

function extractApiPathRule(text: string): TrdConstraintRule | null {
  const match = text.match(/\/api\/v\d+\/\*/i)
  if (!match) return null

  return {
    id: `api-path-${match[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    category: 'api',
    description: `API 路径必须符合 ${match[0]} 规范`,
    severity: 'error',
    scope: 'repository',
    checkType: 'path_pattern',
    expected: [match[0]],
    forbidden: [],
  }
}

function extractDependencyRules(text: string): TrdConstraintRule[] {
  const normalized = text.toLowerCase()
  const rules: TrdConstraintRule[] = []

  if ((normalized.includes('禁止引入 axios') || normalized.includes('禁止使用 axios') || normalized.includes('禁止 axios'))) {
    rules.push({
      id: 'dependency-no-axios',
      category: 'dependency',
      description: '禁止引入 axios',
      severity: 'error',
      scope: 'repository',
      checkType: 'forbidden_dependency',
      expected: [],
      forbidden: ['axios'],
    })
  }

  return rules
}

function extractTestRule(text: string): TrdConstraintRule | null {
  if (!text.toLowerCase().includes('.test.ts')) {
    return null
  }

  return {
    id: 'test-requires-dot-test-ts',
    category: 'test',
    description: '新增转换或逻辑改动必须包含对应 .test.ts 文件',
    severity: 'error',
    scope: 'changed_files',
    checkType: 'required_test_file',
    expected: ['.test.ts'],
    forbidden: [],
  }
}

function extractPathRule(text: string): TrdConstraintRule | null {
  const match = text.match(/src\/[A-Za-z0-9/_-]+/g)?.[0]
  if (!match) return null
  const normalized = text.toLowerCase()
  if (!normalized.includes('放在') && !normalized.includes('目录') && !normalized.includes('路径')) {
    return null
  }

  return {
    id: `path-required-${match.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    category: 'path',
    description: `相关实现应放在 ${match}`,
    severity: 'warning',
    scope: 'changed_files',
    checkType: 'required_path_prefix',
    expected: [match],
    forbidden: [],
  }
}

export function buildConstraintsArtifact(input: BuildConstraintsArtifactInput): TrdConstraintsArtifact {
  const rules: TrdConstraintRule[] = []

  for (const text of input.texts) {
    for (const dependencyRule of extractDependencyRules(text)) {
      pushRuleIfMissing(rules, dependencyRule)
    }

    const apiRule = extractApiPathRule(text)
    if (apiRule) {
      pushRuleIfMissing(rules, apiRule)
    }

    const testRule = extractTestRule(text)
    if (testRule) {
      pushRuleIfMissing(rules, testRule)
    }

    const pathRule = extractPathRule(text)
    if (pathRule) {
      pushRuleIfMissing(rules, pathRule)
    }
  }

  return {
    version: 1,
    sourcePrdPath: input.sourcePrdPath,
    sourceTrdPath: input.sourceTrdPath,
    generatedAt: input.generatedAt.toISOString(),
    rules,
  }
}

export function serializeConstraintsArtifact(artifact: TrdConstraintsArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`
}
