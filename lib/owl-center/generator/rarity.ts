import type { GeneratorProject, TraitLayer } from '@/lib/owl-center/generator/types'

export function traitRarityPercent(trait: TraitLayer, categoryTraits: TraitLayer[]): number {
  const total = categoryTraits.reduce((s, t) => s + Math.max(0, t.weight), 0)
  if (total <= 0) return 0
  return (Math.max(0, trait.weight) / total) * 100
}

export function estimateMaxUniqueSupply(project: GeneratorProject): number {
  const counts = project.categories
    .map((c) => project.traits.filter((t) => t.categoryId === c.id).length)
    .filter((n) => n > 0)
  if (!counts.length) return 0
  const product = counts.reduce((a, b) => a * b, 1)
  return Math.min(1_000_000, product)
}

export function clampTraitWeight(raw: number): number {
  if (!Number.isFinite(raw)) return 100
  return Math.max(0, Math.min(10_000, Math.round(raw)))
}
