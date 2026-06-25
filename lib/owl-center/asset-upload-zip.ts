import JSZip from 'jszip'

import type { AssetUploadFileEntry } from '@/lib/owl-center/asset-upload-types'
import { scanSugarBatchEntries } from '@/lib/owl-center/scan-sugar-batch'
import type { SugarBatchScanResult } from '@/lib/owl-center/scan-sugar-batch'

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
 * Load a Sugar ZIP into JSZip. Keep this separate from scanning so callers can
 * drop the source Buffer reference immediately after — holding the raw ~1GB
 * Buffer alongside JSZip's own copy is what OOM-killed large (2000-item) batches.
 */
export async function loadZipFromBuffer(zipBuffer: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(zipBuffer)
}

/**
 * Validation scan over an already-loaded archive. Reads JSON entries from JSZip
 * (not the raw buffer), so the source Buffer can already be freed by this point.
 */
export async function scanSugarZip(
  zip: JSZip,
  expectedSupply?: number
): Promise<{ scan: SugarBatchScanResult; paths: string[] }> {
  const paths = Object.keys(zip.files).filter((p) => !zip.files[p]!.dir)
  const entries: { path: string; jsonText?: string }[] = []

  for (const path of paths) {
    const entry: { path: string; jsonText?: string } = { path }
    if (basename(path).toLowerCase().endsWith('.json')) {
      entry.jsonText = await zip.files[path]!.async('string')
    }
    entries.push(entry)
  }

  const scan = scanSugarBatchEntries(entries, { expectedSupply })
  return { scan, paths }
}

export async function scanSugarZipBuffer(
  zipBuffer: Buffer,
  expectedSupply?: number
): Promise<{ scan: SugarBatchScanResult; zip: JSZip; paths: string[] }> {
  const zip = await loadZipFromBuffer(zipBuffer)
  const { scan, paths } = await scanSugarZip(zip, expectedSupply)
  return { scan, zip, paths }
}

export async function readZipFileBuffer(zip: JSZip, path: string): Promise<Buffer | null> {
  const file = zip.files[path]
  if (!file || file.dir) return null
  return Buffer.from(await file.async('arraybuffer'))
}

export async function readZipFileText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.files[path]
  if (!file || file.dir) return null
  return file.async('string')
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
