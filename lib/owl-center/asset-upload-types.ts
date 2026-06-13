import type { SugarBatchScanResult } from '@/lib/owl-center/scan-sugar-batch'

export type OwlCenterAssetUploadJobStatus =
  | 'queued'
  | 'validating'
  | 'validated'
  | 'uploading'
  | 'completed'
  | 'failed'

export type AssetUploadFileEntry = {
  path: string
  kind: 'image' | 'metadata' | 'collection_meta' | 'collection_image' | 'traits' | 'other'
  index: number | null
}

export type AssetUploadProgress = {
  file_list: AssetUploadFileEntry[]
  uploaded: Record<string, string>
  cursor: number
  manifest_base_url?: string
}

export type OwlCenterAssetUploadJob = {
  id: string
  launch_id: string | null
  generator_project_id: string | null
  creator_wallet: string | null
  staged_zip_path: string
  original_filename: string | null
  status: OwlCenterAssetUploadJobStatus
  validation_scan: SugarBatchScanResult | null
  upload_progress: AssetUploadProgress
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export function emptyUploadProgress(): AssetUploadProgress {
  return { file_list: [], uploaded: {}, cursor: 0 }
}

export function parseUploadProgress(raw: unknown): AssetUploadProgress {
  if (!raw || typeof raw !== 'object') return emptyUploadProgress()
  const o = raw as Record<string, unknown>
  const file_list = Array.isArray(o.file_list)
    ? (o.file_list as AssetUploadFileEntry[]).filter((f) => f && typeof f.path === 'string')
    : []
  const uploaded =
    o.uploaded && typeof o.uploaded === 'object' && !Array.isArray(o.uploaded)
      ? (o.uploaded as Record<string, string>)
      : {}
  const cursor = typeof o.cursor === 'number' && o.cursor >= 0 ? o.cursor : 0
  const manifest_base_url =
    typeof o.manifest_base_url === 'string' && o.manifest_base_url.trim()
      ? o.manifest_base_url.trim()
      : undefined
  return { file_list, uploaded, cursor, manifest_base_url }
}
