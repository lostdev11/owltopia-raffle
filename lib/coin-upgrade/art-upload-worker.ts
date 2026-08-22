import 'server-only'

import {
  owlCenterAssetUploadChunkSize,
  owlCenterAssetUploadConcurrency,
  owlCenterAssetUploadTimeBudgetMs,
} from '@/lib/owl-center/asset-staging-limits'
import { downloadStagedSugarZip } from '@/lib/owl-center/asset-staging-storage'
import { loadZipFromBuffer } from '@/lib/owl-center/asset-upload-zip'
import {
  createIrysUploader,
  ensureIrysFundedForUpload,
  isIrysUploadConfigured,
  uploadBufferWithUploader,
} from '@/lib/owl-center/irys-uploader'
import { rewriteMetadataJson } from '@/lib/owl-center/metadata-royalty'
import {
  getCoinArtUpgradeUploadJobById,
  listCoinArtUpgradeUploadJobsForWorker,
  updateCoinArtUpgradeUploadJob,
  type CoinArtUpgradeUploadFileEntry,
  type CoinArtUpgradeUploadJob,
  type CoinArtUpgradeUploadProgress,
  type CoinArtUpgradeValidationScan,
} from '@/lib/db/coin-art-upgrade-upload-jobs'
import { seedCoinArtUpgradeCatalogFromManifest } from '@/lib/coin-upgrade/seed-catalog-from-manifest'

const TOKEN_FILE_RE = /^(\d+)\.(png|json)$/i

function basename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function buildFileList(zipPaths: string[]): CoinArtUpgradeUploadFileEntry[] {
  const entries: CoinArtUpgradeUploadFileEntry[] = []
  for (const path of zipPaths) {
    const base = basename(path)
    const m = TOKEN_FILE_RE.exec(base)
    if (!m) {
      entries.push({ path, kind: 'other', index: null })
      continue
    }
    const index = Number.parseInt(m[1]!, 10)
    const kind = m[2]!.toLowerCase() === 'png' ? 'image' : 'metadata'
    entries.push({ path, kind, index })
  }
  return entries.sort((a, b) => {
    const kindOrder = { image: 0, metadata: 1, other: 2 } as const
    const ko = kindOrder[a.kind] - kindOrder[b.kind]
    if (ko !== 0) return ko
    return (a.index ?? 999999) - (b.index ?? 999999)
  })
}

function validatePairs(fileList: CoinArtUpgradeUploadFileEntry[]): CoinArtUpgradeValidationScan {
  const png = new Set<number>()
  const json = new Set<number>()
  let other = 0
  for (const f of fileList) {
    if (f.kind === 'image' && f.index != null) png.add(f.index)
    else if (f.kind === 'metadata' && f.index != null) json.add(f.index)
    else other += 1
  }
  const missingPng: number[] = []
  const missingJson: number[] = []
  for (const n of png) if (!json.has(n)) missingJson.push(n)
  for (const n of json) if (!png.has(n)) missingPng.push(n)
  missingPng.sort((a, b) => a - b)
  missingJson.sort((a, b) => a - b)
  const pairCount = [...png].filter((n) => json.has(n)).length
  const ok = pairCount > 0 && missingPng.length === 0 && missingJson.length === 0
  return {
    ok,
    pair_count: pairCount,
    missing_png: missingPng.slice(0, 50),
    missing_json: missingJson.slice(0, 50),
    other_files: other,
    error: ok
      ? undefined
      : pairCount === 0
        ? 'ZIP needs numbered pairs like 1.png + 1.json (coin number = on-chain #).'
        : `Incomplete pairs: ${missingPng.length} missing PNG, ${missingJson.length} missing JSON.`,
  }
}

export type CoinArtUpgradeWorkerResult = {
  ok: boolean
  status?: string
  error?: string
  remaining_files?: number
  catalog_upserted?: number
}

export async function validateCoinArtUpgradeUploadJob(
  jobId: string
): Promise<CoinArtUpgradeWorkerResult> {
  const job = await getCoinArtUpgradeUploadJobById(jobId)
  if (!job) return { ok: false, error: 'Job not found.' }

  await updateCoinArtUpgradeUploadJob(jobId, { status: 'validating', error_message: null })

  try {
    const buf = await downloadStagedSugarZip(job.staged_zip_path)
    if (!buf) {
      await updateCoinArtUpgradeUploadJob(jobId, {
        status: 'failed',
        error_message: 'Could not download staged ZIP.',
      })
      return { ok: false, error: 'Could not download staged ZIP.' }
    }

    const zip = await loadZipFromBuffer(buf)
    const fileList = buildFileList(zip.paths)
    const scan = validatePairs(fileList)

    if (!scan.ok) {
      await updateCoinArtUpgradeUploadJob(jobId, {
        status: 'failed',
        validation_scan: scan,
        error_message: scan.error ?? 'Validation failed.',
        upload_progress: {
          ...job.upload_progress,
          total_files: fileList.filter((f) => f.kind !== 'other').length,
          uploaded_files: 0,
          file_list: fileList,
        },
      })
      return { ok: false, error: scan.error, status: 'failed' }
    }

    await updateCoinArtUpgradeUploadJob(jobId, {
      status: 'validated',
      validation_scan: scan,
      error_message: null,
      upload_progress: {
        ...job.upload_progress,
        total_files: fileList.filter((f) => f.kind !== 'other').length,
        uploaded_files: 0,
        file_list: fileList,
      },
    })
    return { ok: true, status: 'validated' }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Validation failed.'
    await updateCoinArtUpgradeUploadJob(jobId, {
      status: 'failed',
      error_message: message,
    })
    return { ok: false, error: message }
  }
}

