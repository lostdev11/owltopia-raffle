import 'server-only'

import { randomUUID } from 'node:crypto'

import {
  OWL_CENTER_STAGING_BUCKET,
  OWL_CENTER_SYNC_VALIDATE_MAX_BYTES,
} from '@/lib/owl-center/asset-staging-limits'
import { isAllowedStagedZip } from '@/lib/owl-center/asset-staging-storage'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  getCoinArtUpgradeUploadJobById,
  insertCoinArtUpgradeUploadJob,
  updateCoinArtUpgradeUploadJob,
  type CoinArtUpgradeUploadJob,
} from '@/lib/db/coin-art-upgrade-upload-jobs'
import { validateCoinArtUpgradeUploadJob } from '@/lib/coin-upgrade/art-upload-worker'

export const COIN_ART_UPGRADE_STAGING_PREFIX = 'coin-upgrade'

export type PrepareCoinArtZipResult =
  | { ok: true; job_id: string; path: string; signed_url: string; token: string }
  | { ok: false; error: string }

export type CompleteCoinArtZipResult =
  | {
      ok: true
      job: CoinArtUpgradeUploadJob
      validation: Awaited<ReturnType<typeof validateCoinArtUpgradeUploadJob>> | null
    }
  | { ok: false; error: string }

export async function prepareCoinArtUpgradeZipDirectUpload(input: {
  originalFilename: string
  byteSize: number
}): Promise<PrepareCoinArtZipResult> {
  const check = isAllowedStagedZip({ name: input.originalFilename, size: input.byteSize })
  if (!check.ok) return { ok: false, error: check.error }

  const jobId = randomUUID()
  const safeName =
    input.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || `${jobId}.zip`
  const path = `${COIN_ART_UPGRADE_STAGING_PREFIX}/${jobId}/${safeName}`

  const { data, error } = await getSupabaseAdmin()
    .storage.from(OWL_CENTER_STAGING_BUCKET)
    .createSignedUploadUrl(path, { upsert: false })

  if (error || !data?.signedUrl || !data.token) {
    console.error('prepareCoinArtUpgradeZipDirectUpload', error)
    const hint =
      typeof error?.message === 'string' && error.message.toLowerCase().includes('bucket')
        ? ' Create owl-center-asset-staging bucket (migration 143) in Supabase.'
        : ''
    return { ok: false, error: `Could not prepare direct upload.${hint}` }
  }

  return {
    ok: true,
    job_id: jobId,
    path: data.path,
    signed_url: data.signedUrl,
    token: data.token,
  }
}

async function stagedZipExistsAtPath(path: string): Promise<boolean> {
  const parts = path.split('/')
  const fileName = parts.pop()
  if (!fileName) return false
  const folder = parts.join('/')
  const { data, error } = await getSupabaseAdmin()
    .storage.from(OWL_CENTER_STAGING_BUCKET)
    .list(folder, { limit: 100, search: fileName })
  if (error) {
    console.error('coinArt stagedZipExistsAtPath', error)
    return false
  }
  return Boolean(data?.some((entry) => entry.name === fileName))
}

export async function completeCoinArtUpgradeZipDirectUpload(input: {
  jobId: string
  path: string
  originalFilename: string
  byteSize: number
  createdBy: string | null
}): Promise<CompleteCoinArtZipResult> {
  const expectedPrefix = `${COIN_ART_UPGRADE_STAGING_PREFIX}/${input.jobId}/`
  if (!input.path.startsWith(expectedPrefix) || input.path.includes('..')) {
    return { ok: false, error: 'Invalid staging path.' }
  }

  const check = isAllowedStagedZip({ name: input.originalFilename, size: input.byteSize })
  if (!check.ok) return { ok: false, error: check.error }

  const exists = await stagedZipExistsAtPath(input.path)
  if (!exists) {
    return {
      ok: false,
      error: 'Uploaded ZIP not found in storage yet — wait for upload to finish, then retry.',
    }
  }

  const job = await insertCoinArtUpgradeUploadJob({
    staged_zip_path: input.path,
    original_filename: input.originalFilename || null,
    created_by: input.createdBy,
    staged_zip_bytes: input.byteSize,
  })
  if (!job) return { ok: false, error: 'Could not create upload job.' }

  // Prefer the prepared job_id path; insert created its own UUID. That's fine —
  // the staging path already contains the prepared id as the folder name.
  let validation: Awaited<ReturnType<typeof validateCoinArtUpgradeUploadJob>> | null = null
  if (input.byteSize <= OWL_CENTER_SYNC_VALIDATE_MAX_BYTES) {
    validation = await validateCoinArtUpgradeUploadJob(job.id)
  }

  const fresh = await getCoinArtUpgradeUploadJobById(job.id)
  return { ok: true, job: fresh ?? job, validation }
}

export async function markCoinArtUpgradeJobQueuedForValidate(jobId: string): Promise<void> {
  await updateCoinArtUpgradeUploadJob(jobId, { status: 'queued', error_message: null })
}
