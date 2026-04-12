import { loadDocumentPlan } from '../../core/project-documents/document-plan.js'

export async function printDocumentPlanSummary(documentPlanPath: string | undefined): Promise<void> {
  if (!documentPlanPath) {
    return
  }

  const plan = await loadDocumentPlan(documentPlanPath)
  if (!plan) {
    return
  }

  console.log(`Document mode: ${plan.mode}`)
  console.log(`Formal docs root: ${plan.formalDocsRoot}`)
  if (plan.fallbackReason) {
    console.log(`Document fallback: ${plan.fallbackReason}`)
  }
}
