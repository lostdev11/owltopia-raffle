import { randomUUID } from 'node:crypto'

import { OWL_CENTER_SYNC_VALIDATE_MAX_BYTES } from '@/lib/owl-center/asset-staging-limits'
import { uploadStagedSugarZip } from '@/lib/owl-center/asset-staging-storage'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import { validateAssetUploadJob, type AssetUploadWorkerResult } from '@/lib/owl-center/asset-upload-worker'
import {
  getAssetUploadJobById,
  insertAssetUploadJob,
  updateAssetUploadJob,
} from '@/lib/db/owl-center-asset-upload-job'

export type StageSugarPackageScope =
  | { kind: 'launch'; launchId: string }
  | { kind: 'generator'; projectId: string; creatorWallet: string }

export type StageSugarPackageResult = {
  ok: true
  job: OwlCenterAssetUploadJob
  validation: AssetUploadWorkerResult | null
}

export function stagingScopePrefix(scope: StageSugarPackageScope): string {
  return scope.kind === 'launch' ? scope.launchId : `generator/${scope.projectId}`
}

/** Stage a Sugar ZIP and optionally run sync validation for small archives. */
export async function stageSugarPackageZip(input: {
  buffer: Buffer
  originalFilename: string
  scope: StageSugarPackageScope
}): Promise<StageSugarPackageResult | { ok: false; error: string }> {
  const jobId = randomUUID()
  const prefix = stagingScopePrefix(input.scope)
  const staged = await uploadStagedSugarZip(prefix, jobId, input.buffer, input.originalFilename)
  if ('error' in staged) return { ok: false, error: staged.error }

  const job = await insertAssetUploadJob({
    launch_id: input.scope.kind === 'launch' ? input.scope.launchId : null,
    generator_project_id: input.scope.kind === 'generator' ? input.scope.projectId : null,
    creator_wallet: input.scope.kind === 'generator' ? input.scope.creatorWallet : null,
    staged_zip_path: staged.path,
    original_filename: input.originalFilename || null,
  })
  if (!job) return { ok: false, error: 'Could not create upload job' }

  await updateAssetUploadJob(job.id, {
    upload_progress: {
      ...job.upload_progress,
      staged_zip_bytes: input.buffer.length,
    },
  })

  let validation: AssetUploadWorkerResult | null = null
  if (input.buffer.length <= OWL_CENTER_SYNC_VALIDATE_MAX_BYTES) {
    validation = await validateAssetUploadJob(job.id)
  }

  const fresh = await getAssetUploadJobById(job.id)
  return { ok: true, job: fresh ?? job, validation }
}
