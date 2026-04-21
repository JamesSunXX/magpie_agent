export type ContextCompactionPriority = 'critical' | 'high' | 'normal' | 'low'

export interface ContextCompactionSection {
  title: string
  content: string
  priority?: ContextCompactionPriority
}

export interface ContextCompactionResult {
  compacted: boolean
  originalLength: number
  finalLength: number
  omittedSections: string[]
  text: string
}

const PRIORITY_ORDER: ContextCompactionPriority[] = ['critical', 'high', 'normal', 'low']
const SECTION_SEPARATOR = '\n\n'

function renderSection(section: ContextCompactionSection): string {
  return `## ${section.title}\n${section.content.trim()}`
}

function truncateTo(input: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (input.length <= maxChars) return input
  if (maxChars <= 3) return '.'.repeat(maxChars)
  return `${input.slice(0, maxChars - 3).trimEnd()}...`
}

function compactGroupToBudget(
  sections: Array<ContextCompactionSection & { rendered: string }>,
  budget: number
): Array<{ title: string; text: string }> {
  if (sections.length === 0 || budget <= 0) {
    return []
  }

  const perSectionBudget = Math.max(
    48,
    Math.floor((budget - (sections.length - 1) * SECTION_SEPARATOR.length) / sections.length)
  )

  return sections
    .map((section) => ({
      title: section.title,
      text: truncateTo(section.rendered, perSectionBudget),
    }))
    .filter((item) => item.text.length > 0)
}

export function compactContextSections(
  sections: ContextCompactionSection[],
  maxChars: number
): ContextCompactionResult {
  const prepared = sections
    .map((section) => ({
      ...section,
      priority: section.priority || 'normal',
      rendered: renderSection(section),
    }))
    .filter((section) => section.content.trim().length > 0)

  const originalText = prepared.map((section) => section.rendered).join(SECTION_SEPARATOR)
  const originalLength = originalText.length

  if (originalLength <= maxChars) {
    return {
      compacted: false,
      originalLength,
      finalLength: originalLength,
      omittedSections: [],
      text: originalText,
    }
  }

  const omittedSections: string[] = []
  const keptSections: string[] = []
  let remainingBudget = maxChars

  for (const priority of PRIORITY_ORDER) {
    const group = prepared.filter((section) => section.priority === priority)
    if (group.length === 0) continue

    const allFit = group.every((section, index) => {
      const separator = keptSections.length + index > 0 ? SECTION_SEPARATOR.length : 0
      return section.rendered.length + separator <= remainingBudget
    })

    if (allFit) {
      for (const section of group) {
        if (keptSections.length > 0) {
          remainingBudget -= SECTION_SEPARATOR.length
        }
        keptSections.push(section.rendered)
        remainingBudget -= section.rendered.length
      }
      continue
    }

    const compactedGroup = compactGroupToBudget(group, remainingBudget)
    for (const section of compactedGroup) {
      const separatorBudget = keptSections.length > 0 ? SECTION_SEPARATOR.length : 0
      const available = remainingBudget - separatorBudget
      if (available <= 0) break

      const fitted = truncateTo(section.text, available)
      if (!fitted) break

      if (separatorBudget > 0) {
        remainingBudget -= SECTION_SEPARATOR.length
      }
      keptSections.push(fitted)
      remainingBudget -= fitted.length
      if (remainingBudget <= 0) break
    }

    const omittedFromPriority = group
      .filter((section) => !keptSections.some((item) => item.startsWith(`## ${section.title}\n`)))
      .map((section) => section.title)
    for (const title of omittedFromPriority) {
      if (!omittedSections.includes(title)) {
        omittedSections.push(title)
      }
    }

    if (remainingBudget <= 0) {
      const leftover = prepared
        .filter((section) => !keptSections.some((item) => item.startsWith(`## ${section.title}\n`)))
        .map((section) => section.title)
      for (const title of leftover) {
        if (!omittedSections.includes(title)) {
          omittedSections.push(title)
        }
      }
      break
    }
  }

  const compactedText = keptSections.join(SECTION_SEPARATOR)
  return {
    compacted: true,
    originalLength,
    finalLength: compactedText.length,
    omittedSections,
    text: compactedText,
  }
}
