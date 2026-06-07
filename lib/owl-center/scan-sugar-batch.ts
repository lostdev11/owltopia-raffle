import { buildDefaultValidationChecklist } from '@/lib/owl-center/asset-validation'
import type { OwlCenterAssetValidationChecklist } from '@/lib/owl-center/asset-types'

export type SugarBatchScanSample = {
  index: number
  name: string | null
  symbol: string | null
  image: string | null
  attributeCount: number
}

export type SugarBatchScanResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
  /** Raw file count from folder/file picker (for debugging empty scans). */
  filesReceived: number
  samplePaths: string[]
  imageCount: number
  metadataCount: number
  /** Contiguous supply from 0..n-1 when indices are complete. */
  inferredSupply: number
  missingIndices: number[]
  duplicateNames: string[]
  checklist: OwlCenterAssetValidationChecklist
  samples: SugarBatchScanSample[]
  detectedSymbol: string | null
  detectedName: string | null
  hasCollectionJson: boolean
  hasCollectionPng: boolean
  hasTraitsCsv: boolean
}

export type SugarBatchScanOptions = {
  /** Launch row supply — used for metadata_count_matches_supply. */
  expectedSupply?: number
}

type ParsedTokenJson = {
  index: number
  name?: string
  symbol?: string
  description?: string
  image?: string
  attributes?: unknown[]
}

type ScanEntry = {
  path: string
  jsonText?: string
}

const TOKEN_FILE_RE = /^(\d+)\.(png|json)$/i
const COLLECTION_JSON = 'collection.json'
const COLLECTION_PNG = 'collection.png'
const TRAITS_CSV = 'traits.csv'

function basename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function parseTokenIndex(filename: string): number | null {
  const m = TOKEN_FILE_RE.exec(filename)
  if (!m) return null
  return Number.parseInt(m[1]!, 10)
}

function parseMetaplexJson(text: string, index: number): ParsedTokenJson | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    return {
      index,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      symbol: typeof raw.symbol === 'string' ? raw.symbol : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      image: typeof raw.image === 'string' ? raw.image : undefined,
      attributes: Array.isArray(raw.attributes) ? raw.attributes : undefined,
    }
  } catch {
    return null
  }
}

function imageRefMatchesIndex(image: string | undefined, index: number): boolean {
  if (!image?.trim()) return false
  const ref = image.trim().replace(/\\/g, '/')
  const base = ref.split('/').filter(Boolean).pop() ?? ref
  return base.toLowerCase() === `${index}.png`
}

