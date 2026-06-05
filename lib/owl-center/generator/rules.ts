import type {
  CompatibilityRule,
  TraitCategory,
  TraitLayer,
  TraitSelection,
} from '@/lib/owl-center/generator/types'

export function buildDna(traitIds: string[]): string {
  return [...traitIds].sort().join('-')
}

export function selectionFromTraits(traits: TraitLayer[]): TraitSelection {
  const sel: TraitSelection = {}
  for (const t of traits) {
    sel[t.categoryId] = t.id
  }
  return sel
}

export function traitsForSelection(allTraits: TraitLayer[], selection: TraitSelection): TraitLayer[] {
  const byId = new Map(allTraits.map((t) => [t.id, t]))
  const out: TraitLayer[] = []
  for (const traitId of Object.values(selection)) {
    if (!traitId) continue
    const t = byId.get(traitId)
    if (t) out.push(t)
  }
  return out
}

function selectionHasTrait(selection: TraitSelection, traitId: string): boolean {
  return Object.values(selection).includes(traitId)
}

export function comboTraitIds(rule: CompatibilityRule): string[] {
  return rule.traitIds ?? []
}

export function isIfPoolRule(rule: CompatibilityRule): boolean {
  return rule.type === 'if_pool'
}

/** Active if_pool rules for a category given the current partial selection. */
export function activeIfPoolRules(
  categoryId: string,
  selection: TraitSelection,
  rules: CompatibilityRule[]
): CompatibilityRule[] {
  return rules.filter(
    (r) =>
      r.type === 'if_pool' &&
      r.targetCategoryId === categoryId &&
      r.whenTraitId &&
      selectionHasTrait(selection, r.whenTraitId)
  )
}

/**
 * Trait pool for random generation — narrows to allowedTraitIds when an if_pool trigger is active.
 * Multiple active rules on the same category intersect their allowed sets.
 */
export function getCategoryPool(
  categoryId: string,
  selection: TraitSelection,
  allTraits: TraitLayer[],
  rules: CompatibilityRule[]
): TraitLayer[] {
  const base = allTraits.filter((t) => t.categoryId === categoryId)
  const active = activeIfPoolRules(categoryId, selection, rules)
  if (!active.length) return base

  let allowedIds: string[] | null = null
  for (const rule of active) {
    const ids = rule.allowedTraitIds ?? []
    if (allowedIds === null) {
      allowedIds = ids
    } else {
      const idSet = new Set(ids)
      allowedIds = allowedIds.filter((id) => idSet.has(id))
    }
  }

  if (!allowedIds?.length) return []
  const allowed = new Set(allowedIds)
  return base.filter((t) => allowed.has(t.id))
}

export function validateSelection(
  selection: TraitSelection,
  rules: CompatibilityRule[],
  traitById?: Map<string, TraitLayer>
): string | null {
  for (const rule of rules) {
    if (rule.type === 'if_pool') {
      if (!rule.whenTraitId || !rule.targetCategoryId) continue
      if (!selectionHasTrait(selection, rule.whenTraitId)) continue

      const picked = selection[rule.targetCategoryId]
      const allowed = rule.allowedTraitIds ?? []
      if (picked && !allowed.includes(picked)) {
        const whenName = traitById?.get(rule.whenTraitId)?.name ?? 'trigger trait'
        return (
          rule.label ??
          `When "${whenName}" is selected, this category can only use allowed traits from the IF rule`
        )
      }
      continue
    }

    const ids = comboTraitIds(rule).filter(Boolean)
    if (ids.length < 2) continue

    const present = ids.filter((id) => selectionHasTrait(selection, id))

    if (rule.type === 'require') {
      if (present.length > 0 && present.length < ids.length) {
        return rule.label ?? `Trait combo incomplete — linked traits must appear together`
      }
    }

    if (rule.type === 'exclude' && present.length >= 2) {
      return rule.label ?? `Incompatible traits selected`
    }

    if (rule.type === 'lock_set') {
      if (present.length > 0 && present.length < ids.length) {
        return rule.label ?? `Locked set must be all-or-nothing`
      }
    }
  }
  return null
}

export function pickWeightedRandom<T extends { weight: number }>(items: T[]): T | null {
  if (!items.length) return null
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0)
  if (total <= 0) return items[Math.floor(Math.random() * items.length)] ?? null
  let r = Math.random() * total
  for (const item of items) {
    r -= Math.max(0, item.weight)
    if (r <= 0) return item
  }
  return items[items.length - 1] ?? null
}

const MAX_SELECTION_ATTEMPTS = 500

/** Pick one random valid selection, respecting if_pool pools and combo rules. */
export function randomSelection(
  categories: TraitCategory[],
  allTraits: TraitLayer[],
  rules: CompatibilityRule[]
): TraitSelection | null {
  const sorted = [...categories].sort((a, b) => a.zIndex - b.zIndex)
  const traitById = new Map(allTraits.map((t) => [t.id, t]))

  for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt++) {
    const selection: TraitSelection = {}

    for (const cat of sorted) {
      const pool = getCategoryPool(cat.id, selection, allTraits, rules)
      if (!pool.length) {
        selection[cat.id] = null
        continue
      }
      const picked = pickWeightedRandom(pool)
      selection[cat.id] = picked?.id ?? null
    }

    if (!validateSelection(selection, rules, traitById)) return selection
  }
  return null
}
