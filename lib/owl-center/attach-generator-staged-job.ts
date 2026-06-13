import { applyValidationScanToLaunch } from '@/lib/owl-center/asset-upload-worker'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import {
  attachStagedJobToLaunch,
  getLatestAssetUploadJobForGeneratorProject,
} from '@/lib/db/owl-center-asset-upload-job'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type AttachGeneratorStagedJobResult = {
  attached: boolean
  job: OwlCenterAssetUploadJob | null
  reason?: string
}

/** Link pre-launch generator staging job to a new launch row and apply validation to asset package. */
export async function attachGeneratorStagedJobToLaunch(
  generatorProjectId: string,
  launchId: string
): Promise<AttachGeneratorStagedJobResult> {
  const projectId = generatorProjectId.trim()
  if (!projectId) return { attached: false, job: null, reason: 'missing_project_id' }

  const existing = await getLatestAssetUploadJobForGeneratorProject(projectId)
  if (!existing || existing.launch_id) {
    return { attached: false, job: existing, reason: 'no_unattached_job' }
  }

  const job = await attachStagedJobToLaunch(existing.id, launchId)
  if (!job) return { attached: false, job: null, reason: 'attach_failed' }

  if (job.validation_scan) {
    await applyValidationScanToLaunch(launchId, job.validation_scan)
  }

  await getSupabaseAdmin().from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: `Generator staged ZIP linked · project ${projectId.slice(0, 8)} · job ${job.id.slice(0, 8)} · ${job.status}`,
    event_type: 'system',
  })

  return { attached: true, job }
}
