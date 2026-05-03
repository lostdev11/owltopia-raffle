import type { OwlCenterAssetValidationChecklist } from '@/lib/owl-center/asset-types'

export function buildDefaultValidationChecklist(): OwlCenterAssetValidationChecklist {
  return {
    image_count_matches_metadata_count: false,
    metadata_count_matches_supply: false,
    numeric_file_naming: false,
    matching_image_json_pairs: false,
    json_has_name: false,
    json_has_symbol: false,
    json_has_description: false,
    json_has_image: false,
    json_has_attributes: false,
    no_duplicate_names: false,
    no_missing_indices: false,
    image_references_match: false,
  }
}

const CHECKLIST_KEYS = Object.keys(buildDefaultValidationChecklist()) as (keyof OwlCenterAssetValidationChecklist)[]

export function mergeValidationChecklist(
  raw: Record<string, unknown> | null | undefined
): OwlCenterAssetValidationChecklist {
  const base = buildDefaultValidationChecklist()
  if (!raw || typeof raw !== 'object') return base
  for (const k of CHECKLIST_KEYS) {
    if (typeof raw[k] === 'boolean') base[k] = raw[k]
  }
  return base
}

export type AssetPackageInput = {
  logo_url?: string | null
  banner_url?: string | null
  collection_image_url?: string | null
  assets_storage_path?: string | null
  metadata_storage_path?: string | null
  traits_csv_url?: string | null
  expected_supply?: number
  total_images?: number
  total_metadata?: number
}

export type AssetPackageValidationResult = { ok: true } | { ok: false; errors: string[] }

/** V1 structural validation only (no file parsing). */
export function validateAssetPackageInput(input: AssetPackageInput): AssetPackageValidationResult {
  const errors: string[] = []

  const trimUrl = (v: unknown, label: string, max = 2000) => {
    if (v === undefined || v === null || v === '') return
    if (typeof v !== 'string') {
      errors.push(`${label} must be text`)
      return
    }
    const t = v.trim()
    if (t.length > max) errors.push(`${label} too long`)
  }

  trimUrl(input.logo_url, 'Logo URL')
  trimUrl(input.banner_url, 'Banner URL')
  trimUrl(input.collection_image_url, 'Collection image URL')
  trimUrl(input.assets_storage_path, 'Assets package path', 4000)
  trimUrl(input.metadata_storage_path, 'Metadata package path', 4000)
  trimUrl(input.traits_csv_url, 'Traits CSV URL')

  const n = (v: unknown, label: string) => {
    if (v === undefined || v === null) return
    const x = Number(v)
    if (!Number.isInteger(x) || x < 0 || x > 10_000_000) errors.push(`${label} must be a non-negative integer`)
  }

  n(input.expected_supply, 'Expected supply')
  n(input.total_images, 'Total images')
  n(input.total_metadata, 'Total metadata')

  return errors.length ? { ok: false, errors } : { ok: true }
}

export function calculateReadinessScore(checklist: OwlCenterAssetValidationChecklist): number {
  const total = CHECKLIST_KEYS.length
  const done = CHECKLIST_KEYS.filter((k) => checklist[k]).length
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

export function formatValidationErrors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}

export function allChecklistComplete(checklist: OwlCenterAssetValidationChecklist): boolean {
  return CHECKLIST_KEYS.every((k) => checklist[k])
}
