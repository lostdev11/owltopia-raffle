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
