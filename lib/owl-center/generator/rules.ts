import {
  flattenIfChainSteps,
  ifChainForcedAllTraits,
  ifChainStepBlockedByOtherSteps,
  ifChainStepCategoryId,
  ifChainStepMode,
  ifChainStepStackTraitIds,
  ifChainTriggerBlockedByDownstream,
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
      if (categoryId === triggerCategoryId) {
        // Reverse guard — don't offer a trigger we can't satisfy because a
        // downstream layer already rolled an incompatible trait (keeps if_chain
        // order-independent like skip_layer / if_pool, so a forced roll order from
        // a chain cycle can't zero out the trigger trait).
        if (ifChainTriggerBlockedByDownstream(steps, selection, traitById, categories ?? [])) {
          const triggerIds = new Set(steps[0].traitIds)
          pool = pool.filter((t) => !triggerIds.has(t.id))
        }
        continue
      }

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
 *
 * Edges are split into HARD and SOFT. A stack-all chain step force-sets its whole
 * layer to an exact stack, so it MUST roll after its trigger (otherwise the layer
 * pre-rolls a single trait, never matches, and the trigger gets dropped — zeroing
 * it out). That's a hard edge. Pick-one / single steps and skip_layer can recover
 * via their reverse guards, so they're soft. When a dependency cycle forces us to
 * drop an edge, we drop a SOFT edge first and only break a HARD edge as a last
 * resort, so stack-all triggers keep generating.
 */
export function chainAwareCategoryOrder(
  categories: TraitCategory[],
  rules: CompatibilityRule[],
  traitById: Map<string, TraitLayer>
): TraitCategory[] {
  const sorted = [...categories].sort((a, b) => a.zIndex - b.zIndex)

  const hardBefore = new Map<string, Set<string>>()
  const softBefore = new Map<string, Set<string>>()
  const addDep = (
    downstreamCat: string | undefined,
    triggerCat: string | undefined,
    hard: boolean
  ) => {
    if (!downstreamCat || !triggerCat || downstreamCat === triggerCat) return
    const map = hard ? hardBefore : softBefore
    const deps = map.get(downstreamCat) ?? new Set<string>()
    deps.add(triggerCat)
    map.set(downstreamCat, deps)
  }

  for (const rule of rules) {
    if (rule.type === 'skip_layer') {
      const triggerCat = rule.whenTraitId ? traitById.get(rule.whenTraitId)?.categoryId : undefined
      addDep(rule.targetCategoryId, triggerCat, false)
      continue
    }
    if (rule.type !== 'if_chain') continue
    const steps = normalizeIfChainSteps(rule)
    if (steps.length < 2) continue
    const triggerCat = ifChainStepCategoryId(steps[0], traitById)
    if (!triggerCat) continue
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i]
      addDep(ifChainStepCategoryId(step, traitById), triggerCat, ifChainStepMode(undefined, step) === 'all')
    }
  }

  if (!hardBefore.size && !softBefore.size) return sorted

  const known = new Set(sorted.map((c) => c.id))
  const placed = new Set<string>()
  const remaining = [...sorted]
  const ordered: TraitCategory[] = []

  const depsSatisfied = (deps: Set<string> | undefined): boolean => {
    if (!deps) return true
    for (const dep of deps) {
      if (known.has(dep) && !placed.has(dep)) return false
    }
    return true
  }
  // How many edges from `map` we'd violate by placing this category now (i.e. its
  // own unplaced, known dependencies). Used to break cycles as cheaply as possible.
  const unplacedDepCount = (map: Map<string, Set<string>>, catId: string): number => {
    const deps = map.get(catId)
    if (!deps) return 0
    let count = 0
    for (const dep of deps) if (known.has(dep) && !placed.has(dep)) count++
    return count
  }
  // Pick the remaining category that breaks the fewest edges of `map`, preferring
  // earlier z-index (remaining is z-index sorted) on ties.
  const pickFewestBroken = (map: Map<string, Set<string>>): number => {
    let best = 0
    let bestBroken = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const broken = unplacedDepCount(map, remaining[i].id)
      if (broken < bestBroken) {
        bestBroken = broken
        best = i
        if (broken === 0) break
      }
    }
    return best
  }

  while (remaining.length) {
    // 1) Prefer a category whose hard AND soft deps are all placed.
    let idx = remaining.findIndex(
      (c) => depsSatisfied(hardBefore.get(c.id)) && depsSatisfied(softBefore.get(c.id))
    )
    // 2) Cycle: among categories whose HARD deps are satisfied, break the FEWEST
    //    soft edges (keeps heavy trigger layers from being demoted behind the many
    //    layers they gate, which would shrink their effective rarity).
    if (idx === -1) {
      const hardOk = remaining
        .map((c, i) => ({ i, c }))
        .filter(({ c }) => depsSatisfied(hardBefore.get(c.id)))
      if (hardOk.length) {
        idx = hardOk.reduce((best, cur) =>
          unplacedDepCount(softBefore, cur.c.id) < unplacedDepCount(softBefore, best.c.id) ? cur : best
        ).i
      }
    }
    // 3) Hard cycle: break the fewest hard edges possible.
    if (idx === -1) idx = pickFewestBroken(hardBefore)
    const [cat] = remaining.splice(idx, 1)
    ordered.push(cat)
    placed.add(cat.id)
  }

  return ordered
}

