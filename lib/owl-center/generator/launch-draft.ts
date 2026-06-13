import type { GeneratorProject } from '@/lib/owl-center/generator/types'
import { estimateMaxUniqueSupply } from '@/lib/owl-center/generator/rarity'

export const GENERATOR_LAUNCH_DRAFT_KEY = 'owl-center-generator-launch-draft'

export type GeneratorLaunchDraft = {
  collection_name: string
  symbol: string
  description: string
  total_supply: string
  total_images: string
  total_metadata: string
  asset_notes: string
  /** True when operator exported full-supply Sugar ZIP before handoff. */
  full_export_completed?: boolean
  source: 'owl_generator'
  project_id: string
  updated_at: string
}

export const GENERATOR_EXPORT_META_KEY = 'owl-center-generator-export-meta'

export const GENERATOR_PROJECT_ID_KEY = 'owl-center-generator-project-id'

export type GeneratorExportMeta = {
  exported_count: number
  full_supply: boolean
  exported_at: string
}

export function saveGeneratorProjectIdToSession(projectId: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(GENERATOR_PROJECT_ID_KEY, projectId)
}

export function readGeneratorProjectIdFromSession(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  const id = sessionStorage.getItem(GENERATOR_PROJECT_ID_KEY)
  return id?.trim() ? id.trim() : null
}

export function clearGeneratorProjectIdFromSession(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(GENERATOR_PROJECT_ID_KEY)
}

export function saveExportMetaToSession(meta: GeneratorExportMeta): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(GENERATOR_EXPORT_META_KEY, JSON.stringify(meta))
}

export function readExportMetaFromSession(): GeneratorExportMeta | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(GENERATOR_EXPORT_META_KEY)
    if (!raw) return null
    return JSON.parse(raw) as GeneratorExportMeta
  } catch {
    return null
  }
}

export function clearExportMetaFromSession(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(GENERATOR_EXPORT_META_KEY)
}

export function buildLaunchDraft(project: GeneratorProject): GeneratorLaunchDraft {
  const traitCount = project.traits.length
  const ruleCount = project.rules.length
  const categories = project.categories
    .map((c) => {
      const n = project.traits.filter((t) => t.categoryId === c.id).length
      return `${c.name} (${n})`
    })
    .join(', ')

  const supply = project.targetSupply ?? estimateMaxUniqueSupply(project)
  const supplyStr = String(Math.max(1, supply))
  const exportMeta = readExportMetaFromSession()
  const exportCount = exportMeta?.full_supply ? String(exportMeta.exported_count) : supplyStr

  return {
    collection_name: project.collectionName,
    symbol: project.symbol,
    description: project.description,
    total_supply: supplyStr,
    total_images: exportCount,
    total_metadata: exportCount,
    full_export_completed: exportMeta?.full_supply === true,
    asset_notes: [
      `Created with Owl Center Generator — project "${project.name}".`,
      categories ? `Categories: ${categories}.` : '',
      `${traitCount} trait layer(s), ${ruleCount} compatibility rule(s).`,
      exportMeta?.full_supply
        ? `Full Sugar ZIP exported (${exportMeta.exported_count} files) — drop the same ZIP in step 3 to verify counts, or Stage ZIP in admin after approval (Phase B).`
        : 'Export full-supply Sugar ZIP from Generator, scan in step 3, then Sugar upload or Phase B staging in admin.',
    ]
      .filter(Boolean)
      .join(' '),
    source: 'owl_generator',
    project_id: project.id,
    updated_at: project.updatedAt,
  }
}

export function saveLaunchDraftToSession(draft: GeneratorLaunchDraft): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(GENERATOR_LAUNCH_DRAFT_KEY, JSON.stringify(draft))
}

export function readLaunchDraftFromSession(): GeneratorLaunchDraft | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(GENERATOR_LAUNCH_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GeneratorLaunchDraft
    if (parsed?.source !== 'owl_generator') return null
    return parsed
  } catch {
    return null
  }
}

export function clearLaunchDraftFromSession(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(GENERATOR_LAUNCH_DRAFT_KEY)
  clearExportMetaFromSession()
}

export function clearGeneratorHandoffFromSession(): void {
  clearLaunchDraftFromSession()
  clearGeneratorProjectIdFromSession()
}
