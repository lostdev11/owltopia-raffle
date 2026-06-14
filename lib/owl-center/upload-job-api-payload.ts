import 'server-only'

import type { ArweaveUploadEstimate } from '@/lib/owl-center/arweave-upload-estimate-types'
import { buildArweaveUploadEstimate } from '@/lib/owl-center/arweave-upload-estimate-server'
import { jobProgressSummary } from '@/lib/owl-center/asset-upload-worker'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import { isIrysUploadConfigured } from '@/lib/owl-center/irys-config'
import { PHASE_B_RECOMMENDED_STEPS } from '@/lib/owl-center/phase-b-workflow'

export type UploadJobApiPayload = {
  job: OwlCenterAssetUploadJob | null
  progress: ReturnType<typeof jobProgressSummary> | null
  irys_configured: boolean
  arweave_estimate: ArweaveUploadEstimate | null
  recommended_workflow: readonly string[]
}

export async function buildUploadJobApiPayload(
  job: OwlCenterAssetUploadJob | null
): Promise<UploadJobApiPayload> {
  return {
    job,
    progress: job ? jobProgressSummary(job) : null,
    irys_configured: isIrysUploadConfigured(),
    arweave_estimate: job ? await buildArweaveUploadEstimate(job) : null,
    recommended_workflow: PHASE_B_RECOMMENDED_STEPS,
  }
}
