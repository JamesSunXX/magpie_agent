export interface ParsedImage {
  index: number
  alt: string
  source: string
  resolvedPath?: string
  ocrText?: string
  error?: string
}

export interface PrdRequirement {
  id: string
  text: string
  section?: string
}

export interface ParsedPrd {
  path: string
  title: string
  rawMarkdown: string
  requirements: PrdRequirement[]
  sections: Array<{ title: string; content: string }>
  images: ParsedImage[]
}

export interface DomainBoundary {
  id: string
  name: string
  description: string
  owner: string
  inScope: string[]
  outOfScope: string[]
  upstreams: string[]
  downstreams: string[]
  contracts: string[]
}

export interface DomainOverview {
  summary: string
  principles: string[]
  domains: DomainBoundary[]
  crossDomainFlows: string[]
  risks: string[]
}

export interface DomainRequirementBundle {
  domain: DomainBoundary
  requirements: PrdRequirement[]
}

export interface TrdSynthesisResult {
  trdMarkdown: string
  openQuestions: Array<{
    id: string
    question: string
    priority: 'high' | 'medium' | 'low'
    domain: string
    blocker: boolean
  }>
  traceability: Array<{
    requirementId: string
    domainId: string
    decision: string
  }>
}

