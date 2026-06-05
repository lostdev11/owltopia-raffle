import { buildDna, randomSelection, traitsForSelection } from '@/lib/owl-center/generator/rules'
import type { GeneratedNft, GeneratorProject, TraitLayer, TraitSelection } from '@/lib/owl-center/generator/types'

const MAX_ATTEMPTS = 500

function traitsByCategory(traits: TraitLayer[], categoryId: string): TraitLayer[] {
  return traits.filter((t) => t.categoryId === categoryId)
}

export function generateBatch(
  project: GeneratorProject,
  count: number,
  options?: { requireAllCategories?: boolean }
): GeneratedNft[] {
  const { categories, traits, rules } = project
  const requireAll = options?.requireAllCategories ?? false
  const seen = new Set<string>()
  const out: GeneratedNft[] = []

  const catById = new Map(categories.map((c) => [c.id, c]))

  for (let i = 0; i < count; i++) {
    let selection: TraitSelection | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      selection = randomSelection(categories, traits, rules)
      if (!selection) continue

      if (requireAll) {
        const hasEmpty = categories.some((c) => {
          const pool = traitsByCategory(traits, c.id)
          return pool.length > 0 && !selection![c.id]
        })
        if (hasEmpty) continue
      }

      const picked = traitsForSelection(traits, selection)
      if (!picked.length) continue

      const dna = buildDna(picked.map((t) => t.id))
      if (seen.has(dna)) continue
      seen.add(dna)

      out.push({
        index: out.length,
        dna,
        traits: picked,
        attributes: picked.map((t) => ({
          trait_type: catById.get(t.categoryId)?.name ?? 'Trait',
          value: t.name,
        })),
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