/** Roll a single category's value against the current partial selection + rules. */
function rollCategoryValue(
  cat: TraitCategory,
  selection: TraitSelection,
  allTraits: TraitLayer[],
  rules: CompatibilityRule[],
  sorted: TraitCategory[],
  traitById: Map<string, TraitLayer>
): string | string[] | null {
  const pool = getCategoryPool(cat.id, selection, allTraits, rules, sorted)
  if (!pool.length) return null

  const chainAll = ifChainForcedAllTraits(cat.id, selection, rules, traitById, sorted)
  if (chainAll?.length) return chainAll

  const activeIfPool = activeIfPoolRules(cat.id, selection, rules)
  if (cat.allowMultiple && activeIfPool.length) {
    const ids = withoutStackedNoneTraits(pool.map((t) => t.id), traitById)
    return ids.length ? ids : null
  }

  if (cat.allowMultiple) {
    const picked = pickWeightedRandom(pool)
    return picked ? [picked.id] : null
  }

  const picked = pickWeightedRandom(pool)
  return picked?.id ?? null
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
      selection[cat.id] = rollCategoryValue(cat, selection, allTraits, rules, sorted, traitById)
    }
    if (!validateSelection(selection, rules, traitById, sorted)) return selection
  }
  return null
}

export type TraitDiagnosis = {
  traitId: string
  /** True if at least one valid full combo containing the trait was constructed. */
  satisfiable: boolean
  /** When unsatisfiable, the most common rule that blocked it (human-readable). */
  reason?: string
}

/**
 * Explain why a trait may be hard/impossible to generate. Pins the trait into its
 * layer, rolls the rest under the rules, and reports whether ANY valid combo
 * exists with it — and if not, which rule blocked it most often. This separates
 * genuine rule contradictions ("never satisfiable") from merely rare traits.
 */
export function diagnoseTrait(
  categories: TraitCategory[],
  allTraits: TraitLayer[],
  rules: CompatibilityRule[],
  traitId: string,
  attempts = 400
): TraitDiagnosis {
  const traitById = new Map(allTraits.map((t) => [t.id, t]))
  const seed = traitById.get(traitId)
  if (!seed) return { traitId, satisfiable: false, reason: 'Trait no longer exists' }

  const sorted = chainAwareCategoryOrder(categories, rules, traitById)
  const seedCat = categories.find((c) => c.id === seed.categoryId)
  const reasonCounts = new Map<string, number>()

  for (let attempt = 0; attempt < attempts; attempt++) {
    const selection: TraitSelection = {}
    selection[seed.categoryId] = seedCat?.allowMultiple ? [seed.id] : seed.id

    for (const cat of sorted) {
      if (cat.id === seed.categoryId) continue
      selection[cat.id] = rollCategoryValue(cat, selection, allTraits, rules, sorted, traitById)
    }

    // A skip_layer / if_pool rule may have wiped the seed's own layer.
    if (!selectionHasTrait(selection, seed.id)) {
      reasonCounts.set('Another rule forces this layer empty', (reasonCounts.get('Another rule forces this layer empty') ?? 0) + 1)
      continue
    }

    const reason = validateSelection(selection, rules, traitById, sorted)
    if (!reason) return { traitId, satisfiable: true }
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
  }

  let topReason: string | undefined
  let topCount = -1
  for (const [reason, count] of reasonCounts) {
    if (count > topCount) {
      topCount = count
      topReason = reason
    }
  }
  return { traitId, satisfiable: false, reason: topReason ?? 'No valid combo could include this trait' }
}
