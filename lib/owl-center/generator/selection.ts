import type { CategorySelection, TraitCategory, TraitLayer, TraitSelection } from '@/lib/owl-center/generator/types'

export function getCategorySelectionIds(selection: TraitSelection, categoryId: string): string[] {
  const value = selection[categoryId]
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function isCategorySelectionEmpty(selection: TraitSelection, categoryId: string): boolean {
  return getCategorySelectionIds(selection, categoryId).length === 0
}

export function categoryAllowsMultiple(category: TraitCategory): boolean {
  return Boolean(category.allowMultiple)
}

export function selectionHasTrait(selection: TraitSelection, traitId: string): boolean {
  for (const value of Object.values(selection)) {
    if (!value) continue
    if (Array.isArray(value)) {
      if (value.includes(traitId)) return true
    } else if (value === traitId) {
      return true
    }
  }
  return false
}

export function traitsForSelection(
  allTraits: TraitLayer[],
  selection: TraitSelection,
  categories?: TraitCategory[]
): TraitLayer[] {
  const byId = new Map(allTraits.map((t) => [t.id, t]))
  const out: TraitLayer[] = []

  if (categories?.length) {
    const sorted = [...categories].sort((a, b) => a.zIndex - b.zIndex)
    for (const cat of sorted) {
      for (const traitId of getCategorySelectionIds(selection, cat.id)) {
        const t = byId.get(traitId)
        if (t) out.push(t)
      }
    }
    return out
  }

  for (const value of Object.values(selection)) {
    if (!value) continue
    const ids = Array.isArray(value) ? value : [value]
    for (const traitId of ids) {
      const t = byId.get(traitId)
      if (t) out.push(t)
    }
  }
  return out
}

export function attributesForSelection(categories: TraitCategory[], traits: TraitLayer[]) {
  const byCat = new Map<string, TraitLayer[]>()
  for (const trait of traits) {
    const list = byCat.get(trait.categoryId) ?? []
    list.push(trait)
    byCat.set(trait.categoryId, list)
  }

  return [...categories]
    .sort((a, b) => a.zIndex - b.zIndex)
    .filter((cat) => byCat.has(cat.id))
    .map((cat) => ({
      trait_type: cat.name,
      value: (byCat.get(cat.id) ?? []).map((t) => t.name).join(' + '),
    }))
}

export function toggleCategoryTrait(
  selection: TraitSelection,
  category: TraitCategory,
  traitId: string
): TraitSelection {
  if (categoryAllowsMultiple(category)) {
    const current = getCategorySelectionIds(selection, category.id)
    const next = current.includes(traitId)
      ? current.filter((id) => id !== traitId)
      : [...current, traitId]
    return { ...selection, [category.id]: next.length ? next : null }
  }

  const current = selection[category.id]
  const isActive = current === traitId || (Array.isArray(current) && current.includes(traitId))
  return { ...selection, [category.id]: isActive ? null : traitId }
}

export function isTraitSelected(
  selection: TraitSelection,
  categoryId: string,
  traitId: string
): boolean {
  return getCategorySelectionIds(selection, categoryId).includes(traitId)
}

export function clearTraitFromSelection(
  selection: TraitSelection,
  traitId: string,
  traitCategoryId: string
): TraitSelection {
  const value = selection[traitCategoryId]
  if (!value) return selection
  if (Array.isArray(value)) {
    const next = value.filter((id) => id !== traitId)
    return { ...selection, [traitCategoryId]: next.length ? next : null }
  }
  if (value === traitId) {
    return { ...selection, [traitCategoryId]: null }
  }
  return selection
}
