/** Supabase Storage bucket for staged Sugar ZIP packages (private). */
export const OWL_CENTER_STAGING_BUCKET = 'owl-center-asset-staging'

/** Max staged ZIP size (512 MB). */
export const OWL_CENTER_STAGED_ZIP_MAX_BYTES = 512 * 1024 * 1024

/** Validate synchronously on upload when ZIP is below this (80 MB). */
export const OWL_CENTER_SYNC_VALIDATE_MAX_BYTES = 80 * 1024 * 1024

/** Files uploaded to Irys per worker tick (cron or manual process). */
export function owlCenterAssetUploadBatchSize(): number {
  const raw = process.env.OWL_CENTER_ASSET_UPLOAD_BATCH
  const n = raw ? Number.parseInt(raw, 10) : 15
  if (!Number.isFinite(n) || n < 1) return 15
  return Math.min(n, 50)
}