/** Scan Sugar-style asset folders (0.png + 0.json …) from path list + optional JSON bodies. */
export function scanSugarBatchEntries(
  entries: ScanEntry[],
  options: SugarBatchScanOptions = {}
): SugarBatchScanResult {
  const errors: string[] = []
  const warnings: string[] = []
  const checklist = buildDefaultValidationChecklist()

  const pngIndices = new Set<number>()
  const jsonIndices = new Set<number>()
  const parsedByIndex = new Map<number, ParsedTokenJson>()
  let hasCollectionJson = false
  let hasCollectionPng = false
  let hasTraitsCsv = false
  let collectionMeta: { name?: string; symbol?: string } | null = null

  for (const entry of entries) {
    const base = basename(entry.path)
    const lower = base.toLowerCase()

    if (lower === COLLECTION_JSON) {
      hasCollectionJson = true
      if (entry.jsonText) {
        try {
          const raw = JSON.parse(entry.jsonText) as Record<string, unknown>
          collectionMeta = {
            name: typeof raw.name === 'string' ? raw.name : undefined,
            symbol: typeof raw.symbol === 'string' ? raw.symbol : undefined,
          }
        } catch {
          warnings.push('collection.json could not be parsed')
        }
      }
      continue
    }
    if (lower === COLLECTION_PNG) {
      hasCollectionPng = true
      continue
    }
    if (lower === TRAITS_CSV) {
      hasTraitsCsv = true
      continue
    }

    const idx = parseTokenIndex(base)
    if (idx === null) {
      if (!base.startsWith('.') && base.length > 0) {
        warnings.push(`Ignored non-token file: ${entry.path}`)
      }
      continue
    }

    if (lower.endsWith('.png')) pngIndices.add(idx)
    if (lower.endsWith('.json')) {
      jsonIndices.add(idx)
      if (entry.jsonText) {
        const parsed = parseMetaplexJson(entry.jsonText, idx)
        if (parsed) parsedByIndex.set(idx, parsed)
        else errors.push(`Invalid JSON at index ${idx}`)
      }
    }
  }

  const allIndices = new Set([...pngIndices, ...jsonIndices])
  const imageCount = pngIndices.size
  const metadataCount = jsonIndices.size

  const samplePaths = entries
    .map((e) => e.path)
    .sort()
    .slice(0, 8)

  if (entries.length === 0) {
    errors.push('No files received — try Scan ZIP or Select all files in assets (Ctrl+A).')
  } else if (imageCount === 0 && metadataCount === 0) {
    errors.push(
      'No numbered token files found (expected 0.png, 0.json, …). Check names are exactly 0.png not image_0.png.'
    )
  }

  checklist.image_count_matches_metadata_count = imageCount === metadataCount && imageCount > 0
  checklist.matching_image_json_pairs =
    imageCount > 0 &&
    [...allIndices].every((i) => pngIndices.has(i) && jsonIndices.has(i))

  const maxIndex = allIndices.size ? Math.max(...allIndices) : -1
  const minIndex = allIndices.size ? Math.min(...allIndices) : 0
  const missingIndices: number[] = []
  if (maxIndex >= 0) {
    for (let i = minIndex; i <= maxIndex; i++) {
      if (!pngIndices.has(i) || !jsonIndices.has(i)) missingIndices.push(i)
    }
  }

  checklist.numeric_file_naming = [...allIndices].every((i) => Number.isInteger(i) && i >= 0)
  checklist.no_missing_indices = missingIndices.length === 0 && maxIndex >= 0

  const inferredSupply =
    checklist.no_missing_indices && minIndex === 0 ? maxIndex + 1 : imageCount

  const expectedSupply = options.expectedSupply ?? inferredSupply
  checklist.metadata_count_matches_supply =
    metadataCount > 0 && expectedSupply > 0 && metadataCount === expectedSupply

  if (
    options.expectedSupply != null &&
    options.expectedSupply > 0 &&
    metadataCount !== options.expectedSupply
  ) {
    warnings.push(
      `Launch supply is ${options.expectedSupply} but scan found ${metadataCount} metadata file(s)`
    )
  }

  const names: string[] = []
  let allHaveName = metadataCount > 0
  let allHaveSymbol = metadataCount > 0
  let allHaveDescription = metadataCount > 0
  let allHaveImage = metadataCount > 0
  let allHaveAttributes = metadataCount > 0
  let allImageRefsMatch = metadataCount > 0

  for (const idx of jsonIndices) {
    const p = parsedByIndex.get(idx)
    if (!p) {
      allHaveName = false
      allHaveSymbol = false
      allHaveDescription = false
      allHaveImage = false
      allHaveAttributes = false
      allImageRefsMatch = false
      errors.push(`Missing or unread JSON body for index ${idx}`)
      continue
    }
    if (!p.name?.trim()) allHaveName = false
    else names.push(p.name.trim())
    if (!p.symbol?.trim()) allHaveSymbol = false
    if (!p.description?.trim()) allHaveDescription = false
    if (!p.image?.trim()) allHaveImage = false
    if (!p.attributes?.length) allHaveAttributes = false
    if (!imageRefMatchesIndex(p.image, idx)) allImageRefsMatch = false
  }

  checklist.json_has_name = allHaveName
  checklist.json_has_symbol = allHaveSymbol
  checklist.json_has_description = allHaveDescription
  checklist.json_has_image = allHaveImage
  checklist.json_has_attributes = allHaveAttributes
  checklist.image_references_match = allImageRefsMatch

  const nameCounts = new Map<string, number>()
  for (const n of names) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1)
  const duplicateNames = [...nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n)
  checklist.no_duplicate_names = duplicateNames.length === 0 && names.length > 0

  const samples: SugarBatchScanSample[] = [...jsonIndices]
    .sort((a, b) => a - b)
    .slice(0, 5)
    .map((index) => {
      const p = parsedByIndex.get(index)
      return {
        index,
        name: p?.name ?? null,
        symbol: p?.symbol ?? null,
        image: p?.image ?? null,
        attributeCount: p?.attributes?.length ?? 0,
      }
    })

  const firstParsed = parsedByIndex.get(Math.min(...jsonIndices))
  const detectedSymbol = collectionMeta?.symbol ?? firstParsed?.symbol ?? null
  const detectedName = collectionMeta?.name ?? firstParsed?.name ?? null

  if (!hasCollectionJson) warnings.push('No collection.json found (optional but recommended for Sugar)')
  if (!hasCollectionPng) warnings.push('No collection.png found (optional cover image)')

  const ok = errors.length === 0 && imageCount > 0 && metadataCount > 0

  return {
    ok,
    errors,
    warnings,
    filesReceived: entries.length,
    samplePaths,
    imageCount,
    metadataCount,
    inferredSupply,
    missingIndices,
    duplicateNames,
    checklist,
    samples,
    detectedSymbol,
    detectedName,
    hasCollectionJson,
    hasCollectionPng,
    hasTraitsCsv,
  }
}

