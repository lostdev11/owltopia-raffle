/** Supabase Storage bucket for staged Sugar ZIP packages (private). */
export const OWL_CENTER_STAGING_BUCKET = 'owl-center-asset-staging'

/** Max staged ZIP size (2 GB). Keep in sync with the bucket file_size_limit (migration 172). */
export const OWL_CENTER_STAGED_ZIP_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** Validate synchronously on upload when ZIP is below this (80 MB). */
export const OWL_CENTER_SYNC_VALIDATE_MAX_BYTES = 80 * 1024 * 1024

export type ArweaveUploadBatchMode = 'tick' | 'full'

/** Files uploaded to Irys per cron tick. Interactive pushes use `full` (all remaining). */
export function owlCenterAssetUploadBatchSize(mode: ArweaveUploadBatchMode = 'tick'): number {
  if (mode === 'full') return Number.MAX_SAFE_INTEGER
  const raw = process.env.OWL_CENTER_ASSET_UPLOAD_BATCH
  const n = raw ? Number.parseInt(raw, 10) : 15
  if (!Number.isFinite(n) || n < 1) return 15
  return Math.min(n, 50)
}