function buildManifestFromFileList(
  fileList: CoinArtUpgradeUploadFileEntry[]
): Record<string, { image: string; metadata: string }> {
  const byIndex = new Map<number, { image?: string; metadata?: string }>()
  for (const f of fileList) {
    if (f.index == null || !f.uri) continue
    const cur = byIndex.get(f.index) ?? {}
    if (f.kind === 'image') cur.image = f.uri
    if (f.kind === 'metadata') cur.metadata = f.uri
    byIndex.set(f.index, cur)
  }
  const out: Record<string, { image: string; metadata: string }> = {}
  for (const [n, v] of byIndex) {
    if (v.image && v.metadata) out[String(n)] = { image: v.image, metadata: v.metadata }
  }
  return out
}

async function processIrysBatch(
  job: CoinArtUpgradeUploadJob,
  mode: 'tick' | 'full'
): Promise<CoinArtUpgradeWorkerResult> {
  if (!isIrysUploadConfigured()) {
    return { ok: false, error: 'IRYS_PRIVATE_KEY is not configured.' }
  }

  let progress: CoinArtUpgradeUploadProgress = { ...job.upload_progress }
  let fileList = [...(progress.file_list ?? [])]
  if (fileList.length === 0) {
    return { ok: false, error: 'No file list — run validation first.' }
  }

  const pending = fileList.filter((f) => f.kind !== 'other' && !f.uri)
  if (pending.length === 0) {
    const manifest = buildManifestFromFileList(fileList)
    await updateCoinArtUpgradeUploadJob(job.id, {
      status: 'seeding',
      upload_progress: { ...progress, manifest, uploaded_files: fileList.filter((f) => f.uri).length },
    })
    return seedCatalogForJob(job.id)
  }

  const buf = await downloadStagedSugarZip(job.staged_zip_path)
  if (!buf) return { ok: false, error: 'Could not download staged ZIP.' }
  const zip = await loadZipFromBuffer(buf)

  // Estimate remaining bytes for funding.
  let remainingBytes = 0
  for (const f of pending) {
    const data = await zip.read(f.path)
    if (data) remainingBytes += data.length
  }
  await ensureIrysFundedForUpload(Math.max(remainingBytes, 1), pending.length)

  const handle = await createIrysUploader()
  const started = Date.now()
  const budget = owlCenterAssetUploadTimeBudgetMs(mode)
  const chunkSize = owlCenterAssetUploadChunkSize()
  const concurrency = owlCenterAssetUploadConcurrency()

  await updateCoinArtUpgradeUploadJob(job.id, { status: 'uploading', error_message: null })

  const imageUriByIndex = new Map<number, string>()
  for (const f of fileList) {
    if (f.kind === 'image' && f.index != null && f.uri) imageUriByIndex.set(f.index, f.uri)
  }

  let cursor = 0
  while (cursor < pending.length) {
    if (Date.now() - started > budget) break
    const slice = pending.slice(cursor, cursor + chunkSize)
    cursor += slice.length

    for (let i = 0; i < slice.length; i += concurrency) {
      if (Date.now() - started > budget) break
      const group = slice.slice(i, i + concurrency)
      await Promise.all(
        group.map(async (entry) => {
          if (entry.kind === 'image') {
            const png = await zip.read(entry.path)
            if (!png) throw new Error(`Missing ${entry.path} in ZIP.`)
            const uploaded = await uploadBufferWithUploader(handle, png, 'image/png')
            entry.uri = uploaded.uri
            if (entry.index != null) imageUriByIndex.set(entry.index, uploaded.uri)
            return
          }
          if (entry.kind === 'metadata') {
            const raw = await zip.readText(entry.path)
            if (!raw) throw new Error(`Missing ${entry.path} in ZIP.`)
            const imageUri =
              (entry.index != null ? imageUriByIndex.get(entry.index) : undefined) ||
              fileList.find((f) => f.kind === 'image' && f.index === entry.index)?.uri
            if (!imageUri) {
              throw new Error(`Image URI missing for coin #${entry.index} before JSON upload.`)
            }
            const rewritten = rewriteMetadataJson(raw, imageUri, basename(entry.path))
            const uploaded = await uploadBufferWithUploader(
              handle,
              Buffer.from(rewritten, 'utf8'),
              'application/json'
            )
            entry.uri = uploaded.uri
          }
        })
      )

      // Merge URIs back into fileList by path.
      const byPath = new Map(fileList.map((f) => [f.path, f]))
      for (const e of group) {
        const target = byPath.get(e.path)
        if (target && e.uri) target.uri = e.uri
      }
      fileList = [...byPath.values()]
      const uploadedCount = fileList.filter((f) => f.kind !== 'other' && f.uri).length
      progress = {
        ...progress,
        file_list: fileList,
        uploaded_files: uploadedCount,
        total_files: fileList.filter((f) => f.kind !== 'other').length,
      }
      await updateCoinArtUpgradeUploadJob(job.id, {
        status: 'uploading',
        upload_progress: progress,
      })
    }
  }

  const stillPending = fileList.filter((f) => f.kind !== 'other' && !f.uri).length
  if (stillPending > 0) {
    return { ok: true, status: 'uploading', remaining_files: stillPending }
  }

  const manifest = buildManifestFromFileList(fileList)
  await updateCoinArtUpgradeUploadJob(job.id, {
    status: 'seeding',
    upload_progress: { ...progress, manifest },
  })
  return seedCatalogForJob(job.id)
}

