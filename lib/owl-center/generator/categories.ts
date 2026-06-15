import type { CompatibilityRule, GeneratorProject, TraitCategory } from '@/lib/owl-center/generator/types'
import { DEFAULT_CATEGORIES } from '@/lib/owl-center/generator/types'
import { normalizeIfChainSteps } from '@/lib/owl-center/generator/if-chain'

export const MAX_TRAIT_CATEGORIES = 24
export const MIN_TRAIT_CATEGORIES = 1

/** Recognized renames for default layer slots (e.g. Body → Base, Hat → Headwear). */
export const DEFAULT_LAYER_ALIASES: Record<string, readonly string[]> = {
  Background: ['backgrounds', 'bg'],
  Body: ['base', 'bases'],
  Hat: ['headwear', 'head wear', 'hats'],
  Eyes: ['eye'],
  Glasses: ['eyewear', 'eye wear'],
  Outfits: ['outfit', 'accessories', 'accessory'],
}

/** Old default names → current defaults (applied once on project load). */
const LEGACY_CATEGORY_RENAMES: Record<string, string> = {
  accessory: 'Outfits',
}

export function categoryMatchesDefaultSlot(categoryName: string, defaultSlotName: string): boolean {
  const lower = categoryName.toLowerCase()
  if (lower === defaultSlotName.toLowerCase()) return true
  return (DEFAULT_LAYER_ALIASES[defaultSlotName] ?? []).some((alias) => alias === lower)
}

export function defaultSlotIsFilled(categories: TraitCategory[], slotName: string): boolean {
  return categories.some((c) => categoryMatchesDefaultSlot(c.name, slotName))
}

export function defaultSlotNameForCategory(categoryName: string): string | null {
  for (const d of DEFAULT_CATEGORIES) {
    if (categoryMatchesDefaultSlot(categoryName, d.name)) return d.name
  }
  return null
}

export function missingDefaultSlots(
  categories: TraitCategory[],
  removedDefaultSlots: readonly string[] = []
): Omit<TraitCategory, 'id'>[] {
  const removed = new Set(removedDefaultSlots.map((s) => s.toLowerCase()))
  return DEFAULT_CATEGORIES.filter((d) => {
    if (removed.has(d.name.toLowerCase())) return false
    return !defaultSlotIsFilled(categories, d.name)
  })
}

/** Drop empty Body/Hat/etc. when the user already renamed that slot (e.g. Base, Headwear). */
export function removeGhostDefaultLayers(
  categories: TraitCategory[],
  traits: { categoryId: string }[]
): TraitCategory[] {
  const traitCount = new Map<string, number>()
  for (const t of traits) {
    traitCount.set(t.categoryId, (traitCount.get(t.categoryId) ?? 0) + 1)
  }

  return categories.filter((cat) => {
    if ((traitCount.get(cat.id) ?? 0) > 0) return true
    for (const defaultCat of DEFAULT_CATEGORIES) {
      if (cat.name.toLowerCase() !== defaultCat.name.toLowerCase()) continue
      const others = categories.filter((c) => c.id !== cat.id)
      if (defaultSlotIsFilled(others, defaultCat.name)) return false
    }
    return true
  })
}

export function flagsForCategoryName(name: string): Pick<TraitCategory, 'allowMultiple'> {
  for (const d of DEFAULT_CATEGORIES) {
    if (categoryMatchesDefaultSlot(name, d.name) && d.allowMultiple) {
      return { allowMultiple: true }
    }
  }
  return {}
}

export function sanitizeCategoryName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  return trimmed.slice(0, 40) || 'Layer'
}

export function applyLegacyCategoryRenames(categories: TraitCategory[]): TraitCategory[] {
  const names = new Set(categories.map((c) => c.name.toLowerCase()))
  return categories.map((cat) => {
    const nextName = LEGACY_CATEGORY_RENAMES[cat.name.toLowerCase()]
    if (!nextName) return cat
    if (names.has(nextName.toLowerCase())) return cat
    return { ...cat, name: nextName }
  })
}

function nextCategoryZIndex(categories: TraitCategory[]): number {
  const max = categories.reduce((m, c) => Math.max(m, c.zIndex), 0)
  return max + 10
}

