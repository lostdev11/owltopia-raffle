import type {
  AssetUploadProgress,
  OwlCenterAssetUploadJob,
  OwlCenterAssetUploadJobStatus,
} from '@/lib/owl-center/asset-upload-types'
import { emptyUploadProgress, parseUploadProgress } from '@/lib/owl-center/asset-upload-types'
import type { SugarBatchScanResult } from '@/lib/owl-center/scan-sugar-batch'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function mapJobRow(row: Record<string, unknown>): OwlCenterAssetUploadJob {
  return {
    id: String(row.id),
    launch_id: String(row.launch_id),
    staged_zip_path: String(row.staged_zip_path),
    original_filename: row.original_filename != null ? String(row.original_filename) : null,
    status: String(row.status) as OwlCenterAssetUploadJobStatus,
    validation_scan: (row.validation_scan as SugarBatchScanResult | null) ?? null,
    upload_progress: parseUploadProgress(row.upload_progress),
    error_message: row.error_message != null ? String(row.error_message) : null,
    started_at: row.started_at != null ? String(row.started_at) : null,
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export async function getAssetUploadJobById(jobId: string): Promise<OwlCenterAssetUploadJob | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_asset_upload_jobs').select('*').eq('id', jobId).maybeSingle()
  if (error || !data) return null
  return mapJobRow(data as Record<string, unknown>)
}

export async function getLatestAssetUploadJobForLaunch(launchId: string): Promise<OwlCenterAssetUploadJob | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_asset_upload_jobs')
    .select('*')
    .eq('launch_id', launchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return mapJobRow(data as Record<string, unknown>)
}

export async function insertAssetUploadJob(input: {
  launch_id: string
  staged_zip_path: string
  original_filename: string | null
}): Promise<OwlCenterAssetUploadJob | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_asset_upload_jobs')
    .insert({
      launch_id: input.launch_id,
      staged_zip_path: input.staged_zip_path,
      original_filename: input.original_filename,
      status: 'queued',
      upload_progress: emptyUploadProgress(),
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error || !data) {
    console.error('insertAssetUploadJob', error)
    return null
  }
  return mapJobRow(data as Record<string, unknown>)
}

export async function updateAssetUploadJob(
  jobId: string,
  patch: Partial<{
    status: OwlCenterAssetUploadJobStatus
    validation_scan: SugarBatchScanResult | null
    upload_progress: AssetUploadProgress
    error_message: string | null
    completed_at: string | null
  }>
): Promise<OwlCenterAssetUploadJob | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_asset_upload_jobs')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select('*')
    .single()
  if (error || !data) {
    console.error('updateAssetUploadJob', error)
    return null
  }
  return mapJobRow(data as Record<string, unknown>)
}

/** Pick jobs that need validation or Arweave batch work. */
export async function listAssetUploadJobsForWorker(limit = 3): Promise<OwlCenterAssetUploadJob[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_asset_upload_jobs')
    .select('*')
    .in('status', ['queued', 'uploading'])
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapJobRow)
}