async function seedCatalogForJob(jobId: string): Promise<CoinArtUpgradeWorkerResult> {
  const job = await getCoinArtUpgradeUploadJobById(jobId)
  if (!job) return { ok: false, error: 'Job not found.' }
  const manifest = job.upload_progress.manifest
  if (!manifest || Object.keys(manifest).length === 0) {
    return { ok: false, error: 'Manifest empty — Irys upload incomplete.' }
  }

  try {
    const result = await seedCoinArtUpgradeCatalogFromManifest(manifest)
    await updateCoinArtUpgradeUploadJob(jobId, {
      status: 'completed',
      error_message: null,
      completed_at: new Date().toISOString(),
      upload_progress: {
        ...job.upload_progress,
        catalog_upserted: result.upserted,
        catalog_skipped: result.skipped,
        manifest,
      },
    })
    return { ok: true, status: 'completed', catalog_upserted: result.upserted }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Catalog seed failed.'
    await updateCoinArtUpgradeUploadJob(jobId, {
      status: 'failed',
      error_message: message,
    })
    return { ok: false, error: message }
  }
}

export async function startCoinArtUpgradeArweaveUpload(
  jobId: string
): Promise<CoinArtUpgradeWorkerResult> {
  const job = await getCoinArtUpgradeUploadJobById(jobId)
  if (!job) return { ok: false, error: 'Job not found.' }
  if (job.status !== 'validated' && job.status !== 'uploading' && job.status !== 'failed') {
    return { ok: false, error: `Cannot start upload from status ${job.status}.` }
  }
  if (job.status === 'failed') {
    if ((job.upload_progress.file_list?.length ?? 0) === 0) {
      return { ok: false, error: 'Failed job has no file list — re-stage the ZIP.' }
    }
    if (job.validation_scan && job.validation_scan.ok === false) {
      return { ok: false, error: 'Validation failed — re-stage a corrected ZIP with matching pairs.' }
    }
  }
  return processIrysBatch(job, 'full')
}

export async function continueCoinArtUpgradeArweaveUpload(
  jobId: string,
  mode: 'tick' | 'full' = 'tick'
): Promise<CoinArtUpgradeWorkerResult> {
  const job = await getCoinArtUpgradeUploadJobById(jobId)
  if (!job) return { ok: false, error: 'Job not found.' }
  if (job.status === 'seeding') return seedCatalogForJob(jobId)
  if (job.status !== 'uploading' && job.status !== 'validated') {
    return { ok: false, error: `Nothing to continue (status ${job.status}).` }
  }
  return processIrysBatch(job, mode)
}

/** Cron / worker entry: validate queued jobs, continue uploading/seeding. */
export async function processCoinArtUpgradeUploadJobsTick(): Promise<{
  processed: number
  results: Array<{ job_id: string; result: CoinArtUpgradeWorkerResult }>
}> {
  const jobs = await listCoinArtUpgradeUploadJobsForWorker(2)
  const results: Array<{ job_id: string; result: CoinArtUpgradeWorkerResult }> = []
  for (const job of jobs) {
    let result: CoinArtUpgradeWorkerResult
    if (job.status === 'queued') {
      result = await validateCoinArtUpgradeUploadJob(job.id)
    } else if (job.status === 'seeding') {
      result = await seedCatalogForJob(job.id)
    } else {
      result = await continueCoinArtUpgradeArweaveUpload(job.id, 'tick')
    }
    results.push({ job_id: job.id, result })
  }
  return { processed: results.length, results }
}
