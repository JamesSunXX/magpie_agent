import { basename } from 'path'
import { readFileSync } from 'fs'
import type { ParsedPrd, ParsedImage, PrdRequirement } from './types.js'

const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function isRequirementLine(line: string): boolean {
  if (!line) return false
  if (line.startsWith('#')) return false
  if (line.startsWith('```')) return false
  if (line.startsWith('![')) return false
  if (line.length < 8) return false
  return /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || line.length > 20
}

function extractImages(markdown: string): ParsedImage[] {
  const images: ParsedImage[] = []
  let match: RegExpExecArray | null
  let index = 0

  while ((match = IMAGE_REGEX.exec(markdown)) !== null) {
    index += 1
    images.push({
      index,
      alt: (match[1] || '').trim(),
      source: (match[2] || '').trim(),
    })
  }

  return images
}

function extractSections(markdown: string): Array<{ title: string; content: string }> {
  const lines = markdown.split('\n')
  const sections: Array<{ title: string; content: string }> = []
  let currentTitle = 'Overview'
  let currentContent: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('#')) {
      if (currentContent.length > 0) {
        sections.push({ title: currentTitle, content: currentContent.join('\n').trim() })
      }
      currentTitle = line.replace(/^#+\s*/, '').trim() || 'Untitled'
      currentContent = []
      continue
    }
    currentContent.push(raw)
  }

  if (currentContent.length > 0) {
    sections.push({ title: currentTitle, content: currentContent.join('\n').trim() })
  }

  return sections
}

function extractRequirements(sections: Array<{ title: string; content: string }>): PrdRequirement[] {
  const requirements: PrdRequirement[] = []
  let index = 0

  for (const section of sections) {
    for (const rawLine of section.content.split('\n')) {
      const line = normalizeLine(rawLine)
      if (!isRequirementLine(line)) continue
      index += 1
      const text = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim()
      requirements.push({
        id: `REQ-${String(index).padStart(3, '0')}`,
        text,
        section: section.title,
      })
    }
  }

  return requirements
}

export function parsePrdMarkdown(filePath: string): ParsedPrd {
  const rawMarkdown = readFileSync(filePath, 'utf-8')
  const lines = rawMarkdown.split('\n')
  const firstHeading = lines.find(l => l.trim().startsWith('#'))
  const title = firstHeading
    ? firstHeading.replace(/^#+\s*/, '').trim()
    : basename(filePath, '.md')

  const sections = extractSections(rawMarkdown)
  const requirements = extractRequirements(sections)
  const images = extractImages(rawMarkdown)

  return {
    path: filePath,
    title,
    rawMarkdown,
    requirements,
    sections,
    images,
  }
}

