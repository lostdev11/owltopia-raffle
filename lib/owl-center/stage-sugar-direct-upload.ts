import { randomUUID } from 'node:crypto'

import { OWL_CENTER_STAGING_BUCKET, OWL_CENTER_SYNC_VALIDATE_MAX_BYTES } from '@/lib/owl-center/asset-staging-limits'
import { isAllowedStagedZip } from '@/lib/owl-center/asset-staging-storage'
import { validateAssetUploadJob, type AssetUploadWorkerResult } from '@/lib/owl-center/asset-upload-worker'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import {
  getAssetUploadJobById,
  insertAssetUploadJob,
  updateAssetUploadJob,
} from '@/lib/db/owl-center-asset-upload-job'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

import { stagingScopePrefix, type StageSugarPackageScope } from '@/lib/owl-center/stage-sugar-package'

export type PrepareSugarZipDirectUploadResult =
  | {
      ok: true
      job_id: string
      path: string
      signed_url: string
      token: string
    }
  | { ok: false; error: string }

export type CompleteSugarZipDirectUploadResult =
  | {
      ok: true
      job: OwlCenterAssetUploadJob
      validation: AssetUploadWorkerResult | null
    }
  | { ok: false; error: string }

export function buildStagedZipStoragePath(
  scopePrefix: string,
  jobId: string,
  originalFilename: string
): string {
  const safeName =
    originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || `${randomUUID()}.zip`
  return `${scopePrefix}/${jobId}/${safeName}`
}

export function isStagedZipPathForScope(
  path: string,
  scope: StageSugarPackageScope,
  jobId: string
): boolean {
  const expectedPrefix = `${stagingScopePrefix(scope)}/${jobId}/`
  return path.startsWith(expectedPrefix) && !path.includes('..')
}

export async function prepareSugarZipDirectUpload(input: {
  scope: StageSugarPackageScope
  originalFilename: string
  byteSize: number
}): Promise<PrepareSugarZipDirectUploadResult> {
  const check = isAllowedStagedZip({ name: input.originalFilename, size: input.byteSize })
  if (!check.ok) return { ok: false, error: check.error }

  const jobId = randomUUID()
  const path = buildStagedZipStoragePath(
    stagingScopePrefix(input.scope),
    jobId,
    input.originalFilename
  )

  const { data, error } = await getSupabaseAdmin()
    .storage.from(OWL_CENTER_STAGING_BUCKET)
    .createSignedUploadUrl(path, { upsert: false })

  if (error || !data?.signedUrl || !data.token) {
    console.error('prepareSugarZipDirectUpload', error)
    const hint =
      typeof error?.message === 'string' && error.message.toLowerCase().includes('bucket')
        ? ' Run migration 143 or create owl-center-asset-staging bucket in Supabase.'
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
    console.error('stagedZipExistsAtPath', error)
    return false
  }

  return Boolean(data?.some((entry) => entry.name === fileName))
}

export async function completeSugarZipDirectUpload(input: {
  scope: StageSugarPackageScope
  jobId: string
  path: string
  originalFilename: string
  byteSize: number
}): Promise<CompleteSugarZipDirectUploadResult> {
  if (!isStagedZipPathForScope(input.path, input.scope, input.jobId)) {
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

  const job = await insertAssetUploadJob({
    launch_id: input.scope.kind === 'launch' ? input.scope.launchId : null,
    generator_project_id: input.scope.kind === 'generator' ? input.scope.projectId : null,
    creator_wallet: input.scope.kind === 'generator' ? input.scope.creatorWallet : null,
    staged_zip_path: input.path,
    original_filename: input.originalFilename || null,
  })
  if (!job) return { ok: false, error: 'Could not create upload job' }

  await updateAssetUploadJob(job.id, {
    upload_progress: {
      ...job.upload_progress,
      staged_zip_bytes: input.byteSize,
    },
  })

  let validation: AssetUploadWorkerResult | null = null
  if (input.byteSize <= OWL_CENTER_SYNC_VALIDATE_MAX_BYTES) {
    validation = await validateAssetUploadJob(job.id)
  }

  const fresh = await getAssetUploadJobById(job.id)
  return { ok: true, job: fresh ?? job, validation }
}
