import 'server-only'

import { formatSugarBatchScanSummary } from '@/lib/owl-center/scan-sugar-batch'
import { mergeValidationChecklist } from '@/lib/owl-center/asset-validation'
import { uploadBytesFromJob } from '@/lib/owl-center/arweave-upload-estimate-server'
import {
  owlCenterAssetUploadBatchSize,
  type ArweaveUploadBatchMode,
} from '@/lib/owl-center/asset-staging-limits'
import { downloadStagedSugarZip } from '@/lib/owl-center/asset-staging-storage'
import type { AssetUploadProgress, OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import {
  buildUploadFileList,
  contentTypeForPath,
  loadZipFromBuffer,
  readZipFileBuffer,
  readZipFileText,
  rewriteMetadataJson,
  scanSugarZip,
} from '@/lib/owl-center/asset-upload-zip'
import { ensureIrysFundedForUpload, isIrysUploadConfigured, uploadBufferToArweaveViaIrys } from '@/lib/owl-center/irys-uploader'
import {
  getAssetUploadJobById,
  listAssetUploadJobsForWorker,
  requeueStaleValidatingJobs,
  updateAssetUploadJob,
} from '@/lib/db/owl-center-asset-upload-job'
import { syncAssetPackageStatus, upsertAssetPackageForLaunch } from '@/lib/db/owl-center-asset-package'
import { autoSetLaunchCoverFromUploadJob } from '@/lib/owl-center/launch-cover-image'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type AssetUploadWorkerResult = {
  ok: boolean
  job_id?: string
  status?: string
  processed_files?: number
  remaining_files?: number
  error?: string
  skipped?: boolean
  reason?: string
}

/**
 * Download + decompress a staged Sugar ZIP, then drop the raw Buffer reference.
 * JSZip keeps its own copy, so returning only the archive lets the ~1GB source
 * Buffer be GC'd before we read/upload entries — the fix for the serverless OOM
 * on large (2000-item / ~1GB) batches (holding Buffer + JSZip copy was ~2GB).
 */
async function loadStagedZip(storagePath: string) {
  const buffer = await downloadStagedSugarZip(storagePath)
  if (!buffer) return null
  return loadZipFromBuffer(buffer)
}

export async function applyValidationScanToLaunch(
  launchId: string,
  scan: Awaited<ReturnType<typeof scanSugarZip>>['scan']
): Promise<void> {
  const supply = scan.inferredSupply || scan.metadataCount
  const checklist = {
    ...scan.checklist,
    metadata_count_matches_supply: scan.metadataCount === supply,
  }
  const summary = formatSugarBatchScanSummary(scan)

  await upsertAssetPackageForLaunch(launchId, {
    expected_supply: supply,
    total_images: scan.imageCount,
    total_metadata: scan.metadataCount,
    validation_checklist: checklist as unknown as Record<string, unknown>,
    validation_errors: scan.errors,
    validation_status: scan.ok ? 'VALID' : 'NEEDS_REVIEW',
    metadata_upload_status: 'NOT_UPLOADED',
    admin_notes: summary,
  })

  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (launch && supply > 0 && supply !== launch.total_supply) {
    await getSupabaseAdmin()
      .from('owl_center_launches')
      .update({ total_supply: supply, public_supply: supply, updated_at: new Date().toISOString() })
      .eq('id', launchId)
  }
}

export async function validateAssetUploadJob(jobId: string): Promise<AssetUploadWorkerResult> {
  const job = await getAssetUploadJobById(jobId)
  if (!job) return { ok: false, error: 'job_not_found' }
  if (job.status !== 'queued' && job.status !== 'validating') {
    return { ok: true, skipped: true, reason: 'not_queued', job_id: jobId, status: job.status }
  }

  await updateAssetUploadJob(jobId, { status: 'validating', error_message: null })

  const launch = job.launch_id ? await getOwlCenterLaunchByIdAdmin(job.launch_id) : null
  const zip = await loadStagedZip(job.staged_zip_path)
  if (!zip) {
    await updateAssetUploadJob(jobId, {
      status: 'failed',
      error_message: 'Could not read staged ZIP from storage.',
    })
    return { ok: false, error: 'staged_zip_missing', job_id: jobId }
  }

  try {
    const { scan, paths } = await scanSugarZip(zip, launch?.total_supply)
    const file_list = buildUploadFileList(paths)
    // Do NOT decompress every entry here just to total bytes — for large batches
    // (~1GB / 2000 files) that doubles peak memory and OOM-kills the function,
    // leaving the job stuck in `validating`. The Arweave cost estimate falls back
    // to the staged ZIP size (see uploadBytesFromJob), which is accurate enough for
    // PNG-heavy Sugar batches that are already compressed.
    const total_upload_bytes = 0
    const progress: AssetUploadProgress = {
      file_list,
      uploaded: {},
      cursor: 0,
      staged_zip_bytes: job.upload_progress.staged_zip_bytes,
      total_upload_bytes,
    }

    if (!scan.ok) {
      if (job.launch_id) {
        await applyValidationScanToLaunch(job.launch_id, scan)
      }
      await updateAssetUploadJob(jobId, {
        status: 'failed',
        validation_scan: scan,
        upload_progress: progress,
        error_message: scan.errors.join('; ') || 'Validation failed',
      })
      return { ok: false, error: 'validation_failed', job_id: jobId, status: 'failed' }
    }

    if (job.launch_id) {
      await applyValidationScanToLaunch(job.launch_id, scan)
    }

    await updateAssetUploadJob(jobId, {
      status: 'validated',
      validation_scan: scan,
      upload_progress: progress,
      error_message: null,
    })

    if (job.launch_id) {
      await getSupabaseAdmin().from('owl_center_activity_logs').insert({
        launch_id: job.launch_id,
        message: `Phase B validate OK · ${scan.metadataCount} metadata · job ${jobId.slice(0, 8)}`,
        event_type: 'system',
      })
    }

    return { ok: true, job_id: jobId, status: 'validated' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await updateAssetUploadJob(jobId, { status: 'failed', error_message: msg })
    return { ok: false, error: msg, job_id: jobId }
  }
}

export async function startArweaveUploadForJob(jobId: string): Promise<AssetUploadWorkerResult> {
  const job = await getAssetUploadJobById(jobId)
  if (!job) return { ok: false, error: 'job_not_found' }
  if (job.status !== 'validated' && job.status !== 'failed') {
    return { ok: false, error: `Job must be validated (current: ${job.status})` }
  }
  if (job.status === 'failed' && !job.upload_progress.file_list.length) {
    return { ok: false, error: 'Re-validate the ZIP before retrying Arweave upload.' }
  }
  if (!isIrysUploadConfigured()) {
    return {
      ok: false,
      error: 'IRYS_PRIVATE_KEY not configured — set env and redeploy to push to Arweave.',
    }
  }

  const { totalBytes, fileCount } = uploadBytesFromJob(job)
  if (totalBytes < 1) {
    return { ok: false, error: 'No upload bytes — re-validate the staged ZIP.' }
  }

  try {
    await ensureIrysFundedForUpload(totalBytes, Math.max(1, fileCount))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await updateAssetUploadJob(jobId, { status: 'failed', error_message: msg })
    return { ok: false, error: msg, job_id: jobId }
  }

  await updateAssetUploadJob(jobId, {
    status: 'uploading',
    error_message: null,
  })

  return processArweaveUploadUntilComplete(jobId)
}

/** Process every remaining file in one run (admin Push to Arweave). Retries if a platform time limit stops mid-job. */
export async function processArweaveUploadUntilComplete(jobId: string): Promise<AssetUploadWorkerResult> {
  let result = await processArweaveUploadBatch(jobId, { mode: 'full' })
  let guard = 0
  while (
    result.ok &&
    result.status === 'uploading' &&
    (result.remaining_files ?? 0) > 0 &&
    guard < 500
  ) {
    guard += 1
    result = await processArweaveUploadBatch(jobId, { mode: 'full' })
  }
  return result
}

export async function processArweaveUploadBatch(
  jobId: string,
  options?: { mode?: ArweaveUploadBatchMode }
): Promise<AssetUploadWorkerResult> {
  const job = await getAssetUploadJobById(jobId)
  if (!job) return { ok: false, error: 'job_not_found' }
  if (job.status !== 'uploading' && job.status !== 'validated') {
    return { ok: true, skipped: true, reason: 'not_uploading', job_id: jobId, status: job.status }
  }

  if (job.status === 'validated') {
    await updateAssetUploadJob(jobId, { status: 'uploading' })
  }

  const progress = job.upload_progress

  // Load the staged ZIP once per batch and immediately free the raw Buffer (see
  // loadStagedZip). Re-downloading + re-running the full validation scan on every
  // batch (old behaviour) doubled peak memory and OOM-killed large collections.
  const zip = await loadStagedZip(job.staged_zip_path)
  if (!zip) {
    await updateAssetUploadJob(jobId, {
      status: 'failed',
      error_message: 'Staged ZIP missing during upload.',
    })
    return { ok: false, error: 'staged_zip_missing' }
  }

  if (!progress.file_list.length) {
    const { paths } = await scanSugarZip(zip)
    progress.file_list = buildUploadFileList(paths)
    progress.cursor = 0
    progress.uploaded = {}
  }

  const batchSize = owlCenterAssetUploadBatchSize(options?.mode ?? 'tick')
  let processed = 0
  let cursor = progress.cursor

  try {
    while (processed < batchSize && cursor < progress.file_list.length) {
      const entry = progress.file_list[cursor]!
      cursor += 1

      if (progress.uploaded[entry.path]) continue

      let body: Buffer
      if (entry.kind === 'metadata' && entry.index != null) {
        const pngPath = entry.path.replace(/\.json$/i, '.png')
        const pngBasename = `${entry.index}.png`
        const imageUri =
          progress.uploaded[pngPath] ??
          Object.entries(progress.uploaded).find(([k]) => k.endsWith(`/${entry.index}.png`))?.[1]

        if (!imageUri) {
          throw new Error(`PNG not uploaded before metadata index ${entry.index}`)
        }

        const raw = await readZipFileText(zip, entry.path)
        if (!raw) throw new Error(`Missing JSON in ZIP: ${entry.path}`)
        const rewritten = rewriteMetadataJson(raw, imageUri, pngBasename)
        body = Buffer.from(rewritten, 'utf8')
      } else {
        const buf = await readZipFileBuffer(zip, entry.path)
        if (!buf) {
          if (entry.kind === 'other') continue
          throw new Error(`Missing file in ZIP: ${entry.path}`)
        }
        body = buf
      }

      const { uri } = await uploadBufferToArweaveViaIrys(body, contentTypeForPath(entry.path))
      progress.uploaded[entry.path] = uri
      processed += 1

      // Persist periodically so a platform timeout mid-run (large collections in
      // `full` mode can exceed maxDuration) resumes from the last saved cursor
      // instead of re-uploading everything.
      if (processed % 25 === 0) {
        progress.cursor = cursor
        await updateAssetUploadJob(jobId, { status: 'uploading', upload_progress: progress })
      }
    }

    progress.cursor = cursor

    const done = cursor >= progress.file_list.length
    if (done) {
      if (!job.launch_id) {
        throw new Error('Arweave upload requires launch_id — submit launch first')
      }
      const launchId = job.launch_id
      const imageUris = Object.entries(progress.uploaded)
        .filter(([p]) => p.toLowerCase().endsWith('.png') && !p.toLowerCase().includes('collection'))
        .map(([, u]) => u)
      const metaUris = Object.entries(progress.uploaded)
        .filter(([p]) => p.toLowerCase().endsWith('.json') && !p.toLowerCase().includes('collection'))
        .map(([, u]) => u)

      progress.manifest_base_url = metaUris[0] ?? imageUris[0] ?? undefined

      const assetsPath =
        imageUris.length > 0
          ? `irys://${progress.manifest_base_url?.replace('https://arweave.net/', '') ?? 'batch'} (${imageUris.length} images)`
          : null
      const metadataPath =
        metaUris.length > 0
          ? `irys://${metaUris[0]?.replace('https://arweave.net/', '') ?? 'batch'} (${metaUris.length} json)`
          : null

      await upsertAssetPackageForLaunch(launchId, {
        assets_storage_path: assetsPath,
        metadata_storage_path: metadataPath,
        storage_provider: 'irys',
        metadata_upload_status: 'UPLOADED_TO_ARWEAVE',
      })

      const pkg = await upsertAssetPackageForLaunch(launchId, {})
      if (pkg) {
        await syncAssetPackageStatus(
          launchId,
          pkg.validation_status === 'VALID' ? 'VALID' : pkg.validation_status,
          'UPLOADED_TO_ARWEAVE',
          pkg.validation_errors,
          pkg.validation_checklist as unknown as Record<string, unknown>
        )
      }

      await autoSetLaunchCoverFromUploadJob(launchId)

      await updateAssetUploadJob(jobId, {
        status: 'completed',
        upload_progress: progress,
        completed_at: new Date().toISOString(),
        error_message: null,
      })

      await getSupabaseAdmin().from('owl_center_activity_logs').insert({
        launch_id: job.launch_id,
        message: `Phase B Arweave upload complete · ${Object.keys(progress.uploaded).length} files · job ${jobId.slice(0, 8)}`,
        event_type: 'system',
      })

      return {
        ok: true,
        job_id: jobId,
        status: 'completed',
        processed_files: processed,
        remaining_files: 0,
      }
    }

    await updateAssetUploadJob(jobId, {
      status: 'uploading',
      upload_progress: progress,
    })

    return {
      ok: true,
      job_id: jobId,
      status: 'uploading',
      processed_files: processed,
      remaining_files: progress.file_list.length - cursor,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await updateAssetUploadJob(jobId, {
      status: 'failed',
      upload_progress: progress,
      error_message: msg,
    })
    return { ok: false, error: msg, job_id: jobId }
  }
}

/** Cron / worker entry: validate queued jobs, then advance uploading jobs. */
export async function runAssetUploadWorkerTick(): Promise<{
  ok: boolean
  requeued_stale: number
  results: AssetUploadWorkerResult[]
}> {
  // Recover jobs orphaned in `validating` by a prior crashed/timed-out run so
  // they get retried instead of hanging forever.
  const requeuedStale = await requeueStaleValidatingJobs()

  const jobs = await listAssetUploadJobsForWorker(5)
  const results: AssetUploadWorkerResult[] = []

  for (const job of jobs) {
    if (job.status === 'queued') {
      results.push(await validateAssetUploadJob(job.id))
      continue
    }
    if (job.status === 'uploading') {
      results.push(await processArweaveUploadBatch(job.id, { mode: 'tick' }))
    }
  }

  return { ok: true, requeued_stale: requeuedStale, results }
}

export function jobProgressSummary(job: OwlCenterAssetUploadJob): {
  total_files: number
  uploaded_files: number
  percent: number
} {
  const total = job.upload_progress.file_list.length
  const uploaded = Object.keys(job.upload_progress.uploaded).length
  const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0
  return { total_files: total, uploaded_files: uploaded, percent }
}