function pruneRulesForRemovedTraits(rules: CompatibilityRule[], removedTraitIds: Set<string>): CompatibilityRule[] {
  return rules.reduce<CompatibilityRule[]>((acc, r) => {
    if (r.type === 'if_pool') {
      if (r.whenTraitId && removedTraitIds.has(r.whenTraitId)) return acc
      const allowed = (r.allowedTraitIds ?? []).filter((id) => !removedTraitIds.has(id))
      if (!allowed.length) return acc
      acc.push({ ...r, allowedTraitIds: allowed })
      return acc
    }
    if (r.type === 'if_chain') {
      const steps = normalizeIfChainSteps(r)
        .map((s) => ({ traitIds: s.traitIds.filter((id) => !removedTraitIds.has(id)) }))
        .filter((s) => s.traitIds.length)
      const total = steps.reduce((n, s) => n + s.traitIds.length, 0)
      if (steps.length >= 2 && total >= 2) {
        acc.push({ ...r, chainSteps: steps, chainTraitIds: undefined })
      }
      return acc
    }
    const traitIds = (r.traitIds ?? []).filter((id) => !removedTraitIds.has(id))
    if (traitIds.length >= 2) acc.push({ ...r, traitIds })
    return acc
  }, [])
}

export function renameCategoryInProject(
  project: GeneratorProject,
  categoryId: string,
  name: string
): GeneratorProject {
  const nextName = sanitizeCategoryName(name)
  return {
    ...project,
    categories: project.categories.map((c) => (c.id === categoryId ? { ...c, name: nextName } : c)),
  }
}

export function setCategoryAllowMultiple(
  project: GeneratorProject,
  categoryId: string,
  allowMultiple: boolean
): GeneratorProject {
  return {
    ...project,
    categories: project.categories.map((c) =>
      c.id === categoryId ? { ...c, allowMultiple: allowMultiple || undefined } : c
    ),
  }
}

export function addCategoryToProject(
  project: GeneratorProject,
  name: string,
  options?: { allowMultiple?: boolean }
): GeneratorProject | { error: string } {
  if (project.categories.length >= MAX_TRAIT_CATEGORIES) {
    return { error: `Max ${MAX_TRAIT_CATEGORIES} layers per project` }
  }
  const nextName = sanitizeCategoryName(name)
  const exists = project.categories.some((c) => c.name.toLowerCase() === nextName.toLowerCase())
  if (exists) return { error: `Layer "${nextName}" already exists` }

  const category: TraitCategory = {
    id: `cat-${crypto.randomUUID().slice(0, 8)}`,
    name: nextName,
    zIndex: nextCategoryZIndex(project.categories),
    allowMultiple: options?.allowMultiple || undefined,
  }

  return {
    ...project,
    categories: [...project.categories, category].sort((a, b) => a.zIndex - b.zIndex),
  }
}

export function removeTraitFromProject(project: GeneratorProject, traitId: string): GeneratorProject {
  return {
    ...project,
    traits: project.traits.filter((t) => t.id !== traitId),
    rules: pruneRulesForRemovedTraits(project.rules, new Set([traitId])),
  }
}

export function removeCategoryFromProject(
  project: GeneratorProject,
  categoryId: string
): GeneratorProject | { error: string } {
  if (project.categories.length <= MIN_TRAIT_CATEGORIES) {
    return { error: 'Keep at least one layer' }
  }

  const category = project.categories.find((c) => c.id === categoryId)
  if (!category) return { error: 'Layer not found' }

  const traitsInCat = project.traits.filter((t) => t.categoryId === categoryId)
  const removedIds = new Set(traitsInCat.map((t) => t.id))
  const slotName = defaultSlotNameForCategory(category.name)
  const removedDefaultSlots = slotName
    ? [...new Set([...(project.removedDefaultSlots ?? []), slotName])]
    : project.removedDefaultSlots

  return {
    ...project,
    categories: project.categories.filter((c) => c.id !== categoryId),
    traits: project.traits.filter((t) => t.categoryId !== categoryId),
    rules: pruneRulesForRemovedTraits(project.rules, removedIds),
    removedDefaultSlots,
  }
}
