import {
  flattenIfChainSteps,
  ifChainForcedAllTraits,
  ifChainStepBlockedByOtherSteps,
  ifChainStepCategoryId,
  ifChainStepMode,
  ifChainStepStackTraitIds,
  isIfChainActive,
  isIfChainFullySatisfied,
  normalizeIfChainSteps,
  withoutStackedNoneTraits,
} from '@/lib/owl-center/generator/if-chain'
import {
  getCategorySelectionIds,
  selectionHasTrait,
  traitsForSelection,
} from '@/lib/owl-center/generator/selection'
import type {
  CompatibilityRule,
  TraitCategory,
  TraitLayer,
  TraitSelection,
} from '@/lib/owl-center/generator/types'

export { attributesForSelection, traitsForSelection, selectionHasTrait } from '@/lib/owl-center/generator/selection'

export function buildDna(traitIds: string[]): string {
  return [...traitIds].sort().join('-')
}

export function selectionFromTraits(traits: TraitLayer[], categories?: TraitCategory[]): TraitSelection {
  const sel: TraitSelection = {}
  const catById = new Map(categories?.map((c) => [c.id, c]))

  for (const t of traits) {
    const cat = catById.get(t.categoryId)
    if (cat?.allowMultiple) {
      const existing = getCategorySelectionIds(sel, t.categoryId)
      sel[t.categoryId] = [...existing, t.id]
    } else {
      sel[t.categoryId] = t.id
    }
  }
  return sel
}

export function comboTraitIds(rule: CompatibilityRule): string[] {
  return rule.traitIds ?? []
}