async function readFileText(file: File): Promise<string> {
  return file.text()
}

/** Scan a multi-file pick (flat assets) — pass a copied array; FileList may be cleared by the input. */
export async function scanSugarBatchFromFiles(
  files: FileList | File[],
  options: SugarBatchScanOptions = {}
): Promise<SugarBatchScanResult> {
  const list = Array.from(files)
  const entries: ScanEntry[] = []

  for (const file of list) {
    const path =
      'webkitRelativePath' in file && typeof file.webkitRelativePath === 'string' && file.webkitRelativePath
        ? file.webkitRelativePath
        : file.name
    const base = basename(path)
    const entry: ScanEntry = { path }
    if (base.toLowerCase().endsWith('.json')) {
      entry.jsonText = await readFileText(file)
    }
    entries.push(entry)
  }

  return scanSugarBatchEntries(entries, options)
}

/** Scan a Sugar export ZIP (e.g. paperfree-batch-100.zip). */
export async function scanSugarBatchFromZip(
  zipFile: File,
  options: SugarBatchScanOptions = {}
): Promise<SugarBatchScanResult> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(zipFile)
  const entries: ScanEntry[] = []

  const paths = Object.keys(zip.files).filter((p) => !zip.files[p]!.dir)
  for (const path of paths) {
    const base = basename(path)
    const entry: ScanEntry = { path }
    if (base.toLowerCase().endsWith('.json')) {
      entry.jsonText = await zip.files[path]!.async('string')
    }
    entries.push(entry)
  }

  return scanSugarBatchEntries(entries, options)
}

export function formatSugarBatchScanSummary(result: SugarBatchScanResult): string {
  const lines = [
    `Scan: ${result.imageCount} images, ${result.metadataCount} metadata, inferred supply ${result.inferredSupply}`,
    result.detectedName ? `Name sample: ${result.detectedName}` : null,
    result.detectedSymbol ? `Symbol sample: ${result.detectedSymbol}` : null,
    result.missingIndices.length
      ? `Missing indices: ${result.missingIndices.slice(0, 20).join(', ')}${result.missingIndices.length > 20 ? '…' : ''}`
      : 'Indices: complete 0..n-1',
    result.errors.length ? `Errors: ${result.errors.join('; ')}` : null,
    result.warnings.length ? `Warnings: ${result.warnings.join('; ')}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}
