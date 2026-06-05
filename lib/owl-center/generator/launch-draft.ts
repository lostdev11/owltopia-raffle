import type { GeneratorProject } from '@/lib/owl-center/generator/types'
import { estimateMaxUniqueSupply } from '@/lib/owl-center/generator/rarity'

export const GENERATOR_LAUNCH_DRAFT_KEY = 'owl-center-generator-launch-draft'

export type GeneratorLaunchDraft = {
  collection_name: string
  symbol: string
  description: string
  total_supply: string
  asset_notes: string
  source: 'owl_generator'
  project_id: string
  updated_at: string
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

  return {
    collection_name: project.collectionName,
    symbol: project.symbol,
    description: project.description,
    total_supply: String(Math.max(1, supply)),
    asset_notes: [
      `Created with Owl Center Generator — project "${project.name}".`,
      categories ? `Categories: ${categories}.` : '',
      `${traitCount} trait layer(s), ${ruleCount} compatibility rule(s).`,
      'Next: export Sugar ZIP from Generator → Sugar validate/upload/deploy → paste bundle paths in this form.',
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
}
