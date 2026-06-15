import type { SugarBatchScanResult } from '@/lib/owl-center/scan-sugar-batch'

export const GENERATOR_STAGED_ASSETS_KEY = 'owl-center-generator-staged-assets'

export type GeneratorStagedAssetsHandoff = {
  project_id: string
  job_id: string
  filename: string | null
  status: string
  validation_scan: SugarBatchScanResult | null
  updated_at: string
}

export function saveStagedAssetsHandoffToSession(handoff: GeneratorStagedAssetsHandoff): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(GENERATOR_STAGED_ASSETS_KEY, JSON.stringify(handoff))
}

export function readStagedAssetsHandoffFromSession(projectId?: string): GeneratorStagedAssetsHandoff | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(GENERATOR_STAGED_ASSETS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GeneratorStagedAssetsHandoff
    if (!parsed?.project_id || !parsed?.job_id) return null
    if (projectId && parsed.project_id !== projectId) return null
    return parsed
  } catch {
    return null
  }
}

export function clearStagedAssetsHandoffFromSession(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(GENERATOR_STAGED_ASSETS_KEY)
}
