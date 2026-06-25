import type { AssetUploadFileEntry } from '@/lib/owl-center/asset-upload-types'
import { scanSugarBatchEntries } from '@/lib/owl-center/scan-sugar-batch'
import type { SugarBatchScanResult } from '@/lib/owl-center/scan-sugar-batch'
import { StagedZip } from '@/lib/owl-center/zip-reader'

const TOKEN_FILE_RE = /^(\d+)\.(png|json)$/i

function basename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function classifyFile(path: string): AssetUploadFileEntry['kind'] {
  const base = basename(path).toLowerCase()
  if (base === 'collection.json') return 'collection_meta'
  if (base === 'collection.png') return 'collection_image'
  if (base === 'traits.csv') return 'traits'
  const m = TOKEN_FILE_RE.exec(base)
  if (m) {
    return m[2] === 'png' ? 'image' : 'metadata'
  }
  return 'other'
}

function tokenIndex(path: string): number | null {
  const m = TOKEN_FILE_RE.exec(basename(path))
  if (!m) return null
  return Number.parseInt(m[1]!, 10)
}

/** Build upload order: images asc, metadata asc, then collection + traits. */
export function buildUploadFileList(zipPaths: string[]): AssetUploadFileEntry[] {
  const entries: AssetUploadFileEntry[] = zipPaths.map((path) => ({
    path,
    kind: classifyFile(path),
    index: tokenIndex(path),
  }))

  const kindOrder: Record<AssetUploadFileEntry['kind'], number> = {
    image: 0,
    metadata: 1,
    collection_image: 2,
    collection_meta: 3,
    traits: 4,
    other: 5,
  }

  return entries.sort((a, b) => {
    const ko = kindOrder[a.kind] - kindOrder[b.kind]
    if (ko !== 0) return ko
    const ai = a.index ?? 999999
    const bi = b.index ?? 999999
    if (ai !== bi) return ai - bi
    return a.path.localeCompare(b.path)
  })
}

/**
 * Open a Sugar ZIP with the low-memory reader (central directory only — no file
 * is inflated yet). The StagedZip keeps the source buffer and inflates entries
 * on demand, so peak memory stays bounded even for ~1GB / 2000-item exports
 * (JSZip's full-archive inflate is what OOM-killed the serverless function).
 */
export async function loadZipFromBuffer(zipBuffer: Buffer): Promise<StagedZip> {
  return StagedZip.open(zipBuffer)
}

/**
 * Validation scan over an opened archive. Reads ONLY the JSON entries (images
 * are never inflated), one at a time, so memory stays flat during validation.
 */
export async function scanSugarZip(
  zip: StagedZip,
  expectedSupply?: number
): Promise<{ scan: SugarBatchScanResult; paths: string[] }> {
  const paths = zip.paths
  const entries: { path: string; jsonText?: string }[] = []

  for (const path of paths) {
    const entry: { path: string; jsonText?: string } = { path }
    if (basename(path).toLowerCase().endsWith('.json')) {
      entry.jsonText = (await zip.readText(path)) ?? undefined
    }
    entries.push(entry)
  }

  const scan = scanSugarBatchEntries(entries, { expectedSupply })
  return { scan, paths }
}

export async function scanSugarZipBuffer(
  zipBuffer: Buffer,
  expectedSupply?: number
): Promise<{ scan: SugarBatchScanResult; zip: StagedZip; paths: string[] }> {
  const zip = await loadZipFromBuffer(zipBuffer)
  const { scan, paths } = await scanSugarZip(zip, expectedSupply)
  return { scan, zip, paths }
}

export async function readZipFileBuffer(zip: StagedZip, path: string): Promise<Buffer | null> {
  return zip.read(path)
}

export async function readZipFileText(zip: StagedZip, path: string): Promise<string | null> {
  return zip.readText(path)
}

export function rewriteMetadataJson(
  rawJson: string,
  imageUri: string,
  pngBasename: string
): string {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>
  parsed.image = imageUri
  if (parsed.properties && typeof parsed.properties === 'object') {
    const props = parsed.properties as Record<string, unknown>
    if (Array.isArray(props.files)) {
      props.files = (props.files as Record<string, unknown>[]).map((f) => ({
        ...f,
        uri: typeof f.uri === 'string' && f.uri.endsWith('.png') ? imageUri : f.uri,
      }))
    }
  }
  if (!parsed.properties || typeof parsed.properties !== 'object') {
    parsed.properties = {
      files: [{ uri: imageUri, type: 'image/png' }],
      category: 'image',
    }
  }
  void pngBasename
  return JSON.stringify(parsed, null, 2)
}

export function contentTypeForPath(path: string): string {
  const base = basename(path).toLowerCase()
  if (base.endsWith('.png')) return 'image/png'
  if (base.endsWith('.json')) return 'application/json'
  if (base.endsWith('.csv')) return 'text/csv'
  return 'application/octet-stream'
}
