import { getCategorySelectionIds, selectionHasTrait } from '@/lib/owl-center/generator/selection'
import type { CompatibilityRule, TraitCategory, TraitLayer, TraitSelection } from '@/lib/owl-center/generator/types'

export type IfChainStep = {
  traitIds: string[]
  /** When true on a multi-trait step, stack every trait (e.g. combine eyewear PNGs). Default: pick one. */
  stackAll?: boolean
}

export type IfChainStepMode = 'single' | 'one_of' | 'all'

/** Matches the creator's "empty layer" sentinel trait (e.g. "No Trait", "None"). */
const NONE_TRAIT_PATTERN = /^(no[\s_-]?trait|none)$/i

/** A "No Trait"/"None" sentinel means the layer renders nothing — it must never stack with a real trait. */
export function isNoneTrait(trait: TraitLayer | undefined): boolean {
  if (!trait) return false
  return NONE_TRAIT_PATTERN.test(trait.name.trim())
}

export function isNoneTraitId(traitId: string, traitById: Map<string, TraitLayer>): boolean {
  return isNoneTrait(traitById.get(traitId))
}

/**
 * Drop the "No Trait" sentinel from a stacked set when real traits are present —
 * an owl can't have both "No Trait" and a real trait in the same layer. If every
 * id is a sentinel, keep them as-is (the layer is genuinely empty).
 */
export function withoutStackedNoneTraits(traitIds: string[], traitById: Map<string, TraitLayer>): string[] {
  if (traitIds.length <= 1) return traitIds
  const real = traitIds.filter((id) => !isNoneTraitId(id, traitById))
  return real.length ? real : traitIds
}

export function normalizeIfChainSteps(rule: CompatibilityRule): IfChainStep[] {
  if (rule.chainSteps?.length) {
    return rule.chainSteps.filter((s) => s.traitIds.length > 0)
  }
  if (rule.chainTraitIds?.length) {
    return rule.chainTraitIds.map((id) => ({ traitIds: [id] }))
  }
  return []
}

export function flattenIfChainSteps(steps: IfChainStep[]): string[] {
  return steps.flatMap((s) => s.traitIds)
}

export function ifChainStepCategoryId(
  step: IfChainStep,
  traitById: Map<string, TraitLayer>
): string | undefined {
  const first = traitById.get(step.traitIds[0])
  return first?.categoryId
}

export function ifChainStepMode(_category: TraitCategory | undefined, step: IfChainStep): IfChainStepMode {
  if (step.traitIds.length <= 1) return 'single'
  if (step.stackAll) return 'all'
  return 'one_of'
}

/** Traits actually stacked for an `all` step — never includes the "No Trait" sentinel when real traits exist. */
export function ifChainStepStackTraitIds(
  step: IfChainStep,
  traitById: Map<string, TraitLayer>
): string[] {
  return withoutStackedNoneTraits(step.traitIds, traitById)
}

export function isIfChainStepSatisfied(
  step: IfChainStep,
  selection: TraitSelection,
  category: TraitCategory | undefined,
  traitById?: Map<string, TraitLayer>
): boolean {
  const mode = ifChainStepMode(category, step)
  if (mode === 'all') {
    const stackIds = traitById ? ifChainStepStackTraitIds(step, traitById) : step.traitIds
    const present = stackIds.filter((id) => selectionHasTrait(selection, id))
    return present.length === stackIds.length
  }
  const present = step.traitIds.filter((id) => selectionHasTrait(selection, id))
  return present.length === 1
}

/**
 * A chain is directional: only the first step is the trigger. The chain fires
 * (constraining the downstream steps) when a trigger trait is selected — NOT when
 * a downstream consequence trait happens to be picked. Treating any member as the
 * trigger lets a common downstream trait force the rare trigger trait, which blows
 * up the trigger's rarity (e.g. a rare hat appearing on most of the supply).
 */
export function isIfChainActive(steps: IfChainStep[], selection: TraitSelection): boolean {
  const trigger = steps[0]
  if (!trigger) return false
  return trigger.traitIds.some((id) => selectionHasTrait(selection, id))
}

export function isIfChainFullySatisfied(
  steps: IfChainStep[],
  selection: TraitSelection,
  categories: TraitCategory[],
  traitById: Map<string, TraitLayer>
): boolean {
  const catById = new Map(categories.map((c) => [c.id, c]))
  return steps.every((step) => {
    const catId = ifChainStepCategoryId(step, traitById)
    const cat = catId ? catById.get(catId) : undefined
    return isIfChainStepSatisfied(step, selection, cat, traitById)
  })
}

/** Another chain step has traits selected outside that step's allowed set. */
export function ifChainStepBlockedByOtherSteps(
  step: IfChainStep,
  steps: IfChainStep[],
  selection: TraitSelection,
  traitById: Map<string, TraitLayer>
): boolean {
  const stepCat = ifChainStepCategoryId(step, traitById)
  if (!stepCat) return false

  for (const other of steps) {
    if (other === step) continue
    const otherCat = ifChainStepCategoryId(other, traitById)
    if (!otherCat) continue
    const picked = getCategorySelectionIds(selection, otherCat)
    if (!picked.length) continue
    const allowed = new Set(other.traitIds)
    if (picked.some((id) => !allowed.has(id))) return true
  }
  return false
}

/** When chain is active, steps with stackAll pick every trait in the step. */
export function ifChainForcedAllTraits(
  categoryId: string,
  selection: TraitSelection,
  rules: CompatibilityRule[],
  traitById: Map<string, TraitLayer>,
  categories: TraitCategory[]
): string[] | null {
  const catById = new Map(categories.map((c) => [c.id, c]))

  for (const rule of rules) {
    if (rule.type !== 'if_chain') continue
    const steps = normalizeIfChainSteps(rule)
    if (!isIfChainActive(steps, selection)) continue

    const step = steps.find((s) => ifChainStepCategoryId(s, traitById) === categoryId)
    if (!step) continue

    const cat = catById.get(categoryId)
    if (ifChainStepMode(cat, step) === 'all') return ifChainStepStackTraitIds(step, traitById)
  }

  return null
}

export function formatIfChainLabel(
  steps: IfChainStep[],
  traitById: Map<string, TraitLayer>,
  categoryName: (categoryId: string) => string,
  categories?: TraitCategory[]
): string {
  const catById = categories ? new Map(categories.map((c) => [c.id, c])) : undefined
  return steps
    .map((step) => {
      const catId = ifChainStepCategoryId(step, traitById)
      const cat = catId && catById ? catById.get(catId) : undefined
      const mode = ifChainStepMode(cat, step)
      const labelIds = mode === 'all' ? ifChainStepStackTraitIds(step, traitById) : step.traitIds
      const names = labelIds.map((id) => traitById.get(id)?.name ?? id.slice(0, 8))
      const joiner = mode === 'all' ? ' + ' : mode === 'one_of' ? ' / ' : ''
      return `${catId ? categoryName(catId) : 'Layer'}: ${names.join(joiner)}`
    })
    .join(' → ')
}
