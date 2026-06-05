import type { CompatibilityRule, GeneratorProject, TraitCategory } from '@/lib/owl-center/generator/types'
import { normalizeIfChainSteps } from '@/lib/owl-center/generator/if-chain'

export const MAX_TRAIT_CATEGORIES = 24
export const MIN_TRAIT_CATEGORIES = 1

/** Old default names → current defaults (applied once on project load). */
const LEGACY_CATEGORY_RENAMES: Record<string, string> = {
  accessory: 'Outfits',
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

export function removeCategoryFromProject(
  project: GeneratorProject,
  categoryId: string
): GeneratorProject | { error: string } {
  if (project.categories.length <= MIN_TRAIT_CATEGORIES) {
    return { error: 'Keep at least one layer' }
  }
  const traitsInCat = project.traits.filter((t) => t.categoryId === categoryId)
  if (traitsInCat.length) {
    return { error: 'Remove all PNGs from this layer first' }
  }

  const removedIds = new Set(traitsInCat.map((t) => t.id))
  return {
    ...project,
    categories: project.categories.filter((c) => c.id !== categoryId),
    traits: project.traits.filter((t) => t.categoryId !== categoryId),
    rules: pruneRulesForRemovedTraits(project.rules, removedIds),
  }
}