export function chainTraitIds(rule: CompatibilityRule): string[] {
  return flattenIfChainSteps(normalizeIfChainSteps(rule))
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

/** Active skip_layer rules forcing this category empty given the current partial selection. */
export function activeSkipLayerRules(
  categoryId: string,
  selection: TraitSelection,
  rules: CompatibilityRule[]
): CompatibilityRule[] {
  return rules.filter(
    (r) =>
      r.type === 'skip_layer' &&
      r.targetCategoryId === categoryId &&
      r.whenTraitId &&
      selectionHasTrait(selection, r.whenTraitId)
  )
}

function intersectPool(pool: TraitLayer[], allowedIds: Set<string>): TraitLayer[] {
  const next = pool.filter((t) => allowedIds.has(t.id))
  return next
}

/**
 * Trait pool for random generation — respects if_pool (forward + reverse), exclude, require, and lock_set.
 * Multiple active if_pool rules on the same category intersect their allowed sets.
 */
export function getCategoryPool(
  categoryId: string,
  selection: TraitSelection,
  allTraits: TraitLayer[],
  rules: CompatibilityRule[],
  categories?: TraitCategory[]
): TraitLayer[] {
  const traitById = new Map(allTraits.map((t) => [t.id, t]))
  let pool = allTraits.filter((t) => t.categoryId === categoryId)

  // skip_layer — when the trigger trait is selected, this whole layer stays empty.
  if (activeSkipLayerRules(categoryId, selection, rules).length) return []

  // Reverse skip_layer — if a layer this trait would force empty is already filled,
  // the trigger trait can't be picked (keeps it order-independent like if_pool).
  for (const rule of rules) {
    if (rule.type !== 'skip_layer' || !rule.whenTraitId || !rule.targetCategoryId) continue
    const whenTrait = traitById.get(rule.whenTraitId)
    if (!whenTrait || whenTrait.categoryId !== categoryId) continue
    if (getCategorySelectionIds(selection, rule.targetCategoryId).length > 0) {
      pool = pool.filter((t) => t.id !== rule.whenTraitId)
    }
  }

  const active = activeIfPoolRules(categoryId, selection, rules)
  if (active.length) {
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
    pool = intersectPool(pool, new Set(allowedIds))
  }

  for (const rule of rules) {
    if (rule.type !== 'if_pool' || !rule.whenTraitId || !rule.targetCategoryId) continue
    const whenTrait = traitById.get(rule.whenTraitId)
    if (!whenTrait || whenTrait.categoryId !== categoryId) continue

    const targetPickedIds = getCategorySelectionIds(selection, rule.targetCategoryId)
    if (!targetPickedIds.length) continue

    const allowed = rule.allowedTraitIds ?? []
    if (targetPickedIds.some((id) => !allowed.includes(id))) {
      pool = pool.filter((t) => t.id !== rule.whenTraitId)
    }
  }

  const catById = new Map(categories?.map((c) => [c.id, c]))

  for (const rule of rules) {
    if (rule.type === 'if_chain') {
      const steps = normalizeIfChainSteps(rule)
      if (steps.length < 2) continue
      if (!isIfChainActive(steps, selection)) continue

      // The trigger (first step) layer always rolls on its own weight — the chain
      // only constrains the downstream steps once the trigger trait is selected.
      const triggerCategoryId = ifChainStepCategoryId(steps[0], traitById)
      if (categoryId === triggerCategoryId) continue

      const stepForCat = steps.find(
        (step, idx) => idx > 0 && ifChainStepCategoryId(step, traitById) === categoryId
      )
      if (!stepForCat) continue

      const cat = catById?.get(categoryId)
      const mode = ifChainStepMode(cat, stepForCat)
      // For stack-all steps, the "No Trait" sentinel never stacks with real traits.
      const stepTraitIds = mode === 'all' ? ifChainStepStackTraitIds(stepForCat, traitById) : stepForCat.traitIds
      const allowed = new Set(stepTraitIds)

      if (ifChainStepBlockedByOtherSteps(stepForCat, steps, selection, traitById)) {
        pool = pool.filter((t) => !allowed.has(t.id))
        continue
      }

      pool = pool.filter((t) => allowed.has(t.id))

      const presentInStep = stepTraitIds.filter((id) => selectionHasTrait(selection, id))
      if (mode === 'all' && presentInStep.length > 0 && presentInStep.length < stepTraitIds.length) {
        const missing = new Set(
          stepTraitIds.filter((id) => !selectionHasTrait(selection, id))
        )
        pool = pool.filter((t) => missing.has(t.id))
        if (!pool.length) return []
      }

      if ((mode === 'single' || mode === 'one_of') && presentInStep.length === 0) {
        // Chain active — must pick from this step's options.
        if (!pool.length) return []
      }

      continue
    }

    if (rule.type === 'if_pool') continue

    const ids = comboTraitIds(rule).filter(Boolean)
    if (ids.length < 2) continue

    const present = ids.filter((id) => selectionHasTrait(selection, id))

    if (rule.type === 'exclude' && present.length > 0) {
      for (const id of ids) {
        if (selectionHasTrait(selection, id)) continue
        const trait = traitById.get(id)
        if (trait?.categoryId === categoryId) {
          pool = pool.filter((t) => t.id !== id)
        }
      }
    }

    if ((rule.type === 'require' || rule.type === 'lock_set') && present.length > 0 && present.length < ids.length) {
      const mandatory = new Set<string>()
      for (const id of ids) {
        if (selectionHasTrait(selection, id)) continue
        const trait = traitById.get(id)
        if (trait?.categoryId === categoryId) mandatory.add(id)
      }
      if (mandatory.size) {
        pool = pool.filter((t) => mandatory.has(t.id))
        if (!pool.length) return []
      }
    }
  }

  return pool
}

export function validateSelection(
  selection: TraitSelection,
  rules: CompatibilityRule[],
  traitById?: Map<string, TraitLayer>,
  categories?: TraitCategory[]
): string | null {
  for (const rule of rules) {
    if (rule.type === 'skip_layer') {
      if (!rule.whenTraitId || !rule.targetCategoryId) continue
      if (!selectionHasTrait(selection, rule.whenTraitId)) continue
      if (getCategorySelectionIds(selection, rule.targetCategoryId).length > 0) {
        const whenName = traitById?.get(rule.whenTraitId)?.name ?? 'trigger trait'
        return rule.label ?? `When "${whenName}" is selected, this layer must be empty`
      }
      continue
    }

    if (rule.type === 'if_pool') {
      if (!rule.whenTraitId || !rule.targetCategoryId) continue
      if (!selectionHasTrait(selection, rule.whenTraitId)) continue

      const pickedIds = getCategorySelectionIds(selection, rule.targetCategoryId)
      const allowed = rule.allowedTraitIds ?? []
      if (pickedIds.some((id) => !allowed.includes(id))) {
        const whenName = traitById?.get(rule.whenTraitId)?.name ?? 'trigger trait'
        return (
          rule.label ??
          `When "${whenName}" is selected, this category can only use allowed traits from the IF rule`
        )
      }
      continue
    }

    if (rule.type === 'if_chain') {
      const steps = normalizeIfChainSteps(rule)
      if (steps.length < 2) continue
      if (!isIfChainActive(steps, selection)) continue
      if (!traitById || !categories) continue
      if (!isIfChainFullySatisfied(steps, selection, categories, traitById)) {
        return rule.label ?? 'Trait chain incomplete — finish every chain step'
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

/**
 * Roll order for generation. Defaults to z-index, but ensures each if_chain
 * trigger layer is resolved BEFORE its downstream layers so the chain can gate
 * them on the trigger. Without this, a low-z-index downstream layer (e.g. Body)
 * would be rolled first and could force the higher-z-index trigger (e.g. Hat).
 */
export function chainAwareCategoryOrder(
  categories: TraitCategory[],
  rules: CompatibilityRule[],
  traitById: Map<string, TraitLayer>
): TraitCategory[] {
  const sorted = [...categories].sort((a, b) => a.zIndex - b.zIndex)

  const mustComeBefore = new Map<string, Set<string>>()
  const addDep = (downstreamCat: string | undefined, triggerCat: string | undefined) => {
    if (!downstreamCat || !triggerCat || downstreamCat === triggerCat) return
    const deps = mustComeBefore.get(downstreamCat) ?? new Set<string>()
    deps.add(triggerCat)
    mustComeBefore.set(downstreamCat, deps)
  }

  for (const rule of rules) {
    if (rule.type === 'skip_layer') {
      const triggerCat = rule.whenTraitId ? traitById.get(rule.whenTraitId)?.categoryId : undefined
      addDep(rule.targetCategoryId, triggerCat)
      continue
    }
    if (rule.type !== 'if_chain') continue
    const steps = normalizeIfChainSteps(rule)
    if (steps.length < 2) continue
    const triggerCat = ifChainStepCategoryId(steps[0], traitById)
    if (!triggerCat) continue
    for (let i = 1; i < steps.length; i++) {
      addDep(ifChainStepCategoryId(steps[i], traitById), triggerCat)
    }
  }

  if (!mustComeBefore.size) return sorted

  const known = new Set(sorted.map((c) => c.id))
  const placed = new Set<string>()
  const remaining = [...sorted]
  const ordered: TraitCategory[] = []

  while (remaining.length) {
    let idx = remaining.findIndex((c) => {
      const deps = mustComeBefore.get(c.id)
      if (!deps) return true
      for (const dep of deps) {
        if (known.has(dep) && !placed.has(dep)) return false
      }
      return true
    })
    if (idx === -1) idx = 0 // dependency cycle — fall back to z-index order
    const [cat] = remaining.splice(idx, 1)
    ordered.push(cat)
    placed.add(cat.id)
  }

  return ordered
}

/** Pick one random valid selection, respecting if_pool pools and combo rules. */
export function randomSelection(
  categories: TraitCategory[],
  allTraits: TraitLayer[],
  rules: CompatibilityRule[]
): TraitSelection | null {
  const traitById = new Map(allTraits.map((t) => [t.id, t]))
  const sorted = chainAwareCategoryOrder(categories, rules, traitById)

  for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt++) {
    const selection: TraitSelection = {}

    for (const cat of sorted) {
      const pool = getCategoryPool(cat.id, selection, allTraits, rules, sorted)
      if (!pool.length) {
        selection[cat.id] = null
        continue
      }

      const chainAll = ifChainForcedAllTraits(cat.id, selection, rules, traitById, sorted)
      if (chainAll?.length) {
        selection[cat.id] = chainAll
        continue
      }

      const activeIfPool = activeIfPoolRules(cat.id, selection, rules)
      if (cat.allowMultiple && activeIfPool.length) {
        const ids = withoutStackedNoneTraits(pool.map((t) => t.id), traitById)
        selection[cat.id] = ids.length ? ids : null
        continue
      }

      if (cat.allowMultiple) {
        const picked = pickWeightedRandom(pool)
        selection[cat.id] = picked ? [picked.id] : null
        continue
      }

      const picked = pickWeightedRandom(pool)
      selection[cat.id] = picked?.id ?? null
    }

    if (!validateSelection(selection, rules, traitById, sorted)) return selection
  }
  return null
}
