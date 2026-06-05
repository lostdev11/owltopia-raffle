import { buildDna, randomSelection, traitsForSelection } from '@/lib/owl-center/generator/rules'
import type { GeneratedNft, GeneratorProject } from '@/lib/owl-center/generator/types'

export type TraitSimStat = {
  traitId: string
  traitName: string
  categoryName: string
  count: number
  percent: number
  expectedPercent: number
}

export type SupplySimulationResult = {
  target: number
  generated: number
  exhausted: boolean
  attempts: number
  combos: GeneratedNft[]
  traitStats: TraitSimStat[]
  warnings: string[]
}

const MAX_STREAK_WITHOUT_NEW = 3_000
const MAX_ATTEMPTS_MULTIPLIER = 80

function buildTraitStats(project: GeneratorProject, combos: GeneratedNft[]): TraitSimStat[] {
  const generated = combos.length
  if (!generated) return []

  const traitCounts = new Map<string, number>()
  for (const combo of combos) {
    for (const t of combo.traits) {
      traitCounts.set(t.id, (traitCounts.get(t.id) ?? 0) + 1)
    }
  }

  const stats: TraitSimStat[] = []
  for (const cat of project.categories) {
    const catTraits = project.traits.filter((t) => t.categoryId === cat.id)
    const weightTotal = catTraits.reduce((s, t) => s + Math.max(0, t.weight), 0)
    for (const trait of catTraits) {
      const count = traitCounts.get(trait.id) ?? 0
      const expectedPercent =
        weightTotal > 0 ? (Math.max(0, trait.weight) / weightTotal) * 100 : 0
      stats.push({
        traitId: trait.id,
        traitName: trait.name,
        categoryName: cat.name,
        count,
        percent: (count / generated) * 100,
        expectedPercent,
      })
    }
  }
  return stats
}

function buildWarnings(project: GeneratorProject, result: Omit<SupplySimulationResult, 'warnings'>): string[] {
  const warnings: string[] = []
  const { target, generated, exhausted } = result

  if (generated < target) {
    warnings.push(
      exhausted
        ? `Only ${generated.toLocaleString()} unique combos exist under current rules (target ${target.toLocaleString()}). Add traits, relax rules, or lower supply.`
        : `Stopped at ${generated.toLocaleString()} combos before reaching ${target.toLocaleString()}. Try again or check for rule bottlenecks.`
    )
  } else {
    warnings.push(`Reached target — ${generated.toLocaleString()} unique combos generated.`)
  }

  for (const stat of result.traitStats) {
    if (stat.count === 0 && project.traits.find((t) => t.id === stat.traitId)?.weight) {
      warnings.push(`${stat.categoryName}: "${stat.traitName}" never appeared — may be blocked by rules.`)
    } else if (
      generated >= 50 &&
      stat.expectedPercent > 2 &&
      Math.abs(stat.percent - stat.expectedPercent) > stat.expectedPercent * 0.6
    ) {
      warnings.push(
        `${stat.categoryName}: "${stat.traitName}" is ${stat.percent.toFixed(1)}% (expected ~${stat.expectedPercent.toFixed(1)}%) — rules may be skewing distribution.`
      )
    }
  }

  return warnings
}

/** Generate unique combos up to target supply and analyze trait distribution. */
export function simulateSupply(project: GeneratorProject, target: number): SupplySimulationResult {
  const { categories, traits, rules } = project
  const catById = new Map(categories.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const combos: GeneratedNft[] = []

  let streak = 0
  let attempts = 0
  const maxAttempts = Math.max(target * MAX_ATTEMPTS_MULTIPLIER, 5_000)

  while (combos.length < target && streak < MAX_STREAK_WITHOUT_NEW && attempts < maxAttempts) {
    attempts++
    const selection = randomSelection(categories, traits, rules)
    if (!selection) {
      streak++
      continue
    }

    const picked = traitsForSelection(traits, selection)
    if (!picked.length) {
      streak++
      continue
    }

    const dna = buildDna(picked.map((t) => t.id))
    if (seen.has(dna)) {
      streak++
      continue
    }

    streak = 0
    seen.add(dna)
    combos.push({
      index: combos.length,
      dna,
      traits: picked,
      attributes: picked.map((t) => ({
        trait_type: catById.get(t.categoryId)?.name ?? 'Trait',
        value: t.name,
      })),
    })
  }

  const traitStats = buildTraitStats(project, combos)
  const partial = {
    target,
    generated: combos.length,
    exhausted: combos.length < target && streak >= MAX_STREAK_WITHOUT_NEW,
    attempts,
    combos,
    traitStats,
  }

  return {
    ...partial,
    warnings: buildWarnings(project, partial),
  }
}

export function simulationResultToCsv(project: GeneratorProject, result: SupplySimulationResult): string {
  const categories = [...project.categories].sort((a, b) => a.zIndex - b.zIndex)
  const header = ['index', ...categories.map((c) => c.name)].join(',')
  const rows = result.combos.map((combo) => {
    const byCat = new Map(combo.traits.map((t) => [t.categoryId, t.name]))
    const cells = categories.map((c) => {
      const value = byCat.get(c.id) ?? ''
      return `"${value.replace(/"/g, '""')}"`
    })
    return [combo.index + 1, ...cells].join(',')
  })
  return [header, ...rows].join('\n')
}
