export type TraitCategory = {
  id: string
  name: string
  /** Lower renders first. */
  zIndex: number
  /** When true, multiple traits from this layer can stack (e.g. Glasses). */
  allowMultiple?: boolean
}

export type TraitLayer = {
  id: string
  categoryId: string
  name: string
  /** Relative rarity weight (default 100). */
  weight: number
  /** Persisted base64 data URL or public path for demo assets. */
  imageSrc: string
}

export type CompatibilityRuleType = 'require' | 'exclude' | 'lock_set' | 'if_pool' | 'if_chain'

export type CompatibilityRule = {
  id: string
  type: CompatibilityRuleType
  /** Combo rules (require | exclude | lock_set) — two or more trait ids. */
  traitIds?: string[]
  /** if_pool — when this trait is selected… */
  whenTraitId?: string
  /** if_pool — …only roll from these traits in this category. */
  targetCategoryId?: string
  allowedTraitIds?: string[]
  /** if_chain — ordered layer steps (preferred). */
  chainSteps?: { traitIds: string[]; stackAll?: boolean }[]
  /** @deprecated Legacy flat list — migrated to chainSteps on load. */
  chainTraitIds?: string[]
  label?: string
}

export type OneOfOnePlacement = 'start' | 'end' | 'random'

/** Hand-drawn 1/1 art merged into the collection with a custom metadata trait (e.g. Special: The Widow King). */
export type OneOfOneEntry = {
  id: string
  imageSrc: string
  traitType: string
  traitValue: string
}

export type GeneratorProject = {
  id: string
  name: string
  collectionName: string
  symbol: string
  description: string
  categories: TraitCategory[]
  traits: TraitLayer[]
  rules: CompatibilityRule[]
  /** Intended collection supply for launch handoff (optional). */
  targetSupply?: number
  /** Unique 1/1 pieces — occupy slots in the final collection (not extra on top of supply). */
  oneOfOnes?: OneOfOneEntry[]
  /** Where 1/1 token indices land relative to generative pieces. */
  oneOfOnePlacement?: OneOfOnePlacement
  updatedAt: string
}

export type CategorySelection = string | string[] | null

export type TraitSelection = Record<string, CategorySelection>

export type GeneratedNft = {
  index: number
  dna: string
  traits: TraitLayer[]
  attributes: { trait_type: string; value: string }[]
  /** When set, export uses this image instead of compositing trait layers. */
  oneOfOneImageSrc?: string
}

export const DEFAULT_CATEGORIES: Omit<TraitCategory, 'id'>[] = [
  { name: 'Background', zIndex: 0 },
  { name: 'Body', zIndex: 10 },
  { name: 'Hat', zIndex: 20 },
  { name: 'Eyes', zIndex: 25 },
  { name: 'Glasses', zIndex: 30, allowMultiple: true },
  { name: 'Outfits', zIndex: 40 },
]
