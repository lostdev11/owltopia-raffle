import { attributesForSelection, getCategorySelectionIds } from '@/lib/owl-center/generator/selection'
import { buildDna, getCategoryPool, randomSelection, traitsForSelection } from '@/lib/owl-center/generator/rules'
import type { GeneratedNft, GeneratorProject, TraitSelection } from '@/lib/owl-center/generator/types'

const MAX_ATTEMPTS = 500

export function generateBatch(
  project: GeneratorProject,
  count: number,
  options?: { requireAllCategories?: boolean }
): GeneratedNft[] {
  const { categories, traits, rules } = project
  const requireAll = options?.requireAllCategories ?? false
  const seen = new Set<string>()
  const out: GeneratedNft[] = []

  for (let i = 0; i < count; i++) {
    let selection: TraitSelection | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      selection = randomSelection(categories, traits, rules)
      if (!selection) continue

      if (requireAll) {
        const hasEmpty = categories.some((c) => {
          if (getCategorySelectionIds(selection!, c.id).length > 0) return false
          // Empty is only a problem if the layer could actually have been filled —
          // a layer forced empty by a skip_layer / if_pool rule is intentional.
          return getCategoryPool(c.id, selection!, traits, rules, categories).length > 0
        })
        if (hasEmpty) continue
      }

      const picked = traitsForSelection(traits, selection, categories)
      if (!picked.length) continue

      const dna = buildDna(picked.map((t) => t.id))
      if (seen.has(dna)) continue
      seen.add(dna)

      out.push({
        index: out.length,
        dna,
        traits: picked,
        attributes: attributesForSelection(categories, picked),
      })
      break
    }

    if (out.length <= i) {
      throw new Error(
        `Could only generate ${out.length} unique piece(s). Add traits, relax rules, or lower batch size.`
      )
    }
  }

  return out
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Same logic as generateBatch, but yields to the event loop periodically so a
 * large supply (e.g. 2,000) doesn't freeze the main thread / get the tab killed
 * on mobile. Reports progress as pieces are produced.
 */
export async function generateBatchAsync(
  project: GeneratorProject,
  count: number,
  options?: {
    requireAllCategories?: boolean
    /** Return whatever unique pieces could be made instead of throwing when the rules cap uniqueness. */
    bestEffort?: boolean
    onProgress?: (completed: number, total: number) => void
  }
): Promise<GeneratedNft[]> {
  const { categories, traits, rules } = project
  const requireAll = options?.requireAllCategories ?? false
  const bestEffort = options?.bestEffort ?? false
  const seen = new Set<string>()
  const out: GeneratedNft[] = []

  for (let i = 0; i < count; i++) {
    let selection: TraitSelection | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      selection = randomSelection(categories, traits, rules)
      if (!selection) continue

      if (requireAll) {
        const hasEmpty = categories.some((c) => {
          if (getCategorySelectionIds(selection!, c.id).length > 0) return false
          return getCategoryPool(c.id, selection!, traits, rules, categories).length > 0
        })
        if (hasEmpty) continue
      }

      const picked = traitsForSelection(traits, selection, categories)
      if (!picked.length) continue

      const dna = buildDna(picked.map((t) => t.id))
      if (seen.has(dna)) continue
      seen.add(dna)

      out.push({
        index: out.length,
        dna,
        traits: picked,
        attributes: attributesForSelection(categories, picked),
      })
      break
    }

    if (out.length <= i) {
      // The rules can't produce any more unique combos.
      if (bestEffort) break
      throw new Error(
        `Could only generate ${out.length} unique piece(s). Add traits, relax rules, or lower target supply.`
      )
    }

    if ((i + 1) % 100 === 0) {
      options?.onProgress?.(out.length, count)
      await yieldToBrowser()
    }
  }

  options?.onProgress?.(out.length, count)
  return out
}
